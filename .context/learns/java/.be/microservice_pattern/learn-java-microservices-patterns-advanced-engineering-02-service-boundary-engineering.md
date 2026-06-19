# Learn Java Microservices Patterns Advanced Engineering — Part 2
# Service Boundary Engineering

> Seri: `learn-java-microservices-patterns-advanced-engineering`  
> Part: `02` dari `35`  
> File: `learn-java-microservices-patterns-advanced-engineering-02-service-boundary-engineering.md`  
> Target: Java 8 hingga Java 25  
> Level: Advanced / Principal Engineer Track

---

## 0. Posisi Part Ini Dalam Seri

Pada Part 0, kita membangun mental model bahwa microservices bukan tujuan, melainkan strategi mengelola kompleksitas, ownership, evolusi, dan failure isolation.

Pada Part 1, kita membongkar realitas distributed systems: network unreliable, latency tidak nol, partial failure normal, retry bisa memperburuk outage, dan service call bukan sekadar method call yang beda alamat.

Part 2 ini membahas keputusan paling mahal dalam microservices:

> **Di mana sebuah service harus dipotong?**

Service boundary adalah fondasi. Semua pattern lain — API Gateway, Saga, Event-Driven Architecture, Outbox, CQRS, Circuit Breaker, BFF, Service Mesh — hanya menjadi tambalan mahal jika boundary awalnya salah.

Service boundary yang buruk akan menghasilkan:

- distributed monolith,
- shared database hell,
- dependency cycle,
- chatty service,
- team blocking,
- deployment coupling,
- transaction leakage,
- audit ambiguity,
- dan incident yang sulit dianalisis.

Service boundary yang baik akan menghasilkan:

- autonomy,
- local reasoning,
- clearer ownership,
- lower coordination cost,
- independent evolution,
- failure containment,
- stronger regulatory defensibility,
- dan migration path yang lebih aman.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan Part 2, kamu diharapkan mampu:

1. Membedakan boundary teknis, domain, data, workflow, dan ownership.
2. Menilai apakah sebuah service boundary sehat atau berbahaya.
3. Menghindari kesalahan umum seperti entity-service decomposition dan shared database.
4. Mendesain boundary berdasarkan business capability, bounded context, invariant, lifecycle, dan team ownership.
5. Mengidentifikasi coupling tersembunyi sebelum menjadi production problem.
6. Membuat boundary decision record yang bisa dipertanggungjawabkan.
7. Menganalisis boundary untuk sistem enterprise/regulatory/case-management yang kompleks.
8. Menentukan kapan sebuah kandidat service harus dipisah, digabung, atau tetap menjadi modul dalam modular monolith.
9. Memahami trade-off service size: terlalu besar vs terlalu kecil.
10. Menghubungkan boundary dengan Java implementation strategy dari Java 8 sampai Java 25.

---

## 2. Premis Utama

Service boundary bukan hanya pertanyaan:

```text
Service ini namanya apa?
Endpoint-nya apa?
Database table-nya apa?
Repository Java-nya apa?
```

Pertanyaan yang lebih benar adalah:

```text
Perubahan bisnis apa yang harus bisa terjadi secara independen?
Data apa yang hanya boleh dimiliki oleh satu authority?
Invariant apa yang harus dijaga secara transaksional?
Workflow apa yang memang lintas domain?
Tim mana yang akan bertanggung jawab penuh terhadap outcome?
Failure seperti apa yang harus bisa diisolasi?
Audit responsibility-nya ada di mana?
```

Microservices sering gagal karena tim memotong sistem berdasarkan hal yang mudah terlihat:

- table,
- entity,
- controller,
- package,
- UI menu,
- CRUD module,
- atau nama noun dalam requirement.

Padahal boundary yang baik biasanya muncul dari hal yang lebih dalam:

- business capability,
- policy ownership,
- state lifecycle,
- consistency boundary,
- data authority,
- change cadence,
- user journey,
- operational responsibility,
- dan regulatory accountability.

---

## 3. Referensi Konseptual Singkat

Martin Fowler dan James Lewis menjelaskan microservices sebagai kumpulan service kecil yang berjalan dalam proses masing-masing, berkomunikasi dengan mekanisme ringan, dibangun di sekitar business capabilities, dan dapat dideploy secara independen. Mereka juga menekankan decentralized data management sebagai karakteristik penting microservices.[^fowler-microservices]

Fowler juga menjelaskan bounded context sebagai pola strategis DDD untuk membagi domain model besar menjadi beberapa context eksplisit dengan relasi yang jelas.[^fowler-bounded-context]

Microservices.io menekankan bahwa microservices idealnya independently deployable, loosely coupled, biasanya organized around business capabilities, dan sering dimiliki oleh tim kecil.[^microservices-io]

Team Topologies membedakan stream-aligned team, platform team, enabling team, dan complicated-subsystem team. Ini penting karena service boundary tidak bisa dilepaskan dari cognitive load dan ownership tim.[^team-topologies]

Microsoft Azure Architecture Guide menempatkan bounded context sebagai batas domain tempat model tertentu berlaku, dan aggregate sebagai consistency boundary untuk menjaga invariant dalam domain.[^azure-domain-analysis][^azure-tactical-ddd]

Dalam part ini, referensi tersebut tidak kita jadikan dogma, tetapi kita gunakan sebagai dasar untuk membangun decision framework yang praktis.

---

## 4. Kesalahan Pertama: Mengira Service Boundary Sama Dengan Class Boundary

Dalam monolith, boundary bisa berupa:

```text
package
class
module
layer
controller
repository
schema
```

Dalam microservices, boundary menjadi jauh lebih mahal karena boundary tersebut membawa konsekuensi:

```text
network call
serialization
deployment artifact
runtime ownership
data ownership
observability boundary
security boundary
transaction boundary
failure boundary
team boundary
```

Ketika sebuah class salah dipisah, refactor relatif murah.

Ketika sebuah service salah dipisah, konsekuensinya bisa meliputi:

- schema migration,
- event migration,
- API compatibility,
- deployment coordination,
- incident ownership dispute,
- data reconciliation,
- duplicate business logic,
- dan perubahan struktur organisasi.

Karena itu, prinsip pertama:

> **Jangan mendistribusikan sesuatu sebelum kamu memahami boundary konseptualnya.**

Microservices bukan cara untuk menemukan desain. Microservices adalah cara untuk mengoperasionalkan desain yang boundary-nya sudah cukup matang.

---

## 5. Boundary Sebagai Kontrak Mahal

Setiap service boundary adalah kontrak mahal antara dua sisi:

```text
Provider Service  <---- contract ---->  Consumer Service
```

Kontrak itu bukan hanya OpenAPI atau schema event. Kontrak itu mencakup:

1. Data contract.
2. Semantic contract.
3. Latency contract.
4. Availability contract.
5. Consistency contract.
6. Authorization contract.
7. Error contract.
8. Versioning contract.
9. Operational contract.
10. Ownership contract.

Contoh sederhana:

```http
GET /applications/{id}
```

Kelihatannya hanya API query.

Namun secara boundary, API itu menyiratkan:

```text
Siapa authority untuk Application?
Apakah field status boleh dipercaya?
Apakah response konsisten real-time?
Apa arti status APPROVED?
Apakah APPROVED berarti legal final?
Apakah bisa berubah kembali?
Apakah consumer boleh cache?
Berapa lama data boleh stale?
Apa error jika application sedang migrated?
Apa yang terjadi jika caller tidak punya permission?
```

Kalau jawaban atas pertanyaan ini tidak eksplisit, boundary belum matang.

---

## 6. Service Boundary Bukan Tentang Ukuran

Banyak diskusi microservices terjebak di pertanyaan:

```text
Service sebaiknya seberapa kecil?
```

Pertanyaan itu kurang tepat.

Pertanyaan yang lebih kuat:

```text
Apa alasan service ini harus bisa berubah, dideploy, gagal, diskalakan, dan dimiliki secara independen?
```

Service kecil belum tentu baik.

Service besar belum tentu buruk.

Yang buruk adalah service yang boundary-nya tidak sesuai dengan force yang harus ditanggung.

