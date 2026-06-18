# Part 25 — DOM Creation, Mutation, Import, Adopt, Clone, Normalize

> Series: `learn-java-lang-dom-sax-core-runtime-platform-contracts`  
> File: `25-dom-creation-mutation-import-adopt-clone-normalize.md`  
> Scope: Java 8–25, `java.xml`, `org.w3c.dom.*`  
> Prerequisite: Part 24 — DOM Mental Model: Document as Mutable Tree, Node Identity, Ownership

---

## 1. Tujuan Part Ini

Part sebelumnya membangun mental model DOM sebagai **mutable in-memory tree**. Part ini masuk ke operasi yang membuat DOM berguna sekaligus berbahaya:

1. membuat dokumen XML baru;
2. membuat element, attribute, text, comment, CDATA, processing instruction;
3. memodifikasi tree dengan `appendChild`, `insertBefore`, `replaceChild`, dan `removeChild`;
4. memahami ownership node melalui `ownerDocument`;
5. memindahkan node antar document dengan `importNode` dan `adoptNode`;
6. memahami `cloneNode` shallow/deep;
7. memahami `normalize()` dan `normalizeDocument()`;
8. membangun XML secara programmatic tanpa namespace bug, invalid character bug, mutation bug, dan serialization surprise.

Inti part ini: **DOM creation/mutation bukan operasi string building. DOM adalah operasi terhadap graph/tree object yang punya owner, parent, namespace, order, dan validity constraints.**

---

## 2. Mental Model Utama

### 2.1 DOM bukan text XML

Ketika kamu menulis:

```java
Element user = document.createElement("user");
user.setAttribute("id", "123");
user.appendChild(document.createTextNode("Fajar"));
```

kamu belum membuat text XML seperti:

```xml
<user id="123">Fajar</user>
```

Yang kamu buat adalah **object tree**:

```text
Document
└── Element(user)
    ├── Attr(id = "123")
    └── Text("Fajar")
```

Baru ketika tree diserialisasi, implementasi DOM/XML serializer mengubah tree itu menjadi lexical XML.

Konsekuensi penting:

- DOM API bisa menerima data yang nanti gagal saat serialization.
- Text node tidak otomatis tahu apakah isinya aman secara lexical.
- Comment bisa berisi data yang illegal untuk XML comment.
- Namespace harus dimodelkan sebagai URI/local name, bukan cuma prefix string.
- Node punya identity dan ownership, bukan hanya potongan teks.

---

### 2.2 Document adalah factory dan ownership boundary

Dalam DOM, `Document` bukan hanya root. `Document` adalah **factory context**.

Object seperti `Element`, `Text`, `Comment`, `CDATASection`, dan `ProcessingInstruction` tidak boleh dianggap berdiri bebas. Mereka dibuat dalam konteks `Document` tertentu.

```java
Document doc = newDocument();
Element root = doc.createElement("root");
Text text = doc.createTextNode("hello");
```

Setelah dibuat:

```java
root.getOwnerDocument() == doc // true
text.getOwnerDocument() == doc // true
```

Mental model:

```text
Document A owns nodes created by Document A.
Document B owns nodes created by Document B.
Node from A cannot simply be appended into B without import/adopt.
```

Kesalahan umum:

```java
Document a = newDocument();
Document b = newDocument();

Element fromA = a.createElement("item");
b.appendChild(fromA); // WRONG_DOCUMENT_ERR in conforming DOM implementations
```

Solusinya:

```java
Node imported = b.importNode(fromA, true);
b.appendChild(imported);
```

atau:

```java
Node adopted = b.adoptNode(fromA);
b.appendChild(adopted);
```

`importNode` membuat copy. `adoptNode` mencoba memindahkan ownership node asli.

---

### 2.3 DOM mutation adalah operasi tree, bukan operasi list biasa

Ketika kamu memanggil:

```java
parent.appendChild(child);
```

DOM tidak hanya “menambahkan child”. Ia juga memastikan:

- child dilepas dari parent lama jika sudah punya parent;
- parent pointer berubah;
- sibling relationship berubah;
- owner document harus kompatibel;
- node type harus valid untuk posisi itu;
- beberapa operasi bisa melempar `DOMException`.

Contoh penting:

```java
Element a = doc.createElement("a");
Element b = doc.createElement("b");
Element child = doc.createElement("child");

a.appendChild(child);
b.appendChild(child);
```

Setelah kode ini:

```text
a no longer has child
b has child
```

DOM node tidak bisa punya dua parent. `appendChild` pada node yang sudah punya parent adalah **move**, bukan copy.

Kalau butuh copy:

```java
b.appendChild(child.cloneNode(true));
```

---

## 3. Konsep Fundamental

### 3.1 Membuat `Document`

Biasanya DOM document dibuat lewat JAXP:

```java
import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import org.w3c.dom.Document;

public final class DomDocuments {
    public static Document newDocument() throws Exception {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setNamespaceAware(true);

        DocumentBuilder builder = factory.newDocumentBuilder();
        return builder.newDocument();
    }
}
```

Untuk part ini, security parsing belum menjadi fokus utama karena dokumen dibuat dari nol. Namun tetap biasakan `setNamespaceAware(true)` agar desain kamu tidak berubah ketika XML mulai memakai namespace.

Jika kamu parsing input dari luar, jangan gunakan factory polos seperti ini tanpa hardening. Secure parsing dibahas khusus di Part 30.

---

### 3.2 Membuat root element

DOM document XML normal hanya punya satu document element.

```java
Document doc = newDocument();
Element root = doc.createElement("case");
doc.appendChild(root);
```

Setelah itu:

```java
root == doc.getDocumentElement(); // true
```

Jika kamu mencoba append root kedua:

```java
Element anotherRoot = doc.createElement("another");
doc.appendChild(anotherRoot); // HIERARCHY_REQUEST_ERR
```

Model:

```text
Document
├── optional XML declaration/doctype/PI/comment depending implementation/serialization
└── exactly one document element for normal XML document
```

DOM bisa menyimpan comment atau processing instruction di level document, tetapi XML document tetap harus punya satu root element.

---

### 3.3 `createElement` vs `createElementNS`

Ini salah satu bagian paling penting.

#### Non-namespace-aware element

```java
Element e = doc.createElement("order");
```

Ini membuat element dengan qualified name `order` tanpa namespace URI.

#### Namespace-aware element

```java
String ns = "https://example.com/schema/order";
Element e = doc.createElementNS(ns, "ord:order");
```

Element ini punya:

```text
namespaceURI = "https://example.com/schema/order"
prefix       = "ord"
localName   = "order"
nodeName    = "ord:order"
```

Yang penting: **namespace identity adalah URI, bukan prefix.** Prefix hanya lexical alias saat serialization/parsing.

Dua element berikut secara namespace identity sama:

```xml
<ord:order xmlns:ord="https://example.com/schema/order" />
<x:order   xmlns:x="https://example.com/schema/order" />
```

DOM-aware logic harus berpikir:

```java
node.getNamespaceURI().equals("https://example.com/schema/order")
node.getLocalName().equals("order")
```

bukan:

```java
node.getNodeName().equals("ord:order")
```

---

### 3.4 Membuat attribute

Ada dua cara umum.

#### Simple attribute

```java
Element user = doc.createElement("user");
user.setAttribute("id", "123");
```

#### Namespace-aware attribute

```java
user.setAttributeNS(
    "https://example.com/schema/security",
    "sec:classification",
    "restricted"
);
```

Untuk namespace declaration, DOM juga memakai attribute namespace-aware:

```java
root.setAttributeNS(
    "http://www.w3.org/2000/xmlns/",
    "xmlns:ord",
    "https://example.com/schema/order"
);
```

Namun dalam banyak serializer, namespace declaration bisa dihasilkan dari prefix/namespace node ketika dibutuhkan. Tetapi untuk output yang deterministik, explicit namespace declaration sering lebih aman.

---

### 3.5 Text node bukan escaped string

```java
Element name = doc.createElement("name");
name.appendChild(doc.createTextNode("A < B & C"));
```

Text node menyimpan karakter literal:

```text
A < B & C
```

Saat diserialisasi, serializer harus mengescape menjadi kira-kira:

```xml
<name>A &lt; B &amp; C</name>
```

Jangan manual escape sebelum masuk DOM:

```java
// Wrong: double escaping risk
name.appendChild(doc.createTextNode("A &lt; B &amp; C"));
```

Hasil serialization bisa menjadi:

```xml
<name>A &amp;lt; B &amp;amp; C</name>
```

Invariant:

> DOM text node berisi data karakter. XML escaping adalah tanggung jawab serializer, bukan tanggung jawab caller yang membuat `Text`.

---

### 3.6 Comment dan CDATA punya constraint lexical

DOM bisa membiarkan kamu membuat content tertentu yang nanti invalid saat serialization.

```java
Comment c = doc.createComment("bad -- comment");
root.appendChild(c);
```

Dalam XML, sequence `--` tidak valid di dalam comment. Beberapa DOM implementation mungkin tidak memvalidasi saat node dibuat, tetapi serializer dapat gagal.

CDATA juga punya jebakan:

```java
CDATASection cdata = doc.createCDATASection("some ]]> text");
```

Sequence `]]>` tidak boleh muncul di dalam CDATA section karena itu terminator CDATA.

Rule production:

- gunakan `Text` untuk data biasa;
- gunakan CDATA hanya jika format output memang perlu CDATA;
- jangan memakai comment untuk menyimpan data penting;
- validasi content comment/CDATA sebelum serialization jika output harus guaranteed valid.

---

## 4. API dan Contract yang Perlu Dipahami

