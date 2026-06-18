# Part 24 — DOM Mental Model: Document as Mutable Tree, Node Identity, Ownership

> Series: `learn-java-lang-dom-sax-core-runtime-platform-contracts`  
> File: `24-dom-mental-model-document-node-tree-ownership.md`  
> Scope: Java 8–25, `org.w3c.dom.*`, DOM Core mental model  
> Status: Part 24 of 32

---

## 1. Tujuan Part Ini

Bagian ini membangun fondasi mental model DOM sebelum masuk ke operasi detail seperti creation, mutation, namespace query, DOM Level 3, dan secure parsing.

DOM sering terlihat sederhana:

```java
Document doc = builder.parse(file);
Element root = doc.getDocumentElement();
NodeList items = root.getElementsByTagName("item");
```

Tetapi di sistem production, bug DOM biasanya bukan karena developer tidak tahu cara memanggil `getElementsByTagName`, melainkan karena tidak memahami kontrak dasar berikut:

1. DOM adalah **tree object model**, bukan stream parser.
2. DOM adalah **mutable tree**, bukan immutable snapshot.
3. DOM node memiliki **identity**, bukan hanya value.
4. Setiap node memiliki **owner document**.
5. Banyak collection DOM seperti `NodeList` bersifat **live**, bukan snapshot.
6. Text dalam XML tidak selalu satu node; whitespace bisa menjadi node valid.
7. Namespace, prefix, local name, dan node name bukan konsep yang sama.
8. DOM API dibuat sebagai standard W3C, bukan API Java yang idiomatik sepenuhnya.
9. DOM object model sangat fleksibel, tetapi fleksibilitas itu berarti banyak state invalid/ambiguous harus dikontrol oleh kita.

Target akhir part ini: kamu dapat melihat DOM bukan sebagai “cara membaca XML”, tetapi sebagai **kontrak runtime untuk merepresentasikan dokumen XML sebagai graph/tree mutable yang memiliki aturan ownership, identity, ordering, namespace, dan mutation semantics**.

---

## 2. Posisi DOM dalam Java

Package utama yang kita bahas:

```text
org.w3c.dom
```

Package ini berada di module:

```text
java.xml
```

Bukan di `java.base`.

Artinya sejak Java 9 module system:

```java
module my.app {
    requires java.xml;
}
```

Jika aplikasi modular menggunakan DOM secara eksplisit, module harus membaca `java.xml`.

Di Java 8 belum ada module descriptor, tetapi package-nya tetap bagian dari Java SE.

### DOM bukan parser

Penting:

```text
DOM != parser
```

DOM adalah **API object model**.

Parser biasanya berasal dari JAXP:

```java
javax.xml.parsers.DocumentBuilderFactory
javax.xml.parsers.DocumentBuilder
```

Hasil parsing-nya bisa berupa:

```java
org.w3c.dom.Document
```

Jadi mental modelnya:

```text
XML bytes/chars
   ↓
JAXP parser / DOM builder
   ↓
org.w3c.dom.Document tree
   ↓
application traversal / mutation / extraction / serialization
```

DOM package sendiri mendefinisikan bentuk tree dan operasi node, tetapi bukan seluruh konfigurasi parsing/hardening.

Hardening parser akan dibahas detail di Part 30.

---

## 3. Apa Itu DOM?

DOM adalah singkatan dari **Document Object Model**.

Dalam konteks Java, `org.w3c.dom` menyediakan interface untuk merepresentasikan XML document sebagai object tree.

Contoh XML:

```xml
<case id="C-001">
    <status>OPEN</status>
    <owner>Fajar</owner>
</case>
```

Secara DOM, kira-kira menjadi tree:

```text
Document
└── Element: case
    ├── Attr: id = "C-001"
    ├── Text: "\n    "
    ├── Element: status
    │   └── Text: "OPEN"
    ├── Text: "\n    "
    ├── Element: owner
    │   └── Text: "Fajar"
    └── Text: "\n"
```

Perhatikan sesuatu yang sering mengejutkan:

```text
Indentasi dan newline dapat muncul sebagai Text node.
```

DOM tidak otomatis memahami bahwa whitespace itu “tidak penting”. Untuk XML, whitespace bisa saja meaningful, tergantung konteks.

---

## 4. Mental Model Utama: DOM sebagai Mutable Ordered Node Tree

DOM bukan sekadar map dari tag ke value.

DOM adalah:

```text
ordered mutable tree of nodes
```

Artinya:

1. Ada akar dokumen.
2. Ada parent-child relationship.
3. Urutan child penting.
4. Node bisa dimutasi.
5. Node punya identity.
6. Node dimiliki oleh document tertentu.
7. Ada jenis node berbeda.
8. Beberapa node dapat memiliki attributes.
9. Traversal dan query bekerja terhadap tree yang sedang hidup saat itu.

### DOM sebagai tree, bukan object domain

XML:

```xml
<application>
    <applicant>
        <name>Alice</name>
    </applicant>
</application>
```

Domain object:

```java
record Application(Applicant applicant) {}
record Applicant(String name) {}
```

DOM tree:

```text
Document
└── Element application
    └── Element applicant
        └── Element name
            └── Text Alice
```

Ketiganya berbeda:

| Model | Tujuan |
|---|---|
| XML text | interoperable serialized representation |
| DOM tree | generic structural representation |
| Domain object | typed business representation |

DOM tidak tahu bahwa `application` adalah domain application. DOM hanya tahu bahwa ada element bernama `application`.

Kesalahan umum adalah memperlakukan DOM sebagai domain model:

```java
// fragile: business logic langsung di atas DOM mentah
if (doc.getElementsByTagName("status").item(0).getTextContent().equals("APPROVED")) {
    // approve flow
}
```

Untuk sistem serius, DOM biasanya lebih aman dijadikan **intermediate representation**, lalu diekstrak ke model yang typed dan tervalidasi.

```text
XML → DOM → extractor/validator → domain command/event/object
```

---

## 5. Node: Abstraksi Paling Penting dalam DOM

Interface pusat DOM adalah:

```java
org.w3c.dom.Node
```

Banyak tipe DOM adalah subtype dari `Node`:

```text
Node
├── Document
├── Element
├── Attr
├── CharacterData
│   ├── Text
│   ├── Comment
│   └── CDATASection
├── DocumentType
├── DocumentFragment
├── ProcessingInstruction
├── EntityReference
├── Entity
└── Notation
```

Tidak semua tipe sama-sama sering digunakan, tetapi memahami node taxonomy penting supaya traversal tidak asal cast.

### Node type constants

`Node` menyediakan constants seperti:

```java
Node.ELEMENT_NODE
Node.ATTRIBUTE_NODE
Node.TEXT_NODE
Node.CDATA_SECTION_NODE
Node.ENTITY_REFERENCE_NODE
Node.PROCESSING_INSTRUCTION_NODE
Node.COMMENT_NODE
Node.DOCUMENT_NODE
Node.DOCUMENT_TYPE_NODE
Node.DOCUMENT_FRAGMENT_NODE
```

Contoh traversal aman:

```java
static void printElements(Node node) {
    if (node.getNodeType() == Node.ELEMENT_NODE) {
        Element element = (Element) node;
        System.out.println(element.getTagName());
    }

    NodeList children = node.getChildNodes();
    for (int i = 0; i < children.getLength(); i++) {
        printElements(children.item(i));
    }
}
```

Jangan langsung cast semua child ke `Element`.

Salah:

```java
NodeList children = root.getChildNodes();
for (int i = 0; i < children.getLength(); i++) {
    Element child = (Element) children.item(i); // ClassCastException jika Text/Comment
}
```

Benar:

```java
NodeList children = root.getChildNodes();
for (int i = 0; i < children.getLength(); i++) {
    Node child = children.item(i);
    if (child.getNodeType() == Node.ELEMENT_NODE) {
        Element element = (Element) child;
        // process element
    }
}
```

---

## 6. `Document`: Root Object, Owner, Factory, and Boundary

`Document` merepresentasikan seluruh XML document.

Secara mental:

```text
Document = tree container + node factory + owner boundary
```

`Document` biasanya memiliki satu document element:

```java
Element root = document.getDocumentElement();
```

Untuk XML valid/well-formed, hanya ada satu root element.

Contoh:

```xml
<root>
    <a/>
    <b/>
</root>
```

Bukan:

```xml
<a/>
<b/>
```

### Document sebagai factory

Untuk membuat node baru, gunakan factory method dari `Document`:

```java
Element item = document.createElement("item");
Text text = document.createTextNode("hello");
Comment comment = document.createComment("generated");
```

Kenapa bukan `new Element()`?

Karena DOM di Java adalah kumpulan interface. Implementasi konkretnya disediakan oleh DOM implementation/parser.

```text
Application code bergantung pada org.w3c.dom interface,
DOM implementation menyediakan concrete class.
```

### Owner document

Setiap node memiliki owner document:

```java
Document owner = node.getOwnerDocument();
```

Untuk `Document` sendiri, owner document biasanya `null` karena dia adalah pemilik.

Owner document penting karena node dari satu document tidak bisa sembarang ditempel ke document lain tanpa `importNode` atau `adoptNode`.

Salah:

```java
Document doc1 = ...;
Document doc2 = ...;

Element elementFromDoc1 = doc1.createElement("item");
doc2.getDocumentElement().appendChild(elementFromDoc1); // WRONG_DOCUMENT_ERR
```

Benar:

```java
Node imported = doc2.importNode(elementFromDoc1, true);
doc2.getDocumentElement().appendChild(imported);
```

Atau untuk memindahkan ownership bila implementation mendukung:

```java
Node adopted = doc2.adoptNode(elementFromDoc1);
doc2.getDocumentElement().appendChild(adopted);
```

Kita akan bahas detail `importNode`, `adoptNode`, dan `cloneNode` di Part 25.

---

## 7. `Element`: Structural Node Paling Umum

`Element` merepresentasikan XML element.

Contoh:

```xml
<user id="42">Alice</user>
```

DOM:

```text
Element user
├── Attr id = 42
└── Text Alice
```

API umum:

```java
String tagName = element.getTagName();
String value = element.getTextContent();
String id = element.getAttribute("id");
boolean hasId = element.hasAttribute("id");
NodeList children = element.getChildNodes();
```

### `getTagName()` bukan selalu cukup

Jika namespace dipakai:

```xml
<aceas:case xmlns:aceas="https://example.com/aceas">
</aceas:case>
```

Maka ada beberapa konsep:

| Konsep | Contoh |
|---|---|
| prefix | `aceas` |
| local name | `case` |
| qualified name / node name | `aceas:case` |
| namespace URI | `https://example.com/aceas` |

Untuk XML namespace-aware, logic robust sebaiknya berbasis:

```java
String namespace = element.getNamespaceURI();
String localName = element.getLocalName();
```

Bukan semata:

```java
element.getTagName()
```

Namespace akan dibahas lebih dalam di Part 26 dan Part 29.

---

## 8. `Attr`: Attribute Node, But Not a Normal Child

