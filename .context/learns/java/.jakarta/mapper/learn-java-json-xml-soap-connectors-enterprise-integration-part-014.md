# Part 14 — XML Schema / XSD Deep Dive

Series: `learn-java-json-xml-soap-connectors-enterprise-integration`  
File: `learn-java-json-xml-soap-connectors-enterprise-integration-part-014.md`  
Target: Java 8 sampai Java 25  
Status: Part 14 dari 34

---

## 0. Posisi Part Ini dalam Series

Di Part 12 kita membangun fondasi XML sebagai model informasi: element, attribute, namespace, QName, text node, entity, encoding, dan mixed content. Di Part 13 kita membahas cara Java membaca XML melalui DOM, SAX, StAX, XPath, dan XSLT.

Part ini membahas **XML Schema Definition / XSD**.

XSD bukan parser. XSD bukan sekadar “file validasi”. XSD adalah **bahasa kontrak formal** untuk mendefinisikan bentuk dokumen XML yang dianggap valid. Dalam sistem enterprise, XSD sering menjadi pusat dari:

- WSDL/SOAP contract.
- JAXB/Jakarta XML Binding model generation.
- message validation di integration gateway.
- B2B file exchange.
- regulatory reporting.
- batch import/export.
- anti-corruption layer antara sistem modern dan sistem legacy.
- compatibility governance antar organisasi.

Mental model utamanya:

```text
XML instance document
        |
        | checked against
        v
XSD schema set
        |
        | defines vocabulary, structure, type constraints
        v
Contract-valid XML message
        |
        | bound/generated/validated by Java runtime
        v
Application boundary object / integration event / SOAP payload
```

Dalam JSON, banyak sistem mengandalkan convention atau OpenAPI/JSON Schema. Dalam XML/SOAP enterprise, XSD jauh lebih sering menjadi **source of truth**. Karena itu engineer yang kuat harus bisa membaca XSD bukan hanya sebagai syntax, tetapi sebagai **evolvable contract**.

---

## 1. Apa Itu XSD secara Konseptual?

XML Schema Definition adalah bahasa berbasis XML untuk mendefinisikan:

1. elemen apa yang boleh muncul,
2. atribut apa yang boleh ada,
3. urutan elemen,
4. cardinality,
5. tipe data,
6. namespace,
7. constraint nilai,
8. hubungan antar tipe,
9. kemungkinan extensibility,
10. aturan validasi dokumen XML.

Contoh XML instance:

```xml
<customer xmlns="https://example.com/customer/v1">
    <id>CUST-001</id>
    <name>Fajar</name>
    <status>ACTIVE</status>
</customer>
```

XSD-nya bisa seperti ini:

```xml
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
           targetNamespace="https://example.com/customer/v1"
           xmlns="https://example.com/customer/v1"
           elementFormDefault="qualified">

    <xs:element name="customer" type="CustomerType"/>

    <xs:complexType name="CustomerType">
        <xs:sequence>
            <xs:element name="id" type="CustomerIdType"/>
            <xs:element name="name" type="xs:string"/>
            <xs:element name="status" type="CustomerStatusType"/>
        </xs:sequence>
    </xs:complexType>

    <xs:simpleType name="CustomerIdType">
        <xs:restriction base="xs:string">
            <xs:pattern value="CUST-[0-9]{3}"/>
        </xs:restriction>
    </xs:simpleType>

    <xs:simpleType name="CustomerStatusType">
        <xs:restriction base="xs:string">
            <xs:enumeration value="ACTIVE"/>
            <xs:enumeration value="SUSPENDED"/>
            <xs:enumeration value="CLOSED"/>
        </xs:restriction>
    </xs:simpleType>
</xs:schema>
```

Yang perlu dilihat bukan hanya syntax-nya. Kontrak di atas mengatakan:

```text
customer harus berada di namespace https://example.com/customer/v1
customer harus berisi id, name, status dalam urutan itu
id harus string dengan format CUST-xxx
status hanya boleh ACTIVE, SUSPENDED, CLOSED
```

Ini berarti XSD adalah gabungan dari:

- vocabulary contract,
- structural contract,
- data type contract,
- validation contract,
- integration compatibility contract.

---

## 2. XSD Bukan DTD

Sebelum XSD, XML banyak divalidasi dengan DTD. DTD masih muncul pada sistem lama, tetapi untuk enterprise integration modern, XSD jauh lebih ekspresif.

| Aspek | DTD | XSD |
|---|---|---|
| Syntax | non-XML syntax | XML syntax |
| Namespace support | lemah | kuat |
| Tipe data | sangat terbatas | kaya: string, decimal, dateTime, boolean, dll. |
| Constraint nilai | terbatas | enumeration, pattern, min/max, length, fractionDigits, dll. |
| Reuse tipe | terbatas | simpleType, complexType, group, attributeGroup |
| SOAP/WSDL usage | jarang sebagai contract utama | sangat umum |
| Java binding | tidak sekuat XSD | sangat erat dengan JAXB/Jakarta XML Binding |

Dalam sistem legacy, DTD juga sering menjadi sumber risiko security seperti XXE dan entity expansion. XSD bukan berarti otomatis aman, tetapi XSD memberi model kontrak yang lebih cocok untuk sistem enterprise typed integration.

---

## 3. Mental Model: XSD Schema Set, Bukan Satu File

Kesalahan umum engineer adalah menganggap satu file `.xsd` = satu schema. Dalam praktik enterprise, schema biasanya adalah **schema set**:

```text
customer.xsd
    imports common-types.xsd
    imports address.xsd
    includes customer-internal-types.xsd

common-types.xsd
    defines MoneyType, CodeType, AuditHeaderType

address.xsd
    defines AddressType
```

Schema validator tidak hanya membaca satu file, tetapi membangun grammar dari banyak schema document.

Konsekuensi praktis:

- relative path import bisa rusak saat deploy ke JAR/container.
- schema location dari partner tidak boleh dipercaya mentah-mentah.
- namespace harus stabil.
- build harus punya offline schema catalog.
- generated JAXB classes bisa berubah karena satu common XSD berubah.
- circular import/include bisa menciptakan masalah tooling.

Mental model:

```text
XSD document        = satu file fisik
schema component   = element/type/attribute/group yang didefinisikan
schema set         = kumpulan schema components dari banyak XSD document
validation grammar = hasil kompilasi schema set oleh SchemaFactory
```

Di Java, representasi runtime grammar biasanya menjadi `javax.xml.validation.Schema`.

---

## 4. Komponen Utama XSD

XSD punya banyak konsep, tetapi fondasinya bisa dipetakan seperti ini:

```text
xs:schema
├── namespace configuration
├── global element declarations
├── global attribute declarations
├── simple type definitions
├── complex type definitions
├── model groups
├── attribute groups
├── identity constraints
└── import/include/redefine/override
```

Untuk practical enterprise work, yang paling sering harus dikuasai:

1. `xs:element`
2. `xs:attribute`
3. `xs:simpleType`
4. `xs:complexType`
5. `xs:sequence`
6. `xs:choice`
7. `xs:all`
8. `minOccurs` / `maxOccurs`
9. `nillable`
10. `targetNamespace`
11. `elementFormDefault`
12. `xs:import`
13. `xs:include`
14. `xs:restriction`
15. `xs:extension`
16. `xs:any` / `xs:anyAttribute`
17. `xs:key`, `xs:keyref`, `xs:unique`

---

## 5. `xs:schema`: Root Kontrak

Setiap XSD document memiliki root `xs:schema`.

```xml
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
           targetNamespace="https://example.com/customer/v1"
           xmlns="https://example.com/customer/v1"
           elementFormDefault="qualified"
           attributeFormDefault="unqualified">
    ...
</xs:schema>
```

Atribut penting:

| Atribut | Fungsi |
|---|---|
| `xmlns:xs` | Prefix untuk XSD language. Umumnya `http://www.w3.org/2001/XMLSchema`. |
| `targetNamespace` | Namespace untuk komponen yang didefinisikan XSD ini. |
| default `xmlns` | Namespace default untuk referensi lokal dalam schema document. |
| `elementFormDefault` | Apakah local element harus namespace-qualified. |
| `attributeFormDefault` | Apakah local attribute harus namespace-qualified. |

### 5.1 `targetNamespace`

`targetNamespace` adalah namespace tempat schema mendefinisikan vocabulary.

```xml
targetNamespace="https://example.com/customer/v1"
```

Artinya element global seperti:

```xml
<xs:element name="customer" type="CustomerType"/>
```