### 4.1 Factory methods pada `Document`

API utama:

```java
Element createElement(String tagName)
Element createElementNS(String namespaceURI, String qualifiedName)
Text createTextNode(String data)
Comment createComment(String data)
CDATASection createCDATASection(String data)
ProcessingInstruction createProcessingInstruction(String target, String data)
Attr createAttribute(String name)
Attr createAttributeNS(String namespaceURI, String qualifiedName)
DocumentFragment createDocumentFragment()
EntityReference createEntityReference(String name)
```

Mental model:

```text
Document is the factory for nodes it owns.
```

Factory methods tidak otomatis memasukkan node ke tree. Setelah create, kamu harus attach:

```java
Element item = doc.createElement("item");
// item is detached
root.appendChild(item);
// item is attached
```

---

### 4.2 Core mutation methods pada `Node`

API utama:

```java
Node appendChild(Node newChild)
Node insertBefore(Node newChild, Node refChild)
Node replaceChild(Node newChild, Node oldChild)
Node removeChild(Node oldChild)
```

Contract yang sering dilupakan:

- return value biasanya node yang dimasukkan/dihapus/diganti;
- `newChild` yang sudah punya parent akan dipindahkan;
- `refChild`/`oldChild` harus child dari parent yang dipanggil;
- child type harus valid;
- owner document harus sama, kecuali node diimport/adopt dulu;
- DOMException adalah bagian dari kontrak normal API.

---

### 4.3 `appendChild`

```java
Element root = doc.createElement("root");
doc.appendChild(root);

Element item = doc.createElement("item");
root.appendChild(item);
```

Tree:

```text
Document
└── root
    └── item
```

Jika item sudah punya parent:

```java
Element a = doc.createElement("a");
Element b = doc.createElement("b");
Element item = doc.createElement("item");

a.appendChild(item);
b.appendChild(item);
```

Final tree:

```text
a

b
└── item
```

Ini penting saat kamu ingin menambahkan node template ke banyak parent. Jangan pakai node yang sama; clone atau create baru.

---

### 4.4 `insertBefore`

```java
Node inserted = parent.insertBefore(newChild, referenceChild);
```

Jika `referenceChild` adalah child valid dari parent, `newChild` diletakkan sebelum reference.

Jika `referenceChild == null`, banyak implementasi memperlakukan sebagai append di akhir sesuai DOM contract.

Contoh:

```java
Element a = doc.createElement("a");
Element b = doc.createElement("b");
Element c = doc.createElement("c");

root.appendChild(a);
root.appendChild(c);
root.insertBefore(b, c);
```

Tree:

```text
root
├── a
├── b
└── c
```

Kesalahan umum:

```java
root.insertBefore(b, someNodeFromAnotherParent); // NOT_FOUND_ERR
```

---

### 4.5 `replaceChild`

```java
Node removed = parent.replaceChild(newChild, oldChild);
```

`oldChild` harus child langsung dari parent. Setelah operasi:

- `newChild` berada di posisi `oldChild`;
- `oldChild` menjadi detached;
- return value adalah `oldChild`.

Contoh:

```java
Element oldStatus = findRequiredChild(root, "status");
Element newStatus = doc.createElement("status");
newStatus.setTextContent("APPROVED");

root.replaceChild(newStatus, oldStatus);
```

Jika `newChild` sudah punya parent, ia dipindah dulu.

---

### 4.6 `removeChild`

```java
Node removed = parent.removeChild(child);
```

Setelah remove:

```java
removed.getParentNode() == null
```

Tetapi node masih hidup sebagai object Java dan masih punya `ownerDocument`.

```java
Element item = doc.createElement("item");
root.appendChild(item);
root.removeChild(item);

item.getOwnerDocument() == doc; // true
item.getParentNode() == null;   // true
```

Detached node bisa dipasang lagi ke document yang sama:

```java
root.appendChild(item);
```

---

### 4.7 `DocumentFragment`

`DocumentFragment` adalah container ringan untuk menyusun banyak node sebelum dimasukkan ke tree.

```java
DocumentFragment fragment = doc.createDocumentFragment();

for (String value : List.of("A", "B", "C")) {
    Element item = doc.createElement("item");
    item.setTextContent(value);
    fragment.appendChild(item);
}

root.appendChild(fragment);
```

Ketika fragment diappend, children-nya dipindahkan ke parent. Fragment itu sendiri tidak menjadi node dalam output tree.

Hasil:

```xml
<root>
  <item>A</item>
  <item>B</item>
  <item>C</item>
</root>
```

Mental model:

```text
DocumentFragment = staging area for children
```

Kegunaan:

- batch construction;
- mengurangi mutation langsung pada tree utama;
- menyusun subtree dari helper method;
- meningkatkan readability.

---

## 5. Evolusi Java 8–25

