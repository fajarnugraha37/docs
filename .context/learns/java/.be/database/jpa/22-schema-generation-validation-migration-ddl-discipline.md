# Part 22 — Schema Generation, Validation, Migration, and DDL Discipline

> Seri: `learn-java-jpa-provider-hibernate-eclipselink-orm-engineering`  
> File: `22-schema-generation-validation-migration-ddl-discipline.md`  
> Scope Java: 8 sampai 25  
> Scope API: JPA 2.x (`javax.persistence`) sampai Jakarta Persistence 3.x (`jakarta.persistence`)  
> Scope Provider: Hibernate ORM 5/6/7, EclipseLink 2/3/4+

---

## 1. Why This Matters

DDL adalah bagian paling berbahaya dari ORM karena ia mengubah bentuk database, bukan hanya cara aplikasi membaca/menulis data.

Mapping entity bisa terlihat benar di Java, unit test bisa hijau, repository bisa berjalan di local, tetapi production tetap bisa rusak karena:

- kolom yang dianggap nullable oleh entity ternyata `NOT NULL` di database,
- panjang `VARCHAR` berbeda antara mapping dan schema,
- provider menghasilkan type berbeda dari yang diharapkan DBA,
- index yang dibutuhkan query tidak pernah dibuat,
- foreign key dihapus otomatis oleh tooling,
- migration sukses di development tetapi mengunci table besar di production,
- aplikasi versi lama dan versi baru tidak bisa hidup bersamaan selama rolling deployment,
- `ddl-auto=update` menambah kolom tetapi tidak memperbaiki data, constraint, index, backfill, atau semantic drift.

ORM schema tooling sangat berguna, tetapi harus dipahami sebagai **metadata translator**, bukan sebagai **production migration authority**.

Mental model utama part ini:

> Entity mapping adalah deskripsi persistence model.  
> Database schema adalah operational contract.  
> Migration adalah proses perubahan contract secara aman.  
> ORM DDL generation hanya salah satu alat untuk membandingkan atau menghasilkan kandidat DDL, bukan pengganti disiplin migration.

Di sistem enterprise/regulatory, schema bukan detail teknis kecil. Schema adalah bagian dari auditability, retention, reporting, SLA, backward compatibility, dan legal defensibility. Salah DDL bisa menghasilkan data loss, downtime, atau historical record yang tidak bisa direkonstruksi.

---

## 2. Core Mental Model

### 2.1 ORM Melihat Schema dari Sudut Pandang Mapping

Provider JPA/Hibernate/EclipseLink membaca metadata dari:

- `@Entity`,
- `@Table`,
- `@Column`,
- `@JoinColumn`,
- `@JoinTable`,
- `@Id`,
- `@GeneratedValue`,
- `@SequenceGenerator`,
- `@Version`,
- inheritance annotations,
- embeddables,
- converters,
- provider-specific annotations,
- XML mapping,
- naming strategy,
- dialect/platform.

Dari metadata itu provider bisa mencoba membentuk DDL:

```sql
create table case_record (
    id bigint not null,
    case_no varchar(64) not null,
    status varchar(32) not null,
    version bigint not null,
    primary key (id)
);
```

Namun provider hanya tahu apa yang tertulis di mapping. Provider tidak selalu tahu:

- query production mana yang butuh index,
- data existing mana yang melanggar constraint baru,
- deployment dilakukan rolling atau blue-green,
- aplikasi versi lama masih menulis ke kolom lama,
- table punya ratusan juta row,
- DDL tertentu mengunci table di database tertentu,
- ada external report, ETL, data warehouse, batch job, atau stored procedure yang bergantung pada schema,
- constraint mana yang punya meaning regulatory,
- column rename sebenarnya harus dilakukan sebagai add-copy-switch-drop, bukan `rename` langsung.

### 2.2 Schema Generation, Schema Validation, dan Migration Itu Berbeda

Tiga aktivitas ini sering dicampur, padahal tujuannya beda.

| Aktivitas | Pertanyaan | Cocok untuk | Tidak cocok untuk |
|---|---|---|---|
| Schema generation | “Dari mapping ini, DDL kandidatnya apa?” | prototyping, test DB, diff reference | production evolution otomatis |
| Schema validation | “Apakah schema DB kompatibel dengan mapping saat startup?” | guardrail startup, CI check, drift detection | membuat perubahan schema |
| Migration | “Bagaimana schema berubah dari versi N ke N+1 secara aman?” | production release, audit trail perubahan DB | diserahkan penuh ke provider |

ORM boleh membantu ketiganya, tetapi production-grade engineering biasanya membuat pembagian seperti ini:

```text
Entity Mapping
    ↓
Generated DDL Candidate / Validation
    ↓
Human-reviewed Migration Script
    ↓
CI/CD Migration Pipeline
    ↓
Runtime App with Schema Validation Enabled
```

### 2.3 Database Schema adalah Public Contract

Dalam monolith kecil, schema mungkin terasa private. Dalam sistem enterprise, schema sering menjadi public contract internal bagi:

- aplikasi versi lama dan baru,
- reporting job,
- audit viewer,
- ETL pipeline,
- archival process,
- regulatory export,
- data reconciliation,
- manual DBA operation,
- BI dashboard,
- support script,
- downstream integration.

Karena itu perubahan schema harus diperlakukan seperti perubahan API.

DDL yang aman bukan hanya syntactically valid. DDL harus:

- backward compatible selama deployment window,
- forward compatible jika rollback aplikasi diperlukan,
- punya backfill strategy,
- punya rollback/compensation strategy,
- tidak mengunci table terlalu lama,
- tidak membuat query plan memburuk,
- tidak menghilangkan historical meaning,
- bisa diaudit.

---

## 3. Specification-Level Concept

Jakarta Persistence mendefinisikan schema generation properties standar untuk menghasilkan/mengatur DDL dari persistence unit. Pada versi modern, property schema generation berada di namespace `jakarta.persistence.schema-generation.*`. Pada JPA lama, namespace historisnya `javax.persistence.schema-generation.*`.

Konsep standarnya meliputi:

- action terhadap database,
- action terhadap script,
- source DDL dari metadata atau script,
- target output script,
- load script untuk initial data.

Contoh modern Jakarta Persistence style:

```xml
<property name="jakarta.persistence.schema-generation.database.action" value="none"/>
<property name="jakarta.persistence.schema-generation.scripts.action" value="create"/>
<property name="jakarta.persistence.schema-generation.scripts.create-target" value="target/schema-create.sql"/>
<property name="jakarta.persistence.schema-generation.create-source" value="metadata"/>
```

