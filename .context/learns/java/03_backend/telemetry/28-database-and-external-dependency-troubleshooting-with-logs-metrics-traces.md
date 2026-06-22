# Part 28 — Database and External Dependency Troubleshooting with Logs, Metrics, Traces

Series: `learn-java-logging-observability-profiling-troubleshooting-engineering`  
Scope: Java 8 sampai Java 25  
Fokus: JDBC, HikariCP, database latency, locks/deadlocks, slow query, HTTP/gRPC dependency, retry/timeout/circuit breaker, dan korelasi logs–metrics–traces.

---

## 0. Tujuan Part Ini

Pada part sebelumnya kita sudah membangun fondasi besar:

- log sebagai event evidence,
- trace sebagai causal execution story,
- metric sebagai compressed runtime signal,
- profiler/JFR/dump sebagai cost evidence,
- context propagation sebagai identitas runtime.

Part ini mulai masuk ke salah satu sumber incident Java backend paling umum: **dependency di luar JVM**.

Dalam sistem enterprise, aplikasi Java jarang gagal sendirian. Ia biasanya gagal karena interaksi dengan:

- database,
- connection pool,
- external HTTP API,
- gRPC service,
- message broker,
- cache,
- identity provider,
- object storage,
- DNS,
- network path,
- TLS handshake,
- downstream service yang lambat,
- upstream service yang melakukan retry storm.

Engineer biasa sering berhenti pada kalimat:

> “DB lambat.”  
> “API timeout.”  
> “Connection pool habis.”  
> “Downstream issue.”

Engineer yang lebih kuat bertanya:

1. Lambat di fase mana?
2. Apakah menunggu connection pool, mengeksekusi SQL, menunggu lock, fetch result, deserialize, atau commit?
3. Apakah timeout terjadi saat connect, TLS handshake, acquire connection, write request, read response, atau total deadline?
4. Apakah error global, endpoint-specific, tenant-specific, atau data-specific?
5. Apakah masalah karena dependency benar-benar lambat, atau aplikasi kita menekan dependency dengan concurrency/retry yang salah?
6. Apakah root cause dependency, pool sizing, missing index, transaction terlalu panjang, retry storm, DNS, saturation, atau thread blocking?

Part ini akan membangun cara pikir tersebut.

---

## 1. Mental Model: Dependency Is a Latency Amplifier

Dependency bukan hanya komponen eksternal. Dependency adalah **amplifier**.

Satu database query yang naik dari 50 ms menjadi 2 detik bisa menyebabkan:

- request thread tertahan,
- HikariCP connection lebih lama dipinjam,
- active connection naik,
- pending connection naik,
- connection acquisition timeout,
- servlet worker penuh,
- queue request menumpuk,
- latency seluruh endpoint naik,
- retry dari caller meningkat,
- DB makin berat,
- error rate naik,
- circuit breaker terbuka,
- batch job tertunda,
- downstream lain ikut timeout,
- logs meledak karena error storm.

Dependency failure chain sering berbentuk seperti ini:

```text
small dependency slowdown
        ↓
longer resource holding time
        ↓
pool saturation
        ↓
thread/request queue saturation
        ↓
timeout/retry storm
        ↓
error amplification
        ↓
incident terlihat seperti “semua lambat”
```

Karena itu, dependency troubleshooting harus selalu melihat:

1. **Call latency** — berapa lama operasi dependency berlangsung.
2. **Queue/acquire latency** — berapa lama menunggu resource sebelum call dimulai.
3. **Concurrency** — berapa banyak operasi dependency aktif bersamaan.
4. **Error distribution** — error jenis apa, endpoint mana, dependency mana.
5. **Retry behavior** — apakah retry membantu atau memperburuk.
6. **Timeout budget** — apakah timeout konsisten dari upstream sampai downstream.
7. **Resource ownership** — siapa yang memegang connection/thread/socket terlalu lama.
8. **Data shape** — apakah masalah dipicu data/query tertentu.

---

## 2. Dependency Troubleshooting Evidence Model

Untuk setiap dependency, kita butuh minimal enam evidence layer.

```text
┌─────────────────────────────────────────────────────────────┐
│ Business/Workflow Evidence                                  │
│ case.id, tenant.id, operation, state transition, outcome     │
└─────────────────────────────────────────────────────────────┘
                            │
┌─────────────────────────────────────────────────────────────┐
│ Application Logs                                             │
│ event.name, dependency.name, timeout.phase, error.kind       │
└─────────────────────────────────────────────────────────────┘
                            │
┌─────────────────────────────────────────────────────────────┐
│ Distributed Traces                                           │
│ client span, db span, retry span/event, downstream span      │
└─────────────────────────────────────────────────────────────┘
                            │
┌─────────────────────────────────────────────────────────────┐
│ Metrics                                                      │
│ latency histogram, error rate, pool active/pending/idle      │
└─────────────────────────────────────────────────────────────┘
                            │
┌─────────────────────────────────────────────────────────────┐
│ JVM Evidence                                                 │
│ thread dump, JFR socket/db wait, allocation, locks           │
└─────────────────────────────────────────────────────────────┘
                            │
┌─────────────────────────────────────────────────────────────┐
│ Dependency-Side Evidence                                     │
│ DB wait events, slow query log, lock graph, downstream logs  │
└─────────────────────────────────────────────────────────────┘
```

Top-tier debugging terjadi ketika kita bisa menyambungkan semua layer ini menjadi timeline.

---

## 3. Dependency Taxonomy untuk Java Backend

Tidak semua dependency punya failure mode yang sama.

| Dependency | Primary Bottleneck | Common Evidence |
|---|---|---|
| JDBC database | connection pool, lock, slow query, transaction | Hikari metrics, DB spans, slow query log, thread dump |
| HTTP REST API | connect/read timeout, status errors, retry storm | client spans, HTTP metrics, access logs |
| gRPC API | deadline exceeded, unavailable, stream cancellation | RPC spans, deadline metrics, channel state |
| Message broker | lag, unacked messages, redelivery, poison message | consumer metrics, message ID logs, broker metrics |
| Cache/Redis | latency, connection saturation, hot key | cache metrics, command latency, key cardinality |
| Identity provider | token validation latency, JWKS fetch, login callback | auth spans, security logs, HTTP client metrics |
| DNS | resolution latency/failure | JFR network events, JVM/network logs |
| Object storage | upload/download latency, retry, multipart failure | HTTP spans, object key metadata, retry logs |
| Email/SMS gateway | slow send, throttling, provider rejection | dependency logs, status codes, retry count |

Part ini fokus terutama pada:

1. database/JDBC/HikariCP,
2. HTTP/gRPC dependency,
3. resilience mechanism seperti retry, timeout, circuit breaker, bulkhead.

