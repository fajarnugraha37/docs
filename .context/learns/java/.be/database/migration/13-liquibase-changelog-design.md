# Part 13 — Liquibase Changelog Design

**Series:** `learn-java-database-migrations-seedings-flyway-liquibase`  
**File:** `13-liquibase-changelog-design.md`  
**Scope:** Java 8 hingga Java 25, Liquibase 4.x hingga 5.x, Spring Boot, Jakarta EE, plain Java, CI/CD, multi-module enterprise systems  
**Prerequisite:** Part 11 — Liquibase Mental Model, Part 12 — Liquibase Setup in Java 8–25 Projects

---

## 1. Tujuan Part Ini

Part ini membahas **desain changelog Liquibase**.

Di Part 11, kita sudah membangun mental model Liquibase:

- database change direpresentasikan sebagai `changeset`,
- sekumpulan changeset diorganisasi dalam `changelog`,
- Liquibase mencatat execution history di `DATABASECHANGELOG`,
- Liquibase mengunci eksekusi melalui `DATABASECHANGELOGLOCK`,
- identity changeset bukan hanya “isi SQL”, tetapi kombinasi `id`, `author`, dan path file,
- checksum menjaga agar perubahan historis tidak diam-diam berubah.

Di Part 12, kita membahas setup Liquibase di Java 8–25.

Sekarang fokus kita adalah pertanyaan yang jauh lebih penting dalam project nyata:

> Bagaimana mendesain changelog agar tetap rapi, scalable, aman direview, tidak konflik antar developer, dan tetap masuk akal setelah sistem berjalan bertahun-tahun?

Karena masalah terbesar Liquibase jarang ada di command seperti:

```bash
liquibase update
```

Masalah terbesar biasanya muncul ketika repository sudah memiliki ratusan atau ribuan changeset:

- file changelog terlalu besar,
- urutan migration tidak jelas,
- developer memakai `includeAll` sembarangan,
- changeset lama diedit,
- `author` tidak konsisten,
- `id` konflik,
- path file berubah dan Liquibase menganggap changeset lama sebagai changeset baru,
- generated changelog menghasilkan noise,
- XML/YAML terlalu abstrak dan sulit direview oleh DBA,
- SQL terlalu bebas dan tidak punya metadata,
- data seed bercampur dengan schema migration,
- rollback dicantumkan tetapi tidak pernah dites,
- environment-specific logic tersebar liar.

Part ini membangun desain changelog sebagai **arsitektur perubahan database**, bukan hanya format file.

---

## 2. Posisi Changelog dalam Sistem

Dalam sistem Java enterprise, changelog bukan file tambahan. Changelog adalah bagian dari kontrak release.

```text
Application code
    depends on
Database contract
    evolved by
Liquibase changelog
    executed by
Migration process
    recorded in
DATABASECHANGELOG
```

Artinya:

- kode aplikasi boleh berubah hanya jika database contract berubah dengan terkendali,
- database contract berubah melalui migration yang eksplisit,
- migration harus punya histori,
- histori harus bisa diaudit,
- migration harus bisa dipromosikan dari dev ke test ke staging ke production,
- production tidak boleh berubah oleh file yang tidak jelas asal-usulnya.

Top engineer tidak melihat changelog sebagai “tempat naruh DDL”.

Top engineer melihat changelog sebagai:

1. **source of intent** — apa yang ingin diubah,
2. **source of order** — kapan perubahan itu harus terjadi,
3. **source of audit** — siapa menambahkan perubahan itu,
4. **source of deployment contract** — release mana membutuhkan perubahan apa,
5. **source of recovery reasoning** — bagaimana memahami kondisi jika deployment gagal.

---

## 3. The Core Design Problem

Liquibase memberi kebebasan besar:

- XML,
- YAML,
- JSON,
- formatted SQL,
- raw SQL,
- include,
- includeAll,
- contexts,
- labels,
- preconditions,
- rollback,
- logicalFilePath,
- custom change,
- generated changelog.

Kebebasan ini powerful, tapi juga berbahaya.

Tanpa standar desain, changelog bisa berubah menjadi:

```text
src/main/resources/db/changelog/db.changelog-master.yaml
```

yang berisi ribuan baris acak:

```yaml
databaseChangeLog:
  - changeSet:
      id: 1
      author: fajar
      changes:
        - createTable: ...
  - changeSet:
      id: 2
      author: iwan
      changes:
        - addColumn: ...
  - changeSet:
      id: 2
      author: ridhwan
      changes:
        - insert: ...
  - changeSet:
      id: abc
      author: dev
      changes:
        - sql: ...
```

Masalahnya bukan hanya estetika.

Masalahnya adalah:

- sulit review,
- rawan merge conflict,
- susah dicari,
- rawan duplicate `id`,
- tidak jelas ownership,
- tidak jelas release boundary,
- sulit rollback reasoning,
- sulit audit,
- sulit onboarding developer baru,
- sulit memisahkan schema/data/object changes,
- sulit menghapus atau memindahkan file tanpa efek samping.

Karena itu, desain changelog perlu menjawab lima pertanyaan:

1. **Apa unit perubahan?**
2. **Bagaimana perubahan diurutkan?**
3. **Bagaimana perubahan dikelompokkan?**
4. **Bagaimana perubahan direview?**
5. **Bagaimana perubahan dipromosikan antar environment?**

---

## 4. Changelog sebagai Directed Execution Plan

Secara mental, changelog Liquibase adalah execution plan berurutan.

Contoh sederhana:

```text
master changelog
    ├── 2026-01-release.yaml
    │       ├── create_customer_table
    │       ├── add_customer_email_index
    │       └── seed_customer_status
    │
    ├── 2026-02-release.yaml
    │       ├── add_customer_risk_level
    │       ├── backfill_customer_risk_level
    │       └── add_customer_risk_level_not_null
    │
    └── 2026-03-release.yaml
            ├── create_case_table
            └── create_case_customer_fk
```

Liquibase akan membaca file sesuai instruksi `include` atau `includeAll`.

Yang penting:

> Urutan include adalah bagian dari desain sistem.

Urutan bukan hal teknis kecil. Urutan menentukan apakah migration aman.

Contoh:

```text
1. add nullable column
2. backfill column
3. add not null constraint
```

Urutan ini aman.

Kalau dibalik:

```text
1. add not null column
2. backfill column
```

migration bisa gagal di tabel yang sudah punya data.

Karena itu, changelog hierarchy harus membuat order terlihat, bukan tersembunyi.

---

## 5. Changelog Granularity

Satu pertanyaan penting:

> Seberapa kecil atau besar satu changeset?

Tidak ada jawaban tunggal, tetapi ada prinsip.

Satu changeset sebaiknya merepresentasikan **satu unit perubahan yang punya makna deployment**.

Bukan terlalu kecil seperti:

```text
changeset 1: create column A
changeset 2: create column B
changeset 3: create column C
```

padahal semuanya bagian dari satu tabel baru.

Bukan juga terlalu besar seperti:

```text
changeset 1: entire release database update
```

yang berisi 500 perubahan.

Granularity yang sehat:

```text
changeset: create table application
changeset: create table application_status_history
changeset: add indexes for application listing
changeset: seed application status reference data
changeset: backfill application status for existing rows
```

### 5.1 Rule of Thumb

Gunakan satu changeset untuk satu perubahan yang:

- bisa diberi nama jelas,
- bisa direview secara mandiri,
- punya failure impact yang bisa dipahami,
- punya rollback reasoning yang masuk akal,
- tidak mencampur concern berbeda.

Contoh baik:

```yaml
databaseChangeLog:
  - changeSet:
      id: 20260115-1010-create-application-table
      author: fajar
      changes:
        - createTable:
            tableName: application
            columns:
              - column:
                  name: id
                  type: bigint
                  constraints:
                    primaryKey: true
                    nullable: false
              - column:
                  name: reference_no
                  type: varchar(50)
                  constraints:
                    nullable: false
              - column:
                  name: status
                  type: varchar(30)
                  constraints:
                    nullable: false
```

Contoh buruk:

```yaml
databaseChangeLog:
  - changeSet:
      id: update-db
      author: dev
      changes:
        - createTable: ...
        - addColumn: ...
        - insert: ...
        - dropColumn: ...
        - sql: ...
```

Masalahnya:

- nama tidak menjelaskan intent,
- terlalu banyak concern,
- rollback sulit,
- failure sulit diisolasi,
- review sulit.

---

## 6. Master Changelog

Master changelog adalah entry point.

Biasanya disebut:

```text
db/changelog/db.changelog-master.yaml
```

atau:

```text
db/changelog/master.xml
```

atau:

```text
db/changelog/changelog-master.sql
```

Tugas master changelog bukan menampung semua changeset.

Tugasnya adalah mengatur struktur.

Contoh baik:

```yaml
databaseChangeLog:
  - include:
      file: db/changelog/releases/2026-01.yaml
  - include:
      file: db/changelog/releases/2026-02.yaml
  - include:
      file: db/changelog/releases/2026-03.yaml
```

Master changelog harus kecil, stabil, dan mudah dibaca.

Anti-pattern:

```yaml
databaseChangeLog:
  - changeSet: ...
  - changeSet: ...
  - changeSet: ...
  # ribuan baris sampai master changelog menjadi dumping ground
```

Masalah master changelog terlalu besar:

- merge conflict sering,
- sulit review,
- sulit melihat release boundary,
- developer takut menyentuh file,
- changeset lama rawan diedit tidak sengaja.

### 6.1 Master Changelog sebagai Table of Contents

Mental model terbaik:

```text
master changelog = daftar isi perubahan database
```

Bukan isi buku.

Isi detail berada pada file release/module/feature.

---

## 7. Changelog Hierarchy Options

Ada beberapa strategi hierarchy.

Tidak semua cocok untuk semua sistem.

Kita akan bahas satu per satu.

---

## 8. Strategy A — Single Master + Release Changelog

Struktur:

```text
src/main/resources/db/changelog/
  db.changelog-master.yaml
  releases/
    2026-01.yaml
    2026-02.yaml
    2026-03.yaml
```

Master:

```yaml
databaseChangeLog:
  - include:
      file: db/changelog/releases/2026-01.yaml
  - include:
      file: db/changelog/releases/2026-02.yaml
  - include:
      file: db/changelog/releases/2026-03.yaml
```

Release changelog:

```yaml
databaseChangeLog:
  - changeSet:
      id: 20260115-1000-create-application-table
      author: fajar
      changes:
        - createTable:
            tableName: application
            columns:
              - column:
                  name: id
                  type: bigint
                  constraints:
                    primaryKey: true
                    nullable: false
              - column:
                  name: reference_no
                  type: varchar(50)
                  constraints:
                    nullable: false

  - changeSet:
      id: 20260115-1010-create-application-reference-index
      author: fajar
      changes:
        - createIndex:
            tableName: application
            indexName: idx_application_reference_no
            columns:
              - column:
                  name: reference_no
```

### 8.1 Cocok Untuk

Strategi ini cocok untuk:

- satu aplikasi,
- satu database/schema,
- release cadence jelas,
- tim kecil sampai menengah,
- perubahan database biasanya mengikuti release aplikasi,
- audit ingin melihat perubahan per release.

### 8.2 Kelebihan

- mudah dipahami,
- release boundary jelas,
- review per release mudah,
- audit mudah,
- production deployment mapping mudah.

### 8.3 Kekurangan

- merge conflict bisa terjadi jika banyak developer menambah changeset ke file release yang sama,
- module ownership kurang terlihat,
- file release bisa terlalu besar untuk release besar,
- hotfix perlu strategi khusus.

### 8.4 Kapan Tidak Cocok

Kurang cocok jika:

- sistem sangat modular,
- banyak tim bekerja paralel,
- release train panjang,
- database dipakai beberapa aplikasi,
- module memiliki ownership sangat berbeda.

---

## 9. Strategy B — Single Master + Module Changelog

Struktur:

```text
src/main/resources/db/changelog/
  db.changelog-master.yaml
  modules/
    application/
      application.changelog.yaml
    case-management/
      case-management.changelog.yaml
    correspondence/
      correspondence.changelog.yaml
    profile/
      profile.changelog.yaml
```

Master:

```yaml
databaseChangeLog:
  - include:
      file: db/changelog/modules/profile/profile.changelog.yaml
  - include:
      file: db/changelog/modules/application/application.changelog.yaml
  - include:
      file: db/changelog/modules/case-management/case-management.changelog.yaml
  - include:
      file: db/changelog/modules/correspondence/correspondence.changelog.yaml
```

Module changelog:

```yaml
databaseChangeLog:
  - include:
      file: db/changelog/modules/application/2026-01-application.yaml
  - include:
      file: db/changelog/modules/application/2026-02-application.yaml
```

### 9.1 Cocok Untuk

Strategi ini cocok untuk:

- sistem modular,
- domain besar,
- module ownership jelas,
- enterprise monolith,
- modular monolith,
- multi-team repository,
- regulatory/case-management system dengan banyak bounded context.

### 9.2 Kelebihan

- ownership jelas,
- file tidak terlalu besar,
- developer bekerja di module masing-masing,
- review lebih mudah berdasarkan domain,
- cocok untuk sistem dengan banyak module.

### 9.3 Kekurangan

- ordering antar module harus dipikirkan,
- foreign key cross-module bisa membuat dependency rumit,
- release boundary kurang jelas jika tidak ada metadata tambahan,
- perubahan lintas module bisa tersebar.

### 9.4 Risiko Dependency Antar Module

Misalnya module `case-management` membutuhkan table dari module `profile`.

Jika master include seperti ini:

```yaml
databaseChangeLog:
  - include:
      file: db/changelog/modules/case-management/case-management.changelog.yaml
  - include:
      file: db/changelog/modules/profile/profile.changelog.yaml
```

lalu `case-management` membuat foreign key ke `profile.user_profile`, migration bisa gagal karena table profile belum dibuat.

Urutan harus mencerminkan dependency:

```yaml
databaseChangeLog:
  - include:
      file: db/changelog/modules/profile/profile.changelog.yaml
  - include:
      file: db/changelog/modules/case-management/case-management.changelog.yaml
```

Namun ini juga bisa menimbulkan coupling.

Top engineer akan bertanya:

> Apakah foreign key cross-module ini memang perlu, atau kita sedang membuat database-level coupling yang membuat release antar module sulit?

---

## 10. Strategy C — Release + Module Hybrid

Struktur:

```text
src/main/resources/db/changelog/
  db.changelog-master.yaml
  releases/
    2026-01/
      00-release.yaml
      application.yaml
      case-management.yaml
      correspondence.yaml
      seed.yaml
    2026-02/
      00-release.yaml
      application.yaml
      profile.yaml
      backfill.yaml
```

Master:

```yaml
databaseChangeLog:
  - include:
      file: db/changelog/releases/2026-01/00-release.yaml
  - include:
      file: db/changelog/releases/2026-02/00-release.yaml
```

Release aggregator:

```yaml
databaseChangeLog:
  - include:
      file: db/changelog/releases/2026-01/application.yaml
  - include:
      file: db/changelog/releases/2026-01/case-management.yaml
  - include:
      file: db/changelog/releases/2026-01/correspondence.yaml
  - include:
      file: db/changelog/releases/2026-01/seed.yaml
```

### 10.1 Cocok Untuk

Strategi ini cocok untuk:

- enterprise application besar,
- banyak module,
- release cadence jelas,
- audit per release penting,
- ownership per module juga penting,
- banyak developer paralel.

### 10.2 Kelebihan

- release boundary jelas,
- module ownership tetap jelas,
- file lebih kecil,
- review lebih terarah,
- deployment mapping mudah,
- cocok untuk regulated environments.

### 10.3 Kekurangan

- struktur lebih kompleks,
- perlu disiplin naming,
- perlu convention yang kuat,
- developer baru perlu onboarding.

### 10.4 Rekomendasi untuk Sistem Besar

Untuk sistem besar, terutama enterprise case-management/regulatory platform, strategi hybrid sering paling sehat.

Contoh struktur realistis:

```text
src/main/resources/db/changelog/
  db.changelog-master.yaml

  releases/
    2026-01/
      00-release.yaml
      01-schema-application.yaml
      02-schema-case.yaml
      03-reference-data.yaml
      04-indexes.yaml
      05-backfill.yaml

    2026-02/
      00-release.yaml
      01-schema-profile.yaml
      02-schema-compliance.yaml
      03-reference-data.yaml
      04-backfill.yaml
      05-constraints.yaml
```

Dalam release, urutan file bisa mencerminkan jenis perubahan:

```text
1. schema expansion
2. object creation
3. seed/reference data
4. index
5. backfill
6. constraint tightening
```

Ini selaras dengan migration safety.

---

## 11. Strategy D — Feature-Based Changelog

Struktur:

```text
src/main/resources/db/changelog/
  db.changelog-master.yaml
  features/
    ACEASM-3182-audit-trail-internet-prefix/
      changelog.yaml
    ACEASM-4210-application-risk-level/
      changelog.yaml
    ACEASM-4305-onemap-token-cache/
      changelog.yaml
```

Master:

```yaml
databaseChangeLog:
  - include:
      file: db/changelog/features/ACEASM-3182-audit-trail-internet-prefix/changelog.yaml
  - include:
      file: db/changelog/features/ACEASM-4210-application-risk-level/changelog.yaml
```

### 11.1 Cocok Untuk

- feature branch workflow,
- ticket-driven delivery,
- traceability ke Jira/Azure DevOps,
- audit butuh mapping ke CR/ticket,
- project dengan perubahan database tersebar lintas module.

### 11.2 Kelebihan

- traceability kuat,
- mudah review per ticket,
- mudah menghapus feature sebelum merge,
- cocok untuk CR-driven delivery.

### 11.3 Kekurangan

- urutan antar feature bisa kacau,
- dependency antar feature harus manual,
- release boundary tidak natural,
- folder feature lama bisa menumpuk,
- tidak selalu cocok untuk long-lived product.

### 11.4 Feature-Based dengan Release Aggregator

Lebih aman jika feature changelog tidak langsung di-include oleh master.

Gunakan release aggregator:

```text
master
  -> releases/2026-01/00-release.yaml
       -> features/ACEASM-3182/changelog.yaml
       -> features/ACEASM-4210/changelog.yaml
```

Dengan begitu:

- feature tetap traceable,
- release order tetap eksplisit,
- master tetap bersih.

---

## 12. Strategy E — SQL-First Changelog

Liquibase tidak harus XML/YAML. Banyak team matang memilih **formatted SQL**.

Contoh:

```sql
--liquibase formatted sql

--changeset fajar:20260115-1000-create-application-table
CREATE TABLE application (
    id BIGINT NOT NULL,
    reference_no VARCHAR(50) NOT NULL,
    status VARCHAR(30) NOT NULL,
    created_at TIMESTAMP NOT NULL,
    CONSTRAINT pk_application PRIMARY KEY (id)
);

--rollback DROP TABLE application;
```

### 12.1 Cocok Untuk

- DBA-heavy organization,
- team nyaman dengan SQL,
- database-specific optimization penting,
- Oracle/PostgreSQL/SQL Server feature digunakan langsung,
- review dilakukan oleh engineer yang ingin melihat real SQL.

### 12.2 Kelebihan

- sangat readable untuk SQL engineer,
- tidak ada abstraction surprise,
- mudah copy ke DB client untuk analisis,
- cocok untuk vendor-specific DDL,
- cocok untuk performance-sensitive index/object creation.

### 12.3 Kekurangan

- database portability rendah,
- precondition lebih terbatas dibanding XML/YAML rich syntax,
- rollback tetap manual,
- struktur metadata tidak sekuat declarative changelog,
- raw SQL bisa jadi bebas liar jika tidak ada style guide.

### 12.4 Kapan SQL-First Lebih Baik

SQL-first biasanya lebih baik jika:

- target database production hanya satu vendor,
- team butuh kontrol penuh atas DDL,
- performance/locking matters,
- migration harus direview DBA,
- abstraction Liquibase justru menyembunyikan detail penting.

Contoh Oracle-specific:

```sql
--liquibase formatted sql

--changeset fajar:20260115-1100-create-audit-index
CREATE INDEX idx_audit_trail_created_module
ON audit_trail (created_date_time, module_id)
ONLINE;

--rollback DROP INDEX idx_audit_trail_created_module;
```

Declarative Liquibase mungkin tidak mengekspresikan semua nuance vendor dengan jelas.

---

## 13. Strategy F — Declarative Changelog

Declarative changelog menggunakan XML/YAML/JSON change type Liquibase.

Contoh YAML:

```yaml
databaseChangeLog:
  - changeSet:
      id: 20260115-1000-create-application-table
      author: fajar
      changes:
        - createTable:
            tableName: application
            columns:
              - column:
                  name: id
                  type: bigint
                  constraints:
                    primaryKey: true
                    nullable: false
              - column:
                  name: reference_no
                  type: varchar(50)
                  constraints:
                    nullable: false
              - column:
                  name: status
                  type: varchar(30)
                  constraints:
                    nullable: false
```