mendeklarasikan element:

```text
{https://example.com/customer/v1}customer
```

Bukan sekadar nama lokal `customer`.

Di XML, nama element secara konseptual adalah QName:

```text
namespace URI + local name
```

Bukan prefix.

Prefix hanya syntax document. Namespace URI adalah identitas sebenarnya.

---

## 6. Namespace dalam XSD: Bagian yang Paling Sering Salah

Pertimbangkan XSD ini:

```xml
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
           targetNamespace="https://example.com/order/v1"
           xmlns:ord="https://example.com/order/v1"
           elementFormDefault="qualified">

    <xs:element name="order" type="ord:OrderType"/>

    <xs:complexType name="OrderType">
        <xs:sequence>
            <xs:element name="id" type="xs:string"/>
            <xs:element name="amount" type="xs:decimal"/>
        </xs:sequence>
    </xs:complexType>
</xs:schema>
```

Karena `elementFormDefault="qualified"`, XML valid harus seperti:

```xml
<ord:order xmlns:ord="https://example.com/order/v1">
    <ord:id>ORD-001</ord:id>
    <ord:amount>100.50</ord:amount>
</ord:order>
```

Atau dengan default namespace:

```xml
<order xmlns="https://example.com/order/v1">
    <id>ORD-001</id>
    <amount>100.50</amount>
</order>
```

Tetapi ini tidak valid terhadap schema qualified:

```xml
<order xmlns="https://example.com/order/v1">
    <id xmlns="">ORD-001</id>
    <amount xmlns="">100.50</amount>
</order>
```

Karena `id` dan `amount` berada di empty namespace.

### 6.1 Rule of Thumb

Untuk enterprise XML/SOAP, default yang lebih aman:

```xml
 elementFormDefault="qualified"
 attributeFormDefault="unqualified"
```

Kenapa?

- SOAP/WSDL interop biasanya mengharapkan element namespace-qualified.
- XML payload lebih eksplisit.
- Local element collision lebih sedikit.
- JAXB code generation lebih predictable.
- Attribute dalam XML tradition sering unqualified kecuali memang punya semantic namespace sendiri.

---

## 7. Global Element vs Local Element

XSD membedakan **global element declaration** dan **local element declaration**.

Global element:

```xml
<xs:schema ...>
    <xs:element name="customer" type="CustomerType"/>
</xs:schema>
```

Local element:

```xml
<xs:complexType name="CustomerType">
    <xs:sequence>
        <xs:element name="id" type="xs:string"/>
    </xs:sequence>
</xs:complexType>
```

Global element bisa menjadi root document dan bisa direferensikan:

```xml
<xs:element ref="customer"/>
```

Local element hanya berlaku di posisi lokal tempat ia dideklarasikan.

### 7.1 Design Implication

Ada dua gaya desain XSD umum:

#### Venetian Blind

Banyak menggunakan named global types, tetapi element lokal.

```xml
<xs:element name="customer" type="CustomerType"/>

<xs:complexType name="CustomerType">
    <xs:sequence>
        <xs:element name="id" type="CustomerIdType"/>
    </xs:sequence>
</xs:complexType>
```

Keuntungan:

- type reusable.
- generated code biasanya lebih bersih.
- root elements terkontrol.

Kerugian:

- local element tidak bisa mudah direferensikan dari tempat lain.

#### Russian Doll

Semua didefinisikan nested di dalam root element.

```xml
<xs:element name="customer">
    <xs:complexType>
        <xs:sequence>
            <xs:element name="id" type="xs:string"/>
        </xs:sequence>
    </xs:complexType>
</xs:element>
```

Keuntungan:

- mudah dibaca untuk schema kecil.
- encapsulated.

Kerugian:

- reuse rendah.
- generated class bisa kurang stabil.
- schema besar menjadi sulit dimaintain.

#### Garden of Eden

Semua element dan type global.

```xml
<xs:element name="customer" type="CustomerType"/>
<xs:element name="id" type="CustomerIdType"/>
```

Keuntungan:

- reuse tinggi.
- semua bisa direferensikan.

Kerugian:

- namespace penuh global declarations.
- collision dan ambiguity lebih tinggi.
- kontrak bisa terlalu permissive.

Untuk enterprise contract besar, gaya yang sering seimbang adalah **Venetian Blind**.

---

## 8. Simple Type: Constraint pada Nilai Atomik

`xs:simpleType` digunakan untuk nilai yang tidak memiliki child element atau attribute sendiri.

Contoh:

```xml
<xs:simpleType name="PostalCodeType">
    <xs:restriction base="xs:string">
        <xs:pattern value="[0-9]{6}"/>
    </xs:restriction>
</xs:simpleType>
```

Digunakan oleh element:

```xml
<xs:element name="postalCode" type="PostalCodeType"/>
```

Valid:

```xml
<postalCode>123456</postalCode>
```

Invalid:

```xml
<postalCode>ABC123</postalCode>
```

### 8.1 Built-in Primitive and Derived Types

XSD punya banyak tipe bawaan.

Yang paling sering muncul:

| XSD Type | Meaning | Java Mapping Umum |
|---|---|---|
| `xs:string` | text | `String` |
| `xs:boolean` | true/false, 1/0 | `boolean` / `Boolean` |
| `xs:decimal` | arbitrary precision decimal | `BigDecimal` |
| `xs:integer` | arbitrary integer | `BigInteger` / integer types |
| `xs:int` | 32-bit signed | `int` / `Integer` |
| `xs:long` | 64-bit signed | `long` / `Long` |
| `xs:date` | calendar date | `XMLGregorianCalendar`, `LocalDate` via adapter |
| `xs:dateTime` | date-time lexical value | `XMLGregorianCalendar`, `OffsetDateTime` via adapter |
| `xs:base64Binary` | base64 binary | `byte[]` |
| `xs:anyURI` | URI lexical value | `String` / `URI` |
| `xs:QName` | qualified XML name | `QName` |

Important: JAXB default mapping historically often uses `XMLGregorianCalendar` for XML date/time types, not Java 8 `LocalDate`/`OffsetDateTime`, unless customized.

### 8.2 Facets

Facets adalah constraint pada simple type.

| Facet | Fungsi |
|---|---|
| `length` | panjang harus tepat |
| `minLength` | panjang minimal |
| `maxLength` | panjang maksimal |
| `pattern` | regex lexical pattern |
| `enumeration` | nilai harus salah satu dari daftar |
| `minInclusive` | nilai minimal inclusive |
| `maxInclusive` | nilai maksimal inclusive |
| `minExclusive` | nilai minimal exclusive |
| `maxExclusive` | nilai maksimal exclusive |
| `totalDigits` | total digit numeric |
| `fractionDigits` | digit setelah decimal |
| `whiteSpace` | preserve/replace/collapse whitespace |

Contoh money amount:

```xml
<xs:simpleType name="AmountType">
    <xs:restriction base="xs:decimal">
        <xs:totalDigits value="15"/>
        <xs:fractionDigits value="2"/>
        <xs:minInclusive value="0.00"/>
    </xs:restriction>
</xs:simpleType>
```

Ini bukan hanya validasi. Ini mengkomunikasikan business constraint:

```text
Amount tidak boleh negatif
Maksimal 15 digit total
Maksimal 2 digit pecahan
```

### 8.3 Pattern Bukan Business Rule Lengkap

XSD pattern cocok untuk lexical constraint, bukan semua business rule.

Bagus:

```xml
<xs:pattern value="[A-Z]{3}-[0-9]{8}"/>
```

Kurang bagus:

```text
status boleh APPROVED hanya jika approvalDate ada dan amount < limit user role
```

Rule seperti itu butuh application validation, bukan XSD saja.

Mental model:

```text
XSD validates shape and lexical/domain-local constraints.
Application validates cross-field, cross-entity, authorization, lifecycle, and temporal rules.
```

---

## 9. Complex Type: Struktur Element Berisi Anak/Atribut

`xs:complexType` digunakan untuk element yang punya child element dan/atau attribute.

```xml
<xs:complexType name="AddressType">
    <xs:sequence>
        <xs:element name="line1" type="xs:string"/>
        <xs:element name="line2" type="xs:string" minOccurs="0"/>
        <xs:element name="postalCode" type="PostalCodeType"/>
    </xs:sequence>
    <xs:attribute name="countryCode" type="xs:string" use="required"/>
</xs:complexType>
```

Valid XML:

```xml
<address countryCode="SG">
    <line1>1 Example Road</line1>
    <postalCode>123456</postalCode>
</address>
```

