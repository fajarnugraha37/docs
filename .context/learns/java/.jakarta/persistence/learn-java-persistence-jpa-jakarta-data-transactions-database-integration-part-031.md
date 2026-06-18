# Part 031 — Production Operations: Observability, Debugging, Tuning, and Incident Response

> Seri: `learn-java-persistence-jpa-jakarta-data-transactions-database-integration`  
> File: `learn-java-persistence-jpa-jakarta-data-transactions-database-integration-part-031.md`  
> Status seri: belum selesai — Part 031 dari 032  
> Target pembaca: Java engineer senior/staff yang ingin mampu mengoperasikan persistence layer production-grade, bukan hanya menulis mapping/query.

---

## 1. Tujuan Pembelajaran

Setelah mempelajari bagian ini, kamu diharapkan mampu:

1. Melihat persistence layer sebagai sistem operasional yang hidup di production, bukan hanya kode repository/entity.
2. Menghubungkan gejala aplikasi seperti 504, latency spike, connection exhaustion, deadlock, memory pressure, dan CPU DB spike ke mekanisme JPA/Hibernate/database yang mendasarinya.
3. Mendesain observability untuk persistence layer dengan metrik, log, trace, correlation id, SQL fingerprint, transaction context, dan database session correlation.
4. Membaca sinyal dari beberapa layer sekaligus:
   - HTTP/API layer,
   - service layer,
   - transaction layer,
   - JPA/Hibernate layer,
   - connection pool,
   - JDBC driver,
   - database engine,
   - infrastructure/network.
5. Menentukan apakah bottleneck berada di:
   - query count,
   - query plan,
   - connection pool,
   - lock wait,
   - transaction duration,
   - persistence context size,
   - garbage collection,
   - serialization,
   - external dependency,
   - migration/backfill/job.
6. Membuat incident response playbook untuk persistence-related incidents.
7. Melakukan tuning secara evidence-based, bukan berdasarkan feeling atau folklore.

Bagian ini sengaja tidak mengulang JDBC, HikariCP, transaction, isolation, locking, fetching, batching, dan testing secara penuh karena sudah dibahas di bagian sebelumnya. Fokus bagian ini adalah **operasi production dan incident reasoning**.

---

## 2. Mental Model: Persistence Layer sebagai Production Control Plane

Di development, persistence sering terlihat seperti ini:

```text
Repository method -> EntityManager -> Database
```

Di production, gambarnya jauh lebih kompleks:

```text
Client
  -> API gateway / load balancer
  -> servlet/reactive server thread atau virtual thread
  -> controller
  -> service/use case
  -> transaction interceptor
  -> EntityManager / Hibernate Session
  -> persistence context
  -> dirty checking / flush / query execution
  -> JDBC driver
  -> connection pool
  -> network path
  -> database listener / proxy
  -> database session
  -> SQL parser / optimizer
  -> buffer cache / storage / WAL/redo/undo
  -> locks / latches / MVCC / isolation mechanism
  -> response path kembali ke aplikasi
```

Maka ketika user melihat:

```text
504 Gateway Timeout
```

akar masalahnya bisa sangat berbeda:

1. Query lambat karena missing index.
2. Query cepat, tetapi menunggu lock.
3. Query cepat, tetapi connection pool habis.
4. Connection tersedia, tetapi network ke DB lambat.
5. Transaction menahan lock terlalu lama karena external API call di dalam transaction.
6. ORM melakukan N+1 query.
7. Fetch join menghasilkan row explosion.
8. Persistence context terlalu besar sehingga dirty checking dan GC meningkat.
9. Batch job membuat log/redo/undo/IO penuh.
10. Database CPU spike karena execution plan berubah.
11. Migration/backfill berjalan bersamaan dengan traffic.
12. Thread pool penuh karena request blocking menunggu DB.
13. Virtual threads banyak tetapi database tetap bottleneck di connection/session/lock.
14. Cache invalidation gagal sehingga aplikasi melakukan cache stampede.
15. Read replica lag menyebabkan retry/read-after-write loop.

Mental model penting:

> Persistence incident jarang bisa dianalisis dari satu layer saja. Kita perlu korelasi antara request, transaction, connection, SQL, DB session, lock, plan, dan resource.

---

## 3. Observability Stack untuk Persistence

### 3.1 Sinyal Utama

Production observability persistence minimal harus punya empat sinyal:

| Sinyal | Pertanyaan yang Dijawab |
|---|---|
| Latency | Operasi mana yang lambat? Lambat di aplikasi, pool, lock, query, atau commit? |
| Traffic | Berapa query/transaction/connection/request per detik? |
| Error | Error jenis apa? constraint, timeout, deadlock, connection, syntax, stale state? |
| Saturation | Resource mana yang penuh? pool, thread, CPU DB, IO, lock, memory, undo/redo, temp? |

Untuk persistence, empat sinyal itu perlu diperinci menjadi:

```text
API latency
Service latency
Transaction duration
Connection acquisition time
SQL execution time
Rows returned/affected
Flush count/time
Entity load count
Collection fetch count
Second-level cache hit/miss
Connection pool active/idle/pending
Database CPU/IO/session wait
Lock wait/deadlock
Commit/rollback count
Query timeout/deadline exceeded
```

### 3.2 Tidak Cukup Hanya Punya Slow Query Log

Slow query log penting, tetapi tidak cukup.

Contoh:

```text
Request /applications/search lambat 8 detik.
Slow query log tidak menunjukkan query > 1 detik.
```

Kemungkinan:

1. Ada 400 query kecil masing-masing 20 ms: total 8 detik.
2. Connection acquisition menunggu 7 detik, query hanya 100 ms.
3. Query menunggu lock tapi database tidak mengklasifikasikannya sebagai CPU-heavy query.
4. Serialization response memicu lazy loading tambahan.
5. Transaction commit lambat karena redo/WAL pressure.
6. Thread request tertahan sebelum mencapai repository.

Jadi observability harus menjawab:

```text
Where did the time go?
```

Bukan hanya:

```text
Which SQL was slow?
```

---

## 4. Layer-by-Layer Observability

## 4.1 API Layer

Yang perlu dicatat:

- route/template endpoint, bukan raw URL penuh,
- HTTP method,
- status code,
- latency,
- request size,
- response size,
- authenticated user/actor id jika aman,
- tenant/agency id jika relevan,
- correlation id,
- idempotency key jika ada,
- error category.

Contoh structured log:

```json
{
  "event": "http_request_completed",
  "correlationId": "c-20260616-001",
  "method": "POST",
  "route": "/applications/{id}/submit",
  "status": 409,
  "durationMs": 842,
  "tenantId": "CEA",
  "actorId": "u12345",
  "errorCategory": "OPTIMISTIC_CONFLICT"
}
```

Jangan log PII, token, cookie, raw payload, NRIC, credential, secret, atau dokumen sensitif.

## 4.2 Service / Use Case Layer

Service layer harus memberi konteks bisnis:

```json
{
  "event": "use_case_completed",
  "correlationId": "c-20260616-001",
  "useCase": "SubmitApplication",
  "applicationId": 123456,
  "fromStatus": "DRAFT",
  "toStatus": "SUBMITTED",
  "durationMs": 791,
  "transactional": true,
  "result": "CONFLICT"
}
```

Mengapa ini penting?

Karena SQL log seperti ini tidak cukup:

```sql
update application set status=?, version=? where id=? and version=?
```

Tanpa konteks use case, sulit tahu apakah update itu submit, approve, reject, cancel, assign, escalate, atau batch correction.

## 4.3 Transaction Layer

Metric/log penting:

- transaction duration,
- commit count,
- rollback count,
- rollback reason,
- timeout,
- propagation behavior,
- nested/REQUIRES_NEW usage,
- rollback-only state,
- external call inside transaction,
- number of SQL statements inside transaction,
- number of rows modified,
- lock wait encountered.

Contoh event:

```json
{
  "event": "transaction_completed",
  "correlationId": "c-20260616-001",
  "name": "ApplicationService.submit",
  "durationMs": 756,
  "outcome": "ROLLBACK",
  "rollbackReason": "OptimisticLockException",
  "sqlCount": 7,
  "flushCount": 1,
  "entitiesLoaded": 4,
  "entitiesUpdated": 1
}
```

Transaction duration adalah salah satu metrik terpenting karena long transaction dapat menyebabkan:

- lock lebih lama,
- connection lebih lama terpakai,
- undo/redo/WAL pressure,
- MVCC bloat pada beberapa database,
- stale reads,
- deadlock probability meningkat,
- timeout cascading.

## 4.4 JPA/Hibernate Layer

Yang perlu dipantau:

- session/entity manager open count,
- flush count,
- flush time,
- entity load count,
- entity fetch count,
- collection load/fetch count,
- query execution count,
- query execution max time,
- second-level cache hit/miss/put,
- query cache hit/miss/put,
- optimistic failure count,
- natural id cache metrics,
- JDBC statement prepare count,
- JDBC batch execution count.

Hibernate menyediakan statistics API dan metrik yang dapat diekspos ke observability system. Namun harus digunakan dengan bijak karena mengaktifkan metrik terlalu granular atau SQL logging berlebihan di production bisa menambah overhead.

Konsep penting:

```text
entityLoadCount tinggi     -> banyak entity di-hydrate
queryExecutionCount tinggi -> kemungkinan N+1 atau chatty repository
collectionFetchCount tinggi -> lazy collection triggering
flushCount tinggi         -> transaction boundary atau saveAndFlush misuse
secondLevelCacheMiss tinggi -> cache tidak efektif atau invalidation terlalu sering
optimisticFailureCount tinggi -> contention di aggregate/state transition
```

## 4.5 Connection Pool Layer

Metrik connection pool, terutama HikariCP, sangat penting:

| Metric | Interpretasi |
|---|---|
| active connections | Connection sedang dipakai request/job. |
| idle connections | Connection tersedia. |
| pending threads | Thread menunggu connection. |
| max pool size | Kapasitas pool. |
| connection acquisition time | Waktu tunggu sebelum dapat connection. |
| connection usage time | Berapa lama connection dipegang. |
| connection timeout count | Request gagal karena pool habis. |
| leak detection event | Connection dipinjam terlalu lama. |

Pola umum:

```text
active = max, idle = 0, pending naik
```

Artinya aplikasi tidak kekurangan thread; aplikasi kekurangan connection atau connection terlalu lama dipegang.

Kemungkinan penyebab:

1. Query lambat.
2. Lock wait.
3. Transaction terlalu panjang.
4. External call di dalam transaction.
5. Batch job mengambil semua connection.
6. Connection leak.
7. Pool terlalu kecil untuk traffic.
8. Pool terlalu besar sehingga database overload.

Penting:

> Menambah pool size bukan solusi universal. Pool lebih besar bisa memperparah DB CPU, lock contention, IO pressure, dan context switching database.

## 4.6 JDBC Driver / Network Layer

Yang perlu diperiksa:

- connect timeout,
- socket timeout,
- query timeout,
- DNS resolution,
- TLS handshake,
- network packet loss,
- database endpoint failover,
- stale connection,
- driver version,
- prepared statement cache,
- fetch size behavior,
- LOB streaming behavior.

Gejala network/JDBC sering terlihat seperti:

```text
Connection reset
SocketTimeoutException
SQLRecoverableException
Communications link failure
ORA-03113 / ORA-03135
I/O Error
```

Namun jangan langsung menyimpulkan network. Banyak error jaringan muncul setelah database membunuh session karena idle timeout, firewall timeout, failover, atau resource exhaustion.

## 4.7 Database Layer

Database-side observability harus mencakup:

- active sessions,
- wait events,
- CPU usage,
- IO throughput/latency,
- buffer cache hit ratio dengan hati-hati,
- lock wait,
- deadlock,
- blocked/blocking sessions,
- top SQL by elapsed time,
- top SQL by CPU,
- top SQL by logical reads,
- top SQL by physical reads,
- execution plan changes,
- temp usage,
- undo/redo/WAL generation,
- long-running transaction,
- open cursor count,
- connection/session count,
- table/index bloat,
- statistics freshness.

Untuk Oracle, metrik seperti active session, wait class, SQL ID, blocking session, undo/temp/redo pressure sangat penting.

Untuk PostgreSQL, perhatikan `pg_stat_activity`, lock view, vacuum/bloat, transaction age, WAL, checkpoint, and `EXPLAIN (ANALYZE, BUFFERS)`.

Untuk MySQL/InnoDB, perhatikan InnoDB lock waits, deadlock report, buffer pool, redo log, slow query log, gap/next-key lock, dan transaction isolation.

Untuk SQL Server, perhatikan wait stats, blocking chains, deadlock graph, execution plan, lock escalation, tempdb pressure.

---

## 5. Correlation ID: Tulang Punggung Debugging

Tanpa correlation id, debugging persistence incident menjadi tebak-tebakan.

Minimal setiap request harus membawa:

```text
correlation_id
request_id
trace_id/span_id jika memakai distributed tracing
tenant_id jika multi-tenant
actor_id jika aman
use_case
transaction_name
```

Kemudian correlation id harus muncul di:

1. API log.
2. Service log.
3. Transaction log.
4. SQL comment atau DB session context jika aman.
5. Outbox event.
6. Audit trail.
7. External call log.
8. Message consumer log.
9. Error response internal reference.

Contoh SQL comment:

```sql
/* app=aceas, useCase=SubmitApplication, correlationId=c-20260616-001 */
select a.id, a.status, a.version
from application a
where a.id = ?
```

Catatan keamanan:

- Jangan masukkan PII ke SQL comment.
- Jangan masukkan token/session id.
- Jangan masukkan raw user input.
- Pastikan SQL comment tidak merusak plan cache pada database tertentu.

---

## 6. Structured Logging untuk Persistence

### 6.1 Hindari Log Naratif Saja

Buruk:

```text
Error when submitting application
```

Lebih baik:

```json
{
  "event": "persistence_operation_failed",
  "correlationId": "c-20260616-001",
  "useCase": "SubmitApplication",
  "operation": "UPDATE_APPLICATION_STATUS",
  "entity": "Application",
  "entityId": 123456,
  "fromStatus": "DRAFT",
  "toStatus": "SUBMITTED",
  "exceptionClass": "OptimisticLockException",
  "errorCategory": "CONCURRENCY_CONFLICT",
  "retryable": false,
  "transactionOutcome": "ROLLBACK"
}
```

### 6.2 Log Level Strategy

| Log | Level | Catatan |
|---|---|---|
| Business use case completed | INFO | Ringkas dan structured. |
| Expected conflict seperti optimistic lock | WARN atau INFO | Jangan spam ERROR untuk konflik normal. |
| Constraint user error | INFO/WARN | Tergantung severity. |
| Deadlock/serialization retry exhausted | ERROR | Setelah retry gagal. |
| DB unavailable | ERROR | Incident-level. |
| SQL debug | DEBUG/TRACE | Jangan aktif global di production kecuali sementara. |
| Slow operation sampled | WARN | Dengan threshold dan sampling. |

### 6.3 Jangan Log Semua SQL dengan Parameter di Production

