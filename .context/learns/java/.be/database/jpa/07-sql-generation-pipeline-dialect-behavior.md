# Part 7 — SQL Generation Pipeline and Dialect Behavior

> Seri: `learn-java-jpa-provider-hibernate-eclipselink-orm-engineering`  
> File: `07-sql-generation-pipeline-dialect-behavior.md`  
> Target pembaca: Java engineer yang sudah memahami JPA dasar dan ingin memahami bagaimana provider ORM menerjemahkan object operations menjadi SQL yang benar, efisien, dan sesuai database target.  
> Scope Java: Java 8 sampai Java 25.  
> Scope API: JPA 2.x (`javax.persistence`) sampai Jakarta Persistence 3.x (`jakarta.persistence`).  
> Scope provider: Hibernate ORM 5.x/6.x/7.x, EclipseLink 2.x/3.x/4.x.

---

## 0. Posisi Bagian Ini dalam Seri

Pada bagian sebelumnya kita sudah membahas:

1. ORM sebagai **state synchronization engine**.
2. Perbedaan antara **JPA specification** dan **provider reality**.
3. Bootstrap provider, metadata, dan initialization.
4. Entity identity.
5. Persistence context, first-level cache, dan unit of work.
6. Dirty checking.
7. Flush semantics dan action queue.

Bagian ini menjawab pertanyaan berikut:

> Setelah persistence context mengetahui ada operasi insert/update/delete/query, bagaimana provider mengubah operasi tersebut menjadi SQL konkret yang bisa dieksekusi di database tertentu?

Ini penting karena banyak engineer mengira SQL dari ORM adalah “detail internal”. Dalam production system, SQL yang dihasilkan ORM justru menjadi salah satu kontrak paling penting antara aplikasi dan database.

ORM bukan hanya menjalankan query. ORM melakukan translasi dari:

```text
Object model + mapping metadata + query language + provider rules + database dialect

menjadi

SQL text + JDBC parameters + expected result mapping + execution semantics
```

Kalau salah satu input itu salah, SQL yang keluar bisa salah, lambat, tidak portable, atau gagal hanya di environment tertentu.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Memahami pipeline besar dari entity operation, JPQL/HQL/Criteria, dan native query menuju SQL.
2. Membedakan peran JPA specification, provider SQL engine, database dialect, JDBC driver, dan database optimizer.
3. Membaca SQL generated ORM sebagai output dari mapping decision, bukan sebagai kejutan.
4. Memahami kenapa SQL yang sama secara logical bisa berbeda antara Oracle, PostgreSQL, MySQL, SQL Server, dan database lain.
5. Memahami peran dialect dalam:
   - pagination,
   - locking,
   - identifier generation,
   - function translation,
   - type mapping,
   - LOB handling,
   - timestamp precision,
   - boolean handling,
   - sequence/identity behavior,
   - SQL capabilities.
6. Menghindari failure mode umum:
   - wrong dialect,
   - dialect auto-detection salah,
   - reserved keyword column,
   - broken pagination,
   - wrong lock SQL,
   - sequence mismatch,
   - timestamp truncation,
   - query behavior berubah setelah upgrade Hibernate/EclipseLink.
7. Mendesain persistence layer yang eksplisit terhadap database target tanpa kehilangan maintainability.

---

## 2. Core Mental Model

### 2.1 ORM SQL generation bukan string concatenation sederhana

SQL generation dalam provider modern bukan sekadar:

```java
"select * from " + tableName + " where id = ?"
```

Provider perlu mempertimbangkan:

- entity mapping,
- table mapping,
- column mapping,
- inheritance strategy,
- discriminator,
- association join,
- fetch plan,
- lock mode,
- pagination,
- soft delete/filter,
- tenant filter,
- parameter type,
- database-specific syntax,
- JDBC driver behavior,
- generated key retrieval,
- sequence/identity strategy,
- batch support,
- result mapping,
- optimistic locking,
- version column,
- LOB and temporal precision,
- quoted identifiers,
- reserved words,
- naming strategy,
- schema/catalog handling.

Karena itu, SQL generation lebih tepat dipandang sebagai **compilation pipeline**.

```text
High-level persistence intent
        |
        v
ORM semantic model
        |
        v
Provider query/mutation model
        |
        v
Database dialect translation
        |
        v
SQL AST / SQL command model
        |
        v
SQL string + JDBC parameter bindings
        |
        v
JDBC driver
        |
        v
Database parser + optimizer + executor
```

Hibernate modern menggunakan arsitektur yang semakin eksplisit di sekitar semantic query model dan SQL AST. EclipseLink menggunakan pendekatan internal sendiri berbasis expression/query framework, descriptor, database platform, dan call/record processing. Nama internalnya berbeda, tetapi konsepnya sama: provider mengubah intent Java/JPA menjadi SQL yang sesuai database.

---

### 2.2 Dialect adalah “compiler backend” untuk database tertentu

Analoginya:

```text
Java source code -> compiler frontend -> intermediate representation -> backend target CPU
```

Dalam ORM:

```text
JPQL / Criteria / entity mutation
        -> provider semantic model
        -> SQL command model
        -> dialect-specific SQL
        -> database target
```

Dialect/database platform menjawab pertanyaan seperti:

- Bagaimana menulis pagination?
- Apakah database mendukung `fetch first n rows only`?
- Apakah database menggunakan `limit ? offset ?`?
- Bagaimana menulis pessimistic lock?
- Apakah `for update skip locked` didukung?
- Apakah sequence didukung?
- Bagaimana mengambil generated key?
- Bagaimana representasi boolean?
- Apakah database mendukung common table expression?
- Bagaimana escaping quoted identifier?
- Apa tipe SQL untuk `LocalDateTime`, `UUID`, `Boolean`, `BigDecimal`, `byte[]`, `CLOB`?
- Bagaimana register function seperti `lower`, `concat`, `extract`, `timestampdiff`, `json_value`, atau database-specific function?
- Apakah batch update count reliable?
- Bagaimana temporary table bekerja?

Jadi dialect bukan cosmetic setting. Dialect menentukan bentuk SQL dan sebagian behavior runtime.

---

### 2.3 SQL generated adalah hasil dari lima kontrak

Setiap SQL generated biasanya lahir dari kombinasi lima hal:

```text
1. Domain model/entity class
2. Mapping metadata
3. Persistence operation/query
4. Provider implementation
5. Database dialect/platform
```

Contoh:

```java
@Entity
@Table(name = "case_file")
public class CaseFile {
    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "case_file_seq")
    @SequenceGenerator(name = "case_file_seq", sequenceName = "case_file_seq", allocationSize = 50)
    private Long id;

    @Column(name = "case_no", nullable = false, length = 50)
    private String caseNo;

    @Version
    private long version;
}
```

Ketika kamu menjalankan:

```java
entityManager.persist(new CaseFile("CASE-001"));
```

Provider perlu menentukan:

- Bagaimana memperoleh ID?
- Apakah sequence dipanggil sebelum insert?
- Apakah insert bisa dibatch?
- Kolom apa saja yang masuk insert?
- Apakah version ikut diinsert?
- Apakah table/column perlu quote?
- Apakah schema/catalog perlu prefix?
- Apakah database mendukung `returning`?
- Bagaimana urutan parameter JDBC?

Di PostgreSQL/Hibernate, SQL bisa mendekati:

```sql
select nextval('case_file_seq');

insert into case_file (case_no, version, id)
values (?, ?, ?);
```

Di Oracle, SQL sequence bisa berbeda:

```sql
select case_file_seq.nextval from dual;

insert into case_file (case_no, version, id)
values (?, ?, ?);
```

Di database dengan identity column, provider mungkin tidak memanggil sequence terpisah. Insert bisa menjadi:

```sql
insert into case_file (case_no, version)
values (?, ?);
```

Lalu generated key diambil dari JDBC/database-specific mechanism.

Satu annotation `@GeneratedValue` bisa berujung SQL yang sangat berbeda.

---

## 3. JPA Specification-Level View

Jakarta Persistence mendefinisikan standard untuk object/relational mapping di Java SE dan Jakarta EE. Specification memberi abstraksi seperti entity, persistence context, JPQL, Criteria API, mapping annotation, lifecycle callback, transaction integration, dan query API.

