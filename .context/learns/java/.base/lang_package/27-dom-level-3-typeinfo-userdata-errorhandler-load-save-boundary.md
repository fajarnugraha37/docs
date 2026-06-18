# Part 27 — DOM Level 3: TypeInfo, UserData, ErrorHandler, Load/Save Boundary

> Seri: `learn-java-lang-dom-sax-core-runtime-platform-contracts`  
> File: `27-dom-level-3-typeinfo-userdata-errorhandler-load-save-boundary.md`  
> Scope utama: `org.w3c.dom.*`, `org.w3c.dom.ls.*`, DOM Level 3 Core, DOM Level 3 Load and Save  
> Target Java: 8 sampai 25

---

## 1. Tujuan Part Ini

Pada Part 24–26 kita sudah membangun fondasi DOM sebagai **mutable in-memory tree model**:

- `Document` sebagai owner dan factory node;
- `Node` sebagai unit tree;
- `Element`, `Attr`, `Text`, `CDATASection`, `Comment` sebagai node konkret;
- `NodeList` yang live;
- namespace-aware construction dan querying;
- operasi create, mutate, clone, import, adopt, normalize.

Part ini naik satu level ke DOM Level 3, yaitu area DOM yang sering jarang disentuh tetapi penting ketika kamu bekerja dengan XML yang:

- divalidasi dengan schema;
- perlu metadata tambahan pada node;
- perlu normalization/validation error handling;
- perlu load/serialize melalui DOM Level 3 Load and Save;
- perlu portable lintas DOM implementation;
- dipakai di platform/library yang sensitif terhadap compatibility.

Target utama Part ini:

1. memahami `TypeInfo` sebagai metadata tipe schema pada `Element`/`Attr`;
2. memahami `Node.setUserData()` dan `UserDataHandler` sebagai mekanisme metadata attachment pada node;
3. memahami `DOMError`, `DOMErrorHandler`, `DOMLocator`, dan `DOMConfiguration`;
4. memahami `DOMImplementation`, `DOMImplementationRegistry`, dan feature discovery;
5. memahami boundary `org.w3c.dom.ls.*`: `DOMImplementationLS`, `LSParser`, `LSInput`, `LSOutput`, `LSSerializer`;
6. memahami kenapa DOM Level 3 APIs sering terlihat powerful tetapi tidak selalu portable atau ergonomis;
7. membangun mental model kapan harus memakai DOM Level 3, kapan lebih baik memakai JAXP standard factory/transformer, dan kapan sebaiknya memakai SAX/StAX.

Dokumentasi Java SE menyatakan package `org.w3c.dom` menyediakan interface DOM dan mencakup DOM Level 2 Core, DOM Level 3 Core, serta DOM Level 3 Load and Save; package `org.w3c.dom.ls` menyediakan interface Load and Save untuk memuat XML ke DOM dan men-serialize DOM menjadi XML. Referensi API Java SE 25 juga mencantumkan `TypeInfo`, `UserDataHandler`, dan package `org.w3c.dom.ls` sebagai bagian dari `java.xml`. 

---

## 2. Mental Model Utama

DOM Level 3 bukan “DOM biasa plus method tambahan”. Lebih tepatnya:

```text
DOM Core Level 2/3
    = object model untuk XML tree

DOM Level 3 Core additions
    = metadata, normalization, configuration, error reporting, feature discovery

DOM Level 3 Load and Save
    = kontrak untuk parse/serialize DOM melalui API DOM, bukan hanya JAXP builder/transformer
```

Untuk engineer production, mental model yang lebih berguna adalah ini:

```text
XML bytes/string/resource
        |
        | parsing/loading boundary
        v
DOM Document tree
        |
        | optional schema/type/normalization metadata
        v
Application extraction/mutation/serialization
        |
        | output boundary
        v
XML bytes/string/resource
```

DOM Level 3 menyentuh tiga boundary besar:

1. **semantic metadata boundary**  
   Contoh: node ini tipenya apa menurut schema? Apakah element ini bertipe `xs:date`? Apakah attribute ini bertipe ID?

2. **processing configuration boundary**  
   Contoh: ketika `normalizeDocument()`, apakah comments dipertahankan? apakah CDATA sections dipisah? bagaimana error dilaporkan?

3. **implementation capability boundary**  
   Contoh: apakah DOM implementation ini mendukung Load/Save? apakah konfigurasi tertentu tersedia? apakah `TypeInfo` terisi?

Top 1% engineer tidak menghafal semua method DOM Level 3. Yang penting adalah mengetahui bahwa DOM Level 3 adalah **contract surface yang capability-nya bergantung pada implementation dan processing pipeline**.

---

## 3. Kenapa DOM Level 3 Penting Walaupun Jarang Dipakai Langsung

Banyak aplikasi Java modern tidak langsung menulis kode seperti:

```java
DOMImplementationRegistry registry = DOMImplementationRegistry.newInstance();
DOMImplementationLS ls = (DOMImplementationLS) registry.getDOMImplementation("LS 3.0");
```

Lebih sering mereka memakai:

```java
DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
DocumentBuilder builder = factory.newDocumentBuilder();
Document doc = builder.parse(inputStream);
```

atau:

```java
TransformerFactory.newInstance()
    .newTransformer()
    .transform(new DOMSource(doc), new StreamResult(out));
```

Tetapi DOM Level 3 tetap penting karena:

1. banyak method ada langsung di `Document`/`Node`, misalnya `getSchemaTypeInfo()`, `setUserData()`, `normalizeDocument()`;
2. library XML sering mengembalikan DOM node yang punya behavior DOM Level 3;
3. serialization/parsing behavior kadang dipengaruhi DOM configuration;
4. validation pipeline dapat mengisi metadata tipe;
5. portability problem sering berasal dari asumsi bahwa semua DOM implementation berperilaku sama;
6. Java 9+ module system membuat duplicate package seperti `org.w3c.dom` dari dependency lama bisa menjadi masalah karena package tersebut sudah disediakan oleh module `java.xml`.

