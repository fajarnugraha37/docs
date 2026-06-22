# learn-mysql-mastery-for-java-engineers-part-032.md

# Part 032 — MySQL in Distributed Systems and Microservices

> Seri: `learn-mysql-mastery-for-java-engineers`  
> Bagian: `032 / 034`  
> Fokus: bagaimana menggunakan MySQL dengan benar di sistem terdistribusi, microservices, event-driven architecture, CDC, outbox, saga, read model, dan multi-region constraint.

---

## 0. Tujuan Bagian Ini

Sampai bagian sebelumnya, kita sudah membahas MySQL sebagai database engine: storage, index, transaction, locking, replication, HA, backup, migration, security, observability, incident response, concurrency pattern, partitioning, dan JSON/semi-structured data.

Bagian ini menaikkan perspektif dari satu database menjadi **sistem terdistribusi**.

Pertanyaan utamanya bukan lagi:

> “Bagaimana satu query dijalankan?”

Tetapi:

> “Bagaimana MySQL berperilaku ketika menjadi bagian dari banyak service, banyak database, event stream, cache, search index, read model, reporting store, dan mungkin beberapa region?”

Sebagai Java software engineer, ini penting karena banyak bug arsitektural tidak muncul dari SQL yang salah, tetapi dari asumsi keliru seperti:

- “kalau sudah commit di DB, event pasti terkirim”
- “kalau event terkirim, database pasti sudah update”
- “kalau replica ada, read pasti konsisten”
- “kalau pakai microservices, setiap service bebas punya data sendiri tanpa konsekuensi”
- “kalau pakai Kafka, konsistensi selesai”
- “kalau MySQL bisa replication, berarti bisa multi-region active-active dengan mudah”
- “kalau ada foreign key, boundary service sudah benar”

Bagian ini akan membangun mental model yang lebih keras:

> MySQL adalah sistem transaksi lokal yang sangat kuat, tetapi bukan koordinator global untuk semua efek samping di distributed system.

---

## 1. Mental Model: MySQL adalah Local Consistency Boundary

Dalam satu instance/topology MySQL, terutama pada satu primary InnoDB, kita bisa mendapatkan properti kuat:

- atomic transaction
- row-level locking
- MVCC
- durable commit
- uniqueness constraint
- foreign key dalam satu database
- isolation sesuai konfigurasi
- rollback lokal
- crash recovery lokal

Tetapi ketika sistem melibatkan lebih dari satu resource, contoh:

- MySQL + Kafka
- MySQL + Redis
- MySQL + Elasticsearch
- MySQL + S3/object storage
- MySQL + external payment system
- MySQL + email gateway
- MySQL service A + MySQL service B
- MySQL primary region + another region

maka transaksi MySQL tidak otomatis mencakup semua resource itu.

### 1.1 Boundary yang benar

Dalam microservices, boundary paling penting adalah:

```text
MySQL transaction boundary != business transaction boundary
```

Contoh business transaction:

```text
Open enforcement case
  -> create case
  -> assign officer
  -> reserve SLA clock
  -> notify supervisor
  -> index case for search
  -> emit audit/event
  -> maybe update reporting projection
```

Semua itu mungkin tidak bisa, dan sering tidak seharusnya, berada dalam satu transaksi database tunggal.

MySQL transaction bisa menjamin:

```text
case row inserted
assignment row inserted
audit_outbox row inserted
```

secara atomik dalam satu database.

Tapi MySQL tidak bisa otomatis menjamin:

```text
Kafka publish succeeded
Elasticsearch index updated
email delivered
other service accepted command
analytics projection refreshed
```

kecuali kita mendesain mekanisme tambahan.

---

## 2. Monolith, Modular Monolith, dan Microservices dengan MySQL

Sebelum bicara microservices, penting membedakan beberapa model.

### 2.1 Monolith dengan satu database

Model:

```text
One application
One MySQL database
Many modules
One deployment unit
```

Keuntungan:

- transaksi lintas modul mudah
- foreign key mudah
- query lintas entity mudah
- reporting sederhana
- consistency lebih mudah dipahami

Risiko:

- coupling tinggi
- schema menjadi shared global object
- ownership kabur
- deploy besar
- scaling organisasi sulit

Untuk banyak organisasi, ini bukan kegagalan. Monolith yang modular dan disiplin sering lebih baik daripada microservices yang prematur.

### 2.2 Modular monolith dengan schema ownership

Model:

```text
One application
One database
Schema dibagi per bounded context/module
Boundary dijaga di kode dan migration
```

Contoh:

```text
case_management.case
case_management.case_assignment
case_management.case_event

enforcement.action
enforcement.sanction

audit.audit_event
workflow.task
```

Keuntungan:

- masih punya local transaction
- lebih mudah menjaga consistency
- module ownership mulai jelas
- migration tetap manageable

Risiko:

- database masih bisa menjadi “jalan pintas” coupling
- developer bisa join lintas boundary tanpa sadar
- constraint lintas module menggoda

### 2.3 Microservices database-per-service

Model:

```text
Service A -> MySQL A
Service B -> MySQL B
Service C -> MySQL C
```

Setiap service memiliki database sendiri, bukan sekadar schema sendiri.

Keuntungan:

- ownership jelas
- deploy lebih independen
- schema change lebih lokal
- scaling teknis dan organisasi lebih modular

Biaya:

- tidak ada local transaction lintas service
- join lintas service tidak langsung
- referential integrity global tidak otomatis
- reporting lebih sulit
- consistency menjadi eventual di banyak tempat
- debugging lebih kompleks
- data duplication menjadi normal
- event ordering dan idempotency menjadi wajib

### 2.4 Kesalahan umum

Kesalahan paling sering adalah mengambil biaya microservices tanpa mendapatkan manfaatnya.

Contoh buruk:

```text
Service A punya DB A
Service B punya DB B
Tetapi Service A membaca langsung DB B
Service B menulis langsung DB A
Reporting join langsung semua DB
Migration lintas service harus disinkronkan manual
```

Ini bukan microservices yang sehat. Ini distributed monolith dengan failure mode lebih buruk.

---

## 3. Database-per-Service: Aturan dan Konsekuensi

Prinsip database-per-service:

> Service adalah satu-satunya pemilik data persistence-nya.

Artinya:

- service lain tidak boleh read langsung tabelnya
- service lain tidak boleh write langsung tabelnya
- schema internal bukan public contract
- public contract adalah API/event
- perubahan schema internal tidak boleh memaksa semua consumer berubah

### 3.1 Kenapa direct DB access berbahaya?

Misal service `case-service` punya tabel:

```sql
case_file(id, status, assigned_officer_id, created_at, updated_at)
```

Lalu `reporting-service` membaca langsung tabel tersebut.

Awalnya terlihat efisien. Tapi kemudian `case-service` ingin refactor:

```text
status dipindah ke case_state_history
assigned_officer_id dipindah ke assignment table
soft delete ditambahkan
case_file di-partition
```

Jika consumer membaca langsung DB, schema internal menjadi public API diam-diam.

Akibat:

- migration sulit
- service tidak bisa evolve independen
- ownership rusak
- performance `case-service` bisa terganggu oleh query reporting
- privilege membesar
- audit access lebih sulit

### 3.2 Alternatif yang lebih sehat

Consumer mendapatkan data melalui:

1. synchronous API
2. event stream
3. replicated read model
4. materialized projection
5. data warehouse/lake untuk analytics

Pilihan tergantung kebutuhan:

| Kebutuhan | Mekanisme |
|---|---|
| Butuh data real-time kuat | synchronous API ke owner service |
| Butuh update eventual | domain event / CDC |
| Butuh query lokal cepat | read model projection |
| Butuh analytical query besar | warehouse/OLAP |
| Butuh full-text/fuzzy search | search index |

---

## 4. Shared Database Anti-Pattern

Shared database anti-pattern terjadi ketika beberapa service independen berbagi database yang sama dan memperlakukan tabel satu sama lain sebagai milik bersama.

```text
case-service  ----+
                  +--> shared_mysql
workflow-service -+
audit-service ----+
reporting-service+
```

Masalahnya bukan sekadar “satu database”. Masalah utamanya adalah **ownership kabur**.

### 4.1 Gejala shared database anti-pattern

- semua service punya akses read/write luas
- migration harus disetujui banyak tim
- satu service menulis tabel milik service lain
- foreign key lintas bounded context terlalu banyak
- trigger dipakai untuk koordinasi bisnis lintas service
- stored procedure menjadi integration layer tersembunyi
- reporting query mengunci atau memperberat OLTP
- tidak jelas siapa pemilik data definition

### 4.2 Kapan shared database masih masuk akal?

Ada situasi transisional atau pragmatis:

- modular monolith
- early-stage system
- satu tim kecil
- sistem internal dengan beban rendah
- legacy system belum siap dipecah
- regulatory system yang butuh strong consistency lokal dan belum punya maturity event-driven

Tetapi harus jujur: itu berarti kita belum benar-benar punya microservices database independence.

### 4.3 Cara memperbaiki bertahap

Strategi evolusi:

1. identifikasi ownership tabel
2. batasi write hanya oleh owner module/service
3. buat read API atau read model untuk consumer
4. ubah consumer dari direct table read ke contract
5. pisahkan migration ownership
6. baru pertimbangkan split database fisik

Jangan mulai dengan memecah database fisik kalau ownership logical belum jelas.

---

## 5. Cross-Service Transaction: Masalah yang Tidak Hilang

Dalam monolith:

```java
@Transactional
public void approveCase(...) {
    caseRepository.approve(...);
    workflowRepository.completeTask(...);
    auditRepository.insert(...);
}
```

Jika semua repository memakai satu MySQL transaction, atomicity mudah.

Dalam microservices:

```text
case-service approves case
workflow-service completes task
audit-service records event
notification-service sends message
```

Tidak ada satu transaksi lokal yang mencakup semua.

### 5.1 Distributed transaction / 2PC

Secara teori, two-phase commit bisa mengoordinasikan banyak resource.

Tapi dalam sistem modern, 2PC sering dihindari karena:

- blocking behavior
- operational complexity
- coordinator failure mode
- resource lock lebih lama
- tidak semua resource mendukung dengan baik
- sulit untuk HTTP/event-based service
- latency tinggi
- coupling kuat

Untuk kebanyakan microservices, pendekatannya adalah:

```text
local transaction + reliable message + eventual consistency + compensating action
```

### 5.2 Business atomicity vs technical atomicity

Jangan menipu diri dengan mengatakan semua harus atomik secara teknis.

Pertanyaan yang lebih tepat:

- Apa invariant yang benar-benar harus atomik?
- Apa yang boleh eventual?
- Apa yang harus bisa direkonsiliasi?
- Apa yang harus idempotent?
- Apa yang harus dapat diaudit?
- Apa yang harus memiliki compensating workflow?

Contoh:

```text
Invariant kuat:
- satu case tidak boleh approved dua kali
- approved case harus punya approver dan timestamp
- status transition harus valid
- audit intent harus tercatat bersama perubahan state

Eventual:
- search index update
- notification delivery
- reporting projection
- SLA dashboard refresh
```

---

## 6. Outbox Pattern: Mengikat DB Commit dan Event secara Aman

Masalah klasik:

```java
@Transactional
public void approveCase(UUID caseId) {
    caseRepository.approve(caseId);
    kafkaTemplate.send("case.approved", event);
}
```

Ada dua resource:

1. MySQL
2. Kafka

Failure scenarios:

| Scenario | Akibat |
|---|---|
| DB commit success, Kafka send failed | state berubah tapi event hilang |
| Kafka send success, DB rollback | event palsu terkirim |
| App crash setelah DB update sebelum Kafka send | event hilang |
| Retry method tanpa idempotency | duplicate update/event |

### 6.1 Prinsip outbox

Outbox menyimpan event sebagai row dalam transaksi yang sama dengan perubahan state.

```sql
CREATE TABLE outbox_event (
    id              BINARY(16) PRIMARY KEY,
    aggregate_type  VARCHAR(100) NOT NULL,
    aggregate_id    BINARY(16) NOT NULL,
    event_type      VARCHAR(100) NOT NULL,
    event_version   INT NOT NULL,
    payload         JSON NOT NULL,
    status          VARCHAR(30) NOT NULL,
    created_at      DATETIME(6) NOT NULL,
    published_at    DATETIME(6) NULL,
    retry_count     INT NOT NULL DEFAULT 0,
    last_error      TEXT NULL,
    UNIQUE KEY uq_outbox_aggregate_event (aggregate_type, aggregate_id, event_type, event_version),
    KEY idx_outbox_status_created (status, created_at)
);
```

Transaction:

```text
BEGIN
  update case state
  insert audit/event history
  insert outbox_event(status='NEW')
COMMIT
```

Publisher process:

```text
poll NEW outbox rows
publish to broker
mark as PUBLISHED
```

Atau CDC:

```text
read outbox table change from binlog
publish to broker
```

### 6.2 Invariant outbox

Outbox menjamin:

```text
Jika state change committed, event intent committed.
Jika state change rolled back, event intent tidak committed.
```

Outbox **tidak** menjamin:

- event hanya dikirim sekali secara global
- consumer hanya memproses sekali
- broker tidak duplicate
- ordering sempurna lintas aggregate

Karena itu, consumer tetap harus idempotent.

### 6.3 Polling outbox dengan SKIP LOCKED

Contoh worker:

```sql
SELECT id
FROM outbox_event
WHERE status = 'NEW'
ORDER BY created_at, id
LIMIT 100
FOR UPDATE SKIP LOCKED;
```

