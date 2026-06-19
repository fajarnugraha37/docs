# learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-007

# Part 007 — CDI with Arc: Dependency Injection yang Dioptimalkan untuk Build-Time

> Seri: `learn-java-quarkus-runtime-cloud-native-native-image-engineering`  
> Level: Advanced / Engineering Deep Dive  
> Fokus: Quarkus Arc, CDI Lite, build-time DI, bean discovery, scopes, injection, producer, interceptor, observer, synthetic bean, unused bean removal, native-image readiness, dan desain dependency graph production-grade.

---

## 0. Posisi Part Ini dalam Seri

Kita sudah membahas:

- Part 000: orientasi seri, scope, dan strategi belajar.
- Part 001: mental model Quarkus sebagai runtime build-time optimized.
- Part 002: strategi versi Java 8 sampai 25, Quarkus 2/3, Jakarta migration.
- Part 003: arsitektur internal Quarkus: augmentation, Jandex, build steps, recorders, extension model.
- Part 004: dev mode, continuous testing, Dev UI, Dev Services.
- Part 005: project structure, Maven/Gradle, platform BOM, extension governance.
- Part 006: configuration architecture, SmallRye Config, profiles, secrets, build-time vs runtime config.

Part ini membahas **CDI di Quarkus**, tetapi bukan mengulang dasar CDI/Jakarta DI. Kamu sudah punya fondasi Jakarta dan DI. Jadi fokus kita adalah:

> Bagaimana dependency injection berubah ketika container CDI dibangun, dianalisis, divalidasi, dan dioptimalkan saat build-time, bukan saat application startup.

Di Quarkus, CDI bukan sekadar mekanisme “inject object”. CDI adalah **dependency graph compiler**. Arc, container CDI milik Quarkus, menganalisis bean, injection point, interceptor, producer, observer, qualifier, dan dependency reachability saat build. Hasilnya adalah runtime yang lebih kecil, lebih cepat start, dan lebih native-image-friendly.

Referensi resmi utama:

- Quarkus CDI Reference — `https://quarkus.io/guides/cdi-reference`
- Quarkus CDI Introduction — `https://quarkus.io/guides/cdi`
- Quarkus CDI Integration Guide — `https://quarkus.io/guides/cdi-integration`
- Quarkus Lifecycle Guide — `https://quarkus.io/guides/lifecycle`
- Quarkus Unused Beans Blog — `https://quarkus.io/blog/unused-beans/`
- Quarkus Writing Extensions — `https://quarkus.io/guides/writing-extensions`
- Quarkus Build Items Reference — `https://quarkus.io/guides/all-builditems`

---

## 1. Inti Mental Model

### 1.1 DI Tradisional: Runtime Container

Dalam banyak framework Java klasik, dependency injection bekerja seperti ini:

1. Aplikasi start.
2. Container scan classpath.
3. Annotation dibaca via reflection.
4. Metadata bean dibangun.
5. Dependency graph divalidasi.
6. Proxy dibuat.
7. Context disiapkan.
8. Aplikasi menerima request.

Model ini fleksibel, tetapi mahal:

- startup lebih lama,
- runtime metadata besar,
- reflection banyak,
- lebih sulit untuk native image,
- error dependency sering baru muncul saat runtime/startup,
- object graph sering masih terlalu dinamis.

### 1.2 Quarkus Arc: Build-Time Container

Quarkus membalik banyak pekerjaan itu ke build-time:

1. Source dikompilasi.
2. Quarkus augmentation berjalan.
3. Jandex index membaca annotation metadata tanpa reflection runtime.
4. Arc melakukan bean discovery.
5. Injection point divalidasi.
6. Bean yang tidak dipakai dapat dibuang.
7. Proxy/metadata/generation dilakukan saat build.
8. Runtime hanya menjalankan graph yang sudah dipersiapkan.

Konsekuensinya:

- startup jauh lebih cepat,
- memory footprint lebih kecil,
- kesalahan injection lebih cepat ditemukan,
- native image lebih feasible,
- tetapi pola DI yang terlalu dinamis menjadi lebih terbatas.

### 1.3 CDI di Quarkus Bukan “CDI Full”

Arc mengikuti **CDI Lite** dengan beberapa extension Quarkus-specific. Artinya:

- sebagian besar penggunaan CDI modern tetap berjalan,
- tetapi tidak semua fitur CDI Full/portable extension didukung,
- Quarkus lebih memilih mekanisme extension build-time daripada portable extension runtime.

Poin penting:

> Kalau suatu pola CDI bergantung pada dynamic runtime discovery, besar kemungkinan pola itu tidak cocok dengan filosofi Quarkus.

---

## 2. Kenapa CDI Sangat Penting di Quarkus

Di Quarkus, CDI adalah backbone banyak fitur:

- REST resource adalah CDI bean.
- Service layer biasanya CDI bean.
- Repository/Panache dapat menjadi CDI bean.
- Security identity, permission checker, client, mapper, listener, scheduler, messaging handler sering adalah CDI bean.
- Config mapping dapat diinjeksi.
- Interceptor seperti transaction, security, metrics, fault tolerance berjalan melalui CDI interceptor model.
- Test class `@QuarkusTest` juga berinteraksi dengan CDI.
- Extension dapat menambahkan synthetic bean.

Jadi memahami Arc berarti memahami bagaimana aplikasi Quarkus “dirakit”.

Mental model paling penting:

```text
Quarkus Application
        |
        v
Build-time augmentation
        |
        v
Bean discovery + dependency graph validation
        |
        v
Generated runtime wiring
        |
        v
Small runtime container
        |
        v
Fast startup + predictable dependency graph
```

---

## 3. Bean: Unit Dasar Dependency Graph

### 3.1 Apa Itu Bean di Quarkus?

Bean adalah object yang dikelola oleh container Arc.

Bean dapat berasal dari:

- class dengan bean defining annotation,
- producer method,
- producer field,
- synthetic bean dari extension,
- additional bean yang didaftarkan oleh extension,
- selected framework integration.

Contoh sederhana:

```java
package com.acme.caseflow.application;

import jakarta.enterprise.context.ApplicationScoped;

@ApplicationScoped
public class CaseAssignmentService {

    public AssignmentDecision assign(CaseDraft draft) {
        return AssignmentDecision.manualReview("default routing");
    }
}
```

Class ini menjadi CDI bean karena memiliki annotation scope `@ApplicationScoped`.

### 3.2 Bean Defining Annotation

Bean biasanya ditemukan jika punya annotation seperti:

- `@ApplicationScoped`
- `@RequestScoped`
- `@Singleton`
- `@Dependent`
- `@SessionScoped` jika environment mendukung konteksnya
- stereotype custom yang mengandung scope
- annotation lain yang dikenali oleh extension tertentu

Quarkus tidak selalu men-scan seluruh classpath secara buta. Discovery sangat terkait dengan Jandex index dan extension metadata.

### 3.3 Kesalahan Mental Model

Kesalahan umum:

```java
public class PlainService {
}
```

Lalu berharap bisa diinjeksi:

```java
@Inject
PlainService service;
```

Kalau `PlainService` tidak terdaftar sebagai bean, Arc tidak punya alasan untuk mengelolanya. Dalam Quarkus, ini biasanya gagal saat build/startup validation, bukan diam-diam dibuat saat runtime.

Solusi eksplisit:

```java
@ApplicationScoped
public class PlainService {
}
```

Atau daftarkan melalui extension/additional bean jika class berasal dari library.

---

## 4. Scope: Lifecycle dan Semantik Object

Scope menentukan lifecycle bean.

