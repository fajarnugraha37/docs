# learn-mysql-mastery-for-java-engineers-part-029.md

# Part 029 — MySQL and Application-Level Concurrency Patterns

> Seri: `learn-mysql-mastery-for-java-engineers`  
> Bagian: `029 / 034`  
> Fokus: bagaimana menggunakan MySQL sebagai primitive concurrency di aplikasi Java production tanpa jatuh ke ilusi “transaction otomatis menyelesaikan race condition”.

---

## 0. Posisi Bagian Ini Dalam Seri

Sampai titik ini kita sudah membahas:

- InnoDB MVCC.
- isolation level.
- record/gap/next-key lock.
- deadlock dan lock wait timeout.
- index internals.
- optimizer.
- transaction boundary di Java.
- replication dan consistency boundary.
- production debugging.

Bagian ini menyatukan semuanya ke pertanyaan yang lebih aplikatif:

> Kalau beberapa request, worker, scheduler, event consumer, atau user action berjalan bersamaan, pola desain apa yang membuat state tetap valid?

Ini bukan hanya topik database. Ini topik desain sistem.

MySQL memberi primitive seperti:

- transaction.
- unique constraint.
- foreign key.
- row lock.
- optimistic version column.
- `SELECT ... FOR UPDATE`.
- `NOWAIT`.
- `SKIP LOCKED`.
- atomic `UPDATE ... WHERE ...`.
- idempotency table.
- outbox table.

Tetapi primitive itu tidak otomatis menjadi desain concurrency yang benar. Kita perlu memilih pola sesuai invariant bisnis.

---

## 1. Mental Model Utama: Concurrency Control Adalah Penjaga Invariant

Concurrency pattern bukan tujuan. Tujuannya adalah menjaga invariant.

Contoh invariant:

- satu case hanya boleh berada di satu status final.
- satu payment reference hanya boleh diproses sekali.
- satu enforcement action hanya boleh punya satu active escalation.
- satu queue job hanya boleh diklaim oleh satu worker.
- stok tidak boleh negatif.
- user tidak boleh submit appeal setelah deadline.
- audit event harus tercatat untuk setiap state transition.
- external notification tidak boleh dikirim dua kali untuk event yang sama, kecuali memang idempotent.

Pertanyaan desain yang benar bukan:

> “Pakai optimistic atau pessimistic locking?”

Pertanyaan yang benar:

> “Invariant apa yang harus tetap benar meskipun dua proses berjalan bersamaan, gagal di tengah, retry, atau melihat data stale?”

Setelah invariant jelas, baru pilih mekanisme.

---

## 2. Empat Level Concurrency Control

Dalam aplikasi Java + MySQL, concurrency bisa dikendalikan di beberapa level.

| Level | Contoh | Kekuatan | Risiko |
|---|---|---|---|
| Application memory | `synchronized`, local lock, in-memory cache | cepat | tidak valid lintas instance |
| Distributed coordination | Redis lock, ZooKeeper, etcd | lintas node | lease, split brain, operational burden |
| Database constraint | unique key, FK, check constraint | kuat dan durable | perlu desain schema benar |
| Database transaction/lock | row lock, optimistic version, `FOR UPDATE` | dekat dengan data | deadlock, contention, latency |

Untuk sistem berbasis MySQL, rule praktisnya:

> Kalau invariant berhubungan dengan data durable, usahakan jadikan database constraint atau atomic database operation sebagai guard utama.

Application lock boleh membantu, tetapi jangan menjadi satu-satunya sumber kebenaran untuk invariant data.

---

## 3. Pattern 1 — Atomic Conditional Update

### 3.1 Ide

Gunakan satu statement `UPDATE` yang sekaligus:

1. memilih row,
2. memverifikasi state lama,
3. mengubah state,
4. melaporkan apakah perubahan berhasil.

Contoh:

```sql
UPDATE enforcement_case
SET
    status = 'UNDER_REVIEW',
    assigned_to = ?,
    updated_at = CURRENT_TIMESTAMP(6)
WHERE id = ?
  AND status = 'SUBMITTED';
```

Di Java, cek affected row count:

```java
int updated = jdbcTemplate.update("""
    UPDATE enforcement_case
    SET status = ?, assigned_to = ?, updated_at = CURRENT_TIMESTAMP(6)
    WHERE id = ? AND status = ?
""", "UNDER_REVIEW", officerId, caseId, "SUBMITTED");

if (updated == 0) {
    throw new InvalidStateTransitionException(caseId);
}
```

### 3.2 Kenapa Ini Kuat?

Karena check dan write terjadi dalam satu atomic statement di server.

Tidak ada celah antara:

```sql
SELECT status FROM enforcement_case WHERE id = ?;
-- aplikasi berpikir
UPDATE enforcement_case SET status = ? WHERE id = ?;
```

Pola read-then-write seperti itu rawan race condition kalau tidak memakai lock atau conditional write.

### 3.3 Cocok Untuk

- state transition sederhana.
- claim ownership sederhana.
- soft delete bersyarat.
- counter dengan batas.
- stok/inventory.
- approval step yang hanya valid dari status tertentu.

### 3.4 Contoh Counter Aman

```sql
UPDATE account_quota
SET used_quota = used_quota + 1
WHERE account_id = ?
  AND used_quota < max_quota;
```

Jika affected rows = 1, quota berhasil dikonsumsi. Jika 0, quota habis.

### 3.5 Kelemahan

Atomic conditional update bagus untuk invariant yang bisa diekspresikan dalam satu row atau predicate sederhana.

Ia kurang cukup jika:

- harus membaca banyak row.
- harus validasi agregat kompleks.
- harus membuat beberapa perubahan lintas tabel.
- harus menyimpan audit event secara konsisten.
- harus memanggil external service.

