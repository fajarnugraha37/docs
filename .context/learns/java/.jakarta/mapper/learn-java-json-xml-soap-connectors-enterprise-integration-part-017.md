# Part 17 — JAXB / Jakarta XML Binding Annotation Deep Dive

Series: `learn-java-json-xml-soap-connectors-enterprise-integration`  
File: `learn-java-json-xml-soap-connectors-enterprise-integration-part-017.md`  
Target Java: 8 sampai 25  
Target API namespace: `javax.xml.bind.annotation` dan `jakarta.xml.bind.annotation`  
Prerequisite langsung: Part 16 JAXB / Jakarta XML Binding Core

---

## 1. Posisi Part Ini Dalam Seri

Pada Part 16 kita sudah membangun fondasi JAXB/Jakarta XML Binding:

```text
XML document
    ↕
binding metadata
    ↕
Java object graph
```

Kita sudah melihat bahwa `JAXBContext` adalah registry metadata, `Marshaller` menulis object ke XML, dan `Unmarshaller` membaca XML menjadi object graph.

Part ini masuk jauh lebih detail ke **annotation layer**.

Annotation JAXB bukan hanya dekorasi. Annotation adalah cara Java class menyatakan:

- nama XML element;
- namespace XML;
- urutan element;
- apakah field menjadi element atau attribute;
- apakah property boleh hilang, kosong, atau eksplisit `xsi:nil`;
- bagaimana wrapper list dibentuk;
- bagaimana root element dikenali;
- bagaimana inheritance dan polymorphism direpresentasikan;
- bagaimana wildcard/extensibility point diterima;
- bagaimana XML schema dapat dihasilkan dari model Java;
- bagaimana model Java menjaga compatibility dengan external XML contract.

Mental model utama part ini:

```text
JAXB annotation = mapping contract, not implementation detail.
```

Jika annotation salah, sistem masih bisa compile, tetapi kontrak XML bisa berubah diam-diam. Di enterprise integration, perubahan seperti itu bisa merusak SOAP client, batch import, regulator file exchange, legacy adapter, atau partner integration.

---

## 2. Namespace API: `javax` vs `jakarta`

Secara konsep annotation-nya mirip, tetapi package-nya berbeda.

| Era | Package annotation | Umum dipakai pada |
|---|---|---|
| Java EE / JAXB 2.x | `javax.xml.bind.annotation.*` | Java 6/7/8, Java EE 6/7/8, legacy SOAP stack |
| Jakarta EE / XML Binding 3.x/4.x | `jakarta.xml.bind.annotation.*` | Jakarta EE 9+, Java 11+, modern Jakarta runtime |

Contoh `javax`:

```java
import javax.xml.bind.annotation.XmlRootElement;
import javax.xml.bind.annotation.XmlElement;
```

Contoh `jakarta`:

```java
import jakarta.xml.bind.annotation.XmlRootElement;
import jakarta.xml.bind.annotation.XmlElement;
```

Perbedaannya bukan cuma import. Dalam migration nyata, dependency, generated code, plugin, SOAP stack, dan application server harus konsisten. Jangan mencampur `javax.xml.bind.*` model dengan runtime yang hanya mengerti `jakarta.xml.bind.*`, kecuali ada compatibility layer spesifik dari framework.

Prinsip production:

```text
Satu integration boundary harus memilih satu namespace binding utama.
```

Untuk Java 8 legacy, `javax` masih banyak ditemukan. Untuk Java 11–25 modern, lebih aman menyatakan dependency eksplisit dan memilih apakah tetap di JAXB 2.x `javax` atau migrasi ke Jakarta XML Binding `jakarta`.

Referensi resmi:

- Jakarta XML Binding 4.0 Specification: https://jakarta.ee/specifications/xml-binding/4.0/
- Jakarta XML Binding Annotation API: https://jakarta.ee/specifications/xml-binding/4.0/apidocs/jakarta.xml.bind/jakarta/xml/bind/annotation/package-summary
- OpenJDK JEP 320, removal of Java EE and CORBA modules from JDK 11: https://openjdk.org/jeps/320

---

## 3. Peta Besar Annotation JAXB

Annotation JAXB dapat dikelompokkan berdasarkan fungsi.

| Kelompok | Annotation utama | Fungsi |
|---|---|---|
| Root/type identity | `@XmlRootElement`, `@XmlType`, `@XmlSchemaType` | Menentukan identitas XML element/type |
| Access strategy | `@XmlAccessorType`, `@XmlTransient` | Menentukan field/property mana yang ikut binding |
| Element/attribute mapping | `@XmlElement`, `@XmlAttribute`, `@XmlValue` | Menentukan bentuk XML dasar |
| Collection/wrapper | `@XmlElementWrapper`, `@XmlList` | Menentukan list/array representation |
| Namespace/package | `@XmlSchema`, `@XmlNs` | Menentukan default namespace di package |
| Reference/polymorphism | `@XmlElementRef`, `@XmlElementRefs`, `@XmlElements`, `@XmlSeeAlso` | Menangani dynamic element/type |
| Wildcard/extensibility | `@XmlAnyElement`, `@XmlAnyAttribute` | Menerima XML tambahan yang tidak dimodelkan penuh |
| Adapter | `@XmlJavaTypeAdapter`, `@XmlJavaTypeAdapters` | Custom mapping Java ↔ XML value/type |
| Enum | `@XmlEnum`, `@XmlEnumValue` | Mapping enum ke lexical XML value |
| MIME/binary | `@XmlMimeType`, `@XmlAttachmentRef`, `@XmlInlineBinaryData` | Binary, MTOM/SOAP attachment scenario |
| Lifecycle hooks | `beforeMarshal`, `afterMarshal`, `beforeUnmarshal`, `afterUnmarshal` | Bukan annotation, tetapi sering satu paket dengan model design |

Part ini tidak hanya menjelaskan “apa annotation-nya”, tetapi kapan harus dipakai dan kapan justru berbahaya.

---

## 4. Default Mapping: Bahaya Mengandalkan Default

JAXB punya default mapping. Contoh class sederhana:

```java
@XmlRootElement
public class Customer {
    public String id;
    public String name;
}
```

Bisa menghasilkan:

```xml
<customer>
    <id>C001</id>
    <name>Alice</name>
</customer>
```

Kelihatannya praktis, tetapi default mapping punya risiko:

1. Nama XML mengikuti nama Java.
2. Refactoring Java bisa mengubah kontrak XML.
3. Field baru bisa tiba-tiba muncul di XML jika access strategy terlalu longgar.
4. Urutan element bisa tidak eksplisit.
5. Namespace bisa hilang atau salah.
6. Optionality tidak jelas.

Untuk internal object sementara, default mungkin boleh. Untuk external contract, default adalah risiko.

Rule of thumb:

```text
Untuk XML yang keluar/masuk sistem eksternal, annotation harus eksplisit.
```

Contoh model yang lebih defensible:

```java
@XmlAccessorType(XmlAccessType.FIELD)
@XmlRootElement(name = "Customer", namespace = "urn:example:customer:v1")
@XmlType(
    name = "CustomerType",
    namespace = "urn:example:customer:v1",
    propOrder = {"id", "name", "status"}
)
public class CustomerXml {

    @XmlElement(name = "Id", namespace = "urn:example:customer:v1", required = true)
    private String id;

    @XmlElement(name = "Name", namespace = "urn:example:customer:v1", required = true)
    private String name;

    @XmlElement(name = "Status", namespace = "urn:example:customer:v1", required = false)
    private String status;

    protected CustomerXml() {
        // Required by JAXB
    }

    public CustomerXml(String id, String name, String status) {
        this.id = id;
        this.name = name;
        this.status = status;
    }
}
```

Walaupun lebih verbose, model ini lebih aman karena shape XML tidak tergantung pada refactoring internal.

---

## 5. `@XmlRootElement`: Root Document Identity

`@XmlRootElement` memetakan class atau enum ke XML element root. Secara praktis, annotation ini memberi tahu runtime:

```text
Class ini bisa menjadi document root saat marshal/unmarshal.
```

Contoh:

```java
@XmlRootElement(name = "Customer", namespace = "urn:example:customer:v1")
public class CustomerXml {
    public String id;
}
```

Output:

```xml
<Customer xmlns="urn:example:customer:v1">
    <id>C001</id>
</Customer>
```

### 5.1 `name`

`name` menentukan local name XML element.

```java
@XmlRootElement(name = "Customer")
```

Tanpa `name`, JAXB biasanya menggunakan nama class dengan decapitalization. Ini riskan.

Contoh:

```java
@XmlRootElement
public class CustomerProfile { }
```

Bisa menjadi:

```xml
<customerProfile/>
```

Jika class di-rename menjadi `CustomerRecord`, XML berubah menjadi:

```xml
<customerRecord/>
```

Untuk external contract, ini bug.

### 5.2 `namespace`

`namespace` menentukan namespace URI dari root element.

```java
@XmlRootElement(name = "Customer", namespace = "urn:example:customer:v1")
```

Namespace bukan label kosmetik. Namespace adalah bagian dari QName:

```text
{urn:example:customer:v1}Customer
```

Berbeda dari:

```text
{urn:example:customer:v2}Customer
```

Dan berbeda dari:

```text
{}Customer
```

Jika SOAP server/client mengharapkan namespace tertentu, element dengan local name sama tetapi namespace berbeda dianggap beda.

### 5.3 Ketika `@XmlRootElement` Tidak Ada

Class hasil `xjc` kadang tidak punya `@XmlRootElement`, terutama jika XSD mendefinisikan complex type yang digunakan oleh global element. Dalam situasi ini, JAXB sering memakai `JAXBElement<T>` dari `ObjectFactory`.

Contoh:

```java
CustomerType customer = new CustomerType();
JAXBElement<CustomerType> root = new JAXBElement<>(
    new QName("urn:example:customer:v1", "Customer"),
    CustomerType.class,
    customer
);
marshaller.marshal(root, outputStream);
```

Mental model:

```text
@XmlRootElement melekatkan element name ke class.
JAXBElement melekatkan element name ke object instance.
```

Jika class bisa muncul dengan beberapa element name berbeda, `JAXBElement` lebih fleksibel.

Contoh:

```xml
<BillingAddress>...</BillingAddress>
<ShippingAddress>...</ShippingAddress>
```

Keduanya bisa menggunakan type Java yang sama `AddressType`, tetapi root/local element-nya berbeda. Dalam kasus ini, memaksa `@XmlRootElement(name = "Address")` bisa salah.

### 5.4 Anti-pattern

Anti-pattern umum:

```java
@XmlRootElement
public class Response<T> {
    public T data;
}
```

Masalah:

- generic root tidak cukup jelas untuk XSD/SOAP contract;
- runtime type erasure membuat binding sulit;
- root name terlalu umum;
- external contract menjadi tidak spesifik.

Lebih baik buat DTO XML spesifik:

```java
@XmlRootElement(name = "GetCustomerResponse", namespace = "urn:example:customer:v1")
@XmlAccessorType(XmlAccessType.FIELD)
public class GetCustomerResponseXml {

    @XmlElement(name = "Customer", required = true)
    private CustomerXml customer;
}
```

---

## 6. `@XmlType`: XML Schema Type Identity dan Ordering

`@XmlType` memetakan class ke XML Schema complex type.

Contoh:

```java
@XmlAccessorType(XmlAccessType.FIELD)
@XmlType(
    name = "CustomerType",
    namespace = "urn:example:customer:v1",
    propOrder = {"id", "name", "email"}
)
public class CustomerXml {

    @XmlElement(name = "Id")
    private String id;

    @XmlElement(name = "Name")
    private String name;

    @XmlElement(name = "Email")
    private String email;
}
```

`@XmlRootElement` menjawab:

```text
Nama root element-nya apa?
```

`@XmlType` menjawab:

```text
Nama XML Schema type-nya apa dan content model-nya bagaimana?
```

### 6.1 `name`

```java
@XmlType(name = "CustomerType")
```

Menghasilkan type schema seperti:

```xml
<xs:complexType name="CustomerType">
    ...
</xs:complexType>
```

Jika `name` tidak eksplisit, nama Java class bisa mempengaruhi schema. Ini sama berbahayanya dengan default root name.

### 6.2 `propOrder`

`propOrder` menentukan urutan element dalam XML sequence.

```java
@XmlType(propOrder = {"id", "name", "email"})
```

Penting karena XML sering order-sensitive, terutama jika XSD menggunakan `xs:sequence`.

Contoh XML valid:

```xml
<Customer>
    <Id>C001</Id>
    <Name>Alice</Name>
    <Email>a@example.com</Email>
</Customer>
```

Contoh XML yang bisa tidak valid jika XSD sequence:

```xml
<Customer>
    <Email>a@example.com</Email>
    <Id>C001</Id>
    <Name>Alice</Name>
</Customer>
```

JSON object field order biasanya tidak boleh dianggap bermakna. XML element order dalam schema bisa sangat bermakna.

### 6.3 Jebakan `propOrder`

Nama dalam `propOrder` adalah **nama property Java**, bukan nama XML element.

```java
@XmlElement(name = "CustomerId")
private String id;

@XmlType(propOrder = {"id"}) // benar
```

Bukan:

```java
@XmlType(propOrder = {"CustomerId"}) // salah
```

Jika field/property ikut binding tetapi tidak muncul di `propOrder`, JAXB bisa gagal saat context creation atau schema generation.

### 6.4 `@XmlType` tanpa `@XmlRootElement`

Ini valid:

```java
@XmlType(name = "AddressType")
public class AddressXml { ... }
```

Class punya XML type identity, tetapi tidak otomatis bisa menjadi root element. Ini umum untuk reusable complex type.

### 6.5 Anonymous Type

`@XmlType(name = "")` dapat menunjukkan anonymous schema type dalam beberapa pattern.

Namun untuk enterprise integration, anonymous type sering menyulitkan reuse, debugging, dan generated client. Untuk contract yang dipakai lintas sistem, named type biasanya lebih maintainable.

---

## 7. `@XmlAccessorType`: Strategi Field vs Property

`@XmlAccessorType` menentukan cara JAXB menemukan member yang perlu dibinding.

Pilihan utama:

| Access type | Makna |
|---|---|
| `FIELD` | Non-static, non-transient field ikut binding kecuali `@XmlTransient` |
| `PROPERTY` | Getter/setter JavaBean ikut binding |
| `PUBLIC_MEMBER` | Public field dan public getter/setter ikut binding |
| `NONE` | Hanya member yang diberi annotation eksplisit ikut binding |

### 7.1 `FIELD`

```java
@XmlAccessorType(XmlAccessType.FIELD)
public class CustomerXml {
    @XmlElement(name = "Id")
    private String id;

    @XmlElement(name = "Name")
    private String name;
}
```

Kelebihan:

- tidak perlu getter/setter untuk JAXB;
- cocok untuk DTO immutable-ish dengan protected no-arg constructor;
- mapping dekat dengan storage field;
- lebih eksplisit ketika semua field diberi annotation.

Kekurangan:

- semua field non-static non-transient bisa ikut jika lupa `@XmlTransient`;
- internal helper field bisa bocor ke XML;
- inheritance field bisa mengejutkan.

### 7.2 `PROPERTY`

```java
@XmlAccessorType(XmlAccessType.PROPERTY)
public class CustomerXml {
    private String id;

    @XmlElement(name = "Id")
    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }
}
```

Kelebihan:

- mapping lewat API property;
- bisa compute/transformed value;
- cocok untuk JavaBean legacy.

Kekurangan:

- getter helper bisa tidak sengaja ikut binding;
- setter side effect bisa terjadi saat unmarshal;
- property naming JavaBean bisa ambigu (`isActive`, `getURL`, boolean naming);
- kurang cocok untuk model yang ingin minim mutability.

### 7.3 `PUBLIC_MEMBER`

Ini default di banyak kasus.

```java
@XmlAccessorType(XmlAccessType.PUBLIC_MEMBER)
public class CustomerXml {
    public String id;

    public String getName() { ... }
    public void setName(String name) { ... }
}
```

Untuk contract serius, `PUBLIC_MEMBER` biasanya kurang defensible karena terlalu implicit.

### 7.4 `NONE`

```java
@XmlAccessorType(XmlAccessType.NONE)
public class CustomerXml {

    @XmlElement(name = "Id")
    private String id;

    private String internalCache; // tidak ikut binding
}
```

Kelebihan:

- paling eksplisit;
- mencegah field/helper bocor;
- sangat baik untuk boundary DTO sensitif.

Kekurangan:

- verbose;
- semua mapped member harus diberi annotation.

### 7.5 Rekomendasi Enterprise

Untuk XML contract eksternal:

```text
Prefer @XmlAccessorType(XmlAccessType.FIELD) atau NONE.
Hindari default PUBLIC_MEMBER.
Annotation-kan nama element/attribute secara eksplisit.
```

Pattern yang sering paling seimbang:

```java
@XmlAccessorType(XmlAccessType.FIELD)
@XmlType(propOrder = {"id", "name"})
public class CustomerXml {

    @XmlElement(name = "Id", required = true)
    private String id;

    @XmlElement(name = "Name", required = true)
    private String name;

    @XmlTransient
    private String internalDebugLabel;
}
```

Pattern yang paling strict:

```java
@XmlAccessorType(XmlAccessType.NONE)
@XmlType(propOrder = {"id", "name"})
public class CustomerXml {

    @XmlElement(name = "Id", required = true)
    private String id;

    @XmlElement(name = "Name", required = true)
    private String name;

    private String internalDebugLabel;
}
```

---

## 8. `@XmlTransient`: Exclusion dan Inheritance Control

`@XmlTransient` mengecualikan field/property/type dari XML binding.

Contoh field:

```java
@XmlTransient
private String internalToken;
```

Contoh getter:

```java
@XmlTransient
public String getInternalToken() {
    return internalToken;
}
```

### 8.1 Bukan Security Boundary Utama

`@XmlTransient` membantu mencegah field ikut marshal, tetapi jangan jadikan satu-satunya kontrol keamanan.

Salah:

```java
public class UserEntity {
    public String username;

    @XmlTransient
    public String passwordHash;
}
```

Masalahnya bukan hanya `passwordHash` ikut atau tidak. Masalah utamanya adalah entity internal dipakai sebagai DTO eksternal.

Lebih baik:

```java
@XmlAccessorType(XmlAccessType.FIELD)
@XmlRootElement(name = "User")
public class UserResponseXml {

    @XmlElement(name = "Username")
    private String username;
}
```

Boundary DTO harus hanya punya field yang memang boleh keluar.

### 8.2 `@XmlTransient` di Superclass

Jika superclass diberi `@XmlTransient`, JAXB tidak memetakan superclass sebagai XML type tersendiri, tetapi field/property-nya bisa diwariskan ke subclass tergantung access strategy.

Contoh:

```java
@XmlTransient
public abstract class BaseAuditXml {
    @XmlElement(name = "CreatedAt")
    protected String createdAt;
}

@XmlRootElement(name = "Customer")
@XmlAccessorType(XmlAccessType.FIELD)
public class CustomerXml extends BaseAuditXml {
    @XmlElement(name = "Id")
    private String id;
}
```

Hasil bisa memasukkan `CreatedAt` dalam `Customer`, tetapi tidak membuat `BaseAuditXml` sebagai XML type terpisah.

Ini berguna untuk shared mapped fields tanpa mengubah schema inheritance model.

### 8.3 `transient` Java Keyword vs `@XmlTransient`

```java
private transient String cache;
```

Field `transient` biasanya tidak ikut field access binding. Tetapi untuk kejelasan contract, `@XmlTransient` lebih eksplisit jika field terlihat relevan.

---

## 9. `@XmlElement`: Element Mapping

`@XmlElement` adalah annotation paling sering dipakai. Ia memetakan Java field/property ke XML element.

Contoh:

```java
@XmlElement(name = "CustomerName", namespace = "urn:example:customer:v1", required = true)
private String name;
```

XML:

```xml
<CustomerName xmlns="urn:example:customer:v1">Alice</CustomerName>
```

### 9.1 `name`

`name` menentukan local element name.

```java
@XmlElement(name = "Id")
private String id;
```

Jangan mengandalkan default nama field untuk external XML.

### 9.2 `namespace`

Jika package-level namespace tidak diatur, beri namespace eksplisit.

```java
@XmlElement(name = "Id", namespace = "urn:example:customer:v1")
```

Namun jika semua element berada di namespace sama, package-level `@XmlSchema` lebih rapi. Kita bahas nanti.

### 9.3 `required`

```java
@XmlElement(name = "Id", required = true)
private String id;
```

`required = true` terutama mempengaruhi schema generation, bukan otomatis menjamin runtime object pasti valid saat marshal. JAXB bisa tetap menulis XML yang tidak valid jika field null dan tidak ada validation aktif.

Mental model:

```text
@XmlElement(required = true) adalah metadata kontrak.
Validation runtime tetap perlu XSD validation atau business validation.
```

Contoh:

```java
CustomerXml c = new CustomerXml(null, "Alice");
marshaller.marshal(c, out);
```

Bisa saja menghasilkan XML tanpa `<Id>` atau dengan bentuk yang tidak sesuai harapan, tergantung setting dan provider. Untuk memastikan, gunakan:

- Bean Validation sebelum marshal;
- XSD validation pada marshaller/unmarshaller;
- factory method/domain invariant;
- test contract golden file.

### 9.4 `nillable`

```java
@XmlElement(name = "MiddleName", nillable = true)
private String middleName;
```

Jika nil, XML bisa menjadi:

```xml
<MiddleName xsi:nil="true" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"/>
```

Bedakan tiga kondisi:

| Kondisi | XML | Makna umum |
|---|---|---|
| Absent | element tidak muncul | unknown/not provided/not applicable |
| Empty | `<Name/>` atau `<Name></Name>` | ada, tetapi string kosong/empty content |
| Nil | `<Name xsi:nil="true"/>` | eksplisit null |

Di banyak legacy integration, perbedaan ini penting.

Contoh business meaning:

```text
Absent phoneNumber  = tidak diubah.
Empty phoneNumber   = set menjadi empty string.
xsi:nil phoneNumber = clear value menjadi null.
```

Jangan memakai `nillable = true` hanya karena Java field nullable. Tanyakan kontrak semantics-nya.

### 9.5 `defaultValue`

```java
@XmlElement(name = "Country", defaultValue = "SG")
private String country;
```

`defaultValue` berhubungan dengan schema default. Jangan disalahartikan sebagai Java initialization otomatis di semua situasi runtime.

Lebih aman jika default business value di-handle eksplisit:

```java
public String effectiveCountry() {
    return country == null ? "SG" : country;
}
```

Atau lakukan normalization pada boundary mapper.

### 9.6 Primitive vs Wrapper

```java
@XmlElement(name = "Age", required = true)
private int age;
```

Primitive `int` tidak bisa merepresentasikan absent/null. Jika XML tidak punya `<Age>`, hasil default Java bisa `0`, yang bisa salah secara domain.

Untuk external input:

```java
@XmlElement(name = "Age")
private Integer age;
```

Lalu validasi eksplisit:

```java
if (age == null) {
    throw new InvalidPayloadException("Age is required");
}
```

Prinsip:

```text
Primitive menyembunyikan absent/null sebagai default value.
Wrapper menjaga informasi input boundary.
```

### 9.7 Collection Element

```java
@XmlElement(name = "Item")
private List<OrderItemXml> items = new ArrayList<>();
```

XML tanpa wrapper:

```xml
<Order>
    <Item>...</Item>
    <Item>...</Item>
</Order>
```

Dengan wrapper memakai `@XmlElementWrapper`, dibahas di section berikutnya.

---

## 10. `@XmlAttribute`: Attribute Mapping

`@XmlAttribute` memetakan field/property ke XML attribute.

Contoh:

```java
@XmlAccessorType(XmlAccessType.FIELD)
@XmlRootElement(name = "Customer")
public class CustomerXml {

    @XmlAttribute(name = "id", required = true)
    private String id;

    @XmlElement(name = "Name")
    private String name;
}
```

XML:

```xml
<Customer id="C001">
    <Name>Alice</Name>
</Customer>
```

### 10.1 Kapan Attribute Cocok?

Attribute cocok untuk:

- identifier metadata;
- small scalar value;
- qualifier;
- code/version;
- language tag;
- units;
- references.

Contoh:

```xml
<Amount currency="SGD">100.00</Amount>
```

### 10.2 Kapan Element Lebih Cocok?

Element lebih cocok untuk:

- structured content;
- repeated content;
- long text;
- nullable/nillable content;
- value yang mungkin punya child element;
- content yang butuh ordering relatif.

### 10.3 Attribute Tidak Bisa Punya Child

Attribute selalu lexical string value. Ia tidak bisa punya nested structure.

Tidak mungkin:

```xml
<Customer id="<Value>C001</Value>">
```

Jika value mulai butuh structure, gunakan element.

### 10.4 Attribute dan Namespace

Attribute namespace berbeda dari element default namespace behavior. Default namespace tidak otomatis berlaku untuk unprefixed attributes.

Contoh:

```xml
<Customer xmlns="urn:example:customer:v1" id="C001"/>
```

`Customer` berada di namespace `urn:example:customer:v1`, tetapi `id` attribute tanpa prefix berada di no namespace.

Jika butuh namespaced attribute:

```java
@XmlAttribute(name = "id", namespace = "urn:example:common:v1")
private String id;
```

XML mungkin menjadi:

```xml
<Customer xmlns="urn:example:customer:v1"
          xmlns:com="urn:example:common:v1"
          com:id="C001"/>
```

Jangan berasumsi default namespace berlaku sama untuk attribute.

---

## 11. `@XmlValue`: Simple Content

`@XmlValue` memetakan value text dari element.

Contoh amount dengan attribute currency:

```java
@XmlAccessorType(XmlAccessType.FIELD)
@XmlType(name = "AmountType")
public class AmountXml {

    @XmlValue
    private BigDecimal value;

    @XmlAttribute(name = "currency", required = true)
    private String currency;
}
```

XML:

```xml
<Amount currency="SGD">100.00</Amount>
```

### 11.1 Kapan `@XmlValue` Dipakai?

Dipakai untuk XML simple content:

```xml
<Code system="ISO-3166">SG</Code>
```

Model:

```java
@XmlAccessorType(XmlAccessType.FIELD)
public class CodeXml {

    @XmlValue
    private String value;

    @XmlAttribute(name = "system")
    private String system;
}
```

### 11.2 Batasan

Dalam satu class, biasanya hanya satu `@XmlValue`. Class dengan `@XmlValue` tidak bisa secara normal punya child element lain sebagai complex content. Ia bisa punya attribute.

Valid:

```xml
<Amount currency="SGD">100.00</Amount>
```

Tidak cocok untuk:

```xml
<Amount currency="SGD">
    <Value>100.00</Value>
</Amount>
```

Untuk bentuk kedua, gunakan `@XmlElement`.

### 11.3 Lexical vs Domain Value

XML simple content punya lexical representation. Misalnya `BigDecimal`:

```xml
<Amount>100.0</Amount>
<Amount>100.00</Amount>
```

Secara numeric mungkin sama, tetapi secara lexical berbeda. Untuk signature/canonicalization/audit, lexical bisa penting.

Jika exact lexical representation penting, jangan buru-buru bind ke `BigDecimal`. Pertimbangkan menyimpan raw string dan validasi manual.

---

## 12. `@XmlElementWrapper`: Collection Wrapper

Tanpa wrapper:

```java
@XmlElement(name = "Item")
private List<ItemXml> items;
```

XML:

```xml
<Order>
    <Item>...</Item>
    <Item>...</Item>
</Order>
```

Dengan wrapper:

```java
@XmlElementWrapper(name = "Items")
@XmlElement(name = "Item")
private List<ItemXml> items;
```

XML:

```xml
<Order>
    <Items>
        <Item>...</Item>
        <Item>...</Item>
    </Items>
</Order>
```

### 12.1 Wrapper Mengubah Contract

Ini bukan formatting. Ini mengubah struktur XML.

Tanpa wrapper:

```text
Order -> Item*
```

Dengan wrapper:

```text
Order -> Items -> Item*
```

Jika partner system mengharapkan satu bentuk, bentuk lain tidak compatible.

### 12.2 Null vs Empty List

Pertimbangkan:

```java
private List<ItemXml> items = null;
private List<ItemXml> items = List.of();
```

Kemungkinan output bisa berbeda:

| Java value | XML potensial |
|---|---|
| `null` | wrapper absent |
| empty list | `<Items/>` atau absent tergantung config/provider |
| list berisi item | `<Items><Item>...</Item></Items>` |

Untuk integration contract, definisikan semantics:

```text
Items absent  = data tidak dikirim / unknown?
Items empty   = eksplisit tidak ada item?
```

Jika perlu eksplisit, buat mapper yang mengontrol output dan test golden XML.

### 12.3 Wrapper Namespace

```java
@XmlElementWrapper(name = "Items", namespace = "urn:example:order:v1")
@XmlElement(name = "Item", namespace = "urn:example:order:v1")
private List<ItemXml> items;
```

Wrapper dan item bisa punya namespace berbeda, walaupun jarang dibutuhkan. Jangan lupa bahwa wrapper namespace dan item namespace adalah dua QName berbeda.

---

## 13. `@XmlList`: Space-separated List

`@XmlList` memetakan list menjadi satu lexical value yang dipisahkan spasi.

Contoh:

```java
@XmlList
@XmlElement(name = "Codes")
private List<String> codes;
```

XML:

```xml
<Codes>A B C</Codes>
```

Bukan:

```xml
<Codes>A</Codes>
<Codes>B</Codes>
<Codes>C</Codes>
```

### 13.1 Kapan Dipakai?

Cocok jika XSD memang memakai list simple type:

```xml
<xs:simpleType name="CodeListType">
    <xs:list itemType="xs:string"/>
</xs:simpleType>
```

### 13.2 Risiko

`@XmlList` bisa bermasalah jika item value bisa mengandung whitespace signifikan.

Contoh buruk:

```xml
<Tags>new york urgent high risk</Tags>
```

Apakah itu 4 tag atau 2 tag?

Untuk value bebas, pakai repeated element.

---

## 14. Package-level `@XmlSchema`: Namespace Discipline

Daripada mengulang namespace di setiap field, JAXB menyediakan package-level annotation di file `package-info.java`.

Struktur:

```text
src/main/java/com/example/customer/xml/package-info.java
src/main/java/com/example/customer/xml/CustomerXml.java
src/main/java/com/example/customer/xml/AddressXml.java
```

Isi `package-info.java`:

```java
@jakarta.xml.bind.annotation.XmlSchema(
    namespace = "urn:example:customer:v1",
    elementFormDefault = jakarta.xml.bind.annotation.XmlNsForm.QUALIFIED,
    attributeFormDefault = jakarta.xml.bind.annotation.XmlNsForm.UNQUALIFIED,
    xmlns = {
        @jakarta.xml.bind.annotation.XmlNs(
            prefix = "cust",
            namespaceURI = "urn:example:customer:v1"
        )
    }
)
package com.example.customer.xml;
```

Untuk `javax`:

```java
@javax.xml.bind.annotation.XmlSchema(
    namespace = "urn:example:customer:v1",
    elementFormDefault = javax.xml.bind.annotation.XmlNsForm.QUALIFIED,
    attributeFormDefault = javax.xml.bind.annotation.XmlNsForm.UNQUALIFIED,
    xmlns = {
        @javax.xml.bind.annotation.XmlNs(
            prefix = "cust",
            namespaceURI = "urn:example:customer:v1"
        )
    }
)
package com.example.customer.xml;
```

### 14.1 `elementFormDefault = QUALIFIED`

Jika `QUALIFIED`, local elements berada dalam target namespace.

```xml
<Customer xmlns="urn:example:customer:v1">
    <Id>C001</Id>
</Customer>
```

`Id` juga berada di namespace `urn:example:customer:v1` karena default namespace aktif untuk elements.

### 14.2 `elementFormDefault = UNQUALIFIED`

Jika `UNQUALIFIED`, local child elements bisa berada di no namespace meskipun root namespace qualified.

Contoh:

```xml
<cust:Customer xmlns:cust="urn:example:customer:v1">
    <Id>C001</Id>
</cust:Customer>
```

Di sini `cust:Customer` namespaced, tetapi `Id` no namespace.

Banyak bug SOAP/XML berasal dari mismatch ini.

### 14.3 Attribute Default

Umumnya attribute form default `UNQUALIFIED`.

```xml
<Customer xmlns="urn:example:customer:v1" id="C001"/>
```

Attribute `id` no namespace. Ini normal.

### 14.4 Prefix Bukan Identitas

Prefix `cust` bukan identitas. Namespace URI adalah identitas.

Dua XML ini setara secara namespace:

```xml
<cust:Customer xmlns:cust="urn:example:customer:v1"/>
```

```xml
<c:Customer xmlns:c="urn:example:customer:v1"/>
```

Namun untuk signature/canonicalization/golden file, prefix bisa mempengaruhi byte-level output. Untuk contract test, bandingkan XML secara namespace-aware, bukan string naïve, kecuali memang byte-level canonical output dibutuhkan.

---

## 15. `@XmlEnum` dan `@XmlEnumValue`

Enum Java sering dipakai untuk code list XML.

```java
@XmlEnum(String.class)
public enum CustomerStatusXml {

    @XmlEnumValue("ACTIVE")
    ACTIVE,

    @XmlEnumValue("SUSPENDED")
    SUSPENDED,

    @XmlEnumValue("CLOSED")
    CLOSED
}
```

Dipakai:

```java
@XmlElement(name = "Status")
private CustomerStatusXml status;
```

XML:

```xml
<Status>ACTIVE</Status>
```

### 15.1 Jangan Mengandalkan Enum Name Default

Tanpa `@XmlEnumValue`, lexical XML value mengikuti enum constant name. Rename enum constant bisa merusak contract.

Salah untuk external contract:

```java
public enum Status {
    ACTIVE_CUSTOMER
}
```

Jika kemudian rename ke:

```java
ACTIVE
```

XML berubah.

Lebih aman:

```java
@XmlEnumValue("A")
ACTIVE_CUSTOMER
```

### 15.2 Unknown Enum Value

JAXB enum binding biasanya gagal jika XML berisi value yang tidak dikenal.

Contoh partner menambah:

```xml
<Status>PENDING_REVIEW</Status>
```

Jika Java enum belum punya value itu, unmarshal bisa gagal.

Strategi:

1. Jika value harus strict, gagal cepat dan laporkan invalid contract.
2. Jika forward compatibility diperlukan, jangan bind langsung ke enum. Bind ke `String`, validasi/interpretasi di layer domain.
3. Gunakan adapter custom untuk `UNKNOWN`, tetapi hati-hati karena bisa menyembunyikan perubahan kontrak.

Contoh safer forward-compatible boundary:

```java
@XmlElement(name = "Status")
private String statusCode;

public Optional<CustomerStatus> knownStatus() {
    return CustomerStatus.fromCode(statusCode);
}
```

---

## 16. Date/Time dan `@XmlSchemaType`

JAXB default date/time mapping bisa mengejutkan. XML Schema punya types seperti:

- `xs:date`
- `xs:dateTime`
- `xs:time`
- `xs:gYearMonth`

Java legacy JAXB sering memakai `XMLGregorianCalendar`.

Contoh:

```java
@XmlElement(name = "CreatedAt")
@XmlSchemaType(name = "dateTime")
private XMLGregorianCalendar createdAt;
```

XML:

```xml
<CreatedAt>2026-06-17T10:15:30+07:00</CreatedAt>
```

### 16.1 Java 8+ Time API

JAXB/Jakarta XML Binding tidak selalu otomatis mapping `java.time.Instant`, `LocalDate`, `OffsetDateTime` sesuai harapan, tergantung provider/version. Pattern yang sering lebih aman adalah adapter.

```java
@XmlJavaTypeAdapter(OffsetDateTimeAdapter.class)
@XmlElement(name = "CreatedAt")
private OffsetDateTime createdAt;
```

Adapter:

```java
public class OffsetDateTimeAdapter extends XmlAdapter<String, OffsetDateTime> {

    @Override
    public OffsetDateTime unmarshal(String value) {
        return value == null ? null : OffsetDateTime.parse(value);
    }

    @Override
    public String marshal(OffsetDateTime value) {
        return value == null ? null : value.toString();
    }
}
```

### 16.2 `LocalDateTime` Trap

`LocalDateTime` tidak punya timezone/offset. Untuk event lintas sistem, ini rawan.

```xml
<CreatedAt>2026-06-17T10:15:30</CreatedAt>
```

Pertanyaan yang tidak terjawab:

```text
10:15:30 di timezone mana?
```

Untuk external contract, prefer:

- `OffsetDateTime` untuk timestamp dengan offset;
- `Instant` untuk absolute point in time;
- `LocalDate` untuk tanggal kalender tanpa waktu;
- hindari `LocalDateTime` kecuali kontrak memang mendefinisikan timezone secara terpisah.

---

## 17. `@XmlJavaTypeAdapter`: Custom Boundary Conversion

`@XmlJavaTypeAdapter` adalah salah satu annotation paling penting untuk model enterprise.

Ia memungkinkan mapping:

```text
Java domain-ish type ↔ XML-friendly value type
```

Contoh value object:

```java
public final class CustomerId {
    private final String value;

    public CustomerId(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("CustomerId is required");
        }
        this.value = value;
    }

    public String value() {
        return value;
    }
}
```

Adapter:

```java
public class CustomerIdAdapter extends XmlAdapter<String, CustomerId> {

    @Override
    public CustomerId unmarshal(String value) {
        return value == null ? null : new CustomerId(value);
    }

    @Override
    public String marshal(CustomerId value) {
        return value == null ? null : value.value();
    }
}
```

DTO:

```java
@XmlJavaTypeAdapter(CustomerIdAdapter.class)
@XmlElement(name = "CustomerId", required = true)
private CustomerId customerId;
```

### 17.1 Adapter Scope

Adapter bisa ditempatkan pada:

- field;
- property;
- type;
- package;
- parameter tertentu tergantung use case.

Field-level:

```java
@XmlJavaTypeAdapter(CustomerIdAdapter.class)
private CustomerId id;
```

Type-level:

```java
@XmlJavaTypeAdapter(CustomerIdAdapter.class)
public final class CustomerId { ... }
```

Package-level:

```java
@XmlJavaTypeAdapters({
    @XmlJavaTypeAdapter(type = OffsetDateTime.class, value = OffsetDateTimeAdapter.class)
})
package com.example.customer.xml;
```

### 17.2 Adapter untuk Format Legacy

Legacy XML sering punya format tanggal atau amount yang tidak ISO-clean.

Contoh:

```xml
<DateOfBirth>17/06/2026</DateOfBirth>
```

Adapter:

```java
public class DdMmYyyyLocalDateAdapter extends XmlAdapter<String, LocalDate> {
    private static final DateTimeFormatter FORMATTER = DateTimeFormatter.ofPattern("dd/MM/uuuu");

    @Override
    public LocalDate unmarshal(String value) {
        return value == null || value.isBlank() ? null : LocalDate.parse(value, FORMATTER);
    }

    @Override
    public String marshal(LocalDate value) {
        return value == null ? null : FORMATTER.format(value);
    }
}
```

### 17.3 Adapter Jangan Jadi Tempat Business Workflow

Adapter boleh:

- parse/format;
- normalize lexical representation;
- convert value object;
- enforce local lexical invariant.

Adapter jangan:

- call database;
- call remote service;
- melakukan authorization;
- mutate global state;
- melakukan complex business decision.

Salah:

```java
public Customer unmarshal(String id) {
    return customerRepository.findById(id); // buruk di adapter
}
```

Binding harus deterministic dan side-effect minimal.

### 17.4 Error Handling Adapter

Jika adapter gagal parse, JAXB akan membungkus exception dalam `UnmarshalException`/runtime exception provider-specific. Untuk error reporting yang baik:

- simpan location info dari parser jika memungkinkan;
- validasi XSD dulu untuk structure;
- lakukan semantic validation setelah unmarshal;
- mapping error ke response/fault yang stabil.

---

## 18. `@XmlElementRef`, `@XmlElementRefs`, dan `JAXBElement`

`@XmlElementRef` digunakan ketika element name berasal dari `JAXBElement` atau element declaration, bukan hardcoded dari property name.

Ini umum pada schema-first generated code.

Contoh sederhana:

```java
@XmlElementRef(name = "Customer", namespace = "urn:example:customer:v1")
private JAXBElement<CustomerType> customer;
```

Mental model:

```text
@XmlElement    = property menentukan element name.
@XmlElementRef = referenced JAXBElement/ObjectFactory menentukan element name.
```

### 18.1 Mengapa Ini Ada?

Dalam XSD, global element dan complex type adalah dua hal berbeda.

```xml
<xs:complexType name="AddressType">...</xs:complexType>

<xs:element name="BillingAddress" type="AddressType"/>
<xs:element name="ShippingAddress" type="AddressType"/>
```

Satu Java type `AddressType` bisa muncul sebagai dua element:

```xml
<BillingAddress>...</BillingAddress>
<ShippingAddress>...</ShippingAddress>
```

Jika property hanya bertipe `AddressType`, element name hilang. `JAXBElement<AddressType>` membawa QName element.

### 18.2 `ObjectFactory` dan `@XmlElementDecl`

Generated code sering punya:

```java
@XmlRegistry
public class ObjectFactory {

    private final static QName _BillingAddress_QNAME =
        new QName("urn:example:customer:v1", "BillingAddress");

    @XmlElementDecl(namespace = "urn:example:customer:v1", name = "BillingAddress")
    public JAXBElement<AddressType> createBillingAddress(AddressType value) {
        return new JAXBElement<>(_BillingAddress_QNAME, AddressType.class, null, value);
    }
}
```