Nilai umum untuk database action:

- `none`,
- `create`,
- `drop-and-create`,
- `drop`.

Nilai umum untuk script action:

- `none`,
- `create`,
- `drop-and-create`,
- `drop`.

Hal penting:

1. Specification menyediakan mekanisme standar.
2. Provider tetap menentukan detail SQL berdasarkan dialect/platform.
3. Specification tidak menjadikan generated DDL sebagai strategi migration production.
4. Specification tidak menggantikan migration tool seperti Flyway/Liquibase.
5. Specification tidak menjamin semua perbedaan schema dapat dideteksi secara sempurna oleh validation provider.

### 3.1 `javax` vs `jakarta`

Untuk Java 8 legacy stack, Anda sering melihat:

```properties
javax.persistence.schema-generation.database.action=none
javax.persistence.schema-generation.scripts.action=create
```

Untuk Jakarta Persistence 3.x:

```properties
jakarta.persistence.schema-generation.database.action=none
jakarta.persistence.schema-generation.scripts.action=create
```

Mixing keduanya bisa membingungkan. Pada migration `javax` ke `jakarta`, jangan hanya rename import entity. Audit juga:

- persistence.xml namespace,
- schema generation properties,
- provider properties,
- app server defaults,
- Spring Boot property translation,
- test configuration,
- migration test profile.

---

## 4. Hibernate Behavior

Hibernate memiliki sejarah panjang schema tooling melalui keluarga `hbm2ddl` dan konfigurasi modern di bawah `jakarta.persistence.schema-generation.*` serta property Hibernate-specific.

Property yang paling sering ditemukan di Spring/Hibernate app:

```properties
spring.jpa.hibernate.ddl-auto=validate
```

atau native Hibernate:

```properties
hibernate.hbm2ddl.auto=validate
```

Nilai yang umum:

- `none`,
- `validate`,
- `update`,
- `create`,
- `create-drop`.

### 4.1 `validate`

`validate` mengecek apakah schema database kompatibel dengan mapping.

Cocok untuk:

- startup guardrail,
- integration test,
- CI environment,
- memastikan migration sudah dijalankan sebelum app naik.

Tidak melakukan:

- create table,
- alter table,
- create missing index secara penuh,
- backfill data,
- resolve drift otomatis.

Contoh:

```properties
spring.jpa.hibernate.ddl-auto=validate
```

Jika mapping punya:

```java
@Column(name = "case_no", nullable = false, length = 64)
private String caseNo;
```

tetapi database punya:

```sql
case_no varchar(32)
```

Hibernate validation dapat gagal karena mismatch length/type tergantung dialect dan provider metadata extraction.

### 4.2 `update`

`update` mencoba mengubah schema agar mendekati mapping.

Ini terlihat nyaman di development, tetapi berbahaya untuk production.

Masalah `update`:

- tidak memahami data migration semantic,
- tidak aman untuk column rename,
- tidak tahu backfill,
- tidak bisa menjamin zero downtime,
- tidak selalu menghapus kolom yang sudah tidak dipakai,
- bisa menghasilkan DDL berbeda antar dialect/provider version,
- tidak memberi review/audit migration yang layak,
- bisa gagal di tengah startup,
- bisa mengubah schema saat beberapa instance app start bersamaan.

Contoh bahaya:

```java
// v1
@Column(name = "applicant_name")
private String applicantName;

// v2
@Column(name = "party_name")
private String partyName;
```

Provider tidak tahu ini rename. Ia bisa menganggap:

```text
applicant_name removed
party_name added
```

Kalau `update`, hasilnya mungkin kolom baru kosong, sementara data lama tetap di kolom lama. Aplikasi baru membaca `party_name` dan mengira semua data null.

### 4.3 `create` dan `create-drop`

Cocok untuk:

- local prototyping,
- integration test throwaway database,
- testcontainers,
- generated schema inspection.

Tidak cocok untuk:

- production,
- shared development DB yang menyimpan data penting,
- UAT dengan data business meaningful,
- migration environment.

### 4.4 Hibernate Dialect Influence

Hibernate DDL sangat dipengaruhi dialect:

```properties
hibernate.dialect=org.hibernate.dialect.PostgreSQLDialect
```

atau modern auto-detection.

Dialect memengaruhi:

- type mapping,
- sequence syntax,
- identity column syntax,
- timestamp precision,
- LOB type,
- boolean representation,
- enum handling jika provider-specific,
- index/constraint syntax,
- temporary table behavior,
- generated column support.

Mapping yang sama bisa menghasilkan DDL berbeda:

```java
@Column(length = 4000)
private String description;
```

Oracle, PostgreSQL, MySQL, dan SQL Server bisa menghasilkan tipe berbeda atau batas berbeda. Di Oracle, batas `VARCHAR2` dan pilihan `CLOB` dapat menjadi isu serius untuk audit/logging text besar.

### 4.5 Hibernate Naming Strategy

Hibernate mengenal:

- implicit naming strategy,
- physical naming strategy.

Contoh:

```java
@Entity
class CaseRecord {
    @ManyToOne
    private UserAccount assignedOfficer;
}
```

Tanpa explicit name, nama table/column/join column bergantung pada naming strategy.

Masalahnya:

- perubahan naming strategy bisa mengubah semua generated DDL,
- migration diff menjadi noise besar,
- schema existing bisa tidak cocok dengan mapping,
- query native/reporting bisa pecah.

Rule:

> Untuk sistem production jangka panjang, explicit naming untuk table, column, join column, constraint, sequence, dan index lebih defensible daripada bergantung penuh pada default provider.

---

## 5. EclipseLink Behavior

EclipseLink juga memiliki DDL generation property. Pada konfigurasi EclipseLink-specific, property historis yang sering ditemui:

```properties
eclipselink.ddl-generation=create-tables
```

Nilai umum:

- `none`,
- `create-tables`,
- `drop-and-create-tables`.

Output mode dapat diarahkan ke database, SQL script, atau keduanya, tergantung property tambahan seperti:

```properties
eclipselink.ddl-generation.output-mode=database
```

atau script-only mode tergantung versi/dokumentasi.

### 5.1 EclipseLink Platform Influence

Seperti Hibernate dialect, EclipseLink memakai database platform. Platform memengaruhi:

- DDL type,
- sequence handling,
- identity handling,
- LOB handling,
- pagination/locking SQL,
- constraint syntax.

### 5.2 EclipseLink Descriptors and DDL

EclipseLink membangun descriptor untuk entity. DDL generation berasal dari descriptor metadata plus platform. Ini penting karena custom descriptor atau EclipseLink extension dapat memengaruhi runtime behavior tetapi tidak selalu setara dengan schema migration yang aman.

### 5.3 EclipseLink Extensions

EclipseLink memiliki extension seperti database-level cascade behavior. Misalnya provider extension dapat memengaruhi DDL constraint `ON DELETE CASCADE`. Ini bisa berguna, tetapi harus dibedakan dari cascade ORM.

Risiko:

- DBA melihat cascade di DB dan application engineer mengira ORM listener tetap dipanggil,
- delete dilakukan database tanpa lifecycle callback tertentu,
- auditing entity delete tidak terjadi seperti yang diasumsikan,
- provider portability hilang.

Rule:

> Provider-specific DDL extension boleh dipakai, tetapi harus dicatat sebagai contract. Jangan diam-diam membiarkan generated DDL menjadi satu-satunya dokumentasi.

---

## 6. Java 8–25 Compatibility Notes

### 6.1 Java 8 Legacy

Stack umum:

- Java 8,
- JPA 2.1/2.2,
- `javax.persistence`,
- Hibernate 5.x,
- EclipseLink 2.x,
- Java EE/Jakarta EE transition belum selesai.

Catatan:

- `javax.persistence.schema-generation.*`,
- older dialect names,
- older Hibernate type system,
- older date/time handling,
- less mature bytecode enhancement pipeline,
- app server provider version bisa terkunci.

### 6.2 Java 11/17 Modernization

Stack transisi:

- Java 11/17,
- Jakarta Persistence 3.0/3.1,
- package berubah ke `jakarta.persistence`,
- Hibernate 6 mulai umum,
- EclipseLink 3/4.

Catatan:

- namespace berubah,
- dependency conflict sering muncul,
- generated DDL bisa berubah karena provider major version,
- query engine Hibernate 6 berubah signifikan,
- dialect class lama bisa deprecated/removed.

### 6.3 Java 21/25 Enterprise Runtime

Stack modern:

- Java 21 LTS atau Java 25 LTS,
- Jakarta Persistence 3.2 sebagai stable modern baseline,
- Hibernate 6/7,
- EclipseLink 4.x,
- Spring Boot modern/Jakarta EE modern.

Catatan:

- gunakan explicit Java time mapping,
- pastikan driver JDBC kompatibel,
- audit schema validation di CI,
- migration diff harus diuji ulang setelah provider upgrade,
- jangan menganggap generated DDL Hibernate 5 sama dengan Hibernate 6/7.

---

## 7. The Dangerous Convenience of `ddl-auto=update`

`ddl-auto=update` adalah salah satu konfigurasi paling sering membuat tim merasa aman padahal sebenarnya menunda risiko.

### 7.1 Kenapa Ia Terlihat Menolong

Di local development:

```properties
spring.jpa.hibernate.ddl-auto=update
```

Developer menambah field:

```java
@Column(name = "priority", length = 32)
private String priority;
```

Aplikasi start, kolom otomatis dibuat:

```sql
alter table case_record add priority varchar(32);
```

Ini nyaman.

### 7.2 Kenapa Ia Tidak Cukup

Business meaning dari `priority` mungkin bukan nullable bebas. Mungkin semua existing case harus diberi default berdasarkan SLA.

Contoh migration yang benar mungkin:

```sql
alter table case_record add priority varchar(32);

update case_record
set priority = case
    when due_date < current_date + interval '3 day' then 'HIGH'
    else 'NORMAL'
end
where priority is null;

alter table case_record alter column priority set not null;
```

Provider tidak tahu logic itu.

### 7.3 Rename Problem

Entity berubah:

```java
// old
@Column(name = "status")
private String status;

// new
@Column(name = "case_status")
private String caseStatus;
```

Provider tidak tahu rename. Ia bisa create column baru tanpa memindahkan data.

Migration benar biasanya:

```sql
alter table case_record add case_status varchar(32);
update case_record set case_status = status;
-- deploy app that writes both or reads fallback
-- verify
-- later drop old column
```

### 7.4 Constraint Problem

Menambah `nullable = false`:

```java
@Column(nullable = false)
private String category;
```

Jika data lama punya null, DDL akan gagal. Migration harus:

1. add nullable column,
2. backfill,
3. verify no null,
4. add not null constraint,
5. update app assumptions.

### 7.5 Multi-Instance Startup Problem

Dalam Kubernetes/EKS, banyak pod bisa start bersamaan.

Jika setiap instance menjalankan schema update:

```text
Pod A starts → alter table
Pod B starts → alter table same column
Pod C starts → waits on metadata lock
```

Hasilnya bisa:

- startup race,
- lock contention,
- failed deployment,
- partial schema change,
- app instance inconsistent.

Rule:

> Migration harus dijalankan sebagai controlled deployment step, bukan efek samping startup semua app instance.

---

## 8. Schema Validation as Runtime Guardrail

Production app biasanya lebih aman dengan:

```properties
spring.jpa.hibernate.ddl-auto=validate
```

atau equivalent provider validation.

Tujuannya:

- memastikan migration sudah applied,
- fail-fast jika schema tidak cocok,
- mencegah app berjalan dengan contract salah.

Namun validation bukan silver bullet.

### 8.1 Apa yang Bisa Dideteksi

Tergantung provider/dialect/metadata extraction, validation dapat mendeteksi:

- table missing,
- column missing,
- type mismatch tertentu,
- sequence missing tertentu,
- length/precision mismatch tertentu,
- nullable mismatch tertentu.

### 8.2 Apa yang Tidak Selalu Dideteksi

Validation tidak selalu cukup untuk:

- index missing,
- wrong index order,
- check constraint missing,
- FK action mismatch,
- trigger missing,
- partial index missing,
- expression index missing,
- partitioning mismatch,
- storage parameter mismatch,
- table compression mismatch,
- LOB storage mismatch,
- collation mismatch,
- timezone semantic mismatch,
- data quality mismatch,
- application-level invariant mismatch.

Jadi validation harus dilengkapi dengan:

- migration checksum,
- schema diff in CI,
- query plan checks untuk critical query,
- manual DBA review untuk critical DDL,
- smoke test after migration,
- data invariant verification.

---

