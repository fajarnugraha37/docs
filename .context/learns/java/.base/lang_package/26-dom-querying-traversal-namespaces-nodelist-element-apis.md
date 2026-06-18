# Part 26 — DOM Querying: Traversal, Namespaces, NodeList, Element APIs

> Series: `learn-java-lang-dom-sax-core-runtime-platform-contracts`  
> File: `26-dom-querying-traversal-namespaces-nodelist-element-apis.md`  
> Scope: Java 8–25, `org.w3c.dom.*`, DOM querying, traversal, namespace-aware extraction, robust XML reading patterns

---

## 1. Tujuan Part Ini

Pada part sebelumnya kita membahas DOM sebagai **mutable in-memory tree**: `Document`, `Node`, `Element`, ownership, mutation, clone/import/adopt, dan normalization. Sekarang kita masuk ke sisi yang paling sering dipakai di aplikasi nyata: **membaca dan mencari data dari DOM**.

Di permukaan, DOM querying tampak sederhana:

```java
NodeList users = document.getElementsByTagName("user");
String id = ((Element) users.item(0)).getAttribute("id");
```

Namun di sistem production, pola seperti itu sering menjadi sumber bug karena beberapa asumsi tersembunyi:

1. `getElementsByTagName` mencari **descendant**, bukan hanya direct child.
2. `NodeList` di DOM adalah **live collection**, bukan snapshot immutable.
3. namespace XML tidak sama dengan prefix teks.
4. default namespace sering membuat query non-namespace-aware gagal.
5. `getAttribute` mengembalikan empty string baik untuk attribute absent maupun attribute bernilai empty string.
6. whitespace, comment, CDATA, processing instruction, dan text node ikut hidup di tree.
7. DOM tidak memberi typed domain model; semua ekstraksi adalah interpretasi aplikasi.

Tujuan part ini adalah membangun mental model dan skill querying DOM yang benar, aman, dan tidak rapuh.

Setelah menyelesaikan part ini, kamu diharapkan mampu:

- membaca DOM tree secara eksplisit dan predictable;
- membedakan traversal langsung vs recursive vs global query;
- memahami kapan memakai `getElementsByTagName`, `getElementsByTagNameNS`, manual traversal, atau XPath boundary;
- menulis helper extraction yang robust terhadap whitespace, namespace, missing node, duplicated node, dan struktur tidak valid;
- memahami `NodeList` live behavior dan konsekuensi mutation saat iterasi;
- membuat contract parsing XML yang cocok untuk sistem production/regulatory: jelas, defensible, observable, dan fail-fast.

---

## 2. Mental Model Utama

### 2.1 DOM Querying adalah Navigasi Tree, Bukan Query Database

DOM tree bukan database index. Method seperti `getElementsByTagName` tidak berarti “query engine” dalam pengertian SQL. Secara mental, DOM querying adalah operasi traversal pada tree:

```text
Document
└── root Element
    ├── child Element
    │   ├── Text
    │   └── child Element
    ├── Comment
    └── child Element
```

Saat kamu meminta element tertentu, implementasi DOM biasanya perlu menelusuri struktur tree. DOM API tidak menjanjikan indexing, query optimizer, typed path, atau schema-aware result, kecuali implementasi tertentu menambahkan optimisasi internal.

Implikasi desain:

- DOM cocok untuk dokumen kecil/sedang yang perlu random access;
- untuk file besar dan sequential extraction, SAX/StAX lebih cocok;
- untuk query kompleks berulang, pertimbangkan membuat intermediate model atau indexing sendiri;
- untuk dokumen bisnis/regulatory, jangan hanya “ambil tag pertama”; validasi struktur dan cardinality.

---

### 2.2 DOM Querying Harus Dibaca dalam 4 Dimensi

Setiap operasi query DOM perlu dipahami dari empat dimensi:

```text
1. Scope
   Apakah mencari hanya direct child, semua descendant, seluruh document, atau subtree tertentu?

2. Name model
   Apakah memakai qualified name, local name, namespace URI, atau prefix?

3. Cardinality
   Apakah expected 0..1, exactly 1, 0..n, atau exactly n?

4. Node kind
   Apakah hanya Element, atau Text, Comment, CDATA, ProcessingInstruction juga relevan?
```

Contoh kesalahan umum:

```java
Element applicant = (Element) root.getElementsByTagName("applicant").item(0);
```

Kode ini tidak menjelaskan:

- apakah `applicant` harus direct child dari root atau boleh nested di mana saja;
- apakah namespace harus diperhatikan;
- apa yang terjadi jika tidak ada;
- apa yang terjadi jika lebih dari satu;
- apakah tag `applicant` dari namespace lain boleh dianggap sama.

Kode production yang baik membuat keputusan tersebut eksplisit.

---

### 2.3 XML Namespace: URI adalah Identitas, Prefix Hanya Alias

Ini salah satu mental model paling penting.

Dalam XML namespace, identitas nama element/attribute bukan sekadar string tag. Nama namespace-aware terdiri dari:

```text
namespace URI + local name
```

Prefix hanyalah alias lexical di dokumen.

Dua XML berikut secara namespace-aware sama:

```xml
<a:case xmlns:a="urn:example:case">
  <a:id>C-001</a:id>
</a:case>
```

```xml
<x:case xmlns:x="urn:example:case">
  <x:id>C-001</x:id>
</x:case>
```

Yang berbeda hanya prefix `a` vs `x`. Identitas element tetap:

```text
namespaceURI = urn:example:case
localName    = case / id
```

Maka, production DOM extraction sebaiknya menghindari logika berbasis prefix.

Buruk:

```java
if (node.getNodeName().equals("a:case")) { ... }
```

Lebih benar:

```java
if ("urn:example:case".equals(node.getNamespaceURI())
        && "case".equals(node.getLocalName())) {
    ...
}
```

