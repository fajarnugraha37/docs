# Part 18 — MapStruct Mental Model: Compile-Time Mapping and Generated Code

**Series:** `learn-java-data-mapper-json-xml-jackson-mapstruct-lombok-transformation-engineering`  
**File:** `18-mapstruct-mental-model-compile-time-mapping-generated-code.md`  
**Target Java:** Java 8 → Java 25  
**Focus:** MapStruct sebagai compile-time mapper, annotation processor, generated code, build integration, inspection, dan posisi arsitekturalnya dalam mapping layer modern.

---

## 0. Posisi Part Ini Dalam Seri

Pada Part 0–5 kita membangun mental model bahwa mapping bukan sekadar memindahkan field, tetapi **boundary engineering**. Pada Part 6–17 kita masuk ke Jackson/JSON/XML sebagai runtime serialization/deserialization engine. Mulai Part 18, kita pindah ke MapStruct sebagai **compile-time object mapping engine**.

Jackson menjawab pertanyaan:

> “Bagaimana object Java menjadi JSON/XML dan sebaliknya?”

MapStruct menjawab pertanyaan berbeda:

> “Bagaimana satu object Java diubah menjadi object Java lain secara eksplisit, type-safe, dan efisien?”

Contoh boundary:

```text
HTTP JSON Request
   ↓ Jackson deserialization
CreateApplicationRequestDto
   ↓ MapStruct/manual mapper
CreateApplicationCommand
   ↓ application service
Domain Aggregate / Entity
   ↓ MapStruct/manual mapper
ApplicationResponseDto
   ↓ Jackson serialization
HTTP JSON Response
```

MapStruct berada di tengah object-to-object transformation. Ia bukan JSON parser, bukan validator, bukan ORM, bukan business-rule engine, dan bukan replacement untuk desain DTO yang benar.

Mental model paling penting:

> MapStruct adalah **compiler-assisted manual mapper generator**.

Ia mencoba memberi benefit manual mapping—plain Java, cepat, eksplisit, mudah dibaca—tanpa harus menulis semua boilerplate secara manual.

---

## 1. Masalah yang Diselesaikan MapStruct

Di aplikasi enterprise, mapping biasanya muncul terus-menerus:

```java
public ApplicationResponse toResponse(Application entity) {
    ApplicationResponse response = new ApplicationResponse();
    response.setId(entity.getId());
    response.setReferenceNo(entity.getReferenceNo());
    response.setStatus(entity.getStatus().name());
    response.setSubmittedAt(entity.getSubmittedAt());
    response.setApplicantName(entity.getApplicant().getName());
    return response;
}
```

Manual mapping seperti ini punya kelebihan:

- jelas;
- mudah di-debug;
- tidak butuh reflection;
- compile-time type checking;
- mudah dioptimasi JVM;
- tidak bergantung pada runtime magic.

Tetapi di sistem besar, manual mapping sering menjadi:

- repetitive;
- mudah lupa field;
- inconsistent antar mapper;
- sulit menjaga mapping nested/collection/enum;
- melelahkan saat DTO berubah;
- rawan copy-paste bug.

Di sisi lain, reflection-based mapper seperti ModelMapper/Dozer-style mapper memberi convenience, tetapi biasanya membawa risiko:

- mapping terjadi saat runtime;
- error baru muncul ketika code path dipanggil;
- sulit melihat mapping aktual;
- performa lebih berat;
- bisa terlalu otomatis;
- field semantic mismatch tersembunyi;
- debugging lebih sulit.

MapStruct mengambil posisi tengah:

```text
Manual Mapper
  + explicit shape
  + plain Java
  + compile-time failure
  - boilerplate

Reflection Mapper
  + less code
  - runtime magic
  - weaker visibility
  - slower / less predictable

MapStruct
  + generates manual-like code
  + compile-time checking
  + no reflection for generated mapping
  + readable generated implementation
  - requires annotation processing discipline
  - still needs design discipline
```

---

## 2. MapStruct Dalam Satu Kalimat

MapStruct adalah **Java annotation processor** yang membaca interface mapper pada saat compile, lalu menghasilkan class implementation berisi plain Java method invocation untuk mapping antar bean/object.

Contoh:

```java
@Mapper
public interface ApplicationMapper {
    ApplicationResponseDto toResponse(Application application);
}
```

Saat build, MapStruct menghasilkan kira-kira seperti ini:

```java
@Generated(...)
public class ApplicationMapperImpl implements ApplicationMapper {

    @Override
    public ApplicationResponseDto toResponse(Application application) {
        if (application == null) {
            return null;
        }

        ApplicationResponseDto dto = new ApplicationResponseDto();
        dto.setId(application.getId());
        dto.setReferenceNo(application.getReferenceNo());
        dto.setStatus(application.getStatus());

        return dto;
    }
}
```

Perhatikan tiga hal:

1. **Mapping implementation dibuat saat compile**, bukan saat runtime.
2. **Code yang dihasilkan plain Java**, bukan reflection mapper.
3. **Kalau target/source property tidak cocok, compiler/build bisa gagal**, tergantung policy yang dipilih.

---

## 3. Mental Model: MapStruct Bukan Runtime Library Biasa

Library umum biasanya bekerja seperti ini:

```text
Source code
  ↓ javac
Bytecode
  ↓ runtime
Library invoked during runtime
```

MapStruct bekerja seperti ini:

```text
Source code mapper interface
  ↓ javac annotation processing phase
MapStruct processor reads mapper metadata
  ↓
Generated mapper implementation source code
  ↓ javac compiles generated source
Bytecode mapper implementation
  ↓ runtime
Plain Java method call
```

Implikasinya besar.

### 3.1 Error Terjadi Lebih Awal

Jika field tidak bisa dimapping, MapStruct bisa gagal saat compile:

```java
@Mapper(unmappedTargetPolicy = ReportingPolicy.ERROR)
public interface ApplicationMapper {
    ApplicationResponseDto toResponse(Application application);
}
```

Jika `ApplicationResponseDto` punya property `submissionChannel`, tetapi source tidak punya field terkait dan tidak di-ignore, build bisa gagal.

Ini bagus untuk enterprise codebase karena contract drift ketahuan sebelum deploy.

### 3.2 Generated Code Bisa Dibaca

MapStruct bukan black box. Generated code biasanya tersedia di:

Maven:

```text
target/generated-sources/annotations
```

Gradle:

```text
build/generated/sources/annotationProcessor/java/main
```

Kebiasaan senior engineer:

> Kalau mapping tidak jelas, buka generated implementation.

Jangan hanya membaca interface. Interface adalah instruksi. Generated class adalah realitas yang akan dijalankan.

### 3.3 Tidak Ada Reflection Mapping di Hot Path

Generated MapStruct mapper biasanya berupa method call biasa:

```java
target.setName(source.getName());
```

Bukan:

```java
Field sourceField = source.getClass().getDeclaredField("name");
sourceField.setAccessible(true);
Object value = sourceField.get(source);
```

Konsekuensi:

- lebih predictable;
- lebih mudah di-inline JVM;
- lebih mudah di-profile;
- lebih minim runtime surprise;
- mapping cost lebih dekat ke manual mapper.

---

## 4. Annotation Processing: Apa yang Sebenarnya Terjadi?

Annotation processing adalah mekanisme compiler Java yang memungkinkan processor membaca annotation tertentu dan menghasilkan source code tambahan.

MapStruct menggunakan annotation seperti:

```java
@Mapper
public interface UserMapper {
    UserDto toDto(User user);
}
```

Pada compile phase:

```text
javac sees @Mapper
  ↓
MapStruct annotation processor invoked
  ↓
processor analyzes source type and target type
  ↓
processor determines property mappings
  ↓
processor emits UserMapperImpl.java
  ↓
javac compiles UserMapperImpl.java
```

### 4.1 Yang Dianalisis MapStruct

MapStruct perlu memahami:

- source type;
- target type;
- readable properties source;
- writable properties target;
- constructors;
- builders;
- nested properties;
- collection element type;
- enum constants;
- available conversion methods;
- mapper lain yang di-`uses`;
- lifecycle hooks;
- config global;
- null strategy;
- component model.

### 4.2 Yang Tidak Dilakukan MapStruct

MapStruct tidak otomatis memahami:

- business invariant;
- authorization rule;
- database fetch strategy;
- external contract meaning;
- semantic equivalence antar field;
- apakah `status` pada DTO sama dengan `status` pada entity;
- apakah `amount` perlu currency;
- apakah `name` perlu masking;
- apakah null berarti absent, clear, default, atau unknown.

MapStruct bisa memindahkan data, tetapi engineer harus mendesain maknanya.

---

## 5. Generated Code sebagai Design Feedback

Salah satu teknik penting: gunakan generated code sebagai feedback desain.

Jika generated mapper terlihat bersih:

```java
@Override
public ApplicationSummaryDto toSummary(Application application) {
    if (application == null) {
        return null;
    }

    ApplicationSummaryDto dto = new ApplicationSummaryDto();
    dto.setId(application.getId());
    dto.setReferenceNo(application.getReferenceNo());
    dto.setStatus(application.getStatus());
    dto.setSubmittedAt(application.getSubmittedAt());
    return dto;
}
```

Biasanya desain DTO dan source model cukup selaras.

Jika generated mapper terlihat aneh:

```java
applicationDto.setApplicantName(
    application.getCaseFile().getApplicationData().getPerson().getProfile().getFullName()
);
```

Itu sinyal bahwa mapping mungkin:

- terlalu menembus object graph;
- membuat DTO bergantung pada struktur internal entity;
- rawan `NullPointerException` chain;
- menyembunyikan fetch/lazy loading cost;
- butuh projection model, query DTO, atau domain method.

Jika generated code penuh dengan helper method acak, conversion implicit, dan nested mapping yang tidak disengaja, jangan langsung “memperbaiki MapStruct”. Periksa desain boundary.

> Generated code adalah cermin. Kalau cerminnya menunjukkan wajah desain buruk, jangan salahkan cerminnya.

---

## 6. Setup Dasar Maven

Contoh Maven modern:

```xml
<properties>
    <org.mapstruct.version>1.6.3</org.mapstruct.version>
    <maven.compiler.release>21</maven.compiler.release>
</properties>

<dependencies>
    <dependency>
        <groupId>org.mapstruct</groupId>
        <artifactId>mapstruct</artifactId>
        <version>${org.mapstruct.version}</version>
    </dependency>
</dependencies>

<build>
    <plugins>
        <plugin>
            <groupId>org.apache.maven.plugins</groupId>
            <artifactId>maven-compiler-plugin</artifactId>
            <version>3.13.0</version>
            <configuration>
                <release>${maven.compiler.release}</release>
                <annotationProcessorPaths>
                    <path>
                        <groupId>org.mapstruct</groupId>
                        <artifactId>mapstruct-processor</artifactId>
                        <version>${org.mapstruct.version}</version>
                    </path>
                </annotationProcessorPaths>
                <compilerArgs>
                    <arg>-Amapstruct.defaultComponentModel=spring</arg>
                    <arg>-Amapstruct.unmappedTargetPolicy=ERROR</arg>
                </compilerArgs>
            </configuration>
        </plugin>
    </plugins>
</build>
```

Untuk Java 8 legacy:

```xml
<properties>
    <org.mapstruct.version>1.6.3</org.mapstruct.version>
    <maven.compiler.source>1.8</maven.compiler.source>
    <maven.compiler.target>1.8</maven.compiler.target>
</properties>
```

Namun untuk build modern, `--release` lebih aman dibanding hanya `source/target`, karena ia membatasi API platform yang tersedia sesuai target release.

### 6.1 Dependency Runtime vs Processor

Ada dua artifact utama:

```text
org.mapstruct:mapstruct
org.mapstruct:mapstruct-processor
```

`mapstruct` berisi annotation/API yang dipakai source code.

`mapstruct-processor` dipakai compiler untuk generate implementation.

Jangan hanya menaruh `mapstruct` tanpa processor. Jika processor tidak jalan, mapper implementation tidak dibuat.

---

## 7. Setup Dasar Gradle

Contoh Gradle Java:

```groovy
plugins {
    id 'java'
}

repositories {
    mavenCentral()
}

def mapstructVersion = '1.6.3'

dependencies {
    implementation "org.mapstruct:mapstruct:${mapstructVersion}"
    annotationProcessor "org.mapstruct:mapstruct-processor:${mapstructVersion}"

    testAnnotationProcessor "org.mapstruct:mapstruct-processor:${mapstructVersion}"
}

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(21)
    }
}

compileJava {
    options.compilerArgs += [
        '-Amapstruct.defaultComponentModel=spring',
        '-Amapstruct.unmappedTargetPolicy=ERROR'
    ]
}
```

Untuk Kotlin project, konfigurasi bisa berbeda karena Kotlin annotation processing (`kapt`) atau KSP. Seri ini fokus Java, tetapi prinsipnya sama: processor harus benar-benar dijalankan dalam build.

---

## 8. Minimal Mapper: Dari Interface ke Implementation

Source:

```java
public class User {
    private Long id;
    private String username;
    private String email;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public String getUsername() { return username; }
    public void setUsername(String username) { this.username = username; }

    public String getEmail() { return email; }
    public void setEmail(String email) { this.email = email; }
}
```

Target:

```java
public class UserDto {
    private Long id;
    private String username;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public String getUsername() { return username; }
    public void setUsername(String username) { this.username = username; }
}
```

Mapper:

```java
@Mapper
public interface UserMapper {
    UserDto toDto(User user);
}
```

Generated behavior:

```java
UserDto dto = new UserDto();
dto.setId(user.getId());
dto.setUsername(user.getUsername());
```

Karena `email` tidak ada di target, MapStruct tidak perlu melakukan apa-apa. Namun jika target punya field yang tidak termapping, itu harus jadi warning/error tergantung policy.

---

## 9. Mengapa Unmapped Target Harus Error di Codebase Serius

Default yang terlalu permisif membuat mapping drift tidak terlihat.

Misal DTO berubah:

```java
public class UserDto {
    private Long id;
    private String username;
    private String displayName; // field baru
}
```

Jika mapper tetap compile tanpa perhatian, response mungkin selalu menghasilkan `displayName = null`.

Di sistem kecil, ini bug biasa. Di sistem regulatory/case management, ini bisa berarti:

- field mandatory hilang;
- audit view salah;
- decision package tidak lengkap;
- notification memakai data kosong;
- report tidak akurat;
- downstream system salah interpretasi.

Policy yang disarankan:

```java
@Mapper(unmappedTargetPolicy = ReportingPolicy.ERROR)
public interface UserMapper {
    UserDto toDto(User user);
}
```

Atau global:

```text
-Amapstruct.unmappedTargetPolicy=ERROR
```

Jika memang field sengaja tidak dimapping, buat eksplisit:

```java
@Mapper(unmappedTargetPolicy = ReportingPolicy.ERROR)
public interface UserMapper {

    @Mapping(target = "displayName", ignore = true)
    UserDto toDto(User user);
}
```

Mengapa `ignore = true` bagus?