DOM Level 3 adalah area yang jarang dipakai sehari-hari, tetapi ketika salah dipahami, efeknya bisa muncul sebagai bug yang sangat sulit direproduksi:

- XML output berbeda antar JDK/vendor;
- node metadata hilang setelah clone/import;
- error normalization tidak tertangkap;
- schema type info selalu `null`/unknown karena pipeline tidak melakukan validation;
- serializer menghasilkan namespace prefix atau XML declaration yang tidak sesuai ekspektasi;
- dependency lama membawa `xml-apis.jar` dan konflik dengan `java.xml`.

---

## 4. API Map

Part ini berputar pada beberapa interface/class berikut.

### 4.1 DOM Level 3 Core

```text
org.w3c.dom.TypeInfo
org.w3c.dom.UserDataHandler
org.w3c.dom.DOMError
org.w3c.dom.DOMErrorHandler
org.w3c.dom.DOMLocator
org.w3c.dom.DOMConfiguration
org.w3c.dom.DOMImplementation
org.w3c.dom.DOMImplementationSource
org.w3c.dom.bootstrap.DOMImplementationRegistry
```

Related method pada core DOM:

```text
Element.getSchemaTypeInfo()
Attr.getSchemaTypeInfo()
Node.setUserData(...)
Node.getUserData(...)
Node.normalize()
Document.normalizeDocument()
Document.getDomConfig()
Document.getImplementation()
DOMImplementation.hasFeature(...)
DOMImplementation.getFeature(...)
```

### 4.2 DOM Level 3 Load and Save

```text
org.w3c.dom.ls.DOMImplementationLS
org.w3c.dom.ls.LSParser
org.w3c.dom.ls.LSInput
org.w3c.dom.ls.LSOutput
org.w3c.dom.ls.LSSerializer
org.w3c.dom.ls.LSParserFilter
org.w3c.dom.ls.LSSerializerFilter
org.w3c.dom.ls.LSResourceResolver
org.w3c.dom.ls.LSException
```

Package `org.w3c.dom.ls` menyediakan interface DOM Level 3 Load and Save; `DOMImplementationLS` menyediakan factory method untuk membuat parser/serializer Load and Save.  

---

## 5. `TypeInfo`: Schema Type Metadata, Bukan Type System Java

### 5.1 Apa itu `TypeInfo`?

`TypeInfo` merepresentasikan tipe yang direferensikan dari `Element` atau `Attr`, sebagaimana ditentukan oleh schema yang terkait dengan dokumen.

Penting: ini **bukan** `java.lang.Class<?>`.

```text
Java type:
    String.class, Integer.class, MyDto.class

DOM TypeInfo:
    XML Schema type / DTD-ish type metadata attached to XML node
```

Contoh konseptual:

```xml
<invoiceDate>2026-06-17</invoiceDate>
```

Secara DOM biasa:

```text
Element name      = invoiceDate
textContent       = "2026-06-17"
```

Dengan schema-aware validation, secara konseptual node itu bisa punya type info:

```text
type namespace    = http://www.w3.org/2001/XMLSchema
type name         = date
```

### 5.2 API utama

Secara umum kamu akan bertemu:

```java
TypeInfo info = element.getSchemaTypeInfo();

String typeName = info.getTypeName();
String typeNamespace = info.getTypeNamespace();
boolean derived = info.isDerivedFrom(
    "http://www.w3.org/2001/XMLSchema",
    "string",
    TypeInfo.DERIVATION_RESTRICTION
);
```

Untuk attribute:

```java
Attr attr = element.getAttributeNode("status");
TypeInfo attrType = attr.getSchemaTypeInfo();
```

### 5.3 Mental model penting

`TypeInfo` hanya berguna jika ada pipeline yang memberi DOM informasi tipe.

```text
XML parsed without validation
        -> DOM nodes mostly structural
        -> TypeInfo likely unavailable/unknown/implementation-dependent

XML parsed/validated with schema-aware pipeline
        -> DOM nodes may contain schema type metadata
        -> TypeInfo can become meaningful
```

Jangan berasumsi bahwa karena XML punya XSD file, DOM otomatis tahu tipe node. Parser harus dikonfigurasi untuk validation/schema processing.

### 5.4 `TypeInfo` bukan pengganti validation

Kesalahan umum:

```java
if (element.getSchemaTypeInfo().getTypeName().equals("date")) {
    // assume value valid date
}
```

Masalah:

1. type info mungkin tidak tersedia;
2. type name bisa implementation-dependent;
3. schema validation mungkin tidak dijalankan;
4. business validation tetap berbeda dari XML schema validation.

Desain yang lebih aman:

```text
1. parse with hardened parser
2. validate with explicit schema if needed
3. extract field as string
4. convert to domain type explicitly
5. apply business validation explicitly
6. treat TypeInfo as metadata/debug/advanced routing only
```

### 5.5 Kapan `TypeInfo` berguna?

`TypeInfo` berguna untuk:

- XML editor/tooling;
- generic XML processor;
- validation report enrichment;
- mapper yang perlu mengetahui schema type;
- import pipeline yang mendukung banyak XML schema family;
- debugging schema-aware parsing.

Tidak ideal untuk:

- business rule utama;
- application DTO mapping biasa;
- authorization decision;
- regulatory decision tanpa explicit validation pipeline;
- parsing XML dari sumber tidak terpercaya tanpa hardening.

---

## 6. `UserData`: Metadata Attachment pada Node

### 6.1 Apa itu user data?

DOM Level 3 menyediakan mekanisme:

```java
Object previous = node.setUserData("key", value, handler);
Object value = node.getUserData("key");
```

Artinya, aplikasi dapat menempelkan object arbitrary pada node dengan key string.

Mental model:

```text
DOM Node
  structural XML data:
    name, namespace, attributes, children

  user data side-channel:
    "sourceLine" -> 120
    "validated" -> true
    "domainPath" -> "application.applicant.address.postalCode"
```

Ini tidak menjadi bagian XML. Ini metadata runtime saja.

