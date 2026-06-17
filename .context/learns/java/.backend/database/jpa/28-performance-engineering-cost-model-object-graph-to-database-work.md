# Part 28 — Performance Engineering: Cost Model from Object Graph to Database Work

> Seri: `learn-java-jpa-provider-hibernate-eclipselink-orm-engineering`  
> Part: 28 dari 34  
> File: `28-performance-engineering-cost-model-object-graph-to-database-work.md`

## 0. Tujuan Bagian Ini

Bagian ini membahas performa ORM dari sudut pandang **cost model**, bukan dari kumpulan tips acak seperti “pakai lazy”, “pakai batch size”, atau “jangan N+1”.

Di level advanced, pertanyaan yang benar bukan:

> “Hibernate lambat atau tidak?”

Pertanyaan yang benar adalah:

> “Untuk satu use case tertentu, berapa biaya yang diciptakan oleh keputusan object graph, fetch plan, persistence context, query shape, flush, batching, cache, transaction boundary, connection pool, dan database execution plan?”

ORM performance bukan satu variabel. Ia adalah hasil dari beberapa lapisan:

```text
HTTP / message / batch job
        |
Application service
        |
Transaction boundary
        |
Persistence context
        |
Entity graph / query / flush
        |
ORM provider: Hibernate / EclipseLink
        |
JDBC driver
        |
Connection pool
        |
Database parser / optimizer / executor
        |
Storage / memory / lock / redo / undo
```

Satu baris kode Java seperti:

```java
List<CaseFile> cases = caseRepository.findByStatus(Status.OPEN);
```

bisa berarti:

- satu query kecil,
- satu query besar,
- ratusan query lazy,
- join cartesian explosion,
- ribuan object allocation,
- persistence context memory bloat,
- flush otomatis sebelum query,
- connection tertahan terlalu lama,
- lock wait,
- atau cache hit yang sangat cepat.

Bagian ini akan memberi mental model untuk **menerjemahkan operasi ORM menjadi biaya konkret**.

---

## 1. Core Principle: ORM Performance Is Work Accounting

Performa tidak bisa ditingkatkan tanpa menghitung work.

Setiap operasi ORM menghasilkan kombinasi biaya:

| Lapisan | Bentuk Biaya | Contoh |
|---|---|---|
| Application | CPU Java | dirty checking, mapping DTO, hydration |
| JVM | allocation + GC | entity, proxy, collection wrapper, snapshot |
| ORM | metadata + SQL generation | query parsing, action queue, load plan |
| JDBC | network + resultset processing | round trip, fetch size, bind conversion |
| DB | CPU + IO | parse, optimize, execute, sort, join |
| DB concurrency | locks + waits | row lock, FK lock, deadlock, latch |
| Transaction | undo/redo/log | update/delete/insert volume |
| Cache | memory + invalidation | L1/L2/query cache correctness |

Advanced engineer tidak hanya bertanya:

> “Berapa lama endpoint ini?”

Tapi:

```text
Untuk request ini:
- berapa query dieksekusi?
- berapa round trip JDBC?
- berapa row DB dikirim?
- berapa column per row?
- berapa object Java dibuat?
- berapa entity masuk persistence context?
- berapa collection terinisialisasi?
- apakah flush terjadi?
- apakah dirty checking memindai entity yang tidak perlu?
- apakah SQL memakai index yang tepat?
- apakah pagination benar-benar membatasi kerja DB?
- apakah cache membantu atau menyembunyikan masalah?
- apakah transaction menahan connection terlalu lama?
```

ORM performance adalah **accounting discipline**.

---

## 2. The ORM Cost Equation

Untuk satu use case, biaya total bisa dipikirkan seperti ini:

```text
Total Cost =
    Query Count Cost
  + Round Trip Cost
  + Rows Read Cost
  + Columns Width Cost
  + Join Duplication Cost
  + Hydration Cost
  + Persistence Context Cost
  + Dirty Checking Cost
  + Flush Cost
  + JDBC Batching Cost / Saving
  + Cache Cost / Saving
  + Transaction Holding Cost
  + Database Execution Cost
  + Locking / Contention Cost
```

Tidak semua komponen muncul di semua use case. Tetapi model ini memaksa kita melihat bahwa performa ORM bukan hanya query count.

Contoh:

| Kasus | Query Count | Rows | Java Objects | DB Cost | Kesimpulan |
|---|---:|---:|---:|---:|---|
| N+1 kecil | 101 | 500 | sedang | sedang | round trip mahal |
| Join fetch besar | 1 | 500.000 duplicated rows | sangat besar | tinggi | query count bagus, total work buruk |
| DTO projection | 1 | 1.000 | rendah | sedang | cocok untuk read API |
| Entity load + L2 hit | 0/1 | rendah | sedang | rendah | cocok jika cache benar |
| Bulk update | 1 | affected banyak | rendah | tinggi DB-side | cepat tapi bypass entity lifecycle |

Prinsipnya:

> Query count rendah bukan jaminan performa baik. Query count tinggi hampir selalu tanda bahaya, tetapi memperbaikinya dengan join besar bisa menciptakan masalah yang lebih buruk.

---

## 3. Object Graph Cost: The Hidden Cost of “Convenient Domain Model”

ORM membuat object graph terlihat natural:

```java
caseFile.getApplicant().getProfile().getAddresses().get(0).getPostalCode();
```

Tetapi setiap edge dalam graph adalah potensi kerja database.

```text
CaseFile
  -> Applicant
      -> Profile
          -> Addresses
  -> Tasks
  -> Documents
  -> Correspondences
  -> AuditEntries
```

Pertanyaan performa:

```text
Untuk use case ini, graph mana yang benar-benar dibutuhkan?
```

Bukan:

```text
Entity ini punya relationship apa saja?
```

### 3.1 Entity Graph vs Use Case Graph

Entity graph adalah semua hubungan yang mungkin.

Use case graph adalah subset data yang diperlukan oleh satu operasi.

Contoh:

```text
Use case: tampilkan dashboard open case
Butuh:
- case id
- reference no
- status
- assigned officer name
- due date
- risk category

Tidak butuh:
- full applicant profile
- full document metadata
- correspondence body
- audit trail serialized changes
- task comments
```

Jika kita load `CaseFile` entity lengkap lalu serialize ke response, kita membayar biaya untuk bentuk domain, bukan kebutuhan use case.

### 3.2 Rule

Untuk read-heavy API:

```text
Read use case should define data shape explicitly.
```

Pilihan umum:

- DTO projection JPQL/Criteria.
- Native SQL projection untuk query kompleks.
- Read model table/view/materialized view.
- Entity graph jika tetap ingin entity tapi graph terbatas.
- Separate query per bounded section jika UI memang lazy per tab.

Entity loading cocok jika:

- data akan dimutasi,
- invariant domain perlu dijaga,
- graph kecil dan jelas,
- lifecycle entity diperlukan,
- optimistic locking dibutuhkan.

DTO/read model cocok jika:

- hanya membaca,
- response shape berbeda dari domain shape,
- query melibatkan aggregation,
- pagination penting,
- data volume tinggi,
- join kompleks.

---

## 4. Query Count Cost: Round Trips Are Expensive Even When Queries Are Fast

N+1 sering dibahas sebagai “terlalu banyak query”. Tapi masalah utamanya adalah **round trip multiplication**.

```text
1 query root
+ N query children
= N + 1 round trips
```

Setiap round trip membawa biaya:

- acquire connection,
- send SQL,
- bind parameter,
- DB parse/execute/fetch,
- network latency,
- JDBC result processing,
- ORM hydration,
- release/continue using connection.

Bahkan jika setiap query hanya 2 ms, 300 query bisa menjadi ratusan milidetik sampai detik karena serial dependency.

### 4.1 Query Count Budget

Untuk endpoint online, buat budget eksplisit:

```text
Simple lookup endpoint         : 1–3 SQL
Dashboard list                 : 1–5 SQL
Detail page with tabs          : 3–10 SQL, depending on sections
Complex report                 : explicit report query/read model
Batch processing per chunk     : bounded and measured
```

Ini bukan angka universal, tetapi membantu menolak desain yang diam-diam menghasilkan 400 query.

### 4.2 SQL Count Test

Untuk use case kritis, tulis test yang gagal jika query count naik drastis.

Pseudo-pattern:

```java
@Test
void dashboardQueryShouldNotGenerateNPlusOne() {
    statistics.clear();

    dashboardService.loadOpenCaseDashboard(pageRequest);

    long statements = statistics.getPrepareStatementCount();
    assertThat(statements).isLessThanOrEqualTo(5);
}
```

Catatan:

- Hibernate menyediakan statistics API.
- Untuk EclipseLink, profiler/logging dapat digunakan untuk observability query.
- Assertion angka harus realistis dan tidak terlalu brittle.

---

## 5. Rows Read Cost: The Database May Do Much More Work Than the App Sees

Satu query bisa terlihat sederhana:

```sql
select *
from case_file
where status = 'OPEN'
order by created_at desc
fetch first 50 rows only
```

Tetapi DB cost tergantung:

- index ada atau tidak,
- selectivity status,
- ordering column,
- cardinality statistics,
- predicate sargability,
- join order,
- sort/temp usage,
- row width,
- offset value.

ORM tidak menghapus kebutuhan memahami execution plan.

### 5.1 Rows Scanned vs Rows Returned

Performa buruk sering terjadi saat rows returned kecil tetapi rows scanned besar.

```text
Returned to app : 50 rows
Scanned by DB   : 3,000,000 rows
```

Dari sisi Java terlihat “hanya 50 entity”. Dari sisi DB, query mahal.

### 5.2 Index-Aligned Query Design

Query ORM harus didesain mengikuti index.

Contoh filter dashboard:

```text
where agency_id = ?
  and status = ?
  and deleted = false
order by created_at desc
limit 50
```

Index yang mungkin:

```sql
create index idx_case_dashboard
on case_file (agency_id, status, deleted, created_at desc);
```

Advanced engineer melihat query dan index sebagai satu desain, bukan dua tugas terpisah.

---

## 6. Column Width Cost: Selecting Entity Means Selecting Entity Shape

Ketika ORM load entity, provider biasanya mengambil kolom yang dibutuhkan untuk membangun entity.

Jika entity memiliki kolom besar:

- CLOB,
- BLOB,
- JSON besar,
- XML besar,
- serialized metadata,
- long description,

maka query entity bisa menjadi mahal meskipun jumlah row kecil.

Contoh buruk:

```java
List<AuditTrail> rows = em.createQuery("""
    select a
    from AuditTrail a
    where a.module = :module
    order by a.createdAt desc
""", AuditTrail.class)
.setMaxResults(50)
.getResultList();
```

Jika `AuditTrail` punya `serializedChanges`, `fullText`, `metadata` CLOB, listing page tidak seharusnya load entity penuh.

Lebih baik:

```java
public record AuditTrailRow(
    Long id,
    String module,
    String activity,
    String actor,
    Instant createdAt
) {}
```

```java
List<AuditTrailRow> rows = em.createQuery("""
    select new com.example.AuditTrailRow(
        a.id,
        a.module,
        a.activity,
        a.actor,
        a.createdAt
    )
    from AuditTrail a
    where a.module = :module
    order by a.createdAt desc
""", AuditTrailRow.class)
.setMaxResults(50)
.getResultList();
```

### 6.1 Rule

```text
Entity query is for behavior and mutation.
Projection query is for display and transfer.
```

Jika page hanya menampilkan 8 kolom dari entity 70 kolom, entity load kemungkinan salah.

---

## 7. Hydration Cost: Rows Become Objects, Objects Become Memory Pressure

Hydration adalah proses mengubah row JDBC menjadi object Java.