## 9. Migration Tooling Discipline

Production-grade schema evolution biasanya memakai migration tool seperti:

- Flyway,
- Liquibase,
- company-internal migration runner,
- DBA-controlled script pipeline.

Prinsipnya bukan tool mana, tetapi discipline:

1. setiap perubahan schema versioned,
2. script immutable setelah release,
3. migration order deterministic,
4. migration bisa diaudit,
5. checksum dijaga,
6. migration diuji di database yang sama atau sangat dekat dengan production,
7. migration step terpisah dari app startup,
8. rollback/compensation jelas,
9. slow DDL diidentifikasi sebelum production.

### 9.1 Versioned Migration

Contoh Flyway-style:

```text
db/migration/
  V2026_06_17_001__create_case_record.sql
  V2026_06_17_002__add_case_priority.sql
  V2026_06_20_001__backfill_case_priority.sql
  V2026_06_21_001__make_case_priority_not_null.sql
```

### 9.2 Repeatable Migration

Repeatable migration cocok untuk:

- view,
- function,
- stored procedure,
- materialized view definition,
- grants tertentu.

Tidak cocok untuk data-changing migration yang harus once-only.

### 9.3 Migration Metadata Table

Migration tool menyimpan metadata:

- version,
- description,
- checksum,
- installed by,
- installed at,
- execution time,
- success/failure.

Ini penting untuk audit.

---

## 10. Zero-Downtime Migration: Expand and Contract

Rolling deployment berarti untuk beberapa waktu ada dua versi aplikasi:

```text
Time T0: all pods v1
Time T1: migration applied
Time T2: some pods v1, some pods v2
Time T3: all pods v2
Time T4: old schema removed later
```

Migration yang tidak backward compatible bisa merusak pada T2.

### 10.1 Expand Phase

Tambahkan schema baru tanpa merusak app lama.

Contoh rename `status` ke `case_status`.

Migration 1:

```sql
alter table case_record add case_status varchar(32);
```

App v1 masih pakai `status`. App v2 bisa mulai menulis dual-write atau membaca fallback.

### 10.2 Backfill Phase

```sql
update case_record
set case_status = status
where case_status is null;
```

Untuk table besar, jangan selalu satu massive update. Bisa chunked:

```sql
update case_record
set case_status = status
where case_status is null
  and id between ? and ?;
```

### 10.3 Switch Phase

App v2 membaca `case_status`, tetapi masih menjaga compatibility.

Contoh strategi:

```java
String effectiveStatus = caseStatus != null ? caseStatus : legacyStatus;
```

Atau dual-write:

```java
record.setStatus(newStatus);       // legacy column
record.setCaseStatus(newStatus);   // new column
```

### 10.4 Contract Phase

Setelah semua app lama mati, data verified, dan no rollback needed:

```sql
alter table case_record drop column status;
```

Jangan drop terlalu cepat. Contract phase sebaiknya release terpisah.

### 10.5 Why Direct Rename Can Be Dangerous

Direct rename:

```sql
alter table case_record rename column status to case_status;
```

Risiko:

- app v1 langsung rusak,
- rollback app tidak bisa,
- report lama rusak,
- stored procedure rusak,
- ETL lama rusak,
- cached SQL/native query rusak.

Direct rename hanya aman jika deployment atomic dan tidak ada external dependency. Itu jarang di enterprise.

---

## 11. Common Schema Change Patterns

### 11.1 Add Nullable Column

Aman relatif tinggi.

```sql
alter table case_record add remarks varchar(1000);
```

Mapping:

```java
@Column(name = "remarks", length = 1000)
private String remarks;
```

Risiko:

- table lock tergantung DB,
- default expression bisa mahal,
- ORM insert behavior bisa mengirim null eksplisit.

### 11.2 Add Not Null Column

Jangan langsung:

```sql
alter table case_record add priority varchar(32) not null;
```

Jika table berisi data, ini bisa gagal atau lock berat.

Lebih aman:

```sql
alter table case_record add priority varchar(32);

update case_record
set priority = 'NORMAL'
where priority is null;

alter table case_record modify priority not null;
```

Syntax berbeda antar database.

### 11.3 Add Column with Default

Di beberapa database modern, menambah column dengan constant default bisa metadata-only. Di database lain bisa rewrite table.

Contoh:

```sql
alter table case_record add active boolean default true not null;
```

Jangan asumsikan murah. Cek database version dan behavior.

### 11.4 Widen Column

```sql
alter table case_record modify case_no varchar(128);
```

Biasanya lebih aman daripada narrowing, tetapi tetap bisa mengubah index size, constraint, atau query plan.

### 11.5 Narrow Column

```sql
alter table case_record modify case_no varchar(32);
```

Harus verifikasi data:

```sql
select count(*)
from case_record
where length(case_no) > 32;
```

### 11.6 Change Type

Contoh `varchar` ke numeric:

```sql
alter table payment alter column amount type numeric(19,2);
```

Risiko tinggi:

- conversion error,
- rounding,
- invalid data,
- index rebuild,
- long lock,
- app compatibility.

Lebih aman:

1. add new column,
2. backfill with explicit conversion,
3. validate,
4. switch app,
5. drop old.

### 11.7 Rename Column

Gunakan expand-contract kecuali benar-benar atomic.

### 11.8 Split Column

Contoh `full_name` menjadi `first_name` dan `last_name`.

Provider tidak bisa tahu semantic split. Migration harus business-aware.

### 11.9 Merge Columns

Contoh `street`, `unit_no`, `postal_code` menjadi JSON address snapshot. Migration harus deterministic dan reversible jika perlu.

### 11.10 Add Foreign Key

Jangan langsung jika data existing mungkin invalid.

```sql
select cr.assigned_user_id
from case_record cr
left join user_account ua on ua.id = cr.assigned_user_id
where cr.assigned_user_id is not null
  and ua.id is null;
```

Baru add FK setelah orphan data dibereskan.

### 11.11 Drop Column

Drop adalah destructive. Pastikan:

- app tidak membaca,
- app tidak menulis,
- report tidak memakai,
- ETL tidak memakai,
- backup/restore strategy jelas,
- retention requirement tidak dilanggar.

---

## 12. Constraint Discipline

Constraint adalah executable domain rule di database.

ORM annotation seperti:

```java
@Column(nullable = false, length = 64, unique = true)
private String caseNo;
```

bisa menghasilkan constraint kandidat, tetapi production constraint sebaiknya eksplisit.