Risiko:

- volume log meledak,
- PII bocor,
- overhead tinggi,
- query plan cache/observability noise,
- storage cost naik,
- debugging malah sulit.

Lebih baik:

1. Gunakan slow query threshold.
2. Gunakan SQL fingerprint.
3. Mask parameter sensitif.
4. Sampling untuk endpoint high-volume.
5. Aktifkan detail sementara saat incident dengan scope terbatas.

---

## 7. Distributed Tracing untuk Persistence

Trace yang baik harus bisa menunjukkan waterfall:

```text
HTTP POST /applications/{id}/submit
  -> ApplicationService.submit
     -> transaction begin
     -> select Application by id              12 ms
     -> select Applicant by id                8 ms
     -> update Application status             15 ms
     -> insert AuditTrail                     18 ms
     -> insert OutboxEvent                    9 ms
     -> transaction commit                    42 ms
```

Jika trace menunjukkan:

```text
connection acquire 2800 ms
SQL execution 40 ms
```

Masalahnya bukan query lambat, tetapi pool saturation atau connection held too long.

Jika trace menunjukkan:

```text
SQL execution 5000 ms
DB CPU low
Lock wait high
```

Masalahnya kemungkinan lock/blocking, bukan missing index.

Jika trace menunjukkan:

```text
ApplicationService.list
  -> select applications 80 ms
  -> select applicant 10 ms
  -> select applicant 11 ms
  -> select applicant 9 ms
  -> ... repeated 300 times
```

Masalahnya N+1.

---

## 8. SQL Observability

### 8.1 SQL Fingerprint

SQL fingerprint adalah bentuk normalized dari SQL:

```sql
select * from application where id = ?
```

Bukan:

```sql
select * from application where id = 123
select * from application where id = 456
select * from application where id = 789
```

Dengan fingerprint, kita bisa agregasi:

- count,
- avg latency,
- p95/p99 latency,
- rows returned,
- errors,
- lock wait,
- endpoint/use case source,
- plan hash.

### 8.2 Query Comment

Hibernate dapat menambahkan comment pada SQL. Ini berguna untuk menghubungkan SQL ke use case/repository.

Contoh:

```java
TypedQuery<ApplicationSummary> query = entityManager.createQuery(jpql, ApplicationSummary.class);
query.setHint("org.hibernate.comment", "ApplicationRepository.searchSummaries");
```

Atau dengan provider/framework instrumentation.

Gunakan dengan hati-hati karena comment dapat berdampak pada observability/plan cache tergantung database/tooling.

### 8.3 Slow Query Tidak Selalu Query Buruk

Query lambat bisa terjadi karena:

1. Execution plan buruk.
2. Missing index.
3. Statistics stale.
4. Parameter skew.
5. Lock wait.
6. IO pressure.
7. Temp spill.
8. Network transfer besar.
9. Fetch size kecil.
10. Result set terlalu besar.
11. Database CPU saturated.
12. Commit/redo pressure.

Maka diagnosis harus memisahkan:

```text
parse time
plan selection
execution CPU
logical reads
physical reads
lock wait
network send
client fetch/hydration
commit time
```

---

## 9. Hibernate Statistics: Membaca Angka dengan Benar

Hibernate statistics berguna untuk melihat perilaku ORM.

Contoh metrik konseptual:

```text
sessionOpenCount
sessionCloseCount
transactionCount
successfulTransactionCount
queryExecutionCount
queryExecutionMaxTime
entityLoadCount
entityFetchCount
entityInsertCount
entityUpdateCount
entityDeleteCount
collectionLoadCount
collectionFetchCount
flushCount
optimisticFailureCount
secondLevelCacheHitCount
secondLevelCacheMissCount
queryCacheHitCount
queryCacheMissCount
```

Interpretasi:

| Gejala | Kemungkinan |
|---|---|
| `queryExecutionCount` naik tajam | N+1, loop repository, chatty service. |
| `entityLoadCount` jauh lebih besar dari result API | Over-fetching/entity hydration berlebihan. |
| `collectionFetchCount` tinggi | Lazy collection terpicu berulang. |
| `flushCount` tinggi | `saveAndFlush`, explicit flush, transaction boundary buruk. |
| `optimisticFailureCount` tinggi | Aggregate contention/state transition race. |
| cache hit rendah | Cache salah target, TTL terlalu pendek, invalidation terlalu sering. |
| query max time tinggi tapi count rendah | Query tertentu berat/report/export. |

Jangan hanya melihat satu metric. Contoh:

```text
entityLoadCount tinggi + queryExecutionCount rendah
```

Kemungkinan satu query join/fetch meng-hydrate terlalu banyak entity.

```text
queryExecutionCount tinggi + entityLoadCount rendah
```

Kemungkinan banyak scalar/projection query kecil, health check buruk, atau lookup berulang.

---

## 10. Persistence Context Bloat di Production

Persistence context adalah first-level cache dan unit-of-work.

Masalah muncul ketika satu transaction memuat terlalu banyak entity:

```java
@Transactional
public void processAll() {
    List<Application> all = repository.findAll();
    for (Application app : all) {
        app.recalculateRiskScore();
    }
}
```

Risiko:

- memory meningkat,
- dirty checking lambat,
- flush besar,
- rollback mahal,
- GC pressure,
- connection lama dipegang,
- lock lama,
- transaction timeout.

Sinyal:

```text
heap naik selama job
GC pause naik
transaction duration panjang
flush time panjang
entityLoadCount besar
connection usage time tinggi
DB update burst saat flush
```

Solusi:

```java
for (;;) {
    List<Long> ids = repository.findNextIds(lastId, 500);
    if (ids.isEmpty()) break;

    transactionTemplate.executeWithoutResult(tx -> {
        List<Application> batch = repository.findByIds(ids);
        for (Application app : batch) {
            app.recalculateRiskScore();
        }
        entityManager.flush();
        entityManager.clear();
    });

    lastId = ids.get(ids.size() - 1);
}
```

Prinsip:

> Untuk volume besar, kontrol ukuran persistence context, ukuran transaction, dan ukuran result set.

---

## 11. Connection Pool Incident Reasoning

### 11.1 Gejala Pool Habis

```text
HikariPool - Connection is not available, request timed out after 30000ms
```

Atau:

```text
active=max
idle=0
pending>0
connection acquisition p95 naik
HTTP latency naik
DB CPU mungkin naik atau justru rendah
```

### 11.2 Kemungkinan Penyebab

| Penyebab | Ciri |
|---|---|
| Query lambat | DB CPU/IO tinggi, top SQL jelas. |
| Lock wait | DB CPU tidak selalu tinggi, blocking session ada. |
| External call dalam transaction | Connection usage time tinggi, SQL tidak berat. |
| Batch job monopolize pool | Spike pada jam job, active=max. |
| Connection leak | Active tidak turun setelah request selesai. |
| Pool terlalu kecil | Pending naik tapi DB masih sehat. |
| Pool terlalu besar | DB CPU/lock/IO collapse. |
| Slow commit | Commit duration tinggi, redo/WAL pressure. |

### 11.3 Jangan Langsung Menambah Pool

Sebelum menaikkan pool, jawab:

1. Berapa DB max sessions?
2. Berapa aplikasi instance?
3. Total max connections seluruh pod/node berapa?
4. Apakah DB CPU masih punya headroom?
5. Apakah wait dominan CPU, IO, lock, network, atau idle?
6. Apakah query count/request terlalu besar?
7. Apakah transaction memegang connection saat external call?
8. Apakah batch/scheduler berbagi pool dengan traffic online?

Formula kasar:

```text
total_possible_connections = app_instance_count * max_pool_size_per_instance
```

