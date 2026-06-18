# learn-java-oop-functional-reflection-codegen-modules-part-021.md

# Part 021 — Annotation Design: Metadata, Retention, Targets, Repeatable, Inheritance

> Seri: **Java OOP, Functional, Reflection, Code Generation, Modules & Package Management**  
> Fokus bagian ini: memahami annotation bukan sebagai dekorasi syntax, tetapi sebagai **metadata contract** yang memengaruhi compiler, framework, runtime, generated code, API compatibility, dan arsitektur modul.

---

## 0. Posisi Part Ini Dalam Seri

Kita sudah membahas:

- object model
- encapsulation
- inheritance
- interface
- sealed hierarchy
- record
- enum
- nested classes
- generics
- polymorphism
- composition
- functional Java
- lambda
- functional interface
- error/null/result modeling
- reflection metadata
- dynamic invocation/proxy
- method handles/var handles

Sekarang kita masuk ke **annotation design**.

Annotation terlihat sederhana:

```java
@Validated
@Transactional
@Deprecated
@Override
@MyCustomRule("CASE_ESCALATION")
public void process() {}
```

Tetapi secara desain, annotation adalah salah satu fitur Java yang paling sering disalahgunakan karena ia berada di persimpangan antara:

1. **source code readability**
2. **compile-time validation**
3. **runtime reflection**
4. **framework behavior**
5. **generated code**
6. **module encapsulation**
7. **API compatibility**

Annotation bukan logic. Annotation adalah **metadata**. Metadata bisa dipakai oleh compiler, annotation processor, runtime framework, documentation tool, static analyzer, atau code generator. Karena itu, desain annotation yang buruk sering menghasilkan sistem yang terlihat elegan di source code tetapi sulit dipahami, sulit diuji, sulit dimigrasi, dan sulit didiagnosis saat runtime.

---

## 1. Mental Model Utama: Annotation Adalah Metadata, Bukan Behavior

Annotation tidak melakukan sesuatu sendiri.

Contoh:

```java
@RequiresSupervisorApproval
public void approve(CaseId caseId) {
    // business logic
}
```

Annotation ini **tidak otomatis memaksa supervisor approval**. Ia hanya menempelkan metadata ke program element. Supaya behavior terjadi, harus ada consumer:

- compiler
- annotation processor
- reflection scanner
- framework interceptor
- AOP proxy
- generated code
- static analyzer
- documentation tool
- test engine

Jadi model mentalnya:

```text
annotation declaration
        ↓
annotation usage in source code
        ↓
retention policy decides where metadata survives
        ↓
consumer reads metadata
        ↓
consumer applies meaning
```

Tanpa consumer, annotation hanyalah informasi yang tidak digunakan.

---

## 2. Annotation Sebagai Contract

Annotation yang baik harus menjawab pertanyaan berikut:

1. **Siapa consumer-nya?**
   - compiler?
   - annotation processor?
   - runtime reflection?
   - framework?
   - javadoc?
   - static analyzer?

2. **Kapan dibaca?**
   - source only?
   - compile time?
   - class loading?
   - application startup?
   - every request?
   - test execution?

3. **Apa maknanya?**
   - marker?
   - configuration?
   - capability?
   - constraint?
   - documentation?
   - generation instruction?
   - runtime routing?

4. **Apa failure mode-nya?**
   - compile error?
   - generated warning?
   - startup failure?
   - runtime exception?
   - ignored silently?

5. **Apa compatibility rule-nya?**
   - boleh tambah member?
   - boleh ubah default?
   - boleh ubah retention?
   - boleh ubah target?
   - boleh membuat repeatable?

Tanpa jawaban ini, annotation biasanya berubah menjadi hidden control flow.

---

## 3. Bentuk Dasar Annotation Type

Annotation dideklarasikan dengan `@interface`.

```java
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.TYPE)
public @interface CaseModule {
    String value();
}
```

Pemakaian:

```java
@CaseModule("ENFORCEMENT")
public final class EnforcementCaseService {
}
```

Secara konsep, annotation type mirip interface khusus. Namun method di dalam annotation type disebut **annotation elements**.

```java
public @interface RetryableOperation {
    int maxAttempts() default 3;
    long backoffMillis() default 250;
    Class<? extends Throwable>[] retryOn() default { RuntimeException.class };
}
```

Pemakaian:

```java
@RetryableOperation(
    maxAttempts = 5,
    backoffMillis = 500,
    retryOn = { TimeoutException.class, TransientDatabaseException.class }
)
public void synchronizeCase(CaseId id) {
}
```

---

## 4. Annotation Element Type Yang Diizinkan

Annotation element tidak bisa memakai sembarang type.

Umumnya annotation element boleh berupa:

- primitive
- `String`
- `Class` atau `Class<?>`
- enum
- annotation lain
- array dari tipe-tipe di atas

Contoh valid:

```java
public @interface AuditEvent {
    String code();
    int severity() default 1;
    Class<?> payloadType() default Void.class;
    AuditCategory category();
    Tag[] tags() default {};
}

public enum AuditCategory {
    CASE,
    APPLICATION,
    LOGIN
}

public @interface Tag {
    String name();
}
```

Contoh tidak valid:

```java
public @interface InvalidAnnotation {
    List<String> names();        // tidak valid
    Optional<String> value();    // tidak valid
    Map<String, String> map();   // tidak valid
    Object config();             // tidak valid
}
```

Kenapa Java membatasi element type? Karena annotation harus bisa direpresentasikan secara stabil dalam metadata class file dan dibaca oleh compiler/tool/runtime secara terstruktur.

---

## 5. Marker Annotation

Marker annotation tidak memiliki element.

```java
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.TYPE)
public @interface InternalApi {
}
```

Pemakaian:

```java
@InternalApi
public final class CaseStatusNormalizer {
}
```

Marker annotation cocok jika metadata hanya menyatakan **presence/absence**.

Contoh yang masuk akal:

```java
@Experimental
@InternalApi
@GeneratedAdapter
@DoNotProxy
@ThreadSafe
```

Tetapi marker annotation bisa berbahaya jika maknanya tidak jelas.

```java
@Managed
public class Something {
}
```

Managed oleh siapa?

- DI container?
- persistence framework?
- lifecycle manager?
- workflow engine?

Annotation seperti ini terlalu ambigu.

Prinsip desain:

> Marker annotation harus memiliki satu makna yang sempit dan consumer yang jelas.

