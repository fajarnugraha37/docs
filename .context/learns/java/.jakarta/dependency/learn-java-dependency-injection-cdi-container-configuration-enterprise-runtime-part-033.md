# Part 033 — Architecture Patterns for Enterprise Java Runtime Design

> Seri: `learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime`  
> Bagian: `033`  
> Topik: **Architecture Patterns for Enterprise Java Runtime Design**  
> Target: Java 8–25, Java EE `javax.*`, Jakarta EE `jakarta.*`, CDI, Enterprise Beans, MicroProfile Config, runtime/container model

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membangun fondasi dari bawah:

1. dependency management,
2. API/SPI/implementation/provider,
3. migrasi `javax.*` ke `jakarta.*`,
4. runtime/container ownership,
5. classloader dan isolation,
6. dependency injection,
7. Jakarta Inject,
8. CDI bean model,
9. bean discovery,
10. scope,
11. proxy,
12. qualifier/alternative,
13. producer/disposer,
14. event,
15. interceptor,
16. decorator,
17. stereotype,
18. lifecycle callback,
19. CDI extension,
20. Enterprise Beans,
21. pooling semantics,
22. EJB transaction/timer/async/security,
23. common annotations/resource injection,
24. JNDI/resource naming,
25. configuration fundamentals,
26. MicroProfile Config,
27. profiles,
28. feature flags,
29. conditional beans,
30. container concurrency/context propagation,
31. testing,
32. observability/debugging.

Part ini naik satu level: **bagaimana semua mekanisme runtime tersebut dipakai untuk mendesain arsitektur aplikasi enterprise yang bersih, eksplisit, bisa dites, bisa dioperasikan, dan bisa diaudit**.

Dengan kata lain:

```text
Part 000–032 = memahami building blocks runtime
Part 033     = menyusun building blocks menjadi architecture pattern
```

Part ini bukan mengulang DDD, clean architecture, hexagonal architecture, atau layered architecture secara umum. Fokusnya lebih spesifik:

> Bagaimana arsitektur enterprise Java seharusnya menempatkan CDI, container, configuration, transaction, interceptor, decorator, events, feature flags, dan resource boundary.

---

## 1. Core Question

Pertanyaan utama part ini:

> Bagaimana mendesain aplikasi enterprise Java yang memakai CDI/Jakarta runtime tanpa membiarkan container annotation, framework detail, configuration, transaction, dan resource integration mengotori seluruh domain model?

Masalah nyata di banyak aplikasi enterprise bukan karena CDI/EJB/Jakarta buruk. Masalahnya sering karena **runtime concern tersebar ke seluruh codebase tanpa boundary jelas**.

Contoh gejala:

```java
@RequestScoped
@Path("/cases")
@Transactional
public class CaseResource {

    @Inject EntityManager em;
    @Inject Config config;
    @Inject AuditService audit;
    @Inject FeatureFlagService flags;
    @Resource DataSource ds;

    @POST
    public Response approve(CaseApprovalRequest req) {
        if (flags.enabled("new.approval.flow")) {
            // business rule, transaction rule, audit rule,
            // config rule, persistence rule, and API response rule mixed here
        }
    }
}
```

Kode seperti ini mungkin jalan. Tetapi secara arsitektur ia berbahaya karena:

- HTTP boundary tahu terlalu banyak tentang persistence,
- business decision bercampur dengan feature flag detail,
- transaction boundary tidak punya nama arsitektural,
- audit dipanggil secara manual dan mudah lupa,
- config diakses secara bebas,
- testing menjadi berat,
- perubahan runtime dapat merembet ke business logic,
- observability sulit distandarkan,
- compliance sulit dibuktikan.

Target kita adalah mengubah runtime dari “annotation scattered everywhere” menjadi “explicit runtime architecture”.

---

## 2. Mental Model: Runtime Architecture Is Ownership Architecture

Arsitektur enterprise Java bukan hanya soal package structure. Ia adalah soal **ownership**:

| Concern | Pertanyaan ownership |
|---|---|
| Object creation | Siapa membuat object? Developer atau container? |
| Lifecycle | Siapa menghancurkan object? Kapan? |
| Dependency | Siapa memilih implementation? Berdasarkan apa? |
| Transaction | Siapa membuka, commit, rollback? Di boundary mana? |
| Security | Siapa memvalidasi caller dan role? |
| Configuration | Siapa membaca config? Apakah fail-fast? |
| Feature flag | Siapa boleh membuat runtime decision? |
| Audit | Siapa memastikan audit tidak lupa? |
| Persistence | Siapa boleh bicara ke database? |
| External system | Siapa boleh bicara ke remote API? |
| Context | Siapa membawa request/security/correlation context? |
| Threading | Siapa boleh membuat task async? |

Top engineer tidak hanya bertanya:

```text
Annotation apa yang harus dipakai?
```

Ia bertanya:

```text
Boundary mana yang memiliki responsibility ini?
Apa invariant-nya?
Apa failure mode-nya?
Bagaimana dites?
Bagaimana diobservasi?
Apa konsekuensi kalau config/flag/container berubah?
```

---

## 3. The Runtime Boundary Stack

Aplikasi enterprise Java yang sehat biasanya punya stack boundary seperti ini:

```text
┌───────────────────────────────────────────────────────────────┐
│ External Clients                                               │
│ browser, mobile, partner system, scheduler, message broker     │
└───────────────────────────────┬───────────────────────────────┘
                                │
┌───────────────────────────────▼───────────────────────────────┐
│ Transport Boundary                                             │
│ JAX-RS resource, servlet, message listener, scheduled endpoint │
└───────────────────────────────┬───────────────────────────────┘
                                │ DTO / command
┌───────────────────────────────▼───────────────────────────────┐
│ Application Boundary                                           │
│ use case service, transaction boundary, authorization boundary │
└───────────────────────────────┬───────────────────────────────┘
                                │ domain command/result
┌───────────────────────────────▼───────────────────────────────┐
│ Domain Core                                                    │
│ entity, aggregate, policy, domain service, state machine       │
└───────────────────────────────┬───────────────────────────────┘
                                │ port/interface
┌───────────────────────────────▼───────────────────────────────┐
│ Infrastructure Adapter                                         │
│ JPA repository, REST client, messaging adapter, storage, audit │
└───────────────────────────────┬───────────────────────────────┘
                                │
┌───────────────────────────────▼───────────────────────────────┐
│ Platform / Container Services                                  │
│ CDI, transaction, security, config, JNDI, datasource, executor │
└───────────────────────────────────────────────────────────────┘
```

Kunci desainnya:

- Transport boundary boleh tahu HTTP/message/scheduler.
- Application boundary boleh tahu transaction dan use case orchestration.
- Domain core tidak bergantung pada CDI/Jakarta annotation sebisa mungkin.
- Infrastructure adapter boleh tahu JPA, HTTP client, JMS, datasource, remote API.
- Platform services dibungkus lewat adapter/producer/config boundary.

---

## 4. Pattern 1 — Layered Architecture with Runtime-Conscious Boundaries

Layered architecture klasik:

```text
Controller → Service → Repository → Database
```

Di enterprise Java, ini sering terlalu dangkal. Lebih baik dibuat runtime-conscious:

```text
Resource / Listener / Job
        ↓
Application Use Case
        ↓
Domain Model / Domain Policy
        ↓
Ports
        ↓
Infrastructure Adapters
```

### 4.1 Package Structure

Contoh struktur:

```text
com.acme.caseapp
├── api
│   ├── rest
│   ├── dto
│   └── mapper
├── application
│   ├── usecase
│   ├── command
│   ├── result
│   └── boundary
├── domain
│   ├── model
│   ├── policy
│   ├── event
│   └── state
├── port
│   ├── persistence
│   ├── audit
│   ├── notification
│   ├── identity
│   └── featureflag
├── infrastructure
│   ├── persistence
│   ├── audit
│   ├── notification
│   ├── identity
│   ├── config
│   └── featureflag
└── runtime
    ├── producer
    ├── qualifier
    ├── interceptor
    ├── decorator
    ├── stereotype
    └── extension
```

Pemisahan ini bukan cosmetic. Ia memberi aturan dependency:

```text
api              → application
application      → domain + port
domain           → nothing runtime-specific
infrastructure   → port + platform libraries
runtime          → platform integration glue
```

### 4.2 Contoh Salah

```java
// Domain object bergantung pada CDI dan config runtime.
@ApplicationScoped
public class CasePolicy {

    @Inject
    @ConfigProperty(name = "case.max.approval.amount")
    long maxApprovalAmount;

    public boolean canApprove(Case c) {
        return c.amount() <= maxApprovalAmount;
    }
}
```

Masalah:

- Domain policy sulit dites tanpa CDI.
- Policy tidak eksplisit menerima parameter rule.
- Config menjadi hidden input.
- Perubahan runtime config langsung mengubah domain object.

### 4.3 Contoh Lebih Baik

```java
public final class ApprovalLimitPolicy {

    private final Money maxApprovalAmount;

    public ApprovalLimitPolicy(Money maxApprovalAmount) {
        this.maxApprovalAmount = Objects.requireNonNull(maxApprovalAmount);
    }

    public boolean canApprove(CaseFile caseFile) {
        return caseFile.requestedAmount().isLessThanOrEqual(maxApprovalAmount);
    }
}
```

Lalu runtime boundary menyediakan policy:

```java
@ApplicationScoped
public class PolicyProducer {

    @Inject
    CaseRuntimeConfig config;

    @Produces
    @ApplicationScoped
    public ApprovalLimitPolicy approvalLimitPolicy() {
        return new ApprovalLimitPolicy(config.maxApprovalAmount());
    }
}
```

Dengan ini:

- Domain tetap pure.
- Config tetap masuk melalui boundary jelas.
- Policy bisa dites sebagai pure object.
- Runtime wiring bisa dites terpisah.

---

## 5. Pattern 2 — Hexagonal Architecture with CDI Ports and Adapters

Hexagonal architecture sangat cocok dengan CDI karena CDI dapat melakukan binding interface → implementation secara type-safe.

### 5.1 Port sebagai Interface Stabil

```java
public interface CaseRepository {
    Optional<CaseFile> findById(CaseId id);
    void save(CaseFile caseFile);
}

public interface AuditPort {
    void record(AuditEntry entry);
}

public interface NotificationPort {
    void notifyCaseApproved(CaseApprovedNotification notification);
}
```

Application service bergantung pada port:

```java
@ApplicationScoped
public class ApproveCaseUseCase {

    private final CaseRepository cases;
    private final AuditPort audit;
    private final NotificationPort notifications;
    private final ApprovalPolicy approvalPolicy;

    @Inject
    public ApproveCaseUseCase(
            CaseRepository cases,
            AuditPort audit,
            NotificationPort notifications,
            ApprovalPolicy approvalPolicy) {
        this.cases = cases;
        this.audit = audit;
        this.notifications = notifications;
        this.approvalPolicy = approvalPolicy;
    }

    @Transactional
    public ApproveCaseResult approve(ApproveCaseCommand command) {
        CaseFile caseFile = cases.findById(command.caseId())
                .orElseThrow(() -> new CaseNotFoundException(command.caseId()));

        caseFile.approve(command.officerId(), approvalPolicy);

        cases.save(caseFile);
        audit.record(AuditEntry.caseApproved(caseFile.id(), command.officerId()));
        notifications.notifyCaseApproved(
                new CaseApprovedNotification(caseFile.id(), caseFile.ownerId()));

        return ApproveCaseResult.success(caseFile.id());
    }
}
```

Infrastructure adapter:

```java
@ApplicationScoped
public class JpaCaseRepository implements CaseRepository {

    @PersistenceContext
    EntityManager em;

    @Override
    public Optional<CaseFile> findById(CaseId id) {
        return Optional.ofNullable(em.find(CaseEntity.class, id.value()))
                .map(CaseEntityMapper::toDomain);
    }

    @Override
    public void save(CaseFile caseFile) {
        em.merge(CaseEntityMapper.toEntity(caseFile));
    }
}
```

### 5.2 Runtime Benefit

Dengan port/adapters:

- CDI memilih adapter.
- Test bisa mengganti port.
- Domain tidak tahu JPA/REST/JMS.
- Migration vendor menjadi lebih murah.
- Feature flag bisa memilih adapter tanpa mengubah use case.
- Audit/compliance port bisa distandarkan.

### 5.3 Batas Penting

Jangan jadikan semua interface hanya karena “best practice”. Interface berguna jika ada alasan arsitektural:

- external dependency,
- testing substitution,
- multiple implementation,
- tenant-specific behavior,
- adapter boundary,
- module boundary,
- vendor isolation,
- compliance boundary.

Kalau hanya ada satu service internal tanpa boundary, interface sering hanya noise.

---

## 6. Pattern 3 — Application Service as Transaction and Use Case Boundary

Salah satu kesalahan paling umum:

```text
Transaction boundary diletakkan sembarang di repository/service kecil.
```

Akibatnya:

- satu use case bisa punya banyak transaksi tidak sengaja,
- rollback semantics sulit dipahami,
- audit bisa committed walau business gagal,
- notification bisa dikirim sebelum transaction commit,
- lazy loading error muncul di transport layer.

### 6.1 Prinsip

Untuk kebanyakan aplikasi enterprise:

```text
Transaction boundary sebaiknya berada di application use case boundary.
```

Contoh:

```java
@ApplicationScoped
public class SubmitAppealUseCase {

    @Transactional
    public SubmitAppealResult submit(SubmitAppealCommand command) {
        // load aggregate
        // validate command
        // mutate domain
        // persist
        // publish local event / audit intent
        // return result
    }
}
```

Transport boundary tidak perlu tahu transaction:

```java
@Path("/appeals")
@RequestScoped
public class AppealResource {

    @Inject
    SubmitAppealUseCase submitAppeal;

    @POST
    public Response submit(SubmitAppealRequest request) {
        SubmitAppealCommand command = AppealMapper.toCommand(request);
        SubmitAppealResult result = submitAppeal.submit(command);
        return Response.accepted(AppealMapper.toResponse(result)).build();
    }
}
```