Lalu dalam transaksi:

```text
claim rows -> set status PROCESSING
commit
publish outside transaction or with bounded transaction strategy
mark PUBLISHED
```

Tetapi hati-hati: publish ke Kafka tidak bisa di-rollback oleh MySQL. Desain harus menerima duplicate publish.

### 6.4 Status machine outbox

Status sederhana:

```text
NEW -> PROCESSING -> PUBLISHED
              \-> FAILED_RETRYABLE
              \-> FAILED_PERMANENT
```

Lebih robust:

```text
NEW
CLAIMED
PUBLISHING
PUBLISHED
FAILED
DEAD_LETTER
```

Kolom tambahan:

```sql
locked_by VARCHAR(100) NULL,
locked_until DATETIME(6) NULL,
next_attempt_at DATETIME(6) NOT NULL,
retry_count INT NOT NULL,
trace_id VARCHAR(100) NULL
```

### 6.5 Outbox untuk regulatory system

Dalam enforcement lifecycle:

```text
case status changed to UNDER_REVIEW
```

Dalam satu transaksi:

- update `case_file.status`
- insert `case_state_history`
- insert `audit_record`
- insert `outbox_event` dengan event `CaseStatusChanged`

Event consumer bisa:

- update search index
- update SLA projection
- notify officer
- update dashboard
- send data to reporting service

Jika consumer gagal, source-of-truth tetap aman.

---

## 7. CDC: Change Data Capture dari MySQL Binlog

CDC membaca perubahan database, biasanya dari binary log, lalu mengirimkannya ke downstream system.

Arsitektur umum:

```text
MySQL binlog -> CDC connector -> Kafka topic -> consumers/projections
```

Tool umum:

- Debezium
- Kafka Connect JDBC/CDC connectors
- custom binlog reader
- cloud-native CDC service

### 7.1 CDC row-level vs domain event

CDC raw table event:

```json
{
  "table": "case_file",
  "op": "u",
  "before": {"status": "OPEN"},
  "after": {"status": "UNDER_REVIEW"}
}
```

Domain event:

```json
{
  "eventType": "CaseSubmittedForReview",
  "caseId": "...",
  "submittedBy": "...",
  "submittedAt": "...",
  "reason": "..."
}
```

Perbedaan penting:

| Aspek | Raw CDC | Domain Event |
|---|---|---|
| Source | table mutation | business intent |
| Semantik | rendah | tinggi |
| Consumer coupling | ke schema | ke contract event |
| Mudah dibuat | ya | perlu desain |
| Cocok untuk replication/projection | ya | ya |
| Cocok untuk audit bisnis | tidak selalu | lebih cocok |

### 7.2 Outbox + CDC

Kombinasi yang kuat:

```text
Application writes domain event into outbox table
CDC reads outbox table from binlog
CDC publishes event to Kafka
```

Keuntungan:

- aplikasi tidak perlu polling outbox
- event tied to DB commit
- event berisi domain semantics
- publisher lebih terstandardisasi

### 7.3 Risiko CDC

CDC bukan magic.

Risiko:

- schema change breaking connector
- binlog retention terlalu pendek
- connector lag
- duplicate events after restart
- event ordering nuance
- transaction boundary mapping
- snapshot initial load complexity
- sensitive data leakage ke stream
- consumer coupling ke internal schema jika raw CDC dipakai sembarangan

### 7.4 Desain event contract

Event harus punya:

```json
{
  "eventId": "unique-id",
  "eventType": "CaseStatusChanged",
  "eventVersion": 3,
  "occurredAt": "2026-06-22T10:15:30.123Z",
  "aggregateType": "Case",
  "aggregateId": "...",
  "sequence": 42,
  "producer": "case-service",
  "traceId": "...",
  "payload": { }
}
```

Field penting:

- `eventId` untuk idempotency
- `eventVersion` untuk schema evolution
- `aggregateId` untuk partitioning/order
- `sequence` untuk per-aggregate ordering
- `occurredAt` untuk business time
- `traceId` untuk observability

---

## 8. Event Ordering: Global Order Biasanya Ilusi

Banyak engineer ingin event order sempurna:

```text
Event A happened before Event B, maka semua consumer harus melihat A sebelum B.
```

Dalam distributed system, global order mahal dan sering tidak perlu.

Lebih realistis:

```text
Per-aggregate order lebih penting daripada global order.
```

Contoh:

```text
case-123:
  1. CaseCreated
  2. CaseSubmitted
  3. CaseApproved

case-999:
  1. CaseCreated
  2. CaseClosed
```

Tidak terlalu penting apakah `case-123 CaseApproved` diproses sebelum `case-999 CaseCreated`, selama urutan untuk case yang sama benar.

### 8.1 Partitioning event stream

Jika memakai Kafka, pilih key:

```text
key = aggregateId
```

Maka event untuk aggregate yang sama masuk partition yang sama dan urut dalam partition.

### 8.2 Sequence number di database

Untuk aggregate event table:

```sql
CREATE TABLE case_event (
    case_id BINARY(16) NOT NULL,
    sequence_no BIGINT NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    payload JSON NOT NULL,
    created_at DATETIME(6) NOT NULL,
    PRIMARY KEY (case_id, sequence_no)
);
```

Constraint:

```text
(case_id, sequence_no) unique
```

Menjamin urutan per case.

### 8.3 Consumer handling out-of-order

Consumer harus bisa menghadapi:

- duplicate
- late arrival
- missing event sementara
- replay
- schema version berbeda

Strategi:

- store processed `event_id`
- store last processed sequence per aggregate
- buffer jika sequence gap
- reject stale event
- rebuild projection dari event log/source jika perlu

---

## 9. Idempotent Consumer: Wajib, Bukan Optional

Dalam event-driven system, duplicate event adalah normal.

Sumber duplicate:

- publisher retry
- broker redelivery
- consumer crash setelah side effect sebelum commit offset
- CDC restart
- manual replay
- network timeout ambiguity

### 9.1 Pattern processed event table

```sql
CREATE TABLE processed_event (
    consumer_name VARCHAR(100) NOT NULL,
    event_id BINARY(16) NOT NULL,
    processed_at DATETIME(6) NOT NULL,
    PRIMARY KEY (consumer_name, event_id)
);
```

Consumer transaction:

```text
BEGIN
  insert into processed_event(consumer_name, event_id)
  if duplicate -> already processed -> commit/skip
  apply projection/business update
COMMIT
```

Contoh SQL:

```sql
INSERT INTO processed_event (consumer_name, event_id, processed_at)
VALUES (?, ?, CURRENT_TIMESTAMP(6));
```

Jika duplicate key, jangan proses ulang.

### 9.2 Idempotency dengan natural business key

Kadang lebih baik memakai unique constraint bisnis.

Contoh:

```sql
CREATE TABLE notification_request (
    id BINARY(16) PRIMARY KEY,
    idempotency_key VARCHAR(200) NOT NULL,
    recipient VARCHAR(255) NOT NULL,
    template_code VARCHAR(100) NOT NULL,
    payload JSON NOT NULL,
    status VARCHAR(30) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    UNIQUE KEY uq_notification_idempotency (idempotency_key)
);
```

Event duplicate menghasilkan constraint conflict, bukan side effect ganda.

### 9.3 Idempotency bukan hanya consumer

Idempotency diperlukan di:

- HTTP command endpoint
- message consumer
- scheduled job
- retry worker
- migration backfill
- external callback handler
- payment/webhook integration

---

## 10. Saga: Business Transaction sebagai State Machine

Saga adalah pola untuk menjalankan proses bisnis lintas service tanpa distributed transaction tunggal.

Alih-alih:

```text
one global transaction
```

Saga menggunakan:

```text
series of local transactions + events/commands + compensation
```

### 10.1 Choreography saga

Service bereaksi terhadap event satu sama lain.

```text
CaseSubmitted
  -> workflow-service creates review task
  -> notification-service sends notification
  -> sla-service starts timer
```

Keuntungan:

- loose coupling
- tidak ada central orchestrator
- mudah tambah consumer

Risiko:

- flow sulit dilihat
- debugging sulit
- hidden coupling via events
- compensation tersebar

### 10.2 Orchestration saga

Ada orchestrator yang mengatur langkah.

```text
case-approval-orchestrator:
  1. request workflow complete
  2. request sanction draft
  3. request audit record
  4. request notification
```

Keuntungan:

- flow jelas
- status saga eksplisit
- retry/timeout terpusat
- cocok untuk proses regulatori kompleks

Risiko:

- orchestrator bisa menjadi coupling point
- harus dirancang sebagai state machine yang durable

### 10.3 Saga table

```sql
CREATE TABLE saga_instance (
    id BINARY(16) PRIMARY KEY,
    saga_type VARCHAR(100) NOT NULL,
    business_key VARCHAR(200) NOT NULL,
    state VARCHAR(100) NOT NULL,
    payload JSON NOT NULL,
    version BIGINT NOT NULL,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    UNIQUE KEY uq_saga_business_key (saga_type, business_key)
);
```

```sql
CREATE TABLE saga_step (
    saga_id BINARY(16) NOT NULL,
    step_name VARCHAR(100) NOT NULL,
    status VARCHAR(30) NOT NULL,
    attempt_count INT NOT NULL,
    last_error TEXT NULL,
    updated_at DATETIME(6) NOT NULL,
    PRIMARY KEY (saga_id, step_name)
);
```

### 10.4 Compensation bukan rollback

Compensation bukan rollback teknis.

Rollback:

```text
undo uncommitted transaction
```

Compensation:

```text
make a new business action to offset prior committed action
```

Contoh:

```text
Jika sanction notice sudah dikirim, kita tidak bisa “unsend”.
Compensation mungkin berupa “send correction notice” atau “mark notice superseded”.
```

Dalam regulatory system, compensation harus audit-friendly.

Jangan menghapus jejak. Tambahkan event korektif.

---

## 11. Referential Integrity Across Services

Dalam satu database, kita bisa punya foreign key:

```sql
case_file.assigned_officer_id -> officer.id
```

Dalam microservices:

```text
case-service owns case
identity-service owns officer/user
```

Foreign key lintas database/service tidak tersedia secara lokal.

### 11.1 Apa penggantinya?

Bukan satu mekanisme, tapi kombinasi:

- API validation saat command diterima
- local reference cache/projection
- event-driven synchronization
- periodic reconciliation
- defensive UI/service design
- soft reference dengan business key
- tombstone/deactivation event

### 11.2 Reference data replication

Misal `identity-service` publish:

```text
OfficerCreated
OfficerUpdated
OfficerDeactivated
```

`case-service` menyimpan local projection:

```sql
CREATE TABLE officer_reference (
    officer_id BINARY(16) PRIMARY KEY,
    display_name VARCHAR(255) NOT NULL,
    active BOOLEAN NOT NULL,
    version BIGINT NOT NULL,
    updated_at DATETIME(6) NOT NULL
);
```

Saat assign case:

```text
case-service checks local officer_reference.active = true
```

Ini eventual, tetapi cepat dan resilient.

### 11.3 Reconciliation

Karena eventual consistency bisa drift, siapkan reconciliation job:

```text
compare active case assignments with identity-service officer state
report invalid references
trigger corrective workflow
```

Dalam sistem regulatori, reconciliation bukan tambahan mewah; ia adalah kontrol defensibility.

---

## 12. Reporting Database dan Read Model Projection

OLTP MySQL schema biasanya tidak ideal untuk reporting berat.

Masalah query reporting langsung ke primary:

- join besar
- full scan
- temp table besar
- lock/IO pressure
- buffer pool pollution
- latency spike untuk transaksi user
- schema owner terganggu oleh kebutuhan report

### 12.1 Read model

Read model adalah representasi data yang didesain untuk query tertentu.

Contoh OLTP:

```text
case_file
case_state_history
case_assignment
case_party
case_document
sla_clock
enforcement_action
```

Read model dashboard:

```sql
CREATE TABLE case_dashboard_view (
    case_id BINARY(16) PRIMARY KEY,
    case_number VARCHAR(100) NOT NULL,
    current_status VARCHAR(50) NOT NULL,
    assigned_officer_id BINARY(16) NULL,
    assigned_officer_name VARCHAR(255) NULL,
    risk_level VARCHAR(30) NULL,
    sla_due_at DATETIME(6) NULL,
    overdue BOOLEAN NOT NULL,
    last_activity_at DATETIME(6) NOT NULL,
    KEY idx_dashboard_queue (assigned_officer_id, current_status, overdue, sla_due_at),
    KEY idx_dashboard_status_due (current_status, sla_due_at)
);
```

Projection diupdate oleh event consumer.

### 12.2 Trade-off read model

Keuntungan:

- query cepat
- index disesuaikan kebutuhan UI
- service owner bebas evolve OLTP schema
- reporting tidak membebani primary transaction table

Biaya:

- eventual consistency
- projection lag
- duplicate data
- rebuild logic
- idempotency consumer
- schema versioning event

### 12.3 Rebuildable projection

Read model idealnya rebuildable.

Sumber rebuild:

- event log
- source database snapshot + event catch-up
- canonical API paging
- CDC snapshot

Simpan metadata:

```sql
CREATE TABLE projection_checkpoint (
    projection_name VARCHAR(100) PRIMARY KEY,
    last_event_id BINARY(16) NULL,
    last_sequence BIGINT NULL,
    updated_at DATETIME(6) NOT NULL
);
```

---