### 4.1 `@ApplicationScoped`

Paling umum untuk service stateless.

```java
@ApplicationScoped
public class CaseValidationService {
    public ValidationResult validate(CaseSubmission submission) {
        return ValidationResult.ok();
    }
}
```

Makna:

- satu contextual instance per aplikasi,
- biasanya diakses lewat client proxy,
- cocok untuk service stateless,
- aman jika state internal immutable/thread-safe.

Gunakan untuk:

- domain service stateless,
- integration client wrapper,
- mapper stateless,
- policy evaluator,
- orchestrator ringan,
- repository jika tidak menyimpan mutable per-request state.

Hindari menyimpan state request/user di dalam field:

```java
@ApplicationScoped
public class BadCaseService {
    private String currentUserId; // buruk
}
```

Karena instance digunakan lintas request/thread.

### 4.2 `@RequestScoped`

Instance hidup selama satu request.

```java
@RequestScoped
public class RequestAuditContext {
    private String correlationId;
    private String userId;

    public String correlationId() {
        return correlationId;
    }

    public void setCorrelationId(String correlationId) {
        this.correlationId = correlationId;
    }
}
```

Cocok untuk:

- request context,
- per-request accumulator,
- identity-derived information,
- request-scoped caching kecil.

Risiko:

- context availability pada async/reactive flow,
- context propagation,
- memory leak jika object besar,
- kebingungan saat dipakai di scheduled job/background thread.

### 4.3 `@Singleton`

`jakarta.inject.Singleton` atau Quarkus singleton-style bean dapat digunakan untuk instance tunggal tanpa CDI normal scoped proxy semantics seperti normal scope.

Gunakan dengan hati-hati. Dalam banyak aplikasi Quarkus, `@ApplicationScoped` lebih idiomatik karena mengikuti CDI contextual lifecycle.

Perbedaan praktis:

- `@ApplicationScoped` adalah normal scope dan biasanya diproxy.
- `@Singleton` lebih langsung sebagai singleton instance.
- Interceptor/proxy behavior dapat berbeda tergantung konteks.

Rule praktis:

> Pakai `@ApplicationScoped` sebagai default untuk service stateless. Pakai `@Singleton` hanya jika kamu benar-benar paham implikasinya dan butuh semantics tersebut.

### 4.4 `@Dependent`

Scope default dependent berarti lifecycle bean mengikuti injection target.

```java
@Dependent
public class QueryBuilder {
    private final List<String> predicates = new ArrayList<>();
}
```

Cocok untuk:

- object helper ringan,
- stateful helper yang lifecycle-nya mengikuti consumer,
- producer-generated object tertentu.

Risiko:

- instance bisa banyak,
- lifecycle destruction lebih subtle,
- bukan tempat untuk resource berat.

### 4.5 Scope Decision Table

| Kebutuhan | Scope yang Biasanya Cocok | Catatan |
|---|---:|---|
| Stateless service | `@ApplicationScoped` | Default terbaik |
| Per-request state | `@RequestScoped` | Pastikan context tersedia |
| Helper stateful kecil | `@Dependent` | Instance mengikuti consumer |
| Single global utility | `@ApplicationScoped` atau `@Singleton` | Prefer `@ApplicationScoped` |
| Heavy resource external | Producer + lifecycle management | Jangan asal new object |
| Config object type-safe | `@ConfigMapping`/injection | Hindari parsing manual berulang |

---

## 5. Injection: Field, Constructor, Method

### 5.1 Field Injection

```java
@ApplicationScoped
public class CaseService {

    @Inject
    CaseRepository repository;

    public CaseRecord get(String id) {
        return repository.findById(id);
    }
}
```

Kelebihan:

- singkat,
- umum di CDI,
- mudah dibaca untuk contoh kecil.

Kekurangan:

- dependency tersembunyi dari constructor,
- lebih sulit untuk plain unit test tanpa container,
- final field tidak bisa digunakan,
- membuat object terlihat bisa dibuat manual padahal tidak lengkap.

### 5.2 Constructor Injection

```java
@ApplicationScoped
public class CaseService {

    private final CaseRepository repository;
    private final CasePolicy policy;

    @Inject
    public CaseService(CaseRepository repository, CasePolicy policy) {
        this.repository = repository;
        this.policy = policy;
    }

    public CaseRecord get(String id) {
        CaseRecord record = repository.findById(id);
        policy.assertReadable(record);
        return record;
    }
}
```

Kelebihan:

- dependency eksplisit,
- field bisa final,
- lebih mudah unit test,
- object invariant lebih kuat,
- cocok untuk software engineering skala besar.

Quarkus mendukung simplified constructor injection dalam banyak kasus, tetapi secara tim engineering, eksplisit tetap sering lebih mudah direview.

### 5.3 Method Injection

```java
@ApplicationScoped
public class CaseService {

    private CaseRepository repository;

    @Inject
    void init(CaseRepository repository) {
        this.repository = repository;
    }
}
```

Jarang menjadi default. Cocok untuk kasus tertentu, misalnya injection optional/configurable atau setup internal tertentu, tapi jangan jadikan pola utama.

### 5.4 Rekomendasi Praktis

Untuk kode production-grade:

1. Gunakan constructor injection untuk service/domain/application layer.
2. Gunakan field injection hanya untuk resource/framework glue kecil jika memang idiomatik.
3. Hindari private injection member jika mengganggu proxy/generation/reflection constraint.
4. Hindari circular dependency.
5. Buat dependency graph mudah dibaca dari constructor.

---

## 6. Qualifier: Memilih Implementasi Secara Eksplisit

### 6.1 Masalah Multiple Implementation

Misalnya ada dua strategy assignment:

```java
public interface CaseAssignmentStrategy {
    AssignmentDecision assign(CaseDraft draft);
}
```

Implementasi pertama:

```java
@ApplicationScoped
public class ManualAssignmentStrategy implements CaseAssignmentStrategy {
    @Override
    public AssignmentDecision assign(CaseDraft draft) {
        return AssignmentDecision.manualReview("manual strategy");
    }
}
```

Implementasi kedua:

```java
@ApplicationScoped
public class AutoAssignmentStrategy implements CaseAssignmentStrategy {
    @Override
    public AssignmentDecision assign(CaseDraft draft) {
        return AssignmentDecision.auto("auto strategy");
    }
}
```

Injection ini ambigu:

```java
@Inject
CaseAssignmentStrategy strategy;
```

Arc tidak bisa memilih secara aman. Ini harus gagal. Failure seperti ini bagus karena ambiguity ditemukan cepat.

### 6.2 Custom Qualifier

```java
import jakarta.inject.Qualifier;
import java.lang.annotation.Retention;
import java.lang.annotation.Target;

import static java.lang.annotation.ElementType.FIELD;
import static java.lang.annotation.ElementType.METHOD;
import static java.lang.annotation.ElementType.PARAMETER;
import static java.lang.annotation.ElementType.TYPE;
import static java.lang.annotation.RetentionPolicy.RUNTIME;

@Qualifier
@Retention(RUNTIME)
@Target({ TYPE, FIELD, PARAMETER, METHOD })
public @interface ManualAssignment {
}
```

```java
@ManualAssignment
@ApplicationScoped
public class ManualAssignmentStrategy implements CaseAssignmentStrategy {
    @Override
    public AssignmentDecision assign(CaseDraft draft) {
        return AssignmentDecision.manualReview("manual strategy");
    }
}
```

