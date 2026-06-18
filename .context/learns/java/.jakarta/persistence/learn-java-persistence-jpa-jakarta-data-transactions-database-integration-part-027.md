# Part 027 — Performance Engineering for JPA/Hibernate

> Seri: `learn-java-persistence-jpa-jakarta-data-transactions-database-integration`  
> Rentang Java: 8 hingga 25  
> Fokus: JPA/Jakarta Persistence, Hibernate ORM, Spring Data JPA, Jakarta Data, transaction, database integration  
> Posisi: Part 027 dari 032

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kita ingin memiliki kemampuan untuk melihat performa persistence layer bukan sebagai kumpulan tips acak, tetapi sebagai sistem yang bisa diobservasi, dimodelkan, diukur, dan diperbaiki secara rasional.

Target utamanya:

1. Memahami bahwa performa JPA/Hibernate tidak hanya ditentukan oleh “SQL cepat atau lambat”, tetapi oleh kombinasi query count, row count, column count, network roundtrip, hydration cost, dirty checking, persistence context size, locking, index, cache, transaction boundary, dan database execution plan.
2. Bisa membedakan masalah performa yang bersumber dari:
   - ORM mapping,
   - fetch plan,
   - query design,
   - transaction design,
   - database index,
   - connection pool,
   - cache,
   - batch write,
   - serialization/API layer,
   - locking/concurrency.
3. Bisa membaca symptom produksi seperti 504, DB CPU spike, connection pool exhaustion, slow query, high lock wait, memory bloat, dan N+1 query sebagai sinyal dari struktur persistence yang salah.
4. Bisa memilih optimisasi yang tepat:
   - fetch join,
   - entity graph,
   - DTO projection,
   - batch fetching,
   - JDBC batching,
   - keyset pagination,
   - bulk update,
   - index tuning,
   - query rewrite,
   - cache,
   - read model,
   - denormalization,
   - native SQL.
5. Bisa membuat checklist review performa persistence layer untuk aplikasi enterprise besar.

Bagian ini bukan sekadar “cara membuat Hibernate lebih cepat”. Target yang lebih tinggi adalah: **mampu menjelaskan performa persistence layer dari first principles dan memilih trade-off dengan sadar**.

---

## 2. Mental Model Utama: Performance Is a Pipeline

Satu request yang “mengambil data dari database” sebenarnya melewati pipeline panjang:

```text
HTTP request
  -> Controller/API boundary
  -> Application service
  -> Transaction boundary
  -> Repository/query object
  -> EntityManager/Hibernate Session
  -> Persistence context
  -> Query translation / SQL generation
  -> JDBC driver
  -> Connection pool
  -> Database parser/planner/executor
  -> Index/table access
  -> Rows returned
  -> Network transfer
  -> JDBC ResultSet processing
  -> Entity hydration / DTO mapping
  -> Dirty checking bookkeeping
  -> JSON serialization / response mapping
  -> HTTP response
```

Kalau response lambat, penyebabnya bisa berada di salah satu atau beberapa titik pipeline ini.

Kesalahan umum adalah langsung menyalahkan database atau langsung menambah cache. Engineer senior harus bertanya:

- Berapa query yang dikirim?
- Berapa row yang dibaca database?
- Berapa row yang dikirim ke aplikasi?
- Berapa column yang diambil?
- Apakah entity di-hydrate padahal hanya butuh 5 field?
- Apakah persistence context membengkak?
- Apakah query terkena N+1?
- Apakah pagination menggunakan offset besar?
- Apakah count query lebih mahal daripada data query?
- Apakah index sesuai predicate dan sort?
- Apakah query menunggu lock?
- Apakah connection pool habis karena query lambat atau transaksi terlalu panjang?
- Apakah cache justru menyebabkan stale data atau invalidation storm?

JPA/Hibernate bukan black box. Ia adalah lapisan yang menerjemahkan object operation menjadi database operation. Performa memburuk ketika kita lupa bahwa lapisan object dan lapisan database memiliki cost model yang berbeda.

---

## 3. Performance Cost Model

### 3.1 Query Count

Query count adalah jumlah SQL statement yang dikirim ke database dalam satu use case.

Contoh buruk:

```text
1 query untuk 100 application
100 query untuk applicant profile
100 query untuk latest status
100 query untuk assigned officer
100 query untuk documents
```

Total: 401 query.

Walaupun setiap query hanya 2 ms, total latency bisa besar karena network roundtrip, database scheduling, JDBC processing, dan thread/connection occupation.

Masalah klasik query count:

- N+1 select.
- Lazy association di-loop.
- JSON serializer menyentuh lazy relation.
- View rendering memanggil getter entity.
- Mapping DTO manual yang memanggil repository per item.
- Permission check per row dengan query terpisah.

### 3.2 Row Count

Row count adalah jumlah row yang dibaca/diproses database dan/atau dikirim ke aplikasi.

Masalah row count:

- Filtering dilakukan di Java, bukan SQL.
- Query tanpa predicate tenant/status/date.
- Join menghasilkan cartesian multiplication.
- Fetch join collection pada listing besar.
- Offset pagination besar.
- Count query mahal.
- Report query membaca seluruh table tanpa partition/date filter.

### 3.3 Column Count

Column count sering diremehkan.

Jika entity memiliki kolom besar:

- `CLOB description`,
- `CLOB metadata`,
- `BLOB attachment`,
- JSON payload besar,
- serialized audit changes,

maka query `select e from Entity e` bisa mengambil terlalu banyak data meskipun UI hanya butuh `id`, `referenceNo`, `status`, dan `createdAt`.

Untuk listing/reporting, DTO projection sering lebih tepat daripada entity loading.

### 3.4 Network Roundtrip

Database bisa cepat mengeksekusi query, tetapi banyak roundtrip tetap mahal.

Contoh:

```text
Query execution: 1 ms
Network + JDBC + scheduling: 4 ms
Total per query: 5 ms
N+1 dengan 300 query = 1500 ms
```

N+1 bukan hanya masalah database CPU. Itu masalah roundtrip dan orchestration.

### 3.5 Hydration Cost

Hydration adalah proses mengubah row database menjadi object/entity Java.

Untuk entity, Hibernate perlu:

- membuat instance,
- mengisi field,
- membuat snapshot untuk dirty checking,
- memasukkan entity ke persistence context,
- menjaga identity map,
- mungkin membuat proxy/collection wrapper,
- menjalankan callback/listener tertentu.

Hydration 10 row tidak masalah. Hydration 100.000 entity dalam satu persistence context adalah masalah besar.

### 3.6 Dirty Checking Cost

Managed entity dipantau oleh persistence context. Saat flush, provider perlu mengetahui entity mana yang berubah.

Cost dipengaruhi oleh:

- jumlah managed entity,
- jumlah field,
- dirty tracking mode,
- bytecode enhancement atau snapshot comparison,
- cascade graph,
- collection changes,
- flush frequency.

Karena itu read-only listing besar yang memuat entity managed bisa boros walaupun tidak ada update.

### 3.7 Persistence Context Size

Persistence context adalah first-level cache sekaligus unit of work.

Semakin banyak entity managed:

- memory naik,
- dirty checking cost naik,
- flush makin berat,
- identity map makin besar,
- GC pressure naik,
- accidental updates makin mungkin,
- stale state setelah bulk operation makin sulit dikendalikan.

Batch job yang membaca/menulis jutaan row dengan satu `EntityManager` tanpa `clear()` adalah desain yang salah.

### 3.8 Lock Wait and Transaction Duration

Query lambat tidak selalu karena eksekusi query lambat. Bisa jadi query menunggu lock.

Penyebab umum:

- transaction terlalu panjang,
- external API call dilakukan di dalam transaction,
- batch update memegang lock terlalu lama,
- update parent/child tidak konsisten urutannya,
- index buruk menyebabkan update mengunci range lebih luas,
- hot row counter/quota.

Connection pool exhaustion sering merupakan efek lanjutan: thread menunggu DB, connection tertahan, request baru tidak dapat connection.

---

## 4. Measurement First: Jangan Optimisasi Berdasarkan Feeling

Optimisasi persistence harus berbasis bukti.

Minimal evidence yang harus dikumpulkan:

| Evidence | Pertanyaan yang Dijawab |
|---|---|
| SQL log terkontrol | SQL apa yang sebenarnya dikirim? |
| Query count per request | Apakah ada N+1? |
| Slow query log | Query mana yang lambat di DB? |
| Execution plan | Apakah index digunakan? |
| Rows examined/read | Apakah DB membaca terlalu banyak row? |
| Rows returned | Apakah aplikasi menerima terlalu banyak data? |
| Hibernate statistics | Berapa entity load/fetch/query/cache hit/flush? |
| Hikari metrics | Apakah connection pool penuh/menunggu? |
| DB lock wait/deadlock metrics | Apakah bottleneck concurrency? |
| JVM allocation/GC | Apakah hydration menyebabkan memory pressure? |
| Application tracing | Use case mana yang memicu query mahal? |

Tanpa evidence, “solusi” biasanya salah arah:

- menambah cache padahal query count N+1,
- menambah index padahal masalahnya hydration 200.000 entity,
- menaikkan connection pool padahal query lambat dan lock wait,
- mengganti database padahal fetch plan salah,
- menambah node aplikasi padahal bottleneck di DB lock.

---

## 5. SQL Logging yang Aman

SQL logging berguna, tetapi berbahaya jika sembarangan di production.

### 5.1 Development/Test

Di dev/test boleh aktifkan SQL log untuk memahami SQL generation.

Spring Boot contoh:

```properties
spring.jpa.show-sql=false
logging.level.org.hibernate.SQL=DEBUG
logging.level.org.hibernate.orm.jdbc.bind=TRACE
```

Catatan:

- `show-sql=true` biasanya kurang ideal karena output mentah ke stdout.
- Bind parameter trace sangat berguna, tetapi bisa membocorkan data sensitif.
- Jangan aktifkan bind parameter trace di production tanpa masking dan kontrol ketat.

### 5.2 Production

Di production, pendekatan lebih aman:

- gunakan slow query log database,
- gunakan APM/tracing dengan SQL fingerprint,
- gunakan sampling,
- gunakan query comments untuk korelasi use case,
- log query duration, bukan semua SQL full,
- masking parameter sensitif,
- aktifkan debug sementara hanya saat incident dan scoped.

Contoh Hibernate query comment:

```java
List<ApplicationSummary> result = entityManager
    .createQuery("""
        select new com.example.ApplicationSummary(
            a.id,
            a.referenceNo,
            a.status,
            a.createdAt
        )
        from Application a
        where a.status = :status
        order by a.createdAt desc
        """, ApplicationSummary.class)
    .setParameter("status", ApplicationStatus.SUBMITTED)
    .setHint("org.hibernate.comment", "ApplicationListingRepository.findSubmitted")
    .setMaxResults(50)
    .getResultList();
```

Tujuannya agar di DB slow query log terlihat query berasal dari use case mana.

---

## 6. Hibernate Statistics

Hibernate menyediakan statistics untuk melihat perilaku ORM.

Metrik yang penting:

- entity load count,
- entity fetch count,
- collection load count,
- collection fetch count,
- query execution count,
- query execution max time,
- flush count,
- session open/close count,
- transaction count,
- second-level cache hit/miss/put,
- query cache hit/miss/put,
- optimistic failure count.

Contoh konfigurasi:

```properties
spring.jpa.properties.hibernate.generate_statistics=true
logging.level.org.hibernate.stat=DEBUG
```

Jangan aktifkan sembarangan di production tanpa memahami overhead dan volume log. Lebih baik expose metrik melalui Micrometer/Actuator/APM jika tersedia.

Interpretasi contoh:

```text
Query execution count: 1
Entity load count: 1000
Collection fetch count: 1000
```

Kemungkinan besar:

- satu query mengambil 1000 parent entity,
- lalu 1000 lazy collection di-fetch satu per satu,
- N+1 collection problem.

Contoh lain:

```text
Query execution count: 3
Entity load count: 50000
Flush count: 1
```

Kemungkinan:

- query sedikit,
- tetapi hydration entity terlalu besar,
- perlu projection, pagination, streaming, atau chunking.

---

## 7. N+1 Query Problem: Diagnosis and Fix

### 7.1 Contoh N+1