---

## 6. Single-Value Annotation dan Nama `value`

Jika annotation hanya punya satu element penting, gunakan nama `value` agar pemakaian lebih ringkas.

```java
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.TYPE)
public @interface ModuleName {
    String value();
}
```

Pemakaian:

```java
@ModuleName("case-management")
public final class CaseManagementModule {
}
```

Tanpa `value`, pemakaian menjadi lebih verbose:

```java
public @interface ModuleName {
    String name();
}

@ModuleName(name = "case-management")
public final class CaseManagementModule {
}
```

Kapan `value` cocok?

- annotation benar-benar punya satu parameter utama
- parameter tersebut jelas dari nama annotation
- tidak ada kemungkinan banyak parameter setara di masa depan

Contoh baik:

```java
@Permission("case.approve")
@FeatureFlag("new-escalation-policy")
@Topic("case-events")
```

Contoh kurang baik:

```java
@Rule("HIGH")
```

Apa `HIGH` itu?

- severity?
- priority?
- role?
- threshold?

Lebih baik:

```java
@Rule(severity = Severity.HIGH)
```

---

## 7. Configuration Annotation

Configuration annotation memiliki beberapa element.

```java
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
public @interface EscalationRule {
    String code();
    int priority() default 100;
    boolean enabled() default true;
    EscalationPhase phase();
}
```

Pemakaian:

```java
@EscalationRule(
    code = "CASE_OVERDUE",
    priority = 10,
    phase = EscalationPhase.POST_DEADLINE
)
public EscalationDecision decide(CaseSnapshot snapshot) {
    return ...;
}
```

Configuration annotation cocok ketika:

- konfigurasinya statis
- value dapat diketahui saat compile time
- metadata dekat dengan code yang diberi makna
- consumer bisa memvalidasi konfigurasi secara deterministik

Configuration annotation buruk ketika:

- value sering berubah di production
- value harus diambil dari database
- value environment-specific
- value butuh conditional logic kompleks
- value menjadi mini-program di dalam annotation

Contoh buruk:

```java
@EscalationRule(
    expression = "case.age > 30 && user.role == 'SUPERVISOR' && env.region == 'SG'"
)
```

Ini menciptakan DSL string yang sulit divalidasi, sulit di-refactor, dan rawan runtime failure.

Lebih baik:

```java
public interface EscalationPolicy {
    EscalationDecision decide(CaseSnapshot snapshot, EvaluationContext context);
}
```

Annotation boleh dipakai untuk registration metadata, bukan untuk seluruh logic:

```java
@EscalationPolicyCode("CASE_OVERDUE")
public final class CaseOverduePolicy implements EscalationPolicy {
    ...
}
```

---

## 8. Meta-Annotation

Meta-annotation adalah annotation yang diterapkan pada annotation type lain.

Contoh built-in meta-annotation penting:

```java
@Retention(...)
@Target(...)
@Documented
@Inherited
@Repeatable(...)
```

Contoh custom composed annotation:

```java
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.TYPE)
@InternalApi
@GeneratedAdapter
public @interface InternalGeneratedAdapter {
}
```

Tetapi perlu hati-hati: Java reflection standar tidak otomatis memperlakukan custom annotation composition seperti banyak framework lakukan. Misalnya, jika `@A` diberi `@B`, lalu class memakai `@A`, maka mencari `@B` langsung pada class tidak selalu menghasilkan apa yang diharapkan kecuali consumer memang melakukan meta-annotation scanning.

Contoh:

```java
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.ANNOTATION_TYPE)
public @interface RuntimeRule {
}

@RuntimeRule
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.TYPE)
public @interface CaseRule {
}

@CaseRule
public final class OverdueRule {
}
```

Consumer perlu eksplisit:

```java
boolean hasRuntimeRule(Class<?> type) {
    for (Annotation annotation : type.getAnnotations()) {
        Class<? extends Annotation> annotationType = annotation.annotationType();
        if (annotationType.isAnnotationPresent(RuntimeRule.class)) {
            return true;
        }
    }
    return false;
}
```

Jangan mengasumsikan semua framework punya semantics meta-annotation yang sama.

---

## 9. `@Retention`: Di Mana Annotation Bertahan?

`@Retention` menentukan berapa lama annotation dipertahankan.

```java
public enum RetentionPolicy {
    SOURCE,
    CLASS,
    RUNTIME
}
```

### 9.1 `RetentionPolicy.SOURCE`

Annotation hanya ada di source code. Ia tidak perlu masuk class file.

Cocok untuk:

- compiler/static analyzer signal
- documentation source-level
- suppression/warning
- annotation processor yang hanya butuh source model

Contoh:

```java
@Retention(RetentionPolicy.SOURCE)
@Target(ElementType.METHOD)
public @interface ReviewedForSecurity {
    String ticket();
}
```

Jika runtime reflection mencoba membaca annotation ini, hasilnya tidak ada.

### 9.2 `RetentionPolicy.CLASS`

Annotation masuk class file, tetapi tidak tersedia untuk reflection runtime biasa.

Ini default jika `@Retention` tidak ditulis.

Cocok untuk:

- bytecode tool
- build-time scanner
- post-compile processing
- static analysis berbasis class file

Contoh:

```java
@Retention(RetentionPolicy.CLASS)
@Target(ElementType.TYPE)
public @interface GeneratedByMapperProcessor {
    String generator();
}
```

### 9.3 `RetentionPolicy.RUNTIME`

Annotation disimpan di class file dan tersedia melalui reflection runtime.

Cocok untuk:

- runtime framework
- DI scanner
- validation runtime
- routing runtime
- test framework
- plugin registry

Contoh:

```java
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.TYPE)
public @interface RuntimeHandler {
    String value();
}
```

### 9.4 Kesalahan Umum Retention

#### Salah 1: Lupa retention sehingga default ke CLASS

```java
@Target(ElementType.TYPE)
public @interface RuntimeComponent {
}
```

Framework runtime mencari annotation ini:

```java
type.isAnnotationPresent(RuntimeComponent.class) // false
```

Kenapa? Karena annotation tidak `RUNTIME`.

#### Salah 2: Semua annotation dibuat RUNTIME

Tidak semua annotation perlu runtime visibility. Runtime retention meningkatkan coupling ke reflection consumer dan dapat memperlebar metadata surface.

#### Salah 3: Mengubah retention setelah API dipakai

Mengubah retention adalah breaking behavior bagi consumer.