```java
@ApplicationScoped
public class CaseAssignmentService {

    private final CaseAssignmentStrategy strategy;

    @Inject
    public CaseAssignmentService(@ManualAssignment CaseAssignmentStrategy strategy) {
        this.strategy = strategy;
    }
}
```

### 6.3 Qualifier with Member

```java
@Qualifier
@Retention(RUNTIME)
@Target({ TYPE, FIELD, PARAMETER, METHOD })
public @interface ChannelType {
    String value();
}
```

```java
@ChannelType("email")
@ApplicationScoped
public class EmailNotificationSender implements NotificationSender {
}
```

```java
@ChannelType("sms")
@ApplicationScoped
public class SmsNotificationSender implements NotificationSender {
}
```

Gunakan dengan hati-hati. String qualifier member raw bisa menjadi fragile. Untuk domain penting, enum bisa lebih baik.

### 6.4 Qualifier Anti-Pattern

Buruk:

```java
@Qualifier
public @interface Primary {
}
```

Lalu semua service memakai `@Primary` tanpa alasan domain. Ini hanya memindahkan ambiguity menjadi hidden convention.

Lebih baik qualifier merepresentasikan semantic:

- `@InternalApi`
- `@ExternalApi`
- `@ReadModel`
- `@WriteModel`
- `@AuditSink`
- `@CaseWorkflow`
- `@SystemClock`

---

## 7. Producer: Membuat Bean dari Factory yang Terkontrol

### 7.1 Kapan Perlu Producer?

Producer digunakan ketika:

- object tidak bisa diberi annotation CDI langsung,
- object berasal dari third-party library,
- construction butuh config,
- construction butuh conditional logic,
- resource butuh lifecycle management,
- object harus diberi qualifier tertentu.

Contoh:

```java
@ApplicationScoped
public class ClockProducer {

    @Produces
    @ApplicationScoped
    public Clock systemClock() {
        return Clock.systemUTC();
    }
}
```

Kemudian:

```java
@ApplicationScoped
public class CaseDeadlineService {

    private final Clock clock;

    @Inject
    public CaseDeadlineService(Clock clock) {
        this.clock = clock;
    }

    public Instant now() {
        return Instant.now(clock);
    }
}
```

Keuntungannya:

- test mudah mengganti clock,
- waktu tidak hardcoded,
- determinism meningkat.

### 7.2 Producer dengan Config

Misalnya config mapping:

```java
@ConfigMapping(prefix = "case.assignment")
public interface AssignmentConfig {
    int maxCasesPerOfficer();
    boolean autoAssignmentEnabled();
}
```

Producer:

```java
@ApplicationScoped
public class AssignmentPolicyProducer {

    @Produces
    @ApplicationScoped
    AssignmentPolicy assignmentPolicy(AssignmentConfig config) {
        return new AssignmentPolicy(
                config.maxCasesPerOfficer(),
                config.autoAssignmentEnabled()
        );
    }
}
```

Consumer:

```java
@ApplicationScoped
public class CaseAssignmentService {

    private final AssignmentPolicy policy;

    @Inject
    public CaseAssignmentService(AssignmentPolicy policy) {
        this.policy = policy;
    }
}
```

### 7.3 Producer Disposal

Untuk resource yang perlu cleanup, CDI mendukung disposer method.

```java
@ApplicationScoped
public class ExternalClientProducer {

    @Produces
    @ApplicationScoped
    ExternalClient externalClient(ApiConfig config) {
        return ExternalClient.connect(config.endpoint(), config.token());
    }

    void close(@Disposes ExternalClient client) {
        client.close();
    }
}
```

Tetapi di Quarkus, sering lebih baik memakai extension resmi atau client framework resmi yang sudah punya lifecycle integration.

### 7.4 Producer Anti-Pattern

Buruk:

```java
@Produces
public Object produce(String name) {
    return Class.forName(name).getDeclaredConstructor().newInstance();
}
```

Masalah:

- dynamic reflection,
- native image hostile,
- dependency graph tidak terlihat,
- error muncul terlambat,
- sulit dianalisis oleh Arc.

Di Quarkus, producer sebaiknya tetap deterministic dan explicit.

---

## 8. Alternative dan Conditional Bean

### 8.1 Alternative untuk Testing/Environment

```java
@Alternative
@Priority(1)
@ApplicationScoped
public class StubNotificationSender implements NotificationSender {
    @Override
    public void send(Notification notification) {
        // no-op for test/dev
    }
}
```

Alternative bisa berguna, tetapi jangan dijadikan mekanisme environment switching utama jika config/profile lebih jelas.

### 8.2 `@IfBuildProfile` dan `@UnlessBuildProfile`

Quarkus menyediakan annotation conditional berdasarkan build profile.

Contoh konseptual:

```java
@ApplicationScoped
@IfBuildProfile("dev")
public class DevOnlyAuditSink implements AuditSink {
}
```

```java
@ApplicationScoped
@UnlessBuildProfile("dev")
public class ProductionAuditSink implements AuditSink {
}
```

Gunakan ketika pemilihan bean memang build-time decision.

### 8.3 `@IfBuildProperty`

Jika pemilihan bean tergantung build-time property:

```java
@ApplicationScoped
@IfBuildProperty(name = "audit.sink", stringValue = "database")
public class DatabaseAuditSink implements AuditSink {
}
```

Perhatikan bahwa build-time condition tidak bisa diubah sembarangan saat runtime. Kalau ingin runtime switch, gunakan config runtime di dalam service atau strategy resolver yang tetap eksplisit.

### 8.4 Conditional Bean Decision

| Kebutuhan | Pilihan |
|---|---|
| Test mengganti dependency | Mock/alternative/test profile |
| Dev-only implementation | `@IfBuildProfile("dev")` |
| Build artifact berbeda per target | build-time property/profile |
| Runtime tenant berbeda | resolver runtime eksplisit |
| Feature flag runtime | config service/flag evaluator |

---

## 9. Interceptor: Cross-Cutting Concern dengan Boundary yang Jelas

### 9.1 Apa Itu Interceptor?

Interceptor membungkus method call CDI bean untuk cross-cutting behavior:

- transaction,
- security,
- metrics,
- logging,
- audit,
- retry/fault tolerance,
- validation,
- custom policy.

Contoh binding:

```java
@InterceptorBinding
@Retention(RUNTIME)
@Target({ TYPE, METHOD })
public @interface AuditedAction {
    String value();
}
```

Interceptor:

```java
@AuditedAction("")
@Interceptor
@Priority(Interceptor.Priority.APPLICATION)
public class AuditedActionInterceptor {

    @AroundInvoke
    Object around(InvocationContext ctx) throws Exception {
        long start = System.nanoTime();
        try {
            return ctx.proceed();
        } finally {
            long elapsed = System.nanoTime() - start;
            // write structured audit/technical event
        }
    }
}
```

Usage:

```java
@ApplicationScoped
public class CaseApprovalService {

    @AuditedAction("case.approve")
    public void approve(String caseId) {
        // domain action
    }
}
```

### 9.2 Interceptor Boundary

Interceptor cocok untuk:

- behavior seragam,
- technical concern,
- policy yang tidak perlu domain branching kompleks,
- observability concern,
- transaction boundary.

Interceptor buruk untuk:

- domain logic utama,
- authorization kompleks berbasis object state,
- workflow transition decision,
- logic yang butuh explicit readability.

Misalnya, jangan sembunyikan approval rule kompleks di interceptor:

```java
@CanApproveCase
public void approve(String caseId) { ... }
```

Kalau rule-nya bergantung pada status case, owner, assignment, escalation, appeal, conflict-of-interest, statutory deadline, dan agency policy, lebih baik eksplisit:

```java
policy.assertCanApprove(user, caseRecord);
caseWorkflow.approve(caseRecord, command);
```

### 9.3 Self-Invocation Trap

Interceptor biasanya bekerja lewat proxy. Kalau method dalam class yang sama memanggil method lain yang dianotasi interceptor, interceptor bisa tidak terpanggil karena bypass proxy.

```java
@ApplicationScoped
public class CaseService {

    public void outer() {
        inner(); // self-invocation, interceptor pada inner bisa tidak aktif
    }

    @Transactional
    public void inner() {
    }
}
```

Solusi:

- pindahkan method intercepted ke bean lain,
- desain boundary lebih eksplisit,
- jangan andalkan self-invocation untuk transaction/security boundary.

---

## 10. Observer: Event Internal Container

### 10.1 CDI Event

CDI event bukan message broker. Ini mekanisme event in-process.

```java
public record CaseSubmittedEvent(String caseId, String submittedBy) {
}
```

Fire event:

```java
@ApplicationScoped
public class CaseSubmissionService {

    private final Event<CaseSubmittedEvent> events;

    @Inject
    public CaseSubmissionService(Event<CaseSubmittedEvent> events) {
        this.events = events;
    }

    public void submit(String caseId, String userId) {
        // persist state
        events.fire(new CaseSubmittedEvent(caseId, userId));
    }
}
```

Observer:

```java
@ApplicationScoped
public class CaseSubmittedObserver {

    void onSubmitted(@Observes CaseSubmittedEvent event) {
        // in-process reaction
    }
}
```

### 10.2 Startup and Shutdown Events

Quarkus menyediakan lifecycle event:

```java
@ApplicationScoped
public class AppLifecycle {

    void onStart(@Observes StartupEvent event) {
        // warmup, validation, log startup state
    }

    void onStop(@Observes ShutdownEvent event) {
        // cleanup, drain, stop background resources
    }
}
```

Gunakan startup event untuk:

- validate external mandatory config,
- warm up critical lightweight cache,
- log startup fingerprint,
- register in-memory scheduler state,
- verify database migration marker.

Hindari startup event untuk:

- heavy migration blocking tanpa timeout,
- remote call berantai yang membuat app gagal start tidak terkendali,
- load data besar ke memory,
- logic bisnis yang seharusnya explicit job.

### 10.3 Observer vs Messaging

| Kebutuhan | CDI Event | Kafka/RabbitMQ/Event Bus |
|---|---:|---:|
| In-process notification | Cocok | Berlebihan |
| Cross-service event | Tidak cocok | Cocok |
| Durable event | Tidak | Ya, jika broker mendukung |
| Replay | Tidak | Bisa |
| Transactional outbox | Tidak cukup | Cocok dengan DB/outbox/CDC |
| Async decoupling kuat | Terbatas | Cocok |

Rule:

> CDI event adalah internal application mechanism, bukan integration architecture.

---

## 11. Client Proxy dan Normal Scope

### 11.1 Kenapa Proxy Ada?

Untuk normal scope seperti `@ApplicationScoped` dan `@RequestScoped`, container sering menyuntikkan proxy, bukan instance langsung.

Proxy memungkinkan:

- lazy contextual resolution,
- request scoped instance berbeda per request,
- interceptor invocation,
- lifecycle control,
- decoupling injection target dari actual instance.

### 11.2 Konsekuensi Proxy

Kamu perlu berhati-hati dengan:

- final class,
- final method,
- private method yang diharapkan intercepted,
- constructor side effect,
- equals/hashCode assumption,
- self-invocation.

Quarkus dapat melakukan transformasi tertentu, tetapi jangan mendesain melawan proxy model.

Praktik aman:

```java
@ApplicationScoped
public class CasePolicyService {
    public PolicyDecision evaluate(CaseRecord record) {
        return PolicyDecision.allowed();
    }
}
```

Hindari:

```java
@ApplicationScoped
public final class CasePolicyService {
    public final PolicyDecision evaluate(CaseRecord record) {
        return PolicyDecision.allowed();
    }
}
```

Kecuali kamu benar-benar tahu apakah framework/proxy bisa menangani kasus tersebut.

---

## 12. Unused Bean Removal: Optimisasi yang Mengubah Cara Berpikir

### 12.1 Masalah Metadata Bloat

Container CDI tradisional sering menyimpan metadata untuk semua bean yang ditemukan. Quarkus memilih untuk membuang bean yang dianggap tidak dipakai saat build.

Manfaat:

- startup lebih cepat,
- memory lebih kecil,
- native image lebih kecil,
- dependency graph lebih bersih,
- accidental classpath bean lebih sedikit.

### 12.2 Apa Itu “Unused”?

Secara konseptual, bean dianggap unused jika:

- tidak diinjeksi oleh bean lain,
- tidak menjadi observer penting,
- tidak diekspos sebagai entry point,
- tidak dipakai oleh extension/runtime integration,
- tidak ditandai unremovable,
- tidak punya path reachability dari root graph.

Contoh:

```java
@ApplicationScoped
public class LegacyReportGenerator {
    public void generate() {
    }
}
```

Jika tidak pernah diinjeksi, tidak punya observer, dan tidak menjadi endpoint/resource, bean ini bisa dihapus.

### 12.3 Ketika Removal Menjadi Masalah

Masalah muncul jika kamu mengakses bean secara dinamis:

```java
CDI.current().select(beanClass).get();
```

atau class name dari config:

```java
String impl = config.strategyClass();
Class<?> clazz = Class.forName(impl);
```

Arc mungkin tidak bisa melihat dependency itu saat build, sehingga bean dianggap tidak dipakai.

Solusi:

- buat injection eksplisit,
- gunakan `Instance<T>` dengan qualifier/type yang jelas,
- gunakan `@Unremovable` jika memang perlu,
- daftarkan via extension build item,
- hindari dynamic class lookup sebagai desain utama.

### 12.4 `@Unremovable`

```java
@Unremovable
@ApplicationScoped
public class RuntimeSelectedStrategy implements CaseStrategy {
}
```

Gunakan hemat. Kalau terlalu banyak `@Unremovable`, kamu melawan optimisasi Quarkus.

Rule:

> `@Unremovable` adalah escape hatch, bukan default annotation.

---

## 13. `Instance<T>` dan Dynamic Selection yang Masih Terkontrol

### 13.1 Kapan Perlu `Instance<T>`?

Kadang kita butuh memilih salah satu dari beberapa implementation saat runtime.

```java
@ApplicationScoped
public class NotificationRouter {

    private final Instance<NotificationSender> senders;

    @Inject
    public NotificationRouter(Instance<NotificationSender> senders) {
        this.senders = senders;
    }

    public void route(Notification notification) {
        for (NotificationSender sender : senders) {
            if (sender.supports(notification.channel())) {
                sender.send(notification);
                return;
            }
        }
        throw new IllegalStateException("No sender for channel " + notification.channel());
    }
}
```

Ini lebih baik daripada class name reflection karena:

- semua implementation tetap CDI bean,
- Arc bisa melihat graph,
- testing lebih mudah,
- native image lebih aman.

### 13.2 Jangan Membuat Service Locator Baru

`Instance<T>` bisa disalahgunakan menjadi service locator:

```java
public Object find(String name) {
    return instance.select(toQualifier(name)).get();
}
```

Jika semua logic bergantung pada lookup string runtime, dependency graph menjadi sulit dibaca.

Gunakan untuk plugin-like strategy yang memang perlu enumerasi implementasi, bukan untuk menyembunyikan dependency.