### 6.2 Why Application Boundary?

Karena use case adalah unit bisnis yang punya invariant:

```text
Either the use case succeeds as a whole, or it fails as a whole.
```

Repository bukan unit bisnis. Resource HTTP juga bukan unit bisnis. Application service adalah boundary yang paling tepat untuk:

- authorization decision,
- transaction demarcation,
- command validation,
- domain orchestration,
- audit event creation,
- idempotency enforcement,
- post-commit side effect scheduling.

### 6.3 Transaction Anti-Pattern

```java
@ApplicationScoped
public class CaseRepository {

    @Transactional
    public CaseFile find(...) { ... }

    @Transactional
    public void save(...) { ... }
}
```

Tidak selalu salah, tetapi sering berbahaya. Repository-level transaction membuat setiap repository call berpotensi menjadi transaction sendiri.

Lebih baik:

```java
@ApplicationScoped
public class CaseRepository {
    public CaseFile find(...) { ... }
    public void save(...) { ... }
}
```

Dan use case:

```java
@Transactional
public ApproveCaseResult approve(...) { ... }
```

---

## 7. Pattern 4 — Boundary Annotations as Architecture Language

Annotation tidak harus hanya teknis. Kita bisa memakai CDI stereotypes/interceptor bindings untuk membuat bahasa arsitektur.

### 7.1 Contoh Boundary Annotation

```java
@Stereotype
@ApplicationScoped
@Transactional
@Audited
@Target(TYPE)
@Retention(RUNTIME)
public @interface UseCaseBoundary {
}
```

Penggunaan:

```java
@UseCaseBoundary
public class CloseCaseUseCase {
    public CloseCaseResult close(CloseCaseCommand command) {
        ...
    }
}
```

Namun hati-hati: stereotype yang terlalu banyak menyembunyikan behavior bisa membuat runtime tidak transparan.

### 7.2 Annotation Composition yang Baik

Baik jika annotation menjelaskan **kontrak arsitektur**:

```java
@ApplicationBoundary
@RegulatoryAudited
@RequiresOfficerContext
public class IssueWarningUseCase { ... }
```

Buruk jika annotation menjadi magic bag:

```java
@EverythingService
public class CaseService { ... }
```

### 7.3 Rule

Custom annotation harus menjawab:

1. Boundary apa yang dinyatakan?
2. Siapa owner-nya?
3. Behavior runtime apa yang dipasang?
4. Bagaimana dites?
5. Bagaimana developer baru bisa tahu efeknya?
6. Apakah annotation ini mengurangi atau menambah kebingungan?

---

## 8. Pattern 5 — Runtime Qualifier Strategy

Qualifier sering dianggap detail CDI. Di level arsitektur, qualifier adalah **routing label**.

### 8.1 Contoh Buruk

```java
@Inject
PaymentGateway gateway;
```

Jika ada banyak gateway:

- Stripe,
- internal billing,
- mock,
- offline,
- tenant-specific,
- feature-flagged,

maka injection ini ambigu.

### 8.2 Qualifier sebagai Routing Contract

```java
@Qualifier
@Retention(RUNTIME)
@Target({FIELD, PARAMETER, METHOD, TYPE})
public @interface PrimaryGateway {
}

@Qualifier
@Retention(RUNTIME)
@Target({FIELD, PARAMETER, METHOD, TYPE})
public @interface FallbackGateway {
}
```

Adapter:

```java
@PrimaryGateway
@ApplicationScoped
public class PartnerPaymentGateway implements PaymentGateway { ... }

@FallbackGateway
@ApplicationScoped
public class OfflinePaymentGateway implements PaymentGateway { ... }
```

Use case:

```java
@Inject
public CollectFeeUseCase(
        @PrimaryGateway PaymentGateway primary,
        @FallbackGateway PaymentGateway fallback) {
    ...
}
```

### 8.3 Qualifier Strategy Checklist

Gunakan qualifier ketika ada perbedaan stabil dalam arsitektur:

- primary vs fallback,
- internal vs external,
- read model vs write model,
- sync vs async,
- secure vs public,
- government agency A vs agency B,
- production adapter vs test adapter,
- strict policy vs lenient policy,
- legacy vs modern implementation.

Jangan gunakan qualifier untuk hal yang seharusnya data/config per request.

Contoh salah:

```java
@Qualifier
public @interface User123Mode { }
```

Kalau keputusan berubah per user/request, gunakan strategy service atau feature flag evaluation, bukan qualifier static.

---

## 9. Pattern 6 — Producer as Runtime Composition Root

Dalam pure DI, composition root adalah tempat object graph disusun. Dalam CDI, container melakukan banyak composition otomatis. Tetapi untuk object yang berasal dari config, factory, resource, atau third-party library, producer sering menjadi composition root lokal.

### 9.1 Producer untuk Runtime Config Object

```java
@ApplicationScoped
public class RuntimeConfigProducer {

    @Inject
    @ConfigProperty(name = "case.approval.max-days")
    int maxApprovalDays;

    @Inject
    @ConfigProperty(name = "case.approval.strict-mode", defaultValue = "true")
    boolean strictMode;

    @Produces
    @ApplicationScoped
    public ApprovalRuntimePolicy approvalRuntimePolicy() {
        return new ApprovalRuntimePolicy(maxApprovalDays, strictMode);
    }
}
```

Application service tidak perlu baca config mentah.

```java
@Inject
ApprovalRuntimePolicy policy;
```

### 9.2 Producer untuk Third-Party Client

```java
@ApplicationScoped
public class ExternalClientProducer {

    @Inject
    ExternalSystemConfig config;

    @Produces
    @ApplicationScoped
    @ExternalCaseSystem
    public CaseSystemClient caseSystemClient() {
        return CaseSystemClient.builder()
                .baseUrl(config.baseUrl())
                .connectTimeout(config.connectTimeout())
                .readTimeout(config.readTimeout())
                .build();
    }

    public void close(@Disposes @ExternalCaseSystem CaseSystemClient client) {
        client.close();
    }
}
```

### 9.3 Producer Anti-Pattern

```java
@Produces
public Object produceAnything(InjectionPoint ip) {
    String name = ip.getMember().getName();
    return globalRegistry.lookup(name);
}
```

Ini biasanya service locator yang disamarkan sebagai CDI.

### 9.4 Rule

Producer idealnya:

- kecil,
- eksplisit,
- typed,
- qualified,
- testable,
- punya ownership cleanup jika resourceful,
- tidak mengambil keputusan bisnis per call.

---

## 10. Pattern 7 — Interceptor for Cross-Cutting Runtime Policy

Interceptor cocok untuk behavior yang:

- berlaku lintas banyak method/class,
- terkait invocation,
- tidak mengubah semantic domain object secara langsung,
- bisa dinyatakan sebagai annotation,
- perlu ordering jelas.

### 10.1 Audit Interceptor

Annotation:

```java
@InterceptorBinding
@Retention(RUNTIME)
@Target({TYPE, METHOD})
public @interface AuditedOperation {
    String value();
}
```

Interceptor:

```java
@AuditedOperation("")
@Interceptor
@Priority(Interceptor.Priority.APPLICATION)
public class AuditInterceptor {

    @Inject
    AuditPort audit;

    @AroundInvoke
    public Object around(InvocationContext ctx) throws Exception {
        long start = System.nanoTime();
        try {
            Object result = ctx.proceed();
            audit.record(AuditEntry.success(operationName(ctx), elapsed(start)));
            return result;
        } catch (Exception e) {
            audit.record(AuditEntry.failure(operationName(ctx), e, elapsed(start)));
            throw e;
        }
    }
}
```

Use case:

```java
@ApplicationScoped
public class ApproveCaseUseCase {

    @AuditedOperation("case.approve")
    @Transactional
    public ApproveCaseResult approve(ApproveCaseCommand command) {
        ...
    }
}
```

### 10.2 Interceptor Fit

Cocok:

- audit envelope,
- metrics,
- tracing,
- correlation id,
- idempotency guard,
- authorization precondition,
- feature gate,
- retry untuk operation tertentu,
- rate-limit guard.

Tidak cocok:

- business rule utama,
- complex branching business flow,
- per-record decision yang butuh domain context besar,
- mutation tersembunyi yang mengejutkan caller.

### 10.3 Interceptor Invariant

Setiap interceptor harus punya dokumentasi:

```text
Name:
Purpose:
Applies to:
Ordering:
Exception behavior:
Transaction interaction:
Logging/audit behavior:
Test strategy:
```

---

## 11. Pattern 8 — Decorator for Semantic Business Wrapping

Decorator cocok ketika behavior tambahan adalah bagian dari semantic contract interface.

Misalnya:

```java
public interface CaseAssignmentService {
    AssignmentResult assign(AssignCaseCommand command);
}
```

Implementasi utama:

```java
@ApplicationScoped
public class DefaultCaseAssignmentService implements CaseAssignmentService {
    public AssignmentResult assign(AssignCaseCommand command) {
        ...
    }
}
```

Decorator compliance:

```java
@Decorator
public abstract class ComplianceCaseAssignmentDecorator implements CaseAssignmentService {

    @Inject
    @Delegate
    CaseAssignmentService delegate;

    @Inject
    OfficerCompliancePolicy compliancePolicy;

    @Override
    public AssignmentResult assign(AssignCaseCommand command) {
        compliancePolicy.ensureOfficerCanReceive(command.officerId(), command.caseType());
        return delegate.assign(command);
    }
}
```

### 11.1 Decorator vs Interceptor

| Concern | Interceptor | Decorator |
|---|---|---|
| Based on | annotation binding | business interface/type |
| Best for | generic invocation concern | semantic behavior extension |
| Knows method semantics? | usually no/minimal | yes |
| Can change domain behavior? | should be careful | often yes, deliberately |
| Example | metrics, audit, trace | compliance wrapper, fallback wrapper |

### 11.2 Rule

Use decorator when you can say:

```text
This behavior is part of the business contract of this interface.
```

Use interceptor when you can say:

```text
This behavior is part of runtime invocation policy.
```

---

## 12. Pattern 9 — Configuration Boundary Pattern

Jangan inject raw config di mana-mana.

### 12.1 Anti-Pattern

```java
@ConfigProperty(name = "case.close.max-days")
int maxDays;

@ConfigProperty(name = "case.close.require-review")
boolean requireReview;

@ConfigProperty(name = "case.close.notify")
boolean notify;
```

Jika tersebar di banyak class:

- sulit tahu config dipakai di mana,
- validasi tersebar,
- default tidak konsisten,
- secret bisa bocor,
- testing matrix membesar,
- config menjadi hidden coupling.

### 12.2 Typed Config Boundary

```java
@ApplicationScoped
public class CaseClosureConfig {

    private final int maxDays;
    private final boolean requireReview;
    private final boolean notifyApplicant;

    @Inject
    public CaseClosureConfig(
            @ConfigProperty(name = "case.close.max-days") int maxDays,
            @ConfigProperty(name = "case.close.require-review") boolean requireReview,
            @ConfigProperty(name = "case.close.notify-applicant") boolean notifyApplicant) {

        if (maxDays <= 0) {
            throw new IllegalArgumentException("case.close.max-days must be positive");
        }

        this.maxDays = maxDays;
        this.requireReview = requireReview;
        this.notifyApplicant = notifyApplicant;
    }

    public int maxDays() { return maxDays; }
    public boolean requireReview() { return requireReview; }
    public boolean notifyApplicant() { return notifyApplicant; }
}
```

### 12.3 Config Boundary Rule

Config boundary harus:

- typed,
- validated,
- named by business capability,
- fail fast for required values,
- hide secret values from logs,
- expose safe diagnostic summary,
- separate build-time/startup/runtime-mutable config.

---

## 13. Pattern 10 — Feature-Flagged Workflow Pattern

Feature flag tidak boleh membuat business logic menjadi hutan `if`.

### 13.1 Anti-Pattern

```java
public Result process(Command command) {
    if (flags.enabled("new-flow")) {
        if (flags.enabled("new-flow-step-2")) {
            if (flags.enabled("disable-old-check")) {
                ...
            }
        }
    } else {
        ...
    }
}
```

Ini menyebabkan:

- flag debt,
- sulit testing matrix,
- behavior tidak jelas,
- audit sulit,
- rollback berisiko,
- cleanup terlupakan.

### 13.2 Strategy-Based Pattern

```java
public interface CaseScreeningWorkflow {
    ScreeningResult screen(ScreeningCommand command);
}
```

Legacy:

```java
@LegacyScreening
@ApplicationScoped
public class LegacyCaseScreeningWorkflow implements CaseScreeningWorkflow { ... }
```

New:

```java
@ModernScreening
@ApplicationScoped
public class ModernCaseScreeningWorkflow implements CaseScreeningWorkflow { ... }
```

Selector:

```java
@ApplicationScoped
public class FeatureFlaggedCaseScreeningWorkflow implements CaseScreeningWorkflow {

    private final FeatureFlagService flags;
    private final CaseScreeningWorkflow legacy;
    private final CaseScreeningWorkflow modern;

    @Inject
    public FeatureFlaggedCaseScreeningWorkflow(
            FeatureFlagService flags,
            @LegacyScreening CaseScreeningWorkflow legacy,
            @ModernScreening CaseScreeningWorkflow modern) {
        this.flags = flags;
        this.legacy = legacy;
        this.modern = modern;
    }

    @Override
    public ScreeningResult screen(ScreeningCommand command) {
        FeatureContext context = FeatureContext.from(command);
        if (flags.enabled("case.screening.modern", context)) {
            return modern.screen(command);
        }
        return legacy.screen(command);
    }
}
```

Use case bergantung pada interface:

```java
@Inject
CaseScreeningWorkflow screeningWorkflow;
```

### 13.3 Benefit

