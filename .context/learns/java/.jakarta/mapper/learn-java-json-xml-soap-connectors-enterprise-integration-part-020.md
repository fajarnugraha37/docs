# learn-java-json-xml-soap-connectors-enterprise-integration — Part 20
# JAXB Advanced Mapping: Adapters, Polymorphism, `JAXBElement`, Wildcards, Mixed Content, and Contract-Safe XML Models

> Seri: **Java JSON, XML, SOAP Legacy, and Connectors Enterprise Integration**  
> Part: **20 dari 34**  
> Target pembaca: Java engineer yang sudah paham dasar XML, XSD, JAXB core, annotation dasar, dan ingin naik ke level desain mapping yang aman untuk enterprise/legacy integration.  
> Rentang versi: **Java 8 sampai Java 25**, dengan perhatian khusus pada migrasi **`javax.xml.bind` → `jakarta.xml.bind`** dan Java 11+ yang tidak lagi membawa JAXB di JDK.

---

## 0. Tujuan Part Ini

Di part sebelumnya kita sudah membahas:

- JAXB/Jakarta XML Binding core.
- `JAXBContext`, `Marshaller`, `Unmarshaller`.
- Annotation dasar: `@XmlRootElement`, `@XmlType`, `@XmlAccessorType`, `@XmlElement`, `@XmlAttribute`, namespace, ordering.
- Schema-first workflow: XSD → Java dengan XJC.
- Code-first workflow: Java → XSD dan risiko contract drift.

Part ini membahas area yang biasanya membedakan engineer yang “bisa JAXB” dengan engineer yang benar-benar mampu menjaga integrasi XML/SOAP legacy dalam production:

1. `JAXBElement` dan kenapa ia muncul di generated model.
2. `ObjectFactory` dan `@XmlElementDecl` sebagai element factory layer.
3. `XmlAdapter` dan `@XmlJavaTypeAdapter` untuk mapping tipe yang tidak natural di XML.
4. Polymorphism: `xsi:type`, inheritance, substitution group, `@XmlSeeAlso`, `@XmlElements`, `@XmlElementRefs`.
5. `nillable`, absent, empty string, default value, dan semantic drift.
6. Mapping list, array, wrapper, map, dan collection shape.
7. Wildcard extension dengan `@XmlAnyElement` dan `@XmlAnyAttribute`.
8. Mixed content dengan `@XmlMixed`.
9. Handling namespace dan QName di model kompleks.
10. Design strategy agar mapping tetap stabil, aman, dan bisa dioperasikan lintas versi Java 8–25.

Core mental model-nya:

> JAXB advanced mapping bukan tentang “membuat XML bisa keluar”.  
> JAXB advanced mapping adalah cara mengontrol hubungan antara **XML contract**, **Java object model**, dan **evolusi sistem** tanpa membuat boundary menjadi rapuh.

---

## 1. Kenapa Advanced Mapping Penting?

Pada level dasar, JAXB terlihat sederhana:

```java
@XmlRootElement(name = "customer")
public class Customer {
    public String id;
    public String name;
}
```

Lalu:

```java
marshaller.marshal(customer, outputStream);
Customer c = (Customer) unmarshaller.unmarshal(inputStream);
```

Untuk XML sederhana, ini cukup.

Namun enterprise XML jarang sesederhana itu. Integrasi SOAP/legacy biasanya punya:

- namespace banyak;
- schema modular;
- `xsd:choice`;
- optional/nillable field;
- inheritance type;
- element dengan nama sama tapi type berbeda;
- substitution group;
- extension element dari vendor/agency lain;
- mixed content;
- attachment metadata;
- `QName` sebagai value;
- date/time format legacy;
- field dengan format non-ISO;
- schema lama yang tidak bisa diubah;
- consumer yang strict terhadap prefix walaupun XML namespace-nya valid;
- contract yang hidup selama 10–20 tahun.

Di titik ini, pendekatan “annotate POJO saja” mulai pecah.

Yang perlu dipahami:

```text
Simple JAXB:
Java field <-> XML element

Advanced JAXB:
XSD element declaration
    <-> QName + declared type + scope + substitution + nillability
    <-> Java value holder / JAXBElement / ObjectFactory
    <-> binding customization / adapter
    <-> runtime marshalling behavior
    <-> consumer compatibility
```

Part ini membangun mental model tersebut.

---

## 2. Terminologi Kunci: Element, Type, Value

Salah satu kesalahan terbesar saat belajar JAXB adalah mencampuradukkan:

1. XML element name.
2. XML schema type.
3. Java class.
4. Java value.

Contoh XML:

```xml
<customer xmlns="urn:example:customer">
  <id>C-001</id>
  <name>Fajar</name>
</customer>
```

Di sini:

- element root: `{urn:example:customer}customer`
- child element: `{urn:example:customer}id`
- child element: `{urn:example:customer}name`
- type bisa saja bernama `CustomerType`
- Java class bisa saja bernama `Customer`

Dalam XSD, element dan type bisa dipisah:

```xml
<xs:element name="customer" type="tns:CustomerType"/>

<xs:complexType name="CustomerType">
  <xs:sequence>
    <xs:element name="id" type="xs:string"/>
    <xs:element name="name" type="xs:string"/>
  </xs:sequence>
</xs:complexType>
```

Artinya:

```text
Element declaration: customer
Type definition: CustomerType
```

Satu type bisa dipakai oleh banyak element:

```xml
<xs:element name="primaryCustomer" type="tns:CustomerType"/>
<xs:element name="secondaryCustomer" type="tns:CustomerType"/>
```

Di Java, keduanya mungkin sama-sama memakai class `CustomerType`, tapi XML element name-nya berbeda.

Di sinilah `JAXBElement` menjadi penting.

---

## 3. `@XmlRootElement` vs `JAXBElement`

### 3.1 `@XmlRootElement`: Class Punya Nama Element Default

Jika class diberi:

```java
@XmlRootElement(name = "customer", namespace = "urn:example:customer")
@XmlAccessorType(XmlAccessType.FIELD)
public class Customer {
    private String id;
    private String name;
}
```

Maka JAXB tahu bahwa instance `Customer` bisa dimarshal sebagai:

```xml
<customer xmlns="urn:example:customer">
  <id>C-001</id>
  <name>Fajar</name>
</customer>
```

`@XmlRootElement` mengikat **class** ke **global element name**.

Cocok untuk:

- code-first model sederhana;
- root element tunggal;
- DTO internal;
- XML kecil yang tidak berasal dari XSD kompleks.

Namun dalam schema-first, class yang dihasilkan XJC sering tidak selalu punya `@XmlRootElement`, terutama saat schema memisahkan element dan complex type.

---

### 3.2 Masalah Tanpa `@XmlRootElement`

Misal generated class:

```java
@XmlAccessorType(XmlAccessType.FIELD)
@XmlType(name = "CustomerType", propOrder = {"id", "name"})
public class CustomerType {
    protected String id;
    protected String name;
}
```

Jika kita melakukan:

```java
marshaller.marshal(new CustomerType(), outputStream);
```

JAXB bisa gagal karena tidak tahu root element name-nya.

Kenapa?

Karena `CustomerType` hanya type. Ia bukan element declaration.

XML butuh element name:

```xml
<customer>...</customer>
```

Bukan hanya type.

JAXB perlu tahu:

```text
Value: CustomerType instance
Element QName: {urn:example:customer}customer
Declared type: CustomerType.class
```

Itu fungsi `JAXBElement`.

---

## 4. `JAXBElement`: Value + Element Metadata

`JAXBElement<T>` adalah wrapper yang membawa:

- `QName name` — nama element XML.
- `Class<T> declaredType` — Java type yang dideklarasikan.
- optional scope — konteks element lokal/global.
- `T value` — object/value sebenarnya.
- nil flag — apakah element bernilai `xsi:nil="true"`.

Contoh manual:

```java
QName customerName = new QName("urn:example:customer", "customer");
CustomerType customer = new CustomerType();
customer.setId("C-001");
customer.setName("Fajar");

JAXBElement<CustomerType> root = new JAXBElement<>(
    customerName,
    CustomerType.class,
    customer
);

marshaller.marshal(root, outputStream);
```

Output:

```xml
<ns2:customer xmlns:ns2="urn:example:customer">
  <id>C-001</id>
  <name>Fajar</name>
</ns2:customer>
```

Mental model:

```text
CustomerType saja menjawab: "apa value/type-nya?"
JAXBElement menjawab: "value ini muncul sebagai element XML bernama apa?"
```

---

## 5. Kapan `JAXBElement` Muncul?

`JAXBElement` sering muncul pada generated code dari XSD/WSDL ketika:

1. Global element memakai complex type yang terpisah.
2. Element lokal memakai nama yang tidak bisa langsung direpresentasikan sebagai property biasa.
3. Ada `xsd:choice`.
4. Ada element reference (`ref=`).
5. Ada substitution group.
6. Ada `nillable=true` dan optionality kompleks.
7. Ada element dengan nama sama tetapi scope berbeda.
8. Ada kebutuhan preserve element QName.

Contoh XSD:

```xml
<xs:element name="customer" type="tns:CustomerType"/>

<xs:complexType name="CustomerType">
  <xs:sequence>
    <xs:element name="id" type="xs:string"/>
  </xs:sequence>
</xs:complexType>
```

Generated bisa menghasilkan:

```java
@XmlRegistry
public class ObjectFactory {
    private final static QName _Customer_QNAME =
        new QName("urn:example:customer", "customer");

    public CustomerType createCustomerType() {
        return new CustomerType();
    }

    @XmlElementDecl(namespace = "urn:example:customer", name = "customer")
    public JAXBElement<CustomerType> createCustomer(CustomerType value) {
        return new JAXBElement<CustomerType>(_Customer_QNAME, CustomerType.class, null, value);
    }
}
```

Lalu penggunaan ideal:

```java
ObjectFactory factory = new ObjectFactory();
JAXBElement<CustomerType> customerElement = factory.createCustomer(customer);
marshaller.marshal(customerElement, out);
```

---

## 6. `ObjectFactory`: Bukan Sekadar Boilerplate Generated Code

Banyak developer menganggap `ObjectFactory` sebagai file generated yang tidak perlu dipahami. Itu berbahaya.

`ObjectFactory` adalah registry factory untuk:

1. Membuat instance Java type.
2. Membuat `JAXBElement` untuk element declarations.
3. Menyimpan mapping `QName` via `@XmlElementDecl`.
4. Membantu JAXB membedakan element name, declared type, dan scope.

Contoh:

```java
@XmlRegistry
public class ObjectFactory {

    private final static QName _Order_QNAME =
        new QName("urn:example:order", "order");

    public ObjectFactory() {}

    public OrderType createOrderType() {
        return new OrderType();
    }

    @XmlElementDecl(namespace = "urn:example:order", name = "order")
    public JAXBElement<OrderType> createOrder(OrderType value) {
        return new JAXBElement<>(_Order_QNAME, OrderType.class, null, value);
    }
}
```

Jika generated model schema-first memiliki `ObjectFactory`, gunakan itu.

Jangan biasakan membuat `QName` manual tersebar di seluruh kode:

```java
// Kurang ideal: QName tersebar, raw string berulang.
new JAXBElement<>(new QName("urn:example:order", "order"), OrderType.class, order);
```

Lebih baik:

```java
ObjectFactory f = new ObjectFactory();
JAXBElement<OrderType> root = f.createOrder(order);
```

Alasannya:

- namespace terpusat;
- element declaration terjaga;
- lebih tahan terhadap regenerate;
- lebih mudah difind saat contract berubah;
- mengurangi typo pada QName.

---

## 7. `@XmlElementDecl`: Element Declaration di Java

`@XmlElementDecl` dipakai pada factory method di `ObjectFactory`.

Contoh:

```java
@XmlElementDecl(namespace = "urn:example:order", name = "order")
public JAXBElement<OrderType> createOrder(OrderType value) {
    return new JAXBElement<>(_Order_QNAME, OrderType.class, null, value);
}
```

Annotation ini memberi tahu JAXB:

```text
Ada element XML global/local bernama {urn:example:order}order
Value Java-nya adalah OrderType
```

Untuk element lokal dengan scope, bisa ada:

```java
@XmlElementDecl(
    namespace = "urn:example:order",
    name = "status",
    scope = OrderType.class
)
public JAXBElement<String> createOrderTypeStatus(String value) {
    return new JAXBElement<>(_OrderTypeStatus_QNAME, String.class, OrderType.class, value);
}
```

Scope penting ketika element bernama sama muncul di konteks berbeda.

Contoh:

```xml
<order>
  <status>SUBMITTED</status>
</order>

<invoice>
  <status>PAID</status>
</invoice>
```

Keduanya sama-sama `status`, tapi semantics-nya beda.

JAXB bisa memakai scoped element declaration untuk membedakannya.

---

## 8. `@XmlElementRef` dan `@XmlElementRefs`

### 8.1 `@XmlElement` vs `@XmlElementRef`

`@XmlElement` biasanya menurunkan element name dari annotation/property.

```java
@XmlElement(name = "customer")
private CustomerType customer;
```

JAXB tahu field `customer` dimarshal sebagai `<customer>`.

`@XmlElementRef` berbeda. Ia menggunakan element name dari `JAXBElement` atau element declaration yang direferensikan.

```java
@XmlElementRef(name = "customer", namespace = "urn:example:customer")
private JAXBElement<CustomerType> customer;
```

Mental model:

```text
@XmlElement    : property menentukan element name.
@XmlElementRef : value/JAXBElement/factory declaration menentukan element name.
```

---

### 8.2 Kapan `@XmlElementRef` Dipakai?

Umumnya pada schema dengan:

- `ref=`;
- substitution group;
- `choice`;
- element declaration reuse;
- polymorphic element name;
- `JAXBElement` property.

Contoh XSD:

```xml
<xs:element name="emailContact" type="tns:EmailContactType"/>
<xs:element name="phoneContact" type="tns:PhoneContactType"/>

<xs:complexType name="ContactListType">
  <xs:choice maxOccurs="unbounded">
    <xs:element ref="tns:emailContact"/>
    <xs:element ref="tns:phoneContact"/>
  </xs:choice>
</xs:complexType>
```

Generated model bisa seperti:

```java
@XmlElementRefs({
    @XmlElementRef(name = "emailContact", namespace = "urn:example", type = JAXBElement.class),
    @XmlElementRef(name = "phoneContact", namespace = "urn:example", type = JAXBElement.class)
})
protected List<JAXBElement<?>> emailContactOrPhoneContact;
```

Ini terlihat jelek, tapi secara kontrak sangat akurat:

```text
List berisi sequence pilihan element yang QName-nya harus dipertahankan.
```

Jika kita paksa menjadi:

```java
private List<Contact> contacts;
```

kita mungkin kehilangan:

- element name asli;
- ordering antar pilihan;
- type declaration;
- substitution behavior;
- compatibility dengan schema.

---

## 9. `xsd:choice`: Kenapa Generated Model Sering “Aneh”

Contoh XSD:

```xml
<xs:complexType name="PaymentInstructionType">
  <xs:choice>
    <xs:element name="bankTransfer" type="tns:BankTransferType"/>
    <xs:element name="cardPayment" type="tns:CardPaymentType"/>
    <xs:element name="cashPayment" type="tns:CashPaymentType"/>
  </xs:choice>
</xs:complexType>
```

Secara bisnis, kita ingin Java seperti:

```java
sealed interface PaymentInstruction permits BankTransfer, CardPayment, CashPayment {}
```

Namun JAXB generated code mungkin menghasilkan:

```java
@XmlElements({
    @XmlElement(name = "bankTransfer", type = BankTransferType.class),
    @XmlElement(name = "cardPayment", type = CardPaymentType.class),
    @XmlElement(name = "cashPayment", type = CashPaymentType.class)
})
protected Object bankTransferOrCardPaymentOrCashPayment;
```

Atau list:

```java
@XmlElements({ ... })
protected List<Object> bankTransferOrCardPaymentOrCashPayment;
```

Kenapa?

Karena XSD choice artinya:

```text
Pada posisi ini, XML boleh memilih satu dari beberapa element/type.
```

Java tidak punya representasi native untuk “one-of named XML element choice” sebelum sealed interface, dan JAXB harus kompatibel lintas Java lama.

Di Java 17+, secara domain kita bisa membuat sealed interface, tapi generated JAXB model belum tentu ideal untuk itu, terutama jika schema-first legacy harus dipertahankan.

---

## 10. Strategi Menghadapi `choice`

Ada 3 strategi umum.

### 10.1 Terima Generated Model Apa Adanya

Gunakan generated class langsung:

```java
Object choice = instruction.getBankTransferOrCardPaymentOrCashPayment();

if (choice instanceof BankTransferType bank) {
    // handle bank transfer
} else if (choice instanceof CardPaymentType card) {
    // handle card payment
} else if (choice instanceof CashPaymentType cash) {
    // handle cash payment
} else {
    throw new UnknownPaymentInstructionException(choice);
}
```

Kelebihan:

- paling setia pada XSD;
- minim customization;
- regenerate aman;
- cocok untuk SOAP proxy/client generated.

Kekurangan:

- model Java kurang bersih;
- butuh runtime type check;
- business logic mudah tercampur dengan XML model.

Cocok untuk:

- integration adapter layer;
- generated SOAP client/server model;
- sistem legacy yang schema-nya tidak boleh diubah.

---

### 10.2 Bungkus dengan Domain Adapter

Generated model tetap ada di boundary. Domain internal dibuat bersih.

```java
public sealed interface PaymentInstruction
        permits BankTransferInstruction, CardPaymentInstruction, CashPaymentInstruction {
}
```

Mapper:

```java
public final class PaymentInstructionMapper {

    public PaymentInstruction toDomain(PaymentInstructionType xml) {
        Object value = xml.getBankTransferOrCardPaymentOrCashPayment();

        if (value instanceof BankTransferType bank) {
            return new BankTransferInstruction(bank.getAccountNo(), bank.getAmount());
        }
        if (value instanceof CardPaymentType card) {
            return new CardPaymentInstruction(card.getToken(), card.getAmount());
        }
        if (value instanceof CashPaymentType cash) {
            return new CashPaymentInstruction(cash.getAmount());
        }

        throw new IllegalArgumentException("Unsupported payment choice: " + value);
    }
}
```

Ini biasanya pilihan terbaik.

Mental model:

```text
JAXB model = contract shape model
Domain model = business meaning model
Mapper = anti-corruption layer
```

---

### 10.3 XJC Binding Customization

Kadang kita bisa mengubah generated model dengan binding file.

Contoh tujuan:

- rename class/property;
- gunakan interface tertentu;
- custom adapter;
- ubah collection type;
- ubah date type;
- flatten/rename property.

Namun jangan over-customize sampai generated model menjadi “cantik tapi tidak jujur” terhadap XSD.

Rule of thumb:

> Binding customization boleh memperbaiki ergonomics, tetapi jangan menyembunyikan semantic penting dari XML contract.

---

## 11. `@XmlElements`: Multiple Candidate Elements by Type

`@XmlElements` dipakai ketika satu Java property bisa berisi beberapa element berbeda.

Contoh:

```java
@XmlElements({
    @XmlElement(name = "email", type = EmailContact.class),
    @XmlElement(name = "phone", type = PhoneContact.class)
})
private List<Contact> contacts;
```

Output:

```xml
<email>...</email>
<phone>...</phone>
```

Kelebihan:

- lebih natural daripada `JAXBElement<?>` jika element name bisa ditentukan dari Java subtype.

Kekurangan:

- element QName bisa lebih kaku;
- tidak sekuat `@XmlElementRef` untuk substitution group/ref;
- runtime polymorphism tetap perlu hati-hati.

Cocok ketika:

- kita code-first;
- element alternatives terbatas;
- tidak butuh substitution group formal;
- schema bisa mengikuti Java model.

---

## 12. Polymorphism di JAXB

Ada beberapa mekanisme polymorphism:

1. Java inheritance + `@XmlSeeAlso`.
2. `xsi:type`.
3. `@XmlElements`.
4. `@XmlElementRef`/substitution group.
5. `@XmlAnyElement(lax = true)`.
6. Adapter manual.

Masing-masing punya konsekuensi contract.

---

### 12.1 Java Inheritance + `@XmlSeeAlso`

Contoh:

```java
@XmlAccessorType(XmlAccessType.FIELD)
@XmlSeeAlso({IndividualCustomer.class, CorporateCustomer.class})
public abstract class Customer {
    private String id;
}

@XmlAccessorType(XmlAccessType.FIELD)
public class IndividualCustomer extends Customer {
    private String fullName;
}

@XmlAccessorType(XmlAccessType.FIELD)
public class CorporateCustomer extends Customer {
    private String companyName;
}
```

`@XmlSeeAlso` membantu JAXBContext mengetahui subtype.

Tanpa itu, jika context hanya dibuat untuk base class:

```java
JAXBContext.newInstance(Customer.class);
```

JAXB belum tentu tahu `IndividualCustomer` dan `CorporateCustomer`.

Namun `@XmlSeeAlso` tidak otomatis menyelesaikan semua masalah XML shape. Ia hanya memberi petunjuk kelas tambahan.

---

### 12.2 `xsi:type`

XML bisa membawa type runtime:

```xml
<customer xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
          xsi:type="IndividualCustomerType">
  <id>C-001</id>
  <fullName>Fajar</fullName>
</customer>
```

Mental model:

```text
Element name tetap customer.
Runtime schema type adalah IndividualCustomerType.
```

Ini berbeda dengan:

```xml
<individualCustomer>...</individualCustomer>
```

Di SOAP legacy, `xsi:type` bisa muncul dari tool vendor tertentu.

Kelebihan:

- element name stabil;
- subtype bisa diekspresikan via schema type.

Kekurangan:

- consumer harus memahami `xsi:type`;
- bisa menambah coupling pada type hierarchy;
- raw XML lebih sulit dibaca;
- security perlu hati-hati jika polymorphic binding terlalu longgar.

---

### 12.3 Element Name Polymorphism

Alternatifnya, subtype diekspresikan oleh element name:

```xml
<individualCustomer>...</individualCustomer>
<corporateCustomer>...</corporateCustomer>
```

Ini biasanya dipetakan dengan `@XmlElements` atau `@XmlElementRefs`.

Kelebihan:

- XML lebih eksplisit;
- consumer bisa switch berdasarkan element name;
- cocok untuk `xsd:choice`.

Kekurangan:

- element declaration lebih banyak;
- perubahan nama element adalah breaking change;
- Java model bisa jadi `Object`/`JAXBElement<?>`.

---

## 13. Substitution Group: Polymorphism ala XSD

XSD substitution group memungkinkan satu element menggantikan element lain.

Contoh konseptual:

```xml
<xs:element name="contact" type="tns:ContactType" abstract="true"/>
<xs:element name="emailContact" type="tns:EmailContactType" substitutionGroup="tns:contact"/>
<xs:element name="phoneContact" type="tns:PhoneContactType" substitutionGroup="tns:contact"/>
```

Lalu schema bisa menerima:

```xml
<emailContact>...</emailContact>
```

atau:

```xml
<phoneContact>...</phoneContact>
```

pada posisi yang mereferensikan `contact`.

JAXB generated model sering memakai `JAXBElement` + `@XmlElementRef(s)` untuk menjaga element QName.

Mental model:

```text
Substitution group = element-level polymorphism formal di XSD.
```

Jangan buru-buru menghilangkannya menjadi base class biasa, karena element name adalah bagian dari kontrak.

---

## 14. `XmlAdapter`: Mapping Antara XML-Friendly Type dan Java-Friendly Type

### 14.1 Masalah yang Diselesaikan Adapter

Kadang Java type yang kita inginkan tidak cocok langsung dengan XML representation.

Contoh:

- `LocalDate` ↔ `xs:date`.
- `OffsetDateTime` ↔ legacy timestamp string.
- `Money` ↔ amount + currency.
- `Map<K,V>` ↔ repeated entry elements.
- encrypted/masked value.
- code table enum dengan legacy value.
- `UUID` ↔ string.
- domain value object ↔ simple XML value.

`XmlAdapter<ValueType, BoundType>` menyelesaikan ini.

```text
ValueType = XML-friendly representation
BoundType = Java object type yang ingin dipakai di model
```

Signature:

```java
public abstract class XmlAdapter<ValueType, BoundType> {
    public abstract BoundType unmarshal(ValueType v) throws Exception;
    public abstract ValueType marshal(BoundType v) throws Exception;
}
```

---

### 14.2 Contoh Adapter: `LocalDate`

```java
public final class LocalDateAdapter extends XmlAdapter<String, LocalDate> {

    @Override
    public LocalDate unmarshal(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        return LocalDate.parse(value); // ISO yyyy-MM-dd
    }

    @Override
    public String marshal(LocalDate value) {
        if (value == null) {
            return null;
        }
        return value.toString();
    }
}
```

Pemakaian field:

```java
@XmlJavaTypeAdapter(LocalDateAdapter.class)
private LocalDate birthDate;
```

Output:

```xml
<birthDate>1996-05-01</birthDate>
```

---

### 14.3 Adapter untuk Legacy Date Format

Legacy system sering memakai format seperti `yyyyMMdd`.

```java
public final class LegacyDateAdapter extends XmlAdapter<String, LocalDate> {

    private static final DateTimeFormatter FORMATTER =
        DateTimeFormatter.ofPattern("yyyyMMdd");

    @Override
    public LocalDate unmarshal(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        return LocalDate.parse(value, FORMATTER);
    }

    @Override
    public String marshal(LocalDate value) {
        if (value == null) {
            return null;
        }
        return FORMATTER.format(value);
    }
}
```

Hal penting:

- `DateTimeFormatter` immutable dan thread-safe.
- Jangan pakai `SimpleDateFormat` static shared tanpa proteksi karena tidak thread-safe.
- Untuk Java 8+, prefer `java.time`.

---

### 14.4 Adapter untuk Value Object

Domain:

```java
public record PostalCode(String value) {
    public PostalCode {
        if (value == null || !value.matches("\\d{6}")) {
            throw new IllegalArgumentException("Postal code must be 6 digits");
        }
    }
}
```

Adapter:

```java
public final class PostalCodeAdapter extends XmlAdapter<String, PostalCode> {

    @Override
    public PostalCode unmarshal(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        return new PostalCode(value);
    }

    @Override
    public String marshal(PostalCode value) {
        return value == null ? null : value.value();
    }
}
```

DTO:

```java
@XmlJavaTypeAdapter(PostalCodeAdapter.class)
private PostalCode postalCode;
```

Pertanyaan desain:

Apakah adapter boleh throw saat value invalid?

Jawabannya tergantung boundary:

- Untuk inbound strict contract, throw bisa benar.
- Untuk legacy feed yang perlu collect errors, adapter sebaiknya tidak langsung menghentikan semua parsing tanpa strategi error collection.
- Untuk regulatory/audit system, invalid value sebaiknya menghasilkan error terstruktur dengan location/correlation id.

---

## 15. Scope `@XmlJavaTypeAdapter`

Adapter bisa dipasang di beberapa level:

1. Field/property.
2. Type/class.
3. Package via `package-info.java`.
4. Parameter/method tertentu.

### 15.1 Field-Level Adapter

```java
@XmlJavaTypeAdapter(LegacyDateAdapter.class)
private LocalDate issueDate;
```

Cocok ketika hanya field itu punya format khusus.

---

### 15.2 Type-Level Adapter

```java
@XmlJavaTypeAdapter(PostalCodeAdapter.class)
public record PostalCode(String value) {}
```

Setiap penggunaan `PostalCode` memakai adapter ini.

Cocok untuk value object yang selalu punya XML representation sama.

---

### 15.3 Package-Level Adapter

`package-info.java`:

```java
@XmlJavaTypeAdapters({
    @XmlJavaTypeAdapter(type = LocalDate.class, value = LocalDateAdapter.class),
    @XmlJavaTypeAdapter(type = OffsetDateTime.class, value = OffsetDateTimeAdapter.class)
})
package com.example.integration.xml;

import jakarta.xml.bind.annotation.adapters.XmlJavaTypeAdapter;
import jakarta.xml.bind.annotation.adapters.XmlJavaTypeAdapters;

import java.time.LocalDate;
import java.time.OffsetDateTime;
```

