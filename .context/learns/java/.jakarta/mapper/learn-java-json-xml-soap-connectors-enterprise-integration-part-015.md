# learn-java-json-xml-soap-connectors-enterprise-integration — Part 15
# XML Security

> Seri: Java (Jakarta/Javax) JSON, JSON Processing, JSON Binding, XML, XML Binding, XML Web Services, SOAP Legacy, dan Connectors  
> Part: 15 dari 34  
> Fokus: XXE, entity expansion, SSRF via parser, XInclude, schema poisoning, XPath/XSLT risk, XML Signature Wrapping, dan hardened XML processing untuk Java 8 hingga Java 25.

---

## 0. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan bukan hanya tahu daftar flag seperti `disallow-doctype-decl`, tetapi memahami **kenapa XML security sulit**, **di layer mana serangan terjadi**, **bagaimana parser Java berperilaku**, dan **bagaimana mendesain boundary XML yang defensible di production**.

Target akhirnya:

1. Mampu menjelaskan XML security sebagai masalah **interpreter boundary**, bukan sekadar masalah format.
2. Mampu membedakan risiko pada DOM, SAX, StAX, JAXB/Jakarta XML Binding, XPath, XSLT, Schema validation, SOAP, SAAJ, dan XML Signature.
3. Mampu membuat konfigurasi parser aman untuk Java 8–25.
4. Mampu mendesain XML ingestion pipeline yang aman terhadap XXE, SSRF, entity expansion, schema poisoning, signature wrapping, dan resource exhaustion.
5. Mampu melakukan review kode XML parser secara sistematis.
6. Mampu mengambil keputusan realistis: kapan XML schema validation aman, kapan harus offline, kapan harus stream, kapan harus reject, dan kapan harus isolate.

Referensi utama untuk bagian ini:

- Oracle JAXP Security Guide: <https://docs.oracle.com/en/java/javase/24/security/java-api-xml-processing-jaxp-security-guide.html>
- Oracle Java 8 JAXP Security Guide: <https://docs.oracle.com/javase/8/docs/technotes/guides/security/jaxp/jaxp.html>
- OWASP XXE Prevention Cheat Sheet: <https://cheatsheetseries.owasp.org/cheatsheets/XML_External_Entity_Prevention_Cheat_Sheet.html>
- W3C XML Signature Best Practices: <https://www.w3.org/TR/xmldsig-bestpractices/>
- Jakarta XML Binding API `Unmarshaller`: <https://jakarta.ee/specifications/xml-binding/4.0/apidocs/jakarta.xml.bind/jakarta/xml/bind/unmarshaller>
- Jakarta XML Binding Specification: <https://jakarta.ee/specifications/xml-binding/>

---

## 1. Mental Model Besar: XML Security adalah Masalah Interpreter

Banyak engineer memperlakukan XML seperti string data:

```xml
<customer>
  <name>Alice</name>
</customer>
```

Padahal XML processor tidak hanya “membaca tag”. Ia bisa:

1. Membaca external entity.
2. Meng-expand entity internal.
3. Mengakses DTD.
4. Mengambil schema dari URL.
5. Memproses XInclude.
6. Menjalankan XPath expression.
7. Menjalankan XSLT transformation.
8. Melakukan canonicalization.
9. Memverifikasi XML Signature.
10. Mengikuti URI reference dari signature/key info.
11. Membuat object graph lewat JAXB.
12. Memproses SOAP header dan WS-Security.

Jadi XML bukan hanya format, tetapi **bahasa dokumen dengan banyak mekanisme resolusi dan transformasi**.

Mental model yang tepat:

```text
Untrusted XML
   │
   ▼
XML Processor
   │
   ├── Grammar interpretation
   ├── Entity resolution
   ├── Namespace resolution
   ├── Schema validation
   ├── XPath/XSLT execution
   ├── Object binding
   ├── Signature verification
   └── Resource access
```

Masalahnya: setiap sub-layer bisa menjadi attack surface.

### 1.1 Security Boundary Utama

Dalam sistem enterprise, XML biasanya masuk lewat:

1. SOAP endpoint.
2. File upload.
3. SFTP batch integration.
4. Message queue.
5. Email attachment.
6. Partner API.
7. Legacy adapter.
8. Government/regulatory data exchange.
9. Document generation/import.
10. Config file.

Semuanya harus dianggap **untrusted** kecuali berasal dari trusted deployment artifact yang immutable.

Prinsip penting:

> XML dari luar sistem tidak boleh diproses dengan parser default tanpa konfigurasi keamanan eksplisit.

Default parser bisa berubah antar JDK/provider. Relying on default is not a security strategy.

---

## 2. Threat Taxonomy XML Security

Kita kelompokkan ancaman XML berdasarkan “apa yang diserang”.

| Kategori | Target | Contoh |
|---|---|---|
| External resolution | File/network access | XXE, SSRF, local file disclosure |
| Resource exhaustion | CPU/memory | Billion Laughs, quadratic blowup, deep nesting, huge attributes |
| Validation abuse | Schema resolver | Schema poisoning, remote XSD retrieval, import/include abuse |
| Query/transform abuse | XPath/XSLT engine | XPath injection, XSLT external function/resource access |
| Binding abuse | Object model | JAXB object graph bomb, unexpected polymorphism, missing field semantics |
| Signature confusion | Integrity layer | XML Signature Wrapping, signed-but-unused element, unsigned header/body confusion |
| Logging/rendering abuse | Downstream sink | XML content injection into logs, HTML, templates, spreadsheets |
| Protocol confusion | SOAP/WS-* | mustUnderstand bypass, actor/role confusion, header replay |

Top engineer tidak hanya bertanya:

> “Apakah sudah disable XXE?”

Tetapi bertanya:

> “Apa saja capability parser ini? Capability mana yang harus hidup? Capability mana yang harus mati? Apa batas resource? Apa yang diverifikasi? Apa yang benar-benar digunakan application setelah verifikasi?”

---

## 3. XXE: XML External Entity

XXE adalah serangan ketika XML input berisi entity yang membuat parser membaca resource eksternal.

