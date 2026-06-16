# Part 028 — Feature Flags: Runtime Decisioning, Risk Control, and Progressive Delivery

> Seri: `learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime`  
> Part: `028`  
> Topik: Feature flags, runtime decisioning, risk control, progressive delivery, CDI integration, configuration, auditability, dan governance  
> Target Java: Java 8 sampai Java 25  
> Target ekosistem: Java EE `javax.*`, Jakarta EE `jakarta.*`, CDI, MicroProfile Config, application server, cloud-native runtime

---

## 0. Tujuan Pembelajaran

Setelah bagian ini, kita tidak hanya tahu bahwa feature flag adalah `if (enabled)`. Kita harus bisa memodelkan feature flag sebagai **runtime decisioning boundary**.

Feature flag adalah mekanisme untuk membuat sistem bisa menjawab pertanyaan berikut secara terkendali:

```text
Untuk request / user / tenant / agency / environment / waktu tertentu,
perilaku apa yang harus dijalankan sekarang,
tanpa harus build dan deploy ulang aplikasi?
```

Pada level engineer biasa, feature flag sering dipahami sebagai boolean:

```java
if (newFeatureEnabled) {
    runNewFlow();
} else {
    runOldFlow();
}
```

Pada level engineer yang matang, feature flag adalah kontrak runtime yang menyentuh:

- release safety;
- operational kill switch;
- progressive rollout;
- regulatory defensibility;
- audit trail;
- distributed consistency;
- cache invalidation;
- dependency injection boundary;
- test matrix;
- incident rollback strategy;
- long-term code hygiene;
- ownership dan lifecycle flag.

Feature flag yang buruk bisa menjadi sumber kompleksitas tersembunyi. Feature flag yang baik bisa menjadi salah satu control surface paling kuat untuk sistem enterprise.

---

## 1. Posisi Materi Ini dalam Seri

Kita sudah melewati:

- dependency management;
- API/SPI/provider layering;
- `javax.*` ke `jakarta.*`;
- container/runtime model;
- classloader dan deployment isolation;
- dependency injection fundamentals;
- Jakarta Inject;
- CDI bean model;
- bean discovery;
- scopes;
- proxies;
- qualifiers/alternatives;
- producers/disposers;
- events;
- interceptors;
- decorators;
- stereotypes;
- lifecycle callbacks;
- CDI extensions;
- Enterprise Beans;
- Jakarta annotations/resource injection;
- JNDI/environment resource;
- configuration fundamentals;
- MicroProfile Config;
- profiles.

Feature flag muncul setelah configuration dan profile karena sering disalahpahami sebagai varian dari keduanya.

Padahal:

```text
Configuration menjawab: nilai runtime apa yang dibutuhkan aplikasi?
Profile menjawab: environment/mode apa yang sedang aktif?
Feature flag menjawab: perilaku mana yang aktif untuk kondisi tertentu saat runtime?
```

---

## 2. Mental Model Utama

Feature flag bukan hanya config value. Feature flag adalah **decision point**.

```text
Request / Job / Event / Command
        │
        ▼
Evaluation Context
(user, tenant, agency, role, environment, region, case type, risk level, time)
        │
        ▼
Feature Flag Engine
(flag definition, targeting rule, rollout percentage, default, cache, provider)
        │
        ▼
Decision
(boolean / string / number / object / variant)
        │
        ▼
Runtime Behavior
(old path / new path / disabled path / fallback path / kill-switch path)
```

Jadi yang penting bukan hanya value `true` atau `false`, tetapi:

1. **siapa** yang dievaluasi;
2. **kapan** dievaluasi;
3. **berdasarkan rule apa**;
4. **default-nya apa** jika flag provider gagal;
5. **apakah decision harus konsisten sepanjang request**;
6. **apakah decision perlu diaudit**;
7. **siapa pemilik flag**;
8. **kapan flag harus dihapus**.

---

## 3. Feature Flag vs Configuration vs Profile

Ketiganya sering dicampur. Ini harus dipisah sejak awal.

| Konsep | Pertanyaan utama | Contoh | Frekuensi berubah | Risiko jika salah |
|---|---|---|---|---|
| Configuration | Nilai runtime apa yang dibutuhkan? | DB URL, timeout, rate limit, token endpoint | jarang-sedang | aplikasi gagal start, salah endpoint, bocor secret |
| Profile | Mode/environment apa yang aktif? | `dev`, `uat`, `prod`, `migration` | sangat jarang | behavior prod memakai dev setting |
| Feature flag | Perilaku mana yang aktif untuk konteks tertentu? | enable new scoring engine untuk 10% tenant | sering-sedang | user mendapat behavior salah, rollout kacau, audit lemah |

Rule praktis:

```text
Jika nilainya menjelaskan resource atau parameter sistem → configuration.
Jika nilainya menjelaskan environment/mode deployment → profile.
Jika nilainya memilih behavior atau exposure runtime → feature flag.
```

Contoh salah:

```properties
app.profile=prod-with-new-engine-enabled
```

Ini mencampur profile dan feature flag.

Lebih baik:

```properties
app.profile=prod
feature.case.new-scoring-engine=false
```

Atau jika memakai flag provider:

```text
profile: prod
flag: case.new-scoring-engine
rule: enabled for agency=CEA, caseType=HIGH_RISK, rollout=10%
```

---

## 4. Mengapa Feature Flag Penting di Enterprise Java

Enterprise Java sering hidup di lingkungan dengan karakteristik:

- release window terbatas;
- UAT panjang;
- banyak agency/tenant/customer;
- audit dan compliance penting;
- downtime mahal;
- rollback database tidak selalu mudah;
- behavior harus bisa dijelaskan setelah kejadian;
- deployment sering dipisah antara vendor, infra team, DBA, security, dan business owner.

Feature flag membantu memisahkan:

```text
Deploy code ≠ Release behavior
```

Tanpa feature flag:

```text
Deploy new WAR/JAR → behavior langsung berubah untuk semua user.
```

Dengan feature flag:

```text
Deploy new WAR/JAR → behavior tetap off → enable bertahap → observe → expand → complete → remove flag.
```

Ini sangat berguna untuk:

- risky logic;
- external API migration;
- new workflow;
- new validation rule;
- new UI screen;
- new integration endpoint;
- background job change;
- new calculation engine;
- new document generation logic;
- new audit enrichment;
- operational kill switch.

---

## 5. Jenis-Jenis Feature Flag

Tidak semua flag punya lifecycle dan risiko yang sama.

### 5.1 Release Flag

Release flag dipakai untuk memisahkan deploy dan release.

Contoh:

```text
case.new-review-workflow.enabled
```

Tujuan:

- code bisa masuk production lebih awal;
- behavior tetap off;
- enable saat business siap;
- rollout bertahap.

Ciri:

- biasanya temporary;
- harus dihapus setelah rollout selesai;
- punya owner jelas;
- punya expiry date.

### 5.2 Ops Flag / Kill Switch

Ops flag dipakai untuk mengendalikan sistem saat runtime.

Contoh:

```text
external.onemap.lookup.enabled
notification.email.dispatch.enabled
report.large-export.enabled
```

Tujuan:

- mematikan fitur yang sedang menyebabkan incident;
- mengurangi load;
- memutus dependency eksternal bermasalah;
- menjaga core service tetap hidup.

Ciri:

- bisa long-lived;
- default harus sangat jelas;
- harus sangat observable;
- perubahan harus diaudit.

### 5.3 Permission Flag

Permission flag mengontrol akses fitur berdasarkan user/role/tenant/agency.

Contoh:

```text
feature.bulk-approval.allowed
feature.advanced-search.allowed
```

Catatan penting:

Permission flag **bukan pengganti authorization**.

Authorization menjawab:

```text
Apakah actor boleh melakukan action ini menurut policy/security model?
```

Feature flag menjawab:

```text
Apakah fitur ini sedang diekspos kepada actor/context ini?
```

Keduanya boleh bekerja bersama, tetapi jangan menjadikan feature flag sebagai satu-satunya security control.

### 5.4 Experiment Flag

Experiment flag memilih varian untuk eksperimen.

Contoh:

```text
ui.case-list-layout.variant = "A" | "B" | "C"
```

Dalam sistem regulatori/enterprise, experiment flag biasanya lebih sensitif karena:

- treatment berbeda antar user bisa dipertanyakan;
- hasil keputusan bisnis/regulatory tidak boleh arbitrary;
- auditability penting;
- beberapa domain tidak cocok untuk eksperimen acak.

### 5.5 Migration Flag

Migration flag mengontrol perpindahan dari sistem lama ke sistem baru.

Contoh:

```text
integration.customer-registry.use-v2
case.scoring.use-new-engine
storage.document-read.use-s3
```

