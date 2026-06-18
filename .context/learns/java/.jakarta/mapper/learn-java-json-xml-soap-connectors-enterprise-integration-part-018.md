# learn-java-json-xml-soap-connectors-enterprise-integration — Part 18
# JAXB Schema-First Workflow: XSD → Java with XJC, Binding Customization, Episode Files, and Generated-Code Hygiene

> Seri: `learn-java-json-xml-soap-connectors-enterprise-integration`  
> Part: `018` dari `034`  
> Topik: JAXB / Jakarta XML Binding schema-first workflow  
> Target Java: 8 sampai 25  
> Fokus: bagaimana memperlakukan XSD sebagai kontrak utama, lalu menghasilkan Java model yang stabil, dapat diuji, dapat dimigrasikan, dan aman untuk enterprise integration.

---

## 0. Posisi Part Ini Dalam Seri

Pada Part 16 kita membahas core JAXB/Jakarta XML Binding: `JAXBContext`, `Marshaller`, `Unmarshaller`, runtime lifecycle, dan implikasi Java 8 ke Java 11+. Pada Part 17 kita membahas annotation sebagai contract definition layer.

Part 18 membalik sudut pandangnya.

Di sini kita tidak mulai dari class Java lalu mencoba membuat XML. Kita mulai dari **XSD sebagai kontrak formal**, lalu menghasilkan Java class dari XSD menggunakan **XJC**.

Mental model utamanya:

```text
XSD contract
  ↓
XJC binding compiler
  ↓
Generated Java classes
  ↓
JAXBContext runtime
  ↓
Marshal / unmarshal XML instances
  ↓
Application boundary / domain translation
```

Schema-first sangat penting pada dunia enterprise karena banyak integrasi XML/SOAP bukan didesain oleh aplikasi kita sendiri. Biasanya schema diberikan oleh pihak eksternal: regulator, bank, payment network, government agency, clearing house, legacy EIS, insurance platform, ERP, customs system, document exchange hub, atau vendor lama.

Di situ Java model bukan sumber kebenaran. Java model hanya representasi lokal dari kontrak yang sudah ada.

---

## 1. Sumber Resmi dan Konteks Versi

Beberapa fakta dasar yang harus dipegang sebelum masuk ke workflow:

1. Jakarta XML Binding menyediakan API dan tools untuk mapping XML document ke Java object dan sebaliknya. Spesifikasi modernnya ada pada Jakarta XML Binding 4.0 untuk Jakarta EE 10, dengan namespace package `jakarta.xml.bind`.
2. Eclipse Implementation of JAXB / JAXB RI menyediakan implementasi dan tool seperti XJC untuk menghasilkan Java class dari schema XML.
3. Artifact `org.glassfish.jaxb:jaxb-xjc` adalah binding compiler XJC yang menghasilkan Java sources dari representasi XML/XSD.
4. Sejak Java 11, modul Java EE/CORBA seperti `java.xml.bind` sudah dihapus dari JDK melalui JEP 320. Artinya JAXB API/runtime/tooling tidak boleh diasumsikan tersedia dari JDK pada Java 11+.
5. Untuk Java 8 legacy, banyak proyek masih memakai `javax.xml.bind`. Untuk Jakarta EE 9+ / Jakarta XML Binding 3+ / 4+, package berubah ke `jakarta.xml.bind`.

Referensi resmi yang menjadi basis desain materi:

- Jakarta XML Binding specification: `https://jakarta.ee/specifications/xml-binding/`
- Jakarta XML Binding 4.0: `https://jakarta.ee/specifications/xml-binding/4.0/`
- Eclipse JAXB RI: `https://eclipse-ee4j.github.io/jaxb-ri/`
- XJC documentation: `https://eclipse-ee4j.github.io/jaxb-ri/4.0.3/docs/ch04.html`
- JEP 320: `https://openjdk.org/jeps/320`
- Jakarta XML Binding namespace/binding schema note: `https://jakarta.ee/xml/ns/jaxb`

---

## 2. Core Problem: Kenapa Schema-First Tidak Sama Dengan “Generate Class Dari XSD”

Banyak engineer menganggap schema-first workflow hanya seperti ini:

```bash
xjc schema.xsd
```

Lalu class Java muncul, selesai.

Itu terlalu dangkal.

Di production, schema-first workflow harus menjawab pertanyaan yang lebih dalam:

1. Siapa pemilik kontrak?
2. Apakah schema boleh dimodifikasi?
3. Apakah generated code boleh diedit?
4. Bagaimana jika nama type XSD buruk atau bentrok dengan Java keyword?
5. Bagaimana jika ada dua schema berbeda menghasilkan class dengan nama sama?
6. Bagaimana jika schema berubah minor tetapi class berubah besar?
7. Bagaimana jika provider eksternal mengirim XML yang valid secara bisnis tetapi tidak valid menurut XSD?
8. Bagaimana menjaga Java 8 legacy dan Java 17/21/25 modern tetap kompatibel?
9. Bagaimana memisahkan generated DTO dari domain model?
10. Bagaimana memastikan contract drift tidak masuk diam-diam?

Schema-first bukan sekadar code generation. Schema-first adalah **contract governance workflow**.

---

## 3. Mental Model: XSD Sebagai Source of Truth

Dalam code-first, Java class dianggap sumber kebenaran, lalu XML mengikuti.

Dalam schema-first, kebalikannya:

```text
Contract truth lives in XSD.
Java code is generated adapter surface.
Domain model is internal business truth.
```

Jangan campur tiga hal ini:

| Layer | Fungsi | Boleh Berubah? | Siapa Pemilik? |
|---|---|---:|---|
| XSD contract | Bentuk data antar sistem | Sangat hati-hati | External/internal governance |
| Generated JAXB model | Representasi Java dari XSD | Regenerate dari XSD | Build process |
| Domain model | Business behavior internal | Bebas secara internal | Aplikasi kita |
| Mapper/ACL | Translasi contract ↔ domain | Evolutif | Aplikasi kita |

Kesalahan klasik adalah memakai generated JAXB class langsung sebagai domain entity.

Contoh buruk:

```java
// Buruk: generated class dipakai sebagai domain object utama
public void approveClaim(ClaimSubmission claim) {
    claim.setApprovalStatus("APPROVED");
    claim.setApprovedBy(currentUser());
    claim.setApprovedAt(now());
    repository.save(claim);
}
```

Masalahnya:

- `ClaimSubmission` bukan domain object, tetapi contract representation.
- Field-nya mencerminkan XSD, bukan invariant bisnis.
- Jika XSD berubah, domain ikut terguncang.
- Generated class biasanya mutable, nullable, dan kurang strict.
- Annotation/binding-nya untuk XML, bukan untuk business rules.

Lebih baik:

```text
Inbound XML
  ↓ unmarshal
Generated JAXB DTO
  ↓ validate + translate
Domain command / domain object
  ↓ business rules
Application use case
  ↓ translate
Generated JAXB response DTO
  ↓ marshal
Outbound XML
```

---

## 4. Kapan Schema-First Cocok

Schema-first cocok jika:

1. Kontrak XML sudah ada sebelum aplikasi Java dibuat.
2. Ada banyak consumer/provider lintas bahasa/platform.
3. Kontrak perlu governance formal.
4. Kompatibilitas backward/forward sangat penting.
5. Ada SOAP/WSDL/XSD contract dari pihak eksternal.
6. XML dipakai untuk regulatory filing, document exchange, financial messaging, government integration, atau enterprise legacy.
7. Schema sering divalidasi secara independen di luar aplikasi Java.
8. Ada kebutuhan audit bahwa payload sesuai versi kontrak tertentu.

Schema-first kurang cocok jika:

1. Kontrak hanya internal dan cepat berubah.
2. Format XML hanya detail teknis sementara.
3. Tim tidak punya discipline untuk menjaga XSD.
4. Semua consumer Java dan controlled penuh.
5. Data shape sangat dinamis dan lebih cocok JSON/schema-less.

Namun, untuk SOAP dan legacy XML integration, schema-first hampir selalu lebih defensible.

---

## 5. XJC: Apa yang Sebenarnya Dilakukan

XJC adalah binding compiler.

Input:

```text
XSD schema(s)
+ optional external binding files
+ optional catalog
+ options
```

Output:

```text
Java source files
+ ObjectFactory
+ package-info.java
+ optional episode file
```

Secara konseptual, XJC melakukan mapping:

```text
XSD namespace       → Java package
XSD complexType    → Java class
XSD simpleType     → Java enum / Java type / adapter candidate
XSD element        → field / JAXBElement / factory method
XSD attribute      → field annotated as XML attribute
XSD sequence       → property order
XSD choice         → choice-like fields / Object / JAXBElement depending shape
XSD occurrence     → list / nullable field
XSD nillable       → JAXBElement or nullable semantics depending context
```

Generated code bukan hasil random. Ia mengikuti binding rules. Tetapi rules default sering tidak ideal untuk enterprise codebase. Karena itu kita butuh binding customization.

---

## 6. Java 8 sampai 25: Peta Namespace dan Dependency

### 6.1 Java 8 Legacy

Pada Java 8, banyak aplikasi menggunakan package:

```java
javax.xml.bind.*
```

Dan sering mengandalkan JAXB tersedia dari JDK.

Contoh:

```java
import javax.xml.bind.JAXBContext;
import javax.xml.bind.Marshaller;
import javax.xml.bind.Unmarshaller;
```

Masalahnya: pendekatan ini tidak portabel ke Java 11+ tanpa dependency eksplisit.

### 6.2 Java 9 dan 10

Java 9 memperkenalkan module system. Modul Java EE seperti `java.xml.bind` sudah deprecated for removal.

Beberapa proyek waktu itu mencoba workaround:

```bash
--add-modules java.xml.bind
```

Ini hanya transisi sementara, bukan strategi jangka panjang.

### 6.3 Java 11+

Sejak Java 11, modul JAXB dihapus dari JDK. Dependency harus eksplisit.

Untuk stack `javax` legacy:

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

Untuk stack `jakarta` modern:

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

Versi dapat berubah, tetapi prinsipnya tetap: **API + runtime harus jelas**.

### 6.4 Jakarta Namespace Break

JAXB 2.x:

```java
javax.xml.bind.*
```

Jakarta XML Binding 3.x/4.x:

```java
jakarta.xml.bind.*
```

Ini bukan binary-compatible rename biasa. Jika generated source memakai `javax`, ia tidak bisa langsung dicampur dengan code yang import `jakarta`.

Prinsip migrasi:

```text
Satu module/artifact sebaiknya memilih satu namespace JAXB:
- javax untuk legacy stack
- jakarta untuk modern stack
```

Jangan campur `javax.xml.bind` dan `jakarta.xml.bind` dalam satu boundary kecuali benar-benar mengerti classpath consequences.

---

## 7. Struktur Repository yang Disarankan

Schema-first perlu struktur yang rapi supaya kontrak tidak tenggelam di generated source.

Contoh struktur Maven multi-module:

```text
integration-contracts/
  pom.xml
  src/main/resources/xsd/
    partner-a/
      v1/
        partner-a.xsd
        common-types.xsd
    regulator-b/
      filing-v3/
        filing.xsd
        identity.xsd
  src/main/resources/bindings/
    partner-a-v1.xjb
    regulator-b-filing-v3.xjb
  src/main/resources/catalogs/
    catalog.xml
  target/generated-sources/xjc/

integration-adapter/
  src/main/java/com/acme/integration/partnera/
    PartnerAClient.java
    PartnerAMapper.java
    PartnerAValidator.java
```

Alternatif single module:

```text
src/main/resources/schema/
src/main/resources/jaxb-binding/
src/generated/java/        # tidak ideal jika dicommit tanpa alasan
```

Rekomendasi:

1. XSD disimpan sebagai resource versioned.
2. Binding file disimpan terpisah dari XSD vendor.
3. Generated source tidak diedit manual.
4. Jika generated source dicommit, harus ada alasan jelas, misalnya build reproducibility di environment restricted.
5. Regeneration harus deterministic.
6. Build harus fail jika generated code out-of-date.

---

## 8. Minimal XSD Untuk Belajar

Misalkan kita punya schema:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<xs:schema
    xmlns:xs="http://www.w3.org/2001/XMLSchema"
    targetNamespace="https://example.com/claim/v1"
    xmlns="https://example.com/claim/v1"
    elementFormDefault="qualified"
    attributeFormDefault="unqualified">

  <xs:element name="ClaimSubmission" type="ClaimSubmissionType"/>

  <xs:complexType name="ClaimSubmissionType">
    <xs:sequence>
      <xs:element name="ClaimId" type="xs:string"/>
      <xs:element name="SubmittedAt" type="xs:dateTime"/>
      <xs:element name="Claimant" type="PersonType"/>
      <xs:element name="Items" type="ClaimItemsType" minOccurs="0"/>
    </xs:sequence>
    <xs:attribute name="version" type="xs:string" use="required"/>
  </xs:complexType>

  <xs:complexType name="PersonType">
    <xs:sequence>
      <xs:element name="Name" type="xs:string"/>
      <xs:element name="Identifier" type="xs:string"/>
    </xs:sequence>
  </xs:complexType>

  <xs:complexType name="ClaimItemsType">
    <xs:sequence>
      <xs:element name="Item" type="ClaimItemType" maxOccurs="unbounded"/>
    </xs:sequence>
  </xs:complexType>

  <xs:complexType name="ClaimItemType">
    <xs:sequence>
      <xs:element name="Code" type="xs:string"/>
      <xs:element name="Amount" type="xs:decimal"/>
    </xs:sequence>
  </xs:complexType>

</xs:schema>
```

XJC default biasanya menghasilkan:

```text
com.example.claim.v1.ClaimSubmissionType
com.example.claim.v1.PersonType
com.example.claim.v1.ClaimItemsType
com.example.claim.v1.ClaimItemType
com.example.claim.v1.ObjectFactory
com.example.claim.v1.package-info
```

Perhatikan: root element `ClaimSubmission` tidak selalu menghasilkan class `ClaimSubmission` jika yang didefinisikan adalah global element dengan named type `ClaimSubmissionType`. Bisa muncul factory method atau `JAXBElement<ClaimSubmissionType>` tergantung shape schema.

Ini sering mengejutkan engineer yang berharap 1 element = 1 class.

---

## 9. Cara Menjalankan XJC: CLI Mental Model

Secara konseptual:

```bash
xjc \
  -d target/generated-sources/xjc \
  -p com.acme.contract.claim.v1 \
  src/main/resources/xsd/claim-v1.xsd
```

Opsi umum:

| Option | Fungsi |
|---|---|
| `-d` | output directory |
| `-p` | force package name |
| `-b` | binding customization file |
| `-catalog` | XML catalog untuk resolve import/include external resource |
| `-extension` | allow vendor extensions/plugin |
| `-episode` | generate episode file |
| `-npa` | suppress package-level annotations ke class-level; jarang direkomendasikan |
| `-no-header` | tidak generate timestamp/header agar output lebih deterministic |
| `-verbose` | debugging generation |

Namun di build modern, sebaiknya XJC dijalankan melalui Maven/Gradle, bukan manual CLI.

---

## 10. Maven Setup untuk Java 8 Legacy (`javax`)

Untuk proyek yang masih Java 8 atau masih memakai `javax.xml.bind`, gunakan JAXB 2.x generation.

Contoh dependency runtime:

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

Contoh plugin generation memakai `org.jvnet.jaxb:jaxb-maven-plugin` versi 2.x:

```xml
<plugin>
  <groupId>org.jvnet.jaxb</groupId>
  <artifactId>jaxb-maven-plugin</artifactId>
  <version>2.0.9</version>
  <executions>
    <execution>
      <id>generate-claim-v1</id>
      <goals>
        <goal>generate</goal>
      </goals>
      <configuration>
        <schemaDirectory>${project.basedir}/src/main/resources/xsd/claim/v1</schemaDirectory>
        <schemaIncludes>
          <include>claim-v1.xsd</include>
        </schemaIncludes>
        <bindingDirectory>${project.basedir}/src/main/resources/bindings</bindingDirectory>
        <bindingIncludes>
          <include>claim-v1.xjb</include>
        </bindingIncludes>
        <generateDirectory>${project.build.directory}/generated-sources/xjc</generateDirectory>
        <removeOldOutput>true</removeOldOutput>
        <args>
          <arg>-no-header</arg>
        </args>
      </configuration>
    </execution>
  </executions>
</plugin>
```

Catatan:

- Plugin ecosystem JAXB cukup beragam. Pilihan plugin bisa berbeda antar organisasi.
- Yang penting bukan nama pluginnya, tetapi reproducibility, namespace output, binding file, catalog, dan CI verification.

---

## 11. Maven Setup untuk Jakarta Modern (`jakarta`)

Untuk Java 17/21/25 dan Jakarta XML Binding 4.x:

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

Generation plugin modern:

```xml
<plugin>
  <groupId>org.jvnet.jaxb</groupId>
  <artifactId>jaxb-maven-plugin</artifactId>
  <version>4.0.8</version>
  <executions>
    <execution>
      <id>generate-claim-v1</id>
      <goals>
        <goal>generate</goal>
      </goals>
      <configuration>
        <schemaDirectory>${project.basedir}/src/main/resources/xsd/claim/v1</schemaDirectory>
        <schemaIncludes>
          <include>claim-v1.xsd</include>
        </schemaIncludes>
        <bindingDirectory>${project.basedir}/src/main/resources/bindings</bindingDirectory>
        <bindingIncludes>
          <include>claim-v1.xjb</include>
        </bindingIncludes>
        <generateDirectory>${project.build.directory}/generated-sources/xjc</generateDirectory>
        <removeOldOutput>true</removeOldOutput>
        <args>
          <arg>-no-header</arg>
        </args>
      </configuration>
    </execution>
  </executions>
</plugin>
```

Untuk Jakarta binding file, namespace binding-nya juga perlu modern.

Contoh binding file Jakarta:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<jaxb:bindings
    xmlns:jaxb="https://jakarta.ee/xml/ns/jaxb"
    xmlns:xs="http://www.w3.org/2001/XMLSchema"
    jaxb:version="3.0">

  <jaxb:globalBindings>
    <jaxb:serializable uid="1"/>
  </jaxb:globalBindings>

</jaxb:bindings>
```

Untuk JAXB lama, sering terlihat:

```xml
<jaxb:bindings
    xmlns:jaxb="http://java.sun.com/xml/ns/jaxb"
    xmlns:xs="http://www.w3.org/2001/XMLSchema"
    jaxb:version="2.1">
```

