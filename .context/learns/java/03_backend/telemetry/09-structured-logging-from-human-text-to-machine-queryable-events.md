# Part 9 — Structured Logging: From Human Text to Machine-Queryable Events

> Series: `learn-java-logging-observability-profiling-troubleshooting-engineering`  
> Scope: Java 8 sampai Java 25  
> Fokus: Structured logging sebagai fondasi runtime evidence yang bisa di-query, dikorelasikan, diamankan, dan dipakai untuk troubleshooting sistem produksi.

---

## 0. Posisi Part Ini dalam Series

Pada part sebelumnya kita sudah membahas:

1. logging sebagai bagian dari runtime evidence,
2. arsitektur logging Java,
3. semantik log,
4. SLF4J sebagai facade,
5. Logback production configuration,
6. Logback advanced: async, MDC, sifting, filtering, JSON,
7. Log4j2 architecture,
8. Log4j2 async, garbage-free, routing, security.

Part ini naik satu level: bukan lagi framework-specific, tetapi **desain data log**.

Framework logging hanya menjawab:

- bagaimana event dikirim,
- ke mana event ditulis,
- format output apa yang dipakai,
- apakah sinkron atau asinkron,
- bagaimana filtering/routing dilakukan.

Structured logging menjawab pertanyaan yang lebih fundamental:

> Kalau sistem sedang bermasalah, apakah log kita bisa langsung dipakai sebagai data investigasi?

Jika jawabannya tidak, berarti log hanya “teks”, bukan “evidence”.

---

## 1. Core Mental Model

Structured logging adalah praktik menulis log sebagai **event dengan field eksplisit**, bukan hanya string bebas.

Contoh log tradisional:

```text
2026-06-18 10:15:23 ERROR Failed to submit case for user 12345 because timeout
```

Log tersebut bisa dibaca manusia, tetapi sulit diproses mesin secara konsisten.

Versi structured:

```json
{
  "@timestamp": "2026-06-18T10:15:23.481Z",
  "log.level": "ERROR",
  "service.name": "case-service",
  "deployment.environment": "prod",
  "event.name": "case.submission.failed",
  "event.category": "workflow",
  "event.outcome": "failure",
  "trace.id": "0af7651916cd43dd8448eb211c80319c",
  "span.id": "b7ad6b7169203331",
  "correlation.id": "REQ-20260618-000918",
  "case.id": "CASE-928173",
  "user.id_hash": "sha256:...",
  "error.type": "java.net.SocketTimeoutException",
  "error.code": "DOWNSTREAM_TIMEOUT",
  "dependency.name": "document-service",
  "duration.ms": 3000,
  "message": "Case submission failed because document-service timed out"
}
```

Perbedaannya bukan hanya format JSON. Perbedaannya adalah **struktur berpikir**.

Structured logging berarti setiap log event memiliki:

1. identity,
2. context,
3. classification,
4. outcome,
5. causality hint,
6. correlation pointer,
7. safe payload,
8. queryable attributes.

---

## 2. Kenapa Structured Logging Penting

Di sistem kecil, log teks masih bisa cukup. Engineer bisa membuka file log, `grep`, lalu membaca urutan event.

Di sistem produksi modern, pendekatan itu cepat gagal karena:

1. service banyak,
2. instance banyak,
3. request paralel,
4. traffic tinggi,
5. log tersebar di container/pod/node,
6. event async tidak berada dalam satu thread,
7. retry dan timeout membuat timeline bercabang,
8. user, tenant, case, job, dan message saling berpotongan,
9. incident harus dianalisis dalam menit, bukan jam,
10. audit/security/compliance butuh bukti yang konsisten.

Structured logging membuat log bisa diperlakukan seperti dataset.

Dengan structured logs, kita bisa bertanya:

```text
Tampilkan semua event case.submission.failed di prod dalam 15 menit terakhir,
group by dependency.name dan error.code.
```

Atau:

```text
Cari semua WARN/ERROR untuk correlation.id = X, urutkan berdasarkan timestamp.
```

Atau:

```text
Hitung jumlah failure per tenant.id_hash untuk endpoint /api/cases/submit.
```

Atau:

```text
Ambil semua event dengan trace.id tertentu, lalu link ke distributed trace.
```

Log tradisional bisa menjawab ini hanya jika kita beruntung. Structured logs menjawabnya secara sengaja.

---

## 3. Structured Logging Bukan Sekadar JSON

Kesalahan umum:

> “Kami sudah pakai JSON logging, berarti sudah structured logging.”

Belum tentu.

Contoh JSON yang buruk:

```json
{
  "time": "2026-06-18 10:15:23",
  "level": "ERROR",
  "msg": "Failed to process request user=123 case=888 timeout after retry"
}
```

Ini hanya text logging yang dibungkus JSON.

Structured logging yang benar memecah informasi penting menjadi field:

```json
{
  "@timestamp": "2026-06-18T10:15:23.481Z",
  "log.level": "ERROR",
  "event.name": "request.processing.failed",
  "event.outcome": "failure",
  "user.id_hash": "sha256:...",
  "case.id": "888",
  "error.code": "TIMEOUT_AFTER_RETRY",
  "retry.count": 3,
  "message": "Request processing failed after retry timeout"
}
```

JSON adalah serialization format. Structured logging adalah **event modeling discipline**.

---

## 4. Log Event sebagai Record

Bayangkan setiap log event sebagai record database.

Jika log adalah record, maka kita harus mendesain schema:

| Aspek | Pertanyaan |
|---|---|
| Identity | Event ini apa? |
| Time | Kapan terjadi? |
| Origin | Service mana yang menghasilkan? |
| Context | Request/job/case/message apa? |
| Classification | Ini lifecycle, business, security, dependency, atau failure? |
| Outcome | Success, failure, unknown, denied? |
| Causality | Disebabkan oleh apa atau bergantung pada apa? |
| Correlation | Terhubung ke trace/span/correlation id apa? |
| Impact | Siapa/apa yang terdampak? |
| Actionability | Apa yang bisa dilakukan setelah melihat event ini? |

Top-tier engineer tidak menulis log seperti catatan acak. Mereka mendesain log seperti **operational data model**.

---

## 5. Minimal Structured Log Schema

Minimal schema untuk Java service produksi:

```json
{
  "@timestamp": "2026-06-18T10:15:23.481Z",
  "log.level": "INFO",
  "message": "Case submitted successfully",
  "service.name": "case-service",
  "service.version": "1.42.0",
  "deployment.environment": "prod",
  "logger.name": "com.acme.case.SubmitCaseService",
  "thread.name": "http-nio-8080-exec-12",
  "event.name": "case.submitted",
  "event.category": "workflow",
  "event.type": "state_change",
  "event.outcome": "success",
  "trace.id": "0af7651916cd43dd8448eb211c80319c",
  "span.id": "b7ad6b7169203331",
  "correlation.id": "REQ-20260618-000918"
}
```

Field minimal yang sebaiknya selalu ada:

1. `@timestamp`
2. `log.level`
3. `message`
4. `service.name`
5. `service.version`
6. `deployment.environment`
7. `logger.name`
8. `thread.name`
9. `event.name`
10. `event.category`
11. `event.outcome`
12. `trace.id`
13. `span.id`
14. `correlation.id`

Tidak semua field selalu mungkin ada. Misalnya background scheduler mungkin tidak punya HTTP request id. Tetapi schema tetap harus stabil.

---

## 6. Field Naming Strategy

Structured logs membutuhkan naming convention.

Ada tiga pendekatan umum:

1. memakai schema standar seperti ECS,
2. memakai OpenTelemetry semantic conventions,
3. memakai schema internal sendiri yang kompatibel dengan keduanya.

Rekomendasi realistis untuk enterprise Java:

> Gunakan field standar untuk konsep umum, lalu field domain-specific untuk konsep bisnis.

Contoh field umum:

```text
service.name
service.version
deployment.environment
log.level
logger.name
thread.name
trace.id
span.id
error.type
error.message
error.stack_trace
http.request.method
url.path
server.address
client.address
```

Contoh field domain-specific:

```text
case.id
case.status
application.id
application.type
agency.id_hash
tenant.id
workflow.name
workflow.state_from
workflow.state_to
approval.level
appeal.id
inspection.id
```

Jangan mencampur semua field domain ke dalam `message`.

Buruk:

```json
{
  "message": "Case CASE-123 moved from DRAFT to SUBMITTED by user U-918"
}
```

Baik:

```json
{
  "event.name": "case.state.changed",
  "event.type": "state_change",
  "case.id": "CASE-123",
  "case.status.from": "DRAFT",
  "case.status.to": "SUBMITTED",
  "actor.id_hash": "sha256:...",
  "message": "Case state changed from DRAFT to SUBMITTED"
}
```

---

## 7. Dot Notation vs Snake Case vs Camel Case

