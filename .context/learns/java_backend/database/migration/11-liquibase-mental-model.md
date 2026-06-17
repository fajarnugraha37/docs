# Part 11 — Liquibase Mental Model

**Series:** `learn-java-database-migrations-seedings-flyway-liquibase`  
**File:** `11-liquibase-mental-model.md`  
**Target:** Java 8 sampai Java 25, dengan perhatian khusus pada legacy Java 8/11 dan modern Java 17/21/25  
**Level:** Advanced / production-grade  

---

## 0. Posisi Part Ini Dalam Seri

Sampai Part 10, kita sudah membangun blok Flyway:

1. mental model Flyway,
2. setup Java,
3. SQL migration design,
4. repeatable migration,
5. Java-based migration,
6. callbacks,
7. baseline, validate, repair, clean.

Sekarang kita pindah ke Liquibase.

Namun cara masuknya tidak boleh dengan pertanyaan dangkal seperti:

> “Liquibase itu mirip Flyway tapi pakai XML/YAML?”

Itu terlalu sempit.

Liquibase punya filosofi berbeda. Flyway cenderung **migration-script first**: urutan script adalah cerita perubahan database. Liquibase cenderung **change-log first**: perubahan database dimodelkan sebagai unit perubahan bernama `changeset`, lalu Liquibase bertugas mengeksekusi, melacak, memvalidasi, memberi conditional logic, memberi rollback metadata, dan mengelola perubahan lintas environment.

Mental model yang benar:

> Liquibase adalah sistem deklarasi, pelacakan, validasi, dan orkestrasi perubahan database berbasis changelog, di mana setiap unit perubahan memiliki identitas eksplisit dan riwayat eksekusi tersimpan di database target.

Part ini fokus pada mental model, bukan setup teknis. Setup Maven/Gradle/Spring Boot akan masuk Part 12.

---

## 1. Core Problem yang Ingin Diselesaikan Liquibase

Liquibase lahir dari masalah yang sama dengan semua migration tool:

> Bagaimana memastikan database di environment A, B, C, D bisa berevolusi secara terkontrol, terurut, dapat diaudit, dan konsisten dengan aplikasi?

Tetapi Liquibase menambahkan kemampuan yang lebih governance-oriented:

- satu perubahan dapat punya metadata eksplisit,
- satu perubahan dapat punya precondition,
- satu perubahan dapat punya rollback definition,
- perubahan dapat diberi context,
- perubahan dapat diberi label,
- changelog dapat dipecah dan disusun hierarkis,
- SQL dapat digenerate/dry-run,
- perubahan dapat ditulis dalam format abstrak non-SQL,
- perubahan dapat dibuat DBMS-specific jika perlu,
- histori perubahan disimpan dalam table khusus,
- proses eksekusi dilindungi lock table.

Jadi Liquibase bukan hanya “runner SQL”. Ia lebih dekat ke:

> database change control system.

Bukan source control seperti Git, tetapi runtime control system untuk perubahan database.

---

## 2. Liquibase Dalam Satu Kalimat

Kalimat ringkas:

> Liquibase membaca changelog, menentukan changeset mana yang belum pernah dijalankan di database target, mengecek validitas dan precondition, mengambil lock, menjalankan perubahan yang relevan, lalu mencatat hasilnya ke `DATABASECHANGELOG`.

Dari kalimat ini, ada tujuh konsep inti:

1. changelog,
2. changeset,
3. identity,
4. checksum,
5. precondition,
6. lock,
7. history table.

Kalau tujuh konsep ini belum jelas, memakai Liquibase di production akan terasa seperti menulis XML/YAML ajaib. Kalau tujuh konsep ini jelas, Liquibase menjadi alat governance yang sangat powerful.

---

## 3. Mental Model Besar: Changelog as Database Evolution Ledger

Dalam Flyway, migration file cenderung menjadi event sequence:

```text
V1__create_user_table.sql
V2__add_email_to_user.sql
V3__create_role_table.sql
```

Dalam Liquibase, pusatnya adalah changelog:

```yaml
databaseChangeLog:
  - changeSet:
      id: 001-create-user-table
      author: fajar
      changes:
        - createTable:
            tableName: app_user
            columns:
              - column:
                  name: id
                  type: bigint
                  constraints:
                    primaryKey: true
                    nullable: false
```

Perbedaan mental:

- Flyway bertanya: “script versi berapa yang belum jalan?”
- Liquibase bertanya: “changeset mana dalam changelog yang belum tercatat sebagai executed?”

Ini tampak mirip, tetapi dampaknya besar.

Liquibase tidak hanya bergantung pada urutan filename. Liquibase memberi setiap perubahan sebuah identitas yang terdiri dari:

- `id`,
- `author`,
- path/logical path file changelog.

Gabungan ini menjadi identitas changeset.

---

## 4. Changelog

### 4.1 Apa Itu Changelog?

Changelog adalah dokumen yang mendefinisikan daftar perubahan database.

Formatnya bisa:

- XML,
- YAML,
- JSON,
- formatted SQL,
- plain SQL dalam pola tertentu,
- kombinasi melalui `include` atau `includeAll`.

Contoh YAML:

```yaml
databaseChangeLog:
  - changeSet:
      id: 001-create-table-product
      author: team-catalog
      changes:
        - createTable:
            tableName: product
            columns:
              - column:
                  name: id
                  type: bigint
                  constraints:
                    primaryKey: true
                    nullable: false
              - column:
                  name: name
                  type: varchar(255)
                  constraints:
                    nullable: false
```

Contoh XML:

```xml
<databaseChangeLog
    xmlns="http://www.liquibase.org/xml/ns/dbchangelog"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xsi:schemaLocation="http://www.liquibase.org/xml/ns/dbchangelog
                        http://www.liquibase.org/xml/ns/dbchangelog/dbchangelog-latest.xsd">

    <changeSet id="001-create-table-product" author="team-catalog">
        <createTable tableName="product">
            <column name="id" type="bigint">
                <constraints primaryKey="true" nullable="false"/>
            </column>
            <column name="name" type="varchar(255)">
                <constraints nullable="false"/>
            </column>
        </createTable>
    </changeSet>
</databaseChangeLog>
```

Contoh formatted SQL:

```sql
--liquibase formatted sql

--changeset team-catalog:001-create-table-product
CREATE TABLE product (
    id BIGINT PRIMARY KEY,
    name VARCHAR(255) NOT NULL
);
```

### 4.2 Changelog Bukan Sekadar File

Kesalahan umum:

> “Changelog itu file YAML/XML yang isinya SQL.”

Lebih tepat:

> Changelog adalah kontrak evolusi database yang dibaca Liquibase untuk menentukan state transition database.

Ia punya implikasi:

- urutan eksekusi,
- identity,
- checksum,
- filtering,
- rollback,
- precondition,
- include hierarchy,
- audit.

---

## 5. Changeset

### 5.1 Apa Itu Changeset?

Changeset adalah unit atomik perubahan menurut Liquibase.

Satu changelog dapat berisi banyak changeset.

```yaml
databaseChangeLog:
  - changeSet:
      id: 001-create-customer
      author: team-crm
      changes:
        - createTable:
            tableName: customer
            columns:
              - column:
                  name: id
                  type: bigint
                  constraints:
                    primaryKey: true

  - changeSet:
      id: 002-add-customer-email
      author: team-crm
      changes:
        - addColumn:
            tableName: customer
            columns:
              - column:
                  name: email
                  type: varchar(320)
```

Liquibase akan mengecek apakah changeset `001-create-customer` sudah pernah jalan. Kalau belum, ia dijalankan. Kalau sudah, ia dilewati, kecuali changeset memakai mode tertentu seperti `runAlways` atau `runOnChange`.

### 5.2 Changeset Sebaiknya Kecil Tapi Bermakna

Changeset terlalu besar:

```text
001-release-2026-q1-big-changes
```

isi:

- create 20 tables,
- alter 10 tables,
- insert 500 seed rows,
- backfill 2 juta rows,
- create indexes,
- create constraints.

Masalah:

- sulit direview,
- sulit tahu perubahan mana yang gagal,
- rollback tidak granular,
- audit tidak jelas,
- retry sulit,
- dependency tersamar.

Changeset terlalu kecil:

```text
001-create-product-id-column
002-create-product-name-column
003-create-product-price-column
```

Masalah:

- noise tinggi,
- changelog panjang tanpa makna,
- review melelahkan,
- unit perubahan terlalu artifisial.

Rule of thumb:

> Satu changeset sebaiknya merepresentasikan satu perubahan database yang bisa dijelaskan dalam satu kalimat bisnis/teknis dan punya failure boundary yang masuk akal.

Contoh baik:

- `create-customer-table`,
- `add-customer-email-column`,
- `create-unique-index-on-customer-email`,
- `seed-default-customer-statuses`,
- `backfill-customer-email-normalized`,
- `add-not-null-after-email-backfill`.

---

## 6. Changeset Identity

### 6.1 Identitas Liquibase Bukan Hanya `id`

Changeset identity secara konseptual terdiri dari:

```text
id + author + changelog path/logicalFilePath
```

Artinya dua changeset dengan id sama bisa dianggap berbeda jika author atau file path berbeda.

Contoh:

```yaml
- changeSet:
    id: 001
    author: team-a
```

berbeda dari:

```yaml
- changeSet:
    id: 001
    author: team-b
```

Dan juga bisa berbeda jika lokasi file berbeda.

### 6.2 Dampak Path pada Identity

Ini sering mengejutkan engineer.

Jika file changelog dipindahkan dari:

```text
/db/changelog/2026/001-user.yaml
```

ke:

```text
/db/changelog/releases/2026/001-user.yaml
```

Liquibase dapat menganggap changeset sebagai identity berbeda jika logical path tidak distabilkan.

Konsekuensi buruk:

- changeset lama dapat terlihat seperti belum pernah dijalankan,
- Liquibase mencoba menjalankan ulang perubahan,
- create table gagal karena table sudah ada,
- insert seed duplikat,
- production deployment gagal.

Solusi:

- jangan sembarangan memindahkan changelog yang sudah pernah dirilis,
- gunakan `logicalFilePath` jika perlu menjaga identity stabil,
- anggap path changelog sebagai bagian dari kontrak production.

### 6.3 Naming Changeset yang Baik

Buruk:

```yaml
id: 1
id: 2
id: 3
```

Masih bisa jalan, tetapi sulit saat conflict banyak branch.

Lebih baik:

```yaml
id: 2026-06-17-001-create-case-review-table
id: 2026-06-17-002-seed-case-review-status
id: 2026-06-18-001-add-escalation-deadline-index
```

Atau per ticket:

```yaml
id: ACEAS-4210-001-create-enforcement-action-table
id: ACEAS-4210-002-seed-enforcement-action-status
id: ACEAS-4211-001-add-case-priority-column
```

Untuk enterprise regulated systems, ticket-based id sering lebih defensible karena mudah ditelusuri ke approval/change request.

---

## 7. `DATABASECHANGELOG`

### 7.1 Fungsi Table Ini

Liquibase menyimpan histori changeset yang sudah dijalankan di table bernama:

```text
DATABASECHANGELOG
```

Table ini biasanya berisi informasi seperti:

- changeset id,
- author,
- filename,
- date executed,
- execution order,
- checksum,
- description,
- comments,
- tag,
- Liquibase version,
- deployment id.

Mental model:

> `DATABASECHANGELOG` adalah ledger runtime yang menjawab: changeset mana yang sudah pernah dijalankan di database ini?

Bukan Git.

Bukan changelog source code.

Bukan dokumentasi manual.

Ini adalah catatan aktual pada database target.

### 7.2 Kenapa Ini Penting?

Karena dua environment bisa punya source code sama tetapi state database berbeda.

Contoh:

```text
SIT:
  DATABASECHANGELOG berisi changeset 001-020

UAT:
  DATABASECHANGELOG berisi changeset 001-018 + hotfix-uat-only

PROD:
  DATABASECHANGELOG berisi changeset 001-017
```

Kalau kita hanya melihat Git branch, kita mungkin mengira semua environment sama. Tetapi Liquibase membaca reality dari database target.

Top engineer harus selalu membedakan:

- desired migration state dari repository,
- actual migration state dari target database.

### 7.3 Jangan Edit Manual Tanpa Prosedur

Mengubah `DATABASECHANGELOG` secara manual adalah tindakan berisiko tinggi.

Bisa saja dibutuhkan untuk recovery, tetapi harus melalui runbook:

1. identifikasi mismatch,
2. backup table metadata,
3. konfirmasi object database aktual,
4. konfirmasi changelog source,
5. dokumentasikan alasan,
6. lakukan update/delete dengan approval,
7. jalankan validate/update kembali,
8. simpan evidence.

Dalam sistem regulated, manual edit tanpa evidence bisa menjadi audit finding.

---

## 8. `DATABASECHANGELOGLOCK`

### 8.1 Masalah Concurrent Migration

Bayangkan dua instance aplikasi start bersamaan:

```text
Pod A starts -> Liquibase update
Pod B starts -> Liquibase update
```

Tanpa lock, keduanya bisa mencoba menjalankan changeset yang sama.

Risiko:

- double execution,
- duplicate seed,
- DDL conflict,
- deadlock,
- checksum race,
- inconsistent history.

Liquibase memakai table lock:

```text
DATABASECHANGELOGLOCK
```

Table ini membantu memastikan hanya satu proses Liquibase yang menjalankan update pada satu waktu.

### 8.2 Lock Bukan Pengganti Deployment Discipline

Lock table membantu, tetapi bukan solusi lengkap.

Ia tidak berarti kita boleh menjalankan migration dari 20 pod aplikasi bersamaan.

Production-grade pattern lebih baik:

```text
CI/CD pipeline
   |
   v
Database migration job runs once
   |
   v
Application rollout starts
```

Bukan:

```text
Every app instance starts
   |
   v
Each instance tries Liquibase update
```

Spring Boot auto-run nyaman untuk development. Untuk production Kubernetes/enterprise deployment, lebih aman migration dijalankan sebagai job terpisah sebelum aplikasi rolling update.

### 8.3 Stale Lock

Jika proses Liquibase mati saat lock masih dianggap held, deployment berikutnya bisa gagal karena lock masih aktif.

Runbook harus menjawab:

- apakah ada proses Liquibase yang masih berjalan?
- siapa yang mengambil lock?
- kapan lock diambil?
- apakah aman release lock?
- apakah database sedang dalam partial migration?

Jangan asal `releaseLocks` tanpa memeriksa keadaan database.

---

## 9. Checksum

### 9.1 Apa Fungsi Checksum?

Liquibase menghitung checksum changeset dan menyimpannya di `DATABASECHANGELOG`.

Checksum menjawab:

> Apakah definisi changeset yang sekarang di repository masih sama dengan definisi yang dulu dijalankan di database ini?

Jika changeset sudah dijalankan lalu isinya diubah, Liquibase dapat mendeteksi mismatch.

Ini penting karena migration yang sudah released seharusnya immutable.

### 9.2 Kenapa Mengedit Changeset Lama Berbahaya?

Contoh changeset lama:

```yaml
- changeSet:
    id: 001-create-user
    author: team-identity
    changes:
      - createTable:
          tableName: app_user
          columns:
            - column:
                name: id
                type: bigint
```

Sudah jalan di PROD.

Lalu developer mengubahnya:

```yaml
- changeSet:
    id: 001-create-user
    author: team-identity
    changes:
      - createTable:
          tableName: app_user
          columns:
            - column:
                name: id
                type: bigint
            - column:
                name: email
                type: varchar(320)
```

Masalah:

- database PROD tidak otomatis punya column `email`,
- Liquibase melihat checksum berubah,
- validate/update bisa gagal,
- environment baru yang fresh akan mendapat schema berbeda dari environment lama,
- history menjadi tidak terpercaya.

Cara benar:

```yaml
- changeSet:
    id: 002-add-email-to-user
    author: team-identity
    changes:
      - addColumn:
          tableName: app_user
          columns:
            - column:
                name: email
                type: varchar(320)
```

Prinsip:

> Setelah changeset masuk shared branch dan berpotensi pernah dijalankan di environment mana pun, treat it as immutable.

### 9.3 `runOnChange`

Liquibase punya opsi `runOnChange`.

Contoh:

```yaml
- changeSet:
    id: recreate-active-user-view
    author: team-identity
    runOnChange: true
    changes:
      - createView:
          viewName: active_user_view
          replaceIfExists: true
          selectQuery: |
            SELECT id, email
            FROM app_user
            WHERE active = 1
```

Artinya changeset akan dijalankan ulang jika checksum berubah.

Cocok untuk:

- view,
- stored procedure,
- function,
- package definition,
- replaceable database object.

Berbahaya untuk:

- create table,
- destructive DDL,
- insert seed mutable,
- data correction,
- backfill besar.

### 9.4 `runAlways`

`runAlways` menjalankan changeset setiap kali update.

Cocok sangat terbatas, misalnya:

- update timestamp metadata deployment,
- refresh controlled object,
- session-level operation tertentu.

Namun untuk kebanyakan migration, `runAlways` adalah bau desain.

Pertanyaan review:

> “Apa yang membuat changeset ini aman dijalankan berkali-kali di production?”

Kalau jawabannya tidak jelas, jangan pakai `runAlways`.

---

## 10. Change Types

Liquibase menyediakan change types deklaratif.

Contoh:

```yaml
- createTable:
    tableName: customer
```

```yaml
- addColumn:
    tableName: customer
```

```yaml
- createIndex:
    tableName: customer
```

```yaml
- addForeignKeyConstraint:
    baseTableName: order_item
    baseColumnNames: order_id
    referencedTableName: orders
    referencedColumnNames: id
```

Mental model:

> Change type adalah abstraksi Liquibase atas operasi database.

Keuntungan:

- lebih portable antar DBMS,
- rollback otomatis kadang tersedia,
- metadata lebih eksplisit,
- dapat digenerate SQL untuk target DB,
- bisa divalidasi lebih baik oleh Liquibase.

Kekurangan:

- tidak semua fitur DBMS bisa dimodelkan sempurna,
- SQL hasil generate perlu dipahami,
- abstraksi bisa menyembunyikan detail penting,
- vendor-specific behavior tetap ada.

Top engineer tidak fanatik.

Gunakan declarative change type saat cocok. Gunakan raw SQL saat perlu presisi vendor-specific.

---

## 11. Format Changelog: XML, YAML, JSON, Formatted SQL

### 11.1 XML

Kelebihan:

- paling mature,
- schema validation kuat,
- dokumentasi banyak,
- explicit structure.

Kekurangan:

- verbose,
- kurang nyaman dibaca,
- merge conflict bisa menyakitkan.

Cocok untuk:

- enterprise strict governance,
- tool compatibility tinggi,
- tim yang butuh XML schema validation.

### 11.2 YAML

Kelebihan:

- lebih readable,
- lebih ringkas,
- populer di Java/Spring ecosystem modern.

Kekurangan:

- indentation-sensitive,
- kesalahan whitespace bisa membingungkan,
- schema validation tidak sekuat XML.

Cocok untuk:

- tim modern,
- repository yang ingin readability tinggi,
- changelog yang sering direview manusia.

### 11.3 JSON

Kelebihan:

- machine-friendly,
- eksplisit,
- cocok untuk generated changelog.

Kekurangan:

- kurang nyaman ditulis manual,
- komentar tidak natural,
- noise syntax tinggi.

Cocok untuk:

- generated workflows,
- internal tools,
- automation-heavy systems.

### 11.4 Formatted SQL

Kelebihan:

- paling dekat dengan DBA/developer SQL,
- presisi tinggi,
- mudah direview oleh orang database,
- tidak menyembunyikan SQL.

Kekurangan:

- portability lebih rendah,
- rollback harus ditulis manual,
- precondition/context syntax bisa kurang nyaman,
- metadata lebih tipis dibanding XML/YAML.

Cocok untuk:

- tim SQL-first,
- vendor-specific database,
- Oracle/PostgreSQL-heavy systems,
- sistem yang DBA review SQL final.

### 11.5 Rekomendasi Praktis

Untuk Java enterprise production:

- gunakan YAML/XML untuk perubahan struktural standar jika ingin metadata kuat,
- gunakan formatted SQL untuk perubahan vendor-specific atau stored object kompleks,
- jangan mencampur terlalu bebas tanpa convention,
- dokumentasikan kapan format mana dipakai.

Contoh policy:

```text
- Table/column/index/constraint sederhana: YAML changeset.
- Complex Oracle package/view/procedure: formatted SQL.
- Large data correction: SQL atau Java migration terpisah dengan approval khusus.
- Seed reference data: YAML/SQL dengan deterministic natural key.
```

---

## 12. Preconditions

### 12.1 Apa Itu Preconditions?

Precondition adalah guard yang dicek sebelum Liquibase menjalankan changeset atau changelog.

Contoh:

```yaml
- changeSet:
    id: 010-add-email-column
    author: team-identity
    preConditions:
      - onFail: MARK_RAN
      - not:
          columnExists:
            tableName: app_user
            columnName: email
    changes:
      - addColumn:
          tableName: app_user
          columns:
            - column:
                name: email
                type: varchar(320)
```

Mental model:

> Preconditions membuat migration sadar terhadap kondisi aktual database sebelum melakukan perubahan.

### 12.2 Kegunaan Preconditions

Preconditions berguna untuk:

- mencegah operasi saat object belum ada,
- mencegah create object jika sudah ada,
- memastikan DBMS benar,
- memastikan schema state sesuai harapan,
- mendeteksi drift,
- menghindari destructive operation di environment salah,
- mengendalikan baseline legacy database.

### 12.3 Bahaya Preconditions

Precondition bukan alasan untuk membuat migration liar dan environment-dependent.

Contoh berbahaya:

```text
Kalau column ada, skip.
Kalau table ada, skip.
Kalau data ada, update.
Kalau data tidak ada, insert.
Kalau environment prod, lakukan A.
Kalau UAT, lakukan B.
```

Jika terlalu banyak branching, changelog menjadi program conditional tersembunyi.

Prinsip:

> Preconditions harus menjaga safety, bukan menyembunyikan ketidakdisiplinan environment.

---

## 13. Contexts

### 13.1 Apa Itu Context?

