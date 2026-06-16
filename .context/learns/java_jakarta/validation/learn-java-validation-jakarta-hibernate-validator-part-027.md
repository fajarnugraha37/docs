# learn-java-validation-jakarta-hibernate-validator-part-027

# Migration Playbook: `javax.validation` ke `jakarta.validation`, Spring Boot 2→3, Hibernate Validator 6→9

> Seri: `learn-java-validation-jakarta-hibernate-validator`  
> Bagian: 027 dari 030  
> Target pembaca: Java engineer senior/tech lead yang perlu memigrasikan aplikasi legacy Java 8/11/Spring Boot 2/Jakarta EE lama menuju stack modern Java 17/21/25, Spring Boot 3+, Jakarta EE 10/11, dan Hibernate Validator 8/9.  
> Fokus: bukan sekadar mengganti import, tetapi mengelola kompatibilitas runtime, dependency graph, framework integration, behavior regression, testing, rollout, dan governance.

---

## 0. Tujuan Bagian Ini

Migrasi validation dari era `javax.validation` ke `jakarta.validation` sering terlihat seperti pekerjaan mekanis:

```java
// Before
import javax.validation.Valid;
import javax.validation.constraints.NotNull;

// After
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
```

Tetapi di sistem nyata, terutama sistem enterprise/regulatory/case management, perubahan ini jarang hanya tentang import.

Yang ikut berubah biasanya:

- baseline Java runtime,
- Spring Boot/Spring Framework version,
- Jakarta EE API version,
- servlet container,
- Hibernate Validator major version,
- Hibernate ORM/JPA version,
- transitive dependencies,
- generated code,
- annotation processing,
- reflection/AOT configuration,
- test utilities,
- REST error mapping,
- JPA lifecycle validation,
- custom constraints,
- method validation,
- external libraries yang masih memakai `javax.*`,
- build plugins,
- OpenAPI generator,
- MapStruct/Lombok interaction,
- deployment image/base image.

Maka bagian ini membangun playbook yang menjawab:

1. **Apa sebenarnya yang berubah?**
2. **Apa yang tidak berubah secara konsep?**
3. **Kombinasi versi mana yang valid?**
4. **Kenapa mencampur `javax.validation` dan `jakarta.validation` sering menghasilkan bug diam-diam?**
5. **Bagaimana melakukan migrasi bertahap tanpa merusak kontrak API?**
6. **Bagaimana menguji bahwa perilaku validasi tetap sama?**
7. **Bagaimana mengelola rollout untuk codebase besar?**

---

## 1. Mental Model: Ini Bukan Rename, Ini Perpindahan Ekosistem

Perubahan `javax.validation` ke `jakarta.validation` adalah bagian dari perpindahan Java EE menuju Jakarta EE.

Secara permukaan:

```text
javax.validation.*  -> jakarta.validation.*
```

Tetapi secara operasional:

```text
Java EE / Bean Validation era
    -> Jakarta EE namespace era
    -> Jakarta Validation 3.x
    -> Hibernate Validator 7/8/9
    -> Spring Framework 6/7 or Jakarta EE 10/11 runtime
```

Artinya, migration unit yang benar bukan hanya satu source file, tetapi satu **runtime alignment set**.

Contoh alignment set:

```text
Legacy stack:
Java 8/11
Spring Boot 2.x
Spring Framework 5.x
javax.validation-api 2.0
Hibernate Validator 6.x
Servlet javax.servlet.*
JPA javax.persistence.*

Modern stack:
Java 17+
Spring Boot 3.x
Spring Framework 6.x
jakarta.validation-api 3.0/3.1
Hibernate Validator 8.x/9.x
Servlet jakarta.servlet.*
JPA jakarta.persistence.*
```

Jika hanya satu layer diganti, sistem bisa compile tetapi gagal runtime, atau lebih buruk: validasi tidak berjalan pada annotation lama.

---

## 2. Version Landscape yang Harus Dipahami

### 2.1 Bean Validation / Jakarta Validation

Ringkasnya:

| Era | Spec | Namespace | Karakter penting |
|---|---:|---|---|
| Bean Validation 1.0 | JSR 303 | `javax.validation` | dasar constraint bean |
| Bean Validation 1.1 | JSR 349 | `javax.validation` | method validation |
| Bean Validation 2.0 | JSR 380 | `javax.validation` | Java 8 support, container element constraints, `Optional`, Java time |
| Jakarta Bean Validation 2.0 | Jakarta EE 8 | `javax.validation` | masih namespace `javax` |
| Jakarta Bean Validation 3.0 | Jakarta EE 9/10 | `jakarta.validation` | namespace pindah ke `jakarta` |
| Jakarta Validation 3.1 | Jakarta EE 11 | `jakarta.validation` | Java 17 minimum, record clarification, dependency update |

Jakarta Validation 3.1 mendefinisikan metadata model dan API untuk JavaBean serta method validation, menargetkan Jakarta EE 11, dan mengklarifikasi dukungan Java Records. Dokumentasi resmi Jakarta Validation menyebut release 3.1 sebagai release untuk Jakarta EE 11. Referensi: <https://jakarta.ee/specifications/bean-validation/3.1/>.

Update 3.1 juga menetapkan Java 17 sebagai minimum, mengganti nama spesifikasi dari Jakarta Bean Validation menjadi Jakarta Validation, dan mengklarifikasi record validation. Referensi: <https://beanvalidation.org/news/2025/02/17/bean-validation-3-1/>.

### 2.2 Hibernate Validator

Hibernate Validator adalah reference implementation utama untuk Bean/Jakarta Validation.

| Hibernate Validator | Namespace | Spec target | Java baseline umum | Catatan |
|---:|---|---|---:|---|
| 5.x | `javax.validation` | Bean Validation 1.1 | Java 6/7/8 era | legacy |
| 6.x | `javax.validation` | Bean Validation 2.0 | Java 8+ | cocok Spring Boot 2.x |
| 7.x | `jakarta.validation` | Jakarta Validation 3.0 | Java 8/11 tergantung minor | awal namespace Jakarta |
| 8.x | `jakarta.validation` | Jakarta Validation 3.0 | Java 11+ pada banyak setup | Jakarta EE 10 era, `@UUID` tersedia |
| 9.x | `jakarta.validation` | Jakarta Validation 3.1 | Java 17+ | Jakarta EE 11 era |

Hibernate Validator release page menyatakan HV 9.0 menargetkan Jakarta EE 11 dan mengimplementasikan Jakarta Validation 3.1. Referensi: <https://hibernate.org/validator/releases/>.