### 6.2 Contoh penggunaan sederhana

```java
public final class DomMetadataKeys {
    private DomMetadataKeys() {}

    public static final String SOURCE = "app.source";
    public static final String DOMAIN_PATH = "app.domainPath";
}

record SourceInfo(String systemId, int line, int column) {}

static void attachSourceInfo(Node node, SourceInfo sourceInfo) {
    node.setUserData(DomMetadataKeys.SOURCE, sourceInfo, null);
}

static Optional<SourceInfo> sourceInfo(Node node) {
    Object value = node.getUserData(DomMetadataKeys.SOURCE);
    return value instanceof SourceInfo info ? Optional.of(info) : Optional.empty();
}
```

### 6.3 Kapan berguna?

User data berguna ketika DOM dipakai sebagai intermediate representation dan kamu perlu metadata non-XML:

- source location;
- validation state;
- domain mapping path;
- transformation trace;
- correlation ID;
- import batch ID;
- node classification;
- temporary cache untuk traversal mahal.

### 6.4 Kapan berbahaya?

User data berbahaya jika:

- menyimpan object besar;
- menyimpan reference ke service/container;
- menyimpan security-sensitive data;
- menyimpan entity/session/persistence context;
- menganggap metadata ikut terserialisasi ke XML;
- menganggap metadata otomatis aman saat clone/import/adopt.

DOM tree bisa hidup lama, berpindah antar layer, atau dicache. User data dapat menjadi sumber memory leak dan hidden coupling.

---

## 7. `UserDataHandler`: Clone/Import/Rename Callback

### 7.1 Problem yang dipecahkan

Jika user data ditempel ke node, apa yang terjadi ketika node:

- di-clone;
- di-import ke document lain;
- di-adopt;
- di-rename;
- di-delete?

DOM menyediakan `UserDataHandler` agar aplikasi diberi callback pada operasi tertentu.

### 7.2 Contoh handler

```java
import org.w3c.dom.*;

public final class CopyingUserDataHandler implements UserDataHandler {
    @Override
    public void handle(
        short operation,
        String key,
        Object data,
        Node src,
        Node dst
    ) {
        if (dst == null || data == null) {
            return;
        }

        switch (operation) {
            case UserDataHandler.NODE_CLONED,
                 UserDataHandler.NODE_IMPORTED,
                 UserDataHandler.NODE_ADOPTED -> {
                // Only copy immutable/safe metadata.
                if (data instanceof SourceInfo || data instanceof String || data instanceof Boolean) {
                    dst.setUserData(key, data, this);
                }
            }
            default -> {
                // For rename/delete or unsupported operations, do nothing.
            }
        }
    }
}
```

Untuk Java 8 syntax:

```java
public final class CopyingUserDataHandler implements UserDataHandler {
    @Override
    public void handle(short operation, String key, Object data, Node src, Node dst) {
        if (dst == null || data == null) {
            return;
        }

        switch (operation) {
            case UserDataHandler.NODE_CLONED:
            case UserDataHandler.NODE_IMPORTED:
            case UserDataHandler.NODE_ADOPTED:
                if (data instanceof SourceInfo || data instanceof String || data instanceof Boolean) {
                    dst.setUserData(key, data, this);
                }
                break;
            default:
                break;
        }
    }
}
```

### 7.3 Rule of thumb

User data sebaiknya:

```text
small
immutable
non-sensitive
non-resource-owning
non-container-referencing
safe if lost
safe if not serialized
```

Kalau metadata wajib bertahan lintas serialization, jangan pakai user data. Jadikan attribute/element eksplisit atau simpan di struktur data eksternal yang lifecycle-nya jelas.

---

## 8. `DOMConfiguration`: Parameterized Normalization

### 8.1 `Node.normalize()` vs `Document.normalizeDocument()`

Dari Part 25:

```java
node.normalize();
```

menggabungkan adjacent text nodes di subtree.

DOM Level 3 menyediakan:

```java
DOMConfiguration config = document.getDomConfig();
document.normalizeDocument();
```

`normalizeDocument()` menggunakan konfigurasi dari `DOMConfiguration`.

Mental model:

```text
Node.normalize()
    = local tree text cleanup

Document.normalizeDocument()
    = document-level normalization according to configurable DOM parameters
```

### 8.2 Contoh konfigurasi

```java
Document document = ...;
DOMConfiguration config = document.getDomConfig();

if (config.canSetParameter("comments", Boolean.FALSE)) {
    config.setParameter("comments", Boolean.FALSE);
}

if (config.canSetParameter("cdata-sections", Boolean.FALSE)) {
    config.setParameter("cdata-sections", Boolean.FALSE);
}

if (config.canSetParameter("error-handler", new LoggingDomErrorHandler())) {
    config.setParameter("error-handler", new LoggingDomErrorHandler());
}

document.normalizeDocument();
```

### 8.3 Kenapa `canSetParameter` penting?

Tidak semua DOM implementation mendukung semua parameter atau semua value.

Kode buruk:

```java
config.setParameter("comments", false);
config.setParameter("validate", true);
```

Kode lebih defensif:

```java
static void setIfSupported(DOMConfiguration config, String name, Object value) {
    if (config.canSetParameter(name, value)) {
        config.setParameter(name, value);
    }
}
```

### 8.4 `DOMErrorHandler`

`DOMErrorHandler` dapat dipasang sebagai parameter `error-handler`.

```java
public final class LoggingDomErrorHandler implements DOMErrorHandler {
    @Override
    public boolean handleError(DOMError error) {
        DOMLocator locator = error.getLocation();

        String location = locator == null
            ? "unknown"
            : "line=" + locator.getLineNumber()
                + ", column=" + locator.getColumnNumber()
                + ", uri=" + locator.getUri();

        System.err.println(
            "DOM error severity=" + error.getSeverity()
                + ", type=" + error.getType()
                + ", message=" + error.getMessage()
                + ", location=" + location
        );

        // true means continue if possible; false means stop processing.
        return error.getSeverity() != DOMError.SEVERITY_FATAL_ERROR;
    }
}
```