### 9.1 Content Model

Complex type punya content model:

| Content Model | Meaning |
|---|---|
| element-only | hanya child elements |
| simple content | text value + attributes |
| mixed content | text + child elements campur |
| empty content | tanpa child/text, mungkin attribute |

#### Element-only Content

```xml
<xs:complexType name="PersonType">
    <xs:sequence>
        <xs:element name="name" type="xs:string"/>
        <xs:element name="age" type="xs:int"/>
    </xs:sequence>
</xs:complexType>
```

#### Simple Content

Contoh amount dengan currency attribute:

```xml
<xs:complexType name="MoneyType">
    <xs:simpleContent>
        <xs:extension base="xs:decimal">
            <xs:attribute name="currency" type="xs:string" use="required"/>
        </xs:extension>
    </xs:simpleContent>
</xs:complexType>
```

XML:

```xml
<amount currency="SGD">100.50</amount>
```

#### Mixed Content

```xml
<xs:complexType name="RichTextType" mixed="true">
    <xs:sequence minOccurs="0" maxOccurs="unbounded">
        <xs:element name="b" type="xs:string"/>
        <xs:element name="i" type="xs:string"/>
    </xs:sequence>
</xs:complexType>
```

Mixed content sulit untuk binding ke Java object biasa karena urutan text dan element bermakna.

---

## 10. `sequence`, `choice`, dan `all`

XSD mendefinisikan struktur child element dengan model group.

### 10.1 `xs:sequence`

Urutan harus sesuai.

```xml
<xs:sequence>
    <xs:element name="id" type="xs:string"/>
    <xs:element name="name" type="xs:string"/>
    <xs:element name="email" type="xs:string" minOccurs="0"/>
</xs:sequence>
```

Valid:

```xml
<id>1</id>
<name>Fajar</name>
<email>a@example.com</email>
```

Invalid karena urutan salah:

```xml
<name>Fajar</name>
<id>1</id>
```

XSD sequence lebih ketat daripada JSON object yang biasanya tidak peduli urutan field.

### 10.2 `xs:choice`

Salah satu dari beberapa alternatif.

```xml
<xs:choice>
    <xs:element name="email" type="xs:string"/>
    <xs:element name="phone" type="xs:string"/>
</xs:choice>
```

Valid:

```xml
<email>a@example.com</email>
```

Valid:

```xml
<phone>123456</phone>
```

Invalid jika keduanya muncul, kecuali `maxOccurs` mengizinkan pattern lebih kompleks.

### 10.3 `xs:all`

Semua child boleh muncul dalam urutan bebas, tetapi dengan constraint terbatas.

```xml
<xs:all>
    <xs:element name="id" type="xs:string"/>
    <xs:element name="name" type="xs:string"/>
</xs:all>
```

Valid:

```xml
<id>1</id>
<name>Fajar</name>
```

Valid juga:

```xml
<name>Fajar</name>
<id>1</id>
```

Tetapi `xs:all` tidak sefleksibel `sequence`; ada batasan pada occurrence model dan tidak cocok untuk struktur berulang kompleks.

### 10.4 Design Advice

| Situation | Recommended Model |
|---|---|
| SOAP/document-literal payload | `sequence` biasanya paling predictable |
| Salah satu alternatif field | `choice` |
| Struktur kecil order-insensitive | `all`, tapi hati-hati tooling |
| Extensible unknown fields | `xs:any` dengan namespace discipline |
| Event log bebas bentuk | XML mungkin bukan format terbaik, atau gunakan envelope + extension point |

---

## 11. Cardinality: `minOccurs` dan `maxOccurs`

Default XSD:

```text
minOccurs = 1
maxOccurs = 1
```

Artinya element wajib muncul tepat sekali.

```xml
<xs:element name="name" type="xs:string"/>
```

Sama dengan:

```xml
<xs:element name="name" type="xs:string" minOccurs="1" maxOccurs="1"/>
```

Optional:

```xml
<xs:element name="middleName" type="xs:string" minOccurs="0"/>
```

List:

```xml
<xs:element name="item" type="ItemType" minOccurs="0" maxOccurs="unbounded"/>
```

At least one:

```xml
<xs:element name="item" type="ItemType" minOccurs="1" maxOccurs="unbounded"/>
```

Exactly 3:

```xml
<xs:element name="approval" type="ApprovalType" minOccurs="3" maxOccurs="3"/>
```

### 11.1 Cardinality as Compatibility Contract

Mengubah cardinality bukan detail kecil.

| Change | Compatibility Risk |
|---|---|
| required → optional | biasanya backward compatible untuk consumer baru, tapi bisa mengubah business expectation |
| optional → required | breaking change untuk producer lama |
| maxOccurs 1 → unbounded | breaking untuk binding client yang mengharapkan single value |
| unbounded → 1 | breaking untuk producer yang mengirim list |
| minOccurs 0 → 1 | breaking |
| minOccurs 1 → 0 | biasanya safer, tapi consumer harus handle absence |

Dalam JAXB, perubahan `maxOccurs` dari 1 ke `unbounded` bisa mengubah Java property dari single field menjadi `List<T>`. Ini breaking untuk generated client/server code.

---

## 12. `nillable`, Absent, Empty, dan Nil

Salah satu bagian paling penting dalam XML contract adalah membedakan:

1. element absent,
2. element present empty,
3. element present nil,
4. element present with value.

Misal schema:

```xml
<xs:element name="middleName" type="xs:string" minOccurs="0" nillable="true"/>
```

### 12.1 Absent

```xml
<!-- no middleName element -->
```

Meaning:

```text
field tidak dikirim / unknown / not applicable / no update
```

Tergantung kontrak.

### 12.2 Empty String

```xml
<middleName></middleName>
```

atau:

```xml
<middleName/>
```

Meaning untuk `xs:string`:

```text
present dengan lexical value empty string
```

### 12.3 Nil

```xml
<middleName xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:nil="true"/>
```

Meaning:

```text
present explicitly null/nil
```

Valid hanya jika `nillable="true"`.

### 12.4 Present With Value

```xml
<middleName>Abdi</middleName>
```

Meaning:

```text
present dengan value Abdi
```

### 12.5 Enterprise Rule

Jangan menyamakan absent, empty, dan nil tanpa keputusan kontrak eksplisit.

Untuk update/PATCH-like XML message:

```text
absent  = jangan ubah field
nil     = clear field
empty   = set field to empty string
value   = set field to value
```

Untuk create message:

```text
absent  = missing input
nil     = explicit null
empty   = empty string
value   = value
```

JAXB bisa menyembunyikan perbedaan ini jika mapping tidak hati-hati. Untuk kontrak enterprise, perbedaan ini harus ditest.

---

## 13. Attribute vs Element

XML menyediakan element dan attribute. XSD mendukung keduanya.

Element:

```xml
<customer>
    <id>CUST-001</id>
</customer>
```

Attribute:

```xml
<customer id="CUST-001"/>
```

### 13.1 Kapan Pakai Attribute?

Attribute cocok untuk:

- metadata pendek,
- code/qualifier,
- identifier ringan,
- flags,
- language/currency/unit qualifier,
- nilai yang tidak butuh nested structure.

Contoh:

```xml
<amount currency="SGD">100.50</amount>
```

### 13.2 Kapan Pakai Element?

Element cocok untuk:

- data utama bisnis,
- nilai yang mungkin complex,
- field yang mungkin repeated,
- field yang mungkin nillable,
- field dengan mixed content,
- field yang butuh extensibility.

Contoh:

```xml
<customer>
    <id>CUST-001</id>
    <name>Fajar</name>
    <addresses>
        <address type="HOME">...</address>
    </addresses>
</customer>
```

### 13.3 Rule of Thumb

Gunakan element untuk business data utama. Gunakan attribute untuk metadata/qualifier yang kecil dan tidak repeated.

Hindari desain ini untuk data besar:

```xml
<case id="CASE-001" applicantName="Fajar" applicantAddress="...very long..." status="..."/>
```

Lebih baik:

```xml
<case id="CASE-001">
    <applicant>
        <name>Fajar</name>
        <address>...</address>
    </applicant>
    <status>...</status>
</case>
```

---

## 14. Simple Type Restriction in Practice

### 14.1 Enumeration

```xml
<xs:simpleType name="CaseStatusType">
    <xs:restriction base="xs:string">
        <xs:enumeration value="DRAFT"/>
        <xs:enumeration value="SUBMITTED"/>
        <xs:enumeration value="APPROVED"/>
        <xs:enumeration value="REJECTED"/>
    </xs:restriction>
</xs:simpleType>
```