Jika ada 20 pod dan masing-masing pool 50:

```text
20 * 50 = 1000 possible DB connections
```

Ini bisa menghancurkan database walaupun tiap pod terlihat “normal”.

---

## 12. Long Transaction Detection

Long transaction adalah sumber banyak penyakit.

Sinyal:

- transaction duration p95/p99 tinggi,
- connection usage time tinggi,
- lock wait meningkat,
- deadlock naik,
- undo/WAL/redo meningkat,
- blocked sessions,
- stale reads,
- API timeout.

Penyebab umum:

1. External API call di dalam transaction.
2. File upload/download di dalam transaction.
3. Email/send notification di dalam transaction.
4. Batch terlalu besar dalam satu transaction.
5. User interaction ditunggu di dalam transaction.
6. Report query dijalankan dalam transaction read-write.
7. Lazy loading saat serialization masih memegang transaction.
8. Pessimistic lock diambil terlalu awal.
9. Lock order tidak deterministik.

Pattern lebih baik:

```text
validate command outside transaction if possible
open transaction
load minimal aggregate
check invariant
mutate state
insert audit/outbox
commit quickly
publish/notify asynchronously after commit via outbox
```

---

## 13. Lock Wait dan Deadlock Incident Response

### 13.1 Bedakan Lock Wait dan Deadlock

Lock wait:

```text
Transaction A menunggu Transaction B melepas lock.
Jika B commit/rollback, A lanjut.
```

Deadlock:

```text
A menunggu B, B menunggu A.
Database memilih korban dan rollback salah satu.
```

### 13.2 Gejala Lock Wait

- SQL execution time tinggi.
- DB CPU tidak selalu tinggi.
- Active sessions waiting on lock.
- Connection pool habis karena semua menunggu lock.
- Endpoint tertentu timeout.

### 13.3 Gejala Deadlock

- Deadlock exception muncul sporadis.
- Retry bisa berhasil.
- Sering terjadi di workload update bersamaan.
- Biasanya ada pola update order berbeda.

### 13.4 Checklist Investigasi

1. Query/entity apa yang menunggu lock?
2. Session mana blocker?
3. Use case blocker sedang melakukan apa?
4. Apakah blocker idle in transaction?
5. Apakah ada external call di dalam transaction?
6. Apakah update order antar code path berbeda?
7. Apakah batch job berjalan bersamaan?
8. Apakah foreign key/index menyebabkan lock tambahan?
9. Apakah isolation terlalu tinggi?
10. Apakah pessimistic lock dipakai terlalu luas?

### 13.5 Remediasi

- Perpendek transaction.
- Ambil lock sedekat mungkin dengan update.
- Gunakan deterministic lock order.
- Tambahkan index untuk FK/predicate lock-sensitive.
- Pisahkan batch dari online pool.
- Pakai `SKIP LOCKED` untuk queue consumer jika sesuai.
- Tambahkan bounded retry untuk deadlock/serialization failure.
- Ubah desain dari hot row menjadi sharded counter/bucket jika perlu.

---

## 14. Execution Plan Regression

Query bisa tiba-tiba lambat walaupun kode tidak berubah.

Penyebab:

1. Data volume berubah.
2. Data distribution berubah.
3. Statistics stale.
4. Parameter skew.
5. Index dibuat/drop.
6. Bind peeking/parameter sniffing issue.
7. Migration mengubah column type/nullability.
8. Query ORM berubah karena upgrade provider.
9. Pagination/filter baru membuat predicate tidak sargable.
10. Function wrapping column menghindari index.

Contoh buruk:

```sql
where lower(applicant_name) like lower(? || '%')
```

Jika tidak ada function-based index atau strategi search yang sesuai, index normal pada `applicant_name` mungkin tidak efektif.

### 14.1 Sinyal Plan Regression

- SQL fingerprint sama, latency naik.
- Rows examined/logical reads naik.
- Plan hash berubah.
- DB CPU/IO naik.
- Query tertentu masuk top SQL.
- Endpoint tertentu melambat setelah deploy/migration/data load.

### 14.2 Remediasi

- Ambil execution plan aktual, bukan perkiraan saja.
- Bandingkan estimated rows vs actual rows.
- Periksa predicate, join order, index usage.
- Update statistics jika perlu.
- Tambah/ubah index secara hati-hati.
- Rewrite query/projection.
- Batasi result set.
- Ganti offset pagination dengan keyset untuk deep paging.
- Pertimbangkan materialized view/read model untuk report.

---

## 15. N+1 Incident di Production

N+1 sering lolos test karena dataset kecil.

Gejala:

```text
endpoint latency naik seiring jumlah row
query count/request naik linear
DB CPU tidak selalu ekstrem
application thread sibuk melakukan banyak roundtrip
```

Contoh:

```java
List<Application> apps = applicationRepository.findRecent();
for (Application app : apps) {
    String name = app.getApplicant().getName(); // lazy trigger N kali
}
```

Solusi tergantung use case:

1. DTO projection untuk listing.
2. Fetch join untuk detail kecil.
3. Entity graph.
4. Batch fetching.
5. Precomputed read model.
6. Explicit query per use case.

Observability guard:

- log query count per request pada sampling,
- alert jika query count p95 per endpoint naik,
- integration test dengan SQL statement count,
- Hibernate statistics in lower environment,
- tracing SQL spans.

---

## 16. Incident: 504 Gateway Timeout

### 16.1 Jangan Mulai dari “Naikkan Timeout”

504 adalah gejala, bukan root cause.

Pertanyaan awal:

1. Endpoint mana?
2. Mulai kapan?
3. Semua user atau tenant tertentu?
4. Semua pod atau sebagian?
5. Ada deploy/migration/job?
6. DB CPU/IO/lock bagaimana?
7. Pool active/pending bagaimana?
8. Query count berubah?
9. External dependency lambat?
10. Error log apa?

### 16.2 Decision Tree

```text
504 naik
  |
  |-- connection acquisition tinggi?
  |       |-- yes -> pool saturation / connection leak / long transaction
  |       |-- no
  |
  |-- SQL execution tinggi?
  |       |-- yes -> slow query / lock wait / plan regression
  |       |-- no
  |
  |-- service time tinggi sebelum DB?
  |       |-- yes -> CPU app / external API / serialization / lock local
  |       |-- no
  |
  |-- commit time tinggi?
  |       |-- yes -> redo/WAL/IO/large transaction
  |       |-- no
  |
  |-- response serialization tinggi?
          |-- yes -> over-fetch/lazy loading/large payload
```

### 16.3 Immediate Mitigation

Tergantung root cause:

| Root Cause | Mitigasi Cepat |
|---|---|
| Batch monopolize DB | Pause/throttle batch. |
| Lock blocker | Identify blocker; kill session jika aman dan disetujui SOP. |
| Query plan regression | Revert deploy, add index, update stats, force safer query path. |
| Pool exhaustion karena traffic | Rate limit, scale app cautiously, reduce per-request query count. |
| External call in transaction | Feature flag external call/outbox path jika tersedia. |
| Cache stampede | Enable temporary cache/lock/single-flight/rate limit. |
| Large export | Disable export, move async, limit rows. |

---

## 17. Incident: Database CPU Spike

### 17.1 Kemungkinan Penyebab

- query baru tidak indexed,
- N+1 spike,
- report/export dijalankan online,
- plan regression,
- batch job/backfill,
- connection pool terlalu besar,
- cache miss storm,
- query cache disabled/invalidated,
- pagination deep offset,
- full table scan,
- excessive parse/prepare,
- hot update causing contention,
- statistics stale.

### 17.2 Investigasi

