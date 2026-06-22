# Part 22 — Vendor-Specific Migration Engineering

**Series:** `learn-java-database-migrations-seedings-flyway-liquibase`  
**File:** `22-vendor-specific-migration-engineering.md`  
**Target:** Java 8–25 software engineer yang ingin memahami database migration secara production-grade, bukan hanya menjalankan script Flyway/Liquibase.  

---

## 0. Posisi Materi Ini Dalam Seri

Pada part sebelumnya kita sudah membahas:

- taxonomy perubahan database,
- invariant dan failure model,
- database versioning,
- Flyway mental model sampai operational recovery,
- Liquibase mental model sampai rollback engineering,
- seeding,
- backfill,
- expand/contract,
- locking, transaction, dan online DDL.

Bagian ini masuk ke layer yang lebih realistis: **setiap database engine punya perilaku berbeda**. Tool seperti Flyway dan Liquibase bisa membantu ordering, checksum, history, lock, execution, dan governance. Tetapi tool tersebut tidak menghapus fakta bahwa:

> SQL migration tetap dieksekusi oleh database engine tertentu, dengan aturan lock, transaction, type system, index, constraint, identifier, optimizer, storage, dan DDL semantics milik engine tersebut.

Artinya, top engineer tidak hanya bertanya:

> “Apakah migration ini valid di Flyway/Liquibase?”

Tetapi juga:

> “Apa perilaku migration ini di PostgreSQL/Oracle/MySQL/SQL Server saat dijalankan di database besar, dengan traffic aktif, index existing, constraint existing, transaksi panjang, replication, dan deployment pipeline?”

---

## 1. Core Mental Model: Migration Tool Is Control Plane, Database Engine Is Execution Plane

Flyway dan Liquibase adalah **control plane**:

- menentukan urutan migration,
- menyimpan history,
- menghitung checksum,
- melakukan validate,
- memberi precondition/callback,
- mengintegrasikan migration dengan build/deploy pipeline.

Database engine adalah **execution plane**:

- menentukan apakah DDL transactional,
- menentukan jenis lock yang diambil,
- menentukan apakah index bisa dibuat online/concurrent,
- menentukan apakah constraint bisa divalidasi tanpa blocking,
- menentukan cara object name disimpan,
- menentukan tipe data dan precision,
- menentukan bagaimana sequence/identity bekerja,
- menentukan apakah statement tertentu auto-commit,
- menentukan bagaimana error membuat transaksi rollback.

Kesalahan umum engineer biasa adalah menganggap migration sukses karena:

```text
flyway migrate -> success
```

atau:

```text
liquibase update -> success
```

Padahal success tersebut hanya berarti tool selesai menjalankan statement terhadap database pada kondisi tertentu. Itu belum menjawab:

- apakah statement aman untuk volume production,
- apakah lock duration acceptable,
- apakah migration compatible dengan old app,
- apakah migration bisa diulang dengan aman,
- apakah migration valid di semua DBMS target,
- apakah test database merepresentasikan production engine,
- apakah index/constraint yang dibuat benar-benar usable oleh query,
- apakah rollback/roll-forward bisa dilakukan.

---

## 2. Vendor-Specific Thinking: Tiga Level Abstraksi

Saat mendesain migration, pikirkan dalam tiga level.

### Level 1 — Tool-Level Portability

Contoh:

```text
Flyway versioned migration
Liquibase changelog
Spring Boot migration auto-run
Maven plugin
Gradle plugin
```

Di level ini, kita bicara tentang mekanisme migration.

### Level 2 — SQL-Level Portability

Contoh:

```sql
CREATE TABLE users (...)
ALTER TABLE users ADD COLUMN email VARCHAR(255)
CREATE INDEX idx_users_email ON users(email)
```

Beberapa SQL terlihat portable, tetapi detailnya bisa berbeda.

### Level 3 — Engine-Level Semantics

Contoh pertanyaan:

- Apakah `ALTER TABLE ADD COLUMN` rewrite table?
- Apakah `CREATE INDEX` blocking writes?
- Apakah `CREATE INDEX CONCURRENTLY` boleh dalam transaction?
- Apakah `VARCHAR(255)` berarti byte atau character?
- Apakah `TIMESTAMP` menyimpan timezone?
- Apakah identifier case-sensitive?
- Apakah DDL auto-commit?
- Apakah constraint bisa dibuat `NOT VALID` lalu divalidasi belakangan?
- Apakah `NULL` di unique constraint diperlakukan sama?
- Apakah empty string sama dengan `NULL`?

Level 3 inilah yang membedakan engineer production-grade dari engineer yang hanya tahu template.

---

## 3. Database Portability: Myth vs Reality

Portability sering dimaknai terlalu sederhana.

### 3.1 Portability Yang Realistis

Portability realistis berarti:

- migration punya struktur yang sama,
- naming convention konsisten,
- history management konsisten,
- pipeline konsisten,
- test strategy konsisten,
- abstraction layer cukup membantu,
- tetapi SQL bisa vendor-specific bila dibutuhkan.

### 3.2 Portability Yang Berbahaya

Portability berbahaya berarti memaksa semua database memakai subset SQL paling rendah sehingga:

- tidak memakai online index feature,
- tidak memakai constraint validation strategy,
- tidak memakai proper JSON type,
- tidak memakai native sequence/identity dengan benar,
- tidak memakai lock timeout yang sesuai,
- tidak memakai engine-specific performance feature.

Hasilnya terlihat portable, tetapi kurang aman dan kurang efisien di production.

> Prinsip praktis: **portable where it is safe, vendor-specific where correctness or operability requires it.**

---

## 4. Vendor Matrix: Ringkasan Area Yang Berbeda

| Area | PostgreSQL | Oracle | MySQL/MariaDB | SQL Server |
|---|---|---|---|---|
| Transactional DDL | Banyak DDL transactional, tetapi tidak semua operation bisa di transaction block | Banyak DDL implicit commit | Banyak DDL implicit commit; online DDL tergantung engine/version | Banyak DDL transactional dalam kondisi tertentu, tetapi lock/metadata behavior penting |
| Online index | `CREATE INDEX CONCURRENTLY` | Online index operations tersedia di edisi/fitur tertentu | Online DDL tergantung InnoDB, algorithm, lock mode | Online index tersedia tergantung edition/feature |
| Boolean | Native `boolean` | Tidak selalu native boolean table column di versi lama; sering `NUMBER(1)`/`CHAR(1)` | `BOOLEAN` alias ke `TINYINT(1)` | `BIT` |
| Auto number | `SERIAL`, `BIGSERIAL`, `IDENTITY`, sequence | Sequence, identity di versi modern | `AUTO_INCREMENT` | `IDENTITY`, sequence |
| Timestamp timezone | `timestamp` vs `timestamptz` | `TIMESTAMP`, `TIMESTAMP WITH TIME ZONE`, `LOCAL TIME ZONE` | `TIMESTAMP`/`DATETIME` semantics berbeda | `datetime`, `datetime2`, `datetimeoffset` |
| JSON | `json`, `jsonb` | JSON support via type/features tergantung versi | `JSON` type di MySQL, MariaDB berbeda | JSON functions over text-like storage |
| Large object | `text`, `bytea`, large object API | `CLOB`, `BLOB` | `TEXT`, `BLOB` variants | `varchar(max)`, `nvarchar(max)`, `varbinary(max)` |
| Identifier case | Lowercase folding for unquoted | Uppercase folding for unquoted | Depends on OS/settings/table name behavior | Usually case-insensitive depending collation |
| Empty string | Empty string is empty string | Empty string often treated as `NULL` | Empty string distinct from `NULL` | Empty string distinct from `NULL` |

Tabel ini bukan untuk dihafal sebagai trivia. Gunanya adalah membangun reflex:

> Setiap kali menulis migration yang tampak sederhana, tanyakan: “Bagian mana yang engine-specific?”

---

## 5. PostgreSQL Migration Concerns

PostgreSQL sering dianggap developer-friendly karena DDL relatif nyaman, type system kuat, dan transactional behavior bagus. Tetapi migration production PostgreSQL punya jebakan sendiri.