- `SOURCE` → `RUNTIME`: consumer baru mungkin mulai melihat metadata yang sebelumnya tidak ada.
- `RUNTIME` → `CLASS`: runtime framework tiba-tiba tidak menemukan annotation.
- `CLASS` → `SOURCE`: bytecode tool bisa kehilangan metadata.

Prinsip:

> Tentukan consumer annotation sebelum menentukan retention.

---

## 10. `@Target`: Annotation Boleh Dipasang Di Mana?

`@Target` membatasi lokasi pemakaian annotation.

Contoh:

```java
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
public @interface AuditedOperation {
}
```

Annotation ini hanya boleh dipasang pada method.

`ElementType` penting antara lain:

```java
TYPE
FIELD
METHOD
PARAMETER
CONSTRUCTOR
LOCAL_VARIABLE
ANNOTATION_TYPE
PACKAGE
TYPE_PARAMETER
TYPE_USE
MODULE
RECORD_COMPONENT
```

### 10.1 `TYPE`

Untuk class, interface, enum, record, annotation type.

```java
@Target(ElementType.TYPE)
public @interface ApplicationService {
}
```

### 10.2 `METHOD`

Untuk method behavior/contract.

```java
@Target(ElementType.METHOD)
public @interface IdempotentOperation {
}
```

### 10.3 `FIELD`

Untuk field metadata.

```java
@Target(ElementType.FIELD)
public @interface EncryptedAtRest {
}
```

Hati-hati: field annotation sering coupling ke reflection/serialization/persistence.

### 10.4 `PARAMETER`

Untuk method/constructor parameter.

```java
@Target(ElementType.PARAMETER)
public @interface CurrentUser {
}
```

### 10.5 `TYPE_USE`

Untuk annotation pada penggunaan type.

```java
List<@NonNull CaseId> caseIds
@Encrypted String secret
```

`TYPE_USE` berguna untuk static analysis dan type-checking tools. Namun Java compiler standar tidak otomatis memberi null-safety hanya karena ada `@NonNull`.

### 10.6 `TYPE_PARAMETER`

Untuk type parameter declaration.

```java
public final class Repository<@StableId T> {
}
```

### 10.7 `RECORD_COMPONENT`

Untuk record component.

```java
public record CaseCreatedEvent(
    @ExternalId String caseNumber,
    @Sensitive String applicantName
) {}
```

Record component annotation punya implikasi ke generated accessor, field, dan constructor parameter tergantung target annotation yang dideklarasikan.

### 10.8 `MODULE`

Untuk `module-info.java`.

```java
@StableModule
module com.example.casecore {
    exports com.example.casecore.api;
}
```

Ini relevan untuk modular architecture dan static tooling.

### 10.9 Kesalahan Umum Target

#### Target terlalu luas

```java
@Target({ElementType.TYPE, ElementType.METHOD, ElementType.FIELD, ElementType.PARAMETER})
public @interface Rule {
}
```

Apa makna `@Rule` jika dipasang di field? Apa maknanya jika dipasang di method? Jika consumer berbeda, lebih baik pisahkan.

#### Target terlalu sempit

Annotation awalnya hanya untuk field, lalu record component muncul.

```java
@Target(ElementType.FIELD)
public @interface Masked {
}
```

Kemudian dipakai di record:

```java
public record Applicant(@Masked String nric) {}
```

Jika annotation tidak menargetkan `RECORD_COMPONENT` atau `TYPE_USE`, behavior bisa tidak sesuai tool yang dipakai.

---

## 11. `@Documented`

`@Documented` memberi sinyal bahwa annotation tersebut sebaiknya muncul di Javadoc elemen yang dianotasi.

```java
@Documented
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.TYPE)
public @interface PublicSpi {
}
```

Cocok untuk annotation yang menjadi bagian dari API contract:

```java
@PublicSpi
public interface CasePlugin {
}
```

Tidak semua annotation perlu `@Documented`. Annotation internal, generated, atau framework wiring mungkin tidak perlu muncul di public documentation.

Prinsip:

> Pakai `@Documented` jika annotation mengubah cara user API harus memahami element tersebut.

---

## 12. `@Inherited`

`@Inherited` hanya berlaku untuk class annotation dan hanya saat query annotation pada class melalui reflection semantics tertentu.

Contoh:

```java
@Inherited
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.TYPE)
public @interface SecuredComponent {
}

@SecuredComponent
public class BaseService {
}

public class ChildService extends BaseService {
}
```

Jika query:

```java
ChildService.class.isAnnotationPresent(SecuredComponent.class) // true
```

Tetapi perlu pahami batasannya:

1. Tidak berlaku untuk method.
2. Tidak berlaku untuk field.
3. Tidak berlaku untuk interface inheritance.
4. Tidak otomatis berlaku untuk parameter/record component/type-use.
5. Tidak berarti annotation secara fisik ada di subclass.

Kesalahan umum:

```java
@Inherited
@Target(ElementType.METHOD)
public @interface Audited {
}
```

Ini secara desain misleading. `@Inherited` tidak membuat method annotation inherited seperti yang sering diasumsikan.

Gunakan `@Inherited` hanya jika inheritance semantics benar-benar bagian dari contract class-level.

Contoh cocok:

```java
@Inherited
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.TYPE)
public @interface DomainModule {
    String value();
}
```

Contoh rawan:

```java
@Inherited
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.TYPE)
public @interface TransactionalBoundary {
}
```

Kenapa rawan? Karena subclass mungkin mengubah semantics lifecycle/transaction tetapi tetap “mewarisi” metadata.

---

## 13. `@Repeatable`

`@Repeatable` memungkinkan annotation yang sama dipakai lebih dari sekali pada element yang sama.

Contoh:

```java
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.TYPE)
@Repeatable(RequiredPermissions.class)
public @interface RequiredPermission {
    String value();
}

@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.TYPE)
public @interface RequiredPermissions {
    RequiredPermission[] value();
}
```

Pemakaian:

```java
@RequiredPermission("case.read")
@RequiredPermission("case.approve")
public final class ApproveCaseUseCase {
}
```

Consumer:

```java
RequiredPermission[] permissions =
    ApproveCaseUseCase.class.getAnnotationsByType(RequiredPermission.class);
```

### 13.1 Kapan Repeatable Cocok?

Cocok saat element bisa punya banyak metadata homogen.

Contoh:

```java
@RequiredPermission("case.read")
@RequiredPermission("case.write")

@PublishesEvent(CaseApproved.class)
@PublishesEvent(CaseRejected.class)

@HandlesCommand(CreateCase.class)
@HandlesCommand(UpdateCase.class)
```

### 13.2 Kapan Repeatable Tidak Cocok?

Jika annotation sebenarnya membentuk configuration object kompleks.

```java
@Rule(name = "A", priority = 1)
@Rule(name = "B", priority = 2)
@Rule(name = "C", priority = 3)
```

Ini masih mungkin valid. Tetapi jika hubungan antar rule kompleks, lebih baik pakai explicit registry/configuration.

---

## 14. Annotation Inheritance vs Repeatability vs Meta-Annotation: Jangan Dicampur Sembarangan

Ketiganya punya semantics berbeda:

| Fitur | Makna |
|---|---|
| `@Inherited` | class-level annotation dapat ditemukan melalui superclass query |
| `@Repeatable` | annotation yang sama boleh muncul berkali-kali |
| meta-annotation | annotation pada annotation type lain |

Kombinasi yang buruk dapat membingungkan consumer.

Contoh:

```java
@Inherited
@Repeatable(Policies.class)
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.TYPE)
public @interface Policy {
    String value();
}
```

Pertanyaan desain:

- Jika subclass punya satu `@Policy`, apakah policy parent ikut?
- Jika parent punya dua policy dan subclass punya satu, apakah digabung?
- Jika subclass ingin override, bagaimana caranya?
- Apakah order penting?

Java reflection punya rules tertentu, tetapi business semantics tetap harus Anda desain secara eksplisit. Jangan menyerahkan keputusan domain ke detail reflection tanpa dokumentasi.

---

## 15. Built-in Annotation Yang Perlu Dipahami Sebagai Desain Bahasa

### 15.1 `@Override`

`@Override` adalah compile-time safety annotation.

```java
@Override
public String toString() {
    return "Case";
}
```

Ini mencegah kesalahan seperti signature salah.

```java
// typo: tidak override method apa pun
public boolean equal(Object other) {
    return true;
}
```

Prinsip:

> Selalu gunakan `@Override` saat override method.

### 15.2 `@Deprecated`

`@Deprecated` adalah API evolution signal.

```java
@Deprecated(since = "2.4", forRemoval = true)
public void oldApprove() {
}
```

Gunakan bersama Javadoc:

```java
/**
 * @deprecated since 2.4, use {@link #approve(ApprovalCommand)} instead.
 */
@Deprecated(since = "2.4", forRemoval = true)
public void oldApprove() {
}
```

Annotation tanpa migration path bukan deprecation yang baik.

### 15.3 `@SuppressWarnings`

`@SuppressWarnings` adalah local suppression. Scope harus sekecil mungkin.

Buruk:

```java
@SuppressWarnings("unchecked")
public final class LargeService {
    ...
}
```

Lebih baik:

```java
@SuppressWarnings("unchecked")
private static <T> T cast(Object value) {
    return (T) value;
}
```

### 15.4 `@SafeVarargs`

Untuk varargs dengan generics saat method benar-benar aman.

```java
@SafeVarargs
public static <T> List<T> immutableListOf(T... values) {
    return List.of(values);
}
```

Jangan gunakan untuk menutup warning tanpa memahami heap pollution.

### 15.5 `@FunctionalInterface`

Compile-time assertion bahwa interface adalah SAM.

```java
@FunctionalInterface
public interface CasePredicate {
    boolean test(CaseSnapshot snapshot);
}
```

Jika nanti ada abstract method kedua, compiler akan menolak.

---

## 16. Annotation Sebagai DSL: Kekuatan dan Bahayanya

Annotation sering dipakai sebagai DSL deklaratif.

Contoh:

```java
@Route(method = HttpMethod.POST, path = "/cases/{id}/approve")
@RequiresPermission("case.approve")
@Audited(event = "CASE_APPROVED")
public ApprovalResult approve(CaseId id, ApprovalCommand command) {
    ...
}
```

Kelebihan:

- dekat dengan code
- ringkas
- mudah dipindai
- tooling bisa generate registry
- framework bisa melakukan wiring otomatis

Bahaya:

- hidden behavior
- magic string
- runtime failure
- annotation order ambiguity
- difficult refactor
- hard-to-test behavior
- framework lock-in
- poor discoverability outside IDE

Aturan praktis:

> Annotation cocok untuk deklarasi metadata statis. Annotation buruk untuk business logic dinamis.

---

## 17. Stringly Typed Annotation Smell

Contoh buruk:

```java
@Permission("CASE_APPROVE")
@WorkflowState("PENDING_SUPERVISOR_APPROVAL")
@Rule("CASE_OVERDUE_30_DAYS")
```

String mudah, tapi rawan:

- typo
- rename tidak aman
- tidak ada compile-time validation
- duplikasi literal
- tidak jelas owner-nya
- sulit mencari semua usage valid

Alternatif:

### 17.1 Enum

```java
public enum PermissionCode {
    CASE_APPROVE,
    CASE_READ
}

public @interface RequiresPermission {
    PermissionCode value();
}
```

Kelebihan:

- compile-time safe
- auto-complete
- refactorable

Kekurangan:

- enum evolution perlu hati-hati
- tidak cocok jika permission dynamic dari database

### 17.2 Class Token

```java
public interface Permission {
}

public final class CaseApprovePermission implements Permission {
}

public @interface RequiresPermission {
    Class<? extends Permission> value();
}
```

Kelebihan:

- extensible
- type-safe
- cocok untuk plugin/extension

Kekurangan:

- lebih verbose
- perlu registry/consumer

### 17.3 Generated Constants

```java
public final class Permissions {
    public static final String CASE_APPROVE = "case.approve";
}

@RequiresPermission(Permissions.CASE_APPROVE)
```

Ini masih string, tapi lebih terpusat.

---

## 18. Annotation Defaults: Convenience atau Compatibility Trap?

Annotation element boleh punya default.

```java
public @interface RetryPolicy {
    int maxAttempts() default 3;
    long backoffMillis() default 250;
}
```

Default berguna karena mengurangi verbosity.

Tetapi default adalah contract. Mengubah default dapat mengubah behavior semua existing usage yang tidak menyebut value eksplisit.

Contoh:

```java
// v1
int maxAttempts() default 3;

// v2
int maxAttempts() default 5;
```

