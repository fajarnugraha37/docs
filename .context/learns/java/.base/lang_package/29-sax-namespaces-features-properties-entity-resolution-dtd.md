# Part 29 — SAX Namespaces, Features, Properties, Entity Resolution, DTD Handling

> Series: `learn-java-lang-dom-sax-core-runtime-platform-contracts`  
> File: `29-sax-namespaces-features-properties-entity-resolution-dtd.md`  
> Scope: Java 8–25, `org.xml.sax.*`, `org.xml.sax.ext.*`, `org.xml.sax.helpers.*`, and the JAXP bridge needed to configure SAX parsers safely.

---

## 1. Tujuan Part Ini

Pada Part 28 kita membangun mental model SAX sebagai **push/event parser**: parser membaca XML, lalu memanggil handler aplikasi. Part 29 memperdalam bagian yang biasanya menjadi sumber bug production: **namespace**, **feature/property negotiation**, **entity resolution**, dan **DTD handling**.

Target setelah bagian ini:

1. Kamu memahami bahwa SAX bukan hanya `startElement()` dan `characters()`, tetapi sebuah **kontrak parser configurable**.
2. Kamu bisa membedakan:
   - SAX1 vs SAX2;
   - namespace-aware vs non-namespace-aware;
   - feature vs property;
   - entity resolution vs validation;
   - DTD declaration callbacks vs lexical callbacks;
   - parser capability vs application assumption.
3. Kamu bisa mendesain SAX parser pipeline yang:
   - eksplisit konfigurasi namespace;
   - tidak bergantung pada prefix secara rapuh;
   - tidak diam-diam mengambil external resource;
   - bisa gagal cepat ketika parser tidak mendukung feature penting;
   - aman untuk workload enterprise/regulatory.
4. Kamu bisa membaca error seperti `SAXNotRecognizedException`, `SAXNotSupportedException`, `SAXParseException`, namespace mismatch, dan DTD/entity behavior tanpa menebak-nebak.

Dokumentasi Java SE 25 menyatakan `org.xml.sax` menyediakan interface untuk Simple API for XML dan mendukung SAX1/SAX2; helper class tersedia di `org.xml.sax.helpers`, sedangkan extension seperti `EntityResolver2`, `LexicalHandler`, dan `DeclHandler` tersedia melalui `org.xml.sax.ext`. Sumber resmi juga menekankan bahwa sebagian API lama SAX1 sudah deprecated karena aplikasi SAX2 seharusnya memakai model namespace-aware.

---

## 2. Mental Model Utama

### 2.1 SAX parser adalah mesin dengan mode

Jangan melihat SAX parser sebagai fungsi:

```java
parse(xml, handler);
```

Model yang lebih akurat:

```text
InputSource
   ↓
XMLReader / SAXParser
   ↓ configured by features/properties
   ↓ resolves external entities if allowed
   ↓ expands or reports DTD/entity events depending on configuration
   ↓ emits namespace-aware or non-namespace-aware events
   ↓
ContentHandler / ErrorHandler / EntityResolver / DTDHandler / extension handlers
```

Artinya, hasil handler sangat dipengaruhi oleh konfigurasi parser.

Dokumen XML yang sama bisa menghasilkan event berbeda jika:

- namespace processing aktif/nonaktif;
- namespace prefix reporting aktif/nonaktif;
- DTD validation aktif/nonaktif;
- external entity loading aktif/nonaktif;
- lexical handler dipasang/tidak;
- entity resolver memblokir/meredirect external resource;
- parser implementation berbeda.

### 2.2 Namespace adalah identity model, bukan formatting

XML namespace bukan sekadar prefix.

Contoh:

```xml
<a:case xmlns:a="urn:agency:case">123</a:case>
<b:case xmlns:b="urn:agency:case">123</b:case>
```

Secara namespace-aware, dua element di atas adalah **element yang sama secara expanded name**:

```text
namespace URI = urn:agency:case
local name    = case
```

Prefix `a` dan `b` hanyalah lexical alias.

Bug serius muncul ketika kode melakukan ini:

```java
if (qName.equals("a:case")) { ... }
```

Kode tersebut rapuh karena prefix dapat berubah tanpa mengubah meaning XML.

Kode yang lebih benar:

```java
if ("urn:agency:case".equals(uri) && "case".equals(localName)) {
    ...
}
```

### 2.3 Feature adalah switch; property adalah slot data

Dalam SAX:

- **feature** biasanya boolean: aktif/nonaktif;
- **property** biasanya object value: handler tambahan, schema language, schema source, custom setting.

Contoh feature:

```java
reader.setFeature("http://xml.org/sax/features/namespaces", true);
reader.setFeature("http://xml.org/sax/features/namespace-prefixes", false);
```

Contoh property:

```java
reader.setProperty(
    "http://xml.org/sax/properties/lexical-handler",
    lexicalHandler
);
```