---

## 3. Konsep Fundamental DOM Querying

### 3.1 `Node` sebagai Abstraksi Universal

Dalam DOM, hampir semua hal adalah `Node`:

- document;
- element;
- attribute;
- text;
- CDATA;
- comment;
- document type;
- processing instruction;
- document fragment.

Karena itu, traversal DOM tidak boleh mengasumsikan semua child adalah `Element`.

Contoh XML:

```xml
<case>
    <id>C-001</id>
    <status>OPEN</status>
</case>
```

Secara DOM, children dari `<case>` kemungkinan bukan hanya dua element. Whitespace indentation dapat menjadi `Text` node:

```text
case Element
├── Text("\n    ")
├── Element(id)
├── Text("\n    ")
├── Element(status)
└── Text("\n")
```

Maka kode ini berbahaya:

```java
Node first = caseElement.getFirstChild();
Element id = (Element) first; // bisa ClassCastException karena first adalah Text whitespace
```

Pola aman:

```java
Node child = caseElement.getFirstChild();
while (child != null) {
    if (child.getNodeType() == Node.ELEMENT_NODE) {
        Element element = (Element) child;
        // process element
    }
    child = child.getNextSibling();
}
```

---

### 3.2 `Element` adalah Node yang Paling Sering Dikueri

`Element` merepresentasikan XML/HTML element. Dalam XML bisnis, element biasanya menjadi container data:

```xml
<applicant id="A-001">
  <name>Jane</name>
</applicant>
```

Elemen memiliki:

- tag name / qualified name;
- namespace URI;
- local name;
- prefix;
- attributes;
- child nodes.

API penting:

```java
String getTagName();
String getAttribute(String name);
String getAttributeNS(String namespaceURI, String localName);
boolean hasAttribute(String name);
boolean hasAttributeNS(String namespaceURI, String localName);
Attr getAttributeNode(String name);
Attr getAttributeNodeNS(String namespaceURI, String localName);
NodeList getElementsByTagName(String name);
NodeList getElementsByTagNameNS(String namespaceURI, String localName);
```

Kunci utamanya: `Element` API punya versi namespace-aware dan non-namespace-aware. Untuk XML yang mungkin punya namespace, gunakan versi `NS`.

---

### 3.3 `NodeList` adalah Ordered, Index-Based, dan Live

`NodeList` memberikan akses item berdasarkan index:

```java
NodeList list = element.getChildNodes();
for (int i = 0; i < list.getLength(); i++) {
    Node node = list.item(i);
}
```

Namun `NodeList` dalam DOM bersifat **live**. Artinya, perubahan pada tree dapat langsung tercermin pada `NodeList` yang sudah kamu pegang.

Contoh bug:

```java
NodeList items = parent.getChildNodes();
for (int i = 0; i < items.getLength(); i++) {
    parent.removeChild(items.item(i));
}
```

Karena list live, saat node dihapus, panjang dan index berubah. Ini dapat melewatkan node.

Pola aman 1: iterasi mundur.

```java
NodeList items = parent.getChildNodes();
for (int i = items.getLength() - 1; i >= 0; i--) {
    parent.removeChild(items.item(i));
}
```

Pola aman 2: snapshot dulu.

```java
List<Node> snapshot = new ArrayList<>();
NodeList items = parent.getChildNodes();
for (int i = 0; i < items.getLength(); i++) {
    snapshot.add(items.item(i));
}

for (Node node : snapshot) {
    parent.removeChild(node);
}
```

Untuk pure reading tanpa mutation, live behavior biasanya tidak masalah. Untuk read-while-mutating, harus sangat hati-hati.

---

### 3.4 `NamedNodeMap` untuk Attributes Bukan `Map<String, Node>` Biasa

Attributes pada element dapat diakses melalui:

```java
NamedNodeMap attrs = element.getAttributes();
```

Namun `NamedNodeMap` bukan `java.util.Map`. Ia adalah DOM collection:

```java
for (int i = 0; i < attrs.getLength(); i++) {
    Node attr = attrs.item(i);
}
```

Untuk XML namespace-aware, gunakan:

```java
Node attr = attrs.getNamedItemNS(namespaceUri, localName);
```

Hindari asumsi bahwa attribute order penting. Dalam XML, order attribute tidak seharusnya menjadi bagian dari business meaning.

---

## 4. API dan Contract yang Perlu Dipahami

### 4.1 `Document.getDocumentElement()`

API:

```java
Element root = document.getDocumentElement();
```

Ini mengembalikan root element dari XML document.

Contoh:

```xml
<cases>
  <case id="C-001" />
</cases>
```

`getDocumentElement()` mengembalikan `<cases>`.

Pola production:

```java
Element root = document.getDocumentElement();
if (root == null) {
    throw new XmlStructureException("XML document has no document element");
}

requireElementName(root, "urn:example:case", "cases");
```

Kenapa root perlu divalidasi?

Karena banyak parser/extractor bug dimulai dari asumsi bahwa input selalu jenis dokumen yang benar. Dalam sistem integration, input salah jenis harus fail-fast dengan error yang jelas.

---

### 4.2 `Node.getChildNodes()` vs `Element.getElementsByTagName()`

Ini perbedaan besar.

`getChildNodes()`:

- mengembalikan direct child nodes;
- termasuk text, comment, element, CDATA, dll;
- tidak recursive.

`getElementsByTagName()`:

- mengembalikan descendant elements;
- recursive di subtree;
- hanya element dengan tag name tertentu;
- order document/preorder.

Contoh:

```xml
<person>
  <name>Alice</name>
  <car>
    <name>Toyota</name>
  </car>
</person>
```

Kode:

```java
NodeList names = person.getElementsByTagName("name");
```

Hasilnya mencakup:

```text
<name>Alice</name>
<name>Toyota</name>
```