Messaging lebih detail dibahas di Part 29.

---

# Section A — Database/JDBC Troubleshooting

---

## 4. JDBC Call Is Not One Thing

Ketika aplikasi Java melakukan operasi database, waktu totalnya bisa tersebar ke banyak fase:

```text
request arrives
   ↓
wait for application thread
   ↓
wait/acquire JDBC connection from pool
   ↓
prepare statement
   ↓
bind parameters
   ↓
network round-trip to database
   ↓
parse SQL / find execution plan
   ↓
wait for DB CPU / IO / lock / latch
   ↓
execute SQL
   ↓
fetch result rows
   ↓
map rows to objects
   ↓
application processing
   ↓
commit/rollback
   ↓
return connection to pool
```

Kalimat “query lambat” belum cukup. Kita harus tahu fase mana yang lambat.

---

## 5. HikariCP Mental Model

HikariCP adalah connection pool. Pool bukan database. Pool adalah resource governor antara aplikasi dan database.

```text
Application threads
       │
       │ acquire connection
       ▼
┌───────────────────────┐
│ HikariCP Pool          │
│ idle connections       │
│ active connections     │
│ pending waiters        │
│ max pool size          │
└───────────────────────┘
       │
       │ physical JDBC connections
       ▼
Database
```

Pool memiliki tiga kondisi penting:

1. **Idle connection** — connection tersedia.
2. **Active connection** — connection sedang dipakai aplikasi.
3. **Pending thread** — thread menunggu connection tersedia.

Jika `active == maximumPoolSize` dan `pending > 0`, pool saturated.

Tetapi penyebab saturated bisa banyak:

- query lambat,
- transaction terlalu panjang,
- connection leak,
- pool terlalu kecil,
- concurrency aplikasi terlalu besar,
- database lambat,
- downstream DB lock,
- retry storm,
- batch job memakan semua connection,
- thread memegang connection sambil call HTTP dependency lain,
- connection validation lambat,
- network/database failover.

---

## 6. HikariCP Metrics yang Wajib Ada

Minimal metrics:

| Metric | Makna |
|---|---|
| active connections | connection sedang dipakai |
| idle connections | connection siap dipakai |
| pending threads | thread menunggu connection |
| max connections | batas pool |
| min idle | target idle |
| connection acquisition time | waktu menunggu connection |
| connection usage time | durasi connection dipinjam |
| connection creation time | waktu membuat connection fisik |
| timeout count | jumlah acquisition timeout |

Interpretasi praktis:

```text
active high + pending high + DB query latency high
    → DB/query/lock lambat atau connection dipakai terlalu lama

active high + pending high + DB latency normal
    → connection leak, app-level holding, pool too small, long transaction

idle high + request latency high
    → bottleneck bukan pool; cek thread, external API, CPU, locks

connection creation time high
    → DB/network/TLS/auth handshake issue

pending spikes only during traffic burst
    → pool/concurrency sizing atau burst control issue
```

HikariCP sendiri menyediakan integrasi metrics melalui metrics library seperti Dropwizard, Prometheus, atau Micrometer tergantung setup aplikasi.

---

## 7. HikariCP Config yang Paling Sering Salah Dimengerti

### 7.1 `maximumPoolSize`

Bukan berarti makin besar makin baik.

Pool terlalu besar bisa membuat database makin lambat karena:

- terlalu banyak concurrent query,
- DB CPU contention,
- DB IO contention,
- lock contention meningkat,
- memory/session DB meningkat,
- context switching di DB meningkat.

Pool size harus sesuai dengan:

- DB capacity,
- service instance count,
- workload type,
- transaction duration,
- concurrency budget,
- downstream SLA.

Formula kasar:

```text
total_db_connections = app_instances × max_pool_size_per_instance
```

Kalau ada 10 pod dan tiap pod `maximumPoolSize=50`, maka aplikasi bisa membuka 500 connection ke DB. Ini sering terlalu besar untuk database enterprise.

### 7.2 `connectionTimeout`

Ini waktu maksimum thread menunggu connection dari pool. Jika habis, aplikasi biasanya mendapat exception seperti:

```text
SQLTransientConnectionException: Connection is not available, request timed out after ... ms
```

Makna exception ini bukan otomatis “database down”. Artinya aplikasi tidak dapat memperoleh connection dari pool dalam batas waktu.

Kemungkinan penyebab:

- semua connection aktif,
- connection leak,
- transaksi panjang,
- DB lambat,
- pool terlalu kecil,
- traffic burst,
- retry storm.

### 7.3 `leakDetectionThreshold`

Fitur ini membantu mendeteksi connection yang dipinjam terlalu lama. Tetapi jangan disalahartikan sebagai bukti final leak.

Jika threshold 30 detik dan query normal memang butuh 45 detik, leak detection akan berbunyi walau bukan leak teknis. Itu tetap evidence penting: connection dipinjam terlalu lama.

### 7.4 `maxLifetime`

Connection tidak boleh hidup lebih lama dari batas tertentu. Jika diset terlalu dekat dengan timeout di network/load balancer/database, bisa terjadi churn connection.

### 7.5 `minimumIdle`

Terlalu rendah bisa membuat cold burst lambat karena harus membuat connection baru. Terlalu tinggi bisa memboroskan connection DB.

---

## 8. JDBC Observability Span Design

Untuk database, auto instrumentation biasanya membuat span seperti:

```text
Span kind: CLIENT
Name     : SELECT table_name / DB operation
Attrs    : db.system, db.name, db.operation, db.statement? / db.query.text?
```

Namun production system harus berhati-hati dengan SQL text.

### 8.1 Query Text Risk

SQL text bisa berisi:

- PII literal,
- case ID,
- document number,
- free text search,
- business-sensitive condition,
- tenant information.

Lebih aman memakai:

- query name,
- query fingerprint,
- repository method,
- mapper ID,
- prepared statement template yang disanitasi,
- operation name.

Contoh structured log:

```java
logger.info("Database operation completed",
    kv("event.name", "db.operation.completed"),
    kv("db.system", "oracle"),
    kv("db.operation", "select"),
    kv("db.query.name", "case.findActiveByAgency"),
    kv("db.duration_ms", durationMs),
    kv("db.rows", rowCount),
    kv("outcome", "success"));
```

### 8.2 Span Boundary

Jangan membuat span hanya untuk `repository.findById()` jika bottleneck sebenarnya adalah:

- acquire connection,
- query execution,
- result mapping,
- transaction commit.

Idealnya ada layering:

```text
HTTP SERVER span
  └─ business operation span
      └─ db transaction span
          ├─ db query span: find case
          ├─ db query span: update status
          └─ db commit event/span
```

