# learn-java-reliability-part-023.md

# Part 023 — Observability for Errors and Reliability

> Seri: Graceful Shutdown, Error Handling, Exceptions, dan Reliability  
> Posisi: Part 023 dari 030  
> Status seri: belum selesai  
> Fokus: menjadikan error handling sebagai sistem evidence yang dapat dipakai untuk memahami, membatasi, memulihkan, dan mencegah kegagalan produksi.

---

## 0. Kenapa Part Ini Penting

Pada part sebelumnya kita sudah membahas banyak mekanisme reliability:

- exception taxonomy;
- error contract;
- graceful shutdown;
- worker shutdown;
- transaction uncertainty;
- idempotency;
- timeout;
- retry;
- circuit breaker;
- fallback;
- external integration;
- persistence failure;
- distributed consistency dan compensation.

Namun semua mekanisme itu akan menjadi lemah kalau sistem tidak bisa menjawab pertanyaan dasar saat production bermasalah:

1. Apa yang gagal?
2. Sejak kapan gagal?
3. Berapa banyak user/request/entity yang terdampak?
4. Apakah error-nya transient atau systemic?
5. Apakah retry membantu atau memperparah?
6. Apakah dependency eksternal sedang lambat/down?
7. Apakah DB bottleneck?
8. Apakah queue backlog naik?
9. Apakah shutdown sedang berjalan?
10. Apakah ada data yang masuk state tidak konsisten?
11. Apakah operasi manual aman dilakukan?
12. Apakah incident sudah selesai atau hanya symptom-nya hilang?

Error handling tanpa observability menghasilkan sistem yang terlihat memiliki banyak `catch`, tetapi miskin bukti.

**Observability adalah kemampuan sistem untuk memberikan evidence yang cukup agar manusia dan automation dapat memahami state internal sistem dari luar.**

Spring Boot mendefinisikan observability sebagai kemampuan melihat internal state dari luar, dengan tiga pilar utama: logging, metrics, dan traces. OpenTelemetry menyediakan semantic conventions agar telemetry dari trace, metric, log, resource, dan profile memakai nama/atribut yang konsisten lintas service dan tool. Google SRE menekankan empat golden signals untuk monitoring user-facing system: latency, traffic, errors, dan saturation.

---

## 1. Core Problem

Banyak sistem enterprise punya logging, metrics, dan tracing, tetapi tetap sulit di-debug saat incident. Penyebabnya biasanya bukan karena tidak ada tool, melainkan karena telemetry tidak didesain sebagai bagian dari reliability model.

Contoh masalah umum:

```text
Ada error 500, tapi tidak tahu error code domain-nya.
Ada stack trace, tapi tidak ada request id.
Ada request id, tapi tidak tersambung ke trace id.
Ada trace id, tapi span tidak menandai dependency mana yang timeout.
Ada metric error rate, tapi tidak tahu error by business operation.
Ada log retry, tapi tidak tahu attempt number dan final outcome.
Ada circuit breaker open, tapi tidak ada alert yang menghubungkannya ke user impact.
Ada dead letter queue, tapi tidak tahu message type, aggregate id, dan retry history.
Ada graceful shutdown, tapi tidak tahu berapa request yang didrain, rejected, atau force-cancelled.
```

Masalah sebenarnya:

> Sistem tidak hanya perlu menangani error. Sistem perlu meninggalkan jejak yang benar tentang bagaimana error terjadi, menyebar, dibatasi, dan dipulihkan.

---

## 2. Mental Model: Observability sebagai Evidence System

Observability bukan sekadar “punya dashboard”. Observability adalah sistem bukti.

Bayangkan setiap failure sebagai proses investigasi:

```text
Symptom observed
  ↓
Which user operation is affected?
  ↓
Which service boundary failed?
  ↓
Which dependency or resource was involved?
  ↓
Was the failure expected, transient, retried, degraded, or unrecoverable?
  ↓
What was the final business outcome?
  ↓
What remediation is safe?
```

Telemetry yang baik harus membantu menjawab rantai tersebut.

### 2.1 Logs menjawab “apa yang terjadi?”

Log cocok untuk event diskrit:

- request rejected;
- validation failed;
- retry attempted;
- circuit breaker opened;
- worker stopped polling;
- message sent to DLQ;
- shutdown entered draining mode;
- compensation scheduled;
- invariant violation detected.

### 2.2 Metrics menjawab “berapa banyak dan seberapa parah?”

Metric cocok untuk agregasi:

- error rate;
- latency percentile;
- retry count;
- timeout count;
- request throughput;
- queue depth;
- DLQ size;
- DB pool saturation;
- circuit breaker state;
- active in-flight requests;
- graceful shutdown duration.

### 2.3 Traces menjawab “di mana waktu dan kegagalan terjadi?”

Trace cocok untuk request flow lintas boundary:

- service A memanggil service B;
- service B memanggil DB;
- service B memanggil external API;
- external API timeout;
- retry terjadi 3 kali;
- fallback dipakai;
- response degraded dikembalikan.

### 2.4 Audit trail menjawab “apa dampak bisnis/regulatory?”

Audit trail berbeda dari log teknis. Audit trail harus menjawab:

- siapa melakukan apa;
- terhadap entity apa;
- kapan;
- dari state apa ke state apa;
- dengan hasil apa;
- apakah ada override/manual action;
- apakah evidence cukup untuk pertanggungjawaban.

### 2.5 Alert menjawab “apakah manusia harus bertindak sekarang?”

Alert bukan semua error. Alert adalah signal bahwa:

- user impact signifikan;
- SLO burn tinggi;
- kapasitas mendekati batas;
- recovery otomatis gagal;
- data integrity berisiko;
- manual intervention diperlukan.

---

## 3. Observability vs Monitoring vs Telemetry

Istilah ini sering dipakai bergantian, padahal beda.