Namun specification tidak berusaha menyeragamkan semua detail SQL database. Itu mustahil karena SQL dialect tiap database berbeda.

### 3.1 Yang relatif distandarkan

JPA/Jakarta Persistence mendefinisikan:

- Entity mapping concepts.
- Basic relationship mapping.
- JPQL grammar dan semantics.
- Criteria API.
- Entity lifecycle.
- Persistence context behavior.
- Flush behavior level tinggi.
- Lock modes level API.
- Query parameter binding.
- Mapping annotation semantics.
- Basic schema generation support.

### 3.2 Yang tidak sepenuhnya distandarkan

Specification tidak menjamin detail seperti:

- SQL exact text yang dihasilkan.
- Urutan join tertentu.
- Optimizer hint syntax.
- Dialect-specific function.
- Pagination SQL syntax.
- Lock timeout SQL syntax.
- Batch insert/update strategy.
- Fetch plan optimization internal.
- Type mapping untuk extension type seperti JSON, UUID, array.
- Query plan cache internal.
- LOB streaming implementation.
- Generated key retrieval strategy.
- Behavior dari provider-specific annotation.

Karena itu, dua provider bisa sama-sama JPA-compliant tetapi menghasilkan SQL berbeda.

---

## 4. Three Main Sources of SQL in ORM

SQL dari provider biasanya berasal dari tiga jalur besar:

1. **Entity state transition / mutation SQL**
2. **Object query SQL**
3. **Native SQL pass-through / mapped native query**

---

### 4.1 Entity mutation SQL

Dihasilkan dari operasi:

```java
entityManager.persist(entity);
entity.setName("new name");
entityManager.remove(entity);
```

SQL-nya biasanya muncul saat flush.

Contoh:

```java
CaseFile caseFile = entityManager.find(CaseFile.class, id);
caseFile.setStatus(CaseStatus.CLOSED);
```

Saat flush, provider bisa menghasilkan:

```sql
update case_file
set status = ?, version = ?
where id = ? and version = ?;
```

Kalau ada optimistic locking, version lama masuk `where`, version baru masuk `set`.

---

### 4.2 Object query SQL

Dihasilkan dari JPQL/HQL/Criteria.

JPQL:

```java
List<CaseFile> cases = entityManager.createQuery("""
    select c
    from CaseFile c
    where c.status = :status
    order by c.createdAt desc
    """, CaseFile.class)
    .setParameter("status", CaseStatus.OPEN)
    .setMaxResults(20)
    .getResultList();
```

SQL PostgreSQL-style bisa menjadi:

```sql
select
    c.id,
    c.case_no,
    c.status,
    c.created_at,
    c.version
from case_file c
where c.status = ?
order by c.created_at desc
fetch first ? rows only;
```

Atau tergantung dialect/version bisa menjadi:

```sql
select
    c.id,
    c.case_no,
    c.status,
    c.created_at,
    c.version
from case_file c
where c.status = ?
order by c.created_at desc
limit ?;
```

---

### 4.3 Native SQL

Native query dibuat manual:

```java
List<Object[]> rows = entityManager.createNativeQuery("""
    select status, count(*)
    from case_file
    group by status
    """).getResultList();
```

Di sini provider tidak menerjemahkan query object-level menjadi SQL. Tetapi provider masih bisa terlibat dalam:

- parameter binding,
- result mapping,
- entity materialization,
- synchronization hints,
- flush before query,
- transaction participation.

Native query bukan berarti provider hilang sepenuhnya.

---

## 5. SQL Generation Pipeline: Entity Mutation

Mari lihat pipeline insert/update/delete.

### 5.1 Insert pipeline

Ketika:

```java
entityManager.persist(caseFile);
```

Provider melakukan hal-hal seperti:

```text
persist(entity)
  -> validate entity state
  -> assign/pool identifier if needed
  -> register entity as managed
  -> add insert action to action queue
  -> later flush
  -> generate insert SQL according to mapping/dialect
  -> bind JDBC parameters
  -> execute statement
  -> process generated key/version if needed
```

Important distinction:

- `persist()` tidak selalu langsung mengeksekusi SQL.
- ID generation strategy bisa memaksa SQL lebih awal.
- Flush/commit/query bisa memicu eksekusi.

#### Sequence strategy

Dengan sequence:

```java
@GeneratedValue(strategy = GenerationType.SEQUENCE)
```

Provider bisa memperoleh ID sebelum insert. Ini memungkinkan JDBC batching insert karena ID sudah tersedia.

```text
select sequence_next_value
insert row 1
insert row 2
insert row 3
```

#### Identity strategy

Dengan identity:

```java
@GeneratedValue(strategy = GenerationType.IDENTITY)
```

Database menghasilkan ID saat insert. Provider sering perlu execute insert lebih awal untuk mengetahui ID. Ini bisa mengganggu batching.

```text
insert row -> generated id returned
insert row -> generated id returned
insert row -> generated id returned
```

#### Table generator

Table generator menggunakan table khusus untuk menyimpan sequence-like values. Ini portable tapi biasanya buruk untuk high-throughput system karena menambah contention dan round trip.

---

### 5.2 Update pipeline

Ketika managed entity berubah:

```java
caseFile.setStatus(CaseStatus.CLOSED);
```

Tidak ada SQL langsung. Saat flush:

```text
flush
  -> dirty checking
  -> determine dirty attributes
  -> create update action
  -> generate update SQL
  -> include version condition if versioned
  -> bind old/new values
  -> execute
  -> check affected row count
```

Contoh:

```sql
update case_file
set status = ?, version = ?
where id = ? and version = ?;
```

Kalau affected row count = 0, provider bisa menyimpulkan optimistic lock failure.

---

### 5.3 Delete pipeline

Ketika:

```java
entityManager.remove(caseFile);
```

Provider perlu mempertimbangkan:

- cascade remove,
- orphan removal,
- FK constraint,
- delete ordering,
- join table cleanup,
- collection table cleanup,
- version check.

SQL bisa menjadi:

```sql
delete from case_attachment
where case_file_id = ?;

update task
set case_file_id = null
where case_file_id = ?;

delete from case_file
where id = ? and version = ?;
```

Atau jika mapping dan FK berbeda, SQL order bisa berubah drastis.

---

## 6. SQL Generation Pipeline: JPQL/HQL/Criteria

### 6.1 JPQL is object-oriented query language

JPQL berbicara dalam entity dan attribute, bukan table dan column.

```jpql
select c
from CaseFile c
where c.assignedOfficer.username = :username
```

JPQL tidak menyebut:

- table `case_file`,
- table `officer`,
- FK `assigned_officer_id`,
- join syntax.

Provider menerjemahkan association path menjadi SQL join.

Possible SQL:

```sql
select
    c.id,
    c.case_no,
    c.status,
    c.assigned_officer_id,
    c.version
from case_file c
join officer o on o.id = c.assigned_officer_id
where o.username = ?;
```

---

### 6.2 Path expression can create implicit joins

JPQL ini terlihat sederhana:

```jpql
select c
from CaseFile c
where c.applicant.profile.nationality = :nationality
```

Tapi bisa menghasilkan beberapa join:

```sql
select c.*
from case_file c
join applicant a on a.id = c.applicant_id
join profile p on p.id = a.profile_id
where p.nationality = ?;
```

Hidden cost:

- query terlihat kecil di Java,
- SQL bisa besar,
- join bisa memengaruhi cardinality,
- index requirement berubah,
- optimizer plan bisa berat.

Rule:

> Setiap dot path di JPQL harus kamu bayangkan sebagai kemungkinan join.

---

### 6.3 Criteria API menghasilkan semantic query yang sama

Criteria API bukan query engine berbeda secara fundamental. Ia cara type-safe/dynamic untuk membangun query.

```java
CriteriaBuilder cb = em.getCriteriaBuilder();
CriteriaQuery<CaseFile> cq = cb.createQuery(CaseFile.class);
Root<CaseFile> root = cq.from(CaseFile.class);

cq.select(root)
  .where(cb.equal(root.get("status"), CaseStatus.OPEN));

List<CaseFile> result = em.createQuery(cq).getResultList();
```