Namun jangan terlalu granular untuk setiap getter/mapper kecil.

---

## 9. Database Latency Taxonomy

Ketika DB latency naik, klasifikasikan.

| Category | Symptom | Evidence |
|---|---|---|
| Pool wait | latency sebelum query | Hikari pending/acquire time high |
| Slow SQL | execution lama | DB span duration high, slow query log |
| Lock wait | query menunggu lock | DB wait event, blocked session, long transaction |
| Fetch/mapping | SQL cepat tapi app lambat | DB server time low, client span high, CPU/allocation high |
| Commit slow | transaksi selesai lambat saat commit | commit span/event high |
| Network latency | round trip tinggi | socket/JFR events, dependency spans |
| DB CPU saturated | banyak query lambat | DB CPU high, all queries affected |
| DB IO saturated | reads/writes lambat | DB IO wait high, specific query shapes |
| Plan regression | query tertentu tiba-tiba lambat | explain plan changed, stats/index issue |
| Connection churn | create connection lambat/sering | Hikari creation time high |

---

## 10. The Four Clocks of Database Troubleshooting

Untuk diagnosis DB, selalu bedakan empat jam waktu:

```text
1. App observed duration
   waktu dari perspektif aplikasi Java

2. Pool wait duration
   waktu menunggu connection dari HikariCP

3. DB execution duration
   waktu statement diproses DB

4. End-to-end request duration
   waktu total request user/API
```

Contoh:

```text
HTTP request duration: 5000 ms
Business operation span: 4800 ms
Hikari acquire: 3000 ms
DB query span: 200 ms
Mapping: 50 ms
```

Diagnosis:

> Query bukan masalah utama. Pool wait adalah masalah utama.

Contoh lain:

```text
HTTP request duration: 5000 ms
Hikari acquire: 5 ms
DB query span: 4600 ms
Rows returned: 5
```

Diagnosis:

> Pool sehat. Query/DB wait/lock/plan kemungkinan masalah utama.

---

## 11. Slow Query Troubleshooting

Slow query harus dianalisis dari dua sisi.

### 11.1 Dari Aplikasi

Evidence aplikasi:

- endpoint/operation mana,
- query name,
- query duration,
- row count,
- parameter shape yang aman,
- trace ID,
- transaction ID,
- connection acquire time,
- retry count,
- timeout.

Log contoh:

```json
{
  "event.name": "db.query.slow",
  "severity": "WARN",
  "trace.id": "...",
  "span.id": "...",
  "db.system": "oracle",
  "db.query.name": "case.searchForOfficerInbox",
  "db.operation": "select",
  "db.duration_ms": 2812,
  "db.rows": 1000,
  "threshold_ms": 1000,
  "module": "case-management",
  "outcome": "slow"
}
```

### 11.2 Dari Database

Evidence DB:

- SQL ID/query fingerprint,
- execution plan,
- estimated vs actual rows,
- indexes used/not used,
- wait events,
- lock/blocking session,
- parse time,
- CPU time,
- IO reads,
- temp usage,
- plan change,
- statistics freshness.

### 11.3 Jangan Langsung Menambah Index

Index bisa membantu, tetapi juga punya cost:

- write lebih lambat,
- storage lebih besar,
- optimizer bisa memilih plan lain,
- maintenance overhead,
- index contention pada workload tertentu.

Diagnosis yang benar:

```text
slow query observed
  → identify query fingerprint
  → compare normal vs bad window
  → inspect plan/wait/rows
  → confirm data distribution
  → test index/query rewrite safely
  → measure before/after
```

---

## 12. Lock Wait and Transaction Troubleshooting

Lock wait sering terlihat sebagai “query lambat”, padahal SQL-nya sendiri sederhana.

Contoh:

```sql
UPDATE case SET status = ? WHERE id = ?
```

Jika row sedang di-lock transaksi lain, query bisa menunggu lama.

Evidence aplikasi:

- update/delete statement duration tinggi,
- transaction duration panjang,
- request tertentu memegang transaction sambil melakukan HTTP call,
- Hikari connection usage time tinggi,
- thread dump menunjukkan banyak thread di JDBC driver/socket read.

Evidence DB:

- blocking session,
- blocked session,
- lock wait event,
- row/table lock,
- transaction age,
- SQL yang memegang lock.

Anti-pattern besar:

```java
@Transactional
public void submitCase(...) {
    Case c = repository.find(...);
    c.submit();
    repository.save(c);

    // BAD: holding DB transaction while calling external system
    externalSystem.notifySubmission(c);
}
```

Lebih aman:

```text
transactional state change
  → commit
  → publish event/outbox
  → external notification async/retryable
```

Atau jika harus sinkron:

```text
call dependency before transaction
or
keep transaction extremely short
```

---

## 13. Transaction Duration as a First-Class Metric

Banyak sistem punya DB query metrics tetapi tidak punya transaction duration metrics.

Padahal connection pool saturation sering disebabkan transaction terlalu panjang.

Metrics penting:

```text
app.transaction.duration
app.transaction.active
app.transaction.rollback.count
app.transaction.commit.duration
app.transaction.timeout.count
```

Attributes low-cardinality:

```text
transaction.name = case.submit
module = case-management
outcome = commit|rollback|timeout
```

Jangan pakai:

```text
case.id as metric label
user.id as metric label
sql text as metric label
```

---

## 14. N+1 Query Detection

N+1 terjadi ketika satu operasi bisnis memicu banyak query kecil.

Trace pattern:

```text
HTTP GET /cases/123
  ├─ SELECT case by id
  ├─ SELECT applicant by id
  ├─ SELECT document by case id
  ├─ SELECT comment by case id
  ├─ SELECT user by id
  ├─ SELECT user by id
  ├─ SELECT user by id
  └─ ... repeated many times
```

Metric/log pattern:

- DB query count per request tinggi,
- banyak query identik dengan parameter berbeda,
- endpoint latency naik mengikuti jumlah child objects,
- DB CPU naik walau setiap query cepat.

Evidence yang berguna:

```text
request.db.query.count
request.db.total_duration_ms
request.db.unique_query_count
request.result.size
```

Praktik baik:

- trace child DB spans,
- record query count per request,
- alert jika query count abnormal,
- gunakan fetch strategy eksplisit,
- batch fetch atau join sesuai kebutuhan,
- jangan enable full SQL logging di production tanpa sampling.

---

## 15. Connection Leak vs Long Usage

Connection leak berarti connection dipinjam dan tidak dikembalikan.

Long usage berarti connection dikembalikan, tetapi terlalu lama.

Keduanya berbeda.