| Konsep | Makna | Contoh |
|---|---|---|
| Telemetry | Data mentah yang dihasilkan sistem | log line, metric point, span |
| Monitoring | Mengawasi known signals | dashboard latency/error rate |
| Alerting | Memberi tahu saat action diperlukan | page on-call saat SLO burn tinggi |
| Observability | Kemampuan menjawab pertanyaan baru tentang state sistem | investigasi root cause lintas service |

Monitoring sering dimulai dari pertanyaan yang sudah diketahui:

```text
Apakah CPU tinggi?
Apakah error rate naik?
Apakah queue depth naik?
```

Observability lebih kuat karena memungkinkan pertanyaan baru:

```text
Apakah error hanya terjadi untuk agency tertentu?
Apakah retry meningkat hanya saat token refresh gagal?
Apakah request yang melewati fallback menghasilkan lebih banyak appeal correction?
Apakah shutdown kemarin meninggalkan message yang belum di-ack?
```

---

## 4. Four Golden Signals sebagai Fondasi

Google SRE menyebut empat golden signals:

1. latency;
2. traffic;
3. errors;
4. saturation.

Untuk Java service, ini dapat diterjemahkan sebagai berikut.

### 4.1 Latency

Latency bukan hanya average response time.

Yang perlu dilihat:

- p50;
- p90;
- p95;
- p99;
- max;
- latency by endpoint;
- latency by dependency;
- latency by business operation;
- latency under retry;
- latency when fallback used;
- latency during shutdown/draining.

Average sering menipu.

Contoh:

```text
99 request selesai dalam 50 ms.
1 request selesai dalam 30 seconds.
Average terlihat masih kecil.
User yang terkena request 30 seconds tetap mengalami failure.
```

### 4.2 Traffic

Traffic menjawab beban masuk.

Untuk HTTP:

- request per second;
- request by endpoint;
- request by client;
- request by tenant/agency;
- request by method;
- request by response status.

Untuk worker:

- messages consumed per second;
- job executions per minute;
- batch size;
- external API calls per minute;
- DB writes per second.

### 4.3 Errors

Error bukan hanya HTTP 500.

Klasifikasi error harus minimal mencakup:

- client error;
- validation error;
- conflict;
- authentication failure;
- authorization failure;
- dependency timeout;
- dependency rejected/rate limited;
- DB constraint violation;
- DB deadlock/lock timeout;
- retry exhausted;
- fallback used;
- invariant violation;
- shutdown rejection;
- circuit breaker open;
- DLQ published.

### 4.4 Saturation

Saturation menjawab seberapa dekat sistem ke batas kapasitas.

Untuk Java service:

- CPU;
- heap usage;
- GC pause;
- thread pool active/queued;
- DB connection pool active/pending;
- HTTP client pool active/pending;
- queue backlog;
- Kafka consumer lag;
- RabbitMQ unacked messages;
- Redis latency;
- disk usage;
- file descriptor usage;
- Kubernetes pod CPU/memory limit pressure.

Error sering datang setelah saturation. Observability yang baik mendeteksi saturation sebelum user impact besar.

---

## 5. Error Observability Model

Setiap error yang penting harus memiliki dimensi evidence.

Minimal model:

```text
Error Event
  ├─ identity
  │   ├─ error_code
  │   ├─ exception_class
  │   ├─ error_type
  │   └─ severity
  │
  ├─ correlation
  │   ├─ correlation_id
  │   ├─ trace_id
  │   ├─ span_id
  │   ├─ request_id
  │   └─ idempotency_key
  │
  ├─ context
  │   ├─ operation
  │   ├─ endpoint
  │   ├─ method
  │   ├─ tenant/agency
  │   ├─ actor category
  │   ├─ aggregate type
  │   └─ aggregate id
  │
  ├─ failure semantics
  │   ├─ expected/unexpected
  │   ├─ retryable/non_retryable
  │   ├─ recoverable/non_recoverable
  │   ├─ transient/systemic
  │   ├─ degraded/final_failure
  │   └─ data_integrity_risk
  │
  ├─ outcome
  │   ├─ response_status
  │   ├─ business_outcome
  │   ├─ committed/rolled_back/unknown
  │   ├─ fallback_used
  │   ├─ compensation_required
  │   └─ manual_review_required
  │
  └─ remediation hints
      ├─ safe_to_retry
      ├─ runbook_key
      ├─ dependency
      └─ support_message_code
```

Ini bukan berarti semua field harus muncul di semua log. Tetapi model ini membantu menentukan apa yang perlu direkam pada boundary tertentu.

---

## 6. Structured Logging

### 6.1 Kenapa structured logging

Log string bebas sulit dicari secara aman dan konsisten.

Buruk:

```text
Failed to submit application for user 123 because timeout
```

Lebih baik:

```json
{
  "event": "application_submission_failed",
  "severity": "ERROR",
  "operation": "submit_application",
  "application_id": "APP-2026-000123",
  "error_code": "DEPENDENCY_TIMEOUT",
  "dependency": "screening-engine",
  "retryable": true,
  "attempt": 3,
  "final_outcome": "FAILED",
  "correlation_id": "c-7f43...",
  "trace_id": "t-92aa..."
}
```

Structured logging membuat log bisa dipakai untuk:

- query;
- aggregation;
- incident timeline;
- alert enrichment;
- correlation lintas service;
- audit support;
- anomaly detection.

### 6.2 Prinsip field naming

Gunakan nama field konsisten.

Contoh standar internal:

```text
correlation_id
trace_id
span_id
request_id
error_code
exception_class
operation
component
dependency
aggregate_type
aggregate_id
idempotency_key
retryable
attempt
max_attempts
outcome
severity
runbook_key
```

Jangan campur-campur:

```text
corrId
correlationId
xCorrelationId
requestCorrelation
trace
traceId
```

Ketidakkonsistenan naming membuat observability pecah.

### 6.3 Log level semantics

Log level harus memiliki makna operasional.

