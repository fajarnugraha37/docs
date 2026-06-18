# Part 6 — Semantic Versioning in OSGi: Package Versions, Bundle Versions, API Evolution

Series: `learn-java-osgi-dynamic-module-runtime-engineering`  
File: `06-semantic-versioning-package-versions-bundle-versions-api-evolution.md`  
Target Java: 8 hingga 25  
Status: Part 6 dari 35

---

## 0. Tujuan Part Ini

Di Java biasa, versioning sering dianggap sebagai urusan Maven artifact:

```text
com.fasterxml.jackson.core:jackson-databind:2.17.0
org.hibernate.orm:hibernate-core:6.5.0.Final
com.example:case-management-service:1.4.2
```

Dalam OSGi, cara berpikir seperti itu belum cukup.

OSGi tidak hanya bertanya:

> “JAR mana yang ada di classpath?”

OSGi bertanya:

> “Package mana, versi berapa, diekspor oleh bundle mana, diimpor oleh bundle mana, dan apakah seluruh wiring graph masih type-consistent?”

Itulah alasan versioning di OSGi lebih ketat, tetapi juga jauh lebih powerful. OSGi memaksa kita memperlakukan API sebagai kontrak eksplisit, bukan efek samping dari dependency tree.

Tujuan part ini:

1. Memahami perbedaan **bundle version** dan **package version**.
2. Memahami kenapa OSGi menaruh versioning utama pada **package**, bukan hanya artifact.
3. Memahami semantic versioning dari sudut pandang binary compatibility.
4. Mendesain import range dan export version secara aman.
5. Memahami API evolution: perubahan mana yang compatible dan mana yang breaking.
6. Menggunakan baseline checking sebagai quality gate.
7. Menghubungkan versioning dengan service contract, DTO, event schema, config schema, dan Java 8–25 compatibility.

---

## 1. Masalah Dasar: Artifact Version Tidak Sama dengan API Version

Dalam Maven/Gradle umum, dependency biasanya dipikirkan seperti ini:

```xml
<dependency>
  <groupId>com.example</groupId>
  <artifactId>case-api</artifactId>
  <version>1.2.0</version>
</dependency>
```

Namun satu artifact bisa berisi banyak package:

```text
com.example.case.api
com.example.case.spi
com.example.case.dto
com.example.case.internal
com.example.case.validation
com.example.case.events
```

Masalahnya, semua package tersebut belum tentu berevolusi dengan kecepatan yang sama.

Contoh:

```text
Bundle: com.example.case.api-1.8.0.jar

Package exports:
- com.example.case.api        version 2.1.0
- com.example.case.dto        version 1.4.0
- com.example.case.events     version 1.2.0
- com.example.case.validation version 3.0.0
```

Bundle version `1.8.0` menunjukkan versi deployment unit. Tetapi package version menunjukkan versi kontrak API yang benar-benar dikonsumsi bundle lain.

Di OSGi, consumer biasanya tidak tergantung kepada bundle version. Consumer tergantung kepada package version:

```text
Import-Package: com.example.case.api;version="[2.1,3)"
```

Artinya:

> “Saya butuh package `com.example.case.api` minimal versi 2.1, tetapi belum siap untuk major version 3.”

Ini jauh lebih presisi dibanding:

```text
Require-Bundle: com.example.case.api.bundle;bundle-version="[1.8,2)"
```

Karena dependency terhadap bundle mengikat consumer ke keseluruhan bundle, bukan package contract spesifik yang benar-benar digunakan.

---

## 2. Tiga Level Versioning yang Harus Dibedakan

Dalam OSGi, minimal ada tiga level versioning:

| Level | Contoh | Makna |
|---|---|---|
| Artifact/build version | Maven artifact `1.8.0` | Versi file hasil build/release |
| Bundle version | `Bundle-Version: 1.8.0` | Versi deployment/runtime unit |
| Package version | `Export-Package: com.example.case.api;version="2.1.0"` | Versi kontrak API package |

Kesalahan umum adalah menyamakan semuanya.

Misalnya:

```text
Bundle-Version: 1.8.0
Export-Package: com.example.case.api;version="1.8.0"
```

Ini tidak selalu salah, tetapi sering tidak akurat. Bila bundle bertambah fitur internal, bundle version naik. Tetapi jika API package tidak berubah, package version tidak harus naik.

Sebaliknya, jika satu package mengalami breaking change, package version harus naik major, walaupun bundle hanya berubah kecil.

Mental model:

```text
Bundle version = version of the container.
Package version = version of the contract.
Artifact version = version of the distributed file.
```

Di sistem besar, package version lebih penting untuk runtime compatibility.

---

## 3. Kenapa Package Versioning Lebih Kuat daripada Artifact Versioning

Bayangkan ada platform enforcement lifecycle:

```text
Bundle A: enforcement-core-api
  exports:
    com.acme.enforcement.case.api;version=2.3.0
    com.acme.enforcement.escalation.api;version=1.5.0
    com.acme.enforcement.notice.api;version=1.2.0

Bundle B: escalation-plugin-high-risk
  imports:
    com.acme.enforcement.escalation.api;version="[1.5,2)"

Bundle C: notice-renderer-pdf
  imports:
    com.acme.enforcement.notice.api;version="[1.2,2)"
```

Jika `case.api` berubah major dari 2.x ke 3.x, plugin escalation dan notice renderer tidak harus terdampak selama package yang mereka import tetap compatible.

Dengan artifact-level dependency biasa, semua consumer mungkin terlihat tergantung pada artifact `enforcement-core-api`. Dengan OSGi package-level dependency, dampak perubahan bisa dipersempit.

Ini sangat penting untuk:

1. Plugin platform.
2. Long-lived runtime.
3. Produk modular multi-customer.
4. In-place upgrade.
5. Regulated platform dengan backward compatibility kuat.
6. Runtime yang berisi banyak module dari banyak tim.

---

## 4. Semantic Versioning dalam OSGi

OSGi menggunakan format versi:

```text
major.minor.micro.qualifier
```

Contoh:

```text
1.0.0
1.2.3
2.0.0
2.1.0.beta
2.1.0.20260617
```

Makna umum:

| Segment | Makna |
|---|---|
| Major | Breaking change terhadap consumer |
| Minor | Backward-compatible API addition |
| Micro | Bug fix / implementation change tanpa perubahan API contract |
| Qualifier | Build/release metadata, timestamp, milestone, vendor suffix |

Dalam OSGi, semantic versioning lebih ketat karena dipakai resolver.

Contoh:

```text
Export-Package: com.example.case.api;version="2.4.0"
```

Consumer:

```text
Import-Package: com.example.case.api;version="[2.4,3)"
```

Artinya consumer menerima semua versi `2.x` mulai `2.4.0`, tetapi menolak `3.0.0` karena major version dianggap breaking.

---

## 5. Version Range: Syntax dan Makna

OSGi version range umum:

```text
[1.2,2)
```

Makna:

```text
>= 1.2.0 dan < 2.0.0
```

Notasi:

| Range | Makna |
|---|---|
| `[1.2,2)` | include 1.2, exclude 2.0 |
| `[1.2,1.3)` | hanya minor line 1.2.x |
| `[1.2,1.2.1)` | sangat sempit, hanya patch tertentu |
| `[1.2,∞)` | terlalu luas, jarang aman |
| `(1.2,2)` | exclude 1.2.0, include setelahnya sampai sebelum 2 |
| `[1.2,2]` | include 2.0.0, biasanya berbahaya bila major breaking |

Dalam manifest:

```text
Import-Package: com.example.case.api;version="[1.2,2)"
```

Penting: default range tanpa explicit version bisa terlalu longgar.

```text
Import-Package: com.example.case.api
```

Ini dapat berarti consumer menerima versi apa pun yang memenuhi resolusi, tergantung metadata dan tool. Dalam sistem production, ini buruk karena compatibility tidak eksplisit.

---

## 6. Consumer Policy vs Provider Policy

Versioning harus dipikirkan dari dua sisi:

1. **Provider** mengekspor package dengan versi tertentu.
2. **Consumer** mengimpor package dengan range tertentu.

### 6.1 Provider Export Policy

Provider harus menaikkan package version berdasarkan perubahan API:

| Perubahan | Package version |
|---|---|
| Bug fix internal | micro naik |
| Tambah API backward-compatible | minor naik |
| Breaking API | major naik |
| Perubahan internal tanpa contract change | package version bisa tetap atau micro naik |

Contoh:

```text
Export-Package: com.example.enforcement.api;version="1.3.0"
```

