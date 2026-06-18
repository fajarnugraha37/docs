# Part 3 — Log Semantics: What Should Be Logged and Why

Series: `learn-java-logging-observability-profiling-troubleshooting-engineering`  
File: `03-log-semantics-what-should-be-logged-and-why.md`  
Target: Java 8–25  
Scope: advanced Java logging semantics, event taxonomy, level decision, production diagnosability, security-aware logging, enterprise/regulatory runtime evidence

---

## 0. Posisi Part Ini dalam Series

Pada Part 2, kita sudah membedah arsitektur logging Java:

- SLF4J sebagai facade.
- Logback dan Log4j2 sebagai backend.
- Logger hierarchy.
- Appender.
- Layout/encoder.
- Filter.
- Binding/provider.
- Classpath/module pitfalls.

Part 3 naik satu level lebih penting: **apa yang seharusnya dicatat sebagai log dan kenapa**.

Banyak engineer bisa menulis:

```java
log.info("Processing request");
```

Tetapi engineer yang lebih matang bertanya:

1. Event apa yang sedang terjadi?
2. Apakah event ini penting bagi operasi produksi?
3. Apakah ini membantu debugging atau hanya noise?
4. Apakah ini business event, technical event, audit event, security event, atau diagnostic event?
5. Apakah level-nya benar?
6. Apakah field-nya cukup untuk rekonstruksi timeline?
7. Apakah aman dari PII, secret, token, dan data sensitif?
8. Apakah cardinality-nya terkendali?
9. Apakah log ini masih berguna 3 bulan lagi saat insiden terjadi?
10. Apakah log ini menjawab pertanyaan operasional nyata?

Logging yang buruk biasanya bukan karena framework-nya salah, tetapi karena **semantik event-nya tidak jelas**.

---

## 1. Core Thesis

Logging bukan aktivitas menulis teks ke console.

Logging adalah proses menghasilkan **runtime event evidence** yang sengaja didesain agar manusia dan mesin dapat memahami perilaku sistem setelah sistem berjalan.

Dengan kata lain:

> Log adalah catatan terstruktur tentang sesuatu yang bermakna yang terjadi pada runtime.

Jika log tidak merepresentasikan event yang bermakna, ia hanya noise.

Jika log tidak punya konteks, ia tidak bisa dipakai untuk diagnosis.

Jika log terlalu banyak, ia menyembunyikan sinyal penting.

Jika log berisi data sensitif, ia menjadi risiko keamanan dan compliance.

Jika log level salah, alerting dan triage menjadi salah.

Jika log tidak konsisten, query dan korelasi menjadi mahal.

---

## 2. Logging Semantics vs Logging Syntax

Syntax logging menjawab:

```java
log.info("User {} created order {}", userId, orderId);
```

Semantics logging menjawab:

- Apakah `userId` boleh muncul di log?
- Apakah `orderId` adalah high-cardinality field?
- Apakah ini business event atau diagnostic event?
- Apakah `INFO` benar?
- Apakah perlu `event.name=order.created`?
- Apakah perlu `correlation_id`?
- Apakah ini perlu dicatat sekali di boundary use case saja atau juga di service internal?
- Apakah event ini harus tahan audit?
- Apakah log ini akan dipakai untuk alert, trace correlation, BI, forensic, atau debugging?

Framework hanya menyediakan mekanisme. Semantics menentukan kualitas evidence.

---

## 3. Log Sebagai Event, Bukan Kalimat Bebas

Log yang buruk:

```text
Start process
Done
Failed
Something wrong
Calling API
Response received
```

Masalah:

- Tidak jelas proses apa.
- Tidak ada entity id.
- Tidak ada outcome.
- Tidak ada duration.
- Tidak ada dependency.
- Tidak ada correlation.
- Tidak bisa di-query dengan stabil.
- Tidak bisa dibedakan antar module.

Log yang lebih benar:

```json
{
  "timestamp": "2026-06-18T10:15:30.214Z",
  "level": "INFO",
  "event.name": "application.submission.accepted",
  "service.name": "case-management-api",
  "module": "application-management",
  "correlation_id": "4f7c2d9c1d9a4b70",
  "trace_id": "0af7651916cd43dd8448eb211c80319c",
  "case_id": "CASE-2026-00001234",
  "application_id": "APP-2026-00004567",
  "actor.type": "external_user",
  "outcome": "accepted"
}
```

Perhatikan: ini bukan hanya “message”. Ini event.

Mental model:

```text
Runtime behavior
    -> meaningful event
        -> event name
            -> context fields
                -> severity level
                    -> destination / retention / alert policy
```

---

## 4. Lima Pertanyaan Sebelum Menulis Log

Sebelum menambah log, tanyakan:

### 4.1 What happened?

Apa event spesifiknya?

Buruk:

```text
Processing request
```

Lebih baik:

```text
application.submission.validation.started
application.submission.validation.failed
application.submission.persisted
notification.email.dispatch.failed
```

### 4.2 Why does it matter?

Apakah event ini penting untuk:

- debugging?
- audit?
- security monitoring?
- operational monitoring?
- compliance?
- business reconciliation?
- SLA investigation?
- incident timeline?

Jika tidak ada alasan jelas, mungkin tidak perlu log.

### 4.3 Who or what is affected?

Field apa yang membantu memahami dampak?

Contoh:

- tenant/agency.
- module.
- user category.
- case id.
- transaction id.
- job id.
- message id.
- external system.
- region/zone.
- node/pod/container.

### 4.4 How severe is it?

Apakah event ini normal, abnormal, recoverable, degraded, atau fatal?

### 4.5 What can someone do with this log?

Log yang bagus punya actionability.

Contoh action:

- correlate dengan trace.
- cari semua kasus yang gagal di dependency tertentu.
- hitung error rate.
- identifikasi tenant terdampak.
- audit state transition.
- temukan retry storm.
- bedakan timeout dari validation error.
- rekonstruksi timeline insiden.

Jika log tidak mendukung aksi apa pun, kemungkinan besar noise.

---

## 5. Kategori Besar Log Event

Dalam sistem enterprise Java, log sebaiknya diklasifikasikan. Minimal gunakan kategori berikut.

```text
Log Event
├── Diagnostic Event
├── Operational Event
├── Business Event
├── Audit Event
├── Security Event
├── Dependency Event
├── State Transition Event
├── Workflow/Event Processing Event
├── Performance Event
├── Configuration Event
└── Lifecycle Event
```

Klasifikasi ini penting karena setiap kategori punya:

- level berbeda,
- field berbeda,
- retention berbeda,
- akses berbeda,
- alerting berbeda,
- toleransi PII berbeda,
- query pattern berbeda.

---

## 6. Diagnostic Event

Diagnostic event membantu engineer memahami perilaku teknis sistem.

Contoh:

- request diterima.
- validation gagal.
- cache miss.
- retry dilakukan.
- fallback dipakai.
- object mapping gagal.
- parsing input gagal.
- state tidak valid.
- concurrency conflict.

Contoh Java:

```java
log.warn(
    "event=application.validation.failed correlation_id={} application_id={} rule_code={} field={} reason={}",
    correlationId,
    applicationId,
    ruleCode,
    field,
    reason
);
```

Structured style dengan SLF4J 2.x:

```java
log.atWarn()
   .setMessage("application.validation.failed")
   .addKeyValue("correlation_id", correlationId)
   .addKeyValue("application_id", applicationId)
   .addKeyValue("rule_code", ruleCode)
   .addKeyValue("field", field)
   .addKeyValue("reason", reason)
   .log();
```

Catatan penting:

- Diagnostic log tidak harus selalu `ERROR`.
- Validation failure sering `INFO` atau `WARN`, tergantung apakah itu expected user behavior atau indikasi sistem bermasalah.
- Jangan log full input object tanpa redaction.

---

## 7. Operational Event

Operational event membantu tim operasi mengetahui kondisi layanan.

Contoh:

- service started.
- service stopped.
- configuration loaded.
- dependency connected.
- scheduler started.
- batch completed.
- queue consumer paused.
- health check degraded.
- feature flag changed.

Contoh:

```java
log.atInfo()
   .setMessage("service.lifecycle.started")
   .addKeyValue("service.name", serviceName)
   .addKeyValue("service.version", version)
   .addKeyValue("java.version", System.getProperty("java.version"))
   .addKeyValue("profile", activeProfile)
   .log();
```

Operational event biasanya `INFO`, kecuali kondisi degraded:

```java
log.atWarn()
   .setMessage("dependency.health.degraded")
   .addKeyValue("dependency.name", "payment-gateway")
   .addKeyValue("failure_rate", failureRate)
   .addKeyValue("window", "5m")
   .log();
```

---

## 8. Business Event

Business event mencatat kejadian domain yang penting.

Contoh regulatory/case management domain:

- application submitted.
- case created.
- case assigned.
- case escalated.
- appeal lodged.
- enforcement notice generated.
- inspection scheduled.
- approval granted.
- rejection issued.
- renewal approved.
- license suspended.

Business log bukan pengganti database audit trail. Namun ia membantu:

- timeline operasional.
- support investigation.
- debugging business flow.
- reconciliation.
- cross-service correlation.

Contoh:

```java
log.atInfo()
   .setMessage("case.escalated")
   .addKeyValue("case_id", caseId)
   .addKeyValue("from_queue", fromQueue)
   .addKeyValue("to_queue", toQueue)
   .addKeyValue("reason_code", reasonCode)
   .addKeyValue("actor_type", actorType)
   .log();
```

Prinsip:

- Jangan simpan data sensitif yang tidak perlu.
- Jangan log full object domain.
- Gunakan stable identifiers.
- Pastikan field mendukung query.
- Business event penting sebaiknya punya event name stabil.

---

## 9. Audit Event

Audit event adalah catatan yang digunakan untuk pertanggungjawaban.

Ia menjawab:

- siapa melakukan apa,
- kapan,
- dari mana,
- terhadap objek apa,
- sebelum/sesudahnya apa,
- apakah berhasil,
- siapa yang memberi otorisasi,
- apakah ada delegated action.

Audit event berbeda dari application log biasa.

Application log:

```text
Useful for debugging and operations.
```

Audit log:

```text
Useful for accountability, compliance, dispute resolution, and forensic review.
```

Audit event field minimum:

```text
actor_id
actor_type
actor_role
action
resource_type
resource_id
timestamp
outcome
source_ip / channel / client_id
correlation_id
reason_code
before_state / after_state if safe and required
```

Contoh:

```java
log.atInfo()
   .setMessage("audit.case.status.changed")
   .addKeyValue("actor_id", actorId)
   .addKeyValue("actor_type", actorType)
   .addKeyValue("resource_type", "case")
   .addKeyValue("resource_id", caseId)
   .addKeyValue("action", "status.change")
   .addKeyValue("from_status", previousStatus)
   .addKeyValue("to_status", nextStatus)
   .addKeyValue("outcome", "success")
   .addKeyValue("correlation_id", correlationId)
   .log();
```

Tetapi dalam sistem yang serius, audit event sering tidak cukup hanya masuk ke application log. Ia biasanya perlu:

- persistence khusus,
- schema ketat,
- retention khusus,
- access control khusus,
- tamper evidence,
- immutable append-only model,
- reviewer/auditor workflow.

Rule:

> Application logging boleh membantu audit investigation, tetapi tidak otomatis memenuhi kebutuhan audit trail.

---

## 10. Security Event

Security event berhubungan dengan autentikasi, otorisasi, abuse, policy violation, atau suspicious behavior.

Contoh:

- login success/failure.
- token validation failure.
- invalid signature.
- access denied.
- role mismatch.
- suspicious IP change.
- repeated failed login.
- privilege escalation attempt.
- CSRF failure.
- CORS rejection.
- request body too large.
- rate limit exceeded.
- file upload rejected.
- deserialization blocked.
- path traversal attempt.
- SQL injection pattern detected.

Contoh:

```java
log.atWarn()
   .setMessage("security.access.denied")
   .addKeyValue("actor_id", safeActorId)
   .addKeyValue("resource_type", "case")
   .addKeyValue("resource_id", caseId)
   .addKeyValue("required_permission", "CASE_APPROVE")
   .addKeyValue("channel", channel)
   .addKeyValue("correlation_id", correlationId)
   .log();
```

Security log harus hati-hati:

- Jangan log password.
- Jangan log raw token.
- Jangan log full authorization header.
- Jangan log session cookie.
- Jangan log biometric/identity payload.
- Jangan log secret key.
- Jangan log full request body kecuali sudah disanitasi.
- Jangan membuat log injection via input mentah.

OWASP Logging Cheat Sheet menekankan bahwa logging aplikasi harus dirancang untuk keamanan, termasuk kejadian yang perlu dicatat, data yang tidak boleh dicatat, dan perlindungan terhadap injeksi/log forging.

---

## 11. Dependency Event

Dependency event mencatat interaksi dengan sistem eksternal atau resource lokal yang kritikal.

Contoh dependency:

- database.
- Redis.
- RabbitMQ/Kafka.
- HTTP API.
- SMTP.
- S3/object storage.
- identity provider.
- payment gateway.
- geocoding service.
- file system.

Dependency log yang baik menjawab:

- dependency apa?
- operation apa?
- endpoint/logical operation apa?
- duration berapa?
- outcome apa?
- error type apa?
- retry ke berapa?
- timeout jenis apa?
- circuit breaker state apa?

Contoh:

```java
log.atWarn()
   .setMessage("dependency.http.request.failed")
   .addKeyValue("dependency.name", "onemap")
   .addKeyValue("operation", "postal.lookup")
   .addKeyValue("http.method", "GET")
   .addKeyValue("http.status_code", 429)
   .addKeyValue("duration_ms", durationMs)
   .addKeyValue("retry_attempt", attempt)
   .addKeyValue("error.type", "rate_limited")
   .addKeyValue("correlation_id", correlationId)
   .log();
```

Jangan log:

- full token.
- full URL dengan secret query param.
- full response body yang mungkin berisi PII.
- excessively high-cardinality raw payload.

---

## 12. State Transition Event

State transition event sangat penting dalam sistem regulatory, case management, workflow, BPMN, atau lifecycle-heavy domain.

Contoh:

```text
DRAFT -> SUBMITTED
SUBMITTED -> UNDER_REVIEW
UNDER_REVIEW -> CLARIFICATION_REQUIRED
CLARIFICATION_REQUIRED -> RESUBMITTED
UNDER_REVIEW -> APPROVED
UNDER_REVIEW -> REJECTED
APPROVED -> SUSPENDED
```

State transition log yang buruk:

```text
Status updated
```

State transition log yang baik:

```java
log.atInfo()
   .setMessage("case.state.transitioned")
   .addKeyValue("case_id", caseId)
   .addKeyValue("from_state", fromState)
   .addKeyValue("to_state", toState)
   .addKeyValue("transition", transitionName)
   .addKeyValue("actor_type", actorType)
   .addKeyValue("reason_code", reasonCode)
   .addKeyValue("correlation_id", correlationId)
   .log();
```

Untuk stateful system, ini sering menjadi log paling berharga.

Kenapa?

Karena banyak bug produksi bukan sekadar exception, tetapi:

- state melompat tidak valid,
- state stuck,
- state berubah dua kali,
- retry mengulang transition,
- event async datang terlambat,
- approval race condition,
- stale data menimpa status baru,
- compensation gagal.

State transition log membantu menjawab:

- apakah transition valid?
- siapa yang trigger?
- kapan terjadi?
- apakah ada duplicate?
- apakah ada out-of-order event?
- apakah transition terjadi sebelum/ sesudah external callback?

---

## 13. Workflow and Async Processing Event

Untuk messaging, batch, scheduler, dan async job, log harus lebih eksplisit karena tidak ada natural HTTP request boundary.

Event penting:

```text
message.produced
message.consumed
message.acknowledged
message.rejected
message.retried
message.dead_lettered
job.started
job.chunk.started
job.chunk.completed
job.completed
job.failed
scheduler.triggered
scheduler.skipped
scheduler.overlapped
```

Contoh:

```java
log.atInfo()
   .setMessage("message.consumed")
   .addKeyValue("queue", queueName)
   .addKeyValue("message_id", messageId)
   .addKeyValue("event_type", eventType)
   .addKeyValue("attempt", attempt)
   .addKeyValue("correlation_id", correlationId)
   .log();
```

Async log harus membawa causality identity:

- trace id jika ada.
- correlation id.
- message id.
- causation id.
- aggregate id/domain id.
- job execution id.

Tanpa ini, async troubleshooting menjadi tebakan.

---

## 14. Performance Event

Performance event mencatat latency, throughput, queueing, atau resource wait yang tidak selalu exception.

Contoh:

```java
log.atWarn()
   .setMessage("operation.slow")
   .addKeyValue("operation", "case.search")
   .addKeyValue("duration_ms", durationMs)
   .addKeyValue("threshold_ms", 2000)
   .addKeyValue("result_count", resultCount)
   .addKeyValue("correlation_id", correlationId)
   .log();
```

Tetapi hati-hati: log slow operation bisa noisy jika semua request lambat.

Lebih baik:

- metrics untuk agregasi.
- traces untuk sample detail.
- log hanya untuk threshold breach penting atau anomalous condition.

Rule:

> Metrics menjawab “seberapa sering dan seberapa parah”. Log menjawab “kejadian spesifik apa yang terjadi”. Trace menjawab “di mana waktu habis”.

Performance log cocok untuk:

- rare slow path.
- unexpected fallback.
- timeout.
- retry storm.
- batch chunk anomaly.
- pool wait melebihi threshold.
- lock wait besar.

---

## 15. Configuration and Lifecycle Event

Banyak incident terjadi karena config, bukan code.

Maka log startup dan config summary penting.

Contoh event:

```text
service.lifecycle.started
service.lifecycle.ready
service.lifecycle.stopping
configuration.loaded
feature.flag.loaded
dependency.config.loaded
connection.pool.initialized
scheduler.registered
consumer.started
```

Contoh:

```java
log.atInfo()
   .setMessage("connection.pool.initialized")
   .addKeyValue("pool.name", "hikari-main")
   .addKeyValue("maximum_pool_size", maxPoolSize)
   .addKeyValue("minimum_idle", minIdle)
   .addKeyValue("connection_timeout_ms", connectionTimeoutMs)
   .addKeyValue("database", safeDbAlias)
   .log();
```

Jangan log:

- DB password.
- full JDBC URL jika mengandung credential.
- secret env var.
- access key.
- token endpoint secret.

Config log harus aman tetapi cukup untuk membandingkan instance sehat dan tidak sehat.

---

## 16. Level Semantics: TRACE, DEBUG, INFO, WARN, ERROR

Log level bukan dekorasi. Log level adalah kontrak severity.

Masalah umum:

- `ERROR` dipakai untuk user validation error.
- `WARN` dipakai untuk noise biasa.
- `INFO` terlalu banyak hingga storage meledak.
- `DEBUG` dipakai untuk data sensitif.
- `TRACE` tidak pernah berguna karena tidak dirancang.

Gunakan level sebagai jawaban terhadap pertanyaan:

> Seberapa abnormal event ini dan apakah memerlukan perhatian manusia/sistem?

---

## 17. TRACE

TRACE adalah level sangat detail untuk mengikuti jalur eksekusi internal.

Cocok untuk:

- diagnostic sementara.
- framework/internal library behavior.
- flow yang sangat kompleks.
- parsing/mapping decision detail.
- state machine transition candidate evaluation.

Tidak cocok untuk default production.

Contoh:

```java
log.trace("rule.evaluation.candidate rule={} matched={} inputHash={}", ruleCode, matched, inputHash);
```

Guideline:

- Jangan aktifkan TRACE global di production.
- TRACE harus bisa diaktifkan per package/class/module.
- TRACE tidak boleh membawa PII/raw payload.
- TRACE harus tetap punya meaning, bukan sekadar “entered method”.

Anti-pattern:

```java
log.trace("enter");
log.trace("step 1");
log.trace("step 2");
log.trace("exit");
```

Lebih baik gunakan profiler/tracing untuk call path detail.

---

## 18. DEBUG

DEBUG adalah diagnostic detail yang berguna saat investigasi tetapi terlalu noisy untuk operasi normal.

Cocok untuk:

- branch decision.
- cache decision.
- retry detail.
- transformation summary.
- SQL parameter summary jika aman.
- external request metadata.
- feature flag decision.

Contoh:

```java
log.debug(
    "event=feature.flag.evaluated flag={} variant={} user_segment={} correlation_id={}",
    flagName,
    variant,
    userSegment,
    correlationId
);
```

DEBUG sebaiknya:

- murah saat disabled.
- tidak melakukan expensive computation tanpa guard/supplier.
- tidak memanggil remote service.
- tidak stringify object besar.
- tidak mencetak payload sensitif.

Buruk:

```java
log.debug("Response body: " + objectMapper.writeValueAsString(response));
```

Lebih aman:

```java
if (log.isDebugEnabled()) {
    log.debug("event=response.summary status={} item_count={} correlation_id={}",
        response.status(), response.items().size(), correlationId);
}
```

---

## 19. INFO

INFO adalah event normal yang penting secara operasional.

Pertanyaan untuk INFO:

> Apakah event ini layak muncul di production default log dan membantu memahami lifecycle sistem?

Cocok untuk:

- service startup/shutdown.
- major business event.
- state transition penting.
- job completed.
- dependency connected.
- config summary aman.
- request completion hanya jika traffic rendah atau sampling/akses log terpisah.

Tidak cocok:

- setiap method call.
- setiap loop iteration.
- setiap DB query.
- setiap cache hit.
- setiap object mapping.

INFO yang baik:

```java
log.atInfo()
   .setMessage("batch.job.completed")
   .addKeyValue("job_name", jobName)
   .addKeyValue("execution_id", executionId)
   .addKeyValue("processed_count", processed)
   .addKeyValue("success_count", success)
   .addKeyValue("failed_count", failed)
   .addKeyValue("duration_ms", durationMs)
   .log();
```

INFO yang buruk:

```java
log.info("inside for loop");
```

Rule:

> Production INFO log harus bisa dibaca sebagai ringkasan timeline penting sistem.

---

## 20. WARN

WARN adalah event abnormal atau degraded tetapi sistem masih bisa berjalan.

Cocok untuk:

- retry dilakukan.
- fallback dipakai.
- dependency lambat tetapi belum gagal total.
- invalid state ditemukan tetapi bisa diperbaiki.
- duplicate message diabaikan.
- rate limit mendekati batas.
- pool wait tinggi.
- config deprecated.
- non-critical feature gagal.

Contoh:

```java
log.atWarn()
   .setMessage("dependency.retry.scheduled")
   .addKeyValue("dependency.name", "email-service")
   .addKeyValue("operation", "sendNotification")
   .addKeyValue("attempt", attempt)
   .addKeyValue("max_attempts", maxAttempts)
   .addKeyValue("delay_ms", delayMs)
   .addKeyValue("error.type", ex.getClass().getSimpleName())
   .addKeyValue("correlation_id", correlationId)
   .log();
```

WARN bukan berarti incident selalu perlu dibuka. WARN berarti ada kondisi yang perlu diperhatikan jika frekuensinya meningkat.

Anti-pattern:

```java
log.warn("User entered invalid password");
```

Satu invalid password bisa normal. Banyak invalid password per akun/IP bisa security warning.

---

## 21. ERROR

ERROR adalah event gagal yang menyebabkan operasi tidak dapat diselesaikan, kehilangan fungsi, atau membutuhkan perhatian.

Cocok untuk:

- request gagal karena bug/internal failure.
- batch gagal.
- message gagal permanen.
- dependency failure setelah retry habis.
- data corruption detected.
- invariant violation.
- unexpected exception.
- operation cannot continue.

Contoh:

```java
log.atError()
   .setMessage("case.approval.failed")
   .addKeyValue("case_id", caseId)
   .addKeyValue("operation", "approveCase")
   .addKeyValue("error.type", ex.getClass().getName())
   .addKeyValue("correlation_id", correlationId)
   .setCause(ex)
   .log();
```

ERROR harus memiliki:

- event name jelas.
- affected entity jika aman.
- operation.
- error type.
- correlation id/trace id.
- stack trace untuk unexpected failure.
- outcome jelas.

ERROR tidak boleh digunakan untuk:

- normal validation error.
- user typo.
- expected 404 dalam lookup opsional.
- duplicate request yang tertangani idempotently.
- retry attempt yang masih akan dilanjutkan.

Rule:

> Jika tidak ada action atau failure nyata, jangan gunakan ERROR.

---

## 22. FATAL?

SLF4J umum tidak punya level FATAL sebagai level standar utama. Beberapa framework atau sistem historis mengenal FATAL.

Dalam desain modern, kondisi fatal biasanya ditangani sebagai:

- `ERROR` log,
- process exit,
- readiness/liveness failure,
- alert critical,
- crash loop evidence,
- runtime health state.

Contoh fatal condition:

- required config missing.
- database migration incompatible.
- cannot bind server port.
- keystore invalid.
- critical dependency unavailable during startup.

Contoh:

```java
log.atError()
   .setMessage("service.startup.failed")
   .addKeyValue("reason", "required_configuration_missing")
   .addKeyValue("config_key", "DB_URL")
   .setCause(ex)
   .log();

System.exit(1);
```

Jangan membuat custom `fatal()` wrapper jika tidak perlu. Lebih penting adalah alert/routing policy.

---

## 23. Level Decision Matrix

Gunakan matrix berikut:

| Situation | Level | Reason |
|---|---:|---|
| Internal branch detail untuk investigasi | DEBUG/TRACE | Tidak penting untuk default production |
| Service started dengan config summary aman | INFO | Operational lifecycle penting |
| Business state transition berhasil | INFO | Timeline domain penting |
| User input invalid yang normal | INFO atau no log | Expected behavior |
| Banyak invalid login dalam window pendek | WARN | Security anomaly |
| Retry attempt masih ada kesempatan sukses | WARN atau DEBUG | Abnormal tetapi recoverable |
| Fallback dipakai | WARN | Degraded behavior |
| Dependency timeout setelah retry habis | ERROR | Operation gagal |
| Invariant domain dilanggar | ERROR | Unexpected system/data bug |
| Duplicate message berhasil diabaikan | INFO/WARN | INFO jika normal, WARN jika anomaly |
| Optional dependency unavailable tetapi fitur utama jalan | WARN | Degraded partial functionality |
| Request gagal karena bug internal | ERROR | User operation failed |
| Batch partial failure | WARN/ERROR | Tergantung threshold dan impact |
| Startup config fatal missing | ERROR | Service cannot run |

---

## 24. Event Name Design

Event name adalah identitas stabil dari log.

Tanpa event name, query bergantung pada free-text message.

Buruk:

```text
Failed to approve case
Could not approve case
Case approval failed
Approval failure
```

Sulit di-query konsisten.

Lebih baik:

```text
case.approval.failed
```

Pattern:

```text
<domain>.<entity>.<action>.<outcome>
<technical_area>.<operation>.<outcome>
<dependency>.<protocol>.<operation>.<outcome>
```

Contoh:

```text
application.submission.accepted
application.submission.rejected
case.assignment.created
case.state.transitioned
case.approval.failed
email.notification.sent
email.notification.failed
dependency.http.request.failed
dependency.database.query.slow
security.access.denied
audit.user.role.changed
batch.job.completed
message.dead_lettered
```

Guideline:

- lowercase.
- dot-separated.
- stable.
- tidak mengandung ID.
- tidak mengandung dynamic value.
- tidak terlalu generik seperti `error.occurred`.
- tidak terlalu spesifik seperti `case.approval.failed.for.user.fajar.on.tuesday`.

---

## 25. Message vs Event Name

Dalam logging tradisional, message adalah kalimat.

Dalam structured logging, message sering menjadi event name.

Dua style yang mungkin:

### 25.1 Event name as message

```java
log.atInfo()
   .setMessage("case.state.transitioned")
   .addKeyValue("case_id", caseId)
   .addKeyValue("from_state", from)
   .addKeyValue("to_state", to)
   .log();
```

Kelebihan:

- ringkas.
- mudah query.
- cocok untuk JSON logs.

Kekurangan:

- kurang human-friendly di console plain text.

### 25.2 Separate message and event.name

```java
log.atInfo()
   .setMessage("Case state transitioned")
   .addKeyValue("event.name", "case.state.transitioned")
   .addKeyValue("case_id", caseId)
   .addKeyValue("from_state", from)
   .addKeyValue("to_state", to)
   .log();
```

Kelebihan:

- human-friendly.
- machine-queryable.

Kekurangan:

- sedikit lebih verbose.

Rekomendasi enterprise:

```text
Gunakan event.name sebagai field eksplisit.
Message boleh human-readable, tetapi event.name harus stabil.
```

---

## 26. Log Field Design

Field menentukan apakah log bisa di-query.

Field wajib umum:

```text
timestamp
level
logger
thread
service.name
service.version
environment
event.name
correlation_id
trace_id
span_id
```

Field request:

```text
http.method
http.route
http.status_code
client.ip
user_agent category if needed
request_id
```

Field domain:

```text
case_id
application_id
license_id
agency_id
tenant_id
module
workflow_id
state
transition
```

Field dependency:

```text
dependency.name
dependency.type
operation
endpoint.route
status_code
duration_ms
retry_attempt
timeout_ms
```

Field error:

```text
error.type
error.code
error.message_safe
exception.stacktrace
root_cause.type
outcome
```

