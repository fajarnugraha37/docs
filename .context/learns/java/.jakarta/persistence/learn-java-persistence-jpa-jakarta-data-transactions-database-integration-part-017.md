# Part 017 — Schema Generation, Migration, and Database Contract

> Seri: `learn-java-persistence-jpa-jakarta-data-transactions-database-integration`  
> Rentang Java: 8 sampai 25  
> Fokus: Java/Jakarta Persistence, JPA, Hibernate ORM, Jakarta Data, Jakarta Transactions, dan integrasi database production-grade  
> Part: 017 dari 032

---

## 1. Tujuan Pembelajaran

Setelah mempelajari bagian ini, kamu diharapkan mampu:

1. Memahami bahwa **schema database adalah contract**, bukan artefak sementara yang boleh berubah otomatis tanpa governance.
2. Membedakan peran **entity mapping**, **schema generation**, dan **schema migration**.
3. Menentukan kapan schema boleh dibuat otomatis, kapan hanya boleh divalidasi, dan kapan harus dimigrasikan eksplisit.
4. Mendesain migration yang aman untuk production, termasuk backward-compatible migration, zero-downtime rollout, dan rollback strategy.
5. Menghindari jebakan `ddl-auto=update`, Hibernate `hbm2ddl`, dan automatic schema evolution di lingkungan serius.
6. Menulis strategi perubahan schema untuk table besar, column rename, enum change, constraint rollout, index rollout, dan data backfill.
7. Memahami relasi antara JPA/Jakarta Persistence metadata, Hibernate schema tooling, Flyway/Liquibase, CI/CD, dan database release process.
8. Membangun mental model **expand-migrate-contract** agar aplikasi multi-version tetap kompatibel selama deployment bertahap.
9. Mendeteksi dan mengendalikan schema drift antara code, migration, dan database aktual.
10. Mendesain database contract yang defensible untuk sistem regulatory/case management.

---

## 2. Mental Model: Entity Mapping Bukan Sumber Kebenaran Tunggal

Di aplikasi kecil, kita sering berpikir seperti ini:

```text
Entity class berubah
        ↓
ORM otomatis update schema
        ↓
Aplikasi jalan
```

Di production system, mental model ini berbahaya.

Mental model yang lebih benar:

```text
Business invariant
        ↓
Domain / use case requirement
        ↓
Database contract
        ↓
Versioned migration
        ↓
Entity mapping disesuaikan
        ↓
Application code memakai contract tersebut
        ↓
Runtime validation + observability memastikan tidak drift
```

Artinya:

- Entity mapping menjelaskan bagaimana Java object dipetakan ke database.
- Migration menjelaskan bagaimana database berubah dari versi N ke versi N+1.
- Database contract menjelaskan apa yang dijamin oleh storage layer.
- Production release process memastikan perubahan contract tidak memutus aplikasi lama, job lama, report lama, atau integrasi lain.

JPA/Jakarta Persistence memang menyediakan schema generation capability. Tetapi capability itu tidak otomatis berarti cocok dipakai untuk production migration. Schema generation berguna untuk development, prototyping, test database, documentation, atau baseline DDL. Production migration membutuhkan versioning, ordering, review, repeatability, rollback thinking, dan operational control.

---

## 3. Pembedaan Penting: Schema Generation vs Schema Migration

### 3.1 Schema Generation

Schema generation adalah proses menghasilkan atau menjalankan DDL dari metadata ORM.

Contoh sumber metadata:

- `@Entity`
- `@Table`
- `@Column`
- `@ManyToOne`
- `@JoinColumn`
- `@Enumerated`
- `@Embedded`
- Hibernate-specific annotation seperti `@Check`, `@ColumnDefault`, `@JdbcTypeCode`, dan lain-lain

Contoh output:

```sql
create table application (
    id bigint not null,
    application_no varchar(50) not null,
    status varchar(30) not null,
    created_at timestamp not null,
    primary key (id)
);
```

Kelebihan:

- cepat untuk local development,
- cocok untuk prototype,
- cocok untuk test ephemeral database,
- membantu melihat bentuk DDL kasar dari mapping,
- bisa dipakai sebagai bahan review awal.

Kekurangan:

- tidak tahu sejarah perubahan,
- tidak tahu data existing,
- tidak tahu volume table,
- tidak tahu deployment order,
- tidak tahu compatibility aplikasi versi lama,
- tidak tahu index harus dibuat online atau offline,
- tidak tahu constraint harus divalidasi langsung atau bertahap,
- tidak tahu cara backfill aman,
- tidak tahu rollback bisnis.

### 3.2 Schema Migration

Schema migration adalah proses mengubah database secara eksplisit dari satu versi ke versi lain.

Contoh:

```sql
-- V017_001__add_application_external_ref.sql
alter table application add external_ref varchar(64);

create unique index ux_application_external_ref
    on application (external_ref);
```

Migration memiliki karakter:

- versioned,
- ordered,
- reviewable,
- repeatable dalam pipeline,
- tercatat di metadata table,
- bisa diuji sebelum production,
- bisa dikaitkan dengan release notes,
- bisa diaudit.

Tools umum:

- Flyway,
- Liquibase,
- database-native migration script,
- internal release framework.

### 3.3 Database Contract

Database contract adalah semua guarantee yang disediakan database kepada aplikasi dan integrasi.

Termasuk:

- table dan column,
- type,
- nullability,
- primary key,
- foreign key,
- unique constraint,
- check constraint,
- index,
- sequence,
- trigger,
- generated column,
- partition,
- view,
- materialized view,
- stored procedure,
- permission/grant,
- row-level security,
- schema ownership,
- naming convention,
- retention policy,
- archival boundary.

Contract bukan hanya “bentuk table”. Contract adalah jaminan yang dipakai oleh application code, report, batch job, data pipeline, audit process, DBA, dan support engineer.

---

## 4. Mengapa `ddl-auto=update` Berbahaya di Production

Di Spring/Hibernate world, banyak developer mengenal properti seperti:

```properties
spring.jpa.hibernate.ddl-auto=update
```

atau Hibernate native:

```properties
hibernate.hbm2ddl.auto=update
```

Mode seperti ini terlihat praktis karena Hibernate mencoba menyesuaikan schema dengan entity mapping. Masalahnya: production schema evolution bukan hanya masalah “apa yang kurang dari table”.

### 4.1 Hal yang Tidak Bisa Diputuskan Aman oleh ORM

ORM tidak punya cukup context untuk menjawab pertanyaan seperti:

- Apakah column rename atau drop+add?
- Apakah perubahan type akan truncate data?
- Apakah nullable ke non-nullable butuh backfill dulu?
- Apakah unique constraint akan gagal karena data existing duplicate?
- Apakah index creation akan lock table besar?
- Apakah foreign key validation akan memblokir write traffic?
- Apakah aplikasi versi lama masih membaca column lama?
- Apakah rolling deployment sedang berjalan?
- Apakah report downstream memakai table tersebut?
- Apakah field ini punya data retention/legal implication?
- Apakah rollback harus mempertahankan data baru?

Contoh perubahan entity:

```java
@Column(name = "reference_no", nullable = false, length = 50)
private String referenceNo;
```

Dari sini ORM tidak tahu:

- bagaimana mengisi `reference_no` untuk 30 juta row existing,
- apakah value harus unik,
- apakah value berasal dari sequence, external system, atau generated rule,
- apakah backfill boleh dilakukan saat jam kerja,
- apakah kolom harus dibuat nullable dulu,
- apakah constraint harus divalidasi belakangan.

### 4.2 Mode Aman per Environment

Rekomendasi praktis:

| Environment | Schema generation mode | Catatan |
|---|---:|---|
| Local quick prototype | create / create-drop | Boleh jika data disposable |
| Local development shared | migration tool | Hindari schema auto update yang membuat environment drift |
| Unit/integration test ephemeral | create-drop atau migration | Test migration lebih realistis |
| CI | validate + migration | Pastikan mapping sesuai schema hasil migration |
| UAT/staging | migration + validate | Mirip production |
| Production | migration + validate | Jangan auto update schema |

Untuk production, pola yang lebih aman:

```properties
spring.jpa.hibernate.ddl-auto=validate
```

Atau non-Spring:

```properties
hibernate.hbm2ddl.auto=validate
```

Dengan catatan: validation bukan pengganti migration. Validation hanya membantu mendeteksi mismatch dasar antara mapping dan schema.

---

## 5. Jakarta Persistence Schema Generation

Jakarta Persistence menyediakan standard property untuk schema generation. Ini berguna untuk portable configuration, terutama saat tidak memakai Spring Boot.

Contoh property konseptual:

```properties
jakarta.persistence.schema-generation.database.action=none
jakarta.persistence.schema-generation.scripts.action=create
jakarta.persistence.schema-generation.scripts.create-target=target/schema-create.sql
jakarta.persistence.schema-generation.create-source=metadata
```

Nilai action bergantung pada provider dan specification support, tetapi secara mental model biasanya ada kategori:

- `none`: tidak melakukan apa-apa,
- `create`: membuat schema object,
- `drop`: drop schema object,
- `drop-and-create`: drop lalu create,
- script generation: menghasilkan SQL script tanpa menjalankan langsung ke database.

Use case yang masuk akal:

1. Menghasilkan DDL baseline dari mapping.
2. Membandingkan output DDL provider dengan migration manual.
3. Membuat schema ephemeral untuk test tertentu.
4. Membantu dokumentasi mapping.

Use case yang tidak disarankan:

1. Auto migration production.
2. Mengubah table besar tanpa review.
3. Mengganti migration tool.
4. Mengelola index/constraint kompleks hanya dari annotation.

---

## 6. Hibernate Schema Tooling dan `hbm2ddl`

Hibernate menyediakan schema management tooling yang sudah lama dikenal lewat `hbm2ddl.auto`.

Mode yang umum dikenal:

```text
none
validate
update
create
create-drop
```

Interpretasi praktis:

| Mode | Makna | Cocok untuk |
|---|---|---|
| none | Tidak melakukan schema action | Production dengan migration tool |
| validate | Validasi mapping vs schema | CI/UAT/Production |
| update | Mencoba update schema | Prototype/local disposable saja |
| create | Drop/create atau create fresh tergantung config | Test/local disposable |
| create-drop | Create saat start, drop saat shutdown | Test ephemeral |

Masalah utama `update` bukan karena Hibernate buruk. Masalahnya adalah automatic diff dari ORM metadata ke database aktual tidak cukup untuk mengelola data dan operational risk.

Contoh risiko:

```java
@Column(name = "status", nullable = false, length = 20)
private String status;
```

Berubah menjadi:

```java
@Column(name = "case_status", nullable = false, length = 30)
private String caseStatus;
```

Apakah ini rename column? Drop column lama? Add column baru? Copy data? Aplikasi versi lama masih perlu `status`? Itu keputusan release engineering, bukan keputusan ORM.

---

## 7. Flyway: Versioned Migration Mental Model

Flyway memakai konsep migration file yang dieksekusi secara berurutan dan dicatat di metadata table.

Naming umum:

```text
V001__create_application_table.sql
V002__add_application_status.sql
V003__create_case_table.sql
R__refresh_application_listing_view.sql
```

Kategori migration:

- **Versioned migration**: dieksekusi sekali berdasarkan version.
- **Repeatable migration**: dieksekusi ulang ketika checksum berubah; cocok untuk view, function, procedure, static derived object.
- **Baseline**: menandai database existing sebagai baseline version.
- **Undo migration**: tersedia di edisi/konfigurasi tertentu, tetapi rollback production tetap harus dipikirkan secara operasional, bukan hanya “reverse SQL”.

### 7.1 Kelebihan Flyway

- Simple.
- SQL-first.
- Mudah direview DBA.
- Cocok untuk tim yang ingin migration eksplisit.
- Mudah dipakai dengan Spring Boot.
- Cocok untuk pipeline yang strict.

### 7.2 Kekurangan / Trade-off

- Cross-database abstraction minimal.
- Rollback bukan magic.
- Perlu discipline naming dan ordering.
- Perlu strategi untuk long-running migration.
- Refactoring migration lama harus hati-hati karena checksum.

### 7.3 Struktur Folder yang Disarankan

```text
src/main/resources/db/migration/
  V001__create_core_tables.sql
  V002__create_application_tables.sql
  V003__create_case_tables.sql
  V004__add_application_indexes.sql
  V005__add_audit_tables.sql
  R__application_listing_view.sql
```

Untuk multi-database:

```text
src/main/resources/db/migration/common/
src/main/resources/db/migration/oracle/
src/main/resources/db/migration/postgresql/
```

Atau pisahkan berdasarkan service/schema:

```text
db/migration/aceas_core/
db/migration/aceas_case/
db/migration/aceas_audit/
```

---

## 8. Liquibase: Changelog dan Changeset Mental Model

Liquibase memakai konsep changelog dan changeset. Changelog bisa ditulis dalam XML, YAML, JSON, atau SQL formatted changelog.

Contoh konseptual YAML:

```yaml
databaseChangeLog:
  - changeSet:
      id: 017-001-add-application-external-ref
      author: fajar
      changes:
        - addColumn:
            tableName: application
            columns:
              - column:
                  name: external_ref
                  type: varchar(64)
```

### 8.1 Kelebihan Liquibase

- Lebih kaya untuk governance.
- Mendukung changelog abstraction.
- Mendukung rollback definition.
- Mendukung precondition.
- Cocok untuk enterprise yang butuh auditability tinggi.
- Bisa lebih nyaman untuk multi-database abstraction.

### 8.2 Kekurangan / Trade-off

- Lebih kompleks dibanding Flyway.
- Changelog abstraction bisa menyembunyikan detail SQL penting.
- Untuk tuning production, raw SQL tetap sering dibutuhkan.
- Rollback tetap tidak selalu aman secara data/business.

### 8.3 Kapan Memilih Flyway vs Liquibase

Gunakan Flyway jika:

- tim nyaman SQL-first,
- migration process ingin sederhana,
- DBA ingin review SQL langsung,
- deployment pipeline straightforward,
- aplikasi tidak butuh changelog governance kompleks.

Gunakan Liquibase jika:

- governance/audit database change sangat penting,
- perlu precondition/rollback metadata yang kuat,
- organisasi punya banyak database engine,
- compliance process menuntut changelog formal,
- database change harus masuk workflow approval enterprise.

Keduanya bisa dipakai dengan disiplin yang benar. Tool bukan pengganti desain migration.

---

## 9. Entity Mapping vs Migration: Siapa yang Menang?

Pertanyaan penting: jika entity mapping dan migration berbeda, mana yang benar?

Jawaban production-grade:

> Database contract yang sudah dirilis dan migration history adalah sumber kebenaran operasional. Entity mapping harus sesuai dengan contract tersebut.

Entity mapping tidak boleh diam-diam mengubah contract production. Namun mapping juga bukan “hanya follower”; mapping adalah representasi code terhadap contract. Keduanya harus dijaga konsisten lewat:

- code review,
- migration review,
- schema validation,
- integration test,
- CI pipeline,
- drift detection,
- observability.

Contoh mismatch:

```java
@Column(name = "application_no", nullable = false, length = 100)
private String applicationNo;
```

Tetapi database:

```sql
application_no varchar(50) not null
```

Risiko:

- aplikasi menerima 80 char,
- JPA entity tampak valid,
- insert gagal dengan data too long,
- error muncul terlambat di production,
- user melihat 500 jika exception tidak dimapping.

Solusi:

- samakan length di entity, DTO validation, dan schema,
- tambah test constraint,
- gunakan migration explicit jika length memang perlu diperbesar,
- pastikan downstream/report tidak terdampak.

---

## 10. Backward-Compatible Schema Change

Production modern sering memakai rolling deployment:

```text
pod/service instance lama masih berjalan
pod/service instance baru mulai naik
traffic terbagi
DB hanya satu
```

Artinya database schema harus kompatibel dengan:

- aplikasi versi lama,
- aplikasi versi baru,
- background job versi lama,
- message consumer versi lama,
- report/query lama,
- integration adapter lama.

### 10.1 Rule Dasar Backward Compatibility

Perubahan yang relatif aman:

- add nullable column,
- add table baru,
- add index baru,
- add non-enforced constraint metadata,
- add view baru,
- add enum value jika code lama mengabaikan value baru,
- widen column type/length jika database mendukung aman.

Perubahan yang berbahaya:

- drop column,
- rename column,
- change type secara incompatible,
- make nullable column menjadi not null tanpa backfill,
- add unique constraint tanpa deduplicate data,
- add foreign key pada data kotor,
- shrink column length,
- remove enum value,
- change semantic meaning column,
- split/merge table tanpa compatibility layer.

### 10.2 Expand-Migrate-Contract Pattern

Pola paling penting untuk zero-downtime schema evolution:

```text
1. Expand
   Tambah schema baru tanpa merusak aplikasi lama.

2. Migrate
   Isi/copy/backfill data dan deploy aplikasi yang bisa membaca/menulis format baru.

3. Contract
   Setelah semua aman, hapus schema lama atau enforce constraint baru.
```

Contoh rename column `status` menjadi `case_status`.

#### Step 1 — Expand

```sql
alter table case_record add case_status varchar(30);
```

Aplikasi baru bisa dual-write:

```text
write status lama
write case_status baru
```

#### Step 2 — Migrate

```sql
update case_record
set case_status = status
where case_status is null;
```

Untuk table besar, jangan satu update raksasa. Gunakan chunked backfill.

#### Step 3 — Switch Read

Aplikasi baru membaca `case_status`, dengan fallback sementara ke `status` jika perlu.

#### Step 4 — Enforce

```sql
alter table case_record modify case_status not null;
```

Tergantung DB, constraint bisa dibuat bertahap.

#### Step 5 — Contract

Setelah semua instance lama mati dan observability menunjukkan aman:

```sql
alter table case_record drop column status;
```

Drop column sering ditunda ke release berikutnya agar rollback aplikasi tetap mungkin.

---

## 11. Column Addition Strategy

### 11.1 Add Nullable Column

Relatif aman:

```sql
alter table application add reviewer_note varchar(1000);
```

Entity:

```java
@Column(name = "reviewer_note", length = 1000)
private String reviewerNote;
```

Perhatikan:

- apakah column perlu index,
- apakah null punya semantic jelas,
- apakah DTO response expose field baru,
- apakah old code aman mengabaikan column baru.

### 11.2 Add Non-Nullable Column

Jangan langsung:

```sql
alter table application add source varchar(30) not null;
```

Untuk table existing, ini bisa gagal atau lock besar. Gunakan bertahap:

```sql
alter table application add source varchar(30);
```

Deploy aplikasi yang menulis `source` untuk row baru.

Backfill:

```sql
update application
set source = 'LEGACY'
where source is null;
```

Validasi:

```sql
select count(*) from application where source is null;
```

Baru enforce:

```sql
alter table application modify source not null;
```

Untuk PostgreSQL/Oracle/SQL Server/MySQL, syntax dan locking behavior berbeda. Production migration harus disesuaikan dengan engine.

---

## 12. Column Rename Strategy

Rename column adalah salah satu perubahan paling berisiko karena aplikasi lama biasanya masih memakai nama lama.

### 12.1 Hindari Rename Langsung di Rolling Deployment

Berbahaya:

```sql
alter table application rename column status to application_status;
```

Jika aplikasi lama masih running, query lama gagal.

### 12.2 Gunakan Add-Copy-Dual-Write-Switch-Drop

```text
Release A:
- add application_status nullable
- aplikasi menulis status dan application_status
- aplikasi masih membaca status

Backfill:
- copy status ke application_status

Release B:
- aplikasi membaca application_status
- tetap dual-write sementara

Release C:
- stop write status
- drop status setelah aman
```

Trade-off:

- lebih lama,
- lebih banyak code sementara,
- lebih aman untuk rolling deployment dan rollback.

---

## 13. Type Change Strategy

Perubahan type sering terlihat kecil tetapi sangat berbahaya.

Contoh:

```sql
amount varchar(50) -> amount numeric(19,2)
```

Risiko:

- data existing tidak parseable,
- rounding berbeda,
- index berubah,
- query/report rusak,
- aplikasi lama masih menulis string.

Strategi aman:

1. Tambah column baru `amount_num`.
2. Deploy dual-write jika memungkinkan.
3. Backfill dengan validasi.
4. Report invalid row ke remediation queue.
5. Switch read ke column baru.
6. Enforce constraint.
7. Drop column lama setelah release aman.

Contoh backfill validasi PostgreSQL-style tidak portable:

```sql
-- contoh konseptual, sesuaikan dengan DB
update payment
set amount_num = cast(amount as numeric(19,2))
where amount_num is null
  and amount ~ '^[0-9]+(\.[0-9]{1,2})?$';
```

Untuk Oracle, regex/cast syntax berbeda. Jangan tulis migration production tanpa testing di engine yang sama.

---

## 14. Enum Migration Strategy