Perbedaan namespace binding ini penting saat migrasi.

---

## 12. Gradle Setup: Prinsip Umum

Gradle tidak punya satu standard tunggal yang universal untuk JAXB generation. Banyak proyek memakai plugin pihak ketiga, custom `JavaExec`, atau task langsung ke XJC.

Mental model task:

```groovy
configurations {
    xjc
}

dependencies {
    xjc 'org.glassfish.jaxb:jaxb-xjc:4.0.5'
    xjc 'org.glassfish.jaxb:jaxb-runtime:4.0.5'
    implementation 'jakarta.xml.bind:jakarta.xml.bind-api:4.0.2'
    runtimeOnly 'org.glassfish.jaxb:jaxb-runtime:4.0.5'
}

sourceSets {
    main {
        java {
            srcDir "$buildDir/generated/sources/xjc"
        }
    }
}

tasks.register('generateJaxb', JavaExec) {
    classpath = configurations.xjc
    mainClass = 'com.sun.tools.xjc.XJCFacade'
    args = [
        '-d', "$buildDir/generated/sources/xjc",
        '-b', 'src/main/resources/bindings/claim-v1.xjb',
        '-no-header',
        'src/main/resources/xsd/claim/v1/claim-v1.xsd'
    ]
}

compileJava.dependsOn tasks.named('generateJaxb')
```

Catatan:

- `mainClass` dapat berbeda tergantung versi tool.
- Untuk build enterprise, gunakan plugin/konfigurasi yang distandarkan di organisasi.
- Jangan membuat task ad-hoc yang hanya berjalan di laptop tertentu.

---

## 13. Binding Customization: Kenapa Dibutuhkan

XSD eksternal sering tidak Java-friendly.

Contoh masalah:

1. Type name terlalu generik: `Type`, `Data`, `Response`.
2. Namespace mapping menghasilkan package buruk.
3. Element name bentrok dengan Java keyword: `class`, `default`, `package`.
4. Ada simpleType yang seharusnya enum tetapi tidak ideal.
5. `xs:dateTime` default menjadi `XMLGregorianCalendar`, padahal aplikasi ingin `OffsetDateTime` atau `LocalDateTime` melalui adapter.
6. Ada nama property yang tidak sesuai convention.
7. Ada collision antar schema.
8. Ada schema vendor yang tidak boleh diedit.

Binding file `.xjb` memungkinkan kita mengubah mapping tanpa mengubah XSD asli.

Prinsip penting:

```text
External XSD should remain pristine.
Customization belongs in external binding file.
```

---

## 14. Global Binding

Contoh global binding dasar:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<jaxb:bindings
    xmlns:jaxb="https://jakarta.ee/xml/ns/jaxb"
    xmlns:xs="http://www.w3.org/2001/XMLSchema"
    jaxb:version="3.0">

  <jaxb:globalBindings>
    <jaxb:serializable uid="1"/>
  </jaxb:globalBindings>

</jaxb:bindings>
```

`serializable` bisa berguna jika generated DTO perlu melewati session/container serialization, tetapi jangan otomatis menganggap ini best practice. Untuk distributed system modern, Java serialization biasanya bukan boundary yang sehat.

Global binding dapat mempengaruhi semua schema. Karena itu gunakan dengan hati-hati.

---

## 15. Package Naming Strategy

Ada dua pendekatan:

### 15.1 Force Package via XJC Option

```bash
xjc -p com.acme.contract.claim.v1 claim-v1.xsd
```

Kelebihan:

- Cepat.
- Cocok untuk satu schema sederhana.

Kekurangan:

- Semua namespace masuk satu package.
- Tidak cocok untuk multi-namespace complex schema.
- Bisa menyembunyikan modularity kontrak.

### 15.2 Package via Binding File

```xml
<jaxb:bindings
    xmlns:jaxb="https://jakarta.ee/xml/ns/jaxb"
    xmlns:xs="http://www.w3.org/2001/XMLSchema"
    jaxb:version="3.0">

  <jaxb:bindings schemaLocation="../xsd/claim/v1/claim-v1.xsd" node="/xs:schema">
    <jaxb:schemaBindings>
      <jaxb:package name="com.acme.contract.claim.v1"/>
    </jaxb:schemaBindings>
  </jaxb:bindings>

</jaxb:bindings>
```

Rekomendasi enterprise:

```text
Use binding file for package mapping.
Avoid relying only on generated reverse-domain package names from namespace URI.
```

Package harus merepresentasikan:

- external partner/system,
- domain/integration area,
- contract version,
- bukan internal implementation module.

Contoh baik:

```text
com.acme.contract.regulator.filing.v3
com.acme.contract.payment.iso20022.pacs008.v001001
com.acme.contract.partneralpha.claim.v1
```

Contoh buruk:

```text
com.acme.model
com.acme.xml
com.acme.generated
com.acme.dto
```

Nama package buruk membuat collision dan migration sulit.

---

## 16. Class Renaming dengan Binding File

Misalkan XSD punya type:

```xml
<xs:complexType name="Data">
  <xs:sequence>
    <xs:element name="Value" type="xs:string"/>
  </xs:sequence>
</xs:complexType>
```

Default class `Data` terlalu generik.

Binding customization:

```xml
<jaxb:bindings
    xmlns:jaxb="https://jakarta.ee/xml/ns/jaxb"
    xmlns:xs="http://www.w3.org/2001/XMLSchema"
    jaxb:version="3.0">

  <jaxb:bindings schemaLocation="../xsd/vendor/vendor.xsd">
    <jaxb:bindings node="//xs:complexType[@name='Data']">
      <jaxb:class name="VendorData"/>
    </jaxb:bindings>
  </jaxb:bindings>

</jaxb:bindings>
```

Manfaat:

- Generated class lebih readable.
- Mengurangi collision.
- Domain mapper lebih jelas.

Namun jangan rename terlalu agresif. Jika generated name terlalu jauh dari XSD, debugging payload menjadi lebih sulit.

---

## 17. Property Renaming

Misalkan XSD:

```xml
<xs:element name="URL" type="xs:string"/>
<xs:element name="ID" type="xs:string"/>
```

Generated property bisa menjadi `url`, `id`, atau variasi yang tidak sesuai convention.

Binding:

```xml
<jaxb:bindings node="//xs:element[@name='URL']">
  <jaxb:property name="url"/>
</jaxb:bindings>

<jaxb:bindings node="//xs:element[@name='ID']">
  <jaxb:property name="identifier"/>
</jaxb:bindings>
```

Trade-off:

- Nama Java lebih baik.
- Tetapi mapper harus sadar bahwa XML name tetap `URL`/`ID`.

Prinsip:

```text
Rename Java surface for maintainability.
Do not obscure XML contract semantics.
```

---

## 18. Date/Time Binding: XMLGregorianCalendar vs Java Time

Default JAXB sering menghasilkan:

```java
XMLGregorianCalendar submittedAt;
```

Ini akurat terhadap XML Schema type system, tetapi tidak selalu nyaman untuk aplikasi modern.

XSD types:

| XSD Type | Default JAXB | Modern Domain Candidate |
|---|---|---|
| `xs:date` | `XMLGregorianCalendar` | `LocalDate` |
| `xs:time` | `XMLGregorianCalendar` | `OffsetTime` / `LocalTime` |
| `xs:dateTime` | `XMLGregorianCalendar` | `OffsetDateTime` / `Instant` |
| `xs:duration` | `Duration` variant | `java.time.Duration` / `Period` with care |

Ada dua pendekatan:

### 18.1 Biarkan Generated DTO Pakai XMLGregorianCalendar

Mapper ke domain:

```java
public OffsetDateTime toOffsetDateTime(XMLGregorianCalendar value) {
    if (value == null) {
        return null;
    }
    return value.toGregorianCalendar().toZonedDateTime().toOffsetDateTime();
}
```

Kelebihan:

- Lebih setia ke XML schema.
- Lebih aman untuk contract fidelity.
- Tidak perlu custom XJC binding kompleks.

Kekurangan:

- Mapper lebih verbose.
- Developer harus memahami timezone/offset.

### 18.2 Gunakan Custom Adapter

Binding file:

```xml
<jaxb:globalBindings>
  <jaxb:javaType
      name="java.time.OffsetDateTime"
      xmlType="xs:dateTime"
      parseMethod="com.acme.xml.XmlDateTimes.parseOffsetDateTime"
      printMethod="com.acme.xml.XmlDateTimes.printOffsetDateTime"/>
</jaxb:globalBindings>
```

Helper:

```java
package com.acme.xml;

import java.time.OffsetDateTime;

public final class XmlDateTimes {
    private XmlDateTimes() {}

    public static OffsetDateTime parseOffsetDateTime(String value) {
        return value == null ? null : OffsetDateTime.parse(value);
    }

    public static String printOffsetDateTime(OffsetDateTime value) {
        return value == null ? null : value.toString();
    }
}
```

Generated field bisa menjadi `OffsetDateTime`.

Trade-off:

- Lebih nyaman untuk Java modern.
- Tetapi parse/print harus benar terhadap lexical representation XML Schema.
- Risiko compatibility jika pihak eksternal mengirim timezone/format yang valid XSD tapi tidak diterima parser kita.

Untuk integration critical, saya cenderung memilih:

```text
Generated contract DTO: XMLGregorianCalendar
Domain mapper: java.time types
```

Kecuali tim punya alasan kuat dan test coverage tinggi untuk custom adapter.

---

## 19. Enum Binding dari Simple Type

XSD:

```xml
<xs:simpleType name="ClaimStatusType">
  <xs:restriction base="xs:string">
    <xs:enumeration value="SUBMITTED"/>
    <xs:enumeration value="APPROVED"/>
    <xs:enumeration value="REJECTED"/>
  </xs:restriction>
