# Part 28 — SAX Mental Model: Push Events, Stateless Parsing, Handler Contracts

> Series: `learn-java-lang-dom-sax-core-runtime-platform-contracts`  
> File: `28-sax-mental-model-push-events-handler-contracts.md`  
> Scope: Java 8 hingga Java 25, package `org.xml.sax.*`, `org.xml.sax.helpers.*`, dan boundary dengan `javax.xml.parsers.SAXParserFactory`/`SAXParser`  
> Fokus: mental model SAX sebagai event-driven parser contract, bukan sekadar “cara membaca XML”.

---

## 1. Tujuan Part Ini

Pada part sebelumnya kita sudah membahas DOM sebagai **mutable in-memory tree**. DOM memberi ilusi nyaman: XML dimuat penuh menjadi object graph, lalu kita bisa query dan mutasi sesuka hati. SAX berada di sisi ekstrem yang berbeda.

SAX adalah model parsing XML berbasis **push events**:

- parser membaca XML secara sekuensial;
- parser memanggil callback pada handler milik aplikasi;
- aplikasi tidak memegang tree dokumen penuh;
- aplikasi harus membangun state sendiri;
- aplikasi harus memahami bahwa event datang dalam urutan stream, bukan dalam bentuk object model yang lengkap.

Tujuan part ini:

1. memahami SAX sebagai **control-flow inversion**: parser yang mengendalikan alur;
2. memahami kontrak utama `XMLReader`, `ContentHandler`, `DefaultHandler`, `Attributes`, `Locator`, dan `ErrorHandler`;
3. membangun mental model state machine untuk ekstraksi XML;
4. memahami kenapa `characters()` bisa dipanggil berkali-kali untuk satu text node;
5. memahami batas SAX dibanding DOM dan StAX;
6. memahami failure modes production ketika memakai SAX secara naif;
7. mampu mendesain handler yang aman, testable, deterministic, dan tidak rapuh.

Part ini belum fokus pada hardening XXE/entity/DTD secara penuh. Itu akan dibahas lebih dalam di Part 29 dan Part 30. Namun karena SAX selalu berdekatan dengan parsing XML, beberapa catatan keamanan akan mulai muncul.

---

## 2. Mental Model Utama

### 2.1 DOM adalah tree; SAX adalah event stream

Bayangkan XML berikut:

```xml
<case id="C-001">
  <status>OPEN</status>
  <owner>Fajar</owner>
</case>
```

DOM melihatnya sebagai tree:

```text
Document
└── case
    ├── @id = C-001
    ├── status
    │   └── Text("OPEN")
    └── owner
        └── Text("Fajar")
```

SAX melihatnya sebagai urutan kejadian:

```text
startDocument
startElement(case, attrs: id=C-001)
characters(whitespace/newline)
startElement(status)
characters("OPEN")
endElement(status)
characters(whitespace/newline)
startElement(owner)
characters("Fajar")
endElement(owner)
characters(whitespace/newline)
endElement(case)
endDocument
```

Perbedaannya besar:

- DOM membuat struktur dulu, aplikasi mengakses belakangan;
- SAX mengirim kejadian saat parser menemukan struktur;
- DOM cocok untuk random access;
- SAX cocok untuk sequential extraction;
- DOM memakai memory seukuran dokumen plus overhead tree;
- SAX memory bisa kecil, tetapi kompleksitas state pindah ke handler aplikasi.

### 2.2 SAX adalah “parser drives application”

Di DOM, kode aplikasi biasanya seperti ini:

```java
Document document = builder.parse(input);
Element root = document.getDocumentElement();
String status = root.getElementsByTagName("status").item(0).getTextContent();
```

Di SAX, alurnya terbalik:

```java
reader.setContentHandler(handler);
reader.parse(inputSource);
```

Aplikasi tidak memanggil `next()` untuk mengambil data. Parser memanggil aplikasi:

```java
handler.startElement(...);
handler.characters(...);
handler.endElement(...);
```

Ini disebut **inversion of control**.

Konsekuensinya:

- handler harus menyimpan state parsing;
- handler harus tahu “saat ini saya sedang berada di elemen apa?”;
- handler harus tahu kapan text sudah lengkap;
- handler harus tahu kapan domain object boleh dibentuk;
- handler harus tahu kapan error harus dilempar untuk menghentikan parsing.

### 2.3 SAX bukan object mapper

SAX tidak otomatis mengubah XML menjadi object domain.

SAX hanya memberi event. Mapping ke object adalah tanggung jawab aplikasi.

Contoh:

```xml
<case id="C-001">
  <status>OPEN</status>
</case>
```

SAX tidak menghasilkan:

```java
new Case("C-001", Status.OPEN)
```

SAX hanya memberi:

```text
startElement case
startElement status
characters OPEN
endElement status
endElement case
```

Aplikasi harus membangun:

```java
class CaseHandler extends DefaultHandler {
    private String currentCaseId;
    private String currentStatus;
}
```

Ini membuat SAX sangat kuat untuk large input, tetapi sangat mudah salah jika state handler tidak didesain rapi.

---

## 3. Posisi SAX dalam Java Platform

### 3.1 Package utama

API SAX di Java berada di module `java.xml`.