Enum adalah sumber bug schema-contract yang sering diremehkan.

### 14.1 Hindari Ordinal

Entity buruk:

```java
@Enumerated(EnumType.ORDINAL)
private CaseStatus status;
```

Masalah:

```java
DRAFT = 0
SUBMITTED = 1
APPROVED = 2
```

Jika enum disisipkan:

```java
DRAFT = 0
UNDER_REVIEW = 1
SUBMITTED = 2
APPROVED = 3
```

Data lama rusak secara semantic.

### 14.2 Gunakan Stable Code

```java
public enum CaseStatus {
    DRAFT("DRAFT"),
    SUBMITTED("SUBMITTED"),
    UNDER_REVIEW("UNDER_REVIEW"),
    APPROVED("APPROVED"),
    REJECTED("REJECTED");

    private final String code;

    CaseStatus(String code) {
        this.code = code;
    }

    public String code() {
        return code;
    }
}
```

Mapping bisa memakai `EnumType.STRING` atau converter.

### 14.3 Add Enum Value

Jika database memakai check constraint:

```sql
alter table case_record drop constraint ck_case_status;

alter table case_record add constraint ck_case_status
check (status in ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'));
```

Deployment order:

1. Database menerima value baru.
2. Aplikasi baru mulai menulis value baru.
3. Aplikasi lama harus tidak crash jika membaca value baru, atau traffic lama harus dihentikan dulu.

Untuk rolling deployment, aplikasi lama yang tidak mengenal enum baru bisa gagal saat hydration:

```text
No enum constant CaseStatus.UNDER_REVIEW
```

Solusi:

- deploy compatibility code dulu,
- gunakan unknown fallback untuk read model jika domain mengizinkan,
- jangan tulis enum baru sampai semua node siap,
- gunakan feature flag.

---

## 15. Constraint Rollout Strategy

Constraint adalah tempat database menjaga invariant. Tetapi constraint baru pada data lama bisa gagal atau lock besar.

### 15.1 Not Null Constraint

Tahapan:

```text
1. Add nullable column.
2. Deploy code yang mengisi value.
3. Backfill existing null.
4. Validate no null.
5. Add not null constraint.
```

### 15.2 Unique Constraint

Sebelum unique constraint:

```sql
select application_no, count(*)
from application
group by application_no
having count(*) > 1;
```

Jika duplicate ada, migration harus punya remediation plan.

Untuk soft delete, unique constraint sering salah.

Problem:

```text
application_no harus unik untuk row aktif,
tapi row soft-deleted boleh punya application_no sama.
```

Solusi database-specific:

- PostgreSQL partial unique index:

```sql
create unique index ux_application_no_active
on application(application_no)
where deleted_at is null;
```

- Oracle bisa memakai function-based index:

```sql
create unique index ux_application_no_active
on application(case when deleted_at is null then application_no end);
```

- MySQL perlu generated column atau strategi lain.

### 15.3 Foreign Key Constraint

Sebelum FK:

```sql
select child.parent_id
from child
left join parent on parent.id = child.parent_id
where child.parent_id is not null
  and parent.id is null;
```

Jika orphan row ada, migration harus membersihkan atau memetakan data.

FK production impact:

- insert/update child perlu validasi parent,
- delete parent bisa terblokir,
- locking bisa berubah,
- index pada child FK biasanya penting.

### 15.4 Check Constraint

Check constraint bagus untuk invariant sederhana:

```sql
alter table application add constraint ck_application_status
check (status in ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'));
```

Tapi hati-hati:

- enum rollout,
- legacy invalid data,
- DB-specific syntax,
- aplikasi lama yang menulis value lama.

---

## 16. Index Rollout Strategy

Index bukan hanya optimasi. Index adalah bagian dari database contract performance.

### 16.1 Index Harus Berangkat dari Query

Jangan membuat index dari feeling. Mulai dari query:

```sql
select *
from application
where agency_id = ?
  and status = ?
  and submitted_at >= ?
order by submitted_at desc
fetch first 50 rows only;
```

Candidate index:

```sql
create index ix_application_agency_status_submitted
on application(agency_id, status, submitted_at desc);
```

Tapi urutan column harus dipikirkan berdasarkan:

- selectivity,
- equality predicate,
- range predicate,
- sort order,
- covering needs,
- database optimizer behavior.

### 16.2 Index Creation on Large Table

Risiko:

- lock table,
- heavy I/O,
- replication lag,
- temp space usage,
- longer deployment,
- blocked DML,
- CPU spike.

Database-specific feature:

- PostgreSQL: `CREATE INDEX CONCURRENTLY`.
- Oracle: `CREATE INDEX ... ONLINE` pada edition yang mendukung.
- SQL Server: online index operations pada edition tertentu.
- MySQL/InnoDB: online DDL tergantung versi/operation.

Migration harus menyebut strategi engine-specific.

### 16.3 Drop Index

Drop index juga berisiko. Sebelum drop:

- cek usage statistics,
- cek query plan critical path,
- cek report/batch job,
- cek FK support,
- cek index duplicate/overlap,
- lakukan di staging dengan workload representative.

---

## 17. Data Backfill Strategy

Backfill adalah proses mengisi/memperbaiki data existing setelah schema berubah.

### 17.1 Jangan Backfill Raksasa dalam Satu Transaction

Buruk:

```sql
update audit_trail
set normalized_module = upper(module)
where normalized_module is null;
```

Jika table 200 juta row:

- undo/redo membesar,
- lock lama,
- replication lag,
- transaction log penuh,
- DB CPU/I/O spike,
- rollback mahal,
- aplikasi online terganggu.

### 17.2 Chunked Backfill

Pola:

```text
repeat:
  ambil N row yang belum dimigrasikan
  update N row
  commit
  sleep/throttle
  record progress
until done
```

Contoh pseudo SQL:

```sql
update application
set source = 'LEGACY'
where source is null
  and id between :start_id and :end_id;
```

Atau keyset:

```sql
select id
from application
where source is null
  and id > :last_id
order by id
fetch first 1000 rows only;
```

Lalu update berdasarkan id list.

### 17.3 Backfill App vs DB Script

DB script cocok jika:

- transformasi sederhana,
- bisa set-based,
- tidak butuh business service,
- tidak perlu external API,
- mudah diverifikasi SQL.

Application backfill cocok jika:

- transformasi butuh domain logic,
- butuh validation kompleks,
- perlu idempotency/progress tracking,
- perlu throttling dinamis,
- perlu observability aplikasi,
- perlu retry per item.

Tapi application backfill jangan memakai entity-heavy JPA naif untuk jutaan row. Gunakan batch pattern dari Part 016.

---

## 18. View, Materialized View, Function, Trigger, dan Stored Procedure

Tidak semua database contract direpresentasikan oleh entity.

### 18.1 View untuk Read Model

```sql
create or replace view application_listing_view as
select
    a.id,
    a.application_no,
    a.status,
    p.name as applicant_name,
    a.submitted_at
from application a
join applicant p on p.id = a.applicant_id;
```

Cocok untuk:

- listing read model,
- report,
- backward compatibility,
- simplifying complex joins.