Attribute di DOM direpresentasikan sebagai `Attr`, tetapi attribute **bukan child node normal** dari element.

XML:

```xml
<case id="C-001" status="OPEN"/>
```

DOM mental model:

```text
Element case
├── attributes:
│   ├── Attr id = C-001
│   └── Attr status = OPEN
└── child nodes: none
```

`getChildNodes()` pada element tidak mengembalikan attributes.

Untuk attribute:

```java
String id = element.getAttribute("id");
Attr idAttr = element.getAttributeNode("id");
NamedNodeMap attrs = element.getAttributes();
```

Perbedaan penting:

```java
element.getAttribute("missing")
```

mengembalikan empty string jika attribute tidak ada.

Karena itu untuk membedakan absent vs present-empty:

```java
if (element.hasAttribute("id")) {
    String id = element.getAttribute("id");
}
```

Jebakan:

```xml
<case id=""/>
```

Dan:

```xml
<case/>
```

Jika hanya memakai `getAttribute("id")`, keduanya bisa terlihat sama-sama `""`.

Di domain/regulatory system, absent dan explicitly empty sering memiliki meaning berbeda.

---

## 9. `Text`, `CDATASection`, `Comment`: Character Data Nodes

XML content sering terlihat seperti value sederhana:

```xml
<name>Alice</name>
```

DOM:

```text
Element name
└── Text Alice
```

Tetapi text bisa terfragmentasi:

```text
Element description
├── Text "hello "
├── CDATASection "<raw>"
└── Text " world"
```

`getTextContent()` menggabungkan descendant text secara praktis, tetapi ia juga bisa mengambil text dari nested element.

Contoh:

```xml
<message>Hello <b>world</b></message>
```

```java
message.getTextContent(); // "Hello world"
```

Itu berguna untuk display, tetapi berbahaya jika struktur berarti.

### CDATA bukan security boundary

CDATA:

```xml
<script><![CDATA[<alert>hello</alert>]]></script>
```

CDATA hanya cara menulis character data tanpa escaping sebagian karakter XML.

CDATA bukan:

1. encrypted content;
2. trusted content;
3. safe HTML;
4. executable boundary;
5. validation guarantee.

DOM bisa merepresentasikan CDATA sebagai `CDATASection`, tetapi dalam banyak extraction, text content dapat diperlakukan sebagai character data biasa.

### Comment node

Comment:

```xml
<!-- generated by system -->
```

DOM:

```text
Comment "generated by system"
```

Comment bisa penting untuk round-trip document editing, tetapi biasanya diabaikan untuk domain extraction.

Jangan membuat business logic bergantung pada comment.

---

## 10. Parent, Child, Sibling: Tree Relationship

DOM adalah ordered tree.

Node relationship:

```java
Node parent = node.getParentNode();
Node first = node.getFirstChild();
Node last = node.getLastChild();
Node previous = node.getPreviousSibling();
Node next = node.getNextSibling();
NodeList children = node.getChildNodes();
```

Contoh XML:

```xml
<root>
    <a/>
    <b/>
    <c/>
</root>
```

Tree dengan whitespace:

```text
root
├── Text "\n    "
├── Element a
├── Text "\n    "
├── Element b
├── Text "\n    "
├── Element c
└── Text "\n"
```

`a.getNextSibling()` bisa menghasilkan text node whitespace, bukan element `b`.

Jika ingin next element sibling, buat utility:

```java
static Element nextElementSibling(Node node) {
    Node current = node.getNextSibling();
    while (current != null) {
        if (current.getNodeType() == Node.ELEMENT_NODE) {
            return (Element) current;
        }
        current = current.getNextSibling();
    }
    return null;
}
```

---

## 11. `NodeList`: Live Collection, Not Snapshot

Salah satu konsep paling penting:

```text
NodeList can be live.
```

Artinya `NodeList` dapat mencerminkan perubahan tree setelah `NodeList` diperoleh.

Contoh problem:

```java
NodeList children = root.getChildNodes();
for (int i = 0; i < children.getLength(); i++) {
    Node child = children.item(i);
    root.removeChild(child);
}
```

Ini bisa skip node karena list berubah saat iterasi.

Lebih aman:

```java
while (root.hasChildNodes()) {
    root.removeChild(root.getFirstChild());
}
```

Atau snapshot manual:

```java
static List<Node> snapshot(NodeList nodeList) {
    List<Node> result = new ArrayList<>(nodeList.getLength());
    for (int i = 0; i < nodeList.getLength(); i++) {
        result.add(nodeList.item(i));
    }
    return result;
}
```

Kemudian:

```java
for (Node child : snapshot(root.getChildNodes())) {
    root.removeChild(child);
}
```

### Kenapa live list ada?

DOM berasal dari desain API language-neutral dan tree-oriented. Live list memungkinkan view yang selalu sinkron dengan tree, tetapi tidak selalu nyaman untuk programming modern.

Di Java modern, developer sering terbiasa dengan collection snapshot/iterator fail-fast. DOM tidak mengikuti idiom itu.

---

## 12. `NamedNodeMap`: Attribute Collection yang Juga Bukan `Map`

Attributes diakses melalui:

```java
NamedNodeMap attributes = element.getAttributes();
```

Meski namanya mirip map, `NamedNodeMap` bukan `java.util.Map`.

Contoh:

```java
NamedNodeMap attrs = element.getAttributes();
for (int i = 0; i < attrs.getLength(); i++) {
    Node attr = attrs.item(i);
    System.out.println(attr.getNodeName() + "=" + attr.getNodeValue());
}
```

Attribute order tidak seharusnya dijadikan business contract.

