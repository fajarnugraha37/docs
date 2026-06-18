# Part 16 — JAXB / Jakarta XML Binding Core

Series: `learn-java-json-xml-soap-connectors-enterprise-integration`  
File: `learn-java-json-xml-soap-connectors-enterprise-integration-part-016.md`  
Target Java: 8 sampai 25  
Target API namespace: `javax.xml.bind` dan `jakarta.xml.bind`  
Prerequisite langsung: Part 12 XML Fundamentals, Part 13 XML Parsing Models, Part 14 XSD, Part 15 XML Security

---

## 1. Posisi Part Ini Dalam Seri

Pada part sebelumnya kita sudah membahas XML sebagai **document model**:

- XML punya namespace, QName, element, attribute, text, mixed content, entity, encoding.
- XML bisa diproses dengan DOM, SAX, StAX, XPath, dan XSLT.
- XML bisa divalidasi dengan XSD.
- XML harus diproses dengan konfigurasi security yang benar agar tidak membuka XXE, entity expansion, SSRF, dan injection vector lain.

Sekarang kita masuk ke layer berikutnya: **XML Binding**.

XML Binding adalah teknik untuk menghubungkan dua dunia:

```text
XML document
    ↕
XML binding metadata
    ↕
Java object graph
```

Di Java ecosystem, teknologi standar untuk ini dikenal sebagai:

- **JAXB** pada era Java EE / `javax.xml.bind`.
- **Jakarta XML Binding** pada era Jakarta EE / `jakarta.xml.bind`.

Secara mental model, JAXB/Jakarta XML Binding bukan sekadar “XML serializer”. Ia adalah **contract-to-object boundary**. Ia menentukan:

- bagaimana XML element menjadi Java field/property;
- bagaimana Java object menjadi XML element/attribute;
- bagaimana namespace dipertahankan;
- bagaimana optional/nillable/absent value direpresentasikan;
- bagaimana XSD dapat menjadi Java class;
- bagaimana Java class dapat menjadi XML;
- bagaimana SOAP payload dan legacy integration dipetakan ke object model;
- bagaimana perubahan schema bisa merusak runtime compatibility.

Part ini adalah fondasi. Annotation detail, XSD-first workflow, code-first workflow, polymorphism, adapter, dan migration detail akan dibahas pada part berikutnya. Di sini kita mengunci mental model core.

---

## 2. Apa Itu XML Binding?

### 2.1 Definisi praktis

XML Binding adalah proses membuat **representasi Java object** dari XML, dan membuat **XML document** dari Java object.

Istilah utama:

| Istilah | Makna |
|---|---|
| Unmarshal | XML → Java object graph |
| Marshal | Java object graph → XML |
| Binding metadata | Aturan mapping antara XML dan Java |
| Bound class | Java class yang dapat dipakai untuk marshal/unmarshal |
| Root element | XML element paling luar yang menjadi entry point dokumen |
| JAXBContext | runtime registry/metadata engine untuk binding classes |
| Marshaller | object yang menulis Java object menjadi XML |
| Unmarshaller | object yang membaca XML menjadi Java object |

Contoh:

```xml
<customer xmlns="urn:example:customer">
    <id>C001</id>
    <name>Alice</name>
</customer>
```

Dapat dipetakan menjadi:

```java
@XmlRootElement(name = "customer", namespace = "urn:example:customer")
@XmlAccessorType(XmlAccessType.FIELD)
public class CustomerXml {
    private String id;
    private String name;
}
```

Kemudian:

```java
CustomerXml customer = (CustomerXml) unmarshaller.unmarshal(inputStream);
```

atau:

```java
marshaller.marshal(customer, outputStream);
```

### 2.2 XML Binding bukan DOM wrapper

Kesalahan umum: mengira JAXB adalah cara lain membaca XML seperti DOM.

Padahal berbeda:

```text
DOM:
XML → generic node tree
developer membaca node manual

JAXB:
XML → typed object graph
binding metadata menentukan mapping
```

DOM memberi fleksibilitas maksimal, tetapi developer harus memahami struktur XML secara manual. JAXB memberi object model yang lebih nyaman, tetapi ada kontrak mapping yang harus benar.

### 2.3 XML Binding bukan sekadar serialization

Java serialization biasanya berpikir dari object ke byte.

JAXB harus berpikir dari **external contract**:

```text
External XML/XSD contract
        ↓
Binding model
        ↓
Java representation
```

Dalam enterprise integration, XML sering bukan milik aplikasi kita. XML datang dari:

- regulator;
- payment gateway;
- government service;
- SOAP provider;
- legacy EIS;
- batch file exchange;
- B2B integration;
- mainframe bridge;
- ESB/integration hub.

Karena itu, object model Java harus tunduk pada external contract, bukan sebaliknya.

---

## 3. JAXB vs Jakarta XML Binding: Nama Berubah, Mental Model Tetap

### 3.1 Namespace historis

Ada dua namespace API yang perlu dikuasai:

| Era | Package | Umum dipakai pada |
|---|---|---|
| Java EE / JAXB lama | `javax.xml.bind.*` | Java 6/7/8, Jakarta EE 8, library lama |
| Jakarta EE modern | `jakarta.xml.bind.*` | Jakarta EE 9+, modern app server, Java 11+ modern stack |

Contoh import lama:

```java
import javax.xml.bind.JAXBContext;
import javax.xml.bind.Marshaller;
import javax.xml.bind.Unmarshaller;
import javax.xml.bind.annotation.XmlRootElement;
```

Contoh import baru:

```java
import jakarta.xml.bind.JAXBContext;
import jakarta.xml.bind.Marshaller;
import jakarta.xml.bind.Unmarshaller;
import jakarta.xml.bind.annotation.XmlRootElement;
```

Sebagian besar konsep sama, tetapi binary/source compatibility tidak otomatis sama karena package berubah.

### 3.2 Java 8 sampai Java 25: hal yang harus diingat

Pada Java 8, banyak developer terbiasa memakai JAXB langsung karena API tersedia dari JDK.

Namun sejak Java 11, modul Java EE/CORBA seperti `java.xml.bind`, `java.xml.ws`, dan `java.activation` dihapus dari JDK. Konsekuensinya:

```text
Java 8:
JAXB sering “langsung ada”.

Java 9/10:
modul Java EE deprecated for removal.

Java 11+:
JAXB tidak lagi disediakan oleh JDK.
Harus deklarasi dependency API + implementation secara eksplisit.
```

Ini adalah salah satu sumber kegagalan migrasi Java 8 → 11+ paling umum pada aplikasi SOAP/XML legacy.

### 3.3 Spec vs implementation

JAXB/Jakarta XML Binding adalah **API/specification**. Untuk berjalan, aplikasi butuh **implementation/provider**.

Mental model:

```text
Your code
  uses API: jakarta.xml.bind-api / javax.xml.bind-api
        ↓
Runtime provider
  e.g. Eclipse JAXB RI / app server implementation
        ↓
JAXP parser / XML stack
        ↓
XML input/output
```

Di Jakarta EE server, provider bisa disediakan container. Di standalone Java application, kita biasanya perlu menambahkan dependency implementation.

---

## 4. Kapan Menggunakan JAXB/Jakarta XML Binding?

### 4.1 Gunakan XML Binding ketika

Gunakan JAXB/Jakarta XML Binding jika:

1. XML structure stabil dan punya mapping jelas ke object.
2. Ada XSD/WSDL contract yang harus diikuti.
3. Anda berinteraksi dengan SOAP payload.
4. Anda perlu schema-first generated classes.
5. Anda perlu validasi XSD saat boundary input.
6. Anda punya enterprise XML file exchange.
7. Anda ingin object-level processing, bukan node-level processing.
8. Anda perlu maintainability lebih baik daripada XPath manual scattered di banyak tempat.

### 4.2 Jangan langsung gunakan XML Binding ketika

Lebih hati-hati atau gunakan parser manual/StAX/DOM jika:

1. XML sangat besar dan hanya perlu extract beberapa field.
2. XML sangat dinamis atau schema-less.
3. XML mengandung mixed content kompleks seperti rich text/document markup.
4. XML perlu diproses secara streaming tanpa membangun object graph penuh.
5. XML mengandung bagian unknown/extensible yang harus dipertahankan persis.
6. Anda perlu canonical signature-preserving transformation.
7. Anda tidak mengontrol schema dan sering berubah secara tidak kompatibel.

### 4.3 Decision matrix awal

| Kebutuhan | Pilihan biasanya tepat |
|---|---|
| Baca XML kecil-menengah ke DTO | JAXB |
| Generate XML dari object sesuai XSD | JAXB |
| SOAP client/server payload | JAXB/JAX-WS stack |
| Extract 3 field dari XML 2 GB | StAX |
| Manipulasi XML tree dinamis | DOM / JDOM / XOM / custom |
| Query XML dengan path expression | XPath |
| Transform XML ke XML/HTML/text | XSLT |
| Validasi contract formal | XSD + Validator |
| Preserve exact lexical XML | Hindari JAXB sebagai primary tool |

---

## 5. Mental Model Utama JAXB Runtime

JAXB runtime bisa dipahami sebagai empat lapisan:

```text
+--------------------------------------------------+
| Application boundary                              |
| service, adapter, controller, batch processor     |
+--------------------------------------------------+
                     ↓
+--------------------------------------------------+
| JAXB facade                                       |
| JAXBContext, Marshaller, Unmarshaller             |
+--------------------------------------------------+
                     ↓
+--------------------------------------------------+
| Binding metadata                                  |
| annotations, ObjectFactory, package-info, XSD map |
+--------------------------------------------------+
                     ↓
+--------------------------------------------------+
| XML processing substrate                          |
| JAXP, StAX/SAX/DOM Source, encoding, namespace    |
+--------------------------------------------------+
```

Setiap layer punya failure mode sendiri.

| Layer | Failure umum |
|---|---|
| Application boundary | salah DTO, domain leakage, unsafe trust boundary |
| JAXB facade | context dibuat berulang, marshaller reuse tidak aman, provider mismatch |
| Binding metadata | root element hilang, namespace salah, field order berubah, nillable salah |
| XML substrate | XXE, encoding salah, stream ditutup salah, invalid document, schema mismatch |

Top engineer tidak hanya tahu cara menulis `JAXBContext.newInstance()`, tetapi bisa menjelaskan failure mode tiap layer.

---

## 6. Core API: JAXBContext

### 6.1 Apa itu JAXBContext?

`JAXBContext` adalah entry point utama binding runtime.

Ia menyimpan informasi binding untuk satu set class/package:

- class mana yang bound;
- annotation apa yang berlaku;
- root element apa yang tersedia;
- namespace mapping;
- factory classes;
- type metadata;
- adapters;
- provider-specific runtime model.

Kode umum:

```java
JAXBContext context = JAXBContext.newInstance(CustomerXml.class);
```

atau:

```java
JAXBContext context = JAXBContext.newInstance("com.example.customer.xml");
```

### 6.2 Class-based context

```java
JAXBContext context = JAXBContext.newInstance(CustomerXml.class, AddressXml.class);
```

Kelebihan:

- eksplisit;
- mudah dipahami;
- cocok untuk model kecil-menengah;
- mengurangi kejutan classpath scanning.

Kekurangan:

- harus mencantumkan semua root/referenced type yang tidak reachable;
- bisa panjang untuk schema besar;
- polymorphism/wildcard perlu perhatian khusus.

### 6.3 Package-based context

```java
JAXBContext context = JAXBContext.newInstance("com.example.generated.customer");
```

Package-based context biasanya dipakai untuk generated classes dari XSD. Package tersebut sering mengandung:

- `ObjectFactory`;
- `package-info.java`;
- annotation namespace-level;
- generated JAXB classes.

Kelebihan:

- cocok untuk XSD-first;
- tidak perlu list ratusan class;
- mengikuti struktur generated package.

Kekurangan:

- lebih bergantung pada classpath/module path;
- error runtime bisa lebih membingungkan;
- package harus punya metadata yang valid.

### 6.4 Context adalah object mahal

`JAXBContext` biasanya mahal dibuat karena runtime harus membangun metadata model. Karena itu, pola production yang benar:

```text
JAXBContext: buat sekali, cache/reuse.
Marshaller: buat per operation/thread atau pakai pool dengan hati-hati.
Unmarshaller: buat per operation/thread atau pakai pool dengan hati-hati.
```

Pattern:

```java
public final class XmlBindingSupport {
    private static final JAXBContext CUSTOMER_CONTEXT = createContext();

    private static JAXBContext createContext() {
        try {
            return JAXBContext.newInstance(CustomerXml.class);
        } catch (JAXBException e) {
            throw new ExceptionInInitializerError(e);
        }
    }

    public static Marshaller newMarshaller() throws JAXBException {
        return CUSTOMER_CONTEXT.createMarshaller();
    }

    public static Unmarshaller newUnmarshaller() throws JAXBException {
        return CUSTOMER_CONTEXT.createUnmarshaller();
    }

    private XmlBindingSupport() {
    }
}
```

### 6.5 Context boundary sebaiknya selaras contract

Jangan asal membuat satu global `JAXBContext` berisi semua class aplikasi.

Lebih sehat:

```text
CustomerContractXmlContext
PaymentContractXmlContext
RegulatorSubmissionXmlContext
LegacySoapPayloadXmlContext
```

Kenapa?

Karena XML binding adalah boundary contract. Jika semua digabung:

- dependency antar contract kabur;
- classpath konflik lebih sulit didiagnosis;
- namespace collision lebih mudah terjadi;
- testing contract menjadi tidak fokus;
- runtime initialization makin berat.

---

## 7. Core API: Unmarshaller

### 7.1 Apa itu Unmarshaller?

`Unmarshaller` membaca XML dan membangun Java object tree.

Contoh:

```java
JAXBContext context = JAXBContext.newInstance(CustomerXml.class);
Unmarshaller unmarshaller = context.createUnmarshaller();

try (InputStream in = Files.newInputStream(Path.of("customer.xml"))) {
    CustomerXml customer = (CustomerXml) unmarshaller.unmarshal(in);
}
```

### 7.2 Banyak input source

Unmarshaller dapat membaca dari berbagai input:

- `File`
- `InputStream`
- `Reader`
- `URL`
- `InputSource`
- `Node`
- `Source`
- `XMLStreamReader`
- `XMLEventReader`

Pilihan input memengaruhi security dan control.

Contoh yang lebih aman untuk production adalah menyiapkan XML parser sendiri lalu memberikan `Source` atau `XMLStreamReader` yang sudah dikonfigurasi.

### 7.3 Jangan treat unmarshal sebagai trust operation

Unmarshal sering disalahpahami:

```text
XML berhasil di-unmarshal ≠ data valid secara bisnis
```

Unmarshal hanya membuktikan bahwa XML bisa dipetakan ke object sesuai aturan binding. Setelah itu masih perlu:

- schema validation bila contract butuh formal validation;
- business validation;
- authorization check;
- semantic consistency check;
- anti-mass-assignment mapping ke command/domain object;
- audit logging.

Pipeline sehat:

```text
raw XML
  → secure parser
  → optional XSD validation
  → JAXB unmarshal to boundary DTO
  → business validation
  → anti-corruption mapping
  → domain command/model
```

### 7.4 Typed unmarshal dengan JAXBElement

Kadang class tidak punya `@XmlRootElement`, terutama generated type dari XSD kompleks. Dalam kasus seperti ini kita bisa memakai overload typed:

```java
JAXBElement<CustomerXml> root = unmarshaller.unmarshal(source, CustomerXml.class);
CustomerXml customer = root.getValue();
```

Ini penting karena XML root element dan Java type tidak selalu satu-ke-satu secara langsung.

### 7.5 Validation saat unmarshal

Unmarshaller dapat diberi schema:

```java
SchemaFactory schemaFactory = SchemaFactory.newInstance(XMLConstants.W3C_XML_SCHEMA_NS_URI);
Schema schema = schemaFactory.newSchema(Path.of("customer.xsd").toFile());

Unmarshaller unmarshaller = context.createUnmarshaller();
unmarshaller.setSchema(schema);

CustomerXml customer = (CustomerXml) unmarshaller.unmarshal(inputStream);
```

