# Part 15 — Metrics Engineering: RED, USE, JVM, Application, Business Metrics

> Series: `learn-java-logging-observability-profiling-troubleshooting-engineering`  
> Scope: Java 8 sampai Java 25  
> Fokus: metrics engineering untuk observability, reliability, capacity, SLO, dan troubleshooting sistem Java produksi.

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membangun fondasi:

- log sebagai runtime evidence,
- structured logging,
- context propagation,
- correlation/trace identity,
- OpenTelemetry mental model,
- OpenTelemetry Java Agent,
- manual tracing dan span design.

Sekarang kita masuk ke **metrics engineering**.

Metrics sering terlihat sederhana karena bentuknya hanya angka. Tetapi di sistem produksi, angka yang salah bisa lebih berbahaya daripada tidak punya angka sama sekali. Angka yang salah dapat membuat tim:

- mengejar root cause palsu,
- salah mengukur health sistem,
- salah menentukan kapasitas,
- salah mendesain alert,
- salah mengambil keputusan scaling,
- tidak melihat user impact,
- atau menganggap sistem sehat padahal sedang gagal secara parsial.

Part ini membahas bagaimana engineer top-tier mendesain metrics sebagai **measurement system**, bukan sekadar counter acak di kode.

---

## 1. Target Kompetensi

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Membedakan log, trace, dan metric dari sisi kegunaan diagnosis.
2. Mendesain metric yang menjawab pertanyaan operasional nyata.
3. Memilih instrument metric yang tepat: counter, gauge, up-down counter, histogram, timer, summary.
4. Menerapkan RED dan USE untuk service dan resource.
5. Mendesain JVM metrics catalog untuk Java 8–25.
6. Mendesain application metrics untuk HTTP, database, cache, queue, scheduler, batch, dan workflow.
7. Mendesain business metrics yang tetap aman dari cardinality explosion.
8. Memahami latency percentile, histogram bucket, aggregation, dan sampling window.
9. Menghindari metric anti-pattern yang menyebabkan observability cost naik drastis.
10. Menghubungkan metrics dengan logs dan traces untuk troubleshooting.
11. Mendesain SLI/SLO berbasis metric.
12. Membuat checklist production readiness untuk metrics Java service.

---

## 2. Mental Model: Metric adalah Kompresi Perilaku Runtime

Log menjawab:

> “Event apa yang terjadi?”

Trace menjawab:

> “Request ini melewati komponen mana saja dan menghabiskan waktu di mana?”

Metric menjawab:

> “Seberapa sering, seberapa lama, seberapa banyak, seberapa penuh, dan bagaimana trennya?”

Metric adalah **kompresi** dari banyak event runtime menjadi time series.

Contoh:

```text
Log events:
10:00:01 request /submit took 120ms status=200
10:00:01 request /submit took 180ms status=200
10:00:02 request /submit took 900ms status=500
10:00:02 request /submit took 240ms status=200
...
```

Metric yang bisa dihasilkan:

```text
http.server.request.count{route="/submit", status="200"} = 3
http.server.request.count{route="/submit", status="500"} = 1
http.server.request.duration.p95{route="/submit"} = 900ms
http.server.request.duration.avg{route="/submit"} = 360ms
```

Metric kehilangan detail individual, tetapi memberikan **overview sistemik**.

Itulah trade-off utama:

| Signal | Detail per event | Murah untuk agregasi | Bagus untuk trend | Bagus untuk root cause spesifik |
|---|---:|---:|---:|---:|
| Log | Tinggi | Sedang/Rendah | Sedang | Tinggi |
| Trace | Tinggi | Sedang | Sedang | Tinggi |
| Metric | Rendah | Tinggi | Tinggi | Sedang |
| Profile | Tinggi untuk runtime cost | Rendah/Sedang | Sedang | Tinggi untuk performance |

Metric bukan pengganti log dan trace. Metric adalah **radar**. Log dan trace adalah **forensic record**.

---

## 3. Pertanyaan yang Harus Dijawab Metrics

Metrics yang baik selalu dimulai dari pertanyaan.

Jangan mulai dari:

> “Kita butuh metric apa?”

Mulailah dari:

> “Saat production incident, pertanyaan apa yang harus bisa dijawab dalam 30 detik?”

Contoh pertanyaan operasional:

1. Apakah service sedang menerima traffic normal?
2. Apakah error meningkat?
3. Apakah latency naik?
4. Apakah hanya endpoint tertentu yang bermasalah?
5. Apakah masalah global atau tenant/user/agency tertentu?
6. Apakah DB pool penuh?
7. Apakah thread pool saturated?
8. Apakah GC menyebabkan pause?
9. Apakah queue backlog naik?
10. Apakah consumer lag meningkat?
11. Apakah external API lambat?
12. Apakah retry meningkat?
13. Apakah batch job stuck?
14. Apakah workflow banyak gagal di state tertentu?
15. Apakah deployment terbaru mengubah behavior?
16. Apakah resource cukup untuk peak traffic?
17. Apakah SLO dilanggar?

Metric yang tidak menjawab pertanyaan diagnosis, capacity, atau reliability biasanya hanya noise.

---

## 4. Metrics sebagai Time Series

Metric bukan hanya nama dan angka. Metric adalah **time series**.

Secara konseptual:

```text
metric_name{label_key="label_value", ...} -> sequence of timestamped values
```

Contoh:

```text
http.server.request.duration{service="case-service", route="/cases/{id}", method="GET", status="200"}
  10:00:00 -> bucket counts
  10:01:00 -> bucket counts
  10:02:00 -> bucket counts
```

Elemen penting:

1. **Metric name** — apa yang diukur.
2. **Labels/attributes/tags** — dimensi analisis.
3. **Value** — angka.
4. **Timestamp** — kapan angka berlaku.
5. **Unit** — detik, bytes, requests, connections, percent.
6. **Temporality** — cumulative atau delta.
7. **Aggregation** — sum, count, histogram, min/max, percentile.