Cocok untuk standardisasi format dalam satu package model.

Risiko:

- terlalu global;
- field khusus jadi ikut berubah;
- regenerate generated code bisa menimpa/menyulitkan.

---

## 16. Adapter Design Rules

Adapter terlihat kecil, tapi bisa menjadi sumber bug besar.

### 16.1 Adapter Harus Deterministic

Input sama harus menghasilkan output sama.

Buruk:

```java
@Override
public String marshal(Token value) {
    return encryptWithRandomKey(value.raw());
}
```

Jika output dipakai untuk signature/canonicalization, random output bisa merusak integritas.

Lebih baik pisahkan encryption layer dari JAXB mapping kecuali memang contract menyatakan field encrypted.

---

### 16.2 Adapter Jangan Diam-Diam Mengubah Meaning

Buruk:

```java
@Override
public BigDecimal unmarshal(String value) {
    return new BigDecimal(value).setScale(2, RoundingMode.HALF_UP);
}
```

Jika XML mengirim `12.345`, adapter mengubah ke `12.35` tanpa jejak.

Untuk amount/regulatory/financial, itu berbahaya.

Lebih aman:

```java
BigDecimal parsed = new BigDecimal(value);
if (parsed.scale() > 2) {
    throw new IllegalArgumentException("Amount scale exceeds 2 decimal places");
}
return parsed;
```

---

### 16.3 Adapter Jangan Menjadi Business Service

Buruk:

```java
public Customer unmarshal(CustomerXml value) {
    Customer customer = customerRepository.findById(value.id());
    customer.updateName(value.name());
    return customer;
}
```

Adapter dipanggil oleh JAXB runtime saat parsing. Ia tidak cocok untuk:

- database access;
- remote service call;
- authorization;
- side effect;
- audit write;
- transaction boundary.

Adapter sebaiknya pure mapping.

---

### 16.4 Adapter Harus Thread-Safe atau Stateless

Marshaller/Unmarshaller tidak thread-safe secara umum; namun adapter instance handling bisa bergantung implementation/runtime. Praktik aman:

- adapter stateless;
- immutable formatter;
- tidak menyimpan mutable request state;
- tidak memakai static mutable object yang tidak thread-safe.

---

## 17. Mapping `Map<K,V>`

XML Schema tidak punya konsep “map” seperti Java.

Java:

```java
Map<String, String> attributes;
```

XML harus memilih shape:

```xml
<attributes>
  <entry key="color" value="blue"/>
  <entry key="size" value="large"/>
</attributes>
```

atau:

```xml
<attributes>
  <attribute>
    <key>color</key>
    <value>blue</value>
  </attribute>
</attributes>
```

atau dynamic element names:

```xml
<attributes>
  <color>blue</color>
  <size>large</size>
</attributes>
```

Yang terakhir lebih sulit dan sering tidak ideal untuk schema.

---

### 17.1 Adapter untuk Map

XML-friendly classes:

```java
@XmlAccessorType(XmlAccessType.FIELD)
public class AttributeEntries {

    @XmlElement(name = "entry")
    private List<AttributeEntry> entries = new ArrayList<>();

    public List<AttributeEntry> getEntries() {
        return entries;
    }
}

@XmlAccessorType(XmlAccessType.FIELD)
public class AttributeEntry {

    @XmlAttribute(name = "key", required = true)
    private String key;

    @XmlAttribute(name = "value")
    private String value;

    public AttributeEntry() {}

    public AttributeEntry(String key, String value) {
        this.key = key;
        this.value = value;
    }

    public String getKey() { return key; }
    public String getValue() { return value; }
}
```

Adapter:

```java
public final class StringMapAdapter
        extends XmlAdapter<AttributeEntries, Map<String, String>> {

    @Override
    public Map<String, String> unmarshal(AttributeEntries value) {
        if (value == null) {
            return Map.of();
        }

        Map<String, String> result = new LinkedHashMap<>();
        for (AttributeEntry entry : value.getEntries()) {
            if (entry.getKey() == null || entry.getKey().isBlank()) {
                throw new IllegalArgumentException("Map entry key is required");
            }
            if (result.containsKey(entry.getKey())) {
                throw new IllegalArgumentException("Duplicate map key: " + entry.getKey());
            }
            result.put(entry.getKey(), entry.getValue());
        }
        return result;
    }

    @Override
    public AttributeEntries marshal(Map<String, String> value) {
        AttributeEntries entries = new AttributeEntries();
        if (value == null) {
            return entries;
        }

        value.forEach((k, v) -> entries.getEntries().add(new AttributeEntry(k, v)));
        return entries;
    }
}
```

DTO:

```java
@XmlJavaTypeAdapter(StringMapAdapter.class)
private Map<String, String> attributes;
```

Production concern:

- duplicate keys;
- ordering;
- null key/value;
- unbounded map size;
- key validation;
- namespace if key becomes QName;
- security if keys later used in expression/template/log context.

---

## 18. Lists, Wrappers, and Repeated Elements

Ada dua shape utama untuk collection.

### 18.1 Repeated Element Directly

```xml
<order>
  <item>...</item>
  <item>...</item>
  <item>...</item>
</order>
```

Java:

```java
@XmlElement(name = "item")
private List<Item> items = new ArrayList<>();
```

XSD:

```xml
<xs:element name="item" type="tns:ItemType" minOccurs="0" maxOccurs="unbounded"/>
```

Cocok untuk schema-first SOAP style.

---

### 18.2 Wrapped Collection

```xml
<order>
  <items>
    <item>...</item>
    <item>...</item>
  </items>
</order>
```

Java:

```java
@XmlElementWrapper(name = "items")
@XmlElement(name = "item")
private List<Item> items = new ArrayList<>();
```

Kelebihan:

- lebih jelas grouping;
- bisa membedakan absent wrapper vs empty wrapper;
- bisa menambahkan metadata pada collection wrapper di masa depan.

Kekurangan:

- shape berbeda dari repeated direct;
- breaking change jika diubah setelah kontrak publish.

---

### 18.3 Live List Pattern di Generated JAXB

XJC sering menghasilkan getter tanpa setter:

```java
public List<ItemType> getItem() {
    if (item == null) {
        item = new ArrayList<ItemType>();
    }
    return this.item;
}
```

Tidak ada:

```java
setItem(List<ItemType> item)
```

Ini dikenal sebagai live list pattern.

Cara pakai:

```java
order.getItem().add(item1);
order.getItem().add(item2);
```

Kenapa begitu?

Karena JAXB ingin modifikasi list langsung terlihat oleh object model tanpa perlu setter.

Pitfall:

```java
List<ItemType> items = order.getItem();
items.clear(); // mengubah object XML model langsung
```

Di domain model internal, live list bisa berbahaya. Untuk boundary JAXB model, itu umum.

Strategi:

- Jangan expose generated JAXB model terlalu jauh ke domain/service layer.
- Convert ke immutable domain collection jika melewati boundary.
- Validasi ukuran list sebelum processing.

---

## 19. `nillable`, Absent, Empty, Default: Empat State yang Sering Tertukar

XML punya banyak cara menyatakan “tidak ada value”.

### 19.1 Absent Element

```xml
<customer>
  <id>C-001</id>
</customer>
```

`name` tidak muncul.

Makna mungkin:

- unknown;
- unchanged;
- optional not provided;
- not applicable;
- bug producer.

---

### 19.2 Empty Element

```xml
<name/>
```

atau:

```xml
<name></name>
```

Makna biasanya string kosong, tetapi binding bisa berbeda tergantung type.

---

### 19.3 Nil Element

```xml
<name xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:nil="true"/>
```

Ini eksplisit null, jika schema mengizinkan `nillable="true"`.

---

### 19.4 Default Value

XSD bisa punya default:

```xml
<xs:element name="status" type="xs:string" default="DRAFT"/>
```

Jika element absent, schema-aware processing bisa menganggap default value.

Namun jangan asumsi semua parser/binding otomatis menerapkan default seperti yang Anda harapkan tanpa validasi/schema processing.

---

### 19.5 Mapping Semantics Table

| XML shape | Kemungkinan Java value | Makna kontrak yang harus diputuskan |
|---|---:|---|
| element absent | `null` | tidak dikirim / optional / unchanged |
| `<field/>` | `""` atau `null` tergantung type/binding | kosong eksplisit |
| `<field xsi:nil="true"/>` | `null` + nil metadata jika `JAXBElement` | null eksplisit |
| default XSD | value default jika schema-aware | fallback kontrak |

Untuk PATCH/update flow, ini sangat penting.

Contoh:

```xml
<updateCustomer>
  <name xsi:nil="true"/>
</updateCustomer>
```

bisa berarti “hapus nama”.

Sedangkan:

```xml
<updateCustomer>
</updateCustomer>
```

bisa berarti “jangan ubah nama”.

Jika keduanya sama-sama menjadi `null` di Java, semantics hilang.

---

## 20. `JAXBElement` untuk Membedakan Nil vs Absent

Jika field biasa:

```java
@XmlElement(name = "name", nillable = true)
private String name;
```

Java `name == null` bisa berasal dari:

- element absent;
- element hadir dengan `xsi:nil="true"`;
- unmarshalling default behavior tertentu.

Jika butuh preserve metadata, generated model bisa memakai:

```java
@XmlElementRef(name = "name", namespace = "urn:example", type = JAXBElement.class)
private JAXBElement<String> name;
```

Lalu:

```java
if (name == null) {
    // absent
} else if (name.isNil()) {
    // explicit nil
} else {
    String value = name.getValue();
}
```

Ini memang lebih verbose, tapi semantics lebih kaya.

Decision rule:

> Jika business semantics membedakan absent vs explicit null, jangan buru-buru menghilangkan `JAXBElement`.

---

## 21. `@XmlAnyElement`: Wildcard Element Extension

XSD bisa mengizinkan extension elements:

```xml
<xs:any namespace="##other" processContents="lax" minOccurs="0" maxOccurs="unbounded"/>
```

Di JAXB:

```java
@XmlAnyElement(lax = true)
private List<Object> any;
```

Artinya model bisa menerima element yang tidak didefinisikan secara eksplisit.

Jika `lax = true`:

- jika JAXBContext mengenali element itu, ia bisa unmarshal menjadi JAXB object;
- jika tidak dikenal, biasanya menjadi DOM `Element`.

Jika `lax = false`:

- wildcard content biasanya menjadi DOM element.

---

### 21.1 Contoh Wildcard XML

```xml
<case xmlns="urn:example:case"
      xmlns:vendor="urn:vendor:extension">
  <id>CASE-001</id>
  <vendor:priorityScore>87</vendor:priorityScore>
</case>
```

Java:

```java
@XmlAnyElement(lax = true)
private List<Object> any = new ArrayList<>();
```

Processing:

```java
for (Object extension : caseType.getAny()) {
    if (extension instanceof Element dom) {
        QName name = new QName(dom.getNamespaceURI(), dom.getLocalName());
        // route based on QName
    } else if (extension instanceof KnownExtension known) {
        // strongly typed extension
    } else if (extension instanceof JAXBElement<?> element) {
        // JAXBElement extension
    }
}
```

---

### 21.2 Wildcard Design Rules

Wildcard berguna untuk extensibility, tapi berisiko.

Risiko:

- payload tak terbatas;
- unknown namespace membawa content besar;
- DOM memory blowup;
- malicious XML terselip;
- downstream code melakukan XPath tidak aman;
- extension semantics tidak diaudit;
- unknown element silently ignored.

Rule produksi:

1. Batasi ukuran XML sebelum unmarshal.
2. Tetap pakai secure parser config.
3. Allowlist namespace extension jika bisa.
4. Log unknown extension secara aman.
5. Jangan silently drop extension yang contractually relevant.
6. Tentukan policy: reject, preserve, ignore, atau route.
7. Jangan expose DOM langsung ke business layer.

---

## 22. `@XmlAnyAttribute`: Wildcard Attribute Extension

XML:

```xml
<case id="CASE-001" vendor:priority="high"
      xmlns:vendor="urn:vendor:extension"/>
```

Java:

```java
@XmlAnyAttribute
private Map<QName, String> otherAttributes = new HashMap<>();
```

`QName` penting karena attribute name bisa berasal dari namespace berbeda.

Processing:

```java
for (Map.Entry<QName, String> entry : otherAttributes.entrySet()) {
    QName name = entry.getKey();
    String value = entry.getValue();

    if ("urn:vendor:extension".equals(name.getNamespaceURI())
            && "priority".equals(name.getLocalPart())) {
        // handle vendor priority
    }
}
```

Security concern:

- Jangan masukkan arbitrary attribute ke SQL/query/template.
- Jangan treat attribute lokal tanpa namespace sebagai aman.
- Validate value length.
- Preserve namespace URI, bukan hanya prefix.

---

## 23. Mixed Content dengan `@XmlMixed`

Mixed content berarti element bisa berisi text dan child element bercampur.

Contoh:

```xml
<message>Hello <b>Fajar</b>, your case is <status>APPROVED</status>.</message>
```

XSD:

```xml
<xs:complexType name="MessageType" mixed="true">
  <xs:choice minOccurs="0" maxOccurs="unbounded">
    <xs:element name="b" type="xs:string"/>
    <xs:element name="status" type="xs:string"/>
  </xs:choice>
</xs:complexType>
```

JAXB:

```java
@XmlMixed
@XmlElementRefs({
    @XmlElementRef(name = "b", type = JAXBElement.class),
    @XmlElementRef(name = "status", type = JAXBElement.class)
})
private List<Serializable> content;
```

Atau `List<Object>` tergantung generated code.

Mixed content sulit karena order penting:

```text
"Hello "
<b>Fajar</b>
", your case is "
<status>APPROVED</status>
"."
```

Jika Anda ubah menjadi fields biasa:

```java
private String message;
private String bold;
private String status;
```

urutan dan text fragment hilang.

---

### 23.1 Kapan Mixed Content Muncul?

- XHTML-like content.
- Rich text template.
- Document management.
- Legal/regulatory text.
- SOAP body dengan embedded markup.
- Legacy content system.

Untuk business transaction data, mixed content biasanya sebaiknya dihindari.

---

### 23.2 Mixed Content Design Rules

1. Jangan parse mixed content dengan asumsi field order tidak penting.
2. Treat sebagai document/content model, bukan DTO biasa.
3. Sanitasi jika akan dirender ke HTML/UI.
4. Preserve unknown child element jika contract mengharuskan.
5. Hindari mapping ke plain string jika markup punya meaning.
6. Untuk template legal/regulatory, simpan canonical representation.

---

## 24. `QName` sebagai Value

Kadang XML value sendiri adalah QName:

```xml
<operationType xmlns:ops="urn:example:ops">ops:createCase</operationType>
```

Java bisa memakai `QName`:

```java
private QName operationType;
```

Masalah:

- prefix `ops` hanya lexical alias;
- namespace URI adalah identity sebenarnya;
- saat marshal, prefix bisa berubah;
- consumer yang salah bisa bergantung pada prefix.

Rule:

> Untuk logic, bandingkan `QName` berdasarkan namespace URI + local part, bukan prefix.

```java
QName expected = new QName("urn:example:ops", "createCase");
if (expected.equals(operationType)) {
    // correct
}
```

Jangan:

```java
if ("ops:createCase".equals(rawValue)) {
    // fragile
}
```

---

## 25. Namespace Prefix Control

Secara XML namespace, prefix tidak bermakna secara semantik.

```xml
<a:customer xmlns:a="urn:example:customer"/>
```

sama dengan:

```xml
<cust:customer xmlns:cust="urn:example:customer"/>
```

Namun beberapa legacy consumer salah bergantung pada prefix.

JAXB RI memiliki provider-specific mechanism untuk namespace prefix mapping, tetapi ini bukan portable standard murni.

Prinsip:

1. Jangan desain sistem baru yang bergantung pada prefix.
2. Jika consumer legacy menuntut prefix, isolasi sebagai compatibility layer.
3. Dokumentasikan bahwa itu provider-specific behavior.
4. Test output XML secara golden-file jika prefix benar-benar wajib.

Contoh konseptual dengan JAXB RI biasanya memakai property seperti namespace prefix mapper, tetapi nama property dan class bisa berbeda antara `javax`/`jakarta` dan implementation.

Jangan menyebarkan provider-specific property ke seluruh aplikasi. Bungkus:

```java
public interface XmlMarshallerCustomizer {
    void customize(Marshaller marshaller) throws JAXBException;
}
```

Lalu implementasi khusus RI:

```java
public final class JaxbRiNamespacePrefixCustomizer implements XmlMarshallerCustomizer {
    @Override
    public void customize(Marshaller marshaller) throws JAXBException {
        // Set provider-specific namespace prefix mapper here.
        // Keep isolated and tested.
    }
}
```

---

## 26. `@XmlValue`: Simple Content

XML bisa punya element dengan text value dan attribute:

```xml
<amount currency="SGD">123.45</amount>
```

Java:

```java
@XmlAccessorType(XmlAccessType.FIELD)
public class AmountXml {

    @XmlValue
    private BigDecimal value;

    @XmlAttribute(name = "currency", required = true)
    private String currency;
}
```

Mental model:

```text
@XmlValue = text content dari element
@XmlAttribute = metadata attribute pada element yang sama
```

Cocok untuk:

- amount + currency;
- code + scheme;
- identifier + issuing authority;
- display text + language;
- measured value + unit.

Contoh:

```xml
<length unit="cm">180</length>
```

---

## 27. Adapter untuk `@XmlValue` ke Domain Value Object

XML-friendly:

```java
@XmlAccessorType(XmlAccessType.FIELD)
public class MoneyXml {

    @XmlValue
    private BigDecimal amount;

    @XmlAttribute(name = "currency", required = true)
    private String currency;
}
```

Domain:

```java
public record Money(BigDecimal amount, Currency currency) {
    public Money {
        Objects.requireNonNull(amount);
        Objects.requireNonNull(currency);
        if (amount.scale() > currency.getDefaultFractionDigits()) {
            throw new IllegalArgumentException("Invalid scale for currency");
        }
    }
}
```

Adapter:

```java
public final class MoneyAdapter extends XmlAdapter<MoneyXml, Money> {

    @Override
    public Money unmarshal(MoneyXml value) {
        if (value == null) {
            return null;
        }
        return new Money(value.getAmount(), Currency.getInstance(value.getCurrency()));
    }

    @Override
    public MoneyXml marshal(Money value) {
        if (value == null) {
            return null;
        }
        MoneyXml xml = new MoneyXml();
        xml.setAmount(value.amount());
        xml.setCurrency(value.currency().getCurrencyCode());
        return xml;
    }
}
```

Boundary DTO:

```java
@XmlJavaTypeAdapter(MoneyAdapter.class)
private Money amount;
```

Trade-off:

- XML shape tetap contract-friendly.
- Domain tetap type-safe.
- Adapter menjadi anti-corruption micro-layer.

---

## 28. Inheritance Mapping dengan `@XmlType` dan `@XmlSeeAlso`

Contoh:

```java
@XmlAccessorType(XmlAccessType.FIELD)
@XmlType(name = "CasePartyType", propOrder = {"id"})
@XmlSeeAlso({PersonPartyType.class, OrganizationPartyType.class})
public abstract class CasePartyType {
    protected String id;
}

@XmlAccessorType(XmlAccessType.FIELD)
@XmlType(name = "PersonPartyType", propOrder = {"idNumber", "fullName"})
public class PersonPartyType extends CasePartyType {
    protected String idNumber;
    protected String fullName;
}

@XmlAccessorType(XmlAccessType.FIELD)
@XmlType(name = "OrganizationPartyType", propOrder = {"uen", "name"})
public class OrganizationPartyType extends CasePartyType {
    protected String uen;
    protected String name;
}
```

Possible XML with `xsi:type`:

```xml
<party xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
       xsi:type="PersonPartyType">
  <id>P-001</id>
  <idNumber>S1234567A</idNumber>
  <fullName>Fajar</fullName>
</party>
```

But schema design must support extension.

---

## 29. Polymorphism Security Concern

Polymorphic deserialization di JSON sering dikenal berbahaya jika type info bebas menentukan class. JAXB berbeda, tetapi tetap perlu hati-hati:

- Jangan buat `JAXBContext` terlalu luas untuk package besar yang berisi class tidak perlu.
- Jangan menerima unknown `xsi:type` tanpa schema/allowlist.
- Jangan pakai wildcard `lax=true` tanpa memahami class apa yang bisa di-bind.
- Validasi schema jika contract strict.
- Jangan instantiate arbitrary class dari external type hint.

Prinsip:

```text
External payload tidak boleh bebas menentukan object graph internal aplikasi.
```

---

## 30. Handling Unknown Elements: Reject, Preserve, or Ignore?

Saat schema berevolusi, producer bisa mengirim field baru.

Pilihan consumer:

### 30.1 Reject

Cocok untuk:

- regulatory filing strict;
- payment instruction;
- security-sensitive operation;
- command message;
- SOAP operation dengan contract resmi.

Kelebihan:

- failure cepat;
- tidak ada hidden semantics;
- audit jelas.

Kekurangan:

- forward compatibility rendah.

---

### 30.2 Ignore

Cocok untuk:

- read-only view;
- optional metadata;
- non-critical notification;
- tolerant client.

Risiko:

- field penting bisa diam-diam hilang;
- producer mengira consumer memproses padahal tidak;
- compliance issue jika extension membawa legal meaning.

---

### 30.3 Preserve

Cocok untuk:

- pass-through gateway;
- SOAP bridge;
- document router;
- archival system;
- migration facade.

Dengan `@XmlAnyElement`, unknown extension bisa disimpan dan dikirim kembali.

Risiko:

- menyimpan malicious XML;
- canonicalization/signature issue;
- namespace/prefix berubah saat re-marshal;
- perlu storage size limit.

---

## 31. `Unmarshaller.Listener` dan `Marshaller.Listener`

JAXB menyediakan listener untuk hook lifecycle.

Contoh:

```java
Unmarshaller unmarshaller = context.createUnmarshaller();
unmarshaller.setListener(new Unmarshaller.Listener() {
    @Override
    public void afterUnmarshal(Object target, Object parent) {
        if (target instanceof OrderType order) {
            // normalize or inspect after JAXB populated object
        }
    }
});
```

Gunakan untuk:

- lightweight normalization;
- parent-child linking jika diperlukan;
- diagnostics;
- invariant check sederhana.

Jangan gunakan untuk:

- DB access;
- remote call;
- authorization;
- heavy validation;
- business processing besar.

Listener bisa membuat parsing sulit diprediksi jika terlalu banyak logic.

---

## 32. Validation Event Handler

Saat unmarshal dengan schema validation:

```java
SchemaFactory sf = SchemaFactory.newInstance(XMLConstants.W3C_XML_SCHEMA_NS_URI);
Schema schema = sf.newSchema(new File("order.xsd"));

Unmarshaller u = context.createUnmarshaller();
u.setSchema(schema);
u.setEventHandler(event -> {
    System.err.println(event.getMessage());
    return false; // stop on first validation error
});
```

Untuk production, lebih baik kumpulkan error terstruktur:

```java
public final class CollectingValidationEventHandler implements ValidationEventHandler {

    private final List<ValidationEvent> events = new ArrayList<>();

    @Override
    public boolean handleEvent(ValidationEvent event) {
        events.add(event);
        return event.getSeverity() != ValidationEvent.FATAL_ERROR;
    }

    public List<ValidationEvent> events() {
        return List.copyOf(events);
    }
}
```

Decision:

- `return false`: fail fast.
- `return true`: continue if possible.

Untuk command/transaction message, fail fast biasanya lebih aman. Untuk batch import, collect errors bisa lebih useful.

---

## 33. `ID` / `IDREF`

XML Schema mendukung identity-like references.

Contoh:

```xml
<person id="P1">
  <name>Fajar</name>
</person>
<case owner="P1"/>
```

JAXB annotation:

```java
@XmlID
@XmlAttribute
private String id;

@XmlIDREF
@XmlAttribute
private Person owner;
```

Risiko:

- object graph bisa cyclic;
- partial document sulit;
- reference resolution tergantung document scope;
- external references tidak otomatis aman.

Untuk enterprise message, sering lebih baik memakai explicit identifier string dan resolve di service layer.

```java
@XmlAttribute(name = "ownerId")
private String ownerId;
```

Lalu service layer resolve dengan kontrol transaksi dan authorization.

---

## 34. Binary Data: `byte[]`, Base64, Hex, MTOM Preview

XML binary biasanya direpresentasikan sebagai base64:

```xml
<documentContent>SGVsbG8=</documentContent>
```

Java:

```java
@XmlElement(name = "documentContent")
private byte[] documentContent;
```

Untuk payload kecil, ok.

Untuk payload besar:

- base64 menambah ukuran;
- JAXB bisa memuat byte array besar ke memory;
- SOAP attachment/MTOM lebih tepat;
- streaming perlu dipikirkan.

Part MTOM/SAAJ akan dibahas lebih detail nanti.

Rule:

> Jangan treat `byte[]` di JAXB model sebagai solusi universal untuk dokumen besar.

---

## 35. Handling Large XML Models

Advanced mapping sering membuat object graph besar:

- nested list;
- wildcard DOM;
- base64 byte arrays;
- generated classes dengan live list;
- mixed content;
- validation metadata.

Production controls:

1. Limit request body size.
2. Limit XML depth/entity/security via parser config.
3. Disable external entity resolution.
4. Prefer StAX + partial unmarshal untuk payload besar.
5. Avoid DOM wildcard for untrusted huge extension.
6. Validate early but avoid double parsing where possible.
7. Do not log full XML payload.
8. Use correlation id and safe payload digest.

Partial unmarshal pattern:

```java
XMLInputFactory xif = XMLInputFactory.newFactory();
xif.setProperty(XMLInputFactory.SUPPORT_DTD, false);
xif.setProperty("javax.xml.stream.isSupportingExternalEntities", false);

XMLStreamReader reader = xif.createXMLStreamReader(inputStream);

while (reader.hasNext()) {
    if (reader.isStartElement()
            && "targetElement".equals(reader.getLocalName())
            && "urn:example".equals(reader.getNamespaceURI())) {
        JAXBElement<TargetType> element = unmarshaller.unmarshal(reader, TargetType.class);
        TargetType target = element.getValue();
        // process target
    }
    reader.next();
}
```

---

## 36. Generated Model vs Handwritten Model

### 36.1 Generated Model

Kelebihan:

- setia pada XSD;
- cocok SOAP/WSDL;
- regenerate saat schema berubah;
- minim human error;
- handles complex XSD constructs.

Kekurangan:

- Java model bisa tidak ergonomis;
- banyak `JAXBElement<?>`;
- live list;
- naming aneh;
- sulit dipakai langsung di domain.

---

### 36.2 Handwritten Model

Kelebihan:

- bersih;
- bisa pakai records/value objects;
- domain-friendly;
- mudah dibaca.

Kekurangan:

- rentan drift dari XSD;
- sulit cover XSD constructs kompleks;
- annotation menjadi kontrak manual;
- compatibility testing wajib.

---

### 36.3 Recommended Architecture

Untuk enterprise integration:

```text
External XML/SOAP
   ↓
Generated JAXB model / strict boundary model
   ↓
Mapper / anti-corruption layer
   ↓
Domain command/query model
   ↓
Application service
```

Jangan:

```text
External XML/SOAP
   ↓
Domain entity langsung
   ↓
Database
```

Alasannya:

- XML contract berubah tidak sama dengan domain berubah.
- Legacy optionality tidak sama dengan domain invariant.
- JAXB annotation bisa mengotori domain model.
- Security/validation boundary jadi kabur.

---

## 37. Java Records dan JAXB Advanced Mapping

Java records menarik untuk DTO:

```java
public record Customer(String id, String name) {}
```

Namun JAXB tradisional mengandalkan:

- no-arg constructor;
- mutable fields/properties;
- reflection access;
- setter/getter conventions.

Di Jakarta XML Binding modern, support terhadap records tidak bisa diasumsikan sama lintas provider/version. Untuk contract-critical XML/SOAP, jangan desain bergantung pada record support kecuali sudah diverifikasi provider dan CI.

