# Part 16 — XML Mapping in Modern Java: JAXB/Jakarta XML Binding and Jackson XML

> Seri: `learn-java-data-mapper-json-xml-jackson-mapstruct-lombok-transformation-engineering`  
> File: `16-xml-mapping-modern-java-jaxb-jakarta-xml-binding-jackson-xml.md`  
> Posisi: Part 16 dari 35  
> Target: Java 8 sampai Java 25  
> Fokus: XML mapping modern Java, JAXB/Jakarta XML Binding, Jackson XML, XML shape control, namespace, attribute/element, compatibility, dan pilihan arsitektur.

---

## 0. Tujuan Bagian Ini

Di bagian sebelumnya kita sudah masuk cukup dalam ke JSON, Jackson, API contract, security, performance, dan alignment dengan OpenAPI/JSON Schema. Sekarang kita masuk ke XML.

Banyak engineer modern menganggap XML sebagai teknologi lama. Itu separuh benar tetapi berbahaya. XML memang tidak sepopuler JSON untuk REST API modern, tetapi XML masih sangat hidup di sistem enterprise, integrasi government, banking, insurance, healthcare, regulatory reporting, document exchange, SOAP-ish integration, message archival, digital signature, dan legacy platform.

Masalahnya, XML bukan hanya “JSON dengan tag”. XML punya model data yang berbeda:

- element,
- attribute,
- namespace,
- text node,
- mixed content,
- ordering,
- schema,
- wrapper,
- prefix,
- canonicalization,
- external entity,
- dan whitespace sensitivity.

Kalau kita membawa mental model JSON mentah ke XML, mapping layer akan cepat menjadi rapuh.

Tujuan bagian ini:

1. Memahami XML sebagai contract shape yang berbeda dari JSON.
2. Memahami kapan memakai JAXB/Jakarta XML Binding, kapan memakai Jackson XML, dan kapan manual/streaming parsing lebih tepat.
3. Memahami konsekuensi Java 8 sampai Java 25 terhadap XML binding.
4. Mendesain XML DTO yang stabil, kompatibel, dan aman.
5. Menghindari bug umum XML mapping: namespace salah, wrapper hilang, attribute tertukar element, order salah, XXE, dan schema drift.
6. Menyiapkan mental model untuk Part 17 yang akan membahas XML edge cases lebih ekstrem.

---

## 1. XML Mapping Itu Masalah Boundary, Bukan Sekadar Format

Ketika aplikasi menerima atau mengirim XML, kita sedang melewati boundary. Boundary tersebut bisa berupa:

- API eksternal,
- file batch,
- message queue,
- SOAP endpoint,
- report exchange,
- regulatory submission,
- document archive,
- digital signature payload,
- atau legacy adapter.

Di boundary ini, format XML menjadi bagian dari kontrak. Kalau XML berubah sedikit saja, penerima bisa gagal parsing.

Contoh perubahan kecil yang bisa breaking:

```xml
<!-- Versi A -->
<Customer id="C001">
    <Name>Fajar</Name>
</Customer>
```

```xml
<!-- Versi B -->
<Customer>
    <Id>C001</Id>
    <Name>Fajar</Name>
</Customer>
```

Secara semantic, dua payload ini sama-sama punya customer id. Tetapi secara XML contract, keduanya berbeda. Yang satu memakai attribute, yang lain memakai element.

Contoh lain:

```xml
<Items>
    <Item>A</Item>
    <Item>B</Item>
</Items>
```

berbeda dari:

```xml
<Item>A</Item>
<Item>B</Item>
```

Di JSON, array relatif jelas:

```json
{
  "items": ["A", "B"]
}
```

Di XML, list sering membutuhkan wrapper element. Tidak semua XML binding library punya default yang sama untuk wrapper.

Mental model utama:

> XML mapping adalah proses menjaga bentuk dokumen, bukan hanya mengisi field Java.

---

## 2. XML vs JSON: Perbedaan Model Data yang Mempengaruhi Mapper

### 2.1 JSON Model

JSON memiliki struktur utama:

- object,
- array,
- string,
- number,
- boolean,
- null.

Contoh:

```json
{
  "customerId": "C001",
  "name": "Fajar",
  "active": true,
  "roles": ["ADMIN", "APPROVER"]
}
```

Mapping ke Java relatif direct:

```java
public record CustomerDto(
    String customerId,
    String name,
    boolean active,
    List<String> roles
) {}
```

### 2.2 XML Model

XML memiliki struktur yang lebih kaya:

- document,
- element,
- attribute,
- text node,
- namespace,
- processing instruction,
- comment,
- CDATA,
- order,
- wrapper element,
- mixed content.

Contoh:

```xml
<customer id="C001" xmlns="https://example.com/customer/v1">
    <name>Fajar</name>
    <active>true</active>
    <roles>
        <role>ADMIN</role>
        <role>APPROVER</role>
    </roles>
</customer>
```

Field `id` bukan child element. Ia attribute.

Namespace `https://example.com/customer/v1` bukan field business, tetapi bagian dari contract identity.

`roles` punya wrapper `<roles>` dan item element `<role>`.

### 2.3 Dampaknya terhadap Java Model

DTO untuk XML sering butuh annotation lebih spesifik daripada JSON.

Dengan Jakarta XML Binding:

```java
import jakarta.xml.bind.annotation.XmlAccessType;
import jakarta.xml.bind.annotation.XmlAccessorType;
import jakarta.xml.bind.annotation.XmlAttribute;
import jakarta.xml.bind.annotation.XmlElement;
import jakarta.xml.bind.annotation.XmlElementWrapper;
import jakarta.xml.bind.annotation.XmlRootElement;
import java.util.List;

@XmlRootElement(name = "customer", namespace = "https://example.com/customer/v1")
@XmlAccessorType(XmlAccessType.FIELD)
public class CustomerXmlDto {

    @XmlAttribute(name = "id", required = true)
    private String customerId;

    @XmlElement(name = "name", required = true)
    private String name;

    @XmlElement(name = "active")
    private boolean active;

    @XmlElementWrapper(name = "roles")
    @XmlElement(name = "role")
    private List<String> roles;

    public CustomerXmlDto() {
        // JAXB/Jakarta XML Binding usually needs a no-args constructor.
    }

    public CustomerXmlDto(String customerId, String name, boolean active, List<String> roles) {
        this.customerId = customerId;
        this.name = name;
        this.active = active;
        this.roles = roles;
    }

    public String getCustomerId() {
        return customerId;
    }

    public String getName() {
        return name;
    }

    public boolean isActive() {
        return active;
    }

    public List<String> getRoles() {
        return roles;
    }
}
```

Dengan Jackson XML:

```java
import com.fasterxml.jackson.dataformat.xml.annotation.JacksonXmlElementWrapper;
import com.fasterxml.jackson.dataformat.xml.annotation.JacksonXmlProperty;
import com.fasterxml.jackson.dataformat.xml.annotation.JacksonXmlRootElement;
import java.util.List;

@JacksonXmlRootElement(localName = "customer", namespace = "https://example.com/customer/v1")
public class CustomerXmlDto {

    @JacksonXmlProperty(localName = "id", isAttribute = true)
    private String customerId;

    @JacksonXmlProperty(localName = "name")
    private String name;

    @JacksonXmlProperty(localName = "active")
    private boolean active;

    @JacksonXmlElementWrapper(localName = "roles")
    @JacksonXmlProperty(localName = "role")
    private List<String> roles;

    public CustomerXmlDto() {}

    public CustomerXmlDto(String customerId, String name, boolean active, List<String> roles) {
        this.customerId = customerId;
        this.name = name;
        this.active = active;
        this.roles = roles;
    }

    public String getCustomerId() { return customerId; }
    public void setCustomerId(String customerId) { this.customerId = customerId; }

    public String getName() { return name; }
    public void setName(String name) { this.name = name; }

    public boolean isActive() { return active; }
    public void setActive(boolean active) { this.active = active; }

    public List<String> getRoles() { return roles; }
    public void setRoles(List<String> roles) { this.roles = roles; }
}
```

Perhatikan bahwa class Java mirip, tetapi annotation model berbeda.

---

## 3. XML Binding di Java 8 sampai Java 25

### 3.1 Java 8 Era

Di Java 8, JAXB masih sering dianggap “built-in” karena API JAXB tersedia di JDK. Banyak aplikasi lama memakai package:

```java
javax.xml.bind.*
```

Contoh:

```java
import javax.xml.bind.JAXBContext;
import javax.xml.bind.Marshaller;
import javax.xml.bind.Unmarshaller;
```

Ini umum di aplikasi Java 8 enterprise.

