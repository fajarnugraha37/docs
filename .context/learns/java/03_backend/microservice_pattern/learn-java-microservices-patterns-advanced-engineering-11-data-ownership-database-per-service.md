# learn-java-microservices-patterns-advanced-engineering — Part 11
# Data Ownership and Database-per-Service Pattern

> Seri: **Java Microservices Pattern — Advanced Engineering**  
> Part: **11 of 35**  
> File: `learn-java-microservices-patterns-advanced-engineering-11-data-ownership-database-per-service.md`  
> Target: engineer yang ingin memahami microservices bukan sebagai kumpulan service kecil, tetapi sebagai sistem socio-technical dengan ownership, consistency, evolvability, reliability, security, dan operational accountability yang jelas.  
> Java scope: **Java 8 sampai Java 25**.

---

## 0. Posisi Part Ini Dalam Seri

Sampai Part 10, kita sudah membangun fondasi:

1. microservices bukan sekadar banyak aplikasi kecil;
2. distributed systems punya partial failure, latency, timeout, retry storm, dan blast radius;
3. service boundary adalah keputusan arsitektur yang sangat mahal;
4. domain model harus dipisahkan dari data model dan integration model;
5. synchronous API dan asynchronous messaging adalah bentuk coupling yang berbeda;
6. event-driven architecture harus dipahami sebagai propagation of facts;
7. saga dan compensation menggantikan ilusi distributed rollback;
8. outbox/inbox mengatasi dual-write problem;
9. consistency harus dipetakan ke invariant bisnis, bukan sekadar memilih strong atau eventual consistency.

Part ini masuk ke salah satu inti microservices yang paling sering disalahpahami:

> **Data ownership.**

Banyak sistem mengaku microservices karena punya banyak Spring Boot application, banyak container, banyak repository, dan banyak pipeline. Tetapi kalau semuanya masih membaca dan menulis database yang sama secara bebas, sistem itu biasanya bukan microservices yang benar-benar autonomous. Itu lebih dekat ke **distributed monolith with shared storage**.

Microservices.io mendeskripsikan Database-per-Service sebagai pola di mana setiap service memiliki private database-nya sendiri. Pattern ini muncul karena microservice architecture membutuhkan service yang loosely coupled dan independently deployable. Sebaliknya, shared database membuat beberapa service bebas mengakses data milik service lain melalui transaksi lokal yang sama, dan ini menciptakan coupling kuat antarservice. Lihat referensi: `https://microservices.io/patterns/data/database-per-service.html` dan `https://microservices.io/patterns/data/shared-database.html`.

Azure Architecture Center juga menekankan bahwa setiap microservice mengelola datanya sendiri, dan tidak boleh ada dua service yang berbagi data store secara langsung karena perubahan schema akan memaksa koordinasi antarservice. Lihat: `https://learn.microsoft.com/en-us/azure/architecture/microservices/design/data-considerations`.

AWS Prescriptive Guidance menyebut database-per-service sebagai pola di mana setiap microservice menggunakan database type yang sesuai dengan kebutuhannya sendiri, misalnya relational untuk satu service, document/key-value untuk service lain, dan search/index store untuk kebutuhan tertentu. Lihat: `https://docs.aws.amazon.com/prescriptive-guidance/latest/modernization-data-persistence/database-per-service.html`.

Namun tujuan part ini bukan sekadar mengatakan:

> “Setiap service harus punya database sendiri.”

Itu terlalu dangkal.

Tujuan part ini adalah membangun kemampuan untuk menjawab:

```text
Data ini sebenarnya milik siapa?
Siapa yang boleh mengubahnya?
Siapa yang boleh membacanya?
Siapa yang bertanggung jawab atas kebenaran datanya?
Apa invariant yang dijaga di tempat data itu berada?
Apa yang terjadi kalau service lain butuh data tersebut?
Apakah boleh duplikasi data?
Kapan duplikasi adalah desain yang benar?
Kapan shared database masih bisa diterima sementara?
Bagaimana migrasi dari shared schema ke ownership-based data architecture?
Bagaimana mempertahankan auditability, compliance, dan operational safety?
```

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan Part 11, kamu harus mampu:

1. memahami perbedaan antara **owning data**, **storing data**, **caching data**, **replicating data**, dan **reading data**;
2. menjelaskan kenapa database-per-service bukan sekadar “satu database per aplikasi”;
3. mengidentifikasi shared database anti-pattern dan variasinya;
4. merancang data ownership rule untuk domain enterprise;
5. membedakan private write model, published read model, replicated projection, dan external integration dataset;
6. menyelesaikan cross-service query tanpa direct join antarservice;
7. mendesain reference data dan master data ownership;
8. memahami konsekuensi foreign key lintas service boundary;
9. mendesain migration path dari shared database ke database-per-service;
10. membuat decision matrix untuk memilih shared schema sementara, schema-per-service, database-per-service, atau polyglot persistence;
11. menerapkan pemikiran ini pada Java 8–25 ecosystem.

---

## 2. Core Problem: Data Is Where Microservices Become Real

Di level code, service bisa terlihat terpisah:

```text
application-service
case-service
payment-service
notification-service
report-service
```

Masing-masing punya repository, pipeline, Docker image, Helm chart, dan endpoint sendiri.

Namun kalau di bawahnya mereka melakukan ini:

```text
application-service  --->  shared_oracle_db.APPLICATION
case-service         --->  shared_oracle_db.APPLICATION
payment-service      --->  shared_oracle_db.APPLICATION
report-service       --->  shared_oracle_db.APPLICATION
```

maka service boundary sebenarnya belum kuat.

Kenapa?

Karena semua service sekarang bergantung pada:

1. schema yang sama;
2. table yang sama;
3. constraint yang sama;
4. transaction semantics yang sama;
5. database availability yang sama;
6. migration schedule yang sama;
7. query performance yang saling mengganggu;
8. indexing strategy yang saling berebut;
9. interpretation of columns yang mungkin tidak sama;
10. implicit business rule yang tersembunyi di database.

Akibatnya, service bisa deploy sendiri di atas kertas, tetapi tidak bisa evolve sendiri dalam praktik.

Inilah kontradiksi utama:

> Microservices menjanjikan independent evolution, tetapi shared database menciptakan shared coupling paling kuat.

---

## 3. Fundamental Mental Model

### 3.1 Data Ownership Bukan Sama Dengan Data Location

Sering terjadi salah kaprah:

> “Data ini ada di database service A, berarti data ini milik service A.”

Belum tentu.

Data ownership bukan hanya lokasi penyimpanan. Ownership berarti:

```text
Service X adalah authority untuk definisi, validasi, lifecycle, mutation, dan publication data tersebut.
```

Contoh:

```text
Application Service owns Application.
Profile Service owns User Profile.
Payment Service owns Payment Attempt.
Document Service owns Document Metadata and Storage Pointer.
Audit Service owns Audit Record.
Case Service owns Case Lifecycle.
```

Kalau service lain menyimpan salinan data tersebut, salinan itu bukan source of truth. Itu adalah:

1. cache;
2. projection;
3. read model;
4. denormalized view;
5. materialized view;
6. historical snapshot;
7. audit copy;
8. integration replica.

Ownership tetap berada pada service yang punya authority.

### 3.2 Data Ownership = Authority + Responsibility

Data owner harus bertanggung jawab atas:

| Dimensi | Pertanyaan |
|---|---|
| Definition | Apa arti data ini? |
| Validation | Apa rule validnya? |
| Mutation | Siapa boleh mengubahnya? |
| Lifecycle | State apa saja yang mungkin? |
| Consistency | Invariant apa yang harus dijaga? |
| Publication | Bagaimana perubahan dipublikasikan? |
| Audit | Siapa mengubah apa, kapan, dan kenapa? |
| Security | Siapa boleh membaca/memodifikasi? |
| Retention | Berapa lama disimpan? |
| Deletion | Kapan boleh dihapus/anonymize/archive? |
| Schema Evolution | Siapa yang mengubah struktur data? |
| Incident | Siapa yang bertanggung jawab saat data salah? |

