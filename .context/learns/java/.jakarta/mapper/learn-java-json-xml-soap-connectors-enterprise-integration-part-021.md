# learn-java-json-xml-soap-connectors-enterprise-integration — Part 21
# JAXB Runtime, Performance & Migration

> Seri: Java (Jakarta/Javax) JSON, JSON Processing, JSON Binding, XML, XML Binding, XML Web Services, SOAP Legacy, dan Connectors  
> Part: 21 dari 34  
> Target: Java 8 sampai Java 25  
> Fokus: runtime behavior, performance model, dependency strategy, classloader/JPMS, javax→jakarta migration, Java 11+ removal impact, observability, dan migration checklist untuk JAXB/Jakarta XML Binding.

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas:

- JAXB core: `JAXBContext`, `Marshaller`, `Unmarshaller`.
- annotation: `@XmlRootElement`, `@XmlType`, `@XmlElement`, namespace, wrapper, attribute.
- schema-first workflow: XSD → Java via XJC.
- code-first workflow: Java → XSD dan risiko contract drift.
- advanced mapping: `JAXBElement`, `ObjectFactory`, adapter, polymorphism, wildcard, mixed content, nillable vs absent.

Bagian ini naik ke level **runtime engineering**.

Masalah besar JAXB di production jarang sekadar “annotation salah”. Masalah besarnya biasanya seperti ini:

1. aplikasi lambat karena membuat `JAXBContext` berulang-ulang;
2. memory naik karena context/cache/classloader leak;
3. bug concurrency karena `Marshaller` atau `Unmarshaller` dibagi antar thread;
4. aplikasi Java 8 jalan, tetapi gagal di Java 11+ karena JAXB tidak lagi ada di JDK;
5. library `javax.xml.bind.*` dicampur dengan `jakarta.xml.bind.*`;
6. generated code lama tidak cocok dengan runtime baru;
7. module path/JPMS membuat reflective access gagal;
8. container Jakarta EE 10/11 menyediakan API berbeda dari aplikasi;
9. native-image gagal karena JAXB butuh reflection metadata;
10. parser XML aman, tetapi JAXB layer diam-diam menerima dokumen terlalu besar, terlalu dalam, atau terlalu mahal diproses.

Mental model penting:

> JAXB bukan hanya mapping API. JAXB adalah runtime binding engine yang melakukan introspection, metadata discovery, XML parsing/writing, object construction, type resolution, namespace resolution, validation integration, dan conversion. Karena itu, desain runtime-nya harus diperlakukan seperti desain subsystem, bukan helper utility.

---

## 1. Posisi JAXB Runtime dalam Arsitektur Java Modern

### 1.1 JAXB sebagai boundary layer

Dalam sistem enterprise, JAXB biasanya muncul pada boundary berikut:

```text
External XML / SOAP / File / Queue
        |
        v
XML Parser / StAX / SAX / DOM
        |
        v
JAXB Unmarshaller
        |
        v
Generated DTO / XML Contract Model
        |
        v
Anti-corruption Mapper
        |
        v
Domain / Application Service
```

Sebaliknya saat keluar:

```text
Domain / Application Service
        |
        v
Boundary Response Model
        |
        v
JAXB Marshaller
        |
        v
XML Writer / Stream / SOAP Body / File
        |
        v
External System
```

Jadi JAXB seharusnya ditempatkan di **edge** sistem, bukan di seluruh domain internal.

Desain yang baik:

```text
XML contract model != domain model != persistence entity
```

Desain yang buruk:

```text
XML element = domain object = database entity = API response = UI model
```

Jika semua disatukan, setiap perubahan XSD dari partner bisa merusak domain, DB, validation, REST API, dan UI sekaligus.

---

## 2. Java 8 sampai Java 25: Evolusi Besar yang Wajib Dipahami

### 2.1 Java 8: JAXB terasa seperti bagian dari JDK

Pada Java 8, banyak aplikasi bisa memakai:

```java
import javax.xml.bind.JAXBContext;
import javax.xml.bind.Marshaller;
import javax.xml.bind.Unmarshaller;
```

tanpa menambahkan dependency eksplisit di `pom.xml`.

Ini membuat banyak aplikasi legacy punya asumsi tersembunyi:

> “JAXB selalu ada di Java.”

Asumsi ini salah untuk Java modern.

### 2.2 Java 9 dan 10: deprecated for removal

Di era Java 9 modularization, beberapa modul Java EE/CORBA masih ada, tetapi sudah deprecated for removal. Ini adalah warning bahwa API tersebut tidak lagi dianggap bagian natural dari Java SE.

### 2.3 Java 11+: JAXB dihapus dari JDK

Sejak Java 11, modul seperti:

- `java.xml.bind` / JAXB,
- `java.xml.ws` / JAX-WS,
- `java.activation`,
- `java.xml.ws.annotation`,
- CORBA-related modules,

sudah dihapus dari JDK sebagai bagian dari JEP 320.

Konsekuensinya:

```text
Java 8 application:
  compile OK, runtime OK tanpa dependency JAXB eksplisit

Java 11+ application:
  compile gagal atau runtime gagal kecuali API + implementation JAXB ditambahkan eksplisit
```

Error umum:

```text
java.lang.NoClassDefFoundError: javax/xml/bind/JAXBContext
```

atau:

```text
javax.xml.bind.JAXBException: Implementation of JAXB-API has not been found
```

atau untuk Jakarta namespace:

```text
jakarta.xml.bind.JAXBException: Implementation of Jakarta XML Binding-API has not been found
```

### 2.4 Java 17, 21, 25: JAXB tetap eksternal

Di Java LTS modern seperti 17 dan 21, serta Java 25, prinsipnya sama:

- JDK menyediakan XML processing core seperti DOM/SAX/StAX/XPath/XSLT di module `java.xml`.
- JAXB/XML Binding bukan bagian dari Java SE.
- Aplikasi harus membawa dependency API + runtime sendiri, atau mendapatkannya dari Jakarta EE container yang sesuai.

### 2.5 Javax vs Jakarta namespace

Ada dua dunia besar:

```text
Legacy JAXB / Java EE era:
  javax.xml.bind.*

Jakarta XML Binding modern:
  jakarta.xml.bind.*
```

Keduanya bukan sekadar rename import. Mereka adalah artifact/API line yang berbeda.

Implikasinya:

- class generated dengan `javax.xml.bind.annotation.*` tidak otomatis cocok dengan runtime `jakarta.xml.bind.*`;
- dependency `jakarta.xml.bind-api` tidak menyelesaikan kode yang masih import `javax.xml.bind.*`;
- dependency `jaxb-api` lama tidak menyelesaikan kode yang sudah import `jakarta.xml.bind.*`;
- migration harus konsisten di source, generated code, binding file, plugin, runtime, dan container.

---

## 3. Dependency Strategy: API, Runtime, Tooling

### 3.1 Tiga jenis dependency JAXB

Banyak engineer mencampur tiga hal ini:

| Jenis | Fungsi | Contoh |
|---|---|---|
| API | interface/classes yang dipakai compile-time | `jakarta.xml.bind-api` atau `jaxb-api` lama |
| Runtime/implementation | engine yang benar-benar melakukan marshalling/unmarshalling | Eclipse JAXB RI / GlassFish JAXB runtime |
| Tooling | XJC/JXC untuk generate source atau schema | `jaxb-xjc`, Maven plugin |

API saja tidak cukup.

Jika hanya punya API:

```xml
<dependency>
  <groupId>jakarta.xml.bind</groupId>
  <artifactId>jakarta.xml.bind-api</artifactId>
</dependency>
```

maka compile bisa sukses, tetapi runtime bisa gagal karena tidak ada implementation.

### 3.2 Dependency untuk Jakarta namespace modern

Untuk Java 11+ dan kode `jakarta.xml.bind.*`, pola umumnya:

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

Versi dapat berubah sesuai BOM/platform yang dipakai. Prinsipnya: **API dan implementation harus satu generasi namespace**.

### 3.3 Dependency untuk legacy javax namespace

Untuk aplikasi yang masih memakai `javax.xml.bind.*`, jangan asal mengganti dependency ke Jakarta 4.x.

Pola legacy Java 11+ biasanya memakai JAXB 2.3.x line:

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

Dalam aplikasi lama, mungkin juga butuh activation dependency, tergantung runtime dan tipe data yang digunakan.

### 3.4 Rule praktis dependency

Gunakan rule ini:

```text
Jika source/generated code import javax.xml.bind.*:
  gunakan JAXB 2.x / javax-era artifacts.

Jika source/generated code import jakarta.xml.bind.*:
  gunakan Jakarta XML Binding 3.x/4.x artifacts.

Jangan campur javax-generated classes dengan jakarta runtime.
Jangan campur jakarta annotations dengan javax runtime.
```

---

## 4. JAXBContext: Objek Paling Mahal dan Paling Penting

### 4.1 Apa itu JAXBContext?

`JAXBContext` adalah metadata registry untuk sekumpulan class binding.

Ia mengetahui:

- class mana yang bisa dimarshal/unmarshal;
- root element name;
- namespace mapping;
- type mapping;
- adapter;
- factory method;
- `ObjectFactory`;
- package-level annotation;
- generated schema metadata;
- inheritance/polymorphic relation;
- binding customization hasil XJC.

Membuat `JAXBContext` bukan operasi murah.

Saat membuat context, runtime bisa melakukan:

- classpath scanning package tertentu;
- reflective introspection;
- annotation parsing;
- model construction;
- accessor generation/optimization;
- mapping table creation;
- provider lookup.

### 4.2 Anti-pattern: membuat JAXBContext per request

Buruk:

```java
public CustomerRequest parse(InputStream input) throws Exception {
    JAXBContext context = JAXBContext.newInstance(CustomerRequest.class);
    Unmarshaller unmarshaller = context.createUnmarshaller();
    return (CustomerRequest) unmarshaller.unmarshal(input);
}
```

Kenapa buruk?

- latency request naik;
- CPU terbuang untuk introspection berulang;
- allocation rate tinggi;
- GC pressure naik;
- class metadata/cache internal bisa membesar;
- throughput turun drastis pada traffic tinggi.

### 4.3 Pattern: cache JAXBContext, buat marshaller/unmarshaller per operation

Baik:

```java
public final class XmlBindingSupport {

    private static final JAXBContext CUSTOMER_CONTEXT = createContext(CustomerRequest.class, CustomerResponse.class);

    private XmlBindingSupport() {
    }

    private static JAXBContext createContext(Class<?>... types) {
        try {
            return JAXBContext.newInstance(types);
        } catch (JAXBException e) {
            throw new ExceptionInInitializerError(e);
        }
    }

    public static CustomerRequest unmarshalCustomer(InputStream input) {
        try {
            Unmarshaller unmarshaller = CUSTOMER_CONTEXT.createUnmarshaller();
            Object result = unmarshaller.unmarshal(input);
            return (CustomerRequest) result;
        } catch (JAXBException e) {
            throw new XmlBindingException("Failed to unmarshal CustomerRequest", e);
        }
    }

    public static void marshalCustomer(CustomerResponse response, OutputStream output) {
        try {
            Marshaller marshaller = CUSTOMER_CONTEXT.createMarshaller();
            marshaller.setProperty(Marshaller.JAXB_FORMATTED_OUTPUT, Boolean.FALSE);
            marshaller.marshal(response, output);
        } catch (JAXBException e) {
            throw new XmlBindingException("Failed to marshal CustomerResponse", e);
        }
    }
}
```

Prinsip:

```text
JAXBContext: expensive, cache/reuse.
Marshaller: cheaper, not thread-safe, create per operation or pool carefully.
Unmarshaller: cheaper, not thread-safe, create per operation or pool carefully.
```

### 4.4 Context granularity

Jangan selalu membuat satu context global untuk seluruh aplikasi.

Ada beberapa opsi:

#### Opsi A — satu context per bounded integration

```text
PartnerAContext
PartnerBContext
InternalReportContext
LegacySoapContext
```

Cocok untuk sistem enterprise karena tiap partner biasanya punya XSD sendiri.

#### Opsi B — satu context untuk semua class

Kelebihan:

- mudah;
- satu tempat;
- cocok untuk aplikasi kecil.

Kekurangan:

- startup lebih mahal;
- memory metadata besar;
- classloader leak risk lebih besar;
- perubahan satu kontrak bisa mempengaruhi context besar;
- sulit isolasi dependency/generated package.

#### Opsi C — context per request

Hampir selalu buruk, kecuali untuk tool CLI sekali jalan atau prototyping.

### 4.5 Context key design

Jika context dibuat dinamis, cache key harus jelas.

Buruk:

```java
Map<String, JAXBContext> cache = new ConcurrentHashMap<>();
```

Baik:

```java
public record JaxbContextKey(
    String integrationName,
    String contractVersion,
    List<String> packageNames
) {}
```

Kenapa?

Karena satu aplikasi bisa punya beberapa versi kontrak XML aktif sekaligus.

```text
partner-a/v1 -> package com.acme.partnera.v1
partner-a/v2 -> package com.acme.partnera.v2
partner-b/v1 -> package com.acme.partnerb.v1
```

---

## 5. Thread-Safety Model

### 5.1 Rule utama

Dalam Eclipse JAXB RI, `JAXBContext` dianggap thread-safe, tetapi `Marshaller`, `Unmarshaller`, dan validator tidak thread-safe. Spesifikasi sendiri tidak menjamin semua detail thread-safety runtime classes, sehingga engineering rule paling aman adalah:

```text
Share JAXBContext.
Do not share Marshaller.
Do not share Unmarshaller.
Do not share mutable adapters unless explicitly safe.
```

### 5.2 Anti-pattern: static shared unmarshaller

Buruk:

```java
public final class BadXmlParser {
    private static final JAXBContext CONTEXT = ...;
    private static final Unmarshaller UNMARSHALLER = CONTEXT.createUnmarshaller();

    public Object parse(InputStream input) throws JAXBException {
        return UNMARSHALLER.unmarshal(input);
    }
}
```