Feature/property adalah kontrak negosiasi dengan parser. Tidak semua parser mengenali semua URI. Tidak semua parser bisa mengubah feature dalam semua fase lifecycle.

### 2.4 Entity resolution adalah I/O boundary

Ketika XML mengandung DOCTYPE atau external entity, parser bisa mencoba membuka file, URL, classpath resource, network resource, atau system identifier lain.

Contoh:

```xml
<!DOCTYPE data SYSTEM "https://example.com/data.dtd">
<data>...</data>
```

Tanpa kontrol, parsing XML bisa berubah menjadi operasi network/file I/O. Ini bukan detail kecil. Ini adalah boundary keamanan, availability, dan determinism.

Di sistem production, terutama yang menerima XML dari pihak luar, entity resolution harus diperlakukan seperti:

```text
untrusted input → potential file read / SSRF / delay / expansion bomb / nondeterministic dependency
```

Part 30 akan membahas secure XML parsing lebih dalam. Part 29 membangun fondasi mekanismenya.

---

## 3. SAX1 vs SAX2: Kenapa Ini Masih Perlu Dipahami

### 3.1 SAX1: model lama

SAX1 berpusat pada interface seperti:

- `org.xml.sax.Parser`
- `org.xml.sax.DocumentHandler`
- `org.xml.sax.AttributeList`
- `org.xml.sax.HandlerBase`

Masalah utama SAX1: tidak didesain dengan namespace processing modern sebagai pusat.

Karena itu, di Java modern banyak API SAX1 dianggap legacy/deprecated.

### 3.2 SAX2: model modern

SAX2 berpusat pada:

- `XMLReader`
- `ContentHandler`
- `Attributes`
- `EntityResolver`
- `DTDHandler`
- `ErrorHandler`
- `DefaultHandler`
- feature/property API

SAX2 memperkenalkan namespace-aware parsing dan konfigurasi melalui URI feature/property.

### 3.3 Rule praktis

Untuk kode baru:

```text
Gunakan XMLReader / SAXParserFactory / DefaultHandler.
Jangan gunakan Parser / DocumentHandler / AttributeList / HandlerBase.
```

Legacy API hanya perlu dipahami ketika membaca kode lama atau library lama.

---

## 4. Jalur Instansiasi Parser: `SAXParserFactory`, `SAXParser`, `XMLReader`

Di Java, biasanya kamu tidak membuat implementation parser langsung. Kamu memakai JAXP bridge:

```java
SAXParserFactory factory = SAXParserFactory.newInstance();
factory.setNamespaceAware(true);
factory.setValidating(false);

SAXParser parser = factory.newSAXParser();
XMLReader reader = parser.getXMLReader();
```

### 4.1 Kenapa tidak langsung `XMLReaderFactory`?

`XMLReaderFactory` ada di `org.xml.sax.helpers`, tetapi pendekatan umum di Java SE/JAXP adalah memakai `SAXParserFactory`.

Keuntungan `SAXParserFactory`:

- mengikuti mekanisme provider JAXP;
- umum di Java enterprise;
- mendukung konfigurasi high-level seperti namespace aware dan validating;
- bisa dikombinasikan dengan feature/property lower-level pada `XMLReader`.

### 4.2 Layer konfigurasi

Ada dua level konfigurasi:

```text
SAXParserFactory
  - setNamespaceAware(boolean)
  - setValidating(boolean)
  - setFeature(name, value)
  - setSchema(schema)
  - setXIncludeAware(boolean), jika didukung

XMLReader
  - setFeature(name, value)
  - getFeature(name)
  - setProperty(name, value)
  - getProperty(name)
  - setContentHandler(...)
  - setErrorHandler(...)
  - setEntityResolver(...)
  - setDTDHandler(...)
```

Untuk production, konfigurasi idealnya dilakukan sebelum parsing dimulai.

---

## 5. Namespace Processing dalam SAX

### 5.1 Parameter `startElement`

`ContentHandler.startElement` memiliki signature:

```java
void startElement(
    String uri,
    String localName,
    String qName,
    Attributes attributes
) throws SAXException;
```

Maknanya:

| Parameter | Arti |
|---|---|
| `uri` | Namespace URI element. Empty string jika tidak ada namespace atau namespace processing tidak aktif. |
| `localName` | Local part dari element name. Biasanya terisi ketika namespace processing aktif. |
| `qName` | Qualified/raw name seperti muncul di XML, misalnya `a:case`. Bisa kosong tergantung feature. |
| `attributes` | Attribute collection untuk element tersebut. |

### 5.2 Namespace-aware mode

Mode yang direkomendasikan:

```java
factory.setNamespaceAware(true);
```

Atau pada `XMLReader`:

```java
reader.setFeature("http://xml.org/sax/features/namespaces", true);
reader.setFeature("http://xml.org/sax/features/namespace-prefixes", false);
```

Dengan namespace processing aktif, kode extraction sebaiknya memakai:

```java
uri + localName
```

bukan `qName`.