Package penting:

```text
org.xml.sax
org.xml.sax.ext
org.xml.sax.helpers
javax.xml.parsers
```

`org.xml.sax` menyediakan kontrak utama:

- `XMLReader`
- `ContentHandler`
- `Attributes`
- `InputSource`
- `Locator`
- `ErrorHandler`
- `EntityResolver`
- `DTDHandler`
- `SAXException`
- `SAXParseException`
- beberapa API SAX1 yang deprecated seperti `Parser`, `DocumentHandler`, `AttributeList`, `HandlerBase`

`org.xml.sax.helpers` menyediakan helper:

- `DefaultHandler`
- `XMLReaderFactory` legacy/helper
- `AttributesImpl`
- `LocatorImpl`
- `XMLFilterImpl`
- `NamespaceSupport`

`javax.xml.parsers` menyediakan factory JAXP:

- `SAXParserFactory`
- `SAXParser`

Dalam aplikasi modern Java, biasanya kita membuat parser melalui `SAXParserFactory`, lalu mengambil `XMLReader` atau langsung parse dengan `DefaultHandler`.

### 3.2 SAX1 vs SAX2

SAX1 adalah API lama. SAX2 menambahkan namespace support dan mengganti beberapa interface lama.

Modern usage sebaiknya memakai:

```text
XMLReader        bukan Parser
ContentHandler   bukan DocumentHandler
Attributes       bukan AttributeList
DefaultHandler   bukan HandlerBase
```

Kenapa penting?

Karena XML modern hampir selalu perlu namespace awareness. SOAP, SAML, Maven POM, SVG, XHTML, Office XML, banyak regulatory XML, dan banyak integration format memakai namespace.

Kode SAX yang tidak namespace-aware biasanya kelihatan jalan pada sample kecil, lalu gagal ketika:

- prefix berubah;
- default namespace dipakai;
- dokumen valid tetapi `qName` berbeda;
- dua elemen punya local name sama tetapi namespace berbeda.

---

## 4. Kontrak Inti SAX

### 4.1 `XMLReader`

`XMLReader` adalah interface SAX2 untuk parser.

Perannya:

- menerima `InputSource`;
- menjalankan parsing;
- memanggil handler;
- menyimpan fitur/properti parser;
- menerima handler untuk content, error, entity, dan DTD.

Pola umum:

```java
SAXParserFactory factory = SAXParserFactory.newInstance();
factory.setNamespaceAware(true);

SAXParser parser = factory.newSAXParser();
XMLReader reader = parser.getXMLReader();

reader.setContentHandler(handler);
reader.setErrorHandler(handler);
reader.parse(new InputSource(inputStream));
```

Mental model:

```text
InputSource -> XMLReader -> callbacks -> handler state -> extracted result
```

`XMLReader` bukan reader seperti `java.io.Reader`. Ia adalah parser driver.

### 4.2 `ContentHandler`

`ContentHandler` adalah pusat event XML.

Method penting:

```java
void startDocument()
void endDocument()
void startElement(String uri, String localName, String qName, Attributes atts)
void endElement(String uri, String localName, String qName)
void characters(char[] ch, int start, int length)
void ignorableWhitespace(char[] ch, int start, int length)
void processingInstruction(String target, String data)
void setDocumentLocator(Locator locator)
void startPrefixMapping(String prefix, String uri)
void endPrefixMapping(String prefix)
void skippedEntity(String name)
```

Dalam banyak parser sederhana, kamu hanya override:

```java
startDocument
startElement
characters
endElement
endDocument
```

Namun untuk production XML, `Locator`, namespace prefix mapping, error handling, dan entity handling sering penting.

### 4.3 `DefaultHandler`

`DefaultHandler` adalah convenience base class.

Ia mengimplementasikan beberapa interface sekaligus dengan default no-op:

- `ContentHandler`
- `ErrorHandler`
- `EntityResolver`
- `DTDHandler`

Karena itu kita bisa membuat handler seperti ini:

```java
class CaseHandler extends DefaultHandler {
    @Override
    public void startElement(String uri, String localName, String qName, Attributes attributes) {
        // handle start tag
    }
}
```

Penting: `DefaultHandler` bukan berarti default behavior-nya aman untuk semua kebutuhan. Ia hanya membuat implementasi lebih pendek.

Untuk production, sering kali kamu tetap harus override:

```java
error(...)
fatalError(...)
warning(...)
resolveEntity(...)
```

### 4.4 `Attributes`

`Attributes` merepresentasikan atribut pada start element.

Contoh XML:

```xml
<case id="C-001" source="portal"/>
```

Saat `startElement` untuk `case`, parameter `Attributes` berisi `id` dan `source`.

Contoh akses:

```java
String id = attributes.getValue("id");
```

Untuk namespace-aware parsing, lebih baik:

```java
String id = attributes.getValue("", "id");
```

atau bila atribut punya namespace:

```java
String value = attributes.getValue("urn:example", "externalId");
```

Jangan menyimpan object `Attributes` untuk dipakai lama tanpa menyalinnya. Parser boleh reuse/mutate struktur internal setelah callback selesai. Jika perlu menyimpan, copy ke struktur sendiri.

### 4.5 `Locator`

