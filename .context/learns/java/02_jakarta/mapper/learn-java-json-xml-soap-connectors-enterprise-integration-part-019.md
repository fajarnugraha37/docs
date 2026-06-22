# learn-java-json-xml-soap-connectors-enterprise-integration — Part 19
# JAXB Code-First Workflow: Java → XSD, Contract Drift Risk, Schema Generation, and Compatibility Testing

> Seri: `learn-java-json-xml-soap-connectors-enterprise-integration`  
> Part: `019` dari `034`  
> Topik: JAXB / Jakarta XML Binding code-first workflow  
> Target Java: 8 sampai 25  
> Fokus: kapan Java model boleh menjadi sumber awal XML schema, bagaimana menghasilkan XSD dari class Java, bagaimana mencegah contract drift, dan bagaimana menguji compatibility agar integrasi enterprise tidak rapuh.

---

## 0. Posisi Part Ini Dalam Seri

Pada Part 18 kita membahas **schema-first workflow**:

```text
XSD contract
  ↓
XJC binding compiler
  ↓
Generated Java classes
  ↓
JAXB runtime
  ↓
XML instance
```

Part 19 membahas arah sebaliknya:

```text
Java classes
  ↓
JAXB annotations
  ↓
schemagen / JAXBContext.generateSchema(...)
  ↓
Generated XSD
  ↓
External contract / validation artifact
```

Ini disebut **code-first** atau **Java-to-schema**.

Namun bagian ini harus dibaca dengan hati-hati. Dalam enterprise integration, code-first sering terlihat lebih cepat, tetapi bisa membuat kontrak eksternal menjadi tidak stabil. Java class cenderung berubah karena kebutuhan internal aplikasi. XML schema harus berubah lebih lambat karena schema adalah janji kepada consumer.

Mental model utamanya:

```text
Code-first is convenient for internal ownership.
Schema-first is safer for external interoperability.
```

Code-first bukan anti-pattern mutlak. Yang berbahaya adalah menjadikan struktur class internal sebagai kontrak eksternal tanpa governance.

---

## 1. Referensi Resmi dan Konteks Versi

Beberapa fakta dasar yang harus dikunci:

1. Jakarta XML Binding menyediakan API dan tools untuk otomatisasi mapping antara XML documents dan Java objects.
2. `JAXBContext` adalah entry point runtime untuk binding metadata, marshalling, unmarshalling, dan schema generation.
3. `SchemaOutputResolver` mengontrol ke mana implementation menulis schema hasil generation.
4. `schemagen` adalah tool Java-to-schema pada ekosistem JAXB/Jakarta XML Binding.
5. Sejak Java 11, modul Java EE/CORBA seperti `java.xml.bind` dihapus dari JDK, sehingga JAXB/Jakarta XML Binding runtime dan tooling harus menjadi dependency eksplisit.

Referensi utama:

- Jakarta XML Binding Specification/API: <https://jakarta.ee/specifications/xml-binding/4.0/>
- Jakarta XML Binding `SchemaOutputResolver`: <https://jakarta.ee/specifications/xml-binding/4.0/apidocs/jakarta.xml.bind/jakarta/xml/bind/schemaoutputresolver>
- Jakarta XML Binding annotation package: <https://jakarta.ee/specifications/xml-binding/4.0/apidocs/jakarta.xml.bind/jakarta/xml/bind/annotation/package-summary>
- Eclipse JAXB RI documentation: <https://eclipse-ee4j.github.io/jaxb-ri/4.0.5/docs/>
- OpenJDK JEP 320: <https://openjdk.org/jeps/320>
- Oracle JAXB Java-to-Schema tutorial: <https://docs.oracle.com/javase/tutorial/jaxb/intro/j2schema.html>

JEP 320 penting untuk migrasi Java 8 → 11+ karena `java.xml.bind` dan module terkait tidak lagi menjadi bagian JDK. Dengan kata lain, pada Java modern, code-first JAXB bukan sekadar masalah annotation, tetapi juga masalah build tooling, dependency, namespace `javax` vs `jakarta`, dan repeatability CI/CD.

---

## 2. Definisi Code-First Workflow

**Code-first JAXB workflow** adalah pendekatan ketika developer menulis Java class terlebih dahulu, menambahkan JAXB/Jakarta XML Binding annotations, lalu menghasilkan XML schema dari class tersebut.

Contoh sederhana:

```java
package com.acme.customer.contract.v1;

import jakarta.xml.bind.annotation.XmlAccessType;
import jakarta.xml.bind.annotation.XmlAccessorType;
import jakarta.xml.bind.annotation.XmlElement;
import jakarta.xml.bind.annotation.XmlRootElement;
import jakarta.xml.bind.annotation.XmlType;

@XmlRootElement(name = "customer", namespace = "https://api.acme.example/customer/v1")
@XmlAccessorType(XmlAccessType.FIELD)
@XmlType(
    name = "CustomerType",
    namespace = "https://api.acme.example/customer/v1",
    propOrder = {"id", "name", "email"}
)
public class CustomerXml {

    @XmlElement(name = "id", required = true)
    private String id;

    @XmlElement(name = "name", required = true)
    private String name;

    @XmlElement(name = "email", required = false)
    private String email;

    public CustomerXml() {
    }

    public CustomerXml(String id, String name, String email) {
        this.id = id;
        this.name = name;
        this.email = email;
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

    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }
}
```

Dari class ini, tooling dapat menghasilkan XSD kira-kira seperti:

```xml
<xs:schema
    xmlns:xs="http://www.w3.org/2001/XMLSchema"
    targetNamespace="https://api.acme.example/customer/v1"
    xmlns:tns="https://api.acme.example/customer/v1"
    elementFormDefault="qualified">

  <xs:element name="customer" type="tns:CustomerType"/>

  <xs:complexType name="CustomerType">
    <xs:sequence>
      <xs:element name="id" type="xs:string"/>
      <xs:element name="name" type="xs:string"/>
      <xs:element name="email" type="xs:string" minOccurs="0"/>
    </xs:sequence>
  </xs:complexType>
</xs:schema>
```

Yang terlihat sederhana ini menyembunyikan banyak keputusan:

- Apakah field order stabil?
- Apakah namespace stabil?
- Apakah optionality benar?
- Apakah `String` cukup spesifik untuk `id`?
- Apakah `email` harus punya pattern?
- Apakah `required=true` sama dengan non-null runtime?
- Apakah class ini akan berubah karena kebutuhan internal?
- Apakah XSD hasil generation deterministic di CI?
- Apakah perubahan schema diuji sebagai breaking/non-breaking?

Top 1% engineer tidak berhenti pada “bisa generate schema”. Mereka bertanya: **apakah schema yang dihasilkan bisa menjadi kontrak jangka panjang?**

---

## 3. Kapan Code-First Masuk Akal

Code-first masuk akal ketika **tim kita adalah owner penuh kontrak** dan consumer masih bisa dikendalikan.

Contoh yang relatif aman:

1. XML hanya dipakai internal antara dua komponen dalam satu bounded context.
2. Schema dipakai untuk dokumentasi atau validasi internal, bukan public integration contract.
3. Consumer dibuat oleh tim yang sama dan dirilis bersamaan.
4. XML format belum stabil dan masih dalam tahap prototyping.
5. Kita membangun test fixture XML dari model Java untuk integration testing.
6. Kita membungkus legacy internal object menjadi XML untuk batch export yang tidak dikonsumsi banyak pihak.
7. Kita membuat temporary adapter selama migration dari Java object lama ke sistem baru.

Contoh yang berisiko:

1. Schema diberikan ke external regulator, bank, vendor, government agency, atau enterprise partner.
2. Consumer tidak bisa dipaksa upgrade bersamaan.
3. Schema dipakai di WSDL SOAP service yang sudah published.
4. Ada compliance/audit requirement bahwa contract harus stabil dan versioned.
5. XML dipakai sebagai long-lived document/archive.
6. XML harus interoperable dengan .NET, mainframe, ERP, ESB, atau tool non-Java.
7. Schema perlu XSD constraints kaya seperti `pattern`, `choice`, `restriction`, `substitutionGroup`, atau identity constraint.

Rule praktis:

```text
If the XML is a durable external promise, prefer schema-first.
If the XML is a local projection of owned Java state, code-first may be acceptable.
```

---

## 4. Code-First vs Schema-First: Decision Matrix

| Faktor | Code-First | Schema-First |
|---|---|---|
| Starting point | Java class | XSD/WSDL contract |
| Best for | Internal owned XML, quick model projection | External integration, SOAP, regulated contracts |
| Contract stability | Risky unless governed | Stronger by design |
| Expressiveness | Limited by JAXB annotations | Full XSD expressiveness |
| Tooling direction | `schemagen`, `JAXBContext.generateSchema` | `xjc`, `wsimport`, binding files |
| Drift risk | High | Lower |
| Java refactor safety | Dangerous if class is contract | Safer if generated classes isolated |
| Cross-platform interoperability | Must be tested carefully | Usually better |
| Evolution control | Needs explicit compatibility tests | Schema diff can be primary gate |
| Best mental model | “Java projection exported as XML” | “Contract mapped into Java” |

The uncomfortable truth:

```text
Code-first feels developer-friendly.
Schema-first is consumer-friendly.
```

Enterprise integration usually fails at consumer boundary, not at local developer convenience.

---

## 5. The Core Danger: Contract Drift

**Contract drift** terjadi ketika contract yang keluar dari aplikasi berubah sebagai efek samping perubahan internal code.

Contoh drift:

```java
@XmlAccessorType(XmlAccessType.FIELD)
public class CustomerXml {
    private String id;
    private String fullName;
}
```

Kemudian developer melakukan refactor internal:

```java
@XmlAccessorType(XmlAccessType.FIELD)
public class CustomerXml {
    private String customerId;
    private String displayName;
}
```

Jika field names digunakan sebagai XML element names, maka XML berubah:

```xml
<!-- before -->
<customer>
  <id>C-001</id>
  <fullName>Alice Tan</fullName>
</customer>
```

Menjadi:

```xml
<!-- after -->
<customer>
  <customerId>C-001</customerId>
  <displayName>Alice Tan</displayName>
</customer>
```

Bagi Java compiler, ini mungkin refactor biasa. Bagi consumer XML, ini breaking change.

Inilah kenapa code-first harus dikunci dengan annotation eksplisit:

```java
@XmlElement(name = "id", required = true)
private String customerId;

@XmlElement(name = "fullName", required = true)
private String displayName;
```

Dengan begitu, nama Java boleh berubah, tetapi nama XML tetap stabil.

Mental model:

```text
Java identifier is implementation detail.
XML name is public contract.
```

---

## 6. Anti-Pattern: Domain Entity Langsung Dijadikan JAXB Contract

Ini salah satu kesalahan paling mahal.

```java
@Entity
@XmlRootElement(name = "customer")
public class Customer {
    @Id
    private Long id;

    private String name;

    @OneToMany(mappedBy = "customer")
    private List<Order> orders;
}
```

Masalahnya:

1. Entity memiliki lifecycle persistence, bukan contract lifecycle.
2. Relasi lazy-loading bisa terpanggil saat marshalling.
3. Circular reference bisa terjadi.
4. Internal DB shape bocor ke external XML.
5. Perubahan database bisa mengubah contract.
6. Field sensitif bisa tidak sengaja terekspos.
7. Annotation JPA dan JAXB punya kepentingan berbeda.
8. Compatibility external ikut tergantung refactor internal.

Lebih aman:

```text
JPA Entity
  ↓ explicit mapping
Boundary XML DTO
  ↓ JAXB marshal
XML contract
```

Contoh:

```java
public final class CustomerXmlMapper {

    public CustomerXml toXml(Customer customer) {
        CustomerXml xml = new CustomerXml();
        xml.setId(customer.getPublicReference());
        xml.setName(customer.getDisplayName());
        xml.setStatus(mapStatus(customer.getStatus()));
        return xml;
    }

    private String mapStatus(CustomerStatus status) {
        return switch (status) {
            case ACTIVE -> "ACTIVE";
            case SUSPENDED -> "SUSPENDED";
            case CLOSED -> "CLOSED";
        };
    }
}
```

Boundary XML DTO harus diperlakukan seperti API contract, bukan seperti domain model.

---

## 7. Design Rule: Contract Class Harus “Boring”

Class yang digunakan untuk JAXB code-first sebaiknya sengaja dibuat membosankan.

Ciri-ciri boundary XML DTO yang sehat:

1. Tidak berisi business logic kompleks.
2. Tidak menjadi JPA entity.
3. Tidak langsung menjadi internal domain aggregate.
4. Tidak punya dependency framework berat.
5. Tidak punya lazy relation.
6. Tidak expose secret/internal field.
7. Annotation XML eksplisit.
8. Namespace eksplisit.
9. Field order eksplisit.
10. Optionality eksplisit.
11. Mapping dari/ke domain dilakukan terpisah.
12. Tidak sering berubah karena refactor internal.

Contoh package structure:

```text
com.acme.customer
  domain/
    Customer.java
    CustomerStatus.java
  persistence/
    CustomerEntity.java
  contract/
    xml/
      v1/
        CustomerXml.java
        CustomerStatusXml.java
        package-info.java
      v2/
        CustomerXml.java
        CustomerStatusXml.java
  mapper/
    CustomerXmlMapper.java
```

Package versioning ini tidak selalu wajib, tetapi sangat membantu untuk kontrak eksternal.

---

## 8. Minimal Code-First Setup: Jakarta XML Binding 4.x

Untuk Java modern dengan Jakarta namespace:

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

Untuk `schemagen`/tooling, pada proyek modern biasanya memakai plugin Maven/Gradle atau artifact JAXB RI tooling. Versi persis dapat disesuaikan dengan stack Jakarta EE/application server yang dipakai.

Untuk legacy Java 8/Java EE style:

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

Pada Java 8, JAXB API pernah tersedia dari JDK, tetapi tetap lebih baik menormalkan dependency eksplisit jika target build/migration jangka panjang adalah Java 11+. Pada Java 11+, jangan mengandalkan module JDK lama karena sudah dihapus berdasarkan JEP 320.

---

## 9. `package-info.java`: Tempat Mengunci Namespace

Dalam code-first, namespace sering menjadi sumber drift. Jangan biarkan namespace muncul implicit dari package atau default provider behavior.

Gunakan `package-info.java`:

```java
@XmlSchema(
    namespace = "https://api.acme.example/customer/v1",
    elementFormDefault = XmlNsForm.QUALIFIED,
    attributeFormDefault = XmlNsForm.UNQUALIFIED,
    xmlns = {
        @XmlNs(prefix = "cust", namespaceURI = "https://api.acme.example/customer/v1")
    }
)
package com.acme.customer.contract.xml.v1;

import jakarta.xml.bind.annotation.XmlNs;
import jakarta.xml.bind.annotation.XmlNsForm;
import jakarta.xml.bind.annotation.XmlSchema;
```

Kenapa ini penting?

Tanpa namespace governance, XML bisa tampak “valid” secara lokal tetapi gagal di partner karena QName berbeda.

```xml
<customer>
  <id>C-001</id>
</customer>
```

Tidak sama dengan:

```xml
<cust:customer xmlns:cust="https://api.acme.example/customer/v1">
  <cust:id>C-001</cust:id>
</cust:customer>
```

Bagi manusia, sama-sama customer. Bagi XML processor, QName berbeda.

Rule:

```text
For XML contracts, namespace is part of the name.
```

---

## 10. Menghasilkan XSD dengan `JAXBContext.generateSchema`

Selain tool command-line `schemagen`, schema dapat dihasilkan programmatically menggunakan `JAXBContext.generateSchema(...)` dengan `SchemaOutputResolver`.

Contoh:

```java
package com.acme.customer.contract.tools;

import jakarta.xml.bind.JAXBContext;
import jakarta.xml.bind.SchemaOutputResolver;

import javax.xml.transform.Result;
import javax.xml.transform.stream.StreamResult;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

public final class GenerateCustomerSchema {

    public static void main(String[] args) throws Exception {
        Path outputDir = Path.of("target/generated-schemas/customer-v1");
        Files.createDirectories(outputDir);

        JAXBContext context = JAXBContext.newInstance(
            com.acme.customer.contract.xml.v1.CustomerXml.class
        );

        context.generateSchema(new DirectorySchemaOutputResolver(outputDir));
    }

    static final class DirectorySchemaOutputResolver extends SchemaOutputResolver {
        private final Path outputDir;

        DirectorySchemaOutputResolver(Path outputDir) {
            this.outputDir = outputDir;
        }

        @Override
        public Result createOutput(String namespaceUri, String suggestedFileName) throws IOException {
            String safeName = suggestedFileName == null || suggestedFileName.isBlank()
                ? "schema.xsd"
                : suggestedFileName;

            Path file = outputDir.resolve(safeName);
            StreamResult result = new StreamResult(Files.newOutputStream(file));
            result.setSystemId(file.toUri().toString());
            return result;
        }
    }
}
```

Hal penting:

1. `SchemaOutputResolver` mengontrol output destination.
2. `systemId` penting agar imports/includes bisa resolve dengan benar.
3. Output file name bisa provider-dependent jika tidak distandarkan.
4. Untuk multi-namespace, akan ada lebih dari satu schema output.
5. Schema generation harus dijalankan sebagai proses build yang repeatable.

Jangan generate schema manual dari IDE lalu copy-paste ke repo tanpa proses reproducible. Itu membuat schema artifact tidak dapat diaudit.

---

## 11. Menghasilkan XSD dengan `schemagen`

Secara konsep, `schemagen` membaca Java sources/classes yang diberi JAXB annotations lalu menghasilkan XSD.

Contoh gaya command-line lama:

```bash
schemagen src/main/java/com/acme/customer/contract/xml/v1/*.java
```

Pada Java modern, `schemagen` tidak lagi otomatis tersedia dari JDK seperti era lama. Gunakan tooling dari JAXB RI/plugin build yang kompatibel dengan versi API/runtime.

Prinsip yang lebih penting daripada command persis:

```text
Schema generation must be version-pinned, repeatable, and CI-executed.
```

Contoh lifecycle build yang sehat:

```text
compile contract classes
  ↓
generate XSD into target/generated-schemas
  ↓
normalize generated schema output if needed
  ↓
compare against committed canonical schema
  ↓
fail build if unexpected drift exists
```

Kalau schema generation hanya dilakukan saat developer ingat, maka contract governance sudah kalah.

---

## 12. Build Strategy: Generated Schema Sebagai Artifact

Ada dua pilihan besar:

### Opsi A — Generated XSD Tidak Di-Commit

```text
Java contract source
  ↓ build
Generated XSD in target/
```

Kelebihan:

- Tidak ada duplikasi source of truth.
- Tidak ada konflik manual update XSD.
- Cocok untuk internal contract.

Kekurangan:

- Sulit melihat schema diff di pull request.
- Consumer mungkin tidak punya artifact stabil.
- Contract drift bisa tidak terlihat kecuali ada CI diff.

### Opsi B — Generated XSD Di-Commit Sebagai Canonical Artifact

```text
Java contract source
  ↓ build generate
Generated XSD
  ↓ compare with src/main/resources/schema/customer-v1.xsd
Committed canonical schema
```

Kelebihan:

- Schema diff terlihat di PR.
- Consumer artifact jelas.
- Bisa dipublish ke artifact repository.
- Governance lebih kuat.

Kekurangan:

- Ada dua artifact yang harus sinkron.
- Perlu CI gate agar tidak stale.
- Perlu normalisasi output jika provider menghasilkan format tidak deterministic.

Untuk external contract, opsi B biasanya lebih aman.

---

## 13. CI Gate untuk Contract Drift

Minimal CI gate:

```text
1. Generate schema from current Java classes.
2. Compare generated schema with committed schema.
3. If different, fail build.
4. Developer must explicitly update schema and provide compatibility note.
```

Pseudo-script:

```bash
#!/usr/bin/env bash
set -euo pipefail

mvn -q -DskipTests generate-sources

EXPECTED="src/main/resources/schemas/customer-v1.xsd"
GENERATED="target/generated-schemas/customer-v1/schema1.xsd"

xmllint --format "$GENERATED" > target/generated-schemas/customer-v1.normalized.xsd
xmllint --format "$EXPECTED" > target/expected-customer-v1.normalized.xsd

diff -u target/expected-customer-v1.normalized.xsd \
        target/generated-schemas/customer-v1.normalized.xsd
```

Tetapi `diff` biasa tidak cukup untuk semua kasus karena XML schema bisa berbeda secara textual tetapi setara secara semantik. Untuk tahap awal, textual diff tetap berguna karena menangkap drift tidak sengaja. Untuk organisasi matang, tambahkan schema compatibility checker atau regression tests berbasis sample XML.

---

## 14. Annotation Minimum untuk Code-First yang Stabil

Jangan mengandalkan default terlalu banyak.

Minimal annotation set:

```java
@XmlRootElement(name = "customer")
@XmlAccessorType(XmlAccessType.FIELD)
@XmlType(
    name = "CustomerType",
    propOrder = {
        "id",
        "name",
        "email",
        "status"
    }
)
public class CustomerXml {

    @XmlElement(name = "id", required = true)
    private String id;

    @XmlElement(name = "name", required = true)
    private String name;

    @XmlElement(name = "email", required = false)
    private String email;

    @XmlElement(name = "status", required = true)
    private CustomerStatusXml status;
}
```

Kenapa?

| Annotation | Fungsi governance |
|---|---|
| `@XmlRootElement(name=...)` | Mengunci root element name |
| `@XmlAccessorType(...)` | Menghindari perubahan akibat getter/field detection default |
| `@XmlType(name=..., propOrder=...)` | Mengunci complex type name dan element order |
| `@XmlElement(name=..., required=...)` | Mengunci element name dan cardinality dasar |
| `@XmlAttribute(name=...)` | Mengunci attribute name |
| `@XmlSchema` di package | Mengunci namespace package |
| `@XmlEnumValue` | Mengunci lexical enum value |

Default mapping bagus untuk demo. Explicit mapping bagus untuk kontrak.

---

## 15. `required=true` Bukan Runtime Validation Lengkap

Kesalahan umum:

```java
@XmlElement(required = true)
private String id;
```

Developer mengira ini otomatis berarti:

- field tidak boleh null saat marshal,
- XML invalid otomatis ditolak saat unmarshal,
- business rule sudah aman.

Tidak sesederhana itu.

`required=true` memengaruhi schema generation, misalnya `minOccurs` tidak menjadi `0`. Tetapi runtime behavior perlu dipahami:

1. Marshalling object dengan null field bisa menghasilkan XML yang tidak valid terhadap schema.
2. JAXB runtime tidak selalu melakukan schema validation kecuali schema dipasang ke `Marshaller`/`Unmarshaller`.
3. Business invariant tetap harus divalidasi oleh application layer.

Contoh validasi saat marshal:

```java
SchemaFactory schemaFactory = SchemaFactory.newInstance(XMLConstants.W3C_XML_SCHEMA_NS_URI);
Schema schema = schemaFactory.newSchema(Path.of("customer-v1.xsd").toFile());

Marshaller marshaller = jaxbContext.createMarshaller();
marshaller.setSchema(schema);
marshaller.marshal(customerXml, outputStream);
```

Contoh validasi saat unmarshal:

```java
Unmarshaller unmarshaller = jaxbContext.createUnmarshaller();
unmarshaller.setSchema(schema);
CustomerXml customer = (CustomerXml) unmarshaller.unmarshal(inputStream);
```

Rule:

```text
Annotations describe mapping.
Schema validation enforces XML shape.
Business validation enforces business truth.
```

Jangan campur tiga layer ini.

---

## 16. Optionality: Absent, Empty, Nil, dan Null

Dalam XML, “tidak ada nilai” punya beberapa bentuk:

```xml
<!-- absent -->
<customer>
  <id>C-001</id>
</customer>
```

```xml
<!-- empty string or empty element depending type -->
<customer>
  <id>C-001</id>
  <email/>
</customer>
```

```xml
<!-- explicit nil -->
<customer xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <id>C-001</id>
  <email xsi:nil="true"/>
</customer>
```

JAXB annotation bisa memengaruhi schema:

```java
@XmlElement(name = "email", required = false, nillable = true)
private String email;
```

Tetapi desain kontrak harus menjawab:

1. Apakah field boleh tidak ada?
2. Apakah field boleh ada tapi kosong?
3. Apakah field boleh explicit nil?
4. Apakah nil berbeda secara bisnis dari absent?
5. Apakah consumer lama bisa menerima `xsi:nil`?

Top-level rule:

```text
Do not use nillable unless the contract truly needs explicit null semantics.
```

Untuk banyak integrasi enterprise, `xsi:nil` justru memperumit interoperability.

---

## 17. Field Order: XML Sequence Bukan Detail Kosmetik

XSD `xs:sequence` berarti urutan element penting.

```xml
<xs:sequence>
  <xs:element name="id"/>
  <xs:element name="name"/>
  <xs:element name="email" minOccurs="0"/>
</xs:sequence>
```

Valid:

```xml
<customer>
  <id>C-001</id>
  <name>Alice</name>
  <email>a@example.com</email>
</customer>
```

Tidak valid terhadap sequence di atas:

```xml
<customer>
  <name>Alice</name>
  <id>C-001</id>
  <email>a@example.com</email>
</customer>
```

Karena itu, code-first class harus eksplisit:

```java
@XmlType(propOrder = {"id", "name", "email"})
```

Tanpa `propOrder`, output order dapat dipengaruhi provider/reflection/annotation behavior. Jangan jadikan reflection order sebagai kontrak.

---

## 18. Enum Lexical Value Harus Stabil

Contoh buruk:

```java
public enum CustomerStatusXml {
    ACTIVE,
    SUSPENDED,
    CLOSED
}
```

Kelihatannya aman, tetapi enum constant name menjadi lexical XML value. Kalau developer rename:

```java
SUSPENDED_TEMPORARILY
```

XML berubah.

Lebih aman:

```java
import jakarta.xml.bind.annotation.XmlEnum;
import jakarta.xml.bind.annotation.XmlEnumValue;
import jakarta.xml.bind.annotation.XmlType;

@XmlType(name = "CustomerStatusType")
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

Dengan begitu Java enum name masih bisa refactor terbatas, sedangkan lexical contract tetap eksplisit.

Catatan evolusi enum:

- Menambah enum value bisa breaking bagi consumer yang memakai generated enum strict.
- Menghapus enum value hampir selalu breaking.
- Rename lexical value adalah breaking.
- Mengubah case adalah breaking.

Untuk external XML, enum bukan sekadar string. Enum adalah closed set yang sering di-codegen di consumer.

---

## 19. Tipe Java vs Tipe XSD: Jangan Terlalu General

Jika semua field dibuat `String`, schema yang dihasilkan miskin semantik:

```xml
<xs:element name="amount" type="xs:string"/>
<xs:element name="createdDate" type="xs:string"/>
<xs:element name="active" type="xs:string"/>
```

Lebih baik:

```java
@XmlElement(name = "amount", required = true)
private BigDecimal amount;

@XmlElement(name = "createdDate", required = true)
@XmlSchemaType(name = "date")
private XMLGregorianCalendar createdDate;

@XmlElement(name = "active", required = true)
private boolean active;
```

Akan lebih mendekati:

```xml
<xs:element name="amount" type="xs:decimal"/>
<xs:element name="createdDate" type="xs:date"/>
<xs:element name="active" type="xs:boolean"/>
```

Namun jangan terlalu percaya default mapping. Untuk date/time, timezone, decimal precision, dan lexical form, desain contract harus eksplisit.

---

## 20. Date/Time: `XMLGregorianCalendar` vs Java Time

JAXB legacy sangat erat dengan `XMLGregorianCalendar`:

```java
@XmlElement(name = "submittedAt", required = true)
@XmlSchemaType(name = "dateTime")
private XMLGregorianCalendar submittedAt;
```

Di domain modern Java, kita lebih suka:

```java
private OffsetDateTime submittedAt;
```

Masalahnya, XML Binding support terhadap Java Time types tidak selalu sesederhana yang kita inginkan, terutama untuk compatibility lintas versi/provider. Solusi paling stabil adalah memakai adapter.

Contoh:

```java
public final class OffsetDateTimeXmlAdapter
        extends XmlAdapter<String, OffsetDateTime> {

    @Override
    public OffsetDateTime unmarshal(String value) {
        if (value == null) {
            return null;
        }
        return OffsetDateTime.parse(value);
    }

    @Override
    public String marshal(OffsetDateTime value) {
        if (value == null) {
            return null;
        }
        return value.toString();
    }
}
```

Pemakaian:

```java
@XmlElement(name = "submittedAt", required = true)
@XmlJavaTypeAdapter(OffsetDateTimeXmlAdapter.class)
private OffsetDateTime submittedAt;
```

Tetapi perhatikan: jika adapter menghasilkan string, schema generation mungkin tidak tahu bahwa semantik yang diinginkan adalah `xs:dateTime`, kecuali mapping disesuaikan. Pada external contract, ini alasan kuat kenapa schema-first sering lebih baik untuk tipe XML yang presisi.

---

## 21. Constraint XSD yang Sulit Diekspresikan dari Java

Code-first terbatas. Banyak fitur XSD tidak natural direpresentasikan melalui annotation Java.

Contoh constraint XSD:

```xml
<xs:simpleType name="PostalCodeType">
  <xs:restriction base="xs:string">
    <xs:pattern value="[0-9]{6}"/>
  </xs:restriction>