```text
ResultSet row
  -> JDBC value extraction
  -> type conversion
  -> entity instantiation
  -> field assignment
  -> proxy/collection wrapper creation
  -> persistence context registration
  -> snapshot creation
```

Biaya hydration meliputi:

- CPU conversion,
- allocation object,
- allocation array/snapshot,
- identity map entry,
- collection wrapper,
- proxy object,
- GC pressure.

### 7.1 Entity Hydration vs DTO Hydration

Entity hydration lebih mahal daripada DTO projection karena entity harus:

- masuk persistence context,
- memiliki identity guarantee,
- mungkin dibuat snapshot dirty checking,
- mungkin membentuk proxy/collection wrapper,
- ikut lifecycle event.

DTO projection:

- tidak managed,
- tidak dirty checked,
- tidak masuk identity map,
- lebih murah untuk read-only use case.

### 7.2 Hydration Explosion

```text
1 SQL with join fetch
returns 100,000 rows
but unique root entity only 1,000
```

ORM harus:

- membaca semua 100,000 row,
- deduplicate root entity,
- assemble collection,
- maintain persistence context identity,
- allocate intermediate state.

Satu query bukan berarti murah.

---

## 8. Join Duplication and Cartesian Explosion Cost

Join fetch sering dipakai untuk memperbaiki N+1.

Contoh:

```jpql
select c
from CaseFile c
join fetch c.tasks
join fetch c.documents
where c.status = :status
```

Jika satu case punya:

```text
10 tasks
20 documents
```

maka satu case bisa menghasilkan:

```text
10 × 20 = 200 rows
```

Untuk 100 case:

```text
20,000 result rows
```

Padahal logical data hanya:

```text
100 cases
1,000 tasks
2,000 documents
```

Join fetch lebih baik dari N+1 hanya jika multiplication factor terkendali.

### 8.1 Multiplication Formula

```text
Result rows ~= root rows × childA avg × childB avg × childC avg
```

Jika lebih dari satu to-many join difetch, segera hitung multiplication.

### 8.2 Better Patterns

Untuk multiple to-many collections:

```text
Option A: root query + batch fetch children
Option B: root query + separate child query per collection type
Option C: DTO projection flat per section
Option D: read model / materialized view
Option E: UI loads tabs separately
```

Contoh dua-step loading:

```java
List<CaseFile> cases = em.createQuery("""
    select c
    from CaseFile c
    where c.status = :status
    order by c.createdAt desc
""", CaseFile.class)
.setParameter("status", Status.OPEN)
.setMaxResults(50)
.getResultList();

List<Long> caseIds = cases.stream().map(CaseFile::getId).toList();

List<Task> tasks = em.createQuery("""
    select t
    from Task t
    where t.caseFile.id in :caseIds
""", Task.class)
.setParameter("caseIds", caseIds)
.getResultList();
```

Ini sering lebih predictable daripada satu join fetch besar.

---

## 9. Persistence Context Cost: Managed Objects Are Not Free

Persistence context memberi identity, dirty checking, write-behind, dan unit-of-work semantics.

Tetapi setiap managed entity menambah biaya:

```text
Managed Entity Cost =
    entity instance
  + EntityEntry / provider bookkeeping
  + loaded state snapshot
  + identity map entry
  + collection entries
  + proxy references
  + dirty checking scan cost
```

### 9.1 Large Persistence Context Smell

Bahaya:

```java
@Transactional
public void processAllCases() {
    List<CaseFile> all = caseRepository.findAll();
    for (CaseFile c : all) {
        process(c);
    }
}
```

Jika `findAll()` memuat 200,000 entity, persistence context bisa menjadi sangat besar.

Masalah:

- memory spike,
- GC pressure,
- dirty checking lambat,
- flush lambat,
- transaction panjang,
- connection ditahan lama,
- lock/undo pressure DB.

### 9.2 Chunked Processing Pattern

```java
int page = 0;
int size = 500;

while (true) {
    List<Long> ids = caseRepository.findNextIds(page, size);
    if (ids.isEmpty()) break;

    processChunk(ids);
    page++;
}
```

```java
@Transactional
public void processChunk(List<Long> ids) {
    List<CaseFile> cases = caseRepository.findByIdIn(ids);

    for (CaseFile c : cases) {
        c.recalculateRisk();
    }

    entityManager.flush();
    entityManager.clear();
}
```

Untuk high-volume job, sering lebih baik memakai keyset pagination daripada offset.

---

## 10. Dirty Checking Cost: Flush Time Depends on Managed State

Dirty checking biasanya terjadi saat flush.

Cost dipengaruhi oleh:

- jumlah managed entity,
- jumlah attribute per entity,
- jumlah collection managed,
- apakah bytecode enhancement aktif,
- apakah ada mutable types,
- apakah entity read-only,
- frekuensi flush.

### 10.1 Cost Model

Snapshot dirty checking kira-kira:

```text
Dirty Checking Cost ~= managed entities × properties checked
```

Jika ada 20,000 managed entity dengan 40 fields:

```text
800,000 comparisons per flush
```

Ini belum termasuk collection dirty checking.

### 10.2 Avoid Dirty Checking for Read-Only Use Cases

Hibernate punya opsi read-only query/session hints. EclipseLink juga punya query hints dan cache usage controls.

Contoh Hibernate hint via JPA:

```java
List<CaseSummary> result = em.createQuery(query, CaseSummary.class)
    .setHint("org.hibernate.readOnly", true)
    .getResultList();
```

Namun pilihan paling bersih untuk read-only endpoint tetap projection DTO.

### 10.3 Flush Frequency

Flush terlalu sering:

```java
for (CaseFile c : cases) {
    c.updateStatus(Status.CLOSED);
    entityManager.flush(); // buruk untuk batch umum
}
```

Lebih baik flush per chunk:

```java
int i = 0;
for (CaseFile c : cases) {
    c.updateStatus(Status.CLOSED);

    if (++i % 500 == 0) {
        entityManager.flush();
        entityManager.clear();
    }
}
```

---

## 11. Flush Cost: SQL Work Is Delayed, Not Removed