```java
List<Application> applications = entityManager
    .createQuery("""
        select a
        from Application a
        where a.status = :status
        order by a.createdAt desc
        """, Application.class)
    .setParameter("status", ApplicationStatus.SUBMITTED)
    .setMaxResults(100)
    .getResultList();

for (Application application : applications) {
    System.out.println(application.getApplicant().getName());
}
```

Jika `applicant` lazy, maka terjadi:

```text
1 query for applications
100 queries for applicant
```

### 7.2 Fix 1: Fetch Join untuk To-One

```java
List<Application> applications = entityManager
    .createQuery("""
        select a
        from Application a
        join fetch a.applicant ap
        where a.status = :status
        order by a.createdAt desc
        """, Application.class)
    .setParameter("status", ApplicationStatus.SUBMITTED)
    .setMaxResults(100)
    .getResultList();
```

Fetch join cocok untuk association yang memang dibutuhkan oleh use case.

Untuk to-one association, fetch join relatif aman untuk pagination karena tidak menggandakan parent row seperti to-many collection.

### 7.3 Fix 2: DTO Projection

Untuk listing, projection sering lebih baik:

```java
List<ApplicationRow> rows = entityManager
    .createQuery("""
        select new com.example.ApplicationRow(
            a.id,
            a.referenceNo,
            a.status,
            ap.name,
            a.createdAt
        )
        from Application a
        join a.applicant ap
        where a.status = :status
        order by a.createdAt desc
        """, ApplicationRow.class)
    .setParameter("status", ApplicationStatus.SUBMITTED)
    .setMaxResults(100)
    .getResultList();
```

Keuntungan:

- tidak membuat entity managed,
- column lebih sedikit,
- tidak ada accidental lazy loading,
- cocok untuk read-only API.

### 7.4 Fix 3: Batch Fetching

Batch fetching berguna ketika beberapa lazy association akan diakses dan kita tidak ingin fetch join semua.

Contoh konfigurasi global:

```properties
spring.jpa.properties.hibernate.default_batch_fetch_size=50
```

Dengan batch fetching, akses 100 applicant tidak harus menjadi 100 query. Hibernate bisa mengambil dalam batch, misalnya 2 query masing-masing 50 id.

Trade-off:

- mengurangi N+1,
- tetapi tetap menghasilkan query tambahan,
- batch size terlalu besar bisa membuat `IN (...)` besar,
- tidak menggantikan fetch plan yang jelas.

### 7.5 Fix 4: Entity Graph

Entity graph berguna saat fetch plan berbeda per use case.

```java
EntityGraph<Application> graph = entityManager.createEntityGraph(Application.class);
graph.addAttributeNodes("applicant", "currentStatus");

List<Application> applications = entityManager
    .createQuery("""
        select a
        from Application a
        where a.status = :status
        order by a.createdAt desc
        """, Application.class)
    .setParameter("status", ApplicationStatus.SUBMITTED)
    .setHint("jakarta.persistence.fetchgraph", graph)
    .setMaxResults(100)
    .getResultList();
```

Entity graph membuat fetch plan lebih eksplisit tanpa mengubah JPQL join terlalu banyak.

---

## 8. Over-Fetching: Lawan dari N+1

Menghilangkan N+1 dengan fetch join semua association bisa menciptakan masalah baru: over-fetching.

Contoh buruk:

```java
select distinct a
from Application a
left join fetch a.applicant
left join fetch a.documents
left join fetch a.statusHistory
left join fetch a.comments
left join fetch a.auditEntries
where a.id = :id
```

Risiko:

- row multiplication,
- duplicate parent rows,
- memory besar,
- cartesian product,
- pagination rusak,
- DB CPU naik,
- network payload besar,
- serialization lambat.

Mental model:

```text
N+1 = terlalu banyak query kecil.
Over-fetching = terlalu sedikit query tetapi terlalu gemuk.
```

Optimisasi yang baik bukan selalu “kurangi jumlah query sebanyak mungkin”. Targetnya adalah **jumlah query, row, column, dan object yang sesuai kebutuhan use case**.

---

## 9. Entity Loading vs DTO Projection

### 9.1 Kapan Load Entity?

Load entity ketika:

- akan mengubah aggregate,
- butuh invariant domain,
- butuh dirty checking,
- butuh cascade/orphan removal,
- butuh optimistic locking,
- use case transactional write.

Contoh:

```java
@Transactional
public void approve(ApplicationId id, long expectedVersion, UserId officerId) {
    Application application = applicationRepository.findForUpdate(id)
        .orElseThrow(ApplicationNotFoundException::new);

    application.approve(expectedVersion, officerId);
    auditTrail.recordApproval(application, officerId);
    outbox.publishApplicationApproved(application);
}
```

### 9.2 Kapan DTO Projection?

Gunakan DTO projection ketika:

- listing,
- dashboard,
- search result,
- export,
- report,
- read-only detail tipis,
- API response tidak perlu lifecycle entity,
- ingin membatasi column,
- ingin mencegah lazy loading.

Contoh:

```java
public record ApplicationSearchRow(
    Long id,
    String referenceNo,
    String applicantName,
    String status,
    Instant submittedAt
) {}
```

```java
List<ApplicationSearchRow> rows = entityManager
    .createQuery("""
        select new com.example.ApplicationSearchRow(
            a.id,
            a.referenceNo,
            p.name,
            a.status,
            a.submittedAt
        )
        from Application a
        join a.applicant p
        where a.submittedAt >= :from
          and a.submittedAt < :to
        order by a.submittedAt desc, a.id desc
        """, ApplicationSearchRow.class)
    .setParameter("from", from)
    .setParameter("to", to)
    .setMaxResults(100)
    .getResultList();
```

DTO projection adalah salah satu alat performa paling penting dalam JPA.

---

## 10. Pagination Engineering

### 10.1 Offset Pagination

Offset pagination umum:

```sql
order by created_at desc
offset 10000 rows fetch next 50 rows only
```

Masalah:

- makin jauh page, makin mahal,
- database tetap harus melewati banyak row,
- hasil bisa berubah jika data baru masuk,
- count query bisa mahal.

Offset pagination cocok untuk:

- page kecil,
- admin UI sederhana,
- dataset tidak terlalu besar,
- user jarang ke page jauh.

### 10.2 Keyset Pagination