Secara pipeline:

```text
Criteria object tree
  -> provider semantic query model
  -> SQL generation
```

Criteria tidak otomatis lebih cepat dari JPQL. Benefit utamanya:

- dynamic query composition,
- type-safety sebagian,
- reusable predicates,
- less string concatenation.

Risikonya:

- query shape bisa sulit dibaca,
- dynamic join duplication,
- accidental cartesian product,
- poor abstraction hiding expensive joins.

---

## 7. Hibernate SQL Generation View

### 7.1 Hibernate architecture secara ringkas

Hibernate modern memiliki beberapa lapisan konsep:

```text
Entity mapping metadata
        |
HQL/Criteria semantic interpretation
        |
Semantic Query Model / mutation model
        |
SQL AST / JDBC operation model
        |
Dialect rendering
        |
PreparedStatement + bindings
```

Untuk mutation dari persistence context:

```text
PersistenceContext dirty state
        |
ActionQueue
        |
Insert/Update/Delete actions
        |
Mutation executor
        |
Dialect-aware SQL
        |
JDBC
```

Dalam Hibernate 6+, query engine berubah besar dibanding Hibernate 5. Hibernate menjadi lebih tegas memisahkan semantic query model, SQL AST, type system, dan JDBC mapping. Dampaknya, banyak query yang “kebetulan jalan” di Hibernate 5 bisa berubah behavior atau gagal saat migration ke Hibernate 6/7.

---

### 7.2 Hibernate Dialect

Hibernate dialect adalah class yang mendeskripsikan kemampuan dan syntax database target.

Contoh dialect family:

```text
org.hibernate.dialect.PostgreSQLDialect
org.hibernate.dialect.OracleDialect
org.hibernate.dialect.MySQLDialect
org.hibernate.dialect.SQLServerDialect
org.hibernate.dialect.H2Dialect
```

Di versi modern, Hibernate banyak mengurangi kebutuhan memilih class dialect super-spesifik seperti `PostgreSQL95Dialect`, `MySQL8Dialect`, dan sejenisnya. Hibernate cenderung menggunakan base dialect yang aware terhadap database version dari metadata JDBC, walaupun detailnya bergantung versi Hibernate.

Practical rule:

> Ikuti dokumentasi versi Hibernate yang kamu pakai. Jangan copy dialect class dari StackOverflow lama tanpa memeriksa apakah class itu masih ada atau deprecated.

---

### 7.3 Hibernate SQL comments and statement inspection

Hibernate bisa menambahkan komentar SQL untuk debugging:

```properties
hibernate.use_sql_comments=true
```

Contoh output:

```sql
/* select c from CaseFile c where c.status = :status */
select c.id, c.case_no, c.status
from case_file c
where c.status = ?
```

Untuk production-grade tracing, lebih baik gunakan `StatementInspector` atau observability layer agar bisa menambahkan correlation ID dengan aman.

Contoh conceptual:

```java
public class CorrelationStatementInspector implements StatementInspector {
    @Override
    public String inspect(String sql) {
        String correlationId = CorrelationContext.getOrNull();
        if (correlationId == null) {
            return sql;
        }
        return "/* correlation_id=" + sanitize(correlationId) + " */ " + sql;
    }
}
```

Caution:

- jangan inject user input mentah ke SQL comment,
- jangan log PII,
- jangan membuat SQL text terlalu unik sehingga query plan cache database rusak.

---

## 8. EclipseLink SQL Generation View

### 8.1 EclipseLink concepts

EclipseLink menggunakan konsep seperti:

- `Session`,
- `UnitOfWork`,
- descriptors,
- mappings,
- database platform,
- query framework,
- expressions,
- calls,
- records.

Secara mental model:

```text
Entity descriptors + mappings
        |
Expression / query object / UnitOfWork changes
        |
Database platform translation
        |
SQL call
        |
JDBC execution
        |
Object building / cache coordination
```

### 8.2 EclipseLink DatabasePlatform

EclipseLink menggunakan `DatabasePlatform` untuk database-specific behavior.

Contoh conceptual:

```text
OraclePlatform
PostgreSQLPlatform
MySQLPlatform
SQLServerPlatform
H2Platform
```

Database platform berperan mirip dialect:

- SQL syntax,
- sequence support,
- platform functions,
- type conversion,
- pagination/locking behavior,
- generated key handling,
- native SQL support.

### 8.3 Provider-specific behavior matters

Hibernate dan EclipseLink bisa sama-sama menjalankan JPQL yang sama, tetapi:

- join rendering bisa berbeda,
- alias naming berbeda,
- batching behavior berbeda,
- cache interaction berbeda,
- fetch optimization berbeda,
- sequence preallocation berbeda,
- lock SQL berbeda,
- function support berbeda.

Karena itu, “JPA portable” tidak berarti “SQL generated identik”.

---

## 9. Dialect Responsibilities in Detail

### 9.1 Pagination

JPA API:

```java
query.setFirstResult(20);
query.setMaxResults(10);
```

Intent:

```text
skip 20 rows, return 10 rows
```

SQL berbeda per database.

PostgreSQL/MySQL style:

```sql
select *
from case_file
order by created_at desc
limit ? offset ?;
```

Standard-ish modern SQL style:

```sql
select *
from case_file
order by created_at desc
offset ? rows fetch next ? rows only;
```

Oracle older style bisa melibatkan subquery dan `rownum`:

```sql
select *
from (
    select inner_query.*, rownum rownum_
    from (
        select *
        from case_file
        order by created_at desc
    ) inner_query
    where rownum <= ?
)
where rownum_ > ?;
```

SQL Server style:

```sql
select *
from case_file
order by created_at desc
offset ? rows fetch next ? rows only;
```

But SQL Server biasanya membutuhkan `order by` untuk offset/fetch.

Failure modes:

- pagination tanpa deterministic order,
- dialect lama menghasilkan SQL tidak optimal,
- database version tidak mendukung syntax,
- fetch join collection + pagination menghasilkan result tidak sesuai ekspektasi,
- provider melakukan pagination in-memory pada kasus tertentu.

Design rule:

> Pagination production harus selalu punya ordering deterministik. Jangan mengandalkan natural database order.

Contoh buruk:

```java
em.createQuery("select c from CaseFile c", CaseFile.class)
  .setFirstResult(0)
  .setMaxResults(20)
  .getResultList();
```

Contoh lebih aman:

```java
em.createQuery("""
    select c
    from CaseFile c
    order by c.createdAt desc, c.id desc
    """, CaseFile.class)
  .setFirstResult(0)
  .setMaxResults(20)
  .getResultList();
```

---

### 9.2 Locking SQL

JPA lock API:

```java
em.find(CaseFile.class, id, LockModeType.PESSIMISTIC_WRITE);
```

Intent:

```text
ambil row dan lock untuk update
```

SQL bisa menjadi:

```sql
select ...
from case_file
where id = ?
for update;
```

Tapi detail berbeda:

- Oracle mendukung variasi `for update nowait`, `wait n`, `skip locked`.
- PostgreSQL mendukung `for update`, `for no key update`, `skip locked`, `nowait`.
- MySQL/InnoDB punya behavior lock yang dipengaruhi isolation level dan index usage.
- SQL Server bisa menggunakan locking hints seperti `with (updlock, rowlock)` bergantung provider/dialect.

JPA menyediakan hints lock timeout, tetapi translasi ke SQL/database behavior tidak selalu identik.

Failure modes:

- lock timeout hint diabaikan atau beda makna,
- `PESSIMISTIC_READ` tidak sama antar database,
- lock escalation,
- gap lock di MySQL,
- deadlock karena order akses berbeda,
- full table scan menyebabkan lock terlalu luas.

Design rule:

> Pessimistic lock hanya aman jika query memakai index yang tepat dan urutan lock konsisten.

---

### 9.3 Identifier generation

Dialect memengaruhi strategi ID.

#### Sequence

Database yang mendukung sequence:

```sql
select nextval('case_file_seq');
```

atau:

```sql
select case_file_seq.nextval from dual;
```