`Locator` memberi informasi posisi dokumen:

- line number;
- column number;
- public id;
- system id.

Contoh:

```java
private Locator locator;

@Override
public void setDocumentLocator(Locator locator) {
    this.locator = locator;
}

private String location() {
    if (locator == null) return "unknown location";
    return "line " + locator.getLineNumber() + ", column " + locator.getColumnNumber();
}
```

`Locator` sangat penting untuk error message yang bisa ditindaklanjuti.

Bandingkan:

```text
Invalid status
```

vs:

```text
Invalid status 'UNKNOWN' at line 287, column 19, case id C-001
```

Untuk import job, batch processing, regulatory data ingestion, dan production support, location-aware error adalah perbedaan antara debugging 5 menit dan debugging 5 jam.

### 4.6 `ErrorHandler`

`ErrorHandler` menerima parse warning/error/fatal error:

```java
void warning(SAXParseException exception)
void error(SAXParseException exception)
void fatalError(SAXParseException exception)
```

`fatalError` biasanya harus menghentikan parsing. `error` bisa tergantung konfigurasi validation dan parser.

Dalam production, jangan diamkan error.

Contoh pola tegas:

```java
@Override
public void fatalError(SAXParseException e) throws SAXException {
    throw e;
}

@Override
public void error(SAXParseException e) throws SAXException {
    throw e;
}

@Override
public void warning(SAXParseException e) throws SAXException {
    // log atau collect warning sesuai policy
}
```

Jika handler diam terhadap error, aplikasi bisa terlihat “sukses” padahal input tidak valid atau sebagian data tidak diproses sesuai ekspektasi.

---

## 5. Event Lifecycle SAX

### 5.1 Urutan event umum

Untuk XML:

```xml
<?xml version="1.0"?>
<cases>
  <case id="C-001">
    <status>OPEN</status>
  </case>
</cases>
```

Event kira-kira:

```text
setDocumentLocator(locator)
startDocument()
startElement(uri="", localName="cases", qName="cases", attrs=[])
characters("\n  ")
startElement(uri="", localName="case", qName="case", attrs=[id=C-001])
characters("\n    ")
startElement(uri="", localName="status", qName="status", attrs=[])
characters("OPEN")
endElement(uri="", localName="status", qName="status")
characters("\n  ")
endElement(uri="", localName="case", qName="case")
characters("\n")
endElement(uri="", localName="cases", qName="cases")
endDocument()
```

Whitespace adalah event juga.

Ini penting karena handler yang terlalu naif sering mengira `characters()` hanya berisi data bisnis. Padahal bisa berisi newline, indentation, atau text fragment.

### 5.2 `characters()` bukan “complete text node” guarantee

Ini salah satu aturan paling penting SAX.

`characters(char[] ch, int start, int length)` bisa dipanggil:

- sekali untuk isi text;
- beberapa kali untuk isi text yang sama;
- terpisah karena buffer parser;
- terpisah karena entity boundary;
- terpisah karena CDATA boundary;
- bercampur dengan whitespace callbacks tergantung parser/validation.

Jangan menulis:

```java
@Override
public void characters(char[] ch, int start, int length) {
    currentStatus = new String(ch, start, length);
}
```

Karena jika text terfragmentasi:

```text
characters("OP")
characters("EN")
```

hasil akhirnya bisa hanya `EN`.

Pola benar:

```java
private StringBuilder text = new StringBuilder();

@Override
public void startElement(String uri, String localName, String qName, Attributes attributes) {
    text.setLength(0);
}

@Override
public void characters(char[] ch, int start, int length) {
    text.append(ch, start, length);
}

@Override
public void endElement(String uri, String localName, String qName) {
    String value = text.toString();
}
```

Namun pola di atas masih terlalu sederhana jika ada nested element. Untuk XML kompleks, kamu butuh stack state, bukan satu global `StringBuilder`.

---

## 6. Handler sebagai State Machine

### 6.1 Kenapa state machine penting

SAX tidak memberi “current node”. Handler harus tahu sendiri posisinya.

Misalnya XML:

```xml
<case id="C-001">
  <applicant>
    <name>Alice</name>
  </applicant>
  <officer>
    <name>Bob</name>
  </officer>
</case>
```

Jika handler hanya mengecek `localName.equals("name")`, ia tidak tahu apakah name adalah applicant name atau officer name.

Perlu context:

```text
/case/applicant/name
/case/officer/name
```

SAX handler production sering membutuhkan salah satu dari:

- stack path;
- enum state;
- nested builder object;
- domain-specific state machine;
- combination of path + builder.

### 6.2 Path stack pattern

Pola sederhana:

```java
private final Deque<String> path = new ArrayDeque<>();
private final StringBuilder text = new StringBuilder();

@Override
public void startElement(String uri, String localName, String qName, Attributes attributes) {
    path.addLast(localNameOrQName(localName, qName));
    text.setLength(0);
}

@Override
public void characters(char[] ch, int start, int length) {
    text.append(ch, start, length);
}

@Override
public void endElement(String uri, String localName, String qName) {
    String pathNow = String.join("/", path);
    String value = text.toString().trim();

    if ("case/applicant/name".equals(pathNow)) {
        // applicant name
    } else if ("case/officer/name".equals(pathNow)) {
        // officer name
    }

    path.removeLast();
    text.setLength(0);
}
```