### 6.1 Service Terlalu Besar

Gejala:

- banyak domain rule tidak berhubungan dalam satu service,
- satu release kecil harus regression besar,
- terlalu banyak tim menyentuh service yang sama,
- ownership kabur,
- data model terlalu generik,
- perubahan satu capability merusak capability lain,
- incident triage sulit karena terlalu banyak responsibility.

Risiko:

- service menjadi mini-monolith,
- deployment bottleneck,
- high cognitive load,
- high blast radius.

### 6.2 Service Terlalu Kecil

Gejala:

- setiap user action memanggil banyak service kecil,
- banyak service hanya CRUD wrapper satu table,
- banyak synchronous chain,
- transaction pecah tanpa alasan domain,
- deployment independence tidak nyata,
- observability overhead tinggi,
- test setup terlalu kompleks,
- perubahan requirement kecil butuh koordinasi banyak repo.

Risiko:

- distributed monolith,
- latency meningkat,
- failure surface membesar,
- operational cost naik,
- team makin lambat.

### 6.3 Ukuran Yang Tepat

Service boundary sehat jika:

```text
High cohesion inside.
Low coupling outside.
Clear ownership.
Clear data authority.
Clear invariant boundary.
Clear change reason.
Clear failure boundary.
Clear operational responsibility.
```

---

## 7. Lima Jenis Boundary Yang Harus Dibedakan

Salah satu kesalahan besar dalam desain microservices adalah mencampur semua boundary menjadi satu.

Padahal setidaknya ada lima boundary berbeda.

---

### 7.1 Domain Boundary

Domain boundary menjawab:

```text
Model bisnis mana yang valid dalam context ini?
```

Contoh:

```text
Application Management
Case Management
Compliance
Revenue
Exam
Profile
Document
Notification
Audit
```

Namun nama domain saja belum cukup. Kita harus tahu:

- vocabulary-nya,
- rule-nya,
- lifecycle-nya,
- actor-nya,
- invariant-nya,
- dan policy owner-nya.

Contoh kata `status` bisa berbeda makna:

```text
Application.status = Draft / Submitted / Approved / Rejected
Case.status        = Open / Investigating / Escalated / Closed
Payment.status     = Pending / Paid / Failed / Refunded
Document.status    = Uploaded / Verified / Replaced / Archived
```

Jika semua status dipaksa masuk satu generic `StatusService`, kemungkinan besar itu abstraction yang salah.

---

### 7.2 Data Boundary

Data boundary menjawab:

```text
Siapa authority terhadap data ini?
```

Authority berarti:

- siapa yang boleh membuat data,
- siapa yang boleh mengubah data,
- siapa yang boleh menghapus data,
- siapa yang menentukan validitas data,
- siapa yang bertanggung jawab jika data salah,
- siapa yang menjelaskan data saat audit.

Data ownership bukan berarti service lain tidak boleh menyimpan copy.

Data ownership berarti:

> **Hanya satu service yang menjadi source of authority untuk keputusan mutasi dan makna final data tersebut.**

Service lain boleh punya read model, projection, cache, atau denormalized copy, tetapi copy itu harus diperlakukan sebagai turunan.

---

### 7.3 Transaction Boundary

Transaction boundary menjawab:

```text
Invariant apa yang harus selalu benar dalam satu atomic commit?
```

Contoh invariant lokal:

```text
Application cannot be submitted without mandatory applicant information.
```

Ini cocok berada dalam Application service.

Contoh invariant lintas domain:

```text
Application approval must create a compliance screening case.
```

Ini mungkin tidak harus satu DB transaction. Bisa menjadi eventual invariant dengan outbox + event + process manager.

Kesalahan umum:

```text
Karena business process harus konsisten, semua data harus dalam satu database transaction.
```

Tidak selalu.

Yang benar:

```text
Klasifikasikan invariant terlebih dahulu.
Baru tentukan apakah perlu atomic, eventual, compensatable, atau detective control.
```

---

### 7.4 Workflow Boundary

Workflow boundary menjawab:

```text
Siapa yang mengoordinasikan proses lintas langkah?
```

Contoh:

```text
Submit Application
→ Validate Profile
→ Verify Documents
→ Run Screening
→ Calculate Fee
→ Request Payment
→ Assign Officer
→ Create Case if suspicious
→ Notify Applicant
```

Pertanyaan boundary:

- Apakah workflow ini milik satu domain?
- Apakah workflow ini lintas bounded context?
- Apakah ada human task?
- Apakah ada timer/SLA?
- Apakah ada escalation?
- Apakah ada compensation?
- Apakah ada audit requirement?

Jika workflow lintas domain, jangan sembarang taruh orchestration logic di salah satu service CRUD.

Mungkin butuh:

- process manager,
- saga orchestrator,
- BPMN engine,
- atau dedicated workflow service.

---

### 7.5 Team / Ownership Boundary

Ownership boundary menjawab:

```text
Tim mana yang bisa memahami, mengubah, menjalankan, dan bertanggung jawab atas service ini?
```

Microservices tidak bisa sehat jika ownership-nya hanya di diagram.

Ownership harus nyata:

- siapa on-call,
- siapa menerima alert,
- siapa approve API change,
- siapa maintain backlog,
- siapa jawab incident,
- siapa tahu domain rule,
- siapa punya authority untuk refactor.

Service tanpa owner adalah liability.

Service yang dimiliki banyak tim tanpa aturan jelas adalah coordination hotspot.

---

## 8. Boundary Decision Forces

Ketika menentukan boundary, kamu harus melihat banyak force sekaligus.

Tidak ada satu heuristic yang selalu benar.

Gunakan force berikut.

---

### 8.1 Business Capability

Pertanyaan:

```text
Capability bisnis apa yang disediakan service ini?
```

Contoh capability:

```text
Manage Applications
Assess Eligibility
Collect Payment
Manage Compliance Case
Issue License
Manage Exam Registration
Send Correspondence
Maintain Profile
```

Business capability biasanya lebih stabil daripada UI screen atau database table.

UI bisa berubah.
Table bisa berubah.
Framework bisa berubah.
Capability cenderung bertahan lebih lama.

Boundary berdasarkan capability biasanya lebih sehat daripada boundary berdasarkan layer teknis.

Buruk:

```text
UserControllerService
ValidationService
RepositoryService
EmailUtilService
```

Lebih baik:

```text
ApplicationService
EligibilityService
PaymentService
ComplianceCaseService
LicensingService
CorrespondenceService
```

Tetapi jangan berhenti di nama. Capability harus diuji dengan data, invariant, workflow, dan ownership.

---

### 8.2 Bounded Context

Bounded context menjawab:

```text
Di mana model tertentu berlaku?
```

Dalam satu enterprise system, kata yang sama bisa memiliki arti berbeda.

Contoh `applicant`:

```text
Application context:
- applicant adalah pihak yang mengajukan application.

Compliance context:
- applicant bisa menjadi subject of investigation.

Revenue context:
- applicant bisa menjadi payer.

Profile context:
- applicant adalah person/entity record.
```

Jika satu Java class `Applicant` dipakai semua context, biasanya akan terjadi model pollution:

```java
class Applicant {
    private String name;
    private String uen;
    private String nric;
    private boolean underInvestigation;
    private BigDecimal outstandingFee;
    private List<Document> uploadedDocuments;
    private String examStatus;
    private String licenseStatus;
}
```

Class seperti ini bukan domain model. Ini data dumping ground.

Dalam microservices, bounded context membantu menentukan:

- vocabulary,
- model,
- invariant,
- event,
- API,
- dan ownership.

Namun penting:

> **Bounded context tidak selalu sama dengan satu microservice.**

Satu bounded context bisa diimplementasikan sebagai:

- satu module dalam modular monolith,
- satu service,
- beberapa services,
- atau satu service plus beberapa worker/projection.

Sebaliknya, satu microservice yang mencampur banyak bounded context biasanya berbahaya.

---

### 8.3 Data Ownership

Pertanyaan:

```text
Jika data ini salah, siapa yang bertanggung jawab?
```

Contoh:

```text
Profile Service owns person/entity profile.
Application Service owns application submission and application lifecycle.
Document Service owns document metadata and storage lifecycle.
Payment Service owns payment transaction state.
Compliance Service owns investigation case state.
Audit Service owns immutable audit record.
```

Kesalahan umum:

```text
Semua service boleh update table APPLICATION karena butuh cepat.
```

Ini menghapus boundary.

Bahkan jika schema masih sama karena constraint legacy, ownership harus tetap eksplisit:

```text
Only Application service may mutate APPLICATION core lifecycle columns.
Compliance service may only read via API/event/projection.
```

Jika tidak bisa langsung dipisah secara fisik, minimal pisahkan secara logical ownership dulu.

---

### 8.4 Change Cadence

Pertanyaan:

```text
Bagian mana yang sering berubah bersama?
Bagian mana yang berubah karena alasan berbeda?
```

Jika dua fitur selalu berubah bersama, memisahkannya menjadi service berbeda bisa menambah coordination cost.

Jika dua fitur jarang berubah bersama dan dimiliki stakeholder berbeda, menyatukannya bisa memperlambat evolusi.

Contoh:

```text
Application submission rules berubah sering karena policy.
Payment integration berubah karena provider.
Notification template berubah karena communication team.
Audit retention berubah karena compliance/legal.
```

Mereka punya reason-to-change berbeda. Ini sinyal boundary.

Namun hati-hati:

```text
Sering berubah bersama bukan selalu harus satu service.
```

Bisa jadi sering berubah bersama karena coupling buruk, bukan karena domain cohesion.

---

### 8.5 Transactional Cohesion

Pertanyaan:

```text
Data apa yang harus berubah bersama agar invariant tetap benar?
```

Jika beberapa entity harus selalu konsisten dalam satu atomic transaction, mereka mungkin berada dalam aggregate/service yang sama.

Contoh:

```text
Application submission + application mandatory fields + submission timestamp
```

Mungkin satu transaction.

Tetapi:

```text
Application approved + notification sent + audit generated + external system synced
```

Tidak harus satu transaction. Bisa pakai outbox/event.

Prinsip:

```text
Do not split atomic invariants across services unless you are ready to redesign the invariant.
```

Jika invariant masih dipikirkan sebagai ACID lintas service, boundary belum matang.

---

### 8.6 Failure Isolation

Pertanyaan:

```text
Jika bagian ini down, bagian mana yang boleh tetap hidup?
```

Contoh:

```text
Notification down tidak boleh menghentikan officer dari approving case.
Audit write failure mungkin harus block action jika audit legally mandatory.
Payment provider down mungkin harus membuat application masuk Pending Payment, bukan gagal total.
Search index down tidak boleh menghentikan write operation.
```

Boundary harus membantu isolasi failure.

Jika service A selalu harus hidup agar service B bisa melakukan semua hal, mungkin boundary-nya salah atau communication pattern-nya salah.

---

### 8.7 Scalability Profile

Pertanyaan:

```text
Apakah bagian ini punya load pattern berbeda?
```

Contoh:

```text
Search read traffic tinggi.
Application submission burst saat deadline.
Document upload berat di IO/storage.
Report generation CPU/DB intensive.
Notification burst setelah batch job.
Audit write append-only high volume.
```

Perbedaan scalability profile bisa menjadi alasan memisahkan runtime unit.

Namun jangan jadikan scaling sebagai satu-satunya alasan domain split.

Kadang cukup memisahkan worker atau read replica, bukan membuat bounded context baru.

---

### 8.8 Security and Regulatory Responsibility

Pertanyaan:

```text
Apakah bagian ini punya data sensitivity, audit, retention, atau access-control rule berbeda?
```

Contoh:

```text
Identity data
PII
payment data
audit trail
investigation notes
legal documents
internal officer remarks
external applicant view
```

Jika sensitivitas berbeda jauh, boundary bisa membantu:

- isolate access,
- isolate logs,
- isolate audit,
- isolate data retention,
- isolate encryption policy,
- isolate operational permission.

Namun security boundary yang terlalu halus juga bisa memperbesar complexity.

Harus jelas apakah boundary itu benar-benar mengurangi risk.

---

## 9. Boundary Heuristics Praktis

Berikut heuristic yang bisa digunakan saat architecture review.

---

### 9.1 Split Jika Ada Authority Berbeda

Jika dua bagian punya authority bisnis berbeda, mereka kandidat boundary berbeda.

Contoh:

```text
Application authority: apakah application valid dan submitted.
Payment authority: apakah payment berhasil.
Compliance authority: apakah subject perlu investigation.
License authority: apakah license issued.
```

Jangan buat satu `ApplicationService` yang secara langsung mengubah payment status, compliance decision, dan license issuance tanpa ownership jelas.

---

### 9.2 Split Jika Reason-to-Change Berbeda

Jika dua bagian berubah karena stakeholder berbeda, rule berbeda, atau release pressure berbeda, mereka kandidat split.

Contoh:

```text
Payment provider API berubah karena vendor.
Application eligibility rule berubah karena policy.
Notification wording berubah karena communication guideline.
Audit retention berubah karena legal.
```

Menyatukan semuanya membuat release kecil ikut membawa risiko besar.

---

### 9.3 Split Jika Scaling Profile Berbeda Ekstrem

Contoh:

```text
Document upload membutuhkan throughput storage besar.
Search membutuhkan read latency rendah.
Audit membutuhkan append throughput tinggi.
Report membutuhkan batch processing berat.
```

Namun jangan split hanya karena “mungkin nanti scale”.

Gunakan evidence:

- traffic pattern,
- resource profile,
- deployment pain,
- incident history,
- operational bottleneck.

---

### 9.4 Split Jika Failure Harus Diisolasi

Contoh:

```text
Notification service down tidak boleh membuat core transaction gagal.
Search service down tidak boleh menghentikan case update.
External integration down tidak boleh membuat internal workflow stuck permanen.
```

Split membantu jika disertai async boundary, queue, retry policy, dan fallback yang benar.

Jika tetap synchronous hard dependency, split belum tentu membantu.

---

### 9.5 Split Jika Data Sensitivity Berbeda

Contoh:

```text
public catalog data
internal officer notes
legal investigation records
identity data
audit trail
payment data
```

Boundary dapat mengurangi blast radius security incident.

Tetapi pastikan:

- logs tidak bocor,
- event tidak membawa PII sembarangan,
- cache tenant-aware,
- traces tidak menyimpan sensitive payload.

---

### 9.6 Jangan Split Jika Atomic Invariant Masih Kuat

Jika rule harus dijaga dalam satu transaction, jangan buru-buru split.

Contoh:

```text
Application cannot transition to Submitted unless mandatory fields exist.
```

Jika mandatory fields disimpan di service berbeda dan submit harus memanggil banyak service sinkron, desainnya menjadi rapuh.

Mungkin mandatory fields harus masuk aggregate yang sama, atau harus ada pre-validated snapshot.

---

### 9.7 Jangan Split Jika Hanya CRUD Wrapper

Service yang hanya membungkus satu table tanpa ownership domain biasanya buruk.

Contoh buruk:

```text
UserTableService
AddressTableService
StatusTableService
DocumentTypeService
CountryCodeService
```

Kecuali ada alasan domain kuat, ini cenderung menciptakan distributed database access layer.

---

### 9.8 Jangan Split Jika Setiap Use Case Menjadi Chatty

Jika user journey umum menjadi:

```text
Frontend
→ Service A
→ Service B
→ Service C
→ Service D
→ Service E
→ Service F
```

untuk operasi sederhana, boundary perlu diperiksa.

Mungkin:

- data terlalu terpecah,
- service terlalu entity-based,
- read model tidak tersedia,
- BFF tidak tepat,
- workflow orchestration tersebar,
- atau use case seharusnya berada dalam satu boundary.

---

## 10. Boundary Anti-Patterns

---

### 10.1 Entity Service Anti-Pattern

Ini salah satu anti-pattern paling umum.

Contoh:

```text
ApplicantService
AddressService
DocumentService
StatusService
PaymentService
ApplicationService
```