Untuk kasus itu, kombinasikan dengan transaction, lock, atau outbox.

---

## 4. Pattern 2 — Unique Constraint as Concurrency Guard

### 4.1 Ide

Untuk invariant “hanya boleh satu”, gunakan unique constraint.

Contoh idempotency:

```sql
CREATE TABLE idempotency_request (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    idempotency_key VARCHAR(128) NOT NULL,
    request_hash BINARY(32) NOT NULL,
    status VARCHAR(32) NOT NULL,
    response_json JSON NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
        ON UPDATE CURRENT_TIMESTAMP(6),
    UNIQUE KEY uq_idempotency_key (idempotency_key)
) ENGINE = InnoDB;
```

Jika dua request bersamaan memakai key sama, hanya satu yang bisa insert.

```sql
INSERT INTO idempotency_request (idempotency_key, request_hash, status)
VALUES (?, ?, 'PROCESSING');
```

Yang kalah menerima duplicate key error.

### 4.2 Kenapa Constraint Lebih Baik Daripada Cek Manual?

Pola rawan:

```sql
SELECT COUNT(*) FROM idempotency_request WHERE idempotency_key = ?;
-- hasil 0
INSERT INTO idempotency_request (...);
```

Dua transaksi bisa sama-sama melihat 0 lalu sama-sama insert jika tidak ada unique constraint.

Unique constraint memindahkan invariant ke storage engine.

### 4.3 Contoh Active Escalation Tunggal

Misal satu case hanya boleh punya satu escalation aktif.

Di MySQL, karena tidak ada partial unique index seperti PostgreSQL, desainnya bisa memakai generated column:

```sql
CREATE TABLE case_escalation (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    case_id BIGINT NOT NULL,
    status VARCHAR(32) NOT NULL,
    active_case_id BIGINT GENERATED ALWAYS AS (
        CASE WHEN status IN ('OPEN', 'IN_PROGRESS') THEN case_id ELSE NULL END
    ) STORED,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    UNIQUE KEY uq_one_active_escalation (active_case_id)
) ENGINE = InnoDB;
```

Karena unique index mengizinkan banyak `NULL`, hanya status aktif yang ikut dibatasi.

### 4.4 Contoh Regulatory Workflow

Invariant:

> Untuk satu case, hanya boleh ada satu active assignment untuk role `LEAD_INVESTIGATOR`.

```sql
CREATE TABLE case_assignment (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    case_id BIGINT NOT NULL,
    role_code VARCHAR(64) NOT NULL,
    assignee_id BIGINT NOT NULL,
    active BOOLEAN NOT NULL,
    active_case_role VARCHAR(160) GENERATED ALWAYS AS (
        CASE
            WHEN active THEN CONCAT(case_id, ':', role_code)
            ELSE NULL
        END
    ) STORED,
    UNIQUE KEY uq_active_case_role (active_case_role)
) ENGINE = InnoDB;
```

Ini lebih defensible daripada hanya validasi di service layer.

---

## 5. Pattern 3 — Optimistic Locking

### 5.1 Ide

Optimistic locking mengasumsikan conflict jarang terjadi. Aplikasi membaca version, lalu update hanya berhasil jika version belum berubah.

```sql
CREATE TABLE enforcement_case (
    id BIGINT PRIMARY KEY,
    status VARCHAR(32) NOT NULL,
    title VARCHAR(255) NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE = InnoDB;
```

Update:

```sql
UPDATE enforcement_case
SET
    title = ?,
    version = version + 1,
    updated_at = CURRENT_TIMESTAMP(6)
WHERE id = ?
  AND version = ?;
```

Jika affected rows = 0, ada concurrent modification.

### 5.2 Java/JPA Contoh

```java
@Entity
@Table(name = "enforcement_case")
public class EnforcementCase {
    @Id
    private Long id;

    private String status;
    private String title;

    @Version
    private Long version;
}
```

Dengan JPA, `@Version` menghasilkan conditional update di belakang layar.

### 5.3 Cocok Untuk

- form edit manusia.
- update metadata dengan conflict jarang.
- API update resource.
- aggregate root yang tidak terlalu hot.
- workflow transition yang harus mendeteksi stale command.

### 5.4 Tidak Cocok Untuk

- hot counter.
- queue worker claim.
- very high contention row.
- proses yang conflict-nya normal dan sering.

Kalau conflict sering, optimistic locking berubah menjadi retry storm.

### 5.5 Optimistic Locking Bukan Sekadar Version Column

Yang dijaga adalah stale write.

Contoh buruk:

1. User A membuka case versi 10.
2. User B menutup case menjadi `CLOSED`, versi 11.
3. User A menyimpan title lama tanpa cek versi.
4. Status bisa tertimpa atau metadata stale masuk.

Dengan optimistic locking, step 3 gagal dan user/app harus reload.

### 5.6 Conflict Handling

Conflict bukan selalu error teknis. Kadang conflict adalah business event.

Pilihan handling:

- reject dengan pesan “data berubah, silakan reload”.
- merge field non-conflicting.
- retry otomatis untuk command machine-to-machine.
- masukkan ke manual review.
- simpan conflict record untuk audit.

---

## 6. Pattern 4 — Pessimistic Locking With `SELECT ... FOR UPDATE`

### 6.1 Ide

Pessimistic locking mengunci row sebelum melakukan keputusan.

```sql
START TRANSACTION;

SELECT id, status, assigned_to
FROM enforcement_case
WHERE id = ?
FOR UPDATE;

-- validasi dan update

UPDATE enforcement_case
SET status = 'UNDER_REVIEW', assigned_to = ?
WHERE id = ?;

COMMIT;
```

### 6.2 Kapan Dipakai?

Pakai ketika:

- conflict cukup mungkin.
- keputusan butuh membaca state terkini.
- beberapa table harus konsisten dalam satu transaksi.
- gagal karena conflict lebih mahal daripada menunggu lock.
- invariant sulit diekspresikan sebagai satu conditional update.

### 6.3 Contoh Transfer Assignment

```sql
START TRANSACTION;

SELECT id, status, assigned_to
FROM enforcement_case
WHERE id = ?
FOR UPDATE;

SELECT id, workload_count
FROM officer_workload
WHERE officer_id IN (?, ?)
FOR UPDATE;

UPDATE enforcement_case
SET assigned_to = ?
WHERE id = ?;

UPDATE officer_workload
SET workload_count = workload_count - 1
WHERE officer_id = ?;

UPDATE officer_workload
SET workload_count = workload_count + 1
WHERE officer_id = ?;

COMMIT;
```

### 6.4 Lock Ordering

Jika transaksi mengunci banyak row, selalu gunakan urutan deterministik.

Buruk:

- request A mengunci officer 10 lalu 20.
- request B mengunci officer 20 lalu 10.

Baik:

- semua request mengunci officer berdasarkan ascending `officer_id`.

```sql
SELECT id, workload_count
FROM officer_workload
WHERE officer_id IN (?, ?)
ORDER BY officer_id
FOR UPDATE;
```

Catatan: `ORDER BY` membantu pola akses, tetapi tetap pastikan index mendukung predicate/order agar lock footprint tidak melebar.

### 6.5 `FOR UPDATE` Butuh Index Yang Tepat

Query locking read tanpa index yang tepat dapat mengunci jauh lebih banyak row daripada yang dibayangkan.

Buruk:

```sql
SELECT *
FROM job
WHERE status = 'READY'
ORDER BY created_at
LIMIT 1
FOR UPDATE;
```

Jika index tidak cocok, MySQL bisa scan banyak row dan mengambil lock selama eksekusi.

Lebih baik:

```sql
CREATE INDEX idx_job_claim
ON job (status, available_at, created_at, id);
```

```sql
SELECT id
FROM job
WHERE status = 'READY'
  AND available_at <= CURRENT_TIMESTAMP(6)
ORDER BY available_at, created_at, id
LIMIT 1
FOR UPDATE;
```

---

## 7. Pattern 5 — `NOWAIT` and `SKIP LOCKED`

MySQL locking read mendukung `NOWAIT` dan `SKIP LOCKED` untuk `SELECT ... FOR UPDATE` atau `SELECT ... FOR SHARE`. `NOWAIT` langsung gagal jika row yang diminta terkunci; `SKIP LOCKED` tidak menunggu dan menghapus row terkunci dari result set. Dokumentasi MySQL menegaskan bahwa `SKIP LOCKED` menghasilkan view data yang tidak konsisten sehingga tidak cocok untuk pekerjaan transactional umum, tetapi dapat dipakai untuk table bergaya queue.  

### 7.1 `NOWAIT`

Gunakan saat lebih baik gagal cepat daripada menunggu.

```sql
SELECT id, status
FROM enforcement_case
WHERE id = ?
FOR UPDATE NOWAIT;
```

Cocok untuk:

- admin action yang bisa diberi pesan “resource sedang diproses”.
- UI command yang tidak boleh menggantung.
- worker yang akan mencoba resource lain.

### 7.2 `SKIP LOCKED`

Gunakan untuk worker pool yang mengambil pekerjaan dari queue table.

```sql
START TRANSACTION;

SELECT id
FROM workflow_job
WHERE status = 'READY'
  AND available_at <= CURRENT_TIMESTAMP(6)
ORDER BY priority DESC, available_at, id
LIMIT 10
FOR UPDATE SKIP LOCKED;

UPDATE workflow_job
SET status = 'RUNNING',
    locked_by = ?,
    locked_at = CURRENT_TIMESTAMP(6),
    attempt_count = attempt_count + 1
WHERE id IN (...);

COMMIT;
```

### 7.3 Kenapa `SKIP LOCKED` Tidak Cocok Untuk Semua Hal?

Karena ia sengaja melewatkan row terkunci.

Jika dipakai untuk “ambil semua case yang butuh review”, hasilnya bisa diam-diam tidak lengkap.

Untuk queue, ini acceptable karena worker lain sedang memproses row tersebut. Untuk reporting, compliance review, atau consistency-critical decision, ini berbahaya.

### 7.4 Invariant Penggunaan `SKIP LOCKED`

Gunakan `SKIP LOCKED` hanya jika semua ini benar:

- row yang dilewati akan diproses worker lain atau retry nanti.
- query tidak digunakan untuk membuat keputusan final berbasis kelengkapan data.
- ada lease/timeout untuk job yang worker-nya mati.
- job processing idempotent.
- ada retry dan dead-letter state.
- ada observability untuk stuck/running too long.

---

## 8. Pattern 6 — Queue Table di MySQL

### 8.1 Kapan Queue Table Masuk Akal?

Queue table cocok jika:

- volume tidak terlalu ekstrem.
- job sangat dekat dengan data transactional.
- konsistensi dengan transaksi utama penting.
- deployment ingin sederhana.
- operational team belum siap mengelola broker khusus.

Queue table tidak cocok jika:

- throughput sangat tinggi.
- latency sub-millisecond penting.
- fanout besar.
- ordering global kompleks.
- retention event besar.
- consumer group semantics kompleks.

### 8.2 Schema Contoh