DOM API di `org.w3c.dom` sangat stabil sejak lama. Dari Java 8 sampai Java 25, konsep core seperti `Document`, `Node`, `Element`, `Attr`, `Text`, `cloneNode`, `importNode`, `adoptNode`, `normalize`, dan `normalizeDocument` tidak berubah secara dramatis.

Yang berubah di sekitar DOM adalah konteks platform:

1. **Module system sejak Java 9**  
   DOM berada di module `java.xml`. Jika aplikasi modular, module kamu perlu membaca `java.xml`.

   ```java
   module com.example.xml {
       requires java.xml;
   }
   ```

2. **Security Manager deprecation/disable trajectory**  
   Jangan desain XML hardening dengan asumsi Security Manager akan melindungi file/network access. XML parser harus dikonfigurasi secara eksplisit. Ini akan dibahas di Part 30.

3. **Default charset berubah menjadi UTF-8 sejak Java 18**  
   Ini relevan saat serialization/parsing lewat stream/writer. DOM object sendiri tidak bergantung pada charset, tetapi input/output XML iya.

4. **JAXP implementation details dapat berbeda**  
   DOM adalah interface. Behavior detail bisa dipengaruhi implementation, parser factory, serializer, feature support, dan configuration.

Prinsip Java 8–25:

> Treat DOM API as stable contracts, but treat parser/serializer behavior, factory configuration, validation, security, and encoding as explicit production decisions.

---

## 6. Contoh Kode Bertahap

### 6.1 Helper: membuat Document namespace-aware

```java
import org.w3c.dom.Document;

import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;

public final class DomFactory {
    private DomFactory() {}

    public static Document newDocument() {
        try {
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            factory.setNamespaceAware(true);

            DocumentBuilder builder = factory.newDocumentBuilder();
            return builder.newDocument();
        } catch (Exception e) {
            throw new IllegalStateException("Failed to create DOM Document", e);
        }
    }
}
```

Catatan: helper ini untuk creating document, bukan parsing untrusted XML. Untuk parsing untrusted XML, factory harus di-harden.

---

### 6.2 Membuat XML sederhana

Target XML:

```xml
<case id="CASE-001">
  <status>OPEN</status>
  <priority>HIGH</priority>
</case>
```

Kode:

```java
Document doc = DomFactory.newDocument();

Element root = doc.createElement("case");
root.setAttribute("id", "CASE-001");
doc.appendChild(root);

Element status = doc.createElement("status");
status.appendChild(doc.createTextNode("OPEN"));
root.appendChild(status);

Element priority = doc.createElement("priority");
priority.appendChild(doc.createTextNode("HIGH"));
root.appendChild(priority);
```

Bisa juga pakai `setTextContent`:

```java
Element status = doc.createElement("status");
status.setTextContent("OPEN");
root.appendChild(status);
```

Namun hati-hati: `setTextContent` mengganti semua child text/element di bawah node tersebut.

---

### 6.3 Helper kecil untuk element text

```java
public static Element elementWithText(Document doc, String name, String text) {
    Element element = doc.createElement(name);
    element.appendChild(doc.createTextNode(text));
    return element;
}
```

Pemakaian:

```java
root.appendChild(elementWithText(doc, "status", "OPEN"));
root.appendChild(elementWithText(doc, "priority", "HIGH"));
```

Lebih aman daripada string concatenation:

```java
// Avoid
String xml = "<status>" + status + "</status>";
```

Jika `status` berisi `A&B`, DOM serializer akan mengescape. String concatenation manual rawan invalid XML atau injection.

---

### 6.4 Membuat XML namespace-aware

Target:

```xml
<ord:order xmlns:ord="https://example.com/order" id="ORD-001">
  <ord:status>NEW</ord:status>
</ord:order>
```

Kode:

```java
String ORDER_NS = "https://example.com/order";

Document doc = DomFactory.newDocument();

Element order = doc.createElementNS(ORDER_NS, "ord:order");
order.setAttribute("id", "ORD-001");
order.setAttributeNS("http://www.w3.org/2000/xmlns/", "xmlns:ord", ORDER_NS);
doc.appendChild(order);

Element status = doc.createElementNS(ORDER_NS, "ord:status");
status.setTextContent("NEW");
order.appendChild(status);
```

Query/extraction kelak harus memakai namespace URI:

```java
boolean isStatus = ORDER_NS.equals(status.getNamespaceURI())
        && "status".equals(status.getLocalName());
```

Bukan:

```java
status.getNodeName().equals("ord:status")
```

---

### 6.5 Mutation: mengganti status

```java
public static void replaceFirstChildElement(
        Document doc,
        Element parent,
        String childName,
        String newText
) {
    for (Node n = parent.getFirstChild(); n != null; n = n.getNextSibling()) {
        if (n.getNodeType() == Node.ELEMENT_NODE && childName.equals(n.getNodeName())) {
            Element replacement = doc.createElement(childName);
            replacement.setTextContent(newText);
            parent.replaceChild(replacement, n);
            return;
        }
    }
    throw new IllegalArgumentException("Missing child element: " + childName);
}
```

