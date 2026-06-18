# Part 31 — Advanced XML Processing Patterns: DOM/SAX Hybrid, Streaming State Machines, Large Documents

> Series: `learn-java-lang-dom-sax-core-runtime-platform-contracts`  
> File: `31-advanced-xml-processing-patterns-dom-sax-hybrid-large-documents.md`  
> Scope: Java 8–25, `org.w3c.dom.*`, `org.xml.sax.*`, and the minimum JAXP boundary needed to use them safely  
> Status: Part 31 of 32

---

## 1. Tujuan Part Ini

Di part sebelumnya kita sudah membahas:

- DOM sebagai mutable in-memory tree;
- operasi creation, mutation, import, adopt, clone, normalize;
- DOM querying dan namespace pitfalls;
- DOM Level 3 extension points;
- SAX sebagai push/event parser;
- SAX namespace, feature, property, entity resolution, dan DTD handling;
- secure XML parsing: XXE, entity expansion, secure processing, access restriction, dan parser limits.

Part ini menjawab pertanyaan yang lebih production-oriented:

> Setelah paham DOM dan SAX sebagai API, bagaimana kita merancang XML processing pipeline yang benar untuk dokumen kecil, dokumen besar, integrasi legacy, import batch, regulatory feeds, audit payload, dan sistem yang harus aman, repeatable, observable, serta memory-safe?

Tujuan utama:

1. memahami kapan DOM cukup, kapan SAX lebih tepat, dan kapan hybrid lebih masuk akal;
2. membangun mental model XML processing sebagai **pipeline**, bukan sekadar `parse(file)`;
3. merancang SAX handler sebagai **state machine**, bukan tumpukan `if` acak;
4. mengelola dokumen besar tanpa memory blow-up;
5. menjaga partial failure, idempotency, auditability, dan transactional boundary;
6. membangun pola reusable untuk production-grade XML ingestion.

---

## 2. Mental Model Utama

### 2.1 XML Processing Bukan Satu Masalah

Banyak developer memperlakukan semua XML sama:

```java
Document doc = builder.parse(file);
```

atau:

```java
parser.parse(file, handler);
```

Padahal XML processing bisa berarti banyak hal berbeda:

| Use case | Karakteristik | Parser model yang cocok |
|---|---|---|
| Config kecil | ukuran kecil, random access, mudah dibaca | DOM |
| SOAP/XML response kecil | ada namespace, struktur tetap | DOM atau StAX/SAX |
| Feed jutaan item | besar, sequential, memory sensitif | SAX |
| Import regulatory data | perlu audit, partial failure, validation | SAX + staging |
| Transform subdocument tertentu | besar tapi hanya bagian tertentu kompleks | SAX + DOM subtree |
| Digital signature / canonicalization | butuh preservation/detail tinggi | DOM khusus + canonicalization library |
| Simple extraction | ambil field tertentu | SAX |
| User-upload XML tidak dipercaya | adversarial input | hardened parser + limit + streaming |

Jadi keputusan parser bukan soal “mana API favorit”, tetapi soal:

- ukuran input;
- trust boundary;
- perlu random access atau sequential access;
- perlu mutation atau read-only;
- perlu preserve order, whitespace, comments, namespace, DTD;
- perlu validation;
- perlu partial processing;
- perlu audit dan replay;
- failure handling;
- memory ceiling;
- throughput;
- operability.

---

### 2.2 DOM = Snapshot Tree, SAX = Event Log

Mental model paling ringkas:

```text
DOM:
XML bytes -> parser -> complete mutable tree -> application walks/mutates tree

SAX:
XML bytes -> parser -> event stream -> application state machine reacts
```

DOM cocok saat kita ingin bertanya:

- “ambil node ini dari mana saja?”
- “ubah node ini lalu serialize ulang?”
- “bandingkan struktur subtree?”
- “butuh parent/child/sibling navigation bebas?”

SAX cocok saat kita ingin bertanya:

- “setiap kali ada `<record>`, proses satu per satu”;
- “dokumen besar tidak boleh masuk memory semua”;
- “saya hanya butuh beberapa field dari stream”;
- “pipeline bisa jalan secara incremental”.

---

### 2.3 Hybrid = Streaming Outer, Tree Inner

Hybrid pattern sangat berguna untuk dokumen besar dengan unit kecil yang kompleks.

Contoh XML besar:

```xml
<applications>
  <application id="A-001">
    <applicant>...</applicant>
    <documents>...</documents>
    <declarations>...</declarations>
  </application>
  <application id="A-002">
    ...
  </application>
</applications>
```

Kita tidak ingin seluruh `<applications>` menjadi DOM. Tetapi mungkin setiap `<application>` masih nyaman diproses sebagai DOM subtree.

Pola hybrid:

```text
SAX scans document
  when <application> starts:
    capture subtree events
  when </application> ends:
    build DOM only for that one application
    validate/extract/store
    discard subtree DOM
continue streaming
```

Memory menjadi proporsional terhadap ukuran satu record, bukan ukuran seluruh file.

---

## 3. Konsep Fundamental

### 3.1 XML Processing Pipeline

Production XML processing sebaiknya dipikirkan sebagai pipeline:

```text
Input Source
  -> Trust Boundary Check
  -> Parser Configuration
  -> Structural Validation
  -> Streaming/Tree Parsing
  -> Domain Extraction
  -> Semantic Validation
  -> Staging
  -> Persistence / Side Effects
  -> Audit / Metrics / Error Report
```

Setiap tahap punya tanggung jawab berbeda.

#### 3.1.1 Input Source

Input bisa berasal dari:

- file upload;
- SFTP;
- message queue;
- HTTP response;
- database CLOB;
- object storage;
- batch archive;
- inter-agency integration feed;
- generated XML internal.

Pertanyaan awal:

- apakah input trusted?
- ukuran maksimum berapa?
- encoding diketahui atau ikut XML declaration?
- compressed atau plain?
- single document atau archive banyak document?
- perlu checksum?
- perlu replay?
- perlu original file disimpan?

#### 3.1.2 Parser Configuration

Parser harus dikonfigurasi sebelum parse:

- namespace aware;
- validating atau tidak;
- secure processing;
- external DTD/schema access restriction;
- entity expansion limits;
- disallow DOCTYPE jika tidak diperlukan;
- custom `EntityResolver`;
- error handler;
- schema;
- input size controls.

Konfigurasi ini bukan detail teknis kecil. Ini adalah security dan reliability contract.

#### 3.1.3 Structural Validation

Structural validation menjawab:

> Apakah XML ini bentuknya sesuai kontrak schema/DTD/struktur minimal?

Contoh:

- root element harus `<applications>`;
- namespace harus benar;
- setiap `<application>` punya `id`;
- tanggal format ISO;
- enumeration values valid.

Structural validation tidak selalu cukup untuk business rule.

#### 3.1.4 Semantic Validation

Semantic validation menjawab:

> Apakah data ini masuk akal dalam domain?

Contoh:

- applicant age harus memenuhi rule;
- application id belum pernah diproses;
- status transition valid;
- agency code dikenal;
- date range tidak konflik;
- amount harus cocok dengan currency precision.

#### 3.1.5 Staging dan Persistence

Untuk dokumen besar, jangan langsung melakukan side effect final per event tanpa strategi.

Lebih aman:

```text
parse -> extract records -> validate -> write staging -> reconcile -> promote
```

Keuntungan:

- bisa resume;
- bisa retry;
- bisa audit;
- bisa partial reject;
- bisa compare expected vs actual count;
- bisa deduplicate.

---

### 3.2 Random Access vs Sequential Access

DOM memberi random access.

SAX memberi sequential access.

Ini bukan hanya soal API. Ini memengaruhi desain algoritma.

#### DOM Thinking

```text
I have the whole tree.
I can look anywhere anytime.
I can ask parent/child/sibling.
I can mutate.
Memory cost is accepted.
```

#### SAX Thinking

```text
I see events once, in order.
If I need information later, I must store it explicitly.
I should keep state minimal.
I cannot go backward.
I should process incrementally.
```

Kesalahan umum saat memakai SAX adalah tetap berpikir seperti DOM:

```text
"Nanti kalau butuh parent, tinggal lihat parent node."
```

Di SAX tidak ada parent node. Kita sendiri yang harus menyimpan stack konteks.

---

### 3.3 State Machine adalah Kunci SAX

SAX handler yang baik adalah state machine eksplisit.

Buruk:

```java
if (qName.equals("name")) {
    inName = true;
}
if (qName.equals("address")) {
    inAddress = true;
}
if (qName.equals("line")) {
    inLine = true;
}
```

Lama-lama handler menjadi kumpulan boolean yang sulit dipahami.

Lebih baik:

```text
DocumentState
  OUTSIDE_ROOT
  IN_ROOT
  IN_RECORD
  IN_APPLICANT
  IN_ADDRESS
  IN_DOCUMENT
```

Atau gunakan element stack:

```text
/applications/application/applicant/name
/applications/application/documents/document/type
```

Untuk sistem production, state machine harus menjawab:

- saat event ini muncul, state sekarang harus apa?
- state berikutnya apa?
- data apa yang di-accumulate?
- kapan object dianggap lengkap?
- kapan error dilaporkan?
- apakah parser boleh lanjut setelah error?

---

## 4. API dan Contract yang Perlu Dipahami

### 4.1 DOM API yang Relevan untuk Pattern Hybrid

DOM API utama:

- `Document`;
- `DocumentBuilder`;
- `DocumentBuilderFactory`;
- `Node`;
- `Element`;
- `Text`;
- `NodeList`;
- `NamedNodeMap`;
- `DOMImplementation`;
- `LSParser`/`LSSerializer` jika memakai DOM Load/Save.

DOM package `org.w3c.dom` di Java menyediakan interface Document Object Model dan mendukung DOM Level 2 Core, DOM Level 3 Core, serta DOM Level 3 Load and Save.

### 4.2 SAX API yang Relevan untuk Streaming Pattern

SAX API utama:

- `XMLReader`;
- `ContentHandler`;
- `DefaultHandler`;
- `ErrorHandler`;
- `EntityResolver`;
- `Attributes`;
- `Locator`;
- `SAXException`;
- `InputSource`;
- `SAXParseException`.

Package `org.xml.sax` menyediakan interface Simple API for XML dan mendukung SAX1/SAX2.

### 4.3 JAXP Boundary

Walaupun seri ini fokus DOM/SAX, production Java biasanya memakai JAXP factory:

- `DocumentBuilderFactory` untuk DOM;
- `SAXParserFactory` untuk SAX;
- `SchemaFactory` untuk schema;
- `XMLConstants` untuk secure processing dan external access restriction.

`javax.xml.parsers` menyediakan class untuk memproses XML dengan SAX parser atau DOM document builder.

---

## 5. Evolusi Java 8–25

### 5.1 DOM/SAX API Relatif Stabil

DOM dan SAX bukan API yang berubah dramatis dari Java 8 sampai Java 25. Yang berubah lebih banyak adalah:

- module system sejak Java 9;
- security defaults dan processing limits;
- parser implementation behavior;
- JAXP security properties;
- deployment/container assumptions;
- default charset sejak Java 18;
- operational context: cloud/container/batch/import pipeline.

### 5.2 Module Boundary

Sejak Java 9, DOM/SAX berada di module `java.xml`.

Jika aplikasi modular, module descriptor perlu:

```java
module com.example.xmlimporter {
    requires java.xml;
}
```

Jika aplikasi non-modular/classpath, biasanya tidak terlihat karena `java.xml` termasuk standard module yang tersedia di JDK/JRE runtime image umum.

### 5.3 Security and Limits Become More Important

XML parser dapat menjadi attack surface.

Untuk Java modern, desain XML processing yang serius harus selalu mempertimbangkan:

- external entity resolution;
- external DTD/schema access;
- entity expansion;
- max element depth;
- max attributes;
- total entity size;
- input size;
- timeout;
- CPU exhaustion;
- memory exhaustion.

Part 30 sudah membahas hardening detail. Part ini memakai asumsi bahwa semua parser factory yang digunakan sudah hardened.

---

## 6. Pattern 1 — DOM for Small, Trusted, Random-Access Documents

### 6.1 Kapan Pakai DOM

Gunakan DOM jika:

- dokumen kecil atau ukuran maksimum ketat;
- butuh random access;
- butuh mutation;
- butuh serialize ulang;
- struktur nested dan query lebih sederhana dengan tree;
- input trusted atau sudah di-harden;
- memory cost acceptable.

Contoh cocok:

- XML config internal 50 KB;
- XML response dari trusted service dengan max size 1 MB;
- template XML yang perlu diubah beberapa node;
- payload test fixture.

### 6.2 Contoh DOM Extractor Sederhana

```java
package com.example.xml.dom;

import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

import java.util.ArrayList;
import java.util.List;

public final class DomApplicationExtractor {

    private static final String NS = "urn:example:applications:v1";

    public List<ApplicationSummary> extract(Document document) {
        Element root = document.getDocumentElement();
        requireElement(root, NS, "applications", "/");

        NodeList nodes = root.getElementsByTagNameNS(NS, "application");
        List<ApplicationSummary> result = new ArrayList<>();

        for (int i = 0; i < nodes.getLength(); i++) {
            Node node = nodes.item(i);
            if (node.getNodeType() != Node.ELEMENT_NODE) {
                continue;
            }

            Element application = (Element) node;
            String id = requiredAttribute(application, "id", "/applications/application[" + i + "]");
            String status = requiredDirectChildText(application, NS, "status");
            String applicantName = requiredDirectChildText(application, NS, "applicantName");

            result.add(new ApplicationSummary(id, status, applicantName));
        }

        return result;
    }

    private static void requireElement(Element element, String namespaceUri, String localName, String path) {
        if (element == null) {
            throw new XmlExtractionException("Missing element at " + path);
        }
        if (!namespaceUri.equals(element.getNamespaceURI()) || !localName.equals(element.getLocalName())) {
            throw new XmlExtractionException(
                    "Expected {" + namespaceUri + "}" + localName + " at " + path
                            + " but found {" + element.getNamespaceURI() + "}" + element.getLocalName());
        }
    }

    private static String requiredAttribute(Element element, String name, String path) {
        if (!element.hasAttribute(name)) {
            throw new XmlExtractionException("Missing required attribute @" + name + " at " + path);
        }
        String value = element.getAttribute(name).trim();
        if (value.isEmpty()) {
            throw new XmlExtractionException("Empty required attribute @" + name + " at " + path);
        }
        return value;
    }

    private static String requiredDirectChildText(Element parent, String namespaceUri, String localName) {
        Element child = directChild(parent, namespaceUri, localName);
        if (child == null) {
            throw new XmlExtractionException("Missing child " + localName + " under " + parent.getLocalName());
        }
        String text = child.getTextContent().trim();
        if (text.isEmpty()) {
            throw new XmlExtractionException("Empty child " + localName + " under " + parent.getLocalName());
        }
        return text;
    }

    private static Element directChild(Element parent, String namespaceUri, String localName) {
        for (Node n = parent.getFirstChild(); n != null; n = n.getNextSibling()) {
            if (n.getNodeType() == Node.ELEMENT_NODE) {
                Element e = (Element) n;
                if (namespaceUri.equals(e.getNamespaceURI()) && localName.equals(e.getLocalName())) {
                    return e;
                }
            }
        }
        return null;
    }

    public record ApplicationSummary(String id, String status, String applicantName) {}

    public static final class XmlExtractionException extends RuntimeException {
        public XmlExtractionException(String message) {
            super(message);
        }
    }
}
```