Keuntungan:

- ID tersedia sebelum insert,
- batching lebih mudah,
- allocation/pooling bisa mengurangi round trip.

Risiko:

- allocation size mismatch antara entity mapping dan database sequence,
- sequence cache mismatch,
- ID gap normal tapi disalahpahami sebagai bug,
- sequence permission issue,
- wrong schema.

#### Identity

Database menghasilkan ID saat insert:

```sql
insert into case_file (...) values (...);
```

Lalu provider mengambil generated key.

Keuntungan:

- simple,
- natural di MySQL/SQL Server/PostgreSQL identity.

Risiko:

- insert batching bisa terbatas,
- ID baru diketahui setelah insert,
- flush timing bisa berubah,
- sulit untuk parent-child graph tertentu.

#### UUID

UUID bisa:

- di-generate application-side,
- di-generate database-side,
- disimpan sebagai `varchar`, `char`, `uuid`, `raw(16)`, `binary(16)`.

Dialect/type mapping penting.

Trade-off:

- UUID random buruk untuk clustered index tertentu,
- UUID v7/time-ordered lebih baik untuk insert locality,
- database native UUID tidak tersedia di semua DB,
- string UUID boros storage dan index.

---

### 9.4 Function translation

JPQL memiliki function standar terbatas. Provider juga mendukung function registry.

JPQL:

```jpql
select lower(c.caseNo)
from CaseFile c
```

SQL:

```sql
select lower(c.case_no)
from case_file c
```

Tapi function lain bisa berbeda.

Contoh date extraction:

```jpql
select year(c.createdAt)
from CaseFile c
```

Possible SQL:

```sql
extract(year from c.created_at)
```

atau:

```sql
year(c.created_at)
```

atau provider-specific rendering.

Untuk function database-specific:

```jpql
select function('json_value', c.metadata, '$.riskLevel')
from CaseFile c
```

Ini bisa portable di API level tapi tidak portable di database behavior.

Failure modes:

- function ada di dev DB tapi tidak ada di prod DB,
- return type salah,
- index tidak dipakai karena function wrapping,
- collation/case sensitivity berbeda,
- timezone conversion berbeda.

Design rule:

> Database-specific function sebaiknya dianggap sebagai explicit dependency, bukan “sedikit JPQL portable”.

---

### 9.5 Type mapping

Provider perlu memetakan Java type ke JDBC/SQL type.

Contoh:

| Java Type | Possible SQL Type |
|---|---|
| `String` | `varchar`, `nvarchar`, `text`, `clob` |
| `BigDecimal` | `numeric(p,s)`, `decimal(p,s)`, `number(p,s)` |
| `Boolean` | `boolean`, `bit`, `tinyint`, `number(1)`, `char(1)` |
| `LocalDate` | `date` |
| `LocalDateTime` | `timestamp` |
| `OffsetDateTime` | `timestamp with time zone`, converted timestamp |
| `Instant` | timestamp-like, provider-dependent |
| `UUID` | `uuid`, `binary(16)`, `char(36)`, `raw(16)` |
| `byte[]` | `varbinary`, `blob`, `raw`, `longvarbinary` |
| enum | ordinal numeric, string, converter-defined |

JPA mapping annotation memberi intent, tapi dialect menentukan SQL type default dan binding details.

#### Boolean example

PostgreSQL:

```sql
active boolean
```

Oracle older style:

```sql
active number(1)
```

or:

```sql
active char(1)
```

Jika schema existing memakai `Y/N`, gunakan converter/type eksplisit.

```java
@Converter(autoApply = false)
public class YesNoBooleanConverter implements AttributeConverter<Boolean, String> {
    @Override
    public String convertToDatabaseColumn(Boolean value) {
        if (value == null) return null;
        return value ? "Y" : "N";
    }

    @Override
    public Boolean convertToEntityAttribute(String value) {
        if (value == null) return null;
        return "Y".equals(value);
    }
}
```

---

### 9.6 Temporal precision

Temporal fields sering menjadi sumber bug.

Java types:

```java
LocalDate
LocalTime
LocalDateTime
OffsetDateTime
ZonedDateTime
Instant
java.util.Date
java.sql.Timestamp
```

Database types:

```text
DATE
TIME
TIMESTAMP
TIMESTAMP WITH TIME ZONE
TIMESTAMP WITH LOCAL TIME ZONE
DATETIME
```

Risiko:

- Oracle `DATE` menyimpan date + time, bukan hanya date.
- MySQL `datetime` tidak sama dengan `timestamp`.
- PostgreSQL `timestamp with time zone` menyimpan instant normalized, bukan timezone original.
- Precision fractional seconds bisa 0/3/6/9 digits.
- Java nanosecond precision bisa dipotong database/JDBC.
- Time zone JVM, JDBC, DB session bisa berbeda.

Example bug:

```java
where event.createdAt == inputTime
```

Bisa gagal karena DB menyimpan microseconds, Java object punya nanoseconds, atau round-trip mengubah precision.

Better design:

```java
where createdAt >= :startInclusive
  and createdAt < :endExclusive
```

Untuk period query, hindari equality timestamp kecuali precision dikontrol.

---

### 9.7 LOB handling

LOB mapping:

```java
@Lob
@Column(name = "payload")
private String payload;
```

Atau:

```java
@Lob
private byte[] content;
```

Dialect/platform menentukan:

- CLOB/BLOB type,
- streaming vs materialized binding,
- locator handling,
- transaction requirements,
- lazy loading possibility,
- generated DDL,
- update behavior.

Failure modes:

- large CLOB loaded accidentally due to entity fetch,
- lazy LOB tidak benar-benar lazy tanpa enhancement/weaving,
- memory spike saat hydrating list entity,
- LOB update menyebabkan expensive storage behavior,
- Oracle LOB segment growth tidak dipahami.

Design rule:

> Jangan letakkan large LOB di entity yang sering dilist. Pisahkan metadata entity dan content entity/table jika access pattern berbeda.

Example:

```text
DocumentMetadata
- id
- fileName
- contentType
- size
- createdAt

DocumentContent
- id
- documentId
- blobContent
```

---

### 9.8 Quoting and reserved identifiers

Jika entity:

```java
@Entity
@Table(name = "user")
public class User { ... }
```

`user` bisa reserved word di beberapa database.

Provider bisa menghasilkan:

```sql
select u.id from user u
```

Yang gagal di database tertentu.

Solusi mungkin quote:

```java
@Table(name = "\"user\"")
```

atau global quoted identifiers.

Namun quoting punya trade-off:

- case sensitivity berubah,
- migration script harus konsisten,
- raw SQL harus quote juga,
- portability menurun.

Better design:

```java
@Table(name = "app_user")
```

Design rule:

> Hindari reserved keyword. Naming yang sedikit verbose lebih murah daripada quoted identifier production headache.

---

## 10. Naming Strategy and SQL Shape

### 10.1 Logical vs physical naming

Provider biasanya membedakan:

- logical name: nama dari entity/attribute mapping,
- physical name: nama final table/column di database.

Contoh:

```java
private String caseNumber;
```

Bisa menjadi:

```sql
case_number
```

melalui naming strategy.

### 10.2 Why naming strategy matters

Naming strategy memengaruhi:

- generated DDL,
- SQL generated,
- migration scripts,
- schema validation,
- native query,
- reporting query,
- DBA expectation,
- cross-service data contract.

Failure mode umum:

```text
Dev: Hibernate auto creates table case_file
Prod: migration created CASE_FILE
Oracle: unquoted uppercase behavior
PostgreSQL: lowercase quoted/unquoted behavior
Application: schema validation fails
```

### 10.3 Explicit naming for enterprise systems

Untuk enterprise/regulatory system, lebih aman explicit:

```java
@Entity
@Table(name = "case_file")
public class CaseFile {
    @Column(name = "case_no", nullable = false, length = 50)
    private String caseNo;
}
```

Daripada mengandalkan default naming provider, terutama jika:

- ada banyak service,
- ada migration tool,
- ada reporting DB,
- ada DBA review,
- ada audit/regulatory requirement,
- ada multi-provider concern.

---