Keyset pagination memakai posisi terakhir:

```sql
where (created_at, id) < (:lastCreatedAt, :lastId)
order by created_at desc, id desc
fetch next 50 rows only
```

Dalam JPQL:

```java
List<ApplicationSearchRow> rows = entityManager
    .createQuery("""
        select new com.example.ApplicationSearchRow(
            a.id,
            a.referenceNo,
            p.name,
            a.status,
            a.submittedAt
        )
        from Application a
        join a.applicant p
        where a.status = :status
          and (
              a.submittedAt < :lastSubmittedAt
              or (a.submittedAt = :lastSubmittedAt and a.id < :lastId)
          )
        order by a.submittedAt desc, a.id desc
        """, ApplicationSearchRow.class)
    .setParameter("status", ApplicationStatus.SUBMITTED)
    .setParameter("lastSubmittedAt", cursor.submittedAt())
    .setParameter("lastId", cursor.id())
    .setMaxResults(50)
    .getResultList();
```

Keyset pagination cocok untuk:

- infinite scroll,
- large table,
- audit trail,
- activity feed,
- ordered queue,
- stable forward/backward navigation dengan cursor.

Syarat:

- order harus deterministic,
- gunakan tie-breaker unik seperti `id`,
- index harus sesuai predicate + order.

Contoh index:

```sql
create index idx_application_status_submitted_id
    on application (status, submitted_at desc, id desc);
```

### 10.3 Count Query Problem

Spring Data `Page<T>` biasanya memerlukan count query.

Untuk table besar, count bisa lebih mahal dari data query.

Alternatif:

- gunakan `Slice<T>` jika hanya butuh `hasNext`,
- gunakan keyset/cursor,
- gunakan estimated count,
- gunakan materialized summary,
- batasi fitur page jauh,
- precompute count per status/tenant jika perlu.

Jangan otomatis memakai `Page<T>` untuk semua listing.

---

## 11. Index Alignment with ORM Queries

Index bukan hanya “kolom yang sering dicari”. Index harus mengikuti bentuk query.

Contoh query:

```sql
select id, reference_no, status, submitted_at
from application
where tenant_id = ?
  and status = ?
  and submitted_at >= ?
  and submitted_at < ?
order by submitted_at desc, id desc
fetch next 50 rows only
```

Index yang masuk akal:

```sql
create index idx_app_tenant_status_submitted_id
    on application (tenant_id, status, submitted_at desc, id desc);
```

Pertimbangan:

- equality predicate biasanya di awal,
- range/order column setelah equality,
- tie-breaker order di akhir,
- index terlalu banyak memperlambat write,
- index untuk read model harus berdasarkan query nyata,
- composite index urutan kolom penting.

Kesalahan umum:

```sql
create index idx_app_status on application(status);
create index idx_app_submitted on application(submitted_at);
```

Dua single-column index belum tentu menggantikan composite index yang tepat untuk filter + order.

---

## 12. Query Plan Literacy

Engineer persistence harus bisa membaca execution plan dasar.

Pertanyaan utama saat membaca plan:

1. Apakah database melakukan full table scan?
2. Apakah full scan memang wajar karena mengambil mayoritas table?
3. Apakah index digunakan?
4. Apakah join order masuk akal?
5. Apakah estimated rows jauh dari actual rows?
6. Apakah sort terjadi di memory atau disk/temp?
7. Apakah ada hash join/nested loop yang tidak sesuai volume?
8. Apakah query menggunakan function pada indexed column sehingga index tidak efektif?
9. Apakah predicate sargable?
10. Apakah bind variable menyebabkan generic plan buruk?

Contoh predicate buruk:

```sql
where lower(reference_no) = lower(?)
```

Jika tidak ada function-based index, index `reference_no` mungkin tidak optimal.

Alternatif:

- simpan normalized reference,
- gunakan function-based index jika database mendukung,
- normalisasi input di aplikasi.

Contoh predicate buruk lain:

```sql
where trunc(created_at) = ?
```

Lebih baik:

```sql
where created_at >= ?
  and created_at < ?
```

---

## 13. JDBC Fetch Size vs JDBC Batch Size vs Batch Fetch Size

Tiga istilah ini sering tertukar.

### 13.1 JDBC Fetch Size

JDBC fetch size mengatur berapa row diambil driver dari database per network roundtrip saat membaca result set.

Relevan untuk:

- query besar,
- streaming result,
- export,
- report,
- batch read.

Contoh hint:

```java
Query query = entityManager.createQuery("""
    select a
    from Application a
    where a.createdAt < :cutoff
    order by a.id
    """, Application.class);

query.setParameter("cutoff", cutoff);
query.setHint("org.hibernate.fetchSize", 500);
```

Catatan:

- behavior fetch size sangat driver/database-specific,
- jangan anggap angka besar selalu lebih baik,
- ukur memory dan latency.

### 13.2 JDBC Batch Size

JDBC batch size mengatur berapa insert/update/delete dikirim sebagai batch write.

Konfigurasi Hibernate:

```properties
spring.jpa.properties.hibernate.jdbc.batch_size=50
spring.jpa.properties.hibernate.order_inserts=true
spring.jpa.properties.hibernate.order_updates=true
```

Relevan untuk:

- insert massal,
- update massal,
- batch job.

Tidak sama dengan fetch size.

### 13.3 Hibernate Batch Fetch Size

Batch fetch size mengoptimalkan lazy association/entity fetching.

```properties
spring.jpa.properties.hibernate.default_batch_fetch_size=50
```

Relevan untuk mengurangi N+1 lazy loading.

Ringkas:

| Setting | Arah | Masalah yang Disasar |
|---|---|---|
| JDBC fetch size | DB -> app read | result set besar |
| JDBC batch size | app -> DB write | banyak insert/update/delete |
| Hibernate batch fetch size | ORM lazy fetch | N+1 association/entity fetch |

---

## 14. Batching Writes

### 14.1 Insert Batching

Konfigurasi:

```properties
spring.jpa.properties.hibernate.jdbc.batch_size=50
spring.jpa.properties.hibernate.order_inserts=true
```

Loop:

```java
@Transactional
public void importApplications(List<ApplicationImportRow> rows) {
    int i = 0;

    for (ApplicationImportRow row : rows) {
        Application application = Application.fromImport(row);
        entityManager.persist(application);

        i++;
        if (i % 50 == 0) {
            entityManager.flush();
            entityManager.clear();
        }
    }
}
```

Tetapi transaction tunggal untuk ribuan row tetap berisiko. Untuk volume besar, gunakan chunk transaction.

### 14.2 Identifier Strategy Impact

`IDENTITY` generation sering menghambat batching karena id harus didapat setelah insert.

`SEQUENCE` dengan pooled optimizer biasanya lebih batch-friendly.

Untuk database seperti Oracle/PostgreSQL, sequence-based generator sering lebih cocok untuk high-volume insert.

### 14.3 Update Batching

```properties
spring.jpa.properties.hibernate.jdbc.batch_size=50
spring.jpa.properties.hibernate.order_updates=true
spring.jpa.properties.hibernate.jdbc.batch_versioned_data=true
```

Update batching efektif jika:

- SQL shape sama,
- flush dilakukan berkala,
- transaction chunk wajar,
- tidak memuat graph terlalu besar.

### 14.4 Bulk Update

Jika update tidak butuh entity lifecycle/cascade/callback:

```java
int updated = entityManager
    .createQuery("""
        update Application a
        set a.archived = true,
            a.archivedAt = :now
        where a.status in :terminalStatuses
          and a.updatedAt < :cutoff
        """)
    .setParameter("now", now)
    .setParameter("terminalStatuses", terminalStatuses)
    .setParameter("cutoff", cutoff)
    .executeUpdate();
```

Perhatian:

- bypass persistence context,
- tidak menjalankan entity callback biasa,
- entity managed bisa stale,
- version handling perlu dicek,
- audit/outbox harus dirancang eksplisit.

---

## 15. Read-Only Optimization

Untuk read-only use case, hindari membebani persistence context.

Pilihan:

1. DTO projection.
2. Read-only transaction.
3. Hibernate read-only query hint.
4. Stateless session untuk use case tertentu.
5. Clear persistence context setelah batch read.

Contoh hint:

```java
List<Application> applications = entityManager
    .createQuery("""
        select a
        from Application a
        where a.status = :status
        """, Application.class)
    .setParameter("status", ApplicationStatus.SUBMITTED)
    .setHint("org.hibernate.readOnly", true)
    .setMaxResults(1000)
    .getResultList();
```

Tetapi untuk listing, projection tetap lebih sering ideal.

Read-only bukan magic. Database tetap membaca data, network tetap mengirim row, dan aplikasi tetap memproses object.

---

## 16. Persistence Context Bloat

Gejala:

- memory naik selama request/batch,
- GC meningkat,
- flush lambat,
- response makin lama,
- OOM pada batch import/export,
- entity load count sangat besar.

Penyebab:

- membaca terlalu banyak entity managed,
- batch tanpa `clear()`,
- Open Session in View dengan graph besar,
- report memakai entity,
- streaming query tetapi entity tetap menumpuk di persistence context,
- cascade graph terlalu luas.

Mitigasi:

```java
int processed = 0;

for (Application application : applications) {
    process(application);
    processed++;

    if (processed % 100 == 0) {
        entityManager.flush();
        entityManager.clear();
    }
}
```

Untuk read-only export besar:

- gunakan DTO projection,
- streaming dengan fetch size,
- process row by row,
- hindari menyimpan semua result ke list,
- pertimbangkan JDBC/native SQL.

---

## 17. Transaction Duration and Connection Pool Performance

Connection pool bukan solusi untuk query lambat.

Jika transaction terlalu panjang:

```text
request starts
  -> transaction begins
  -> DB query
  -> external API call 3 seconds
  -> more DB update
  -> send email
  -> commit
```

Maka connection dan lock bisa tertahan selama external call.

Akibat:

- active connection meningkat,
- waiting thread meningkat,
- lock wait meningkat,
- timeout cascade,
- 504 di gateway/API,
- database terlihat penuh padahal akar masalah transaction boundary.

Prinsip:

- Jangan memanggil external API lambat di dalam transaction kecuali benar-benar dibutuhkan dan timeout kecil.
- Gunakan outbox untuk side effect setelah commit.
- Pecah use case menjadi state transition atomic + async side effect.
- Ukur transaction duration, bukan hanya query duration.

---

## 18. Connection Pool Metrics

Metrik penting:

| Metric | Makna |
|---|---|
| active connections | koneksi sedang dipakai |
| idle connections | koneksi siap pakai |
| pending/waiting threads | thread menunggu connection |
| connection acquisition time | waktu mendapat connection |
| usage duration | berapa lama connection dipakai |
| timeout count | gagal mendapat connection |
| leak detection | connection terlalu lama tidak dikembalikan |

Interpretasi:

```text
Active connections high
Waiting threads high
DB CPU low
```

Kemungkinan:

- thread memegang connection sambil menunggu external service,
- deadlock/lock wait,
- long transaction idle,
- connection leak,
- slow network.

```text
Active connections high
DB CPU high
Slow query high
```

Kemungkinan:

- query inefficient,
- index hilang,
- N+1/high query count,
- report query besar.

Jangan langsung menaikkan pool size. Pool lebih besar bisa memperburuk DB overload.

---

## 19. Cache as Performance Tool, Not Correctness Patch

Cache dapat membantu jika:

- data sering dibaca,
- data jarang berubah,
- stale data acceptable atau invalidation jelas,
- key design benar,
- authorization/tenant scope aman,
- metrics tersedia.

Cache buruk jika:

- query sebenarnya N+1,
- query tidak terindeks,
- invalidation tidak jelas,
- data sensitif bercampur tenant/role,
- cache digunakan untuk menutupi transaction design buruk,
- cache value terlalu besar,
- cache stampede tidak dikendalikan.

Performance hierarchy yang lebih sehat:

1. Benarkan query dan index.
2. Benarkan fetch plan/projection.
3. Benarkan pagination.
4. Benarkan transaction boundary.
5. Baru pertimbangkan cache.

Cache adalah optimisasi, bukan pengganti model data yang benar.

---

## 20. Serialization Layer Can Trigger Persistence Problems

Jika entity dikembalikan langsung sebagai API response:

```java
@GetMapping("/applications")
public List<Application> list() {
    return applicationRepository.findAll();
}
```