1. Top SQL by CPU.
2. Top SQL by elapsed time.
3. Top SQL by executions.
4. Top SQL by logical reads.
5. Endpoint/use case source.
6. Deployment diff.
7. Job schedule.
8. Cache hit/miss change.
9. DB wait class.
10. Plan hash change.

### 17.3 Remediasi

- stop/throttle offending job,
- feature flag expensive endpoint,
- add limit/pagination,
- use projection,
- add index,
- update stats,
- deploy query fix,
- enable cache cautiously,
- rate limit tenant/user/export,
- split online/reporting database path.

---

## 18. Incident: Connection Exhaustion

### 18.1 Data yang Harus Dikumpulkan

- active/idle/pending per pod,
- acquisition time,
- usage time,
- pool timeout count,
- thread dump,
- top endpoints,
- top SQL,
- DB session list,
- long transaction list,
- lock wait list,
- recent deploy/job,
- total possible connections.

### 18.2 Thread Dump Pattern

Banyak thread seperti:

```text
WAITING at com.zaxxer.hikari.pool.HikariPool.getConnection
```

Berarti thread menunggu pool.

Banyak thread seperti:

```text
RUNNABLE at oracle.jdbc.driver...
```

Atau:

```text
RUNNABLE at org.postgresql.core...
```

Berarti thread sedang menunggu/menjalankan JDBC operation.

Banyak thread di external HTTP client dalam transaction bisa berarti connection DB dipegang sambil menunggu external API.

### 18.3 Remediasi

- release/kill stuck transaction jika aman,
- pause batch,
- reduce traffic/rate limit,
- lower query count,
- shorten transaction,
- split pool untuk online vs batch,
- tune pool setelah DB capacity dihitung,
- enable leak detection sementara,
- add timeout pada query/external call.

---

## 19. Incident: Lock Storm

Lock storm terjadi saat banyak transaction saling menunggu atau berebut row/table/index yang sama.

Sumber umum:

- hot row counter,
- global sequence table/table generator,
- queue table tanpa `SKIP LOCKED`,
- batch update parent-child,
- state transition pada aggregate populer,
- missing index pada FK,
- cascading delete besar,
- long transaction,
- report dengan isolation/lock yang tidak tepat,
- migration DDL lock.

Mitigasi desain:

1. Hindari hot row dengan bucket/shard.
2. Gunakan database sequence, bukan table generator.
3. Gunakan `SKIP LOCKED` untuk worker queue jika sesuai.
4. Deterministic lock order.
5. Chunk batch kecil.
6. Index foreign key.
7. Jangan delete cascade massive pada traffic online.
8. Gunakan outbox untuk side effect.
9. Set lock timeout.
10. Retry bounded untuk deadlock.

---

## 20. Incident: Memory Pressure karena Persistence

### 20.1 Gejala

- heap meningkat selama request/job,
- old gen naik,
- GC pause naik,
- OOM pada batch/report/export,
- entity load count besar,
- response payload besar,
- persistence context tidak di-clear,
- stream tidak ditutup,
- LOB dimuat ke memory.

### 20.2 Penyebab

- `findAll()` pada table besar,
- export memuat semua row ke list,
- one transaction memuat ribuan/jutaan entity,
- eager association,
- JSON serialization traverse graph,
- second-level cache terlalu besar,
- query result cache menyimpan payload besar,
- LOB fetch eager,
- batch tanpa flush/clear,
- DTO berisi object graph besar.

### 20.3 Remediasi

- keyset pagination,
- streaming dengan fetch size dan resource management,
- projection,
- chunk transaction,
- flush/clear,
- disable eager graph,
- cap export size,
- async export to file,
- externalize LOB,
- monitor entity count per transaction.

---

## 21. Incident: Stale Data dan Cache Inconsistency

Gejala:

- user melihat status lama setelah update,
- permission/role lama masih berlaku,
- listing tidak sesuai detail page,
- cache hit tinggi tapi data salah,
- update berhasil tetapi search index belum berubah,
- read replica menampilkan data lama.

Penyebab:

1. Second-level cache tidak invalidated.
2. External Redis cache TTL terlalu panjang.
3. Query cache stale setelah bulk update.
4. Search index eventual consistency.
5. Read replica lag.
6. Transaction belum commit tetapi event/cache sudah dipublish.
7. Bulk native SQL bypass ORM cache.
8. Multi-node invalidation gagal.
9. Cache key tidak include tenant/role/filter.

Remediasi:

- invalidate setelah commit, bukan sebelum commit,
- gunakan outbox untuk search/cache update,
- disable query cache untuk mutable data,
- add cache version/key namespace,
- include tenant/security scope in key,
- avoid cache for authorization-critical mutable data,
- monitor cache hit/miss/stale complaint,
- expose read-after-write policy.

---

## 22. Incident: Migration Failure

Schema migration failure sering lebih berbahaya daripada query bug karena memengaruhi startup/deploy/data contract.

Skenario:

1. Migration berhasil di DEV, gagal di PROD karena data existing melanggar constraint.
2. Column rename membuat old app version crash.
3. `NOT NULL` langsung diterapkan pada table besar tanpa default/backfill.
4. Index creation lock table terlalu lama.
5. Type change rewrite table dan memblokir traffic.
6. Flyway/Liquibase checksum mismatch.
7. Multiple service deploy menjalankan migration bersamaan.
8. Rollback app tidak kompatibel dengan schema baru.

Playbook:

```text
1. Stop rollout.
2. Identify migration version/changeset.
3. Determine state: not started, partially applied, fully applied, failed.
4. Check if application versions are compatible with current schema.
5. Avoid manual hotfix without recording migration state.
6. Apply forward fix if possible.
7. Restore/rollback only if data loss and downtime implications are understood.
8. Add postmortem: test data gap, preflight check, migration lock, rollback plan.
```

Prinsip:

> Production migration harus didesain sebagai operational change, bukan hanya code artifact.

---

## 23. Production Safe SQL Logging and Debugging

### 23.1 Dynamic Debugging

Idealnya aplikasi mendukung dynamic log level sementara:

```text
org.hibernate.SQL=DEBUG
org.hibernate.orm.jdbc.bind=TRACE
```

Namun aktifkan hanya:

- di environment terbatas,
- untuk durasi terbatas,
- dengan sampling jika memungkinkan,
- setelah memastikan tidak membocorkan data sensitif.

### 23.2 P6Spy / datasource-proxy / OpenTelemetry Instrumentation

Tool seperti datasource proxy dapat membantu:

- log SQL duration,
- count query per request,
- detect slow query,
- mask parameters,
- add trace id.

Namun perlu governance:

- overhead diukur,
- masking wajib,
- sampling,
- jangan log semua parameter production,
- pastikan volume log aman.

---

## 24. Alerting: Apa yang Layak Di-alert?

Alert harus actionable.

### 24.1 Alert Penting

| Alert | Kenapa Penting |
|---|---|
| DB connection pool pending high | Request menunggu connection. |
| Connection acquisition p95 high | Pool saturation/DB bottleneck. |
| Transaction duration p95 high | Long transaction/lock risk. |
| SQL latency p95/p99 high | Query/lock/plan issue. |
| Deadlock rate high | Concurrency design issue. |
| Lock wait high | Blocking transaction. |
| Rollback rate spike | App/data/concurrency issue. |
| Constraint violation spike | Client bug/race/data issue. |
| Optimistic conflict spike | Hot aggregate/concurrent workflow. |
| DB CPU > threshold sustained | Capacity/query regression. |
| DB storage/temp/undo/WAL high | Batch/migration/report risk. |
| Hikari active=max sustained | Pool exhausted. |
| Cache miss spike | Cache stampede/invalidation. |
| Migration failed | Deployment/data contract risk. |