Context memungkinkan changeset hanya dijalankan dalam context tertentu.

Contoh:

```yaml
- changeSet:
    id: seed-demo-users
    author: team-devex
    context: dev,test
    changes:
      - insert:
          tableName: app_user
          columns:
            - column:
                name: username
                value: demo_user
```

Jika Liquibase dijalankan dengan context `prod`, changeset ini tidak jalan.

### 13.2 Context Cocok Untuk Apa?

Cocok untuk:

- data lokal development,
- test fixtures,
- demo data,
- non-production diagnostic object,
- environment-specific helper yang jelas bukan production.

### 13.3 Context Tidak Cocok Untuk Apa?

Tidak cocok untuk menyembunyikan perbedaan schema production.

Buruk:

```yaml
context: prod
# add different column type
```

```yaml
context: uat
# create different constraint
```

Kalau schema production dan UAT berbeda secara sengaja, sistem akan sulit diuji dan dipromosikan.

Prinsip:

> Context boleh membedakan data pendukung environment, tetapi jangan membuat kontrak schema aplikasi berbeda antar environment tanpa alasan sangat kuat.

---

## 14. Labels

### 14.1 Apa Itu Label?

Label adalah metadata untuk memilih changeset berdasarkan ekspresi label.

Contoh:

```yaml
- changeSet:
    id: 020-add-risk-score-column
    author: team-case
    labels: risk-module,release-2026-06
    changes:
      - addColumn:
          tableName: case_file
          columns:
            - column:
                name: risk_score
                type: number(5,2)
```

Context biasanya menjawab:

> “Untuk environment/situasi eksekusi mana changeset ini relevan?”

Label lebih sering menjawab:

> “Changeset ini bagian dari fitur/release/modul apa?”

### 14.2 Penggunaan Label

Label berguna untuk:

- release selection,
- module selection,
- tenant wave selection,
- feature rollout,
- selective deployment,
- governance tracking.

Namun terlalu banyak label bisa membuat release sulit diprediksi.

Jika setiap deployment membutuhkan ekspresi label kompleks, risiko human error naik.

---

## 15. Rollback

### 15.1 Liquibase dan Rollback Metadata

Salah satu alasan orang memilih Liquibase adalah dukungan rollback yang lebih eksplisit.

Contoh:

```yaml
- changeSet:
    id: 030-add-customer-email
    author: team-crm
    changes:
      - addColumn:
          tableName: customer
          columns:
            - column:
                name: email
                type: varchar(320)
    rollback:
      - dropColumn:
          tableName: customer
          columnName: email
```

Liquibase juga dapat melakukan auto rollback untuk beberapa change type tertentu.

Tetapi mental model yang harus dipegang:

> Dukungan rollback tool bukan berarti semua perubahan database aman di-rollback.

### 15.2 Rollback Fisik vs Rollback Logis

Drop column rollback secara fisik mungkin bisa ditulis:

```yaml
rollback:
  - dropColumn:
      tableName: customer
      columnName: email
```

Tetapi jika aplikasi sudah menulis data email selama 3 jam, lalu rollback drop column, data hilang.

Rollback logis harus menjawab:

- apakah data baru boleh hilang?
- apakah aplikasi lama bisa membaca data setelah rollback?
- apakah ada integration event yang sudah terkirim?
- apakah ada user action yang sudah bergantung pada schema baru?
- apakah audit trail sudah mencatat perubahan?

Dalam banyak production scenario, jawaban yang benar bukan rollback database, tetapi roll-forward.

### 15.3 Rollback sebagai Capability, Bukan Comfort Blanket

Liquibase rollback kuat untuk:

- non-destructive structural change,
- reversible object definition,
- controlled seed correction,
- pre-production validation,
- generated rollback SQL review.

Liquibase rollback lemah untuk:

- data loss,
- semantic change,
- irreversible transformation,
- cross-service side effects,
- long-running backfill,
- external integration impact.

Part 15 nanti akan membahas rollback engineering secara dalam.

---

## 16. Include dan IncludeAll

### 16.1 Kenapa Changelog Perlu Dipecah?

Satu file besar akan menjadi tidak maintainable.

Contoh buruk:

```text
db.changelog-master.yaml
  15.000 lines
```

Masalah:

- merge conflict,
- review sulit,
- ownership kabur,
- release tracking sulit,
- modularity hilang.

Liquibase menyediakan `include` dan `includeAll`.

### 16.2 `include`

Contoh:

```yaml
databaseChangeLog:
  - include:
      file: db/changelog/2026/06/001-case-module.yaml
  - include:
      file: db/changelog/2026/06/002-compliance-module.yaml
```

`include` eksplisit dan mudah direview.

Kelebihan:

- urutan jelas,
- file yang masuk jelas,
- review mudah,
- minim kejutan.

Kekurangan:

- perlu menambahkan entry manual.

### 16.3 `includeAll`

Contoh:

```yaml
databaseChangeLog:
  - includeAll:
      path: db/changelog/2026/06
```

Kelebihan:

- otomatis include semua file,
- praktis untuk banyak file.

Risiko:

- ordering bergantung aturan tertentu,
- file tidak sengaja bisa ikut,
- rename file dapat mengubah urutan,
- review lebih sulit,
- generated files bisa masuk tanpa sadar.

Untuk production regulated system, `include` eksplisit sering lebih defensible daripada `includeAll`.

---

## 17. SQL Generation and Dry Run

Liquibase dapat menghasilkan SQL sebelum dieksekusi.

Mental model:

> Changelog adalah intent, generated SQL adalah concrete execution plan untuk DBMS target.

Ini penting karena declarative change type bisa menghasilkan SQL berbeda antar database.

Contoh intent:

```yaml
- addColumn:
    tableName: customer
    columns:
      - column:
          name: email
          type: varchar(320)
```

Generated SQL di PostgreSQL, Oracle, MySQL, SQL Server bisa berbeda.

Production-grade review sebaiknya tidak hanya review YAML/XML, tetapi juga SQL final untuk database target.

Workflow ideal:

```text
Developer writes changelog
   |
CI validates changelog
   |
CI generates SQL for target DB
   |
Reviewer reviews changelog + SQL
   |
Pipeline applies migration
   |
Post-check verifies schema/data state
```

---

## 18. Liquibase vs ORM Schema Generation

Dalam Java, terutama Spring Boot/JPA/Hibernate, ada godaan memakai ORM auto DDL:

```properties
spring.jpa.hibernate.ddl-auto=update
```

Untuk learning atau prototype, ini nyaman.

Untuk serious production, ini berbahaya karena:

- perubahan schema tidak eksplisit,
- tidak reviewable sebagai migration artifact,
- tidak punya rollback plan,
- tidak cocok untuk zero-downtime choreography,
- dapat menghasilkan SQL tidak sesuai ekspektasi,
- tidak mengelola seed/reference data,
- tidak memberikan governance yang cukup.

Liquibase harus menjadi sumber utama perubahan schema, bukan Hibernate auto update.

JPA entity tetap penting sebagai application model, tetapi bukan migration authority.

Prinsip:

> Entity model describes what the application expects. Migration changelog describes how the database reaches that state safely.

---

## 19. Liquibase vs `schema.sql` / `data.sql`

Banyak Spring Boot project kecil memakai:

```text
schema.sql
data.sql
```

Ini cocok untuk bootstrap sederhana.

Namun setelah aplikasi serius memakai Liquibase:

- schema evolution harus lewat Liquibase,
- seed production harus lewat Liquibase atau controlled seed process,
- `schema.sql`/`data.sql` jangan menjadi mekanisme paralel.

Jika ada dua mekanisme schema/data initialization, masalah muncul:

- urutan tidak jelas,
- ownership kabur,
- local berbeda dari production,
- CI berbeda dari runtime,
- migration history tidak lengkap,
- audit tidak defensible.

Prinsip:

> Satu database harus punya satu authority utama untuk structural evolution.

---

## 20. Liquibase Execution Model

Secara simplified, Liquibase update berjalan seperti ini:

```text
1. Load configuration
2. Connect to target database
3. Ensure DATABASECHANGELOG exists
4. Ensure DATABASECHANGELOGLOCK exists
5. Acquire lock
6. Parse changelog
7. Resolve includes
8. Filter by context/label
9. For each changeset:
      a. compute identity
      b. check if already executed
      c. validate checksum if executed
      d. evaluate preconditions if needed
      e. execute changes if not yet executed
      f. record execution in DATABASECHANGELOG
10. Release lock
```

Jika terjadi failure:

```text
- lock may remain until released
- partially executed SQL may or may not be committed depending DBMS/transaction behavior
- changeset may or may not be recorded depending failure timing
- database object state may not match changelog expectation
```

Karena itu, Liquibase bukan pengganti pemahaman transaksi database.

---

## 21. Transaction Model

Liquibase changeset bisa dijalankan dalam transaksi jika database dan change type mendukung.

Namun tidak semua DDL transactional.

Contoh umum:

- PostgreSQL banyak DDL transactional, tetapi `CREATE INDEX CONCURRENTLY` tidak boleh dalam transaction block.
- Oracle DDL umumnya implicit commit.
- MySQL DDL behavior bergantung engine/version/operation.
- SQL Server punya variasi tergantung operasi.

Liquibase punya atribut seperti `runInTransaction`.

Contoh:

```yaml
- changeSet:
    id: create-index-concurrently
    author: team-search
    runInTransaction: false
    changes:
      - sql:
          sql: CREATE INDEX CONCURRENTLY idx_customer_email ON customer(email);
```

Mental model:

> Liquibase mengorkestrasi perubahan, tetapi atomicity aktual tetap ditentukan oleh database engine dan jenis statement.

Jangan mengasumsikan semua changeset aman rollback otomatis hanya karena tool migration mendukung transaction.

---

## 22. When Liquibase Shines

Liquibase sangat kuat ketika sistem membutuhkan:

- explicit metadata per change,
- rollback definition,
- environment filtering,
- precondition safety,
- DBMS abstraction,
- SQL generation,
- changelog hierarchy,
- enterprise auditability,
- regulated release process,
- multi-team governance,
- large legacy database adoption,
- controlled seed/data changes.

Contoh cocok:

```text
Government/regulatory case management platform
Financial system
Multi-module enterprise monolith
Product supporting multiple DB vendors
System with DBA approval workflow
System needing rollback SQL evidence
Complex release train with UAT/staging/prod gates
```

---

## 23. When Liquibase Can Hurt

Liquibase bisa menyulitkan jika:

- tim hanya butuh simple SQL migration,
- tim tidak disiplin changelog organization,
- terlalu banyak contexts/labels,
- terlalu banyak generated changelog tanpa review,
- engineer tidak memahami SQL final,
- rollback dianggap magic,
- path changeset sering dipindah,
- includeAll digunakan tanpa naming/order discipline,
- declarative abstraction dipakai untuk operasi vendor-specific yang seharusnya raw SQL.

Tool yang expressive bisa menjadi sumber chaos jika governance lemah.

---

## 24. Liquibase and Java Version Reality

Karena seri ini mencakup Java 8 sampai Java 25, perlu mental model compatibility.

Secara praktik:

- project Java 8/11 legacy mungkin harus memakai Liquibase versi 4.x tertentu,
- project Java 17/21/25 modern dapat memakai Liquibase generasi baru,
- Spring Boot version juga mempengaruhi Liquibase version yang dikelola dependency management,
- jangan upgrade Liquibase hanya karena library update tersedia,
- cek minimum Java runtime dan compatibility dengan build/runtime platform.

Prinsip:

> Migration tool adalah bagian dari deployment infrastructure. Upgrade-nya harus diperlakukan seperti perubahan platform, bukan sekadar bump dependency kecil.

Risiko upgrade:

- checksum behavior berubah,
- parser behavior berubah,
- default config berubah,
- command-line option berubah,
- generated SQL berubah,
- driver compatibility berubah,
- plugin integration berubah.

Maka setiap upgrade Liquibase harus dites dengan:

- fresh database migration,
- existing database update,
- validate terhadap database yang sudah punya history,
- rollback SQL generation jika dipakai,
- CI pipeline execution,
- production-like DBMS.

---

## 25. Liquibase in Application Startup vs External Migration Job

Ada dua model umum.

### 25.1 Application Startup Model

Aplikasi start, Liquibase jalan otomatis, lalu aplikasi lanjut start.

Kelebihan:

- simple,
- cocok local dev,
- cocok service kecil,
- tidak perlu pipeline kompleks.

Kekurangan:

- multiple instance race meski ada lock,
- app startup bisa lambat,
- failure migration menjadi failure app,
- hard to separate duty,
- kurang cocok untuk long migration,
- sulit approval gate.

### 25.2 External Migration Job Model

Pipeline menjalankan Liquibase sebagai job sebelum deploy aplikasi.

Kelebihan:

- controlled,
- one execution,
- easier approval,
- observability lebih jelas,
- separation of concern,
- cocok Kubernetes,
- cocok production.

Kekurangan:

- butuh pipeline maturity,
- konfigurasi credential terpisah,
- perlu rollback/roll-forward choreography,
- dev/prod workflow bisa berbeda.

Rekomendasi umum:

```text
Local/dev: application startup acceptable
CI/test: pipeline or test-controlled execution
Production: external migration job preferred
```

---

## 26. Changelog as Artifact, Not Just Source File

Untuk sistem serius, changelog bukan hanya file di repo.

Ia adalah artifact release.

Artinya:

- changelog harus version-controlled,
- changelog harus direview,
- changelog harus ikut build/release artifact,
- changelog tidak boleh berubah setelah release tanpa prosedur,
- generated SQL harus bisa disimpan sebagai evidence,
- deployment logs harus dikaitkan dengan changelog version,
- database history harus bisa dicocokkan dengan artifact yang dideploy.

Dalam regulatory/compliance setting, pertanyaan audit bisa seperti:

> “Siapa yang menyetujui perubahan constraint ini?”

> “Kapan changeset ini dijalankan di production?”

> “Apakah SQL yang dijalankan sama dengan yang direview?”

> “Apakah perubahan ini punya rollback plan?”

Liquibase bisa membantu menjawab, tetapi hanya jika proses team juga benar.

---

## 27. Anti-Patterns Liquibase

### 27.1 Editing Released Changeset

Gejala:

```text
Checksum mismatch muncul, lalu developer ingin clear checksum saja.
```

Akar masalah:

- released migration dianggap mutable.

Solusi:

- buat changeset baru,
- gunakan validCheckSum hanya untuk kasus sangat spesifik dan terdokumentasi,
- jangan clear checksum tanpa memahami dampak.

### 27.2 Context Explosion

Gejala:

```yaml
context: dev and !uat or prod and region-sg and !legacy
```

Akar masalah:

- satu changelog dipakai untuk terlalu banyak variasi state.

Solusi:

- sederhanakan environment model,
- pisahkan test/demo data,
- hindari schema divergence.

### 27.3 IncludeAll Without Discipline

Gejala:

- file baru tiba-tiba ikut deployment,
- urutan berubah karena rename,
- conflict sulit dideteksi.

Solusi:

- gunakan `include` eksplisit untuk production changelog,
- kalau memakai `includeAll`, enforce naming convention ketat.

### 27.4 Rollback Fantasy

Gejala:

- semua changeset wajib punya rollback,
- tetapi rollback tidak pernah diuji,
- data loss tidak dianalisis.

Solusi:

- bedakan technical rollback dan business rollback,
- test rollback,
- gunakan roll-forward untuk irreversible change.

### 27.5 Generated Changelog Blind Trust

Gejala:

- generate changelog dari database,
- commit semua hasil tanpa review mendalam.

Risiko:

- naming buruk,
- ordering buruk,
- constraints tidak sesuai,
- vendor-specific artifact bocor,
- baseline tidak bersih.

Solusi:

- generated changelog adalah draft,
- manusia tetap review dan refactor.

---

## 28. Mental Comparison: Flyway vs Liquibase

Secara ringkas:

```text
Flyway:
  mental model: ordered migration scripts
  strength: simplicity, SQL-first, predictability
  risk: less metadata/governance unless process adds it

Liquibase:
  mental model: changelog + changeset ledger
  strength: metadata, preconditions, rollback, contexts, SQL generation
  risk: complexity, conditional chaos, abstraction leakage
```

Bukan mana yang lebih hebat secara mutlak.

Pertanyaan yang benar:

> Tool mana yang lebih cocok dengan constraint sistem, database, team, release process, audit requirement, dan operational maturity?

Part 16 nanti akan membahas decision framework detail.

---

## 29. Liquibase Review Checklist

Saat review Liquibase changeset, jangan hanya tanya “bisa jalan tidak?”

Gunakan checklist:

### Identity

- Apakah `id` unik dan meaningful?
- Apakah `author` konsisten?
- Apakah file path stabil?
- Apakah changeset lama diedit?