Untuk log fields, dot notation sering dipakai oleh ECS dan OpenTelemetry-style attributes.

Contoh:

```text
service.name
service.version
http.request.method
db.system
error.type
trace.id
```

Keunggulan:

1. terlihat hierarchical,
2. familiar di observability tools,
3. mudah disejajarkan dengan semantic conventions,
4. memisahkan namespace.

Namun, beberapa storage/query engine memperlakukan dot sebagai nested object, sementara lainnya memperlakukan sebagai flat key.

Pilih salah satu strategi dan konsisten.

Dua opsi valid:

### Opsi A — Flat dotted fields

```json
{
  "service.name": "case-service",
  "http.request.method": "POST",
  "event.name": "case.submitted"
}
```

### Opsi B — Nested JSON object

```json
{
  "service": {
    "name": "case-service"
  },
  "http": {
    "request": {
      "method": "POST"
    }
  },
  "event": {
    "name": "case.submitted"
  }
}
```

Opsi A lebih sederhana untuk logger key-value. Opsi B lebih natural sebagai JSON object, tetapi bisa lebih berat dan kadang lebih sulit dikontrol di mapping/index.

Untuk Java service yang memakai SLF4J key-value, Logback encoder, atau Log4j2 JSON Template Layout, opsi A sering lebih praktis.

---

## 8. Timestamp Design

Timestamp harus jelas, presisi, dan timezone-safe.

Rekomendasi:

```json
{
  "@timestamp": "2026-06-18T10:15:23.481Z"
}
```

Gunakan:

1. ISO-8601/RFC3339-style timestamp,
2. UTC (`Z`) untuk machine processing,
3. millisecond atau nanosecond precision sesuai pipeline,
4. satu field timestamp utama.

Hindari:

```text
18/06/2026 17:15:23
Thu Jun 18 17:15:23 WIB 2026
2026-06-18 17:15:23
```

Kenapa?

1. timezone ambigu,
2. parsing berbeda antar tool,
3. sorting bisa salah,
4. korelasi lintas service sulit.

Jika perlu local time untuk human debugging, jadikan field tambahan, bukan field utama.

```json
{
  "@timestamp": "2026-06-18T10:15:23.481Z",
  "local.time": "2026-06-18T17:15:23.481+07:00"
}
```

Namun biasanya cukup UTC di log dan timezone conversion dilakukan di observability UI.

---

## 9. Severity Design

Severity minimum:

```text
TRACE
DEBUG
INFO
WARN
ERROR
```

Dalam structured log, simpan severity sebagai field:

```json
{
  "log.level": "ERROR"
}
```

Jangan hanya mengandalkan teks di message.

Severity harus memiliki makna operasional:

| Level | Makna |
|---|---|
| TRACE | detail sangat rendah, biasanya untuk local/deep debug |
| DEBUG | informasi diagnosis yang bisa diaktifkan sementara |
| INFO | lifecycle/business/operational event normal yang penting |
| WARN | abnormal tetapi masih bisa dilanjutkan atau sudah dimitigasi |
| ERROR | kegagalan yang menyebabkan operasi gagal atau butuh perhatian |

Severity bukan ukuran emosi. Severity adalah sinyal prioritas operasional.

Contoh buruk:

```json
{
  "log.level": "ERROR",
  "event.name": "login.failed",
  "event.outcome": "failure",
  "reason": "INVALID_PASSWORD"
}
```

Login gagal karena password salah adalah expected security/business event. Biasanya `INFO` atau `WARN` tergantung konteks dan risk policy, bukan otomatis `ERROR`.

Contoh lebih baik:

```json
{
  "log.level": "INFO",
  "event.name": "authentication.failed",
  "event.category": "security",
  "event.outcome": "failure",
  "auth.failure.reason": "INVALID_CREDENTIALS",
  "actor.id_hash": "sha256:...",
  "source.ip_hash": "sha256:...",
  "message": "Authentication failed due to invalid credentials"
}
```

Jika ada brute force pattern, alerting bisa berdasarkan aggregation, bukan satu event langsung `ERROR`.

---

## 10. `message` Tetap Penting

Structured logging tidak berarti menghapus message.

`message` tetap penting untuk:

1. human readability,
2. fallback display di log UI,
3. cepat memahami event tanpa membuka semua fields,
4. compatibility dengan legacy pipeline.

Namun `message` tidak boleh menjadi satu-satunya tempat menyimpan informasi penting.

Baik:

```json
{
  "event.name": "payment.authorization.failed",
  "payment.id": "PAY-001",
  "error.code": "CARD_DECLINED",
  "message": "Payment authorization failed because card was declined"
}
```

Buruk:

```json
{
  "message": "Payment PAY-001 authorization failed because card was declined"
}
```

Rule:

> Message is for humans. Fields are for machines.

---

## 11. Event Name Design

`event.name` adalah salah satu field paling penting.

Ia harus stabil, queryable, dan tidak mengandung nilai dinamis.

Baik:

```text
case.submitted
case.state.changed
payment.authorization.failed
user.login.succeeded
dependency.call.failed
batch.chunk.completed
message.consumed
idempotency.duplicate.detected
```

Buruk:

```text
case.CASE-123.submitted
user.fajar.logged.in
payment.failed.INSUFFICIENT_BALANCE.92817
```

Kenapa buruk?

Karena event name menjadi high-cardinality dan sulit di-group.

Gunakan pola:

```text
<domain>.<entity_or_operation>.<verb_or_outcome>
```

Contoh:

```text
case.application.submitted
case.application.approved
case.application.rejected
case.assignment.changed
case.escalation.triggered
case.deadline.breached
external.onemap.lookup.failed
batch.archival.chunk.completed
security.authorization.denied
```

Event name harus seperti enum, bukan string bebas.

---

## 12. Event Category, Type, Action, Outcome

Selain `event.name`, gunakan field klasifikasi.

Contoh:

```json
{
  "event.name": "case.state.changed",
  "event.category": "workflow",
  "event.type": "state_change",
  "event.action": "submit",
  "event.outcome": "success"
}
```

Rekomendasi kategori internal:

| Category | Contoh |
|---|---|
| `lifecycle` | service started, config loaded, shutdown |
| `request` | HTTP request received/completed |
| `dependency` | external HTTP, DB, queue, cache call |
| `workflow` | state transition, approval, escalation |
| `security` | authentication, authorization, suspicious activity |
| `audit` | regulated business action |
| `data` | import/export/migration/archive |
| `scheduler` | scheduled task started/completed |
| `batch` | job/chunk/step event |
| `messaging` | produce/consume/ack/retry/DLQ |
| `performance` | slow operation, threshold breached |
| `error` | unexpected failure |

`event.outcome` sebaiknya terbatas:

```text
success
failure
denied
partial
unknown
skipped
retrying
timeout
```

Jangan buat outcome terlalu banyak.

Buruk:

```text
successfully_submitted_with_minor_warning
failed_because_timeout_after_retry_3
```

Gunakan field tambahan:

```json
{
  "event.outcome": "failure",
  "error.code": "TIMEOUT_AFTER_RETRY",
  "retry.count": 3
}
```

---

## 13. Context Fields

Context adalah hal yang menjawab:

> Event ini terjadi dalam flow apa?

Context umum:

```text
trace.id
span.id
correlation.id
request.id
session.id
user.id_hash
tenant.id
service.name
service.instance.id
deployment.environment
```

Context domain:

```text
case.id
application.id
appeal.id
inspection.id
workflow.id
job.execution.id
message.id
transaction.id
```

Context dependency:

```text
dependency.name
dependency.type
dependency.endpoint
dependency.operation
http.request.method
url.path
db.system
db.operation
messaging.system
messaging.destination.name
```

Context harus konsisten di seluruh event dalam flow yang sama.

Jika `case.id` ada di event submit, maka event validation, approval, document upload, notification, dan audit yang terkait sebaiknya memakai field name yang sama: `case.id`.

Jangan berubah-ubah:

```text
caseId
case_id
case.id
caseNo
case_number
```

Pilih satu.

---

## 14. Correlation Fields

Structured logging menjadi sangat kuat ketika dikombinasikan dengan correlation.

Field penting:

| Field | Fungsi |
|---|---|
| `trace.id` | menghubungkan log ke distributed trace |
| `span.id` | menghubungkan log ke operation spesifik dalam trace |
| `correlation.id` | business/request-level correlation lintas sistem |
| `request.id` | HTTP request identity lokal/gateway |
| `message.id` | identity message event |
| `job.execution.id` | identity batch/scheduler execution |
| `idempotency.key_hash` | identity duplicate-safe operation |

Perbedaan penting:

- `trace.id` biasanya observability-generated dan mengikuti W3C Trace Context.
- `correlation.id` sering business/system generated dan bisa melewati sistem yang belum fully instrumented.
- `request.id` biasanya hanya berlaku untuk satu HTTP request.
- `message.id` berlaku untuk satu message.
- `job.execution.id` berlaku untuk satu execution run.