Kesalahan umum: membuat metric tanpa unit dan tanpa definisi.

Buruk:

```text
processing_time
```

Lebih baik:

```text
case.transition.duration.seconds
```

Atau sesuai convention tool tertentu:

```text
case_transition_duration_seconds
```

---

## 5. Metric Name vs Label: Jangan Salah Membagi Dimensi

Pertanyaan desain penting:

> “Ini harus menjadi metric name atau label?”

Buruk:

```text
login_success_count
login_failed_count
renewal_success_count
renewal_failed_count
appeal_success_count
appeal_failed_count
```

Lebih baik:

```text
business.operation.count{operation="login", outcome="success"}
business.operation.count{operation="login", outcome="failure"}
business.operation.count{operation="renewal", outcome="success"}
business.operation.count{operation="appeal", outcome="failure"}
```

Tetapi jangan berlebihan.

Buruk karena cardinality tinggi:

```text
business.operation.count{operation="renewal", user_id="U123456789", case_id="CASE-2026-000001"}
```

Metric harus agregatif. Untuk identitas spesifik, gunakan log/trace, bukan label metric.

Rule praktis:

| Data | Cocok jadi metric label? | Catatan |
|---|---:|---|
| HTTP method | Ya | Low cardinality |
| Route template | Ya | `/cases/{id}`, bukan `/cases/123` |
| Status code/class | Ya | `200`, `500`, atau `2xx`, `5xx` |
| Service name | Ya | Wajib |
| Environment | Ya | `dev`, `uat`, `prod` |
| Endpoint raw URL | Tidak | High cardinality |
| User ID | Tidak | PII/high cardinality |
| Case ID | Tidak | High cardinality |
| Trace ID | Tidak | High cardinality; pakai exemplar/log/trace |
| Exception message | Tidak | High cardinality |
| Exception class | Biasanya ya | Low/medium cardinality |
| Tenant/agency | Tergantung | Bisa, jika jumlah kecil dan governance jelas |
| SQL text | Tidak | Gunakan fingerprint/operation |

---

## 6. Instrument Types: Counter, Gauge, Histogram, Timer, Summary

### 6.1 Counter

Counter adalah angka yang hanya naik.

Gunakan untuk:

- jumlah request,
- jumlah error,
- jumlah retry,
- jumlah message processed,
- jumlah login attempt,
- jumlah batch item processed,
- jumlah state transition.

Contoh:

```text
http.server.requests.total{route="/cases/{id}", method="GET", status="200"}
```

Jangan gunakan counter untuk nilai yang bisa turun.

Buruk:

```text
active_sessions_total
```

Karena active sessions bisa naik dan turun. Itu gauge.

### 6.2 Gauge

Gauge adalah nilai saat ini.

Gunakan untuk:

- active connections,
- queue depth,
- heap used,
- CPU usage,
- thread count,
- active sessions,
- in-flight requests,
- DB pool active connections,
- cache size.

Contoh:

```text
hikaricp.connections.active{pool="main"}
```

Gauge bisa naik dan turun.

### 6.3 UpDownCounter

UpDownCounter adalah counter yang bisa naik dan turun, biasanya untuk nilai yang berubah lewat event increment/decrement.

Gunakan untuk:

- in-flight requests,
- active jobs,
- active workflow instances,
- active locks,
- active uploads.

Bedanya dengan gauge: gauge biasanya diobservasi dari state saat collection; up-down counter berubah lewat operasi.

### 6.4 Histogram

Histogram mencatat distribusi nilai.

Gunakan untuk:

- request duration,
- DB query duration,
- external API duration,
- payload size,
- batch item processing duration,
- queue wait time,
- lock wait time.

Histogram bagus untuk percentile dan SLO.

Contoh:

```text
http.server.request.duration.seconds{route="/cases/{id}", method="GET"}
```

Histogram menjawab:

- berapa banyak request < 100ms,
- berapa banyak request < 500ms,
- berapa p95 latency,
- berapa p99 latency,
- apakah tail latency memburuk.

### 6.5 Timer

Dalam Micrometer, `Timer` biasanya adalah kombinasi count + total time + histogram/distribution, tergantung backend.

Gunakan untuk durasi pendek:

- HTTP latency,
- DB query latency,
- cache access latency,
- operation latency.

### 6.6 Distribution Summary

Distribution summary mirip timer, tetapi untuk nilai non-time.

Gunakan untuk:

- request payload size,
- response payload size,
- file size,
- batch chunk size,
- number of items per request,
- number of recipients per email.

---

## 7. RED Method: Service-Level Metrics

RED:

1. **Rate** — berapa request/operation per detik.
2. **Errors** — berapa failure/error.
3. **Duration** — berapa lama operasi berlangsung.

RED cocok untuk service, endpoint, RPC, dependency call, job operation, dan workflow transition.

Contoh untuk HTTP service:

```text
Rate:
http.server.request.count{service, route, method}

Errors:
http.server.request.count{service, route, method, status_class="5xx"}

Duration:
http.server.request.duration{service, route, method}
```

Contoh untuk external API:

```text
external.api.request.count{system="onemap", operation="search_address", outcome="success"}
external.api.request.count{system="onemap", operation="search_address", outcome="failure", error_type="timeout"}
external.api.request.duration{system="onemap", operation="search_address"}
```

Contoh untuk state transition:

```text
workflow.transition.count{workflow="case", from_state="submitted", to_state="screening", outcome="success"}
workflow.transition.count{workflow="case", from_state="submitted", to_state="screening", outcome="failure", reason="validation_failed"}
workflow.transition.duration{workflow="case", transition="submit_to_screening"}
```

### 7.1 RED untuk Dependency

Dependency adalah sumber latency dan failure yang sering tersembunyi.

Untuk setiap dependency penting, ukur:

- request count,
- success count,
- failure count,
- timeout count,
- retry count,
- latency histogram,
- circuit breaker state,
- queue/pool saturation jika ada.

Minimal:

```text
dependency.request.count{dependency="oracle", operation="case_lookup", outcome="success"}
dependency.request.duration{dependency="oracle", operation="case_lookup"}
dependency.request.count{dependency="oracle", operation="case_lookup", outcome="failure", error_type="timeout"}
```

---

## 8. USE Method: Resource-Level Metrics

USE:

1. **Utilization** — seberapa banyak resource digunakan.
2. **Saturation** — seberapa banyak demand menunggu resource.
3. **Errors** — error yang terkait resource.

USE cocok untuk:

- CPU,
- memory,
- disk,
- network,
- thread pool,
- connection pool,
- queue,
- executor,
- cache,
- file descriptor,
- container cgroup.

Contoh HikariCP:

```text
Utilization:
hikaricp.connections.active / hikaricp.connections.max

Saturation:
hikaricp.connections.pending

Errors:
hikaricp.connections.timeout.count
```

Contoh thread pool:

```text
Utilization:
executor.active.threads / executor.pool.size

Saturation:
executor.queue.size

Errors:
executor.rejected.tasks.count
```

Contoh CPU:

```text
Utilization:
process.cpu.usage
system.cpu.usage
container.cpu.usage

Saturation:
container.cpu.throttled.time
run queue length

Errors:
usually not direct; infer via throttling, scheduling delay, request timeout
```

---

## 9. Golden Signals

Google SRE popularized four golden signals:

1. Latency
2. Traffic
3. Errors
4. Saturation

Mapping ke service Java:

| Golden Signal | Java service metric |
|---|---|
| Latency | HTTP duration, DB duration, external API duration, queue wait time |
| Traffic | HTTP request rate, message consume rate, job item rate |
| Errors | HTTP 5xx, exception count, timeout count, failed transition count |
| Saturation | CPU throttling, DB pool pending, thread pool queue, heap pressure, queue lag |

Golden signals bagus sebagai top-level dashboard.

Tetapi untuk troubleshooting, kamu tetap butuh dimensi lebih detail:

- route,
- operation,
- dependency,
- outcome,
- error type,
- environment,
- version,
- node/pod,
- pool name.

---

## 10. JVM Metrics Catalog

JVM metrics adalah baseline untuk semua Java service.

### 10.1 Heap Memory

Ukur:

```text
jvm.memory.used{area="heap"}
jvm.memory.committed{area="heap"}
jvm.memory.max{area="heap"}
```

Interpretasi:

- `used` naik terus dan tidak turun setelah GC: kemungkinan leak atau cache growth.
- `committed` mendekati `max`: heap pressure.
- `used/max` tinggi setelah full/concurrent GC: risk OOM.

### 10.2 Non-Heap Memory

Ukur:

```text
jvm.memory.used{area="nonheap"}
jvm.memory.used{pool="Metaspace"}
jvm.memory.used{pool="Code Cache"}
```

Penting untuk:

- classloader leak,
- dynamic proxy/codegen heavy system,
- excessive generated classes,
- long-running app server.

### 10.3 GC Metrics

Ukur:

```text
jvm.gc.pause.duration
jvm.gc.collections.count
jvm.gc.memory.allocated
jvm.gc.memory.promoted
jvm.gc.live.data.size
```

Interpretasi:

- pause p99 naik: user-facing latency bisa terdampak.
- allocation rate naik: object churn.
- promoted bytes naik: short-lived object menjadi long-lived.
- live data size naik terus: memory retention.

Untuk Java 8, format dan naming bergantung pada library/backend. Untuk Java 11+, unified logging dan JFR dapat membantu korelasi.

### 10.4 Threads

Ukur:

```text
jvm.threads.live
jvm.threads.daemon
jvm.threads.peak
jvm.threads.states{state="runnable"}
jvm.threads.states{state="blocked"}
jvm.threads.states{state="waiting"}
```

Interpretasi:

- live threads naik terus: thread leak.
- blocked threads naik: lock contention.
- waiting banyak bisa normal, tergantung pool.
- runnable tinggi + CPU tinggi: CPU-bound.
- runnable tinggi + CPU rendah: bisa scheduling/container throttling.

### 10.5 Class Loading

```text
jvm.classes.loaded
jvm.classes.unloaded
```

Interpretasi:

- loaded class naik terus: dynamic loading/codegen/classloader leak.

### 10.6 Direct Buffer / NIO Buffer

```text
jvm.buffer.memory.used{pool="direct"}
jvm.buffer.count{pool="direct"}
jvm.buffer.total.capacity{pool="direct"}
```

Penting untuk:

- Netty,
- NIO,
- file transfer,
- HTTP clients,
- gRPC,
- off-heap buffer.

### 10.7 Process Metrics

```text
process.cpu.usage
process.memory.usage
process.open.fds
process.start.time
```

Penting untuk:

- file descriptor leak,
- CPU spike,
- memory outside heap,
- restart detection.

### 10.8 Container Metrics

Untuk Kubernetes/container:

```text
container.cpu.usage
container.cpu.throttled.time
container.memory.usage
container.memory.limit
container.restart.count
pod.ready
pod.restarts
```

Jangan hanya melihat JVM heap. Banyak Java incident terjadi karena container memory limit, native memory, direct buffer, metaspace, thread stack, atau sidecar overhead.

---

## 11. HTTP Metrics

Minimal HTTP server metrics:

```text
http.server.request.count{method, route, status_code, status_class}
http.server.request.duration{method, route, status_code/status_class}
http.server.active_requests{method, route}
http.server.request.size
http.server.response.size
```

### 11.1 Route Template, Bukan Raw Path

Buruk:

```text
route="/cases/123456"
route="/cases/123457"
route="/cases/123458"
```

Baik:

```text
route="/cases/{caseId}"
```

Raw path menyebabkan cardinality explosion.

### 11.2 Status Code vs Status Class

Status code detail membantu, tetapi bisa menambah series.

Praktis:

- dashboard utama pakai `status_class`: `2xx`, `4xx`, `5xx`.
- drilldown boleh pakai `status_code` jika cardinality tetap terkendali.

### 11.3 Client Abort