Tetapi jangan lupa: `SchemaFactory` juga perlu secure configuration, terutama external access restriction.

### 7.6 Event handler

Unmarshaller bisa diberi validation event handler:

```java
unmarshaller.setEventHandler(event -> {
    // return false = stop on validation event
    return false;
});
```

Default/lenient behavior jangan diasumsikan aman. Untuk boundary system, biasanya lebih baik fail-fast untuk invalid XML.

### 7.7 Unmarshaller bukan domain factory

Jangan jadikan JAXB model sebagai domain model langsung jika XML berasal dari external party.

Buruk:

```text
External XML → JAXB object → langsung dipakai sebagai domain entity
```

Lebih baik:

```text
External XML → JAXB boundary DTO → validated command → domain aggregate/entity
```

Alasannya:

- XML field belum tentu aman;
- contract external bisa berubah;
- naming dan cardinality XML sering tidak cocok dengan domain invariant;
- generated class bisa berubah saat XSD berubah;
- domain model tidak boleh tunduk pada kebutuhan serializer.

---

## 8. Core API: Marshaller

### 8.1 Apa itu Marshaller?

`Marshaller` menulis Java object tree menjadi XML.

Contoh:

```java
JAXBContext context = JAXBContext.newInstance(CustomerXml.class);
Marshaller marshaller = context.createMarshaller();
marshaller.setProperty(Marshaller.JAXB_FORMATTED_OUTPUT, Boolean.TRUE);

CustomerXml customer = new CustomerXml("C001", "Alice");
marshaller.marshal(customer, System.out);
```

### 8.2 Output target

Marshaller dapat menulis ke:

- `OutputStream`
- `Writer`
- `File`
- `ContentHandler`
- `Node`
- `Result`
- `XMLStreamWriter`
- `XMLEventWriter`

Pilihan output penting:

| Output | Kapan dipakai |
|---|---|
| `OutputStream` | kontrol encoding via XML declaration/runtime |
| `Writer` | ketika character stream sudah ditentukan |
| `XMLStreamWriter` | integrasi streaming/pipeline |
| `DOMResult`/`Node` | perlu gabung dengan DOM pipeline |
| `SAXResult` | event-based pipeline |

### 8.3 Property penting

Property umum:

```java
marshaller.setProperty(Marshaller.JAXB_FORMATTED_OUTPUT, Boolean.TRUE);
marshaller.setProperty(Marshaller.JAXB_ENCODING, "UTF-8");
marshaller.setProperty(Marshaller.JAXB_FRAGMENT, Boolean.FALSE);
```

Makna:

| Property | Makna |
|---|---|
| `JAXB_FORMATTED_OUTPUT` | pretty print XML |
| `JAXB_ENCODING` | encoding output |
| `JAXB_FRAGMENT` | omit XML declaration jika `true` |
| `JAXB_SCHEMA_LOCATION` | tulis `xsi:schemaLocation` |
| `JAXB_NO_NAMESPACE_SCHEMA_LOCATION` | tulis `xsi:noNamespaceSchemaLocation` |

### 8.4 Pretty print bukan contract

Jangan pernah membuat sistem bergantung pada whitespace hasil formatted output.

XML secara infoset biasanya tidak menjadikan indentasi sebagai semantics, kecuali pada mixed content/text-sensitive XML. Maka:

```text
Pretty XML bagus untuk manusia.
Canonical/stable XML butuh aturan lain.
```

Jika XML akan ditandatangani secara digital, whitespace, namespace prefix, dan canonicalization menjadi sangat sensitif. Jangan asal marshal ulang signed XML.

### 8.5 Marshal tidak menjamin business completeness

Sama seperti unmarshal, marshal berhasil bukan berarti output benar secara bisnis.

Contoh:

- field wajib secara bisnis tidak diisi tetapi XSD tidak menangkap;
- amount negatif lolos karena tipe `decimal`;
- date valid secara format tetapi salah timezone;
- code list tidak sesuai master data;
- namespace benar tetapi semantic version salah;
- order item kosong tetapi schema `minOccurs=0`.

Pipeline sehat sebelum marshal:

```text
Domain model / command
  → output DTO builder
  → business output validation
  → optional XSD validation
  → marshal
  → transport/file/SOAP
```

---

## 9. Minimal Working Example

### 9.1 Model class

Versi Jakarta:

```java
package com.example.xml.customer;

import jakarta.xml.bind.annotation.XmlAccessType;
import jakarta.xml.bind.annotation.XmlAccessorType;
import jakarta.xml.bind.annotation.XmlElement;
import jakarta.xml.bind.annotation.XmlRootElement;

@XmlRootElement(name = "customer", namespace = "urn:example:customer:v1")
@XmlAccessorType(XmlAccessType.FIELD)
public class CustomerXml {

    @XmlElement(name = "id", namespace = "urn:example:customer:v1", required = true)
    private String id;

    @XmlElement(name = "name", namespace = "urn:example:customer:v1", required = true)
    private String name;

    public CustomerXml() {
        // JAXB requires a no-arg constructor unless using more advanced mechanisms.
    }

    public CustomerXml(String id, String name) {
        this.id = id;
        this.name = name;
    }

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }
}
```

### 9.2 Marshal

```java
JAXBContext context = JAXBContext.newInstance(CustomerXml.class);
Marshaller marshaller = context.createMarshaller();
marshaller.setProperty(Marshaller.JAXB_FORMATTED_OUTPUT, Boolean.TRUE);
marshaller.setProperty(Marshaller.JAXB_ENCODING, "UTF-8");

CustomerXml customer = new CustomerXml("C001", "Alice");

try (OutputStream out = Files.newOutputStream(Path.of("customer.xml"))) {
    marshaller.marshal(customer, out);
}
```

Possible output:

```xml
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<ns2:customer xmlns:ns2="urn:example:customer:v1">
    <ns2:id>C001</ns2:id>
    <ns2:name>Alice</ns2:name>
</ns2:customer>
```

Perhatikan prefix `ns2`. Prefix boleh berbeda selama namespace URI sama. Banyak developer junior salah menganggap prefix harus selalu sama. Dalam XML namespace, URI adalah identitas utama, prefix hanya alias lokal.

### 9.3 Unmarshal

```java
JAXBContext context = JAXBContext.newInstance(CustomerXml.class);
Unmarshaller unmarshaller = context.createUnmarshaller();

try (InputStream in = Files.newInputStream(Path.of("customer.xml"))) {
    CustomerXml customer = (CustomerXml) unmarshaller.unmarshal(in);
    System.out.println(customer.getId());
}
```

### 9.4 Javax equivalent

Untuk JAXB lama, import berubah:

```java
import javax.xml.bind.JAXBContext;
import javax.xml.bind.Marshaller;
import javax.xml.bind.Unmarshaller;
import javax.xml.bind.annotation.XmlRootElement;
```

Annotation concept sama, tetapi artifact dependency dan runtime compatibility berbeda.

---

## 10. Dependency Strategy Java 8–25

### 10.1 Java 8 legacy mode

Pada Java 8, banyak aplikasi lama memakai `javax.xml.bind` tanpa dependency eksplisit. Untuk maintainability, tetap disarankan membuat dependency eksplisit, terutama jika build harus stabil lintas JDK.

Contoh Maven untuk JAXB 2.x era `javax`:

```xml
<dependencies>
    <dependency>
        <groupId>javax.xml.bind</groupId>
        <artifactId>jaxb-api</artifactId>
        <version>2.3.1</version>
    </dependency>
    <dependency>
        <groupId>org.glassfish.jaxb</groupId>
        <artifactId>jaxb-runtime</artifactId>
        <version>2.3.8</version>
    </dependency>
</dependencies>
```

Catatan:

- versi final persis perlu mengikuti policy project/security update;
- jangan campur `javax` dan `jakarta` sembarangan;
- Java 8 legacy SOAP stack sering masih bergantung pada JAXB 2.x.

### 10.2 Java 11+ dengan `javax`

Jika aplikasi Java 11+ masih memakai source code `javax.xml.bind`, gunakan JAXB 2.x compatible dependencies.