| Level | Makna yang disarankan |
|---|---|
| TRACE | Detail sangat rendah untuk development/debug sementara |
| DEBUG | Informasi diagnostik yang tidak perlu aktif terus di production |
| INFO | State transition penting dan outcome normal |
| WARN | Kondisi abnormal tetapi sistem masih berhasil recover/degrade |
| ERROR | Failure final, user impact, data risk, atau recovery otomatis gagal |

Anti-pattern:

```text
Semua exception di-log ERROR walau validasi user salah.
Semua retry attempt di-log ERROR padahal akhirnya sukses.
Circuit breaker open hanya INFO padahal user impact besar.
Invariant violation hanya WARN.
```

### 6.4 Log once rule

Exception yang sama sering di-log berkali-kali di setiap layer.

Contoh buruk:

```text
Repository logs SQLException ERROR
Service logs DataAccessException ERROR
ControllerAdvice logs ApiException ERROR
Filter logs request failed ERROR
```

Akibat:

- noise tinggi;
- alert double count;
- root cause sulit dibaca;
- log cost naik;
- incident timeline membingungkan.

Prinsip:

> Log error final pada boundary yang punya context paling kaya dan tahu outcome akhir.

Layer bawah boleh menambahkan context dengan wrapping exception, tetapi tidak selalu harus log.

### 6.5 Kapan log exception stack trace

Stack trace berguna untuk unexpected developer/system error.

Stack trace biasanya tidak perlu untuk:

- validasi input;
- domain rule violation expected;
- authentication failure normal;
- authorization failure normal;
- not found normal;
- idempotency conflict normal.

Stack trace perlu untuk:

- invariant violation;
- NullPointerException unexpected;
- serialization bug;
- mapping bug;
- unexpected DB exception;
- unhandled dependency behavior;
- retry exhausted unexpected;
- worker crash.

### 6.6 Jangan log sensitive data

Hindari:

- password;
- token;
- authorization header;
- session id;
- full NRIC/NIK/passport;
- full address;
- personal phone/email jika tidak perlu;
- raw request body yang mengandung PII;
- raw exception dari dependency yang mengandung credential;
- SQL parameter sensitif.

Gunakan:

- redaction;
- hashing untuk lookup terbatas;
- masked identifier;
- internal entity id;
- privacy classification.

---

## 7. Correlation, Trace, Span, Request ID

### 7.1 Bedanya correlation id dan trace id

| ID | Fungsi |
|---|---|
| Request ID | Identitas satu request di satu boundary/service |
| Correlation ID | Menghubungkan operation bisnis lintas beberapa call/message |
| Trace ID | Menghubungkan distributed trace dalam observability platform |
| Span ID | Identitas satu unit kerja dalam trace |
| Idempotency Key | Menghubungkan retry/replay dari command yang sama |
| Aggregate ID | Menghubungkan kejadian terhadap entity bisnis yang sama |

Jangan anggap semuanya sama.

Contoh:

```text
User submit application
  correlation_id = business operation chain
  trace_id = one HTTP processing trace
  idempotency_key = retry-safe command identity
  application_id = aggregate identity
```

Saat event async diterbitkan, trace dapat berubah atau dilanjutkan tergantung propagation, tetapi correlation id dan aggregate id harus tetap bisa menghubungkan bisnis flow.

### 7.2 Propagation

Correlation harus dipropagasi melalui:

- HTTP headers;
- message headers;
- scheduled job context;
- async executor MDC propagation;
- outbox event metadata;
- audit trail metadata;
- retry record;
- DLQ payload/metadata.

Kesalahan umum:

```text
HTTP request punya correlation id.
Service publish event ke queue.
Consumer memproses event tanpa correlation id.
Saat consumer gagal, incident tidak bisa ditelusuri ke original request.
```

### 7.3 MDC di Java logging

Dalam Java, MDC sering dipakai untuk menambahkan context ke semua log dalam thread.

Contoh konsep:

```java
try {
    MDC.put("correlation_id", correlationId);
    MDC.put("trace_id", traceId);
    MDC.put("operation", "submit_application");

    service.submit(command);
} finally {
    MDC.clear();
}
```

Namun ada trap besar:

- MDC berbasis thread-local;
- async executor tidak otomatis membawa MDC;
- virtual thread/thread pool dapat menyebabkan context leak bila tidak dibersihkan;
- reactive pipeline memerlukan context propagation berbeda.

Prinsip:

> Context propagation harus eksplisit dan dites, bukan diasumsikan.

---

## 8. Metrics untuk Error dan Reliability

### 8.1 Metric yang wajib ada untuk API service

Minimal:

```text
http.server.requests.count
http.server.requests.duration
http.server.errors.count
api.error.count by error_code/status/operation
api.validation.failure.count
api.conflict.count
api.dependency.failure.count
api.retry.exhausted.count
api.fallback.used.count
api.shutdown.rejected.count
```

Dimensi yang berguna:

```text
operation
endpoint
method
status_class
error_code
dependency
retryable
outcome
```

### 8.2 Metric yang wajib ada untuk dependency call

```text
dependency.requests.count
dependency.requests.duration
dependency.errors.count
dependency.timeout.count
dependency.rate_limited.count
dependency.retry.attempts.count
dependency.retry.exhausted.count
dependency.circuit.state
dependency.bulkhead.rejected.count
dependency.fallback.used.count
```

Dimensi:

```text
dependency
operation
status
error_type
attempt
final_outcome
```

### 8.3 Metric yang wajib ada untuk worker/queue

```text
worker.messages.consumed.count
worker.messages.success.count
worker.messages.failed.count
worker.messages.retried.count
worker.messages.dlq.count
worker.processing.duration
worker.active.count
worker.shutdown.inflight.count
queue.depth
queue.unacked.count
consumer.lag
```

Dimensi:

```text
worker_name
message_type
outcome
failure_class
retryable
```

### 8.4 Metric yang wajib ada untuk DB/persistence