Jika menambah method baru ke interface yang sudah dikonsumsi banyak implementer, apakah minor cukup?

Belum tentu.

Menambah method ke interface bisa breaking untuk implementer lama karena class lama tidak mengimplementasikan method baru. Jadi API evolution tidak bisa hanya dilihat dari consumer pemanggil, tetapi juga dari consumer implementer.

### 6.2 Consumer Import Policy

Consumer biasanya memakai range:

```text
[major.minor, nextMajor)
```

Contoh:

```text
Import-Package: com.example.enforcement.api;version="[1.3,2)"
```

Artinya:

> “Saya dibangun terhadap API minimal 1.3 dan kompatibel dengan 1.x berikutnya, tetapi tidak percaya diri terhadap 2.x.”

Untuk provider bundle yang mengimplementasikan API, kadang range lebih sempit:

```text
Import-Package: com.example.enforcement.spi;version="[1.3,1.4)"
```

Karena implementer sering lebih sensitif terhadap perubahan SPI dibanding caller biasa.

---

## 7. API Consumer vs API Implementer: Dua Arah Compatibility

Ini salah satu bagian paling penting.

Satu package API bisa dikonsumsi dengan dua cara:

1. **Caller consumer**: bundle memanggil API.
2. **Implementer consumer**: bundle mengimplementasikan API.

Contoh:

```java
public interface EscalationRule {
    Decision evaluate(CaseContext context);
}
```

Bundle A memanggil:

```java
Decision decision = rule.evaluate(context);
```

Bundle B mengimplementasikan:

```java
public final class HighRiskEscalationRule implements EscalationRule {
    @Override
    public Decision evaluate(CaseContext context) {
        return Decision.escalate();
    }
}
```

Jika API berubah menjadi:

```java
public interface EscalationRule {
    Decision evaluate(CaseContext context);
    RuleMetadata metadata();
}
```

Caller lama mungkin masih bisa berjalan jika tidak memanggil `metadata()`. Tetapi implementer lama akan bermasalah karena interface sekarang membutuhkan method baru.

Maka untuk interface yang diimplementasikan pihak eksternal, menambah abstract method adalah breaking change.

Solusi:

1. Gunakan default method jika target Java 8+ dan semantics aman.
2. Tambahkan sub-interface baru.
3. Gunakan abstract base class dengan default behavior.
4. Gunakan capability/service property untuk feature discovery.
5. Versikan SPI package major.

---

## 8. Binary Compatibility vs Source Compatibility vs Behavioral Compatibility

Versioning OSGi terutama berhubungan dengan binary compatibility, tetapi engineer top-tier harus membedakan tiga jenis compatibility.

### 8.1 Source Compatibility

Kode lama masih bisa dikompilasi ulang terhadap API baru.

Contoh source-compatible:

```java
public interface CaseService {
    Case findById(String id);
}
```

Ditambah overload:

```java
public interface CaseService {
    Case findById(String id);
    Case findById(UUID id);
}
```

Caller lama masih bisa compile.

### 8.2 Binary Compatibility

Class lama yang sudah dikompilasi bisa berjalan dengan API baru tanpa recompilation.

Ini yang paling penting untuk OSGi runtime karena bundle consumer bisa saja tidak di-rebuild saat provider API diganti.

Contoh binary-compatible biasanya:

```java
public class CaseDto {
    public String id;
}
```

Ditambah field:

```java
public class CaseDto {
    public String id;
    public String status;
}
```

Tapi binary compatibility detail Java sangat subtle.

### 8.3 Behavioral Compatibility

Kode lama tetap berjalan secara semantik sama.

Contoh binary-compatible tapi behavior-breaking:

```java
public interface CaseRepository {
    Optional<Case> findById(String id);
}
```

Versi lama:

```text
Returns Optional.empty() if case not found.
```

Versi baru:

```text
Throws CaseAccessDeniedException if user has no permission.
```

Signature tidak berubah, binary compatible, tetapi behavior bisa breaking bagi consumer.

OSGi resolver tidak bisa mendeteksi behavioral break. Itu tanggung jawab design review, test contract, documentation, dan versioning discipline.

---

## 9. Perubahan API: Mana Compatible, Mana Breaking

### 9.1 Class Public Method

Awal:

```java
public class CaseService {
    public Case find(String id) { ... }
}
```

Tambah method:

```java
public class CaseService {
    public Case find(String id) { ... }
    public Case find(UUID id) { ... }
}
```

Biasanya backward-compatible untuk caller.

### 9.2 Interface Method

Awal:

```java
public interface CaseRule {
    Decision evaluate(CaseContext context);
}
```

Tambah abstract method:

```java
public interface CaseRule {
    Decision evaluate(CaseContext context);
    String ruleCode();
}
```

Breaking untuk implementer.

### 9.3 Default Method

```java
public interface CaseRule {
    Decision evaluate(CaseContext context);

    default String ruleCode() {
        return getClass().getName();
    }
}
```

Binary-compatible secara teknis untuk implementer Java 8+. Tetapi tetap harus dinilai secara behavior.

Pertanyaan review:

1. Apakah default behavior benar untuk semua implementer lama?
2. Apakah method baru akan dipanggil oleh framework host?
3. Apakah return value default bisa menimbulkan security/audit bug?
4. Apakah default method memanggil API baru yang tidak ada di runtime lama?

### 9.4 Removing Method

Breaking.

```java
public interface CaseService {
    Case findById(String id);
}
```

Dihapus:

```java
public interface CaseService {
}
```

Consumer lama bisa gagal dengan:

```text
NoSuchMethodError
```

### 9.5 Changing Return Type

Awal:

```java
Case findById(String id);
```

Menjadi:

```java
Optional<Case> findById(String id);
```

Breaking.

### 9.6 Changing Parameter Type

Awal:

```java
Case findById(String id);
```

Menjadi:

```java
Case findById(UUID id);
```

Breaking.

### 9.7 Adding Checked Exception

Awal:

```java
Case findById(String id);
```

Menjadi:

```java
Case findById(String id) throws CaseAccessException;
```

Source-breaking bagi caller yang compile ulang. Binary compatibility bisa subtle, tetapi sebagai API contract ini harus diperlakukan hati-hati.

### 9.8 Adding Runtime Exception

Tidak mengubah signature, tetapi bisa behavior-breaking.

Contoh:

```java
Case findById(String id);
```

Versi baru melempar:

```java
throw new CaseAccessDeniedException(...);
```

Resolver tidak tahu. Contract test harus tahu.

### 9.9 Changing Generic Signature

Awal:

```java
List<Case> findCases();
```

Menjadi:

```java
List<CaseSummary> findCases();
```

Karena type erasure, binary mungkin tidak langsung gagal, tetapi consumer bisa mengalami `ClassCastException` atau semantic bug.

Treat as breaking.

### 9.10 Changing Constant Value

```java
public static final int MAX_RETRY = 3;
```

Menjadi:

```java
public static final int MAX_RETRY = 5;
```

Java compiler bisa inline compile-time constants. Consumer lama mungkin tetap memakai nilai lama sampai recompile.

Dalam API OSGi, hindari public compile-time constants untuk contract yang bisa berubah. Gunakan method:

```java
int maxRetry();
```

atau configuration/service property.

### 9.11 Changing Annotation

Awal:

```java
@Retention(RetentionPolicy.RUNTIME)
public @interface CasePlugin {
    String value();
}
```

Menambah required element:

```java
@Retention(RetentionPolicy.RUNTIME)
public @interface CasePlugin {
    String value();
    String category();
}
```

Ini bisa breaking bagi source consumer. Untuk binary/runtime scanning, annotation default juga perlu hati-hati.

Lebih aman:

```java
String category() default "general";
```

---

## 10. Package Version Increment Rules yang Praktis

Gunakan policy berikut sebagai default.

### 10.1 Micro Increment

Naikkan micro jika:

1. Bug fix implementation.
2. Documentation correction yang tidak mengubah contract.
3. Internal optimization.
4. Logging improvement.
5. Non-public behavior yang tidak seharusnya dikonsumsi.

Contoh:

```text
1.2.0 -> 1.2.1
```

### 10.2 Minor Increment

Naikkan minor jika:

1. Menambah public class baru.
2. Menambah public method pada class final/concrete yang tidak merusak consumer.
3. Menambah overload baru.
4. Menambah optional feature dengan default behavior aman.
5. Menambah enum constant hanya jika consumer dirancang defensive.
6. Menambah annotation element dengan default.

Contoh:

```text
1.2.0 -> 1.3.0
```

### 10.3 Major Increment

Naikkan major jika:

1. Menghapus public class/method/field.
2. Mengubah method signature.
3. Mengubah return type.
4. Mengubah superclass/interface hierarchy yang visible.
5. Menambah abstract method ke interface yang bisa diimplementasikan eksternal.
6. Mengubah semantic contract secara signifikan.
7. Mengubah exception behavior yang consumer wajib tangani.
8. Mengubah serialization shape secara incompatible.
9. Mengubah thread-safety contract.
10. Mengubah nullability contract secara breaking.

Contoh:

```text
1.2.0 -> 2.0.0
```

---

## 11. Enum Evolution: Salah Satu API Trap yang Sering Diremehkan

Awal:

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    APPROVED,
    REJECTED
}
```

Consumer:

```java
switch (status) {
    case DRAFT -> ...;
    case SUBMITTED -> ...;
    case APPROVED -> ...;
    case REJECTED -> ...;
}
```

Provider menambah:

```java
ESCALATED
```

Secara binary, ini bisa dianggap compatible. Namun secara behavior, consumer lama mungkin tidak punya default branch.

Top-tier API design:

```java
switch (status) {
    case DRAFT -> ...;
    case SUBMITTED -> ...;
    case APPROVED -> ...;
    case REJECTED -> ...;
    default -> handleUnknownStatus(status);
}
```

Jika enum adalah bagian dari cross-bundle API, dokumentasikan apakah enum extensible.

Alternatif untuk domain yang sering berubah:

```java
public final class CaseStatus {
    public static final CaseStatus DRAFT = new CaseStatus("DRAFT");
    private final String code;
}
```

Atau gunakan string code dengan registry service.

Trade-off:

| Model | Pro | Kontra |
|---|---|---|
| enum | Type-safe, simple | Sulit dievolusi jika status sering bertambah |
| string code | Flexible | Kurang type-safe |
| value object | Flexible dan lebih terstruktur | Lebih verbose |
| service registry | Dynamic | Lebih kompleks |

---

## 12. DTO Evolution dalam OSGi

DTO sering menjadi boundary antar bundle.

Contoh:

```java
public final class CaseSummaryDto {
    public String id;
    public String status;
    public Instant submittedAt;
}
```

DTO evolution relatif lebih mudah bila:

1. DTO bersifat data carrier.
2. Field baru optional.
3. Consumer defensive terhadap missing/null value.
4. Serialization format versioned.
5. Tidak ada invariant kompleks di constructor.

### 12.1 Tambah Field Optional

```java
public final class CaseSummaryDto {
    public String id;
    public String status;
    public Instant submittedAt;
    public String riskCategory; // optional
}
```

Biasanya minor.

### 12.2 Remove Field

Breaking.

### 12.3 Rename Field

Breaking untuk reflection/serialization consumer.

### 12.4 Change Field Type

Breaking.

```java
public String submittedAt;
```

menjadi:

```java
public Instant submittedAt;
```

### 12.5 DTO dengan Constructor

```java
public record CaseSummaryDto(String id, String status) {}
```

Menambah component pada record:

```java
public record CaseSummaryDto(String id, String status, String riskCategory) {}
```

Ini breaking terhadap constructor signature.

Untuk API yang harus kompatibel lama, record perlu hati-hati.

Java record bagus untuk immutability dan clarity, tetapi tidak selalu ideal untuk API yang harus evolved secara binary-compatible antar bundle.

---

## 13. Interface Evolution Strategies

Karena interface sangat sering menjadi service contract OSGi, kita perlu strategi khusus.

### 13.1 Strategy A: Default Method

```java
public interface RulePlugin {
    Decision evaluate(CaseContext context);

    default RuleMetadata metadata() {
        return RuleMetadata.unknown();
    }
}
```

Cocok jika:

1. Default behavior benar-benar aman.
2. Method baru bukan hard requirement.
3. Runtime Java minimal 8.
4. Tidak ada security/audit consequence dari default.

Tidak cocok jika method baru wajib untuk correctness.

### 13.2 Strategy B: Sub-interface

```java
public interface RulePlugin {
    Decision evaluate(CaseContext context);
}

public interface MetadataAwareRulePlugin extends RulePlugin {
    RuleMetadata metadata();
}
```

Host:

```java
if (plugin instanceof MetadataAwareRulePlugin aware) {
    metadata = aware.metadata();
} else {
    metadata = RuleMetadata.unknown();
}
```

Cocok untuk optional capability.

### 13.3 Strategy C: Capability Service Property

Service registration:

```java
@Component(
    service = RulePlugin.class,
    property = {
        "rule.code=HIGH_RISK",
        "rule.metadata=true"
    }
)
public final class HighRiskRule implements RulePlugin { ... }
```

Host memilih berdasarkan property:

```text
(rule.metadata=true)
```

Cocok untuk runtime selection.

### 13.4 Strategy D: Versioned Interface

```java
public interface RulePluginV1 {
    Decision evaluate(CaseContext context);
}