Risiko:

- corrupted internal state;
- intermittent bug;
- wrong adapter state;
- validation handler bentrok;
- property berubah antar request;
- race condition sulit direproduksi.

### 5.3 Pattern create per operation

Paling aman:

```java
public Object parse(InputStream input) throws JAXBException {
    Unmarshaller unmarshaller = context.createUnmarshaller();
    return unmarshaller.unmarshal(input);
}
```

Ini biasanya cukup cepat karena objek mahalnya adalah `JAXBContext`, bukan `Unmarshaller`.

### 5.4 Pattern ThreadLocal — hati-hati

Kadang orang menggunakan:

```java
private final ThreadLocal<Unmarshaller> unmarshallers =
    ThreadLocal.withInitial(() -> createUnmarshaller(context));
```

Ini bisa mengurangi allocation, tetapi ada risiko:

- thread pool panjang umur membuat object hidup terus;
- property/handler/adapters bisa bocor antar request jika tidak reset;
- classloader leak di container redeploy;
- memory bertambah sesuai jumlah thread;
- dangerous jika request-specific validation handler dipasang.

Gunakan ThreadLocal hanya jika:

- sudah diukur bahwa create `Unmarshaller` menjadi bottleneck;
- lifecycle thread jelas;
- reset property/handler/adapters dijamin;
- ada cleanup saat shutdown/redeploy.

Untuk sebagian besar service modern, create per operation lebih defensible.

### 5.5 Object pool — juga hati-hati

Pool bisa terlihat menarik:

```text
MarshallerPool
UnmarshallerPool
```

Tapi pool membawa masalah:

- object harus di-reset penuh;
- exception path harus mengembalikan object;
- validation handler tidak boleh tertinggal;
- attachment marshaller/unmarshaller harus dibersihkan;
- schema/property harus konsisten;
- pool contention bisa lebih mahal daripada membuat baru.

Rule:

> Pool JAXB marshaller/unmarshaller hanya setelah profiling membuktikan perlu.

---

## 6. Secure Runtime: JAXB Tidak Menghapus Kewajiban XML Parser Hardening

### 6.1 Unmarshal dari InputStream bukan berarti aman

Kode seperti ini terlihat sederhana:

```java
Unmarshaller unmarshaller = context.createUnmarshaller();
Customer customer = (Customer) unmarshaller.unmarshal(inputStream);
```

Tetapi runtime tetap memproses XML.

Risiko:

- XXE;
- entity expansion;
- dokumen terlalu besar;
- nesting terlalu dalam;
- external schema access;
- expensive validation;
- unbounded collection;
- unexpected type via `xsi:type`;
- namespace spoofing;
- logging sensitive XML saat error.

### 6.2 Lebih aman: parse dengan StAX hardened lalu unmarshal dari XMLStreamReader

Pattern:

```java
public final class SecureJaxbReader {

    private final JAXBContext context;
    private final XMLInputFactory inputFactory;

    public SecureJaxbReader(JAXBContext context) {
        this.context = context;
        this.inputFactory = secureXmlInputFactory();
    }

    public <T> T read(InputStream input, Class<T> type) {
        try {
            XMLStreamReader reader = inputFactory.createXMLStreamReader(input);
            Unmarshaller unmarshaller = context.createUnmarshaller();
            JAXBElement<T> element = unmarshaller.unmarshal(reader, type);
            return element.getValue();
        } catch (XMLStreamException | JAXBException e) {
            throw new XmlBindingException("Failed to read XML", e);
        }
    }

    private static XMLInputFactory secureXmlInputFactory() {
        XMLInputFactory factory = XMLInputFactory.newFactory();
        factory.setProperty(XMLInputFactory.SUPPORT_DTD, Boolean.FALSE);
        factory.setProperty("javax.xml.stream.isSupportingExternalEntities", Boolean.FALSE);
        return factory;
    }
}
```

Catatan:

- property support bisa berbeda antar provider;
- test security config dengan malicious fixture;
- jangan hanya percaya konfigurasi default.

### 6.3 Schema validation harus bounded

Menambahkan schema:

```java
SchemaFactory schemaFactory = SchemaFactory.newInstance(XMLConstants.W3C_XML_SCHEMA_NS_URI);
Schema schema = schemaFactory.newSchema(schemaFile);

Unmarshaller unmarshaller = context.createUnmarshaller();
unmarshaller.setSchema(schema);
```

Bukan otomatis aman jika schema loading mengizinkan external access.

Hardening:

```java
schemaFactory.setProperty(XMLConstants.ACCESS_EXTERNAL_DTD, "");
schemaFactory.setProperty(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
schemaFactory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
```

### 6.4 Limit ukuran sebelum JAXB

JAXB tidak boleh menjadi komponen pertama yang menerima stream tidak terbatas.

Sebelum unmarshal, boundary harus punya:

```text
HTTP max body size
message broker max payload size
file ingestion max size
stream timeout
request deadline
parser entity limits
application-level collection limits
```

Jika tidak, attacker atau partner bug bisa membuat payload yang valid secara XML tetapi mematikan sistem.

---

## 7. Performance Model JAXB

### 7.1 Biaya besar JAXB

Sumber biaya utama:

| Area | Biaya |
|---|---|
| `JAXBContext.newInstance` | mahal, introspection/cache/model build |
| XML parsing | CPU, allocation, namespace resolution |
| object graph creation | banyak allocation |
| adapter conversion | CPU, parsing date/number, custom logic |
| validation | expensive, terutama XSD kompleks |
| formatted output | ekstra whitespace/string writing |
| DOM intermediate | memory besar |
| logging full XML | CPU + memory + security risk |

### 7.2 Hindari DOM jika tidak perlu

Buruk untuk payload besar:

```java
Document document = documentBuilder.parse(input);
Object object = unmarshaller.unmarshal(document);
```

Ini membangun tree XML penuh sebelum JAXB membangun object graph lagi.

```text
XML bytes -> DOM tree -> JAXB object graph
```

Lebih hemat:

```text
XML bytes -> StAX/SAX stream -> JAXB object graph
```

### 7.3 Marshal ke OutputStream, bukan String jika payload besar

Buruk:

```java
StringWriter writer = new StringWriter();
marshaller.marshal(object, writer);
String xml = writer.toString();
output.write(xml.getBytes(StandardCharsets.UTF_8));
```

Masalah:

- double buffering;
- encoding mismatch risk;
- memory spike;
- string besar di heap.

Lebih baik:

```java
marshaller.setProperty(Marshaller.JAXB_ENCODING, "UTF-8");
marshaller.marshal(object, outputStream);
```

### 7.4 Formatted output di production

`JAXB_FORMATTED_OUTPUT = true` bagus untuk debugging, tetapi menambah ukuran payload dan CPU.

```java
marshaller.setProperty(Marshaller.JAXB_FORMATTED_OUTPUT, Boolean.FALSE);
```

