# Part 17 — XML Edge Cases: Namespace, XSD, SOAP-ish Payloads, Canonicalization

> Seri: `learn-java-data-mapper-json-xml-jackson-mapstruct-lombok-transformation-engineering`  
> File: `17-xml-edge-cases-namespace-xsd-soapish-payloads-canonicalization.md`  
> Target: Java 8 sampai Java 25  
> Fokus: XML edge cases yang sering muncul di enterprise/regulatory integration: namespace, XSD, envelope, canonicalization, XML signature, parser safety, dan contract testing.

---

## 1. Posisi Part Ini dalam Seri

Pada part sebelumnya, kita membahas XML mapping modern dengan JAXB/Jakarta XML Binding dan Jackson XML. Bagian itu menjawab pertanyaan:

> “Bagaimana object Java bisa di-bind ke XML dan sebaliknya?”

Part ini menjawab pertanyaan yang lebih sulit:

> “Mengapa XML yang terlihat benar masih gagal diterima sistem lain, gagal divalidasi XSD, gagal diverifikasi signature, atau gagal di-parse secara aman?”

Di banyak sistem enterprise, XML bukan hanya format data. XML sering menjadi:

- kontrak antar agency/system;
- payload legacy yang tidak bisa bebas diubah;
- dokumen legal/regulatory;
- SOAP-like envelope;
- file batch;
- signed document;
- canonical document;
- archival/audit artifact;
- integration payload dengan XSD ketat.

Karena itu XML engineering tidak boleh diperlakukan sama seperti JSON biasa.

JSON cenderung gagal karena shape, null, enum, atau type ambiguity. XML punya kelas masalah tambahan:

- namespace URI vs prefix;
- element vs attribute;
- order sensitivity;
- whitespace sensitivity;
- text node campuran;
- XSD optionality;
- default namespace;
- canonicalization;
- digital signature;
- external entity;
- schema validation side effects;
- SOAP-style envelope/body/header separation.

Part ini akan membangun mental model agar kamu bisa mendesain XML mapping yang tahan terhadap masalah-masalah tersebut.

---

## 2. Mental Model Utama: XML Bukan Tree Sederhana

Banyak developer membayangkan XML sebagai tree sederhana:

```xml
<Customer>
  <Name>Alice</Name>
  <Email>alice@example.com</Email>
</Customer>
```

Lalu diasumsikan mirip JSON:

```json
{
  "customer": {
    "name": "Alice",
    "email": "alice@example.com"
  }
}
```

Ini tidak sepenuhnya benar.

XML membawa informasi tambahan yang sering menentukan makna:

```xml
<cust:Customer xmlns:cust="urn:example:customer:v1" id="C001">
  <cust:Name>Alice</cust:Name>
  <cust:Email verified="true">alice@example.com</cust:Email>
</cust:Customer>
```

Dalam XML, makna node dipengaruhi oleh:

- local name: `Customer`, `Name`, `Email`;
- namespace URI: `urn:example:customer:v1`;
- prefix: `cust`, yang hanya alias lexical;
- attribute: `id`, `verified`;
- element ordering;
- whitespace;
- text node;
- schema type;
- default value dari schema;
- canonical form;
- encoding;
- entity expansion;
- processing instruction;
- comments;
- signature reference.

Sehingga mental model yang lebih benar:

```text
XML document = lexical text + infoset + namespace binding + schema contract + parser configuration + canonicalization rules + application meaning
```

Jika salah satu layer berubah, hasil integrasi bisa berubah.

---

## 3. Edge Case 1: Namespace URI Bukan Prefix

### 3.1 Kesalahan umum

Kesalahan paling umum dalam XML integration adalah menganggap prefix sebagai identitas namespace.

Contoh:

```xml
<a:Customer xmlns:a="urn:customer:v1">
  <a:Name>Alice</a:Name>
</a:Customer>
```

Secara namespace-aware, ini setara dengan:

```xml
<cust:Customer xmlns:cust="urn:customer:v1">
  <cust:Name>Alice</cust:Name>
</cust:Customer>
```

Yang penting adalah:

```text
namespace URI = urn:customer:v1
local name    = Customer
```

Bukan:

```text
prefix = a / cust
```

Prefix hanyalah alias di dokumen. Aplikasi yang memvalidasi berdasarkan prefix biasanya rapuh.

### 3.2 Implikasi untuk Java mapping

Jika menggunakan DOM/StAX/JAXB/Jackson XML, pastikan parser dan binder namespace-aware.

Contoh konsep DOM:

```java
DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
factory.setNamespaceAware(true);
```

Jika `namespaceAware` false, parser bisa memperlakukan `cust:Customer` sebagai nama mentah, bukan kombinasi namespace URI + local name. Ini membuat aplikasi mudah rusak ketika prefix berubah.

### 3.3 Desain yang benar

Gunakan key konseptual:

```text
ExpandedName = { namespaceURI, localName }
```

Bukan:

```text
qualifiedName = prefix:localName
```

Dalam review XML mapping, selalu tanya:

- apakah sistem menggunakan namespace URI atau prefix?
- apakah default namespace diuji?
- apakah prefix berbeda tetap diterima?
- apakah XSD import/include namespace sudah benar?
- apakah generated XML memakai namespace yang diharapkan partner?

---

## 4. Edge Case 2: Default Namespace

Default namespace sering lebih berbahaya daripada prefixed namespace karena terlihat “bersih”.

```xml
<Customer xmlns="urn:customer:v1">
  <Name>Alice</Name>
</Customer>
```

Secara visual, `Customer` dan `Name` terlihat tanpa prefix. Tetapi secara namespace-aware, keduanya berada di namespace:

```text
urn:customer:v1
```

Bandingkan dengan ini:

```xml
<Customer>
  <Name>Alice</Name>
</Customer>
```

Ini tidak berada dalam namespace apa pun.

Keduanya bukan dokumen yang sama.

### 4.1 Kesalahan umum

Partner system meminta:

```xml
<Customer xmlns="urn:customer:v1">
```

Tapi aplikasi mengirim:

```xml
<Customer>
```

Secara mata manusia terlihat sama, tapi secara kontrak XML berbeda total.

### 4.2 Dampak pada JAXB

Dengan JAXB/Jakarta XML Binding, namespace biasanya dikendalikan melalui annotation:

```java
@XmlRootElement(name = "Customer", namespace = "urn:customer:v1")
public class CustomerXml {
    @XmlElement(name = "Name", namespace = "urn:customer:v1")
    private String name;
}
```

Atau lewat `package-info.java`:

```java
@jakarta.xml.bind.annotation.XmlSchema(
    namespace = "urn:customer:v1",
    elementFormDefault = jakarta.xml.bind.annotation.XmlNsForm.QUALIFIED
)
package com.example.customer.xml;
```

`elementFormDefault = QUALIFIED` penting karena menentukan apakah element lokal harus berada dalam namespace.

### 4.3 Checklist default namespace

Untuk XML contract ketat, test minimal:

1. XML dengan prefix `cust`.
2. XML dengan prefix lain, misalnya `x`.
3. XML dengan default namespace.
4. XML tanpa namespace.
5. XML dengan namespace URI salah.
6. XML dengan namespace benar tapi prefix tidak sesuai contoh.