Hibernate Validator migration guide untuk 9.x menyatakan HV sekarang membutuhkan JDK 17, berbasis Jakarta Validation 3.1, dan Jakarta Expression Language 6.0. Referensi: <https://hibernate.org/validator/documentation/migration-guide/>.

### 2.3 Spring Boot / Spring Framework

Simplifikasi praktis:

| Stack | Java baseline | Validation namespace | Umumnya memakai |
|---|---:|---|---|
| Spring Boot 2.x | Java 8/11/17 tergantung versi | `javax.validation` | Spring Framework 5.x, HV 6.x |
| Spring Boot 3.x | Java 17+ | `jakarta.validation` | Spring Framework 6.x, HV 8.x |
| Spring Framework 7.x era | Java modern | `jakarta.validation` 3.1 | HV 9.x/9.1, Jakarta EE 11-related APIs |

Spring Boot 3.0 migration guide menyatakan Boot 3 membutuhkan Java 17 atau lebih baru dan Spring Framework 6.0. Referensi: <https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-3.0-Migration-Guide>.

Spring Framework 7 release notes menyebut dukungan Bean Validation 3.1 dengan Hibernate Validator 9.0/9.1. Referensi: <https://github.com/spring-projects/spring-framework/wiki/Spring-Framework-7.0-Release-Notes>.

---

## 3. Prinsip Utama Migrasi

### Prinsip 1 — Jangan campur namespace dalam satu runtime validation boundary

Ini sumber bug paling umum.

Contoh buruk:

```java
import javax.validation.constraints.NotNull;

public class CreateUserRequest {
    @NotNull
    private String name;
}
```

Aplikasi sudah memakai Spring Boot 3 + Hibernate Validator 8/9 yang membaca `jakarta.validation.*`.

Akibatnya, annotation `javax.validation.constraints.NotNull` bisa tidak dianggap constraint oleh provider Jakarta. Kode compile jika dependency `javax.validation-api` masih ada, tetapi validasi tidak terjadi.

Bentuk bug:

```text
request invalid masuk
controller terlihat punya @Valid
tidak ada violation
service menerima data invalid
bug muncul jauh di bawah: NPE, DB error, workflow inconsistency
```

Aturan praktis:

```text
Spring Boot 2 / HV 6  -> gunakan javax.validation.*
Spring Boot 3 / HV 8  -> gunakan jakarta.validation.*
Jakarta EE 11 / HV 9  -> gunakan jakarta.validation.*
```

### Prinsip 2 — Align seluruh Jakarta family, bukan hanya validation

Jika aplikasi memakai Spring Boot 3 atau Jakarta EE 10/11, kemungkinan besar semua ini ikut pindah:

```text
javax.validation.*      -> jakarta.validation.*
javax.persistence.*     -> jakarta.persistence.*
javax.servlet.*         -> jakarta.servlet.*
javax.annotation.*      -> jakarta.annotation.*
javax.ws.rs.*           -> jakarta.ws.rs.*
javax.transaction.*     -> jakarta.transaction.*
javax.inject.*          -> jakarta.inject.*
javax.xml.bind.*        -> jakarta.xml.bind.*
```

Validation jarang berdiri sendiri. Ia terhubung ke:

- REST controller,
- JPA entity,
- method validation proxy,
- exception handler,
- message interpolation,
- servlet binding,
- generated OpenAPI DTO,
- test framework.

### Prinsip 3 — Migration harus behavior-preserving terlebih dahulu

Jangan gabungkan terlalu banyak perubahan rule dengan perubahan namespace.

Urutan aman:

```text
Phase A: preserve behavior
- ganti namespace
- align dependency
- pastikan validation still fires
- pastikan API error shape tetap sama

Phase B: improve design
- ganti DTO model
- tambah records
- ubah group strategy
- tambah payload/error code
- optimasi performance
```

Jika rename namespace dan refactor rule dilakukan bersamaan, ketika regression terjadi sulit tahu penyebabnya.

### Prinsip 4 — Validation migration adalah contract migration

Yang harus stabil bukan hanya compile.

Yang harus dibandingkan:

- request invalid mana yang ditolak,
- status code apa yang dikembalikan,
- field path apa yang muncul,
- error code apa yang keluar,
- message key apa yang dipakai,
- locale behavior,
- group behavior,
- method validation behavior,
- JPA lifecycle validation behavior,
- custom validator behavior.

---

## 4. Dependency Alignment Matrix

### 4.1 Common legacy Spring Boot 2 stack

```xml
<!-- Typical legacy style -->
<dependency>
    <groupId>javax.validation</groupId>
    <artifactId>validation-api</artifactId>
    <version>2.0.1.Final</version>
</dependency>

<dependency>
    <groupId>org.hibernate.validator</groupId>
    <artifactId>hibernate-validator</artifactId>
    <version>6.2.x.Final</version>
</dependency>
```

Atau lewat Boot starter:

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-validation</artifactId>
</dependency>
```

Pada Boot 2.x, starter biasanya membawa Hibernate Validator 6.x dan `javax.validation`.

### 4.2 Spring Boot 3 stack

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-validation</artifactId>
</dependency>
```

Kode:

```java
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
```

Jangan tambahkan manual `javax.validation-api`.

### 4.3 Jakarta Validation 3.1 / Hibernate Validator 9 style

Untuk non-Spring Java SE/Jakarta EE setup, dependency bisa mengikuti BOM atau artifact modern dari Hibernate Validator.

Contoh konseptual Maven:

```xml
<dependencyManagement>
    <dependencies>
        <dependency>
            <groupId>org.hibernate.validator</groupId>
            <artifactId>hibernate-validator-bom</artifactId>
            <version>9.0.1.Final</version>
            <type>pom</type>
            <scope>import</scope>
        </dependency>
    </dependencies>
</dependencyManagement>

<dependencies>
    <dependency>
        <groupId>org.hibernate.validator</groupId>
        <artifactId>hibernate-validator</artifactId>
    </dependency>

    <!-- If running in plain Java SE and EL implementation is not provided by container -->
    <dependency>
        <groupId>org.glassfish.expressly</groupId>
        <artifactId>expressly</artifactId>
    </dependency>
</dependencies>
```

Catatan:

- Jangan copy dependency secara buta.
- Gunakan BOM/platform dari framework jika aplikasi dikelola Spring Boot/Quarkus/Jakarta EE server.
- Untuk Java SE, pastikan Expression Language implementation tersedia bila message interpolation membutuhkan EL.

---

## 5. Migration Inventory: Apa Saja yang Harus Dicari