- Flag decision terkonsentrasi.
- Dua flow bisa dites terpisah.
- Rollback jelas.
- Cleanup mudah: hapus legacy/new setelah rollout final.
- Audit bisa mencatat selected variant.

---

## 14. Pattern 11 — Domain Events vs CDI Events vs Integration Events

Jangan campur semua “event”.

### 14.1 Tiga Jenis Event

| Jenis | Scope | Tujuan | Tool cocok |
|---|---|---|---|
| Domain event | pure domain | menyatakan fakta bisnis | object biasa/list dalam aggregate |
| CDI event | in-process container | decoupling lokal | CDI `Event<T>` |
| Integration event | cross-system | komunikasi antar service/system | broker/JMS/Kafka/RabbitMQ/outbox |

### 14.2 Domain Event

```java
public record CaseApproved(CaseId caseId, OfficerId officerId, Instant approvedAt) {
}
```

Aggregate:

```java
public final class CaseFile {

    private final List<Object> domainEvents = new ArrayList<>();

    public void approve(OfficerId officerId, ApprovalPolicy policy) {
        policy.ensureCanApprove(this, officerId);
        this.status = CaseStatus.APPROVED;
        this.domainEvents.add(new CaseApproved(this.id, officerId, Instant.now()));
    }

    public List<Object> pullDomainEvents() {
        List<Object> copy = List.copyOf(domainEvents);
        domainEvents.clear();
        return copy;
    }
}
```

Application service:

```java
@Transactional
public ApproveCaseResult approve(ApproveCaseCommand command) {
    CaseFile caseFile = cases.get(command.caseId());
    caseFile.approve(command.officerId(), policy);
    cases.save(caseFile);
    domainEventPublisher.publish(caseFile.pullDomainEvents());
    return ApproveCaseResult.success(caseFile.id());
}
```

### 14.3 CDI Event Use

CDI event cocok untuk local hook:

```java
@ApplicationScoped
public class CdiDomainEventPublisher implements DomainEventPublisher {

    @Inject
    Event<Object> events;

    public void publish(List<Object> domainEvents) {
        for (Object event : domainEvents) {
            events.fire(event);
        }
    }
}
```

Observer:

```java
public void onCaseApproved(@Observes CaseApproved event) {
    // local cache invalidation or audit enrichment
}
```

### 14.4 Integration Event Use

Untuk cross-service, gunakan outbox/messaging, bukan CDI event langsung:

```text
Transaction commits business data + outbox row
        ↓
Outbox publisher sends message to broker
        ↓
Remote systems consume reliably
```

CDI event tidak memberi durability cross-process.

---

## 15. Pattern 12 — Audit as Architecture, Not Utility Call

Audit di enterprise/regulatory system bukan logging biasa.

### 15.1 Audit Invariant

Audit harus menjawab:

- siapa melakukan apa,
- kapan,
- terhadap entity apa,
- dari channel mana,
- dengan correlation/request id apa,
- hasilnya sukses/gagal,
- field/perubahan apa yang relevan,
- apakah dilakukan via user/system/batch,
- apakah keputusan dipengaruhi feature flag/config/profile.

### 15.2 Audit Port

```java
public interface AuditPort {
    void record(AuditRecord record);
}
```

### 15.3 Audit Context

```java
public record AuditContext(
        String correlationId,
        String actorId,
        String actorType,
        String channel,
        String sourceIp,
        Instant occurredAt) {
}
```

### 15.4 Audit Interceptor + Explicit Domain Audit

Ada dua jenis audit:

1. Invocation audit: use case dipanggil, sukses/gagal.
2. Business audit: status berubah, assignment berubah, decision dibuat.

Invocation audit cocok interceptor.

Business audit sebaiknya explicit di domain/application logic.

```java
caseFile.approve(command.officerId(), policy);
audit.record(AuditRecord.caseApproved(caseFile.id(), command.officerId(), auditContext));
```

Jangan berharap interceptor memahami seluruh semantic perubahan domain.

---

## 16. Pattern 13 — Policy Enforcement Boundary

Policy enforcement sering tersebar:

```java
if (user.hasRole("SUPERVISOR") && case.status() == OPEN && config.strictMode()) {
    ...
}
```

Lebih baik gunakan policy object.

```java
public interface ApprovalPolicy {
    void ensureCanApprove(CaseFile caseFile, Officer officer);
}
```

Implementasi:

```java
@ApplicationScoped
public class RegulatoryApprovalPolicy implements ApprovalPolicy {

    private final DelegationPort delegations;
    private final ConflictCheckPort conflicts;
    private final ApprovalPolicyConfig config;

    @Inject
    public RegulatoryApprovalPolicy(
            DelegationPort delegations,
            ConflictCheckPort conflicts,
            ApprovalPolicyConfig config) {
        this.delegations = delegations;
        this.conflicts = conflicts;
        this.config = config;
    }

    @Override
    public void ensureCanApprove(CaseFile caseFile, Officer officer) {
        if (!delegations.canActOn(officer.id(), caseFile.caseType())) {
            throw new ApprovalDeniedException("Officer has no delegation");
        }
        if (config.strictConflictCheck() && conflicts.hasConflict(officer.id(), caseFile.id())) {
            throw new ApprovalDeniedException("Conflict of interest detected");
        }
        caseFile.ensureStatus(CaseStatus.PENDING_APPROVAL);
    }
}
```

### 16.1 Why Policy Boundary Matters

- Rules are named.
- Rules are testable.
- Runtime inputs are explicit.
- Audit can reference policy decision.
- Future rule engine migration is easier.
- Regulatory defensibility improves.

---

## 17. Pattern 14 — Idempotency Boundary

Enterprise workflows often receive duplicate requests:

- user double-click,
- retry from API gateway,
- message redelivery,
- scheduler overlap,
- network timeout retry,
- browser resend.

### 17.1 Idempotency as Runtime Boundary

```java
@InterceptorBinding
@Retention(RUNTIME)
@Target({METHOD, TYPE})
public @interface IdempotentOperation {
    String value();
}
```

Use case:

```java
@IdempotentOperation("case.submit")
@Transactional
public SubmitCaseResult submit(SubmitCaseCommand command) {
    ...
}
```

Interceptor can:

- extract idempotency key,
- lock key,
- check previous result,
- proceed once,
- persist result hash/status,
- return previous result if repeated.

### 17.2 But Beware

Idempotency is not only interceptor magic. You also need persistence invariant:

```text
unique(operation_name, idempotency_key)
```

And business invariant:

```text
submitting same command twice must produce same outcome or safe no-op
```

---

## 18. Pattern 15 — Runtime Invariant Documentation

For every important module, document runtime invariants.

Example:

```text
Module: Case Approval

Runtime owner:
- CDI manages application services and adapters.
- Transaction boundary is application use case method.
- Request boundary maps DTO to command only.

Transaction invariant:
- Case status update and audit record must commit atomically.
- Notification is emitted after commit via outbox.

Config invariant:
- Approval max amount is startup config and fail-fast required.
- Feature flag controls workflow variant only, not final authorization decision.

Security invariant:
- Officer identity must be resolved before use case call.
- Domain policy still validates delegation; endpoint role is not sufficient.

Observability invariant:
- Every use case emits correlation id, actor id, operation name, success/failure.

Failure invariant:
- External notification failure must not rollback approved case after commit.
- Outbox retry handles notification delivery.
```