### 12.1 NOT NULL

`nullable=false` punya dua aspek:

- provider DDL generation hint,
- runtime metadata hint.

Tetapi database `NOT NULL` adalah enforcement nyata.

Jangan bergantung pada Java validation saja untuk invariant penting.

### 12.2 UNIQUE

`@Column(unique = true)` nyaman, tetapi constraint name provider-generated bisa buruk.

Lebih defensible:

```java
@Table(
    name = "case_record",
    uniqueConstraints = {
        @UniqueConstraint(
            name = "uk_case_record_case_no",
            columnNames = "case_no"
        )
    }
)
```

Lalu migration eksplisit:

```sql
alter table case_record
add constraint uk_case_record_case_no unique (case_no);
```

### 12.3 CHECK Constraint

JPA support untuk check constraint historically terbatas/berubah dan provider-specific sering dipakai. Untuk domain critical, buat manual migration.

Contoh:

```sql
alter table case_record
add constraint ck_case_record_status
check (status in ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'));
```

Tapi hati-hati kalau enum sering berubah. CHECK constraint bagus untuk invariant kuat, buruk untuk workflow state yang sering berevolusi tanpa migration discipline.

### 12.4 Foreign Key Names

Generated FK name bisa panjang, random, atau berubah antar provider version.

Lebih baik explicit:

```java
@ManyToOne(fetch = FetchType.LAZY)
@JoinColumn(
    name = "assigned_officer_id",
    foreignKey = @ForeignKey(name = "fk_case_record_assigned_officer")
)
private UserAccount assignedOfficer;
```

Migration:

```sql
alter table case_record
add constraint fk_case_record_assigned_officer
foreign key (assigned_officer_id)
references user_account(id);
```

Named constraints memudahkan:

- troubleshooting,
- migration rollback,
- DBA communication,
- incident report,
- monitoring error messages.

---

## 13. Index Discipline

ORM mapping tidak otomatis tahu semua index yang dibutuhkan.

JPA punya `@Index` di `@Table(indexes = ...)`, tetapi index design harus query-driven.

Contoh:

```java
@Table(
    name = "case_record",
    indexes = {
        @Index(name = "idx_case_record_status_created", columnList = "status, created_at"),
        @Index(name = "idx_case_record_assigned", columnList = "assigned_officer_id")
    }
)
```

Tetapi pertanyaan yang benar bukan “entity ini punya field apa?”, melainkan:

- query production mana yang paling sering,
- filter column apa,
- sort column apa,
- join path apa,
- cardinality bagaimana,
- selectivity bagaimana,
- pagination strategy apa,
- apakah index mendukung ordering,
- apakah composite index order benar,
- apakah write overhead dapat diterima.

### 13.1 Bad Index from Mapping Thinking

Entity:

```java
private String status;
private LocalDateTime createdAt;
private Long assignedOfficerId;
```

Developer membuat index satu-satu:

```sql
create index idx_case_status on case_record(status);
create index idx_case_created on case_record(created_at);
create index idx_case_assigned on case_record(assigned_officer_id);
```

Query sebenarnya:

```sql
select *
from case_record
where status = 'SUBMITTED'
  and assigned_officer_id = ?
order by created_at desc
fetch first 20 rows only;
```

Index yang lebih relevan mungkin:

```sql
create index idx_case_worklist
on case_record(assigned_officer_id, status, created_at desc);
```

### 13.2 Index and ORM Fetch Plan

N+1 fix dengan batch fetch bisa membuat query seperti:

```sql
select *
from document
where case_id in (?, ?, ?, ?, ...);
```

Maka index `document(case_id)` penting.

Join fetch bisa membuat join path:

```sql
select ...
from case_record cr
join document d on d.case_id = cr.id
where cr.status = ?;
```

Maka index di child FK penting.

Rule:

> Fetch plan dan index design harus dibahas bersama. ORM tuning tanpa index review sering hanya memindahkan bottleneck.

---

## 14. DDL and Transaction Locking Reality

DDL bukan operasi biasa. Setiap database punya behavior berbeda.

DDL bisa:

- implicit commit,
- acquire metadata lock,
- lock table,
- rewrite table,
- rebuild index,
- block reads,
- block writes,
- wait on active transaction,
- fail karena timeout,
- replicate lambat ke standby.

### 14.1 Table Size Matters

DDL pada table kosong aman. DDL sama pada table 500 juta row bisa menjadi incident.

Contoh risiko:

```sql
alter table audit_trail add column normalized_action varchar(64) default 'UNKNOWN' not null;
```

Jika database melakukan table rewrite, ini bisa:

- mengunci table lama,
- menghasilkan redo/undo besar,
- memenuhi storage,
- meningkatkan replication lag,
- memblokir aplikasi,
- gagal di tengah.

### 14.2 Safer Pattern for Large Table

```sql
alter table audit_trail add normalized_action varchar(64);
```

Backfill chunked:

```sql
update audit_trail
set normalized_action = 'UNKNOWN'
where normalized_action is null
  and id between :from_id and :to_id;
```

Verify:

```sql
select count(*)
from audit_trail
where normalized_action is null;
```

Add constraint later:

```sql
alter table audit_trail modify normalized_action not null;
```

Database-specific online validation may exist. Use it where appropriate.

---

## 15. Schema Drift

Schema drift terjadi ketika database actual tidak lagi sama dengan expected schema.

Sumber drift:

- manual DBA hotfix,
- failed migration,
- environment-specific patch,
- `ddl-auto=update` di satu environment,
- branch migration conflict,
- provider upgrade generated different DDL,
- test DB memakai H2 bukan DB target,
- local schema dibuat dari entity bukan migration,
- rollback app tanpa rollback schema,
- emergency production fix tidak dibawa ke repo.

### 15.1 Drift Detection Layers

Gunakan beberapa lapis:

1. Migration metadata checksum.
2. Hibernate/EclipseLink validation.
3. Schema diff tool.
4. Query integration tests.
5. Critical constraint existence check.
6. Runtime smoke test.
7. DBA catalog inspection.

### 15.2 Drift Example

Mapping:

```java
@Column(name = "case_no", nullable = false, length = 64)
private String caseNo;
```

DEV:

```sql
case_no varchar(64) not null
```

UAT:

```sql
case_no varchar(128) null
```

PROD:

```sql
case_no varchar(64) null
```

Semua environment bisa “jalan”, tetapi behavior berbeda:

- UAT menerima data yang production tolak,
- PROD menerima null yang app tidak ekspektasi,
- report UAT melihat value lebih panjang daripada PROD,
- bug sulit direproduksi.

---

## 16. Entity Mapping as Schema Documentation: Useful but Insufficient

Entity annotation adalah dokumentasi penting:

```java
@Entity
@Table(name = "case_record")
public class CaseRecord {
    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "case_record_seq")
    @SequenceGenerator(name = "case_record_seq", sequenceName = "case_record_seq", allocationSize = 50)
    private Long id;

    @Column(name = "case_no", nullable = false, length = 64)
    private String caseNo;

    @Column(name = "status", nullable = false, length = 32)
    private String status;

    @Version
    @Column(name = "version", nullable = false)
    private long version;
}
```

Namun annotation tidak cukup mendokumentasikan:

- why `case_no` unique,
- lifecycle status values,
- historical retention,
- masking/encryption policy,
- index rationale,
- query access pattern,
- migration history,
- data ownership,
- archival behavior.

Production-grade persistence documentation perlu menghubungkan:

```text
Entity field
  ↔ column
  ↔ constraint
  ↔ migration
  ↔ query
  ↔ index
  ↔ business invariant
  ↔ operational risk
```

---

## 17. Provider Generated DDL as Review Artifact

Daripada menjalankan generated DDL langsung ke production, gunakan sebagai review artifact.

Flow:

```text
1. Change entity mapping
2. Generate DDL script from provider into target/generated-schema.sql
3. Compare with existing migration expectation
4. Write explicit migration manually
5. Review migration with DBA/app engineer
6. Run migration in integration DB
7. Run ORM validate
8. Run query tests/performance tests
9. Deploy
```

Manfaat:

- provider membantu menemukan missing table/column,
- engineer tetap mengontrol migration semantic,
- DDL bisa direview,
- differences antar provider version terlihat,
- production tidak dikendalikan startup side effect.

---

## 18. Example: Safe Migration for New Required Business Field

Requirement:

> Tambahkan `risk_level` ke `case_record`. Existing case harus diberi nilai berdasarkan `case_type` dan `amount`. Field wajib untuk semua case baru.

### 18.1 Bad Approach

Entity:

```java
@Column(name = "risk_level", nullable = false, length = 16)
private String riskLevel;
```

`ddl-auto=update` mencoba add non-null column.

Masalah:

- existing rows tidak punya value,
- migration bisa gagal,
- no business backfill,
- rollback sulit,
- app lama tidak tahu column baru.

### 18.2 Safer Approach

Migration V1 expand:

```sql
alter table case_record add risk_level varchar(16);
```

Deploy app v1.5 yang dual-read/dual-write jika perlu.

Backfill V2:

```sql
update case_record
set risk_level = case
    when case_type = 'COMPLIANCE' then 'HIGH'
    when amount >= 100000 then 'MEDIUM'
    else 'LOW'
end
where risk_level is null;
```

Verify:

```sql
select risk_level, count(*)
from case_record
group by risk_level;

select count(*)
from case_record
where risk_level is null;
```

Constraint V3:

```sql
alter table case_record
add constraint ck_case_record_risk_level
check (risk_level in ('LOW', 'MEDIUM', 'HIGH'));

alter table case_record
modify risk_level not null;
```

Entity after migration complete:

```java
@Column(name = "risk_level", nullable = false, length = 16)
private String riskLevel;
```

Runtime guard:

```properties
spring.jpa.hibernate.ddl-auto=validate
```

---

## 19. Example: Changing Association from Nullable to Mandatory

Requirement:

> Every case must have assigned officer.

Current:

```java
@ManyToOne(fetch = FetchType.LAZY, optional = true)
@JoinColumn(name = "assigned_officer_id")
private UserAccount assignedOfficer;
```

Target:

```java
@ManyToOne(fetch = FetchType.LAZY, optional = false)
@JoinColumn(name = "assigned_officer_id", nullable = false)
private UserAccount assignedOfficer;
```

Unsafe direct DDL:

```sql
alter table case_record modify assigned_officer_id not null;
```

Safer sequence:

1. Identify nulls:

```sql
select count(*)
from case_record
where assigned_officer_id is null;
```

2. Decide business rule:

- assign to queue officer,
- assign to team lead,
- create unassigned placeholder user,
- prevent transition until assignment,
- keep old cases exempt.

3. Backfill:

```sql
update case_record
set assigned_officer_id = :default_officer_id
where assigned_officer_id is null;
```

4. Validate FK:

```sql
select cr.assigned_officer_id
from case_record cr
left join user_account ua on ua.id = cr.assigned_officer_id
where cr.assigned_officer_id is not null
  and ua.id is null;
```

5. Add/validate FK if missing.

6. Add not null.

7. Change mapping.

8. Run provider validation.

---

## 20. Example: Sequence Allocation and Schema Migration

Hibernate sequence allocation matters.

Mapping:

```java
@SequenceGenerator(
    name = "case_record_seq_gen",
    sequenceName = "case_record_seq",
    allocationSize = 50
)
@GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "case_record_seq_gen")
private Long id;
```

Database sequence must align with provider expectation.

Potential issue:

- DB sequence increment is 1,
- provider allocation size is 50,
- provider optimizer behavior differs by version/config,
- migration changes allocation size,
- IDs appear to jump,
- duplicate risk if manually manipulating sequence incorrectly.

Migration discipline:

- name sequence explicitly,
- document allocation size,
- avoid manual insert with arbitrary IDs,
- verify sequence current value after data import,
- test provider upgrade behavior,
- ensure sequence exists before app startup.

Example check:

```sql
-- database-specific; example concept only
select last_number
from user_sequences
where sequence_name = 'CASE_RECORD_SEQ';
```

---

## 21. LOB, JSON, XML, and Large Column DDL

Large fields need special discipline.

Examples:

```java
@Lob
@Column(name = "payload")
private String payload;
```

or provider-specific JSON mapping.

DDL impact:

- CLOB/BLOB storage can be separate segment,
- table row size changes,
- index options limited,
- migration/backfill expensive,
- reading entity can accidentally hydrate huge data,
- generated DDL differs strongly by database.

For audit/event payload:

- avoid loading LOB in list views,
- use separate table if access pattern differs,
- avoid updating LOB frequently,
- plan archival,
- test storage reclamation behavior,
- do not rely blindly on generated DDL.

Example design:

```text
case_audit
  id
  case_id
  action
  created_at
  actor_id
  summary

case_audit_payload
  audit_id
  metadata_clob
  serialized_changes_clob
```

This separates list/query workload from large payload retrieval.

---

## 22. Migration and Rollback Reality

Rollback database migration is harder than rollback app binary.

### 22.1 Backward-Compatible Migration Enables App Rollback

If migration only adds nullable column, old app can often still run.

```sql
alter table case_record add priority varchar(32);
```

If new app fails, rollback app. Column remains harmless.

### 22.2 Destructive Migration Blocks Rollback

```sql
alter table case_record drop column status;
```

Old app cannot run anymore.

### 22.3 Rollback Script Is Not Always Safe

If migration drops column, rollback might need restore data from backup. That is not same as:

```sql
alter table case_record add status varchar(32);
```

The column returns, but data does not.

### 22.4 Compensation Instead of Rollback

For production, prefer:

- forward fix,
- disable feature flag,
- rollback app if schema is backward compatible,
- restore from backup only for severe data loss,
- contract/drop only after safety window.

---

## 23. Multi-Branch Migration Conflict

In active teams, two branches can create migrations:

```text
Branch A: V2026_06_17_001__add_priority.sql
Branch B: V2026_06_17_001__add_due_date.sql
```

Conflict.

Discipline:

- timestamp-based naming,
- rebase migration before merge,
- CI checks duplicate versions,
- migration owner review,
- avoid editing applied migration,
- use new migration to fix old migration.

### 23.1 Never Edit Released Migration

If `V10__add_case_priority.sql` already applied in shared env, do not change it.

Create:

```text
V11__fix_case_priority_constraint.sql
```

Because migration metadata checksum will otherwise fail or, worse, environments diverge.

---

## 24. Test Strategy for Schema Discipline

### 24.1 Migration Test

Start from empty DB:

1. run all migrations,
2. start app with schema validation,
3. run smoke tests.

### 24.2 Upgrade Migration Test

Start from previous production-like snapshot:

1. load old schema + sample data,
2. run new migrations,
3. start new app,
4. validate data invariants,
5. run key workflows.

### 24.3 Query Plan Regression Test

For critical queries:

- capture SQL,
- run explain plan,
- compare index use,
- check row estimates,
- check sort/hash join changes.

Do not over-automate explain comparison blindly; query planners vary. But do inspect critical query plan after schema/index migration.

### 24.4 H2 Trap

H2 is useful for small unit tests but dangerous as migration proof for Oracle/PostgreSQL/MySQL/SQL Server.

Differences:

- type system,
- sequence behavior,
- timestamp precision,
- constraint behavior,
- locking behavior,
- DDL transaction behavior,
- reserved words,
- pagination syntax,
- index behavior.

For ORM/schema correctness, use Testcontainers or real integration DB.

---

## 25. Environment Strategy

### 25.1 Local

Acceptable:

```properties
spring.jpa.hibernate.ddl-auto=create-drop
```

or:

```properties
spring.jpa.hibernate.ddl-auto=update
```

only for throwaway DB.

Better local discipline:

- run migrations automatically,
- use validate,
- allow reset script for local DB.

### 25.2 CI

Recommended:

```properties
spring.jpa.hibernate.ddl-auto=validate
```

Pipeline:

1. create clean DB,
2. run migrations,
3. run app startup validation,
4. run repository/query tests.

### 25.3 DEV Shared

Avoid uncontrolled `update`. Shared DEV should resemble production discipline.

### 25.4 UAT/Staging

Must run production-like migration process.

### 25.5 Production

Recommended:

- migration executed by controlled job/pipeline,
- app starts with validation only,
- no automatic schema mutation from app startup,
- DDL reviewed,
- rollback/compensation documented,
- migration logs retained.

---

## 26. Spring Boot Integration Notes

Spring Boot property:

```properties
spring.jpa.hibernate.ddl-auto=validate
```

Common values:

- `none`,
- `validate`,
- `update`,
- `create`,
- `create-drop`.

With Flyway/Liquibase on classpath, Spring Boot often changes default behavior around schema initialization depending on version/config. Do not rely on implicit default. Set it explicitly.

Recommended production posture:

```properties
spring.jpa.hibernate.ddl-auto=validate
spring.flyway.enabled=true
```

or Liquibase equivalent.

For migration job separated from app:

```text
Job: run Flyway/Liquibase
App: start with Hibernate validate
```

In Kubernetes:

- avoid every pod running migration unless intentionally coordinated,
- prefer one migration job/init phase with locking semantics,
- ensure app waits until migration complete,
- handle failed migration explicitly.

---

## 27. Case Management Example: Audit Trail Evolution

Suppose system has audit table:

```text
audit_trail
  id
  module
  activity
  description
  metadata_clob
  serialized_changes_clob
  created_at
```

Requirement:

> Add internet/intranet source classification and improve listing query performance.

Bad approach:

- add `source` as non-null directly,
- update all rows in one transaction,
- add broad index without query analysis,
- change entity and rely on `ddl-auto=update`.

Better approach:

### 27.1 Expand

```sql
alter table audit_trail add source varchar(16);
```

### 27.2 Backfill in chunks

```sql
update audit_trail
set source = case
    when description like 'Internet - %' then 'INTERNET'
    else 'INTRANET'
end
where source is null
  and id between :from_id and :to_id;
```

### 27.3 Add index based on listing query

If listing query:

```sql
select id, module, activity, created_at, source
from audit_trail
where module = ?
  and source = ?
  and created_at between ? and ?
order by created_at desc;
```

Candidate index:

```sql
create index idx_audit_trail_module_source_created
on audit_trail(module, source, created_at desc);
```

But verify cardinality. If source has only two values, index order may need adjustment depending on module selectivity.

### 27.4 Constraint

```sql
alter table audit_trail
add constraint ck_audit_trail_source
check (source in ('INTERNET', 'INTRANET'));
```

Then not null after verification:

```sql
select count(*) from audit_trail where source is null;
```

### 27.5 Mapping

```java
@Column(name = "source", nullable = false, length = 16)
private String source;
```

### 27.6 Validate

Start app with provider validation and run listing performance smoke test.

---

## 28. Design Rules