Semua method yang sebelumnya implicit `3` menjadi `5` tanpa perubahan source.

Prinsip:

> Default annotation harus dianggap sebagai bagian dari public API behavior.

Jika default perlu berubah, pertimbangkan:

- versioned annotation
- explicit migration
- startup warning
- static analysis
- generated report

---

## 19. Required Element vs Optional Element

Annotation element tanpa default wajib diisi.

```java
public @interface Handler {
    String command();
}
```

Pemakaian:

```java
@Handler(command = "APPROVE_CASE")
public final class ApproveCaseHandler {
}
```

Gunakan required element jika tidak ada default yang aman.

Buruk:

```java
public @interface Handler {
    String command() default "";
}
```

Kemudian consumer harus validasi:

```java
if (annotation.command().isBlank()) {
    throw new IllegalStateException("Missing command");
}
```

Lebih baik biarkan compiler memaksa value diisi.

---

## 20. Annotation dan Validation: Compile-Time vs Startup vs Runtime

Annotation consumer harus memilih kapan validasi dilakukan.

### 20.1 Compile-Time Validation

Melalui annotation processor.

Kelebihan:

- cepat gagal
- feedback ke developer
- tidak menunggu runtime
- cocok untuk architecture rules

Contoh:

```java
@CommandHandler(ApproveCase.class)
public final class ApproveCaseHandler {
}
```

Processor dapat memvalidasi:

- class mengimplementasikan interface yang benar
- constructor tersedia
- command type valid
- tidak ada duplicate handler

### 20.2 Startup Validation

Melalui runtime scanner.

Kelebihan:

- bisa membaca classpath/module path aktual
- cocok untuk plugin yang discovered at runtime
- lebih fleksibel

Kekurangan:

- error muncul saat app start
- bisa lambat
- perlu module/reflection access

### 20.3 Runtime Per-Request Validation

Umumnya buruk untuk metadata structural.

Jika annotation salah, sebaiknya gagal di compile/startup, bukan saat request ke-1000.

---

## 21. Annotation dan Reflection Boundary

Runtime annotation dibaca melalui reflection.

Contoh:

```java
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.TYPE)
public @interface HandlerFor {
    Class<?> value();
}

@HandlerFor(ApproveCase.class)
public final class ApproveCaseHandler {
}
```

Scanner:

```java
HandlerFor annotation = type.getAnnotation(HandlerFor.class);
if (annotation != null) {
    Class<?> commandType = annotation.value();
}
```

Reflection boundary harus jelas:

- package mana yang discan?
- annotation mana yang dianggap public contract?
- apakah meta-annotation diikuti?
- apakah inherited annotation dipakai?
- bagaimana duplicate ditangani?
- apakah scan dilakukan sekali saat startup?
- apakah metadata di-cache?
- bagaimana error dilaporkan?

Jangan melakukan scanning tanpa batas di production path.

---

## 22. Annotation dan JPMS

Dengan Java Platform Module System, reflection tidak hanya bergantung pada `public`. Module boundary juga penting.

Misalnya module:

```java
module com.example.casecore {
    exports com.example.casecore.api;
}
```

Runtime framework di module lain mungkin tidak bisa deep-reflect ke package internal.

Jika annotation perlu dibaca dari public type, cukup `exports` mungkin cukup untuk public API. Jika framework perlu membaca private members atau melakukan deep reflection, perlu `opens`.

Contoh:

```java
module com.example.caseapp {
    exports com.example.caseapp.api;
    opens com.example.caseapp.internal.handlers to com.example.framework;
}
```

Prinsip:

> Annotation runtime yang bergantung pada reflection harus didesain bersama module openness policy.

Jangan membuat semua module `open module` hanya agar framework mudah bekerja. Itu melemahkan encapsulation.

---

## 23. Annotation dan Generated Code

Annotation sering menjadi input untuk code generation.

Contoh:

```java
@GenerateMapper
public interface CaseMapper {
    CaseDto toDto(CaseEntity entity);
}
```

Processor menghasilkan:

```java
public final class CaseMapperGenerated implements CaseMapper {
    ...
}
```

Annotation untuk code generation harus sangat ketat.

Checklist:

- Apakah annotation retention cukup `SOURCE` atau `CLASS`?
- Apakah processor memvalidasi semua required condition?
- Apakah generated code deterministic?
- Apakah generated code package jelas?
- Apakah generated code masuk source control atau tidak?
- Apakah error message menunjuk element yang salah?
- Apakah processor incremental-friendly?
- Apakah annotation API stabil?

Contoh annotation generation yang baik:

```java
@Retention(RetentionPolicy.SOURCE)
@Target(ElementType.TYPE)
public @interface GenerateCaseMapper {
    MapperMode mode() default MapperMode.STRICT;
}

public enum MapperMode {
    STRICT,
    LENIENT
}
```

Kenapa `SOURCE`? Karena jika annotation hanya dipakai oleh compiler-time processor dan tidak perlu runtime, jangan pakai `RUNTIME`.

---

## 24. Annotation dan Framework Coupling

Annotation bisa membuat domain code tergantung framework.

Contoh:

```java
@Entity
@Table(name = "case")
public class CaseRecord {
}
```

Ini mungkin valid untuk persistence model.

Tetapi untuk domain core, hati-hati:

```java
@Transactional
@Cacheable
@PreAuthorize("hasRole('SUPERVISOR')")
public final class CaseDecisionPolicy {
}
```

Domain policy sekarang tahu framework transaction/cache/security expression.

Alternatif:

```java
public final class CaseDecisionPolicy {
    public Decision decide(CaseSnapshot snapshot) { ... }
}

@Transactional
public final class CaseDecisionApplicationService {
    private final CaseDecisionPolicy policy;
}
```

Prinsip:

> Annotation framework sebaiknya berada di integration/application boundary, bukan di domain core yang ingin tetap portable.

---

## 25. Annotation Placement: Type, Method, Field, Parameter, Record Component

Desain annotation bukan hanya isi, tetapi juga di mana dipasang.

### 25.1 Type-Level

```java
@ApplicationUseCase
public final class ApproveCaseUseCase {
}
```

Cocok untuk role besar sebuah class.

### 25.2 Method-Level

```java
@Audited(event = AuditEventCode.CASE_APPROVED)
public ApprovalResult approve(ApprovalCommand command) {
}
```

Cocok untuk operation metadata.

### 25.3 Field-Level