public interface RulePluginV2 {
    Decision evaluate(CaseContext context);
    RuleMetadata metadata();
}
```

Ini eksplisit, tetapi bisa membuat API penuh duplikasi jika tidak dikontrol.

### 13.5 Strategy E: Request/Response Object

```java
public interface RulePlugin {
    RuleResult evaluate(RuleRequest request);
}
```

Lalu `RuleRequest` berevolusi dengan optional fields.

Ini sering lebih evolvable daripada menambah parameter method.

---

## 14. Service Contract Versioning

OSGi service biasanya didaftarkan berdasarkan interface:

```java
@Component(service = EscalationService.class)
public final class DefaultEscalationService implements EscalationService { ... }
```

Consumer:

```java
@Reference
private EscalationService escalationService;
```

Interface `EscalationService` ada dalam package export:

```text
Export-Package: com.example.escalation.api;version="1.4.0"
```

Service contract version biasanya mengikuti package version.

Namun service juga punya metadata:

```java
@Component(
    service = EscalationService.class,
    property = {
        "contract.version=1.4",
        "engine=default",
        "tenant=global"
    }
)
```

Kapan perlu service property `contract.version`?

1. Jika beberapa implementation dengan contract level berbeda coexist.
2. Jika host perlu memilih implementation berdasarkan feature.
3. Jika service object memakai interface yang sama tapi behavior optional berbeda.
4. Jika migrasi bertahap dari v1 ke v2.

Namun jangan jadikan service property sebagai pengganti package version. Package version tetap penting untuk resolver dan binary compatibility.

---

## 15. Event Schema Versioning

OSGi Event Admin atau in-process event bus sering membawa event property:

```java
Map<String, Object> event = Map.of(
    "caseId", caseId,
    "status", status,
    "changedAt", changedAt
);
```

Topic:

```text
com/example/case/STATUS_CHANGED
```

Masalah: event bukan Java interface langsung. Resolver tidak bisa tahu bahwa schema berubah.

Maka event schema harus di-version.

Strategi:

### 15.1 Topic Versioning

```text
com/example/case/v1/STATUS_CHANGED
com/example/case/v2/STATUS_CHANGED
```

Pro:

- jelas
- consumer bisa subscribe versi tertentu

Kontra:

- topic proliferasi
- bridging perlu dikelola

### 15.2 Event Property Versioning

```java
Map<String, Object> event = Map.of(
    "schema.version", "1.2",
    "caseId", caseId,
    "status", status
);
```

Pro:

- topic stabil
- schema bisa diinspeksi

Kontra:

- consumer harus defensive

### 15.3 Typed Event Object

```java
public final class CaseStatusChangedEvent {
    private final String caseId;
    private final String status;
}
```

Package-nya di-version:

```text
Export-Package: com.example.case.events;version="1.2.0"
```

Pro:

- strong typing
- OSGi resolver bisa membantu

Kontra:

- coupling lebih kuat
- serialization antar boundary lebih rumit

Top-tier approach:

- Untuk in-process strong coupling: typed event object bisa baik.
- Untuk loose/dynamic plugin: event map + schema version lebih fleksibel.
- Untuk event yang keluar proses: gunakan schema registry/JSON schema/Avro/protobuf dengan versioning tersendiri.

---

## 16. Configuration Schema Versioning

OSGi Configuration Admin memakai PID dan key-value properties.

Contoh:

```text
pid = com.example.escalation.engine
max.retry = 3
risk.threshold = 80
```

Jika configuration schema berubah, runtime bisa gagal walaupun bundle resolved.

Contoh perubahan breaking:

```text
risk.threshold = 80
```

menjadi:

```text
risk.threshold.low = 50
risk.threshold.high = 80
```

Component lama dan baru berbeda expectation.

Strategi:

1. Tambahkan `schema.version`.
2. Buat migration function.
3. Support old keys sementara.
4. Fail fast dengan diagnostic jelas.
5. Jangan silently ignore unknown critical key.
6. Jangan activate component dengan config setengah valid.

Contoh typed config:

```java
@ObjectClassDefinition
public @interface EscalationConfig {
    int max_retry() default 3;
    int risk_threshold() default 80;
    String schema_version() default "1.0";
}
```

Jika schema berubah:

```java
@ObjectClassDefinition
public @interface EscalationConfigV2 {
    int low_risk_threshold() default 50;
    int high_risk_threshold() default 80;
    String schema_version() default "2.0";
}
```

Jangan lupa: config compatibility adalah bagian dari runtime compatibility, meskipun bukan bagian dari Java binary API.

---

## 17. Bundle Version: Kapan Naik?

Bundle version tetap penting untuk:

1. Deployment artifact identity.
2. Repository metadata.
3. Provisioning.
4. Rollback.
5. Runtime diagnosis.
6. Karaf features/p2/bnd repository.
7. Support matrix.

Bundle version naik jika bundle artifact berubah.

Contoh:

```text
Bundle-SymbolicName: com.example.escalation.impl
Bundle-Version: 1.8.3
```

Meskipun exported package tidak berubah, bundle version naik karena implementation bug fix.

Package version mungkin tetap:

```text
Export-Package: com.example.escalation.api;version="2.1.0"
```

Jika bundle hanya private implementation:

```text
Private-Package: com.example.escalation.impl
```

Maka package version tidak relevan untuk consumer, tetapi bundle version tetap penting untuk deploy/rollback.

---

## 18. Versioning Private Packages

Private package tidak diekspor:

```text
Private-Package: com.example.escalation.internal
```

Secara normal, consumer tidak bisa import package tersebut. Jadi package version tidak penting untuk runtime compatibility.

Tetapi ada caveat:

1. Test fragment mungkin mengakses private package.
2. Reflection hack bisa mengakses private class.
3. Internal package bisa bocor lewat public API signature.
4. Serialization bisa menyebut internal class name.
5. Log/event payload bisa membawa internal class.

Contoh kebocoran internal:

```java
public interface EscalationService {
    com.example.escalation.internal.InternalDecision evaluate(CaseContext context);
}
```

Ini salah. Internal class menjadi bagian dari public contract.

Rule:

> Jika sebuah type muncul dalam public/protected API exported package, maka type itu bukan internal secara praktis.

---

## 19. Import Range Policies

Tidak ada satu policy yang cocok untuk semua. Tetapi beberapa default bisa digunakan.

### 19.1 Consumer API Import

Untuk consumer biasa:

```text
[1.2,2)
```

Artinya kompatibel dengan major line yang sama.

### 19.2 Provider SPI Import

Untuk implementer SPI:

```text
[1.2,1.3)
```

Karena SPI sering lebih sensitif terhadap minor changes.

### 19.3 Internal Integration Import

Untuk package internal yang seharusnya tidak diekspor, jangan import. Jika harus, berarti boundary salah.

### 19.4 Third-Party Library Import

Untuk third-party library seperti Jackson:

```text
Import-Package: com.fasterxml.jackson.databind;version="[2.15,3)"
```

Tetapi harus disesuaikan dengan actual binary compatibility library tersebut.

Tidak semua library mengikuti semantic versioning seketat OSGi.

### 19.5 Jakarta/Javax Transition

Untuk `javax.*` ke `jakarta.*`, package name berubah. Ini bukan sekadar version change. Ini package identity change.

```text
javax.servlet
jakarta.servlet
```

OSGi resolver menganggap itu package berbeda total.

Maka migration harus didesain sebagai parallel API/migration bridge, bukan version bump biasa.

---

## 20. Version Range Terlalu Luas vs Terlalu Sempit

### 20.1 Terlalu Luas

```text
Import-Package: com.example.case.api;version="[1.0,999)"
```

Masalah:

1. Consumer bisa wired ke breaking version.
2. Error muncul saat runtime call, bukan resolve-time.
3. Deployment terlihat sukses padahal incompatible.
4. Bug bisa non-deterministic tergantung repository candidate.

### 20.2 Terlalu Sempit

```text
Import-Package: com.example.case.api;version="[1.2.3,1.2.4)"
```

Masalah:

1. Patch update tidak bisa dipakai.
2. Runtime terlalu fragile.
3. Operational upgrade sulit.
4. Resolver sering gagal tanpa alasan arsitektural kuat.

### 20.3 Range yang Sehat

Untuk API stabil:

```text
[1.2,2)
```

Untuk SPI sensitif:

```text
[1.2,1.3)
```

Untuk known-broken version exclusion, kadang perlu range lebih spesifik, tetapi dokumentasikan alasannya.

---

## 21. Baseline Checking: Guardrail Wajib untuk OSGi API

Baseline checking membandingkan bundle/API baru dengan versi baseline sebelumnya.

Ia menjawab:

1. Apakah ada perubahan public API?
2. Apakah package version sudah dinaikkan sesuai perubahan?
3. Apakah bundle version sudah sesuai?
4. Apakah ada breaking change yang tidak ditandai major?
5. Apakah ada minor addition yang version-nya belum naik?

Dengan bnd, baseline checking bisa menjadi bagian dari build.

Contoh konseptual:

```text
Previous:
  com.example.case.api version 1.2.0

Current:
  added public method to concrete class
  com.example.case.api still version 1.2.0

Baseline result:
  package version should be 1.3.0
```

Contoh breaking:

```text
Previous:
  public interface CaseService { Case find(String id); }

Current:
  public interface CaseService { Optional<Case> find(String id); }

Package version:
  1.2.0 -> 1.3.0

Baseline result:
  error: breaking change requires major version 2.0.0
```

Baseline checking bukan pengganti design review, karena ia tidak memahami behavioral compatibility. Tetapi ia sangat efektif mencegah API binary break yang tidak disengaja.

---

## 22. Baseline Checking di CI/CD

Quality gate ideal:

```text
compile
  -> unit test
  -> manifest generation
  -> baseline check
  -> resolver test
  -> integration test in OSGi framework
  -> package runtime distribution
```

Baseline rules:

1. Semua exported package wajib punya version.
2. Semua exported API package wajib masuk baseline check.
3. Breaking change tanpa major bump harus fail build.
4. Minor API addition tanpa minor bump harus fail build.
5. Micro-only implementation change boleh pass.
6. Baseline artifact harus immutable.
7. Baseline comparison harus terhadap latest released version, bukan latest branch build.

Dalam team besar, baseline check mengubah API governance dari manual review menjadi automated enforcement.

---

## 23. Versioning dengan bnd: Pola Praktis

Dalam bnd, package version bisa dideklarasikan melalui `package-info.java`.

Contoh:

```java
@org.osgi.annotation.versioning.Version("1.2.0")
package com.example.case.api;
```

File:

```text
src/main/java/com/example/case/api/package-info.java
```

Lalu export:

```text
Export-Package: com.example.case.api
```

bnd dapat membaca version annotation dan memasukkannya ke manifest.

Manifest hasil:

```text
Export-Package: com.example.case.api;version="1.2.0"
```

Keuntungan:

1. Version dekat dengan source package.
2. Review lebih mudah.
3. Baseline lebih akurat.
4. Tidak perlu hardcode semua di manifest manual.

---

## 24. Provider Type vs Consumer Type

OSGi menyediakan annotation versioning seperti:

```java
@ProviderType
@ConsumerType
```

Mental model:

### 24.1 Provider Type

Interface disediakan/diimplementasikan oleh API provider, dipanggil consumer.

Consumer tidak seharusnya mengimplementasikan.

Contoh:

```java
@ProviderType
public interface CaseService {
    Case findById(String id);
}
```

Jika provider menambah method, consumer caller tidak terdampak sebagai implementer karena mereka tidak seharusnya implement interface ini.

### 24.2 Consumer Type

Interface disediakan oleh consumer/plugin, dipanggil provider/framework.

Contoh:

```java
@ConsumerType
public interface EscalationRule {
    Decision evaluate(CaseContext context);
}
```

Consumer/plugin mengimplementasikan interface ini. Menambah method ke interface ini adalah breaking.

Ini sangat penting untuk plugin architecture.

### 24.3 Kenapa Annotation Ini Penting

Tanpa annotation, baseline tool dan reviewer sulit menilai apakah interface addition minor atau major.

Dengan annotation:

```java
@ConsumerType
public interface PluginRule { ... }
```

Menambah abstract method harus dianggap major.

---

## 25. Designing API Packages: Jangan Campur API dan SPI Sembarangan

Buruk:

```text
com.example.enforcement.api
  CaseService
  CaseRepositorySpi
  InternalCaseMapper
  EscalationPlugin
  DefaultCaseService