Enumeration memberi kontrak kuat, tetapi punya risiko evolution.

Menambah enum value bisa breaking untuk consumer yang generate Java enum dan tidak siap unknown value.

Misal v1:

```text
DRAFT, SUBMITTED, APPROVED, REJECTED
```

v2 menambah:

```text
WITHDRAWN
```

Secara XML schema evolution, ini terlihat additive. Tetapi untuk Java generated enum lama:

```java
CaseStatusType.fromValue("WITHDRAWN")
```

bisa gagal.

Rule:

```text
Adding enum value is often semantically breaking for strongly typed consumers.
```

Solusi:

- version schema namespace,
- pakai string + documented code list untuk nilai yang sering berubah,
- sediakan `UNKNOWN` handling di application layer,
- contract test consumer lama.

### 14.2 Pattern

```xml
<xs:simpleType name="UenType">
    <xs:restriction base="xs:string">
        <xs:minLength value="9"/>
        <xs:maxLength value="10"/>
        <xs:pattern value="[A-Z0-9]+"/>
    </xs:restriction>
</xs:simpleType>
```

Pattern memvalidasi lexical form. Namun jangan terlalu overfit jika format official bisa berubah.

### 14.3 Decimal

```xml
<xs:simpleType name="PercentageType">
    <xs:restriction base="xs:decimal">
        <xs:minInclusive value="0"/>
        <xs:maxInclusive value="100"/>
        <xs:fractionDigits value="2"/>
    </xs:restriction>
</xs:simpleType>
```

Gunakan `xs:decimal`, bukan `xs:double`, untuk money/percentage/regulatory numeric values.

`xs:double` punya floating-point semantics yang sering tidak cocok untuk audit/financial/regulatory data.

---

## 15. `whiteSpace` Facet: Detail Kecil yang Bisa Merusak Data

XSD punya `whiteSpace` facet:

| Value | Meaning |
|---|---|
| `preserve` | whitespace dipertahankan |
| `replace` | tab/newline/carriage return diganti space |
| `collapse` | replace lalu multiple spaces dicollapse dan trim |

Contoh:

```xml
<xs:simpleType name="CodeType">
    <xs:restriction base="xs:string">
        <xs:whiteSpace value="collapse"/>
        <xs:minLength value="1"/>
    </xs:restriction>
</xs:simpleType>
```

Ini membuat:

```text
"  ABC   DEF  "
```

menjadi lexical normalized value:

```text
"ABC DEF"
```

Untuk code field, ini bisa benar. Untuk free-text explanation, ini bisa merusak.

Rule:

```text
Do not blindly collapse whitespace on narrative text, legal text, template text, or signed canonical content.
```

---

## 16. Type Derivation: Restriction dan Extension

XSD mendukung inheritance-like model.

### 16.1 Simple Type Restriction

```xml
<xs:simpleType name="ShortTextType">
    <xs:restriction base="xs:string">
        <xs:maxLength value="100"/>
    </xs:restriction>
</xs:simpleType>
```

### 16.2 Complex Type Extension

```xml
<xs:complexType name="PersonType">
    <xs:sequence>
        <xs:element name="name" type="xs:string"/>
    </xs:sequence>
</xs:complexType>

<xs:complexType name="EmployeeType">
    <xs:complexContent>
        <xs:extension base="PersonType">
            <xs:sequence>
                <xs:element name="employeeId" type="xs:string"/>
            </xs:sequence>
        </xs:extension>
    </xs:complexContent>
</xs:complexType>
```

`EmployeeType` memiliki `name` lalu `employeeId`.

### 16.3 Complex Type Restriction

Complex restriction lebih sulit dan lebih jarang dipakai dengan benar.

Contoh konsep:

```text
Base type allows optional A, B, C.
Restricted type only allows A, B.
```

Dalam praktik, complex restriction bisa membingungkan tooling dan code generation. Gunakan jika benar-benar perlu dan contract owner memahami konsekuensinya.

### 16.4 Inheritance Risk with JAXB

XSD extension sering menghasilkan Java class inheritance.

```java
public class EmployeeType extends PersonType { ... }
```

Risiko:

- domain model ikut terseret contract inheritance.
- generated class hierarchy sulit diubah.
- polymorphic XML menggunakan `xsi:type` bisa membuka compatibility/security concerns.
- SOAP client lama mungkin tidak mengerti derived type baru.

Rule:

```text
Use XSD inheritance for contract taxonomy only when consumers genuinely need substitutability.
Do not use it just to avoid copy-paste in schema.
```

---

## 17. `xsi:type`: Runtime Type Override

XML instance bisa menentukan tipe aktual dengan `xsi:type`.

Schema:

```xml
<xs:element name="person" type="PersonType"/>
```

Instance:

```xml
<person xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xsi:type="EmployeeType">
    <name>Fajar</name>
    <employeeId>E001</employeeId>
</person>
```

Ini valid jika `EmployeeType` validly derived dari `PersonType` dan namespace/type resolved dengan benar.

### 17.1 Why It Matters

`xsi:type` membuat tipe aktual dokumen bisa berubah di runtime. Ini powerful untuk extensibility, tetapi berisiko:

- consumer tidak siap derived type.
- JAXB unmarshaller bisa menghasilkan subclass/JAXBElement berbeda.
- validation dan binding behaviour menjadi lebih kompleks.
- XML Signature Wrapping dan polymorphic confusion lebih mudah terjadi jika security model lemah.

Rule:

```text
For external boundary, prefer explicit element names over uncontrolled xsi:type polymorphism unless contract explicitly requires it.
```

---

## 18. Substitution Groups

Substitution group memungkinkan element lain menggantikan head element.

```xml
<xs:element name="payment" type="PaymentType" abstract="true"/>

<xs:element name="cardPayment" type="CardPaymentType" substitutionGroup="payment"/>
<xs:element name="bankTransfer" type="BankTransferType" substitutionGroup="payment"/>
```

Lalu dalam type:

```xml
<xs:element ref="payment"/>
```

Instance bisa berisi:

```xml
<cardPayment>...</cardPayment>
```

atau:

```xml
<bankTransfer>...</bankTransfer>
```

### 18.1 Practical Advice

Substitution group sangat berguna untuk extensibility framework, tetapi sering membuat:

- WSDL sulit dibaca.
- generated Java code lebih kompleks.
- consumer compatibility sulit diprediksi.
- validation error sulit dipahami.

Gunakan untuk domain yang memang polymorphic dan long-lived, misalnya standardized document families. Untuk API internal sederhana, biasanya `choice` lebih jelas.

---

## 19. Wildcards: `xs:any` dan `xs:anyAttribute`

Wildcards memungkinkan extension point.

```xml
<xs:complexType name="CustomerType">
    <xs:sequence>
        <xs:element name="id" type="xs:string"/>
        <xs:any namespace="##other" processContents="lax" minOccurs="0" maxOccurs="unbounded"/>
    </xs:sequence>
</xs:complexType>
```

Artinya setelah `id`, XML boleh punya element dari namespace lain.

### 19.1 `namespace`

| Value | Meaning |
|---|---|
| `##any` | namespace apa pun |
| `##other` | namespace selain target namespace |
| `##targetNamespace` | target namespace saja |
| `##local` | no namespace |
| URI list | namespace tertentu |

### 19.2 `processContents`

| Value | Meaning |
|---|---|
| `strict` | validator harus menemukan schema dan validate |
| `lax` | validate jika schema tersedia, jika tidak skip |
| `skip` | tidak divalidasi |

### 19.3 Enterprise Guidance

Wildcards sangat powerful, tetapi bisa menjadi lubang kontrak.

Recommended:

```xml
<xs:any namespace="##other" processContents="lax" minOccurs="0" maxOccurs="unbounded"/>
```

Lebih aman daripada:

```xml
<xs:any namespace="##any" processContents="skip" minOccurs="0" maxOccurs="unbounded"/>
```

Karena `##any + skip` pada boundary eksternal pada dasarnya mengatakan:

```text
Apa pun boleh masuk dan tidak perlu divalidasi.
```

Untuk extensibility, gunakan namespace khusus extension:

```xml
<xs:any namespace="https://example.com/customer/extensions/v1" processContents="lax"/>
```

Atau gunakan explicit extension container:

```xml
<extensions>
    <extension name="partnerCode">...</extension>
</extensions>
```

---

## 20. Identity Constraints: `unique`, `key`, `keyref`

XSD bisa mendefinisikan constraint mirip unique key dan foreign key dalam dokumen XML.

