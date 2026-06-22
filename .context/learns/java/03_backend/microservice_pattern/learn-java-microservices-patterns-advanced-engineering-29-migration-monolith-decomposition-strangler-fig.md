# learn-java-microservices-patterns-advanced-engineering-29-migration-monolith-decomposition-strangler-fig

# Part 29 — Data Migration, Monolith Decomposition, and Strangler Fig

> Seri: `learn-java-microservices-patterns-advanced-engineering`  
> Part: `29 / 35`  
> Scope Java: `Java 8 hingga Java 25`  
> Fokus: migrasi sistem existing menuju microservices secara bertahap, aman, observable, reversible, dan tidak merusak correctness bisnis.

---

## 0. Tujuan Part Ini

Part ini membahas pertanyaan yang sering lebih sulit daripada membangun microservice baru dari nol:

> Bagaimana memigrasikan sistem monolith atau distributed monolith existing ke arsitektur service-oriented/microservices tanpa big-bang rewrite, tanpa merusak data, tanpa mematikan operasi bisnis, dan tanpa menciptakan kekacauan baru?

Setelah menyelesaikan part ini, kamu diharapkan mampu:

1. Membedakan modernisasi, rewrite, refactor, replatform, rehost, dan decomposition.
2. Menilai apakah monolith perlu dipecah atau justru sebaiknya diperkuat dulu.
3. Mendesain migrasi memakai Strangler Fig Pattern.
4. Memilih seam yang tepat untuk ekstraksi capability.
5. Memigrasikan endpoint, business logic, workflow, data ownership, dan read model secara bertahap.
6. Menghindari dual-write problem saat sistem lama dan baru berjalan paralel.
7. Mendesain CDC, outbox, anti-corruption layer, facade, branch-by-abstraction, parallel run, reconciliation, dan cutover.
8. Menyusun rollback/roll-forward plan yang realistis.
9. Menentukan kapan harus berhenti memecah service.
10. Menghasilkan migration decision record yang defensible untuk enterprise/regulatory system.

Part ini tidak mengulang dasar Spring Boot, Jakarta, Kafka, RabbitMQ, Redis, database migration, Flyway/Liquibase, deployment, observability, atau resilience. Semua itu dianggap sudah menjadi building block. Fokus part ini adalah **strategi evolusi sistem**.

---

## 1. Mental Model Utama: Migration Is Risk Management, Not Code Movement

Banyak engineer melihat migrasi sebagai kegiatan teknis:

```text
pindahkan controller
pindahkan service class
pindahkan table
pindahkan query
pindahkan deployment
```

Itu cara pikir yang terlalu sempit.

Migrasi microservices yang benar adalah kegiatan mengelola risiko terhadap:

1. **Business continuity** — sistem tetap melayani user.
2. **Data correctness** — data tidak hilang, tidak dobel, tidak corrupt.
3. **Behavior compatibility** — perilaku lama dan baru tetap konsisten selama transisi.
4. **Operational safety** — tim bisa monitor, rollback, dan recover.
5. **Organizational readiness** — ownership service jelas.
6. **Evolution capability** — setelah migrasi, sistem lebih mudah berubah, bukan hanya lebih tersebar.

Microservice migration gagal bukan karena kurang framework. Biasanya gagal karena:

1. Boundary salah.
2. Data ownership tidak jelas.
3. Migrasi dilakukan big bang.
4. Tidak ada parallel run.
5. Tidak ada reconciliation.
6. Tidak ada rollback strategy.
7. Contract lama tidak dipahami.
8. Perilaku legacy banyak yang implicit.
9. Tim memecah code tetapi tidak memecah ownership.
10. Sistem baru menjadi distributed monolith.

Mental model paling penting:

> Jangan pindahkan code lebih dulu. Pindahkan responsibility, ownership, invariant, data authority, dan operational control secara bertahap.

---

## 2. Istilah yang Sering Tercampur

### 2.1 Rehost

Rehost berarti memindahkan aplikasi ke platform baru tanpa mengubah desain besar.

Contoh:

```text
VM on-prem → EC2
Tomcat VM → container
bare metal → Kubernetes
```

Rehost bisa memperbaiki operational baseline, tetapi tidak otomatis memperbaiki architecture.

### 2.2 Replatform

Replatform mengubah sebagian runtime/platform tanpa rewrite besar.

Contoh:

```text
legacy WAR → Spring Boot executable jar
manual deployment → CI/CD
VM service → containerized service
Oracle self-managed → managed RDS
```

### 2.3 Refactor

Refactor mengubah struktur internal tanpa mengubah external behavior.

Contoh:

```text
fat service class → domain module
shared utility chaos → clear package boundary
SQL scattered everywhere → repository boundary
```

### 2.4 Rewrite

Rewrite berarti membangun ulang sistem dalam codebase baru.

Rewrite biasanya paling berisiko karena:

1. Business behavior lama sering tidak terdokumentasi.
2. Edge case legacy hanya diketahui setelah production incident.
3. Parity testing sulit.
4. Scope cenderung membesar.
5. Cutover sering big bang.

Rewrite hanya masuk akal bila:

1. Sistem lama tidak mungkin diperbaiki.
2. Domain cukup stabil dan terdefinisi.
3. Ada parallel run dan reconciliation.
4. Ada dukungan bisnis untuk masa transisi panjang.
5. Risiko operational bisa diterima.

### 2.5 Decomposition

Decomposition adalah pemecahan responsibility sistem menjadi boundary lebih kecil.

Decomposition bisa dilakukan pada:

1. Code module.
2. API boundary.
3. Data ownership.
4. Workflow ownership.
5. Deployment unit.
6. Team ownership.
7. Operational responsibility.

Decomposition tidak harus langsung menjadi microservice. Banyak sistem lebih sehat bila diawali dengan **modular monolith decomposition**.

### 2.6 Modernization

Modernization adalah proses meningkatkan kemampuan sistem untuk bertahan dan berevolusi.

Modernization bisa berarti:

1. Observability lebih baik.
2. Build lebih cepat.
3. Deployment lebih aman.
4. Modularisasi code.
5. Database ownership lebih jelas.
6. Extract service tertentu.
7. Memperbaiki testing strategy.
8. Mengurangi coupling.

Microservices hanya salah satu bentuk modernization.

---

## 3. Strangler Fig Pattern: Inti Strategi Bertahap

Strangler Fig Pattern adalah pendekatan mengganti sistem lama secara incremental. Sistem baru tumbuh di sekitar sistem lama, mengambil alih capability satu per satu, sampai bagian lama bisa dipensiunkan.

Model sederhananya:

```text
Before:

Client
  |
  v
Legacy Monolith

During:

Client
  |
  v
Facade / Router / Gateway
  |                |
  |                +--> New Service A
  |                +--> New Service B
  |
  +--> Legacy Monolith

After:

Client
  |
  v
Facade / Gateway
  |
  +--> New Service A
  +--> New Service B
  +--> New Service C
```

Tujuan utamanya bukan gaya arsitektur, tetapi **risk reduction**:

1. Legacy tetap berjalan.
2. New capability bisa dirilis bertahap.
3. Traffic bisa dialihkan sedikit demi sedikit.
4. Rollback lebih mudah.
5. Pembelajaran domain terjadi selama migrasi.
6. Tidak perlu big-bang cutover.

Namun Strangler Fig bukan magic. Ia gagal bila:

1. Facade menjadi god gateway.
2. Data ownership tidak dipisahkan.
3. Sistem lama dan baru saling menulis data tanpa kontrol.
4. Tidak ada reconciliation.
5. Tidak ada kriteria selesai.
6. Setiap capability baru tetap bergantung penuh pada legacy internals.

---

## 4. Mengapa Big-Bang Rewrite Berbahaya