### 13.1 Cocok Untuk

- multi-database products,
- team ingin abstraction,
- generated rollback dibutuhkan untuk beberapa change type,
- precondition/context/label banyak dipakai,
- governance membutuhkan metadata kaya.

### 13.2 Kelebihan

- metadata jelas,
- change type lebih semantik,
- beberapa rollback bisa otomatis,
- bisa mendukung multi-DBMS lebih baik,
- bisa memakai precondition lebih rapi,
- lebih mudah diproses tooling.

### 13.3 Kekurangan

- lebih verbose,
- SQL aktual kadang tidak langsung terlihat,
- abstraction bisa menghasilkan SQL yang tidak optimal,
- developer perlu memahami Liquibase DSL,
- DBA mungkin lebih sulit review.

### 13.4 Declarative Bukan Berarti Vendor-Blind

Kesalahan umum:

> Karena Liquibase punya abstraction, berarti kita tidak perlu tahu database vendor.

Ini salah.

Declarative changelog tetap perlu vendor awareness.

Contoh:

- `boolean` di PostgreSQL berbeda dari Oracle legacy pattern,
- `timestamp with time zone` punya semantics berbeda,
- `clob`/`text`/`jsonb` berbeda,
- index online/concurrent punya syntax vendor-specific,
- transactional DDL berbeda,
- constraint validation behavior berbeda.

Liquibase membantu, tapi tidak menghapus kebutuhan database engineering.

---

## 14. Strategy G — Hybrid SQL + Declarative

Dalam banyak sistem enterprise, strategi terbaik adalah hybrid.

Gunakan declarative untuk perubahan standar:

- create table,
- add column,
- add simple constraint,
- insert reference data sederhana.

Gunakan SQL untuk perubahan vendor-specific atau performance-sensitive:

- online index,
- complex backfill,
- stored procedure,
- view/function/package,
- partition operation,
- optimizer hints,
- DB-specific DDL.

Contoh:

```yaml
databaseChangeLog:
  - changeSet:
      id: 20260115-1000-create-application-table
      author: fajar
      changes:
        - createTable:
            tableName: application
            columns:
              - column:
                  name: id
                  type: bigint
                  constraints:
                    primaryKey: true
                    nullable: false

  - changeSet:
      id: 20260115-1100-create-application-search-index
      author: fajar
      changes:
        - sqlFile:
            path: db/changelog/sql/20260115-1100-create-application-search-index-oracle.sql
            relativeToChangelogFile: false
```

SQL file:

```sql
CREATE INDEX idx_application_search
ON application (status, created_at)
ONLINE;
```

### 14.1 Prinsip Hybrid yang Sehat

Hybrid sehat jika ada aturan:

```text
Use declarative changelog by default.
Use SQL when database-specific behavior matters.
Document why raw SQL is used.
```

Hybrid buruk jika:

```text
Some developers use YAML.
Some developers use XML.
Some use random SQL.
No convention.
No reason.
No consistency.
```

---

## 15. Changeset Identity Design

Liquibase identity sangat penting.

Satu changeset diidentifikasi oleh kombinasi:

```text
id + author + file path
```

Bukan hanya `id`.

Ini membawa konsekuensi besar.

Jika file dipindahkan, Liquibase bisa menganggap changeset sebagai changeset berbeda kecuali memakai `logicalFilePath`.

Jika `id` diubah, Liquibase melihat changeset berbeda.

Jika `author` diubah, Liquibase melihat changeset berbeda.

Jika file path berubah, Liquibase bisa melihat changeset berbeda.

### 15.1 ID yang Buruk

Contoh buruk:

```yaml
id: 1
```

```yaml
id: create-table
```

```yaml
id: update
```

```yaml
id: fajar-change
```

Masalah:

- rawan duplicate,
- tidak sortable,
- tidak traceable,
- tidak menjelaskan waktu,
- tidak menjelaskan intent.

### 15.2 ID yang Baik

Contoh lebih baik:

```yaml
id: 20260115-1000-create-application-table
```

Atau dengan ticket:

```yaml
id: ACEASM-4210-20260115-1000-add-application-risk-level
```

Atau module-aware:

```yaml
id: application-20260115-1000-add-risk-level
```

### 15.3 Recommended ID Pattern

Untuk sistem enterprise, pattern yang sehat:

```text
<module-or-ticket>-<yyyyMMddHHmm>-<short-intent>
```

Contoh:

```text
application-202601151000-create-application-table
case-202601151030-add-case-priority
profile-202601151100-add-user-type-index
ACEASM-4210-202601151130-backfill-risk-level
```

Jika ingin lebih pendek:

```text
202601151000-create-application-table
```

Yang penting:

- unik,
- readable,
- sortable,
- tidak berubah setelah merge,
- menjelaskan intent.

### 15.4 Jangan Pakai Nomor Increment Manual Global

Contoh:

```yaml
id: 001
id: 002
id: 003
```

Ini terlihat rapi di awal, tapi berbahaya di tim paralel.

Developer A membuat:

```yaml
id: 104
```

Developer B juga membuat:

```yaml
id: 104
```

Merge conflict atau duplicate execution confusion muncul.

Timestamp ID lebih scalable.

---

## 16. Author Convention

`author` di Liquibase adalah bagian dari identity.

Karena itu harus stabil.

Contoh buruk:

```yaml
author: me
```

```yaml
author: dev
```

```yaml
author: admin
```

```yaml
author: fajar.abdi.nugraha@company.com
```

Email bisa berubah, terlalu panjang, dan kadang mengandung informasi personal yang tidak perlu.

Contoh baik:

```yaml
author: fajar
```

Atau untuk team ownership:

```yaml
author: aceas-team
```

Atau untuk generated baseline:

```yaml
author: baseline-generator
```

### 16.1 Personal Author vs Team Author

Ada dua model.

#### Model Personal Author

```yaml
author: fajar
```

Kelebihan:

- traceability ke developer,
- mudah audit awal,
- mudah tanya orang yang membuat.

Kekurangan:

- orang resign,
- ownership sebenarnya team,
- bisa membingungkan jika changeset diedit oleh reviewer.

#### Model Team Author

```yaml
author: platform-team
```

Kelebihan:

- ownership kolektif,
- lebih stabil,
- cocok untuk regulated team.

Kekurangan:

- traceability personal pindah ke Git history/PR,
- perlu discipline review.

### 16.2 Rekomendasi

Untuk project enterprise, gunakan:

```text
Liquibase author = stable team or short developer handle.
True audit identity = Git commit + PR + approval + CI artifact.
```

Jangan jadikan `author` satu-satunya audit source.

`DATABASECHANGELOG` memberi execution history, tapi governance production harus mengaitkan:

- Git commit,
- PR approval,
- build artifact,
- release ticket,
- deployment log,
- DB execution log.

---

## 17. File Path Identity and `logicalFilePath`

Karena path file adalah bagian dari identity, refactoring folder bisa berbahaya.

Misalnya awalnya:

```text
db/changelog/2026-01.yaml
```

Changeset:

```yaml
id: 20260115-1000-create-application-table
author: fajar
```

Liquibase mencatat path itu di `DATABASECHANGELOG`.

Lalu file dipindah menjadi:

```text
db/changelog/releases/2026-01.yaml
```

Tanpa mitigasi, Liquibase bisa menganggap changeset tersebut belum pernah dijalankan karena path berubah.

### 17.1 Fungsi `logicalFilePath`

`logicalFilePath` memberi path logical yang stabil.

Contoh:

```yaml
databaseChangeLog:
  - logicalFilePath: db/changelog/releases/2026-01.yaml
  - changeSet:
      id: 20260115-1000-create-application-table
      author: fajar
      changes:
        - createTable:
            tableName: application
            columns:
              - column:
                  name: id
                  type: bigint
```

Dengan logical file path, identity tidak bergantung sepenuhnya pada lokasi fisik baru.

### 17.2 Kapan Wajib Memikirkan `logicalFilePath`

Pertimbangkan `logicalFilePath` jika:

- repository masih berkembang,
- struktur folder mungkin berubah,
- changelog dihasilkan dari beberapa module,
- file dipindahkan saat refactoring,
- baseline/import dari legacy changelog,
- enterprise project dengan umur panjang.

### 17.3 Prinsip

```text
Once a changeset is executed in production, its identity must be treated as immutable.
```

Identity mencakup:

- id,
- author,
- logical/physical path.

---

## 18. `include` vs `includeAll`

Ini salah satu keputusan desain paling penting.

### 18.1 `include`

`include` eksplisit menyebut file.

```yaml
databaseChangeLog:
  - include:
      file: db/changelog/releases/2026-01.yaml
  - include:
      file: db/changelog/releases/2026-02.yaml
```

Kelebihan:

- order jelas,
- review mudah,
- tidak bergantung pada sorting filename saja,
- aman untuk regulated deployment,
- perubahan file baru harus eksplisit.

Kekurangan:

- perlu update aggregator file,
- bisa ada merge conflict jika banyak developer menambah include di file sama.

### 18.2 `includeAll`

`includeAll` memasukkan semua file dalam folder.

```yaml
databaseChangeLog:
  - includeAll:
      path: db/changelog/releases
```

Kelebihan:

- praktis,
- tidak perlu edit master setiap kali tambah file,
- cocok untuk generated changelog tertentu.

Kekurangan:

- order bergantung pada sorting,
- file tidak sengaja masuk bisa dieksekusi,
- review order kurang eksplisit,
- rename file bisa mengubah order,
- sulit untuk release governance,
- rawan hidden migration.

### 18.3 Recommended Default

Untuk production-grade enterprise system:

```text
Prefer explicit include over includeAll.
```

Gunakan `includeAll` hanya jika:

- folder benar-benar dikontrol,
- naming sortable sangat ketat,
- ada CI check untuk ordering,
- tidak ada file eksperimental di folder itu,
- team paham konsekuensi.

### 18.4 Anti-Pattern `includeAll`

```yaml
databaseChangeLog:
  - includeAll:
      path: db/changelog
```

Masalah:

- semua file dalam folder bisa ikut,
- file backup bisa tereksekusi,
- urutan bisa mengejutkan,
- sulit audit.

Contoh file berbahaya:

```text
db/changelog/
  2026-01.yaml
  2026-02.yaml
  old.yaml
  temp-test.yaml
  do-not-run.yaml
```

Jika `includeAll` terlalu luas, file yang tidak dimaksudkan bisa masuk execution plan.

---

## 19. Ordering Strategy

Urutan migration harus terlihat dari struktur dan nama.

### 19.1 Timestamp Ordering

Contoh:

```text
202601151000-create-application-table.yaml
202601151030-add-application-status-index.yaml
202601151100-seed-application-status.yaml
```

Kelebihan:

- globally sortable,
- mengurangi conflict,
- cocok untuk parallel development.

Kekurangan:

- timestamp bisa palsu,
- tidak selalu mencerminkan dependency,
- developer bisa membuat timestamp yang bentrok.

### 19.2 Sequence Ordering per Release

Contoh:

```text
01-schema-application.yaml
02-schema-case.yaml
03-reference-data.yaml
04-backfill.yaml
05-constraints.yaml
```

Kelebihan:

- order jelas,
- bagus untuk release aggregator,
- cocok untuk deployment choreography.

Kekurangan:

- perlu koordinasi,
- merge conflict bisa muncul,
- reordering perlu hati-hati sebelum production.

### 19.3 Hybrid Ordering

Contoh:

```text
2026-01/
  00-release.yaml
  01-application-schema.yaml
  02-case-schema.yaml
  03-reference-data.yaml
  04-backfill.yaml
  05-constraints.yaml
```

Changeset ID tetap timestamp/ticket-based.

File order per release tetap sequence-based.

Ini sering paling mudah dipahami manusia.

---

## 20. Designing Release Changelogs

Release changelog harus menjawab:

```text
Apa perubahan database yang masuk release ini?
Dalam urutan apa?
Mana expansion?
Mana seed?
Mana backfill?
Mana constraint tightening?
```

Contoh:

```yaml
databaseChangeLog:
  - include:
      file: db/changelog/releases/2026-01/01-expand-schema.yaml
  - include:
      file: db/changelog/releases/2026-01/02-reference-data.yaml
  - include:
      file: db/changelog/releases/2026-01/03-backfill.yaml
  - include:
      file: db/changelog/releases/2026-01/04-indexes.yaml
  - include:
      file: db/changelog/releases/2026-01/05-constraints.yaml
```

Kenapa order ini masuk akal?

1. Tambah struktur dulu.
2. Tambah reference data yang dibutuhkan aplikasi.
3. Isi data lama.
4. Tambah index untuk query baru.
5. Baru ketatkan constraint setelah data valid.

Ini adalah contoh desain changelog yang mengikuti migration safety.

---

## 21. Schema Changes vs Seed Changes vs Backfill Changes

Jangan mencampur semua ke satu file tanpa struktur.

Contoh buruk:

```yaml
2026-01.yaml
  - create table
  - insert status
  - update 10 million rows
  - create index
  - insert permission
  - add not null constraint
```

Contoh lebih baik:

```text
2026-01/
  01-schema.yaml
  02-reference-data.yaml
  03-permission-seed.yaml
  04-backfill-risk-level.yaml
  05-indexes.yaml
  06-constraints.yaml
```

Kenapa dipisah?

Karena masing-masing punya review concern berbeda.

### 21.1 Schema Review Concern

- Apakah tipe data tepat?
- Apakah nama table/column konsisten?
- Apakah constraint benar?
- Apakah index perlu?
- Apakah perubahan backward compatible?

### 21.2 Seed Review Concern

- Apakah natural key stabil?
- Apakah id deterministic?
- Apakah data boleh berubah di production?
- Apakah seed idempotent?
- Apakah environment-specific?

### 21.3 Backfill Review Concern

- Berapa rows terdampak?
- Apakah lock besar?
- Apakah transaksi terlalu panjang?
- Apakah bisa resume?
- Apakah perlu dijalankan sebagai batch job terpisah?
- Apakah validasi tersedia?

Mencampur semuanya membuat review dangkal.

---

## 22. Directory Structure Recommendations

### 22.1 Small Project

Untuk project kecil:

```text
src/main/resources/db/changelog/
  db.changelog-master.yaml
  releases/
    2026-01.yaml
    2026-02.yaml
```

Cukup.

Jangan over-engineer.

### 22.2 Medium Project

Untuk project menengah:

```text
src/main/resources/db/changelog/
  db.changelog-master.yaml
  releases/
    2026-01/
      00-release.yaml
      01-schema.yaml
      02-seed.yaml
      03-indexes.yaml
    2026-02/
      00-release.yaml
      01-schema.yaml
      02-backfill.yaml
      03-constraints.yaml
```

### 22.3 Large Modular Enterprise Project

Untuk sistem besar:

```text
src/main/resources/db/changelog/
  db.changelog-master.yaml

  releases/
    2026-01/
      00-release.yaml
      modules/
        application.yaml
        case-management.yaml
        correspondence.yaml
      data/
        reference-data.yaml
        permission-seed.yaml
      operations/
        indexes.yaml
        backfill.yaml
        constraints.yaml

    2026-02/
      00-release.yaml
      modules/
        profile.yaml
        compliance.yaml
      data/
        reference-data.yaml
      operations/
        backfill.yaml
        indexes.yaml
```

### 22.4 Very Large Multi-Team System

Untuk sangat besar:

```text
src/main/resources/db/changelog/
  db.changelog-master.yaml

  releases/
    2026-Q1/
      2026-01/
        00-release.yaml
        01-expand.yaml
        02-seed.yaml
        03-backfill.yaml
        04-contract.yaml
      2026-02/
        00-release.yaml
      2026-03/
        00-release.yaml

  modules/
    application/
      README.md
    case-management/
      README.md
    profile/
      README.md

  sql/
    oracle/
    postgresql/
    sqlserver/
```

Namun hati-hati: struktur besar hanya berguna jika ada governance.

Tanpa governance, struktur besar hanya menjadi labirin.

---

## 23. Changelog README per Folder

Untuk project besar, setiap folder changelog penting sebaiknya punya `README.md` kecil.

Contoh:

```text
db/changelog/releases/README.md
```

Isi:

```markdown
# Release Changelog Rules

- Add new database changes under the active release folder.
- Do not edit changesets that have been deployed to UAT or production.
- Use explicit include from `00-release.yaml`.
- Split schema, seed, backfill, indexes, and constraints.
- Use changeset id pattern: `<module>-<yyyyMMddHHmm>-<intent>`.
- Use author: `aceas-team` unless instructed otherwise.
```

Ini terlihat sederhana, tetapi sangat membantu onboarding.

---

## 24. Designing for Reviewability

Changelog harus mudah direview.

Review database migration berbeda dari review business code.

Reviewer harus bisa menjawab:

- Apa objek database yang berubah?
- Apakah perubahan backward compatible?
- Apakah ada data loss?
- Apakah ada long lock?
- Apakah ada full table update?
- Apakah migration bisa dijalankan ulang?
- Apakah seed deterministic?
- Apakah ada rollback/roll-forward reasoning?
- Apakah ada impact ke old app version?
- Apakah ada impact ke reporting/query/index?

### 24.1 Naming untuk Review

Nama changeset harus menjelaskan intent.

Buruk:

```yaml
id: 202601151000-update-table
```

Baik:

```yaml
id: application-202601151000-add-risk-level-nullable-column
```

Lebih baik lagi jika bagian dari expand/contract:

```yaml
id: application-202601151000-expand-add-risk-level-nullable-column
```

### 24.2 File Split untuk Review

Jangan membuat reviewer membaca 700 baris untuk menemukan 1 backfill berbahaya.

Pisahkan:

```text
01-schema-expand.yaml
02-reference-data.yaml
03-backfill-risk-level.yaml
04-constraints-contract.yaml
```

### 24.3 Comment di Changelog

Komentar bukan dekorasi. Komentar menjelaskan operational intent.

Contoh:

```yaml
  - changeSet:
      id: application-202601151000-add-risk-level-nullable-column
      author: aceas-team
      comments: >
        Expand phase for risk-level migration. Column is intentionally nullable
        because existing rows will be backfilled in a later changeset before
        NOT NULL constraint is introduced.
      changes:
        - addColumn:
            tableName: application
            columns:
              - column:
                  name: risk_level
                  type: varchar(20)
```

Komentar ini membantu reviewer mengerti bahwa nullable bukan kelalaian, tapi strategi.

---

## 25. Changelog Ownership

Dalam sistem besar, harus jelas siapa yang boleh mengubah apa.

Ownership bisa berbasis:

- module,
- bounded context,
- database schema,
- release team,
- platform team,
- DBA team.

### 25.1 Ownership Model A — Application Team Owns All

Cocok untuk:

- single app,
- single team,
- startup/small team.

Kelebihan:

- cepat,
- sederhana,
- tidak banyak handoff.

Kekurangan:

- risk meningkat jika team kurang database maturity,
- DBA review tidak sistematis.

### 25.2 Ownership Model B — Module Team Owns Module Tables

Cocok untuk:

- modular monolith,
- domain-driven team,
- large enterprise app.

Aturan:

```text
Each module owns its table definitions, indexes, reference data, and backfills.
Cross-module changes require explicit review from both owners.
```

### 25.3 Ownership Model C — Platform/DBA Gatekeeper

Cocok untuk:

- regulated environment,
- high-risk production DB,
- financial/government systems,
- shared database.

Kelebihan:

- control kuat,
- audit kuat,
- performance risk lebih terkendali.

Kekurangan:

- bisa memperlambat delivery,
- ownership bisa kabur jika DBA hanya gatekeeper, bukan domain owner,
- developer bisa menganggap database change sebagai “lempar ke DBA”.

### 25.4 Rekomendasi Praktis

Gunakan model gabungan:

```text
Developers own intent and application contract.
DBA/platform reviews operational safety.
Release owner controls promotion.
CI/CD enforces mechanical rules.
```

---

## 26. Generated Changelog: Useful but Dangerous

Liquibase bisa generate changelog dari existing database.

Ini berguna untuk:

- baseline awal,
- reverse engineering legacy schema,
- comparison,
- documentation,
- starting point.

Tapi generated changelog sering buruk jika langsung dipakai sebagai production migration jangka panjang.

### 26.1 Masalah Generated Changelog

Generated changelog bisa menghasilkan:

- ordering yang tidak ideal,
- constraint naming tidak konsisten,
- index noise,
- default value noise,
- vendor-specific detail berlebihan,
- object ownership tidak jelas,
- giant file,
- tidak ada intent,
- tidak ada expand/contract reasoning.

Generated changelog menjawab:

```text
What exists in the database?
```

Bukan:

```text
Why should this change happen?
How should this change be deployed safely?
What is the application contract?
```

### 26.2 Kapan Generated Changelog Boleh Dipakai

Boleh dipakai untuk:

- baseline legacy database,
- local dev bootstrap awal,
- documentation snapshot,
- schema diff investigation.

Tidak boleh langsung dipakai tanpa review untuk:

- production release migration,
- zero-downtime migration,
- large table changes,
- regulated audit trail,
- multi-team ownership.