Pemakaian:

```java
AddressType address = new AddressType();
JAXBElement<AddressType> element = objectFactory.createBillingAddress(address);
```

### 18.3 Kapan Jangan Pakai `@XmlElementRef`

Untuk handwritten DTO sederhana, `@XmlElement` sering lebih jelas.

```java
@XmlElement(name = "Customer")
private CustomerXml customer;
```

Gunakan `@XmlElementRef` jika:

- schema-first generated model memang memakai element declaration;
- satu Java type bisa punya beberapa element QName;
- substitution group/polymorphic XML element perlu dipertahankan.

---

## 19. `@XmlElements`: Choice-like Mapping

`@XmlElements` memungkinkan property menerima beberapa concrete element mapping.

Contoh:

```java
@XmlElements({
    @XmlElement(name = "EmailContact", type = EmailContactXml.class),
    @XmlElement(name = "PhoneContact", type = PhoneContactXml.class)
})
private List<ContactMethodXml> contactMethods;
```

XML:

```xml
<ContactMethods>
    <EmailContact>...</EmailContact>
    <PhoneContact>...</PhoneContact>
</ContactMethods>
```

### 19.1 Kapan Dipakai?

Cocok untuk XSD `choice` sederhana:

```xml
<xs:choice maxOccurs="unbounded">
    <xs:element name="EmailContact" type="EmailContactType"/>
    <xs:element name="PhoneContact" type="PhoneContactType"/>
</xs:choice>
```

### 19.2 Risiko

Jika terlalu banyak subtype, model menjadi sulit dipahami. Untuk boundary enterprise, choice harus mencerminkan kontrak nyata, bukan inheritance domain internal.

Buruk:

```java
@XmlElements({
    @XmlElement(name = "A", type = InternalA.class),
    @XmlElement(name = "B", type = InternalB.class),
    @XmlElement(name = "C", type = InternalC.class)
})
private List<Object> internalEvents;
```

Lebih baik buat XML event contract yang eksplisit.

---

## 20. `@XmlAnyElement`: Wildcard dan Extensibility Point

`@XmlAnyElement` menerima element yang tidak dimodelkan secara statis.

Contoh:

```java
@XmlAnyElement(lax = true)
private List<Object> extensions;
```

XML:

```xml
<Customer>
    <Id>C001</Id>
    <ext:RiskScore xmlns:ext="urn:example:extension:v1">80</ext:RiskScore>
</Customer>
```

### 20.1 Strict vs Lax

```java
@XmlAnyElement(lax = false)
private List<Element> extensions;
```

Biasanya menghasilkan DOM `Element` untuk unknown elements.

```java
@XmlAnyElement(lax = true)
private List<Object> extensions;
```

Jika JAXBContext mengenal element tersebut, bisa dibind ke object; jika tidak, fallback ke DOM Element.

### 20.2 Kapan Berguna?

- Partner extension field.
- Forward compatibility pada XML contract.
- SOAP header extensibility.
- Vendor-specific metadata.
- Regulatory schema yang punya `<xs:any>`.

### 20.3 Risiko Security dan Compatibility

Wildcard bisa menjadi celah:

- menerima payload besar tidak terduga;
- menerima namespace asing;
- menyimpan DOM subtree besar di memory;
- membuka surface XML Signature Wrapping jika dipakai di security-sensitive document;
- membuat sistem diam-diam menerima field yang tidak divalidasi.

Praktik aman:

```text
Jika memakai @XmlAnyElement, tetap batasi namespace yang diterima, ukuran payload, dan tempat pemakaiannya.
```

Contoh post-validation:

```java
for (Object extension : extensions) {
    if (extension instanceof Element element) {
        String ns = element.getNamespaceURI();
        if (!allowedNamespaces.contains(ns)) {
            throw new InvalidPayloadException("Unsupported extension namespace: " + ns);
        }
    }
}
```

---

## 21. `@XmlAnyAttribute`: Wildcard Attribute

`@XmlAnyAttribute` menampung attribute yang tidak dimodelkan.

```java
@XmlAnyAttribute
private Map<QName, String> otherAttributes = new HashMap<>();
```

XML:

```xml
<Customer id="C001" ext:source="partnerA" xmlns:ext="urn:example:ext"/>
```

`otherAttributes` bisa berisi:

```text
{urn:example:ext}source -> partnerA
```

### 21.1 Kapan Berguna?

- Metadata vendor-specific.
- Attribute extension point dari XSD.
- Preserving unknown attributes saat read-modify-write.

### 21.2 Risiko

Attribute liar bisa mengubah semantics jika namespace tertentu punya arti khusus.

Contoh sensitif:

```xml
<Element xsi:type="AdminUser"/>
```

Attribute `xsi:type` bukan sekadar metadata. Ia bisa mempengaruhi binding/polymorphism. Jangan treat semua unknown attribute sebagai harmless.

---

## 22. `@XmlMixed`: Mixed Content

Mixed content adalah XML yang punya campuran text dan child element.

Contoh:

```xml
<p>Hello <b>world</b>, welcome.</p>
```

Model:

```java
@XmlMixed
@XmlAnyElement
private List<Object> content;
```

List bisa berisi:

- `String` text segment;
- DOM `Element`;
- JAXB-bound element.

### 22.1 Mixed Content Tidak Cocok untuk DTO Biasa

Jika XML Anda seperti ini:

```xml
<Customer>
    <Id>C001</Id>
    <Name>Alice</Name>
</Customer>
```

Itu bukan mixed content business document biasa. Jangan pakai `@XmlMixed`.

Mixed content cocok untuk:

- rich text;
- document markup;
- legal/regulatory text;
- template body;
- XHTML-like payload.

### 22.2 Security

Mixed content sering membawa HTML/XML fragment. Risiko:

- XSS jika dirender ke web;
- template injection;
- unsafe transformation;
- signature wrapping;
- DOM memory growth.

Jangan render mixed content ke UI tanpa sanitization sesuai konteks output.

---

## 23. `@XmlID`, `@XmlIDREF`: Identity dan Reference

`@XmlID` menandai value sebagai XML ID.

```java
@XmlAttribute(name = "id")
@XmlID
private String id;
```

`@XmlIDREF` mereferensikan object dengan ID.

```java
@XmlIDREF
@XmlElement(name = "Manager")
private EmployeeXml manager;
```

XML:

```xml
<Employee id="E001">
    <Manager>E000</Manager>
</Employee>
```

### 23.1 Kapan Dipakai?

- Graph object dengan reference, bukan nested duplication.
- XML document yang punya internal links.
- Schema menggunakan `xs:ID` dan `xs:IDREF`.

### 23.2 Risiko

Banyak business XML lebih mudah dan robust dengan explicit identifier string, bukan object reference.

Lebih sederhana:

```java
@XmlElement(name = "ManagerId")
private String managerId;
```

Gunakan `@XmlIDREF` hanya jika schema benar-benar menghendaki reference graph.

---

## 24. `@XmlSeeAlso`: Membantu JAXBContext Mengenal Subtypes

`@XmlSeeAlso` memberi petunjuk ke JAXB bahwa subtype tertentu perlu masuk context.

```java
@XmlSeeAlso({EmailContactXml.class, PhoneContactXml.class})
public abstract class ContactMethodXml { }
```

Berguna ketika context dibuat dari base type:

```java
JAXBContext context = JAXBContext.newInstance(ContactMethodXml.class);
```

Tanpa `@XmlSeeAlso`, JAXB mungkin tidak mengenal subtype saat marshal/unmarshal.

### 24.1 Bukan Pengganti Contract Polymorphism

`@XmlSeeAlso` hanya membantu context discovery. Ia tidak otomatis mendefinisikan XML choice contract yang bersih.

Untuk XML shape, tetap gunakan:

- `@XmlElements`;
- `@XmlElementRef`;
- XSD substitution group;
- explicit wrapper/type design.

---

## 25. Inheritance Mapping

Inheritance Java tidak selalu cocok dengan XML Schema inheritance.

Contoh:

```java
@XmlAccessorType(XmlAccessType.FIELD)
public abstract class PartyXml {
    @XmlElement(name = "Id")
    protected String id;
}

@XmlAccessorType(XmlAccessType.FIELD)
@XmlRootElement(name = "Person")
public class PersonXml extends PartyXml {
    @XmlElement(name = "FullName")
    private String fullName;
}
```

XML:

```xml
<Person>
    <Id>P001</Id>
    <FullName>Alice</FullName>
</Person>
```

### 25.1 Inheritance sebagai Code Reuse vs Contract Reuse

Ada dua alasan memakai inheritance:

1. Code reuse Java.
2. XML schema type extension.

Keduanya tidak selalu sama.

Jika hanya ingin reuse field, superclass `@XmlTransient` bisa lebih aman.

```java
@XmlTransient
public abstract class AuditedXml {
    @XmlElement(name = "CreatedAt")
    protected String createdAt;
}
```

Jika ingin schema inheritance, perlu desain XSD/type yang sadar extension/restriction.

### 25.2 `xsi:type`

Polymorphic XML kadang memakai `xsi:type`:

```xml
<ContactMethod xsi:type="EmailContactType">
    ...
</ContactMethod>
```

Ini powerful tetapi bisa berisiko:

- client/server harus mengenal type name;
- namespace/type mismatch mudah terjadi;
- security-sensitive binding harus membatasi subtype;
- compatibility lebih sulit dibanding explicit element choice.

Untuk external contract, explicit element choice sering lebih mudah dibaca:

```xml
<EmailContact>...</EmailContact>
```

Daripada:

```xml
<ContactMethod xsi:type="EmailContactType">...</ContactMethod>
```

---

## 26. `@XmlAccessorOrder`: Ordering Global

`@XmlAccessorOrder` dapat mengatur order default member, misalnya alphabetical.

```java
@XmlAccessorOrder(XmlAccessOrder.ALPHABETICAL)
package com.example.customer.xml;
```

Atau class-level:

```java
@XmlAccessorOrder(XmlAccessOrder.ALPHABETICAL)
public class CustomerXml { ... }
```

### 26.1 Rekomendasi

Untuk external contract, lebih baik `@XmlType(propOrder = {...})` daripada alphabetical global.

Alphabetical order bisa berubah ketika nama property berubah. `propOrder` lebih eksplisit sebagai kontrak.

---

## 27. Binary dan MIME-related Annotation

Beberapa annotation relevan untuk SOAP attachment/MTOM, yang akan dibahas lebih dalam di part SOAP.

### 27.1 `@XmlMimeType`