```text
db.pool.active
db.pool.idle
db.pool.pending
db.query.duration
db.errors.count
db.deadlock.count
db.lock_timeout.count
db.constraint_violation.count
db.optimistic_lock_failure.count
transaction.rollback.count
transaction.timeout.count
transaction.unknown_outcome.count
```

### 8.5 Metric yang wajib ada untuk graceful shutdown

```text
shutdown.started.count
shutdown.duration
shutdown.phase.duration
shutdown.inflight.started
shutdown.inflight.completed
shutdown.inflight.cancelled
shutdown.requests.rejected
shutdown.worker.drained.count
shutdown.worker.force_stopped.count
shutdown.exit.code
```

Tanpa metric ini, graceful shutdown hanya asumsi.

---

## 9. Cardinality: Musuh Diam-Diam Metrics

Metric cardinality adalah jumlah kombinasi label/dimensi.

Buruk:

```text
api_errors_total{user_id="123"}
api_errors_total{application_id="APP-2026-000123"}
api_errors_total{exception_message="Timeout after 2873ms for request abc"}
```

Ini bisa meledakkan storage dan membuat query lambat/mahal.

Metric label harus low-cardinality:

```text
operation="submit_application"
error_code="DEPENDENCY_TIMEOUT"
dependency="screening-engine"
status_class="5xx"
retryable="true"
```

High-cardinality data seperti `application_id` lebih cocok di log/trace, bukan metric label.

Rule:

| Data | Cocok di metric label? |
|---|---:|
| endpoint template | Ya |
| HTTP method | Ya |
| status code/class | Ya |
| error code stabil | Ya |
| dependency name | Ya |
| user id | Tidak |
| request id | Tidak |
| stack trace | Tidak |
| exact exception message | Tidak |
| entity id | Biasanya tidak |

---

## 10. Tracing untuk Failure Analysis

Distributed tracing menunjukkan hubungan antar-unit kerja.

Contoh trace:

```text
POST /applications/{id}/submit
  ├─ validate command
  ├─ load application from DB
  ├─ acquire idempotency lock
  ├─ call screening-engine
  │   ├─ attempt 1 timeout
  │   ├─ attempt 2 timeout
  │   └─ attempt 3 success
  ├─ update application status
  ├─ insert outbox event
  └─ commit transaction
```

Tanpa trace, log hanya potongan.

### 10.1 Span naming

Span name harus stabil dan bermakna.

Baik:

```text
ApplicationService.submit
ScreeningClient.screenApplicant
ApplicationRepository.save
OutboxPublisher.enqueue
```

Buruk:

```text
doPost
call
execute
lambda$handle$0
```

### 10.2 Span attributes

Tambahkan atribut yang low/medium cardinality:

```text
operation=submit_application
aggregate_type=application
business_module=application_management
dependency=screening-engine
error_code=DEPENDENCY_TIMEOUT
retry_attempt=2
fallback_used=false
```

Entity id bisa dipakai hati-hati pada trace bila security dan storage policy mengizinkan, tetapi jangan asal.

### 10.3 Span status

OpenTelemetry semantic conventions untuk HTTP menyarankan span status error untuk 5xx dan error yang mencegah request/response selesai, serta atribut `error.type` saat instrumentation mendeteksi error. Untuk exception, OpenTelemetry memiliki semantic conventions untuk exception di logs; dokumentasi exception pada span sudah ditandai deprecated dan mengarahkan ke exception logs.

Implikasinya:

- jangan hanya rely pada stack trace;
- pastikan error classification masuk ke span/log;
- pastikan status trace mencerminkan final outcome;
- pastikan fallback/degraded outcome terlihat.

### 10.4 Trace sampling problem

Tracing sering disampling.

Masalah:

```text
Normal traffic sampled 1%.
Incident terjadi pada edge case kecil.
Trace penting tidak tersimpan.
```

Solusi:

- tail-based sampling untuk error traces;
- sample all failed requests;
- sample all retry-exhausted events;
- sample all invariant violations;
- sample high-latency traces;
- sample shutdown/draining traces;
- preserve trace id di logs walau trace tidak tersimpan.

---

## 11. Exception Observability

### 11.1 Exception harus punya semantic context

Exception class saja tidak cukup.

Buruk:

```text
java.lang.RuntimeException: failed
```

Lebih baik:

```text
ExternalDependencyTimeoutException
  dependency=screening-engine
  operation=screenApplicant
  timeout_ms=2000
  retryable=true
  attempt=3
  max_attempts=3
  final_outcome=retry_exhausted
```

### 11.2 Root cause vs user-facing error

Root cause:

```text
java.net.SocketTimeoutException
```

Domain/platform error:

```text
DEPENDENCY_TIMEOUT
```

User-facing response:

```text
The service is temporarily unavailable. Please retry later.
```

Operator-facing evidence:

```text
dependency=screening-engine
operation=screenApplicant
timeout_ms=2000
attempts=3
circuit_state=closed
trace_id=...
```

Jangan campur semuanya dalam satu message.

### 11.3 Exception grouping

Monitoring platform sering group error berdasarkan stack trace/message. Jika message mengandung ID dinamis, grouping pecah.

Buruk:

```java
throw new ApplicationException("Application APP-2026-000123 failed at step 7");
```

Lebih baik:

```java
throw new ApplicationSubmissionFailedException(
    "Application submission failed",
    ErrorCode.APPLICATION_SUBMISSION_FAILED,
    context
);
```

Dynamic detail masuk structured field, bukan exception message utama.

---

## 12. Observability untuk Retry

Retry harus terlihat sebagai proses, bukan noise.

Metric:

```text
retry.attempts.count
retry.success_after_retry.count
retry.exhausted.count
retry.skipped.non_retryable.count
retry.budget_exhausted.count
```

Log final outcome:

```json
{
  "event": "dependency_call_retry_exhausted",
  "dependency": "onemap",
  "operation": "resolve_postal_code",
  "attempts": 3,
  "last_error_code": "HTTP_429",
  "retryable": true,
  "idempotency_key": "...",
  "final_outcome": "FAILED",
  "correlation_id": "..."
}
```

Trace:

```text
call external dependency
  ├─ attempt 1 => 429
  ├─ backoff 250ms
  ├─ attempt 2 => 429
  ├─ backoff 750ms
  └─ attempt 3 => timeout
```

Yang harus dihindari:

```text
Log ERROR untuk setiap attempt, lalu final success.
```

Itu menghasilkan false alarm.

Prinsip:

- retry attempt boleh DEBUG/INFO/WARN tergantung severity;
- final exhausted harus WARN/ERROR sesuai user impact;
- successful-after-retry tetap perlu metric;
- retry storm harus terdeteksi dari metric agregat.

---

## 13. Observability untuk Circuit Breaker, Bulkhead, Rate Limiter, Time Limiter

### 13.1 Circuit breaker

Metric penting:

```text
circuitbreaker.state
circuitbreaker.calls
circuitbreaker.failure.rate
circuitbreaker.slow.call.rate
circuitbreaker.not.permitted.calls
```

Log event penting:

```json
{
  "event": "circuit_breaker_opened",
  "dependency": "payment-gateway",
  "failure_rate": 73.2,
  "slow_call_rate": 40.0,
  "window_size": 100,
  "operation": "authorize_payment"
}
```

Alert jangan hanya “circuit open”. Alert jika ada user impact atau critical dependency.

### 13.2 Bulkhead

Metric:

```text
bulkhead.available.concurrent.calls
bulkhead.rejected.calls
threadpool.bulkhead.queue.depth
threadpool.bulkhead.active.threads
```

Interpretasi:

- rejected bulkhead bisa berarti isolasi bekerja;
- tetapi kalau sustained tinggi, dependency atau capacity bermasalah.

### 13.3 Rate limiter

Metric:

```text
rate_limiter.allowed.count
rate_limiter.rejected.count
rate_limiter.wait.duration
```

Penting untuk external API dengan quota.

### 13.4 Time limiter

Metric:

```text
time_limiter.timeout.count
time_limiter.cancelled.count
operation.deadline_exceeded.count
```

Jika timeout naik tetapi dependency error rate tidak naik, mungkin dependency lambat, pool saturated, DNS lambat, atau internal queueing.

---

## 14. Observability untuk Idempotency

Idempotency tanpa observability bisa menyembunyikan duplicate request.

Metric:

```text
idempotency.new.count
idempotency.replay.same_result.count
idempotency.conflict.count
idempotency.in_progress.count
idempotency.expired.count
idempotency.store.error.count
```

Log event:

```json
{
  "event": "idempotency_replay_detected",
  "operation": "submit_application",
  "idempotency_key_hash": "sha256:...",
  "original_outcome": "SUCCESS",
  "replayed_outcome": "RETURN_CACHED_RESULT",
  "correlation_id": "..."
}
```

Jangan log raw idempotency key jika bisa dipakai replay attack. Simpan hash jika cukup.

Pertanyaan incident:

```text
Apakah duplicate submission terjadi?
Apakah client retry terlalu agresif?
Apakah conflict karena key reuse dengan payload berbeda?
Apakah idempotency store unavailable?
```

---

## 15. Observability untuk Transaction Uncertainty

Transaction uncertainty harus terlihat eksplisit.

Metric:

```text
transaction.commit.count
transaction.rollback.count
transaction.timeout.count
transaction.unknown_outcome.count
outbox.pending.count
outbox.publish.success.count
outbox.publish.failed.count
outbox.oldest.pending.age
```

Log:

```json
{
  "event": "transaction_outcome_unknown",
  "operation": "approve_case",
  "aggregate_type": "case",
  "aggregate_id": "CASE-2026-0007",
  "failure_point": "commit_response_lost",
  "reconciliation_required": true,
  "safe_to_retry": "CHECK_IDEMPOTENCY_RECORD_FIRST",
  "correlation_id": "..."
}
```

Ini jauh lebih berguna daripada:

```text
Database error occurred
```

---

## 16. Observability untuk Graceful Shutdown

Graceful shutdown harus meninggalkan evidence.

### 16.1 Shutdown lifecycle log

Minimal:

```text
shutdown_started
readiness_changed_to_refusing_traffic
draining_started
http_inflight_remaining
workers_stop_polling_started
workers_drained
timeout_budget_remaining
resources_closing_started
shutdown_completed
```

### 16.2 Shutdown metric

```text
shutdown.duration
shutdown.inflight.started
shutdown.inflight.completed
shutdown.inflight.cancelled
shutdown.new_requests.rejected
shutdown.worker.messages.completed
shutdown.worker.messages.requeued
shutdown.worker.messages.dlq
shutdown.phase.timeout.count
```

### 16.3 Shutdown incident questions

```text
Apakah pod menerima traffic setelah readiness false?
Berapa request yang masih in-flight saat SIGTERM?
Apakah ada request yang dibatalkan paksa?
Apakah worker meng-ack message sebelum selesai?
Apakah terminationGracePeriodSeconds cukup?
Apakah load balancer masih route ke pod terminating?
```

Jika tidak bisa dijawab, graceful shutdown belum operationally proven.

---

## 17. Observability untuk Queue dan Message Consumer

Message processing butuh evidence khusus.

### 17.1 Message lifecycle

```text
received
validated
deduplicated
processing_started
side_effect_started
side_effect_completed
acknowledged
nacked/requeued
dead_lettered
```

### 17.2 Log field penting

```text
message_id
message_type
correlation_id
causation_id
aggregate_type
aggregate_id
delivery_attempt
consumer_name
partition/routing_key
offset/delivery_tag
ack_decision
failure_class
```

### 17.3 Metrics