Client abort sering terlihat sebagai error server, padahal user/client menutup koneksi.

Metric perlu membedakan:

```text
outcome="client_aborted"
outcome="server_error"
outcome="timeout"
```

---

## 12. Database Metrics

Untuk Java service dengan JDBC/HikariCP, minimal:

### 12.1 Pool Metrics

```text
hikaricp.connections.active{pool}
hikaricp.connections.idle{pool}
hikaricp.connections.pending{pool}
hikaricp.connections.max{pool}
hikaricp.connections.min{pool}
hikaricp.connections.timeout.count{pool}
hikaricp.connections.creation.duration{pool}
```

Interpretasi:

- active mendekati max + pending naik: pool saturation.
- pending naik tapi DB CPU rendah: kemungkinan leak/long transaction/network issue.
- timeout count naik: user-facing failure imminent.
- idle selalu tinggi + latency tinggi: bukan pool capacity problem.

### 12.2 Query Metrics

Jangan label metric dengan raw SQL.

Gunakan:

```text
db.client.operation.duration{db.system="oracle", operation="case_search", outcome="success"}
db.client.operation.count{db.system="oracle", operation="case_search", outcome="failure", error_type="lock_timeout"}
```

Jika perlu fingerprint:

```text
query_fingerprint="select_case_by_id"
```

Bukan:

```text
sql="select * from case where id = 123456"
```

### 12.3 Transaction Metrics

Untuk sistem enterprise, ukur transaction boundary:

```text
db.transaction.duration{transaction="submit_case"}
db.transaction.rollback.count{transaction="submit_case", reason="optimistic_lock"}
db.transaction.commit.count{transaction="submit_case"}
```

Ini berguna untuk membedakan:

- query lambat,
- transaction terlalu panjang,
- lock contention,
- retry storm,
- rollback akibat validation/state conflict.

---

## 13. Cache Metrics

Cache yang tidak diobservasi sering menjadi sumber false confidence.

Minimal:

```text
cache.requests.count{cache="postal_code", result="hit"}
cache.requests.count{cache="postal_code", result="miss"}
cache.evictions.count{cache="postal_code", reason="size"}
cache.size{cache="postal_code"}
cache.load.duration{cache="postal_code"}
cache.load.count{cache="postal_code", outcome="success"}
cache.load.count{cache="postal_code", outcome="failure"}
```

Interpretasi:

- hit ratio turun tiba-tiba: cache invalidation, key change, deployment, TTL terlalu pendek.
- load failure naik: dependency di belakang cache bermasalah.
- eviction tinggi: cache terlalu kecil atau key cardinality naik.
- size naik terus: leak atau unbounded cache.

Hit ratio:

```text
hit_ratio = hit / (hit + miss)
```

Tetapi jangan hanya melihat hit ratio global. Lihat juga per cache/operation.

---

## 14. Queue and Messaging Metrics

Untuk RabbitMQ/Kafka/SQS/JMS-like flow, metrics harus menjawab:

- apakah producer lebih cepat dari consumer?
- apakah backlog naik?
- apakah message gagal diproses?
- apakah retry meningkat?
- apakah DLQ bertambah?
- apakah consumer stuck?

Minimal:

```text
messaging.produced.count{destination, message_type, outcome}
messaging.consumed.count{destination, message_type, outcome}
messaging.processing.duration{destination, message_type}
messaging.retry.count{destination, message_type, reason}
messaging.dlq.count{destination, message_type, reason}
messaging.queue.depth{destination}
messaging.consumer.lag{destination, consumer_group}
```

### 14.1 Queue Depth vs Lag

Queue depth:

> Berapa message menunggu di queue.

Lag:

> Seberapa jauh consumer tertinggal dari producer/offset terbaru.

Queue depth bagus untuk queue broker biasa. Consumer lag sangat penting untuk Kafka-like systems.

### 14.2 Poison Message Detection

Metric:

```text
messaging.retry.count{message_type="case-submitted", reason="validation_error"}
messaging.dlq.count{message_type="case-submitted", reason="deserialization_error"}
```

Jika retry naik tapi processed count tidak naik, kemungkinan poison message atau dependency unavailable.

---

## 15. Scheduler and Batch Metrics

Scheduler/batch sering gagal diam-diam.

Minimal:

```text
job.execution.count{job="daily_reconciliation", outcome="success"}
job.execution.count{job="daily_reconciliation", outcome="failure", reason="timeout"}
job.execution.duration{job="daily_reconciliation"}
job.last_success.timestamp{job="daily_reconciliation"}
job.items.processed.count{job="daily_reconciliation", outcome="success"}
job.items.processed.count{job="daily_reconciliation", outcome="failure", reason}
job.items.remaining{job="daily_reconciliation"}
job.lock.acquisition.count{job, outcome}
job.skipped.count{job, reason="already_running"}
```

### 15.1 Last Success Timestamp

Untuk job harian, count saja tidak cukup.

Pertanyaan penting:

> “Kapan terakhir job ini sukses?”

Metric:

```text
job.last_success.timestamp{job="daily_reconciliation"} = epoch_seconds
```

Alert:

```text
now - job.last_success.timestamp > expected_interval + tolerance
```

### 15.2 Scheduler Drift

Scheduler drift:

> Job dijadwalkan jam 01:00 tetapi baru mulai jam 01:20.

Metric:

```text
job.schedule.delay.duration{job="daily_reconciliation"}
```

Penyebab:

- thread pool scheduler penuh,
- node overloaded,
- leader election delay,
- lock contention,
- prior job overrun.

---

## 16. Workflow and State Machine Metrics

Untuk sistem case management/regulatory workflow, metrics state transition sangat penting.

Minimal:

```text
workflow.instance.count{workflow="case", state="submitted"}
workflow.transition.count{workflow="case", from_state="submitted", to_state="screening", outcome="success"}
workflow.transition.count{workflow="case", from_state="screening", to_state="rejected", outcome="success", reason="eligibility_failed"}
workflow.transition.duration{workflow="case", transition="submitted_to_screening"}
workflow.state.age.duration{workflow="case", state="pending_review"}
workflow.escalation.count{workflow="case", reason="sla_breach"}
```