Kalau tidak ada owner yang jelas, maka data menjadi “milik semua orang”. Dalam sistem enterprise, “milik semua orang” biasanya berarti “tidak ada yang benar-benar bertanggung jawab”.

### 3.3 Database-per-Service Bukan Harus Physical Database Terpisah Sejak Hari Pertama

Ada beberapa level isolasi:

```text
Level 0: Shared tables, bebas baca/tulis lintas service
Level 1: Shared database, schema berbeda per service
Level 2: Shared database cluster, database berbeda per service
Level 3: Database instance berbeda per service
Level 4: Database technology berbeda per service
Level 5: Account/network/security boundary berbeda per service
```

Ideal microservices sering mengarah ke Level 2–4, tetapi dalam enterprise legacy migration, Level 1 bisa menjadi intermediate step.

Yang penting:

```text
Tidak ada service yang boleh langsung membaca/menulis private table service lain.
```

Jadi esensi pattern bukan jumlah database server, tetapi **encapsulation of data access**.

---

## 4. Pattern: Database per Service

### 4.1 Definisi

Database-per-service adalah pattern di mana setiap service memiliki data store private yang hanya boleh diakses oleh service itu sendiri. Service lain harus menggunakan API, event, projection, atau kontrak integrasi yang diterbitkan oleh owner.

Bentuknya bisa:

```text
Service A -> schema_a
Service B -> schema_b
Service C -> schema_c
```

atau:

```text
Service A -> db_a
Service B -> db_b
Service C -> db_c
```

atau:

```text
Service A -> PostgreSQL
Service B -> MongoDB
Service C -> Redis + PostgreSQL
Service D -> OpenSearch
```

Tetapi rule-nya sama:

```text
Only the owning service can directly access its private persistence model.
```

### 4.2 Intent

Pattern ini bertujuan untuk:

1. menjaga service autonomy;
2. memungkinkan independent deployment;
3. mengurangi schema coupling;
4. membatasi blast radius perubahan data model;
5. memungkinkan database technology sesuai workload;
6. memperjelas authority dan responsibility;
7. memaksa komunikasi melalui explicit contract;
8. menghindari hidden business logic lintas service;
9. membuat ownership dan incident responsibility jelas.

### 4.3 Forces

Pattern ini muncul karena ada trade-off:

| Force | Dampak |
|---|---|
| Service autonomy | Butuh data private |
| Query lintas service | Butuh composition/projection |
| Strong consistency | Sulit lintas service |
| Schema evolution | Lebih mudah jika private |
| Reporting | Lebih sulit tanpa direct join |
| Operational isolation | Lebih baik dengan data separation |
| Transaction simplicity | Lebih mudah dengan shared DB, tetapi coupling naik |
| Compliance | Ownership dan audit perlu jelas |
| Cost | Banyak database bisa lebih mahal |

Microservices bukan menghilangkan kompleksitas. Microservices memindahkan kompleksitas dari satu tempat ke tempat lain.

Shared database memudahkan join dan transaksi lokal, tetapi membayar dengan coupling.

Database-per-service mengurangi coupling, tetapi membayar dengan consistency, query, replication, governance, dan operational cost.

---

## 5. Anti-Pattern: Shared Database

### 5.1 Bentuk Paling Jelas

```text
Service A ----\
Service B -----\
Service C ------> same tables
Service D -----/
Service E ----/
```

Semua service melakukan query langsung ke table yang sama.

Contoh:

```sql
SELECT * FROM APPLICATION WHERE STATUS = 'PENDING_APPROVAL';
```

Query ini mungkin dilakukan oleh:

1. Application Service;
2. Case Service;
3. Report Service;
4. Notification Service;
5. Compliance Service.

Masalahnya bukan query-nya saja. Masalahnya adalah semua service sekarang punya pengetahuan implisit bahwa:

```text
APPLICATION.STATUS = 'PENDING_APPROVAL'
```

berarti sesuatu secara bisnis.

Kalau owner mengubah status menjadi:

```text
PENDING_REVIEW
```

atau menambahkan state baru:

```text
PENDING_SUPERVISOR_REVIEW
PENDING_DIRECTOR_APPROVAL
```

service lain bisa rusak tanpa compile error.

### 5.2 Shared Database Dengan “Read Only” Tetap Berbahaya

Ada variasi yang sering dianggap aman:

> “Service lain cuma read-only kok.”

Read-only direct access tetap coupling.

Kenapa?

Karena consumer tetap bergantung pada:

1. table name;
2. column name;
3. data type;
4. indexing;
5. nullability;
6. semantic encoding;
7. enum values;
8. join structure;
9. lifecycle interpretation;
10. timing of updates.

Read-only direct access juga membuat owner takut mengubah schema karena tidak tahu siapa saja yang membaca.

### 5.3 Shared Database Dengan View Tetap Perlu Hati-Hati

Database view bisa lebih baik daripada direct table access karena owner bisa publish read contract:

```sql
CREATE VIEW application_public_listing_view AS
SELECT id, reference_no, status, submitted_at
FROM application;
```

Namun view masih punya risiko:

1. consumer tetap coupled ke database;
2. access control sulit jika lintas service;
3. deployment masih terikat schema migration;
4. semantic versioning view jarang disiplin;
5. query load consumer bisa mengganggu owner DB;
6. view sering berubah menjadi “API gelap”.

View bisa menjadi transitional pattern, bukan tujuan akhir untuk microservices yang autonomous.

### 5.4 Shared Database Dengan Stored Procedure

Kadang organisasi mengatakan:

> “Kita tidak share table, kita share stored procedure.”

Ini lebih explicit, tetapi tetap harus diperlakukan sebagai API. Kalau stored procedure dimiliki database team, bukan service owner, maka domain authority bisa kabur.

Stored procedure lintas service dapat menjadi masalah jika:

1. digunakan banyak service tanpa versioning;
2. mengandung business workflow lintas bounded context;
3. sulit diobservasi dari distributed tracing;
4. deployment-nya tidak selaras dengan service;
5. testing-nya terpisah dari service contract.

Stored procedure bukan salah secara absolut. Tetapi dalam microservices, ia harus punya owner, contract, versioning, compatibility policy, dan observability.

---

## 6. Data Ownership Taxonomy

Untuk berpikir presisi, gunakan taxonomy berikut.

### 6.1 Authoritative Data

Authoritative data adalah data yang menjadi source of truth.

Contoh:

```text
Application Service owns application submission.
Case Service owns enforcement case lifecycle.
Payment Service owns payment transaction result.
User/Profile Service owns officer profile.
Document Service owns document metadata.
Audit Service owns immutable audit log.
```

Rule:

```text
Only the owning service can mutate authoritative data.
```

### 6.2 Reference Data

Reference data adalah data relatif stabil yang digunakan banyak service.

Contoh:

```text
country code
postal district
license category
agency code
business activity code
product category
```

Pertanyaan ownership:

```text
Siapa yang menerbitkan reference data?
Apakah data ini global atau tenant-specific?
Apakah service boleh cache?
Bagaimana versioning-nya?
Bagaimana effective date-nya?
Apa yang terjadi kalau code sudah deprecated tapi masih dipakai historical record?
```

Reference data sering terlihat sederhana, tetapi dalam sistem regulated, reference data bisa menentukan validity keputusan.

### 6.3 Master Data

Master data adalah data inti yang dipakai banyak domain.

Contoh:

```text
person
company
licensee
agent
agency
organization
property
account
```

Master data punya risiko besar karena banyak service merasa “punya”.

Rule sehat:

```text
One domain owns identity and canonical attributes.
Other domains own their contextual relationship to that master entity.
```

Contoh:

```text
Profile Service owns Person canonical profile.
Application Service owns ApplicantSnapshot used at submission time.
Case Service owns RespondentRole in a case.
Payment Service owns PayerSnapshot used for receipt.
```