Kelemahan:

- string path bisa boros;
- nested mixed content bisa salah;
- `text.setLength(0)` pada start element bisa menghapus text parent jika mixed content;
- kurang cocok untuk struktur besar.

Tetap berguna untuk dokumen sederhana.

### 6.3 Enum state pattern

Untuk XML dengan bentuk jelas:

```java
enum State {
    OUTSIDE,
    IN_CASE,
    IN_STATUS,
    IN_OWNER
}
```

Contoh:

```java
private State state = State.OUTSIDE;
private final StringBuilder text = new StringBuilder();

@Override
public void startElement(String uri, String localName, String qName, Attributes attributes) {
    String name = localNameOrQName(localName, qName);
    text.setLength(0);

    switch (state) {
        case OUTSIDE -> {
            if ("case".equals(name)) state = State.IN_CASE;
        }
        case IN_CASE -> {
            if ("status".equals(name)) state = State.IN_STATUS;
            else if ("owner".equals(name)) state = State.IN_OWNER;
        }
        default -> {
            // nested unexpected element policy
        }
    }
}

@Override
public void characters(char[] ch, int start, int length) {
    text.append(ch, start, length);
}

@Override
public void endElement(String uri, String localName, String qName) {
    String name = localNameOrQName(localName, qName);
    String value = text.toString().trim();

    switch (state) {
        case IN_STATUS -> {
            currentStatus = value;
            state = State.IN_CASE;
        }
        case IN_OWNER -> {
            currentOwner = value;
            state = State.IN_CASE;
        }
        case IN_CASE -> {
            if ("case".equals(name)) {
                emitCase();
                state = State.OUTSIDE;
            }
        }
        default -> { }
    }

    text.setLength(0);
}
```

Kelemahan:

- state transition bisa rumit jika schema kompleks;
- nested repeated element bisa membuat enum membengkak;
- raw enum state kurang ekspresif untuk hierarchical context.

### 6.4 Stack of frames pattern

Untuk struktur yang lebih kompleks, pakai frame.

```java
record Frame(String uri, String localName, String qName, StringBuilder text) {}
```

Handler:

```java
private final Deque<Frame> stack = new ArrayDeque<>();

@Override
public void startElement(String uri, String localName, String qName, Attributes attributes) {
    stack.addLast(new Frame(uri, localName, qName, new StringBuilder()));
}

@Override
public void characters(char[] ch, int start, int length) {
    if (!stack.isEmpty()) {
        stack.getLast().text().append(ch, start, length);
    }
}

@Override
public void endElement(String uri, String localName, String qName) {
    Frame frame = stack.removeLast();
    String text = frame.text().toString();

    // process completed element

    if (!stack.isEmpty()) {
        // optional: preserve mixed text into parent, if needed
        stack.getLast().text().append(text);
    }
}
```

Kelebihan:

- text tiap element tidak saling menimpa;
- nested element lebih aman;
- bisa attach metadata per element;
- mudah menyimpan line/column per start element.

Kekurangan:

- lebih banyak object allocation;
- perlu policy jelas untuk mixed content;
- untuk dokumen sangat besar dan sangat dalam, stack bisa membesar sesuai depth.

### 6.5 Builder object pattern

Untuk streaming list besar:

```xml
<cases>
  <case id="C-001"><status>OPEN</status></case>
  <case id="C-002"><status>CLOSED</status></case>
</cases>
```

SAX cocok untuk memproses setiap `<case>` satu per satu tanpa menahan semuanya di memory.

```java
class CaseSaxHandler extends DefaultHandler {
    private CaseBuilder currentCase;
    private String currentElement;
    private final StringBuilder text = new StringBuilder();
    private final Consumer<CaseRecord> sink;

    CaseSaxHandler(Consumer<CaseRecord> sink) {
        this.sink = sink;
    }

    @Override
    public void startElement(String uri, String localName, String qName, Attributes attributes) {
        String name = localNameOrQName(localName, qName);
        currentElement = name;
        text.setLength(0);

        if ("case".equals(name)) {
            currentCase = new CaseBuilder();
            currentCase.id = required(attributes, "id");
        }
    }

    @Override
    public void characters(char[] ch, int start, int length) {
        text.append(ch, start, length);
    }

    @Override
    public void endElement(String uri, String localName, String qName) throws SAXException {
        String name = localNameOrQName(localName, qName);
        String value = text.toString().trim();

        if (currentCase != null) {
            switch (name) {
                case "status" -> currentCase.status = value;
                case "owner" -> currentCase.owner = value;
                case "case" -> {
                    sink.accept(currentCase.build());
                    currentCase = null;
                }
                default -> { }
            }
        }

        text.setLength(0);
    }
}
```

Ini pola umum untuk import besar:

```text
read XML stream -> build one record -> validate -> emit/process -> discard -> continue
```

---

## 7. Contoh Bertahap: Parser Case XML

### 7.1 Domain record

```java
record CaseRecord(String id, String status, String owner) {}
```

Untuk Java 8, gunakan class biasa.