## 13. Cache dengan MySQL: Redis Tidak Menghapus Masalah Konsistensi

Cache sering dipakai untuk mengurangi read load.

Tetapi cache menambahkan masalah:

- stale data
- invalidation complexity
- cache stampede
- thundering herd
- cache/database inconsistency
- hidden dependency

### 13.1 Cache-aside pattern

```text
read request
  -> check cache
  -> miss: read MySQL
  -> put cache
  -> return
```

Write:

```text
update MySQL
invalidate cache
```

Failure:

```text
DB commit success, cache invalidation failed -> stale cache
```

### 13.2 Safer cache mindset

Cache should be:

- disposable
- rebuildable
- TTL-bound
- not source of truth
- used for data that tolerates staleness

Untuk data regulatory state yang kritis:

```text
approval decision, sanction status, legal deadline
```

jangan jadikan cache sebagai sumber keputusan akhir.

### 13.3 Cache invalidation via outbox/event

Alih-alih invalidasi langsung di transaksi bisnis:

```text
DB commit -> outbox event -> cache invalidation consumer
```

Masih eventual, tapi reliable dan observable.

---

## 14. Search Index dengan MySQL: Boundary dengan Elasticsearch/OpenSearch

MySQL punya FULLTEXT dan JSON tools, tetapi bukan search engine umum sekuat Elasticsearch/OpenSearch.

Gunakan MySQL untuk:

- exact lookup
- relational filtering
- transactional source of truth
- constrained full-text sederhana
- low/medium volume search

Gunakan search engine untuk:

- fuzzy search
- relevance ranking kompleks
- typo tolerance
- stemming/language analyzer
- high-cardinality faceted search
- large document search
- cross-entity search

### 14.1 Source of truth

Search index bukan source of truth.

```text
MySQL = canonical truth
Search index = derived projection
```

Jika search result mengatakan case ada, detail final tetap harus divalidasi ke owner service/MySQL jika keputusan kritis.

### 14.2 Search consistency pattern

Write flow:

```text
case-service writes MySQL + outbox event
search-indexer consumes event
updates search index
```

Search flow:

```text
user searches index
gets case IDs
case-service fetches authoritative details
```

Atau untuk dashboard low-risk:

```text
search index returns denormalized summary
user opens detail -> fetch authoritative data
```

### 14.3 Failure modes

- indexing lag
- missing document
- duplicate document
- stale status
- deleted case still searchable
- permission changes not reflected
- schema mapping mismatch

Controls:

- projection lag metric
- reindex pipeline
- reconciliation job
- version field
- tombstone event
- access-control filtering at query or detail fetch

---

## 15. Multi-Tenant Systems dengan MySQL

Distributed system sering juga multi-tenant.

Model umum:

1. shared database, shared schema
2. shared database, separate schema
3. separate database per tenant
4. separate cluster per tenant/tier

### 15.1 Shared schema

```sql
case_file(
  tenant_id BINARY(16) NOT NULL,
  id BINARY(16) NOT NULL,
  ...,
  PRIMARY KEY (tenant_id, id)
)
```

Keuntungan:

- operasional sederhana
- resource efisien
- query bisa dibuat tenant-scoped

Risiko:

- noisy neighbor
- data leakage bug
- tenant-based retention lebih sulit
- large tenant mendominasi index/statistics

### 15.2 Database per tenant

Keuntungan:

- isolation kuat
- restore per tenant lebih mudah
- noisy neighbor lebih rendah
- compliance kadang lebih mudah

Risiko:

- migration banyak database
- connection pool explosion
- monitoring lebih kompleks
- backup/restore orchestration lebih rumit
- cross-tenant analytics sulit

### 15.3 Prinsip tenant invariant

Di shared schema, hampir semua query harus punya tenant predicate.

Buruk:

```sql
SELECT * FROM case_file WHERE id = ?;
```

Lebih aman:

```sql
SELECT * FROM case_file WHERE tenant_id = ? AND id = ?;
```

Index:

```sql
PRIMARY KEY (tenant_id, id)
KEY idx_tenant_status_due (tenant_id, status, due_at)
```

Dalam Java, tenant context harus menjadi bagian dari command/query boundary, bukan optional filter UI.

---

## 16. MySQL dan Multi-Region: Bagian yang Sering Diremehkan

MySQL single-primary replication sangat umum untuk HA/read scaling, tetapi multi-region aktif-aktif adalah masalah berbeda.

### 16.1 Single primary, remote replicas

```text
Region A primary
Region B replica
Region C replica
```

Keuntungan:

- write consistency sederhana
- DR lebih mudah
- read dekat user bisa dilakukan dengan replica untuk data yang toleran stale

Risiko:

- write latency untuk user jauh
- failover region kompleks
- replica lag lintas region
- stale read

### 16.2 Active-active writes

```text
Region A accepts writes
Region B accepts writes
Both replicate somehow
```

Masalah:

- conflict resolution
- duplicate IDs
- last-write-wins kehilangan update
- uniqueness global sulit
- ordering lintas region sulit
- clock skew
- legal/audit conflict semantics

Untuk domain regulatori, active-active sering sangat berisiko jika state transition harus valid dan audit defensible.

### 16.3 Pertanyaan sebelum multi-region write

Tanyakan:

- Apakah benar perlu write di semua region?
- Apa invariant yang harus global?
- Apa yang terjadi jika dua region menerima update conflicting?
- Siapa pemenang conflict?
- Apakah conflict bisa diterima secara legal/bisnis?
- Apakah user bisa diarahkan ke home region?
- Apakah read-only DR cukup?
- Apakah RTO/RPO realistis?

### 16.4 Home-region model

Sering lebih aman:

```text
Each tenant/case has a home region.
All writes for that aggregate go to home region.
Other regions may cache/read replica/projection.
```

Ini menghindari banyak conflict dengan mengikat aggregate ke satu write authority.

---

## 17. MySQL Tidak Menggantikan Message Broker

Kadang tim menggunakan MySQL table sebagai queue.

Ini bisa masuk akal untuk workload sederhana dan transaksional lokal, tetapi ada batas.

### 17.1 MySQL queue cocok jika

- volume sedang
- ordering sederhana
- consumer sedikit
- queue dekat dengan data transaksi
- butuh atomic claim dengan row lock
- failure recovery sederhana

### 17.2 Broker lebih cocok jika

- throughput tinggi
- fan-out banyak consumer
- retention event panjang
- replay diperlukan
- partitioning/ordering event besar
- backpressure stream
- integrasi banyak system

### 17.3 MySQL queue table contoh

```sql
CREATE TABLE work_item (
    id BINARY(16) PRIMARY KEY,
    queue_name VARCHAR(100) NOT NULL,
    status VARCHAR(30) NOT NULL,
    priority INT NOT NULL,
    available_at DATETIME(6) NOT NULL,
    locked_by VARCHAR(100) NULL,
    locked_until DATETIME(6) NULL,
    payload JSON NOT NULL,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    KEY idx_queue_claim (queue_name, status, available_at, priority, id)
);
```