### 8.5 Severity mental model

```text
WARNING
    Recoverable issue. Continue usually acceptable.

ERROR
    Serious issue. Continue only if caller can tolerate degraded result.

FATAL_ERROR
    Processing should stop.
```

Untuk production import pipeline, jangan hanya log dan lanjut untuk semua severity. Buat policy eksplisit.

```java
public enum DomErrorPolicy {
    FAIL_ON_ERROR,
    FAIL_ON_FATAL_ONLY,
    COLLECT_ALL_THEN_FAIL
}
```

---

## 9. `DOMError`, `DOMLocator`: Better Failure Reporting

### 9.1 Kenapa DOM error reporting penting?

Tanpa lokasi, XML error sering menjadi tidak actionable.

Buruk:

```text
Invalid XML
```

Lebih baik:

```text
Invalid XML at line=42, column=17, uri=input.xml: unexpected element <status>
```

Dalam sistem enterprise/regulatory, error harus membantu:

- developer menemukan bug;
- user memperbaiki file;
- support menjelaskan rejection;
- audit trail menyimpan alasan teknis;
- retry/import job membedakan permanent vs transient failure.

### 9.2 Error collector pattern

```java
public final class CollectingDomErrorHandler implements DOMErrorHandler {
    private final List<DomIssue> issues = new ArrayList<>();

    @Override
    public boolean handleError(DOMError error) {
        DOMLocator loc = error.getLocation();

        issues.add(new DomIssue(
            error.getSeverity(),
            error.getType(),
            error.getMessage(),
            loc == null ? -1 : loc.getLineNumber(),
            loc == null ? -1 : loc.getColumnNumber(),
            loc == null ? null : loc.getUri()
        ));

        return error.getSeverity() != DOMError.SEVERITY_FATAL_ERROR;
    }

    public List<DomIssue> issues() {
        return List.copyOf(issues); // Java 10+
    }
}

record DomIssue(
    short severity,
    String type,
    String message,
    int line,
    int column,
    String uri
) {}
```

Java 8 version:

```java
public List<DomIssue> issues() {
    return Collections.unmodifiableList(new ArrayList<>(issues));
}
```

---

## 10. `DOMImplementation`: Capability Discovery

### 10.1 Apa itu `DOMImplementation`?

`DOMImplementation` merepresentasikan implementation object yang menyediakan method untuk:

- membuat `DocumentType`;
- membuat `Document`;
- mengecek feature;
- mengambil feature-specific object.

Contoh:

```java
DOMImplementation impl = document.getImplementation();
```

### 10.2 `hasFeature` dan `getFeature`

```java
boolean supportsCore3 = impl.hasFeature("Core", "3.0");
Object lsFeature = impl.getFeature("LS", "3.0");
```

Namun dalam praktik modern, `hasFeature` sering tidak terlalu diandalkan untuk desain application logic karena:

- feature reporting dapat berbeda antar implementation;
- beberapa feature always true/legacy behavior;
- API tertentu bisa ada tetapi behavior tetap implementation-dependent;
- JAXP factory/transformer sering lebih lazim di Java application.

Gunakan feature discovery untuk **defensive interoperability**, bukan sebagai pondasi business logic.

### 10.3 Membuat document dari implementation

```java
DOMImplementation impl = DocumentBuilderFactory
    .newInstance()
    .newDocumentBuilder()
    .getDOMImplementation();

Document doc = impl.createDocument(
    "urn:example:invoice",
    "inv:invoice",
    null
);
```

Tetapi untuk aplikasi biasa, ini lebih sederhana:

```java
DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
factory.setNamespaceAware(true);
Document doc = factory.newDocumentBuilder().newDocument();
```

---

## 11. `DOMImplementationRegistry`: Pluggable Discovery

### 11.1 Apa itu registry?

`DOMImplementationRegistry` di package `org.w3c.dom.bootstrap` menyediakan cara mencari DOM implementation berdasarkan feature.

```java
DOMImplementationRegistry registry = DOMImplementationRegistry.newInstance();
DOMImplementation impl = registry.getDOMImplementation("XML 3.0");
```

Untuk Load/Save:

```java
DOMImplementationLS ls = (DOMImplementationLS)
    registry.getDOMImplementation("LS 3.0");
```

### 11.2 Kapan digunakan?

Registry berguna untuk:

- tooling generic;
- library yang perlu memilih implementation;
- environment dengan custom DOM implementation;
- eksperimen portability.

Untuk aplikasi enterprise biasa, biasanya lebih stabil memakai JAXP:

```java
DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
```

### 11.3 Failure modes

- registry tidak menemukan implementation yang diharapkan;
- classpath/module path mengandung XML API lama;
- implementation yang ditemukan berbeda antara test dan production;
- feature string salah;
- casting ke `DOMImplementationLS` gagal;
- JPMS split package karena dependency membawa `org.w3c.dom` sendiri.

Java 9+ membuat module boundary lebih tegas. Karena `org.w3c.dom` disediakan module `java.xml`, dependency lama yang juga membawa package sama dapat menimbulkan konflik split package.

---

## 12. DOM Load and Save: Boundary API

### 12.1 Apa itu Load and Save?

Package `org.w3c.dom.ls` menyediakan interface DOM Level 3 Load and Save. Secara konseptual:

```text
Load:
    XML input -> DOM Document

Save:
    DOM Node/Document -> XML output
```

Interface penting:

```text
DOMImplementationLS
    factory untuk LSParser, LSSerializer, LSInput, LSOutput

LSParser
    parser DOM LS

LSInput
    input abstraction

LSOutput
    output abstraction

LSSerializer
    serializer DOM LS
```

`DOMImplementationLS` memang didesain sebagai factory untuk Load and Save objects; dokumentasi Java SE menyebut instance-nya dapat diperoleh dari `DOMImplementation.getFeature("LS", "3.0")` atau mekanisme binding-specific casting.  

### 12.2 Contoh membuat serializer