### 6.3 Kenapa Direct Child Lebih Aman Daripada `getElementsByTagNameNS`

`getElementsByTagNameNS` mencari semua descendant, bukan hanya direct child.

Jika struktur:

```xml
<application>
  <status>SUBMITTED</status>
  <history>
    <status>DRAFT</status>
  </history>
</application>
```

`getElementsByTagNameNS(NS, "status")` dapat menemukan status dalam history juga.

Untuk extraction domain, direct child traversal sering lebih defensible.

### 6.4 DOM Failure Modes

| Failure mode | Dampak | Mitigasi |
|---|---|---|
| DOM untuk file besar | OOM / GC pressure | SAX/StAX/hybrid |
| `getTextContent()` pada parent besar | gabungan text tak terduga | ekstrak child spesifik |
| namespace prefix matching | salah saat prefix berubah | pakai namespace URI + localName |
| live `NodeList` saat mutation | skip/loop aneh | copy snapshot dulu |
| missing size limit | DoS memory | enforce max bytes |
| no secure parser config | XXE/SSRF/entity bomb | hardened factory |

---

## 7. Pattern 2 — SAX for Large Sequential Extraction

### 7.1 Kapan Pakai SAX

Gunakan SAX jika:

- file besar;
- record diproses satu per satu;
- tidak perlu random access global;
- memory harus stabil;
- hanya ekstrak subset data;
- input dari batch feed;
- pipeline bisa incremental.

Contoh:

- 5 GB XML feed;
- jutaan `<transaction>`;
- nightly import;
- audit event export;
- streaming data exchange antar lembaga.

### 7.2 Desain SAX Handler yang Baik

SAX handler production sebaiknya punya:

- element stack;
- current record builder;
- text accumulator;
- location info dari `Locator`;
- error collector atau fail-fast strategy;
- explicit record completion event;
- backpressure/flush boundary;
- metrics hooks.

### 7.3 Contoh SAX Streaming Importer

```java
package com.example.xml.sax;

import org.xml.sax.Attributes;
import org.xml.sax.Locator;
import org.xml.sax.SAXException;
import org.xml.sax.helpers.DefaultHandler;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Objects;
import java.util.function.Consumer;

public final class ApplicationSaxHandler extends DefaultHandler {

    private static final String NS = "urn:example:applications:v1";

    private final Consumer<ApplicationRecord> sink;
    private final Deque<ElementName> stack = new ArrayDeque<>();
    private final StringBuilder text = new StringBuilder(256);

    private Locator locator;
    private ApplicationBuilder current;
    private long recordCount;

    public ApplicationSaxHandler(Consumer<ApplicationRecord> sink) {
        this.sink = Objects.requireNonNull(sink, "sink");
    }

    @Override
    public void setDocumentLocator(Locator locator) {
        this.locator = locator;
    }

    @Override
    public void startDocument() {
        stack.clear();
        text.setLength(0);
        current = null;
        recordCount = 0L;
    }

    @Override
    public void startElement(String uri, String localName, String qName, Attributes attributes) throws SAXException {
        ElementName name = new ElementName(uri, localName);
        stack.push(name);
        text.setLength(0);

        if (is(NS, "application", name)) {
            if (current != null) {
                throw parseError("Nested application is not allowed");
            }
            String id = requiredAttribute(attributes, "id");
            current = new ApplicationBuilder(id, location());
        }
    }

    @Override
    public void characters(char[] ch, int start, int length) {
        text.append(ch, start, length);
    }

    @Override
    public void endElement(String uri, String localName, String qName) throws SAXException {
        ElementName ended = new ElementName(uri, localName);
        ElementName actual = stack.peek();

        if (!ended.equals(actual)) {
            throw parseError("Unexpected closing element: " + ended + ", stack top: " + actual);
        }

        if (current != null) {
            String value = text.toString().trim();

            if (pathEndsWith(NS, "application", NS, "status")) {
                current.status = value;
            } else if (pathEndsWith(NS, "application", NS, "applicantName")) {
                current.applicantName = value;
            } else if (is(NS, "application", ended)) {
                ApplicationRecord record = current.build();
                sink.accept(record);
                recordCount++;
                current = null;
            }
        }

        stack.pop();
        text.setLength(0);
    }

    @Override
    public void endDocument() throws SAXException {
        if (!stack.isEmpty()) {
            throw parseError("Document ended with non-empty element stack");
        }
    }

    public long recordCount() {
        return recordCount;
    }

    private boolean pathEndsWith(String parentNs, String parentLocal, String childNs, String childLocal) {
        if (stack.size() < 2) {
            return false;
        }
        ElementName child = stack.pop();
        ElementName parent = stack.peek();
        stack.push(child);

        return is(parentNs, parentLocal, parent) && is(childNs, childLocal, child);
    }

    private static boolean is(String ns, String local, ElementName name) {
        return ns.equals(name.uri()) && local.equals(name.localName());
    }

    private String requiredAttribute(Attributes attributes, String localName) throws SAXException {
        String value = attributes.getValue("", localName);
        if (value == null || value.trim().isEmpty()) {
            throw parseError("Missing required attribute @" + localName);
        }
        return value.trim();
    }

    private SAXException parseError(String message) {
        return new SAXException(message + " at " + location());
    }

    private String location() {
        if (locator == null) {
            return "unknown location";
        }
        return "line " + locator.getLineNumber() + ", column " + locator.getColumnNumber();
    }

    private record ElementName(String uri, String localName) {}

    public record ApplicationRecord(String id, String status, String applicantName, String sourceLocation) {}

    private static final class ApplicationBuilder {
        final String id;
        final String sourceLocation;
        String status;
        String applicantName;

        ApplicationBuilder(String id, String sourceLocation) {
            this.id = id;
            this.sourceLocation = sourceLocation;
        }

        ApplicationRecord build() throws SAXException {
            if (status == null || status.isBlank()) {
                throw new SAXException("Missing status for application " + id + " at " + sourceLocation);
            }
            if (applicantName == null || applicantName.isBlank()) {
                throw new SAXException("Missing applicantName for application " + id + " at " + sourceLocation);
            }
            return new ApplicationRecord(id, status, applicantName, sourceLocation);
        }
    }
}
```

### 7.4 Important Caveat: `characters()` Bisa Terfragmentasi

SAX tidak menjamin text element datang dalam satu panggilan `characters()`.

Salah:

```java
@Override
public void characters(char[] ch, int start, int length) {
    current.name = new String(ch, start, length);
}
```

Benar:

```java
@Override
public void characters(char[] ch, int start, int length) {
    text.append(ch, start, length);
}
```

Kemudian proses saat `endElement`.

### 7.5 SAX Failure Modes

| Failure mode | Dampak | Mitigasi |
|---|---|---|
| boolean flags terlalu banyak | handler rapuh | element stack / explicit state |
| lupa text fragmentation | data terpotong | accumulate sampai endElement |
| tidak menyimpan location | error sulit diaudit | pakai `Locator` |
| side effect per field | data partial | commit per complete record |
| no batching | lambat | batch sink |
| handler reusable tanpa reset | data bocor antar parse | reset di `startDocument` |
| namespace off | collision/salah parse | `setNamespaceAware(true)` |

---

## 8. Pattern 3 — SAX to Domain Events

### 8.1 Kenapa Domain Events?

Daripada handler langsung insert database, lebih bersih handler menghasilkan event domain:

```text
SAX parser -> XML events -> domain extraction events -> service layer
```

Contoh event:

```java
sealed interface ImportEvent permits RecordStarted, FieldRead, RecordCompleted, RecordRejected {}

record RecordStarted(String id, String location) implements ImportEvent {}
record FieldRead(String recordId, String fieldName, String value, String location) implements ImportEvent {}
record RecordCompleted(ApplicationRecord record) implements ImportEvent {}
record RecordRejected(String recordId, String reason, String location) implements ImportEvent {}
```

Manfaat:

- parser layer tidak tahu database;
- mudah dites;
- mudah audit;
- bisa replay event;
- bisa batch;
- bisa route ke validator;
- bisa collect metrics.

### 8.2 Arsitektur

```text
XMLReader
  -> ContentHandler
      -> ImportEventSink
          -> Structural Validator
          -> Semantic Validator
          -> Staging Writer
          -> Metrics/Audit
```

### 8.3 Kapan Cocok

- import kompleks;
- butuh audit trail;
- perlu reject sebagian record;
- perlu observability;
- banyak downstream logic;
- ingin test parser tanpa database.

### 8.4 Kapan Berlebihan

- XML kecil;
- extraction sederhana;
- tidak ada reuse;
- tidak ada partial failure;
- batch sekali pakai.

---

## 9. Pattern 4 — SAX + DOM Subtree Capture

### 9.1 Problem

Kadang dokumen terlalu besar untuk DOM global, tetapi satu record terlalu kompleks untuk SAX manual.

Contoh:

```xml
<feed>
  <case id="C-001">
    <parties>...</parties>
    <documents>...</documents>
    <decisions>...</decisions>
    <history>...</history>
  </case>
  <case id="C-002">...</case>
</feed>
```

Kita ingin:

- stream `<feed>`;
- capture satu `<case>`;
- parse `<case>` sebagai DOM;
- extract dengan DOM helper;
- discard;
- lanjut record berikutnya.

### 9.2 Cara Implementasi Konseptual

Ada beberapa cara:

1. capture SAX events lalu bangun DOM manual;
2. capture raw XML substring dengan careful streaming reader;
3. gunakan Transformer/SAXResult/DOMResult pattern;
4. gunakan StAX untuk subtree lalu DOM builder;
5. gunakan custom XML writer saat event masuk.

Karena seri ini fokus DOM/SAX, kita bahas pendekatan event-to-DOM builder.

### 9.3 Event-to-DOM Subtree Builder

Konsep:

```text
Outside target element:
  ignore / scan

At target start:
  create new Document
  create root element
  push root
  capture = true

While capture:
  startElement -> create child element, attach, push
  characters -> create text node, attach
  endElement -> pop

At target end:
  emit Document subtree
  capture = false
```

### 9.4 Simplified Code

```java
package com.example.xml.hybrid;

import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.xml.sax.Attributes;
import org.xml.sax.SAXException;
import org.xml.sax.helpers.DefaultHandler;

import javax.xml.parsers.DocumentBuilder;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Objects;
import java.util.function.Consumer;

public final class SubtreeCapturingHandler extends DefaultHandler {

    private final DocumentBuilder documentBuilder;
    private final String targetNamespace;
    private final String targetLocalName;
    private final Consumer<Document> subtreeConsumer;

    private boolean capturing;
    private int depth;
    private Document document;
    private final Deque<Element> elementStack = new ArrayDeque<>();

    public SubtreeCapturingHandler(
            DocumentBuilder documentBuilder,
            String targetNamespace,
            String targetLocalName,
            Consumer<Document> subtreeConsumer
    ) {
        this.documentBuilder = Objects.requireNonNull(documentBuilder, "documentBuilder");
        this.targetNamespace = Objects.requireNonNull(targetNamespace, "targetNamespace");
        this.targetLocalName = Objects.requireNonNull(targetLocalName, "targetLocalName");
        this.subtreeConsumer = Objects.requireNonNull(subtreeConsumer, "subtreeConsumer");
    }

    @Override
    public void startElement(String uri, String localName, String qName, Attributes attributes) throws SAXException {
        boolean targetStart = !capturing && targetNamespace.equals(uri) && targetLocalName.equals(localName);

        if (targetStart) {
            capturing = true;
            depth = 0;
            document = documentBuilder.newDocument();
            elementStack.clear();
        }

        if (capturing) {
            Element element = document.createElementNS(uri.isEmpty() ? null : uri, qNameForCreation(qName, localName));

            for (int i = 0; i < attributes.getLength(); i++) {
                String attrUri = attributes.getURI(i);
                String attrQName = attributes.getQName(i);
                String attrLocal = attributes.getLocalName(i);
                String value = attributes.getValue(i);

                if (attrUri == null || attrUri.isEmpty()) {
                    element.setAttribute(attrLocalOrQName(attrQName, attrLocal), value);
                } else {
                    element.setAttributeNS(attrUri, attrQName, value);
                }
            }

            if (elementStack.isEmpty()) {
                document.appendChild(element);
            } else {
                elementStack.peek().appendChild(element);
            }

            elementStack.push(element);
            depth++;
        }
    }

    @Override
    public void characters(char[] ch, int start, int length) {
        if (capturing && length > 0) {
            Node text = document.createTextNode(new String(ch, start, length));
            elementStack.peek().appendChild(text);
        }
    }

    @Override
    public void endElement(String uri, String localName, String qName) throws SAXException {
        if (!capturing) {
            return;
        }

        elementStack.pop();
        depth--;

        if (depth == 0) {
            Document completed = document;
            capturing = false;
            document = null;
            elementStack.clear();
            subtreeConsumer.accept(completed);
        }
    }

    private static String qNameForCreation(String qName, String localName) {
        return qName == null || qName.isEmpty() ? localName : qName;
    }

    private static String attrLocalOrQName(String qName, String localName) {
        return qName == null || qName.isEmpty() ? localName : qName;
    }
}
```

### 9.5 Caveats Hybrid Builder

Kode di atas simplified. Untuk production, pertimbangkan:

- namespace prefix mapping events (`startPrefixMapping`, `endPrefixMapping`);
- comments/CDATA jika penting;
- processing instructions;
- entity references;
- whitespace preservation;
- max subtree size;
- max subtree depth;
- max records;
- source location metadata;
- namespace declarations;
- validation per subtree;
- security factory.

Hybrid bukan free lunch. Ia menambah complexity, tapi bisa menjadi titik tengah yang sangat kuat.

---

## 10. Pattern 5 — Streaming Batch with Bounded Memory