---

## 14. Circular Dependency: Bau Desain yang Sering Terlihat di CDI

### 14.1 Contoh Buruk

```java
@ApplicationScoped
public class CaseService {
    @Inject AssignmentService assignmentService;
}

@ApplicationScoped
public class AssignmentService {
    @Inject CaseService caseService;
}
```

Masalah:

- boundary kabur,
- sulit test,
- lifecycle/proxy rumit,
- transaction boundary membingungkan,
- domain responsibility tercampur.

### 14.2 Cara Memecah

Biasanya circular dependency menunjukkan ada abstraction yang hilang:

```text
CaseService <--> AssignmentService
       |
       v
Perlu dipisahkan menjadi:

CaseRepository
CasePolicy
AssignmentPolicy
CaseWorkflowOrchestrator
DomainEventPublisher
```

Contoh refactor:

```java
@ApplicationScoped
public class CaseWorkflowService {

    private final CaseRepository caseRepository;
    private final AssignmentPolicy assignmentPolicy;
    private final CaseTransitionPolicy transitionPolicy;

    @Inject
    public CaseWorkflowService(
            CaseRepository caseRepository,
            AssignmentPolicy assignmentPolicy,
            CaseTransitionPolicy transitionPolicy) {
        this.caseRepository = caseRepository;
        this.assignmentPolicy = assignmentPolicy;
        this.transitionPolicy = transitionPolicy;
    }
}
```

Rule:

> Kalau dua service saling membutuhkan, kemungkinan besar kamu belum menemukan boundary yang benar.

---

## 15. CDI dan Transaction Boundary

Quarkus transaction biasanya dijalankan via interceptor CDI seperti `@Transactional`.

```java
@ApplicationScoped
public class CaseSubmissionService {

    @Transactional
    public void submit(SubmitCaseCommand command) {
        // load aggregate
        // validate transition
        // persist changes
        // write outbox record
    }
}
```

Poin penting:

- `@Transactional` adalah boundary application service, bukan annotation untuk semua method.
- Hindari transaction terlalu panjang.
- Jangan lakukan remote call lambat di dalam transaction kecuali sangat sadar konsekuensi lock/timeouts.
- Self-invocation bisa membuat transaction tidak aktif.
- Reactive transaction punya model berbeda dan akan dibahas lebih lanjut di part persistence/transaction.

Boundary yang bagus:

```text
REST Resource
   -> Application Service @Transactional
      -> Repository
      -> Domain Policy
      -> Outbox Writer
```

Boundary yang buruk:

```text
REST Resource @Transactional
   -> Service A @Transactional
      -> Remote API call
      -> Service B @Transactional
         -> Kafka publish directly
```

Masalah:

- transaction ownership tidak jelas,
- remote call memperpanjang DB lock,
- Kafka publish belum tentu konsisten dengan DB commit,
- retry bisa menghasilkan double side effect.

---

## 16. CDI dan Security Boundary

Security sering masuk via CDI:

- `SecurityIdentity` diinjeksi,
- permission checker adalah bean,
- custom authorizer adalah bean,
- security interceptor memakai CDI.

Contoh:

```java
@ApplicationScoped
public class CurrentUser {

    private final SecurityIdentity identity;

    @Inject
    public CurrentUser(SecurityIdentity identity) {
        this.identity = identity;
    }

    public String userId() {
        return identity.getPrincipal().getName();
    }

    public boolean hasRole(String role) {
        return identity.hasRole(role);
    }
}
```

Tetapi jangan menjadikan technical identity sebagai domain authorization final.

Lebih baik:

```java
@ApplicationScoped
public class CaseAuthorizationPolicy {

    public void assertCanView(CurrentUser user, CaseRecord record) {
        if (!record.isAssignedTo(user.userId()) && !user.hasRole("case-admin")) {
            throw new ForbiddenException("User cannot view this case");
        }
    }
}
```

CDI membantu wiring, tetapi domain authorization tetap harus eksplisit dan testable.

---

## 17. CDI dan Config Injection

Config sering diinjeksi ke bean.

```java
@ApplicationScoped
public class DeadlinePolicy {

    private final int defaultDays;

    public DeadlinePolicy(@ConfigProperty(name = "case.deadline.default-days") int defaultDays) {
        this.defaultDays = defaultDays;
    }
}
```

Untuk config yang kompleks, prefer `@ConfigMapping`:

```java
@ConfigMapping(prefix = "case.deadline")
public interface DeadlineConfig {
    int defaultDays();
    int escalationWarningDays();
}
```

```java
@ApplicationScoped
public class DeadlinePolicy {

    private final DeadlineConfig config;

    @Inject
    public DeadlinePolicy(DeadlineConfig config) {
        this.config = config;
    }
}
```

Rule:

- simple scalar: `@ConfigProperty` masih oke,
- grouped config: `@ConfigMapping`,
- secret: jangan log,
- build-time config: jangan mengira bisa diganti runtime,
- config decision yang mempengaruhi bean graph harus dipahami sebagai build-time concern.

---

## 18. CDI dan Native Image

### 18.1 Kenapa Arc Cocok untuk Native Image?

Native image menggunakan closed-world assumption. Program harus bisa dianalisis secara statis. CDI tradisional yang banyak reflection/dynamic discovery sulit untuk itu.

Arc membantu karena:

- bean discovery build-time,
- injection point build-time validation,
- metadata minimal,
- unused bean removal,
- generated code,
- extension dapat mendaftarkan reflection/resource/proxy metadata.

### 18.2 Pola yang Native-Friendly

Native-friendly:

```java
@ApplicationScoped
public class ExplicitService {
    private final ExplicitDependency dependency;

    @Inject
    public ExplicitService(ExplicitDependency dependency) {
        this.dependency = dependency;
    }
}
```

Native-hostile:

```java
Object service = Class.forName(config.className())
        .getDeclaredConstructor()
        .newInstance();
```

Native-friendly strategy selection:

```java
@ApplicationScoped
public class StrategyRegistry {

    private final List<CaseStrategy> strategies;

    @Inject
    public StrategyRegistry(Instance<CaseStrategy> strategies) {
        this.strategies = StreamSupport
                .stream(strategies.spliterator(), false)
                .toList();
    }
}
```

### 18.3 Native Image Design Rule

> Jika dependency relation tidak bisa dijelaskan secara statis, Quarkus/GraalVM mungkin tidak bisa mengoptimalkannya dengan aman.

---

## 19. Build-Time CDI Integration dan Extension

### 19.1 Arc Bootstrapping Phases

Secara high-level, Arc bootstrapping melibatkan:

1. Initialization.
2. Bean discovery.
3. Synthetic component registration.
4. Validation.

Extension dapat berkontribusi pada fase ini.

### 19.2 Additional Bean

Extension dapat menambahkan bean yang tidak ditemukan otomatis.

Konsep:

```java
@BuildStep
AdditionalBeanBuildItem additionalBeans() {
    return AdditionalBeanBuildItem.builder()
            .addBeanClass(MyRuntimeBean.class)
            .setUnremovable()
            .build();
}
```

Ini berguna ketika:

- runtime module punya class yang harus menjadi bean,
- library class tidak memiliki bean defining annotation,
- extension ingin menyediakan default service.

### 19.3 Synthetic Bean

Synthetic bean adalah bean yang tidak berasal langsung dari class biasa, tetapi dibuat oleh extension saat build.

Kegunaan:

- client generated dari config,
- service factory khusus,
- runtime object yang construction-nya direkam oleh recorder,
- integration resource.