Aplikasi yang benar seharusnya menerima variasi 1 sampai 3 jika kontraknya namespace-equivalent, dan menolak 4 sampai 5 jika namespace wajib.

---

## 5. Edge Case 3: Attribute Tidak Terpengaruh Default Namespace Secara Sama

Ini salah satu jebakan paling sering.

```xml
<Customer xmlns="urn:customer:v1" id="C001">
  <Name>Alice</Name>
</Customer>
```

Element `Customer` dan `Name` berada di namespace `urn:customer:v1`.

Tetapi attribute `id` **tidak otomatis** berada di default namespace.

Attribute tanpa prefix berada di no namespace.

Kalau ingin attribute namespaced:

```xml
<Customer xmlns="urn:customer:v1"
          xmlns:c="urn:customer:v1"
          c:id="C001">
  <Name>Alice</Name>
</Customer>
```

Ini berbeda dengan:

```xml
<Customer xmlns="urn:customer:v1" id="C001">
```

### 5.1 Implikasi mapping

Jika XSD mendefinisikan attribute no-namespace, mapping-nya berbeda dari attribute namespaced.

Dalam JAXB:

```java
@XmlAttribute(name = "id")
private String id;
```

berbeda dari:

```java
@XmlAttribute(name = "id", namespace = "urn:customer:v1")
private String id;
```

### 5.2 Review question

Saat menerima XSD atau contoh XML dari partner, jangan hanya lihat sample. Tanyakan:

```text
Apakah attribute ini no-namespace atau namespace-qualified?
```

Karena sample XML kadang tidak cukup jelas bagi developer yang tidak terbiasa namespace.

---

## 6. Edge Case 4: XSD Optionality Bukan Sama dengan Java Nullability

XSD punya beberapa konsep yang sering diterjemahkan secara salah ke Java:

```xml
<xs:element name="middleName" type="xs:string" minOccurs="0"/>
```

Artinya element boleh tidak muncul.

```xml
<xs:element name="middleName" type="xs:string" nillable="true"/>
```

Artinya element boleh muncul dengan `xsi:nil="true"`.

```xml
<middleName/>
```

Artinya element muncul dengan empty content.

```xml
<middleName></middleName>
```

Sering dianggap sama dengan empty content.

```xml
<middleName xsi:nil="true" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"/>
```

Artinya nil eksplisit.

Keempat kondisi ini berbeda secara kontrak:

| XML Shape | Makna Potensial |
|---|---|
| element absent | tidak dikirim / unknown / not applicable |
| empty element | dikirim tetapi empty string/container |
| `xsi:nil="true"` | eksplisit null |
| element berisi whitespace | bisa empty setelah trim, atau meaningful jika whitespace-preserving |

### 6.1 Masalah di Java

Java field `String middleName` hanya punya nilai:

```text
null
""
"   "
"Alice"
```

Java tidak bisa langsung membedakan:

- absent;
- explicit nil;
- empty element;
- blank content;
- defaulted by schema.

Jika perbedaan itu penting, jangan langsung bind ke domain model sederhana.

Gunakan wrapper:

```java
public final class XmlField<T> {
    private final boolean present;
    private final boolean explicitNil;
    private final T value;

    private XmlField(boolean present, boolean explicitNil, T value) {
        this.present = present;
        this.explicitNil = explicitNil;
        this.value = value;
    }

    public static <T> XmlField<T> absent() {
        return new XmlField<>(false, false, null);
    }

    public static <T> XmlField<T> nil() {
        return new XmlField<>(true, true, null);
    }

    public static <T> XmlField<T> value(T value) {
        return new XmlField<>(true, false, value);
    }

    public boolean isPresent() { return present; }
    public boolean isExplicitNil() { return explicitNil; }
    public T getValue() { return value; }
}
```

Tidak semua sistem butuh ini. Tetapi untuk PATCH-like XML, legal document, atau regulatory form, distinction seperti ini bisa penting.

---

## 7. Edge Case 5: Element Order Matters

JSON object field order biasanya tidak bermakna secara semantik. XML sering berbeda.

XSD bisa menentukan urutan dengan `xs:sequence`:

```xml
<xs:complexType name="CustomerType">
  <xs:sequence>
    <xs:element name="Name" type="xs:string"/>
    <xs:element name="Email" type="xs:string"/>
  </xs:sequence>
</xs:complexType>
```

Maka XML ini valid:

```xml
<Customer>
  <Name>Alice</Name>
  <Email>alice@example.com</Email>
</Customer>
```

Tapi ini bisa tidak valid:

```xml
<Customer>
  <Email>alice@example.com</Email>
  <Name>Alice</Name>
</Customer>
```

### 7.1 JAXB ordering

Gunakan `@XmlType(propOrder = ...)` jika ordering wajib:

```java
@XmlAccessorType(XmlAccessType.FIELD)
@XmlType(name = "CustomerType", propOrder = {"name", "email"})
@XmlRootElement(name = "Customer")
public class CustomerXml {
    @XmlElement(name = "Name")
    private String name;

    @XmlElement(name = "Email")
    private String email;
}
```

### 7.2 Design insight

Kalau XML dikirim ke partner yang validate XSD, serialization order adalah bagian dari contract.

Karena itu jangan biarkan order tergantung reflection order, compiler behavior, atau incidental field order.

Top-level rule:

```text
For contract XML, element order must be intentional.
```

---

## 8. Edge Case 6: `xs:choice` Sulit Dipetakan ke POJO Biasa

XSD bisa mendefinisikan pilihan:

```xml
<xs:choice>
  <xs:element name="Individual" type="IndividualType"/>
  <xs:element name="Company" type="CompanyType"/>
</xs:choice>
```

Artinya hanya salah satu boleh muncul.

Java POJO naif:

```java
public class PartyXml {
    private IndividualXml individual;
    private CompanyXml company;
}
```

Masalah:

- dua-duanya null;
- dua-duanya non-null;
- invariant tidak terlihat di type system;
- mapper harus melakukan validation manual.

Model yang lebih eksplisit di Java modern:

```java
public sealed interface PartyXml permits IndividualPartyXml, CompanyPartyXml {
}

public record IndividualPartyXml(IndividualXml individual) implements PartyXml {
}

public record CompanyPartyXml(CompanyXml company) implements PartyXml {
}
```

Namun JAXB/Jackson XML binding untuk sealed hierarchy bisa lebih kompleks. Pada Java 8 legacy, bisa gunakan wrapper dengan invariant factory:

```java
public final class PartyChoice {
    private final IndividualXml individual;
    private final CompanyXml company;

    private PartyChoice(IndividualXml individual, CompanyXml company) {
        this.individual = individual;
        this.company = company;
    }

    public static PartyChoice individual(IndividualXml value) {
        if (value == null) throw new IllegalArgumentException("individual is required");
        return new PartyChoice(value, null);
    }

    public static PartyChoice company(CompanyXml value) {
        if (value == null) throw new IllegalArgumentException("company is required");
        return new PartyChoice(null, value);
    }

    public boolean isIndividual() { return individual != null; }
    public boolean isCompany() { return company != null; }
}
```

### 8.1 Rule

Jika XSD memakai `choice`, jangan desain Java model seolah-olah semua field optional biasa.

`choice` adalah invariant, bukan sekadar nullability.