### 5.1 Transactional DDL: Kuat, Tapi Bukan Alasan Untuk Ceroboh

Banyak DDL di PostgreSQL bisa berjalan dalam transaction. Ini sangat membantu karena migration failure bisa rollback.

Contoh:

```sql
BEGIN;
ALTER TABLE account ADD COLUMN external_ref text;
CREATE TABLE audit_event (...);
COMMIT;
```

Tetapi ada operation penting yang tidak boleh dijalankan dalam transaction block, misalnya:

```sql
CREATE INDEX CONCURRENTLY idx_account_external_ref
ON account(external_ref);
```

`CREATE INDEX CONCURRENTLY` tidak boleh berada di dalam transaction block.

Implikasi untuk Flyway:

```sql
-- V20260101_1200__create_index_concurrently.sql
-- flyway:executeInTransaction=false

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_account_external_ref
ON account(external_ref);
```

Pada Flyway, migration tertentu bisa diset non-transactional. Pada Liquibase, gunakan konfigurasi/changeset yang sesuai untuk menghindari transaction wrapper pada statement tertentu.

Mental model:

- Transactional DDL bagus untuk atomicity.
- Online/concurrent operation kadang butuh keluar dari transaction.
- Jangan menyamaratakan semua migration PostgreSQL sebagai transactional.

### 5.2 `CREATE INDEX CONCURRENTLY`: Online Bukan Berarti Gratis

`CREATE INDEX CONCURRENTLY` mengurangi blocking write, tetapi:

- lebih lambat daripada normal create index,
- bisa gagal bila ada transaksi panjang,
- tidak bisa dijalankan dalam transaction block,
- bila gagal bisa meninggalkan invalid index,
- tetap butuh resource CPU/IO besar,
- perlu monitoring.

Pattern yang lebih aman:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_order_created_at_status
ON orders(created_at, status);
```

Lalu verifikasi:

```sql
SELECT indexrelid::regclass AS index_name,
       indisvalid,
       indisready
FROM pg_index
WHERE indexrelid = 'idx_order_created_at_status'::regclass;
```

Jika invalid index tersisa, perlu runbook:

```sql
DROP INDEX CONCURRENTLY IF EXISTS idx_order_created_at_status;
```

Lalu retry.

### 5.3 Adding Column With Default

Di PostgreSQL versi modern, `ADD COLUMN ... DEFAULT constant` sudah lebih optimal dibanding versi lama. Tetapi tetap perlu hati-hati untuk database besar dan version-specific behavior.

Risky pattern:

```sql
ALTER TABLE customer
ADD COLUMN active boolean NOT NULL DEFAULT true;
```

Lebih konservatif untuk cross-version/large table:

```sql
ALTER TABLE customer
ADD COLUMN active boolean;
```

Backfill bertahap:

```sql
UPDATE customer
SET active = true
WHERE active IS NULL
  AND id BETWEEN ? AND ?;
```

Lalu enforce:

```sql
ALTER TABLE customer
ALTER COLUMN active SET DEFAULT true;