Untuk audit/log manusia, buat pretty print di tooling terpisah, bukan default hot path.

### 7.5 Validation cost

XSD validation bisa penting untuk boundary yang defensible, tetapi mahal.

Ada tiga strategi:

| Strategi | Kapan dipakai |
|---|---|
| Always validate inbound | external untrusted/regulated contract |
| Validate only at ingress | internal pipeline setelah ingress tidak perlu revalidate |
| Sample/diagnostic validation | high-throughput trusted internal flow |

Dalam sistem regulatory/enterprise, inbound external biasanya tetap perlu validation, tetapi harus dengan limit dan observability.

### 7.6 Adapter cost

Adapter sering menjadi bottleneck tersembunyi.

Contoh:

```java
public class DateAdapter extends XmlAdapter<String, LocalDate> {
    public LocalDate unmarshal(String value) {
        return LocalDate.parse(value, DateTimeFormatter.ofPattern("dd/MM/yyyy"));
    }
}
```

Jika formatter dibuat per call:

```java
DateTimeFormatter.ofPattern("dd/MM/yyyy")
```

itu buruk.

Lebih baik:

```java
public final class DateAdapter extends XmlAdapter<String, LocalDate> {
    private static final DateTimeFormatter FORMATTER = DateTimeFormatter.ofPattern("dd/MM/yyyy");

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

Tapi pastikan object yang di-cache memang immutable/thread-safe.

---

## 8. Classloader Issues di Application Server dan Modular Runtime

### 8.1 Kenapa classloader penting?

JAXB runtime membuat model berdasarkan `Class<?>`. Dalam application server, OSGi-like runtime, plugin system, atau hot reload, class yang namanya sama bisa berasal dari classloader berbeda.

```text
com.acme.xml.Customer loaded by ClassLoader A
!=
com.acme.xml.Customer loaded by ClassLoader B
```

Bagi JVM, itu dua class berbeda.

### 8.2 Symptom classloader problem

Error umum:

```text
ClassCastException: com.acme.Customer cannot be cast to com.acme.Customer
```

atau:

```text
JAXBException: class ... nor any of its super class is known to this context
```

atau setelah redeploy:

```text
Metaspace keeps growing
old webapp classloader not garbage collected
```

### 8.3 Root cause umum

- static `JAXBContext` di shared library menahan class dari webapp classloader;
- context cache global tidak dibersihkan saat redeploy;
- dependency JAXB ada di server dan aplikasi dengan versi berbeda;
- generated classes ada di dua module/jar;
- package scanning menggunakan context classloader yang salah.

### 8.4 Defensive pattern

Di container/redeploy environment:

```java
public final class JaxbContextRegistry implements AutoCloseable {

    private final ConcurrentMap<String, JAXBContext> contexts = new ConcurrentHashMap<>();

    public JAXBContext getOrCreate(String key, Supplier<JAXBContext> factory) {
        return contexts.computeIfAbsent(key, ignored -> factory.get());
    }

    @Override
    public void close() {
        contexts.clear();
    }
}
```

Dan registry ini harus hidup sesuai lifecycle aplikasi, bukan static global di shared parent classloader.

### 8.5 Dalam Spring Boot / standalone service

Risiko classloader lebih kecil daripada app server klasik, tetapi tetap ada pada:

- devtools restart classloader;
- plugin architecture;
- script engine;
- custom module loading;
- test suite yang membuat banyak ApplicationContext.

---

## 9. JPMS / Module Path Considerations

### 9.1 JAXB dan reflection

JAXB membutuhkan reflective access ke model class, terutama jika menggunakan field access:

```java
@XmlAccessorType(XmlAccessType.FIELD)
public class Customer {
    private String name;
}
```

Di classpath tradisional, ini biasanya tidak masalah.

Di module path, strong encapsulation bisa membuat reflective access gagal jika package tidak dibuka.

### 9.2 module-info.java basic idea

Contoh kasar:

```java
module com.acme.integration.partnera {
    requires jakarta.xml.bind;

    exports com.acme.integration.partnera.api;
    opens com.acme.integration.partnera.xml to jakarta.xml.bind;
}
```

`exports` berarti package terlihat untuk compile-time/public access.

`opens` berarti package boleh diakses secara reflection runtime.

Untuk JAXB model package, sering kali butuh `opens`.

### 9.3 Jangan asal open semua

Buruk:

```java
open module com.acme.integration {
    requires jakarta.xml.bind;
}
```

Ini membuka semua package untuk reflection. Kadang praktis untuk migrasi cepat, tetapi lebih lemah dari sisi encapsulation.

Lebih baik:

```java
opens com.acme.integration.partnera.xml to jakarta.xml.bind;
opens com.acme.integration.partnerb.xml to jakarta.xml.bind;
```

### 9.4 JPMS migration rule

Untuk aplikasi enterprise besar:

1. migrasi dependency Java 11+ dulu di classpath;
2. stabilkan javax/jakarta namespace;
3. stabilkan generated source;
4. baru pertimbangkan module path;
5. tambahkan `opens` per package XML model;
6. test marshalling/unmarshalling di runtime mode yang sama dengan production.

Jangan melakukan semua sekaligus.

---

## 10. Jakarta EE Container vs Standalone Service

### 10.1 Container-provided API

Dalam Jakarta EE server, beberapa API disediakan oleh container. Namun di era Jakarta EE 11, XML Binding dan SOAP-related APIs sudah tidak selalu menjadi bagian platform utama. Artinya aplikasi tidak boleh berasumsi bahwa container modern selalu menyediakan JAXB/JAX-WS/SAAJ seperti dulu.

### 10.2 WAR packaging issue

Ada dua strategi:

#### Strategy A — provided by container

```xml
<dependency>
  <groupId>jakarta.xml.bind</groupId>
  <artifactId>jakarta.xml.bind-api</artifactId>
  <scope>provided</scope>
</dependency>
```

Cocok jika target server jelas menyediakan API + runtime yang kompatibel.

#### Strategy B — bundle with application

```xml
<dependency>
  <groupId>jakarta.xml.bind</groupId>
  <artifactId>jakarta.xml.bind-api</artifactId>
</dependency>
<dependency>
  <groupId>org.glassfish.jaxb</groupId>
  <artifactId>jaxb-runtime</artifactId>
</dependency>
```

Cocok untuk Spring Boot, Quarkus, Micronaut, standalone service, atau WAR yang tidak ingin tergantung fitur optional container.

### 10.3 Bahaya duplicate API

Jika container menyediakan `jakarta.xml.bind-api` versi A dan aplikasi membawa versi B, bisa terjadi:

- linkage error;
- provider discovery conflict;
- class cast error;
- behavior berbeda antar environment.

Rule:

```text
Untuk app server: align dengan BOM/server feature.
Untuk standalone: pin API + implementation sendiri.
Untuk migration: buat dependency tree eksplisit dan cek duplicate JAXB artifacts.
```

Command praktis:

```bash
mvn dependency:tree | grep -i jaxb
mvn dependency:tree | grep -i bind
mvn dependency:tree | grep -i activation
```

Untuk Gradle:

```bash
./gradlew dependencies --configuration runtimeClasspath | grep -i jaxb
```

---

## 11. Provider Discovery dan Runtime Selection

### 11.1 Bagaimana JAXB menemukan implementation?

`JAXBContext.newInstance(...)` memakai provider discovery mechanism. Pada runtime modern, implementation biasanya ditemukan dari dependency seperti `jaxb-runtime` melalui service provider metadata.

Jika hanya API ada, provider tidak ditemukan.

Error umum:

```text
Implementation of JAXB-API has not been found on module path or classpath
```

### 11.2 Defensive startup check

Jangan tunggu request pertama gagal.

Buat startup validation:

```java
public final class XmlBindingStartupCheck {