Jangan mencampur semua ke satu `PERSON` table yang dimutasi semua service.

### 6.4 Transactional Data

Transactional data adalah data yang muncul dari aktivitas bisnis.

Contoh:

```text
application submission
case note
inspection result
payment attempt
appeal request
notification delivery
approval decision
```

Biasanya transactional data harus dimiliki domain yang menjalankan lifecycle-nya.

### 6.5 Derived Data

Derived data adalah hasil perhitungan dari data lain.

Contoh:

```text
application_count_by_status
case_sla_breach_flag
officer_workload_score
risk_score
dashboard_metric
search_index_document
```

Derived data harus punya:

1. source lineage;
2. freshness rule;
3. recomputation strategy;
4. reconciliation strategy;
5. owner.

Kalau derived data tidak punya owner, ia menjadi sumber dispute.

### 6.6 Snapshot Data

Snapshot data adalah salinan historis dari data pada waktu tertentu.

Contoh:

```text
Applicant name at submission time
Business address at license approval time
Fee schedule at payment time
Officer role at decision time
```

Snapshot sangat penting untuk audit/regulatory defensibility.

Contoh:

```text
Profile berubah setelah aplikasi disetujui.
Apakah approval record harus ikut berubah?
```

Biasanya tidak. Approval record harus menyimpan snapshot konteks pada saat keputusan dibuat.

### 6.7 Cached Data

Cached data adalah salinan untuk performance.

Rule:

```text
Cache is not authority.
```

Cache harus punya:

1. invalidation rule;
2. TTL;
3. consistency expectation;
4. fallback behavior;
5. security boundary;
6. tenant boundary.

### 6.8 Replicated Projection

Projection adalah read model yang dibangun dari event/API owner.

Contoh:

```text
Report Service maintains ApplicationListingProjection.
Search Service maintains SearchDocumentIndex.
Dashboard Service maintains StatusCounter.
```

Projection bukan source of truth. Tetapi ia boleh menjadi source of query untuk use case tertentu.

---

## 7. The Ownership Rule

Gunakan rule berikut sebagai default:

```text
A service may only directly write its own data.
A service may only directly read its own private persistence model.
Other services must access the data through a published contract: API, event, projection, export, or explicitly owned read model.
```

Konsekuensinya:

1. tidak ada cross-service table join;
2. tidak ada foreign key ke private table service lain;
3. tidak ada shared entity class antarservice;
4. tidak ada shared repository module;
5. tidak ada direct SQL ke table milik service lain;
6. tidak ada migration yang mengubah table service lain tanpa owner approval;
7. tidak ada report query yang bypass service ownership kecuali melalui reporting data product yang jelas.

---

## 8. Database-per-Service Variants

### 8.1 Schema-per-Service

```text
one DB instance
  schema_application
  schema_case
  schema_payment
  schema_notification
```

Kelebihan:

1. lebih murah;
2. mudah diadopsi di enterprise Oracle/PostgreSQL;
3. backup/ops lebih sederhana;
4. cocok untuk migration step awal;
5. masih bisa enforce permission per schema.

Kekurangan:

1. noisy neighbor masih mungkin;
2. database instance masih shared failure domain;
3. DBA operation masih shared;
4. god user bisa bypass boundary;
5. reporting team mungkin tergoda join langsung.

Cocok untuk:

```text
legacy enterprise migration
Oracle multi-schema system
team belum siap banyak database instance
regulated environment dengan DBA control tinggi
```

### 8.2 Database-per-Service Within Same Cluster

```text
same cluster
  db_application
  db_case
  db_payment
```

Kelebihan:

1. isolasi lebih kuat dari schema;
2. privilege lebih jelas;
3. backup/restore bisa lebih granular;
4. migration lebih terpisah.

Kekurangan:

1. masih shared compute/storage cluster;
2. operational dependency tetap ada;
3. cross-database access harus dibatasi.

### 8.3 Dedicated Database Instance per Service

```text
application-service -> application-db
case-service        -> case-db
payment-service     -> payment-db
```

Kelebihan:

1. isolation lebih kuat;
2. independent scaling;
3. independent maintenance window;
4. failure blast radius lebih kecil;
5. security boundary lebih kuat.

Kekurangan:

1. cost naik;
2. ops kompleks;
3. backup/monitoring lebih banyak;
4. connection management lebih banyak;
5. data reporting lebih rumit.

### 8.4 Polyglot Persistence

```text
Application Service -> PostgreSQL
Document Service    -> S3/Object Store + metadata DB
Search Service      -> OpenSearch
Cache Service       -> Redis
Audit Service       -> append-only relational/log store
Analytics Service   -> ClickHouse
```

Kelebihan:

1. storage sesuai workload;
2. performance lebih optimal;
3. model data lebih natural;
4. scaling lebih fleksibel.

Kekurangan:

1. operational skill lebih berat;
2. observability lebih kompleks;
3. backup/restore berbeda-beda;
4. data governance lebih sulit;
5. developer cognitive load naik.

Rule:

```text
Jangan pilih database berbeda hanya karena ingin terlihat modern.
Pilih karena workload, consistency, query, scale, retention, dan operational model memang berbeda.
```

---

## 9. What Does “Private Database” Mean?

Private database berarti service lain tidak boleh mengakses persistence model secara langsung.

Private bisa ditegakkan melalui beberapa lapisan:

### 9.1 Code Boundary

Tidak ada repository module yang dibagikan lintas service.

Buruk:

```text
shared-data-access.jar
  ApplicationRepository
  CaseRepository
  PaymentRepository
```

Lebih baik:

```text
application-service owns ApplicationRepository
case-service owns CaseRepository
payment-service owns PaymentRepository
```

### 9.2 Database Credential Boundary

Setiap service punya credential yang hanya bisa akses schema/database-nya sendiri.

Buruk:

```text
APP_DB_USER can SELECT/INSERT/UPDATE all schemas
```

Lebih baik:

```text
APPLICATION_SERVICE_USER can access application schema only
CASE_SERVICE_USER can access case schema only
PAYMENT_SERVICE_USER can access payment schema only
```

### 9.3 Network Boundary

Database tidak diekspos ke semua service namespace jika tidak perlu.

### 9.4 Migration Boundary

Migration file service A tidak boleh mengubah table service B.

Buruk:

```text
application-service/db/migration/V099__alter_case_table.sql
```

Lebih baik:

```text
case-service/db/migration/V099__add_case_decision_reason.sql
```

### 9.5 Operational Boundary

Backup, restore, incident, on-call, ownership jelas.

---

## 10. Why Shared Database Creates Distributed Monolith

Distributed monolith bukan hanya service yang synchronous chain terlalu panjang. Shared database juga dapat menciptakan distributed monolith.

### 10.1 Schema Coupling

Service A tidak bisa mengubah column tanpa mengecek service B, C, D.

```text
Application.status VARCHAR(20)
```

Ternyata dipakai oleh:

1. dashboard;
2. notification;
3. SLA calculation;
4. case opening;
5. audit listing;
6. report generation.

Perubahan status kecil menjadi cross-team release.

### 10.2 Semantic Coupling

Column sama, arti berbeda.

```text
status = APPROVED
```

Bagi Application Service:

```text
Application decision approved.
```

Bagi License Service:

```text
License can be issued.
```

Bagi Payment Service:

```text
Payment no longer required.
```

Mungkin ketiganya salah jika rule bisnis berubah.

### 10.3 Transaction Coupling

Service B melakukan update ke table A dalam satu transaction.

```sql
UPDATE application SET status = 'CANCELLED' WHERE id = ?;
INSERT INTO case_note (...);
```

Sekarang lifecycle Application tidak lagi dimiliki Application Service.

### 10.4 Performance Coupling

Report Service menjalankan query besar:

```sql
SELECT ... FROM application a
JOIN case c ON ...
JOIN payment p ON ...
WHERE ...
```

Akibatnya Application Service lambat karena database CPU/I/O habis.

### 10.5 Migration Coupling

Deployment service A harus menunggu migration yang aman untuk service B.

### 10.6 Security Coupling

Service yang hanya butuh 3 column diberi akses table penuh yang berisi PII.

### 10.7 Incident Coupling

Data salah. Siapa owner?

```text
Application Service bilang Case Service yang update.
Case Service bilang script DBA.
DBA bilang request datang dari shared application user.
Audit trail tidak jelas.
```

Ini kegagalan ownership.

---

## 11. Cross-Service Query Problem

Database-per-service membuat pertanyaan ini muncul:

> Kalau data tersebar, bagaimana melakukan query yang butuh data dari beberapa service?

Contoh:

```text
Tampilkan daftar application dengan:
- application reference no
- applicant name
- license category
- latest payment status
- current case count
- assigned officer
- SLA breach flag
```

Di shared database, mudah:

```sql
SELECT ...
FROM application a
JOIN profile p ON ...
JOIN payment py ON ...
JOIN case c ON ...
JOIN officer o ON ...
```

Di microservices, direct join seperti ini melanggar ownership.

Ada beberapa solusi.

---

## 12. Solution 1: API Composition

API Composition berarti service aggregator memanggil beberapa service owner, lalu menggabungkan hasil di memory.

```text
Frontend
   |
   v
Application Query API
   |----> Application Service
   |----> Profile Service
   |----> Payment Service
   |----> Case Service
   |----> Officer Service
```

### 12.1 Cocok Untuk

1. query sederhana;
2. jumlah data kecil;
3. latency masih dapat diterima;
4. real-time freshness lebih penting dari performa;
5. tidak perlu complex filter/sort lintas domain.

### 12.2 Tidak Cocok Untuk

1. listing besar;
2. reporting;
3. dashboard heavy query;
4. filter berdasarkan field dari banyak service;
5. sort berdasarkan computed field;
6. high traffic endpoint;
7. strict latency SLA.

### 12.3 Failure Mode

API composition rentan terhadap:

1. fan-out latency;
2. partial failure;
3. timeout chain;
4. retry storm;
5. inconsistent snapshot;
6. N+1 remote call;
7. aggregator menjadi god service.

### 12.4 Design Rule

Gunakan API composition untuk:

```text
small-detail page, command validation helper, lightweight real-time lookup.
```

Jangan gunakan untuk:

```text
large listing, reporting, dashboard, export, analytics.
```

---

## 13. Solution 2: Materialized View / Projection

Projection berarti service query membangun read model sendiri dari event/API source.

```text
Application Service -- ApplicationSubmitted event --> Reporting Projection
Payment Service ---- PaymentCompleted event -------> Reporting Projection
Case Service ------- CaseOpened event -------------> Reporting Projection
Officer Service ---- OfficerAssigned event --------> Reporting Projection
```

Lalu query dilakukan ke database projection:

```text
Report Service -> report_db.application_listing_projection
```

### 13.1 Cocok Untuk

1. listing besar;
2. dashboard;
3. reporting;
4. search;
5. filter/sort complex;
6. data warehouse-like read model;
7. high read traffic;
8. eventual consistency acceptable.

### 13.2 Trade-Off

Projection membayar dengan:

1. lag;
2. duplicate storage;
3. replay complexity;
4. schema evolution;
5. reconciliation;
6. ownership ambiguity jika tidak jelas;
7. event dependency.

### 13.3 Projection Is Not Source of Truth

Projection boleh menjawab query, tetapi tidak boleh menjadi authority untuk mutation domain utama.

Buruk:

```text
Approval uses report projection to decide whether application is valid.
```

Lebih baik:

```text
Approval uses Application Service authoritative state.
Report projection is only for listing/reporting.
```

---

## 14. Solution 3: Command-Side Replica

Command-side replica adalah salinan data dari service lain yang dibutuhkan untuk melakukan command secara lokal.

Contoh:

```text
Application Service butuh license category rule dari Reference Service.
Application Service menyimpan local copy active_license_categories.
```

Saat command masuk:

```text
submit application -> validate license category locally
```

Bukan remote call setiap submit.

### 14.1 Cocok Untuk

1. reference data;
2. rule data dengan effective date;
3. data kecil tapi sering dipakai;
4. dependency yang tidak boleh membuat command path lambat;
5. offline-ish validation.

### 14.2 Bahaya

1. stale rule;
2. wrong version;
3. no effective date;
4. no reconciliation;
5. no provenance.

### 14.3 Rule

Replica harus menyimpan:

```text
source_version
effective_from
effective_to
received_at
source_event_id
```

---

## 15. Solution 4: Data Product / Reporting Store

Untuk enterprise reporting, sering perlu data lintas domain.

Daripada report query langsung ke semua private DB, buat reporting data product:

```text
Operational Services -> events/CDC/export -> Reporting Store -> Reports
```

Reporting store bisa berupa:

1. relational reporting database;
2. data warehouse;
3. lakehouse;
4. ClickHouse;
5. OpenSearch;
6. materialized views;
7. parquet files + query engine.

### 15.1 Ownership

Reporting store harus punya owner.

Pertanyaan:

```text
Siapa owner metric ini?
Apa freshness SLA-nya?
Apa source lineage-nya?
Apa definisi business term-nya?
Apa reconciliation process-nya?
```

### 15.2 Reporting Store Tidak Boleh Menjadi Mutation Authority

Reporting boleh membaca banyak data, tetapi tidak boleh menjadi jalan pintas untuk update operational state.

---

## 16. Solution 5: Published Read API

Service owner dapat menerbitkan read API khusus:

```text
GET /applications/{id}/summary
GET /applications/search?status=PENDING&page=1
```

Ini lebih baik daripada direct DB access karena owner mengontrol contract.

Namun published API harus didesain hati-hati:

1. jangan expose internal schema;
2. jangan terlalu generic;
3. jangan menjadi bottleneck report;
4. punya pagination;
5. punya rate limit;
6. punya versioning;
7. punya authorization.

---

## 17. Solution 6: Published Database View as Transitional Contract

Dalam enterprise legacy, kadang API/projection belum siap. Published database view bisa menjadi transitional pattern.

```sql
CREATE VIEW application_public_v1 AS
SELECT
  id,
  reference_no,
  status,
  submitted_at,
  applicant_id
FROM application;
```

Rule agar tidak menjadi anti-pattern:

1. view dimiliki service owner;
2. view versioned (`_v1`, `_v2`);
3. consumer tidak boleh akses base table;
4. privilege hanya ke view;
5. view punya compatibility policy;
6. view deprecated secara eksplisit;
7. query load dimonitor;
8. view tidak untuk mutation.

Ini bukan microservices ideal, tetapi bisa realistis untuk migrasi Oracle/legacy.

---

## 18. Foreign Key Across Service Boundary

Foreign key adalah mekanisme database untuk menjaga referential integrity.

Dalam satu service boundary, foreign key sangat berguna.

Contoh dalam Application Service:

```text
application
application_document
application_decision
```

Foreign key internal:

```sql
application_document.application_id -> application.id
```

Itu sehat.

Namun foreign key lintas service boundary bermasalah:

```text
case.application_id -> application.id
```

Kalau Case Service dan Application Service berbeda owner, FK ini menciptakan coupling:

1. migration coupling;
2. deletion/archival coupling;
3. restore coupling;
4. availability coupling;
5. transaction coupling;
6. operational coupling.

### 18.1 Alternative: Reference by Identity

Case Service boleh menyimpan:

```text
application_id
application_reference_no_snapshot
application_type_snapshot
```

Tetapi tidak membuat FK langsung ke table Application Service.

Integrity dijaga melalui:

1. API validation at creation time;
2. event-driven update;
3. reconciliation job;
4. compensating correction;
5. audit trail.