Tidak semua nama entity salah. Yang salah adalah ketika service hanya merepresentasikan table/entity dan tidak punya business capability utuh.

Gejala:

```text
ApplicationService butuh ApplicantService untuk semua operasi.
ApplicantService butuh AddressService.
AddressService butuh CountryCodeService.
DocumentService butuh ApplicationService.
Semua operasi jadi distributed join.
```

Masalah:

- terlalu chatty,
- transaction pecah,
- ownership kabur,
- high latency,
- high failure surface.

Solusi:

- desain berdasarkan capability dan aggregate,
- buat read model,
- gunakan snapshot data,
- simpan value object di aggregate jika memang bagian dari invariant,
- pisahkan authority vs copy.

---

### 10.2 Shared Database Anti-Pattern

Microservices dengan database bersama sering berubah menjadi distributed monolith.

Gejala:

```text
Service A update table X.
Service B juga update table X.
Service C join table X dan Y langsung.
Service D punya stored procedure lintas domain.
DB trigger menjalankan business logic lintas service.
```

Masalah:

- tidak ada ownership,
- schema change jadi breaking change untuk banyak service,
- hidden coupling,
- audit responsibility kabur,
- transaction boundary bocor,
- deployment independence palsu.

Jika legacy masih shared DB, lakukan transisi bertahap:

```text
1. Tetapkan logical ownership per table/column.
2. Larang write lintas ownership.
3. Ganti direct read dengan API/projection secara bertahap.
4. Tambahkan outbox/CDC untuk published data.
5. Pecah schema/database saat ownership sudah stabil.
```

---

### 10.3 Shared Domain Model Anti-Pattern

Contoh:

```text
common-domain.jar
  Application
  Applicant
  Payment
  Case
  Document
  Officer
```

Semua service menggunakan jar yang sama.

Kelihatannya DRY.

Sebenarnya sering menjadi coupling amplifier.

Masalah:

- perubahan field memaksa semua service upgrade,
- model satu context bocor ke context lain,
- semantic berbeda dipaksa sama,
- backward compatibility sulit,
- release independence hilang.

Yang boleh dishare:

```text
stable technical primitives
serialization helpers
error envelope
pagination abstraction
observability utilities
security context abstraction
```

Yang harus hati-hati dishare:

```text
business entity
aggregate
state transition rule
domain enum
domain validation
```

Untuk domain, lebih aman:

- duplicate model per context,
- map via anti-corruption layer,
- share schema contract, bukan internal domain object.

---

### 10.4 Generic Service Anti-Pattern

Contoh:

```text
WorkflowService
RuleService
ValidationService
ReferenceDataService
CommonService
UtilityService
```

Tidak semua generic service salah. Tetapi sering menjadi tempat semua hal yang tidak punya owner.

Gejala:

- banyak domain bergantung padanya,
- perubahan kecil berdampak besar,
- service menjadi bottleneck,
- domain logic tersebar,
- tidak ada single business owner.

Solusi:

- tarik rule kembali ke owning domain,
- bedakan platform capability vs domain capability,
- jika benar platform service, definisikan contract dan ownership ketat,
- hindari menjadikan service ini “tempat sampah arsitektur”.

---

### 10.5 Layer-Based Service Anti-Pattern

Contoh:

```text
Frontend Service
Business Logic Service
Validation Service
Repository Service
Database Service
```

Ini bukan microservices. Ini layered monolith yang didistribusikan.

Masalah:

- setiap request melewati semua layer via network,
- deployment selalu berantai,
- failure di satu layer mematikan semua capability,
- domain ownership tidak jelas.

Microservices sehat biasanya vertical slice berdasarkan capability, bukan horizontal layer.

---

### 10.6 Cyclic Dependency Anti-Pattern

Contoh:

```text
Application Service → Profile Service
Profile Service → Application Service
Application Service → Compliance Service
Compliance Service → Application Service
```

Cycle menunjukkan boundary tidak jelas.

Cycle bisa terjadi di:

- API calls,
- events,
- database reads,
- shared libraries,
- deployment order,
- test setup,
- team dependency.

Solusi:

- cari authority sebenarnya,
- ubah salah satu arah menjadi event/projection,
- buat process manager,
- ekstrak capability ketiga jika memang ada konsep baru,
- atau gabungkan service jika cohesion sebenarnya kuat.

---

### 10.7 Temporal Coupling Anti-Pattern

Temporal coupling berarti service A hanya bisa bekerja jika service B sedang hidup saat itu juga.

Contoh:

```text
Submit Application harus sync call ke Notification Service.
Approve Case harus sync call ke Audit Search Index.
Upload Document harus sync call ke Email Template Service.
```

Tidak semua synchronous call salah.

Tetapi jika dependency bukan bagian dari decision critical path, sebaiknya jangan membuat core operation bergantung pada availability dependency tersebut.

Gunakan:

- outbox,
- async event,
- queue,
- retry worker,
- eventual projection,
- fallback state.

---

### 10.8 UI Menu-Based Service Anti-Pattern

Contoh:

```text
DashboardService
AdminPageService
ApplicationPageService
OfficerPageService
```

UI screen sering berubah lebih cepat daripada domain boundary.

BFF boleh mengikuti experience layer, tetapi core service tidak boleh didesain berdasarkan menu.

Bedakan:

```text
Experience boundary: what the user journey needs.
Domain boundary: who owns truth and rules.
```

---

## 11. Boundary Design Method: Step-by-Step

Berikut metode praktis yang bisa digunakan saat mendesain microservices dari awal atau saat memecah monolith.

---

### Step 1 — Petakan Business Capabilities

Buat daftar capability, bukan daftar table.

Contoh regulatory platform:

```text
Identity and Access
Profile Management
Application Intake
Application Assessment
Eligibility Evaluation
Document Management
Payment and Revenue
Compliance Screening
Case Management
Investigation
Correspondence
Notification
Exam Management
License Issuance
Appeal Management
Audit Trail
Reporting
```

Untuk setiap capability, jawab:

```text
Apa outcome bisnisnya?
Siapa aktornya?
Siapa stakeholdernya?
Apa data authority-nya?
Apa lifecycle-nya?
Apa failure impact-nya?
Apa regulatory concern-nya?
```

---

### Step 2 — Identifikasi Vocabulary Conflict

Cari kata yang sama tetapi maknanya berbeda.

Contoh:

```text
case
status
officer
applicant
approval
submission
screening
assessment
renewal
document
```

Jika makna berbeda per context, jangan paksa satu model.

Contoh:

```text
Case di Compliance ≠ Case di Support Feedback.
Assessment di Application ≠ Assessment di Exam.
Approval di Payment ≠ Approval di License.
```

Vocabulary conflict adalah sinyal bounded context.

---

### Step 3 — Petakan Lifecycle

Untuk setiap domain object penting, gambar state lifecycle.

Contoh Application:

```text
Draft
→ Submitted
→ Under Assessment
→ Pending Clarification
→ Approved
→ Rejected
→ Withdrawn
→ Expired
```

Contoh Compliance Case:

```text
Created
→ Assigned
→ Investigating
→ Escalated
→ Enforcement Action Proposed
→ Closed
→ Reopened
```

Pertanyaan:

```text
Apakah lifecycle ini dimiliki satu domain?
Apakah transition membutuhkan data domain lain?
Apakah transition punya audit/legal effect?
Apakah ada human task?
Apakah ada SLA/timer?
```

Jika lifecycle berbeda, jangan campur dalam satu status table generic.

---

### Step 4 — Klasifikasikan Invariant

Untuk setiap rule, klasifikasikan:

```text
Local invariant
Cross-service invariant
Eventual invariant
Compensatable invariant
Detective invariant
Legal/audit invariant
```

Contoh:

| Rule | Jenis | Implikasi Boundary |
|---|---|---|
| Application cannot be submitted without mandatory fields | Local invariant | Application aggregate/service |
| Payment must be completed before license issued | Cross-service/eventual invariant | Process manager/saga |
| Notification must be sent after approval | Eventual invariant | Async event |
| Incorrect fee can be adjusted by refund | Compensatable invariant | Compensation workflow |
| Every officer decision must be audited | Legal/audit invariant | Audit write may be critical path |