Claim:

```sql
SELECT id
FROM work_item
WHERE queue_name = ?
  AND status = 'READY'
  AND available_at <= CURRENT_TIMESTAMP(6)
ORDER BY priority DESC, available_at, id
LIMIT 50
FOR UPDATE SKIP LOCKED;
```

Kelemahan:

- table bloat
- purge pressure
- hot index
- lock contention
- retry complexity
- monitoring custom

---

## 18. Schema Ownership dan Event Contract Evolution

Jika service punya database sendiri, schema internal boleh berubah. Tapi event/API contract tidak boleh sembarangan berubah.

### 18.1 Internal schema vs external contract

Internal schema:

```sql
case_file.status_code
case_file.status_reason_id
case_state_history.transition_code
```

External event:

```json
{
  "eventType": "CaseStatusChanged",
  "eventVersion": 2,
  "caseId": "...",
  "fromStatus": "OPEN",
  "toStatus": "UNDER_REVIEW",
  "reasonCode": "SUBMITTED_BY_OFFICER"
}
```

Consumer tidak perlu tahu apakah status disimpan di satu tabel atau 5 tabel.

### 18.2 Event versioning

Aturan umum:

- additive change aman
- field removal breaking
- semantic change breaking
- enum value baru bisa breaking jika consumer strict
- rename field = breaking

Gunakan:

- `eventVersion`
- schema registry jika ada
- backward-compatible payload
- consumer tolerant reader
- deprecation window

### 18.3 Jangan publish internal row mentah tanpa pikir panjang

Raw CDC dari semua kolom membuat consumer tergantung pada schema internal.

Lebih baik:

- publish outbox domain event untuk integration
- raw CDC hanya untuk internal projection/replication yang terkendali

---

## 19. Distributed Query: Jangan Jadikan Runtime Join sebagai Default

Dalam monolith, query seperti ini wajar:

```sql
SELECT c.*, a.*, o.*
FROM case_file c
JOIN assignment a ON a.case_id = c.id
JOIN officer o ON o.id = a.officer_id
WHERE c.status = 'OPEN';
```

Dalam microservices, data mungkin tersebar:

```text
case-service
assignment-service
identity-service
```

Jika API gateway memanggil 3 service per row, muncul N+1 distributed query.

### 19.1 Distributed N+1

Buruk:

```text
search cases -> 100 case IDs
for each case:
  call assignment service
  call identity service
  call SLA service
```

Masalah:

- latency besar
- cascading failure
- rate limit
- inconsistent snapshot
- retry storm

### 19.2 Solusi

- denormalized read model
- batch API
- projection service
- search index summary
- GraphQL/DataLoader pattern dengan batasan
- precomputed dashboard table

Untuk UI dashboard, read model biasanya lebih sehat daripada runtime distributed join.

---

## 20. Backpressure dan MySQL

MySQL sering menjadi tempat pressure terakhir terlihat.

Contoh:

```text
Kafka lag naik -> consumer batch makin besar -> MySQL write spike -> lock wait -> retry -> lebih banyak write -> DB makin lambat
```

Atau:

```text
API latency naik -> connection ditahan lebih lama -> Hikari pool habis -> request queue naik -> retry dari client -> DB makin penuh
```

### 20.1 Backpressure principles

- batasi concurrency, bukan hanya QPS
- gunakan bounded queue
- gunakan timeout eksplisit
- gunakan retry dengan jitter dan max attempt
- bedakan retryable vs non-retryable
- expose lag dan queue depth
- degrade read-only jika perlu
- jangan biarkan semua caller menekan DB tanpa kontrol

### 20.2 Java controls

- Hikari `maximumPoolSize` rasional
- HTTP server thread pool bounded
- consumer concurrency bounded
- batch size bounded
- transaction timeout
- query timeout
- circuit breaker untuk downstream
- bulkhead per workload

### 20.3 MySQL sebagai bottleneck shared resource

Database primary sering shared critical resource.

Karena itu:

```text
lebih banyak application instance tidak selalu menaikkan kapasitas sistem
```

Jika setiap instance punya pool 30 connection dan ada 40 instance:

```text
1200 potential DB connections
```

Ini bisa menghancurkan MySQL sebelum CPU app penuh.

---

## 21. Data Reconciliation: Mekanisme yang Harus Ada

Eventual consistency berarti sistem bisa sementara tidak sinkron.

Pertanyaan dewasa bukan:

> “Bagaimana memastikan tidak pernah drift?”

Tetapi:

> “Bagaimana mendeteksi, membatasi, memperbaiki, dan mengaudit drift?”

### 21.1 Jenis drift

- event hilang
- event duplicate tidak idempotent
- projection stale
- consumer bug
- schema evolution bug
- manual DB fix tidak menghasilkan event
- partial migration
- external system callback terlambat

### 21.2 Reconciliation job

Contoh:

```text
Every night:
  compare case_file current state with case_dashboard_view
  compare outbox PUBLISHED events with search index version
  compare active assignments with officer_reference
  report mismatches
  optionally repair safe mismatches
```

### 21.3 Reconciliation table

```sql
CREATE TABLE reconciliation_issue (
    id BINARY(16) PRIMARY KEY,
    check_name VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    entity_id VARCHAR(200) NOT NULL,
    severity VARCHAR(30) NOT NULL,
    status VARCHAR(30) NOT NULL,
    details JSON NOT NULL,
    detected_at DATETIME(6) NOT NULL,
    resolved_at DATETIME(6) NULL,
    KEY idx_recon_status_severity (status, severity, detected_at)
);
```

Dalam domain regulatori, reconciliation issue bisa menjadi operational case sendiri.

---

## 22. Audit Trail dalam Distributed System

Audit di single database relatif mudah:

```text
within same transaction, insert audit row
```

Dalam distributed system, audit perlu menjawab:

- siapa memulai command?
- service mana yang memproses?
- event apa yang diterbitkan?
- consumer mana yang bereaksi?
- apakah ada compensation?
- apakah ada manual override?
- apakah ada retry?
- trace lintas service apa?

### 22.1 Audit lokal vs audit global

Setiap service harus mencatat audit lokal untuk aksi yang ia own.

Global audit bisa berupa projection dari event/audit stream.

```text
case-service audit
workflow-service audit
notification-service audit
search index audit maybe not needed as legal truth
central audit projection
```

### 22.2 Correlation ID

Gunakan:

- `trace_id`
- `correlation_id`
- `causation_id`
- `actor_id`
- `request_id`

Event:

```json
{
  "eventId": "...",
  "correlationId": "approval-flow-...",
  "causationId": "command-...",
  "traceId": "...",
  "actorId": "officer-..."
}
```