```java
@XmlMimeType("application/pdf")
@XmlElement(name = "DocumentContent")
private byte[] content;
```

### 27.2 `@XmlInlineBinaryData`

Memaksa binary data inline sebagai base64, bukan optimized attachment.

```java
@XmlInlineBinaryData
private byte[] content;
```

### 27.3 `@XmlAttachmentRef`

Dipakai untuk attachment reference scenario.

### 27.4 Practical Note

Binary XML design harus mempertimbangkan:

- base64 overhead;
- memory copy;
- streaming;
- MTOM support;
- SOAP stack compatibility;
- antivirus/content scanning;
- audit storage;
- retry behavior.

Jangan menaruh file besar di JAXB object biasa tanpa strategi streaming.

---

## 28. Annotation pada Records, Immutable Objects, dan Modern Java

JAXB secara historis didesain untuk JavaBean-style classes:

- no-arg constructor;
- mutable fields/properties;
- getter/setter;
- reflection access.

Modern Java punya:

- records;
- sealed classes;
- immutable value objects;
- modules/JPMS;
- strong encapsulation.

### 28.1 Records

Record:

```java
public record CustomerXml(String id, String name) { }
```

JAXB support untuk records tidak bisa diasumsikan universal lintas provider/version. Untuk enterprise compatibility Java 8–25, DTO JAXB klasik masih paling portable.

Rekomendasi:

```java
@XmlAccessorType(XmlAccessType.FIELD)
@XmlType(propOrder = {"id", "name"})
public class CustomerXml {

    @XmlElement(name = "Id", required = true)
    private String id;

    @XmlElement(name = "Name", required = true)
    private String name;

    protected CustomerXml() {
    }

    public CustomerXml(String id, String name) {
        this.id = id;
        this.name = name;
    }

    public String id() { return id; }
    public String name() { return name; }
}
```

Ini memberi immutability-ish API luar, tetapi tetap kompatibel dengan JAXB.

### 28.2 JPMS dan Reflection

Pada Java 9+, module system bisa membatasi reflection. Jika menggunakan named modules, package JAXB model mungkin perlu `opens` ke runtime binding.

Contoh konseptual:

```java
module com.example.customer.integration {
    requires jakarta.xml.bind;

    opens com.example.customer.xml to jakarta.xml.bind;
}
```

Tanpa `opens`, runtime bisa gagal mengakses private fields/constructors.

---

## 29. Designing Annotation for Schema-first vs Code-first

### 29.1 Schema-first

Schema-first berarti XSD adalah sumber kebenaran.

```text
XSD -> generated Java classes -> marshal/unmarshal
```

Dalam schema-first, annotation biasanya generated oleh `xjc`. Jangan sembarang edit generated class karena akan hilang saat regenerate.

Aturan:

- treat generated code as build artifact;
- customize dengan binding file, bukan edit manual;
- mapping domain dilakukan di layer mapper;
- jangan menambahkan business method kompleks ke generated DTO.

### 29.2 Code-first

Code-first berarti Java class menjadi sumber untuk generate schema/XML.

```text
Java annotated class -> schema/XML
```

Dalam code-first, annotation harus sangat disiplin karena class Java adalah contract source.

Aturan:

- nama XML eksplisit;
- namespace eksplisit/package-level;
- `propOrder` eksplisit;
- no accidental public member;
- test generated schema;
- diff schema antar release;
- freeze golden XML examples.

### 29.3 Hybrid

Banyak enterprise system real memakai hybrid:

- legacy XSD untuk core contract;
- handwritten classes untuk wrapper/internal XML;
- SOAP generated client untuk external service;
- adapter DTO untuk REST/XML bridge.

Yang penting bukan memilih dogma, tetapi menentukan source of truth per boundary.

```text
Setiap boundary harus punya satu contract authority.
```

---

## 30. Null, Absent, Empty, Nil: Annotation Semantics yang Paling Sering Salah

Ini layak diulang karena menjadi sumber bug besar.

### 30.1 Empat Kondisi

| Kondisi | XML contoh | Java representation potensial | Catatan |
|---|---|---|---|
| Absent | tidak ada element | `null` | element tidak dikirim |
| Empty element | `<Name/>` | `""` atau `null` tergantung binding/type | ada element tanpa text |
| Empty string | `<Name></Name>` | `""` | lexical empty |
| Nil | `<Name xsi:nil="true"/>` | `null` | eksplisit null |

### 30.2 Update/PATCH-like XML

Jika XML dipakai untuk update:

```xml
<CustomerUpdate>
    <Name>Alice</Name>
</CustomerUpdate>
```

Apakah field lain tidak berubah? Jika iya, absent berarti “do not update”.

Jika:

```xml
<CustomerUpdate>
    <MiddleName xsi:nil="true"/>
</CustomerUpdate>
```

Apakah berarti clear value? Biasanya iya, jika contract mendukung.

DTO biasa dengan `String middleName` tidak bisa membedakan absent vs nil setelah unmarshal jika keduanya menjadi `null`.

Solusi untuk update contract yang butuh tri-state:

1. Gunakan DOM/StAX partial parsing untuk detect presence.
2. Gunakan `JAXBElement<T>` yang bisa membawa nil/presence info dalam beberapa pattern.
3. Gunakan custom adapter/wrapper type.
4. Pisahkan command XML dengan field presence eksplisit.

Contoh command explicit:

```xml
<MiddleName operation="CLEAR"/>
```

Atau:

```xml
<MiddleNameUpdate>
    <Specified>true</Specified>
    <Value xsi:nil="true"/>
</MiddleNameUpdate>
```

Tidak selalu indah, tetapi jelas.

---

## 31. Annotation Anti-patterns

### 31.1 Entity sebagai XML DTO

Buruk:

```java
@Entity
@XmlRootElement
public class CustomerEntity {
    @Id
    public Long id;

    public String name;

    public String internalRiskScore;
}
```

Masalah:

- persistence model bocor ke external contract;
- lazy loading saat marshal;
- security leakage;
- schema berubah karena database/entity refactor;
- cyclic relationship;
- performance unpredictable.

Lebih baik:

```java
@XmlRootElement(name = "Customer")
@XmlAccessorType(XmlAccessType.FIELD)
public class CustomerXml {
    @XmlElement(name = "Id")
    private String id;

    @XmlElement(name = "Name")
    private String name;
}
```

### 31.2 Annotation Terlalu Minim

Buruk:

```java
@XmlRootElement
public class Customer {
    public String id;
    public String fullName;
}
```

Contract tergantung nama Java.

### 31.3 Terlalu Banyak Wildcard

Buruk:

```java
@XmlAnyElement(lax = true)
private List<Object> everythingElse;
```

Tanpa validation, wildcard menjadi tempat semua payload aneh masuk.

### 31.4 `Map<String, Object>` untuk XML

XML tidak natural untuk arbitrary map seperti JSON. Jika butuh extensibility, gunakan QName-aware map/any element, bukan `Map<String,Object>` domain liar.

### 31.5 Mixing JAXB dan Jackson XML Annotation tanpa Disiplin

Dalam beberapa project, class diberi:

```java
@XmlElement(name = "Id")
@JacksonXmlProperty(localName = "CustomerId")
private String id;
```

Ini bisa membingungkan karena dua serializer menghasilkan shape berbeda.

Jika harus dual-format:

- pastikan contract test untuk dua format;
- jangan asumsikan annotation saling kompatibel;
- pertimbangkan DTO terpisah untuk XML dan JSON jika contract penting.

---

## 32. Production Annotation Checklist

Untuk setiap JAXB/Jakarta XML Binding DTO eksternal, cek:

### 32.1 Class-level

- Apakah `@XmlAccessorType` eksplisit?
- Apakah `@XmlRootElement` diperlukan dan eksplisit?
- Apakah `@XmlType(name=..., propOrder=...)` eksplisit?
- Apakah namespace benar?
- Apakah package punya `@XmlSchema`?
- Apakah class punya no-arg constructor yang cukup untuk JAXB?
- Apakah tidak ada domain/entity leakage?

### 32.2 Field-level

- Apakah setiap field eksternal punya `@XmlElement`/`@XmlAttribute` eksplisit?
- Apakah required/nillable sesuai contract?
- Apakah primitive tidak menyembunyikan absent/null?
- Apakah date/time punya adapter yang jelas?
- Apakah enum lexical value eksplisit?
- Apakah list wrapper sesuai XSD?
- Apakah wildcard dibatasi dan divalidasi?

### 32.3 Namespace-level

- Apakah default namespace sesuai XSD?
- Apakah child element qualified/unqualified sesuai contract?
- Apakah attribute namespace tidak diasumsikan salah?
- Apakah prefix tidak dijadikan identity secara salah?

### 32.4 Runtime-level

- Apakah `JAXBContext` dibuat dengan semua class yang dibutuhkan?
- Apakah `Marshaller`/`Unmarshaller` tidak dishare antar thread secara unsafe?
- Apakah secure XML parser settings sudah diaktifkan saat input untrusted?
- Apakah schema validation aktif untuk boundary yang membutuhkannya?
- Apakah error message tidak membocorkan payload sensitif?

### 32.5 Testing-level

- Golden XML marshal test.
- Golden XML unmarshal test.
- Namespace-aware XML comparison.
- XSD validation test.
- Backward compatibility sample test.
- Unknown field/extension test.
- Null/absent/nil test.
- Java 8/11/17/21/25 compatibility test jika library mendukung target tersebut.

---

## 33. Worked Example: Customer Contract yang Defensible

### 33.1 XML Target

Kita ingin menghasilkan XML:

```xml
<cust:Customer xmlns:cust="urn:example:customer:v1" id="C001">
    <cust:Name>Alice</cust:Name>
    <cust:Status>ACTIVE</cust:Status>
    <cust:RegisteredAt>2026-06-17T10:15:30+07:00</cust:RegisteredAt>
    <cust:Addresses>
        <cust:Address type="HOME">
            <cust:Line1>Street 1</cust:Line1>
            <cust:PostalCode>123456</cust:PostalCode>
        </cust:Address>
    </cust:Addresses>
</cust:Customer>
```

### 33.2 Package Namespace

`package-info.java`:

```java
@jakarta.xml.bind.annotation.XmlSchema(
    namespace = "urn:example:customer:v1",
    elementFormDefault = jakarta.xml.bind.annotation.XmlNsForm.QUALIFIED,
    attributeFormDefault = jakarta.xml.bind.annotation.XmlNsForm.UNQUALIFIED,
    xmlns = {
        @jakarta.xml.bind.annotation.XmlNs(
            prefix = "cust",
            namespaceURI = "urn:example:customer:v1"
        )
    }
)
package com.example.customer.xml;
```