```java
final class CaseRecord {
    private final String id;
    private final String status;
    private final String owner;

    CaseRecord(String id, String status, String owner) {
        this.id = id;
        this.status = status;
        this.owner = owner;
    }

    public String id() { return id; }
    public String status() { return status; }
    public String owner() { return owner; }
}
```

### 7.2 XML input

```xml
<cases>
  <case id="C-001">
    <status>OPEN</status>
    <owner>Fajar</owner>
  </case>
  <case id="C-002">
    <status>CLOSED</status>
    <owner>Alice</owner>
  </case>
</cases>
```

### 7.3 Handler sederhana tetapi benar terhadap text fragmentation

```java
import org.xml.sax.Attributes;
import org.xml.sax.SAXException;
import org.xml.sax.helpers.DefaultHandler;

import java.util.ArrayList;
import java.util.List;

public final class CaseListHandler extends DefaultHandler {
    private final List<CaseRecord> cases = new ArrayList<>();
    private final StringBuilder text = new StringBuilder();

    private String currentId;
    private String currentStatus;
    private String currentOwner;
    private boolean insideCase;

    public List<CaseRecord> cases() {
        return List.copyOf(cases); // Java 10+. For Java 8, return Collections.unmodifiableList(new ArrayList<>(cases)).
    }

    @Override
    public void startElement(String uri, String localName, String qName, Attributes attributes)
            throws SAXException {
        String name = name(localName, qName);
        text.setLength(0);

        if ("case".equals(name)) {
            insideCase = true;
            currentId = attributes.getValue("id");
            currentStatus = null;
            currentOwner = null;

            if (currentId == null || currentId.isBlank()) {
                throw new SAXException("case/@id is required");
            }
        }
    }

    @Override
    public void characters(char[] ch, int start, int length) {
        text.append(ch, start, length);
    }

    @Override
    public void endElement(String uri, String localName, String qName) throws SAXException {
        String name = name(localName, qName);
        String value = text.toString().trim();

        if (insideCase) {
            switch (name) {
                case "status" -> currentStatus = value;
                case "owner" -> currentOwner = value;
                case "case" -> {
                    if (currentStatus == null || currentStatus.isBlank()) {
                        throw new SAXException("case/status is required for id=" + currentId);
                    }
                    cases.add(new CaseRecord(currentId, currentStatus, currentOwner));
                    insideCase = false;
                }
                default -> { }
            }
        }

        text.setLength(0);
    }

    private static String name(String localName, String qName) {
        return localName != null && !localName.isEmpty() ? localName : qName;
    }
}
```

Catatan:

- `characters()` append, bukan assign;
- validasi dilakukan saat data cukup lengkap;
- object dibuat saat `endElement(case)`;
- handler tidak mencoba membuat DOM kecil secara manual;
- untuk XML namespace-aware, name matching perlu berbasis URI/localName.

### 7.4 Parser setup

```java
import org.xml.sax.InputSource;
import org.xml.sax.XMLReader;

import javax.xml.parsers.SAXParser;
import javax.xml.parsers.SAXParserFactory;
import java.io.InputStream;

public final class CaseXmlParser {
    public static List<CaseRecord> parse(InputStream inputStream) throws Exception {
        SAXParserFactory factory = SAXParserFactory.newInstance();
        factory.setNamespaceAware(true);

        SAXParser parser = factory.newSAXParser();
        XMLReader reader = parser.getXMLReader();

        CaseListHandler handler = new CaseListHandler();
        reader.setContentHandler(handler);
        reader.setErrorHandler(handler);

        reader.parse(new InputSource(inputStream));
        return handler.cases();
    }
}
```

Untuk production, Part 29/30 nanti akan menambahkan feature hardening.

---

## 8. Namespace-Aware Mental Model Dasar

Namespace detail akan dibahas lebih dalam di Part 29, tetapi handler SAX dari awal harus disiapkan dengan mental model benar.

XML:

```xml
<c:case xmlns:c="urn:case" id="C-001">
  <c:status>OPEN</c:status>
</c:case>
```

Saat namespace-aware true, `startElement` menerima:

```text
uri       = "urn:case"
localName = "case"
qName     = "c:case"   // tergantung setting namespace-prefixes
```

Jangan pakai prefix sebagai identitas bisnis. Prefix hanya alias lexical di dokumen.

Dua dokumen berikut setara secara namespace:

```xml
<c:case xmlns:c="urn:case"/>
```

```xml
<x:case xmlns:x="urn:case"/>
```

Handler yang mengecek `qName.equals("c:case")` akan gagal pada dokumen kedua.

Pola lebih benar:

```java
private static final String CASE_NS = "urn:case";

private static boolean isElement(String uri, String localName, String expectedUri, String expectedLocal) {
    return expectedUri.equals(uri) && expectedLocal.equals(localName);
}
```

Kemudian:

```java
if (isElement(uri, localName, CASE_NS, "case")) {
    // process case
}
```

---

## 9. SAX vs DOM vs StAX

### 9.1 DOM

DOM cocok jika:

- dokumen kecil/menengah;
- perlu random access;
- perlu mutasi tree;
- perlu query berulang;
- perlu preserve struktur tertentu;
- developer productivity lebih penting daripada memory.

DOM kurang cocok jika:

- file sangat besar;
- hanya perlu extract sequential records;
- memory limit ketat;
- input tidak dipercaya dan bisa menyebabkan memory blow-up.

### 9.2 SAX

SAX cocok jika:

- input besar;
- alur baca sequential;
- ingin emit record satu per satu;
- ingin memory kecil;
- ingin pipeline processing;
- tidak perlu random access ke elemen masa lalu;
- format dokumen relatif stabil.

SAX kurang cocok jika:

- mapping sangat kompleks;
- butuh lookahead/lookbehind banyak;
- butuh random access;
- butuh mutasi XML;
- handler state menjadi terlalu rumit;
- developer butuh model pull yang lebih mudah dikontrol.

### 9.3 StAX

StAX adalah pull parser.

Dengan StAX, aplikasi memanggil parser:

```java
while (reader.hasNext()) {
    int event = reader.next();
}
```

SAX:

```text
parser -> calls handler
```

StAX:

```text
application -> asks parser for next event
```

StAX sering lebih nyaman untuk parser custom karena control flow tetap di aplikasi. Namun SAX tetap sangat relevan:

- API lama dan luas dukungannya;
- banyak library Java memakai SAX internally;
- callback model cocok untuk filter/pipeline;
- overhead bisa rendah;
- familiar di banyak integration stack.

### 9.4 Rule of thumb

```text
Need full tree/random access/mutation?       DOM
Need sequential event processing, callback?  SAX
Need sequential processing but app controls? StAX
Need object binding?                         JAXB/Jackson XML/etc.
```

Namun ini bukan aturan absolut. Pilih berdasarkan:

- ukuran input;
- trust boundary;
- kebutuhan validation;
- complexity mapping;
- memory budget;
- error reporting;
- streaming/partial processing;
- maintainability handler.

---

## 10. Production Design Patterns

### 10.1 Emit-per-record pattern

Untuk file besar, hindari menampung semua hasil.

Buruk:

```java
List<CaseRecord> all = new ArrayList<>();
// millions of records
```

Lebih baik:

```java
class CaseHandler extends DefaultHandler {
    private final Consumer<CaseRecord> sink;

    CaseHandler(Consumer<CaseRecord> sink) {
        this.sink = sink;
    }

    private void completeCase(CaseRecord record) {
        sink.accept(record);
    }
}
```

Sink bisa:

- write batch ke database;
- send ke queue;
- validate dan collect error;
- write ke temp file;
- pass ke downstream service.

### 10.2 Bounded error collection

Dalam import besar, kadang kamu tidak ingin stop pada error pertama. Namun kamu juga tidak ingin collect jutaan error di memory.

Pola:

```java
final class ErrorCollector {
    private final int maxErrors;
    private final List<String> errors = new ArrayList<>();

    ErrorCollector(int maxErrors) {
        this.maxErrors = maxErrors;
    }

    void add(String error) throws SAXException {
        if (errors.size() < maxErrors) {
            errors.add(error);
        }
        if (errors.size() >= maxErrors) {
            throw new SAXException("Too many XML validation errors: " + maxErrors);
        }
    }
}
```

### 10.3 Location-aware domain error

```java
private SAXException domainError(String message) {
    if (locator == null) {
        return new SAXException(message);
    }
    return new SAXException(message + " at line " + locator.getLineNumber()
            + ", column " + locator.getColumnNumber());
}
```

Gunakan untuk validasi domain:

```java
if (!Set.of("OPEN", "CLOSED").contains(currentStatus)) {
    throw domainError("Invalid case status: " + currentStatus);
}
```

### 10.4 Separate parsing from business processing

Jangan taruh business side-effect berat langsung di handler kalau bisa dihindari.

Buruk:

```java
@Override
public void endElement(...) {
    if ("case".equals(name)) {
        database.insert(...);
        email.send(...);
        audit.write(...);
    }
}
```

Lebih baik:

```text
SAX handler -> emits validated parsing event/record -> application service handles transaction/side-effect
```

Alasannya:

- handler lebih testable;
- transaction boundary lebih jelas;
- retry lebih mudah;
- parser error tidak bercampur dengan infrastructure failure;
- observability lebih rapi.

### 10.5 Handler should be single-use unless explicitly reset

Handler SAX sering memiliki mutable state.

Jangan reuse handler antar parse kecuali punya `reset()` yang benar.

Buruk:

```java
CaseHandler handler = new CaseHandler();
reader.parse(input1);
reader.parse(input2); // state lama bisa bocor
```

Lebih aman:

```java
CaseHandler handler = new CaseHandler();
reader.setContentHandler(handler);
reader.parse(input);
```

Buat handler baru per parse.

---

## 11. Failure Modes yang Paling Sering Terjadi

### 11.1 Menganggap `characters()` selalu lengkap

Gejala:

- data kadang terpotong;
- bug muncul hanya di file tertentu;
- test kecil lolos;
- production import gagal random.

Akar masalah:

```java
value = new String(ch, start, length); // overwrite
```

Solusi:

```java
text.append(ch, start, length);
```

Tapi tetap desain context dengan benar.

### 11.2 Mengabaikan whitespace

XML pretty-printed menghasilkan whitespace event.