</xs:simpleType>
```

XJC dapat menghasilkan enum:

```java
@XmlType(name = "ClaimStatusType")
@XmlEnum
public enum ClaimStatusType {
    SUBMITTED,
    APPROVED,
    REJECTED
}
```

Masalah muncul jika value tidak Java-friendly:

```xml
<xs:enumeration value="in-progress"/>
<xs:enumeration value="1st-review"/>
<xs:enumeration value="class"/>
```

Binding customization bisa rename enum constant:

```xml
<jaxb:bindings node="//xs:simpleType[@name='ReviewStatusType']">
  <jaxb:typesafeEnumClass name="ReviewStatus">
    <jaxb:typesafeEnumMember name="IN_PROGRESS" value="in-progress"/>
    <jaxb:typesafeEnumMember name="FIRST_REVIEW" value="1st-review"/>
    <jaxb:typesafeEnumMember name="CLASS_STATUS" value="class"/>
  </jaxb:typesafeEnumClass>
</jaxb:bindings>
```

Production warning:

Jika external party sering menambah enum baru, generated enum bisa menjadi breaking point. XML instance dengan enum value baru bisa gagal unmarshal.

Decision:

| Kondisi | Mapping Disarankan |
|---|---|
| Enum stabil dan closed | Java enum |
| Enum dari regulator jarang berubah tapi versioned | Java enum + strict versioning |
| Enum vendor sering berubah tanpa notice | String + domain validation |
| Unknown value harus diterima sementara | String boundary + mapper tolerant |

Top 1% engineer tidak otomatis membuat semua enumeration menjadi enum. Ia bertanya: **apakah value set benar-benar closed?**

---

## 20. Handling `xs:choice`

XSD:

```xml
<xs:complexType name="ContactType">
  <xs:choice>
    <xs:element name="Email" type="xs:string"/>
    <xs:element name="Phone" type="xs:string"/>
    <xs:element name="PostalAddress" type="AddressType"/>
  </xs:choice>
</xs:complexType>
```

Generated JAXB model bisa kurang ergonomic, misalnya beberapa nullable fields atau `JAXBElement<?>` tergantung schema.

Domain model sebaiknya lebih eksplisit:

```java
public sealed interface ContactMethod permits EmailContact, PhoneContact, PostalAddressContact {}

public record EmailContact(String email) implements ContactMethod {}
public record PhoneContact(String phone) implements ContactMethod {}
public record PostalAddressContact(Address address) implements ContactMethod {}
```

Mapper boundary:

```java
public ContactMethod toDomain(ContactType xml) {
    int count = 0;
    count += xml.getEmail() != null ? 1 : 0;
    count += xml.getPhone() != null ? 1 : 0;
    count += xml.getPostalAddress() != null ? 1 : 0;

    if (count != 1) {
        throw new InvalidContractPayloadException("Exactly one contact method is required");
    }

    if (xml.getEmail() != null) return new EmailContact(xml.getEmail());
    if (xml.getPhone() != null) return new PhoneContact(xml.getPhone());
    return new PostalAddressContact(toDomain(xml.getPostalAddress()));
}
```

Walaupun XSD sudah menyatakan `choice`, jangan percaya generated model otomatis menjaga invariant saat object dibuat programmatically.

---

## 21. Handling `maxOccurs="unbounded"`

XSD:

```xml
<xs:element name="Item" type="ClaimItemType" maxOccurs="unbounded"/>
```

Generated pattern umum:

```java
public List<ClaimItemType> getItem() {
    if (item == null) {
        item = new ArrayList<>();
    }
    return this.item;
}
```

Tidak ada setter.

Ini sengaja: JAXB memakai live list.

Penggunaan:

```java
claimItems.getItem().add(item1);
claimItems.getItem().add(item2);
```

Production implication:

1. Getter punya side effect: bisa menginisialisasi list.
2. List mutable.
3. Tidak ada immutable boundary.
4. Domain model jangan expose list ini langsung.
5. Jika `getItem()` dipanggil saat audit comparison, object bisa berubah dari `null` ke empty list.

Mapper yang aman:

```java
List<ClaimItem> toDomainItems(ClaimItemsType xml) {
    if (xml == null || xml.getItem() == null) {
        return List.of();
    }
    return xml.getItem().stream()
        .map(this::toDomain)
        .toList();
}
```

Untuk Java 8:

```java
return xml.getItem().stream()
    .map(this::toDomain)
    .collect(Collectors.toList());
```

---

## 22. Nillable vs Optional vs Absent

XSD:

```xml
<xs:element name="MiddleName" type="xs:string" minOccurs="0" nillable="true"/>
```

Ada tiga keadaan XML:

### 22.1 Absent

```xml
<Person>
  <FirstName>Fajar</FirstName>
</Person>
```

### 22.2 Present but nil

```xml
<Person xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <FirstName>Fajar</FirstName>
  <MiddleName xsi:nil="true"/>
</Person>
```

### 22.3 Present with empty string

```xml
<Person>
  <FirstName>Fajar</FirstName>
  <MiddleName></MiddleName>
</Person>
```

Ini bukan hal yang sama.

Generated JAXB kadang memakai `JAXBElement<String>` untuk membedakan absent vs nil vs value.

Banyak engineer membenci `JAXBElement`, lalu mencoba menghilangkannya. Tapi untuk kontrak tertentu, `JAXBElement` justru menyimpan semantic information.

Prinsip:

```text
Do not flatten absent/nil/empty unless business semantics allow it.
```

Domain mapper harus eksplisit:

```java
public OptionalField<String> mapMiddleName(JAXBElement<String> middleName) {
    if (middleName == null) {
        return OptionalField.absent();
    }
    if (middleName.isNil()) {
        return OptionalField.nil();
    }
    return OptionalField.value(middleName.getValue());
}
```

Custom type:

```java
public sealed interface OptionalField<T> {
    record Absent<T>() implements OptionalField<T> {}
    record Nil<T>() implements OptionalField<T> {}
    record Value<T>(T value) implements OptionalField<T> {}

    static <T> OptionalField<T> absent() { return new Absent<>(); }
    static <T> OptionalField<T> nil() { return new Nil<>(); }
    static <T> OptionalField<T> value(T value) { return new Value<>(value); }
}
```

Untuk Java 8, gunakan class hierarchy biasa.

---

## 23. XML Catalog: Mengontrol Import/Include dan Network Access

Schema sering import external namespace:

```xml
<xs:import namespace="http://www.w3.org/2000/09/xmldsig#"
           schemaLocation="http://www.w3.org/TR/xmldsig-core/xmldsig-core-schema.xsd"/>
```

Masalah:

1. Build tergantung internet.
2. External URL bisa down.
3. Schema remote bisa berubah.
4. Build menjadi non-reproducible.
5. Security risk: tool mencoba fetch resource eksternal.

Solusi: XML Catalog.

Contoh `catalog.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<catalog xmlns="urn:oasis:names:tc:entity:xmlns:xml:catalog">
  <system
      systemId="http://www.w3.org/TR/xmldsig-core/xmldsig-core-schema.xsd"
      uri="../xsd/vendor/w3c/xmldsig-core-schema.xsd"/>

  <uri
      name="http://www.w3.org/2000/09/xmldsig#"
      uri="../xsd/vendor/w3c/xmldsig-core-schema.xsd"/>
</catalog>
```

XJC:

```bash
xjc -catalog src/main/resources/catalogs/catalog.xml schema.xsd
```

Build policy:

```text
No network access during schema compilation.
All imported schemas must be vendored or resolved by catalog.
```

Ini sangat penting untuk regulated/enterprise build.

---

## 24. Episode Files: Masalah Multi-Schema dan Multi-Module

Episode file adalah metadata yang memberitahu XJC bahwa schema tertentu sudah pernah dikompilasi menjadi class tertentu.

Kenapa butuh?

Misalkan ada common schema:

```text
common-types.xsd
  → com.acme.contract.common.v1.*
```

Lalu ada schema lain:

```text
claim.xsd imports common-types.xsd
payment.xsd imports common-types.xsd
```

Tanpa episode, XJC bisa generate ulang common types di module claim dan payment. Akibatnya:

```text
claim module punya com.acme.contract.common.v1.PersonType
payment module punya com.acme.contract.common.v1.PersonType
```

Atau lebih buruk, package collision / duplicate classes.

Episode workflow:

```text
common-types.xsd
  ↓ generate common classes
  ↓ generate common.episode
claim.xsd + common.episode
  ↓ generate only claim-specific classes, refer to common classes
payment.xsd + common.episode
  ↓ generate only payment-specific classes, refer to common classes
```

### 24.1 Generate Episode

CLI concept:

```bash
xjc \
  -d target/generated-sources/xjc \
  -episode target/generated-sources/xjc/META-INF/sun-jaxb.episode \
  common-types.xsd