Field security:

```text
actor_id
actor_type
auth.method
client_id
source.ip
resource_type
resource_id
action
outcome
reason_code
```

---

## 27. Stable Field Names Matter

Buruk:

```text
userId
user_id
userid
uid
user
actor
actorId
```

Jika satu konsep punya banyak nama, query akan kacau.

Lebih baik tetapkan vocabulary:

```text
actor_id      -> identity performing action
subject_id    -> identity being acted upon
user_id       -> application user id if specifically user domain
case_id       -> case identifier
correlation_id -> business/request correlation id
trace_id      -> distributed trace id
```

Untuk observability skala besar, field naming adalah governance problem, bukan selera developer.

---

## 28. Cardinality: Musuh Tersembunyi Structured Logging

Cardinality adalah jumlah variasi nilai unik untuk sebuah field.

Low cardinality:

```text
environment = prod|uat|dev
level = INFO|WARN|ERROR
outcome = success|failure
module = case|appeal|application
```

High cardinality:

```text
user_id
case_id
request_id
trace_id
email
phone
raw_url
exception_message with dynamic ids
```

High cardinality tidak selalu salah. Untuk logs, ID unik sering perlu. Tetapi jangan gunakan high-cardinality field sembarangan untuk:

- metric labels,
- index-heavy fields,
- alert dimensions,
- dashboard grouping default.

Dalam logs, high-cardinality field harus:

- deliberate.
- useful for lookup.
- safe.
- not over-indexed unnecessarily.

Anti-pattern:

```java
log.info("event=request.completed path={} query={}", rawPath, rawQueryString);
```

Jika query string berisi dynamic values/token, cardinality dan security risk tinggi.

Lebih baik:

```java
log.info("event=request.completed route={} status={} duration_ms={}", routeTemplate, status, durationMs);
```

---

## 29. Outcome Field

Setiap operation log sebaiknya punya outcome eksplisit.

Contoh outcome:

```text
success
failure
partial_success
skipped
rejected
retried
fallback
ignored
duplicated
timeout
cancelled
```

Kenapa penting?

Karena free-text message sulit dihitung.

Buruk:

```text
Case approved
Case approval failed
Case approval skipped
```

Lebih baik:

```json
{"event.name":"case.approval.completed", "outcome":"success"}
{"event.name":"case.approval.completed", "outcome":"failure"}
{"event.name":"case.approval.completed", "outcome":"skipped"}
```

Atau pisah event name jika lebih ekspresif:

```text
case.approval.succeeded
case.approval.failed
case.approval.skipped
```

Keduanya bisa benar. Yang penting konsisten.

---

## 30. Reason Code

Reason code lebih baik daripada reason text bebas.

Buruk:

```text
reason="User not allowed to approve this case because role missing"
reason="No permission"
reason="Access denied"
reason="Missing CASE_APPROVE"
```

Lebih baik:

```text
reason_code="MISSING_PERMISSION"
required_permission="CASE_APPROVE"
```

Reason code membantu:

- grouping.
- alerting.
- analytics.
- support runbook.
- localization terpisah dari diagnostics.

Contoh:

```java
log.atWarn()
   .setMessage("case.approval.rejected")
   .addKeyValue("case_id", caseId)
   .addKeyValue("outcome", "rejected")
   .addKeyValue("reason_code", "MISSING_PERMISSION")
   .addKeyValue("required_permission", "CASE_APPROVE")
   .log();
```

---

## 31. Error Code vs Exception Type

Exception type menjelaskan kegagalan teknis.

Error code menjelaskan kategori masalah yang bisa dipahami sistem/support/user.

Contoh:

```text
error.type = java.sql.SQLTimeoutException
error.code = DEPENDENCY_DATABASE_TIMEOUT
```

Atau:

```text
error.type = com.company.domain.InvalidStateTransitionException
error.code = CASE_INVALID_STATE_TRANSITION
```

Keduanya berguna.

Exception type membantu engineer.

Error code membantu:

- support.
- alert grouping.
- API response mapping.
- runbook.
- dashboard.

---

## 32. Stack Trace: Kapan Harus Dicatat?

Stack trace mahal dan noisy, tetapi sangat berharga untuk unexpected failure.

Gunakan stack trace untuk:

- unexpected exception.
- invariant violation.
- failed operation yang tidak bisa dipulihkan.
- dependency failure setelah retry habis.
- startup failure.
- impossible state.

Tidak perlu stack trace untuk:

- normal validation error.
- expected not found.
- invalid login attempt tunggal.
- client disconnect biasa.
- duplicate request yang tertangani.
- retry attempt yang masih ongoing.

Buruk:

```java
try {
    validate(command);
} catch (ValidationException e) {
    log.error("Validation failed", e);
    throw e;
}
```

Jika validation failure adalah expected user behavior, ini bukan ERROR.

Lebih baik:

```java
try {
    validate(command);
} catch (ValidationException e) {
    log.atInfo()
       .setMessage("application.validation.rejected")
       .addKeyValue("application_id", command.applicationId())
       .addKeyValue("reason_code", e.reasonCode())
       .addKeyValue("correlation_id", correlationId)
       .log();
    throw e;
}
```

Untuk unexpected:

```java
try {
    approveCase(command);
} catch (RuntimeException e) {
    log.atError()
       .setMessage("case.approval.failed")
       .addKeyValue("case_id", command.caseId())
       .addKeyValue("correlation_id", correlationId)
       .addKeyValue("error.type", e.getClass().getName())
       .setCause(e)
       .log();
    throw e;
}
```

---

## 33. Stack Trace Once Rule

Jangan log exception berulang di setiap layer.

Buruk:

```java
// Repository
catch (SQLException e) {
    log.error("DB failed", e);
    throw new RepositoryException(e);
}

// Service
catch (RepositoryException e) {
    log.error("Service failed", e);
    throw new ApplicationException(e);
}

// Controller
catch (ApplicationException e) {
    log.error("Request failed", e);
    return error();
}
```

Hasilnya:

- stack trace triplicate.
- log volume besar.
- root cause tersamarkan.
- alert duplicate.

Lebih baik:

- lower layer menambahkan context via exception wrapping tanpa log, atau DEBUG jika benar-benar perlu.
- boundary layer log sekali dengan full context.

Pattern:

```java
// Repository
catch (SQLException e) {
    throw new RepositoryException("Failed to load case " + caseId, e);
}

// Service
catch (RepositoryException e) {
    throw new CaseApprovalException(caseId, "CASE_APPROVAL_DB_FAILURE", e);
}

// Boundary / controller / consumer
catch (CaseApprovalException e) {
    log.atError()
       .setMessage("case.approval.failed")
       .addKeyValue("case_id", e.caseId())
       .addKeyValue("error.code", e.errorCode())
       .addKeyValue("correlation_id", correlationId)
       .setCause(e)
       .log();
    throw e;
}
```

Rule:

> Log exception once at the boundary where enough context exists and the failure outcome is known.

---

## 34. Boundary Logging

Boundary adalah titik masuk/keluar sistem atau use case.

Contoh boundary:

- HTTP controller/filter.
- message consumer.
- scheduler job.
- batch job.
- CLI command.
- external callback handler.
- public service method dalam modular monolith.

Boundary cocok untuk log:

- request accepted/completed/failed.
- command accepted/completed/failed.
- message consumed/processed/failed.
- job started/completed/failed.

Contoh HTTP boundary:

```java
log.atInfo()
   .setMessage("http.request.completed")
   .addKeyValue("http.method", method)
   .addKeyValue("http.route", route)
   .addKeyValue("http.status_code", status)
   .addKeyValue("duration_ms", durationMs)
   .addKeyValue("correlation_id", correlationId)
   .addKeyValue("trace_id", traceId)
   .log();
```

Namun, untuk high-traffic services, request access logs bisa dipisah:

- access log pipeline.
- sampling.
- aggregation.
- trace-based sampling.

Jangan membuat application log banjir hanya untuk setiap request jika metrics/traces sudah cukup.

---

## 35. Internal Logging

Internal log berguna jika ada decision atau anomaly yang tidak terlihat dari boundary.

Contoh internal log yang valid:

- state transition rejected.
- cache stampede protection activated.
- retry scheduled.
- fallback selected.
- data inconsistency corrected.
- concurrency conflict detected.
- duplicate message ignored.

Internal log yang buruk:

```java
log.info("Entering service method");
log.info("Calling repository");
log.info("Mapping entity");
log.info("Returning result");
```

Ini biasanya diganti oleh:

- trace spans,
- profiler,
- DEBUG temporary logs,
- structured internal event only for meaningful branch.

---

## 36. Start/End Logs: Kapan Berguna?

Banyak codebase menulis:

```java
log.info("Start process X");
...
log.info("End process X");
```

Ini tidak selalu salah, tetapi sering inferior dibanding single completion event.

Daripada:

```text
Start approve case
End approve case
```

Lebih baik:

```text
case.approval.completed duration_ms=124 outcome=success
```

Start log berguna jika:

- operation long-running.
- ada kemungkinan hang.
- batch/job besar.
- async processing perlu heartbeat.
- incident perlu tahu operation sudah dimulai tapi belum selesai.

Untuk request pendek, completion log dengan duration biasanya cukup.

Pattern:

```java
long start = System.nanoTime();
try {
    process();
    log.atInfo()
       .setMessage("job.completed")
       .addKeyValue("job_id", jobId)
       .addKeyValue("duration_ms", elapsedMs(start))
       .addKeyValue("outcome", "success")
       .log();
} catch (Exception e) {
    log.atError()
       .setMessage("job.failed")
       .addKeyValue("job_id", jobId)
       .addKeyValue("duration_ms", elapsedMs(start))
       .addKeyValue("outcome", "failure")
       .setCause(e)
       .log();
    throw e;
}
```

---

## 37. Logging in Request/Response Systems

Untuk HTTP/gRPC service, pikirkan tiga layer:

```text
Access log
Application event log
Trace spans
```