```xml
<dependencies>
    <dependency>
        <groupId>javax.xml.bind</groupId>
        <artifactId>jaxb-api</artifactId>
        <version>2.3.1</version>
    </dependency>
    <dependency>
        <groupId>org.glassfish.jaxb</groupId>
        <artifactId>jaxb-runtime</artifactId>
        <version>2.3.8</version>
    </dependency>
</dependencies>
```

Ini berguna untuk migrasi bertahap:

```text
Step 1: Java 8 → Java 11/17, tetap javax
Step 2: upgrade dependencies/runtime
Step 3: baru migrasi javax → jakarta bila stack siap
```

### 10.3 Java 11+ dengan `jakarta`

Untuk Jakarta XML Binding modern:

```xml
<dependencies>
    <dependency>
        <groupId>jakarta.xml.bind</groupId>
        <artifactId>jakarta.xml.bind-api</artifactId>
        <version>4.0.2</version>
    </dependency>
    <dependency>
        <groupId>org.glassfish.jaxb</groupId>
        <artifactId>jaxb-runtime</artifactId>
        <version>4.0.5</version>
    </dependency>
</dependencies>
```

Versi harus disesuaikan dengan platform/runtime. Misalnya Jakarta EE 10 selaras dengan Jakarta XML Binding 4.0. Untuk server seperti Payara, WildFly, Open Liberty, TomEE, atau GlassFish, periksa feature/platform yang disediakan container.

### 10.4 Gradle contoh

```gradle
dependencies {
    implementation("jakarta.xml.bind:jakarta.xml.bind-api:4.0.2")
    runtimeOnly("org.glassfish.jaxb:jaxb-runtime:4.0.5")
}
```

Untuk `javax` legacy:

```gradle
dependencies {
    implementation("javax.xml.bind:jaxb-api:2.3.1")
    runtimeOnly("org.glassfish.jaxb:jaxb-runtime:2.3.8")
}
```

### 10.5 Jangan campur API namespace

Kesalahan umum:

```text
Code import: jakarta.xml.bind.*
Dependency: javax.xml.bind:jaxb-api
```

atau:

```text
Code import: javax.xml.bind.*
Dependency: jakarta.xml.bind-api
```

Ini tidak kompatibel karena package berbeda. Migration harus sadar source-level dan runtime-level.

---

## 11. Anatomy of a Bound Class

### 11.1 Minimum requirement

Untuk JAXB class sederhana biasanya butuh:

1. no-arg constructor;
2. field atau getter/setter yang dapat diakses;
3. annotation root jika class menjadi root XML;
4. annotation accessor strategy jika ingin mapping eksplisit.

Contoh:

```java
@XmlRootElement(name = "order")
@XmlAccessorType(XmlAccessType.FIELD)
public class OrderXml {
    private String orderNumber;
    private BigDecimal totalAmount;

    public OrderXml() {
    }
}
```

### 11.2 No-arg constructor

JAXB perlu membuat object saat unmarshal. Karena itu no-arg constructor biasanya dibutuhkan.

Jika Anda mendesain immutable domain model, jangan paksa domain model menjadi JAXB model. Buat boundary DTO mutable khusus XML.

Buruk:

```java
public final class Order { // rich domain object
    private final OrderId id;
    private final Money amount;
    // invariant-heavy constructor
}
```

Lalu dipaksa menjadi JAXB object.

Lebih baik:

```java
public class OrderXml { // boundary DTO
    public String orderNumber;
    public BigDecimal totalAmount;
}
```

lalu mapping:

```java
OrderCommand command = OrderXmlMapper.toCommand(orderXml);
Order order = orderService.create(command);
```

### 11.3 Field access vs property access

JAXB bisa memakai field atau getter/setter tergantung accessor strategy.

```java
@XmlAccessorType(XmlAccessType.FIELD)
public class CustomerXml {
    private String id;
    private String name;
}
```

atau:

```java
@XmlAccessorType(XmlAccessType.PROPERTY)
public class CustomerXml {
    private String id;

    @XmlElement
    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }
}
```

Rekomendasi boundary DTO: gunakan `FIELD` agar mapping tidak berubah hanya karena getter/setter helper method.

### 11.4 Root element vs type

`@XmlRootElement` mendefinisikan XML element root untuk class.

Tetapi dalam XSD, ada perbedaan antara:

```text
global element
complex type
```

Satu complex type bisa dipakai oleh banyak element. Karena itu, generated JAXB class kadang tidak punya `@XmlRootElement` dan harus dibungkus dengan `JAXBElement`.

Ini bukan bug. Ini konsekuensi model XSD.

---

## 12. Namespace Mental Model Pada JAXB

### 12.1 Namespace adalah identitas kontrak

XML berikut secara namespace-aware berbeda:

```xml
<customer>
    <id>C001</id>
</customer>
```

```xml
<customer xmlns="urn:example:customer:v1">
    <id>C001</id>
</customer>
```

Element pertama berada di no namespace. Element kedua berada di namespace `urn:example:customer:v1`.

Dalam JAXB, salah namespace sering menyebabkan:

- field menjadi null;
- unmarshal error unexpected element;
- generated output ditolak partner;
- SOAP body tidak match operation payload.

### 12.2 Package-level namespace

Biasanya namespace diatur di `package-info.java`:

```java
@jakarta.xml.bind.annotation.XmlSchema(
    namespace = "urn:example:customer:v1",
    elementFormDefault = jakarta.xml.bind.annotation.XmlNsForm.QUALIFIED
)
package com.example.xml.customer;
```

Ini lebih bersih daripada mengulang namespace di setiap annotation.

### 12.3 `elementFormDefault`

XSD sering punya:

```xml
<xs:schema
    targetNamespace="urn:example:customer:v1"
    elementFormDefault="qualified">
```

Jika `elementFormDefault="qualified"`, local elements harus berada dalam namespace target.

Jika JAXB package config tidak sesuai, output bisa tampak benar secara kasat mata tetapi invalid terhadap XSD.

### 12.4 Prefix bukan identitas

Output:

```xml
<ns2:customer xmlns:ns2="urn:example:customer:v1">
```

dan:

```xml
<cust:customer xmlns:cust="urn:example:customer:v1">
```

secara namespace-aware dapat setara.

Partner system yang menolak hanya karena prefix berbeda biasanya melakukan parsing yang salah atau string comparison. Namun dalam sistem legacy, ini tetap bisa terjadi. Solusinya mungkin butuh provider-specific prefix mapper atau output post-processing, tetapi harus dipahami sebagai interoperability workaround, bukan core XML semantics.

---

## 13. Generated Model vs Handwritten Model

### 13.1 Generated model

Generated model dibuat dari XSD dengan tool seperti `xjc`.

```text
XSD → generated Java classes → JAXB runtime
```

Kelebihan:

- schema-first;
- contract fidelity tinggi;
- cocok untuk SOAP/WSDL/XSD eksternal;
- mengurangi salah mapping manual;
- bisa regenerate saat schema berubah.

Kekurangan:

- class sering verbose;
- domain model menjadi tidak elegan;
- banyak `JAXBElement`;
- package besar;
- generated code bisa berubah antar versi tool;
- sulit diberi business behavior.

Rekomendasi:

```text
Generated JAXB classes = boundary model, bukan domain model.
```

### 13.2 Handwritten model

Handwritten model dibuat manual dengan annotation.

Kelebihan:

- lebih mudah dibaca;
- cocok untuk XML sederhana;
- cocok untuk internal XML contract;
- lebih terkontrol.

Kekurangan:

- rawan drift dari XSD;
- mudah salah namespace/order/cardinality;
- perlu contract test ekstra;
- sulit untuk schema kompleks.

### 13.3 Rule of thumb

| Situasi | Pilihan |
|---|---|
| Partner memberi XSD/WSDL formal | Generate dari XSD/WSDL |
| XML sederhana milik internal aplikasi | Handwritten class boleh |
| SOAP legacy | Biasanya generated dari WSDL/XSD |
| Regulator file exchange | Schema-first/generated lebih defensible |
| Domain object sudah kaya invariant | Jangan langsung annotate domain |
| Butuh strict compatibility | Contract-first + generated + tests |