### 22.3 Audit defensibility

Untuk sistem enforcement/regulatory, audit bukan log debug.

Audit harus:

- append-only secara logis
- timestamp jelas
- actor jelas
- reason jelas
- before/after state untuk keputusan penting
- bisa direkonstruksi
- tahan terhadap retry duplicate
- tidak bergantung hanya pada search index/cache

---

## 23. Example Architecture: Regulatory Case Platform

Mari gunakan contoh platform enforcement lifecycle.

### 23.1 Services

```text
case-service
workflow-service
identity-reference-service
notification-service
search-service
reporting-service
audit-service
sla-service
```

### 23.2 Source of truth

| Data | Owner |
|---|---|
| case core state | case-service MySQL |
| task/workflow | workflow-service MySQL |
| officer identity | identity service |
| notification delivery | notification-service MySQL |
| search documents | search-service/OpenSearch |
| reporting marts | reporting-service/OLAP |
| SLA clocks | sla-service MySQL |
| legal audit projection | audit-service MySQL/archive |

### 23.3 Approve case flow

```text
1. UI sends ApproveCase command to case-service
2. case-service validates current state in MySQL transaction
3. case-service updates case status
4. case-service inserts state history
5. case-service inserts audit row
6. case-service inserts outbox event CaseApproved
7. transaction commits
8. CDC publishes CaseApproved to event bus
9. workflow-service completes related review task
10. notification-service sends notification
11. search-service updates index
12. reporting-service updates projection
13. audit-service updates global audit projection
```

### 23.4 Strong invariants

In `case-service` transaction:

- case exists
- transition is valid
- actor has permission snapshot or authorization proof
- approval is recorded once
- state history is appended
- outbox event intent exists

Outside transaction:

- task completion eventual
- notification eventual
- search eventual
- reporting eventual

### 23.5 Failure scenario

CDC down after commit:

```text
case approved in MySQL
outbox row exists
no event published yet
search/dashboard stale
```

System behavior:

- case detail shows approved from source DB
- dashboard may lag
- outbox lag alert fires
- CDC resumes
- event published
- projections catch up

This is acceptable if users understand/read paths are designed accordingly.

---

## 24. Decision Framework: When to Keep Data Together vs Split

Jangan split database hanya karena entity tampak berbeda.

Split jika:

- ownership jelas berbeda
- lifecycle berbeda
- scaling pressure berbeda
- deployment cadence berbeda
- data access pattern berbeda
- team boundaries berbeda
- consistency requirement lintas boundary bisa eventual

Keep together jika:

- invariant harus atomik
- state transition sering menyentuh banyak entity
- query utama butuh strongly consistent join
- satu tim owner
- domain belum stabil
- microservices hanya akan menambah coordination cost

### 24.1 Contoh keep together

Dalam case-service:

```text
case_file
case_state_history
case_assignment_current maybe
case_party
case_risk_assessment
case_decision
```

Jika approval invariant memerlukan data itu bersama, simpan dalam boundary yang sama.

### 24.2 Contoh split

Search index:

```text
derived, eventual, rebuildable
```

Reporting:

```text
analytical, denormalized, latency tolerant
```

Notification:

```text
side effect, delivery lifecycle sendiri
```

Identity:

```text
owned by platform/user management
```

---

## 25. Failure Model Checklist

Saat MySQL dipakai dalam distributed system, tanya failure berikut.

### 25.1 DB + event

- Apa yang terjadi jika DB commit sukses tetapi event publish gagal?
- Apa yang terjadi jika event publish sukses tetapi consumer gagal?
- Apa yang terjadi jika event duplicate?
- Apa yang terjadi jika event out-of-order?
- Apa yang terjadi jika event schema berubah?

### 25.2 DB + cache/search

- Berapa lama stale data boleh terjadi?
- Apakah user bisa mengambil keputusan kritis dari data stale?
- Bagaimana invalidation terjadi?
- Bagaimana reindex dilakukan?
- Bagaimana drift dideteksi?

### 25.3 DB + service boundary

- Siapa owner tabel?
- Apakah service lain membaca DB langsung?
- Apakah ada hidden coupling lewat SQL/report?
- Bagaimana referential integrity lintas service dijaga?
- Bagaimana data deletion/retention lintas service?

### 25.4 DB + region

- Region mana write authority?
- Apa conflict policy?
- Apa RTO/RPO?
- Apa yang terjadi saat network partition?
- Apakah stale replica boleh dipakai?

---

## 26. Anti-Patterns yang Harus Dihindari

### 26.1 Dual write tanpa outbox

```java
saveToMySQL();
publishToKafka();
```

Tanpa recovery strategy, ini rentan event hilang atau palsu.

### 26.2 Consumer tidak idempotent

```java
onEvent(e) {
    insertNotification(e);
    sendEmail(e);
}
```

Duplicate event bisa membuat email terkirim berkali-kali.

### 26.3 Service lain membaca DB owner langsung

Ini menghancurkan ownership dan evolvability.

### 26.4 Menganggap CDC raw table sebagai domain contract

Raw CDC berguna, tapi bisa membuat schema internal menjadi public API.

### 26.5 Search index sebagai source of truth

Search index bisa stale dan incomplete. Jangan jadikan dasar keputusan legal final tanpa validasi.

### 26.6 Retry tanpa idempotency

Retry memperbaiki transient failure, tetapi memperburuk duplicate side effect jika tidak idempotent.

### 26.7 Global transaction fantasy

Memaksa semua hal atomik lintas service sering membuat sistem rapuh, lambat, dan sulit dioperasikan.

### 26.8 Active-active multi-region tanpa conflict semantics

Jika tidak bisa menjelaskan conflict handling secara domain, jangan desain active-active writes.

---

## 27. Java Implementation Notes

### 27.1 Transactional outbox service

Pseudo-code:

```java
@Transactional
public void approveCase(ApproveCaseCommand command) {
    CaseFile caseFile = caseRepository.findForUpdate(command.caseId());

    caseFile.approve(command.actorId(), command.reason());

    caseRepository.save(caseFile);
    caseStateHistoryRepository.append(caseFile.toStateHistory());

    outboxRepository.insert(OutboxEvent.of(
        "Case",
        caseFile.id(),
        "CaseApproved",
        1,
        caseFile.toApprovedEventPayload()
    ));
}
```

Key point:

- event disimpan di DB, bukan langsung dikirim sebagai side effect transaksi
- method harus idempotent jika command bisa di-retry
- `findForUpdate` hanya jika perlu pessimistic lock; optimistic version juga bisa digunakan

### 27.2 Idempotent command endpoint

```sql
CREATE TABLE idempotency_record (
    idempotency_key VARCHAR(200) PRIMARY KEY,
    command_type VARCHAR(100) NOT NULL,
    request_hash CHAR(64) NOT NULL,
    response_ref VARCHAR(200) NULL,
    status VARCHAR(30) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL
);
```