```

Masalah:

1. API caller dan SPI implementer bercampur.
2. Versioning policy jadi ambigu.
3. Package major sering naik karena SPI berubah.
4. Consumer yang hanya butuh `CaseService` ikut terdampak.

Lebih baik:

```text
com.example.enforcement.case.api
  CaseService
  CaseSummary

com.example.enforcement.case.spi
  CaseRepositoryProvider
  CaseLifecycleHook

com.example.enforcement.case.dto
  CaseSummaryDto

com.example.enforcement.case.internal
  DefaultCaseService
  JdbcCaseRepository
```

Versioning bisa berbeda:

```text
Export-Package:
  com.example.enforcement.case.api;version="2.3.0",
  com.example.enforcement.case.spi;version="1.5.0",
  com.example.enforcement.case.dto;version="1.8.0"
```

Top-tier principle:

> Package is the versioned contract boundary. Design packages by compatibility rhythm.

Artinya package yang sering berubah jangan dicampur dengan package yang harus stabil.

---

## 26. API, SPI, Internal: Boundary Design

Gunakan tiga kategori:

### 26.1 API

Digunakan oleh consumer untuk memanggil platform.

```text
com.example.case.api
```

Stabil, backward-compatible, import range cenderung longgar dalam major line.

### 26.2 SPI

Diimplementasikan oleh plugin/extension.

```text
com.example.case.spi
```

Lebih sensitif, versioning lebih hati-hati, import range implementer bisa lebih sempit.

### 26.3 Internal

Tidak boleh dipakai bundle lain.

```text
com.example.case.internal
```

Tidak diekspor.

Jika perlu testing, gunakan test bundle/fragment dengan sadar, bukan menjadikan internal sebagai public.

---

## 27. Service Object dan DTO Boundary

Service interface sering harus stabil, tetapi return object juga bagian dari contract.

Contoh buruk:

```java
public interface CaseService {
    InternalCaseEntity find(String id);
}
```

`InternalCaseEntity` mungkin JPA entity internal. Ini membocorkan persistence model ke API.

Lebih baik:

```java
public interface CaseService {
    CaseView find(String id);
}
```

Dengan DTO/API model:

```java
public final class CaseView {
    private final String id;
    private final String status;
    private final Instant submittedAt;
}
```

Kenapa penting di OSGi:

1. Entity proxy bisa punya classloader problem.
2. Internal model berubah lebih sering.
3. API package version jadi tidak stabil.
4. Consumer bisa accidentally depend pada implementation package.
5. Bundle refresh bisa menyisakan stale entity/proxy class.

---

## 28. Nullability dan Optional sebagai Versioning Contract

Awal:

```java
Case findById(String id);
```

Contract:

```text
Returns null if not found.
```

Versi baru:

```java
Optional<Case> findById(String id);
```

Ini breaking.

Lebih baik sejak awal:

```java
Optional<Case> findById(String id);
```

Atau dokumentasikan nullability dengan annotation:

```java
@Nullable Case findById(String id);
```

Tetapi annotation package juga harus tersedia dan versioned.

Perubahan nullability contract bisa breaking walaupun signature tidak berubah.

Contoh:

```text
Before: never returns null.
After: may return null.
```

Ini behavior-breaking dan harus diperlakukan serius.

---

## 29. Thread-Safety sebagai Versioned Contract

Service OSGi sering singleton dan dipanggil oleh banyak bundle/thread.

Contract harus menyebut:

1. Apakah service thread-safe?
2. Apakah method reentrant?
3. Apakah object return mutable?
4. Apakah caller boleh cache return object?
5. Apakah callback bisa dipanggil concurrent?

Perubahan thread-safety adalah breaking behavior.

Contoh:

```text
Version 1.2:
  EscalationService is thread-safe.

Version 1.3:
  EscalationService requires external synchronization.