---

## 14. JAXB and XSD Validation Boundary

### 14.1 Binding dan validation itu berbeda

JAXB binding menjawab:

```text
Bisakah XML ini dipetakan menjadi object?
```

XSD validation menjawab:

```text
Apakah XML ini sesuai grammar/schema formal?
```

Business validation menjawab:

```text
Apakah data ini masuk akal untuk proses bisnis?
```

Ketiganya tidak sama.

### 14.2 Contoh failure

XML:

```xml
<order>
    <amount>-100.00</amount>
</order>
```

Bisa jadi:

- valid XML;
- valid XSD jika `amount` hanya `xs:decimal`;
- berhasil unmarshal ke `BigDecimal`;
- invalid secara bisnis.

Karena itu pipeline tidak boleh berhenti di JAXB.

### 14.3 Validate before or during unmarshal?

Ada dua pendekatan:

```text
Approach A:
XML → XSD Validator → JAXB unmarshal

Approach B:
XML → JAXB unmarshal with schema attached
```

Approach B praktis, tetapi Approach A memberi separation yang lebih jelas jika Anda butuh error reporting detail atau pipeline security khusus.

### 14.4 Output validation

Tidak cukup hanya memvalidasi input. Untuk XML yang dikirim ke partner/regulator, validasi output terhadap XSD juga penting.

Pipeline:

```text
Build output DTO
  → marshal to XML
  → validate generated XML against XSD
  → send/archive
```

Ini membantu menangkap bug mapping sebelum partner menolak file/message.

---

## 15. Secure JAXB Usage

### 15.1 JAXB tetap bergantung pada XML parser

JAXB unmarshal pada akhirnya memproses XML. Maka isu Part 15 tetap berlaku:

- external entity;
- DTD;
- external schema;
- XInclude;
- entity expansion;
- SSRF;
- insecure transformer;
- oversized document.

Jangan menganggap JAXB otomatis aman untuk semua input.

### 15.2 Safer pattern: create secure XMLStreamReader

Contoh StAX secure-ish configuration:

```java
XMLInputFactory factory = XMLInputFactory.newFactory();
factory.setProperty(XMLInputFactory.SUPPORT_DTD, false);
factory.setProperty("javax.xml.stream.isSupportingExternalEntities", false);
factory.setProperty(XMLInputFactory.IS_REPLACING_ENTITY_REFERENCES, false);

try (InputStream in = Files.newInputStream(path)) {
    XMLStreamReader reader = factory.createXMLStreamReader(in);

    JAXBContext context = JAXBContext.newInstance(CustomerXml.class);
    Unmarshaller unmarshaller = context.createUnmarshaller();

    CustomerXml customer = (CustomerXml) unmarshaller.unmarshal(reader);
}
```

Catatan:

- property support bisa berbeda antar implementation;
- tetap gunakan size limit di layer transport/file;
- gunakan JAXP external access restriction untuk validator/transformer;
- test parser behavior, jangan hanya percaya konfigurasi.

### 15.3 Jangan unmarshal dari URL external mentah

Hindari:

```java
unmarshaller.unmarshal(new URL(userProvidedUrl));
```

Ini bisa membuka SSRF, uncontrolled network access, timeout problem, dan audit gap.

Lebih baik:

```text
controlled HTTP client/file reader
  → timeout/size limit/content type allowlist
  → secure XML parser
  → JAXB
```

### 15.4 Size limit bukan tanggung jawab JAXB saja

Batas ukuran harus dipasang sebelum JAXB:

- request body limit;
- file size limit;
- decompressed size limit;
- max element depth jika parser mendukung;
- max collection size setelah unmarshal;
- timeout processing;
- memory budget.

---

## 16. Thread Safety dan Lifecycle

### 16.1 Rule praktis

```text
JAXBContext: thread-safe untuk reuse.
Marshaller: jangan share antar thread tanpa proteksi.
Unmarshaller: jangan share antar thread tanpa proteksi.
```

Meskipun detail bisa bergantung implementation, rule production yang aman adalah membuat marshaller/unmarshaller per operation, atau memakai object pool yang jelas.

### 16.2 Anti-pattern

```java
public class BadXmlService {
    private final Unmarshaller unmarshaller;

    public BadXmlService(JAXBContext context) throws JAXBException {
        this.unmarshaller = context.createUnmarshaller();
    }

    public CustomerXml parse(InputStream in) throws JAXBException {
        return (CustomerXml) unmarshaller.unmarshal(in); // unsafe if service singleton multi-threaded
    }
}
```

Dalam Spring/Jakarta singleton service, ini bisa dipanggil paralel oleh banyak thread.

### 16.3 Better pattern

```java
public class CustomerXmlCodec {
    private final JAXBContext context;

    public CustomerXmlCodec(JAXBContext context) {
        this.context = context;
    }

    public CustomerXml read(InputStream in) {
        try {
            Unmarshaller unmarshaller = context.createUnmarshaller();
            return (CustomerXml) unmarshaller.unmarshal(in);
        } catch (JAXBException e) {
            throw new XmlCodecException("Failed to unmarshal customer XML", e);
        }
    }

    public void write(CustomerXml customer, OutputStream out) {
        try {
            Marshaller marshaller = context.createMarshaller();
            marshaller.setProperty(Marshaller.JAXB_ENCODING, "UTF-8");
            marshaller.marshal(customer, out);
        } catch (JAXBException e) {
            throw new XmlCodecException("Failed to marshal customer XML", e);
        }
    }
}
```

### 16.4 Pooling marshaller/unmarshaller

Pooling bisa berguna jika profiling membuktikan creation cost signifikan. Namun pooling membawa risiko:

- property lama bocor ke request berikutnya;
- adapter/listener/schema/event handler tertinggal;
- thread-safety bug;
- pool exhaustion;
- complexity lebih tinggi.

Default yang baik:

```text
Cache JAXBContext.
Create Marshaller/Unmarshaller per operation.
Optimize hanya berdasarkan profiling.
```

---

## 17. Error Handling: Jangan Bocorkan Detail Mentah

### 17.1 Error taxonomy

JAXB failure bisa dibagi:

| Error | Contoh | Treatment |
|---|---|---|
| Malformed XML | tag tidak tertutup | reject 400/bad input |
| Invalid schema | required element missing | reject with contract error |
| Binding mismatch | unexpected element namespace | integration error atau version mismatch |
| Security violation | DTD/external entity blocked | reject + security log |
| Business invalid | amount negatif | domain validation error |
| Internal mapping bug | adapter gagal | 500/internal + alert |

### 17.2 Jangan return stack trace ke external caller

Buruk:

```json
{
  "error": "jakarta.xml.bind.UnmarshalException: unexpected element..."
}
```

Lebih baik:

```json
{
  "code": "INVALID_XML_CONTRACT",
  "message": "Submitted XML does not match the expected customer contract.",
  "correlationId": "..."
}
```

Internal log boleh menyimpan detail teknis, dengan sanitization.

### 17.3 Preserve raw input?

Untuk audit/regulatory system, kadang perlu menyimpan raw XML. Tetapi raw XML bisa mengandung PII/secret/entity payload. Policy harus jelas:

- simpan encrypted at rest;
- redact sensitive fields bila perlu;
- simpan hash/canonical digest untuk integrity;
- jangan log raw XML sembarangan;
- retention sesuai policy;
- akses terbatas.

---

## 18. Binding Model dan Domain Boundary

### 18.1 Tiga model yang harus dipisah

Untuk enterprise system, bedakan:

```text
XML DTO / generated JAXB model
    ↓ mapping + validation
Application command/query DTO
    ↓ use case orchestration
Domain model / aggregate / entity
```

Menggabungkan semuanya menjadi satu class terlihat hemat di awal, tetapi mahal saat contract berubah.

### 18.2 Kenapa domain model tidak ideal untuk JAXB?

Karena domain model biasanya butuh:

- invariants;
- rich types;
- immutability;
- behavior;
- lifecycle methods;
- encapsulation;
- lazy-loading/proxy avoidance;
- persistence independence.