Big-bang rewrite menggoda karena terlihat bersih:

```text
bangun sistem baru
migrasi semua data
cutover sekali
hapus sistem lama
```

Masalahnya, enterprise system jarang sesederhana itu.

### 4.1 Hidden Behavior

Legacy system sering menyimpan behavior dalam bentuk:

1. Conditional code lama.
2. Trigger database.
3. Stored procedure.
4. Batch job.
5. Manual operation.
6. Report query.
7. UI workaround.
8. Integration script.
9. Data anomaly yang sudah dianggap normal.
10. Rule bisnis yang tidak tertulis.

Rewrite yang hanya membaca requirement dokumen akan kehilangan hidden behavior ini.

### 4.2 Unknown Dependency

Monolith sering digunakan oleh:

1. UI utama.
2. Admin portal.
3. Batch job.
4. External agency.
5. Internal report.
6. Data warehouse.
7. Manual SQL extract.
8. Audit team.
9. Support team.
10. Integration partner.

Big-bang rewrite sering gagal karena dependency yang tidak dipetakan.

### 4.3 No Production Feedback Until Too Late

Dalam incremental migration, sistem baru diuji dengan sebagian traffic nyata. Dalam big-bang rewrite, feedback besar datang saat cutover.

Itu terlalu terlambat.

### 4.4 Data Cutover Risk

Data migration bukan hanya `INSERT INTO new_table SELECT ...`.

Data migration harus menjawab:

1. Bagaimana mapping entity lama ke domain baru?
2. Bagaimana handle dirty data?
3. Bagaimana maintain referential consistency?
4. Bagaimana migrate attachment/blob/audit?
5. Bagaimana migrate workflow state?
6. Bagaimana migrate historical event?
7. Bagaimana validate jumlah dan semantic correctness?
8. Bagaimana rollback jika sebagian berhasil?
9. Bagaimana handle data yang berubah selama migration window?
10. Bagaimana audit proof bahwa migration valid?

---

## 5. Kapan Monolith Jangan Dipecah Dulu

Tidak semua monolith buruk. Yang buruk adalah monolith yang tidak bisa berubah dengan aman.

Sebelum memecah, tanyakan:

1. Apakah domain boundary sudah dipahami?
2. Apakah test suite cukup melindungi behavior?
3. Apakah deployment pipeline stabil?
4. Apakah observability cukup untuk membedakan bug lama vs bug baru?
5. Apakah database ownership bisa dipisahkan?
6. Apakah tim siap memiliki service secara end-to-end?
7. Apakah ada business reason yang jelas?
8. Apakah sistem baru akan mengurangi cycle time atau hanya menambah network call?

Kalau jawabannya banyak “belum”, langkah pertama mungkin bukan microservices, tetapi:

1. Modularisasi monolith.
2. Tambah automated test.
3. Tambah observability.
4. Rapikan schema ownership.
5. Pisahkan package boundary.
6. Buat contract test.
7. Buat deployment pipeline.
8. Buat feature flag.
9. Buat strangler facade.

Top-tier engineer tidak memaksakan microservices. Mereka memilih sequencing yang mengurangi risiko.

---

## 6. Migration Readiness Assessment

Sebelum ekstraksi service, lakukan assessment pada beberapa dimensi.

### 6.1 Business Readiness

Pertanyaan:

1. Capability mana yang paling sering berubah?
2. Capability mana yang punya scaling pressure?
3. Capability mana yang sering menyebabkan defect?
4. Capability mana yang punya ownership jelas?
5. Capability mana yang punya value jika dirilis independen?
6. Capability mana yang punya risiko rendah untuk pilot?

### 6.2 Technical Readiness

Pertanyaan:

1. Apakah code boundary terlihat?
2. Apakah dependency graph diketahui?
3. Apakah schema ownership diketahui?
4. Apakah API/contract existing terdokumentasi?
5. Apakah test coverage cukup?
6. Apakah ada observability baseline?
7. Apakah deployment bisa dilakukan sering?
8. Apakah rollback bisa dilakukan?

### 6.3 Data Readiness

Pertanyaan:

1. Table mana yang menjadi source of truth?
2. Siapa writer utama table tersebut?
3. Siapa reader utama table tersebut?
4. Apakah ada direct SQL access dari modul lain?
5. Apakah ada trigger/stored procedure tersembunyi?
6. Apakah data clean?
7. Apakah ada historical/audit requirement?
8. Apakah ada retention/regulatory constraint?

### 6.4 Operational Readiness

Pertanyaan:

1. Apakah service baru punya dashboard?
2. Apakah log punya correlation ID?
3. Apakah ada SLO?
4. Apakah alert actionable?
5. Apakah runbook tersedia?
6. Apakah on-call tahu flow lama dan baru?
7. Apakah ada feature flag/kill switch?
8. Apakah rollback path teruji?

### 6.5 Organizational Readiness

Pertanyaan:

1. Siapa owner service baru?
2. Siapa owner data baru?
3. Siapa owner contract?
4. Siapa approve migration?
5. Siapa operate after go-live?
6. Apakah ada dependency antar tim?
7. Apakah skill cukup?
8. Apakah ada support model?

---

## 7. Memilih Candidate Pertama untuk Diekstrak

Candidate pertama sangat penting. Jangan mulai dari bagian paling kompleks kecuali ada alasan kuat.

### 7.1 Candidate yang Bagus

Ciri candidate bagus:

1. Boundary cukup jelas.
2. Data ownership relatif kecil.
3. Dependency keluar/masuk bisa dipetakan.
4. Business value nyata.
5. Risiko cutover terkendali.
6. Bisa diuji paralel.
7. Tidak membutuhkan migrasi semua sistem.
8. Tidak berada di critical path paling sensitif.
9. Tim punya domain knowledge.
10. Ada operational metric yang jelas.

Contoh candidate bagus:

```text
Notification Service
Document Rendering Service
Reference Data Service
Template Service
Audit Query Projection
Reporting Read Model
Search Projection
Payment Reconciliation Adapter
External Integration Adapter
```

Tetapi hati-hati: candidate seperti `Notification Service` sering terlihat mudah, tetapi bisa menjadi pusat side effect yang sulit bila tidak idempotent.

### 7.2 Candidate yang Berisiko untuk Pertama Kali

Ciri candidate berisiko:

1. Banyak shared table.
2. Banyak synchronous dependency.
3. Workflow state tersebar.
4. Rule bisnis implicit.
5. Banyak manual override.
6. Audit/legal consequence besar.
7. High traffic critical path.
8. Tidak ada test baseline.
9. Tidak ada domain owner jelas.
10. Cutover tidak bisa rollback.

Contoh candidate berisiko:

```text
Core Application Approval
Case Enforcement Lifecycle
Payment Posting
License Issuance Finalization
Identity Account Master
Cross-agency Authorization Decision
```

Bukan berarti tidak boleh diekstrak. Artinya jangan jadikan pilot tanpa safety mechanism kuat.

---

## 8. Decomposition Seams

Seam adalah titik alami tempat sistem bisa dipisahkan.

### 8.1 API Seam

API seam muncul ketika capability sudah dipanggil lewat endpoint tertentu.

Contoh:

```text
POST /applications/{id}/submit
GET  /applications/{id}
POST /documents/render
POST /notifications/send
```

Ekstraksi lewat API seam relatif mudah karena facade/router bisa mengalihkan endpoint.

Risiko:

1. Endpoint lama mungkin terlalu coarse.
2. Endpoint lama mungkin mencampur banyak responsibility.
3. Internal UI mungkin bergantung pada response shape lama.
4. Authorization behavior lama harus dipertahankan.

### 8.2 Database Seam

Database seam muncul ketika table atau schema sudah mencerminkan domain ownership.

Contoh:

```text
application_* tables
case_* tables
document_* tables
notification_* tables
```

