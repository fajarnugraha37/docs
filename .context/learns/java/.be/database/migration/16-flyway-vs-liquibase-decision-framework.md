# Part 16 — Flyway vs Liquibase: Decision Framework

> Seri: `learn-java-database-migrations-seedings-flyway-liquibase`  
> File: `16-flyway-vs-liquibase-decision-framework.md`  
> Target pembaca: Java engineer, backend engineer, tech lead, solution architect  
> Cakupan Java: Java 8 sampai Java 25  
> Fokus: memilih Flyway atau Liquibase berdasarkan constraint engineering, bukan preferensi tool semata

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas Flyway dan Liquibase secara terpisah:

- Flyway mental model.
- Flyway setup.
- Flyway SQL migration design.
- Flyway repeatable migrations.
- Flyway Java-based migrations.
- Flyway callbacks.
- Flyway baseline, validate, repair, clean.
- Liquibase mental model.
- Liquibase setup.
- Liquibase changelog design.
- Liquibase preconditions, contexts, labels.
- Liquibase rollback engineering.

Sekarang pertanyaannya bukan lagi:

> “Flyway lebih bagus atau Liquibase lebih bagus?”

Pertanyaan yang lebih benar adalah:

> “Dengan constraint sistem, tim, database, compliance, release process, rollback expectation, dan maturity engineering yang kita punya, tool mana yang menghasilkan risiko operasional paling kecil dan maintainability paling tinggi?”

Bagian ini akan memberi framework pengambilan keputusan yang bisa dipakai dalam konteks:

- aplikasi Spring Boot;
- aplikasi Jakarta EE;
- plain Java service;
- monolith;
- modular monolith;
- microservices;
- shared database;
- regulated system;
- multi-tenant system;
- legacy database;
- sistem dengan stored procedures/views/functions;
- sistem dengan database vendor tunggal;
- sistem yang harus mendukung banyak DBMS.

---

## 1. Premis Dasar: Tool Tidak Menghilangkan Masalah Database Change

Flyway dan Liquibase bukan magic layer.

Keduanya membantu mengontrol perubahan database, tetapi keduanya tidak menghapus problem mendasar berikut:

1. Database adalah stateful.
2. Database sering shared antar modul, service, report, job, dan integrasi.
3. Schema change dapat memblokir transaksi aplikasi.
4. Data migration dapat gagal di tengah jalan.
5. Rollback database sering tidak simetris dengan rollback code.
6. Production schema bisa drift dari repository.
7. Large table migration butuh strategi online, bukan sekadar script.
8. Release pipeline harus sadar urutan: app dulu atau DB dulu.

Jadi keputusan Flyway vs Liquibase harus dilihat sebagai pemilihan **control model**, bukan hanya pemilihan library.

---

## 2. Mental Model Singkat

### 2.1 Flyway dalam Satu Kalimat

Flyway adalah tool migrasi database yang cenderung **SQL-first, linear, sederhana, eksplisit, dan mudah dipahami**, dengan model utama versioned migration dan repeatable migration.

Flyway sangat cocok ketika tim ingin:

- migration berupa SQL file yang jelas;
- ordering sederhana;
- sedikit abstraksi;
- tidak terlalu banyak branching logic;
- database vendor diketahui;
- review migration dilakukan seperti review SQL production.

### 2.2 Liquibase dalam Satu Kalimat

Liquibase adalah tool migrasi database yang cenderung **changelog-first, metadata-rich, lebih ekspresif, lebih governance-friendly, dan lebih kuat untuk conditional execution**, dengan model utama changelog, changeset, preconditions, contexts, labels, dan rollback.

Liquibase sangat cocok ketika tim butuh:

- precondition kuat;
- rollback metadata;
- context/label untuk environment/release targeting;
- struktur changelog kompleks;
- DBMS portability;
- audit/compliance yang lebih formal;
- change governance lintas tim.

---

## 3. Perbandingan Filosofis

| Dimensi | Flyway | Liquibase |
|---|---|---|
| Gaya utama | SQL-first | Changelog-first |
| Abstraksi | Rendah | Sedang sampai tinggi |
| Unit perubahan | Migration file | Changeset |
| Identitas perubahan | Version/name/checksum | File path + id + author + checksum |
| Ordering | Berdasarkan version dan repeatable ordering | Berdasarkan urutan changelog/include |
| Conditional execution | Terbatas, biasanya lewat SQL/vendor logic/callback | Kuat via preconditions, contexts, labels |
| Rollback model | Umumnya roll-forward; undo ada tetapi harus dipakai hati-hati | Rollback lebih first-class, meski tetap perlu desain serius |
| Portability DBMS | Bisa, tetapi SQL biasanya vendor-specific | Lebih kuat bila memakai declarative change types |
| Reviewability | Sangat baik untuk SQL engineer | Baik jika changelog disiplin; bisa buruk jika terlalu generated/noisy |
| Learning curve | Lebih rendah | Lebih tinggi |
| Governance | Sederhana | Lebih kaya |
| Risiko overengineering | Lebih rendah | Lebih tinggi |
| Risiko kurang ekspresif | Lebih tinggi | Lebih rendah |

---

## 4. Jangan Mulai dari Tool, Mulai dari Constraint

Engineer biasa bertanya:

> “Kita pakai Flyway atau Liquibase?”

Engineer matang bertanya:

> “Apa constraint perubahan database kita?”

Constraint yang harus dipetakan:

1. Berapa banyak DBMS yang harus didukung?
2. Apakah database vendor tunggal seperti PostgreSQL/Oracle/MySQL/SQL Server?
3. Apakah migration perlu conditional execution per environment?
4. Apakah ada kebutuhan rollback formal?
5. Apakah ada audit/compliance approval?
6. Apakah schema dimiliki satu service atau banyak service?
7. Apakah ada multi-tenant schema?
8. Apakah ada stored procedures, views, triggers, packages?
9. Apakah database existing sudah besar dan legacy?
10. Apakah tim nyaman membaca SQL production?
11. Apakah pipeline CI/CD sudah mature?
12. Apakah deployment sering zero-downtime?
13. Apakah migration dijalankan oleh aplikasi, pipeline, DBA, atau platform team?
14. Apakah ada production drift historis?
15. Apakah perubahan data besar sering terjadi?