### 26.3 Baseline Pattern

Untuk existing production database:

```text
1. Generate baseline changelog from production-like schema.
2. Review and normalize generated output.
3. Mark it as baseline.
4. Do not treat baseline as future migration style.
5. Future changes must be hand-authored and reviewable.
```

---

## 27. Changelog Mutability Rules

Aturan paling penting:

```text
Never edit a changeset that has already been executed in a shared environment.
```

Shared environment termasuk:

- SIT,
- UAT,
- staging,
- production,
- shared dev database.

Kenapa?

Karena checksum akan berubah.

Liquibase akan mendeteksi mismatch.

Lebih penting lagi: histori berubah.

### 27.1 Apa yang Boleh Diubah?

Sebelum merged/deployed:

- boleh squash,
- boleh rename,
- boleh edit id,
- boleh edit content,
- boleh restructure.

Setelah masuk shared environment:

- jangan edit content,
- jangan edit id,
- jangan edit author,
- jangan pindahkan path tanpa strategy,
- jangan hapus file.

Jika ada kesalahan, buat changeset baru.

### 27.2 Contoh Salah

Migration lama:

```yaml
id: application-202601151000-add-risk-level
```

Sudah jalan di UAT.

Lalu developer sadar type harus `varchar(30)`, bukan `varchar(20)`.

Jangan ubah file lama.

Buat changeset baru:

```yaml
id: application-202601161000-alter-risk-level-length-to-30
```

### 27.3 Kenapa Ini Penting

Karena database migration history adalah audit trail teknis.

Mengedit perubahan historis sama seperti mengedit catatan kejadian setelah fakta terjadi.

Dalam production-grade engineering, itu harus dihindari.

---

## 28. Checksum Management

Checksum Liquibase mendeteksi perubahan pada changeset.

Checksum mismatch bisa muncul karena:

- content changeset berubah,
- whitespace/comment tertentu berubah tergantung format,
- file berubah,
- changelog format berubah,
- line ending berubah dalam kasus tertentu,
- Liquibase version behavior berubah.

### 28.1 Jangan Menganggap Checksum sebagai Gangguan

Checksum bukan musuh.

Checksum adalah guardrail.

Jika checksum mismatch muncul, pertanyaan yang benar bukan:

```text
How do I bypass this quickly?
```

Pertanyaan yang benar:

```text
Why did a previously executed changeset change?
Was this intentional?
Has this run in production?
What is the safe recovery action?
```

### 28.2 `validCheckSum`

Liquibase mendukung valid checksum untuk kasus tertentu.

Namun jangan jadikan ini kebiasaan untuk membenarkan edit sembarangan.

Gunakan hanya jika:

- perubahan benar-benar non-semantic,
- ada alasan jelas,
- disetujui reviewer,
- tercatat dalam PR,
- environment impact dipahami.

### 28.3 Better Pattern

Lebih aman:

```text
Do not modify executed changeset.
Add a new corrective changeset.
```

---

## 29. Contexts and Labels in Changelog Design

Part 14 akan membahas contexts/labels secara detail. Di sini kita bahas dari sisi desain changelog.

Contexts dan labels powerful, tapi bisa membuat changelog bercabang liar.

Contoh:

```yaml
context: dev
```

```yaml
context: prod
```

```yaml
labels: feature-x
```

### 29.1 Bahaya Environment Branching

Contoh buruk:

```yaml
  - changeSet:
      id: seed-admin-user
      author: dev
      context: dev,test,uat,prod
      changes:
        - insert: ...
```

Lalu ada changeset lain:

```yaml
  - changeSet:
      id: seed-admin-user-prod
      author: dev
      context: prod
      changes:
        - insert: ...
```

Lama-lama behavior tiap environment berbeda.

Dev tidak merepresentasikan prod.

UAT punya data beda.

Production punya branch khusus.

Debugging menjadi sulit.

### 29.2 Prinsip Context/Label

Gunakan context/label untuk memilih **kapan perubahan dijalankan**, bukan untuk membuat database contract berbeda secara liar.

Baik:

```text
context: test-data
```

untuk seed data testing yang tidak masuk production.

Baik:

```text
labels: release-2026-01
```

untuk release targeting.

Hati-hati:

```text
context: prod
```

untuk perubahan schema yang hanya ada di production.

Itu bisa menciptakan drift.

---

## 30. Changelog for Seed Data

Seed data perlu desain sendiri.

Jangan semua seed dimasukkan ke `data.sql` atau changeset acak.

### 30.1 Seed Folder Pattern

Contoh:

```text
db/changelog/releases/2026-01/data/
  01-reference-application-status.yaml
  02-permission-seed.yaml
  03-feature-flag-seed.yaml
```

Atau:

```text
db/changelog/modules/application/data/
  application-status-seed.yaml
```

### 30.2 Seed Changeset ID

Gunakan natural intent:

```yaml
id: reference-data-202601151000-seed-application-status
```

atau:

```yaml
id: permission-202601151030-seed-application-review-permissions
```

### 30.3 Seed Should Be Idempotent?

Liquibase changeset secara default hanya jalan sekali.

Namun seed logic tetap perlu deterministic.

Kenapa?

Karena:

- production mungkin sudah punya sebagian data,
- hotfix bisa perlu re-run logic dalam bentuk changeset baru,
- multiple environment bisa berbeda,
- manual data drift bisa terjadi,
- seed update harus jelas.

Seed design akan dibahas detail di Part 17 dan Part 18.

Di level changelog design, prinsipnya:

```text
Separate schema migration from seed migration.
Separate reference seed from test seed.
Separate production seed from local/demo data.
```

---

## 31. Changelog for Backfill

Backfill sering lebih berisiko daripada DDL.

Contoh:

```sql
UPDATE application
SET risk_level = 'LOW'
WHERE risk_level IS NULL;
```

Di tabel kecil, ini aman.

Di tabel 100 juta rows, ini bisa menjadi incident.

### 31.1 Backfill Folder Pattern

```text
db/changelog/releases/2026-01/backfill/
  01-backfill-application-risk-level.yaml
  02-verify-application-risk-level.yaml
```

### 31.2 Backfill Metadata

Backfill changeset harus punya komentar:

```yaml
comments: >
  Backfills risk_level for existing application rows. Expected row count in
  production is approximately 1.2M. This migration is safe because the update
  is filtered and the column is not indexed yet. For larger volume, move to
  external batch job.
```

### 31.3 Jangan Sembunyikan Backfill Besar

Buruk:

```yaml
id: update-application
changes:
  - sql: UPDATE application SET ...
```

Baik:

```yaml
id: application-202601151200-backfill-risk-level-existing-rows
```

Backfill harus terlihat dari nama.

---

## 32. Changelog for Constraints

Constraint tightening sebaiknya dipisah dari schema expansion.

Contoh unsafe:

```yaml
  - changeSet:
      id: add-risk-level-not-null
      changes:
        - addColumn:
            tableName: application
            columns:
              - column:
                  name: risk_level
                  type: varchar(20)
                  constraints:
                    nullable: false
```

Jika table sudah berisi data, ini bisa gagal.

Pattern lebih aman:

```text
1. add nullable column
2. deploy app dual-write/default-write
3. backfill old rows
4. validate no null remains
5. add not null constraint
```

Changelog structure:

```text
01-expand-schema.yaml
03-backfill.yaml
05-contract-constraints.yaml
```

Ini membuat lifecycle terlihat.

---

## 33. Changelog for Indexes

Index bukan detail kecil.

Index bisa:

- lock table,
- consume disk besar,
- membuat migration lama,
- mempengaruhi optimizer,
- gagal karena duplicate key jika unique,
- butuh syntax online/concurrent.

Karena itu index changeset sebaiknya mudah ditemukan.

Contoh:

```yaml
  - changeSet:
      id: application-202601151300-create-idx-application-status-created-at
      author: aceas-team
      comments: >
        Supports application listing query filtered by status and ordered by created_at.
        Review production execution plan before deployment.
      changes:
        - createIndex:
            tableName: application
            indexName: idx_application_status_created_at
            columns:
              - column:
                  name: status
              - column:
                  name: created_at
```

Untuk vendor-specific online index, gunakan SQL file bila perlu.

---

## 34. Changelog for Database Objects

Object seperti:

- view,
- function,
- procedure,
- trigger,
- package,
- materialized view,
- synonym,
- grant,
- sequence,
- type,

perlu strategi khusus.

### 34.1 Versioned vs Repeatable Object Changes

Liquibase tidak punya konsep repeatable seperti Flyway secara natural dengan mekanik yang sama, tetapi bisa mengelola object definition melalui changeset biasa.

Ada dua pendekatan:

#### Pendekatan Versioned

Setiap perubahan object adalah changeset baru.

```text
202601151000-create-application-summary-view
202602011000-replace-application-summary-view-add-risk-level
```

Kelebihan:

- histori jelas,
- audit kuat.

Kekurangan:

- object definition tersebar di banyak changeset,
- sulit melihat final definition.

#### Pendekatan Current Definition File

Simpan final definition di SQL file dan jalankan sebagai changeset baru setiap berubah.

```text
views/application_summary_view.sql
```

Changeset:

```yaml
  - changeSet:
      id: view-202602011000-replace-application-summary-view
      author: aceas-team
      changes:
        - sqlFile:
            path: db/changelog/objects/views/application_summary_view.sql
```

Tapi hati-hati: jika SQL file yang sama diubah, checksum changeset lama bisa berubah jika path sama dan changeset sama.

Lebih aman gunakan file versioned:

```text
objects/views/application_summary_view/20260115-create.sql
objects/views/application_summary_view/20260201-add-risk-level.sql
```

### 34.2 Object Definition Best Practice

Untuk object kompleks:

```text
Keep final object definition readable.
Keep migration history immutable.
Do not overwrite SQL file referenced by executed changeset.
```

---

## 35. XML vs YAML vs JSON vs SQL

Liquibase mendukung beberapa format. Pilihan format mempengaruhi readability dan governance.

### 35.1 XML

Contoh:

```xml
<databaseChangeLog
    xmlns="http://www.liquibase.org/xml/ns/dbchangelog"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xsi:schemaLocation="http://www.liquibase.org/xml/ns/dbchangelog
    http://www.liquibase.org/xml/ns/dbchangelog/dbchangelog-latest.xsd">

    <changeSet id="20260115-1000-create-application-table" author="fajar">
        <createTable tableName="application">
            <column name="id" type="bigint">
                <constraints primaryKey="true" nullable="false"/>
            </column>
            <column name="reference_no" type="varchar(50)">
                <constraints nullable="false"/>
            </column>
        </createTable>
    </changeSet>
</databaseChangeLog>
```