Contoh berbahaya:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE data [
  <!ENTITY secret SYSTEM "file:///etc/passwd">
]>
<data>&secret;</data>
```

Jika parser mengizinkan external entity, isi `/etc/passwd` bisa masuk ke document tree, error message, log, response, atau downstream system.

### 3.1 XXE Bukan Hanya File Disclosure

XXE bisa menyebabkan:

1. Local file disclosure.
2. SSRF ke internal network.
3. Credential metadata access, misalnya cloud metadata endpoint.
4. Port scanning internal.
5. Denial of service.
6. Error-based data leakage.
7. Blind exfiltration via outbound DNS/HTTP.

Contoh SSRF:

```xml
<!DOCTYPE data [
  <!ENTITY xxe SYSTEM "http://169.254.169.254/latest/meta-data/iam/security-credentials/">
]>
<data>&xxe;</data>
```

Bahkan jika response tidak dikembalikan ke user, request outbound bisa tetap terjadi.

### 3.2 Root Cause XXE

Root cause bukan “XML punya tag aneh”, tetapi kombinasi:

1. Parser menerima `DOCTYPE`.
2. Parser menerima entity declaration.
3. Parser mengizinkan external general entity.
4. Parser mengizinkan external parameter entity.
5. Parser mengizinkan external DTD.
6. Parser memiliki resolver yang bisa akses file/network.
7. Application memproses untrusted XML tanpa sandbox.

### 3.3 Defense Strategy

Defense paling aman:

```text
Reject DOCTYPE for untrusted XML.
Disable external general entities.
Disable external parameter entities.
Disable external DTD loading.
Disable XInclude.
Disable expand entity references when applicable.
Set secure processing.
Set external access restrictions to empty string.
Use allowlisted resolver only if external resolution truly needed.
```

---

## 4. Entity Expansion Attack

Entity expansion menyerang CPU/memory parser.

Contoh klasik “Billion Laughs”:

```xml
<?xml version="1.0"?>
<!DOCTYPE lolz [
 <!ENTITY lol "lol">
 <!ENTITY lol1 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
 <!ENTITY lol2 "&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;">
 <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
]>
<lolz>&lol3;</lolz>
```

Input kecil bisa menghasilkan expansion besar.

### 4.1 Kenapa Secure Processing Saja Tidak Cukup

`XMLConstants.FEATURE_SECURE_PROCESSING` membantu mengaktifkan limit tertentu pada JAXP processor. Tetapi dalam desain security yang kuat, jangan hanya mengandalkan satu flag.

Gunakan kombinasi:

1. Reject `DOCTYPE` untuk untrusted XML.
2. Batasi ukuran input sebelum parser.
3. Batasi waktu processing.
4. Batasi depth.
5. Gunakan streaming jika payload besar.
6. Gunakan JAXP limits/system properties bila perlu.
7. Observability untuk parse error dan rejected payload.

### 4.2 Resource Exhaustion Lain

Selain entity expansion:

1. Deep nesting.
2. Huge text node.
3. Huge attribute value.
4. Many sibling elements.
5. Namespace abuse.
6. Large schema validation cost.
7. Expensive XPath.
8. Expensive XSLT.
9. Huge JAXB object graph.

XML security bukan hanya XXE.

---

## 5. Hardened DOM Parser

DOM memuat seluruh XML menjadi tree. Ini nyaman tetapi berisiko untuk payload besar.

### 5.1 Template Aman untuk DOM

```java
import org.w3c.dom.Document;
import org.xml.sax.InputSource;

import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import java.io.StringReader;

public final class SecureDomParser {

    public static Document parse(String xml) throws Exception {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();

        factory.setNamespaceAware(true);
        factory.setXIncludeAware(false);
        factory.setExpandEntityReferences(false);

        factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);

        // Reject DOCTYPE entirely.
        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);

        // Defense in depth. Some are redundant when DOCTYPE is rejected,
        // but useful across providers/configurations.
        factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
        factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
        factory.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);

        // JAXP external access restrictions.
        factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
        factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");

        DocumentBuilder builder = factory.newDocumentBuilder();
        builder.setEntityResolver((publicId, systemId) -> new InputSource(new StringReader("")));

        return builder.parse(new InputSource(new StringReader(xml)));
    }
}
```

### 5.2 Kenapa Ada Banyak Setting?

Karena XML processor memiliki beberapa jalan untuk external resolution:

1. General entity.
2. Parameter entity.
3. External DTD.
4. Schema location.
5. XInclude.
6. Resolver custom.
7. Provider-specific feature.

Satu flag tidak selalu menutup semua jalan.

### 5.3 Error Handling

Jangan kembalikan detail parser error mentah ke client.

Buruk:

```text
DOCTYPE is disallowed when the feature "http://apache.org/xml/features/disallow-doctype-decl" set to true.
```

Lebih baik:

```json
{
  "code": "INVALID_XML",
  "message": "XML payload is not accepted by the service contract."
}
```

Log internal boleh menyimpan kategori error, correlation id, dan sanitized parser message.

---

## 6. Hardened SAX Parser

SAX bersifat event-driven. Lebih memory efficient dibanding DOM, tetapi masih bisa vulnerable jika feature tidak dikunci.

```java
import org.xml.sax.InputSource;
import org.xml.sax.XMLReader;

import javax.xml.XMLConstants;
import javax.xml.parsers.SAXParser;
import javax.xml.parsers.SAXParserFactory;
import java.io.StringReader;

public final class SecureSaxFactory {

    public static XMLReader newReader() throws Exception {
        SAXParserFactory factory = SAXParserFactory.newInstance();
        factory.setNamespaceAware(true);
        factory.setXIncludeAware(false);
        factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
        factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
        factory.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);

        SAXParser parser = factory.newSAXParser();
        XMLReader reader = parser.getXMLReader();
        reader.setEntityResolver((publicId, systemId) -> new InputSource(new StringReader("")));
        return reader;
    }
}
```

### 6.1 SAX Security Invariant

Dengan SAX, kamu harus menjaga dua hal:

1. Parser tidak boleh resolve external resource.
2. Handler tidak boleh membangun unbounded state.

Contoh handler buruk:

```java
private final StringBuilder allText = new StringBuilder();