```

### 24.2 Consume Episode

```bash
xjc \
  -d target/generated-sources/xjc \
  -b common-types.episode \
  claim.xsd
```

Episode file membantu modularisasi schema compilation.

Enterprise rule:

```text
If common XSD is shared across generated artifacts, use episodes or a dedicated generated-contract module.
```

---

## 25. Generated-Code Hygiene

Generated code punya status khusus.

Ia bukan handwritten code. Ia juga bukan disposable artifact yang boleh berubah diam-diam.

Ada dua strategi:

### 25.1 Do Not Commit Generated Sources

```text
Commit XSD + binding files + catalog.
Generate sources during build.
```

Kelebihan:

- Source of truth jelas.
- Tidak ada manual edits.
- Git diff fokus pada contract/binding.

Kekurangan:

- Build butuh XJC tool stabil.
- IDE setup harus benar.
- Build lebih lambat.

### 25.2 Commit Generated Sources

```text
Commit XSD + binding files + generated Java.
CI verifies regeneration produces same output.
```

Kelebihan:

- IDE mudah.
- Build environment tanpa XJC masih bisa compile.
- Review generated diff bisa eksplisit.

Kekurangan:

- PR noise tinggi.
- Risiko manual edits.
- Bisa terjadi drift jika regeneration tidak diverifikasi.

Untuk enterprise, kedua strategi bisa benar. Yang salah adalah:

```text
Generated code dicommit, boleh diedit manual, dan tidak ada verification.
```

### 25.3 Hygiene Rules

1. Generated package diberi nama jelas.
2. Header timestamp dimatikan jika bisa (`-no-header`).
3. Output directory dibersihkan sebelum generate.
4. Build deterministic.
5. Generated code tidak diformat ulang manual.
6. Static analysis exclusions didefinisikan.
7. Coverage tools mengecualikan generated code.
8. Mapper dan validators tidak diletakkan dalam generated package.
9. Jangan menambah method manual ke generated class.
10. Jangan expose generated class ke seluruh aplikasi sebagai universal DTO.

---

## 26. Mapper Layer: Anti-Corruption Boundary

Generated JAXB classes sering mutable dan lemah invariant. Domain model sebaiknya lebih strict.

Contoh generated:

```java
public class ClaimSubmissionType {
    protected String claimId;
    protected XMLGregorianCalendar submittedAt;
    protected PersonType claimant;
    protected ClaimItemsType items;
    protected String version;

    // getters/setters
}
```

Domain command:

```java
public record SubmitClaimCommand(
    ClaimId claimId,
    OffsetDateTime submittedAt,
    Person claimant,
    List<ClaimItem> items,
    ContractVersion contractVersion
) {}
```

Mapper:

```java
public final class ClaimSubmissionMapper {

    public SubmitClaimCommand toCommand(ClaimSubmissionType xml) {
        requireNonNull(xml, "xml");

        return new SubmitClaimCommand(
            ClaimId.parse(required(xml.getClaimId(), "ClaimId")),
            toOffsetDateTime(required(xml.getSubmittedAt(), "SubmittedAt")),
            toPerson(required(xml.getClaimant(), "Claimant")),
            toItems(xml.getItems()),
            ContractVersion.parse(required(xml.getVersion(), "version"))
        );
    }

    private static <T> T required(T value, String field) {
        if (value == null) {
            throw new InvalidContractPayloadException(field + " is required");
        }
        return value;
    }
}
```

Boundary validator dan mapper bukan duplikasi XSD. Ia menambahkan business/operational invariant yang XSD tidak bisa ekspresikan dengan baik.

---

## 27. XSD Validation vs JAXB Unmarshal

Unmarshal tanpa schema validation:

```java
JAXBContext context = JAXBContext.newInstance(ClaimSubmissionType.class);
Unmarshaller unmarshaller = context.createUnmarshaller();
ClaimSubmissionType claim = (ClaimSubmissionType) unmarshaller.unmarshal(inputStream);
```

Dengan schema validation:

```java
SchemaFactory schemaFactory = SchemaFactory.newInstance(XMLConstants.W3C_XML_SCHEMA_NS_URI);
Schema schema = schemaFactory.newSchema(new File("claim-v1.xsd"));

Unmarshaller unmarshaller = context.createUnmarshaller();
unmarshaller.setSchema(schema);