Jangan menganggap semuanya sama.

Contoh HTTP request:

```json
{
  "event.name": "http.request.completed",
  "trace.id": "0af7651916cd43dd8448eb211c80319c",
  "span.id": "b7ad6b7169203331",
  "correlation.id": "REQ-20260618-000918",
  "request.id": "gw-abc-123",
  "http.request.method": "POST",
  "url.path": "/api/cases/submit"
}
```

Contoh messaging:

```json
{
  "event.name": "message.consumed",
  "trace.id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "correlation.id": "CASE-SUBMISSION-928173",
  "message.id": "rabbit-172839",
  "messaging.system": "rabbitmq",
  "messaging.destination.name": "case.submitted.queue"
}
```

---

## 15. Error Fields

Error harus dipecah menjadi field yang queryable.

Minimal:

```json
{
  "error.type": "java.net.SocketTimeoutException",
  "error.message": "Read timed out",
  "error.code": "DOCUMENT_SERVICE_TIMEOUT",
  "error.stack_trace": "..."
}
```

Untuk enterprise system, tambahkan:

```json
{
  "error.category": "dependency_timeout",
  "error.retryable": true,
  "error.expected": false,
  "error.owner": "document-service-team"
}
```

Namun hati-hati: `error.message` sering mengandung data dinamis atau sensitif.

Contoh buruk:

```json
{
  "error.message": "Invalid token eyJhbGciOiJIUzI1NiIsInR5cCI6..."
}
```

Contoh baik:

```json
{
  "error.type": "com.acme.security.InvalidTokenException",
  "error.code": "INVALID_TOKEN",
  "error.message": "Token validation failed",
  "token.present": true
}
```

Rule:

> Error message boleh membantu manusia, tetapi error code harus membantu mesin.

---

## 16. Stack Trace Representation

Stack trace dibutuhkan untuk unexpected failure, tetapi mahal dan berisiko noisy.

Structured log dapat menyimpan stack trace sebagai string:

```json
{
  "error.stack_trace": "java.lang.IllegalStateException: ...\n\tat ..."
}
```

Atau sebagai array frame, meski lebih berat:

```json
{
  "error.stack_trace.frames": [
    {
      "class": "com.acme.case.SubmitCaseService",
      "method": "submit",
      "line": 88
    }
  ]
}
```

Untuk kebanyakan Java service, string stack trace cukup.

Prinsip penting:

1. log stack trace sekali pada boundary yang tepat,
2. jangan log stack trace di setiap layer,
3. jangan kehilangan `cause`,
4. jangan mengubah exception menjadi string terlalu awal,
5. jangan menaruh stack trace di `message`.

Contoh SLF4J benar:

```java
log.error("Case submission failed", exception);
```

Contoh SLF4J structured lebih baik:

```java
log.atError()
    .setMessage("Case submission failed")
    .addKeyValue("event.name", "case.submission.failed")
    .addKeyValue("event.outcome", "failure")
    .addKeyValue("case.id", caseId)
    .addKeyValue("error.code", "CASE_SUBMISSION_FAILED")
    .setCause(exception)
    .log();
```

---

## 17. HTTP Structured Logging

HTTP log event minimal:

```json
{
  "event.name": "http.request.completed",
  "event.category": "request",
  "event.outcome": "success",
  "http.request.method": "POST",
  "url.path": "/api/cases/submit",
  "http.response.status_code": 200,
  "duration.ms": 124,
  "client.address_hash": "sha256:...",
  "user_agent.original_hash": "sha256:...",
  "trace.id": "...",
  "correlation.id": "..."
}
```

Jangan log full URL dengan query string jika query string bisa mengandung PII/token.

Buruk:

```json
{
  "url.full": "/api/reset-password?token=abc123&email=user@example.com"
}
```

Lebih aman:

```json
{
  "url.path": "/api/reset-password",
  "url.query.present": true,
  "url.query.redacted": true
}
```

HTTP request body logging harus default off.

Kalau harus ada untuk DEV/UAT troubleshooting:

1. sampling,
2. size limit,
3. redaction,
4. environment gating,
5. endpoint allowlist,
6. automatic secret masking,
7. no production by default.

---

## 18. Dependency Call Logging

Dependency logging menjawab:

1. service kita memanggil apa,
2. operasi apa,
3. berapa lama,
4. berhasil atau gagal,
5. status/error apa,
6. retry ke berapa,
7. timeout mana yang terjadi.

Contoh:

```json
{
  "event.name": "dependency.http.call.completed",
  "event.category": "dependency",
  "event.outcome": "failure",
  "dependency.name": "onemap-api",
  "dependency.type": "http",
  "http.request.method": "GET",
  "url.path": "/api/common/elastic/search",
  "http.response.status_code": 429,
  "duration.ms": 211,
  "retry.count": 2,
  "rate_limit.hit": true,
  "error.code": "DEPENDENCY_RATE_LIMITED",
  "message": "OneMap API call failed because rate limit was reached"
}
```

Untuk dependency, hindari high-cardinality field seperti full URL dengan ID dinamis.

Buruk:

```json
{
  "dependency.endpoint": "https://api.example.com/cases/CASE-123/documents/DOC-999"
}
```

Lebih baik:

```json
{
  "dependency.endpoint_template": "/cases/{caseId}/documents/{documentId}",
  "case.id": "CASE-123",
  "document.id": "DOC-999"
}
```

Namun hati-hati memasukkan `document.id` jika cardinality tinggi dan di-index.

---

## 19. Database Structured Logging

Database logs harus membantu menjawab:

1. query mana yang lambat,
2. pool mana yang exhausted,
3. transaction mana yang lama,
4. lock wait/deadlock terjadi di mana,
5. berapa connection acquire time,
6. apakah error berasal dari DB atau aplikasi.

Contoh connection pool event:

```json
{
  "event.name": "db.connection.acquire.failed",
  "event.category": "dependency",
  "event.outcome": "failure",
  "db.system": "oracle",
  "db.pool.name": "case-hikari-pool",
  "db.connection.acquire.timeout.ms": 30000,
  "db.pool.active": 50,
  "db.pool.idle": 0,
  "db.pool.pending": 37,
  "error.code": "DB_POOL_EXHAUSTED",
  "message": "Database connection acquisition failed because Hikari pool was exhausted"
}
```

Contoh slow query event:

```json
{
  "event.name": "db.query.slow",
  "event.category": "dependency",
  "event.outcome": "success",
  "db.system": "oracle",
  "db.operation": "SELECT",
  "db.statement.fingerprint": "SELECT * FROM CASE WHERE STATUS = ? AND CREATED_DATE > ?",
  "duration.ms": 4120,
  "threshold.ms": 1000,
  "message": "Slow database query detected"
}
```

Jangan log raw SQL yang berisi parameter sensitif.

Buruk:

```json
{
  "db.statement": "SELECT * FROM USER WHERE NRIC = 'S1234567A'"
}
```

Lebih baik:

```json
{
  "db.statement.fingerprint": "SELECT * FROM USER WHERE NRIC = ?",
  "db.operation": "SELECT"
}
```

---

## 20. Messaging Structured Logging

Messaging sulit karena flow tidak linear.

Field penting:

```text
messaging.system
messaging.destination.name
messaging.operation
message.id
message.correlation.id
message.retry.count
message.delivery.attempt
message.partition
message.offset
message.routing_key
message.dlq.reason
```

Contoh consume success:

```json
{
  "event.name": "message.consumed",
  "event.category": "messaging",
  "event.outcome": "success",
  "messaging.system": "rabbitmq",
  "messaging.destination.name": "case.submitted.queue",
  "messaging.operation": "consume",
  "message.id": "msg-928173",
  "correlation.id": "CASE-SUBMISSION-928173",
  "duration.ms": 84,
  "message": "Message consumed successfully"
}
```

Contoh DLQ:

```json
{
  "event.name": "message.dead_lettered",
  "event.category": "messaging",
  "event.outcome": "failure",
  "messaging.system": "rabbitmq",
  "messaging.destination.name": "case.submitted.queue",
  "messaging.dead_letter.destination.name": "case.submitted.dlq",
  "message.id": "msg-928173",
  "message.delivery.attempt": 5,
  "error.code": "POISON_MESSAGE",
  "message": "Message moved to dead-letter queue after max delivery attempts"
}
```

Jangan log full message payload default. Log metadata dan domain identifiers yang aman.

---

## 21. Batch and Scheduler Structured Logging

Batch/scheduler butuh identity berbeda dari HTTP.

Field penting:

```text
job.name
job.execution.id
job.instance.id
job.step.name
job.chunk.index
job.chunk.size
scheduler.name
scheduler.fire.time
scheduler.scheduled.time
scheduler.drift.ms
records.read
records.processed
records.failed
records.skipped
```

Contoh job started:

```json
{
  "event.name": "batch.job.started",
  "event.category": "batch",
  "event.outcome": "unknown",
  "job.name": "case-archival-job",
  "job.execution.id": "job-20260618-001",
  "trigger.type": "scheduler",
  "message": "Case archival job started"
}
```

Contoh chunk completed:

```json
{
  "event.name": "batch.chunk.completed",
  "event.category": "batch",
  "event.outcome": "success",
  "job.name": "case-archival-job",
  "job.execution.id": "job-20260618-001",
  "job.step.name": "export-closed-cases",
  "job.chunk.index": 12,
  "records.read": 1000,
  "records.processed": 998,
  "records.failed": 2,
  "duration.ms": 841,
  "message": "Batch chunk completed"
}
```

Contoh scheduler drift:

```json
{
  "event.name": "scheduler.execution.delayed",
  "event.category": "scheduler",
  "event.outcome": "success",
  "scheduler.name": "daily-reconciliation",
  "scheduler.scheduled.time": "2026-06-18T17:00:00Z",
  "scheduler.fire.time": "2026-06-18T17:04:12Z",
  "scheduler.drift.ms": 252000,
  "message": "Scheduled execution started later than expected"
}
```

---

## 22. Workflow and State Machine Logging

Untuk sistem case management/regulatory workflow, state transition logging sangat penting.

Field penting:

```text
workflow.name
workflow.instance.id
workflow.state.from
workflow.state.to
workflow.transition
workflow.guard.result
workflow.actor.role
case.id
case.type
case.priority
```

Contoh:

```json
{
  "event.name": "workflow.state.changed",
  "event.category": "workflow",
  "event.type": "state_change",
  "event.outcome": "success",
  "workflow.name": "enforcement-case-lifecycle",
  "workflow.instance.id": "WF-928173",
  "workflow.state.from": "UNDER_REVIEW",
  "workflow.state.to": "PENDING_APPROVAL",
  "workflow.transition": "submit_for_approval",
  "case.id": "CASE-928173",
  "actor.role": "officer",
  "message": "Workflow state changed from UNDER_REVIEW to PENDING_APPROVAL"
}
```

State transition log harus membedakan:

1. transition requested,
2. guard evaluated,
3. transition succeeded,
4. transition failed,
5. side effect emitted.

Contoh guard failed:

```json
{
  "event.name": "workflow.transition.denied",
  "event.category": "workflow",
  "event.outcome": "denied",
  "workflow.name": "enforcement-case-lifecycle",
  "workflow.state.current": "DRAFT",
  "workflow.transition": "submit_for_approval",
  "workflow.guard.name": "required_documents_present",
  "workflow.guard.result": "failed",
  "case.id": "CASE-928173",
  "reason.code": "MISSING_REQUIRED_DOCUMENTS",
  "message": "Workflow transition denied because required documents are missing"
}
```

Ini jauh lebih berguna daripada:

```text
Cannot submit case
```

---

## 23. Security Structured Logging

Security logs harus queryable dan aman.

Field umum:

```text
event.category = security
event.action
event.outcome
actor.id_hash
actor.type
actor.role
source.ip_hash
source.geo.country_iso_code
user_agent.original_hash
auth.method
auth.failure.reason
authorization.resource
authorization.action
authorization.decision
risk.score
```

Contoh authentication success:

```json
{
  "event.name": "authentication.succeeded",
  "event.category": "security",
  "event.action": "login",
  "event.outcome": "success",
  "actor.id_hash": "sha256:...",
  "auth.method": "oidc",
  "identity.provider": "singpass",
  "source.ip_hash": "sha256:...",
  "message": "User authentication succeeded"
}
```

Contoh authorization denied:

```json
{
  "event.name": "authorization.denied",
  "event.category": "security",
  "event.action": "view_case",
  "event.outcome": "denied",
  "actor.id_hash": "sha256:...",
  "actor.role": "officer",
  "authorization.resource": "case",
  "authorization.resource.id": "CASE-928173",
  "authorization.decision": "deny",
  "reason.code": "INSUFFICIENT_ROLE",
  "message": "Authorization denied because actor role is insufficient"
}
```

Security logging harus menghindari:

1. password,
2. token,
3. session secret,
4. full authorization header,
5. raw OTP,
6. raw NRIC/NIK/passport,
7. raw personal address,
8. raw email/phone kecuali policy mengizinkan dan dilindungi.

Untuk identifier sensitif, gunakan hash stabil jika perlu correlation:

```json
{
  "actor.id_hash": "sha256:normalized-user-id-with-secret-salt"
}
```

Hash tanpa salt bisa rentan dictionary attack untuk identifier yang mudah ditebak.

---

## 24. Audit Log vs Application Structured Log

Jangan campur audit log dan diagnostic log tanpa desain.

Application log bertujuan:

1. debugging,
2. troubleshooting,
3. operational monitoring,
4. incident timeline.

Audit log bertujuan:

1. membuktikan siapa melakukan apa,
2. kapan dilakukan,
3. terhadap objek apa,
4. sebelum/sesudah apa,
5. melalui channel apa,
6. apakah berhasil atau gagal,
7. apakah event tidak bisa dimanipulasi.

Audit log sering butuh:

```text
audit.event.id
audit.event.version
audit.actor.id
audit.actor.type
audit.action
audit.resource.type
audit.resource.id
audit.before_hash
audit.after_hash
audit.outcome
audit.reason
audit.channel
audit.ip_hash
audit.user_agent_hash
audit.integrity_hash
```

Audit log harus lebih stabil dari application log. Jangan ubah schema audit sembarangan.

Contoh audit event:

```json
{
  "event.name": "audit.case.approved",
  "event.category": "audit",
  "event.outcome": "success",
  "audit.event.version": 1,
  "audit.actor.id_hash": "sha256:...",
  "audit.actor.role": "approver",
  "audit.action": "approve",
  "audit.resource.type": "case",
  "audit.resource.id": "CASE-928173",
  "audit.channel": "web",
  "audit.reason.code": "APPROVAL_GRANTED",
  "audit.integrity_hash": "sha256:...",
  "message": "Case approval audit event recorded"
}
```

---

## 25. PII and Secret Redaction Model

Structured logging meningkatkan risiko kebocoran karena field terlihat “rapi” dan mudah di-index.

Maka redaction harus menjadi desain awal.

Klasifikasi data:

| Class | Contoh | Default |
|---|---|---|
| Public | service name, endpoint template | log allowed |
| Internal | case id, workflow id | log with policy |
| Sensitive | user id, email, phone, address | hash/mask/tokenize |
| Secret | password, token, API key, private key | never log |
| Regulated | NRIC/NIK/passport, health, financial | avoid or strongly protect |

Rule praktis:

1. Secrets: never log.
2. PII: default no raw value.
3. Identifier yang dibutuhkan untuk correlation: hash dengan salt/pepper internal.
4. Display value: mask.
5. Payload body: default off.
6. Headers: allowlist, bukan blocklist.
7. Query string: default redact.
8. Exception message: sanitize if can contain input.
9. Third-party response: default no raw body.
10. Audit log: punya policy sendiri dan akses lebih ketat.

Contoh masking:

```json
{
  "user.email_masked": "f***@example.com"
}
```

Contoh hashing:

```json
{
  "user.email_hash": "sha256:..."
}
```

Contoh token present tanpa token value:

```json
{
  "auth.token.present": true,
  "auth.token.type": "Bearer"
}
```

---

## 26. Log Injection and Data Encoding

Log injection terjadi ketika input user ditulis ke log dan mengubah struktur log.

Contoh input jahat:

```text
hello\n{"log.level":"INFO","message":"fake success"}
```

Jika logging plaintext, penyerang bisa memalsukan baris log.

Dengan JSON logging yang benar, newline dan karakter khusus akan di-escape.

Namun tetap perlu:

1. encode output sesuai format,
2. batasi panjang field,
3. jangan memasukkan raw user input ke field structural seperti `event.name`, `log.level`, atau `logger.name`,
4. sanitize control characters jika pipeline bermasalah,
5. validasi schema.

Buruk:

```java
log.info("User search keyword: " + keyword);
```

Lebih baik:

```java
log.atInfo()
    .setMessage("User search submitted")
    .addKeyValue("event.name", "search.submitted")
    .addKeyValue("search.keyword_hash", hash(keyword))
    .addKeyValue("search.keyword.length", keyword.length())
    .log();
```

Jika keyword perlu untuk debugging di non-prod:

```java
if (!environment.isProd()) {
    log.atDebug()
        .setMessage("Search keyword captured in non-production")
        .addKeyValue("event.name", "search.keyword.captured")
        .addKeyValue("search.keyword", sanitize(keyword))
        .log();
}
```

---

## 27. Cardinality: Musuh Diam-Diam Structured Logging

Cardinality adalah jumlah nilai unik pada sebuah field.

Field low-cardinality:

```text
environment: prod, uat, dev
log.level: INFO, WARN, ERROR
event.outcome: success, failure, denied
http.request.method: GET, POST, PUT, DELETE
db.system: oracle, postgresql, mysql
```

Field high-cardinality:

```text
user.id
case.id
request.id
trace.id
session.id
email
ip address
full URL
exception message
raw SQL
```

High-cardinality tidak selalu buruk. `trace.id` memang high-cardinality dan diperlukan untuk lookup. Yang berbahaya adalah **menggunakan high-cardinality field untuk indexing, metrics labels, grouping, atau routing tanpa kontrol**.

Contoh bahaya:

```json
{
  "logger.name": "com.acme.Case_CASE-928173"
}
```

Atau:

```json
{
  "event.name": "case.CASE-928173.failed"
}
```

Atau:

```json
{
  "metric.label.user_id": "U-123"
}
```

Structured logging policy harus menentukan:

1. field mana yang di-index,
2. field mana yang stored only,
3. field mana yang masked,
4. field mana yang disallowed,
5. field mana yang boleh high-cardinality untuk lookup saja.

---

## 28. Schema Governance

Tanpa governance, structured logs menjadi chaos dalam format JSON.

Masalah umum:

```text
correlationId
correlation_id
corrId
requestCorrelationId
x_correlation_id
```

Atau:

```text
caseId
case_id
case.id
caseNo
case_number
applicationCaseId
```

Solusi:

1. definisikan canonical fields,
2. buat enum untuk `event.name`, `event.category`, `event.outcome`, `error.code`,
3. validasi log schema di test,
4. review observability di PR,
5. dokumentasikan reserved fields,
6. version schema jika perlu,
7. deprecate field lama secara bertahap,
8. jangan rename field tanpa migration plan.

Contoh `LogField` constants:

```java
public final class LogFields {
    private LogFields() {}

    public static final String EVENT_NAME = "event.name";
    public static final String EVENT_CATEGORY = "event.category";
    public static final String EVENT_OUTCOME = "event.outcome";
    public static final String CORRELATION_ID = "correlation.id";
    public static final String TRACE_ID = "trace.id";
    public static final String SPAN_ID = "span.id";
    public static final String CASE_ID = "case.id";
    public static final String ERROR_CODE = "error.code";
    public static final String ERROR_TYPE = "error.type";
}
```

Contoh `EventNames`:

```java
public final class EventNames {
    private EventNames() {}

    public static final String CASE_SUBMITTED = "case.submitted";
    public static final String CASE_SUBMISSION_FAILED = "case.submission.failed";
    public static final String WORKFLOW_STATE_CHANGED = "workflow.state.changed";
    public static final String DEPENDENCY_HTTP_CALL_FAILED = "dependency.http.call.failed";
    public static final String AUTHORIZATION_DENIED = "authorization.denied";
}
```

Ini terlihat sederhana, tetapi berdampak besar pada konsistensi log.

---

## 29. Structured Logging dengan SLF4J 2.x

SLF4J 2.x mendukung fluent API dan key-value logging.

Contoh:

```java
log.atInfo()
    .setMessage("Case submitted")
    .addKeyValue("event.name", "case.submitted")
    .addKeyValue("event.category", "workflow")
    .addKeyValue("event.outcome", "success")
    .addKeyValue("case.id", caseId)
    .addKeyValue("actor.id_hash", actorIdHash)
    .log();
```

Untuk error:

```java
log.atError()
    .setMessage("Case submission failed")
    .addKeyValue("event.name", "case.submission.failed")
    .addKeyValue("event.category", "workflow")
    .addKeyValue("event.outcome", "failure")
    .addKeyValue("case.id", caseId)
    .addKeyValue("error.code", "CASE_SUBMISSION_FAILED")
    .addKeyValue("error.type", ex.getClass().getName())
    .setCause(ex)
    .log();
```

Keuntungan:

1. field tidak perlu disisipkan ke message,
2. backend dapat mengekspor sebagai structured fields,
3. lebih mudah distandardisasi,
4. tidak bergantung pada parsing string.

Catatan:

Backend harus mendukung output key-value. Jika backend hanya pattern text biasa, key-value mungkin muncul sebagai teks atau tidak muncul sesuai konfigurasi.

---

## 30. Structured Logging dengan Logback

Dengan Logback, structured logging biasanya memakai encoder tambahan seperti JSON encoder, atau layout khusus.

Konsep umum:

```xml
<appender name="CONSOLE" class="ch.qos.logback.core.ConsoleAppender">
    <encoder class="net.logstash.logback.encoder.LoggingEventCompositeJsonEncoder">
        <providers>
            <timestamp>
                <fieldName>@timestamp</fieldName>
            </timestamp>
            <logLevel>
                <fieldName>log.level</fieldName>
            </logLevel>
            <loggerName>
                <fieldName>logger.name</fieldName>
            </loggerName>
            <threadName>
                <fieldName>thread.name</fieldName>
            </threadName>
            <message/>
            <mdc/>
            <arguments/>
            <stackTrace>
                <fieldName>error.stack_trace</fieldName>
            </stackTrace>
        </providers>
    </encoder>
</appender>
```

MDC fields:

```java
MDC.put("correlation.id", correlationId);
MDC.put("trace.id", traceId);
MDC.put("span.id", spanId);
```

Per-event fields bisa dikirim lewat SLF4J fluent API atau structured arguments tergantung encoder.

Prinsip:

1. MDC untuk context yang berlaku selama scope request/job/message.
2. Key-value per event untuk data spesifik event.
3. Jangan taruh semua hal ke MDC.
4. Clear MDC di akhir scope.

---

## 31. Structured Logging dengan Log4j2

Log4j2 memiliki `JsonTemplateLayout` yang cocok untuk structured logging.

Contoh konsep konfigurasi:

```xml
<Appenders>
  <Console name="Console" target="SYSTEM_OUT">
    <JsonTemplateLayout eventTemplateUri="classpath:EcsLayout.json" />
  </Console>
</Appenders>
```

Atau custom template:

```json
{
  "@timestamp": {
    "$resolver": "timestamp",
    "pattern": {
      "format": "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
      "timeZone": "UTC"
    }
  },
  "log.level": {
    "$resolver": "level",
    "field": "name"
  },
  "message": {
    "$resolver": "message",
    "stringified": true
  },
  "logger.name": {
    "$resolver": "logger",
    "field": "name"
  },
  "thread.name": {
    "$resolver": "thread",
    "field": "name"
  },
  "error.stack_trace": {
    "$resolver": "exception",
    "field": "stackTrace",
    "stackTrace": {
      "stringified": true
    }
  },
  "labels": {
    "$resolver": "mdc"
  }
}
```

Dengan Log4j2 ThreadContext:

```java
ThreadContext.put("correlation.id", correlationId);
ThreadContext.put("case.id", caseId);
```

Dengan SLF4J facade ke Log4j2 backend, hati-hati dependency bridge agar tidak terjadi loop.

---

## 32. MDC vs Event Key-Value vs Payload

Tiga sumber field structured log:

### 1. MDC / ThreadContext

Cocok untuk context yang berlaku selama scope:

```text
correlation.id
trace.id
span.id
request.id
user.id_hash
tenant.id
case.id
job.execution.id
```

### 2. Event key-value

Cocok untuk hal yang spesifik event:

```text
event.name
event.outcome
error.code
duration.ms
retry.count
dependency.name
workflow.state.from
workflow.state.to
```

### 3. Payload/body

Cocok hanya jika aman dan dibutuhkan:

```text
validation.errors
change.summary
safe.metadata
```

Jangan menjadikan MDC sebagai tempat sampah global.

Buruk:

```java
MDC.put("event.name", "case.submitted");
MDC.put("duration.ms", "200");
MDC.put("error.code", "X");
```

Baik:

```java
MDC.put("correlation.id", correlationId);
MDC.put("case.id", caseId);

log.atInfo()
    .setMessage("Case submitted")
    .addKeyValue("event.name", "case.submitted")
    .addKeyValue("event.outcome", "success")
    .addKeyValue("duration.ms", durationMs)
    .log();
```

---

## 33. Request Context Filter Example

Untuk servlet/Spring MVC:

```java
public final class RequestLoggingContextFilter extends OncePerRequestFilter {

    private static final String CORRELATION_HEADER = "X-Correlation-Id";

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain
    ) throws ServletException, IOException {

        String correlationId = firstNonBlank(
                request.getHeader(CORRELATION_HEADER),
                UUID.randomUUID().toString()
        );

        long startNanos = System.nanoTime();

        MDC.put("correlation.id", correlationId);
        MDC.put("http.request.method", request.getMethod());
        MDC.put("url.path", request.getRequestURI());

        try {
            response.setHeader(CORRELATION_HEADER, correlationId);
            filterChain.doFilter(request, response);
        } finally {
            long durationMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startNanos);

            LoggerFactory.getLogger(RequestLoggingContextFilter.class)
                .atInfo()
                .setMessage("HTTP request completed")
                .addKeyValue("event.name", "http.request.completed")
                .addKeyValue("event.category", "request")
                .addKeyValue("event.outcome", response.getStatus() >= 500 ? "failure" : "success")
                .addKeyValue("http.response.status_code", response.getStatus())
                .addKeyValue("duration.ms", durationMs)
                .log();

            MDC.clear();
        }
    }

    private static String firstNonBlank(String value, String fallback) {
        return value != null && !value.isBlank() ? value : fallback;
    }
}
```