| Condition | Active | Pending | Eventually Returns? | Typical Cause |
|---|---:|---:|---|---|
| Leak | high | high | no/very late | missing close, broken transaction lifecycle |
| Long usage | high | high | yes | slow query, long transaction, external call inside transaction |
| Pool too small | high | temporary high | yes | concurrency > pool capacity |
| DB down | active may vary | high | no new connections | connection creation/validation failure |

Hikari leak detection membantu menemukan connection yang dipinjam lebih lama dari threshold, tetapi tidak otomatis membuktikan permanent leak.

---

## 16. Thread Dump Pattern for DB Problems

Thread dump bisa menunjukkan banyak thread berada di JDBC driver atau socket read.

Contoh pattern:

```text
http-nio-8080-exec-42 RUNNABLE
  at java.net.SocketInputStream.socketRead0(Native Method)
  at java.net.SocketInputStream.socketRead(...)
  at oracle.jdbc.driver.T4CMAREngineNIO... 
  at oracle.jdbc.driver.OraclePreparedStatement.executeQuery(...)
```

Interpretasi hati-hati:

- `RUNNABLE` bukan berarti CPU aktif.
- Native socket read bisa muncul sebagai RUNNABLE pada beberapa JVM/OS.
- Banyak thread di JDBC socket read bisa berarti menunggu DB response.
- Korelasikan dengan DB wait events dan query spans.

Pattern pool wait:

```text
http-nio-8080-exec-21 TIMED_WAITING
  at java.util.concurrent.locks.AbstractQueuedSynchronizer$ConditionObject.awaitNanos
  at com.zaxxer.hikari.pool.HikariPool.getConnection
  at com.zaxxer.hikari.HikariDataSource.getConnection
```

Interpretasi:

> Thread menunggu connection dari pool, belum tentu query sedang berjalan.

---

## 17. Database Troubleshooting Playbook

Saat incident DB/dependency terjadi, lakukan urutan ini.

### Step 1 — Tentukan Blast Radius

Tanya:

- semua endpoint atau endpoint tertentu?
- semua tenant/agency atau tenant tertentu?
- read only atau write path?
- semua instance atau pod tertentu?
- semua DB operation atau query tertentu?
- terjadi setelah deploy/config/data load/batch?

### Step 2 — Baca Metrics

Lihat:

- HTTP latency/error rate,
- Hikari active/idle/pending,
- connection acquisition time,
- DB query latency histogram,
- DB error count,
- transaction duration,
- thread pool active/queue,
- CPU/memory/GC.

### Step 3 — Ambil Trace Sample

Cari trace lambat.

Tentukan:

- waktu habis di pool wait atau query?
- query mana?
- dependency mana?
- retry berapa kali?
- ada lock/fallback/circuit breaker?

### Step 4 — Ambil Thread Dump

Cari:

- thread menunggu Hikari,
- thread di JDBC driver,
- lock contention,
- servlet worker exhaustion,
- batch job consuming all resources.

### Step 5 — Bandingkan dengan DB-Side Evidence

Minta/cek:

- active sessions,
- blocking sessions,
- slow SQL,
- wait events,
- CPU/IO,
- plan changes,
- connection count.

### Step 6 — Mitigasi

Tergantung evidence:

| Evidence | Mitigation Candidate |
|---|---|
| Pool pending high karena slow query | reduce traffic, kill bad query, optimize query, add index cautiously |
| Pool pending high karena batch | throttle batch, separate pool, schedule off peak |
| Lock wait | terminate blocker, shorten transaction, fix transaction boundary |
| Retry storm | reduce retry, add jitter, open circuit breaker |
| Pool too small but DB healthy | cautiously increase pool or reduce app concurrency |
| DB CPU saturated | reduce concurrency, throttle heavy endpoints, query/index fix |
| Connection leak | rollback/restart affected instance, fix leak, add leak detection |

### Step 7 — Permanent Fix

- add missing evidence,
- tune timeout budget,
- fix transaction boundary,
- redesign query,
- add idempotency,
- separate batch pool,
- add concurrency limiter,
- improve dashboard/alert.

---

# Section B — HTTP/gRPC Dependency Troubleshooting

---

## 18. HTTP Client Call Is Also Not One Thing

HTTP latency terdiri dari beberapa fase:

```text
resolve DNS
  ↓
connect TCP
  ↓
TLS handshake
  ↓
acquire connection from HTTP client pool
  ↓
write request headers/body
  ↓
wait server processing
  ↓
read response headers
  ↓
read response body
  ↓
deserialize
```

Timeout juga harus spesifik.

| Timeout | Makna |
|---|---|
| DNS timeout | gagal resolve host |
| connect timeout | gagal membuat TCP connection |
| TLS handshake timeout | handshake lambat/gagal |
| connection pool acquire timeout | tidak dapat socket dari pool |
| write timeout | lambat mengirim request/body |
| read timeout | lambat menerima response |
| call/total timeout | deadline total operasi habis |

Jika log hanya berbunyi:

```text
External API timeout
```

itu tidak cukup.

Lebih baik:

```json
{
  "event.name": "dependency.http.timeout",
  "dependency.name": "payment-service",
  "http.method": "POST",
  "url.route": "/payments/{id}/confirm",
  "timeout.phase": "read",
  "timeout.ms": 3000,
  "duration.ms": 3002,
  "attempt": 1,
  "max_attempts": 2,
  "outcome": "timeout"
}
```

---

## 19. HTTP Client Observability Minimum

Metrics:

```text
http.client.request.duration
http.client.request.count
http.client.error.count
http.client.timeout.count
http.client.active.requests
http.client.connection.pool.active
http.client.connection.pool.idle
http.client.connection.pool.pending
```

Labels/attributes low-cardinality:

```text
http.method
server.address or dependency.name
url.route, not raw URL
http.response.status_code
error.type
timeout.phase
```

Avoid:

```text
full URL with IDs/query params as metric label
Authorization header
request body
response body
user ID as metric label
```

Trace:

```text
HTTP SERVER span
  └─ business operation span
      └─ HTTP CLIENT span dependency.name=payment-service route=/payments/{id}/confirm
```

Log:

- log dependency failure,
- log timeout with phase if possible,
- log retry summary,
- log circuit breaker transition,
- avoid logging every successful dependency call at INFO for high-volume paths.

---

## 20. gRPC Dependency Observability

gRPC punya konsep deadline yang lebih eksplisit.

Common status:

| gRPC Status | Meaning |
|---|---|
| `OK` | success |
| `DEADLINE_EXCEEDED` | deadline habis |
| `UNAVAILABLE` | service unavailable/network issue |
| `RESOURCE_EXHAUSTED` | quota/resource limit |
| `INVALID_ARGUMENT` | client input invalid |
| `PERMISSION_DENIED` | authz failure |
| `UNAUTHENTICATED` | authn failure |
| `CANCELLED` | call cancelled |