### 5.3 `qName` masih berguna untuk apa?

`qName` berguna ketika kamu butuh lexical representation:

- diagnostic log;
- preserving source-ish name;
- converter yang ingin mempertahankan prefix;
- debugging parser behavior;
- tools yang memang bekerja di level lexical XML.

Tapi untuk business meaning, gunakan namespace URI.

### 5.4 Default namespace trap

XML:

```xml
<case xmlns="urn:agency:case">
  <id>123</id>
</case>
```

Dalam mode namespace-aware:

```text
case element:
  uri       = urn:agency:case
  localName = case

id element:
  uri       = urn:agency:case
  localName = id
```

Default namespace berlaku untuk element, bukan unprefixed attribute.

Contoh:

```xml
<case xmlns="urn:agency:case" id="123"/>
```

Attribute `id` tidak otomatis masuk namespace `urn:agency:case`.

Dalam SAX, lookup attribute namespace-aware harus memperhatikan hal ini.

### 5.5 Attribute namespace behavior

`Attributes` menyediakan beberapa cara akses:

```java
String value1 = attributes.getValue("id");
String value2 = attributes.getValue("urn:agency:case", "id");
```

Untuk unnamespaced attribute:

```java
String id = attributes.getValue("", "id");
```

Dalam practice, `getValue("id")` memakai qName dan bisa rapuh jika prefix/namespace mode berubah.

Pattern yang lebih eksplisit:

```java
static String attr(Attributes attrs, String uri, String localName) {
    return attrs.getValue(uri == null ? "" : uri, localName);
}
```

---

## 6. `startPrefixMapping` dan `endPrefixMapping`

`ContentHandler` memiliki callback:

```java
void startPrefixMapping(String prefix, String uri) throws SAXException;
void endPrefixMapping(String prefix) throws SAXException;
```

Callback ini memberi informasi mapping prefix → namespace URI.

Contoh XML:

```xml
<root xmlns:a="urn:a">
  <a:item>1</a:item>
</root>
```

Parser bisa memanggil:

```text
startPrefixMapping("a", "urn:a")
startElement(... root ...)
startElement("urn:a", "item", "a:item", ...)
...
endPrefixMapping("a")
```

### 6.1 Jangan bergantung pada ordering terlalu spesifik

SAX contract menjamin prefix mapping event terjadi sebelum `startElement` tempat prefix berlaku dan berakhir setelah `endElement`, tetapi ordering antar beberapa prefix mapping pada element yang sama tidak boleh dijadikan business logic.

Gunakan callback ini untuk:

- debugging namespace;
- namespace context stack;
- converter/serializer;
- validation diagnostics;
- preserving prefix if required.

Jangan gunakan prefix sebagai identity domain.

---

## 7. Feature Flags: Cara Negosiasi Parser Behavior

### 7.1 Feature URI umum di SAX

Beberapa feature SAX standar yang sering ditemui:

```text
http://xml.org/sax/features/namespaces
http://xml.org/sax/features/namespace-prefixes
http://xml.org/sax/features/string-interning
http://xml.org/sax/features/validation
http://xml.org/sax/features/external-general-entities
http://xml.org/sax/features/external-parameter-entities
```

Catatan penting:

- `namespaces`: apakah namespace processing dilakukan.
- `namespace-prefixes`: apakah original prefixed attributes seperti `xmlns` dilaporkan.
- `validation`: apakah parser melakukan DTD validation.
- `external-general-entities`: apakah external general entities dibaca/diproses.
- `external-parameter-entities`: apakah external parameter entities dibaca/diproses.

### 7.2 Feature parser-specific

Beberapa feature populer berasal dari implementation tertentu, misalnya Xerces:

```text
http://apache.org/xml/features/disallow-doctype-decl
http://apache.org/xml/features/nonvalidating/load-external-dtd
```

Feature seperti ini sering sangat berguna, tetapi tidak portable secara murni.

Rule production:

```text
Jika feature penting untuk keamanan atau determinism, set secara eksplisit dan fail fast jika tidak didukung.
```

Jangan diam-diam ignore.

### 7.3 Menangani exception feature negotiation

`setFeature` bisa melempar:

- `SAXNotRecognizedException`: parser tidak mengenali feature name.
- `SAXNotSupportedException`: parser mengenali feature, tetapi tidak mendukung nilai/phase tersebut.
- `ParserConfigurationException`: konfigurasi factory/parser tidak valid.

Pattern:

```java
static void requireFeature(XMLReader reader, String feature, boolean value) throws SAXException {
    try {
        reader.setFeature(feature, value);
    } catch (SAXNotRecognizedException | SAXNotSupportedException e) {
        throw new SAXException("Required SAX feature is not supported: " + feature + "=" + value, e);
    }
}
```

Untuk feature optional:

```java
static boolean tryFeature(XMLReader reader, String feature, boolean value) throws SAXException {
    try {
        reader.setFeature(feature, value);
        return true;
    } catch (SAXNotRecognizedException | SAXNotSupportedException e) {
        return false;
    }
}
```

