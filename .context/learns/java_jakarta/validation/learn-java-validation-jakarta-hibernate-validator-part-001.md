# learn-java-validation-jakarta-hibernate-validator-part-001

# Specification Landscape: Bean Validation, Jakarta Validation, `javax` vs `jakarta`

> Seri: `learn-java-validation-jakarta-hibernate-validator`  
> Bagian: `001`  
> Topik: landscape spesifikasi, evolusi API, compatibility, dan konsekuensi migrasi  
> Target pembaca: Java engineer yang sudah memahami Java 8 sampai modern Java, Jakarta/JAX-RS, Spring/Jakarta stack, testing, performance, dan arsitektur sistem besar.

---

## 0. Tujuan Bagian Ini

Bagian sebelumnya membangun mental model bahwa validation adalah bagian dari correctness architecture, bukan sekadar annotation. Bagian ini menjawab pertanyaan yang lebih historis, teknis, dan strategis:

> “Sebenarnya kita sedang memakai spesifikasi apa, API apa, implementation apa, versi mana, dan apa konsekuensinya ketika codebase bergerak dari Java 8 legacy menuju Java 17/21/25 modern stack?”

Setelah menyelesaikan bagian ini, kamu harus bisa:

1. Menjelaskan perbedaan **Bean Validation**, **Jakarta Bean Validation**, **Jakarta Validation**, **Hibernate Validator**, dan framework integration seperti Spring/JAX-RS/JPA.
2. Membaca dependency validation di codebase dan tahu apakah project berada di era `javax.validation` atau `jakarta.validation`.
3. Memahami kenapa migration dari `javax` ke `jakarta` bukan sekadar rename import.
4. Menentukan strategi dependency untuk Java 8, Java 11, Java 17, Java 21, sampai Java 25.
5. Menilai risiko mixed classpath, transitive dependency conflict, dan framework mismatch.
6. Membedakan specification-level feature dari provider-specific feature.
7. Membuat compatibility matrix yang defensible untuk project enterprise.

Sumber resmi yang menjadi anchor:

- Jakarta Validation 3.1 mendefinisikan metadata model dan API untuk JavaBean serta method validation, dan merupakan release untuk Jakarta EE 11.  
  Source: https://jakarta.ee/specifications/bean-validation/3.1/
- Jakarta Validation 3.1 specification menyatakan bahwa API ini dapat digunakan di Jakarta EE maupun Java SE.  
  Source: https://jakarta.ee/specifications/bean-validation/3.1/jakarta-validation-spec-3.1.html
- Bean Validation 2.0 / JSR 380 selesai pada 2017, merupakan bagian dari Java EE 8, dan membawa fitur Java 8 seperti container element constraints, `Optional`, JavaFX property support, custom value extractors, serta dukungan JSR 310 date/time.  
  Source: https://beanvalidation.org/2.0-jsr380/
- Jakarta Bean Validation 2.0 adalah re-release JSR 380 di bawah Eclipse Foundation Specification License.  
  Source: https://jakarta.ee/specifications/bean-validation/2.0/
- Jakarta Validation 3.1 dipublikasikan April 2024, bagian dari Jakarta EE 11, dan dapat digunakan di Java SE.  
  Source: https://beanvalidation.org/3.1/
- Hibernate Validator 9.0 ditargetkan sebagai reference implementation untuk Jakarta Validation 3.1/Jakarta EE 11 dan membutuhkan Java 17 pada stack Jakarta EE 11.  
  Source: https://hibernate.org/validator/releases/9.0/
- Hibernate Validator migration guide menyatakan HV 9 membutuhkan JDK 17 dan berbasis Jakarta Validation 3.1 serta Jakarta Expression Language 6.0.  
  Source: https://hibernate.org/validator/documentation/migration-guide/
- Hibernate Validator release page mencatat HV 9.0 menargetkan Jakarta EE 11 dan mengimplementasikan Jakarta Validation 3.1; HV 8.0 menargetkan Jakarta EE 10.  
  Source: https://hibernate.org/validator/releases/

---

## 1. Peta Besar: Specification, API, Implementation, Integration

Sebelum masuk ke versi, kita harus memisahkan empat hal yang sering tercampur:

```text
+-----------------------------+
| Specification               |
| - Bean Validation / Jakarta |
| - Mendefinisikan contract   |
+--------------+--------------+
               |
               v
+-----------------------------+
| API Artifact                 |
| - javax.validation-api       |
| - jakarta.validation-api     |
| - Interfaces + annotations   |
+--------------+--------------+
               |
               v
+-----------------------------+
| Implementation / Provider    |
| - Hibernate Validator        |
| - Apache BVal, etc.          |
| - Menjalankan validation     |
+--------------+--------------+
               |
               v
+-----------------------------+
| Framework Integration        |
| - Spring MVC / WebFlux       |
| - JAX-RS                     |
| - CDI                        |
| - JPA/Hibernate ORM          |
| - Jakarta EE runtime         |
+-----------------------------+
```

### 1.1 Specification

Specification adalah dokumen kontrak. Ia mendefinisikan:

- annotation standard,
- semantics constraint,
- validation groups,
- cascaded validation,
- executable validation,
- message interpolation,
- metadata API,
- bootstrap API,
- provider SPI,
- behavior yang harus dipatuhi implementation.

Specification tidak selalu menyediakan executable logic. Ia seperti “undang-undang API”. Implementation yang menjalankan hukum tersebut.

### 1.2 API artifact

API artifact berisi class dan interface seperti:

```java
jakarta.validation.Validator
jakarta.validation.ValidatorFactory
jakarta.validation.ConstraintViolation
jakarta.validation.Valid
jakarta.validation.constraints.NotNull
```

atau pada era lama:

```java
javax.validation.Validator
javax.validation.ValidatorFactory
javax.validation.ConstraintViolation
javax.validation.Valid
javax.validation.constraints.NotNull
```

API artifact sendiri tidak cukup. Kalau hanya menambahkan `jakarta.validation-api`, kamu punya annotation dan interface, tetapi belum tentu punya engine untuk menjalankan validation.

### 1.3 Implementation / provider

Provider adalah engine. Yang paling umum adalah **Hibernate Validator**.

Provider melakukan:

- scan metadata,
- resolve constraints,
- instantiate `ConstraintValidator`,
- traverse object graph,
- validate container elements,
- interpolate message,
- produce `ConstraintViolation`,
- expose provider-specific extension.

### 1.4 Framework integration

Framework integration menentukan **kapan** validation dipanggil.

Contoh:

- Spring MVC memvalidasi request body saat parameter controller diberi `@Valid` atau `@Validated`.
- JAX-RS runtime dapat memvalidasi resource method parameter/return value.
- JPA provider dapat memvalidasi entity saat pre-persist/pre-update.
- CDI/Jakarta EE dapat mengaktifkan method validation melalui interceptor.
- Spring method validation memakai proxy/interceptor.

Jadi ketika user request invalid lalu mendapat HTTP 400, itu bukan “Jakarta Validation murni”. Itu hasil gabungan:

```text
HTTP framework -> object binding -> validation provider -> exception mapper -> error response
```

Engineer top-tier harus tahu lapisan mana yang bertanggung jawab atas behavior mana.

---

## 2. Timeline Evolusi Validation di Java

Secara praktis, perjalanan validation modern di Java bisa dipahami seperti ini:

```text
JSR 303 / Bean Validation 1.0
        |
        v
JSR 349 / Bean Validation 1.1
        |
        v
JSR 380 / Bean Validation 2.0
        |
        v
Jakarta Bean Validation 2.0
        |
        v
Jakarta Bean Validation 3.0
        |
        v
Jakarta Validation 3.1
```

Perubahan paling besar untuk codebase enterprise biasanya bukan fitur constraint tertentu, tetapi:

1. Java EE ke Jakarta EE.
2. `javax.validation.*` ke `jakarta.validation.*`.
3. Java 8 baseline ke Java 11/17+ baseline.
4. Hibernate Validator 6.x ke 7.x/8.x/9.x.
5. Spring Boot 2.x ke Spring Boot 3.x.