```java
DOMImplementation impl = document.getImplementation();
DOMImplementationLS ls = (DOMImplementationLS) impl.getFeature("LS", "3.0");

if (ls == null) {
    throw new IllegalStateException("DOM Load/Save not supported by this implementation");
}

LSSerializer serializer = ls.createLSSerializer();
String xml = serializer.writeToString(document);
```

### 12.3 Contoh output stream

```java
DOMImplementationLS ls = ...;
LSSerializer serializer = ls.createLSSerializer();
LSOutput output = ls.createLSOutput();

output.setEncoding("UTF-8");
output.setByteStream(outputStream);

boolean ok = serializer.write(document, output);
if (!ok) {
    throw new IllegalStateException("DOM serialization failed");
}
```

### 12.4 Contoh parsing dengan LSParser

```java
DOMImplementationLS ls = ...;
LSParser parser = ls.createLSParser(
    DOMImplementationLS.MODE_SYNCHRONOUS,
    null
);

LSInput input = ls.createLSInput();
input.setByteStream(inputStream);
input.setEncoding("UTF-8");
input.setSystemId("invoice.xml");

Document doc = parser.parse(input);
```

### 12.5 Kenapa banyak Java code tetap pakai JAXP?

Karena JAXP lebih umum di Java ecosystem:

```java
DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
DocumentBuilder builder = factory.newDocumentBuilder();
Document doc = builder.parse(inputStream);
```

Serialization juga sering memakai transformer:

```java
Transformer transformer = TransformerFactory.newInstance().newTransformer();
transformer.transform(new DOMSource(document), new StreamResult(outputStream));
```

DOM LS tetap penting karena:

- ada langsung dalam DOM Level 3 standard API;
- beberapa implementation/tooling menggunakannya;
- `LSSerializer` dapat lebih natural saat kamu sudah berada di DOM abstraction;
- filter/configuration LS dapat berguna untuk advanced processing.

Namun untuk production portability, JAXP factory + explicit hardening sering lebih familiar, terdokumentasi, dan mudah dikontrol.

---

## 13. `LSSerializer`: Serialization Is Not Just `toString()`

### 13.1 DOM node tidak punya XML `toString()`

Kesalahan umum:

```java
System.out.println(document);
```

Output-nya bukan XML. Itu hanya object representation.

DOM serialization adalah proses:

```text
DOM tree
    -> namespace fixup
    -> character escaping
    -> XML declaration handling
    -> encoding handling
    -> output stream/writer/string
```

### 13.2 Pretty print caveat

Banyak engineer mencari:

```java
serializer.getDomConfig().setParameter("format-pretty-print", true);
```

Masalah:

- parameter support implementation-dependent;
- whitespace dalam XML bisa bermakna;
- pretty-print bisa mengubah text node layout;
- output bisa berbeda antar JDK/vendor.

Kode defensif:

```java
DOMConfiguration config = serializer.getDomConfig();
if (config.canSetParameter("format-pretty-print", Boolean.TRUE)) {
    config.setParameter("format-pretty-print", Boolean.TRUE);
}
```

### 13.3 XML declaration dan encoding

Ketika output ke `String`, encoding declaration bisa membingungkan karena `String` di Java bukan byte stream.

Preferensi production:

```text
For network/file output:
    serialize to OutputStream with explicit encoding

For logs/debug:
    serialize to String, but do not treat XML declaration encoding as byte reality
```

---

## 14. `LSParser`: Parsing Boundary and Security Warning

DOM LS parser adalah parser. Semua threat model parsing XML tetap berlaku:

- XXE;
- external entity resolution;
- DTD fetching;
- billion laughs/entity expansion;
- SSRF;
- local file disclosure;
- huge document memory blow-up.

Part 30 akan membahas secure XML parsing secara khusus. Untuk sekarang, pegang invariant ini:

```text
Never parse untrusted XML with default parser settings without explicit hardening.
```

Kalau kamu memakai `LSParser`, kamu tetap harus memikirkan feature/configuration support. Jika kamu memakai JAXP `DocumentBuilderFactory`, kamu akan punya kontrol hardening yang lebih lazim digunakan di Java.

---

## 15. Feature Support and Portability

### 15.1 DOM interfaces vs implementation behavior

`org.w3c.dom.*` sebagian besar adalah interface. Behavior konkret diberikan oleh implementation.

Di Java, implementation default umumnya berasal dari XML stack JDK, tetapi aplikasi dapat membawa parser lain melalui dependency atau factory lookup.

Konsekuensi:

```text
Compile-time type same:
    org.w3c.dom.Document

Runtime implementation may differ:
    com.sun.org.apache.xerces.internal.dom.DeferredDocumentImpl
    org.apache.xerces.dom.DocumentImpl
    custom implementation
```

Top 1% engineer tidak menulis kode seperti ini:

```java
com.sun.org.apache.xerces.internal.dom.DocumentImpl internal =
    (com.sun.org.apache.xerces.internal.dom.DocumentImpl) document;
```

Kenapa buruk:

- menggunakan internal JDK class;
- bisa rusak antar versi Java;
- JPMS membatasi akses internal;
- membuat library tidak portable;
- behavior bisa berbeda antar vendor.

### 15.2 Portable DOM rule

```text
Program to org.w3c.dom interfaces.
Use JAXP/DOM feature discovery defensively.
Avoid internal implementation classes.
Test with representative JDK versions.
```

### 15.3 Java 8–25 compatibility

DOM Level 3 sudah lama tersedia di Java SE. Perubahan utama untuk aplikasi Java 8–25 bukan sekadar API DOM berubah, tetapi environment berubah:

- Java 9 memperkenalkan module system;
- `java.xml` menjadi module eksplisit;
- internal JDK packages makin tidak boleh diandalkan;
- duplicate XML API jars makin bermasalah;
- secure processing defaults/limits dapat berbeda antar versi/update/vendor;
- serializer/parser implementation detail dapat berubah.

---

## 16. DOM Level 3 and Schema Validation Pipeline