JAXB model biasanya butuh:

- no-arg constructor;
- mutable fields/properties;
- XML-specific names;
- XML-specific optionality;
- namespace metadata;
- generated structure.

Dua gaya ini bertentangan.

### 18.3 Anti-corruption mapping

Contoh mapping:

```java
public final class CustomerXmlMapper {
    public CustomerRegistrationCommand toCommand(CustomerXml xml) {
        return new CustomerRegistrationCommand(
            CustomerId.parse(xml.getId()),
            PersonName.of(xml.getName())
        );
    }
}
```

Di sinilah business semantics diperbaiki:

- trim/normalize;
- code list validation;
- timezone conversion;
- amount/currency conversion;
- defaulting eksplisit;
- null/absent handling;
- version mapping.

---

## 19. XML Optionality: null, absent, empty, nil

### 19.1 Empat keadaan berbeda

Dalam XML, nilai “tidak ada” tidak selalu satu bentuk.

| Bentuk XML | Makna potensial |
|---|---|
| element absent | tidak dikirim / optional |
| `<name/>` | element ada, string kosong atau no content |
| `<name></name>` | element ada, empty content |
| `<name xsi:nil="true"/>` | eksplisit nil/null jika nillable |

Dalam Java, semuanya sering jatuh menjadi `null` atau `""`, padahal semantics berbeda.

### 19.2 Ini krusial untuk PATCH/update

Jika XML dipakai untuk update:

```text
absent = jangan ubah field
xsi:nil = clear field
empty string = set to empty string
value = set value
```

Jika binding model tidak membedakan ini, update bisa merusak data.

### 19.3 JAXB default tidak selalu cukup

Untuk kasus partial update, pertimbangkan:

- `JAXBElement<T>` untuk membedakan presence;
- custom adapter;
- wrapper field dengan explicit presence flag;
- StAX pre-processing;
- contract design yang menghindari ambiguity.

Detail lanjut dibahas di Part 20.

---

## 20. Collection dan Cardinality

### 20.1 XML cardinality vs Java collection

XSD:

```xml
<xs:element name="item" type="ItemType" minOccurs="0" maxOccurs="unbounded"/>
```

Java:

```java
private List<ItemXml> item;
```

Generated JAXB sering memakai live list:

```java
public List<ItemXml> getItem() {
    if (item == null) {
        item = new ArrayList<>();
    }
    return this.item;
}
```

### 20.2 Live list pattern

Live list berarti tidak ada setter, dan caller memodifikasi list langsung:

```java
order.getItem().add(new ItemXml());
```

Ini terasa aneh, tetapi umum pada generated JAXB.

Kelebihan:

- menghindari replace list;
- sesuai JAXB generated style;
- mempermudah marshal.

Kekurangan:

- mutable exposure;
- domain-unfriendly;
- raw list bisa dimodifikasi sembarang;
- perlu mapping ke immutable domain collection.

### 20.3 Empty list vs absent list

`minOccurs=0 maxOccurs=unbounded` bisa berarti:

```text
tidak ada item element
```

atau:

```text
ada wrapper element kosong
```

bergantung desain XML. Jangan asumsikan list kosong dan absent selalu sama secara contract.

---

## 21. Dates, Numbers, and Lexical Forms

### 21.1 XML Schema types tidak selalu sama dengan Java types

XSD punya tipe seperti:

- `xs:string`
- `xs:int`
- `xs:long`
- `xs:decimal`
- `xs:boolean`
- `xs:date`
- `xs:dateTime`
- `xs:duration`
- `xs:base64Binary`
- `xs:anyURI`

JAXB mapping bisa memakai:

- `String`
- primitive/wrapper;
- `BigInteger`;
- `BigDecimal`;
- `XMLGregorianCalendar`;
- `Duration`;
- `byte[]`.

### 21.2 `XMLGregorianCalendar`

Banyak generated JAXB model memakai `XMLGregorianCalendar` untuk `xs:date`/`xs:dateTime`.

Developer modern sering ingin `LocalDate`, `OffsetDateTime`, atau `Instant`. Untuk itu biasanya perlu `XmlAdapter`.

Jangan mapping tanggal sembarangan karena XML Schema date/time punya timezone semantics yang tidak identik dengan Java Time API.

### 21.3 Decimal precision

Untuk monetary/regulated amount, gunakan `BigDecimal`, bukan `double`.

Buruk:

```java
private double amount;
```

Lebih baik:

```java
private BigDecimal amount;
```

Tetapi `BigDecimal` juga perlu scale/rounding validation di business layer.

### 21.4 Lexical form matters sometimes

XML value:

```xml
<amount>1.0</amount>
```

and:

```xml
<amount>1.00</amount>
```

bisa numerically equal tetapi lexically different. Jika partner/regulator membutuhkan exact scale, validasi lexical/format harus eksplisit.

---

## 22. JAXB in SOAP Context

### 22.1 SOAP payload memakai XML Binding

Pada JAX-WS/Jakarta XML Web Services, SOAP body umumnya dipetakan ke Java object menggunakan JAXB/XML Binding.

Mental model:

```text
WSDL/XSD
  → generated service interface + JAXB classes
  → SOAP runtime
  → XML Binding for body payload
```

Karena itu, memahami JAXB adalah prerequisite untuk memahami SOAP modern/legacy di Java.

### 22.2 Kesalahan JAXB menjadi kesalahan SOAP

Jika namespace JAXB salah, SOAP error bisa muncul sebagai:

- unexpected element;
- cannot find dispatch method;
- unmarshalling error;
- invalid payload;
- SOAP fault dari provider;
- HTTP 500 tanpa detail jelas.

Root cause sering bukan transport, tetapi binding mismatch.

### 22.3 Jangan debug SOAP hanya dari Java class

Untuk SOAP, selalu lihat:

```text
WSDL
XSD
actual SOAP envelope
generated JAXB class
runtime binding config
```

Top engineer debug dari wire contract, bukan hanya dari stack trace Java.

---

## 23. Testing Strategy for JAXB Core

### 23.1 Round-trip test

Round-trip test:

```text
Java object → XML → Java object
```

Contoh:

```java
@Test
void shouldRoundTripCustomerXml() throws Exception {
    CustomerXml original = new CustomerXml("C001", "Alice");

    ByteArrayOutputStream out = new ByteArrayOutputStream();
    marshaller.marshal(original, out);

    CustomerXml parsed = (CustomerXml) unmarshaller.unmarshal(
        new ByteArrayInputStream(out.toByteArray())
    );

    assertEquals("C001", parsed.getId());
    assertEquals("Alice", parsed.getName());
}
```

Round-trip berguna, tetapi tidak cukup.

### 23.2 Golden file test

Golden file test membandingkan output dengan XML contoh yang disetujui.

```text
expected/customer-valid-v1.xml
```

Test:

```java
String actual = marshalToString(customer);
assertXmlEquivalent(expectedXml, actual);
```

Jangan pakai string equality mentah untuk XML namespace-aware kecuali memang contract legacy membutuhkan exact lexical output.

### 23.3 Schema validation test

Pastikan output valid terhadap XSD:

```java
Validator validator = schema.newValidator();
validator.validate(new StreamSource(new StringReader(xml)));
```

### 23.4 Negative test

Test invalid XML:

- missing required element;
- wrong namespace;
- invalid date;
- invalid enum/code;
- unexpected root;
- DTD/external entity attempt;
- oversized input;
- duplicate/ambiguous content if relevant.

### 23.5 Contract compatibility test

Saat XSD berubah, test harus menjawab:

```text
Apakah XML lama masih bisa dibaca?
Apakah XML baru ditolak oleh consumer lama?
Apakah field baru optional?
Apakah namespace version berubah?
Apakah generated classes berubah breaking?
```

---

## 24. Common Production Bugs

### 24.1 `ClassNotFoundException: javax.xml.bind.JAXBContext`

Biasanya terjadi saat migrasi ke Java 11+ tanpa dependency JAXB eksplisit.

Fix:

- tambahkan API + runtime dependency;
- pastikan namespace sesuai `javax` atau `jakarta`;
- jangan mengandalkan JDK menyediakan JAXB.