Kelebihan:

- mature,
- schema validation kuat,
- explicit,
- banyak contoh historis.

Kekurangan:

- verbose,
- noisy untuk review,
- kurang nyaman untuk developer modern.

### 35.2 YAML

Kelebihan:

- lebih ringkas,
- readable,
- populer di Spring Boot ecosystem,
- cukup ekspresif.

Kekurangan:

- indentation-sensitive,
- kesalahan indent bisa membingungkan,
- schema validation tidak sekuat XML di beberapa setup.

### 35.3 JSON

Jarang dipilih untuk hand-authored changelog.

Kelebihan:

- machine-friendly,
- strict syntax.

Kekurangan:

- kurang nyaman untuk migration manusia,
- komentar tidak natural,
- verbose.

### 35.4 Formatted SQL

Kelebihan:

- paling dekat dengan database,
- mudah untuk DBA,
- bagus untuk vendor-specific SQL.

Kekurangan:

- metadata/precondition tidak sekuat YAML/XML,
- raw SQL bisa liar,
- portability rendah.

### 35.5 Rekomendasi

Untuk banyak Java enterprise project:

```text
YAML for general changelog orchestration.
SQL files for complex/vendor-specific operations.
XML only if organization already standardized on XML.
Avoid JSON unless generated/tooling-driven.
```

---

## 36. Example: Recommended Changelog Structure for Java Enterprise App

Berikut contoh struktur yang seimbang.

```text
src/main/resources/
  db/
    changelog/
      db.changelog-master.yaml

      releases/
        2026-01/
          00-release.yaml
          01-expand-schema.yaml
          02-reference-data.yaml
          03-permissions.yaml
          04-backfill.yaml
          05-indexes.yaml
          06-contract-constraints.yaml

        2026-02/
          00-release.yaml
          01-expand-schema.yaml
          02-reference-data.yaml
          03-backfill.yaml
          04-indexes.yaml
          05-contract-constraints.yaml

      sql/
        oracle/
          indexes/
          backfill/
          objects/
        postgresql/
          indexes/
          backfill/
          objects/
```

Master:

```yaml
databaseChangeLog:
  - include:
      file: db/changelog/releases/2026-01/00-release.yaml
  - include:
      file: db/changelog/releases/2026-02/00-release.yaml
```

Release aggregator:

```yaml
databaseChangeLog:
  - include:
      file: db/changelog/releases/2026-01/01-expand-schema.yaml
  - include:
      file: db/changelog/releases/2026-01/02-reference-data.yaml
  - include:
      file: db/changelog/releases/2026-01/03-permissions.yaml
  - include:
      file: db/changelog/releases/2026-01/04-backfill.yaml
  - include:
      file: db/changelog/releases/2026-01/05-indexes.yaml
  - include:
      file: db/changelog/releases/2026-01/06-contract-constraints.yaml
```

Schema file:

```yaml
databaseChangeLog:
  - changeSet:
      id: application-202601151000-expand-add-risk-level-column
      author: aceas-team
      comments: >
        Expand phase. Adds nullable risk_level column. Backfill and NOT NULL
        constraint are handled in later changesets.
      changes:
        - addColumn:
            tableName: application
            columns:
              - column:
                  name: risk_level
                  type: varchar(20)
```

Backfill file:

```yaml
databaseChangeLog:
  - changeSet:
      id: application-202601151200-backfill-risk-level
      author: aceas-team
      comments: >
        Backfills risk_level for existing rows based on current status.
        Must be reviewed for row count and lock impact before production.
      changes:
        - sql:
            sql: |
              UPDATE application
              SET risk_level = CASE
                  WHEN status IN ('REJECTED', 'SUSPENDED') THEN 'HIGH'
                  WHEN status IN ('PENDING_REVIEW') THEN 'MEDIUM'
                  ELSE 'LOW'
              END
              WHERE risk_level IS NULL;
```

Constraint file:

```yaml
databaseChangeLog:
  - changeSet:
      id: application-202601151400-contract-risk-level-not-null
      author: aceas-team
      preConditions:
        - onFail: HALT
        - sqlCheck:
            expectedResult: 0
            sql: SELECT COUNT(*) FROM application WHERE risk_level IS NULL
      changes:
        - addNotNullConstraint:
            tableName: application
            columnName: risk_level
            columnDataType: varchar(20)
```

Ini jauh lebih jelas daripada satu changeset besar.

---

## 37. Example: Bad Changelog and Why It Fails

Contoh buruk:

```yaml
databaseChangeLog:
  - changeSet:
      id: 1
      author: dev
      changes:
        - addColumn:
            tableName: application
            columns:
              - column:
                  name: risk_level
                  type: varchar(20)
                  constraints:
                    nullable: false
        - sql:
            sql: UPDATE application SET risk_level = 'LOW'
        - createIndex:
            tableName: application
            indexName: idx1
            columns:
              - column:
                  name: risk_level
```

Masalah:

1. `id: 1` tidak scalable.
2. `author: dev` tidak meaningful.
3. Add not null column bisa gagal jika table berisi data.
4. Backfill setelah not-null terlambat.
5. Full update tanpa WHERE.
6. Index name tidak descriptive.
7. Schema, data, index dicampur.
8. Tidak ada precondition.
9. Tidak ada komentar operational.
10. Tidak ada rollback reasoning.

Versi lebih baik:

```text
01-expand-schema.yaml
  - add nullable risk_level

03-backfill.yaml
  - update only rows where risk_level is null

05-indexes.yaml
  - create descriptive index

06-contract-constraints.yaml
  - precondition count null = 0
  - add not null constraint
```

---

## 38. Changelog Design for Existing Legacy Database

Banyak sistem Java tidak mulai dari empty database.

Ada existing schema.

### 38.1 Masalah Legacy

- schema dibuat manual,
- tidak ada migration history,
- environment drift,
- object berbeda antar UAT/prod,
- constraint naming tidak konsisten,
- seed data beda,
- stored procedure tidak terdokumentasi,
- table dibuat oleh beberapa aplikasi.

### 38.2 Baseline Strategy

Pattern:

```text
1. Freeze manual schema changes.
2. Take production schema snapshot.
3. Generate baseline changelog or write baseline marker.
4. Validate lower environments against baseline.
5. Apply Liquibase from baseline onward.
6. New changes must be Liquibase-managed.
```

### 38.3 Baseline Changelog Structure

```text
db/changelog/
  db.changelog-master.yaml
  baseline/
    2026-01-production-baseline.yaml
  releases/
    2026-02/
      00-release.yaml
```

Master:

```yaml
databaseChangeLog:
  - include:
      file: db/changelog/baseline/2026-01-production-baseline.yaml
  - include:
      file: db/changelog/releases/2026-02/00-release.yaml
```

Namun untuk production existing database, baseline changeset tidak selalu dijalankan sebagai DDL. Bisa juga database ditandai sudah berada pada baseline menggunakan mekanisme Liquibase baseline/changelog sync sesuai strategi operasional.

Intinya:

```text
Baseline is a boundary between unmanaged past and managed future.
```

---

## 39. Changelog Design in Multi-Database Product

Jika produk Java mendukung banyak database vendor, changelog design berubah.

Misalnya support:

- PostgreSQL,
- Oracle,
- SQL Server.

### 39.1 Option 1 — Common Changelog with DBMS Conditions

```yaml
  - changeSet:
      id: app-202601151000-create-json-column
      author: platform-team
      changes:
        - addColumn:
            tableName: application
            columns:
              - column:
                  name: metadata
                  type: json
```

Masalah: `json` tidak sama di semua DB.

Gunakan `dbms` split:

```yaml
  - changeSet:
      id: app-202601151000-add-metadata-postgres
      author: platform-team
      dbms: postgresql
      changes:
        - addColumn:
            tableName: application
            columns:
              - column:
                  name: metadata
                  type: jsonb

  - changeSet:
      id: app-202601151000-add-metadata-oracle
      author: platform-team
      dbms: oracle
      changes:
        - addColumn:
            tableName: application
            columns:
              - column:
                  name: metadata
                  type: clob
```

### 39.2 Option 2 — Vendor-Specific Changelog Trees

```text
db/changelog/
  db.changelog-master.yaml
  common/
  oracle/
  postgresql/
  sqlserver/
```

Master:

```yaml
databaseChangeLog:
  - include:
      file: db/changelog/common/00-common.yaml
  - include:
      file: db/changelog/oracle/00-oracle.yaml
      dbms: oracle
  - include:
      file: db/changelog/postgresql/00-postgresql.yaml
      dbms: postgresql
```

### 39.3 Trade-Off

Common changelog:

- lebih sederhana jika perbedaan kecil,
- bisa menjadi penuh branching jika perbedaan besar.

Vendor tree:

- lebih eksplisit,
- lebih banyak duplikasi,
- cocok jika vendor behavior sangat berbeda.

Prinsip:

```text
Do not pretend databases are identical when operational behavior differs.
```

---

## 40. Changelog Design for Multi-Schema Systems

Banyak enterprise Java system memakai multiple schema.

Contoh:

```text
APP_CORE
APP_AUDIT
APP_REPORTING
APP_INTEGRATION
```

Desain changelog harus jelas schema mana yang berubah.

### 40.1 Folder per Schema

```text
db/changelog/
  db.changelog-master.yaml
  schemas/
    app_core/
      00-schema.yaml
    app_audit/
      00-schema.yaml
    app_reporting/
      00-schema.yaml
```

### 40.2 Changeset dengan `schemaName`

```yaml
  - changeSet:
      id: audit-202601151000-create-audit-trail
      author: aceas-team
      changes:
        - createTable:
            schemaName: APP_AUDIT
            tableName: audit_trail
            columns:
              - column:
                  name: id
                  type: bigint
                  constraints:
                    primaryKey: true
                    nullable: false
```

### 40.3 Avoid Implicit Default Schema

Jangan terlalu bergantung pada default schema jika deployment user berbeda antar environment.

Buruk:

```yaml
createTable:
  tableName: audit_trail
```

Padahal di dev default schema `APP_DEV`, di prod `APP_CORE`.

Lebih eksplisit:

```yaml
createTable:
  schemaName: APP_AUDIT
  tableName: audit_trail
```

Namun schema name bisa environment-specific. Jika begitu, gunakan parameter/placeholder dengan hati-hati dan standar jelas.

---

## 41. Changelog Design for Permissions and Grants

Database grant sering terlupakan.

Dalam enterprise system, migration tidak hanya table.

Kadang perlu:

- grant select/insert/update,
- create synonym,
- create role,
- grant execute procedure,
- revoke privilege.

### 41.1 Pisahkan Grant Changes

```text
db/changelog/releases/2026-01/
  01-schema.yaml
  02-objects.yaml
  03-grants.yaml
```

### 41.2 Kenapa Dipisah?

Karena grant biasanya:

- environment-sensitive,
- security-sensitive,
- direview oleh DBA/security,
- berbeda antara app user dan migration user,
- butuh least privilege reasoning.

### 41.3 Example

```yaml
  - changeSet:
      id: security-202601151000-grant-application-select-to-reporting
      author: platform-team
      comments: >
        Grants reporting user read-only access to application table. Required
        for reporting dashboard. Must be reviewed under least privilege policy.
      changes:
        - sql:
            sql: GRANT SELECT ON application TO reporting_user
```

Untuk production-grade setup, username sering berbeda antar environment. Jangan hardcode sembarangan tanpa config strategy.

---

## 42. Changelog Design for Local Development

Local development sering butuh data tambahan.

Jangan campur local demo data dengan production seed.

### 42.1 Separate Context

```yaml
  - changeSet:
      id: local-202601151000-seed-demo-users
      author: dev-team
      context: local
      changes:
        - insert:
            tableName: app_user
            columns:
              - column:
                  name: username
                  value: demo.admin
```

### 42.2 Separate File

```text
db/changelog/local/
  local-demo-data.yaml
```

Master:

```yaml
databaseChangeLog:
  - include:
      file: db/changelog/releases/2026-01/00-release.yaml
  - include:
      file: db/changelog/local/local-demo-data.yaml
```

Tapi eksekusi harus dikontrol context:

```bash
liquibase --contexts=local update
```

Production tidak boleh menjalankan context local.

### 42.3 Local Data Rule

```text
Production reference seed belongs to release changelog.
Local/demo/test data belongs to local/test context and must never be required by application runtime in production.
```

---

## 43. Changelog Design for Test Fixtures

Test fixtures berbeda dari production seed.

Production seed:

```text
Status = ACTIVE, SUSPENDED, REVOKED
```

Test fixture:

```text
User named Alice with 3 applications and 2 appeals
```

Jangan campur.

### 43.1 Test Fixture Location

```text
src/test/resources/db/changelog/test-fixtures.yaml
```

atau:

```text
src/test/resources/db/testdata/
```

### 43.2 Why Separate?

Karena production migration harus minimal dan aman.

Test fixture sering:

- besar,
- mutable,
- scenario-specific,
- tidak perlu audit production,
- bisa dihapus/reset.

Jika test fixture masuk production changelog, database production bisa terisi data palsu.

---

## 44. Changelog and Application Compatibility

Changelog design harus mempertimbangkan kompatibilitas aplikasi.

Pertanyaan penting:

```text
Can old application version still run after this migration?
Can new application version run before this migration?
Can rollback application happen after database migration?
```

### 44.1 Backward-Compatible Schema First

Untuk zero-downtime deployment, changeset awal harus compatible dengan aplikasi lama.

Contoh aman:

```text
add nullable column
create new table unused by old app
add non-enforced/nullable field
add index
add optional reference data
```

Contoh tidak aman:

```text
drop column still used by old app
rename column directly
change type incompatibly
tighten not null before app writes value
remove lookup value still used by old app
```

### 44.2 Encode Compatibility in Changelog Names

Contoh:

```text
01-expand-schema.yaml
02-backfill.yaml
03-contract-schema.yaml
```

Nama ini memaksa reviewer berpikir lifecycle.

---

## 45. Changelog in CI/CD

Changelog harus dirancang agar bisa divalidasi otomatis.

CI bisa mengecek:

- changelog parseable,
- no duplicate id within repository,
- no modified executed changeset simulation,
- naming convention,
- forbidden `dropTable` without approval label,
- forbidden `delete` without WHERE,
- forbidden `update` without WHERE,
- no `includeAll` outside allowed folder,
- no local context in production release,
- validate against real database container,
- generate SQL preview,
- run migration from empty database,
- run migration from previous release snapshot.

### 45.1 Changelog Design That Supports CI

Good structure makes CI easier.

If files are separated by type:

```text
01-schema.yaml
04-backfill.yaml
06-contract.yaml
```

CI can apply stricter rules to `backfill` and `contract` files.

If all changes are in one giant file, CI needs complex parsing.

---

## 46. Pull Request Checklist for Changelog Changes

Setiap PR yang mengubah changelog sebaiknya menjawab checklist berikut.

### 46.1 General

- Apakah changeset id unik dan meaningful?
- Apakah author mengikuti convention?
- Apakah file berada di release/module yang benar?
- Apakah include order eksplisit?
- Apakah changeset lama tidak diedit?
- Apakah path identity aman?

### 46.2 Schema

- Apakah perubahan backward compatible?
- Apakah ada destructive operation?
- Apakah constraint baru aman untuk existing data?
- Apakah tipe data sesuai DB vendor?
- Apakah nama constraint/index eksplisit?

### 46.3 Data/Seed

- Apakah seed deterministic?
- Apakah natural key jelas?
- Apakah tidak membuat duplicate data?
- Apakah test data tidak masuk production?
- Apakah update/delete punya WHERE aman?

### 46.4 Backfill

- Apakah row count diketahui?
- Apakah query memakai index?
- Apakah transaksi terlalu besar?
- Apakah perlu batch job terpisah?
- Apakah validasi tersedia?

### 46.5 Operations

- Apakah migration bisa menyebabkan lock lama?
- Apakah perlu maintenance window?
- Apakah rollback/roll-forward plan jelas?
- Apakah monitoring/logging cukup?

---

## 47. Anti-Patterns in Liquibase Changelog Design

### 47.1 Giant Master Changelog

Satu file ribuan baris.

Dampak:

- sulit review,
- rawan conflict,
- sulit audit.

### 47.2 Random Changeset ID

```yaml
id: test
id: update1
id: final
id: final2
```

Dampak:

- tidak traceable,
- rawan duplicate,
- tidak professional.

### 47.3 Editing Old Changesets

Dampak:

- checksum mismatch,
- histori rusak,
- environment drift.

### 47.4 `includeAll` Semua Folder

Dampak:

- hidden execution,
- file salah bisa tereksekusi,
- order tidak jelas.

### 47.5 Generated Changelog as Permanent Style

Dampak:

- tidak ada intent,
- noise besar,
- sulit review.

### 47.6 Environment-Specific Schema Branching

Dampak:

- dev/test/prod drift,
- bug hanya muncul di production,
- migration reasoning rumit.

### 47.7 Mixing Production Seed with Test Fixture

Dampak:

- data palsu masuk production,
- security risk,
- audit issue.

### 47.8 Backfill Hidden Inside Schema File

Dampak:

- reviewer tidak sadar ada operasi mahal,
- production lock incident.

### 47.9 Overusing Rollback Blocks

Rollback terlihat lengkap tetapi tidak pernah dites.

Dampak:

- false sense of safety.

### 47.10 One Changeset per Column Always

Terlalu granular.

Dampak:

- noise besar,
- intent hilang,
- history sulit dibaca.

---

## 48. A Practical Standard You Can Adopt

Berikut standar yang cukup kuat untuk team Java enterprise.

### 48.1 Directory

```text
src/main/resources/db/changelog/
  db.changelog-master.yaml
  releases/
    YYYY-MM/
      00-release.yaml
      01-expand-schema.yaml
      02-reference-data.yaml
      03-permissions.yaml
      04-backfill.yaml
      05-indexes.yaml
      06-contract-constraints.yaml
  sql/
    oracle/
    postgresql/
    sqlserver/
```

### 48.2 Master

```yaml
databaseChangeLog:
  - include:
      file: db/changelog/releases/2026-01/00-release.yaml
  - include:
      file: db/changelog/releases/2026-02/00-release.yaml
```

### 48.3 Changeset ID

```text
<module>-<yyyyMMddHHmm>-<intent>
```

Example:

```text
application-202601151000-expand-add-risk-level-column
```

### 48.4 Author

```text
Use stable team handle: aceas-team
```

or:

```text
Use short developer handle, but do not change it later.
```

### 48.5 Include

```text
Use explicit include.
Avoid includeAll in production changelog.
```

### 48.6 Mutability

```text
Before merge/shared deploy: changeset can be edited.
After shared deploy: changeset immutable.
Correction = new changeset.
```

### 48.7 Seed

```text
Production seed separate from test/local seed.
Reference data changes must be deterministic and reviewable.
```

### 48.8 Backfill

```text
Backfill changes must be named, separated, commented, and reviewed for volume/lock impact.
```

### 48.9 Dangerous Operations

Require explicit review for:

- drop table,
- drop column,
- delete,
- truncate,
- full table update,
- add not null,
- add unique constraint,
- type narrowing,
- large index creation,
- foreign key on large table,
- data correction in production.

---

## 49. Deep Mental Model: Changelog as Legal Contract of Database Evolution

Dalam regulated atau enterprise system, database changelog bukan hanya technical artifact.

Ia adalah kontrak historis.

Ia menjawab:

- perubahan apa yang masuk,
- kapan masuk,
- siapa/apa yang memperkenalkan,
- urutan perubahan,
- apakah perubahan sudah dijalankan,
- apakah checksum masih sama,
- apakah environment mengikuti versi yang sama,
- apakah deployment sesuai release artifact.

Karena itu, desain changelog harus defensible.

Bukan hanya “berfungsi di local”.

Sistem yang matang akan memperlakukan changelog seperti:

```text
code + release record + audit evidence + operational plan
```

Bukan seperti:

```text
folder SQL random
```

---

## 50. Common Design Decisions and Recommended Defaults

| Decision | Recommended Default | Reason |
|---|---|---|
| Master changelog | Small table of contents | Menghindari giant file |
| Include style | Explicit `include` | Order dan audit jelas |
| File grouping | Release + type/module hybrid | Balance audit dan ownership |
| Changeset id | Timestamp + module + intent | Unik dan readable |
| Author | Stable handle/team | Identity stabil |
| Format | YAML + SQL hybrid | Readable dan powerful |
| Generated changelog | Baseline only | Generated output tidak punya intent |
| Old changeset | Immutable after shared deploy | Menjaga checksum dan audit |
| Seed data | Separate file/context | Menghindari production pollution |
| Backfill | Separate file and named clearly | Operational risk terlihat |
| DB-specific SQL | Use SQL file with reason | Kontrol vendor behavior |
| Test data | `src/test/resources` or test context | Tidak masuk production |
| Environment branching | Minimal | Menghindari drift |

---

## 51. Mini Case Study: Adding Risk Level to Application