Sebelum mengubah kode, lakukan inventory.

### 5.1 Source imports

Cari:

```text
javax.validation
javax.validation.constraints
javax.validation.groups
javax.validation.metadata
javax.validation.executable
```

Command sederhana:

```bash
grep -R "javax.validation" -n src/ test/ build.gradle pom.xml
```

Atau ripgrep:

```bash
rg "javax\.validation|jakarta\.validation" .
```

### 5.2 Annotation di source dan generated source

Cek:

```text
src/main/java
src/test/java
src/generated
build/generated
openapi generated DTO
jaxb generated classes
mapstruct generated classes
protobuf/grpc wrappers jika ada validation annotation
```

Generated source sering terlewat karena tidak muncul di IDE search biasa.

### 5.3 Custom constraints

Cari annotation custom:

```java
@Constraint(validatedBy = ...)
public @interface ValidSomething {
    String message() default "...";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};
}
```

Hal yang harus diganti:

```text
javax.validation.Constraint       -> jakarta.validation.Constraint
javax.validation.Payload          -> jakarta.validation.Payload
javax.validation.ConstraintValidator -> jakarta.validation.ConstraintValidator
javax.validation.ConstraintValidatorContext -> jakarta.validation.ConstraintValidatorContext
```

### 5.4 Exception handling

Cari:

```text
ConstraintViolationException
MethodArgumentNotValidException
BindException
HandlerMethodValidationException
```

Pada Spring 6/Boot 3, beberapa mekanisme method validation dan error handling berubah/bertambah. Jangan asumsikan exception type sama untuk semua path.

### 5.5 Method validation

Cari:

```text
@Validated
@Valid on service method
constraints on method parameters
constraints on return values
```

Jebakan:

- proxy behavior berubah ketika bean final,
- self-invocation tetap tidak tervalidasi,
- parameter name discovery berubah bila compile flag tidak benar,
- error path bisa berbeda.

### 5.6 JPA entity validation

Cari:

```text
@Entity
@PrePersist
@PreUpdate
@NotNull on entity fields
@Valid on entity relationships
jakarta.persistence / javax.persistence
```

JPA migration sering terjadi bersama validation migration.

### 5.7 XML validation mapping

Jika memakai XML mapping lama:

```text
META-INF/validation.xml
constraint-mappings
```

Cek namespace/schema.

### 5.8 Build/dependency graph

Maven:

```bash
mvn dependency:tree | grep -E "validation|hibernate-validator|javax|jakarta"
```

Gradle:

```bash
./gradlew dependencies --configuration runtimeClasspath | grep -E "validation|hibernate-validator|javax|jakarta"
```

Cari konflik:

```text
javax.validation:validation-api
jakarta.validation:jakarta.validation-api
org.hibernate.validator:hibernate-validator 6.x
org.hibernate.validator:hibernate-validator 8.x/9.x
```

### 5.9 Runtime container

Cek:

- Tomcat 9 vs Tomcat 10/11,
- Jetty version,
- WildFly/Payara/OpenLiberty/JBoss version,
- Jakarta EE support level,
- Java runtime image.

Servlet namespace mismatch dapat membuat aplikasi gagal deploy bahkan sebelum validation berjalan.

---

## 6. Mechanical Rename: Aman Tapi Tidak Cukup

### 6.1 Basic import migration

Before:

```java
import javax.validation.Valid;
import javax.validation.constraints.NotBlank;
import javax.validation.constraints.NotNull;
```

After:

```java
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
```

### 6.2 Custom constraint migration

Before:

```java
import javax.validation.Constraint;
import javax.validation.Payload;
import java.lang.annotation.Documented;
import java.lang.annotation.Retention;
import java.lang.annotation.Target;

import static java.lang.annotation.ElementType.FIELD;
import static java.lang.annotation.ElementType.PARAMETER;
import static java.lang.annotation.RetentionPolicy.RUNTIME;

@Documented
@Constraint(validatedBy = CaseReferenceValidator.class)
@Target({ FIELD, PARAMETER })
@Retention(RUNTIME)
public @interface ValidCaseReference {
    String message() default "Invalid case reference";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};
}
```

After:

```java
import jakarta.validation.Constraint;
import jakarta.validation.Payload;
import java.lang.annotation.Documented;
import java.lang.annotation.Retention;
import java.lang.annotation.Target;

import static java.lang.annotation.ElementType.FIELD;
import static java.lang.annotation.ElementType.PARAMETER;
import static java.lang.annotation.ElementType.TYPE_USE;
import static java.lang.annotation.RetentionPolicy.RUNTIME;

@Documented
@Constraint(validatedBy = CaseReferenceValidator.class)
@Target({ FIELD, PARAMETER, TYPE_USE })
@Retention(RUNTIME)
public @interface ValidCaseReference {
    String message() default "{case.reference.invalid}";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};
}
```

Validator:

```java
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

public final class CaseReferenceValidator
        implements ConstraintValidator<ValidCaseReference, String> {

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        if (value == null) {
            return true;
        }
        return value.matches("^[A-Z]{2}-[0-9]{6}$");
    }
}
```

### 6.3 Executable validation migration

Before:

```java
import javax.validation.executable.ExecutableValidator;
```

After:

```java
import jakarta.validation.executable.ExecutableValidator;
```

### 6.4 Metadata API migration

Before:

```java
import javax.validation.metadata.BeanDescriptor;
import javax.validation.metadata.ConstraintDescriptor;
```

After:

```java
import jakarta.validation.metadata.BeanDescriptor;
import jakarta.validation.metadata.ConstraintDescriptor;
```

---

## 7. OpenRewrite untuk Migrasi Skala Besar

Untuk codebase besar, manual import replacement rawan.

OpenRewrite menyediakan recipe untuk memigrasikan deprecated `javax.validation` ke `jakarta.validation`. Dokumentasi resmi recipe: <https://docs.openrewrite.org/recipes/java/migrate/jakarta/javaxvalidationmigrationtojakartavalidation>.

### 7.1 Contoh Gradle konseptual

```gradle
plugins {
    id("org.openrewrite.rewrite") version "latest.release"
}

rewrite {
    activeRecipe("org.openrewrite.java.migrate.jakarta.JavaxValidationMigrationToJakartaValidation")
}
```

Jalankan:

```bash
./gradlew rewriteRun
```

### 7.2 Contoh Maven konseptual

```bash
mvn -U org.openrewrite.maven:rewrite-maven-plugin:run \
  -Drewrite.activeRecipes=org.openrewrite.java.migrate.jakarta.JavaxValidationMigrationToJakartaValidation
```