Flow:

```text
1. insert idempotency key
2. duplicate key -> check request hash
3. if same request, return prior result or current status
4. if different request, reject
```

### 27.3 Consumer transaction

```java
@Transactional
public void handle(Event event) {
    boolean firstTime = processedEventRepository.tryInsert(
        consumerName,
        event.eventId()
    );

    if (!firstTime) {
        return;
    }

    projectionRepository.apply(event);
}
```

`tryInsert` harus bergantung pada unique constraint, bukan check-then-insert biasa.

### 27.4 Avoid distributed transaction in service method

Buruk:

```java
@Transactional
public void approveAndNotify(...) {
    caseRepository.approve(...);
    notificationClient.send(...); // external call inside DB transaction
}
```

Lebih baik:

```java
@Transactional
public void approve(...) {
    caseRepository.approve(...);
    outboxRepository.insert(notificationRequestedEvent);
}
```

Consumer notification memproses event secara terpisah.

---

## 28. Operational Metrics untuk Distributed MySQL Architecture

Pantau bukan hanya MySQL metrics, tapi flow metrics.

### 28.1 Outbox metrics

- count by status
- oldest unpublished age
- publish rate
- retry count
- dead letter count
- publish latency p95/p99

### 28.2 CDC metrics

- connector lag
- binlog position/GTID lag
- snapshot status
- error count
- schema change failure
- event throughput

### 28.3 Consumer metrics

- consumer lag
- processing latency
- duplicate event count
- failed event count
- retry count
- DLQ size
- projection lag

### 28.4 Data quality metrics

- reconciliation issue count
- stale projection count
- missing search document count
- reference drift count
- tenant leakage checks

### 28.5 MySQL supporting metrics

- connection usage
- lock waits
- deadlocks
- slow queries
- buffer pool hit ratio with nuance
- redo/binlog pressure
- replication lag
- disk space

---

## 29. Design Review Checklist

Gunakan checklist ini saat merancang MySQL dalam microservices/distributed system.

### 29.1 Ownership

- Siapa owner setiap tabel?
- Apakah ada service lain yang membaca/menulis langsung?
- Apa public contract: API, event, atau projection?
- Apakah schema internal bisa berubah tanpa consumer ikut berubah?

### 29.2 Consistency

- Invariant apa yang harus atomik lokal?
- Invariant apa yang boleh eventual?
- Apa stale read risk?
- Apa compensation path?
- Apa reconciliation path?

### 29.3 Events

- Apakah dual-write dihindari?
- Apakah outbox/CDC digunakan?
- Apakah event punya id unik?
- Apakah event versioned?
- Apakah ordering requirement jelas?
- Apakah consumer idempotent?

### 29.4 Data duplication

- Data apa yang diduplikasi?
- Siapa source of truth?
- Bagaimana update propagates?
- Bagaimana drift dideteksi?
- Bagaimana rebuild projection?

### 29.5 Operations

- Apa metric lag?
- Apa alert meaningful?
- Apa runbook jika CDC down?
- Apa runbook jika outbox menumpuk?
- Apa runbook jika projection corrupt?
- Apa replay procedure?

---

## 30. Latihan Mental Model

### Latihan 1 — Dual write failure

Desain saat ini:

```text
Service update MySQL lalu publish Kafka langsung.
```

Pertanyaan:

1. Apa yang terjadi jika crash setelah commit sebelum publish?
2. Apa yang terjadi jika publish berhasil tapi response timeout?
3. Apakah retry aman?
4. Di mana idempotency disimpan?
5. Bagaimana outbox mengubah failure model?

### Latihan 2 — Search stale data

User mencari case dengan status `OPEN`, tetapi case baru saja `CLOSED`.

Pertanyaan:

1. Apakah search result boleh menampilkan case stale?
2. Saat user membuka detail, sumber data mana yang dipakai?
3. Apakah action button harus divalidasi ulang di command service?
4. Bagaimana search index diperbaiki jika drift?

### Latihan 3 — Split service boundary

Ada entity:

```text
case
assignment
officer
sla_clock
audit_event
notification
```

Pertanyaan:

1. Mana yang harus satu transaction boundary?
2. Mana yang bisa projection?
3. Mana yang source of truth berbeda?
4. Apa event yang dibutuhkan?
5. Apa risiko jika semuanya dipisah terlalu awal?

### Latihan 4 — Multi-region write

Regulator di Region A dan Region B bisa mengubah case yang sama.

Pertanyaan:

1. Apa conflict yang mungkin terjadi?
2. Apakah last-write-wins legal defensible?
3. Apakah home-region per case lebih baik?
4. Apa RPO/RTO yang sebenarnya diperlukan?
5. Bagaimana audit conflict ditangani?

---

## 31. Ringkasan Inti

MySQL sangat kuat sebagai local transactional system, tetapi distributed architecture membutuhkan mekanisme tambahan.

Prinsip utama:

1. **MySQL transaction boundary adalah local consistency boundary.**
2. **Business process lintas service harus didesain sebagai workflow/saga, bukan dipaksa menjadi satu transaksi global.**
3. **Dual write harus dihindari dengan outbox/CDC atau mekanisme reliable equivalent.**
4. **Consumer harus idempotent. Duplicate event adalah kondisi normal.**
5. **Ordering global biasanya tidak realistis; per-aggregate ordering lebih praktis.**
6. **Search/cache/reporting adalah derived data, bukan source of truth.**
7. **Service ownership harus jelas; direct DB access lintas service merusak evolvability.**
8. **Referential integrity lintas service diganti oleh validation, projection, event, dan reconciliation.**
9. **Multi-region write adalah domain conflict problem, bukan sekadar replication problem.**
10. **Reconciliation dan audit adalah bagian dari desain, bukan patch setelah insiden.**

Seorang Java engineer yang kuat dalam MySQL tidak hanya bisa menulis query cepat. Ia bisa menjelaskan:

```text
Apa yang dijamin MySQL,
apa yang tidak dijamin MySQL,
dan mekanisme apa yang harus dibangun di sekitar MySQL
agar sistem distributed tetap benar, observable, dan recoverable.
```

---

## 32. Hubungan ke Part Berikutnya

Bagian ini membahas MySQL dalam distributed architecture.

Bagian berikutnya, `part-033`, akan membahas:

```text
Performance Engineering Methodology
```

Kita akan fokus ke cara mengukur, membuat workload model, membaca latency distribution, menghindari benchmark palsu, melakukan capacity planning, dan mencegah performance regression pada sistem Java + MySQL.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-mysql-mastery-for-java-engineers-part-031.md">⬅️ Part 031 — JSON, Generated Columns, Full-Text, and Semi-Structured Data</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-mysql-mastery-for-java-engineers-part-033.md">Part 033 — Performance Engineering Methodology ➡️</a>
</div>