@Override
public void characters(char[] ch, int start, int length) {
    allText.append(ch, start, length); // unbounded memory growth
}
```

Lebih aman:

```java
private static final int MAX_TEXT = 10_000;
private final StringBuilder text = new StringBuilder();

@Override
public void characters(char[] ch, int start, int length) {
    if (text.length() + length > MAX_TEXT) {
        throw new IllegalStateException("XML text node too large");
    }
    text.append(ch, start, length);
}
```

---

## 7. Hardened StAX Parser

StAX adalah pull parser. Cocok untuk payload besar dan pipeline yang ingin mengambil sebagian data.

### 7.1 Template Aman untuk XMLInputFactory

```java
import javax.xml.XMLConstants;
import javax.xml.stream.XMLInputFactory;
import javax.xml.stream.XMLStreamReader;
import java.io.StringReader;

public final class SecureStaxParser {

    public static XMLStreamReader newReader(String xml) throws Exception {
        XMLInputFactory factory = XMLInputFactory.newFactory();

        factory.setProperty(XMLInputFactory.SUPPORT_DTD, false);
        factory.setProperty("javax.xml.stream.isSupportingExternalEntities", false);
        factory.setProperty(XMLInputFactory.IS_REPLACING_ENTITY_REFERENCES, false);
        factory.setProperty(XMLInputFactory.IS_SUPPORTING_EXTERNAL_ENTITIES, false);

        // Supported by JAXP-aware implementations.
        factory.setProperty(XMLConstants.ACCESS_EXTERNAL_DTD, "");

        return factory.createXMLStreamReader(new StringReader(xml));
    }
}
```

Catatan:

- Beberapa property StAX bisa bersifat provider-dependent.
- Test konfigurasi di runtime yang benar, bukan hanya compile-time.
- Untuk Java 8–25, dependency/provider bisa berbeda antara JDK, app server, dan library.

### 7.2 StAX Tidak Otomatis Aman

StAX mengurangi memory footprint, tetapi tidak otomatis menghilangkan:

1. XXE jika DTD/external entity aktif.
2. Deep nesting.
3. Huge text.
4. Infinite-like processing loop akibat handler salah.
5. Schema validation cost jika digabung dengan validator.

### 7.3 Depth Limit Manual

```java
int depth = 0;
int maxDepth = 64;

while (reader.hasNext()) {
    int event = reader.next();
    if (event == XMLStreamConstants.START_ELEMENT) {
        depth++;
        if (depth > maxDepth) {
            throw new IllegalStateException("XML depth limit exceeded");
        }
    } else if (event == XMLStreamConstants.END_ELEMENT) {
        depth--;
    }
}
```

Top engineer tidak hanya memilih StAX, tetapi juga menetapkan **budget parsing**.

---

## 8. JAXB / Jakarta XML Binding Security

JAXB/Jakarta XML Binding terlihat seperti object mapper:

```java
Customer customer = (Customer) unmarshaller.unmarshal(inputStream);
```

Tetapi di bawahnya tetap memakai XML parser. Artinya JAXB bisa terpapar risiko XML parser jika input source tidak dikontrol.

### 8.1 Jangan Unmarshal File/InputStream Mentah dari User

Kurang ideal:

```java
Unmarshaller unmarshaller = context.createUnmarshaller();
Customer customer = (Customer) unmarshaller.unmarshal(userInputStream);
```

Masalahnya: kamu menyerahkan parser setup ke runtime/provider path.

Lebih aman: buat parser aman sendiri, lalu berikan ke JAXB.

### 8.2 JAXB via Secure SAXSource

```java
import org.xml.sax.InputSource;
import org.xml.sax.XMLReader;

import javax.xml.bind.JAXBContext;
import javax.xml.bind.Unmarshaller;
import javax.xml.transform.sax.SAXSource;
import java.io.StringReader;

public final class SecureJaxbUnmarshaller {