Jangan split rule atomic tanpa desain konsistensi baru.

---

### Step 5 — Tentukan Data Authority

Buat tabel authority:

| Data | Owner | Allowed Mutator | Published As | Consumer |
|---|---|---|---|---|
| Applicant profile | Profile Service | Profile Service | ProfileUpdated event / API | Application, Case |
| Application lifecycle | Application Service | Application Service | ApplicationSubmitted/Approved events | Case, Notification, Report |
| Payment status | Payment Service | Payment Service | PaymentCompleted event | Application, Revenue |
| Compliance case | Compliance Service | Compliance Service | CaseCreated/Closed events | Application, Report |
| Audit record | Audit Service | Audit Service | Query API / archive export | Compliance, Admin |

Authority table memaksa diskusi eksplisit.

Tanpa authority table, shared database biasanya akan kembali muncul.

---

### Step 6 — Analisis Communication Path

Untuk setiap use case, gambar call/event path.

Contoh submit application:

```text
Applicant UI
→ Application Service
  → validate local application data
  → persist Submitted
  → write ApplicationSubmitted outbox
→ Event Bus
  → Document Verification Projection
  → Screening Service
  → Notification Service
  → Reporting Projection
```

Pertanyaan:

```text
Mana yang harus sync?
Mana yang boleh async?
Mana yang critical path?
Mana yang side effect?
Mana yang bisa retry?
Mana yang harus idempotent?
Mana yang bisa stale?
```

Boundary yang baik biasanya mengurangi sync dependency di critical path.

---

### Step 7 — Petakan Team Ownership

Untuk setiap kandidat service:

```text
Siapa owner?
Apakah owner paham domain?
Apakah owner bisa deploy tanpa approval banyak tim?
Apakah owner punya observability?
Apakah owner punya runbook?
Apakah owner bisa on-call?
Apakah cognitive load wajar?
```

Jika tidak ada owner, jangan buat service baru.

Microservice tanpa ownership adalah operational debt.

---

### Step 8 — Uji Dengan Change Scenario

Ambil skenario perubahan nyata.

Contoh:

```text
Policy changes eligibility rule.
Payment provider changes API.
Regulator changes audit retention.
New document type added.
New escalation rule added.
New external integration added.
Need to support new application type.
```

Untuk setiap scenario, tanya:

```text
Service mana berubah?
Contract mana berubah?
Database mana berubah?
Event mana berubah?
Tim mana terlibat?
Apakah deployment bisa independen?
Apakah test impact lokal atau global?
```

Boundary sehat membuat perubahan umum tetap lokal.

---

### Step 9 — Uji Dengan Failure Scenario

Contoh:

```text
Payment provider down.
Notification queue stuck.
Profile service slow.
Document storage unavailable.
Search index stale.
Audit database full.
Compliance service processing lag.
```

Untuk setiap failure, tanya:

```text
Apa yang tetap bisa berjalan?
Apa yang harus dihentikan?
Apa fallback state?
Apa retry policy?
Apa user-visible state?
Apa alert?
Siapa owner incident?
```

Boundary sehat membuat failure behavior eksplisit.

---

### Step 10 — Buat Boundary Decision Record

Setiap boundary penting harus punya decision record.

Template:

```markdown
# Boundary Decision Record: <Service Name>

## Context
Masalah domain dan operasional yang ingin diselesaikan.

## Decision
Boundary yang dipilih.

## Owned Capabilities
Capability yang dimiliki.

## Owned Data
Data authority.

## Local Invariants
Invariant yang dijaga secara atomic.

## Published Contracts
API/event/read model yang diekspos.

## Dependencies
Dependency sync/async.

## Non-Goals
Hal yang sengaja tidak dimiliki.

## Alternatives Considered
Pilihan lain dan alasan ditolak.

## Failure Model
Apa yang terjadi jika service/dependency gagal.

## Evolution Plan
Bagaimana boundary bisa berubah di masa depan.
```

Boundary tanpa decision record sering menjadi folklore.

Folklore akan hilang saat orang resign, project pindah vendor, atau incident besar terjadi.

---

## 12. Boundary Candidate Evaluation Matrix

Gunakan matrix berikut saat menilai kandidat service.

| Dimension | Pertanyaan | Score 1 | Score 5 |
|---|---|---:|---:|
| Business capability | Apakah capability jelas? | CRUD/table wrapper | Outcome bisnis jelas |
| Data ownership | Apakah authority jelas? | Shared write | Single owner jelas |
| Invariant cohesion | Apakah invariant lokal jelas? | Rule tersebar | Rule cohesive |
| Change independence | Apakah berubah karena alasan sendiri? | Selalu ikut service lain | Change cadence mandiri |
| Deployment independence | Bisa deploy sendiri? | Harus koordinasi banyak service | Bisa deploy aman |
| Failure isolation | Failure bisa diisolasi? | Down cascade | Degrade/contain |
| Team ownership | Owner jelas? | Banyak/no owner | Satu accountable owner |
| Communication cost | Interaksi efisien? | Chatty sync calls | Contract jelas, path pendek |
| Operational maturity | Bisa dimonitor/on-call? | Tidak ada runbook | SLO, alert, runbook jelas |
| Security boundary | Risk isolation jelas? | Data bocor lintas context | Access/audit jelas |

Interpretasi:

```text
0–20   : Jangan jadikan microservice. Pertimbangkan module.
21–35  : Boundary belum matang. Perlu refactor konseptual.
36–45  : Kandidat microservice cukup kuat.
46–50  : Boundary sangat kuat, layak menjadi service mandiri.
```

Matrix ini bukan hukum. Ini alat diskusi.

---

## 13. Service Boundary Dalam Regulatory / Case Management System

Untuk sistem regulatory/case management, boundary harus lebih hati-hati dibanding e-commerce biasa.

Alasannya:

- auditability penting,
- legal defensibility penting,
- lifecycle panjang,
- human task dominan,
- escalation rule kompleks,
- data sensitivity tinggi,
- state transition harus dapat dijelaskan,
- historical decision harus immutable atau traceable,
- correction/appeal/reopen harus jelas.

---

### 13.1 Contoh Kandidat Domain

```text
Application Management
Profile Management
Document Management
Screening
Compliance Case Management
Enforcement Action
Appeal Management
Correspondence
Notification
Revenue
Audit Trail
Reporting
```

Jangan langsung anggap semua ini service.

Uji satu per satu.

---

### 13.2 Application Management Boundary

Owned capability:

```text
Manage lifecycle of submitted applications.
```

Owned data:

```text
Application core data
Application status
Submission timestamp
Applicant snapshot at submission
Application assessment local result
```

Local invariant:

```text
Application cannot be submitted if mandatory fields incomplete.
Application cannot move from Draft to Approved directly.
Submitted application must have immutable submission snapshot.
```

Published events:

```text
ApplicationSubmitted
ApplicationWithdrawn
ApplicationApproved
ApplicationRejected
ApplicationClarificationRequested
```

Non-goals:

```text
Does not own payment settlement.
Does not own compliance investigation.
Does not own immutable audit storage.
Does not own notification delivery.
```

Boundary risk:

```text
If Application service also owns payment, compliance, document verification, and notification, it becomes god service.
```

---

### 13.3 Compliance Case Boundary

Owned capability:

```text
Manage compliance investigation lifecycle.
```

Owned data:

```text
Case state
Assignment
Investigation notes
Finding
Escalation
Closure decision
```

Local invariant:

```text
Closed case cannot be modified except through reopen transition.
Escalated case must have escalation reason.
Investigation note must be associated with actor and timestamp.
```

Published events:

```text
ComplianceCaseCreated
ComplianceCaseAssigned
ComplianceCaseEscalated
ComplianceCaseClosed
ComplianceCaseReopened
```

Non-goals:

```text
Does not own application submission truth.
Does not own applicant master profile.
Does not own license issuance.
```

Boundary risk:

```text
Compliance service may need application snapshot, but should not directly mutate application lifecycle unless via explicit command/process.
```