Tapi hati-hati: jangan menjadikan security feature sebagai optional tanpa mitigasi lain.

---

## 8. Properties: Handler Tambahan dan Object Configuration

### 8.1 Property SAX extension umum

Beberapa property umum:

```text
http://xml.org/sax/properties/lexical-handler
http://xml.org/sax/properties/declaration-handler
http://xml.org/sax/properties/dom-node
http://xml.org/sax/properties/xml-string
```

Yang paling sering dipakai:

```java
reader.setProperty(
    "http://xml.org/sax/properties/lexical-handler",
    lexicalHandler
);
```

Dan:

```java
reader.setProperty(
    "http://xml.org/sax/properties/declaration-handler",
    declHandler
);
```

### 8.2 `LexicalHandler`

`org.xml.sax.ext.LexicalHandler` memberi callback untuk event lexical seperti:

- start/end DTD;
- start/end entity;
- start/end CDATA;
- comment.

Ini berguna jika kamu perlu membedakan:

```xml
<text><![CDATA[hello]]></text>
```

dari:

```xml
<text>hello</text>
```

Secara semantic text, keduanya bisa sama. Secara lexical, berbeda.

### 8.3 `DeclHandler`

`org.xml.sax.ext.DeclHandler` memberi callback untuk declaration dalam DTD seperti:

- element declaration;
- attribute declaration;
- internal entity declaration;
- external entity declaration.

Ini jarang dibutuhkan untuk business parsing biasa, tetapi penting untuk tooling, validation diagnostics, DTD-aware converter, atau security inspection.

### 8.4 `DefaultHandler2`

`DefaultHandler2` menggabungkan beberapa extension:

- `ContentHandler`
- `EntityResolver`
- `DTDHandler`
- `ErrorHandler`
- `LexicalHandler`
- `DeclHandler`
- `EntityResolver2`

Ini praktis untuk parser yang perlu kontrol entity/DTD/lexical callback sekaligus.

---

## 9. Entity Resolution: Mengontrol External Resource

### 9.1 `EntityResolver`

Interface dasar:

```java
public interface EntityResolver {
    InputSource resolveEntity(String publicId, String systemId) throws SAXException, IOException;
}
```

Jika return `null`, parser menggunakan default behavior.
Jika return `InputSource`, parser memakai input tersebut.

### 9.2 Blocking resolver sederhana

Untuk banyak workload yang tidak butuh external entity:

```java
final class BlockingEntityResolver implements EntityResolver {
    @Override
    public InputSource resolveEntity(String publicId, String systemId) {
        return new InputSource(new StringReader(""));
    }
}
```

Namun ini harus dikombinasikan dengan feature hardening yang sesuai. Mengandalkan resolver saja tidak selalu cukup karena parser behavior bisa bervariasi.

### 9.3 Catalog resolver pattern

Kadang XML production memang punya DTD/schema eksternal yang legitimate, tetapi tidak boleh fetch network setiap parse.

Pattern:

```text
known publicId/systemId → local classpath resource
unknown external entity → fail closed
```

Pseudo-code:

```java
final class CatalogEntityResolver implements EntityResolver {
    private final Map<String, String> systemIdToClasspathResource;

    CatalogEntityResolver(Map<String, String> systemIdToClasspathResource) {
        this.systemIdToClasspathResource = Map.copyOf(systemIdToClasspathResource);
    }

    @Override
    public InputSource resolveEntity(String publicId, String systemId) throws SAXException {
        String resource = systemIdToClasspathResource.get(systemId);
        if (resource == null) {
            throw new SAXException("External entity is not allowed: publicId=" + publicId + ", systemId=" + systemId);
        }

        InputStream in = CatalogEntityResolver.class.getResourceAsStream(resource);
        if (in == null) {
            throw new SAXException("Configured local entity resource not found: " + resource);
        }

        InputSource source = new InputSource(in);
        source.setPublicId(publicId);
        source.setSystemId(systemId);
        return source;
    }
}
```

Catatan: contoh ini menyederhanakan resource lifecycle. Dalam parser nyata, pastikan stream lifecycle jelas.

### 9.4 `EntityResolver2`

`org.xml.sax.ext.EntityResolver2` memberi kontrol lebih detail:

- `getExternalSubset`
- `resolveEntity(name, publicId, baseURI, systemId)`
- method SAX1-compatible

Ini berguna ketika kamu perlu mengontrol external subset DTD atau membedakan konteks entity resolution.

Untuk aplikasi baru yang perlu hardening entity/DTD secara serius, `EntityResolver2` sering lebih kuat daripada `EntityResolver` biasa.

---

## 10. DTD Handling dalam SAX

### 10.1 DTD itu apa dalam konteks SAX?

DTD dapat menyediakan:

- element declaration;
- attribute declaration;
- entity declaration;
- notation declaration;
- default attribute value;
- validation grammar;
- external subset.