### 20.1 `xs:unique`

```xml
<xs:element name="items">
    <xs:complexType>
        <xs:sequence>
            <xs:element name="item" maxOccurs="unbounded">
                <xs:complexType>
                    <xs:sequence>
                        <xs:element name="sku" type="xs:string"/>
                        <xs:element name="quantity" type="xs:int"/>
                    </xs:sequence>
                </xs:complexType>
            </xs:element>
        </xs:sequence>
    </xs:complexType>
    <xs:unique name="uniqueSku">
        <xs:selector xpath="item"/>
        <xs:field xpath="sku"/>
    </xs:unique>
</xs:element>
```

Artinya setiap `item/sku` harus unique.

### 20.2 `xs:key` dan `xs:keyref`

`xs:key` mendefinisikan key wajib dan unique. `xs:keyref` mereferensikan key.

Konsep:

```text
customer id harus unique
order customerId harus refer ke customer id yang ada dalam dokumen yang sama
```

### 20.3 Limitation

Identity constraints hanya berlaku dalam dokumen XML yang sedang divalidasi. Ia tidak bisa memvalidasi ke database atau external system.

Jangan gunakan XSD key/keyref sebagai pengganti business referential integrity lintas sistem.

---

## 21. `import` vs `include`

Ini salah satu sumber error paling umum.

### 21.1 `xs:include`

`include` digunakan untuk memasukkan schema document dengan **target namespace yang sama**.

```xml
<xs:include schemaLocation="customer-types.xsd"/>
```

Gunakan saat ingin memecah satu namespace schema ke beberapa file.

```text
customer.xsd               targetNamespace = /customer/v1
customer-types.xsd         targetNamespace = /customer/v1
```

### 21.2 `xs:import`

`import` digunakan untuk mengambil schema dari **namespace berbeda**.

```xml
<xs:import namespace="https://example.com/common/v1"
           schemaLocation="common.xsd"/>
```

```text
customer.xsd               targetNamespace = /customer/v1
common.xsd                 targetNamespace = /common/v1
```

Lalu referensi type:

```xml
<xs:element name="audit" type="com:AuditType"/>
```

### 21.3 Common Failure

```text
src-resolve: Cannot resolve the name 'com:AuditType' to a type definition component.
```

Kemungkinan penyebab:

- namespace import salah.
- prefix `com` bind ke URI yang salah.
- schemaLocation tidak ditemukan.
- imported XSD tidak define `AuditType` sebagai global type.
- targetNamespace imported XSD tidak sesuai dengan namespace import.
- tool membaca file lokal tetapi relative path berubah.

### 21.4 Production Advice

Jangan bergantung pada URL publik untuk import saat runtime.

Buruk:

```xml
<xs:import namespace="https://partner.example.com/common"
           schemaLocation="https://partner.example.com/schema/common.xsd"/>
```

Lebih baik:

- simpan schema dependency dalam source repo/artifact.
- gunakan XML catalog untuk resolve namespace/system id ke local resource.
- pin versi schema.
- test offline build.
- jangan izinkan validator fetch network resource sembarangan.

---

## 22. Schema Versioning

XSD versioning bukan sekadar menambah atribut `version`.

```xml
<xs:schema version="1.1">
```

Atribut itu metadata; tidak otomatis mengubah namespace atau compatibility.

### 22.1 Namespace Versioning

Pendekatan umum:

```text
https://example.com/customer/v1
https://example.com/customer/v2
```

Kelebihan:

- jelas bagi validator dan binding.
- v1 dan v2 bisa hidup berdampingan.
- JAXB package generation lebih terpisah.
- SOAP WSDL bisa expose port/operation baru.

Kekurangan:

- namespace churn.
- mapping antar versi perlu explicit.
- semua consumer harus aware versi baru.

### 22.2 Non-Namespace Versioning

Namespace tetap:

```text
https://example.com/customer
```

Versi lewat attribute:

```xml
<customer version="2.0" xmlns="https://example.com/customer">
```

Kelebihan:

- URI stabil.
- lebih ringan untuk minor compatible evolution.

Kekurangan:

- validator harus tahu schema mana untuk versi mana.
- JAXB binding bisa lebih sulit.
- consumer bisa salah menganggap compatible.

### 22.3 Practical Strategy

Gunakan pendekatan hybrid:

```text
Breaking major change      -> new namespace /v2
Backward-compatible minor  -> same namespace, optional additions, documented version
Operational patch          -> same namespace, no contract semantics change
```

Tapi definisi “backward-compatible” harus dilihat dari sisi consumer generated code, bukan hanya XSD theory.

---

## 23. Compatibility Matrix untuk XSD Evolution

| Change | Producer Old → Consumer New | Producer New → Consumer Old | Risk |
|---|---:|---:|---|
| Add optional element at end of sequence | usually OK | often breaks old strict consumer if validating against old schema | medium |
| Add required element | breaks old producer | breaks old consumer | high |
| Remove optional element | consumer may expect it | OK if consumer tolerant | medium |
| Remove required element | breaks consumer | breaks producer expectation | high |
| Rename element | breaking | breaking | high |
| Change namespace | breaking unless version routing exists | breaking | high |
| Change type string → int | breaking | breaking | high |
| Widen maxLength 50 → 100 | old consumer may reject >50 | OK for old data | medium |
| Narrow maxLength 100 → 50 | old producer may send >50 | OK if values small | high |
| Add enum value | new producer can break old generated enum | old producer OK | medium/high |
| Make required optional | old producer OK | old consumer likely OK but semantics may change | low/medium |
| Make optional required | old producer breaks | old consumer breaks | high |
| Add wildcard extension point | depends | depends | medium |
| Change sequence order | breaking | breaking | high |

Important:

```text
XSD backward compatibility is not enough.
Check parser compatibility, validator compatibility, binding compatibility, and business semantic compatibility.
```

---

## 24. Contract Design: Closed vs Open Schema

### 24.1 Closed Schema

Closed schema hanya menerima fields yang diketahui.

```xml
<xs:complexType name="CustomerType">
    <xs:sequence>
        <xs:element name="id" type="xs:string"/>
        <xs:element name="name" type="xs:string"/>
    </xs:sequence>
</xs:complexType>
```

Unknown element invalid.

Kelebihan:

- strict.
- mudah audit.
- predictable binding.
- attack surface lebih kecil.

Kekurangan:

- evolution lebih sulit.
- partner extension tidak bisa masuk.

### 24.2 Open Schema

Open schema menyediakan extension point.

```xml
<xs:complexType name="CustomerType">
    <xs:sequence>
        <xs:element name="id" type="xs:string"/>
        <xs:element name="name" type="xs:string"/>
        <xs:any namespace="##other" processContents="lax" minOccurs="0" maxOccurs="unbounded"/>
    </xs:sequence>
</xs:complexType>
```

Kelebihan:

- extensible.
- partner-specific data bisa masuk.
- lebih tahan terhadap minor additions jika consumer tidak strict.

Kekurangan:

- validation lebih lemah.
- security filtering lebih sulit.
- audit semantics harus jelas.
- generated Java bisa memakai `List<Object>` / DOM element.

### 24.3 Top 1% Design Rule

Untuk external/regulatory/financial boundary:

```text
Default closed.
Open only at explicitly named extension points.
Extension point must have namespace rule, size limit, validation policy, audit policy, and ignore/preserve semantics.
```

---

## 25. Validation in Java: `SchemaFactory`, `Schema`, `Validator`

Java menyediakan validation API di package `javax.xml.validation`. Nama package tetap `javax` di Java SE karena ini bagian dari JAXP/Java XML APIs, bukan Jakarta EE namespace migration.

Basic validation:

```java
import javax.xml.XMLConstants;
import javax.xml.transform.stream.StreamSource;
import javax.xml.validation.Schema;
import javax.xml.validation.SchemaFactory;
import javax.xml.validation.Validator;
import org.xml.sax.SAXException;

import java.io.File;
import java.io.IOException;

public final class XmlValidatorExample {
    public static void main(String[] args) throws Exception {
        File xsd = new File("customer.xsd");
        File xml = new File("customer.xml");

        SchemaFactory factory = SchemaFactory.newInstance(XMLConstants.W3C_XML_SCHEMA_NS_URI);
        Schema schema = factory.newSchema(xsd);
        Validator validator = schema.newValidator();

        try {
            validator.validate(new StreamSource(xml));
            System.out.println("Valid XML");
        } catch (SAXException e) {
            System.out.println("Invalid XML: " + e.getMessage());
        }
    }
}
```

