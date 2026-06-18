# Part 24 — Testing OSGi Systems: Unit, Bundle, Resolver, Integration, and Runtime Tests

> Series: `learn-java-osgi-dynamic-module-runtime-engineering`  
> File: `24-testing-osgi-systems-unit-bundle-resolver-integration-runtime-tests.md`  
> Target: Java 8 sampai Java 25  
> Level: Advanced / platform engineering / production-grade modular runtime

---

## 0. Tujuan Bagian Ini

Pada aplikasi Java biasa, test sering dibagi menjadi:

1. unit test,
2. integration test,
3. end-to-end test.

Pada OSGi, pembagian itu belum cukup.

OSGi memiliki dimensi tambahan yang tidak selalu terlihat pada aplikasi classpath biasa:

- bundle metadata,
- manifest import/export,
- resolver graph,
- classloader isolation,
- Declarative Services lifecycle,
- dynamic service availability,
- configuration mutation,
- bundle update/refresh,
- service ranking,
- optional dependency,
- start level,
- framework cache,
- classloader leak after unload,
- compatibility across package versions,
- Java runtime compatibility from Java 8 to Java 25.

Karena itu, testing OSGi bukan hanya menjawab:

> “Apakah method ini benar?”

Tetapi juga:

> “Apakah sistem tetap benar ketika runtime berubah?”

Part ini membangun mental model dan praktik testing untuk sistem OSGi yang production-grade.

---

## 1. The Core Problem: OSGi Bugs Often Live Outside Business Logic

Pada sistem Java biasa, banyak bug bisa ditemukan dengan unit test karena dependency graph relatif statis.

Pada OSGi, banyak bug justru muncul di luar business logic:

```text
Business code correct
Manifest wrong
Bundle unresolved
Service unavailable
Component unsatisfied
Class loaded by different bundle
Config invalid
Dynamic service disappears
Refresh unloads provider
Consumer keeps stale reference
Runtime only fails on Java 21
Works in IDE, fails in Karaf
Works in Felix, fails in Equinox
```

Artinya, jika test hanya memanggil class biasa dengan Mockito, sistem bisa terlihat hijau padahal runtime sebenarnya gagal.

Contoh:

```java
class ValidationServiceTest {
    @Test
    void validatesCase() {
        ValidationRule rule = new HighRiskRule();
        ValidationService service = new DefaultValidationService(List.of(rule));

        assertTrue(service.validate(caseFile).isAccepted());
    }
}
```

Test ini valid sebagai unit test, tetapi tidak menjawab:

- apakah bundle rule mengekspor package API dengan versi benar?
- apakah consumer mengimpor package contract yang benar?
- apakah Declarative Services component rule aktif?
- apakah rule muncul sebagai OSGi service?
- apakah service ranking benar?
- apakah component tetap benar saat config berubah?
- apakah rule hilang saat bundle di-update?
- apakah provider dan consumer memakai class identity yang sama?

Di OSGi, unit test adalah necessary, tetapi jauh dari sufficient.

---

## 2. Testing Pyramid for OSGi

Testing pyramid OSGi lebih kaya daripada testing pyramid aplikasi biasa.

```text
                           ┌──────────────────────────────┐
                           │ End-to-End Runtime Test       │
                           │ Full distribution / black box │
                           └───────────────▲──────────────┘
                                           │
                           ┌───────────────┴──────────────┐
                           │ Runtime Integration Test      │
                           │ Real framework + bundles      │
                           └───────────────▲──────────────┘
                                           │
                           ┌───────────────┴──────────────┐
                           │ OSGi Component Test           │
                           │ DS lifecycle + services       │
                           └───────────────▲──────────────┘
                                           │
                           ┌───────────────┴──────────────┐
                           │ Resolver / Manifest Test      │
                           │ Import/export/capabilities    │
                           └───────────────▲──────────────┘
                                           │
                           ┌───────────────┴──────────────┐
                           │ Contract / Compatibility Test │
                           │ API, version, baseline        │
                           └───────────────▲──────────────┘
                                           │
                           ┌───────────────┴──────────────┐
                           │ Pure Unit Test                │
                           │ No OSGi dependency            │
                           └──────────────────────────────┘
```

Setiap level menjawab pertanyaan berbeda.

| Level | Pertanyaan yang Dijawab |
|---|---|
| Pure unit test | Apakah logika lokal benar? |
| Contract test | Apakah API behavior stabil? |
| Manifest test | Apakah metadata bundle benar? |
| Resolver test | Apakah bundle graph bisa diselesaikan? |
| Component test | Apakah DS component aktif dengan dependency/config benar? |
| Runtime integration test | Apakah beberapa bundle bekerja bersama dalam framework nyata? |
| Dynamic runtime test | Apakah sistem benar saat bundle/service/config berubah? |
| Full distribution test | Apakah artefak production benar-benar bisa boot dan operate? |

Top 1% OSGi engineer tidak memilih satu level saja. Mereka sadar bahwa tiap level menangkap kelas bug yang berbeda.

---

## 3. Principle: Keep Domain Logic OSGi-Free When Possible

Testing OSGi yang baik dimulai dari desain kode.

Kesalahan umum:

```java
public class CaseValidationService {
    private final BundleContext bundleContext;

    public CaseValidationService(BundleContext bundleContext) {
        this.bundleContext = bundleContext;
    }

    public ValidationResult validate(CaseFile file) {
        Collection<ServiceReference<ValidationRule>> refs =
            bundleContext.getServiceReferences(ValidationRule.class, null);
        // business logic mixed with service registry lookup
    }
}
```

Masalah:

- domain logic bergantung pada OSGi API,
- unit test menjadi berat,
- service lookup tersebar,
- dynamic lifecycle sulit dikontrol,
- kontrak bisnis tercampur runtime mechanism.

Desain lebih baik:

```java
public interface ValidationRule {
    ValidationResult validate(CaseFile file);
}

public final class CaseValidationEngine {
    private final List<ValidationRule> rules;

    public CaseValidationEngine(List<ValidationRule> rules) {
        this.rules = List.copyOf(rules);
    }

    public ValidationResult validate(CaseFile file) {
        for (ValidationRule rule : rules) {
            ValidationResult result = rule.validate(file);
            if (!result.isAccepted()) {
                return result;
            }
        }
        return ValidationResult.accepted();
    }
}
```

Lalu OSGi component hanya menjadi adapter runtime:

```java
@Component(service = CaseValidationService.class)
public final class OsgiCaseValidationService implements CaseValidationService {

    private volatile List<ValidationRule> rules = List.of();

    @Reference(
        service = ValidationRule.class,
        cardinality = ReferenceCardinality.MULTIPLE,
        policy = ReferencePolicy.DYNAMIC,
        policyOption = ReferencePolicyOption.GREEDY
    )
    void bindRule(ValidationRule rule) {
        var copy = new ArrayList<>(rules);
        copy.add(rule);
        rules = List.copyOf(copy);
    }

    void unbindRule(ValidationRule rule) {
        var copy = new ArrayList<>(rules);
        copy.remove(rule);
        rules = List.copyOf(copy);
    }

    @Override
    public ValidationResult validate(CaseFile file) {
        return new CaseValidationEngine(rules).validate(file);
    }
}
```

Sekarang test bisa dibagi:

- `CaseValidationEngineTest`: pure unit test.
- `OsgiCaseValidationServiceTest`: DS lifecycle test.
- `ValidationRuntimeIntegrationTest`: real framework test.

Prinsip penting:

> Jangan membuat semua test menjadi OSGi test. Buat business core testable tanpa OSGi, lalu test OSGi boundary secara khusus.

---

## 4. Pure Unit Test Layer

Pure unit test tetap sangat penting.

Tujuannya:

- menguji domain rule,
- menguji algorithm,
- menguji validation logic,
- menguji parser,
- menguji mapper,
- menguji state transition,
- menguji error handling lokal,
- menguji deterministic behavior.

Tidak perlu:

- OSGi framework,
- BundleContext,
- ServiceTracker,
- Config Admin,
- SCR runtime,
- Karaf/Felix/Equinox.

Contoh:

```java
class HighRiskTransactionRuleTest {

    @Test
    void rejectsCaseWhenAmountExceedsThreshold() {
        HighRiskTransactionRule rule = new HighRiskTransactionRule(10_000);

        CaseFile file = CaseFile.builder()
            .transactionAmount(15_000)
            .build();

        ValidationResult result = rule.validate(file);

        assertFalse(result.isAccepted());
        assertEquals("HIGH_RISK_AMOUNT", result.reasonCode());
    }
}
```

Pure unit test harus cepat dan banyak.

Namun jangan tertipu: pure unit test tidak membuktikan bundle dapat resolve.

---

## 5. Contract Test Layer

Dalam OSGi, API package adalah kontrak runtime.

Jika sebuah bundle mengekspor package:

```text
com.acme.case.api;version="2.1.0"
```

maka banyak bundle lain mungkin mengimpor package itu.

Perubahan kecil bisa menyebabkan:

- binary incompatibility,
- source incompatibility,
- behavioral incompatibility,
- resolver failure,
- runtime `NoSuchMethodError`,
- semantic mismatch antar provider/consumer.

Contract test memastikan API tidak berubah tanpa sadar.

### 5.1 API Contract Test

Contoh service contract:

```java
public interface EscalationPolicy {
    EscalationDecision evaluate(EscalationContext context);
}
```

Contract test untuk implementasi:

```java
public abstract class EscalationPolicyContractTest {

    protected abstract EscalationPolicy policy();

    @Test
    void mustReturnDecisionForValidContext() {
        EscalationDecision decision = policy().evaluate(validContext());
        assertNotNull(decision);
        assertNotNull(decision.action());
    }

    @Test
    void mustRejectNullContextPredictably() {
        assertThrows(NullPointerException.class, () -> policy().evaluate(null));
    }
}
```

Provider test:

```java
class DefaultEscalationPolicyTest extends EscalationPolicyContractTest {
    @Override
    protected EscalationPolicy policy() {
        return new DefaultEscalationPolicy();
    }
}
```

Jika banyak plugin menyediakan `EscalationPolicy`, semua provider wajib lulus contract test yang sama.

### 5.2 Behavioral Compatibility Test

Binary compatibility belum cukup.

Misalnya API tetap sama:

```java
EscalationDecision evaluate(EscalationContext context);
```

Tetapi behavior berubah:

- dulu null context menghasilkan `IllegalArgumentException`,
- sekarang menghasilkan default decision,
- dulu threshold inclusive,
- sekarang threshold exclusive,
- dulu reason code stabil,
- sekarang berubah.

Untuk platform modular, behavior adalah kontrak.

Gunakan test untuk hal-hal seperti:

- error code,
- null handling,
- ordering,
- idempotency,
- transaction semantics,
- retry semantics,
- event publication semantics,
- config interpretation.

---

## 6. Manifest Test Layer

Bundle manifest adalah kontrak runtime. Jika salah, bundle bisa gagal sebelum business code jalan.

Yang perlu dites:

- `Bundle-SymbolicName` benar,
- `Bundle-Version` benar,
- exported package sesuai policy,
- private package tidak bocor,
- import version range masuk akal,
- tidak ada `DynamicImport-Package` liar,
- tidak ada `Require-Bundle` tanpa alasan kuat,
- `Service-Component` ada jika memakai DS,
- capability/requirement benar,
- execution environment benar,
- no accidental export.

### 6.1 Manifest Inspection Test

Manifest bisa dibaca sebagai resource:

```java
@Test
void manifestShouldExportOnlyApiPackages() throws Exception {
    try (JarFile jar = new JarFile("target/com.acme.case.rules.jar")) {
        Manifest manifest = jar.getManifest();
        Attributes attrs = manifest.getMainAttributes();

        String exports = attrs.getValue("Export-Package");

        assertTrue(exports.contains("com.acme.case.rules.api"));
        assertFalse(exports.contains("com.acme.case.rules.internal"));
    }
}
```

Ini test sederhana, tetapi menangkap kesalahan yang sering mahal di runtime.

### 6.2 bnd Verification

bnd dapat melakukan verifikasi manifest dan bundle metadata.

Hal yang biasanya diverifikasi:

- unresolved imports,
- unused exports,
- versioning issue,
- baseline issue,
- duplicate packages,
- DS descriptor generation,
- metatype generation,
- invalid header syntax.

Prinsip:

> Treat bnd warnings as design feedback, not as noise.

Jika build menghasilkan warning, jangan langsung suppress. Tanyakan:

- apakah boundary salah?
- apakah package harus private?
- apakah dependency terlalu luas?
- apakah import range tidak eksplisit?
- apakah library perlu wrapping?
- apakah API package belum diberi version?

---

## 7. Resolver Test Layer

Resolver test menjawab:

> “Apakah kumpulan bundle ini bisa resolve bersama dengan requirement dan capability yang benar?”

Ini berbeda dari unit test.

Business logic bisa benar, tetapi graph tidak resolve.

Contoh kegagalan:

```text
Unable to resolve com.acme.case.web [42]
  missing requirement osgi.wiring.package=com.acme.case.api; version>=2.0.0
```