    public static <T> T unmarshal(String xml, Class<T> type) throws Exception {
        JAXBContext context = JAXBContext.newInstance(type);
        Unmarshaller unmarshaller = context.createUnmarshaller();

        XMLReader reader = SecureSaxFactory.newReader();
        SAXSource source = new SAXSource(reader, new InputSource(new StringReader(xml)));

        Object result = unmarshaller.unmarshal(source);
        return type.cast(result);
    }
}
```

Untuk Jakarta namespace:

```java
import jakarta.xml.bind.JAXBContext;
import jakarta.xml.bind.Unmarshaller;
```

Konsepnya sama.

### 8.3 JAXB Object Graph Risk

JAXB bisa membentuk object graph besar dari input kecil-menengah.

Risiko:

1. List unbounded.
2. Deep nested object.
3. Unexpected optional element.
4. Wildcard `@XmlAnyElement` menerima konten tidak terduga.
5. `@XmlAnyAttribute` menerima atribut asing.
6. Validation tidak aktif sehingga object invalid masuk domain.
7. Validation aktif tetapi schema resolver tidak aman.

### 8.4 Validation Boundary

JAXB unmarshal bisa digabung dengan schema validation:

```java
SchemaFactory schemaFactory = SchemaFactory.newInstance(XMLConstants.W3C_XML_SCHEMA_NS_URI);
schemaFactory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
schemaFactory.setProperty(XMLConstants.ACCESS_EXTERNAL_DTD, "");
schemaFactory.setProperty(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");

Schema schema = schemaFactory.newSchema(localSchemaFile);

Unmarshaller unmarshaller = context.createUnmarshaller();
unmarshaller.setSchema(schema);
```

Tetapi hati-hati:

- `xsi:schemaLocation` dari input tidak boleh dipercaya.
- XSD import/include harus dikendalikan.
- Gunakan local/offline schema resolver.
- Jangan biarkan validator mengambil schema dari internet.

---

## 9. Schema Poisoning dan Remote XSD Retrieval

XML Schema validation sering dianggap aman karena “validasi kontrak”. Tetapi schema validation bisa menjadi attack surface.

Input bisa berisi:

```xml
<order xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
       xsi:schemaLocation="http://example.com/order http://attacker.com/order.xsd">
</order>
```

Jika validator mengikuti `schemaLocation`, ia bisa melakukan HTTP request ke attacker.

### 9.1 Risiko Schema Poisoning

1. SSRF.
2. Slow remote schema causing DoS.
3. Malicious schema with expensive validation.
4. Contract bypass jika schema attacker lebih permisif.
5. Import/include chain yang tidak terkendali.
6. Build/deployment nondeterminism.

### 9.2 Prinsip Aman Schema Validation

```text
Schema must be controlled by the application, not by the document sender.
```

Gunakan:

1. Local schema bundled with application.
2. Versioned schema registry internal.
3. Allowlisted namespace-to-XSD mapping.
4. `ACCESS_EXTERNAL_SCHEMA = ""`.
5. `ACCESS_EXTERNAL_DTD = ""`.
6. Custom `LSResourceResolver` yang hanya resolve resource lokal/allowlist.

### 9.3 Secure SchemaFactory

```java
import org.w3c.dom.ls.LSInput;
import org.w3c.dom.ls.LSResourceResolver;

import javax.xml.XMLConstants;
import javax.xml.validation.Schema;
import javax.xml.validation.SchemaFactory;
import java.io.File;

public final class SecureSchemaLoader {

    public static Schema load(File xsd) throws Exception {
        SchemaFactory factory = SchemaFactory.newInstance(XMLConstants.W3C_XML_SCHEMA_NS_URI);
        factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
        factory.setProperty(XMLConstants.ACCESS_EXTERNAL_DTD, "");
        factory.setProperty(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
        factory.setResourceResolver(new DenyAllResourceResolver());
        return factory.newSchema(xsd);
    }

    static final class DenyAllResourceResolver implements LSResourceResolver {
        @Override
        public LSInput resolveResource(
                String type,
                String namespaceURI,
                String publicId,
                String systemId,
                String baseURI
        ) {
            throw new IllegalArgumentException("External schema resolution is disabled: " + systemId);
        }
    }
}
```

Jika butuh import schema:

```text
namespace URI -> local classpath resource
```

Bukan:

```text
namespace URI -> remote URL
```

---

## 10. XInclude Risk

XInclude memungkinkan dokumen XML memasukkan dokumen lain.

Contoh:

```xml
<root xmlns:xi="http://www.w3.org/2001/XInclude">
  <xi:include href="file:///etc/passwd" parse="text"/>
</root>
```

Jika XInclude aktif, parser bisa membaca file/resource eksternal.

Defense:

```java
factory.setXIncludeAware(false);
```

Jangan aktifkan XInclude untuk untrusted XML kecuali ada kebutuhan kuat, resolver allowlist, dan sandbox.

---

## 11. XPath Injection

XPath injection terjadi saat input user digabung menjadi XPath expression.

Buruk:

```java
String expr = "/users/user[name='" + username + "' and password='" + password + "']";
Node node = (Node) xpath.evaluate(expr, doc, XPathConstants.NODE);
```

Jika user memasukkan:

```text
' or '1'='1
```

Expression bisa berubah makna.

### 11.1 XPath Injection Mental Model

XPath adalah query language. Jika string user masuk ke query tanpa escaping/binding, ini mirip SQL injection.

Masalahnya Java XPath API standar tidak punya parameter binding yang sekuat prepared statement SQL. Jadi desain harus hati-hati.

### 11.2 Defense XPath

1. Hindari dynamic XPath dari user input.
2. Gunakan allowlist untuk element/attribute names.
3. Jangan izinkan user memasukkan raw XPath.
4. Jika hanya mencari value, traversal DOM/StAX manual sering lebih aman.
5. Jika harus dynamic, implement escaping literal XPath dengan benar.
6. Batasi ukuran document dan kompleksitas query.

### 11.3 Safe-ish XPath Literal Builder

XPath 1.0 tidak punya escaping quote sederhana seperti banyak bahasa. Jika string mengandung single dan double quote, gunakan `concat()`.

```java
public static String xpathLiteral(String value) {
    if (!value.contains("'")) {
        return "'" + value + "'";
    }
    if (!value.contains("\"")) {
        return "\"" + value + "\"";
    }

    StringBuilder sb = new StringBuilder("concat(");
    String[] parts = value.split("'");
    for (int i = 0; i < parts.length; i++) {
        if (i > 0) {
            sb.append(", \"'\", ");
        }
        sb.append("'").append(parts[i]).append("'");
    }
    sb.append(")");
    return sb.toString();
}
```

Tetap lebih baik menghindari dynamic XPath jika bisa.

---

## 12. XSLT Security

XSLT adalah transformation language. Ia bisa mahal secara CPU dan, tergantung processor/config, bisa mengakses external resource lewat `document()`, import/include stylesheet, extension function, dan URI resolver.

### 12.1 Risiko XSLT

1. SSRF via `document('http://internal/...')`.
2. Local file read via `document('file:///...')`.
3. Remote stylesheet import.
4. Expensive transformation causing DoS.
5. Extension function abuse.
6. Output injection jika hasil XSLT dirender ke HTML/email.

### 12.2 Secure TransformerFactory

```java
import javax.xml.XMLConstants;
import javax.xml.transform.TransformerFactory;
import javax.xml.transform.URIResolver;
import javax.xml.transform.Source;

public final class SecureXslt {

    public static TransformerFactory newFactory() throws Exception {
        TransformerFactory factory = TransformerFactory.newInstance();
        factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
        factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
        factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_STYLESHEET, "");
        factory.setURIResolver(new DenyAllUriResolver());
        return factory;
    }

    static final class DenyAllUriResolver implements URIResolver {
        @Override
        public Source resolve(String href, String base) {
            throw new IllegalArgumentException("External XSLT resource resolution is disabled: " + href);
        }
    }
}
```

### 12.3 XSLT Governance

Untuk enterprise system:

| Scenario | Recommendation |
|---|---|
| Stylesheet bundled in app | Acceptable dengan secure factory |
| Stylesheet uploaded by user | Avoid; isolate/sandbox if unavoidable |
| Stylesheet from partner | Treat as code, not data |
| Dynamic XSLT from DB | Version, review, sign, restrict resolver |
| XSLT output to HTML | Output encode / sanitize according to sink |

Prinsip:

> XSLT is executable transformation logic. Treat it as code.

---

## 13. XML Signature and XML Signature Wrapping

XML Signature bertujuan memastikan integritas dan authenticity bagian XML.

Tetapi XML Signature tidak otomatis berarti:

```text
The business object used by application is the signed object.
```

Di sinilah XML Signature Wrapping terjadi.

### 13.1 Signature Wrapping Mental Model

Serangan wrapping memanfaatkan perbedaan antara:

1. Element yang diverifikasi oleh signature verifier.
2. Element yang dibaca oleh business logic.

Contoh sederhana:

```xml
<Envelope>
  <Header>
    <Signature>
      <!-- Signature references Body Id="signed-body" -->
    </Signature>
  </Header>

  <Body Id="attacker-body">
    <transfer>
      <amount>1000000</amount>
    </transfer>
  </Body>

  <Wrapper>
    <Body Id="signed-body">
      <transfer>
        <amount>10</amount>
      </transfer>
    </Body>
  </Wrapper>
</Envelope>
```

Verifier mungkin berkata:

```text
Signature valid for element Id="signed-body".
```

Business code mungkin membaca:

```text
/Envelope/Body
```

Yang ternyata attacker-body.

### 13.2 Anti-Pattern

```java
boolean valid = verifySignature(document);
if (valid) {
    Element body = (Element) xpath.evaluate("/Envelope/Body", document, XPathConstants.NODE);
    process(body);
}
```

Ini berbahaya karena signature verification dan data selection tidak terikat.

### 13.3 Secure Principle

```text
Process exactly what was verified.
```

Setelah signature diverifikasi, application harus mendapatkan reference ke signed element yang diverifikasi, lalu memproses element itu, bukan mencari ulang lewat XPath global yang longgar.

### 13.4 XML Signature Hardening Checklist

1. Gunakan library WS-Security/XMLSec yang matang, bukan implementasi manual.
2. Disable external URI resolution.
3. Jangan izinkan signature reference ke remote URI.
4. Require same-document reference jika sesuai kontrak.
5. Require expected signed element type dan location.
6. Bind verification result ke node yang diproses.
7. Reject duplicate ID attributes.
8. Reject unexpected duplicate body/header elements.
9. Validate SOAP structure before and after security processing.
10. Enforce algorithm policy.
11. Enforce certificate/key trust policy.
12. Check timestamp/replay jika protocol membutuhkan.
13. Log signature subject, key id, algorithm, reference URI, dan correlation id.

### 13.5 “See What Is Signed”

Prinsip penting dari praktik XML Signature adalah aplikasi harus mampu menentukan **apa yang benar-benar ditandatangani** dan memastikan itulah yang digunakan.

Jangan hanya berpikir:

```text
signature valid = message trusted
```

Pikirkan:

```text
which exact nodes are signed?
are these nodes the nodes my business logic will use?
are unsigned nodes ignored or constrained?
```

---

## 14. SOAP-Specific XML Security

SOAP membawa XML security ke tingkat protokol.

### 14.1 SOAP Attack Surface

1. Envelope parsing.
2. Header processing.
3. Body processing.
4. Fault processing.
5. Attachment processing.
6. WS-Security header.
7. WS-Addressing header.
8. mustUnderstand semantics.
9. actor/role semantics.
10. Intermediary behavior.
11. MTOM/XOP external/binary payload.

### 14.2 SOAP Header Confusion

SOAP header bisa membawa authentication, routing, transaction id, correlation id, dan policy metadata.

Risiko:

1. Header yang harus dipahami diabaikan.
2. Header duplicate.
3. Header untuk role tertentu diproses oleh role salah.
4. Security header valid tetapi body yang diproses bukan body signed.
5. Unsigned header memengaruhi business decision.

### 14.3 SOAP Defensive Invariants

Untuk endpoint SOAP modern/legacy:

```text
Only one Envelope.
Only one Header in expected location.
Only one Body in expected location.
Reject duplicate security-critical headers.
Require expected namespace.
Require expected SOAP version.
Require signed body if contract says so.
Require signed security-critical headers.
Process only verified nodes.
Reject unknown mustUnderstand headers targeted to this endpoint.
```

---

## 15. Secure Parser Matrix Java 8–25

| API | External resolution risk | Resource risk | Key controls |
|---|---:|---:|---|
| DOM | High | High | Disable DOCTYPE/entities, secure processing, input size, depth via post-check |
| SAX | High | Medium | Disable DOCTYPE/entities, secure handler state |
| StAX | High | Medium | Disable DTD/external entities, manual limits |
| JAXB | Depends on source | High | Use secure SAX/StAX source, schema allowlist, object graph limits |
| SchemaFactory | High | High | Disable external schema/DTD, local resolver |
| XPath | Low external, high logic | Medium | Avoid dynamic expressions, escape literals, allowlist |
| XSLT | High | High | Secure processing, disable external stylesheet/DTD, deny URI resolver |
| XML Signature | High logic | High | No external references, process signed nodes, algorithm/trust policy |
| SOAP stack | Depends | High | WS-Security hardening, parser config, structural validation |

---

## 16. JAXP External Access Properties

JAXP menyediakan properti untuk membatasi akses eksternal.

Yang umum:

```java
XMLConstants.ACCESS_EXTERNAL_DTD
XMLConstants.ACCESS_EXTERNAL_SCHEMA
XMLConstants.ACCESS_EXTERNAL_STYLESHEET
```

Nilai:

```java
""       // deny all
"file"   // allow file
"http"   // allow http
"file,http" // allow file and http
"all"    // allow all, avoid for untrusted input
```

Untuk untrusted XML, default aman adalah:

```java
factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_STYLESHEET, "");
```

Tidak semua factory mendukung semua attribute. Karena itu, security bootstrap harus fail-fast.

Buruk:

```java
try {
    factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
} catch (Exception ignored) {
}
```

Lebih baik:

```java
try {
    factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
} catch (IllegalArgumentException ex) {
    throw new IllegalStateException("XML parser does not support required security property", ex);
}
```

Jika runtime tidak mendukung security property yang dibutuhkan, jangan diam-diam lanjut.

---

## 17. Input Size, Time Budget, and Isolation

Parser configuration bukan satu-satunya defense. XML payload perlu budget.

### 17.1 Pre-Parse Budget

Sebelum parsing:

1. Batasi request body size di reverse proxy/API gateway.
2. Batasi upload size di application.
3. Reject compressed payload yang bisa decompression bomb.
4. Batasi content type.
5. Batasi encoding jika contract memungkinkan.
6. Gunakan timeout request.

### 17.2 Parse Budget

Saat parsing:

1. Max depth.
2. Max elements.
3. Max attributes per element.
4. Max text length.
5. Max total characters.
6. Max processing time.
7. Max errors.

Tidak semua bisa dilakukan oleh parser default. Kadang perlu wrapper/handler manual.

### 17.3 Isolation

Untuk XML dari partner high-risk:

1. Parse di worker terisolasi.
2. Jalankan dengan memory limit/container limit.
3. Disable outbound network.
4. Gunakan egress policy.
5. Gunakan temporary filesystem minimal.
6. Scan/log anomaly.

Security terbaik adalah kombinasi:

```text
Parser hardening + resource budget + network isolation + contract validation + business validation
```

---

## 18. Secure XML Ingestion Pipeline

Pipeline yang defensible:

```text
HTTP/MQ/File Input
   │
   ├── Transport-level limit
   │     - max body size
   │     - timeout
   │     - content-type
   │     - authn/authz
   │
   ├── Raw input guard
   │     - reject too large
   │     - reject unsupported encoding
   │     - optional cheap DOCTYPE precheck
   │
   ├── Hardened parser
   │     - no DOCTYPE
   │     - no external entities
   │     - no XInclude
   │     - no external DTD/schema
   │
   ├── Structural validation
   │     - expected root namespace/name
   │     - expected version
   │     - local schema only if needed
   │
   ├── Security validation
   │     - signature verification if applicable
   │     - process signed nodes only
   │     - replay/timestamp if applicable
   │
   ├── Binding
   │     - JAXB DTO boundary
   │     - no domain object direct mutation
   │
   ├── Business validation
   │     - invariant check
   │     - authorization check
   │
   └── Processing
         - idempotency
         - audit
         - error mapping