    public static void verify() {
        try {
            JAXBContext context = JAXBContext.newInstance(HealthCheckXml.class);
            Marshaller marshaller = context.createMarshaller();
            marshaller.marshal(new HealthCheckXml("ok"), new StringWriter());
        } catch (Exception e) {
            throw new IllegalStateException("JAXB runtime is not correctly configured", e);
        }
    }
}
```

Jalankan saat aplikasi start.

Manfaat:

- dependency missing terdeteksi sebelum traffic;
- classloader conflict muncul lebih awal;
- generated class mismatch langsung terlihat;
- deployment gagal cepat.

---

## 12. javax→jakarta Migration Strategy

### 12.1 Jangan melihat migration sebagai find/replace import saja

Migration menyentuh:

```text
source code imports
annotation imports
generated classes
XJC plugin version
binding customization file
runtime dependency
API dependency
activation dependency
container feature
JPMS module-info
test fixture
serialization golden files
CI pipeline
```

### 12.2 Migration path pilihan

Ada tiga strategi utama.

#### Strategy A — stay on javax for now

Cocok jika:

- aplikasi legacy besar;
- SOAP stack lama masih javax;
- app server masih Java EE/Jakarta EE 8 style;
- migration risk tinggi;
- target Java hanya naik ke 11/17 tetapi framework belum Jakarta.

Dependency Java 11+ tetap harus eksplisit.

Kelebihan:

- perubahan source minimal;
- lebih aman untuk legacy SOAP/JAXB.

Kekurangan:

- technical debt tetap ada;
- ecosystem modern bergerak ke Jakarta;
- sulit align dengan Jakarta EE 10+.

#### Strategy B — big-bang jakarta migration

Cocok jika:

- framework utama sudah Jakarta namespace;
- generated code bisa diregenerate;
- integration contract test kuat;
- release window cukup;
- semua dependency mendukung Jakarta.

Kelebihan:

- hasil bersih;
- align dengan Jakarta EE modern.

Kekurangan:

- risiko besar;
- banyak perubahan serentak;
- perlu test luas.

#### Strategy C — boundary isolation bridge

Cocok untuk enterprise besar.

Caranya:

- module legacy tetap `javax`;
- module modern pakai `jakarta`;
- jangan campur object JAXB antar module;
- komunikasi antar module lewat neutral DTO/domain object;
- migrasi partner/contract satu per satu.

```text
legacy-soap-client-javax
        |
        v
LegacyXmlModelMapper
        |
        v
NeutralApplicationCommand
        |
        v
modern-service-jakarta
```

Ini lebih lambat, tetapi lebih aman.

### 12.3 Migration checklist

```text
[ ] Identifikasi semua import javax.xml.bind.*
[ ] Identifikasi semua generated source dari XJC lama
[ ] Identifikasi semua binding customization .xjb
[ ] Identifikasi semua dependency JAXB/JAX-WS/SAAJ/Activation
[ ] Identifikasi apakah SOAP stack masih javax
[ ] Tentukan target namespace: javax atau jakarta
[ ] Pin versi API + runtime + plugin
[ ] Regenerate source jika pindah namespace
[ ] Jalankan contract tests XML golden files
[ ] Jalankan schema validation tests
[ ] Jalankan SOAP integration tests jika terkait WSDL
[ ] Jalankan security fixtures: XXE, entity expansion, external schema
[ ] Jalankan performance smoke test
[ ] Cek dependency tree untuk duplicate API/runtime
[ ] Cek container feature jika deploy ke app server
```

---

## 13. Generated Code Hygiene untuk Migration

### 13.1 Jangan edit generated code manual

Generated JAXB classes harus dianggap disposable.

Buruk:

```text
src/main/java/com/acme/generated/Customer.java  <-- diedit manual
```

Lebih baik:

```text
src/main/xsd/partner-a/customer-v1.xsd
src/main/xjb/partner-a-bindings.xjb
build/generated-sources/xjc/...
```

Jika butuh behavior tambahan:

- gunakan mapper;
- gunakan partial/wrapper class jika memungkinkan;
- gunakan external binding customization;
- gunakan adapter;
- jangan modifikasi file generated.

### 13.2 Commit generated code atau generate saat build?

Ada dua pilihan.

#### Generate saat build

Kelebihan:

- source of truth jelas: XSD;
- tidak ada generated drift;
- migration lebih repeatable.

Kekurangan:

- build lebih kompleks;
- plugin/version harus stabil;
- generated output bisa berubah saat plugin upgrade.

#### Commit generated code

Kelebihan:

- build lebih sederhana;
- diff terlihat saat regenerate;
- cocok untuk environment build terbatas.

Kekurangan:

- rawan manual edit;
- rawan stale source;
- repository lebih penuh.

Untuk enterprise regulated integration, kompromi yang sering baik:

```text
XSD + binding file adalah source of truth.
Generated source boleh di-commit jika proses regenerate terkunci dan diff wajib direview.
```

### 13.3 Reproducible generation

Pastikan:

```text
[ ] versi XJC plugin dipin
[ ] versi JAXB runtime dipin
[ ] binding file dipin
[ ] schema import local, bukan download saat build
[ ] generated output deterministic
[ ] CI memverifikasi no generated drift
```

Contoh CI check:

```bash
mvn clean generate-sources
if ! git diff --exit-code; then
  echo "Generated JAXB sources are not up to date"
  exit 1