```sql
CREATE TABLE workflow_job (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    job_type VARCHAR(64) NOT NULL,
    aggregate_type VARCHAR(64) NOT NULL,
    aggregate_id BIGINT NOT NULL,
    payload JSON NOT NULL,
    status VARCHAR(32) NOT NULL,
    priority INT NOT NULL DEFAULT 0,
    available_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    locked_by VARCHAR(128) NULL,
    locked_at TIMESTAMP(6) NULL,
    attempt_count INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 10,
    last_error TEXT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
        ON UPDATE CURRENT_TIMESTAMP(6),

    KEY idx_job_claim (status, available_at, priority, id),
    KEY idx_job_aggregate (aggregate_type, aggregate_id),
    KEY idx_job_locked (status, locked_at)
) ENGINE = InnoDB;
```

### 8.3 Claim Batch

```sql
START TRANSACTION;

SELECT id
FROM workflow_job
WHERE status = 'READY'
  AND available_at <= CURRENT_TIMESTAMP(6)
ORDER BY priority DESC, available_at, id
LIMIT 50
FOR UPDATE SKIP LOCKED;

UPDATE workflow_job
SET status = 'RUNNING',
    locked_by = ?,
    locked_at = CURRENT_TIMESTAMP(6),
    attempt_count = attempt_count + 1
WHERE id IN (...);

COMMIT;
```

### 8.4 Completion

```sql
UPDATE workflow_job
SET status = 'DONE',
    updated_at = CURRENT_TIMESTAMP(6)
WHERE id = ?
  AND status = 'RUNNING'
  AND locked_by = ?;
```

### 8.5 Retry

```sql
UPDATE workflow_job
SET status = CASE
        WHEN attempt_count >= max_attempts THEN 'DEAD'
        ELSE 'READY'
    END,
    available_at = CASE
        WHEN attempt_count >= max_attempts THEN available_at
        ELSE TIMESTAMPADD(SECOND, POW(2, LEAST(attempt_count, 10)), CURRENT_TIMESTAMP(6))
    END,
    last_error = ?,
    locked_by = NULL,
    locked_at = NULL
WHERE id = ?
  AND status = 'RUNNING'
  AND locked_by = ?;
```

### 8.6 Reaper Untuk Worker Mati

```sql
UPDATE workflow_job
SET status = 'READY',
    locked_by = NULL,
    locked_at = NULL,
    available_at = CURRENT_TIMESTAMP(6)
WHERE status = 'RUNNING'
  AND locked_at < TIMESTAMPADD(MINUTE, -15, CURRENT_TIMESTAMP(6));
```

### 8.7 Queue Table Failure Mode

| Failure | Penyebab | Mitigasi |
|---|---|---|
| job stuck RUNNING | worker crash | lease + reaper |
| duplicate processing | worker selesai tapi update status gagal | idempotent handler |
| hot index | semua worker scan status sama | index tepat, shard by type/partition |
| starvation | priority tinggi selalu menang | aging priority, fairness rule |
| dead-letter menumpuk | downstream rusak | alert dan manual recovery |
| table bloat | job history tidak dipurge | retention/archive |

---

## 9. Pattern 7 — Idempotency Key

### 9.1 Masalah

Distributed systems melakukan retry.

Retry bisa terjadi karena:

- client timeout.
- gateway timeout.
- app crash setelah commit.
- network partition.
- consumer redelivery.
- failover.
- user double click.

Tanpa idempotency, retry bisa membuat duplicate effect.

### 9.2 Desain Idempotency Request

```sql
CREATE TABLE api_idempotency (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    idempotency_key VARCHAR(128) NOT NULL,
    operation VARCHAR(128) NOT NULL,
    request_hash BINARY(32) NOT NULL,
    status VARCHAR(32) NOT NULL,
    response_code INT NULL,
    response_body JSON NULL,
    resource_type VARCHAR(64) NULL,
    resource_id BIGINT NULL,
    expires_at TIMESTAMP(6) NOT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
        ON UPDATE CURRENT_TIMESTAMP(6),

    UNIQUE KEY uq_idem_key (idempotency_key),
    KEY idx_idem_expiry (expires_at)
) ENGINE = InnoDB;
```

### 9.3 Processing Flow

1. Client kirim `Idempotency-Key`.
2. Server hash request body canonical.
3. Insert key dengan status `PROCESSING`.
4. Jika insert berhasil, proses command.
5. Simpan response/result.
6. Jika duplicate key:
   - baca row existing.
   - jika hash berbeda, return conflict.
   - jika status complete, return response lama.
   - jika processing, return 409/202 atau tunggu sesuai kebijakan.

### 9.4 Transaction Boundary

Idealnya insert idempotency row dan business change terjadi dalam satu transaksi.

```sql
START TRANSACTION;

INSERT INTO api_idempotency (...)
VALUES (...);

INSERT INTO enforcement_action (...)
VALUES (...);

UPDATE api_idempotency
SET status = 'SUCCEEDED',
    resource_type = 'ENFORCEMENT_ACTION',
    resource_id = LAST_INSERT_ID(),
    response_code = 201,
    response_body = JSON_OBJECT(...)
WHERE idempotency_key = ?;

COMMIT;
```

### 9.5 Idempotency Bukan Deduplication Sederhana

Idempotency harus membedakan:

- request sama diulang.
- key sama tetapi payload berbeda.
- request pertama masih processing.
- request pertama berhasil tetapi response hilang.
- request pertama gagal permanen.
- request pertama gagal transient.

---

## 10. Pattern 8 — Outbox Pattern

### 10.1 Masalah Dual Write

Buruk:

```java
@Transactional
public void closeCase(long caseId) {
    caseRepository.close(caseId);
    kafkaTemplate.send("case-closed", event); // external side effect
}
```

Kemungkinan failure:

- DB commit berhasil, Kafka send gagal.
- Kafka send berhasil, DB rollback.
- app crash di antara keduanya.
- retry mengirim event dua kali.

### 10.2 Ide Outbox

Simpan business change dan event intent dalam transaksi database yang sama.