### 25.1 Thread Safety

Important practical rules:

```text
SchemaFactory: not thread-safe. Create per build/init or protect.
Schema: immutable/thread-safe. Cache/share.
Validator: not thread-safe. Create per validation.
```

Production pattern:

```java
public final class SchemaValidator {
    private final Schema schema;

    public SchemaValidator(Schema schema) {
        this.schema = schema;
    }

    public void validate(StreamSource xml) throws IOException, SAXException {
        Validator validator = schema.newValidator();
        validator.validate(xml);
    }
}
```

Do not share one `Validator` across threads.

---

## 26. Secure XSD Validation

XML validation can become dangerous if it resolves external resources freely.

Risk examples:

- schema imports remote URL.
- XML instance references external schema location.
- parser expands external entity.
- validator fetches network resource.
- malicious payload causes excessive CPU/memory.

### 26.1 Hardened `SchemaFactory`

```java
import javax.xml.XMLConstants;
import javax.xml.validation.SchemaFactory;

SchemaFactory factory = SchemaFactory.newInstance(XMLConstants.W3C_XML_SCHEMA_NS_URI);

factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);

factory.setProperty(XMLConstants.ACCESS_EXTERNAL_DTD, "");
factory.setProperty(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
```

This disables external DTD/schema access through standard JAXP properties.

### 26.2 Use Local Resource Resolution

For multi-XSD schema sets, do not allow arbitrary network fetch. Use local resources.

Approach:

```text
schemas/
  customer/v1/customer.xsd
  common/v1/common.xsd
```

Then compile schema from known sources:

```java
Schema schema = factory.newSchema(new Source[] {
    new StreamSource(resource("/schemas/common/v1/common.xsd")),
    new StreamSource(resource("/schemas/customer/v1/customer.xsd"))
});
```

For sophisticated cases, use `LSResourceResolver` or XML Catalog to resolve imports to local resources.

### 26.3 Do Not Trust `xsi:schemaLocation`

XML instance may include:

```xml
<customer xmlns="https://example.com/customer/v1"
          xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
          xsi:schemaLocation="https://example.com/customer/v1 https://attacker.example/schema.xsd">
```

Boundary service should not fetch schema from instance-provided URL.

Rule:

```text
Server chooses validation schema. Payload must not choose validation schema.
```

---

## 27. Validation Error Handling

Default validation error often returns first error only and vague message.

Better approach: custom `ErrorHandler`.

```java
import org.xml.sax.ErrorHandler;
import org.xml.sax.SAXException;
import org.xml.sax.SAXParseException;

import java.util.ArrayList;
import java.util.List;

public final class CollectingErrorHandler implements ErrorHandler {
    private final List<String> errors = new ArrayList<>();

    @Override
    public void warning(SAXParseException exception) {
        errors.add(format("WARN", exception));
    }

    @Override
    public void error(SAXParseException exception) {
        errors.add(format("ERROR", exception));
    }

    @Override
    public void fatalError(SAXParseException exception) throws SAXException {
        errors.add(format("FATAL", exception));
        throw exception;
    }

    public List<String> errors() {
        return List.copyOf(errors);
    }

    private static String format(String level, SAXParseException e) {
        return level + " line=" + e.getLineNumber()
                + " col=" + e.getColumnNumber()
                + " message=" + e.getMessage();
    }
}
```

Usage:

```java
Validator validator = schema.newValidator();
CollectingErrorHandler errorHandler = new CollectingErrorHandler();
validator.setErrorHandler(errorHandler);
validator.validate(source);
```

### 27.1 Error Response Design

For external API:

Do not return raw internal parser details blindly.

Better response:

```json
{
  "error": "INVALID_XML_SCHEMA",
  "message": "XML payload does not conform to Customer v1 schema.",
  "details": [
    {
      "line": 12,
      "column": 18,
      "reason": "Element 'status' has invalid value."
    }
  ],
  "correlationId": "..."
}
```

For internal logs, include:

- schema version,
- namespace,
- source system,
- operation,
- correlation id,
- sanitized validation error,
- payload hash, not full payload if sensitive.

---

## 28. XSD and JAXB/Jakarta XML Binding

XSD strongly influences generated Java classes.

Example XSD:

```xml
<xs:complexType name="CustomerType">
    <xs:sequence>
        <xs:element name="id" type="xs:string"/>
        <xs:element name="name" type="xs:string" minOccurs="0"/>
        <xs:element name="addresses" type="AddressType" minOccurs="0" maxOccurs="unbounded"/>
    </xs:sequence>
</xs:complexType>
```

Generated Java likely:

```java
public class CustomerType {
    protected String id;
    protected String name;
    protected List<AddressType> addresses;

    public String getId() { return id; }
    public void setId(String value) { this.id = value; }

    public String getName() { return name; }
    public void setName(String value) { this.name = value; }

    public List<AddressType> getAddresses() {
        if (addresses == null) {
            addresses = new ArrayList<>();
        }
        return this.addresses;
    }
}
```

Notice common JAXB pattern:

```text
List property may not have setter. Getter returns live list.
```

This surprises engineers used to immutable DTOs.

### 28.1 XSD Design Affects Java API Shape

| XSD Construct | Common Java Binding Effect |
|---|---|
| `maxOccurs="unbounded"` | `List<T>` |
| `minOccurs="0"` | nullable reference / `JAXBElement` depending config |
| `nillable="true"` | `JAXBElement<T>` or nullable handling |
| anonymous complexType | generated nested-ish or auto-named class |
| global named complexType | named Java class |
| enum simpleType | Java enum |
| `xs:choice` | sometimes `List<JAXBElement<?>>` or awkward fields |
| `xs:any` | `List<Object>` or DOM `Element` |
| substitution group | polymorphic generated model |

Therefore schema authoring is Java API design if consumers generate Java.

---

## 29. XSD 1.0 vs XSD 1.1

XSD 1.0 is more widely supported across Java tooling, SOAP stacks, and legacy systems.

XSD 1.1 adds features such as assertions (`xs:assert`) and more expressive conditional constraints.

Example conceptual XSD 1.1 assertion:

```xml
<xs:assert test="if (status = 'APPROVED') then exists(approvalDate) else true()"/>
```

This is attractive, but practical compatibility is limited because many Java/SOAP/JAXB toolchains historically target XSD 1.0.

Rule:

```text
For broad enterprise/SOAP interoperability, assume XSD 1.0 unless all runtimes/tooling are verified for XSD 1.1.
```

For advanced cross-field validation, often better:

```text
XSD 1.0 for structural contract
Application validation for conditional business rules
Contract tests for behavior
```

---

## 30. Case Study: Regulatory Case Submission Schema

Suppose we design XML for regulatory case submission.

Requirements:

- case id optional on create, required on update.
- applicant has UEN or individual id.
- at least one offence item.
- amount must be non-negative with 2 decimals.
- status controlled.
- extension area for partner metadata.

A possible XSD fragment:

```xml
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
           targetNamespace="https://example.gov/case/v1"
           xmlns="https://example.gov/case/v1"
           xmlns:ext="https://example.gov/case/extensions/v1"
           elementFormDefault="qualified"
           attributeFormDefault="unqualified">

    <xs:element name="caseSubmission" type="CaseSubmissionType"/>

    <xs:complexType name="CaseSubmissionType">
        <xs:sequence>
            <xs:element name="caseId" type="CaseIdType" minOccurs="0"/>
            <xs:element name="operation" type="OperationType"/>
            <xs:element name="applicant" type="ApplicantType"/>
            <xs:element name="offences" type="OffencesType"/>
            <xs:element name="remarks" type="LongTextType" minOccurs="0"/>
            <xs:any namespace="https://example.gov/case/extensions/v1"
                    processContents="lax"
                    minOccurs="0"
                    maxOccurs="unbounded"/>
        </xs:sequence>
        <xs:attribute name="schemaVersion" type="xs:string" use="required" fixed="1.0"/>
    </xs:complexType>

    <xs:simpleType name="CaseIdType">
        <xs:restriction base="xs:string">
            <xs:pattern value="CASE-[0-9]{8}"/>
        </xs:restriction>
    </xs:simpleType>

    <xs:simpleType name="OperationType">
        <xs:restriction base="xs:string">
            <xs:enumeration value="CREATE"/>
            <xs:enumeration value="UPDATE"/>
        </xs:restriction>
    </xs:simpleType>

    <xs:complexType name="ApplicantType">
        <xs:choice>
            <xs:element name="uen" type="UenType"/>
            <xs:element name="individualId" type="IndividualIdType"/>
        </xs:choice>
        <xs:attribute name="applicantType" type="ApplicantKindType" use="required"/>
    </xs:complexType>

    <xs:simpleType name="ApplicantKindType">
        <xs:restriction base="xs:string">
            <xs:enumeration value="ENTITY"/>
            <xs:enumeration value="INDIVIDUAL"/>
        </xs:restriction>
    </xs:simpleType>

    <xs:simpleType name="UenType">
        <xs:restriction base="xs:string">
            <xs:minLength value="9"/>
            <xs:maxLength value="10"/>
            <xs:pattern value="[A-Z0-9]+"/>
        </xs:restriction>
    </xs:simpleType>

    <xs:simpleType name="IndividualIdType">
        <xs:restriction base="xs:string">
            <xs:minLength value="4"/>
            <xs:maxLength value="20"/>
        </xs:restriction>
    </xs:simpleType>

    <xs:complexType name="OffencesType">
        <xs:sequence>
            <xs:element name="offence" type="OffenceType" minOccurs="1" maxOccurs="unbounded"/>
        </xs:sequence>
    </xs:complexType>

    <xs:complexType name="OffenceType">
        <xs:sequence>
            <xs:element name="code" type="CodeType"/>
            <xs:element name="description" type="LongTextType"/>
            <xs:element name="proposedPenalty" type="MoneyType" minOccurs="0"/>
        </xs:sequence>
    </xs:complexType>

    <xs:simpleType name="CodeType">
        <xs:restriction base="xs:string">
            <xs:whiteSpace value="collapse"/>
            <xs:minLength value="1"/>
            <xs:maxLength value="50"/>
        </xs:restriction>
    </xs:simpleType>

    <xs:simpleType name="LongTextType">
        <xs:restriction base="xs:string">
            <xs:maxLength value="4000"/>
        </xs:restriction>
    </xs:simpleType>

    <xs:complexType name="MoneyType">
        <xs:simpleContent>
            <xs:extension base="AmountType">
                <xs:attribute name="currency" type="CurrencyCodeType" use="required"/>
            </xs:extension>
        </xs:simpleContent>
    </xs:complexType>

    <xs:simpleType name="AmountType">
        <xs:restriction base="xs:decimal">
            <xs:totalDigits value="15"/>
            <xs:fractionDigits value="2"/>
            <xs:minInclusive value="0.00"/>
        </xs:restriction>
    </xs:simpleType>

    <xs:simpleType name="CurrencyCodeType">
        <xs:restriction base="xs:string">
            <xs:pattern value="[A-Z]{3}"/>
        </xs:restriction>
    </xs:simpleType>
</xs:schema>
```

### 30.1 What XSD Can Validate

XSD can validate:

- XML has `caseSubmission` root.
- `operation` is CREATE or UPDATE.
- applicant has either `uen` or `individualId`.
- offences has at least one offence.
- amount has valid precision and non-negative value.
- currency has 3 uppercase letters.
- fields respect max length.

### 30.2 What XSD Cannot Fully Validate Here

XSD 1.0 cannot easily validate:

- if operation is UPDATE, caseId must exist.
- if applicantType is ENTITY, uen must be used.
- offence code must exist in current database master table.
- proposedPenalty must be allowed for user role.
- currency must be enabled for the agency today.
- duplicate submission idempotency.
- lifecycle transition validity.

Those belong to application validation.

Top 1% boundary design means you know which rule belongs where.

---

## 31. Contract-First Workflow with XSD

A robust workflow:

```text
1. Write domain-independent contract requirements.
2. Define namespace and versioning strategy.
3. Create XSD with named global types.
4. Add sample valid XML documents.
5. Add sample invalid XML documents.
6. Validate samples in build.
7. Generate JAXB/Jakarta classes in build.
8. Run compile tests against generated classes.
9. Run round-trip marshal/unmarshal tests.
10. Run compatibility tests with previous schema version.
11. Publish schema artifact with version.
12. Never mutate released schema silently.
```

### 31.1 Project Layout

```text
src/main/resources/schemas/case/v1/case-submission.xsd
src/test/resources/xml/case/v1/valid/create-case.xml
src/test/resources/xml/case/v1/valid/update-case.xml
src/test/resources/xml/case/v1/invalid/missing-operation.xml
src/test/resources/xml/case/v1/invalid/no-offence.xml
src/test/resources/xml/case/v1/invalid/bad-amount.xml
```

### 31.2 Build-Time Validation Test

```java
@Test
void validSamplesShouldPassSchemaValidation() throws Exception {
    Schema schema = loadSchema("/schemas/case/v1/case-submission.xsd");

    List<String> samples = List.of(
        "/xml/case/v1/valid/create-case.xml",
        "/xml/case/v1/valid/update-case.xml"
    );

    for (String sample : samples) {
        Validator validator = schema.newValidator();
        validator.validate(new StreamSource(getClass().getResourceAsStream(sample)));
    }
}
```

### 31.3 Negative Test

```java
@Test
void invalidSampleShouldFail() throws Exception {
    Schema schema = loadSchema("/schemas/case/v1/case-submission.xsd");
    Validator validator = schema.newValidator();

    assertThrows(SAXException.class, () ->
        validator.validate(new StreamSource(
            getClass().getResourceAsStream("/xml/case/v1/invalid/no-offence.xml")
        ))
    );
}
```

---

## 32. XSD Design Smells

### 32.1 Everything is `xs:string`

Bad:

```xml
<xs:element name="amount" type="xs:string"/>
<xs:element name="date" type="xs:string"/>
<xs:element name="status" type="xs:string"/>
```

Why bad:

- validation weak.
- invalid values move downstream.
- every consumer reimplements parsing.
- contract lies about data semantics.

Better:

```xml
<xs:element name="amount" type="AmountType"/>
<xs:element name="submissionDate" type="xs:date"/>
<xs:element name="status" type="StatusType"/>
```

### 32.2 Overly Deep Nesting

Bad:

```xml
<a><b><c><d><e><f>value</f></e></d></c></b></a>
```

Why bad:

- hard to query.
- hard to bind.
- validation errors become unreadable.
- brittle against evolution.

### 32.3 Anonymous Types Everywhere

Bad for large contracts:

```xml
<xs:element name="customer">
  <xs:complexType>
    ...
  </xs:complexType>
</xs:element>
```

Used everywhere, generated names become unstable.

Better for enterprise:

```xml
<xs:element name="customer" type="CustomerType"/>
<xs:complexType name="CustomerType">...</xs:complexType>
```

### 32.4 Massive God Schema

One schema contains everything:

```text
common + customer + order + payment + case + audit + report
```

Why bad:

- every change affects all consumers.
- generated code huge.
- ownership unclear.
- versioning impossible.

Better:

```text
common-types.xsd
customer.xsd
case.xsd
payment.xsd
```

With disciplined imports.

### 32.5 Semantic Version Hidden in Documentation Only

Bad:

```xml
<xs:annotation>
    <xs:documentation>Version 2</xs:documentation>
</xs:annotation>
```

But namespace and artifact name unchanged with breaking changes.

Result:

- old clients break unexpectedly.
- schema cache conflict.
- generated classes overwritten.

### 32.6 Wildcard Everywhere

Bad:

```xml
<xs:any namespace="##any" processContents="skip" minOccurs="0" maxOccurs="unbounded"/>
```

If used widely, schema stops being contract.

---

## 33. XSD and SOAP/WSDL

SOAP document-literal style commonly embeds XSD in WSDL:

```text
WSDL
└── types
    └── xs:schema
        ├── request element
        ├── response element
        └── shared complex types
```

SOAP operation often maps to global request/response elements.

Example conceptual WSDL mapping:

```text
submitCase operation
    input message  -> submitCaseRequest element
    output message -> submitCaseResponse element
```

XSD design affects:

- generated JAX-WS request/response classes.
- SOAP body wrapper names.
- fault detail types.
- interoperability with .NET/Java/legacy ESB.
- message validation at gateway.

For SOAP compatibility, avoid unnecessary exotic schema constructs unless required:

- complex restriction,
- substitution groups,
- excessive `choice`,
- ambiguous wildcards,
- deeply nested anonymous types,
- XSD 1.1 assertions if tooling not verified.

---

## 34. Java 8–25 Practical Compatibility

### 34.1 Java SE XML Validation APIs

`javax.xml.validation`, `javax.xml.parsers`, `javax.xml.stream`, `javax.xml.transform`, `javax.xml.xpath` are part of Java SE `java.xml` module in modern Java.