### 24.2 Hindari Alert Noise

Jangan alert untuk:

- setiap single deadlock jika retry berhasil,
- setiap expected optimistic conflict,
- every slow query one-off,
- CPU spike 5 detik tanpa user impact,
- cache miss tunggal.

Alert berdasarkan:

- rate,
- duration,
- p95/p99,
- user impact,
- error budget,
- business critical endpoint.

---

## 25. Dashboards yang Berguna

### 25.1 Persistence Overview Dashboard

Panel:

- request rate by endpoint,
- latency p50/p95/p99 by endpoint,
- error rate by category,
- transaction duration p95,
- SQL count/request,
- SQL latency p95,
- connection active/idle/pending,
- connection acquisition p95,
- DB CPU/IO,
- lock wait/deadlock,
- top SQL fingerprints,
- rollback count,
- cache hit/miss.

### 25.2 Endpoint Drilldown Dashboard

Untuk satu endpoint:

- request volume,
- p95/p99 latency,
- SQL count distribution,
- top SQL by duration/count,
- entity load count,
- collection fetch count,
- transaction duration,
- error category,
- tenant/user distribution,
- payload size.

### 25.3 Batch/Job Dashboard

- job duration,
- rows processed/sec,
- chunk success/failure,
- retry count,
- skip count,
- transaction duration/chunk,
- connection usage,
- DB CPU/IO,
- lock wait,
- deadletter/outbox backlog,
- memory/GC.

### 25.4 Migration Dashboard

- migration version,
- started/finished/failed,
- duration,
- lock wait,
- table/index affected,
- rows backfilled,
- app version compatibility.

---

## 26. Production Tuning Principles

### 26.1 Tune Based on Bottleneck Class

| Bottleneck | Tuning |
|---|---|
| Query count | Fix N+1, projection, fetch plan. |
| Query CPU | Index/query rewrite/statistics. |
| IO | Reduce rows/columns, index, partition, cache cautiously. |
| Lock wait | Shorten transaction, lock order, index FK, retry. |
| Pool wait | Reduce connection hold time, split workload, tune pool. |
| Hydration cost | Projection/read model, reduce entity graph. |
| Dirty checking | Smaller transaction/context, read-only, clear. |
| Commit/redo | Smaller chunks, batch, reduce writes. |
| Memory | Streaming, pagination, flush-clear, LOB strategy. |
| Cache miss | Key design, TTL, warmup, single-flight. |

### 26.2 Jangan Optimize Tanpa Baseline

Sebelum tuning, catat:

- current throughput,
- latency p50/p95/p99,
- query count/request,
- rows scanned/returned,
- DB CPU/IO,
- pool metrics,
- lock wait,
- memory/GC,
- error rate.

Setelah tuning, bandingkan.

Jika tidak ada before/after, itu bukan engineering; itu spekulasi.

---

## 27. Safe Rollout untuk Persistence Changes

Persistence change lebih berisiko daripada code pure-compute karena menyentuh state.

Checklist rollout:

1. Migration backward compatible.
2. Old app dan new app bisa berjalan bersamaan.
3. Query plan diuji pada data realistis.
4. Index ada sebelum query baru high-volume dipakai.
5. Feature flag untuk expensive query/job.
6. Batch throttle tersedia.
7. Rollback app aman terhadap schema.
8. Observability sudah siap sebelum deploy.
9. Alert threshold disiapkan.
10. Runbook tersedia.

Deployment strategy:

```text
expand schema
backfill safely
deploy code writing old+new if needed
verify read path
switch read path
contract old schema later
```

---

## 28. Incident Response Playbook Umum

### 28.1 First 5 Minutes

1. Konfirmasi user impact.
2. Identifikasi endpoint/use case/tenant terdampak.
3. Cek recent deploy/migration/job.
4. Cek DB health: CPU, IO, sessions, locks.
5. Cek connection pool: active/idle/pending.
6. Cek top errors.
7. Cek top SQL/slow query.
8. Tentukan apakah perlu mitigation cepat: pause job, rate limit, rollback, feature flag.

### 28.2 First 15–30 Minutes

1. Klasifikasikan bottleneck.
2. Cari correlation id sample.
3. Trace request end-to-end.
4. Ambil DB session/lock/top SQL evidence.
5. Cek thread dump jika app-side stuck.
6. Cek GC/memory jika heap pressure.
7. Validasi apakah rollback/deploy fix/migration fix aman.
8. Komunikasikan status dengan fakta, bukan asumsi.

### 28.3 After Stabilization

1. Root cause analysis.
2. Timeline lengkap.
3. Detection gap.
4. Prevention action.
5. Test gap.
6. Observability gap.
7. Runbook update.
8. Code/schema/index fix.
9. Capacity/tuning follow-up.

---

## 29. Practical Runbooks

### 29.1 Runbook: Sudden 504

```text
Symptom:
- Gateway timeout increased.

Check:
1. Which endpoint/use case?
2. App latency breakdown: controller/service/transaction/sql/connection acquisition.
3. Hikari active/idle/pending.
4. DB CPU/IO/wait/lock.
5. Top SQL by elapsed/count.
6. Recent deploy/job/migration.

Classify:
- pool saturation?
- slow query?
- lock wait?
- external dependency?
- serialization/large response?

Mitigate:
- pause batch/export,
- rate limit,
- rollback deploy,
- kill blocker if safe,
- feature flag expensive path,
- add temporary index only with DBA review.
```

### 29.2 Runbook: Deadlock Spike

```text
Check:
1. Deadlock graph/report.
2. Involved tables/indexes.
3. Involved use cases.
4. Update order.
5. Batch/online overlap.
6. Recent query/index/schema change.

Mitigate:
- bounded retry,
- reduce concurrency,
- pause batch,
- deterministic lock order fix,
- index missing FK/predicate,
- smaller chunks.
```

### 29.3 Runbook: Connection Pool Exhaustion

```text
Check:
1. active/idle/pending per pod.
2. acquisition time.
3. usage time.
4. thread dump.
5. DB sessions.
6. long transactions.
7. lock wait.
8. external calls inside transactions.

Mitigate:
- pause long jobs,
- kill/rollback stuck sessions if safe,
- reduce traffic,
- split pool/workload,
- shorten transaction,
- avoid blind pool increase.
```

### 29.4 Runbook: DB CPU Spike

```text
Check:
1. top SQL by CPU/execution/logical reads.
2. plan hash changes.
3. query count/request.
4. recent deploy/migration/index/statistics.
5. cache miss spike.
6. report/export/batch.

Mitigate:
- disable endpoint/job,
- add limit/projection,
- rollback query change,
- update stats,
- add index with review,
- rate limit.
```

### 29.5 Runbook: Stale Data Complaint

```text
Check:
1. DB committed state.
2. API read source: primary/read replica/cache/search index.
3. cache key includes tenant/security scope?
4. invalidation after commit?
5. outbox backlog?
6. replica lag?
7. bulk update bypassed cache?

Mitigate:
- invalidate namespace,
- force primary read for read-after-write path,
- replay outbox/index update,
- disable stale cache path temporarily.
```

---

## 30. Production Code Patterns

### 30.1 Query Count Logging per Request

Conceptual filter/interceptor:

```java
public final class PersistenceRequestMetrics {
    private int sqlCount;
    private long sqlTimeNanos;
    private int entitiesLoaded;
    private int flushCount;

    public void recordSql(long durationNanos) {
        sqlCount++;
        sqlTimeNanos += durationNanos;
    }

    public int sqlCount() {
        return sqlCount;
    }

    public long sqlTimeMillis() {
        return sqlTimeNanos / 1_000_000;
    }
}
```