Jawaban dari pertanyaan-pertanyaan itu lebih menentukan daripada fitur tool.

---

## 5. Decision Axis 1 — Simplicity vs Expressiveness

### 5.1 Flyway Lebih Kuat Saat Kesederhanaan adalah Nilai Utama

Flyway ideal jika bentuk migration dapat dijaga sederhana:

```text
V001__create_customer_table.sql
V002__add_customer_email_index.sql
V003__seed_customer_status.sql
R__customer_summary_view.sql
```

Kekuatan Flyway:

- mudah dijelaskan ke developer baru;
- file SQL mudah direview;
- tidak banyak konsep tambahan;
- cocok dengan mental model “database berubah secara linear”;
- cocok untuk tim yang ingin migration transparan.

Flyway mengurangi ruang untuk abstraksi yang terlalu pintar.

Itu bagus jika sistem Anda butuh:

- clarity;
- determinism;
- low ceremony;
- explicit SQL;
- operational predictability.

### 5.2 Liquibase Lebih Kuat Saat Expressiveness Dibutuhkan

Liquibase lebih cocok ketika migration butuh metadata dan kontrol lebih kaya:

```yaml
databaseChangeLog:
  - changeSet:
      id: 2026-06-17-001-create-customer
      author: team-customer
      labels: release-2026-q3
      context: prod,uat
      preConditions:
        - onFail: HALT
        - not:
            tableExists:
              tableName: customer
      changes:
        - createTable:
            tableName: customer
            columns:
              - column:
                  name: id
                  type: bigint
                  constraints:
                    primaryKey: true
              - column:
                  name: name
                  type: varchar(200)
```

Kekuatan Liquibase:

- precondition eksplisit;
- context/label targeting;
- rollback metadata;
- changelog hierarchy;
- declarative changes;
- lebih mudah membangun governance formal.

Namun expressiveness juga punya biaya:

- learning curve naik;
- changelog bisa verbose;
- review bisa lebih sulit;
- generated changelog bisa noisy;
- branching logic bisa menjadi chaos jika tidak dikontrol.

### 5.3 Rule of Thumb

Gunakan Flyway jika masalah Anda bisa diselesaikan dengan **SQL yang jelas dan linear**.

Gunakan Liquibase jika masalah Anda butuh **metadata, condition, context, label, rollback, dan governance yang lebih eksplisit**.

---

## 6. Decision Axis 2 — SQL-First vs Declarative Change Model

### 6.1 SQL-First

SQL-first berarti migration ditulis langsung dalam SQL vendor target.

Contoh:

```sql
ALTER TABLE customer ADD email VARCHAR(255);
CREATE INDEX idx_customer_email ON customer(email);
```

Keuntungannya:

- jelas apa yang dijalankan;
- mudah dianalisis DBA;
- cocok untuk performance-sensitive DDL;
- cocok untuk vendor-specific features;
- tidak ada kejutan dari abstraction layer.

Kelemahannya:

- kurang portable antar DBMS;
- developer harus tahu SQL dialect;
- conditional logic harus ditulis manual;
- rollback harus dibuat manual.

Flyway natural untuk SQL-first.

Liquibase juga bisa SQL-first melalui formatted SQL changelog, tetapi Liquibase sering dipilih justru karena metadata tambahannya.

### 6.2 Declarative Change Model

Declarative change model berarti Anda menulis maksud perubahan, lalu tool menghasilkan SQL sesuai database.

Contoh Liquibase:

```yaml
- addColumn:
    tableName: customer
    columns:
      - column:
          name: email
          type: varchar(255)
```

Keuntungannya:

- lebih portable;
- lebih structured;
- metadata lebih kaya;
- rollback tertentu bisa lebih mudah;
- cocok untuk governance dan diff tooling.

Kelemahannya:

- SQL final bisa tidak sesuai ekspektasi jika tidak direview;
- abstraction leak tetap terjadi;
- fitur vendor-specific kadang tetap perlu raw SQL;
- changelog bisa verbose.

### 6.3 Practical Position

Untuk sistem production-grade, jangan percaya penuh pada portability abstrak.

Bahkan jika memakai Liquibase declarative changes, tetap lakukan:

1. generate SQL preview;
2. review SQL aktual;
3. test di DBMS asli;
4. ukur lock/performance impact;
5. dokumentasikan vendor-specific caveat.

---

## 7. Decision Axis 3 — Team Maturity

### 7.1 Tim Kecil, Startup, atau Product Team Tunggal

Jika tim kecil, satu DBMS, schema tidak terlalu kompleks, dan release cepat:

- Flyway sering lebih efisien.
- Overhead governance Liquibase mungkin belum sepadan.
- SQL file sederhana cukup.
- Migration review bisa dilakukan di PR.

Rekomendasi umum:

```text
Flyway + SQL migration + CI validate + Testcontainers
```

### 7.2 Tim Enterprise dengan Banyak Modul

Jika banyak team mengubah database yang sama, release train formal, approval, dan compliance:

- Liquibase sering lebih cocok.
- Contexts/labels/preconditions membantu governance.
- Changelog hierarchy bisa mencerminkan ownership.
- Rollback metadata bisa menjadi evidence.

Rekomendasi umum:

```text
Liquibase + structured changelog + labels + preconditions + SQL preview approval
```

### 7.3 Tim yang Lemah SQL-nya

Ini tricky.

Sebagian orang memilih Liquibase declarative changes karena developer kurang nyaman SQL. Tetapi ini bisa menjadi ilusi keamanan.

DDL tetap punya dampak database nyata:

- lock;
- index build;
- constraint validation;
- table rewrite;
- sequence behavior;
- data type semantics;
- transaction behavior.

Jika tim lemah SQL, tool bukan pengganti kompetensi. Pilihan terbaik adalah:

- gunakan tool yang sederhana;
- buat checklist review;
- libatkan DBA/senior engineer;
- test dengan real database;
- edukasi SQL migration patterns.

Flyway bisa memaksa clarity. Liquibase bisa memberi guardrail. Pilihan tergantung kultur tim.

---

## 8. Decision Axis 4 — Database Portability

### 8.1 Jika Produk Harus Mendukung Banyak Database

Contoh:

- on-prem enterprise product;
- customer bisa memilih Oracle/PostgreSQL/SQL Server;
- vendor software harus support multi-DBMS;
- internal platform harus deploy ke database berbeda.