1. Never let production schema be mutated accidentally by app startup.
2. Use provider DDL generation as a review aid, not production authority.
3. Use schema validation as runtime guardrail.
4. Treat schema as public contract, not private implementation detail.
5. Make migrations versioned, immutable, and auditable.
6. Use expand-contract for rolling deployment and rollback safety.
7. Do not rename/drop/change type directly unless compatibility is proven.
8. Backfill data explicitly with business logic.
9. Name constraints and indexes explicitly.
10. Design indexes from query patterns, not field list.
11. Test migrations against real target database behavior.
12. Avoid H2 as proof of DDL correctness.
13. Separate migration execution from normal app startup.
14. Review large-table DDL for locks, rewrite, redo/undo, and replication lag.
15. Keep entity mapping, migration, and operational documentation aligned.
16. Treat provider upgrade as potential DDL behavior change.
17. Validate schema in CI and production startup.
18. Contract/drop only after old app/report/ETL dependencies are gone.
19. Make rollback strategy explicit before applying destructive DDL.
20. For regulatory systems, preserve historical meaning before optimizing schema.

---

## 29. Anti-Patterns

### 29.1 Production `ddl-auto=update`

Symptoms:

- unexplained schema changes,
- environment drift,
- startup race,
- missing data backfill,
- accidental column creation,
- DBA confusion.

Fix:

- disable update,
- introduce migration tool,
- run validate at startup,
- baseline existing schema carefully.

### 29.2 Entity-First Schema Without Migration Review

Symptoms:

- generated names unreadable,
- wrong column types,
- missing index,
- no audit trail of change.

Fix:

- generate DDL as draft,
- write explicit migration,
- review.

### 29.3 Direct Destructive Change

Examples:

```sql
alter table case_record drop column old_status;
```

without checking old app/report/ETL.

Fix:

- deprecate first,
- observe no usage,
- contract later.

### 29.4 H2-Only Migration Confidence

Symptoms:

- tests pass,
- production migration fails due to dialect/locking/type differences.

Fix:

- use target DB in integration tests.

### 29.5 Constraint Only in Java

Symptoms:

- data corrupted by batch/import/native SQL,
- report sees invalid states,
- app assumes invariant that DB does not enforce.

Fix:

- enforce core invariants in DB constraints where appropriate.

---

## 30. Diagnostic Checklist

When schema-related issue appears, ask:

### 30.1 Startup Failure

- Did migration run before app startup?
- Is app using `validate`, `update`, or `none`?
- Is schema generated by correct provider version?
- Is dialect/platform correct?
- Are `javax` and `jakarta` configs mixed?
- Are sequence/table/column names explicit?
- Did naming strategy change?

### 30.2 Runtime SQL Error

- Is column missing in one environment?
- Is type/length different?
- Is nullability different?
- Is FK/constraint different?
- Is native query using old column name?
- Is generated SQL using reserved word?

### 30.3 Performance Regression After Migration

- Was index dropped/rebuilt?
- Did column type change affect plan?
- Did cardinality/statistics change?
- Did query shape change due to mapping?
- Did fetch plan change?
- Did migration require analyze/statistics refresh?

### 30.4 Data Corruption After Migration

- Was backfill business logic correct?
- Did app v1 and v2 run concurrently?
- Was dual-write needed?
- Was rollback performed with forward-incompatible schema?
- Did bulk migration bypass version/audit?

### 30.5 Large Table DDL Incident

- Did DDL lock table?
- Did it rewrite table?
- Did redo/undo/storage spike?
- Did replication lag increase?
- Was migration chunked?
- Was lock timeout configured?
- Was maintenance window required?

---

## 31. Practice Scenarios

### Scenario 1 — Rename `description` to `summary`

Naive:

```sql
alter table case_record rename column description to summary;
```

Design safer migration for rolling deployment.

Expected reasoning:

- add `summary`,
- dual-read/dual-write,
- backfill,
- switch reads,
- remove old later.

### Scenario 2 — Add Mandatory `agency_id`

Existing table has 10M cases. Requirement says every case belongs to agency.

Design:

- nullable add,
- derive agency by existing module/owner,
- chunked backfill,
- FK validation,
- not null later,
- index for agency-scoped queries,
- tenant leak checks.

### Scenario 3 — Enum Status Evolves

Current DB has CHECK:

```sql
status in ('DRAFT', 'SUBMITTED', 'APPROVED')
```

New status `RETURNED_FOR_CLARIFICATION` needed.

Plan:

- migration updates check constraint before app writes new value,
- deploy app,
- ensure old app does not fail reading unknown enum,
- consider enum string mapping compatibility.

### Scenario 4 — Hibernate Upgrade Changes DDL Diff

Hibernate 5 to 6/7 shows generated DDL differences for timestamp precision and sequence behavior.

Plan:

- generate DDL before/after,
- diff,
- decide which differences matter,
- write explicit migration if needed,
- run schema validate,
- performance test critical queries.

### Scenario 5 — Add Index to Hot Table

Query is slow on `audit_trail`, table has 200M rows.

Plan:

- confirm query plan,
- design index,
- check online/concurrent index capability for DB,
- schedule migration,
- monitor lock/redo/storage,
- refresh statistics if needed,
- verify plan after.

---

## 32. Summary

Schema generation is useful, but dangerous when misunderstood.

The high-level rule:

```text
Use ORM metadata to understand expected schema.
Use provider validation to guard runtime compatibility.
Use migration tools and reviewed SQL to evolve production schema.
```

A top-tier engineer does not ask only:

> “Can Hibernate generate this table?”

They ask:

> “Can this schema change be deployed safely while old and new application versions coexist, data remains correct, queries remain performant, rollback remains possible, and audit meaning remains intact?”

That is the difference between CRUD-level ORM usage and production persistence engineering.

---

## 33. References

- Jakarta Persistence 3.2 Specification — schema generation and persistence provider contract.
- Jakarta Persistence API docs — schema management properties.
- Hibernate ORM User Guide — schema generation, validation, dialects, type mapping, and hbm2ddl behavior.
- EclipseLink JPA Extensions Documentation — DDL generation properties and output modes.
- Flyway/Liquibase style migration discipline — versioned migrations, checksums, repeatable migrations, controlled rollout.
- Expand-contract/parallel change migration pattern — backward-compatible database evolution for rolling deployments.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./21-second-level-cache-query-cache-natural-id-cache-correctness.md">⬅️ Part 21 — Second-Level Cache, Query Cache, Natural ID Cache, and Cache Correctness</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./23-provider-enhancement-weaving-bytecode-proxies-build-pipelines.md">Part 23 — Provider Enhancement and Weaving: Bytecode, Proxies, Lazy Fields, and Build Pipelines ➡️</a>
</div>
