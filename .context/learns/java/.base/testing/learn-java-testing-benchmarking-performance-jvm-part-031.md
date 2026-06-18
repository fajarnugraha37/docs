# learn-java-testing-benchmarking-performance-jvm-part-031

# Capstone: Full Performance Investigation from Symptom to JVM Configuration

> Seri: `learn-java-testing-benchmarking-performance-jvm`  
> Part: `031` dari `031`  
> Status: **bagian terakhir / capstone**  
> Target: Java 8 sampai Java 25  
> Fokus: menyatukan testing, benchmarking, profiling, GC diagnosis, JVM arguments, container sizing, load test, dan regression prevention menjadi satu workflow investigasi production-grade.

---

## 0. Tujuan Part Ini

Pada part-part sebelumnya kita sudah membahas potongan-potongan besar:

- test strategy,
- assertion engineering,
- test data engineering,
- mocking dan fakes,
- workflow/state-machine testing,
- persistence/API/messaging testing,
- property-based testing,
- mutation testing,
- concurrency testing,
- CI test architecture,
- JMH benchmarking,
- macrobenchmark/load test,
- JVM execution model,
- memory model,
- GC theory,
- GC log diagnosis,
- JVM arguments,
- JVM in containers,
- JDK diagnostics,
- async-profiler,
- Java code performance,
- service performance,
- performance regression pipeline.

Bagian ini menyatukan semuanya ke dalam satu bentuk kerja nyata:

```text
symptom
  -> evidence collection
  -> hypothesis tree
  -> diagnosis
  -> controlled change
  -> validation
  -> production rollout
  -> regression prevention
```

Target setelah menyelesaikan part ini:

1. Mampu memimpin investigasi performance incident Java secara sistematis.
2. Mampu membedakan root cause, contributing factor, trigger, dan symptom.
3. Mampu memilih evidence yang benar: metrics, logs, traces, thread dump, heap dump, GC log, JFR, profiler, DB evidence, pool metrics, load test result.
4. Mampu memutuskan kapan problem ada di code, DB, GC, JVM config, container resource, thread pool, connection pool, downstream dependency, atau workload pattern.
5. Mampu membuat remediation yang measurable, bukan tuning spekulatif.
6. Mampu mengubah hasil investigasi menjadi regression guardrail agar bug performance tidak kembali.

---

## 1. Mental Model Utama: Performance Incident Bukan Satu Masalah, Tapi Sistem Sebab-Akibat

Performance issue hampir tidak pernah berdiri sendiri. Biasanya ada chain:

```text
business workload berubah
  -> request mix berubah
  -> satu endpoint jadi lebih sering dipanggil
  -> query lambat atau allocation naik
  -> thread pool/connection pool penuh
  -> queue menumpuk
  -> timeout naik
  -> retry memperbesar beban
  -> GC pressure naik
  -> p99 latency memburuk
  -> user melihat sistem lambat
```

Kalau engineer langsung lompat ke kesimpulan seperti:

```text
"Naikkan heap saja."
"Tambah pod saja."
"Ganti GC saja."
"Query pasti salah."
"Masalahnya network."
```

itu bukan performance engineering. Itu gambling.

Performance engineering yang benar dimulai dari evidence.

---

## 2. Symptom, Signal, Root Cause, Trigger, dan Contributing Factor

Dalam investigasi, pisahkan lima konsep ini.

### 2.1 Symptom

Symptom adalah hal yang terlihat oleh user atau stakeholder.

Contoh:

- halaman lambat,
- API timeout,
- batch selesai terlalu lama,
- p99 latency naik,
- CPU tinggi,
- memory naik,
- pod restart,
- error 504,
- queue backlog,
- DB connection habis.

Symptom belum tentu root cause.

### 2.2 Signal

Signal adalah measurement yang membantu menjelaskan symptom.

Contoh:

- p95/p99 latency,
- throughput,
- error rate,
- saturation,
- active thread,
- DB pool active/pending,
- GC pause,
- allocation rate,
- live set,
- CPU throttling,
- heap occupancy,
- native memory,
- queue depth,
- retry count,
- downstream latency.

### 2.3 Trigger

Trigger adalah event yang membuat problem muncul.

Contoh:

- deployment baru,
- config berubah,
- data volume naik,
- traffic spike,
- batch dijalankan bersamaan,
- index drop,
- DB plan berubah,
- container limit diturunkan,
- dependency lambat,
- feature flag dinyalakan.

Trigger belum tentu root cause. Trigger bisa hanya mengekspos weakness lama.

### 2.4 Root Cause

Root cause adalah penyebab utama yang jika diperbaiki membuat problem tidak terjadi lagi dalam kondisi yang sama.

Contoh:

- query tidak punya index yang sesuai,
- endpoint melakukan N+1 query,
- object graph diserialisasi terlalu besar,
- retry tanpa backoff menyebabkan retry storm,
- unbounded executor queue,
- connection pool terlalu kecil dibanding arrival rate dan service time,
- heap terlalu kecil untuk live set + allocation headroom,
- memory leak karena cache tanpa eviction,
- thread blocked karena lock global,
- CPU throttling karena Kubernetes CPU limit terlalu agresif.

### 2.5 Contributing Factor

Contributing factor memperburuk problem tapi bukan penyebab utama.

Contoh:

- GC pause tinggi karena allocation rate tinggi. Root cause bisa allocation dari code, bukan GC.
- Thread pool penuh karena DB lambat. Root cause bisa query/DB, bukan thread pool.
- Timeout tinggi karena retry storm. Root cause bisa downstream latency dan retry policy.
- Pod OOMKilled karena native memory naik. Root cause bisa direct buffer leak, classloader leak, thread explosion, atau heap too large relative to container.

---

## 3. Golden Rule: Jangan Tuning Sebelum Menjawab “Saturation Ada di Mana?”

Performance system biasanya rusak karena satu atau lebih resource jenuh.

Resource utama:

```text
CPU
memory / heap / native memory
GC capacity
thread pool
connection pool
DB CPU / IO / lock / plan
network / downstream dependency
queue / broker
file IO
container CPU quota / memory limit
lock / monitor / synchronization
```