## 11. Inheritance and SQL Generation

Inheritance mapping sangat memengaruhi SQL.

### 11.1 Single table

```java
@Inheritance(strategy = InheritanceType.SINGLE_TABLE)
@DiscriminatorColumn(name = "case_type")
```

SQL:

```sql
select *
from case_file
where case_type = ?;
```

Pros:

- simple query,
- no join for subclass fields.

Cons:

- nullable columns banyak,
- constraints sulit,
- table wide,
- discriminator dependency.

### 11.2 Joined

```java
@Inheritance(strategy = InheritanceType.JOINED)
```

SQL polymorphic bisa menjadi:

```sql
select
    c.id,
    c.case_no,
    c.case_type,
    a.extra_appeal_field,
    e.extra_enforcement_field
from case_file c
left join appeal_case a on a.id = c.id
left join enforcement_case e on e.id = c.id;
```

Pros:

- normalized,
- subclass-specific columns separated.

Cons:

- polymorphic query mahal,
- join explosion,
- insert membutuhkan multiple tables.

### 11.3 Table per class

Polymorphic query bisa menggunakan union:

```sql
select id, case_no, 'APPEAL' as dtype from appeal_case
union all
select id, case_no, 'ENFORCEMENT' as dtype from enforcement_case;
```

Usually risky for complex production querying.

Design rule:

> Jangan memilih inheritance mapping dari bentuk object model saja. Pilih berdasarkan query shape dan schema evolution.

---

## 12. Association Mapping and SQL Shape

### 12.1 Many-to-one is usually cheap and explicit

```java
@ManyToOne(fetch = FetchType.LAZY)
@JoinColumn(name = "assigned_officer_id")
private Officer assignedOfficer;
```

Column exists on owning table:

```sql
case_file.assigned_officer_id
```

Query by FK can be simple:

```sql
select *
from case_file
where assigned_officer_id = ?;
```

### 12.2 One-to-many can be expensive depending on ownership

Bidirectional:

```java
@OneToMany(mappedBy = "caseFile")
private List<Task> tasks;
```

Child owns FK:

```sql
task.case_file_id
```

Loading collection:

```sql
select *
from task
where case_file_id = ?;
```

Unidirectional one-to-many with join table can generate extra join table operations.

```java
@OneToMany
@JoinTable(name = "case_file_task")
private List<Task> tasks;
```

SQL might include:

```sql
insert into case_file_task (case_file_id, task_id) values (?, ?);
```

This may be correct, but often not what engineer expected.

### 12.3 Join fetch changes SQL cardinality

JPQL:

```jpql
select c
from CaseFile c
join fetch c.tasks
where c.id = :id
```

SQL:

```sql
select
    c.id,
    c.case_no,
    t.id,
    t.title
from case_file c
join task t on t.case_file_id = c.id
where c.id = ?;
```

If one case has 100 tasks, result set has 100 rows. Hibernate/EclipseLink reconstruct object graph from duplicated root rows.

Rule:

> Join fetch reduces round trips but can multiply rows.

---

## 13. Filters, Soft Delete, Tenant Conditions, and SQL Mutation

Provider-specific filters can modify SQL globally or per session.

Example conceptual Hibernate filter:

```java
@FilterDef(name = "tenantFilter", parameters = @ParamDef(name = "tenantId", type = String.class))
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
```

Generated SQL gets extra condition:

```sql
select *
from case_file
where tenant_id = ?
  and status = ?;
```

Soft delete annotation/condition might add:

```sql
where deleted = false
```

Risks:

- native query bypasses filters,
- direct JDBC bypasses filters,
- cache key may not include tenant/filter dimension if misconfigured,
- admin use case accidentally filtered,
- count query and data query mismatch,
- filter condition breaks index usage.

Design rule:

> ORM filters are convenience and safety layer, not necessarily the only security boundary. For high-risk tenant isolation, consider database-level controls too.

---

## 14. SQL Generated for Entity Graphs and Fetch Plans

Entity graph can alter what provider fetches.

```java
EntityGraph<CaseFile> graph = em.createEntityGraph(CaseFile.class);
graph.addAttributeNodes("applicant", "assignedOfficer");

Map<String, Object> hints = Map.of("jakarta.persistence.fetchgraph", graph);

CaseFile caseFile = em.find(CaseFile.class, id, hints);
```

Provider may generate SQL with joins:

```sql
select
    c.*,
    a.*,
    o.*
from case_file c
left join applicant a on a.id = c.applicant_id
left join officer o on o.id = c.assigned_officer_id
where c.id = ?;
```

Or provider may choose additional select depending mapping/provider settings.

Entity graph is not magic. It is a fetch plan hint/contract interpreted by provider.

Failure modes:

- graph too broad,
- graph ignored or interpreted differently,
- nested graph creates massive SQL,
- pagination + graph behavior surprising,
- graph hides N+1 in one path but not another.

---

## 15. SQL Parameter Binding

Generated SQL usually uses bind parameters:

```sql
select *
from case_file
where status = ? and created_at >= ?;
```

Provider binds values through JDBC:

```text
1 -> OPEN as enum/string/int depending mapping
2 -> Timestamp/Date/OffsetDateTime mapping depending type/dialect
```

### 15.1 Why binding matters

Binding affects:

- SQL injection safety,
- database query plan reuse,
- type inference,
- index usage,
- timestamp precision,
- enum representation,
- LOB streaming,
- null handling.

### 15.2 Null parameter issue

JPQL:

```jpql
where c.closedAt = :closedAt
```

If `closedAt` is null, SQL:

```sql
where closed_at = null
```

does not behave as expected in SQL. Provider may not rewrite it automatically.

Correct query shape:

```jpql
where c.closedAt is null
```

For dynamic filters:

```jpql
where (:status is null or c.status = :status)
```

But this can harm index usage in some databases. Better for high-performance query paths: build dynamic query with only needed predicates.

---

## 16. Dialect Mismatch: One of the Most Expensive Configuration Bugs

### 16.1 What is dialect mismatch?

Dialect mismatch occurs when provider thinks the database is one version/type, while actual database behaves differently.

Examples:

```properties
hibernate.dialect=org.hibernate.dialect.PostgreSQLDialect
```

but actual DB is Amazon Aurora PostgreSQL with version quirks.

Or:

```properties
hibernate.dialect=org.hibernate.dialect.OracleDialect
```

but actual DB version has different feature support.

Or old config:

```properties
hibernate.dialect=org.hibernate.dialect.MySQL5Dialect
```

used against MySQL 8/MariaDB modern version.

### 16.2 Symptoms

- Startup warning about dialect/version.
- Pagination SQL fails.
- Lock syntax invalid.
- Sequence query invalid.
- Boolean column type wrong.
- Schema validation mismatch.
- DDL generation wrong.
- Function not recognized.
- Generated SQL performs badly.
- Hibernate upgrade suddenly breaks old dialect class.

### 16.3 Root causes

- Copy-paste from old tutorials.
- Framework upgrade without dialect review.
- JDBC metadata blocked/incorrect.
- Database proxy reports generic metadata.
- Cloud database compatibility mode.
- Using H2 in tests and Oracle/PostgreSQL in prod.
- Mixed Hibernate versions through transitive dependencies.

### 16.4 Fix pattern

1. Confirm actual database product and version.
2. Confirm JDBC driver version.
3. Confirm provider version.
4. Read provider dialect documentation for that exact major version.
5. Remove obsolete explicit dialect if provider supports auto-detection reliably.
6. Or set explicit modern dialect if metadata detection is unreliable.
7. Run SQL generation regression tests.
8. Compare generated SQL for critical queries.
9. Test pagination, locking, sequence, boolean, temporal, LOB, and batch behavior.

---

## 17. Database-Specific Notes

### 17.1 Oracle

Important concerns:

- Sequence handling common.
- `DATE` includes time.
- `TIMESTAMP` precision matters.
- CLOB/BLOB storage can dominate tablespace.
- Pagination differs by version.
- Identifier case and quoting can surprise.
- `FOR UPDATE` has Oracle-specific options.
- `dual` may appear in sequence SQL.
- `NUMBER(1)` often used for boolean-like values.