Atau:

```text
Uses constraint violation. Unable to resolve resource...
```

### 7.1 Apa yang Harus Diuji Resolver Test

Resolver test harus menangkap:

- missing provider,
- package version mismatch,
- uses constraint violation,
- split package,
- invalid optional dependency assumption,
- missing extender,
- missing execution environment,
- wrong Java version,
- javax/jakarta conflict,
- duplicate API provider,
- provider substitution yang tidak diinginkan.

### 7.2 Resolver Test Mental Model

Resolver test bukan menjalankan aplikasi.

Ia membangun graph:

```text
Bundle A requires package x [1.0,2.0)
Bundle B exports package x 1.5.0
Bundle C exports package y 2.0.0 uses x
Bundle D requires y and x
```

Lalu memastikan graph punya solution yang konsisten.

### 7.3 .bndrun as Test Artifact

Runtime descriptor seperti `.bndrun` dapat dipakai untuk mendefinisikan expected runtime.

Contoh konseptual:

```properties
-runfw: org.apache.felix.framework
-runee: JavaSE-17
-runrequires: \
    osgi.identity;filter:='(osgi.identity=com.acme.case.app)'
```

Resolver akan menghasilkan `-runbundles`.

Test harus memastikan:

- required app identity bisa resolve,
- selected providers sesuai expectation,
- no accidental test-only provider,
- no old API package,
- no duplicate major API line.

### 7.4 Resolver Regression Test

Setiap kali dependency di-upgrade, resolver graph bisa berubah.

Contoh:

```text
Before:
  com.fasterxml.jackson.core 2.15
  com.fasterxml.jackson.databind 2.15

After:
  com.fasterxml.jackson.core 2.17
  com.fasterxml.jackson.databind 2.15

Potential issue:
  uses constraint / binary mismatch / hidden method change
```

Resolver regression test menjaga agar upgrade dependency tidak diam-diam mengubah wiring.

---

## 8. Baseline and Version Compatibility Test

OSGi versioning sangat bergantung pada package version.

Jika API berubah, version harus berubah sesuai semantic rule.

Contoh kesalahan:

```java
// v1.2.0
public interface CaseQueryService {
    CaseDto findById(String id);
}

// Changed but package version remains 1.2.0
public interface CaseQueryService {
    Optional<CaseDto> findById(String id);
}
```

Ini breaking change.

Jika package version tidak naik major, consumer lama bisa resolve tetapi gagal runtime.

Baseline checking harus masuk CI.

### 8.1 Apa yang Dicek Baseline

Baseline biasanya mendeteksi:

- removed class,
- removed method,
- changed method descriptor,
- changed field,
- changed superclass,
- changed interface,
- changed annotation,
- added method to provider interface,
- package version not incremented correctly.

### 8.2 Baseline Policy

Contoh policy:

| Change | Required Version Change |
|---|---|
| implementation-only change | micro |
| add API type without breaking existing consumer | minor |
| add method to consumer-implemented interface | major |
| remove method/type | major |
| change method descriptor | major |
| fix bug without contract change | micro |

### 8.3 Baseline Is Not Enough

Baseline mostly checks binary shape.

Ia tidak tahu:

- semantic meaning berubah,
- error code berubah,
- order berubah,
- timing berubah,
- transaction behavior berubah,
- side effect berubah.

Karena itu baseline harus dipasangkan dengan contract test.

---

## 9. OSGi Component Test Layer

OSGi modern banyak memakai Declarative Services.

Component test menjawab:

> “Apakah component dapat aktif dengan reference dan configuration yang benar?”

Hal yang perlu dites:

- mandatory reference satisfied,
- optional reference absent,
- multiple reference ordering,
- dynamic bind/unbind,
- activation failure,
- deactivation cleanup,
- modified config,
- service properties,
- component scope,
- factory component,
- target filter.

### 9.1 Testing Component Without Full Framework

Untuk beberapa kasus, component bisa dites sebagai POJO.

Contoh:

```java
class OsgiCaseValidationServiceTest {

    @Test
    void usesBoundRules() {
        OsgiCaseValidationService service = new OsgiCaseValidationService();

        service.bindRule(file -> ValidationResult.accepted());

        assertTrue(service.validate(sampleCase()).isAccepted());
    }
}
```

Ini cepat, tetapi tidak membuktikan DS metadata benar.

### 9.2 Testing DS Metadata

DS metadata dihasilkan dalam XML:

```text
OSGI-INF/com.acme.case.OsgiCaseValidationService.xml
```

Test perlu memastikan descriptor ada.

```java
@Test
void dsDescriptorShouldExist() throws Exception {
    try (JarFile jar = new JarFile("target/com.acme.case.validation.jar")) {
        assertNotNull(jar.getEntry("OSGI-INF/com.acme.case.OsgiCaseValidationService.xml"));
    }
}
```

Namun descriptor existence belum cukup.

Perlu test in-framework untuk memastikan SCR benar-benar mengaktifkan component.

### 9.3 Testing With ServiceComponentRuntime

Declarative Services menyediakan introspection melalui `ServiceComponentRuntime`.

Dalam runtime test, kita bisa cek:

- component description tersedia,
- component configuration satisfied,
- unsatisfied references,
- active state.

Pseudo-flow:

```text
Start framework
Install app bundles
Wait for SCR
Find component description
Assert component is satisfied/active
Assert service registered
```

Tujuan bukan hanya “service bisa dipanggil”, tetapi memastikan lifecycle sesuai harapan.

---

## 10. In-Framework Test Layer

In-framework test menjalankan test di dalam OSGi framework nyata.

Ini penting karena:

- classloader isolation nyata,
- resolver nyata,
- service registry nyata,
- DS runtime nyata,
- Config Admin nyata,
- Event Admin nyata,
- bundle lifecycle nyata.

Bndtools documentation menggambarkan OSGi-based testing sebagai test yang memulai framework terkonfigurasi lalu menjalankan JUnit runner di dalam framework. Ini berbeda dari test classpath biasa karena runtime OSGi benar-benar sudah setup sebelum test dieksekusi.

### 10.1 What In-Framework Test Catches

In-framework test menangkap bug seperti:

- `ClassNotFoundException` karena import salah,
- DS component tidak aktif,
- service tidak terdaftar,
- TCCL salah,
- annotation scanner tidak menemukan class,
- config tidak masuk,
- provider package berbeda classloader,
- `uses:=` graph berbeda,
- optional dependency tidak tersedia,
- event handler tidak registered,
- HTTP endpoint tidak muncul.

### 10.2 Test Bundle Pattern