Usage:

```java
replaceFirstChildElement(doc, root, "status", "APPROVED");
```

Production improvement:

- namespace-aware matching;
- clear error including document/case context;
- avoid `getElementsByTagName` if you need direct child only;
- avoid modifying live `NodeList` while iterating by index without care.

---

### 6.6 Moving node within same document

```java
Element source = doc.createElement("source");
Element target = doc.createElement("target");
Element item = doc.createElement("item");

source.appendChild(item);
target.appendChild(item); // moves item from source to target
```

In DOM:

```text
A node can have at most one parent.
Appending an attached node moves it.
```

Kalau ingin copy:

```java
target.appendChild(item.cloneNode(true));
```

---

### 6.7 Importing node from another document

```java
Document sourceDoc = DomFactory.newDocument();
Element sourceItem = sourceDoc.createElement("item");
sourceItem.setTextContent("from source");
sourceDoc.appendChild(sourceItem);

Document targetDoc = DomFactory.newDocument();
Element targetRoot = targetDoc.createElement("items");
targetDoc.appendChild(targetRoot);

Node imported = targetDoc.importNode(sourceItem, true);
targetRoot.appendChild(imported);
```

Important:

- `importNode` creates a copy;
- source node remains in source document;
- imported node belongs to target document;
- deep flag controls descendants.

```java
sourceItem.getOwnerDocument() == sourceDoc; // true
imported.getOwnerDocument() == targetDoc;   // true
sourceItem == imported;                     // false
```

---

### 6.8 Adopting node from another document

```java
Node adopted = targetDoc.adoptNode(sourceItem);
targetRoot.appendChild(adopted);
```

Important:

- `adoptNode` attempts to transfer node ownership;
- node is removed from old document context;
- implementation may return `null` if adoption is unsupported for that node type;
- user data handlers may be invoked depending node metadata;
- not all node types behave equally.

Safer production pattern:

```java
Node moved = targetDoc.adoptNode(sourceItem);
if (moved == null) {
    moved = targetDoc.importNode(sourceItem, true);
}
targetRoot.appendChild(moved);
```

Use `importNode` when you want copy semantics. Use `adoptNode` only when move semantics are intentional.

---

### 6.9 Cloning nodes

```java
Element item = doc.createElement("item");
item.setAttribute("id", "1");
item.appendChild(doc.createElement("name"));

Node shallow = item.cloneNode(false);
Node deep = item.cloneNode(true);
```

Shallow clone:

```text
item clone
- same element name
- attributes copied
- child nodes not copied
```

Deep clone:

```text
item clone
- same element name
- attributes copied
- descendants copied recursively
```

Caveat:

- cloned node has no parent;
- clone belongs to same owner document;
- user data may not be copied the way you expect;
- IDs and unique attributes may be duplicated semantically;
- clone is structural copy, not domain-aware copy.

Example bug:

```java
Element template = doc.createElement("item");
template.setAttribute("id", "TEMPLATE");

Element a = (Element) template.cloneNode(true);
Element b = (Element) template.cloneNode(true);

root.appendChild(a);
root.appendChild(b);
```

Now both have `id="TEMPLATE"`. XML may be well-formed but semantically invalid.

---

### 6.10 Normalizing text nodes

```java
Element e = doc.createElement("message");
e.appendChild(doc.createTextNode("Hello"));
e.appendChild(doc.createTextNode(" "));
e.appendChild(doc.createTextNode("World"));

System.out.println(e.getChildNodes().getLength()); // 3

e.normalize();

System.out.println(e.getChildNodes().getLength()); // usually 1
System.out.println(e.getTextContent());            // Hello World
```

`normalize()` merges adjacent text nodes and removes empty ones in the subtree.

Use cases:

- after programmatic mutation;
- before comparison/testing;
- before extraction where adjacent text fragmentation is irrelevant;
- after building DOM fragments from multiple sources.

Do not use normalize as magical validation. It does not fix namespace errors, schema errors, invalid comment text, or business invariants.

---

### 6.11 `normalizeDocument()`

`Document.normalizeDocument()` is DOM Level 3 behavior controlled by `DOMConfiguration`.

Example:

```java
DOMConfiguration config = doc.getDomConfig();

if (config.canSetParameter("comments", Boolean.FALSE)) {
    config.setParameter("comments", Boolean.FALSE);
}

if (config.canSetParameter("cdata-sections", Boolean.FALSE)) {
    config.setParameter("cdata-sections", Boolean.FALSE);
}

doc.normalizeDocument();
```

Important:

- supported parameters can vary;
- always check `canSetParameter`;
- may affect CDATA, comments, validation, namespace handling depending implementation;
- can raise/report DOM errors depending configuration;
- not equivalent to `Node.normalize()`.