Access log:

- setiap request.
- method.
- route.
- status.
- duration.
- client metadata.

Application event log:

- business/technical meaningful event.
- tidak harus setiap request.
- fokus ke outcome domain.

Trace:

- detail call tree.
- dependency duration.
- cross-service causality.

Jangan memaksa application log menjadi access log, metrics, dan trace sekaligus.

Contoh request completion:

```java
log.atInfo()
   .setMessage("http.request.completed")
   .addKeyValue("http.method", "POST")
   .addKeyValue("http.route", "/cases/{caseId}/approve")
   .addKeyValue("http.status_code", 200)
   .addKeyValue("duration_ms", 183)
   .addKeyValue("correlation_id", correlationId)
   .log();
```

Contoh domain event:

```java
log.atInfo()
   .setMessage("case.approval.succeeded")
   .addKeyValue("case_id", caseId)
   .addKeyValue("approval_level", approvalLevel)
   .addKeyValue("actor_type", actorType)
   .addKeyValue("correlation_id", correlationId)
   .log();
```

Keduanya berbeda.

---

## 38. Logging in Messaging Systems

Messaging punya tantangan:

- tidak ada request-response langsung.
- retry bisa menghasilkan log berulang.
- delivery bisa duplicate.
- event bisa out of order.
- DLQ perlu forensic evidence.

Minimum fields:

```text
queue/topic
consumer_group
message_id
correlation_id
causation_id
event_type
aggregate_id
attempt
outcome
duration_ms
```

Contoh:

```java
log.atError()
   .setMessage("message.processing.failed")
   .addKeyValue("queue", "case-events")
   .addKeyValue("message_id", messageId)
   .addKeyValue("event_type", eventType)
   .addKeyValue("aggregate_id", caseId)
   .addKeyValue("attempt", attempt)
   .addKeyValue("max_attempts", maxAttempts)
   .addKeyValue("outcome", "dead_lettered")
   .addKeyValue("correlation_id", correlationId)
   .setCause(ex)
   .log();
```

Rule:

> Untuk async processing, log harus membawa identitas pesan dan identitas domain. Salah satu saja tidak cukup.

---

## 39. Logging in Batch Systems

Batch log harus menjawab:

- job apa?
- execution id apa?
- input scope apa?
- berapa record diproses?
- berapa sukses/gagal/skip?
- chunk mana yang gagal?
- apakah retry?
- apakah partial commit?
- apakah job restartable?

Contoh:

```java
log.atInfo()
   .setMessage("batch.chunk.completed")
   .addKeyValue("job_name", jobName)
   .addKeyValue("execution_id", executionId)
   .addKeyValue("chunk_index", chunkIndex)
   .addKeyValue("read_count", readCount)
   .addKeyValue("write_count", writeCount)
   .addKeyValue("skip_count", skipCount)
   .addKeyValue("duration_ms", durationMs)
   .log();
```

Batch anti-pattern:

```java
for (Record r : records) {
    log.info("Processing record {}", r.id());
}
```

Jika record jutaan, ini bisa menghancurkan log pipeline.

Lebih baik:

- per chunk summary.
- per failed record only.
- sampled debug for successful records.
- output reconciliation file/table jika perlu.

---

## 40. Logging in State Machine / Workflow Systems

Untuk workflow/case/process systems, log harus merekam:

- process instance id.
- state/activity.
- transition.
- actor/system trigger.
- guard condition outcome.
- external task result.
- timer event.
- compensation.
- escalation.

Contoh:

```java
log.atInfo()
   .setMessage("workflow.transition.executed")
   .addKeyValue("workflow_name", "case-review")
   .addKeyValue("process_instance_id", processInstanceId)
   .addKeyValue("business_key", caseId)
   .addKeyValue("from_activity", fromActivity)
   .addKeyValue("to_activity", toActivity)
   .addKeyValue("transition", transition)
   .addKeyValue("trigger_type", triggerType)
   .addKeyValue("correlation_id", correlationId)
   .log();
```

Untuk regulatory workflow, ini sangat berharga karena banyak dispute bukan “code error”, tetapi “kenapa case ini sampai ke state itu?”.

---

## 41. Logging in Scheduled Jobs

Scheduler sering menghasilkan bug tersembunyi:

- job tidak jalan.
- job jalan dua kali.
- job overlap.
- job tertinggal.
- job jalan di node yang salah.
- distributed lock gagal.
- timezone salah.

Minimum fields:

```text
job_name
scheduled_time
actual_start_time
node_id
lock_owner
lock_acquired
execution_id
outcome
duration_ms
```

Contoh:

```java
log.atWarn()
   .setMessage("scheduler.execution.skipped")
   .addKeyValue("job_name", "daily-reconciliation")
   .addKeyValue("reason_code", "LOCK_NOT_ACQUIRED")
   .addKeyValue("node_id", nodeId)
   .addKeyValue("scheduled_time", scheduledTime)
   .log();
```

---

## 42. Logging Retries

Retry logging sering salah.

Buruk:

```java
log.error("Failed", e);
retry();
```

Jika retry masih berjalan, itu belum final failure.

Lebih baik:

```java
log.atWarn()
   .setMessage("dependency.retry.scheduled")
   .addKeyValue("dependency.name", dependency)
   .addKeyValue("operation", operation)
   .addKeyValue("attempt", attempt)
   .addKeyValue("max_attempts", maxAttempts)
   .addKeyValue("delay_ms", delayMs)
   .addKeyValue("error.type", ex.getClass().getSimpleName())
   .log();
```

Final failure:

```java
log.atError()
   .setMessage("dependency.operation.failed")
   .addKeyValue("dependency.name", dependency)
   .addKeyValue("operation", operation)
   .addKeyValue("attempts", maxAttempts)
   .addKeyValue("outcome", "failure")
   .setCause(ex)
   .log();
```

Rule:

```text
Retry attempt = WARN/DEBUG
Retry exhausted = ERROR
Retry success after attempts = INFO/WARN depending on importance
```

---

## 43. Logging Timeouts

Timeout bukan satu jenis error.

Bedakan:

```text
connect_timeout
read_timeout
write_timeout
connection_pool_timeout
total_deadline_exceeded
lock_timeout
transaction_timeout
queue_poll_timeout
```

Contoh:

```java
log.atError()
   .setMessage("dependency.timeout")
   .addKeyValue("dependency.name", "document-service")
   .addKeyValue("operation", "upload")
   .addKeyValue("timeout.type", "read_timeout")
   .addKeyValue("timeout_ms", 30000)
   .addKeyValue("duration_ms", durationMs)
   .addKeyValue("correlation_id", correlationId)
   .setCause(ex)
   .log();
```

Mengapa detail timeout penting?

Karena mitigasinya berbeda:

- connect timeout: network/routing/service unavailable.
- read timeout: dependency slow/hung.
- pool timeout: local resource exhaustion.
- total deadline: budget tidak cukup atau retry terlalu agresif.
- lock timeout: contention/data conflict.

---

## 44. Logging Partial Failure

Partial failure umum di enterprise systems:

- DB update sukses, email gagal.
- case created, notification pending.
- batch sebagian sukses.
- file uploaded, metadata update gagal.
- external sync sebagian gagal.

Jangan log sebagai sukses total.

Contoh:

```java
log.atWarn()
   .setMessage("case.creation.completed")
   .addKeyValue("case_id", caseId)
   .addKeyValue("outcome", "partial_success")
   .addKeyValue("failed_step", "email_notification")
   .addKeyValue("compensation_required", true)
   .addKeyValue("correlation_id", correlationId)
   .log();
```

Partial failure harus terlihat jelas karena sering menjadi sumber inconsistency.

---

## 45. Logging Idempotency

Untuk API atau message consumer yang idempotent, log harus membedakan:

```text
new execution
replayed request ignored
replayed request returned previous result
duplicate message ignored
conflicting idempotency key
```

Contoh:

```java
log.atInfo()
   .setMessage("idempotency.duplicate.detected")
   .addKeyValue("idempotency_key", safeHash(idempotencyKey))
   .addKeyValue("operation", "case.submit")
   .addKeyValue("outcome", "previous_result_returned")
   .addKeyValue("correlation_id", correlationId)
   .log();
```

Jangan log raw idempotency key jika dianggap secret-like atau user-controlled. Hash bisa lebih aman.

---

## 46. Logging Data Validation

Validation log harus diperlakukan hati-hati.

Expected validation failure:

```java
log.atInfo()
   .setMessage("application.validation.rejected")
   .addKeyValue("application_id", applicationId)
   .addKeyValue("rule_code", ruleCode)
   .addKeyValue("field", fieldName)
   .addKeyValue("outcome", "rejected")
   .log();
```

Unexpected validation system bug:

```java
log.atError()
   .setMessage("validation.rule.execution.failed")
   .addKeyValue("rule_code", ruleCode)
   .addKeyValue("application_id", applicationId)
   .setCause(ex)
   .log();
```

Jangan log raw field value jika mengandung PII.

Misalnya:

```text
email, phone, NRIC, passport, address, DOB, bank account
```

Gunakan:

- field name,
- rule code,
- masked value jika benar-benar perlu,
- hash jika perlu korelasi tanpa membuka nilai.

---

## 47. Logging Authorization Failure

Authorization failure tidak selalu ERROR.

Jika user mencoba resource tanpa permission:

- bisa `WARN` jika mencurigakan atau policy violation.
- bisa `INFO` jika normal business rejection.

Contoh:

```java
log.atWarn()
   .setMessage("authorization.denied")
   .addKeyValue("actor_id", actorId)
   .addKeyValue("resource_type", "case")
   .addKeyValue("resource_id", caseId)
   .addKeyValue("required_permission", "CASE_APPROVE")
   .addKeyValue("outcome", "denied")
   .addKeyValue("correlation_id", correlationId)
   .log();
```

Jangan log:

- token.
- raw claims penuh.
- session cookie.
- secret client credential.

---

## 48. Logging Authentication Failure

