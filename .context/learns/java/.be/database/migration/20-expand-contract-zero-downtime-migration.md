# Part 20 — Expand/Contract Pattern for Zero-Downtime Migration

**Series:** `learn-java-database-migrations-seedings-flyway-liquibase`  
**File:** `20-expand-contract-zero-downtime-migration.md`  
**Context:** Java 8–25, Flyway, Liquibase, Spring Boot, Jakarta EE, plain Java, microservices, modular monolith, enterprise systems  
**Level:** Advanced / production-grade

---

## 0. Tujuan Pembelajaran

Setelah mempelajari bagian ini, kamu diharapkan mampu:

1. Memahami mengapa banyak database migration gagal bukan karena SQL-nya salah, tetapi karena **deployment choreography**-nya salah.
2. Mendesain perubahan schema yang tetap aman saat old application dan new application berjalan bersamaan.
3. Membedakan perubahan database yang bisa dilakukan langsung dengan perubahan yang wajib memakai pola **expand/contract**.
4. Melakukan column rename, type change, table split, table merge, constraint introduction, dan index introduction tanpa downtime besar.
5. Menentukan kapan migration harus dipisah menjadi beberapa release.
6. Membuat migration yang rollback-safe secara operasional.
7. Menggunakan Flyway/Liquibase sebagai mekanisme eksekusi, tetapi tidak menggantungkan keselamatan production hanya pada tool.
8. Berpikir seperti engineer production-grade: migration harus aman terhadap concurrency, partial deploy, retry, rollback code, version skew, dan environment drift.

---

## 1. Masalah Dasar: Database Tidak Ikut “Blue/Green” Semudah Aplikasi

Aplikasi bisa di-deploy seperti ini:

```text
old app instances running
        |
        v
new app instances gradually added
        |
        v
old app instances drained
```

Pada banyak arsitektur modern, kita bisa menjalankan beberapa versi aplikasi secara bersamaan:

```text
old-app-v1  ----\
               > shared database
new-app-v2  ----/
```

Masalahnya: database biasanya tetap satu.

```text
old-app-v1  ----\
               > same tables, same columns, same constraints
new-app-v2  ----/
```

Artinya, saat schema berubah, pertanyaannya bukan hanya:

> “Apakah migration SQL ini valid?”

Tetapi:

> “Apakah schema baru ini tetap kompatibel dengan old app yang mungkin masih berjalan?”

Dan juga:

> “Apakah new app tetap bisa berjalan kalau schema belum sepenuhnya berada dalam bentuk final?”

Inilah inti zero-downtime database migration.

---

## 2. Mental Model: Application Version dan Schema Version Tidak Selalu Berubah Bersamaan

Dalam deployment nyata, ada window waktu di mana versi aplikasi dan database tidak bergerak serentak.

Misalnya:

```text
T0: DB schema v1, App v1
T1: DB migration mulai
T2: DB schema v2 sebagian selesai
T3: App v2 mulai naik sebagian
T4: App v1 dan App v2 berjalan bersamaan
T5: App v1 selesai di-drain
T6: DB cleanup final dilakukan
```

Kalau migration hanya aman pada kondisi final:

```text
DB v2 + App v2
```

maka migration tersebut rapuh.

Migration production-grade harus memikirkan beberapa kombinasi:

| Kombinasi | Harus aman? | Keterangan |
|---|---:|---|
| App v1 + DB v1 | Ya | Kondisi awal |
| App v1 + DB v2-expanded | Ya | Old app masih berjalan setelah expand |
| App v2 + DB v2-expanded | Ya | New app mulai berjalan |
| App v1 + App v2 + DB v2-expanded | Ya | Rolling deploy / canary / blue-green overlap |
| App v2 + DB v2-final | Ya | Kondisi akhir |
| App v1 + DB v2-final | Tergantung | Harus aman jika rollback app masih mungkin |

Kesalahan umum adalah melompat langsung dari:

```text
App v1 + DB v1
```

ke:

```text
App v2 + DB v2-final
```

padahal di production ada fase antara.

---

## 3. Apa Itu Expand/Contract Pattern?

**Expand/contract** adalah pola migration bertahap:

1. **Expand**: tambahkan struktur baru tanpa merusak struktur lama.
2. **Migrate/backfill**: isi atau sinkronkan data ke struktur baru.
3. **Dual compatibility**: old dan new representation hidup bersama sementara.
4. **Switch**: aplikasi mulai membaca/menulis representation baru.
5. **Contract**: hapus struktur lama setelah tidak dipakai lagi.

Secara ringkas:

```text
Initial
  |
  v
Expand schema: add new nullable column/table/index/etc
  |
  v
Deploy app that can use both old and new structure
  |
  v
Backfill old data into new structure
  |
  v
Switch read path to new structure
  |
  v
Stop writing old structure
  |
  v
Contract: drop old column/table/index/etc
```

Kuncinya:

> Jangan menghapus atau mengubah kontrak lama sebelum semua consumer berhenti menggunakannya.

---

## 4. Database Contract: Aplikasi Bukan Satu-Satunya Consumer

Dalam sistem enterprise, database sering dikonsumsi oleh banyak pihak:

- aplikasi utama,
- background job,
- reporting query,
- ETL,
- downstream integration,
- admin script,
- BI dashboard,
- stored procedure,
- materialized view,
- audit/export process,
- manual support query,
- service lain yang masih berbagi schema.

Jadi sebelum melakukan contract phase, jangan hanya bertanya:

> “Kode aplikasi utama sudah tidak pakai column ini?”

Tanyakan juga:

> “Apakah semua consumer database sudah berhenti bergantung pada object lama ini?”

Dalam sistem yang regulated atau complex enterprise, ini sangat penting karena perubahan schema bisa memiliki cross-entity impact.

---

## 5. Kapan Expand/Contract Wajib Dipakai?

Tidak semua migration perlu expand/contract. Tetapi pola ini wajib dipertimbangkan saat perubahan bersifat breaking.

### 5.1 Biasanya Aman Dilakukan Langsung

Contoh perubahan yang biasanya aman:

```sql
ALTER TABLE customer ADD middle_name VARCHAR(100);
```

Dengan syarat:

- kolom nullable,
- tidak ada default mahal yang rewrite seluruh table,
- tidak ada trigger/constraint yang mengubah behaviour old app,
- old app tidak memakai `SELECT *` secara brittle,
- ORM mapping tidak gagal karena column tambahan.