Dalam OSGi, test sendiri bisa dibungkus sebagai bundle.

```text
com.acme.case.validation.test
  imports com.acme.case.api
  imports org.junit.jupiter.api
  imports org.osgi.framework
  requires service CaseValidationService
```

Test bundle ikut resolve di runtime.

Manfaat:

- test berada di classloading environment yang realistis,
- test hanya bisa mengakses package yang memang diexport,
- tidak bisa diam-diam memakai internal class kecuali diexport,
- boundary API diuji secara nyata.

### 10.3 Avoid Test Cheating

Kesalahan umum:

```text
Unit test imports internal package directly from target/classes.
Runtime consumer cannot access that internal package.
Test passes, production fails.
```

Test bundle harus diperlakukan seperti consumer eksternal.

Jika test butuh internal class, mungkin:

- desain boundary salah,
- test terlalu white-box,
- perlu test fragment,
- perlu separate internal test layer,
- perlu expose test-only capability di build test.

---

## 11. Pax Exam Style Integration Test

Pax Exam adalah framework populer untuk in-container OSGi testing. Ide utamanya:

- test mendefinisikan runtime options,
- framework OSGi dijalankan,
- bundles diinstall,
- test dijalankan di container.

Contoh konseptual:

```java
@RunWith(PaxExam.class)
public class CaseValidationIntegrationTest {

    @Inject
    private BundleContext bundleContext;

    @Inject
    private CaseValidationService validationService;

    @Configuration
    public Option[] config() {
        return options(
            frameworkStartLevel(10),
            mavenBundle("org.apache.felix", "org.apache.felix.scr"),
            mavenBundle("com.acme", "case-api"),
            mavenBundle("com.acme", "case-validation")
        );
    }

    @Test
    public void validatesCaseUsingRealServiceRegistry() {
        ValidationResult result = validationService.validate(sampleCase());
        assertTrue(result.isAccepted());
    }
}
```

Catatan:

- contoh ini bergantung pada setup Pax Exam versi/proyek,
- konsepnya lebih penting daripada syntax persis,
- runtime options harus dikontrol ketat,
- jangan membuat Pax Exam test terlalu banyak jika startup mahal.

Pax Exam cocok untuk:

- integration test beberapa bundle,
- test container-specific behavior,
- Karaf/Sling/feature integration,
- regression terhadap runtime assembly.

---

## 12. bnd OSGi Test Style

bnd/Bndtools menyediakan model test OSGi yang sangat natural untuk workspace bnd.

Ciri umum:

- `.bndrun` mendefinisikan runtime,
- framework dipilih,
- bundles di-resolve,
- test dijalankan dalam framework,
- hasil tetap terlihat seperti JUnit test.

Contoh konseptual `.bndrun`:

```properties
-runfw: org.apache.felix.framework
-runee: JavaSE-17
-runrequires: \
    osgi.identity;filter:='(osgi.identity=com.acme.case.validation.test)'
-runproperties: \
    org.osgi.framework.storage.clean=onFirstInit
```

Keunggulan:

- cocok dengan manifest/resolver discipline,
- test runtime eksplisit,
- dependency graph visible,
- mudah membandingkan Java 8/11/17/21/25,
- konsisten dengan bnd baseline dan packaging.

---

## 13. Testing Dynamic Service Behavior

OSGi service bisa datang dan pergi.

Jika test hanya memastikan service ada saat startup, kamu belum menguji sifat dinamis OSGi.

### 13.1 Service Appears Late

Scenario:

```text
Consumer starts first
Provider not installed yet
Later provider appears
Consumer should bind and work
```

Test flow:

```text
Start framework
Install consumer bundle
Assert consumer degraded / unsatisfied / no service
Install provider bundle
Wait for bind
Assert consumer works
```

### 13.2 Service Disappears

Scenario:

```text
Provider active
Consumer uses service
Provider bundle stopped
Consumer should not crash with stale reference
```

Test flow:

```text
Start provider + consumer
Call consumer successfully
Stop provider bundle
Call consumer again
Assert predictable degraded result
```

### 13.3 Service Replaced

Scenario:

```text
Provider A ranking 10
Provider B ranking 100 appears
Consumer with greedy reference should rebind
```

Test flow:

```text
Register provider A
Assert provider A used
Register provider B with higher ranking
Assert provider B used if greedy
Unregister provider B
Assert fallback to provider A
```

### 13.4 Multiple Dynamic References

For multiple references, test:

- add one rule,
- add second rule,
- remove first rule,
- remove all rules,
- reorder via service ranking,
- duplicate service properties,
- invalid service property,
- concurrent bind/unbind while processing.

---

## 14. Testing Configuration Mutation

Configuration Admin membuat component bisa berubah saat runtime.

Test harus mencakup:

- config missing,
- config valid,
- config invalid,
- config updated,
- config deleted,
- factory config added,
- factory config removed,
- partial rollout,
- secret reference missing,
- config schema migration.

### 14.1 Modified Config Test

Example component:

```java
@Component(configurationPid = "com.acme.case.validation")
@Designate(ocd = ValidationConfig.class)
public final class ConfigurableValidationService {

    private volatile int threshold;

    @Activate
    void activate(ValidationConfig config) {
        this.threshold = config.threshold();
    }

    @Modified
    void modified(ValidationConfig config) {
        this.threshold = config.threshold();
    }
}
```

Test flow:

```text
Start framework
Push config threshold=10
Assert service uses 10
Update config threshold=20
Wait for modified
Assert service uses 20
Push invalid config
Assert predictable rejection/deactivation/degraded behavior
```

### 14.2 Config Test Rule

Do not test config only by reading file.

Test actual runtime effect:

```text
Config source changed
Config Admin receives update
DS component modified or restarted
Service behavior changes predictably
```

---

## 15. Testing Bundle Lifecycle

OSGi bundle lifecycle is a state machine.

Test lifecycle-sensitive behavior:

- install,
- resolve,
- start,
- stop,
- update,
- refresh,
- uninstall.

### 15.1 Stop/Start Test

```text
Start bundle
Assert service registered
Stop bundle
Assert service unregistered
Start bundle again
Assert service registered again
Assert no duplicate threads
Assert no duplicate event handlers
```

### 15.2 Update/Refresh Test

Bundle update is risky.

Test:

```text
Install provider v1
Consumer binds provider v1
Update provider to v2
Refresh affected bundles
Assert consumer rebinds correctly
Assert old classloader can be GC'd
Assert no stale service object
```

### 15.3 Uninstall Test

```text
Install plugin bundle
Assert plugin appears
Uninstall plugin bundle
Assert plugin disappears
Assert no plugin data leak
Assert no stale service reference
```