### 7.3 Setelah automated rewrite

Tetap lakukan review manual untuk:

- generated code,
- string literal references,
- reflection references,
- XML mapping,
- docs/OpenAPI examples,
- custom test utilities,
- dependency graph,
- shaded/relocated libraries,
- framework-specific behavior.

Automated rewrite mempercepat rename, bukan membuktikan runtime correctness.

---

## 8. Mixed Namespace Failure Modes

### 8.1 Compile succeeds, validation silently does not fire

Kondisi:

```text
Runtime provider: jakarta.validation.Validator
DTO annotation: javax.validation.constraints.NotNull
```

Kemungkinan hasil:

```text
@NotNull tidak dianggap constraint oleh provider modern
```

Ini lebih buruk dari compile failure karena bug baru muncul di runtime business flow.

### 8.2 Two validation APIs on classpath

Dependency tree:

```text
jakarta.validation:jakarta.validation-api:3.x
javax.validation:validation-api:2.0.1.Final
org.hibernate.validator:hibernate-validator:8.x/9.x
```

Risiko:

- compile ambiguity,
- wrong import oleh IDE,
- custom annotation memakai `javax.Payload`,
- validator memakai `jakarta.ConstraintValidator`,
- framework auto-config memakai provider modern tapi DTO masih legacy.

### 8.3 Custom constraint split brain

Annotation:

```java
import javax.validation.Constraint;
import javax.validation.Payload;

@Constraint(validatedBy = MyValidator.class)
public @interface MyConstraint {
    Class<? extends Payload>[] payload() default {};
}
```

Validator:

```java
import jakarta.validation.ConstraintValidator;
```

Ini bukan satu contract yang konsisten. Jangan campur.

### 8.4 Library masih expose `javax` DTO

Misal shared library lama:

```java
public class SharedRequest {
    @javax.validation.constraints.NotNull
    private String id;
}
```

Service modern:

```java
@PostMapping
public void submit(@Valid @RequestBody SharedRequest request) { ... }
```

Validasi bisa tidak berjalan sesuai ekspektasi.

Solusi:

- migrate shared library,
- publish major version baru,
- jangan pakai shared DTO lintas era,
- buat adapter DTO lokal,
- tambahkan contract tests.

---

## 9. Spring Boot 2 → 3 Validation Migration

### 9.1 Baseline change

Spring Boot 3 membutuhkan Java 17+. Jadi jika aplikasi masih Java 8/11, migration path tidak bisa langsung hanya ubah import.

Path umum:

```text
Step 1: upgrade legacy Boot ke latest 2.7.x
Step 2: bersihkan deprecation dan dependency conflict
Step 3: naik Java runtime ke 17
Step 4: migrate javax -> jakarta
Step 5: upgrade Boot 3.x
Step 6: regression test validation/API/JPA/security
```

### 9.2 Dependency

Before Boot 2:

```java
import javax.validation.Valid;
import javax.validation.constraints.NotBlank;
```

After Boot 3:

```java
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
```

Starter tetap:

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-validation</artifactId>
</dependency>
```

Jangan override Hibernate Validator sembarangan kecuali ada alasan jelas dan sudah sesuai BOM.

### 9.3 Controller validation

Before:

```java
@PostMapping("/cases")
public ResponseEntity<?> create(@Valid @RequestBody CreateCaseRequest request) {
    ...
}
```

After secara bentuk hampir sama:

```java
@PostMapping("/cases")
public ResponseEntity<?> create(@Valid @RequestBody CreateCaseRequest request) {
    ...
}
```

Tetapi import berubah:

```java
import jakarta.validation.Valid;
```

### 9.4 Method validation

Spring style:

```java
@Service
@Validated
public class CaseService {

    public CaseId submit(@NotNull SubmitCaseCommand command) {
        ...
    }
}
```

Import:

```java
import jakarta.validation.constraints.NotNull;
import org.springframework.validation.annotation.Validated;
```

`@Validated` tetap dari Spring, bukan Jakarta.

### 9.5 Error handling

Legacy handler:

```java
@ExceptionHandler(MethodArgumentNotValidException.class)
public ResponseEntity<ApiError> handle(MethodArgumentNotValidException ex) {
    ...
}
```

Masih relevan, tetapi cek behavior aktual Spring version.

Untuk method parameter constraint pada request mapping, Spring Framework modern juga punya exception path tambahan. Jangan hanya test body validation; test juga:

- request body,
- query param,
- path variable,
- header,
- method-level service validation,
- return value validation jika dipakai.

---

## 10. Hibernate Validator 6 → 7/8/9 Migration

### 10.1 HV 6.x

- `javax.validation`
- Bean Validation 2.0
- cocok untuk Java 8+ dan Spring Boot 2.x
- container element constraints sudah tersedia
- Java time constraints tersedia

### 10.2 HV 7.x

- pindah ke `jakarta.validation`
- Jakarta Validation 3.0
- migration besar namespace

### 10.3 HV 8.x

- Jakarta Validation 3.0
- Jakarta EE 10 era
- dipakai luas di Spring Boot 3.x ecosystem
- Hibernate-specific constraint seperti `@UUID` tersedia pada seri modern

### 10.4 HV 9.x

- Jakarta Validation 3.1
- Jakarta EE 11 target
- Java 17 minimum
- Jakarta Expression Language 6.0 requirement untuk EL-compatible interpolation
- menghapus beberapa API/properti lama yang sudah deprecated
- tidak lagi menerbitkan relocation POM lama untuk group id lama menurut announcement HV 9.0

Referensi HV 9.0 announcement: <https://in.relation.to/2025/05/20/hibernate-validator-9-0-0-Final/>.

### 10.5 Migration risk HV 6 → 8/9

Checklist:

```text
[ ] Semua import javax.validation diganti jakarta.validation
[ ] Semua custom constraints diganti konsisten
[ ] validation.xml diperbarui
[ ] ConstraintValidatorFactory masih compatible
[ ] MessageInterpolator custom masih compatible
[ ] ParameterNameProvider custom masih compatible
[ ] ValueExtractor custom masih compatible
[ ] Hibernate-specific annotations dicek availability-nya
[ ] Dependency EL tersedia jika perlu
[ ] Test method validation jalan
[ ] Test REST validation error shape stabil
[ ] Test JPA lifecycle validation jalan
```

---

## 11. Migration untuk Custom Constraint Library

Banyak enterprise punya shared library:

```text
company-validation-common
company-domain-constraints
case-reference-validator
postal-code-validator
```

Migrasi library seperti ini harus diperlakukan sebagai breaking change.

### 11.1 Jangan publish artifact yang sama dengan namespace berubah diam-diam

Buruk:

```text
company-validation-common:1.4.2
- sebelumnya javax
- sekarang jakarta
```

Client lama bisa rusak tanpa major version.

Lebih baik:

```text
company-validation-common-javax:1.x
company-validation-common-jakarta:2.x
```

Atau:

```text
company-validation-common:1.x  -> javax
company-validation-common:2.x  -> jakarta
```

### 11.2 Dual publishing strategy

Untuk organisasi besar, mungkin perlu dua branch:

```text
main-javax       -> Java 8/11, Boot 2, HV 6
main-jakarta     -> Java 17+, Boot 3, HV 8/9
```

Jangan buat library yang mencoba mendukung dua namespace sekaligus dalam satu annotation class. Itu sering menghasilkan complexity tinggi dan behavior tidak jelas.

### 11.3 Package naming

Jangan taruh constraint di package yang misleading:

```text
com.company.javax.validation   // buruk untuk versi jakarta
```

Pakai domain package:

```text
com.company.validation.constraint
com.company.casevalidation.constraint
```

---

## 12. Generated Code Migration

Generated DTO sering menjadi blocker besar.

Sumber generated code:

- OpenAPI Generator,
- Swagger Codegen,
- JAXB/XJC,
- GraphQL codegen,
- gRPC/protobuf wrappers,
- internal schema generator,
- legacy SOAP client,
- MapStruct generated mapper.

### 12.1 OpenAPI Generator

Cek generator config apakah menghasilkan:

```java
import javax.validation.Valid;
import javax.validation.constraints.*;
```

atau:

```java
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
```

Banyak generator punya option seperti `useJakartaEe`, `useBeanValidation`, atau library-specific config. Nama option tergantung generator/version, jadi cek dokumentasi tool yang digunakan.

### 12.2 Jangan patch generated code manual

Buruk:

```text
Generate DTO -> manual replace javax to jakarta -> commit hasil generate
```

Lebih baik:

```text
Fix generator config -> regenerate -> commit deterministic generated output
```

### 12.3 Contract test untuk generated DTO

Buat test kecil:

```java
class GeneratedDtoValidationTest {