### 18.2 But We Need Integrity

Benar. Tetapi lintas service, integrity sering harus dijaga di application/domain level, bukan database FK.

Pertanyaan penting:

```text
Apakah invariant ini harus prevented synchronously?
Atau boleh detected dan corrected?
```

Tidak semua referential consistency harus strong.

---

## 19. Data Duplication Is Not Automatically Bad

Dalam monolith normalized database, duplikasi sering dianggap buruk.

Dalam microservices, duplikasi sering disengaja.

Contoh:

```text
Application Service owns applicant_id.
Application Service also stores applicant_name_snapshot at submission time.
```

Apakah ini duplikasi?

Ya.

Apakah buruk?

Tidak selalu. Bahkan bisa benar.

### 19.1 Good Duplication

Duplikasi sehat jika:

1. memperjelas historical snapshot;
2. mengurangi runtime dependency;
3. mendukung auditability;
4. mendukung read performance;
5. membuat service autonomous;
6. punya owner dan freshness rule;
7. bisa direkonsiliasi;
8. tidak diklaim sebagai source of truth.

### 19.2 Bad Duplication

Duplikasi buruk jika:

1. dua service sama-sama menganggap datanya authoritative;
2. tidak ada source lineage;
3. tidak ada update propagation;
4. tidak ada reconciliation;
5. semantic-nya diverge diam-diam;
6. dipakai untuk keputusan hukum tanpa snapshot rule;
7. cache dianggap truth.

---

## 20. Data Ownership in Regulatory / Case Management Systems

Untuk sistem regulatory, ownership harus lebih disiplin karena data bukan hanya untuk transaksi, tetapi juga untuk pembuktian keputusan.

Contoh domain:

```text
Application Management
Case Management
Compliance
Correspondence
Document
Payment/Revenue
Profile
Audit Trail
Notification
Reporting
```

### 20.1 Application Management

Owns:

```text
application submission
application lifecycle
application decision
submitted data snapshot
application amendment
application withdrawal
```

Does not own:

```text
payment transaction authority
case investigation lifecycle
document binary storage authority
officer identity authority
```

### 20.2 Case Management

Owns:

```text
case lifecycle
case assignment
case note
case decision recommendation
case escalation
case closure
```

Does not own:

```text
application lifecycle itself
license canonical data
payment settlement
```

### 20.3 Document Service

Owns:

```text
document metadata
document storage pointer
document checksum
document classification
document retention policy
```

Does not necessarily own:

```text
business meaning of document in application/case context
```

Application Service can own:

```text
application_document_requirement
application_document_status
```

Document Service owns:

```text
document object and metadata
```

### 20.4 Audit Service

Owns:

```text
immutable audit records
actor/action/resource/timestamp
correlation id
before/after summary if applicable
```

But audit record is not necessarily domain source of truth. It is evidence.

### 20.5 Reporting Service

Owns:

```text
report definitions
report projection
report freshness
metric calculation
```

Does not own:

```text
operational state that reports summarize
```

---

## 21. Ownership Matrix

A practical tool: create a data ownership matrix.

Example:

| Data | Owner Service | Can Mutate | Other Readers | Published Through | Freshness | Notes |
|---|---|---|---|---|---|---|
| Application | Application Service | Application Service | Case, Report, Notification | API + Events | near real-time | authoritative lifecycle |
| Applicant Profile | Profile Service | Profile Service | Application, Case | API + snapshot event | current or snapshot | PII controls |
| Application Snapshot | Application Service | Application Service | Report, Audit | Events | immutable | used for decision proof |
| Payment Attempt | Payment Service | Payment Service | Application, Report | Events + API | near real-time | settlement authority external |
| Case | Case Service | Case Service | Application, Report | API + Events | near real-time | case lifecycle |
| Document Metadata | Document Service | Document Service | Application, Case | API + Events | near real-time | binary pointer/checksum |
| Audit Record | Audit Service | Append only | Compliance, Report | Query API/export | eventual | immutable evidence |
| Reference Code | Reference Service | Admin/Reference Service | All services | Events + API | versioned | effective date |

This matrix exposes ambiguity quickly.

---

## 22. Practical Boundary Questions

When deciding ownership, ask:

### 22.1 Meaning

```text
Who defines what this data means?
```

If `status = ACTIVE`, who defines ACTIVE?

### 22.2 Mutation

```text
Who is allowed to change this data?
```

If multiple services mutate same column, ownership is broken.

### 22.3 Lifecycle

```text
Whose state machine controls this data?
```

If data belongs to Application lifecycle, Application Service owns it.

### 22.4 Invariant

```text
Which service enforces the invariant?
```

If an invariant must be strongly enforced with the data, it likely belongs in the same service boundary.

### 22.5 Audit

```text
Who must explain this data during audit?
```

In regulated systems, this question is often decisive.

### 22.6 Change Frequency

```text
Which team changes this data model most often?
```

Data that changes together should often live together.

### 22.7 Consumer Need

```text
Do consumers need current data, historical snapshot, or derived view?
```

Different needs imply different publication models.

---

## 23. Migration from Shared Database to Data Ownership

Most real enterprise systems do not start clean. They start with shared Oracle/PostgreSQL/MySQL schema.

Migration must be incremental.

### 23.1 Step 1: Inventory Tables and Access

Create table access map:

| Table | Readers | Writers | Jobs | Reports | Owner Candidate |
|---|---|---|---|---|---|
| APPLICATION | Application, Case, Report | Application, Case | SLA Job | Daily Report | Application |
| CASE | Case, Report | Case | Case Aging Job | Case Report | Case |
| PAYMENT | Payment, Application, Report | Payment | Settlement Job | Revenue Report | Payment |

Use:

1. code search;
2. database audit logs;
3. query history;
4. repository analysis;
5. DBA metadata;
6. application logs;
7. runtime tracing.

### 23.2 Step 2: Classify Access

For each access:

```text
Read? Write? Batch? Report? API? Ad-hoc? Emergency? Legacy?
```

Writers are more urgent than readers.

### 23.3 Step 3: Assign Owner

Every table must have an owner service or owner domain.

If no owner can be identified, it is a domain modeling problem.

### 23.4 Step 4: Stop New Violations

Before fixing old coupling, prevent new coupling.

Policy:

```text
No new service may access table owned by another service.
No new shared repository module.
No new cross-service write.
```

### 23.5 Step 5: Replace Cross-Service Writes First

Cross-service writes are more dangerous than reads.

Replace:

```text
Case Service updates Application table directly.
```

With:

```text
Case Service sends command/API/event to Application Service.
Application Service decides whether transition is valid.
```

### 23.6 Step 6: Replace Direct Reads

Options:

1. read API;
2. event projection;
3. published view;
4. reporting store;
5. snapshot at write time.

### 23.7 Step 7: Enforce Credential Boundaries

Change DB users:

```text
service_user can only access owned schema/views.
```

This is when architecture becomes real.

### 23.8 Step 8: Split Schema/Database

Once access is clean, physical split becomes much easier.

### 23.9 Step 9: Reconciliation and Cutover

Before cutover:

1. compare row counts;
2. compare checksums;
3. compare business metrics;
4. verify event lag;
5. run parallel reads;
6. validate reports;
7. prepare rollback/roll-forward.

---

## 24. Migration Patterns

### 24.1 Strangler Fig for Data

Instead of big-bang database split:

```text
old shared table -> new owner service -> consumers migrate gradually
```

### 24.2 Branch by Abstraction

Introduce abstraction in old code:

```java
interface ApplicationLookup {
    ApplicationSummary findById(ApplicationId id);
}
```

Implementation can switch from direct DB to API/projection.

### 24.3 Published View as Bridge

Owner publishes stable view while consumers migrate.

### 24.4 CDC Bridge

Use CDC to feed new projection while old system still writes old DB.

### 24.5 Dual Read

Read from old and new path, compare differences, but return old path result until confidence grows.

### 24.6 Dual Write Warning