This is extremely important for plugin platforms.

---

## 16. Testing Classloader Boundaries

Classloader bugs are among the hardest OSGi failures.

Test boundaries explicitly.

### 16.1 Internal Package Access Test

A test bundle should not be able to import internal packages.

If it can, your manifest may be exporting too much.

Expected:

```text
com.acme.case.internal should not be exported
```

Test manifest:

```java
assertFalse(exportPackage.contains("com.acme.case.internal"));
```

Test runtime:

```text
Consumer bundle imports only API
Consumer cannot load implementation class
```

### 16.2 Class Identity Test

Class identity is:

```text
Class name + defining classloader
```

Test for dangerous duplicate API:

```text
Provider sees com.acme.case.api.CaseDto from API bundle A
Consumer sees com.acme.case.api.CaseDto from API bundle B
Runtime fails with ClassCastException
```

Resolver test should prevent this, but runtime smoke test helps catch packaging mistakes.

### 16.3 Serialization Boundary Test

If objects cross bundle boundaries via serialization:

- check serialVersionUID,
- check classloader used for deserialization,
- check DTO package version,
- avoid implementation class serialization.

---

## 17. Testing Service Ranking and Selection

Service ranking bugs are subtle.

Example:

```text
Default renderer ranking=0
PDF renderer ranking=100
HTML renderer ranking=50
```

Test:

- highest ranking selected,
- tie-break deterministic enough for your design,
- target filter selects correct provider,
- fallback works when high-ranking provider disappears,
- invalid service property ignored or rejected,
- config can override selection if designed.

Example:

```java
@Test
void highestRankingPolicyShouldBeUsed() {
    registerPolicy("default", 0);
    registerPolicy("strict", 100);

    assertEquals("strict", selectedPolicyName());
}
```

In production-grade systems, avoid relying only on ranking when deterministic named routing is needed. Test that route selection is explicit.

---

## 18. Testing Optional Dependencies

Optional dependencies are dangerous because they create multiple runtime modes.

Manifest:

```text
Import-Package: com.acme.audit.api;resolution:=optional
```

Test both cases:

```text
Audit service absent
  business operation should still work
  no ClassNotFoundException
  no eager class load

Audit service present
  audit integration should work
```

Important:

Optional import does not mean optional class loading is safe.

Bad:

```java
private AuditClient client = new AuditClient();
```

Even if import is optional, eager reference can fail class loading.

Better:

- isolate optional integration,
- use service boundary,
- avoid direct static reference in always-loaded class,
- test absent-provider runtime.

---

## 19. Testing Event Admin and Async Behavior

Event-driven OSGi code needs tests for both behavior and timing.

### 19.1 Event Delivery Test

Test:

- handler registered,
- topic correct,
- properties correct,
- event delivered once,
- handler failure does not kill runtime,
- async delivery eventually happens,
- sync delivery blocks as expected.

### 19.2 Avoid Flaky Async Tests

Bad:

```java
Thread.sleep(1000);
assertTrue(received);
```

Better:

```java
Awaitility.await()
    .atMost(Duration.ofSeconds(5))
    .untilAsserted(() -> assertTrue(received.get()));
```

Or use a latch:

```java
CountDownLatch latch = new CountDownLatch(1);

// handler latch.countDown()

assertTrue(latch.await(5, TimeUnit.SECONDS));
```

### 19.3 Event Schema Test

If event properties are part of contract, test them:

```text
topic = com/acme/case/UPDATED
caseId exists
correlationId exists
schemaVersion exists
occurredAt exists
```

Do not let event schema be undocumented string map chaos.

---

## 20. Testing HTTP Whiteboard / Web Runtime

HTTP tests in OSGi must verify dynamic endpoint lifecycle.

Test:

- servlet registered,
- context selected,
- filter order correct,
- endpoint returns expected response,
- endpoint disappears after bundle stop,
- endpoint changes after config update,
- security filter applied,
- static resources served,
- error handling works.

Example flow:

```text
Start HTTP runtime
Install web bundle
Wait for endpoint /cases
GET /cases/123 -> 200
Stop web bundle
GET /cases/123 -> 404 or unavailable
Restart web bundle
GET /cases/123 -> 200
```

Avoid only testing controller class as POJO. That misses Whiteboard registration, servlet context, filters, classloading, JSON provider, and auth integration.

---

## 21. Testing Persistence in OSGi

Persistence tests need care because JPA/JDBC often rely on classloader assumptions.

Test:

- DataSource service registered,
- JDBC driver discoverable,
- transaction service available,
- EntityManagerFactory created,
- entities discovered,
- repository service registered,
- transaction rollback works,
- bundle stop closes pool,
- update does not leak driver/classloader,
- migration tool runs once,
- multi-tenant config creates correct resources.

Use testcontainers when appropriate for DB integration, but remember:

```text
Docker DB test validates database behavior.
OSGi runtime test validates classloading/lifecycle/service integration.
```

You need both if persistence is central.

---

## 22. Testing Memory Leaks and Classloader Leaks

Dynamic module systems can leak if old bundle classloaders remain reachable.

Common leak sources:

- static singleton,
- ThreadLocal,
- running thread,
- scheduled executor,
- JDBC driver registry,
- MBean registration,
- logging appender,
- service tracker not closed,
- listener not removed,
- cache holding implementation object,
- lambda capturing bundle class,
- TCCL left on pooled thread.

### 22.1 Leak Test Scenario

```text
Install plugin v1
Start plugin
Call plugin
Stop plugin
Uninstall plugin
Force GC / observe weak reference
Assert classloader becomes collectable
```

Pseudo-code:

```java
WeakReference<ClassLoader> ref = installStartStopUninstallPluginAndReturnClassLoaderRef();

for (int i = 0; i < 10 && ref.get() != null; i++) {
    System.gc();
    Thread.sleep(200);
}

assertNull(ref.get(), "Plugin classloader should be collectable");
```

Caution:

- GC-based tests can be flaky,
- use them as diagnostic/regression tests, not as only correctness test,
- combine with thread/MBean/listener checks.

### 22.2 Runtime Leak Checklist

After bundle stop/uninstall, assert:

- no threads named after bundle remain,
- no scheduled tasks remain,
- no MBeans remain,
- no service registrations remain,
- no event handlers remain,
- no JDBC drivers remain,
- no classloader retained by cache,
- no TCCL points to old bundle.

---

## 23. Testing Startup and Shutdown

OSGi systems can fail in startup order.

Test:

- cold start from clean framework storage,
- warm restart using existing cache,
- framework storage corrupted/missing,
- config missing on startup,
- service appears late,
- start levels respected,
- shutdown order releases resources,
- restart does not duplicate state.

### 23.1 Cold Start Test

```text
Delete framework storage
Start distribution
Wait for readiness
Assert all expected bundles active/resolved
Assert all critical components active
Assert health endpoint OK
```

### 23.2 Warm Restart Test

```text
Start runtime
Stop runtime
Start runtime again with same storage
Assert no stale state issue
```

### 23.3 Shutdown Test

```text
Start runtime
Open resources
Stop framework
Assert connections closed
Assert threads stopped
Assert no forced JVM hang
```

Shutdown tests catch issues that unit tests almost never catch.

---

## 24. Java 8 to Java 25 Testing Matrix

Because this series targets Java 8–25, testing must include JDK matrix strategy.

You do not necessarily run every test on every JDK. But you need deliberate coverage.

### 24.1 Suggested Matrix

| Test Type | Java 8 | Java 11 | Java 17 | Java 21 | Java 25 |
|---|---:|---:|---:|---:|---:|
| Unit tests | Yes if supported | Yes | Yes | Yes | Yes |
| Manifest/baseline | Yes | Yes | Yes | Yes | Yes |
| Resolver tests | Yes | Yes | Yes | Yes | Yes |
| In-framework smoke | Yes if supported | Yes | Yes | Yes | Yes |
| Full distribution | Maybe | Maybe | Yes | Yes | Yes |
| Security manager tests | Yes | Legacy only | Deprecated reality | Not relied on | Not applicable |
| Strong encapsulation tests | No | Yes | Yes | Yes | Yes |
| Virtual thread tests | No | No | No | Yes | Yes |

### 24.2 Java Version-Specific Risks

Java 8:

- legacy javax modules still common,
- Security Manager still existed,
- old libraries may pass.

Java 11:

- Java EE modules removed,
- JAXB/JAX-WS/Activation must be explicit dependencies.

Java 17:

- stronger encapsulation behavior,
- many old bytecode libraries break.

Java 21:

- virtual threads available,
- modern baseline for many systems.

Java 25:

- must not rely on Security Manager sandboxing,
- newer classfile version,
- older ASM/Byte Buddy/CGLIB may fail if not updated,
- library compatibility must be verified.

### 24.3 Toolchain Rule

Use `--release` where possible.

Example:

```text
Source compiled for Java 8 should use --release 8
Bundle tested on Java 8 and newer runtimes
Runtime distribution tested on supported production JDKs
```

Do not assume “compiled on Java 25” means “runs on Java 8”.

---

## 25. Testing javax to jakarta Migration in OSGi

The javax/jakarta split is especially dangerous in OSGi because package names are part of the wiring contract.

Test for:

- no accidental mix of `javax.servlet` and `jakarta.servlet`,
- HTTP runtime matches web bundle imports,
- JPA provider matches entity/persistence API,
- validation API matches implementation,
- JAXB/API packages explicit,
- resolver graph contains one coherent API line.

Example resolver failure to prevent:

```text
Web bundle imports jakarta.servlet
HTTP runtime exports javax.servlet
Result: unresolved bundle
```

Example worse failure:

```text
Two adapters bridge javax/jakarta partially
Resolver passes
Runtime behavior inconsistent
```

Testing strategy:

- explicit resolver test for javax line,
- explicit resolver test for jakarta line,
- no mixed runtime unless intentionally bridged,
- contract test for migration adapter,
- black-box endpoint test after migration.

---

## 26. Testing Security-Relevant Behavior

OSGi security testing in Java 8–25 must be realistic.

Do not rely on Security Manager for Java 24/25-era sandboxing.

Test instead:

- plugin admission policy,
- signed bundle verification if used,
- repository trust rules,
- no unauthorized service registration,
- management shell access restricted,
- Config Admin cannot expose secrets,
- audit events emitted,
- sensitive service requires explicit capability/role,
- bundle cannot accidentally import internal sensitive package,
- classpath/container filesystem restricted outside JVM where applicable.

### 26.1 Service Spoofing Test

Scenario:

```text
Malicious/buggy bundle registers high-ranking PaymentApprovalService
Consumer accidentally binds it
```

Test policy:

- consumer uses target filter requiring trusted provider property,
- provider property is set only by platform bundle,
- runtime admission checks plugin metadata,
- service ranking alone is not enough.

### 26.2 Management Surface Test

Test:

- Gogo shell disabled or protected,
- Karaf SSH protected,
- Web Console protected,
- JMX protected,
- debug endpoints disabled in production profile.

---

## 27. Full Distribution Test

A full distribution test verifies the actual production-like artifact.

For Felix custom runtime:

```text
Build distribution zip/image
Start using production launcher
Load config
Wait for readiness
Run smoke tests
Stop cleanly
```

For Karaf:

```text
Build custom distribution
Start Karaf
Verify boot features installed
Run shell command checks
Call HTTP endpoints
Stop cleanly
```

For Equinox/p2:

```text
Build product
Install/update via p2
Start product
Verify application/service registry
Run smoke tests
```

Full distribution tests catch:

- missing runtime bundle,
- wrong start level,
- wrong config location,
- missing feature repository,
- packaging mismatch,
- production launcher issue,
- path issue,
- Java version issue,
- container filesystem issue.

---

## 28. Runtime Readiness Test

Bundle `ACTIVE` is not readiness.

A runtime can have all bundles active but still not ready:

- DS component unsatisfied,
- config missing,
- HTTP endpoint not registered,
- DB connection failing,
- message bridge disconnected,
- plugin repository unavailable,
- migration running,
- cache warming.

Readiness test should check business capability.

Example:

```text
Critical service registered: CaseValidationService
Component active: OsgiCaseValidationService
Config valid: validation PID exists
Persistence ready: CaseRepository health OK
HTTP ready: /health/readiness returns UP
```

Avoid readiness based only on:

```text
all bundles active
```

That is a weak invariant.

---

## 29. Test Data and Runtime State

OSGi systems can have persistent framework state.

Test isolation needs control over:

- framework storage,
- config directory,
- bundle cache,
- repository cache,
- database state,
- service registry state,
- external ports,
- thread pools,
- temporary files.

### 29.1 Clean Framework Storage

For deterministic tests:

```properties
org.osgi.framework.storage.clean=onFirstInit
```

Or delete storage before test.

But also test warm restart because production often reuses storage.

### 29.2 Port Allocation

Avoid fixed ports in parallel CI.

Use:

- random available port,
- test-specific config,
- framework property injection,
- isolated runtime directories.

### 29.3 Config Isolation

Each test should own config.