    private final Validator validator = Validation.buildDefaultValidatorFactory().getValidator();

    @Test
    void generatedDtoShouldUseJakartaValidationAnnotations() {
        var request = new GeneratedCreateCaseRequest();
        request.setName(null);

        var violations = validator.validate(request);

        assertThat(violations)
                .extracting(ConstraintViolation::getPropertyPath)
                .anyMatch(path -> path.toString().equals("name"));
    }
}
```

Tujuannya bukan menguji seluruh generator, tetapi membuktikan annotation recognized oleh runtime provider.

---

## 13. XML Configuration Migration

Jika aplikasi memakai `validation.xml`, cek file seperti:

```text
src/main/resources/META-INF/validation.xml
```

Area yang perlu dicek:

- schema namespace,
- provider class,
- message interpolator class,
- traversable resolver,
- constraint validator factory,
- parameter name provider,
- clock provider,
- value extractor,
- constraint mapping file.

Jika class custom masih import `javax.validation.*`, migration belum selesai.

Contoh konseptual modern:

```xml
<validation-config
        xmlns="https://jakarta.ee/xml/ns/validation/configuration"
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xsi:schemaLocation="https://jakarta.ee/xml/ns/validation/configuration
                            https://jakarta.ee/xml/ns/validation/validation-configuration-3.0.xsd"
        version="3.0">

    <default-provider>org.hibernate.validator.HibernateValidator</default-provider>
</validation-config>
```

Catatan:

- Gunakan schema/version yang sesuai dengan target runtime.
- Banyak aplikasi Spring tidak perlu `validation.xml`; auto-configuration cukup.
- Jangan mempertahankan XML lama hanya karena “dulu ada”.

---

## 14. Message Bundle Migration

File seperti ini biasanya tetap:

```text
ValidationMessages.properties
ValidationMessages_id.properties
ValidationMessages_en.properties
```

Tetapi cek isi message:

```properties
javax.validation.constraints.NotNull.message=must not be null
jakarta.validation.constraints.NotNull.message=must not be null
```

Jika aplikasi override default message berdasarkan fully qualified constraint name, namespace berubah akan memengaruhi lookup key.

Lebih aman untuk constraint internal:

```java
@NotBlank(message = "{case.name.required}")
private String caseName;
```

Bundle:

```properties
case.name.required=Case name is required.
```

Jangan terlalu bergantung pada default provider message untuk public API contract.

---

## 15. API Error Contract Regression

Migration tidak boleh mengubah API error shape tanpa sengaja.

### 15.1 Before/after snapshot

Sebelum migrasi, simpan snapshot respons error untuk endpoint utama.

Contoh:

```http
POST /api/cases
Content-Type: application/json

{}
```

Expected legacy response:

```json
{
  "code": "VALIDATION_FAILED",
  "message": "Request validation failed.",
  "violations": [
    {
      "path": "applicant.name",
      "code": "NotBlank",
      "message": "Applicant name is required."
    }
  ]
}
```

Setelah migrasi, minimal harus dijaga:

```text
same status code
same envelope shape
same path normalization
same stable error code
same localization behavior jika public contract bergantung padanya
```

### 15.2 Jangan expose class name provider

Jika error code memakai class FQCN:

```json
{
  "constraint": "javax.validation.constraints.NotBlank"
}
```

Maka migrasi akan mengubah output menjadi:

```json
{
  "constraint": "jakarta.validation.constraints.NotBlank"
}
```

Ini breaking change untuk client yang parsing value tersebut.

Lebih baik:

```json
{
  "code": "REQUIRED_TEXT",
  "constraint": "NotBlank"
}
```

Atau:

```json
{
  "code": "CASE_APPLICANT_NAME_REQUIRED"
}
```

---

## 16. JPA/Persistence Migration Interlock

Validation migration sering bersamaan dengan JPA migration:

```text
javax.persistence.* -> jakarta.persistence.*
Hibernate ORM 5.x   -> Hibernate ORM 6.x/7.x
```

Jebakan:

- entity validation listener berubah versi,
- flush-time behavior perlu dites ulang,
- generated schema berubah,
- DDL validation berbeda,
- lazy association behavior muncul di test,
- criteria API migration bisa menghabiskan effort terpisah.

### 16.1 Jangan validasi entity graph besar tanpa sengaja

Sebelum migration:

```java
@OneToMany(mappedBy = "case")
@Valid
private List<CaseDocument> documents;
```

Setelah provider/framework berubah, behavior traversal/performance bisa lebih terlihat karena test coverage bertambah atau flush timing berubah.

Review semua `@Valid` pada JPA relationship.

### 16.2 DB constraint tetap authority terakhir

Migrasi validation bukan alasan menghapus:

- `NOT NULL`,
- `UNIQUE`,
- `CHECK`,
- FK,
- optimistic locking.

Bean Validation memberi early feedback, bukan final concurrency guarantee.

---

## 17. Method Validation Regression

Method validation sering tidak dites cukup.

### 17.1 Service method validation

```java
@Service
@Validated
public class CaseAssignmentService {