### 10.1 Problem

Jika setiap parsed record langsung disimpan satu per satu ke database, throughput bisa rendah.

Jika semua record ditampung list besar, memory blow-up.

Solusi: bounded batch.

```text
SAX emits record
  -> batch buffer max N records
  -> flush to staging
  -> clear buffer
```

Memory maksimum kira-kira:

```text
max_batch_size * average_record_size + parser overhead
```

### 10.2 Contoh Batching Sink

```java
package com.example.xml.batch;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.function.Consumer;

public final class BatchingSink<T> implements Consumer<T>, AutoCloseable {

    private final int batchSize;
    private final Consumer<List<T>> batchConsumer;
    private final List<T> buffer;
    private long accepted;
    private long flushedBatches;

    public BatchingSink(int batchSize, Consumer<List<T>> batchConsumer) {
        if (batchSize <= 0) {
            throw new IllegalArgumentException("batchSize must be positive");
        }
        this.batchSize = batchSize;
        this.batchConsumer = Objects.requireNonNull(batchConsumer, "batchConsumer");
        this.buffer = new ArrayList<>(batchSize);
    }

    @Override
    public void accept(T item) {
        buffer.add(item);
        accepted++;
        if (buffer.size() >= batchSize) {
            flush();
        }
    }

    public void flush() {
        if (buffer.isEmpty()) {
            return;
        }
        batchConsumer.accept(List.copyOf(buffer));
        buffer.clear();
        flushedBatches++;
    }

    @Override
    public void close() {
        flush();
    }

    public long accepted() {
        return accepted;
    }

    public long flushedBatches() {
        return flushedBatches;
    }
}
```

For Java 8 compatibility, replace `List.copyOf(buffer)` with:

```java
new ArrayList<>(buffer)
```

### 10.3 Flush Boundary

Flush per:

- N records;
- N bytes approximate;
- N seconds;
- end of document;
- transaction chunk;
- business group.

### 10.4 Transaction Boundary

Untuk import besar, satu transaksi untuk seluruh file sering berbahaya:

- long lock;
- huge undo/redo;
- failure mengulang semua;
- timeout;
- sulit monitor progress.

Lebih aman:

```text
transaction per batch/staging chunk
```

Tetapi perlu idempotency.

---

## 11. Pattern 6 — Staging Table and Promotion

### 11.1 Kenapa Staging?

Untuk import XML besar, direct write ke final table sering membuat sistem sulit diperbaiki saat partial failure.

Staging memberi separation:

```text
Raw file stored
  -> parse records
  -> write staging rows
  -> validate/reconcile
  -> promote to final tables
```

### 11.2 Metadata Staging yang Penting

Minimal staging metadata:

| Field | Fungsi |
|---|---|
| `import_id` | identitas run |
| `source_file_name` | audit |
| `source_checksum` | dedup/replay |
| `record_sequence` | order original |
| `record_external_id` | id domain dari XML |
| `source_line` | lokasi error |
| `source_column` | lokasi error |
| `raw_fragment_hash` | integrity |
| `parse_status` | parsed/rejected |
| `validation_status` | valid/invalid |
| `error_code` | classification |
| `error_message` | diagnostic |
| `created_at` | audit |

### 11.3 Promotion Model

Promotion bisa:

- all-or-nothing after staging;
- valid-records-only;
- reject-file-if-any-record-invalid;
- manual review before promotion;
- two-phase import;
- compare counts and totals before promote.

Untuk regulatory systems, promotion policy harus eksplisit.

### 11.4 Idempotency

Idempotency menjawab:

> Kalau file yang sama diproses ulang, apa yang terjadi?

Strategi:

- unique constraint pada `source_checksum`;
- unique `(source_system, external_record_id, version)`;
- import run state machine;
- record-level hash comparison;
- upsert dengan versioning;
- reject duplicate exact file;
- allow replay into new import run but no duplicate final effect.

---

## 12. Pattern 7 — Error Handling and Partial Failure

### 12.1 Error Category

Jangan semua error menjadi “XML parse failed”.

Pisahkan:

| Category | Contoh | Level |
|---|---|---|
| Transport error | file tidak ditemukan, stream putus | file-level |
| Security rejection | DOCTYPE forbidden, external entity | file-level |
| Well-formedness error | tag tidak ditutup | file-level |
| Structural error | required element missing | record-level/file-level |
| Semantic error | invalid transition | record-level |
| Duplicate error | record already imported | record-level |
| Persistence error | DB down | system-level |
| Unexpected bug | NPE in handler | system-level |

### 12.2 Fail Fast vs Collect Errors

Fail fast cocok untuk:

- malformed XML;
- security violation;
- schema invalid jika policy reject all;
- unknown root;
- impossible structure.

Collect errors cocok untuk:

- record-level validation;
- business rule violations;
- duplicate records;
- optional field warning.

### 12.3 Error Report

Error report harus mengandung:

- import id;
- file name;
- record sequence;
- record id;
- line/column if available;
- path;
- error code;
- human-readable message;
- severity;
- whether retryable;
- raw value, jika aman dan tidak sensitif.

### 12.4 SAX Location

SAX `Locator` sangat berguna, tapi jangan berlebihan menganggap line/column selalu sempurna untuk semua source.

Line/column bisa berbeda jika:

- input normalized;
- file compressed;
- encoding transform;
- fragment parsed;
- parser behavior berbeda.

Tetap simpan karena jauh lebih baik daripada tidak ada lokasi.

---

## 13. Pattern 8 — XML Path Tracking Without XPath

SAX tidak punya XPath bawaan. Tapi kita bisa track path.

### 13.1 Simple Path Stack

```java
public final class XmlPath {
    private final ArrayDeque<String> segments = new ArrayDeque<>();

    public void push(String namespaceUri, String localName) {
        segments.addLast("{" + namespaceUri + "}" + localName);
    }

    public void pop() {
        segments.removeLast();
    }

    public String current() {
        return String.join("/", segments);
    }

    public boolean endsWith(String... expected) {
        if (expected.length > segments.size()) {
            return false;
        }
        String[] actual = segments.toArray(new String[0]);
        int offset = actual.length - expected.length;
        for (int i = 0; i < expected.length; i++) {
            if (!actual[offset + i].equals(expected[i])) {
                return false;
            }
        }
        return true;
    }
}
```

### 13.2 Index-Aware Path

Untuk error report yang bagus:

```text
/applications/application[42]/documents/document[3]/type
```

Butuh counter per sibling.

Konsep:

```text
on startElement:
  increment count of this name under current parent
  push frame(name, index)

on endElement:
  pop frame
```

Ini sangat membantu BA/user membaca error.

---

## 14. Pattern 9 — Validation Layering

### 14.1 Layered Validation

Jangan menaruh semua validation di parser handler.

Pisahkan:

```text
Well-formed XML
  -> parser
Namespace/root validation
  -> parser handler startup
Structural validation
  -> extractor / schema
Semantic validation
  -> domain service
Persistence validation
  -> repository / constraints
Operational validation
  -> import orchestrator
```

### 14.2 Schema vs Code

Schema bagus untuk:

- required elements;
- data type format;
- enumeration;
- structural constraints;
- namespace contract.

Code bagus untuk:

- database lookup;
- cross-record validation;
- temporal rules;
- state transition;
- permission/agency-specific rules;
- conditional logic kompleks.

### 14.3 Jangan Memaksa XSD untuk Semua Rule