Contoh lain:

```sql
CREATE INDEX idx_order_created_at ON orders(created_at);
```

Dengan syarat index creation tidak mengunci table terlalu lama atau memakai mekanisme online/concurrent sesuai DBMS.

### 5.2 Harus Expand/Contract

Perubahan berikut umumnya perlu expand/contract:

| Perubahan | Mengapa Berbahaya Jika Langsung |
|---|---|
| Rename column | Old app masih mencari nama lama |
| Drop column | Old app/query/report masih membaca kolom lama |
| Change column type | Old app mungkin masih kirim format lama |
| Add NOT NULL column tanpa default aman | Existing rows tidak valid |
| Add unique constraint | Existing duplicate bisa gagal; concurrent write bisa konflik |
| Split table | Old app masih membaca table lama |
| Merge table | Old app masih mengandalkan struktur lama |
| Change enum/status representation | Old app masih menulis nilai lama |
| Move data to normalized table | Old read path belum siap join baru |
| Change primary key strategy | Foreign key dan integration bisa rusak |
| Drop index | Query lama bisa tiba-tiba lambat |
| Tighten constraint | Data lama atau request lama bisa gagal |

---

## 6. The Compatibility Matrix

Sebelum menulis migration, buat matrix compatibility.

Contoh untuk perubahan dari `customer.name` ke `customer.full_name`:

| App Version | Schema Version | Expected Behaviour |
|---|---|---|
| v1 | old schema: `name` only | OK |
| v1 | expanded schema: `name`, `full_name` | OK, v1 tetap pakai `name` |
| v2 | expanded schema: `name`, `full_name` | OK, v2 bisa dual read/write |
| v2 | final schema: `full_name` only | OK |
| v1 | final schema: `full_name` only | Tidak OK, rollback app ke v1 gagal |

Dari matrix ini terlihat: contract phase tidak boleh dilakukan dalam release yang sama jika rollback app ke v1 masih mungkin.

Rule praktis:

> Jika rollback aplikasi ke versi lama masih menjadi strategi recovery, jangan drop contract lama pada release yang sama.

---

## 7. Release Choreography: Jangan Campur Expand dan Contract dalam Satu Release Berbahaya

Pola umum:

```text
Release N:
  - Expand schema
  - Deploy app yang bisa membaca/menulis format lama dan baru
  - Optional backfill kecil

Release N+1:
  - Switch read path ke format baru
  - Pastikan old app tidak lagi berjalan
  - Continue/complete backfill jika besar

Release N+2:
  - Stop write ke format lama
  - Monitor

Release N+3:
  - Contract: drop old column/table/index/constraint
```

Ini terasa lebih panjang, tetapi jauh lebih aman.

Untuk sistem kecil, beberapa fase bisa digabung. Untuk sistem besar/regulated/high-traffic, pisahkan fase.

---

## 8. Pattern 1: Add New Nullable Column Safely

### 8.1 Problem

Kita ingin menambah kolom `email_verified_at` pada table `users`.

Naive migration:

```sql
ALTER TABLE users ADD email_verified_at TIMESTAMP NOT NULL;
```

Ini salah jika existing row belum punya nilai.

### 8.2 Safer Expand Migration

```sql
ALTER TABLE users ADD email_verified_at TIMESTAMP NULL;
```

Lalu aplikasi v2:

- bisa menulis `email_verified_at`,
- tetap bisa menangani null,
- tidak mengasumsikan semua user sudah terverifikasi.

### 8.3 Backfill

Jika business rule memungkinkan:

```sql
UPDATE users
SET email_verified_at = created_at
WHERE email_verified_at IS NULL
  AND legacy_email_verified = 1;
```

Untuk table besar, jangan satu update besar; gunakan chunking seperti Part 19.

### 8.4 Contract

Setelah semua row valid:

```sql
ALTER TABLE users ALTER COLUMN email_verified_at SET NOT NULL;
```

Vendor syntax berbeda-beda, tetapi mental model sama.

### 8.5 Invariant

Sebelum contract:

```sql
SELECT COUNT(*)
FROM users
WHERE email_verified_at IS NULL;
```

Harus `0` atau sesuai rule pengecualian.

---

## 9. Pattern 2: Rename Column Without Downtime

### 9.1 Problem

Kita ingin rename:

```text
customer.name -> customer.full_name
```

Naive migration:

```sql
ALTER TABLE customer RENAME COLUMN name TO full_name;
```

Masalah:

- old app masih membaca `name`,
- old app masih menulis `name`,
- rollback app ke versi lama gagal,
- report query yang pakai `name` gagal.

### 9.2 Expand Phase

Tambahkan kolom baru:

```sql
ALTER TABLE customer ADD full_name VARCHAR(255);
```

### 9.3 Backfill Existing Data

```sql
UPDATE customer
SET full_name = name
WHERE full_name IS NULL;
```

Untuk table besar, pakai chunking.

### 9.4 App v2 Dual-Write

Saat update customer:

```java
public void updateCustomerName(long customerId, String fullName) {
    jdbcTemplate.update("""
        UPDATE customer
        SET name = ?, full_name = ?
        WHERE id = ?
        """, fullName, fullName, customerId);
}
```

Untuk Java 8, text block tidak tersedia:

```java
public void updateCustomerName(long customerId, String fullName) {
    jdbcTemplate.update(
        "UPDATE customer SET name = ?, full_name = ? WHERE id = ?",
        fullName,
        fullName,
        customerId
    );
}
```

### 9.5 App v2 Dual-Read

Read strategy:

```java
String effectiveName = row.getString("full_name");
if (effectiveName == null) {
    effectiveName = row.getString("name");
}
```

Atau SQL-level compatibility:

```sql
SELECT COALESCE(full_name, name) AS display_name
FROM customer;
```

### 9.6 Switch Phase

Setelah semua instance v2 berjalan dan backfill selesai:

- read path hanya pakai `full_name`,
- write path masih boleh dual-write sementara.

### 9.7 Stop Old Write

Di release berikutnya:

- aplikasi berhenti menulis `name`,
- monitoring memastikan tidak ada update ke `name`.

### 9.8 Contract Phase

Setelah aman:

```sql
ALTER TABLE customer DROP COLUMN name;
```

### 9.9 Important Lesson

Rename bukan operasi rename. Dalam zero-downtime migration, rename adalah:

```text
add new column
copy data
dual write
dual read
switch read
stop old write
drop old column
```

---

## 10. Pattern 3: Change Column Type Safely

### 10.1 Problem

Kita ingin mengubah:

```text
orders.amount VARCHAR(50) -> orders.amount_cents BIGINT
```

Naive migration:

```sql
ALTER TABLE orders ALTER COLUMN amount TYPE BIGINT;
```

Masalah:

- format lama mungkin `"12.34"`,
- ada nilai invalid seperti `"N/A"`,
- old app masih menulis string,
- precision bisa berubah,
- migration bisa lock table lama.

### 10.2 Expand

```sql
ALTER TABLE orders ADD amount_cents BIGINT;
```

### 10.3 Backfill Valid Rows

Pseudo SQL:

```sql
UPDATE orders
SET amount_cents = CAST(ROUND(CAST(amount AS DECIMAL(19,2)) * 100) AS BIGINT)
WHERE amount_cents IS NULL
  AND amount IS NOT NULL;
```

Namun di production, parsing amount sebaiknya hati-hati. Jika rule kompleks, Java-based migration atau batch job lebih aman.

### 10.4 Java Backfill Example

```java
public final class AmountBackfillJob {
    private final DataSource dataSource;

    public AmountBackfillJob(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    public void run(long lastSeenId, int batchSize) throws Exception {
        try (Connection connection = dataSource.getConnection()) {
            connection.setAutoCommit(false);

            List<OrderAmountRow> rows = fetchBatch(connection, lastSeenId, batchSize);
            for (OrderAmountRow row : rows) {
                Long cents = parseAmountToCents(row.amount());
                if (cents != null) {
                    updateAmountCents(connection, row.id(), cents);
                }
            }

            connection.commit();
        }
    }
}
```

Key point:

- parse deterministik,
- invalid data dicatat,
- batch kecil,
- bisa resume,
- tidak memblokir table lama terlalu lama.

### 10.5 Dual-Write

App baru menulis dua kolom:

```text
amount = "12.34"
amount_cents = 1234
```

### 10.6 Switch Read

App baru membaca `amount_cents`, fallback ke `amount` jika belum dibackfill.

### 10.7 Contract

Setelah aman:

```sql
ALTER TABLE orders DROP COLUMN amount;
```

Optional rename:

```sql
ALTER TABLE orders RENAME COLUMN amount_cents TO amount_cents;
```

Biasanya jangan rename lagi jika nama baru sudah eksplisit.

---

## 11. Pattern 4: Add NOT NULL Constraint Without Downtime

### 11.1 Problem

Kita ingin menambahkan kolom wajib:

```text
customer.region_code NOT NULL
```

Naive:

```sql
ALTER TABLE customer ADD region_code VARCHAR(20) NOT NULL;
```

Bisa gagal karena existing row.

### 11.2 Safe Steps

```text
1. Add nullable column
2. Deploy app that writes column for new rows
3. Backfill old rows
4. Validate no null remains
5. Add NOT NULL constraint
```

### 11.3 Migration 1: Expand

```sql
ALTER TABLE customer ADD region_code VARCHAR(20);
```

### 11.4 App Change

New customer insert wajib mengisi `region_code`.

### 11.5 Backfill

```sql
UPDATE customer
SET region_code = 'UNKNOWN'
WHERE region_code IS NULL;
```

Tetapi hati-hati: `'UNKNOWN'` bisa menjadi data debt. Jika business rule tidak valid, lebih baik backfill dari source yang benar.

### 11.6 Guard Query

```sql
SELECT COUNT(*)
FROM customer
WHERE region_code IS NULL;
```

### 11.7 Contract

```sql
ALTER TABLE customer ALTER COLUMN region_code SET NOT NULL;
```

DBMS-specific syntax berbeda.

---

## 12. Pattern 5: Introduce Unique Constraint Safely

### 12.1 Problem

Kita ingin memastikan `users.email` unique.

Naive:

```sql
ALTER TABLE users ADD CONSTRAINT uk_users_email UNIQUE (email);
```

Risiko:

- existing duplicate,
- concurrent duplicate write saat migration berjalan,
- lock besar,
- index creation lama.

### 12.2 Safe Strategy

```text
1. Detect duplicates
2. Clean/correct duplicates
3. Change app write path to prevent new duplicates
4. Add supporting index using online/concurrent strategy where possible
5. Add unique constraint
6. Monitor violation
```

### 12.3 Duplicate Detection

```sql
SELECT email, COUNT(*)
FROM users
WHERE email IS NOT NULL
GROUP BY email
HAVING COUNT(*) > 1;
```

### 12.4 App Guard Is Not Enough

Application-level check seperti:

```sql
SELECT COUNT(*) FROM users WHERE email = ?
```

lalu insert tidak cukup, karena race condition:

```text
T1 checks email: none
T2 checks email: none
T1 inserts
T2 inserts
```

Unique constraint tetap diperlukan.

### 12.5 Online Index Concern

Vendor berbeda:

- PostgreSQL: `CREATE UNIQUE INDEX CONCURRENTLY` punya batasan transaksi.
- Oracle: online index tersedia untuk banyak skenario, tetapi tetap perlu memahami lock dan license/edition concern pada beberapa fitur.
- MySQL/InnoDB: online DDL bergantung versi, operation, algorithm, dan lock mode.
- SQL Server: online index availability bergantung edition/versi dan operation.

Top-tier engineer tidak menulis generic statement tanpa tahu efek lock di DBMS target.

---

## 13. Pattern 6: Table Split Without Downtime

### 13.1 Problem

Table `customer` terlalu besar dan ingin dipisah:

```text
customer
- id
- name
- email
- address_line1
- address_line2
- city
- postal_code
```

Menjadi:

```text
customer
- id
- name
- email

customer_address
- customer_id
- address_line1
- address_line2
- city
- postal_code
```

### 13.2 Naive Migration

```sql
CREATE TABLE customer_address AS SELECT ... FROM customer;
ALTER TABLE customer DROP COLUMN address_line1;
ALTER TABLE customer DROP COLUMN address_line2;
ALTER TABLE customer DROP COLUMN city;
ALTER TABLE customer DROP COLUMN postal_code;
```

Ini breaking.

### 13.3 Expand Phase