---

## 9. Edge Case 7: Mixed Content

XML bisa memiliki mixed content:

```xml
<Paragraph>Hello <Bold>world</Bold>, welcome.</Paragraph>
```

Ini bukan struktur object sederhana:

```text
Paragraph
├── text: "Hello "
├── element: Bold("world")
└── text: ", welcome."
```

Jika kamu bind ke:

```java
public class ParagraphXml {
    private String text;
    private String bold;
}
```

kamu kehilangan ordering antara text dan element.

### 9.1 Kapan mixed content muncul?

- dokumen legal;
- rich text;
- template surat;
- XHTML-like payload;
- notification body;
- regulatory form dengan markup;
- SOAP fault detail tertentu;
- archival document.

### 9.2 Strategi mapping

Ada tiga strategi:

#### Strategi A — Treat as opaque XML

Simpan bagian mixed content sebagai raw XML fragment.

Cocok jika aplikasi tidak perlu memahami detail internal.

```java
public final class RichTextFragment {
    private final String rawXml;
}
```

#### Strategi B — Tree model

Gunakan DOM/Jackson tree/StAX event sequence.

Cocok jika perlu inspect tetapi tidak full binding.

#### Strategi C — Domain-specific document model

Modelkan sebagai list node:

```java
public sealed interface InlineNode permits TextNode, BoldNode, LinkNode {
}

public record TextNode(String text) implements InlineNode {}
public record BoldNode(List<InlineNode> children) implements InlineNode {}
public record LinkNode(String href, List<InlineNode> children) implements InlineNode {}
```

Cocok jika rich text adalah domain penting.

### 9.3 Rule

Untuk mixed content:

```text
POJO field-per-element mapping is often the wrong abstraction.
```

---

## 10. Edge Case 8: Whitespace Can Be Data

Dalam JSON, whitespace di luar string tidak bermakna. Dalam XML, whitespace dalam text node bisa bermakna.

Contoh:

```xml
<Name>Alice</Name>
```

berbeda dari:

```xml
<Name> Alice </Name>
```

Tergantung schema dan aplikasi, whitespace bisa:

- insignificant;
- trimmed;
- collapsed;
- preserved;
- part of signature;
- part of document text.

XSD type juga mempengaruhi whitespace behavior. Beberapa type memiliki whitespace normalization.

### 10.1 XML signature warning

Jika dokumen sudah ditandatangani, formatting ulang XML bisa membatalkan signature.

Contoh perubahan yang tampak harmless:

```xml
<Customer><Name>Alice</Name></Customer>
```

menjadi:

```xml
<Customer>
  <Name>Alice</Name>
</Customer>
```

Secara business data mungkin sama. Secara bytes/canonicalized data/signature bisa berbeda tergantung canonicalization dan transform yang dipakai.

### 10.2 Rule

Jangan pretty-print signed XML kecuali kamu memahami canonicalization dan signature transform-nya.

---

## 11. Edge Case 9: XML Canonicalization

Canonicalization adalah proses mengubah XML ke bentuk canonical sebelum digest/signature atau perbandingan tertentu.

Kenapa perlu?

Karena XML yang secara infoset setara bisa punya lexical representation berbeda:

```xml
<Customer id="C001" type="VIP"/>
```

```xml
<Customer type="VIP" id="C001"></Customer>
```

Perbedaan lain:

- attribute order;
- namespace declaration placement;
- empty element syntax;
- whitespace;
- line ending;
- character escaping;
- prefix declaration;
- comments.

Digital signature tidak bisa hanya digest “tampilan object” secara longgar. Ia butuh proses canonicalization yang deterministic.

### 11.1 Mental model signature XML

```text
Original XML
   ↓ parse / select signed node
Canonicalization transform
   ↓ canonical bytes
Digest
   ↓ digest value
Signature verification
```

Jika canonical bytes berubah, digest berubah, signature gagal.

### 11.2 Contoh masalah

Aplikasi menerima XML signed dari partner:

1. parse XML;
2. bind ke Java object;
3. serialize ulang;
4. verify signature.

Ini biasanya salah.

Kenapa?

Karena serialize ulang bisa mengubah:

- prefix;
- namespace declaration;
- attribute order;
- whitespace;
- empty element representation;
- comments;
- canonicalizable subset.

Signature harus diverifikasi terhadap XML original atau canonicalized form sesuai standard, bukan terhadap object yang sudah dibentuk ulang secara bebas.

### 11.3 Rule

```text
For signed XML, binding is not a neutral operation.
```

Verifikasi signature sebaiknya terjadi sebelum payload dipercaya, dan jangan bergantung pada reserialized POJO sebagai basis signature verification.

---

## 12. Edge Case 10: SOAP-ish Payloads Are Not Just XML Bodies

Banyak enterprise integration tidak memakai full SOAP stack modern, tapi payload-nya tetap SOAP-like:

```xml
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:app="urn:example:application:v1">
  <soapenv:Header>
    <app:CorrelationId>abc-123</app:CorrelationId>
    <app:ClientId>client-a</app:ClientId>
  </soapenv:Header>
  <soapenv:Body>
    <app:SubmitApplicationRequest>
      <app:ApplicationNo>A-001</app:ApplicationNo>
    </app:SubmitApplicationRequest>
  </soapenv:Body>
</soapenv:Envelope>
```

Naive mapper sering langsung mencari `SubmitApplicationRequest` tanpa memedulikan envelope/header.

Masalah:

- correlation id hilang;
- authentication/authorization header diabaikan;
- mustUnderstand tidak diproses;
- SOAP fault tidak dimodelkan;
- body namespace salah;
- partner butuh exact envelope version;
- security signature mungkin mencakup header + body.

### 12.1 Mapping model yang benar

Pisahkan envelope model dari business payload:

```java
public final class SoapLikeMessage<T> {
    private final SoapHeader header;
    private final T body;

    public SoapLikeMessage(SoapHeader header, T body) {
        this.header = header;
        this.body = body;
    }

    public SoapHeader getHeader() { return header; }
    public T getBody() { return body; }
}
```

Business mapper bekerja pada body, tapi integration adapter bertanggung jawab pada envelope.

```text
XML bytes
  → safe parser
  → envelope parser
  → header validation
  → body extraction
  → body schema validation
  → body mapping
  → application command
```

### 12.2 Rule

Jangan treat SOAP-ish XML sebagai “just DTO XML”. Envelope adalah protocol boundary.

---

## 13. Edge Case 11: XML Fault/Error Payload Tidak Sama dengan Success Payload

SOAP-like system sering punya bentuk error berbeda:

```xml
<soap:Fault>
  <faultcode>soap:Client</faultcode>
  <faultstring>Invalid application number</faultstring>
  <detail>
    <app:ValidationError>
      <app:Field>ApplicationNo</app:Field>
      <app:Code>REQUIRED</app:Code>
    </app:ValidationError>
  </detail>
</soap:Fault>
```

Jika mapper hanya mendesain success response, error response akan jatuh sebagai parse error generik.

Padahal application perlu membedakan:

- transport error;
- XML parse error;
- envelope error;
- schema validation error;
- remote validation error;
- remote business rejection;
- authentication error;
- signature error;
- timeout/retryable error.

### 13.1 Model error eksplisit