Ciri:

- sering butuh dual-read atau dual-write;
- berisiko tinggi;
- membutuhkan reconciliation;
- rollback tidak selalu trivial.

### 5.6 Compliance / Policy Flag

Flag yang mengaktifkan policy baru.

Contoh:

```text
policy.require-second-level-approval-for-high-risk-case
policy.block-submission-if-myinfo-expired
```

Sangat berbahaya jika tidak diaudit, karena mengubah hasil proses bisnis.

Untuk policy flag, wajib ada:

- owner;
- effective date;
- reason;
- approval;
- audit trail;
- test evidence;
- rollback semantics.

---

## 6. Boolean Flag vs Variant Flag

Feature flag tidak harus boolean.

### 6.1 Boolean Flag

```java
boolean enabled = flags.isEnabled("case.new-scoring-engine", ctx);
```

Cocok untuk:

- on/off sederhana;
- kill switch;
- release toggle sederhana.

Masalahnya, boolean bisa cepat menjadi miskin ekspresi.

Contoh buruk:

```java
if (newEngineEnabled && newEngineMode2Enabled && newEngineFallbackEnabled) {
    ...
}
```

### 6.2 String / Enum Variant

```java
ScoringMode mode = flags.getEnum(
    "case.scoring.mode",
    ctx,
    ScoringMode.class,
    ScoringMode.LEGACY
);
```

Cocok untuk:

```text
LEGACY
NEW_ENGINE_SHADOW
NEW_ENGINE_ACTIVE
NEW_ENGINE_STRICT
DISABLED
```

Variant flag sering lebih bersih daripada banyak boolean yang saling bergantung.

### 6.3 Numeric Flag

Contoh:

```text
case.search.max-result-window = 500
report.export.max-row-count = 10000
```

Hati-hati: numeric flag sering sebenarnya adalah dynamic config, bukan feature flag.

Pertanyaannya:

```text
Apakah nilai ini memilih behavior rollout/targeting?
Atau hanya parameter operasional?
```

Kalau hanya parameter operasional, lebih tepat sebagai configuration.

### 6.4 Object / JSON Flag

Contoh:

```json
{
  "mode": "NEW_ENGINE_ACTIVE",
  "maxRiskScore": 80,
  "fallback": "LEGACY_ON_ERROR"
}
```

Kuat, tetapi rawan:

- schema tidak jelas;
- validation lemah;
- perubahan sulit diaudit;
- backward compatibility sulit;
- caching dan parsing error.

Untuk enterprise system, object flag sebaiknya hanya dipakai jika ada:

- schema version;
- validation;
- default object;
- typed mapping;
- audit diff;
- test coverage.

---

## 7. Evaluation Context

Feature flag yang matang bergantung pada evaluation context.

Contoh context:

```java
public record FlagContext(
    String requestId,
    String userId,
    String agency,
    String tenantId,
    String role,
    String environment,
    String caseType,
    String caseRiskLevel,
    String module,
    String operation,
    Instant requestTime
) {}
```

Context adalah fakta runtime yang dipakai untuk menentukan flag.

Contoh rule:

```text
Enable case.new-scoring-engine when:
- environment = prod
- agency = CEA
- caseType = LICENSING
- riskLevel = HIGH
- rollout bucket < 10%
```

### 7.1 Context Harus Stabil dalam Satu Request

Jangan membangun context berkali-kali dengan data yang bisa berubah di tengah request.

Buruk:

```java
if (flags.isEnabled("new-flow", buildContextFromDatabase())) {
    step1();
}

if (flags.isEnabled("new-flow", buildContextFromDatabase())) {
    step2();
}
```

Jika database/state berubah, step1 dan step2 bisa memakai decision berbeda.

Lebih baik:

```java
FlagContext ctx = flagContextFactory.from(request);
FeatureDecision decision = flags.evaluate("new-flow", ctx);

if (decision.enabled()) {
    step1();
    step2();
}
```

### 7.2 Jangan Masukkan PII Berlebihan

Evaluation context sering dikirim ke flag provider eksternal.

Jangan sembarang mengirim:

- NRIC/NIK/passport;
- email;
- phone number;
- full name;
- address;
- sensitive case detail;
- free-text note.

Gunakan opaque identifier atau hashed identifier jika perlu.

Contoh:

```java
String rolloutKey = stableHash(userId + ":" + tenantId);
```

Tetapi hashing bukan magic anonymization. Tetap pikirkan privacy dan policy organisasi.

---

## 8. Rollout Model

### 8.1 All-Off

Default untuk risky feature:

```text
enabled=false
```

Gunanya:

- deploy aman;
- smoke test internal;
- enable bertahap.

### 8.2 Allowlist Rollout

Enable hanya untuk user/tenant/agency tertentu.

```text
enabled when agency in ["CEA-TEST", "CEA-PILOT"]
```

Cocok untuk:

- pilot agency;
- internal user;
- UAT-on-prod style validation;
- limited production verification.

### 8.3 Percentage Rollout

Enable untuk persentase populasi.

```text
10% of tenant/user bucket
```

Kunci penting: percentage rollout harus deterministic.

Buruk:

```java
boolean enabled = Math.random() < 0.1;
```

Ini bisa berubah setiap request.

Lebih baik:

```java
int bucket = stableBucket(userId, flagKey, 100);
boolean enabled = bucket < 10;
```

Pseudo-code:

```java
static int stableBucket(String key, String flagKey, int modulo) {
    int hash = Math.abs(Objects.hash(key, flagKey));
    return hash % modulo;
}
```

Catatan: untuk production, gunakan hashing yang stabil lintas JVM/version dan distribusi baik, misalnya MurmurHash/xxHash/SHA-256 truncated, bukan `Objects.hash` jika hasil harus stabil jangka panjang lintas implementasi.

### 8.4 Ring-Based Rollout

Rollout berdasarkan ring:

```text
ring0: internal team
ring1: pilot tenant
ring2: low-risk users
ring3: 10% all users
ring4: 50% all users
ring5: 100%
```

Ini cocok untuk enterprise rollout.

### 8.5 Time-Based Activation

Enable setelah waktu tertentu.

```text
enableAt = 2026-07-01T00:00:00+08:00
```

Risiko:

- timezone;
- clock skew;
- deployment belum siap;
- business approval berubah;
- batch job melewati cutover time.

Untuk fitur kritis, time-based activation sebaiknya dikombinasikan dengan manual approval flag.

---

## 9. Flag Evaluation Result Harus Kaya Metadata

Jangan hanya mengembalikan boolean untuk semua case.

Lebih baik model decision seperti:

```java
public record FeatureDecision<T>(
    String key,
    T value,
    T defaultValue,
    boolean defaultUsed,
    String reason,
    String provider,
    String ruleId,
    Instant evaluatedAt,
    String evaluationId
) {}
```

Kenapa?

Saat incident, pertanyaan yang muncul bukan hanya:

```text
Flag true atau false?
```

Tetapi:

```text
Mengapa true?
Rule mana yang match?
Default dipakai atau provider menjawab?
Evaluated kapan?
Untuk context siapa?
Provider mana?
Apakah cached?
```

Dalam sistem regulatori/case management, ini sangat penting untuk defensibility.

---

## 10. Default Value: Keputusan Paling Penting Saat Provider Gagal

Setiap flag harus punya default.

```java
boolean enabled = flags.isEnabled("new-case-flow", ctx, false);
```

Tetapi default bukan sekadar nilai teknis. Default adalah **safety policy**.

Contoh:

| Flag | Default aman | Alasan |
|---|---:|---|
| `new-case-flow.enabled` | `false` | jangan aktifkan fitur baru saat provider gagal |
| `external-payment.enabled` | `false` | hindari panggilan eksternal bermasalah |
| `audit-writing.enabled` | `true` atau fail-closed | audit biasanya tidak boleh diam-diam mati |
| `login.security.strict-mode` | `true` | security cenderung fail-closed |
| `notification.email.enabled` | tergantung domain | bisa false untuk mencegah spam, tapi mungkin wajib untuk SLA |

Tidak ada default universal.

Pertanyaan desainnya:

```text
Jika flag provider tidak tersedia, sistem harus fail-open atau fail-closed?
```

---

## 11. Fail-Open vs Fail-Closed

### 11.1 Fail-Open

Jika flag gagal dievaluasi, izinkan behavior berjalan.

Cocok untuk:

- fitur non-kritis;
- UX enhancement;
- performance optimization;
- non-security path.

Risiko:

- fitur risky aktif saat provider gagal;
- inconsistent exposure.

### 11.2 Fail-Closed

Jika flag gagal dievaluasi, block atau fallback ke safe path.