Log akhir request:

```json
{
  "event": "request_persistence_summary",
  "correlationId": "c-20260616-001",
  "route": "/applications/search",
  "sqlCount": 43,
  "sqlTimeMs": 612,
  "entitiesLoaded": 500,
  "flushCount": 0
}
```

Gunakan sampling agar tidak terlalu berat.

### 30.2 Transaction Timing Aspect

```java
@Aspect
@Component
public class TransactionTimingAspect {

    private static final Logger log = LoggerFactory.getLogger(TransactionTimingAspect.class);

    @Around("@annotation(org.springframework.transaction.annotation.Transactional)")
    public Object measureTransactionalMethod(ProceedingJoinPoint pjp) throws Throwable {
        long start = System.nanoTime();
        String method = pjp.getSignature().toShortString();

        try {
            Object result = pjp.proceed();
            long durationMs = (System.nanoTime() - start) / 1_000_000;

            if (durationMs > 1_000) {
                log.warn("transaction_slow method={} durationMs={}", method, durationMs);
            }
            return result;
        } catch (Throwable ex) {
            long durationMs = (System.nanoTime() - start) / 1_000_000;
            log.warn("transaction_failed method={} durationMs={} exception={}",
                    method, durationMs, ex.getClass().getSimpleName());
            throw ex;
        }
    }
}
```

Catatan:

- Ini contoh konseptual.
- Pada Spring proxy, aspect ordering perlu diperhatikan.
- Lebih baik integrasikan dengan metrics/tracing, bukan hanya log.

### 30.3 Guard untuk Query Count di Test

```java
@Test
void applicationListingShouldNotExecuteNPlusOneQueries() {
    statistics.clear();

    List<ApplicationSummary> result = service.searchApplications(criteria);

    assertThat(result).hasSize(50);
    assertThat(statistics.getPrepareStatementCount())
            .as("listing should use bounded number of SQL statements")
            .isLessThanOrEqualTo(3);
}
```

Ini bukan production code, tetapi production incident prevention.

---

## 31. Security dan Privacy dalam Observability

Persistence observability sering dekat dengan data sensitif.

Jangan log:

- password,
- token,
- cookie,
- session id,
- NRIC/NIK/passport,
- bank account,
- full address,
- phone/email jika tidak perlu,
- document content,
- raw request/response body,
- SQL bind parameter sensitif,
- CLOB audit full text,
- encryption key/material.

Gunakan:

- correlation id,
- surrogate id,
- hashed/masked value,
- error category,
- SQL fingerprint,
- route template,
- entity type + internal id jika aman,
- tenant id jika bukan sensitif di organisasi tersebut.

Regulatory posture:

> Observability harus cukup untuk debugging dan audit teknis, tetapi tidak menjadi kanal kebocoran data.

---

## 32. Case Study: Approval Endpoint Timeout

### 32.1 Gejala

```text
POST /cases/{id}/approve mengalami p95 12 detik dan sebagian 504.
```

### 32.2 Data Awal

```text
Hikari active=max, pending tinggi.
DB CPU sedang.
Lock wait tinggi.
Top SQL: update case set status=?, version=? where id=? and version=?
Thread dump: banyak thread di JDBC executeUpdate.
```

### 32.3 Hipotesis

Bukan query CPU-heavy. Kemungkinan lock contention pada case row atau related parent row.

### 32.4 Investigasi

Ditemukan:

- approval transaction memanggil external notification API sebelum commit,
- lock pada case sudah diambil,
- external API kadang 5 detik,
- selama itu row case terkunci,
- request approval/reassignment lain menunggu,
- pool penuh karena semua transaction menunggu lock/external API.

### 32.5 Fix

Sebelum:

```text
begin transaction
load case
lock/update status
insert audit
call external notification API
commit
```

Sesudah:

```text
begin transaction
load case
validate transition
update status
insert audit
insert outbox notification event
commit
publisher sends notification asynchronously
```

Tambahan:

- optimistic version expected di command,
- lock timeout,
- bounded retry untuk deadlock,
- alert transaction duration,
- trace span external call outside transaction,
- dashboard outbox backlog.

### 32.6 Lesson

Masalah terlihat sebagai DB timeout, tetapi root cause adalah **transaction boundary salah**.

---

## 33. Case Study: Listing Page Melambat Setelah Data Bertambah

### 33.1 Gejala

```text
GET /applications/search p95 naik dari 400 ms menjadi 6 detik.
```

### 33.2 Observability

```text
SQL count/request: 1 -> 301
entityLoadCount: 50 -> 600
collectionFetchCount: tinggi
DB CPU sedang
network roundtrip banyak
```

### 33.3 Root Cause

DTO mapper mengakses lazy association:

```java
summary.setApplicantName(app.getApplicant().getName());
summary.setPrimaryAddress(app.getApplicant().getAddresses().get(0).getLine1());
```

Awalnya data kecil sehingga tidak terasa. Setelah data bertambah, N+1 muncul.

### 33.4 Fix

Gunakan projection query khusus listing:

```java
select new ApplicationSummary(
    a.id,
    a.referenceNo,
    applicant.name,
    primaryAddress.line1,
    a.status,
    a.submittedAt
)
from Application a
join a.applicant applicant
left join applicant.primaryAddress primaryAddress
where ...
order by a.submittedAt desc
```

Tambahan:

- query count test,
- endpoint dashboard,
- max page size,
- index alignment.

---

## 34. Case Study: Batch Job Membuat Online Traffic Timeout

### 34.1 Gejala

```text
Setiap jam 01:00, endpoint online timeout.
```

### 34.2 Observability

```text
Batch starts 01:00.
Hikari active=max.
DB redo/WAL high.
Lock wait high.
Transaction duration batch: 20 minutes.
```

### 34.3 Root Cause

Batch update 500k rows dalam satu transaction dan memakai pool yang sama dengan online traffic.

### 34.4 Fix

- chunk 500–1000 rows,
- separate pool/job concurrency limit,
- keyset pagination,
- flush/clear,
- retry chunk,
- throttle based on DB load,
- schedule outside peak,
- progress table,
- idempotent chunk.

---

## 35. Anti-Pattern Production Persistence

1. Mengaktifkan SQL bind parameter logging global di production tanpa masking.
2. Menganggap 504 selalu perlu timeout lebih panjang.
3. Menaikkan pool size tanpa melihat DB capacity.
4. Menjalankan report/export berat di primary OLTP database tanpa limit.
5. Menaruh external API call di dalam transaction.
6. Batch besar dalam satu transaction.
7. Tidak punya correlation id.
8. Tidak bisa menghubungkan request ke SQL.
9. Tidak mengukur query count per request.
10. Tidak punya dashboard lock wait/deadlock.
11. Mengandalkan H2 test untuk query production.
12. Menganggap cache selalu mempercepat tanpa stale data strategy.
13. Mengabaikan read replica lag.
14. Menganggap optimistic lock exception adalah system error fatal.
15. Mengabaikan rollback-only state.
16. Menggunakan `findAll()` untuk export besar.
17. Membuka OSIV tanpa memahami serialization/lazy loading risk.
18. Tidak menguji migration pada data realistis.
19. Tidak punya runbook kill blocker/pause batch.
20. Tidak membedakan user error, concurrency conflict, transient infrastructure failure, dan bug.

---

## 36. Production Checklist

### 36.1 Observability Checklist