</xs:simpleType>
```

Di Java code-first, kita mungkin punya:

```java
@XmlElement(name = "postalCode", required = true)
private String postalCode;
```

Schema hasil generation bisa hanya `xs:string`, kehilangan pattern.

Constraint yang sering sulit/kurang natural di code-first:

1. `xs:pattern`
2. `xs:minLength` / `xs:maxLength`
3. `xs:totalDigits` / `xs:fractionDigits`
4. `xs:minInclusive` / `xs:maxInclusive`
5. `xs:choice` kompleks
6. `xs:all`
7. substitution groups
8. identity constraints (`xs:key`, `xs:keyref`, `xs:unique`)
9. complex derivation by extension/restriction
10. namespace import/include modularity yang rapi
11. fixed/default values yang harus interoperable
12. appinfo/documentation annotations untuk human contract

Bean Validation annotation seperti `@Size`, `@Pattern`, `@NotNull` tidak otomatis berarti akan menjadi XSD facet secara portable. Jangan mengasumsikan Jakarta Validation annotation menjadi XSD constraint kecuali tooling spesifik mendukung dan diuji.

Rule:

```text
If schema constraints matter, schema-first is usually the safer source of truth.
```

---

## 22. Code-First dengan `@XmlType`: Naming Complex Type

Tanpa type name eksplisit, provider bisa menghasilkan nama dari class:

```java
public class CustomerXml { ... }
```

Menjadi:

```xml
<xs:complexType name="customerXml">
```

Atau variasi naming lain.

Lebih baik:

```java
@XmlType(name = "CustomerType", propOrder = {"id", "name"})
public class CustomerXml { ... }
```

Kenapa `CustomerType` lebih baik daripada `CustomerXml`?

Karena XSD contract sebaiknya tidak membawa suffix implementasi Java. Consumer non-Java tidak peduli bahwa class kita bernama DTO, Xml, Payload, atau ResponseModel.

Naming rule:

```text
XSD names should reflect business contract, not Java implementation naming.
```

---

## 23. Root Element vs Complex Type

Dalam XML schema, element dan type berbeda.

```xml
<xs:element name="customer" type="tns:CustomerType"/>

<xs:complexType name="CustomerType">
  ...
</xs:complexType>
```

Di JAXB:

```java
@XmlRootElement(name = "customer")
@XmlType(name = "CustomerType")
public class CustomerXml { ... }
```

`@XmlRootElement` mengontrol global element/root element.
`@XmlType` mengontrol type.

Jangan campur dua konsep ini.

Kapan butuh `JAXBElement`?

Jika class punya type tetapi tidak punya root element, atau kita perlu element name yang berbeda untuk type sama, `JAXBElement<T>` sering muncul. Pada schema-first ini biasa karena XJC menghasilkan `ObjectFactory`. Pada code-first, kebanyakan DTO root sederhana bisa memakai `@XmlRootElement`, tetapi untuk reusable type dan multiple root element, pahami perbedaan element vs type.

---

## 24. Wrapper Element untuk Collection

Contoh tanpa wrapper:

```java
@XmlElement(name = "order")
private List<OrderXml> orders;
```

XML:

```xml
<customer>
  <order>...</order>
  <order>...</order>
</customer>
```

Dengan wrapper:

```java
@XmlElementWrapper(name = "orders")
@XmlElement(name = "order")
private List<OrderXml> orders;
```

XML:

```xml
<customer>
  <orders>
    <order>...</order>
    <order>...</order>
  </orders>
</customer>
```

Contract decision:

| Pilihan | Implikasi |
|---|---|
| Tanpa wrapper | Lebih ringkas, tetapi collection boundary kurang eksplisit |
| Dengan wrapper | Lebih jelas dan extensible, tetapi tambah nesting |

Untuk external contract, wrapper sering lebih evolvable karena bisa menambahkan metadata di sekitar collection:

```xml
<orders totalCount="2">
  <order>...</order>
  <order>...</order>
</orders>
```

Namun jangan ubah dari tanpa wrapper ke dengan wrapper pada versi yang sama. Itu breaking.

---

## 25. Attribute vs Element dalam Code-First

Contoh attribute:

```java
@XmlAttribute(name = "currency", required = true)
private String currency;

@XmlValue
private BigDecimal value;
```

XML:

```xml
<amount currency="SGD">100.00</amount>
```

Contoh element:

```xml
<amount>
  <value>100.00</value>
  <currency>SGD</currency>
</amount>
```

Attribute cocok untuk metadata kecil yang melekat pada value. Element cocok untuk data yang mungkin kompleks, repeatable, nullable, atau butuh struktur.

Rule praktis:

```text
Use attributes for compact metadata.
Use elements for business data that may evolve.
```

Dalam code-first, jangan sekadar memilih attribute karena terlihat ringkas. XML attributes punya keterbatasan: tidak bisa berisi struktur nested, tidak repeatable dengan nama sama, dan punya treatment berbeda dalam namespace/defaulting.

---

## 26. Inheritance dan Polymorphism: Jangan Dibuka Tanpa Alasan

Java inheritance mudah:

```java
public abstract class PartyXml { ... }

public class PersonXml extends PartyXml { ... }

public class CompanyXml extends PartyXml { ... }
```

XML schema inheritance/polymorphism bisa menghasilkan `xsi:type` atau type extension. Ini sering menyulitkan consumer.

Contoh XML dengan `xsi:type`:

```xml
<party xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="PersonType">
  ...
</party>
```

Risiko:

1. Consumer harus support `xsi:type`.
2. Validation lebih kompleks.
3. Security review lebih sulit.
4. Compatibility lebih rapuh.
5. XML Signature canonicalization bisa makin sensitif.
6. Schema generation bisa kurang sesuai desain contract.

Alternatif lebih eksplisit:

```xml
<party>
  <partyType>PERSON</partyType>
  <person>...</person>
</party>
```

Atau schema-first dengan `xs:choice`:

```xml
<xs:choice>
  <xs:element name="person" type="tns:PersonType"/>
  <xs:element name="company" type="tns:CompanyType"/>
</xs:choice>
```

Untuk code-first, hindari polymorphism kecuali benar-benar dibutuhkan dan diuji lintas consumer.

---

## 27. Records, Lombok, dan Modern Java

Target seri ini Java 8–25. Berarti kita harus bicara modern Java juga.

### Java Records

Record menarik untuk DTO:

```java
public record CustomerXml(String id, String name) {}
```

Tetapi JAXB/Jakarta XML Binding tradisional mengharapkan no-arg constructor dan mutable property/field access. Support record bergantung provider/versi dan tidak selalu portable untuk enterprise legacy.

Untuk kontrak XML jangka panjang, class biasa sering lebih aman:

```java
@XmlAccessorType(XmlAccessType.FIELD)
public class CustomerXml {
    private String id;
    private String name;

    public CustomerXml() {
    }

    public CustomerXml(String id, String name) {
        this.id = id;
        this.name = name;
    }
}
```

### Lombok

Lombok bisa mengurangi boilerplate:

```java
@Getter
@Setter
@NoArgsConstructor
@XmlAccessorType(XmlAccessType.FIELD)
public class CustomerXml { ... }
```

Tetapi untuk contract class, hati-hati:

1. Generated methods bisa memengaruhi property access jika memakai `PUBLIC_MEMBER`.
2. Builder-only class sering tidak cocok dengan JAXB default.
3. Refactor Lombok annotation bisa mengubah runtime behavior.
4. CI/generated schema harus membuktikan tidak ada drift.

Rule:

```text
For JAXB contract classes, boring explicit Java often beats clever modern Java.
```

---

## 28. `javax.xml.bind` vs `jakarta.xml.bind`

Ini penting untuk Java 8–25.

| Era | Package | Umum dipakai di |
|---|---|---|
| JAXB 2.x / Java EE | `javax.xml.bind.*` | Java 8, Java EE 7/8, legacy app server |
| Jakarta XML Binding 3.x/4.x | `jakarta.xml.bind.*` | Jakarta EE 9+, modern Jakarta stack |

Contoh legacy:

```java
import javax.xml.bind.annotation.XmlRootElement;
```

Contoh modern:

```java
import jakarta.xml.bind.annotation.XmlRootElement;
```

Jangan campur `javax` dan `jakarta` dalam satu contract module kecuali sedang membuat migration bridge yang sangat sadar risiko.

Masalah umum saat migrasi:

1. Annotation package berubah.
2. Runtime provider berbeda versi.
3. App server menyediakan API sendiri.
4. Library lama masih memakai `javax`.
5. Generated source dari tool lama memakai `javax`.
6. SOAP stack lama memakai JAX-WS `javax`.
7. Build plugin menghasilkan source package yang tidak cocok.

Strategi:

```text
Legacy branch: javax JAXB 2.x.
Modern branch: jakarta JAXB 3/4.
Do not half-migrate boundary contracts.
```

Jika sistem masih memakai JAX-WS legacy `javax`, memaksa JAXB `jakarta` di modul yang sama bisa menjadi konflik besar.

---

## 29. Java 8 sampai 25: Compatibility Matrix

| Target Runtime | JAXB availability | Rekomendasi |
|---|---|---|
| Java 8 | JAXB API ada di JDK lama, tetapi dependency eksplisit tetap disarankan | Gunakan JAXB 2.3.x untuk legacy `javax`; siapkan migration path |
| Java 9/10 | Modul Java EE deprecated for removal | Jangan bergantung pada module JDK lama |
| Java 11+ | `java.xml.bind` dihapus dari JDK | Tambahkan JAXB API/runtime/tooling eksplisit |
| Java 17 LTS | Modern baseline enterprise umum | Pilih `javax` atau `jakarta` berdasarkan platform, jangan campur |
| Java 21 LTS | Modern production baseline | Jakarta 4.x jika stack sudah Jakarta EE 10+; validasi provider compatibility |
| Java 25 | Modern JDK; JAXB tetap external dependency | Treat JAXB as library/tooling, not JDK feature |

Point utama:

```text
From Java 11 onward, JAXB is no longer a JDK-provided convenience.
It is an explicit integration dependency.
```

---

## 30. Code-First untuk SOAP: Risiko Tambahan

Part mendatang akan membahas JAX-WS/SOAP lebih detail, tetapi code-first XML punya konsekuensi besar saat masuk SOAP.

Dalam SOAP, XML schema biasanya tertanam atau direferensikan oleh WSDL:

```text
WSDL
  ├─ types: XSD schema
  ├─ message
  ├─ portType
  ├─ binding
  └─ service