```java
public sealed interface PartnerResponse<T> permits PartnerSuccess, PartnerFault {
}

public record PartnerSuccess<T>(T body) implements PartnerResponse<T> {}

public record PartnerFault(
    String faultCode,
    String faultString,
    List<PartnerValidationError> details
) implements PartnerResponse<Void> {}
```

Untuk Java 8, gunakan class hierarchy biasa.

### 13.2 Rule

```text
If an XML integration has a success schema, it probably also needs an error schema.
```

---

## 14. Edge Case 12: XSD Validation Is Not Business Validation

XSD validation menjawab:

```text
Apakah XML ini sesuai grammar/schema?
```

Business validation menjawab:

```text
Apakah request ini masuk akal untuk state, role, policy, waktu, dan domain rule saat ini?
```

Contoh XSD bisa memastikan:

```xml
<ApplicationNo>A-001</ApplicationNo>
```

adalah string yang ada dan pattern-nya benar.

Tapi XSD tidak tahu:

- application sudah closed;
- user tidak boleh submit;
- amendment window sudah lewat;
- applicant sedang suspended;
- duplicate submission;
- state transition invalid;
- role tidak punya permission.

### 14.1 Pipeline yang benar

```text
Bytes
  → parser safety
  → well-formedness
  → namespace-aware parsing
  → schema validation
  → binding/mapping
  → semantic normalization
  → application validation
  → domain command
```

Jangan campur semua error menjadi “invalid XML”.

### 14.2 Error taxonomy

| Layer | Example | Response |
|---|---|---|
| Parse | XML malformed | technical rejection |
| Security | DTD/XXE attempt | security rejection |
| Namespace | wrong namespace URI | contract rejection |
| XSD | missing required element | contract validation error |
| Mapping | invalid enum conversion | mapping error |
| Semantic | code table unknown | integration/domain validation |
| Business | transition not allowed | business rejection |

Top engineer tidak hanya membuat mapper berhasil. Ia membuat kegagalan bisa dipahami.

---

## 15. Edge Case 13: XSD Defaults Can Hide Input Shape

XSD bisa mendefinisikan default value.

```xml
<xs:attribute name="status" type="xs:string" default="ACTIVE"/>
```

Jika parser/schema validation mengaktifkan default augmentation, aplikasi bisa melihat `status = ACTIVE` meskipun XML input tidak mengirim attribute status.

Ini berbahaya jika aplikasi perlu tahu:

- apakah sender mengirim field itu;
- apakah value default dari kontrak;
- apakah value hasil normalisasi;
- apakah user sengaja memilih status.

### 15.1 Design rule

Untuk sistem audit/regulatory:

```text
Preserve raw inbound payload or field presence metadata when defaults matter.
```

Jangan hanya simpan object hasil binding.

---

## 16. Edge Case 14: Code Generation dari XSD Tidak Selalu Menghasilkan Model yang Baik

Tool seperti JAXB XJC bisa menghasilkan Java class dari XSD. Ini berguna, tetapi jangan otomatis dianggap sebagai domain model.

Generated XML classes biasanya merepresentasikan contract structure, bukan domain abstraction.

Contoh generated class bisa punya:

- `JAXBElement<T>`;
- mutable list getter tanpa setter;
- awkward naming;
- deeply nested class;
- weak invariants;
- `Object` untuk choice/mixed content;
- XML-specific annotations;
- no business meaning.

### 16.1 Recommended architecture

```text
GeneratedXmlContractClass
        ↓ adapter mapper
InternalIntegrationDto
        ↓ semantic mapper
ApplicationCommand
        ↓ domain layer
```

Jangan lakukan:

```text
GeneratedXmlContractClass → domain aggregate langsung
```

### 16.2 Why?

Karena XSD model berubah karena partner contract. Domain model berubah karena business rule. Keduanya punya alasan perubahan yang berbeda.

Mencampurnya menciptakan coupling mahal.

---

## 17. Edge Case 15: Versioning Namespace

Banyak XML contract memakai namespace versioning:

```xml
urn:application:v1
urn:application:v2
```

Atau URL:

```xml
https://example.gov/schema/application/1.0
https://example.gov/schema/application/2.0
```

### 17.1 Pertanyaan desain

Jika v2 hanya menambah optional element, apakah namespace harus berubah?

Tidak selalu. Ada dua pendekatan:

#### Namespace versioned per major contract

```text
urn:application:v1
urn:application:v2
```

Cocok jika v2 incompatible secara signifikan.

#### Namespace stable, schema version lewat attribute/header

```xml
<Application schemaVersion="1.1" xmlns="urn:application">
```

Cocok jika evolusi additive dan ingin mempertahankan compatibility.

### 17.2 Trade-off

| Approach | Kelebihan | Risiko |
|---|---|---|
| namespace per major version | jelas, strict, mudah routing | banyak class/schema duplikat |
| stable namespace + version attr | lebih kompatibel | validation/routing lebih rumit |
| no explicit version | sederhana di awal | drift tidak terkendali |

### 17.3 Rule

Namespace versioning harus menjadi keputusan governance, bukan kebetulan dari code generator.

---

## 18. Edge Case 16: Partial XML Parsing

Untuk payload besar, jangan selalu bind seluruh XML ke object graph.

Contoh batch:

```xml
<Applications>
  <Application>...</Application>
  <Application>...</Application>
  <Application>...</Application>
</Applications>
```

Jika file berisi ratusan ribu record, DOM/JAXB full binding bisa membuat memory meledak.

Gunakan StAX/event streaming:

```java
XMLInputFactory factory = XMLInputFactory.newFactory();
XMLStreamReader reader = factory.createXMLStreamReader(inputStream);

while (reader.hasNext()) {
    int event = reader.next();
    if (event == XMLStreamConstants.START_ELEMENT
            && "Application".equals(reader.getLocalName())) {
        // parse one Application fragment or delegate to JAXB unmarshaller for this subtree
    }
}
```

### 18.1 Hybrid strategy

```text
StAX streaming outer loop
  → extract one record subtree
  → JAXB/Jackson bind one record
  → validate/process/write result
  → release memory
```

Ini sering lebih realistis daripada pure manual StAX untuk semua field.

### 18.2 Failure handling

Untuk batch XML, desain harus menjawab:

- apakah satu record gagal membatalkan seluruh file?
- apakah error dicatat per record?
- apakah original fragment disimpan untuk replay?
- apakah output partial success diperbolehkan?
- apakah ordering record penting?
- apakah validation dilakukan sebelum atau saat stream processing?

---

## 19. Edge Case 17: XXE dan Parser Safety

XML parser bisa berbahaya jika menerima untrusted XML tanpa konfigurasi aman.

Serangan XML External Entity dapat mencoba:

- membaca file lokal;
- melakukan SSRF;
- menyebabkan denial of service;
- mengeksfiltrasi data;
- memanfaatkan DTD/entity expansion.

Payload ilustratif:

```xml
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "file:///etc/passwd">
]>
<Customer>
  <Name>&xxe;</Name>
</Customer>
```

### 19.1 Principle

Untuk XML untrusted:

```text
Disable DTD and external entity resolution unless there is a strong, reviewed reason.
```

### 19.2 DOM factory hardening example

