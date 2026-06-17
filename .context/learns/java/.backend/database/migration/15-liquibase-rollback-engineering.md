# Part 15 — Liquibase Rollback Engineering

**Series:** `learn-java-database-migrations-seedings-flyway-liquibase`  
**File:** `15-liquibase-rollback-engineering.md`  
**Scope:** Java 8–25, Liquibase 4.x/5.x, Spring Boot, Jakarta EE, plain Java, CI/CD, production database governance  
**Prerequisite:** Part 11–14: Liquibase mental model, setup, changelog design, preconditions, contexts, and labels

---

## 0. Tujuan Pembelajaran

Setelah bagian ini, kita ingin punya mental model yang jauh lebih matang tentang rollback database.

Bukan hanya tahu bahwa Liquibase punya fitur:

```bash
liquibase rollbackCount 1
liquibase rollbackToTag release-2026-06-17
liquibase rollbackSQL release-2026-06-17
```

Tetapi paham:

1. kapan rollback database masuk akal;
2. kapan rollback database berbahaya;
3. kapan rollback secara teknis mungkin tetapi secara bisnis salah;
4. kapan strategi terbaik justru roll-forward;
5. bagaimana menulis rollback block yang benar;
6. bagaimana menguji rollback;
7. bagaimana menyusun runbook production;
8. bagaimana menghubungkan rollback dengan release aplikasi, data integrity, auditability, dan compliance.

Engineer biasa berpikir:

> “Kalau migration gagal, rollback saja.”

Engineer senior berpikir:

> “Rollback apa? Schema? Data? Code? Contract? Runtime traffic? External integration? Audit evidence? Apakah rollback tidak menghapus data production yang sudah diterima user?”

Itulah level berpikir yang ingin kita bentuk.

---

## 1. Core Mental Model: Rollback Database Bukan Undo Button

Dalam version control code, rollback biasanya terlihat sederhana:

```text
new code bad → redeploy old code
```

Database berbeda, karena database adalah **stateful shared mutable system**.

Code artifact bisa diganti. Database menyimpan fakta, transaksi, histori, audit, dan state bisnis.

Contoh sederhana:

```sql
ALTER TABLE customer ADD COLUMN email_verified BOOLEAN DEFAULT FALSE;
```

Rollback teknisnya terlihat mudah:

```sql
ALTER TABLE customer DROP COLUMN email_verified;
```

Namun setelah deployment berjalan 2 jam:

- user sudah melakukan verifikasi email;
- service sudah mengisi `email_verified = true`;
- downstream report sudah membaca field tersebut;
- audit trail sudah mencatat perubahan;
- customer support sudah melihat status baru;
- API client mungkin sudah bergantung pada field ini.

Maka rollback dengan `DROP COLUMN` bukan hanya membatalkan schema. Itu menghapus fakta baru.

Jadi rollback database harus dipahami sebagai kombinasi dari empat lapisan:

```text
┌──────────────────────────────────────────────┐
│  Application rollback                         │
│  Apakah old code masih bisa berjalan?          │
└──────────────────────────────────────────────┘
┌──────────────────────────────────────────────┐
│  Schema rollback                              │
│  Apakah struktur DB bisa dikembalikan?         │
└──────────────────────────────────────────────┘
┌──────────────────────────────────────────────┐
│  Data rollback                                │
│  Apakah perubahan data bisa dibalik aman?      │
└──────────────────────────────────────────────┘
┌──────────────────────────────────────────────┐
│  Business contract rollback                   │
│  Apakah sistem bisnis boleh kembali ke state lama?│
└──────────────────────────────────────────────┘
```

Sering kali, yang mudah hanya schema rollback. Yang sulit adalah data dan business contract.

---

## 2. Liquibase Rollback Vocabulary

Liquibase menyediakan beberapa cara rollback:

1. **Automatic rollback**
2. **Explicit rollback block**
3. **Rollback by count**
4. **Rollback by tag**
5. **Rollback to date**
6. **Rollback SQL generation**
7. **Rollback one changeset**
8. **Future rollback SQL**
9. **Tagging database state**

Kita perlu memahami bahwa fitur-fitur ini adalah **mechanism**, bukan strategy.

Tool bisa menjalankan rollback. Tool tidak bisa memutuskan apakah rollback aman secara bisnis.

---

## 3. Automatic Rollback

Liquibase punya beberapa change type yang bisa menghasilkan rollback otomatis.

Contoh XML:

```xml
<changeSet id="001-create-customer-table" author="fajar">
    <createTable tableName="customer">
        <column name="id" type="BIGINT">
            <constraints primaryKey="true" nullable="false"/>
        </column>
        <column name="name" type="VARCHAR(255)">
            <constraints nullable="false"/>
        </column>
    </createTable>
</changeSet>
```

Untuk `createTable`, rollback otomatis biasanya bisa menjadi:

```sql
DROP TABLE customer;
```

Secara teknis bisa. Tetapi apakah aman?

Kalau table baru belum dipakai, mungkin aman. Kalau sudah berisi data production, `DROP TABLE` sangat berbahaya.

### 3.1 Automatic Rollback Tidak Sama Dengan Safe Rollback

Automatic rollback menjawab:

> “Apa operasi kebalikan dari change ini?”

Bukan:

> “Apakah operasi kebalikan ini aman dijalankan di production?”

Contoh:

| Change | Auto rollback mungkin | Aman? |
|---|---:|---:|
| create table kosong | drop table | mungkin |
| create table sudah terisi data | drop table | biasanya tidak |
| add nullable column | drop column | tergantung data |
| create index | drop index | biasanya aman, tapi bisa berdampak performance |
| add FK constraint | drop FK | bisa aman, tapi melemahkan integrity |
| insert seed role | delete seed role | berbahaya jika sudah dipakai user |

Kesalahan umum: mengira karena Liquibase bisa rollback otomatis, berarti desain migration sudah production-grade.

---

## 4. Explicit Rollback Block

Rollback block adalah instruksi eksplisit untuk membatalkan changeset.

Contoh XML:

```xml
<changeSet id="002-add-customer-status" author="fajar">
    <addColumn tableName="customer">
        <column name="status" type="VARCHAR(30)" defaultValue="ACTIVE">
            <constraints nullable="false"/>
        </column>
    </addColumn>

    <rollback>
        <dropColumn tableName="customer" columnName="status"/>
    </rollback>
</changeSet>
```

Contoh YAML:

```yaml
databaseChangeLog:
  - changeSet:
      id: 002-add-customer-status
      author: fajar
      changes:
        - addColumn:
            tableName: customer
            columns:
              - column:
                  name: status
                  type: varchar(30)
                  defaultValue: ACTIVE
                  constraints:
                    nullable: false
      rollback:
        - dropColumn:
            tableName: customer
            columnName: status
```

Contoh formatted SQL:

```sql
--liquibase formatted sql

--changeset fajar:002-add-customer-status
ALTER TABLE customer ADD status VARCHAR(30) DEFAULT 'ACTIVE' NOT NULL;
--rollback ALTER TABLE customer DROP COLUMN status;
```

Rollback block membuat niat engineer eksplisit.

Namun tetap ada pertanyaan:

- apakah column tersebut sudah berisi data baru?
- apakah old application bisa berjalan tanpa column itu?
- apakah ada object lain yang bergantung pada column itu?
- apakah ada index, constraint, trigger, view, procedure, report, atau ETL yang membaca column itu?
- apakah rollback dilakukan saat traffic masih berjalan?

Rollback block adalah starting point. Bukan akhir analisis.

---

## 5. Rollback Count

Rollback count membatalkan sejumlah changeset terakhir.

Contoh:

```bash
liquibase rollbackCount 1
```

Artinya: rollback satu changeset terakhir yang sudah tercatat di `DATABASECHANGELOG`.

Atau:

```bash
liquibase rollbackCount 3
```

Artinya: rollback tiga changeset terakhir.

### 5.1 Kapan Rollback Count Berguna?

Rollback count berguna untuk:

- local development;
- automated test;
- migration experiment;
- sandbox environment;
- very controlled release branch;
- changeset kecil yang baru saja dijalankan dan belum dipakai aplikasi.

### 5.2 Mengapa Rollback Count Berbahaya di Production?

Rollback count bergantung pada urutan terakhir changeset yang teraplikasi.

Dalam production, urutan ini bisa dipengaruhi oleh:

- hotfix;
- out-of-order changeset;
- branch merge;
- manual tag;
- multiple module changelog;
- context/label filtering;
- partial deployment;
- changeset dari tim lain.

Contoh:

```text
Applied changesets:
001-create-customer
002-add-email
003-add-order
004-hotfix-index
005-add-permission-seed
```

Jika release yang ingin dibatalkan adalah `003-add-order`, tetapi setelah itu ada hotfix `004` dan seed `005`, maka `rollbackCount 3` membatalkan lebih dari yang dimaksud.

Rollback count cocok untuk lab. Untuk production, rollback by tag biasanya lebih defensible.

---

## 6. Rollback to Tag

Tag adalah marker pada state database tertentu.

Contoh:

```bash
liquibase tag release-2026-06-17-before-payment-v2
```

Setelah beberapa migration, kita bisa rollback ke tag tersebut:

```bash
liquibase rollback release-2026-06-17-before-payment-v2
```

Atau menghasilkan SQL tanpa menjalankannya:

```bash
liquibase rollbackSQL release-2026-06-17-before-payment-v2
```

### 6.1 Tag sebagai Release Boundary

Tag harus dipakai sebagai boundary yang bermakna:

```text
before-release-2026-06-17
release-2026-06-17-applied
before-hotfix-ACEAS-3182
before-contract-phase-customer-status
```

Jangan membuat tag seperti:

```text
tag1
test
backup
latest
prod
```

Nama tag harus bisa menjawab:

- ini dibuat kapan?
- dibuat sebelum atau sesudah release apa?
- release ticket mana?
- tujuannya apa?
- apakah aman untuk rollback ke sini?

### 6.2 Tagging Pattern

Pattern umum:

```bash
# sebelum migration production
liquibase tag before-release-2026-06-17-payment-v2

# jalankan migration
liquibase update

# optional setelah sukses
liquibase tag after-release-2026-06-17-payment-v2
```

Namun ada nuance penting.

Jika kita menaruh tag **sebelum** release, rollback ke tag tersebut akan membatalkan changeset release.

Jika kita menaruh tag **sesudah** release, tag tersebut menjadi marker bahwa release sudah sukses.

Untuk production, biasanya kita butuh dua jenis marker:

```text
before-release-X  → rollback target jika release gagal cepat
after-release-X   → audit marker bahwa release X selesai
```

---

## 7. Rollback to Date

Liquibase juga dapat rollback ke waktu tertentu.

Contoh konseptual:

```bash
liquibase rollbackToDate "2026-06-17T10:00:00"
```

Rollback to date lebih rapuh dibanding tag karena waktu bukan boundary release yang semantik.

Masalah:

- timezone;
- clock skew;
- deployment lama;
- beberapa changeset dari release berbeda berjalan berdekatan;
- manual operation di sela-sela;
- audit interpretability rendah.

Production-grade engineer lebih suka tag daripada date.

Date berguna untuk:

- forensic analysis;
- sandbox;
- test automation;
- emergency jika tag tidak tersedia;
- environment non-prod.

---

## 8. Rollback SQL Generation

Salah satu fitur paling penting adalah menghasilkan SQL rollback tanpa menjalankannya.

```bash
liquibase rollbackSQL before-release-2026-06-17-payment-v2
```

Atau:

```bash
liquibase rollbackCountSQL 2
```

Rollback SQL generation berguna untuk:

- review DBA;
- approval gate;
- change advisory board;
- audit evidence;
- dry run;
- production runbook;
- incident preparation;
- memastikan rollback block benar;
- melihat apakah ada destructive rollback.

### 8.1 Rule: Never Trust Rollback You Have Not Read

Sebelum production, minimal baca rollback SQL.

Checklist:

- Apakah ada `DROP TABLE`?
- Apakah ada `DROP COLUMN`?
- Apakah ada `DELETE` tanpa predicate natural key?
- Apakah ada update massal tanpa backup?
- Apakah ada constraint drop yang melemahkan integrity?
- Apakah ada index drop yang bisa menghancurkan performance?
- Apakah rollback SQL vendor-compatible?
- Apakah rollback SQL berjalan dalam transaction?
- Apakah rollback butuh downtime?

Rollback yang tidak pernah dibaca adalah asumsi, bukan rencana.

---

## 9. Rollback One Changeset

Liquibase mendukung operasi untuk rollback satu changeset tertentu dalam beberapa mode/command tergantung versi dan command set yang dipakai.

Secara konseptual, rollback satu changeset menjawab:

> “Saya ingin membatalkan perubahan spesifik, bukan semua perubahan setelahnya.”

Namun ini harus dipakai sangat hati-hati.

Misalnya urutan:

```text
001-create-customer
002-add-email
003-create-index-on-email
004-add-email-verification
```

Jika kita rollback `002-add-email` saja, maka `003` dan `004` bisa rusak karena bergantung pada column `email`.

Rollback satu changeset aman hanya jika:

- tidak ada changeset setelahnya yang bergantung pada object tersebut;
- dependency sudah dipahami;
- SQL rollback sudah direview;
- migration graph tidak hanya linear secara waktu, tetapi valid secara dependency.

Liquibase mengeksekusi changeset berdasarkan changelog, tetapi dependency semantik tetap tanggung jawab engineer.

---

## 10. Rollback vs Roll-Forward

Ini bagian paling penting.

Dalam banyak sistem production modern, terutama zero-downtime dan high-availability, strategi terbaik bukan rollback database, tetapi roll-forward.

### 10.1 Rollback

Rollback berarti mengembalikan database ke state sebelumnya.

Contoh:

```text
add column → drop column
insert seed → delete seed
create table → drop table
```

Kelebihan:

- kembali ke model lama;
- cocok untuk perubahan belum dipakai;
- cocok untuk failure cepat setelah migration;
- cocok di non-prod.

Kekurangan:

- bisa menghapus data;
- bisa tidak kompatibel dengan traffic yang sudah masuk;
- bisa merusak audit/history;
- bisa lebih berisiko daripada perubahan awal;
- sering butuh downtime.

