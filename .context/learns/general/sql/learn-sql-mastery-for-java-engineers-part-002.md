# learn-sql-mastery-for-java-engineers-part-002.md

# Part 2 — SQL Language Model: DDL, DML, DQL, DCL, TCL

> Seri: SQL Mastery for Java Engineers  
> Bagian: 002 dari 034  
> Status seri: **belum selesai**  
> Bagian sebelumnya: `learn-sql-mastery-for-java-engineers-part-001.md`  
> Bagian berikutnya: `learn-sql-mastery-for-java-engineers-part-003.md`

---

## 0. Tujuan Bagian Ini

Bagian sebelumnya membangun fondasi berpikir relasional:

- relation
- tuple
- attribute
- predicate
- key
- constraint
- grain
- set/bag semantics

Sekarang kita masuk ke SQL sebagai **bahasa lengkap**.

Banyak engineer mengira SQL hampir sama dengan `SELECT`.

Padahal SQL adalah bahasa untuk:

1. mendefinisikan struktur data
2. membaca data
3. mengubah data
4. menjaga invariant
5. mengatur privilege
6. mengontrol transaksi
7. mendefinisikan view/procedure/function
8. memengaruhi cara database mengeksekusi workload
9. mengelola boundary correctness antara aplikasi dan database

Secara praktis, statement SQL sering dikelompokkan menjadi:

- DDL — Data Definition Language
- DML — Data Manipulation Language
- DQL — Data Query Language
- DCL — Data Control Language
- TCL — Transaction Control Language

Catatan penting:

> Pembagian DQL sebagai kategori terpisah tidak selalu eksplisit di semua standar/vendor. Banyak sumber mengelompokkan `SELECT` sebagai bagian dari DML. Namun untuk pembelajaran engineering, memisahkan DQL berguna karena membaca data memiliki mental model dan failure mode yang berbeda dari mengubah data.

Bagian ini akan menjawab:

- Apa fungsi setiap kelompok SQL?
- Statement apa saja yang termasuk di dalamnya?
- Bagaimana lifecycle statement SQL?
- Bagaimana SQL statement memengaruhi sistem Java?
- Apa perbedaan SQL standard dan vendor dialect?
- Bagaimana menulis SQL yang maintainable dan reviewable?
- Bagaimana menghubungkan SQL statement dengan correctness, performance, dan operability?

---

## 1. Big Picture: SQL Bukan Satu Bahasa Kecil

SQL bukan hanya:

```sql
SELECT * FROM users;
```

SQL adalah keluarga bahasa yang mencakup beberapa jenis operasi.

Secara mental, kamu bisa membaginya seperti ini:

```text
DDL -> membentuk struktur dunia
DML -> mengubah fakta di dunia
DQL -> menanyakan fakta di dunia
DCL -> mengatur siapa boleh melakukan apa
TCL -> mengontrol kapan perubahan menjadi final
```

Contoh:

```sql
-- DDL
CREATE TABLE cases (
    id UUID PRIMARY KEY,
    case_number TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL
);

-- DML
INSERT INTO cases (id, case_number, status)
VALUES ('00000000-0000-0000-0000-000000000001', 'CASE-2026-0001', 'OPEN');

-- DQL
SELECT id, case_number
FROM cases
WHERE status = 'OPEN';

-- DCL
GRANT SELECT ON cases TO reporting_user;

-- TCL
BEGIN;
UPDATE cases SET status = 'UNDER_REVIEW' WHERE id = '00000000-0000-0000-0000-000000000001';
COMMIT;
```

Dalam production system, semua kategori ini saling berkaitan.

Misalnya:

- DDL menentukan constraint.
- Constraint memengaruhi DML.
- DML terjadi dalam transaksi.
- Transaksi memengaruhi visibility DQL.
- DCL menentukan apakah query boleh dijalankan.
- Index DDL memengaruhi performa DQL dan DML.
- Migration DDL memengaruhi availability aplikasi Java.

---

## 2. Kenapa Java Engineer Harus Memahami Kategori SQL

Sebagai Java engineer, kamu mungkin tidak menulis semua SQL manual. Mungkin kamu memakai:

- JPA/Hibernate
- Spring Data
- jOOQ
- MyBatis
- JDBC
- Flyway
- Liquibase
- stored procedures
- database migration pipeline

Tetapi kategori SQL tetap muncul.

Contoh di Java ecosystem:

| SQL Category | Muncul di Java sebagai |
|---|---|
| DDL | Flyway/Liquibase migration, Hibernate schema generation |
| DML | repository save/update/delete, batch jobs |
| DQL | repository find/search/reporting query |
| DCL | provisioning database user, read-only role, app role |
| TCL | `@Transactional`, JDBC transaction, connection autocommit |

Jika kamu tidak memahami kategori ini, kamu akan sulit menjawab pertanyaan production seperti:

- Mengapa migration membuat table lock?
- Mengapa update besar membuat replication lag?
- Mengapa query read-only melihat data lama?
- Mengapa service bisa insert duplicate?
- Mengapa user reporting tidak bisa query view?
- Mengapa rollback tidak membatalkan DDL tertentu di vendor tertentu?
- Mengapa `@Transactional` tidak bekerja seperti yang dipikirkan?
- Mengapa query ORM menghasilkan deadlock?
- Mengapa index baru memperlambat write path?
- Mengapa `SELECT` bisa memblokir atau diblokir dalam kondisi tertentu?

SQL language model adalah peta untuk semua pertanyaan itu.

---

## 3. DDL — Data Definition Language

DDL adalah kelompok statement untuk mendefinisikan, mengubah, dan menghapus struktur database.

Contoh utama:

```sql
CREATE
ALTER
DROP
TRUNCATE
COMMENT
RENAME
```

Objek yang dapat didefinisikan:

- database
- schema
- table
- view
- materialized view
- index
- sequence
- constraint
- type
- domain
- function
- procedure
- trigger
- role
- policy
- extension
- partition
- tablespace

Tidak semua vendor mendukung objek yang sama.

---

## 4. CREATE: Membuat Struktur

### 4.1 CREATE TABLE

Contoh:

```sql
CREATE TABLE cases (
    id UUID PRIMARY KEY,
    case_number TEXT NOT NULL,
    jurisdiction_code TEXT NOT NULL,
    status TEXT NOT NULL,
    opened_at TIMESTAMPTZ NOT NULL,
    closed_at TIMESTAMPTZ,

    CONSTRAINT uq_cases_jurisdiction_case_number
    UNIQUE (jurisdiction_code, case_number),

    CONSTRAINT ck_cases_status
    CHECK (status IN ('OPEN', 'UNDER_REVIEW', 'ESCALATED', 'CLOSED', 'CANCELLED')),

    CONSTRAINT ck_cases_closed_at
    CHECK (
        (status = 'CLOSED' AND closed_at IS NOT NULL)
        OR
        (status <> 'CLOSED')
    )
);
```

Ini bukan sekadar membuat storage.

Statement ini mendefinisikan:

- identity teknis: `id`
- business uniqueness: `(jurisdiction_code, case_number)`
- domain status valid
- sebagian lifecycle rule
- nullability
- tipe data
- struktur fakta