### 33.3 Enum

```java
package com.example.customer.xml;

import jakarta.xml.bind.annotation.XmlEnum;
import jakarta.xml.bind.annotation.XmlEnumValue;

@XmlEnum(String.class)
public enum CustomerStatusXml {
    @XmlEnumValue("ACTIVE")
    ACTIVE,

    @XmlEnumValue("SUSPENDED")
    SUSPENDED,

    @XmlEnumValue("CLOSED")
    CLOSED
}
```

### 33.4 Date Adapter

```java
package com.example.customer.xml;

import jakarta.xml.bind.annotation.adapters.XmlAdapter;
import java.time.OffsetDateTime;

public class OffsetDateTimeAdapter extends XmlAdapter<String, OffsetDateTime> {

    @Override
    public OffsetDateTime unmarshal(String value) {
        return value == null || value.isBlank() ? null : OffsetDateTime.parse(value);
    }

    @Override
    public String marshal(OffsetDateTime value) {
        return value == null ? null : value.toString();
    }
}
```

### 33.5 Address DTO

```java
package com.example.customer.xml;

import jakarta.xml.bind.annotation.XmlAccessType;
import jakarta.xml.bind.annotation.XmlAccessorType;
import jakarta.xml.bind.annotation.XmlAttribute;
import jakarta.xml.bind.annotation.XmlElement;
import jakarta.xml.bind.annotation.XmlType;

@XmlAccessorType(XmlAccessType.FIELD)
@XmlType(name = "AddressType", propOrder = {"line1", "postalCode"})
public class AddressXml {

    @XmlAttribute(name = "type", required = true)
    private String type;

    @XmlElement(name = "Line1", required = true)
    private String line1;

    @XmlElement(name = "PostalCode", required = true)
    private String postalCode;

    protected AddressXml() {
    }

    public AddressXml(String type, String line1, String postalCode) {
        this.type = type;
        this.line1 = line1;
        this.postalCode = postalCode;
    }
}
```

### 33.6 Customer DTO

```java
package com.example.customer.xml;

import jakarta.xml.bind.annotation.XmlAccessType;
import jakarta.xml.bind.annotation.XmlAccessorType;
import jakarta.xml.bind.annotation.XmlAttribute;
import jakarta.xml.bind.annotation.XmlElement;
import jakarta.xml.bind.annotation.XmlElementWrapper;
import jakarta.xml.bind.annotation.XmlRootElement;
import jakarta.xml.bind.annotation.XmlType;
import jakarta.xml.bind.annotation.adapters.XmlJavaTypeAdapter;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;

@XmlAccessorType(XmlAccessType.FIELD)
@XmlRootElement(name = "Customer")
@XmlType(
    name = "CustomerType",
    propOrder = {"name", "status", "registeredAt", "addresses"}
)
public class CustomerXml {

    @XmlAttribute(name = "id", required = true)
    private String id;

    @XmlElement(name = "Name", required = true)
    private String name;

    @XmlElement(name = "Status", required = true)
    private CustomerStatusXml status;

    @XmlJavaTypeAdapter(OffsetDateTimeAdapter.class)
    @XmlElement(name = "RegisteredAt", required = true)
    private OffsetDateTime registeredAt;

    @XmlElementWrapper(name = "Addresses")
    @XmlElement(name = "Address")
    private List<AddressXml> addresses = new ArrayList<>();

    protected CustomerXml() {
    }

    public CustomerXml(
        String id,
        String name,
        CustomerStatusXml status,
        OffsetDateTime registeredAt,
        List<AddressXml> addresses
    ) {
        this.id = id;
        this.name = name;
        this.status = status;
        this.registeredAt = registeredAt;
        this.addresses = addresses == null ? new ArrayList<>() : new ArrayList<>(addresses);
    }
}
```

### 33.7 Marshal

```java
JAXBContext context = JAXBContext.newInstance(CustomerXml.class);
Marshaller marshaller = context.createMarshaller();
marshaller.setProperty(Marshaller.JAXB_FORMATTED_OUTPUT, true);

CustomerXml customer = new CustomerXml(
    "C001",
    "Alice",
    CustomerStatusXml.ACTIVE,
    OffsetDateTime.parse("2026-06-17T10:15:30+07:00"),
    List.of(new AddressXml("HOME", "Street 1", "123456"))
);

marshaller.marshal(customer, System.out);
```

### 33.8 Apa yang Membuat Ini Defensible?

- Root element eksplisit.
- Namespace package-level eksplisit.
- Element qualification jelas.
- Attribute qualification jelas.
- Type name eksplisit.
- Element ordering eksplisit.
- Enum lexical values eksplisit.
- Date/time adapter eksplisit.
- Collection wrapper eksplisit.
- DTO terpisah dari domain/entity.
- No-arg constructor tersedia untuk JAXB.

---

## 34. Worked Example: Extension Point yang Aman

Target XML:

```xml
<Customer xmlns="urn:example:customer:v1"
          xmlns:ext="urn:example:customer-extension:v1">
    <Id>C001</Id>
    <Name>Alice</Name>
    <ext:RiskScore>80</ext:RiskScore>
</Customer>
```

DTO:

```java
@XmlAccessorType(XmlAccessType.FIELD)
@XmlRootElement(name = "Customer")
@XmlType(propOrder = {"id", "name", "extensions"})
public class CustomerWithExtensionXml {

    @XmlElement(name = "Id", required = true)
    private String id;

    @XmlElement(name = "Name", required = true)
    private String name;

    @XmlAnyElement(lax = false)
    private List<Element> extensions = new ArrayList<>();

    public void validateExtensions() {
        Set<String> allowed = Set.of("urn:example:customer-extension:v1");

        for (Element element : extensions) {
            String namespace = element.getNamespaceURI();
            if (!allowed.contains(namespace)) {
                throw new IllegalArgumentException("Unsupported extension namespace: " + namespace);
            }
        }
    }
}
```

Important:

```text
@XmlAnyElement menerima extensibility.
validateExtensions menjaga extensibility tetap bounded.
```

Tanpa validation, extension point berubah menjadi arbitrary XML injection point.

---

## 35. Worked Example: Avoiding Absent/Nil Bug

Misal contract update:

```xml
<CustomerUpdate>
    <Id>C001</Id>
    <MiddleName xsi:nil="true"/>
</CustomerUpdate>
```

Jika model:

```java
@XmlElement(name = "MiddleName", nillable = true)
private String middleName;
```

Setelah unmarshal, `middleName == null`. Tetapi jika XML:

```xml
<CustomerUpdate>
    <Id>C001</Id>
</CustomerUpdate>
```

`middleName` juga bisa `null`. Presence hilang.

Jika semantics update perlu membedakan absent vs nil, gunakan representation eksplisit.

```java
@XmlAccessorType(XmlAccessType.FIELD)
public class CustomerUpdateXml {

    @XmlElement(name = "Id", required = true)
    private String id;

    @XmlElementRef(name = "MiddleName")
    private JAXBElement<String> middleName;

    public boolean hasMiddleNameInstruction() {
        return middleName != null;
    }

    public boolean isMiddleNameNil() {
        return middleName != null && middleName.isNil();
    }

    public String middleNameValue() {
        return middleName == null ? null : middleName.getValue();
    }
}
```

Atau desain XML command yang lebih eksplisit:

```xml
<MiddleNameUpdate action="CLEAR"/>
```

Model:

```java
@XmlAccessorType(XmlAccessType.FIELD)
public class MiddleNameUpdateXml {

    @XmlAttribute(name = "action", required = true)
    private String action;

    @XmlValue
    private String value;
}
```

Pilihan terbaik tergantung contract authority. Yang penting: jangan kehilangan semantics tanpa sadar.

---

## 36. Annotation dan Validation: Jangan Dicampur Aduk

JAXB annotation menjelaskan XML mapping. Bean Validation annotation menjelaskan constraint object. XSD menjelaskan constraint XML document.

Contoh:

```java
@XmlElement(name = "Id", required = true)
@NotBlank
private String id;
```

Makna:

- `@XmlElement(required = true)` untuk XML schema/mapping metadata.
- `@NotBlank` untuk Java object validation.

Keduanya tidak otomatis saling menggantikan.

### 36.1 Validation Layer yang Baik

Pipeline inbound:

```text
Raw XML
  -> secure parser settings
  -> optional XSD validation
  -> JAXB unmarshal
  -> semantic validation
  -> domain command mapping
```

Pipeline outbound:

```text
Domain result
  -> XML DTO mapping
  -> semantic validation
  -> JAXB marshal
  -> optional XSD validation/golden test
  -> send/store
```

### 36.2 Required Field Defense

Jangan hanya mengandalkan:

```java
@XmlElement(required = true)
```

Tambahkan:

```java
if (id == null || id.isBlank()) {
    throw new InvalidPayloadException("Id is required");
}
```

Atau Bean Validation:

```java
@NotBlank
@XmlElement(name = "Id", required = true)
private String id;
```

---

## 37. Testing JAXB Annotation Contract

### 37.1 Golden Marshal Test

```java
@Test
void marshalsCustomerInExpectedShape() throws Exception {
    JAXBContext context = JAXBContext.newInstance(CustomerXml.class);
    Marshaller marshaller = context.createMarshaller();

    StringWriter writer = new StringWriter();
    marshaller.marshal(sampleCustomer(), writer);

    assertXmlEquivalent("""
        <cust:Customer xmlns:cust="urn:example:customer:v1" id="C001">
            <cust:Name>Alice</cust:Name>
            <cust:Status>ACTIVE</cust:Status>
            <cust:RegisteredAt>2026-06-17T10:15:30+07:00</cust:RegisteredAt>
            <cust:Addresses>
                <cust:Address type="HOME">
                    <cust:Line1>Street 1</cust:Line1>
                    <cust:PostalCode>123456</cust:PostalCode>
                </cust:Address>
            </cust:Addresses>
        </cust:Customer>
        """, writer.toString());
}
```

Gunakan XML-aware comparison. Jangan string compare naïve jika prefix/whitespace tidak penting.

### 37.2 Golden Unmarshal Test

```java
@Test
void unmarshalsPartnerXml() throws Exception {
    JAXBContext context = JAXBContext.newInstance(CustomerXml.class);
    Unmarshaller unmarshaller = context.createUnmarshaller();

    CustomerXml customer = (CustomerXml) unmarshaller.unmarshal(
        new StringReader(PARTNER_CUSTOMER_XML)
    );

    assertThat(customer).isNotNull();
}
```