### 10.2 Roll-Forward

Roll-forward berarti memperbaiki masalah dengan migration baru.

Contoh:

```text
V10 add wrong nullable column
V11 fix column default and backfill missing rows
```

Atau:

```text
release adds status values incorrectly
next migration corrects invalid status mapping
```

Kelebihan:

- mempertahankan histori;
- lebih audit-friendly;
- tidak menghapus data baru;
- cocok untuk production yang sudah menerima traffic;
- cocok untuk migration history immutable.

Kekurangan:

- butuh diagnosis cepat;
- butuh desain fix yang kompatibel;
- tidak selalu bisa jika schema benar-benar breaking;
- bisa meninggalkan technical debt sementara.

### 10.3 Rule of Thumb

```text
Jika perubahan belum dipakai dan rollback tidak menghapus fakta bisnis:
    rollback mungkin aman.
Jika perubahan sudah dipakai atau menghasilkan data baru:
    roll-forward biasanya lebih aman.
Jika perubahan menghancurkan compatibility old/new app:
    rollback code saja mungkin gagal.
Jika migration partially applied:
    recovery dulu, baru putuskan rollback/roll-forward.
```

---

## 11. Schema Rollback vs Data Rollback

Kita harus membedakan dua hal ini.

### 11.1 Schema Rollback

Contoh:

```sql
ALTER TABLE customer DROP COLUMN middle_name;
```

Schema rollback mengubah struktur.

Risiko:

- object dependency;
- lock;
- invalid view/procedure;
- application compatibility;
- metadata cache;
- ORM mapping mismatch.

### 11.2 Data Rollback

Contoh:

```sql
UPDATE customer SET status = old_status;
```

Data rollback mengubah isi.

Risiko:

- kehilangan update baru;
- race condition dengan traffic berjalan;
- audit inconsistency;
- business event sudah terkirim;
- downstream sudah consume data lama/baru;
- tidak tahu old value jika tidak disimpan.

Data rollback hampir selalu lebih sulit daripada schema rollback.

---

## 12. The Irreversibility Spectrum

Tidak semua change punya tingkat reversibility yang sama.

| Change type | Reversibility | Catatan |
|---|---:|---|
| Create empty index | High | Drop index relatif aman, tapi perhatikan performance |
| Add nullable column | Medium-high | Drop column aman hanya jika belum dipakai |
| Add table not used yet | Medium-high | Drop table aman hanya jika kosong/tidak dipakai |
| Add lookup seed | Medium | Delete seed berbahaya jika sudah direferensi |
| Rename column directly | Medium-low | Old app bisa rusak |
| Change type widening | Medium | Contoh varchar(50) ke varchar(100) relatif aman |
| Change type narrowing | Low | Bisa truncate/invalid data |
| Drop column | Very low | Data hilang kecuali backup/shadow |
| Drop table | Very low | Data hilang |
| Backfill destructive | Very low | Butuh old value untuk balik |
| Merge records | Very low | Sulit memisah lagi tanpa mapping |
| Hash/encrypt irreversible | Very low | Plain value hilang |

Senior engineer selalu menilai reversibility sebelum migration ditulis.

---

## 13. Explicit Rollback Patterns

### 13.1 Pattern: Safe Index Rollback

```xml
<changeSet id="010-create-idx-customer-email" author="fajar">
    <createIndex indexName="idx_customer_email" tableName="customer">
        <column name="email"/>
    </createIndex>

    <rollback>
        <dropIndex indexName="idx_customer_email" tableName="customer"/>
    </rollback>
</changeSet>
```

Ini relatif aman secara data. Namun tidak selalu aman secara performance, karena query bisa menjadi lambat setelah index dihapus.

Rollback review tetap harus bertanya:

- apakah index sudah dipakai query production?
- apakah rollback akan menyebabkan query timeout?
- apakah index dibuat untuk memperbaiki incident performance?

### 13.2 Pattern: Add Nullable Column With Drop Rollback

```xml
<changeSet id="011-add-customer-preferred-language" author="fajar">
    <addColumn tableName="customer">
        <column name="preferred_language" type="VARCHAR(10)"/>
    </addColumn>

    <rollback>
        <dropColumn tableName="customer" columnName="preferred_language"/>
    </rollback>
</changeSet>
```

Aman jika column belum dipakai.

Tidak aman jika user sudah mengisi preference.

### 13.3 Pattern: Add Column Without Destructive Rollback

Kadang rollback harus sengaja dibuat non-destructive.

```xml
<changeSet id="012-add-customer-preferred-language" author="fajar">
    <addColumn tableName="customer">
        <column name="preferred_language" type="VARCHAR(10)"/>
    </addColumn>

    <rollback>
        <sql>
            -- Non-destructive rollback: keep column to preserve production data.
            -- Application rollback must ignore this column.
        </sql>
    </rollback>
</changeSet>
```

Ini terlihat aneh, tapi sering benar untuk production.

Kenapa?

Karena rollback aplikasi ke versi lama mungkin tidak masalah jika column ekstra tetap ada.

Dalam expand/contract pattern, column tambahan sebaiknya tidak langsung dihapus saat rollback. Old application biasanya bisa mengabaikan column yang tidak dipakai.

### 13.4 Pattern: Seed Insert Rollback by Natural Key

```xml
<changeSet id="020-seed-role-appeal-reviewer" author="fajar">
    <insert tableName="role">
        <column name="code" value="APPEAL_REVIEWER"/>
        <column name="name" value="Appeal Reviewer"/>
        <column name="created_by" value="system"/>
    </insert>

    <rollback>
        <delete tableName="role">
            <where>code = 'APPEAL_REVIEWER'</where>
        </delete>
    </rollback>
</changeSet>
```

Rollback ini tampak benar, tetapi perlu guard.

Kalau role sudah dipakai oleh user, delete bisa gagal karena FK, atau lebih buruk jika tidak ada FK, bisa membuat orphan semantic.

Lebih aman:

```xml
<changeSet id="020-seed-role-appeal-reviewer" author="fajar">
    <insert tableName="role">
        <column name="code" value="APPEAL_REVIEWER"/>
        <column name="name" value="Appeal Reviewer"/>
        <column name="created_by" value="system"/>
    </insert>

    <rollback>
        <sql>
            DELETE FROM role
            WHERE code = 'APPEAL_REVIEWER'
              AND NOT EXISTS (
                  SELECT 1
                  FROM user_role ur
                  WHERE ur.role_code = 'APPEAL_REVIEWER'
              );
        </sql>
    </rollback>
</changeSet>
```

Atau lebih defensible lagi: jangan delete, tapi deactivate.

```xml
<rollback>
    <sql>
        UPDATE role
        SET active = false,
            updated_by = 'rollback',
            updated_at = CURRENT_TIMESTAMP
        WHERE code = 'APPEAL_REVIEWER';
    </sql>
</rollback>
```

Untuk master/reference data, rollback sering lebih aman sebagai **deactivation** daripada deletion.

---

## 14. Rollback for Backfill

Backfill adalah area rollback paling berbahaya.

Contoh perubahan:

```sql
UPDATE customer
SET normalized_email = LOWER(TRIM(email));
```

Rollback-nya apa?

```sql
UPDATE customer SET normalized_email = NULL;
```

Itu mungkin teknis benar jika `normalized_email` murni derived data. Tetapi jika aplikasi baru sudah memperbarui `normalized_email`, rollback ini bisa menghapus data valid.

### 14.1 Backfill Dengan Snapshot Old Value

Jika data rollback dibutuhkan, simpan old value.

Contoh:

```sql
CREATE TABLE customer_email_backfill_backup (
    customer_id BIGINT PRIMARY KEY,
    old_normalized_email VARCHAR(320),
    backed_up_at TIMESTAMP NOT NULL
);

INSERT INTO customer_email_backfill_backup (
    customer_id,
    old_normalized_email,
    backed_up_at
)
SELECT id, normalized_email, CURRENT_TIMESTAMP
FROM customer
WHERE normalized_email IS NULL;

UPDATE customer
SET normalized_email = LOWER(TRIM(email))
WHERE normalized_email IS NULL;
```

Rollback:

```sql
UPDATE customer c
SET normalized_email = b.old_normalized_email
FROM customer_email_backfill_backup b
WHERE c.id = b.customer_id;
```

Vendor SQL berbeda. PostgreSQL mendukung `UPDATE ... FROM`, Oracle butuh `MERGE`, MySQL syntax berbeda.

### 14.2 Backup Table Lifecycle

Jika membuat backup table untuk rollback, tentukan lifecycle:

- dibuat kapan;
- siapa owner;
- kapan boleh dihapus;
- retention berapa lama;
- apakah mengandung PII;
- apakah perlu encryption;
- apakah ikut backup policy;
- apakah perlu audit approval untuk drop.

Jangan membuat table backup lalu lupa selamanya.

### 14.3 Backfill Rollback Dalam Traffic Berjalan

Jika traffic masih berjalan, rollback backfill bisa race dengan update baru.

Contoh:

```text
T1: backup old value = NULL
T2: migration sets normalized_email = lower(email)
T3: user changes email, app sets normalized_email = new value
T4: rollback restores old value NULL
```

Rollback menghancurkan update T3.

Maka data rollback butuh predicate yang melindungi perubahan baru.

Contoh ide:

```sql
UPDATE customer c
SET normalized_email = b.old_normalized_email
FROM customer_email_backfill_backup b
WHERE c.id = b.customer_id
  AND c.updated_at < :rollback_started_at;
```

Tetapi ini pun tidak selalu cukup. Bisa butuh version column, audit log, atau application freeze.

---

## 15. Rollback for Constraints

Constraint migration harus dipikirkan hati-hati.

### 15.1 Adding NOT NULL Constraint

Migration:

```xml
<changeSet id="030-add-not-null-customer-email" author="fajar">
    <addNotNullConstraint
        tableName="customer"
        columnName="email"
        columnDataType="VARCHAR(320)"/>

    <rollback>
        <dropNotNullConstraint
            tableName="customer"
            columnName="email"
            columnDataType="VARCHAR(320)"/>
    </rollback>
</changeSet>
```

Rollback melemahkan integrity.

Itu mungkin aman jika aplikasi lama memang boleh null. Namun jika data baru sudah mengasumsikan non-null, rollback bisa membuka pintu data buruk.

### 15.2 Adding Unique Constraint

Migration:

```xml
<changeSet id="031-add-unique-customer-email" author="fajar">
    <addUniqueConstraint
        tableName="customer"
        columnNames="email"
        constraintName="uk_customer_email"/>

    <rollback>
        <dropUniqueConstraint
            tableName="customer"
            constraintName="uk_customer_email"/>
    </rollback>
</changeSet>
```

Rollback akan memperbolehkan duplikasi lagi.

Pertanyaan production:

- apakah old app bisa membuat duplicate?
- apakah downstream mengandalkan uniqueness?
- apakah duplicate setelah rollback akan sulit dibersihkan?

Kadang rollback constraint lebih aman secara deployment, tapi lebih buruk secara data integrity.

### 15.3 Safer Constraint Rollout

Untuk production:

```text
1. Add nullable/new column or prepare data.
2. Backfill and clean invalid data.
3. Add constraint in non-blocking/validated mode if DB supports it.
4. Monitor violations.
5. Enforce application validation.
6. Make constraint strict.
```

Rollback di fase awal lebih aman daripada rollback setelah constraint menjadi bagian dari contract sistem.

---

## 16. Rollback for Column Rename

Direct rename adalah classic trap.

Migration:

```xml
<changeSet id="040-rename-customer-name" author="fajar">
    <renameColumn
        tableName="customer"
        oldColumnName="name"
        newColumnName="full_name"
        columnDataType="VARCHAR(255)"/>

    <rollback>
        <renameColumn
            tableName="customer"
            oldColumnName="full_name"
            newColumnName="name"
            columnDataType="VARCHAR(255)"/>
    </rollback>
</changeSet>
```

Masalahnya bukan rollback syntax. Masalahnya compatibility.

Jika aplikasi lama membaca `name` dan aplikasi baru membaca `full_name`, maka saat rolling deployment:

```text
old pod + new schema → old pod gagal
new pod + old schema → new pod gagal
```

Rollback pun tidak menyelesaikan kalau ada pod versi campuran.

### 16.1 Safer Rename Dengan Expand/Contract

```text
Release A:
  Add full_name nullable.
  App writes name and full_name.
  Backfill full_name from name.

Release B:
  App reads full_name but still writes both.

Release C:
  App stops using name.

Release D:
  Drop name.
```

Rollback di Release A/B/C lebih mudah karena kedua column masih ada.

Inilah prinsip penting:

> Rollback terbaik sering dibuat dengan tidak melakukan destructive change terlalu cepat.

---

## 17. Rollback for Table Split

Contoh awal:

```text
customer(id, name, email, address_line1, address_line2, city, postal_code)
```

Target:

```text
customer(id, name, email)
customer_address(id, customer_id, line1, line2, city, postal_code)
```

Naive migration:

```sql
CREATE TABLE customer_address (...);
INSERT INTO customer_address SELECT ... FROM customer;
ALTER TABLE customer DROP COLUMN address_line1;
ALTER TABLE customer DROP COLUMN address_line2;
ALTER TABLE customer DROP COLUMN city;
ALTER TABLE customer DROP COLUMN postal_code;
```

Rollback sangat sulit, terutama jika setelah split user bisa memiliki multiple addresses.

### 17.1 Irreversible Business Transformation

Jika model berubah dari:

```text
one customer has one address
```

menjadi:

```text
one customer has many addresses
```

Maka rollback ke satu address tidak selalu mungkin.

Pertanyaan:

- address mana yang menjadi primary?
- apa yang terjadi pada address tambahan?
- apakah data tambahan boleh hilang?
- apakah user sudah memakai multiple address?

Ini bukan masalah Liquibase. Ini masalah domain model.

### 17.2 Rollback Strategy

Untuk table split, production-grade strategy biasanya:

```text
1. Expand: create new table.
2. Dual-write: write old and new model.
3. Backfill: copy old to new.
4. Read switch: app reads new model.
5. Stabilization: monitor.
6. Contract: drop old columns much later.
```