    public AssignmentId assign(
            @NotNull CaseId caseId,
            @NotNull OfficerId officerId) {
        ...
    }
}
```

Test:

```java
@SpringBootTest
class CaseAssignmentServiceValidationIT {

    @Autowired
    private CaseAssignmentService service;

    @Test
    void shouldRejectNullCaseId() {
        assertThatThrownBy(() -> service.assign(null, new OfficerId("O001")))
                .isInstanceOf(ConstraintViolationException.class);
    }
}
```

Import exception:

```java
import jakarta.validation.ConstraintViolationException;
```

### 17.2 Self-invocation tetap tidak jalan

```java
@Service
@Validated
public class CaseService {

    public void outer() {
        inner(null); // bypass proxy
    }

    public void inner(@NotNull String value) {
        ...
    }
}
```

Migration tidak memperbaiki problem ini. Jika test lama tidak menangkapnya, migration bisa menjadi momen untuk memperjelas boundary.

### 17.3 Parameter name

Jika error response perlu nama parameter, compile dengan:

```bash
javac -parameters
```

Gradle:

```gradle
tasks.withType(JavaCompile).configureEach {
    options.compilerArgs += ["-parameters"]
}
```

Maven:

```xml
<plugin>
    <groupId>org.apache.maven.plugins</groupId>
    <artifactId>maven-compiler-plugin</artifactId>
    <configuration>
        <parameters>true</parameters>
    </configuration>
</plugin>
```

---

## 18. Records, Java 17, dan Java 25 Context

Saat naik ke Spring Boot 3/HV 8/9, tim biasanya juga mulai memakai Java 17/21/25 features.

Jangan gabungkan migration namespace dengan wholesale model rewrite ke records dalam satu PR besar.

### 18.1 Safe staged approach

```text
PR 1: upgrade build Java baseline
PR 2: migrate dependencies/framework
PR 3: javax -> jakarta mechanical migration
PR 4: behavior regression test fixes
PR 5+: optional modernization to records/sealed/value objects
```

### 18.2 Record validation

Jakarta Validation 3.1 mengklarifikasi dukungan Java Records. Ini penting untuk stack HV 9/Jakarta EE 11, tetapi bukan berarti semua DTO harus langsung jadi record.

Pertimbangkan:

- JSON deserialization support,
- default constructor need,
- generated OpenAPI compatibility,
- builder usage,
- patch model,
- field-level vs component-level annotation,
- API backward compatibility.

---

## 19. AOT / Native Image / Reflection Considerations

Di stack modern, terutama Spring AOT/GraalVM/Quarkus, validation bisa membutuhkan reflection metadata.

Area rawan:

- custom constraints,
- annotation introspection,
- record components,
- method validation,
- message interpolation,
- EL,
- generated DTO,
- proxies.

Checklist:

```text
[ ] Native image test menjalankan validation path
[ ] Custom validators reachable
[ ] DTO constraints terbaca
[ ] Method validation proxy bekerja
[ ] Message interpolation tidak gagal
[ ] Resource bundle masuk image
[ ] validation.xml/mapping XML masuk resources jika dipakai
```

Jangan menganggap sukses JVM mode berarti sukses native mode.

---

## 20. Build and CI Guardrails

### 20.1 Ban wrong namespace

Untuk aplikasi Jakarta modern, tambahkan CI guard:

```bash
if rg "javax\.validation" src/main src/test; then
  echo "ERROR: javax.validation is forbidden in Jakarta-based application"
  exit 1
fi
```

Untuk aplikasi legacy yang belum migrasi, sebaliknya:

```bash
if rg "jakarta\.validation" src/main src/test; then
  echo "ERROR: jakarta.validation not allowed in legacy javax-based application"
  exit 1
fi
```

### 20.2 Dependency convergence

Maven Enforcer:

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
                    <bannedDependencies>
                        <excludes>
                            <exclude>javax.validation:validation-api</exclude>
                        </excludes>
                    </bannedDependencies>
                </rules>
            </configuration>
        </execution>
    </executions>
</plugin>
```

Gunakan hanya setelah aplikasi memang sudah pindah ke Jakarta.

### 20.3 Gradle dependency insight

```bash
./gradlew dependencyInsight --dependency validation-api --configuration runtimeClasspath
./gradlew dependencyInsight --dependency hibernate-validator --configuration runtimeClasspath
```

---

## 21. Migration Test Matrix

Minimal test matrix:

| Area | Test |
|---|---|
| DTO body validation | invalid JSON body produces expected violations |
| Query/path/header | invalid primitive/request params rejected |
| Custom constraint | valid/invalid/null/boundary cases |
| Class-level validation | cross-field errors and paths |
| Container element | list/map/optional element paths |
| Groups | create/update/submit groups still correct |
| Group sequence | later expensive group not run if early group fails |
| Method validation | service/controller method constraints fire |
| JPA lifecycle | invalid entity rejected or DB constraint mapped correctly |
| Message interpolation | message keys and locale still correct |
| API contract | response shape/status/path/error code stable |
| Generated DTO | generated validation annotations recognized |
| Dependency graph | no wrong namespace API runtime |
| Native/AOT if applicable | validation works in target packaging |

---

## 22. Contract Regression Harness

Untuk sistem besar, buat harness kecil yang membandingkan behavior before/after.

### 22.1 Rule sample catalog

```java
record ValidationScenario<T>(
        String id,
        T payload,
        Class<?>[] groups,
        Set<String> expectedPaths,
        Set<String> expectedCodes
) {}
```

### 22.2 Test runner