So XSD validation through JAXP remains available in Java 8 through Java 25.

### 34.2 JAXB/JAX-WS Tooling Difference

What changed after Java 8 is not basic XML validation, but Java EE/JAXB/JAX-WS bundled APIs/tools.

Practical implication:

```text
XSD validation via javax.xml.validation: still Java SE.
XSD-to-Java binding via JAXB/XJC: must manage dependencies/tools explicitly on Java 11+.
SOAP/JAX-WS codegen/runtime: must manage dependencies/tools explicitly on Java 11+.
```

### 34.3 Build Discipline

For Java 8–25 multi-version learning/project:

- Pin JAXB/Jakarta XML Binding plugin version.
- Pin generated source directory.
- Do not commit generated code unless project policy requires it.
- If committing generated code, record generator version.
- Run generated-code diff review when XSD changes.
- Test with target JDK.
- Avoid relying on JDK-bundled `xjc` for modern builds.

---

## 35. Decision Matrix: How Strict Should Schema Be?

| Boundary Type | Schema Strictness | Reason |
|---|---|---|
| Internal service-to-service, same team | moderate strict | faster evolution, but still validate critical fields |
| Cross-team enterprise integration | strict with extension points | clear ownership and compatibility |
| External partner integration | strict | avoid ambiguous responsibility |
| Regulatory submission | very strict | auditability, legal defensibility |
| Event archive | schema plus evolution metadata | replay and long-term compatibility |
| Legacy SOAP interop | strict but conservative constructs | tooling compatibility |
| Document-like rich text | limited structure + content controls | mixed content is hard to bind |

---

## 36. Production Checklist for XSD Contracts

### 36.1 Schema Design

- [ ] Has stable `targetNamespace`.
- [ ] Uses clear versioning strategy.
- [ ] Uses `elementFormDefault="qualified"` unless there is a reason not to.
- [ ] Avoids everything-as-string.
- [ ] Uses named global complex types for reusable structures.
- [ ] Uses simple type restrictions for codes, amounts, dates, identifiers.
- [ ] Distinguishes absent, empty, and nil semantics.
- [ ] Avoids uncontrolled `xs:any`.
- [ ] Avoids excessive polymorphism unless required.
- [ ] Documents business meaning, not just field syntax.

### 36.2 Compatibility

- [ ] Has valid XML samples.
- [ ] Has invalid XML samples.
- [ ] Has compatibility tests against previous version.
- [ ] Checks generated Java API diff.
- [ ] Checks old consumer behavior for new enum values.
- [ ] Checks sequence order changes.
- [ ] Checks namespace changes.

### 36.3 Java Runtime

- [ ] Caches `Schema`, not `Validator`.
- [ ] Creates new `Validator` per validation.
- [ ] Disables external DTD/schema access.
- [ ] Does not trust `xsi:schemaLocation` from payload.
- [ ] Resolves imports/includes locally.
- [ ] Adds line/column validation errors where safe.
- [ ] Does not log sensitive full XML payload by default.

### 36.4 Security

- [ ] Secure processing enabled.
- [ ] External entity disabled at parser layer.
- [ ] External schema access restricted.
- [ ] Max payload size enforced before parse.
- [ ] Max element depth considered.
- [ ] Attachment/binary size considered separately.
- [ ] Validation errors sanitized for external response.

### 36.5 Governance

- [ ] Schema has owner.
- [ ] Schema artifact is versioned.
- [ ] Released schema is immutable.
- [ ] Breaking change requires new major version/namespace.
- [ ] Consumers are notified with migration guide.
- [ ] Contract examples are published.

---

## 37. Common Interview/Architecture Questions

### 37.1 Why Use XSD If Application Already Validates?

Because XSD catches structural and lexical invalidity before application semantics:

```text
wrong root
wrong namespace
missing required field
wrong order
invalid enum
invalid date lexical value
invalid decimal precision
unexpected element
```

Application validation then handles business rules:

```text
status transition
authorization
cross-field condition
database existence
lifecycle rules
idempotency
```

The two are complementary.

### 37.2 Is Adding Optional Element Backward Compatible?

Only partly.

Schema-theoretically, adding optional element can be backward compatible for new consumers reading old messages. But producer-new to consumer-old can fail if old consumer validates against old schema and rejects unknown element.

So the real answer:

```text
It depends on direction, validation strictness, binding tolerance, sequence position, and business semantics.
```

### 37.3 Why Does JAXB Generate `JAXBElement`?

Usually because the schema requires preserving XML element identity beyond just Java type, such as:

- global element refs,
- nillable elements,
- substitution groups,
- choice,
- ambiguous element/type mapping.

`JAXBElement<T>` carries QName, declared type, scope, nil state, and value.

### 37.4 Should We Use XSD 1.1 Assertions?

Only if every relevant validator/tool supports XSD 1.1. In SOAP/JAXB enterprise interop, XSD 1.0 remains safer. Put cross-field business rules in application validation unless verified otherwise.

### 37.5 Should Namespace Include Version?

For major breaking versions, usually yes. For minor compatible changes, sometimes no. The decision depends on consumer validation style, code generation, deployment coexistence, and governance maturity.

---

## 38. Mental Model Summary

XSD is best understood as:

```text
A formal grammar for XML business messages.
```

It defines:

```text
Vocabulary     -> element/attribute names
Structure      -> sequence/choice/all/cardinality
Typing         -> simple/complex types
Constraints    -> facets, identity constraints
Namespace      -> QName identity
Extensibility  -> any, substitution group, type derivation
Evolution      -> compatibility and versioning model
```

The strongest engineers do not treat XSD as ceremony. They use it to make integration behavior explicit.

Key distinctions:

```text
well-formed XML   = syntactically valid XML
valid XML         = conforms to schema/DTD
bound XML         = mapped into Java object model
trusted XML       = parsed, validated, authorized, and semantically checked safely
```

Never confuse those four.

---

## 39. Practical Heuristics

1. Prefer schema-first for SOAP/external/regulatory integration.
2. Use named types for reusable enterprise contracts.
3. Keep namespaces explicit and stable.
4. Treat enum additions as potentially breaking.
5. Treat cardinality changes as API changes.
6. Never trust payload-provided schema locations.
7. Cache compiled `Schema`, not `Validator`.
8. Use local schema catalogs/resources.
9. Do not encode lifecycle/business authorization rules in XSD alone.
10. Test generated Java code as part of contract compatibility.

---

## 40. References

- W3C, **XML Schema Part 1: Structures Second Edition** — defines XML Schema structures for constraining XML document classes.  
  https://www.w3.org/TR/xmlschema-1/

- W3C, **XML Schema Part 2: Datatypes Second Edition** — defines built-in datatypes and constraining facets.  
  https://www.w3.org/TR/xmlschema-2/

- W3C, **XML Schema Definition Language (XSD) 1.1 Part 1: Structures** — XSD 1.1 structures specification.  
  https://www.w3.org/TR/xmlschema11-1/

- Oracle Java API, **javax.xml.validation package** — Java XML validation API.  
  https://docs.oracle.com/en/java/javase/11/docs/api/java.xml/javax/xml/validation/package-summary.html

- Oracle Java API, **SchemaFactory** — schema compiler and validation entry point.  
  https://docs.oracle.com/en/java/javase/21/docs/api/java.xml/javax/xml/validation/SchemaFactory.html

- Oracle Java API, **Schema** — immutable in-memory representation of grammar; shareable across validations.  
  https://docs.oracle.com/javase/8/docs/api/javax/xml/validation/Schema.html

- Jakarta XML Binding Specification — XML-to-Java binding model used heavily with XSD-generated classes.  
  https://jakarta.ee/specifications/xml-binding/4.0/

- Eclipse JAXB RI Documentation — practical Jakarta XML Binding implementation and tooling documentation.  
  https://eclipse-ee4j.github.io/jaxb-ri/4.0.5/docs/

---

## 41. Status Series

Part 14 selesai.

Seri belum selesai. Berikutnya:

```text
Part 15 — XML Security: XXE, Entity Expansion, SSRF, XInclude, Schema Poisoning, XPath Injection, XML Signature Wrapping Overview, Hardened Parser Templates
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Learn Java JSON/XML/SOAP/Connectors Enterprise Integration — Part 13](./learn-java-json-xml-soap-connectors-enterprise-integration-part-013.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-json-xml-soap-connectors-enterprise-integration — Part 15](./learn-java-json-xml-soap-connectors-enterprise-integration-part-015.md)