```sql
CREATE TABLE customer_address (
    customer_id BIGINT NOT NULL,
    address_line1 VARCHAR(255),
    address_line2 VARCHAR(255),
    city VARCHAR(100),
    postal_code VARCHAR(20),
    PRIMARY KEY (customer_id)
);
```

Jangan drop column lama.

### 13.4 Backfill

```sql
INSERT INTO customer_address (
    customer_id,
    address_line1,
    address_line2,
    city,
    postal_code
)
SELECT
    id,
    address_line1,
    address_line2,
    city,
    postal_code
FROM customer
WHERE NOT EXISTS (
    SELECT 1
    FROM customer_address ca
    WHERE ca.customer_id = customer.id
);
```

Untuk table besar, gunakan batch/chunk.

### 13.5 Dual-Write

Saat update address:

```text
write old customer address columns
write new customer_address row
```

### 13.6 Dual-Read

Read logic:

```text
try read customer_address
fallback to customer old columns
```

### 13.7 Switch Read

Setelah backfill selesai:

```text
read only from customer_address
```

### 13.8 Stop Old Write

App release berikutnya:

```text
write only customer_address
```

### 13.9 Contract

```sql
ALTER TABLE customer DROP COLUMN address_line1;
ALTER TABLE customer DROP COLUMN address_line2;
ALTER TABLE customer DROP COLUMN city;
ALTER TABLE customer DROP COLUMN postal_code;
```

### 13.10 Critical Concern

Table split tidak hanya schema change. Ia mengubah:

- transaction boundary,
- join path,
- locking pattern,
- cache key,
- repository/API contract,
- reporting query,
- data ownership,
- foreign key model,
- audit model.

---

## 14. Pattern 7: Table Merge Without Downtime

### 14.1 Problem

Kita punya:

```text
customer_profile
customer_account
```

Ingin merge menjadi:

```text
customer
```

### 14.2 Expand

Buat table baru:

```sql
CREATE TABLE customer_new (
    id BIGINT PRIMARY KEY,
    profile_name VARCHAR(255),
    account_status VARCHAR(50),
    created_at TIMESTAMP NOT NULL
);
```

### 14.3 Backfill

```sql
INSERT INTO customer_new (id, profile_name, account_status, created_at)
SELECT p.id, p.name, a.status, p.created_at
FROM customer_profile p
JOIN customer_account a ON a.customer_id = p.id
WHERE NOT EXISTS (
    SELECT 1 FROM customer_new n WHERE n.id = p.id
);
```

### 14.4 Dual-Write

Writes to old tables and new table.

### 14.5 Read Switch

Aplikasi mulai membaca dari `customer_new`.

### 14.6 Contract

Setelah semua consumer pindah:

```text
rename customer_new to customer
or keep customer_new and avoid semantic rename churn
```

### 14.7 Warning

Merge table sering menyebabkan semantic compression. Jangan merge hanya karena ingin “lebih simpel”. Pastikan aggregate boundary benar.

---

## 15. Pattern 8: Status String to Lookup Table

### 15.1 Problem

Existing:

```text
case.status VARCHAR(50)
```

Nilai:

```text
DRAFT
SUBMITTED
APPROVED
REJECTED
```

Target:

```text
case.status_id -> case_status.id
```

### 15.2 Expand

```sql
CREATE TABLE case_status (
    id BIGINT PRIMARY KEY,
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    active_flag CHAR(1) NOT NULL
);

ALTER TABLE case ADD status_id BIGINT;
```

### 15.3 Seed Lookup

```sql
INSERT INTO case_status (id, code, name, active_flag)
VALUES (1, 'DRAFT', 'Draft', 'Y');

INSERT INTO case_status (id, code, name, active_flag)
VALUES (2, 'SUBMITTED', 'Submitted', 'Y');

INSERT INTO case_status (id, code, name, active_flag)
VALUES (3, 'APPROVED', 'Approved', 'Y');

INSERT INTO case_status (id, code, name, active_flag)
VALUES (4, 'REJECTED', 'Rejected', 'Y');
```

Dalam production, gunakan idempotent seed seperti Part 18.

### 15.4 Backfill

```sql
UPDATE case c
SET status_id = (
    SELECT s.id
    FROM case_status s
    WHERE s.code = c.status
)
WHERE c.status_id IS NULL;
```

### 15.5 Dual-Write

Saat status berubah:

```text
case.status = 'APPROVED'
case.status_id = 3
```

### 15.6 Read Switch

Read dari `status_id` join ke `case_status`, fallback ke `status`.

### 15.7 Contract

Setelah aman:

```sql
ALTER TABLE case DROP COLUMN status;
ALTER TABLE case ADD CONSTRAINT fk_case_status
    FOREIGN KEY (status_id) REFERENCES case_status(id);
```

Urutan FK bisa sebelum drop jika data valid dan lock aman.

---

## 16. Dual-Write: Necessary but Dangerous

Dual-write adalah alat transisi, bukan state permanen.

### 16.1 Risiko Dual-Write

| Risiko | Penjelasan |
|---|---|
| Partial write | Old column berhasil, new column gagal |
| Divergence | Nilai lama dan baru berbeda |
| Race condition | Dua writer update representation berbeda |
| Hidden logic drift | Satu path update tidak dual-write |
| Long transition | Tim lupa contract phase |
| Debug complexity | Data mana yang source of truth? |

### 16.2 Cara Mengurangi Risiko

- Dual-write dalam satu transaction bila satu database.
- Buat helper/repository terpusat.
- Hindari update SQL tersebar di banyak tempat.
- Tambahkan consistency check.
- Buat dashboard mismatch.
- Tentukan tanggal contract.
- Buat migration ticket sampai cleanup selesai.

### 16.3 Example Consistency Check

```sql
SELECT COUNT(*)
FROM customer
WHERE full_name IS DISTINCT FROM name;
```

Syntax `IS DISTINCT FROM` tidak tersedia di semua DBMS. Alternatif portable perlu menangani null manual.

---

## 17. Dual-Read: Fallback Harus Sementara

Dual-read sering terlihat seperti solusi aman:

```java
String value = newValue != null ? newValue : oldValue;
```

Tetapi jika dibiarkan permanen, aplikasi menyembunyikan data debt.

### 17.1 Good Dual-Read

```text
temporary
measured
with backfill progress
with removal plan
```

### 17.2 Bad Dual-Read

```text
permanent fallback
no metrics
no owner
no contract ticket
```