```

### 18.1 Cheap DOCTYPE Precheck?

A precheck like this can be useful as defense-in-depth:

```java
if (xml.contains("<!DOCTYPE")) {
    throw new InvalidPayloadException("DOCTYPE is not allowed");
}
```

Tetapi jangan menjadikannya satu-satunya defense.

Alasan:

1. Encoding tricks.
2. Whitespace/case variations.
3. Input streaming.
4. Parser sees canonical character stream differently.

Parser config tetap wajib.

---

## 19. Configuration Differences: Javax vs Jakarta

XML parser API JAXP tetap berada di JDK module `java.xml`:

```java
javax.xml.parsers.DocumentBuilderFactory
javax.xml.parsers.SAXParserFactory
javax.xml.stream.XMLInputFactory
javax.xml.validation.SchemaFactory
javax.xml.transform.TransformerFactory
javax.xml.xpath.XPathFactory
```

JAXB berubah namespace:

Java EE / JAXB lama:

```java
javax.xml.bind.JAXBContext
javax.xml.bind.Unmarshaller
```

Jakarta XML Binding:

```java
jakarta.xml.bind.JAXBContext
jakarta.xml.bind.Unmarshaller
```

Namun security principle sama:

```text
Do not let binding layer decide unsafe parser behavior for untrusted input.
Feed JAXB with secured SAXSource/StAXSource.
```

### 19.1 Java 8 vs Java 11+

Di Java 8, JAXB/JAX-WS dahulu banyak diasumsikan tersedia dari JDK. Di Java 11+, Java EE/CORBA modules dihapus dari JDK, sehingga JAXB/JAX-WS/SAAJ perlu dependency eksplisit.

Konsekuensi security:

1. Provider bisa berubah ketika migrasi Java.
2. Default behavior bisa berubah.
3. Feature support bisa berbeda.
4. Classpath/module path bisa memuat parser/provider berbeda.
5. App server bisa override provider.

Karena itu, buat automated security tests untuk XML parser behavior.

---

## 20. Security Regression Tests

Jangan percaya konfigurasi tanpa test.

### 20.1 Test XXE Ditolak

```java
@Test
void rejectsDoctype() {
    String xml = """
            <?xml version="1.0"?>
            <!DOCTYPE data [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>
            <data>&xxe;</data>
            """;

    assertThrows(Exception.class, () -> SecureDomParser.parse(xml));
}
```

### 20.2 Test External HTTP Tidak Dipanggil

Gunakan mock HTTP server lokal. Jika parser mencoba fetch DTD/schema/entity, test harus gagal.

```xml
<!DOCTYPE data SYSTEM "http://127.0.0.1:9999/evil.dtd">
<data>Hello</data>
```

Expected:

```text
No outbound request is made.
Parse fails or ignores external resource according to policy.
```

### 20.3 Test Deep Nesting Ditolak

```xml
<a><a><a>... repeated ...</a></a></a>
```

Expected:

```text
Reject when depth > configured maximum.
```

### 20.4 Test Schema Location Tidak Diikuti

```xml
<root xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
      xsi:noNamespaceSchemaLocation="http://127.0.0.1:9999/evil.xsd">