`CREATE TABLE` adalah statement domain modelling.

---

### 4.2 CREATE INDEX

Contoh:

```sql
CREATE INDEX idx_cases_status_opened_at
ON cases (status, opened_at);
```

Index adalah struktur akses.

Ia tidak mengubah logical data, tetapi mengubah cara database dapat mencari data.

Namun index juga berdampak pada write path:

- `INSERT` harus menambah entry index
- `UPDATE` pada indexed column harus update index
- `DELETE` harus membersihkan index entry
- storage bertambah
- vacuum/maintenance bertambah
- migration index bisa mahal

Jadi `CREATE INDEX` bukan sekadar optimasi gratis.

---

### 4.3 CREATE VIEW

Contoh:

```sql
CREATE VIEW open_case_summary AS
SELECT
    c.id,
    c.case_number,
    c.status,
    c.opened_at
FROM cases c
WHERE c.status = 'OPEN';
```

View adalah abstraction layer.

Ia bisa digunakan untuk:

- menyederhanakan query
- membatasi kolom yang terlihat
- menyembunyikan complexity
- membuat contract untuk reporting
- security boundary sederhana
- compatibility layer saat migration

Namun view juga bisa menjadi anti-pattern jika menumpuk:

```text
view A depends on view B
view B depends on view C
view C depends on view D
```

Akhirnya query plan sulit dipahami.

---

### 4.4 CREATE SCHEMA

Schema adalah namespace.

Contoh:

```sql
CREATE SCHEMA regulatory;
CREATE SCHEMA audit;
CREATE SCHEMA reporting;
```

Manfaat:

- memisahkan domain objek
- mengatur privilege
- menghindari nama bentrok
- membedakan operational tables dan reporting views
- memisahkan extension/internal object

Contoh:

```text
regulatory.cases
regulatory.case_assignments
audit.case_events
reporting.case_summary
```

Schema bukan hanya folder. Ia juga security dan organization boundary.

---

### 4.5 CREATE TYPE / DOMAIN

Vendor seperti PostgreSQL mendukung custom type/domain.

Contoh domain:

```sql
CREATE DOMAIN case_status AS TEXT
CHECK (VALUE IN ('OPEN', 'UNDER_REVIEW', 'ESCALATED', 'CLOSED', 'CANCELLED'));
```

Lalu:

```sql
CREATE TABLE cases (
    id UUID PRIMARY KEY,
    status case_status NOT NULL
);
```

Keuntungan:

- reusable domain rule
- konsistensi antar table
- dokumentasi eksplisit
- mengurangi copy-paste check constraint

Kekurangan:

- vendor-specific
- migration bisa lebih sulit
- ORM support bervariasi

---

## 5. ALTER: Mengubah Struktur

`ALTER` adalah statement paling sering muncul dalam migration.

Contoh:

```sql
ALTER TABLE cases
ADD COLUMN risk_level TEXT;
```

```sql
ALTER TABLE cases
ADD CONSTRAINT ck_cases_risk_level
CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'));
```

```sql
ALTER TABLE cases
ALTER COLUMN risk_level SET NOT NULL;
```

---

### 5.1 ALTER TABLE Bukan Selalu Murah

Beberapa perubahan schema bisa sangat mahal, tergantung vendor, ukuran table, dan jenis perubahan:

- add column with default
- set not null
- change column type
- add foreign key
- add check constraint
- create unique constraint
- drop column
- rewrite table
- validate existing data
- lock table

Di production, DDL harus dipikirkan sebagai operational event.

Pertanyaan penting:

```text
Apakah DDL ini mengambil lock?
Apakah table akan direwrite?
Apakah existing data valid?
Apakah migration bisa dipecah?
Apakah perlu backfill?
Apakah aplikasi versi lama dan baru kompatibel?
Apakah ada rollback strategy?
Apakah read/write traffic terganggu?
```

---

### 5.2 Expand-and-Contract Pattern

Untuk zero/minimal downtime migration, gunakan pola expand-and-contract.

Misalnya ingin mengganti column:

```text
old_status -> status_code
```

Jangan langsung drop old column.

Tahap:

1. Expand: tambah column baru nullable.
2. Deploy aplikasi yang menulis ke dua column.
3. Backfill data lama.
4. Validasi konsistensi.
5. Deploy aplikasi yang membaca column baru.
6. Stop write ke old column.
7. Contract: drop old column setelah aman.

SQL:

```sql
ALTER TABLE cases ADD COLUMN status_code TEXT;
```

Backfill:

```sql
UPDATE cases
SET status_code = status
WHERE status_code IS NULL;
```

Constraint setelah data valid:

```sql
ALTER TABLE cases
ALTER COLUMN status_code SET NOT NULL;
```

Contract:

```sql
ALTER TABLE cases DROP COLUMN status;
```

Ini bukan hanya SQL. Ini koordinasi antara DDL, DML, deploy aplikasi, dan observability.

---

## 6. DROP: Menghapus Struktur

Contoh:

```sql
DROP TABLE old_cases;
DROP INDEX idx_cases_old_status;
DROP VIEW old_case_summary;
```

`DROP` berbahaya karena bisa irreversible jika tidak ada backup/restore.

Pertanyaan sebelum `DROP`:

```text
Apakah objek masih dipakai aplikasi?
Apakah dipakai report/BI?
Apakah dipakai stored procedure?
Apakah dipakai view lain?
Apakah dipakai job malam?
Apakah dipakai user manual?
Apakah ada dependency tersembunyi?
Apakah ada audit/retention requirement?
Apakah backup sudah tested?
```

Dalam sistem enterprise, objek database sering dipakai lebih luas daripada source code utama.

---

## 7. TRUNCATE: Cepat tapi Berbahaya

```sql
TRUNCATE TABLE staging_case_imports;
```

`TRUNCATE` menghapus semua row dengan cara yang biasanya lebih cepat daripada `DELETE`.

Namun perhatian:

- bisa mengambil lock kuat
- bisa reset identity/sequence tergantung opsi
- trigger behavior berbeda antar vendor
- foreign key dependency bisa menghalangi
- rollback behavior berbeda antar vendor/setting
- audit row-level mungkin tidak terjadi
- sangat berbahaya jika salah table

Untuk staging table, `TRUNCATE` sering cocok.

Untuk production business table, gunakan sangat hati-hati.

---

## 8. DML — Data Manipulation Language

DML adalah statement untuk mengubah data.

Statement utama:

```sql
INSERT
UPDATE
DELETE
MERGE
```

Beberapa sumber/vendor memasukkan `SELECT` ke DML. Dalam seri ini, `SELECT` akan diperlakukan sebagai DQL agar mental model read dan write tidak tercampur.

DML mengubah fakta dalam relation.

DML hampir selalu harus dipikirkan bersama:

- transaction
- constraint
- lock
- trigger
- index update
- replication
- audit
- idempotency
- error handling
- retry behavior
- concurrency

---

## 9. INSERT: Menambah Fakta

Contoh:

```sql
INSERT INTO cases (
    id,
    jurisdiction_code,
    case_number,
    status,
    opened_at
)
VALUES (
    gen_random_uuid(),
    'ID-JKT',
    'CASE-2026-0001',
    'OPEN',
    now()
);
```

Secara relasional:

> Tambahkan fakta bahwa case baru ini ada.

Namun secara engineering, insert juga memicu:

- primary key validation
- unique validation
- foreign key validation
- check constraint validation
- not-null validation
- default expression evaluation
- trigger execution
- index maintenance
- WAL/redo logging
- replication
- lock acquisition
- transaction visibility

---

### 9.1 INSERT ... SELECT

```sql
INSERT INTO case_audit_snapshots (
    case_id,
    status,
    snapshot_at
)
SELECT
    id,
    status,
    now()
FROM cases
WHERE status IN ('OPEN', 'ESCALATED');
```

Ini menyalin hasil query menjadi fakta baru.

Risiko:

- duplicate insert jika dijalankan ulang
- snapshot tidak idempotent
- query source berubah selama transaksi
- jumlah row besar
- trigger/index overhead
- lock/replication lag

Untuk job production, harus ada idempotency strategy.

---

### 9.2 INSERT Idempotent

Contoh dengan unique key:

```sql
CREATE TABLE imported_cases (
    source_system TEXT NOT NULL,
    source_case_id TEXT NOT NULL,
    case_id UUID NOT NULL REFERENCES cases(id),

    PRIMARY KEY (source_system, source_case_id)
);
```

Insert idempotent di PostgreSQL:

```sql
INSERT INTO imported_cases (
    source_system,
    source_case_id,
    case_id
)
VALUES (
    'LEGACY_A',
    '12345',
    :case_id
)
ON CONFLICT (source_system, source_case_id)
DO NOTHING;
```

Idempotency bukan nice-to-have. Dalam distributed system, retry normal terjadi.

---

## 10. UPDATE: Mengubah Fakta

Contoh:

```sql
UPDATE cases
SET status = 'UNDER_REVIEW'
WHERE id = :case_id
  AND status = 'OPEN';
```

Perhatikan predicate:

```sql
WHERE id = :case_id
  AND status = 'OPEN'
```

Ini bukan hanya filter. Ini concurrency guard.

Artinya:

> Ubah status hanya jika case masih OPEN.

Jika row count = 0, kemungkinan:

- case tidak ada
- status sudah berubah
- request stale
- concurrent update menang lebih dulu
- authorization filter tidak cocok

Java code harus mengecek affected rows.

---

### 10.1 UPDATE Tanpa WHERE

```sql
UPDATE cases
SET status = 'CLOSED';
```

Ini mengubah semua row.

Kadang valid untuk maintenance, tapi sering disaster.

Safety habit:

```sql
BEGIN;

UPDATE cases
SET status = 'CLOSED'
WHERE id = :case_id;

-- check row count/result

COMMIT;
```

Untuk manual operation:

```sql
SELECT COUNT(*)
FROM cases
WHERE status = 'UNDER_REVIEW';

UPDATE cases
SET status = 'ESCALATED'
WHERE status = 'UNDER_REVIEW'
  AND risk_level = 'CRITICAL';

SELECT COUNT(*)
FROM cases
WHERE status = 'ESCALATED'
  AND risk_level = 'CRITICAL';
```

---

### 10.2 UPDATE dengan Join

Vendor syntax berbeda.

PostgreSQL:

```sql
UPDATE cases c
SET status = 'ESCALATED'
FROM case_risk_scores r
WHERE r.case_id = c.id
  AND r.risk_level = 'CRITICAL'
  AND c.status = 'UNDER_REVIEW';
```

MySQL:

```sql
UPDATE cases c
JOIN case_risk_scores r ON r.case_id = c.id
SET c.status = 'ESCALATED'
WHERE r.risk_level = 'CRITICAL'
  AND c.status = 'UNDER_REVIEW';
```

Vendor dialect penting.

Jangan menganggap semua SQL portable.

---

## 11. DELETE: Menghapus Fakta

Contoh:

```sql
DELETE FROM case_notes
WHERE id = :note_id;
```

Dalam domain audit/regulatory, hard delete sering tidak boleh.

Alternatif:

- soft delete
- status change
- tombstone event
- retention-based purge
- archive table
- anonymization
- legal hold

Soft delete:

```sql
UPDATE case_notes
SET deleted_at = now(),
    deleted_by = :user_id
WHERE id = :note_id
  AND deleted_at IS NULL;
```

Tetapi soft delete juga punya biaya:

- semua query harus filter deleted rows
- unique constraint harus aware
- index perlu partial
- storage tumbuh
- data privacy issue jika dianggap sudah terhapus
- retention tetap harus dikelola

---

## 12. MERGE dan UPSERT

### 12.1 Problem

Kadang kamu ingin:

```text
if exists -> update
if not exists -> insert
```

Ini umum untuk:

- import data
- sync external system
- idempotent command
- materialized summary
- cache table
- reference data refresh

---

### 12.2 PostgreSQL ON CONFLICT

```sql
INSERT INTO case_external_refs (
    source_system,
    source_case_id,
    case_id,
    last_seen_at
)
VALUES (
    :source_system,
    :source_case_id,
    :case_id,
    now()
)
ON CONFLICT (source_system, source_case_id)
DO UPDATE
SET last_seen_at = EXCLUDED.last_seen_at;
```

---

### 12.3 SQL MERGE

Banyak vendor mendukung `MERGE`, tetapi detailnya berbeda.

Contoh generik:

```sql
MERGE INTO case_external_refs target
USING staging_case_external_refs source
ON (
    target.source_system = source.source_system
    AND target.source_case_id = source.source_case_id
)
WHEN MATCHED THEN
    UPDATE SET last_seen_at = source.last_seen_at
WHEN NOT MATCHED THEN
    INSERT (source_system, source_case_id, case_id, last_seen_at)
    VALUES (source.source_system, source.source_case_id, source.case_id, source.last_seen_at);
```

`MERGE` powerful tapi harus hati-hati:

- source duplicate bisa menyebabkan error/undefined behavior tergantung vendor
- concurrency semantics berbeda
- trigger behavior harus dipahami
- affected rows perlu dimonitor
- idempotency tetap butuh key

---

## 13. DQL — Data Query Language

DQL di sini mengacu pada statement untuk membaca data, terutama:

```sql
SELECT
```

DQL tidak mengubah logical data, tapi bukan berarti gratis atau tanpa risiko.

`SELECT` bisa:

- membaca banyak row
- melakukan sort besar
- memakai memory besar
- membuat temp file
- menahan snapshot lama
- menyebabkan vacuum tertahan di MVCC database
- mengambil lock tertentu
- membebani replica
- menghasilkan load ke storage
- memblokir DDL
- memicu timeout aplikasi

Read path juga harus di-engineer.

---

## 14. SELECT: Membaca Fakta

Contoh:

```sql
SELECT
    id,
    case_number,
    status
FROM cases
WHERE status = 'OPEN'
ORDER BY opened_at DESC
LIMIT 50;
```

Pertanyaan senior:

```text
Apa grain-nya?
Apakah ORDER BY deterministic?
Apakah index mendukung WHERE + ORDER BY?
Apakah LIMIT tanpa stable pagination cukup?
Apakah status punya constraint?
Apakah query ini untuk UI atau report?
Apakah read dari primary atau replica?
Apakah replica lag acceptable?
```

---

### 14.1 SELECT Logical Processing Order

Secara logical:

```text
FROM
JOIN/ON
WHERE
GROUP BY
HAVING
SELECT
DISTINCT
ORDER BY
LIMIT/OFFSET
```

Contoh:

```sql
SELECT status, COUNT(*) AS total
FROM cases
WHERE opened_at >= DATE '2026-01-01'
GROUP BY status
HAVING COUNT(*) > 10
ORDER BY total DESC;
```

Mental model:

1. Ambil relation `cases`.
2. Filter row sejak 2026-01-01.
3. Group by status.
4. Hitung total per status.
5. Filter group dengan count > 10.
6. Project status dan total.
7. Sort berdasarkan total.

Physical execution bisa berbeda.

Optimizer bisa:

- push predicate
- reorder join
- choose index
- use hash aggregate
- parallelize
- materialize
- avoid sort if index order cocok

---

### 14.2 SELECT Tidak Selalu Read-Only Secara Sistemik

Walaupun tidak mengubah data bisnis, `SELECT` bisa punya efek sistemik:

- `SELECT FOR UPDATE` mengambil lock
- function dalam SELECT bisa punya side effect di beberapa database jika function volatile
- query berat bisa mengganggu workload write
- long-running SELECT bisa menahan snapshot
- SELECT dari view bisa menjalankan query kompleks
- SELECT dari foreign table bisa akses external system

Jadi “read-only” bukan berarti “risk-free”.

---

## 15. DCL — Data Control Language

DCL mengatur akses.

Statement utama:

```sql
GRANT
REVOKE
```

Kadang role/user management seperti `CREATE ROLE` secara formal masuk DDL di beberapa vendor, tetapi secara security lifecycle sering dibahas bersama DCL.

---

## 16. GRANT: Memberi Hak

Contoh:

```sql
GRANT SELECT ON TABLE cases TO reporting_user;
```

```sql
GRANT INSERT, UPDATE ON TABLE case_notes TO app_writer;
```

```sql
GRANT USAGE ON SCHEMA regulatory TO app_user;
```

Privilege bisa berada di level:

- database
- schema
- table
- column
- sequence
- function
- procedure
- view
- materialized view

---

### 16.1 Least Privilege

Aplikasi sebaiknya tidak selalu memakai superuser.

Pisahkan role:

```text
app_readwrite
app_readonly
migration_owner
reporting_readonly
audit_readonly
etl_loader
```

Contoh:

```sql
GRANT SELECT, INSERT, UPDATE ON cases TO app_readwrite;
GRANT SELECT ON cases TO reporting_readonly;
```

Manfaat:

- membatasi blast radius
- mencegah accidental DDL dari app
- mencegah report mengubah data
- memudahkan audit
- membantu compliance
- memisahkan ownership

---

### 16.2 Column-Level Privilege

Jika ada PII/sensitive data:

```sql
GRANT SELECT (id, case_number, status)
ON cases
TO reporting_readonly;
```

Tidak semua vendor punya behavior sama, tapi konsepnya penting.

---

## 17. REVOKE: Mencabut Hak

```sql
REVOKE UPDATE ON cases FROM reporting_user;
```

`REVOKE` harus dikelola hati-hati karena privilege bisa datang dari:

- direct grant
- role membership
- default privilege
- inherited role
- ownership
- public grants

Ketika akses masih bisa dilakukan setelah revoke, periksa role chain.

---

## 18. Row-Level Security dan Policy

Beberapa database mendukung row-level security.

Contoh PostgreSQL-style:

```sql
ALTER TABLE cases ENABLE ROW LEVEL SECURITY;

CREATE POLICY cases_by_jurisdiction
ON cases
FOR SELECT
USING (jurisdiction_code = current_setting('app.current_jurisdiction'));
```

Konsep:

> User boleh query table, tetapi hanya row tertentu yang visible.

RLS berguna untuk:

- multi-tenant isolation
- jurisdiction-based access
- officer assignment-based access
- data compartmentalization
- regulatory confidentiality

Risiko:

- policy complex sulit debug
- performance bisa terdampak
- aplikasi harus set session context benar
- reporting query bisa bingung karena row tidak terlihat
- superuser/bypass role behavior harus dipahami

---

## 19. TCL — Transaction Control Language

TCL mengontrol transaction boundary.

Statement utama:

```sql
BEGIN
START TRANSACTION
COMMIT
ROLLBACK
SAVEPOINT
ROLLBACK TO SAVEPOINT
RELEASE SAVEPOINT
SET TRANSACTION
```

Transaksi menjawab:

> Kapan sekumpulan perubahan dianggap sebagai satu unit benar?

---

## 20. BEGIN / START TRANSACTION

```sql
BEGIN;
```

atau:

```sql
START TRANSACTION;
```

Setelah ini, perubahan berjalan dalam satu transaction context.

Contoh:

```sql
BEGIN;

UPDATE cases
SET status = 'ESCALATED'
WHERE id = :case_id
  AND status = 'UNDER_REVIEW';

INSERT INTO case_status_transitions (
    id,
    case_id,
    from_status,
    to_status,
    transitioned_at,
    transitioned_by
)
VALUES (
    gen_random_uuid(),
    :case_id,
    'UNDER_REVIEW',
    'ESCALATED',
    now(),
    :user_id
);

COMMIT;
```

Masalah: query ini bisa inkonsisten jika `UPDATE` tidak mempengaruhi row tetapi `INSERT` tetap jalan.

Lebih aman:

- cek affected rows di aplikasi
- gunakan CTE vendor-specific
- enforce dengan constraint/trigger/procedure
- gunakan row lock bila perlu

---

## 21. COMMIT

```sql
COMMIT;
```

Commit membuat perubahan transaction menjadi durable/visible sesuai isolation rules.

Setelah commit:

- constraint final divalidasi
- lock dilepas
- data visible ke transaction lain
- WAL/redo sudah memenuhi durability semantics vendor
- replication akan menerima perubahan
- trigger after commit/event mungkin jalan tergantung sistem eksternal

Java side:

```java
@Transactional
public void escalateCase(UUID caseId) {
    caseRepository.escalate(caseId);
    transitionRepository.insert(...);
}
```

`@Transactional` pada akhirnya harus map ke database transaction.

Jika method internal call tidak melewati proxy Spring, transaction mungkin tidak aktif. Ini bukan masalah SQL, tapi boundary Java-database.

---

## 22. ROLLBACK

```sql
ROLLBACK;
```

Rollback membatalkan perubahan dalam transaction.

Namun tidak semua hal selalu “terasa rollback” secara sederhana.

Contoh:

- sequence value biasanya tidak mundur
- external side effect tidak rollback
- email/message yang sudah terkirim tidak rollback
- log aplikasi tidak rollback
- beberapa DDL vendor-specific mungkin auto-commit
- function dengan side effect eksternal tidak rollback