Risiko:

1. Banyak join lintas domain.
2. Foreign key lintas boundary.
3. Trigger menyentuh table lain.
4. Batch job membaca/menulis langsung.

### 8.3 Workflow Seam

Workflow seam muncul di boundary step proses.

Contoh:

```text
Application Submitted → Screening
Screening Completed → Officer Review
Officer Review Completed → Approval Decision
Approval Decision → License Issuance
```

Risiko:

1. State machine tersebar.
2. Timeout/escalation tersembunyi.
3. Compensation tidak jelas.
4. Human task masih di monolith.

### 8.4 External Integration Seam

External integration seam sering menjadi candidate bagus.

Contoh:

```text
MyInfo adapter
Payment gateway adapter
Email gateway adapter
SMS gateway adapter
Map/geocoding adapter
Document signing adapter
```

Keuntungan:

1. Boundary jelas.
2. External API punya contract.
3. Bisa diberi circuit breaker.
4. Bisa diuji dengan mock/sandbox.
5. Bisa dimonitor sebagai dependency.

Risiko:

1. Credential/security ownership.
2. Rate limit.
3. Idempotency.
4. Retry side effect.
5. Audit requirement.

### 8.5 Reporting/Read Model Seam

Read-heavy area sering bisa diekstrak dulu sebagai projection.

Contoh:

```text
worklist
case search
audit listing
dashboard
reporting export
```

Keuntungan:

1. Tidak langsung mengubah command-side correctness.
2. Bisa parallel run dengan query lama.
3. Bisa compare output.
4. Bisa menggunakan CDC/event projection.

Risiko:

1. Freshness expectation.
2. Authorization filtering.
3. Data duplication.
4. Reconciliation.

---

## 9. Strangler Migration Building Blocks

### 9.1 Facade / Router

Facade berada di depan legacy dan service baru.

Tugas facade:

1. Route request ke legacy atau service baru.
2. Menjaga contract eksternal tetap stabil.
3. Menyediakan feature flag routing.
4. Menyediakan traffic split.
5. Menyediakan fallback/rollback route.
6. Menambahkan observability/correlation.

Facade bisa berupa:

1. API Gateway.
2. Reverse proxy.
3. BFF.
4. Service adapter.
5. Library abstraction internal.
6. Message router.

Anti-pattern:

```text
Facade mulai mengambil semua business logic karena legacy dan service baru berbeda.
```

Facade seharusnya menjaga transisi, bukan menjadi domain service permanen yang ambigu.

### 9.2 Anti-Corruption Layer

Anti-corruption layer melindungi model baru dari model lama.

Tanpa ACL, sistem baru akan mewarisi:

1. Nama field legacy yang salah.
2. Status enum legacy yang ambigu.
3. Null semantics lama.
4. Data anomaly lama.
5. Workflow shortcut lama.
6. Coupling ke table lama.

Contoh:

```java
// Legacy DTO: ambiguous and transport-shaped
public final class LegacyApplicationRow {
    public String appNo;
    public String stat;
    public String typ;
    public String submittedDt;
    public String officer;
}

// New domain model: explicit business language
public final class ApplicationSnapshot {
    private final ApplicationId id;
    private final ApplicationStatus status;
    private final ApplicationType type;
    private final Instant submittedAt;
    private final OfficerId assignedOfficer;
}
```

ACL melakukan:

1. Translation.
2. Validation.
3. Normalization.
4. Semantic mapping.
5. Compatibility handling.
6. Legacy exception isolation.

### 9.3 Branch by Abstraction

Branch by abstraction adalah teknik mengganti implementation di balik abstraction tanpa long-lived branch.

Contoh:

```java
public interface ApplicationDecisionPort {
    DecisionResult decide(DecisionCommand command);
}

public final class LegacyApplicationDecisionAdapter implements ApplicationDecisionPort {
    @Override
    public DecisionResult decide(DecisionCommand command) {
        // call legacy module or stored procedure
    }
}

public final class NewApplicationDecisionService implements ApplicationDecisionPort {
    @Override
    public DecisionResult decide(DecisionCommand command) {
        // new service behavior
    }
}
```

Lalu routing bisa dikendalikan:

```java
public final class SwitchingApplicationDecisionPort implements ApplicationDecisionPort {
    private final FeatureFlag flag;
    private final ApplicationDecisionPort legacy;
    private final ApplicationDecisionPort modern;

    @Override
    public DecisionResult decide(DecisionCommand command) {
        if (flag.enabledFor(command.applicationId())) {
            return modern.decide(command);
        }
        return legacy.decide(command);
    }
}
```

Keuntungan:

1. Perubahan incremental.
2. Bisa fallback.
3. Bisa compare behavior.
4. Tidak butuh branch besar.

Bahaya:

1. Abstraction terlalu generic.
2. Dua implementation hidup terlalu lama.
3. Flag tidak pernah dibersihkan.
4. Behavior divergence tidak dimonitor.

### 9.4 Parallel Run

Parallel run berarti sistem lama dan baru berjalan bersamaan untuk membandingkan output.

Mode parallel run:

1. **Shadow read** — baca dari sistem baru tetapi tidak ditampilkan.
2. **Shadow write** — tulis simulasi ke sistem baru tetapi tidak authoritative.
3. **Dual processing** — proses lama dan baru, compare result.
4. **Read compare** — query lama dan projection baru dibandingkan.
5. **Decision compare** — rule engine lama dan baru dibandingkan.

Contoh:

```text
User calls legacy endpoint
  -> legacy produces decision
  -> new service also computes decision in shadow
  -> compare result
  -> only legacy result returned to user
  -> divergence logged for analysis
```

Parallel run sangat berguna untuk:

1. Rule migration.
2. Report migration.
3. Projection migration.
4. Eligibility calculation.
5. Search/result parity.

Risiko:

1. Shadow path menambah load.
2. Shadow write bisa menyebabkan side effect jika tidak benar-benar isolated.
3. Divergence butuh triage.
4. Tidak semua behavior bisa dibandingkan bit-by-bit.

### 9.5 Reconciliation

Reconciliation adalah proses membandingkan dan memperbaiki perbedaan antara sistem lama dan baru.

Jenis reconciliation:

1. Count reconciliation.
2. Checksum reconciliation.
3. Field-level reconciliation.
4. Semantic reconciliation.
5. State transition reconciliation.
6. Financial amount reconciliation.
7. Audit trail reconciliation.
8. Attachment/blob reconciliation.

Contoh reconciliation report:

```text
Migration Batch: APPLICATION-2026-06-19-001

Source count:          1,250,000
Target count:          1,250,000
Missing in target:     0
Extra in target:       0
Checksum mismatch:     37
Semantic mismatch:     12
Critical mismatch:     2
Ignored mismatch:      23

Status: BLOCKED_FOR_CUTOVER
```

Top-tier migration tidak hanya berkata “script berhasil”. Ia membuktikan semantic correctness.

### 9.6 Cutover

Cutover adalah momen ketika authority berpindah.

Cutover bisa terjadi pada:

1. API route.
2. Data writer.
3. Data reader.
4. Workflow step.
5. Event producer.
6. Reporting source.
7. External integration.
8. User group.
9. Tenant.
10. Region.

Cutover aman bila:

1. Pre-check jelas.
2. Freeze window jika diperlukan.
3. Backup/snapshot tersedia.
4. Feature flag siap.
5. Observability siap.
6. Rollback/roll-forward jelas.
7. Reconciliation selesai.
8. Stakeholder tahu.
9. Support ready.
10. Post-cutover monitoring berjalan.

---

## 10. Migration Patterns by Layer

### 10.1 Endpoint Migration

Endpoint migration adalah mengalihkan request tertentu dari monolith ke service baru.

Langkah:

```text
1. Dokumentasikan existing contract.
2. Tambahkan contract test untuk legacy behavior.
3. Buat service baru dengan contract kompatibel.
4. Pasang facade/router.
5. Jalankan shadow traffic.
6. Compare response.
7. Aktifkan untuk internal user.
8. Aktifkan untuk subset tenant/user.
9. Monitor error/latency/divergence.
10. Pindahkan traffic penuh.
11. Hapus route legacy setelah aman.
```

Risiko:

1. Response berbeda secara kecil tetapi penting.
2. Header/cookie/session behavior berubah.
3. Authorization berubah.
4. Pagination/sorting berbeda.
5. Error code berubah.
6. Latency naik karena service baru masih call legacy.

### 10.2 Business Logic Migration

Business logic migration lebih sulit karena behavior lama sering implicit.

Strategi:

1. Characterization test.
2. Decision table extraction.
3. Rule inventory.
4. Production sample replay.
5. Shadow decision comparison.
6. Domain event validation.
7. Exception case review.

Characterization test tidak bertanya “apakah behavior benar menurut requirement”. Ia bertanya:

> Apakah behavior baru sama dengan behavior existing yang user sudah alami?

Setelah parity tercapai, baru behavior bisa diperbaiki secara terkontrol.

### 10.3 Workflow Migration

Workflow migration memindahkan long-running process.

Tantangan:

1. Instance lama masih berjalan.
2. Instance baru memakai model baru.
3. State lama harus dipetakan.
4. Timer/escalation harus dipindahkan.
5. Human task harus tetap terlihat.
6. Audit trail harus kontinu.

Strategi umum:

```text
New workflow instances → new engine/service
Existing workflow instances → stay in legacy until completion
Selected existing instances → migrate only if mapping safe
```

Jangan memigrasikan semua in-flight workflow jika tidak perlu. Sering lebih aman membiarkan instance lama selesai di legacy.

### 10.4 Data Migration

Data migration adalah bagian paling berbahaya.

Jenis data migration:

1. Historical bulk migration.
2. Incremental sync.
3. Live dual-run sync.
4. CDC-based replication.
5. On-demand lazy migration.
6. Read-through migration.
7. Write cutover migration.
8. Archive-only migration.

Pola umum:

```text
1. Define target canonical model.
2. Map source fields to target fields.
3. Classify dirty data.
4. Build migration script/pipeline.
5. Run dry-run.
6. Validate counts/checksums/semantics.
7. Run bulk load.
8. Start incremental sync/CDC.
9. Reconcile drift.
10. Cut over writer.
11. Cut over readers.
12. Stop legacy writes.
13. Archive legacy data.
```

### 10.5 Report Migration

Report migration sering diremehkan.

Report lama biasanya bergantung pada:

1. Direct SQL join.
2. Hidden filter.
3. Legacy status code.
4. Manual correction.
5. Performance hint.
6. Stored procedure.
7. Time zone assumption.
8. Security assumption.

Strategi:

1. Inventory semua report.
2. Classify business criticality.
3. Build projection/read model.
4. Compare report output.
5. Validate with business owner.
6. Freeze old report definition.
7. Cut over report consumers.

---

## 11. Data Extraction Strategy

Data extraction adalah perpindahan data authority dari legacy ke service baru.

### 11.1 Tahap 0 — Shared Database Legacy

Awal:

```text
Legacy Monolith
  |
  v
Shared Database
```

Semua modul membaca/menulis table yang sama.

### 11.2 Tahap 1 — Logical Ownership

Tentukan ownership tanpa memindahkan fisik database dulu.

```text
Application tables  -> Application module owner
Case tables         -> Case module owner
Document tables     -> Document module owner
Notification tables -> Notification module owner
```

Aturan mulai ditegakkan:

1. Modul lain tidak boleh direct write.
2. Direct read mulai di-inventory.
3. Query lintas domain ditandai.
4. Foreign key lintas boundary dicatat.
5. Migration scripts diberi owner.

### 11.3 Tahap 2 — Access Encapsulation

Semua access ke table yang akan diekstrak dilewatkan ke repository/port tertentu.

```java
public interface ApplicationRepository {
    Optional<Application> findById(ApplicationId id);
    void save(Application application);
}
```

Tujuan:

1. Mengurangi SQL scattered.
2. Membuat seam untuk adapter.
3. Memudahkan shadow read/write.
4. Memudahkan switching implementation.

### 11.4 Tahap 3 — New Service Owns New Writes

Service baru mulai menjadi writer authoritative untuk subset data.

```text
New Application Service -> new_application_db
Legacy Monolith         -> legacy_db
```

Namun legacy mungkin masih butuh read. Maka service baru bisa publish event/projection ke legacy read model.

### 11.5 Tahap 4 — Readers Move

Consumer lama dipindahkan untuk membaca dari service baru/API/projection.

```text
Legacy reader query -> Application API / projection
```

### 11.6 Tahap 5 — Legacy Table Retired

Setelah tidak ada writer/reader aktif:

1. Freeze table.
2. Archive.
3. Remove code path.
4. Remove migration scripts.
5. Remove permissions.
6. Update documentation.

---

## 12. Dual-Write Problem During Migration

Dual-write problem terjadi ketika satu business operation harus menulis ke dua resource berbeda.

Contoh buruk:

```java
@Transactional
public void approve(ApplicationId id) {
    legacyRepository.updateStatus(id, "APPROVED");
    newApplicationClient.approve(id); // remote call inside DB transaction
}
```

Failure modes:

1. Legacy update sukses, new service call gagal.
2. Legacy update rollback, new service sudah commit.
3. Timeout tetapi outcome unknown.
4. Retry menyebabkan duplicate approval.
5. Transaction lock tertahan saat remote call lambat.

Solusi bukan “tambah retry saja”. Solusi harus berbasis pattern:

1. Transactional outbox.
2. CDC.
3. Inbox/idempotent consumer.
4. Saga/process manager.
5. Reconciliation.
6. Single writer cutover.
7. Command sourcing/event sourcing jika sesuai.

---

## 13. CDC-Based Migration

Change Data Capture membantu menangkap perubahan dari database legacy untuk disinkronkan ke sistem baru.

Model:

```text
Legacy DB transaction log
        |
        v
CDC connector
        |
        v
Migration topic / event stream
        |
        v
New service projection/importer
```

Kapan CDC berguna:

1. Data volume besar.
2. Downtime window kecil.
3. Legacy tidak mudah diubah untuk publish event.
4. Perlu incremental sync.
5. Perlu parallel run.

Risiko CDC:

1. CDC melihat perubahan data, bukan intent bisnis.
2. Update row tidak selalu menjelaskan command penyebabnya.
3. Delete bisa ambigu.
4. Transaction ordering harus dipahami.
5. Schema change legacy bisa mematahkan pipeline.
6. PII/sensitive data bisa bocor ke stream.
7. Replay harus idempotent.
8. CDC consumer harus punya semantic mapper.

CDC bukan pengganti domain event. CDC adalah mekanisme transisi atau integrasi data-level.

---

## 14. Outbox During Migration

Jika legacy masih bisa dimodifikasi, outbox sering lebih semantik daripada raw CDC.

Legacy operation:

```text
BEGIN TRANSACTION
  update application status
  insert into outbox(event_type='ApplicationApproved', payload=...)
COMMIT
```

Message relay:

```text
outbox table -> publisher -> broker -> new service consumer
```

Keuntungan:

1. Event lebih business meaningful.
2. Atomic dengan update legacy.
3. Consumer bisa idempotent.
4. Bisa audit event publication.

Kelemahan:

1. Perlu modifikasi legacy.
2. Perlu outbox cleanup.
3. Perlu publisher reliability.
4. Event schema perlu governance.

---

