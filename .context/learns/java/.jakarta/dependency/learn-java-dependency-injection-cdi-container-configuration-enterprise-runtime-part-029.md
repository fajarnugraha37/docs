# Part 029 — Conditional Beans and Runtime Selection Patterns

> Seri: `learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime`  
> File: `learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-029.md`  
> Level: Advanced / Top 1% Software Engineer Track  
> Target Java: 8–25  
> Target Enterprise Runtime: Java EE `javax.*`, Jakarta EE `jakarta.*`, CDI, MicroProfile Config, modern cloud/container runtime

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas:

- konfigurasi sebagai runtime contract,
- MicroProfile Config,
- profile,
- feature flag,
- CDI qualifier,
- alternative,
- producer,
- proxy,
- event,
- interceptor,
- decorator,
- container lifecycle.

Sekarang kita masuk ke pertanyaan arsitektural yang sangat sering muncul di sistem enterprise:

> “Bagaimana aplikasi memilih implementasi yang tepat tanpa membuat kode menjadi penuh `if`, service locator, global config access, atau dependency injection yang sulit dipahami?”

Contoh kasus nyata:

- Di DEV pakai fake payment gateway, di PROD pakai real gateway.
- Untuk agency A pakai connector lama, agency B pakai connector baru.
- Untuk tenant tertentu aktifkan workflow baru.
- Untuk rollout bertahap, sebagian request memakai engine baru.
- Untuk test, ganti external API client dengan in-memory implementation.
- Untuk negara/region berbeda, aturan validasi dan formatting berbeda.
- Untuk migrasi `javax` ke `jakarta`, sebagian modul masih adapter lama.
- Untuk customer premium, pakai SLA strategy berbeda.
- Untuk incident, aktifkan fallback path tanpa redeploy.

Masalah ini terlihat sederhana, tetapi kalau salah model, sistem akan berubah menjadi:

- penuh branching tidak terkontrol,
- dependency graph sulit dipahami,
- runtime behavior tidak bisa diaudit,
- test matrix meledak,
- production incident sulit ditelusuri,
- feature flag menjadi permanent architecture,
- konfigurasi berubah menjadi hidden business logic.

Bagian ini membangun mental model dan pattern untuk **conditional bean selection** dan **runtime implementation selection** secara benar.

---

## 1. Mental Model Utama

Conditional selection bukan satu masalah. Ia minimal terdiri dari empat pertanyaan berbeda:

```text
1. Kapan keputusan dibuat?
2. Siapa yang membuat keputusan?
3. Apa basis keputusan?
4. Apakah keputusan boleh berubah saat aplikasi berjalan?
```

Dari empat pertanyaan itu, kita bisa memilih pattern yang tepat.

---

## 2. Empat Waktu Keputusan

Dalam enterprise runtime, pemilihan implementasi bisa terjadi pada empat waktu.

```text
┌────────────────────┬────────────────────────────┬────────────────────────────┐
│ Decision Time       │ Meaning                    │ Example                    │
├────────────────────┼────────────────────────────┼────────────────────────────┤
│ Compile time        │ Dipilih saat build          │ Maven profile, dependency  │
│ Startup time        │ Dipilih saat container boot │ CDI alternative, producer  │
│ Request time        │ Dipilih per request/call    │ tenant, user, agency       │
│ Runtime dynamic     │ Dapat berubah tanpa restart │ feature flag, remote config│
└────────────────────┴────────────────────────────┴────────────────────────────┘
```

Ini adalah pemisahan paling penting.

Kesalahan umum adalah memakai satu mekanisme untuk semua jenis keputusan. Misalnya memakai feature flag untuk dependency yang sebenarnya harus fixed saat startup, atau memakai CDI alternative untuk keputusan yang harus berbeda per tenant/request.

---

## 3. Decision-Time Matrix

Gunakan matrix ini sebagai starting point:

| Kebutuhan | Mekanisme Umum | Cocok? |
|---|---|---|
| Implementasi berbeda antara artifact DEV dan PROD | Build profile / dependency set | Cocok jika benar-benar beda artifact |
| Implementasi berbeda antara deployment DEV/UAT/PROD | Config + producer / alternative | Cocok |
| Implementasi berbeda per tenant/request | Strategy registry / contextual selector | Cocok |
| Implementasi berubah tanpa restart | Feature flag / dynamic config / provider | Cocok |
| Implementasi untuk test | Alternative / producer override / test profile | Cocok |
| Implementasi optional berdasarkan dependency ada/tidak | CDI extension / build-time condition / optional module | Cocok tapi advanced |
| Business rule bercabang besar | Domain policy engine / rule strategy | Jangan disembunyikan sebagai DI |

---

## 4. Prinsip Besar: Selection Is Architecture, Not Utility Code

Conditional selection sering dianggap helper kecil:

```java
if (config.isNewEngineEnabled()) {
    return new NewEngine();
}
return new OldEngine();
```

Tapi di sistem besar, pemilihan implementasi adalah bagian dari arsitektur runtime.

Kenapa?

Karena selection menentukan:

- siapa yang mengeksekusi business rule,
- transaction boundary mana yang aktif,
- connector eksternal mana yang dipanggil,
- audit trail seperti apa yang dihasilkan,
- failure mode apa yang mungkin muncul,
- metric/tracing mana yang perlu dibaca,
- test matrix mana yang wajib dijalankan.

Maka selection harus memiliki:

- explicit boundary,
- observability,
- deterministic behavior,
- testability,
- ownership,
- fallback policy,
- auditability.

---

## 5. Anti-Pattern Awal: Scattered `if config`

Contoh buruk:

```java
public void process(Application app) {
    if (config.getBoolean("new.workflow.enabled")) {
        validateNew(app);
        calculateNew(app);
        submitNew(app);
    } else {
        validateOld(app);
        calculateOld(app);
        submitOld(app);
    }
}
```

Ini buruk bukan karena `if` selalu buruk. Ini buruk karena satu flag mengubah banyak behavior sekaligus di dalam satu method.

Dampaknya:

- old/new workflow tidak punya boundary jelas,
- test menjadi kombinatorial,
- rollback behavior tidak jelas,
- audit sulit tahu path mana yang berjalan,
- refactoring sulit,
- partial migration berisiko.

Model yang lebih baik:

```java
public interface ApplicationWorkflow {
    WorkflowResult process(ApplicationCommand command);
}
```

Lalu pilih implementasi di boundary yang eksplisit.

---

## 6. Anti-Pattern: Global Config Access Everywhere

Contoh buruk:

```java
public class FeeCalculator {
    public Money calculate(Application app) {
        String mode = ConfigProvider.getConfig()
            .getValue("fee.mode", String.class);

        if (mode.equals("new")) {
            return calculateNew(app);
        }
        return calculateOld(app);
    }
}
```

Masalah:

- class menyembunyikan dependency terhadap config,
- test perlu mock global config,
- tidak jelas apakah config dibaca sekali atau setiap call,
- config menjadi hidden business input,
- perubahan config bisa mengubah behavior tanpa trace eksplisit.

Lebih baik:

```java
@ApplicationScoped
public class FeeCalculatorSelector {
    private final FeeCalculator oldCalculator;
    private final FeeCalculator newCalculator;
    private final FeeModeProvider modeProvider;

    @Inject
    public FeeCalculatorSelector(
            @Legacy FeeCalculator oldCalculator,
            @Modern FeeCalculator newCalculator,
            FeeModeProvider modeProvider) {
        this.oldCalculator = oldCalculator;
        this.newCalculator = newCalculator;
        this.modeProvider = modeProvider;
    }

    public FeeCalculator select(EvaluationContext context) {
        return switch (modeProvider.modeFor(context)) {
            case LEGACY -> oldCalculator;
            case MODERN -> newCalculator;
        };
    }
}
```

Sekarang selection adalah object yang bisa dites, diobservasi, dan diaudit.

---

## 7. Anti-Pattern: Service Locator Disguised as DI

Contoh buruk:

```java
@Inject
BeanManager beanManager;

public PaymentGateway gateway(String name) {
    Set<Bean<?>> beans = beanManager.getBeans(name);
    Bean<?> bean = beanManager.resolve(beans);
    return (PaymentGateway) beanManager.getReference(
        bean,
        PaymentGateway.class,
        beanManager.createCreationalContext(bean)
    );
}
```

Ini mungkin bekerja, tetapi sering menjadi service locator tersembunyi.

Masalah:

- selection tidak type-safe,
- dependency graph tidak jelas,
- refactoring sulit,
- container API bocor ke business code,
- error muncul saat runtime jauh dari sumber masalah,
- kode menjadi framework-specific.

Gunakan `BeanManager` untuk framework/extension-level code, bukan business service normal.

---

## 8. Pattern 1 — Static Compile-Time Selection

### 8.1 Kapan Dipakai

Gunakan compile-time selection ketika artifact memang berbeda.

Contoh:

- library cloud provider berbeda,
- implementation legacy tidak boleh masuk artifact produksi baru,
- customer-specific artifact,
- regulated deployment yang harus membuktikan dependency set tetap,
- native image/build-time optimized runtime.

### 8.2 Maven Example

```xml
<profiles>
    <profile>
        <id>mock-gateway</id>
        <dependencies>
            <dependency>
                <groupId>com.example</groupId>
                <artifactId>payment-mock</artifactId>
                <version>${project.version}</version>
            </dependency>
        </dependencies>
    </profile>

    <profile>
        <id>real-gateway</id>
        <dependencies>
            <dependency>
                <groupId>com.example</groupId>
                <artifactId>payment-real</artifactId>
                <version>${project.version}</version>
            </dependency>
        </dependencies>
    </profile>
</profiles>
```

### 8.3 Kelebihan

- dependency graph jelas,
- unused implementation tidak masuk artifact,
- attack surface lebih kecil,
- cocok untuk compliance,
- startup lebih deterministik.

### 8.4 Kekurangan

- perlu rebuild untuk mengganti behavior,
- sulit untuk runtime rollback,
- test matrix per artifact,
- bisa menyebabkan environment drift jika artifact berbeda tidak dikontrol.

### 8.5 Rule

```text
Gunakan compile-time selection hanya jika perbedaan itu memang artifact-level concern.
Jangan gunakan untuk business decision yang harus bisa berubah saat runtime.
```

---

## 9. Pattern 2 — CDI Qualifier-Based Static Injection

### 9.1 Kapan Dipakai

Gunakan qualifier ketika beberapa implementasi hidup bersamaan dan injection point tahu varian mana yang dibutuhkan.

Contoh:

```java
public interface NotificationSender {
    void send(Notification notification);
}
```

Qualifier:

```java
@Qualifier
@Retention(RUNTIME)
@Target({TYPE, METHOD, FIELD, PARAMETER})
public @interface EmailChannel {}

@Qualifier
@Retention(RUNTIME)
@Target({TYPE, METHOD, FIELD, PARAMETER})
public @interface SmsChannel {}
```

Implementasi:

```java
@ApplicationScoped
@EmailChannel
public class EmailNotificationSender implements NotificationSender {
    @Override
    public void send(Notification notification) {
        // send email
    }
}

@ApplicationScoped
@SmsChannel
public class SmsNotificationSender implements NotificationSender {
    @Override
    public void send(Notification notification) {
        // send SMS
    }
}
```

Consumer:

```java
@ApplicationScoped
public class NotificationService {
    private final NotificationSender emailSender;
    private final NotificationSender smsSender;

    @Inject
    public NotificationService(
            @EmailChannel NotificationSender emailSender,
            @SmsChannel NotificationSender smsSender) {
        this.emailSender = emailSender;
        this.smsSender = smsSender;
    }
}
```

### 9.2 Kelebihan

- type-safe,
- explicit,
- compile/deployment-time validation,
- mudah dites,
- tidak perlu dynamic lookup.

### 9.3 Kekurangan

- injection point harus tahu pilihan,
- tidak cocok untuk keputusan per request yang kompleks,
- qualifier bisa meledak jika dipakai untuk semua variasi kecil.

### 9.4 Rule

```text
Gunakan qualifier ketika variasi adalah bagian dari model domain/teknis yang stabil.
Jangan gunakan qualifier untuk setiap nilai config kecil.
```

---

## 10. Pattern 3 — CDI Alternatives for Deployment-Time Replacement

### 10.1 Kapan Dipakai

Gunakan alternatives ketika satu implementasi menggantikan implementasi default untuk deployment/test tertentu.

Contoh default:

```java
@ApplicationScoped
public class RealPaymentGateway implements PaymentGateway {
    @Override
    public PaymentResult charge(PaymentCommand command) {
        // real external call
    }
}
```

Alternative:

```java
@Alternative
@Priority(1)
@ApplicationScoped
public class SimulatedPaymentGateway implements PaymentGateway {
    @Override
    public PaymentResult charge(PaymentCommand command) {
        return PaymentResult.approved("SIMULATED");
    }
}
```

### 10.2 Kapan Bagus

- test replacement,
- local development,
- simulation mode,
- deployment-specific implementation,
- temporary fallback during migration.

### 10.3 Kapan Tidak Bagus

- selection per user,
- selection per tenant,
- selection berubah tanpa restart,
- behavior perlu dibandingkan old vs new dalam request yang sama,
- dual-run/shadow mode.

### 10.4 Risiko

Alternative bisa membuat dependency graph berbeda antar environment.

Maka dokumentasikan:

```text
- alternative apa yang aktif?
- aktif di environment mana?
- kenapa aman?
- bagaimana dites?
- bagaimana mendeteksi dari log/health endpoint?
```

---

## 11. Pattern 4 — Producer-Based Startup Selection

Producer cocok ketika implementation dipilih dari config saat startup.

### 11.1 Interface

```java
public interface AddressResolver {
    Address resolve(String postalCode);
}
```

Implementasi:

```java
@ApplicationScoped
public class OneMapAddressResolver implements AddressResolver {
    @Override
    public Address resolve(String postalCode) {
        // call OneMap
    }
}

@ApplicationScoped
public class StaticAddressResolver implements AddressResolver {
    @Override
    public Address resolve(String postalCode) {
        // local static lookup
    }
}
```

Producer:

```java
@ApplicationScoped
public class AddressResolverProducer {

    @Inject
    OneMapAddressResolver oneMap;

    @Inject
    StaticAddressResolver staticResolver;

    @Inject
    @ConfigProperty(name = "address.resolver.mode")
    String mode;

    @Produces
    @ApplicationScoped
    public AddressResolver produce() {
        return switch (mode) {
            case "onemap" -> oneMap;
            case "static" -> staticResolver;
            default -> throw new IllegalStateException(
                "Unsupported address.resolver.mode=" + mode
            );
        };
    }
}
```