ALTER TABLE customer
ALTER COLUMN active SET NOT NULL;
```

Untuk table kecil, satu statement mungkin acceptable. Untuk table besar, gunakan expand/backfill/contract.

### 5.4 Constraint `NOT VALID`

PostgreSQL punya fitur yang sangat berguna untuk zero-downtime constraint introduction.

Contoh:

```sql
ALTER TABLE order_item
ADD CONSTRAINT fk_order_item_order
FOREIGN KEY (order_id)
REFERENCES orders(id)
NOT VALID;
```

Kemudian validasi terpisah:

```sql
ALTER TABLE order_item
VALIDATE CONSTRAINT fk_order_item_order;
```

Keuntungan:

- constraint berlaku untuk data baru,
- validasi existing data bisa dilakukan belakangan,
- mengurangi blocking dibanding langsung enforce penuh.

Ini contoh jelas mengapa abstraction terlalu umum bisa merugikan. Jika tool abstraction tidak memodelkan `NOT VALID` dengan enak, gunakan SQL native.

### 5.5 Enum Type Migration

PostgreSQL punya native enum:

```sql
CREATE TYPE case_status AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED');
```

Menambah value:

```sql
ALTER TYPE case_status ADD VALUE 'REJECTED';
```

Tetapi enum bisa menyulitkan:

- rename/remove value lebih sulit,
- rollback tidak trivial,
- deployment compatibility harus dijaga,
- old app mungkin tidak mengenal enum baru.

Untuk domain yang sering berubah, lookup table sering lebih fleksibel.

### 5.6 `json` vs `jsonb`

PostgreSQL punya `json` dan `jsonb`.

- `json` menyimpan input text lebih dekat ke original.
- `jsonb` binary representation, biasanya lebih cocok untuk indexing/querying.

Migration concern:

```sql
ALTER TABLE event_log
ADD COLUMN metadata jsonb;
```

Index:

```sql
CREATE INDEX CONCURRENTLY idx_event_log_metadata_gin
ON event_log USING gin (metadata);
```

Pertanyaan engineering:

- Apakah data JSON hanya disimpan atau diquery?
- Apakah perlu GIN index?
- Apakah index terlalu besar?
- Apakah schema JSON divalidasi di app atau database?
- Apakah migration perlu backfill dari text column lama?

### 5.7 Case Sensitivity and Quoted Identifier

PostgreSQL melipat unquoted identifier ke lowercase.

```sql
CREATE TABLE UserAccount (...); -- menjadi useraccount jika unquoted
CREATE TABLE "UserAccount" (...); -- case-sensitive
```

Anti-pattern:

```sql
CREATE TABLE "Order" (...);
```

Ini membuat query harus selalu quoted:

```sql
SELECT * FROM "Order";
```

Recommendation:

- gunakan lowercase snake_case,
- hindari quoted identifiers,
- hindari reserved words.

---

## 6. Oracle Migration Concerns

Oracle umum di enterprise/government/financial system. Banyak sistem Java besar memakai Oracle karena fitur, maturity, dan operational governance. Tetapi Oracle punya semantics yang sangat berbeda dari PostgreSQL.

### 6.1 DDL Implicit Commit

Di Oracle, DDL umumnya melakukan implicit commit sebelum dan sesudah statement.

Artinya migration seperti ini tidak atomic seperti yang mungkin diasumsikan:

```sql
ALTER TABLE CUSTOMER ADD (EXTERNAL_REF VARCHAR2(100));
CREATE INDEX IDX_CUSTOMER_EXTERNAL_REF ON CUSTOMER(EXTERNAL_REF);
ALTER TABLE CUSTOMER ADD CONSTRAINT UK_CUSTOMER_EXTERNAL_REF UNIQUE(EXTERNAL_REF);
```

Jika statement kedua gagal, statement pertama tidak otomatis rollback.

Implikasi:

- jangan mengandalkan transaction wrapper untuk atomic DDL,
- pecah migration berdasarkan recoverability,
- punya runbook manual recovery,
- gunakan validation query sebelum dan sesudah,
- pastikan migration idempotency/retry strategy jelas.

### 6.2 Empty String Is Treated As NULL

Oracle sering memperlakukan empty string sebagai `NULL`.

Contoh:

```sql
INSERT INTO customer(name) VALUES ('');
```

Secara behavior bisa menjadi `NULL`.

Implikasi migration:

- jangan membuat assumption empty string distinct dari null,
- seed data dengan empty string bisa berubah makna,
- unique constraint dan validation bisa berbeda,
- aplikasi Java yang membedakan `""` dan `null` bisa tidak selaras dengan database.

### 6.3 Identifier Length and Naming

Oracle lama punya batas identifier 30 bytes. Oracle versi modern memperluas batas, tetapi banyak organisasi masih mempertahankan convention 30 karakter demi compatibility/tooling.

Bad migration naming:

```sql
ALTER TABLE APPLICATION_REVIEW_WORKFLOW_STATE_TRANSITION
ADD CONSTRAINT FK_APPLICATION_REVIEW_WORKFLOW_STATE_TRANSITION_TO_APPLICATION_REVIEW_WORKFLOW_STATE_FROM
FOREIGN KEY (...);
```

Lebih realistis:

```sql
ALTER TABLE APP_WF_TRANSITION
ADD CONSTRAINT FK_APP_WF_TR_FROM_STATE
FOREIGN KEY (FROM_STATE_ID)
REFERENCES APP_WF_STATE(ID);
```

Prinsip:

- constraint name harus eksplisit tapi pendek,
- index name harus mudah ditelusuri,
- hindari generated name dari tool,
- buat naming standard organisasi.

### 6.4 VARCHAR2 Byte vs Char Semantics

Oracle `VARCHAR2(100)` bisa berarti byte atau char tergantung semantics/session/config.

Lebih eksplisit:

```sql
VARCHAR2(100 CHAR)
```

atau:

```sql
VARCHAR2(100 BYTE)
```

Untuk aplikasi multilingual, gunakan `CHAR` semantics bila requirement adalah jumlah karakter, bukan byte.

Migration concern:

- nama orang,
- alamat,
- deskripsi,
- input multilingual,
- emoji/surrogate pair,
- NLS setting.

### 6.5 CLOB/BLOB and LOB Segment Reality

Oracle LOB bukan sekadar “large text column”. CLOB/BLOB bisa punya segment storage sendiri, retention, compression, deduplication, dan behavior reclaim space yang berbeda.

Contoh table:

```sql
CREATE TABLE audit_trail (
  id NUMBER PRIMARY KEY,
  created_at TIMESTAMP NOT NULL,
  module_code VARCHAR2(50 CHAR),
  metadata CLOB,
  serialized_changes CLOB
);
```

Migration concern:

- menambah CLOB column biasanya tidak sama risikonya dengan VARCHAR kecil,
- update CLOB massal bisa menghasilkan banyak undo/redo,
- delete row tidak otomatis mengembalikan storage ke filesystem,
- shrink/move LOB perlu operasi khusus,
- index atas expression dari CLOB perlu hati-hati,
- audit table CLOB-heavy perlu archival strategy.

Contoh backfill yang berisiko:

```sql
UPDATE audit_trail
SET metadata = transform_metadata(metadata)
WHERE created_at < DATE '2025-01-01';
```

Pertanyaan yang harus ditanyakan:

- Berapa ukuran total LOB?
- Berapa undo/redo yang akan dihasilkan?
- Apakah ada replication/Data Guard impact?
- Apakah perlu chunking?
- Apakah perlu offline window?
- Apakah function deterministic dan performant?
- Apakah storage akan membengkak sementara?

### 6.6 Sequences vs Identity

Oracle tradisional memakai sequence:

```sql
CREATE SEQUENCE customer_seq START WITH 1 INCREMENT BY 1 NOCACHE;
```

Insert:

```sql
INSERT INTO customer(id, name)
VALUES (customer_seq.NEXTVAL, 'Alice');
```

Oracle modern punya identity column:

```sql
CREATE TABLE customer (
  id NUMBER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  name VARCHAR2(100 CHAR)
);
```

Migration concern:

- Hibernate/JPA generation strategy,
- sequence cache size,
- gap expectation,
- migration dari trigger+sequence ke identity,
- data import yang membawa ID explicit,
- seed data deterministic.

### 6.7 Online Operations and Enterprise Features

Oracle punya banyak fitur online DDL, tetapi availability bisa tergantung versi/edition/licensing/configuration.

Contoh:

```sql
CREATE INDEX IDX_CUSTOMER_EMAIL ON CUSTOMER(EMAIL) ONLINE;
```

Tetapi jangan asumsikan semua environment mendukung.

Checklist:

- Apakah DEV/UAT/PROD sama edition?
- Apakah syntax didukung versi target?
- Apakah online operation tetap mengambil lock singkat?
- Apakah ada long-running query yang menghambat?
- Apakah index build menghasilkan temporary segment besar?

### 6.8 Oracle Date/Time Trap

Oracle `DATE` menyimpan date dan time sampai detik, bukan hanya tanggal.

```sql
CREATED_DATE DATE
```

bisa menyimpan `2026-06-17 14:30:00`.

Untuk precision lebih tinggi:

```sql
CREATED_AT TIMESTAMP(6)
```

Untuk timezone:

```sql
CREATED_AT TIMESTAMP WITH TIME ZONE
```

Migration concern:

- audit timestamp,
- timezone conversion,
- app server timezone,
- database session timezone,
- Java `LocalDateTime` vs `OffsetDateTime` vs `Instant`,
- old data normalization.

---

## 7. MySQL and MariaDB Migration Concerns

MySQL/MariaDB populer untuk web system, tetapi migration behavior sangat bergantung pada storage engine, version, DDL algorithm, lock mode, replication mode, dan SQL mode.

### 7.1 DDL Often Implicit Commit

Seperti Oracle, banyak DDL MySQL menyebabkan implicit commit.

Implikasi:

- migration multi-statement bisa partially applied,
- rollback tool-level tidak selalu cukup,
- perlu split migration yang recoverable,
- perlu preflight check dan postflight verification.

### 7.2 Online DDL Is Not One Thing

MySQL InnoDB punya konsep:

```sql
ALTER TABLE customer
ADD COLUMN external_ref varchar(100),
ALGORITHM=INPLACE,
LOCK=NONE;
```

atau pada versi tertentu:

```sql
ALTER TABLE customer
ADD COLUMN created_by varchar(100),
ALGORITHM=INSTANT;
```

Tetapi support tergantung:

- MySQL version,
- MariaDB version,
- operation type,
- column position,
- index type,
- foreign key,
- table format,
- generated column,
- fulltext/spatial index,
- replication topology.

Jangan percaya label “online DDL” tanpa membaca actual behavior.

### 7.3 Metadata Lock

MySQL punya metadata lock yang bisa menyebabkan deployment freeze.

Skenario umum:

1. Ada transaksi lama membaca table `orders`.
2. Migration menjalankan `ALTER TABLE orders ...`.
3. ALTER menunggu metadata lock.
4. Query baru ke `orders` ikut antre di belakang ALTER.
5. Aplikasi terlihat down karena request menumpuk.

Mitigasi:

- set lock wait timeout,
- preflight long transaction check,
- run migration saat low traffic,
- gunakan online schema change tool untuk operasi besar,
- jangan jalankan ALTER besar via app startup.

### 7.4 `BOOLEAN` Is `TINYINT(1)`

MySQL `BOOLEAN` biasanya alias `TINYINT(1)`.

```sql
active BOOLEAN NOT NULL DEFAULT TRUE
```

Secara storage bisa menjadi:

```sql
active tinyint(1) NOT NULL DEFAULT 1
```

Implikasi:

- aplikasi bisa memasukkan nilai selain 0/1 kecuali constraint enforced,
- check constraint support tergantung version,
- ORM mapping harus jelas,
- data cleanup mungkin diperlukan.

### 7.5 Timestamp and Datetime Semantics

MySQL `TIMESTAMP` dan `DATETIME` punya behavior berbeda.

- `TIMESTAMP` historically terkait timezone conversion/session timezone.
- `DATETIME` menyimpan date-time literal tanpa timezone conversion.
- precision fractional seconds perlu dideklarasikan: `DATETIME(6)`, `TIMESTAMP(6)`.

Migration concern:

```sql
created_at timestamp not null default current_timestamp
```

vs

```sql
created_at datetime(6) not null
```

Pertanyaan:

- Apakah aplikasi menyimpan UTC?
- Apakah database session timezone konsisten?
- Apakah precision microsecond diperlukan?
- Apakah existing data perlu normalisasi?

### 7.6 Charset and Collation

MySQL migration sangat sensitif terhadap charset/collation.

Contoh:

```sql
CREATE TABLE customer (
  id bigint primary key auto_increment,
  name varchar(255) not null
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

Pitfall:

- `utf8` lama bukan full UTF-8, sering hanya 3-byte,
- emoji butuh `utf8mb4`,
- collation menentukan case/accent sensitivity,
- unique index behavior dipengaruhi collation,
- index length limit bisa terdampak charset.

Contoh uniqueness trap:

```text
email = 'User@example.com'
email = 'user@example.com'
```

Apakah sama? Tergantung collation.

### 7.7 Zero Date and SQL Mode

Legacy MySQL sering punya data seperti:

```text
0000-00-00
```

Migration ke SQL mode ketat bisa gagal.

Sebelum menambahkan constraint atau mengubah mode, audit data:

```sql
SELECT COUNT(*)
FROM customer
WHERE birth_date = '0000-00-00';
```

Strategy:

- identify invalid rows,
- map to NULL atau corrected date,
- backfill/correct,
- baru enforce strictness.

### 7.8 Auto Increment Caveats

MySQL `AUTO_INCREMENT` sederhana, tetapi migration concern:

- import seed dengan explicit ID,
- reset auto increment,
- replication conflict,
- multi-master setup,
- id gap,
- table copy operation,
- changing PK from int to bigint.

Mengubah PK int ke bigint di table besar bukan simple alter. Butuh expand/contract atau online schema change.

---

## 8. SQL Server Migration Concerns

SQL Server punya ecosystem enterprise kuat, tetapi banyak behavior yang harus dipahami agar migration aman.

### 8.1 `datetime` vs `datetime2` vs `datetimeoffset`

SQL Server legacy sering memakai:

```sql
created_at datetime
```

Lebih modern dan precise:

```sql
created_at datetime2(7)
```

Untuk timezone-aware value:

```sql
created_at datetimeoffset(7)
```

Migration concern:

- precision berubah,
- rounding behavior `datetime`,
- Java type mapping,
- audit timestamp,
- UTC convention.

### 8.2 `BIT` Boolean

Boolean biasanya dimodelkan sebagai:

```sql
is_active bit not null default 1
```

Butuh constraint/semantics di aplikasi karena `bit` memiliki behavior conversion tertentu.

### 8.3 Schema Namespace

SQL Server memakai schema seperti `dbo`, `app`, `audit`.

```sql
CREATE TABLE app.customer (...);
```

Migration harus eksplisit schema:

```sql
CREATE TABLE customer (...); -- bisa masuk default schema user, bukan yang diinginkan
```

Rekomendasi:

- selalu schema-qualified untuk object production,
- jangan bergantung default schema,
- migration user harus punya default schema jelas,
- Flyway/Liquibase schema config harus konsisten.

### 8.4 Online Index Operations

SQL Server punya online index operations, tetapi support bisa tergantung edition/version/type.

Contoh:

```sql
CREATE INDEX IX_Order_CreatedAt
ON app.[Order](CreatedAt)
WITH (ONLINE = ON);
```

Concern:

- edition support,
- LOB column limitation,
- lock tetap bisa terjadi di awal/akhir,
- tempdb usage,
- transaction log growth,
- blocking session.

### 8.5 Lock Escalation

SQL Server bisa melakukan lock escalation dari row/page lock ke table lock.

Backfill besar:

```sql
UPDATE app.Customer
SET NormalizedEmail = LOWER(Email)
WHERE NormalizedEmail IS NULL;
```

Bisa menyebabkan blocking besar.

Safer chunking:

```sql
UPDATE TOP (1000) app.Customer
SET NormalizedEmail = LOWER(Email)
WHERE NormalizedEmail IS NULL;
```

Loop dilakukan oleh job/batch dengan delay, bukan satu transaksi besar.

### 8.6 Identifier Quoting

SQL Server sering memakai bracket:

```sql
SELECT * FROM [Order];
```

Tetapi sebaiknya hindari reserved words sebagai object names.

Gunakan:

```sql
app_order
```

atau:

```sql
sales_order
```

bukan:

```sql
Order
User
Transaction
```

---

## 9. H2/HSQLDB/Test Database Trap

Banyak proyek Java memakai H2/HSQLDB untuk test karena cepat dan in-memory. Ini berguna untuk sebagian test, tetapi berbahaya bila dijadikan bukti migration production aman.

### 9.1 H2 Bukan PostgreSQL/Oracle/MySQL/SQL Server

Walaupun H2 punya compatibility mode:

```text
MODE=PostgreSQL
MODE=Oracle
MODE=MySQL
MODE=MSSQLServer
```

itu bukan emulator sempurna.

Yang sering berbeda:

- DDL lock behavior,
- transactional DDL,
- index behavior,
- optimizer,
- type semantics,
- timestamp/timezone,
- identifier folding,
- constraint validation,
- sequence/identity,
- JSON support,
- CLOB/BLOB behavior,
- SQL function availability,
- concurrency behavior.

### 9.2 Test Yang Boleh Pakai H2

H2 masih boleh untuk:

- fast unit/integration smoke test,
- repository logic sederhana,
- migration syntax smoke test terbatas,
- developer feedback awal.

### 9.3 Test Yang Tidak Boleh Hanya Pakai H2

Jangan hanya pakai H2 untuk:

- production migration validation,
- vendor-specific SQL,
- online DDL test,
- lock behavior,
- performance migration,
- large backfill,
- timezone-sensitive data,
- JSON query/index,
- CLOB/BLOB-heavy table,
- constraint validation strategy,
- generated column/index behavior.

### 9.4 Better Pattern: Testcontainers

Untuk Java modern, gunakan real engine via Testcontainers.

Contoh mental workflow:

```text
unit tests                  -> boleh mock/H2
repository integration      -> Testcontainers real DB
migration fresh install     -> Testcontainers real DB
migration upgrade path      -> Testcontainers real DB
vendor-specific migration   -> Testcontainers real DB
performance rehearsal       -> staging/prod-like DB
```

H2 mempercepat feedback, tetapi bukan bukti production correctness.

---

## 10. Sequences, Identity, Auto Increment: Same Goal, Different Semantics

Semua database menyediakan cara menghasilkan ID, tetapi semantics berbeda.

### 10.1 PostgreSQL

Modern:

```sql
CREATE TABLE customer (
  id bigint generated by default as identity primary key,
  name text not null
);
```

Legacy:

```sql
CREATE TABLE customer (
  id bigserial primary key,
  name text not null
);
```

### 10.2 Oracle

Sequence:

```sql
CREATE SEQUENCE customer_seq START WITH 1 INCREMENT BY 1 CACHE 100;
```

Identity:

```sql
id NUMBER GENERATED BY DEFAULT AS IDENTITY
```

### 10.3 MySQL

```sql
id bigint not null auto_increment primary key
```

### 10.4 SQL Server

```sql
id bigint identity(1,1) primary key
```

### 10.5 Migration Implications

Saat migrasi ID strategy, perhatikan:

- existing max ID,
- sequence current value,
- import data explicit ID,
- seed deterministic ID,
- Hibernate allocation size,
- sequence cache,
- gap expectation,
- distributed writes,
- replication,
- rollback.

Contoh incident umum:

1. Data di-import dengan ID sampai 100000.
2. Sequence masih di 5000.
3. Insert baru gagal duplicate key.

Post-migration check harus mencakup:

```sql
-- pseudo, vendor-specific
SELECT MAX(id) FROM customer;
SELECT current_sequence_value;
```

Lalu align sequence.

---

## 11. Boolean Migration Across Vendors

Boolean terlihat sederhana tetapi tidak portable sepenuhnya.

| DB | Common boolean representation |
|---|---|
| PostgreSQL | `boolean` |
| Oracle | `NUMBER(1)`, `CHAR(1)`, newer feature support varies by version/context |
| MySQL | `BOOLEAN` alias `TINYINT(1)` |
| SQL Server | `BIT` |

### 11.1 Portable Domain Model

Di Java:

```java
private boolean active;
```

Tetapi database bisa menyimpan:

```text
true/false
1/0
Y/N
T/F
```

### 11.2 Migration Strategy

Untuk existing legacy data:

```text
Y -> true
N -> false
NULL -> decide default or preserve unknown
```

Jangan langsung:

```sql
ALTER TABLE customer ADD active BOOLEAN NOT NULL DEFAULT TRUE;
```

Tanpa memikirkan:

- old app compatibility,
- default semantics,
- nullable transitional phase,
- existing row backfill,
- invalid legacy values,
- Java mapping.

### 11.3 Better Pattern

1. Add nullable new column.
2. Backfill deterministic mapping.
3. Update application to write both or read new.
4. Validate no null/invalid.
5. Add constraint/not-null.
6. Remove old column later.

---

## 12. Timestamp and Timezone Differences

Tanggal/waktu adalah sumber bug migration yang besar.

### 12.1 Java Type Mapping

Common Java types:

```java
LocalDate
LocalDateTime
Instant
OffsetDateTime
ZonedDateTime
```

Database type tidak selalu punya semantics yang sama.

### 12.2 Common Principles

Untuk audit/event timestamp, biasanya lebih aman:

- simpan instant/UTC,
- gunakan precision konsisten,
- hindari timezone server implicit,
- pastikan JDBC driver mapping jelas,
- pastikan migration tidak mengubah makna waktu.

### 12.3 Dangerous Migration

```sql
ALTER TABLE audit_event
ALTER COLUMN created_at TYPE timestamp;
```

Pertanyaan:

- Dari type apa ke type apa?
- Apakah value lama local time atau UTC?
- Apakah app lama membaca sebagai local time?
- Apakah timezone conversion terjadi?
- Apakah precision hilang?
- Apakah index affected?

### 12.4 Safe Migration Mental Model

Untuk timestamp migration:

1. Identify existing semantic, bukan hanya existing type.
2. Sample data dari production.
3. Tentukan canonical target semantic.
4. Buat shadow column.
5. Backfill dengan explicit conversion.
6. Compare old/new logically.
7. Switch read path.
8. Contract old column.

---

## 13. JSON Column Differences

JSON support berbeda jauh antar vendor.

### 13.1 PostgreSQL

```sql
metadata jsonb
```

Index:

```sql
CREATE INDEX idx_event_metadata_gin
ON event USING gin(metadata);
```

### 13.2 MySQL

```sql
metadata JSON
```

Generated column untuk index:

```sql
ALTER TABLE event
ADD COLUMN customer_id_generated varchar(64)
GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.customerId'))) STORED;

CREATE INDEX idx_event_customer_id_generated
ON event(customer_id_generated);
```

### 13.3 Oracle

Tergantung versi, JSON bisa berbasis CLOB/VARCHAR/BLOB dengan constraint/function atau native JSON type di versi modern.

### 13.4 SQL Server

JSON sering disimpan dalam text column dengan JSON functions.

### 13.5 Migration Concern

Saat memigrasi JSON:

- apakah JSON valid?
- apakah field wajib ada?
- apakah path case-sensitive?
- apakah field akan diindex?
- apakah generated column diperlukan?
- apakah ukuran index besar?
- apakah query JSON akan menjadi bottleneck?
- apakah schema JSON berubah seiring versi app?

JSON migration sering lebih mirip document schema migration daripada relational schema migration.

---

## 14. CLOB, BLOB, TEXT, and Large Object Migration

Large object migration perlu diperlakukan sebagai operational migration.

### 14.1 Common Mistake

```sql
UPDATE document
SET content = replace(content, 'old', 'new');
```

Pada table kecil mungkin aman. Pada table besar dengan CLOB/TEXT besar, ini bisa:

- menghasilkan undo/redo/log besar,
- memperbesar storage,
- memperlambat replication,
- memicu lock panjang,
- menyebabkan backup/restore impact,
- membuat vacuum/shrink/reclaim perlu operasi tambahan.

### 14.2 Safer Strategy

- hitung jumlah row dan total size,
- sample distribution ukuran object,
- backfill chunked,
- simpan checkpoint,
- throttle,
- monitor log/undo/temp storage,
- verifikasi checksum/content count,
- rencanakan reclaim jika perlu.

### 14.3 Java-Based Migration Caveat

Java-based migration untuk LOB bisa membaca banyak data ke memory bila tidak hati-hati.

Bad:

```java
String content = resultSet.getString("CONTENT");
```

Untuk CLOB besar, gunakan streaming API bila perlu. Tetapi lebih penting lagi: tanya apakah migration ini memang harus dilakukan di Flyway/Liquibase startup, atau harus jadi controlled batch job.

---

## 15. Identifier Case Sensitivity and Naming Discipline

Naming bukan kosmetik. Naming mempengaruhi portability, maintainability, dan operability.

### 15.1 Recommended Standard

Gunakan:

```text
lower_snake_case
```

atau untuk Oracle-heavy organization:

```text
UPPER_SNAKE_CASE
```

Yang penting konsisten dan tidak bergantung quoted identifier.

### 15.2 Avoid Quoted Identifier

Bad:

```sql
CREATE TABLE "User" (
  "Id" BIGINT PRIMARY KEY,
  "CreatedAt" TIMESTAMP
);
```

Problem:

- query harus selalu quoted,
- ORM mapping lebih rentan,
- cross-DB behavior berbeda,
- migration diff noisy,
- developer mudah salah case.

Better:

```sql
CREATE TABLE app_user (
  id BIGINT PRIMARY KEY,
  created_at TIMESTAMP NOT NULL
);
```

### 15.3 Avoid Reserved Words

Hindari nama object:

```text
user
order
transaction
group
role
case
```

Gunakan:

```text
app_user
sales_order
case_record
user_role
workflow_group
```

---

## 16. Constraint Behavior Differences

Constraint tidak selalu sama semantics-nya.

### 16.1 Unique Constraint and NULL

Banyak database memperlakukan `NULL` dalam unique constraint dengan cara yang memungkinkan multiple null, tetapi detail bisa berbeda.

Contoh:

```sql
CREATE UNIQUE INDEX uk_customer_email ON customer(email);
```

Pertanyaan:

- Apakah multiple `NULL` allowed?
- Apakah email comparison case-sensitive?
- Apakah collation membuat `A` sama dengan `a`?
- Apakah empty string dianggap NULL?
- Apakah partial unique index tersedia?

PostgreSQL bisa:

```sql
CREATE UNIQUE INDEX uk_customer_email_not_null
ON customer(email)
WHERE email IS NOT NULL;
```

Vendor lain butuh pattern berbeda.

### 16.2 Foreign Key Validation

PostgreSQL punya `NOT VALID`. Oracle punya `ENABLE NOVALIDATE`/`VALIDATE` style. SQL Server punya `WITH NOCHECK` caveat. MySQL behavior berbeda.

Jangan hanya bertanya:

> “Bisakah add FK?”

Tanya:

> “Apakah add FK akan scan existing data, lock table, block writes, dan bagaimana validasi dilakukan?”

### 16.3 Check Constraint

Check constraint support dan enforcement historis berbeda, terutama MySQL versi lama.

Migration harus memastikan constraint benar-benar enforced, bukan hanya parsed.

---

## 17. Index Differences

Index adalah area vendor-specific yang sangat besar.

### 17.1 Expression/Function-Based Index

PostgreSQL:

```sql
CREATE INDEX idx_customer_lower_email
ON customer (lower(email));
```

Oracle:

```sql
CREATE INDEX IDX_CUSTOMER_LOWER_EMAIL
ON CUSTOMER (LOWER(EMAIL));
```

SQL Server sering memakai computed column atau expression support tertentu.

MySQL bisa memakai generated column.

### 17.2 Partial/Filtered Index

PostgreSQL:

```sql
CREATE INDEX idx_task_open
ON task(assignee_id, due_date)
WHERE status = 'OPEN';
```

SQL Server:

```sql
CREATE INDEX IX_Task_Open
ON app.Task(AssigneeId, DueDate)
WHERE Status = 'OPEN';
```

MySQL tidak punya partial index dengan semantics yang sama.

### 17.3 Index Length and Prefix

MySQL dengan varchar panjang dan utf8mb4 bisa terkena batas index length, tergantung version/row format.

Bad assumption:

```sql
CREATE INDEX idx_customer_name ON customer(name);
```

Jika `name varchar(1000)` dengan charset tertentu, bisa bermasalah atau tidak berguna.

### 17.4 Invisible/Unusable Index

Beberapa database punya konsep invisible/unusable index. Ini berguna untuk testing index impact atau maintenance, tetapi migration harus mengerti state index.

Post-migration verification tidak boleh hanya melihat object exist. Harus cek usable/valid/ready state.

---

## 18. Generated Columns and Computed Columns

Generated/computed column berguna untuk migration dan indexing, terutama JSON atau normalized search.

### 18.1 MySQL Example

```sql
ALTER TABLE customer
ADD COLUMN normalized_email varchar(255)
GENERATED ALWAYS AS (lower(email)) STORED;

CREATE INDEX idx_customer_normalized_email
ON customer(normalized_email);
```

### 18.2 SQL Server Example

```sql
ALTER TABLE app.Customer
ADD NormalizedEmail AS LOWER(Email) PERSISTED;

CREATE INDEX IX_Customer_NormalizedEmail
ON app.Customer(NormalizedEmail);
```

### 18.3 Migration Concern

- Apakah generated expression deterministic?
- Apakah persisted/stored menyebabkan table rewrite?
- Apakah index build blocking?
- Apakah expression collation-sensitive?
- Apakah function behavior sama antar DB?

---

## 19. Stored Procedures, Functions, Packages, and Triggers

Migration tidak hanya table/index. Banyak enterprise system punya database program objects.

### 19.1 Object Definition Strategy

Untuk object seperti view/function/procedure/package, sering cocok memakai repeatable migration.

Flyway:

```text
R__create_customer_summary_view.sql
R__create_case_transition_function.sql
```

Liquibase:

```xml
<changeSet id="create-customer-summary-view" author="team" runOnChange="true">
  <sqlFile path="views/customer_summary.sql"/>
</changeSet>
```

### 19.2 Vendor Difference

- PostgreSQL function syntax berbeda dari Oracle PL/SQL.
- Oracle package punya spec dan body.
- SQL Server procedure memakai T-SQL batch rules.
- MySQL delimiter handling penting.

### 19.3 Migration Concern

- dependency order,
- invalid objects,
- grants setelah recreate,
- definer/invoker rights,
- editioning/versioning,
- trigger side effect during backfill,
- deployment compatibility.

### 19.4 Trigger-Assisted Migration Warning

Trigger kadang dipakai untuk dual-write old/new column atau old/new table. Ini powerful tapi dangerous.

Risiko:

- hidden write amplification,
- recursion,
- performance drop,
- lock contention,
- debugging sulit,
- behavior berbeda dari app-level dual-write,
- trigger lupa dihapus pada contract phase.

Gunakan dengan runbook ketat.

---

## 20. Schema and Tablespace Differences

### 20.1 PostgreSQL Schema

PostgreSQL schema adalah namespace dalam database.

```sql
CREATE SCHEMA app;
CREATE TABLE app.customer (...);
```

Search path bisa menyebabkan migration membuat object di schema salah.

Recommendation:

- schema-qualify object,
- set search_path eksplisit,
- konfigurasi Flyway/Liquibase schemas jelas.

### 20.2 Oracle Schema

Oracle schema sangat terkait dengan user. `APP.CUSTOMER` berarti table `CUSTOMER` di schema/user `APP`.

Migration concern:

- migration user vs object owner,
- grants/synonyms,
- default tablespace,
- quota,
- cross-schema object,
- public synonym anti-pattern.

### 20.3 SQL Server Schema

SQL Server schema seperti `dbo`, `app`, `audit`.

Jangan biarkan default schema membuat object liar.

### 20.4 Tablespace/Filegroup

Oracle tablespace dan SQL Server filegroup bisa menjadi bagian migration untuk enterprise system.

Contoh Oracle:

```sql
CREATE INDEX IDX_AUDIT_CREATED_AT
ON AUDIT_TRAIL(CREATED_AT)
TABLESPACE APP_INDEX_TS;
```

Pertanyaan:

- Apakah tablespace sama di semua env?
- Apakah migration harus portable antar env?
- Apakah placeholder digunakan?
- Apakah DBA mengelola storage terpisah?

---

## 21. Vendor-Specific SQL in Flyway

Flyway punya konsep location dan placeholder yang bisa digunakan untuk memisahkan vendor-specific scripts.

### 21.1 Directory Strategy

```text
src/main/resources/db/migration/common
src/main/resources/db/migration/postgresql
src/main/resources/db/migration/oracle
src/main/resources/db/migration/mysql
src/main/resources/db/migration/sqlserver
```

Konfigurasi per environment menentukan location.

Contoh:

```properties
flyway.locations=classpath:db/migration/common,classpath:db/migration/postgresql
```

### 21.2 Naming Strategy

Hindari membuat version conflict antar vendor.

Bad:

```text
postgresql/V12__create_index.sql
oracle/V12__create_index.sql
```

Jika satu deployment hanya memilih satu vendor location, ini masih bisa. Tetapi untuk readability, lebih baik jelas:

```text
common/V20260117_0900__create_customer_table.sql
postgresql/V20260117_0910__create_customer_email_index_pg.sql
oracle/V20260117_0910__create_customer_email_index_oracle.sql
```

### 21.3 Placeholder Strategy

```sql
CREATE TABLE ${app_schema}.customer (
  id BIGINT PRIMARY KEY,
  name VARCHAR(255) NOT NULL
);
```

Tetapi jangan overuse placeholder untuk menyembunyikan vendor-specific semantics.

Bad abstraction:

```sql
CREATE TABLE customer (
  id ${id_type} PRIMARY KEY,
  created_at ${timestamp_type}
);
```

Jika terlalu banyak placeholder, migration menjadi template engine yang sulit diaudit.

---

## 22. Vendor-Specific SQL in Liquibase

Liquibase punya beberapa fitur untuk vendor targeting.

### 22.1 `dbms` Attribute

```xml
<changeSet id="20260117-idx-customer-email-pg" author="team" dbms="postgresql">
    <sql>
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customer_email
        ON customer(email);
    </sql>
</changeSet>
```

Oracle:

```xml
<changeSet id="20260117-idx-customer-email-oracle" author="team" dbms="oracle">
    <sql>
        CREATE INDEX IDX_CUSTOMER_EMAIL ON CUSTOMER(EMAIL) ONLINE
    </sql>
</changeSet>
```

### 22.2 Preconditions

```xml
<preConditions onFail="HALT">
    <dbms type="postgresql"/>
    <tableExists tableName="customer"/>
</preConditions>
```

### 22.3 Contexts and Labels

Jangan campur vendor targeting dengan environment targeting secara sembarangan.

Bad:

```xml
<context>prod-postgres-special</context>
```

Better:

```text
vendor targeting -> dbms/precondition
release targeting -> label
environment targeting -> context
```

### 22.4 SQL-First For Vendor-Specific Operations

Untuk operasi vendor-specific yang penting, SQL native sering lebih jelas daripada declarative abstraction.

Contoh:

```xml
<changeSet id="20260117-create-index-concurrently" author="team" dbms="postgresql" runInTransaction="false">
    <sqlFile path="db/changelog/postgresql/create-index-concurrently.sql"/>
</changeSet>
```

Ini lebih eksplisit daripada mencoba memaksa abstraction yang tidak menangkap semantics.

---

## 23. Cross-Database Product Strategy

Jika produk Java harus mendukung beberapa database vendor, strategy harus eksplisit sejak awal.

### 23.1 Option A — Lowest Common Denominator

Kelebihan:

- migration lebih sederhana,
- feature set seragam,
- lebih mudah onboarding.

Kekurangan:

- kehilangan fitur vendor penting,
- performance bisa buruk,
- zero-downtime migration lebih sulit,
- query/index tidak optimal.

### 23.2 Option B — Vendor-Specific Migration Paths

Kelebihan:

- bisa memakai fitur terbaik tiap DB,
- lebih aman untuk online DDL,
- performance lebih baik.

Kekurangan:

- effort test lebih besar,
- migration branch lebih kompleks,
- butuh skill lebih tinggi,
- dokumentasi harus kuat.

### 23.3 Option C — Officially Supported Vendors Only

Produk serius biasanya membatasi support:

```text
Supported:
- PostgreSQL 15–17
- Oracle 19c/21c

Not supported:
- MySQL
- SQL Server
- H2 except local test
```

Ini bukan kelemahan. Ini engineering honesty.

### 23.4 Compatibility Matrix

Buat matrix seperti:

| Java Version | App Version | DB Vendor | DB Version | Migration Tool | Supported? |
|---|---|---|---|---|---|
| 8 | legacy-3.x | Oracle | 19c | Flyway 9.x/10.x depending support | Yes |
| 17 | 5.x | PostgreSQL | 16 | Flyway/Liquibase modern | Yes |
| 21 | 6.x | Oracle | 19c | Flyway/Liquibase modern | Yes |
| 25 | future | PostgreSQL | 17+ | latest compatible | Planned |

Jangan klaim support DBMS tanpa migration test matrix.

---

## 24. Java 8–25 Considerations

Database migration SQL mungkin sama, tetapi runtime Java mempengaruhi tooling dan integration.

### 24.1 Java 8 Legacy

Concern:

- versi Flyway/Liquibase terbaru mungkin tidak mendukung Java 8,
- Spring Boot versi lama,
- JDBC driver lama,
- TLS/cipher compatibility,
- container base image lama,
- timezone database lama,
- build plugin compatibility.

Strategy:

- pin tool version yang compatible,
- dokumentasikan EOL risk,
- jangan blindly upgrade migration tool,
- gunakan external CLI/container bila app runtime terlalu lama.

### 24.2 Java 11/17 Transitional

Java 17 menjadi baseline banyak framework modern. Liquibase 5.x, misalnya, bergerak ke minimum Java modern. Untuk organisasi enterprise, Java 17 sering menjadi sweet spot.

Strategy:

- pisahkan app runtime dan migration runner bila perlu,
- gunakan plugin version yang jelas,
- test JDBC driver dengan DB version target,
- perhatikan module/classpath issue.

### 24.3 Java 21/25 Modern

Concern:

- framework compatibility,
- plugin compatibility,
- container image,
- native image bila dipakai,
- virtual thread tidak otomatis relevan untuk migration,
- JDBC driver harus certified/compatible.

Prinsip:

> Migration correctness lebih penting daripada memakai runtime Java terbaru.

Gunakan Java modern untuk tooling bila compatible, tetapi jangan biarkan upgrade runtime merusak migration pipeline.

---

## 25. Vendor-Specific Migration Review Checklist

Gunakan checklist ini saat review migration.

### 25.1 General

- DBMS target apa?
- Versi DBMS target apa?
- Apakah semua environment memakai versi/edition sama?
- Apakah migration memakai syntax vendor-specific?
- Apakah migration tested di real engine?
- Apakah migration transactional atau non-transactional?
- Apakah partial failure recoverable?
- Apakah migration safe untuk rerun/retry?

### 25.2 Locking and Online DDL

- Apakah statement mengambil table lock?
- Apakah write/read blocking?
- Apakah ada online/concurrent alternative?
- Apakah online operation supported di target edition?
- Apakah lock timeout diset?
- Apakah ada long transaction preflight?

### 25.3 Type Semantics

- Apakah string length byte atau char?
- Apakah timestamp timezone semantics jelas?
- Apakah boolean mapping jelas?
- Apakah JSON type sesuai query pattern?
- Apakah LOB storage impact dipahami?

### 25.4 Identifier and Naming

- Apakah object name tidak reserved word?
- Apakah quoted identifier dihindari?
- Apakah constraint/index name sesuai limit vendor?
- Apakah schema-qualified?

### 25.5 Constraint and Index

- Apakah unique/null/collation behavior jelas?
- Apakah FK validation strategy aman?
- Apakah index build online/concurrent?
- Apakah expression/generated/partial index portable?
- Apakah post-migration index validity dicek?

### 25.6 Data and Backfill

- Apakah data volume diketahui?
- Apakah backfill chunked?
- Apakah trigger/procedure side effect dipahami?
- Apakah redo/undo/log impact dipahami?
- Apakah replication impact dipahami?

---

## 26. Practical Examples

### 26.1 Adding Email Normalization Across Vendors

Requirement:

> Tambahkan normalized email agar lookup case-insensitive cepat.

#### PostgreSQL

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customer_lower_email
ON customer (lower(email));
```

Pros:

- simple expression index,
- no column required.

Concern:

- cannot run inside transaction block,
- collation behavior,
- invalid index recovery.

#### MySQL

```sql
ALTER TABLE customer
ADD COLUMN normalized_email varchar(255)
GENERATED ALWAYS AS (lower(email)) STORED;

CREATE INDEX idx_customer_normalized_email
ON customer(normalized_email);
```

Concern:

- generated column support/version,
- table rewrite,
- online DDL behavior,
- collation.

#### Oracle

```sql
CREATE INDEX IDX_CUSTOMER_LOWER_EMAIL
ON CUSTOMER (LOWER(EMAIL));
```

Concern:

- function-based index stats,
- optimizer using index,
- grants/privileges,
- online option if needed.

#### SQL Server

```sql
ALTER TABLE app.Customer
ADD NormalizedEmail AS LOWER(Email) PERSISTED;

CREATE INDEX IX_Customer_NormalizedEmail
ON app.Customer(NormalizedEmail);
```

Concern:

- persisted computed column,
- lock/log impact,
- collation.

Lesson:

> Same requirement, different correct migration.

---

### 26.2 Adding Non-Null Column With Default

Requirement:

> Add `created_by` non-null to existing large table.

Bad universal migration:

```sql
ALTER TABLE orders
ADD created_by varchar(100) NOT NULL DEFAULT 'system';
```

Safer universal choreography:

1. Add nullable column.
2. Deploy app writing new column.
3. Backfill existing rows in chunks.
4. Verify no null remains.
5. Add default for future insert if needed.
6. Add not-null constraint with vendor-aware strategy.

PostgreSQL final:

```sql
ALTER TABLE orders
ALTER COLUMN created_by SET DEFAULT 'system';

ALTER TABLE orders
ALTER COLUMN created_by SET NOT NULL;
```

Oracle final:

```sql
ALTER TABLE ORDERS MODIFY (CREATED_BY DEFAULT 'system');
ALTER TABLE ORDERS MODIFY (CREATED_BY NOT NULL);
```

MySQL final:

```sql
ALTER TABLE orders
MODIFY created_by varchar(100) NOT NULL DEFAULT 'system';
```

SQL Server final:

```sql
ALTER TABLE app.Orders
ADD CONSTRAINT DF_Orders_CreatedBy DEFAULT 'system' FOR CreatedBy;

ALTER TABLE app.Orders
ALTER COLUMN CreatedBy varchar(100) NOT NULL;
```

Lesson:

> The choreography can be portable; the final enforcement SQL may be vendor-specific.

---

## 27. Designing Vendor-Aware Migration Repositories

### 27.1 Single Vendor Application

Jika sistem hanya support Oracle:

```text
src/main/resources/db/migration
  V20260117_0900__create_customer.sql
  V20260117_0910__create_customer_indexes.sql
  R__customer_summary_view.sql
```

Tidak perlu over-engineer portability.

### 27.2 Multi Vendor Product

```text
src/main/resources/db/migration
  common/
    V20260117_0900__logical_baseline_marker.sql
  postgresql/
    V20260117_0910__create_customer_table_pg.sql
    V20260117_0920__create_customer_indexes_pg.sql
  oracle/
    V20260117_0910__create_customer_table_oracle.sql
    V20260117_0920__create_customer_indexes_oracle.sql
  mysql/
    V20260117_0910__create_customer_table_mysql.sql
  sqlserver/
    V20260117_0910__create_customer_table_sqlserver.sql
```

### 27.3 Alternative: One Changelog With Vendor Branching

Liquibase style:

```text
db/changelog/master.yaml
db/changelog/customer.yaml
db/changelog/vendor/postgresql/customer-index.sql
db/changelog/vendor/oracle/customer-index.sql
```

Gunakan `dbms`/precondition untuk branching.

### 27.4 Rule of Thumb

- Jika vendor differences sedikit: satu changelog dengan dbms branches.
- Jika vendor differences banyak: pisahkan vendor path.
- Jika hanya satu vendor: jangan pura-pura portable.

---

## 28. Operational Runbook for Vendor-Specific Migration

Sebelum production migration:

### 28.1 Preflight

```text
1. Confirm DB vendor/version/edition.
2. Confirm migration tool version.
3. Confirm JDBC driver version.
4. Confirm target schema/search_path/default schema.
5. Check long-running transactions.
6. Check blocking sessions.
7. Check free storage/temp/undo/log/tablespace.
8. Check replication lag/Data Guard/log shipping.
9. Confirm backup/restore point.
10. Confirm rollback/roll-forward plan.
```

### 28.2 During Migration

```text
1. Monitor migration logs.
2. Monitor DB locks.
3. Monitor CPU/IO.
4. Monitor transaction log/redo/undo.
5. Monitor replication lag.
6. Monitor app error rate.
7. Stop if lock wait exceeds threshold.
```

### 28.3 Postflight

```text
1. Check migration history table.
2. Check object existence.
3. Check object validity/usability.
4. Check row counts/backfill counts.
5. Check invalid indexes/objects.
6. Check app health.
7. Check query plan if index-related.
8. Record evidence for audit.
```

---

## 29. Anti-Patterns

### 29.1 “It Passed H2, So It Is Safe”

Passing H2 means little for vendor-specific production behavior.

### 29.2 “Liquibase Abstracts the Database, So We Are Portable”

Liquibase helps portability, but cannot erase engine semantics.

### 29.3 “Flyway Is Just SQL, So It Will Work Anywhere”

SQL syntax and SQL behavior differ. SQL-first does not mean vendor-neutral.

### 29.4 “Use One SQL File For All Vendors”

Good if simple. Dangerous if it hides semantics differences.

### 29.5 “Use ORM DDL Generation To Avoid Vendor Differences”

ORM DDL generation may create objects, but does not solve:

- online migration,
- data backfill,
- lock strategy,
- seed determinism,
- auditability,
- rollback,
- production drift.

### 29.6 “Just Add NOT NULL DEFAULT”

May be fine for small table. Dangerous for large table depending vendor/version.

### 29.7 “Index Creation Is Always Safe”

Index creation can block, consume storage, generate logs, fail, or produce invalid/unusable object.

### 29.8 “All Timestamps Mean The Same Thing”

They do not. Timestamp migration must define semantic, not only type.

---

## 30. Top 1% Engineer Heuristics

Gunakan heuristik ini saat mendesain migration.

### 30.1 Separate Logical Change From Physical Execution

Logical requirement:

```text
Need case-insensitive email lookup.
```

Physical execution:

```text
PostgreSQL: expression index concurrently.
MySQL: generated column + index.
Oracle: function-based index online if supported.
SQL Server: computed persisted column + index.
```

### 30.2 Prefer Choreography Over Heroic Statement

Daripada satu statement besar:

```sql
ALTER TABLE huge_table ADD important_col ... NOT NULL DEFAULT ...;
```

Lebih aman:

```text
expand -> app write -> backfill -> validate -> enforce -> contract
```

### 30.3 Test Against Real Engine

H2 untuk speed. Real DB untuk truth.

### 30.4 Treat Vendor Features As Safety Tools, Not Portability Violations

`CREATE INDEX CONCURRENTLY`, `ONLINE`, `NOT VALID`, `NOVALIDATE`, generated columns, computed columns, function-based indexes — semua bisa menjadi alat safety jika dipakai dengan benar.

### 30.5 Make Vendor Assumptions Explicit

Dalam migration comment:

```sql
-- PostgreSQL-specific migration.
-- Uses CREATE INDEX CONCURRENTLY to avoid blocking writes.
-- Must run outside transaction.
-- If migration fails, check for invalid index and drop concurrently before retry.
```

Comment seperti ini bukan noise. Ini operational knowledge.

---

## 31. Mini Design Exercise

Requirement:

> Sistem Java harus menambahkan fitur pencarian case-insensitive berdasarkan email di table `customer` dengan 50 juta row. Production memakai PostgreSQL 15. UAT memakai PostgreSQL 15. Local dev memakai H2. Aplikasi berjalan di Kubernetes dengan rolling deployment.

Bad answer:

```sql
CREATE INDEX idx_customer_email ON customer(email);
```

Better reasoning:

1. Requirement bukan exact email lookup, tetapi case-insensitive lookup.
2. PostgreSQL mendukung expression index.
3. Table besar, jadi gunakan concurrent index.
4. Migration tidak boleh transaction-wrapped.
5. Local H2 tidak bisa menjadi proof.
6. Test migration di PostgreSQL Testcontainers.
7. Production runbook harus cek invalid index bila gagal.
8. App query harus cocok dengan index expression.

Migration:

```sql
-- flyway:executeInTransaction=false
-- PostgreSQL-specific.
-- Concurrent index avoids blocking writes but may run longer.
-- If failed, inspect pg_index for invalid index and drop concurrently before retry.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customer_lower_email
ON customer (lower(email));
```

Application query:

```sql
SELECT *
FROM customer
WHERE lower(email) = lower(?);
```

Post-check:

```sql
SELECT indexrelid::regclass AS index_name,
       indisvalid,
       indisready
FROM pg_index
WHERE indexrelid = 'idx_customer_lower_email'::regclass;
```

This is vendor-aware engineering.

---

## 32. Summary

Database migration tool tidak menggantikan pemahaman database engine.

Yang harus dibawa dari part ini:

1. Flyway/Liquibase adalah control plane, database vendor adalah execution plane.
2. SQL yang terlihat sama bisa punya lock, transaction, type, dan index semantics berbeda.
3. Portability yang baik bukan berarti menghindari fitur vendor; portability yang baik berarti vendor differences dikelola secara eksplisit.
4. H2/HSQLDB berguna untuk fast feedback, tetapi tidak cukup untuk production migration correctness.
5. PostgreSQL, Oracle, MySQL/MariaDB, dan SQL Server punya trap berbeda pada DDL, timestamp, boolean, JSON, LOB, identifier, constraint, index, dan online operation.
6. Top engineer memisahkan logical change dari physical execution.
7. Migration review harus vendor-aware.
8. Production runbook harus mencakup lock, storage, transaction log, object validity, dan recovery path.

---

## 33. Checklist Ringkas

Sebelum approve migration, jawab:

```text
[ ] DB vendor dan version target sudah jelas?
[ ] Migration diuji di real DB engine, bukan hanya H2?
[ ] DDL transactional behavior diketahui?
[ ] Lock behavior diketahui?
[ ] Online/concurrent option dipertimbangkan?
[ ] Type semantics cocok dengan Java domain model?
[ ] Timestamp/timezone semantics eksplisit?
[ ] Identifier naming aman untuk vendor target?
[ ] Constraint behavior, terutama NULL/collation/validation, sudah dipahami?
[ ] Index creation aman dan post-check tersedia?
[ ] LOB/JSON/generated column behavior dipahami?
[ ] Partial failure recovery jelas?
[ ] Vendor-specific SQL diberi komentar dan runbook?
```

---

## 34. Koneksi Ke Part Berikutnya

Part berikutnya adalah:

```text
23-migration-testing-strategy.md
```

Setelah memahami vendor-specific behavior, kita akan membahas bagaimana membuktikan migration aman melalui testing strategy:

- fresh database migration test,
- upgrade path test,
- rollback/roll-forward test,
- seed consistency test,
- data migration correctness test,
- Testcontainers,
- production-like rehearsal,
- schema diff validation,
- migration dry-run,
- CI pipeline stages.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./21-database-locking-transactions-online-ddl.md">⬅️ Database Locking, Transactions, and Online DDL</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./23-migration-testing-strategy.md">Migration Testing Strategy ➡️</a>
</div>