## 15. Lazy Migration / Read-Through Migration

Lazy migration memindahkan data saat pertama kali diakses.

Flow:

```text
Request for entity X
  -> new DB lookup
  -> not found
  -> load from legacy
  -> transform
  -> save to new DB
  -> return from new model
```

Kapan cocok:

1. Data besar tetapi sebagian jarang diakses.
2. Tidak perlu migrasi penuh di awal.
3. Legacy tetap bisa menjadi fallback.
4. Entity relatif independent.

Kapan berbahaya:

1. Data berubah sering.
2. Entity punya banyak dependency.
3. Migrasi butuh workflow/context besar.
4. Latency request tidak boleh naik.
5. Ada strict audit requirement.

Lazy migration harus punya:

1. Idempotency.
2. Version marker.
3. Migration status.
4. Error handling.
5. Reconciliation job.
6. Observability.

---

## 16. Parallel Database Run

Parallel database run berarti legacy DB dan new DB sama-sama terisi selama transisi.

Model:

```text
Legacy write -> legacy DB -> outbox/CDC -> new DB
New service read -> new DB
Legacy read -> legacy DB
```

Kemudian:

```text
New write -> new DB -> event/projection -> legacy read model if needed
```

Yang harus ditentukan:

1. Siapa writer authoritative per phase?
2. Apakah sync satu arah atau dua arah?
3. Apakah conflict mungkin terjadi?
4. Bagaimana conflict diselesaikan?
5. Bagaimana detect drift?
6. Bagaimana audit data lineage?

Hindari bi-directional sync kecuali benar-benar perlu. Bi-directional sync sering menjadi sumber conflict kompleks.

---

## 17. Authority Transfer

Migrasi data yang benar adalah transfer authority, bukan sekadar copy data.

Untuk setiap entity, tentukan phase:

```text
Phase A: Legacy authoritative
Phase B: Legacy authoritative, new read replica
Phase C: New authoritative for new records, legacy for old records
Phase D: New authoritative for all active records
Phase E: Legacy archive only
```

Decision table:

| Phase | Writer | Reader | Sync Direction | Rollback |
|---|---|---|---|---|
| A | Legacy | Legacy | none | not needed |
| B | Legacy | Legacy + New shadow | Legacy -> New | stop new consumer |
| C | Split by cohort | Both | depends | cohort rollback |
| D | New | New + legacy projection | New -> Legacy optional | roll-forward preferred |
| E | New | New | archive only | data restore procedure |

Authority transfer harus eksplisit. Kalau tidak, tim akan bingung siapa source of truth.

---

## 18. Migration Cohort Strategy

Jangan selalu cutover semua user/data sekaligus. Gunakan cohort.

Cohort bisa berdasarkan:

1. Tenant.
2. Agency.
3. Region.
4. User group.
5. Application type.
6. Case type.
7. New records only.
8. Low-risk records.
9. Internal users.
10. Percentage traffic.

Contoh:

```text
Week 1: internal support users only
Week 2: new applications type A only
Week 3: agency X only
Week 4: 10% public traffic
Week 5: 50% public traffic
Week 6: 100% public traffic
```

Cohort strategy memungkinkan:

1. Blast radius kecil.
2. Learning cepat.
3. Rollback per cohort.
4. Targeted support.
5. Data comparison lebih manageable.

---

## 19. Cutover Strategy

### 19.1 API Cutover

```text
Route endpoint from legacy to new service.
```

Checklist:

1. Contract test pass.
2. Shadow compare acceptable.
3. Error rate baseline known.
4. Latency within budget.
5. Feature flag ready.
6. Rollback route ready.
7. Dashboard ready.

### 19.2 Writer Cutover

```text
New service becomes authoritative writer.
```

Checklist:

1. Legacy write disabled for migrated cohort.
2. New DB consistency validated.
3. Outbox/inbox ready.
4. Idempotency ready.
5. Reconciliation ready.
6. Conflict policy documented.
7. Support script ready.

### 19.3 Reader Cutover

```text
Consumers read from new service/projection.
```

Checklist:

1. Freshness SLA defined.
2. Authorization parity validated.
3. Pagination/sorting parity validated.
4. Data quality report accepted.
5. Fallback read path known.

### 19.4 Workflow Cutover

```text
New workflow instances use new process manager/workflow engine.
```

Checklist:

1. Existing instances strategy defined.
2. Timer/escalation migrated or retained.
3. Human tasks visible.
4. Audit continuity validated.
5. Compensation path tested.
6. Versioning rule clear.

---

## 20. Rollback vs Roll-Forward

Rollback means returning to previous implementation. Roll-forward means fixing forward while staying on new path.

### 20.1 When Rollback Is Realistic

Rollback is realistic when:

1. No irreversible data change occurred.
2. Legacy still authoritative.
3. New writes are shadow only.
4. Route switch can be reversed.
5. Data sync can be stopped safely.
6. User-visible side effects are minimal.

### 20.2 When Rollback Is Dangerous

Rollback is dangerous when:

1. New service has accepted writes.
2. External side effects occurred.
3. Workflow moved forward.
4. Data schema transformed irreversibly.
5. Legacy cannot interpret new state.
6. Users received new decisions/notifications.

In these cases, roll-forward is often safer.

### 20.3 Rollback Plan Must Be Specific

Bad rollback plan:

```text
If error happens, rollback deployment.
```

Good rollback plan:

```text
If p95 latency > 2s for 10 minutes or HTTP 5xx > 1%, route cohort A back to legacy using flag `application.submit.route=legacy`.
Keep new service consumers paused.
Run reconciliation query `MIG-APP-001` to find records written only in new DB.
For records with external notification already sent, do not rollback status; open correction workflow.
```

---

## 21. Reconciliation Design in Detail

Reconciliation should not be an afterthought.

### 21.1 Count Reconciliation

```sql
SELECT COUNT(*) FROM legacy_application WHERE status <> 'DELETED';
SELECT COUNT(*) FROM new_application WHERE deleted = false;
```

Useful but shallow.

### 21.2 Key Reconciliation

```text
legacy IDs - new IDs = missing
new IDs - legacy IDs = extra
```

### 21.3 Field Reconciliation

Compare mapped fields.

```text
legacy.app_no       -> new.application_number
legacy.stat         -> new.status
legacy.submitted_dt -> new.submitted_at
```

### 21.4 Semantic Reconciliation

Semantic reconciliation compares meaning, not raw field equality.

Example:

```text
legacy.stat = 'A'
new.status = APPROVED
```

Raw value differs but semantic value matches.

### 21.5 Workflow Reconciliation

Check that state transitions make sense.

```text
Legacy says: APPROVED
New says: UNDER_REVIEW
Audit trail says: approval event exists
=> mismatch critical
```

### 21.6 Financial/Regulatory Reconciliation

For high-risk domains:

1. Amount totals.
2. Fee balance.
3. Penalty computation.
4. Approval authority.
5. SLA breach count.
6. Audit record completeness.
7. Legal status.

### 21.7 Reconciliation Severity

Classify mismatch:

```text
P0: corrupts legal/financial/business outcome
P1: user-visible incorrect data
P2: report/search inconsistency
P3: cosmetic/format mismatch
P4: accepted legacy anomaly
```

Cutover should block on P0/P1 unless explicitly accepted.

---

## 22. Legacy Data Quality

Migration exposes dirty data.

Common dirty data:

1. Invalid enum/status.
2. Missing foreign key.
3. Duplicate business key.
4. Null where required.
5. Inconsistent timestamp.
6. Impossible state transition.
7. Orphan attachment.
8. User ID no longer exists.
9. Time zone ambiguity.
10. Manual SQL correction without audit.

Strategies:

1. Reject and fix before migration.
2. Migrate with anomaly marker.
3. Map to explicit `UNKNOWN` state.
4. Create correction workflow.
5. Archive only.
6. Ask business owner for decision.

Do not silently normalize legally meaningful data.

---

## 23. Anti-Corruption Mapping Examples

### 23.1 Status Mapping

Legacy:

```text
N = New
S = Submitted
P = Pending
A = Approved
R = Rejected
C = Cancelled
X = Deleted
```

New:

```java
public enum ApplicationStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    APPROVED,
    REJECTED,
    CANCELLED,
    ARCHIVED
}
```

Mapping must be explicit:

```java
public final class LegacyStatusMapper {
    public ApplicationStatus map(String legacyStatus, LegacyApplicationRow row) {
        switch (legacyStatus) {
            case "N": return ApplicationStatus.DRAFT;
            case "S": return ApplicationStatus.SUBMITTED;
            case "P": return ApplicationStatus.UNDER_REVIEW;
            case "A": return ApplicationStatus.APPROVED;
            case "R": return ApplicationStatus.REJECTED;
            case "C": return ApplicationStatus.CANCELLED;
            case "X": return ApplicationStatus.ARCHIVED;
            default:
                throw new UnmappableLegacyDataException(
                    "Unknown legacy status: " + legacyStatus + " for app " + row.appNo
                );
        }
    }
}
```

### 23.2 Status + Context Mapping

Kadang satu status legacy tidak cukup.

```java
public ApplicationStatus map(LegacyApplicationRow row) {
    if ("P".equals(row.stat) && row.assignedOfficer == null) {
        return ApplicationStatus.SUBMITTED;
    }
    if ("P".equals(row.stat) && row.assignedOfficer != null) {
        return ApplicationStatus.UNDER_REVIEW;
    }
    // ...
}
```

Ini harus didokumentasikan sebagai migration rule.

---

## 24. Migration Architecture Example: Application Module Extraction

### 24.1 Initial State

```text
Legacy ACE-like Monolith
  - application management
  - case management
  - document management
  - notification
  - payment
  - audit
  - reporting
        |
        v
Shared Oracle Database
```

Problems:

1. Application table read by many modules.
2. Status updated by multiple code paths.
3. Report joins application, case, payment, document.
4. Audit trail stored separately.
5. Notifications triggered inside transaction.

### 24.2 Target Direction

```text
Application Service
  owns application command model
  publishes ApplicationSubmitted/ApplicationApproved events

Case Service
  owns case lifecycle

Document Service
  owns document metadata/rendering

Notification Service
  owns delivery side effects

Reporting Projection
  owns cross-service read model
```

### 24.3 Migration Sequence

```text
Step 1: Add application boundary inside monolith.
Step 2: Add characterization tests for submit/approve/reject.
Step 3: Add outbox to legacy application operations.
Step 4: Build new Application Service read projection from outbox/CDC.
Step 5: Shadow compare application detail API.
Step 6: Route read endpoint to new service for internal users.
Step 7: New applications only created in new service for pilot cohort.
Step 8: Publish events to legacy projection if legacy still needs reads.
Step 9: Move workflow step ownership.
Step 10: Retire legacy application write path.
Step 11: Archive legacy tables after retention policy.
```

---

## 25. Sequence Diagrams

### 25.1 Endpoint Strangling

```text
Client
  |
  | POST /applications/{id}/submit
  v
Gateway/Facade
  |
  | if migrated(appId) -> New Application Service
  | else               -> Legacy Monolith
  v
Target Handler
```

### 25.2 Shadow Compare

```text
Client
  |
  v
Facade
  |
  +--> Legacy Monolith ----> legacy response ----+
  |                                              |
  +--> New Service (shadow) -> new response ------+--> Comparator
                                                  |
                                                  v
                                           divergence log
  |
  v
Return legacy response to client
```

### 25.3 CDC-Based Read Projection

```text
Legacy DB
  |
  | transaction log
  v
CDC Connector
  |
  v
Application Change Topic
  |
  v
New Projection Consumer
  |
  v
New Read Model DB
```

### 25.4 Writer Authority Cutover

```text
Before:
Client -> Legacy -> Legacy DB -> CDC -> New DB

After:
Client -> New Service -> New DB -> Event -> Legacy Projection(optional)
```

---

## 26. Java 8–25 Considerations

### 26.1 Java 8

Java 8 migration code usually relies on:

1. Interfaces for ports.
2. `CompletableFuture` with caution.
3. Old HTTP clients or Apache/OkHttp.
4. Manual immutable objects.
5. Traditional thread pools.
6. Limited language help for modeling.

Migration guidance:

1. Keep abstraction explicit.
2. Avoid clever async chains.
3. Use stable libraries.
4. Make idempotency and mapping classes simple.
5. Write more tests because type system is less expressive.

### 26.2 Java 11

Java 11 gives:

1. Standard `HttpClient`.
2. Better container/JVM improvements than Java 8.
3. Stronger baseline for enterprise migration.

Useful for:

1. Facade clients.
2. Migration workers.
3. Reconciliation tools.
4. Internal adapters.

### 26.3 Java 17

Java 17 gives better modeling tools:

1. Records.
2. Sealed classes.
3. Pattern-friendly design.
4. Better runtime baseline.

Migration model example:

```java
public sealed interface MigrationDecision
        permits MigrationDecision.RouteToLegacy,
                MigrationDecision.RouteToModern,
                MigrationDecision.ShadowOnly {

    record RouteToLegacy(String reason) implements MigrationDecision {}
    record RouteToModern(String cohort) implements MigrationDecision {}
    record ShadowOnly(String reason) implements MigrationDecision {}
}
```

### 26.4 Java 21

Java 21 adds virtual threads as a production feature.

Useful for:

1. Migration/reconciliation jobs with many blocking calls.
2. Facade/BFF workloads with IO-heavy calls.
3. Bulk validation tools.
4. Parallel comparison tools.

But virtual threads do not remove the need for:

1. Rate limits.
2. Connection pool limits.
3. Backpressure.
4. Timeout budgets.
5. Bulkheads.

### 26.5 Java 25

Java 25 represents the latest Java generation in this series. Treat it as modern runtime horizon, but enterprise adoption may lag.

Guidance:

1. Do not require Java 25 for migration tooling unless organization supports it.
2. Prefer LTS-compatible baseline if many services are old.
3. Use modern Java features where they improve correctness and readability.
4. Avoid migration risk caused by unnecessary runtime jump.

Migration sequencing should not combine too many risks:

```text
Bad:
extract service + change framework + change DB + change Java 8 to 25 + change API + change auth

Better:
extract boundary first, keep runtime stable
then upgrade runtime separately
or upgrade runtime first, then extract boundary
```

---

## 27. Migration Tooling Architecture

A serious migration often needs tooling.

### 27.1 Migration Runner

Responsibilities:

1. Batch read source records.
2. Transform.
3. Validate.
4. Write target.
5. Record progress.
6. Retry safely.
7. Produce audit logs.
8. Emit metrics.

### 27.2 Migration State Table

Example:

```sql
CREATE TABLE migration_record_status (
    migration_name      VARCHAR2(100) NOT NULL,
    source_key          VARCHAR2(200) NOT NULL,
    target_key          VARCHAR2(200),
    status              VARCHAR2(40) NOT NULL,
    attempt_count       NUMBER(10) NOT NULL,
    last_error_code     VARCHAR2(100),
    last_error_message  CLOB,
    source_checksum     VARCHAR2(128),
    target_checksum     VARCHAR2(128),
    started_at          TIMESTAMP,
    completed_at        TIMESTAMP,
    updated_at          TIMESTAMP NOT NULL,
    CONSTRAINT pk_migration_record_status PRIMARY KEY (migration_name, source_key)
);
```

### 27.3 Idempotent Migration Worker