Mapping JPA read-only:

```java
@Entity
@Table(name = "application_listing_view")
@org.hibernate.annotations.Immutable
public class ApplicationListingView {
    @Id
    private Long id;

    @Column(name = "application_no")
    private String applicationNo;

    @Column(name = "applicant_name")
    private String applicantName;
}
```

Catatan: `@Immutable` Hibernate-specific. Jika ingin portable, jangan mengubah entity view dan gunakan projection/native query.

### 18.2 Materialized View

Cocok untuk:

- report berat,
- aggregation,
- dashboard,
- data snapshot.

Risiko:

- refresh strategy,
- staleness,
- lock saat refresh,
- storage,
- refresh failure,
- consistency expectation user.

### 18.3 Trigger

Trigger bisa berguna untuk:

- audit low-level,
- generated field,
- integration with legacy,
- enforce invariant tertentu.

Tapi trigger berisiko karena behavior tersembunyi dari application code.

Jika memakai trigger:

- dokumentasikan,
- test integration,
- pastikan entity state setelah flush/commit sesuai,
- gunakan `refresh()` jika value generated perlu dibaca segera,
- masukkan trigger ke migration/version control.

---

## 19. Sequence, Identity, dan Generator Migration

Identifier generator adalah bagian dari database contract.

### 19.1 Sequence

Contoh:

```sql
create sequence application_seq start with 1 increment by 50;
```

Entity:

```java
@Id
@GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "application_seq_gen")
@SequenceGenerator(
    name = "application_seq_gen",
    sequenceName = "application_seq",
    allocationSize = 50
)
private Long id;
```

Perhatikan:

- `allocationSize` harus cocok dengan optimizer strategy,
- gap id normal,
- sequence cache bisa hilang saat restart,
- multi-node aman jika sequence database yang mengatur,
- migration harus membuat sequence sebelum entity dipakai.

### 19.2 Identity

Identity column sering lebih sederhana tetapi bisa menghambat JDBC batching pada beberapa provider/DB karena id baru diketahui setelah insert.

Schema migration harus eksplisit:

```sql
create table application (
    id bigint generated by default as identity primary key,
    application_no varchar(50) not null
);
```

Syntax berbeda antar database.

### 19.3 Migrasi Generator

Mengubah `IDENTITY` ke `SEQUENCE`, atau sebaliknya, bukan refactor kecil.

Risiko:

- existing id collision,
- sequence current value salah,
- batch insert behavior berubah,
- test data generator rusak,
- replication/import script rusak.

Migration harus menyertakan validasi:

```sql
select max(id) from application;
```

Lalu set sequence start/current value di atas max id sesuai database.

---

## 20. Multi-Schema dan Multi-Service Migration

Pada sistem besar, satu aplikasi bisa punya:

- satu schema per bounded context,
- satu schema per tenant/agency,
- schema terpisah untuk audit,
- schema terpisah untuk reporting,
- read-only schema untuk external report,
- shared reference schema.

### 20.1 Masalah Dependency Antar Schema

Contoh:

```text
case schema butuh FK/reference ke profile schema
reporting view join application + case + compliance
```

Risiko:

- migration order antar module,
- privilege/grant belum siap,
- view gagal compile,
- dependency cycle,
- rollback sebagian.

### 20.2 Strategi

- version setiap schema,
- pisahkan migration path,
- definisikan dependency order,
- hindari cross-schema FK jika ownership berbeda dan operationally sulit,
- gunakan stable public table/view contract,
- gunakan event/outbox untuk sinkronisasi antar bounded context jika perlu,
- pastikan grant masuk migration.

Contoh grant:

```sql
grant select on application.application_listing_view to reporting_user;
```

Grant adalah contract juga. Jangan dianggap konfigurasi manual ad-hoc.

---

## 21. Schema Drift Detection

Schema drift terjadi saat database aktual tidak sama dengan yang diasumsikan code/migration.

Penyebab:

- manual hotfix langsung di DB,
- migration gagal sebagian,
- environment dibuat dari backup lama,
- developer menjalankan `ddl-auto=update`,
- DBA menambah index manual tanpa version control,
- branch migration conflict,
- migration diedit setelah pernah dijalankan,
- multi-service menulis schema sama.

### 21.1 Deteksi

Gunakan kombinasi:

- migration metadata table,
- Hibernate/JPA validate,
- schema diff tool,
- information_schema/data dictionary query,
- CI migration test,
- environment audit,
- checksum validation,
- DBA review.

### 21.2 Drift Policy

Policy yang sehat:

1. Tidak ada manual DB change tanpa migration follow-up.
2. Emergency hotfix DB harus direkonsiliasi menjadi migration file.
3. Migration yang sudah production tidak diedit.
4. Jika salah, buat migration baru.
5. CI menjalankan migration dari kosong/baseline ke latest.
6. CI menjalankan aplikasi dengan schema validation.
7. UAT/staging dibangun dengan cara yang sama seperti production.

---

## 22. Branching dan Migration Conflict

Dalam tim besar, dua developer bisa membuat migration dengan version sama:

```text
V017__add_application_ref.sql
V017__add_case_priority.sql
```

Saat merge, conflict terjadi.

Strategi:

- gunakan timestamp version:

```text
V202606161001__add_application_ref.sql
V202606161015__add_case_priority.sql
```

- atau gunakan sequence global yang direservasi,
- atau migration owner/release captain,
- atau re-number saat merge sebelum release.

Untuk Flyway, mengubah migration yang belum pernah dirilis masih mungkin jika tim sepakat. Setelah masuk shared environment, hindari mengubah file karena checksum mismatch.

### 22.1 Migration Review Checklist di Pull Request

Setiap PR yang mengubah entity harus menjawab:

- Apakah perlu migration?
- Apakah perubahan backward compatible?
- Apakah aplikasi lama masih jalan?
- Apakah ada data existing?
- Apakah butuh backfill?
- Apakah backfill chunked?
- Apakah index/constraint bisa lock table?
- Apakah rollback aman?
- Apakah DTO/API/report terdampak?
- Apakah test migration ditambahkan?
- Apakah Hibernate validate akan pass?

---

## 23. Rollback Strategy: Rollback Code Tidak Sama dengan Rollback Data

Rollback aplikasi relatif mudah:

```text
deploy image versi sebelumnya
```

Rollback database jauh lebih sulit karena data sudah berubah.

### 23.1 Tipe Rollback

| Tipe | Penjelasan |
|---|---|
| Code rollback | Kembalikan binary/app version |
| Schema rollback | Kembalikan bentuk schema |
| Data rollback | Kembalikan data ke state sebelumnya |
| Forward fix | Tidak rollback, tetapi buat migration baru untuk memperbaiki |
| Compatibility rollback | Schema baru tetap ada agar code lama tetap jalan |

### 23.2 Prefer Forward-Compatible Migration

Strategi terbaik sering bukan rollback schema, tetapi membuat schema tetap kompatibel dengan versi lama.

Contoh:

- Add nullable column baru: rollback code aman karena column ekstra diabaikan.
- Jangan drop column lama pada release yang sama.
- Jangan rename langsung.
- Jangan enforce constraint yang code lama belum penuhi.