Selama old columns belum dihapus, rollback aplikasi masih mungkin.

Setelah old columns dihapus, rollback harus direncanakan sebagai new migration, bukan simple rollback.

---

## 18. Rollback for Seed Data

Seed data sering dianggap kecil, tetapi production risk-nya besar.

### 18.1 Permission Seed

Migration:

```sql
INSERT INTO permission(code, name)
VALUES ('CASE_APPROVE', 'Approve Case');
```

Rollback:

```sql
DELETE FROM permission WHERE code = 'CASE_APPROVE';
```

Masalah:

- permission sudah diberikan ke role;
- role sudah diberikan ke user;
- audit log mencatat user punya permission;
- UI menu sudah tergantung permission;
- old app mungkin tidak tahu permission ini, tapi tidak perlu permission dihapus.

Sering kali rollback seed terbaik adalah:

```sql
UPDATE permission SET active = false WHERE code = 'CASE_APPROVE';
```

Atau biarkan saja jika old app mengabaikannya.

### 18.2 Lookup Seed

Contoh:

```text
status: DRAFT, SUBMITTED, APPROVED, REJECTED
```

Release baru menambah:

```text
WITHDRAWN
```

Jika rollback menghapus `WITHDRAWN`, apa yang terjadi dengan records yang sudah berstatus `WITHDRAWN`?

Rollback seed bisa membuat data transactional kehilangan referensi.

### 18.3 Seed Rollback Rule

Untuk seed data:

```text
If seed is unused and unreferenced:
    delete may be okay.
If seed may be referenced:
    deactivate is safer.
If old app ignores unknown seed:
    no-op rollback may be safest.
If old app crashes on unknown seed:
    need compatibility patch or data mapping.
```

---

## 19. Rollback Block Styles

Liquibase mendukung rollback dalam beberapa style.

### 19.1 Declarative Rollback

```xml
<rollback>
    <dropColumn tableName="customer" columnName="nickname"/>
</rollback>
```

Kelebihan:

- portable;
- readable;
- konsisten dengan change types.

Kekurangan:

- tidak semua operasi cukup ekspresif;
- generated SQL bisa berbeda antar DB;
- complex condition sulit.

### 19.2 SQL Rollback

```xml
<rollback>
    <sql>
        UPDATE role
        SET active = false
        WHERE code = 'CASE_APPROVE';
    </sql>
</rollback>
```

Kelebihan:

- eksplisit;
- powerful;
- cocok untuk data rollback;
- DBA-friendly.

Kekurangan:

- vendor-specific;
- harus dites per DB;
- bisa rawan destructive SQL.

### 19.3 Rollback File

Untuk rollback kompleks, SQL bisa diletakkan di file terpisah.

Konsep:

```xml
<rollback>
    <sqlFile path="rollback/020_rollback_seed_case_permission.sql"/>
</rollback>
```

Kelebihan:

- rollback panjang tetap readable;
- bisa direview terpisah;
- bisa diberi komentar detail;
- cocok untuk enterprise release package.

Kekurangan:

- file management lebih kompleks;
- path/logical path harus konsisten;
- raw SQL tetap harus vendor-aware.

---

## 20. Preconditions for Rollback Safety

Precondition biasanya dibahas untuk forward migration, tapi konsep yang sama penting untuk rollback.

Liquibase rollback block tidak selalu punya precondition semudah forward changeset, tergantung format dan command usage. Namun secara desain, rollback safety tetap bisa diwujudkan dengan SQL guard.

### 20.1 Guard Delete Seed

```sql
DELETE FROM permission
WHERE code = 'CASE_APPROVE'
  AND NOT EXISTS (
      SELECT 1
      FROM role_permission
      WHERE permission_code = 'CASE_APPROVE'
  );
```

### 20.2 Guard Drop Column Dengan Manual Check

Sebelum drop column, buat verification query:

```sql
SELECT COUNT(*)
FROM customer
WHERE preferred_language IS NOT NULL;
```

Jika hasil > 0, rollback `DROP COLUMN` akan menghapus data.

Dalam runbook, ini menjadi go/no-go check.

### 20.3 Guard Backfill Rollback

```sql
UPDATE customer c
SET normalized_email = b.old_normalized_email
FROM customer_email_backfill_backup b
WHERE c.id = b.customer_id
  AND c.normalized_email = LOWER(TRIM(c.email));
```

Predicate terakhir mencoba memastikan hanya value hasil backfill yang dikembalikan, bukan value yang sudah diubah aplikasi setelahnya.

Tidak sempurna, tapi jauh lebih baik daripada update buta.

---

## 21. Tagging Strategy for Production

Tag harus menjadi bagian dari release process, bukan command ad-hoc.

### 21.1 Minimal Tag Strategy

Untuk tiap production release:

```text
before-<release-id>
after-<release-id>
```

Contoh:

```text
before-2026-06-17-payment-v2
after-2026-06-17-payment-v2
```

### 21.2 Rich Tag Strategy

Untuk sistem regulated:

```text
before-prod-release-2026-06-17-CR1234-payment-v2
after-prod-release-2026-06-17-CR1234-payment-v2
before-prod-hotfix-2026-06-18-INC9981-index-fix
after-prod-hotfix-2026-06-18-INC9981-index-fix
```

Tag harus bisa dihubungkan ke:

- change request;
- release note;
- deployment ticket;
- approval;
- migration artifact;
- rollback SQL;
- production log.

### 21.3 Tag Governance

Aturan:

1. Tag tidak boleh ambigu.
2. Tag tidak boleh dihapus tanpa approval.
3. Tag harus dibuat oleh pipeline atau authorized operator.
4. Tag harus tercatat di deployment evidence.
5. Tag harus cocok dengan release boundary.
6. Tag harus dipakai dalam rollback rehearsal.

---

## 22. Rollback Testing

Rollback yang belum dites bukan rollback plan. Itu wishful thinking.

### 22.1 Fresh Database Test Tidak Cukup

Banyak pipeline hanya melakukan:

```text
empty DB → liquibase update → success
```

Ini hanya membuktikan fresh install berjalan.

Tidak membuktikan:

- upgrade dari versi lama berjalan;
- rollback berjalan;
- data existing aman;
- rollback SQL benar;
- migration performance cukup;
- old app compatible dengan post-rollback schema.

### 22.2 Upgrade-Rollback Test

Test minimum:

```text
1. Start from previous release schema.
2. Load representative dataset.
3. Run liquibase update.
4. Run application smoke test.
5. Generate rollback SQL.
6. Run rollback.
7. Run old application smoke test.
8. Verify schema/data invariants.
```

### 22.3 Roll-Forward Test

Untuk production modern, test roll-forward juga penting:

```text
1. Apply bad-change simulation.
2. Apply corrective changeset.
3. Verify data fixed.
4. Verify migration history remains linear.
5. Verify no old changeset edited.
```

### 22.4 Testcontainers Pattern

Untuk Java integration test, pakai database engine asli.

Contoh konsep JUnit:

```java
@Test
void migrationCanUpdateAndRollback() {
    // 1. Start PostgreSQL/Oracle-compatible container where applicable.
    // 2. Apply baseline previous release changelog.
    // 3. Load dataset.
    // 4. Apply current changelog.
    // 5. Validate invariants.
    // 6. Execute rollback SQL or rollback command.
    // 7. Validate old contract.
}
```

Jangan hanya pakai H2 untuk migration yang akan berjalan di Oracle/PostgreSQL/MySQL/SQL Server. Perbedaan DDL, lock, type, sequence, identity, timestamp, JSON, dan constraint behavior bisa membuat test palsu hijau.

---

## 23. Rollback Decision Tree

Gunakan decision tree ini sebelum production rollback.

```text
Question 1: Apakah migration sudah selesai sukses?
  No  → handle failed/partial migration recovery dulu.
  Yes → lanjut.

Question 2: Apakah aplikasi baru sudah menerima traffic/write?
  No  → rollback database mungkin aman.
  Yes → lanjut.

Question 3: Apakah rollback akan menghapus data baru?
  Yes → prefer roll-forward atau backup-aware data rollback.
  No  → lanjut.

Question 4: Apakah old application compatible dengan current schema?
  Yes → rollback app saja mungkin cukup.
  No  → lanjut.

Question 5: Apakah rollback SQL sudah digenerate dan direview?
  No  → generate/review dulu kecuali emergency ekstrem.
  Yes → lanjut.

Question 6: Apakah rollback membutuhkan downtime/traffic freeze?
  Yes → coordinate outage/freeze.
  No  → lanjut.

Question 7: Apakah downstream/external systems sudah consume data baru?
  Yes → coordinate semantic rollback/compensation.
  No  → rollback bisa dipertimbangkan.
```

Kesimpulan sering kali:

```text
rollback app only
rollback database only
rollback app + database
roll-forward database
hotfix app
freeze writes + repair data
restore backup
manual compensation
```

Tidak semua incident punya jawaban yang sama.

---

## 24. Production Rollback Runbook Template

Berikut template yang bisa dipakai untuk release serius.

```markdown
# Database Rollback Runbook — <release-id>

## 1. Release Context
- Release ID:
- Change request:
- Application version:
- Changelog path:
- Database:
- Schema:
- Deployment window:
- Operator:
- Approver:

## 2. Migration Summary
- Changesets included:
- Schema changes:
- Data changes:
- Seed changes:
- Destructive changes:
- Expected duration:

## 3. Tags
- Before tag:
- After tag:

## 4. Rollback Strategy
- Preferred strategy: rollback / roll-forward / app rollback only
- Rollback target:
- Rollback command:
- Rollback SQL artifact:
- Expected duration:
- Requires downtime: yes/no
- Requires write freeze: yes/no

## 5. Pre-Rollback Checks
- Confirm incident reason:
- Confirm migration status:
- Confirm app traffic status:
- Confirm data written after migration:
- Confirm backup/snapshot available:
- Confirm lock/session check:
- Confirm rollback SQL reviewed:
- Confirm stakeholder approval:

## 6. Execution Steps
1. Announce start.
2. Stop or drain application if needed.
3. Freeze writes if needed.
4. Run pre-check SQL.
5. Execute rollback command or SQL.
6. Validate database state.
7. Deploy compatible application version.
8. Run smoke test.
9. Monitor logs/metrics.
10. Announce completion.

## 7. Validation Queries
```sql
-- Add release-specific validation queries here
```

## 8. Abort Criteria
- Lock wait exceeds threshold.
- Rollback affects unexpected row count.
- Constraint validation fails.
- Application smoke test fails.
- Replication lag exceeds threshold.

## 9. Post-Rollback Actions
- Capture logs.
- Export DATABASECHANGELOG state.
- Document actual row counts.
- Open follow-up incident/problem record.
- Decide roll-forward fix.
```

Top-tier engineer tidak hanya menulis migration. Ia menulis cara keluar dari masalah.

---

## 25. Common Rollback Anti-Patterns

### 25.1 Editing Old Changeset

Salah:

```text
Migration V already applied to production.
Engineer edits old changeset to fix issue.
```

Akibat:

- checksum mismatch;
- environment drift;
- audit trail rusak;
- production tidak sama dengan dev;
- future migration sulit dipercaya.

Benar:

```text
Create new corrective changeset.
```

Kecuali perubahan belum pernah applied di shared environment. Untuk local-only migration, masih bisa squash/rewrite sesuai team policy.

### 25.2 Rollback Blindly by Count

Salah:

```bash
liquibase rollbackCount 5
```

tanpa tahu 5 changeset terakhir apa.

Benar:

```bash
liquibase history
liquibase rollbackSQL <tag>
review SQL
execute approved rollback
```

### 25.3 Destructive Rollback for Non-Destructive App Rollback

Salah:

```text
App rollback sebenarnya cukup.
DB rollback malah drop column berisi data baru.
```

Benar:

```text
Jika old app bisa ignore extra column/table, jangan rollback schema destructive.
```

### 25.4 Delete Seed That May Be Referenced

Salah:

```sql
DELETE FROM status WHERE code = 'WITHDRAWN';
```

padahal ada transaksi dengan status `WITHDRAWN`.

Benar:

```sql
UPDATE status SET active = false WHERE code = 'WITHDRAWN';
```

atau buat mapping/compensation yang jelas.

### 25.5 Assuming Backup Equals Rollback

Backup restore bukan rollback biasa.

Restore backup bisa menghapus semua transaksi setelah backup.

Backup restore cocok untuk:

- catastrophic corruption;
- wrong mass update/delete;
- unrecoverable schema/data damage;
- controlled downtime.

Bukan solusi default untuk migration error kecil.

### 25.6 Rollback Without Compatibility Matrix

Salah:

```text
new app + old schema?
old app + new schema?
old app + rolled-back schema?
new app + rolled-forward schema?
```

tidak pernah diuji.

Benar:

Buat matrix:

| App Version | DB Version | Should Work? | Notes |
|---|---:|---:|---|
| old app | old DB | yes | baseline |
| old app | expanded DB | yes | required for safe deploy |
| new app | expanded DB | yes | deployment target |
| new app | contracted DB | yes | after cleanup |
| old app | contracted DB | no | rollback no longer safe |

---

## 26. Rollback and Java Application Compatibility

Database rollback tidak bisa dipisahkan dari Java application contract.

### 26.1 JPA/Hibernate Concern

Jika entity punya field baru:

```java
@Column(name = "email_verified")
private boolean emailVerified;
```

Lalu DB rollback drop column, aplikasi baru akan gagal.

Jika app rollback ke versi lama tetapi column ekstra masih ada, biasanya aman karena JPA tidak peduli column tambahan.

Maka dalam banyak kasus:

```text
extra DB column is backward-compatible
missing DB column is not forward-compatible
```

### 26.2 MyBatis Concern

MyBatis raw SQL bisa lebih sensitif:

```sql
SELECT id, name, email_verified FROM customer
```

Jika column hilang, query gagal.

Namun jika old MyBatis query hanya select `id, name`, column ekstra tidak masalah.

### 26.3 JDBC Concern

JDBC manual mapping bergantung query.

Risiko:

- `SELECT *` bisa berubah shape;
- column index mapping bisa rusak;
- stored procedure result set berubah;
- metadata-based mapper bisa bingung.

Rule:

> Avoid `SELECT *` in application code and migration validation logic.

### 26.4 Spring Boot Startup Concern

Jika Liquibase berjalan saat application startup, rollback/failed migration bisa membuat aplikasi gagal start.

Untuk production besar, sering lebih aman menjalankan migration sebagai pipeline step atau Kubernetes Job sebelum app rollout, bukan diam-diam di setiap app instance.

---

## 27. Rollback in Kubernetes / Distributed Deployment

Dalam Kubernetes, rollback lebih kompleks karena pod bisa berjalan campur versi.

Skenario:

```text
1. Liquibase migration runs.
2. New pods start gradually.
3. Some old pods still serving traffic.
4. Error detected.
5. Deployment rollback starts.
```

Jika schema change breaking, old pods bisa sudah rusak sejak step 1.

Karena itu migration harus backward-compatible terhadap old pods selama rolling update.

### 27.1 Safe Pattern

```text
Release N:
  DB expand migration, backward-compatible.
  App can run old/new safely.

Release N+1:
  App switches behavior.

Release N+2:
  DB contract migration after no rollback needed.
```

### 27.2 Liquibase Lock and Multi-Pod Startup

Jika Liquibase berjalan di app startup dan banyak pod start bersamaan, Liquibase lock table mencegah concurrent migration. Namun ini tetap bisa menyebabkan:

- pod startup delay;
- deployment timeout;
- crash loop jika migration gagal;
- unnecessary migration check di setiap pod;
- operational ambiguity: pod mana yang menjalankan migration?

Untuk production serius, pertimbangkan:

```text
Kubernetes Job: run migration once
then Deployment: rollout app
```

Rollback app dilakukan dengan deployment rollback. Rollback DB dilakukan hanya jika runbook memutuskan perlu.

---

## 28. Rollback and Auditability

Rollback harus meninggalkan jejak.

Minimal evidence:

- who initiated rollback;
- when rollback started/ended;
- why rollback was needed;
- which tag was used;
- which changesets rolled back;
- generated rollback SQL;
- executed SQL/log;
- validation result;
- affected rows;
- approval;
- incident/change ticket.

Liquibase `DATABASECHANGELOG` membantu mencatat changeset state, tetapi tidak menggantikan release audit.

Untuk sistem regulated, rollback harus diperlakukan sebagai production change tersendiri, bukan sekadar “membatalkan change”.

---

## 29. Designing Rollback Blocks: Practical Checklist

Untuk setiap changeset, tanyakan:

```text
1. Apakah perubahan ini reversible?
2. Jika reversible, apakah reversal aman di production?
3. Apakah rollback menghapus data?
4. Apakah rollback melemahkan integrity?
5. Apakah rollback memerlukan downtime?
6. Apakah rollback kompatibel dengan old app?
7. Apakah rollback kompatibel dengan new app?
8. Apakah ada dependent object?
9. Apakah seed sudah mungkin direferensi?
10. Apakah data migration butuh backup table?
11. Apakah rollback perlu guard predicate?
12. Apakah rollback SQL sudah bisa digenerate?
13. Apakah rollback sudah diuji terhadap previous-release dataset?
14. Apakah rollback harus diganti roll-forward strategy?
```

Jika tidak bisa menjawab pertanyaan ini, migration belum siap production.

---

## 30. Example: Full Liquibase Changeset with Defensive Rollback

Contoh scenario: menambah permission baru untuk fitur review appeal.

```xml
<changeSet id="20260617-001-seed-appeal-review-permission" author="fajar">
    <preConditions onFail="MARK_RAN" onError="HALT">
        <not>
            <sqlCheck expectedResult="1">
                SELECT COUNT(1)
                FROM permission
                WHERE code = 'APPEAL_REVIEW'
            </sqlCheck>
        </not>
    </preConditions>

    <insert tableName="permission">
        <column name="code" value="APPEAL_REVIEW"/>
        <column name="name" value="Appeal Review"/>
        <column name="active" valueBoolean="true"/>
        <column name="created_by" value="liquibase"/>
        <column name="created_at" valueDate="2026-06-17T00:00:00"/>
    </insert>

    <rollback>
        <sql>
            UPDATE permission
            SET active = false,
                updated_by = 'liquibase-rollback',
                updated_at = CURRENT_TIMESTAMP
            WHERE code = 'APPEAL_REVIEW';
        </sql>
    </rollback>
</changeSet>
```

Kenapa rollback-nya deactivate, bukan delete?

Karena permission bisa saja sudah dihubungkan ke role. Deactivation lebih aman, lebih audit-friendly, dan tidak merusak FK.

Namun ini juga punya konsekuensi: old app harus bisa mengabaikan inactive permission.

---

## 31. Example: Rollback for Add Column with Production Compatibility

Changeset:

```xml
<changeSet id="20260617-002-add-review-comment-column" author="fajar">
    <addColumn tableName="appeal_review">
        <column name="review_comment" type="VARCHAR(2000)"/>
    </addColumn>

    <rollback>
        <sql>
            -- Non-destructive rollback by design.
            -- The column is intentionally retained to preserve production data.
            -- Old application versions do not read or write this column.
            SELECT 1;
        </sql>
    </rollback>
</changeSet>
```

Sebagian orang akan menganggap rollback ini tidak membatalkan perubahan. Tapi secara production engineering, ini bisa lebih benar.

Kenapa?

- old app tetap jalan;
- data user tidak hilang;
- schema extra column bisa dibersihkan di contract phase nanti;
- rollback aplikasi tidak dipaksa menjadi rollback data;
- risiko production lebih rendah.

Rollback tidak harus selalu mengembalikan schema persis seperti sebelumnya. Tujuan rollback adalah memulihkan sistem ke keadaan operasional yang aman.

---

## 32. Example: Bad Rollback Design

```xml
<changeSet id="bad-001" author="dev">
    <dropColumn tableName="customer" columnName="legacy_status"/>

    <rollback>
        <addColumn tableName="customer">
            <column name="legacy_status" type="VARCHAR(30)"/>
        </addColumn>
    </rollback>
</changeSet>
```

Ini rollback palsu.

Kenapa?

Forward migration menghapus data `legacy_status`. Rollback hanya membuat column kosong. Data aslinya tidak kembali.

Rollback ini mungkin membuat schema lama terlihat ada, tetapi aplikasi lama bisa salah karena value kosong.

Better strategy:

```text
1. Jangan drop column dulu.
2. Mark deprecated.
3. Stop writes.
4. Verify no reads.
5. Archive values if needed.
6. Drop in later contract release.
```

Jika terpaksa drop, buat backup:

```sql
CREATE TABLE customer_legacy_status_backup AS
SELECT id, legacy_status, CURRENT_TIMESTAMP AS backed_up_at
FROM customer;
```

Namun tetap harus ada lifecycle dan PII/security review.

---

## 33. Rollback Policy for Team/Organization

Untuk team besar, rollback harus distandarkan.

Contoh policy:

```markdown
# Database Rollback Policy

1. Applied production changesets must never be edited.
2. Every production changeset must declare rollback strategy:
   - explicit rollback,
   - no-op/non-destructive rollback,
   - roll-forward only,
   - restore/backup required.
3. Destructive rollback must require explicit approval.
4. Seed rollback must avoid deleting referenced data.
5. Data migration rollback must preserve old values or document irreversibility.
6. Production rollback must use tag, not arbitrary count, unless approved emergency.
7. Rollback SQL must be generated and reviewed before production release.
8. Rollback must be tested against previous-release dataset for major changes.
9. App compatibility matrix must be documented for breaking schema changes.
10. Roll-forward is preferred after user traffic has written new data.
```

Policy seperti ini mengurangi keputusan impulsif saat incident.

---

## 34. Senior-Level Heuristics

Beberapa prinsip praktis:

### 34.1 Prefer Compatibility Over Rollback

Rollback terbaik adalah tidak perlu rollback database.

Jika old and new application bisa berjalan dengan schema expanded, kita bisa rollback aplikasi tanpa menyentuh DB.

### 34.2 Delay Destruction

Jangan drop column/table pada release yang sama dengan perubahan behavior.

Tunda destructive change sampai yakin:

- tidak ada reader;
- tidak ada writer;
- tidak ada report;
- tidak ada downstream;
- tidak ada rollback need;
- backup/retention aman.

### 34.3 Treat Seed as Contract

Seed role, permission, status, and lookup bukan data kecil. Itu domain contract.

### 34.4 Generate Rollback SQL Early

Rollback SQL bukan dibuat saat incident. Itu harus disiapkan sebelum release.

### 34.5 Roll-Forward Is Often More Honest

Jika data sudah berubah dan dipakai, roll-forward biasanya lebih defensible daripada pura-pura bisa kembali ke masa lalu.

### 34.6 Never Hide Irreversible Change

Jika changeset irreversible, tulis eksplisit.

Contoh:

```xml
<rollback>
    <sql>
        -- Irreversible without restoring from backup.
        -- This changeset drops historical raw payload after archival.
        SELECT 1;
    </sql>
</rollback>
```

Dan dokumentasikan di release note.

---

## 35. What Top 1% Engineers Internalize

Top-tier engineer tidak melihat Liquibase rollback sebagai command.

Mereka melihatnya sebagai bagian dari **change safety architecture**.

Mereka bertanya:

- apakah database change ini compatible dengan deployment strategy?
- apakah rollback app cukup?
- apakah schema rollback perlu?
- apakah data rollback mungkin?
- apakah business rollback valid?
- apakah rollback menghapus fakta production?
- apakah seed boleh dihapus?
- apakah downstream sudah melihat data baru?
- apakah rollback tested?
- apakah rollback auditable?
- apakah roll-forward lebih aman?

Tool hanya mengeksekusi. Engineer mendesain konsekuensi.

---

## 36. Ringkasan

Liquibase menyediakan banyak fitur rollback:

- automatic rollback;
- explicit rollback block;
- rollback count;
- rollback to tag;
- rollback to date;
- rollback SQL generation;
- tagging;
- rollback untuk changeset tertentu.

Tetapi rollback yang matang membutuhkan lebih dari fitur tool.

Prinsip utama:

1. Database rollback bukan undo button.
2. Schema rollback berbeda dari data rollback.
3. Rollback bisa teknis benar tapi bisnis salah.
4. Automatic rollback tidak berarti safe rollback.
5. Tag lebih defensible daripada count/date untuk production.
6. Rollback SQL harus digenerate dan direview.
7. Seed rollback sering lebih aman deactivate daripada delete.
8. Backfill rollback butuh old value, guard, dan traffic awareness.
9. Destructive changes sebaiknya ditunda melalui expand/contract.
10. Setelah production menerima write baru, roll-forward sering lebih aman.
11. Applied changeset jangan diedit; buat corrective changeset.
12. Rollback harus diuji seperti migration.

---

## 37. Latihan Berpikir

### Latihan 1

Sebuah release menambah column nullable `preferred_language` di table `user_profile`. Setelah 30 menit, aplikasi baru gagal karena bug unrelated di service layer. Old app tidak membaca column tersebut.

Pertanyaan:

- apakah perlu rollback DB?
- apakah cukup rollback aplikasi?
- apakah column sebaiknya di-drop?
- apa risiko drop column?

### Latihan 2

Sebuah migration menambah status lookup `WITHDRAWN`. Setelah 1 jam, 200 records sudah memakai status itu. Release harus dibatalkan.

Pertanyaan:

- apakah rollback boleh delete status `WITHDRAWN`?
- apa yang terjadi dengan 200 records?
- apakah deactivate cukup?
- apakah perlu data mapping ke status lama?

### Latihan 3

Sebuah changeset melakukan backfill `normalized_email`. Setelah deployment, ditemukan normalization rule salah untuk beberapa domain.

Pertanyaan:

- rollback atau roll-forward?
- apakah old value tersedia?
- apakah update baru dari user bisa tertimpa rollback?
- query validasi apa yang harus dibuat?

### Latihan 4

Sebuah release langsung rename column `name` menjadi `full_name`. Dalam rolling deployment, sebagian pod lama masih berjalan.

Pertanyaan:

- mengapa ini berbahaya?
- apakah rollback rename cukup?
- bagaimana expand/contract pattern yang benar?

---

## 38. Koneksi ke Part Berikutnya

Part ini menyelesaikan blok utama Liquibase fundamentals.

Berikutnya kita akan masuk ke perbandingan strategis:

```text
Part 16 — Flyway vs Liquibase: Decision Framework
```

Di sana kita tidak akan membandingkan secara dangkal seperti “Flyway simple, Liquibase powerful”. Kita akan membangun decision framework berdasarkan:

- team maturity;
- SQL-first vs changelog-first;
- rollback requirement;
- governance;
- multi-tenant;
- multi-DBMS;
- stored procedure heavy systems;
- CI/CD maturity;
- audit/compliance need;
- legacy adoption;
- operational recovery model.

---

## 39. Status Seri

Seri belum selesai.

Progress saat ini:

```text
[x] Part 0  — Orientation: Database Change as Engineering Discipline
[x] Part 1  — Taxonomy of Database Changes
[x] Part 2  — Migration Invariants and Failure Models
[x] Part 3  — Versioning Models for Database Schema
[x] Part 4  — Flyway Mental Model
[x] Part 5  — Flyway Setup in Java 8–25 Projects
[x] Part 6  — Flyway SQL Migration Design
[x] Part 7  — Flyway Repeatable Migrations
[x] Part 8  — Flyway Java-Based Migrations
[x] Part 9  — Flyway Callbacks and Lifecycle Hooks
[x] Part 10 — Flyway Baseline, Repair, Validate, Clean
[x] Part 11 — Liquibase Mental Model
[x] Part 12 — Liquibase Setup in Java 8–25 Projects
[x] Part 13 — Liquibase Changelog Design
[x] Part 14 — Liquibase Preconditions, Contexts, Labels
[x] Part 15 — Liquibase Rollback Engineering
[ ] Part 16 — Flyway vs Liquibase: Decision Framework
...
[ ] Part 33 — Capstone: Designing a Production-Grade Migration Platform
```