- [ ] Setiap request punya correlation id.
- [ ] Correlation id muncul di logs, traces, outbox, audit, dan error response reference.
- [ ] Endpoint latency p50/p95/p99 tersedia.
- [ ] Transaction duration terukur.
- [ ] Connection pool active/idle/pending/acquisition time tersedia.
- [ ] SQL count/request bisa diketahui minimal via sampling.
- [ ] Top SQL by duration/count tersedia.
- [ ] Hibernate statistics tersedia di lower env dan/atau sampled production.
- [ ] DB session/wait/lock dashboard tersedia.
- [ ] Deadlock/lock timeout alert tersedia.
- [ ] Migration status terlihat.
- [ ] Batch/job dashboard tersedia.
- [ ] Cache hit/miss/stale invalidation metrics tersedia.

### 36.2 Debugging Checklist

- [ ] Bisa menjawab “where did the time go?”
- [ ] Bisa membedakan connection wait vs SQL execution vs commit wait.
- [ ] Bisa melihat blocking session.
- [ ] Bisa melihat query fingerprint.
- [ ] Bisa menghubungkan SQL ke use case.
- [ ] Bisa melihat recent deploy/migration/job.
- [ ] Bisa mengambil thread dump.
- [ ] Bisa melihat transaction duration dan rollback reason.
- [ ] Bisa melihat slow query plan.
- [ ] Bisa melihat cache/read replica involvement.

### 36.3 Tuning Checklist

- [ ] Ada baseline sebelum tuning.
- [ ] Ada before/after setelah tuning.
- [ ] Tuning disesuaikan bottleneck class.
- [ ] Query count/request tidak naik tanpa disadari.
- [ ] Pool size dihitung total across pods.
- [ ] Batch tidak memonopoli online traffic.
- [ ] Index sesuai query predicate/sort/join.
- [ ] Fetch plan eksplisit untuk hot endpoint.
- [ ] Pagination aman untuk data besar.
- [ ] Transaction dipendekkan.

### 36.4 Incident Preparedness Checklist

- [ ] Ada runbook 504.
- [ ] Ada runbook connection exhaustion.
- [ ] Ada runbook lock/deadlock.
- [ ] Ada runbook DB CPU spike.
- [ ] Ada runbook migration failure.
- [ ] Ada runbook stale cache/search/read replica.
- [ ] Ada owner escalation path: app, DBA, infra, network.
- [ ] Ada feature flag untuk expensive job/endpoint.
- [ ] Ada cara pause/throttle batch.
- [ ] Ada postmortem template.

---

## 37. Latihan / Scenario

### Scenario 1 — Connection Pool Habis tetapi DB CPU Rendah

Gejala:

```text
active=max
pending tinggi
DB CPU 25%
lock wait tinggi
HTTP p99 20 detik
```

Pertanyaan:

1. Mengapa DB CPU rendah tidak berarti DB sehat?
2. Data apa yang perlu dikumpulkan?
3. Apa kemungkinan root cause?
4. Mitigasi cepat apa yang aman?
5. Fix desain jangka panjang apa?

Expected reasoning:

- Kemungkinan request menunggu lock, bukan CPU.
- Periksa blocking session, long transaction, external call in transaction, batch overlap.
- Jangan langsung menaikkan pool.

### Scenario 2 — Query Lambat Hanya Setelah Data Tenant Tertentu Bertambah

Gejala:

```text
Tenant A search p95 8 detik.
Tenant B search p95 300 ms.
SQL fingerprint sama.
```

Pertanyaan:

1. Apa yang harus dibandingkan?
2. Bagaimana tenant distribution memengaruhi plan?
3. Apakah index composite dengan `tenant_id` diperlukan?
4. Bagaimana testing harus diperbaiki?

Expected reasoning:

- Data skew dan index selectivity penting.
- Query tenant-aware perlu index tenant + predicate + sort.
- Test dataset harus mencerminkan tenant besar.

### Scenario 3 — Optimistic Conflict Spike Setelah UI Auto-Save

Gejala:

```text
OptimisticLockException naik 20x setelah auto-save dirilis.
```

Pertanyaan:

1. Apakah ini system failure atau conflict normal?
2. Bagaimana membedakan bug dan contention wajar?
3. Apa mitigasi UI/API?
4. Apa observability tambahan?

Expected reasoning:

- Auto-save memperbanyak write terhadap aggregate sama.
- Gunakan debounce, field-level command, expected version, conflict resolution UX.

### Scenario 4 — Stale Listing Setelah Bulk Update

Gejala:

```text
Bulk status correction berhasil.
Detail page benar.
Listing masih status lama selama 30 menit.
```

Pertanyaan:

1. Apakah listing membaca DB, cache, materialized view, search index, atau read replica?
2. Apakah bulk update bypass ORM cache/invalidation?
3. Bagaimana fix?

Expected reasoning:

- Bulk update mungkin bypass cache/search index update.
- Gunakan explicit invalidation/reindex/outbox event.

---

## 38. Ringkasan

Persistence production operation membutuhkan kemampuan membaca sistem secara lintas-layer.

Poin utama:

1. Persistence incident tidak bisa dianalisis hanya dari kode repository.
2. 504, DB CPU spike, pool exhaustion, deadlock, stale data, dan memory pressure harus ditelusuri lewat korelasi request → transaction → ORM → pool → JDBC → database.
3. Correlation id, structured log, metrics, trace, SQL fingerprint, dan database session view adalah fondasi debugging.
4. Connection pool adalah indikator pressure, bukan solusi otomatis.
5. Long transaction adalah sumber lock, timeout, pool exhaustion, dan rollback mahal.
6. Slow query log tidak cukup; banyak query kecil juga bisa menghancurkan latency.
7. Hibernate statistics membantu menemukan N+1, over-fetching, dirty checking cost, flush count, dan cache behavior.
8. Tuning harus berdasarkan bottleneck class.
9. Migration, batch, cache, and read replica harus punya operational playbook.
10. Engineer top-tier tidak hanya bisa menulis persistence code; ia bisa mengoperasikan, mendiagnosis, dan memulihkan persistence system di production.

---

## 39. Referensi Resmi dan Lanjutan

- Jakarta Persistence 3.2 Specification — object/relational mapping and persistence standard for Jakarta EE and Java SE.
- Jakarta Persistence `EntityManager` API — persistence context and entity lifecycle operations.
- Hibernate ORM User Guide — fetching, batching, statistics, caching, locking, persistence context, and SQL generation behavior.
- Hibernate ORM 7 documentation — modern Hibernate/Jakarta Persistence/Jakarta Data ecosystem.
- Spring Framework Reference — transaction management, rollback behavior, transaction synchronization, and JPA integration.
- Spring Boot Actuator Metrics — Micrometer-backed metrics and production observability.
- HikariCP documentation/source — connection pool behavior and Micrometer metrics integration.
- Vendor database documentation:
  - Oracle performance/wait/session/locking documentation,
  - PostgreSQL monitoring and `EXPLAIN ANALYZE` documentation,
  - MySQL/InnoDB locking and performance schema documentation,
  - SQL Server wait stats/deadlock/execution plan documentation.

---

## 40. Status Seri

Part ini adalah:

```text
Part 031 — Production Operations: Observability, Debugging, Tuning, and Incident Response
```

Status seri:

```text
Belum selesai.
```

Bagian berikutnya adalah bagian terakhir:

```text
Part 032 — Capstone: Designing a Production-Grade Persistence Layer for a Complex Case Management System
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 030 — Testing Persistence Correctly](./learn-java-persistence-jpa-jakarta-data-transactions-database-integration-part-030.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 032 — Capstone: Designing a Production-Grade Persistence Layer for a Complex Case Management System](./learn-java-persistence-jpa-jakarta-data-transactions-database-integration-part-032.md)