Cocok untuk:

- security;
- payment;
- legal/compliance;
- destructive operation;
- external side-effect;
- risky migration.

Risiko:

- availability turun;
- terlalu konservatif;
- false negative menghambat user.

### 11.3 Fail-Static

Jika provider gagal, pakai snapshot/cache terakhir.

Cocok untuk:

- provider remote;
- high availability requirement;
- rollout yang tidak boleh berubah mendadak.

Risiko:

- stale decision;
- kill switch terlambat.

---

## 12. Server-Side vs Client-Side Flag

### 12.1 Server-Side Evaluation

Flag dievaluasi di backend.

Kelebihan:

- rule tersembunyi;
- secret aman;
- audit lebih kuat;
- cocok untuk business logic;
- cocok untuk regulatory decision.

Kekurangan:

- UI perlu API untuk tahu state;
- lebih banyak backend integration.

### 12.2 Client-Side Evaluation

Flag dievaluasi di browser/mobile.

Kelebihan:

- UI bisa berubah cepat;
- cocok untuk tampilan;
- latency rendah.

Kekurangan:

- rule/value bisa terlihat;
- tidak aman untuk security/business enforcement;
- context privacy risk.

Rule enterprise:

```text
Client-side flag boleh menyembunyikan/menampilkan UI,
tetapi server-side authorization/business enforcement tetap wajib.
```

Contoh buruk:

```text
Tombol delete disembunyikan oleh flag di UI,
tetapi backend endpoint delete tetap menerima request tanpa check.
```

Contoh benar:

```text
UI flag menyembunyikan tombol.
Backend tetap mengevaluasi permission + feature flag + authorization policy.
```

---

## 13. Feature Flag Architecture Options

### 13.1 Static Config Flag

Flag disimpan di property file/env var.

```properties
feature.case.new-flow.enabled=false
```

CDI producer:

```java
@ApplicationScoped
public class FeatureFlags {

    @Inject
    @ConfigProperty(name = "feature.case.new-flow.enabled", defaultValue = "false")
    boolean newCaseFlowEnabled;

    public boolean newCaseFlowEnabled() {
        return newCaseFlowEnabled;
    }
}
```

Kelebihan:

- sederhana;
- portable;
- mudah dites;
- tidak butuh provider eksternal.

Kekurangan:

- biasanya perlu restart/redeploy;
- tidak cocok untuk rollout cepat;
- tidak cocok untuk targeting kompleks.

Cocok untuk:

- low-frequency operational switch;
- environment-specific enablement;
- bootstrap flag.

### 13.2 Dynamic Config Flag

Flag dibaca dari config source yang bisa berubah.

Misalnya:

- database table;
- Consul;
- etcd;
- Kubernetes ConfigMap dengan reload;
- vendor flag platform;
- custom admin console.

Kelebihan:

- bisa berubah tanpa redeploy;
- bisa dioperasikan saat incident.

Kekurangan:

- consistency lebih sulit;
- caching harus jelas;
- audit harus dibuat;
- provider failure harus ditangani.

### 13.3 Dedicated Feature Flag Platform

Contoh konsep:

- flag provider;
- SDK;
- evaluation context;
- targeting rule;
- rollout;
- audit log;
- experimentation;
- change history.

Kelebihan:

- matang untuk rollout;
- UI management;
- audit;
- SDK/caching;
- targeting.

Kekurangan:

- vendor dependency;
- data/privacy review;
- network dependency;
- cost;
- operational governance.

### 13.4 In-House Flag Service

Kelebihan:

- sesuai domain;
- data tetap internal;
- bisa mengikuti compliance;
- bisa integrate dengan agency/tenant model.

Kekurangan:

- membangun platform itu mahal;
- rule engine bisa menjadi kompleks;
- butuh admin UI;
- butuh audit;
- butuh SDK;
- butuh caching;
- butuh HA.

Jangan membangun in-house flag platform hanya karena membuat table `FEATURE_FLAG` terlihat mudah.

---

## 14. Minimal Domain Model untuk Feature Flag

Jika membangun internal abstraction, jangan mulai dari `Map<String, Boolean>`.

Model minimal:

```java
public interface FeatureFlagService {
    boolean isEnabled(String key, FlagContext context, boolean defaultValue);

    <T> FeatureDecision<T> evaluate(
        FlagKey<T> key,
        FlagContext context,
        T defaultValue
    );
}
```

Typed key:

```java
public final class FlagKey<T> {
    private final String name;
    private final Class<T> type;

    private FlagKey(String name, Class<T> type) {
        this.name = name;
        this.type = type;
    }

    public static FlagKey<Boolean> bool(String name) {
        return new FlagKey<>(name, Boolean.class);
    }

    public static FlagKey<String> string(String name) {
        return new FlagKey<>(name, String.class);
    }

    public String name() {
        return name;
    }

    public Class<T> type() {
        return type;
    }
}
```

Decision:

```java
public record FeatureDecision<T>(
    String key,
    T value,
    boolean defaultUsed,
    String reason,
    Instant evaluatedAt
) {
    public boolean isEnabledBoolean() {
        if (!(value instanceof Boolean b)) {
            throw new IllegalStateException("Decision is not boolean: " + key);
        }
        return b;
    }
}
```

Contoh pemakaian:

```java
public final class FeatureKeys {
    private FeatureKeys() {}

    public static final FlagKey<Boolean> NEW_SCORING_ENGINE =
        FlagKey.bool("case.scoring.new-engine.enabled");

    public static final FlagKey<String> CASE_ROUTING_MODE =
        FlagKey.string("case.routing.mode");
}
```

```java
FeatureDecision<Boolean> decision = flags.evaluate(
    FeatureKeys.NEW_SCORING_ENGINE,
    context,
    false
);

if (decision.value()) {
    return newScoringEngine.score(command);
}
return legacyScoringEngine.score(command);
```

---

## 15. CDI Integration Pattern 1: Explicit Service Injection

Pattern paling sederhana dan sering paling jelas:

```java
@ApplicationScoped
public class CaseScoringService {

    private final FeatureFlagService flags;
    private final LegacyScoringEngine legacy;
    private final NewScoringEngine next;
    private final FlagContextFactory contextFactory;

    @Inject
    public CaseScoringService(
        FeatureFlagService flags,
        LegacyScoringEngine legacy,
        NewScoringEngine next,
        FlagContextFactory contextFactory
    ) {
        this.flags = flags;
        this.legacy = legacy;
        this.next = next;
        this.contextFactory = contextFactory;
    }

    public ScoreResult score(ScoreCommand command) {
        FlagContext ctx = contextFactory.from(command);

        boolean enabled = flags.isEnabled(
            "case.scoring.new-engine.enabled",
            ctx,
            false
        );

        if (enabled) {
            return next.score(command);
        }
        return legacy.score(command);
    }
}
```

Kelebihan:

- sangat eksplisit;
- mudah dites;
- decision point terlihat;
- cocok untuk behavior penting.

Kekurangan:

- banyak `if` jika dipakai sembarangan;
- bisa menyebarkan flag ke banyak class;
- removal perlu disiplin.

Rule:

```text
Gunakan explicit service injection untuk decision yang business-critical dan perlu terlihat jelas.
```

---

## 16. CDI Integration Pattern 2: Strategy Selection

Daripada menaruh `if` di banyak tempat, bungkus selection di satu service.

Interface:

```java
public interface CaseScoringEngine {
    ScoreResult score(ScoreCommand command);
}
```

Implementasi:

```java
@ApplicationScoped
@LegacyEngine
public class LegacyCaseScoringEngine implements CaseScoringEngine {
    public ScoreResult score(ScoreCommand command) {
        return legacyScore(command);
    }
}
```

```java
@ApplicationScoped
@NewEngine
public class NewCaseScoringEngine implements CaseScoringEngine {
    public ScoreResult score(ScoreCommand command) {
        return newScore(command);
    }
}
```

Router:

```java
@ApplicationScoped
public class FlaggedCaseScoringEngine implements CaseScoringEngine {

    private final FeatureFlagService flags;
    private final FlagContextFactory contextFactory;
    private final CaseScoringEngine legacy;
    private final CaseScoringEngine next;

    @Inject
    public FlaggedCaseScoringEngine(
        FeatureFlagService flags,
        FlagContextFactory contextFactory,
        @LegacyEngine CaseScoringEngine legacy,
        @NewEngine CaseScoringEngine next
    ) {
        this.flags = flags;
        this.contextFactory = contextFactory;
        this.legacy = legacy;
        this.next = next;
    }

    @Override
    public ScoreResult score(ScoreCommand command) {
        FlagContext ctx = contextFactory.from(command);
        if (flags.isEnabled("case.scoring.new-engine.enabled", ctx, false)) {
            return next.score(command);
        }
        return legacy.score(command);
    }
}
```

