# learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-035

# Part 035 — Capstone: Designing a Production-Grade Enterprise Runtime Skeleton

> Seri: `learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime`  
> Bagian: `035` dari `035`  
> Status: **bagian terakhir / seri selesai setelah bagian ini**  
> Target pembaca: engineer yang sudah memahami Java, Jakarta EE/Jakarta CDI, JAX-RS, JPA, validation, testing, concurrency, dan ingin merancang runtime enterprise yang bisa dipertanggungjawabkan di produksi.

---

## 0. Tujuan Capstone

Bagian ini menyatukan seluruh seri menjadi satu bentuk desain nyata: **production-grade enterprise runtime skeleton**.

Kita tidak akan membuat “contoh CRUD sederhana”. Contoh seperti itu terlalu dangkal untuk topik ini. Yang ingin dibangun adalah kerangka runtime untuk sistem enterprise dengan karakteristik:

- banyak modul,
- banyak boundary,
- konfigurasi per environment,
- integrasi external system,
- auditability,
- transaction boundary,
- feature flag,
- policy enforcement,
- runtime observability,
- predictable failure behavior,
- bisa dites tanpa harus selalu menjalankan full application server,
- bisa dimigrasikan dari Java EE/`javax.*` ke Jakarta EE/`jakarta.*`,
- tetap masuk akal dari Java 8 sampai Java 25.

Domain contoh yang dipakai:

> **Regulatory Case Management / Enforcement Lifecycle Platform**

Ini domain yang cukup kompleks karena biasanya memiliki:

- application/case lifecycle,
- assessment,
- escalation,
- approval,
- correspondence,
- audit trail,
- external registry integration,
- role-based authorization,
- SLA,
- feature rollout per agency/tenant,
- compliance defensibility.

Tujuan bagian ini bukan memberi satu framework final yang harus ditiru mentah-mentah, tetapi memberi **mental model dan skeleton** yang bisa diadaptasi ke Jakarta EE server, WildFly, Payara, Open Liberty, Quarkus, Helidon MP, atau runtime Jakarta/MicroProfile lain.

---

## 1. Prinsip Desain Utama

Production-grade runtime skeleton harus menjawab pertanyaan berikut secara eksplisit:

```text
1. Siapa yang memiliki lifecycle object?
2. Di mana transaction boundary berada?
3. Di mana authorization/policy enforcement terjadi?
4. Di mana audit trail diproduksi?
5. Di mana configuration dibaca dan divalidasi?
6. Di mana feature flag dievaluasi?
7. Bagaimana implementasi dipilih per environment/tenant/feature?
8. Bagaimana external dependency diisolasi?
9. Bagaimana error diklasifikasi dan diobservasi?
10. Bagaimana test mengganti dependency tanpa mengubah production code?
```

Top engineer tidak hanya menulis class dan annotation. Mereka mendesain **runtime contract**.

Runtime contract adalah pernyataan implisit/eksplisit bahwa:

- object tertentu managed oleh CDI/container,
- object tertentu unmanaged dan harus dibuat manual,
- resource tertentu hanya boleh dibuat melalui producer,
- config tertentu wajib ada sebelum aplikasi menerima traffic,
- feature tertentu boleh berubah runtime,
- transaksi hanya boleh dibuka di application boundary,
- audit harus terjadi satu kali dan tidak boleh silent failure,
- external call tidak boleh dilakukan dalam constructor,
- request-scoped bean tidak boleh bocor ke async task,
- dependency selection harus bisa dijelaskan saat incident.

---

## 2. High-Level Architecture

Skeleton besar:

```text
┌──────────────────────────────────────────────────────────────────────┐
│                          Runtime Container                           │
│               Jakarta EE / CDI / MicroProfile Runtime                │
└──────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────┐
│                          API Boundary Layer                          │
│      JAX-RS resource / Servlet endpoint / Messaging endpoint          │
│                                                                      │
│  Responsibility:                                                     │
│  - parse request                                                     │
│  - authenticate principal already supplied by security layer          │
│  - validate input shape                                              │
│  - call application use case                                         │
│  - map result/error to response                                      │
└──────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────┐
│                       Application Use Case Layer                      │
│                                                                      │
│  Responsibility:                                                     │
│  - transaction boundary                                               │
│  - authorization/policy boundary                                      │
│  - orchestration                                                      │
│  - idempotency boundary                                               │
│  - audit/event publication                                            │
└──────────────────────────────────────────────────────────────────────┘
                                    │
             ┌──────────────────────┼──────────────────────┐
             ▼                      ▼                      ▼
┌──────────────────────┐ ┌──────────────────────┐ ┌──────────────────────┐
│     Domain Layer      │ │ Infrastructure Ports │ │ Runtime Services      │
│                      │ │ / Adapters            │ │                      │
│ - lifecycle rules     │ │ - repositories        │ │ - config facade       │
│ - state transitions   │ │ - external clients    │ │ - feature flags       │
│ - invariant checks    │ │ - document storage    │ │ - audit writer        │
│ - policy decisions    │ │ - notification        │ │ - clock/id generator  │
└──────────────────────┘ └──────────────────────┘ └──────────────────────┘
```

Arsitektur ini memisahkan:

- **API boundary**: menangani protokol.
- **Application boundary**: menangani use case dan transaction.
- **Domain layer**: menangani aturan bisnis murni.
- **Infrastructure adapter**: menangani database/external systems.
- **Runtime service layer**: menangani konfigurasi, feature flags, audit, clock, id generator, dan cross-cutting runtime contracts.

Prinsip penting:

> CDI boleh dipakai untuk wiring, lifecycle, dan cross-cutting runtime behavior. Tetapi domain rule sebaiknya tidak tergantung pada CDI annotation jika tidak perlu.

---

## 3. Suggested Package Structure

Contoh struktur package:

```text
com.acme.regulatory
├── api
│   ├── rest
│   │   ├── CaseResource.java
│   │   ├── AppealResource.java
│   │   └── ErrorMapper.java
│   └── dto
│       ├── SubmitCaseRequest.java
│       ├── SubmitCaseResponse.java
│       └── CaseView.java
│
├── application
│   ├── caseflow
│   │   ├── SubmitCaseUseCase.java
│   │   ├── EscalateCaseUseCase.java
│   │   ├── ApproveCaseUseCase.java
│   │   └── CloseCaseUseCase.java
│   ├── command
│   ├── result
│   └── boundary
│       ├── UseCase.java
│       ├── TransactionalBoundary.java
│       ├── AuditedOperation.java
│       ├── IdempotentOperation.java
│       └── FeatureGated.java
│
├── domain
│   ├── casefile
│   │   ├── CaseFile.java
│   │   ├── CaseStatus.java
│   │   ├── CaseDecision.java
│   │   ├── CaseLifecyclePolicy.java
│   │   └── CaseTransitionException.java
│   ├── enforcement
│   ├── correspondence
│   └── shared
│       ├── DomainEvent.java
│       ├── DomainException.java
│       └── ValueObject.java
│
├── port
│   ├── CaseRepository.java
│   ├── AuditPort.java
│   ├── NotificationPort.java
│   ├── ExternalRegistryPort.java
│   ├── DocumentStoragePort.java
│   ├── FeatureFlagPort.java
│   ├── ClockPort.java
│   └── IdGeneratorPort.java
│
├── adapter
│   ├── persistence
│   │   ├── JpaCaseRepository.java
│   │   └── CaseEntityMapper.java
│   ├── audit
│   │   ├── DatabaseAuditAdapter.java
│   │   └── AsyncAuditAdapter.java
│   ├── external
│   │   ├── RegistryHttpClient.java
│   │   └── RegistryClientProducer.java
│   ├── notification
│   └── document
│
├── runtime
│   ├── config
│   │   ├── RuntimeConfig.java
│   │   ├── RequiredConfigValidator.java
│   │   └── ConfigDiagnostics.java
│   ├── feature
│   │   ├── FeatureFlagService.java
│   │   ├── FeatureFlagDecision.java
│   │   └── FeatureFlagInterceptor.java
│   ├── audit
│   │   ├── AuditInterceptor.java
│   │   ├── AuditContext.java
│   │   └── AuditEvent.java
│   ├── observability
│   │   ├── CorrelationIdFilter.java
│   │   ├── RuntimeHealthCheck.java
│   │   └── RuntimeDiagnosticsResource.java
│   ├── producer
│   │   ├── ObjectMapperProducer.java
│   │   ├── HttpClientProducer.java
│   │   ├── ExecutorProducer.java
│   │   └── ClockProducer.java
│   └── qualifier
│       ├── PrimaryRegistry.java
│       ├── MockRegistry.java
│       ├── PersistentAudit.java
│       └── InMemoryAudit.java
│
└── bootstrap
    ├── StartupValidator.java
    └── RuntimeReadiness.java
```

Ini bukan struktur wajib, tetapi memberi separation of concerns yang jelas.

---

## 4. Dependency Direction

Dependency harus mengarah ke dalam, bukan acak.

```text
api ───────────────► application ───────────────► domain
                         │                         ▲
                         ▼                         │
                       port ───────────────────────┘
                         ▲
                         │
adapter ─────────────────┘

runtime/config/feature/audit/observability
    dipakai oleh application/adapter dengan boundary yang jelas,
    bukan disebar sembarangan ke domain.
```

Rule sederhana:

```text
domain        tidak tahu CDI, JPA, JAX-RS, MicroProfile Config, HTTP, database.
application   boleh tahu port, transaction annotation, audit/feature boundary annotation.
adapter       tahu teknologi konkret.
runtime       menyediakan technical services dan cross-cutting behavior.
api           tahu protocol mapping.
```

Domain yang bersih membuat test cepat dan deterministik. Runtime yang eksplisit membuat production behavior dapat diaudit.

---

## 5. Boundary Annotations

Agar runtime behavior tidak tersebar sebagai `if`, `try/catch`, dan logging manual di semua method, buat annotation boundary yang bermakna.

Contoh:

```java
package com.acme.regulatory.application.boundary;

import jakarta.interceptor.InterceptorBinding;
import java.lang.annotation.Retention;
import java.lang.annotation.Target;

import static java.lang.annotation.ElementType.METHOD;
import static java.lang.annotation.ElementType.TYPE;
import static java.lang.annotation.RetentionPolicy.RUNTIME;

@InterceptorBinding
@Target({ TYPE, METHOD })
@Retention(RUNTIME)
public @interface AuditedOperation {
    String action();
    String module();
}
```

```java
package com.acme.regulatory.application.boundary;

import jakarta.interceptor.InterceptorBinding;
import java.lang.annotation.Retention;
import java.lang.annotation.Target;

import static java.lang.annotation.ElementType.METHOD;
import static java.lang.annotation.ElementType.TYPE;
import static java.lang.annotation.RetentionPolicy.RUNTIME;

@InterceptorBinding
@Target({ TYPE, METHOD })
@Retention(RUNTIME)
public @interface FeatureGated {
    String value();
    boolean failClosed() default true;
}
```

```java
package com.acme.regulatory.application.boundary;

import jakarta.interceptor.InterceptorBinding;
import java.lang.annotation.Retention;
import java.lang.annotation.Target;

import static java.lang.annotation.ElementType.METHOD;
import static java.lang.annotation.ElementType.TYPE;
import static java.lang.annotation.RetentionPolicy.RUNTIME;

@InterceptorBinding
@Target({ TYPE, METHOD })
@Retention(RUNTIME)
public @interface IdempotentOperation {
    String keyExpression();
}
```

Tujuan annotation ini bukan mempercantik kode. Tujuannya adalah membuat runtime contract terlihat pada method use case.

Contoh:

```java
@ApplicationScoped
public class SubmitCaseUseCase {

    private final CaseRepository cases;
    private final CaseLifecyclePolicy lifecyclePolicy;
    private final ExternalRegistryPort registry;
    private final DomainEventPublisher events;

    @Inject
    public SubmitCaseUseCase(
            CaseRepository cases,
            CaseLifecyclePolicy lifecyclePolicy,
            ExternalRegistryPort registry,
            DomainEventPublisher events) {
        this.cases = cases;
        this.lifecyclePolicy = lifecyclePolicy;
        this.registry = registry;
        this.events = events;
    }

    @Transactional
    @AuditedOperation(module = "CASE", action = "SUBMIT_CASE")
    @FeatureGated(value = "case.submit.v2", failClosed = true)
    @IdempotentOperation(keyExpression = "command.requestId")
    public SubmitCaseResult execute(SubmitCaseCommand command) {
        var externalProfile = registry.lookup(command.applicantIdentifier());

        var caseFile = CaseFile.submit(
                command.applicantIdentifier(),
                command.caseType(),
                externalProfile,
                lifecyclePolicy);

        cases.save(caseFile);
        events.publish(caseFile.pullDomainEvents());

        return SubmitCaseResult.accepted(caseFile.id(), caseFile.status());
    }
}
```

Dari method tersebut, engineer baru bisa langsung melihat:

- ini use case boundary,
- transaksi ada di sini,
- audit wajib,
- feature flag mengontrol akses,
- idempotency wajib,
- external registry dipanggil melalui port,
- domain entity tidak tahu CDI.

---

## 6. Transaction Boundary Rule

Salah satu kesalahan umum enterprise Java adalah transaksi dibuka terlalu rendah atau terlalu acak.

Rule yang direkomendasikan:

```text
Transaction boundary berada di application use case,
bukan di repository kecil-kecil,
bukan di domain object,
bukan di API resource kecuali API method memang langsung merupakan use case.
```

Alasan:

- use case tahu satu unit-of-work bisnis,
- repository hanya persistence operation,
- domain object harus murni rule/invariant,
- API resource harus fokus protokol,
- audit/event/idempotency biasanya melekat pada use case.

Contoh buruk:

```java
@ApplicationScoped
public class JpaCaseRepository implements CaseRepository {

    @Transactional // buruk jika semua repository method otomatis membuka transaksi sendiri
    public void save(CaseFile caseFile) {
        // persist
    }
}
```

Kenapa buruk?

- `SubmitCaseUseCase` mungkin perlu save case, audit, update SLA, dan publish event dalam satu logical unit.
- Jika repository membuka transaksi sendiri, boundary pecah dan rollback behavior sulit diprediksi.

Contoh lebih baik:

```java
@ApplicationScoped
public class SubmitCaseUseCase {

    @Transactional
    public SubmitCaseResult execute(SubmitCaseCommand command) {
        // one business transaction boundary
    }
}
```

Repository tetap bisa assume transaction aktif:

```java
@ApplicationScoped
public class JpaCaseRepository implements CaseRepository {

    @PersistenceContext
    EntityManager em;

    @Override
    public void save(CaseFile caseFile) {
        em.persist(CaseEntity.fromDomain(caseFile));
    }
}
```

---

## 7. CDI Wiring Strategy

### 7.1 Use Constructor Injection for Required Dependency

```java
@ApplicationScoped
public class EscalateCaseUseCase {

    private final CaseRepository cases;
    private final EscalationPolicy policy;
    private final NotificationPort notifications;

    @Inject
    public EscalateCaseUseCase(
            CaseRepository cases,
            EscalationPolicy policy,
            NotificationPort notifications) {
        this.cases = cases;
        this.policy = policy;
        this.notifications = notifications;
    }
}
```

Kenapa?

- dependency eksplisit,
- object valid setelah constructor,
- test mudah,
- tidak perlu reflection magic untuk unit test,
- required dependency tidak bisa lupa diisi.

### 7.2 Use Field Injection Only for Container-Owned Technical Resource When Pragmatic

Contoh wajar:

```java
@ApplicationScoped
public class JpaCaseRepository implements CaseRepository {

    @PersistenceContext
    EntityManager em;
}
```

Field injection lebih dapat diterima untuk resource yang memang disediakan container dan sulit dibuat manual, tetapi untuk service dependency tetap lebih baik constructor injection.

### 7.3 Avoid `Instance<T>` Unless Runtime Selection Is Truly Needed

`Instance<T>` kuat, tetapi mudah berubah menjadi service locator.

Contoh legitimate:

```java
@ApplicationScoped
public class RegistryClientRouter {

    private final Instance<ExternalRegistryPort> registries;

    @Inject
    public RegistryClientRouter(@Any Instance<ExternalRegistryPort> registries) {
        this.registries = registries;
    }

    public ExternalRegistryPort select(RegistryProvider provider) {
        return switch (provider) {
            case PRIMARY -> registries.select(new PrimaryRegistryLiteral()).get();
            case MOCK -> registries.select(new MockRegistryLiteral()).get();
        };
    }
}
```

Gunakan hanya bila selection memang bagian dari requirement runtime.

---

## 8. Qualifier Strategy

Qualifier adalah routing table type-safe.

Contoh:

```java
@Qualifier
@Retention(RUNTIME)
@Target({ FIELD, PARAMETER, METHOD, TYPE })
public @interface PrimaryRegistry {}
```

```java
@Qualifier
@Retention(RUNTIME)
@Target({ FIELD, PARAMETER, METHOD, TYPE })
public @interface MockRegistry {}
```

Adapter:

```java
@PrimaryRegistry
@ApplicationScoped
public class HttpExternalRegistryAdapter implements ExternalRegistryPort {
    // real HTTP integration
}
```

```java
@MockRegistry
@ApplicationScoped
public class MockExternalRegistryAdapter implements ExternalRegistryPort {
    // local/mock behavior for dev/test
}
```

Injection eksplisit:

```java
@ApplicationScoped
public class RegistryValidationService {

    private final ExternalRegistryPort registry;

    @Inject
    public RegistryValidationService(@PrimaryRegistry ExternalRegistryPort registry) {
        this.registry = registry;
    }
}
```

Decision rule:

```text
Use qualifier when implementation identity is part of wiring contract.
Use config/profile/feature flag when implementation identity can change by environment or runtime decision.
Do not use @Named string unless integration requires name-based resolution.
```

---

## 9. Producer Strategy

Producer dipakai untuk object yang:

- bukan CDI bean natural,
- perlu factory/configuration,
- perlu cleanup/disposer,
- datang dari third-party library,
- harus disediakan sebagai runtime resource.

Contoh HTTP client:

```java
@ApplicationScoped
public class HttpClientProducer {

    @Inject
    RuntimeConfig config;

    @Produces
    @ApplicationScoped
    public HttpClient httpClient() {
        return HttpClient.newBuilder()
                .connectTimeout(config.externalConnectTimeout())
                .build();
    }
}
```

Contoh object mapper:

```java
@ApplicationScoped
public class ObjectMapperProducer {

    @Produces
    @ApplicationScoped
    public ObjectMapper objectMapper() {
        return new ObjectMapper()
                .findAndRegisterModules()
                .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);
    }
}
```

Contoh clock:

```java
@ApplicationScoped
public class ClockProducer {

    @Produces
    @ApplicationScoped
    public Clock clock(RuntimeConfig config) {
        return Clock.system(config.zoneId());
    }
}
```

Clock sebagai dependency membuat test deterministic:

```java
class CaseLifecyclePolicyTest {

    @Test
    void overdue_after_sla_deadline() {
        Clock fixed = Clock.fixed(Instant.parse("2026-06-16T00:00:00Z"), ZoneOffset.UTC);
        var policy = new CaseLifecyclePolicy(fixed);

        // test rule
    }
}
```

---

## 10. Configuration Skeleton

Buat facade konfigurasi yang memusatkan nama property dan validasi.

```java
@ApplicationScoped
public class RuntimeConfig {

    @Inject
    @ConfigProperty(name = "app.env")
    String environment;

    @Inject
    @ConfigProperty(name = "app.instance-id")
    String instanceId;

    @Inject
    @ConfigProperty(name = "external.registry.base-url")
    URI registryBaseUrl;

    @Inject
    @ConfigProperty(name = "external.registry.connect-timeout", defaultValue = "PT3S")
    Duration registryConnectTimeout;

    @Inject
    @ConfigProperty(name = "external.registry.read-timeout", defaultValue = "PT10S")
    Duration registryReadTimeout;

    @Inject
    @ConfigProperty(name = "audit.fail-closed", defaultValue = "true")
    boolean auditFailClosed;

    public Environment environment() {
        return Environment.parse(environment);
    }

    public URI registryBaseUrl() {
        return registryBaseUrl;
    }

    public Duration externalConnectTimeout() {
        return registryConnectTimeout;
    }

    public Duration externalReadTimeout() {
        return registryReadTimeout;
    }

    public boolean auditFailClosed() {
        return auditFailClosed;
    }
}
```

Validasi startup:

```java
@ApplicationScoped
public class RequiredConfigValidator {

    private final RuntimeConfig config;

    @Inject
    public RequiredConfigValidator(RuntimeConfig config) {
        this.config = config;
    }

    public void validate() {
        requireAbsoluteUri("external.registry.base-url", config.registryBaseUrl());
        requirePositive("external.registry.connect-timeout", config.externalConnectTimeout());
        requirePositive("external.registry.read-timeout", config.externalReadTimeout());
    }

    private void requireAbsoluteUri(String name, URI value) {
        if (value == null || !value.isAbsolute()) {
            throw new IllegalStateException("Invalid required config: " + name);
        }
    }

    private void requirePositive(String name, Duration value) {
        if (value == null || value.isZero() || value.isNegative()) {
            throw new IllegalStateException("Invalid required config: " + name);
        }
    }
}
```

Startup hook:

```java
@ApplicationScoped
public class StartupValidator {

    private final RequiredConfigValidator configValidator;

    @Inject
    public StartupValidator(RequiredConfigValidator configValidator) {
        this.configValidator = configValidator;
    }

    public void onStartup(@Observes @Initialized(ApplicationScoped.class) Object event) {
        configValidator.validate();
    }
}
```

Prinsip:

```text
Fail fast untuk config wajib.
Default hanya untuk nilai yang benar-benar aman.
Secret tidak pernah dilog mentah.
Config diagnostics harus redact.
Runtime mutable config harus diberi TTL/observability.
```

---

## 11. Feature Flag Skeleton

Port:

```java
public interface FeatureFlagPort {
    FeatureFlagDecision evaluate(String key, EvaluationContext context, boolean defaultValue);
}
```

Decision:

```java
public record FeatureFlagDecision(
        String key,
        boolean enabled,
        String variant,
        String reason,
        Instant evaluatedAt) {
}
```

Context:

```java
public record EvaluationContext(
        String userId,
        String agency,
        String environment,
        Map<String, String> attributes) {
}
```

Service:

```java
@ApplicationScoped
public class FeatureFlagService {

    private final FeatureFlagPort flags;
    private final RuntimeConfig config;
    private final Clock clock;

    @Inject
    public FeatureFlagService(
            FeatureFlagPort flags,
            RuntimeConfig config,
            Clock clock) {
        this.flags = flags;
        this.config = config;
        this.clock = clock;
    }

    public FeatureFlagDecision evaluate(String key, EvaluationContext context, boolean defaultValue) {
        try {
            return flags.evaluate(key, context, defaultValue);
        } catch (RuntimeException e) {
            return new FeatureFlagDecision(
                    key,
                    defaultValue,
                    "default",
                    "FLAG_PROVIDER_ERROR",
                    clock.instant());
        }
    }
}
```

Interceptor:

```java
@Interceptor
@FeatureGated(value = "", failClosed = true)
@Priority(Interceptor.Priority.APPLICATION + 200)
public class FeatureFlagInterceptor {

    @Inject
    FeatureFlagService featureFlags;

    @Inject
    EvaluationContextFactory contextFactory;

    @AroundInvoke
    public Object around(InvocationContext ctx) throws Exception {
        FeatureGated binding = findBinding(ctx);
        EvaluationContext evalContext = contextFactory.current();

        FeatureFlagDecision decision = featureFlags.evaluate(
                binding.value(),
                evalContext,
                !binding.failClosed());

        if (!decision.enabled()) {
            throw new FeatureDisabledException(binding.value(), decision.reason());
        }

        return ctx.proceed();
    }

    private FeatureGated findBinding(InvocationContext ctx) {
        FeatureGated method = ctx.getMethod().getAnnotation(FeatureGated.class);
        if (method != null) return method;
        return ctx.getTarget().getClass().getAnnotation(FeatureGated.class);
    }
}
```

Catatan desain:

- fail-closed untuk regulatory/compliance behavior,
- fail-open hanya untuk UX enhancement yang aman,
- flag decision harus bisa diaudit/ditrace,
- flag key harus punya owner dan expiry date,
- flag yang sudah permanen harus dihapus.

---

## 12. Audit Skeleton

Audit adalah runtime invariant penting untuk enterprise/regulatory system.

Audit event:

```java
public record AuditEvent(
        String correlationId,
        String actor,
        String module,
        String action,
        String entityType,
        String entityId,
        String outcome,
        Instant occurredAt,
        Map<String, Object> metadata) {
}
```

Audit port:

```java
public interface AuditPort {
    void write(AuditEvent event);
}
```

Interceptor:

```java
@Interceptor
@AuditedOperation(module = "", action = "")
@Priority(Interceptor.Priority.APPLICATION + 100)
public class AuditInterceptor {

    @Inject
    AuditPort audit;

    @Inject
    AuditContext auditContext;

    @Inject
    RuntimeConfig config;

    @Inject
    Clock clock;

    @AroundInvoke
    public Object around(InvocationContext ctx) throws Exception {
        AuditedOperation binding = findBinding(ctx);
        Instant start = clock.instant();

        try {
            Object result = ctx.proceed();
            writeAudit(binding, "SUCCESS", null, start);
            return result;
        } catch (Exception e) {
            writeAudit(binding, "FAILURE", e, start);
            throw e;
        }
    }

    private void writeAudit(
            AuditedOperation binding,
            String outcome,
            Exception error,
            Instant occurredAt) {
        try {
            audit.write(new AuditEvent(
                    auditContext.correlationId(),
                    auditContext.actor(),
                    binding.module(),
                    binding.action(),
                    auditContext.entityType().orElse(null),
                    auditContext.entityId().orElse(null),
                    outcome,
                    occurredAt,
                    auditContext.metadata(error)));
        } catch (RuntimeException auditFailure) {
            if (config.auditFailClosed()) {
                throw auditFailure;
            }
            // In fail-open mode, emit metric/log. Do not silently swallow.
        }
    }

    private AuditedOperation findBinding(InvocationContext ctx) {
        AuditedOperation method = ctx.getMethod().getAnnotation(AuditedOperation.class);
        if (method != null) return method;
        return ctx.getTarget().getClass().getAnnotation(AuditedOperation.class);
    }
}
```

Important nuance:

```text
Audit success written before transaction commit can be misleading if transaction later rolls back.
Audit in same transaction can disappear if business transaction rolls back.
Audit in separate transaction can survive rollback but may record attempted operation.
```

Karena itu audit policy harus eksplisit:

| Audit Type | Transaction Strategy | Suitable For |
|---|---|---|
| Business-state audit | same transaction | audit sebagai bagian dari state change |
| Security/access audit | separate transaction / append-only sink | login, forbidden access, suspicious operation |
| Attempt audit | separate transaction | record attempted action even if business fails |
| Debug trace | observability pipeline | non-authoritative diagnostics |

---

## 13. Decorator Skeleton for Semantic Business Wrapping

Interceptor cocok untuk technical cross-cutting behavior. Decorator cocok untuk semantic wrapping terhadap business interface.

Port:

```java
public interface CaseDecisionService {
    CaseDecision decide(CaseFile caseFile, DecisionContext context);
}
```

Implementation:

```java
@ApplicationScoped
public class DefaultCaseDecisionService implements CaseDecisionService {
    @Override
    public CaseDecision decide(CaseFile caseFile, DecisionContext context) {
        return caseFile.evaluate(context);
    }
}
```

Decorator:

```java
@Decorator
@Priority(Interceptor.Priority.APPLICATION + 300)
public class ComplianceDecisionDecorator implements CaseDecisionService {

    @Inject
    @Delegate
    CaseDecisionService delegate;

    @Inject
    CompliancePolicy compliancePolicy;

    @Override
    public CaseDecision decide(CaseFile caseFile, DecisionContext context) {
        compliancePolicy.assertDecisionAllowed(caseFile, context);
        CaseDecision decision = delegate.decide(caseFile, context);
        compliancePolicy.assertDecisionDefensible(caseFile, decision, context);
        return decision;
    }
}
```

Kenapa decorator?

- karena compliance check adalah semantic part dari business interface,
- bukan sekadar logging/metrics,
- bisa membungkus semua implementasi `CaseDecisionService`,
- lebih jelas dibanding inheritance.

---

## 14. External Client Adapter Skeleton

External system harus diisolasi di adapter.

Port:

```java
public interface ExternalRegistryPort {
    ExternalProfile lookup(ApplicantIdentifier applicantIdentifier);
}
```

Adapter:

```java
@PrimaryRegistry
@ApplicationScoped
public class RegistryHttpClient implements ExternalRegistryPort {

    private final HttpClient httpClient;
    private final RuntimeConfig config;
    private final ObjectMapper mapper;

    @Inject
    public RegistryHttpClient(
            HttpClient httpClient,
            RuntimeConfig config,
            ObjectMapper mapper) {
        this.httpClient = httpClient;
        this.config = config;
        this.mapper = mapper;
    }

    @Override
    public ExternalProfile lookup(ApplicantIdentifier applicantIdentifier) {
        HttpRequest request = HttpRequest.newBuilder()
                .uri(config.registryBaseUrl().resolve("/profiles/" + applicantIdentifier.value()))
                .timeout(config.externalReadTimeout())
                .GET()
                .build();

        try {
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            return map(response);
        } catch (IOException e) {
            throw new ExternalRegistryUnavailableException(e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new ExternalRegistryUnavailableException(e);
        }
    }

    private ExternalProfile map(HttpResponse<String> response) throws IOException {
        if (response.statusCode() == 404) {
            throw new ExternalProfileNotFoundException();
        }
        if (response.statusCode() >= 500) {
            throw new ExternalRegistryUnavailableException();
        }
        if (response.statusCode() >= 400) {
            throw new ExternalRegistryRejectedRequestException(response.statusCode());
        }
        return mapper.readValue(response.body(), ExternalProfile.class);
    }
}
```

Important rules:

```text
External adapter translates protocol errors into domain/application meaningful exceptions.
External adapter owns timeout/retry/breaker policy or delegates to dedicated resilience service.
Application layer should not inspect HTTP status code.
Domain layer should not know external protocol.
```

---

## 15. Error Taxonomy

Production-grade skeleton perlu error taxonomy.

```text
DomainException
├── InvalidCaseTransitionException
├── CaseAlreadyClosedException
├── MissingRequiredDocumentException

ApplicationException
├── FeatureDisabledException
├── IdempotencyConflictException
├── AuthorizationDeniedException

InfrastructureException
├── ExternalRegistryUnavailableException
├── DocumentStorageUnavailableException
├── AuditWriteFailedException
├── DatabaseUnavailableException

ConfigurationException
├── MissingRequiredConfigException
├── InvalidConfigException
├── SecretUnavailableException

RuntimeWiringException
├── AmbiguousRuntimeSelectionException
├── UnsupportedProfileException
├── MissingRuntimeAdapterException
```

Mapping rule:

| Exception Type | HTTP/API Mapping | Retry? | Alert? |
|---|---:|---:|---:|
| invalid domain transition | 409 | no | no/low |
| validation failure | 400 | no | no |
| authorization denied | 403 | no | security metric |
| feature disabled | 404/403/409 depending API contract | no | no |
| external unavailable | 503 | yes | yes if sustained |
| database unavailable | 503/500 | yes | yes |
| config invalid at startup | fail startup | no | yes |
| audit write failed | 500 or degrade depending policy | maybe | yes |

Top-level mapper:

```java
@Provider
public class ErrorMapper implements ExceptionMapper<Throwable> {

    @Inject
    CorrelationIdProvider correlationIds;

    @Override
    public Response toResponse(Throwable error) {
        String correlationId = correlationIds.current();

        if (error instanceof DomainException domain) {
            return domainResponse(domain, correlationId);
        }
        if (error instanceof FeatureDisabledException feature) {
            return featureDisabledResponse(feature, correlationId);
        }
        if (error instanceof ExternalRegistryUnavailableException external) {
            return unavailableResponse(external, correlationId);
        }

        return internalErrorResponse(error, correlationId);
    }
}
```

---

## 16. Observability Skeleton

Minimal observability:

```text
1. Correlation ID
2. Structured log
3. Metrics
4. Health/readiness
5. Safe runtime diagnostics
6. Trace boundary for external calls
7. Config diagnostics with redaction
8. Feature flag decision visibility
9. Audit outcome metrics
10. Dependency/runtime startup report
```

Correlation filter:

```java
@Provider
@Priority(Priorities.AUTHENTICATION)
public class CorrelationIdFilter implements ContainerRequestFilter, ContainerResponseFilter {

    private static final String HEADER = "X-Correlation-Id";

    @Inject
    CorrelationIdProvider correlationIds;

    @Override
    public void filter(ContainerRequestContext requestContext) {
        String incoming = requestContext.getHeaderString(HEADER);
        correlationIds.setOrGenerate(incoming);
    }

    @Override
    public void filter(ContainerRequestContext requestContext, ContainerResponseContext responseContext) {
        responseContext.getHeaders().putSingle(HEADER, correlationIds.current());
        correlationIds.clear();
    }
}
```

Health check categories:

```text
Liveness:
- process alive
- event loop/thread pool not dead

Readiness:
- required config valid
- database reachable
- required external dependency mode known
- feature flag provider initialized or fallback policy known
- migration state acceptable

Diagnostics:
- active environment/profile
- implementation selected for important ports
- config source names, not secret values
- app version/build commit
- Jakarta/MicroProfile runtime version
```

Diagnostics must not leak secrets.

---

## 17. Context Propagation and Async Rule

Async code must be explicit about context.

Bad:

```java
new Thread(() -> service.doWork()).start();
```

Why bad:

- unmanaged thread,
- no container lifecycle,
- request/security context may disappear,
- shutdown not coordinated,
- metrics/tracing broken,
- resource leak risk.

Better:

```java
@ApplicationScoped
public class AsyncNotificationService {

    @Resource
    ManagedExecutorService executor;

    public CompletionStage<Void> sendLater(Notification notification) {
        return CompletableFuture.runAsync(() -> send(notification), executor);
    }

    private void send(Notification notification) {
        // send notification
    }
}
```

But also ask:

```text
Which context should propagate?
- correlation id? yes
- security principal? maybe
- request scope? usually no, unless explicitly activated
- transaction? usually no for async fire-and-forget
- tenant/agency context? yes if required for routing/audit
```

Async design must define:

- queue ownership,
- retry policy,
- idempotency key,
- shutdown behavior,
- failure sink,
- observability.