### 16.1 `TypeInfo` membutuhkan schema-aware context

Misalnya kamu ingin `getSchemaTypeInfo()` meaningful. Kamu harus memastikan parsing/validation pipeline memang schema-aware.

JAXP style:

```java
SchemaFactory schemaFactory = SchemaFactory.newInstance(XMLConstants.W3C_XML_SCHEMA_NS_URI);
Schema schema = schemaFactory.newSchema(xsdFile);

DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
factory.setNamespaceAware(true);
factory.setSchema(schema);

DocumentBuilder builder = factory.newDocumentBuilder();
Document doc = builder.parse(xmlInput);
```

Setelah itu:

```java
Element element = doc.getDocumentElement();
TypeInfo typeInfo = element.getSchemaTypeInfo();
```

Tetap jangan menganggap semua implementation akan memberi metadata sesuai kebutuhanmu. Untuk logic domain, convert dan validate eksplisit.

### 16.2 Validation is not business correctness

XSD bisa memastikan:

```text
<amount> harus decimal
<date> harus date
<status> harus salah satu enum XML
```

Tetapi XSD tidak otomatis memastikan:

```text
amount boleh diklaim pada fase ini
status transition legal
date tidak melewati regulatory deadline
applicant punya authorization
case belum locked
```

Sehingga pipeline yang benar:

```text
XML syntax valid
  -> XML schema valid
    -> extracted DTO valid
      -> domain invariant valid
        -> workflow/state transition valid
          -> persistence transaction valid
```

---

## 17. Practical Pattern: DOM Issue Collection with Source Context

```java
public final class DomIssues {
    private final List<DomIssue> issues = new ArrayList<>();

    public void add(DomIssue issue) {
        issues.add(issue);
    }

    public boolean hasFatal() {
        for (DomIssue issue : issues) {
            if (issue.severity() == DOMError.SEVERITY_FATAL_ERROR) {
                return true;
            }
        }
        return false;
    }

    public List<DomIssue> all() {
        return Collections.unmodifiableList(new ArrayList<>(issues));
    }
}

public final class IssueCollectingHandler implements DOMErrorHandler {
    private final DomIssues issues;

    public IssueCollectingHandler(DomIssues issues) {
        this.issues = Objects.requireNonNull(issues);
    }

    @Override
    public boolean handleError(DOMError error) {
        DOMLocator loc = error.getLocation();

        issues.add(new DomIssue(
            error.getSeverity(),
            error.getType(),
            error.getMessage(),
            loc == null ? -1 : loc.getLineNumber(),
            loc == null ? -1 : loc.getColumnNumber(),
            loc == null ? null : loc.getUri()
        ));

        return error.getSeverity() != DOMError.SEVERITY_FATAL_ERROR;
    }
}
```

This pattern cocok untuk import job:

```text
Parse XML
Normalize document
Collect DOM issues
Reject if fatal/error according to policy
Extract domain DTO
Collect domain issues
Return structured report
```

---

## 18. Practical Pattern: Safe User Data Key Namespace

Jangan memakai key generic:

```java
node.setUserData("status", value, null);
node.setUserData("line", value, null);
```

Lebih aman:

```java
public final class DomUserDataKeys {
    private DomUserDataKeys() {}

    public static final String PREFIX = "com.acme.xml.";

    public static final String SOURCE_LOCATION = PREFIX + "sourceLocation";
    public static final String DOMAIN_PATH = PREFIX + "domainPath";
    public static final String VALIDATION_STATE = PREFIX + "validationState";
}
```

Kenapa?

- mencegah collision antar library;
- lebih mudah audit;
- lebih jelas ownership metadata;
- memudahkan cleanup/debugging.

---

## 19. Practical Pattern: External Metadata Map vs User Data

Kadang user data bukan pilihan terbaik.

### 19.1 User data approach

```java
node.setUserData(KEY, metadata, handler);
```

Cocok jika metadata mengikuti node selama DOM tree diproses.

### 19.2 External map approach

```java
IdentityHashMap<Node, Metadata> metadataByNode = new IdentityHashMap<>();
metadataByNode.put(node, metadata);
```

Cocok jika:

- lifecycle metadata harus terpisah;
- ingin cleanup eksplisit;
- tidak ingin memodifikasi node;
- ingin menghindari handler semantics;
- metadata besar/sensitif;
- DOM berasal dari library luar.

### 19.3 Comparison

| Approach | Kelebihan | Risiko |
|---|---|---|
| `Node.setUserData` | dekat dengan node, mudah diambil dari node | hidden coupling, leak, clone/import semantics |
| `IdentityHashMap<Node, Metadata>` | lifecycle eksplisit, tidak mencemari node | harus membawa map di traversal |
| path-based metadata | serializable, tidak tahan mutation | path invalid jika DOM berubah |
| explicit XML attributes | bertahan saat serialize | mengubah dokumen dan kontrak XML |

---

## 20. Practical Pattern: DOM LS Serializer Wrapper

```java
public final class DomLsXmlSerializer {
    public String toXml(Document document, boolean prettyPrint) {
        DOMImplementation implementation = document.getImplementation();
        Object feature = implementation.getFeature("LS", "3.0");

        if (!(feature instanceof DOMImplementationLS)) {
            throw new IllegalStateException("DOM Load/Save 3.0 is not supported");
        }

        DOMImplementationLS ls = (DOMImplementationLS) feature;
        LSSerializer serializer = ls.createLSSerializer();

        DOMConfiguration config = serializer.getDomConfig();
        if (prettyPrint && config.canSetParameter("format-pretty-print", Boolean.TRUE)) {
            config.setParameter("format-pretty-print", Boolean.TRUE);
        }

        return serializer.writeToString(document);
    }
}
```

Untuk production, pertimbangkan output stream:

```java
public void write(Document document, OutputStream out, String encoding) {
    DOMImplementation implementation = document.getImplementation();
    Object feature = implementation.getFeature("LS", "3.0");

    if (!(feature instanceof DOMImplementationLS)) {
        throw new IllegalStateException("DOM Load/Save 3.0 is not supported");
    }

    DOMImplementationLS ls = (DOMImplementationLS) feature;
    LSSerializer serializer = ls.createLSSerializer();
    LSOutput output = ls.createLSOutput();
    output.setByteStream(out);
    output.setEncoding(encoding);

    if (!serializer.write(document, output)) {
        throw new IllegalStateException("Failed to serialize DOM document");
    }
}
```

---

## 21. Design Guidance: Do Not Overuse DOM Level 3

DOM Level 3 APIs are advanced, but not always the right abstraction.

### 21.1 Use `TypeInfo` when

- kamu membangun XML tooling;
- pipeline memang schema-aware;
- metadata tipe digunakan untuk diagnostics/routing;
- kamu siap handle unavailable/unknown type info.

### 21.2 Avoid relying on `TypeInfo` when

- logic domain harus deterministic;
- schema validation belum dijalankan eksplisit;
- portability penting;
- input untrusted dan parser belum hardened;
- rule lebih baik diekspresikan sebagai domain invariant.

### 21.3 Use `UserData` when

- metadata kecil dan transient;
- metadata hanya hidup selama DOM processing;
- metadata aman jika hilang;
- kamu butuh metadata attached langsung ke node;
- clone/import behavior sudah didefinisikan.

### 21.4 Avoid `UserData` when

- metadata sensitif;
- metadata besar;
- metadata harus diserialisasi;
- metadata memegang resource;
- metadata memegang Spring bean/container/session;
- DOM tree dicache lama.

### 21.5 Use DOM LS when

- kamu berada di DOM ecosystem;
- implementation support jelas;
- kamu butuh LS-specific filter/configuration;
- kamu membangun generic DOM tooling.

### 21.6 Prefer JAXP when

- kamu membuat aplikasi enterprise umum;
- perlu secure parser hardening yang familiar;
- perlu integration dengan `SchemaFactory`, `Validator`, `Transformer`;
- tim perlu maintainability lebih tinggi.

---

## 22. Failure Modes

### 22.1 Assuming `TypeInfo` always exists

```java
String type = element.getSchemaTypeInfo().getTypeName();
```

Masalah:

- type info mungkin unknown;
- object bisa implementation-specific;
- type name bisa null;
- schema validation belum berjalan.

Lebih aman:

```java
TypeInfo info = element.getSchemaTypeInfo();
String typeName = info == null ? null : info.getTypeName();
```

Tetap treat sebagai optional metadata.

### 22.2 Treating user data as XML data

```java
node.setUserData("approved", true, null);
serialize(document);
```

`approved` tidak akan muncul di XML.

Jika harus muncul:

```java
((Element) node).setAttribute("approved", "true");
```

Atau desain schema eksplisit.

### 22.3 Storing heavy object in user data

```java
node.setUserData("service", springService, null);
```

Risiko:

- memory leak;
- hidden dependency;
- serialization misconception;
- class loader retention;
- lifecycle kacau.

### 22.4 Ignoring `canSetParameter`

```java
config.setParameter("format-pretty-print", true);
```

Bisa gagal jika parameter/value tidak didukung.

### 22.5 Swallowing DOM errors

```java
public boolean handleError(DOMError error) {
    return true;
}
```

Ini bisa membuat dokumen corrupt/invalid tetap diproses.

### 22.6 Casting to implementation class

```java
DeferredDocumentImpl doc = (DeferredDocumentImpl) document;
```

Ini fragile dan tidak portable.

### 22.7 Assuming LS parser is automatically secure

DOM LS tetap parser XML. Default behavior tidak boleh dipercaya untuk input untrusted.

### 22.8 Pretty-printing meaningful whitespace

Pretty print bisa mengubah whitespace yang dianggap data oleh consumer.

### 22.9 Confusing namespace prefix with type/feature support

Feature string DOM tidak sama dengan XML namespace prefix. Jangan mencampur konsep.

### 22.10 XML API dependency conflict in Java 9+

Membawa dependency lama seperti XML API duplicate dapat menyebabkan package conflict dengan `java.xml`.

---

## 23. Performance and Memory Considerations

### 23.1 DOM tree already expensive

DOM menyimpan seluruh tree di memory. DOM Level 3 metadata dapat menambah:

- object metadata;
- user data references;
- validation/type information;
- error collection;
- normalization cost;
- serialization buffers.

### 23.2 User data can prevent GC

Jika user data menyimpan reference besar:

```text
Document -> Node -> userData -> BigObject -> many other objects
```

Maka selama DOM hidup, semua object itu ikut tertahan.

### 23.3 Serialization to string doubles memory pressure

```java
String xml = serializer.writeToString(document);
```

Untuk XML besar:

```text
DOM tree in memory
+ serialized String in memory
+ possible internal buffers
```

Prefer `OutputStream` untuk dokumen besar.

### 23.4 Normalization may traverse whole document

`normalizeDocument()` dapat menyentuh banyak node. Jangan panggil berulang di hot path.

### 23.5 TypeInfo should not trigger lazy assumptions

Jangan desain sistem yang melakukan expensive validation hanya untuk mendapatkan type info jika sebenarnya domain extraction cukup dengan explicit parsing.

---

## 24. Security Considerations

### 24.1 DOM Level 3 does not automatically secure XML

API advanced bukan berarti secure. Threat utama tetap:

- external entity;
- DTD;
- entity expansion;
- remote resource loading;
- schema import/include dari URL;
- huge file;
- malicious namespace/prefix confusion;
- sensitive data in error messages.

### 24.2 User data and sensitive information

Jangan simpan:

- token;
- password;
- raw PII;
- auth context;
- database entity;
- session object;
- secret config.

DOM bisa dilog, didump, dicache, atau dibagikan ke layer lain.

### 24.3 Error messages can leak data

`DOMError.getMessage()` bisa memuat fragment input atau URI. Sanitasi sebelum tampil ke end user.

### 24.4 LSResourceResolver and external resources