Typical risks:

- sequence allocation mismatch,
- LOB memory/storage problems,
- timestamp equality bugs,
- generated DDL not matching DBA standards,
- long identifier name truncation in old constraints/indexes,
- schema/user confusion.

### 17.2 PostgreSQL

Important concerns:

- Native boolean and UUID support.
- `timestamp with time zone` semantics often misunderstood.
- `limit/offset` common, `fetch first` also supported in modern versions.
- JSON/JSONB provider-specific mapping often used.
- Sequence and identity both available.
- Case folding to lowercase for unquoted identifiers.

Typical risks:

- quoted mixed-case identifiers,
- enum type mismatch,
- JSON function portability,
- offset pagination slow for large pages,
- `timestamp with time zone` misunderstood as preserving timezone.

### 17.3 MySQL/MariaDB

Important concerns:

- Identity/auto-increment common.
- Boolean often tinyint.
- `datetime` vs `timestamp` matters.
- Charset/collation affects comparisons.
- InnoDB locking behavior and gap locks.
- JSON support differs by version/vendor.

Typical risks:

- batching limitation with identity,
- collation causing case-insensitive surprises,
- timezone conversion issue,
- lock range too wide due to missing index,
- MariaDB vs MySQL dialect confusion.

### 17.4 SQL Server

Important concerns:

- Identity common.
- Pagination requires order by for offset/fetch.
- Locking hints are database-specific.
- `datetime` precision limitations vs `datetime2`.
- `bit` for boolean.
- Schema handling important.

Typical risks:

- timestamp/rowversion confusion,
- lock hints not matching expectation,
- pagination without deterministic order,
- Unicode/non-Unicode column mismatch.

### 17.5 H2

H2 is useful for fast tests, but dangerous as production substitute.

Risks:

- SQL syntax compatibility mode not identical.
- Constraint behavior differs.
- Type behavior differs.
- Locking differs.
- Sequence/identity behavior differs.
- Function support differs.
- Query optimizer differs.

Rule:

> H2 can test simple repository logic, but not ORM/database correctness for production-critical behavior.

For serious persistence tests, use Testcontainers or equivalent real database environment.

---

## 18. Generated SQL and Database Optimizer

Provider generates SQL. Database optimizer chooses execution plan.

ORM controls:

- SQL shape,
- predicates,
- joins,
- selected columns,
- bind parameters,
- pagination syntax,
- lock clause,
- hints if configured.

Database controls:

- access path,
- join order,
- join algorithm,
- index usage,
- cardinality estimation,
- parallelism,
- plan cache,
- statistics.

A correct ORM query can still be slow because:

- missing index,
- stale DB statistics,
- bad cardinality estimate,
- parameter sniffing,
- poor join order,
- too many rows hydrated,
- wrong fetch strategy,
- low selectivity predicate,
- function on indexed column.

Example risky JPQL:

```jpql
where lower(c.caseNo) = lower(:caseNo)
```

SQL:

```sql
where lower(case_no) = lower(?)
```

This may prevent normal index usage unless function-based index exists.

Better options:

- normalize case at write time,
- use case-insensitive column/collation intentionally,
- add function-based index where supported,
- use database-specific type/index such as PostgreSQL `citext` if acceptable.

---

## 19. Query Shape Discipline

### 19.1 Select only what you need

Entity query:

```jpql
select c
from CaseFile c
where c.status = :status
```

Loads full entity columns and registers managed objects.

DTO projection:

```jpql
select new com.example.CaseSummary(c.id, c.caseNo, c.status)
from CaseFile c
where c.status = :status
```

Loads only needed columns.

For listing screens, DTO projection often better.

### 19.2 Avoid broad fetch by default

Bad:

```java
@ManyToOne(fetch = FetchType.EAGER)
private Applicant applicant;
```

Because every query of `CaseFile` now tends to drag applicant unless provider optimizes separately.

Better default:

```java
@ManyToOne(fetch = FetchType.LAZY)
private Applicant applicant;
```

Then explicitly fetch when needed.

### 19.3 Make query use-case explicit

For detail page:

```jpql
select c
from CaseFile c
left join fetch c.applicant
left join fetch c.assignedOfficer
where c.id = :id
```

For listing page:

```jpql
select new com.example.CaseListItem(
    c.id,
    c.caseNo,
    c.status,
    c.createdAt
)
from CaseFile c
where c.status = :status
order by c.createdAt desc, c.id desc
```

Different use cases deserve different query shapes.

---

## 20. SQL Generation and Batch Behavior

### 20.1 Batching requires compatible SQL shape

JDBC batching works when provider can execute same prepared statement shape repeatedly.

Good:

```sql
insert into case_file (case_no, status, version, id) values (?, ?, ?, ?)
insert into case_file (case_no, status, version, id) values (?, ?, ?, ?)
insert into case_file (case_no, status, version, id) values (?, ?, ?, ?)
```

Same SQL shape; batch possible.

Bad for batching:

- dynamic insert/update changes column set per row,
- identity ID requires immediate generated key retrieval,
- interleaved inserts across many entity types,
- flush too frequent,
- cascade graph creates mixed SQL order,
- provider settings disabled.

### 20.2 Dynamic update trade-off

Hibernate has provider-specific dynamic update behavior.

Concept:

```sql
update case_file set status = ? where id = ?
```

instead of:

```sql
update case_file set case_no = ?, status = ?, priority = ?, version = ? where id = ?
```

Pros:

- fewer columns updated,
- useful for wide tables.

Cons:

- more SQL statement shapes,
- worse statement cache/batch reuse,
- more query plan variants,
- can complicate optimistic locking/update consistency.

Rule:

> Dynamic SQL optimization should be driven by evidence, not enabled globally as default superstition.

---

## 21. SQL Generation and Optimistic Locking

With versioned entity:

```java
@Version
private long version;
```

Update SQL usually includes old version:

```sql
update case_file
set status = ?, version = ?
where id = ? and version = ?;
```

Delete SQL:

```sql
delete from case_file
where id = ? and version = ?;
```

Provider checks affected row count.

If zero:

```text
Entity was modified/deleted by another transaction or version mismatch exists.
```

Failure modes:

- bulk JPQL update bypasses version handling unless explicitly managed/provider feature used,
- native SQL update does not increment version,
- detached entity overwrite,
- manual DB patch creates version inconsistency,
- trigger updates data but not version.

Design rule:

> If an entity is versioned, every write path must respect the version contract, including native SQL, batch jobs, admin scripts, and integrations.

---

## 22. SQL Generation and Multi-Table Mutations

Some mappings require multiple SQL statements for one logical entity operation.

Examples:

- joined inheritance,
- secondary table,
- element collection,
- many-to-many join table,
- unidirectional one-to-many join table,
- orphan removal,
- cascade delete.

Entity:

```java
@Entity
@SecondaryTable(name = "case_file_detail")
public class CaseFile {
    @Id
    private Long id;

    @Column(name = "case_no")
    private String caseNo;

    @Column(table = "case_file_detail", name = "full_description")
    private String fullDescription;
}
```

Insert might generate:

```sql
insert into case_file (case_no, id) values (?, ?);
insert into case_file_detail (full_description, id) values (?, ?);
```

Update description only:

```sql
update case_file_detail
set full_description = ?
where id = ?;
```

Understanding this matters for:

- transaction cost,
- constraint design,
- trigger behavior,
- audit trail,
- replication,
- deadlock analysis.

---

## 23. Native Query Does Not Remove ORM Responsibility

Native query:

```java
em.createNativeQuery("""
    update case_file
    set status = 'CLOSED'
    where closed_at < ?
    """)
  .setParameter(1, cutoff)
  .executeUpdate();
```

Risks:

- persistence context stale,
- version not incremented,
- entity listeners not called,
- second-level cache stale,
- provider filters bypassed,
- tenant conditions forgotten,
- soft delete conditions forgotten,
- database portability lost.

After native bulk mutation, you may need:

```java
em.clear();
```

or cache eviction/provider-specific synchronization.

Design rule:

> Native SQL is valid engineering tool, but it must be treated as a lower-level write path with explicit synchronization responsibility.