Liquibase lebih menarik karena:

- declarative change types;
- DBMS-specific branching;
- preconditions;
- contexts/labels;
- abstraction metadata.

Namun tetap perlu test matrix:

```text
PostgreSQL migration test
Oracle migration test
SQL Server migration test
MySQL migration test
```

Declarative changelog tidak menghapus kebutuhan pengujian vendor.

### 8.2 Jika Sistem Pasti Satu Database Vendor

Contoh:

- hanya PostgreSQL;
- hanya Oracle;
- hanya MySQL;
- hanya SQL Server.

Flyway menjadi sangat kuat karena Anda bisa memakai SQL dialect asli dengan optimal.

Contoh PostgreSQL:

```sql
CREATE INDEX CONCURRENTLY idx_order_created_at
ON orders(created_at);
```

Contoh Oracle:

```sql
CREATE INDEX idx_order_created_at
ON orders(created_at)
ONLINE;
```

Fitur seperti ini sering lebih baik ditulis eksplisit daripada dipaksa menjadi abstraksi generic.

---

## 9. Decision Axis 5 — Rollback Requirement

### 9.1 Realitas Rollback Database

Rollback database sering tidak bisa disamakan dengan rollback aplikasi.

Aplikasi:

```text
deploy v2 -> error -> redeploy v1
```

Database:

```text
add column -> write new production data -> error -> what now?
```

Masalahnya:

- data baru mungkin sudah masuk;
- old app mungkin tidak mengenal data baru;
- drop column bisa menghapus data;
- reverse transform bisa lossy;
- constraint/index rollback bisa mahal;
- migration mungkin sudah dipakai external consumers.

### 9.2 Jika Organisasi Meminta Rollback Script Formal

Liquibase punya model rollback yang lebih eksplisit:

- rollback block;
- rollback to tag;
- rollback SQL generation;
- auto rollback untuk sebagian change type.

Ini membantu organisasi yang butuh:

- release evidence;
- approval document;
- rollback plan;
- audit trail;
- regulated deployment.

Tetapi rollback tetap harus diuji. Rollback declaration bukan jaminan rollback aman.

### 9.3 Jika Strategi Organisasi adalah Roll-Forward

Banyak sistem modern memilih roll-forward:

- jangan drop data cepat;
- lakukan expand/contract;
- jika gagal, deploy fix migration berikutnya;
- jaga schema backward-compatible;
- rollback aplikasi tanpa rollback schema.

Dalam model ini, Flyway sangat cocok:

```text
V101__expand_add_nullable_column.sql
V102__backfill_new_column.sql
V103__switch_read_contract.sql
V104__contract_drop_old_column.sql
```

### 9.4 Rule of Thumb

Jika rollback formal adalah requirement kuat, Liquibase punya advantage.

Jika strategi utama adalah forward-only migration dan expand/contract, Flyway sangat nyaman.

Namun untuk production-grade system, baik Flyway maupun Liquibase harus memakai pola:

```text
prefer backward-compatible schema + roll-forward fix
```

Rollback fisik database hanya digunakan jika benar-benar aman dan sudah diuji.

---

## 10. Decision Axis 6 — Audit and Compliance

### 10.1 Audit Minimum yang Harus Ada

Tool apa pun harus mampu menjawab:

1. Migration apa yang sudah jalan?
2. Kapan dijalankan?
3. Oleh siapa atau oleh job apa?
4. Berhasil atau gagal?
5. Checksum-nya apa?
6. Apakah file berubah setelah dijalankan?
7. Environment mana yang sudah menerapkan migration?
8. Apakah ada manual drift?

Flyway menjawab banyak hal melalui schema history table.

Liquibase menjawab banyak hal melalui `DATABASECHANGELOG` dan `DATABASECHANGELOGLOCK`.

### 10.2 Compliance Ringan

Untuk startup/internal product:

- Flyway cukup;
- migration files di Git;
- PR review;
- CI validate;
- deployment logs;
- schema history table.

### 10.3 Compliance Berat

Untuk regulated domain:

- government;
- banking;
- insurance;
- healthcare;
- financial reporting;
- enforcement lifecycle;
- case management;
- audit-heavy systems.

Liquibase sering lebih menarik karena metadata changelog lebih kaya:

- changeset identity;
- labels;
- contexts;
- preconditions;
- rollback blocks;
- tags;
- SQL preview;
- change documentation.

Namun Flyway tetap bisa dipakai di regulated environment jika governance di luar tool kuat:

- strict migration naming;
- immutable artifact;
- approval workflow;
- migration runbook;
- signed release package;
- audit logging;
- DBA review;
- no manual change policy.

### 10.4 Prinsip Penting

Compliance bukan fitur tool. Compliance adalah sistem kontrol.

Tool hanya menyediakan evidence dan mekanisme.

---

## 11. Decision Axis 7 — Multi-Tenant Requirement

### 11.1 Single Schema Multi-Tenant

Jika semua tenant berbagi schema yang sama:

- Flyway bisa cukup.
- Liquibase juga bisa.
- Tantangan utama bukan tool, tetapi backward compatibility dan data isolation.

### 11.2 Schema-per-Tenant

Jika setiap tenant punya schema sendiri:

Tool harus bisa:

- iterate tenant schemas;
- track migration per tenant;
- handle tenant failure;
- retry tenant migration;
- quarantine failed tenant;
- expose migration dashboard.

Flyway bisa digunakan dengan programmatic execution per schema.

Liquibase juga bisa digunakan dengan programmatic execution per schema.

Liquibase contexts/labels bisa membantu jika tenant punya variasi change, tetapi variasi berlebihan bisa menjadi chaos.

### 11.3 Database-per-Tenant

Jika setiap tenant punya database sendiri:

- orchestration menjadi lebih penting daripada tool;
- perlu registry tenant database;
- perlu concurrency control;
- perlu retry;
- perlu observability;
- perlu version drift handling.

Tool decision:

- Flyway cocok jika migration path sama untuk semua tenant.
- Liquibase cocok jika tenant migration sering conditional atau perlu metadata kaya.

### 11.4 Rule of Thumb

Multi-tenant system jarang gagal karena Flyway/Liquibase tidak mampu.

Biasanya gagal karena tidak ada tenant migration orchestration layer.