Authentication log perlu security-friendly.

Contoh:

```java
log.atWarn()
   .setMessage("authentication.failed")
   .addKeyValue("auth.method", "oidc")
   .addKeyValue("client_id", clientId)
   .addKeyValue("reason_code", "INVALID_SIGNATURE")
   .addKeyValue("source.ip", clientIp)
   .addKeyValue("correlation_id", correlationId)
   .log();
```

Jangan log:

- password.
- OTP.
- token.
- full authorization header.
- raw SAML assertion/JWT.
- private key.

Untuk JWT, jika perlu:

- log `kid`.
- log issuer.
- log audience.
- log token hash.
- log expiry delta.
- jangan log token raw.

---

## 49. Logging Request and Response Body

Default rule:

> Jangan log full request/response body di production.

Boleh dipertimbangkan hanya jika:

- payload tidak sensitif.
- ukurannya dibatasi.
- redaction kuat.
- sampling jelas.
- retention pendek.
- akses dibatasi.
- ada business/legal reason.

Alternatif:

- log schema version.
- log payload hash.
- log size.
- log selected non-sensitive fields.
- log validation error field names.
- simpan payload di secure audit store jika memang dibutuhkan.

Contoh aman:

```java
log.atDebug()
   .setMessage("request.payload.summary")
   .addKeyValue("payload.schema", schemaName)
   .addKeyValue("payload.version", schemaVersion)
   .addKeyValue("payload.size_bytes", sizeBytes)
   .addKeyValue("payload.hash", sha256(payload))
   .log();
```

---

## 50. Log Injection and Forging

Jika user input masuk ke log tanpa sanitasi, attacker bisa membuat log palsu.

Contoh input:

```text
hello\nERROR user admin logged in
```

Jika langsung dicetak di plain text log, timeline bisa kacau.

Mitigasi:

- structured JSON logging.
- escape newline/control characters.
- sanitize user-controlled fields.
- limit length.
- never concatenate raw user input into log message.
- use fields, not free text.

Buruk:

```java
log.warn("Invalid username: " + username);
```

Lebih baik:

```java
log.atWarn()
   .setMessage("authentication.failed")
   .addKeyValue("username_hash", sha256(normalize(username)))
   .addKeyValue("reason_code", "INVALID_CREDENTIAL")
   .log();
```

---

## 51. PII and Secret Redaction

Data yang sebaiknya tidak masuk log:

```text
password
OTP
access token
refresh token
authorization header
cookie
session id
private key
API key
client secret
credit card
bank account
national identifier
passport number
full address
medical data
biometric data
raw identity provider payload
```

Teknik:

### 51.1 Masking

```text
email = f***@example.com
phone = ******1234
```

### 51.2 Hashing

```text
user_hash = sha256(normalizedUserId + salt)
```

### 51.3 Tokenization

Simpan mapping di secure store, log token referensi.

### 51.4 Redaction

```text
authorization = [REDACTED]
```

### 51.5 Field omission

Tidak dicatat sama sekali.

Rule:

> Data yang tidak ada di log tidak bisa bocor dari log.

---

## 52. Log Volume and Noise Budget

Setiap log punya biaya:

- CPU.
- allocation.
- serialization.
- IO.
- network.
- storage.
- indexing.
- query cost.
- analyst attention.
- alert fatigue.

Noise budget harus dipikirkan.

Guideline:

```text
ERROR: harus actionable.
WARN: harus abnormal/degraded.
INFO: harus meaningful lifecycle/business/operational event.
DEBUG: investigation detail.
TRACE: deep internal path.
```

Jika sebuah log tidak berguna dalam:

- incident,
- support,
- audit,
- security,
- performance diagnosis,
- business reconciliation,

maka hapus atau turunkan level.

---

## 53. Sampling Logs

Sampling log berguna untuk high-volume events.

Contoh use case:

- request success logs.
- cache hit logs.
- repeated validation failures.
- repeated dependency timeout same root cause.
- noisy client error.

Sampling harus hati-hati untuk:

- ERROR.
- security event.
- audit event.
- rare anomaly.

Jangan sampling audit log jika audit completeness diperlukan.

Sampling strategy:

```text
sample success
keep all failures
keep all security events above threshold
keep all audit events
sample repeated identical warnings with counters
```

Example conceptual:

```java
if (sampler.shouldLog("cache.hit", cacheKeyHash)) {
    log.debug("event=cache.hit cache={} key_hash={}", cacheName, cacheKeyHash);
}
```

---

## 54. Deduplication and Rate-Limited Logging

Repeated errors bisa membanjiri log.

Contoh:

```text
dependency down -> 10,000 ERROR/minute
```

Solusi:

- rate-limited logging.
- aggregate logging.
- circuit breaker state logs.
- metrics for count.
- one ERROR for state transition to open.
- WARN summary every window.

Contoh event design:

```text
circuit_breaker.opened dependency=payment
circuit_breaker.call_blocked dependency=payment count=1024 window=1m
circuit_breaker.half_opened dependency=payment
circuit_breaker.closed dependency=payment
```

Lebih baik daripada log setiap failed call secara penuh.

---

## 55. Log Once Per Meaningful Outcome

Misalnya operation punya 5 internal steps.

Buruk:

```text
step1 ok
step2 ok
step3 ok
step4 ok
step5 ok
operation ok
```

Lebih baik:

```text
operation.completed outcome=success duration_ms=... important_counts=...
```

Kecuali step tertentu punya nilai diagnosis sendiri:

```text
operation.fallback.used
operation.compensation.started
operation.external_sync.failed
```

Rule:

> Jangan log setiap step; log decision, boundary, anomaly, transition, and outcome.

---

## 56. Log Schema Examples

### 56.1 Application success event

```json
{
  "timestamp": "2026-06-18T10:00:00.000Z",
  "level": "INFO",
  "event.name": "case.approval.succeeded",
  "service.name": "case-service",
  "environment": "prod",
  "module": "case-management",
  "case_id": "CASE-2026-123",
  "actor_type": "officer",
  "outcome": "success",
  "correlation_id": "corr-abc",
  "trace_id": "trace-xyz"
}
```

### 56.2 Dependency failure

```json
{
  "timestamp": "2026-06-18T10:01:00.000Z",
  "level": "ERROR",
  "event.name": "dependency.http.request.failed",
  "dependency.name": "identity-provider",
  "operation": "token.introspect",
  "http.status_code": 503,
  "duration_ms": 30000,
  "retry_attempts": 3,
  "error.type": "java.net.SocketTimeoutException",
  "outcome": "failure",
  "correlation_id": "corr-abc",
  "trace_id": "trace-xyz"
}
```

### 56.3 Security event

```json
{
  "timestamp": "2026-06-18T10:02:00.000Z",
  "level": "WARN",
  "event.name": "security.access.denied",
  "actor_id": "user-123",
  "actor_type": "external_user",
  "resource_type": "case",
  "resource_id": "CASE-2026-123",
  "required_permission": "CASE_VIEW",
  "outcome": "denied",
  "reason_code": "MISSING_PERMISSION",
  "correlation_id": "corr-abc"
}
```

---

## 57. Code Examples: Bad vs Good

### 57.1 Bad: vague log

```java
log.error("Failed");
```

Good:

```java
log.atError()
   .setMessage("case.assignment.failed")
   .addKeyValue("case_id", caseId)
   .addKeyValue("assignee_id", assigneeId)
   .addKeyValue("reason_code", "ASSIGNEE_NOT_AVAILABLE")
   .addKeyValue("correlation_id", correlationId)
   .setCause(ex)
   .log();
```

### 57.2 Bad: exception logged without context

```java
log.error("Exception", e);
```

Good:

```java
log.atError()
   .setMessage("document.rendering.failed")
   .addKeyValue("template_id", templateId)
   .addKeyValue("document_type", documentType)
   .addKeyValue("case_id", caseId)
   .addKeyValue("error.type", e.getClass().getName())
   .setCause(e)
   .log();
```

### 57.3 Bad: secret leak

```java
log.info("Calling API with token {}", accessToken);
```

Good:

```java
log.atDebug()
   .setMessage("dependency.http.request.started")
   .addKeyValue("dependency.name", "external-api")
   .addKeyValue("operation", "lookup")
   .addKeyValue("auth.method", "bearer")
   .log();
```

### 57.4 Bad: full payload

```java
log.debug("Request body: {}", requestBody);
```

Good:

```java
log.atDebug()
   .setMessage("request.payload.received")
   .addKeyValue("payload.size_bytes", payloadSize)
   .addKeyValue("payload.schema", schemaName)
   .addKeyValue("payload.hash", payloadHash)
   .log();
```

### 57.5 Bad: log at every internal step

```java
log.info("Start validation");
log.info("Start mapping");
log.info("Start saving");
log.info("Start notification");
```

Good:

```java
log.atInfo()
   .setMessage("application.submission.completed")
   .addKeyValue("application_id", applicationId)
   .addKeyValue("validation_result", "passed")
   .addKeyValue("notification_queued", true)
   .addKeyValue("duration_ms", durationMs)
   .addKeyValue("outcome", "success")
   .log();
```

---

## 58. Designing Logs from Use Case

Ambil use case:

```text
Officer approves case.
System validates state.
System persists approval.
System emits event.
System sends notification.
```

Jangan langsung menulis log di semua line.

Desain evidence:

### 58.1 Boundary event

```text
case.approval.requested
case.approval.completed
case.approval.failed
```

### 58.2 State event

```text
case.state.transitioned
```

### 58.3 Dependency event

```text
notification.email.queued
notification.email.failed
```

### 58.4 Security/audit event

```text
audit.case.approved
authorization.denied
```

### 58.5 Metrics/traces instead of logs

- duration per DB query -> trace/metrics.
- every internal method -> trace/profiler if needed.
- count approvals -> metric.

Result: fewer logs, better evidence.

---

## 59. Example: Case Approval Logging Design