```java
final class ValidationScenarioRunner {

    private final Validator validator;

    ValidationScenarioRunner(Validator validator) {
        this.validator = validator;
    }

    <T> void assertScenario(ValidationScenario<T> scenario) {
        Set<ConstraintViolation<T>> violations = validator.validate(
                scenario.payload(),
                scenario.groups()
        );

        Set<String> paths = violations.stream()
                .map(v -> v.getPropertyPath().toString())
                .collect(Collectors.toCollection(TreeSet::new));

        assertThat(paths).containsExactlyInAnyOrderElementsOf(scenario.expectedPaths());
    }
}
```

### 22.3 Golden file

Untuk API response, golden file bisa dipakai:

```text
src/test/resources/validation-golden/create-case-missing-name.json
src/test/resources/validation-golden/submit-case-invalid-date-range.json
src/test/resources/validation-golden/update-case-invalid-email.json
```

Tujuan:

- mendeteksi path berubah,
- mendeteksi code berubah,
- mendeteksi envelope berubah,
- mendeteksi message key hilang.

---

## 23. Rollout Strategy untuk Enterprise Codebase

### 23.1 Jangan big bang jika modul banyak

Jika sistem punya banyak module, lakukan staged rollout.

Contoh:

```text
Wave 0: build foundation
- Java baseline
- parent pom/BOM
- dependency convergence
- shared validation library jakarta version

Wave 1: low-risk modules
- common DTO
- internal admin APIs
- modules with strong tests

Wave 2: public APIs
- consumer-facing endpoints
- OpenAPI generated clients
- frontend contract

Wave 3: persistence-heavy modules
- JPA entities
- batch jobs
- data migration flows

Wave 4: workflow-critical modules
- approval
- compliance
- enforcement
- appeal
```

### 23.2 Branching strategy

Untuk codebase aktif:

```text
main          -> legacy stable
migration/*   -> namespace/framework migration
feature/*     -> freeze or rebase policy
```

Jika migrasi panjang, risiko merge conflict tinggi karena import berubah di banyak file.

Mitigasi:

- tetapkan freeze window untuk DTO/constraint-heavy module,
- merge mechanical rewrite cepat,
- hindari refactor semantik bersamaan,
- informasikan pattern import baru ke tim.

### 23.3 Deployment strategy

Jika service berkomunikasi via API/event, migration internal tidak harus breaking. Tetapi jika shared DTO/library dipakai client lain, ini breaking.

Rules:

```text
Internal service code migration: can be transparent if API contract stable
Shared library migration: major version
Generated client migration: coordinate clients
Event schema migration: compatibility policy required
```

---

## 24. Common Anti-Patterns

### Anti-pattern 1 — Menganggap semua `javax` bisa replace global ke `jakarta`

Tidak semua `javax.*` punya replacement langsung yang sama behavior-nya. Validation relatif straightforward, tetapi ecosystem luas tidak selalu begitu.

### Anti-pattern 2 — Menyisakan `javax.validation-api` agar compile cepat

Ini menyembunyikan masalah. Aplikasi modern harus fail fast jika import lama masih ada.

### Anti-pattern 3 — Mengubah rule sambil migration namespace

Contoh:

```text
@NotNull -> @NotBlank
change groups
change DTO hierarchy
change error response
migrate Spring Boot
```

Semua dalam satu PR. Ini membuat regression analysis hampir mustahil.

### Anti-pattern 4 — Tidak test invalid path

Banyak tim hanya test happy path setelah migration. Validation migration justru harus banyak test invalid path.

### Anti-pattern 5 — Shared library tanpa major version

Mengganti namespace dalam artifact yang sama adalah breaking change tersembunyi.

### Anti-pattern 6 — Error code bergantung pada FQCN annotation

`javax.validation.constraints.NotNull` berubah menjadi `jakarta.validation.constraints.NotNull`. Jika itu public contract, client bisa rusak.

### Anti-pattern 7 — Mengandalkan IDE auto-import

IDE bisa memilih import salah jika dua API ada di classpath.

---

## 25. Migration Checklist Lengkap

### 25.1 Planning

```text
[ ] Tentukan target stack: Java, Spring Boot/Jakarta EE, HV version
[ ] Tentukan apakah target Jakarta Validation 3.0 atau 3.1
[ ] Identifikasi aplikasi/library/client yang terkena dampak
[ ] Tentukan migration waves
[ ] Tentukan freeze/merge policy
[ ] Tentukan API compatibility expectation
```

### 25.2 Dependency

```text
[ ] Gunakan BOM/platform resmi framework
[ ] Hapus javax.validation-api dari Jakarta app
[ ] Pastikan hanya satu major validation API aktif
[ ] Pastikan Hibernate Validator version sesuai target
[ ] Pastikan Expression Language implementation tersedia jika perlu
[ ] Jalankan dependency tree/insight
```

### 25.3 Source

```text
[ ] Ganti javax.validation imports ke jakarta.validation
[ ] Ganti custom constraint annotation imports
[ ] Ganti ConstraintValidator imports
[ ] Ganti metadata API imports
[ ] Ganti executable validation imports
[ ] Ganti test imports
[ ] Cek generated source
[ ] Cek XML mapping/config
[ ] Cek docs/code snippets internal
```

### 25.4 Framework integration

```text
[ ] REST body validation works
[ ] query/path/header validation works
[ ] method validation works
[ ] return value validation works if used
[ ] JPA lifecycle validation works if enabled
[ ] custom ConstraintValidatorFactory works
[ ] custom MessageInterpolator works
[ ] custom ParameterNameProvider works
[ ] custom ClockProvider works
[ ] custom ValueExtractor works
```

### 25.5 Contract

```text
[ ] HTTP status stable
[ ] API error envelope stable
[ ] violation path stable or intentionally versioned
[ ] error code stable
[ ] message key stable
[ ] locale behavior stable
[ ] rejected value redaction stable
[ ] no FQCN namespace leak in public contract
```

### 25.6 Operations

```text
[ ] CI bans wrong namespace
[ ] dependency convergence enforced
[ ] validation failure metrics monitored
[ ] logs PII-safe
[ ] rollback plan exists
[ ] dashboards compare pre/post migration rejection rate
[ ] support team knows expected changes
```

---

## 26. Practical Migration Example

### 26.1 Legacy DTO

```java
package com.example.caseapp.api;

import javax.validation.Valid;
import javax.validation.constraints.NotBlank;
import javax.validation.constraints.NotNull;
import javax.validation.constraints.Size;
import java.util.List;

public class CreateCaseRequest {

    @NotBlank(message = "{case.title.required}")
    @Size(max = 200, message = "{case.title.tooLong}")
    private String title;

    @NotNull(message = "{case.applicant.required}")
    @Valid
    private ApplicantDto applicant;

    @Valid
    private List<DocumentDto> documents;

    // getters/setters
}
```