```sql
CREATE TABLE outbox_event (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    aggregate_type VARCHAR(64) NOT NULL,
    aggregate_id BIGINT NOT NULL,
    event_type VARCHAR(128) NOT NULL,
    event_key VARCHAR(128) NOT NULL,
    payload JSON NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'READY',
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    published_at TIMESTAMP(6) NULL,
    attempt_count INT NOT NULL DEFAULT 0,
    last_error TEXT NULL,

    UNIQUE KEY uq_outbox_event_key (event_key),
    KEY idx_outbox_claim (status, created_at, id),
    KEY idx_outbox_aggregate (aggregate_type, aggregate_id, id)
) ENGINE = InnoDB;
```

Transaction:

```sql
START TRANSACTION;

UPDATE enforcement_case
SET status = 'CLOSED', version = version + 1
WHERE id = ? AND status = 'UNDER_REVIEW';

INSERT INTO case_audit_event (...)
VALUES (...);

INSERT INTO outbox_event (
    aggregate_type,
    aggregate_id,
    event_type,
    event_key,
    payload
) VALUES (
    'ENFORCEMENT_CASE',
    ?,
    'CASE_CLOSED',
    ?,
    JSON_OBJECT(...)
);

COMMIT;
```

Publisher worker:

```sql
START TRANSACTION;

SELECT id, event_type, event_key, payload
FROM outbox_event
WHERE status = 'READY'
ORDER BY created_at, id
LIMIT 100
FOR UPDATE SKIP LOCKED;

UPDATE outbox_event
SET status = 'PUBLISHING', attempt_count = attempt_count + 1
WHERE id IN (...);

COMMIT;
```

Setelah publish sukses:

```sql
UPDATE outbox_event
SET status = 'PUBLISHED', published_at = CURRENT_TIMESTAMP(6)
WHERE id = ?;
```

### 10.3 Invariant Outbox

Outbox tidak menjamin exactly-once delivery ke dunia luar.

Outbox menjamin:

> Jika business transaction commit, event intent juga durable.

Consumer tetap harus idempotent.

### 10.4 Polling Outbox vs CDC Outbox

| Approach | Cara kerja | Kelebihan | Risiko |
|---|---|---|---|
| Polling | app worker baca outbox table | sederhana | query overhead, ordering terbatas |
| CDC | Debezium/binlog baca perubahan | dekat dengan log DB, scalable | infra lebih kompleks |

---

## 11. Pattern 9 — Inbox Pattern

### 11.1 Masalah Consumer Duplicate

Message broker biasanya memberi at-least-once delivery.

Artinya consumer bisa menerima event sama lebih dari sekali.

### 11.2 Inbox Table

```sql
CREATE TABLE inbox_message (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    message_id VARCHAR(128) NOT NULL,
    source VARCHAR(128) NOT NULL,
    received_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    processed_at TIMESTAMP(6) NULL,
    status VARCHAR(32) NOT NULL,
    last_error TEXT NULL,

    UNIQUE KEY uq_inbox_message (source, message_id)
) ENGINE = InnoDB;
```

Consumer flow:

```sql
START TRANSACTION;

INSERT INTO inbox_message (source, message_id, status)
VALUES (?, ?, 'PROCESSING');

-- apply business effect
UPDATE enforcement_case_projection
SET ...
WHERE ...;

UPDATE inbox_message
SET status = 'PROCESSED', processed_at = CURRENT_TIMESTAMP(6)
WHERE source = ? AND message_id = ?;

COMMIT;
```

Jika duplicate insert gagal, consumer tahu message sudah pernah dilihat.

### 11.3 Harus Hati-Hati Dengan Processing Yang Gagal

Jika insert inbox commit tapi business effect belum selesai, row bisa stuck `PROCESSING`. Karena itu lebih aman jika insert inbox dan business effect ada dalam transaksi yang sama, atau ada recovery rule.

---

## 12. Pattern 10 — State Machine Guard in SQL

### 12.1 Ide

Untuk workflow seperti enforcement lifecycle, jangan biarkan transition valid hanya di Java enum.

Minimal, enforce dengan conditional update:

```sql
UPDATE enforcement_case
SET status = 'ESCALATED', version = version + 1
WHERE id = ?
  AND status IN ('UNDER_REVIEW', 'NON_COMPLIANT');
```

Lebih kuat, simpan transition definition:

```sql
CREATE TABLE case_status_transition_rule (
    from_status VARCHAR(32) NOT NULL,
    to_status VARCHAR(32) NOT NULL,
    command_code VARCHAR(64) NOT NULL,
    PRIMARY KEY (from_status, to_status, command_code)
) ENGINE = InnoDB;
```

Lalu service membaca rule dan melakukan conditional update.

### 12.2 Audit Event Dalam Transaksi Sama

```sql
START TRANSACTION;

UPDATE enforcement_case
SET status = ?, version = version + 1
WHERE id = ?
  AND status = ?;

-- cek affected rows

INSERT INTO case_audit_event (
    case_id,
    event_type,
    old_status,
    new_status,
    actor_id,
    reason_code,
    occurred_at
) VALUES (?, 'STATUS_CHANGED', ?, ?, ?, ?, CURRENT_TIMESTAMP(6));

COMMIT;
```

Invariant:

> Tidak boleh ada status berubah tanpa audit event.

Agar invariant ini benar, update status dan insert audit harus dalam satu transaksi.

---

## 13. Pattern 11 — Reservation Pattern

### 13.1 Masalah

Reservation pattern dipakai ketika resource diklaim sementara sebelum finalisasi.

Contoh:

- slot pemeriksaan.
- kuota proses batch.
- case assignment temporary.
- approval token.

### 13.2 Schema