---

## 3. Bean Validation 1.0: Fondasi Annotation-Based Validation

Bean Validation 1.0 dikenal sebagai JSR 303.

Mental model utamanya:

```java
public class UserRegistrationRequest {
    @NotNull
    private String username;

    @Size(min = 8, max = 100)
    private String password;
}
```

Fokus utamanya:

- deklarasi constraint via annotation,
- validasi object JavaBean,
- standard built-in constraints,
- custom constraint,
- constraint violation model,
- validation groups dasar,
- cascaded validation via `@Valid`,
- integration dengan Java EE ecosystem.

Namun Bean Validation 1.0 masih terbatas untuk model Java klasik. Ia belum nyaman untuk:

- method parameter validation yang lebih formal,
- return value validation,
- container element constraints,
- Java 8 date/time,
- `Optional`,
- type-use constraints.

### 3.1 Pelajaran Arsitektural dari Era 1.0

Era 1.0 mengajarkan pola besar:

> Constraint dideklarasikan dekat dengan model data.

Itu powerful, tetapi juga berbahaya.

Dekat dengan model berarti:

- mudah dibaca,
- mudah digunakan framework,
- mudah didokumentasikan,
- konsisten lintas layer.

Tetapi juga bisa membuat engineer keliru:

- menganggap semua business rule cocok jadi annotation,
- mencampur input contract dengan domain workflow,
- menaruh rule contextual ke class yang dipakai banyak operasi,
- membuat DTO menjadi penuh group dan conditional logic.

---

## 4. Bean Validation 1.1: Executable Validation dan Integrasi Lebih Kuat

Bean Validation 1.1 dikenal sebagai JSR 349.

Perubahan pentingnya adalah method/constructor validation yang lebih formal.

Contoh konsep:

```java
public class PaymentService {
    public Receipt pay(
            @NotNull AccountId accountId,
            @Positive BigDecimal amount) {
        // ...
    }
}
```

Dan return value:

```java
@NotNull
public Receipt createReceipt(...) {
    // ...
}
```

Ini membuka validation sebagai:

- precondition method,
- postcondition method,
- API contract internal,
- service boundary guard,
- integration point dengan interceptor/proxy.

### 4.1 Kenapa Executable Validation Penting?

Object validation menjawab:

> “Apakah object ini valid?”

Executable validation menjawab:

> “Apakah pemanggilan method/constructor ini valid, dan apakah hasilnya memenuhi kontrak?”

Ini berbeda secara arsitektural.

Object validation cocok untuk DTO/input shape.
Executable validation cocok untuk service contract.

Namun executable validation juga punya trap:

- tergantung framework interceptor,
- self-invocation bisa tidak tervalidasi di Spring proxy,
- private method tidak relevan untuk external contract,
- inheritance rule bisa kompleks,
- parameter name perlu compiler flag `-parameters` agar error path lebih bermakna.

---

## 5. Bean Validation 2.0 / JSR 380: Java 8 Era

Bean Validation 2.0 adalah lompatan besar. Ini sangat relevan untuk Java 8 sampai sekarang karena memperkenalkan fitur yang masih menjadi dasar modern validation.

Fitur besar:

1. Container element constraints.
2. Type-use annotation support.
3. Flexible cascaded validation untuk container.
4. Built-in support untuk `Optional`.
5. Custom container support via value extractors.
6. JSR 310 date/time support.
7. Constraint baru seperti `@NotBlank`, `@NotEmpty`, `@Email`, `@Positive`, `@PositiveOrZero`, `@Negative`, `@NegativeOrZero`, `@PastOrPresent`, `@FutureOrPresent`.

Bean Validation 2.0 secara resmi berfokus pada validasi container elements, termasuk contoh `List<@Positive Integer>`, support `Optional`, JavaFX property, dan custom container types. Sumber resmi Bean Validation juga mencatat dukungan JSR 310 date/time dan value extractor.

### 5.1 Sebelum 2.0: Constraint pada Container Sulit Diekspresikan

Sebelum container element constraints, code seperti ini ambiguous:

```java
@NotEmpty
private List<String> emails;
```

Ini hanya mengatakan:

> List tidak boleh kosong.

Tetapi tidak mengatakan:

> Setiap element harus email valid.

Biasanya engineer harus membuat custom validator:

```java
@ValidEmailList
private List<String> emails;
```

Itu membuat constraint terlalu coarse-grained.

### 5.2 Setelah 2.0: Constraint Bisa Menempel ke Type Argument

```java
@NotEmpty
private List<@Email @NotBlank String> emails;
```

Maknanya jauh lebih eksplisit:

- list tidak boleh kosong,
- setiap item tidak boleh blank,
- setiap item harus berbentuk email.

Contoh lain:

```java
private Map<@NotBlank String, @Valid Address> addressesByType;
```

Maknanya:

- key map harus string non-blank,
- value map adalah `Address` yang divalidasi cascading.

### 5.3 Mengapa Ini Besar Secara Mental Model?

Karena data modern jarang hanya scalar.

Request API sering berisi:

```json
{
  "applicants": [
    {
      "name": "...",
      "documents": [
        { "type": "PASSPORT", "fileId": "..." }
      ]
    }
  ],
  "metadata": {
    "source": "internet",
    "campaign": "..."
  }
}
```

Tanpa container element validation, engineer cenderung:

- membuat custom validator besar,
- memvalidasi manual di service,
- kehilangan structured path violation,
- memberi error message yang tidak menunjuk item mana yang salah.

Dengan Bean Validation 2.0, violation path bisa lebih presisi:

```text
applicants[0].documents[2].fileId
metadata[source]
```

Ini penting untuk API error contract dan frontend UX.

### 5.4 Value Extractor

Bean Validation 2.0 juga memperkenalkan cara provider memahami container custom.

Misalnya kamu punya wrapper:

```java
public final class Result<T> {
    private final T value;
    private final List<String> errors;
}
```

Agar validation bisa memahami `Result<@Valid Customer>`, provider perlu tahu cara “mengambil” value `T` dari `Result<T>`. Itulah peran `ValueExtractor`.

Ini akan dibahas mendalam di part container element constraints.

---

## 6. Jakarta Bean Validation 2.0: Re-release di Bawah Eclipse Foundation

Setelah Java EE berpindah ke Eclipse Foundation, banyak spesifikasi Java EE menjadi Jakarta EE.

Jakarta Bean Validation 2.0 adalah re-release dari JSR 380 di bawah Eclipse Foundation Specification License.

Hal penting:

- API package masih `javax.validation.*` pada Jakarta Bean Validation 2.0.
- Secara praktis, ini adalah jembatan transisi.
- Banyak codebase Java EE 8 / Spring Boot 2.x masih berada di era ini.

### 6.1 Kenapa Namanya Jakarta tapi Package-nya Masih `javax`?

Ini salah satu sumber kebingungan terbesar.

Di awal transisi Java EE ke Jakarta EE, tidak semua namespace langsung berubah. Jakarta Bean Validation 2.0 masih membawa `javax.validation` karena compatibility dengan Java EE 8/JSR 380.

Jadi jangan menyimpulkan package hanya dari nama marketing.

Rule praktis:

```text
Jakarta Bean Validation 2.0  -> mostly javax.validation.*
Jakarta Bean Validation 3.0+ -> jakarta.validation.*
Jakarta Validation 3.1      -> jakarta.validation.*
```

---

## 7. Jakarta Bean Validation 3.0: Namespace Break ke `jakarta.validation`

Jakarta Bean Validation 3.0 adalah titik besar karena namespace berpindah dari:

```java
javax.validation.*
```

menjadi:

```java
jakarta.validation.*
```

Contoh:

```java
// legacy
import javax.validation.Valid;
import javax.validation.constraints.NotNull;

// modern Jakarta
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
```

### 7.1 Ini Bukan Sekadar Rename Import