JSON serializer bisa menyentuh lazy association:

- `applicant`,
- `documents`,
- `statusHistory`,
- `comments`,
- bidirectional relationship infinite recursion.

Akibat:

- N+1 saat serialization,
- LazyInitializationException,
- response payload besar,
- sensitive data leak,
- recursive serialization,
- Open Session in View menjadi “solusi” palsu.

Solusi:

- gunakan DTO/response model,
- projection untuk listing,
- explicit fetch plan untuk detail,
- jangan expose entity langsung.

---

## 21. Case Study 1: Application Listing Lambat

### Symptom

Endpoint:

```text
GET /applications?status=SUBMITTED&page=0&size=50
```

Lambat 2–5 detik.

### Kemungkinan Penyebab

1. Query listing mengambil entity penuh dengan CLOB/JSON besar.
2. N+1 untuk applicant/officer/status.
3. Count query mahal.
4. Index tidak cocok dengan filter/sort.
5. Pagination offset jauh.
6. JSON serialization menyentuh relationship.

### Diagnosis

Cek:

- query count per request,
- generated SQL,
- entity load count,
- slow query log,
- execution plan,
- payload size,
- serialization time,
- count query duration.

### Perbaikan

Gunakan projection:

```java
public record ApplicationListingRow(
    Long id,
    String referenceNo,
    String applicantName,
    String status,
    String assignedOfficerName,
    Instant submittedAt
) {}
```

Query:

```java
List<ApplicationListingRow> rows = entityManager
    .createQuery("""
        select new com.example.ApplicationListingRow(
            a.id,
            a.referenceNo,
            applicant.name,
            a.status,
            officer.name,
            a.submittedAt
        )
        from Application a
        join a.applicant applicant
        left join a.assignedOfficer officer
        where a.tenantId = :tenantId
          and a.status = :status
        order by a.submittedAt desc, a.id desc
        """, ApplicationListingRow.class)
    .setParameter("tenantId", tenantId)
    .setParameter("status", ApplicationStatus.SUBMITTED)
    .setMaxResults(50)
    .getResultList();
```

Index:

```sql
create index idx_application_tenant_status_submitted_id
    on application (tenant_id, status, submitted_at desc, id desc);
```

Jika hanya butuh `hasNext`, ambil `size + 1` dan hindari count query.

---

## 22. Case Study 2: Detail Page Lambat Karena Over-Fetch

### Symptom

Detail application memuat:

- application data,
- applicant,
- documents,
- status history,
- comments,
- audit trail,
- correspondence.

Satu query fetch join semua collection menyebabkan ribuan row hasil join.

### Perbaikan

Bagi menjadi beberapa query sesuai section:

```text
Query 1: application + applicant + current status
Query 2: documents projection
Query 3: status history projection
Query 4: comments projection
Query 5: audit timeline projection, paginated
```

Ini bukan selalu lebih buruk dari satu query. Beberapa query kecil yang stabil sering lebih baik daripada satu cartesian monster query.

Prinsip:

```text
Detail page bukan berarti satu aggregate graph harus di-load sekaligus.
Detail page adalah komposisi beberapa read model.
```

---

## 23. Case Study 3: Batch Job Membuat DB CPU Spike

### Symptom

Scheduler archive berjalan malam hari, DB CPU 95%, aplikasi lain lambat.

Kode:

```java
List<Application> applications = applicationRepository.findEligibleForArchive(cutoff);
for (Application application : applications) {
    application.archive();
}
```

Masalah:

- load semua eligible entity ke memory,
- dirty checking ribuan entity,
- satu transaction besar,
- update row by row,
- lock lama,
- rollback besar jika gagal.

### Alternatif 1: Chunked Entity Processing

```java
while (true) {
    List<Long> ids = findNextEligibleIds(cutoff, 500);
    if (ids.isEmpty()) {
        break;
    }

    transactionTemplate.executeWithoutResult(status -> {
        List<Application> batch = applicationRepository.findByIds(ids);
        for (Application application : batch) {
            application.archive();
        }
        entityManager.flush();
        entityManager.clear();
    });
}
```

### Alternatif 2: Bulk Update

Jika tidak butuh entity lifecycle:

```java
int updated = entityManager
    .createQuery("""
        update Application a
        set a.archived = true,
            a.archivedAt = :now
        where a.status in :terminalStatuses
          and a.updatedAt < :cutoff
          and a.archived = false
        """)
    .setParameter("now", now)
    .setParameter("terminalStatuses", terminalStatuses)
    .setParameter("cutoff", cutoff)
    .executeUpdate();
```

Jika butuh audit/outbox, tulis desain eksplisit:

- insert audit dari selected ids,
- update application,
- insert outbox summary event,
- chunked transaction.

---

## 24. Case Study 4: Connection Pool Exhaustion

### Symptom

Hikari waiting threads naik, timeout mendapat connection, API 504.

Observasi:

- DB CPU sedang,
- slow query tidak banyak,
- active connection penuh,
- beberapa request duration 20–30 detik.

Kode:

```java
@Transactional
public void submitApplication(Command command) {
    Application application = applicationRepository.findById(command.id()).orElseThrow();
    application.submit();

    externalRiskService.check(application); // 10 seconds sometimes

    notificationService.sendSubmittedEmail(application);
}
```

Masalah:

- transaction dan connection terbuka selama external call/email.
- lock bisa tertahan.
- connection pool habis.

Perbaikan:

```java
@Transactional
public void submitApplication(Command command) {
    Application application = applicationRepository.findById(command.id()).orElseThrow();
    application.submit();

    outboxRepository.save(OutboxMessage.applicationSubmitted(application));
}
```

External risk check/email diproses async setelah commit oleh outbox publisher/consumer.

---

## 25. Anti-Pattern Performance JPA/Hibernate

### 25.1 `findAll()` untuk Listing Production

```java
repository.findAll();
```

Masalah:

- tanpa filter,
- tanpa limit,
- load entity penuh,
- memory bloat,
- accidental lazy loading.

### 25.2 Entity sebagai API Response

Masalah:

- lazy loading saat serialization,
- data leak,
- graph tidak terkendali,
- infinite recursion.

### 25.3 Fetch Join Semua Hal