```java
public ApprovalResult approveCase(ApproveCaseCommand command) {
    long startNanos = System.nanoTime();

    try {
        authorizationService.requirePermission(command.actorId(), "CASE_APPROVE", command.caseId());

        Case current = caseRepository.getForUpdate(command.caseId());
        CaseStatus previous = current.status();

        current.approve(command.actorId(), command.reason());
        caseRepository.save(current);

        eventPublisher.publish(new CaseApprovedEvent(current.id(), command.actorId()));

        auditLogger.caseApproved(command.actorId(), current.id(), previous, current.status());

        log.atInfo()
           .setMessage("case.approval.succeeded")
           .addKeyValue("case_id", current.id())
           .addKeyValue("from_state", previous)
           .addKeyValue("to_state", current.status())
           .addKeyValue("actor_type", command.actorType())
           .addKeyValue("duration_ms", elapsedMs(startNanos))
           .addKeyValue("outcome", "success")
           .addKeyValue("correlation_id", command.correlationId())
           .log();

        return ApprovalResult.success(current.id());
    } catch (AccessDeniedException e) {
        log.atWarn()
           .setMessage("case.approval.denied")
           .addKeyValue("case_id", command.caseId())
           .addKeyValue("actor_id", command.actorId())
           .addKeyValue("required_permission", "CASE_APPROVE")
           .addKeyValue("reason_code", "MISSING_PERMISSION")
           .addKeyValue("duration_ms", elapsedMs(startNanos))
           .addKeyValue("outcome", "denied")
           .addKeyValue("correlation_id", command.correlationId())
           .log();
        throw e;
    } catch (InvalidStateTransitionException e) {
        log.atWarn()
           .setMessage("case.approval.rejected")
           .addKeyValue("case_id", command.caseId())
           .addKeyValue("from_state", e.currentState())
           .addKeyValue("expected_state", "UNDER_REVIEW")
           .addKeyValue("reason_code", "INVALID_STATE")
           .addKeyValue("duration_ms", elapsedMs(startNanos))
           .addKeyValue("outcome", "rejected")
           .addKeyValue("correlation_id", command.correlationId())
           .log();
        throw e;
    } catch (Exception e) {
        log.atError()
           .setMessage("case.approval.failed")
           .addKeyValue("case_id", command.caseId())
           .addKeyValue("duration_ms", elapsedMs(startNanos))
           .addKeyValue("outcome", "failure")
           .addKeyValue("error.type", e.getClass().getName())
           .addKeyValue("correlation_id", command.correlationId())
           .setCause(e)
           .log();
        throw e;
    }
}
```

Catatan:

- Access denied bukan `ERROR` karena sistem bekerja sesuai policy.
- Invalid state bisa `WARN` karena abnormal untuk request tersebut tetapi bukan bug selalu.
- Unexpected exception `ERROR` dengan stack trace.
- Success `INFO` karena domain event penting.
- Audit dilakukan melalui audit logger/store terpisah.

---

## 60. Dedicated Audit Logger Pattern

Jangan campur audit event sembarangan dengan diagnostic logger.

Contoh:

```java
public final class AuditLogger {
    private static final Logger AUDIT = LoggerFactory.getLogger("AUDIT");

    public void caseApproved(String actorId, String caseId, String from, String to) {
        AUDIT.atInfo()
             .setMessage("audit.case.approved")
             .addKeyValue("actor_id", actorId)
             .addKeyValue("resource_type", "case")
             .addKeyValue("resource_id", caseId)
             .addKeyValue("action", "approve")
             .addKeyValue("from_state", from)
             .addKeyValue("to_state", to)
             .addKeyValue("outcome", "success")
             .log();
    }
}
```

Dengan logger name khusus, backend bisa route ke:

- audit file.
- audit index.
- secure sink.
- immutable store.
- SIEM.

Tetapi ingat: audit yang benar sering butuh lebih dari log file.

---

## 61. Dedicated Security Logger Pattern

```java
public final class SecurityEventLogger {
    private static final Logger SECURITY = LoggerFactory.getLogger("SECURITY");

    public void accessDenied(SecurityContext ctx, String resourceType, String resourceId, String permission) {
        SECURITY.atWarn()
                .setMessage("security.access.denied")
                .addKeyValue("actor_id", ctx.safeActorId())
                .addKeyValue("actor_type", ctx.actorType())
                .addKeyValue("resource_type", resourceType)
                .addKeyValue("resource_id", resourceId)
                .addKeyValue("required_permission", permission)
                .addKeyValue("source.ip", ctx.safeSourceIp())
                .addKeyValue("outcome", "denied")
                .log();
    }
}
```

Keuntungan:

- schema konsisten.
- redaction centralized.
- routing mudah.
- policy lebih mudah diaudit.

---

## 62. Event Taxonomy for Enterprise Java Systems

Contoh taxonomy untuk regulatory/case management platform:

```text
application.submission.started
application.submission.accepted
application.submission.rejected
application.validation.failed
application.payment.required
application.payment.completed

case.created
case.assigned
case.reassigned
case.state.transitioned
case.review.started
case.review.completed
case.approval.succeeded
case.approval.failed
case.rejection.issued
case.escalated
case.closed

appeal.created
appeal.submitted
appeal.review.started
appeal.decision.issued

compliance.inspection.scheduled
compliance.inspection.completed
compliance.violation.detected
compliance.notice.issued

enforcement.action.initiated
enforcement.notice.generated
enforcement.penalty.imposed

notification.email.queued
notification.email.sent
notification.email.failed
notification.sms.failed

document.generated
document.rendering.failed
document.upload.rejected

dependency.http.request.failed
dependency.database.query.slow
dependency.cache.unavailable

authentication.failed
authorization.denied
security.rate_limit.exceeded

audit.user.role.changed
audit.case.status.changed
audit.document.downloaded
```

Taxonomy seperti ini harus dikelola seperti API contract.

---

## 63. Logging Policy by Category

| Category | Default Level | Stack Trace | Retention | Notes |
|---|---:|---:|---:|---|
| Diagnostic normal | DEBUG/INFO | No | Short/medium | Untuk engineering investigation |
| Operational lifecycle | INFO | No | Medium | Startup/shutdown/config safe summary |
| Business event | INFO | No | Medium/long | Jangan jadi audit substitute |
| Audit event | INFO | No, usually | Long | Append-only, access controlled |
| Security event | WARN/INFO | Sometimes | Long | No secret/PII leak |
| Dependency failure | WARN/ERROR | On final failure | Medium | Include dependency/operation/duration |
| State transition | INFO/WARN | No | Medium/long | Critical for workflow systems |
| Unexpected exception | ERROR | Yes | Medium | Log once at boundary |
| Performance anomaly | WARN | No/optional | Short/medium | Use metrics/traces too |
| Batch summary | INFO/WARN/ERROR | On job failure | Medium | Include counts and execution id |

---

## 64. Logging Review Checklist

Saat code review, tanyakan:

1. Apakah log ini punya event name jelas?
2. Apakah level-nya benar?
3. Apakah log ini actionable?
4. Apakah field cukup untuk korelasi?
5. Apakah ada correlation id/trace id?
6. Apakah ada entity id yang aman?
7. Apakah ada outcome?
8. Apakah ada reason code/error code?
9. Apakah exception dilog sekali saja?
10. Apakah ada PII/secret?
11. Apakah volume log aman?
12. Apakah event ini lebih cocok jadi metric/trace/audit store?
13. Apakah field naming konsisten?
14. Apakah dynamic data masuk event name/message?
15. Apakah log tetap murah saat disabled?
16. Apakah log berguna jika dibaca 3 bulan dari sekarang?

---

## 65. Common Anti-Patterns

### 65.1 Log-and-throw everywhere

Akibat:

- duplicate stack trace.
- noisy alert.
- root cause sulit dibaca.

### 65.2 Catch and log without action

```java
catch (Exception e) {
    log.error("Failed", e);
}
```

Akibat:

- error disembunyikan.
- caller menganggap sukses.
- data inconsistency.

### 65.3 INFO spam

```java
log.info("inside loop {}", i);
```

Akibat:

- storage mahal.
- signal tenggelam.
- performance turun.

### 65.4 Sensitive data logging

```java
log.info("token={}", token);
```

Akibat:

- credential leak.
- compliance incident.

### 65.5 Vague logs

```java
log.warn("Invalid");
```

Akibat:

- tidak bisa diagnosis.

### 65.6 Dynamic event name

```java
log.info("case.{}.completed", caseId);
```

Akibat:

- query impossible.
- cardinality kacau.

### 65.7 Logging instead of metrics

```java
log.info("queue size is {}", queueSize);
```

Untuk continuous numeric state, gunakan metric.

### 65.8 Logging instead of trace

```java
log.info("calling service A");
log.info("calling service B");
log.info("calling service C");
```

Gunakan trace spans untuk call tree.

### 65.9 Logging full object graph

```java
log.debug("case={}", caseEntity);
```

Akibat:

- PII leak.
- lazy loading surprise.
- huge log.
- recursive `toString()`.

---

## 66. Java 8 to Java 25 Considerations

### 66.1 Java 8

Banyak sistem Java 8 masih menggunakan:

- SLF4J 1.x.
- Logback 1.2.x.
- Log4j2 older versions.
- manual MDC propagation.
- platform thread pools.

Semantics tetap sama, tetapi API structured/key-value lebih terbatas.

Fallback:

```java
log.info("event=case.approval.succeeded case_id={} outcome={} correlation_id={}",
    caseId, "success", correlationId);
```

### 66.2 Java 11/17

Umumnya mulai menggunakan:

- newer Spring Boot.
- better container awareness.
- JFR lebih mudah dipakai.
- OTel agent umum.
- JSON logging pipeline lebih matang.

### 66.3 Java 21+

Virtual threads mengubah beberapa asumsi:

- Thread name kurang stabil sebagai request identity.
- MDC berbasis ThreadLocal masih bisa, tetapi propagation harus dipahami.
- Jangan bergantung pada thread pool identity sebagai business context.
- Structured concurrency dan scoped context mulai relevan.