### 11.2 Kelebihan

- central selection,
- fail-fast saat startup,
- injection consumer tetap bersih,
- mudah expose selected implementation,
- cocok untuk environment-level mode.

### 11.3 Kekurangan

- perubahan config biasanya perlu restart jika mode disimpan sebagai value biasa,
- semua dependency candidate mungkin tetap dibuat jika di-inject langsung,
- bisa menjadi ambiguity jika producer dan concrete beans sama-sama eligible untuk interface.

### 11.4 Penting: Avoid Ambiguous Bean

Kalau concrete implementation juga eligible sebagai `AddressResolver`, injection berikut bisa ambiguous:

```java
@Inject
AddressResolver resolver;
```

Karena CDI melihat:

- `OneMapAddressResolver implements AddressResolver`,
- `StaticAddressResolver implements AddressResolver`,
- produced `AddressResolver`.

Solusi:

- beri qualifier internal pada concrete beans,
- injeksi selected bean dengan qualifier khusus,
- atau jangan expose concrete candidates sebagai default `AddressResolver`.

Contoh:

```java
@Qualifier
@Retention(RUNTIME)
@Target({TYPE, METHOD, FIELD, PARAMETER})
public @interface Candidate {}
```

```java
@Candidate
@ApplicationScoped
public class OneMapAddressResolver implements AddressResolver { }

@Candidate
@ApplicationScoped
public class StaticAddressResolver implements AddressResolver { }
```

Lalu producer menghasilkan default:

```java
@Produces
@ApplicationScoped
public AddressResolver produceDefaultAddressResolver() {
    // selected implementation
}
```

Namun hati-hati: custom qualifier mengganti default qualifier. Pastikan injection point candidate memakai qualifier yang sesuai.

---

## 12. Pattern 5 — `Instance<T>` Dynamic Lookup

CDI menyediakan `Instance<T>` untuk programmatic lookup secara lebih type-safe dibanding `BeanManager` langsung.

### 12.1 Use Case

Gunakan `Instance<T>` ketika:

- jumlah implementation bisa banyak,
- selector butuh memilih berdasarkan qualifier literal,
- dependency optional,
- ingin lazy lookup,
- ingin iterate semua strategy,
- ingin memilih implementation di runtime tetapi tetap dalam boundary eksplisit.

### 12.2 Basic Example

```java
@Inject
Instance<ReportRenderer> renderers;

public ReportRenderer select(String format) {
    for (ReportRenderer renderer : renderers) {
        if (renderer.supports(format)) {
            return renderer;
        }
    }
    throw new UnsupportedReportFormatException(format);
}
```

Ini simple, tetapi ada risiko: `supports(format)` menjadi runtime convention, bukan CDI resolution.

### 12.3 More Explicit Strategy Key

```java
public interface ReportRenderer {
    ReportFormat format();
    RenderedReport render(Report report);
}
```

```java
@ApplicationScoped
public class PdfReportRenderer implements ReportRenderer {
    public ReportFormat format() {
        return ReportFormat.PDF;
    }
}

@ApplicationScoped
public class CsvReportRenderer implements ReportRenderer {
    public ReportFormat format() {
        return ReportFormat.CSV;
    }
}
```

Registry:

```java
@ApplicationScoped
public class ReportRendererRegistry {
    private final Map<ReportFormat, ReportRenderer> byFormat;

    @Inject
    public ReportRendererRegistry(Instance<ReportRenderer> renderers) {
        Map<ReportFormat, ReportRenderer> map = new EnumMap<>(ReportFormat.class);

        for (ReportRenderer renderer : renderers) {
            ReportRenderer previous = map.put(renderer.format(), renderer);
            if (previous != null) {
                throw new IllegalStateException(
                    "Duplicate renderer for format " + renderer.format()
                );
            }
        }

        this.byFormat = Map.copyOf(map);
    }

    public ReportRenderer get(ReportFormat format) {
        ReportRenderer renderer = byFormat.get(format);
        if (renderer == null) {
            throw new UnsupportedOperationException(
                "No renderer registered for format " + format
            );
        }
        return renderer;
    }
}
```

### 12.4 Why This Is Better

- Duplicate strategy detected at startup.
- Missing strategy detected deterministically.
- Selection is centralized.
- Consumers do not know all implementations.
- Runtime registry can expose its registered keys.

### 12.5 Danger

Jangan inject `Instance<T>` ke semua tempat dan memanggil `.select()` sembarangan. Itu mengubah CDI menjadi service locator.

Rule:

```text
Instance<T> sebaiknya berada di registry/selector/factory boundary,
bukan tersebar di business service biasa.
```

---

## 13. Pattern 6 — Strategy Registry

Strategy registry adalah pattern paling berguna untuk sistem enterprise dengan banyak variasi.

### 13.1 Problem

Misalnya regulatory case management memiliki beberapa escalation policy:

- default,
- high-risk,
- fast-track,
- enforcement,
- appeal,
- special-agency.

Kode buruk:

```java
if (caseType == APPEAL) return appealEscalation(...);
if (caseType == ENFORCEMENT) return enforcementEscalation(...);
if (risk == HIGH) return highRiskEscalation(...);
return defaultEscalation(...);
```

Kode membesar dan sulit dites.

### 13.2 Strategy Interface

```java
public interface EscalationPolicy {
    EscalationPolicyKey key();
    EscalationDecision evaluate(EscalationContext context);
}
```

Key:

```java
public record EscalationPolicyKey(
        CaseType caseType,
        RiskBand riskBand,
        String agencyCode
) {}
```

Implementasi:

```java
@ApplicationScoped
public class DefaultEscalationPolicy implements EscalationPolicy {
    @Override
    public EscalationPolicyKey key() {
        return new EscalationPolicyKey(CaseType.DEFAULT, RiskBand.NORMAL, "*");
    }

    @Override
    public EscalationDecision evaluate(EscalationContext context) {
        // default escalation logic
    }
}
```

Registry:

```java
@ApplicationScoped
public class EscalationPolicyRegistry {
    private final List<EscalationPolicy> policies;

    @Inject
    public EscalationPolicyRegistry(Instance<EscalationPolicy> policies) {
        this.policies = StreamSupport
            .stream(policies.spliterator(), false)
            .toList();

        validateNoDuplicateExactKeys(this.policies);
    }

    public EscalationPolicy select(EscalationContext context) {
        return policies.stream()
            .filter(policy -> matches(policy.key(), context))
            .max(Comparator.comparingInt(policy -> specificity(policy.key())))
            .orElseThrow(() -> new IllegalStateException(
                "No escalation policy for context=" + context.safeSummary()
            ));
    }
}
```

### 13.3 Advanced Rule

A registry should define:

- matching semantics,
- priority/specificity,
- duplicate handling,
- fallback handling,
- observability,
- test fixtures,
- safe error messages.

### 13.4 What Not To Do

Jangan biarkan setiap strategy memutuskan sendiri apakah ia cocok tanpa central governance jika matching rule penting untuk audit.

```java
policies.stream()
    .filter(p -> p.supports(context))
    .findFirst();
```

Ini boleh untuk kasus simple, tetapi berisiko kalau urutan classpath/container memengaruhi hasil.

Lebih baik gunakan explicit priority/specificity.

---

## 14. Pattern 7 — Feature-Flagged Selector

Feature flag cocok ketika keputusan harus bisa berubah tanpa redeploy/restart.

### 14.1 Jangan Langsung Menyebar Flag