Jika yang dimaksud hanya direct child `<name>` dari `<person>`, maka `getElementsByTagName` terlalu luas.

Pola aman:

```java
List<Element> directNames = childElementsByName(person, null, "name");
```

Dengan helper manual traversal direct child.

---

### 4.3 `getElementsByTagName(String name)`

API:

```java
NodeList list = element.getElementsByTagName("case");
```

Karakteristik:

- mencari descendant element di subtree element tersebut;
- cocok untuk XML tanpa namespace atau query quick-and-dirty;
- special value `"*"` matching semua tag;
- memakai tag name/qualified name, bukan namespace URI + local name.

Risiko:

```xml
<case>
  <summary>
    <case>nested unrelated case</case>
  </summary>
</case>
```

Jika kamu memanggil `root.getElementsByTagName("case")`, nested case ikut terambil.

Maka pertanyaannya bukan “bisa atau tidak”, tetapi “apakah descendant search memang contract yang kamu inginkan?”

---

### 4.4 `getElementsByTagNameNS(String namespaceURI, String localName)`

API:

```java
NodeList list = element.getElementsByTagNameNS("urn:example:case", "case");
```

Karakteristik:

- namespace-aware;
- mencari descendant elements;
- matching berdasarkan namespace URI dan local name;
- special value `"*"` dapat digunakan untuk wildcard local name dan/atau namespace URI sesuai DOM contract.

Pola ini lebih aman untuk XML yang memakai namespace:

```java
static List<Element> descendantsByName(Element root, String ns, String localName) {
    NodeList nodes = root.getElementsByTagNameNS(ns, localName);
    List<Element> result = new ArrayList<>(nodes.getLength());
    for (int i = 0; i < nodes.getLength(); i++) {
        result.add((Element) nodes.item(i));
    }
    return result;
}
```

Namun ingat: ini tetap descendant search, bukan direct child search.

---

### 4.5 `Node.getNodeName()`, `getLocalName()`, `getNamespaceURI()`, `getPrefix()`

Untuk namespace-aware parsing, pahami perbedaannya.

Misal XML:

```xml
<c:case xmlns:c="urn:example:case">
  <c:id>C-001</c:id>
</c:case>
```

Pada element `<c:case>`:

```text
getNodeName()     = "c:case"       // qualified name
getLocalName()    = "case"         // local part
getPrefix()       = "c"            // alias prefix
getNamespaceURI() = "urn:example:case"
```

Pada XML dengan default namespace:

```xml
<case xmlns="urn:example:case">
  <id>C-001</id>
</case>
```

Pada element `<case>`:

```text
getNodeName()     = "case"
getLocalName()    = "case" jika parser namespace-aware
getPrefix()       = null
getNamespaceURI() = "urn:example:case"
```

Jika parser tidak namespace-aware, `getLocalName()` dan `getNamespaceURI()` dapat tidak tersedia seperti yang kamu harapkan. Karena itu konfigurasi parser harus namespace-aware sejak awal.

---

### 4.6 `getAttribute` vs `hasAttribute`

API:

```java
String value = element.getAttribute("id");
boolean exists = element.hasAttribute("id");
```

Masalah penting: `getAttribute` mengembalikan empty string jika attribute tidak ada. Tapi attribute yang ada juga bisa bernilai empty string.

Contoh:

```xml
<case id="" />
<case />
```

Pada dua contoh itu:

```java
element.getAttribute("id")
```

sama-sama dapat menghasilkan `""`.

Maka jika presence penting, gunakan `hasAttribute`:

```java
if (!element.hasAttribute("id")) {
    throw new XmlStructureException("Missing required attribute: id");
}
String id = element.getAttribute("id");
if (id.isBlank()) {
    throw new XmlStructureException("Attribute id must not be blank");
}
```

Namespace-aware version:

```java
if (!element.hasAttributeNS(NS_CASE, "id")) {
    throw new XmlStructureException("Missing required namespaced attribute: id");
}
String id = element.getAttributeNS(NS_CASE, "id");
```

Catatan penting: default namespace tidak berlaku untuk attributes biasa. Attribute tanpa prefix umumnya berada dalam no namespace, walaupun element-nya berada dalam default namespace.

Contoh:

```xml
<case xmlns="urn:example:case" id="C-001" />
```

`case` element berada di `urn:example:case`, tetapi `id` attribute tanpa prefix berada di no namespace.

Maka query attribute-nya sering:

```java
String id = element.getAttribute("id");
```

bukan:

```java
String id = element.getAttributeNS("urn:example:case", "id"); // bisa salah untuk attribute unprefixed
```

---

### 4.7 `getTextContent()`

API:

```java
String text = element.getTextContent();
```

`getTextContent()` mengembalikan concatenated text content dari node dan descendants.

Contoh:

```xml
<name>Jane</name>
```

Hasil:

```text
Jane
```

Namun untuk nested structure:

```xml
<address>
  <line1>Main Street</line1>
  <postal>123456</postal>
</address>
```

`address.getTextContent()` bisa menghasilkan gabungan whitespace dan descendant text:

```text

  Main Street
  123456

```

Jadi `getTextContent()` aman untuk leaf element yang memang contract-nya text-only. Untuk container element, gunakan traversal spesifik.

Pola helper:

```java
static String requiredLeafText(Element parent, String ns, String localName) {
    Element child = requiredDirectChild(parent, ns, localName);
    ensureNoElementChildren(child);
    String text = child.getTextContent();
    if (text == null || text.isBlank()) {
        throw new XmlStructureException("Element must not be blank: " + localName);
    }
    return text.strip();
}
```

---

## 5. Evolusi Java 8–25

DOM API di `org.w3c.dom` relatif stabil sejak lama. Dari Java 8 sampai Java 25, perubahan besar di area DOM querying bukan pada API dasarnya, tetapi pada konteks platform di sekitarnya:

```text
Java 8:
- DOM/SAX tersedia di Java SE tanpa JPMS.
- Banyak aplikasi masih memakai classpath monolith.
- Parser hardening sering dilakukan manual melalui factory feature.

Java 9:
- JPMS hadir.
- DOM/SAX berada di module java.xml.
- Akses module menjadi bagian dari reasoning runtime.

Java 11/17/21/25:
- DOM API tetap familiar.
- Runtime dan security baseline berubah.
- Security Manager makin tidak relevan sebagai sandboxing mechanism.
- Aplikasi modern lebih banyak berjalan di container/microservice.
- XML parsing harus diperlakukan sebagai input boundary yang explicit dan hardened.
```

Implikasi praktis:

- kode DOM dasar Java 8 biasanya masih compile di Java 25;
- dependency terhadap internal JDK XML implementation harus dihindari;
- gunakan public API `javax.xml.parsers`, `org.w3c.dom`, `org.xml.sax`;
- parser configuration/hardening perlu diuji lintas runtime/vendor;
- namespace-aware parsing harus dipilih dari factory, bukan ditambal di extraction layer.

---

## 6. Contoh Kode Bertahap

### 6.1 Sample XML untuk Demonstrasi

Kita gunakan XML berikut:

```xml
<cases xmlns="urn:example:case" xmlns:meta="urn:example:meta">
  <case id="C-001" meta:source="portal">
    <applicant>
      <name>Jane Doe</name>
      <postalCode>123456</postalCode>
    </applicant>
    <status>OPEN</status>
  </case>
  <case id="C-002" meta:source="batch">
    <applicant>
      <name>John Smith</name>
      <postalCode>654321</postalCode>
    </applicant>
    <status>CLOSED</status>
  </case>
</cases>
```

Namespace:

```java
static final String NS_CASE = "urn:example:case";
static final String NS_META = "urn:example:meta";
```

---

### 6.2 Parser Namespace-Aware

Sebelum querying, parser harus dibuat namespace-aware.

```java
import org.w3c.dom.Document;

import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import java.io.InputStream;

public final class DomParser {
    private DomParser() {}

    public static Document parse(InputStream input) throws Exception {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();

        // Required for getNamespaceURI/getLocalName/getElementsByTagNameNS to behave correctly.
        factory.setNamespaceAware(true);

        // Security hardening will be covered deeper in Part 30.
        factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);

        DocumentBuilder builder = factory.newDocumentBuilder();
        return builder.parse(input);
    }
}
```

Catatan: security hardening XML tidak cukup hanya dengan `FEATURE_SECURE_PROCESSING`. Part 30 akan membahas XXE/entity expansion secara khusus.

---

### 6.3 Validasi Root

```java
import org.w3c.dom.Document;
import org.w3c.dom.Element;

public final class CaseXmlReader {
    private static final String NS_CASE = "urn:example:case";

    public Cases read(Document document) {
        Element root = document.getDocumentElement();
        requireName(root, NS_CASE, "cases");

        // lanjut extract case elements
        return null;
    }

    private static void requireName(Element element, String namespaceUri, String localName) {
        if (element == null) {
            throw new XmlStructureException("Expected element but got null");
        }
        if (!namespaceUri.equals(element.getNamespaceURI())
                || !localName.equals(element.getLocalName())) {
            throw new XmlStructureException(
                    "Expected element {" + namespaceUri + "}" + localName
                            + " but got {" + element.getNamespaceURI() + "}" + element.getLocalName());
        }
    }
}
```

Kenapa error message memakai `{namespaceURI}localName`?

Karena itu representasi yang tidak ambigu untuk QName. Prefix tidak stabil, URI stabil.

---

### 6.4 Direct Child Elements by Namespace Name

DOM tidak menyediakan method langsung “ambil direct child element dengan namespace URI + local name”. Kita bisa buat helper.

```java
import org.w3c.dom.Element;
import org.w3c.dom.Node;

import java.util.ArrayList;
import java.util.List;

public final class DomRead {
    private DomRead() {}

    public static List<Element> directChildElements(Element parent) {
        List<Element> result = new ArrayList<>();
        Node child = parent.getFirstChild();
        while (child != null) {
            if (child.getNodeType() == Node.ELEMENT_NODE) {
                result.add((Element) child);
            }
            child = child.getNextSibling();
        }
        return result;
    }

    public static List<Element> directChildElementsByName(
            Element parent,
            String namespaceUri,
            String localName
    ) {
        List<Element> result = new ArrayList<>();
        Node child = parent.getFirstChild();
        while (child != null) {
            if (child.getNodeType() == Node.ELEMENT_NODE) {
                Element element = (Element) child;
                if (sameName(element, namespaceUri, localName)) {
                    result.add(element);
                }
            }
            child = child.getNextSibling();
        }
        return result;
    }

    public static boolean sameName(Element element, String namespaceUri, String localName) {
        return equalsNullable(namespaceUri, element.getNamespaceURI())
                && localName.equals(element.getLocalName());
    }

    private static boolean equalsNullable(String expected, String actual) {
        return expected == null ? actual == null : expected.equals(actual);
    }
}
```

Kenapa `namespaceUri` bisa `null`?

Dalam DOM, no namespace sering direpresentasikan sebagai `null`. Ini relevan untuk XML tanpa namespace atau unprefixed attributes.

---

### 6.5 Required Direct Child

Untuk XML contract yang mengharuskan exactly one child:

```java
public static Element requiredDirectChild(Element parent, String namespaceUri, String localName) {
    List<Element> matches = directChildElementsByName(parent, namespaceUri, localName);

    if (matches.isEmpty()) {
        throw new XmlStructureException(
                "Missing required child element {" + namespaceUri + "}" + localName
                        + " under " + describe(parent));
    }
    if (matches.size() > 1) {
        throw new XmlStructureException(
                "Expected exactly one child element {" + namespaceUri + "}" + localName
                        + " under " + describe(parent)
                        + " but found " + matches.size());
    }
    return matches.get(0);
}

public static Element optionalDirectChild(Element parent, String namespaceUri, String localName) {
    List<Element> matches = directChildElementsByName(parent, namespaceUri, localName);

    if (matches.isEmpty()) {
        return null;
    }
    if (matches.size() > 1) {
        throw new XmlStructureException(
                "Expected at most one child element {" + namespaceUri + "}" + localName
                        + " under " + describe(parent)
                        + " but found " + matches.size());
    }
    return matches.get(0);
}

private static String describe(Element element) {
    return "{" + element.getNamespaceURI() + "}" + element.getLocalName();
}
```

Ini jauh lebih defensible daripada:

```java
(Element) parent.getElementsByTagName("name").item(0)
```

Karena helper di atas eksplisit tentang:

- direct child;
- namespace;
- required/optional;
- cardinality;
- error message.

---

### 6.6 Required Attribute

```java
public static String requiredAttribute(Element element, String name) {
    if (!element.hasAttribute(name)) {
        throw new XmlStructureException(
                "Missing required attribute '" + name + "' on " + describe(element));
    }

    String value = element.getAttribute(name);
    if (value == null || value.isBlank()) {
        throw new XmlStructureException(
                "Attribute '" + name + "' on " + describe(element) + " must not be blank");
    }

    return value;
}

public static String optionalAttribute(Element element, String name) {
    if (!element.hasAttribute(name)) {
        return null;
    }
    return element.getAttribute(name);
}

public static String requiredAttributeNS(Element element, String namespaceUri, String localName) {
    if (!element.hasAttributeNS(namespaceUri, localName)) {
        throw new XmlStructureException(
                "Missing required attribute {" + namespaceUri + "}" + localName
                        + " on " + describe(element));
    }

    String value = element.getAttributeNS(namespaceUri, localName);
    if (value == null || value.isBlank()) {
        throw new XmlStructureException(
                "Attribute {" + namespaceUri + "}" + localName
                        + " on " + describe(element) + " must not be blank");
    }

    return value;
}
```

Penggunaan:

```java
String id = requiredAttribute(caseElement, "id");
String source = requiredAttributeNS(caseElement, NS_META, "source");
```

---

### 6.7 Required Leaf Text

```java
public static String requiredLeafText(Element parent, String namespaceUri, String localName) {
    Element child = requiredDirectChild(parent, namespaceUri, localName);
    ensureNoElementChildren(child);

    String text = child.getTextContent();
    if (text == null || text.isBlank()) {
        throw new XmlStructureException("Element " + describe(child) + " must not be blank");
    }

    return text.strip();
}

private static void ensureNoElementChildren(Element element) {
    Node child = element.getFirstChild();
    while (child != null) {
        if (child.getNodeType() == Node.ELEMENT_NODE) {
            throw new XmlStructureException(
                    "Expected leaf text element but found nested child element "
                            + describe((Element) child)
                            + " under " + describe(element));
        }
        child = child.getNextSibling();
    }
}
```

Contoh:

```java
String status = requiredLeafText(caseElement, NS_CASE, "status");
```

Kenapa `ensureNoElementChildren` penting?

Karena tanpa itu, XML seperti ini bisa diam-diam terbaca sebagai gabungan text:

```xml
<status>OP<code>EN</code></status>
```

Jika business contract mengatakan `status` harus leaf text, nested element harus dianggap invalid.

---

### 6.8 Membaca Dokumen Menjadi Domain Object

```java
import org.w3c.dom.Document;
import org.w3c.dom.Element;

import java.util.ArrayList;
import java.util.List;

public final class CaseXmlReader {
    private static final String NS_CASE = "urn:example:case";
    private static final String NS_META = "urn:example:meta";

    public Cases read(Document document) {
        Element root = document.getDocumentElement();
        requireName(root, NS_CASE, "cases");

        List<Element> caseElements = directChildElementsByName(root, NS_CASE, "case");
        List<CaseRecord> records = new ArrayList<>(caseElements.size());

        for (Element caseElement : caseElements) {
            records.add(readCase(caseElement));
        }

        return new Cases(records);
    }

    private CaseRecord readCase(Element caseElement) {
        requireName(caseElement, NS_CASE, "case");

        String id = requiredAttribute(caseElement, "id");
        String source = requiredAttributeNS(caseElement, NS_META, "source");

        Element applicant = requiredDirectChild(caseElement, NS_CASE, "applicant");
        String name = requiredLeafText(applicant, NS_CASE, "name");
        String postalCode = requiredLeafText(applicant, NS_CASE, "postalCode");
        String status = requiredLeafText(caseElement, NS_CASE, "status");

        return new CaseRecord(id, source, name, postalCode, status);
    }
}

record Cases(List<CaseRecord> cases) {}
record CaseRecord(String id, String source, String applicantName, String postalCode, String status) {}
```

Ini adalah pola yang lebih production-grade:

- root validated;
- namespace-aware;
- direct-child semantics;
- required fields checked;
- attribute ambiguity handled;
- text-only leaf checked;
- output berupa domain/value object, bukan DOM node leaking ke business layer.

---

## 7. Design Patterns / Usage Patterns

### 7.1 Pattern: DOM as Boundary, Domain Object as Core

Jangan biarkan DOM menyebar ke business layer.

Buruk:

```java
public void processCase(Element caseElement) {
    // business logic langsung baca DOM
}
```

Lebih baik:

```java
public void processCase(CaseRecord caseRecord) {
    // business logic pakai typed object
}
```

Boundary:

```text
XML bytes
  -> hardened parser
  -> DOM Document
  -> extractor/validator
  -> typed domain object
  -> business logic
```

Keuntungan:

- business logic tidak tergantung API DOM;
- unit test lebih mudah;
- error parsing dipisah dari error domain;
- migration ke SAX/StAX/Jackson XML lebih mudah;
- auditability lebih baik.

---

### 7.2 Pattern: Explicit Cardinality Helper

Setiap field XML punya cardinality contract:

```text
0..1 optional
1 exactly required
0..n collection optional
1..n non-empty collection
```

Buat helper sesuai cardinality:

```java
Element requiredDirectChild(...)
Element optionalDirectChild(...)
List<Element> directChildren(...)
List<Element> requiredDirectChildrenNonEmpty(...)
```

Hindari:

```java
nodes.item(0)
```

tanpa pengecekan `getLength()`.

Masalah `item(0)`:

- jika kosong, return `null`;
- cast berikutnya bisa NPE;
- error message menjadi tidak kontekstual;
- duplicate unexpected elements tidak terdeteksi.

---

### 7.3 Pattern: Namespace Constants

Gunakan constants untuk namespace URI:

```java
public final class XmlNamespaces {
    private XmlNamespaces() {}

    public static final String CASE = "urn:example:case";
    public static final String META = "urn:example:meta";
}
```

Jangan menyebarkan string literal namespace di banyak tempat:

```java
getElementsByTagNameNS("urn:example:case", "case");
```

Bukan karena string literal selalu salah, tetapi karena namespace adalah bagian dari contract. Contract harus mudah ditemukan, review, dan diuji.

---

### 7.4 Pattern: `{namespaceURI}localName` in Diagnostics

Gunakan format Clark notation untuk error/log:

```text
{urn:example:case}case
{urn:example:case}status
```

Helper:

```java
public static String qname(Node node) {
    return "{" + node.getNamespaceURI() + "}" + node.getLocalName();
}
```

Manfaat:

- tidak ambigu;
- prefix-independent;
- mudah dibandingkan di logs;
- cocok untuk debugging default namespace trap.

---

### 7.5 Pattern: Snapshot Before Mutation

Jika perlu menghapus/memindahkan hasil query DOM, jangan mutate live `NodeList` secara naïve.

```java
public static List<Node> snapshot(NodeList list) {
    List<Node> result = new ArrayList<>(list.getLength());
    for (int i = 0; i < list.getLength(); i++) {
        result.add(list.item(i));
    }
    return result;
}
```

Kemudian:

```java
for (Node node : snapshot(parent.getChildNodes())) {
    parent.removeChild(node);
}
```

---

### 7.6 Pattern: Do Not Use Descendant Search for Direct Schema Contracts

Jika schema/business contract mengatakan:

```xml
<case>
  <status>OPEN</status>
</case>
```

Maka query harus direct child:

```java
requiredLeafText(caseElement, NS_CASE, "status")
```

Bukan:

```java
caseElement.getElementsByTagNameNS(NS_CASE, "status").item(0)
```

Kenapa?

Karena descendant query bisa mengambil status nested:

```xml
<case>
  <history>
    <status>CLOSED</status>
  </history>
  <status>OPEN</status>
</case>
```

Jika kode mengambil status pertama dalam document order, hasilnya bisa `CLOSED`, bukan current status.

---

### 7.7 Pattern: Preserve Location Context Manually

DOM `Node` biasa tidak selalu membawa line/column location. Jika perlu error reporting kaya lokasi, ada beberapa pendekatan:

- gunakan SAX/StAX parser untuk location-aware validation;
- simpan path DOM saat traversal;
- tambahkan user data saat parsing custom;
- laporkan logical path, bukan line number.

Contoh logical path:

```text
/cases/case[2]/applicant/postalCode must be six digits
```

Helper path sederhana:

```java
public final class XmlPath {
    private final List<String> segments;

    private XmlPath(List<String> segments) {
        this.segments = List.copyOf(segments);
    }

    public static XmlPath root(String name) {
        return new XmlPath(List.of(name));
    }

    public XmlPath child(String name) {
        List<String> next = new ArrayList<>(segments);
        next.add(name);
        return new XmlPath(next);
    }

    @Override
    public String toString() {
        return "/" + String.join("/", segments);
    }
}
```

---

## 8. Failure Modes

### 8.1 Default Namespace Trap

XML:

```xml
<cases xmlns="urn:example:case">
  <case id="C-001" />
</cases>
```

Bug:

```java
NodeList cases = document.getElementsByTagName("case");
```

Jika parser namespace-aware, `getElementsByTagName("case")` bisa tidak sesuai ekspektasi karena element identity namespace-aware. Lebih aman:

```java
NodeList cases = document.getElementsByTagNameNS("urn:example:case", "case");
```

Lebih baik lagi jika direct child:

```java
List<Element> cases = directChildElementsByName(root, NS_CASE, "case");
```

---

### 8.2 Prefix-Based Logic

Bug:

```java
if ("c:case".equals(element.getNodeName())) {
    // process
}
```

XML valid dengan prefix berbeda gagal:

```xml
<x:case xmlns:x="urn:example:case" />
```

Fix:

```java
if (sameName(element, NS_CASE, "case")) {
    // process
}
```

---

### 8.3 Descendant Search Accidentally Matches Nested Data

Bug:

```java
String status = ((Element) caseElement
        .getElementsByTagNameNS(NS_CASE, "status")
        .item(0))
        .getTextContent();
```

Input:

```xml
<case>
  <history>
    <status>CLOSED</status>
  </history>
  <status>OPEN</status>
</case>
```

Result: `CLOSED` padahal current status adalah `OPEN`.

Fix: direct child query.

---

### 8.4 `getAttribute` Missing vs Empty Ambiguity

Bug:

```java
String id = element.getAttribute("id");
if (id.isEmpty()) {
    // attribute missing?
}
```

Tidak bisa membedakan:

```xml
<case />
<case id="" />
```

Fix:

```java
if (!element.hasAttribute("id")) {
    throw missing;
}
String id = element.getAttribute("id");
if (id.isBlank()) {
    throw blank;
}
```

---

### 8.5 Treating Whitespace as Nonexistent

Bug:

```java
Element first = (Element) parent.getFirstChild();
```

Karena `getFirstChild()` bisa Text whitespace.

Fix:

```java
Element first = firstDirectChildElement(parent);
```

---

### 8.6 Live `NodeList` Mutation Skip

Bug:

```java
NodeList children = parent.getChildNodes();
for (int i = 0; i < children.getLength(); i++) {
    parent.removeChild(children.item(i));
}
```

Fix:

```java
for (Node child : snapshot(parent.getChildNodes())) {
    parent.removeChild(child);
}
```

---

### 8.7 Assuming Attribute Namespace Follows Default Namespace

XML:

```xml
<case xmlns="urn:example:case" id="C-001" />
```

Bug:

```java
caseElement.getAttributeNS("urn:example:case", "id");
```

Unprefixed `id` attribute berada di no namespace.

Fix:

```java
caseElement.getAttribute("id");
```

Untuk namespaced attribute:

```xml
<case xmlns="urn:example:case" xmlns:meta="urn:example:meta" meta:source="portal" />
```

Gunakan:

```java
caseElement.getAttributeNS("urn:example:meta", "source");
```

---

### 8.8 Leaking DOM Node Outside Parser Boundary

Bug:

```java
public Element findApplicant(Document document) {
    return requiredDirectChild(document.getDocumentElement(), NS_CASE, "applicant");
}
```

DOM node mutable dan terikat ke owner document. Jika tersebar ke business layer:

- mutation bisa terjadi di tempat tak terkontrol;
- memory seluruh document bisa tertahan;
- API business menjadi XML-coupled;
- concurrency safety makin buruk.

Fix:

```java
public Applicant readApplicant(Element applicantElement) {
    return new Applicant(
            requiredLeafText(applicantElement, NS_CASE, "name"),
            requiredLeafText(applicantElement, NS_CASE, "postalCode")
    );
}
```

---

## 9. Performance, Memory, Security Considerations

### 9.1 Performance: DOM Query is Tree Traversal

`getElementsByTagName*` dapat menelusuri subtree. Jika dipanggil berulang di dalam loop, kompleksitas bisa memburuk.

Buruk:

```java
NodeList cases = root.getElementsByTagNameNS(NS_CASE, "case");
for (int i = 0; i < cases.getLength(); i++) {
    Element caseElement = (Element) cases.item(i);

    // repeated descendant search from each case
    String status = ((Element) caseElement
            .getElementsByTagNameNS(NS_CASE, "status")
            .item(0))
            .getTextContent();
}
```

Lebih predictable:

```java
List<Element> cases = directChildElementsByName(root, NS_CASE, "case");
for (Element caseElement : cases) {
    String status = requiredLeafText(caseElement, NS_CASE, "status");
}
```

---

### 9.2 Memory: Node Reference Menahan Subtree/Document

Jika kamu menyimpan satu `Element` dari DOM besar, kamu mungkin secara tidak langsung menahan seluruh document di memory karena parent/owner relationships.

Buruk:

```java
cache.put(caseId, caseElement);
```

Lebih baik:

```java
cache.put(caseId, readCase(caseElement));
```

Jangan cache DOM node kecuali benar-benar paham lifecycle-nya.

---

### 9.3 Security: Querying Tidak Mengamankan Parsing

DOM querying terjadi setelah parsing. Jika parser tidak hardened, input malicious bisa menyerang sebelum extraction logic berjalan.

Contoh ancaman:

- XXE;
- SSRF via external entity;
- local file disclosure;
- entity expansion bomb;
- huge XML memory exhaustion.

Part 30 akan khusus membahas secure XML parsing.

Namun pada layer querying, tetap ada security concern:

- jangan log full XML sensitif;
- jangan masukkan raw text XML ke error response;
- validasi length dan character set field;
- jangan percaya schema hanya karena root benar;
- canonicalize/normalize data sebelum dipakai sebagai key.

---

### 9.4 Observability: Error Harus Menjelaskan Contract yang Dilanggar

Buruk:

```text
NullPointerException
```

Lebih baik:

```text
Missing required child element {urn:example:case}status under {urn:example:case}case at /cases/case[2]
```

Untuk integration system, kualitas error message adalah bagian dari design. Ia membantu:

- debugging vendor payload;
- incident triage;
- audit trail;
- support team;
- automated rejection report.

---

## 10. Production Checklist

Gunakan checklist ini ketika membuat DOM extraction layer.

### Parser/Document Boundary

- [ ] Parser dibuat `namespaceAware(true)` jika XML punya namespace.
- [ ] Parser hardening direncanakan, bukan default trust.
- [ ] Root element divalidasi dengan namespace URI + local name.
- [ ] DOM tidak dileak ke business layer kecuali ada alasan kuat.

### Querying

- [ ] Direct child vs descendant search dipilih secara sadar.
- [ ] Tidak memakai `getElementsByTagName` untuk schema direct child contract.
- [ ] Namespace-aware method dipakai untuk namespaced XML.
- [ ] Logic tidak bergantung pada prefix.
- [ ] `NodeList` diperlakukan sebagai live collection.
- [ ] Mutation dilakukan setelah snapshot atau iterasi aman.

### Attributes

- [ ] Required attribute memakai `hasAttribute` sebelum `getAttribute`.
- [ ] Missing vs empty string dibedakan.
- [ ] Namespaced attribute memakai `getAttributeNS`.
- [ ] Unprefixed attribute pada default namespace tidak keliru dianggap namespaced.

### Text