Pertanyaan pertama bukan:

```text
Flag JVM apa yang perlu diganti?
```

Pertanyaan pertama:

```text
Resource mana yang mencapai saturation lebih dulu?
```

Kalau saturation belum jelas, perubahan config sering hanya memindahkan bottleneck.

---

## 4. Evidence Ladder untuk Investigasi Performance

Gunakan urutan bukti berikut.

```text
1. User symptom
2. Service-level metrics
3. Runtime metrics
4. Dependency metrics
5. JVM diagnostics
6. Profiling evidence
7. Code/path evidence
8. Controlled experiment
9. Regression guardrail
```

### 4.1 User Symptom

Tanya:

- endpoint apa yang lambat?
- role/user journey apa yang terdampak?
- sejak kapan?
- semua user atau sebagian?
- intermittent atau konsisten?
- hanya peak hour atau selalu?
- environment mana?
- request size tertentu?
- status tertentu?

### 4.2 Service-Level Metrics

Minimal:

- RPS,
- latency p50/p95/p99,
- error rate,
- timeout rate,
- HTTP status distribution,
- request size,
- response size,
- endpoint breakdown.

### 4.3 Runtime Metrics

Minimal:

- CPU usage,
- CPU throttling,
- memory RSS,
- heap used/committed/max,
- GC count/time/pause,
- thread count,
- active executor threads,
- queue size,
- DB pool active/idle/pending,
- HTTP client pool active/pending.

### 4.4 Dependency Metrics

Minimal:

- DB latency,
- DB CPU,
- DB active sessions,
- slow query,
- lock wait,
- connection count,
- broker lag/depth,
- downstream API latency/error,
- cache hit/miss.

### 4.5 JVM Diagnostics

Minimal:

- JVM flags,
- GC logs,
- thread dump,
- heap histogram,
- JFR,
- Native Memory Tracking jika memory issue,
- class histogram,
- container resource info.

### 4.6 Profiling Evidence

Minimal:

- CPU flame graph,
- wall-clock flame graph,
- allocation profile,
- lock profile jika contention,
- JFR event correlation.

### 4.7 Controlled Experiment

Minimal:

- reproduce dengan load test,
- ubah satu variabel,
- bandingkan before/after,
- capture evidence yang sama,
- rollback jika tidak improve.

### 4.8 Regression Guardrail

Minimal:

- unit/integration test untuk correctness,
- JMH benchmark untuk hot code jika relevan,
- load test threshold,
- dashboard/alert,
- runbook,
- CI artifact retention.

---

## 5. Case Study Utama: p99 Latency Naik Setelah Release

Kita gunakan satu scenario lengkap.

### 5.1 Context

Service Java 21 berjalan di Kubernetes.

```text
Service: case-management-api
Java: 21
Framework: Spring Boot / Jakarta stack
GC: G1
Container memory limit: 2Gi
CPU request: 1 core
CPU limit: 2 cores
Pod count: 4
DB: PostgreSQL/Oracle style OLTP database
Connection pool: HikariCP maxPoolSize=30 per pod
Endpoint terdampak: POST /cases/{id}/submit
SLO: p95 < 500 ms, p99 < 1500 ms
```

Setelah release:

```text
p50: 120 ms -> 180 ms
p95: 420 ms -> 1200 ms
p99: 900 ms -> 6000 ms
HTTP 504 naik
DB pool pending naik
GC pause terlihat naik
CPU terlihat hanya 55-65%
```

Tim awalnya berdebat:

```text
Backend: "DB lambat."
DBA: "App terlalu banyak connection."
Infra: "CPU masih aman."
QA: "Di UAT tidak terjadi."
Developer: "Mungkin GC."
```

Ini tipikal incident performance.

---

## 6. Step 1 — Definisikan Problem dengan Presisi

Problem statement yang buruk:

```text
API lambat setelah release.
```

Problem statement yang benar:

```text
Sejak release 2026-06-15 20:10 UTC+7, endpoint POST /cases/{id}/submit pada production mengalami kenaikan p99 dari ~900 ms menjadi ~6000 ms pada traffic peak 09:00-11:00. Error 504 meningkat dari <0.1% menjadi 3.2%. Endpoint lain relatif stabil. Kenaikan terlihat pada semua pod, tetapi lebih parah pada pod dengan DB pool pending tinggi. Tidak ada OOMKilled. CPU pod 55-65%, memory RSS naik dari 1.1Gi ke 1.5Gi. GC pause p99 naik dari 80 ms ke 300 ms.
```

Problem statement harus menjawab:

```text
what changed?
when?
which path?
how severe?
which users?
which environment?
which resource signals changed?
what did not change?
```

---

## 7. Step 2 — Buat Timeline

Timeline menghindari investigasi liar.

```text
2026-06-15 19:30  Deployment started
2026-06-15 20:10  New version fully rolled out
2026-06-15 20:20  p95 starts increasing
2026-06-16 09:05  Peak traffic starts
2026-06-16 09:20  DB pool pending increases
2026-06-16 09:25  HTTP 504 increases
2026-06-16 09:30  GC pause p99 increases
2026-06-16 09:35  Support ticket from users
```

Interpretasi awal:

- Deployment adalah trigger kuat.
- Peak traffic memperbesar symptom.
- DB pool pending muncul sebelum 504.
- GC pause naik setelah pressure meningkat, mungkin contributing factor.

---

## 8. Step 3 — Klasifikasikan Failure Mode

Gunakan taxonomy berikut.

```text
A. CPU-bound
B. Memory/GC-bound
C. DB-bound
D. Pool/queue-bound
E. Lock/contention-bound
F. Network/downstream-bound
G. Serialization/payload-bound
H. Container resource-bound
I. Retry/backpressure failure
J. Workload/data-shape change
```

Dari signal awal:

```text
CPU 55-65%             -> bukan murni CPU-bound
DB pool pending naik   -> pool/dependency-bound kandidat kuat
GC pause naik          -> memory/GC contributing factor
504 naik               -> timeout/backpressure symptom
Endpoint spesifik      -> code path/data path kandidat kuat
```