Jika butuh attribute tertentu:

```java
Node id = attrs.getNamedItem("id");
```

Atau namespace-aware:

```java
Node id = attrs.getNamedItemNS(namespaceUri, "id");
```

---

## 13. Node Identity vs Node Value

DOM node adalah object dengan identity.

Dua node bisa memiliki struktur dan value sama, tetapi bukan node yang sama.

```xml
<root>
    <item>A</item>
    <item>A</item>
</root>
```

Dua `<item>A</item>` adalah dua `Element` berbeda.

Di Java:

```java
Node first = items.item(0);
Node second = items.item(1);

System.out.println(first == second); // false
System.out.println(first.isSameNode(second)); // false
System.out.println(first.isEqualNode(second)); // possibly true
```

Konsep:

| Operation | Meaning |
|---|---|
| `==` | Java object reference identity |
| `isSameNode` | DOM same node identity |
| `isEqualNode` | structural/value equality according to DOM |

Untuk kebanyakan implementation, `==` dan `isSameNode` sering sama hasilnya, tetapi secara API DOM, `isSameNode` adalah cara DOM-aware.

### Identity matters in mutation

Jika node dipindahkan:

```java
parent2.appendChild(child);
```

Node `child` bukan dicopy. Ia dipindahkan dari parent lama ke parent baru.

```text
appendChild existing node = move, not duplicate
```

Jika butuh duplicate:

```java
Node copy = child.cloneNode(true);
parent2.appendChild(copy);
```

---

## 14. Node Ownership and Movement

DOM memiliki aturan ownership:

```text
A node belongs to a Document.
```

Dalam document yang sama:

```java
Element a = doc.createElement("a");
Element b = doc.createElement("b");
Element child = doc.createElement("child");

a.appendChild(child);
b.appendChild(child); // child moved from a to b
```

Tree akhir:

```text
b
└── child
```

`a` tidak lagi punya `child`.

Dalam document berbeda, perlu import/adopt.

```java
Node imported = targetDoc.importNode(sourceNode, true);
targetRoot.appendChild(imported);
```

Deep import:

```java
importNode(sourceNode, true)
```

Shallow import:

```java
importNode(sourceNode, false)
```

Ownership bug sering muncul ketika aplikasi melakukan merge XML dari banyak sumber.

---

## 15. Whitespace Is Data Unless Proven Otherwise

XML tidak sama dengan JSON object.

Whitespace bisa menjadi character data.

Contoh:

```xml
<name>Alice</name>
```

Text content jelas `Alice`.

Tetapi:

```xml
<address>
    <line1>Main Street</line1>
    <line2>Unit 10</line2>
</address>
```

DOM children dari `address` kemungkinan:

```text
Text "\n    "
Element line1
Text "\n    "
Element line2
Text "\n"
```

Jika kamu menghitung children:

```java
address.getChildNodes().getLength()
```

hasilnya bukan 2, bisa 5.

### Element children utility

Gunakan helper:

```java
static List<Element> childElements(Element parent) {
    NodeList children = parent.getChildNodes();
    List<Element> result = new ArrayList<>();
    for (int i = 0; i < children.getLength(); i++) {
        Node child = children.item(i);
        if (child.getNodeType() == Node.ELEMENT_NODE) {
            result.add((Element) child);
        }
    }
    return result;
}
```

### Whitespace stripping harus hati-hati

Ada parser setting seperti ignoring element content whitespace, tetapi biasanya bergantung pada validation/DTD/schema awareness. Jangan berasumsi parser otomatis membuang indentation.

Untuk extraction domain, lebih baik traversal eksplisit:

```java
List<Element> lines = childElements(address);
```

Daripada mengandalkan jumlah child node mentah.

---

## 16. `normalize()`: Menggabungkan Adjacent Text Nodes

DOM dapat memiliki text nodes bersebelahan.

Contoh setelah mutation:

```java
Element name = doc.createElement("name");
name.appendChild(doc.createTextNode("Ali"));
name.appendChild(doc.createTextNode("ce"));
```

Tree:

```text
Element name
├── Text "Ali"
└── Text "ce"
```

`normalize()` dapat menggabungkan adjacent text nodes:

```java
name.normalize();
```

Menjadi:

```text
Element name
└── Text "Alice"
```

Penting:

```java
normalize() bukan XML validation.
normalize() bukan canonicalization.
normalize() bukan security sanitizer.
```

Ia terutama merapikan text node structure.

Untuk canonical XML, signature, atau byte-level deterministic serialization, topiknya berbeda.

---

## 17. `getTextContent()`: Convenient but Dangerous

`Node.getTextContent()` sering dipakai karena mudah.

Contoh:

```java
String status = statusElement.getTextContent().trim();
```

Ini wajar untuk element leaf:

```xml
<status>OPEN</status>
```

Tetapi untuk element campuran:

```xml
<message>Hello <b>world</b></message>
```

`getTextContent()` menggabungkan text descendant:

```text
Hello world
```

Jika struktur nested penting, `getTextContent()` bisa menyembunyikan struktur.

Contoh bahaya:

```xml
<amount>
    <currency>SGD</currency>
    <value>100</value>
</amount>
```

```java
amount.getTextContent().trim();
```

Hasil bisa seperti:

```text
SGD
100
```

Itu bukan amount.

Rule praktis:

```text
Use getTextContent() only when you have asserted the element is expected to be text-only or leaf-like.
```

Helper lebih aman:

```java
static String requiredTextOnly(Element element) {
    StringBuilder sb = new StringBuilder();
    NodeList children = element.getChildNodes();
    for (int i = 0; i < children.getLength(); i++) {
        Node child = children.item(i);
        switch (child.getNodeType()) {
            case Node.TEXT_NODE:
            case Node.CDATA_SECTION_NODE:
                sb.append(child.getNodeValue());
                break;
            case Node.COMMENT_NODE:
                break;
            default:
                throw new IllegalArgumentException(
                    "Expected text-only element <" + element.getTagName() + "> but found child node type " + child.getNodeType()
                );
        }
    }
    return sb.toString();
}
```

---

## 18. DOM Is Mutable: Design Consequences

DOM mutation examples:

```java
element.setAttribute("status", "OPEN");
element.appendChild(doc.createElement("audit"));
element.removeChild(oldChild);
element.replaceChild(newChild, oldChild);
```

Because DOM is mutable:

1. passing a DOM node to another method gives that method mutation power;
2. live `NodeList` can change under your feet;
3. cached assumptions can become stale;
4. concurrent access is dangerous unless externally controlled;
5. business logic can accidentally modify source document;
6. validation done before mutation may no longer hold after mutation.

### Defensive boundary pattern

If a method only needs to read, avoid exposing raw mutable DOM too widely.

Instead of:

```java
void process(Element element) {
    // many layers can mutate
}
```

Consider extracting value object early:

```java
record CaseXml(String id, String status, String owner) {}
```

```java
CaseXml parsed = CaseXmlExtractor.extract(caseElement);
caseService.handle(parsed);
```

Or keep DOM mutation localized:

```text
parse XML
  ↓
validate structural assumptions
  ↓
extract typed values
  ↓
discard DOM / keep for audit only
```

---

## 19. DOM and Concurrency

DOM interfaces do not give a simple guarantee that arbitrary concurrent read/write access is safe.

Treat DOM document as:

```text
not safe for uncontrolled concurrent mutation
```

Practical rules:

1. build DOM in one thread;
2. do not mutate while another thread traverses;
3. if sharing read-only DOM, freeze by convention, not by API;
4. for concurrent processing, extract immutable model first;
5. never store mutable DOM in long-lived shared cache unless ownership and lifecycle are explicit.

Bad pattern:

```java
static Document sharedConfigDoc;
```

Then many threads mutate attributes or normalize nodes.

Better:

```java
record ConfigRule(String code, String action) {}
```

Parse DOM once, extract immutable rules, discard mutable tree.

---

## 20. DOM and Memory Model

DOM loads the whole document tree into memory.

Memory cost is not just XML file size.

A small-looking XML file can produce many objects:

```text
Document object
Element objects
Attr objects
Text objects
NodeList views
String names/values
implementation-specific internal structures
```

A 50 MB XML file may require far more than 50 MB heap, especially with many small elements/attributes.

Rule of thumb:

```text
DOM is suitable when the document is small/medium and you need random access or mutation.
SAX/StAX is better when the document is huge and processing is sequential.
```

Use DOM when:

1. you need random access to many parts of a small/medium document;
2. you need to modify tree structure;
3. you need to build XML programmatically;
4. you need simple extraction from controlled payloads;
5. you need DOM API interop with another library.

Avoid DOM when:

1. XML can be very large;
2. input is untrusted and not size-limited;
3. you only need sequential extraction;
4. you need streaming validation/import;
5. you need backpressure-aware processing;
6. memory predictability is critical.

---

## 21. DOM as Boundary Object in Enterprise Systems

In enterprise systems, XML appears in:

1. external agency integration;
2. SOAP legacy payloads;
3. regulatory filings;
4. document templates;
5. metadata exchange;
6. batch imports;
7. audit export/import;
8. digital signature workflows;
9. old middleware contracts.

DOM can be useful, but its place should be explicit.

### Good usage pattern: parse → validate → extract

```text
XML input
  ↓
secure parser config
  ↓
DOM document
  ↓
structural validation
  ↓
typed extraction
  ↓
domain command/event
```

DOM exists only near integration boundary.

### Risky pattern: DOM everywhere

```text
controller → service → repository → workflow engine all passing Element/Document
```

Problems:

1. no typed contract;
2. no clear ownership;
3. mutation can happen anywhere;
4. validation responsibility unclear;
5. difficult testing;
6. difficult auditability;
7. domain rules become XPath/tag-string spaghetti.

### Better internal contract

```java
record ImportedCase(
    String externalReference,
    CaseType type,
    LocalDate submittedDate,
    List<Party> parties
) {}
```

DOM should not leak into core domain unless your domain truly is XML editing.

---

## 22. Step-by-Step Example: Understanding a DOM Tree

### XML input

```xml
<?xml version="1.0" encoding="UTF-8"?>
<case id="C-001" xmlns="https://example.com/case">
    <status>OPEN</status>
    <owner>Fajar</owner>
    <!-- audit marker -->
</case>
```

### Parser setup for demonstration only

Security hardening intentionally omitted here; Part 30 covers it. For real untrusted input, do not use naive parser config.