### 26.2 Migrated DTO

```java
package com.example.caseapp.api;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

public class CreateCaseRequest {

    @NotBlank(message = "{case.title.required}")
    @Size(max = 200, message = "{case.title.tooLong}")
    private String title;

    @NotNull(message = "{case.applicant.required}")
    @Valid
    private ApplicantDto applicant;

    private List<@Valid DocumentDto> documents;

    // getters/setters
}
```

Catatan:

- Perubahan `@Valid` pada list ke `List<@Valid DocumentDto>` adalah improvement opsional.
- Untuk behavior-preserving PR, bisa pertahankan bentuk lama terlebih dahulu jika provider masih mendukung.
- Improvement container element bisa dilakukan setelah regression baseline stabil.

### 26.3 Controller

```java
@RestController
@RequestMapping("/api/cases")
public class CaseController {

    private final CaseApplicationService service;

    public CaseController(CaseApplicationService service) {
        this.service = service;
    }

    @PostMapping
    public ResponseEntity<CreateCaseResponse> create(
            @Valid @RequestBody CreateCaseRequest request) {
        CaseId caseId = service.create(request.toCommand());
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(new CreateCaseResponse(caseId.value()));
    }
}
```

Import:

```java
import jakarta.validation.Valid;
```

### 26.4 Regression test

```java
@WebMvcTest(CaseController.class)
class CaseControllerValidationTest {

    @Autowired
    private MockMvc mvc;

    @Test
    void createShouldRejectMissingTitle() throws Exception {
        mvc.perform(post("/api/cases")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "applicant": {
                                    "name": "Alice"
                                  }
                                }
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.violations[?(@.path == 'title')]").exists());
    }
}
```

---

## 27. Migration Decision Tree

```text
Are you staying on Java 8/11 and Spring Boot 2?
    -> Stay on javax.validation / HV 6.
    -> Do not import jakarta.validation accidentally.

Are you moving to Spring Boot 3?
    -> Java 17+ required.
    -> Migrate to jakarta.validation.
    -> Use Boot-managed Hibernate Validator.
    -> Remove javax.validation-api.

Are you moving to Jakarta EE 11 / HV 9?
    -> Java 17+ required.
    -> Jakarta Validation 3.1.
    -> Check EL 6.0 implementation.
    -> Check records/method validation behavior.

Do you own shared validation libraries?
    -> Publish Jakarta major version.
    -> Do not silently replace javax in same artifact line.

Do generated DTOs still emit javax?
    -> Fix generator config.
    -> Do not patch generated source manually.

Do external libraries still expose javax annotated DTOs?
    -> Upgrade library or create adapter.
    -> Add contract test proving validation fires.
```

---

## 28. Top-Tier Engineering Perspective

Engineer biasa melihat migration seperti ini:

```text
replace javax with jakarta
fix compile
run app
```

Engineer senior melihat:

```text
runtime compatibility
framework auto-configuration
dependency convergence
annotation recognition
error contract stability
method validation proxy behavior
generated source
custom validator lifecycle
JPA flush-time validation
message interpolation
client compatibility
observability after rollout
```

Tech lead/top-tier engineer melihat satu level lebih jauh:

```text
Is validation still a trustworthy system boundary after migration?
Can we prove invalid input is rejected consistently?
Can clients rely on stable machine-readable errors?
Can support/audit explain rejected submissions?
Can we prevent namespace regression in CI?
Can we migrate shared libraries without breaking teams?
Can we roll out in waves with measurable risk?
```

Migrasi validation yang baik bukan hanya compile clean, tetapi **contract-preserving, observable, reversible, and governed**.

---

## 29. Final Summary

Poin inti bagian ini:

1. Migrasi `javax.validation` ke `jakarta.validation` adalah perpindahan ecosystem, bukan rename kecil.
2. Jangan campur `javax.validation` dan `jakarta.validation` dalam satu validation runtime.
3. Spring Boot 3 berarti Java 17+ dan Jakarta namespace.
4. Hibernate Validator 6 cocok untuk `javax`; HV 8/9 untuk `jakarta`.
5. HV 9 menargetkan Jakarta Validation 3.1/Jakarta EE 11 dan membutuhkan Java 17+.
6. Automated rewrite membantu, tetapi tidak menggantikan regression testing.
7. Generated code dan shared libraries sering menjadi sumber masalah terbesar.
8. Public API error contract harus dijaga agar tidak bocor FQCN namespace.
9. Method validation, JPA lifecycle validation, message interpolation, dan custom validators perlu dites eksplisit.
10. CI harus mencegah namespace lama masuk kembali setelah migrasi.

---

## 30. Referensi Resmi dan Lanjutan

- Jakarta Validation 3.1 specification page:  
  <https://jakarta.ee/specifications/bean-validation/3.1/>

- Jakarta Validation 3.1 specification document:  
  <https://jakarta.ee/specifications/bean-validation/3.1/jakarta-validation-spec-3.1.html>

- Bean Validation / Jakarta Validation official site:  
  <https://beanvalidation.org/>

- Bean Validation 2.0 specification:  
  <https://beanvalidation.org/2.0/spec/>

- Jakarta Validation 3.1 announcement:  
  <https://beanvalidation.org/news/2025/02/17/bean-validation-3-1/>

- Hibernate Validator releases:  
  <https://hibernate.org/validator/releases/>

- Hibernate Validator reference guide:  
  <https://docs.jboss.org/hibernate/stable/validator/reference/en-US/html_single/>

- Hibernate Validator migration guide:  
  <https://hibernate.org/validator/documentation/migration-guide/>

- Hibernate Validator 9.0.0.Final announcement:  
  <https://in.relation.to/2025/05/20/hibernate-validator-9-0-0-Final/>

- Spring Boot 3.0 migration guide:  
  <https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-3.0-Migration-Guide>

- Spring Framework 7.0 release notes:  
  <https://github.com/spring-projects/spring-framework/wiki/Spring-Framework-7.0-Release-Notes>

- OpenRewrite recipe: migrate `javax.validation` to `jakarta.validation`:  
  <https://docs.openrewrite.org/recipes/java/migrate/jakarta/javaxvalidationmigrationtojakartavalidation>

---

# Status Seri

Seri **belum selesai**.

Bagian yang baru selesai:

```text
learn-java-validation-jakarta-hibernate-validator-part-027.md
```

Bagian berikutnya:

```text
learn-java-validation-jakarta-hibernate-validator-part-028.md
Architecture Patterns: Validation Layering in Large Systems
```