Catatan Java 8:

`String.isBlank()` belum ada. Gunakan utility sendiri atau trim check:

```java
value != null && !value.trim().isEmpty()
```

---

## 34. Event Builder Utility

Untuk menjaga konsistensi, bisa buat utility tipis.

```java
public final class LogEvent {

    private final Logger logger;
    private final Level level;
    private final String eventName;
    private final String message;
    private final Map<String, Object> fields = new LinkedHashMap<>();
    private Throwable cause;

    private LogEvent(Logger logger, Level level, String eventName, String message) {
        this.logger = logger;
        this.level = level;
        this.eventName = eventName;
        this.message = message;
    }

    public static LogEvent info(Logger logger, String eventName, String message) {
        return new LogEvent(logger, Level.INFO, eventName, message);
    }

    public static LogEvent error(Logger logger, String eventName, String message) {
        return new LogEvent(logger, Level.ERROR, eventName, message);
    }

    public LogEvent field(String key, Object value) {
        if (value != null) {
            fields.put(key, value);
        }
        return this;
    }

    public LogEvent cause(Throwable cause) {
        this.cause = cause;
        return this;
    }

    public void log() {
        LoggingEventBuilder builder = switch (level) {
            case TRACE -> logger.atTrace();
            case DEBUG -> logger.atDebug();
            case INFO -> logger.atInfo();
            case WARN -> logger.atWarn();
            case ERROR -> logger.atError();
        };

        builder.setMessage(message)
               .addKeyValue("event.name", eventName);

        fields.forEach(builder::addKeyValue);

        if (cause != null) {
            builder.setCause(cause)
                   .addKeyValue("error.type", cause.getClass().getName());
        }

        builder.log();
    }

    public enum Level {
        TRACE, DEBUG, INFO, WARN, ERROR
    }
}
```

Pemakaian:

```java
LogEvent.info(log, "case.submitted", "Case submitted")
    .field("event.category", "workflow")
    .field("event.outcome", "success")
    .field("case.id", caseId)
    .log();
```

Catatan:

1. Utility jangan terlalu pintar.
2. Jangan menyembunyikan logging framework secara berlebihan.
3. Pastikan tetap compatible dengan SLF4J/Logback/Log4j2.
4. Jangan membuat custom logging abstraction besar tanpa alasan kuat.

---

## 35. Query-First Logging Design

Cara terbaik mendesain log adalah mulai dari query yang ingin dijawab.

Contoh pertanyaan incident:

1. request mana yang gagal?
2. endpoint mana yang error rate-nya naik?
3. dependency mana yang lambat?
4. tenant mana yang terdampak?
5. case mana yang stuck?
6. user role apa yang sering denied?
7. retry mana yang habis?
8. message mana yang masuk DLQ?
9. batch chunk mana yang gagal?
10. versi service mana yang mulai bermasalah?

Dari pertanyaan tersebut, turunkan field.

Contoh:

Pertanyaan:

```text
Dependency mana yang paling sering timeout dalam 30 menit terakhir?
```

Field yang dibutuhkan:

```text
event.category
dependency.name
error.code
event.outcome
@timestamp
```

Pertanyaan:

```text
Case mana yang gagal transition dari UNDER_REVIEW ke PENDING_APPROVAL?
```

Field yang dibutuhkan:

```text
event.name
case.id
workflow.state.from
workflow.state.to
workflow.transition
event.outcome
reason.code
```

Pertanyaan:

```text
Apakah error hanya terjadi di versi deployment baru?
```

Field yang dibutuhkan:

```text
service.version
deployment.environment
service.instance.id
k8s.pod.name
event.outcome
error.code
```

Jika field tidak ada, query tidak bisa dijawab dengan baik.

---

## 36. Example Query Patterns

Query syntax berbeda antar platform, tetapi pola berpikir sama.

### Find all logs for one correlation id

```text
correlation.id = "REQ-20260618-000918"
```

### Error grouped by error code

```text
log.level = "ERROR"
| group by error.code
| count
```

### Dependency failures by dependency

```text
event.category = "dependency"
and event.outcome = "failure"
| group by dependency.name, error.code
| count
```

### Slow operations

```text
duration.ms > 1000
| group by event.name
| percentile(duration.ms, 95)
```

### Authorization denied by action

```text
event.name = "authorization.denied"
| group by authorization.action, reason.code
| count
```

### Batch failed chunks

```text
event.name = "batch.chunk.completed"
and event.outcome = "failure"
| select job.execution.id, job.step.name, job.chunk.index, records.failed
```

### Case state transition failures

```text
event.name = "workflow.transition.denied"
and workflow.transition = "submit_for_approval"
| group by reason.code
| count
```

---

## 37. Structured Log Anti-Patterns

### Anti-pattern 1 — JSON wrapper around text

```json
{
  "message": "user 123 failed login from IP 1.2.3.4 because invalid password"
}
```

Fix:

```json
{
  "event.name": "authentication.failed",
  "actor.id_hash": "sha256:...",
  "source.ip_hash": "sha256:...",
  "auth.failure.reason": "INVALID_CREDENTIALS"
}
```

### Anti-pattern 2 — dynamic event names

```json
{
  "event.name": "case.CASE-123.failed"
}
```

Fix:

```json
{
  "event.name": "case.processing.failed",
  "case.id": "CASE-123"
}
```

### Anti-pattern 3 — inconsistent fields

```json
{"caseId": "CASE-1"}
{"case_id": "CASE-1"}
{"case.id": "CASE-1"}
```

Fix:

```json
{"case.id": "CASE-1"}
```

### Anti-pattern 4 — unbounded payload logging

```json
{
  "request.body": "... full request ..."
}
```

Fix:

```json
{
  "request.body.present": true,
  "request.body.size.bytes": 18420,
  "request.body.redacted": true
}
```

### Anti-pattern 5 — high-cardinality routing

Routing log files by user/case/session creates file explosion.

Fix:

Route by stable low-cardinality category:

```text
application.log
audit.log
security.log
integration.log
```

### Anti-pattern 6 — logging every loop iteration at INFO

Fix:

Use aggregate event:

```json
{
  "event.name": "batch.chunk.completed",
  "records.processed": 1000,
  "records.failed": 2
}
```

### Anti-pattern 7 — duplicating same exception in every layer

Fix:

Log stack trace once at boundary. Add context when wrapping exception, but do not log repeatedly.

---

## 38. Java 8 to Java 25 Considerations

Structured logging concepts are stable across Java 8–25, but runtime behavior differs.

### Java 8

Common characteristics:

1. older SLF4J 1.x widely used,
2. Logback classic common,
3. less native support for modern structured APIs,
4. MDC heavily ThreadLocal-based,
5. Java agent instrumentation still possible,
6. JFR availability depends on distribution/update history.

Strategy:

1. use MDC carefully,
2. use JSON encoder,
3. use constants for fields,
4. avoid relying on SLF4J 2.x fluent API if not available,
5. use structured arguments library if needed.

### Java 11/17

Common characteristics:

1. modern LTS baseline,
2. more mature container support,
3. JFR practical for production,
4. SLF4J 2.x migration possible depending ecosystem,
5. OpenTelemetry Java agent common.

Strategy:

1. standardize JSON logs,
2. inject trace/span ids,
3. use JFR in incident playbook,
4. treat logs, traces, metrics as correlated signals.

### Java 21+

Common characteristics:

1. virtual threads available,
2. structured concurrency evolving,
3. ThreadLocal/MDC propagation assumptions need review,
4. high concurrency can increase log volume dramatically,
5. profiling/logging overhead needs renewed evaluation.

Strategy:

1. avoid assuming one request equals one stable platform thread,
2. test MDC behavior with virtual threads,
3. prefer explicit context propagation where possible,
4. control log volume aggressively,
5. avoid per-task noisy logs.

### Java 25

For Java 25-era systems, expect stronger emphasis on:

1. virtual-thread-heavy workloads,
2. modern context propagation alternatives,
3. continuous observability,
4. OpenTelemetry integration,
5. JFR/profiling as standard operations practice.

Structured logging remains the same discipline: stable event schema, safe fields, correlation, and queryability.

---

## 39. Production Structured Logging Standard

A practical baseline standard:

### Required common fields