---

## 18. Testing Strategy

Testing layers:

```text
Fast unit test:
- domain rule
- application use case with fake ports
- config validation logic
- feature flag decision logic

CDI component test:
- qualifier resolution
- producer wiring
- interceptor/decorator behavior
- alternative/test bean replacement

Integration test:
- DB repository
- external adapter with mock server
- transaction rollback
- JNDI/resource binding if app-server-based

End-to-end smoke:
- deployed runtime
- health/readiness
- real container startup
- critical use case path
```

Example pure use case test:

```java
class SubmitCaseUseCaseTest {

    @Test
    void submit_creates_case_and_publishes_event() {
        var cases = new InMemoryCaseRepository();
        var registry = new FakeRegistryPort();
        var events = new RecordingDomainEventPublisher();
        var policy = new CaseLifecyclePolicy(Clock.fixed(
                Instant.parse("2026-06-16T00:00:00Z"),
                ZoneOffset.UTC));

        var useCase = new SubmitCaseUseCase(cases, policy, registry, events);

        var result = useCase.execute(new SubmitCaseCommand(
                new RequestId("REQ-001"),
                new ApplicantIdentifier("A-123"),
                CaseType.ENFORCEMENT));

        assertEquals(CaseStatus.SUBMITTED, result.status());
        assertEquals(1, events.recorded().size());
    }
}
```

Notice:

- no CDI container required,
- no database,
- no HTTP,
- no feature flag provider,
- no app server.

Then separately test runtime behavior:

```text
- Does @FeatureGated block method when disabled?
- Does @AuditedOperation write SUCCESS and FAILURE?
- Does @Transactional rollback on expected exception?
- Does producer build HttpClient with configured timeout?
- Does @PrimaryRegistry resolve correct adapter?
```

---

## 19. Runtime Invariant Document

A production-grade system should document runtime invariants.

Example:

```markdown
# Runtime Invariants

## Object ownership
- All application services are CDI-managed `@ApplicationScoped` beans.
- Domain entities are not CDI-managed.
- External clients are produced by CDI producer classes.

## Transactions
- Transactions begin at application use case methods.
- Repositories must not create independent transactions by default.
- External HTTP calls inside transaction require explicit justification.

## Audit
- All mutating use cases must have `@AuditedOperation`.
- Audit failure is fail-closed in production.
- Security/access audit is written outside business transaction.

## Configuration
- Required config is validated at startup.
- Secrets are never returned by diagnostics endpoint.
- Defaults are allowed only for safe non-production-independent values.

## Feature flags
- Every feature flag has owner, creation date, expiry date, and default behavior.
- Regulatory-impacting flags default to fail-closed.
- Completed rollout flags must be removed.

## Async
- No unmanaged threads.
- Async tasks must carry correlation id and tenant/agency context.
- Async failure must be observable.
```

This kind of document prevents “tribal runtime knowledge”.

---

## 20. Deployment Checklist

Before production deployment:

```text
Dependency / build
[ ] dependency convergence checked
[ ] no mixed javax/jakarta namespace
[ ] BOM aligned with runtime
[ ] no duplicate API jars bundled when server provides them
[ ] SBOM generated if required

Container / CDI
[ ] bean discovery mode intentional
[ ] no ambiguous dependency
[ ] no unsatisfied dependency
[ ] no unproxyable normal-scoped beans
[ ] interceptors/decorators enabled as intended
[ ] startup logs reviewed

Configuration
[ ] required config present
[ ] secrets available
[ ] config diagnostics redacted
[ ] active profile/environment explicit
[ ] no dev fallback in production

Resources
[ ] DataSource bound
[ ] executor configured
[ ] external endpoints reachable
[ ] timeout and retry policy set
[ ] JNDI names verified if used

Security / audit
[ ] authorization rules validated
[ ] audit policy tested
[ ] audit failure behavior tested
[ ] correlation ID propagated

Feature flags
[ ] default values reviewed
[ ] kill switch tested
[ ] provider fallback tested
[ ] flag owner/expiry recorded

Observability
[ ] health endpoint valid
[ ] readiness endpoint valid
[ ] metrics exposed
[ ] structured logs include correlation id
[ ] error mapper returns safe error

Testing
[ ] unit tests pass
[ ] CDI component tests pass
[ ] integration tests pass
[ ] migration smoke tests pass
[ ] rollback plan documented
```

---

## 21. Failure-Mode Matrix

| Failure | Likely Cause | Detection | Mitigation |
|---|---|---|---|
| `UnsatisfiedResolutionException` | bean not discovered, wrong qualifier, missing archive | startup failure | check bean discovery, qualifier, package namespace |
| `AmbiguousResolutionException` | multiple beans match same type/qualifier | startup failure | add qualifier, alternative, specialization, priority |
| unproxyable type | final class/method, no suitable constructor, primitive/array type | startup failure | change scope, interface, remove final, adjust design |
| `ContextNotActiveException` | request/session scoped bean used outside active context | runtime failure | avoid injecting request bean into async/singleton, activate context deliberately |
| wrong implementation selected | profile/config/qualifier mismatch | diagnostics, behavior mismatch | expose selected adapter diagnostics, test profile matrix |
| config missing | environment variable/property absent | startup failure or runtime failure | fail fast validation |
| stale feature flag | cache TTL too long or provider unreachable | inconsistent behavior | decision metrics, TTL policy, fallback rule |
| audit missing | interceptor not applied, self-invocation, async failure | audit gap | test interceptor, avoid self-invocation, fail-closed if required |
| transaction not applied | method not invoked through proxy, private method, self-call | data inconsistency | move boundary to public CDI-invoked method |
| duplicate class issue | classloader conflict, bundled API jar | `ClassCastException`, linkage error | align packaging, inspect dependency tree/server modules |
| external timeout | missing timeout or slow dependency | thread saturation, latency spike | set timeout, circuit breaker, bulkhead |
| unmanaged thread leak | manual thread creation | shutdown issue, memory leak | managed executor only |