fi
```

---

## 14. Testing Strategy untuk JAXB Runtime

### 14.1 Golden file tests

Golden file test memastikan XML output tidak berubah diam-diam.

```text
expected/customer-response-v1.xml
actual/customer-response-v1.xml
```

Test:

1. marshal object ke XML;
2. canonicalize atau normalize whitespace jika perlu;
3. compare dengan expected.

Jangan compare raw string jika namespace prefix bisa berubah tapi semantic sama.

### 14.2 Round-trip tests

```text
XML -> Object -> XML
Object -> XML -> Object
```

Round-trip berguna, tetapi tidak cukup.

Kenapa?

Karena round-trip bisa konsisten secara internal tetapi tetap salah terhadap kontrak eksternal.

Contoh:

```text
field `customerId` salah namespace
round-trip tetap lolos karena JAXB membaca output-nya sendiri
partner tetap reject
```

### 14.3 Schema validation tests

Inbound:

```text
fixture XML valid -> unmarshal OK
fixture XML invalid -> fail dengan error jelas
```

Outbound:

```text
marshal object -> validate against XSD -> OK
```

### 14.4 Negative fixtures

Wajib punya malicious/edge fixtures:

```text
[ ] unknown element
[ ] missing required element
[ ] wrong namespace
[ ] invalid enum
[ ] invalid date
[ ] duplicate repeated element where maxOccurs=1
[ ] xsi:nil unexpected
[ ] unexpected xsi:type
[ ] very large text
[ ] deeply nested XML
[ ] DTD/XXE attempt
[ ] external schema reference
```

### 14.5 Migration regression suite

Sebelum Java 8 → 17/21/25 atau javax→jakarta:

```text
[ ] run same fixture set before and after
[ ] compare parsed object semantic
[ ] compare marshalled XML semantic
[ ] compare validation behavior
[ ] compare fault/error mapping
[ ] compare performance envelope
[ ] compare dependency tree
```

---

## 15. Observability dan Failure Modeling

### 15.1 Log yang benar

Jangan log full XML default.

Buruk:

```java
log.error("Failed XML: {}", xmlString, e);
```

Masalah:

- PII leak;
- credential/token leak;
- log injection;
- huge log event;
- compliance issue;
- production cost tinggi.

Lebih baik:

```java
log.warn("XML unmarshal failed: integration={}, contractVersion={}, root={}, errorType={}, correlationId={}",
    integrationName,
    contractVersion,
    rootElementName,
    e.getClass().getSimpleName(),
    correlationId);
```

Jika perlu payload capture:

- redacted;
- size-limited;
- encrypted storage;
- access-controlled;
- retention-limited;
- tied to incident/debug mode.

### 15.2 Metrics yang berguna

```text
xml_unmarshal_duration_ms
xml_marshal_duration_ms
xml_validation_duration_ms
xml_unmarshal_failures_total
xml_validation_failures_total
xml_payload_size_bytes
xml_unknown_root_total
xml_schema_version_seen_total
jaxb_context_init_duration_ms
jaxb_context_cache_size
```

### 15.3 Failure taxonomy

Pisahkan error:

| Error | Meaning | Response |
|---|---|---|
| parse error | XML not well-formed | reject as bad request/input |
| validation error | XML well-formed but violates XSD | reject contract violation |
| binding error | mapping/type issue | integration bug or incompatible contract |
| business validation | syntactically valid but domain-invalid | domain-level rejection |
| system error | dependency/resource/runtime failure | retry/incident depending context |

Jangan semua menjadi:

```text
500 Internal Server Error
```

Untuk integration defensibility, error harus bisa menjawab:

```text
Apakah input partner salah?
Apakah kontrak berubah?
Apakah sistem kita bug?
Apakah ini transient?
Apakah aman untuk retry?
```

---

## 16. Memory Engineering

### 16.1 Object graph explosion

XML kecil secara byte bisa menghasilkan object graph besar.

Contoh:

```xml
<items>
  <item>...</item>
  <item>...</item>
  ... 500000 times ...
</items>
```

JAXB akan membuat list besar di heap.

Mitigasi:

- payload size limit;
- count limit via schema/app validation;
- streaming partial processing;
- split file/message;
- avoid full JAXB object graph untuk batch besar.

### 16.2 Partial unmarshalling

Untuk dokumen besar, jangan selalu unmarshal root penuh.

Pattern StAX cursor:

```java
XMLStreamReader reader = factory.createXMLStreamReader(input);
Unmarshaller unmarshaller = context.createUnmarshaller();

while (reader.hasNext()) {
    int event = reader.next();
    if (event == XMLStreamConstants.START_ELEMENT
        && "item".equals(reader.getLocalName())) {
        JAXBElement<Item> item = unmarshaller.unmarshal(reader, Item.class);
        process(item.getValue());
    }
}
```

Ini berguna untuk batch XML besar:

```text
large file -> item by item -> process/store -> discard object
```

Bukan:

```text
large file -> full JAXB root -> huge List<Item> -> process later
```

### 16.3 Backpressure

Jika partial unmarshal membaca lebih cepat daripada downstream, tetap bisa overload.

Desain:

```text
read item
  -> validate item
  -> process item synchronously or bounded queue
  -> commit/checkpoint
  -> next item
```

Jangan:

```text
read all items into queue unbounded
```

---

## 17. Native Image / AOT Considerations

### 17.1 Kenapa JAXB sulit untuk native image?

JAXB bergantung pada:

- reflection;
- annotation scanning;
- runtime class discovery;
- generated/accessor classes;
- service provider discovery;
- resource loading seperti `jaxb.index`, `ObjectFactory`, schema resources.

Native image membutuhkan metadata upfront.

### 17.2 Rule praktis

Jika memakai GraalVM/native-image atau framework AOT:

```text
[ ] Hindari dynamic JAXBContext dari package string yang tidak jelas
[ ] Prefer explicit classes di JAXBContext.newInstance(...)
[ ] Register reflection metadata untuk JAXB model
[ ] Register resources: XSD, binding-related resources, jaxb.index jika dipakai
[ ] Test native executable dengan real XML fixtures
[ ] Jangan hanya test JVM mode
```

### 17.3 Explicit context lebih AOT-friendly

Lebih baik:

```java
JAXBContext.newInstance(CustomerRequest.class, CustomerResponse.class)
```

Daripada:

```java
JAXBContext.newInstance("com.acme.generated.partnera")
```

Karena explicit class list lebih mudah dianalisis oleh tooling.

---

## 18. Production-Grade JAXB Utility: Contoh Desain

### 18.1 Design goal

Kita ingin utility yang:

- cache context;
- membuat marshaller/unmarshaller per operation;
- harden XML parser;
- support schema validation;
- tidak log payload penuh;
- memberi error taxonomy;
- bisa di-test.

### 18.2 Exception model

```java
public sealed class XmlContractException extends RuntimeException
    permits XmlParseException, XmlValidationException, XmlBindingFailureException {

    protected XmlContractException(String message, Throwable cause) {
        super(message, cause);
    }
}

public final class XmlParseException extends XmlContractException {
    public XmlParseException(String message, Throwable cause) {
        super(message, cause);
    }
}

public final class XmlValidationException extends XmlContractException {
    public XmlValidationException(String message, Throwable cause) {
        super(message, cause);
    }
}

public final class XmlBindingFailureException extends XmlContractException {
    public XmlBindingFailureException(String message, Throwable cause) {
        super(message, cause);
    }
}
```

Untuk Java 8, sealed class tidak tersedia. Gunakan class hierarchy biasa.

### 18.3 Runtime component

```java
public final class JaxbRuntime<T> {

    private final Class<T> rootType;
    private final JAXBContext context;
    private final XMLInputFactory xmlInputFactory;
    private final Schema schema;

    public JaxbRuntime(Class<T> rootType, Schema schema) {
        this.rootType = Objects.requireNonNull(rootType, "rootType");
        this.context = createContext(rootType);
        this.xmlInputFactory = secureXmlInputFactory();
        this.schema = schema;
    }