### 24.2 `unexpected element`

Contoh:

```text
unexpected element (uri:"urn:example:v1", local:"customer"). Expected elements are <{}customer>
```

Artinya binding mengharapkan no namespace, tetapi XML memakai namespace.

Fix:

- cek `@XmlRootElement(namespace=...)`;
- cek `package-info.java`;
- cek `elementFormDefault`;
- cek generated class dari XSD yang benar.

### 24.3 Field null setelah unmarshal

Penyebab umum:

- namespace field salah;
- element name salah;
- accessor type salah;
- field tidak visible;
- getter/setter conflict;
- XML pakai wrapper element;
- schema version beda.

### 24.4 `JAXBException: class nor any of its super class is known to this context`

Artinya class yang dimarshal/unmarshal tidak masuk ke `JAXBContext`.

Fix:

- tambahkan class ke `newInstance(...)`;
- gunakan package context yang benar;
- tambahkan `@XmlSeeAlso` bila relevan;
- gunakan `JAXBElement` untuk root/type tertentu.

### 24.5 Namespace prefix tidak sesuai harapan partner

Secara XML namespace semantics, prefix alias tidak penting. Namun partner legacy kadang string-compare.

Solusi:

- negosiasi bahwa namespace-aware parser harus dipakai;
- jika tidak bisa, gunakan provider-specific namespace prefix mapper;
- dokumentasikan sebagai interoperability workaround;
- tambahkan golden lexical test jika benar-benar wajib.

### 24.6 Marshaller/Unmarshaller shared antar thread

Gejala:

- output random;
- property bocor;
- intermittent exception;
- validation schema salah request;
- listener/adapters state leak.

Fix:

- cache context saja;
- create marshaller/unmarshaller per operation;
- atau pool dengan reset ketat.

### 24.7 Silent acceptance of bad input

Gejala:

- XML invalid secara contract tetapi tetap menjadi object sebagian;
- field null tetapi proses lanjut;
- downstream NPE atau business corruption.

Fix:

- schema validation;
- strict event handler;
- explicit null/business validation;
- reject unknown version/root/namespace.

---

## 25. Production-Grade XML Codec Pattern

Berikut pattern reusable untuk boundary service.

```java
public final class XmlCodec<T> {
    private final JAXBContext context;
    private final Class<T> type;
    private final Schema schema;

    public XmlCodec(Class<T> type, Schema schema) {
        this.type = Objects.requireNonNull(type, "type");
        this.schema = schema;
        try {
            this.context = JAXBContext.newInstance(type);
        } catch (JAXBException e) {
            throw new IllegalStateException("Failed to initialize JAXB context for " + type.getName(), e);
        }
    }

    public T read(InputStream input) {
        Objects.requireNonNull(input, "input");
        try {
            XMLInputFactory inputFactory = XMLInputFactory.newFactory();
            inputFactory.setProperty(XMLInputFactory.SUPPORT_DTD, false);
            inputFactory.setProperty("javax.xml.stream.isSupportingExternalEntities", false);
            inputFactory.setProperty(XMLInputFactory.IS_REPLACING_ENTITY_REFERENCES, false);

            XMLStreamReader reader = inputFactory.createXMLStreamReader(input);

            Unmarshaller unmarshaller = context.createUnmarshaller();
            if (schema != null) {
                unmarshaller.setSchema(schema);
            }
            unmarshaller.setEventHandler(event -> false);

            JAXBElement<T> root = unmarshaller.unmarshal(reader, type);
            return root.getValue();
        } catch (XMLStreamException e) {
            throw new InvalidXmlException("Malformed or unsafe XML input", e);
        } catch (JAXBException e) {
            throw new InvalidXmlContractException("XML does not match expected contract", e);
        }
    }

    public void write(T value, OutputStream output) {
        Objects.requireNonNull(value, "value");
        Objects.requireNonNull(output, "output");
        try {
            Marshaller marshaller = context.createMarshaller();
            marshaller.setProperty(Marshaller.JAXB_ENCODING, "UTF-8");
            marshaller.setProperty(Marshaller.JAXB_FORMATTED_OUTPUT, Boolean.FALSE);
            marshaller.marshal(value, output);
        } catch (JAXBException e) {
            throw new XmlWriteException("Failed to write XML output", e);
        }
    }
}
```

Catatan:

- ini skeleton, bukan drop-in final untuk semua kasus;
- property StAX bisa provider-dependent;
- schema loading harus secure;
- input size limit perlu di layer sebelum `InputStream`;
- error class harus disesuaikan aplikasi;
- untuk class dengan `@XmlRootElement`, cast langsung bisa cukup;
- untuk generated class tanpa root, typed `JAXBElement` lebih aman.

---

## 26. Observability untuk XML Binding

### 26.1 Apa yang perlu dilog?

Log:

- contract name;
- contract version;
- root QName;
- correlation ID;
- source system;
- payload size;
- validation result;
- error category;
- processing duration.

Jangan default log raw XML.

Contoh structured log:

```json
{
  "event": "xml_unmarshal_failed",
  "contract": "customer-submission",
  "version": "v1",
  "rootQName": "{urn:example:customer:v1}customer",
  "sourceSystem": "partner-a",
  "payloadSizeBytes": 18421,
  "errorCategory": "SCHEMA_VALIDATION",
  "correlationId": "abc-123"
}
```

### 26.2 Metrics

Metrics penting:

- count XML received/sent;
- unmarshal failure rate;
- schema validation failure rate;
- average/p95/p99 marshal/unmarshal duration;
- payload size distribution;
- top failing source system;
- top failing contract version;
- rejected unsafe XML count.

### 26.3 Tracing

Dalam distributed system:

```text
HTTP/SOAP/file receiver
  → XML parse/unmarshal span
  → validation span
  → mapping span
  → domain processing span
  → output marshal span
```

Jangan masukkan raw XML ke trace attributes.

---

## 27. Migration Strategy: Javax to Jakarta

### 27.1 Dua migration berbeda

Ada dua migration yang sering tercampur:

```text
JDK migration:
Java 8 → Java 11/17/21/25
```

and:

```text
API namespace migration:
javax.xml.bind → jakarta.xml.bind
```

Keduanya tidak harus dilakukan sekaligus.

### 27.2 Safer staged migration

Untuk aplikasi legacy besar:

```text
Stage 1:
Java 8 + javax, pastikan dependency eksplisit.

Stage 2:
Java 11/17 + javax JAXB 2.x dependency eksplisit.
Semua test XML/SOAP hijau.

Stage 3:
Upgrade surrounding framework/container.

Stage 4:
Migrate source import javax → jakarta.
Upgrade JAXB/Jakarta XML Binding runtime.

Stage 5:
Regenerate generated classes bila perlu.
Run contract/golden/schema tests.
```

### 27.3 Jangan big bang tanpa contract tests

Big bang berisiko karena:

- generated code berubah;
- package berubah;
- app server provider berubah;
- SOAP stack berubah;
- namespace prefix output bisa berubah;
- date/time adapter behavior bisa berubah;
- module/classpath behavior berubah.

Minimum safety net:

- sample XML from production/partner;
- golden output tests;
- XSD validation;
- SOAP mock server/client tests;
- XXE/security regression tests;
- performance baseline.

---

## 28. Design Heuristics Top 1% Engineer

### 28.1 Treat XML as external law, not internal convenience

Jika XML datang dari luar, jangan ubah contract hanya agar Java class terlihat cantik.

### 28.2 Keep generated classes boring

Generated JAXB classes tidak perlu indah. Mereka perlu akurat terhadap contract.

### 28.3 Do not leak JAXB model into domain

Boundary model boleh mutable dan XML-shaped. Domain model harus invariant-shaped.

### 28.4 Cache context, not mutable workers

`JAXBContext` mahal dan reusable. `Marshaller`/`Unmarshaller` sebaiknya short-lived.

### 28.5 Validate at the right layer

- XML well-formedness: parser.
- Contract grammar: XSD.
- Mapping: JAXB.
- Business rule: application/domain validation.
- Authorization: service boundary.

### 28.6 Namespace bugs are contract bugs

Saat field null atau unexpected element, cek namespace sebelum menyalahkan parser.