### 19.4 Kenapa Ini Penting untuk Engineer Aplikasi?

Walau kamu bukan pembuat extension setiap hari, memahami mekanisme ini membantu saat:

- membaca error build Quarkus,
- debug missing bean,
- memahami kenapa extension tertentu punya behavior aneh,
- membuat platform internal,
- menstandardisasi audit/security/client/logging untuk banyak service.

---

## 20. CDI di Multi-Module Project

### 20.1 Masalah Indexing

Dalam multi-module project, class di module lain mungkin tidak otomatis terindeks sebagai bean jika Jandex index tidak tersedia.

Contoh struktur:

```text
case-service/
  app/
  domain/
  application/
  infrastructure/
  shared-kernel/
```

Jika `domain` atau `application` berisi CDI bean, pastikan module tersebut terindeks.

Quarkus Maven tooling merekomendasikan penggunaan `jandex-maven-plugin` untuk module yang perlu CDI bean discovery jika bukan main application module.

### 20.2 Design Recommendation

Jangan semua module harus CDI-aware.

Pisahkan:

```text
Domain module:
  - pure Java
  - no CDI if possible
  - business rules
  - value objects
  - aggregate logic

Application module:
  - CDI services
  - transaction boundary
  - orchestration

Infrastructure module:
  - CDI adapters
  - database/client/messaging

App module:
  - Quarkus bootstrap
  - REST resources
  - config
```

Ini membuat domain tetap portable dan mudah dites.

### 20.3 Bad Multi-Module Pattern

```text
shared-common/
  CommonService
  CommonRepository
  CommonMapper
  CommonSecurityUtil
  CommonEverything
```

Masalah:

- dependency graph tidak jelas,
- semua service tergantung shared-common,
- unused bean removal bisa membingungkan,
- upgrade sulit,
- native image metadata membesar,
- hidden coupling.

Lebih baik shared module kecil dan semantic:

```text
shared-error-contract
shared-observability-contract
shared-security-principal
shared-test-support
```

---

## 21. Designing Dependency Graph untuk Enterprise Case Management

Untuk domain seperti regulatory case management, dependency graph harus mencerminkan boundary.

Contoh target architecture:

```text
REST Resource
  -> Command Handler / Application Service
      -> Current User Provider
      -> Case Repository
      -> Case Transition Policy
      -> Authorization Policy
      -> Assignment Policy
      -> Deadline Policy
      -> Audit Event Writer
      -> Outbox Writer
```

### 21.1 Resource Layer

```java
@Path("/cases")
@ApplicationScoped
public class CaseResource {

    private final SubmitCaseHandler submitCaseHandler;

    @Inject
    public CaseResource(SubmitCaseHandler submitCaseHandler) {
        this.submitCaseHandler = submitCaseHandler;
    }

    @POST
    public Response submit(SubmitCaseRequest request) {
        SubmitCaseResult result = submitCaseHandler.handle(request.toCommand());
        return Response.status(Response.Status.CREATED).entity(result).build();
    }
}
```

Resource hanya:

- HTTP mapping,
- request parsing,
- response construction,
- tidak menyimpan business workflow.

### 21.2 Application Service

```java
@ApplicationScoped
public class SubmitCaseHandler {

    private final CurrentUser currentUser;
    private final CaseRepository caseRepository;
    private final CaseTransitionPolicy transitionPolicy;
    private final CaseAuthorizationPolicy authorizationPolicy;
    private final AuditEventWriter auditEventWriter;
    private final OutboxWriter outboxWriter;

    @Inject
    public SubmitCaseHandler(
            CurrentUser currentUser,
            CaseRepository caseRepository,
            CaseTransitionPolicy transitionPolicy,
            CaseAuthorizationPolicy authorizationPolicy,
            AuditEventWriter auditEventWriter,
            OutboxWriter outboxWriter) {
        this.currentUser = currentUser;
        this.caseRepository = caseRepository;
        this.transitionPolicy = transitionPolicy;
        this.authorizationPolicy = authorizationPolicy;
        this.auditEventWriter = auditEventWriter;
        this.outboxWriter = outboxWriter;
    }

    @Transactional
    public SubmitCaseResult handle(SubmitCaseCommand command) {
        UserActor actor = currentUser.actor();

        CaseRecord record = CaseRecord.draft(command.caseData());
        authorizationPolicy.assertCanSubmit(actor, record);
        transitionPolicy.assertCanTransition(record, CaseStatus.SUBMITTED);

        record.submit(actor.userId());
        caseRepository.persist(record);

        auditEventWriter.write(AuditEvent.caseSubmitted(record.id(), actor.userId()));
        outboxWriter.write(IntegrationEvent.caseSubmitted(record.id()));

        return new SubmitCaseResult(record.id());
    }
}
```

Graph ini jelas:

- transaction boundary di handler,
- authorization eksplisit,
- transition eksplisit,
- audit/outbox eksplisit,
- resource tipis,
- repository infrastructure terisolasi.

### 21.3 Policy Beans

```java
@ApplicationScoped
public class CaseTransitionPolicy {

    public void assertCanTransition(CaseRecord record, CaseStatus targetStatus) {
        if (!record.canMoveTo(targetStatus)) {
            throw new InvalidCaseTransitionException(record.status(), targetStatus);
        }
    }
}
```

Policy stateless cocok menjadi `@ApplicationScoped`.

---

## 22. Failure Modes yang Harus Kamu Hafal

### 22.1 Unsatisfied Dependency

Gejala:

```text
Unsatisfied dependency for type X and qualifiers [@Default]
```

Penyebab umum:

- class tidak punya bean defining annotation,
- module tidak terindeks Jandex,
- dependency tidak ada di classpath,
- qualifier mismatch,
- bean removed as unused,
- conditional bean tidak aktif di profile tersebut.

Debug checklist:

1. Apakah class punya scope?
2. Apakah package/module masuk dependency aplikasi?
3. Apakah Jandex index tersedia untuk module tersebut?
4. Apakah qualifier sama persis?
5. Apakah bean conditional aktif?
6. Apakah ada extension yang seharusnya mendaftarkan bean?

### 22.2 Ambiguous Dependency

Gejala:

```text
Ambiguous dependencies for type X
```

Penyebab:

- lebih dari satu implementation,
- qualifier tidak cukup spesifik,
- producer dan class bean menghasilkan tipe sama,
- alternative aktif bersamaan.

Solusi:

- tambah qualifier semantic,
- pilih default dengan jelas,
- gunakan `Instance<T>` jika memang multiple strategy,
- hapus implementation yang tidak perlu,
- jangan pakai generic `@Named` string tanpa governance.

### 22.3 Context Not Active

Gejala:

```text
ContextNotActiveException
```

Penyebab:

- `@RequestScoped` bean dipakai di background job,
- async thread tidak membawa context,
- reactive pipeline kehilangan context,
- lifecycle event terlalu awal/terlambat.

Solusi:

- jangan inject request scoped bean ke job singleton tanpa batas jelas,
- ambil data request lalu passing value object,
- gunakan context propagation jika memang diperlukan,
- desain background process tanpa request scope.

### 22.4 Interceptor Tidak Jalan

Penyebab:

- self-invocation,
- method private/final,
- class tidak CDI-managed,
- annotation ditempatkan di method yang tidak dipanggil lewat proxy,
- interceptor tidak enabled/priority salah.

Solusi:

- pastikan call lewat CDI bean proxy,
- pindahkan boundary ke service berbeda,
- gunakan method public/package yang compatible,
- buat test khusus untuk boundary transaction/security.

### 22.5 Bean Dibuang oleh Unused Bean Removal