Karena itu jangan campur transaction database dengan side effect eksternal tanpa outbox/saga/compensation strategy.

---

## 23. SAVEPOINT

Savepoint memungkinkan rollback sebagian.

```sql
BEGIN;

INSERT INTO case_import_batches (id, source_file)
VALUES (:batch_id, :source_file);

SAVEPOINT before_row_1;

INSERT INTO imported_cases (
    id,
    external_case_id
)
VALUES (
    :case_id,
    :external_case_id
);

-- jika row gagal:
ROLLBACK TO SAVEPOINT before_row_1;

COMMIT;
```

Use case:

- import batch
- partial error handling
- bulk processing
- stored procedure complex
- migration data cleanup

Tapi terlalu banyak savepoint bisa mahal dan membuat logic sulit.

---

## 24. SET TRANSACTION

Contoh:

```sql
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
```

atau:

```sql
SET TRANSACTION READ ONLY;
```

Isolation level memengaruhi visibility dan anomaly.

Ini akan dibahas detail di part 019 dan part 020, tetapi untuk sekarang pahami:

> TCL bukan sekadar `COMMIT`/`ROLLBACK`; ia menentukan consistency semantics dari unit kerja.

---

## 25. Autocommit: Default yang Sering Disalahpahami

Banyak driver/database memakai autocommit default.

Artinya setiap statement menjadi transaksi sendiri.

Contoh:

```sql
UPDATE cases SET status = 'ESCALATED' WHERE id = :case_id;

INSERT INTO case_status_transitions (
    id,
    case_id,
    from_status,
    to_status
)
VALUES (
    gen_random_uuid(),
    :case_id,
    'UNDER_REVIEW',
    'ESCALATED'
);
```

Jika autocommit aktif, dua statement ini bisa commit terpisah.

Jika statement kedua gagal, status sudah berubah tanpa history.

Dalam Java/JDBC, connection autocommit behavior sangat penting.

Spring `@Transactional` biasanya mematikan autocommit untuk scope transaction, lalu commit/rollback saat method selesai.

Tetapi kesalahan konfigurasi dapat menyebabkan partial write.

---

## 26. Statement Lifecycle: Dari SQL Text ke Result

Satu SQL statement biasanya melewati tahap konseptual:

```text
1. Client sends SQL
2. Parse
3. Bind parameters
4. Rewrite/normalize
5. Validate privileges
6. Plan/optimize
7. Execute
8. Return result/row count/error
9. Commit/rollback depending transaction state
```

Vendor berbeda dalam detail, tetapi mental model ini berguna.

---

### 26.1 Parse

Database membaca SQL text dan membuat parse tree.

Syntax error terjadi di sini.

```sql
SELEC * FROM cases;
```

---

### 26.2 Bind

Parameter disambungkan ke statement.

Prepared statement:

```sql
SELECT *
FROM cases
WHERE id = ?;
```

Java:

```java
PreparedStatement ps = connection.prepareStatement(
    "SELECT * FROM cases WHERE id = ?"
);
ps.setObject(1, caseId);
```

Binding penting untuk:

- SQL injection prevention
- type handling
- plan caching
- performance
- correctness

---

### 26.3 Rewrite

Database dapat rewrite query.

Contoh:

- expand view
- apply rules
- simplify predicates
- transform subquery
- push down predicates

---

### 26.4 Validate

Database memeriksa:

- table ada
- column ada
- function ada
- type cocok
- privilege cukup
- constraint dapat diterapkan

---

### 26.5 Plan/Optimize

Optimizer memilih execution plan.

Contoh keputusan:

- pakai index atau sequential scan
- join order
- join algorithm
- aggregation method
- sort strategy
- parallelism
- partition pruning

Query yang sama secara logical bisa dieksekusi dengan plan berbeda.

---

### 26.6 Execute

Executor menjalankan plan.

Di tahap ini terjadi:

- row read/write
- lock acquisition
- MVCC visibility check
- function evaluation
- constraint check
- trigger execution
- index update
- sort/hash/aggregate
- temp file usage

---

### 26.7 Return Result or Row Count

DQL mengembalikan result set.

DML biasanya mengembalikan affected row count, dan beberapa vendor mendukung `RETURNING`.

Contoh PostgreSQL:

```sql
UPDATE cases
SET status = 'ESCALATED'
WHERE id = :case_id
  AND status = 'UNDER_REVIEW'
RETURNING id, status;
```

`RETURNING` sangat berguna untuk atomic read-after-write.

---

## 27. SQL Standard vs Vendor Dialect

SQL memiliki standard, tetapi implementasi nyata berbeda.

Vendor populer:

- PostgreSQL
- MySQL
- MariaDB
- SQL Server
- Oracle Database
- SQLite
- DB2
- Snowflake
- BigQuery
- Redshift
- DuckDB

Perbedaan bisa muncul pada:

- data type
- date/time function
- JSON support
- upsert syntax
- merge semantics
- identity/sequence
- pagination
- CTE behavior
- recursive query
- locking syntax
- isolation default
- index types
- partial index
- expression index
- generated column
- stored procedure language
- function volatility
- transaction behavior for DDL
- case sensitivity
- collation
- boolean type
- enum type
- array type

---

## 28. Contoh Dialect Differences

### 28.1 Pagination

PostgreSQL/MySQL:

```sql
SELECT *
FROM cases
ORDER BY opened_at DESC
LIMIT 50 OFFSET 100;
```

SQL Server:

```sql
SELECT *
FROM cases
ORDER BY opened_at DESC
OFFSET 100 ROWS FETCH NEXT 50 ROWS ONLY;
```

Oracle modern juga mendukung `FETCH FIRST`.

---

### 28.2 Current Timestamp

PostgreSQL:

```sql
SELECT now();
```

Standard-ish:

```sql
SELECT CURRENT_TIMESTAMP;
```

SQL Server:

```sql
SELECT SYSDATETIME();
```

Oracle:

```sql
SELECT SYSTIMESTAMP FROM dual;
```

---

### 28.3 String Concatenation

Standard/PostgreSQL/Oracle:

```sql
SELECT first_name || ' ' || last_name
FROM officers;
```

MySQL:

```sql
SELECT CONCAT(first_name, ' ', last_name)
FROM officers;
```

SQL Server:

```sql
SELECT first_name + ' ' + last_name
FROM officers;
```

---

### 28.4 Upsert

PostgreSQL:

```sql
INSERT INTO cases (id, case_number)
VALUES (:id, :case_number)
ON CONFLICT (case_number)
DO UPDATE SET id = EXCLUDED.id;
```

MySQL:

```sql
INSERT INTO cases (id, case_number)
VALUES (:id, :case_number)
ON DUPLICATE KEY UPDATE id = VALUES(id);
```

SQL Server/Oracle sering menggunakan `MERGE`, tetapi masing-masing punya caveat.

---

## 29. Portability: Kapan Penting, Kapan Tidak

Portability adalah kemampuan SQL berjalan di banyak database.

### 29.1 Portability Penting Jika

- produk harus mendukung banyak database customer
- library/framework reusable
- vendor belum dipilih
- organisasi punya multi-vendor environment
- query sederhana dan bisa standard
- kamu menulis migration framework generic