### 37.3 Schema Validation Test

```java
SchemaFactory schemaFactory = SchemaFactory.newInstance(XMLConstants.W3C_XML_SCHEMA_NS_URI);
Schema schema = schemaFactory.newSchema(new File("customer-v1.xsd"));

Unmarshaller unmarshaller = context.createUnmarshaller();
unmarshaller.setSchema(schema);
```

### 37.4 Compatibility Test

Simpan sample XML dari versi lama:

```text
samples/v1/customer-minimal.xml
samples/v1/customer-full.xml
samples/v1/customer-with-extension.xml
samples/v1/customer-null-middle-name.xml
```

Setiap release baru harus tetap bisa membaca sample lama jika backward compatibility dijanjikan.

---

## 38. Failure Modeling: Bagaimana Annotation Salah Merusak Production

### 38.1 Rename Field Mengubah XML

Sebelum:

```java
public String postalCode;
```

XML:

```xml
<postalCode>123456</postalCode>
```

Setelah refactor:

```java
public String postcode;
```

XML:

```xml
<postcode>123456</postcode>
```

Partner gagal parse.

Prevention:

```java
@XmlElement(name = "PostalCode")
private String postalCode;
```

### 38.2 Namespace Hilang

Expected:

```xml
<cust:Id xmlns:cust="urn:example:customer:v1">C001</cust:Id>
```

Actual:

```xml
<Id>C001</Id>
```

Local name sama, QName beda. SOAP server menolak.

Prevention:

- package-level `@XmlSchema`;
- namespace-aware test;
- XSD validation.

### 38.3 Required Field Null

Annotation:

```java
@XmlElement(name = "Id", required = true)
private String id;
```

Object:

```java
id = null;
```

Runtime masih bisa marshal invalid output.

Prevention:

- constructor invariant;
- Bean Validation;
- marshaller schema validation;
- contract tests.

### 38.4 Empty List Ambiguity

Partner expects:

```xml
<Items/>
```

Your JAXB outputs absent wrapper.

Prevention:

- explicit contract semantics;
- custom marshal strategy if needed;
- golden tests.

### 38.5 Wildcard Memory Blowup

Payload:

```xml
<Customer>
    <Id>C001</Id>
    <HugeExtension>...100MB nested XML...</HugeExtension>
</Customer>
```

`@XmlAnyElement` stores DOM subtree in memory.

Prevention:

- parser limits;
- size limits before binding;
- namespace allowlist;
- avoid DOM wildcard for untrusted huge payloads.

---

## 39. Practical Decision Matrix

| Problem | Prefer |
|---|---|
| Simple element | `@XmlElement` |
| Small metadata scalar | `@XmlAttribute` |
| Text value plus attributes | `@XmlValue` + `@XmlAttribute` |
| Repeated child without container | repeated `@XmlElement` list |
| Repeated child inside container | `@XmlElementWrapper` + `@XmlElement` |
| Package-wide namespace | `package-info.java` + `@XmlSchema` |
| Date/time modern Java | `@XmlJavaTypeAdapter` |
| Enum stable external code | `@XmlEnumValue` |
| One Java type, multiple element names | `JAXBElement` / `@XmlElementRef` |
| XSD choice | `@XmlElements` / schema-first generated code |
| Extension element | `@XmlAnyElement` with allowlist validation |
| Extension attribute | `@XmlAnyAttribute` with QName-aware validation |
| Unknown enum forward compatibility | bind as `String`, interpret later |
| Strict external contract | explicit annotations + XSD/golden tests |
| Internal temporary XML | defaults may be acceptable, but still be careful |

---

## 40. Recommended Annotation Style Guide

Untuk project enterprise, gunakan style berikut.

### 40.1 Package

```java
@XmlSchema(
    namespace = "urn:company:domain:module:v1",
    elementFormDefault = XmlNsForm.QUALIFIED,
    attributeFormDefault = XmlNsForm.UNQUALIFIED
)
package ...;
```

### 40.2 Class

```java
@XmlAccessorType(XmlAccessType.FIELD)
@XmlType(name = "SomethingType", propOrder = {...})
@XmlRootElement(name = "Something") // only if class is valid root
public class SomethingXml { ... }
```

### 40.3 Field

```java
@XmlElement(name = "BusinessName", required = true)
private String businessName;
```

or:

```java
@XmlAttribute(name = "code", required = true)
private String code;
```

### 40.4 List

```java
@XmlElementWrapper(name = "Items")
@XmlElement(name = "Item")
private List<ItemXml> items = new ArrayList<>();
```

### 40.5 Date/Time

```java
@XmlJavaTypeAdapter(OffsetDateTimeAdapter.class)
@XmlElement(name = "SubmittedAt", required = true)
private OffsetDateTime submittedAt;
```

### 40.6 Enum

```java
@XmlEnum(String.class)
public enum StatusXml {
    @XmlEnumValue("A") ACTIVE,
    @XmlEnumValue("S") SUSPENDED
}
```

---

## 41. Java 8–25 Compatibility Notes

### 41.1 Java 8

- JAXB API historically available in JDK 8.
- Banyak legacy code memakai `javax.xml.bind.*` tanpa dependency eksplisit.
- Application server Java EE menyediakan JAXB/JAX-WS stack.

### 41.2 Java 9–10

- Java EE modules deprecated/marked for removal.
- Module path/classpath behavior mulai relevan.

### 41.3 Java 11+

- JAXB tidak lagi bundled di JDK.
- Tambahkan dependency API + runtime implementation secara eksplisit.
- Build tool harus mengontrol versi.

Contoh Jakarta modern:

```xml
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
```

Contoh legacy `javax`:

```xml
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
```

Versi dependency harus disesuaikan dengan platform dan security policy project.

### 41.4 Java 17/21/25

- Strong encapsulation makin terasa.
- Reflection access perlu diperhatikan pada JPMS.
- Pastikan JAXB runtime version compatible dengan target Java.
- Test generated code jika memakai `xjc` lama.
- Jangan mengandalkan tool dari JDK lama.

---

## 42. Ringkasan Mental Model

JAXB annotation menjawab pertanyaan berikut:

```text
Apa nama XML-nya?
Namespace-nya apa?
Apakah ini element atau attribute?
Urutannya apa?
Boleh hilang atau harus ada?
Jika null, absent atau xsi:nil?
Jika list, wrapper atau repeated langsung?
Jika type polymorphic, bagaimana XML membedakannya?
Jika ada extension, siapa yang boleh masuk?
Jika Java berubah, apakah XML tetap stabil?
```

Top 1% engineer tidak hanya tahu annotation list. Ia memahami bahwa annotation adalah **kontrak interoperability**.

Ia akan bertanya:

- Apakah XML shape ini source-of-truth atau generated artifact?
- Apakah refactoring Java bisa mengubah XML?
- Apakah namespace benar secara QName?
- Apakah absent/null/nil semantics dijaga?
- Apakah schema validation cukup?
- Apakah wildcard aman?
- Apakah enum forward-compatible?
- Apakah date/time punya timezone semantics?
- Apakah test membuktikan compatibility?

---

## 43. Latihan Mandiri

### Latihan 1 — Explicit Contract

Buat DTO XML untuk:

```xml
<Application xmlns="urn:example:application:v1" id="APP-001">
    <ApplicantName>Alice</ApplicantName>
    <SubmittedAt>2026-06-17T10:00:00+07:00</SubmittedAt>
    <Status>SUBMITTED</Status>
</Application>
```

Syarat:

- gunakan package-level `@XmlSchema`;
- root element eksplisit;
- `id` sebagai attribute;
- `SubmittedAt` memakai `OffsetDateTime` adapter;
- enum `Status` memakai `@XmlEnumValue`.

### Latihan 2 — Wrapper Compatibility

Buat dua DTO untuk list item:

Versi A:

```xml
<Order>
    <Item>...</Item>
    <Item>...</Item>
</Order>
```

Versi B:

```xml
<Order>
    <Items>
        <Item>...</Item>
        <Item>...</Item>
    </Items>
</Order>
```

Jelaskan mengapa keduanya tidak backward-compatible secara structural.

### Latihan 3 — Null Semantics

Desain XML update contract yang bisa membedakan:

- field tidak dikirim;
- field dikirim dengan empty string;
- field dikirim sebagai null/clear.

Jelaskan apakah akan memakai `xsi:nil`, `JAXBElement`, atau command action eksplisit.

### Latihan 4 — Extension Point

Tambahkan `@XmlAnyElement` ke DTO, lalu buat validation allowlist namespace. Jelaskan risiko jika allowlist tidak ada.

---

## 44. Referensi

Referensi utama:

- Jakarta XML Binding 4.0 Specification: https://jakarta.ee/specifications/xml-binding/4.0/
- Jakarta XML Binding 4.0 API Docs: https://jakarta.ee/specifications/xml-binding/4.0/apidocs/
- Jakarta XML Binding Annotation Package: https://jakarta.ee/specifications/xml-binding/4.0/apidocs/jakarta.xml.bind/jakarta/xml/bind/annotation/package-summary
- `@XmlRootElement` API docs: https://jakarta.ee/specifications/xml-binding/4.0/apidocs/jakarta.xml.bind/jakarta/xml/bind/annotation/xmlrootelement
- Eclipse JAXB RI Documentation: https://eclipse-ee4j.github.io/jaxb-ri/
- OpenJDK JEP 320: https://openjdk.org/jeps/320
- W3C XML Schema: https://www.w3.org/XML/Schema
- W3C Namespaces in XML: https://www.w3.org/TR/xml-names/

---

## 45. Penutup

Part ini membahas annotation JAXB/Jakarta XML Binding sebagai **contract definition layer**. Kita tidak hanya melihat syntax annotation, tetapi bagaimana annotation mempengaruhi compatibility, namespace correctness, schema generation, runtime behavior, null semantics, extension handling, dan production failure.

Setelah memahami part ini, kita punya fondasi untuk masuk ke workflow yang lebih kompleks:

```text
XSD -> Java generated model -> binding customization -> stable enterprise contract
```

Itu akan menjadi fokus Part 18.

Status seri: **belum selesai**.  
Part ini adalah **Part 17 dari 34**.  
Berikutnya: **Part 18 — JAXB Schema-First Workflow**.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 16 — JAXB / Jakarta XML Binding Core](./learn-java-json-xml-soap-connectors-enterprise-integration-part-016.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 18 — JAXB Schema-First Workflow: XSD → Java with XJC, Binding Customization, Episode Files, and Generated-Code Hygiene](./learn-java-json-xml-soap-connectors-enterprise-integration-part-018.md)