Mental model:

```text
node.normalize() = normalize adjacent text nodes in subtree

document.normalizeDocument() = DOM Level 3 document-wide normalization according to DOMConfiguration
```

---

## 7. Design Patterns / Usage Patterns

### 7.1 Builder helper pattern

DOM code becomes noisy quickly. Use small helper methods, but do not hide DOM semantics too much.

```java
public final class XmlBuild {
    private final Document doc;

    public XmlBuild(Document doc) {
        this.doc = Objects.requireNonNull(doc);
    }

    public Element element(String name) {
        return doc.createElement(name);
    }

    public Element textElement(String name, String text) {
        Element e = doc.createElement(name);
        e.appendChild(doc.createTextNode(text == null ? "" : text));
        return e;
    }

    public Element nsElement(String ns, String qName) {
        return doc.createElementNS(ns, qName);
    }
}
```

Usage:

```java
Document doc = DomFactory.newDocument();
XmlBuild xml = new XmlBuild(doc);

Element root = xml.element("case");
doc.appendChild(root);
root.appendChild(xml.textElement("status", "OPEN"));
```

Trade-off:

- Pros: less repetitive, fewer mistakes.
- Cons: helper can obscure namespace and ownership if too magical.

Keep helper thin and explicit.

---

### 7.2 Template clone pattern

Useful when output has repeated subtree structure.

```java
Element template = doc.createElement("line");
template.appendChild(doc.createElement("code"));
template.appendChild(doc.createElement("value"));

for (String value : values) {
    Element line = (Element) template.cloneNode(true);
    setDirectChildText(line, "code", "X");
    setDirectChildText(line, "value", value);
    root.appendChild(line);
}
```

Warning:

- remove placeholder IDs;
- reset attributes;
- ensure deep clone if descendants needed;
- do not clone event/user data assumptions;
- do not use template clone for complex domain transformation without tests.

---

### 7.3 DocumentFragment assembly pattern

```java
public static DocumentFragment buildItems(Document doc, List<String> values) {
    DocumentFragment fragment = doc.createDocumentFragment();
    for (String value : values) {
        Element item = doc.createElement("item");
        item.setTextContent(value);
        fragment.appendChild(item);
    }
    return fragment;
}
```

Usage:

```java
root.appendChild(buildItems(doc, values));
```

This keeps helper methods composable without returning fake wrapper elements.

---

### 7.4 Import as anti-corruption boundary

When receiving a DOM subtree from another module/library, do not attach it directly.

```java
public static Element attachExternalSubtree(
        Document targetDoc,
        Element targetParent,
        Element external
) {
    Node imported = targetDoc.importNode(external, true);
    targetParent.appendChild(imported);
    return (Element) imported;
}
```

This makes ownership explicit.

Good for:

- combining XML from multiple sources;
- integrating vendor-specific DOM output;
- building envelope + payload;
- copying template document into output document.

---

### 7.5 Namespace constants pattern

Avoid scattering namespace strings and prefixes.

```java
public final class OrderXml {
    private OrderXml() {}

    public static final String NS = "https://example.com/order";
    public static final String PREFIX = "ord";

    public static Element create(Document doc, String localName) {
        return doc.createElementNS(NS, PREFIX + ":" + localName);
    }
}
```

Usage:

```java
Element order = OrderXml.create(doc, "order");
order.setAttributeNS("http://www.w3.org/2000/xmlns/", "xmlns:" + OrderXml.PREFIX, OrderXml.NS);
```

Caveat: prefix is output convention. Namespace identity is still URI.

---

## 8. Failure Modes

### 8.1 Creating namespaced XML with `createElement`

Bad:

```java
Element e = doc.createElement("ord:order");
```

This creates a node whose name contains a colon, but namespace metadata may not be correct.

Good:

```java
Element e = doc.createElementNS(OrderXml.NS, "ord:order");
```

Impact:

- XPath namespace queries fail;
- schema validation fails;
- downstream parser sees wrong namespace;
- `getNamespaceURI()` returns null;
- bug may only appear in integration environment.

---

### 8.2 Moving a node when you intended copying

Bad:

```java
for (Element parent : parents) {
    parent.appendChild(sharedItem);
}
```

Final result: only last parent contains `sharedItem`.

Good:

```java
for (Element parent : parents) {
    parent.appendChild(sharedItem.cloneNode(true));
}
```

---

### 8.3 Appending node from another document

Bad:

```java
targetRoot.appendChild(sourceElement);
```

Good:

```java
targetRoot.appendChild(targetDoc.importNode(sourceElement, true));
```

---

### 8.4 Double escaping text

Bad:

```java
e.setTextContent("A &lt; B &amp; C");
```

Good:

```java
e.setTextContent("A < B & C");
```

Let serializer escape.

---

### 8.5 Using `setTextContent` on element with children

Before:

```xml
<case>
  <status>OPEN</status>
  <owner>Fajar</owner>
</case>
```

Code:

```java
caseElement.setTextContent("closed");
```

After:

```xml
<case>closed</case>
```

All child elements are gone.

Rule:

> Use `setTextContent` only when you deliberately want to replace all descendant content with a single text value.

---

### 8.6 Ignoring live `NodeList` during mutation

Bad:

```java
NodeList items = root.getElementsByTagName("item");
for (int i = 0; i < items.getLength(); i++) {
    root.removeChild(items.item(i));
}
```

Because `NodeList` can be live, length and indexes may change during mutation.

Safer:

```java
List<Node> toRemove = new ArrayList<>();
NodeList items = root.getElementsByTagName("item");
for (int i = 0; i < items.getLength(); i++) {
    toRemove.add(items.item(i));
}
for (Node n : toRemove) {
    n.getParentNode().removeChild(n);
}
```

---

### 8.7 Invalid comment/CDATA content

Bad:

```java
doc.createComment("generated -- do not edit");
doc.createCDATASection("value ]]> end");
```

Possible result:

- serialization failure;
- invalid XML output;
- downstream parse failure.

Safer:

- avoid comments for dynamic untrusted data;
- prefer text nodes;
- split CDATA carefully if absolutely required;
- validate before serialization.

---

### 8.8 Treating `normalize()` as validation

Bad assumption:

```java
doc.normalizeDocument(); // now XML is valid and safe
```

Wrong. Normalization is not a security or business validation layer.

It does not guarantee:

- schema validity;
- safe parser configuration;
- namespace correctness;
- no duplicate business IDs;
- no invalid domain state;
- no XXE from earlier parsing.

---

## 9. Performance, Memory, Security Considerations

### 9.1 Performance

DOM mutation is object-heavy. Each element/text/attribute/comment is object state.

Cost factors:

- number of nodes;
- depth of tree;
- live `NodeList` traversal;
- repeated `getElementsByTagName` scans;
- cloning large subtrees;
- importing/adopting large subtrees;
- normalization over large documents;
- serialization cost.

Avoid patterns like:

```java
for (int i = 0; i < 100_000; i++) {
    NodeList nodes = root.getElementsByTagName("item");
    // repeated full scan
}
```

Prefer:

- single traversal;
- local references;
- domain data first, DOM at output boundary;
- SAX/StAX for very large documents;
- DocumentFragment for staging;
- clear size limits.

---

### 9.2 Memory

DOM loads/builds entire tree in memory.

Approximate mental model:

```text
XML text size < parsed DOM object graph size
```

A 10 MB XML file can become much larger as DOM due to:

- object overhead;
- parent/sibling references;
- node lists/maps;
- strings;
- attributes;
- whitespace text nodes;
- implementation-specific metadata.

Guideline:

- DOM is good for small/medium documents requiring random access and mutation.
- SAX/StAX is better for large sequential processing.
- Do not build massive export files in DOM if streaming is possible.

---

### 9.3 Security

For document creation, main security risks are:

- XML injection through manual string building;
- invalid output through comments/CDATA;
- leaking secrets in generated XML;
- namespace spoofing/confusion;
- unbounded memory when building from untrusted collections;
- unsafe serialization target/path.

DOM helps prevent text escaping bugs if used correctly:

```java
textNode = doc.createTextNode(untrustedValue);
```

DOM does not automatically prevent:

- invalid comments;
- oversized documents;
- semantically dangerous values;
- bad namespace decisions;
- unsafe parsing of external XML.

For parsing untrusted XML, Part 30 will define hardening.

---

## 10. Production Checklist

Before using DOM creation/mutation in production, check:

### Document creation

- [ ] Is `DocumentBuilderFactory` namespace-aware?
- [ ] Is this code creating a new document, not parsing untrusted input?
- [ ] If parsing input, is factory hardened? See Part 30.
- [ ] Is module `java.xml` available/required in modular builds?

### Namespace

- [ ] Are namespaced elements created with `createElementNS`?
- [ ] Are namespaced attributes created with `setAttributeNS` or `createAttributeNS`?
- [ ] Is logic based on namespace URI + local name, not prefix?
- [ ] Are namespace constants centralized?

### Mutation

- [ ] Do you understand whether operation moves or copies node?
- [ ] Are cross-document nodes imported/adopted?
- [ ] Are direct-child vs descendant operations explicit?
- [ ] Are live `NodeList` mutation risks handled?

### Text/content

- [ ] Are text values inserted as text nodes, not manually escaped XML?
- [ ] Is `setTextContent` only used when replacing all descendant content is intended?
- [ ] Are comment/CDATA contents validated or avoided?

### Clone/import/adopt

- [ ] Is `cloneNode(true)` vs `cloneNode(false)` deliberate?
- [ ] Are duplicated IDs/unique attributes handled after clone?
- [ ] Is `importNode` used for copy semantics?
- [ ] Is `adoptNode` used only for intentional move semantics?
- [ ] Is fallback from adopt to import implemented where needed?