### 29.2 Portability Tidak Selalu Penting Jika

- sistem production memakai satu database strategis
- fitur vendor memberi correctness/performance besar
- operational team sangat menguasai vendor tersebut
- compliance membutuhkan fitur vendor tertentu
- query kompleks lebih aman dengan fitur spesifik

Contoh PostgreSQL partial unique index:

```sql
CREATE UNIQUE INDEX uq_one_active_primary_assignment
ON case_assignments (case_id)
WHERE assignment_role = 'PRIMARY'
  AND ended_at IS NULL;
```

Ini sangat berguna untuk invariant:

> maksimal satu active primary assignment per case.

Jika menghindarinya hanya demi portability, kamu mungkin kehilangan constraint kuat.

Prinsip matang:

> Tulis SQL portable untuk hal umum. Gunakan fitur vendor-specific secara sadar untuk correctness, performance, atau operability yang penting.

---

## 30. SQL Statement dan Transaction Behavior

Tidak semua statement punya behavior transaction sama di semua database.

Beberapa hal yang perlu diuji per vendor:

- apakah DDL transactional?
- apakah `CREATE INDEX` bisa concurrent/online?
- apakah `ALTER TABLE` auto-commit?
- apakah `TRUNCATE` rollback-able?
- apakah `CREATE DATABASE` bisa dalam transaction?
- apakah maintenance command transactional?
- apakah temporary table scoped per session/transaction?

PostgreSQL dikenal mendukung transactional DDL untuk banyak operasi, tetapi ada pengecualian seperti beberapa command yang tidak boleh berjalan dalam transaction block.

MySQL behavior dipengaruhi storage engine dan jenis statement; banyak DDL menyebabkan implicit commit.

Oracle juga memiliki implicit commit behavior untuk DDL.

Jadi migration strategy harus vendor-aware.

---

## 31. SQL dan Error Handling

SQL statement bisa gagal karena banyak alasan.

### 31.1 Syntax Error

```sql
SELEC * FROM cases;
```

### 31.2 Constraint Violation

Contoh:

```text
duplicate key
foreign key violation
not null violation
check violation
```

### 31.3 Serialization Failure

Terjadi pada isolation tinggi atau concurrency conflict.

Harus diretry dengan benar.

### 31.4 Deadlock

Database membatalkan salah satu transaction.

Aplikasi harus siap retry jika operation idempotent/aman.

### 31.5 Lock Timeout

Statement gagal karena menunggu lock terlalu lama.

### 31.6 Query Timeout

Driver/app membatalkan query karena melewati limit waktu.

### 31.7 Connection Failure

Network/database connection putus.

Ambiguity:

```text
Apakah transaction commit atau rollback?
```

Ini sulit. Desain idempotency dan reconciliation diperlukan.

### 31.8 Permission Denied

Role tidak punya privilege.

### 31.9 Data Type Error

Misalnya string tidak bisa cast ke integer/timestamp.

---

## 32. Affected Rows adalah Signal Penting

Untuk DML, row count adalah bagian dari correctness.

Contoh:

```sql
UPDATE cases
SET status = 'ESCALATED'
WHERE id = :case_id
  AND status = 'UNDER_REVIEW';
```

Affected rows:

```text
1 -> success
0 -> case not found or state changed
>1 -> impossible jika id unique; indicates severe issue
```

Java code harus memperlakukan row count sebagai domain signal.

Contoh:

```java
int updated = jdbcTemplate.update("""
    UPDATE cases
    SET status = ?
    WHERE id = ?
      AND status = ?
""", "ESCALATED", caseId, "UNDER_REVIEW");

if (updated == 0) {
    throw new IllegalStateException("Case is no longer UNDER_REVIEW");
}

if (updated > 1) {
    throw new IllegalStateException("Invariant violation: multiple cases updated");
}
```

ORM sering menyembunyikan affected rows. Untuk state transition penting, explicit SQL bisa lebih aman.

---

## 33. SQL Style: Readability adalah Correctness Tool

SQL yang sulit dibaca sulit direview.

### 33.1 Format Konsisten

Buruk:

```sql
select c.id,c.case_number,a.officer_id from cases c join case_assignments a on a.case_id=c.id where c.status='OPEN' and a.ended_at is null
```

Lebih baik:

```sql
SELECT
    c.id,
    c.case_number,
    a.officer_id
FROM cases c
JOIN case_assignments a
  ON a.case_id = c.id
WHERE c.status = 'OPEN'
  AND a.ended_at IS NULL;
```

---

### 33.2 Alias yang Bermakna

Buruk:

```sql
SELECT *
FROM cases x
JOIN case_assignments y ON y.case_id = x.id;
```

Lebih baik:

```sql
SELECT
    c.id,
    a.officer_id
FROM cases c
JOIN case_assignments a
  ON a.case_id = c.id;
```

Untuk query kompleks, alias bisa lebih deskriptif:

```sql
FROM cases current_case
JOIN case_assignments active_assignment
```

---

### 33.3 Hindari SELECT *

`SELECT *` bermasalah karena:

- mengambil kolom tidak perlu
- coupling ke schema
- hasil berubah saat column ditambah
- network overhead
- index-only scan mungkin gagal
- DTO mapping rapuh
- security risk jika column sensitif ditambah

Gunakan explicit projection:

```sql
SELECT
    id,
    case_number,
    status,
    opened_at
FROM cases;
```

`SELECT *` masih bisa diterima untuk:

- ad-hoc debugging
- migration exploration
- quick psql session
- controlled internal script

Bukan untuk production query path.

---

### 33.4 Nama Constraint Harus Jelas

Buruk:

```sql
CONSTRAINT chk1 CHECK (status IN ('OPEN', 'CLOSED'))
```

Lebih baik:

```sql
CONSTRAINT ck_cases_status_valid
CHECK (status IN ('OPEN', 'CLOSED'))
```

Ketika error muncul:

```text
violates check constraint "ck_cases_status_valid"
```

Developer langsung tahu masalahnya.

---

### 33.5 Nama Index Harus Menggambarkan Tujuan

Contoh:

```sql
CREATE INDEX idx_cases_status_opened_at
ON cases (status, opened_at);
```

Untuk unique:

```sql
CREATE UNIQUE INDEX uq_cases_jurisdiction_case_number
ON cases (jurisdiction_code, case_number);
```

Untuk partial:

```sql
CREATE UNIQUE INDEX uq_case_assignments_one_active_primary_per_case
ON case_assignments (case_id)
WHERE assignment_role = 'PRIMARY'
  AND ended_at IS NULL;
```

Nama yang bagus membantu debugging, monitoring, dan migration review.

---

## 34. Statement Safety Patterns

### 34.1 Safe UPDATE Pattern

```sql
BEGIN;

SELECT id, status
FROM cases
WHERE id = :case_id
FOR UPDATE;

UPDATE cases
SET status = 'ESCALATED'
WHERE id = :case_id
  AND status = 'UNDER_REVIEW';

COMMIT;
```

Gunakan `FOR UPDATE` jika perlu lock eksplisit sebelum melakukan logic kompleks.