Strategi aman:

- gunakan generated/mutable JAXB boundary model;
- map ke record domain/internal DTO setelah unmarshal.

```java
public record CustomerView(String id, String name) {}

public CustomerView toView(CustomerType xml) {
    return new CustomerView(xml.getId(), xml.getName());
}
```

---

## 38. JPMS / Module System Concern

Java 9+ module system dapat mempengaruhi reflection.

Jika memakai module-info:

```java
module com.example.integration.xml {
    requires jakarta.xml.bind;
    requires java.xml;

    opens com.example.integration.xml.model to jakarta.xml.bind;
    exports com.example.integration.xml.api;
}
```

`opens` penting agar JAXB bisa reflective access.

Tanpa itu, Anda bisa mengalami error runtime karena JAXB tidak bisa mengakses field/constructor.

Untuk Java 8, module-info tidak relevan. Untuk Java 11–25, terutama aplikasi modular, perhatikan ini.

---

## 39. `javax` vs `jakarta` Advanced Mapping

Java/Jakarta migration bukan sekadar rename import.

| Era | Package | Notes |
|---|---|---|
| Java 8 built-in style | `javax.xml.bind.*` | Banyak app mengandalkan JDK membawa JAXB. |
| Java 11+ | `javax.xml.bind.*` tidak ada di JDK | Perlu dependency eksplisit jika tetap javax. |
| Jakarta XML Binding 3+ / 4+ | `jakarta.xml.bind.*` | Namespace package berubah dari javax ke jakarta. |

Generated code XJC juga bisa menghasilkan import berbeda tergantung versi tool.

Jangan campur model `javax` dan runtime `jakarta` sembarangan.

Contoh masalah:

```text
Class annotated with javax.xml.bind.annotation.XmlElement
Runtime expecting jakarta.xml.bind.annotation.XmlElement
```

Itu bukan annotation yang sama.

Migration rule:

1. Putuskan satu stack untuk satu module/app: `javax` atau `jakarta`.
2. Regenerate XSD classes dengan tool yang sesuai.
3. Update imports, dependencies, plugins, and runtime provider together.
4. Jangan hanya search-replace jika ada generated source dari schema.
5. Jalankan golden XML compatibility test.

---

## 40. Testing Advanced JAXB Mapping

### 40.1 Round-Trip Test Tidak Cukup

Round-trip:

```text
Java object -> XML -> Java object
```

bisa lulus walaupun XML tidak kompatibel dengan external consumer.

Kenapa?

Karena producer dan consumer test memakai binding yang sama dan bisa mengulang bug yang sama.

Butuh test lain.

---

### 40.2 Golden XML Test

Simpan expected XML:

```xml
<ord:order xmlns:ord="urn:example:order">
  <ord:id>O-001</ord:id>
</ord:order>
```

Test marshal output secara semantic XML comparison, bukan string mentah kecuali prefix/order wajib.

Check:

- QName;
- namespace URI;
- element order;
- attributes;
- nillable behavior;
- absent vs nil;
- wrapper shape;
- choice element name.

---

### 40.3 Schema Validation Test

```java
marshaller.setSchema(schema);
unmarshaller.setSchema(schema);
```

Test valid examples dan invalid examples.

Invalid examples penting:

- missing required element;
- wrong namespace;
- invalid enum;
- duplicate choice;
- unexpected extension;
- invalid date format;
- too many occurrences.

---

### 40.4 Compatibility Fixture Test

Ambil sample XML dari:

- partner system;
- legacy production anonymized payload;
- WSDL/XSD vendor example;
- regression bugs;
- previous version.

Test:

```text
v1 payload should still unmarshal in v2 consumer.
v2 producer should generate XML accepted by v1 consumer if backward compatibility promised.
```

---

### 40.5 Nil/Absent Test Matrix

Untuk field penting, test:

1. absent;
2. empty;
3. `xsi:nil=true`;
4. normal value;
5. whitespace value;
6. invalid lexical value.

Contoh test cases:

```xml
<updateCustomer/>
```

```xml
<updateCustomer><name/></updateCustomer>
```

```xml
<updateCustomer xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><name xsi:nil="true"/></updateCustomer>
```

```xml
<updateCustomer><name>Fajar</name></updateCustomer>
```

---

## 41. Observability and Debugging

JAXB advanced mapping failures sering muncul sebagai:

- `UnmarshalException`;
- `MarshalException`;
- unexpected element;
- missing `@XmlRootElement`;
- unknown `JAXBElement` declaration;
- invalid enum;
- invalid lexical value;
- class not known to context;
- module reflective access error;
- namespace mismatch.

Debug checklist:

1. Apa root QName payload?
2. Apakah `JAXBContext` dibuat dengan package/class yang benar?
3. Apakah ObjectFactory masuk ke context?
4. Apakah class punya `@XmlRootElement` atau butuh `JAXBElement`?
5. Apakah namespace URI benar, bukan hanya prefix?
6. Apakah schema version sama?
7. Apakah generated code sesuai runtime `javax`/`jakarta`?
8. Apakah module opens sudah benar?
9. Apakah adapter throw exception?
10. Apakah wildcard/mixed content membawa DOM besar?

Logging aman:

- log root QName;
- log schema version;
- log correlation id;
- log validation error line/column;
- log payload size;
- log hash/digest payload jika perlu;
- jangan log full XML dengan PII/secret.

---

## 42. Practical Design Patterns

### 42.1 Boundary Model Pattern

```text
JAXB generated model is not domain model.
```

Gunakan generated model hanya di adapter layer.

```java
public final class OrderXmlAdapter {

    public OrderCommand toCommand(OrderRequestType xml) {
        return new OrderCommand(
            xml.getOrderId(),
            toCustomer(xml.getCustomer()),
            toItems(xml.getItem())
        );
    }
}
```

---

### 42.2 Semantic Wrapper Pattern

Untuk `JAXBElement` verbose:

```java
public final class OptionalXmlElement<T> {
    private final boolean present;
    private final boolean nil;
    private final T value;

    // factory methods omitted
}
```

Mapper:

```java
public OptionalXmlElement<String> from(JAXBElement<String> element) {
    if (element == null) {
        return OptionalXmlElement.absent();
    }
    if (element.isNil()) {
        return OptionalXmlElement.nil();
    }
    return OptionalXmlElement.value(element.getValue());
}
```

Ini membantu PATCH/update semantics.

---

### 42.3 Extension Registry Pattern

Untuk wildcard:

```java
public interface XmlExtensionHandler {
    boolean supports(QName name);
    void handle(Element element, ExtensionContext context);
}
```

Registry:

```java
public final class XmlExtensionRegistry {
    private final List<XmlExtensionHandler> handlers;

    public void handle(Element element, ExtensionContext context) {
        QName name = new QName(element.getNamespaceURI(), element.getLocalName());
        handlers.stream()
            .filter(h -> h.supports(name))
            .findFirst()
            .orElseThrow(() -> new UnknownExtensionException(name))
            .handle(element, context);
    }
}
```

Ini lebih aman daripada `if-else` tersebar.

---

### 42.4 Contract Facade Pattern

Jika consumer legacy butuh prefix/order/format aneh, isolasi:

```text
Domain Service
   ↓
Canonical Integration DTO
   ↓
Legacy Contract Facade
   ↓
JAXB/SOAP client
```

Facade bertanggung jawab untuk:

- namespace prefix compatibility;
- legacy date format;
- weird nil semantics;
- field ordering;
- vendor extension;
- SOAP header requirements.

---

## 43. Anti-Patterns

### Anti-Pattern 1: Menghapus Semua `JAXBElement` agar Model Terlihat Bersih

Masalah:

- hilang element QName;
- hilang nil vs absent;
- substitution group rusak;
- choice semantics hilang.

Lebih baik: map ke domain model terpisah.

---

### Anti-Pattern 2: Domain Entity Dipenuhi Annotation JAXB

```java
@Entity
@XmlRootElement
public class CaseEntity { ... }
```

Masalah:

- persistence model tercampur contract XML;
- lazy loading bisa kena saat marshal;
- sensitive fields bisa bocor;
- schema evolution menekan database/domain design;
- security boundary kabur.

---

### Anti-Pattern 3: Wildcard `@XmlAnyElement(lax=true)` Tanpa Policy

Masalah:

- unknown content diproses diam-diam;
- DOM memory issue;
- extension bisa membawa semantics yang diabaikan;
- security review sulit.

---

### Anti-Pattern 4: Adapter Berisi Business Logic

Masalah:

- parsing jadi punya side effect;
- test sulit;
- transaction boundary tidak jelas;
- failure handling kacau.

---

### Anti-Pattern 5: Mengandalkan Prefix XML sebagai Identity

Masalah:

- prefix tidak semantik;
- marshaller bisa mengganti prefix;
- valid XML dianggap salah oleh test rapuh.

Jika legacy consumer membutuhkan prefix, treat sebagai compatibility exception.

---

## 44. Decision Matrix