```java
@Sensitive
private final String nric;
```

Cocok untuk serialization/masking/persistence metadata, tetapi rawan representation coupling.

### 25.4 Parameter-Level

```java
public void approve(@CurrentUser User user, @Valid ApprovalCommand command) {
}
```

Cocok untuk injection/validation/argument metadata.

### 25.5 Record Component-Level

```java
public record ApplicantDto(
    @Masked String nric,
    @Required String name
) {}
```

Cocok untuk transparent data carrier.

Namun consumer harus tahu membaca dari mana:

- record component
- accessor method
- canonical constructor parameter
- backing field
- type use

Jika annotation target tidak tepat, framework bisa tidak melihatnya.

---

## 26. Annotation Order dan Determinism

Java source dapat memiliki beberapa annotation pada element yang sama.

```java
@A
@B
@C
public void execute() {}
```

Jangan mendesain system yang bergantung pada order annotation kecuali consumer Anda secara eksplisit mendefinisikan dan menguji order tersebut.

Buruk:

```java
@Normalize
@Validate
@Persist
public void handle() {}
```

Apakah `Normalize` terjadi sebelum `Validate`? Apakah Java annotation order menjadi business order? Ini rapuh.

Lebih baik:

```java
@Pipeline({
    Step.NORMALIZE,
    Step.VALIDATE,
    Step.PERSIST
})
```

Atau lebih baik lagi, gunakan explicit pipeline object jika urutannya adalah logic penting:

```java
public final class CaseSubmissionPipeline {
    public Result submit(Command command) {
        NormalizedCommand normalized = normalizer.normalize(command);
        ValidationResult validation = validator.validate(normalized);
        ...
    }
}
```

---

## 27. Annotation Sebagai Architectural Boundary

Annotation bisa dipakai untuk menandai layer atau boundary.

```java
@Retention(RetentionPolicy.CLASS)
@Target(ElementType.TYPE)
public @interface DomainService {
}

@Retention(RetentionPolicy.CLASS)
@Target(ElementType.TYPE)
public @interface ApplicationService {
}

@Retention(RetentionPolicy.CLASS)
@Target(ElementType.TYPE)
public @interface InfrastructureAdapter {
}
```

Static analyzer atau annotation processor dapat memvalidasi dependency rule:

```text
DomainService must not depend on InfrastructureAdapter
ApplicationService may depend on DomainService
InfrastructureAdapter may implement ports from application/domain
```

Ini powerful karena annotation menjadi **architecture metadata**.

Namun jangan berlebihan.

Buruk:

```java
@DomainService
@CaseModule
@Stateless
@ThreadSafe
@Audited
@InternalApi
@Managed
@Validated
@Transactional
public final class CaseService {
}
```

Semakin banyak annotation, semakin besar hidden semantics.

---

## 28. Designing Annotation for Enterprise Case Management Example

Misal kita punya enforcement lifecycle:

- case created
- assigned
- reviewed
- escalated
- approved
- rejected
- closed

Kita ingin menandai command handler.

### 28.1 Naive Design

```java
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.TYPE)
public @interface Handler {
    String value();
}
```

Pemakaian:

```java
@Handler("APPROVE_CASE")
public final class ApproveCaseHandler {
}
```

Masalah:

- stringly typed
- tidak menjamin class handle command yang benar
- tidak ada lifecycle phase
- duplicate handler baru ketahuan runtime
- tidak jelas apakah value adalah command code atau permission

### 28.2 Better Runtime Design

```java
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.TYPE)
public @interface CommandHandlerFor {
    Class<? extends Command> value();
}
```

Pemakaian:

```java
@CommandHandlerFor(ApproveCase.class)
public final class ApproveCaseHandler implements CommandHandler<ApproveCase, ApprovalResult> {
    @Override
    public ApprovalResult handle(ApproveCase command) {
        ...
    }
}
```

Consumer startup bisa validasi:

- class implements `CommandHandler`
- generic command type match annotation value
- no duplicate handler per command
- constructor injectable
- command class is public API or exported

### 28.3 Better Compile-Time Design

```java
@Retention(RetentionPolicy.SOURCE)
@Target(ElementType.TYPE)
public @interface CommandHandlerFor {
    Class<? extends Command> value();
}
```

Annotation processor menghasilkan registry:

```java
public final class GeneratedCommandHandlerRegistry {
    public static Map<Class<? extends Command>, Class<?>> handlers() {
        return Map.of(
            ApproveCase.class, ApproveCaseHandler.class,
            RejectCase.class, RejectCaseHandler.class
        );
    }
}
```

Kelebihan:

- duplicate bisa compile error
- startup lebih cepat
- runtime reflection lebih sedikit
- registry eksplisit
- mudah diuji

### 28.4 Hybrid Design

Kadang compile-time generation + runtime DI dibutuhkan.

```text
annotation at source
        ↓
processor validates and generates registry
        ↓
runtime loads generated registry
        ↓
DI container resolves handler instances
```

Ini biasanya lebih kuat daripada full runtime scanning.

---

## 29. Annotation Error Message Design

Jika Anda membuat annotation processor/framework scanner, error message harus membantu.

Buruk:

```text
Invalid annotation usage
```

Lebih baik:

```text
@CommandHandlerFor is invalid on com.example.ApproveCaseHandler:
- expected class to implement CommandHandler<ApproveCase, ?>
- found CommandHandler<RejectCase, ApprovalResult>
- annotation value: ApproveCase
Suggested fix: change generic command type or annotation value.
```

Untuk runtime scanner, fail fast saat startup:

```text
Duplicate command handler for ApproveCase:
- com.example.ApproveCaseHandler
- com.example.LegacyApproveCaseHandler
Only one active handler is allowed per command type.
```

Annotation-driven systems harus memiliki diagnostics yang sangat baik karena behavior-nya tidak selalu eksplisit di call graph.

---

## 30. Annotation API Evolution

Annotation type adalah API. Perubahannya bisa breaking.

### 30.1 Menambah Element Tanpa Default

Breaking source compatibility.

```java
// v1
public @interface Rule {
    String code();
}

// v2
public @interface Rule {
    String code();
    int priority(); // breaking: existing usages fail compile
}
```

Lebih aman:

```java
int priority() default 100;
```

Tetapi default menjadi behavioral contract.

### 30.2 Menghapus Element

Breaking untuk source yang menggunakannya dan consumer yang membacanya.

### 30.3 Mengubah Type Element