Untuk simple transition, conditional update sering cukup:

```sql
UPDATE cases
SET status = 'ESCALATED'
WHERE id = :case_id
  AND status = 'UNDER_REVIEW';
```

Lalu cek affected rows.

---

### 34.2 Safe DELETE Pattern

Sebelum delete:

```sql
SELECT COUNT(*)
FROM case_notes
WHERE created_at < now() - INTERVAL '7 years'
  AND legal_hold = false;
```

Lalu batch delete:

```sql
DELETE FROM case_notes
WHERE id IN (
    SELECT id
    FROM case_notes
    WHERE created_at < now() - INTERVAL '7 years'
      AND legal_hold = false
    ORDER BY created_at
    LIMIT 1000
);
```

Delete besar sebaiknya batch untuk mengurangi:

- lock time
- transaction log growth
- replication lag
- vacuum pressure
- timeout

---

### 34.3 Safe Migration Pattern

Untuk menambah NOT NULL column:

Buruk:

```sql
ALTER TABLE cases
ADD COLUMN priority TEXT NOT NULL DEFAULT 'NORMAL';
```

Pada database/table tertentu, ini bisa mahal.

Lebih aman secara umum:

```sql
ALTER TABLE cases
ADD COLUMN priority TEXT;
```

Backfill batch:

```sql
UPDATE cases
SET priority = 'NORMAL'
WHERE priority IS NULL;
```

Tambahkan constraint setelah valid:

```sql
ALTER TABLE cases
ALTER COLUMN priority SET NOT NULL;
```

Tambahkan check:

```sql
ALTER TABLE cases
ADD CONSTRAINT ck_cases_priority_valid
CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'CRITICAL'));
```

Vendor modern dapat mengoptimasi beberapa operasi, tetapi pattern bertahap tetap aman sebagai baseline.

---

## 35. Mapping SQL Category ke Production Concern

| Category | Statement | Primary Concern | Production Risk |
|---|---|---|---|
| DDL | `CREATE TABLE` | Model/invariant | schema salah, constraint kurang |
| DDL | `ALTER TABLE` | evolution | lock, rewrite, downtime |
| DDL | `CREATE INDEX` | access path | write overhead, build time |
| DML | `INSERT` | new fact | duplicate, invalid FK |
| DML | `UPDATE` | change fact | lost update, mass update |
| DML | `DELETE` | remove fact | data loss, audit breach |
| DQL | `SELECT` | read fact | slow query, wrong grain |
| DCL | `GRANT` | access | overprivileged role |
| DCL | `REVOKE` | access removal | broken app/report |
| TCL | `COMMIT` | finalize | partial external side effects |
| TCL | `ROLLBACK` | undo | sequence/external effects remain |

---

## 36. Mapping SQL Category ke Java Concern

| SQL Concept | Java/Spring Equivalent | Common Bug |
|---|---|---|
| DDL | Flyway/Liquibase | unsafe migration |
| DML | Repository save/update/delete | missing row count check |
| DQL | Repository query | N+1, wrong join grain |
| DCL | DB roles/secrets | app uses admin user |
| TCL | `@Transactional` | boundary not applied |
| Prepared statement | JDBC parameters | SQL injection if string concatenation |
| Constraint violation | `DataIntegrityViolationException` | not mapped to domain error |
| Serialization failure | transient exception | no retry strategy |
| Unique constraint | idempotency/concurrency | duplicate check only in Java |
| Foreign key | referential integrity | orphan row from disabled FK |

---

## 37. Practical Review Checklist: SQL Statement

Saat melihat SQL statement, tanyakan:

```text
[ ] Ini statement kategori apa: DDL, DML, DQL, DCL, TCL?
[ ] Apa domain intent-nya?
[ ] Apakah statement ini read-only atau write?
[ ] Apakah statement ini butuh transaksi eksplisit?
[ ] Apakah statement ini aman dijalankan ulang?
[ ] Apakah statement ini idempotent?
[ ] Apakah statement ini bisa mengunci table/row?
[ ] Apakah statement ini bergantung pada vendor dialect?
[ ] Apakah statement ini punya WHERE yang cukup selektif?
[ ] Apakah affected rows perlu dicek?
[ ] Apakah constraint mendukung asumsi statement?
[ ] Apakah query result grain jelas?
[ ] Apakah permission yang diperlukan minimal?
[ ] Apakah statement ini aman untuk data besar?
[ ] Apakah ada rollback/compensation plan?
```

---

## 38. Practical Review Checklist: Migration SQL

```text
[ ] Apakah migration forward-only?
[ ] Apakah ada DDL yang mengambil lock berat?
[ ] Apakah ada table rewrite?
[ ] Apakah ada backfill besar?
[ ] Apakah backfill dibatch?
[ ] Apakah constraint ditambahkan setelah data valid?
[ ] Apakah index dibuat dengan mode online/concurrent jika tersedia?
[ ] Apakah migration kompatibel dengan aplikasi versi lama dan baru?
[ ] Apakah ada expand-and-contract plan?
[ ] Apakah rollback realistis atau perlu fix-forward?
[ ] Apakah ada data validation query?
[ ] Apakah ada monitoring selama rollout?
[ ] Apakah migration diuji pada volume realistis?
```

---

## 39. Practical Review Checklist: Java Integration

```text
[ ] Apakah SQL memakai prepared statement?
[ ] Apakah transaction boundary eksplisit?
[ ] Apakah autocommit behavior dipahami?
[ ] Apakah affected row count dicek untuk update/delete penting?
[ ] Apakah exception constraint dimap ke domain error?
[ ] Apakah retry hanya dilakukan untuk error yang aman diretry?
[ ] Apakah connection pool timeout selaras dengan query timeout?
[ ] Apakah query mengambil kolom secukupnya?
[ ] Apakah repository method menyembunyikan query mahal?
[ ] Apakah ORM-generated SQL diperiksa?
[ ] Apakah migration berjalan sebelum kode yang bergantung padanya?
```

---

## 40. Mini Case Study: Case Escalation

### 40.1 Requirement

> Case dengan status `UNDER_REVIEW` bisa dieskalasi menjadi `ESCALATED`. Setiap eskalasi harus menghasilkan audit transition. Operasi harus atomic.

### 40.2 Naive Java + SQL

```sql
UPDATE cases
SET status = 'ESCALATED'
WHERE id = :case_id;
```

Lalu:

```sql
INSERT INTO case_status_transitions (
    id,
    case_id,
    from_status,
    to_status
)
VALUES (
    gen_random_uuid(),
    :case_id,
    'UNDER_REVIEW',
    'ESCALATED'
);
```

Masalah:

- update bisa mengubah case yang bukan `UNDER_REVIEW`
- insert audit bisa gagal setelah update commit jika autocommit
- tidak ada guard concurrency
- tidak cek affected rows
- from_status mungkin salah
- transition tidak atomic

---

### 40.3 Better Transactional Pattern