Hipotesis awal:

```text
H1: Release menambahkan query atau mengubah query plan pada submit flow.
H2: Release menambahkan serialization/audit payload besar sehingga allocation naik.
H3: Release menambahkan external call synchronous di submit flow.
H4: Hikari pool terlalu kecil untuk service time baru.
H5: Timeout/retry policy memperbesar load ke DB/downstream.
H6: GC config salah setelah deployment.
```

Jangan memilih satu hipotesis dulu. Susun tree.

---

## 9. Step 4 — Ambil Snapshot Runtime yang Aman

Saat incident, ambil evidence yang low-risk terlebih dahulu.

### 9.1 Command Baseline

Di container/pod:

```bash
jcmd 1 VM.version
jcmd 1 VM.command_line
jcmd 1 VM.flags
jcmd 1 VM.system_properties
jcmd 1 Thread.print > thread-dump-$(date +%Y%m%d-%H%M%S).txt
jcmd 1 GC.class_histogram > class-histo-$(date +%Y%m%d-%H%M%S).txt
jcmd 1 GC.heap_info > heap-info-$(date +%Y%m%d-%H%M%S).txt
```

Untuk Java 9+ dengan JFR:

```bash
jcmd 1 JFR.start name=incident settings=profile delay=0s duration=120s filename=/tmp/incident.jfr
```

Atau jika ingin stop manual:

```bash
jcmd 1 JFR.start name=incident settings=profile filename=/tmp/incident.jfr
# tunggu saat symptom terjadi
jcmd 1 JFR.stop name=incident filename=/tmp/incident.jfr
```

Untuk GC logs, idealnya sudah aktif sejak start. Kalau belum, Java 9+ unified logging bisa dikonfigurasi lewat `-Xlog`, tetapi tidak semua output historis tersedia jika belum dinyalakan dari awal.

Baseline Java 9+:

```bash
-Xlog:gc*,safepoint:file=/var/log/app/gc-%p-%t.log:time,uptime,level,tags:filecount=10,filesize=50M
```

Baseline Java 8:

```bash
-XX:+PrintGCDetails \
-XX:+PrintGCDateStamps \
-XX:+PrintTenuringDistribution \
-Xloggc:/var/log/app/gc.log \
-XX:+UseGCLogFileRotation \
-XX:NumberOfGCLogFiles=10 \
-XX:GCLogFileSize=50M
```

### 9.2 Apa yang Tidak Boleh Sembarangan

Hindari saat production incident tanpa alasan kuat:

```text
heap dump besar saat traffic tinggi
full GC manual
jmap dump live heap tanpa risk assessment
mengubah banyak JVM flag sekaligus
restart semua pod bersamaan
menaikkan connection pool besar-besaran
menonaktifkan timeout
menambah retry
```

Heap dump bisa sangat berat. Full GC manual bisa menyebabkan pause besar. Connection pool terlalu besar bisa membunuh database.

---

## 10. Step 5 — Baca Service Metrics Dulu

Misal ditemukan:

```text
Endpoint POST /cases/{id}/submit:
  RPS normal: 80 rps total
  RPS incident: 95 rps total
  p50: 180 ms
  p95: 1200 ms
  p99: 6000 ms
  timeout: 3.2%

Endpoint GET /cases/search:
  stable

Endpoint GET /cases/{id}:
  slight increase
```

Interpretasi:

- Traffic naik sedikit, tapi latency naik besar.
- Endpoint submit adalah hot path.
- Bukan global JVM collapse.
- Kemungkinan code path spesifik atau dependency spesifik.

Lihat breakdown span/tracing:

```text
submitCase total p99: 6000 ms
  authorization check: 20 ms
  load case: 80 ms
  validate transition: 15 ms
  insert audit trail: 900 ms
  update case status: 120 ms
  publish outbox event: 50 ms
  fetch related parties: 3200 ms
  response serialization: 600 ms
```

Ini mulai mengarah.

---

## 11. Step 6 — Cek Pool dan Queue

### 11.1 HikariCP Metrics

Per pod:

```text
hikaricp.connections.active: 30
hikaricp.connections.idle: 0
hikaricp.connections.pending: 40-120
hikaricp.connections.timeout: increasing
hikaricp.connections.creation: stable
```

Interpretasi:

- DB pool saturated.
- Banyak request menunggu connection.
- Latency user bisa naik walaupun DB query individu tidak semua lambat.

### 11.2 Executor Metrics

```text
http server active threads: high but not max
application executor queue: stable
scheduler queue: stable
```

Interpretasi:

- Primary saturation bukan app executor.
- DB pool lebih mencurigakan.

### 11.3 Little’s Law Reasoning

Little’s Law:

```text
L = λ × W
```

Jika endpoint submit memiliki arrival rate 95 rps total, 4 pod berarti sekitar 24 rps per pod.

Sebelum release:

```text
DB connection hold time per request: 80 ms
L = 24 × 0.08 = 1.92 active DB connections per pod
```

Sesudah release:

```text
DB connection hold time per request: 1200 ms
L = 24 × 1.2 = 28.8 active DB connections per pod
```

Dengan pool size 30, pool hampir selalu penuh.

Ini menunjukkan pool size bukan akar masalah. Pool penuh karena connection hold time naik drastis.

Jika pool dinaikkan dari 30 ke 80:

```text
4 pod × 80 = 320 DB connections
```

Mungkin DB makin collapse. Jadi perubahan pool harus hati-hati.

---

## 12. Step 7 — Thread Dump: Apa Thread Sedang Lakukan?

Ambil beberapa thread dump, misalnya 3 kali dengan interval 10 detik.

```bash
for i in 1 2 3; do
  jcmd 1 Thread.print > thread-dump-$i.txt
  sleep 10
done
```

Cari pola:

```text
banyak thread WAITING pada HikariPool.getConnection
banyak thread RUNNABLE di JDBC driver read
banyak thread BLOCKED pada lock tertentu
banyak thread WAITING pada CompletableFuture/ForkJoinPool
banyak virtual threads parked pada blocking IO
```