| Problem | Preferred JAXB Tool | Caution |
|---|---|---|
| Root class tidak punya `@XmlRootElement` | `JAXBElement` via `ObjectFactory` | Jangan hardcode QName tersebar |
| XSD `choice` | generated `@XmlElements` / `@XmlElementRefs` | Map ke domain clean model di layer terpisah |
| Need absent vs nil distinction | `JAXBElement` | Field biasa `null` tidak cukup |
| Legacy date/value format | `XmlAdapter` | Jangan silent rounding/normalization |
| Map-like structure | Adapter to entry list | XML tidak punya map native |
| Extension elements | `@XmlAnyElement` | Harus ada extension policy |
| Extension attributes | `@XmlAnyAttribute` | Preserve QName, validate length/value |
| Rich text/document content | `@XmlMixed` | Jangan flatten ke string sembarangan |
| Polymorphic XML by element name | `@XmlElements` / substitution group | Element name adalah contract |
| Polymorphic XML by type | `xsi:type`, `@XmlSeeAlso` | Allowlist/context discipline |
| Prefix-sensitive legacy consumer | provider-specific prefix mapper | Isolasi dan golden-file test |

---

## 45. End-to-End Example: Case Update XML

### 45.1 XML Contract Requirements

Kita punya update case:

- `caseId` required.
- `title` optional update field.
- `description` bisa absent, nil, atau value.
- `party` bisa `personParty` atau `organizationParty`.
- `extensions` boleh dari namespace tertentu.
- `lastUpdatedDate` format legacy `yyyyMMdd`.

Example XML:

```xml
<caseUpdate xmlns="urn:example:case"
            xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
            xmlns:ext="urn:example:case:extension">
  <caseId>CASE-001</caseId>
  <title>Updated title</title>
  <description xsi:nil="true"/>
  <personParty>
    <id>P-001</id>
    <fullName>Fajar</fullName>
  </personParty>
  <lastUpdatedDate>20260617</lastUpdatedDate>
  <ext:riskScore>87</ext:riskScore>
</caseUpdate>
```

---

### 45.2 Boundary JAXB Model

```java
@XmlAccessorType(XmlAccessType.FIELD)
@XmlType(name = "CaseUpdateType", propOrder = {
    "caseId",
    "title",
    "description",
    "personPartyOrOrganizationParty",
    "lastUpdatedDate",
    "any"
})
public class CaseUpdateType {

    @XmlElement(required = true)
    private String caseId;

    private String title;

    @XmlElementRef(name = "description", namespace = "urn:example:case", type = JAXBElement.class)
    private JAXBElement<String> description;

    @XmlElements({
        @XmlElement(name = "personParty", type = PersonPartyType.class),
        @XmlElement(name = "organizationParty", type = OrganizationPartyType.class)
    })
    private PartyType personPartyOrOrganizationParty;

    @XmlJavaTypeAdapter(LegacyDateAdapter.class)
    private LocalDate lastUpdatedDate;

    @XmlAnyElement(lax = true)
    private List<Object> any = new ArrayList<>();

    // getters/setters
}
```

---

### 45.3 ObjectFactory for Description

```java
@XmlRegistry
public class ObjectFactory {

    private static final QName DESCRIPTION_QNAME =
        new QName("urn:example:case", "description");

    @XmlElementDecl(namespace = "urn:example:case", name = "description", scope = CaseUpdateType.class)
    public JAXBElement<String> createCaseUpdateTypeDescription(String value) {
        return new JAXBElement<>(DESCRIPTION_QNAME, String.class, CaseUpdateType.class, value);
    }
}
```

---

### 45.4 Domain Command

```java
public record CaseUpdateCommand(
    String caseId,
    Optional<String> title,
    UpdateField<String> description,
    Party party,
    LocalDate lastUpdatedDate,
    List<CaseExtension> extensions
) {}
```

`UpdateField`:

```java
public sealed interface UpdateField<T>
        permits UpdateField.Absent, UpdateField.Nil, UpdateField.Value {

    record Absent<T>() implements UpdateField<T> {}
    record Nil<T>() implements UpdateField<T> {}
    record Value<T>(T value) implements UpdateField<T> {}

    static <T> UpdateField<T> absent() { return new Absent<>(); }
    static <T> UpdateField<T> nil() { return new Nil<>(); }
    static <T> UpdateField<T> value(T value) { return new Value<>(value); }
}
```

---

### 45.5 Mapper

```java
public final class CaseUpdateMapper {

    public CaseUpdateCommand toCommand(CaseUpdateType xml) {
        return new CaseUpdateCommand(
            require(xml.getCaseId(), "caseId"),
            Optional.ofNullable(xml.getTitle()),
            mapUpdateField(xml.getDescription()),
            mapParty(xml.getPersonPartyOrOrganizationParty()),
            xml.getLastUpdatedDate(),
            mapExtensions(xml.getAny())
        );
    }

    private UpdateField<String> mapUpdateField(JAXBElement<String> element) {
        if (element == null) {
            return UpdateField.absent();
        }
        if (element.isNil()) {
            return UpdateField.nil();
        }
        return UpdateField.value(element.getValue());
    }

    private Party mapParty(PartyType party) {
        if (party instanceof PersonPartyType person) {
            return new PersonParty(person.getId(), person.getFullName());
        }
        if (party instanceof OrganizationPartyType org) {
            return new OrganizationParty(org.getId(), org.getName());
        }
        throw new IllegalArgumentException("Unsupported party type: " + party);
    }

    private List<CaseExtension> mapExtensions(List<Object> any) {
        if (any == null || any.isEmpty()) {
            return List.of();
        }
        List<CaseExtension> result = new ArrayList<>();
        for (Object item : any) {
            if (item instanceof Element element) {
                result.add(mapDomExtension(element));
            } else {
                throw new IllegalArgumentException("Unsupported extension object: " + item.getClass());
            }
        }
        return List.copyOf(result);
    }
}
```

This is what high-quality boundary mapping looks like:

```text
XML-specific complexity remains at boundary.
Domain command receives explicit semantics.
```

---

## 46. Checklist Before Shipping JAXB Advanced Mapping

### Contract

- [ ] Is the XML element name preserved where needed?
- [ ] Are namespace URIs correct?
- [ ] Are prefixes irrelevant, or intentionally controlled for legacy compatibility?
- [ ] Are `choice` and substitution semantics preserved?
- [ ] Are absent, empty, nil, and default values tested?
- [ ] Is XSD validation applied where needed?

### Java Model

- [ ] Is JAXB model separate from domain/persistence model?
- [ ] Are generated files not manually edited?
- [ ] Are ObjectFactory methods used instead of scattered QName construction?
- [ ] Are adapters stateless and deterministic?
- [ ] Are polymorphic subtypes known to JAXBContext?
- [ ] Are Java 8/11+/Jakarta dependencies consistent?

### Security

- [ ] Are secure XML parser settings applied?
- [ ] Is external entity access disabled?
- [ ] Are wildcard elements/attributes governed by policy?
- [ ] Is payload size limited?
- [ ] Is binary/base64 size controlled?
- [ ] Is XML logging safe?

### Compatibility

- [ ] Are golden XML fixtures tested?
- [ ] Are partner-provided XML examples tested?
- [ ] Are invalid XML cases tested?
- [ ] Is schema evolution tested backward/forward?
- [ ] Are `javax`/`jakarta` imports consistent?
- [ ] Are Java module `opens` configured if using JPMS?

### Observability

- [ ] Are validation errors reported with line/column if possible?
- [ ] Is root QName logged?
- [ ] Is schema version/correlation id logged?
- [ ] Are adapter failures distinguishable from schema failures?
- [ ] Are unknown extension elements visible in diagnostics?

---

## 47. Mental Model Summary

Advanced JAXB mapping is about preserving contract semantics.

Key ideas:

1. XML element name and XML type are not the same thing.
2. Java class and XML element declaration are not the same thing.
3. `JAXBElement` exists because XML has element metadata that plain Java object does not carry.
4. `ObjectFactory` is part of the binding contract, not useless generated noise.
5. `XmlAdapter` maps XML-friendly representation to Java-friendly type, but should stay pure and deterministic.
6. `choice`, substitution group, wildcard, mixed content, and nillable semantics are real contract constructs, not JAXB annoyances.
7. Generated JAXB model is often not beautiful Java, but it may be honest XML.
8. Clean domain model should usually sit behind a mapper/anti-corruption layer.
9. XML compatibility is tested with golden XML and schema validation, not just Java object round-trip.
10. Java 8–25 compatibility requires deliberate dependency, package, module, and provider choices.

The top-level engineering principle:

> Do not simplify XML mapping by deleting semantics.  
> Simplify by isolating XML semantics at the boundary and translating them explicitly into domain semantics.

---

## 48. Referensi Resmi dan Bacaan Lanjutan

- Jakarta XML Binding 4.0 specification and API docs: https://jakarta.ee/specifications/xml-binding/4.0/
- Jakarta XML Binding API docs: `JAXBElement`, `Unmarshaller`, annotation package, adapter package.
- Eclipse JAXB RI documentation: https://eclipse-ee4j.github.io/jaxb-ri/
- OpenJDK JEP 320 — Remove the Java EE and CORBA Modules: https://openjdk.org/jeps/320
- W3C XML Schema Part 1 and Part 2.
- Oracle Java XML processing/security documentation.

---

## 49. Selesai / Belum Selesai

Part 20 selesai.

Seri **belum selesai**. Masih ada part berikutnya:

- Part 21 — JAXB Runtime, Performance & Migration
- Part 22 — SOAP Mental Model
- Part 23 — WSDL Deep Dive
- Part 24 — JAX-WS / Jakarta XML Web Services Server Side
- ... sampai Part 34 — Integration Architecture Capstone

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-json-xml-soap-connectors-enterprise-integration — Part 19](./learn-java-json-xml-soap-connectors-enterprise-integration-part-019.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-json-xml-soap-connectors-enterprise-integration — Part 21](./learn-java-json-xml-soap-connectors-enterprise-integration-part-021.md)

</div>