```java
DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
factory.setNamespaceAware(true);
factory.setXIncludeAware(false);
factory.setExpandEntityReferences(false);

factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
factory.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);
```

Feature support bisa berbeda antar parser implementation. Karena itu hardening code harus tested pada runtime parser yang benar-benar dipakai.

### 19.3 StAX hardening example

```java
XMLInputFactory factory = XMLInputFactory.newFactory();
factory.setProperty(XMLInputFactory.SUPPORT_DTD, false);
factory.setProperty("javax.xml.stream.isSupportingExternalEntities", false);
```

### 19.4 Schema validation warning

Schema validation kadang membutuhkan akses XSD eksternal/import. Jangan biarkan resolver mengambil resource sembarang dari internet/internal network.

Gunakan catalog/resolver eksplisit:

```text
schemaLocation URI → approved local resource
```

Bukan:

```text
schemaLocation URI → direct network fetch
```

---

## 20. Edge Case 18: SchemaLocation Tidak Boleh Dipercaya Begitu Saja

XML bisa membawa hint:

```xml
<Application
  xmlns="urn:application:v1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="urn:application:v1 https://partner.example/schema/application-v1.xsd">
```

`xsi:schemaLocation` adalah hint dari dokumen, bukan authority yang harus dipercaya aplikasi.

Jika aplikasi otomatis mengambil schema dari lokasi tersebut, risiko:

- SSRF;
- dependency ke network eksternal;
- schema poisoning;
- unpredictable validation;
- supply-chain risk;
- downtime jika URL schema tidak tersedia.

### 20.1 Rule

Production validator sebaiknya memakai schema yang sudah dipin/versioned di aplikasi atau artifact repository internal.

```text
Inbound XML says namespace = urn:application:v1
Application chooses approved schema for urn:application:v1
```

Bukan:

```text
Inbound XML tells application where to download schema
```

---

## 21. Edge Case 19: XML Date/Time Ambiguity

XML sering memakai `xs:date`, `xs:dateTime`, atau string custom.

Contoh:

```xml
<SubmittedAt>2026-06-17T10:15:30+07:00</SubmittedAt>
```

vs

```xml
<SubmittedAt>2026-06-17T03:15:30Z</SubmittedAt>
```

vs

```xml
<SubmittedDate>2026-06-17</SubmittedDate>
```

vs

```xml
<SubmittedAt>17/06/2026 10:15:30</SubmittedAt>
```

### 21.1 Java mapping choice

| XML Meaning | Java Type |
|---|---|
| date only | `LocalDate` |
| time only | `LocalTime` / `OffsetTime` |
| instant moment | `Instant` |
| datetime with offset | `OffsetDateTime` |
| local datetime without zone | `LocalDateTime` but be careful |
| legacy XMLGregorianCalendar | bridge type, not domain type |

### 21.2 Rule

Jangan ubah date/time menjadi `String` di domain hanya karena XML sulit.

Gunakan adapter di boundary:

```java
public final class XmlDateTimeAdapter {
    public OffsetDateTime parseSubmittedAt(String value) {
        return OffsetDateTime.parse(value);
    }

    public String formatSubmittedAt(OffsetDateTime value) {
        return value.toString();
    }
}
```

Untuk format custom, definisikan formatter eksplisit dan test timezone/offset.

---

## 22. Edge Case 20: XML Decimal and Money

XML numeric terlihat mudah:

```xml
<Amount>100.00</Amount>
```

Tapi mapping ke Java harus berhati-hati.

Jangan gunakan `double` untuk uang.

Gunakan:

```java
BigDecimal amount;
```

Tetapi `BigDecimal` sendiri punya detail:

```java
new BigDecimal("100.00")
new BigDecimal("100")
```

Nilai numeriknya sama, scale berbeda.

Untuk domain money, sering lebih baik punya value object:

```java
public final class Money {
    private final String currency;
    private final BigDecimal amount;

    public Money(String currency, BigDecimal amount) {
        if (currency == null || currency.isBlank()) throw new IllegalArgumentException("currency is required");
        if (amount == null) throw new IllegalArgumentException("amount is required");
        this.currency = currency;
        this.amount = amount;
    }
}
```

XML contract bisa berbentuk:

```xml
<Amount currency="SGD">100.00</Amount>
```

atau:

```xml
<Amount>100.00</Amount>
<Currency>SGD</Currency>
```

Keduanya mapping ke value object yang sama di domain.

---

## 23. Edge Case 21: Repeated Elements vs Wrapped Collections

XML collection bisa berupa:

```xml
<Emails>
  <Email>a@example.com</Email>
  <Email>b@example.com</Email>
</Emails>
```

atau:

```xml
<Customer>
  <Email>a@example.com</Email>
  <Email>b@example.com</Email>
</Customer>
```

atau bahkan:

```xml
<Email>a@example.com</Email>
<Email>b@example.com</Email>
```

Dalam Jackson XML, wrapper handling penting. Dalam JAXB, annotation `@XmlElementWrapper` dan `@XmlElement` menentukan shape.

### 23.1 JAXB example

```java
@XmlElementWrapper(name = "Emails")
@XmlElement(name = "Email")
private List<String> emails;
```

Tanpa wrapper:

```java
@XmlElement(name = "Email")
private List<String> emails;
```

### 23.2 Contract rule

Collection shape adalah bagian dari XML contract.

Jangan ubah wrapper hanya karena “lebih enak di Java”.

---

## 24. Edge Case 22: Cyclic Object Graph Tidak Cocok untuk XML Contract

Domain/entity graph bisa punya cycle:

```text
Customer → Applications → Customer
```

XML document seharusnya biasanya berbentuk tree, bukan object graph cyclic.

Jika entity langsung diserialize, bisa terjadi:

- infinite recursion;
- huge XML;
- leaking internal relationship;
- invalid contract;
- lazy-loading storm.

Rule:

```text
XML contract model must be a document tree, not an ORM graph.
```

Gunakan DTO khusus XML.

---

## 25. Edge Case 23: Comments and Processing Instructions

XML dapat berisi comment:

```xml
<!-- generated by partner system -->
<Customer>Alice</Customer>
```

Dan processing instruction:

```xml
<?xml-stylesheet type="text/xsl" href="style.xsl"?>
```

Biasanya mapping object tidak peduli. Tetapi untuk:

- canonicalization;
- signature;
- archival fidelity;
- document transformation;
- legal document;

comments/PI bisa relevan.

Jika sistem harus preserve dokumen, jangan bind lalu serialize ulang. Simpan raw XML atau canonical artifact sesuai requirement.

---

## 26. Edge Case 24: Encoding and BOM

XML bisa membawa declaration:

```xml
<?xml version="1.0" encoding="UTF-8"?>
```

Jika input stream encoding salah, karakter non-ASCII bisa rusak.

Aturan praktis:

- lebih aman parse dari `InputStream` daripada `Reader` jika ingin parser membaca XML declaration;
- pastikan transport tidak mengubah encoding;
- test karakter non-ASCII;
- test emoji jika contract mengizinkan;
- test BOM jika partner mengirim file batch;
- pastikan output encoding konsisten.

Untuk regulatory/archival systems, character corruption adalah data integrity incident, bukan cosmetic bug.

---

## 27. Edge Case 25: XML Diff Tidak Sama dengan Text Diff

Membandingkan XML dengan string diff bisa misleading.