Contoh temuan:

```text
"http-nio-8080-exec-42" WAITING
  at com.zaxxer.hikari.pool.HikariPool.getConnection(...)
  at com.zaxxer.hikari.HikariDataSource.getConnection(...)
  at org.springframework.jdbc.datasource.DataSourceUtils.fetchConnection(...)
  at ... CaseSubmitService.submit(...)
```

Dan beberapa:

```text
"http-nio-8080-exec-17" RUNNABLE
  at oracle.jdbc.driver.T4CPreparedStatement.executeForRows(...)
  at ... RelatedPartyRepository.findByCaseId(...)
```

Interpretasi:

- Banyak request menunggu DB connection.
- Sebagian connection sedang dipakai query `findByCaseId`.
- Fokus ke query path dan connection hold time.

---

## 13. Step 8 — DB Evidence: Query, Plan, Lock, dan Active Session

Dari tracing/JFR/thread dump, kandidat query:

```sql
SELECT *
FROM related_party rp
LEFT JOIN related_party_address rpa ON rpa.party_id = rp.id
LEFT JOIN related_party_document rpd ON rpd.party_id = rp.id
WHERE rp.case_id = ?
ORDER BY rp.created_at DESC
```

DB evidence:

```text
query p95 before: 70 ms
query p95 after: 1800 ms
rows returned before median: 5
rows returned after median: 5
rows scanned after: huge
plan changed: full scan on related_party_document
missing index on related_party_document.party_id
```

Atau mungkin release menambahkan fetch eager:

```java
@OneToMany(fetch = FetchType.EAGER)
private List<RelatedPartyDocument> documents;
```

atau serializer memicu lazy loading:

```java
return caseEntity;
```

lalu Jackson mengakses graph yang besar.

Diagnosis harus dibuktikan lewat:

- SQL log/tracing,
- DB plan,
- row count,
- index usage,
- query duration distribution,
- DB active session/wait event,
- connection hold time.

---

## 14. Step 9 — JFR: Korelasi JVM-Level

JFR berguna karena menghubungkan Java runtime events.

Cari event:

```text
Socket Read
File Read/Write
Java Monitor Blocked
Thread Park
Execution Sample
Allocation in new TLAB
Allocation outside TLAB
Garbage Collection
Object Count after GC
Exception Statistics
Virtual Thread events, jika Java 21+
```

Temuan contoh:

```text
Top Socket Read:
  oracle.jdbc.driver.T4CMAREngineNIO.prepareForUnmarshall

Top Allocation:
  com.fasterxml.jackson.databind.ser.BeanSerializer.serialize
  java.util.ArrayList.grow
  java.lang.StringLatin1.newString
  com.example.audit.AuditPayloadBuilder.toJson

GC:
  Young GC frequency increased
  Pause p99 280 ms
  Allocation rate 2.8 GB/s -> 6.5 GB/s
```

Interpretasi:

- DB read menonjol.
- Serialization/audit payload juga menaikkan allocation.
- GC pause naik karena allocation pressure, bukan root cause utama.

JFR bukan hanya profiler CPU. Ia membantu melihat blocking, allocation, GC, lock, IO, dan runtime events dalam satu timeline.

---

## 15. Step 10 — async-profiler: CPU, Wall-Clock, Allocation

Gunakan profiler sesuai pertanyaan.

### 15.1 CPU Profile

Pertanyaan:

```text
CPU habis di method apa?
```

Command contoh:

```bash
asprof -e cpu -d 60 -f /tmp/cpu.html 1
```

Jika CPU hanya 60%, CPU profile mungkin tidak cukup menjelaskan p99 latency.

### 15.2 Wall-Clock Profile

Pertanyaan:

```text
Waktu habis di mana, termasuk waiting/blocking?
```

```bash
asprof -e wall -d 60 -f /tmp/wall.html 1
```

Temuan contoh:

```text
Large wall-clock width:
  HikariPool.getConnection
  JDBC execute
  socket read from DB
```

### 15.3 Allocation Profile

Pertanyaan:

```text
Allocation besar berasal dari mana?
```

```bash
asprof -e alloc -d 60 -f /tmp/alloc.html 1
```

Temuan contoh:

```text
AuditPayloadBuilder.buildFullSnapshot
Jackson ObjectMapper.writeValueAsString
ArrayList.grow
StringBuilder.toString
```

Interpretasi:

- Wall-clock profile membuktikan waiting pada DB/pool.
- Allocation profile membuktikan audit serialization memperbesar GC pressure.
- CPU profile mungkin secondary.

---

## 16. Step 11 — GC Logs: Root Cause atau Secondary Effect?

Contoh GC signal:

```text
before:
  allocation rate: 2.8 GB/s
  young GC every: 4s
  pause p99: 80 ms
  old occupancy after GC: stable 700 MB

after:
  allocation rate: 6.5 GB/s
  young GC every: 1.2s
  pause p99: 280 ms
  old occupancy after GC: stable 760 MB
```

Interpretasi:

- Allocation rate naik tajam.
- Live set relatif stabil.
- Tidak terlihat memory leak utama.
- GC pause naik karena allocation pressure, bukan heap retention.
- Solusi utama bukan menaikkan heap atau ganti GC dulu.

Jika old occupancy naik terus setelah Full GC atau mixed GC:

```text
old occupancy after GC: 700 MB -> 900 MB -> 1.2 GB -> 1.5 GB
```

maka memory retention/leak jadi hipotesis kuat.

### 16.1 GC Tuning Decision

Kondisi kita:

```text
DB query + audit allocation menyebabkan request lama.
GC ikut memburuk.
```

Prioritas:

1. Perbaiki query/DB plan.
2. Kurangi audit/serialization allocation jika berlebihan.
3. Baru evaluasi heap/GC config jika masih perlu.

Jangan ganti G1 ke ZGC hanya karena ada pause naik, kalau root cause allocation/DB.

---

## 17. Step 12 — Container Evidence: CPU Throttling dan Memory Limit

CPU 60% bisa misleading jika container throttled.

Cek:

```text
container_cpu_usage_seconds_total
container_cpu_cfs_throttled_seconds_total
container_cpu_cfs_throttled_periods_total
container_memory_working_set_bytes
container_memory_rss
kube_pod_container_resource_limits
kube_pod_container_resource_requests
```

Jika ditemukan:

```text
CPU usage average: 60%
CPU throttling: high during peak
```

maka CPU limit bisa contributing factor.

Tapi dalam case ini, signal utama DB pool pending dan query wall time. CPU throttling jika rendah bukan root cause.

Memory:

```text
RSS: 1.5Gi
limit: 2Gi
heap max: 1.2Gi
native/direct/metaspace/thread/code cache: 300Mi
headroom: ~200Mi
OOMKilled: none
```

Memory pressure tidak terlihat critical.

---

## 18. Step 13 — Hypothesis Tree yang Sudah Dipersempit

Awal:

```text
H1 query/DB plan
H2 allocation/serialization
H3 external call
H4 pool too small
H5 retry storm
H6 GC config
```

Setelah evidence:

```text
H1: Strong
  - thread dump JDBC execute
  - DB plan full scan
  - query latency high
  - Hikari pending caused by long connection hold time

H2: Medium/Strong
  - allocation profile high in audit serialization
  - GC allocation rate doubled
  - but not main p99 driver

H3: Weak
  - tracing no external call spike

H4: Contributing, not root
  - pool saturated because query service time increased
  - increasing pool may overload DB

H5: Medium
  - timeout errors increased
  - retry metrics need check

H6: Weak/Secondary
  - GC affected but live set stable
```

---

## 19. Step 14 — Root Cause Statement

Root cause statement yang buruk:

```text
DB lambat dan GC naik.
```

Root cause statement yang kuat:

```text
Release 2026-06-15 menambahkan fetch related-party document pada submit flow. Query baru melakukan join ke related_party_document tanpa index yang sesuai pada party_id dan menyebabkan full scan pada peak workload. Akibatnya DB connection hold time pada endpoint submit naik dari sekitar 80 ms menjadi sekitar 1200-1800 ms. Dengan arrival rate sekitar 24 rps per pod dan Hikari maxPoolSize 30, pool menjadi saturated dan request menunggu connection. Timeout meningkat, dan audit serialization pada object graph yang lebih besar menaikkan allocation rate dari 2.8 GB/s menjadi 6.5 GB/s sehingga GC pause ikut naik. GC bukan root cause utama, tetapi contributing factor terhadap tail latency.
```

Statement ini menyebut:

- trigger,
- code/data change,
- DB mechanism,
- queue/pool consequence,
- latency consequence,
- GC secondary effect,
- why symptom muncul di p99.

---

## 20. Step 15 — Remediation Plan: Jangan Satu Solusi Besar

Pisahkan remediation menjadi immediate, short-term, dan long-term.

### 20.1 Immediate Mitigation

Tujuan: turunkan impact cepat dengan risiko rendah.

Pilihan:

```text
1. Rollback release jika aman.
2. Disable feature flag fetch document detail di submit response.
3. Return minimal response after command success.
4. Temporarily reduce retry amplification.
5. Increase timeout only jika downstream recovery butuh waktu dan tidak memperburuk queue.
6. Add one safe index jika DBA bisa validasi online.
```

Hindari:

```text
menaikkan Hikari pool besar-besaran
menambah pod tanpa cek DB capacity
menonaktifkan timeout
mengubah GC collector sebagai first fix
```

### 20.2 Short-Term Fix

Contoh:

```sql
CREATE INDEX idx_rpd_party_id ON related_party_document(party_id);
```

atau query rewrite:

```text
fetch only IDs needed for submit
avoid loading document blob/large metadata
separate command processing from read model response
use projection DTO
avoid returning entity graph directly
```

Audit fix:

```text
store compact diff instead of full object snapshot
cap audit metadata size
serialize only relevant fields
compress large payload if required and measured
avoid generating audit JSON twice
```

### 20.3 Long-Term Fix

```text
add query performance test for critical flow
add explain-plan review for new join/query
add load test scenario for submit flow
add JFR/GC artifact capture in performance test
add dashboard for connection pool pending
add alert for DB connection acquisition latency
add performance regression gate
```

---

## 21. Step 16 — Controlled Change Matrix

Jangan ubah semua sekaligus.

| Change | Expected Effect | Evidence to Compare | Risk |
|---|---:|---|---|
| Add DB index | lower query time | DB plan, query p95, pool pending | index build cost |
| Use DTO projection | lower DB rows/columns + allocation | query duration, allocation profile | behavior compatibility |
| Minimal submit response | lower serialization | response size, alloc profile | API contract risk |
| Reduce audit snapshot size | lower allocation + IO | allocation rate, audit size | compliance semantics |
| Increase heap | lower GC frequency | GC log | hides allocation issue |
| Increase Hikari pool | reduce waiting if DB has capacity | pool pending, DB CPU/waits | overload DB |
| Add pods | lower per-pod arrival rate | RPS/pod, DB connection total | overload DB |
| Switch GC | lower pause profile | GC pause, CPU | operational risk |

Prioritas berdasarkan evidence:

```text
1. DB index/query rewrite
2. DTO/minimal response
3. audit allocation reduction
4. pool sizing only after DB service time fixed
5. JVM/GC tuning only if residual problem remains
```

---

## 22. Step 17 — Validation dengan Load Test

Validation harus mereproduksi workload yang gagal.

### 22.1 Workload Model

```text
Scenario: submit case
Arrival rate: 95 rps total
Duration: 30 minutes
Ramp-up: 10 minutes
Data shape:
  70% cases with 1-3 parties
  25% cases with 4-10 parties
  5% cases with 20+ parties and documents
Payload:
  realistic user roles
  realistic audit metadata
Dependencies:
  real DB clone or production-like dataset
```

### 22.2 Acceptance Criteria

```text
p95 submit latency < 500 ms
p99 submit latency < 1500 ms
HTTP 5xx < 0.1%
DB pool pending p95 = 0
DB connection acquisition p99 < 50 ms
GC pause p99 < 150 ms
allocation rate <= baseline + 20%
no OOMKilled
no retry storm
DB CPU < 70% sustained
```