Buruk:

```java
if (featureFlags.enabled("new-fee-engine", user)) {
   return newFeeEngine.calculate(command);
}
return oldFeeEngine.calculate(command);
```

di banyak tempat.

### 14.2 Buat Selector Boundary

```java
@ApplicationScoped
public class FeeEngineSelector {
    private final FeeEngine legacy;
    private final FeeEngine modern;
    private final FeatureFlagService flags;
    private final RuntimeDecisionLogger decisionLogger;

    @Inject
    public FeeEngineSelector(
            @Legacy FeeEngine legacy,
            @Modern FeeEngine modern,
            FeatureFlagService flags,
            RuntimeDecisionLogger decisionLogger) {
        this.legacy = legacy;
        this.modern = modern;
        this.flags = flags;
        this.decisionLogger = decisionLogger;
    }

    public FeeEngine select(FeeEvaluationContext context) {
        boolean enabled = flags.booleanValue(
            "fee-engine-v2",
            false,
            FlagEvaluationContext.from(context)
        );

        decisionLogger.record(
            "fee-engine-v2",
            enabled ? "modern" : "legacy",
            context.safeSummary()
        );

        return enabled ? modern : legacy;
    }
}
```

### 14.3 Consumer

```java
@ApplicationScoped
public class FeeApplicationService {
    private final FeeEngineSelector selector;

    @Inject
    public FeeApplicationService(FeeEngineSelector selector) {
        this.selector = selector;
    }

    public FeeResult calculate(FeeCommand command) {
        FeeEvaluationContext context = FeeEvaluationContext.from(command);
        return selector.select(context).calculate(command);
    }
}
```

### 14.4 Required Production Behavior

Feature flag selector harus menjelaskan:

- default value jika flag missing,
- behavior jika flag service down,
- cache TTL,
- context fields yang dipakai,
- audit decision,
- rollback path,
- removal plan.

### 14.5 Flag Failure Policy

Contoh:

```java
public enum FlagFailurePolicy {
    FAIL_CLOSED,
    FAIL_OPEN,
    USE_LAST_KNOWN_GOOD,
    USE_DEFAULT
}
```

Untuk workflow regulatori, biasanya lebih aman:

- fail closed untuk fitur high-risk,
- default ke legacy untuk migration flag,
- use last known good untuk ops flag tertentu,
- jangan fail open untuk approval/security/compliance path.

---

## 15. Pattern 8 — Tenant / Agency / Region Selection

Enterprise system sering butuh selection berdasarkan tenant, agency, jurisdiction, region, atau product line.

### 15.1 Jangan Campur Tenant Logic di Semua Service

Buruk:

```java
if (agency.equals("CEA")) { ... }
else if (agency.equals("CPDS")) { ... }
else { ... }
```

Ini membuat agency menjadi global branching dimension.

### 15.2 Gunakan Policy Interface

```java
public interface AgencyPolicy {
    AgencyCode agency();
    EligibilityDecision evaluateEligibility(Application app);
    EscalationDecision evaluateEscalation(CaseFile caseFile);
}
```

Implementasi:

```java
@ApplicationScoped
public class DefaultAgencyPolicy implements AgencyPolicy {
    @Override
    public AgencyCode agency() {
        return AgencyCode.DEFAULT;
    }
}

@ApplicationScoped
public class CeaAgencyPolicy implements AgencyPolicy {
    @Override
    public AgencyCode agency() {
        return AgencyCode.of("CEA");
    }
}
```

Registry:

```java
@ApplicationScoped
public class AgencyPolicyRegistry {
    private final Map<AgencyCode, AgencyPolicy> policies;
    private final AgencyPolicy defaultPolicy;

    @Inject
    public AgencyPolicyRegistry(Instance<AgencyPolicy> policies) {
        Map<AgencyCode, AgencyPolicy> map = new HashMap<>();
        AgencyPolicy defaultPolicy = null;

        for (AgencyPolicy policy : policies) {
            if (policy.agency().equals(AgencyCode.DEFAULT)) {
                defaultPolicy = policy;
            } else {
                AgencyPolicy previous = map.put(policy.agency(), policy);
                if (previous != null) {
                    throw new IllegalStateException(
                        "Duplicate agency policy for " + policy.agency()
                    );
                }
            }
        }

        if (defaultPolicy == null) {
            throw new IllegalStateException("Missing default agency policy");
        }

        this.policies = Map.copyOf(map);
        this.defaultPolicy = defaultPolicy;
    }

    public AgencyPolicy get(AgencyCode agencyCode) {
        return policies.getOrDefault(agencyCode, defaultPolicy);
    }
}
```

### 15.3 Governance

Tenant/agency selection wajib punya:

- daftar tenant/agency supported,
- default behavior,
- onboarding process,
- test contract per tenant,
- audit field,
- metric label cardinality control.

---

## 16. Pattern 9 — Conditional Producer with `Provider<T>` / Dynamic Config

MicroProfile Config memungkinkan injection `Provider<T>` untuk lookup yang dapat mengambil value terbaru menurut source/config implementation.

### 16.1 Example

```java
@ApplicationScoped
public class RoutingModeProvider {
    private final Provider<String> mode;

    @Inject
    public RoutingModeProvider(
            @ConfigProperty(name = "routing.mode", defaultValue = "legacy")
            Provider<String> mode) {
        this.mode = mode;
    }

    public RoutingMode currentMode() {
        return RoutingMode.from(mode.get());
    }
}
```

Selector:

```java
@ApplicationScoped
public class RoutingService {
    private final LegacyRouter legacyRouter;
    private final ModernRouter modernRouter;
    private final RoutingModeProvider modeProvider;

    @Inject
    public RoutingService(
            LegacyRouter legacyRouter,
            ModernRouter modernRouter,
            RoutingModeProvider modeProvider) {
        this.legacyRouter = legacyRouter;
        this.modernRouter = modernRouter;
        this.modeProvider = modeProvider;
    }

    public Route route(RouteCommand command) {
        return switch (modeProvider.currentMode()) {
            case LEGACY -> legacyRouter.route(command);
            case MODERN -> modernRouter.route(command);
        };
    }
}
```

### 16.2 Caveat

Dynamic config depends on implementation/source behavior. Tidak semua source reloadable. Jangan mengasumsikan `Provider<T>` pasti live-reload dari env var OS.

Rule:

```text
Provider<T> membuat lookup lazy/dynamic dari sudut API,
tetapi kemampuan berubah tanpa restart bergantung pada ConfigSource/runtime.
```

---

## 17. Pattern 10 — Decorator-Based Conditional Behavior

Decorator cocok jika kita ingin membungkus implementation yang sama dengan rule tambahan.

Contoh:

```java
public interface CaseSubmissionService {
    SubmissionResult submit(SubmissionCommand command);
}
```

Decorator:

```java
@Decorator
public class FeatureGatedCaseSubmissionDecorator implements CaseSubmissionService {

    @Inject
    @Delegate
    CaseSubmissionService delegate;

    @Inject
    FeatureFlagService flags;

    @Override
    public SubmissionResult submit(SubmissionCommand command) {
        if (!flags.booleanValue("case-submission-enabled", true, command.flagContext())) {
            throw new FeatureDisabledException("Case submission is temporarily disabled");
        }
        return delegate.submit(command);
    }
}
```

### 17.1 Kapan Cocok