Di source code, terlihat seperti rename import. Dalam sistem besar, efeknya jauh lebih besar.

Yang terdampak:

- source code,
- generated code,
- validation annotations di shared DTO jar,
- framework integration,
- transitive dependencies,
- Jakarta Expression Language version,
- Hibernate Validator version,
- Spring Boot version,
- JAX-RS version,
- JPA version,
- application server version,
- test libraries,
- OpenAPI/schema generator,
- annotation processors,
- custom constraints,
- reflection code yang mencari annotation name,
- XML validation mappings,
- `ValidationMessages.properties` jika berisi fully qualified class names.

### 7.2 Kenapa Mixed Namespace Berbahaya?

Misal DTO kamu memakai:

```java
import javax.validation.constraints.NotNull;

public class CreateUserRequest {
    @NotNull
    private String username;
}
```

Tetapi runtime kamu adalah Spring Boot 3 + Hibernate Validator 8/9 yang membaca `jakarta.validation`.

Secara kasat mata annotation masih ada. Tetapi engine modern mungkin tidak memperlakukannya sebagai constraint Jakarta Validation.

Hasilnya bisa fatal:

```text
Request invalid -> annotation terlihat di source code -> runtime tidak mengeksekusi validation -> invalid data lolos.
```

Ini adalah failure mode yang lebih buruk daripada compile error.

Compile error membuat masalah terlihat. Silent non-validation membuat sistem tampak berjalan tetapi correctness rusak.

### 7.3 Rule Praktis

Jangan campur:

```text
javax.validation-api + Hibernate Validator 8/9
jakarta.validation-api + Hibernate Validator 6.x legacy
Spring Boot 3 + javax.validation annotations
Spring Boot 2 + jakarta.validation annotations
Jakarta EE 10/11 runtime + javax validation model
Java EE 8 runtime + jakarta validation model
```

Dalam migration, targetnya harus **satu namespace per deployable unit**.

---

## 8. Jakarta Validation 3.1: Jakarta EE 11 Era

Jakarta Validation 3.1 adalah nama terbaru. Ia tidak lagi memakai nama “Jakarta Bean Validation” sebagai branding utama, melainkan “Jakarta Validation”.

Fokus penting:

- bagian dari Jakarta EE 11,
- minimum Java 17,
- clarification untuk Java Records,
- dependency update untuk Jakarta EE 11,
- tetap dapat digunakan di Java SE.

### 8.1 Kenapa Rename “Bean Validation” ke “Validation” Masuk Akal?

Istilah “Bean” berasal dari JavaBean era lama:

```java
public class User {
    private String name;

    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
}
```

Tetapi Java modern tidak selalu memakai mutable JavaBean.

Kita punya:

- records,
- immutable classes,
- constructor-bound DTO,
- sealed hierarchies,
- value objects,
- builder-based model,
- command objects,
- method contracts,
- container element constraints.

Jadi “Validation” lebih luas daripada “Bean Validation”.

### 8.2 Records Clarification

Java records membuat model data immutable dan concise:

```java
public record RegisterApplicantRequest(
        @NotBlank String name,
        @Email String email
) {}
```

Pertanyaan penting:

- annotation di record component dianggap constraint property?
- bagaimana canonical constructor divalidasi?
- bagaimana akses metadata record component?
- bagaimana integrasi dengan framework binding?

Jakarta Validation 3.1 mengklarifikasi support records. Ini penting karena Java 17+ enterprise stack makin banyak memakai records untuk request/response DTO.

### 8.3 Java 17 Minimum

Jakarta Validation 3.1 berjalan di era Jakarta EE 11 yang baseline-nya Java 17.

Konsekuensinya:

- tidak cocok untuk runtime Java 8,
- tidak cocok untuk Java 11-only legacy runtime,
- cocok untuk Java 17/21/25 codebase modern,
- membuka ruang design dengan records/sealed/pattern matching-friendly models.

Namun API yang “bisa digunakan di Java SE” bukan berarti bisa dipakai di semua versi Java SE. Tetap lihat minimum Java version dari API dan provider.

---

## 9. Hibernate Validator: Reference Implementation, Bukan Specification

Hibernate Validator sering dianggap “Bean Validation itu sendiri”. Ini tidak akurat.

Hibernate Validator adalah provider/reference implementation.

Specification mendefinisikan contract. Hibernate Validator menjalankan contract dan menambahkan extension.

### 9.1 Standard Constraint vs Hibernate-Specific Constraint

Standard:

```java
jakarta.validation.constraints.NotNull
jakarta.validation.constraints.Size
jakarta.validation.constraints.Email
jakarta.validation.constraints.Positive
```

Hibernate-specific:

```java
org.hibernate.validator.constraints.Length
org.hibernate.validator.constraints.Range
org.hibernate.validator.constraints.URL
org.hibernate.validator.constraints.UUID
```

Provider-specific constraint bisa berguna, tetapi membawa lock-in.

### 9.2 Kapan Lock-in Boleh?

Provider-specific feature boleh dipakai jika:

- project secara eksplisit memilih Hibernate Validator sebagai standard internal,
- feature memberi benefit nyata,
- migration risk diterima,
- usage-nya terisolasi,
- ada test yang melindungi behavior,
- error contract tidak tergantung detail provider yang tidak stabil.

Provider-specific feature berbahaya jika:

- dipakai sembarangan di shared library publik,
- membuat library tidak portable,
- behavior berbeda saat application server memakai provider lain,
- tidak ada governance dependency version.

### 9.3 Hibernate Validator Version Families

Secara praktis:

```text
HV 5.x -> legacy Java EE / Bean Validation 1.1 era
HV 6.x -> Bean Validation 2.0 / javax.validation era
HV 7.x -> Jakarta Bean Validation 3.0 / jakarta.validation era awal
HV 8.x -> Jakarta EE 10 / Jakarta Bean Validation 3.0 era
HV 9.x -> Jakarta EE 11 / Jakarta Validation 3.1 era
```

Catatan penting:

- HV 6.x adalah safe target untuk banyak Java 8/11 legacy stack yang masih `javax.validation`.
- HV 8.x umum di Spring Boot 3 / Jakarta EE 10 era.
- HV 9.x untuk Jakarta EE 11 / Jakarta Validation 3.1 dan Java 17+.

---

## 10. Compatibility Matrix Praktis

Berikut matrix konseptual. Selalu verifikasi versi minor/final sesuai dependency actual project, tetapi matrix ini cukup untuk reasoning arsitektural.

| Era | Java baseline umum | API package | Spec | Provider umum | Framework umum | Catatan |
|---|---:|---|---|---|---|---|
| Java EE 6/7 legacy | Java 6/7/8 | `javax.validation` | Bean Validation 1.0/1.1 | HV 4/5 | Java EE, Spring lama | Tidak punya container element validation modern |
| Java EE 8 / Spring Boot 2 | Java 8/11 | `javax.validation` | Bean Validation 2.0 / Jakarta Bean Validation 2.0 | HV 6.x | Spring Boot 2.x, Java EE 8 | Fitur Java 8: container element, Optional, JSR 310 |
| Jakarta EE 9 era | Java 11+ umum | `jakarta.validation` | Jakarta Bean Validation 3.0 | HV 7.x | Jakarta EE 9 | Namespace break besar |
| Jakarta EE 10 / Spring Boot 3 | Java 17 umum | `jakarta.validation` | Jakarta Bean Validation 3.0 | HV 8.x | Spring Boot 3.x, Jakarta EE 10 | Modern mainstream stack |
| Jakarta EE 11 | Java 17+ | `jakarta.validation` | Jakarta Validation 3.1 | HV 9.x | Jakarta EE 11 | Records clarification, updated dependencies |
| Java 21/25 modern app | Java 21/25 | `jakarta.validation` | Usually 3.0/3.1 depending stack | HV 8/9 | Spring Boot 3.x/Jakarta EE 10/11 | Pilih berdasarkan framework alignment |