</root>
```

Expected:

```text
No remote schema retrieval.
```

### 20.5 Test Signature Wrapping

Untuk SOAP/XML Signature system:

1. Valid signed node dipindah ke wrapper.
2. Attacker-controlled body diletakkan di normal path.
3. Signature verifier mungkin valid.
4. Business logic harus tetap menolak karena expected body bukan signed node.

Expected:

```text
Reject wrapped signature message.
```

---

## 21. Error Handling and Observability

### 21.1 Error Taxonomy

Buat kategori error yang stabil:

| Code | Meaning |
|---|---|
| `XML_TOO_LARGE` | Raw payload melewati batas |
| `XML_INVALID_SYNTAX` | XML tidak well-formed |
| `XML_DOCTYPE_FORBIDDEN` | DOCTYPE/entity declaration ditolak |
| `XML_EXTERNAL_RESOURCE_FORBIDDEN` | External DTD/schema/stylesheet/resource ditolak |
| `XML_SCHEMA_INVALID` | Tidak sesuai XSD lokal |
| `XML_SIGNATURE_INVALID` | Signature gagal |
| `XML_SIGNATURE_SCOPE_INVALID` | Signature valid tapi node/scope salah |
| `XML_UNSUPPORTED_VERSION` | Root/version tidak sesuai kontrak |
| `XML_DEPTH_LIMIT_EXCEEDED` | Terlalu dalam |
| `XML_TRANSFORM_FORBIDDEN` | XSLT/resource tidak diizinkan |

### 21.2 Log yang Aman

Log:

1. Correlation id.
2. Partner/system id.
3. Endpoint/operation.
4. Error category.
5. Parser stage.
6. Payload size.
7. Root element jika aman.
8. Namespace jika aman.
9. Signature key/cert subject jika applicable.
10. Rejection reason.

Jangan log:

1. Full XML mentah dari production.
2. Secrets dari entity expansion.
3. PII tanpa masking.
4. Certificate private data.
5. Access token di SOAP header.

### 21.3 Audit vs Debug

Untuk regulatory/enterprise system, simpan audit bahwa payload ditolak dan kenapa, tetapi jangan simpan seluruh malicious payload tanpa retention/encryption policy.

---

## 22. Secure Defaults as Shared Infrastructure

Jangan biarkan setiap team membuat parser sendiri.

Buat shared module:

```text
company-xml-security
   ├── SecureDocumentBuilderFactory
   ├── SecureSaxParserFactory
   ├── SecureXmlInputFactory
   ├── SecureSchemaFactory
   ├── SecureTransformerFactory
   ├── SecureJaxbUnmarshaller
   ├── XmlBudget
   ├── XmlSecurityException
   └── XmlSecurityTests