```sql
CREATE TABLE resource_reservation (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    resource_type VARCHAR(64) NOT NULL,
    resource_id BIGINT NOT NULL,
    reservation_key VARCHAR(128) NOT NULL,
    status VARCHAR(32) NOT NULL,
    expires_at TIMESTAMP(6) NOT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    UNIQUE KEY uq_active_reservation (resource_type, resource_id, status),
    UNIQUE KEY uq_reservation_key (reservation_key),
    KEY idx_reservation_expiry (status, expires_at)
) ENGINE = InnoDB;
```

Masalah: unique `(resource_type, resource_id, status)` membatasi satu status tertentu, tetapi bisa terlalu kasar. Bisa gunakan generated column agar hanya active reservation yang unique.

```sql
active_resource_key VARCHAR(256) GENERATED ALWAYS AS (
    CASE
        WHEN status = 'ACTIVE' THEN CONCAT(resource_type, ':', resource_id)
        ELSE NULL
    END
) STORED,
UNIQUE KEY uq_active_resource_reservation (active_resource_key)
```

### 13.3 Expiry

Reservation harus punya expiry dan cleanup.

```sql
UPDATE resource_reservation
SET status = 'EXPIRED'
WHERE status = 'ACTIVE'
  AND expires_at < CURRENT_TIMESTAMP(6);
```

### 13.4 Jangan Lupa Idempotency

Create reservation harus idempotent berdasarkan `reservation_key`, agar retry tidak menciptakan reservation baru.

---

## 14. Pattern 12 — Concurrency-Safe Upsert

### 14.1 MySQL Upsert

MySQL menyediakan:

```sql
INSERT INTO case_metric (case_id, metric_name, metric_value)
VALUES (?, ?, ?)
ON DUPLICATE KEY UPDATE
    metric_value = VALUES(metric_value),
    updated_at = CURRENT_TIMESTAMP(6);
```

### 14.2 Hati-Hati Dengan Semantik

Upsert terlihat sederhana, tetapi harus jelas:

- apakah update boleh menimpa nilai lama?
- apakah update harus monotonic?
- apakah event lama boleh mengalahkan event baru?
- apakah source event punya sequence?

### 14.3 Monotonic Update

```sql
INSERT INTO case_projection (
    case_id,
    source_sequence,
    status
) VALUES (?, ?, ?)
ON DUPLICATE KEY UPDATE
    status = IF(VALUES(source_sequence) > source_sequence, VALUES(status), status),
    source_sequence = GREATEST(source_sequence, VALUES(source_sequence));
```

Ini mencegah event lama menimpa projection baru.

---

## 15. Pattern 13 — Advisory Lock: Gunakan Dengan Sangat Selektif

MySQL punya named lock seperti `GET_LOCK()` dan `RELEASE_LOCK()`.

Contoh:

```sql
SELECT GET_LOCK('monthly-close:2026-06', 5);
```

Pola ini bisa berguna untuk:

- job administratif yang jarang.
- scheduler singleton sederhana.
- migration guard.

Tetapi jangan jadikan named lock sebagai mekanisme utama untuk invariant data penting.

Risiko:

- lock terkait connection.
- connection pool bisa membuat lifecycle lock membingungkan.
- failure behavior harus dipahami.
- tidak menggantikan constraint.
- bisa menjadi global bottleneck.

Untuk invariant data, lebih baik gunakan row/constraint transaction.

---

## 16. Retry Design: Yang Boleh Di-Retry Harus Idempotent

### 16.1 Error Yang Umumnya Retriable

Di MySQL/InnoDB:

- deadlock victim.
- lock wait timeout tergantung desain.
- transient connection failure.
- failover-related error.
- serialization/conflict error dari optimistic locking, jika command idempotent dan reload-safe.

Dokumentasi MySQL menyatakan deadlock membuat InnoDB me-rollback seluruh transaksi dan transaksi harus di-retry; lock wait timeout secara default me-rollback statement yang timeout, bukan selalu seluruh transaksi. Ini penting untuk Java retry boundary.

### 16.2 Retry Boundary Yang Benar

Buruk:

```java
@Transactional
public void process() {
    try {
        repository.updateA();
    } catch (DeadlockLoserDataAccessException e) {
        repository.updateA(); // retry sebagian di transaksi yang sama? buruk
    }
}
```

Lebih baik:

```java
retryTemplate.execute(ctx -> transactionTemplate.execute(status -> {
    commandHandler.handle(command);
    return null;
}));
```

Retry harus mengulang seluruh unit of work yang atomic.

### 16.3 Backoff dan Jitter

Tanpa jitter, banyak thread retry bersamaan dan membuat contention spike.

Gunakan:

- max attempts terbatas.
- exponential backoff.
- jitter.
- classification error.
- metric retry count.

### 16.4 Jangan Retry External Side Effect Sembarangan

Kalau transaksi DB sudah commit tetapi HTTP response timeout, client bisa retry. Tanpa idempotency, efek bisa ganda.

Rule:

> Retry aman hanya jika operation idempotent atau punya deduplication key durable.

---

## 17. Exactly-Once Itu Biasanya Ilusi

Dalam sistem DB + message broker + HTTP API, exactly-once end-to-end sulit sekali.

Yang realistis:

- at-least-once delivery.
- idempotent processing.
- deduplication table.
- deterministic event key.
- monotonic sequence.
- transactional outbox.
- reconciliation job.

Target praktis:

> Efek bisnis terjadi tepat sekali secara observasional karena setiap langkah yang bisa diulang punya guard durable.

Bukan karena infrastruktur menjamin tidak ada retry.

---

## 18. Choosing the Right Pattern