Ini tampak sederhana, tetapi sangat kuat untuk:

- onboarding,
- architecture review,
- incident analysis,
- regulatory audit,
- migration planning,
- test planning.

---

## 19. Pattern 16 — Module Boundary and Dependency Direction

### 19.1 Good Direction

```text
api/rest       → application
application    → domain + port
domain         → none
infrastructure → port + runtime libraries
runtime        → infrastructure + CDI/Jakarta glue
```

### 19.2 Bad Direction

```text
domain → infrastructure
domain → CDI
domain → JPA
domain → config
domain → HTTP client
application → JAX-RS Response
repository → application use case
```

### 19.3 Enforcement

You can enforce with:

- package conventions,
- Maven module boundaries,
- JPMS if feasible,
- ArchUnit tests,
- code review checklist,
- ADR,
- CI dependency checks.

Example ArchUnit style rule conceptually:

```java
classes()
    .that().resideInAPackage("..domain..")
    .should().onlyDependOnClassesThat()
    .resideOutsideOfPackages("jakarta..", "javax..", "org.hibernate..", "org.eclipse.microprofile..")
```

---

## 20. Pattern 17 — Adapter Isolation for Vendor and Runtime Migration

Enterprise Java apps live long. You may migrate:

- Java EE 8 → Jakarta EE 10/11,
- WebLogic → WildFly/Open Liberty/Payara,
- EJB → CDI,
- JNDI config → MicroProfile Config,
- JPA provider,
- REST client implementation,
- container deployment model,
- VM → Kubernetes.

Adapter isolation reduces blast radius.

### 20.1 Example: Email Adapter

Port:

```java
public interface MailPort {
    void send(MailMessage message);
}
```

Jakarta Mail adapter:

```java
@ApplicationScoped
public class JakartaMailAdapter implements MailPort {

    @Resource(lookup = "java:comp/env/mail/CaseMailSession")
    Session session;

    public void send(MailMessage message) {
        ...
    }
}
```

If later moved to cloud email API:

```java
@ApplicationScoped
public class CloudEmailAdapter implements MailPort {
    ...
}
```

Application use case unchanged.

---

## 21. Pattern 18 — Runtime Context Object

Many systems pass context implicitly via ThreadLocal/security/session/request scope. That is sometimes unavoidable, but business/application logic benefits from explicit command context.

```java
public record RequestContext(
        String correlationId,
        Actor actor,
        String channel,
        String clientIp,
        Locale locale,
        Instant requestTime) {
}
```

Command:

```java
public record ApproveCaseCommand(
        CaseId caseId,
        DecisionComment comment,
        RequestContext context) {
}
```

Benefit:

- testable,
- explicit,
- async-safe,
- easier audit,
- less ThreadLocal coupling,
- less request-scope leakage.

Rule:

```text
Use container context to extract context at boundary.
Pass business-relevant context explicitly into use case.
```

---

## 22. Pattern 19 — Safe Async Boundary

Async should not leak request-scoped dependencies or transaction context accidentally.

### 22.1 Bad

```java
@RequestScoped
public class CaseResource {

    @Inject
    ManagedExecutorService executor;

    @Inject
    CaseService caseService;

    @POST
    public Response submit(Request request) {
        executor.submit(() -> caseService.process(request));
        return Response.accepted().build();
    }
}
```

Problems:

- request object may be invalid after request ends,
- security context may not propagate as expected,
- transaction boundary unclear,
- errors are lost,
- no retry/durability,
- no idempotency.

### 22.2 Better

```java
@Transactional
public SubmitCaseResult submit(SubmitCaseCommand command) {
    CaseFile caseFile = createCase(command);
    cases.save(caseFile);
    outbox.add(NotificationRequested.forCaseSubmitted(caseFile.id()));
    return SubmitCaseResult.accepted(caseFile.id());
}
```

Then outbox publisher handles async.

For non-critical local async, use managed executor with explicit immutable payload:

```java
ManagedTaskPayload payload = ManagedTaskPayload.from(result, contextSnapshot);
executor.submit(() -> backgroundProcessor.process(payload));
```

---

## 23. Pattern 20 — Outbox for Transactional Integration

When business data and external message must be consistent:

```text
Do not send remote message directly inside the transaction if failure consistency matters.
```

Use outbox:

```text
┌───────────────┐
│ Use Case Tx   │
│ - update case │
│ - insert outbox event │
└───────┬───────┘
        │ commit
        ▼
┌───────────────┐
│ Outbox Worker │
│ - read event  │
│ - publish     │
│ - mark sent   │
└───────────────┘
```

### 23.1 Why This Belongs Here

This is runtime architecture because it coordinates:

- transaction boundary,
- persistence adapter,
- background worker,
- message adapter,
- retry,
- idempotency,
- observability,
- feature flags for rollout,
- config for retry/backoff.

---

## 24. Pattern 21 — Compliance Hook without Business Pollution

Regulatory systems often need compliance hooks:

- case cannot be assigned to conflicted officer,
- action requires delegation,
- appeal deadline must be enforced,
- high-risk action needs supervisor review,
- field change requires reason,
- external data access must be logged.

Do not scatter these checks randomly.

### 24.1 Policy + Interceptor + Audit Combination

```text
Role annotation       → coarse endpoint access
Policy object         → business permission/invariant
Interceptor           → uniform audit/trace/idempotency
Decorator             → semantic wrapper for interface behavior
Domain method         → final invariant mutation guard
```

Example:

```java
@AuditedOperation("case.assign")
@IdempotentOperation("case.assign")
@Transactional
public AssignCaseResult assign(AssignCaseCommand command) {
    CaseFile caseFile = cases.get(command.caseId());
    Officer officer = officers.get(command.officerId());

    assignmentPolicy.ensureCanAssign(caseFile, officer, command.context());
    caseFile.assignTo(officer.id());

    cases.save(caseFile);
    audit.record(AuditRecord.caseAssigned(caseFile.id(), officer.id(), command.context()));

    return AssignCaseResult.success(caseFile.id());
}
```

---

## 25. Pattern 22 — Architecture Decision Matrix for Runtime Mechanisms

| Need | Prefer | Avoid |
|---|---|---|
| Choose implementation at startup | qualifier, alternative, producer | raw `if` in every service |
| Choose implementation per request | strategy selector, feature flag service | CDI qualifier per user/request |
| Add metrics/tracing | interceptor | manual log copy-paste |
| Add semantic wrapper | decorator | giant subclass hierarchy |
| Provide third-party client | producer + disposer | static singleton factory |
| Read config | typed config boundary | `ConfigProvider.getConfig()` everywhere |
| Cross-system event | outbox/message broker | CDI event only |
| Local decoupled hook | CDI event | remote broker if not needed |
| Business rule | policy object/domain method | interceptor magic |
| Authorization | endpoint security + domain policy | role check only in UI |
| Async durable work | outbox/job table/broker | raw executor fire-and-forget |
| Request async work | managed executor + context snapshot | unmanaged thread |
| Resource lookup | adapter/producer/resource reference | direct JNDI lookup everywhere |
| Migration isolation | ports/adapters | framework API in domain |