```

### 22.1 Example API Design

```java
public interface XmlParserPolicy {
    boolean allowDoctype();
    boolean allowExternalDtd();
    boolean allowExternalSchema();
    boolean allowXInclude();
    int maxDepth();
    long maxBytes();
}
```

Policies:

```text
UNTRUSTED_EXTERNAL_XML
TRUSTED_INTERNAL_CONFIG
SOAP_WITH_WS_SECURITY
OFFLINE_SCHEMA_VALIDATION
```

Jangan hanya punya boolean random di application code.

### 22.2 Fail Closed

Jika security setting gagal diterapkan:

```text
Application startup should fail.
```

Bukan:

```text
Continue with warning.
```

Karena warning sering hilang di production logs.

---

## 23. Review Checklist untuk Code Review

Gunakan checklist ini ketika melihat kode XML.

### 23.1 Parser Construction

- [ ] Apakah parser dibuat dari shared secure factory?
- [ ] Apakah `DOCTYPE` ditolak untuk untrusted XML?
- [ ] Apakah external general entities dimatikan?
- [ ] Apakah external parameter entities dimatikan?
- [ ] Apakah external DTD loading dimatikan?
- [ ] Apakah XInclude dimatikan?
- [ ] Apakah secure processing aktif?
- [ ] Apakah `ACCESS_EXTERNAL_DTD` dikunci?
- [ ] Apakah `ACCESS_EXTERNAL_SCHEMA` dikunci?
- [ ] Apakah `ACCESS_EXTERNAL_STYLESHEET` dikunci untuk XSLT?
- [ ] Apakah resolver deny-by-default atau allowlist?
- [ ] Apakah setting failure membuat startup/request fail?

### 23.2 Input Budget

- [ ] Ada max request/body size?
- [ ] Ada timeout?
- [ ] Ada depth limit?
- [ ] Ada text length limit?
- [ ] Ada list/object graph limit setelah binding?
- [ ] Ada decompression bomb control?

### 23.3 Schema Validation

- [ ] Schema berasal dari aplikasi/registry internal?
- [ ] `xsi:schemaLocation` dari input tidak dipercaya?
- [ ] Import/include schema di-resolve lokal?
- [ ] External schema access disabled?

### 23.4 JAXB

- [ ] JAXB diberi `SAXSource`/`StAXSource` aman?
- [ ] Tidak unmarshal langsung dari untrusted `File`/`InputStream` tanpa parser control?
- [ ] Ada validation boundary?
- [ ] Wildcard mapping dikendalikan?
- [ ] DTO tidak langsung menjadi domain aggregate mutable?

### 23.5 XPath/XSLT

- [ ] Tidak ada raw user input ke XPath?
- [ ] XPath element/attribute names allowlisted?
- [ ] XSLT stylesheet trusted/versioned?
- [ ] External stylesheet/resource disabled?
- [ ] URIResolver aman?

### 23.6 XML Signature/SOAP

- [ ] Signature verification mengembalikan signed node/scope?
- [ ] Business logic memproses signed node, bukan XPath global ulang?
- [ ] Duplicate ID ditolak?
- [ ] Duplicate Body/Header ditolak?
- [ ] Expected namespaces enforced?
- [ ] External URI reference disabled?
- [ ] Algorithm policy enforced?
- [ ] Replay/timestamp handled jika perlu?

---

## 24. Common Misconceptions

### Misconception 1: “Kami pakai JAXB, bukan parser XML manual, jadi aman.”

Salah. JAXB tetap menggunakan parser XML di bawahnya.

### Misconception 2: “XML kami hanya internal.”

Internal bukan berarti trusted. Internal payload bisa berasal dari compromised system, old batch job, replayed message, misconfigured queue, atau partner tunnel.

### Misconception 3: “Kami sudah pakai HTTPS.”

HTTPS melindungi transport. XXE, entity expansion, XPath injection, dan signature wrapping terjadi setelah payload sampai.

### Misconception 4: “Schema validation membuat XML aman.”

Schema validation hanya memvalidasi struktur/type sesuai schema. Ia tidak otomatis mencegah external schema retrieval, resource exhaustion, atau malicious-but-valid business data.

### Misconception 5: “Signature valid berarti seluruh dokumen aman.”

Signature valid hanya berarti bagian tertentu sesuai reference signature. Application harus memastikan bagian yang digunakan adalah bagian yang ditandatangani.

### Misconception 6: “Disable external entities cukup.”

Belum tentu. Masih ada DOCTYPE, parameter entities, external DTD, schemaLocation, XInclude, XSLT document/import, dan signature URI.

---

## 25. Practical Decision Matrix

| Input Type | Recommended Processing |
|---|---|
| Small trusted config file bundled in app | DOM boleh, secure processing tetap baik |
| External XML API payload | Hardened SAX/StAX/DOM dengan DOCTYPE off |
| Large external XML file | StAX/SAX streaming + budget + local schema optional |
| SOAP with WS-Security | Mature SOAP/WS-Security stack + structural validation + signature scope check |
| Partner XML batch | Isolated ingestion worker + local XSD + audit + retry quarantine |
| User-uploaded XSLT | Avoid; if unavoidable, sandbox and no external resolver |
| User-supplied XPath | Avoid; use allowlisted query features instead |
| XML needing schema import | Local allowlisted resolver |
| Signed XML document | Verify signature and process verified nodes only |

---

## 26. Top 1% Engineering Perspective

Engineer biasa menghafal:

```text
Disable XXE.
```

Engineer kuat memahami:

```text
XML processor is a capability-bearing interpreter.
Every capability must be deliberately enabled, constrained, tested, and observable.
```

Engineer top 1% akan mendesain:

1. Secure XML factory sebagai shared module.
2. Automated security regression tests untuk parser behavior.
3. Local schema registry.
4. No external resolver by default.
5. Signature scope binding.
6. Input budget.
7. Safe error taxonomy.
8. Isolation untuk partner/batch high risk.
9. Runtime verification pada startup.
10. Migration checklist Java 8 → 11+ → 17/21/25.

---

## 27. Latihan Praktis

### Latihan 1 — Harden Parser

Buat utility:

```java
SecureXmlParsers.newDocumentBuilderFactory()
SecureXmlParsers.newSaxParserFactory()
SecureXmlParsers.newXmlInputFactory()
SecureXmlParsers.newSchemaFactory()
SecureXmlParsers.newTransformerFactory()
```

Requirement:

1. Fail-fast jika feature tidak didukung.
2. Disable external access.
3. Unit test XXE.
4. Unit test entity expansion.
5. Unit test remote schema access.

### Latihan 2 — Secure JAXB

Buat `SecureXmlBinder<T>`:

```java
public interface SecureXmlBinder<T> {
    T read(String xml);
    String write(T value);
}
```

Requirement:

1. Unmarshal via secure SAXSource/StAXSource.
2. Optional local schema validation.
3. Max payload size.
4. Reject DOCTYPE.
5. Map parser error ke error code stabil.

### Latihan 3 — Signature Wrapping Thought Exercise

Diberikan SOAP message dengan:

1. Signed body di wrapper.
2. Unsigned body di normal path.
3. Signature valid.

Desain verifier API yang mencegah business code memproses unsigned body.

Contoh API lebih aman:

```java
VerifiedSoapMessage verified = verifier.verify(rawXml);
Element signedBody = verified.requireSignedBody();
OrderRequest request = binder.unmarshal(signedBody, OrderRequest.class);
```

Bukan:

```java
if (verifier.verify(rawXml)) {
    OrderRequest request = xpathReadBody(rawXml);
}
```

---

## 28. Ringkasan

XML security sulit karena XML bukan hanya data tree sederhana. XML membawa mekanisme interpretasi: DTD, entity, namespace, schema, include, XPath, XSLT, binding, signature, dan SOAP headers.

Prinsip utama:

1. Treat all external XML as untrusted.
2. Disable what you do not need.
3. Reject DOCTYPE for untrusted XML.
4. Disable external entity/resource resolution.
5. Use local schemas, not sender-provided schemas.
6. Treat XSLT as code.
7. Avoid dynamic XPath.
8. Feed JAXB with secured parser sources.
9. Bind signature verification to the exact nodes being processed.
10. Add input budget, tests, logging, and operational isolation.

Jika Part 12–14 membangun pemahaman XML dan XSD sebagai model dokumen/kontrak, Part 15 ini membangun pemahaman bahwa setiap XML processing pipeline harus diperlakukan sebagai **security-critical interpreter pipeline**.

---

## 29. Status Seri

Seri belum selesai.

Kita telah menyelesaikan:

- Part 0 — Orientation & Mental Model
- Part 1 — Data Format as Contract
- Part 2 — Java JSON Ecosystem Map
- Part 3 — JSON-P Core Mental Model
- Part 4 — JSON-P Streaming Deep Dive
- Part 5 — JSON-P Transformation & Mutation
- Part 6 — JSON-P Advanced Production Patterns
- Part 7 — JSON-B Core Model
- Part 8 — JSON-B Annotation Deep Dive
- Part 9 — JSON-B Customization & Provider Internals
- Part 10 — JSON-B for Enterprise DTO Design
- Part 11 — JSON Security & Robustness
- Part 12 — XML Fundamentals for Java Engineers
- Part 13 — XML Parsing Models: DOM, SAX, StAX, XPath, XSLT
- Part 14 — XML Schema / XSD Deep Dive
- Part 15 — XML Security

Berikutnya:

- Part 16 — JAXB / Jakarta XML Binding Core

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 14 — XML Schema / XSD Deep Dive](./learn-java-json-xml-soap-connectors-enterprise-integration-part-014.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 16 — JAXB / Jakarta XML Binding Core](./learn-java-json-xml-soap-connectors-enterprise-integration-part-016.md)