### 16.1 State Age

State age menjawab:

> “Berapa lama item tertahan di state tertentu?”

Ini sangat berguna untuk SLA dan bottleneck.

Contoh:

```text
workflow.state.age.p95{workflow="case", state="pending_officer_review"} > 3 days
```

### 16.2 Transition Failure

Metric transition failure harus punya reason yang low-cardinality:

```text
reason="validation_failed"
reason="optimistic_lock"
reason="authorization_denied"
reason="dependency_timeout"
reason="invalid_state"
```

Jangan gunakan exception message atau case ID sebagai label.

---

## 17. Business Metrics

Business metrics menjawab impact ke domain.

Contoh:

```text
application.submission.count{application_type="renewal", outcome="success"}
application.submission.count{application_type="renewal", outcome="failure", reason="validation"}
payment.collection.amount{payment_type="fee", currency="SGD"}
case.created.count{case_type="compliance"}
case.closed.count{case_type="compliance", outcome="resolved"}
appeal.submitted.count{appeal_type="license"}
```

Business metric sangat powerful, tetapi harus hati-hati:

- jangan masukkan PII,
- jangan masukkan ID spesifik,
- jangan masukkan free text,
- jangan expose sensitive business detail ke backend yang terlalu luas aksesnya,
- pastikan definisi disetujui domain owner.

### 17.1 Business Metric vs Audit Log

Business metric:

> Agregasi numerik.

Audit log:

> Bukti spesifik siapa melakukan apa, kapan, terhadap objek apa.

Jangan mengganti audit log dengan metric.

---

## 18. Cardinality: Musuh Terbesar Metrics

Cardinality adalah jumlah kombinasi label values.

Contoh:

```text
metric: http.server.request.duration
labels:
  method: 5 values
  route: 100 values
  status: 10 values
  instance: 20 values
```

Total series potensial:

```text
5 * 100 * 10 * 20 = 100,000 time series
```

Tambahkan `user_id` 1 juta values:

```text
100,000 * 1,000,000 = 100,000,000,000 time series
```

Itu menghancurkan backend metrics.

### 18.1 Label yang Berbahaya

Hindari:

- user ID,
- email,
- phone number,
- case ID,
- request ID,
- trace ID,
- session ID,
- raw URL,
- raw SQL,
- exception message,
- error detail free text,
- file path dinamis,
- IP address jika cardinality tinggi,
- timestamp sebagai label,
- UUID sebagai label.

### 18.2 Cardinality Budget

Setiap metric harus punya budget.

Contoh:

```text
Metric: workflow.transition.count
Allowed labels:
- workflow: <= 20
- from_state: <= 50
- to_state: <= 50
- outcome: <= 5
- reason: <= 30

Estimated worst-case: 20 * 50 * 50 * 5 * 30 = 7,500,000
```

Itu terlalu besar jika semua kombinasi muncul.

Perbaiki:

- batasi workflow/state yang dimonitor,
- pakai transition name yang curated,
- reason taxonomy kecil,
- jangan include from/to untuk semua dashboard; gunakan log/trace untuk detail.

---

## 19. Units and Naming

Metric tanpa unit menyebabkan kebingungan.

Prinsip:

1. Durasi gunakan seconds di backend yang mengikuti Prometheus style.
2. Size gunakan bytes.
3. Count gunakan unit `{item}` atau tanpa suffix tergantung convention.
4. Ratio gunakan 0.0–1.0, bukan 0–100, kecuali jelas.
5. Timestamp gunakan epoch seconds jika sebagai gauge.

Contoh baik:

```text
http.server.request.duration.seconds
file.upload.size.bytes
job.last_success.timestamp.seconds
cache.hit.ratio
```

Contoh buruk:

```text
latency
size
memory
success_rate
```

---

## 20. Percentile, Average, and Tail Latency

Average sering menipu.

Contoh:

```text
99 request = 100ms
1 request = 10,000ms
```

Average:

```text
(99 * 100 + 1 * 10000) / 100 = 199ms
```

Average terlihat baik, tetapi satu user mengalami 10 detik.

Karena itu latency perlu percentile:

- p50: median user experience,
- p90: slow users,
- p95: typical tail,
- p99: severe tail,
- p99.9: extreme tail.

### 20.1 Percentile Tidak Selalu Aggregatable

Percentile yang dihitung di instance lokal tidak bisa digabung begitu saja.

Contoh:

- instance A p95 = 100ms,
- instance B p95 = 900ms,
- global p95 bukan rata-rata 500ms.

Histogram lebih aman untuk agregasi cross-instance jika bucket dirancang benar.

### 20.2 Bucket Design

Bucket harus mencerminkan SLO dan domain.

HTTP API umum:

```text
0.005s, 0.01s, 0.025s, 0.05s, 0.1s, 0.25s, 0.5s, 1s, 2.5s, 5s, 10s
```

Batch item processing mungkin:

```text
0.1s, 0.5s, 1s, 5s, 10s, 30s, 60s, 300s
```

External slow API mungkin:

```text
0.1s, 0.5s, 1s, 2s, 5s, 10s, 30s
```

Bucket buruk menyebabkan p95/p99 tidak akurat untuk threshold yang kamu pedulikan.

---

## 21. SLI, SLO, and Error Budget

### 21.1 SLI

SLI adalah measurement.

Contoh:

```text
Availability SLI = successful_requests / valid_requests
Latency SLI = requests_under_500ms / valid_requests
```

### 21.2 SLO

SLO adalah target.

Contoh:

```text
99.9% valid requests must complete successfully over 30 days.
95% valid requests must complete under 500ms over 7 days.
```

### 21.3 Error Budget

Error budget adalah toleransi failure.

Jika SLO availability 99.9%, error budget = 0.1%.

SLO membantu menentukan:

- kapan incident declared,
- kapan release freeze,
- kapan reliability work diprioritaskan,
- kapan alert meaningful.