- [ ] `getTextContent()` hanya dipakai untuk leaf-text contract.
- [ ] Whitespace policy jelas: preserve, trim, strip, atau reject.
- [ ] Nested element pada leaf text ditolak jika tidak valid.
- [ ] Length dan character validation dilakukan setelah extraction.

### Error Handling

- [ ] Error message menyebut logical path atau element context.
- [ ] Error membedakan missing, duplicate, blank, invalid format, wrong namespace.
- [ ] Full XML tidak dilog sembarangan.
- [ ] Sensitive value dimasking.

### Performance/Memory

- [ ] Tidak melakukan descendant query berulang dalam nested loop tanpa alasan.
- [ ] Tidak cache DOM node besar.
- [ ] Large XML dipertimbangkan untuk SAX/StAX.
- [ ] Extraction mengubah DOM ke typed object sesegera mungkin.

---

## 11. Latihan / Thought Exercise

### Exercise 1 — Direct Child vs Descendant

Diberikan XML:

```xml
<case xmlns="urn:example:case">
  <history>
    <status>CLOSED</status>
  </history>
  <status>OPEN</status>
</case>
```

Pertanyaan:

1. Apa hasil `caseElement.getElementsByTagNameNS(NS_CASE, "status").item(0)`?
2. Kenapa hasil itu bisa salah secara business?
3. Tulis helper untuk mengambil direct child `status` exactly one.

Expected reasoning:

- descendant search mengambil status pertama dalam document order;
- status nested dalam history bukan current status;
- direct child query harus digunakan.

---

### Exercise 2 — Namespace Prefix Trap

Dua XML berikut harus dianggap sama:

```xml
<a:case xmlns:a="urn:example:case" />
```

```xml
<x:case xmlns:x="urn:example:case" />
```

Pertanyaan:

1. Kenapa `getNodeName().equals("a:case")` rapuh?
2. Kombinasi method apa yang harus dipakai?
3. Bagaimana error message sebaiknya menampilkan nama element?

Expected reasoning:

- prefix hanya alias;
- gunakan `getNamespaceURI()` + `getLocalName()`;
- tampilkan `{namespaceURI}localName`.

---

### Exercise 3 — Attribute Missing vs Empty

Diberikan:

```xml
<case />
<case id="" />
<case id="C-001" />
```

Pertanyaan:

1. Apa hasil `getAttribute("id")` pada masing-masing?
2. Bagaimana membedakan missing dan blank?
3. Dalam regulatory import, apakah `id=""` sebaiknya diterima?

Expected reasoning:

- missing dan empty sama-sama bisa menghasilkan empty string;
- gunakan `hasAttribute`;
- required identifier biasanya harus reject blank.

---

### Exercise 4 — Live NodeList Mutation

Diberikan kode:

```java
NodeList children = parent.getChildNodes();
for (int i = 0; i < children.getLength(); i++) {
    parent.removeChild(children.item(i));
}
```

Pertanyaan:

1. Apa bug potensialnya?
2. Kenapa terjadi?
3. Tulis versi aman.

Expected reasoning:

- `NodeList` live;
- index berubah saat remove;
- snapshot atau iterasi mundur.

---

### Exercise 5 — DOM Boundary Design

Kamu menerima XML case management dari external agency dan harus mengimpor data ke sistem internal.

Pertanyaan:

1. Apakah service layer sebaiknya menerima `Element` atau `CaseImportCommand`?
2. Di layer mana namespace dan XML cardinality divalidasi?
3. Bagaimana cara membuat error yang berguna untuk agency pengirim?

Expected reasoning:

- DOM hanya boundary;
- extraction/adapter layer validasi XML structure;
- domain layer menerima typed command;
- error harus menyebut path, expected, actual, dan reason.

---

## 12. Ringkasan

DOM querying bukan hanya “ambil tag”. Ia adalah proses navigasi tree mutable yang penuh contract tersembunyi.

Hal paling penting dari part ini:

1. **Scope harus eksplisit**: direct child berbeda dari descendant search.
2. **Namespace URI adalah identitas**, prefix hanya alias.
3. **`NodeList` live**, bukan snapshot.
4. **`getAttribute` ambigu** untuk missing vs empty.
5. **Whitespace adalah node**, bukan noise yang otomatis hilang.
6. **`getTextContent()` cocok untuk leaf text**, berbahaya untuk container complex.
7. **DOM sebaiknya berhenti di boundary**, lalu dikonversi ke typed domain object.
8. **Error extraction harus defensible**, terutama untuk integration dan regulatory systems.

Dengan mental model ini, kamu bisa membuat DOM extraction yang tidak hanya “berjalan di happy path”, tetapi kuat terhadap XML nyata yang messy, namespaced, nested, incomplete, duplicated, atau malicious.

---

## 13. Referensi

- Java SE 25 API — `org.w3c.dom.Document`
- Java SE 25 API — `org.w3c.dom.Element`
- Java SE 25 API — `org.w3c.dom.Node`
- Java SE 25 API — `org.w3c.dom.NodeList`
- Java SE 25 API — `org.w3c.dom.NamedNodeMap`
- Java SE 8 API — `org.w3c.dom.NodeList`
- W3C DOM Level 3 Core Specification
- XML Namespaces specification

---

## Status Seri

Progress saat ini: **Part 26 dari 32 selesai**.

Seri belum selesai. Part berikutnya:

**Part 27 — DOM Level 3: TypeInfo, UserData, ErrorHandler, Load/Save Boundary**

File berikutnya:

```text
27-dom-level-3-typeinfo-userdata-errorhandler-load-save-boundary.md
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 25 — DOM Creation, Mutation, Import, Adopt, Clone, Normalize](./25-dom-creation-mutation-import-adopt-clone-normalize.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 27 — DOM Level 3: TypeInfo, UserData, ErrorHandler, Load/Save Boundary](./27-dom-level-3-typeinfo-userdata-errorhandler-load-save-boundary.md)