### 17.3 Recommended Practice

Tambahkan metric/log untuk fallback:

```java
if (row.getString("full_name") == null && row.getString("name") != null) {
    metrics.counter("customer.name.fallback_to_legacy").increment();
}
```

Jika metric sudah nol dalam periode aman, baru contract.

---

## 18. Backfill Placement: Migration Script, Java Migration, Batch Job, atau Application Lazy Migration?

Backfill bisa ditempatkan di beberapa tempat.

### 18.1 Di Flyway/Liquibase SQL Migration

Cocok jika:

- data kecil,
- transformasi sederhana,
- transaksi singkat,
- tidak butuh retry rumit,
- tidak mengganggu traffic.

Tidak cocok jika:

- jutaan row,
- long-running,
- butuh throttling,
- butuh checkpoint,
- parsing kompleks,
- perlu observability detail.

### 18.2 Di Java-Based Migration

Cocok jika:

- transformasi butuh logic Java,
- masih cukup deterministic,
- bisa selesai dalam deployment window,
- bisa diobservasi dengan baik.

Risiko:

- migration jadi terlalu lama,
- sulit retry granular,
- deployment blocked.

### 18.3 Di Batch Job Terpisah

Cocok untuk:

- data besar,
- perlu resume,
- perlu throttle,
- perlu progress dashboard,
- bisa berjalan setelah deployment.

Pattern:

```text
schema expand via Flyway/Liquibase
        |
        v
application deployed with dual-read/write
        |
        v
backfill job runs gradually
        |
        v
validation
        |
        v
contract migration later
```

### 18.4 Lazy Migration on Read

Aplikasi memperbaiki data saat record dibaca.

Cocok jika:

- akses data tersebar natural,
- consistency immediate tidak wajib,
- fallback aman,
- ada background sweeper untuk cold data.

Risiko:

- cold data tidak pernah termigrasi,
- read path jadi write path,
- latency meningkat,
- concurrency lebih rumit.

---

## 19. Rollback-Safe Migration

Zero-downtime migration harus memikirkan rollback.

Ada dua jenis rollback:

1. **Rollback aplikasi**: deploy app kembali ke versi sebelumnya.
2. **Rollback database**: mengembalikan schema/data ke bentuk sebelumnya.

Dalam production, rollback aplikasi jauh lebih umum daripada rollback database.

Karena itu expand/contract biasanya didesain agar:

```text
database moves forward
application can roll back
```

### 19.1 Release N: Expand

```text
DB: add new column
App: may still be v1
```

Rollback app aman karena old column masih ada.

### 19.2 Release N+1: App Uses New Column

```text
DB: old + new column
App: v2 reads/writes new column, maybe dual-write
```

Rollback app ke v1 masih aman karena old column masih ada dan masih ditulis.

### 19.3 Release N+2: Contract

```text
DB: old column dropped
App: v2+ only
```

Setelah ini rollback app ke v1 tidak aman.

Maka contract phase harus dilakukan hanya setelah organisasi menerima bahwa rollback ke v1 tidak lagi diperlukan.

---

## 20. Feature Flags and Migration Flags

Feature flag sering membantu migration, tetapi jangan menyelesaikan semua masalah dengan flag.

### 20.1 Useful Flags

- switch read path old/new,
- enable dual-write,
- enable new validation,
- enable new constraint enforcement at app level,
- route subset tenant/user to new path.

### 20.2 Dangerous Flags

- flag yang mengubah schema assumption secara tidak jelas,
- flag yang membuat data bisa ditulis ke dua model berbeda tanpa consistency check,
- flag yang tidak pernah dihapus,
- flag yang tidak sinkron antar service,
- flag yang dipakai untuk menggantikan migration contract.

### 20.3 Rule

Feature flag bisa mengontrol behaviour aplikasi, tetapi tidak boleh menjadi alasan untuk tidak mendesain compatibility database.

---

## 21. Flyway Implementation Strategy for Expand/Contract

Flyway secara natural cocok untuk forward-only versioned migration.

Contoh struktur:

```text
src/main/resources/db/migration/
  V2026_06_01_001__expand_customer_add_full_name.sql
  V2026_06_05_001__backfill_customer_full_name.sql
  V2026_06_20_001__contract_customer_drop_name.sql
```

### 21.1 Expand Migration

```sql
-- V2026_06_01_001__expand_customer_add_full_name.sql
ALTER TABLE customer ADD full_name VARCHAR(255);
```

### 21.2 Backfill Migration

```sql
-- V2026_06_05_001__backfill_customer_full_name.sql
UPDATE customer
SET full_name = name
WHERE full_name IS NULL
  AND name IS NOT NULL;
```

Untuk data besar, jangan gunakan update besar seperti ini. Gunakan job.

### 21.3 Contract Migration

```sql
-- V2026_06_20_001__contract_customer_drop_name.sql
ALTER TABLE customer DROP COLUMN name;
```

### 21.4 Naming Recommendation

Gunakan phase dalam nama migration:

```text
expand_...
backfill_...
switch_support_...
contract_...
```

Agar reviewer langsung tahu resikonya.

---

## 22. Liquibase Implementation Strategy for Expand/Contract

Liquibase bisa merepresentasikan phase dengan changeset dan label/context.

Example YAML:

```yaml
databaseChangeLog:
  - changeSet:
      id: 2026-06-01-001-expand-customer-add-full-name
      author: platform-team
      changes:
        - addColumn:
            tableName: customer
            columns:
              - column:
                  name: full_name
                  type: varchar(255)
```

Backfill:

```yaml
databaseChangeLog:
  - changeSet:
      id: 2026-06-05-001-backfill-customer-full-name
      author: platform-team
      changes:
        - sql:
            sql: |
              UPDATE customer
              SET full_name = name
              WHERE full_name IS NULL
                AND name IS NOT NULL;
```

Contract:

```yaml
databaseChangeLog:
  - changeSet:
      id: 2026-06-20-001-contract-customer-drop-name
      author: platform-team
      preConditions:
        onFail: HALT
        - sqlCheck:
            expectedResult: 0
            sql: |
              SELECT COUNT(*)
              FROM customer
              WHERE full_name IS NULL
                AND name IS NOT NULL
      changes:
        - dropColumn:
            tableName: customer
            columnName: name
```

Liquibase preconditions sangat berguna untuk contract phase.