---

### 13.4 Audit Trail Boundary

Audit is special.

Audit can be:

1. Cross-cutting technical logging.
2. Legal record of business decision.
3. Security trail.
4. Operational trace.

Do not mix all blindly.

Audit service may own:

```text
Immutable audit record
Audit query model
Audit export/archive
Retention policy
Evidence chain
```

But business service must still understand what action it performed.

Bad design:

```text
Business service sends vague message: "user clicked button".
Audit service tries to infer business meaning.
```

Better:

```text
Business service records semantically meaningful audit event:
"APPLICATION_APPROVED", actor, subject, before state, after state, reason, correlation id.
```

Question:

```text
If audit write fails, should business action fail?
```

Answer depends on legal criticality.

For legally mandatory decision audit, audit may be in critical path or strongly guaranteed via local outbox.

---

## 14. Boundary and Java Code Structure

Boundary architecture must appear in Java code.

Jika diagram bilang service boundary jelas tetapi code memiliki shared domain jar besar, repository lintas domain, dan DTO bocor, desain sebenarnya tidak jelas.

---

### 14.1 Java Package Boundary Dalam Service

Contoh struktur service sehat:

```text
com.example.application
  ApplicationServiceApplication.java

com.example.application.domain
  Application.java
  ApplicationStatus.java
  ApplicationTransition.java
  ApplicationPolicy.java
  ApplicationSubmitted.java

com.example.application.usecase
  SubmitApplicationUseCase.java
  ApproveApplicationUseCase.java
  WithdrawApplicationUseCase.java

com.example.application.port.in
  SubmitApplicationCommand.java
  ApproveApplicationCommand.java

com.example.application.port.out
  ApplicationRepository.java
  EventPublisher.java
  AuditRecorder.java

com.example.application.adapter.web
  ApplicationController.java
  ApplicationDto.java

com.example.application.adapter.persistence
  JpaApplicationRepository.java
  ApplicationEntity.java

com.example.application.adapter.messaging
  ApplicationEventPublisher.java
```

Boundary internal:

```text
domain tidak bergantung ke web/persistence/messaging.
usecase mengorkestrasi domain + ports.
adapter menerjemahkan external contract.
```

Ini bukan wajib hexagonal, tetapi prinsipnya:

> **Domain boundary harus terlihat dalam dependency direction.**

---

### 14.2 Jangan Bocorkan Entity Persistence Sebagai Contract

Buruk:

```java
@RestController
class ApplicationController {
    @GetMapping("/applications/{id}")
    ApplicationEntity get(@PathVariable Long id) {
        return repository.findById(id).orElseThrow();
    }
}
```

Masalah:

- persistence schema menjadi API contract,
- lazy loading bisa bocor,
- field internal terekspos,
- compatibility sulit,
- consumer tergantung struktur database.

Lebih baik:

```java
public record ApplicationResponse(
        String applicationId,
        String status,
        String applicantName,
        Instant submittedAt,
        long version
) {}
```

DTO adalah boundary contract.

Domain object dan entity persistence adalah internal.

---

### 14.3 Domain Event Internal vs Integration Event

Internal domain event:

```java
public record ApplicationSubmitted(
        ApplicationId applicationId,
        ApplicantSnapshot applicantSnapshot,
        Instant submittedAt
) implements DomainEvent {}
```

Integration event:

```java
public record ApplicationSubmittedV1(
        String eventId,
        String correlationId,
        String applicationId,
        String applicantId,
        String applicationType,
        String submittedAt
) {}
```

Jangan selalu publish domain object langsung sebagai event eksternal.

Alasannya:

- domain model bisa berubah,
- event contract harus versioned,
- event consumer butuh stability,
- internal detail tidak boleh bocor.

---

### 14.4 Java 8 Hingga 25 Consideration

#### Java 8

Kondisi umum:

- banyak enterprise legacy masih Java 8,
- belum ada records,
- belum ada sealed classes,
- CompletableFuture sudah ada,
- Stream API tersedia,
- modularity belum ada.

Implication:

- DTO memakai immutable class manual,
- value object perlu discipline manual,
- domain transition bisa memakai enum + strategy,
- package boundary lebih bergantung pada convention dan build module.

#### Java 11

Kondisi umum:

- baseline modern minimal untuk banyak platform,
- HttpClient tersedia,
- var untuk local variable,
- improved runtime/container support dibanding Java 8.

Implication:

- service-to-service client bisa memakai JDK HttpClient jika sederhana,
- masih belum records/sealed final.

#### Java 17

Kondisi umum:

- LTS yang sangat kuat,
- records stable,
- sealed classes stable,
- pattern matching mulai matang bertahap.

Implication:

- DTO contract lebih ringkas dengan records,
- command/event type lebih eksplisit,
- state machine bisa lebih aman dengan sealed hierarchy.

Contoh:

```java
public sealed interface ApplicationCommand
        permits SubmitApplication, ApproveApplication, RejectApplication {
}

public record SubmitApplication(String applicationId) implements ApplicationCommand {}
public record ApproveApplication(String applicationId, String officerId) implements ApplicationCommand {}
public record RejectApplication(String applicationId, String officerId, String reason) implements ApplicationCommand {}
```

#### Java 21

Kondisi umum:

- virtual threads stable,
- structured concurrency masih preview/incubator tergantung rilis,
- modern server runtime makin nyaman untuk blocking IO.

Implication:

- synchronous service code bisa lebih sederhana untuk IO-bound workload,
- tetapi virtual threads tidak menghapus distributed-systems problem,
- boundary tetap harus benar.

Virtual threads membantu execution model, bukan memperbaiki boundary salah.

#### Java 25

Kondisi umum:

- generasi terbaru Java setelah Java 21,
- lebih banyak language/runtime improvement,
- cocok untuk service baru jika platform organisasi siap.

Implication:

- desain boundary tetap framework/runtime agnostic,
- gunakan fitur bahasa untuk memperkuat expressiveness,
- jangan menjadikan upgrade Java sebagai pengganti architecture discipline.

---

## 15. Boundary Dalam Build dan Repository Strategy

Service boundary juga tercermin dalam repository dan build.

Pilihan umum:

```text
monorepo
multi-repo
hybrid repo
```

### 15.1 Monorepo

Kelebihan:

- refactor lintas service lebih mudah,
- shared tooling konsisten,
- dependency visibility tinggi,
- atomic change possible.

Risiko:

- boundary bisa kabur,
- semua tim merasa boleh mengubah semua,
- build bisa berat,
- ownership perlu enforcement.

Butuh:

- module ownership,
- CODEOWNERS,
- build isolation,
- dependency rules,
- contract tests.

### 15.2 Multi-Repo

Kelebihan:

- ownership eksplisit,
- deployment independence lebih alami,
- access control lebih mudah,
- service lifecycle mandiri.

Risiko:

- duplicate tooling,
- contract drift,
- version coordination,
- cross-repo refactor sulit.

Butuh:

- platform standards,
- template service,
- dependency governance,
- API/event registry,
- automation.

### 15.3 Hybrid

Contoh:

```text
core domain services in separate repos
platform libraries in shared repos
deployment manifests in environment repo
contract schemas in registry repo
```

Tidak ada pilihan universal.

Yang penting:

```text
Repository strategy harus mendukung boundary, bukan menyembunyikan boundary yang buruk.
```

---

## 16. Boundary Smell Checklist

Gunakan checklist ini untuk mendeteksi boundary bermasalah.

### 16.1 Data Smells

- Banyak service update table yang sama.
- Banyak service membaca database service lain langsung.
- Foreign key lintas service ownership.
- Stored procedure berisi business logic lintas domain.
- Shared enum table menjadi dependency semua domain.
- Tidak ada data authority jelas.

### 16.2 API Smells

- API terlalu chatty.
- API hanya mirror table.
- Response mengandung semua field karena consumer tidak jelas.
- Error contract tidak jelas.
- Consumer butuh tahu internal status provider.
- API berubah setiap kali database berubah.

### 16.3 Event Smells