---

## 12. Decision Axis 8 — Stored Procedures, Views, Functions, Triggers, Packages

### 12.1 Object Definition Heavy System

Beberapa sistem sangat database-centric:

- Oracle packages;
- PostgreSQL functions;
- SQL Server stored procedures;
- materialized views;
- reporting views;
- triggers;
- database-side validation;
- ETL helper objects.

Flyway repeatable migrations sangat natural untuk object definitions:

```text
R__customer_view.sql
R__calculate_penalty_function.sql
R__case_assignment_package.sql
```

Setiap perubahan checksum membuat object dire-apply.

### 12.2 Liquibase untuk Object Definition

Liquibase juga bisa mengelola object definition, baik via raw SQL maupun formatted SQL.

Tetapi untuk object besar seperti Oracle package body, SQL-first sering lebih readable daripada XML/YAML declarative.

### 12.3 Rule of Thumb

Jika sistem sangat SQL object heavy dan satu DBMS, Flyway sering terasa lebih natural.

Jika object definitions perlu dikelola bersama governance contexts/labels/preconditions, Liquibase bisa tetap cocok dengan SQL changelog style.

---

## 13. Decision Axis 9 — Legacy Database Adoption

### 13.1 Existing Database Tanpa Migration History

Skenario umum:

- aplikasi sudah jalan bertahun-tahun;
- schema dibuat manual;
- tidak ada migration history;
- production, UAT, SIT, DEV berbeda;
- ada manual hotfix;
- ada stored procedure yang berbeda antar environment.

Kedua tool bisa melakukan baseline.

Flyway punya baseline model yang sederhana.

Liquibase punya changelog sync/baseline-style workflow dan dapat lebih kaya untuk snapshot/diff scenario.

### 13.2 Jika Tujuan Utama adalah Mengambil Alih Kontrol Secara Minimal

Flyway sering lebih baik:

```text
1. capture current schema as baseline
2. mark baseline version
3. all future changes use versioned migrations
```

Minim ceremony.

### 13.3 Jika Tujuan Utama adalah Menganalisis Drift dan Generate Changelog

Liquibase sering lebih menarik karena ekosistem changelog/snapshot/diff lebih kuat.

Namun hati-hati: generated changelog harus direview manusia.

Generated changelog bukan production-ready migration by default.

---

## 14. Decision Axis 10 — Spring Boot Integration

Spring Boot mendukung Flyway dan Liquibase sebagai higher-level database migration tools. Dalam praktik serius, jangan mencampur banyak mekanisme initialization untuk schema yang sama.

### 14.1 Flyway + Spring Boot

Cocok jika:

- migration SQL sederhana;
- service-owned database;
- startup migration diterima;
- developer ingin sedikit konfigurasi;
- tim memakai Testcontainers.

Risiko:

- migration berat saat startup bisa membuat pod gagal readiness;
- multiple replicas bisa berebut migration lock;
- production migration sebaiknya sering dipisah menjadi pipeline job.

### 14.2 Liquibase + Spring Boot

Cocok jika:

- changelog structured;
- context/label dipakai per environment;
- precondition penting;
- rollback SQL perlu dihasilkan;
- governance formal.

Risiko:

- changelog hierarchy bisa kompleks;
- profile/context mapping harus disiplin;
- startup migration berat tetap berisiko.

### 14.3 Rule of Thumb untuk Spring Boot

Untuk aplikasi sederhana sampai menengah:

```text
Flyway + SQL migration + Spring Boot auto config
```

Untuk aplikasi enterprise regulated:

```text
Liquibase + structured changelog + context/label + pipeline execution
```

Untuk production workload besar:

```text
migration as external deployment job, not app startup side effect
```

---

## 15. Decision Axis 11 — CI/CD Maturity

### 15.1 CI/CD Belum Mature

Jika pipeline masih sederhana:

- Flyway lebih mudah diadopsi;
- validate/migrate sederhana;
- migration SQL ada di repo;
- failure mudah dipahami.

Namun tetap wajib minimal:

- run migration on fresh DB;
- run migration from previous release DB;
- run application integration test;
- block checksum drift.

### 15.2 CI/CD Mature

Jika pipeline sudah punya:

- environment promotion;
- approval gate;
- SQL preview;
- artifact signing;
- rollback package;
- deployment dashboard;
- drift detection;
- pre-flight checks.

Liquibase bisa memanfaatkan metadata lebih banyak.

Flyway juga bisa bekerja sangat baik bila pipeline governance dibangun di sekitarnya.

### 15.3 Tooling Principle

Semakin lemah pipeline, semakin berbahaya tool yang kompleks.

Semakin kuat pipeline, semakin banyak metadata tool yang bisa dimanfaatkan.

---

## 16. Decision Axis 12 — Data Migration Frequency

### 16.1 Schema-Heavy, Data-Light

Jika mayoritas change adalah:

- create table;
- add column;
- add index;
- add constraint;
- create view;
- small seed.

Flyway biasanya cukup.

### 16.2 Data-Heavy, Backfill-Heavy

Jika sering ada:

- millions row backfill;
- correction migration;
- derived column population;
- denormalization;
- historical migration;
- encrypted data rotation;
- tenant-by-tenant correction.

Tool pilihan bukan satu-satunya hal penting.

Anda perlu membedakan:

```text
schema migration tool
vs
operational data migration job
```

Flyway/Liquibase cocok untuk:

- schema change;
- small deterministic data change;
- metadata history.

Untuk backfill besar, sering lebih aman:

- dedicated batch job;
- resumable worker;
- checkpoint table;
- throttling;
- observability;
- kill switch.

Flyway atau Liquibase bisa membuat struktur pendukungnya, tetapi tidak selalu harus mengeksekusi seluruh backfill besar.

---

## 17. Matrix Rekomendasi Cepat