---

## 23. Preconditions Before Contract

Sebelum contract, selalu validasi.

### 23.1 Column Rename Contract Preconditions

```sql
SELECT COUNT(*)
FROM customer
WHERE full_name IS NULL
  AND name IS NOT NULL;
```

Expected: `0`.

### 23.2 Dual-Write Consistency

```sql
SELECT COUNT(*)
FROM customer
WHERE
    (full_name IS NULL AND name IS NOT NULL)
    OR
    (full_name IS NOT NULL AND name IS NULL)
    OR
    (full_name <> name);
```

Need null-safe version per DBMS.

### 23.3 Application Usage Check

DB query saja tidak cukup. Pastikan:

- no old app instances running,
- no old job version running,
- no report depends on old object,
- no external ETL depends on old column,
- no stored procedure references old column,
- no manual script scheduled.

### 23.4 Code Search

Cari usage:

```text
name
customer.name
getName()
setName()
SELECT *
```

Jangan percaya grep mentah sepenuhnya karena ORM, reflection, query builder, report template, dan dynamic SQL bisa menyembunyikan dependency.

---

## 24. Observability During Expand/Contract

Migration zero-downtime tanpa observability adalah blind flight.

### 24.1 Metrics yang Berguna

| Metric | Tujuan |
|---|---|
| fallback read count | Mengetahui masih ada data lama |
| dual-write mismatch count | Deteksi divergence |
| backfill progress | Mengetahui completion |
| migration duration | Mengukur risk window |
| lock wait time | Deteksi blocking |
| rows updated per batch | Capacity planning |
| contract readiness | Go/no-go |

### 24.2 Example Backfill Progress Table

```sql
CREATE TABLE migration_progress (
    migration_name VARCHAR(100) PRIMARY KEY,
    last_processed_id BIGINT,
    total_processed BIGINT NOT NULL,
    last_updated_at TIMESTAMP NOT NULL
);
```

### 24.3 Example Readiness Query

```sql
SELECT
    COUNT(*) AS total_rows,
    SUM(CASE WHEN full_name IS NULL THEN 1 ELSE 0 END) AS missing_full_name
FROM customer;
```

### 24.4 Operational Dashboard

Minimal dashboard:

```text
migration_name
current_phase
started_at
last_progress_at
rows_processed
estimated_remaining
error_count
fallback_count
mismatch_count
contract_ready
```

---

## 25. Handling Partial Deployment

Dalam Kubernetes/rolling deployment, partial deployment normal.

```text
Pod A: old version
Pod B: old version
Pod C: new version
Pod D: new version
```

Jika new version hanya menulis new column sementara old version hanya membaca old column, data bisa hilang secara semantic.

### 25.1 Example Failure

```text
old app reads customer.name
new app writes only customer.full_name
old app displays stale name
```

### 25.2 Fix

During overlap:

```text
new app must keep old representation updated
```

Atau:

```text
old app must be fully drained before new write path activated
```

Tetapi pilihan kedua sulit jika deployment rollback/canary diperlukan.

---

## 26. Handling Multiple Services

Multi-service membuat expand/contract lebih sulit.

```text
service-a v1/v2 ----\
service-b v1/v2 -----> shared table
service-c v1/v2 ----/
```

Perubahan table tidak boleh hanya mempertimbangkan satu service.

### 26.1 Compatibility Contract

Buat contract eksplisit:

```text
Column customer.name remains available until:
- service-a >= 2.4 deployed to prod
- service-b >= 5.1 deployed to prod
- reporting job migrated
- ETL v3 migrated
- fallback metric zero for 14 days
```

### 26.2 Shared Database Warning

Jika banyak service berbagi schema, expand/contract menjadi wajib lebih sering. Ini salah satu alasan architectural preference: service owning its own schema.

---

## 27. Handling ORM/Hibernate/JPA During Expand/Contract

Karena seri JPA/Hibernate sudah dibahas sebelumnya, bagian ini hanya fokus pada migration concern.

### 27.1 ORM Auto-DDL Must Not Own Production Schema

Untuk serious system:

```properties
spring.jpa.hibernate.ddl-auto=validate
```

atau disabled/validate sesuai kebutuhan. Jangan biarkan Hibernate melakukan destructive schema change otomatis di production.

### 27.2 Entity Mapping During Expand

Jika kolom baru ditambahkan nullable:

```java
@Column(name = "full_name")
private String fullName;
```

Pastikan old column masih ada jika old app masih hidup.

### 27.3 Avoid Immediate Removal

Jangan langsung hapus field lama dari semua model jika masih perlu dual-write.

Temporary entity bisa memiliki keduanya:

```java
@Column(name = "name")
private String legacyName;

@Column(name = "full_name")
private String fullName;
```

### 27.4 Beware Dirty Checking

Jika entity memuat old dan new field, dirty checking bisa menghasilkan update yang tidak diharapkan. Lebih aman untuk migration-sensitive write menggunakan explicit SQL/repository method.

---

## 28. Handling `SELECT *` and Result Mapping

`SELECT *` memperburuk migration.

### 28.1 Problem

Tambah kolom mungkin terlihat aman, tetapi bisa merusak:

- brittle row mapper berdasarkan index,
- CSV export berdasarkan posisi kolom,
- legacy report,
- stored procedure result expectation,
- ORM native query mapping.

### 28.2 Rule

Untuk production-grade migration:

```text
Avoid SELECT * in application-owned queries.
Always select explicit columns for stable contracts.
```

### 28.3 Migration Review Checklist

Sebelum drop/rename column:

- cari `SELECT *`,
- cari native queries,
- cari report definitions,
- cari stored procedures,
- cari ETL scripts,
- cari BI/dashboard usage.

---

## 29. Constraint Introduction Without Breaking Old App

Menambah constraint berarti mengubah rule database. Old app mungkin belum memenuhi rule tersebut.

### 29.1 Example

Tambahkan constraint:

```text
order.status must be one of valid statuses
```

Jika old app masih bisa menulis status invalid, migration akan membuat old app error.

### 29.2 Safe Flow

```text
1. Add app-level validation in old/new compatible way
2. Clean existing invalid data
3. Monitor invalid write attempts
4. Add database constraint
5. Keep app validation
```

### 29.3 Check Constraint Example

```sql
ALTER TABLE orders ADD CONSTRAINT chk_orders_status
CHECK (status IN ('DRAFT', 'SUBMITTED', 'PAID', 'CANCELLED'));
```