### 10.1 Java 25 Tidak Otomatis Berarti Jakarta Validation 3.1

Java version dan Jakarta Validation version tidak selalu naik bersamaan.

Kamu bisa punya:

```text
JDK 25 + Spring Boot 3.x + Hibernate Validator 8.x + Jakarta Validation 3.0
```

Atau:

```text
JDK 25 + Jakarta EE 11 + Hibernate Validator 9.x + Jakarta Validation 3.1
```

Yang menentukan bukan hanya JDK, tetapi framework BOM/dependency stack.

### 10.2 Rule Pemilihan Versi

Untuk enterprise project, jangan memilih validation version berdiri sendiri. Pilih berdasarkan platform:

```text
Spring Boot 2.x  -> ikuti Boot dependency management -> biasanya javax/HV 6
Spring Boot 3.x  -> ikuti Boot dependency management -> jakarta/HV 8 atau sesuai versi Boot
Jakarta EE 10    -> jakarta/HV 8 atau provider server
Jakarta EE 11    -> Jakarta Validation 3.1/HV 9 atau provider server
Plain Java SE    -> pilih API + provider eksplisit, pastikan compatible
```

---

## 11. Dependency Anatomy

### 11.1 Legacy `javax.validation` Project

Contoh Maven era Java 8/11 legacy:

```xml
<dependencies>
    <dependency>
        <groupId>javax.validation</groupId>
        <artifactId>validation-api</artifactId>
        <version>2.0.1.Final</version>
    </dependency>

    <dependency>
        <groupId>org.hibernate.validator</groupId>
        <artifactId>hibernate-validator</artifactId>
        <version>6.2.5.Final</version>
    </dependency>

    <dependency>
        <groupId>org.glassfish</groupId>
        <artifactId>javax.el</artifactId>
        <version>3.0.0</version>
    </dependency>
</dependencies>
```

Catatan:

- Ini cocok untuk `javax.validation`.
- Ini tidak cocok untuk Spring Boot 3/Jakarta EE 10+ modern namespace.
- Di Spring Boot, biasanya dependency dikelola oleh starter/BOM.

### 11.2 Modern `jakarta.validation` Project

Contoh konseptual:

```xml
<dependencies>
    <dependency>
        <groupId>jakarta.validation</groupId>
        <artifactId>jakarta.validation-api</artifactId>
        <version>3.1.1</version>
    </dependency>

    <dependency>
        <groupId>org.hibernate.validator</groupId>
        <artifactId>hibernate-validator</artifactId>
        <version>9.0.1.Final</version>
    </dependency>
</dependencies>
```

Tetapi untuk Spring Boot/Jakarta EE runtime, jangan asal hardcode versi. Pakai BOM/platform dependency management kecuali ada alasan kuat.

### 11.3 API Artifact Saja Tidak Cukup

Kalau kamu hanya punya:

```xml
<dependency>
    <groupId>jakarta.validation</groupId>
    <artifactId>jakarta.validation-api</artifactId>
</dependency>
```

Lalu menjalankan:

```java
Validator validator = Validation.buildDefaultValidatorFactory().getValidator();
```

Runtime butuh provider. Tanpa provider, bootstrap bisa gagal karena tidak ada validation provider ditemukan.

### 11.4 Provider Membawa Dependency Lain

Hibernate Validator dapat membutuhkan Expression Language implementation untuk message interpolation tertentu.

Pada HV 9, migration guide mencatat basis Jakarta Expression Language 6.0. Ini penting untuk Java SE/plain app yang tidak berada di application server.

---

## 12. Spring Boot 2.x vs 3.x: Validation Migration Impact

### 12.1 Spring Boot 2.x

Spring Boot 2.x berada di era Java EE namespace:

```java
import javax.validation.Valid;
import javax.validation.constraints.NotBlank;
```

Biasanya memakai Hibernate Validator 6.x melalui dependency management.

### 12.2 Spring Boot 3.x

Spring Boot 3.x berpindah ke Jakarta EE namespace:

```java
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
```

Ini sejalan dengan Spring Framework 6 yang baseline-nya Java 17 dan Jakarta EE 9+ namespace.

### 12.3 Failure Mode Saat Upgrade Boot 2 ke 3

Contoh controller:

```java
@PostMapping("/users")
public ResponseEntity<?> create(@Valid @RequestBody CreateUserRequest request) {
    return ResponseEntity.ok(...);
}
```

Kalau `@Valid` yang ter-import masih:

```java
import javax.validation.Valid;
```

sedangkan stack runtime mengharapkan:

```java
import jakarta.validation.Valid;
```

maka validation bisa tidak berjalan sesuai ekspektasi.

### 12.4 Migration Harus Menyapu Semua Layer

Yang harus dicek:

```text
src/main/java/**/*.java
src/test/java/**/*.java
generated-sources/**/*.java
shared-dto modules
custom constraint annotations
custom ConstraintValidator
exception handler imports
manual Validator usage
method validation imports
OpenAPI generator templates
XML validation mapping
ValidationMessages*.properties
```

---

## 13. Jakarta EE / JAX-RS / CDI Impact

Dalam Jakarta EE runtime, validation bukan hanya library manual. Ia terintegrasi dengan:

- CDI,
- JAX-RS,
- JPA,
- interceptors,
- application server provider.

### 13.1 JAX-RS Resource Validation

Contoh modern Jakarta:

```java
@Path("/applications")
public class ApplicationResource {

    @POST
    public Response submit(@Valid SubmitApplicationRequest request) {
        return Response.ok().build();
    }
}
```

Di sini validation dipicu oleh JAX-RS runtime/provider integration.

Hal yang harus dipastikan:

- runtime mendukung Jakarta Validation version target,
- exception mapping benar,
- method validation aktif sesuai runtime,
- package annotation sesuai namespace runtime,
- response error shape konsisten.

### 13.2 CDI dan ConstraintValidator Injection

Jakarta EE environment dapat mendukung injection ke validator. Tetapi ini harus dipahami sebagai integration behavior, bukan murni spec annotation.

ConstraintValidator yang bergantung pada service harus hati-hati:

- thread-safety,
- lifecycle,
- latency,
- transaction boundary,
- database consistency,
- provider caching.

---

## 14. JPA Integration: Entity Validation Bukan DTO Validation

JPA dapat memicu Bean/Jakarta Validation saat lifecycle event seperti pre-persist/pre-update.

Contoh:

```java
@Entity
public class CustomerEntity {
    @NotBlank
    private String name;
}
```

Saat entity disimpan, provider bisa menjalankan validation.

### 14.1 Risiko Menaruh Semua Constraint di Entity

Entity constraint terlihat menarik karena dekat dengan persistence model. Namun:

- entity dipakai banyak use case,
- requiredness create vs update bisa berbeda,
- patch operation bisa salah divalidasi,
- lazy association bisa ikut tersentuh,
- cascaded validation bisa memicu graph traversal besar,
- entity constraint tidak selalu cocok untuk API contract.

### 14.2 Layering yang Lebih Aman

```text
DTO / request object     -> input shape validation
Command object           -> operation-specific validation
Domain model             -> core invariant
Workflow guard           -> state transition rule
Entity / DB              -> persistence invariant
Database constraint      -> final consistency enforcement
```

Entity validation bukan pengganti database constraint, dan DTO validation bukan pengganti domain invariant.

---

## 15. Plain Java SE Usage

Jakarta Validation dapat digunakan tanpa Spring/Jakarta EE.

Contoh:

```java
ValidatorFactory factory = Validation.buildDefaultValidatorFactory();
Validator validator = factory.getValidator();

Set<ConstraintViolation<CreateUserRequest>> violations = validator.validate(request);
```

### 15.1 Dalam Plain Java, Kamu Bertanggung Jawab atas Bootstrap

Framework biasanya:

- menyediakan provider,
- configure message interpolation,
- manage factory lifecycle,
- integrate DI,
- translate exceptions.

Di Java SE manual, kamu sendiri yang bertanggung jawab.