Masalah:

- cartesian product,
- row duplication,
- memory besar,
- pagination rusak.

### 25.4 Count Semua Hal

Masalah:

- count query mahal,
- user sering hanya butuh `hasNext`,
- dashboard sebaiknya pakai summary/materialized model.

### 25.5 Cache Sebelum Query Benar

Masalah:

- menutupi N+1,
- invalidation sulit,
- stale data,
- tenant/authorization leakage.

### 25.6 Transaction Terlalu Panjang

Masalah:

- connection tertahan,
- lock tertahan,
- throughput turun,
- timeout cascade.

### 25.7 Bulk Update Tanpa Clear

Masalah:

- managed entity stale,
- data terlihat salah di memory,
- update berikutnya overwrite hasil bulk.

### 25.8 Menganggap H2 Sama dengan Production DB

Masalah:

- execution plan beda,
- locking beda,
- isolation beda,
- SQL dialect beda,
- pagination beda,
- index behavior beda.

Gunakan database nyata untuk performance/concurrency test.

---

## 26. Performance Review Checklist

Gunakan checklist ini saat review endpoint persistence-heavy.

### Query Shape

- [ ] Apakah query count per request diketahui?
- [ ] Apakah ada N+1?
- [ ] Apakah query mengambil entity atau projection?
- [ ] Apakah column yang diambil sesuai kebutuhan?
- [ ] Apakah ada CLOB/BLOB/JSON besar yang tidak perlu?
- [ ] Apakah filter dilakukan di SQL, bukan Java?
- [ ] Apakah sorting deterministic?
- [ ] Apakah pagination aman?

### Fetching

- [ ] Apakah fetch plan eksplisit per use case?
- [ ] Apakah to-one association yang dibutuhkan di-fetch dengan benar?
- [ ] Apakah to-many collection tidak di-fetch join sembarangan?
- [ ] Apakah batch fetching digunakan secara sadar?
- [ ] Apakah entity graph lebih cocok daripada query baru?

### Persistence Context

- [ ] Berapa entity load count?
- [ ] Apakah persistence context terlalu besar?
- [ ] Apakah read-only query memakai projection/hint?
- [ ] Apakah batch memakai flush/clear?
- [ ] Apakah bulk update membersihkan context?

### Database

- [ ] Apakah execution plan sudah dicek?
- [ ] Apakah index cocok dengan predicate dan order?
- [ ] Apakah estimated row vs actual row wajar?
- [ ] Apakah query menyebabkan sort/temp besar?
- [ ] Apakah ada lock wait/deadlock?

### Transaction

- [ ] Apakah transaction boundary sesingkat mungkin?
- [ ] Apakah external API call ada di dalam transaction?
- [ ] Apakah side effect memakai outbox?
- [ ] Apakah retry dilakukan di boundary yang aman?
- [ ] Apakah timeout diset?

### Connection Pool

- [ ] Apakah active/waiting connection dimonitor?
- [ ] Apakah pool exhaustion akar masalah atau gejala?
- [ ] Apakah leak detection ada?
- [ ] Apakah pool size sesuai kapasitas DB?

### Caching

- [ ] Apakah cache benar-benar diperlukan?
- [ ] Apakah key mencakup tenant/role/filter?
- [ ] Apakah invalidation jelas?
- [ ] Apakah stale data acceptable?
- [ ] Apakah cache hit ratio dimonitor?

---

## 27. Practical Tuning Order

Urutan tuning yang sehat:

1. Ukur baseline.
2. Identifikasi query count.
3. Hilangkan N+1.
4. Kurangi over-fetching dengan projection.
5. Perbaiki pagination.
6. Cek execution plan.
7. Tambahkan/perbaiki index.
8. Perpendek transaction.
9. Tuning batch/fetch size.
10. Evaluasi persistence context memory.
11. Pertimbangkan read model/materialized view.
12. Pertimbangkan cache.
13. Load test ulang.
14. Tambahkan alert/observability.

Jangan mulai dari step 12.

---

## 28. Production Observability Signals

Metrik minimal yang ideal:

### Application/JPA/Hibernate

- request duration per endpoint,
- query count per request,
- slow repository method,
- entity load count,
- collection fetch count,
- flush count,
- transaction duration,
- optimistic lock failure,
- second-level cache hit/miss,
- query cache hit/miss.

### Connection Pool

- active,
- idle,
- pending/waiting,
- acquisition time,
- usage time,
- timeout count.

### Database

- CPU,
- I/O,
- buffer/cache hit,
- slow query,
- top SQL,
- rows examined,
- lock wait,
- deadlocks,
- temp space,
- execution plan regression.

### JVM

- heap usage,
- allocation rate,
- GC pause,
- thread count,
- blocked/waiting threads,
- direct memory if driver/cache uses it.

---

## 29. Performance Testing Strategy

Performance test persistence harus realistis.

### Jangan hanya test happy path kecil

Test dengan:

- data volume production-like,
- realistic cardinality,
- realistic tenant distribution,
- realistic status distribution,
- large audit/document/history rows,
- concurrent users,
- background batch,
- slow external dependency simulation,
- realistic index.

### Gunakan Database Nyata

H2 tidak cukup untuk:

- execution plan,
- locking,
- transaction isolation,
- indexing,
- JSON/LOB behavior,
- sequence/identity behavior,
- dialect-specific pagination,
- deadlock behavior.

Gunakan Testcontainers atau environment khusus dengan database yang sama.

### Assertion yang Berguna

- max query count per use case,
- no N+1 regression,
- max response time under load,
- max DB CPU under scenario,
- max connection acquisition time,
- no lock timeout under expected concurrency,
- memory stable during batch.

Contoh pseudo-test query count:

```java
@Test
void listingShouldNotTriggerNPlusOne() {
    statistics.clear();

    applicationService.listSubmittedApplications(...);

    assertThat(statistics.getQueryExecutionCount())
        .isLessThanOrEqualTo(3);
}
```

---

## 30. Design Patterns for High-Performance Persistence

### 30.1 Command/Write Model + Projection Read Model

Write:

```text
Application aggregate -> optimistic locking -> audit/outbox -> commit
```

Read:

```text
ApplicationListingProjection -> direct query -> DTO -> API response
```

Jangan paksa satu entity graph melayani semua use case.