XSD bisa kompleks. Rule domain yang berubah cepat biasanya lebih maintainable di code.

Gunakan schema untuk kontrak struktural, code untuk semantic policy.

---

## 15. Pattern 10 — Backpressure and Flow Control

### 15.1 SAX Parser Pushes, Application Must Keep Up

SAX parser memanggil handler secara synchronous.

Jika handler lambat, parse lambat. Jika handler melakukan blocking DB call per event, throughput buruk.

### 15.2 Synchronous Batch Sink

Paling sederhana:

```text
handler -> batch buffer -> DB batch insert
```

Pros:

- sederhana;
- predictable;
- no concurrency bug;
- backpressure natural.

Cons:

- parser menunggu DB;
- throughput terbatas.

### 15.3 Async Queue Sink

```text
handler -> bounded queue -> worker(s) -> staging DB
```

Pros:

- parser dan DB writer bisa overlap;
- throughput lebih tinggi.

Cons:

- error propagation lebih sulit;
- ordering bisa berubah;
- memory perlu dibatasi;
- shutdown/cancellation lebih kompleks;
- transaction boundary lebih rumit.

### 15.4 Rule Praktis

Mulai dari synchronous batch. Naik ke async hanya jika bottleneck terbukti.

Untuk regulatory/import pipeline, correctness dan auditability sering lebih penting daripada parsing tercepat.

---

## 16. Pattern 11 — Large Document Memory Strategy

### 16.1 Memory Budget

Sebelum memilih parser, tentukan:

```text
max_input_size
max_record_size
max_batch_size
max_text_field_size
max_attribute_count
max_element_depth
max_records
```

Tanpa batas, “streaming” pun bisa diserang.

Contoh: satu `<description>` berisi 500 MB text tetap bisa membuat handler OOM jika text accumulator tidak dibatasi.

### 16.2 Bounded Text Accumulator

```java
public final class BoundedTextBuffer {
    private final int maxChars;
    private final StringBuilder builder = new StringBuilder();

    public BoundedTextBuffer(int maxChars) {
        if (maxChars <= 0) {
            throw new IllegalArgumentException("maxChars must be positive");
        }
        this.maxChars = maxChars;
    }

    public void append(char[] ch, int start, int length) throws TextTooLargeException {
        if (builder.length() + length > maxChars) {
            throw new TextTooLargeException("Text exceeds max chars: " + maxChars);
        }
        builder.append(ch, start, length);
    }

    public String consumeTrimmed() {
        String value = builder.toString().trim();
        builder.setLength(0);
        return value;
    }

    public void clear() {
        builder.setLength(0);
    }

    public static final class TextTooLargeException extends Exception {
        public TextTooLargeException(String message) {
            super(message);
        }
    }
}
```

Dalam SAX handler, wrap menjadi `SAXException`.

### 16.3 Max Depth

Element depth terlalu dalam bisa menyebabkan:

- memory growth pada stack;
- CPU overhead;
- parser/handler stress;
- malicious input.

Track depth manual:

```java
private static final int MAX_DEPTH = 128;
private int depth;

@Override
public void startElement(String uri, String localName, String qName, Attributes attributes) throws SAXException {
    depth++;
    if (depth > MAX_DEPTH) {
        throw new SAXException("XML depth exceeds limit: " + MAX_DEPTH);
    }
}

@Override
public void endElement(String uri, String localName, String qName) {
    depth--;
}
```

### 16.4 Max Record Count

```java
private static final long MAX_RECORDS = 1_000_000L;
private long records;

private void onRecordCompleted() throws SAXException {
    records++;
    if (records > MAX_RECORDS) {
        throw new SAXException("Record count exceeds limit: " + MAX_RECORDS);
    }
}
```

---

## 17. Pattern 12 — Reconciliation and Control Totals

### 17.1 Kenapa Reconciliation Penting

Banyak XML batch punya control header:

```xml
<feed>
  <header>
    <recordCount>10000</recordCount>
    <totalAmount>1234567.89</totalAmount>
  </header>
  <records>...</records>
</feed>
```

Jangan abaikan header.

Gunakan untuk reconciliation:

- expected count vs parsed count;
- expected total amount vs computed total;
- file generation date;
- source system id;
- sequence number;
- checksum;
- version.

### 17.2 Streaming Reconciliation

SAX cocok untuk menghitung sambil parsing:

```text
on header -> expected totals
on record -> increment actual count and amount
end document -> compare expected vs actual
```

### 17.3 Failure Policy

Jika mismatch:

- reject whole file;
- mark import as failed;
- store staging but do not promote;
- require manual approval;
- notify source system.

Jangan silently accept mismatch.

---

## 18. Pattern 13 — Import Run State Machine

### 18.1 Model State

Untuk import production, buat state machine eksplisit:

```text
RECEIVED
  -> STORED_RAW
  -> PARSING
  -> PARSED_WITH_ERRORS
  -> PARSED_SUCCESSFULLY
  -> VALIDATING
  -> VALIDATION_FAILED
  -> READY_TO_PROMOTE
  -> PROMOTING
  -> PROMOTED
  -> FAILED
  -> CANCELLED
```

### 18.2 Kenapa State Machine?

Karena import bukan operasi instan. Ia punya lifecycle:

- file diterima;
- raw file disimpan;
- parsing dimulai;
- sebagian record reject;
- validation selesai;
- promotion menunggu approval;
- promotion gagal di tengah;
- retry;
- rollback/compensate.

Tanpa state machine, status import menjadi string bebas yang sulit diaudit.

### 18.3 Invariant

Contoh invariant:

```text
PROMOTED implies promoted_at is not null.
FAILED implies failure_reason is not null.
READY_TO_PROMOTE implies parsed_count = valid_count and fatal_error_count = 0.
PROMOTING can only come from READY_TO_PROMOTE.
CANCELLED cannot move to PROMOTED.
```

Ini sangat penting untuk defensibility.

---

## 19. Pattern 14 — XML Versioning and Compatibility

### 19.1 Version in Namespace

Sering lebih jelas:

```xml
<applications xmlns="urn:example:applications:v2">
```

Namespace versioning memudahkan parser memilih extractor.

### 19.2 Version in Attribute

```xml
<applications version="2.0">
```

Lebih mudah dibaca, tapi namespace collision masih perlu diatur.

### 19.3 Multi-Version Extractor

```java
public interface XmlExtractor<T> {
    boolean supports(String namespaceUri, String rootLocalName, String version);
    T extract(Document document);
}
```

Atau untuk SAX:

```java
public interface SaxHandlerFactory {
    boolean supports(String namespaceUri, String rootLocalName, String version);
    DefaultHandler create(ImportContext context);
}
```

### 19.4 Compatibility Policy

Tentukan:

- apakah field baru boleh diabaikan?
- apakah element unknown fatal?
- apakah enum unknown disimpan sebagai raw value?
- apakah versi lama masih diterima?
- kapan versi lama deprecated?
- bagaimana error message untuk unsupported version?

---

## 20. Pattern 15 — Testing Strategy

### 20.1 Test Matrix

Test XML processing harus mencakup:

| Category | Example |
|---|---|
| happy path | valid XML minimal dan lengkap |
| namespace | default namespace, prefix berbeda, missing namespace |
| structure | missing required element, duplicate element |
| text | fragmented text, whitespace, CDATA |
| size | large file, large field, deep nesting |
| security | DOCTYPE, external entity, entity expansion |
| validation | invalid schema/business rule |
| error report | line/column/path benar |
| idempotency | same file processed twice |
| partial failure | one bad record among many |
| compatibility | v1/v2/v3 XML |