Karena ia membuat keputusan terlihat saat review.

```text
Tidak termapping karena lupa      → buruk
Tidak termapping karena di-ignore → keputusan eksplisit
```

---

## 10. MapStruct dan Convention Over Configuration

MapStruct menggunakan convention:

```text
source.getReferenceNo() → target.setReferenceNo(...)
source.getStatus()      → target.setStatus(...)
source.getCreatedAt()   → target.setCreatedAt(...)
```

Kalau nama sama dan type compatible, mapping otomatis.

Jika nama berbeda:

```java
public class Application {
    private String referenceNumber;
}

public class ApplicationResponseDto {
    private String referenceNo;
}
```

Butuh mapping eksplisit:

```java
@Mapper
public interface ApplicationMapper {

    @Mapping(source = "referenceNumber", target = "referenceNo")
    ApplicationResponseDto toResponse(Application application);
}
```

### 10.1 Convention Bagus Jika Semantic Sama

Field name sama tidak selalu berarti meaning sama.

```java
source.status → target.status
```

Pertanyaan senior engineer:

- Apakah status internal boleh diekspos?
- Apakah status internal perlu diterjemahkan ke status eksternal?
- Apakah target status punya enum lifecycle berbeda?
- Apakah status perlu masking/aggregation?
- Apakah status deprecated?

Jika semantic tidak sama, jangan mengandalkan convention.

Gunakan explicit mapping/conversion:

```java
@Mapping(source = "status", target = "displayStatus", qualifiedByName = "toDisplayStatus")
ApplicationResponseDto toResponse(Application application);
```

---

## 11. Component Model: Plain, Spring, CDI, Jakarta

MapStruct mapper bisa dipakai dengan beberapa model.

### 11.1 Plain Mapper

```java
@Mapper
public interface UserMapper {
    UserMapper INSTANCE = Mappers.getMapper(UserMapper.class);
    UserDto toDto(User user);
}
```

Cocok untuk:

- library kecil;
- unit test sederhana;
- environment tanpa DI;
- mapping pure tanpa dependency.

Kekurangan:

- singleton static membuat dependency management kurang fleksibel;
- kurang cocok untuk aplikasi Spring/Jakarta besar;
- sulit mock/replace pada test tertentu.

### 11.2 Spring Component Model

```java
@Mapper(componentModel = "spring")
public interface UserMapper {
    UserDto toDto(User user);
}
```

Generated implementation akan menjadi Spring bean.

Cocok untuk Spring Boot service.

### 11.3 CDI / Jakarta Component Model

```java
@Mapper(componentModel = "cdi")
public interface UserMapper {
    UserDto toDto(User user);
}
```

Cocok untuk Jakarta EE/MicroProfile/CDI-based runtime.

### 11.4 Rekomendasi

Untuk codebase enterprise:

- gunakan component model konsisten;
- jangan campur static `INSTANCE` dan DI tanpa alasan;
- set global compiler arg agar tidak perlu ulang di setiap mapper;
- hindari mapper yang butuh terlalu banyak dependency.

---

## 12. Mapper Seharusnya Mostly Pure

Idealnya mapper:

```text
input object(s) → output object
```

Tanpa:

- database call;
- HTTP call;
- authorization check;
- mutable global state;
- random value;
- current time langsung;
- side effect;
- event publishing.

Mapping yang pure lebih mudah:

- dites;
- diulang;
- direplay;
- di-debug;
- di-review;
- dioptimasi.

Namun real-world mapping kadang butuh context:

- locale;
- timezone;
- current user display preference;
- reference data snapshot;
- masking policy;
- tenant context;
- external code mapping table.

Untuk itu MapStruct menyediakan `@Context`, lifecycle hooks, dan custom methods. Tetapi prinsipnya tetap:

> Context boleh dipakai untuk mapping policy yang deterministic. Jangan jadikan mapper sebagai service layer tersembunyi.

---

## 13. Generated Code dan Null Handling Default

MapStruct biasanya menghasilkan null guard untuk source object:

```java
if (source == null) {
    return null;
}
```

Ini nyaman, tetapi perlu dipahami.

Jika method contract seharusnya tidak menerima null, silent null return bisa menyembunyikan bug.

Pilihan desain:

### 13.1 Null as Valid Absence

```java
UserDto toDto(User user);
```

Input null → output null bisa diterima untuk nested optional object.

### 13.2 Null as Programming Error

Untuk boundary penting, bisa bungkus mapper:

```java
public UserDto toRequiredDto(User user) {
    return mapper.toDto(Objects.requireNonNull(user, "user must not be null"));
}
```

Atau buat policy team:

```text
Top-level mapper input tidak boleh null.
Nested mapper boleh null-safe.
```

### 13.3 Null Strategy Akan Dibahas Lagi

Null handling untuk update/patch jauh lebih kompleks dan akan dibahas khusus di Part 20.

---

## 14. MapStruct vs Jackson: Jangan Campur Tanggung Jawab

Kesalahan umum:

```java
@JsonProperty("reference_no")
private String referenceNo;
```

Lalu engineer mengira ini juga memengaruhi MapStruct.

Tidak selalu. Jackson annotation mengatur JSON binding. MapStruct mengatur Java-to-Java mapping.

Contoh:

```java
public class ApplicationResponseDto {
    @JsonProperty("reference_no")
    private String referenceNo;
}
```

MapStruct tetap melihat Java property:

```text
referenceNo
```

Bukan:

```text
reference_no
```

Mental model:

```text
MapStruct: Java property ↔ Java property
Jackson: Java property ↔ JSON property
```

Maka pipeline:

```text
Entity.referenceNumber
  ↓ MapStruct @Mapping(source="referenceNumber", target="referenceNo")
Dto.referenceNo
  ↓ Jackson @JsonProperty("reference_no")
JSON.reference_no
```

Jangan membuat mapper bergantung pada nama JSON kecuali memang DTO-nya mendesain property Java sebagai representasi contract eksternal.

---

## 15. MapStruct vs Lombok: Dua Annotation Processor yang Harus Kooperatif

Lombok juga annotation processor, tetapi bekerja dengan cara yang lebih invasif karena ia memodifikasi AST/source model yang dilihat compiler.

Contoh Lombok:

```java
@Getter
@Setter
public class User {
    private Long id;
    private String username;
}
```

Secara source, getter/setter tidak terlihat. MapStruct perlu “melihat” getter/setter setelah Lombok memproses class.

Karena itu setup MapStruct + Lombok harus benar.

Maven example:

```xml
<annotationProcessorPaths>
    <path>
        <groupId>org.projectlombok</groupId>
        <artifactId>lombok</artifactId>
        <version>${lombok.version}</version>
    </path>
    <path>
        <groupId>org.projectlombok</groupId>
        <artifactId>lombok-mapstruct-binding</artifactId>
        <version>0.2.0</version>
    </path>
    <path>
        <groupId>org.mapstruct</groupId>
        <artifactId>mapstruct-processor</artifactId>
        <version>${mapstruct.version}</version>
    </path>
</annotationProcessorPaths>
```

Gradle:

```groovy
dependencies {
    compileOnly "org.projectlombok:lombok:${lombokVersion}"
    annotationProcessor "org.projectlombok:lombok:${lombokVersion}"
    annotationProcessor "org.projectlombok:lombok-mapstruct-binding:0.2.0"

    implementation "org.mapstruct:mapstruct:${mapstructVersion}"
    annotationProcessor "org.mapstruct:mapstruct-processor:${mapstructVersion}"
}
```

Failure mode umum:

```text
Unknown property "x" in result type
```

Padahal field ada di source code Lombok.

Kemungkinan penyebab:

- Lombok processor tidak aktif;
- MapStruct processor aktif tetapi Lombok tidak;
- ordering/coordination problem;
- IDE annotation processing disabled;
- module build tidak membawa processor path;
- annotation processor hanya dikonfigurasi di root, tidak di submodule;
- generated sources tidak dikenali IDE.

---

## 16. IDE Behavior: Build Sukses Tapi Editor Merah, atau Sebaliknya

Annotation processing punya dua dunia:

```text
Command-line build: Maven/Gradle/javac
IDE build/indexing: IntelliJ/Eclipse/VS Code
```

Masalah umum:

### 16.1 Maven Build Sukses, IDE Merah

Penyebab:

- IDE annotation processing belum enable;
- generated sources belum di-mark sebagai generated;
- plugin MapStruct/Lombok belum aktif;
- IDE memakai JDK berbeda;
- IDE import Maven/Gradle stale.

### 16.2 IDE Sukses, CI Gagal

Penyebab:

- IDE menyembunyikan processor config;
- local generated source tertinggal;
- CI tidak punya annotationProcessorPaths;
- Maven profile berbeda;
- Gradle incremental processing berbeda;
- JDK CI berbeda.

Rule:

> Source of truth adalah clean command-line build di CI, bukan feeling dari IDE.

Selalu validasi:

```bash
mvn clean test
```

atau:

```bash
./gradlew clean test
```

---

## 17. Incremental Compilation dan Generated Source Staleness

Generated source bisa stale jika build tidak clean.

Contoh:

1. DTO punya `fullName`.
2. Mapper generated memakai `setFullName`.
3. DTO diubah menjadi `displayName`.
4. IDE/incremental build gagal regenerate sebagian source.
5. Error terlihat aneh.

Mitigasi:

- jika error MapStruct aneh, lakukan clean build;
- jangan commit generated source untuk normal Maven/Gradle project;
- pastikan generated source directory tidak dianggap source utama;
- di CI gunakan clean build untuk branch validation penting;
- jangan debugging MapStruct dari cache build kotor.

---

## 18. Java 8 sampai Java 25: Apa yang Berubah untuk Mapper?

MapStruct tetap konsepnya sama, tetapi Java object model berkembang besar dari Java 8 ke Java 25.

### 18.1 Java 8 Era

Model umum:

```java
public class UserDto {
    private Long id;
    private String name;

    public UserDto() {}

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
}
```

Mapping target biasanya mutable bean.

Kelebihan:

- compatible luas;
- mudah untuk Jackson/JPA/MapStruct;
- familiar.

Kekurangan:

- mutability tinggi;
- object bisa berada dalam state setengah jadi;
- constructor invariant lemah;
- setter public bisa disalahgunakan.

### 18.2 Java 16+ Records

Record:

```java
public record UserDto(Long id, String name) {}
```

Mapping membutuhkan constructor canonical.

Generated code kira-kira:

```java
return new UserDto(user.getId(), user.getName());
```

Kelebihan:

- immutable data carrier;
- shape eksplisit;
- cocok untuk DTO response/query;
- mengurangi Lombok `@Value`/boilerplate.

Kekurangan:

- tidak cocok untuk semua framework lama;
- constructor parameter harus jelas;
- update mapping tidak natural;
- binary/source compatibility perlu dipikirkan;
- menambah komponen record bisa breaking untuk caller Java.

### 18.3 Java 17+ Sealed Types

Sealed hierarchy:

```java
public sealed interface PaymentDto permits CardPaymentDto, BankTransferPaymentDto {}
```

MapStruct bisa berguna untuk mapping subtype, tetapi desain discriminator dan polymorphic conversion tetap tanggung jawab engineer.

### 18.4 Java 21+ Sequenced Collections

Java 21 memperkenalkan sequenced collection interfaces. Ini relevan untuk mapping karena order bisa menjadi bagian dari contract.

Contoh case:

```text
approvalHistory[0] = first approval
approvalHistory[last] = latest approval
```

Mapper tidak boleh sembarang mengganti collection menjadi unordered set jika order bermakna.

### 18.5 Java 25

Untuk Java 25, prinsip mapping tetap sama: MapStruct generated code harus compile terhadap platform target. Hal yang perlu dijaga:

- annotation processor kompatibel dengan JDK compiler yang dipakai;
- Lombok kompatibel dengan JDK yang dipakai;
- build tool mendukung JDK tersebut;
- CI memakai toolchain eksplisit;
- generated code diperiksa saat upgrade JDK.

---

## 19. MapStruct dan Java Module System

Jika memakai Java Platform Module System, annotation processing dan generated code perlu diperhatikan.

Contoh module:

```java
module com.example.application {
    requires org.mapstruct;

    exports com.example.application.dto;
    exports com.example.application.mapper;
}
```

Praktiknya, banyak enterprise Spring apps belum memakai JPMS penuh. Tetapi jika memakai module system:

- pastikan module exports package yang perlu dilihat;
- generated implementation berada pada package mapper;
- dependency annotation tersedia compile time;
- reflection framework seperti Spring/Jackson punya akses jika diperlukan;
- jangan campur module encapsulation dengan framework magic tanpa rencana.

MapStruct sendiri generated plain Java, tetapi build/module config tetap bisa menjadi failure point.

---

## 20. Inspecting Generated Code: Checklist Senior Engineer

Saat membuka generated mapper, cek:

### 20.1 Null Behavior

Apakah generated method mengembalikan null jika source null?

```java
if (source == null) {
    return null;
}
```

Apakah sesuai contract?

### 20.2 Nested Chain

Apakah ada chain panjang?

```java
source.getA().getB().getC().getD()
```

Jika iya, cek:

- null risk;
- lazy loading risk;
- domain leakage;
- fetch plan;
- DTO design.

### 20.3 Collection Copy

Apakah collection dibuat baru?

```java
List<ItemDto> list = new ArrayList<>(items.size());
```

Apakah shallow/deep mapping sesuai?

### 20.4 Enum Mapping

Apakah enum dimapping by same name?

```java
TargetStatus.valueOf(sourceStatus.name())
```

Apakah aman untuk evolution?

### 20.5 Conversion Method

Apakah MapStruct memilih conversion method yang benar?

Jika ada banyak method `String -> String`, `Code -> String`, `Status -> String`, hati-hati ambiguous atau salah pilih.

### 20.6 Builder Usage

Apakah target dibuat via builder atau setter?

```java
return UserDto.builder()
    .id(user.getId())
    .name(user.getName())
    .build();
```

Apakah builder Lombok/Jackson/MapStruct saling cocok?

### 20.7 Dependency Injection

Apakah generated implementation menggunakan constructor injection/field injection sesuai policy?

---

## 21. Mapper Interface sebagai Contract, Generated Impl sebagai Implementation

Mapper interface sebaiknya dibaca sebagai **mapping contract**.

```java
@Mapper(config = CentralMapperConfig.class)
public interface ApplicationMapper {

    @Mapping(source = "referenceNumber", target = "referenceNo")
    @Mapping(source = "status", target = "status", qualifiedByName = "toExternalStatus")
    ApplicationResponseDto toResponse(Application application);
}
```

Contract ini menyatakan:

- source model: `Application`;
- target model: `ApplicationResponseDto`;
- field rename: `referenceNumber → referenceNo`;
- status tidak direct copy, tetapi lewat conversion;
- mapper mengikuti config pusat.

Generated impl adalah detail teknis yang memastikan contract dijalankan.

---

## 22. Central Mapper Config

Untuk codebase besar, jangan konfigurasi mapper satu per satu secara liar.

Buat config pusat:

```java
@MapperConfig(
    componentModel = "spring",
    unmappedTargetPolicy = ReportingPolicy.ERROR,
    injectionStrategy = InjectionStrategy.CONSTRUCTOR
)
public interface CentralMapperConfig {
}
```

Mapper:

```java
@Mapper(config = CentralMapperConfig.class)
public interface UserMapper {
    UserDto toDto(User user);
}
```

Benefit:

- policy seragam;
- review lebih mudah;
- migration lebih mudah;
- menghindari mapper dengan behavior berbeda tanpa alasan;
- bisa dipakai untuk enforce architecture.

### 22.1 Policy yang Layak Dipusatkan

- `componentModel`;
- `unmappedTargetPolicy`;
- `unmappedSourcePolicy` jika diperlukan;
- `injectionStrategy`;
- null value mapping strategy;
- collection mapping strategy;
- builder config;
- mapping inheritance strategy.

Namun jangan over-centralize. Beberapa boundary memang butuh policy berbeda:

```text
External inbound mapper: strict
Internal projection mapper: maybe less strict
Legacy integration mapper: tolerant but explicit
Patch mapper: custom null semantics
```

---

## 23. Kapan MapStruct Cocok?

MapStruct cocok jika:

- mapping antar Java object cukup banyak;
- shape source-target relatif stabil;
- ingin compile-time feedback;
- ingin generated code yang bisa dibaca;
- ingin performance seperti manual mapping;
- ingin mengurangi boilerplate;
- ingin mapping DTO/entity/event/projection konsisten;
- tim disiplin dengan annotation processing.

Contoh bagus:

```text
Entity → Response DTO
Request DTO → Command
Domain Event → Event Payload
External API DTO → Internal Adapter DTO
Read Model → API View
```

---

## 24. Kapan MapStruct Tidak Cocok?

MapStruct kurang cocok jika:

- mapping sangat dynamic berdasarkan metadata runtime;
- target shape tidak diketahui saat compile;
- transformasi sangat rule-driven dan berubah oleh konfigurasi user;
- butuh scripting/mapping DSL runtime;
- mapping bergantung pada banyak query/service call;
- object graph terlalu tidak terstruktur;
- data lebih cocok diproses sebagai stream/tree JSON;
- struktur source/target sering berubah tanpa compile-time ownership.

Contoh:

```text
User-defined report column mapping
Dynamic form schema mapping
Arbitrary JSON transformation
ETL rule engine with runtime config
Low-level streaming large JSON processing
```

Untuk ini, mungkin lebih cocok:

- Jackson streaming/tree;
- custom transformation engine;
- rule engine;
- SQL projection;
- explicit manual pipeline;
- schema-driven mapper.

---

## 25. Anti-Pattern: Mapper Menjadi Hidden Business Layer

Contoh buruk:

```java
@Mapper(componentModel = "spring", uses = {UserRepository.class, PermissionService.class})
public abstract class ApplicationMapper {

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private PermissionService permissionService;

    @AfterMapping
    protected void enrich(@MappingTarget ApplicationDto dto, Application app) {
        User officer = userRepository.findById(app.getOfficerId()).orElse(null);
        dto.setOfficerName(officer.getName());
        dto.setEditable(permissionService.canEdit(app));
    }
}
```

Masalah:

- mapper melakukan database access;
- authorization logic tersembunyi;
- mapping tidak pure;
- test jadi berat;
- performance tidak terlihat;
- N+1 query risk;
- sulit reason tentang service behavior.

Desain lebih baik:

```java
public ApplicationDto getApplication(String id, UserContext userContext) {
    ApplicationView view = applicationQueryService.getApplicationView(id);
    boolean editable = permissionService.canEdit(id, userContext);
    return mapper.toDto(view, editable);
}
```

Mapper:

```java
@Mapper(config = CentralMapperConfig.class)
public interface ApplicationMapper {

    @Mapping(source = "view.id", target = "id")
    @Mapping(source = "view.referenceNo", target = "referenceNo")
    @Mapping(source = "editable", target = "editable")
    ApplicationDto toDto(ApplicationView view, boolean editable);
}
```

Business/service orchestration tetap di application service. Mapper hanya membentuk DTO.

---

## 26. Anti-Pattern: Satu Mapper untuk Semua Hal

Contoh buruk:

```java
@Mapper
public interface CommonMapper {
    UserDto toUserDto(User user);
    User toUser(UserDto dto);
    ApplicationDto toApplicationDto(Application app);
    Application toApplication(ApplicationDto dto);
    AppealDto toAppealDto(Appeal appeal);
    Appeal toAppeal(AppealDto dto);
    EventPayload toEvent(Application app);
    ReportRow toReportRow(Application app);
}
```

Masalah:

- ownership kabur;
- mapper tumbuh menjadi god class;
- dependency `uses` membengkak;
- perubahan satu domain memengaruhi mapper lain;
- review sulit;
- generated implementation besar;
- layer boundary hilang.

Lebih baik:

```text
application/api/ApplicationResponseMapper
application/command/ApplicationCommandMapper
application/event/ApplicationEventMapper
application/persistence/ApplicationEntityMapper
appeal/api/AppealResponseMapper
report/ApplicationReportMapper
```

Mapper harus mengikuti boundary dan use case, bukan sekadar entity name.

---

## 27. Anti-Pattern: Bidirectional Mapping Tanpa Berpikir

Banyak engineer membuat:

```java
UserDto toDto(User user);
User toEntity(UserDto dto);
```

Seolah mapping selalu reversible.

Padahal banyak mapping tidak reversible:

```text
Entity.firstName + Entity.lastName → Dto.fullName
Dto.fullName → Entity.firstName + Entity.lastName ???
```

Atau:

```text
Entity.internalStatus → Dto.displayStatus
Dto.displayStatus → Entity.internalStatus ???
```

Atau:

```text
Entity.secret → not exposed
Dto → Entity.secret ???
```

Prinsip:

> Mapping direction adalah contract terpisah. Jangan membuat inverse mapping hanya karena MapStruct mendukungnya.

Inbound dan outbound mapping biasanya berbeda:

```text
Request DTO → Command
Entity → Response DTO
```

Bukan:

```text
DTO ↔ Entity
```

---

## 28. Anti-Pattern: Entity Directly to Public DTO Tanpa Boundary Policy

MapStruct membuat entity-to-DTO mudah. Ini bisa berbahaya jika desain DTO terlalu dekat dengan entity.

Contoh:

```java
@Mapper
public interface UserMapper {
    UserDto toDto(UserEntity entity);
}
```

Jika `UserDto` mirip entity:

```java
public class UserDto {
    private Long id;
    private String username;
    private String passwordHash;
    private String internalRole;
    private Instant createdAt;
    private Instant deletedAt;
}
```

Maka MapStruct bisa membantu membocorkan field internal dengan sangat efisien.

Gunakan public DTO yang deny-by-default:

```java
public record UserProfileResponse(
    Long id,
    String username,
    String displayName
) {}
```

Mapper:

```java
@Mapper(config = CentralMapperConfig.class)
public interface UserProfileMapper {
    UserProfileResponse toProfile(UserEntity entity);
}
```

Jangan biarkan MapStruct menggantikan security review.

---

## 29. Build-Time Failure sebagai Governance Tool

MapStruct paling bernilai ketika build failure dianggap governance, bukan gangguan.

Contoh target DTO berubah:

```java
public record ApplicationResponse(
    String referenceNo,
    String status,
    String assignedOfficerName
) {}
```

Mapper belum mengisi `assignedOfficerName`.

Dengan strict policy, build gagal.

Artinya reviewer harus memilih:

```java
@Mapping(target = "assignedOfficerName", source = "assignedOfficer.name")
```

atau:

```java
@Mapping(target = "assignedOfficerName", ignore = true)
```

atau desain ulang:

```java
ApplicationResponse toResponse(ApplicationView view);
```

Build failure memaksa keputusan eksplisit.

---

## 30. MapStruct Dalam Layered Architecture

Contoh layered architecture:

```text
controller
  request/response DTO
  mapper: API DTO ↔ command/query response

application
  command/query model
  service orchestration
  mapper: domain/application view ↔ response model if needed

domain
  aggregate/entity/value object
  ideally no dependency to MapStruct

infrastructure.persistence
  JPA entity / projection
  mapper: entity ↔ domain model if using separate persistence model

infrastructure.integration
  external API DTO/XML/JSON model
  mapper: external contract ↔ internal adapter model
```

Prinsip dependency:

```text
Outer layer may depend on mapper.
Domain core should not depend on MapStruct unless you intentionally accept that dependency.
```

Domain object sebaiknya tidak tahu DTO.

Buruk:

```java
public class Application {
    public ApplicationDto toDto() { ... }
}
```

Lebih baik:

```java
ApplicationDto dto = applicationMapper.toDto(application);
```

Atau untuk domain behavior:

```java
application.currentDisplayStatus()
```

Lalu mapper memakai method domain tersebut.

---

## 31. MapStruct Dalam Hexagonal Architecture

Hexagonal architecture:

```text
Inbound Adapter        Application Core        Outbound Adapter
REST Controller  →     Use Case          →     Database/API/Message
```

Mapper biasanya berada di adapter:

```text
REST request DTO → command
query result → REST response DTO
external API payload → internal model
internal event → broker payload
```

Core tidak perlu tahu bentuk JSON eksternal.

Contoh:

```java
@RestController
public class ApplicationController {

    private final SubmitApplicationUseCase useCase;
    private final ApplicationApiMapper mapper;

    @PostMapping("/applications")
    public ApplicationResponse submit(@RequestBody SubmitApplicationRequest request) {
        SubmitApplicationCommand command = mapper.toCommand(request);
        ApplicationResult result = useCase.submit(command);
        return mapper.toResponse(result);
    }
}
```

Mapper adapter:

```java
@Mapper(config = CentralMapperConfig.class)
public interface ApplicationApiMapper {
    SubmitApplicationCommand toCommand(SubmitApplicationRequest request);
    ApplicationResponse toResponse(ApplicationResult result);
}
```

Core tetap bersih dari DTO HTTP.

---

## 32. MapStruct Dalam Microservices dan Contract Evolution

Di microservices, mapper sering menjadi tempat boundary antar service.

Contoh:

```text
Case Service domain model
  ↓ mapper
CaseSubmittedEvent v1
  ↓ broker
Notification Service
```

Jika event contract berubah, mapper harus explicit.

Jangan langsung expose domain object sebagai event.

Buruk:

```java
publisher.publish(applicationEntity);
```

Lebih baik:

```java
ApplicationSubmittedEvent event = eventMapper.toSubmittedEvent(application);
publisher.publish(event);
```

MapStruct membantu memastikan event payload dihasilkan konsisten, tetapi versioning tetap perlu desain:

```text
ApplicationSubmittedEventV1
ApplicationSubmittedEventV2
```

Mapper terpisah:

```java
ApplicationSubmittedEventV1 toV1(Application app);
ApplicationSubmittedEventV2 toV2(Application app);
```

---

## 33. Debugging MapStruct: Cara Berpikir

Jika mapping error, jangan random edit annotation. Lakukan diagnosis sistematis.

### 33.1 Apakah Processor Jalan?

Cek generated sources:

```bash
find target/generated-sources/annotations -name '*MapperImpl.java'
```

atau:

```bash
find build/generated -name '*MapperImpl.java'
```

Jika tidak ada implementation:

- processor belum dikonfigurasi;
- annotation processing disabled;
- mapper tidak terdeteksi;
- build module salah;
- compile gagal sebelum processor selesai.

### 33.2 Apakah Property Terlihat?

MapStruct melihat properties melalui accessor/constructor/builder.

Cek:

- getter ada?
- setter ada?
- field private tanpa accessor?
- Lombok processor aktif?
- record component cocok?
- builder method sesuai convention?
- target immutable punya constructor usable?

### 33.3 Apakah Type Compatible?

MapStruct bisa mapping jika:

- same type;
- assignable type;
- built-in conversion;
- ada mapping method lain;
- ada custom conversion method;
- ada mapper di `uses`.

Jika tidak, harus explicit.

### 33.4 Apakah Ada Ambiguous Method?

Contoh:

```java
String map(Code code) { ... }
String convert(Code code) { ... }
```

MapStruct bisa bingung memilih. Gunakan qualifier.

### 33.5 Apakah Generated Code Sesuai Ekspektasi?

Buka implementation. Jangan menebak.

---

## 34. Build Reproducibility dan CI Policy

Untuk codebase enterprise, MapStruct harus masuk governance build.

Rekomendasi:

```text
1. Pin MapStruct version.
2. Pin Lombok version jika digunakan.
3. Pin Java toolchain version.
4. Jalankan clean build di CI.
5. Fail build on unmapped target.
6. Jangan commit generated mapper implementation.
7. Dokumentasikan annotation processor setup.
8. Pastikan IDE onboarding mencakup annotation processing.
9. Saat upgrade JDK, regenerate dan inspect generated code sample.
10. Saat upgrade MapStruct, baca migration notes.
```

Kenapa jangan commit generated mapper?

Karena generated source adalah output build, bukan source of truth. Jika di-commit, bisa terjadi drift:

```text
Mapper interface berubah
Generated impl committed lama
Reviewer bingung mana yang benar
```

Exception: beberapa environment strict mungkin melakukan generated-source audit, tetapi itu harus deliberate policy, bukan kebiasaan acak.

---

## 35. MapStruct dan Testing

MapStruct generated code tetap harus dites, tetapi strateginya berbeda.

Jangan test MapStruct internal. Test mapping contract.

Contoh:

```java
class ApplicationMapperTest {

    private final ApplicationMapper mapper = Mappers.getMapper(ApplicationMapper.class);

    @Test
    void mapsApplicationToResponse() {
        Application app = new Application();
        app.setReferenceNumber("APP-001");
        app.setStatus(ApplicationStatus.SUBMITTED);

        ApplicationResponseDto dto = mapper.toResponse(app);

        assertThat(dto.getReferenceNo()).isEqualTo("APP-001");
        assertThat(dto.getStatus()).isEqualTo("SUBMITTED");
    }
}
```

Untuk Spring component model, bisa test dengan Spring context jika perlu, tetapi untuk mapper pure, no-Spring unit test lebih cepat.

Testing focus:

- renamed fields;
- custom conversion;
- enum mapping;
- null behavior;
- nested mapping;
- collection mapping;
- update mapping;
- boundary-specific redaction;
- versioned event payload;
- generated JSON after Jackson serialization jika mapper output adalah API DTO.

Testing akan dibahas lebih dalam di Part 29.

---

## 36. Performance Mental Model

MapStruct generated code biasanya setara manual mapping dalam kategori umum.

Performa utama dipengaruhi oleh:

- jumlah object baru yang dibuat;
- ukuran collection;
- nested graph depth;
- conversion logic;
- string/date formatting;
- lazy loading side effect;
- boxing/unboxing;
- defensive copy;
- target immutability/builder overhead;
- allocation rate.

MapStruct tidak otomatis menyelamatkan desain buruk.

Jika mapper melakukan:

```text
100,000 entity → DTO
masing-masing punya 20 nested children
masing-masing child punya 10 grandchildren
```

Masalahnya bukan “MapStruct lambat”. Masalahnya object graph explosion.

Part 30 akan membahas performance dan memory engineering khusus mapping layer.

---

## 37. Failure Model MapStruct

MapStruct mengurangi beberapa failure class, tetapi menambah failure class lain.

### 37.1 Failure yang Dikurangi

| Failure | Mengapa berkurang |
|---|---|
| Typo field mapping | compile-time checking |
| Missing target field | strict unmapped target policy |
| Runtime reflection error | generated plain Java |
| Hidden mapping behavior | generated source inspectable |
| Manual copy-paste bug | generator handles repetitive mapping |

### 37.2 Failure yang Masih Ada

| Failure | Kenapa masih bisa terjadi |
|---|---|
| Semantic mismatch | MapStruct tidak tahu meaning |
| Sensitive data leakage | field compatible tetap bisa termapping |
| Wrong enum policy | same-name enum mapping bisa salah secara bisnis |
| Null semantic bug | null/absent/default harus didesain |
| Lazy loading storm | mapper access getter yang trigger DB |
| Over-mapping | DTO terlalu mirip entity |
| Wrong abstraction | mapper jadi service layer |

### 37.3 Failure Baru dari Tooling

| Failure | Contoh |
|---|---|
| Annotation processor not running | `MapperImpl` tidak generated |
| IDE/CI mismatch | lokal hijau, CI merah |
| Lombok ordering issue | property tidak ditemukan |
| Version incompatibility | upgrade JDK/MapStruct/Lombok gagal |
| Generated source stale | incremental build aneh |

Top engineer tidak hanya tahu annotation MapStruct. Ia tahu failure model-nya.

---

## 38. Design Heuristics

Gunakan heuristics berikut.

### 38.1 Jika Mapping Hanya Copy Field Sama Nama

MapStruct sangat cocok.

```java
UserDto toDto(User user);
```

### 38.2 Jika Mapping Banyak Rename tapi Masih Structural

MapStruct masih cocok, dengan explicit `@Mapping`.

```java
@Mapping(source = "referenceNumber", target = "referenceNo")
ApplicationDto toDto(Application app);
```

### 38.3 Jika Mapping Banyak Semantic Conversion

MapStruct bisa dipakai, tetapi conversion harus explicit dan dites.

```java
@Mapping(source = "status", target = "displayStatus", qualifiedByName = "toDisplayStatus")
```

### 38.4 Jika Mapping Butuh Query/Permission/Workflow Decision

Jangan taruh di mapper. Taruh di service, lalu berikan hasilnya ke mapper.

### 38.5 Jika Mapping Dynamic Runtime

MapStruct mungkin bukan tool utama.

### 38.6 Jika Target Adalah Public API

Gunakan strict policy, deny-by-default DTO, test golden payload.

### 38.7 Jika Source Entity Punya Lazy Relationship

Hati-hati. Lebih baik query projection atau view model.

---

## 39. Practical Example: Case Management Mapping Boundary

Domain-ish entity:

```java
public class EnforcementCase {
    private Long id;
    private String caseNo;
    private CaseStatus status;
    private Officer assignedOfficer;
    private Instant createdAt;
    private Instant updatedAt;
    private String internalRemarks;

    // getters/setters
}
```

Public response DTO:

```java
public record CaseSummaryResponse(
    Long id,
    String caseNo,
    String status,
    String assignedOfficerName,
    Instant createdAt
) {}
```

Mapper:

```java
@Mapper(config = CentralMapperConfig.class)
public interface CaseSummaryMapper {

    @Mapping(source = "status", target = "status", qualifiedByName = "toPublicStatus")
    @Mapping(source = "assignedOfficer.name", target = "assignedOfficerName")
    CaseSummaryResponse toSummary(EnforcementCase enforcementCase);

    @Named("toPublicStatus")
    default String toPublicStatus(CaseStatus status) {
        if (status == null) {
            return null;
        }
        return switch (status) {
            case DRAFT -> "Draft";
            case SUBMITTED -> "Submitted";
            case UNDER_REVIEW -> "Under Review";
            case CLOSED -> "Closed";
        };
    }
}
```

Generated code akan membuat record via constructor.

Pertanyaan review:

- Apakah `assignedOfficer` selalu loaded?
- Apakah public status mapping stabil?
- Apakah `internalRemarks` tidak bocor?
- Apakah null officer acceptable?
- Apakah `createdAt` timezone/format diselesaikan oleh Jackson?
- Apakah status baru akan membuat compile failure pada switch expression?

MapStruct membantu, tetapi review tetap perlu.

---

## 40. Practical Example: Request DTO to Command

Request DTO:

```java
public record SubmitCaseRequest(
    String subjectId,
    String allegationType,
    String description
) {}
```

Command:

```java
public record SubmitCaseCommand(
    String subjectId,
    AllegationType allegationType,
    String description
) {}
```

Mapper:

```java
@Mapper(config = CentralMapperConfig.class)
public interface SubmitCaseCommandMapper {

    @Mapping(source = "allegationType", target = "allegationType", qualifiedByName = "parseAllegationType")
    SubmitCaseCommand toCommand(SubmitCaseRequest request);

    @Named("parseAllegationType")
    default AllegationType parseAllegationType(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return AllegationType.valueOf(value.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException ex) {
            throw new InvalidMappingException("Unknown allegationType: " + value);
        }
    }
}
```

Namun hati-hati: parsing invalid value mungkin lebih cocok di validation layer atau custom Jackson deserializer, tergantung boundary design.

Pertanyaan desain:

```text
Apakah invalid allegationType adalah deserialization error, validation error, atau mapping error?
```

Tidak ada jawaban universal. Yang penting konsisten.

---

## 41. Practical Example: Event Payload Versioning

Domain event internal:

```java
public record CaseSubmitted(
    Long caseId,
    String caseNo,
    CaseStatus status,
    Instant submittedAt
) {}
```

External broker payload v1:

```java
public record CaseSubmittedEventV1(
    String eventType,
    String caseNo,
    String status,
    String submittedAt
) {}
```

Mapper:

```java
@Mapper(config = CentralMapperConfig.class)
public interface CaseEventMapper {

    @Mapping(target = "eventType", constant = "CASE_SUBMITTED")
    @Mapping(source = "status", target = "status", qualifiedByName = "statusCode")
    @Mapping(source = "submittedAt", target = "submittedAt", qualifiedByName = "isoInstant")
    CaseSubmittedEventV1 toV1(CaseSubmitted event);

    @Named("statusCode")
    default String statusCode(CaseStatus status) {
        return status == null ? null : status.name();
    }

    @Named("isoInstant")
    default String isoInstant(Instant instant) {
        return instant == null ? null : DateTimeFormatter.ISO_INSTANT.format(instant);
    }
}
```

Kenapa tidak langsung kirim `CaseSubmitted`?

Karena internal event dan external payload punya lifecycle berbeda.

MapStruct menjadi boundary translator.

---

## 42. Team Standard yang Disarankan

Untuk codebase serius, buat standar seperti ini:

```text
1. Semua mapper production memakai @Mapper(config = CentralMapperConfig.class).
2. unmappedTargetPolicy = ERROR sebagai default.
3. Field yang sengaja tidak dimapping harus @Mapping(ignore = true).
4. Tidak boleh database/network call di mapper.
5. Mapper tidak boleh melakukan authorization decision.
6. Mapper public API harus punya unit test minimal untuk renamed/custom/sensitive fields.
7. Entity-to-public-response harus direview security.
8. Inbound request tidak boleh langsung dimap ke JPA entity.
9. Bidirectional mapper tidak boleh dibuat otomatis tanpa kebutuhan.
10. Generated code boleh diinspeksi, tetapi tidak diubah manual.
11. Lombok + MapStruct wajib punya processor config eksplisit.
12. Clean build wajib jalan di CI.
```

