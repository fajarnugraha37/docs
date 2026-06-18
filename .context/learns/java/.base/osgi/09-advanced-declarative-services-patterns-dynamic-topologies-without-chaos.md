# Part 9 — Advanced Declarative Services Patterns: Dynamic Topologies Without Chaos

> Series: `learn-java-osgi-dynamic-module-runtime-engineering`  
> File: `09-advanced-declarative-services-patterns-dynamic-topologies-without-chaos.md`  
> Scope: Java 8 sampai Java 25, OSGi Core/Compendium R8+, Apache Felix SCR, Equinox, bnd/Bndtools, Karaf-style runtime  
> Prasyarat: Part 0–8 terutama service registry, lifecycle, classloading, resolver, semantic versioning, dan Declarative Services fundamentals.

---

## 0. Tujuan Part Ini

Pada Part 8 kita membahas Declarative Services dari sisi lifecycle dan annotation: `@Component`, `@Reference`, cardinality, policy, policy option, configuration, activation, deactivation, dan condition.

Part 9 naik satu level: **bagaimana menggunakan Declarative Services untuk membangun topology runtime yang dinamis tanpa menjadi chaos**.

Ini penting karena OSGi bukan hanya DI container. OSGi adalah runtime yang mengizinkan:

- service datang saat aplikasi sedang hidup,
- service hilang saat aplikasi sedang hidup,
- service diganti oleh implementasi ranking lebih tinggi,
- configuration berubah saat runtime,
- bundle update menyebabkan service graph berubah,
- plugin ditambah/dilepas tanpa restart penuh,
- beberapa implementasi dari contract yang sama hidup bersamaan,
- topology aplikasi berubah karena deployment, config, feature, atau capability.

Kalau dipahami secara dangkal, OSGi dynamicity akan terasa berbahaya. Kalau dipahami dengan benar, dynamicity menjadi alat arsitektur untuk membangun platform yang evolvable.

Tujuan akhir part ini:

1. Kamu paham pattern advanced DS yang sering dipakai di sistem OSGi nyata.
2. Kamu bisa memilih pattern yang tepat: whiteboard, adapter, strategy, chain, pipeline, plugin registry, conditional service, degraded service, dan quarantine.
3. Kamu bisa mendesain dynamic service topology yang aman terhadap race condition, stale reference, partial startup, dan service disappearance.
4. Kamu bisa membedakan dynamic architecture yang sehat vs sekadar “semua dibuat dynamic supaya fleksibel”.
5. Kamu punya checklist desain untuk runtime OSGi yang bisa dioperasikan di production.

---

## 1. Mental Model: DS Advanced Patterns Bukan Tentang Injection, Tapi Tentang Runtime Topology

Di banyak framework dependency injection tradisional, dependency graph dianggap relatif statis:

```text
App starts
  -> container creates beans
  -> dependencies wired
  -> app runs
  -> graph mostly stable until shutdown
```

Dalam OSGi DS, graph dapat berubah:

```text
Framework starts
  -> bundle A active
  -> service X appears
  -> component B becomes satisfied
  -> component B publishes service Y
  -> plugin P appears
  -> manager M sees P dynamically
  -> config changes target filter
  -> service X disappears
  -> component B may deactivate or rebind
  -> higher-ranked service X2 appears
  -> component B may switch depending on policy
```

Karena itu, pertanyaan desain bukan hanya:

```text
Bagaimana cara inject dependency?
```

Melainkan:

```text
Apa invariant runtime yang tetap benar meskipun dependency graph berubah?
```

Contoh invariant yang baik:

```text
ValidationEngine boleh menerima rule baru saat runtime,
tetapi request yang sedang berjalan harus memakai snapshot rule yang konsisten.
```

Contoh invariant buruk:

```text
ValidationEngine selalu memakai list rule global mutable yang berubah saat request sedang iterasi.
```

Perbedaannya bukan syntax DS. Perbedaannya adalah desain topology.

---

## 2. Vocabulary yang Perlu Stabil

Sebelum masuk pattern, kita stabilkan istilah.

| Istilah | Makna |
|---|---|
| Provider service | Service yang dipublish ke registry. |
| Consumer component | Component yang memakai service dari registry. |
| Whiteboard manager | Component yang mengamati banyak service sejenis dan mengoordinasikan eksekusinya. |
| Plugin service | Implementasi extension point yang bisa ditambah/dilepas. |
| Adapter service | Service yang membungkus sistem/contract lain menjadi contract lokal. |
| Strategy service | Service alternatif untuk memilih algoritma/behavior. |
| Ordered service | Service yang dieksekusi berdasarkan ranking/order property. |
| Dynamic reference | Reference yang bisa berubah tanpa deactivate component. |
| Static reference | Perubahan reference biasanya menyebabkan component lifecycle change. |
| Snapshot | Salinan immutable dari set service saat satu operasi dimulai. |
| Stable boundary | Contract yang tetap walau implementasi berganti. |
| Topology | Bentuk runtime graph antar service dan component. |

---

## 3. Kenapa Advanced DS Pattern Dibutuhkan

OSGi memberi kemampuan dasar:

```java
@Reference
SomeService service;
```

Tetapi real system jarang sesederhana itu. Contoh kebutuhan nyata:

- ada banyak validator dan semuanya harus dijalankan;
- validator punya urutan;
- validator hanya berlaku untuk module tertentu;
- rule baru boleh ditambah oleh bundle plugin;
- ada connector ke eksternal agency yang bisa disabled;
- ada implementation default tetapi bisa dioverride;
- ada service yang optional tetapi jika ada harus dipakai;
- ada service yang tidak sehat dan harus dikeluarkan dari routing;
- ada pipeline enrichment yang terdiri dari beberapa stage;
- ada handler command berdasarkan type;
- ada feature yang aktif hanya jika configuration/capability tersedia;
- ada service yang harus drain request dulu sebelum unregister;
- ada service yang ranking-nya lebih tinggi tetapi belum warm-up.

Kalau semua diselesaikan dengan field injection sederhana, hasilnya rapuh.

Advanced DS pattern memberi bentuk yang lebih disiplin.

---

## 4. Design Principle Utama: Dynamic Does Not Mean Inconsistent

Dynamic runtime bukan alasan untuk membiarkan behavior berubah di tengah operasi tanpa kontrol.

Prinsip utama:

```text
Runtime topology boleh berubah antar operasi.
Satu operasi bisnis harus melihat model dependency yang konsisten.
```

Contoh buruk:

```java
for (ValidationRule rule : rules) {
    rule.validate(application);
}
```

Jika `rules` adalah list mutable yang bisa berubah saat iterasi karena DS bind/unbind dynamic, operasi dapat:

- throw `ConcurrentModificationException`,
- melewatkan rule,
- menjalankan rule dua kali,
- melihat kombinasi rule yang tidak pernah dimaksudkan,
- gagal nondeterministic.

Contoh lebih aman:

```java
List<ValidationRule> snapshot = this.ruleSnapshot;
for (ValidationRule rule : snapshot) {
    rule.validate(application);
}
```

Dengan invariant:

```text
Bind/unbind boleh mengganti snapshot secara atomik.
Request aktif memakai snapshot lama sampai selesai.
Request berikutnya memakai snapshot baru.
```

Ini adalah salah satu mental model paling penting untuk advanced DS.

---

## 5. Pattern 1 — Whiteboard Pattern

### 5.1 Masalah yang Diselesaikan

Dalam Java tradisional, extensibility sering dibuat dengan listener registration:

```java
manager.addListener(listener);
manager.removeListener(listener);
```

Masalahnya:

- listener harus tahu manager;
- manager expose API registrasi manual;
- lifecycle deregistration mudah lupa;
- plugin harus melakukan imperative registration;
- memory leak jika unregister tidak dipanggil;
- ordering, filtering, dan metadata sering dibuat ad-hoc;
- runtime dynamicity tidak terintegrasi dengan service registry.

Whiteboard pattern membalik arah.

Bukan plugin mendaftarkan diri ke manager secara manual, tetapi plugin publish dirinya sebagai service. Manager mengamati registry.

```text
Traditional listener:

Plugin -> manager.addListener(plugin)

Whiteboard:

Plugin -> OSGi Service Registry
Manager -> tracks all Plugin services
```

OSGi whiteboard pattern memanfaatkan registry sebagai public coordination space. OSGi whitepaper menjelaskan bahwa whiteboard pattern menggunakan service registry, bukan private registry/listener manual, sehingga event source cukup memanggil listeners yang saat ini terdaftar sebagai service.

### 5.2 Struktur Dasar

Contract:

```java
package com.acme.validation.api;

public interface ValidationRule {
    ValidationResult validate(ValidationContext context);
}
```

Plugin provider:

```java
@Component(
    service = ValidationRule.class,
    property = {
        "module=licensing",
        "rule.id=eligibility.minimum-age",
        "rule.order:Integer=100"
    }
)
public final class MinimumAgeRule implements ValidationRule {
    @Override
    public ValidationResult validate(ValidationContext context) {
        // rule logic
        return ValidationResult.ok();
    }
}
```

Manager:

```java
@Component(service = ValidationEngine.class)
public final class WhiteboardValidationEngine implements ValidationEngine {

    private volatile List<RuleEntry> snapshot = List.of();

    @Reference(
        service = ValidationRule.class,
        cardinality = ReferenceCardinality.MULTIPLE,
        policy = ReferencePolicy.DYNAMIC
    )
    void bindRule(ValidationRule rule, Map<String, Object> properties) {
        updateSnapshot(rule, properties, true);
    }

    void unbindRule(ValidationRule rule, Map<String, Object> properties) {
        updateSnapshot(rule, properties, false);
    }

    @Override
    public ValidationReport validate(ValidationContext context) {
        List<RuleEntry> current = snapshot;
        ValidationReport.Builder report = ValidationReport.builder();
        for (RuleEntry entry : current) {
            if (entry.appliesTo(context)) {
                report.add(entry.rule().validate(context));
            }
        }
        return report.build();
    }
}
```

### 5.3 Yang Perlu Diperhatikan

Whiteboard pattern bagus ketika:

- banyak extension provider;
- provider tidak perlu tahu consumer;
- provider dapat datang/pergi saat runtime;
- metadata provider penting untuk filtering/order;
- sistem ingin menghindari private registry.

Whiteboard pattern buruk ketika:

- hanya ada satu dependency wajib;
- lifecycle harus sangat ketat dan atomic across many services;
- extension perlu transaction kompleks dengan manager;
- ordering/state antar plugin terlalu kompleks untuk service property biasa;
- plugin tidak boleh langsung diekspos ke registry.

### 5.4 Invariant Whiteboard yang Sehat

```text
Provider owns implementation.
Registry owns discovery.
Manager owns orchestration.
Contract owns compatibility.
Operation owns consistency snapshot.
```

Kalau manager mulai tahu class implementation provider, whiteboard pattern sudah bocor.

---

## 6. Pattern 2 — Service Metadata as Routing Contract

Service properties bukan dekorasi. Dalam advanced DS, service property sering menjadi routing contract.

Contoh:

```java
@Component(
    service = DocumentRenderer.class,
    property = {
        "document.type=NOTICE_OF_INTENT",
        "format=PDF",
        "jurisdiction=SG",
        "renderer.version=2",
        "service.ranking:Integer=100"
    }
)
public final class NoticeOfIntentPdfRenderer implements DocumentRenderer {
    // ...
}
```

Consumer dapat memilih berdasarkan filter:

```java
@Reference(
    target = "(&(document.type=NOTICE_OF_INTENT)(format=PDF)(jurisdiction=SG))"
)
private DocumentRenderer renderer;
```

Atau manager dapat track semua renderer dan route manual:

```java
public Optional<DocumentRenderer> find(RenderRequest request) {
    return snapshot.stream()
        .filter(entry -> entry.matches(request))
        .sorted(bySpecificityThenRanking())
        .map(RendererEntry::renderer)
        .findFirst();
}
```

### 6.1 Properti yang Bagus

Service property yang bagus:

- stabil,
- kecil,
- bisa di-index secara mental,
- tidak mengandung data request,
- tidak berubah terlalu sering,
- tidak menyimpan object kompleks tanpa alasan kuat,
- bisa didokumentasikan sebagai contract.

Contoh property sehat:

```text
module=case-management
handler.type=appeal-submitted
format=pdf
region=sg
schema.version=2
capability=ocr
```

Contoh property buruk:

```text
currentUser=fajar
lastRequestId=...
largeJsonConfig={...}
mutableState=...
```

Service property adalah metadata service, bukan session/request state.

### 6.2 Jangan Overload `service.ranking`

`service.ranking` bagus untuk preferensi umum, tetapi buruk jika dipakai sebagai satu-satunya mekanisme routing.

Buruk:

```text
ranking 9999 = special renderer for agency A and doc type B after 2026
```

Lebih baik:

```text
agency=CEA
document.type=ENFORCEMENT_NOTICE
effective.from=2026-01-01
service.ranking=100
```

Ranking menjawab:

```text
Jika beberapa kandidat sama-sama cocok, mana yang lebih dipilih?
```

Ranking tidak seharusnya menyembunyikan semua dimensi bisnis.

---

## 7. Pattern 3 — Strategy Service Pattern

### 7.1 Masalah

Aplikasi sering punya banyak algoritma untuk contract yang sama:

- `RiskScoringStrategy`,
- `NotificationChannel`,
- `AddressResolver`,
- `DocumentRenderer`,
- `PenaltyCalculator`,
- `EligibilityEvaluator`.

Dalam classpath app, kita mungkin menulis:

```java
switch (type) {
    case "EMAIL" -> emailSender.send(...);
    case "SMS" -> smsSender.send(...);
}
```

Dalam OSGi, lebih baik setiap strategy menjadi service.

### 7.2 Contract

```java
public interface NotificationChannel {
    boolean supports(NotificationRequest request);
    DeliveryResult send(NotificationRequest request);
}
```

Provider:

```java
@Component(
    service = NotificationChannel.class,
    property = {
        "channel=email",
        "service.ranking:Integer=100"
    }
)
public final class EmailNotificationChannel implements NotificationChannel {
    @Override
    public boolean supports(NotificationRequest request) {
        return request.channel().equals("email");
    }

    @Override
    public DeliveryResult send(NotificationRequest request) {
        // send email
        return DeliveryResult.accepted();
    }
}
```

Router:

```java
@Component(service = NotificationRouter.class)
public final class NotificationRouter {

    private volatile List<NotificationChannel> channels = List.of();

    @Reference(
        service = NotificationChannel.class,
        cardinality = ReferenceCardinality.MULTIPLE,
        policy = ReferencePolicy.DYNAMIC
    )
    void bind(NotificationChannel channel) {
        channels = appendSorted(channels, channel);
    }

    void unbind(NotificationChannel channel) {
        channels = remove(channels, channel);
    }

    public DeliveryResult route(NotificationRequest request) {
        for (NotificationChannel channel : channels) {
            if (channel.supports(request)) {
                return channel.send(request);
            }
        }
        return DeliveryResult.rejected("No notification channel supports request");
    }
}
```

### 7.3 Metadata vs `supports()`

Ada dua cara memilih strategy:

1. berdasarkan service property;
2. berdasarkan method `supports()`.

Property cocok untuk selection yang statis dan murah:

```text
channel=email
country=SG
format=PDF
```

`supports()` cocok untuk selection yang perlu logic:

```text
request amount > threshold
application has appeal history
case status in complex state set
```

Hybrid sering paling bagus:

```text
Service property mempersempit kandidat.
supports() memvalidasi logic detail.
```

---

## 8. Pattern 4 — Ordered Chain Pattern

### 8.1 Masalah

Kadang semua service harus dieksekusi berurutan:

- validation chain,
- enrichment chain,
- audit enrichment,
- request interceptor,
- document post-processor,
- workflow transition guard.

### 8.2 Contract

```java
public interface CaseTransitionGuard {
    GuardResult check(TransitionContext context);
}
```

Provider:

```java
@Component(
    service = CaseTransitionGuard.class,
    property = {
        "guard.id=has-required-documents",
        "guard.order:Integer=100"
    }
)
public final class RequiredDocumentsGuard implements CaseTransitionGuard {
    @Override
    public GuardResult check(TransitionContext context) {
        // check docs
        return GuardResult.pass();
    }
}
```

Manager:

```java
@Component(service = TransitionGuardChain.class)
public final class TransitionGuardChain {

    private final Object lock = new Object();
    private final List<GuardEntry> entries = new ArrayList<>();
    private volatile List<GuardEntry> snapshot = List.of();

    @Reference(
        service = CaseTransitionGuard.class,
        cardinality = ReferenceCardinality.MULTIPLE,
        policy = ReferencePolicy.DYNAMIC
    )
    void bindGuard(CaseTransitionGuard guard, Map<String, Object> props) {
        synchronized (lock) {
            entries.add(GuardEntry.from(guard, props));
            snapshot = sortedCopy(entries);
        }
    }

    void unbindGuard(CaseTransitionGuard guard, Map<String, Object> props) {
        synchronized (lock) {
            entries.removeIf(e -> e.guard() == guard);
            snapshot = sortedCopy(entries);
        }
    }

    public GuardResult check(TransitionContext context) {
        for (GuardEntry entry : snapshot) {
            GuardResult result = entry.guard().check(context);
            if (!result.allowed()) {
                return result;
            }
        }
        return GuardResult.pass();
    }
}
```

### 8.3 Ordering Rule

Jangan hanya mengandalkan `service.ranking` jika ordering adalah business contract. Gunakan property eksplisit:

```text
guard.order=100
```

Lalu pakai `service.ranking` sebagai tie-breaker jika perlu.

Recommended ordering comparator:

```text
1. explicit order ascending
2. service.ranking descending
3. service.id ascending for deterministic tie-break
```

Kenapa perlu deterministic tie-break?

Karena nondeterminism di chain business bisa menghasilkan bug yang sulit direproduksi.

### 8.4 Fail-Fast vs Accumulate

Ordered chain perlu menentukan execution semantics.

Fail-fast:

```text
Stop saat guard pertama gagal.
```

Cocok untuk:

- authorization guard,
- transition guard,
- request filter.

Accumulate:

```text
Jalankan semua rule dan kumpulkan hasil.
```

Cocok untuk:

- validation report,
- data quality check,
- readiness diagnostic.

Best practice: jadikan semantics bagian dari contract, bukan keputusan incidental di manager.

---

## 9. Pattern 5 — Pipeline Pattern

### 9.1 Chain vs Pipeline

Chain biasanya semua step melihat context yang sama dan menghasilkan result.

Pipeline biasanya step mengubah/memperkaya data:

```text
Input -> Stage A -> Stage B -> Stage C -> Output
```

Contoh:

```text
Raw application data
  -> normalize address
  -> enrich applicant profile
  -> calculate risk score
  -> attach policy flags
  -> final assessment context
```

### 9.2 Contract

```java
public interface AssessmentPipelineStage {
    StageResult apply(AssessmentContext context);
}
```

Provider:

```java
@Component(
    service = AssessmentPipelineStage.class,
    property = {
        "stage.id=address-normalization",
        "stage.order:Integer=100"
    }
)
public final class AddressNormalizationStage implements AssessmentPipelineStage {
    @Override
    public StageResult apply(AssessmentContext context) {
        return StageResult.updated(context.withNormalizedAddress(...));
    }
}
```

Pipeline runner:

```java
public AssessmentContext run(AssessmentContext initial) {
    AssessmentContext current = initial;
    for (StageEntry stage : snapshot) {
        StageResult result = stage.stage().apply(current);
        if (result.stop()) {
            return result.context();
        }
        current = result.context();
    }
    return current;
}
```

### 9.3 Immutability Penting

Pipeline akan lebih aman jika context immutable:

```java
public record AssessmentContext(
    String caseId,
    Applicant applicant,
    Address address,
    RiskProfile riskProfile,
    Map<String, Object> attributes
) {
    public AssessmentContext withRiskProfile(RiskProfile riskProfile) {
        return new AssessmentContext(caseId, applicant, address, riskProfile, attributes);
    }
}
```

Mutable shared context rawan:

- stage saling overwrite,
- partial mutation jika exception,
- race condition,
- debugging sulit.

Jika context besar, gunakan controlled mutation dengan transaction-like boundary.

---

## 10. Pattern 6 — Adapter Service Pattern

### 10.1 Masalah

OSGi system sering perlu berinteraksi dengan:

- legacy library,
- external service,
- non-OSGi plugin,
- Spring component,
- JDBC driver,
- cloud SDK,
- native dependency,
- proprietary connector.

Jangan biarkan seluruh sistem bergantung langsung pada detail eksternal. Buat adapter service.

```text
Domain component -> local OSGi service contract -> adapter implementation -> external system/library
```

### 10.2 Contoh

API:

```java
public interface AddressLookupService {
    AddressLookupResult lookupPostalCode(String postalCode);
}
```

Adapter:

```java
@Component(service = AddressLookupService.class)
public final class OneMapAddressLookupAdapter implements AddressLookupService {

    private volatile OneMapConfig config;

    @Activate
    void activate(OneMapConfig config) {
        this.config = config;
    }

    @Modified
    void modified(OneMapConfig config) {
        this.config = config;
    }

    @Override
    public AddressLookupResult lookupPostalCode(String postalCode) {
        // call external API through controlled client
        return AddressLookupResult.found(...);
    }
}
```

### 10.3 Adapter Boundary Invariant

Adapter harus menyerap perubahan eksternal:

```text
Jika external SDK berubah, domain contract tidak boleh langsung berubah.
Jika external endpoint down, adapter harus mengubah failure menjadi domain-level result.
Jika token/config berubah, adapter menangani reconfiguration.
```

Jangan bocorkan:

- SDK-specific exception,
- SDK DTO,
- SDK lifecycle,
- SDK classloader assumption,
- SDK retry semantics,
- SDK threading model.

Adapter service adalah anti-corruption layer di dalam runtime OSGi.

---

## 11. Pattern 7 — Plugin Registry Pattern

### 11.1 Whiteboard vs Plugin Registry

Whiteboard manager sering cukup jika plugin langsung dieksekusi.

Plugin registry dibutuhkan jika kamu perlu:

- lookup plugin by id,
- validate duplicate id,
- expose plugin catalog,
- manage plugin health,
- track plugin metadata,
- apply governance,
- support admin UI,
- support plugin compatibility check,
- quarantine plugin bermasalah.

### 11.2 Contract

```java
public interface EnforcementRulePlugin {
    RuleDescriptor descriptor();
    RuleExecutionResult execute(RuleExecutionContext context);
}
```

Descriptor:

```java
public record RuleDescriptor(
    String id,
    String name,
    Version version,
    Set<String> supportedModules,
    int order,
    boolean experimental
) {}
```

Registry service:

```java
public interface RulePluginRegistry {
    List<RuleDescriptor> listRules();
    Optional<EnforcementRulePlugin> findRule(String id);
    RuleRegistrySnapshot snapshot();
}
```

Implementation:

```java
@Component(service = RulePluginRegistry.class)
public final class OsgiRulePluginRegistry implements RulePluginRegistry {

    private final Object lock = new Object();
    private final Map<String, PluginEntry> entries = new HashMap<>();
    private volatile RuleRegistrySnapshot snapshot = RuleRegistrySnapshot.empty();

    @Reference(
        service = EnforcementRulePlugin.class,
        cardinality = ReferenceCardinality.MULTIPLE,
        policy = ReferencePolicy.DYNAMIC
    )
    void bindPlugin(EnforcementRulePlugin plugin, Map<String, Object> properties) {
        synchronized (lock) {
            PluginEntry entry = PluginEntry.from(plugin, properties);
            validateNoDuplicate(entry);
            entries.put(entry.id(), entry);
            snapshot = RuleRegistrySnapshot.from(entries.values());
        }
    }

    void unbindPlugin(EnforcementRulePlugin plugin, Map<String, Object> properties) {
        synchronized (lock) {
            entries.values().removeIf(entry -> entry.plugin() == plugin);
            snapshot = RuleRegistrySnapshot.from(entries.values());
        }
    }

    @Override
    public Optional<EnforcementRulePlugin> findRule(String id) {
        return Optional.ofNullable(snapshot.byId().get(id)).map(PluginEntry::plugin);
    }

    @Override
    public RuleRegistrySnapshot snapshot() {
        return snapshot;
    }
}
```

### 11.3 Duplicate Plugin Policy

Harus eksplisit:

| Policy | Makna | Cocok Untuk |
|---|---|---|
| Reject duplicate | Plugin id harus unik. | Regulated workflow, rule engine. |
| Highest ranking wins | Beberapa plugin boleh override. | Theme, renderer, optional strategy. |
| Multiple versions allowed | Plugin id sama boleh punya major version berbeda. | API migration, backward compatibility. |
| Quarantine duplicate | Plugin tetap registered tapi tidak aktif. | Admin-managed marketplace. |

Top-tier design tidak membiarkan duplicate behavior terjadi kebetulan.

---

## 12. Pattern 8 — Adapter + Whiteboard Hybrid

Sering terjadi: external connector berbeda-beda, tetapi host ingin uniform behavior.

Contoh:

```text
ExternalAgencyConnector
  - SLA connector
  - ROM connector
  - CPDS connector
  - Internal mock connector
```

Contract:

```java
public interface AgencyConnector {
    String agencyCode();
    ConnectorHealth health();
    SubmissionResult submit(SubmissionCommand command);
}
```

Provider:

```java
@Component(
    service = AgencyConnector.class,
    property = {
        "agency=ROM",
        "capability=submission",
        "service.ranking:Integer=100"
    }
)
public final class RomAgencyConnector implements AgencyConnector {
    // adapter to ROM
}
```

Router:

```java
public SubmissionResult submit(SubmissionCommand command) {
    AgencyConnector connector = registry.find(command.agencyCode())
        .orElseThrow(() -> new NoConnectorAvailableException(command.agencyCode()));

    if (!connector.health().canAcceptTraffic()) {
        return SubmissionResult.deferred("Connector unhealthy");
    }

    return connector.submit(command);
}
```

Pattern ini memisahkan:

```text
Adapter = menyerap detail eksternal.
Whiteboard/registry = menemukan dan mengelola adapter.
Router = memilih adapter berdasarkan business request.
```

---

## 13. Pattern 9 — Dynamic Replacement Pattern

### 13.1 Masalah

Kadang ada default implementation, lalu pada runtime muncul implementation yang lebih spesifik atau lebih tinggi ranking.

Contoh:

- default PDF renderer diganti agency-specific renderer;
- default risk scoring diganti experimental scoring;
- mock connector diganti real connector;
- old implementation diganti hotfix implementation.

### 13.2 DS Behavior

Dengan unary reference dan `GREEDY`, component bisa pindah ke higher-ranked service.

```java
@Reference(
    policy = ReferencePolicy.DYNAMIC,
    policyOption = ReferencePolicyOption.GREEDY
)
private volatile RiskScoringService scoringService;
```

Tetapi ini harus digunakan hati-hati.

### 13.3 Risiko

Jika service diganti saat request berjalan:

```java
RiskScoringService service = scoringService;
RiskScore score = service.score(request);
```

Aman karena local variable snapshot.

Buruk:

```java
if (scoringService.supports(request)) {
    return scoringService.score(request);
}
```

Antara `supports()` dan `score()`, reference bisa berubah.

Lebih aman:

```java
RiskScoringService service = scoringService;
if (service.supports(request)) {
    return service.score(request);
}
```

### 13.4 Replacement Harus Punya Semantics

Tentukan:

- apakah request aktif tetap memakai old service?
- apakah new service butuh warm-up?
- apakah old service perlu drain?
- apakah switch terjadi otomatis atau admin-controlled?
- apakah rollback possible?
- apakah state compatibility dijamin?

Dynamic replacement bukan sekadar ranking lebih tinggi.