| Problem | Pattern Utama | Tambahan |
|---|---|---|
| Prevent duplicate API command | idempotency key | unique constraint, request hash |
| Prevent stale form save | optimistic locking | version column |
| High-contention state transition | conditional update | retry or pessimistic lock |
| Multi-row invariant | pessimistic locking | deterministic lock order |
| Queue worker claim | `FOR UPDATE SKIP LOCKED` | lease, retry, dead-letter |
| Publish event after DB commit | outbox | idempotent consumer |
| Consume duplicate messages | inbox | unique message id |
| One active assignment | unique/generated column | transaction audit |
| Resource reservation | reservation table | expiry, idempotency |
| External side effect | outbox/saga | reconciliation |
| Reporting consistency | avoid `SKIP LOCKED` | read from primary/snapshot as needed |

---

## 19. Java/Spring Implementation Guidance

### 19.1 Keep Transaction Small

Jangan lakukan ini:

```java
@Transactional
public void approveCase(long caseId) {
    Case c = repository.findForUpdate(caseId);
    externalRiskApi.check(c);        // buruk: lock ditahan saat network call
    repository.approve(c);
}
```

Lebih baik:

1. Ambil data minimal tanpa lock.
2. Panggil external API.
3. Mulai transaksi pendek.
4. Revalidasi state.
5. Commit perubahan + outbox/audit.

### 19.2 Jangan Campur Long User Think Time Dengan Transaction

Buruk:

- buka transaksi saat user membuka form.
- lock row selama user berpikir.

Baik:

- read form tanpa lock.
- save menggunakan optimistic locking atau conditional update.

### 19.3 Gunakan Exception Mapping Yang Jelas

Mapping contoh:

| Exception | Meaning | Response |
|---|---|---|
| Duplicate key idempotency | command already exists | return cached/409 |
| Optimistic lock failure | stale command | 409 conflict/reload |
| Deadlock | transient concurrency | retry whole transaction |
| Lock wait timeout | contention or stuck transaction | retry carefully / surface busy |
| Duplicate business key | invariant violation | domain conflict |

### 19.4 Jangan Membuat Transaction Terlalu Besar Karena “Biar Aman”

Transaction besar:

- menahan lock lebih lama.
- memperbesar undo history.
- meningkatkan deadlock window.
- memperlambat purge.
- membuat failover/retry lebih mahal.

Transaction harus cukup besar untuk menjaga invariant, tetapi tidak lebih besar.

---

## 20. Regulatory Case-Management Capstone Example

Bayangkan command:

> `EscalateCaseCommand(caseId, actorId, reasonCode, idempotencyKey)`

Invariant:

1. command dengan idempotency key sama tidak boleh dieksekusi dua kali.
2. case hanya bisa dieskalasi dari status tertentu.
3. hanya boleh ada satu active escalation.
4. audit event wajib tercatat.
5. notification harus terkirim eventually, tetapi tidak boleh dikirim sebelum DB commit.

### 20.1 Transaction Design

```sql
START TRANSACTION;

INSERT INTO api_idempotency (
    idempotency_key,
    operation,
    request_hash,
    status,
    expires_at
) VALUES (?, 'ESCALATE_CASE', ?, 'PROCESSING', TIMESTAMPADD(DAY, 7, CURRENT_TIMESTAMP(6)));

UPDATE enforcement_case
SET status = 'ESCALATED',
    version = version + 1,
    updated_at = CURRENT_TIMESTAMP(6)
WHERE id = ?
  AND status IN ('UNDER_REVIEW', 'NON_COMPLIANT');

-- require affected rows = 1

INSERT INTO case_escalation (
    case_id,
    reason_code,
    status,
    created_by,
    created_at
) VALUES (?, ?, 'OPEN', ?, CURRENT_TIMESTAMP(6));

-- unique generated column prevents second active escalation

INSERT INTO case_audit_event (
    case_id,
    event_type,
    old_status,
    new_status,
    actor_id,
    reason_code,
    occurred_at
) VALUES (?, 'CASE_ESCALATED', ?, 'ESCALATED', ?, ?, CURRENT_TIMESTAMP(6));

INSERT INTO outbox_event (
    aggregate_type,
    aggregate_id,
    event_type,
    event_key,
    payload
) VALUES (
    'ENFORCEMENT_CASE',
    ?,
    'CASE_ESCALATED',
    ?,
    JSON_OBJECT('caseId', ?, 'actorId', ?, 'reasonCode', ?)
);

UPDATE api_idempotency
SET status = 'SUCCEEDED',
    response_code = 200,
    response_body = JSON_OBJECT('caseId', ?, 'status', 'ESCALATED')
WHERE idempotency_key = ?;

COMMIT;
```

### 20.2 Kenapa Desain Ini Kuat?

Karena invariant dijaga di beberapa lapisan:

- duplicate command dicegah unique idempotency key.
- invalid transition dicegah conditional update.
- duplicate active escalation dicegah unique/generated column.
- audit event ada di transaksi sama.
- notification intent ada di outbox dalam transaksi sama.
- external notification dikirim setelah commit oleh publisher.

### 20.3 Failure Analysis

| Failure point | Efek | Recovery |
|---|---|---|
| duplicate idempotency insert | command sudah pernah masuk | return prior result/status |
| conditional update affected 0 | state sudah berubah/tidak valid | rollback + domain conflict |
| escalation unique conflict | active escalation sudah ada | rollback + conflict |
| app crash before commit | semua rollback | retry aman |
| app crash after commit before notify | outbox masih READY | publisher mengirim nanti |
| publisher sends duplicate | consumer/recipient harus idempotent | event key dedupe |

---

## 21. Common Anti-Patterns

### 21.1 Check-Then-Insert Tanpa Unique Constraint

```sql
SELECT COUNT(*) FROM t WHERE business_key = ?;
INSERT INTO t (...);
```

Ini race-prone. Gunakan unique constraint.

### 21.2 External Call Di Dalam Lock