```sql
BEGIN;

UPDATE cases
SET status = 'ESCALATED'
WHERE id = :case_id
  AND status = 'UNDER_REVIEW';

-- application checks affected rows = 1

INSERT INTO case_status_transitions (
    id,
    case_id,
    from_status,
    to_status,
    transitioned_at,
    transitioned_by,
    reason
)
VALUES (
    gen_random_uuid(),
    :case_id,
    'UNDER_REVIEW',
    'ESCALATED',
    now(),
    :user_id,
    :reason
);

COMMIT;
```

Masih perlu memastikan insert hanya dilakukan jika update sukses.

---

### 40.4 Even Better PostgreSQL-Style CTE

```sql
WITH updated_case AS (
    UPDATE cases
    SET status = 'ESCALATED'
    WHERE id = :case_id
      AND status = 'UNDER_REVIEW'
    RETURNING id
)
INSERT INTO case_status_transitions (
    id,
    case_id,
    from_status,
    to_status,
    transitioned_at,
    transitioned_by,
    reason
)
SELECT
    gen_random_uuid(),
    id,
    'UNDER_REVIEW',
    'ESCALATED',
    now(),
    :user_id,
    :reason
FROM updated_case;
```

Kemudian aplikasi cek jumlah inserted transition.

Jika 0:

```text
case not found or not in UNDER_REVIEW
```

Kelebihan:

- update dan insert terhubung secara atomic dalam satu statement
- insert tidak terjadi jika update gagal
- cocok untuk command transition sederhana

Tetap jalankan dalam transaction jika ada statement lain.

---

## 41. Mini Case Study: Read-Only Reporting User

### 41.1 Requirement

> Reporting tool boleh membaca summary case, tapi tidak boleh membaca sensitive notes atau mengubah data.

### 41.2 Schema/View

```sql
CREATE SCHEMA reporting;

CREATE VIEW reporting.case_summary AS
SELECT
    c.id,
    c.case_number,
    c.status,
    c.opened_at,
    c.closed_at
FROM regulatory.cases c;
```

### 41.3 Privilege

```sql
GRANT USAGE ON SCHEMA reporting TO reporting_readonly;
GRANT SELECT ON reporting.case_summary TO reporting_readonly;
```

Jangan grant:

```sql
GRANT SELECT ON regulatory.case_notes TO reporting_readonly;
```

Jangan gunakan app superuser credential untuk BI/reporting.

---

## 42. Mini Case Study: Idempotent Import

### 42.1 Requirement

> Import case dari external system dapat diretry tanpa membuat duplicate.

### 42.2 Design

```sql
CREATE TABLE cases (
    id UUID PRIMARY KEY,
    case_number TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL
);

CREATE TABLE case_external_refs (
    source_system TEXT NOT NULL,
    source_case_id TEXT NOT NULL,
    case_id UUID NOT NULL REFERENCES cases(id),

    PRIMARY KEY (source_system, source_case_id)
);
```

### 42.3 Import Flow

1. Insert case.
2. Insert external reference.
3. Jika external reference sudah ada, jangan duplicate.

PostgreSQL-style:

```sql
INSERT INTO case_external_refs (
    source_system,
    source_case_id,
    case_id
)
VALUES (
    :source_system,
    :source_case_id,
    :case_id
)
ON CONFLICT (source_system, source_case_id)
DO NOTHING;
```

Better flow may first check existing external ref to return existing internal case.

Idempotency harus berbasis unique constraint, bukan hanya Java memory.

---

## 43. Learning Path Setelah Part Ini

Setelah memahami kategori SQL, urutan pembelajaran berikutnya menjadi lebih jelas.

- Part 003 akan membahas data type, `NULL`, dan three-valued logic.
- Part 004 akan membahas `SELECT` dasar.
- Part 005 akan membahas filtering dan sargability.
- Part 006 akan membahas join.
- Part 011 akan kembali ke DML secara lebih dalam.
- Part 019–020 akan masuk ke TCL, isolation, locking, dan MVCC.
- Part 024 akan kembali ke DCL/security.
- Part 027 akan membahas DDL migration secara production-grade.

Jadi part ini adalah peta bahasa. Part berikutnya akan memperdalam komponen paling rawan bug semantik: type dan `NULL`.

---

## 44. Ringkasan Bagian Ini

Hal penting dari part 002:

1. SQL bukan hanya `SELECT`.
2. DDL mendefinisikan struktur dan invariant.
3. DML mengubah fakta dan harus dipikirkan bersama transaksi, constraint, lock, dan idempotency.
4. DQL membaca fakta tetapi tetap bisa mahal dan berisiko.
5. DCL mengatur privilege dan blast radius.
6. TCL mengatur atomicity dan consistency boundary.
7. Java abstraction seperti repository dan `@Transactional` tetap bermuara ke SQL behavior.
8. DDL di production adalah operational event, bukan sekadar script.
9. Affected rows dari DML adalah signal correctness.
10. Vendor dialect penting dan tidak boleh diabaikan.
11. Portability bagus, tetapi fitur vendor-specific kadang diperlukan untuk correctness.
12. SQL style membantu review dan mencegah bug.
13. Migration aman membutuhkan expand-and-contract, batching, validasi, dan observability.
14. Database role sebaiknya least privilege.
15. Transaction boundary harus eksplisit untuk operasi multi-statement.

Kalimat inti:

> SQL statement bukan hanya instruksi ke database; ia adalah perubahan atau pertanyaan terhadap model kebenaran sistem, dengan konsekuensi terhadap correctness, concurrency, security, performance, dan operability.

---

## 45. Referensi

1. ISO — `ISO/IEC 9075-1:2023`, Database languages SQL — Part 1: Framework.  
   https://www.iso.org/standard/76583.html

2. PostgreSQL Documentation — SQL Commands.  
   https://www.postgresql.org/docs/current/sql-commands.html

3. PostgreSQL Documentation — Data Definition.  
   https://www.postgresql.org/docs/current/ddl.html

4. PostgreSQL Documentation — Data Manipulation.  
   https://www.postgresql.org/docs/current/dml.html

5. PostgreSQL Documentation — Transaction Isolation.  
   https://www.postgresql.org/docs/current/transaction-iso.html

6. PostgreSQL Documentation — Privileges.  
   https://www.postgresql.org/docs/current/ddl-priv.html

7. MySQL 8.4 Reference Manual — SQL Statements.  
   https://dev.mysql.com/doc/refman/8.4/en/sql-statements.html

8. Oracle Database SQL Language Reference.  
   https://docs.oracle.com/en/database/oracle/oracle-database/23/sqlrf/

9. Microsoft SQL Server Documentation — Transact-SQL Reference.  
   https://learn.microsoft.com/en-us/sql/t-sql/language-reference

10. Spring Framework Documentation — Transaction Management.  
    https://docs.spring.io/spring-framework/reference/data-access/transaction.html

---

## 46. Status Seri

Seri belum selesai.

Bagian selesai:

- `learn-sql-mastery-for-java-engineers-part-000.md`
- `learn-sql-mastery-for-java-engineers-part-001.md`
- `learn-sql-mastery-for-java-engineers-part-002.md`

Bagian berikutnya:

- `learn-sql-mastery-for-java-engineers-part-003.md` — Data Types, NULL, Three-Valued Logic, and Semantic Correctness