| Skenario | Rekomendasi Awal |
|---|---|
| Single Spring Boot service, PostgreSQL, team kecil | Flyway |
| Modular monolith, satu DBMS, SQL-heavy | Flyway |
| Oracle-heavy dengan views/packages/procedures | Flyway atau Liquibase SQL-style; Flyway sering lebih natural |
| Enterprise regulated, approval formal, rollback evidence | Liquibase |
| Multi-DBMS product | Liquibase |
| Banyak conditional migration per environment | Liquibase, tetapi jaga agar tidak chaos |
| Strong roll-forward culture, zero-downtime expand/contract | Flyway sangat cocok |
| Formal rollback-to-tag requirement | Liquibase |
| Legacy DB takeover minimal | Flyway baseline |
| Legacy DB diff/snapshot governance | Liquibase |
| Multi-tenant same migration path | Flyway atau Liquibase; orchestration lebih penting |
| Multi-tenant dengan banyak variasi | Liquibase bisa membantu, tetapi governance wajib kuat |
| Tim baru belajar migration | Flyway lebih mudah |
| Tim platform/DB governance mature | Liquibase lebih ekspresif |
| Semua migration harus raw SQL direview DBA | Flyway atau Liquibase formatted SQL; Flyway lebih sederhana |

---

## 18. Scoring Framework

Gunakan scoring sederhana 1–5.

Nilai 1 berarti rendah, nilai 5 berarti tinggi.

| Faktor | Skor | Mengarah ke |
|---|---:|---|
| Butuh multi-DBMS portability | 1–5 | Liquibase |
| Butuh rollback metadata formal | 1–5 | Liquibase |
| Butuh contexts/labels | 1–5 | Liquibase |
| Butuh precondition kompleks | 1–5 | Liquibase |
| Butuh simplicity dan SQL clarity | 1–5 | Flyway |
| Satu DBMS saja | 1–5 | Flyway |
| Tim nyaman SQL | 1–5 | Flyway |
| Stored procedure/view heavy | 1–5 | Flyway atau Liquibase SQL-style |
| Compliance formal | 1–5 | Liquibase atau Flyway + external governance |
| CI/CD maturity | 1–5 | Keduanya bisa, Liquibase metadata lebih berguna jika pipeline matang |
| Migration branching complexity | 1–5 | Liquibase, tetapi hati-hati |
| Need low ceremony adoption | 1–5 | Flyway |

### 18.1 Contoh Penilaian

Sistem A:

```text
Spring Boot service
PostgreSQL only
team 6 engineer
service-owned schema
no formal rollback requirement
CI with Testcontainers
```

Penilaian:

```text
multi-DBMS portability: 1
rollback formal: 1
contexts/labels: 1
simplicity: 5
team SQL comfort: 4
single DBMS: 5
```

Rekomendasi:

```text
Flyway
```

Sistem B:

```text
Enterprise case management platform
Oracle + SQL Server variants
multiple teams
formal approval
rollback evidence required
UAT/prod targeting
regulated audit
```

Penilaian:

```text
multi-DBMS portability: 4
rollback formal: 4
contexts/labels: 5
preconditions: 5
compliance: 5
simplicity: 2
```

Rekomendasi:

```text
Liquibase, possibly with SQL changelog for DB-specific objects
```

---

## 19. Anti-Decision: Memilih Tool karena Alasan yang Salah

### 19.1 “Pakai Liquibase karena Bisa Rollback Otomatis”

Ini lemah.

Rollback otomatis hanya aman untuk subset perubahan tertentu. Banyak perubahan database tidak bisa di-rollback secara aman tanpa kehilangan data.

Contoh tidak aman:

```sql
ALTER TABLE customer DROP COLUMN old_identifier;
```

Jika data hilang, rollback metadata tidak mengembalikan semantik bisnis.

### 19.2 “Pakai Flyway karena Lebih Simple, Jadi Tidak Perlu Governance”

Salah.

Flyway sederhana, tetapi production database tetap butuh governance:

- naming convention;
- review;
- validation;
- backup;
- lock awareness;
- runbook;
- rollback/roll-forward policy.

### 19.3 “Pakai Liquibase agar Tidak Perlu Tahu SQL”

Salah.

Liquibase bisa menghasilkan SQL, tetapi engineer tetap harus memahami dampaknya.

DDL tetap DDL.

Index tetap bisa memblokir.

Constraint tetap bisa gagal.

Table rewrite tetap bisa mahal.

### 19.4 “Pakai Flyway karena Semua Bisa Raw SQL”

Raw SQL adalah kekuatan sekaligus risiko.

Tanpa review dan testing, raw SQL bisa menyebabkan:

- lock besar;
- deadlock;
- data loss;
- irreversible migration;
- environment-specific bug;
- performance regression.

### 19.5 “Pilih Tool Berdasarkan Popularitas”

Popularitas tidak merepresentasikan constraint Anda.

Tool yang populer di startup tidak selalu cocok untuk regulated enterprise.

Tool yang populer di enterprise tidak selalu efisien untuk small autonomous service.

---

## 20. Hybrid Strategy

Kadang jawaban bukan 100% Flyway atau 100% Liquibase untuk seluruh organisasi.

### 20.1 Per-Service Tooling

Dalam microservices, tiap service bisa memilih tool sendiri jika:

- tiap service punya database sendiri;
- tidak ada shared schema;
- platform punya minimum standard;
- observability diseragamkan.

Contoh:

```text
service-a: Flyway + PostgreSQL
service-b: Liquibase + Oracle
service-c: Flyway + MySQL
```

Ini bisa diterima jika governance lintas service cukup.

### 20.2 Organization Standard

Dalam enterprise, terlalu banyak variasi tool bisa membebani:

- onboarding;
- audit;
- CI template;
- security review;
- DBA support;
- incident response.

Jika organisasi butuh standard, pilih satu tool utama dan definisikan exception process.

### 20.3 Liquibase for Governance, SQL for Execution

Salah satu hybrid style:

```text
Liquibase changelog structure + formatted SQL changesets
```

Keuntungan:

- tetap SQL-readable;
- dapat contexts/labels/preconditions;
- dapat rollback metadata;
- governance lebih kaya.

### 20.4 Flyway for Schema, Separate Tool for Large Data Backfill

Pattern umum:

```text
Flyway:
  - create column
  - create index
  - create checkpoint table

Batch job:
  - backfill 100 million rows safely

Flyway:
  - add constraint
  - drop old column later
```

Ini sering lebih aman daripada memaksa semua data migration besar ke migration runner.

---

## 21. Decision Framework Berdasarkan Architecture Style

### 21.1 Monolith Sederhana

Rekomendasi default:

```text
Flyway
```

Dengan syarat:

- satu DBMS;
- migration linear;
- tidak banyak conditional logic;
- rollback expectation tidak formal.

### 21.2 Modular Monolith

Rekomendasi:

```text
Flyway jika module ownership jelas dan SQL-first cukup.
Liquibase jika changelog perlu dipisah per module dengan metadata governance.
```

Perhatian utama:

- ordering antar module;
- shared lookup;
- cross-module foreign key;
- release train.

### 21.3 Microservices dengan Database per Service

Rekomendasi:

```text
Flyway default untuk service sederhana.
Liquibase untuk service yang butuh conditional/governance/portability.
```

Perhatian utama:

- migration harus dekat dengan service owner;
- migration dijalankan sebelum service membutuhkan schema baru;
- backward compatibility antar service via API/event contract.

### 21.4 Microservices dengan Shared Database

Rekomendasi:

```text
Tool bukan solusi utama. Perbaiki ownership dulu.
```

Jika shared DB tidak bisa dihindari:

- Liquibase bisa membantu governance;
- Flyway bisa tetap dipakai dengan strict ownership;
- migration review lintas tim wajib;
- contract registry disarankan;
- destructive change harus expand/contract.

### 21.5 Enterprise Platform

Rekomendasi:

```text
Liquibase atau Flyway + strong external governance.
```

Liquibase sering unggul jika governance harus embedded di changelog.

Flyway tetap unggul jika organization memilih SQL-first dan semua kontrol dibangun di pipeline.

---

## 22. Decision Framework Berdasarkan Database Vendor

### 22.1 PostgreSQL

Flyway sangat cocok karena PostgreSQL punya banyak pattern SQL spesifik:

- `CREATE INDEX CONCURRENTLY`;
- transactional DDL untuk banyak operasi;
- function/view management;
- enum migration caveats;
- JSONB indexing.

Liquibase cocok jika:

- perlu portability;
- perlu preconditions/context/labels;
- perlu generated SQL preview;
- enterprise governance kuat.

### 22.2 Oracle

Oracle sering punya:

- schema/user distinction;
- packages;
- synonyms;
- grants;
- sequences;
- materialized views;
- CLOB/BLOB;
- online index options;
- editioning dalam beberapa setup;
- heavy DBA governance.

Flyway cocok untuk SQL/package-heavy workflow.

Liquibase cocok untuk enterprise metadata, preconditions, contexts, rollback plan, dan compliance.

Untuk Oracle enterprise, pilihan sering bukan teknis murni, tetapi governance.

### 22.3 MySQL/MariaDB

Perlu hati-hati pada:

- non-transactional DDL behavior;
- metadata locks;
- online DDL limitations;
- charset/collation;
- implicit commits;
- `ALTER TABLE` cost.

Flyway cocok untuk explicit SQL.

Liquibase cocok jika butuh preconditions/rollback documentation.

Untuk large table migration, tool apa pun harus dipadukan dengan online schema change strategy bila diperlukan.

### 22.4 SQL Server

Perlu perhatian pada:

- schema ownership;
- clustered index;
- online index edition support;
- transaction semantics;
- identity behavior;
- computed columns;
- stored procedures.

Flyway cocok untuk SQL-first.

Liquibase cocok untuk formal enterprise governance.

---

## 23. Operational Decision: App Startup vs External Job

Keputusan tool sering kalah penting dibanding keputusan kapan migration dijalankan.

### 23.1 Migration Saat Aplikasi Start

Keuntungan:

- simple;
- developer-friendly;
- cocok local/dev/test;
- deployment self-contained.

Risiko:

- multiple replicas race;
- startup lambat;
- readiness failure;
- migration berat memblokir deployment;
- app punya privilege DDL;
- rollback aplikasi sulit jika DB sudah berubah.

### 23.2 Migration sebagai External Job

Keuntungan:

- kontrol deployment lebih jelas;
- privilege migration bisa dipisah;
- approval gate lebih mudah;
- observability lebih baik;
- app startup lebih bersih;
- cocok Kubernetes Job/CI/CD.

Risiko:

- pipeline lebih kompleks;
- perlu orchestration;
- perlu version compatibility discipline.

### 23.3 Rule of Thumb

Local/dev/test:

```text
app startup migration is fine
```

Production serious workload:

```text
external migration job is usually safer
```

Baik Flyway maupun Liquibase bisa dijalankan sebagai CLI/job/plugin/library.

---

## 24. Governance Checklist Sebelum Memilih Tool

Sebelum memutuskan, jawab ini:

```text
[ ] Apakah database vendor tunggal atau multi-vendor?
[ ] Apakah migration harus SQL-first?
[ ] Apakah DBA harus review SQL aktual?
[ ] Apakah rollback formal wajib?
[ ] Apakah roll-forward lebih realistis?
[ ] Apakah ada regulated audit requirement?
[ ] Apakah ada multi-tenant migration?
[ ] Apakah ada shared database ownership?
[ ] Apakah perlu context/label/environment targeting?
[ ] Apakah migration akan dijalankan saat app startup atau external job?
[ ] Apakah app user dan migration user dipisah?
[ ] Apakah CI menjalankan migration dari fresh DB?
[ ] Apakah CI menjalankan migration dari previous release DB?
[ ] Apakah migration performance diuji?
[ ] Apakah large backfill dipisah dari schema migration?
[ ] Apakah ada runbook failed migration?
[ ] Apakah ada policy melarang edit old migration?
[ ] Apakah ada policy manual DB hotfix?
[ ] Apakah seed data dikelola sebagai migration?
[ ] Apakah drift detection tersedia?
```

Jika mayoritas jawaban belum jelas, jangan berharap pilihan tool menyelamatkan proses.

---

## 25. Recommended Defaults

### 25.1 Default untuk Java Service Modern

Jika tidak ada constraint khusus:

```text
Flyway
```

Dengan standard:

```text
- SQL migration
- versioned migration untuk schema/data seed kecil
- repeatable migration untuk views/functions/procedures
- no edit after applied
- validate in CI
- run against real DB via Testcontainers
- production external job jika migration tidak trivial
```

### 25.2 Default untuk Enterprise Regulated Platform

Jika compliance, approval, rollback evidence, environment targeting, atau multi-team governance kuat:

```text
Liquibase
```

Dengan standard:

```text
- master changelog
- module/release changelog hierarchy
- explicit changeset id/author convention
- preconditions untuk safety
- labels untuk release targeting
- contexts untuk environment targeting dengan batas ketat
- rollback block hanya jika benar-benar aman
- generate SQL preview for review
- no generated changelog without human cleanup
```

### 25.3 Default untuk SQL/DBA-Centric Enterprise

Jika DBA menuntut raw SQL dan tim tetap butuh governance:

```text
Either:
  Flyway + external governance
or
  Liquibase formatted SQL + labels/preconditions
```

### 25.4 Default untuk Multi-DBMS Product

```text
Liquibase, but test every supported DBMS.
```

Jangan percaya portability tanpa test matrix.

---

## 26. Deep Example: Memilih untuk Sistem Enforcement Case Management

Bayangkan sistem Java enterprise untuk case management/regulatory enforcement.

Karakteristik:

- banyak modul: case, appeal, compliance, correspondence, profile, document, audit;
- banyak role/permission;
- banyak lookup/reference data;
- audit trail penting;
- Oracle atau PostgreSQL production;
- environment DEV/UAT/PROD;
- approval formal;
- data correction sensitif;
- perubahan schema harus defensible;
- release sering melibatkan business sign-off.

### 26.1 Jika Satu DBMS dan Tim SQL Kuat

Rekomendasi:

```text
Flyway + strict governance
```

Struktur:

```text
src/main/resources/db/migration/
  V2026.06.17.001__case_add_assignment_reason.sql
  V2026.06.17.002__seed_case_assignment_reason.sql
  V2026.06.17.003__audit_add_actor_channel.sql
  R__case_listing_view.sql
  R__audit_trail_listing_view.sql
```

Governance tambahan:

```text
- migration PR checklist
- DBA SQL review
- UAT dry run
- production runbook
- no destructive change without expand/contract
- approval attached to release ticket
```

### 26.2 Jika Banyak Conditional Deployment dan Audit Evidence Formal

Rekomendasi:

```text
Liquibase
```

Struktur:

```text
db/changelog/master.yaml
db/changelog/releases/2026-q3.yaml
db/changelog/modules/case/case-2026-q3.yaml
db/changelog/modules/audit/audit-2026-q3.yaml
db/changelog/modules/security/security-seed-2026-q3.yaml
```

Governance:

```text
- labels: release-2026-q3, case-module, audit-module
- contexts: dev, uat, prod with strict rules
- preconditions before destructive/conditional changes
- rollback SQL generated only for approved rollback-safe changes
- SQL preview reviewed before deployment
```

### 26.3 Kesimpulan

Dalam sistem seperti ini, keputusan bergantung pada pertanyaan:

```text
Apakah governance ingin diletakkan di pipeline/process, atau sebagian besar ingin dimodelkan di changelog?
```

Jika governance di process kuat dan SQL-first disukai, Flyway cukup kuat.

Jika governance harus embedded di metadata migration, Liquibase lebih cocok.

---

## 27. Migration Standard Apa Pun Tool-nya

Apa pun tool yang dipilih, standard minimal tetap sama.

### 27.1 Jangan Edit Migration yang Sudah Applied

Jika migration sudah masuk shared environment, jangan edit.

Buat migration baru.

Checksum mismatch bukan musuh; checksum mismatch adalah alarm integritas.

### 27.2 Jangan Jadikan ORM Auto-DDL sebagai Production Schema Management

Hibernate `ddl-auto=update` atau sejenisnya bukan strategi production migration.

ORM auto-DDL bisa berguna untuk eksperimen lokal, tetapi bukan untuk regulated production change.

### 27.3 Jangan Campur Banyak Source of Truth

Hindari kombinasi tidak terkendali:

```text
Flyway + Liquibase + schema.sql + data.sql + Hibernate ddl-auto + manual DBA script
```

Pilih satu source of truth untuk schema migration.

### 27.4 Semua Migration Harus Bisa Direview

Review harus menjawab:

- object apa yang berubah;
- data apa yang berubah;
- lock apa yang mungkin terjadi;
- apakah backward compatible;
- apakah rollback/roll-forward plan ada;
- apakah seed deterministic;
- apakah impact production volume dipahami.

### 27.5 Migration Berat Harus Punya Runbook

Minimal:

```text
pre-check
execution step
monitoring query
success criteria
failure criteria
pause/kill strategy
recovery strategy
post-check
```

---

## 28. Common Architecture Patterns

### 28.1 Flyway-First Pattern

```text
Application repo
└── src/main/resources/db/migration
    ├── V001__init.sql
    ├── V002__add_customer_email.sql
    ├── V003__seed_customer_status.sql
    └── R__customer_view.sql
```

Pipeline:

```text
1. build app
2. start real DB container
3. run Flyway migrate
4. run integration tests
5. package artifact
6. deploy migration job to environment
7. deploy app
```

Best for:

- service-owned DB;
- SQL-first;
- low ceremony;
- single DBMS.

### 28.2 Liquibase Governance Pattern

```text
Application repo
└── src/main/resources/db/changelog
    ├── master.yaml
    ├── releases
    │   └── 2026-q3.yaml
    └── modules
        ├── case.yaml
        ├── audit.yaml
        └── security.yaml
```

Pipeline:

```text
1. validate changelog
2. generate SQL preview
3. review/approve SQL
4. run updateSQL in lower env
5. run update in target env
6. tag database
7. archive changelog + SQL preview + logs
```

Best for:

- regulated systems;
- release labels;
- preconditions;
- rollback evidence;
- multi-team governance.

### 28.3 External Migration Job Pattern

```text
Kubernetes Job:
  image: migration-runner
  command: flyway migrate / liquibase update
  credentials: migration user

Application Deployment:
  credentials: app user without DDL privilege
```

Best for:

- production;
- least privilege;
- controlled release;
- serious operational environments.

---

## 29. Decision Smells

### 29.1 Liquibase Smells

Waspadai jika:

- setiap changeset punya context berbeda tanpa standard;
- labels dipakai sebagai feature flag liar;
- generated changelog tidak dibersihkan;
- rollback block dibuat asal agar checklist hijau;
- preconditions dipakai untuk menutupi environment drift;
- author/id tidak konsisten;
- changelog terlalu banyak branching;
- SQL preview tidak pernah direview.