Breaking.

```java
String code();
// menjadi
RuleCode code();
```

Walaupun lebih type-safe, ini migration besar.

### 30.4 Mengubah Default

Behavioral breaking.

### 30.5 Mengubah Retention

Breaking bagi consumer di phase berbeda.

### 30.6 Mengubah Target

Bisa breaking source compatibility.

Jika target dipersempit, existing usage bisa gagal compile.

### 30.7 Membuat Annotation Repeatable

Perlu memahami compatibility dengan container annotation dan reflection query method seperti `getAnnotation`, `getAnnotationsByType`, serta existing consumer behavior.

Prinsip:

> Treat annotation declarations as public schema.

---

## 31. Annotation Naming

Nama annotation harus menjelaskan semantics, bukan implementation detail.

Baik:

```java
@RequiresPermission
@PublishesEvent
@HandlesCommand
@Sensitive
@InternalApi
@GeneratedAdapter
@IdempotentOperation
@RetryableOperation
```

Kurang baik:

```java
@Magic
@Managed
@Processor
@Engine
@Rule
@Data
```

Hindari nama terlalu generic karena annotation sering muncul tanpa konteks penuh.

```java
@CaseRule
@EscalationRule
@ValidationRule
```

Lebih baik daripada:

```java
@Rule
```

---

## 32. Annotation Package Placement

Annotation yang menjadi public API sebaiknya berada di package API stabil.

```text
com.example.casecore.api.annotation
com.example.casecore.spi.annotation
```

Annotation internal:

```text
com.example.casecore.internal.annotation
```

Generated-code annotation:

```text
com.example.casecore.processor.annotation
```

Jangan mencampur annotation public dan internal dalam satu package tanpa boundary.

Dengan JPMS:

```java
module com.example.casecore {
    exports com.example.casecore.api.annotation;
    exports com.example.casecore.spi.annotation;
    // internal annotation tidak diexport
}
```

---

## 33. Annotation dan Security

Annotation security sangat rawan karena sering terlihat declarative tetapi enforce-nya tergantung consumer.

Contoh:

```java
@RequiresPermission("case.approve")
public void approve(...) {
}
```

Pertanyaan wajib:

- Apakah method ini selalu dipanggil melalui proxy/interceptor?
- Bagaimana jika dipanggil dari method internal class yang sama?
- Apakah annotation pada interface atau implementation yang dibaca?
- Apakah inherited annotation diproses?
- Apakah async execution mempertahankan security context?
- Apakah generated proxy menghormati final/private method limitation?
- Apakah test memverifikasi enforcement, bukan hanya annotation presence?

Security annotation tanpa enforcement path yang jelas adalah false sense of security.

Untuk operasi kritikal, pertimbangkan explicit check dalam application boundary:

```java
permissionChecker.require(user, Permission.CASE_APPROVE, caseId);
```

Annotation boleh membantu metadata/audit, tetapi jangan menjadi satu-satunya tempat security reasoning jika dispatch path tidak terkendali.

---

## 34. Annotation dan Transaction Boundary

Transaction annotation sering dipakai di enterprise Java.

Risiko desain:

- self-invocation bypass proxy
- private/final method tidak terintercept oleh proxy tertentu
- annotation di interface vs class semantics berbeda antar framework
- checked exception rollback policy berbeda
- async boundary keluar dari transaction context
- nested call behavior tidak terlihat dari source lokal

Prinsip desain annotation transactional:

> Transaction boundary adalah architectural decision, bukan dekorasi acak di method mana pun.

Lebih baik menempatkan transaction di application service boundary daripada domain object.

---

## 35. Annotation dan Observability

Annotation bisa membantu observability.

```java
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
public @interface MeasuredOperation {
    String value();
}
```

Tetapi observability annotation juga punya risiko:

- high-cardinality label
- string name tidak konsisten
- interceptor overhead
- missing annotation menyebabkan blind spot
- annotation pada internal method menghasilkan noisy metrics

Baik:

```java
@MeasuredOperation(OperationCode.APPROVE_CASE)
public ApprovalResult approve(...) {}
```

Dengan enum/stable code:

```java
public enum OperationCode {
    APPROVE_CASE,
    REJECT_CASE,
    ESCALATE_CASE
}
```

---

## 36. Annotation dan Testing

Annotation-driven behavior harus diuji dalam beberapa layer.

### 36.1 Annotation Declaration Test

Pastikan annotation punya retention/target benar.

```java
@Test
void commandHandlerForHasRuntimeRetention() {
    Retention retention = CommandHandlerFor.class.getAnnotation(Retention.class);
    assertEquals(RetentionPolicy.RUNTIME, retention.value());
}
```

Ini berguna untuk public annotation yang kritikal.

### 36.2 Scanner/Processor Test

Uji consumer, bukan hanya annotation.

```java
@Test
void scannerFindsCommandHandlers() {
    HandlerRegistry registry = scanner.scan("com.example.caseapp");
    assertTrue(registry.contains(ApproveCase.class));
}
```

### 36.3 Negative Test

Pastikan invalid annotation usage gagal dengan error jelas.

```java
@CommandHandlerFor(ApproveCase.class)
final class InvalidHandler {
}
```

Expected:

```text
Class must implement CommandHandler<ApproveCase, ?>
```

### 36.4 Integration Test

Untuk annotation yang enforce behavior seperti security/transaction/audit, test harus membuktikan behavior terjadi.

Jangan hanya test:

```java
assertTrue(method.isAnnotationPresent(RequiresPermission.class));
```

Test:

```java
assertThrows(AccessDeniedException.class, () -> approveWithoutPermission());
```

---

## 37. Annotation Anti-Patterns

### 37.1 Annotation Soup

```java
@A
@B
@C
@D
@E
@F
public class Service {
}
```

Jika butuh banyak annotation untuk memahami class, kemungkinan abstraction boundary tidak jelas.

### 37.2 Hidden Control Flow

```java
@DoEverything
public void handle() {}
```

Behavior tidak terlihat di code.

### 37.3 Stringly Typed Runtime DSL

```java
@Condition("case.status == 'OPEN' && user.role == 'ADMIN'")
```

Sulit divalidasi dan refactor.

### 37.4 Environment-Specific Annotation

```java
@Endpoint("https://dev.example.com")
```

Configuration environment sebaiknya tidak hard-coded di annotation.

### 37.5 Business Logic in Annotation