ORM menggunakan write-behind.

Artinya perubahan entity tidak langsung menjadi SQL sampai flush.

```text
entity.setStatus(CLOSED)
  -> mark dirty
  -> later flush
  -> generate update
  -> execute JDBC statement
```

Flush cost terdiri dari:

- dirty checking,
- action queue preparation,
- SQL ordering,
- batch grouping,
- JDBC execution,
- constraint checking,
- DB trigger/audit work,
- version update,
- cache invalidation.

### 11.1 Slow Commit Often Means Slow Flush

Banyak engineer melihat:

```text
transaction commit lambat
```

Padahal yang lambat adalah flush sebelum commit.

Diagnosis:

```text
- berapa entity managed?
- berapa entity dirty?
- berapa collection dirty?
- berapa SQL generated?
- apakah batching aktif?
- apakah update menyentuh indexed columns?
- apakah trigger DB berjalan?
- apakah FK constraint check mahal?
```

### 11.2 Flush Before Query Surprise

Flush mode AUTO bisa membuat query read memicu flush sebelum query.

```java
caseFile.setStatus(Status.CLOSED);

// Query ini dapat memicu flush agar query melihat state konsisten
long count = countOpenCases();
```

Akibat:

- read method terlihat lambat,
- constraint violation muncul sebelum commit,
- SQL update terjadi lebih awal dari yang diperkirakan.

---

## 12. JDBC Batching: Huge Win, But Easy to Accidentally Disable

Batching mengurangi round trip untuk DML.

Tanpa batching:

```text
insert 1
insert 2
insert 3
...
insert 1000
```

Dengan batching:

```text
send batch of 50
send batch of 50
...
```

### 12.1 Hibernate Common Settings

Contoh umum:

```properties
hibernate.jdbc.batch_size=50
hibernate.order_inserts=true
hibernate.order_updates=true
hibernate.jdbc.batch_versioned_data=true
```

Catatan:

- Nilai ideal perlu benchmark.
- `IDENTITY` generation sering menghambat insert batching karena ID harus didapat segera setelah insert.
- Sequence/pooled optimizer biasanya lebih batch-friendly.
- Ordering membantu mengelompokkan SQL sejenis.

### 12.2 EclipseLink Batch Writing

EclipseLink memiliki batch writing properties seperti:

```xml
<property name="eclipselink.jdbc.batch-writing" value="JDBC"/>
<property name="eclipselink.jdbc.batch-writing.size" value="100"/>
```

Untuk Oracle, provider/driver-specific mode bisa memberi benefit tambahan.

### 12.3 Batch Size Trade-Off

Batch terlalu kecil:

- round trip masih banyak.

Batch terlalu besar:

- memory bertambah,
- lock dipegang lebih lama,
- error handling lebih sulit,
- DB log burst,
- latency spike.

Rule praktis awal:

```text
Start with 25–100, measure, then tune.
```

---

## 13. JDBC Fetch Size: Streaming Rows vs Loading Too Much at Once

Fetch size menentukan bagaimana JDBC driver mengambil row dari database dalam batch internal.

Query yang mengembalikan 100,000 row bisa:

- mengambil semua sekaligus,
- atau fetch bertahap dari cursor,
- tergantung driver dan setting.

Contoh Hibernate property:

```properties
hibernate.jdbc.fetch_size=500
```

Atau per query:

```java
query.setHint("org.hibernate.fetchSize", 500);
```

Driver tertentu punya behavior khusus. Oracle misalnya punya row prefetch/default prefetch behavior.

### 13.1 Fetch Size Is Not the Same as ORM Batch Fetch

Jangan tertukar:

| Concept | Meaning |
|---|---|
| JDBC fetch size | berapa row ResultSet diambil driver per network fetch |
| ORM batch fetch | mengambil lazy association/entity untuk beberapa parent sekaligus |
| JDBC batch size | mengirim banyak DML statement dalam satu batch |

Ketiganya berbeda.

---

## 14. Pagination: Offset Is Simple, Not Always Cheap

Offset pagination:

```sql
order by created_at desc
offset 100000 rows fetch next 50 rows only
```

Masalah:

- DB tetap harus melewati banyak row,
- semakin dalam page semakin mahal,
- hasil bisa tidak stabil jika data berubah,
- butuh ordering deterministik.

### 14.1 Keyset Pagination

Keyset pagination memakai posisi terakhir.

```sql
where (created_at, id) < (?, ?)
order by created_at desc, id desc
fetch first 50 rows only
```

Dalam JPQL, tergantung provider/database, bisa ditulis sebagai predicate eksplisit:

```jpql
select c
from CaseFile c
where c.status = :status
  and (
       c.createdAt < :lastCreatedAt
       or (c.createdAt = :lastCreatedAt and c.id < :lastId)
  )
order by c.createdAt desc, c.id desc
```

Keyset cocok untuk:

- infinite scroll,
- processing job,
- timeline,
- event list,
- audit listing.

Offset masih cocok untuk:

- small dataset,
- admin page sederhana,
- kebutuhan jump-to-page,
- report dengan materialized result.

### 14.2 Pagination with Fetch Join Trap

Pagination root entity + fetch join to-many bisa bermasalah:

```jpql
select c
from CaseFile c
join fetch c.tasks
order by c.createdAt desc
```

Karena limit diterapkan pada row SQL, bukan logical root entity, atau provider harus melakukan in-memory handling.

Safer pattern:

```text
Step 1: page root IDs
Step 2: fetch details by IDs
Step 3: preserve original order in application
```

---

## 15. Projection Strategy: Do Not Hydrate Entities for Read Models

Projection adalah salah satu optimization paling kuat dan paling defensible.

### 15.1 Constructor Projection

```java
public record CaseDashboardRow(
    Long id,
    String referenceNo,
    String status,
    String officerName,
    Instant dueAt
) {}
```