- gate behavior atas satu interface,
- compliance guard,
- authorization-like business guard,
- fallback wrapper,
- enrichment wrapper,
- audit wrapper yang punya domain meaning.

### 17.2 Kapan Tidak Cocok

- memilih satu dari banyak implementation kompleks,
- selection yang perlu explicit registry,
- per-tenant matrix besar,
- behavior yang harus terlihat sebagai workflow step.

---

## 18. Pattern 11 — Interceptor-Based Conditional Behavior

Interceptor cocok untuk cross-cutting concern.

Annotation:

```java
@InterceptorBinding
@Retention(RUNTIME)
@Target({TYPE, METHOD})
public @interface FeatureGate {
    String value();
}
```

Interceptor:

```java
@FeatureGate("")
@Interceptor
@Priority(Interceptor.Priority.APPLICATION)
public class FeatureGateInterceptor {

    @Inject
    FeatureFlagService flags;

    @AroundInvoke
    public Object around(InvocationContext ctx) throws Exception {
        FeatureGate gate = findGate(ctx);
        String flagName = gate.value();

        FlagEvaluationContext flagContext = FlagEvaluationContext.from(ctx.getParameters());

        if (!flags.booleanValue(flagName, false, flagContext)) {
            throw new FeatureDisabledException(flagName);
        }

        return ctx.proceed();
    }
}
```

Usage:

```java
@FeatureGate("appeal-workflow-v2")
public AppealResult processAppeal(AppealCommand command) {
    // logic
}
```

### 18.1 Kapan Cocok

- policy sederhana yang melintang di banyak method,
- fail-fast before method execution,
- audit/metrics/retry/gate behavior.

### 18.2 Risiko

- method behavior tersembunyi di annotation,
- self-invocation tidak melewati interceptor,
- flag context extraction bisa rapuh,
- business decision penting menjadi terlalu implicit.

Rule:

```text
Gunakan interceptor untuk cross-cutting gate,
bukan untuk workflow branching yang perlu domain visibility.
```

---

## 19. Pattern 12 — Hybrid: Startup Selection + Runtime Flag Inside Selected Strategy

Kadang kita butuh kombinasi.

Contoh:

- deployment PROD memilih `RealConnector`,
- connector tersebut punya runtime flag untuk enable fitur tambahan.

```text
Deployment config:
connector.mode = real

Runtime flag:
real-connector.new-timeout-policy = true/false
```

Ini sehat jika boundary jelas:

- config memilih family/component,
- flag memilih behavior internal yang memang rollout-able.

Jangan membuat flag memilih dependency yang tidak tersedia di deployment.

---

## 20. Conditional Bean vs Conditional Behavior

Pemisahan penting:

```text
Conditional Bean     = object/implementation yang dipilih berubah.
Conditional Behavior = object sama, tapi perilaku internal berubah.
```

Contoh conditional bean:

```text
PaymentGateway = StripePaymentGateway atau SimulatedPaymentGateway
```

Contoh conditional behavior:

```text
StripePaymentGateway menggunakan timeout policy lama atau baru
```

Keduanya tidak sama.

Jika perbedaan mengubah dependency besar, lifecycle, external resource, atau transaction boundary, pilih conditional bean.

Jika perbedaan hanya parameter/algorithm kecil, conditional behavior mungkin cukup.

---

## 21. Startup-Time vs Request-Time Selection

### 21.1 Startup-Time

```java
@Produces
@ApplicationScoped
PaymentGateway produce() {
    return config.mode().equals("real") ? real : fake;
}
```

Semua request memakai gateway yang sama.

Cocok untuk:

- environment mode,
- deployment mode,
- connector family,
- database vendor adapter,
- local vs remote implementation.

### 21.2 Request-Time

```java
PaymentGateway gateway = selector.select(command.context());
```

Setiap request bisa berbeda.

Cocok untuk:

- tenant,
- user segment,
- agency,
- jurisdiction,
- feature rollout,
- risk band.

### 21.3 Rule

```text
Jika basis keputusan adalah request/user/tenant, jangan putuskan di producer startup.
Jika basis keputusan adalah deployment config, jangan hitung ulang setiap request kecuali perlu.
```

---

## 22. The `if` Is Not the Enemy

Top engineer tidak dogmatis “no if”.

`if` buruk jika:

- tersebar,
- tidak bisa diaudit,
- hidden dependency,
- menggabungkan banyak concern,
- mengubah transaction/security behavior secara diam-diam,
- tidak punya test matrix.

`if` baik jika:

- berada di selector boundary,
- decision reason dicatat,
- input jelas,
- output jelas,
- fallback jelas,
- testable,
- terbatas.

Contoh `if` sehat:

```java
public FeeEngine select(FeeEvaluationContext context) {
    boolean useModern = flags.booleanValue("fee-engine-v2", false, context.flags());
    return useModern ? modern : legacy;
}
```

Karena `if` berada di object yang memang bertugas memilih.

---

## 23. Observability for Selection

Conditional selection tanpa observability adalah sumber incident.

Minimal log saat startup:

```text
Selected AddressResolver = OneMapAddressResolver
Reason = address.resolver.mode=onemap
Environment = uat
```

Untuk request-time dynamic selection, jangan log berlebihan semua request jika traffic tinggi. Gunakan:

- metric counter,
- sampled structured log,
- trace attribute,
- audit event untuk keputusan penting,
- debug endpoint aman.

Metric contoh:

```text
runtime_selection_total{selector="fee-engine",selected="legacy"} 124900
runtime_selection_total{selector="fee-engine",selected="modern"} 3100
runtime_selection_failure_total{selector="agency-policy",reason="missing_policy"} 2
```

Trace attributes:

```text
selection.fee_engine = modern
selection.feature_flag = fee-engine-v2
selection.flag_variant = enabled
selection.agency = CEA
```

Audit untuk regulatory workflow:

```json
{
  "decisionType": "WORKFLOW_ENGINE_SELECTION",
  "selected": "ENFORCEMENT_V2",
  "reason": "featureFlag=enforcement-v2, agency=CEA, riskBand=HIGH",
  "caseId": "CASE-2026-000123",
  "timestamp": "2026-06-16T10:20:30Z"
}
```

---

## 24. Health Endpoint / Diagnostic Endpoint

Untuk startup-time selection, expose selected implementation secara aman.

Contoh diagnostic output internal:

```json
{
  "selectors": {
    "addressResolver": {
      "selected": "OneMapAddressResolver",
      "source": "address.resolver.mode",
      "mode": "onemap"
    },
    "paymentGateway": {
      "selected": "RealPaymentGateway",
      "source": "payment.gateway.mode",
      "mode": "real"
    }
  }
}
```

Jangan expose secrets.

Jangan expose full config mentah ke public endpoint.

---

## 25. Test Strategy

Conditional selection wajib punya test minimal di tiga level.

### 25.1 Selector Unit Test

```java
@Test
void selectsModernEngineWhenFlagEnabled() {
    FeatureFlagService flags = new FakeFeatureFlagService()
        .withBoolean("fee-engine-v2", true);

    FeeEngineSelector selector = new FeeEngineSelector(
        legacyEngine,
        modernEngine,
        flags,
        decisionLogger
    );

    assertSame(modernEngine, selector.select(context));
}
```

### 25.2 Registry Validation Test

```java
@Test
void rejectsDuplicatePolicyKeys() {
    List<EscalationPolicy> policies = List.of(
        new DefaultEscalationPolicy(),
        new DuplicateDefaultEscalationPolicy()
    );

    assertThrows(IllegalStateException.class, () ->
        EscalationPolicyRegistry.from(policies)
    );
}
```