Rule:

- buat `ValidatorFactory` sekali per aplikasi/module,
- reuse `Validator`,
- close factory saat shutdown,
- pastikan provider dan EL dependency tersedia,
- jangan membuat factory per request.

---

## 16. Source Compatibility vs Binary Compatibility vs Runtime Behavior

Migrasi validation punya tiga jenis compatibility.

### 16.1 Source Compatibility

Apakah source code compile?

```java
import javax.validation.constraints.NotNull;
```

Jika dependency `javax.validation-api` tidak ada, compile gagal.

### 16.2 Binary Compatibility

Apakah jar lama bisa dipakai tanpa recompile?

Misal shared DTO jar dikompilasi dengan `javax.validation.NotNull`, lalu dipakai di app Jakarta runtime. Secara classpath mungkin bisa ada dua API, tetapi annotation-nya beda type.

```text
javax.validation.constraints.NotNull != jakarta.validation.constraints.NotNull
```

Nama mirip, semantics mirip, tetapi class berbeda.

### 16.3 Runtime Behavior Compatibility

Apakah runtime benar-benar menjalankan validation?

Ini yang paling berbahaya.

Code bisa compile. App bisa start. Annotation bisa terlihat di source. Tetapi provider tidak membaca annotation lama.

Outcome:

```text
invalid data accepted silently
```

Top-tier migration harus menguji behavior, bukan hanya compile.

---

## 17. Migration Strategy: `javax` ke `jakarta`

Part 027 nanti akan menjadi migration playbook penuh. Di sini kita buat landscape strategy.

### 17.1 Inventory

Cari semua pemakaian:

```bash
rg "javax\.validation|jakarta\.validation|org\.hibernate\.validator" .
```

Cek dependency tree:

```bash
mvn dependency:tree | grep -E "validation|hibernate-validator|jakarta.el|javax.el"
```

atau Gradle:

```bash
./gradlew dependencies --configuration runtimeClasspath | grep -E "validation|hibernate-validator|jakarta.el|javax.el"
```

### 17.2 Classify Modules

Pisahkan:

```text
application modules
shared DTO modules
domain modules
API client modules
generated code modules
framework integration modules
test fixture modules
```

Shared DTO adalah yang paling sensitif karena dipakai lintas service/app.

### 17.3 Decide Cut Strategy

Ada dua strategi:

#### Big-bang per bounded deployable

Semua module dalam satu deployable pindah ke Jakarta sekaligus.

Cocok jika:

- codebase manageable,
- test suite kuat,
- deployment window jelas,
- framework upgrade serentak.

#### Strangler / compatibility bridge

Legacy dan modern dipisahkan dengan boundary:

- DTO duplicated/adapted,
- adapter module,
- anti-corruption layer,
- service boundary via JSON/OpenAPI,
- tidak mencampur annotation namespace dalam runtime yang sama.

Cocok jika:

- sistem besar,
- banyak consumer,
- shared library sulit di-upgrade serentak,
- ada Java 8 dan Java 17 app berjalan bersamaan.

### 17.4 Jangan Membuat “Dual Annotated DTO” Sembarangan

Kadang engineer mencoba:

```java
@javax.validation.constraints.NotNull
@jakarta.validation.constraints.NotNull
private String name;
```

Ini tampak seperti compatibility bridge, tapi biasanya buruk:

- noise tinggi,
- dua metadata model,
- dua dependency API,
- error message bisa beda,
- generator bingung,
- maintenance berat,
- bisa menimbulkan split behavior.

Lebih baik buat boundary explicit.

### 17.5 Automated Refactor

Untuk rename besar, OpenRewrite menyediakan recipe migrasi `javax.validation` ke `jakarta.validation`. Ini berguna, tetapi tidak menggantikan architecture review.

Automated refactor bisa membantu:

- import rewrite,
- dependency migration,
- file property references tertentu.

Tetapi manusia tetap harus mengecek:

- runtime behavior,
- framework integration,
- provider version,
- custom constraints,
- exception handlers,
- generated code,
- tests.

---

## 18. Common Dependency Failure Modes

### 18.1 API Ada, Provider Tidak Ada

Symptom:

```text
NoProviderFoundException
Unable to create a Configuration, because no Bean Validation provider could be found
```

Cause:

```text
jakarta.validation-api ada, hibernate-validator tidak ada
```

Fix:

- tambahkan provider,
- atau pakai framework starter yang membawa provider,
- cek dependency scope.

### 18.2 Provider Ada, EL Tidak Cocok

Symptom:

- message interpolation error,
- class not found untuk EL,
- runtime failure saat startup/validation.

Cause:

- EL version tidak cocok dengan provider,
- plain Java SE tidak menyediakan EL.

Fix:

- ikuti provider migration guide,
- pakai dependency management platform,
- tambahkan compatible EL implementation jika perlu.

### 18.3 Dua API Namespace Ada Bersamaan

Symptom:

- compile OK,
- runtime aneh,
- validation tidak berjalan untuk sebagian DTO,
- exception handler type mismatch,
- transitive dependency konflik.

Cause:

```text
javax.validation-api dan jakarta.validation-api sama-sama masuk classpath
```

Fix:

- dependency tree cleanup,
- exclude transitive dependency,
- upgrade shared libraries,
- enforce dependency convergence.

### 18.4 Framework dan Provider Tidak Satu Era

Contoh buruk:

```text
Spring Boot 3 + Hibernate Validator 6.x
Spring Boot 2 + Hibernate Validator 8.x
Jakarta EE 11 runtime + javax DTO annotations
```

Fix:

- align stack via BOM,
- jangan override provider tanpa alasan kuat,
- baca compatibility matrix framework.

### 18.5 Shared Library Membawa API Lama

Misal:

```text
common-dto.jar -> javax.validation-api
main-app -> jakarta.validation-api
```

Ini sering terjadi pada enterprise migration.

Fix:

- release major version shared library,
- pisahkan legacy artifact dan jakarta artifact,
- gunakan classifier jika benar-benar perlu,
- jangan memaksa satu artifact melayani dua runtime tanpa governance.

---

## 19. Specification Feature vs Provider Feature

Top-tier engineer harus selalu bertanya:

> “Ini fitur dari specification atau Hibernate Validator extension?”

### 19.1 Kenapa Ini Penting?

Jika fitur spec:

- portable antar provider,
- kemungkinan stabil lintas framework,
- bisa dijadikan shared contract lebih aman.

Jika fitur provider:

- mungkin sangat berguna,
- tetapi ada lock-in,
- behavior bisa berubah antar major version,
- app server dengan provider berbeda bisa tidak mendukung.

### 19.2 Contoh Klasifikasi

| Feature | Spec atau Provider? | Catatan |
|---|---|---|
| `@NotNull` | Spec | Aman portable |
| `@Size` | Spec | Aman portable |
| `@Valid` | Spec | Cascaded validation standard |
| Groups | Spec | Standard, tapi governance tetap penting |
| Group sequence | Spec | Standard |
| Container element constraints | Spec sejak 2.0 | Butuh provider yang mendukung |
| `ValueExtractor` | Spec sejak 2.0 | Advanced, portable secara API |
| `@Length` | Hibernate-specific | Lock-in ke HV |
| `@Range` | Hibernate-specific | Lock-in ke HV |
| Fail-fast mode | Provider-specific HV config | Berguna untuk performance |
| Dynamic group sequence provider | Hibernate-specific | Advanced, hati-hati |
| Programmatic constraint mapping HV | Hibernate-specific | Powerful, lock-in |

### 19.3 Rule Praktis

- Untuk DTO publik/shared: prioritaskan spec constraint.
- Untuk internal app yang standardized on Hibernate Validator: provider-specific boleh, tapi dokumentasikan.
- Untuk framework/library yang akan dipakai banyak app: hindari provider-specific kecuali terisolasi.
- Untuk performance optimization: provider-specific config boleh, tetapi test behavior-nya.

---