Contoh:

```xml
<Customer id="1" type="VIP"/>
```

vs

```xml
<Customer type="VIP" id="1"></Customer>
```

Text diff berbeda. Infoset mungkin setara.

Namun untuk signed XML, lexical/canonical difference bisa penting.

### 27.1 Pilih jenis comparison berdasarkan tujuan

| Tujuan | Comparison |
|---|---|
| contract test biasa | namespace-aware XMLUnit style comparison |
| exact output required | string/golden file comparison |
| signature | canonicalization-aware verification |
| archival | byte-level preservation |
| business equality | mapped semantic object comparison |

Jangan gunakan satu jenis diff untuk semua tujuan.

---

## 28. XML Mapping Pipeline Production-Grade

Untuk inbound XML untrusted:

```text
[1] Receive bytes
    ↓
[2] Size limit / content-type / transport metadata check
    ↓
[3] Safe XML parser config
    - namespace aware
    - DTD disabled unless explicitly needed
    - external entity disabled
    - controlled resolver
    ↓
[4] Well-formedness parse
    ↓
[5] Envelope extraction if SOAP-ish
    ↓
[6] Signature verification if signed XML
    ↓
[7] Schema selection by trusted namespace/version
    ↓
[8] XSD validation
    ↓
[9] XML contract binding
    ↓
[10] Boundary normalization
    ↓
[11] Semantic mapping to internal DTO/command
    ↓
[12] Business validation/domain transition
    ↓
[13] Audit raw/canonical/semantic artifact as needed
```

Untuk outbound XML:

```text
[1] Domain/application result
    ↓
[2] Outbound integration DTO
    ↓
[3] XML contract object
    ↓
[4] Deterministic serialization
    - namespace
    - order
    - attributes
    - date/time
    - decimal
    ↓
[5] XSD validation of generated XML
    ↓
[6] Canonicalization/signing if needed
    ↓
[7] Transport send/store
    ↓
[8] Golden payload regression test
```

---

## 29. Implementation Pattern: XML Boundary Adapter

Jangan sebar XML parsing di service layer.

Gunakan boundary adapter:

```java
public interface XmlInboundAdapter<T> {
    T parse(byte[] payload);
}
```

Contoh struktur:

```text
com.example.integration.partnerx.xml
  PartnerXXmlParser
  PartnerXXmlValidator
  PartnerXXmlSignatureVerifier
  PartnerXEnvelopeMapper
  PartnerXContractMapper
  PartnerXCommandMapper
  PartnerXXmlErrorMapper
  PartnerXXmlFixtures
```

### 29.1 Example orchestration

```java
public final class PartnerXInboundXmlAdapter {
    private final SafeXmlParser parser;
    private final XmlSignatureVerifier signatureVerifier;
    private final XmlSchemaValidator schemaValidator;
    private final PartnerXContractBinder binder;
    private final PartnerXCommandMapper commandMapper;

    public PartnerXInboundXmlAdapter(
            SafeXmlParser parser,
            XmlSignatureVerifier signatureVerifier,
            XmlSchemaValidator schemaValidator,
            PartnerXContractBinder binder,
            PartnerXCommandMapper commandMapper
    ) {
        this.parser = parser;
        this.signatureVerifier = signatureVerifier;
        this.schemaValidator = schemaValidator;
        this.binder = binder;
        this.commandMapper = commandMapper;
    }

    public SubmitApplicationCommand parseSubmitApplication(byte[] payload) {
        ParsedXml parsed = parser.parse(payload);
        signatureVerifier.verifyIfRequired(parsed);
        schemaValidator.validate(parsed, "urn:partnerx:application:v1");
        PartnerXSubmitApplicationXml contract = binder.bindSubmitApplication(parsed);
        return commandMapper.toCommand(contract);
    }
}
```

Ini bukan soal over-engineering. Ini memisahkan responsibility:

- parser safety;
- signature;
- schema;
- binding;
- semantic mapping;
- command creation.

Jika semua dicampur di controller/service, failure handling dan testability akan buruk.

---

## 30. Implementation Pattern: Trusted Schema Registry

Untuk integrasi XML serius, buat registry schema internal.

```java
public final class XmlSchemaRegistry {
    private final Map<String, Schema> schemasByNamespace;

    public XmlSchemaRegistry(Map<String, Schema> schemasByNamespace) {
        this.schemasByNamespace = Map.copyOf(schemasByNamespace);
    }

    public Schema getSchema(String namespaceUri) {
        Schema schema = schemasByNamespace.get(namespaceUri);
        if (schema == null) {
            throw new UnknownXmlNamespaceException(namespaceUri);
        }
        return schema;
    }
}
```

Untuk Java 8, gunakan defensive copy manual daripada `Map.copyOf`.

Manfaat:

- tidak percaya `xsi:schemaLocation`;
- versi schema eksplisit;
- mudah audit;
- mudah test;
- tidak tergantung network;
- cocok untuk change review.

---

## 31. Implementation Pattern: XML Contract Test Matrix

Minimal test matrix untuk XML edge cases:

| Test | Tujuan |
|---|---|
| valid minimal XML | memastikan happy path minimal |
| valid full XML | semua optional field |
| wrong namespace | harus ditolak |
| different prefix same namespace | harus diterima jika namespace benar |
| default namespace | memastikan parser namespace-aware |
| missing required element | XSD validation error |
| invalid order | XSD validation error |
| nil element | behavior eksplisit |
| empty element | behavior eksplisit |
| unknown element | sesuai policy: reject/ignore |
| external entity | ditolak oleh parser |
| huge payload | size limit / streaming behavior |
| signed valid XML | signature verified |
| signed but reformatted XML | expected behavior jelas |
| invalid signature | security rejection |
| SOAP fault | mapped as remote fault |
| malformed XML | parse error |
| schemaLocation malicious URL | tidak di-fetch |

### 31.1 Golden payload organization

```text
src/test/resources/xml/partner-x/v1/
  valid-minimal.xml
  valid-full.xml
  invalid-wrong-namespace.xml
  invalid-order.xml
  invalid-xxe.xml
  invalid-schema-location-remote.xml
  fault-validation-error.xml
  signed-valid.xml
  signed-invalid.xml
```

---

## 32. Debugging XML Integration Failure

Saat partner berkata “XML kamu invalid”, jangan langsung ubah annotation random.

Gunakan checklist berikut.

### 32.1 Pertanyaan pertama

1. Invalid menurut apa?
   - parser?
   - XSD?
   - business validation?
   - signature verification?
   - SOAP processor?
   - custom validator?

2. Error terjadi di node mana?
   - line/column?
   - XPath?
   - namespace URI?
   - element local name?

3. XML yang gagal persis yang mana?
   - raw payload?
   - pretty-printed copy?
   - payload setelah gateway?
   - payload setelah signing?

4. Schema versi mana yang dipakai?
   - sama dengan yang kita pakai?
   - namespace cocok?
   - XSD import/include lengkap?

5. Apakah failure karena lexical form?
   - prefix expected?
   - canonicalization?
   - signature?
   - whitespace?

### 32.2 Debug flow

```text
raw XML bytes
  → save safely
  → validate well-formedness
  → inspect namespace URI/localName
  → validate against local XSD
  → compare with partner XSD if different
  → inspect canonicalization/signature if signed
  → compare with golden accepted sample
  → isolate smallest failing fragment
```