---

## 14. Pattern 10 — Degraded Service Pattern

### 14.1 Masalah

Dalam service topology dinamis, dependency optional sering disalahgunakan.

Contoh:

```java
@Reference(cardinality = ReferenceCardinality.OPTIONAL)
private volatile ExternalScreeningService screening;
```

Lalu business logic:

```java
if (screening == null) {
    approve();
}
```

Ini berbahaya. Hilangnya screening service tidak boleh otomatis membuat approval lebih longgar.

### 14.2 Degraded Service sebagai Explicit Mode

Lebih baik buat contract yang bisa menyatakan degraded result.

```java
public interface ExternalScreeningService {
    ScreeningResult screen(ScreeningRequest request);
}
```

Fallback implementation:

```java
@Component(
    service = ExternalScreeningService.class,
    property = "service.ranking:Integer=-1000"
)
public final class DegradedScreeningService implements ExternalScreeningService {
    @Override
    public ScreeningResult screen(ScreeningRequest request) {
        return ScreeningResult.deferred("Screening service unavailable");
    }
}
```

Real implementation:

```java
@Component(
    service = ExternalScreeningService.class,
    property = "service.ranking:Integer=100"
)
public final class RealExternalScreeningService implements ExternalScreeningService {
    @Override
    public ScreeningResult screen(ScreeningRequest request) {
        // external call
        return ScreeningResult.clear();
    }
}
```

Consumer:

```java
@Reference(
    policy = ReferencePolicy.DYNAMIC,
    policyOption = ReferencePolicyOption.GREEDY
)
private volatile ExternalScreeningService screeningService;
```

Invariant:

```text
Consumer selalu punya service.
Saat real dependency hilang, behavior menjadi degraded secara eksplisit, bukan null behavior.
```

### 14.3 Cocok Untuk

- external dependency unavailable;
- feature temporarily disabled;
- local-only mode;
- audit-safe fallback;
- maintenance mode;
- regulated systems yang tidak boleh silently skip control.

---

## 15. Pattern 11 — Quarantine Service Pattern

### 15.1 Masalah

Plugin/service bisa registered tetapi tidak aman dipakai karena:

- health check gagal;
- config invalid;
- compatibility check gagal;
- duplicate id;
- repeated exception;
- dependency eksternal down;
- policy/security violation.

Jika langsung unbind/unregister, informasi plugin hilang dari registry. Jika tetap dipakai, sistem rusak.

Quarantine pattern memisahkan:

```text
Registered in OSGi registry != eligible for traffic
```

### 15.2 Registry Eligibility

```java
public enum EligibilityStatus {
    ACTIVE,
    QUARANTINED,
    DISABLED,
    INCOMPATIBLE,
    UNHEALTHY
}
```

Entry:

```java
public record PluginEntry(
    EnforcementRulePlugin plugin,
    RuleDescriptor descriptor,
    EligibilityStatus status,
    String reason
) {}
```

Router hanya memakai `ACTIVE`:

```java
List<PluginEntry> activePlugins = snapshot.entries().stream()
    .filter(entry -> entry.status() == EligibilityStatus.ACTIVE)
    .toList();
```

Admin/diagnostic tetap bisa melihat quarantined plugin.

### 15.3 Kapan Dipakai

- marketplace plugin;
- extensible regulatory workflow;
- external connectors;
- customer-specific extensions;
- critical validation rules;
- hotfix bundles.

Top-tier runtime tidak hanya “service ada/tidak ada”. Ia punya **eligibility model**.

---

## 16. Pattern 12 — Conditional Activation Pattern

### 16.1 Masalah

Component seharusnya aktif hanya jika kondisi tertentu terpenuhi:

- config tersedia;
- license/capability aktif;
- environment mendukung;
- dependency eksternal reachable;
- schema migration selesai;
- feature flag enabled;
- tenant/agency enabled.

### 16.2 Cara Umum

Ada beberapa pendekatan:

1. DS configuration policy.
2. Mandatory reference ke condition/capability service.
3. Target filter berdasarkan property.
4. Runtime eligibility di registry.
5. Explicit health/readiness gate.

Contoh mandatory reference:

```java
public interface FeatureCondition {
    String featureId();
    boolean enabled();
}
```

Provider condition:

```java
@Component(
    service = FeatureCondition.class,
    property = "feature.id=advanced-risk-scoring"
)
public final class AdvancedRiskScoringCondition implements FeatureCondition {
    @Override
    public String featureId() {
        return "advanced-risk-scoring";
    }

    @Override
    public boolean enabled() {
        return true;
    }
}
```

Consumer:

```java
@Component(service = RiskScoringService.class)
public final class AdvancedRiskScoringService implements RiskScoringService {

    @Reference(target = "(feature.id=advanced-risk-scoring)")
    private FeatureCondition condition;
}
```

Jika condition service tidak ada, component tidak satisfied.

### 16.3 Hati-Hati

Jangan menjadikan semua runtime check sebagai activation condition.

Activation condition cocok untuk:

```text
Service tidak boleh ada sama sekali jika condition tidak terpenuhi.
```

Runtime check cocok untuk:

```text
Service boleh ada, tetapi request tertentu mungkin ditolak/didegradasi.
```

---

## 17. Pattern 13 — Atomic Snapshot Reference Pattern

Ini pattern paling penting untuk dynamic multi-reference.

### 17.1 Masalah

Dynamic references berarti bind/unbind bisa terjadi ketika method public sedang berjalan.

Jika kamu menyimpan list mutable:

```java
private final List<Rule> rules = new ArrayList<>();
```

Lalu:

```java
for (Rule rule : rules) { ... }
```

Kamu punya race.

### 17.2 Solusi: Copy-on-Write Snapshot

```java
private final Object lock = new Object();
private final List<RuleEntry> mutable = new ArrayList<>();
private volatile List<RuleEntry> snapshot = List.of();

void bindRule(Rule rule, Map<String, Object> props) {
    synchronized (lock) {
        mutable.add(RuleEntry.from(rule, props));
        snapshot = List.copyOf(sort(mutable));
    }
}

void unbindRule(Rule rule, Map<String, Object> props) {
    synchronized (lock) {
        mutable.removeIf(entry -> entry.rule() == rule);
        snapshot = List.copyOf(sort(mutable));
    }
}

public Result execute(Context context) {
    List<RuleEntry> current = snapshot;
    for (RuleEntry entry : current) {
        // stable during this operation
    }
}
```

### 17.3 Kenapa `volatile`?

Karena kita ingin mengganti reference list secara atomik dan terlihat oleh thread lain.

```text
Bind thread updates snapshot.
Request thread reads latest published snapshot.
Request thread never mutates snapshot.
```

### 17.4 Kapan Tidak Cocok

Copy-on-write snapshot kurang cocok jika:

- service churn sangat tinggi;
- list sangat besar;
- bind/unbind sangat sering;
- update cost mahal.

Tetapi untuk banyak enterprise OSGi systems, service topology berubah jauh lebih jarang daripada request execution. Jadi copy-on-write sangat efektif.

---

## 18. Pattern 14 — Service Selection Snapshot Pattern

Untuk unary service replacement, tetap gunakan local snapshot:

```java
private volatile PaymentGateway gateway;

public PaymentResult pay(PaymentCommand command) {
    PaymentGateway current = gateway;
    if (current == null) {
        return PaymentResult.deferred("No gateway available");
    }
    return current.pay(command);
}
```

Jangan baca field volatile berkali-kali jika operasi perlu konsistensi:

```java
// buruk
if (gateway.supports(command)) {
    return gateway.pay(command);
}
```

Karena `gateway` bisa berubah antara dua akses.

Pattern:

```text
Read dynamic reference once at operation boundary.
Use local variable for the rest of operation.
```

---

## 19. Pattern 15 — Graceful Unregister / Drain Pattern

### 19.1 Masalah

Saat service di-unregister, request yang sudah mengambil reference mungkin masih berjalan.

OSGi registry tidak otomatis menghentikan thread kamu. Ia hanya mengubah availability untuk lookup berikutnya.

Jika service melakukan resource close saat `@Deactivate`, request aktif bisa error.

### 19.2 Drainable Service

```java
public interface Drainable {
    void beginDrain();
    boolean isDrained();
}
```

Implementation:

```java
@Component(service = AgencyConnector.class)
public final class DrainableAgencyConnector implements AgencyConnector {

    private final AtomicBoolean accepting = new AtomicBoolean(true);
    private final AtomicInteger inFlight = new AtomicInteger();

    @Override
    public SubmissionResult submit(SubmissionCommand command) {
        if (!accepting.get()) {
            return SubmissionResult.deferred("Connector draining");
        }

        inFlight.incrementAndGet();
        try {
            return doSubmit(command);
        } finally {
            inFlight.decrementAndGet();
        }
    }

    @Deactivate
    void deactivate() {
        accepting.set(false);
        // optionally wait bounded time or close resources after in-flight drains
    }
}
```

### 19.3 Realistic Boundary

Di OSGi, deactivate biasanya harus cepat dan bounded. Jangan block selamanya.

Lebih baik:

- stop accepting new request;
- expose health as draining;
- router avoids draining service;
- wait bounded time;
- close resources safely;
- rely on idempotent retry for unfinished work.

---

## 20. Pattern 16 — Health-Aware Service Routing

### 20.1 Masalah

OSGi registry tahu service ada. Registry tidak tahu service sehat secara domain.