### 28.7 Signed XML is a different beast

Jangan marshal ulang signed XML tanpa memahami canonicalization/signature impact.

### 28.8 Migration needs wire-level regression

Java 8 → 17 atau javax → jakarta tidak cukup diuji dengan unit test object. Harus ada XML wire contract regression.

---

## 29. Checklist Praktis

### 29.1 Saat membuat JAXB model baru

- [ ] Apakah XML contract external atau internal?
- [ ] Apakah ada XSD?
- [ ] Apakah schema-first lebih tepat?
- [ ] Apakah class ini boundary DTO, bukan domain entity?
- [ ] Apakah namespace jelas?
- [ ] Apakah `package-info.java` dibutuhkan?
- [ ] Apakah root element jelas?
- [ ] Apakah optional/nillable semantics jelas?
- [ ] Apakah date/decimal mapping aman?
- [ ] Apakah collection cardinality sesuai XSD?

### 29.2 Saat membaca XML

- [ ] Ada input size limit?
- [ ] Parser aman dari DTD/external entity?
- [ ] XSD validation diperlukan?
- [ ] Error handling membedakan malformed/schema/business?
- [ ] Raw XML tidak dilog sembarangan?
- [ ] Mapping ke domain melewati anti-corruption layer?
- [ ] Null/absent dicek eksplisit?

### 29.3 Saat menulis XML

- [ ] Output namespace valid?
- [ ] Encoding benar?
- [ ] XML declaration sesuai kebutuhan partner?
- [ ] Output valid terhadap XSD?
- [ ] Prefix requirement partner ada?
- [ ] Signed/canonical XML tidak rusak?
- [ ] Golden file test tersedia?

### 29.4 Saat migrasi Java/Jakarta

- [ ] Dependency JAXB eksplisit?
- [ ] Tidak campur `javax` dan `jakarta`?
- [ ] Generated sources diregenerate jika perlu?
- [ ] App server menyediakan provider atau app membawa provider sendiri?
- [ ] Contract tests hijau?
- [ ] SOAP integration tests hijau?
- [ ] Security regression test hijau?

---

## 30. Mini Case Study: Regulator Submission XML

### 30.1 Context

Sebuah sistem case management harus mengirim submission XML ke regulator.

Regulator memberikan:

- `submission-v1.xsd`;
- contoh XML valid;
- daftar code list;
- requirement file harus UTF-8;
- response berupa XML acknowledgement.

### 30.2 Desain buruk

```text
Domain Case entity diberi JAXB annotations.
Service langsung marshal Case entity.
Output tidak divalidasi XSD.
Raw XML dilog full.
Saat regulator menambah optional field, domain class ikut berubah.
```

Masalah:

- domain tercemar external contract;
- PII bocor di log;
- contract drift tidak terdeteksi;
- output invalid baru diketahui setelah ditolak regulator;
- migration sulit.

### 30.3 Desain lebih sehat

```text
XSD → generated SubmissionXml classes
Domain Case → SubmissionXmlMapper → SubmissionXml
SubmissionXml → marshal
Generated XML → validate against XSD
Store encrypted raw outbound XML + hash
Send to regulator
Receive ack XML → secure parse → unmarshal → validate → map to AckResult
```

### 30.4 Failure modeling

| Failure | Mitigasi |
|---|---|
| XSD changed | contract versioning + generated code diff + compatibility tests |
| invalid output | validate before send |
| regulator rejects prefix | golden lexical test/provider prefix mapper if unavoidable |
| large attachment | separate binary/MTOM/file transfer strategy |
| PII in XML | encrypted storage + redacted logs |
| Java upgrade breaks JAXB | explicit dependencies + regression test |
| namespace mismatch | schema-first generation + QName assertions |

---

## 31. Latihan Mandiri

### Latihan 1 — Basic marshal/unmarshal

Buat class `InvoiceXml` dengan:

- namespace `urn:example:invoice:v1`;
- root element `invoice`;
- field `invoiceNumber`;
- field `issueDate`;
- field `totalAmount`;
- list `lineItem`.

Lakukan:

1. marshal ke XML;
2. unmarshal kembali;
3. validasi hasil field;
4. cek namespace output.

### Latihan 2 — Namespace bug

Buat XML dengan namespace salah lalu unmarshal. Amati error atau field null. Perbaiki dengan `package-info.java`.

### Latihan 3 — Schema validation

Buat XSD sederhana untuk invoice. Attach schema ke unmarshaller. Coba XML invalid.

### Latihan 4 — Secure unmarshal

Coba XML dengan DTD/entity. Pastikan parser menolak. Jangan menjalankan payload external network sungguhan; gunakan test terkontrol.

### Latihan 5 — Boundary mapping

Map `InvoiceXml` ke `CreateInvoiceCommand`. Jangan gunakan `InvoiceXml` sebagai domain entity.

---

## 32. Ringkasan Part 16

Pada part ini kita membangun core mental model JAXB/Jakarta XML Binding:

1. XML Binding adalah bridge antara XML document dan Java object graph.
2. JAXB lama memakai `javax.xml.bind`; Jakarta XML Binding modern memakai `jakarta.xml.bind`.
3. Java 11+ tidak lagi menyediakan JAXB dari JDK, sehingga dependency harus eksplisit.
4. `JAXBContext` adalah entry point dan metadata runtime yang mahal; cache/reuse context.
5. `Marshaller` dan `Unmarshaller` adalah worker object; jangan share sembarangan antar thread.
6. Binding, XSD validation, dan business validation adalah tiga hal berbeda.
7. Namespace adalah pusat kontrak XML; prefix hanya alias, URI adalah identitas.
8. Generated JAXB model cocok sebagai boundary model, bukan domain model.
9. Secure XML parsing tetap wajib walau memakai JAXB.
10. Migration Javax→Jakarta harus dilakukan dengan contract tests, bukan sekadar search-replace import.

---

## 33. Koneksi ke Part Berikutnya

Part 17 akan membahas annotation JAXB/Jakarta XML Binding secara detail:

- `@XmlRootElement`
- `@XmlType`
- `@XmlAccessorType`
- `@XmlElement`
- `@XmlAttribute`
- `@XmlValue`
- `@XmlTransient`
- `@XmlAnyElement`
- `@XmlElementWrapper`
- `@XmlSchema`
- namespace/package-level mapping
- ordering
- required/nillable
- mixed content dan wildcard dasar

Part 16 memberi fondasi runtime. Part 17 akan memberi kontrol mapping.

---

## 34. Referensi Resmi dan Lanjutan

- Jakarta XML Binding specification: https://jakarta.ee/specifications/xml-binding/
- Jakarta XML Binding 4.0: https://jakarta.ee/specifications/xml-binding/4.0/
- Jakarta XML Binding API docs: https://jakarta.ee/specifications/xml-binding/4.0/apidocs/
- `JAXBContext` API docs: https://jakarta.ee/specifications/xml-binding/3.0/apidocs/jakarta.xml.bind/jakarta/xml/bind/jaxbcontext
- `Unmarshaller` API docs: https://jakarta.ee/specifications/xml-binding/4.0/apidocs/jakarta.xml.bind/jakarta/xml/bind/unmarshaller
- Eclipse JAXB RI documentation: https://eclipse-ee4j.github.io/jaxb-ri/
- OpenJDK JEP 320, removal of Java EE and CORBA modules: https://openjdk.org/jeps/320
- Oracle JAXP Security Guide: https://docs.oracle.com/en/java/javase/24/security/java-api-xml-processing-jaxp-security-guide.html
- W3C XML Schema: https://www.w3.org/XML/Schema
- W3C XML Namespaces: https://www.w3.org/TR/xml-names/

---

## 35. Status Seri

Seri belum selesai.  
Part ini adalah **Part 16 dari 34**.  
Part berikutnya: **Part 17 — JAXB Annotation Deep Dive**.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 15 — XML Security](./learn-java-json-xml-soap-connectors-enterprise-integration-part-015.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 17 — JAXB / Jakarta XML Binding Annotation Deep Dive](./learn-java-json-xml-soap-connectors-enterprise-integration-part-017.md)