### 25.3 Container Wiring Test

Pastikan CDI wiring valid:

- no ambiguous dependency,
- no unsatisfied dependency,
- selected producer works,
- alternative/test replacement aktif.

### 25.4 Matrix Test

Untuk tenant/agency/profile/flag:

| Dimension | Values | Required Test |
|---|---|---|
| profile | local, uat, prod | startup config validation |
| tenant | default, CEA, CPDS | policy selection |
| flag | off, on, missing, provider-down | fallback behavior |
| implementation | legacy, modern | contract compatibility |

---

## 26. Contract Compatibility for Swappable Implementations

Jika dua implementation bisa dipilih secara conditional, keduanya harus memenuhi contract yang sama.

Buat contract test:

```java
public abstract class PaymentGatewayContractTest {

    protected abstract PaymentGateway gateway();

    @Test
    void rejectsNegativeAmount() {
        PaymentCommand command = new PaymentCommand(Money.of("-1.00"));
        assertThrows(InvalidPaymentException.class, () -> gateway().charge(command));
    }

    @Test
    void returnsStableReferenceForApprovedPayment() {
        PaymentCommand command = validCommand();
        PaymentResult result = gateway().charge(command);
        assertNotNull(result.reference());
    }
}
```

Implementasi test:

```java
class RealPaymentGatewayContractTest extends PaymentGatewayContractTest {
    protected PaymentGateway gateway() {
        return new RealPaymentGateway(fakeHttpClient());
    }
}

class SimulatedPaymentGatewayContractTest extends PaymentGatewayContractTest {
    protected PaymentGateway gateway() {
        return new SimulatedPaymentGateway();
    }
}
```

Ini mencegah “swappable” hanya secara type, tetapi tidak secara behavior.

---

## 27. Selection and Transaction Boundary

Conditional implementation bisa mengubah transaction behavior.

Contoh:

```java
@ApplicationScoped
public class LegacyCaseWriter implements CaseWriter {
    @Transactional
    public void write(CaseData data) { ... }
}

@ApplicationScoped
public class ModernCaseWriter implements CaseWriter {
    public void write(CaseData data) { ... }
}
```

Jika selector memilih salah satu, transaction boundary bisa berbeda.

Rule:

```text
Swappable implementations harus punya compatible transaction semantics.
```

Lebih baik transaction boundary diletakkan di application service jika kedua implementation harus berada dalam transaksi yang sama:

```java
@Transactional
public void submit(SubmitCaseCommand command) {
    CaseWriter writer = selector.select(command.context());
    writer.write(command.caseData());
}
```

---

## 28. Selection and Security Boundary

Jangan biarkan conditional implementation melewati security rule.

Buruk:

```java
if (useNewPath) {
    newService.approve(command); // missing role check
} else {
    legacyService.approve(command); // has role check
}
```

Security harus berada di boundary stabil:

```java
@RolesAllowed("CASE_APPROVER")
public ApprovalResult approve(ApprovalCommand command) {
    return selector.select(command.context()).approve(command);
}
```

Atau pastikan semua implementation punya annotation/security enforcement setara.

---

## 29. Selection and Lifecycle

Jika selected implementation memegang resource:

- HTTP pool,
- DB connection-like resource,
- native handle,
- cache,
- thread/executor,
- file watcher,
- remote SDK client,

maka selection perlu lifecycle plan.

### 29.1 Startup Selection

Resource dibuat sekali dan dihancurkan saat shutdown.

### 29.2 Runtime Dynamic Selection

Hati-hati jika membuat implementation baru per change.

Buruk:

```java
if (config.currentMode().equals("new")) {
    return new ExpensiveClient(...);
}
```

Ini bisa leak connection/thread.

Lebih baik semua candidate long-lived dikelola container, selector hanya memilih reference.

---

## 30. Selection and Caching

Conditional behavior sering berinteraksi dengan cache.

Pertanyaan penting:

- Apakah old/new implementation berbagi cache?
- Apakah cache key perlu menyertakan selected implementation?
- Apakah flag change harus invalidate cache?
- Apakah tenant selection masuk cache key?
- Apakah cache result dari legacy boleh dipakai modern?

Contoh cache key buruk:

```text
fee:{applicationId}
```

Jika fee engine bisa legacy/modern, key lebih aman:

```text
fee:{engineVersion}:{applicationId}
```

Atau jangan cache lintas engine.

---

## 31. Selection and Idempotency

Jika implementation bisa berubah antar retry, idempotency bisa rusak.

Contoh:

```text
Request 1: flag off → legacy connector submits external request
Retry: flag on → modern connector submits another external request
```

Solusi:

- persist selected route pada first attempt,
- gunakan idempotency key yang sama,
- freeze decision dalam workflow state,
- jangan biarkan feature flag berubah di tengah long-running workflow tanpa migration rule.

Workflow state:

```json
{
  "caseId": "CASE-123",
  "workflowEngine": "legacy",
  "selectedAt": "2026-06-16T10:00:00Z"
}
```

Rule:

```text
Untuk long-running workflow, selection decision sering perlu disimpan sebagai state,
bukan dievaluasi ulang setiap step.
```

---

## 32. Selection and Auditability

Untuk sistem regulatori/compliance, selection decision adalah bagian dari audit trail.

Minimal record:

- decision name,
- selected implementation/path,
- decision inputs yang aman,
- config/flag/profile source,
- timestamp,
- actor/request/case correlation,
- fallback used or not.

Jangan simpan secret atau PII berlebihan.

---

## 33. Pattern Decision Table

| Pattern | Decision Time | Cocok Untuk | Hindari Untuk |
|---|---|---|---|
| Build profile/dependency | Compile time | artifact-level difference | runtime rollout |
| Qualifier | Deployment/static wiring | stable variant | per-request dynamic decision |
| Alternative | deployment/test replacement | mock/simulation | tenant/user selection |
| Producer | startup selection | env mode | dynamic per request |
| `Instance<T>` | controlled dynamic lookup | registry/selector | scattered lookup |
| Strategy registry | request/domain selection | tenant/policy/format | trivial two-way env config |
| Feature flag selector | runtime dynamic | rollout/kill switch | permanent architecture branch |
| Decorator | semantic wrapping | business guard/enrichment | complex multi-strategy selection |
| Interceptor | cross-cutting gate | audit/metrics/gate | core workflow decision |
| Dynamic config provider | runtime value | tunable behavior | resource-heavy dependency creation |

---

## 34. Concrete Enterprise Example: Address Resolver Migration

### 34.1 Scenario

Aplikasi lama melakukan address lookup dari static table. Aplikasi baru harus menggunakan external geocoding service.

Requirements:

- DEV bisa pakai static.
- UAT/PROD pakai external.
- Jika external service down, fallback ke static untuk non-critical screen.
- Untuk official submission, failure external harus fail closed.
- Decision harus observable.

### 34.2 Interface

```java
public interface AddressResolver {
    AddressResolutionResult resolve(AddressResolutionCommand command);
}
```

### 34.3 Implementations

```java
@ApplicationScoped
@Legacy
public class StaticTableAddressResolver implements AddressResolver { }

@ApplicationScoped
@Modern
public class ExternalAddressResolver implements AddressResolver { }
```

### 34.4 Selector