---

## 33. Anti-Patterns

### Anti-pattern 1: Treating XML like JSON with angle brackets

XML has namespace, attribute, ordering, mixed content, canonicalization, and signature concerns.

### Anti-pattern 2: Binding directly into domain entity

XML contract should not control domain shape.

### Anti-pattern 3: Trusting inbound schemaLocation

Schema must be selected by trusted application configuration.

### Anti-pattern 4: Disabling namespace awareness

This creates prefix-dependent bugs.

### Anti-pattern 5: Re-serializing signed XML before verification

Binding and serialization are not neutral for signed XML.

### Anti-pattern 6: Pretty-printing XML in signature flow

Formatting can alter meaningful/canonicalizable content.

### Anti-pattern 7: XSD validation as only validation

XSD is grammar validation, not business rule validation.

### Anti-pattern 8: Assuming generated XSD classes are domain models

Generated classes are contract artifacts.

### Anti-pattern 9: Ignoring fault payloads

Error shape is part of integration contract.

### Anti-pattern 10: Logging raw XML with secrets/PII

XML payload often contains personal or sensitive data. Logging must be redacted and governed.

---

## 34. Java 8 to Java 25 Considerations

### 34.1 Java 8

Typical stack:

- JAXB bundled in JDK 8;
- mutable POJO classes;
- `XMLGregorianCalendar` common;
- limited records/sealed types unavailable;
- manual wrappers for `choice`/invariant;
- defensive parser config still required.

### 34.2 Java 9 to 10

Module system introduced. JAXB availability becomes transitional/problematic depending on runtime/module usage.

### 34.3 Java 11+

JAXB removed from JDK distribution as part of Java EE/CORBA module removal. Use explicit Jakarta/XML Binding dependencies or external JAXB implementation.

### 34.4 Java 16+

Records available as stable feature. Useful for internal immutable DTOs, but XML binding frameworks may still be easier with classic classes depending on annotation and constructor support.

### 34.5 Java 17+

Sealed classes are useful to represent XML `choice` or envelope result types, especially internally after boundary parsing.

### 34.6 Java 21 to 25

Modern Java encourages:

- records for immutable internal DTO;
- sealed interface for sum types;
- pattern matching for mapping branches;
- explicit dependencies for XML binding;
- stronger build discipline;
- clearer separation between contract objects and domain objects.

But do not force records/sealed types at XML binding boundary if the framework friction is high. It is acceptable to use classic mutable XML contract classes at the edge, then map to modern immutable internal models.

---

## 35. Design Heuristics for Top-Level Engineers

### 35.1 If XML is external, isolate it

External XML model belongs in adapter layer.

### 35.2 If XML is signed, preserve raw/canonical form

Do not casually parse-bind-serialize.

### 35.3 If namespace matters, test namespace variants

Prefix changes should not break namespace-correct code.

### 35.4 If XSD exists, validate generated outbound XML

Outbound XML should be tested against the schema before partner finds the issue.

### 35.5 If payload is large, stream outer structure

Do not build huge DOM/object graph unnecessarily.

### 35.6 If XML is untrusted, harden parser first

Security config is not optional.

### 35.7 If field presence matters, model presence explicitly

`null` alone is not enough.

### 35.8 If generated classes are ugly, that may be correct

They mirror the external contract. Keep them at the boundary.

### 35.9 If partner gives only sample XML, ask for XSD and failure examples

Sample XML is not a complete contract.

### 35.10 If failure must be audited, preserve enough evidence

Store raw payload, canonical payload, schema version, validation result, error path, and correlation id according to data policy.

---

## 36. Worked Example: Regulatory Submission XML

Suppose we receive application submission from a partner.

### 36.1 XML

```xml
<sub:SubmitApplicationRequest
    xmlns:sub="urn:gov:application:submission:v1"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <sub:Header>
    <sub:MessageId>MSG-20260617-0001</sub:MessageId>
    <sub:SentAt>2026-06-17T10:15:30+07:00</sub:SentAt>
  </sub:Header>
  <sub:Application>
    <sub:ApplicationNo>A-001</sub:ApplicationNo>
    <sub:Applicant>
      <sub:Name>Alice</sub:Name>
      <sub:Email verified="true">alice@example.com</sub:Email>
    </sub:Applicant>
    <sub:DeclaredAmount currency="SGD">100.00</sub:DeclaredAmount>
  </sub:Application>
</sub:SubmitApplicationRequest>
```

### 36.2 Boundary contract class

```java
@XmlAccessorType(XmlAccessType.FIELD)
@XmlRootElement(
    name = "SubmitApplicationRequest",
    namespace = "urn:gov:application:submission:v1"
)
@XmlType(propOrder = {"header", "application"})
public class SubmitApplicationRequestXml {

    @XmlElement(name = "Header", namespace = "urn:gov:application:submission:v1", required = true)
    private HeaderXml header;

    @XmlElement(name = "Application", namespace = "urn:gov:application:submission:v1", required = true)
    private ApplicationXml application;

    public HeaderXml getHeader() {
        return header;
    }

    public void setHeader(HeaderXml header) {
        this.header = header;
    }

    public ApplicationXml getApplication() {
        return application;
    }

    public void setApplication(ApplicationXml application) {
        this.application = application;
    }
}
```

### 36.3 Internal command

```java
public record SubmitApplicationCommand(
    String messageId,
    OffsetDateTime sentAt,
    String applicationNo,
    Applicant applicant,
    Money declaredAmount
) {}
```

For Java 8:

```java
public final class SubmitApplicationCommand {
    private final String messageId;
    private final OffsetDateTime sentAt;
    private final String applicationNo;
    private final Applicant applicant;
    private final Money declaredAmount;

    public SubmitApplicationCommand(
            String messageId,
            OffsetDateTime sentAt,
            String applicationNo,
            Applicant applicant,
            Money declaredAmount
    ) {
        this.messageId = Objects.requireNonNull(messageId, "messageId");
        this.sentAt = Objects.requireNonNull(sentAt, "sentAt");
        this.applicationNo = Objects.requireNonNull(applicationNo, "applicationNo");
        this.applicant = Objects.requireNonNull(applicant, "applicant");
        this.declaredAmount = Objects.requireNonNull(declaredAmount, "declaredAmount");
    }

    public String getMessageId() { return messageId; }
    public OffsetDateTime getSentAt() { return sentAt; }
    public String getApplicationNo() { return applicationNo; }
    public Applicant getApplicant() { return applicant; }
    public Money getDeclaredAmount() { return declaredAmount; }
}
```

### 36.4 Mapper