```

Walaupun signature sama, ini breaking. Harus major.

Top-tier API docs selalu menyertakan concurrency contract untuk service interface.

---

## 30. Exception Model sebagai Contract

Buruk:

```java
public interface CaseService {
    Case submit(CaseDraft draft);
}
```

Tidak jelas apakah bisa throw:

```text
IllegalArgumentException
CaseValidationException
CaseAccessDeniedException
OptimisticLockException
RuntimeException
```

Lebih baik:

```java
public interface CaseService {
    SubmitResult submit(CaseDraft draft) throws CaseValidationException;
}
```

atau result object:

```java
public sealed interface SubmitResult permits SubmitSuccess, SubmitRejected, SubmitConflict { }
```

Namun sealed interface hanya Java 17+, sehingga untuk Java 8 compatibility perlu alternatif.

Untuk Java 8–25 OSGi series, jika API harus support Java 8, hindari sealed type di exported package unless package memang Java 17+ only.

Exception evolution:

| Perubahan | Dampak |
|---|---|
| Tambah runtime exception baru | Bisa behavior-breaking |
| Tambah checked exception | Source-breaking |
| Hapus exception yang documented | Bisa behavior-breaking |
| Ubah error handling dari result ke exception | Breaking |
| Ubah exception package/type | Breaking |

---

## 31. Serialization Compatibility

Jika object API diserialisasi:

1. Java serialization.
2. JSON/XML serialization.
3. Event payload.
4. Cache payload.
5. Persistent snapshot.
6. Remote call.

Maka versioning lebih kompleks.

### 31.1 Java Serialization

```java
private static final long serialVersionUID = 1L;
```

Masalah:

1. Classloader identity tetap penting.
2. Bundle update bisa membuat old serialized object tidak bisa dibaca.
3. Internal class name menjadi persistent contract.
4. Java serialization sendiri sering tidak ideal untuk long-term compatibility.

### 31.2 JSON/XML

Field rename/remove bisa breaking bagi external consumer.

OSGi package version tidak cukup. Schema version perlu dikelola.

### 31.3 DTO Persistence

Jika DTO disimpan di DB/cache, perubahan field/type harus dipikirkan seperti database migration.

Rule:

> Jika API object keluar dari memory boundary, versioning-nya harus dipikirkan sebagai data contract, bukan hanya Java binary contract.

---

## 32. Java 8–25 Impact pada API Evolution

Karena seri ini mencakup Java 8 hingga 25, API design perlu mempertimbangkan feature yang tersedia.

### 32.1 Java 8 Baseline

Bisa menggunakan:

1. Default method.
2. Functional interface.
3. Optional.
4. CompletableFuture.
5. Type annotations.

Tidak bisa menggunakan:

1. Record.
2. Sealed class/interface.
3. Pattern matching.
4. Virtual threads.
5. Sequenced collections.

### 32.2 Java 9+

Ada JPMS, tetapi OSGi bundle tidak otomatis menjadi JPMS module. Strong encapsulation JDK memengaruhi reflective library.

### 32.3 Java 17+

Record dan sealed types stabil. Namun jika exported package harus compatible Java 8, jangan gunakan.

### 32.4 Java 21+

Virtual threads bisa memengaruhi service contract yang blocking. API documentation harus jelas apakah method blocking, cancellable, interruptible.

### 32.5 Java 25

Saat menargetkan Java 25, banyak library lama yang memakai internal JDK API bisa gagal. Package version tidak menyelesaikan masalah ini; perlu execution environment/toolchain compatibility.

Design matrix:

| API Target | Boleh Pakai | Hindari |
|---|---|---|
| Java 8 compatible | default method, Optional | record, sealed, varhandle-specific API |
| Java 11+ | modern HTTP client jika perlu | API yang memaksa Java 17 |
| Java 17+ | record, sealed | jika plugin lama masih Java 8 |
| Java 21/25+ | virtual-thread-friendly contract | assumption thread identity/threadlocal heavy |

---

## 33. Multi-Release JAR dan OSGi Versioning

Multi-release JAR memungkinkan class berbeda per Java version:

```text
META-INF/versions/11/...
META-INF/versions/17/...
```

Dalam OSGi, ini harus sangat hati-hati.

Risiko:

1. API surface berbeda antar Java runtime.
2. Baseline check bisa melihat class versi root saja jika tooling tidak dikonfigurasi benar.
3. Consumer di Java 8 dan Java 17 bisa mengalami behavior berbeda.
4. Manifest import calculation bisa tidak merepresentasikan semua variant.

Guideline:

1. Jangan ubah public API antar release variant.
2. Gunakan multi-release untuk implementation optimization, bukan contract change.
3. Test resolver dan runtime di semua target Java.
4. Dokumentasikan execution environment.
5. Pastikan bnd/tooling memahami multi-release input.

---

## 34. `javax` ke `jakarta`: Versioning Bukan Cukup

Perubahan dari `javax.*` ke `jakarta.*` adalah contoh besar di ekosistem Java.

Contoh:

```text
javax.servlet.Servlet
jakarta.servlet.Servlet
```

Ini bukan:

```text
javax.servlet version 4 -> version 5
```

Ini package name berbeda.

OSGi resolver melihatnya sebagai capability berbeda.

Consumer lama:

```text
Import-Package: javax.servlet;version="[3.1,5)"
```

Provider baru:

```text
Export-Package: jakarta.servlet;version="6.0.0"
```

Tidak akan match.

Migration strategy:

1. Parallel runtime support jika memungkinkan.
2. Adapter bridge.
3. Rebuild consumer terhadap jakarta API.
4. Pisahkan bundles javax dan jakarta.
5. Jangan menganggap version range bisa menyelesaikan rename package.
6. Hindari bundle yang mencampur javax/jakarta tanpa boundary jelas.

---

## 35. `uses:=` dan Versioning

Versioning package tidak berdiri sendiri. `uses:=` constraint memastikan type consistency antar package.

Contoh:

```text
Export-Package: com.example.case.api;version="2.0.0";uses:="com.example.common.api"
```

Artinya package `case.api` expose type dari `common.api`.

Jika consumer import `case.api`, resolver harus memastikan `common.api` yang digunakan konsisten.

Masalah umum:

```text
Bundle A exports common.api 1.0
Bundle B exports common.api 2.0
Bundle C exports case.api uses common.api 2.0
Bundle D imports case.api and common.api 1.0
```

Resolver bisa gagal karena D ingin `common.api` 1.0 tetapi `case.api` yang dipilih menggunakan `common.api` 2.0.

Lesson:

1. Public API type dependencies memperluas compatibility surface.
2. DTO/common package harus sangat stabil.
3. Jangan expose third-party type sembarangan di public API.
4. `uses:=` violation sering tanda API boundary terlalu bocor.

---

## 36. Jangan Mengekspos Third-Party Type Sembarangan

Buruk:

```java
public interface JsonCaseParser {
    com.fasterxml.jackson.databind.JsonNode parse(String json);
}
```

Sekarang API kamu tergantung pada Jackson package version.

Consumer harus wired ke Jackson yang sama secara type-consistent.

Lebih baik:

```java
public interface CaseParser {
    CaseDocument parse(String raw);
}
```

atau:

```java
public interface CaseParser {
    Map<String, Object> parse(String raw);
}
```

Trade-off:

| API exposes third-party type | Pro | Kontra |
|---|---|---|
| Yes | Powerful, less mapping | Coupling, uses constraint, version conflict |
| No | Stable boundary | Mapping overhead, less direct access |

Top-tier rule:

> Exported API should expose domain types, not accidental library types.

Kecuali library type memang sengaja menjadi contract, seperti `org.osgi.framework.BundleContext` dalam OSGi API.

---

## 37. Designing Stable Domain API untuk Plugin Platform

Contoh domain enforcement lifecycle.

### 37.1 Bad API

```java
public interface EscalationRule {
    boolean shouldEscalate(OracleCaseEntity entity, ObjectMapper mapper, HttpServletRequest request);
}
```

Masalah:

1. Expose JPA entity.
2. Expose Jackson.
3. Expose servlet API.
4. Sulit digunakan non-web context.
5. Versioning package jadi tergantung banyak external packages.
6. Testing plugin sulit.

### 37.2 Better API

```java
@ConsumerType
public interface EscalationRule {
    EscalationDecision evaluate(EscalationContext context);
}
```

```java
public interface EscalationContext {
    String caseId();
    String caseType();
    String submittedByAgency();
    Optional<String> riskCategory();
    Map<String, String> attributes();
}
```

```java
public final class EscalationDecision {
    private final boolean escalated;
    private final String reasonCode;
    private final Map<String, String> auditAttributes;
}
```

Package:

```text
com.example.enforcement.escalation.spi;version="1.2.0"
```

Keuntungan:

1. Domain boundary jelas.
2. Tidak expose persistence/web/json library.
3. Bisa versioned secara stabil.
4. Plugin lebih portable.
5. Resolver graph lebih bersih.

---

## 38. Deprecation Policy

Deprecation adalah bagian dari versioning.

Jangan langsung remove API.

Policy sehat:

1. Mark deprecated di minor release.
2. Berikan replacement jelas.
3. Dokumentasikan removal target major version.
4. Tambahkan runtime warning jika aman.
5. Tambahkan migration guide.
6. Jangan reuse nama lama untuk semantic baru.

Contoh:

```java
/**
 * @deprecated since 1.4. Use {@link #findByCaseId(CaseId)} instead.
 * Planned removal in 2.0.
 */
@Deprecated
Case find(String id);

Case findByCaseId(CaseId id);
```

Version:

```text
1.3.0: find(String) exists
1.4.0: find(String) deprecated, findByCaseId(CaseId) added
2.0.0: find(String) removed
```

---

## 39. Multiple Major Versions Coexisting

OSGi bisa menjalankan beberapa versi package/bundle jika wiring memungkinkan.

Contoh:

```text
com.example.case.api 1.0 exported by bundle A
com.example.case.api 2.0 exported by bundle B
```

Consumer lama:

```text
Import-Package: com.example.case.api;version="[1.0,2)"
```

Consumer baru:

```text
Import-Package: com.example.case.api;version="[2.0,3)"
```

Secara teori bisa coexist.

Tetapi hati-hati:

1. Type dari v1 dan v2 berbeda class identity.
2. Service registry bisa membingungkan jika service interface FQCN sama tapi classloader berbeda.
3. Bridge mungkin diperlukan.
4. Event/DTO conversion mungkin diperlukan.
5. Operational debugging lebih kompleks.

Jika major version coexist, buat migration architecture eksplisit:

```text
case-api-v1 consumer -> v1-to-v2 adapter -> case-api-v2 provider
```

Jangan biarkan random wiring menyelesaikan architecture migration.

---

## 40. Service Registry dan Multiple Interface Versions

Masalah:

```text
Bundle OldPlugin imports com.example.rule.spi v1
Bundle NewHost imports com.example.rule.spi v2
```

OldPlugin register service dengan interface class `RulePlugin` v1. NewHost mencari service interface `RulePlugin` v2. Walaupun FQCN sama, class identity berbeda jika package wired ke provider berbeda.

Akibat:

```text
NewHost tidak melihat service OldPlugin sebagai RulePlugin v2.
```

Solusi:

1. Jangan pakai FQCN sama untuk incompatible major yang harus coexist.
2. Gunakan package versioning dan adapter host.
3. Gunakan explicit bridge bundle yang import dua versi jika memungkinkan.
4. Gunakan differently named interface untuk v2 jika coexistence penting.
5. Gunakan service properties untuk migration state.

Coexistence major version bukan gratis.

---

## 41. Versioning Library Wrapper Bundles

Banyak library tidak punya metadata OSGi. Kita bisa wrap:

```text
Bundle-SymbolicName: wrap.com.fasterxml.jackson.databind
Bundle-Version: 2.17.0
Export-Package:
  com.fasterxml.jackson.databind;version="2.17.0",
  com.fasterxml.jackson.core;version="2.17.0"
```

Tapi package version harus mengikuti library package compatibility, bukan asal artifact version.

Masalah:

1. Library mungkin tidak semantic versioning strict.
2. Satu artifact punya banyak packages dengan compatibility berbeda.
3. Shaded dependencies bisa bocor.
4. Optional imports bisa tersembunyi.

Guideline:

1. Prefer existing OSGi-ready bundle jika quality bagus.
2. Jika wrap sendiri, review exported packages.
3. Jangan export private shaded packages.
4. Pin tested version range.
5. Tambahkan resolver tests.
6. Dokumentasikan known incompatible versions.

---

## 42. Shading dan Versioning

Shading sering digunakan untuk menghindari dependency conflict.

Contoh:

```text
com.fasterxml.jackson.databind -> com.example.shadow.jackson.databind
```

Dalam OSGi, shading bisa membantu jika library hanya implementation detail.

Tetapi shading buruk jika:

1. Shaded type bocor ke public API.
2. Dua bundle perlu share object dari library tersebut.
3. Security patch library sulit dikelola.
4. License/SBOM jadi tidak jelas.
5. Resolver tidak bisa melihat real dependency.

Rule:

> Shade only private implementation dependencies, never public contract dependencies.

Jika shaded package muncul di `Export-Package`, itu red flag.

---

## 43. Versioning dan Feature Provisioning

Dalam Karaf/bnd/p2, feature/distribution juga punya version.

Contoh Karaf feature:

```xml
<feature name="case-management" version="3.2.0">
  <bundle>mvn:com.example/case-api/2.1.0</bundle>
  <bundle>mvn:com.example/case-impl/3.2.0</bundle>