    public T unmarshal(InputStream input) {
        Objects.requireNonNull(input, "input");

        try {
            XMLStreamReader reader = xmlInputFactory.createXMLStreamReader(input);
            Unmarshaller unmarshaller = context.createUnmarshaller();
            if (schema != null) {
                unmarshaller.setSchema(schema);
            }

            JAXBElement<T> element = unmarshaller.unmarshal(reader, rootType);
            return element.getValue();
        } catch (XMLStreamException e) {
            throw new XmlParseException("XML is not well-formed or parser rejected input", e);
        } catch (UnmarshalException e) {
            throw new XmlValidationException("XML cannot be unmarshalled according to contract", e);
        } catch (JAXBException e) {
            throw new XmlBindingFailureException("JAXB runtime failed", e);
        }
    }

    public void marshal(T value, OutputStream output) {
        Objects.requireNonNull(value, "value");
        Objects.requireNonNull(output, "output");

        try {
            Marshaller marshaller = context.createMarshaller();
            marshaller.setProperty(Marshaller.JAXB_ENCODING, "UTF-8");
            marshaller.setProperty(Marshaller.JAXB_FORMATTED_OUTPUT, Boolean.FALSE);
            if (schema != null) {
                marshaller.setSchema(schema);
            }
            marshaller.marshal(value, output);
        } catch (MarshalException e) {
            throw new XmlValidationException("Object cannot be marshalled according to contract", e);
        } catch (JAXBException e) {
            throw new XmlBindingFailureException("JAXB runtime failed", e);
        }
    }

    private static JAXBContext createContext(Class<?>... classes) {
        try {
            return JAXBContext.newInstance(classes);
        } catch (JAXBException e) {
            throw new IllegalStateException("Failed to initialize JAXBContext", e);
        }
    }

    private static XMLInputFactory secureXmlInputFactory() {
        XMLInputFactory factory = XMLInputFactory.newFactory();
        trySet(factory, XMLInputFactory.SUPPORT_DTD, Boolean.FALSE);
        trySet(factory, "javax.xml.stream.isSupportingExternalEntities", Boolean.FALSE);
        return factory;
    }