## 20. Java 8 sampai Java 25: Apa yang Berubah dalam Cara Mendesain Validation?

### 20.1 Java 8

Java 8 membawa:

- type annotations,
- `Optional`,
- `java.time`,
- lambda/functional style.

Bean Validation 2.0 memanfaatkan ini.

Design style:

```java
public class CreateOrderRequest {
    @NotEmpty
    private List<@Valid OrderLineRequest> lines;

    @FutureOrPresent
    private LocalDate requestedDeliveryDate;
}
```

### 20.2 Java 11

Java 11 sering menjadi runtime LTS legacy-modern bridge.

Validation design tidak berubah drastis, tetapi enterprise dependency mulai matang:

- Spring Boot 2.x banyak di Java 11,
- masih `javax.validation`,
- Bean Validation 2.0 tetap relevan.

### 20.3 Java 17

Java 17 adalah baseline besar untuk modern enterprise stack:

- Spring Boot 3,
- Jakarta EE 10/11,
- records mature,
- sealed classes,
- modern switch,
- strong encapsulation concerns.

Validation design mulai bergeser:

```java
public record CreateUserRequest(
        @NotBlank String username,
        @Email String email
) {}
```

### 20.4 Java 21

Java 21 sebagai LTS membawa modern concurrency dan style, tetapi validation tetap mostly synchronous CPU-bound operation.

Yang berubah secara arsitektural:

- request handling bisa virtual-thread-friendly,
- jangan membuat validator melakukan blocking I/O sembarangan,
- validation tetap harus murah dan deterministic,
- expensive rule lebih baik di service/policy layer dengan observability.

### 20.5 Java 25

Java 25 sebagai modern target berarti codebase mungkin memakai:

- records secara luas,
- sealed hierarchies,
- pattern matching style,
- modern dependency stack,
- stricter modularity,
- newer Jakarta/Hibernate versions.

Tetapi constraint annotation model tetap harus dipakai dengan disiplin. Java modern tidak menghapus kebutuhan separation of concerns.

---

## 21. Records, JavaBeans, dan Naming Confusion

Nama lama “Bean Validation” membuat banyak engineer berpikir validation hanya untuk JavaBean mutable dengan getter/setter.

Itu tidak lagi tepat.

Jakarta Validation dapat bekerja dengan:

- JavaBean-style class,
- field/property access,
- records,
- constructor/method parameter,
- return value,
- container element,
- object graph.

### 21.1 JavaBean Model

```java
public class Person {
    @NotBlank
    private String name;

    public String getName() {
        return name;
    }
}
```

### 21.2 Record Model

```java
public record Person(
        @NotBlank String name
) {}
```

Keduanya bisa divalidasi, tetapi metadata dan framework binding bisa berbeda.

### 21.3 Design Consequence

Dengan records, validation sering lebih dekat dengan constructor-bound input.

Namun jangan keliru:

```java
public record SubmitCaseCommand(
        @NotBlank String caseId,
        @NotBlank String officerId
) {}
```

Ini hanya menjamin shape dasar. Ia tidak menjamin:

- case exists,
- officer authorized,
- case is in submittable state,
- SLA not expired,
- evidence complete,
- maker-checker satisfied.

Rule tersebut berada di application/domain/workflow layer.

---

## 22. Jakarta Validation di Java SE vs Jakarta EE

Jakarta Validation dapat digunakan di Java SE dan Jakarta EE, tetapi runtime responsibilities berbeda.

### 22.1 Java SE

Kamu bertanggung jawab atas:

- dependency provider,
- bootstrap,
- lifecycle,
- DI integration custom,
- message interpolation dependency,
- exception mapping sendiri.

### 22.2 Jakarta EE

Runtime/server sering menyediakan:

- provider,
- CDI integration,
- JAX-RS integration,
- JPA lifecycle validation,
- method validation support,
- exception mapping baseline.

Namun kamu tetap bertanggung jawab atas:

- API error design,
- rule placement,
- namespace consistency,
- test behavior,
- observability,
- governance.

### 22.3 Spring Boot

Spring Boot bukan Jakarta EE runtime penuh, tetapi mengintegrasikan Jakarta Validation dalam Spring ecosystem.

Kamu mendapat:

- MVC/WebFlux validation hooks,
- dependency management,
- error binding exception,
- method validation support via proxy,
- DI untuk validators via Spring.

Tetapi kamu tetap harus memahami:

- `@Valid` vs `@Validated`,
- group behavior,
- exception type,
- self-invocation proxy limitation,
- message source integration,
- startup dependency convergence.

---

## 23. Why `javax` to `jakarta` Migration Is Conceptually a Platform Migration

Banyak engineer melihat migration seperti ini:

```diff
-import javax.validation.constraints.NotNull;
+import jakarta.validation.constraints.NotNull;
```

Padahal platform berpindah seperti ini:

```text
Java EE ecosystem
    javax.servlet
    javax.ws.rs
    javax.persistence
    javax.validation
    javax.annotation
    javax.enterprise

Jakarta EE ecosystem
    jakarta.servlet
    jakarta.ws.rs
    jakarta.persistence
    jakarta.validation
    jakarta.annotation
    jakarta.enterprise
```

Validation jarang pindah sendirian. Biasanya ikut:

- Servlet API,
- JAX-RS,
- JPA,
- CDI,
- JSON-B,
- JAXB,
- EL,
- application server,
- Spring Framework.

Jadi migration validation harus dibaca sebagai bagian dari Jakarta migration.

---

## 24. Build Tool Governance

### 24.1 Maven Enforcer

Untuk enterprise, gunakan dependency convergence checks.

Contoh konseptual:

```xml
<plugin>
    <groupId>org.apache.maven.plugins</groupId>
    <artifactId>maven-enforcer-plugin</artifactId>
    <executions>
        <execution>
            <goals>
                <goal>enforce</goal>
            </goals>
            <configuration>
                <rules>
                    <dependencyConvergence />
                    <requireJavaVersion>
                        <version>[17,)</version>
                    </requireJavaVersion>
                </rules>
            </configuration>
        </execution>
    </executions>
</plugin>
```

Tambahkan banned dependency rule jika perlu:

```text
Ban javax.validation-api in Jakarta modules
Ban jakarta.validation-api in legacy javax modules
```

### 24.2 Gradle Version Catalog / Platforms

Untuk Gradle:

- gunakan version catalog,
- gunakan platform/BOM,
- enforce dependency constraints,
- buat check untuk banned modules.

### 24.3 CI Gate

Validation namespace harus menjadi CI gate.

Contoh policy:

```text
For modules under :modern-*:
- no imports matching javax.validation.*
- no dependencies on javax.validation:validation-api
- no transitive javax.validation-api in runtimeClasspath

For modules under :legacy-*:
- no imports matching jakarta.validation.* unless explicitly approved
```

---

## 25. Runtime Verification Test

Migration tidak boleh hanya mengandalkan grep.

Buat test kecil yang memastikan validation benar-benar berjalan.

### 25.1 Direct Validator Test

```java
class ValidationRuntimeSmokeTest {

    private final Validator validator = Validation
            .buildDefaultValidatorFactory()
            .getValidator();

    @Test
    void shouldRejectInvalidRequest() {
        CreateUserRequest request = new CreateUserRequest("");

        Set<ConstraintViolation<CreateUserRequest>> violations = validator.validate(request);

        assertThat(violations)
                .extracting(ConstraintViolation::getPropertyPath)
                .extracting(Object::toString)
                .contains("username");
    }
}
```

### 25.2 Framework Integration Test

Untuk REST API:

```java
@Test
void shouldReturn400WhenBodyInvalid() throws Exception {
    mockMvc.perform(post("/users")
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"username\":\"\"}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.violations[0].field").value("username"));
}
```

Direct validator test memastikan provider membaca annotation.
Framework test memastikan HTTP integration benar.

Keduanya dibutuhkan.

---

## 26. Reading a Codebase: Validation Archaeology Checklist

Saat masuk codebase baru, lakukan ini.