Consumer hanya inject satu facade/router:

```java
@Inject
CaseScoringEngine scoringEngine;
```

Tetapi hati-hati ambiguity. Jika `LegacyCaseScoringEngine`, `NewCaseScoringEngine`, dan `FlaggedCaseScoringEngine` semua expose type `CaseScoringEngine` dengan `@Default`, injection bisa ambiguous.

Solusi:

- beri qualifier pada internal implementation;
- hanya router yang `@Default`;
- atau jangan expose implementation sebagai default bean.

---

## 17. CDI Integration Pattern 3: Producer-Selected Implementation

Producer bisa memilih implementation pada startup.

```java
@ApplicationScoped
public class ScoringEngineProducer {

    @Inject
    @ConfigProperty(name = "feature.case.scoring.new-engine.startup-enabled", defaultValue = "false")
    boolean newEngineStartupEnabled;

    @Inject
    @LegacyEngine
    CaseScoringEngine legacy;

    @Inject
    @NewEngine
    CaseScoringEngine next;

    @Produces
    @ApplicationScoped
    public CaseScoringEngine scoringEngine() {
        return newEngineStartupEnabled ? next : legacy;
    }
}
```

Cocok untuk:

- startup-time selection;
- environment-level selection;
- performance-sensitive code yang tidak ingin evaluate per request.

Tidak cocok untuk:

- per-user targeting;
- percentage rollout;
- runtime kill switch;
- dynamic per-request behavior.

Mental model:

```text
Producer-selected implementation = pilih sekali saat object dibuat.
Feature flag dynamic = bisa pilih berbeda per context/request.
```

---

## 18. CDI Integration Pattern 4: Interceptor-Based Feature Gate

Untuk operation-level gating, interceptor bisa menarik.

Annotation:

```java
@Inherited
@InterceptorBinding
@Retention(RUNTIME)
@Target({TYPE, METHOD})
public @interface FeatureGate {
    String value();
    boolean defaultEnabled() default false;
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

    @Inject
    FlagContextFactory contextFactory;

    @AroundInvoke
    public Object around(InvocationContext ic) throws Exception {
        FeatureGate gate = findFeatureGate(ic);
        FlagContext ctx = contextFactory.fromCurrentRequest();

        boolean enabled = flags.isEnabled(
            gate.value(),
            ctx,
            gate.defaultEnabled()
        );

        if (!enabled) {
            throw new FeatureDisabledException(gate.value());
        }

        return ic.proceed();
    }

    private FeatureGate findFeatureGate(InvocationContext ic) {
        FeatureGate methodGate = ic.getMethod().getAnnotation(FeatureGate.class);
        if (methodGate != null) {
            return methodGate;
        }
        return ic.getTarget().getClass().getAnnotation(FeatureGate.class);
    }
}
```

Usage:

```java
@FeatureGate(value = "case.bulk-approval.enabled", defaultEnabled = false)
public BulkApprovalResult approve(BulkApprovalCommand command) {
    ...
}
```

Kelebihan:

- bersih untuk block/unblock operation;
- reusable;
- cocok untuk endpoint/use case gate;
- bisa diaudit di satu tempat.

Kekurangan:

- decision tersembunyi di annotation;
- sulit jika perlu fallback path kompleks;
- self-invocation problem;
- butuh hati-hati ordering dengan transaction/security interceptor.

Rule:

```text
Gunakan interceptor gate untuk access/blocking concern.
Jangan gunakan untuk memilih algoritma bisnis kompleks.
```

---

## 19. CDI Integration Pattern 5: Decorator-Based Enforcement

Decorator cocok jika feature flag memodifikasi behavior berdasarkan interface bisnis.

Interface:

```java
public interface CaseSubmissionService {
    SubmissionResult submit(SubmitCaseCommand command);
}
```

Decorator:

```java
@Decorator
public class FeatureFlaggedCaseSubmissionDecorator implements CaseSubmissionService {

    @Inject
    @Delegate
    CaseSubmissionService delegate;

    @Inject
    FeatureFlagService flags;

    @Inject
    FlagContextFactory contextFactory;

    @Override
    public SubmissionResult submit(SubmitCaseCommand command) {
        FlagContext ctx = contextFactory.from(command);

        if (!flags.isEnabled("case.submission.enabled", ctx, true)) {
            return SubmissionResult.disabled("Case submission is temporarily disabled");
        }

        return delegate.submit(command);
    }
}
```

Kelebihan:

- membungkus semantic business contract;
- cocok untuk enrichment/fallback/enforcement;
- lebih domain-aware daripada interceptor.

Kekurangan:

- membutuhkan interface desain yang baik;
- chain decorator bisa kompleks;
- debugging butuh pemahaman CDI decorator.

---

## 20. Integration Pattern 6: `Instance<T>` Dynamic Lookup

CDI `Instance<T>` bisa dipakai untuk dynamic strategy lookup.

```java
@ApplicationScoped
public class PaymentProcessorRouter {

    @Inject
    FeatureFlagService flags;

    @Inject
    @Any
    Instance<PaymentProcessor> processors;

    public PaymentResult process(PaymentCommand command) {
        String mode = flags.getString(
            "payment.processor.mode",
            context(command),
            "legacy"
        );

        PaymentProcessor processor = processors
            .select(new ProcessorLiteral(mode))
            .get();

        return processor.process(command);
    }
}
```

Ini powerful, tetapi dekat dengan service locator jika berlebihan.

Gunakan jika:

- jumlah strategy memang banyak;
- strategy selection adalah core requirement;
- qualifier/model selection jelas;
- error handling untuk missing strategy jelas.

Jangan gunakan hanya untuk menghindari constructor injection eksplisit.

---

## 21. Flag Provider Abstraction

Abstraction yang sehat:

```text
Application code
   │
   ▼
FeatureFlagService interface
   │
   ├── MicroProfileConfigFeatureFlagService
   ├── DatabaseFeatureFlagService
   ├── VendorSdkFeatureFlagService
   └── CompositeFeatureFlagService
```

### 21.1 MicroProfile Config Provider

```java
@ApplicationScoped
public class ConfigBackedFeatureFlagService implements FeatureFlagService {

    @Inject
    Config config;

    @Override
    public boolean isEnabled(String key, FlagContext context, boolean defaultValue) {
        String configKey = "feature." + key;
        return config.getOptionalValue(configKey, Boolean.class)
                     .orElse(defaultValue);
    }
}
```

Cocok untuk basic flag.

Keterbatasan:

- no targeting;
- no rule engine;
- audit perubahan tergantung config source;
- dynamic behavior tergantung implementation/config source.

### 21.2 Database Provider

Schema minimal:

```sql
CREATE TABLE FEATURE_FLAG (
    FLAG_KEY        VARCHAR2(200) PRIMARY KEY,
    FLAG_TYPE       VARCHAR2(30) NOT NULL,
    DEFAULT_VALUE   VARCHAR2(4000) NOT NULL,
    ENABLED         NUMBER(1) NOT NULL,
    OWNER           VARCHAR2(100) NOT NULL,
    DESCRIPTION     VARCHAR2(1000),
    EXPIRES_AT      TIMESTAMP NULL,
    UPDATED_AT      TIMESTAMP NOT NULL,
    UPDATED_BY      VARCHAR2(100) NOT NULL,
    VERSION         NUMBER NOT NULL
);
```

Untuk targeting rule:

```sql
CREATE TABLE FEATURE_FLAG_RULE (
    RULE_ID         VARCHAR2(100) PRIMARY KEY,
    FLAG_KEY        VARCHAR2(200) NOT NULL,
    PRIORITY        NUMBER NOT NULL,
    CONDITION_JSON  CLOB NOT NULL,
    VALUE_JSON      CLOB NOT NULL,
    ENABLED         NUMBER(1) NOT NULL,
    UPDATED_AT      TIMESTAMP NOT NULL,
    UPDATED_BY      VARCHAR2(100) NOT NULL
);
```

Jangan lupa audit:

```sql
CREATE TABLE FEATURE_FLAG_AUDIT (
    AUDIT_ID        VARCHAR2(100) PRIMARY KEY,
    FLAG_KEY        VARCHAR2(200) NOT NULL,
    ACTION          VARCHAR2(50) NOT NULL,
    OLD_VALUE       CLOB,
    NEW_VALUE       CLOB,
    REASON          VARCHAR2(1000),
    CHANGED_BY      VARCHAR2(100) NOT NULL,
    CHANGED_AT      TIMESTAMP NOT NULL,
    APPROVAL_ID     VARCHAR2(100)
);
```