### 21.4 Good vs Bad SLO Metric

Buruk:

```text
CPU < 80%
```

CPU rendah tidak berarti user happy.

Lebih baik:

```text
99.5% case submission requests succeed and complete under 2 seconds over rolling 7 days.
```

Resource metric penting untuk diagnosis, tetapi user-facing SLO harus berbasis user impact.

---

## 22. Alerts: Metrics yang Actionable

Alert harus actionable.

Buruk:

```text
Heap usage > 80%
```

Mungkin normal untuk JVM.

Lebih baik:

```text
Heap used after GC > 85% for 15 minutes AND allocation failure/full GC count increasing
```

Buruk:

```text
HTTP 500 count > 0
```

Mungkin satu error harmless.

Lebih baik:

```text
5xx rate > 2% for 5 minutes AND request rate > minimum traffic threshold
```

### 22.1 Alert Anti-Pattern

1. Alert tanpa owner.
2. Alert tanpa runbook.
3. Alert tanpa threshold rationale.
4. Alert berdasarkan symptom minor.
5. Alert terlalu sensitif.
6. Alert tidak mempertimbangkan traffic rendah.
7. Alert untuk dashboard curiosity.
8. Alert yang selalu di-snooze.

### 22.2 Multi-Window Burn Rate

Untuk SLO-based alerting, gunakan burn rate.

Konsep:

> Seberapa cepat error budget habis?

Contoh:

- fast burn: incident besar sekarang,
- slow burn: masalah kecil tetapi berkelanjutan.

---

## 23. Metrics Implementation in Java

Ada beberapa jalur implementasi:

1. OpenTelemetry Metrics API/SDK.
2. Micrometer.
3. Dropwizard Metrics legacy.
4. Vendor-specific SDK.
5. JMX exported metrics.
6. Auto-instrumentation via OpenTelemetry Java Agent.

### 23.1 OpenTelemetry Java Metrics

Konsep:

```java
Meter meter = openTelemetry.getMeter("case-service");

LongCounter submissionCounter = meter
    .counterBuilder("case.submission.count")
    .setDescription("Number of case submissions")
    .setUnit("{submission}")
    .build();

submissionCounter.add(1, Attributes.of(
    AttributeKey.stringKey("case.type"), "renewal",
    AttributeKey.stringKey("outcome"), "success"
));
```

### 23.2 Histogram

```java
DoubleHistogram duration = meter
    .histogramBuilder("case.submission.duration")
    .setDescription("Case submission duration")
    .setUnit("s")
    .build();

long start = System.nanoTime();
try {
    submitCase(command);
    duration.record(secondsSince(start), Attributes.of(
        AttributeKey.stringKey("case.type"), command.caseType(),
        AttributeKey.stringKey("outcome"), "success"
    ));
} catch (Exception ex) {
    duration.record(secondsSince(start), Attributes.of(
        AttributeKey.stringKey("case.type"), command.caseType(),
        AttributeKey.stringKey("outcome"), "failure",
        AttributeKey.stringKey("error.type"), classify(ex)
    ));
    throw ex;
}
```

Helper:

```java
static double secondsSince(long startNanos) {
    return (System.nanoTime() - startNanos) / 1_000_000_000.0;
}
```

### 23.3 Observable Gauge

```java
meter.gaugeBuilder("case.queue.depth")
    .setDescription("Number of cases waiting for processing")
    .setUnit("{case}")
    .buildWithCallback(measurement -> {
        measurement.record(queueDepthProvider.currentDepth(), Attributes.of(
            AttributeKey.stringKey("queue"), "case-screening"
        ));
    });
```

### 23.4 Micrometer Example

```java
Counter.builder("case.submission.count")
    .description("Number of case submissions")
    .tag("case.type", caseType)
    .tag("outcome", "success")
    .register(meterRegistry)
    .increment();
```

Timer:

```java
Timer.Sample sample = Timer.start(meterRegistry);
try {
    submitCase(command);
    sample.stop(Timer.builder("case.submission.duration")
        .tag("case.type", command.caseType())
        .tag("outcome", "success")
        .register(meterRegistry));
} catch (Exception ex) {
    sample.stop(Timer.builder("case.submission.duration")
        .tag("case.type", command.caseType())
        .tag("outcome", "failure")
        .tag("error.type", classify(ex))
        .register(meterRegistry));
    throw ex;
}
```

### 23.5 Important Implementation Rule

Do not create new meter objects dynamically for unbounded labels.

Bad:

```java
Counter.builder("case.submission.count")
    .tag("case.id", caseId)
    .register(registry)
    .increment();
```

Good:

```java
submissionCounter.add(1, Attributes.of(
    AttributeKey.stringKey("case.type"), caseType,
    AttributeKey.stringKey("outcome"), outcome
));
```

But only if `case.type` and `outcome` are bounded.

---

## 24. Metrics and Java Version Differences: Java 8–25

### 24.1 Java 8

Constraints:

- older GC logging style,
- no unified logging,
- commercial-era JFR history depending on distribution/update,
- many legacy app servers,
- older Spring Boot/Dropwizard/Micrometer versions possible.

Metrics strategy:

- rely on Micrometer/JMX/agent,
- export JVM metrics via JMX or instrumentation library,
- standardize labels externally,
- be careful with old library instrumentation gaps.

### 24.2 Java 11

Improvements:

- unified logging,
- production JFR availability in OpenJDK builds,
- stronger container awareness compared to Java 8.

Metrics strategy:

- combine JVM runtime metrics with JFR for deeper incident analysis,
- container memory/CPU correlation becomes more reliable.

### 24.3 Java 17

Common enterprise LTS baseline.

Metrics strategy:

- OpenTelemetry Java agent support is mature,
- JFR useful for continuous diagnostics,
- Micrometer/Spring Boot ecosystem strong.

### 24.4 Java 21

Virtual threads introduced as production feature.

Metrics considerations:

- platform thread count no longer represents logical concurrency if virtual threads are used,
- executor metrics must distinguish carrier/platform threads vs virtual task concurrency,
- blocking operation metrics become more important,
- thread dump interpretation changes.

### 24.5 Java 25

Modern runtime direction:

- virtual threads mature,
- scoped values finalized,
- structured concurrency continues to shape context propagation patterns.

Metrics considerations:

- measure logical operations, not just thread counts,
- track queue/backpressure explicitly,
- avoid assuming one request equals one platform thread.

---

## 25. Dashboard Design

Dashboard bukan tempat menaruh semua metric.

Dashboard harus menjawab pertanyaan.

### 25.1 Service Overview Dashboard

Panels:

1. Request rate.
2. Error rate.
3. Latency p50/p95/p99.
4. Saturation indicators.
5. JVM heap after GC.
6. GC pause p95/p99.
7. DB pool active/pending.
8. External dependency latency/error.
9. Queue depth/lag.
10. Recent deploy version.

### 25.2 Dependency Dashboard

Panels:

1. Dependency request rate.
2. Dependency error rate by error type.
3. Dependency latency percentile.
4. Retry rate.
5. Timeout rate.
6. Circuit breaker state.
7. Pool saturation.

### 25.3 JVM Dashboard

Panels:

1. Heap used/committed/max.
2. Non-heap/metaspace/code cache.
3. Allocation rate.
4. GC pause.
5. GC count by cause/type.
6. Threads by state.
7. Direct buffer memory.
8. CPU usage/throttling.
9. Open file descriptors.

### 25.4 Workflow Dashboard

Panels:

1. Instances by state.
2. Transition count by outcome.
3. Transition failure reason.
4. State age p95/p99.
5. SLA breach count.
6. Escalation count.
7. Retry count.
8. Manual intervention count.

---

## 26. Metrics + Logs + Traces Correlation

Metric detects anomaly.

Trace localizes latency/failure path.

Log explains business/technical context.

Example investigation:

1. Alert: `case.submission.error_rate > 5%`.
2. Dashboard: only `renewal` type affected.
3. Trace: failures happen in `ExternalAddressValidationClient`.
4. Metric: external API timeout p99 increased.
5. Log: retry exhausted with `dependency_timeout` and `correlation.id`.
6. Root cause: external dependency latency + retry amplification.
7. Fix: deadline budget, cache fallback, rate limit, circuit breaker tuning.

Without metric, you may not know blast radius.

Without trace, you may not know where time is spent.

Without log, you may not know why the decision failed.

---

## 27. Anti-Patterns

### 27.1 Metrics Without Ownership

Metric exists, but no one knows:

- definition,
- owner,
- dashboard,
- alert threshold,
- expected range.

This becomes observability garbage.

### 27.2 High-Cardinality Labels

```text
user_id
case_id
trace_id
request_id
raw_path
raw_sql
exception_message
```

These belong in logs/traces, not metric labels.

### 27.3 Counting Success Only

Bad:

```text
case.submission.success.count
```

Need both success and failure:

```text
case.submission.count{outcome="success"}
case.submission.count{outcome="failure", reason="validation_failed"}
```

### 27.4 Alerting on Resource Alone

CPU high is symptom. Alert on user impact first, resource saturation second.

### 27.5 Average Latency Only

Average hides tail latency.

### 27.6 No Unit

Metric named `duration` without unit causes bad interpretation.

### 27.7 Too Many Business Labels

Business wants every dimension. Metrics backend cannot handle every dimension.

Use curated dimensions and logs/warehouse for high-cardinality analytics.

### 27.8 Dynamic Metric Names

Bad:

```text
case.submission.renewal.success.count
case.submission.new_license.success.count
```

Better:

```text
case.submission.count{application_type="renewal", outcome="success"}
```

### 27.9 Misusing Gauge for Events

Gauge for request count loses event history.

Use counter.

### 27.10 Misusing Counter for Current State

Counter for active sessions is wrong because active sessions can decrease.

Use gauge/up-down counter.

---

## 28. Production Metrics Standard Template

Every new service should define:

```yaml
service:
  name: case-service
  owner: case-platform-team
  tier: user-facing

sli:
  availability:
    definition: successful valid requests / valid requests
    target: 99.9% over 30 days
  latency:
    definition: valid requests under 2s / valid requests
    target: 95% over 7 days

required_metrics:
  http:
    - request_count
    - request_duration
    - active_requests
  jvm:
    - heap_used
    - gc_pause
    - thread_states
    - direct_buffer_memory
  db:
    - pool_active
    - pool_pending
    - pool_timeout_count
    - operation_duration
  dependency:
    - request_count
    - request_duration
    - timeout_count
    - retry_count
  workflow:
    - transition_count
    - transition_duration
    - state_age
  batch:
    - job_execution_count
    - job_duration
    - last_success_timestamp

label_policy:
  forbidden:
    - user_id
    - case_id
    - request_id
    - trace_id
    - raw_path
    - raw_sql
    - exception_message
  controlled:
    - route
    - operation
    - outcome
    - error_type
    - dependency
    - tenant
```

---

## 29. Metric Review Checklist

Sebelum metric masuk production, jawab:

1. Apa pertanyaan yang dijawab metric ini?
2. Siapa owner metric ini?
3. Apakah metric ini counter/gauge/histogram yang tepat?
4. Apa unit-nya?
5. Apakah name stabil?
6. Apakah labels bounded?
7. Apakah ada high-cardinality label?
8. Apakah label mengandung PII/secret?
9. Apakah metric bisa dikorelasikan dengan trace/log?
10. Apakah metric dipakai dashboard atau alert?
11. Apakah threshold alert punya rationale?
12. Apakah ada runbook?
13. Apakah metric akan tetap berguna 6 bulan lagi?
14. Apakah metric menduplikasi metric lain?
15. Apakah metric bisa menyebabkan cost besar?

---

## 30. Practical Lab 1 — Design Metrics for Case Submission

Scenario:

```text
Endpoint: POST /cases
Flow:
1. Validate request
2. Check applicant eligibility
3. Save case to DB
4. Publish case-submitted event
5. Return response
```

Design metrics:

```text
http.server.request.count{route="/cases", method="POST", status_class}
http.server.request.duration{route="/cases", method="POST"}

case.submission.count{application_type, outcome, reason}
case.submission.duration{application_type, outcome}

eligibility.check.count{rule_set, outcome}
eligibility.check.duration{rule_set}

db.operation.duration{operation="insert_case", outcome}
db.operation.count{operation="insert_case", outcome, error_type}

messaging.produced.count{destination="case-submitted", outcome}
messaging.publish.duration{destination="case-submitted"}
```

Do not use:

```text
case_id
applicant_id
email
raw_payload
```

---

## 31. Practical Lab 2 — Diagnose DB Pool Saturation

Symptoms:

```text
HTTP p99 latency increased.
5xx increased.
CPU normal.
Heap normal.
```

Metrics to inspect:

```text
hikaricp.connections.active
hikaricp.connections.pending
hikaricp.connections.timeout.count
hikaricp.connections.idle
hikaricp.connections.max
http.server.request.duration
db.operation.duration
db.transaction.duration
jvm.threads.states{state="waiting"}
```

Possible interpretations:

| Evidence | Hypothesis |
|---|---|
| active=max, pending high, timeout increasing | DB pool saturated |
| active low, DB latency high | DB server/query/network issue |
| transaction duration high, query duration normal | long transaction/business logic holds connection |
| thread waiting on pool | connection acquisition bottleneck |
| after deployment only | connection leak or new slow path |

Next evidence:

- thread dump,
- trace waterfall,
- DB active session/query view,
- recent deploy diff,
- Hikari leak detection logs.

---

## 32. Practical Lab 3 — Build a Minimal Metrics Catalog

For each service, create:

```markdown
# Metrics Catalog: <service-name>

## Service SLIs
- Availability:
- Latency:
- Throughput:

## HTTP Metrics
| Name | Type | Unit | Labels | Purpose | Owner |

## JVM Metrics
| Name | Type | Unit | Labels | Purpose | Owner |

## DB Metrics
| Name | Type | Unit | Labels | Purpose | Owner |

## Dependency Metrics
| Name | Type | Unit | Labels | Purpose | Owner |

## Business Metrics
| Name | Type | Unit | Labels | Purpose | Owner |

## Forbidden Labels

## Alert Rules

## Dashboard Links

## Runbooks
```

This catalog becomes part of engineering governance.

---

## 33. Top 1% Engineering Heuristics

1. Metric must answer a decision question.
2. Every metric must have unit and owner.
3. Measure user impact before resource internals.
4. Measure saturation, not only utilization.
5. Use histograms for latency.
6. Use route templates, not raw paths.
7. Never put IDs in metric labels.
8. Treat cardinality as a budget.
9. Use metrics for detection, traces for localization, logs for explanation.
10. Build SLOs from metrics that represent user value.
11. Alert on symptoms users care about, diagnose with internal metrics.
12. Prefer low-cardinality taxonomies over free text.
13. Review metrics in PR like API contracts.
14. Continuously remove unused metrics.
15. Incident review should ask: “Which metric should have shown this earlier?”

---

## 34. Summary

Metrics engineering adalah disiplin mengubah perilaku runtime menjadi angka yang:

- akurat,
- stabil,
- murah dikumpulkan,
- bisa diagregasi,
- bisa di-alert,
- bisa dikorelasikan,
- bisa menjawab pertanyaan reliability dan business impact.

Dalam Java production system, metrics yang kuat harus mencakup:

1. RED untuk service operation.
2. USE untuk resource saturation.
3. JVM metrics untuk heap, GC, threads, classloading, buffers.
4. HTTP metrics untuk traffic/error/latency.
5. DB and pool metrics.
6. Cache metrics.
7. Messaging metrics.
8. Batch/scheduler metrics.
9. Workflow/state machine metrics.
10. Business metrics yang aman dan bounded.

Metrics bukan tujuan. Metrics adalah alat untuk membuat sistem lebih bisa dipahami, dipertahankan, dan dioperasikan dalam kondisi nyata.

---

## 35. Checklist Penguasaan Part 15

Kamu dianggap menguasai part ini jika bisa:

- [ ] menjelaskan perbedaan counter, gauge, histogram, timer, summary;
- [ ] mendesain RED metrics untuk HTTP service;
- [ ] mendesain USE metrics untuk DB pool/thread pool;
- [ ] menghindari high-cardinality labels;
- [ ] menjelaskan kenapa average latency tidak cukup;
- [ ] memilih bucket histogram berdasarkan SLO;
- [ ] membuat JVM metrics baseline;
- [ ] membuat dependency metrics baseline;
- [ ] membuat workflow/state machine metrics;
- [ ] membuat SLI/SLO sederhana;
- [ ] mendesain alert yang actionable;
- [ ] menghubungkan metric anomaly ke trace/log investigation;
- [ ] membuat metrics catalog untuk service Java.

---

## 36. Referensi Lanjutan

- OpenTelemetry Metrics API specification.
- OpenTelemetry Java documentation.
- OpenTelemetry Semantic Conventions for JVM, HTTP, and database metrics.
- Google SRE Book — Monitoring Distributed Systems.
- Prometheus metric types documentation.
- Micrometer concepts: meters, counters, gauges, timers, distribution summaries.
- JVM runtime metrics documentation for your observability stack.

---

## 37. Posisi Seri

Seri belum selesai.

Saat ini selesai sampai:

```text
Part 15 — Metrics Engineering: RED, USE, JVM, Application, Business Metrics
```

Berikutnya:

```text
Part 16 — Logs + Traces + Metrics Correlation
```


<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 14 — Manual Tracing: Span Design, Boundaries, Attributes, Events, Errors](./14-manual-tracing-span-design-boundaries-attributes-events-errors.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 16 — Logs + Traces + Metrics Correlation](./16-logs-traces-metrics-correlation.md)