ClaimSubmissionType claim = (ClaimSubmissionType) unmarshaller.unmarshal(inputStream);
```

Namun, dalam production gunakan secure schema factory configuration seperti dibahas di Part 15.

Contoh hardened pattern:

```java
SchemaFactory factory = SchemaFactory.newInstance(XMLConstants.W3C_XML_SCHEMA_NS_URI);
factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
factory.setProperty(XMLConstants.ACCESS_EXTERNAL_DTD, "");
factory.setProperty(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");

Schema schema = factory.newSchema(localSchemaFile);
```

Unmarshal pipeline yang defensible:

```text
Input bytes
  ↓ size limit
Secure XML parser configuration
  ↓ optional XSD validation
JAXB unmarshal
  ↓ structural null/invariant check
Mapper to domain
  ↓ business validation
Use case execution
```

Jangan menganggap XSD validation cukup untuk business correctness.

---

## 28. Contract Compatibility: Apa yang Aman Diubah?

Dalam schema-first, perubahan XSD harus dianalisis sebagai perubahan kontrak.

### 28.1 Biasanya Backward-Compatible

| Perubahan | Catatan |
|---|---|
| Menambah optional element di akhir sequence | Lebih aman jika consumer tolerant |
| Menambah optional attribute | Aman jika consumer ignore unknown attributes |
| Menambah enum value | Bisa breaking untuk generated enum consumer |
| Relax restriction | Consumer lama mungkin tetap okay |
| Menambah type baru tidak dipakai | Umumnya aman |

### 28.2 Biasanya Breaking

| Perubahan | Dampak |
|---|---|
| Rename element | Consumer gagal parse |
| Rename namespace | Kontrak baru |
| Ubah required jadi optional | Bisa breaking untuk business assumption |
| Ubah optional jadi required | Producer lama gagal |
| Ubah type `string` ke `int` | Breaking |
| Ubah sequence order | XML order-sensitive |
| Hapus element | Breaking |
| Hapus enum value | Breaking |
| Ubah max/minOccurs | Bisa breaking |

### 28.3 Sequence Order Trap

XML Schema `xs:sequence` order matters.

Jika schema:

```xml
<xs:sequence>
  <xs:element name="A" type="xs:string"/>
  <xs:element name="B" type="xs:string"/>
</xs:sequence>
```

Maka:

```xml
<Root><A>x</A><B>y</B></Root>
```

valid.

Tapi:

```xml
<Root><B>y</B><A>x</A></Root>
```

invalid.

Banyak engineer dari JSON world lupa bahwa XML element order bisa contract-critical.

---

## 29. Handling Multiple Contract Versions

Jangan overwrite package yang sama untuk versi berbeda.

Buruk:

```text
com.acme.contract.claim
```

Baik:

```text
com.acme.contract.claim.v1
com.acme.contract.claim.v2
```

Adapter:

```text
ClaimV1XmlAdapter → ClaimCommand
ClaimV2XmlAdapter → ClaimCommand
```

Struktur:

```text
src/main/resources/xsd/claim/v1/claim.xsd
src/main/resources/xsd/claim/v2/claim.xsd
src/main/resources/bindings/claim-v1.xjb
src/main/resources/bindings/claim-v2.xjb
```

Runtime selection:

```java
public SubmitClaimCommand parse(byte[] xml, ContractVersion version) {
    return switch (version.value()) {
        case "1.0" -> claimV1Adapter.parse(xml);
        case "2.0" -> claimV2Adapter.parse(xml);
        default -> throw new UnsupportedContractVersionException(version);
    };
}
```

Untuk Java 8 gunakan `if/else` atau classic `switch`.

Prinsip:

```text
Versioned contract packages are cheap.
Ambiguous generated packages are expensive.
```

---

## 30. XSD Import/Include Governance

XSD composition punya dua mekanisme penting:

### 30.1 `xs:include`

Digunakan untuk schema dengan target namespace sama.

```xml
<xs:include schemaLocation="common-types.xsd"/>
```

### 30.2 `xs:import`

Digunakan untuk schema dengan namespace berbeda.

```xml
<xs:import namespace="https://example.com/common/v1"
           schemaLocation="common-v1.xsd"/>
```

Governance rule:

1. Jangan pakai remote URL langsung di build.
2. Simpan imported schema secara lokal.
3. Pakai catalog untuk resolve external URI.
4. Jangan ubah vendor schema tanpa patch record.
5. Jika vendor schema invalid, buat folder `patched` dan dokumentasikan delta.

Contoh:

```text
src/main/resources/xsd/vendor/original/
src/main/resources/xsd/vendor/patched/
src/main/resources/xsd/vendor/README.md
```

README:

```markdown
# Vendor XSD Patch Notes

Original source: Partner A package dated 2025-03-01.
Patch 1:
- File: claim-types.xsd
- Reason: duplicate type name `Address` conflicts with `address.xsd` import.
- Change: no semantic XML contract change; only local schemaLocation adjusted.
- Approved by: Integration Architecture Review, 2025-03-12.
```

---

## 31. Handling Bad Vendor Schemas

Real-world XSD often has problems:

1. Circular imports.
2. Broken schemaLocation.
3. Duplicate type names.
4. Ambiguous content model.
5. Chameleon schemas.
6. Non-deterministic content model.
7. Element names that map poorly to Java.
8. Overuse of `xs:any`.
9. Very large schema sets.
10. Type names that differ only by case.

Top-level strategy:

```text
Do not immediately hack generated Java.
Stabilize schema acquisition, catalog, binding, generation, and validation first.
```

Decision tree:

```text
Vendor schema fails XJC
  ↓
Can vendor provide fixed schema?
  ├─ yes → use official fixed schema
  └─ no
      ↓
Can external binding solve it?
  ├─ yes → keep XSD pristine, use binding
  └─ no
      ↓
Can catalog/local schemaLocation solve it?
  ├─ yes → document catalog mapping
  └─ no
      ↓
Patch vendor schema locally with explicit patch notes
```

Never silently patch XSD.

---

## 32. Build Determinism and CI Verification

A schema-first workflow should be reproducible.

CI checks:

1. Validate all XSD files.
2. Run XJC generation.
3. Compile generated sources.
4. Run sample XML unmarshal tests.
5. Run sample XML marshal golden tests.
6. Verify generated code diff if committed.
7. Ensure no network access during generation.
8. Ensure no duplicate generated classes.
9. Ensure package namespace matches policy.
10. Ensure javax/jakarta namespace matches module policy.

Example CI script concept:

```bash
#!/usr/bin/env bash
set -euo pipefail

mvn -q clean generate-sources compile test

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Generated sources or contract artifacts are out of date"
  git status --porcelain
  exit 1
fi
```

If generated sources are not committed, the diff check applies only to generated docs/metadata if any.

---

## 33. Golden XML Tests

Generated class tests are not enough. You need sample XML tests.

### 33.1 Unmarshal Golden Sample

```java
@Test
void shouldUnmarshalClaimV1Sample() throws Exception {
    JAXBContext context = JAXBContext.newInstance(ClaimSubmissionType.class);
    Unmarshaller unmarshaller = context.createUnmarshaller();

    try (InputStream in = getClass().getResourceAsStream("/samples/claim/v1/valid-claim.xml")) {
        JAXBElement<ClaimSubmissionType> root = unmarshaller.unmarshal(
            new StreamSource(in),
            ClaimSubmissionType.class
        );

        ClaimSubmissionType claim = root.getValue();
        assertEquals("CLM-001", claim.getClaimId());
    }
}
```

### 33.2 Marshal Golden Sample

Naive string comparison is brittle because namespace prefix can vary.

Better options:

1. Canonical XML comparison.
2. XMLUnit semantic comparison.
3. XPath assertions.
4. Validate marshalled output against XSD.

Example XPath-style intent:

```java
assertXmlHasValue(xml, "/*[local-name()='ClaimSubmission']/*[local-name()='ClaimId']", "CLM-001");
```

### 33.3 Negative Samples

Test invalid payloads:

```text
missing-required-field.xml
wrong-namespace.xml
wrong-sequence-order.xml
invalid-enum.xml
nil-required-field.xml
external-entity-attempt.xml
huge-repeated-items.xml
```

A good contract test suite includes valid and invalid examples.

---

## 34. Generated DTO Does Not Replace Validation

XSD can validate structure, but cannot express all business rules.

Examples not ideal in XSD:

1. `amount` must be positive only for claim type X.
2. `submittedAt` cannot be future date beyond 5 minutes clock skew.
3. `identifier` must exist in internal registry.
4. `countryCode` must be allowed for this partner.
5. `item.code` must match configured catalog for current effective date.
6. `startDate <= endDate` across fields.
7. `totalAmount == sum(items.amount)` with decimal policy.

Thus:

```text
XSD validation = structural contract validation
Application validation = semantic/business validation
```

Do both when needed.

---

## 35. Handling `ObjectFactory`

Generated JAXB package usually includes `ObjectFactory`.

It may contain:

```java
@XmlRegistry
public class ObjectFactory {

    private final static QName _ClaimSubmission_QNAME =
        new QName("https://example.com/claim/v1", "ClaimSubmission");

    public ObjectFactory() {}

    public ClaimSubmissionType createClaimSubmissionType() {
        return new ClaimSubmissionType();
    }

    @XmlElementDecl(namespace = "https://example.com/claim/v1", name = "ClaimSubmission")
    public JAXBElement<ClaimSubmissionType> createClaimSubmission(ClaimSubmissionType value) {
        return new JAXBElement<>(_ClaimSubmission_QNAME, ClaimSubmissionType.class, null, value);
    }
}
```

Use cases:

1. Creating root `JAXBElement` when class lacks `@XmlRootElement`.
2. Preserving element QName.
3. Handling substitution/nillable semantics.

Example marshal:

```java
ObjectFactory factory = new ObjectFactory();
ClaimSubmissionType value = factory.createClaimSubmissionType();
value.setClaimId("CLM-001");

JAXBElement<ClaimSubmissionType> root = factory.createClaimSubmission(value);
marshaller.marshal(root, outputStream);
```

Do not delete `ObjectFactory` because “looks unused”. It often encodes root element and QName metadata.

---

## 36. `package-info.java` Matters

Generated `package-info.java` may contain:

```java
@jakarta.xml.bind.annotation.XmlSchema(
    namespace = "https://example.com/claim/v1",
    elementFormDefault = jakarta.xml.bind.annotation.XmlNsForm.QUALIFIED
)
package com.acme.contract.claim.v1;
```

This controls package-level namespace mapping.

If missing or wrong, marshalled XML can have wrong namespace qualification.

Do not ignore `package-info.java` in generated source.

Symptoms of namespace issue:

1. XML looks visually correct but partner rejects it.
2. Elements appear without namespace.
3. Root has namespace but children do not.
4. Unexpected prefixes appear.
5. Unmarshal returns object with null fields because namespace mismatch.

---

## 37. Namespace Prefix Control

JAXB spec does not make prefix choice a semantic contract. Namespace URI matters, not prefix.

These are semantically equivalent:

```xml
<claim:ClaimSubmission xmlns:claim="https://example.com/claim/v1"/>
```

```xml
<ns2:ClaimSubmission xmlns:ns2="https://example.com/claim/v1"/>
```

But some legacy partners incorrectly depend on prefix names.

If forced to control prefix, implementation-specific configuration may be needed, for example JAXB RI namespace prefix mapper. Treat this as vendor-specific, not portable JAXB.

Architecture decision:

```text
If partner requires prefix string instead of namespace URI, document it as interoperability defect.
Use provider-specific prefix mapping only at integration edge.
```

---

## 38. `JAXBElement`: Jangan Dibenci Terlalu Cepat

Banyak generated models mengandung `JAXBElement<T>`.

Contoh:

```java
protected JAXBElement<String> middleName;
```

Alasan:

1. Element name/QName perlu dipertahankan.
2. Type bisa dipakai oleh banyak element berbeda.
3. Nillable/absent semantics perlu dibedakan.
4. Substitution group/polymorphism.

Jangan langsung memaksa semua `JAXBElement` hilang melalui binding customization.

Tanya dulu:

```text
Is this JAXBElement preserving contract information we need?
```

Jika hanya membuat code verbose dan semantic tidak penting, boleh customize. Jika membedakan absent/nil/QName, pertahankan.

---

## 39. Dealing with Very Large Schema Sets

Contoh: ISO 20022, UBL, NIEM, HL7, regulator schema pack.

Masalah:

1. Ribuan generated classes.
2. Build lambat.
3. IDE berat.
4. Package collision.
5. JAXBContext creation mahal.
6. Memory tinggi.
7. Static analysis noise.

Strategi:

1. Generate hanya schema yang dipakai.
2. Pisahkan module per message family/version.
3. Gunakan episode untuk common types.
4. Cache `JAXBContext` per package/message family.
5. Jangan create context per request.
6. Exclude generated code dari code coverage.
7. Jangan scan entire classpath.
8. Buat facade API kecil di atas generated model.

Contoh context holder:

```java
public final class ClaimV1Jaxb {
    private static final JAXBContext CONTEXT = create();

    private ClaimV1Jaxb() {}

    public static JAXBContext context() {
        return CONTEXT;
    }

    private static JAXBContext create() {
        try {
            return JAXBContext.newInstance("com.acme.contract.claim.v1");
        } catch (JAXBException e) {
            throw new ExceptionInInitializerError(e);
        }
    }
}
```

Ingat: `JAXBContext` thread-safe untuk reuse; `Marshaller` dan `Unmarshaller` tidak diperlakukan sebagai shared mutable object lintas thread.

---

## 40. JPMS / Module System Notes

Untuk Java 9+, jika memakai module-info:

```java
module com.acme.integration.claim {
    requires jakarta.xml.bind;
    requires java.xml;

    exports com.acme.contract.claim.v1;
    opens com.acme.contract.claim.v1 to jakarta.xml.bind;
}
```

Kenapa `opens`?

JAXB runtime membutuhkan reflective access ke generated classes/fields/properties.

Jika lupa `opens`, error runtime bisa muncul seperti:

```text
module com.acme.integration.claim does not open com.acme.contract.claim.v1 to jakarta.xml.bind
```

Untuk generated package, pertimbangkan:

```java
opens com.acme.contract.claim.v1 to jakarta.xml.bind;
```

Bukan `open module` seluruh aplikasi kecuali benar-benar perlu.

---

## 41. Spring Boot / Jakarta EE / Standalone Integration

JAXB generated classes bisa dipakai di berbagai runtime:

1. Jakarta EE application server.
2. Spring Boot app.
3. Standalone batch processor.
4. CLI converter.
5. SOAP client module.
6. Message-driven integration adapter.

Yang berbeda adalah dependency dan lifecycle.

### 41.1 Jakarta EE Container

Container mungkin menyediakan JAXB feature, tergantung server/profile/version. Namun untuk portability, pastikan versi API/runtime jelas dan tidak konflik dengan container-provided libraries.

### 41.2 Spring Boot

Spring Boot modern tidak otomatis berarti JAXB tersedia. Untuk XML marshalling/unmarshalling, dependency perlu eksplisit.

### 41.3 Standalone Java 11+

Harus eksplisit:

```text
jakarta.xml.bind-api
jaxb-runtime
```

atau untuk legacy:

```text
jaxb-api javax
jaxb-runtime 2.x
```

---

## 42. Example End-to-End: Claim Contract Module

### 42.1 Directory

```text
claim-contract/
  pom.xml
  src/main/resources/xsd/claim/v1/claim-v1.xsd
  src/main/resources/bindings/claim-v1.xjb
  src/test/resources/samples/claim/v1/valid-claim.xml
  src/test/resources/samples/claim/v1/missing-claim-id.xml
```

### 42.2 Binding File

```xml
<?xml version="1.0" encoding="UTF-8"?>
<jaxb:bindings
    xmlns:jaxb="https://jakarta.ee/xml/ns/jaxb"
    xmlns:xs="http://www.w3.org/2001/XMLSchema"
    jaxb:version="3.0">

  <jaxb:bindings schemaLocation="../xsd/claim/v1/claim-v1.xsd" node="/xs:schema">
    <jaxb:schemaBindings>
      <jaxb:package name="com.acme.contract.claim.v1"/>
    </jaxb:schemaBindings>
  </jaxb:bindings>

  <jaxb:globalBindings>
    <jaxb:serializable uid="1"/>
  </jaxb:globalBindings>

</jaxb:bindings>
```

### 42.3 Runtime Parser

```java
package com.acme.integration.claim.v1;

import com.acme.contract.claim.v1.ClaimSubmissionType;
import jakarta.xml.bind.JAXBContext;
import jakarta.xml.bind.JAXBElement;
import jakarta.xml.bind.JAXBException;
import jakarta.xml.bind.Unmarshaller;

import javax.xml.XMLConstants;
import javax.xml.transform.stream.StreamSource;
import javax.xml.validation.Schema;
import javax.xml.validation.SchemaFactory;
import java.io.InputStream;

public final class ClaimV1XmlReader {
    private static final JAXBContext JAXB_CONTEXT = createContext();
    private final Schema schema;

    public ClaimV1XmlReader(Schema schema) {
        this.schema = schema;
    }

    public ClaimSubmissionType read(InputStream input) {
        try {
            Unmarshaller unmarshaller = JAXB_CONTEXT.createUnmarshaller();
            unmarshaller.setSchema(schema);

            JAXBElement<ClaimSubmissionType> root = unmarshaller.unmarshal(
                new StreamSource(input),
                ClaimSubmissionType.class
            );
            return root.getValue();
        } catch (JAXBException e) {
            throw new InvalidClaimXmlException("Invalid claim XML", e);
        }
    }

    private static JAXBContext createContext() {
        try {
            return JAXBContext.newInstance(ClaimSubmissionType.class);
        } catch (JAXBException e) {
            throw new ExceptionInInitializerError(e);
        }
    }

    public static Schema loadSchema() {
        try {
            SchemaFactory factory = SchemaFactory.newInstance(XMLConstants.W3C_XML_SCHEMA_NS_URI);
            factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
            factory.setProperty(XMLConstants.ACCESS_EXTERNAL_DTD, "");
            factory.setProperty(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");

            return factory.newSchema(
                ClaimV1XmlReader.class.getResource("/xsd/claim/v1/claim-v1.xsd")
            );
        } catch (Exception e) {
            throw new IllegalStateException("Cannot load claim v1 schema", e);
        }
    }
}
```

Note: `Class#getResource` returns URL. In real code, handle null resource explicitly.

### 42.4 Mapper

```java
package com.acme.integration.claim.v1;

import com.acme.contract.claim.v1.ClaimItemType;
import com.acme.contract.claim.v1.ClaimSubmissionType;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.List;

public final class ClaimV1Mapper {

    public SubmitClaimCommand toCommand(ClaimSubmissionType xml) {
        require(xml, "ClaimSubmission");

        return new SubmitClaimCommand(
            ClaimId.parse(required(xml.getClaimId(), "ClaimId")),
            XmlTime.toOffsetDateTime(required(xml.getSubmittedAt(), "SubmittedAt")),
            toPerson(required(xml.getClaimant(), "Claimant")),
            toItems(xml.getItems()),
            ContractVersion.parse(required(xml.getVersion(), "version"))
        );
    }

    private ClaimItem toItem(ClaimItemType item) {
        String code = required(item.getCode(), "Item.Code");
        BigDecimal amount = required(item.getAmount(), "Item.Amount");
        if (amount.signum() < 0) {
            throw new InvalidClaimPayloadException("Item.Amount must not be negative");
        }
        return new ClaimItem(code, amount);
    }

    private static <T> T required(T value, String name) {
        if (value == null) {
            throw new InvalidClaimPayloadException(name + " is required");
        }
        return value;
    }
}
```

---

## 43. Error Taxonomy for Schema-First Boundary

A mature integration distinguishes errors:

| Error Type | Example | Response / Handling |
|---|---|---|
| Transport error | Cannot read stream | Retry maybe |
| XML well-formedness error | broken XML | reject payload |
| XML security violation | external entity attempt | reject + security log |
| XSD validation error | missing required element | reject with contract error |
| JAXB binding error | type conversion failure | reject with parse error |
| Semantic validation error | amount negative | reject with business error |
| Unsupported version | v99 unknown | reject / route to fallback |
| Mapping error | unexpected choice state | reject + bug investigation |
| Downstream failure | DB/service unavailable | retry/compensate |

Jangan lempar semua sebagai `RuntimeException("Invalid XML")`.

Good error model:

```java
public sealed class ContractException extends RuntimeException permits
    XmlWellFormednessException,
    XmlSchemaValidationException,
    XmlSecurityException,
    XmlBindingException,
    ContractSemanticValidationException,
    UnsupportedContractVersionException {

    protected ContractException(String message, Throwable cause) {
        super(message, cause);
    }
}
```

Untuk Java 8 gunakan abstract class + subclasses tanpa sealed.

---

## 44. SOAP/WSDL Connection

Part ini tentang XSD → Java. Nanti di JAX-WS/SOAP, WSDL generation juga sering menghasilkan JAXB classes.

WSDL berisi:

```text
types section → XSD schemas
message/portType/binding/service → web service contract
```

Dalam SOAP schema-first / contract-first:

```text
WSDL + XSD
  ↓ wsimport / equivalent tool
Service interface + JAXB model + client stubs
```

Maka semua prinsip part ini tetap berlaku:

1. XSD adalah contract source.
2. Generated classes jangan diedit.
3. Binding customization penting.
4. Episode/catalog penting untuk schema besar.
5. javax/jakarta migration harus direncanakan.
6. Domain model harus dipisah.

---

## 45. Migration: Java 8 `javax` ke Java 17/21/25 `jakarta`

Migration path tidak selalu langsung.

### 45.1 Inventory

Cari:

```bash
grep -R "javax.xml.bind" -n src
grep -R "com.sun.xml.bind" -n src
grep -R "java.xml.bind" -n .
grep -R "xjc" -n pom.xml build.gradle .
```

Inventory:

1. Runtime imports.
2. Generated source imports.
3. Binding file namespaces.
4. Maven/Gradle plugin versions.
5. JAXB RI vendor-specific APIs.
6. SOAP/JAX-WS generated code coupling.
7. App server provided libraries.

### 45.2 Decide Migration Unit

Do not half-migrate randomly.

Options:

| Option | Description | Risk |
|---|---|---|
| Stay `javax` on Java 17/21 | Use JAXB 2.3.x dependencies | Lower code churn, legacy namespace remains |
| Move to `jakarta` | Regenerate classes and update imports | Higher churn, future-aligned |
| Adapter split | Separate legacy contract module from modern app | More modules, better isolation |

### 45.3 Regenerate, Do Not Search/Replace Generated Code Manually

For generated JAXB classes:

```text
Update XJC toolchain → regenerate → compile → test golden XML.
```

Do not mass edit generated source if it can be regenerated correctly.

### 45.4 Binding File Namespace Update

Old:

```xml
xmlns:jaxb="http://java.sun.com/xml/ns/jaxb"
jaxb:version="2.1"
```

Modern:

```xml
xmlns:jaxb="https://jakarta.ee/xml/ns/jaxb"
jaxb:version="3.0"
```

Validate that all customization still works.

---

## 46. Common Failure Cases and Diagnosis

### 46.1 `ClassNotFoundException: javax.xml.bind.JAXBContext`

Likely Java 11+ without JAXB dependency.

Fix: add explicit JAXB API/runtime or migrate to Jakarta.

### 46.2 `NoClassDefFoundError: jakarta/xml/bind/JAXBContext`

Code compiled with Jakarta JAXB but runtime missing Jakarta API.

Fix: dependency/runtime packaging.

### 46.3 `unexpected element ... Expected elements are ...`

Likely namespace/root mismatch.

Check:

1. Root element QName.
2. Package `@XmlSchema`.
3. `elementFormDefault`.
4. Using `unmarshal(Source, Class)` vs raw unmarshal.
5. Correct generated package version.

### 46.4 Fields Become Null After Unmarshal

Usually namespace mismatch for child elements.

Example XML:

```xml
<ClaimSubmission xmlns="https://example.com/claim/v1">
  <ClaimId>CLM-001</ClaimId>
</ClaimSubmission>
```

vs schema expecting unqualified child elements, or vice versa.

Check `elementFormDefault`.

### 46.5 Duplicate Class During Generation

Causes:

1. Two schema define same type name in same package.
2. Forced `-p` collapsed namespaces.
3. Common schema generated multiple times.
4. Missing episode file.

Fix:

1. Package per namespace/version.
2. Binding rename.
3. Episode for common schema.

### 46.6 Build Downloads XSD From Internet

Cause: remote `schemaLocation` and no catalog.

Fix: vendor schema locally + catalog.

### 46.7 `IllegalAnnotationException`

Usually class has conflicting JAXB annotations or generated/handwritten mix issue.

Fix:

1. Inspect generated class.
2. Check duplicate property due to field + getter annotations.
3. Check custom class modifications.
4. Ensure consistent annotation access type.

---

## 47. Top 1% Design Heuristics

### 47.1 Treat Generated Code as Boundary Surface

Generated JAXB classes are not your domain.

They are equivalent to:

```text
wire protocol structs
```

Use them at the edge.

### 47.2 Version Packages Explicitly

Never hide version differences.

```text
claim.v1
claim.v2
```

is clearer than conditional fields inside one ambiguous `claim` package.

### 47.3 Never Trust External XML Just Because It Unmarshalled

Unmarshal success means parse/binding success, not business validity.

### 47.4 Prefer External Binding Over Vendor XSD Edits

Keep vendor schema pristine unless impossible.

### 47.5 Use Catalogs for Reproducibility and Security

No build should depend on external schema URL availability.

### 47.6 Keep Mapper Boring and Explicit

The mapper is where contract semantics become domain semantics.

Do not hide important conversion in magical reflection or generic mappers.

### 47.7 Test With Real Samples

Generated classes compiling is not enough.

Use real XML samples from provider/consumer.

### 47.8 Think in Failure Modes

For every contract:

```text
What if field absent?
What if nil?
What if empty?
What if enum unknown?
What if namespace wrong?
What if version old?
What if version new?
What if schema import unavailable?
What if generated class changes after tool upgrade?
```

---

## 48. Practical Checklist

### 48.1 Contract Acquisition

- [ ] XSD source identified.
- [ ] Owner identified.
- [ ] Version identified.
- [ ] License/usage constraints understood.
- [ ] Original schema stored unchanged.
- [ ] Patch notes created if schema patched.

### 48.2 Generation

- [ ] XJC version pinned.
- [ ] JAXB namespace selected: `javax` or `jakarta`.
- [ ] Binding files stored.
- [ ] XML catalog configured.
- [ ] Output directory deterministic.
- [ ] Header timestamp disabled if possible.
- [ ] Generated package versioned.
- [ ] No manual generated code edits.

### 48.3 Runtime

- [ ] API/runtime dependency explicit.
- [ ] `JAXBContext` cached.
- [ ] `Marshaller`/`Unmarshaller` not shared unsafely.
- [ ] Secure XML settings applied.
- [ ] XSD validation policy defined.
- [ ] Size/depth/entity protections defined.

### 48.4 Mapping

- [ ] Generated DTO not used as domain model.
- [ ] Mapper handles required fields.
- [ ] Mapper handles nil/absent/empty semantics.
- [ ] Date/time conversion explicit.
- [ ] Decimal precision preserved.
- [ ] Unknown enum policy defined.
- [ ] Business validation separated from XSD validation.

### 48.5 Testing

- [ ] Valid sample XML tests.
- [ ] Invalid sample XML tests.
- [ ] Golden marshal tests.
- [ ] Schema validation tests.
- [ ] Namespace mismatch tests.
- [ ] Version compatibility tests.
- [ ] Build regeneration verification.

### 48.6 Migration

- [ ] Java 8/JDK JAXB usage inventoried.
- [ ] Java 11+ dependency gap closed.
- [ ] `javax`/`jakarta` strategy decided.
- [ ] Binding namespace updated if migrating.
- [ ] Generated classes regenerated.
- [ ] Golden samples compared before/after.

---

## 49. Mini Case Study: Regulator Filing Schema

Scenario:

- Regulator provides `filing-v3.xsd`.
- It imports `identity.xsd`, `address.xsd`, and XML Signature schema.
- App runs Java 21 + Spring Boot.
- Regulator expects XML namespace prefixes to look specific.
- Filing payload must be archived for audit.

Naive approach:

```text
Run xjc once manually.
Commit generated source.
Use generated FilingType directly in business service.
Marshal XML and send.
```

Likely future problems:

1. Build not reproducible.
2. XML Signature schema downloaded during generation.
3. Generated source edited manually.
4. Business service tightly coupled to regulator schema.
5. Java 21 runtime missing JAXB dependency.
6. Prefix mismatch blamed on JAXB.
7. No golden XML comparison.
8. Filing v4 breaks package.

Better approach:

```text
regulator-filing-contract-v3 module
  - original XSDs
  - catalog
  - binding file
  - generated source via pinned XJC
  - golden samples

regulator-filing-adapter module
  - FilingV3Reader
  - FilingV3Writer
  - FilingV3Mapper
  - FilingV3Validator
  - prefix workaround if required, isolated

domain module
  - FilingCommand
  - FilingAggregate
  - FilingRules
```

Flow:

```text
Inbound/Outbound business data
  ↓
Domain filing model
  ↓ mapper
Generated FilingV3Type
  ↓ JAXB marshal
XML output
  ↓ schema validate
archive canonical/audit copy
  ↓ send to regulator
```

This design protects domain from regulator contract churn while still preserving precise XML contract behavior.

---

## 50. Exercises

### Exercise 1: Generate From XSD

Take a simple XSD with:

- one root element,
- one complex type,
- one nested type,
- one enum,
- one `xs:dateTime`,
- one optional element.

Generate Java classes using XJC.

Observe:

1. Package name.
2. Root element representation.
3. `ObjectFactory`.
4. `package-info.java`.
5. Date/time type.
6. List handling.

### Exercise 2: Add Binding Customization

Create `.xjb` to:

1. Set package name.
2. Rename one class.
3. Rename one enum member.
4. Add serializable.

Regenerate and compare diff.

### Exercise 3: Add XML Catalog

Modify XSD to import another schema. Resolve it locally with catalog.

Verify build still works without internet.

### Exercise 4: Mapper Boundary

Write mapper from generated class to domain record/class.

Rules:

1. No generated class leaks into service layer.
2. Date/time conversion explicit.
3. Required fields checked.
4. Optional/nillable semantics documented.

### Exercise 5: Compatibility Simulation

Create v2 schema:

1. Add optional element.
2. Add required element.
3. Rename element.
4. Add enum value.

Regenerate and observe which changes break tests.

---

## 51. Summary

Schema-first JAXB workflow is not merely code generation. It is a disciplined integration contract workflow.

The important mental model:

```text
XSD is the contract.
XJC generates boundary classes.
Binding files adapt schema-to-Java mapping.
Catalogs make builds secure and reproducible.
Episodes make multi-schema generation modular.
Generated classes are not domain models.
Mappers preserve domain integrity.
Golden XML tests preserve contract behavior.
```

For Java 8–25, the most important operational reality is that JAXB moved from being “often available in the JDK” to being an explicit dependency and toolchain decision. On top of that, the `javax` → `jakarta` namespace transition must be treated as an architectural migration, not a casual import rewrite.

If you master schema-first workflow, you become capable of handling the kind of integration work that many teams fear: regulator schemas, SOAP contracts, vendor XML packs, legacy enterprise systems, and long-lived compatibility requirements.

---

## 52. Apa yang Tidak Dibahas Mendalam di Part Ini

Part ini sengaja tidak membahas:

1. Code-first JAXB generation dari Java ke XSD — itu Part 19.
2. Advanced polymorphism, maps, wildcards, mixed content — itu Part 20.
3. Runtime performance/classloader/JPMS/GraalVM deeper detail — itu Part 21.
4. WSDL/JAX-WS generation — itu masuk Part 22–25.
5. SOAP security/WS-Security — itu Part 28–29.

---

## 53. Status Seri

Part ini adalah **Part 18 dari 34**.

Seri **belum selesai**.

Berikutnya:

**Part 19 — JAXB Code-First Workflow: Java → XSD, Contract Drift Risk, Schema Generation, Compatibility Testing, and When Code-First Is Acceptable**.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 17 — JAXB / Jakarta XML Binding Annotation Deep Dive](./learn-java-json-xml-soap-connectors-enterprise-integration-part-017.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-json-xml-soap-connectors-enterprise-integration — Part 19](./learn-java-json-xml-soap-connectors-enterprise-integration-part-019.md)

</div>