### 21.3 Vendor/OpenFeature Provider

OpenFeature-style abstraction memisahkan application code dari vendor-specific SDK.

Mental model:

```text
OpenFeature API
    │
    ▼
Provider abstraction
    │
    ├── Vendor A provider
    ├── Vendor B provider
    ├── In-memory provider
    └── Custom internal provider
```

Keuntungannya:

- application code tidak terlalu vendor-locked;
- provider bisa diganti;
- hooks bisa dipakai untuk observability/tracing;
- SDK dapat memberi standard vocabulary.

Tetap perlu governance internal. Standard API tidak otomatis menyelesaikan policy, privacy, audit, dan lifecycle flag.

---

## 22. Cache dan Consistency

Feature flag evaluation bisa terjadi sangat sering. Tidak realistis memanggil remote service/database setiap `if`.

### 22.1 Cache Lokal

```text
App instance A cache: flag snapshot v10
App instance B cache: flag snapshot v10
App instance C cache: flag snapshot v9
```

Risiko:

- inconsistent behavior antar node;
- kill switch tidak langsung efektif;
- audit sulit jika tidak tahu versi flag.

### 22.2 TTL-Based Cache

```text
refresh every 30s
```

Kelebihan:

- sederhana;
- tidak butuh push infrastructure.

Kekurangan:

- perubahan tidak instant;
- terlalu pendek → load tinggi;
- terlalu panjang → stale.

### 22.3 Streaming / Push Update

Provider mengirim update ke SDK.

Kelebihan:

- update cepat;
- cocok untuk kill switch.

Kekurangan:

- koneksi tambahan;
- failure mode lebih kompleks;
- perlu fallback snapshot.

### 22.4 Snapshot Versioning

Setiap evaluation sebaiknya bisa tahu versi flag/snapshot.

```java
public record FeatureDecision<T>(
    String key,
    T value,
    String snapshotVersion,
    String ruleId,
    boolean cached,
    Instant evaluatedAt
) {}
```

Dengan ini, log incident bisa menjawab:

```text
Request A memakai flag snapshot v42.
Request B memakai flag snapshot v43.
```

### 22.5 Consistency Requirement Berdasarkan Flag Type

| Flag type | Consistency need | Catatan |
|---|---|---|
| UI enhancement | rendah | stale beberapa menit mungkin ok |
| release flag | sedang | rollout bisa toleran sedikit delay |
| kill switch | tinggi | harus cepat berlaku |
| security/compliance | sangat tinggi | perlu fail-closed atau central enforcement |
| migration/dual-write | tinggi | inconsistent decision bisa merusak data |

---

## 23. Request-Scoped Decision Cache

Untuk menghindari evaluasi berbeda dalam satu request, simpan decision per request.

```java
@RequestScoped
public class RequestFeatureDecisionCache {

    private final Map<String, FeatureDecision<?>> decisions = new HashMap<>();

    @SuppressWarnings("unchecked")
    public <T> FeatureDecision<T> getOrCompute(
        String key,
        Supplier<FeatureDecision<T>> supplier
    ) {
        return (FeatureDecision<T>) decisions.computeIfAbsent(key, k -> supplier.get());
    }
}
```

Service:

```java
@ApplicationScoped
public class CachedFeatureFlagService implements FeatureFlagService {

    @Inject
    RemoteFeatureFlagProvider provider;

    @Inject
    Instance<RequestFeatureDecisionCache> requestCache;

    public boolean isEnabled(String key, FlagContext ctx, boolean defaultValue) {
        FeatureDecision<Boolean> decision;

        if (requestCache.isResolvable()) {
            decision = requestCache.get().getOrCompute(
                key + ":" + ctx.stableKey(),
                () -> provider.booleanDecision(key, ctx, defaultValue)
            );
        } else {
            decision = provider.booleanDecision(key, ctx, defaultValue);
        }

        return decision.value();
    }
}
```

Catatan:

- request scope mungkin tidak aktif di background job;
- jangan memaksa `@RequestScoped` di async thread tanpa context propagation;
- part concurrency/context propagation sudah memberi dasar untuk ini.

---

## 24. Observability Feature Flag

Feature flag yang tidak observable adalah runtime mystery.

Minimal log untuk decision penting:

```json
{
  "event": "feature_flag_evaluated",
  "requestId": "REQ-123",
  "flagKey": "case.scoring.new-engine.enabled",
  "value": true,
  "defaultUsed": false,
  "reason": "TARGET_MATCH",
  "ruleId": "rule-high-risk-10pct",
  "snapshotVersion": "42",
  "agency": "CEA",
  "caseType": "LICENSING",
  "provider": "internal-db",
  "evaluatedAt": "2026-06-16T12:00:00Z"
}
```

Tetapi jangan log PII.

### 24.1 Metrics

Metric yang berguna:

```text
feature_flag_evaluation_total{flag, value, reason}
feature_flag_default_used_total{flag}
feature_flag_provider_error_total{provider}
feature_flag_cache_hit_total{provider}
feature_flag_cache_age_seconds{provider}
feature_flag_stale_snapshot_total{provider}
```

### 24.2 Tracing

Span attributes:

```text
feature.flag.key
feature.flag.value
feature.flag.reason
feature.flag.default_used
feature.flag.provider
feature.flag.rule_id
```

Untuk flag yang sangat sering dievaluasi, jangan membuat span baru per evaluation; cukup attribute/event sampling atau log selective.

### 24.3 Admin Visibility

Admin/runtime dashboard harus bisa menjawab:

- flag aktif apa saja di environment ini;
- siapa owner;
- kapan terakhir berubah;
- rule mana aktif;
- berapa persen exposure;
- flag mana expired;
- flag mana tidak pernah dievaluasi;
- flag mana masih referenced di code;
- kill switch mana available.

---

## 25. Auditability dan Regulatory Defensibility

Dalam sistem regulatori, feature flag bisa mengubah hasil proses.

Contoh:

```text
policy.require-manager-approval.enabled = true
```

Jika user bertanya kenapa case mereka membutuhkan approval tambahan, sistem harus bisa menjelaskan:

```text
Pada waktu submission, flag policy X aktif untuk agency Y dan case type Z,
berdasarkan rule R versi V, disetujui oleh approver A pada tanggal T.
```

Untuk flag yang memengaruhi keputusan bisnis/regulatory, simpan minimal:

- flag key;
- evaluated value;
- rule id;
- rule version/snapshot version;
- evaluation time;
- relevant non-sensitive context;
- default used atau tidak;
- correlation/request id.

Jangan hanya menyimpan current flag value. Current value bisa berbeda dari value saat decision terjadi.

---

## 26. Feature Flag Lifecycle

Feature flag harus punya lifecycle.

```text
1. Proposed
2. Approved
3. Created
4. Implemented
5. Deployed Off
6. Enabled for Internal
7. Enabled for Pilot
8. Partial Rollout
9. Full Rollout
10. Retired from Runtime
11. Removed from Code
12. Archived from Registry
```

### 26.1 Metadata Wajib

Setiap flag sebaiknya punya:

```text
key
name
description
type
category
owner
createdBy
createdAt
expectedRemovalDate
jira/story/changeRequest
riskLevel
defaultValue
failPolicy
allowedValues
approvalRequired
lastChangedBy
lastChangedAt
```

### 26.2 Expiry Date

Release flag tanpa expiry date hampir pasti menjadi debt.

Contoh metadata:

```yaml
key: case.scoring.new-engine.enabled
type: boolean
category: release
owner: case-platform-team
createdAt: 2026-06-16
expectedRemovalDate: 2026-08-31
defaultValue: false
failPolicy: fail-closed
changeRequest: CR-2026-00123
riskLevel: high
```

---

## 27. Flag Debt

Flag debt muncul saat flag tetap ada setelah tidak dibutuhkan.

Gejalanya:

- `if (flag)` tersebar di banyak tempat;
- flag tidak punya owner;
- tidak ada yang tahu default aman;
- flag sudah 100% enabled tetapi code lama masih ada;
- test matrix membesar;
- behavior sulit diprediksi;
- flag tidak pernah dievaluasi tapi tetap ada;
- nested flag condition.

Contoh smell:

```java
if (flagA) {
    if (flagB) {
        if (!flagC) {
            runPath1();
        } else {
            runPath2();
        }
    }
} else if (flagD) {
    runPath3();
} else {
    runLegacy();
}
```

Ini bukan progressive delivery. Ini runtime maze.

### 27.1 Removal Discipline

Setelah flag 100% enabled dan stable:

1. hapus old path;
2. hapus conditional;
3. hapus test lama yang tidak relevan;
4. hapus config/flag registry;
5. update documentation;
6. close change request;
7. simpan audit archive jika perlu.