```java
@ApplicationScoped
public class AddressResolverSelector {
    private final AddressResolver legacy;
    private final AddressResolver modern;
    private final Provider<String> mode;
    private final RuntimeDecisionLogger logger;

    @Inject
    public AddressResolverSelector(
            @Legacy AddressResolver legacy,
            @Modern AddressResolver modern,
            @ConfigProperty(name = "address.resolver.mode", defaultValue = "legacy")
            Provider<String> mode,
            RuntimeDecisionLogger logger) {
        this.legacy = legacy;
        this.modern = modern;
        this.mode = mode;
        this.logger = logger;
    }

    public AddressResolver select(AddressResolutionCommand command) {
        String currentMode = mode.get();

        AddressResolver selected = switch (currentMode) {
            case "legacy" -> legacy;
            case "external" -> modern;
            default -> throw new IllegalStateException(
                "Unsupported address.resolver.mode=" + currentMode
            );
        };

        logger.record("address-resolver", selected.getClass().getSimpleName(), command.safeSummary());

        return selected;
    }
}
```

### 34.5 Application Service

```java
@ApplicationScoped
public class AddressApplicationService {
    private final AddressResolverSelector selector;

    @Inject
    public AddressApplicationService(AddressResolverSelector selector) {
        this.selector = selector;
    }

    public AddressResolutionResult resolve(AddressResolutionCommand command) {
        AddressResolver resolver = selector.select(command);
        return resolver.resolve(command);
    }
}
```

### 34.6 Fallback Policy

Jangan sembunyikan fallback di catch-all.

```java
public enum AddressResolutionCriticality {
    DISPLAY_ONLY,
    OFFICIAL_SUBMISSION
}
```

```java
public AddressResolutionResult resolve(AddressResolutionCommand command) {
    try {
        return selector.select(command).resolve(command);
    } catch (ExternalAddressUnavailableException ex) {
        if (command.criticality() == AddressResolutionCriticality.DISPLAY_ONLY) {
            return legacy.resolve(command).withWarning("FALLBACK_USED");
        }
        throw ex;
    }
}
```

This is explicit and auditable.

---

## 35. Concrete Enterprise Example: Case Workflow Engine Rollout

### 35.1 Scenario

Regulatory case management memiliki workflow engine lama dan engine baru.

Requirements:

- New engine rollout hanya untuk subset case type.
- Per case, engine selection harus immutable setelah case dibuat.
- Jika flag berubah, case existing tetap pakai engine yang sama.
- Audit harus mencatat engine selection.

### 35.2 Wrong Model

```java
public WorkflowEngine currentEngine(CaseFile caseFile) {
    return flags.enabled("workflow-v2", caseFile.context()) ? v2 : v1;
}
```

Ini salah untuk long-running case karena flag berubah bisa mengganti engine di tengah lifecycle.

### 35.3 Better Model

Saat case dibuat:

```java
WorkflowEngineType selected = workflowEngineSelector.selectForNewCase(command);
caseFile.assignWorkflowEngine(selected);
audit.recordWorkflowEngineSelection(caseFile.id(), selected, command.safeSummary());
```

Saat process step:

```java
WorkflowEngine engine = workflowEngineRegistry.get(caseFile.workflowEngineType());
engine.processStep(caseFile, stepCommand);
```

### 35.4 Key Lesson

```text
Feature flag boleh memilih initial route,
tetapi workflow state harus menyimpan route untuk menjaga consistency.
```

---

## 36. Conditional Selection Smell Catalog

### 36.1 Smell: Repeated Flag Check

Flag yang sama dicek di 10 class.

Fix:

- buat selector,
- buat policy object,
- buat decorator/interceptor jika cross-cutting.

### 36.2 Smell: `ConfigProvider.getConfig()` Inside Domain Logic

Fix:

- inject typed config provider,
- pass explicit policy/config value,
- isolate in adapter/selector.

### 36.3 Smell: Ambiguous `@Inject Interface`

Fix:

- qualifier,
- producer,
- alternative,
- registry.

### 36.4 Smell: `Instance<T>` Everywhere

Fix:

- central registry,
- explicit strategy interface,
- documented selection rule.

### 36.5 Smell: Feature Flag Never Removed

Fix:

- flag owner,
- expiry date,
- removal ticket,
- dashboard,
- code cleanup policy.

### 36.6 Smell: Tenant Branch in Low-Level Utility

Fix:

- tenant policy layer,
- tenant-aware registry,
- avoid leaking tenant logic into low-level utilities.

### 36.7 Smell: Startup Config Changes Per Request

Fix:

- decide if it is startup config or dynamic config,
- do not mix semantics.

### 36.8 Smell: Selection Not Logged Anywhere

Fix:

- startup log for static selection,
- metrics/trace for runtime selection,
- audit for compliance-critical selection.

---

## 37. Failure Mode Matrix

| Failure | Cause | Detection | Mitigation |
|---|---|---|---|
| Unsatisfied dependency | selected bean not discoverable | startup failure | bean archive/config test |
| Ambiguous dependency | multiple implementations no qualifier | startup failure | qualifier/producer registry |
| Wrong implementation active | config/profile mismatch | runtime behavior | startup selected implementation log |
| Flag provider down | remote flag service unavailable | runtime error/metric | fallback policy/cache |
| Inconsistent selection across replicas | stale config/flag cache | inconsistent behavior | versioned config, metrics by replica |
| Duplicate strategy | two beans same key | startup validation | registry validation |
| Missing strategy | no implementation for key | runtime error | fail-fast registry completeness check |
| Transaction mismatch | implementation annotations differ | data inconsistency | boundary transaction contract |
| Security bypass | new path lacks guard | incident/security bug | guard at stable boundary |
| Retry changes route | dynamic flag changed between attempts | duplicate side effect | persist selected route/idempotency |
| Cache pollution | cache key omits selected path | wrong result | include variant in key/invalidate |
| Flag debt | old/new both remain forever | complexity | expiry/removal governance |

---

## 38. How Top Engineers Review Conditional Selection

Saat code review, jangan hanya tanya “apakah jalan?”. Tanyakan:

1. Kapan decision dibuat?
2. Apakah decision time sudah tepat?
3. Siapa owner selector/policy?
4. Apakah selection explicit atau tersebar?
5. Apakah semua candidate implementation memenuhi contract sama?
6. Apakah transaction/security/lifecycle semantics compatible?
7. Apakah fallback behavior jelas?
8. Apakah decision observable?
9. Apakah test matrix mencakup selected path?
10. Apakah long-running workflow menyimpan selected route?
11. Apakah flag/config bisa berubah tanpa restart? Jika iya, apakah aman?
12. Apakah ada cleanup plan untuk temporary branch?

---

## 39. Practical Design Recipe

Jika Anda harus mendesain conditional selection, ikuti urutan ini.

### Step 1 — Define the Stable Interface

```java
public interface XService {
    Result execute(Command command);
}
```

### Step 2 — Define Candidate Implementations

```java
@Legacy
@ApplicationScoped
class LegacyXService implements XService { }

@Modern
@ApplicationScoped
class ModernXService implements XService { }
```

### Step 3 — Define Decision Context

```java
public record XSelectionContext(
    String tenant,
    String profile,
    String caseType,
    String riskBand,
    String userSegment
) {}
```

### Step 4 — Define Selector

```java
@ApplicationScoped
public class XServiceSelector {
    public XService select(XSelectionContext context) {
        // one place only
    }
}
```

### Step 5 — Define Fallback Policy