```text
@timestamp
log.level
message
service.name
service.version
deployment.environment
logger.name
thread.name
event.name
event.category
event.outcome
```

### Required when available

```text
trace.id
span.id
correlation.id
request.id
user.id_hash
tenant.id
case.id
job.execution.id
message.id
```

### Required for error events

```text
error.type
error.code
error.message
error.stack_trace
error.retryable
```

### Required for dependency events

```text
dependency.name
dependency.type
dependency.operation
duration.ms
event.outcome
error.code
```

### Required for HTTP events

```text
http.request.method
url.path
http.response.status_code
duration.ms
```

### Required for workflow events

```text
workflow.name
workflow.instance.id
workflow.transition
workflow.state.from
workflow.state.to
```

### Required for security events

```text
event.category = security
actor.id_hash
event.action
event.outcome
reason.code
```

### Forbidden fields unless explicitly approved

```text
password
token
authorization header
cookie
session secret
private key
raw OTP
raw request body in prod
raw response body in prod
raw NRIC/NIK/passport
raw credit card number
```

---

## 40. Reference Schema Example

```json
{
  "@timestamp": "2026-06-18T10:15:23.481Z",
  "log.level": "ERROR",
  "message": "Case submission failed after document service timeout",
  "service.name": "case-service",
  "service.version": "1.42.0",
  "service.instance.id": "case-service-7f8d9c6b4f-r92mn",
  "deployment.environment": "prod",
  "logger.name": "com.acme.case.SubmitCaseService",
  "thread.name": "http-nio-8080-exec-12",
  "event.name": "case.submission.failed",
  "event.category": "workflow",
  "event.type": "state_change",
  "event.outcome": "failure",
  "trace.id": "0af7651916cd43dd8448eb211c80319c",
  "span.id": "b7ad6b7169203331",
  "correlation.id": "REQ-20260618-000918",
  "request.id": "gw-abc-123",
  "http.request.method": "POST",
  "url.path": "/api/cases/submit",
  "http.response.status_code": 500,
  "case.id": "CASE-928173",
  "workflow.name": "case-submission",
  "workflow.state.from": "DRAFT",
  "workflow.state.to": "SUBMITTED",
  "dependency.name": "document-service",
  "dependency.type": "http",
  "duration.ms": 3142,
  "retry.count": 3,
  "error.type": "java.net.SocketTimeoutException",
  "error.code": "DOCUMENT_SERVICE_TIMEOUT",
  "error.retryable": true,
  "error.stack_trace": "java.net.SocketTimeoutException: Read timed out\n\tat ..."
}
```

Dengan satu event seperti ini, engineer bisa menjawab:

1. request apa yang gagal,
2. case apa yang terdampak,
3. dependency mana yang bermasalah,
4. retry sudah berapa kali,
5. trace mana yang harus dibuka,
6. endpoint mana yang mengembalikan 500,
7. versi service mana yang menghasilkan event,
8. apakah error retryable,
9. berapa durasi sebelum gagal,
10. stack trace mana yang relevan.

---

## 41. Testing Structured Logs

Structured logs perlu diuji.

Yang diuji:

1. event name benar,
2. required fields ada,
3. forbidden fields tidak ada,
4. correlation id muncul,
5. MDC dibersihkan,
6. exception menghasilkan `error.type` dan stack trace,
7. sensitive value masked/redacted,
8. JSON valid,
9. field name canonical,
10. event outcome sesuai scenario.

Contoh test dengan ListAppender Logback:

```java
@Test
void shouldLogCaseSubmittedEvent() {
    Logger logger = (Logger) LoggerFactory.getLogger(SubmitCaseService.class);
    ListAppender<ILoggingEvent> appender = new ListAppender<>();
    appender.start();
    logger.addAppender(appender);

    service.submit("CASE-123");

    ILoggingEvent event = appender.list.stream()
        .filter(e -> e.getFormattedMessage().contains("Case submitted"))
        .findFirst()
        .orElseThrow();

    assertThat(event.getLevel()).isEqualTo(Level.INFO);
    assertThat(event.getFormattedMessage()).contains("Case submitted");
}
```

Untuk full JSON output, test bisa dilakukan pada encoder output atau integration test yang membaca log line.

Pseudo approach:

```java
String jsonLine = captureSingleLogLine(() -> service.submit("CASE-123"));
JsonNode node = objectMapper.readTree(jsonLine);

assertThat(node.get("event.name").asText()).isEqualTo("case.submitted");
assertThat(node.get("event.outcome").asText()).isEqualTo("success");
assertThat(node.has("password")).isFalse();
```

---

## 42. Observability Pipeline Implications

Structured logging tidak berhenti di aplikasi.

Pipeline lengkap:

```text
Application logger
  -> stdout/file/socket
  -> collector/agent
  -> parser/processor
  -> redaction/enrichment
  -> storage/index
  -> query/dashboard/alert
```

Setiap tahap bisa merusak struktur.

Risiko:

1. multiline stack trace pecah menjadi banyak event,
2. JSON invalid karena encoder salah,
3. collector parse gagal,
4. field overwritten oleh enrichment,
5. high-cardinality index meledak,
6. timestamp diganti waktu ingestion,
7. redaction terlambat,
8. log dropped karena backpressure,
9. stdout truncation,
10. storage mapping conflict.

Aplikasi harus menghasilkan log yang sudah rapi, tetapi platform observability juga harus menjaga schema.

---

## 43. Mapping Conflict

Dalam storage seperti Elasticsearch/OpenSearch, field mapping bisa konflik.

Contoh buruk:

Event A:

```json
{
  "duration.ms": 120
}
```

Event B:

```json
{
  "duration.ms": "120ms"
}
```

Storage bisa gagal mapping karena field sama punya tipe berbeda.

Aturan:

1. numeric field harus numeric,
2. boolean field harus boolean,
3. timestamp field harus timestamp,
4. enum field harus string stabil,
5. jangan ubah tipe field.

Contoh baik:

```json
{
  "duration.ms": 120,
  "duration.human": "120ms"
}
```

Namun biasanya `duration.human` tidak perlu.

---

## 44. Logs as Alert Source

Structured logs bisa menjadi sumber alert, tetapi hati-hati.

Alert berdasarkan single ERROR sering noisy.

Lebih baik:

1. rate of `event.outcome=failure`,
2. count of `error.code` over window,
3. ratio failure/success,
4. repeated security failure per actor/source,
5. DLQ count,
6. batch job final outcome,
7. dependency timeout spike,
8. audit anomaly.

Contoh alert candidate:

```text
event.name = dependency.http.call.completed
and dependency.name = onemap-api
and event.outcome = failure
and error.code = DEPENDENCY_TIMEOUT
count over 5m > threshold
```

Namun metrics lebih cocok untuk alert high-volume. Logs cocok untuk detail dan forensic. Logs-as-alert harus dipakai selektif.

---

## 45. Structured Logging for Root Cause Analysis

Saat incident, structured logs membantu membuat timeline.

Langkah:

1. mulai dari symptom metric: latency/error spike,
2. filter time window,
3. group logs by `event.name`, `error.code`, `dependency.name`, `service.version`,
4. cari perubahan pola,
5. pilih correlation id contoh,
6. buka trace id,
7. baca event sequence,
8. cocokkan dengan deployment/config/infra event,
9. validasi dengan profiler/JFR/thread dump jika perlu,
10. buat mitigation.

Structured logs harus mendukung dua mode investigasi:

### Breadth mode

Melihat pola agregat.

```text
Group by error.code over 15 minutes
```

### Depth mode

Melihat satu flow detail.

```text
Filter by correlation.id and sort by @timestamp
```

Log schema yang baik mendukung dua-duanya.

---

## 46. Mini Case Study: “ERROR Banyak tapi Tidak Bisa Ditelusuri”

### Kondisi awal

Sistem menghasilkan banyak log:

```text
ERROR Failed processing
ERROR Timeout
ERROR Cannot update status
ERROR Error occurred
```

Masalah:

1. tidak tahu case mana,
2. tidak tahu dependency mana,
3. tidak tahu user/tenant terdampak,
4. tidak tahu retry count,
5. tidak tahu apakah timeout DB atau HTTP,
6. tidak tahu service version,
7. tidak bisa group error.

### Perbaikan schema

```json
{
  "event.name": "case.status.update.failed",
  "event.category": "workflow",
  "event.outcome": "failure",
  "case.id": "CASE-928173",
  "workflow.state.from": "UNDER_REVIEW",
  "workflow.state.to": "APPROVED",
  "dependency.name": "oracle-case-db",
  "dependency.type": "database",
  "db.operation": "UPDATE",
  "error.type": "java.sql.SQLTimeoutException",
  "error.code": "DB_UPDATE_TIMEOUT",
  "retry.count": 2,
  "duration.ms": 30000,
  "service.version": "1.42.0",
  "trace.id": "...",
  "correlation.id": "...",
  "message": "Case status update failed because database update timed out"
}
```