### 29.2 Flyway Smells

Waspadai jika:

- migration lama diedit setelah applied;
- `repair` dipakai untuk menyembunyikan masalah;
- `clean` aktif di environment berbahaya;
- semua seed ditaruh di repeatable migration tanpa strategy;
- migration besar berjalan saat app startup;
- version conflict sering terjadi;
- out-of-order migration dipakai tanpa governance;
- manual DB hotfix tidak direkonsiliasi.

---

## 30. Final Recommendation Framework

Gunakan pertanyaan berikut sebagai final gate.

### 30.1 Pilih Flyway jika Mayoritas Benar

```text
[ ] Database vendor tunggal.
[ ] Tim nyaman membaca dan menulis SQL.
[ ] Migration mostly linear.
[ ] Tidak butuh banyak conditional execution.
[ ] Roll-forward strategy diterima.
[ ] Simplicity lebih penting daripada metadata richness.
[ ] Stored procedure/view/function dikelola sebagai SQL files.
[ ] CI/CD bisa menjalankan validate/migrate.
[ ] Governance bisa dikelola melalui PR, pipeline, dan runbook.
```

### 30.2 Pilih Liquibase jika Mayoritas Benar

```text
[ ] Butuh multi-DBMS portability.
[ ] Butuh preconditions eksplisit.
[ ] Butuh contexts/labels untuk targeting.
[ ] Butuh rollback metadata atau rollback SQL generation.
[ ] Butuh changelog hierarchy lintas module/release.
[ ] Banyak team berkontribusi ke database change.
[ ] Compliance/audit evidence tinggi.
[ ] Perlu SQL preview formal.
[ ] Governance lebih baik jika embedded di changelog.
```

### 30.3 Pilih Keduanya? Hampir Selalu Jangan untuk Satu Schema

Untuk satu schema yang sama, jangan pakai Flyway dan Liquibase bersamaan sebagai peer source-of-truth.

Itu menciptakan dua migration history dan dua model kebenaran.

Exception hanya jika ada alasan transisi yang jelas:

```text
phase 1: legacy tool still active
phase 2: freeze old tool
phase 3: baseline new tool
phase 4: all future migration in new tool
```

Transisi harus punya cutoff date dan ownership jelas.

---

## 31. Ringkasan Mental Model

Flyway cocok ketika Anda ingin:

```text
plain SQL, linear history, low ceremony, explicit control
```

Liquibase cocok ketika Anda ingin:

```text
rich metadata, conditional execution, labels/contexts, rollback/governance support
```

Tetapi tool terbaik tetap kalah oleh proses buruk.

Migration engineering yang baik membutuhkan:

- versioning discipline;
- compatibility thinking;
- deterministic seed;
- lock awareness;
- CI validation;
- production runbook;
- audit trail;
- rollback/roll-forward policy;
- no manual drift;
- real database testing.

Top-tier engineer tidak memilih Flyway atau Liquibase berdasarkan opini.

Top-tier engineer memilih berdasarkan **risk model**.

---

## 32. Latihan Praktis

### Latihan 1 — Tool Selection Memo

Ambil satu sistem nyata atau imajiner.

Isi:

```text
Database vendor:
Architecture style:
Number of services/modules:
Deployment model:
Rollback requirement:
Compliance level:
Multi-tenant requirement:
Data migration frequency:
Team SQL maturity:
CI/CD maturity:
```

Lalu putuskan:

```text
Recommended tool:
Why:
Risks:
Mitigations:
```

### Latihan 2 — Compare Two Strategies

Bandingkan dua opsi:

```text
Option A: Flyway + SQL migration + external runbook
Option B: Liquibase + changelog + preconditions + rollback SQL
```

Nilai berdasarkan:

- simplicity;
- auditability;
- rollback confidence;
- reviewability;
- operational safety;
- learning curve;
- long-term maintainability.

### Latihan 3 — Identify Wrong Assumption

Untuk setiap pernyataan berikut, jelaskan mengapa salah atau tidak lengkap:

```text
Liquibase aman karena bisa rollback.
Flyway tidak cocok untuk enterprise.
SQL migration selalu lebih berbahaya dari declarative migration.
Declarative migration membuat kita tidak perlu tahu SQL dialect.
Tool migration bisa menggantikan DBA review.
Migration saat app startup selalu baik karena otomatis.
```

---

## 33. Referensi Resmi dan Rujukan

- Redgate Flyway documentation menjelaskan migration sebagai versioned/repeatable migration dan undo migration sebagai kebalikan dari versioned migration dengan versi yang sama.
- Dokumentasi Liquibase menjelaskan changeset sebagai unit dasar perubahan, diidentifikasi oleh `author`, `id`, dan changelog file path, serta dapat memiliki preconditions, contexts, dan labels.
- Dokumentasi Liquibase rollback menjelaskan rollback command sebagai mekanisme untuk mengembalikan perubahan setelah tag tertentu.
- Dokumentasi Spring Boot menyatakan dukungan terhadap Flyway dan Liquibase sebagai higher-level database migration tools, dan dalam praktik serius mekanisme initialization dasar tidak seharusnya dicampur tanpa kontrol.

---

## 34. Penutup

Part ini adalah jembatan antara pembahasan tool dan pembahasan strategi data.

Setelah ini, kita tidak lagi memandang migration sebagai “file SQL yang dijalankan berurutan”, tetapi sebagai bagian dari sistem release yang harus menjawab:

```text
Apa yang berubah?
Siapa yang memiliki perubahan?
Kapan aman dijalankan?
Apakah backward compatible?
Bagaimana jika gagal?
Bagaimana diverifikasi?
Bagaimana diaudit?
Bagaimana dipulihkan?
```

Pada part berikutnya, kita akan masuk ke **seeding strategy**: reference data, master data, bootstrap data, role/permission seed, tenant seed, feature flag seed, dan bagaimana membedakan production seed dari test fixture.

---

# Status Seri

- Part selesai: Part 16 dari 34.
- Seri belum selesai.
- Part berikutnya: `17-seeding-reference-master-bootstrap-data.md`.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 15 — Liquibase Rollback Engineering](./15-liquibase-rollback-engineering.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 17 — Seeding Strategy: Reference Data, Master Data, and Bootstrap Data](./17-seeding-reference-master-bootstrap-data.md)

</div>