```java
@Transactional
public void process() {
    repository.findForUpdate(id);
    externalClient.call();
    repository.update(id);
}
```

Ini memperpanjang lock berdasarkan latency network.

### 21.3 Retry Tanpa Idempotency

Retry bisa memperbaiki error teknis tetapi menggandakan efek bisnis.

### 21.4 `SKIP LOCKED` Untuk Query Konsistensi

`SKIP LOCKED` tidak boleh dipakai untuk laporan atau validasi lengkap.

### 21.5 Menganggap `@Transactional` Mencegah Semua Race

Transaction memberi atomicity, bukan otomatis validasi invariant. Jika predicate salah, constraint tidak ada, atau isolation tidak sesuai, race tetap terjadi.

### 21.6 Lock Terlalu Awal

Ambil lock hanya ketika siap membuat keputusan dan commit cepat.

### 21.7 Lock Terlalu Banyak Row Karena Index Buruk

Pessimistic locking tanpa index yang tepat adalah insiden menunggu terjadi.

---

## 22. Checklist Desain Concurrency

Sebelum implementasi command penting, jawab pertanyaan berikut:

1. Apa invariant bisnis yang harus dijaga?
2. Apakah invariant bisa dijadikan unique/check/FK constraint?
3. Apakah command idempotent?
4. Apa idempotency key-nya?
5. Apakah update bisa menjadi atomic conditional update?
6. Apakah perlu membaca state terkini dengan lock?
7. Row apa saja yang akan dikunci?
8. Apakah lock order deterministik?
9. Index apa yang memastikan lock footprint kecil?
10. Apa retry boundary-nya?
11. Error apa yang retriable dan non-retriable?
12. Apakah ada external side effect?
13. Apakah perlu outbox?
14. Apakah consumer perlu inbox/deduplication?
15. Apa yang terjadi jika app crash sebelum commit?
16. Apa yang terjadi jika app crash setelah commit?
17. Apa observability untuk stuck/duplicate/retry/dead-letter?
18. Apa reconciliation job-nya?

---

## 23. Practical Heuristics

- Prefer constraint over application-only validation.
- Prefer atomic conditional update for simple state transition.
- Prefer optimistic locking for human edit and low-contention aggregate.
- Prefer pessimistic locking for multi-row, high-value, consistency-critical decisions.
- Use `SKIP LOCKED` for queue-like workload, not general consistency query.
- Every retryable command needs idempotency.
- Every external side effect after DB change needs outbox or equivalent.
- Every at-least-once consumer needs inbox/dedupe.
- Keep transaction short.
- Do not hold DB lock while waiting for human, network, file system, or remote service.
- Make lock acquisition order deterministic.
- Make every concurrency-sensitive query index-backed.
- Treat duplicate key as a domain signal, not always as unexpected exception.
- Treat deadlock as normal under concurrency, but investigate spikes.

---

## 24. What Top 1% Engineers Internalize

Top engineers do not ask only:

> “Apakah query ini benar?”

Mereka bertanya:

- Apakah benar jika dua request berjalan bersamaan?
- Apakah benar jika request pertama commit tetapi response hilang?
- Apakah benar jika worker mati setelah external call?
- Apakah benar jika message dikirim dua kali?
- Apakah benar jika replica stale?
- Apakah benar jika retry terjadi setelah failover?
- Apakah invariant dijaga database atau hanya asumsi service layer?
- Apakah lock footprint bisa dibuktikan dari index dan plan?
- Apakah audit trail tetap lengkap dalam semua path?

Concurrency design bukan tentang menghindari semua conflict. Conflict adalah fakta. Yang penting adalah membuat conflict:

- terdeteksi,
- terbatas,
- retryable jika aman,
- visible secara operasional,
- dan tidak merusak invariant bisnis.

---

## 25. Ringkasan

Bagian ini membahas MySQL sebagai primitive concurrency untuk aplikasi Java production.

Inti pelajaran:

1. Concurrency control bertujuan menjaga invariant.
2. Unique constraint adalah guard yang sangat kuat untuk “hanya satu”.
3. Atomic conditional update sering lebih sederhana dan lebih aman daripada read-then-write.
4. Optimistic locking cocok untuk conflict jarang dan stale write detection.
5. Pessimistic locking cocok untuk keputusan yang perlu state terkini dan multi-row consistency.
6. `SKIP LOCKED` berguna untuk queue, tetapi tidak untuk query yang butuh completeness.
7. Idempotency wajib untuk retry-safe API/command.
8. Outbox menyelesaikan dual-write antara DB dan external event intent.
9. Inbox/dedupe diperlukan untuk at-least-once consumer.
10. Transaction harus pendek, index-backed, dan punya retry boundary yang jelas.

---

## 26. Referensi Utama

- MySQL Reference Manual — InnoDB Locking Reads, `FOR UPDATE`, `FOR SHARE`, `NOWAIT`, `SKIP LOCKED`.
- MySQL Reference Manual — InnoDB Error Handling, deadlock rollback and retry guidance.
- MySQL Reference Manual — InnoDB Locks and Transaction Model.
- MySQL Reference Manual — Constraints, generated columns, indexes, and transaction behavior.

---

## 27. Status Seri

Seri belum selesai.

Bagian yang sudah selesai sampai sini:

- `part-000` sampai `part-029`.

Bagian berikutnya:

- `learn-mysql-mastery-for-java-engineers-part-030.md` — **Partitioning, Archiving, Retention, and Large Tables**.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-mysql-mastery-for-java-engineers-part-028.md">⬅️ Part 028 — Debugging Production Incidents in MySQL</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-mysql-mastery-for-java-engineers-part-030.md">Part 030 — Partitioning, Archiving, Retention, and Large Tables ➡️</a>
</div>