---

## 43. Common Error Messages dan Maknanya

### 43.1 Unknown Property in Result Type

Contoh:

```text
Unknown property "name" in result type UserDto.
```

Kemungkinan:

- target tidak punya setter/constructor parameter;
- Lombok getter/setter belum terlihat;
- typo target;
- target immutable tanpa builder/constructor cocok;
- property berbeda nama.

### 43.2 Unmapped Target Property

```text
Unmapped target property: "displayName".
```

Makna:

- target punya field baru;
- MapStruct tidak tahu cara mengisi;
- harus source mapping, expression, constant, default, atau ignore.

Ini bukan error yang harus “dimatikan”. Ini feedback desain.

### 43.3 Ambiguous Mapping Methods

```text
Ambiguous mapping methods found for mapping property...
```

Makna:

- MapStruct menemukan lebih dari satu candidate conversion;
- perlu qualifier;
- terlalu banyak generic conversion method di mapper/uses.

### 43.4 Cannot Find Implementation

Runtime:

```text
Cannot find implementation for UserMapper
```

Kemungkinan:

- annotation processor tidak jalan;
- generated class tidak compile;
- mapper tidak ada di classpath;
- menggunakan `Mappers.getMapper` pada setup DI yang salah;
- module/package issue.

---

## 44. MapStruct Bukan Pengganti OpenAPI/Jackson/Validation

MapStruct tidak menjawab:

- apakah JSON field required;
- apakah null diterima inbound;
- apakah format tanggal benar;
- apakah value valid secara domain;
- apakah response sesuai OpenAPI;
- apakah XML namespace benar;
- apakah payload backward compatible;
- apakah user boleh melihat field tertentu.

MapStruct menjawab:

```text
Given Java source object(s), how do I create Java target object(s)?
```

Karena itu pipeline lengkap tetap membutuhkan:

```text
Jackson/XML parser
Bean Validation/domain validation
MapStruct/manual mapper
Application service
Security policy
Contract tests
```

---

## 45. Latihan Mental Model

### Latihan 1 — DTO Baru

Target DTO ditambah field `lastUpdatedByName`.

Apa yang seharusnya terjadi?

Jawaban yang diinginkan:

- build gagal karena unmapped target;
- engineer memutuskan source field;
- jika butuh join/query, jangan mapper query DB;
- application/query service harus menyediakan view yang sudah punya `lastUpdatedByName`;
- mapper hanya memindahkan view ke DTO.

### Latihan 2 — Sensitive Field

Entity punya `passwordHash`, DTO public tidak punya.

Apakah aman?

Relatif aman jika DTO deny-by-default. Tetapi jika DTO kemudian ditambah `passwordHash` karena copy-paste, strict mapper bisa otomatis map jika nama sama. Maka review/security checklist tetap perlu.

### Latihan 3 — Enum Baru

`CaseStatus` ditambah `REOPENED`.

Apa yang seharusnya terjadi?

- jika direct enum same-name ke DTO string, mungkin tetap jalan tanpa review;
- jika switch expression untuk public status, compile bisa gagal jika exhaustive;
- untuk public contract, explicit mapping lebih aman.

### Latihan 4 — Lombok Getter Tidak Terlihat

MapStruct bilang property tidak ada, padahal ada field Lombok.

Diagnosis:

- cek annotation processor path;
- cek Lombok plugin;
- cek `lombok-mapstruct-binding`;
- cek Maven/Gradle submodule config;
- clean build;
- inspect generated source.

---

## 46. Ringkasan Part 18

MapStruct adalah compile-time mapper generator. Nilai utamanya bukan sekadar mengurangi boilerplate, tetapi membuat mapping:

- type-safe;
- explicit;
- inspectable;
- efficient;
- fail-fast saat compile;
- konsisten antar boundary.

Mental model utama:

```text
Mapper interface = mapping contract
Annotation processor = compiler-time generator
Generated class = plain Java implementation
Build failure = design feedback
Generated code = source of truth runtime behavior
```

MapStruct paling kuat ketika dipakai dengan disiplin:

- strict unmapped target policy;
- boundary-specific mapper;
- no hidden service/database call;
- explicit semantic conversion;
- central mapper config;
- generated code inspection;
- CI clean build;
- annotation processor setup yang reproducible.

MapStruct tidak menggantikan desain DTO, validation, security, OpenAPI contract, Jackson configuration, atau domain modeling. Ia mempercepat mapping yang sudah didesain dengan benar.

---

## 47. Checklist Part 18

Sebelum memakai MapStruct di production codebase, pastikan:

- [ ] Saya paham MapStruct bekerja saat compile, bukan runtime reflection mapper.
- [ ] Saya tahu lokasi generated sources Maven/Gradle.
- [ ] Saya bisa membuka dan membaca `*MapperImpl.java`.
- [ ] Saya membedakan Java property mapping dan JSON property mapping.
- [ ] Saya memakai `unmappedTargetPolicy = ERROR` untuk boundary penting.
- [ ] Saya tidak membuat mapper melakukan DB/network call.
- [ ] Saya tidak membuat bidirectional mapper tanpa alasan.
- [ ] Saya tidak langsung map request DTO ke JPA entity untuk update berbahaya.
- [ ] Saya punya config pusat untuk mapper policy.
- [ ] Saya tahu failure mode Lombok + MapStruct.
- [ ] Saya menjalankan clean build di CI.
- [ ] Saya menulis test untuk custom/semantic/sensitive mapping.

---

## 48. Referensi

- MapStruct official site — Java bean mappings, code generator, convention over configuration: `https://mapstruct.org/`
- MapStruct 1.6.3 Reference Guide — stable reference guide and annotation processor description: `https://mapstruct.org/documentation/stable/reference/html/`
- MapStruct documentation index — stable and beta release references: `https://mapstruct.org/documentation/reference-guide/`
- MapStruct 1.6.0 release notes — new features and generated code improvements: `https://mapstruct.org/news/2024-08-12-mapstruct-1_6_0-is-out/`
- MapStruct 1.7.0 Beta1 news — Optional support and Java 21 Sequenced Collections support: `https://mapstruct.org/news/2026-02-01-mapstruct-1_7_0_Beta1-is-out/`
- MapStruct FAQ — Lombok cooperation and annotation processing notes: `https://mapstruct.org/faq/`
- MapStruct examples — Lombok integration example: `https://github.com/mapstruct/mapstruct-examples/tree/main/mapstruct-lombok`

---

## 49. Transisi ke Part 19

Part 18 membangun mental model MapStruct sebagai compile-time generated mapper. Part 19 akan masuk ke penggunaan inti:

- `@Mapper`;
- `@Mapping`;
- source/target property;
- nested mapping;
- collection mapping;
- map mapping;
- enum mapping;
- constant/default/expression;
- ignore field;
- reporting policy;
- mapper composition.

Part 19 akan lebih praktikal, tetapi tetap dengan reasoning dan failure model.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 17 — XML Edge Cases: Namespace, XSD, SOAP-ish Payloads, Canonicalization](./17-xml-edge-cases-namespace-xsd-soapish-payloads-canonicalization.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 19 — MapStruct Core: Field Mapping, Nested Mapping, Collection Mapping](./19-mapstruct-core-field-nested-collection-mapping.md)

</div>