Service bisa registered tapi:

- database down,
- token expired,
- external API rate limited,
- circuit breaker open,
- configuration stale,
- thread pool saturated.

### 20.2 Health as Service Contract

```java
public interface HealthAware {
    HealthStatus health();
}
```

Connector:

```java
public interface AgencyConnector extends HealthAware {
    String agencyCode();
    SubmissionResult submit(SubmissionCommand command);
}
```

Router:

```java
public SubmissionResult submit(SubmissionCommand command) {
    List<ConnectorEntry> candidates = snapshot.findByAgency(command.agencyCode());

    for (ConnectorEntry candidate : candidates) {
        if (candidate.connector().health().acceptingTraffic()) {
            return candidate.connector().submit(command);
        }
    }

    return SubmissionResult.deferred("No healthy connector available");
}
```

### 20.3 Health Tidak Harus Mengubah Service Registration

Jangan unregister service setiap kali health berubah flapping.

Lebih baik:

```text
Service tetap registered.
Health status berubah.
Router memilih eligible service.
Observability tetap melihat service.
```

Unregister cocok untuk lifecycle structural. Health cocok untuk runtime operational state.

---

## 21. Pattern 17 — Command Handler Registry

### 21.1 Masalah

Banyak enterprise system punya command/event handler:

- `SubmitApplicationCommandHandler`,
- `ApproveCaseCommandHandler`,
- `RejectAppealCommandHandler`,
- `GenerateDocumentCommandHandler`.

Jika semuanya di-hardcode, extensibility hilang.

### 21.2 Contract

```java
public interface CommandHandler<C extends Command> {
    String commandType();
    CommandResult handle(C command);
}
```

Karena generic runtime di Java terhapus, jangan bergantung hanya pada generic type untuk routing. Gunakan property eksplisit.

```java
@Component(
    service = CommandHandler.class,
    property = "command.type=case.approve"
)
public final class ApproveCaseCommandHandler implements CommandHandler<ApproveCaseCommand> {
    @Override
    public String commandType() {
        return "case.approve";
    }

    @Override
    public CommandResult handle(ApproveCaseCommand command) {
        return CommandResult.success();
    }
}
```

Registry:

```java
public CommandResult dispatch(Command command) {
    CommandHandler<?> handler = snapshot.find(command.type())
        .orElseThrow(() -> new UnknownCommandException(command.type()));

    return invokeSafely(handler, command);
}
```

### 21.3 Type Safety Boundary

Karena registry memakai raw-ish service interface, validasi type harus eksplisit:

```java
public interface CommandHandler<C extends Command> {
    String commandType();
    Class<C> commandClass();
    CommandResult handle(C command);
}
```

Lalu:

```java
if (!handler.commandClass().isInstance(command)) {
    throw new CommandTypeMismatchException(...);
}
```

Dynamic runtime butuh runtime type guard.

---

## 22. Pattern 18 — Event Handler Whiteboard

OSGi Event Admin sendiri memakai model handler berbasis service. Secara arsitektur, kamu juga bisa membuat event handler whiteboard sendiri jika butuh semantics yang lebih domain-specific.

Contract:

```java
public interface DomainEventHandler<E extends DomainEvent> {
    String eventType();
    HandlerResult handle(E event);
}
```

Provider:

```java
@Component(
    service = DomainEventHandler.class,
    property = {
        "event.type=case.submitted",
        "handler.order:Integer=200"
    }
)
public final class SendCaseSubmittedEmailHandler implements DomainEventHandler<CaseSubmittedEvent> {
    // ...
}
```

Dispatcher:

```text
Event -> find handlers by event.type -> sorted execution -> result policy
```

Design decisions:

| Decision | Options |
|---|---|
| sync/async | same thread, executor, queue |
| error handling | fail event, continue, dead-letter |
| ordering | deterministic, ranking, dependency graph |
| retry | none, bounded, external queue |
| idempotency | required/not required |
| transaction | inside transaction, after commit, outbox |

Jangan menyamakan in-process handler whiteboard dengan durable messaging. Jika event harus survive crash, gunakan outbox/broker.

---

## 23. Pattern 19 — Target Filter Reconfiguration Pattern

DS reference bisa memakai target filter. Dengan Configuration Admin, target filter dapat berubah sesuai config.

Contoh:

```java
@Component(
    service = ReportService.class,
    configurationPid = "com.acme.report"
)
public final class ReportServiceImpl {

    @Reference(target = "(format=pdf)")
    private volatile ReportRenderer renderer;
}
```

Dalam runtime yang lebih advanced, target dapat dikonfigurasi:

```text
renderer.target=(format=pdf)
renderer.target=(&(format=pdf)(agency=CEA))
renderer.target=(&(format=pdf)(version=2))
```

Pattern ini berguna untuk:

- memilih implementation berdasarkan environment;
- agency-specific override;
- feature flag;
- staged rollout;
- rollback ke implementation lama.

Hati-hati:

- target filter terlalu kompleks sulit dioperasikan;
- invalid filter dapat membuat component unsatisfied;
- perubahan filter bisa rebind/deactivate;
- perlu observability terhadap effective target.

Best practice:

```text
Expose current target filter in diagnostics.
Validate config before apply where possible.
Keep default target safe.
Use named profiles instead of raw LDAP filter for admin UI.
```

---

## 24. Pattern 20 — Capability-Gated Extension

Kadang extension seharusnya hanya aktif jika capability tertentu tersedia.

Misalnya:

```text
OCR plugin aktif hanya jika OCR engine tersedia.
Advanced scoring aktif hanya jika ML runtime tersedia.
External submission plugin aktif hanya jika network profile intranet tersedia.
```

Model dengan service capability:

```java
public interface RuntimeCapability {
    String name();
    CapabilityStatus status();
}
```

Capability provider:

```java
@Component(
    service = RuntimeCapability.class,
    property = "capability=ocr"
)
public final class OcrRuntimeCapability implements RuntimeCapability {
    @Override
    public String name() {
        return "ocr";
    }

    @Override
    public CapabilityStatus status() {
        return CapabilityStatus.available();
    }
}
```

Extension:

```java
@Component(service = DocumentProcessor.class)
public final class OcrDocumentProcessor implements DocumentProcessor {

    @Reference(target = "(capability=ocr)")
    private RuntimeCapability ocrCapability;
}
```

Jika capability service hilang, component menjadi unsatisfied atau deactivate sesuai policy.

Ini membuat runtime topology mengikuti capability yang explicit, bukan hidden environment assumption.

---

## 25. Pattern 21 — Service Facade Over Dynamic Internals

### 25.1 Masalah

Kita tidak ingin semua consumer memahami dynamic topology.

Lebih baik satu facade stabil:

```text
Consumer -> stable facade service -> dynamic plugin/strategy/chain internals
```

Contoh:

```java
public interface CaseValidationService {
    ValidationReport validate(CaseDraft draft);
}
```

Implementation facade menggunakan dynamic rules internally.

Keuntungan:

- consumer punya dependency sederhana;
- dynamic complexity terlokalisasi;
- diagnostics terkonsentrasi;
- contract outward lebih stabil;
- security/authorization/audit dapat dipusatkan.

### 25.2 Facade Boundary

Facade bertanggung jawab terhadap:

- consistent snapshot;
- ordering;
- failure policy;
- metrics;
- audit;
- fallback/degraded behavior;
- exception mapping;
- plugin governance.

Plugin tidak boleh memutuskan policy global sendiri.

---

## 26. Pattern 22 — Separate API Bundle, Provider Bundle, Aggregator Bundle

Advanced DS topology lebih bersih jika packaging mengikuti peran.

```text
com.acme.validation.api
  - interfaces
  - DTOs
  - annotations
  - versioned package

com.acme.validation.engine
  - facade
  - registry
  - orchestration

com.acme.validation.rules.basic
  - built-in rule providers

com.acme.validation.rules.agency-cea
  - agency-specific plugins
```

Jangan campur API, engine, dan plugin provider dalam satu bundle jika extension point perlu evolusi.

Boundary:

| Bundle | Export? | Isi |
|---|---|---|
| API | yes | contract stable |
| Engine | usually no or small management API | registry/facade/orchestration |
| Plugin | no | implementations |
| Diagnostics | maybe yes | admin model |

---

## 27. Pattern 23 — Dynamic Service With State: Be Very Careful

Service dynamic yang stateless relatif aman. Service dynamic yang stateful jauh lebih sulit.

Contoh stateful:

- cache service;
- session registry;
- in-flight workflow engine;
- scheduler;
- connector with connection pool;
- transaction manager;
- persistence context;
- stream processor.

Pertanyaan wajib:

1. Apa yang terjadi jika service diganti saat request berjalan?
2. Apakah state bisa dipindah?
3. Apakah old service boleh tetap dipakai sampai drain?
4. Apakah new service melihat state yang sama?
5. Apakah ada persistent state version?
6. Apakah rollback aman?
7. Apakah duplicate service menyebabkan double processing?

Jika jawabannya tidak jelas, jangan buat service tersebut freely dynamic.

Gunakan:

- singleton stable facade;
- explicit lifecycle controller;
- start/stop admin command;
- immutable deployment rollout;
- external durable state;
- drain protocol.

---

## 28. Pattern 24 — Avoid Half-Initialized Service Exposure

### 28.1 Masalah

Service yang dipublish sebelum siap akan membuat consumer gagal.