### Change Semantics

- Apakah perubahan kecil tapi bermakna?
- Apakah operasi destructive?
- Apakah perlu expand/contract?
- Apakah perlu backfill terpisah?

### Safety

- Apakah precondition diperlukan?
- Apakah precondition terlalu permisif?
- Apakah changeset idempotent jika memang perlu?
- Apakah lock/timeout diperhitungkan?

### Rollback

- Apakah rollback memungkinkan secara logis?
- Apakah rollback berpotensi data loss?
- Apakah rollback perlu diuji?
- Apakah roll-forward lebih masuk akal?

### Environment

- Apakah context/label dipakai wajar?
- Apakah schema berbeda antar environment?
- Apakah seed data production dan test dipisah?

### Operational

- Apakah generated SQL direview?
- Apakah migration bisa lama?
- Apakah perlu maintenance window?
- Apakah ada post-check query?
- Apakah ada runbook jika gagal?

---

## 30. Example: Good Liquibase Mental Model in Practice

Misalkan kita ingin menambahkan fitur `case_priority` pada sistem case management.

Naive approach:

```yaml
- addColumn case.priority_id not null
- add foreign key
- insert priorities
```

Masalah:

- existing case rows tidak punya priority,
- not null langsung gagal,
- aplikasi lama tidak tahu column baru,
- seed bisa duplicate,
- rollback unclear.

Production-grade approach:

### Release 1 — Expand

```yaml
- create table case_priority
- seed deterministic priorities
- add nullable priority_id to case_file
- add non-validating/index-safe foreign key if supported
```

### Between Release — Backfill

```text
Backfill existing case_file.priority_id in chunks.
Validate no null remains.
```

### Release 2 — Enforce

```yaml
- add not null constraint
- validate foreign key
- switch application to require priority
```

### Release 3 — Contract if needed

```yaml
- remove old priority text column if exists
```

Liquibase features yang relevan:

- changeset per unit,
- precondition untuk object existence,
- context untuk non-prod test seed,
- rollback untuk safe structural changes,
- labels untuk release grouping,
- generated SQL review untuk target DB.

Inilah cara berpikir top-tier: bukan langsung menulis changelog, tetapi mendesain state transition.

---

## 31. Practical Rules of Thumb

1. Treat released changesets as immutable.
2. Use meaningful ids, not random integers only.
3. Keep changesets small but semantically complete.
4. Prefer explicit `include` for regulated production systems.
5. Use contexts for environment support data, not schema chaos.
6. Use labels for release/module selection, but avoid complex label expressions.
7. Use preconditions as guardrails, not as duct tape for drift.
8. Review generated SQL for the actual target database.
9. Never assume rollback is safe just because rollback syntax exists.
10. Separate schema migration, reference seed, test fixture, and data backfill.
11. Do not mix Liquibase with ORM auto-DDL as competing authorities.
12. Do not run long data backfills blindly inside app startup.
13. Prefer external migration jobs for serious production deployments.
14. Stabilize changelog paths or use `logicalFilePath` carefully.
15. Understand database transaction behavior before relying on atomic migration.

---

## 32. What You Should Be Able to Explain After This Part

Setelah memahami Part 11, kamu harus bisa menjelaskan:

1. apa bedanya changelog dan changeset,
2. bagaimana Liquibase menentukan changeset sudah pernah jalan,
3. kenapa changeset identity bukan hanya `id`,
4. fungsi `DATABASECHANGELOG`,
5. fungsi `DATABASECHANGELOGLOCK`,
6. kenapa checksum mismatch terjadi,
7. kenapa released changeset tidak boleh diedit sembarangan,
8. kapan memakai `runOnChange`,
9. kapan `runAlways` berbahaya,
10. apa fungsi precondition,
11. perbedaan context dan label,
12. batas realistis rollback,
13. kapan memakai XML/YAML/JSON/formatted SQL,
14. kenapa generated SQL tetap harus direview,
15. kenapa Liquibase bukan pengganti deployment discipline.

---

## 33. Summary

Liquibase adalah migration tool yang sangat kuat, tetapi kekuatannya bukan hanya dari kemampuannya menjalankan SQL.

Kekuatan utamanya ada pada model:

```text
changelog -> changeset -> identity -> checksum -> lock -> execution -> history
```

Dengan model itu, Liquibase membantu membuat perubahan database menjadi:

- eksplisit,
- terurut,
- terlacak,
- dapat divalidasi,
- bisa difilter,
- bisa diberi guardrail,
- bisa diberi rollback metadata,
- lebih defensible secara audit.

Namun Liquibase juga membawa kompleksitas. Jika tim menggunakan contexts, labels, preconditions, generated changelog, dan rollback secara sembarangan, changelog bisa berubah menjadi sistem conditional yang sulit diprediksi.

Prinsip paling penting:

> Liquibase bukan magic. Liquibase adalah control system. Kualitas hasilnya tetap ditentukan oleh disiplin engineering di sekitar migration design, review, testing, deployment, dan recovery.

---

## 34. Connection to Next Part

Part berikutnya adalah:

```text
12-liquibase-setup-java-8-to-25.md
```

Di sana kita akan masuk ke setup teknis:

- Java 8/11/17/21/25 compatibility,
- Liquibase 4.x vs 5.x consideration,
- Maven plugin,
- Gradle plugin,
- CLI,
- Spring Boot integration,
- plain Java integration,
- Jakarta EE integration,
- changelog location,
- configuration,
- secrets,
- CI/container execution.

Part 11 ini adalah fondasi mentalnya. Part 12 akan mengubah mental model tersebut menjadi setup project yang bisa dijalankan.