```java
List<CaseDashboardRow> rows = em.createQuery("""
    select new com.example.CaseDashboardRow(
        c.id,
        c.referenceNo,
        c.status,
        o.name,
        c.dueAt
    )
    from CaseFile c
    join c.assignedOfficer o
    where c.status = :status
    order by c.dueAt asc
""", CaseDashboardRow.class)
.setParameter("status", Status.OPEN)
.setMaxResults(50)
.getResultList();
```

### 15.2 Projection Benefits

- fewer columns,
- no dirty checking,
- no entity lifecycle,
- less memory,
- clearer API contract,
- safer against accidental lazy loading,
- easier SQL count control.

### 15.3 Projection Weaknesses

- not suitable for mutation,
- can duplicate mapping logic,
- constructor queries can become verbose,
- refactoring field names requires test coverage,
- complex projection may be better as native SQL/read model.

---

## 16. Read Model vs Write Model

ORM entity is often a good write model.

But the best read model may be different.

```text
Write model:
CaseFile
  - Applicant
  - Tasks
  - Documents
  - Correspondences
  - AuditTrail

Read model:
CaseDashboardView
  - case_id
  - reference_no
  - applicant_name
  - latest_task_status
  - assigned_officer_name
  - risk_level
  - due_at
```

Trying to force one entity graph to serve all read screens leads to:

- EAGER relationships,
- giant join fetch queries,
- DTO assembled from many lazy calls,
- N+1,
- memory bloat,
- unclear ownership.

### 16.1 Practical Architecture

```text
Command side:
- Entity aggregate
- Invariant enforcement
- optimistic locking
- transaction boundary

Query side:
- DTO projection
- SQL view
- materialized view
- denormalized table
- search index
- reporting table
```

This does not require full CQRS architecture. It only requires admitting that **read shape and write shape are often different**.

---

## 17. Cache Performance: Cache Is a Correctness Feature With Performance Side Effects

Cache can improve performance, but can also hide stale data bugs.

### 17.1 First-Level Cache

Persistence context cache:

- always present,
- transaction/object identity scoped,
- guarantees same row maps to same object inside context,
- can cause stale read inside long context.

### 17.2 Second-Level Cache

L2 cache can reduce DB hits for:

- reference data,
- rarely changing lookup tables,
- natural ID lookup,
- stable master data.

Bad candidates:

- frequently updated rows,
- user-specific filtered data,
- tenant-sensitive data without strict isolation,
- large collections,
- volatile workflow state.

### 17.3 Query Cache

Query cache is often misunderstood.

It usually caches result identifiers, not magically a full arbitrary query result independent of invalidation.

Good candidates:

- stable query,
- small result set,
- low invalidation rate.

Bad candidates:

- dashboard changing every few seconds,
- large paginated search,
- tenant-specific dynamic filters,
- queries over frequently updated tables.

### 17.4 Cache Cost Model

```text
Cache benefit = saved DB work - cache lookup cost - invalidation cost - memory cost - correctness risk
```

If invalidation is frequent, cache can make system slower.

---

## 18. Connection Pool Interaction: ORM Can Starve the Pool Without Slow SQL

Connection pool exhaustion is not always caused by slow database.

It can be caused by:

- transaction boundary too wide,
- remote API call inside transaction,
- lazy loading during response serialization,
- long stream processing holding connection,
- connection acquired early,
- batch job monopolizing pool,
- lock wait.

### 18.1 Bad Pattern

```java
@Transactional
public CaseResponse submitCase(Command cmd) {
    CaseFile c = loadAndValidate(cmd);
    externalPaymentClient.charge(cmd.payment()); // remote call inside transaction
    c.submit();
    return mapper.toResponse(c);
}
```

Risk:

- DB transaction open while waiting for remote service,
- connection held,
- locks held,
- lower throughput,
- failure recovery complex.

### 18.2 Better Pattern

```text
Transaction 1:
- validate local state
- create pending operation
- commit

Remote call:
- outside DB transaction

Transaction 2:
- record result
- transition state idempotently
```

For regulatory/case systems, this also improves auditability.

---

## 19. Transaction Length: Latency Multiplies Contention

Long transactions are expensive because they hold:

- DB connection,
- row locks,
- undo/redo resources,
- persistence context memory,
- application thread,
- sometimes cache locks/invalidation state.

ORM makes long transactions tempting because object graph mutation feels local.

### 19.1 Transaction Boundary Rule

```text
A transaction should cover one consistent state transition, not one entire user journey.
```

Example:

```text
Bad:
Open case -> validate -> call API -> generate PDF -> send email -> update case -> commit

Better:
1. commit case transition to PROCESSING
2. async generate PDF
3. commit document attached
4. async send email
5. commit notification sent/failed
```

---

## 20. Database Execution Plan Still Wins

ORM can generate SQL, but DB executes SQL.

You still need:

- execution plan review,
- index design,
- statistics freshness,
- bind variable awareness,
- cardinality estimation,
- partition pruning if used,
- sort/temp monitoring,
- lock/wait analysis.

### 20.1 ORM Query Review Checklist

For each critical query:

```text
1. What SQL is actually generated?
2. What bind values are typical?
3. What execution plan is used?
4. How many rows scanned vs returned?
5. Is ordering supported by index?
6. Are joins selective early?
7. Are predicates sargable?
8. Is pagination efficient?
9. Are large columns avoided?
10. Is the result hydrated as entity or DTO?
```

### 20.2 Common ORM Query Anti-Patterns

| Anti-Pattern | Problem |
|---|---|
| `lower(column) = lower(?)` without function index | index may not be used |
| leading wildcard `like '%abc'` | often full scan |
| implicit joins everywhere | unexpected SQL complexity |
| filtering in Java after loading | DB work shifted to app badly |
| huge `IN` clause | parse/plan/memory issue |
| offset deep page | increasing DB work |
| selecting entity for report | hydration and memory bloat |

---

## 21. Java 8–25 Performance Considerations

### 21.1 Java 8 Legacy Context

Common reality:

- Hibernate 5.x,
- EclipseLink 2.x,
- `javax.persistence`,
- older JDBC drivers,
- older GC defaults,
- less efficient runtime compared to modern Java.

Performance implication:

- more careful with allocation,
- less benefit from modern JVM improvements,
- library upgrade constraints,
- less mature container/AOT integration.

### 21.2 Java 11/17 Modern Baseline

Common enterprise baseline:

- Jakarta transition may begin,
- Spring Boot 2/3 split,
- Hibernate 5/6 split,
- EclipseLink 3/4 split,
- better GC options.

### 21.3 Java 21/25 Modern Runtime

Benefits:

- improved JVM performance,
- better GC choices,
- virtual threads possibility in some application designs,
- modern container ergonomics.

Warning:

Virtual threads do not make DB connections infinite.

```text
More concurrent Java tasks != more database capacity.
```

If virtual threads allow 5,000 concurrent request handlers but HikariCP has 50 connections, the bottleneck simply moves to connection acquisition.

ORM performance still requires:

- bounded DB concurrency,
- backpressure,
- pool sizing,
- query budgets,
- transaction length discipline.

---

## 22. Hibernate Performance Engineering Notes

Hibernate documentation emphasizes fetching as a major performance factor. Hibernate also exposes controls for:

- fetch strategies,
- batch fetching,
- JDBC batching,
- second-level cache,
- query cache,
- statistics,
- statement inspection,
- read-only hints,
- bytecode enhancement,
- stateless sessions.

### 22.1 Hibernate Levers

| Lever | Use Case | Risk |
|---|---|---|
| join fetch | small bounded association | cartesian explosion |
| batch fetch | many lazy to-one/to-many | extra query but controlled |
| subselect fetch | load children for previous parent result | can surprise if parent result large |
| DTO projection | read API/report | not suitable for mutation |
| JDBC batch size | bulk DML | disabled by identity generator / wrong ordering |
| read-only query | large read-only entity load | provider-specific hint |
| StatelessSession | high-volume streaming/batch | bypasses normal persistence context semantics |
| L2 cache | stable reference data | stale/invalidation/tenant risk |

### 22.2 Hibernate Statistics You Should Watch

```text
- prepared statement count
- entity load count
- entity fetch count
- collection load count
- collection fetch count
- query execution count
- query execution max time
- second-level cache hit/miss/put
- flush count
- optimistic failure count
```

Interpretation examples:

```text
High entity fetch count relative to query count
=> likely lazy fetching / N+1

High collection fetch count
=> likely lazy collection N+1

High flush count
=> transaction/query boundary or manual flush issue

High L2 miss with high put
=> cache churn, poor cache candidate
```

---

## 23. EclipseLink Performance Engineering Notes

EclipseLink has its own performance model and optimization features:

- shared cache,
- batch reading,
- join fetching,
- fetch groups,
- query hints,
- batch writing,
- weaving/change tracking,
- performance profiler.

### 23.1 EclipseLink Levers

| Lever | Use Case | Risk |
|---|---|---|
| batch reading | avoid N+1 for relationships | provider-specific hint |
| join fetching | bounded association load | row multiplication |
| fetch groups | partial object loading | must understand partial entity semantics |
| shared cache | stable identity/reference data | stale data/isolation risk |
| batch writing | high-volume DML | driver/database-specific behavior |
| weaving | lazy/change tracking optimization | classloader/build complexity |
| profiler | query/session diagnosis | overhead if misused |

### 23.2 EclipseLink Shared Cache Warning

EclipseLink shared cache is powerful but can surprise teams coming from Hibernate defaults.

Always define:

```text
- which entities are cacheable,
- what isolation level is expected,
- tenant safety,
- invalidation strategy,
- whether native SQL can bypass cache awareness.
```

---

## 24. Performance Pattern Catalog

### 24.1 Pattern: ID Page Then Detail Fetch

Use when:

- paginating root entities,
- need controlled detail fetch,
- avoiding pagination + to-many join fetch issue.

```text
Query 1: select root IDs with pagination
Query 2: fetch root + required to-one associations
Query 3: fetch bounded child collections by root IDs
```

Pros:

- predictable row count,
- avoids cartesian explosion,
- stable pagination.

Cons:

- multiple queries,
- order restoration needed,
- more code.

### 24.2 Pattern: DTO for List, Entity for Command

```text
GET /cases       -> DTO projection
GET /cases/{id}  -> DTO/detail projection or limited entity graph
POST/PUT command -> load entity aggregate for mutation
```

Pros:

- avoids accidental graph loading,
- clear read/write semantics,
- reduces persistence context cost.

### 24.3 Pattern: Chunked Mutation

```text
while more IDs:
  open transaction
  load chunk
  mutate
  flush
  clear
  commit
```

Pros:

- bounded memory,
- bounded transaction time,
- failure recovery easier.

### 24.4 Pattern: Bulk SQL for Mechanical Updates

Use entity mutation when invariant/lifecycle matters.
Use bulk SQL when update is mechanical and lifecycle bypass is acceptable.

Example:

```jpql
update CaseFile c
set c.expired = true
where c.dueAt < :now
  and c.status = :status
```

But remember:

- persistence context stale afterward,
- entity listeners may not fire,
- optimistic version may not behave like entity update unless explicitly handled,
- cache invalidation must be considered.

### 24.5 Pattern: Read Model for Complex Dashboard

If dashboard query joins many workflow tables and aggregates latest state, use:

- database view,
- materialized view,
- denormalized table updated by event/job,
- search index.

Do not force aggregate root entity to become reporting engine.

---

## 25. Anti-Patterns

### 25.1 “Just Add EAGER”

Problem:

- global fetch cost,
- impossible to optimize per use case,
- hidden joins/selects,
- serialization explosion.

Better:

- lazy by default,
- explicit fetch plan per use case.

### 25.2 “One Repository Method for All Screens”

Problem:

- method accumulates joins,
- some screens over-fetch,
- others under-fetch,
- performance unpredictable.

Better:

- query per use case,
- separate list/detail/report queries.