### 22.3 Evidence to Capture

```text
application metrics
DB metrics
GC log
JFR 2-5 minutes during steady state
thread dump if p99 spikes
allocation profile if allocation suspicious
query plan before/after
load generator report
```

---

## 23. Step 18 — Before/After Analysis

Example after DB index + projection:

```text
Before:
  submit p95: 1200 ms
  submit p99: 6000 ms
  timeout: 3.2%
  DB query p95: 1800 ms
  pool pending p95: 40
  allocation rate: 6.5 GB/s
  GC pause p99: 280 ms

After:
  submit p95: 360 ms
  submit p99: 950 ms
  timeout: 0.03%
  DB query p95: 90 ms
  pool pending p95: 0
  allocation rate: 3.4 GB/s
  GC pause p99: 95 ms
```

Interpretasi:

- Root cause fix berhasil.
- GC membaik tanpa ganti collector.
- Pool pending hilang tanpa menaikkan pool.
- Tail latency kembali memenuhi SLO.

---

## 24. Step 19 — JVM Configuration Review Setelah Root Cause Fix

Setelah root cause selesai, baru review JVM config.

### 24.1 Baseline Java 21/25 G1 API Service

Contoh profil aman:

```bash
-XX:+UseG1GC \
-XX:MaxRAMPercentage=60 \
-XX:InitialRAMPercentage=60 \
-XX:MaxGCPauseMillis=200 \
-Xlog:gc*,safepoint:file=/var/log/app/gc-%p-%t.log:time,uptime,level,tags:filecount=10,filesize=50M \
-XX:+HeapDumpOnOutOfMemoryError \
-XX:HeapDumpPath=/var/log/app/heapdump.hprof \
-XX:ErrorFile=/var/log/app/hs_err_pid%p.log
```

Catatan:

- `MaxRAMPercentage=60` bukan angka universal.
- Hitung heap vs non-heap/native memory.
- Jika banyak thread platform, direct buffer, metaspace, code cache, atau native library, heap percentage harus lebih rendah.

### 24.2 ZGC Candidate?

ZGC layak dipertimbangkan jika:

```text
latency sangat sensitif
heap besar
GC pause masih signifikan setelah allocation dan DB fixed
CPU headroom cukup
operational maturity cukup
```

ZGC bukan solusi untuk:

```text
query lambat
pool saturated
retry storm
N+1 query
unbounded allocation dari response besar
container memory terlalu kecil
```

### 24.3 Heap Sizing

Validasi:

```text
live set after GC
allocation rate
GC frequency
pause distribution
RSS vs limit
native memory
headroom
```

Formula kasar:

```text
container memory
  = heap
  + metaspace
  + code cache
  + thread stacks
  + direct memory
  + native memory
  + libc/JVM overhead
  + safety headroom
```

Jangan set:

```text
-Xmx == container memory limit
```

---

## 25. Step 20 — Tambahkan Regression Guardrail

Fix tanpa guardrail akan kembali rusak.

### 25.1 Correctness Test

Test bahwa submit flow tidak perlu fetch document detail penuh.

```java
@Test
void submitShouldNotLoadFullDocumentGraph() {
    CaseId caseId = fixtures.caseWithManyPartiesAndDocuments();

    SubmitResult result = service.submit(caseId, officerContext());

    assertThat(result.status()).isEqualTo(CaseStatus.SUBMITTED);
    assertThat(result.responsePayload()).doesNotContainDocumentContent();
    assertThat(auditStore.latestFor(caseId)).containsCompactTransitionDiff();
}
```

### 25.2 Persistence Test

Test repository projection.

```java
@Test
void submitProjectionShouldFetchOnlyRequiredFields() {
    CaseSubmitProjection projection = repository.findSubmitProjection(caseId);

    assertThat(projection.caseId()).isEqualTo(caseId);
    assertThat(projection.parties()).allSatisfy(p -> {
        assertThat(p.documentContentLoaded()).isFalse();
    });
}
```

### 25.3 Performance-Aware Integration Test

Bukan untuk exact latency di CI biasa, tetapi untuk query count/shape.

```text
submit flow must not execute more than N SQL statements
submit flow must not load BLOB/CLOB document content
submit response size must stay below threshold
```

### 25.4 JMH Benchmark

Jika audit serialization hot path:

```java
@Benchmark
public String compactAudit(SubmitAuditState state) throws Exception {
    return state.auditSerializer.serializeCompactDiff(state.transition());
}
```

Track:

```text
ops/s
average time
allocation rate
```

### 25.5 Load Test Gate

Nightly/pre-release:

```text
submit p95 < 500 ms
submit p99 < 1500 ms
pool pending p95 == 0
error rate < 0.1%
allocation rate <= baseline + 20%
```

### 25.6 Observability Guardrail

Dashboard panels:

```text
endpoint p95/p99
endpoint error rate
Hikari active/idle/pending/timeout
DB query latency
GC pause p95/p99
allocation rate if available
heap after GC
CPU throttling
retry count
response size
```

Alerts:

```text
pool pending > 0 for 5 minutes
connection timeout > 0
p99 > SLO for 10 minutes
retry rate > baseline × 2
GC pause p99 > threshold
CPU throttling > threshold
```

---

## 26. Investigation Playbook: 15 Menit Pertama

Jika production incident terjadi, gunakan checklist ini.

### 26.1 Menit 0-3: Stabilkan Komunikasi

```text
define incident owner
define scribe
freeze unrelated deployments
capture exact start time
identify affected endpoint/user journey
decide whether rollback is immediately safe
```

### 26.2 Menit 3-7: Ambil Service Signals

```text
latency p50/p95/p99 by endpoint
error rate by status code
RPS by endpoint
pod restart/OOMKilled
CPU/memory by pod
DB pool metrics
thread/executor queue metrics
```

### 26.3 Menit 7-12: Ambil Runtime Evidence