### 27.2 Flag Review Cadence

Minimal bulanan:

```text
flag inventory review
expired flag review
owner validation
unused flag detection
100%-enabled flag cleanup
kill switch validation
```

---

## 28. Testing Strategy

Feature flag menggandakan jalur behavior.

Jika ada satu boolean flag:

```text
2 combinations
```

Jika ada lima boolean flag bebas:

```text
2^5 = 32 combinations
```

Karena itu, jangan membuat flag sembarangan.

### 28.1 Unit Test

Test old path dan new path.

```java
@Test
void usesLegacyScoringWhenFlagDisabled() {
    flags.set("case.scoring.new-engine.enabled", false);

    ScoreResult result = service.score(command);

    assertThat(result.engine()).isEqualTo("legacy");
}

@Test
void usesNewScoringWhenFlagEnabled() {
    flags.set("case.scoring.new-engine.enabled", true);

    ScoreResult result = service.score(command);

    assertThat(result.engine()).isEqualTo("new");
}
```

### 28.2 Contract Test untuk Default

```java
@Test
void defaultsToLegacyWhenProviderFails() {
    flags.failProvider();

    ScoreResult result = service.score(command);

    assertThat(result.engine()).isEqualTo("legacy");
}
```

### 28.3 Integration Test untuk CDI Wiring

Pastikan:

- qualifier benar;
- router tidak ambiguous;
- producer memilih benar;
- interceptor aktif;
- decorator chain benar.

### 28.4 Rollout Rule Test

Untuk percentage rollout:

```java
@Test
void sameUserGetsSameBucket() {
    int b1 = bucket("user-123", "flag-a");
    int b2 = bucket("user-123", "flag-a");

    assertThat(b1).isEqualTo(b2);
}
```

Untuk allowlist:

```java
@Test
void enablesOnlyPilotAgency() {
    assertEnabled(agency("CEA-PILOT"));
    assertDisabled(agency("CEA-NORMAL"));
}
```

### 28.5 Test Matrix Reduction

Jangan test semua kombinasi flag jika tidak semua kombinasi valid.

Gunakan:

- risk-based testing;
- pairwise testing;
- explicit invalid combination test;
- variant enum daripada banyak boolean;
- compatibility matrix untuk migration flag.

---

## 29. Feature Flag dan Database Migration

Ini bagian berisiko tinggi.

### 29.1 Safe Expand-Contract Pattern

```text
1. Expand schema: tambah column/table baru tanpa menghapus lama.
2. Deploy code yang bisa baca/tulis compatible.
3. Enable dual-write atau shadow-write dengan flag.
4. Validate/reconcile data.
5. Enable read-from-new dengan flag untuk pilot.
6. Rollout read-from-new.
7. Stop writing old path.
8. Contract schema lama setelah aman.
```

### 29.2 Jangan Gunakan Flag untuk Menyembunyikan Breaking Schema Change

Buruk:

```text
Deploy code yang membutuhkan column baru,
tetapi column belum ada,
dan berharap flag off membuat aman.
```

Masalah:

- class initialization bisa query metadata;
- ORM mapping bisa gagal;
- validation startup bisa gagal;
- code path tidak selalu benar-benar unreachable.

### 29.3 Dual-Write Flag

Dual-write flag harus sangat hati-hati.

```java
if (flags.isEnabled("document.storage.dual-write-s3", ctx, false)) {
    legacyStorage.save(doc);
    s3Storage.save(doc);
} else {
    legacyStorage.save(doc);
}
```

Pertanyaan wajib:

- bagaimana jika write pertama sukses, kedua gagal?
- apakah transaksi sama?
- apakah idempotent?
- bagaimana retry?
- bagaimana reconcile?
- bagaimana rollback?
- apakah read path ikut berubah?

---

## 30. Feature Flag dan Distributed Systems

Dalam microservices/distributed architecture, flag bisa dievaluasi oleh banyak service.

Masalah:

```text
Service A melihat flag=true.
Service B melihat flag=false.
Workflow menjadi inconsistent.
```

### 30.1 Propagate Decision, Bukan Hanya Key

Untuk workflow kritis, buat decision di boundary awal lalu propagasikan.

```json
{
  "commandId": "CMD-123",
  "featureDecisions": {
    "case.scoring.new-engine.enabled": {
      "value": true,
      "ruleId": "rule-10pct",
      "snapshotVersion": "42"
    }
  }
}
```

Cocok untuk:

- async workflow;
- saga;
- batch processing;
- case lifecycle;
- regulatory decision.

### 30.2 Jangan Propagate Semua Flag

Propagate hanya decision yang memengaruhi workflow contract.

### 30.3 Idempotency

Jika flag berubah di tengah retry, apakah retry memakai decision lama atau baru?

Untuk command yang harus deterministic:

```text
Retry harus memakai decision yang sama dengan attempt pertama.
```

Untuk operation yang boleh mengikuti current state:

```text
Retry boleh re-evaluate.
```

Tentukan secara eksplisit.

---

## 31. Feature Flag dan Batch Job

Batch job punya karakteristik berbeda dari request-response.

Pertanyaan penting:

- flag dievaluasi sekali saat job start atau per item?
- jika flag berubah saat batch berjalan, apakah batch ikut berubah?
- apakah hasil batch harus reproducible?
- apakah flag decision disimpan di batch metadata?

Pattern aman:

```java
public BatchResult run(BatchCommand command) {
    FlagContext ctx = contextFactory.fromBatch(command);
    FeatureDecision<Boolean> decision = flags.evaluate(
        FeatureKeys.NEW_RECONCILIATION,
        ctx,
        false
    );

    BatchRunMetadata metadata = BatchRunMetadata.start(command, decision);

    for (BatchItem item : items) {
        process(item, decision.value());
    }

    return complete(metadata);
}
```

Untuk batch panjang, bisa ada control flag khusus:

```text
batch.report-generation.pause.enabled
batch.report-generation.kill.enabled
```

Tetapi behavior harus jelas:

- pause after current item;
- kill immediately;
- complete current chunk;
- rollback current transaction.

---

## 32. Feature Flag dan CDI Scope

### 32.1 `@ApplicationScoped` Flag Client

Flag client/provider biasanya `@ApplicationScoped`.

```java
@ApplicationScoped
public class RemoteFeatureFlagClient {
    ...
}
```

Karena:

- SDK client mahal dibuat;
- cache/snapshot global;
- connection/polling lifecycle global.

### 32.2 `@RequestScoped` Decision Cache

Decision per request bisa `@RequestScoped`.

### 32.3 `@Dependent` Helper

Value object/factory kecil bisa `@Dependent` atau plain object.

### 32.4 Jangan Simpan Request Context di ApplicationScoped Bean

Buruk:

```java
@ApplicationScoped
public class FeatureFlagService {
    private FlagContext lastContext; // salah, shared antar request
}
```

Ini thread-safety bug.

---

## 33. Feature Flag dan Transactions

Flag decision biasanya sebaiknya terjadi sebelum transaksi berat dimulai.

Buruk:

```java
@Transactional
public void submit(Command command) {
    boolean enabled = remoteFlagProvider.evaluate(...); // network call inside tx
    ...
}
```

Risiko:

- transaksi terbuka saat network call;
- lock lebih lama;
- timeout;
- retry menjadi sulit.

Lebih baik:

```java
public void submit(Command command) {
    FeatureDecision<Boolean> decision = flags.evaluate(...);
    transactionalSubmit(command, decision);
}

@Transactional
void transactionalSubmit(Command command, FeatureDecision<Boolean> decision) {
    ...
}
```

Namun self-invocation proxy problem harus diperhatikan jika `@Transactional` memakai interceptor/proxy. Biasanya transactional boundary diletakkan di bean lain atau dipanggil melalui proxy.

---

## 34. Feature Flag dan Security

Feature flag bukan authorization.

Layer aman:

```text
Authentication → Authorization → Feature Exposure → Business Invariant
```

Contoh:

```java
public void approveCase(ApproveCommand command) {
    security.requireRole("CASE_APPROVER");

    if (!flags.isEnabled("case.approval.new-flow", context(command), false)) {
        legacyApproval.approve(command);
        return;
    }

    newApproval.approve(command);
}
```

Bahkan jika flag aktif, user tetap harus authorized.

Bahkan jika user authorized, feature belum tentu exposed.

---

## 35. Naming Convention

Feature flag key harus stabil, jelas, dan domain-oriented.

Format rekomendasi:

```text
<domain>.<capability>.<behavior>.<aspect>
```

Contoh:

```text
case.scoring.new-engine.enabled
case.approval.bulk.enabled
integration.onemap.lookup.enabled
notification.email.dispatch.enabled
report.export.large-file.enabled
policy.high-risk-case.second-approval.required
```