Pseudo-code:

```java
public final class MigrationWorker {
    private final SourceApplicationReader source;
    private final TargetApplicationWriter target;
    private final MigrationStatusRepository statusRepository;
    private final ApplicationMapper mapper;

    public void migrate(SourceKey key) {
        MigrationStatus existing = statusRepository.find("application-v1", key);
        if (existing != null && existing.isCompleted()) {
            return;
        }

        statusRepository.markRunning("application-v1", key);

        try {
            LegacyApplicationRow row = source.load(key);
            ApplicationSnapshot snapshot = mapper.map(row);
            target.upsert(snapshot); // idempotent write
            statusRepository.markCompleted(
                "application-v1",
                key,
                snapshot.id().value(),
                checksum(row),
                checksum(snapshot)
            );
        } catch (UnmappableLegacyDataException ex) {
            statusRepository.markBlocked("application-v1", key, ex.code(), ex.getMessage());
        } catch (TransientException ex) {
            statusRepository.markRetryableFailure("application-v1", key, ex.code(), ex.getMessage());
            throw ex;
        }
    }
}
```

Important properties:

1. `upsert` is idempotent.
2. Status is persisted.
3. Unmappable data is not silently ignored.
4. Retryable and non-retryable failures are separated.
5. Checksums support reconciliation.

---

## 28. Migration Observability

Migration needs observability as much as production services.

Metrics:

```text
migration_records_total
migration_records_completed_total
migration_records_failed_total
migration_records_blocked_total
migration_records_retry_total
migration_lag_seconds
migration_throughput_records_per_second
migration_divergence_total
migration_reconciliation_mismatch_total
migration_cutover_error_total
migration_rollback_total
```

Logs should include:

1. Migration name.
2. Batch ID.
3. Source key.
4. Target key.
5. Correlation ID.
6. Mapping rule version.
7. Source checksum.
8. Target checksum.
9. Error classification.
10. Actor/system identity.

Dashboards:

1. Progress dashboard.
2. Failure dashboard.
3. Data quality dashboard.
4. Divergence dashboard.
5. Cutover dashboard.
6. Business KPI dashboard.

Alerts:

1. Migration stalled.
2. Error rate above threshold.
3. CDC lag high.
4. Reconciliation mismatch critical.
5. New service error spike after cutover.
6. Legacy fallback unexpectedly used.

---

## 29. Migration Security and Compliance

Migration often handles more data than normal runtime paths.

Security concerns:

1. Bulk data access.
2. PII exposure.
3. Temporary storage.
4. Debug logs with sensitive data.
5. Cross-environment copy.
6. Over-privileged migration account.
7. Unencrypted export files.
8. Audit gap.
9. Uncontrolled support scripts.
10. Data retention violation.

Rules:

1. Use least privilege migration credentials.
2. Avoid production data export unless necessary.
3. Encrypt temporary files.
4. Mask logs.
5. Audit every bulk operation.
6. Separate dry-run from production run.
7. Store migration decision records.
8. Define data deletion for temporary artifacts.
9. Validate tenant/agency boundary.
10. Require approval for destructive steps.

For regulatory systems, migration must answer:

1. Who approved the migration?
2. What data was migrated?
3. Which mapping rules were used?
4. Which records failed?
5. Which records were manually corrected?
6. How was correctness validated?
7. How can we reproduce the migration evidence?

---

## 30. Migration Decision Record Template

Use a decision record for each major extraction.

```markdown
# Migration Decision Record: Extract Application Submission

## Context
The legacy monolith owns application submission, validation, notification, and workflow initialization in one transaction path.

## Problem
Submission changes frequently and blocks independent release of application-related CRs. Current code path also triggers notification inside transaction.

## Decision
Extract Application Submission into Application Service using Strangler Fig Pattern.

## Scope
Included:
- new application submission endpoint
- submission validation
- application command table
- submission outbox event

Excluded:
- historical application migration
- approval decision
- reporting dashboard

## Migration Strategy
- Add facade route
- Run shadow validation for 2 weeks
- New applications for internal pilot cohort use new service
- Legacy remains authoritative for existing applications
- Publish ApplicationSubmitted event to legacy projection

## Data Authority
Phase 1: legacy authoritative
Phase 2: new service authoritative for pilot new applications
Phase 3: new service authoritative for all new applications

## Rollback
Route pilot cohort back to legacy if new submission error rate > 1% for 15 minutes.
Records already created in new service remain new-authoritative and are handled through correction workflow.

## Risks
- validation divergence
- duplicate notification
- stale legacy projection
- support confusion

## Controls
- idempotency key on submission
- outbox/inbox
- reconciliation job
- dashboard
- runbook

## Success Criteria
- 0 P0 reconciliation mismatch
- p95 latency < 800ms
- duplicate notification rate = 0
- no unresolved divergence after pilot
```

---

## 31. Common Anti-Patterns

### 31.1 Distributed Rewrite

Team says they are doing strangler migration, but actually rebuilds all services before routing traffic.

Symptom:

```text
No production traffic uses new service for months.
```

### 31.2 Database Copy Without Ownership Transfer

Tables are copied to new DB, but legacy remains writer and many consumers still read old DB.

Symptom:

```text
Nobody knows which DB is source of truth.
```

### 31.3 Permanent Facade Logic

Facade starts as router, then accumulates business logic.

Symptom:

```text
Gateway contains validation, workflow branching, authorization exceptions, and data mapping.
```

### 31.4 Dual Writes Without Reconciliation

Operation writes to both legacy and new service, assuming retry solves everything.

Symptom:

```text
Data drift discovered by users, not by system.
```

### 31.5 No Decommission Plan

Old and new systems coexist forever.

Symptom:

```text
Migration increases total complexity permanently.
```

### 31.6 Extracting Technical Layers

Team creates:

```text
UserControllerService
UserBusinessService
UserDataService
```

instead of business capability services.

Symptom:

```text
Every user request still calls every layer across network.
```

### 31.7 Ignoring Reports and Batch Jobs

Interactive UI migrated, but reports/batch still read legacy tables.

Symptom:

```text
Legacy DB cannot be retired.
```

### 31.8 Runtime Upgrade + Architecture Migration + Domain Rewrite Together

Too many variables change simultaneously.

Symptom:

```text
When incident happens, nobody knows whether root cause is runtime, framework, data mapping, service boundary, or business logic.
```

---

## 32. When to Stop Decomposing

Microservices decomposition should stop when marginal benefit is lower than marginal complexity.

Stop splitting when:

1. Service has no independent reason to deploy.
2. Service boundary creates more synchronous chatter than autonomy.
3. Data ownership cannot be separated meaningfully.
4. Team ownership is not distinct.
5. Operational burden exceeds benefit.
6. Testing becomes slower without release independence.
7. Most changes require coordinated release anyway.
8. The service is just a CRUD wrapper over another service.
9. Reliability decreases due to extra network hops.
10. Business capability is too small to justify runtime independence.

Sometimes the best architecture is:

```text
fewer services
stronger modules
clearer ownership
better observability
safer deployment
```

Top 1% engineers are not measured by how many services they create, but by whether each boundary creates net value.

---

## 33. Practical Decision Matrix

| Question | Prefer Modular Monolith | Prefer Extracted Service |
|---|---:|---:|
| Independent deployment needed? | No | Yes |
| Data ownership separable? | No | Yes |
| Scaling profile different? | No | Yes |
| Team ownership separate? | No | Yes |
| Failure isolation valuable? | Maybe | Yes |
| Latency sensitive across boundary? | Yes | No/managed |
| Transaction strongly local? | Yes | Maybe no |
| Domain boundary clear? | No | Yes |
| Operational maturity high? | No | Yes |
| Compliance isolation needed? | Maybe | Yes |

---