Penyebab:

- bean hanya dipakai via reflection/string lookup,
- extension tidak menandai unremovable,
- dynamic selection tidak terlihat oleh Arc.

Solusi:

- injection explicit,
- `Instance<T>` typed,
- `@Unremovable` hemat,
- extension build item.

---

## 23. Design Anti-Patterns

### 23.1 “Everything is ApplicationScoped Service”

Semua class diberi `@ApplicationScoped`:

```text
DtoMapper
EntityMapper
StringUtil
DateUtil
DomainEntity
ValueObject
Repository
Policy
RandomHelper
```

Masalah:

- graph membesar,
- unused bean removal perlu bekerja lebih keras,
- domain model jadi framework-dependent,
- testing pure Java berkurang,
- semantic lifecycle hilang.

Rule:

> Jadikan CDI bean hanya untuk object yang memang butuh lifecycle/injection/interception/container integration.

### 23.2 “Inject Everything Everywhere”

Service terlalu banyak dependency:

```java
public BigService(A, B, C, D, E, F, G, H, I, J, K, L) { ... }
```

Biasanya ini tanda:

- service terlalu besar,
- responsibility kabur,
- orchestration bercampur dengan policy,
- perlu command handler terpisah,
- perlu aggregate boundary.

### 23.3 Static Access to CDI

```java
public static CaseService caseService() {
    return CDI.current().select(CaseService.class).get();
}
```

Masalah:

- service locator,
- hidden dependency,
- test sulit,
- build-time reachability kabur,
- native image risk.

Gunakan injection eksplisit.

### 23.4 Business Logic dalam Producer

Producer seharusnya construction, bukan workflow.

Buruk:

```java
@Produces
CaseAssignmentPolicy policy() {
    // query database
    // call remote API
    // calculate current workload
    // choose policy dynamically
}
```

Producer dipanggil untuk membuat bean, bukan untuk menjalankan business decision.

### 23.5 Interceptor untuk Domain Workflow

Interceptor bagus untuk technical cross-cutting. Jangan sembunyikan business state transition di dalam interceptor.

---

## 24. Production Checklist untuk CDI/Arc

Gunakan checklist ini saat review Quarkus service.

### 24.1 Bean Graph

- [ ] Semua CDI bean punya scope yang tepat.
- [ ] Constructor injection dipakai untuk service penting.
- [ ] Tidak ada circular dependency.
- [ ] Tidak ada service dengan dependency terlalu banyak tanpa alasan kuat.
- [ ] Domain object/value object tidak perlu menjadi CDI bean.
- [ ] Shared module tidak menciptakan hidden graph besar.

### 24.2 Scope Safety

- [ ] `@ApplicationScoped` bean stateless atau thread-safe.
- [ ] Tidak ada request/user state disimpan di application scoped field.
- [ ] `@RequestScoped` tidak bocor ke background job.
- [ ] Resource berat punya lifecycle cleanup.

### 24.3 Qualifier and Selection

- [ ] Multiple implementation diselesaikan dengan qualifier semantic.
- [ ] Tidak ada ambiguity tersembunyi.
- [ ] `Instance<T>` digunakan hanya untuk strategy/plugin pattern yang jelas.
- [ ] Tidak ada class-name reflection untuk memilih implementation.

### 24.4 Interceptor

- [ ] Transaction boundary jelas.
- [ ] Security boundary jelas.
- [ ] Tidak mengandalkan self-invocation.
- [ ] Domain rule kompleks tetap eksplisit.
- [ ] Interceptor punya test minimal.

### 24.5 Native Readiness

- [ ] Tidak ada dynamic classloading tanpa metadata.
- [ ] Third-party object dibuat via producer/extension yang jelas.
- [ ] Bean yang perlu dipertahankan tidak bergantung pada accidental reachability.
- [ ] Reflection usage diisolasi dan terdaftar jika perlu.

### 24.6 Multi-Module

- [ ] Module berisi bean punya Jandex index jika perlu.
- [ ] Domain module tetap pure jika memungkinkan.
- [ ] Infrastructure adapters menjadi CDI bean, bukan domain model.
- [ ] Shared libraries tidak membawa terlalu banyak transitive dependency.

---

## 25. Step-by-Step Mini Implementation

Kita buat contoh kecil yang menunjukkan CDI graph sehat.

### 25.1 Domain Model Pure Java

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    APPROVED,
    REJECTED
}
```

```java
public class CaseRecord {
    private final String id;
    private CaseStatus status;
    private String submittedBy;

    private CaseRecord(String id, CaseStatus status) {
        this.id = id;
        this.status = status;
    }

    public static CaseRecord draft(String id) {
        return new CaseRecord(id, CaseStatus.DRAFT);
    }

    public void submit(String userId) {
        if (status != CaseStatus.DRAFT) {
            throw new IllegalStateException("Only draft case can be submitted");
        }
        this.status = CaseStatus.SUBMITTED;
        this.submittedBy = userId;
    }

    public String id() {
        return id;
    }

    public CaseStatus status() {
        return status;
    }
}
```

Tidak ada CDI annotation di domain object.

### 25.2 Repository Port

```java
public interface CaseRepository {
    void persist(CaseRecord record);
    Optional<CaseRecord> findById(String id);
}
```

Pure interface.

### 25.3 Infrastructure Adapter as CDI Bean

```java
@ApplicationScoped
public class JpaCaseRepository implements CaseRepository {

    @Override
    public void persist(CaseRecord record) {
        // map domain to entity and persist
    }

    @Override
    public Optional<CaseRecord> findById(String id) {
        // load entity and map to domain
        return Optional.empty();
    }
}
```

### 25.4 Policy Bean

```java
@ApplicationScoped
public class CaseSubmissionPolicy {

    public void assertCanSubmit(UserActor actor, CaseRecord record) {
        if (!actor.hasPermission("case:submit")) {
            throw new ForbiddenException("User cannot submit case");
        }
        if (record.status() != CaseStatus.DRAFT) {
            throw new IllegalStateException("Only draft case can be submitted");
        }
    }
}
```

### 25.5 Current User Adapter

```java
@ApplicationScoped
public class CurrentUserProvider {

    private final SecurityIdentity identity;

    @Inject
    public CurrentUserProvider(SecurityIdentity identity) {
        this.identity = identity;
    }

    public UserActor currentActor() {
        return new UserActor(
                identity.getPrincipal().getName(),
                identity.getRoles()
        );
    }
}
```

### 25.6 Application Service

```java
@ApplicationScoped
public class SubmitCaseHandler {

    private final CurrentUserProvider currentUserProvider;
    private final CaseRepository caseRepository;
    private final CaseSubmissionPolicy submissionPolicy;
    private final AuditWriter auditWriter;

    @Inject
    public SubmitCaseHandler(
            CurrentUserProvider currentUserProvider,
            CaseRepository caseRepository,
            CaseSubmissionPolicy submissionPolicy,
            AuditWriter auditWriter) {
        this.currentUserProvider = currentUserProvider;
        this.caseRepository = caseRepository;
        this.submissionPolicy = submissionPolicy;
        this.auditWriter = auditWriter;
    }

    @Transactional
    public SubmitCaseResult handle(SubmitCaseCommand command) {
        UserActor actor = currentUserProvider.currentActor();
        CaseRecord record = CaseRecord.draft(command.caseId());

        submissionPolicy.assertCanSubmit(actor, record);
        record.submit(actor.userId());

        caseRepository.persist(record);
        auditWriter.write(AuditEvent.caseSubmitted(record.id(), actor.userId()));

        return new SubmitCaseResult(record.id());
    }
}
```

### 25.7 REST Resource

```java
@Path("/cases")
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
@ApplicationScoped
public class CaseResource {