---

## 26. Reference Architecture Example: Regulatory Case Management

### 26.1 Use Case

```text
Officer approves an enforcement case.
The system must:
- validate case exists,
- validate status allows approval,
- validate officer delegation,
- check conflict of interest,
- update case status,
- record audit trail,
- write outbox notification,
- respect feature flag for new approval workflow,
- run in one transaction for data update + audit + outbox,
- expose correlation id for observability.
```

### 26.2 Package Layout

```text
caseapproval
├── api
│   └── rest
│       ├── CaseApprovalResource.java
│       └── ApproveCaseRequest.java
├── application
│   ├── ApproveCaseUseCase.java
│   ├── ApproveCaseCommand.java
│   └── ApproveCaseResult.java
├── domain
│   ├── CaseFile.java
│   ├── CaseStatus.java
│   ├── CaseApproved.java
│   └── ApprovalPolicy.java
├── port
│   ├── CaseRepository.java
│   ├── OfficerDirectory.java
│   ├── ConflictCheckPort.java
│   ├── AuditPort.java
│   ├── OutboxPort.java
│   └── FeatureFlagService.java
├── infrastructure
│   ├── persistence
│   ├── identity
│   ├── conflict
│   ├── audit
│   ├── outbox
│   └── featureflag
└── runtime
    ├── qualifier
    ├── interceptor
    ├── config
    └── producer
```

### 26.3 Use Case Skeleton

```java
@ApplicationScoped
public class ApproveCaseUseCase {

    private final CaseRepository cases;
    private final OfficerDirectory officers;
    private final ApprovalPolicy approvalPolicy;
    private final AuditPort audit;
    private final OutboxPort outbox;
    private final FeatureFlagService flags;

    @Inject
    public ApproveCaseUseCase(
            CaseRepository cases,
            OfficerDirectory officers,
            ApprovalPolicy approvalPolicy,
            AuditPort audit,
            OutboxPort outbox,
            FeatureFlagService flags) {
        this.cases = cases;
        this.officers = officers;
        this.approvalPolicy = approvalPolicy;
        this.audit = audit;
        this.outbox = outbox;
        this.flags = flags;
    }

    @Transactional
    @AuditedOperation("case.approve")
    @IdempotentOperation("case.approve")
    public ApproveCaseResult approve(ApproveCaseCommand command) {
        CaseFile caseFile = cases.findRequired(command.caseId());
        Officer officer = officers.findRequired(command.context().actor().id());

        boolean modernFlow = flags.enabled(
                "case.approval.modern-flow",
                FeatureContext.from(command));

        approvalPolicy.ensureCanApprove(caseFile, officer, modernFlow);

        caseFile.approve(officer.id(), command.comment());

        cases.save(caseFile);
        audit.record(AuditRecord.caseApproved(caseFile, officer, command.context(), modernFlow));
        outbox.add(OutboxEvent.caseApproved(caseFile.id(), command.context().correlationId()));

        return ApproveCaseResult.success(caseFile.id());
    }
}
```

### 26.4 Why This Is Better

- Resource maps HTTP to command only.
- Use case owns transaction.
- Policy owns business permission.
- Repository owns persistence.
- Audit is explicit and/or interceptor-based.
- Outbox prevents unsafe remote side effect.
- Feature flag decision is visible and auditable.
- Context is explicit.
- Runtime concerns are named.

---

## 27. Runtime Architecture Review Checklist

Use this checklist during design/code review.

### 27.1 Dependency Direction

- Does domain depend on CDI/Jakarta/JPA/HTTP/config?
- Does application layer depend only on domain + ports?
- Are infrastructure adapters isolated?
- Are runtime glue classes separated?

### 27.2 Transaction Boundary

- Where does transaction start?
- Is it at use case boundary?
- What must commit atomically?
- What must happen after commit?
- Are external calls inside transaction justified?

### 27.3 Configuration

- Are raw config keys scattered?
- Is config typed and validated?
- Are secrets protected from logs?
- Is config startup-time or runtime-mutable?
- Is profile behavior explicit?

### 27.4 CDI Wiring

- Are qualifiers meaningful?
- Are alternatives used deliberately?
- Are producers simple and typed?
- Are decorators/interceptors documented?
- Is there hidden service locator behavior?

### 27.5 Feature Flags

- Is flag decision centralized?
- Is selected variant auditable?
- Is there cleanup plan?
- Is fallback behavior defined?
- Is stale flag cache behavior acceptable?

### 27.6 Async and Events

- Is async durable or best-effort?
- Is context propagation explicit?
- Are request-scoped objects leaked?
- Is cross-system communication using durable messaging/outbox?
- Are CDI events only used in-process?

### 27.7 Observability

- Is correlation id available?
- Are operation names standardized?
- Are failures classified?
- Can we inspect selected config/profile/flag safely?
- Is audit separate from debug logging?

### 27.8 Testing

- Can domain be tested without container?
- Can use case be tested with fake ports?
- Are wiring tests present for CDI?
- Are config failure tests present?
- Are feature flag matrix tests present?

---

## 28. Common Architecture Smells

### 28.1 Annotation Soup

```java
@Path
@RequestScoped
@Transactional
@RolesAllowed
@Audited
@Retry
@Timeout
@FeatureGate
public class SomeResource { ... }
```

Smell: endpoint class becomes runtime dumping ground.

Fix: move use case behavior to application boundary.

### 28.2 Service Blob

```java
public class CaseService {
    submit()
    approve()
    reject()
    assign()
    escalate()
    notify()
    audit()
    export()
}
```

Smell: no use case boundary.

Fix: split by command/use case.

### 28.3 Config Everywhere

Smell:

```java
@ConfigProperty everywhere
```

Fix: typed config boundary.

### 28.4 Flag Everywhere

Smell:

```java
flags.enabled(...) everywhere
```

Fix: strategy selector or feature-flagged workflow.

### 28.5 Direct Container Lookup Everywhere

Smell:

```java
new InitialContext().lookup(...)
CDI.current().select(...)
ConfigProvider.getConfig()...
```

Fix: inject boundary abstractions.

### 28.6 Domain Depends on Persistence

Smell:

```java
@Entity
public class CaseFile {
    @Inject SomeService service;
}
```

Fix: separate domain model or keep entity as persistence model and map to domain.

### 28.7 Hidden Transaction Split

Smell: repository methods each annotated transactional.

Fix: transaction at use case boundary.

---

## 29. Java 8–25 Considerations

### 29.1 Java 8 Era

Typical environment:

- Java EE 7/8,
- `javax.*`,
- EJB still common,
- application server deployment,
- WAR/EAR,
- JNDI/resource references,
- less container-native config standardization.

Architecture emphasis:

- isolate `javax.*` in adapters,
- avoid domain dependency on EJB/JPA,
- use ports to prepare migration,
- avoid direct JNDI everywhere.

### 29.2 Java 11/17 Era

Typical environment:

- Jakarta namespace transition,
- MicroProfile maturity,
- containerized deployment,
- cloud-native runtime,
- stronger need for reproducible dependencies.

Architecture emphasis:

- explicit `javax` → `jakarta` boundary,
- config source precedence,
- typed config,
- adapter isolation,
- testable CDI wiring.

### 29.3 Java 21/25 Era

Typical environment:

- virtual threads available in Java platform,
- Jakarta EE 11 supports modern Java baseline,
- more build-time augmentation in frameworks,
- more native-image/AOT consideration in some runtimes,
- more focus on observability and secure supply chain.

Architecture emphasis:

- do not assume all runtime reflection/proxy behavior is free,
- keep domain pure,
- document build-time vs runtime behavior,
- manage context propagation carefully,
- use virtual threads only where container/runtime supports it safely,
- prefer explicit runtime invariants.

---

## 30. Practical Architecture Rules

### Rule 1 — Domain should not know the container

Domain can be tested with `new`.

### Rule 2 — Application service owns use case boundary

It orchestrates transaction, policy, ports, audit intent, and result.

### Rule 3 — Infrastructure implements ports

It may know JPA, HTTP, JMS, datasource, remote clients.

### Rule 4 — Runtime glue stays in runtime package/module

Producers, qualifiers, interceptors, decorators, stereotypes, config boundaries belong in clear places.

### Rule 5 — Config is not a global variable

Treat config as typed, validated, auditable runtime contract.

### Rule 6 — Feature flag is not business logic

It selects behavior. It should not become permanent nested branching.

### Rule 7 — Audit is not logging

Audit is a business/compliance record.

### Rule 8 — CDI event is not distributed messaging

Use broker/outbox for cross-process reliability.

### Rule 9 — Transaction boundary must be named

Anonymous transaction behavior is hard to reason about.

### Rule 10 — Architecture must expose failure modes

Every runtime mechanism must have known failure behavior.

---

## 31. Mini Case Study: Refactoring a Messy Runtime-Coupled Service

### 31.1 Before

```java
@Path("/cases")
@RequestScoped
public class CaseResource {

    @Inject EntityManager em;
    @Inject FeatureFlagService flags;
    @Inject AuditService audit;
    @Inject NotificationClient notification;
    @Inject SecurityContext security;

    @POST
    @Path("/{id}/approve")
    @Transactional
    public Response approve(@PathParam("id") Long id, ApproveRequest req) {
        CaseEntity entity = em.find(CaseEntity.class, id);
        if (entity == null) {
            return Response.status(404).build();
        }

        if (!security.isUserInRole("APPROVER")) {
            return Response.status(403).build();
        }

        if (flags.enabled("new-approval")) {
            // new flow
        } else {
            // old flow
        }

        entity.setStatus("APPROVED");
        audit.log("approved case " + id);
        notification.sendApproved(id);
        return Response.ok().build();
    }
}
```

Problems:

- resource owns everything,
- direct persistence,
- weak domain model,
- string status,
- role check only at endpoint,
- external notification inside transaction,
- audit manual string,
- feature flag branch in transport layer.

### 31.2 After

```text
CaseApprovalResource
    ↓ maps request to command
ApproveCaseUseCase
    ↓ owns transaction + orchestration
ApprovalPolicy
    ↓ owns business permission
CaseRepository
    ↓ persistence adapter
AuditPort
    ↓ audit adapter
OutboxPort
    ↓ durable async integration
FeatureFlaggedApprovalWorkflow
    ↓ selects old/new workflow
```

Result:

- code easier to test,
- transaction safer,
- audit consistent,
- rollout safer,
- notification reliable,
- boundary clear,
- migration easier.

---

## 32. What Top Engineers Notice

A top engineer does not merely ask:

```text
Can this compile?
```

They ask:

```text
Can this survive 5 years of change?
Can we debug it at 2 AM?
Can we prove why a regulatory decision happened?
Can we migrate runtime without rewriting domain?
Can we test failure modes without full app server?
Can we roll out behavior safely?
Can we remove flags after rollout?
Can we keep transaction and side effects consistent?
Can new engineers understand ownership boundaries?
```

That is the difference between code that works and architecture that remains operable.

---

## 33. Summary

Key takeaways:

1. Runtime architecture is ownership architecture.
2. CDI should support boundaries, not replace architecture.
3. Domain should stay mostly independent of container details.
4. Application services are strong use case and transaction boundaries.
5. Ports/adapters isolate persistence, external systems, resources, and vendor APIs.
6. Qualifiers are routing contracts.
7. Producers are local composition roots.
8. Interceptors are for invocation-level cross-cutting concerns.
9. Decorators are for semantic business wrapping.
10. Config should be typed, validated, and centralized by capability.
11. Feature flags should select strategies, not pollute all methods.
12. CDI events are local; integration events need durable messaging/outbox.
13. Audit is a first-class architecture concern.
14. Runtime invariants should be documented and reviewed.
15. Good architecture makes container behavior explicit, testable, and observable.

---

## 34. Practice Exercises

### Exercise 1 — Boundary Identification

Take one existing service class and label each line as one of:

- transport concern,
- application orchestration,
- domain rule,
- persistence,
- config,
- feature flag,
- audit,
- external integration,
- transaction,
- security.

If one method contains more than five categories, it is likely too coupled.

### Exercise 2 — Config Boundary Refactor

Find all direct `@ConfigProperty` usages in a module. Group them into typed config classes by capability:

- approval config,
- notification config,
- external system config,
- retry config,
- audit config.

Add validation and safe diagnostic summary.

### Exercise 3 — Feature Flag Refactor

Find a nested flag branch. Refactor it into:

- interface,
- legacy implementation,
- modern implementation,
- selector implementation,
- tests for each variant.

### Exercise 4 — Transaction Boundary Review

List all `@Transactional` methods. Classify them:

- resource,
- use case,
- repository,
- adapter,
- observer,
- scheduled job.

Then decide whether transaction belongs there.

### Exercise 5 — Runtime Invariant Document

Pick one critical use case and write:

```text
Transaction invariant:
Security invariant:
Config invariant:
Feature flag invariant:
Audit invariant:
Async/event invariant:
Failure invariant:
```

---

## 35. Closing

Part ini mengubah CDI/Jakarta runtime dari kumpulan annotation menjadi architecture toolkit.

Part berikutnya akan membahas:

```text
Part 034 — Migration and Modernization Playbook
```

Di sana kita akan menyusun playbook modernisasi dari legacy Java EE/Jakarta EE runtime menuju arsitektur yang lebih maintainable: `javax` ke `jakarta`, EJB ke CDI bila tepat, JNDI ke config/resource abstraction, EAR/WAR modernization, Java 8 menuju 17/21/25, testing migration, rollback strategy, dan strangler pattern.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-032](./learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-032.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 034 — Migration and Modernization Playbook](./learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-034.md)