Dengan DS, service biasanya registered setelah activation sukses. Tetapi kamu masih bisa membuat bug jika:

- activation memulai async init lalu langsung return;
- service method dipanggil sebelum warm-up selesai;
- config belum tervalidasi penuh;
- external connection belum siap;
- cache belum loaded.

### 28.2 Solusi

Pilihan 1: activation synchronous bounded.

```java
@Activate
void activate(Config config) {
    validate(config);
    client = createClient(config);
    client.ping(); // bounded timeout
}
```

Pilihan 2: service exposes readiness state.

```java
public Result execute(Command command) {
    if (!ready.get()) {
        return Result.deferred("Service warming up");
    }
    return doExecute(command);
}
```

Pilihan 3: publish separate capability only after ready.

```text
Component active != capability available
```

Best practice untuk critical service:

```text
Do not publish service that claims capability before capability is true.
```

---

## 29. Pattern 25 — Avoid Circular Service Topology

### 29.1 Bentuk Circular

```text
A requires B
B requires C
C requires A
```

Atau lebih halus:

```text
ValidationEngine uses AuditService
AuditService uses MetadataService
MetadataService uses ValidationEngine
```

Dengan DS static mandatory references, circular dependency bisa membuat component unsatisfied. Dengan dynamic optional references, circular dependency bisa menjadi runtime bug.

### 29.2 Cara Memecah

1. Extract shared lower-level service.
2. Ubah direct call menjadi event after commit.
3. Buat facade di satu arah saja.
4. Gunakan optional callback dengan degraded behavior.
5. Pisahkan command dari query.
6. Gunakan domain event, bukan service call balik.

Contoh refactor:

```text
Before:
ValidationEngine -> AuditService -> ValidationEngine

After:
ValidationEngine -> AuditPublisher
AuditEventHandler -> AuditStore
```

Atau:

```text
ValidationEngine -> RuleMetadataRegistry
AuditService -> RuleMetadataRegistry
```

Shared dependency tidak memanggil balik consumer.

---

## 30. Pattern 26 — Configuration-Driven Service Topology

Service topology sering dikendalikan config:

- enable/disable plugin;
- select implementation;
- choose agency connector;
- set ordering;
- set threshold;
- set routing profile.

Jangan membuat config langsung tersebar ke semua provider tanpa governance.

Lebih baik:

```text
Config Admin -> Policy/Registry component -> effective topology snapshot -> facade execution
```

Contoh:

```java
@Component(
    service = RuleExecutionPolicy.class,
    configurationPid = "com.acme.rules.policy"
)
public final class ConfigurableRuleExecutionPolicy implements RuleExecutionPolicy {

    private volatile Set<String> disabledRules = Set.of();

    @Activate
    @Modified
    void configure(Config config) {
        this.disabledRules = Set.copyOf(Arrays.asList(config.disabledRuleIds()));
    }

    @Override
    public boolean isEnabled(RuleDescriptor descriptor) {
        return !disabledRules.contains(descriptor.id());
    }
}
```

Registry applies policy:

```java
entry.status(policy.isEnabled(entry.descriptor()) ? ACTIVE : DISABLED)
```

Benefit:

- effective topology observable;
- config impact centralized;
- audit easier;
- rollback easier;
- policy testable.

---

## 31. Pattern 27 — Multi-Tenant / Multi-Agency Service Selection

Dalam enterprise/regulatory system, service berlaku berbeda per tenant/agency/module.

Service property:

```text
agency=CEA
module=licensing
case.type=disciplinary
```

Router:

```java
List<RuleEntry> applicable = snapshot.entries().stream()
    .filter(entry -> entry.agencies().contains(context.agency()))
    .filter(entry -> entry.modules().contains(context.module()))
    .filter(entry -> entry.caseTypes().contains(context.caseType()))
    .toList();
```

### 31.1 Specificity Ranking

Jika ada generic dan specific provider:

```text
generic renderer: document.type=NOTICE
agency renderer: document.type=NOTICE, agency=CEA
```

Pemilihan harus explicit:

```text
1. exact agency match
2. exact module match
3. exact document type match
4. highest service ranking
5. deterministic service id
```

Jangan berharap `service.ranking` saja cukup.

### 31.2 Tenant Isolation

Jika plugin tenant-specific, pastikan:

- plugin tidak menerima request tenant lain;
- plugin metadata tervalidasi;
- registry lookup selalu membawa tenant context;
- default fallback tidak melanggar policy tenant;
- audit mencatat plugin id dan version yang dipakai.

---

## 32. Pattern 28 — Versioned Service Contract Pattern

Kadang service contract perlu major version baru.

Pilihan:

### 32.1 Package Major Version

```text
com.acme.rules.api;version=1.0.0
com.acme.rules.api;version=2.0.0
```

Biasanya package name sama, version berbeda di OSGi metadata. Tetapi dalam source repository, ini bisa sulit jika dua major harus coexist.

### 32.2 Type Name Versioning

```java
public interface RulePluginV1 { ... }
public interface RulePluginV2 { ... }
```

Lebih eksplisit, tetapi API surface bertambah.

### 32.3 Adapter Bridge

```text
V1 plugin -> adapter -> V2 facade
```

Contoh:

```java
@Component(service = RulePluginV2.class)
public final class RulePluginV1Adapter implements RulePluginV2 {
    private final RulePluginV1 delegate;

    public RulePluginV1Adapter(RulePluginV1 delegate) {
        this.delegate = delegate;
    }
}
```

Dalam DS, bridge bisa dibuat sebagai whiteboard adapter yang track V1 services dan publish V2 wrappers. Ini advanced extender-like pattern.

---

## 33. Pattern 29 — Bridge Service Pattern

Bridge service menghubungkan dua model service.

Contoh:

```text
OSGi RulePlugin service -> internal workflow engine extension
Spring bean -> OSGi service
JDK ServiceLoader provider -> OSGi service
External plugin manifest -> OSGi service
```

Bridge harus punya ownership jelas:

```text
Siapa membuat object?
Siapa menghancurkan object?
Siapa memegang lifecycle?
Siapa menerjemahkan exception?
Siapa memvalidasi compatibility?
```

Bridge anti-pattern:

```text
Object dibuat Spring, didaftarkan OSGi, dihancurkan manual, config dari dua tempat, lifecycle tidak jelas.
```

Bridge sehat:

```text
Satu owner lifecycle.
Satu contract publik.
Explicit adapter boundary.
Diagnostics tersedia.
```

---

## 34. Pattern 30 — Runtime Topology Diagnostics Pattern

Advanced topology wajib observable.

Minimal expose diagnostics:

- service id;
- bundle symbolic name;
- bundle version;
- component name;
- plugin id;
- plugin version;
- service ranking;
- order;
- status eligibility;
- health;
- config PID;
- target filters;
- active snapshot version;
- last bind/unbind time;
- failure count;
- last error.

Contoh diagnostic DTO:

```java
public record RuleDiagnostic(
    String ruleId,
    String ruleVersion,
    String bundleSymbolicName,
    String bundleVersion,
    int order,
    int serviceRanking,
    String status,
    String reason
) {}
```

Facade diagnostic service:

```java
public interface ValidationDiagnostics {
    List<RuleDiagnostic> rules();
    ValidationTopologySnapshot currentTopology();
}
```

Tanpa diagnostics, dynamic runtime menjadi sulit dipercaya.

---

## 35. Reference Policy Choices untuk Advanced Pattern

### 35.1 Static vs Dynamic

| Policy | Makna | Cocok Untuk |
|---|---|---|
| Static | Perubahan reference dapat menyebabkan deactivate/reactivate. | Dependency fundamental, stateful init, simple mandatory service. |
| Dynamic | Reference dapat berubah tanpa deactivate component. | Whiteboard, plugin list, optional strategy, runtime replacement. |

Rule of thumb:

```text
Jika perubahan dependency harus rebuild internal state besar, static lebih aman.
Jika component bisa mengelola snapshot/rebind sendiri, dynamic lebih fleksibel.
```

### 35.2 Reluctant vs Greedy

| Policy option | Makna | Cocok Untuk |
|---|---|---|
| Reluctant | Tetap pakai binding saat ini jika masih valid. | Stability, avoid unnecessary churn. |
| Greedy | Rebind ke kandidat lebih baik/higher-ranked jika muncul. | Override, hot replacement, best provider. |

Rule of thumb:

```text
Default mentally to reluctant for stability.
Use greedy only if replacement semantics benar-benar diinginkan.
```

### 35.3 Mandatory vs Optional

Optional bukan berarti “business control boleh hilang”. Optional hanya berarti component bisa active tanpa reference.

Tanyakan:

```text
Jika service tidak ada, apakah behavior tetap aman?
```

Jika tidak, gunakan:

- mandatory reference;
- degraded service;
- fallback service;
- explicit deferred result;
- readiness false.

---

## 36. Thread Safety dalam Advanced DS

### 36.1 DS Tidak Membuat Object Kamu Thread-Safe

DS mengatur lifecycle dan binding. Ia tidak otomatis membuat method service thread-safe.

Jika service registered, banyak consumer dapat memanggilnya concurrent.

Design contract harus menyatakan:

- thread-safe;
- not thread-safe but per-call instance;
- prototype scope;
- state confined;
- immutable;
- synchronized;
- actor/queue-based.

### 36.2 Safe Field Patterns

Unary dynamic reference:

```java
private volatile SomeService service;
```

Multi dynamic reference:

```java
private volatile List<SomeService> snapshot = List.of();
```

Mutable state protected by lock:

```java
private final Object lock = new Object();
```

Avoid:

```java
private List<SomeService> services = new ArrayList<>(); // unsafe if read concurrently
```

### 36.3 Activation Safe Publication

Fields initialized in `@Activate` then service registered by DS are generally safe if not mutated unsafely later. But if you start background threads, ensure safe publication yourself.

---

## 37. Exception Semantics dalam Dynamic Topology

Advanced DS pattern perlu failure policy.

Contoh chain:

```text
Rule A pass
Rule B throws TimeoutException
Rule C not executed?
```

Harus jelas.

Policy options:

| Policy | Meaning |
|---|---|
| fail-fast | Stop and return failure. |
| fail-open | Continue and mark warning. Dangerous in regulated flows. |
| fail-closed | Stop and block operation. Safer for control checks. |
| accumulate-error | Run all and collect errors. |
| quarantine-provider | Mark provider unhealthy after threshold. |
| retry-provider | Retry bounded. |
| skip-disabled | Skip provider disabled by policy. |

Untuk regulated workflow, default aman biasanya:

```text
Validation/control failure -> fail closed or deferred.
Notification/reporting failure -> retry/defer separately.
Diagnostic plugin failure -> isolate and continue.
```

---

## 38. Audit Semantics: Catat Runtime Topology yang Dipakai

Jika hasil bisnis dipengaruhi plugin dynamic, audit harus mencatat:

- plugin id;
- plugin version;
- bundle version;
- service ranking/order;
- rule result;
- timestamp;
- config profile;
- topology snapshot id.

Contoh:

```json
{
  "operation": "case.transition.check",
  "caseId": "CASE-2026-001",
  "topologySnapshotId": "rules-2026-06-17T14:20:01Z-42",
  "rules": [
    {
      "id": "has-required-documents",
      "version": "1.3.0",
      "bundle": "com.acme.rules.documents",
      "bundleVersion": "1.3.7",
      "result": "PASS"
    },
    {
      "id": "no-open-investigation",
      "version": "2.0.0",
      "bundle": "com.acme.rules.investigation",
      "bundleVersion": "2.0.1",
      "result": "FAIL"
    }
  ]
}
```

Tanpa ini, dynamic plugin architecture sulit dipertanggungjawabkan.

---

## 39. Case Study: Dynamic Enforcement Validation Platform

### 39.1 Requirement

Kita ingin membangun validation platform untuk enforcement lifecycle:

- module berbeda punya rule berbeda;
- rule bisa ditambah sebagai bundle;
- rule punya urutan;
- beberapa rule tenant/agency-specific;
- rule bisa disabled via config;
- rule failure harus audit-ready;
- request aktif harus memakai snapshot rule konsisten;
- rule bermasalah bisa quarantine;
- topology harus observable.

### 39.2 API Bundle

```text
Bundle: com.acme.enforcement.validation.api
Exports:
  com.acme.enforcement.validation.api;version=1.0.0
```

```java
public interface EnforcementValidationRule {
    RuleDescriptor descriptor();
    RuleResult validate(ValidationContext context);
}
```

```java
public record RuleDescriptor(
    String id,
    String version,
    Set<String> modules,
    Set<String> caseTypes,
    int order
) {}
```

```java
public record ValidationContext(
    String caseId,
    String module,
    String caseType,
    Map<String, Object> attributes
) {}
```

```java
public record RuleResult(
    String ruleId,
    boolean passed,
    String message
) {
    public static RuleResult pass(String ruleId) {
        return new RuleResult(ruleId, true, "PASS");
    }

    public static RuleResult fail(String ruleId, String message) {
        return new RuleResult(ruleId, false, message);
    }
}
```

### 39.3 Plugin Bundle

```java
@Component(
    service = EnforcementValidationRule.class,
    property = {
        "rule.id=case.has-required-documents",
        "module=case",
        "case.type=enforcement",
        "rule.order:Integer=100"
    }
)
public final class RequiredDocumentsRule implements EnforcementValidationRule {

    private static final RuleDescriptor DESCRIPTOR = new RuleDescriptor(
        "case.has-required-documents",
        "1.0.0",
        Set.of("case"),
        Set.of("enforcement"),
        100
    );

    @Override
    public RuleDescriptor descriptor() {
        return DESCRIPTOR;
    }

    @Override
    public RuleResult validate(ValidationContext context) {
        boolean hasDocs = Boolean.TRUE.equals(context.attributes().get("hasRequiredDocuments"));
        return hasDocs
            ? RuleResult.pass(DESCRIPTOR.id())
            : RuleResult.fail(DESCRIPTOR.id(), "Required documents are missing");
    }
}
```

### 39.4 Policy Bundle

```java
public interface RuleExecutionPolicy {
    boolean enabled(RuleDescriptor descriptor);
    boolean failClosed(RuleDescriptor descriptor);
}
```

```java
@Component(
    service = RuleExecutionPolicy.class,
    configurationPid = "com.acme.validation.policy"
)
public final class ConfigurableRuleExecutionPolicy implements RuleExecutionPolicy {

    private volatile Set<String> disabledRules = Set.of();
    private volatile Set<String> failOpenRules = Set.of();

    @Activate
    @Modified
    void configure(Config config) {
        this.disabledRules = Set.of(config.disabledRules());
        this.failOpenRules = Set.of(config.failOpenRules());
    }

    @Override
    public boolean enabled(RuleDescriptor descriptor) {
        return !disabledRules.contains(descriptor.id());
    }

    @Override
    public boolean failClosed(RuleDescriptor descriptor) {
        return !failOpenRules.contains(descriptor.id());
    }

    @ObjectClassDefinition(name = "Validation Policy")
    public @interface Config {
        String[] disabledRules() default {};
        String[] failOpenRules() default {};
    }
}
```

### 39.5 Engine Bundle

```java
@Component(service = EnforcementValidationService.class)
public final class EnforcementValidationEngine implements EnforcementValidationService {

    private final Object lock = new Object();
    private final List<RuleEntry> mutableRules = new ArrayList<>();
    private volatile RuleTopologySnapshot snapshot = RuleTopologySnapshot.empty();

    private volatile RuleExecutionPolicy policy;

    @Reference
    void bindPolicy(RuleExecutionPolicy policy) {
        this.policy = policy;
        rebuildSnapshot();
    }

    void unbindPolicy(RuleExecutionPolicy policy) {
        if (this.policy == policy) {
            this.policy = null;
            rebuildSnapshot();
        }
    }

    @Reference(
        service = EnforcementValidationRule.class,
        cardinality = ReferenceCardinality.MULTIPLE,
        policy = ReferencePolicy.DYNAMIC
    )
    void bindRule(EnforcementValidationRule rule, Map<String, Object> props) {
        synchronized (lock) {
            mutableRules.add(RuleEntry.from(rule, props));
            snapshot = buildSnapshot(mutableRules, policy);
        }
    }

    void unbindRule(EnforcementValidationRule rule, Map<String, Object> props) {
        synchronized (lock) {
            mutableRules.removeIf(entry -> entry.rule() == rule);
            snapshot = buildSnapshot(mutableRules, policy);
        }
    }

    @Override
    public ValidationReport validate(ValidationContext context) {
        RuleTopologySnapshot current = snapshot;
        ValidationReport.Builder report = ValidationReport.builder(current.id());

        for (RuleEntry entry : current.applicableTo(context)) {
            try {
                RuleResult result = entry.rule().validate(context);
                report.add(result, entry.diagnostic());

                if (!result.passed()) {
                    report.markFailed();
                }
            } catch (RuntimeException ex) {
                if (entry.failClosed()) {
                    report.addFailure(entry.descriptor().id(), ex);
                    report.markFailed();
                    break;
                } else {
                    report.addWarning(entry.descriptor().id(), ex);
                }
            }
        }

        return report.build();
    }

    private void rebuildSnapshot() {
        synchronized (lock) {
            snapshot = buildSnapshot(mutableRules, policy);
        }
    }
}
```

### 39.6 Topology Snapshot

```java
public record RuleTopologySnapshot(
    String id,
    Instant createdAt,
    List<RuleEntry> entries
) {
    public static RuleTopologySnapshot empty() {
        return new RuleTopologySnapshot("empty", Instant.EPOCH, List.of());
    }

    public List<RuleEntry> applicableTo(ValidationContext context) {
        return entries.stream()
            .filter(RuleEntry::active)
            .filter(entry -> entry.appliesTo(context))
            .toList();
    }
}
```

Snapshot id bisa dibuat dari counter atau timestamp:

```text
validation-topology-42
```

Audit record menyimpan snapshot id.

### 39.7 Invariant Case Study

```text
1. Rule provider bisa datang/pergi saat runtime.
2. Satu validation request memakai satu RuleTopologySnapshot.
3. Rule disabled tidak dieksekusi tetapi tetap terlihat di diagnostics.
4. Rule exception tidak membuat topology corrupt.
5. Fail-open/fail-closed policy explicit.
6. Audit mencatat rule id/version/bundle/snapshot.
7. Duplicate rule id ditangani eksplisit.
8. Ordering deterministic.
```

Ini adalah contoh dynamic topology yang bisa dipertanggungjawabkan.

---

## 40. Anti-Patterns Advanced DS

### 40.1 Mutable Public List

```java
@Reference(cardinality = MULTIPLE, policy = DYNAMIC)
private final List<Rule> rules = new ArrayList<>();
```