    private static void trySet(XMLInputFactory factory, String property, Object value) {
        try {
            factory.setProperty(property, value);
        } catch (IllegalArgumentException ignored) {
            // Provider does not support this property.
            // In production, prefer logging this once at startup.
        }
    }
}
```

### 18.4 Catatan untuk Java 8

Kode di atas memakai `sealed` di exception contoh sebelumnya; untuk Java 8, ubah menjadi class biasa.

Selain itu:

- `Objects.requireNonNull` aman di Java 8;
- StAX tersedia;
- JAXB API tersedia di JDK 8, tetapi tetap lebih baik menambahkan dependency eksplisit jika project multi-JDK;
- `jakarta.*` tidak cocok untuk Java EE legacy runtime yang masih `javax.*`.

---

## 19. Migration Case Study: Java 8 javax JAXB ke Java 21

### 19.1 Kondisi awal

```text
Java 8
Spring Boot lama / app server lama
source import javax.xml.bind.*
generated code dari XJC lama
no explicit JAXB dependency
SOAP client legacy
```

### 19.2 Target 1: Java 21 tetapi tetap javax

Ini sering menjadi langkah aman pertama.

Langkah:

1. Tambahkan explicit JAXB 2.3.x API/runtime.
2. Tambahkan activation jika perlu.
3. Pastikan compile Java 21.
4. Jalankan fixture XML.
5. Jalankan SOAP integration test.
6. Jangan ubah namespace ke Jakarta dulu.

Benefit:

```text
JDK migration dan Jakarta migration dipisah.
```

Ini mengurangi blast radius.

### 19.3 Target 2: Jakarta namespace

Setelah Java 21 stabil:

1. upgrade framework/container ke Jakarta-compatible;
2. upgrade JAXB API/runtime ke Jakarta 3.x/4.x;
3. regenerate XJC classes agar import `jakarta.xml.bind.annotation.*`;
4. update source import;
5. update binding customization jika ada namespace/plugin issue;
6. update module-info opens jika JPMS;
7. jalankan golden file comparison;
8. jalankan interop test dengan partner/system simulator.

### 19.4 Jangan gabungkan dengan SOAP migration kecuali perlu

Jika JAX-WS client juga ada, migration JAXB bisa terkait erat dengan SOAP stack.

Tapi secara planning, pisahkan concern:

```text
Phase 1: Java runtime upgrade
Phase 2: JAXB dependency explicit
Phase 3: SOAP client compatibility
Phase 4: javax -> jakarta
Phase 5: contract cleanup/modernization
```

---

## 20. Common Failure Scenarios dan Cara Mendiagnosis

### 20.1 `ClassNotFoundException: javax.xml.bind.JAXBContext`

Kemungkinan:

- running Java 11+;
- dependency JAXB API tidak ada;
- masih source/runtime javax.

Fix:

- tambahkan JAXB 2.x API/runtime untuk javax;
- atau migrasi source ke jakarta dan tambahkan Jakarta XML Binding.

### 20.2 `Implementation of JAXB-API has not been found`

Kemungkinan:

- API ada, implementation tidak ada;
- service provider tidak terbaca;
- module path issue;
- dependency scope salah.

Fix:

- tambahkan `jaxb-runtime`;
- cek dependency tree;
- cek packaging final artifact.

### 20.3 `class ... nor any of its super class is known to this context`

Kemungkinan:

- class tidak dimasukkan ke `JAXBContext`;
- root element tidak ada;
- package scanning salah;
- classloader berbeda;
- menggunakan subclass yang tidak dikenal.

Fix:

- buat context dengan explicit class list;
- cek `@XmlRootElement` atau gunakan `JAXBElement`;
- cek generated package;
- cek classloader.

### 20.4 Namespace mismatch

Symptom:

```text
unexpected element (uri:"...", local:"Customer")
Expected elements are <{}Customer>
```

Kemungkinan:

- namespace di XML berbeda dari annotation;
- package-level `@XmlSchema` salah;
- `elementFormDefault` tidak sesuai;
- partner mengubah namespace.

Fix:

- compare XML actual vs XSD;
- cek `package-info.java`;
- cek generated source;
- gunakan schema validation.

### 20.5 Works in IDE, fails in server

Kemungkinan:

- dependency server berbeda;
- provided scope salah;
- duplicate API jar;
- classloader ordering;
- server punya JAXB implementation lain.

Fix:

- inspect final WAR/EAR;
- inspect server modules/features;
- align BOM;
- buat startup check.

---

## 21. Decision Matrix: Kapan JAXB Masih Layak?

| Situasi | JAXB cocok? | Catatan |
|---|---:|---|
| SOAP/WSDL/XSD integration | Ya | Natural fit, apalagi schema-first |
| XML file exchange dengan XSD formal | Ya | Strong contract validation |
| Simple config file | Mungkin | Bisa pakai plain XML parser atau config library |
| Huge XML batch | Hati-hati | Gunakan StAX partial unmarshal |
| Dynamic unknown XML | Tidak ideal | DOM/StAX/XPath mungkin lebih cocok |
| Mixed content document-heavy XML | Hati-hati | JAXB bisa, tetapi kompleks |
| Modern JSON API | Tidak | Gunakan JSON-B/Jackson/JSON-P |
| Domain persistence model | Tidak disarankan | Jangan jadikan JAXB model sebagai entity |
| Native image/AOT critical path | Hati-hati | Reflection metadata perlu dikelola |

---

## 22. Best Practices Ringkas

### 22.1 Runtime

```text
[+] Cache JAXBContext
[+] Create Marshaller/Unmarshaller per operation unless measured otherwise
[+] Harden XML parser before unmarshal
[+] Add explicit JAXB dependencies on Java 11+
[+] Keep javax and jakarta dependency lines separate
[+] Use explicit classes for context where possible
[+] Validate at external boundary when contract requires it
[+] Add startup check
[+] Add golden file tests
[+] Add negative security fixtures
```

### 22.2 Hindari

```text
[-] JAXBContext per request
[-] Static shared Unmarshaller
[-] Full XML logging
[-] DOM for huge payload
[-] Mixing javax annotations with jakarta runtime
[-] Editing generated source manually
[-] Downloading remote XSD during build/runtime
[-] Combining Java upgrade + namespace migration + contract redesign in one release
```

---

## 23. Mental Model Akhir

JAXB runtime engineering bisa diringkas seperti ini:

```text
Contract model is stable.
Runtime metadata is expensive.
Parser boundary must be hardened.
Marshaller/unmarshaller are mutable workers.
Context is shared registry.
Generated code is disposable.
Namespace line must be consistent.
Migration must be staged.
```

Atau lebih singkat:

> Treat JAXB as an integration runtime, not a serialization helper.

Engineer yang hanya tahu JAXB dari tutorial biasanya fokus pada:

```java
JAXBContext.newInstance(...)
unmarshaller.unmarshal(...)
marshaller.marshal(...)
```

Engineer yang siap production memikirkan:

```text
Where is the contract boundary?
Who owns the XSD?
How is context cached?
What is the classloader lifecycle?
Is the parser hardened?
Is schema validation bounded?
Are javax/jakarta artifacts consistent?
Can this survive Java 8 -> 11 -> 17 -> 21 -> 25?
Can failures be classified and audited?
Can generated code be reproduced?
Can output compatibility be proven?
```

Itulah level pemahaman yang membedakan penggunaan JAXB biasa dengan integrasi XML enterprise yang benar-benar defensible.

---

## 24. Latihan Praktis

### Latihan 1 — Audit dependency JAXB

Ambil satu project Java yang memakai XML/JAXB.

Cari:

```bash
mvn dependency:tree | grep -Ei "jaxb|bind|activation|saaj|jaxws"
```

Jawab:

```text
[ ] Apakah source memakai javax atau jakarta?
[ ] Apakah API dan runtime satu generasi?
[ ] Apakah ada duplicate JAXB artifacts?
[ ] Apakah runtime dependency ada di final artifact?
[ ] Apakah app server menyediakan API yang sama?
```

### Latihan 2 — Buat startup check

Buat startup check yang:

1. membuat `JAXBContext`;
2. marshal sample object;
3. unmarshal sample XML;
4. validate schema jika ada;
5. gagal start jika dependency/runtime salah.

### Latihan 3 — Benchmark kasar

Bandingkan:

```text
A. JAXBContext dibuat per request
B. JAXBContext cached, unmarshaller per request
C. JAXBContext cached, ThreadLocal unmarshaller
```

Ukur:

```text
latency p50/p95/p99
allocation rate
GC count/time
throughput
```

Jangan memilih C kecuali data membuktikan perlu.

### Latihan 4 — Security fixture

Buat fixture XML:

```xml
<?xml version="1.0"?>
<!DOCTYPE foo [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>
<customer>&xxe;</customer>
```

Pastikan pipeline JAXB menolak input tersebut.

### Latihan 5 — Migration dry run

Ambil generated source `javax`.

Buat branch:

```text
branch A: Java 21 + javax JAXB 2.3.x
branch B: Java 21 + jakarta JAXB 4.x + regenerate source
```

Bandingkan:

```text
compile errors
runtime errors
XML golden diff
schema validation result
integration tests
```

---

## 25. Referensi Resmi dan Relevan

- Jakarta XML Binding Specification 4.0 — `https://jakarta.ee/specifications/xml-binding/4.0/`
- Jakarta XML Binding API Docs — `https://jakarta.ee/specifications/xml-binding/4.0/apidocs/`
- Eclipse JAXB RI Documentation — `https://eclipse-ee4j.github.io/jaxb-ri/`
- Eclipse JAXB RI FAQ / thread-safety notes — `https://eclipse-ee4j.github.io/jaxb-ri/4.0.3/docs/ch06.html`
- Eclipse JAXB RI Tools Documentation — `https://eclipse-ee4j.github.io/jaxb-ri/4.0.5/docs/ch04.html`
- OpenJDK JEP 320: Remove the Java EE and CORBA Modules — `https://openjdk.org/jeps/320`
- Oracle JAXP Security Guide — `https://docs.oracle.com/en/java/javase/24/security/java-api-xml-processing-jaxp-security-guide.html`
- Jakarta EE 11 Release Notes — `https://jakarta.ee/release/11/`

---

## 26. Ringkasan

Di Part 21 ini kita membahas JAXB dari sisi runtime:

- `JAXBContext` mahal dan harus di-cache.
- `Marshaller` dan `Unmarshaller` tidak boleh dibagi bebas antar thread.
- Java 11+ tidak lagi membawa JAXB di JDK.
- `javax.xml.bind.*` dan `jakarta.xml.bind.*` harus diperlakukan sebagai dua garis dependency berbeda.
- XML parser hardening tetap wajib walaupun memakai JAXB.
- DOM intermediate harus dihindari untuk payload besar.
- classloader, JPMS, container dependency, provider discovery, dan native-image bisa mempengaruhi runtime behavior.
- migration harus distage, bukan digabung semua dalam satu perubahan besar.
- production JAXB harus punya startup check, contract tests, security fixtures, observability, dan failure taxonomy.

Part berikutnya akan masuk ke dunia SOAP.

---

# Status Seri

Seri belum selesai.

- Part selesai: 21 dari 34
- Part berikutnya: **Part 22 — SOAP Mental Model**

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 20 — JAXB Advanced Mapping: Adapters, Polymorphism, `JAXBElement`, Wildcards, Mixed Content, and Contract-Safe XML Models](./learn-java-json-xml-soap-connectors-enterprise-integration-part-020.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 22 — SOAP Mental Model: Envelope, Header, Body, Fault, SOAP 1.1 vs 1.2, Document-Literal, RPC Legacy, and Why SOAP Survived](./learn-java-json-xml-soap-connectors-enterprise-integration-part-022.md)