DTD bisa mengubah event yang diterima aplikasi, misalnya dengan default attribute.

### 10.2 `DTDHandler`

`DTDHandler` memiliki callback:

```java
void notationDecl(String name, String publicId, String systemId)
void unparsedEntityDecl(String name, String publicId, String systemId, String notationName)
```

Ini bukan callback untuk semua detail DTD. Untuk deklarasi lebih detail, gunakan `DeclHandler` extension jika parser mendukung.

### 10.3 DTD validation vs DTD loading

Ini sering tertukar.

```text
DTD loading    = parser membaca DTD/external subset/entity declaration.
DTD validation = parser memvalidasi dokumen terhadap DTD grammar.
```

Parser bisa saja load DTD tanpa melakukan validation, misalnya untuk default attribute atau entity declaration.

Karena itu, `factory.setValidating(false)` belum tentu cukup untuk mencegah external DTD fetch pada semua parser/configuration.

### 10.4 External DTD fetch sebagai availability risk

Jika parser mencoba mengambil:

```text
https://partner.example.com/schema/legacy.dtd
```

maka parsing bisa gagal atau lambat karena:

- network timeout;
- DNS issue;
- remote server down;
- proxy/firewall;
- rate limit;
- TLS issue;
- environment difference DEV/UAT/PROD.

Untuk deterministic production parsing, external DTD biasanya harus:

- dilarang; atau
- di-map ke local catalog; atau
- di-fetch terkontrol di deployment process, bukan saat request parsing.

---

## 11. Validation Boundary: SAX, DTD, XSD, Schema

### 11.1 `setValidating(true)` biasanya DTD validation

Pada `SAXParserFactory`, `setValidating(true)` historically terkait DTD validation.

Untuk XSD validation modern, biasanya pakai:

```java
SchemaFactory schemaFactory = SchemaFactory.newInstance(XMLConstants.W3C_XML_SCHEMA_NS_URI);
Schema schema = schemaFactory.newSchema(schemaFile);

SAXParserFactory factory = SAXParserFactory.newInstance();
factory.setNamespaceAware(true);
factory.setSchema(schema);
```

### 11.2 Namespace-aware penting untuk XSD

XSD adalah namespace-oriented. Jika parser tidak namespace-aware, validation bisa gagal atau hasilnya membingungkan.

Pattern:

```java
factory.setNamespaceAware(true);
factory.setSchema(schema);
factory.setValidating(false); // XSD via Schema, not DTD validating mode
```

### 11.3 Validation bukan pengganti parsing logic

Validation menjawab:

```text
Apakah XML mengikuti grammar?
```

Bukan:

```text
Apakah business transition valid?
Apakah user boleh melakukan aksi?
Apakah reference ID ada di database?
Apakah data konsisten lintas aggregate?
```

Di sistem enterprise, validation layer biasanya bertingkat:

```text
well-formed XML
  → namespace + schema validity
  → structural extraction
  → semantic validation
  → authorization/domain validation
  → persistence boundary
```

---

## 12. Error Handling: `ErrorHandler` dan `SAXParseException`

### 12.1 `ErrorHandler`

`ErrorHandler` memiliki:

```java
void warning(SAXParseException exception)
void error(SAXParseException exception)
void fatalError(SAXParseException exception)
```

Interpretasi umum:

- `warning`: kondisi non-fatal;
- `error`: recoverable validation/parsing error;
- `fatalError`: parser tidak bisa melanjutkan secara valid.

Namun behavior “recoverable” bisa tergantung parser dan mode validation.

### 12.2 Jangan diamkan error

`DefaultHandler` default-nya tidak selalu membuat semua error menjadi exception visible sesuai ekspektasi aplikasi. Untuk production, pasang `ErrorHandler` eksplisit.

Pattern:

```java
final class FailingErrorHandler implements ErrorHandler {
    @Override
    public void warning(SAXParseException e) throws SAXException {
        // Bisa log atau escalate tergantung policy
        throw e;
    }

    @Override
    public void error(SAXParseException e) throws SAXException {
        throw e;
    }

    @Override
    public void fatalError(SAXParseException e) throws SAXException {
        throw e;
    }
}
```

Untuk batch import, kamu mungkin ingin mengumpulkan error dengan line/column, tetapi tetap jangan menganggap hasil parse valid jika error terjadi.

### 12.3 Location info

`SAXParseException` membawa:

- publicId;
- systemId;
- lineNumber;
- columnNumber.

Ini sangat berguna untuk:

- error report ke partner;
- audit log;
- debugging payload;
- partial import diagnostics.

Namun jangan log seluruh XML jika mengandung data sensitif.

---

## 13. Namespace-Aware Handler Pattern

Berikut pattern handler yang menghindari qName-based logic:

```java
final class CaseHandler extends DefaultHandler {
    private static final String CASE_NS = "urn:agency:case";

    private final Deque<String> path = new ArrayDeque<>();
    private final StringBuilder text = new StringBuilder();

    private String currentCaseId;

    @Override
    public void startElement(String uri, String localName, String qName, Attributes attributes) {
        path.push(expandedName(uri, localName));
        text.setLength(0);

        if (is(uri, localName, CASE_NS, "case")) {
            currentCaseId = attributes.getValue("", "id");
        }
    }

    @Override
    public void characters(char[] ch, int start, int length) {
        text.append(ch, start, length);
    }

    @Override
    public void endElement(String uri, String localName, String qName) {
        String value = text.toString();

        if (is(uri, localName, CASE_NS, "status")) {
            handleStatus(currentCaseId, value.trim());
        }

        path.pop();
        text.setLength(0);
    }

    private static boolean is(String uri, String local, String expectedUri, String expectedLocal) {
        return expectedUri.equals(uri) && expectedLocal.equals(local);
    }

    private static String expandedName(String uri, String local) {
        return "{" + uri + "}" + local;
    }

    private static void handleStatus(String caseId, String status) {
        // domain handoff
    }
}
```

Catatan penting: `text.setLength(0)` pada setiap `startElement` adalah simplifikasi. Untuk mixed content atau nested text yang kompleks, gunakan stack frame agar text tidak tertimpa oleh child element.

---

## 14. Safer State Machine Pattern untuk SAX

SAX menjadi rapuh ketika handler berubah menjadi kumpulan boolean:

```java
boolean inCase;
boolean inStatus;
boolean inApplicant;
boolean inAddress;
```

Untuk XML kompleks, gunakan explicit frame stack.

```java
record Frame(String uri, String localName, StringBuilder text) {
    boolean is(String expectedUri, String expectedLocal) {
        return expectedUri.equals(uri) && expectedLocal.equals(localName);
    }
}

final class StackHandler extends DefaultHandler {
    private static final String NS = "urn:agency:case";
    private final Deque<Frame> stack = new ArrayDeque<>();

    @Override
    public void startElement(String uri, String localName, String qName, Attributes attributes) {
        stack.push(new Frame(uri, localName, new StringBuilder()));
    }

    @Override
    public void characters(char[] ch, int start, int length) {
        if (!stack.isEmpty()) {
            stack.peek().text().append(ch, start, length);
        }
    }

    @Override
    public void endElement(String uri, String localName, String qName) {
        Frame ended = stack.pop();
        String text = ended.text().toString();

        if (ended.is(NS, "status")) {
            // process status
        }

        // If parent needs aggregate text including child text, append intentionally.
        // Do not do this blindly for structured XML.
    }
}
```

Dengan stack frame, handler lebih dekat ke bentuk state machine eksplisit.

---

## 15. Parser Configuration Template: Deterministic SAX Reader

Template berikut bukan final security hardening lengkap. Part 30 akan memperketatnya. Tapi ini baseline konfigurasi yang lebih eksplisit dibanding default parser.

```java
public final class SaxReaders {
    private SaxReaders() {}

    public static XMLReader newNamespaceAwareReader(
            ContentHandler contentHandler,
            ErrorHandler errorHandler,
            EntityResolver entityResolver
    ) throws ParserConfigurationException, SAXException {

        SAXParserFactory factory = SAXParserFactory.newInstance();
        factory.setNamespaceAware(true);
        factory.setValidating(false);

        SAXParser parser = factory.newSAXParser();
        XMLReader reader = parser.getXMLReader();

        requireFeature(reader, "http://xml.org/sax/features/namespaces", true);
        tryFeature(reader, "http://xml.org/sax/features/namespace-prefixes", false);

        reader.setContentHandler(contentHandler);
        reader.setErrorHandler(errorHandler);
        reader.setEntityResolver(entityResolver);

        return reader;
    }

    private static void requireFeature(XMLReader reader, String feature, boolean value) throws SAXException {
        try {
            reader.setFeature(feature, value);
        } catch (SAXNotRecognizedException | SAXNotSupportedException e) {
            throw new SAXException("Required SAX feature is not available: " + feature + "=" + value, e);
        }
    }

    private static boolean tryFeature(XMLReader reader, String feature, boolean value) throws SAXException {
        try {
            reader.setFeature(feature, value);
            return true;
        } catch (SAXNotRecognizedException | SAXNotSupportedException e) {
            return false;
        }
    }
}
```

Usage:

```java
XMLReader reader = SaxReaders.newNamespaceAwareReader(
    new CaseHandler(),
    new FailingErrorHandler(),
    new BlockingEntityResolver()
);

reader.parse(new InputSource(inputStream));
```

---

## 16. Feature/Property Policy: Fail Open vs Fail Closed

Salah satu keputusan desain paling penting: apa yang terjadi jika parser tidak mendukung feature tertentu?

### 16.1 Fail open

```text
Feature tidak didukung → lanjut parsing
```

Cocok untuk:

- optimization;
- optional diagnostic;
- lexical preservation yang tidak wajib;
- compatibility fallback non-security.

### 16.2 Fail closed

```text
Feature tidak didukung → parsing gagal
```

Wajib untuk:

- security hardening;
- disabling unsafe external access;
- deterministic namespace processing;
- validation requirement;
- compliance-sensitive import.

### 16.3 Rule praktis

```text
Jika hasil parsing bisa berubah secara business/security karena feature tidak aktif, feature itu required.
Jika hanya observability tambahan, feature itu optional.
```

---

## 17. Perbedaan Parser Implementation

Java SE menyediakan API, tetapi implementation parser bisa berbeda tergantung JDK/vendor/configuration.

Hal yang bisa berbeda:

- feature URI recognized atau tidak;
- default value feature;
- DTD loading behavior;
- external entity behavior;
- lexical/declaration handler support;
- validation error recovery;
- line/column precision;
- support terhadap property tertentu;
- schema validation behavior.

Karena itu, jangan membuat asumsi seperti:

```text
“Di laptop saya DOCTYPE otomatis ditolak, berarti aman.”
```

Yang benar:

```text
Konfigurasi parser harus eksplisit, diuji, dan gagal jika requirement tidak terpenuhi.
```

---

## 18. Failure Modes yang Sering Terjadi

### 18.1 Namespace disabled tanpa sadar

Gejala:

- `uri` kosong;
- `localName` kosong;
- logic namespace-aware tidak pernah match.

Penyebab:

```java
factory.setNamespaceAware(false); // default pada banyak konteks
```

Solusi:

```java
factory.setNamespaceAware(true);
```

dan test handler dengan XML ber-prefix dan default namespace.

### 18.2 Logic berbasis prefix

Kode:

```java
if (qName.equals("abc:Amount")) { ... }
```

Problem:

```xml
<x:Amount xmlns:x="urn:payment">100</x:Amount>
```

Meaning sama, prefix beda.

Solusi:

```java
if ("urn:payment".equals(uri) && "Amount".equals(localName)) { ... }
```

### 18.3 Menganggap `setValidating(false)` memblokir DTD fetch

`setValidating(false)` tidak selalu berarti parser tidak memuat external DTD.

Solusi:

- set feature external entity/DTD loading secara eksplisit;
- pasang resolver fail-closed;
- test dengan payload DOCTYPE external.

### 18.4 Mengabaikan `SAXNotRecognizedException`

Kode buruk:

```java
try {
    reader.setFeature(feature, false);
} catch (Exception ignored) {
}
```

Ini bisa membuat aplikasi mengira aman padahal feature penting tidak aktif.

Solusi:

- classify feature sebagai required/optional;
- fail closed untuk required.

### 18.5 Menggunakan external DTD di request path

Gejala:

- parsing lambat sporadis;
- request timeout;
- error hanya di environment tertentu;
- dependency pada network partner.

Solusi:

- local catalog;
- block unknown external entity;
- jangan fetch resource eksternal saat request parsing.

### 18.6 `characters()` text rusak karena entity/CDATA/multiple calls

Entity dan CDATA bisa memengaruhi callback sequence. Jangan asumsikan satu text node = satu `characters()` call.

Solusi:

- akumulasi text dengan `StringBuilder`;
- flush di `endElement`;
- gunakan `LexicalHandler` hanya jika butuh beda CDATA/comment/entity boundary.

---

## 19. Testing Matrix untuk SAX Namespace/DTD Behavior

Untuk parser utility production, minimal test payload:

### 19.1 Namespace prefix variation

```xml
<a:case xmlns:a="urn:case"><a:id>1</a:id></a:case>
```

```xml
<b:case xmlns:b="urn:case"><b:id>1</b:id></b:case>
```

Harus menghasilkan domain result yang sama.

### 19.2 Default namespace

```xml
<case xmlns="urn:case"><id>1</id></case>
```

Pastikan element child juga namespace-aware.

### 19.3 Unnamespaced attribute

```xml
<case xmlns="urn:case" id="1"/>
```

Pastikan lookup attribute memakai `("", "id")`.

### 19.4 Unknown namespace

```xml
<case xmlns="urn:wrong"><id>1</id></case>
```

Harus reject, bukan diam-diam parse.

### 19.5 External DTD

```xml
<!DOCTYPE case SYSTEM "https://example.com/case.dtd">
<case>1</case>
```

Expected behavior harus eksplisit:

- ditolak; atau
- diarahkan ke local catalog.

### 19.6 Entity reference

```xml
<!DOCTYPE case [ <!ENTITY company "ACME"> ]>
<case>&company;</case>
```

Pastikan behavior sesuai policy.

### 19.7 CDATA

```xml
<case><![CDATA[abc<def>]]></case>
```

Pastikan text extraction sesuai ekspektasi.

### 19.8 Validation error

Jika memakai schema/DTD validation, pastikan `ErrorHandler` tidak menelan error.