Jika memakai LS parser/schema validation, resource resolver harus dikontrol agar tidak fetch resource sembarangan.

Part 30 akan membahas hardening secara detail.

---

## 25. Production Checklist

Sebelum memakai DOM Level 3 APIs di production, cek:

```text
[ ] Apakah fitur yang dipakai benar-benar dibutuhkan?
[ ] Apakah behavior-nya didukung implementation target?
[ ] Apakah sudah pakai canSetParameter sebelum setParameter?
[ ] Apakah DOMErrorHandler punya policy severity yang jelas?
[ ] Apakah TypeInfo hanya dianggap optional metadata?
[ ] Apakah schema validation dijalankan eksplisit jika TypeInfo dibutuhkan?
[ ] Apakah UserData kecil, immutable, non-sensitive, dan safe if lost?
[ ] Apakah UserDataHandler menangani clone/import/adopt jika perlu?
[ ] Apakah serializer output encoding eksplisit?
[ ] Apakah pretty-print tidak merusak whitespace bermakna?
[ ] Apakah parser sudah diharden untuk untrusted XML?
[ ] Apakah dependency lama yang membawa org.w3c.dom/xml-apis sudah dicek?
[ ] Apakah tidak ada cast ke internal implementation class?
[ ] Apakah behavior dites di Java 8, 11, 17, 21, 25 jika library harus cross-version?
```

---

## 26. Thought Exercises

### Exercise 1 — `TypeInfo` sebagai metadata

Kamu punya XML invoice yang divalidasi XSD. Field `amount` punya schema type `xs:decimal`. Apakah domain boleh langsung percaya `TypeInfo` untuk menyimpan ke database?

Jawaban yang diharapkan:

- tidak cukup;
- schema type hanya XML-level validity;
- domain tetap perlu range, currency, scale, transition, authorization, dan business invariant;
- `TypeInfo` bisa dipakai untuk diagnostics atau generic processing.

### Exercise 2 — User data lifecycle

Kamu menempelkan `UserContext` ke root node dengan `setUserData`. DOM kemudian dicache untuk audit/debug. Apa masalahnya?

Jawaban yang diharapkan:

- user/session context bisa bocor;
- memory leak;
- data sensitif tertahan;
- hidden coupling;
- audit object menjadi tidak murni XML;
- lifecycle context tidak sesuai lifecycle DOM.

### Exercise 3 — Serializer output

Mengapa `writeToString()` tidak ideal untuk XML besar?

Jawaban yang diharapkan:

- DOM sudah ada di memory;
- serialized string menambah memory;
- internal buffer bisa menambah lagi;
- lebih baik output stream eksplisit dengan encoding.

### Exercise 4 — `DOMConfiguration`

Kenapa harus memanggil `canSetParameter` sebelum `setParameter`?

Jawaban yang diharapkan:

- parameter support implementation-dependent;
- value tertentu bisa tidak didukung;
- portable code harus degrade gracefully atau fail eksplisit.

### Exercise 5 — `org.w3c.dom` dependency conflict

Kenapa dependency lama yang membawa `xml-apis.jar` bisa lebih bermasalah di Java 9+?

Jawaban yang diharapkan:

- `org.w3c.dom` sudah ada di module `java.xml`;
- duplicate package bisa menimbulkan split package/module conflict;
- classpath/module path behavior dapat berbeda;
- gunakan API dari JDK/module resmi, hindari duplicate package.

---

## 27. Ringkasan

DOM Level 3 memperluas DOM dari sekadar tree API menjadi contract surface untuk metadata, normalization, error reporting, feature discovery, dan load/save.

Hal yang harus diingat:

1. `TypeInfo` adalah metadata schema-level, bukan Java type dan bukan business truth.
2. `UserData` adalah metadata runtime attached ke node, bukan bagian XML.
3. `UserDataHandler` penting jika metadata harus punya behavior saat clone/import/adopt/rename.
4. `DOMConfiguration` membuat normalization/serialization lebih configurable, tetapi support parameter implementation-dependent.
5. `DOMErrorHandler` membantu membangun error reporting yang actionable.
6. `DOMImplementation` dan `DOMImplementationRegistry` adalah capability discovery, bukan pondasi business logic.
7. `org.w3c.dom.ls` menyediakan DOM Level 3 Load and Save untuk parse/serialize, tetapi JAXP sering lebih lazim untuk aplikasi Java production.
8. DOM implementation portability harus dijaga dengan tidak bergantung pada internal JDK/vendor classes.
9. Java 8–25 compatibility lebih banyak terdampak module boundary, dependency conflict, parser behavior, dan secure processing defaults daripada perubahan API DOM Level 3 itu sendiri.
10. DOM Level 3 powerful, tetapi harus dipakai sebagai advanced boundary tool, bukan sebagai domain model.

---

## 28. Status Seri

Progress saat ini:

```text
Part 0  selesai
Part 1  selesai
Part 2  selesai
Part 3  selesai
Part 4  selesai
Part 5  selesai
Part 6  selesai
Part 7  selesai
Part 8  selesai
Part 9  selesai
Part 10 selesai
Part 11 selesai
Part 12 selesai
Part 13 selesai
Part 14 selesai
Part 15 selesai
Part 16 selesai
Part 17 selesai
Part 18 selesai
Part 19 selesai
Part 20 selesai
Part 21 selesai
Part 22 selesai
Part 23 selesai
Part 24 selesai
Part 25 selesai
Part 26 selesai
Part 27 selesai
```

Seri belum selesai.

Part berikutnya:

```text
Part 28 — SAX Mental Model: Push Events, Stateless Parsing, Handler Contracts
File: 28-sax-mental-model-push-events-handler-contracts.md
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 26 — DOM Querying: Traversal, Namespaces, NodeList, Element APIs](./26-dom-querying-traversal-namespaces-nodelist-element-apis.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 28 — SAX Mental Model: Push Events, Stateless Parsing, Handler Contracts](./28-sax-mental-model-push-events-handler-contracts.md)