## 34. Production Readiness Checklist

Before migration starts:

- [ ] Business objective documented.
- [ ] Candidate boundary selected with rationale.
- [ ] Existing dependency map completed.
- [ ] Existing data ownership map completed.
- [ ] Existing behavior characterized.
- [ ] Contract tests added.
- [ ] Observability baseline captured.
- [ ] Migration owner assigned.
- [ ] Runbook drafted.
- [ ] Cutover criteria agreed.
- [ ] Rollback/roll-forward plan documented.

Before shadow run:

- [ ] Facade/router implemented.
- [ ] Correlation ID propagated.
- [ ] Shadow path side-effect-free.
- [ ] Divergence logging ready.
- [ ] Comparison rules defined.
- [ ] Dashboard ready.
- [ ] Load impact assessed.

Before data migration:

- [ ] Source-to-target mapping documented.
- [ ] Dirty data policy approved.
- [ ] Migration state table ready.
- [ ] Idempotent writer implemented.
- [ ] Dry-run completed.
- [ ] Count/key/checksum validation ready.
- [ ] Semantic reconciliation ready.
- [ ] Temporary data security approved.

Before cutover:

- [ ] P0/P1 mismatches resolved or explicitly accepted.
- [ ] Traffic cohort selected.
- [ ] Feature flag ready.
- [ ] Support team briefed.
- [ ] Alert thresholds configured.
- [ ] Rollback tested.
- [ ] Roll-forward path known.
- [ ] Communication plan ready.

After cutover:

- [ ] Error/latency monitored.
- [ ] Business KPI monitored.
- [ ] Reconciliation run completed.
- [ ] Divergence triaged.
- [ ] Legacy fallback usage checked.
- [ ] Temporary migration permissions removed.
- [ ] Old code path scheduled for deletion.
- [ ] ADR updated.

Before decommission:

- [ ] No active readers.
- [ ] No active writers.
- [ ] No batch/report dependency.
- [ ] No support scripts depend on old table/API.
- [ ] Audit/retention approved.
- [ ] Archive completed.
- [ ] Access revoked.
- [ ] Monitoring removed/updated.
- [ ] Documentation updated.

---

## 35. Architecture Review Questions

Use these questions in a senior/principal-level review.

### 35.1 Why Migrate?

1. What concrete problem does this migration solve?
2. What measurable outcome improves?
3. Why not modularize first?
4. Why not leave this capability in the monolith?
5. What is the cost of not migrating?

### 35.2 Boundary

1. What capability is extracted?
2. What remains in legacy?
3. What data becomes owned by the new service?
4. What invariants remain local?
5. What invariants become distributed?
6. Who owns the service after migration?

### 35.3 Data

1. What is the current source of truth?
2. What is the target source of truth?
3. When does authority transfer?
4. How is data synchronized during transition?
5. How do we detect drift?
6. How do we reconcile drift?
7. What dirty data exists?

### 35.4 Runtime

1. How is traffic routed?
2. Can we route by tenant/user/cohort?
3. Can we rollback route only?
4. What happens if new service is down?
5. What happens if legacy is down?
6. What happens if both disagree?

### 35.5 Operations

1. What dashboard tells us cutover is safe?
2. What alert tells us rollback is needed?
3. What runbook should on-call follow?
4. How do we identify affected records?
5. How do we correct partial failures?
6. How do we report migration status to stakeholders?

### 35.6 Decommission

1. What is the definition of done?
2. When can legacy code be deleted?
3. When can legacy table be archived?
4. Who approves decommission?
5. What evidence proves no dependency remains?

---

## 36. Practical Exercises

### Exercise 1 — Boundary Candidate Selection

Given a legacy system with modules:

```text
Application
Case
Document
Notification
Payment
Audit
Reporting
Profile
```

Pick the first two candidates for extraction. For each candidate, write:

1. Why this candidate?
2. What data does it own?
3. What dependencies exist?
4. What migration seam exists?
5. What is the rollback plan?
6. What is the decommission plan?

### Exercise 2 — Strangler Facade Design

Design a facade that routes:

```text
GET /applications/{id}
POST /applications/{id}/submit
POST /applications/{id}/approve
GET /applications/search
```

For each route, define:

1. Legacy or new initially?
2. Shadow mode possible?
3. Cohort routing key?
4. Fallback behavior?
5. Observability fields?

### Exercise 3 — Data Migration Mapping

Create mapping from legacy status:

```text
N, S, P, A, R, C, X
```

to new domain status:

```text
DRAFT, SUBMITTED, UNDER_REVIEW, APPROVED, REJECTED, CANCELLED, ARCHIVED
```

Then identify:

1. Which mappings are direct?
2. Which require context?
3. Which should block migration?
4. Which should become anomaly?

### Exercise 4 — Reconciliation Plan

Design reconciliation for application migration:

1. Count reconciliation.
2. Key reconciliation.
3. Field reconciliation.
4. Semantic reconciliation.
5. Workflow reconciliation.
6. Audit reconciliation.
7. Severity classification.

### Exercise 5 — Cutover Plan

Write a cutover plan for routing new application submissions to a new service for one agency/tenant.

Include:

1. Pre-check.
2. Feature flag.
3. Monitoring.
4. Rollback trigger.
5. Roll-forward path.
6. Stakeholder communication.
7. Post-cutover reconciliation.

---

## 37. Summary

Microservices migration is not a code extraction exercise. It is a controlled transfer of responsibility, data authority, runtime traffic, operational ownership, and business correctness.

The core lessons:

1. Do not big-bang rewrite unless absolutely necessary.
2. Use Strangler Fig Pattern to reduce migration risk.
3. Pick extraction candidates based on business value, boundary clarity, and risk.
4. Start with seams: API, database, workflow, external integration, report/read model.
5. Use facade/router for gradual traffic movement.
6. Use anti-corruption layer to protect new domain model from legacy semantics.
7. Use branch-by-abstraction to switch implementations safely.
8. Use parallel run and shadow comparison to learn before cutover.
9. Treat data migration as authority transfer, not copying rows.
10. Avoid uncontrolled dual writes.
11. Use outbox, CDC, inbox, idempotency, and reconciliation.
12. Cutover by cohort when possible.
13. Rollback/roll-forward must be specific and tested.
14. Decommission is part of migration, not optional cleanup.
15. Stop decomposing when complexity exceeds benefit.

A top-tier engineer understands that the best microservices migrations are boring in production because the risk has already been designed out.

---

## 38. References

- Martin Fowler — Strangler Fig Application
- Martin Fowler — Rewriting Strangler Fig
- AWS Prescriptive Guidance — Strangler Fig Pattern
- AWS Prescriptive Guidance — Decomposing Monoliths into Microservices
- Azure Architecture Center — Strangler Fig Pattern
- Microservices.io — Database per Service
- Microservices.io — Shared Database
- Microservices.io — Transactional Outbox
- Microservices.io — Saga
- Microservices.io — Transaction Log Tailing
- Microservices.io — Pattern Language for Microservices
- Research: Data Management in Microservices: State of the Practice, Challenges, and Research Directions
- Research: Towards an Architecture-centric Methodology for Migrating to Microservices

---

# Status Seri

Part ini adalah **Part 29 dari 35**.

Seri belum selesai.

Part berikutnya:

```text
Part 30 — Governance, Ownership, and Socio-Technical Architecture
```

Filename berikutnya:

```text
learn-java-microservices-patterns-advanced-engineering-30-governance-ownership-socio-technical-architecture.md
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-microservices-patterns-advanced-engineering-28-caching-patterns.md">⬅️ 0. Tujuan Part Ini</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-microservices-patterns-advanced-engineering-30-governance-ownership-socio-technical-architecture.md">Learn Java Microservices Patterns — Advanced Engineering ➡️</a>
</div>