### 3.2 Java 9 sampai Java 10 Era

Java 9 memperkenalkan module system. Beberapa Java EE/CORBA module mulai dideprecated for removal. Banyak warning mulai muncul ketika memakai JAXB dari JDK.

### 3.3 Java 11 dan Setelahnya

Di JDK 11, Java EE dan CORBA modules dihapus dari JDK. Oracle migration guide mencatat module seperti `java.xml.bind` termasuk yang dihapus dari JDK 11. Artinya aplikasi yang dulu compile/run di Java 8 dengan JAXB bawaan JDK bisa gagal di Java 11+ jika dependency JAXB tidak ditambahkan eksplisit. ([Oracle JDK 11 Migration Guide](https://docs.oracle.com/en/java/javase/11/migrate/index.html))

Konsekuensinya:

- Jangan mengandalkan JAXB tersedia dari JDK.
- Tambahkan API dan runtime implementation secara eksplisit.
- Pahami perbedaan package `javax.xml.bind` vs `jakarta.xml.bind`.

### 3.4 Jakarta XML Binding

Jakarta XML Binding adalah kelanjutan spesifikasi XML binding di ekosistem Jakarta. Spesifikasi Jakarta XML Binding 4.0 mendeskripsikan API dan tools untuk mengotomasi mapping antara XML document dan Java object. ([Jakarta XML Binding 4.0](https://jakarta.ee/specifications/xml-binding/4.0/))

Package modern:

```java
jakarta.xml.bind.*
jakarta.xml.bind.annotation.*
```

Contoh dependency Maven umum untuk aplikasi standalone:

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

Versi bisa berubah, jadi di project nyata gunakan BOM/platform dependency yang sesuai dengan runtime stack.

### 3.5 Java 25 Perspective

Di Java 25, XML processing dasar seperti DOM/SAX/StAX masih bagian dari Java platform melalui modul XML standar, tetapi JAXB/Jakarta XML Binding bukan sesuatu yang sebaiknya diasumsikan otomatis tersedia dari JDK. Untuk XML object binding, dependency tetap harus eksplisit.

Prinsip migration-safe:

> Treat XML binding as application dependency, not JDK convenience.

---

## 4. Tiga Pendekatan XML di Java

Secara praktis ada tiga keluarga pendekatan:

1. Low-level parsing/writing.
2. JAXB/Jakarta XML Binding.
3. Jackson XML.

Masing-masing punya tempat.

---

## 5. Low-Level XML Processing: DOM, SAX, StAX

Walaupun seri ini fokus mapping, engineer top-level harus tahu kapan binding framework tidak cocok.

### 5.1 DOM

DOM membaca seluruh dokumen XML menjadi tree in-memory.

Cocok untuk:

- dokumen kecil,
- perlu random access,
- perlu manipulasi tree,
- tools internal,
- transformasi kompleks yang tidak streaming.

Tidak cocok untuk:

- file XML sangat besar,
- high-throughput endpoint,
- payload tidak trusted tanpa hardening,
- mapping object sederhana.

Contoh mental model:

```text
XML document -> DOM tree -> query/manipulate node -> output
```

### 5.2 SAX

SAX adalah event-driven parser. Ia membaca XML dan memanggil callback saat menemukan start element, text, end element.

Cocok untuk:

- file besar,
- memory rendah,
- validasi/scan sederhana,
- pipeline event.

Tidak cocok untuk:

- mapping object kompleks yang butuh banyak state,
- kode mudah dibaca,
- transformasi nested yang rumit.

### 5.3 StAX

StAX adalah pull parser. Kode kita menarik event XML secara eksplisit.

Cocok untuk:

- file besar,
- kontrol parsing tinggi,
- partial parsing,
- reading streaming feed,
- membangun object sebagian.

Mental model:

```text
while reader.hasNext():
    event = reader.next()
    if event == START_ELEMENT and name == "Record":
        parse one record
```

### 5.4 Kapan Low-Level Lebih Baik dari Binding

Gunakan low-level ketika:

- XML terlalu besar untuk object graph penuh.
- Kita hanya butuh sebagian field.
- Dokumen punya mixed content ekstrem.
- Binding annotation menjadi terlalu rumit.
- Perlu menjaga whitespace/order/canonical form.
- XML ditandatangani secara digital dan canonicalization sensitif.
- Payload sangat tidak stabil.

Jangan memaksakan JAXB/Jackson XML untuk semua XML.

---

## 6. JAXB/Jakarta XML Binding Mental Model

Jakarta XML Binding memetakan Java object ke XML dan sebaliknya berdasarkan metadata annotation dan binding rules. Ia sangat cocok untuk XML-centric contract.

Mental model:

```text
Java class + XML annotations
        ↓
JAXBContext
        ↓
Marshaller / Unmarshaller
        ↓
XML document <-> Object graph
```

### 6.1 Core Components

#### JAXBContext

`JAXBContext` adalah metadata context untuk class binding.

```java
JAXBContext context = JAXBContext.newInstance(CustomerXmlDto.class);
```

`JAXBContext` relatif mahal dibuat. Biasanya dibuat sekali dan direuse.

#### Marshaller

Marshaller mengubah object menjadi XML.

```java
Marshaller marshaller = context.createMarshaller();
marshaller.setProperty(Marshaller.JAXB_FORMATTED_OUTPUT, true);
marshaller.marshal(customer, System.out);
```

#### Unmarshaller

Unmarshaller mengubah XML menjadi object.

```java
Unmarshaller unmarshaller = context.createUnmarshaller();
CustomerXmlDto customer = (CustomerXmlDto) unmarshaller.unmarshal(inputStream);
```

### 6.2 Basic Example

```java
import jakarta.xml.bind.JAXBContext;
import jakarta.xml.bind.Marshaller;
import jakarta.xml.bind.Unmarshaller;
import jakarta.xml.bind.annotation.XmlAccessType;
import jakarta.xml.bind.annotation.XmlAccessorType;
import jakarta.xml.bind.annotation.XmlAttribute;
import jakarta.xml.bind.annotation.XmlElement;
import jakarta.xml.bind.annotation.XmlRootElement;

import java.io.StringReader;
import java.io.StringWriter;

@XmlRootElement(name = "customer")
@XmlAccessorType(XmlAccessType.FIELD)
public class CustomerXmlDto {

    @XmlAttribute(name = "id")
    private String customerId;

    @XmlElement(name = "name")
    private String name;

    public CustomerXmlDto() {}

    public CustomerXmlDto(String customerId, String name) {
        this.customerId = customerId;
        this.name = name;
    }

    public String getCustomerId() { return customerId; }
    public String getName() { return name; }
}

class XmlExample {
    public static void main(String[] args) throws Exception {
        JAXBContext context = JAXBContext.newInstance(CustomerXmlDto.class);

        CustomerXmlDto customer = new CustomerXmlDto("C001", "Fajar");

        Marshaller marshaller = context.createMarshaller();
        marshaller.setProperty(Marshaller.JAXB_FORMATTED_OUTPUT, true);

        StringWriter writer = new StringWriter();
        marshaller.marshal(customer, writer);

        String xml = writer.toString();
        System.out.println(xml);

        Unmarshaller unmarshaller = context.createUnmarshaller();
        CustomerXmlDto parsed = (CustomerXmlDto) unmarshaller.unmarshal(new StringReader(xml));

        System.out.println(parsed.getCustomerId());
        System.out.println(parsed.getName());
    }
}
```

Output kira-kira:

```xml
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<customer id="C001">
    <name>Fajar</name>
</customer>
```

---

## 7. JAXB/Jakarta XML Binding Annotation Core

### 7.1 `@XmlRootElement`

Menentukan root element.

```java
@XmlRootElement(name = "application")
public class ApplicationXmlDto {
}
```

Tanpa root element, marshalling root object bisa butuh `JAXBElement` wrapper.

### 7.2 `@XmlAccessorType`

Menentukan apakah binding berdasarkan field atau property.

```java
@XmlAccessorType(XmlAccessType.FIELD)
public class ApplicationXmlDto {
    private String applicationNo;
}
```

Pilihan umum:

- `FIELD`: bind field langsung.
- `PROPERTY`: bind getter/setter public.
- `PUBLIC_MEMBER`: default tertentu yang bisa mengejutkan.
- `NONE`: hanya bind yang diberi annotation.

Untuk DTO XML enterprise, `FIELD` atau `NONE` sering lebih predictable.

Rekomendasi:

```java
@XmlAccessorType(XmlAccessType.FIELD)
```

atau untuk contract super ketat:

```java
@XmlAccessorType(XmlAccessType.NONE)
```

Lalu semua field diberi annotation eksplisit.

### 7.3 `@XmlElement`

Mapping field ke child element.

```java
@XmlElement(name = "applicationNo", required = true)
private String applicationNo;
```

Catatan penting: `required = true` pada annotation tidak otomatis sama dengan runtime validation ketat di semua scenario. Untuk enforcement kuat, gunakan XSD validation atau validasi eksplisit.

### 7.4 `@XmlAttribute`

Mapping field ke attribute.

```java
@XmlAttribute(name = "version", required = true)
private String version;
```

Attribute cocok untuk metadata ringkas seperti:

- id,
- version,
- type,
- language,
- code,
- unit.

Tetapi jangan memindahkan field business besar ke attribute hanya karena terlihat ringkas.

### 7.5 `@XmlElementWrapper`

Membungkus collection.

```java
@XmlElementWrapper(name = "documents")
@XmlElement(name = "document")
private List<DocumentXmlDto> documents;
```

Menghasilkan:

```xml
<documents>
    <document>...</document>
    <document>...</document>
</documents>
```

Tanpa wrapper, bisa menjadi:

```xml
<document>...</document>
<document>...</document>
```

Perubahan wrapper adalah breaking change.

### 7.6 `@XmlValue`

Untuk element yang nilainya text tetapi juga mungkin punya attribute.

Contoh:

```xml
<amount currency="SGD">120.50</amount>
```

DTO:

```java
@XmlAccessorType(XmlAccessType.FIELD)
public class AmountXmlDto {

    @XmlAttribute(name = "currency")
    private String currency;

    @XmlValue
    private String value;

    public AmountXmlDto() {}
}
```

### 7.7 `@XmlTransient`

Mengeluarkan field dari XML binding.

```java
@XmlTransient
private String internalTraceId;
```

Gunakan untuk mencegah field internal bocor ke XML.

### 7.8 `@XmlType(propOrder = ...)`

Mengontrol urutan element.

```java
@XmlType(propOrder = {"applicationNo", "applicant", "submittedAt"})
@XmlAccessorType(XmlAccessType.FIELD)
public class ApplicationXmlDto {
    @XmlElement(name = "applicationNo")
    private String applicationNo;

    @XmlElement(name = "applicant")
    private ApplicantXmlDto applicant;

    @XmlElement(name = "submittedAt")
    private String submittedAt;
}
```

Di XML, order bisa penting terutama jika divalidasi XSD dengan sequence.

---

## 8. Namespace dalam JAXB/Jakarta XML Binding

Namespace adalah salah satu sumber bug XML paling sering.

Contoh XML:

```xml
<app:application xmlns:app="https://example.com/application/v1">
    <app:applicationNo>A-001</app:applicationNo>
</app:application>
```

Prefix `app` bukan identity utama. URI namespace adalah identity utama:

```text
https://example.com/application/v1
```

Prefix bisa berubah:

```xml
<x:application xmlns:x="https://example.com/application/v1">
    <x:applicationNo>A-001</x:applicationNo>
</x:application>
```

Secara namespace-aware, dua payload itu setara.

### 8.1 Namespace di Annotation

```java
@XmlRootElement(
    name = "application",
    namespace = "https://example.com/application/v1"
)
@XmlAccessorType(XmlAccessType.FIELD)
public class ApplicationXmlDto {

    @XmlElement(
        name = "applicationNo",
        namespace = "https://example.com/application/v1"
    )
    private String applicationNo;

    public ApplicationXmlDto() {}
}
```

### 8.2 Package-Level Namespace

Untuk menghindari repetitive namespace, gunakan `package-info.java`.

```java
@jakarta.xml.bind.annotation.XmlSchema(
    namespace = "https://example.com/application/v1",
    elementFormDefault = jakarta.xml.bind.annotation.XmlNsForm.QUALIFIED
)
package com.example.integration.application.xml.v1;
```

Dengan ini, element dalam package tersebut default qualified.

### 8.3 Namespace Versioning

Namespace sering dipakai untuk versioning:

```text
https://example.com/application/v1
https://example.com/application/v2
```

Tapi hati-hati: namespace versioning membuat payload v1 dan v2 menjadi contract berbeda. Jika perubahan hanya additive dan kompatibel, tidak selalu perlu namespace baru.

Prinsip:

- Namespace baru untuk breaking semantic/schema change.
- Field baru additive bisa tetap namespace lama jika consumer tolerant.
- Jangan menaikkan namespace hanya karena internal DTO berubah.

---

## 9. Jackson XML Mental Model

Jackson XML adalah extension dari Jackson untuk membaca/menulis XML encoded data. Repository FasterXML menyebut goal-nya sebagai emulasi JAXB-style data-binding dengan pendekatan code-first, bukan schema-first. Ia menyediakan `XmlParser`, `ToXmlGenerator`, `XmlFactory`, dan override yang membuat databind bekerja untuk XML. ([FasterXML jackson-dataformat-xml](https://github.com/FasterXML/jackson-dataformat-xml))

Mental model:

```text
XmlMapper = ObjectMapper + XML Factory + XML-specific annotations/features
```

Jika JSON:

```java
ObjectMapper mapper = new ObjectMapper();
```

XML:

```java
XmlMapper xmlMapper = new XmlMapper();
```

### 9.1 Dependency Maven

```xml
<dependency>
    <groupId>com.fasterxml.jackson.dataformat</groupId>
    <artifactId>jackson-dataformat-xml</artifactId>
    <version>2.17.2</version>
</dependency>
```

Gunakan versi sesuai BOM framework. Jika memakai Spring Boot, biasanya versi Jackson diatur oleh Spring Boot dependency management.

### 9.2 Basic Example

```java
import com.fasterxml.jackson.dataformat.xml.XmlMapper;
import com.fasterxml.jackson.dataformat.xml.annotation.JacksonXmlProperty;
import com.fasterxml.jackson.dataformat.xml.annotation.JacksonXmlRootElement;

@JacksonXmlRootElement(localName = "customer")
public class CustomerXmlDto {

    @JacksonXmlProperty(localName = "id", isAttribute = true)
    private String customerId;

    @JacksonXmlProperty(localName = "name")
    private String name;

    public CustomerXmlDto() {}

    public CustomerXmlDto(String customerId, String name) {
        this.customerId = customerId;
        this.name = name;
    }

    public String getCustomerId() { return customerId; }
    public void setCustomerId(String customerId) { this.customerId = customerId; }

    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
}

class JacksonXmlExample {
    public static void main(String[] args) throws Exception {
        XmlMapper mapper = new XmlMapper();

        CustomerXmlDto customer = new CustomerXmlDto("C001", "Fajar");
        String xml = mapper.writerWithDefaultPrettyPrinter().writeValueAsString(customer);

        System.out.println(xml);

        CustomerXmlDto parsed = mapper.readValue(xml, CustomerXmlDto.class);
        System.out.println(parsed.getCustomerId());
        System.out.println(parsed.getName());
    }
}
```

Output kira-kira:

```xml
<CustomerXmlDto id="C001">
  <name>Fajar</name>
</CustomerXmlDto>
```

Dengan `@JacksonXmlRootElement`, root name bisa menjadi `customer`.

---

## 10. Jackson XML Annotation Core

### 10.1 `@JacksonXmlRootElement`

```java
@JacksonXmlRootElement(localName = "application", namespace = "https://example.com/application/v1")
public class ApplicationXmlDto {
}
```

### 10.2 `@JacksonXmlProperty`

Untuk element atau attribute.

```java
@JacksonXmlProperty(localName = "id", isAttribute = true)
private String applicationId;

@JacksonXmlProperty(localName = "status")
private String status;
```

### 10.3 `@JacksonXmlElementWrapper`

Untuk collection wrapper.

```java
@JacksonXmlElementWrapper(localName = "documents")
@JacksonXmlProperty(localName = "document")
private List<DocumentXmlDto> documents;
```

### 10.4 `@JacksonXmlText`

Untuk text content.

```java
public class AmountXmlDto {

    @JacksonXmlProperty(localName = "currency", isAttribute = true)
    private String currency;

    @JacksonXmlText
    private String value;
}
```

Menghasilkan:

```xml
<amount currency="SGD">120.50</amount>
```

---

## 11. JAXB vs Jackson XML: Perbandingan Arsitektural

Tidak ada jawaban universal. Pilihan bergantung pada contract dan ekosistem.

| Dimensi | JAXB/Jakarta XML Binding | Jackson XML |
|---|---|---|
| Orientasi | XML-first / binding spec | Jackson ecosystem / code-first |
| Cocok untuk | XML contract formal, XSD, enterprise integration | Aplikasi yang sudah memakai Jackson luas |
| Annotation | `jakarta.xml.bind.annotation.*` | `com.fasterxml.jackson.dataformat.xml.annotation.*` |
| JSON compatibility | Tidak untuk JSON | Bisa satu mental model dengan Jackson JSON |
| Schema-first | Lebih natural dengan XSD tooling | Bukan fokus utama |
| ObjectMapper reuse | Tidak | Ya, konsep serupa ObjectMapper |
| Records/modern DTO | Bergantung support runtime dan style | Lebih dekat dengan Jackson databind modern |
| Namespace-heavy XML | Sangat cocok | Bisa, tetapi perlu disiplin annotation/config |
| Mixed content rumit | Bisa tetapi tetap kompleks | Bisa tetapi tidak selalu nyaman |
| Team familiarity | Enterprise Java lama | Spring/Jackson team modern |

### 11.1 Kapan Memilih Jakarta XML Binding

Pilih Jakarta XML Binding jika:

- contract XML sangat formal,
- ada XSD,
- partner menggunakan XML Schema validation,
- namespace/order/elementFormDefault penting,
- integrasi enterprise/SOAP-ish,
- ingin mengikuti standard Jakarta,
- ada generated classes dari schema,
- migrasi dari JAXB lama.

### 11.2 Kapan Memilih Jackson XML

Pilih Jackson XML jika:

- aplikasi sudah heavily menggunakan Jackson,
- ingin konfigurasi mirip JSON mapper,
- XML hanya format alternatif dari model DTO,
- tidak schema-first,
- butuh custom serializer/deserializer ala Jackson,
- ingin satu style testing dengan JSON payload,
- XML relatif sederhana.

### 11.3 Kapan Tidak Memilih Keduanya

Pilih StAX/manual parsing jika:

- file sangat besar,
- hanya perlu extract sebagian kecil data,
- mixed content kompleks,
- XML digital signature/canonicalization sensitif,
- performance/memory strict,
- binding object graph terlalu mahal,
- payload contract terlalu tidak konsisten.

---

## 12. XML DTO Design Principles

### 12.1 Jangan Pakai Domain Entity sebagai XML DTO

Buruk:

```java
@XmlRootElement(name = "application")
@Entity
public class Application {
    @Id
    private Long id;

    private String status;

    @OneToMany(mappedBy = "application")
    private List<Document> documents;
}
```

Masalah:

- persistence annotation tercampur contract XML,
- lazy loading bisa terpanggil saat marshalling,
- field internal bisa bocor,
- cyclic relationship,
- schema XML berubah saat entity berubah,
- audit/security risk.

Baik:

```java
@XmlRootElement(name = "application")
@XmlAccessorType(XmlAccessType.FIELD)
public class ApplicationSubmissionXmlDto {

    @XmlAttribute(name = "schemaVersion")
    private String schemaVersion;

    @XmlElement(name = "applicationNo")
    private String applicationNo;

    @XmlElement(name = "applicant")
    private ApplicantXmlDto applicant;

    @XmlElementWrapper(name = "documents")
    @XmlElement(name = "document")
    private List<DocumentXmlDto> documents;

    public ApplicationSubmissionXmlDto() {}
}
```

Kemudian gunakan mapper terpisah:

```java
public final class ApplicationXmlMapper {

    private ApplicationXmlMapper() {}

    public static ApplicationSubmissionXmlDto toXmlDto(Application application) {
        // explicit transformation
    }
}
```

### 12.2 XML DTO adalah Contract DTO

XML DTO harus dimiliki oleh integration boundary, bukan domain core.

Contoh package:

```text
com.example.application.integration.regulator.v1.xml
    ApplicationSubmissionXmlDto
    ApplicantXmlDto
    DocumentXmlDto
    package-info.java

com.example.application.integration.regulator.v1.mapper
    ApplicationSubmissionXmlMapper
```

Dengan begitu, jika regulator v2 muncul:

```text
com.example.application.integration.regulator.v2.xml
com.example.application.integration.regulator.v2.mapper
```

Tidak perlu mengubah domain model.

### 12.3 Bedakan XML Inbound dan XML Outbound DTO

Inbound XML:

```text
external XML -> inbound XML DTO -> command/normalized model -> domain
```

Outbound XML:

```text
domain/read model -> outbound XML DTO -> external XML
```

Jangan selalu pakai DTO yang sama untuk input dan output. XML inbound sering perlu lebih toleran; XML outbound harus lebih deterministik.

### 12.4 Jangan Campur JSON dan XML Annotation Jika Contract Berbeda

Kadang boleh membuat satu DTO dengan Jackson JSON dan Jackson XML annotation jika shape hampir sama.

Tetapi hati-hati:

```java
public class CustomerDto {
    @JsonProperty("customer_id")
    @JacksonXmlProperty(localName = "customerId")
    private String customerId;
}
```

Ini bisa membuat class menjadi sulit dimengerti.

Jika JSON dan XML contract punya shape berbeda, gunakan DTO terpisah:

```text
CustomerJsonResponse
CustomerXmlResponse
```

Mapper eksplisit menjaga semantic equivalence.

---

## 13. Attribute vs Element: Cara Memutuskan

Tidak ada aturan absolut, tetapi ada guideline.

### 13.1 Attribute Cocok Untuk Metadata Singkat

Contoh:

```xml
<document id="D001" type="PDF" version="1">
    <fileName>notice.pdf</fileName>
</document>
```

Attribute cocok untuk:

- identifier,
- type/discriminator,
- version,
- language,
- unit,
- reference code,
- flags sederhana.

### 13.2 Element Cocok Untuk Data Business

Contoh:

```xml
<document>
    <documentId>D001</documentId>
    <documentType>PDF</documentType>
    <fileName>notice.pdf</fileName>
    <description>Notice of assessment</description>
</document>
```

Element cocok untuk:

- data panjang,
- nested object,
- optional complex value,
- text yang mungkin mengandung whitespace,
- repeated values,
- values yang akan berevolusi.

### 13.3 Jangan Ubah Attribute Menjadi Element Tanpa Versioning

Breaking change:

```xml
<customer id="C001" />
```

menjadi:

```xml
<customer>
    <id>C001</id>
</customer>
```

Walaupun semantic sama, binding consumer bisa rusak.

---

## 14. Collection Mapping dan Wrapper Semantics

Collection adalah salah satu area XML mapping paling sering bermasalah.

### 14.1 Wrapped Collection

```xml
<documents>
    <document id="D001" />
    <document id="D002" />
</documents>
```

JAXB:

```java
@XmlElementWrapper(name = "documents")
@XmlElement(name = "document")
private List<DocumentXmlDto> documents;
```

Jackson XML:

```java
@JacksonXmlElementWrapper(localName = "documents")
@JacksonXmlProperty(localName = "document")
private List<DocumentXmlDto> documents;
```

### 14.2 Unwrapped Collection

```xml
<document id="D001" />
<document id="D002" />
```

Di dalam root:

```xml
<application>
    <document id="D001" />
    <document id="D002" />
</application>
```

JAXB:

```java
@XmlElement(name = "document")
private List<DocumentXmlDto> documents;
```

Jackson XML:

```java
@JacksonXmlElementWrapper(useWrapping = false)
@JacksonXmlProperty(localName = "document")
private List<DocumentXmlDto> documents;
```

### 14.3 Empty List vs Missing List

Tiga payload ini bisa berbeda secara contract:

```xml
<!-- missing -->
<application />
```

```xml
<!-- empty wrapper -->
<application>
    <documents />
</application>
```

```xml
<!-- explicit empty item? usually invalid/ambiguous -->
<application>
    <documents>
        <document />
    </documents>
</application>
```

Decision perlu eksplisit:

- missing berarti tidak dikirim?
- empty berarti dikirim tapi kosong?
- null dan empty list disamakan?
- XSD mengizinkan minOccurs=0 atau maxOccurs?

Untuk outbound enterprise XML, biasanya lebih baik deterministik:

- jika list wajib tapi kosong, emit empty wrapper jika contract mengizinkan;
- jika list optional dan kosong, omit;
- jangan biarkan default library menentukan tanpa test.

---

## 15. Date, Time, Number, Boolean dalam XML

XML semua tampak seperti text. Tipe sebenarnya datang dari schema atau binding rule.

### 15.1 Date/Time

Format yang umum:

```xml
<submittedAt>2026-06-17T10:15:30+07:00</submittedAt>
```

atau:

```xml
<submittedDate>2026-06-17</submittedDate>
```

Rekomendasi Java modern:

- `LocalDate` untuk tanggal tanpa waktu.
- `OffsetDateTime` untuk timestamp dengan offset.
- `Instant` untuk machine timestamp UTC.
- Hindari `java.util.Date` untuk DTO baru.

Namun, JAXB/Jakarta XML Binding support untuk Java time modern bisa membutuhkan adapter eksplisit tergantung stack.

Contoh adapter:

```java
import jakarta.xml.bind.annotation.adapters.XmlAdapter;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;

public class OffsetDateTimeXmlAdapter extends XmlAdapter<String, OffsetDateTime> {

    @Override
    public OffsetDateTime unmarshal(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        return OffsetDateTime.parse(value, DateTimeFormatter.ISO_OFFSET_DATE_TIME);
    }

    @Override
    public String marshal(OffsetDateTime value) {
        if (value == null) {
            return null;
        }
        return DateTimeFormatter.ISO_OFFSET_DATE_TIME.format(value);
    }
}
```

Usage:

```java
import jakarta.xml.bind.annotation.XmlElement;
import jakarta.xml.bind.annotation.adapters.XmlJavaTypeAdapter;
import java.time.OffsetDateTime;

public class SubmissionXmlDto {

    @XmlElement(name = "submittedAt")
    @XmlJavaTypeAdapter(OffsetDateTimeXmlAdapter.class)
    private OffsetDateTime submittedAt;

    public SubmissionXmlDto() {}
}
```

### 15.2 BigDecimal untuk Decimal Business

Untuk uang/amount/rate, gunakan `BigDecimal`, bukan `double`.

```java
@XmlElement(name = "amount")
private BigDecimal amount;
```

Hindari:

```java
private double amount;
```

Karena binary floating point bisa menyebabkan representasi tidak presisi.

### 15.3 Boolean

Pastikan format boolean disepakati:

```xml
<active>true</active>
```

vs

```xml
<active>Y</active>
```

Jika partner memakai `Y/N`, gunakan adapter/converter eksplisit.

```java
public class YesNoBooleanAdapter extends XmlAdapter<String, Boolean> {
    @Override
    public Boolean unmarshal(String value) {
        if (value == null) return null;
        return switch (value) {
            case "Y" -> true;
            case "N" -> false;
            default -> throw new IllegalArgumentException("Expected Y or N but got: " + value);
        };
    }

    @Override
    public String marshal(Boolean value) {
        if (value == null) return null;
        return value ? "Y" : "N";
    }
}
```

Untuk Java 8, ganti switch expression dengan switch statement biasa.

---

## 16. XML Binding dan Java Records

Java records sangat nyaman untuk JSON DTO modern, tetapi XML binding punya tantangan.

Record:

```java
public record CustomerXmlDto(String customerId, String name) {}
```

Masalah potensial:

- JAXB tradisional mengharapkan no-args constructor.
- Field final/immutable tidak selalu cocok dengan setter/property binding lama.
- Jakarta XML Binding support terhadap records bergantung versi implementation dan pattern.
- Jackson XML lebih dekat ke Jackson databind yang sudah mendukung constructor/record binding di versi modern.

Untuk XML contract formal, class mutable dengan no-args constructor masih sering lebih praktis.

Strategi realistis:

- Untuk internal JSON DTO modern: records sangat cocok.
- Untuk XML integration DTO enterprise: class explicit dengan annotation field sering lebih stabil.
- Jika ingin immutable XML DTO, validasi support framework melalui test, bukan asumsi.
- Jangan migrasi XML DTO legacy ke records tanpa compatibility suite.

---

## 17. JAXB/Jakarta XML Binding dengan Immutable Model

Jika ingin immutable-like DTO dengan JAXB, beberapa pendekatan:

1. Gunakan no-args constructor protected/private dan field access.
2. Gunakan package-private setter.
3. Gunakan adapter.
4. Gunakan separate mutable XML DTO lalu map ke immutable domain command.

Rekomendasi enterprise:

```text
XML binding DTO boleh mutable.
Domain command/model tetap immutable.
```

Contoh:

```java
@XmlAccessorType(XmlAccessType.FIELD)
@XmlRootElement(name = "application")
public class ApplicationInboundXmlDto {
    @XmlElement(name = "applicationNo")
    private String applicationNo;

    @XmlElement(name = "submittedAt")
    private String submittedAt;

    public ApplicationInboundXmlDto() {}

    public String getApplicationNo() { return applicationNo; }
    public String getSubmittedAt() { return submittedAt; }
}
```

Map ke command immutable:

```java
public record SubmitApplicationCommand(
    String applicationNo,
    OffsetDateTime submittedAt
) {}
```

Mapper:

```java
public final class ApplicationInboundXmlMapper {

    private ApplicationInboundXmlMapper() {}

    public static SubmitApplicationCommand toCommand(ApplicationInboundXmlDto xml) {
        return new SubmitApplicationCommand(
            normalizeApplicationNo(xml.getApplicationNo()),
            OffsetDateTime.parse(xml.getSubmittedAt())
        );
    }

    private static String normalizeApplicationNo(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("applicationNo is required");
        }
        return value.trim().toUpperCase();
    }
}
```

Ini lebih bersih daripada memaksa binding framework mengisi immutable domain object langsung.

---

## 18. XML Security Baseline

XML parsing punya attack surface spesifik, terutama XXE.

OWASP XML External Entity Prevention Cheat Sheet menyatakan cara paling aman mencegah XXE adalah men-disable DTD/external entities sepenuhnya jika tidak dibutuhkan. ([OWASP XXE Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/XML_External_Entity_Prevention_Cheat_Sheet.html))

### 18.1 Apa Itu XXE?

Contoh payload berbahaya:

```xml
<?xml version="1.0"?>
<!DOCTYPE data [
  <!ENTITY secret SYSTEM "file:///etc/passwd">
]>
<data>&secret;</data>
```

Jika parser memproses external entity, aplikasi bisa membaca file lokal atau melakukan request network internal.

### 18.2 Baseline Rule

Untuk XML dari untrusted source:

- disable DTD,
- disable external entity,
- disable external schema loading jika tidak perlu,
- batasi ukuran payload,
- batasi depth,
- gunakan timeout di layer IO,
- jangan log payload mentah penuh,
- validasi content setelah parsing.

### 18.3 Secure SAX/DOM Factory Example

Contoh untuk `DocumentBuilderFactory`:

```java
import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory;

public final class SecureXmlFactories {

    private SecureXmlFactories() {}

    public static DocumentBuilderFactory secureDocumentBuilderFactory() throws Exception {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();

        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
        factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
        factory.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);

        factory.setXIncludeAware(false);
        factory.setExpandEntityReferences(false);
        factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);

        return factory;
    }
}
```

Catatan: support feature bisa berbeda antar parser implementation. Test hardening di runtime target.

### 18.4 Secure StAX Factory Example

```java
import javax.xml.XMLConstants;
import javax.xml.stream.XMLInputFactory;

public final class SecureStaxFactory {

    private SecureStaxFactory() {}

    public static XMLInputFactory secureXmlInputFactory() {
        XMLInputFactory factory = XMLInputFactory.newFactory();
        factory.setProperty(XMLInputFactory.SUPPORT_DTD, false);
        factory.setProperty("javax.xml.stream.isSupportingExternalEntities", false);
        factory.setProperty(XMLConstants.ACCESS_EXTERNAL_DTD, "");
        factory.setProperty(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
        return factory;
    }
}
```

Untuk Jackson XML, hardening underlying XML factory/parser juga perlu diperhatikan, terutama jika mengonfigurasi `XmlFactory`/Woodstox/StAX.

---

## 19. XML Validation: Binding Tidak Sama dengan Validasi Contract

Unmarshaller yang berhasil belum tentu berarti payload valid secara business/schema.

Contoh:

```xml
<application>
    <applicationNo></applicationNo>
    <submittedAt>not-a-date</submittedAt>
</application>
```

Binding bisa saja menghasilkan object dengan empty string, lalu error baru muncul saat mapping semantic.

Ada beberapa level validasi:

1. Well-formed XML: struktur XML valid secara syntax.
2. Schema-valid XML: sesuai XSD.
3. Binding-valid object: bisa dibaca menjadi DTO.
4. Semantic-valid command: masuk akal untuk domain.
5. Business-valid operation: boleh dilakukan menurut state/rule.

Jangan campur semua menjadi satu.

Pipeline yang baik:

```text
raw XML
  -> secure parser
  -> optional XSD validation
  -> XML DTO binding
  -> semantic normalization
  -> command validation
  -> domain operation
```

### 19.1 XSD Validation dengan JAXB

```java
import jakarta.xml.bind.JAXBContext;
import jakarta.xml.bind.Unmarshaller;
import javax.xml.XMLConstants;
import javax.xml.validation.Schema;
import javax.xml.validation.SchemaFactory;
import java.io.File;

public class JaxbValidationExample {

    public Object readWithSchema(File xmlFile, File xsdFile) throws Exception {
        JAXBContext context = JAXBContext.newInstance(ApplicationInboundXmlDto.class);
        Unmarshaller unmarshaller = context.createUnmarshaller();

        SchemaFactory schemaFactory = SchemaFactory.newInstance(XMLConstants.W3C_XML_SCHEMA_NS_URI);
        schemaFactory.setProperty(XMLConstants.ACCESS_EXTERNAL_DTD, "");
        schemaFactory.setProperty(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");

        Schema schema = schemaFactory.newSchema(xsdFile);
        unmarshaller.setSchema(schema);

        return unmarshaller.unmarshal(xmlFile);
    }
}
```

Catatan package `javax.xml.validation` masih bagian Java XML standard; JAXB API modern ada di `jakarta.xml.bind`.

---

## 20. XML Declaration, Encoding, dan Output Determinism

XML sering perlu declaration:

```xml
<?xml version="1.0" encoding="UTF-8"?>
```

Beberapa partner mewajibkan:

- declaration ada/tidak ada,
- encoding tertentu,
- standalone yes/no,
- pretty print off,
- element order tertentu,
- namespace prefix tertentu.

### 20.1 JAXB Output Formatting

```java
Marshaller marshaller = context.createMarshaller();
marshaller.setProperty(Marshaller.JAXB_FORMATTED_OUTPUT, false);
marshaller.setProperty(Marshaller.JAXB_ENCODING, "UTF-8");
```

### 20.2 Jackson XML Pretty Print

```java
XmlMapper mapper = new XmlMapper();
String xml = mapper.writerWithDefaultPrettyPrinter().writeValueAsString(dto);
```

Untuk machine contract, pretty print sebaiknya bukan bagian semantic. Tetapi untuk digital signature/canonicalization, whitespace bisa menjadi sensitif jika tidak dikelola dengan benar.

---

## 21. XML Mapping dalam Spring Boot

Spring Boot umumnya memakai Jackson untuk JSON. Untuk XML response/request, Spring MVC bisa memakai XML message converter jika dependency tersedia.

Contoh dependency Jackson XML:

```xml
<dependency>
    <groupId>com.fasterxml.jackson.dataformat</groupId>
    <artifactId>jackson-dataformat-xml</artifactId>
</dependency>
```

Controller:

```java
@RestController
@RequestMapping("/api/customers")
public class CustomerController {

    @GetMapping(value = "/{id}", produces = "application/xml")
    public CustomerXmlDto getCustomerAsXml(@PathVariable String id) {
        return new CustomerXmlDto(id, "Fajar");
    }
}
```

Namun untuk enterprise integration, jangan terlalu bergantung pada auto-conversion controller jika XML contract kritikal.

Lebih aman:

```java
@PostMapping(
    value = "/submission",
    consumes = "application/xml",
    produces = "application/xml"
)
public ResponseEntity<String> submit(@RequestBody String rawXml) {
    // explicit secure parse + validation + bind + map + process + marshal response
}
```

Kenapa?

- Bisa harden parser.
- Bisa log redacted raw payload reference.
- Bisa schema validate.
- Bisa return error XML spesifik.
- Bisa kontrol marshalling output.
- Bisa preserve correlation id.

Untuk XML sederhana, converter otomatis bisa cukup. Untuk regulator/external partner critical flow, explicit pipeline lebih defensible.

---

## 22. XML Error Handling

Deserialization error XML harus diklasifikasikan.

Jenis error:

| Error | Contoh | Response |
|---|---|---|
| Not well-formed | tag tidak ditutup | reject as invalid XML |
| Unsafe XML | DOCTYPE/external entity | reject as unsafe XML |
| Schema invalid | required element missing | reject with schema field info |
| Binding invalid | date format gagal | reject with field path |
| Semantic invalid | status tidak dikenal | reject business validation |
| System error | parser config/runtime failure | internal error |

Jangan mengembalikan stack trace atau raw exception:

Buruk:

```xml
<error>jakarta.xml.bind.UnmarshalException: ...</error>
```

Lebih baik:

```xml
<error>
    <code>INVALID_XML_PAYLOAD</code>
    <message>The submitted XML payload is invalid.</message>
    <details>
        <detail>
            <path>/application/submittedAt</path>
            <reason>Expected ISO-8601 offset date-time.</reason>
        </detail>
    </details>
</error>
```

Untuk external API, error detail harus cukup membantu tetapi tidak membocorkan internal parser/framework.

---

## 23. Mapping XML ke Domain: Jangan Biarkan XML Shape Menular

Contoh XML:

```xml
<application schemaVersion="1.0">
    <application-no>A001</application-no>
    <applicant applicant-type="PERSON">
        <id>S1234567A</id>
        <name>Fajar</name>
    </applicant>
</application>
```

XML DTO:

```java
@XmlRootElement(name = "application")
@XmlAccessorType(XmlAccessType.FIELD)
public class ApplicationXmlDto {

    @XmlAttribute(name = "schemaVersion")
    private String schemaVersion;

    @XmlElement(name = "application-no")
    private String applicationNo;

    @XmlElement(name = "applicant")
    private ApplicantXmlDto applicant;

    public ApplicationXmlDto() {}

    public String getSchemaVersion() { return schemaVersion; }
    public String getApplicationNo() { return applicationNo; }
    public ApplicantXmlDto getApplicant() { return applicant; }
}
```

Applicant XML DTO:

```java
@XmlAccessorType(XmlAccessType.FIELD)
public class ApplicantXmlDto {

    @XmlAttribute(name = "applicant-type")
    private String applicantType;

    @XmlElement(name = "id")
    private String id;

    @XmlElement(name = "name")
    private String name;

    public ApplicantXmlDto() {}

    public String getApplicantType() { return applicantType; }
    public String getId() { return id; }
    public String getName() { return name; }
}
```

Domain command:

```java
public record SubmitApplicationCommand(
    String applicationNo,
    ApplicantCommand applicant
) {}

public record ApplicantCommand(
    ApplicantType type,
    String identityNo,
    String displayName
) {}

enum ApplicantType {
    PERSON,
    COMPANY
}
```

Mapper:

```java
public final class ApplicationXmlToCommandMapper {

    private ApplicationXmlToCommandMapper() {}

    public static SubmitApplicationCommand toCommand(ApplicationXmlDto xml) {
        if (xml == null) {
            throw new IllegalArgumentException("XML payload is required");
        }

        return new SubmitApplicationCommand(
            normalizeApplicationNo(xml.getApplicationNo()),
            toApplicant(xml.getApplicant())
        );
    }

    private static ApplicantCommand toApplicant(ApplicantXmlDto xml) {
        if (xml == null) {
            throw new IllegalArgumentException("applicant is required");
        }

        return new ApplicantCommand(
            parseApplicantType(xml.getApplicantType()),
            requireNonBlank(xml.getId(), "applicant.id"),
            normalizeName(xml.getName())
        );
    }

    private static ApplicantType parseApplicantType(String value) {
        String normalized = requireNonBlank(value, "applicant.applicant-type").trim().toUpperCase();
        try {
            return ApplicantType.valueOf(normalized);
        } catch (IllegalArgumentException ex) {
            throw new IllegalArgumentException("Unknown applicant type: " + value);
        }
    }

    private static String normalizeApplicationNo(String value) {
        return requireNonBlank(value, "application-no").trim().toUpperCase();
    }

    private static String normalizeName(String value) {
        return requireNonBlank(value, "applicant.name").trim();
    }

    private static String requireNonBlank(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(field + " is required");
        }
        return value;
    }
}
```

Catatan untuk Java 8: `String.isBlank()` tidak tersedia. Gunakan `value.trim().isEmpty()`.

Prinsipnya:

> XML DTO mengikuti bentuk XML. Domain command mengikuti bahasa domain. Mapper menerjemahkan keduanya.

---

## 24. XML Versioning Strategy

XML contract sering hidup lama. Versi harus dirancang sejak awal.

### 24.1 Version Attribute

```xml
<application schemaVersion="1.0">
    ...
</application>
```

Cocok untuk routing parser:

```java
switch (schemaVersion) {
    case "1.0" -> parseV1(xml);
    case "2.0" -> parseV2(xml);
    default -> rejectUnsupportedVersion(schemaVersion);
}
```

### 24.2 Namespace Version

```xml
<application xmlns="https://example.com/application/v1">
```

v2:

```xml
<application xmlns="https://example.com/application/v2">
```

Cocok untuk schema-level breaking change.

### 24.3 Endpoint/File-Type Version

```text
/submission/v1/application
/submission/v2/application
```

atau:

```text
APPLICATION_SUBMISSION_V1.xml
APPLICATION_SUBMISSION_V2.xml
```

### 24.4 Recommendation

Untuk integrasi serius:

- gunakan version attribute atau namespace secara eksplisit,
- pisahkan DTO package per versi,
- jangan satu DTO dipaksa support semua versi dengan annotation kompleks,
- buat compatibility test per versi,
- sediakan migration mapper jika perlu.

Package example:

```text
com.example.integration.regulator.application.v1.xml
com.example.integration.regulator.application.v2.xml
com.example.integration.regulator.application.mapper
```

---

## 25. Testing XML Mapping

Testing XML tidak boleh hanya `marshal lalu unmarshal`. Round-trip test bisa menipu karena library yang sama bisa menghasilkan dan membaca bentuk yang sama tetapi tidak sesuai contract partner.

### 25.1 Golden XML Test

Simpan payload contoh resmi:

```text
src/test/resources/contracts/regulator/application-submission-v1-valid.xml
```

Test:

```java
@Test
void shouldReadOfficialValidApplicationSubmissionXml() throws Exception {
    JAXBContext context = JAXBContext.newInstance(ApplicationXmlDto.class);
    Unmarshaller unmarshaller = context.createUnmarshaller();

    try (InputStream input = getClass().getResourceAsStream(
        "/contracts/regulator/application-submission-v1-valid.xml"
    )) {
        ApplicationXmlDto dto = (ApplicationXmlDto) unmarshaller.unmarshal(input);

        assertEquals("A001", dto.getApplicationNo());
        assertEquals("PERSON", dto.getApplicant().getApplicantType());
    }
}
```

### 25.2 Outbound XML Shape Test

Jangan hanya assert contains string. Parse dan compare structure jika whitespace tidak penting.

Tetapi jika order/namespace penting, assert secara spesifik.

Example with XMLUnit style pseudo:

```java
assertThat(actualXml)
    .and(expectedXml)
    .ignoreWhitespace()
    .areSimilar();
```

### 25.3 Negative Tests

Test payload:

- missing required element,
- unknown namespace,
- wrong date format,
- duplicated element,
- empty wrapper,
- invalid enum,
- unsafe DOCTYPE,
- very large payload,
- deeply nested payload.

### 25.4 Version Compatibility Tests

Untuk setiap versi:

```text
v1-valid-minimal.xml
v1-valid-full.xml
v1-invalid-missing-required.xml
v1-forward-compatible-extra-optional.xml
v2-valid-minimal.xml
v2-valid-full.xml
```

Test memastikan mapper v1 tidak diam-diam menerima v2 jika itu tidak diinginkan.

---

## 26. XML Mapping Failure Modes

### 26.1 Namespace Mismatch

Payload:

```xml
<application xmlns="https://example.com/application/v2">
```

DTO expecting:

```java
@XmlRootElement(namespace = "https://example.com/application/v1")
```

Hasil: gagal unmarshal atau field null tergantung parser/config.

Mitigasi:

- namespace test,
- explicit error handling,
- version routing.

### 26.2 Attribute/Element Mismatch

Expected:

```xml
<customer id="C001" />
```

Received:

```xml
<customer><id>C001</id></customer>
```

Mitigasi:

- contract tests,
- schema validation,
- adapter tolerant hanya jika memang disetujui.

### 26.3 Collection Wrapper Mismatch

Expected:

```xml
<documents><document /></documents>
```

Received:

```xml
<document />
```

Mitigasi:

- explicit wrapper annotation,
- golden payload tests,
- avoid relying on default.

### 26.4 Silent Null Field

Parser berhasil, tetapi field null karena element name salah.

Ini berbahaya:

```java
if (dto.getApplicationNo() == null) {
    // maybe later NPE
}
```

Mitigasi:

- semantic validation setelah binding,
- fail-fast mapper,
- schema validation.

### 26.5 Order Error

XSD sequence mengharuskan:

```xml
<applicationNo />
<applicant />
<documents />
```

Tetapi output:

```xml
<documents />
<applicationNo />
<applicant />
```

Mitigasi:

- `@XmlType(propOrder = ...)`,
- output contract test.

### 26.6 XXE / Unsafe Parser

Mitigasi:

- disable DTD/external entity,
- secure factory,
- security negative test.

---

## 27. Design Pattern: XML Anti-Corruption Layer

Untuk integrasi eksternal, gunakan anti-corruption layer.

```text
External XML Contract
        ↓
XML DTO package v1
        ↓
XML parser/binder
        ↓
XML-to-command mapper
        ↓
Application service
        ↓
Domain model
```

Outbound:

```text
Domain/read model
        ↓
Outbound projection
        ↓
Projection-to-XML mapper
        ↓
XML DTO package v1
        ↓
XML marshaller
        ↓
External partner
```

Keuntungan:

- external weirdness tidak mencemari domain,
- versioning lebih bersih,
- migration lebih aman,
- test boundary lebih jelas,
- security hardening terlokalisir,
- audit/replay payload lebih mudah.

---

## 28. Practical Architecture Example

Struktur package:

```text
com.example.caseapp
  casecore
    domain
      Case.java
      Applicant.java
      Document.java
    application
      SubmitCaseCommand.java
      SubmitCaseUseCase.java

  integration
    regulator
      v1
        xml
          package-info.java
          CaseSubmissionXml.java
          ApplicantXml.java
          DocumentXml.java
          AmountXml.java
        mapper
          CaseSubmissionXmlMapper.java
        codec
          RegulatorV1XmlCodec.java
        validation
          RegulatorV1XmlSchemaValidator.java
```

Codec:

```java
public final class RegulatorV1XmlCodec {

    private final JAXBContext context;

    public RegulatorV1XmlCodec() {
        try {
            this.context = JAXBContext.newInstance(CaseSubmissionXml.class);
        } catch (Exception ex) {
            throw new IllegalStateException("Failed to initialize XML binding context", ex);
        }
    }

    public CaseSubmissionXml read(InputStream inputStream) {
        try {
            Unmarshaller unmarshaller = context.createUnmarshaller();
            return (CaseSubmissionXml) unmarshaller.unmarshal(inputStream);
        } catch (Exception ex) {
            throw new InvalidXmlPayloadException("Failed to parse case submission XML", ex);
        }
    }

    public String write(CaseSubmissionXml dto) {
        try {
            Marshaller marshaller = context.createMarshaller();
            marshaller.setProperty(Marshaller.JAXB_ENCODING, "UTF-8");
            marshaller.setProperty(Marshaller.JAXB_FORMATTED_OUTPUT, false);

            StringWriter writer = new StringWriter();
            marshaller.marshal(dto, writer);
            return writer.toString();
        } catch (Exception ex) {
            throw new XmlGenerationException("Failed to generate case submission XML", ex);
        }
    }
}
```

Custom exceptions:

```java
public class InvalidXmlPayloadException extends RuntimeException {
    public InvalidXmlPayloadException(String message, Throwable cause) {
        super(message, cause);
    }
}

public class XmlGenerationException extends RuntimeException {
    public XmlGenerationException(String message, Throwable cause) {
        super(message, cause);
    }
}
```

Use case adapter:

```java
public class RegulatorCaseSubmissionAdapter {

    private final RegulatorV1XmlCodec codec;
    private final SubmitCaseUseCase submitCaseUseCase;

    public RegulatorCaseSubmissionAdapter(
        RegulatorV1XmlCodec codec,
        SubmitCaseUseCase submitCaseUseCase
    ) {
        this.codec = codec;
        this.submitCaseUseCase = submitCaseUseCase;
    }

    public void submit(InputStream xmlInput) {
        CaseSubmissionXml xmlDto = codec.read(xmlInput);
        SubmitCaseCommand command = CaseSubmissionXmlMapper.toCommand(xmlDto);
        submitCaseUseCase.submit(command);
    }
}
```

---

## 29. Checklist Memilih JAXB/Jakarta XML Binding vs Jackson XML

Gunakan pertanyaan berikut.

### 29.1 Contract

- Apakah ada XSD resmi?
- Apakah element order harus sesuai schema?
- Apakah namespace kompleks?
- Apakah partner memakai SOAP/WSDL-ish contract?
- Apakah XML adalah primary contract, bukan format tambahan?

Jika banyak “ya”, condong ke Jakarta XML Binding.

### 29.2 Ecosystem

- Apakah aplikasi sudah memakai Jackson intensif?
- Apakah XML contract sederhana?
- Apakah DTO juga dipakai untuk JSON?
- Apakah custom serializer/deserializer Jackson diperlukan?
- Apakah Spring HTTP converter menjadi jalur utama?

Jika banyak “ya”, Jackson XML bisa lebih praktis.

### 29.3 Performance

- Apakah file XML sangat besar?
- Apakah hanya perlu extract sebagian data?
- Apakah memory limit ketat?
- Apakah throughput tinggi?

Jika banyak “ya”, pertimbangkan StAX/manual parsing.

### 29.4 Security

- Apakah XML datang dari external untrusted party?
- Apakah payload bisa mengandung DOCTYPE?
- Apakah parser hardening bisa dikontrol?
- Apakah logging payload aman?

Jika banyak “ya”, explicit XML pipeline lebih baik daripada auto-binding transparan.

---

## 30. XML Mapping Review Checklist

Gunakan checklist ini saat code review.

### Contract Shape

- Root element explicit.
- Namespace explicit.
- Attribute vs element sesuai contract.
- Collection wrapper explicit.
- Element order explicit jika schema sequence penting.
- Date/time format explicit.
- Decimal memakai `BigDecimal`.
- Empty vs missing behavior ditentukan.

### Architecture

- XML DTO tidak sama dengan JPA entity.
- XML DTO tidak mencemari domain.
- Mapper boundary eksplisit.
- Version package jelas.
- Inbound dan outbound DTO dipisah jika semantic berbeda.

### Security

- DTD/external entity disabled untuk untrusted XML.
- Payload size/depth dibatasi di layer yang sesuai.
- Error message tidak leak stack trace.
- Raw payload logging redacted atau controlled.
- XML parser configuration tested.

### Testing

- Golden XML test ada.
- Negative XML test ada.
- Namespace mismatch test ada.
- Wrapper/list test ada.
- Date/number/enum test ada.
- Version compatibility test ada.

### Operations

- Parse failure punya error code.
- Correlation id tersedia.
- Failed payload bisa direplay secara aman jika diperlukan.
- Metrics parse success/failure tersedia.
- Partner contract sample disimpan dan versioned.

---

## 31. Common Anti-Patterns

### 31.1 “XML Sama Saja dengan JSON”

Salah. XML punya namespace, attribute, order, wrapper, mixed content, schema, dan security risks khusus.

### 31.2 “Pakai Entity Langsung Aja”

Ini menyebabkan lazy loading, data leakage, tight coupling, dan contract drift.

### 31.3 “Annotation Semua di Satu DTO Universal”

Satu class diberi JSON, XML, validation, persistence, Lombok, OpenAPI, dan business annotation sekaligus.

Akibat:

- class sulit dipahami,
- perubahan satu boundary merusak boundary lain,
- annotation interaction tidak jelas,
- test menjadi rapuh.

### 31.4 “Rely on Default Wrapper”

Default wrapper antar library/versi bisa mengejutkan. Untuk XML, collection wrapper harus eksplisit.

### 31.5 “No Golden Payload Test”

Tanpa golden payload test, output XML bisa berubah karena refactor field/order/annotation/library upgrade.

### 31.6 “Unmarshal Success = Valid”

Tidak. Unmarshal success hanya berarti binding berhasil. Belum tentu schema-valid, semantic-valid, atau business-valid.

### 31.7 “Enable External Entities Karena Butuh Fitur”

Sangat berbahaya jika XML tidak trusted. Jika benar-benar butuh DTD/entity, isolasi, whitelist, dan threat model harus eksplisit.

---

## 32. Decision Matrix Ringkas

| Scenario | Pilihan Utama | Alasan |
|---|---|---|
| XML dengan XSD resmi dan namespace kompleks | Jakarta XML Binding | Spec-oriented dan XML-first |
| REST endpoint mendukung JSON dan XML sederhana | Jackson XML | Konsisten dengan Jackson/Spring |
| File XML 5GB, hanya extract beberapa field | StAX | Memory-safe streaming |
| SOAP legacy generated classes | JAXB/Jakarta XML Binding | Schema/WSDL ecosystem |
| XML signed document | Manual/StAX + canonicalization-aware library | Binding bisa mengubah bentuk sensitif |
| Internal XML config sederhana | Jackson XML atau JAXB | Pilih yang team kuasai |
| Regulatory submission versioned | Jakarta XML Binding + explicit version packages | Contract defensibility |
| High-throughput XML ingestion | StAX or carefully benchmarked binding | Allocation control |

---

## 33. Mini Exercise

Bayangkan external regulator mengirim XML berikut:

```xml
<caseSubmission xmlns="https://regulator.example/case/v1" schemaVersion="1.0">
    <caseNo>C-2026-001</caseNo>
    <submittedAt>2026-06-17T10:15:30+07:00</submittedAt>
    <applicant type="PERSON">
        <identityNo>S1234567A</identityNo>
        <name>Fajar Abdi</name>
    </applicant>
    <documents>
        <document id="D001" type="PDF">
            <fileName>notice.pdf</fileName>
            <size unit="bytes">102400</size>
        </document>
    </documents>
</caseSubmission>
```

Tentukan:

1. Apakah `schemaVersion` attribute atau element? Kenapa?
2. Apakah `documents` harus wrapper? Kenapa?
3. Apakah `size unit="bytes"` lebih baik attribute+text atau dua element?
4. Apakah DTO inbound boleh sama dengan domain command?
5. Di mana validasi `submittedAt` dilakukan?
6. Bagaimana jika regulator mengirim namespace v2?
7. Bagaimana test agar wrapper tidak berubah tanpa sadar?
8. Bagaimana mencegah XXE?

Jawaban ideal:

1. Attribute masuk akal karena metadata contract.
2. Ya, wrapper memperjelas collection boundary dan lebih stabil untuk schema.
3. Attribute+text masuk akal untuk value with unit sederhana; kalau amount/size punya banyak metadata, object element lebih baik.
4. Tidak. XML DTO mengikuti contract eksternal; command mengikuti domain/application language.
5. Parsing format bisa di mapper/adapter; semantic validation di application/domain boundary.
6. Reject atau route ke parser v2; jangan diam-diam treat as v1.
7. Golden XML output test dan schema validation.
8. Secure parser: disable DTD/external entities, size/depth control.

---

## 34. Ringkasan Mental Model

XML mapping modern Java harus dipahami sebagai desain boundary.

Poin utama:

1. XML bukan JSON dengan tag; XML punya model data sendiri.
2. Attribute, element, namespace, wrapper, dan order adalah bagian dari contract.
3. Java 8 legacy JAXB berbeda dari Java 11+ dan Java 25 world; dependency XML binding harus eksplisit.
4. Jakarta XML Binding cocok untuk XML-first/schema-heavy integration.
5. Jackson XML cocok jika aplikasi sudah Jackson-centric dan XML relatif sederhana/code-first.
6. StAX/manual parsing lebih tepat untuk XML besar, partial parsing, atau dokumen sensitif.
7. XML DTO jangan dicampur dengan JPA entity/domain object.
8. Binding success bukan validation success.
9. Security XML harus aktif: XXE prevention bukan optional untuk untrusted XML.
10. Golden payload tests adalah wajib untuk contract XML serius.

---

## 35. Hubungan dengan Part Berikutnya

Part ini membangun fondasi XML mapping modern Java.

Part berikutnya akan masuk lebih dalam ke XML edge cases:

- namespace URI vs prefix,
- XSD sequence,
- optional vs empty element,
- whitespace,
- canonical XML,
- digital signature sensitivity,
- SOAP-ish envelope,
- partial XML parsing,
- XML external entity safety,
- dan compatibility tests untuk XML yang benar-benar strict.

Dengan kata lain, Part 16 menjawab:

> “Bagaimana memilih dan memakai XML binding di Java modern?”

Part 17 akan menjawab:

> “Kenapa XML integration sering rusak walaupun mapper terlihat benar?”

---

## Referensi

- Jakarta XML Binding 4.0 Specification — https://jakarta.ee/specifications/xml-binding/4.0/
- FasterXML Jackson XML Dataformat — https://github.com/FasterXML/jackson-dataformat-xml
- Oracle JDK 11 Migration Guide — https://docs.oracle.com/en/java/javase/11/migrate/index.html
- OWASP XML External Entity Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/XML_External_Entity_Prevention_Cheat_Sheet.html

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 15 — JSON Schema, OpenAPI, and Runtime Contract Alignment](./15-json-schema-openapi-runtime-contract-alignment.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 17 — XML Edge Cases: Namespace, XSD, SOAP-ish Payloads, Canonicalization](./17-xml-edge-cases-namespace-xsd-soapish-payloads-canonicalization.md)