### 26.1 Cari Imports

```bash
rg "import (javax|jakarta)\.validation" src
```

Interpretasi:

- semua `javax`: legacy Java EE/Boot 2 style,
- semua `jakarta`: modern Jakarta style,
- mixed: perlu investigasi serius.

### 26.2 Cari Provider-Specific Constraint

```bash
rg "org\.hibernate\.validator\.constraints" src
```

Tentukan apakah lock-in acceptable.

### 26.3 Cari Manual Validation

```bash
rg "ValidatorFactory|Validator validator|validate\(" src
```

Manual validation sering muncul di:

- batch jobs,
- event consumers,
- command handlers,
- test utilities,
- custom framework layer.

### 26.4 Cari Custom Constraint

```bash
rg "@Constraint|ConstraintValidator" src
```

Audit:

- thread-safety,
- null handling,
- dependency injection,
- side effects,
- message path,
- group behavior.

### 26.5 Cari Validation Groups

```bash
rg "groups\s*=|interface .*Group|@GroupSequence|Default\.class" src
```

Group explosion adalah smell besar.

### 26.6 Cari Error Mapping

```bash
rg "ConstraintViolationException|MethodArgumentNotValidException|BindException|ProblemDetail" src
```

Pastikan error response tidak tergantung message string fragile.

---

## 27. Enterprise Compatibility Decision Tree

Gunakan decision tree berikut saat memilih stack.

```text
Are you on Spring Boot 2.x / Java EE 8?
    |
    +-- yes -> stay javax.validation / HV 6.x unless platform migration planned
    |
    +-- no
        |
        v
Are you on Spring Boot 3.x / Jakarta EE 10?
    |
    +-- yes -> use jakarta.validation / HV 8.x or platform-managed version
    |
    +-- no
        |
        v
Are you on Jakarta EE 11?
    |
    +-- yes -> use Jakarta Validation 3.1 / HV 9.x or server provider
    |
    +-- no
        |
        v
Plain Java SE app?
    |
    +-- yes -> choose API + provider explicitly based on Java runtime
```

Second-level questions:

```text
Need Java 8 runtime?
    -> cannot use Jakarta Validation 3.1/HV 9

Need Java 17+ only?
    -> jakarta namespace preferred for modern stack

Have shared DTO consumed by legacy and modern apps?
    -> avoid accidental mixed namespace; design migration boundary

Using application server?
    -> check server-provided validation provider/version

Using Spring Boot?
    -> prefer Boot dependency management
```

---

## 28. Anti-Patterns di Specification Landscape

### 28.1 “Kita Pakai Hibernate Validator, Jadi Tidak Perlu Tahu Spec”

Salah.

Tanpa spec knowledge, kamu tidak tahu:

- mana portable,
- mana provider-specific,
- behavior mana guaranteed,
- migration impact,
- interoperability risk.

### 28.2 “`javax` ke `jakarta` Tinggal Search Replace”

Salah.

Search-replace hanya satu bagian. Yang penting:

- dependency alignment,
- framework alignment,
- runtime provider,
- generated code,
- test behavior,
- shared library compatibility.

### 28.3 “Tambahkan Dua API Biar Aman”

Salah dalam banyak kasus.

Dua API bisa membuat:

- annotation duplicated,
- runtime behavior tidak jelas,
- dependency conflict,
- hidden non-validation.

### 28.4 “Pakai Latest Hibernate Validator Selalu Lebih Baik”

Tidak selalu.

Latest provider harus cocok dengan:

- Java runtime,
- Jakarta API version,
- framework version,
- application server,
- EL dependency,
- transitive dependencies.

### 28.5 “Annotation Standard Selalu Aman untuk Business Rule”

Tidak.

Spec standard tidak berarti rule placement tepat. `@NotNull` bisa standard, tapi jika ditempel pada DTO yang dipakai create dan patch sekaligus, desainnya tetap salah.

---

## 29. Practical Versioning Recommendations

### 29.1 Untuk Java 8 Legacy

Gunakan:

```text
javax.validation
Bean Validation 2.0 / Jakarta Bean Validation 2.0
Hibernate Validator 6.x
```

Design:

- manfaatkan container element constraints jika tersedia,
- hindari dependency modern Jakarta,
- jangan campur `jakarta.validation`,
- siapkan migration inventory jika menuju Java 17+.

### 29.2 Untuk Java 11 Transitional

Jika masih Spring Boot 2.x:

```text
javax.validation + HV 6.x
```

Jika platform custom dan ingin pindah ke Jakarta, evaluasi dependency besar karena Java 11 bisa menjadi constraint untuk Jakarta EE 11/HV 9.

### 29.3 Untuk Java 17 Modern

Gunakan:

```text
jakarta.validation
HV 8.x untuk Jakarta EE 10/Spring Boot 3 mainstream
HV 9.x untuk Jakarta EE 11/Jakarta Validation 3.1
```

Design:

- records untuk DTO bisa dipakai,
- gunakan constructor-bound validation dengan hati-hati,
- jangan memindahkan workflow rule ke annotation groups terlalu jauh.

### 29.4 Untuk Java 21/25 Modern

Gunakan platform-managed Jakarta stack.

Prinsip:

- ikuti Spring Boot/Jakarta EE BOM,
- pastikan provider support JDK target,
- gunakan records/sealed types jika meningkatkan model clarity,
- tetap pisahkan shape validation, domain invariant, workflow guard, dan DB constraint.

---

## 30. Example: Membaca Dependency Tree dan Menentukan Era

Misal dependency tree menunjukkan:

```text
javax.validation:validation-api:2.0.1.Final
org.hibernate.validator:hibernate-validator:6.2.5.Final
```

Interpretasi:

```text
Era: Bean Validation 2.0 / javax
Likely stack: Spring Boot 2.x or Java EE 8
Modern features: container element constraints available
Not compatible with: Spring Boot 3/Jakarta EE 10+ namespace without migration
```

Misal:

```text
jakarta.validation:jakarta.validation-api:3.0.2
org.hibernate.validator:hibernate-validator:8.0.x.Final
```

Interpretasi:

```text
Era: Jakarta Bean Validation 3.0
Likely stack: Spring Boot 3 / Jakarta EE 10
Namespace: jakarta
Java baseline: often 17 in framework stack
```

Misal:

```text
jakarta.validation:jakarta.validation-api:3.1.x
org.hibernate.validator:hibernate-validator:9.x.Final
```

Interpretasi:

```text
Era: Jakarta Validation 3.1 / Jakarta EE 11
Provider: HV 9
Java baseline: 17+
Records support clarified
```

Misal mixed:

```text
javax.validation:validation-api:2.0.1.Final
jakarta.validation:jakarta.validation-api:3.0.2
org.hibernate.validator:hibernate-validator:8.0.x.Final
```

Interpretasi:

```text
Risk: mixed namespace
Action: inspect transitive dependencies and imports
Do not assume validation behavior is correct
Add runtime smoke tests
```

---

## 31. Mental Model: Validation Stack as a Contract Pipeline

Bayangkan validation stack seperti pipeline kontrak:

```text
Source code annotation
        |
        v
API namespace identity
        |
        v
Provider metadata discovery
        |
        v
Framework trigger point
        |
        v
Violation construction
        |
        v
Exception / result mapping
        |
        v
Client-visible error contract
```

Migration bisa gagal di setiap titik.

### 31.1 Annotation Ada, Tapi Namespace Salah

```text
source looks valid -> provider ignores -> no violation
```

### 31.2 Provider Ada, Tapi Framework Tidak Memanggil

```text
manual validator works -> REST endpoint does not validate
```

### 31.3 Violation Ada, Tapi Error Mapping Buruk

```text
validation detects issue -> client receives generic 500 or unreadable 400
```

### 31.4 Constraint Benar, Tapi Layer Salah

```text
annotation rejects valid PATCH because DTO reused from CREATE
```

Engineer top-tier debug validation sebagai pipeline, bukan sebagai isolated annotation.