Do not let previous test leave PID that changes next test.

---

## 30. Waiting and Timeouts in Dynamic Runtime Tests

OSGi operations can be asynchronous:

- DS activation,
- Config Admin update,
- Event Admin delivery,
- HTTP endpoint registration,
- service binding,
- bundle start side effects.

Avoid immediate assertions after mutation.

Bad:

```java
bundle.start();
assertNotNull(getService(MyService.class));
```

Better:

```java
awaitService(MyService.class, Duration.ofSeconds(5));
```

Testing helpers should support:

- wait for service,
- wait for component active,
- wait for component unsatisfied,
- wait for endpoint response,
- wait for event,
- wait for bundle state,
- fail with diagnostic dump.

### 30.1 Diagnostic on Timeout

When waiting fails, output:

- bundle states,
- unresolved bundles,
- services matching interface,
- DS component states,
- unsatisfied references,
- config PIDs,
- framework events,
- recent logs.

A timeout without diagnostics wastes engineering time.

---

## 31. Test Helper Patterns

Good OSGi test suites often build helper libraries.

### 31.1 Service Awaiter

```java
public final class OsgiAwait {

    public static <T> T waitForService(
        BundleContext context,
        Class<T> type,
        Duration timeout
    ) {
        long deadline = System.nanoTime() + timeout.toNanos();

        while (System.nanoTime() < deadline) {
            ServiceReference<T> ref = context.getServiceReference(type);
            if (ref != null) {
                T service = context.getService(ref);
                if (service != null) {
                    return service;
                }
            }
            sleep(50);
        }

        throw new AssertionError("Service not found: " + type.getName());
    }
}
```

In real code, ensure `ungetService` policy is handled correctly.

### 31.2 Bundle State Assertion

```java
public static void assertBundleActive(BundleContext context, String bsn) {
    Bundle bundle = Arrays.stream(context.getBundles())
        .filter(b -> bsn.equals(b.getSymbolicName()))
        .findFirst()
        .orElseThrow(() -> new AssertionError("Bundle not found: " + bsn));

    assertEquals(Bundle.ACTIVE, bundle.getState());
}
```

### 31.3 Diagnostic Dump

```java
public static String dumpBundles(BundleContext context) {
    StringBuilder out = new StringBuilder();
    for (Bundle bundle : context.getBundles()) {
        out.append(bundle.getBundleId())
           .append(" ")
           .append(bundle.getSymbolicName())
           .append(" ")
           .append(bundle.getVersion())
           .append(" state=")
           .append(bundle.getState())
           .append('\n');
    }
    return out.toString();
}
```

Every failed integration test should help you debug the runtime graph.

---

## 32. CI Pipeline for OSGi Systems

A strong OSGi CI pipeline usually has stages like this:

```text
1. Compile
2. Unit test
3. Static analysis
4. Manifest verification
5. Baseline compatibility check
6. Resolver test
7. In-framework component/integration test
8. Package distribution
9. Full distribution smoke test
10. Java version matrix smoke test
11. Security/supply-chain scan
12. Publish repository/distribution
```

### 32.1 Fail Fast Order

Run cheap tests first:

```text
Unit test -> manifest -> baseline -> resolver -> framework tests -> full runtime
```

Do not start Karaf for every tiny unit test.

### 32.2 Artifact Discipline

Test the artifact you ship.

Bad:

```text
Tests use target/classes
Production ships bundle.jar
```

Better:

```text
Build bundle.jar
Inspect bundle.jar
Resolve bundle.jar
Run bundle.jar in framework test
Package distribution using same bundle.jar
Smoke test distribution
```

### 32.3 Dependency Locking

Resolver results can change if dependency versions float.

Use:

- locked dependency versions,
- reproducible repositories,
- checked-in `.bndrun` after resolution if appropriate,
- controlled update PRs,
- resolver diff review.

---

## 33. Testing Plugin Platforms

For plugin platforms, tests must cover platform governance.

Test plugin lifecycle:

```text
Install valid plugin
Plugin appears
Plugin service registered
Plugin config applied
Plugin executes
Plugin emits audit
Plugin update compatible
Plugin uninstall cleans up
```

Test invalid plugin:

```text
Missing required API package
Wrong package version
Missing metadata
Invalid signature
Forbidden dependency
Conflicting service property
Too-high service ranking
Invalid config schema
Long activation time
Thread leak
```

### 33.1 Plugin Certification Test Suite

If external/internal teams build plugins, provide a certification suite:

- contract tests,
- resolver tests,
- performance tests,
- security checks,
- metadata validation,
- lifecycle tests,
- compatibility tests.

A plugin platform without certification becomes a runtime accident waiting to happen.

---

## 34. Testing Migration Scenarios

Migration must be tested as a first-class behavior.

Examples:

- Java 8 to Java 17,
- Java 17 to Java 21/25,
- javax to jakarta,
- Felix to Equinox,
- plain Felix to Karaf,
- Activator to DS,
- Require-Bundle to Import-Package,
- old API v1 to API v2,
- old config schema to new config schema.

Test migration with realistic state:

```text
Start old runtime
Create data/config/plugin state
Stop old runtime
Deploy new runtime
Start new runtime
Verify data/config/plugin behavior
Verify rollback path
```

Do not only test clean install.

Production rarely starts from ideal empty state.

---

## 35. Anti-Patterns in OSGi Testing

### 35.1 Only Unit Testing POJOs

Symptom:

```text
All tests pass, runtime bundle unresolved.
```

Cause:

- no resolver test,
- no manifest verification,
- no framework test.

### 35.2 Testing Against IDE Classpath

Symptom:

```text
Works in Eclipse/IntelliJ, fails in Felix/Karaf.
```

Cause:

- IDE classpath hides manifest errors,
- internal packages accessible in test,
- resource loading differs.

### 35.3 Sleeping Instead of Awaiting

Symptom:

```text
Flaky CI.
```

Cause:

- fixed sleeps,
- async DS/config/event behavior,
- no condition-based wait.

### 35.4 Ignoring bnd Warnings

Symptom:

```text
Random runtime conflict months later.
```

Cause:

- suppressed warnings,
- bad import ranges,
- accidental exports,
- duplicate packages.

### 35.5 No Dynamic Lifecycle Tests

Symptom:

```text
Hot update leaks memory or stale service used.
```

Cause:

- only startup tested,
- no stop/update/uninstall test.

### 35.6 Test Runtime Not Matching Production

Symptom:

```text
Tests pass on Felix, production fails on Karaf/Equinox.
```

Cause:

- different framework,
- different HTTP runtime,
- different config source,
- different start levels,
- different Java version.