---

## 24. Observing Generated SQL

### 24.1 Development logging

Hibernate typical dev settings:

```properties
hibernate.show_sql=false
hibernate.format_sql=true
hibernate.highlight_sql=true
hibernate.use_sql_comments=true
```

Prefer logging categories over `show_sql` in serious applications.

Conceptual logging categories:

```text
org.hibernate.SQL
org.hibernate.orm.jdbc.bind
org.hibernate.stat
```

Be careful: exact logger names vary by Hibernate version.

### 24.2 EclipseLink logging

EclipseLink has logging levels and categories via properties such as SQL logging level.

Conceptual:

```properties
eclipselink.logging.level.sql=FINE
eclipselink.logging.parameters=true
```

Do not enable bind parameter logging in production without PII/security review.

### 24.3 SQL observability requirements

For production-grade systems, capture:

- endpoint/use case,
- correlation ID,
- transaction boundary,
- SQL count,
- total DB time,
- slow query SQL shape,
- bind values carefully redacted or classified,
- row count,
- flush timing,
- connection acquisition time,
- exception SQL state/error code.

You need to answer:

```text
Which user action generated this SQL?
Which ORM query/entity operation generated it?
How many times did it run?
How many rows did it return?
Was it caused by lazy loading, flush, or explicit query?
Which transaction did it belong to?
```

---

## 25. Practical Diagnostic Checklist

When SQL generated looks wrong or slow, ask in this order:

### 25.1 Mapping

- Is entity mapped to the expected table?
- Are columns explicitly named?
- Is association ownership correct?
- Is inheritance strategy causing joins/unions?
- Is collection mapping causing join table operations?
- Is enum/boolean/temporal type mapped correctly?

### 25.2 Query

- Is JPQL path creating implicit joins?
- Is fetch join multiplying rows?
- Is pagination deterministic?
- Is projection more appropriate than entity loading?
- Is Criteria builder accidentally adding duplicate joins?
- Is native query bypassing filters/version/cache?

### 25.3 Provider

- Which Hibernate/EclipseLink version?
- Did migration change query engine/type system/dialect?
- Are provider-specific annotations involved?
- Are filters enabled?
- Is enhancement/weaving active?
- Are SQL comments/statistics available?

### 25.4 Dialect/database

- Is dialect correct for database product/version?
- Is JDBC driver correct?
- Is database metadata detected correctly?
- Does database support generated syntax?
- Are functions portable?
- Is lock syntax supported?
- Is pagination syntax supported?
- Are timestamp/LOB/boolean types correct?

### 25.5 Execution plan

- Is index used?
- Are statistics fresh?
- Is cardinality estimate wrong?
- Is bind parameter type causing implicit cast?
- Is function wrapping indexed column?
- Is offset pagination scanning too much?

---

## 26. Production Failure Modes

### 26.1 Wrong dialect causes invalid SQL

Symptom:

```text
SQLSyntaxErrorException near "fetch first"
```

Possible root cause:

- database version doesn't support syntax,
- wrong dialect,
- outdated provider,
- compatibility mode mismatch.

Fix:

- confirm DB version,
- confirm dialect docs,
- update provider/dialect config,
- add integration test with real DB.

---

### 26.2 Pagination returns unstable results

Symptom:

```text
User sees duplicate/missing items between pages.
```

Root cause:

```jpql
select c from CaseFile c where c.status = :status
```

with pagination but no deterministic order.

Fix:

```jpql
select c
from CaseFile c
where c.status = :status
order by c.createdAt desc, c.id desc
```

---

### 26.3 Query slow after provider upgrade

Symptom:

```text
Hibernate 5 -> 6 migration causes different SQL shape.
```

Possible root cause:

- new query engine,
- changed implicit join rendering,
- changed type binding,
- changed dialect behavior,
- old workaround now harmful.

Fix:

- SQL diff before/after upgrade,
- execution plan comparison,
- provider migration guide,
- query-specific regression tests.

---

### 26.4 Native query causes stale entity state

Symptom:

```java
CaseFile c = em.find(CaseFile.class, id);
run native update status = CLOSED;
assert c.getStatus() == CLOSED; // false
```

Root cause:

- persistence context still holds old managed object.

Fix:

- avoid mixing managed entity and native bulk update in same context,
- clear/refresh explicitly,
- evict second-level cache if needed,
- centralize bulk mutation behavior.

---

### 26.5 Timestamp filter misses rows

Symptom:

```text
Some records created at boundary time not returned.
```

Root cause:

- precision mismatch,
- timezone mismatch,
- inclusive end boundary,
- equality timestamp comparison.

Fix:

```sql
created_at >= :startInclusive
and created_at < :endExclusive
```

Also standardize DB/JVM timezone policy.

---

### 26.6 Boolean mapping mismatch

Symptom:

```text
Query returns no rows after migration Oracle <-> PostgreSQL.
```

Root cause:

- boolean represented as `Y/N`, `1/0`, native boolean, or `number(1)` inconsistently.

Fix:

- explicit converter/type,
- migration script validation,
- integration test against target DB.

---

### 26.7 Lock query blocks unexpectedly

Symptom:

```text
Endpoint hangs under concurrent access.
```

Root cause:

- pessimistic lock query uses non-indexed predicate,
- DB locks many rows/gaps,
- lock order inconsistent,
- timeout hint not applied as expected.

Fix:

- index predicate,
- deterministic lock ordering,
- explicit timeout verified on target DB,
- minimize locked transaction duration.

---

## 27. Design Rules

### Rule 1 — Treat generated SQL as part of your system design

Do not say:

```text
It is just ORM-generated SQL.
```

Say:

```text
This use case generates this SQL shape, with this index expectation, under this dialect.
```

---

### Rule 2 — Explicitly support your production database

Portability is useful, but production correctness requires knowing the actual target DB.

Document:

```text
Provider: Hibernate ORM 6.x/7.x or EclipseLink 4.x
Database: Oracle/PostgreSQL/MySQL/SQL Server + exact version
JDBC driver: version
Dialect/platform: configured/detected
Important provider settings
```

---

### Rule 3 — Prefer explicit mapping names in enterprise systems

Avoid relying too much on default naming if schema matters.

Explicit:

```java
@Table(name = "case_file")
@Column(name = "case_no", nullable = false, length = 50)
```

---

### Rule 4 — Pagination must have deterministic ordering

Always:

```jpql
order by c.createdAt desc, c.id desc
```

Not:

```jpql
select c from CaseFile c
```

with `setMaxResults`.

---

### Rule 5 — Fetch plan is query design

Do not rely on global `EAGER`. Design per use case:

- listing: DTO projection,
- detail: controlled fetch graph/join fetch,
- write command: load aggregate root minimally,
- report: native/materialized/read model if needed.

---

### Rule 6 — Native SQL needs synchronization policy

Every native/bulk write path must answer:

- Does it update version?
- Does it bypass entity listeners?
- Does it bypass tenant/soft-delete filters?
- Does it invalidate cache?
- Does it stale current persistence context?
- Does it preserve audit requirements?

---

### Rule 7 — Test generated SQL on real database for critical paths

Do not trust H2 for:

- locking,
- pagination edge behavior,
- timestamp precision,
- sequence/identity,
- JSON/LOB,
- dialect-specific function,
- concurrency,
- execution plan.

---

## 28. Anti-Patterns

### Anti-pattern 1 — “ORM means I do not need to understand SQL”

Wrong. ORM increases the need to understand SQL because SQL is now generated indirectly.

---

### Anti-pattern 2 — Copy-pasting dialect from old blog posts

Dialect classes and recommendations change across Hibernate versions.

Always check provider documentation for your major version.

---

### Anti-pattern 3 — Using EAGER to avoid LazyInitializationException

This changes SQL globally and usually creates performance problems.

Correct fix is transaction boundary/fetch plan design.

---

### Anti-pattern 4 — One generic repository query for all screens

Different screens need different query shapes.

```text
List page != detail page != export != dashboard != validation check
```

---

### Anti-pattern 5 — Native SQL without persistence context awareness

Native SQL is fine. Native SQL plus unmanaged stale ORM state is dangerous.