### 25.3 “Entity as API Response”

Problem:

- lazy loading during serialization,
- recursion,
- leaking internal fields,
- accidental large graph,
- security risk.

Better:

- DTO boundary.

### 25.4 “Fix N+1 With Giant Join Fetch”

Problem:

- cartesian explosion,
- duplicate rows,
- memory spike,
- broken pagination.

Better:

- batch fetch,
- split queries,
- DTO projection.

### 25.5 “FindAll Then Filter in Java”

Problem:

- destroys DB selectivity,
- memory bloat,
- slow GC,
- app CPU spike.

Better:

- push filtering to DB,
- design index,
- paginate.

### 25.6 “Long Transaction Around Everything”

Problem:

- connection held,
- lock held,
- persistence context grows,
- throughput collapse.

Better:

- transaction per consistent state transition.

### 25.7 “Enable Cache Everywhere”

Problem:

- stale data,
- invalidation storm,
- memory pressure,
- tenant leakage risk.

Better:

- cache only stable, well-understood data.

---

## 26. Diagnostic Checklist: Slow Endpoint

When endpoint is slow, do not guess.

```text
1. What endpoint/use case is slow?
2. Is slowness p50, p95, p99, or max?
3. How many SQL statements per request?
4. Which SQL is slowest?
5. Which SQL is most frequent?
6. Are bind values captured safely?
7. How many rows returned per SQL?
8. How many rows scanned in DB plan?
9. Are entities or DTOs hydrated?
10. How many entities loaded?
11. How many collections loaded/fetched?
12. Did flush occur?
13. How many updates/inserts/deletes during flush?
14. Was connection acquisition slow?
15. Was DB waiting on lock, IO, CPU, or parse?
16. Was GC active during request?
17. Was cache hit/miss ratio abnormal?
18. Did recent deployment change query shape/mapping/fetch plan?
```

---

## 27. Diagnostic Checklist: High Database CPU

```text
1. Top SQL by CPU?
2. Top SQL by executions?
3. Top SQL by rows processed?
4. Did ORM create N+1?
5. Are queries missing selective predicates?
6. Are functions preventing index usage?
7. Are large joins multiplying rows?
8. Are reports using entity graph instead of projection?
9. Are batch jobs running during online peak?
10. Did schema statistics/indexes change?
11. Did provider/dialect upgrade change SQL?
```

---

## 28. Diagnostic Checklist: High Application CPU / GC

```text
1. How many objects allocated per request?
2. How many entities hydrated?
3. How many DTOs mapped?
4. How large is persistence context?
5. Is dirty checking scanning too many entities?
6. Are large LOB/JSON fields loaded?
7. Are collections initialized accidentally?
8. Is serialization walking entity graph?
9. Are equals/hashCode expensive or broken?
10. Is caching increasing memory pressure?
```

---

## 29. Diagnostic Checklist: Connection Pool Exhaustion

```text
1. Is acquisition time high?
2. Are SQL queries slow or transactions long?
3. Are remote calls inside transaction?
4. Are streaming responses holding connection?
5. Are batch jobs using same pool as online traffic?
6. Are lazy loads happening after service layer?
7. Is Open Session in View enabled?
8. Are lock waits holding connections?
9. Is pool size aligned with DB capacity?
10. Are virtual threads increasing concurrency beyond DB limit?
```

---

## 30. Performance Design Rules

### Rule 1: Define Query Shape Per Use Case

Do not let entity mapping accidentally define your API query shape.

### Rule 2: Prefer DTO Projection for Read-Heavy List Screens

Especially when:

- columns are few,
- entity is wide,
- relationships are many,
- pagination matters.

### Rule 3: Use Entity Loading for State Changes

Entities are best when:

- invariant matters,
- lifecycle matters,
- optimistic locking matters,
- aggregate mutation matters.

### Rule 4: Measure SQL Count and Row Count

Query count alone is insufficient. Always pair with row count and plan.

### Rule 5: Avoid Multiple To-Many Join Fetches

Treat every to-many join fetch as multiplication.

### Rule 6: Bound Persistence Context Size

Especially in batch jobs.

### Rule 7: Flush Intentionally

Know when flush happens and how much work it performs.

### Rule 8: Batch DML Where Semantically Safe

But verify ID strategy, ordering, and driver behavior.

### Rule 9: Cache Only With Correctness Model

No cache without invalidation and isolation story.

### Rule 10: Keep Transactions Short and Meaningful

A transaction should protect a state transition, not a whole workflow journey.

---

## 31. Example: Case Dashboard Performance Review

### 31.1 Bad Implementation

```java
@Transactional(readOnly = true)
public List<CaseDashboardResponse> loadDashboard() {
    return caseRepository.findByStatus(Status.OPEN)
        .stream()
        .map(c -> new CaseDashboardResponse(
            c.getId(),
            c.getReferenceNo(),
            c.getApplicant().getName(),
            c.getAssignedOfficer().getName(),
            c.getTasks().stream().filter(Task::isOpen).count(),
            c.getDocuments().size(),
            c.getLatestCorrespondence().getSubject()
        ))
        .toList();
}
```

Potential cost:

```text
1 query for cases
+ N applicant queries
+ N officer queries
+ N task collection queries
+ N document collection queries
+ N correspondence queries
+ entity hydration for everything
+ persistence context bloat
```

### 31.2 Better Implementation: Projection Query

```java
public record CaseDashboardRow(
    Long id,
    String referenceNo,
    String applicantName,
    String officerName,
    long openTaskCount,
    long documentCount,
    String latestCorrespondenceSubject
) {}
```

For complex aggregation, JPQL may become awkward. Native SQL or read model may be better.