```

Jika service dibuat code-first dari Java endpoint, WSDL/XSD bisa berubah akibat:

1. Rename method.
2. Rename parameter.
3. Rename DTO property.
4. Change Java package namespace mapping.
5. Change annotation defaults.
6. Upgrade JAX-WS/JAXB provider.
7. Change build plugin.

Bagi SOAP consumer, WSDL drift adalah breaking risk.

Untuk public/partner SOAP service, contract-first WSDL biasanya lebih defensible.

Jika tetap code-first SOAP:

1. Commit WSDL/XSD canonical.
2. Diff generated WSDL di CI.
3. Jalankan consumer stub generation test.
4. Jalankan sample request/response validation.
5. Jangan expose domain/service internal langsung.
6. Version namespace dan endpoint.

---

## 31. Compatibility: Apa yang Breaking dan Non-Breaking?

Dalam XML contract, perubahan harus dinilai dari perspektif consumer.

### Biasanya Non-Breaking

| Perubahan | Catatan |
|---|---|
| Menambah optional element di akhir sequence | Consumer strict lama bisa tetap bermasalah jika tidak ignore unknown |
| Menambah optional attribute | Biasanya aman |
| Menambah documentation/appinfo | Aman secara runtime |
| Menambah new namespace/schema terpisah | Aman jika tidak mengubah existing contract |
| Melonggarkan constraint | Bisa aman, tapi business impact perlu dicek |

### Biasanya Breaking

| Perubahan | Kenapa breaking |
|---|---|
| Rename element/attribute | Consumer tidak menemukan field |
| Rename namespace URI | QName berubah total |
| Ubah required → optional | Bisa breaking secara business expectation |
| Ubah optional → required | Consumer lama tidak mengirim field |
| Ubah type `string` → `int` | Lexical/value compatibility berubah |
| Ubah order dalam `xs:sequence` | XML lama bisa invalid |
| Hapus element/attribute | Consumer kehilangan field |
| Hapus enum value | Consumer value lama invalid |
| Rename enum lexical value | Consumer generated enum rusak |
| Ubah wrapper collection | Shape XML berubah |
| Ubah nillable semantics | Null handling berubah |

Catatan: “menambah optional element” sering disebut non-breaking, tetapi pada consumer yang memakai strict schema validation dengan schema lama, unknown element bisa tetap ditolak. Jadi compatibility bukan hanya property schema; compatibility juga bergantung consumer behavior.

---

## 32. Sample-Based Compatibility Testing

Schema diff tidak cukup. Tambahkan sample XML.

Struktur test:

```text
src/test/resources/xml-contract/customer/v1/
  valid/
    minimal-customer.xml
    full-customer.xml
    customer-with-orders.xml
  invalid/
    missing-id.xml
    wrong-order.xml
    invalid-status.xml
  backward/
    legacy-v1-sample-from-partner.xml
```

Test unmarshal:

```java
@Test
void shouldUnmarshalLegacyPartnerSample() throws Exception {
    JAXBContext context = JAXBContext.newInstance(CustomerXml.class);
    Unmarshaller unmarshaller = context.createUnmarshaller();
    unmarshaller.setSchema(customerSchema());

    CustomerXml customer = (CustomerXml) unmarshaller.unmarshal(
        getClass().getResourceAsStream("/xml-contract/customer/v1/backward/legacy-v1-sample-from-partner.xml")
    );

    assertThat(customer.getId()).isEqualTo("C-001");
}
```

Test marshal and validate:

```java
@Test
void shouldMarshalValidCustomerXml() throws Exception {
    CustomerXml customer = new CustomerXml();
    customer.setId("C-001");
    customer.setName("Alice Tan");

    JAXBContext context = JAXBContext.newInstance(CustomerXml.class);
    Marshaller marshaller = context.createMarshaller();
    marshaller.setSchema(customerSchema());

    StringWriter writer = new StringWriter();
    marshaller.marshal(customer, writer);

    assertThat(writer.toString()).contains("customer");
}
```

Lebih kuat lagi: compare canonical XML output jika format output menjadi bagian kontrak.

---

## 33. Golden Master XML Test

Golden master test menyimpan expected XML output.

```text
src/test/resources/golden/customer-v1-full.xml
```

Test:

```java
@Test
void shouldKeepCustomerXmlShapeStable() throws Exception {
    CustomerXml customer = sampleFullCustomer();

    String actual = marshalToCanonicalXml(customer);
    String expected = readResource("/golden/customer-v1-full.xml");

    assertXmlEquivalent(expected, actual);
}
```

Jangan sekadar string compare mentah jika whitespace/prefix tidak penting. Gunakan XMLUnit atau canonicalization jika perlu.

Namun hati-hati: kadang prefix dan formatting menjadi penting untuk partner legacy yang buggy. Secara XML proper, prefix tidak semantik selama namespace URI sama. Secara real-world integration, beberapa sistem lama salah memperlakukan prefix sebagai string literal. Untuk kasus seperti itu, dokumentasikan sebagai compatibility quirk.

---

## 34. Consumer Stub Generation Test

Untuk external contract, cara kuat untuk menguji schema adalah mencoba generate consumer model.

Contoh pipeline:

```text
Generated/committed XSD
  ↓
Run xjc into temporary test module
  ↓
Compile generated consumer classes
  ↓
Unmarshal sample XML
```

Tujuannya bukan memakai generated class tersebut di aplikasi utama, tetapi membuktikan bahwa schema tetap consumable oleh tooling standar.

Untuk SOAP/WSDL nanti:

```text
Generated/committed WSDL
  ↓
Run wsimport/wsdl2java equivalent
  ↓
Compile generated client
  ↓
Run sample request/response tests
```

Ini menangkap breaking changes yang tidak terlihat dari unit test internal.

---

## 35. XML Schema Validation Test Utility

Utility kecil:

```java
public final class XmlValidationSupport {

    private XmlValidationSupport() {
    }