Hindari:

```text
newFeature
flag1
temp
fajarTest
enableNewThing
prodFix
```

Key adalah API runtime. Perlakukan seperti public contract.

---

## 36. Flag Ownership Model

Setiap flag harus punya owner.

| Flag Category | Owner utama | Co-owner |
|---|---|---|
| Release | engineering lead | product/BA/QA |
| Ops kill switch | SRE/app support | engineering |
| Compliance/policy | business policy owner | engineering/security |
| Migration | engineering lead | DBA/infra/product |
| Experiment | product | analytics/engineering |

Tanpa owner, flag menjadi orphan.

---

## 37. Change Control

Untuk enterprise/regulatory system, tidak semua orang boleh mengubah flag.

Minimal policy:

```text
Low-risk UI flag: developer/product owner can change in non-prod.
Production release flag: approved release manager/product owner.
Ops kill switch: on-call lead can change during incident, with post-review.
Compliance flag: requires policy/business approval.
Security flag: requires security owner approval.
```

Setiap perubahan production flag harus punya:

- who;
- when;
- what changed;
- old value;
- new value;
- reason;
- ticket/change request;
- approval if required.

---

## 38. Flag Registry as Runtime Contract

Jangan biarkan flag hanya hidup sebagai string literal di code.

Buat registry:

```java
public enum FeatureFlagDefinition {

    CASE_SCORING_NEW_ENGINE(
        "case.scoring.new-engine.enabled",
        FlagType.BOOLEAN,
        FlagCategory.RELEASE,
        "case-platform-team",
        false,
        FailPolicy.FAIL_CLOSED
    ),

    ONEMAP_LOOKUP_ENABLED(
        "integration.onemap.lookup.enabled",
        FlagType.BOOLEAN,
        FlagCategory.OPS,
        "integration-team",
        true,
        FailPolicy.FAIL_CLOSED
    );

    ...
}
```

Atau YAML registry:

```yaml
flags:
  - key: case.scoring.new-engine.enabled
    type: boolean
    category: release
    owner: case-platform-team
    default: false
    failPolicy: fail-closed
    expectedRemovalDate: 2026-08-31
```

Keuntungan:

- bisa generate docs;
- bisa validate unknown flag;
- bisa detect expired flag;
- bisa enforce naming;
- bisa scan code references;
- bisa expose admin inventory.

---

## 39. Anti-Patterns

### 39.1 Flag as Random If Everywhere

```java
if (config.get("feature.x")) { ... }
```

Masalah:

- tidak ada abstraction;
- tidak ada audit;
- tidak ada context;
- tidak ada default policy;
- sulit cleanup.

### 39.2 Flag Without Expiry

Flag release tanpa tanggal hapus = debt by default.

### 39.3 Nested Flags

```java
if (flagA) {
    if (flagB) {
        if (flagC) {
            ...
        }
    }
}
```

Lebih baik ubah ke mode/variant atau policy object.

### 39.4 Flag Reused for New Meaning

Buruk:

```text
case.new-flow.enabled
```

Awalnya untuk workflow A, lalu dipakai juga untuk validation B, lalu notification C.

Ini membuat rollback tidak presisi.

Satu flag harus punya satu semantic purpose.

### 39.5 Flag as Security Boundary

Menyembunyikan fitur dengan flag tanpa backend authorization adalah bug keamanan.

### 39.6 Permanent Release Flag

Kalau flag selalu true selama 1 tahun, mungkin bukan release flag lagi. Entah:

- harus dihapus;
- menjadi configuration/policy;
- menjadi product entitlement;
- menjadi tenant capability.

### 39.7 Flag Around Broken Code

Feature flag bukan alasan untuk merge code yang tidak siap secara teknis.

Code di balik flag tetap harus:

- compile;
- deploy;
- tidak merusak startup;
- tidak merusak schema;
- tidak menimbulkan side effect saat off;
- bisa dites.

---

## 40. Design Example: Case Management New Scoring Engine

### 40.1 Requirement

Sistem case management ingin memperkenalkan scoring engine baru.

Constraint:

- harus deploy sebelum tanggal effective;
- hanya agency tertentu dulu;
- hanya high-risk case;
- bisa rollback cepat;
- old engine tetap tersedia;
- hasil scoring harus audit-able;
- retry harus deterministic;
- tidak boleh kirim PII ke external flag provider.

### 40.2 Flag Definition

```yaml
key: case.scoring.engine.mode
type: string
allowedValues:
  - LEGACY
  - NEW_SHADOW
  - NEW_ACTIVE
  - DISABLED
category: migration
owner: case-platform-team
default: LEGACY
failPolicy: fail-closed-to-legacy
expectedRemovalDate: 2026-10-31
```

### 40.3 Evaluation Context

```java
public record CaseScoringFlagContext(
    String agency,
    String caseType,
    String riskLevel,
    String environment,
    String rolloutKey,
    String module,
    String operation
) {}
```

### 40.4 Decision Flow

```text
if mode = DISABLED:
    reject scoring or use safe fallback according to business rule
if mode = LEGACY:
    legacy score
if mode = NEW_SHADOW:
    legacy score as source of truth + new score for comparison only
if mode = NEW_ACTIVE:
    new score as source of truth + optional legacy comparison
```

### 40.5 Code

```java
@ApplicationScoped
public class CaseScoringApplicationService {

    private final FeatureFlagService flags;
    private final LegacyScoringEngine legacy;
    private final NewScoringEngine next;
    private final ScoringAuditService audit;
    private final FlagContextFactory contextFactory;

    @Inject
    public CaseScoringApplicationService(
        FeatureFlagService flags,
        LegacyScoringEngine legacy,
        NewScoringEngine next,
        ScoringAuditService audit,
        FlagContextFactory contextFactory
    ) {
        this.flags = flags;
        this.legacy = legacy;
        this.next = next;
        this.audit = audit;
        this.contextFactory = contextFactory;
    }

    public ScoreResult score(ScoreCommand command) {
        FlagContext ctx = contextFactory.from(command);

        FeatureDecision<String> decision = flags.evaluate(
            FeatureKeys.CASE_SCORING_ENGINE_MODE,
            ctx,
            "LEGACY"
        );

        ScoringMode mode = ScoringMode.valueOf(decision.value());

        ScoreResult result = switch (mode) {
            case LEGACY -> legacy.score(command);
            case NEW_SHADOW -> scoreShadow(command);
            case NEW_ACTIVE -> next.score(command);
            case DISABLED -> ScoreResult.disabled("Scoring temporarily disabled");
        };

        audit.record(command, decision, result);
        return result;
    }

    private ScoreResult scoreShadow(ScoreCommand command) {
        ScoreResult legacyResult = legacy.score(command);
        try {
            ScoreResult newResult = next.score(command);
            audit.recordShadowComparison(command, legacyResult, newResult);
        } catch (Exception ex) {
            audit.recordShadowFailure(command, ex);
        }
        return legacyResult;
    }
}
```

Untuk Java 8, `switch` expression diganti dengan `switch` statement biasa.

### 40.6 Why Variant Is Better Here

Empat mode lebih jelas daripada tiga boolean:

```text
newEngineEnabled
shadowModeEnabled
scoringDisabled
```

Boolean kombinasi bisa menghasilkan state invalid:

```text
newEngineEnabled=true
shadowModeEnabled=true
scoringDisabled=true
```

Variant enum membuat state lebih eksplisit.

---

## 41. Design Example: External API Kill Switch

### 41.1 Requirement

External API untuk address lookup sering rate-limited. Sistem harus bisa mematikan lookup tanpa redeploy.

Flag:

```yaml
key: integration.address.lookup.enabled
type: boolean
category: ops
default: true
failPolicy: fail-closed-to-cache-only
owner: integration-team
```

Code:

```java
@ApplicationScoped
public class AddressLookupService {

    @Inject
    FeatureFlagService flags;

    @Inject
    AddressCache cache;

    @Inject
    ExternalAddressClient client;

    public Address lookup(AddressQuery query) {
        FlagContext ctx = FlagContext.forOperation(
            "integration",
            "address-lookup",
            query.safeRolloutKey()
        );

        boolean enabled = flags.isEnabled(
            "integration.address.lookup.enabled",
            ctx,
            false
        );

        Optional<Address> cached = cache.find(query);

        if (!enabled) {
            return cached.orElseThrow(() -> new ServiceTemporarilyUnavailableException(
                "Address lookup temporarily unavailable"
            ));
        }

        return cached.orElseGet(() -> client.lookup(query));
    }
}
```

Catatan:

- default `false` jika provider gagal, karena external call risky;
- fallback ke cache;
- tidak expose token ke frontend;
- audit perubahan flag penting untuk incident.

---

## 42. Checklist Desain Feature Flag

Sebelum membuat flag, jawab:

```text
1. Apa tujuan flag ini?
2. Ini release, ops, migration, experiment, permission, atau compliance flag?
3. Apakah flag ini temporary atau permanent?
4. Siapa owner-nya?
5. Kapan harus dihapus?
6. Apa default value-nya?
7. Jika provider gagal, fail-open atau fail-closed?
8. Apakah butuh targeting per user/tenant/agency?
9. Apakah butuh percentage rollout?
10. Apakah decision harus konsisten sepanjang request/workflow?
11. Apakah decision harus diaudit?
12. Apakah flag boleh dievaluasi client-side?
13. Apakah flag memengaruhi security/compliance?
14. Bagaimana test old path dan new path?
15. Bagaimana rollback?
16. Bagaimana observability?
17. Bagaimana cleanup setelah rollout?
```

---

## 43. Decision Matrix: Pattern Mana yang Dipakai?

| Need | Pattern terbaik |
|---|---|
| Sederhana, static, environment-level | MicroProfile Config boolean |
| Startup-time implementation selection | Producer-selected implementation |
| Per-request business path selection | Explicit FeatureFlagService injection |
| Banyak strategy implementation | Qualifier + router / `Instance<T>` |
| Block/unblock operation | Interceptor feature gate |
| Semantic wrapper/fallback pada interface | Decorator |
| External API kill switch | Explicit service + cache fallback |
| Migration dual-read/write | Explicit orchestration service |
| Compliance/policy switch | Explicit service + audit decision |
| UI-only exposure | Client flag + backend enforcement tetap |
| Vendor-neutral SDK abstraction | OpenFeature-like provider abstraction |

---

## 44. Java 8 sampai Java 25 Considerations

### Java 8

- tidak ada records;
- tidak ada switch expression;
- gunakan class biasa;
- CDI/Java EE biasanya masih `javax.*`;
- banyak app server legacy.

### Java 11

- baseline banyak modernisasi enterprise;
- tetap banyak `javax` stack.

### Java 17

- baseline penting untuk Jakarta EE 11 minimum platform modern;
- records bisa dipakai untuk context/decision;
- sealed classes bisa membantu model variant jika runtime mendukung.

### Java 21

- virtual threads mulai relevan;
- jangan asumsikan semua Jakarta runtime langsung aman untuk semua virtual-thread usage;
- flag provider SDK harus dicek blocking behavior-nya.

### Java 25

- modern LTS/feature baseline baru;
- design principle tetap sama;
- feature flag abstraction sebaiknya tidak bergantung pada fitur bahasa terbaru jika library harus kompatibel Java 8.

Untuk library internal yang harus lintas Java 8–25, hindari record/switch expression di core shared artifact, atau buat multi-release/version-specific artifact.

---

## 45. Hubungan dengan Part Berikutnya

Part berikutnya membahas **Conditional Beans and Runtime Selection Patterns**.

Feature flag adalah salah satu input untuk conditional behavior, tetapi tidak semua conditional selection adalah feature flag.

Part berikutnya akan memperdalam:

- compile-time selection;
- startup-time selection;
- runtime-per-call selection;
- qualifier-based selection;
- producer-based selection;
- alternative-based selection;
- strategy registry;
- tenant-specific implementation;
- environment-specific implementation;
- menghindari service locator anti-pattern.

---

## 46. Ringkasan Mental Model

Feature flag adalah runtime control point.

Jangan pikirkan sebagai:

```text
boolean config
```

Pikirkan sebagai:

```text
context + rule + default + provider + decision + audit + lifecycle + cleanup
```

Feature flag yang baik:

- punya purpose jelas;
- punya owner;
- punya default aman;
- punya failure policy;
- punya evaluation context minimal dan aman;
- observable;
- auditable jika memengaruhi bisnis/regulatory behavior;
- tidak menggantikan authorization;
- tidak menyebar liar di code;
- dites untuk path on/off;
- punya removal plan.

Feature flag yang buruk:

- string literal acak;
- tidak punya owner;
- tidak punya expiry;
- menjadi nested conditional maze;
- mencampur config/profile/security/business policy;
- tidak observable;
- tidak pernah dihapus.

Di enterprise runtime, feature flag adalah alat risk management. Tetapi seperti semua alat risk management, tanpa governance ia berubah menjadi sumber risiko baru.

---

## 47. Latihan Praktis

### Latihan 1 — Klasifikasi Flag

Klasifikasikan flag berikut sebagai release, ops, migration, experiment, permission, compliance, atau config biasa:

```text
case.new-review-screen.enabled
report.export.maxRows
integration.payment.enabled
policy.require-dual-approval.enabled
ui.dashboard.variant
storage.document.useS3
role.bulkApproval.allowed
```

Untuk masing-masing, tentukan:

- owner;
- default;
- fail policy;
- apakah temporary;
- apakah perlu audit.

### Latihan 2 — Refactor Boolean Explosion

Ubah tiga boolean berikut menjadi variant model:

```text
newEngineEnabled
shadowModeEnabled
newEngineStrictValidationEnabled
```

Buat enum state yang valid dan jelaskan transisi rollout-nya.

### Latihan 3 — Design Kill Switch

Desain kill switch untuk external service:

```text
integration.identity-verification.enabled
```

Tentukan:

- default jika provider gagal;
- fallback behavior;
- metric;
- audit log;
- siapa yang boleh mengubah flag.

### Latihan 4 — CDI Integration

Buat desain untuk memilih `LegacyNotificationSender` atau `NewNotificationSender` berdasarkan feature flag:

- versi explicit service injection;
- versi router strategy;
- versi producer startup-time;
- jelaskan kapan masing-masing tepat.

### Latihan 5 — Cleanup Plan

Sebuah flag sudah 100% enabled selama 3 bulan:

```text
case.new-submission-flow.enabled
```

Buat checklist cleanup code, test, config, registry, dan audit archive.

---

## 48. Status Seri

Part ini selesai.

Seri belum selesai.

Bagian yang sudah selesai sampai titik ini:

```text
[x] Part 000 — Orientation: Enterprise Runtime Mental Model
[x] Part 001 — Dependency Management: From JAR Hell to Reproducible Enterprise Builds
[x] Part 002 — API, SPI, Implementation, Provider: The Hidden Layering of Java Enterprise
[x] Part 003 — Java EE to Jakarta EE Migration Model: javax.* to jakarta.*
[x] Part 004 — Runtime / Container Model: Who Owns Your Object?
[x] Part 005 — Classloaders, Modules, and Deployment Isolation
[x] Part 006 — Dependency Injection Fundamentals: Inversion of Control Done Correctly
[x] Part 007 — JSR-330 / Jakarta Inject: Minimal DI Vocabulary
[x] Part 008 — CDI Core Mental Model: Bean, Type, Qualifier, Scope, Context
[x] Part 009 — Bean Discovery and Archive Model
[x] Part 010 — CDI Scopes Deep Dive: Request, Session, Application, Dependent, Conversation
[x] Part 011 — CDI Proxies, Normal Scopes, and Method Dispatch
[x] Part 012 — Qualifiers, Alternatives, Specialization, and Priority
[x] Part 013 — Producers and Disposers: Programmatic Object Supply
[x] Part 014 — CDI Events: Decoupling Without Losing Runtime Clarity
[x] Part 015 — Interceptors: Cross-Cutting Behavior as Runtime Boundary
[x] Part 016 — Decorators: Semantic Wrapping of Business Interfaces
[x] Part 017 — Stereotypes and Annotation Composition
[x] Part 018 — Lifecycle Callbacks: Construction, Initialization, Destruction
[x] Part 019 — CDI Extensions and Portable Runtime Customization
[x] Part 020 — Enterprise Beans / EJB Mental Model: Why It Exists and What Still Matters
[x] Part 021 — Stateless, Stateful, Singleton Beans and Pooling Semantics
[x] Part 022 — EJB Transactions, Timers, Async, and Security Boundaries
[x] Part 023 — Jakarta Common Annotations and Resource Injection
[x] Part 024 — Naming, JNDI, Environment Entries, and Externalized Resources
[x] Part 025 — Configuration Fundamentals: Values, Secrets, Environments, and Runtime Contracts
[x] Part 026 — MicroProfile Config Deep Dive
[x] Part 027 — Profiles: Environment-Specific Behavior Without Code Forking
[x] Part 028 — Feature Flags: Runtime Decisioning, Risk Control, and Progressive Delivery
```

Bagian berikutnya:

```text
Part 029 — Conditional Beans and Runtime Selection Patterns
```