```java
public enum XFallbackPolicy {
    FAIL_CLOSED,
    USE_LEGACY,
    USE_LAST_KNOWN_GOOD
}
```

### Step 6 — Add Observability

```java
selectionLogger.record("x-service", selectedName, context.safeSummary());
```

### Step 7 — Test Decision Matrix

```text
profile x tenant x flag x criticality
```

### Step 8 — Document Removal/Ownership

```text
Owner: Platform Team
Reason: migration to X v2
Start: 2026-06-16
Expected removal: after all cases migrated
```

---

## 40. Jakarta / Javax Compatibility Notes

Untuk Java EE `javax.*` world:

- qualifiers ada di `javax.inject.Qualifier`,
- CDI classes di `javax.enterprise.*`,
- alternatives/producers/events/proxy concept sama secara mental,
- MicroProfile Config versi lama memakai `javax.inject.Provider`.

Untuk Jakarta EE `jakarta.*` world:

- qualifiers ada di `jakarta.inject.Qualifier`,
- CDI classes di `jakarta.enterprise.*`,
- MicroProfile Config 3.x memakai `jakarta.inject.Provider`,
- CDI 4.x memiliki CDI Lite / CDI Full distinction yang lebih relevan untuk build-time frameworks.

Jangan campur:

```java
javax.inject.Inject
```

dengan:

```java
jakarta.enterprise.context.ApplicationScoped
```

kecuali runtime/library memang mendukung bridging tertentu. Secara umum, mixed namespace adalah sumber runtime failure.

---

## 41. Java 8–25 Considerations

### Java 8

- Banyak sistem Java EE 7/8 masih `javax.*`.
- CDI/EJB app server klasik dominan.
- Tidak ada records/switch expression.
- Gunakan class biasa untuk context/key.

### Java 11

- Baseline transisi modern awal.
- Banyak library enterprise mulai support long-term runtime.

### Java 17

- Baseline penting untuk Jakarta EE 11.
- Records dan switch expression membantu membuat decision context lebih jelas.

### Java 21

- Virtual threads mulai relevan, tapi conditional selection tetap harus memperhatikan context propagation.
- Pattern selector/registry tetap sama.

### Java 25

- Modern LTS era dengan language/runtime maturity lebih tinggi.
- Jangan mengandalkan language feature untuk menyelesaikan architectural selection problem.
- Masalah utamanya tetap: boundary, lifecycle, observability, consistency.

---

## 42. Recommended Default Architecture

Untuk sistem enterprise besar, default yang sehat:

```text
Application Service
    ↓
Selector / Registry / Policy Boundary
    ↓
Stable Interface
    ↓
Candidate Implementations
    ↓
External Resources / Infrastructure
```

Contoh:

```text
CaseSubmissionApplicationService
    ↓
WorkflowEngineSelector
    ↓
WorkflowEngine
    ├── LegacyWorkflowEngine
    └── ModernWorkflowEngine
```

Jangan:

```text
Everywhere
    ↓
if config/flag/tenant
    ↓
random implementation
```

---

## 43. Summary

Conditional bean dan runtime selection adalah topik kecil yang dampaknya sangat besar.

Key takeaways:

1. Pertama tentukan **kapan** keputusan dibuat.
2. Jangan gunakan satu mekanisme untuk semua selection problem.
3. Qualifier cocok untuk static type-safe variant.
4. Alternative cocok untuk deployment/test replacement.
5. Producer cocok untuk startup-time selection.
6. `Instance<T>` cocok jika dibatasi di registry/selector.
7. Strategy registry cocok untuk tenant/policy/domain selection.
8. Feature flag cocok untuk dynamic rollout/kill switch, bukan permanent architecture branch.
9. Decorator cocok untuk semantic wrapping.
10. Interceptor cocok untuk cross-cutting gate.
11. Selection harus observable, testable, dan auditable.
12. Swappable implementation harus kompatibel secara contract, transaction, security, lifecycle, dan failure behavior.
13. Untuk long-running workflow, selected route sering harus disimpan sebagai state.
14. Config/flag tidak boleh tersebar sebagai hidden business logic.

---

## 44. Latihan Praktis

### Latihan 1 — Payment Gateway Selection

Desain:

- `PaymentGateway`
- `SimulatedPaymentGateway`
- `RealPaymentGateway`
- startup config `payment.gateway.mode`
- startup log selected implementation
- fail-fast jika mode invalid.

### Latihan 2 — Report Renderer Registry

Desain:

- `ReportRenderer`
- PDF, CSV, XLSX renderer
- registry by `ReportFormat`
- duplicate key detection
- unsupported format error.

### Latihan 3 — Feature-Flagged Workflow Engine

Desain:

- legacy engine,
- modern engine,
- feature flag selector,
- selection decision persisted to case state,
- audit event.

### Latihan 4 — Tenant Policy Matrix

Desain:

- default policy,
- CEA policy,
- CPDS policy,
- fallback policy,
- test matrix.

### Latihan 5 — Smell Refactoring

Refactor code yang penuh:

```java
if (tenant.equals("A")) { ... }
else if (featureEnabled) { ... }
else if (profile.equals("uat")) { ... }
```

menjadi:

- selector,
- strategy registry,
- typed decision context,
- observable decision.

---

## 45. Checklist Produksi

Sebelum conditional selection masuk production:

```text
[ ] Decision time sudah jelas: compile/startup/request/dynamic.
[ ] Decision owner jelas.
[ ] Selection tidak tersebar.
[ ] Interface contract jelas.
[ ] Semua implementation lulus contract test.
[ ] Transaction semantics compatible.
[ ] Security boundary compatible.
[ ] Resource lifecycle aman.
[ ] Cache key mempertimbangkan selected variant jika perlu.
[ ] Retry/idempotency aman jika selection berubah.
[ ] Long-running workflow menyimpan route jika perlu.
[ ] Fallback behavior jelas.
[ ] Missing/invalid config fail-fast atau fallback sesuai policy.
[ ] Feature flag punya default value.
[ ] Feature flag provider-down behavior jelas.
[ ] Startup selected implementation dilog.
[ ] Runtime selection punya metric/trace/audit sesuai criticality.
[ ] Test matrix mencakup branch penting.
[ ] Temporary flag/branch punya cleanup plan.
```

---

## 46. Penutup

Setelah bagian ini, kita sudah memiliki jembatan antara:

- CDI qualifier,
- alternatives,
- producers,
- `Instance<T>`,
- profile,
- config,
- feature flag,
- decorator,
- interceptor,
- tenant/domain policy.

Intinya bukan “pakai annotation apa?”, tetapi:

> “Decision mana yang harus dibuat di waktu mana, oleh boundary mana, dengan observability dan failure semantics apa?”

Itulah cara berpikir top engineer ketika mendesain runtime selection dalam sistem enterprise.

Pada bagian berikutnya kita akan masuk ke:

```text
Part 030 — Container Concurrency, Managed Executors, and Context Propagation
```

Bagian berikutnya penting karena banyak selection/config/feature flag logic berjalan di async task, scheduler, background worker, event observer, atau external callback. Di sana kita harus memahami context propagation, request scope, security context, transaction boundary, managed executor, dan risiko unmanaged thread.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 028 — Feature Flags: Runtime Decisioning, Risk Control, and Progressive Delivery](./learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-028.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 030 — Container Concurrency, Managed Executors, and Context Propagation](./learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-030.md)

</div>