```java
import org.w3c.dom.*;
import javax.xml.parsers.*;
import java.io.*;
import java.nio.charset.StandardCharsets;

public class DomTreeDemo {
    public static void main(String[] args) throws Exception {
        String xml = """
            <?xml version=\"1.0\" encoding=\"UTF-8\"?>
            <case id=\"C-001\" xmlns=\"https://example.com/case\">
                <status>OPEN</status>
                <owner>Fajar</owner>
                <!-- audit marker -->
            </case>
            """;

        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setNamespaceAware(true);

        DocumentBuilder builder = factory.newDocumentBuilder();
        Document doc = builder.parse(new ByteArrayInputStream(xml.getBytes(StandardCharsets.UTF_8)));

        print(doc, 0);
    }

    static void print(Node node, int depth) {
        String indent = "  ".repeat(depth);
        System.out.printf(
            "%s%s name=%s local=%s ns=%s value=%s%n",
            indent,
            typeName(node),
            node.getNodeName(),
            node.getLocalName(),
            node.getNamespaceURI(),
            compact(node.getNodeValue())
        );

        NamedNodeMap attrs = node.getAttributes();
        if (attrs != null) {
            for (int i = 0; i < attrs.getLength(); i++) {
                Node attr = attrs.item(i);
                System.out.printf(
                    "%s  @%s local=%s ns=%s value=%s%n",
                    indent,
                    attr.getNodeName(),
                    attr.getLocalName(),
                    attr.getNamespaceURI(),
                    attr.getNodeValue()
                );
            }
        }

        NodeList children = node.getChildNodes();
        for (int i = 0; i < children.getLength(); i++) {
            print(children.item(i), depth + 1);
        }
    }

    static String typeName(Node node) {
        return switch (node.getNodeType()) {
            case Node.DOCUMENT_NODE -> "Document";
            case Node.ELEMENT_NODE -> "Element";
            case Node.ATTRIBUTE_NODE -> "Attr";
            case Node.TEXT_NODE -> "Text";
            case Node.COMMENT_NODE -> "Comment";
            case Node.CDATA_SECTION_NODE -> "CDATA";
            default -> "NodeType(" + node.getNodeType() + ")";
        };
    }

    static String compact(String value) {
        if (value == null) return "null";
        return value.replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t");
    }
}
```

### What this teaches

Output akan menunjukkan bahwa:

1. document node punya child root element;
2. whitespace indentation menjadi text node;
3. comment menjadi node;
4. default namespace memengaruhi element namespace URI;
5. attribute `id` tidak otomatis berada di namespace default;
6. node name/local name/namespace URI berbeda.

Poin 5 penting:

```xml
<case xmlns="https://example.com/case" id="C-001">
```

Default namespace berlaku untuk element, bukan unprefixed attribute.

Jadi attribute `id` namespace URI-nya biasanya `null`.

---

## 23. Java 8–25 Compatibility Notes

DOM Core di Java relatif stabil dari Java 8 sampai Java 25.

Yang berubah lebih banyak berada di sekitar:

1. module system sejak Java 9;
2. parser implementation dan JAXP security defaults/limits;
3. platform default charset sejak Java 18;
4. Security Manager deprecation/disablement path;
5. language features yang memudahkan kode DOM utility, seperti `var`, switch expressions, records, text blocks;
6. runtime constraints saat aplikasi modular.

### Java 8

Java 8 belum memiliki JPMS.

DOM digunakan langsung:

```java
import org.w3c.dom.Document;
```

Tidak ada `module-info.java`.

### Java 9+

DOM berada di module `java.xml`.

```java
module app.xml {
    requires java.xml;
}
```

Jika kode non-modular berjalan di classpath, biasanya tetap dapat mengakses `java.xml` karena root module resolution untuk classpath berbeda dari explicit named module setup. Namun untuk aplikasi modular serius, deklarasi module tetap perlu benar.

### Java 15+

Text blocks memudahkan contoh XML inline:

```java
String xml = """
    <case>
        <status>OPEN</status>
    </case>
    """;
```

Tetapi text block bisa memasukkan newline/indentation yang menjadi whitespace node di DOM. Jadi text block justru membantu mengingat bahwa formatting adalah data dalam XML.

### Java 16+

Records memudahkan typed extraction result:

```java
record CasePayload(String id, String status) {}
```

### Java 17–25

Sealed types dapat dipakai untuk model hasil parsing:

```java
sealed interface XmlImportResult permits XmlImportSuccess, XmlImportRejected {}
record XmlImportSuccess(String caseId) implements XmlImportResult {}
record XmlImportRejected(String reason) implements XmlImportResult {}
```

DOM API-nya tetap sama, tetapi cara membangun layer di sekitarnya bisa lebih modern.

---

## 24. Practical DOM Utility Layer

Untuk production, biasanya kamu tidak ingin DOM raw menyebar ke mana-mana. Buat utility kecil yang eksplisit.

### Element child filter

```java
public final class DomNodes {
    private DomNodes() {}

    public static List<Element> childElements(Element parent) {
        NodeList children = parent.getChildNodes();
        List<Element> result = new ArrayList<>();
        for (int i = 0; i < children.getLength(); i++) {
            Node child = children.item(i);
            if (child.getNodeType() == Node.ELEMENT_NODE) {
                result.add((Element) child);
            }
        }
        return result;
    }

    public static List<Element> childElements(Element parent, String namespaceUri, String localName) {
        List<Element> result = new ArrayList<>();
        for (Element child : childElements(parent)) {
            if (Objects.equals(namespaceUri, child.getNamespaceURI())
                    && Objects.equals(localName, child.getLocalName())) {
                result.add(child);
            }
        }
        return result;
    }

    public static Optional<Element> firstChildElement(Element parent, String namespaceUri, String localName) {
        List<Element> matches = childElements(parent, namespaceUri, localName);
        if (matches.isEmpty()) return Optional.empty();
        return Optional.of(matches.get(0));
    }
}
```

### Required child element

```java
public static Element requiredSingleChildElement(Element parent, String namespaceUri, String localName) {
    List<Element> matches = childElements(parent, namespaceUri, localName);
    if (matches.size() != 1) {
        throw new IllegalArgumentException(
            "Expected exactly one child element {" + namespaceUri + "}" + localName
            + " under <" + parent.getNodeName() + "> but found " + matches.size()
        );
    }
    return matches.get(0);
}
```