### 23.3 Kapan Rollback SQL Berbahaya

Contoh rollback:

```sql
alter table application drop column external_ref;
```

Jika aplikasi baru sudah menulis data penting ke `external_ref`, rollback ini menghapus data. Bisa melanggar audit, legal, atau business recovery.

Karena itu setiap migration harus punya bagian:

```text
Rollback consideration:
- Apakah rollback code aman?
- Apakah rollback schema kehilangan data?
- Apakah harus forward fix?
- Apakah perlu backup/snapshot sebelum migration?
- Apakah migration bisa dihentikan di tengah?
```

---

## 24. Zero-Downtime Migration Playbook

Untuk perubahan production yang non-trivial, gunakan playbook.

### 24.1 Add New Required Field

Requirement: application harus punya `submission_channel`.

#### Release 1 — Expand

```sql
alter table application add submission_channel varchar(30);
```

Code baru:

- menulis `submission_channel` untuk row baru,
- masih handle null untuk row lama.

#### Backfill

```sql
update application
set submission_channel = 'LEGACY'
where submission_channel is null;
```

Untuk table besar, chunk.

#### Release 2 — Enforce in Code

- DTO validation mewajibkan field.
- Domain logic tidak membuat row tanpa channel.
- Monitoring null count.

#### Release 3 — Enforce in DB

```sql
alter table application modify submission_channel not null;
```

### 24.2 Split Column

Requirement: `full_name` menjadi `first_name` dan `last_name`.

Pola:

```text
1. add first_name, last_name nullable
2. code writes both old and new
3. backfill best-effort
4. expose remediation for ambiguous names
5. code reads new fields
6. stop using full_name
7. drop full_name later
```

Jangan anggap split data selalu deterministic. Data quality adalah bagian dari migration.

### 24.3 Move Table Ownership ke Service Baru

Pola:

```text
1. create new table/schema
2. dual-write or outbox sync
3. backfill historical data
4. compare counts/checksum
5. switch read gradually
6. freeze old writes
7. decommission old table
```

Ini bukan hanya database migration; ini application integration migration.

---

## 25. Testing Migration

Migration harus diuji seperti code.

### 25.1 Test dari Empty Database

Pipeline:

```text
create clean DB
run all migrations
start app with ddl validate
run integration tests
```

Menangkap:

- syntax error,
- missing table,
- mapping mismatch,
- missing sequence,
- missing constraint,
- wrong column type.

### 25.2 Test dari Production-Like Snapshot

Penting untuk migration besar:

```text
restore anonymized production snapshot
run migration
measure duration
check lock/blocking
validate data
run app smoke test
```

Menangkap:

- duplicate data blocking unique constraint,
- invalid legacy value,
- slow backfill,
- index creation risk,
- FK orphan,
- insufficient tablespace/temp/undo.

### 25.3 Migration Assertion

Setelah migration:

```sql
select count(*) from application where submission_channel is null;
```

Expected: `0` sebelum not-null enforce.

Untuk backfill:

```sql
select count(*) as migrated_count
from application
where normalized_ref is not null;
```

Untuk data consistency:

```sql
select count(*)
from application
where normalized_ref <> upper(reference_no);
```

### 25.4 Test Entity Mapping

Aplikasi start dengan validate mode:

```properties
spring.jpa.hibernate.ddl-auto=validate
```

Lalu test minimal persist/load untuk entity penting.

---

## 26. CI/CD Pipeline untuk Database Migration

Pipeline ideal:

```text
1. Static check migration naming
2. Spin up real DB engine via container/test environment
3. Run migration from scratch
4. Run migration from previous release snapshot/baseline
5. Start application with schema validate
6. Run integration tests
7. Generate schema diff report
8. Run backward compatibility checks
9. Package migration artifact
10. Deploy migration with controlled order
```

### 26.1 Deployment Order

Umumnya:

```text
1. Pre-deploy migration yang backward compatible
2. Deploy application baru
3. Run background backfill jika perlu
4. Post-deploy migration untuk constraint/drop setelah aman
```

Jangan selalu menjalankan semua migration tepat saat app startup di production. Untuk migration berat, lebih baik ada controlled release step yang dimonitor.

### 26.2 App Startup Migration: Pro dan Kontra

Pro:

- simple,
- otomatis,
- cocok untuk aplikasi kecil,
- mengurangi manual step.

Kontra:

- beberapa pod bisa berebut migration,
- startup lama,
- failure membuat deployment gagal,
- migration berat sulit dikontrol,
- app user dan schema migration bercampur,
- privilege app DB user menjadi terlalu besar.

Untuk production besar, sering lebih aman:

- migration dijalankan oleh pipeline/job terpisah,
- app runtime user punya privilege minimal,
- migration user punya privilege DDL,
- app start hanya validate.

---

## 27. Security dan Privilege Model

Database migration butuh privilege DDL. Aplikasi runtime idealnya tidak.

### 27.1 Pisahkan User

```text
migration_user:
  create/alter/drop/index/grant sesuai kebutuhan

application_user:
  select/insert/update/delete pada object tertentu
  execute pada procedure tertentu jika perlu
  tidak punya drop/alter table
```

Manfaat:

- blast radius lebih kecil,
- SQL injection tidak bisa drop schema,
- production app tidak bisa auto mutate schema,
- audit lebih jelas.

### 27.2 Migration Secret Governance

- secret migration hanya tersedia di pipeline/job,
- rotasi credential,
- audit siapa menjalankan migration,
- approval untuk DDL berisiko,
- log migration output,
- jangan hardcode credential di repo.

---

## 28. Database Contract untuk Sistem Regulatory / Case Management

Pada sistem regulatory, database contract harus mendukung:

- auditability,
- traceability,
- explainability,
- legal defensibility,
- data retention,
- state transition correctness,
- multi-role access,
- report reproducibility.

### 28.1 Contoh Contract Application/Case

```sql
create table case_record (
    id bigint not null primary key,
    case_no varchar(50) not null,
    status varchar(30) not null,
    version bigint not null,
    created_at timestamp not null,
    created_by varchar(100) not null,
    updated_at timestamp,
    updated_by varchar(100),
    constraint ux_case_record_case_no unique (case_no),
    constraint ck_case_record_status check (
        status in ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'ESCALATED', 'APPROVED', 'REJECTED')
    )
);

create index ix_case_record_status_created
on case_record(status, created_at);
```

Entity:

```java
@Entity
@Table(
    name = "case_record",
    uniqueConstraints = {
        @UniqueConstraint(name = "ux_case_record_case_no", columnNames = "case_no")
    },
    indexes = {
        @Index(name = "ix_case_record_status_created", columnList = "status, created_at")
    }
)
public class CaseRecord {
    @Id
    private Long id;

    @Column(name = "case_no", nullable = false, length = 50)
    private String caseNo;

    @Column(name = "status", nullable = false, length = 30)
    private String status;

    @Version
    @Column(name = "version", nullable = false)
    private Long version;
}
```

Catatan penting:

- Annotation index/constraint membantu dokumentasi mapping.
- Migration SQL tetap menjadi mekanisme production.
- Constraint name harus stabil agar error handling bisa mapping ke domain error.

### 28.2 Audit Trail Migration

Audit table sering besar dan sensitif.

Perubahan pada audit table harus ekstra hati-hati:

- jangan drop old data,
- jangan rewrite massive CLOB tanpa plan,
- perhatikan storage/tablespace,
- perhatikan retention,
- perhatikan query listing/report,
- perhatikan index pada timestamp/module/entity id,
- perhatikan partitioning/archival.

Contoh add column audit correlation id:

```sql
alter table audit_trail add correlation_id varchar(100);

create index ix_audit_trail_correlation_id
on audit_trail(correlation_id);
```

Jika table sangat besar, index harus dibuat dengan strategi online/concurrent sesuai DB.

---

## 29. Common Anti-Patterns

### Anti-Pattern 1 — Entity Diubah Tanpa Migration

```java
@Column(name = "review_decision", nullable = false)
private String reviewDecision;
```

Tapi migration tidak ada. Local jalan karena `ddl-auto=update`, UAT/production gagal.

### Anti-Pattern 2 — Migration Hanya Diuji di H2

H2 tidak sama dengan Oracle/PostgreSQL/MySQL/SQL Server dalam:

- DDL syntax,
- locking,
- type,
- sequence,
- identity,
- timestamp,
- constraint behavior,
- query plan.

Gunakan database engine yang sama untuk integration/migration test penting.

### Anti-Pattern 3 — Drop Column di Release yang Sama dengan Code Switch

Rollback aplikasi menjadi tidak mungkin karena aplikasi lama butuh column lama.

### Anti-Pattern 4 — Add Not Null Column Langsung pada Table Existing

Berisiko gagal, lock besar, atau downtime.

### Anti-Pattern 5 — Unique Constraint Tanpa Data Audit

Migration gagal di production karena duplicate legacy data.

### Anti-Pattern 6 — Index Baru Tanpa Query Plan

Index menambah overhead write dan storage. Index yang salah bisa tidak dipakai.

### Anti-Pattern 7 — Backfill Satu Transaction Besar

Membuat lock/undo/redo/log membesar dan rollback sangat mahal.

### Anti-Pattern 8 — Migration di App Startup untuk DDL Berat

Pod startup menjadi migration runner. Sulit dikontrol dan bisa gagal saat traffic deployment.

### Anti-Pattern 9 — Migration Lama Diedit Setelah Production

Checksum mismatch, audit history rusak, environment tidak reproducible.

### Anti-Pattern 10 — Constraint Hanya di Application Layer

Race condition membuat invariant tetap bisa dilanggar.

---

## 30. Failure Modes Produksi

| Failure | Penyebab | Dampak | Mitigasi |
|---|---|---|---|
| App gagal start | schema mismatch dengan entity | deployment rollback | run migration + validate di CI |
| Migration lock table | DDL blocking pada table besar | request timeout | online DDL, maintenance window, chunking |
| Unique constraint gagal | data duplicate existing | migration stop | pre-check duplicate, remediation |
| Not null gagal | legacy row null | migration stop | backfill dulu |
| FK gagal | orphan child row | migration stop | orphan cleanup |
| Rolling deploy gagal | schema tidak backward compatible | sebagian pod error | expand-migrate-contract |
| Rollback app gagal | column lama sudah drop | outage | delay contract/drop phase |
| Backfill membuat DB spike | update raksasa | CPU/I/O tinggi | chunk, throttle, monitor |
| Entity hydration gagal | enum value baru dibaca code lama | runtime error | compatibility deploy/feature flag |
| Query lambat setelah migration | index hilang/plan berubah | latency naik | explain plan, index review |
| Data hilang saat rollback | rollback drop column/data | audit/legal issue | forward fix, backup, rollback analysis |
| Schema drift | manual DB change | unpredictable behavior | migration-only policy, drift detection |

---

## 31. Design Checklist

Sebelum merge perubahan persistence/schema, jawab pertanyaan berikut.

### 31.1 Contract

- Apa contract database yang berubah?
- Siapa consumer contract ini?
- Apakah ada report, batch, integration, atau service lain yang terdampak?
- Apakah perubahan ini backward compatible?
- Apakah aplikasi versi lama tetap jalan?

### 31.2 Data

- Apakah table sudah punya data?
- Berapa volume row?
- Apakah ada legacy invalid data?
- Apakah perlu backfill?
- Apakah backfill idempotent?
- Apakah backfill chunked dan bisa resume?

### 31.3 Constraint

- Apakah nullable berubah?
- Apakah unique constraint baru?
- Apakah FK baru?
- Apakah check constraint baru?
- Apakah constraint bisa gagal karena data lama?

### 31.4 Index

- Query apa yang membutuhkan index?
- Apakah index urutan column-nya benar?
- Apakah index bisa dibuat online?
- Apakah write overhead acceptable?
- Apakah ada duplicate/overlapping index?

### 31.5 Deployment

- Apakah migration pre-deploy atau post-deploy?
- Apakah migration dijalankan app startup atau pipeline job?
- Apakah perlu maintenance window?
- Apakah rollback code aman?
- Apakah schema rollback aman?
- Apakah forward fix lebih tepat?

### 31.6 Testing

- Apakah migration diuji dari empty DB?
- Apakah migration diuji dari snapshot/baseline?
- Apakah app start dengan schema validate?
- Apakah integration test memakai DB engine yang sama?
- Apakah ada assertion data setelah migration?

### 31.7 Observability

- Apa metric yang dipantau selama migration?
- Apakah lock wait dipantau?
- Apakah slow query dipantau?
- Apakah null/duplicate/orphan count dipantau?
- Apakah migration duration dicatat?

---

## 32. Step-by-Step Example: Add Mandatory `risk_level` to Case Record

Requirement:

> Setiap case harus memiliki `risk_level`: `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`. Field ini mandatory untuk case baru, dan legacy case harus di-backfill berdasarkan rule sederhana.

### 32.1 Jangan Lakukan Ini

```sql
alter table case_record add risk_level varchar(20) not null;
```

Masalah:

- table existing punya row lama,
- column baru tidak punya value,
- DDL bisa gagal,
- aplikasi lama tidak tahu field ini,
- rolling deployment rusak.

### 32.2 Release 1 — Expand

Migration:

```sql
alter table case_record add risk_level varchar(20);
```

Entity:

```java
@Column(name = "risk_level", length = 20)
private String riskLevel;
```

Code:

- untuk case baru, isi risk level,
- untuk case lama, handle null sebagai `UNCLASSIFIED` di read logic sementara,
- jangan expose null mentah ke client jika contract API tidak mengizinkan.

### 32.3 Backfill

Simple SQL:

```sql
update case_record
set risk_level = case
    when priority = 'URGENT' then 'HIGH'
    when escalation_count > 0 then 'MEDIUM'
    else 'LOW'
end
where risk_level is null;
```

Untuk table besar, gunakan chunked backfill.

Validasi:

```sql
select count(*)
from case_record
where risk_level is null;
```