```bash
jcmd 1 VM.command_line
jcmd 1 VM.flags
jcmd 1 Thread.print
jcmd 1 GC.heap_info
jcmd 1 GC.class_histogram
jcmd 1 JFR.start name=incident settings=profile duration=120s filename=/tmp/incident.jfr
```

### 26.4 Menit 12-15: Tentukan Arah

Pilih cabang:

```text
CPU high?
  -> CPU profile + hot path

CPU low, latency high?
  -> wall-clock profile + thread dump + dependency

DB pool pending?
  -> query latency/plan + connection hold time

GC pause high?
  -> GC log + allocation/live-set distinction

Memory rising?
  -> heap histo + NMT + heap dump risk assessment

Thread blocked?
  -> lock/thread dump/JFR monitor events

Only one endpoint?
  -> code path/tracing/query/payload

All endpoints?
  -> shared dependency/runtime/container/GC/CPU
```

---

## 27. Decision Tree: Dari Signal ke Diagnosis

### 27.1 CPU Tinggi

```text
CPU high
  -> CPU flame graph
  -> top hot methods
  -> check if useful work or spin
  -> check JIT/code cache if unusual
  -> check GC CPU if GC active
```

Kemungkinan:

- expensive computation,
- serialization,
- regex,
- crypto/compression,
- busy loop,
- lock-free spin,
- excessive logging formatting,
- GC/JIT overhead.

### 27.2 CPU Rendah tapi Latency Tinggi

```text
CPU low + latency high
  -> thread dump
  -> wall-clock profile
  -> pool metrics
  -> dependency latency
```

Kemungkinan:

- DB wait,
- external API wait,
- pool wait,
- queue wait,
- lock wait,
- sleep/backoff,
- rate limiter,
- blocked IO.

### 27.3 GC Pause Tinggi

```text
GC pause high
  -> allocation rate?
  -> live set growth?
  -> heap headroom?
  -> humongous allocation?
  -> container memory pressure?
```

Kemungkinan:

- high allocation hot path,
- object retention,
- heap too small,
- too many large objects,
- bad cache,
- huge response serialization,
- direct/native memory pressure.

### 27.4 DB Pool Saturated

```text
pool saturated
  -> connection hold time
  -> query duration
  -> transaction boundary
  -> connection leak
  -> pool size vs DB capacity
```

Kemungkinan:

- slow query,
- long transaction,
- lock wait,
- N+1 query,
- connection leak,
- pool too small,
- DB overloaded,
- transaction wraps external call.

### 27.5 Memory Rising

```text
memory rising
  -> heap used after GC?
  -> RSS rising but heap stable?
  -> direct memory?
  -> metaspace?
  -> thread count?
  -> native memory tracking?
```

Kemungkinan:

- heap leak,
- cache retention,
- classloader leak,
- direct buffer leak,
- native library allocation,
- thread explosion,
- memory mapped files,
- JIT/code cache growth.

---

## 28. Common False Conclusions

### 28.1 “CPU Tidak 100%, Jadi Bukan Capacity Issue”

Salah. Service bisa saturated di:

- DB pool,
- lock,
- IO,
- downstream,
- queue,
- CPU throttling,
- memory/GC.

CPU rendah sering berarti thread sedang menunggu.

### 28.2 “GC Pause Naik, Jadi Ganti GC”

Belum tentu. GC pause bisa naik karena:

- allocation rate naik,
- response terlalu besar,
- object graph tidak perlu,
- DB delay membuat objects hidup lebih lama,
- heap terlalu kecil,
- cache menahan object.

Perbaiki penyebab allocation/retention dulu.

### 28.3 “Pool Penuh, Jadi Naikkan Pool”

Pool penuh bisa berarti:

- downstream lambat,
- query lambat,
- transaction terlalu panjang,
- request rate terlalu tinggi,
- connection leak.

Menaikkan pool bisa memperbesar tekanan ke DB.

### 28.4 “Benchmark JMH Cepat, Jadi Production Cepat”

JMH mengukur isolated code. Production punya:

- cache pressure,
- branch profile berbeda,
- object lifetime berbeda,
- IO,
- lock,
- queue,
- GC interactions,
- container throttling,
- dependency latency.

Benchmark valid hanya dalam scope pertanyaan yang benar.

### 28.5 “Load Test Pass, Jadi Aman”

Load test bisa salah jika:

- data tidak realistis,
- user journey tidak representatif,
- dependency mocked terlalu cepat,
- coordinated omission,
- duration terlalu pendek,
- no peak/spike/soak,
- tidak capture JVM/DB evidence.

---

## 29. Performance Investigation Report Template

Gunakan format ini untuk laporan profesional.

```md
# Performance Investigation Report

## 1. Summary
- Incident:
- Impact:
- Start time:
- End time:
- Affected endpoints/user journeys:
- Severity:

## 2. Symptoms
- Latency:
- Error rate:
- Throughput:
- User impact:

## 3. Timeline
| Time | Event | Evidence |
|---|---|---|

## 4. What Changed
- Code:
- Config:
- Infrastructure:
- Data/workload:
- Dependencies:

## 5. Evidence Collected
- Metrics:
- Logs:
- Traces:
- Thread dumps:
- GC logs:
- JFR:
- Profiles:
- DB evidence:

## 6. Hypotheses
| Hypothesis | Evidence For | Evidence Against | Status |
|---|---|---|---|

## 7. Root Cause
Explain mechanism, not just label.

## 8. Contributing Factors
- Factor 1:
- Factor 2:

## 9. Remediation
| Change | Type | Risk | Validation |
|---|---|---|---|

## 10. Validation Results
| Metric | Before | After | Target |
|---|---:|---:|---:|

## 11. Regression Prevention
- Tests:
- Benchmarks:
- Load tests:
- Alerts:
- Dashboards:
- Runbooks:

## 12. Follow-up Items
| Item | Owner | Due Date | Priority |
|---|---|---|---|
```

---

## 30. Capstone Mini Runbook: “p99 Naik, CPU Normal”

Ini salah satu scenario paling umum.

```text
p99 naik + CPU normal
```

Jangan langsung GC tuning. Lakukan:

```text
1. Breakdown by endpoint.
2. Check error/timeout rate.
3. Check DB pool pending.
4. Check HTTP client pool pending.
5. Check thread dump.
6. Run wall-clock profiler.
7. Check dependency latency.
8. Check queue depth.
9. Check lock contention.
10. Check GC pause/allocation rate.
11. Validate with trace/JFR.
```

Kemungkinan terbesar:

```text
waiting, not computing
```

Maka tools yang lebih berguna:

```text
thread dump
wall-clock profile
tracing
pool metrics
DB metrics
JFR socket/monitor/thread park events
```

bukan hanya CPU flame graph.

---

## 31. Java 8–25 Compatibility Notes

### 31.1 Java 8

- Tidak ada built-in JFR yang bebas digunakan seperti JDK modern pada semua distribusi lama.
- GC logging masih memakai legacy flags.
- CMS mungkin masih ditemukan di legacy system.
- G1 tersedia tetapi behavior/ergonomics tidak sama dengan versi modern.
- Banyak tooling modern masih bisa attach, tapi feature berbeda.
- JUnit modern terbatas oleh Java version.

### 31.2 Java 11

- JFR tersedia di OpenJDK lineage modern.
- Unified logging sudah tersedia.
- G1 default dan lebih matang dibanding Java 8.
- Banyak service enterprise menggunakan Java 11 sebagai migration baseline.

### 31.3 Java 17

- Baseline modern LTS penting.
- Banyak tool/library modern menjadikan Java 17 sebagai minimum.
- JUnit 6 membutuhkan Java 17+.
- Runtime diagnostics lebih matang.

### 31.4 Java 21

- Virtual threads final.
- Perlu memahami pinning, blocking, pool boundaries, dan downstream capacity.
- JFR punya event untuk virtual thread.
- Performance investigation perlu membedakan platform thread vs virtual thread behavior.

### 31.5 Java 25

- Gunakan dokumentasi Java SE 25 untuk launcher/JFR/GC behavior modern.
- ZGC modern sudah generational-only direction; jangan copy flag lama tanpa validasi.
- Always verify flag availability dengan:

```bash
java -XX:+PrintFlagsFinal -version
jcmd <pid> VM.flags
jcmd <pid> VM.command_line
```

---

## 32. Final Engineering Checklist

Sebelum menyatakan “performance issue solved”, pastikan:

```text
[ ] Symptom didefinisikan dengan endpoint, waktu, severity, dan user impact.
[ ] Timeline dibuat.
[ ] Change list diketahui.
[ ] Service metrics dibandingkan before/after.
[ ] Resource saturation teridentifikasi.
[ ] Thread dump/JFR/profiler/GC log dipakai sesuai kebutuhan.
[ ] Root cause statement menjelaskan mechanism.
[ ] Contributing factors dipisahkan dari root cause.
[ ] Remediation diurutkan berdasarkan risk dan expected effect.
[ ] Perubahan dilakukan satu per satu atau dengan matrix yang jelas.
[ ] Validation load test memakai workload realistis.
[ ] Before/after metrics memenuhi target.
[ ] JVM config direview setelah root cause, bukan sebagai spekulasi awal.
[ ] Regression guardrail ditambahkan.
[ ] Dashboard/alert/runbook diperbarui.
[ ] Laporan incident ditulis.
```

---

## 33. Ringkasan Mental Model Akhir

Performance engineering Java yang kuat bukan tentang hafal JVM flags.

Yang membedakan engineer kuat adalah kemampuan menyusun bukti:

```text
Testing membuktikan behavior benar.
Benchmark membuktikan cost isolated code.
Load test membuktikan behavior sistem dalam workload.
Profiling menjelaskan di mana waktu/alokasi habis.
GC log menjelaskan tekanan memory dan pause.
JFR menghubungkan runtime events dalam timeline.
JVM config mengatur batas dan behavior runtime.
Observability membuktikan real-world production behavior.
Regression pipeline mencegah masalah kembali.
```

Jangan mulai dari tuning. Mulai dari pertanyaan:

```text
Apa symptom spesifiknya?
Resource mana yang saturated?
Apa evidence-nya?
Apa mechanism-nya?
Apa perubahan terkecil yang bisa divalidasi?
Bagaimana mencegah ini kembali?
```

Itulah cara berpikir performance engineer Java level senior/principal.

---

## 34. Referensi Utama

- Oracle Java SE 25 Diagnostic Tools: https://docs.oracle.com/en/java/javase/25/troubleshoot/diagnostic-tools.html
- Oracle Java SE 25 Java Command: https://docs.oracle.com/en/java/javase/25/docs/specs/man/java.html
- Oracle Java SE 25 GC Tuning Guide: https://docs.oracle.com/en/java/javase/25/gctuning/
- Oracle Java SE 25 Virtual Threads: https://docs.oracle.com/en/java/javase/25/core/virtual-threads.html
- OpenJDK JMH: https://github.com/openjdk/jmh
- OpenJDK jcstress: https://openjdk.org/projects/code-tools/jcstress/
- async-profiler: https://github.com/async-profiler/async-profiler
- JDK Flight Recorder overview: https://dev.java/learn/jvm/jfr/
- JEP 158 Unified JVM Logging: https://openjdk.org/jeps/158
- JEP 271 Unified GC Logging: https://openjdk.org/jeps/271
- JEP 444 Virtual Threads: https://openjdk.org/jeps/444
- JEP 439 Generational ZGC: https://openjdk.org/jeps/439
- JEP 490 ZGC: Remove the Non-Generational Mode: https://openjdk.org/jeps/490

---

# Status Seri

Seri `learn-java-testing-benchmarking-performance-jvm` **selesai**.

Progress akhir:

```text
Part 000 sampai Part 031 selesai.
Total: 32 part.
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-testing-benchmarking-performance-jvm-part-030](./learn-java-testing-benchmarking-performance-jvm-part-030.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-bpmn-camunda-process-orchestration-engineering](../../.be/cammunda/learn-java-bpmn-camunda-part-00-orientation.md)

</div>