### 51.1 Requirement

Aplikasi perlu menambahkan field `risk_level` ke `application`.

Rules:

- aplikasi lama masih berjalan saat migration awal,
- existing rows perlu diisi,
- setelah semua valid, `risk_level` harus not null,
- listing akan filter berdasarkan `risk_level`,
- production table punya jutaan rows.

### 51.2 Bad Approach

```yaml
  - changeSet:
      id: 1
      author: dev
      changes:
        - addColumn:
            tableName: application
            columns:
              - column:
                  name: risk_level
                  type: varchar(20)
                  constraints:
                    nullable: false
        - sql:
            sql: UPDATE application SET risk_level = 'LOW'
        - createIndex:
            tableName: application
            indexName: idx_risk
            columns:
              - column:
                  name: risk_level
```

Risiko:

- gagal karena not null,
- lock besar,
- full update,
- tidak ada validation,
- tidak rollback-safe,
- tidak compatible dengan old app.

### 51.3 Good Changelog Structure

```text
2026-01/
  00-release.yaml
  01-expand-schema.yaml
  02-backfill-risk-level.yaml
  03-index-risk-level.yaml
  04-contract-risk-level.yaml
```

### 51.4 Expand

```yaml
  - changeSet:
      id: application-202601151000-expand-add-risk-level-nullable
      author: aceas-team
      comments: >
        Expand phase. Nullable to keep old application compatible and allow
        controlled backfill before contract phase.
      changes:
        - addColumn:
            tableName: application
            columns:
              - column:
                  name: risk_level
                  type: varchar(20)
```

### 51.5 Backfill

```yaml
  - changeSet:
      id: application-202601151200-backfill-risk-level
      author: aceas-team
      comments: >
        Backfills existing rows. For very large production volume, this should
        be replaced by an external chunked batch job and this changeset should
        only validate completion.
      changes:
        - sql:
            sql: |
              UPDATE application
              SET risk_level = 'LOW'
              WHERE risk_level IS NULL;
```

### 51.6 Index

```yaml
  - changeSet:
      id: application-202601151300-index-risk-level
      author: aceas-team
      changes:
        - createIndex:
            tableName: application
            indexName: idx_application_risk_level
            columns:
              - column:
                  name: risk_level
```

### 51.7 Contract

```yaml
  - changeSet:
      id: application-202601151400-contract-risk-level-not-null
      author: aceas-team
      preConditions:
        - onFail: HALT
        - sqlCheck:
            expectedResult: 0
            sql: SELECT COUNT(*) FROM application WHERE risk_level IS NULL
      changes:
        - addNotNullConstraint:
            tableName: application
            columnName: risk_level
            columnDataType: varchar(20)
```

Ini bukan hanya lebih rapi. Ini lebih aman secara deployment.

---

## 52. Mini Case Study: Permission Seed

### 52.1 Requirement

Tambah permission baru:

```text
APPLICATION_REVIEW_APPROVE
APPLICATION_REVIEW_REJECT
```

### 52.2 Bad Approach

```yaml
  - changeSet:
      id: seed
      author: dev
      changes:
        - insert:
            tableName: permission
            columns:
              - column:
                  name: id
                  valueNumeric: 999
              - column:
                  name: code
                  value: APPLICATION_REVIEW_APPROVE
```

Masalah:

- ID hardcoded bisa bentrok,
- changeset id buruk,
- tidak ada precondition,
- tidak jelas module/feature,
- tidak idempotent secara data reasoning.

### 52.3 Better Approach

```yaml
  - changeSet:
      id: permission-202601151000-seed-application-review-permissions
      author: aceas-team
      comments: >
        Adds application review permissions required by review workflow.
        Uses permission code as stable natural key.
      preConditions:
        - onFail: MARK_RAN
        - sqlCheck:
            expectedResult: 0
            sql: |
              SELECT COUNT(*)
              FROM permission
              WHERE code IN (
                'APPLICATION_REVIEW_APPROVE',
                'APPLICATION_REVIEW_REJECT'
              )
      changes:
        - insert:
            tableName: permission
            columns:
              - column:
                  name: code
                  value: APPLICATION_REVIEW_APPROVE
              - column:
                  name: description
                  value: Approve application review
        - insert:
            tableName: permission
            columns:
              - column:
                  name: code
                  value: APPLICATION_REVIEW_REJECT
              - column:
                  name: description
                  value: Reject application review
```

Catatan: `MARK_RAN` harus dipakai hati-hati. Jika sebagian data ada dan sebagian tidak, precondition di atas bisa menandai selesai padahal data belum lengkap. Untuk kasus production, desain seed yang lebih matang perlu menangani partial existence. Ini akan dibahas di Part 17–18.

---

## 53. Mini Case Study: View Definition

### 53.1 Requirement

Tambah view untuk listing audit.

### 53.2 Design

```text
db/changelog/releases/2026-01/
  02-objects.yaml

db/changelog/sql/oracle/views/
  202601151000-create-audit-trail-listing-view.sql
```

Changelog:

```yaml
  - changeSet:
      id: audit-202601151000-create-audit-trail-listing-view
      author: aceas-team
      comments: >
        Creates audit trail listing view for application search/listing.
        SQL file is Oracle-specific because view definition uses Oracle syntax.
      changes:
        - sqlFile:
            path: db/changelog/sql/oracle/views/202601151000-create-audit-trail-listing-view.sql
```

SQL file:

```sql
CREATE OR REPLACE VIEW audit_trail_listing_view AS
SELECT
    at.id,
    at.activity,
    at.module_id,
    at.created_date_time
FROM audit_trail at;
```

Prinsip:

- SQL actual terlihat,
- vendor-specific jelas,
- file immutable setelah executed,
- perubahan view berikutnya memakai file dan changeset baru.

---

## 54. Top 1% Perspective: The Difference Between Changelog User and Changelog Designer

Developer biasa bisa membuat changeset yang jalan di local.

Engineer matang mendesain changelog yang:

- aman dijalankan di production,
- tahan terhadap parallel development,
- mudah direview,
- menjaga audit trail,
- mendukung rollback/roll-forward reasoning,
- tidak menciptakan environment drift,
- bisa dipahami engineer baru setahun kemudian,
- bisa diuji di CI,
- bisa dioperasikan DBA/platform team,
- bisa menjelaskan failure mode.

Perbedaannya bukan pada syntax Liquibase.

Perbedaannya ada pada **change architecture**.

---

## 55. Summary

Dalam part ini, kita membahas bahwa desain Liquibase changelog bukan sekadar memilih XML/YAML/SQL.

Poin penting:

- Master changelog sebaiknya menjadi table of contents, bukan dumping ground.
- Struktur changelog harus mencerminkan release, module, ownership, dan deployment order.
- `include` lebih aman daripada `includeAll` untuk production-grade governance.
- Changeset identity terdiri dari `id`, `author`, dan file path.
- `logicalFilePath` penting saat path stability menjadi concern.
- ID harus unik, readable, sortable, dan menjelaskan intent.
- Changeset lama yang sudah dijalankan di shared environment harus immutable.
- Schema, seed, backfill, index, grant, object, dan constraint tightening sebaiknya dipisah secara jelas.
- Generated changelog berguna untuk baseline, tetapi buruk sebagai style jangka panjang tanpa review.
- YAML + SQL hybrid sering menjadi pilihan seimbang untuk Java enterprise project.
- Changelog yang baik membantu review, CI/CD, audit, rollback reasoning, dan production operations.

Mental model utama:

> Liquibase changelog adalah arsitektur evolusi database. Desainnya harus menjelaskan intent, order, ownership, risk, dan audit trail perubahan database.

---

## 56. Practical Exercises

### Exercise 1 — Evaluate a Changelog Structure

Ambil project Java yang kamu punya atau bayangkan project enterprise modular.

Tulis struktur changelog saat ini.

Jawab:

1. Apakah master changelog terlalu besar?
2. Apakah release boundary jelas?
3. Apakah module ownership jelas?
4. Apakah seed dan backfill dipisah?
5. Apakah ada `includeAll` yang terlalu luas?
6. Apakah changeset ID konsisten?
7. Apakah ada changeset lama yang pernah diedit?

### Exercise 2 — Design Release Folder

Buat folder untuk release `2026-01` dengan requirement:

- tambah table `application_review`,
- tambah permission review,
- backfill status existing application,
- tambah index untuk listing,
- tambah not null constraint setelah backfill.

Desain file changelog-nya.

Expected answer:

```text
2026-01/
  00-release.yaml
  01-expand-schema.yaml
  02-permissions.yaml
  03-backfill.yaml
  04-indexes.yaml
  05-contract-constraints.yaml
```

### Exercise 3 — Rewrite Bad Changeset

Ubah changeset buruk ini:

```yaml
id: 1
author: dev
changes:
  - addColumn: not null risk_level
  - sql: update all rows
  - createIndex: idx1
```

menjadi beberapa changeset yang aman dan reviewable.

### Exercise 4 — Define Team Convention

Buat standard convention untuk team:

- changeset id format,
- author format,
- folder structure,
- include rule,
- seed rule,
- backfill rule,
- old changeset mutability rule,
- dangerous operation approval rule.

---

## 57. Checklist for Part 13 Mastery

Kamu dianggap memahami Part 13 jika bisa menjelaskan:

- kenapa master changelog tidak boleh menjadi giant file,
- kapan memilih release-based, module-based, feature-based, atau hybrid hierarchy,
- kenapa `include` biasanya lebih aman daripada `includeAll`,
- bagaimana Liquibase menentukan identity changeset,
- kenapa file path identity berbahaya saat refactor,
- kapan memakai `logicalFilePath`,
- bagaimana mendesain changeset ID yang scalable,
- kenapa changeset lama harus immutable,
- bagaimana memisahkan schema, seed, backfill, index, object, grant, dan constraint changes,
- kapan memakai YAML/XML declarative vs formatted SQL,
- kenapa generated changelog tidak boleh langsung menjadi style production,
- bagaimana changelog design mendukung CI/CD dan audit,
- bagaimana desain changelog membantu zero-downtime migration.

---

## 58. What Comes Next

Part berikutnya:

```text
14-liquibase-preconditions-contexts-labels.md
```

Di Part 14, kita akan masuk ke fitur Liquibase yang sering membedakan migration biasa dan migration enterprise-grade:

- preconditions,
- `onFail`,
- `onError`,
- object existence checks,
- data existence checks,
- contexts,
- labels,
- DBMS-specific changes,
- environment targeting,
- release targeting,
- tenant-specific migration,
- dan anti-pattern branching changelog yang membuat dev/test/prod drift.