Expected: `0`.

### 32.4 Release 2 — Add Check Constraint

```sql
alter table case_record add constraint ck_case_record_risk_level
check (risk_level in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'));
```

Jika DB mendukung not valid/validate later, bisa dipakai untuk mengurangi blocking. Syntax berbeda per DB.

### 32.5 Release 3 — Enforce Not Null

```sql
alter table case_record modify risk_level not null;
```

Syntax Oracle-style. Untuk PostgreSQL:

```sql
alter table case_record alter column risk_level set not null;
```

### 32.6 Contract Phase

Setelah semua aman:

- DTO request mewajibkan risk level atau rule resolver selalu menghasilkan risk level,
- reporting query mengandalkan risk_level non-null,
- alert jika row null muncul lagi,
- documentation schema diperbarui.

---

## 33. Step-by-Step Example: Rename `application.status` to `application.workflow_status`

### 33.1 Problem

Column `status` terlalu ambigu karena ada payment status, document status, and workflow status.

### 33.2 Release 1 — Expand

```sql
alter table application add workflow_status varchar(30);
```

Code:

```java
@Column(name = "status", length = 30)
private String legacyStatus;

@Column(name = "workflow_status", length = 30)
private String workflowStatus;
```

Write path:

```java
public void transitionTo(String newStatus) {
    this.legacyStatus = newStatus;
    this.workflowStatus = newStatus;
}
```

Read path sementara:

```java
public String currentWorkflowStatus() {
    return workflowStatus != null ? workflowStatus : legacyStatus;
}
```

### 33.3 Backfill

```sql
update application
set workflow_status = status
where workflow_status is null;
```

Untuk table besar, chunk.

### 33.4 Release 2 — Switch Read

- Semua query baru memakai `workflow_status`.
- Index baru dibuat jika query butuh.

```sql
create index ix_application_workflow_status
on application(workflow_status);
```

### 33.5 Release 3 — Contract

Setelah aplikasi lama tidak ada:

```sql
alter table application modify workflow_status not null;
```

Lalu pada release berikutnya:

```sql
alter table application drop column status;
```

Jangan drop terlalu cepat jika rollback masih mungkin.

---

## 34. Ringkasan

Schema generation, migration, dan database contract adalah tiga hal yang berbeda.

Ringkasan mental model:

```text
Entity mapping menjelaskan cara aplikasi melihat database.
Migration menjelaskan cara database berubah.
Database contract menjelaskan guarantee yang harus stabil untuk aplikasi, report, batch, audit, dan integrasi.
```

Prinsip production-grade:

1. Jangan pakai automatic schema update untuk production.
2. Gunakan migration tool seperti Flyway/Liquibase atau framework internal yang versioned dan reviewable.
3. Gunakan `validate` untuk mendeteksi mismatch mapping-schema.
4. Desain migration agar backward compatible.
5. Pakai expand-migrate-contract untuk perubahan berisiko.
6. Jangan drop/rename/enforce constraint terlalu cepat.
7. Backfill data besar secara chunked dan idempotent.
8. Index dan constraint harus didesain dari query/invariant nyata.
9. Migration harus diuji dari empty database dan snapshot/baseline realistis.
10. Rollback database lebih sulit daripada rollback code; desain agar rollback code tetap aman.
11. Database adalah contract, bukan implementation detail.

---

## 35. Latihan / Scenario

### Scenario 1 — Add Non-Nullable Column

Sebuah table `inspection_case` memiliki 15 juta row. Requirement baru meminta field `inspection_type` mandatory.

Tugas:

1. Buat migration plan 3 release.
2. Tentukan kapan column nullable dan kapan not null.
3. Tentukan backfill strategy.
4. Tentukan validation query.
5. Jelaskan rollback plan.

### Scenario 2 — Unique Constraint dengan Legacy Duplicate

Requirement: `license_no` harus unik pada row aktif. Table memakai soft delete `deleted_at`.

Tugas:

1. Cari duplicate aktif.
2. Tentukan unique index strategy untuk PostgreSQL, Oracle, dan MySQL.
3. Jelaskan kenapa unique constraint biasa bisa salah.
4. Jelaskan remediation untuk duplicate existing.

### Scenario 3 — Enum Value Baru

Tambahkan status `ESCALATED_TO_LEGAL` pada case workflow.

Tugas:

1. Tentukan deployment order agar aplikasi lama tidak crash.
2. Tentukan check constraint migration.
3. Tentukan feature flag strategy.
4. Jelaskan apa yang terjadi jika aplikasi lama membaca enum value baru.

### Scenario 4 — Rename Column

Rename `application.status` menjadi `application.workflow_status` tanpa downtime.

Tugas:

1. Buat expand-migrate-contract plan.
2. Jelaskan dual-write dan read fallback.
3. Tentukan kapan index baru dibuat.
4. Tentukan kapan column lama boleh drop.

### Scenario 5 — Audit Table Besar

Table `audit_trail` berisi 500 juta row dan perlu column `correlation_id` plus index.

Tugas:

1. Tentukan apakah column add aman.
2. Tentukan strategi index creation.
3. Tentukan apakah backfill diperlukan.
4. Tentukan observability saat migration.
5. Jelaskan risiko tablespace/temp/undo/redo.

---

## 36. Referensi Konseptual

- Jakarta Persistence specification: standard API untuk persistence dan object/relational mapping di Java/Jakarta platform.
- Jakarta Persistence schema generation properties: standard property untuk schema generation database/script action.
- Hibernate ORM User Guide: schema tooling, mapping, session, persistence context, dan provider-specific behavior.
- Flyway documentation: versioned, repeatable, baseline, dan undo migration model.
- Liquibase documentation: changelog, changeset, rollback, dan database change governance.
- Spring Boot / Spring Framework documentation: integration dengan Flyway/Liquibase dan JPA schema validation.

---

## 37. Penutup Part 017

Bagian ini menempatkan schema evolution sebagai bagian dari engineering discipline, bukan efek samping entity annotation.

Pada level senior/staff/principal, pertanyaan yang harus selalu muncul bukan hanya:

```text
Annotation apa yang perlu ditambah?
```

Tetapi:

```text
Contract apa yang berubah?
Siapa consumer-nya?
Apakah kompatibel dengan versi lama?
Bagaimana data existing dimigrasikan?
Bagaimana rollback code tetap aman?
Bagaimana migration diuji dan dimonitor?
Apa failure mode production-nya?
```

Jika kamu bisa menjawab pertanyaan-pertanyaan itu, kamu tidak hanya “bisa JPA”. Kamu mulai berpikir sebagai engineer yang mampu menjaga correctness dan operability sistem data di production.

---

_Status seri: belum selesai. Lanjut ke Part 018 — Constraints, Invariants, and Validation Across Layers._

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-persistence-jpa-jakarta-data-transactions-database-integration-part-016.md">⬅️ Part 016 — Batch Processing and High-Volume Persistence</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-persistence-jpa-jakarta-data-transactions-database-integration-part-018.md">Part 018 — Constraints, Invariants, and Validation Across Layers ➡️</a>
</div>