### Normalize

- [ ] Is `normalize()` used for text-node cleanup, not validation?
- [ ] Is `normalizeDocument()` guarded with `canSetParameter`?
- [ ] Are DOMConfiguration differences tested across target JDKs/implementations?

### Size/performance

- [ ] Is document size bounded?
- [ ] Are large exports streamed instead of built fully in DOM?
- [ ] Are repeated full-tree scans avoided?
- [ ] Are tests covering large but realistic input/output?

---

## 11. Latihan / Thought Exercise

### Exercise 1 — Predict the tree

What is the final tree?

```java
Element a = doc.createElement("a");
Element b = doc.createElement("b");
Element x = doc.createElement("x");

a.appendChild(x);
b.appendChild(x);
```

Answer:

```text
a

b
└── x
```

`x` moved from `a` to `b`.

---

### Exercise 2 — Find the namespace bug

```java
Element e = doc.createElement("ord:order");
e.setAttribute("xmlns:ord", "https://example.com/order");
```

Problem:

- element was not created namespace-aware;
- `getNamespaceURI()` may be null;
- namespace declaration attribute as plain attribute may not behave as intended.

Better:

```java
Element e = doc.createElementNS("https://example.com/order", "ord:order");
e.setAttributeNS("http://www.w3.org/2000/xmlns/", "xmlns:ord", "https://example.com/order");
```

---

### Exercise 3 — Why does output double escape?

```java
Element name = doc.createElement("name");
name.setTextContent("A &lt; B");
```

Because DOM text should contain raw character data. You inserted already-escaped lexical XML. Serializer escapes `&` again.

Correct:

```java
name.setTextContent("A < B");
```

---

### Exercise 4 — Why did child elements disappear?

```java
Element caseElement = ...;
caseElement.setTextContent("CLOSED");
```

Because `setTextContent` replaces all descendant content with a single text node.

---

### Exercise 5 — Clone vs import

You have template node in same document and want repeated copies. Use:

```java
template.cloneNode(true)
```

You have node from another document and want copy into target document. Use:

```java
targetDoc.importNode(externalNode, true)
```

You want to move node from another document if supported. Use:

```java
targetDoc.adoptNode(externalNode)
```

---

## 12. Ringkasan

DOM creation and mutation is deceptively simple. The dangerous part is not writing `appendChild`; the dangerous part is misunderstanding what that operation means.

Key takeaways:

1. `Document` is both root and factory/ownership context.
2. Nodes created by one document cannot be directly attached to another document.
3. `appendChild` moves an existing node, not copies it.
4. Use `cloneNode` for same-document copy.
5. Use `importNode` for cross-document copy.
6. Use `adoptNode` for cross-document move, with fallback if unsupported.
7. Use `createElementNS`/`setAttributeNS` for namespace-aware XML.
8. Prefix is not namespace identity; namespace URI is.
9. Text nodes contain raw character data, not manually escaped XML.
10. `setTextContent` replaces descendant content.
11. `NodeList` can be live; mutation while iterating must be careful.
12. `normalize()` merges adjacent text nodes; it is not validation.
13. `normalizeDocument()` is DOM Level 3 configuration-driven and implementation-sensitive.
14. DOM is suitable for mutable small/medium XML trees, not unbounded large streaming workloads.

In top-tier engineering, DOM is not treated as “old XML API”. It is treated as a precise tree manipulation contract with explicit ownership, namespace, mutation, normalization, and serialization boundaries.

---

## 13. Apa Berikutnya

Part berikutnya:

```text
26-dom-querying-traversal-namespaces-nodelist-element-apis.md
```

Topik berikutnya akan membahas cara membaca DOM tree secara robust:

- direct child traversal;
- descendant traversal;
- `NodeList` pitfalls;
- `Element` API;
- namespace-aware matching;
- `getAttribute` vs absent attribute;
- default namespace trap;
- robust extraction helpers;
- kapan XPath layak dipakai dan kapan tidak.

---

## References

- Java SE 25 API — `org.w3c.dom.Document`
- Java SE 25 API — `org.w3c.dom.Node`
- Java SE 25 API — `org.w3c.dom.Element`
- Java SE 25 API — `org.w3c.dom.Text`
- Java SE 25 API — `org.w3c.dom.Comment`
- Java SE 25 API — `org.w3c.dom.Attr`
- Java SE 25 API — `org.w3c.dom.DOMConfiguration`
- DOM Level 3 Core Specification

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 24 — DOM Mental Model: Document as Mutable Tree, Node Identity, Ownership](./24-dom-mental-model-document-node-tree-ownership.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 26 — DOM Querying: Traversal, Namespaces, NodeList, Element APIs](./26-dom-querying-traversal-namespaces-nodelist-element-apis.md)

</div>