### Hasil

Engineer bisa langsung query:

```text
error.code = DB_UPDATE_TIMEOUT
| group by service.version, db.operation, workflow.state.to
```

Dan:

```text
case.id = CASE-928173
| sort @timestamp asc
```

Perbaikan bukan karena log menjadi lebih banyak. Perbaikan terjadi karena log menjadi lebih bermakna.

---

## 47. Practical Lab 1 — Convert Text Logs to Structured Logs

Ambil log lama:

```java
log.info("User {} submitted case {}", userId, caseId);
log.error("Failed to submit case " + caseId, ex);
```

Ubah menjadi:

```java
log.atInfo()
    .setMessage("Case submitted")
    .addKeyValue("event.name", "case.submitted")
    .addKeyValue("event.category", "workflow")
    .addKeyValue("event.outcome", "success")
    .addKeyValue("case.id", caseId)
    .addKeyValue("actor.id_hash", hashUserId(userId))
    .log();

log.atError()
    .setMessage("Case submission failed")
    .addKeyValue("event.name", "case.submission.failed")
    .addKeyValue("event.category", "workflow")
    .addKeyValue("event.outcome", "failure")
    .addKeyValue("case.id", caseId)
    .addKeyValue("actor.id_hash", hashUserId(userId))
    .addKeyValue("error.code", "CASE_SUBMISSION_FAILED")
    .addKeyValue("error.type", ex.getClass().getName())
    .setCause(ex)
    .log();
```

Checklist:

1. Apakah event name stabil?
2. Apakah user id aman?
3. Apakah outcome eksplisit?
4. Apakah case id queryable?
5. Apakah exception disimpan sebagai cause?
6. Apakah error code ada?

---

## 48. Practical Lab 2 — Design Log Schema for One Flow

Pilih flow:

```text
Submit case -> validate -> save DB -> call document service -> publish message -> return response
```

Buat event:

1. `case.submission.requested`
2. `case.validation.completed`
3. `db.transaction.completed`
4. `dependency.http.call.completed`
5. `message.published`
6. `case.submission.completed`
7. `case.submission.failed`

Untuk setiap event, tentukan:

1. `event.name`,
2. `event.category`,
3. `event.outcome`,
4. context fields,
5. duration fields,
6. error fields jika gagal,
7. fields yang tidak boleh di-log.

Output lab adalah tabel seperti ini:

| Event | Category | Required Fields | Forbidden Fields |
|---|---|---|---|
| `case.submission.requested` | workflow | `case.id`, `actor.id_hash`, `correlation.id` | raw request body |
| `case.validation.completed` | workflow | `case.id`, `validation.error.count`, `event.outcome` | raw NRIC |
| `dependency.http.call.completed` | dependency | `dependency.name`, `duration.ms`, `status_code` | token/header |

---

## 49. Practical Lab 3 — Define Canonical Fields

Buat file:

```text
observability-log-schema.md
```

Isi:

1. reserved fields,
2. domain fields,
3. security fields,
4. audit fields,
5. error code convention,
6. event name convention,
7. forbidden fields,
8. retention/indexing note.

Contoh:

```markdown
# Logging Schema

## Required Fields

- `@timestamp`
- `log.level`
- `service.name`
- `event.name`
- `event.category`
- `event.outcome`

## Domain Fields

- `case.id`
- `application.id`
- `workflow.name`
- `workflow.state.from`
- `workflow.state.to`

## Forbidden Raw Fields

- `password`
- `token`
- `authorization`
- `cookie`
- `nric`
- `passport_number`
```

---

## 50. Production Readiness Checklist

Structured logging readiness:

```text
[ ] Logs are emitted as valid JSON in production.
[ ] Every event has @timestamp, log.level, service.name, event.name, event.outcome.
[ ] Event names are stable and not dynamic.
[ ] Field names are canonical and documented.
[ ] Correlation id is present for request/message/job flows.
[ ] Trace id/span id are injected when tracing exists.
[ ] Error events have error.code and error.type.
[ ] Stack trace is logged once at boundary.
[ ] HTTP logs do not expose raw query string secrets.
[ ] Request/response body logging is disabled in production by default.
[ ] Secrets are never logged.
[ ] Sensitive identifiers are hashed or masked.
[ ] Log injection is considered.
[ ] High-cardinality fields are controlled.
[ ] Log volume is measured.
[ ] JSON validity is tested.
[ ] Schema mapping conflicts are monitored.
[ ] Log retention policy exists.
[ ] Audit logs are separated or clearly classified.
[ ] Security logs have required fields.
[ ] Observability queries are tested during load test.
```

---

## 51. Top 1% Engineer Heuristics

A top-tier engineer melihat log bukan dari sisi “apa yang ingin saya print”, tetapi:

1. **Apa pertanyaan produksi yang harus dijawab?**
2. **Field apa yang dibutuhkan untuk menjawabnya?**
3. **Apakah field itu aman untuk disimpan?**
4. **Apakah field itu stabil untuk query?**
5. **Apakah field itu akan meledakkan cardinality/cost?**
6. **Apakah event ini membantu breadth analysis atau depth analysis?**
7. **Apakah event ini bisa dikorelasikan dengan trace/metric/profile?**
8. **Apakah event ini memiliki owner dan actionability?**
9. **Apakah log ini masih berguna 6 bulan lagi saat audit/incident review?**
10. **Apakah log ini tetap benar saat concurrency tinggi, retry, async, dan partial failure?**

Structured logging adalah latihan disiplin. Formatnya mudah. Konsistensinya sulit.

---

## 52. Ringkasan

Structured logging adalah perubahan dari:

```text
log sebagai teks
```

menjadi:

```text
log sebagai event data model
```

Fondasi utama:

1. JSON tidak otomatis berarti structured logging.
2. Field harus queryable, stable, safe, dan meaningful.
3. `event.name`, `event.category`, `event.outcome`, `correlation.id`, `trace.id`, dan `error.code` adalah field strategis.
4. Message tetap penting, tetapi bukan tempat utama menyimpan data.
5. MDC cocok untuk context scope, bukan semua event details.
6. Key-value per event cocok untuk data spesifik event.
7. PII/secrets harus ditangani sejak desain schema.
8. Cardinality harus dikendalikan.
9. Schema governance wajib jika sistem dan tim membesar.
10. Structured logging harus didesain dari query dan incident questions.

---

## 53. Referensi

Referensi utama untuk memperdalam topik:

1. OpenTelemetry Semantic Conventions — https://opentelemetry.io/docs/concepts/semantic-conventions/
2. OpenTelemetry General Logs Attributes — https://opentelemetry.io/docs/specs/semconv/general/logs/
3. Elastic Common Schema Reference — https://www.elastic.co/docs/reference/ecs
4. Elastic Common Schema Log Fields — https://www.elastic.co/docs/reference/ecs/ecs-log
5. OWASP Logging Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html
6. OWASP Application Logging Vocabulary Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Logging_Vocabulary_Cheat_Sheet.html
7. Apache Log4j2 JSON Template Layout — https://logging.apache.org/log4j/2.x/manual/json-template-layout.html
8. Apache Log4j2 Layouts — https://logging.apache.org/log4j/2.x/manual/layouts.html
9. SLF4J Manual — https://www.slf4j.org/manual.html
10. Logback Manual — https://logback.qos.ch/manual/

---

## 54. Status Series

Selesai:

- Part 0 — Orientation, Scope, Mental Model, Learning Contract
- Part 1 — Runtime Evidence, Not Just Logging
- Part 2 — Java Logging Architecture: Facade, API, Backend, Appender, Layout
- Part 3 — Log Semantics: What Should Be Logged and Why
- Part 4 — SLF4J Deep Dive: Parameterized, Fluent, Marker, Key-Value Logging
- Part 5 — Logback Deep Dive I: Architecture, Configuration, Appenders, Encoders
- Part 6 — Logback Deep Dive II: AsyncAppender, MDC, Sifting, Filtering, JSON
- Part 7 — Log4j2 Deep Dive I: Architecture, Configuration, Appenders, Layouts
- Part 8 — Log4j2 Deep Dive II: Async Logger, Garbage-Free Logging, Routing, Security
- Part 9 — Structured Logging: From Human Text to Machine-Queryable Events

Berikutnya:

- Part 10 — Context Propagation: MDC, ThreadLocal, Virtual Threads, Scoped Values

Seri belum selesai. Target akhir tetap Part 35.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./08-log4j2-deep-dive-async-logger-garbage-free-routing-security.md">⬅️ Part 8 — Log4j2 Deep Dive II: Async Logger, Garbage-Free Logging, Routing, Security</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./10-context-propagation-mdc-threadlocal-virtual-threads-scoped-values.md">Part 10 — Context Propagation: MDC, ThreadLocal, Virtual Threads, Scoped Values ➡️</a>
</div>