Untuk beberapa DBMS, constraint bisa dibuat `NOT VALID` lalu divalidasi kemudian. Gunakan fitur vendor-specific jika tersedia.

---

## 30. Index Introduction Without Downtime

Index creation bisa mahal.

### 30.1 Naive

```sql
CREATE INDEX idx_orders_created_at ON orders(created_at);
```

Pada table besar, ini bisa:

- memakan CPU/IO,
- memblokir write,
- menahan lock,
- mengganggu replication,
- memperlambat query production.

### 30.2 Safe Considerations

- Apakah DBMS mendukung online/concurrent index?
- Apakah statement boleh berjalan dalam transaction?
- Apakah migration tool membungkus statement dalam transaction?
- Apakah index creation bisa dihentikan aman?
- Apakah ada maintenance window?
- Apakah sudah diuji pada volume data realistis?

### 30.3 PostgreSQL Example Concern

`CREATE INDEX CONCURRENTLY` tidak boleh dijalankan dalam transaction block. Dengan Flyway, migration tertentu mungkin perlu konfigurasi non-transactional sesuai kebutuhan.

### 30.4 Oracle Example Concern

Oracle memiliki operasi online untuk beberapa DDL, tetapi tetap perlu memahami lock, undo, redo, parallelism, dan efek ke workload.

### 30.5 Rule

Index migration adalah performance operation sekaligus schema operation. Perlakukan seperti production capacity change.

---

## 31. Foreign Key Introduction Without Downtime

Menambah foreign key ke table besar bisa berat.

### 31.1 Safe Flow

```text
1. Add nullable FK column if needed
2. Backfill FK values
3. Detect orphan rows
4. Clean orphan rows
5. Add index on FK column
6. Add FK constraint using vendor-safe validation strategy
7. Validate constraint
```

### 31.2 Orphan Detection

```sql
SELECT child.parent_id
FROM child
LEFT JOIN parent ON parent.id = child.parent_id
WHERE child.parent_id IS NOT NULL
  AND parent.id IS NULL;
```

### 31.3 Application Compatibility

Jika old app masih bisa insert orphan, FK introduction akan membuat old app gagal. Jadi app-level write path harus diperbaiki sebelum constraint database ditambahkan.

---

## 32. Data Correctness During Transition

Saat old dan new representation hidup bersama, tentukan source of truth per fase.

### 32.1 Example Source of Truth Timeline

| Phase | Source of Truth | Notes |
|---|---|---|
| Initial | `name` | Only old column exists |
| Expand | `name` | `full_name` being introduced |
| Backfill | `name` mostly | `full_name` catching up |
| Dual-write | both must match | mismatch monitored |
| Read switch | `full_name` | fallback temporary |
| Contract | `full_name` | old column removed |

Tanpa source-of-truth definition, bug akan sulit diputuskan.

---

## 33. Example: End-to-End Column Rename Release Plan

### 33.1 Business Requirement

Rename `applicant.mobile_no` menjadi `applicant.phone_number`.

### 33.2 Release R1 — Expand

Migration:

```sql
ALTER TABLE applicant ADD phone_number VARCHAR(30);
```

App:

- masih membaca `mobile_no`,
- saat update, tulis `mobile_no` dan `phone_number`,
- saat insert, tulis keduanya.

### 33.3 R1 Validation

```sql
SELECT COUNT(*)
FROM applicant
WHERE phone_number IS NULL
  AND mobile_no IS NOT NULL;
```

### 33.4 Release R2 — Backfill and Dual-Read

Backfill:

```sql
UPDATE applicant
SET phone_number = mobile_no
WHERE phone_number IS NULL
  AND mobile_no IS NOT NULL;
```

App:

- read `phone_number`, fallback `mobile_no`,
- keep dual-write.

Metrics:

```text
applicant.phone_number.fallback.count
applicant.phone_number.mismatch.count
```

### 33.5 Release R3 — New Source of Truth

App:

- read `phone_number`,
- write `phone_number`,
- optionally still write `mobile_no` for rollback safety.

### 33.6 Release R4 — Stop Legacy Write

App:

- stop writing `mobile_no`,
- no old app remains.

### 33.7 Release R5 — Contract

Precondition:

```sql
SELECT COUNT(*)
FROM applicant
WHERE phone_number IS NULL
  AND mobile_no IS NOT NULL;
```

Expected `0`.

Migration:

```sql
ALTER TABLE applicant DROP COLUMN mobile_no;
```

### 33.8 Why So Many Releases?

Karena each release reduces one kind of risk:

| Release | Risk Reduced |
|---|---|
| R1 | Schema available before app needs it |
| R2 | Historical data compatible |
| R3 | New read path proven |
| R4 | Legacy write removed |
| R5 | Old schema safely cleaned |

Dalam sistem kecil, bisa dipadatkan. Dalam sistem kritikal, pemisahan ini membuat operasi defensible.

---

## 34. Example: End-to-End Table Split Release Plan

### 34.1 Requirement

Split `case` table:

```text
case
- id
- case_no
- status
- officer_id
- decision_reason
- decision_date
```

Target:

```text
case_main
- id
- case_no
- status
- officer_id

case_decision
- case_id
- decision_reason
- decision_date
```

### 34.2 Release R1 — Expand

```sql
CREATE TABLE case_decision (
    case_id BIGINT PRIMARY KEY,
    decision_reason CLOB,
    decision_date TIMESTAMP
);
```

### 34.3 Release R2 — Backfill

```sql
INSERT INTO case_decision (case_id, decision_reason, decision_date)
SELECT id, decision_reason, decision_date
FROM case
WHERE decision_reason IS NOT NULL
   OR decision_date IS NOT NULL;
```

For large CLOB data, avoid one huge insert if it causes undo/redo/LOB pressure.

### 34.4 Release R3 — Dual-Write

When decision updated:

```text
update case.decision_reason / decision_date
upsert case_decision
```

### 34.5 Release R4 — Read Switch

Read decision from `case_decision`, fallback to `case`.

### 34.6 Release R5 — Stop Legacy Write

Only write `case_decision`.

### 34.7 Release R6 — Contract

Drop old columns from `case`.

### 34.8 Special Concern