### 30.2 Query Object

```java
public final class ApplicationSearchQuery {
    private final TenantId tenantId;
    private final ApplicationStatus status;
    private final Instant submittedFrom;
    private final Instant submittedTo;
    private final Cursor cursor;
    private final int limit;
}
```

Repository method:

```java
ApplicationSearchResult search(ApplicationSearchQuery query);
```

Keuntungan:

- query parameter eksplisit,
- authorization/tenant predicate konsisten,
- pagination terkontrol,
- lebih mudah test.

### 30.3 Read Model Table

Untuk dashboard/report mahal:

```text
application_status_summary
- tenant_id
- status
- count
- oldest_submitted_at
- updated_at
```

Update via:

- scheduled refresh,
- materialized view,
- outbox event consumer,
- database job,
- CDC pipeline.

### 30.4 Database-Native Heavy Processing

Untuk operasi set-based besar, jangan selalu gunakan ORM.

Gunakan:

- bulk SQL,
- stored procedure jika governance mengizinkan,
- staging table,
- partition exchange,
- database-native export,
- ETL/CDC pipeline.

ORM ideal untuk lifecycle aggregate, bukan semua jenis data processing.

---

## 31. Decision Matrix

| Masalah | Solusi Awal | Solusi Lanjutan |
|---|---|---|
| N+1 to-one | fetch join/entity graph | projection |
| N+1 collection | batch fetch/subselect | separate query/read model |
| Listing lambat | DTO projection | keyset pagination/index |
| Count lambat | Slice/hasNext | summary/materialized view |
| Detail over-fetch | split read model | section lazy API |
| Batch insert lambat | JDBC batching | native load/staging table |
| Batch update lambat | chunking | bulk update/native SQL |
| Memory bloat | projection/clear | stateless/JDBC |
| Pool exhausted | shorten transaction | outbox/async boundary |
| DB CPU high | plan/index/query rewrite | read model/cache |
| Lock wait | shorter transaction | lock order/queue/partition |
| Report mahal | native SQL/view | materialized/warehouse |

---

## 32. Latihan / Scenario

### Scenario 1 — N+1 di Listing

Endpoint listing application lambat. Hibernate statistics menunjukkan:

```text
Query execution count: 151
Entity load count: 50
Entity fetch count: 100
Collection fetch count: 0
```

Pertanyaan:

1. Apa kemungkinan penyebabnya?
2. Association jenis apa yang mungkin memicu ini?
3. Apakah fetch join cocok?
4. Apakah DTO projection lebih baik?
5. Metrik apa yang perlu ditambahkan agar regression bisa dicegah?

### Scenario 2 — Count Query Mahal

Endpoint search memakai `Page<ApplicationRow>` dan query data hanya 40 ms, tetapi total endpoint 2 detik.

Pertanyaan:

1. Apa kemungkinan penyebabnya?
2. Bagaimana membuktikannya?
3. Apakah `Slice` cukup?
4. Kapan perlu materialized count?

### Scenario 3 — Batch Archive Membuat Lock Wait

Batch archive update 1 juta row dalam satu transaction.

Pertanyaan:

1. Apa risiko transaction tunggal?
2. Bagaimana chunking sebaiknya dilakukan?
3. Kapan bulk update lebih tepat?
4. Bagaimana audit/outbox dirancang?
5. Bagaimana retry aman dilakukan?

### Scenario 4 — Connection Pool Exhaustion

Hikari active 50/50, waiting tinggi, DB CPU 30%.

Pertanyaan:

1. Kenapa menaikkan pool size belum tentu benar?
2. Apa metrik tambahan yang dibutuhkan?
3. Bagaimana transaction duration memengaruhi pool?
4. Apa hubungan external API call dengan connection exhaustion?

### Scenario 5 — Detail Page dengan Banyak Collection

Detail page menggunakan fetch join ke 5 collection.

Pertanyaan:

1. Apa risiko row multiplication?
2. Bagaimana memecah query secara sehat?
3. Data mana yang harus dipaginasi?
4. Apakah entity graph menyelesaikan masalah?

---

## 33. Ringkasan

Performance engineering JPA/Hibernate bukan kumpulan trik. Ia adalah disiplin untuk memahami dan mengukur pipeline persistence dari request sampai database dan kembali lagi.

Poin utama:

1. Performa persistence ditentukan oleh query count, row count, column count, network roundtrip, hydration, dirty checking, persistence context, transaction duration, lock wait, index, dan serialization.
2. N+1 adalah masalah query count/roundtrip; over-fetching adalah masalah row/column/object volume.
3. Entity loading cocok untuk write use case dan aggregate lifecycle; DTO projection lebih cocok untuk listing/search/report.
4. Fetch plan harus dipilih per use case, bukan dibiarkan sebagai efek samping mapping entity.
5. Offset pagination tidak selalu cukup; keyset pagination lebih cocok untuk dataset besar dan feed/audit trail.
6. Index harus mengikuti predicate + order query nyata.
7. JDBC fetch size, JDBC batch size, dan Hibernate batch fetch size adalah tiga konsep berbeda.
8. Transaction terlalu panjang bisa menyebabkan connection pool exhaustion dan lock wait meskipun query tidak lambat.
9. Cache adalah optimisasi setelah query/fetch/index/transaction benar, bukan tambalan untuk desain persistence yang salah.
10. Performance harus dibuktikan dengan metrics, SQL, execution plan, tracing, dan test realistis.

Mental model terakhir:

```text
Fast persistence is not achieved by hiding the database.
Fast persistence is achieved by making object access, query shape, transaction boundary, and database execution model agree with each other.
```

---

## 34. Status Seri

Seri belum selesai.

Part saat ini: **Part 027 dari 032**.

Bagian berikutnya:

```text
Part 028 — Database-Specific Integration: Oracle, PostgreSQL, MySQL, SQL Server
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-persistence-jpa-jakarta-data-transactions-database-integration-part-026.md">⬅️ Part 026 — Database Integration Patterns: Outbox, Inbox, CDC, Idempotency</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-persistence-jpa-jakarta-data-transactions-database-integration-part-028.md">Part 028 — Database-Specific Integration: Oracle, PostgreSQL, MySQL, SQL Server ➡️</a>
</div>