---

## 22. What Makes This “Top 1%” Thinking?

Bukan karena memakai banyak annotation.

Yang membedakan adalah kemampuan melihat sistem sebagai **runtime graph**:

```text
source code
  ↓
dependency graph
  ↓
classloader/deployment graph
  ↓
bean discovery graph
  ↓
injection graph
  ↓
proxy/interceptor/decorator graph
  ↓
configuration graph
  ↓
transaction/resource graph
  ↓
observability/failure graph
```

Engineer biasa bertanya:

```text
Annotation apa yang harus saya taruh?
```

Engineer senior bertanya:

```text
Siapa pemilik lifecycle object ini?
Apa boundary transaksinya?
Apa failure behavior-nya?
Apa dependency selection rule-nya?
Bagaimana saya membuktikan wiring ini benar?
Bagaimana saya tahu saat produksi bahwa implementasi yang dipakai adalah yang benar?
Apa yang terjadi saat config hilang, flag provider down, audit gagal, atau context tidak aktif?
```

Itulah inti seluruh seri ini.

---

## 23. Minimal Skeleton Summary

Jika harus diringkas menjadi aturan praktis:

```text
1. Domain tetap bersih dari runtime framework.
2. Application service adalah use case boundary.
3. Transaction boundary berada di use case.
4. CDI dipakai untuk wiring, lifecycle, proxy, interceptor, decorator, producer.
5. Qualifier dipakai untuk routing type-safe.
6. Producer dipakai untuk object/resource yang butuh factory/config/cleanup.
7. Config wajib divalidasi saat startup.
8. Profile bukan feature flag.
9. Feature flag harus punya default, owner, expiry, auditability.
10. External system selalu lewat port/adapter.
11. Audit/security/metrics/idempotency ditempatkan sebagai boundary eksplisit.
12. Async selalu memakai managed executor/context propagation policy.
13. Observability harus bisa menjawab runtime selection dan failure cause.
14. Test dipisah: domain pure, CDI wiring, integration, deployment smoke.
15. Runtime invariant harus didokumentasikan.
```

---

## 24. Final Exercise

Desain satu use case berikut:

```text
Escalate enforcement case when SLA breached.
```

Requirement:

```text
- hanya case status SUBMITTED atau UNDER_REVIEW yang bisa dieskalasi
- escalation policy berbeda per agency
- feature flag `case.escalation.v2`
- audit wajib
- notification dikirim async
- transaction rollback jika update case gagal
- notification failure tidak boleh rollback case escalation
- config SLA threshold wajib ada per agency
- external registry lookup optional, jika down gunakan stale cached profile maksimal 24 jam
- semua operation harus punya correlation id
```

Coba jawab:

```text
1. Package mana yang menampung use case?
2. Port apa saja yang dibutuhkan?
3. Adapter apa saja yang dibutuhkan?
4. Annotation boundary apa yang dipakai?
5. Transaction boundary di mana?
6. Feature flag dievaluasi di mana?
7. Audit ditulis kapan?
8. Notification async memakai apa?
9. Config divalidasi di mana?
10. Failure matrix-nya seperti apa?
```

Jika bisa menjawab pertanyaan ini dengan jelas, berarti pemahaman seri ini sudah mulai berpindah dari “tahu annotation” menjadi “bisa mendesain runtime enterprise”.

---

## 25. Penutup Seri

Seri `learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime` selesai di bagian ini.

Yang sudah dibangun dari Part 000 sampai Part 035:

```text
Part 000  Orientation: Enterprise Runtime Mental Model
Part 001  Dependency Management
Part 002  API, SPI, Implementation, Provider
Part 003  javax.* to jakarta.* Migration Model
Part 004  Runtime / Container Model
Part 005  Classloaders, Modules, Deployment Isolation
Part 006  Dependency Injection Fundamentals
Part 007  JSR-330 / Jakarta Inject
Part 008  CDI Core Mental Model
Part 009  Bean Discovery and Archive Model
Part 010  CDI Scopes Deep Dive
Part 011  CDI Proxies and Method Dispatch
Part 012  Qualifiers, Alternatives, Specialization, Priority
Part 013  Producers and Disposers
Part 014  CDI Events
Part 015  Interceptors
Part 016  Decorators
Part 017  Stereotypes and Annotation Composition
Part 018  Lifecycle Callbacks
Part 019  CDI Extensions
Part 020  Enterprise Beans / EJB Mental Model
Part 021  Stateless, Stateful, Singleton Beans
Part 022  EJB Transactions, Timers, Async, Security
Part 023  Jakarta Common Annotations and Resource Injection
Part 024  Naming, JNDI, Environment Entries, Externalized Resources
Part 025  Configuration Fundamentals
Part 026  MicroProfile Config Deep Dive
Part 027  Profiles
Part 028  Feature Flags
Part 029  Conditional Beans and Runtime Selection Patterns
Part 030  Container Concurrency and Context Propagation
Part 031  Testing CDI, EJB, and Configuration-Heavy Code
Part 032  Observability and Debugging
Part 033  Architecture Patterns for Enterprise Java Runtime Design
Part 034  Migration and Modernization Playbook
Part 035  Capstone: Production-Grade Enterprise Runtime Skeleton
```

Final mental model:

```text
Enterprise Java mastery is not memorizing annotations.
It is understanding the runtime contract between code, container, configuration, resource, transaction, proxy, context, and production failure behavior.
```

---

## 26. References

Primary references for this capstone:

- Jakarta EE 11 Platform specification and release documentation.
- Jakarta CDI 4.1 specification.
- Jakarta Enterprise Beans 4.0 specification.
- Jakarta Interceptors specification.
- Jakarta Concurrency 3.1 specification.
- Jakarta Annotations specification.
- MicroProfile Config 3.1 specification.
- MicroProfile Context Propagation specification.
- OpenFeature specification.
- Jakarta EE Tutorial.