</feature>
```

Feature version berarti versi assembly, bukan API package.

Assembly bisa berubah karena:

1. Tambah bundle.
2. Upgrade implementation bundle.
3. Ubah config default.
4. Ubah start level.
5. Ubah dependency provider.

Jadi ada lagi level:

```text
package version < bundle version < feature/distribution version < product version
```

Jangan campur makna.

---

## 44. Versioning dalam Product Line / Multi-Customer Runtime

OSGi sering dipakai untuk product line:

```text
core-platform 5.2
agency-A-extension 2.1
agency-B-extension 3.4
reporting-plugin 1.8
connector-onemap 4.0
connector-legacy 2.7
```

Jika runtime bisa berbeda per customer/agency, versioning harus bisa menjawab:

1. Plugin ini compatible dengan platform versi berapa?
2. API package apa yang dibutuhkan?
3. Service capability apa yang dibutuhkan?
4. Config schema versi berapa?
5. Java runtime minimal berapa?
6. Apakah plugin support hot update?
7. Apakah plugin support rollback?

Manifest bisa membawa:

```text
Import-Package: com.example.platform.api;version="[5.2,6)"
Require-Capability: com.example.platform.feature;filter:="(feature=escalation-v2)"
```

Ini lebih robust daripada cek manual di dokumen.

---

## 45. Versioning dan Runtime Upgrade

Upgrade di OSGi bisa berupa:

1. Install new bundle.
2. Update existing bundle.
3. Refresh packages.
4. Restart bundle.
5. Restart framework.
6. Replace whole distribution.

Versioning memengaruhi semua.

Contoh:

```text
case-api 1.2 -> 1.3 minor
case-impl 1.8 -> 1.9
plugins import [1.2,2)
```

Secara teori plugins masih compatible.

Tetapi runtime upgrade harus memikirkan:

1. Apakah old service object masih direferensikan?
2. Apakah bundle refresh diperlukan?
3. Apakah DS components reactivate?
4. Apakah config schema berubah?
5. Apakah event schema berubah?
6. Apakah long-running task sedang memakai old class?
7. Apakah rollback memungkinkan?

Versioning membantu resolver, tetapi lifecycle upgrade tetap perlu runbook.

---

## 46. Versioning dan Rollback

Rollback bukan hanya install versi lama.

Pertanyaan:

1. Apakah data/config sudah dimigrasi forward?
2. Apakah package major berubah?
3. Apakah consumer sudah re-wired?
4. Apakah old bundle masih bisa resolve?
5. Apakah old service contract masih ada?
6. Apakah event lama masih dipahami?
7. Apakah persisted DTO compatible?

Backward-compatible minor release lebih mudah rollback.

Breaking major release butuh rollback strategy:

```text
v1 runtime -> migration bridge -> v2 runtime
```

atau:

```text
blue/green distribution replacement
```

Bukan hot update sembarangan.

---

## 47. Versioning Checklist untuk API Package

Sebelum export package:

```text
[ ] Apakah package ini benar-benar public contract?
[ ] Apakah ada internal implementation class di package ini?
[ ] Apakah semua public type memang perlu public?
[ ] Apakah third-party type bocor di signature?
[ ] Apakah package punya @Version?
[ ] Apakah interface diberi @ProviderType / @ConsumerType jika relevan?
[ ] Apakah nullability contract jelas?
[ ] Apakah exception contract jelas?
[ ] Apakah thread-safety contract jelas?
[ ] Apakah DTO evolution strategy jelas?
[ ] Apakah enum boleh bertambah?
[ ] Apakah serialization schema perlu versioning?
[ ] Apakah baseline check aktif?
[ ] Apakah import range consumer sudah masuk akal?
[ ] Apakah uses constraint akan stabil?
```

---

## 48. Versioning Checklist untuk Consumer Bundle

Sebelum release consumer:

```text
[ ] Apakah semua Import-Package punya range explicit?
[ ] Apakah range terlalu luas?
[ ] Apakah range terlalu sempit?
[ ] Apakah consumer mengimplementasikan SPI? Jika iya, range perlu lebih hati-hati.
[ ] Apakah consumer bergantung pada behavior yang tidak documented?
[ ] Apakah consumer defensive terhadap enum/field/event baru?
[ ] Apakah consumer menyimpan serialized DTO?
[ ] Apakah consumer cache service object terlalu lama?
[ ] Apakah consumer bisa survive provider minor upgrade?
[ ] Apakah resolver test mencakup dependency candidate yang realistis?
```

---

## 49. Versioning Checklist untuk Provider Bundle

Sebelum release provider:

```text
[ ] Apakah exported package version dinaikkan sesuai API diff?
[ ] Apakah bundle version dinaikkan?
[ ] Apakah baseline check pass?
[ ] Apakah breaking change sengaja dan documented?
[ ] Apakah migration guide tersedia?
[ ] Apakah deprecated API diberi replacement?
[ ] Apakah service properties berubah?
[ ] Apakah config schema berubah?
[ ] Apakah event schema berubah?
[ ] Apakah compatibility dengan old consumer diuji?
[ ] Apakah capability metadata akurat?
[ ] Apakah Java execution environment akurat?
```

---

## 50. Common Failure Modes

### 50.1 Package Version Tidak Naik

API berubah, version tetap.

Akibat:

```text
Consumer lama wired ke API baru yang breaking.
NoSuchMethodError / AbstractMethodError / behavior bug.
```

### 50.2 Import Range Kosong

Consumer menerima provider incompatible.

### 50.3 Major Version Coexistence Tanpa Bridge

Service registry tidak match karena class identity beda.

### 50.4 Third-Party Type Bocor

Upgrade third-party library menjadi platform-wide breaking change.

### 50.5 SPI Dicampur API

Minor API addition berubah menjadi breaking bagi implementer.

### 50.6 Enum Bertambah Tanpa Defensive Consumer

Consumer gagal pada default-less switch.

### 50.7 Config Schema Berubah Diam-Diam

Bundle ACTIVE tapi behavior salah.

### 50.8 Baseline Check Tidak Ada

Versioning bergantung pada ingatan developer.

---

## 51. Case Study: Escalation Rule SPI Evolution

### 51.1 Version 1.0

```java
@ConsumerType
public interface EscalationRule {
    EscalationDecision evaluate(EscalationContext context);
}
```

Package:

```java
@Version("1.0.0")
package com.example.enforcement.escalation.spi;
```

Plugin import:

```text
Import-Package: com.example.enforcement.escalation.spi;version="[1.0,1.1)"
```

Karena plugin mengimplementasikan SPI, range sempit.

### 51.2 Requirement Baru

Host ingin rule expose metadata:

```java
RuleMetadata metadata();
```

Jangan langsung tambah abstract method ke `EscalationRule`, karena breaking.

### 51.3 Compatible Evolution

Tambahkan sub-interface:

```java
public interface MetadataAwareEscalationRule extends EscalationRule {
    RuleMetadata metadata();
}
```

Package version:

```text
1.0.0 -> 1.1.0
```

Host:

```java
if (rule instanceof MetadataAwareEscalationRule aware) {
    metadata = aware.metadata();
} else {
    metadata = RuleMetadata.unknown();
}
```

Old plugin tetap jalan.

### 51.4 Later Major Cleanup

Di version 2.0:

```java
@ConsumerType
public interface EscalationRule {
    RuleMetadata metadata();
    EscalationDecision evaluate(EscalationContext context);
}
```

Package:

```text
2.0.0
```

Migration:

1. Support v1 and v2 during transition.
2. Provide adapter.
3. Mark v1 deprecated.
4. Remove v1 only at major platform release.

---

## 52. Case Study: Package Boundary Salah

Awal:

```text
com.example.case.api
  CaseService
  CaseStatus
  CaseChangedEvent
  CaseRepositoryPlugin
  CaseEntity