### Required attribute

```java
public static String requiredAttribute(Element element, String name) {
    if (!element.hasAttribute(name)) {
        throw new IllegalArgumentException(
            "Missing required attribute '" + name + "' on <" + element.getNodeName() + ">"
        );
    }
    return element.getAttribute(name);
}
```

### Text-only extraction

```java
public static String requiredTextOnly(Element element) {
    StringBuilder text = new StringBuilder();
    NodeList children = element.getChildNodes();

    for (int i = 0; i < children.getLength(); i++) {
        Node child = children.item(i);
        switch (child.getNodeType()) {
            case Node.TEXT_NODE:
            case Node.CDATA_SECTION_NODE:
                text.append(child.getNodeValue());
                break;
            case Node.COMMENT_NODE:
                break;
            default:
                throw new IllegalArgumentException(
                    "Expected text-only element <" + element.getNodeName() + "> but found child " + child.getNodeName()
                );
        }
    }

    return text.toString();
}
```

### Why utilities matter

Utilities encode invariants:

1. only element children matter;
2. namespace-aware matching;
3. absent vs empty attribute distinction;
4. expected cardinality;
5. text-only assertion;
6. better error messages.

Without these, DOM code becomes repetitive and inconsistent.

---

## 25. Failure Modes

### Failure Mode 1 — Assuming child nodes are all elements

Bad:

```java
Element first = (Element) root.getChildNodes().item(0);
```

Can fail because item 0 may be whitespace text.

Better:

```java
Element first = childElements(root).get(0);
```

---

### Failure Mode 2 — Treating `NodeList` as snapshot

Bad:

```java
NodeList nodes = root.getChildNodes();
for (int i = 0; i < nodes.getLength(); i++) {
    root.removeChild(nodes.item(i));
}
```

Better:

```java
while (root.hasChildNodes()) {
    root.removeChild(root.getFirstChild());
}
```

Or snapshot first.

---

### Failure Mode 3 — Moving node accidentally

Bad:

```java
archive.appendChild(activeCaseElement);
```

This moves `activeCaseElement` from previous parent.

Better if duplication intended:

```java
archive.appendChild(activeCaseElement.cloneNode(true));
```

---

### Failure Mode 4 — Cross-document append

Bad:

```java
doc2.getDocumentElement().appendChild(nodeFromDoc1);
```

Better:

```java
doc2.getDocumentElement().appendChild(doc2.importNode(nodeFromDoc1, true));
```

---

### Failure Mode 5 — Prefix-based namespace logic

Bad:

```java
if (element.getNodeName().equals("aceas:case")) { }
```

Prefix can change while namespace URI remains the same.

Better:

```java
if (Objects.equals(element.getNamespaceURI(), ACEAS_NS)
        && Objects.equals(element.getLocalName(), "case")) {
}
```

---

### Failure Mode 6 — `getAttribute` cannot distinguish absent from empty

Bad:

```java
String id = element.getAttribute("id");
if (id.isBlank()) reject();
```

Maybe absent and explicit empty require different rejection reason.

Better:

```java
if (!element.hasAttribute("id")) {
    rejectMissing();
} else if (element.getAttribute("id").isBlank()) {
    rejectEmpty();
}
```

---

### Failure Mode 7 — `getTextContent()` hides nested structure

Bad:

```java
String amount = amountElement.getTextContent().trim();
```

When XML is:

```xml
<amount><currency>SGD</currency><value>100</value></amount>
```

Better:

```java
Element currency = requiredSingleChildElement(amountElement, NS, "currency");
Element value = requiredSingleChildElement(amountElement, NS, "value");
```

---

### Failure Mode 8 — DOM leaks into domain layer

Bad:

```java
caseService.process(Element caseElement);
```

Better:

```java
caseService.process(ImportedCase command);
```

---

### Failure Mode 9 — Loading huge untrusted XML into DOM

Bad:

```java
Document doc = builder.parse(untrustedInput);
```

Without size limits, parser hardening, and memory controls.

Better:

1. enforce input size limit;
2. harden XML parser;
3. prefer SAX/StAX for large sequential processing;
4. extract incrementally;
5. reject suspicious constructs.

---

### Failure Mode 10 — Assuming DOM serialization preserves original bytes

DOM parsing and re-serialization may change:

1. whitespace formatting;
2. attribute order;
3. entity representation;
4. prefix choices;
5. XML declaration;
6. empty element style.

If byte-exact preservation matters, DOM is not enough.

For signatures, canonicalization must be deliberate.

---

## 26. Performance, Memory, and Security Considerations

### Performance

DOM traversal is usually fine for small/medium documents, but performance degrades when:

1. repeated global search is used;
2. `getElementsByTagName` is called inside loops;
3. huge documents are loaded;
4. text extraction repeatedly walks large subtrees;
5. mutation triggers repeated tree scans;
6. XPath is overused without caching/understanding.

Prefer local traversal when structure is known.

Bad:

```java
for (Element item : items) {
    NodeList allStatuses = doc.getElementsByTagName("status");
}
```

Better:

```java
for (Element item : items) {
    Element status = requiredSingleChildElement(item, NS, "status");
}
```

### Memory

DOM has high object overhead.

Controls:

1. limit input size;
2. reject documents with excessive depth;
3. reject excessive node count where possible;
4. do not cache raw `Document` unnecessarily;
5. extract immutable model and release DOM reference;
6. avoid storing DOM in session/cache.