Lalu dipakai concurrent. Ini rawan.

### 40.2 Optional Reference Tanpa Degraded Semantics

```java
if (fraudCheck == null) {
    return approved();
}
```

Kontrol bisnis hilang diam-diam.

### 40.3 Greedy Everywhere

Greedy membuat topology churn. Jangan gunakan jika tidak butuh replacement otomatis.

### 40.4 Ranking as Business Logic Dump

Ranking 999999 untuk semua special case membuat routing tidak bisa dipahami.

### 40.5 Service Property Berisi Object Besar

Service property harus metadata kecil, bukan state/config besar.

### 40.6 Plugin Tahu Manager Implementation

Plugin harus depend ke API, bukan ke engine internal.

### 40.7 No Diagnostics

Dynamic runtime tanpa diagnostics = production nightmare.

### 40.8 Circular DS Reference

Circular mandatory reference membuat startup gagal atau behavior nondeterministic.

### 40.9 Background Thread Tidak Dihentikan

Service unregister tidak otomatis menghentikan thread yang kamu buat.

### 40.10 Deactivate Menutup Resource Saat Request Aktif Tanpa Drain

Menyebabkan random failure saat update/uninstall.

---

## 41. Design Checklist Advanced DS

### 41.1 Topology Checklist

- Apakah service topology boleh berubah runtime?
- Perubahan apa yang diizinkan?
- Apakah perubahan otomatis atau admin-controlled?
- Apakah ada snapshot boundary per operation?
- Apakah ordering deterministic?
- Apakah duplicate provider ditangani?
- Apakah stale provider bisa terjadi?
- Apakah health dipisah dari registration?

### 41.2 Contract Checklist

- Apakah interface stabil?
- Apakah DTO immutable?
- Apakah exception semantics jelas?
- Apakah thread-safety dijelaskan?
- Apakah behavior saat dependency hilang jelas?
- Apakah versioning policy jelas?

### 41.3 Reference Checklist

- Apakah cardinality tepat?
- Apakah static/dynamic tepat?
- Apakah reluctant/greedy tepat?
- Apakah unary reference dibaca ke local variable?
- Apakah multi-reference memakai snapshot immutable?
- Apakah target filter observable?

### 41.4 Operational Checklist

- Apakah topology bisa dilihat via command/API?
- Apakah plugin id/version/bundle tercatat?
- Apakah config effective terlihat?
- Apakah health terlihat?
- Apakah last bind/unbind terlihat?
- Apakah quarantine/disabled state terlihat?
- Apakah audit mencatat provider yang dipakai?

### 41.5 Failure Checklist

- Apa yang terjadi jika provider hilang?
- Apa yang terjadi jika provider throw exception?
- Apa yang terjadi jika provider lambat?
- Apa yang terjadi jika provider duplicate?
- Apa yang terjadi jika config invalid?
- Apa yang terjadi jika replacement terjadi saat request aktif?
- Apa yang terjadi jika bundle update sebagian?

---

## 42. Mapping Pattern ke Use Case

| Use case | Pattern utama |
|---|---|
| Banyak validator | Whiteboard + ordered chain + snapshot |
| Banyak renderer dokumen | Strategy + metadata routing |
| External agency connector | Adapter + health-aware routing |
| Rule plugin marketplace | Plugin registry + quarantine |
| Feature optional | Capability-gated extension |
| Runtime override | Dynamic replacement + greedy carefully |
| Safe fallback | Degraded service |
| Command dispatch | Command handler registry |
| Event side effect | Event handler whiteboard |
| Multi-agency behavior | Multi-tenant selection + specificity ranking |
| Critical control checks | Fail-closed policy + audit topology |

---

## 43. Java 8 sampai 25 Considerations

Advanced DS pattern di atas tidak bergantung pada fitur Java terbaru, tetapi implementasinya bisa disesuaikan.

### Java 8

- Gunakan immutable copy manual atau `Collections.unmodifiableList`.
- `record` belum tersedia.
- Hindari terlalu banyak lambda jika target environment lama strict.

### Java 11

- API modern lebih nyaman.
- Masih belum ada record sebagai final feature.
- Banyak OSGi enterprise runtime mulai nyaman di Java 11.

### Java 17

- Record cocok untuk DTO immutable.
- Sealed class bisa membantu result model.
- Strong encapsulation perlu diperhatikan untuk reflection-heavy libraries.

### Java 21

- Virtual thread bisa dipakai di adapter eksternal tertentu, tetapi jangan sembarangan di DS activation.
- Structured concurrency masih perlu kehati-hatian tergantung status API dan target runtime.
- Service method tetap harus jelas blocking/non-blocking.

### Java 25

- Perhatikan library compatibility dan bytecode target.
- Pastikan bnd/tooling/runtime framework mendukung target build.
- Jangan compile bundle ke bytecode 25 jika runtime target masih Java 17/21.

Prinsip compatibility:

```text
DS pattern bersifat runtime architectural.
Java feature selection harus mengikuti deployment matrix.
```

---

## 44. Practical Rules of Thumb

1. Jangan buat semua dynamic hanya karena bisa.
2. Gunakan dynamic untuk extension point, bukan untuk semua dependency.
3. Unary dynamic reference harus dibaca sekali ke local variable per operasi.
4. Multiple dynamic reference hampir selalu perlu immutable snapshot.
5. Whiteboard butuh diagnostics.
6. Plugin contract harus versioned.
7. Service properties harus menjadi metadata contract.
8. Optional dependency harus punya degraded semantics.
9. Greedy harus dipakai dengan replacement semantics yang jelas.
10. Health bukan registration.
11. Quarantine lebih baik daripada unregister untuk plugin bermasalah.
12. Audit topology jika dynamic provider memengaruhi business decision.
13. Circular dependency adalah architecture smell.
14. Activation jangan publish half-ready service.
15. Dynamic topology harus bisa dijelaskan dengan diagram dan invariant.

---

## 45. Latihan Desain

### Latihan 1 — Validation Rule Engine

Desain runtime OSGi untuk rule engine dengan requirement:

- rule bisa ditambah via bundle;
- rule punya order;
- rule bisa disabled via config;
- rule failure ada fail-open/fail-closed;
- audit mencatat rule version;
- request harus memakai snapshot konsisten.

Tentukan:

- API bundle;
- provider bundle;
- engine bundle;
- config policy;
- diagnostics;
- failure policy.

### Latihan 2 — Multi-Agency Connector

Desain service topology untuk connector:

- tiap agency punya connector berbeda;
- connector punya health;
- connector bisa draining;
- connector bisa disabled via config;
- ada mock connector untuk DEV;
- PROD tidak boleh pakai mock.

Tentukan:

- service properties;
- routing logic;
- health model;
- degraded behavior;
- environment guard.

### Latihan 3 — Document Renderer Override

Desain renderer:

- default renderer untuk semua agency;
- agency-specific renderer boleh override;
- renderer version baru bisa canary;
- rollback harus mudah;
- rendering audit harus mencatat renderer id/version.

Tentukan:

- ranking vs specificity;
- target filter;
- config-driven selection;
- diagnostics.

---

## 46. Ringkasan Mental Model

Advanced Declarative Services bukan tentang menulis annotation lebih banyak. Ini tentang mengendalikan runtime topology.

Model yang perlu dipegang:

```text
OSGi registry membuat service discovery dynamic.
Declarative Services membuat binding dynamic lebih aman.
Advanced patterns membuat dynamicity bisa dipakai sebagai architecture tool.
```

Tetapi dynamicity harus selalu dibatasi oleh invariant:

```text
Satu operasi harus melihat dependency model yang konsisten.
Service hilang tidak boleh membuat kontrol bisnis hilang diam-diam.
Provider dynamic harus punya metadata, health, eligibility, diagnostics, dan audit.
```

Jika Part 8 membuat kamu bisa menulis component DS yang benar, Part 9 membuat kamu bisa membangun platform OSGi yang berubah saat runtime tanpa kehilangan determinism.

---

## 47. Apa yang Akan Dibahas di Part 10

Part 10 akan membahas **Configuration Admin dan Metatype** sebagai kontrak runtime configuration:

- PID vs factory PID;
- ManagedService dan ManagedServiceFactory;
- DS typed configuration;
- `@ObjectClassDefinition` dan `@Designate`;
- runtime config update;
- config schema design;
- config validation;
- config migration;
- environment-specific config;
- secrets vs config;
- production config drift;
- config-driven topology;
- failure mode invalid config.

Part 9 banyak memakai config secara konseptual. Part 10 akan membongkar config layer-nya secara detail.

---

## 48. Referensi

- OSGi Compendium Release 8 — Declarative Services Specification: `https://docs.osgi.org/specification/osgi.cmpn/8.0.0/service.component.html`
- OSGi Whitepaper — Listeners Considered Harmful: The Whiteboard Pattern: `https://docs.osgi.org/whitepaper/whiteboard-pattern/`
- OSGi Core Release 8 — Service Layer: `https://docs.osgi.org/specification/osgi.core/8.0.0/framework.service.html`
- bnd/Bndtools documentation: `https://bnd.bndtools.org/` and `https://bndtools.org/`
- Apache Felix SCR / OSGi Declarative Services runtime documentation: `https://felix.apache.org/`
- OSGi enRoute Declarative Services FAQ: `https://enroute.osgi.org/FAQ/300-declarative-services.html`