---

### Anti-pattern 6 — Generated DDL as production migration source of truth

Provider DDL can help tests/prototypes. Production schema should be managed through migration discipline.

---

## 29. Practice Scenarios

### Scenario 1 — Hidden join through JPQL path

Given:

```jpql
select c
from CaseFile c
where c.applicant.profile.riskLevel = :riskLevel
```

Questions:

1. What joins might be generated?
2. Which tables need indexes?
3. Is `applicant.profile` optional?
4. Should the query use explicit join for readability?
5. Would projection be better?

---

### Scenario 2 — Oracle timestamp bug

Given:

```java
query.setParameter("createdAt", LocalDateTime.now());
```

JPQL:

```jpql
where c.createdAt = :createdAt
```

Questions:

1. What precision does DB store?
2. What precision does Java object contain?
3. Is equality appropriate?
4. Should range query be used?
5. Is JVM/DB timezone policy documented?

---

### Scenario 3 — Hibernate upgrade changes SQL

Given:

```text
Hibernate 5.6 -> 6.6/7.x upgrade
```

A critical query becomes slower.

Checklist:

1. Capture SQL before/after.
2. Capture bind parameter types.
3. Compare execution plan.
4. Check dialect changes.
5. Check implicit join rendering.
6. Check pagination/limit syntax.
7. Check provider migration guide.
8. Add regression test.

---

### Scenario 4 — Native bulk update stale state

Given:

```java
CaseFile c = em.find(CaseFile.class, id);

em.createNativeQuery("update case_file set status = 'CLOSED' where id = ?")
  .setParameter(1, id)
  .executeUpdate();

return c.getStatus();
```

Question:

Why might return value still be old?

Answer:

Because `c` is already managed in first-level cache. Native SQL changed database row, but persistence context still contains old object state. Need refresh/clear or avoid mixing.

---

### Scenario 5 — Pagination with join fetch collection

Given:

```jpql
select c
from CaseFile c
left join fetch c.tasks
order by c.createdAt desc
```

with:

```java
setMaxResults(20)
```

Questions:

1. Does pagination apply to rows or root entities?
2. Can root rows be duplicated due to tasks?
3. Will provider warn or paginate in memory?
4. Should you use two-step query?

Possible better approach:

```text
Step 1: fetch page of CaseFile IDs.
Step 2: fetch details/tasks for those IDs.
```

---

## 30. Mini Case Study: Case Management Listing Page

### 30.1 Bad design

Entity:

```java
@Entity
public class CaseFile {
    @ManyToOne(fetch = FetchType.EAGER)
    private Applicant applicant;

    @OneToMany(mappedBy = "caseFile", fetch = FetchType.EAGER)
    private List<Task> tasks;

    @Lob
    private String fullDescription;
}
```

Query:

```java
em.createQuery("select c from CaseFile c where c.status = :status", CaseFile.class)
  .setParameter("status", CaseStatus.OPEN)
  .setMaxResults(50)
  .getResultList();
```

Potential SQL/result behavior:

- loads applicant for every case,
- loads tasks for every case,
- loads LOB maybe eagerly depending provider/enhancement,
- unstable pagination because no order,
- N+1 or cartesian explosion depending provider,
- memory spike,
- slow endpoint.

### 30.2 Better design

Entity mapping:

```java
@ManyToOne(fetch = FetchType.LAZY)
@JoinColumn(name = "applicant_id")
private Applicant applicant;

@OneToMany(mappedBy = "caseFile")
private List<Task> tasks = new ArrayList<>();
```

Listing query:

```jpql
select new com.example.CaseListItem(
    c.id,
    c.caseNo,
    c.status,
    c.priority,
    c.createdAt,
    a.displayName
)
from CaseFile c
join c.applicant a
where c.status = :status
order by c.createdAt desc, c.id desc
```

SQL shape:

```sql
select
    c.id,
    c.case_no,
    c.status,
    c.priority,
    c.created_at,
    a.display_name
from case_file c
join applicant a on a.id = c.applicant_id
where c.status = ?
order by c.created_at desc, c.id desc
fetch first ? rows only;
```

Index expectation:

```sql
-- conceptual
(status, created_at desc, id desc)
(applicant.id)
```

Tasks not loaded because listing only needs summary.

Detail page can have separate query:

```jpql
select c
from CaseFile c
left join fetch c.applicant
left join fetch c.assignedOfficer
where c.id = :id
```

Tasks can be loaded separately with paging/sorting:

```jpql
select t
from Task t
where t.caseFile.id = :caseId
order by t.createdAt desc, t.id desc
```

This is persistence design, not just query tuning.

---

## 31. Java 8–25 Compatibility Notes

### 31.1 Java 8 era

Typical stack:

```text
JPA 2.1/2.2
javax.persistence
Hibernate 5.x
EclipseLink 2.x
Java EE / Spring Framework / older app servers
```

Concerns:

- older dialect classes,
- older Java time support depending provider version,
- javax namespace,
- less advanced query engine,
- older bytecode enhancement/weaving setup,
- older JDBC drivers.

### 31.2 Java 11/17 era

Typical transition stack:

```text
Jakarta EE transition
Hibernate 5.6/6.x
EclipseLink 3.x/4.x
Spring Boot 2.x/3.x transition
```

Concerns:

- javax to jakarta namespace,
- provider major version migration,
- module/classpath issues,
- dialect changes,
- query behavior changes.

### 31.3 Java 21/25 era

Modern stack:

```text
Jakarta Persistence 3.x
Hibernate 6.x/7.x
EclipseLink 4.x
Spring Boot 3.x/4.x generation
Jakarta EE 10/11 generation
```

Concerns:

- modern Hibernate SQL AST/type system behavior,
- stronger alignment with Jakarta packages,
- JDK module/access rules,
- virtual threads may affect transaction/thread-bound context assumptions in frameworks,
- improved JVM performance does not fix bad SQL shape,
- provider compatibility with latest Java must be verified by version.

Rule:

> Java runtime upgrade and ORM provider upgrade are separate risks. Do not bundle them casually in one migration without SQL regression testing.

---

## 32. Reference Baseline

For this series, treat these as conceptual baselines:

- Jakarta Persistence 3.x defines the modern `jakarta.persistence` API line.
- Hibernate ORM 6/7 represents the modern Hibernate architecture with significant changes from Hibernate 5.
- EclipseLink 4.x represents the Jakarta EE 10 era provider line.
- Java 8 represents legacy enterprise baseline; Java 17/21/25 represent modern runtime baselines.

Always check exact provider documentation for the version used in your application.

---

## 33. Summary

SQL generation is the bridge between object model and database reality.

The most important mental models from this part:

1. ORM SQL generation is a compiler-like pipeline, not simple string generation.
2. Dialect/database platform is the backend translator for database-specific SQL.
3. JPA standardizes API semantics, not exact SQL text.
4. Hibernate and EclipseLink can both be compliant while generating different SQL.
5. Generated SQL is shaped by mapping, query, fetch plan, provider version, and dialect.
6. Pagination, locking, ID generation, temporal precision, LOB, boolean, UUID, and functions are dialect-sensitive.
7. Native SQL bypasses some ORM protections and must be synchronized consciously.
8. Provider upgrades can change SQL shape; treat them as behavior migrations, not just dependency updates.
9. Production-grade persistence engineering requires observing, testing, and designing around generated SQL.
10. The right question is not “What annotation do I need?” but “What SQL and database behavior will this mapping/query create?”

---

## 34. What Comes Next

Next part:

```text
08-mapping-strategy-beyond-annotation-memorization.md
```

The next part will go deeper into mapping decisions as long-term contracts:

- field vs property access,
- column precision/scale/length/nullability,
- enum strategy,
- temporal strategy,
- LOB strategy,
- JSON/XML columns,
- converters,
- provider-specific type systems,
- and how mapping choices affect SQL, correctness, migration, and production performance.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 6 — Flush Semantics: Action Queue and SQL Ordering](./06-flush-semantics-action-queue-sql-ordering.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 8 — Mapping Strategy Beyond Annotation Memorization](./08-mapping-strategy-beyond-annotation-memorization.md)

</div>