    public static Schema loadSchema(String resourcePath) {
        try {
            SchemaFactory factory = SchemaFactory.newInstance(XMLConstants.W3C_XML_SCHEMA_NS_URI);
            factory.setProperty(XMLConstants.ACCESS_EXTERNAL_DTD, "");
            factory.setProperty(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");

            URL schemaUrl = XmlValidationSupport.class.getResource(resourcePath);
            if (schemaUrl == null) {
                throw new IllegalArgumentException("Schema not found: " + resourcePath);
            }
            return factory.newSchema(schemaUrl);
        } catch (SAXException e) {
            throw new IllegalStateException("Failed to load schema: " + resourcePath, e);
        }
    }

    public static void validateXml(Schema schema, Source source) {
        try {
            Validator validator = schema.newValidator();
            validator.setProperty(XMLConstants.ACCESS_EXTERNAL_DTD, "");
            validator.setProperty(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
            validator.validate(source);
        } catch (SAXException | IOException e) {
            throw new AssertionError("XML validation failed", e);
        }
    }
}
```

Dengan secure properties, test juga menghindari external entity/schema access tidak sengaja.

---

## 36. Security Reminder untuk Code-First

Walaupun part XML security sudah dibahas di Part 15, code-first membawa risiko sendiri:

1. Class internal bisa mengekspos field sensitif.
2. Field baru bisa otomatis masuk XML jika access type terlalu permisif.
3. Getter public bisa ikut terbaca jika `PUBLIC_MEMBER`.
4. Domain object graph bisa terlalu dalam.
5. Circular references bisa menyebabkan failure.
6. XML schema generation bisa menghasilkan contract terlalu longgar.
7. Validation tidak otomatis aktif.
8. Legacy XML parser settings tetap harus hardened.

Karena itu untuk boundary class gunakan:

```java
@XmlAccessorType(XmlAccessType.FIELD)
```

Lalu tandai explicit field:

```java
@XmlTransient
private String internalSecret;
```

Lebih baik lagi: jangan letakkan `internalSecret` pada XML DTO sama sekali.

---

## 37. `@XmlTransient`: Bukan Pengganti Boundary Design

Contoh:

```java
@XmlTransient
private String passwordHash;
```

Ini mencegah field masuk binding, tetapi bukan desain terbaik jika class itu boundary DTO.

Kalau XML DTO punya field rahasia, berarti DTO tersebut terlalu dekat dengan domain/internal model.

Rule:

```text
If a field must never cross the boundary, it probably should not exist in the boundary DTO.
```

`@XmlTransient` berguna untuk:

1. Derived local property.
2. Back-reference untuk internal mapping.
3. Compatibility bridge saat refactor.
4. Avoiding accidental property exposure in inherited class.

Bukan untuk menambal entity yang dipaksa jadi API contract.

---

## 38. Backward-Compatible Evolution Pattern

Misal v1:

```java
@XmlType(propOrder = {"id", "name"})
public class CustomerXml {
    @XmlElement(name = "id", required = true)
    private String id;

    @XmlElement(name = "name", required = true)
    private String name;
}
```

Kita ingin menambah optional email.

Lebih aman:

```java
@XmlType(propOrder = {"id", "name", "email"})
public class CustomerXml {
    @XmlElement(name = "id", required = true)
    private String id;

    @XmlElement(name = "name", required = true)
    private String name;

    @XmlElement(name = "email", required = false)
    private String email;
}
```

Pertimbangan:

1. Tambahkan di akhir sequence.
2. Jadikan optional.
3. Jangan ubah namespace.
4. Jangan ubah existing element names.
5. Test sample v1 lama tetap bisa unmarshal.
6. Test output baru masih valid terhadap schema baru.
7. Komunikasikan bahwa consumer lama yang strict terhadap schema lama mungkin perlu update jika menerima payload baru.

---

## 39. Breaking Evolution Pattern: Buat v2 Namespace

Misal kita perlu memecah `name` menjadi `firstName` dan `lastName`.

Jangan ubah v1 diam-diam:

```xml
<!-- v1 -->
<customer xmlns="https://api.acme.example/customer/v1">
  <id>C-001</id>
  <name>Alice Tan</name>
</customer>
```

Buat v2:

```xml
<!-- v2 -->
<customer xmlns="https://api.acme.example/customer/v2">
  <id>C-001</id>
  <firstName>Alice</firstName>
  <lastName>Tan</lastName>
</customer>
```

Package:

```text
com.acme.customer.contract.xml.v1.CustomerXml
com.acme.customer.contract.xml.v2.CustomerXml
```

Mapper:

```java
public CustomerV1Xml toV1(Customer customer) { ... }
public CustomerV2Xml toV2(Customer customer) { ... }
```

Do not pretend v2 is v1.

---

## 40. Namespace Versioning: URI Stabilitas

Contoh:

```java
@XmlSchema(namespace = "https://api.acme.example/customer/v1")
```

Pertanyaan: apakah namespace harus URL yang bisa dibuka?

Secara XML namespace URI adalah identifier, bukan harus endpoint aktif. Tetapi dalam enterprise, lebih baik jika URI terdokumentasi dan stabil.

Jangan gunakan environment-specific namespace:

```text
https://dev.api.acme.example/customer
https://uat.api.acme.example/customer
```

Itu buruk karena contract berubah antar environment.

Gunakan:

```text
https://api.acme.example/schema/customer/v1
```

Atau URN:

```text
urn:acme:customer:v1
```

Yang penting: stabil, versioned, dan tidak berubah karena deployment topology.

---

## 41. Code-First dan Documentation

XSD yang baik sering punya dokumentasi:

```xml
<xs:annotation>
  <xs:documentation>
    Customer identifier assigned by ACME. Stable across customer lifecycle.
  </xs:documentation>
</xs:annotation>
```

Code-first JAXB annotation standar tidak selalu nyaman untuk menghasilkan dokumentasi XSD yang kaya. Ini salah satu kelemahan code-first untuk public contract.

Solusi:

1. Maintain human contract documentation terpisah.
2. Commit XSD lalu enrich manual dengan documentation, tetapi CI harus hati-hati.
3. Gunakan schema-first jika XSD documentation adalah artifact utama.
4. Gunakan OpenAPI/AsyncAPI-like documentation untuk JSON; untuk XML/SOAP gunakan WSDL/XSD documentation governance.

Untuk regulated integration, documentation bukan nice-to-have. Documentation adalah bagian dari contract defensibility.

---

## 42. Generated Schema Normalization

Output schema dari generator bisa tidak deterministic dalam aspek:

1. File name: `schema1.xsd`, `schema2.xsd`.
2. Namespace prefix.
3. Ordering type definitions.
4. Formatting.
5. Import location.
6. Provider-specific annotations.

Jika CI diff sering noisy, lakukan normalization.

Contoh minimal:

```bash
xmllint --format schema1.xsd > schema1.normalized.xsd
```

Untuk lebih matang:

1. Rename output file berdasarkan namespace.
2. Sort schema files by namespace.
3. Strip volatile comments.
4. Use canonical XML if appropriate.
5. Prefer semantic compatibility tests over raw diff for known noisy sections.

Tapi jangan menggunakan normalization untuk menyembunyikan breaking changes.

---

## 43. Build Reproducibility Checklist

Code-first workflow harus menjawab:

1. Versi JAXB API apa?
2. Versi JAXB runtime/provider apa?
3. Versi schemagen/plugin apa?
4. Apakah Java source level sama di CI dan local?
5. Apakah output schema deterministic?
6. Apakah schema committed?
7. Apakah schema diff digate?
8. Apakah sample XML diuji?
9. Apakah namespace/versioning stabil?
10. Apakah Java 8/11/17/21/25 compatibility diuji sesuai target?
11. Apakah `javax`/`jakarta` konsisten?
12. Apakah app server menyediakan versi JAXB berbeda?

Build yang tidak reproducible berarti contract yang tidak defensible.

---

## 44. Maven Module Design untuk Contract

Pisahkan contract module:

```text
customer-contract-xml-v1/
  src/main/java/com/acme/customer/contract/xml/v1/
  src/main/resources/schemas/customer-v1.xsd
  src/test/resources/xml-contract/customer/v1/
```

Application module:

```text
customer-service/
  depends on customer-contract-xml-v1
  contains domain/service/persistence
```

Keuntungan:

1. Contract lifecycle lebih jelas.
2. Contract bisa dipublish sebagai artifact.
3. Consumer/internal adapter bisa depend tanpa membawa domain service.
4. CI contract tests bisa fokus.
5. Versioning lebih bersih.

Jangan campurkan contract DTO di module domain besar yang berubah terus.

---

## 45. Publishing Contract Artifact

Untuk enterprise, publish bukan hanya JAR.

Artifact yang ideal:

```text
customer-contract-xml-v1-1.2.0.jar
customer-v1.xsd
sample-valid-customer.xml
sample-invalid-customer.xml
contract-changelog.md
migration-guide.md
```

Changelog contoh:

```markdown
# Customer XML Contract v1 Changelog

## 1.2.0
- Added optional `email` element after `name`.
- Existing v1 minimal payload remains valid.
- Consumers using strict old schema may need schema refresh to accept new outbound payloads.

## 1.1.0
- Added optional `status` attribute to customer.

## 1.0.0
- Initial contract.
```

Contract artifact tanpa changelog membuat consumer menebak-nebak.

---

## 46. Semantic Versioning untuk XML Contract

Gunakan semantic versioning secara disiplin, tetapi jangan buta.

| Perubahan | Versi |
|---|---|
| Documentation only | patch |
| Optional additive field | minor |
| Constraint loosened | minor/major tergantung business |
| Constraint tightened | major |
| Required field added | major |
| Element renamed | major |
| Namespace changed | major |
| Type changed | major |
| Enum value added | minor/major tergantung consumer |

Untuk XML, “minor” tetap bisa menyulitkan consumer strict. Jadi semver harus disertai compatibility notes.

---

## 47. Code-First Workflow Recommended Pipeline

Pipeline yang direkomendasikan:

```text
1. Design boundary XML DTO, not domain entity.
2. Define package namespace in package-info.java.
3. Annotate root/type/field/order explicitly.
4. Generate schema via pinned JAXB tooling.
5. Normalize generated schema output.
6. Compare with committed canonical schema.
7. Validate golden sample XML against schema.
8. Marshal sample object and validate output.
9. Unmarshal legacy sample XML and validate object mapping.
10. Run compatibility checks and review schema diff.
11. Publish schema + samples + changelog.
```

Jangan skip step 6–10 kalau contract eksternal.

---

## 48. Worked Example: Customer Export Contract v1

### 48.1 Package Namespace

```java
@XmlSchema(
    namespace = "https://api.acme.example/schema/customer/v1",
    elementFormDefault = XmlNsForm.QUALIFIED,
    attributeFormDefault = XmlNsForm.UNQUALIFIED,
    xmlns = {
        @XmlNs(prefix = "cust", namespaceURI = "https://api.acme.example/schema/customer/v1")
    }
)
package com.acme.customer.contract.xml.v1;

import jakarta.xml.bind.annotation.XmlNs;
import jakarta.xml.bind.annotation.XmlNsForm;
import jakarta.xml.bind.annotation.XmlSchema;
```

### 48.2 Root DTO

```java
@XmlRootElement(name = "customer")
@XmlAccessorType(XmlAccessType.FIELD)
@XmlType(
    name = "CustomerType",
    propOrder = {
        "id",
        "name",
        "status",
        "registeredDate",
        "addresses"
    }
)
public class CustomerXml {

    @XmlElement(name = "id", required = true)
    private String id;

    @XmlElement(name = "name", required = true)
    private String name;

    @XmlElement(name = "status", required = true)
    private CustomerStatusXml status;

    @XmlElement(name = "registeredDate", required = true)
    @XmlSchemaType(name = "date")
    private XMLGregorianCalendar registeredDate;

    @XmlElementWrapper(name = "addresses")
    @XmlElement(name = "address")
    private List<AddressXml> addresses = new ArrayList<>();

    public CustomerXml() {
    }

    // getters and setters
}
```

### 48.3 Nested DTO

```java
@XmlAccessorType(XmlAccessType.FIELD)
@XmlType(
    name = "AddressType",
    propOrder = {
        "line1",
        "line2",
        "postalCode",
        "countryCode"
    }
)
public class AddressXml {

    @XmlElement(name = "line1", required = true)
    private String line1;

    @XmlElement(name = "line2", required = false)
    private String line2;

    @XmlElement(name = "postalCode", required = true)
    private String postalCode;

    @XmlElement(name = "countryCode", required = true)
    private String countryCode;

    public AddressXml() {
    }
}
```

### 48.4 Enum

```java
@XmlType(name = "CustomerStatusType")
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

### 48.5 Expected XML

```xml
<cust:customer xmlns:cust="https://api.acme.example/schema/customer/v1">
  <cust:id>C-001</cust:id>
  <cust:name>Alice Tan</cust:name>
  <cust:status>ACTIVE</cust:status>
  <cust:registeredDate>2026-06-17</cust:registeredDate>
  <cust:addresses>
    <cust:address>
      <cust:line1>1 Example Road</cust:line1>
      <cust:postalCode>123456</cust:postalCode>
      <cust:countryCode>SG</cust:countryCode>
    </cust:address>
  </cust:addresses>
</cust:customer>
```

### 48.6 Concern

`postalCode` dan `countryCode` masih hanya `xs:string` jika mengandalkan code-first default. Jika pattern/length penting, schema-first atau post-generation customization dibutuhkan.

---

## 49. Code-First with Post-Edited XSD: Hati-Hati

Kadang tim melakukan ini:

```text
Generate XSD from Java
  ↓
Edit XSD manually to add pattern/facet/documentation
  ↓
Publish edited XSD
```

Ini bisa berhasil, tetapi source of truth menjadi ambigu.

Pertanyaan:

1. Apakah Java class masih bisa menghasilkan XSD yang sama?
2. Apakah manual edits akan hilang saat regenerate?
3. Apakah tests memvalidasi terhadap edited XSD atau generated XSD?
4. Apakah developer tahu mana canonical?

Jika XSD perlu diedit manual secara signifikan, itu sinyal bahwa schema-first mungkin lebih tepat.

Rule:

```text
If you keep editing generated schema, the schema wants to be the source of truth.
```

---

## 50. Common Failure Cases

### 50.1 Getter Tidak Sengaja Masuk Contract

```java
public String getInternalDisplayLabel() {
    return id + " - " + name;
}
```

Jika access type default memungkinkan public getter, ini bisa masuk XML.

Mitigasi:

```java
@XmlAccessorType(XmlAccessType.FIELD)
```

### 50.2 Rename Field Mengubah XML

Mitigasi:

```java
@XmlElement(name = "stableExternalName")
private String internalRenamedField;
```

### 50.3 List Null vs Empty Tidak Konsisten

Null list bisa tidak muncul. Empty list dengan wrapper bisa muncul sebagai empty wrapper tergantung marshalling behavior.

Tentukan contract:

```text
No collection data = absent wrapper?
Empty collection = empty wrapper?
```

Lalu test.

### 50.4 Namespace Prefix Berbeda

Secara XML namespace prefix tidak semantik, tetapi sistem legacy kadang buggy.

Jika prefix harus stabil, gunakan provider-specific prefix mapper dengan hati-hati dan dokumentasikan. Jangan mengandalkan ini sebagai XML standard behavior.

### 50.5 Schema Generated Berubah Setelah Upgrade Provider

Mitigasi:

1. Pin provider version.
2. Run schema diff in CI.
3. Review generated schema after dependency upgrade.

---

## 51. Provider-Specific Features: Gunakan Secara Sadar

Eclipse JAXB RI punya fitur tambahan di luar standar. Ini berguna, tetapi bisa mengunci ke provider tertentu.

Rule:

```text
Portable contract first.
Provider-specific optimization second.
```

Gunakan provider-specific feature jika:

1. Ada kebutuhan nyata.
2. Terdokumentasi.
3. Diuji di runtime target.
4. Tidak mengunci consumer tanpa alasan.
5. Ada migration note.

Untuk contract publik, standar lebih penting daripada kenyamanan lokal.

---

## 52. Code-First dan JPMS

Pada Java 9+, module system bisa memengaruhi reflective access. JAXB membutuhkan akses ke class/field/property.

Contoh `module-info.java` untuk Jakarta:

```java
module com.acme.customer.contract.xml {
    requires jakarta.xml.bind;
    requires java.xml;

    exports com.acme.customer.contract.xml.v1;
    opens com.acme.customer.contract.xml.v1 to jakarta.xml.bind;
}
```

`exports` membuat package bisa digunakan compile-time oleh module lain.
`opens` memberi reflective access untuk JAXB runtime.

Tanpa `opens`, runtime bisa gagal mengakses field/constructor pada modular application.

Untuk non-modular classpath app, masalah ini tidak muncul dengan cara sama. Tetapi untuk Java 17/21/25 modularized app, ini penting.

---

## 53. Native Image / AOT Note

Jika aplikasi memakai GraalVM native image atau AOT environment, JAXB reflection perlu konfigurasi tambahan. Contract DTO, constructors, fields, annotations, dan runtime implementation perlu tersedia untuk reflection.

Prinsip:

1. Jangan asumsikan reflection bekerja otomatis.
2. Buat integration test native image jika target deployment native.
3. Prefer explicit DTO dan minimal graph.
4. Hindari dynamic context scanning yang terlalu luas.
5. Register classes explicitly jika perlu.

Ini bukan fokus utama seri, tetapi penting untuk Java modern.

---

## 54. Performance Consideration

Code-first tidak otomatis lebih cepat/lambat daripada schema-first. Runtime performance tergantung:

1. Ukuran object graph.
2. Cara `JAXBContext` dibuat.
3. Apakah context dicache.
4. Apakah marshaller/unmarshaller dibuat per request.
5. Apakah schema validation aktif.
6. Ukuran XML.
7. Adapter custom.
8. Encoding/output stream.

Rule dari Part 16 tetap berlaku:

```text
Cache JAXBContext.
Do not share Marshaller/Unmarshaller across threads unless documented safe by usage pattern.
Create per operation or pool carefully.
```

Schema generation sendiri biasanya build-time, bukan runtime path.

Jangan generate schema saat request production.

---

## 55. Observability untuk XML Contract

Untuk production integration, log bukan hanya “marshal failed”.

Log minimal:

1. Contract name/version.
2. Namespace.
3. Operation/export/import name.
4. Partner/system id.
5. Correlation id.
6. Validation stage: marshal/unmarshal/schema/business.
7. Error location jika tersedia.
8. Payload size.
9. Sanitized error summary.

Jangan log full XML jika berisi PII/secret.

Contoh structured log fields:

```json
{
  "event": "xml_contract_validation_failed",
  "contract": "customer-v1",
  "namespace": "https://api.acme.example/schema/customer/v1",
  "direction": "outbound",
  "partner": "partner-a",
  "stage": "schema-validation",
  "correlationId": "b7e2...",
  "error": "cvc-complex-type.2.4.a: Invalid content was found..."
}
```

---

## 56. Governance: Review Checklist untuk Pull Request

Saat PR mengubah JAXB contract class, reviewer harus bertanya:

1. Apakah XML element/attribute name berubah?
2. Apakah namespace berubah?
3. Apakah `propOrder` berubah?
4. Apakah optional/required berubah?
5. Apakah type XSD berubah?
6. Apakah enum lexical value berubah?
7. Apakah wrapper collection berubah?
8. Apakah sample XML diperbarui?
9. Apakah schema diff diperiksa?
10. Apakah backward sample masih valid?
11. Apakah changelog contract diperbarui?
12. Apakah consumer impact dijelaskan?
13. Apakah perubahan seharusnya v2?

Kalau jawaban “tidak tahu”, PR belum siap.

---

## 57. Decision Framework: Code-First Boleh atau Tidak?

Gunakan pertanyaan ini:

```text
1. Apakah consumer eksternal bergantung pada schema ini?
2. Apakah consumer bisa upgrade bersama kita?
3. Apakah schema perlu XSD constraints kaya?
4. Apakah XML akan menjadi archive/legal document?
5. Apakah WSDL/SOAP public akan memakai schema ini?
6. Apakah perubahan Java internal sering terjadi?
7. Apakah tim punya CI schema diff?
8. Apakah sample compatibility tests ada?
9. Apakah namespace/versioning sudah jelas?
10. Apakah generated schema akan dipublish?
```

Interpretasi:

- Banyak jawaban “ya” di 1–5 → prefer schema-first.
- Banyak jawaban “ya” di 6 dan “tidak” di 7–9 → code-first berbahaya.
- Consumer internal, controlled, low constraint → code-first cukup masuk akal.

---

## 58. Migration Scenario: Java 8 `javax` Code-First ke Java 21 `jakarta`

Misal legacy:

```java
import javax.xml.bind.annotation.XmlRootElement;
```

Modern:

```java
import jakarta.xml.bind.annotation.XmlRootElement;
```

Migration steps:

```text
1. Freeze current generated XSD as baseline.
2. Add schema diff test on legacy branch.
3. Migrate source imports javax → jakarta in isolated branch.
4. Upgrade JAXB API/runtime/tooling.
5. Regenerate schema.
6. Compare generated schema to baseline.
7. Run sample XML validation/unmarshal/marshal tests.
8. Check namespace and type names unchanged.
9. Check generated XML output for prefix/order/nillable differences.
10. Publish migration note if schema/output differs.
```

Goal migration:

```text
Runtime package migration should not accidentally become contract migration.
```

Jika XML contract berubah hanya karena package import berubah, governance gagal.

---

## 59. Code-First Contract Module Example Layout

```text
customer-contract-xml-v1/
  pom.xml
  src/main/java/
    com/acme/customer/contract/xml/v1/
      package-info.java
      CustomerXml.java
      AddressXml.java
      CustomerStatusXml.java
  src/main/resources/
    schemas/
      customer-v1.xsd
  src/test/java/
    com/acme/customer/contract/xml/v1/
      CustomerXmlSchemaGenerationTest.java
      CustomerXmlValidationTest.java
      CustomerXmlGoldenMasterTest.java
  src/test/resources/
    xml-contract/customer/v1/
      valid/minimal-customer.xml
      valid/full-customer.xml
      invalid/missing-id.xml
      backward/partner-sample-2024-01.xml
```

Test types:

| Test | Tujuan |
|---|---|
| Schema generation diff | Mencegah drift tidak sengaja |
| Valid sample validation | Memastikan sample contract benar |
| Invalid sample validation | Memastikan schema menolak payload buruk |
| Unmarshal backward sample | Menjamin consumer/provider compatibility lama |
| Marshal golden output | Menjaga shape output stabil |
| Mapper round-trip | Menjaga boundary mapping domain ↔ XML |

---

## 60. Mapper Testing: Domain Tidak Sama dengan Contract

Contoh:

```java
@Test
void shouldMapDomainCustomerToXmlContract() {
    Customer domain = CustomerMother.activeCustomer()
        .withInternalId(1001L)
        .withPublicReference("C-001")
        .withName("Alice Tan")
        .build();

    CustomerXml xml = mapper.toXml(domain);

    assertThat(xml.getId()).isEqualTo("C-001");
    assertThat(xml.getName()).isEqualTo("Alice Tan");
    assertThat(xml.getStatus()).isEqualTo(CustomerStatusXml.ACTIVE);
}
```

Mapper test menangkap kesalahan seperti:

1. Internal DB id bocor sebagai public id.
2. Status domain salah dikonversi.
3. Field optional tidak sesuai rule.
4. Default value salah.
5. Sensitive value masuk XML DTO.

JAXB test memastikan XML shape benar. Mapper test memastikan semantic mapping benar.

---

## 61. When Code-First Becomes a Trap

Code-first menjadi jebakan ketika tim berkata:

> “Kita generate saja XSD dari class, nanti consumer pakai itu.”

Tanda-tanda jebakan:

1. Tidak ada schema review.
2. Tidak ada sample XML.
3. Tidak ada versioned namespace.
4. Tidak ada compatibility test.
5. DTO sama dengan entity/domain.
6. Perubahan field dianggap refactor biasa.
7. XSD tidak dipublish sebagai artifact formal.
8. Consumer impact tidak pernah dibahas.
9. Tool/provider upgrade tidak dianggap contract event.
10. `javax`→`jakarta` migration dilakukan sambil mengubah DTO.

Jika ini terjadi, code-first bukan mempercepat delivery; code-first sedang membuat future incident.

---

## 62. Practical Rules of Thumb

1. Untuk partner/regulator/bank/government SOAP/XML: mulai dari schema-first.
2. Untuk internal XML export sederhana: code-first boleh.
3. Untuk XML archival/legal: schema-first lebih defensible.
4. Untuk generated schema yang sering diedit manual: pindah ke schema-first.
5. Untuk DTO yang berubah sering: jangan jadikan contract.
6. Untuk Java refactor: pastikan XML name tetap stabil.
7. Untuk optional field baru: tambah di akhir sequence.
8. Untuk breaking change: buat namespace/version baru.
9. Untuk Java 11+: dependency JAXB eksplisit.
10. Untuk Jakarta migration: bedakan runtime migration dari contract migration.

---

## 63. Deep Mental Model: Contract Has a Slower Clock Than Code

Application code berubah cepat:

```text
refactor → optimize → rename → split → merge → replace
```

External contract berubah lambat:

```text
announce → version → support overlap → migrate consumers → deprecate → retire
```

Code-first berbahaya ketika dua jam ini dicampur.

```text
Internal code clock: fast
External contract clock: slow
```

Top 1% engineer mendesain boundary supaya perubahan internal tidak otomatis mengguncang consumer eksternal.

---

## 64. Summary

Code-first JAXB adalah workflow yang berguna, tetapi harus dipakai secara disiplin.

Inti Part 19:

1. Code-first berarti Java class menjadi input untuk schema generation.
2. Ini cocok untuk internal/owned XML, bukan default terbaik untuk external contract.
3. Risiko utama adalah contract drift akibat refactor internal.
4. Boundary XML DTO harus dipisah dari domain/entity.
5. Annotation harus eksplisit: namespace, root, type, order, element name, optionality.
6. `required=true` bukan pengganti schema validation atau business validation.
7. Optional/empty/nil semantics harus dirancang, bukan dibiarkan default.
8. Enum lexical values harus dikunci dengan `@XmlEnumValue`.
9. Banyak XSD constraints sulit diekspresikan dari Java; schema-first lebih cocok jika constraint kaya penting.
10. Java 11+ membutuhkan JAXB dependency/tooling eksplisit karena JAXB tidak lagi disediakan JDK.
11. `javax` dan `jakarta` migration harus dijaga agar tidak mengubah contract tanpa sengaja.
12. CI harus melakukan schema generation diff, sample validation, golden master, dan compatibility tests.
13. Untuk breaking change, buat versi/namespace baru.
14. Contract memiliki lifecycle lebih lambat daripada code.

---

## 65. Latihan Praktis

### Latihan 1 — Buat Contract DTO

Buat `InvoiceXml` code-first dengan field:

- `invoiceNumber`
- `issuedDate`
- `customerId`
- `currency`
- `totalAmount`
- `items`

Kunci:

- namespace v1,
- root element name,
- type name,
- propOrder,
- enum untuk currency jika fixed,
- wrapper untuk items.

### Latihan 2 — Generate XSD

Gunakan `JAXBContext.generateSchema` dan tulis output ke `target/generated-schemas/invoice-v1`.

Pastikan output schema bisa dibaca dan committed sebagai baseline.

### Latihan 3 — Drift Test

Rename field Java internal:

```java
private String invoiceNumber;
```

menjadi:

```java
private String internalInvoiceNo;
```

Tetapi pertahankan XML element:

```java
@XmlElement(name = "invoiceNumber")
```

Generate schema lagi. Pastikan schema tidak berubah.

### Latihan 4 — Breaking Change Analysis

Ubah `totalAmount` dari `BigDecimal` ke `String`. Generate schema. Jelaskan:

1. Apa yang berubah di XSD?
2. Apakah breaking?
3. Apakah perlu v2?
4. Apakah ada consumer impact?

### Latihan 5 — Schema Validation

Buat valid XML dan invalid XML. Jalankan validation test dengan schema.

Invalid case:

- missing invoice number,
- wrong sequence order,
- invalid enum value,
- missing required total amount.

---

## 66. Checklist Produksi

Sebelum code-first XML contract dipakai production:

- [ ] Contract DTO terpisah dari domain/entity.
- [ ] Namespace dikunci di `package-info.java`.
- [ ] `@XmlAccessorType(XmlAccessType.FIELD)` digunakan secara sadar.
- [ ] Root element name eksplisit.
- [ ] Complex type name eksplisit.
- [ ] `propOrder` eksplisit.
- [ ] Element/attribute names eksplisit.
- [ ] Enum lexical values eksplisit.
- [ ] Optional/nillable semantics terdokumentasi.
- [ ] Collection wrapper diputuskan dan diuji.
- [ ] XSD generated secara repeatable di CI.
- [ ] Generated XSD dibandingkan dengan canonical schema.
- [ ] Valid/invalid sample XML tersedia.
- [ ] Backward compatibility sample diuji.
- [ ] Marshal output divalidasi terhadap schema.
- [ ] Unmarshal input divalidasi terhadap schema.
- [ ] Schema/changelog dipublish.
- [ ] Java 8/11/17/21/25 target compatibility jelas.
- [ ] `javax`/`jakarta` namespace konsisten.
- [ ] Dependency JAXB API/runtime/tooling dipin.
- [ ] Security parser/schema validation settings hardened.
- [ ] Observability error contract tersedia.

---

## 67. Penutup

Part 19 memperlihatkan bahwa code-first bukan sekadar “generate XSD dari class”. Yang penting adalah governance: apakah class itu memang layak menjadi sumber kontrak, apakah schema generation repeatable, apakah perubahan terdeteksi, dan apakah consumer dilindungi dari refactor internal.

Jika Part 18 mengajarkan bahwa schema-first menjadikan XSD sebagai sumber kebenaran, Part 19 mengajarkan bahwa code-first hanya aman jika Java contract class diperlakukan dengan disiplin yang hampir sama kuatnya seperti XSD.

Pada part berikutnya, kita masuk ke **JAXB Advanced Mapping**: adapters, polymorphism, inheritance, `JAXBElement`, `ObjectFactory`, nillable vs absent, lists, maps, wildcards, dan mixed content.

---

## Status Seri

Seri ini **belum selesai**.

- Part saat ini: **Part 19 dari 34**
- Berikutnya: **Part 20 — JAXB Advanced Mapping**

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-json-xml-soap-connectors-enterprise-integration-part-018.md">⬅️ Part 18 — JAXB Schema-First Workflow: XSD → Java with XJC, Binding Customization, Episode Files, and Generated-Code Hygiene</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-json-xml-soap-connectors-enterprise-integration-part-020.md">Part 20 — JAXB Advanced Mapping: Adapters, Polymorphism, `JAXBElement`, Wildcards, Mixed Content, and Contract-Safe XML Models ➡️</a>
</div>