    private final SubmitCaseHandler submitCaseHandler;

    @Inject
    public CaseResource(SubmitCaseHandler submitCaseHandler) {
        this.submitCaseHandler = submitCaseHandler;
    }

    @POST
    public Response submit(SubmitCaseRequest request) {
        SubmitCaseResult result = submitCaseHandler.handle(request.toCommand());
        return Response.status(Response.Status.CREATED).entity(result).build();
    }
}
```

Dependency graph:

```text
CaseResource
  -> SubmitCaseHandler
      -> CurrentUserProvider
          -> SecurityIdentity
      -> CaseRepository
          -> JpaCaseRepository
      -> CaseSubmissionPolicy
      -> AuditWriter
```

Ini adalah graph yang:

- explicit,
- testable,
- CDI-friendly,
- native-friendly,
- transaction boundary jelas,
- domain tetap relatif bersih.

---

## 26. Testing Implication

Karena constructor injection dipakai, banyak class bisa dites tanpa Quarkus:

```java
class SubmitCaseHandlerTest {

    @Test
    void shouldSubmitDraftCase() {
        CurrentUserProvider currentUser = new StubCurrentUserProvider("officer-1");
        CaseRepository repository = new InMemoryCaseRepository();
        CaseSubmissionPolicy policy = new CaseSubmissionPolicy();
        AuditWriter auditWriter = new InMemoryAuditWriter();

        SubmitCaseHandler handler = new SubmitCaseHandler(
                currentUser,
                repository,
                policy,
                auditWriter
        );

        SubmitCaseResult result = handler.handle(new SubmitCaseCommand("CASE-1"));

        assertEquals("CASE-1", result.caseId());
    }
}
```

Untuk test yang butuh container:

```java
@QuarkusTest
class CaseResourceTest {

    @Test
    void submitShouldReturnCreated() {
        given()
            .contentType(ContentType.JSON)
            .body("{\"caseId\":\"CASE-1\"}")
        .when()
            .post("/cases")
        .then()
            .statusCode(201);
    }
}
```

Rule:

> Jangan semua test menjadi `@QuarkusTest`. Gunakan Quarkus test untuk wiring/integration, gunakan plain unit test untuk domain/application rule jika memungkinkan.

---

## 27. Advanced Review: CDI Graph as Architecture Diagram

Untuk sistem besar, kamu bisa membaca arsitektur dari CDI graph.

Jika graph terlihat seperti ini:

```text
Resource -> Service -> Repository
                 -> OtherService
                 -> AnotherService
                 -> EmailService
                 -> KafkaProducer
                 -> ExternalClient
                 -> AuditService
                 -> SecurityService
                 -> ReportService
```

Ada kemungkinan service terlalu besar.

Graph yang lebih sehat:

```text
Resource
  -> CommandHandler
      -> DomainPolicy
      -> Repository
      -> OutboxWriter
      -> AuditWriter

OutboxPublisherJob
  -> OutboxRepository
  -> MessagePublisher

NotificationHandler
  -> NotificationPolicy
  -> NotificationSender
```

Top 1% engineer tidak hanya bertanya:

> “Bisa diinjeksi atau tidak?”

Tetapi bertanya:

> “Apakah dependency graph ini mencerminkan boundary sistem yang benar?”

---

## 28. Ringkasan Invariants

Pegang invariants berikut:

1. **CDI di Quarkus adalah build-time dependency graph.**
2. **Bean harus eksplisit, reachable, dan valid saat build.**
3. **`@ApplicationScoped` adalah default service stateless, bukan tempat menyimpan request state.**
4. **Constructor injection memperjelas invariant dependency.**
5. **Qualifier harus semantic, bukan sekadar teknis.**
6. **Producer harus deterministic dan construction-focused.**
7. **Interceptor cocok untuk cross-cutting concern, bukan domain workflow kompleks.**
8. **CDI event adalah in-process event, bukan distributed messaging.**
9. **Unused bean removal adalah fitur, bukan gangguan.**
10. **Dynamic reflection/classloading melawan filosofi Quarkus dan native image.**
11. **Multi-module Quarkus butuh perhatian pada Jandex/indexing.**
12. **Dependency graph adalah bentuk nyata arsitektur aplikasi.**

---

## 29. Latihan untuk Mencapai Level Advanced

### Latihan 1 — Bean Graph Audit

Ambil satu service Quarkus nyata. Buat daftar:

```text
Bean -> Dependencies -> Scope -> Reason
```

Contoh:

```text
SubmitCaseHandler
  Scope: ApplicationScoped
  Dependencies:
    - CurrentUserProvider
    - CaseRepository
    - CaseSubmissionPolicy
    - AuditWriter
  Reason:
    - Transactional application boundary for submit command
```

Cari:

- dependency terlalu banyak,
- circular dependency,
- service locator,
- hidden static access,
- request state di singleton/application bean.

### Latihan 2 — Qualifier Refactor

Buat tiga implementation dari `NotificationSender`:

- email,
- SMS,
- in-app.

Implementasikan:

1. qualifier-based injection,
2. `Instance<NotificationSender>` strategy registry,
3. unit test selection.

Bandingkan mana yang lebih cocok untuk:

- fixed channel,
- runtime selected channel,
- tenant-specific channel.

### Latihan 3 — Interceptor Boundary Test

Buat custom interceptor `@AuditedAction`.

Validasi:

- jalan ketika method dipanggil dari resource,
- tidak jalan pada self-invocation,
- berjalan pada public method CDI bean,
- menghasilkan structured audit event.

Tuliskan conclusion desainnya.

### Latihan 4 — Native-Friendly Refactor

Ambil pola reflection:

```java
Class.forName(config.strategyClass())
```

Refactor menjadi:

- CDI strategy beans,
- qualifier atau `Instance<T>`,
- registry eksplisit,
- fallback behavior.

### Latihan 5 — Multi-Module Indexing

Buat project multi-module:

```text
app
application
infrastructure
shared
```

Letakkan CDI bean di `application`. Pastikan bean ditemukan Quarkus. Tambahkan Jandex plugin jika perlu. Dokumentasikan error sebelum dan sesudah.

---

## 30. Penutup Part 007

Part ini seharusnya mengubah cara kamu melihat CDI di Quarkus.

CDI bukan lagi sekadar:

```java
@Inject
MyService service;
```

CDI di Quarkus adalah:

```text
Build-time dependency graph
+ scope lifecycle
+ interceptor boundary
+ config integration
+ native-image reachability
+ extension augmentation
+ production architecture signal
```

Jika kamu menguasai Arc, kamu akan jauh lebih mudah memahami part berikutnya:

- REST resource lifecycle,
- transaction interceptor,
- security identity,
- messaging handler,
- scheduled job,
- native image failure,
- custom extension,
- testing container,
- production startup behavior.

---

# Status Seri

- Part 007 selesai.
- Seri belum selesai / belum mencapai bagian terakhir.
- Berikutnya: **Part 008 — REST Layer Deep Dive: Quarkus REST, RESTEasy Reactive, Routing, Filters, Exception Mapping**.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-006.md">⬅️ Part 006 — Configuration Architecture: SmallRye Config, Profiles, Secrets, Runtime vs Build-Time Properties</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-008.md">Part 008 — REST Layer Deep Dive: Quarkus REST, RESTEasy Reactive, Routing, Filters, Exception Mapping ➡️</a>
</div>