If `decision_reason` is CLOB, contract phase may not immediately reclaim storage depending on DBMS. Dropping column or moving/shrinking segments may have storage implications. Treat storage reclaim as separate operational work, not automatic assumption.

---

## 35. Go/No-Go Checklist for Contract Phase

Sebelum contract:

```text
[ ] All app instances are on compatible version.
[ ] No rollback to incompatible old app is expected.
[ ] Backfill completed.
[ ] Consistency check passed.
[ ] Fallback metric is zero or accepted.
[ ] No known old report/ETL/job uses old object.
[ ] Database dependency search completed.
[ ] Migration tested from production-like previous version.
[ ] Backup/restore or roll-forward plan exists.
[ ] Lock impact understood.
[ ] Maintenance window or safe execution window approved if needed.
[ ] Monitoring enabled.
[ ] Communication plan ready.
```

---

## 36. Common Anti-Patterns

### 36.1 Rename Directly in One Migration

```sql
ALTER TABLE customer RENAME COLUMN name TO full_name;
```

Bad when old app may still run.

### 36.2 Drop Old Column in Same Release

```text
Release N:
  add full_name
  app uses full_name
  drop name
```

Rollback app becomes unsafe.

### 36.3 Backfill Huge Table During App Startup

Bad because:

- startup times out,
- deployment blocked,
- lock pressure,
- hard to observe,
- hard to resume.

### 36.4 Permanent Dual-Write

Dual-write is transition debt. If permanent, it becomes data consistency liability.

### 36.5 Contract Without Consumer Inventory

Dropping a column without checking reports/jobs/ETL is a common enterprise incident pattern.

### 36.6 Feature Flag Without Schema Compatibility

Flag can switch code path, but cannot make old app understand dropped column.

### 36.7 Migration Tool as Safety Substitute

Flyway/Liquibase can order and record migrations. They cannot magically make breaking changes safe.

---

## 37. Review Questions

Gunakan pertanyaan ini saat mereview migration PR:

1. Apakah perubahan ini backward-compatible dengan app versi sebelumnya?
2. Apakah perubahan ini forward-compatible dengan app versi baru?
3. Apakah old dan new app bisa berjalan bersamaan?
4. Apakah rollback app masih aman setelah migration ini?
5. Apakah migration ini mengubah source of truth?
6. Apakah ada phase expand, backfill, switch, contract?
7. Apakah contract dilakukan terlalu cepat?
8. Apakah backfill terlalu besar untuk deployment window?
9. Apakah ada consistency check?
10. Apakah ada fallback metric?
11. Apakah semua consumer database sudah diketahui?
12. Apakah lock impact sudah diuji?
13. Apakah constraint/index dibuat dengan strategi online jika perlu?
14. Apakah migration bisa diulang/retry jika gagal sebagian?
15. Apakah ada runbook jika migration berhasil tetapi app gagal deploy?

---

## 38. Practical Design Template

Gunakan template ini untuk migration besar.

```markdown
# Migration Design: <name>

## Business Goal
<why this change is needed>

## Current Schema
<current table/column/index/constraint>

## Target Schema
<final desired shape>

## Breaking Change Analysis
- Old app impact:
- New app impact:
- Reporting/ETL impact:
- Job impact:
- Stored procedure impact:

## Compatibility Matrix
| App | Schema | Compatible? | Notes |
|---|---|---:|---|

## Phase Plan
### Phase 1: Expand
- Migration files:
- App changes:
- Rollback safety:

### Phase 2: Backfill
- Strategy:
- Batch size:
- Progress marker:
- Validation:

### Phase 3: Switch
- Read path:
- Write path:
- Feature flag:
- Metrics:

### Phase 4: Contract
- Preconditions:
- Migration files:
- Rollback implication:

## Observability
- Metrics:
- Logs:
- Dashboard:
- Alerts:

## Risks
- Locking:
- Data mismatch:
- Partial deployment:
- Rollback:

## Go/No-Go Criteria
- Before expand:
- Before switch:
- Before contract:
```

---

## 39. Java Version Considerations: Java 8 to Java 25

The expand/contract pattern is mostly independent of Java version, but implementation style differs.

### 39.1 Java 8

- No text blocks.
- More verbose JDBC code.
- Older Spring Boot/Flyway/Liquibase compatibility may constrain tool versions.
- Be careful with old drivers and timestamp/timezone handling.

### 39.2 Java 11

- Better runtime baseline for many enterprise systems.
- Still common in legacy production.
- Tooling compatibility generally better than Java 8.

### 39.3 Java 17

- Modern LTS baseline.
- Many current frameworks and tools increasingly target Java 17+.
- Liquibase 5.x requires Java 17+.

### 39.4 Java 21

- Modern LTS for current Spring Boot/Jakarta systems.
- Virtual threads may help background backfill jobs, but database concurrency still must be throttled.
- Do not confuse cheap Java threads with unlimited DB capacity.

### 39.5 Java 25

- Newer LTS generation.
- Same migration principles apply.
- Tool compatibility must be checked before adopting latest runtime in migration pipeline.

---

## 40. Key Takeaways

1. Zero-downtime migration is not mainly about SQL syntax; it is about compatibility over time.
2. Database schema is a contract consumed by old app, new app, jobs, reports, ETL, and sometimes other services.
3. Breaking changes should usually be split into expand, backfill, switch, and contract phases.
4. Rename is not rename; it is add-copy-dual-write-dual-read-switch-drop.
5. Drop is the final phase, not the first cleanup instinct.
6. Rollback-safe database migration usually means database moves forward while app can roll back.
7. Dual-write and dual-read are transitional tools, not permanent architecture.
8. Contract phase needs stronger evidence than expand phase.
9. Flyway and Liquibase execute migrations; they do not replace migration design.
10. Top-tier migration engineering is about making change safe under partial deployment, concurrency, lock pressure, and human rollback decisions.

---

## 41. What Comes Next

Part berikutnya:

```text
21-database-locking-transactions-online-ddl.md
```

Bagian berikutnya akan membahas hal yang sering menjadi penyebab nyata migration incident: locking, transaction boundary, metadata lock, online DDL, concurrent index, statement timeout, lock timeout, dan bagaimana setiap DBMS memperlakukan DDL secara berbeda.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: 19 — Data Migration and Backfill Engineering](./19-data-migration-backfill-engineering.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: 21 — Database Locking, Transactions, and Online DDL](./21-database-locking-transactions-online-ddl.md)

</div>