### 20.2 SAX Fragmented Characters Test

Sulit memaksa parser memecah `characters()` dengan cara tertentu. Untuk unit test handler, panggil handler langsung:

```java
handler.startElement(NS, "name", "name", emptyAttributes());
handler.characters("Fa".toCharArray(), 0, 2);
handler.characters("jar".toCharArray(), 0, 3);
handler.endElement(NS, "name", "name");
```

Ini memastikan handler tidak bergantung pada satu call.

### 20.3 Golden Files

Gunakan golden XML files:

```text
src/test/resources/xml/v1/valid-minimal.xml
src/test/resources/xml/v1/valid-full.xml
src/test/resources/xml/v1/missing-required-field.xml
src/test/resources/xml/v1/unknown-namespace.xml
src/test/resources/xml/security/xxe-file.xml
src/test/resources/xml/security/billion-laughs.xml
src/test/resources/xml/large/10000-records.xml
```

### 20.4 Property-Based Thinking

Untuk parser/extractor:

- field order berubah, hasil tetap benar jika schema mengizinkan;
- prefix namespace berubah, hasil tetap benar;
- whitespace sekitar text tidak merusak trimmed fields;
- unknown optional element tidak fatal jika policy allow;
- duplicate unique element fatal;
- same input yields same output.

---

## 21. Performance Considerations

### 21.1 DOM Performance

DOM cost utama:

- seluruh tree di memory;
- banyak object kecil;
- GC pressure;
- traversal descendant berulang;
- string/text object;
- namespace/attribute overhead.

Optimasi:

- enforce max input size;
- avoid repeated `getElementsByTagNameNS` pada root besar;
- traverse once;
- avoid retaining `Document` setelah extraction;
- extract to immutable DTO lalu release DOM;
- do not cache DOM globally.

### 21.2 SAX Performance

SAX cost utama:

- handler logic;
- string creation;
- path matching;
- DB calls;
- validation lookups;
- logging per event.

Optimasi:

- process at `endElement`;
- avoid creating path string per event unless needed;
- compare URI/localName carefully;
- batch output;
- avoid per-field DB call;
- limit logging;
- precompile validation sets;
- use staging.

### 21.3 Bottleneck Bias

Dalam real import, bottleneck sering bukan parser, melainkan:

- database insert;
- remote validation;
- disk IO;
- network storage;
- schema validation;
- logging;
- duplicate lookup;
- transaction locks.

Jangan micro-optimize SAX handler sebelum mengukur pipeline end-to-end.

---

## 22. Security Considerations

Part 30 sudah detail. Ringkasan penerapan di pattern production:

1. semua parser factory harus hardened;
2. jangan parse untrusted XML dengan default factory;
3. batasi input size sebelum parse;
4. batasi depth, text length, record count;
5. disable external entity/DTD jika tidak diperlukan;
6. restrict external schema/DTD access;
7. jangan log raw XML sensitif;
8. simpan raw file terenkripsi jika mengandung data sensitif;
9. validasi namespace root;
10. treat XML version/schema sebagai contract, bukan hint.

---

## 23. Production Blueprint: Large XML Import Service

### 23.1 Komponen

```text
XmlImportController / Job Trigger
  -> ImportRunService
  -> RawFileStorage
  -> ParserFactoryProvider
  -> SaxRecordExtractor
  -> RecordValidator
  -> StagingWriter
  -> ReconciliationService
  -> PromotionService
  -> ImportAuditService
```

### 23.2 Flow

```text
1. Receive file
2. Compute checksum
3. Create import run: RECEIVED
4. Store raw file
5. Mark STORED_RAW
6. Configure hardened SAX parser
7. Parse file
8. Emit records to bounded batch sink
9. Write staging rows
10. Reconcile count/totals
11. Validate staged records
12. Mark READY_TO_PROMOTE or VALIDATION_FAILED
13. Promote valid data according to policy
14. Mark PROMOTED or FAILED
15. Generate report
```

### 23.3 Pseudocode Orchestrator

```java
public final class XmlImportService {

    private final RawFileStorage rawFileStorage;
    private final ImportRunRepository runRepository;
    private final SecureSaxParserFactory saxParserFactory;
    private final StagingWriter stagingWriter;
    private final ReconciliationService reconciliationService;
    private final PromotionService promotionService;

    public ImportResult importFile(InputFile input) {
        String checksum = rawFileStorage.checksum(input);

        ImportRun run = runRepository.create(input.fileName(), checksum);

        try {
            rawFileStorage.store(run.id(), input);
            runRepository.transition(run.id(), ImportState.STORED_RAW);

            runRepository.transition(run.id(), ImportState.PARSING);

            try (BatchingSink<ApplicationRecord> sink = new BatchingSink<>(500,
                    batch -> stagingWriter.writeBatch(run.id(), batch))) {

                ApplicationSaxHandler handler = new ApplicationSaxHandler(sink);
                saxParserFactory.parse(input.openStream(), handler);
            }

            runRepository.transition(run.id(), ImportState.PARSED_SUCCESSFULLY);

            ReconciliationResult reconciliation = reconciliationService.reconcile(run.id());
            if (!reconciliation.success()) {
                runRepository.fail(run.id(), reconciliation.message());
                return ImportResult.failed(run.id(), reconciliation.message());
            }

            runRepository.transition(run.id(), ImportState.READY_TO_PROMOTE);
            promotionService.promote(run.id());
            runRepository.transition(run.id(), ImportState.PROMOTED);

            return ImportResult.success(run.id());
        } catch (Exception e) {
            runRepository.fail(run.id(), e.getMessage());
            return ImportResult.failed(run.id(), e.getMessage());
        }
    }
}
```

Catatan:

- contoh di atas sengaja konseptual;
- production perlu exception taxonomy lebih rapi;
- jangan simpan hanya `e.getMessage()` untuk observability internal;
- error report user-facing harus disanitasi;
- raw file stream harus dikelola hati-hati;
- retry/promotion perlu idempotency.

---

## 24. Decision Matrix

| Constraint | Recommended Pattern |
|---|---|
| XML < 1 MB, perlu random access | DOM |
| XML besar, record flat | SAX direct extraction |
| XML besar, record kompleks | SAX + DOM subtree |
| Butuh mutation seluruh document | DOM |
| Butuh lowest memory | SAX |
| Butuh simple code dan input kecil | DOM |
| Butuh partial record failure | SAX + staging |
| Butuh replay/audit | raw storage + staging |
| Unknown external input | hardened SAX/DOM + limits |
| Banyak versi XML | extractor registry |
| Complex domain validation | parser extracts DTO, service validates |

---

## 25. Anti-Patterns

### 25.1 DOM Everything

```text
All XML -> DOM -> query anywhere
```

Buruk untuk:

- large files;
- untrusted input;
- batch feed;
- memory-constrained services.

### 25.2 SAX Handler Writes Final Tables Directly

Parser handler yang langsung melakukan insert/update final table sering:

- sulit dites;
- sulit retry;
- sulit rollback;
- sulit audit;
- rentan partial side effects.

### 25.3 No Import Run Entity

Tanpa import run:

- tidak tahu file mana yang sedang diproses;
- tidak tahu progress;
- tidak tahu error count;
- tidak bisa resume;
- tidak bisa audit.