```text
message.processing.duration
message.success.count
message.failure.count
message.retry.count
message.dlq.count
message.duplicate.count
message.poison.count
consumer.lag
queue.depth
unacked.count
oldest.message.age
```

### 17.4 DLQ observability

DLQ bukan tempat sampah; DLQ adalah incident queue.

Setiap DLQ event harus punya:

- reason;
- failure class;
- original message metadata;
- retry count;
- last exception class;
- last error code;
- safe replay instruction;
- manual remediation note bila perlu.

---

## 18. Observability untuk Fallback dan Degradation

Fallback harus terlihat.

Bahaya terbesar fallback adalah false success.

Metric:

```text
fallback.used.count
fallback.stale_cache.used.count
fallback.static_response.used.count
fallback.partial_response.count
fallback.disabled.count
fallback.failed.count
```

Response/log harus membedakan:

```text
SUCCESS
SUCCESS_DEGRADED
PARTIAL_SUCCESS
FAILED_WITH_FALLBACK_UNAVAILABLE
```

Contoh log:

```json
{
  "event": "fallback_used",
  "operation": "get_dashboard_summary",
  "dependency": "analytics-service",
  "fallback_type": "stale_cache",
  "cache_age_seconds": 3600,
  "user_visible": true,
  "final_outcome": "SUCCESS_DEGRADED"
}
```

Jika fallback dipakai untuk regulatory/business-critical decision, harus ada audit/flag khusus.

---

## 19. Alerting: Dari Noise ke Actionable Signal

Alert yang buruk:

```text
ERROR log detected
CPU > 80%
One request failed
One retry happened
One dependency timeout happened
```

Alert yang baik:

```text
Checkout API burns 10% monthly error budget in 30 minutes.
Case approval p99 latency > SLO for 15 minutes and DB pool pending > 0.
Payment gateway circuit breaker open for critical operation and fallback unavailable.
DLQ for compliance events has non-zero messages for more than 5 minutes.
Outbox oldest pending event age > 10 minutes.
Shutdown force-cancelled in-flight requests during rolling deploy.
```

### 19.1 Symptom-based alerting

Google SRE menganjurkan alert berbasis symptom yang berdampak pada user, bukan hanya cause internal.

Cause signal tetap penting untuk diagnosis, tetapi page manusia sebaiknya karena impact.

| Bad page | Better page |
|---|---|
| CPU high | API latency SLO burn high and CPU saturation likely contributor |
| DB error log | Case submission failure rate above threshold due to DB timeout |
| Circuit open | Critical dependency unavailable causing user-visible failure |
| Queue depth high | Event processing delay violates freshness SLO |

### 19.2 Alert harus punya runbook

Setiap alert production harus menjawab:

```text
Apa arti alert ini?
Apa dampaknya?
Dashboard mana yang dilihat?
Query log apa yang dipakai?
Apa safe immediate action?
Apa yang tidak boleh dilakukan?
Kapan escalate?
Bagaimana verify recovery?
```

Alert tanpa runbook sering hanya memindahkan kepanikan ke on-call.

---

## 20. SLO, Error Budget, dan Error Handling

Error handling harus dipetakan ke SLO.

Contoh SLO:

```text
99.9% submit application requests complete successfully within 2 seconds over 30 days.
99.99% accepted commands are eventually reflected in audit trail within 1 minute.
99.5% external postal code resolution returns successful or safe degraded result within 1 second.
```

Error budget membantu menentukan kapan reliability lebih penting daripada feature delivery.

### 20.1 Error classification untuk SLO

Tidak semua error dihitung sama.

Contoh:

| Event | Masuk SLO error? | Catatan |
|---|---:|---|
| 400 validation error karena user input salah | Biasanya tidak | client-correctable |
| 401 unauthenticated | Biasanya tidak | tergantung flow |
| 403 unauthorized | Biasanya tidak | expected security behavior |
| 409 conflict optimistic lock | Tergantung | bisa expected concurrency |
| 429 internal overload | Ya | service tidak mampu melayani |
| 500 unexpected | Ya | server failure |
| 503 dependency unavailable | Ya | user operation gagal |
| fallback degraded | Tergantung SLO | jika kualitas turun signifikan, mungkin counted |
| async event delayed | Masuk freshness SLO | bukan HTTP availability |

### 20.2 Reliability telemetry harus align dengan SLO

Jika SLO berbasis business operation, metric juga harus business-operation aware.

Buruk:

```text
http_requests_total by URI
```

Lebih baik:

```text
business_operation_total{operation="submit_application", outcome="success"}
business_operation_total{operation="submit_application", outcome="failed"}
business_operation_duration{operation="submit_application"}
```

---

## 21. Dashboard Design

Dashboard bukan hiasan. Dashboard harus mendukung keputusan.

### 21.1 Service overview dashboard

Berisi:

- availability/error rate;
- p95/p99 latency;
- throughput;
- saturation;
- dependency health;
- DB pool;
- queue lag/depth;
- circuit breaker states;
- retry/fallback counts;
- deployment/shutdown events.

### 21.2 Dependency dashboard

Berisi per dependency:

- request rate;
- success/error rate;
- latency;
- timeout;
- 429/rate limit;
- retry attempts;
- circuit breaker state;
- bulkhead rejection;
- fallback usage.

### 21.3 Worker dashboard

Berisi:

- queue depth;
- consumer lag;
- processing rate;
- processing duration;
- success/failure;
- retry;
- DLQ;
- oldest message age;
- active workers;
- shutdown drain status.

### 21.4 Business reliability dashboard

Berisi:

- submitted applications count;
- failed submissions by reason;
- stuck application states;
- pending compensations;
- reconciliation backlog;
- audit trail missing/delayed count;
- manual review queue.

Top-tier engineer tidak berhenti di infrastructure dashboard. Mereka juga membuat dashboard yang merefleksikan state domain.

---

## 22. Anti-Patterns

### 22.1 Logging everything

Banyak log bukan berarti observability baik.

Dampak:

- noise;
- biaya tinggi;
- sulit query;
- sensitive data risk;
- alert fatigue.

### 22.2 Logging nothing at boundaries

Jika boundary eksternal gagal tetapi tidak ada structured context, root cause sulit ditemukan.

### 22.3 Error message sebagai satu-satunya classification

Buruk:

```text
message contains "timeout"
```

Baik:

```text
error_code=DEPENDENCY_TIMEOUT
error_type=timeout
dependency=screening-engine
```

### 22.4 High cardinality metric labels

Menggunakan user/entity/request id sebagai metric label dapat menghancurkan metric system.

### 22.5 Alert dari log ERROR mentah

Tidak semua ERROR butuh page. Tidak semua incident menghasilkan banyak ERROR.

### 22.6 Correlation id tidak dipropagasi ke async boundary

Ini sering membuat trace putus saat masuk queue/scheduler.

### 22.7 Stack trace hilang karena exception wrapping buruk

Jangan membuat exception baru tanpa cause:

```java
throw new ServiceException("failed"); // cause hilang
```

Lebih baik:

```java
throw new ServiceException("failed", cause);
```

### 22.8 Fallback tidak diberi metric

Fallback yang tidak terlihat sama dengan silent degradation.

### 22.9 Retry tidak diberi metric

Retry yang tidak terlihat bisa menjadi retry storm tanpa disadari.

### 22.10 Dashboard hanya infra, tidak domain

CPU/memory normal bukan berarti business process sehat.

---

## 23. Java/Spring Implementation Model

### 23.1 Error code interface

```java
public interface ErrorDescriptor {
    String code();
    String category();
    boolean retryable();
    boolean expected();
    Severity severity();
}

public enum Severity {
    INFO,
    WARN,
    ERROR,
    CRITICAL
}
```

### 23.2 Domain exception membawa descriptor

```java
public abstract class ApplicationException extends RuntimeException {
    private final ErrorDescriptor descriptor;
    private final Map<String, Object> context;

    protected ApplicationException(
            String message,
            ErrorDescriptor descriptor,
            Map<String, Object> context,
            Throwable cause
    ) {
        super(message, cause);
        this.descriptor = descriptor;
        this.context = Map.copyOf(context);
    }

    public ErrorDescriptor descriptor() {
        return descriptor;
    }

    public Map<String, Object> context() {
        return context;
    }
}
```

### 23.3 Centralized exception observer

```java
@Component
public class ExceptionTelemetryRecorder {
    private final MeterRegistry meterRegistry;

    public ExceptionTelemetryRecorder(MeterRegistry meterRegistry) {
        this.meterRegistry = meterRegistry;
    }

    public void record(ApplicationException ex, String operation) {
        ErrorDescriptor descriptor = ex.descriptor();

        meterRegistry.counter(
                "application.error.count",
                "operation", operation,
                "error_code", descriptor.code(),
                "category", descriptor.category(),
                "retryable", Boolean.toString(descriptor.retryable()),
                "expected", Boolean.toString(descriptor.expected())
        ).increment();
    }
}
```

### 23.4 ControllerAdvice logging final outcome

```java
@RestControllerAdvice
public class ApiExceptionHandler {
    private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);

    private final ExceptionTelemetryRecorder telemetry;

    public ApiExceptionHandler(ExceptionTelemetryRecorder telemetry) {
        this.telemetry = telemetry;
    }

    @ExceptionHandler(ApplicationException.class)
    ResponseEntity<ProblemDetail> handleApplicationException(
            ApplicationException ex,
            HttpServletRequest request
    ) {
        String operation = resolveOperation(request);
        telemetry.record(ex, operation);

        ErrorDescriptor descriptor = ex.descriptor();

        if (descriptor.severity() == Severity.ERROR || descriptor.severity() == Severity.CRITICAL) {
            log.error(
                    "application_error operation={} error_code={} category={} retryable={} expected={} path={}",
                    operation,
                    descriptor.code(),
                    descriptor.category(),
                    descriptor.retryable(),
                    descriptor.expected(),
                    request.getRequestURI(),
                    ex
            );
        } else {
            log.warn(
                    "application_warning operation={} error_code={} category={} retryable={} expected={} path={}",
                    operation,
                    descriptor.code(),
                    descriptor.category(),
                    descriptor.retryable(),
                    descriptor.expected(),
                    request.getRequestURI()
            );
        }

        ProblemDetail problem = ProblemDetail.forStatus(resolveStatus(descriptor));
        problem.setTitle(resolveTitle(descriptor));
        problem.setDetail(resolveSafeDetail(descriptor));
        problem.setProperty("errorCode", descriptor.code());
        problem.setProperty("correlationId", currentCorrelationId());

        return ResponseEntity.status(problem.getStatus()).body(problem);
    }
}
```

Catatan:

- expected validation/domain errors tidak selalu perlu stack trace;
- unexpected system errors perlu stack trace;
- response tidak membocorkan internal detail;
- metric tetap direkam dengan label low-cardinality.

### 23.5 Observing dependency calls

```java
public <T> T observeDependencyCall(
        String dependency,
        String operation,
        Supplier<T> supplier
) {
    Timer.Sample sample = Timer.start(meterRegistry);

    try {
        T result = supplier.get();
        meterRegistry.counter(
                "dependency.call.count",
                "dependency", dependency,
                "operation", operation,
                "outcome", "success"
        ).increment();
        return result;
    } catch (ExternalDependencyException ex) {
        meterRegistry.counter(
                "dependency.call.count",
                "dependency", dependency,
                "operation", operation,
                "outcome", "failure",
                "error_code", ex.errorCode()
        ).increment();
        throw ex;
    } finally {
        sample.stop(Timer.builder("dependency.call.duration")
                .tag("dependency", dependency)
                .tag("operation", operation)
                .register(meterRegistry));
    }
}
```

Perhatikan cardinality: `dependency` dan `operation` stabil. Jangan tag dengan request id.