```java
public final class SubmitApplicationXmlCommandMapper {

    public SubmitApplicationCommand toCommand(SubmitApplicationRequestXml xml) {
        if (xml == null) {
            throw new XmlMappingException("request is null");
        }
        if (xml.getHeader() == null) {
            throw new XmlMappingException("Header is required");
        }
        if (xml.getApplication() == null) {
            throw new XmlMappingException("Application is required");
        }

        HeaderXml header = xml.getHeader();
        ApplicationXml application = xml.getApplication();

        return new SubmitApplicationCommand(
            requireText(header.getMessageId(), "Header.MessageId"),
            parseOffsetDateTime(header.getSentAt(), "Header.SentAt"),
            requireText(application.getApplicationNo(), "Application.ApplicationNo"),
            mapApplicant(application.getApplicant()),
            mapMoney(application.getDeclaredAmount())
        );
    }

    private String requireText(String value, String path) {
        if (value == null || value.trim().isEmpty()) {
            throw new XmlMappingException(path + " is required");
        }
        return value.trim();
    }

    private OffsetDateTime parseOffsetDateTime(String value, String path) {
        try {
            return OffsetDateTime.parse(requireText(value, path));
        } catch (DateTimeParseException ex) {
            throw new XmlMappingException(path + " must be ISO-8601 offset datetime", ex);
        }
    }

    private Applicant mapApplicant(ApplicantXml xml) {
        if (xml == null) {
            throw new XmlMappingException("Application.Applicant is required");
        }
        return new Applicant(
            requireText(xml.getName(), "Application.Applicant.Name"),
            requireText(xml.getEmail(), "Application.Applicant.Email")
        );
    }

    private Money mapMoney(AmountXml xml) {
        if (xml == null) {
            throw new XmlMappingException("Application.DeclaredAmount is required");
        }
        String currency = requireText(xml.getCurrency(), "Application.DeclaredAmount.@currency");
        BigDecimal amount;
        try {
            amount = new BigDecimal(requireText(xml.getValue(), "Application.DeclaredAmount"));
        } catch (NumberFormatException ex) {
            throw new XmlMappingException("Application.DeclaredAmount must be decimal", ex);
        }
        return new Money(currency, amount);
    }
}
```

### 36.5 Why this design is strong

Karena ia memisahkan:

- XML contract object;
- semantic command object;
- field path error;
- date/time conversion;
- money conversion;
- required text normalization;
- boundary-specific exception.

Ia tidak menganggap XML binding sebagai domain validation.

---

## 37. Review Checklist

Gunakan checklist ini saat review XML mapping PR.

### Contract

- Apakah namespace URI benar?
- Apakah prefix tidak dijadikan identity?
- Apakah default namespace dites?
- Apakah element order eksplisit?
- Apakah attribute namespace benar?
- Apakah collection wrapper sesuai XSD?
- Apakah optional/nillable/empty dibedakan jika perlu?
- Apakah `choice` dimodelkan sebagai invariant?

### Security

- Apakah DTD disabled untuk untrusted XML?
- Apakah external entity disabled?
- Apakah schemaLocation tidak dipercaya langsung?
- Apakah resolver dikontrol?
- Apakah payload size limit ada?
- Apakah raw XML logging aman?

### Signature/canonicalization

- Apakah signature diverifikasi pada XML original/canonical form yang benar?
- Apakah pretty-print tidak mengubah signed payload?
- Apakah raw/canonical artifact disimpan jika perlu audit?

### Mapping

- Apakah XML contract class dipisah dari domain?
- Apakah generated XSD classes tidak bocor ke domain?
- Apakah mapper menghasilkan error dengan path jelas?
- Apakah date/time/decimal conversion eksplisit?
- Apakah fault payload dimodelkan?

### Testing

- Apakah valid/invalid namespace dites?
- Apakah wrong order dites?
- Apakah XXE payload dites?
- Apakah malicious schemaLocation dites?
- Apakah golden sample partner dites?
- Apakah outbound XML divalidasi XSD?
- Apakah large payload strategy dites?

---

## 38. Ringkasan Mental Model

XML edge cases sulit karena XML bukan hanya data tree.

Yang harus kamu ingat:

1. Namespace identity adalah URI + local name, bukan prefix.
2. Default namespace membuat element terlihat sederhana tetapi tetap namespaced.
3. Attribute tanpa prefix tidak otomatis ikut default namespace.
4. XSD optional/nillable/empty tidak sama dengan Java null.
5. Element order bisa menjadi bagian dari contract.
6. `choice` adalah invariant, bukan sekadar dua field nullable.
7. Mixed content tidak cocok untuk POJO biasa.
8. Whitespace kadang data, kadang noise, kadang signature-sensitive.
9. Canonicalization penting untuk digest/signature.
10. SOAP-ish XML punya envelope/header/body contract.
11. Fault payload harus dimodelkan.
12. XSD validation bukan business validation.
13. Generated XSD classes adalah boundary contract, bukan domain model.
14. Untrusted XML parser harus hardened.
15. Schema harus dipilih dari trusted registry, bukan schemaLocation inbound.
16. Large XML butuh streaming atau hybrid parsing.
17. Signed XML tidak boleh sembarang di-bind dan serialize ulang.

Top 1% engineer tidak hanya bisa membuat XML parse berhasil. Ia bisa menjelaskan:

- apa identitas node XML;
- apa grammar contract-nya;
- apa semantic meaning-nya;
- apa security boundary-nya;
- apa evidence audit-nya;
- apa compatibility policy-nya;
- apa failure mode-nya.

---

## 39. Latihan

### Latihan 1

Diberikan dua XML berikut:

```xml
<a:Customer xmlns:a="urn:customer:v1"><a:Name>Alice</a:Name></a:Customer>
```

```xml
<b:Customer xmlns:b="urn:customer:v1"><b:Name>Alice</b:Name></b:Customer>
```

Jelaskan apakah keduanya sama secara namespace-aware. Lalu buat test yang memastikan parser kamu tidak bergantung pada prefix.

### Latihan 2

Buat model Java untuk XSD `choice` antara `IndividualApplicant` dan `CompanyApplicant`. Buat versi Java 8 dan versi Java 17+ dengan sealed interface.

### Latihan 3

Buat XML parser hardening utility untuk DOM dan StAX. Tambahkan test dengan payload XXE yang harus ditolak.

### Latihan 4

Buat pipeline inbound untuk signed SOAP-like XML. Jelaskan urutan parse, signature verification, schema validation, envelope extraction, dan body mapping.

### Latihan 5

Ambil sample XML partner. Buat test matrix:

- valid full;
- valid minimal;
- wrong namespace;
- wrong order;
- missing required field;
- empty field;
- nil field;
- malicious schemaLocation;
- external entity;
- fault response.

---

## 40. Penutup

Part ini menutup pembahasan XML edge cases. Setelah memahami ini, kita punya fondasi untuk menghadapi integrasi XML enterprise yang jauh lebih realistis daripada sekadar annotation mapping.

Berikutnya kita masuk ke MapStruct sebagai compile-time mapper/code generator.

Part berikutnya:

```text
18-mapstruct-mental-model-compile-time-mapping-generated-code.md
```

Di sana kita akan membahas bagaimana MapStruct bekerja sebagai annotation processor, kenapa generated code penting, kenapa ia berbeda dari reflection mapper, bagaimana membaca hasil generated implementation, dan bagaimana menempatkannya dalam arsitektur mapping yang sudah kita bangun sejak Part 0.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 16 — XML Mapping in Modern Java: JAXB/Jakarta XML Binding and Jackson XML](./16-xml-mapping-modern-java-jaxb-jakarta-xml-binding-jackson-xml.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 18 — MapStruct Mental Model: Compile-Time Mapping and Generated Code](./18-mapstruct-mental-model-compile-time-mapping-generated-code.md)