### 66.4 Java 25

Arah modern makin menekankan:

- structured concurrency.
- scoped values.
- virtual-thread-friendly context.
- JFR/JDK observability yang lebih kuat.

Namun log semantics tidak berubah:

> Event tetap harus jelas, aman, terstruktur, dan bisa dikorelasikan.

---

## 67. Practical Lab 1 — Refactor Noisy Logs

Kode awal:

```java
public void submit(Application app) {
    log.info("Start submit");
    log.info("App: {}", app);

    try {
        log.info("Validating");
        validator.validate(app);

        log.info("Saving");
        repository.save(app);

        log.info("Sending email");
        emailService.sendSubmittedEmail(app.getApplicantEmail());

        log.info("Done");
    } catch (Exception e) {
        log.error("Failed", e);
        throw e;
    }
}
```

Masalah:

- `app` full object bisa leak PII.
- INFO spam.
- Tidak ada event name.
- Tidak ada duration.
- Tidak ada outcome.
- Tidak ada reason/error code.
- Semua failure sama.

Refactor:

```java
public void submit(Application app, String correlationId) {
    long start = System.nanoTime();

    try {
        validator.validate(app);
        repository.save(app);
        emailService.sendSubmittedEmail(app.getId());

        log.atInfo()
           .setMessage("application.submission.completed")
           .addKeyValue("application_id", app.getId())
           .addKeyValue("outcome", "success")
           .addKeyValue("duration_ms", elapsedMs(start))
           .addKeyValue("correlation_id", correlationId)
           .log();
    } catch (ValidationException e) {
        log.atInfo()
           .setMessage("application.submission.rejected")
           .addKeyValue("application_id", app.getId())
           .addKeyValue("outcome", "rejected")
           .addKeyValue("reason_code", e.reasonCode())
           .addKeyValue("duration_ms", elapsedMs(start))
           .addKeyValue("correlation_id", correlationId)
           .log();
        throw e;
    } catch (EmailException e) {
        log.atWarn()
           .setMessage("application.submission.completed")
           .addKeyValue("application_id", app.getId())
           .addKeyValue("outcome", "partial_success")
           .addKeyValue("failed_step", "email_notification")
           .addKeyValue("duration_ms", elapsedMs(start))
           .addKeyValue("correlation_id", correlationId)
           .setCause(e)
           .log();
        throw e;
    } catch (Exception e) {
        log.atError()
           .setMessage("application.submission.failed")
           .addKeyValue("application_id", app.getId())
           .addKeyValue("outcome", "failure")
           .addKeyValue("error.type", e.getClass().getName())
           .addKeyValue("duration_ms", elapsedMs(start))
           .addKeyValue("correlation_id", correlationId)
           .setCause(e)
           .log();
        throw e;
    }
}
```

---

## 68. Practical Lab 2 — Design Log Events for a Scheduler

Scenario:

```text
Daily reconciliation job runs at 02:00.
It reads transactions from DB.
It calls external payment API.
It writes reconciliation result.
It sends summary email.
It must not overlap across nodes.
```

Required event names:

```text
scheduler.execution.started
scheduler.execution.skipped
reconciliation.job.completed
reconciliation.job.failed
dependency.http.request.failed
reconciliation.record.failed
notification.email.failed
```

Required fields:

```text
job_name
execution_id
node_id
lock_acquired
scheduled_time
actual_start_time
processed_count
matched_count
mismatched_count
failed_count
duration_ms
outcome
correlation_id
```

Design principle:

- Log job start and completion.
- Log chunk/summary, not every success record.
- Log every failed record only with safe identifiers.
- Use metrics for counts over time.
- Use trace for dependency latency.

---

## 69. Practical Lab 3 — Create Event Dictionary

Create a file:

```text
observability/event-dictionary.md
```

Example:

| Event Name | Category | Level | Required Fields | Description |
|---|---|---:|---|---|
| `case.approval.succeeded` | business | INFO | `case_id`, `actor_type`, `duration_ms`, `outcome` | Case approval completed |
| `case.approval.failed` | diagnostic | ERROR | `case_id`, `error.type`, `duration_ms`, `correlation_id` | Case approval failed unexpectedly |
| `authorization.denied` | security | WARN | `actor_id`, `resource_type`, `resource_id`, `required_permission` | Actor denied access |
| `dependency.http.request.failed` | dependency | WARN/ERROR | `dependency.name`, `operation`, `duration_ms`, `error.type` | External HTTP request failed |

This dictionary becomes a team contract.

---

## 70. Practical Lab 4 — Logging Code Review Exercise

Review this code:

```java
try {
    String token = request.getHeader("Authorization");
    log.info("Token {}", token);

    User user = authService.authenticate(token);
    log.info("User {} authenticated", user);

    caseService.approve(request.getCaseId(), user);
    log.info("Approved");
} catch (Exception e) {
    log.error("Error", e);
}
```

Find issues:

1. Token leak.
2. Full user object leak.
3. Vague approved log.
4. Catch swallows exception.
5. No correlation id.
6. No case id in failure.
7. No error taxonomy.
8. No authorization distinction.
9. No outcome.
10. No duration.

Better:

```java
long start = System.nanoTime();
String correlationId = correlation.currentId();

try {
    User user = authService.authenticate(request.bearerToken());
    caseService.approve(request.getCaseId(), user);

    log.atInfo()
       .setMessage("case.approval.succeeded")
       .addKeyValue("case_id", request.getCaseId())
       .addKeyValue("actor_id", user.safeId())
       .addKeyValue("outcome", "success")
       .addKeyValue("duration_ms", elapsedMs(start))
       .addKeyValue("correlation_id", correlationId)
       .log();
} catch (AuthenticationException e) {
    log.atWarn()
       .setMessage("authentication.failed")
       .addKeyValue("reason_code", e.reasonCode())
       .addKeyValue("outcome", "denied")
       .addKeyValue("duration_ms", elapsedMs(start))
       .addKeyValue("correlation_id", correlationId)
       .log();
    throw e;
} catch (AccessDeniedException e) {
    log.atWarn()
       .setMessage("case.approval.denied")
       .addKeyValue("case_id", request.getCaseId())
       .addKeyValue("reason_code", "MISSING_PERMISSION")
       .addKeyValue("outcome", "denied")
       .addKeyValue("duration_ms", elapsedMs(start))
       .addKeyValue("correlation_id", correlationId)
       .log();
    throw e;
} catch (Exception e) {
    log.atError()
       .setMessage("case.approval.failed")
       .addKeyValue("case_id", request.getCaseId())
       .addKeyValue("outcome", "failure")
       .addKeyValue("error.type", e.getClass().getName())
       .addKeyValue("duration_ms", elapsedMs(start))
       .addKeyValue("correlation_id", correlationId)
       .setCause(e)
       .log();
    throw e;
}
```

---

## 71. Production Logging Standard Draft

A mature Java service should follow these rules:

1. Every production log must represent a meaningful event.
2. Every event should have a stable `event.name`.
3. Every boundary failure should include `correlation_id` and preferably `trace_id`.
4. Unexpected failures should log stack trace once at boundary.
5. Expected user errors should not be logged as ERROR.
6. Retry attempts should not be logged as ERROR unless exhausted.
7. Security and audit events should use dedicated schemas.
8. No password, token, secret, raw cookie, or sensitive identity payload may be logged.
9. Request/response body logging is disabled by default.
10. Full object logging is prohibited unless object is explicitly safe and bounded.
11. State transitions must include from/to state.
12. Dependency failures must include dependency name, operation, duration, and failure type.
13. Batch logs must summarize counts and failed records, not every success record.
14. Scheduler logs must include execution id, scheduled time, actual start, and node id.
15. Logs should complement metrics and traces, not replace them.

---

## 72. Mental Model Summary

Think of logging as a design discipline:

```text
Use case
  -> runtime events
    -> event names
      -> category
        -> severity level
          -> required fields
            -> security classification
              -> destination/retention
                -> alert/query/runbook
```

A top-tier engineer does not ask only:

```text
Where should I put log.info?
```

They ask:

```text
What future investigation will need evidence from this execution?
```

That is the difference between logging and diagnosability engineering.

---

## 73. Key Takeaways

1. Log is runtime evidence, not free-text print.
2. Event name is more important than clever message wording.
3. Level must reflect severity and operational actionability.
4. Expected failure is not automatically ERROR.
5. Stack trace should usually be logged once at the right boundary.
6. Business, audit, security, diagnostic, and dependency logs have different semantics.
7. Structured fields make logs queryable.
8. Cardinality and sensitive data must be controlled.
9. Logging must complement traces, metrics, JFR, and profiles.
10. The best logs are designed from use cases and failure modes.

---

## 74. What Comes Next

Part 3 established what should be logged and why.

Next:

```text
Part 4 — SLF4J Deep Dive: Parameterized, Fluent, Marker, Key-Value Logging
```

Part 4 will move from semantics into SLF4J mechanics:

- parameterized logging,
- fluent logging API,
- key-value logging,
- marker,
- exception handling,
- MDC integration,
- performance pitfalls,
- migration from SLF4J 1.x style to SLF4J 2.x style.

---

## 75. Series Progress

Completed:

- Part 0 — Orientation, Scope, Mental Model, and Learning Contract
- Part 1 — Runtime Evidence, Not Just Logging
- Part 2 — Java Logging Architecture: Facade, API, Backend, Appender, Layout
- Part 3 — Log Semantics: What Should Be Logged and Why

Remaining:

- Part 4 through Part 35

The series is not finished yet.


<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 2 — Java Logging Architecture: Facade, API, Backend, Appender, Layout](./02-java-logging-architecture-facade-api-backend-appender-layout.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 4 — SLF4J Deep Dive: Parameterized, Fluent, Marker, Key-Value Logging](./04-slf4j-deep-dive-parameterized-fluent-marker-key-value-logging.md)