```

Masalah:

1. `CaseService`: API caller.
2. `CaseRepositoryPlugin`: SPI implementer.
3. `CaseEntity`: persistence internal.
4. `CaseChangedEvent`: event schema.
5. Semua punya compatibility rhythm berbeda.

Akibat:

- Sedikit perubahan entity memaksa package version naik.
- Plugin implementer terdampak perubahan API caller.
- Event consumer terdampak perubahan service API.

Refactor:

```text
com.example.case.api;version=2.0.0
  CaseService
  CaseView

com.example.case.spi;version=1.0.0
  CaseRepositoryPlugin

com.example.case.events;version=1.3.0
  CaseChangedEvent

com.example.case.internal.persistence
  CaseEntity
```

Hasil:

- API caller lebih stabil.
- SPI bisa berevolusi sendiri.
- Event schema bisa di-version sendiri.
- Internal persistence tidak bocor.

---

## 53. Practical Manifest Example

```text
Bundle-SymbolicName: com.example.enforcement.escalation.api
Bundle-Version: 2.4.1
Bundle-ManifestVersion: 2
Export-Package: \
  com.example.enforcement.escalation.api;version="2.3.0";uses:="com.example.enforcement.common.api",\
  com.example.enforcement.escalation.spi;version="1.5.0";uses:="com.example.enforcement.escalation.api",\
  com.example.enforcement.escalation.dto;version="1.8.0"
Import-Package: \
  com.example.enforcement.common.api;version="[3.1,4)",\
  org.osgi.annotation.versioning;version="[1.1,2)";resolution:=optional
```

Perhatikan:

1. Bundle version `2.4.1` tidak sama dengan semua package version.
2. API, SPI, DTO punya versi masing-masing.
3. `uses:=` menunjukkan type dependency.
4. Import range explicit.

---

## 54. Practical bnd Example

`bnd.bnd`:

```text
Bundle-SymbolicName: com.example.enforcement.escalation.api
Bundle-Version: 2.4.1

Export-Package: \
  com.example.enforcement.escalation.api,\
  com.example.enforcement.escalation.spi,\
  com.example.enforcement.escalation.dto

Private-Package: \
  com.example.enforcement.escalation.internal.*

-baseline: *
```

`package-info.java`:

```java
@org.osgi.annotation.versioning.Version("2.3.0")
package com.example.enforcement.escalation.api;
```

```java
@org.osgi.annotation.versioning.Version("1.5.0")
package com.example.enforcement.escalation.spi;
```

```java
@org.osgi.annotation.versioning.Version("1.8.0")
package com.example.enforcement.escalation.dto;
```

---

## 55. Architecture Decision Framework

Saat mendesain perubahan API, tanyakan:

1. Siapa consumer-nya?
   - caller?
   - implementer?
   - extender?
   - event subscriber?
   - config owner?
2. Apakah perubahan ini binary-compatible?
3. Apakah source-compatible?
4. Apakah behavior-compatible?
5. Apakah data-compatible?
6. Apakah thread-safety contract berubah?
7. Apakah exception/nullability berubah?
8. Apakah third-party type ikut berubah?
9. Apakah `uses:=` graph berubah?
10. Apakah Java baseline berubah?
11. Apakah old and new version perlu coexist?
12. Apakah adapter diperlukan?
13. Apakah baseline tool bisa mendeteksi perubahan ini?
14. Apakah resolver test mencakup skenario ini?
15. Apakah migration/rollback path jelas?

Jika jawaban banyak “tidak tahu”, jangan release sebagai minor update.

---

## 56. Mental Model Akhir

OSGi versioning bukan kosmetik manifest.

Ia adalah mekanisme untuk menjaga invariant:

```text
Setiap bundle harus wired ke contract yang ia pahami,
dan tidak boleh diam-diam menerima contract yang sudah berubah secara incompatible.
```

Di classpath biasa, version conflict sering tersembunyi sampai runtime path tertentu dieksekusi.

Di OSGi, dengan metadata yang benar, banyak conflict bisa ditolak sejak resolve-time.

Tetapi itu hanya terjadi jika engineer disiplin:

1. Export package yang memang public.
2. Version package sesuai contract.
3. Import dengan range eksplisit.
4. Pisahkan API/SPI/internal.
5. Hindari third-party leakage.
6. Jalankan baseline checking.
7. Test resolver graph.
8. Dokumentasikan behavioral compatibility.

Top 1% OSGi engineer tidak sekadar tahu header `Export-Package`. Mereka bisa melihat package sebagai **evolution boundary**.

---

## 57. Ringkasan Super Padat

- Bundle version adalah versi deployment unit.
- Package version adalah versi contract.
- Artifact version adalah versi file build.
- OSGi dependency yang sehat biasanya berbasis package, bukan bundle.
- API caller dan SPI implementer punya risiko compatibility berbeda.
- Menambah method ke interface bisa breaking jika interface diimplementasikan consumer.
- Binary compatibility tidak sama dengan behavioral compatibility.
- Version range terlalu luas berbahaya; terlalu sempit menyulitkan operasi.
- `@ProviderType` dan `@ConsumerType` membantu API governance.
- Baseline checking wajib untuk exported API package.
- Config schema, event schema, DTO, exception, nullability, dan thread-safety juga bagian dari contract.
- `javax` ke `jakarta` adalah package identity change, bukan version bump biasa.
- Java 8–25 compatibility harus dipikirkan saat memilih record/sealed/default method/virtual-thread semantics.
- Package boundary harus mengikuti compatibility rhythm.

---

## 58. Latihan Praktis

### Latihan 1 — Tentukan Version Bump

Diberikan package `com.example.case.api` version `1.4.0`.

Perubahan:

1. Tambah public class `CaseSearchCriteria`.
2. Hapus method `CaseService.find(String)`.
3. Tambah method default ke interface `CaseService`.
4. Ubah return type dari `Case` ke `Optional<Case>`.
5. Tambah enum constant `ESCALATED`.
6. Ubah behavior `find` dari return null ke throw exception.

Tentukan apakah micro/minor/major dan jelaskan alasan.

### Latihan 2 — Desain Package Boundary

Pecah package berikut:

```text
com.example.workflow
  WorkflowService
  WorkflowPlugin
  WorkflowEvent
  WorkflowEntity
  WorkflowDto
  WorkflowRenderer
```

Buat package API/SPI/events/dto/internal yang lebih sehat dan tentukan versioning policy-nya.

### Latihan 3 — Import Range Review

Review import berikut:

```text
Import-Package: \
  com.example.case.api,\
  com.example.case.spi;version="[1.0,999)",\
  com.fasterxml.jackson.databind;version="[2.0,3)",\
  jakarta.servlet;version="[5.0,6.0)"
```

Apa yang salah? Apa yang perlu diperbaiki?

### Latihan 4 — API Evolution Strategy

Interface plugin:

```java
public interface NotificationChannel {
    void send(NotificationMessage message);
}
```

Requirement baru:

```text
Host ingin tahu apakah channel support attachments.
```

Desain evolution yang tidak merusak plugin lama.

---

## 59. Referensi Lanjutan

Untuk memperdalam topik ini, rujukan paling penting:

1. OSGi Core Specification Release 8 — module layer, versioning, resolver, capabilities/requirements.
2. OSGi Compendium Specification — Declarative Services, Configuration Admin, Event Admin, Metatype.
3. bnd documentation — baseline checking, manifest generation, package versioning.
4. Apache Felix documentation — runtime behavior, bundle lifecycle, troubleshooting.
5. Eclipse Equinox documentation — framework behavior, execution environments, p2 provisioning.
6. Java Language Specification dan Java binary compatibility notes — untuk memahami dampak perubahan signature/type.

---

## 60. Penutup Part 6

Part ini membangun satu prinsip inti:

> Di OSGi, versioning adalah arsitektur evolusi runtime, bukan administrasi release.

Jika versioning salah, resolver bisa terlalu permisif atau terlalu kaku. Jika package boundary salah, versioning menjadi noisy. Jika API/SPI/internal dicampur, perubahan kecil bisa menjadi breaking change besar. Jika baseline tidak dijalankan, compatibility bergantung pada ingatan manusia.

Setelah memahami part ini, kita siap masuk ke service layer: bagaimana OSGi service registry bekerja, bagaimana service didaftarkan/dicari/diganti secara dinamis, dan kenapa service reference tidak boleh dipikir seperti dependency injection statis biasa.

---

# Status Series

```text
Part 6 dari 35 selesai.
Series belum selesai.
```

Part berikutnya:

```text
07-service-layer-fundamentals-registry-references-dynamics-contracts.md
```