---

## 20. Production Checklist

Sebelum memakai SAX parser di production:

1. Apakah `factory.setNamespaceAware(true)` eksplisit?
2. Apakah handler memakai `uri + localName`, bukan prefix/qName untuk business logic?
3. Apakah attribute lookup membedakan namespaced dan unnamespaced attribute?
4. Apakah `ErrorHandler` eksplisit dipasang?
5. Apakah error validation/parsing menyebabkan failure sesuai policy?
6. Apakah external entity behavior eksplisit?
7. Apakah external DTD behavior eksplisit?
8. Apakah required feature gagal cepat jika tidak didukung parser?
9. Apakah optional feature benar-benar optional?
10. Apakah parser behavior diuji dengan prefix variation dan default namespace?
11. Apakah DOCTYPE/external entity payload diuji?
12. Apakah line/column error dilaporkan tanpa membocorkan data sensitif?
13. Apakah parser utility tidak diam-diam melakukan network/file I/O?
14. Apakah schema validation, jika ada, namespace-aware?
15. Apakah behavior sama di Java 8, 11, 17, 21, 25 sesuai target support?

---

## 21. Latihan / Thought Exercise

### Latihan 1 — Prefix independence

Buat handler yang mengekstrak:

```xml
<a:case xmlns:a="urn:case">
  <a:id>CASE-001</a:id>
</a:case>
```

Dan:

```xml
<x:case xmlns:x="urn:case">
  <x:id>CASE-001</x:id>
</x:case>
```

Keduanya harus menghasilkan object yang sama.

Pertanyaan:

- field apa yang dipakai untuk matching element?
- apakah `qName` boleh dipakai?
- test apa yang membuktikan kode tidak prefix-dependent?

### Latihan 2 — Default namespace + attribute

XML:

```xml
<case xmlns="urn:case" id="CASE-001">
  <status>OPEN</status>
</case>
```

Pertanyaan:

- namespace URI untuk `case` apa?
- namespace URI untuk `status` apa?
- namespace URI untuk attribute `id` apa?
- bagaimana lookup `id` yang benar dari `Attributes`?

### Latihan 3 — Required feature negotiation

Buat helper:

```java
requireFeature(XMLReader reader, String feature, boolean value)
```

Requirement:

- jika feature tidak dikenali, throw exception;
- jika feature tidak didukung, throw exception;
- exception message harus mengandung feature URI dan desired value;
- jangan swallow.

### Latihan 4 — Entity resolver policy

Desain resolver dengan policy:

```text
Known DTD systemId → local classpath resource
Unknown external entity → reject
No external entity → normal
```

Pertanyaan:

- apa yang harus terjadi jika local resource tidak ditemukan?
- apakah parser boleh fallback ke network?
- bagaimana audit log-nya tanpa membocorkan payload?

### Latihan 5 — SAX handler state machine

Diberikan XML:

```xml
<cases xmlns="urn:case">
  <case id="1"><status>OPEN</status></case>
  <case id="2"><status>CLOSED</status></case>
</cases>
```

Buat handler yang mengeluarkan list `(id, status)`.

Constraint:

- namespace-aware;
- tidak memakai qName;
- akumulasi text benar walaupun `characters()` dipanggil berkali-kali;
- reject jika status muncul di luar case.

---

## 22. Ringkasan

SAX advance bukan tentang menghafal callback. Yang penting adalah memahami bahwa parser adalah **stateful configurable engine** yang menghasilkan event berdasarkan mode namespace, feature/property, entity policy, dan validation configuration.

Prinsip utama:

```text
Namespace identity = namespace URI + local name, bukan prefix.
```

```text
Feature/property harus dinegosiasikan eksplisit.
```

```text
External entity dan DTD adalah I/O/security boundary.
```

```text
Parser implementation bisa berbeda; production code harus fail fast untuk requirement penting.
```

```text
SAX handler yang baik adalah state machine kecil yang eksplisit, bukan kumpulan boolean rapuh.
```

Part 29 membentuk fondasi untuk Part 30, yaitu secure XML parsing secara mendalam: XXE, Billion Laughs, entity expansion limits, DTD hardening, secure processing, dan test payload untuk membuktikan konfigurasi benar.

---

## Status Seri

Progress saat ini: **Part 29 dari 32 selesai**.

Seri **belum selesai**.

Lanjut berikutnya:

**Part 30 — Secure XML Parsing with DOM/SAX: XXE, Billion Laughs, Expansion Limits, Hardening**

File berikutnya:

```text
30-secure-xml-parsing-dom-sax-xxe-expansion-hardening.md
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 28 — SAX Mental Model: Push Events, Stateless Parsing, Handler Contracts](./28-sax-mental-model-push-events-handler-contracts.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 30 — Secure XML Parsing with DOM/SAX: XXE, Billion Laughs, Expansion Limits, Hardening](./30-secure-xml-parsing-dom-sax-xxe-expansion-hardening.md)