### 25.4 XML Path as Stringly-Typed Everywhere

Path string berguna untuk error report, tapi jangan semua logic domain bergantung pada string path tanpa helper/type.

### 25.5 Ignoring Namespace

XML tanpa namespace handling akan rusak saat:

- prefix berubah;
- default namespace muncul;
- ada dua vocabulary dengan local name sama;
- versi baru memperkenalkan namespace baru.

### 25.6 Per-Event Logging

Logging setiap SAX event pada file besar bisa:

- memperlambat import;
- membanjiri log;
- leak data sensitif;
- membuat observability noise.

Log per milestone, per batch, per error summary.

---

## 26. Failure Modelling

### 26.1 File-Level Failures

| Failure | Example | Action |
|---|---|---|
| unreadable input | stream error | mark failed, retry possible |
| malformed XML | unclosed tag | reject file |
| unsupported namespace | root namespace unknown | reject file |
| security violation | DOCTYPE forbidden | reject and alert |
| size limit exceeded | file > max | reject |
| schema invalid | if policy strict | reject file |

### 26.2 Record-Level Failures

| Failure | Example | Action |
|---|---|---|
| missing field | no applicant id | reject record |
| invalid enum | status unknown | reject or map unknown |
| duplicate record | same external id | skip/reject/update based policy |
| semantic violation | invalid transition | reject record |
| reference missing | unknown agency code | reject or hold |

### 26.3 System-Level Failures

| Failure | Example | Action |
|---|---|---|
| DB unavailable | staging write fails | fail run, retry later |
| disk full | raw storage fails | fail run |
| timeout | import exceeds SLA | cancel/mark timeout |
| OOM | memory bug/attack | incident, tighten limits |
| bug | NPE in handler | fail run, fix code |

---

## 27. Production Checklist

### 27.1 Parser Selection

- [ ] Apakah ukuran maksimum input diketahui?
- [ ] Apakah random access benar-benar diperlukan?
- [ ] Apakah DOM global aman dari sisi memory?
- [ ] Apakah SAX state machine cukup sederhana?
- [ ] Apakah hybrid lebih cocok?

### 27.2 Security

- [ ] Parser factory hardened?
- [ ] External DTD/schema access dibatasi?
- [ ] DOCTYPE policy eksplisit?
- [ ] Entity expansion limit aktif?
- [ ] Input size dibatasi sebelum parse?
- [ ] Text field length dibatasi?
- [ ] Element depth dibatasi?

### 27.3 Correctness

- [ ] Namespace-aware?
- [ ] Root namespace/version validated?
- [ ] Required fields checked?
- [ ] Duplicate elements policy jelas?
- [ ] Unknown elements policy jelas?
- [ ] Schema vs semantic validation dipisah?

### 27.4 Reliability

- [ ] Import run state machine ada?
- [ ] Raw file stored untuk replay?
- [ ] Staging table digunakan untuk large import?
- [ ] Idempotency strategy ada?
- [ ] Batch transaction boundary jelas?
- [ ] Partial failure policy jelas?

### 27.5 Observability

- [ ] Metrics: records parsed, rejected, staged, promoted?
- [ ] Duration per phase?
- [ ] Error report dengan record id/path/line/column?
- [ ] Logs tidak membocorkan data sensitif?
- [ ] Import run dapat ditelusuri dari UI/API?

### 27.6 Performance

- [ ] Batch size tuned?
- [ ] No per-field DB lookup?
- [ ] No per-event log?
- [ ] DOM tidak ditahan setelah extraction?
- [ ] Backpressure natural atau bounded queue?

---

## 28. Latihan / Thought Exercise

### Exercise 1 — Parser Choice

Diberikan file XML 2 GB berisi 5 juta `<transaction>`, setiap transaction punya 12 field sederhana. Pilih DOM/SAX/hybrid dan jelaskan:

- memory model;
- transaction boundary;
- error policy;
- idempotency;
- metrics.

Jawaban ideal: SAX + batching + staging + import run state machine.

### Exercise 2 — Hybrid Design

Diberikan file 3 GB berisi `<case>`; setiap `<case>` bisa 1–3 MB dan punya nested parties/documents/history. Extraction manual SAX menjadi terlalu kompleks. Desain hybrid pipeline.

Pertimbangkan:

- max subtree size;
- per-case DOM;
- record-level failure;
- location tracking;
- namespace preservation;
- staging.

### Exercise 3 — Partial Failure Policy

Satu file berisi 10.000 records. 20 records invalid secara semantic. Source system meminta valid records tetap diproses, invalid records dilaporkan.

Desain:

- import states;
- staging schema;
- error report;
- promotion criteria;
- retry invalid records.

### Exercise 4 — XML Versioning

Versi v1 punya `<applicantName>`. Versi v2 mengganti menjadi:

```xml
<applicant>
  <firstName>...</firstName>
  <lastName>...</lastName>
</applicant>
```

Desain extractor registry untuk mendukung v1 dan v2 tanpa membuat service layer tahu detail XML.

### Exercise 5 — Security Regression Test

Buat test suite untuk memastikan parser menolak:

- DOCTYPE;
- external file entity;
- external HTTP entity;
- billion laughs;
- field text 100 MB;
- depth 10.000.

---

## 29. Ringkasan

DOM dan SAX bukan sekadar dua cara parse XML. Mereka merepresentasikan dua model pemrosesan yang berbeda:

```text
DOM = complete mutable tree
SAX = streaming event sequence
```

Untuk sistem production:

- DOM cocok untuk dokumen kecil, trusted, dan butuh random access/mutation;
- SAX cocok untuk dokumen besar, sequential, memory-sensitive;
- hybrid cocok saat file besar tetapi unit record kompleks;
- parsing harus menjadi bagian dari pipeline yang punya validation, staging, audit, idempotency, dan observability;
- SAX handler harus dirancang sebagai state machine;
- dokumen besar perlu bounded memory strategy;
- error harus diklasifikasikan antara file-level, record-level, dan system-level;
- import besar sebaiknya punya import run state machine;
- XML versioning harus diperlakukan sebagai compatibility contract;
- security hardening dari Part 30 wajib menjadi default, bukan opsi tambahan.

Mental model paling penting:

> XML processing yang mature bukan tentang “bisa parse XML”, tetapi tentang membuat boundary data eksternal menjadi aman, terbatas, terukur, dapat diaudit, dapat diulang, dan dapat dijelaskan ketika gagal.

---

## 30. Posisi dalam Seri

Kita sudah menyelesaikan:

- Part 0 sampai Part 30;
- Part 31 ini membahas advanced XML processing patterns.

Seri belum selesai.

Sisa:

- **Part 32 — Capstone: Build a Production-Grade Runtime/XML Utility Layer**

Part berikutnya akan menyatukan semua materi `java.lang`, DOM, dan SAX menjadi desain mini-library internal yang production-grade: runtime info collector, safe process executor, version detector, exception taxonomy, safe XML parser factories, DOM extractor, SAX streaming importer, testing matrix, dan production readiness checklist.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 30 — Secure XML Parsing with DOM/SAX: XXE, Billion Laughs, Expansion Limits, Hardening](./30-secure-xml-parsing-dom-sax-xxe-expansion-hardening.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 32 — Capstone: Build a Production-Grade Runtime/XML Utility Layer](./32-capstone-production-grade-runtime-xml-utility-layer.md)

</div>