Jika handler tidak membedakan whitespace, bisa muncul:

```text
current value = "\n    "
```

Solusi:

- trim hanya pada element yang secara schema memang text simple;
- jangan trim mixed content sembarangan;
- validasi content model;
- pahami bahwa whitespace bisa signifikan.

### 11.3 State global terlalu sederhana

Contoh:

```java
private String currentElement;
```

Ini gagal ketika elemen nested punya nama sama.

Solusi:

- path stack;
- frame stack;
- domain state machine;
- namespace-aware matching.

### 11.4 Prefix-based namespace matching

Buruk:

```java
if ("soap:Envelope".equals(qName)) { ... }
```

Lebih benar:

```java
if (SOAP_NS.equals(uri) && "Envelope".equals(localName)) { ... }
```

### 11.5 Error handler no-op

Jika `ErrorHandler` tidak eksplisit, perilaku bisa tidak sesuai policy aplikasi.

Solusi:

- tentukan warning/error/fatal policy;
- convert ke domain exception jika perlu;
- sertakan location;
- jangan lanjut diam-diam pada fatal parse error.

### 11.6 Menyimpan `Attributes` langsung

Buruk:

```java
this.savedAttributes = attributes;
```

Solusi:

```java
Map<String, String> copy = new LinkedHashMap<>();
for (int i = 0; i < attributes.getLength(); i++) {
    copy.put(attributes.getQName(i), attributes.getValue(i));
}
```

Atau pakai `AttributesImpl`:

```java
Attributes copy = new AttributesImpl(attributes);
```

### 11.7 Handler melakukan side effect tidak idempotent

Jika parsing gagal di tengah setelah sebagian side effect dilakukan:

- DB sudah insert sebagian;
- queue sudah terisi sebagian;
- email sudah terkirim;
- audit tidak lengkap.

Solusi:

- batch transaction;
- staging table;
- idempotency key;
- parse-validate first untuk file kecil;
- emit to controlled pipeline;
- recovery strategy.

### 11.8 Tidak membatasi ukuran text

SAX hemat memory hanya jika handler juga hemat memory.

Jika handler melakukan:

```java
text.append(...)
```

untuk element yang bisa sangat besar, memory tetap bisa habis.

Solusi:

- enforce max text length;
- stream large binary/text field secara khusus;
- reject input terlalu besar;
- monitor record size.

Contoh:

```java
private static final int MAX_TEXT = 10_000;

@Override
public void characters(char[] ch, int start, int length) throws SAXException {
    if (text.length() + length > MAX_TEXT) {
        throw new SAXException("Element text too large");
    }
    text.append(ch, start, length);
}
```

---

## 12. Performance dan Memory Considerations

### 12.1 SAX memory kecil bukan otomatis

SAX tidak membuat DOM tree. Itu bagus.

Tetapi aplikasi masih bisa membuat memory blow-up jika:

- menyimpan semua result di list;
- mengumpulkan semua error tanpa batas;
- append text tanpa limit;
- menyimpan path string per event;
- membuat object berlebihan pada setiap callback;
- melakukan logging tiap element.

### 12.2 Callback frequency tinggi

SAX memanggil method banyak sekali.

Untuk XML besar, hindari di hot path:

- regex berat;
- string path concat terus-menerus;
- excessive logging;
- database call per small element;
- exception sebagai control flow normal;
- membuat temporary object tidak perlu.

### 12.3 Batch downstream

Jika handler emit record ke database, jangan insert satu per satu tanpa batching.

Pola:

```text
SAX emits record -> buffer 500/1000 records -> batch insert -> clear buffer
```

Dengan batas:

- max batch size;
- max memory;
- max transaction time;
- retry/idempotency policy.

### 12.4 Avoid premature micro-optimization

Optimization handler SAX harus berdasarkan profil:

- ukuran file rata-rata dan maksimum;
- jumlah record;
- depth maksimum;
- ukuran text maksimum;
- throughput target;
- downstream bottleneck.

Sering kali bottleneck bukan SAX parser, tetapi:

- database insert;
- network call;
- validation service;
- logging;
- schema validation;
- disk IO.

---

## 13. Testing SAX Handler

### 13.1 Unit test handler dengan XML kecil

Test kasus:

- happy path;
- missing required attribute;
- missing required child;
- invalid enum/status;
- repeated elements;
- nested same-name elements;
- namespace prefix berbeda;
- whitespace indentation;
- empty element;
- large text;
- malformed XML.

### 13.2 Test `characters()` fragmentation

Karena parser mungkin tidak mudah dipaksa fragment text, test handler langsung bisa memanggil callback manual.

Contoh:

```java
CaseListHandler handler = new CaseListHandler();
handler.startDocument();
handler.startElement("", "case", "case", attrs("id", "C-001"));
handler.startElement("", "status", "status", emptyAttrs());
handler.characters("OP".toCharArray(), 0, 2);
handler.characters("EN".toCharArray(), 0, 2);
handler.endElement("", "status", "status");
handler.endElement("", "case", "case");
handler.endDocument();

assertEquals("OPEN", handler.cases().get(0).status());
```

Ini penting karena bug fragmentation sering tidak muncul pada parser tertentu dengan input kecil.