---

## 24. Failure Scenario Walkthrough

### Scenario: external dependency timeout saat submit application

Flow:

```text
User submit application
  ↓
API receives request
  ↓
Validation success
  ↓
Idempotency record created
  ↓
Service calls screening-engine
  ↓
Timeout
  ↓
Retry 2 times
  ↓
Retry exhausted
  ↓
Transaction rolled back
  ↓
Response 503 returned
```

Evidence yang harus ada:

#### Log

```json
{
  "event": "dependency_retry_exhausted",
  "operation": "submit_application",
  "dependency": "screening-engine",
  "error_code": "DEPENDENCY_TIMEOUT",
  "attempts": 3,
  "timeout_ms": 2000,
  "final_outcome": "FAILED",
  "safe_to_retry": true,
  "correlation_id": "...",
  "trace_id": "..."
}
```

#### Metric

```text
business_operation_total{operation="submit_application",outcome="failed",error_code="DEPENDENCY_TIMEOUT"} +1
dependency_timeout_total{dependency="screening-engine",operation="screen_applicant"} +1
retry_exhausted_total{dependency="screening-engine"} +1
```

#### Trace

```text
POST /applications/{id}/submit
  ├─ validate
  ├─ idempotency.create
  ├─ screening-engine.call attempt=1 timeout
  ├─ screening-engine.call attempt=2 timeout
  ├─ screening-engine.call attempt=3 timeout
  └─ response 503
```

#### Alert

Tidak perlu alert untuk satu request.

Alert jika:

```text
submit_application error budget burn high
or
screening-engine timeout rate > threshold
or
retry exhausted sustained for critical operation
```

---

## 25. Production Checklist

### 25.1 Logs

- [ ] Semua boundary error memiliki structured log.
- [ ] Log field naming konsisten.
- [ ] Correlation id ada di semua log request.
- [ ] Trace id/span id masuk log bila tracing aktif.
- [ ] Stack trace hanya untuk unexpected/system error.
- [ ] Expected client/domain error tidak membanjiri ERROR log.
- [ ] Sensitive data tidak muncul di log.
- [ ] Exception cause chain tidak hilang.
- [ ] Retry/fallback/shutdown/DLQ punya event log.

### 25.2 Metrics

- [ ] API latency punya percentile.
- [ ] Error rate diklasifikasikan by operation/error code.
- [ ] Dependency latency/error/timeout/retry tersedia.
- [ ] Circuit breaker/bulkhead/rate limiter metric tersedia.
- [ ] DB pool dan transaction failure metric tersedia.
- [ ] Worker queue depth/lag/DLQ metric tersedia.
- [ ] Shutdown drain metric tersedia.
- [ ] Metric labels low-cardinality.
- [ ] Business operation metrics tersedia.

### 25.3 Traces

- [ ] Trace propagation lintas service berjalan.
- [ ] Async/message propagation tersedia.
- [ ] Dependency call terlihat sebagai span.
- [ ] Retry attempt terlihat atau setidaknya final retry context tersedia.
- [ ] Error span status benar.
- [ ] Tail/error sampling dipertimbangkan.

### 25.4 Alerts

- [ ] Alert berbasis symptom/user impact.
- [ ] Alert punya severity.
- [ ] Alert punya runbook.
- [ ] Alert tidak hanya dari raw ERROR log.
- [ ] Alert menghindari noise dari expected error.
- [ ] SLO burn alert tersedia untuk operasi kritikal.

### 25.5 Domain/Regulatory

- [ ] Audit trail berbeda dari technical log.
- [ ] State transition penting terekam.
- [ ] Manual override terekam.
- [ ] Compensation/reconciliation backlog terlihat.
- [ ] Data integrity risk menghasilkan signal khusus.

---

## 26. Review Questions

1. Apa perbedaan log, metric, trace, audit trail, dan alert?
2. Kenapa log banyak tidak berarti observability baik?
3. Apa itu golden signals?
4. Kenapa average latency berbahaya?
5. Field apa yang wajib ada pada structured error log?
6. Kenapa request id, trace id, correlation id, dan idempotency key tidak sama?
7. Kenapa MDC bisa bermasalah pada async execution?
8. Apa itu metric cardinality dan kenapa berbahaya?
9. Error apa yang seharusnya tidak masuk ERROR log?
10. Bagaimana retry storm dideteksi lewat metric?
11. Kenapa fallback harus punya metric?
12. Apa metric penting untuk graceful shutdown?
13. Kenapa DLQ harus diperlakukan sebagai incident queue?
14. Apa beda symptom alert dan cause alert?
15. Bagaimana SLO mengubah cara kita mengklasifikasikan error?

---

## 27. Key Takeaways

1. Observability adalah evidence system, bukan sekadar dashboard.
2. Error handling yang baik harus menghasilkan log, metric, trace, dan audit evidence yang benar.
3. Log menjawab apa yang terjadi; metric menjawab seberapa banyak/parah; trace menjawab di mana flow melambat/gagal; audit trail menjawab dampak bisnis/regulatory.
4. Correlation id, trace id, request id, idempotency key, dan aggregate id punya fungsi berbeda.
5. Structured logging lebih kuat daripada message string bebas.
6. Metric harus low-cardinality dan aligned dengan business operation.
7. Retry, fallback, circuit breaker, idempotency, transaction uncertainty, queue failure, dan shutdown semua harus observable.
8. Alert harus actionable dan sebaiknya berbasis user impact/SLO, bukan raw noise.
9. Observability yang matang membuat incident response lebih cepat, postmortem lebih akurat, dan reliability design lebih defensible.

---

## 28. Status Seri

```text
Part 023 / 030 completed
Seri belum selesai.
```

Bagian berikutnya:

```text
Part 024 — Incident-Oriented Error Handling
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-reliability-part-022.md](./learn-java-reliability-part-022.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-reliability-part-024.md](./learn-java-reliability-part-024.md)

</div>