### 35.7 Making Every Test a Full Runtime Test

Symptom:

```text
CI very slow, developers stop running tests.
```

Cause:

- poor test pyramid,
- business logic coupled to OSGi,
- no pure unit boundary.

---

## 36. Practical Test Strategy by Module Type

### 36.1 API Bundle

Test:

- package versions,
- baseline,
- contract test source,
- no implementation classes,
- resolver with sample consumer/provider.

### 36.2 Implementation Bundle

Test:

- unit tests,
- DS metadata,
- service registration,
- config handling,
- dynamic references,
- stop/start cleanup.

### 36.3 Web Bundle

Test:

- HTTP Whiteboard registration,
- endpoint behavior,
- filter/security order,
- bundle stop removes endpoint,
- JSON provider compatibility.

### 36.4 Persistence Bundle

Test:

- DataSource binding,
- transaction behavior,
- entity discovery,
- migration,
- resource cleanup.

### 36.5 Plugin Bundle

Test:

- resolver compatibility,
- service contract,
- metadata,
- dynamic install/uninstall,
- config schema,
- security policy.

### 36.6 Distribution

Test:

- boot,
- readiness,
- health,
- management security,
- smoke flow,
- shutdown,
- restart,
- Java version compatibility.

---

## 37. Example: Enforcement Rule Plugin Test Plan

Suppose platform has:

```text
case-api bundle
rule-api bundle
rule-engine bundle
high-risk-rule-plugin bundle
http-api bundle
persistence bundle
```

### 37.1 Unit Tests

- `HighRiskRuleTest`
- `RuleEngineTest`
- `CaseStateTransitionTest`

### 37.2 Contract Tests

- every `RuleProvider` must pass `RuleProviderContractTest`,
- every rule must return stable reason code,
- every rule must be deterministic for same input.

### 37.3 Manifest Tests

- plugin exports no internal package,
- plugin imports `rule-api` `[2.0,3.0)`,
- plugin has DS descriptor,
- plugin declares required capability if needed.

### 37.4 Resolver Tests

- platform + plugin resolves on Java 17,
- platform + plugin resolves on Java 21,
- platform + plugin resolves on Java 25,
- plugin with old API fails predictably,
- plugin with missing dependency fails in certification.

### 37.5 Runtime Tests

- start platform without plugin,
- install plugin dynamically,
- rule appears,
- evaluate case,
- update plugin,
- rule behavior changes according to version,
- uninstall plugin,
- rule disappears,
- no stale reference,
- no classloader leak.

### 37.6 Config Tests

- threshold config changes rule behavior,
- invalid threshold deactivates or rejects config predictably,
- config delete returns to default or disables plugin according to policy.

### 37.7 Security Tests

- unsigned plugin rejected,
- plugin cannot register forbidden high-ranking system service,
- plugin cannot access internal host package,
- management action audited.

---

## 38. Testing Checklist

### 38.1 Before Merge

- [ ] Unit tests pass.
- [ ] Contract tests pass.
- [ ] Manifest verified.
- [ ] No accidental export.
- [ ] No wildcard optional import without reason.
- [ ] No `DynamicImport-Package` unless reviewed.
- [ ] Baseline check pass.
- [ ] Resolver test pass.
- [ ] DS descriptors generated.
- [ ] Config metadata generated.
- [ ] In-framework smoke test pass.

### 38.2 Before Release

- [ ] Full distribution boots from clean storage.
- [ ] Full distribution warm restart works.
- [ ] Critical services active.
- [ ] Critical DS components satisfied.
- [ ] HTTP endpoints available.
- [ ] Config valid.
- [ ] Bundle stop/start tested for changed bundles.
- [ ] Update/refresh impact reviewed.
- [ ] Java version matrix pass.
- [ ] Security management endpoints checked.
- [ ] Rollback path tested.

### 38.3 Before Plugin Admission

- [ ] Plugin resolves against platform.
- [ ] Plugin passes contract tests.
- [ ] Plugin metadata valid.
- [ ] Plugin config schema valid.
- [ ] Plugin lifecycle test pass.
- [ ] Plugin cleanup test pass.
- [ ] Plugin dependency policy pass.
- [ ] Plugin security policy pass.
- [ ] Plugin performance threshold pass.

---

## 39. Key Takeaways

OSGi testing is about testing a living modular runtime, not just code.

The most important points:

1. Pure unit tests remain essential, but they cannot validate OSGi runtime correctness.
2. Manifest and resolver tests catch failures before the framework starts.
3. Baseline and contract tests protect API evolution.
4. In-framework tests validate classloader, service registry, DS lifecycle, config, and event behavior.
5. Dynamic lifecycle tests are mandatory for plugin platforms.
6. Bundle update/refresh/uninstall must be tested if used in production.
7. Full distribution tests must test the artifact you actually ship.
8. Java 8–25 compatibility must be deliberate, not assumed.
9. Avoid relying on `ACTIVE` bundle state as readiness.
10. Good OSGi tests produce diagnostics when they fail.

The top-tier mindset is:

> In OSGi, correctness is not only function output. Correctness includes wiring, lifecycle, class identity, service dynamics, configuration mutation, and runtime evolution.

---

## 40. References

- OSGi Core Release 8 Specification — Framework lifecycle, module layer, service registry.
- OSGi Compendium Release 8 Specification — Declarative Services, Configuration Admin, Event Admin, HTTP Whiteboard, Metatype.
- bnd / Bndtools Documentation — OSGi testing, resolver, `.bndrun`, baseline, manifest generation.
- OPS4J Pax Exam Documentation — In-container OSGi testing model.
- Apache Felix Documentation — Felix Framework, SCR, Gogo, FileInstall, Web Console.
- Eclipse Equinox Documentation — Framework, p2, runtime diagnostics.
- Apache Karaf Documentation — Features, provisioning, runtime operations.
- JUnit 5 Documentation — test structure and extension model.
- OpenJDK documentation — Java 8–25 compatibility, strong encapsulation, Security Manager deprecation/removal context.

---

## 41. Status

```text
Part 24 dari 35 selesai.
Series belum selesai.
```

Part berikutnya:

```text
25-observability-troubleshooting-wiring-service-graphs-memory-leaks-startup-failures.md
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 23 — Fragments, Extension Bundles, Native Code, and Low-Level Runtime Tricks](./23-fragments-extension-bundles-native-code-low-level-runtime-tricks.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 25 — Observability and Troubleshooting: Wiring Graphs, Service Graphs, Memory Leaks, Startup Failures](./25-observability-troubleshooting-wiring-service-graphs-memory-leaks-startup-failures.md)