Dual write is dangerous unless guarded by outbox/saga/idempotency/reconciliation.

Do not casually write to old and new DB in application code without failure model.

---

## 25. Java 8–25 Considerations

### 25.1 Java 8

In Java 8 era, many systems rely on:

1. Spring Boot 1/2;
2. older JDBC drivers;
3. older Hibernate;
4. blocking thread-per-request;
5. shared enterprise database;
6. XML-heavy configuration;
7. less mature observability.

Design implication:

```text
Prioritize boundary enforcement through package/module/repository discipline, DB credentials, and API/event contracts.
```

Do not depend on modern runtime features.

### 25.2 Java 11

Java 11 gives a more modern baseline and has built-in `HttpClient`.

Useful for:

1. service-to-service API clients;
2. migration from legacy Java 8;
3. stronger container support than Java 8.

### 25.3 Java 17

Java 17 is a strong enterprise LTS baseline.

Useful language/runtime features:

1. records for DTO/read models;
2. sealed classes for controlled domain result types;
3. better GC/runtime ergonomics;
4. modern Spring Boot/Jakarta ecosystem baseline.

Example DTO:

```java
public record ApplicationSummary(
        String applicationId,
        String referenceNo,
        String status,
        String applicantNameSnapshot
) {}
```

### 25.4 Java 21

Java 21 adds virtual threads as a standard feature.

Impact:

1. blocking I/O service can scale concurrency more simply;
2. thread-per-request model becomes viable again for many workloads;
3. remote calls still need timeout/backpressure;
4. virtual threads do not solve database ownership;
5. virtual threads can hide overload if concurrency is unbounded.

### 25.5 Java 25

Java 25 is the latest LTS generation after Java 21. Use it as future-facing baseline where organization permits.

Design principle remains:

```text
New Java features improve implementation ergonomics.
They do not remove distributed data ownership problems.
```

### 25.6 Records and Persistence Boundary

Records are good for:

1. API DTO;
2. event payload;
3. projection read model;
4. query response;
5. immutable command objects.

Be careful using records directly as JPA entities in older stacks.

### 25.7 Shared Libraries Warning

Java teams often create shared JARs:

```text
common-entities.jar
common-repositories.jar
common-dtos.jar
```

Danger:

1. shared entity leaks persistence model;
2. shared DTO freezes contract globally;
3. shared repository breaks ownership;
4. shared validation rule may cross bounded context incorrectly.

Acceptable shared libraries:

```text
observability utilities
error envelope contract
security primitives
id type wrappers if stable
serialization helpers
contract-generated clients
```

Avoid shared domain model unless it is a deliberate Shared Kernel with governance.

---

## 26. Example: Bad Shared Entity Model

Bad:

```java
// common-domain.jar
@Entity
@Table(name = "APPLICATION")
public class ApplicationEntity {
    @Id
    private Long id;
    private String referenceNo;
    private String status;
    private String applicantName;
}
```

Used by:

```text
application-service
case-service
report-service
notification-service
```

This creates compile-time coupling to database schema.

### Better

Application Service owns entity:

```java
// application-service only
@Entity
@Table(name = "applications")
class ApplicationJpaEntity {
    @Id
    private UUID id;
    private String referenceNo;
    private String status;
    private String applicantNameSnapshot;
}
```

Published DTO:

```java
public record ApplicationPublicSummary(
        UUID applicationId,
        String referenceNo,
        String status,
        Instant submittedAt
) {}
```

Published event:

```java
public record ApplicationSubmittedEvent(
        UUID eventId,
        UUID applicationId,
        String referenceNo,
        String applicantNameSnapshot,
        Instant occurredAt
) {}
```

Consumer stores projection:

```java
@Entity
@Table(name = "application_listing_projection")
class ApplicationListingProjection {
    @Id
    private UUID applicationId;
    private String referenceNo;
    private String applicationStatus;
    private String applicantNameSnapshot;
    private Instant lastEventAt;
}
```

Now each model has different purpose.

---

## 27. Data Model Types Per Service

A service can internally maintain multiple models:

```text
write model
read model
outbox model
inbox model
audit model
projection model
cache model
```

Do not expose them all externally.

### 27.1 Write Model

Optimized for invariants and mutation.

### 27.2 Read Model

Optimized for queries.

### 27.3 Integration Event Model

Optimized for compatibility.

### 27.4 Audit Model

Optimized for evidence.

### 27.5 Projection Model

Optimized for external facts consumed from other services.

---

## 28. Security and Privacy Considerations

Database-per-service improves security only if enforced.

### 28.1 Least Privilege

Each service gets minimum DB privilege.

```text
No shared admin user in runtime.
No cross-schema grant by default.
No report user with full PII unless justified.
```

### 28.2 PII Propagation

Events/projections can accidentally leak PII.

Bad event:

```json
{
  "eventType": "ApplicationSubmitted",
  "fullName": "...",
  "nationalId": "...",
  "address": "...",
  "phone": "...",
  "email": "..."
}
```

Better:

```json
{
  "eventType": "ApplicationSubmitted",
  "applicationId": "...",
  "referenceNo": "...",
  "applicantId": "...",
  "submittedAt": "..."
}
```

Only include PII if consumer has legitimate need and contract says so.

### 28.3 Right to Erasure / Retention

If data is duplicated into projections, deletion/anonymization must propagate.

Questions:

```text
Which service owns deletion decision?
Which projections contain copied PII?
How is deletion event propagated?
Can audit records retain pseudonymized identifiers?
What retention policy applies to snapshots?
```

### 28.4 Auditability

Cross-service data access must be auditable:

1. who requested;
2. which service;
3. which tenant;
4. what purpose;
5. which correlation id;
6. whether data was exported.

---

## 29. Operational Considerations

### 29.1 Backup and Restore

With database-per-service, restore becomes tricky.

If Application DB restored to 10:00 and Payment DB remains at 10:30, cross-service consistency may break.

Need:

1. restore point strategy;
2. event replay strategy;
3. reconciliation;
4. idempotent reprocessing;
5. restore runbook;
6. dependency ordering.

### 29.2 Disaster Recovery

Each service DB needs RPO/RTO.

Not all services need same RTO.

Example:

| Service | RPO | RTO | Notes |
|---|---:|---:|---|
| Auth/Profile | low | low | login dependency |
| Application | low | medium | core transaction |
| Notification | medium | medium | can replay |
| Reporting | higher | higher | rebuildable projection |
| Search | higher | higher | rebuildable index |

### 29.3 Monitoring

Monitor per owner:

1. DB connections;
2. query latency;
3. slow query;
4. lock wait;
5. deadlock;
6. migration duration;
7. replication lag;
8. projection lag;
9. outbox backlog;
10. failed consumer count;
11. data reconciliation mismatch.

### 29.4 Noisy Neighbor

If schema-per-service shares same physical DB, report query from one service can slow transactional service.

Mitigation:

1. read replica;
2. workload isolation;
3. query timeout;
4. resource manager;
5. separate reporting store;
6. index governance;
7. connection pool limit.

---

## 30. Database Migration Governance

Each service owns its migration.

Rules:

1. migration must be backward compatible during rolling deploy;
2. expand-contract pattern for breaking changes;
3. no service migration modifies another service table;
4. migration tested with production-like volume;
5. rollback/roll-forward plan exists;
6. long-running migration uses chunking;
7. online migration preferred;
8. migration emits observability signals.

### 30.1 Expand-Contract Example

Step 1: Expand

```sql
ALTER TABLE applications ADD COLUMN decision_code VARCHAR(50);
```

Step 2: Deploy app writing both old and new.

Step 3: Backfill.

Step 4: Switch reads to new column.

Step 5: Stop writing old column.

Step 6: Contract.

```sql
ALTER TABLE applications DROP COLUMN old_decision_status;
```

In microservices, consumers should not know this happened if contract remains stable.

---

## 31. Read Replica Is Not Data Ownership