```sql
select
    c.id,
    c.reference_no,
    a.name as applicant_name,
    o.name as officer_name,
    coalesce(t.open_task_count, 0) as open_task_count,
    coalesce(d.document_count, 0) as document_count,
    lc.subject as latest_correspondence_subject
from case_file c
join applicant a on a.id = c.applicant_id
left join officer o on o.id = c.assigned_officer_id
left join (
    select case_id, count(*) as open_task_count
    from task
    where status = 'OPEN'
    group by case_id
) t on t.case_id = c.id
left join (
    select case_id, count(*) as document_count
    from document
    group by case_id
) d on d.case_id = c.id
left join latest_correspondence_view lc on lc.case_id = c.id
where c.status = ?
order by c.due_at asc, c.id asc
fetch first 50 rows only
```

This is not “less object-oriented”. It is more honest: dashboard is a read model.

---

## 32. Example: Batch Closing Expired Cases

### 32.1 Entity-Based Approach

Use when closure has domain logic:

```java
@Transactional
public void closeExpiredCasesChunk(Instant now, int limit) {
    List<CaseFile> cases = em.createQuery("""
        select c
        from CaseFile c
        where c.status = :status
          and c.dueAt < :now
        order by c.id
    """, CaseFile.class)
    .setParameter("status", Status.OPEN)
    .setParameter("now", now)
    .setMaxResults(limit)
    .getResultList();

    for (CaseFile c : cases) {
        c.closeAsExpired(now);
    }

    em.flush();
    em.clear();
}
```

Pros:

- domain invariant enforced,
- entity listeners may run,
- optimistic version updated normally,
- audit logic can attach.

Cons:

- slower,
- hydration cost,
- dirty checking cost.

### 32.2 Bulk Update Approach

Use when update is mechanical:

```java
@Transactional
public int markExpired(Instant now) {
    int count = em.createQuery("""
        update CaseFile c
        set c.status = :expired,
            c.expiredAt = :now
        where c.status = :open
          and c.dueAt < :now
    """)
    .setParameter("expired", Status.EXPIRED)
    .setParameter("open", Status.OPEN)
    .setParameter("now", now)
    .executeUpdate();

    em.clear();
    return count;
}
```

Pros:

- fast,
- little Java memory,
- one SQL.

Cons:

- bypasses entity lifecycle,
- persistence context stale,
- audit/version/cache concerns,
- domain rules must be enforced elsewhere.

---

## 33. Practice Scenarios

### Scenario 1

A list endpoint returns 50 cases but executes 451 SQL statements.

Likely causes:

- lazy to-one N+1,
- lazy to-many N+1,
- DTO mapper accessing relationships,
- serializer walking entity graph.

Fix candidates:

- DTO projection,
- join fetch bounded to-one,
- batch fetch,
- entity graph,
- explicit query per section.

### Scenario 2

After replacing N+1 with join fetch, SQL count drops to 1 but endpoint becomes slower.

Likely causes:

- cartesian explosion,
- duplicate root rows,
- multiple to-many joins,
- memory pressure,
- large ResultSet.

Fix candidates:

- split query,
- ID page then child query,
- batch fetch,
- projection.

### Scenario 3

Commit takes 8 seconds even though business logic is fast.

Likely causes:

- slow flush,
- too many managed entities,
- dirty checking scan,
- many updates without batching,
- DB trigger/constraint/index overhead,
- lock waits.

Fix candidates:

- reduce persistence context size,
- chunk processing,
- enable batching,
- inspect generated DML,
- review DB waits.

### Scenario 4

Database CPU spikes after adding dashboard filters.

Likely causes:

- generated SQL changed,
- non-sargable predicate,
- missing composite index,
- lower/function on column,
- implicit join,
- offset deep pagination.

Fix candidates:

- capture SQL,
- explain plan,
- add proper index,
- rewrite query,
- use keyset pagination.

### Scenario 5

App memory spikes during nightly job.

Likely causes:

- loading too many entities,
- persistence context never cleared,
- large collections initialized,
- LOB fields loaded,
- batch size too large.

Fix candidates:

- process IDs in chunks,
- flush/clear,
- projection for read phase,
- stateless session/provider-specific bulk mode,
- avoid LOB load.

---

## 34. Top 1% Mental Model

A top-tier persistence engineer does not optimize randomly.

They can look at a use case and predict:

```text
This operation will:
- execute this many SQL statements,
- return this many rows,
- hydrate this many objects,
- keep this many objects managed,
- dirty check this much state,
- flush this many DML statements,
- hold connection for this long,
- stress this DB index/path,
- risk this cache/lock/failure mode.
```

That is the difference between using ORM and engineering with ORM.

---

## 35. Summary

ORM performance is not magic and not guesswork.

The essential model:

```text
Object graph decisions become SQL shape.
SQL shape becomes database work.
Database rows become Java objects.
Java objects become persistence context state.
Persistence context state becomes dirty checking and flush work.
Transaction boundaries determine how long resources are held.
Cache changes where work happens, not whether correctness matters.
```

The most important engineering habits:

1. Define data shape per use case.
2. Use projection for read-heavy screens.
3. Use entity aggregates for mutation/invariants.
4. Measure query count, row count, hydration count, and flush cost.
5. Avoid multiple to-many join fetches.
6. Bound persistence context size.
7. Use batching intentionally.
8. Keep transactions short.
9. Treat cache as a correctness decision.
10. Always inspect generated SQL and DB execution plan for critical paths.

Performance engineering with Hibernate/EclipseLink is not about memorizing provider knobs. It is about knowing exactly how object operations become database work.

---

## 36. References

- Jakarta Persistence 3.2 specification: https://jakarta.ee/specifications/persistence/3.2/
- Hibernate ORM documentation: https://hibernate.org/orm/documentation/
- Hibernate ORM User Guide: https://docs.hibernate.org/stable/orm/userguide/html_single/
- Hibernate fetching documentation: https://docs.hibernate.org/orm/6.4/userguide/html_single/
- EclipseLink project documentation: https://eclipse.dev/eclipselink/
- EclipseLink query hints: https://eclipse.dev/eclipselink/documentation/2.7/jpa/extensions/queryhints.htm
- EclipseLink performance features: https://eclipse.dev/eclipselink/documentation/2.6/solutions/performance001.htm