Observability fields:

```text
rpc.system = grpc
rpc.service
rpc.method
rpc.grpc.status_code
deadline.ms
attempt
peer.service
```

For streaming:

- stream opened,
- message count sent/received,
- stream duration,
- cancellation reason,
- backpressure state.

---

## 21. Dependency Error Taxonomy

Dependency error harus diklasifikasi agar retry/circuit breaker/alert benar.

| Category | Retry? | Example |
|---|---|---|
| connect timeout | maybe | network/downstream unavailable |
| read timeout | maybe, if idempotent | downstream slow |
| 429/rate limited | retry with backoff | quota exceeded |
| 503 unavailable | retry with backoff | overload/deploy |
| 500 internal | cautious retry | downstream bug/transient |
| 400 bad request | no | our request invalid |
| 401/403 | no immediate retry | auth/token/permission issue |
| 404 | usually no | missing resource, unless eventual consistency |
| serialization error | no | contract mismatch |
| TLS error | no blind retry | certificate/config issue |
| DNS error | cautious | resolution issue |
| connection reset | maybe | network/server closed |

The rule:

> Retry only when the operation is safe or idempotent, and only when retry has a chance to help.

---

## 22. Retry as an Amplifier

Retry is not free. Retry multiplies load.

If one request makes one downstream call and retry max is 3:

```text
100 incoming requests/sec
× 3 attempts
= up to 300 downstream calls/sec
```

If upstream also retries:

```text
caller retry × service retry × DB retry
= multiplicative retry storm
```

Good retry evidence:

```json
{
  "event.name": "dependency.retry.completed",
  "dependency.name": "onemap-api",
  "operation": "postal-code.lookup",
  "attempts": 3,
  "final.outcome": "success",
  "last.error.type": "http.429",
  "backoff.strategy": "exponential_jitter",
  "duration.ms": 1420
}
```

Bad retry logging:

```text
ERROR timeout
ERROR timeout
ERROR timeout
ERROR timeout
```

Better pattern:

- DEBUG/WARN per failed attempt depending severity,
- one summary event at end,
- include attempts and final outcome,
- record metric attempt count,
- trace span events for attempts.

---

## 23. Timeout Budgeting

Timeout harus konsisten secara end-to-end.

Bad:

```text
User request timeout: 5s
Service A calls B with timeout: 10s
Service B calls DB with timeout: 30s
Retry count: 3
```

Ini tidak masuk akal. Caller sudah timeout sebelum callee selesai.

Better:

```text
Client/API gateway timeout: 10s
Service A total budget: 8s
Service A → B timeout: 3s
Service A retry max: 1 retry if idempotent
Service B DB timeout: 1.5s
Fallback or async continuation if longer
```

Timeout budget harus memperhitungkan:

- user-facing SLA,
- upstream timeout,
- downstream timeout,
- retry count,
- backoff delay,
- queue wait,
- DB pool acquire timeout,
- transaction timeout.

---

## 24. Circuit Breaker Observability

Circuit breaker mencegah service terus memanggil dependency yang sedang gagal.

State umum:

```text
CLOSED → normal
OPEN → calls rejected/fail fast
HALF_OPEN → limited trial calls
```

Metrics penting:

```text
circuitbreaker.state
circuitbreaker.calls.success
circuitbreaker.calls.failed
circuitbreaker.calls.slow
circuitbreaker.calls.not_permitted
```

Logs penting:

- state transition,
- reason,
- dependency name,
- failure rate,
- slow call rate,
- window size,
- open duration.

Example:

```json
{
  "event.name": "circuitbreaker.state.changed",
  "dependency.name": "payment-service",
  "previous.state": "CLOSED",
  "new.state": "OPEN",
  "failure.rate": 64.0,
  "slow.call.rate": 72.0,
  "minimum.calls": 100,
  "outcome": "fail_fast_enabled"
}
```

Common mistake:

- circuit breaker configured but no metric/log on transitions,
- circuit breaker around wrong boundary,
- fallback hides real error,
- circuit breaker opens for client bugs like 400,
- breaker per high-cardinality key causing memory/cardinality explosion.

---

## 25. Bulkhead and Concurrency Limit

Bulkhead membatasi jumlah concurrent call ke dependency tertentu.

Tanpa bulkhead:

```text
slow dependency consumes all request threads
```

Dengan bulkhead:

```text
slow dependency consumes only its allocated concurrency budget
other flows survive
```

Metrics:

```text
bulkhead.available.concurrent.calls
bulkhead.max.allowed.concurrent.calls
bulkhead.rejected.calls
bulkhead.queue.depth
bulkhead.queue.wait.duration
```

Design rule:

> Pool, thread, and concurrency limits must align.

Bad:

```text
Tomcat threads: 200
Hikari max pool: 20
HTTP downstream client max connections: unlimited
Retry: 3
No bulkhead
```

Better:

```text
Tomcat threads: 200
Hikari max pool: 20
DB-heavy endpoint concurrency limiter: 30
Downstream API bulkhead: 50
Retry with jitter only for idempotent calls
```

---

# Section C — Cross-Signal Diagnosis Patterns

---

## 26. Pattern: DB Pool Exhaustion

Symptoms:

- HTTP latency high,
- error rate high,
- logs show Hikari timeout,
- Hikari active at max,
- pending threads high,
- thread dump shows many threads waiting in `HikariPool.getConnection`.

Diagnosis tree:

```text
Hikari pending high
  ├─ DB query latency high?
  │    ├─ yes → inspect slow query/lock/DB CPU/IO
  │    └─ no  → inspect transaction duration/leak/pool sizing
  │
  ├─ connection usage high?
  │    ├─ yes → long transaction/slow dependency inside transaction
  │    └─ no  → burst sizing or acquisition config
  │
  └─ only one endpoint?
       ├─ yes → endpoint/query-specific issue
       └─ no  → DB/global pool/system issue
```

Immediate evidence to collect:

```bash
jcmd <pid> Thread.print > thread-dump.txt
jcmd <pid> JFR.dump name=continuous filename=incident.jfr
```

Metrics to inspect:

```text
hikaricp.connections.active
hikaricp.connections.pending
hikaricp.connections.idle
hikaricp.connections.timeout
http.server.request.duration
http.server.request.errors
db.client.operation.duration
```

---

## 27. Pattern: Downstream HTTP Timeout Storm

Symptoms:

- many dependency timeout logs,
- retry count high,
- outbound HTTP duration high,
- circuit breaker maybe opens,
- CPU might rise due to logging/retry,
- thread dump shows many HTTP client threads waiting on socket read.

Diagnosis:

```text
timeout storm
  ├─ dependency globally slow/down?
  ├─ only specific endpoint/tenant/data?
  ├─ timeout too aggressive or too loose?
  ├─ retry multiplying load?
  ├─ circuit breaker configured?
  ├─ HTTP client connection pool saturated?
  └─ DNS/TLS/connect issue?
```

Good mitigation:

- reduce retry count,
- add jitter,
- fail fast for non-critical dependency,
- open circuit breaker,
- cache stable responses,
- degrade gracefully,
- protect thread pool with bulkhead.

Bad mitigation:

- blindly increase read timeout,
- blindly increase all thread pools,
- log every timeout stack trace at ERROR repeatedly,
- add more retries.

---

## 28. Pattern: Slow Query Hidden by Trace Sampling

If trace sampling is 1%, rare slow queries might not appear.

Solution:

- always sample errors,
- sample slow requests,
- use metric exemplars if available,
- log structured slow query events with trace ID,
- DB-side slow query log.

Rule:

> Sampling strategy must preserve abnormal evidence, not only random traffic.

---

## 29. Pattern: Dependency Fallback Hides Incident

Fallback can protect users, but it can also hide a dependency failure.

Example:

```java
try {
    return profileClient.getProfile(userId);
} catch (Exception e) {
    return Profile.empty();
}
```

Bad because:

- no metric,
- no log,
- no trace status,
- business impact hidden,
- data quality degrades silently.

Better:

```java
try {
    return profileClient.getProfile(userId);
} catch (ProfileDependencyException e) {
    metrics.counter("dependency.fallback.used", "dependency", "profile-service").increment();
    logger.warn("Dependency fallback used",
        kv("event.name", "dependency.fallback.used"),
        kv("dependency.name", "profile-service"),
        kv("fallback.name", "empty-profile"),
        kv("error.type", e.getClass().getSimpleName()));
    return Profile.emptyWithReason("dependency_unavailable");
}
```

---

## 30. Pattern: Long Transaction Holds DB Connection During External Call

Bad pattern:

```text
open transaction
  ↓
read/update DB
  ↓
call external API for 3 seconds
  ↓
commit
```

Symptoms:

- Hikari connection usage high,
- pool pending high,
- DB query not necessarily slow,
- thread dump shows HTTP client calls inside transactional service stack,
- DB connections active while waiting for external API.

Fix options:

1. Move external call outside transaction.
2. Use outbox pattern.
3. Split transaction into smaller units.
4. Use async workflow.
5. Store intent, commit, then notify.
6. Add transaction duration metrics.

---

## 31. Pattern: Raw URL / SQL Cardinality Explosion

Bad metric label:

```text
url.full=/cases/CASE-2026-0000123/documents/9981?user=abc
```

Bad DB label:

```text
sql=select * from case where id='CASE-2026-0000123'
```

Consequence:

- metrics storage explosion,
- dashboard slow,
- high cost,
- alert unreliable,
- possible PII leak.

Better:

```text
url.route=/cases/{caseId}/documents/{documentId}
db.query.name=caseDocument.findByCase
db.query.fingerprint=abc123
```

---

# Section D — Implementation Blueprint

---

## 32. Dependency Call Logging Standard

For dependency failure logs, use one summary event per operation.

Required fields:

```text
event.name
dependency.name
dependency.type
operation
outcome
duration.ms
attempts
error.type
error.category
trace.id
span.id
correlation.id
```

For timeout:

```text
timeout.phase
timeout.ms
elapsed.ms
```

For HTTP:

```text
http.method
url.route
http.response.status_code
```

For DB:

```text
db.system
db.operation
db.query.name
db.rows
db.duration.ms
db.acquire.duration.ms
```

For retry:

```text
retry.max_attempts
retry.attempts
retry.backoff.strategy
retry.final_outcome
```

---

## 33. Java Helper: Dependency Timer Pattern

A simple dependency timer should capture duration and outcome.

```java
public final class DependencyTimer {
    private final Logger logger = LoggerFactory.getLogger(DependencyTimer.class);

    public <T> T record(String dependencyName,
                        String dependencyType,
                        String operation,
                        Supplier<T> supplier) {
        long startNanos = System.nanoTime();
        try {
            T result = supplier.get();
            long durationMs = elapsedMs(startNanos);
            logger.debug("Dependency call completed",
                    kv("event.name", "dependency.call.completed"),
                    kv("dependency.name", dependencyName),
                    kv("dependency.type", dependencyType),
                    kv("operation", operation),
                    kv("duration.ms", durationMs),
                    kv("outcome", "success"));
            return result;
        } catch (RuntimeException e) {
            long durationMs = elapsedMs(startNanos);
            logger.warn("Dependency call failed",
                    kv("event.name", "dependency.call.failed"),
                    kv("dependency.name", dependencyName),
                    kv("dependency.type", dependencyType),
                    kv("operation", operation),
                    kv("duration.ms", durationMs),
                    kv("error.type", e.getClass().getSimpleName()),
                    kv("outcome", "failure"),
                    e);
            throw e;
        }
    }

    private long elapsedMs(long startNanos) {
        return TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startNanos);
    }
}
```

In real production code, prefer integrating with:

- OpenTelemetry span,
- Micrometer/OTel metrics,
- SLF4J key-value logging,
- safe exception taxonomy,
- sampling/rate-limiting.

---

## 34. JDBC Query Naming Pattern

Avoid logging raw SQL everywhere. Create stable operation names.

```java
public enum DbQueryName {
    CASE_FIND_BY_ID("case.findById"),
    CASE_SEARCH_OFFICER_INBOX("case.searchOfficerInbox"),
    CASE_UPDATE_STATUS("case.updateStatus"),
    AUDIT_INSERT_EVENT("audit.insertEvent");

    private final String value;

    DbQueryName(String value) {
        this.value = value;
    }

    public String value() {
        return value;
    }
}
```

Then use:

```java
logger.warn("Slow database query",
    kv("event.name", "db.query.slow"),
    kv("db.query.name", DbQueryName.CASE_SEARCH_OFFICER_INBOX.value()),
    kv("db.duration.ms", durationMs),
    kv("threshold.ms", 1000),
    kv("db.rows", rowCount),
    kv("outcome", "slow"));
```

---

## 35. HTTP Client Wrapper Pattern

A wrapper should record:

- dependency name,
- route template,
- method,
- duration,
- status code,
- timeout/error type,
- attempt count,
- trace context.

Pseudo-code:

```java
public final class ObservedHttpClient {
    public HttpResponse execute(ObservedHttpRequest request) {
        long start = System.nanoTime();
        int attempts = 0;

        try {
            attempts++;
            HttpResponse response = delegate.execute(request.toNativeRequest());
            long durationMs = elapsedMs(start);

            if (response.statusCode() >= 500) {
                logger.warn("HTTP dependency returned server error",
                    kv("event.name", "dependency.http.error"),
                    kv("dependency.name", request.dependencyName()),
                    kv("http.method", request.method()),
                    kv("url.route", request.routeTemplate()),
                    kv("http.response.status_code", response.statusCode()),
                    kv("duration.ms", durationMs),
                    kv("attempts", attempts),
                    kv("outcome", "failure"));
            }

            return response;
        } catch (SocketTimeoutException e) {
            long durationMs = elapsedMs(start);
            logger.warn("HTTP dependency timed out",
                kv("event.name", "dependency.http.timeout"),
                kv("dependency.name", request.dependencyName()),
                kv("http.method", request.method()),
                kv("url.route", request.routeTemplate()),
                kv("timeout.phase", "read"),
                kv("duration.ms", durationMs),
                kv("attempts", attempts),
                kv("outcome", "timeout"),
                e);
            throw new DependencyTimeoutException(request.dependencyName(), e);
        }
    }
}
```

---

## 36. OpenTelemetry Span Attribute Strategy

Use standard semantic conventions where possible.

For HTTP client spans:

```text
http.request.method
url.scheme
server.address
server.port
http.response.status_code
network.protocol.name
network.protocol.version
error.type
```

For RPC:

```text
rpc.system
rpc.service
rpc.method
rpc.grpc.status_code
server.address
server.port
error.type
```

For database:

```text
db.system.name
db.namespace
db.operation.name
db.query.text       only if safe and configured
db.response.status_code where applicable
error.type
```

Custom domain attributes should be low-cardinality:

```text
module=case-management
operation=case.submit
dependency.name=oracle-case-db
query.name=case.updateStatus
```

Avoid high-cardinality span attributes unless they are necessary and allowed:

```text
case.id
user.id
raw SQL
raw URL
request body
```

---

## 37. Dashboard Design for Dependency Health

A good dependency dashboard answers:

1. Which dependency is slow/failing?
2. Is it all operations or specific operations?
3. Is it latency, error, saturation, or queueing?
4. Is it isolated to one service instance?
5. Is retry/circuit breaker helping or hurting?
6. What is the business impact?

Dashboard panels:

### Service Overview

- request rate,
- error rate,
- p50/p95/p99 latency,
- saturation.

### DB Pool

- active connections,
- idle connections,
- pending threads,
- acquisition duration,
- timeout count,
- usage duration.

### DB Operations

- query duration by query name,
- query count by operation,
- slow query count,
- DB error count,
- transaction duration.

### HTTP Dependencies

- request duration by dependency/route,
- status code distribution,
- timeout count by phase,
- retry attempts,
- circuit breaker state,
- bulkhead rejection count.

### Correlation

- links from latency/error panels to traces,
- logs filtered by dependency name and trace ID,
- exemplars if supported.

---

## 38. Alerting Strategy

Bad alerts:

```text
Any single dependency call > 1s
Any one timeout
Any one DB error
```

Better alerts:

```text
p95 dependency latency > threshold for 5–10 minutes
AND request volume > minimum
```

```text
Hikari pending threads > 0 for 5 minutes
AND active connections near max
```

```text
connection acquisition timeout count > baseline
```

```text
circuit breaker open for critical dependency
```

```text
retry attempts per request above threshold
```

```text
DB transaction duration p95 above threshold
```

Use multi-window/multi-burn alerts where appropriate.

---

## 39. Production Anti-Patterns

### 39.1 Logging Raw SQL with Parameters at INFO

Risk:

- PII leak,
- huge logs,
- ingestion cost,
- performance overhead.

Use safe query names/fingerprints.

### 39.2 Increasing Pool Size as First Response

If DB is saturated, bigger pool makes it worse.

### 39.3 Retrying Non-Idempotent Operation

Can cause duplicate payment/submission/state transition.

### 39.4 Holding Transaction Across Network Call

Common cause of pool exhaustion.

### 39.5 No Timeout

Threads can hang for too long.

### 39.6 Timeout Longer Than Caller Deadline

Wasteful; caller already gave up.

### 39.7 Circuit Breaker Without Observability

The system silently fails fast without visible reason.

### 39.8 High-Cardinality Labels

Explodes metrics/traces cost.

### 39.9 Catch-All Fallback

Hides errors and corrupts business semantics.

### 39.10 Treating All 500s as Retryable

Some 500s are deterministic bugs.

---

## 40. Java 8 to Java 25 Considerations

### Java 8

- older GC logging flags,
- older HTTP client ecosystem mostly Apache HttpClient/OkHttp/Retrofit,
- no virtual threads,
- context propagation mostly ThreadLocal/MDC/executor wrapper,
- JFR availability depends on distribution/update history.

### Java 11

- built-in `java.net.http.HttpClient`,
- unified JVM logging,
- JFR generally available in OpenJDK,
- stronger baseline for service observability.

### Java 17

- common enterprise LTS baseline,
- strong container support,
- mature OTel/Spring ecosystem.

### Java 21

- virtual threads finalized,
- thread-per-request becomes viable for blocking IO workloads,
- pool/concurrency strategy must be rethought,
- DB connection pool remains scarce even if threads are abundant.

Important:

> Virtual threads do not make database connections unlimited.

If you move from 200 platform threads to thousands of virtual threads without concurrency limiting, you can overwhelm HikariCP or the database faster.

### Java 25

- modern virtual-thread/scoped-value ecosystem,
- improved diagnostics and JFR/JMC workflows,
- context propagation design can move away from purely ThreadLocal-heavy patterns where appropriate.

---

## 41. Virtual Threads and Dependency Troubleshooting

Virtual threads reduce the cost of blocking threads, but they do not remove bottlenecks.

Old bottleneck:

```text
Tomcat platform threads exhausted
```

New possible bottleneck:

```text
DB connections exhausted
HTTP client connection pool exhausted
Downstream service overloaded
Rate limit exceeded
Memory pressure from too many concurrent requests
```

With virtual threads, you need stronger explicit limits:

- DB pool size,
- semaphore/bulkhead per dependency,
- rate limiter,
- queue limit,
- timeout budget,
- backpressure policy.

Observability must include:

```text
virtual thread count
carrier/platform thread count
DB pool active/pending
dependency concurrency
bulkhead rejection
request queueing
```

---

## 42. Mini Case Study: DB Pool Exhaustion Misdiagnosed as Slow Database

### Situation

At 10:05, users report case submission latency.

Dashboard:

```text
HTTP p95 latency: 12s
HTTP 5xx: rising
Hikari active: 50/50
Hikari pending: 80
DB CPU: 35%
DB query p95: 120ms
```