### Security

Security details come later, but the minimum mindset now:

```text
Parsing XML is not harmless.
```

Risks:

1. XXE;
2. SSRF through external entity;
3. local file disclosure;
4. entity expansion bomb;
5. decompression bomb if XML is compressed before parsing;
6. large document heap exhaustion;
7. malicious namespace/prefix tricks;
8. log injection through XML content;
9. signature wrapping attacks in signed XML contexts.

DOM mental model helps because many attacks exploit mismatch between what developer thinks the tree contains and what parser actually builds.

---

## 27. Production Checklist

Before using DOM in production, check:

### Scope

- [ ] Is DOM actually needed, or would SAX/StAX be safer?
- [ ] Is document size bounded?
- [ ] Is input trusted, semi-trusted, or untrusted?
- [ ] Is random access/mutation required?
- [ ] Is byte-exact round-trip required? If yes, DOM may not be enough.

### Parser

- [ ] Is parser namespace-aware when namespaces matter?
- [ ] Are XXE and external entities handled safely?
- [ ] Are entity expansion limits configured?
- [ ] Are DTD/schema behaviors explicit?
- [ ] Are parser errors mapped to useful diagnostics?

### Tree handling

- [ ] Are whitespace text nodes expected?
- [ ] Are `NodeList` live semantics considered?
- [ ] Are cross-document node moves using `importNode`/`adoptNode`?
- [ ] Are attributes handled separately from child nodes?
- [ ] Is absent vs empty attribute distinguished?
- [ ] Is namespace matching based on URI/localName, not prefix?

### Design

- [ ] Is DOM kept at integration boundary?
- [ ] Are typed domain objects extracted early?
- [ ] Are mutation responsibilities localized?
- [ ] Are utilities used for consistent extraction?
- [ ] Are error messages actionable?
- [ ] Are raw XML and extracted values logged safely?

### Testing

- [ ] Test with pretty-printed XML.
- [ ] Test with minified XML.
- [ ] Test with comments.
- [ ] Test with CDATA.
- [ ] Test with missing attributes.
- [ ] Test with empty attributes.
- [ ] Test with default namespace.
- [ ] Test with changed prefixes.
- [ ] Test with unexpected nested elements.
- [ ] Test with large input.

---

## 28. Thought Exercises

### Exercise 1 — Count element children correctly

Given:

```xml
<root>
    <a/>
    <b/>
</root>
```

Why can `root.getChildNodes().getLength()` return 5 instead of 2?

Answer: because whitespace/newline indentation around elements may be represented as text nodes.

---

### Exercise 2 — Attribute absent vs empty

Given:

```xml
<case id=""/>
```

and:

```xml
<case/>
```

Why is `getAttribute("id")` insufficient for precise validation?

Answer: both may return empty string; use `hasAttribute("id")` first.

---

### Exercise 3 — Namespace prefix change

Given:

```xml
<a:case xmlns:a="https://example.com/case"/>
```

and:

```xml
<b:case xmlns:b="https://example.com/case"/>
```

Should these be treated as same semantic element?

Usually yes, because namespace URI and local name are the same. Prefix is just lexical alias.

---

### Exercise 4 — Node movement

What happens here?

```java
parent1.appendChild(child);
parent2.appendChild(child);
```

Answer: `child` is moved from `parent1` to `parent2`.

---

### Exercise 5 — DOM vs domain model

Why is this bad?

```java
void approveCase(Element caseElement)
```

Answer: service layer now depends on mutable, untyped XML structure. Validation, ownership, mutation, namespace handling, and domain invariants become unclear.

Better:

```java
void approveCase(ApproveCaseCommand command)
```

---

## 29. Key Takeaways

1. DOM is a **mutable ordered tree**, not a map and not a typed domain model.
2. `Document` is the owner boundary and node factory.
3. `Node` is the root abstraction; always respect node types.
4. `Element` is common, but not every child is an element.
5. Attributes are not normal child nodes.
6. Whitespace can be text data.
7. `NodeList` may be live, so mutation during iteration must be deliberate.
8. Existing nodes are moved, not copied, when appended elsewhere.
9. Cross-document movement requires `importNode` or `adoptNode`.
10. Namespace-aware code should compare namespace URI + local name, not prefix.
11. `getTextContent()` is convenient but can hide nested structure.
12. DOM should usually remain near integration boundaries and be converted to typed models early.
13. DOM has high memory cost for large XML.
14. Secure XML parsing is mandatory for untrusted input and will be covered deeply in Part 30.

---

## 30. Closing Mental Model

The simplest durable model:

```text
DOM = mutable XML tree with identity, ownership, order, node types, and namespace-aware names.
```

Do not think:

```text
DOM = easy XML map
```

Think:

```text
DOM = low-level structural representation
       that must be wrapped with extraction invariants,
       parser hardening,
       namespace discipline,
       memory controls,
       and clear ownership boundaries.
```

This is the mindset that separates casual XML handling from production-grade XML processing.

---

## 31. Status Seri

Part ini adalah **Part 24 dari 32**.

Seri belum selesai.

Part berikutnya:

```text
Part 25 — DOM Creation, Mutation, Import, Adopt, Clone, Normalize
File: 25-dom-creation-mutation-import-adopt-clone-normalize.md
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 23 — `ClassValue`, `Cleaner`, Runtime-Attached Metadata, and Resource Cleanup](./23-classvalue-cleaner-runtime-attached-metadata-resource-cleanup.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 25 — DOM Creation, Mutation, Import, Adopt, Clone, Normalize](./25-dom-creation-mutation-import-adopt-clone-normalize.md)