---

## 32. Mini Case Study: Upgrade Spring Boot 2 to 3

### 32.1 Starting Point

```text
Java 11
Spring Boot 2.7
Hibernate Validator 6.x
javax.validation
```

DTO:

```java
import javax.validation.constraints.NotBlank;

public class CreateApplicationRequest {
    @NotBlank
    private String applicantName;
}
```

Controller:

```java
import javax.validation.Valid;

@PostMapping("/applications")
public ResponseEntity<?> create(@Valid @RequestBody CreateApplicationRequest request) {
    return ResponseEntity.ok().build();
}
```

### 32.2 Target

```text
Java 17/21
Spring Boot 3.x
Hibernate Validator 8.x or platform-managed
jakarta.validation
```

### 32.3 Required Changes

```java
import jakarta.validation.constraints.NotBlank;

public class CreateApplicationRequest {
    @NotBlank
    private String applicantName;
}
```

```java
import jakarta.validation.Valid;

@PostMapping("/applications")
public ResponseEntity<?> create(@Valid @RequestBody CreateApplicationRequest request) {
    return ResponseEntity.ok().build();
}
```

### 32.4 Hidden Work

- update custom validators:

```java
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
```

- update exception handlers:

```java
import jakarta.validation.ConstraintViolationException;
```

- update tests,
- update generated DTO templates,
- remove `javax.validation-api`,
- verify no transitive legacy API,
- verify REST validation returns 400,
- verify manual validator sees constraints,
- verify method validation still works.

### 32.5 Production Risk

Most dangerous risk:

```text
invalid request accepted because validation annotation namespace is stale
```

Mitigation:

- CI import ban,
- runtime smoke tests,
- endpoint integration tests,
- dependency tree enforcement,
- rollout monitoring for validation rejection rate.

---

## 33. Mini Case Study: Shared DTO Library Used by Java 8 and Java 21 Apps

### 33.1 Problem

A company has:

```text
legacy-service-a: Java 8, Spring Boot 2, javax.validation
modern-service-b: Java 21, Spring Boot 3, jakarta.validation
common-dto.jar: contains request/response classes
```

If `common-dto.jar` uses `javax.validation`, modern service has mismatch.
If `common-dto.jar` uses `jakarta.validation`, legacy service has mismatch.

### 33.2 Bad Option

Dual annotate every field:

```java
@javax.validation.constraints.NotBlank
@jakarta.validation.constraints.NotBlank
private String name;
```

This creates long-term maintenance debt.

### 33.3 Better Options

#### Option A: Versioned artifacts

```text
common-dto-legacy: javax.validation
common-dto-jakarta: jakarta.validation
```

Pros:

- clear contract,
- no runtime ambiguity,
- migration explicit.

Cons:

- duplicated artifact management,
- version sync needed.

#### Option B: Annotation-free core DTO + adapter validation models

```text
common-dto-core: no validation annotations
legacy-api-model: javax validation
modern-api-model: jakarta validation
```

Pros:

- clean boundary,
- avoids namespace conflict,
- explicit API contract per platform.

Cons:

- mapping overhead,
- more classes.

#### Option C: JSON schema/OpenAPI contract at boundary

Use generated platform-specific models from schema.

Pros:

- service boundaries language/platform-neutral,
- generated validation can match runtime.

Cons:

- schema governance needed,
- generated code customization.

### 33.4 Decision Principle

If a library crosses platform generations, do not hide the generation boundary. Make it explicit.

---

## 34. What This Means for Top 1% Engineering

A surface-level engineer knows:

```java
@NotNull
private String name;
```

A strong senior engineer knows:

- whether this is `javax` or `jakarta`,
- which provider executes it,
- whether framework triggers it,
- whether it applies to create/update/patch,
- whether database also enforces it,
- whether error mapping is stable,
- whether it leaks PII,
- whether migration can silently disable it,
- whether provider-specific constraints are acceptable,
- whether validation belongs here or in workflow/domain layer.

A top-tier engineer sees validation as:

```text
contract declaration + runtime execution + layer placement + failure semantics + migration compatibility + operational governance
```

---

## 35. Checklist: Specification Landscape Readiness

Use this checklist before moving deeper.

### 35.1 Identify Stack

- [ ] What Java version is the service running?
- [ ] Is the framework Spring Boot 2, Spring Boot 3, Jakarta EE 8/10/11, or plain Java SE?
- [ ] Which validation API artifact is present?
- [ ] Which provider is present?
- [ ] Which Hibernate Validator major version is present?
- [ ] Is Expression Language dependency compatible?

### 35.2 Identify Namespace

- [ ] Are imports consistently `javax.validation`?
- [ ] Are imports consistently `jakarta.validation`?
- [ ] Is there any mixed namespace in source?
- [ ] Is there any mixed namespace in dependencies?
- [ ] Are generated sources checked?
- [ ] Are shared DTO jars checked?

### 35.3 Identify Runtime Behavior

- [ ] Does manual `Validator` reject invalid object?
- [ ] Does REST endpoint reject invalid body?
- [ ] Does method validation execute?
- [ ] Does JPA lifecycle validation execute if expected?
- [ ] Are custom constraints discovered?
- [ ] Are message bundles loaded?

### 35.4 Identify Governance

- [ ] Are provider-specific constraints documented?
- [ ] Is there CI enforcement for banned namespace?
- [ ] Is there dependency convergence enforcement?
- [ ] Are API error responses stable?
- [ ] Is migration strategy defined for shared libraries?

---

## 36. Key Takeaways

1. **Bean Validation/Jakarta Validation adalah specification; Hibernate Validator adalah implementation/provider.** Jangan mencampur keduanya secara mental.

2. **`javax.validation` dan `jakarta.validation` adalah namespace berbeda.** Annotation dengan nama sama bukan class yang sama.

3. **Bean Validation 2.0 adalah baseline penting untuk Java 8 era** karena membawa container element constraints, `Optional`, Java time support, value extractors, dan constraints baru.

4. **Jakarta Bean Validation 3.0 adalah namespace break.** Ini titik migration besar dari `javax` ke `jakarta`.

5. **Jakarta Validation 3.1 adalah Jakarta EE 11 era**, minimum Java 17, dengan records support clarification dan updated dependencies.

6. **Hibernate Validator major version harus selaras dengan API namespace dan platform.** HV 6 untuk `javax`, HV 8 untuk Jakarta EE 10 era, HV 9 untuk Jakarta Validation 3.1/Jakarta EE 11 era.

7. **Migration bukan sekadar import rename.** Ia mencakup dependency tree, generated code, custom constraints, exception handling, provider, framework integration, tests, dan runtime behavior.

8. **Mixed namespace dapat menyebabkan silent non-validation.** Ini salah satu risiko produksi paling serius.

9. **Provider-specific features boleh dipakai secara sadar, bukan tidak sengaja.** Bedakan standard constraint dan Hibernate extension.

10. **Top-tier engineer memvalidasi pipeline, bukan annotation.** Mulai dari source code sampai client-visible error contract.

---

## 37. Preparation for Part 002

Part berikutnya akan masuk ke core API mental model:

```text
ValidatorFactory
Validator
ConstraintViolation
Path
ElementKind
ConstraintDescriptor
BeanDescriptor
PropertyDescriptor
```

Kita akan membedah bagaimana validation engine melihat model, bagaimana violation direpresentasikan, bagaimana path dibentuk, dan kenapa metadata API sangat penting untuk arsitektur error contract, UI generation, observability, dan advanced tooling.

---

## 38. Status Seri

Seri belum selesai.

Bagian yang sudah dibuat:

- Part 000 — Orientation: Validation as Contract, Boundary Defense, and Domain Integrity
- Part 001 — Specification Landscape: Bean Validation, Jakarta Validation, `javax` vs `jakarta`

Bagian berikutnya:

- Part 002 — Core API Mental Model: `ValidatorFactory`, `Validator`, `ConstraintViolation`, Metadata