Initial claim:

> “DB is slow.”

### Evidence

Trace sample:

```text
POST /cases/{id}/submit duration 11.8s
  ├─ Hikari acquire connection: 9.5s
  ├─ SELECT case: 40ms
  ├─ UPDATE case: 80ms
  └─ commit: 30ms
```

Thread dump:

```text
Many threads waiting in HikariPool.getConnection
```

Another trace:

```text
@Transactional submitCase
  ├─ update DB
  ├─ call document-service: 6s timeout
  └─ commit
```

### Real Cause

Transaction held DB connection while calling slow external document service.

### Fix

Immediate:

- reduce document-service timeout,
- reduce concurrency for submit endpoint,
- temporarily disable synchronous notification,
- restart only if leak suspected.

Permanent:

- move external call after commit,
- use outbox/event pattern,
- add transaction duration metric,
- add dependency span/log for document-service,
- alert on Hikari pending + transaction duration.

---

## 43. Mini Case Study: Retry Storm Against Rate-Limited API

### Situation

External API returns 429.

Service config:

```text
retry max attempts: 5
backoff: fixed 100ms
instances: 20
traffic: 100 req/s
```

Potential downstream calls:

```text
100 × 5 = 500 calls/sec
```

If each instance does this, rate limit worsens quickly.

### Evidence

Logs:

```json
{"event.name":"dependency.http.error","http.response.status_code":429,"attempt":1}
{"event.name":"dependency.http.error","http.response.status_code":429,"attempt":2}
{"event.name":"dependency.http.error","http.response.status_code":429,"attempt":3}
```

Metrics:

```text
retry attempts high
429 count high
success rate low
latency high
```

### Fix

- respect `Retry-After`,
- exponential backoff with jitter,
- reduce max attempts,
- add rate limiter,
- cache stable lookup result,
- use worker pool with global-ish throughput budget,
- log retry summary only.

---

## 44. Practical Lab 1 — Build DB Pool Dashboard

Create dashboard panels:

1. Hikari active/idle/pending.
2. Connection acquisition time p95/p99.
3. Connection timeout count.
4. Transaction duration p95.
5. Query duration by query name.
6. HTTP latency and error rate.
7. Thread count and CPU.

Run experiments:

- slow query sleep,
- connection leak simulation,
- long transaction simulation,
- pool too small simulation,
- external call inside transaction.

Expected learning:

- identify which condition produces which metric shape.

---

## 45. Practical Lab 2 — Trace HTTP Dependency Timeout

Create service A calling service B.

Scenarios:

1. service B sleeps longer than read timeout,
2. service B returns 500,
3. service B returns 429,
4. service B connection refused,
5. DNS wrong host,
6. retry enabled/disabled,
7. circuit breaker enabled/disabled.

For each scenario capture:

- logs,
- metrics,
- traces,
- exception type,
- retry count,
- circuit breaker state.

Goal:

> Be able to tell the difference between connect failure, read timeout, downstream 500, rate limit, and local connection pool saturation.

---

## 46. Practical Lab 3 — Timeout Budget Design

Given:

```text
API gateway timeout: 15s
User SLA p95: 5s
Service A calls B and DB
Service B calls C
C sometimes slow
```

Design:

- A total timeout,
- B timeout,
- DB acquisition timeout,
- DB statement timeout,
- retry max attempts,
- backoff,
- fallback,
- circuit breaker thresholds,
- logs/metrics/traces.

Review:

- Does any downstream timeout exceed caller deadline?
- Can retry exceed total budget?
- Are non-idempotent operations retried?
- Is there a bulkhead?

---

## 47. Production Checklist

### Database/JDBC

- [ ] Hikari active/idle/pending metrics available.
- [ ] Connection acquisition duration visible.
- [ ] Connection timeout count visible.
- [ ] Transaction duration metric available.
- [ ] Slow query structured event exists.
- [ ] Query names/fingerprints used instead of raw SQL literals.
- [ ] DB spans enabled and correlated with traces.
- [ ] Pool size calculated against instance count and DB capacity.
- [ ] Connection leak detection available for diagnosis.
- [ ] Transaction does not hold connection across unnecessary external calls.
- [ ] Batch/reporting workload isolated or throttled.

### HTTP/gRPC

- [ ] Client duration metrics by dependency and route.
- [ ] Timeout phase visible where possible.
- [ ] Retry attempts measured.
- [ ] Circuit breaker state measured and logged.
- [ ] Bulkhead/concurrency limit measured.
- [ ] Raw URL/query string not used as metric label.
- [ ] Request/response body not logged by default.
- [ ] Error taxonomy maps status/exception to retry decision.
- [ ] Timeout budget aligned end-to-end.

### Cross-Signal

- [ ] Logs include `trace.id` and `correlation.id`.
- [ ] Traces include dependency spans.
- [ ] Metrics can link to traces/logs where supported.
- [ ] Sampling preserves errors/slow traces.
- [ ] Incident dashboard has DB, HTTP, retry, circuit breaker, and pool panels.
- [ ] Runbook exists for pool exhaustion and dependency timeout storm.

---

## 48. Key Takeaways

1. Dependency latency is usually a chain, not a single number.
2. “DB slow” is not a diagnosis; it is a symptom label.
3. Always separate pool wait, DB execution, fetch/mapping, transaction, and commit time.
4. Hikari pending threads are a powerful signal, but not root cause by themselves.
5. Retry can save a transient call or destroy a dependency under load.
6. Timeout budgets must be consistent from caller to callee.
7. Circuit breakers and fallbacks need observability, otherwise they hide incidents.
8. Virtual threads reduce thread cost, but do not remove pool/dependency limits.
9. The best dependency troubleshooting correlates metrics, logs, traces, thread dumps, JFR, and dependency-side evidence.
10. A top-tier engineer designs dependency calls with failure, evidence, and mitigation in mind from the start.

---

## 49. What Comes Next

Part berikutnya:

**Part 29 — Messaging, Batch, Scheduler, and Async Workflow Observability**

Kita akan membahas flow yang tidak lagi request-response sederhana:

- producer/consumer tracing,
- message ID dan causation ID,
- queue lag,
- retry/redelivery,
- dead-letter queue,
- poison message,
- batch job execution ID,
- scheduler drift,
- idempotency,
- partial completion,
- async workflow timeline reconstruction.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./27-gc-observability-and-troubleshooting-across-java-8-25.md">⬅️ Part 27 — GC Observability and Troubleshooting Across Java 8–25</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./29-messaging-batch-scheduler-and-async-workflow-observability.md">Part 29 — Messaging, Batch, Scheduler, and Async Workflow Observability ➡️</a>
</div>