### 13.3 Test namespace equivalence

Dua XML berikut harus menghasilkan output sama:

```xml
<c:case xmlns:c="urn:case" id="C-001"><c:status>OPEN</c:status></c:case>
```

```xml
<x:case xmlns:x="urn:case" id="C-001"><x:status>OPEN</x:status></x:case>
```

Jika tidak sama, handler kemungkinan masih prefix-based.

### 13.4 Test location-aware error

Pastikan error message menyertakan line/column jika parser menyediakan locator.

Ini bukan sekadar nice-to-have. Untuk file besar, location adalah kebutuhan operasional.

---

## 14. Design Checklist untuk SAX Handler Production

Sebelum memakai SAX handler di production, cek:

```text
[ ] Parser dibuat namespace-aware jika input bisa memakai namespace.
[ ] Handler tidak mengasumsikan characters() lengkap dalam satu callback.
[ ] Handler memakai state machine/path/frame yang sesuai kompleksitas XML.
[ ] Handler tidak menyimpan Attributes tanpa copy.
[ ] ErrorHandler eksplisit.
[ ] Locator digunakan untuk error message.
[ ] Text length dibatasi untuk field yang tidak boleh besar.
[ ] Result/error collection dibatasi.
[ ] Side effect downstream punya transaction/idempotency policy.
[ ] Handler dibuat per parse atau memiliki reset() yang benar.
[ ] Namespace matching berbasis URI + localName, bukan prefix.
[ ] Unit test mencakup whitespace, fragmentation, namespace prefix variation, dan malformed XML.
[ ] Security hardening parser diterapkan. Detail penuh di Part 30.
```

---

## 15. Latihan / Thought Exercise

### Latihan 1 — Ubah DOM extraction menjadi SAX streaming

Input:

```xml
<applications>
  <application id="A-001">
    <applicant>Fajar</applicant>
    <status>SUBMITTED</status>
  </application>
</applications>
```

Tugas:

- buat SAX handler yang emit `ApplicationRecord` satu per satu;
- jangan simpan semua record;
- validasi `id`, `applicant`, dan `status` wajib ada;
- error message harus menyertakan line/column.

### Latihan 2 — Handle namespace dengan benar

Input 1:

```xml
<a:application xmlns:a="urn:app" id="A-001"/>
```

Input 2:

```xml
<x:application xmlns:x="urn:app" id="A-001"/>
```

Tugas:

- handler harus memperlakukan keduanya sama;
- jangan match `qName` kecuali untuk diagnostic.

### Latihan 3 — Simulasikan fragmentation

Panggil callback handler secara manual:

```text
characters("SUB")
characters("MIT")
characters("TED")
```

Pastikan hasil akhir adalah `SUBMITTED`.

### Latihan 4 — Batasi ukuran text

Buat policy:

```text
applicant max 200 chars
status max 50 chars
description max 10_000 chars
```

Tugas:

- implement limit pada handler;
- error harus menjelaskan elemen mana yang melanggar limit;
- sertakan line/column.

---

## 16. Ringkasan

SAX adalah API yang kecil tetapi menuntut mental model yang kuat.

Intinya:

- SAX bukan tree, melainkan event stream;
- parser mengontrol alur, handler bereaksi;
- `XMLReader` adalah parser driver;
- `ContentHandler` menerima event struktur dan text;
- `DefaultHandler` hanya convenience no-op base class;
- `Attributes` berlaku pada `startElement` dan perlu dicopy jika disimpan;
- `Locator` penting untuk error operasional;
- `characters()` bisa terfragmentasi dan tidak boleh diasumsikan lengkap;
- handler production pada dasarnya adalah state machine;
- namespace harus diproses dengan URI + localName, bukan prefix;
- SAX hemat memory hanya jika handler juga dirancang hemat memory;
- side effect harus dipisahkan dari parsing sebisa mungkin;
- error handling, test fragmentation, dan location-aware diagnostics adalah bagian dari kualitas production.

Jika DOM membuat XML terasa seperti object graph, SAX memaksa kita berpikir seperti runtime engineer: event, state, boundary, lifecycle, backpressure, memory, dan failure semantics.

Part berikutnya akan masuk lebih dalam ke namespace, SAX features/properties, entity resolution, DTD handling, dan parser behavior differences.

---

## 17. Referensi

- Java SE 25 API — `org.xml.sax` package summary.
- Java SE 25 API — `org.xml.sax.helpers` package summary.
- Java SE 8 API — `org.xml.sax` package summary untuk baseline kompatibilitas Java 8.
- Java SE 25 API — `javax.xml.parsers.SAXParserFactory` dan `SAXParser`.
- SAX API design: SAX1 vs SAX2, `XMLReader`, `ContentHandler`, `Attributes`, `DefaultHandler`, `Locator`, `ErrorHandler`.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./27-dom-level-3-typeinfo-userdata-errorhandler-load-save-boundary.md">⬅️ Part 27 — DOM Level 3: TypeInfo, UserData, ErrorHandler, Load/Save Boundary</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./29-sax-namespaces-features-properties-entity-resolution-dtd.md">Part 29 — SAX Namespaces, Features, Properties, Entity Resolution, DTD Handling ➡️</a>
</div>