A read replica is operational copy of the same database.

It helps with:

1. read scaling;
2. reporting offload;
3. backup;
4. DR.

It does not solve service ownership if consumers still query private schema directly.

```text
Direct read from replica is still direct read.
```

A read replica can reduce performance coupling but not semantic/schema coupling.

---

## 32. Event Sourcing and Data Ownership

Event sourcing stores state as events.

But event sourcing does not remove ownership questions.

If Application Service uses event sourcing:

```text
ApplicationSubmitted
ApplicationReviewed
ApplicationApproved
ApplicationWithdrawn
```

Then Application Service owns those events.

Other services should not mutate Application event stream.

They may subscribe to integration events or a published stream.

Important distinction:

```text
Internal event stream != public integration event stream.
```

Internal event stream can contain implementation detail. Public events need compatibility guarantees.

---

## 33. CQRS and Data Ownership

CQRS separates command model and query model.

It can exist inside one service or across services.

Within service:

```text
Application command model -> application_write_db
Application read model    -> application_read_db
```

Across services:

```text
Application emits events -> Report Service builds query model
```

CQRS does not mean anyone can query anyone's database. Query model still has owner.

---

## 34. Common Anti-Patterns

### 34.1 “We Have Microservices But One Big Database”

Symptom:

```text
many services, one schema, all tables accessible
```

Impact:

1. independent deployment illusion;
2. schema migration fear;
3. unclear ownership;
4. hidden business coupling.

### 34.2 Common Repository Library

Symptom:

```text
all services import shared Repository classes
```

Impact:

1. persistence model leaks everywhere;
2. service boundary collapses;
3. migration becomes global.

### 34.3 Reporting Team Has Full DB Access

Symptom:

```text
reports join all operational tables directly
```

Impact:

1. reporting query can break production;
2. schema changes break reports;
3. PII exposure;
4. no metric ownership.

### 34.4 Cache as Source of Truth

Symptom:

```text
Redis value becomes authority because DB path is slow
```

Impact:

1. data loss risk;
2. unclear recovery;
3. stale decisions;
4. audit failure.

### 34.5 Two Owners for One Fact

Symptom:

```text
Application status in Application Service
Application status also independently updated in Case Service
```

Impact:

1. inconsistency;
2. dispute;
3. hidden synchronization;
4. incorrect audit.

### 34.6 Foreign Key Across Service Boundary

Impact:

1. split becomes painful;
2. deletion/archival coupling;
3. migration coupling;
4. restore coupling.

### 34.7 Database Trigger Across Domain Boundary

Symptom:

```text
insert into application triggers insert into case
```

Impact:

1. hidden workflow;
2. hard to trace;
3. hard to test;
4. service ownership bypassed.

### 34.8 “Generic Data Service”

Symptom:

```text
Data Service exposes CRUD for all tables.
```

Impact:

1. no domain ownership;
2. anemic services;
3. business logic scattered;
4. data service becomes bottleneck.

---

## 35. Decision Matrix

### 35.1 Shared Database vs Database-per-Service

| Criterion | Shared DB | Database-per-Service |
|---|---|---|
| Initial simplicity | high | lower |
| Independent deployment | low | high |
| Strong joins | easy | harder |
| Schema evolution | hard | easier |
| Ownership clarity | low | high |
| Operational isolation | low | medium/high |
| Reporting simplicity | high initially | needs read model |
| Long-term autonomy | low | high |
| Cost | lower initially | higher |
| Compliance traceability | often weaker | stronger if governed |

### 35.2 API Composition vs Projection

| Need | API Composition | Projection |
|---|---|---|
| Real-time detail | good | maybe stale |
| Large listing | poor | good |
| Report/export | poor | good |
| Simple implementation | medium | harder |
| Freshness | high | eventual |
| Resilience | depends on fan-out | better if projection available |
| Storage duplication | low | higher |

### 35.3 Schema-per-Service vs DB-per-Service

| Criterion | Schema-per-Service | DB-per-Service |
|---|---|---|
| Migration ease | easier | harder |
| Cost | lower | higher |
| Isolation | medium | high |
| DBA control | centralized | distributed |
| Blast radius | medium | lower |
| Legacy fit | high | medium |
| Polyglot support | low | high |

---

## 36. Practical Java Design Blueprint

### 36.1 Package Boundary

```text
com.example.application
  domain
  application
  adapter.in.web
  adapter.out.persistence
  adapter.out.event
  adapter.in.event
```

Persistence adapter is internal.

External service must not import it.

### 36.2 Published API DTO

```java
public record ApplicationSummaryResponse(
        UUID applicationId,
        String referenceNo,
        String status,
        Instant submittedAt
) {}
```

### 36.3 Published Event DTO

```java
public record ApplicationStatusChangedV1(
        UUID eventId,
        UUID applicationId,
        String referenceNo,
        String previousStatus,
        String newStatus,
        Instant occurredAt,
        Instant publishedAt,
        String correlationId,
        String causationId
) {}
```

### 36.4 Internal Entity

```java
@Entity
@Table(name = "applications")
class ApplicationEntity {
    @Id
    private UUID id;

    @Column(nullable = false, unique = true)
    private String referenceNo;

    @Column(nullable = false)
    private String status;

    @Version
    private long version;
}
```

Never expose `ApplicationEntity` outside service.

### 36.5 Consumer Projection

```java
@Entity
@Table(name = "application_summary_projection")
class ApplicationSummaryProjection {
    @Id
    private UUID applicationId;
    private String referenceNo;
    private String status;
    private Instant lastChangedAt;
    private UUID lastEventId;
}
```

### 36.6 Idempotent Projection Update

```java
@Transactional
public void handle(ApplicationStatusChangedV1 event) {
    if (inboxRepository.existsByEventId(event.eventId())) {
        return;
    }

    projectionRepository.upsert(
            event.applicationId(),
            event.referenceNo(),
            event.newStatus(),
            event.occurredAt(),
            event.eventId()
    );

    inboxRepository.save(new ProcessedEvent(event.eventId(), Instant.now()));
}
```

This pattern protects against duplicate event delivery.

---

## 37. Review Checklist

Before accepting a microservice data design, ask:

### Ownership

```text
[ ] Does every table/data object have exactly one owner service?
[ ] Are all mutations routed through the owner?
[ ] Is ownership documented?
[ ] Is incident responsibility clear?
```

### Access

```text
[ ] Do service DB credentials prevent cross-service table access?
[ ] Are direct reads from private tables prohibited?
[ ] Are published read contracts explicit?
[ ] Are report queries isolated from operational DB?
```

### Consistency

```text
[ ] Are local invariants kept within one service boundary?
[ ] Are cross-service invariants classified?
[ ] Is eventual consistency acceptable for replicas/projections?
[ ] Is reconciliation defined?
```

### Query

```text
[ ] Are cross-service queries solved by API composition or projection intentionally?
[ ] Is fan-out bounded?
[ ] Is projection lag monitored?
[ ] Is stale data communicated to users if relevant?
```

### Migration

```text
[ ] Are database migrations owned by service team?
[ ] Are migrations backward compatible?
[ ] Are cross-service schema dependencies removed?
[ ] Is expand-contract strategy used?
```

### Security

```text
[ ] Is PII minimized in events/projections?
[ ] Is tenant boundary enforced?
[ ] Are data access logs available?
[ ] Is retention/deletion propagation designed?
```

### Operations

```text
[ ] Are backup/restore dependencies understood?
[ ] Are RPO/RTO defined per service?
[ ] Are outbox/projection lag monitored?
[ ] Is noisy neighbor risk controlled?
```

---

## 38. Architecture Review Questions

Use these as senior/principal-level review questions:

1. Which service owns this data, and why?
2. Which service is allowed to mutate it?
3. Which service must explain it during audit?
4. What invariant is enforced at the data owner?
5. Which consumers need current data versus snapshot data?
6. Which consumers need query-optimized projection?
7. What is the freshness SLA of each projection?
8. What happens if an event is missed?
9. How do we rebuild a projection?
10. How do we detect data drift?
11. How do we handle PII in replicated data?
12. What is the migration plan from the current state?
13. What database privileges enforce this design?
14. What reports still bypass ownership?
15. Can this service deploy schema changes independently?
16. What is the rollback/roll-forward strategy?
17. What is the backup/restore consistency story?
18. What is the cost of this separation?
19. What is the cost of not separating it?
20. If this design fails in production, who owns the incident?

---

## 39. Common Real-World Compromises

Top engineers are not dogmatic. They know when to compromise and how to contain compromise.

### 39.1 Temporary Shared Schema

Acceptable if:

1. access is restricted by schema/user;
2. ownership is documented;
3. no cross-service writes;
4. migration plan exists;
5. target architecture is clear.

### 39.2 Reporting Direct Access During Transition

Acceptable if:

1. read-only;
2. limited views, not base tables;
3. monitored;
4. versioned;
5. planned replacement with reporting store.

### 39.3 Shared Reference Data Database

Acceptable if:

1. it is treated as product;
2. changes are versioned;
3. consumers do not mutate directly;
4. effective dates are supported;
5. cache/replica rules are clear.

### 39.4 Single Physical DB, Multiple Service Schemas

Acceptable as intermediate step if:

1. credentials enforce boundary;
2. schema ownership is real;
3. no cross-schema joins in application runtime;
4. resource contention is monitored;
5. later physical split remains possible.

---

## 40. Exercise 1: Identify Data Owners

Given modules:

```text
Application
Case
Compliance
Profile
Document
Revenue
Correspondence
Audit
Notification
Report
```

Classify owner for:

```text
applicant name
applicant name at submission
case assignment
case escalation reason
payment settlement status
document checksum
email delivery status
audit actor IP
monthly report metric
license category code
```

Expected reasoning:

```text
applicant name -> Profile Service owns canonical current value
applicant name at submission -> Application Service owns snapshot
case assignment -> Case Service
case escalation reason -> Case/Compliance depending on lifecycle
payment settlement status -> Revenue/Payment Service
entity document checksum -> Document Service
email delivery status -> Notification/Correspondence depending boundary
audit actor IP -> Audit Service
monthly report metric -> Report Service owns metric, sources operational events
license category code -> Reference/License Catalog Service
```

---

## 41. Exercise 2: Replace Shared Join

Current query:

```sql
SELECT a.reference_no,
       a.status,
       p.name,
       c.case_status,
       pay.payment_status
FROM application a
JOIN profile p ON p.id = a.profile_id
LEFT JOIN case c ON c.application_id = a.id
LEFT JOIN payment pay ON pay.application_id = a.id
WHERE a.status = 'PENDING';
```

Design alternatives:

### Option A: API Composition

Good for detail page, not listing.

### Option B: Application Listing Projection

Events:

```text
ApplicationSubmitted
ApplicationStatusChanged
ProfileSnapshotCaptured
CaseOpened
CaseStatusChanged
PaymentStatusChanged
```

Projection table:

```text
application_listing_projection
  application_id
  reference_no
  application_status
  applicant_name_snapshot
  case_status
  payment_status
  last_updated_at
```

### Option C: Reporting Store

For reports/export/analytics.

---

## 42. Exercise 3: Shared DB Migration Plan

Current state:

```text
Application Service writes APPLICATION.
Case Service writes APPLICATION.status directly.
Report Service reads APPLICATION, CASE, PAYMENT.
Notification Service reads APPLICATION.email directly.
```

Target:

```text
Application Service owns APPLICATION.
Case Service requests transition via Application API/event.
Report Service consumes projections.
Notification Service receives event with notification-safe data.
```

Migration steps:

1. identify all APPLICATION readers/writers;
2. freeze new direct access;
3. replace Case Service write with Application transition API;
4. publish ApplicationStatusChanged event;
5. create Report projection;
6. migrate Report queries;
7. emit notification event;
8. remove Notification direct DB read;
9. restrict DB credentials;
10. split schema/database when safe.

---

## 43. Top 1% Mental Model

A top engineer does not ask only:

```text
Should each microservice have its own database?
```

They ask:

```text
What fact is this?
Who has authority over it?
Who is accountable for its correctness?
What invariant depends on it?
Who needs current value?
Who needs historical snapshot?
Who needs query-optimized copy?
What is the consistency SLA?
What is the failure mode if copy is stale?
What is the audit implication?
What is the migration path?
What is the operational cost?
What compromise are we making consciously?
```

This is the difference between pattern memorization and architecture judgment.

---

## 44. Summary

Database-per-service is not a dogma about physical database count. It is a discipline of **data ownership**.

The core rule:

```text
A service owns its data if it owns the meaning, lifecycle, mutation, invariant, publication, security, audit, and operational responsibility of that data.
```

Shared database is attractive because it makes joins and transactions easy. But it often destroys service autonomy, hides coupling, blurs ownership, weakens auditability, and makes independent deployment unrealistic.

Database-per-service introduces new complexity: cross-service queries, eventual consistency, duplicated data, projections, reconciliation, reporting stores, backup coordination, and governance. But those complexities are explicit and can be engineered.

For enterprise Java systems, the practical path is often incremental:

```text
shared tables
→ ownership matrix
→ stop new violations
→ remove cross-service writes
→ replace direct reads
→ published APIs/events/views
→ projections/reporting store
→ credential enforcement
→ schema/database split
→ operational maturity
```

The goal is not purity. The goal is controlled autonomy.

---

## 45. References

- Microservices.io — Database per Service Pattern: `https://microservices.io/patterns/data/database-per-service.html`
- Microservices.io — Shared Database Pattern: `https://microservices.io/patterns/data/shared-database.html`
- Microservices.io — API Composition, CQRS, Saga, Transactional Outbox pattern language: `https://microservices.io/patterns/`
- Microsoft Azure Architecture Center — Data considerations for microservices: `https://learn.microsoft.com/en-us/azure/architecture/microservices/design/data-considerations`
- Microsoft Azure Architecture Center — Microservices design guidance: `https://learn.microsoft.com/en-us/azure/architecture/microservices/design/`
- AWS Prescriptive Guidance — Database-per-service pattern: `https://docs.aws.amazon.com/prescriptive-guidance/latest/modernization-data-persistence/database-per-service.html`
- Martin Fowler — Microservices and decentralized data management: `https://martinfowler.com/articles/microservices.html`
- Martin Fowler — Bounded Context: `https://martinfowler.com/bliki/BoundedContext.html`
- Martin Fowler — Event Sourcing and CQRS related writing: `https://martinfowler.com/eaaDev/EventSourcing.html`

---

## 46. Status Seri

Kita sudah menyelesaikan:

```text
Part 0  - Introduction and Mental Model
Part 1  - Distributed Systems Reality
Part 2  - Service Boundary Engineering
Part 3  - Domain Modeling for Microservices
Part 4  - Microservice Architecture Styles
Part 5  - Synchronous API Communication
Part 6  - Asynchronous Messaging
Part 7  - Event-Driven Architecture Deep Dive
Part 8  - Transaction, Saga, and Compensation
Part 9  - Transactional Outbox, Inbox, CDC, and Reliable Publishing
Part 10 - Consistency Pattern and Distributed Invariants
Part 11 - Data Ownership and Database-per-Service Pattern
```

Seri **belum selesai**.

Part berikutnya:

```text
Part 12 - Query Pattern: API Composition, CQRS, and Materialized Views
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-microservices-patterns-advanced-engineering-10-consistency-and-distributed-invariants.md">⬅️ Part 10 — Consistency Pattern and Distributed Invariants</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-microservices-patterns-advanced-engineering-12-query-pattern-api-composition-cqrs-materialized-view.md">Learn Java Microservices Patterns — Advanced Engineering ➡️</a>
</div>