- Event bernama terlalu teknis: `DataUpdated`, `StatusChanged`.
- Event payload terlalu besar.
- Event payload terlalu kecil dan memaksa consumer call back.
- Tidak ada schema version.
- Tidak ada event owner.
- Consumer mengandalkan urutan event tanpa guarantee.

### 16.4 Team Smells

- Tidak ada owner tunggal.
- Banyak tim harus approve perubahan kecil.
- Service dibuat oleh platform team tetapi logic-nya domain-specific.
- On-call tidak tahu business meaning alert.
- Dokumentasi ownership tidak sesuai realita.

### 16.5 Runtime Smells

- Satu service down menyebabkan semua use case mati.
- Deployment service A selalu harus deploy service B.
- Integration test environment wajib semua service hidup.
- Tidak ada graceful degradation.
- Retry policy dibuat di banyak tempat tanpa koordinasi.

### 16.6 Domain Smells

- Domain object terlalu generic.
- Status dipakai lintas context tanpa semantic jelas.
- Rule tersebar di banyak service.
- Workflow logic tersebar di controller.
- Audit event tidak punya business meaning.

---

## 17. Split, Merge, atau Modularize?

Tidak semua masalah boundary harus diselesaikan dengan membuat service baru.

Ada tiga opsi utama:

```text
Split into service.
Merge services.
Keep as module.
```

---

### 17.1 Kapan Split Menjadi Service

Split jika:

- ownership jelas,
- data authority jelas,
- capability jelas,
- deployment independence bernilai,
- scaling/failure/security profile berbeda,
- contract bisa distabilkan,
- team mampu mengoperasikan,
- communication cost acceptable.

---

### 17.2 Kapan Merge Service

Merge jika:

- selalu berubah bersama,
- selalu deploy bersama,
- selalu sync call satu sama lain,
- invariant terlalu kuat,
- ownership sama,
- service terlalu kecil,
- operational cost lebih besar dari benefit,
- tidak ada alasan bisnis/operasional untuk independen.

Merge bukan kegagalan.

Merge bisa menjadi keputusan arsitektur yang matang.

Top-tier engineer tidak fanatik split.

---

### 17.3 Kapan Tetap Modular Monolith

Modular monolith cocok jika:

- domain masih berubah cepat,
- boundary belum jelas,
- team kecil,
- deployment independence belum critical,
- operational maturity belum cukup,
- latency/transaction simplicity lebih penting,
- sistem masih mencari product-market/domain fit.

Modular monolith yang disiplin sering lebih baik daripada microservices prematur.

Prinsip:

```text
Start with modularity.
Distribute only when the boundary earns it.
```

---

## 18. Boundary Review Questions Untuk Senior/Principal Engineer

Gunakan pertanyaan ini dalam architecture review.

### 18.1 Business and Domain

1. Business capability apa yang dimiliki service ini?
2. Apa vocabulary yang unik dalam boundary ini?
3. Apa yang sengaja tidak dimiliki service ini?
4. Apakah bounded context-nya jelas?
5. Apakah ada concept yang dipakai dengan makna berbeda di context lain?

### 18.2 Data and Consistency

1. Data apa yang menjadi source of authority?
2. Service lain boleh membaca lewat apa?
3. Service lain boleh menyimpan copy atau tidak?
4. Invariant apa yang harus atomic?
5. Invariant apa yang boleh eventual?
6. Apa reconciliation mechanism-nya?

### 18.3 Communication

1. API apa yang disediakan?
2. Event apa yang dipublish?
3. Command apa yang diterima?
4. Mana dependency sync?
5. Mana dependency async?
6. Apa timeout dan retry expectation?
7. Apa idempotency strategy?

### 18.4 Failure

1. Jika service ini down, siapa terdampak?
2. Jika dependency lambat, apa yang terjadi?
3. Apa fallback behavior?
4. Apa blast radius-nya?
5. Siapa owner incident?
6. Alert apa yang harus ada?

### 18.5 Evolution

1. Perubahan apa yang bisa dilakukan independen?
2. Perubahan apa yang tetap butuh koordinasi?
3. Bagaimana API/event versioning?
4. Bagaimana data migration?
5. Bagaimana rollback?
6. Bagaimana deprecation?

### 18.6 Organization

1. Tim mana owner?
2. Apakah cognitive load realistis?
3. Apakah ada runbook?
4. Apakah tim punya permission deploy?
5. Apakah service ini punya SLO?

---

## 19. Worked Example: Memecah Application dan Compliance

Misalkan ada monolith dengan modul:

```text
Application
Applicant
Document
Payment
Screening
Compliance Case
Notification
Audit
Report
```

Requirement:

```text
Saat application submitted, sistem harus melakukan screening.
Jika risk tinggi, compliance case dibuat.
Applicant tetap bisa melihat application status.
Officer compliance bisa melakukan investigation.
Semua keputusan harus diaudit.
Notification dikirim ke applicant.
```

---

### 19.1 Desain Buruk

```text
ApplicationService.submit()
  → ProfileService.getApplicant()
  → DocumentService.validateDocuments()
  → PaymentService.checkPayment()
  → ScreeningService.runScreening()
  → ComplianceService.createCaseIfNeeded()
  → NotificationService.sendEmail()
  → AuditService.writeAudit()
```

Masalah:

- terlalu banyak sync dependency,
- submit gagal jika notification down,
- slow screening membuat user menunggu,
- compliance creation coupling kuat,
- retry bisa duplicate case/email,
- audit ambiguity,
- transaction tidak jelas.

---

### 19.2 Desain Lebih Sehat

Critical path submit:

```text
ApplicationService.submit()
  - validate local application invariant
  - persist Submitted
  - persist applicant snapshot
  - write ApplicationSubmitted outbox
  - return Submitted response
```

Async path:

```text
ApplicationSubmitted event
  → ScreeningService consumes
      - run screening
      - publish ScreeningCompleted

ScreeningCompleted event
  → ComplianceProcessManager consumes
      - if high risk, command ComplianceService.createCase
      - publish ComplianceCaseCreated

ApplicationSubmitted event
  → NotificationService sends acknowledgement

ApplicationSubmitted event
  → ReportingProjection updates read model

ApplicationSubmitted event
  → AuditRecorder records semantically meaningful audit
```

Pertanyaan legal:

```text
Apakah audit untuk submission harus dijamin sebelum response sukses?
```

Jika ya:

```text
ApplicationService writes audit event to local outbox in same transaction.
Audit delivery async, but audit intent durable.
```

Ini menjaga critical path tetap pendek sekaligus durable.

---

### 19.3 Boundary Yang Muncul

```text
Application Service
- owns application lifecycle
- owns submission invariant
- publishes application lifecycle events

Screening Service
- owns screening algorithm/result
- may maintain screening history

Compliance Service
- owns compliance case lifecycle
- owns investigation notes and closure

Notification Service
- owns delivery attempt and template execution
- does not own business truth

Audit Service
- owns immutable audit store and query/export
- may consume business audit events

Reporting Service
- owns read model/reporting projection
- not authority for write decisions
```

---

## 20. Boundary and Regulatory Defensibility

Dalam sistem regulasi, boundary harus bisa menjawab:

```text
Who made the decision?
Based on what data?
Under which rule version?
At what time?
Was the actor authorized?
Was the state transition valid?
Was the decision audit-recorded?
Can we reconstruct the lifecycle?
Can we prove no unauthorized mutation happened?
```

Boundary yang buruk membuat jawaban ini tersebar:

```text
status di Application table,
actor di audit table,
reason di comment table,
rule version di config table,
decision di compliance table,
notification di email log,
manual override di admin table.
```

Boundary yang baik menyusun evidence chain:

```text
Command received
→ authorization checked
→ transition rule evaluated
→ state changed
→ domain event emitted
→ audit intent recorded
→ integration events published
→ read models updated
```

Setiap langkah punya owner.

---

## 21. Practical Boundary Documentation

Minimal dokumentasi setiap service:

```markdown
# Service: Application Management

## Purpose
Manages application lifecycle from draft/submission to approval/rejection.

## Owns
- Application lifecycle state
- Submission snapshot
- Application assessment decision

## Does Not Own
- Applicant master profile
- Payment settlement
- Compliance investigation
- Notification delivery

## Local Invariants
- Draft can be submitted only if mandatory fields complete.
- Submitted application cannot be edited without clarification transition.
- Approved application cannot return to Draft.

## APIs
- POST /applications/{id}/submit
- POST /applications/{id}/approve
- GET /applications/{id}

## Events Published
- ApplicationSubmitted.v1
- ApplicationApproved.v1
- ApplicationRejected.v1

## Consumes
- PaymentCompleted.v1
- ScreeningCompleted.v1

## Failure Behavior
- Notification failure does not block submission.
- Audit intent is persisted in local transaction.
- Screening delay results in Pending Screening state.

## Owner
Application platform team / regulatory intake team.
```

Dokumentasi seperti ini lebih berguna daripada diagram yang indah tetapi tidak menjawab ownership.

---

## 22. Production Readiness Checklist

Sebelum sebuah boundary dijadikan microservice production, jawab checklist ini.

### 22.1 Domain Readiness

- [ ] Capability jelas.
- [ ] Bounded context jelas.
- [ ] Vocabulary jelas.
- [ ] Non-goals jelas.
- [ ] State lifecycle jelas.
- [ ] Invariant lokal jelas.
- [ ] Cross-service invariant jelas.

### 22.2 Data Readiness

- [ ] Data authority jelas.
- [ ] Mutator tunggal jelas.
- [ ] Read model/projection strategy jelas.
- [ ] Schema versioning strategy jelas.
- [ ] Data retention jelas.
- [ ] Audit requirement jelas.

### 22.3 Contract Readiness

- [ ] API contract jelas.
- [ ] Event contract jelas.
- [ ] Error contract jelas.
- [ ] Idempotency contract jelas.
- [ ] Versioning policy jelas.
- [ ] Compatibility test tersedia.

### 22.4 Runtime Readiness

- [ ] Timeout policy jelas.
- [ ] Retry policy jelas.
- [ ] Circuit breaker/bulkhead jika perlu.
- [ ] Health check bermakna.
- [ ] Metrics tersedia.
- [ ] Logs punya correlation id.
- [ ] Traces tersedia untuk critical path.

### 22.5 Ownership Readiness

- [ ] Owner team jelas.
- [ ] Runbook tersedia.
- [ ] Alert owner jelas.
- [ ] Deployment owner jelas.
- [ ] Support escalation jelas.
- [ ] ADR/boundary decision record tersedia.

Jika banyak item belum terpenuhi, mungkin boundary belum layak menjadi microservice.

---

## 23. Mental Model Ringkas

Ingat model ini:

```text
A service is not a table.
A service is not a controller.
A service is not a repository.
A service is not a deployment artifact only.

A service is an owned business capability
with its own model,
its own data authority,
its own local invariants,
its own contracts,
its own failure behavior,
and its own operational responsibility.
```

Jika tidak punya semua itu, mungkin ia belum layak menjadi service.

---

## 24. Latihan Praktis

### Latihan 1 — Boundary Smell Analysis

Ambil satu sistem yang kamu kenal.

Buat daftar service/module yang ada.

Untuk setiap service, isi:

```text
Capability:
Owned data:
Local invariant:
Published API:
Published event:
Owner:
Main dependency:
Boundary smell:
```

Tandai service yang:

- hanya CRUD wrapper,
- shared database,
- sync dependency terlalu banyak,
- tidak punya owner jelas,
- sering deploy bersama service lain.

---

### Latihan 2 — Data Authority Table

Buat authority table untuk 10 data penting.

Format:

| Data | Owner | Who Can Mutate | Who Can Read | Publication Mechanism | Audit Requirement |
|---|---|---|---|---|---|

Tujuannya bukan tabel cantik.

Tujuannya menemukan konflik ownership.

---

### Latihan 3 — Use Case Critical Path

Ambil satu use case penting, misalnya:

```text
Submit Application
Approve Case
Issue License
Process Payment
Create Appeal
```

Gambar path saat ini.

Lalu pisahkan:

```text
critical synchronous decision
async side effect
durable event
read model update
notification
external integration
```

Cari dependency yang tidak seharusnya ada di critical path.

---

### Latihan 4 — Split or Merge Decision

Pilih dua service yang sering saling memanggil.

Jawab:

```text
Apakah mereka punya owner sama?
Apakah mereka selalu berubah bersama?
Apakah invariant-nya atomic?
Apakah data authority terpisah?
Apakah failure harus diisolasi?
Apakah deployment independence nyata?
```

Putuskan:

```text
keep separate
merge
or convert one into internal module/projection
```

---

## 25. Ringkasan

Service boundary adalah keputusan paling penting dalam microservices.

Boundary yang baik tidak ditentukan oleh ukuran service, jumlah endpoint, atau nama entity. Boundary yang baik ditentukan oleh:

- business capability,
- bounded context,
- data ownership,
- local invariant,
- workflow responsibility,
- change cadence,
- failure isolation,
- team ownership,
- security/regulatory responsibility,
- dan operational maturity.

Kesalahan boundary tidak bisa diselesaikan hanya dengan API Gateway, Kafka, Kubernetes, Spring Cloud, service mesh, atau observability stack.

Tool hanya membantu jika boundary konseptualnya benar.

Prinsip terpenting part ini:

```text
Start modular.
Understand the domain.
Make ownership explicit.
Split only when independence has real value.
Never distribute unclear boundaries.
```

---

## 26. Checklist Top 1% Engineer

Seorang engineer biasa bertanya:

```text
Service ini pakai REST atau Kafka?
```

Engineer yang lebih matang bertanya:

```text
Apa boundary-nya?
Siapa owner datanya?
Invariant apa yang harus atomic?
Apa yang boleh eventual?
Apa failure behavior-nya?
Apa deployment independence yang kita dapat?
Apa cost operationalnya?
Apa yang terjadi saat service ini lambat, bukan hanya down?
Apa yang terjadi saat rule berubah?
Apa yang terjadi saat audit meminta evidence?
```

Engineer top-tier mampu mengatakan:

```text
Jangan dibuat microservice dulu.
Boundary-nya belum matang.
Jadikan module dulu, stabilkan model dan ownership, baru split ketika ada pressure nyata.
```

Kemampuan menolak microservice yang salah sama pentingnya dengan kemampuan membangun microservice yang benar.

---

## 27. Apa Yang Akan Dibahas Di Part Berikutnya

Part berikutnya:

```text
Part 3 — Domain Modeling for Microservices
```

Kita akan masuk lebih dalam ke:

- entity,
- value object,
- aggregate,
- invariant,
- command,
- event,
- policy,
- state machine,
- lifecycle,
- dan bagaimana domain model berubah ketika masuk dunia distributed systems.

Jika Part 2 menjawab:

```text
Di mana service dipotong?
```

Part 3 menjawab:

```text
Apa isi model di dalam boundary itu?
```

---

## References

[^fowler-microservices]: Martin Fowler, “Microservices”, https://martinfowler.com/articles/microservices.html
[^fowler-bounded-context]: Martin Fowler, “Bounded Context”, https://martinfowler.com/bliki/BoundedContext.html
[^microservices-io]: Chris Richardson, “What are microservices?”, https://microservices.io/
[^team-topologies]: Team Topologies, “Key Concepts”, https://teamtopologies.com/key-concepts
[^azure-domain-analysis]: Microsoft Azure Architecture Center, “Use domain analysis to model microservices”, https://learn.microsoft.com/en-us/azure/architecture/microservices/model/domain-analysis
[^azure-tactical-ddd]: Microsoft Azure Architecture Center, “Use tactical DDD to design microservices”, https://learn.microsoft.com/en-us/azure/architecture/microservices/model/tactical-domain-driven-design


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-microservices-patterns-advanced-engineering-01-distributed-systems-reality.md">⬅️ Part 1 — Distributed Systems Reality Before Microservices</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-microservices-patterns-advanced-engineering-03-domain-modeling-for-microservices.md">0. Posisi Part Ini Dalam Seri ➡️</a>
</div>