```java
@EscalateIf(days = 30, role = "SUPERVISOR", region = "SG", status = "OPEN")
```

Ini mungkin terlihat declarative, tetapi bisa berubah menjadi rule engine mini yang buruk.

### 37.6 Annotation Without Consumer

```java
@Important
public void doSomething() {}
```

Tidak ada tooling, tidak ada runtime behavior, tidak ada documentation semantics.

### 37.7 Consumer Silent Ignore

Annotation salah tetapi framework diam.

Lebih baik fail fast.

---

## 38. Decision Matrix: Perlukah Membuat Annotation?

| Kebutuhan | Annotation cocok? | Alternatif |
|---|---:|---|
| Metadata statis dekat dengan code | Ya | annotation |
| Compile-time generation | Ya | annotation processor |
| Runtime discovery | Ya, hati-hati | registry eksplisit, ServiceLoader |
| Business rule dinamis | Biasanya tidak | policy object, DB config, rule engine |
| Environment config | Tidak | config file/env/secret manager |
| Security enforcement | Bisa, tetapi harus jelas | explicit permission checker |
| Transaction boundary | Bisa | explicit application service boundary |
| Documentation-only marker | Ya, jika jelas | Javadoc, package docs |
| Layer architecture validation | Ya | ArchUnit/custom analyzer |
| One-off flag internal | Mungkin tidak | naming/package convention |

---

## 39. Production Checklist Annotation Design

Sebelum membuat annotation baru, jawab:

1. Apa nama annotation dan apakah semantiknya jelas?
2. Consumer-nya siapa?
3. Dibaca kapan?
4. Retention apa yang benar?
5. Target apa yang paling sempit tetapi cukup?
6. Apakah perlu `@Documented`?
7. Apakah `@Inherited` benar-benar valid?
8. Apakah perlu repeatable?
9. Apakah element type type-safe?
10. Apakah ada stringly typed smell?
11. Apakah default aman dan stabil?
12. Apakah missing value harus compile error?
13. Apakah invalid usage divalidasi compile-time/startup?
14. Apakah behavior annotation terdokumentasi?
15. Apakah annotation menjadi public API?
16. Bagaimana evolution strategy-nya?
17. Apakah perlu JPMS `exports`/`opens`?
18. Apakah annotation framework-coupled?
19. Apakah domain core tercemar framework annotation?
20. Apakah test membuktikan consumer behavior?

---

## 40. Mini Exercise

### Exercise 1 — Design `@HandlesCommand`

Desain annotation untuk command handler.

Requirements:

- handler class harus menunjuk command type
- command type harus implement `Command`
- annotation dipakai untuk generated registry
- tidak perlu runtime reflection

Solusi awal:

```java
@Retention(RetentionPolicy.SOURCE)
@Target(ElementType.TYPE)
public @interface HandlesCommand {
    Class<? extends Command> value();
}
```

Kenapa `SOURCE`?

Karena annotation processor membaca source model dan menghasilkan registry. Runtime tidak perlu annotation.

### Exercise 2 — Design `@Sensitive`

Requirements:

- bisa dipasang pada field DTO lama
- bisa dipasang pada record component DTO baru
- runtime serializer perlu membaca metadata

Solusi awal:

```java
@Documented
@Retention(RetentionPolicy.RUNTIME)
@Target({
    ElementType.FIELD,
    ElementType.RECORD_COMPONENT,
    ElementType.TYPE_USE
})
public @interface Sensitive {
    Sensitivity value() default Sensitivity.PERSONAL_DATA;
}

public enum Sensitivity {
    PERSONAL_DATA,
    SECRET,
    FINANCIAL,
    LEGAL_PRIVILEGED
}
```

Consumer harus jelas membaca field dan record component.

### Exercise 3 — Design `@PublicSpi`

Requirements:

- menandai interface yang boleh diimplementasikan plugin eksternal
- harus muncul di Javadoc
- runtime tidak perlu membaca

Solusi awal:

```java
@Documented
@Retention(RetentionPolicy.CLASS)
@Target(ElementType.TYPE)
public @interface PublicSpi {
    String since();
}
```

Bisa juga `RUNTIME` jika plugin loader perlu membaca annotation saat runtime. Jika hanya dokumentasi dan static tooling, `CLASS` atau `SOURCE` mungkin cukup tergantung consumer.

---

## 41. Key Takeaways

1. Annotation adalah metadata, bukan behavior.
2. Setiap annotation butuh consumer yang jelas.
3. `Retention` harus ditentukan dari phase pembacaan metadata.
4. `Target` harus sesempit mungkin agar semantics tidak ambigu.
5. `@Inherited` hanya cocok untuk class-level inheritance semantics yang benar-benar diinginkan.
6. `@Repeatable` cocok untuk metadata homogen yang boleh muncul berkali-kali.
7. Annotation element harus type-safe sebisa mungkin.
8. Stringly typed annotation adalah smell kecuali value memang external protocol/code.
9. Default annotation adalah behavioral contract.
10. Annotation public harus diperlakukan seperti schema/API.
11. Annotation framework sebaiknya tidak mencemari domain core tanpa alasan kuat.
12. Annotation-driven behavior harus fail fast dan punya diagnostics baik.
13. Untuk generated code, gunakan retention seminimal mungkin.
14. Untuk JPMS, pikirkan `exports` dan `opens` sejak awal.
15. Top engineer tidak hanya bisa memakai annotation, tetapi bisa mendesain annotation sebagai contract yang stabil, observable, testable, dan evolvable.

---

## 42. Referensi Resmi

- Java SE 25 API — `java.lang.annotation` package
- Java SE 25 API — `Retention`, `Target`, `Repeatable`, `Inherited`, `Documented`
- Java SE 25 API — `AnnotatedElement`
- Java Language Specification — Chapter 9, Annotation Interfaces
- Java Language Specification — Type annotations and element types
- Java Platform Module System / JPMS for reflection and module boundary implications

---

## 43. Status Seri

Seri **belum selesai**.

Bagian berikutnya:

```text
learn-java-oop-functional-reflection-codegen-modules-part-022.md
```

Topik berikutnya:

```text
Annotation Processing: Compile-Time Metaprogramming
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-oop-functional-reflection-codegen-modules-part-020](./learn-java-oop-functional-reflection-codegen-modules-part-020.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-oop-functional-reflection-codegen-modules-part-022](./learn-java-oop-functional-reflection-codegen-modules-part-022.md)

</div>