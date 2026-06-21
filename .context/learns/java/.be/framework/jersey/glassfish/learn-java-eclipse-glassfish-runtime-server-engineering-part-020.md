# learn-java-eclipse-glassfish-runtime-server-engineering-part-020  
# Part 20 — Logging Architecture: Server Logs, App Logs, JUL, Log Rotation, Correlation

> Seri: `learn-java-eclipse-glassfish-runtime-server-engineering`  
> Part: 20 dari 35  
> Status seri: **belum selesai**  
> Target pembaca: Java backend / enterprise engineer yang sudah memahami Jakarta EE API dan ingin memahami GlassFish sebagai runtime produksi  
> Fokus part ini: **arsitektur logging GlassFish untuk diagnosis, audit, operasi, dan troubleshooting produksi**

---

## 0. Tujuan Part Ini

Setelah menyelesaikan part ini, kamu diharapkan bisa:

1. memahami perbedaan **server log**, **application log**, **access log**, **JVM/GC log**, dan **audit/security log**;
2. memahami posisi Java Util Logging/JUL dalam GlassFish;
3. memahami bagaimana app logging framework seperti SLF4J, Logback, Log4j2, dan JUL berinteraksi dalam application server;
4. menghindari classloading/logging conflict umum pada deployment WAR/EAR;
5. mendesain log yang bisa dipakai untuk debugging incident produksi;
6. menerapkan correlation ID untuk request, async job, JMS, EJB, dan external call;
7. memahami log rotation dan retention;
8. memahami redaction dan sensitive data handling;
9. membangun pipeline centralized logging ke CloudWatch, ELK/OpenSearch, Loki, Splunk, atau platform lain;
10. membuat checklist production logging baseline untuk GlassFish.

Part ini tidak mengulang teori observability umum terlalu luas. Fokusnya adalah **GlassFish runtime logging** dan bagaimana application log harus hidup berdampingan dengan server log.

---

## 1. Mental Model: Logging adalah Runtime Evidence System

Logging bukan sekadar `logger.info(...)`.

Dalam sistem produksi, log adalah **evidence trail** untuk menjawab pertanyaan:

```text
What happened?
When did it happen?
Who/what triggered it?
Which component handled it?
Which runtime boundary failed?
Was the failure transient or deterministic?
Was data modified?
Was external dependency called?
Did the transaction commit or rollback?
Was the user authorized?
```

Dalam GlassFish, log berasal dari banyak lapisan:

```text
[Reverse Proxy / Load Balancer]
  |
  | access log / TLS / upstream errors
  v
[GlassFish HTTP Listener / Grizzly]
  |
  | access log / request handling / network warning
  v
[GlassFish Containers]
  |
  | servlet / EJB / CDI / JPA / JMS / transaction / security logs
  v
[Application Code]
  |
  | business logs / integration logs / audit logs
  v
[External Dependencies]
  |
  | DB / broker / EIS / HTTP API
  v
[Central Logging Platform]
```

Top 1% engineer tidak hanya bertanya:

> "Ada error apa di log?"

Tetapi:

> "Boundary mana yang menghasilkan log ini, correlation ID-nya apa, request path-nya bagaimana, resource apa yang saturated, dan apakah evidence cukup untuk root cause?"

---

## 2. Jenis Log di Ekosistem GlassFish

### 2.1 Server Log

Server log adalah log utama GlassFish, biasanya:

```text
domains/<domain-name>/logs/server.log
```

Isinya dapat mencakup:

- startup/shutdown domain;
- deployment/undeployment;
- container initialization;
- application exceptions;
- JDBC pool warnings;
- transaction errors;
- JMS/OpenMQ integration warnings;
- security/authentication issues;
- admin actions;
- classloading errors;
- thread/timeout warnings;
- internal GlassFish component messages.

Server log adalah starting point hampir semua incident.

---

### 2.2 Application Log

Application log adalah log yang dibuat oleh kode aplikasi:

```java
logger.info("Case submitted");
logger.error("Failed to call OneMap", ex);
```

Bergantung konfigurasi, application log bisa:

- masuk ke `server.log`;
- masuk ke file aplikasi sendiri;
- masuk stdout;
- masuk logging backend sendiri;
- terduplikasi ke beberapa target.

Dalam application server, application log tidak selalu isolated secara sempurna karena classloader dan logging framework dapat saling berinteraksi.

---

### 2.3 Access Log

Access log mencatat request HTTP.

Contoh informasi:

```text
client IP
timestamp
HTTP method
URI
status code
response size
duration
user agent
referer
```

Access log berguna untuk:

- traffic analysis;
- 404/500 spike;
- latency distribution kasar;
- request volume;
- suspicious access;
- mapping 502/503/504 dari proxy ke backend;
- audit akses endpoint tertentu.

Access log berbeda dari application log. Application log menjelaskan apa yang terjadi di dalam logic. Access log menjelaskan request/response boundary.

---

### 2.4 JVM / GC Log

JVM log mencakup:

- GC log;
- safepoint log;
- JIT/code cache warning;
- native memory tracking;
- fatal error log;
- heap dump path;
- JVM crash `hs_err_pid`.

GC log tidak boleh dicampur secara mental dengan app log. GC log menjawab pertanyaan:

```text
Apakah runtime berhenti karena GC?
Apakah memory pressure tinggi?
Apakah pause time berkorelasi dengan latency?
```

---

### 2.5 Security / Audit Log

Security/audit log bisa berasal dari:

- GlassFish authentication failure;
- admin login;
- application audit trail;
- access to sensitive operation;
- role authorization failure;
- deployment/config change.

Audit log berbeda dari debug log.

Audit log harus:

- intentional;
- stable;
- structured;
- immutable/append-only jika memungkinkan;
- retention sesuai regulasi;
- tidak mengandung secret;
- cukup untuk forensic.

---

## 3. Logging Stack GlassFish: JUL sebagai Basis Runtime

GlassFish secara historis dan praktis menggunakan Java Util Logging/JUL untuk server logging.

JUL package:

```java
java.util.logging.Logger
```

GlassFish internal components menggunakan logger hierarchy.

Mental model:

```text
GlassFish component
  |
  | java.util.logging
  v
GlassFish logging service
  |
  v
server.log / configured handlers
```

Application bisa juga menggunakan JUL langsung:

```java
private static final Logger LOGGER =
    Logger.getLogger(MyService.class.getName());
```

Tetapi aplikasi modern sering menggunakan:

- SLF4J API;
- Logback;
- Log4j2;
- JBoss Logging;
- Commons Logging.

Ini membawa isu classloading dan bridging.

---

## 4. Logger Hierarchy

Logger biasanya hierarchical berdasarkan name.

Contoh:

```text
jakarta.enterprise
jakarta.persistence
org.glassfish
com.sun.enterprise
com.example.case
com.example.case.workflow
```

Level yang diterapkan pada parent bisa mempengaruhi child.

Contoh:

```text
com.example = INFO
com.example.case.workflow = DEBUG
```

Maka workflow bisa lebih verbose daripada package lain.

Dalam produksi, jangan menaikkan semua logger ke `FINE`/`DEBUG` tanpa batas karena:

- volume log meledak;
- CPU overhead;
- IO pressure;
- storage cost;
- sensitive data risk;
- signal-to-noise turun.

---

## 5. Log Levels di JUL dan Mapping Umum

JUL levels umum:

| JUL Level | Makna Umum | Mapping Umum |
|---|---|---|
| `SEVERE` | failure serius | ERROR |
| `WARNING` | problem/potensi problem | WARN |
| `INFO` | lifecycle/event penting | INFO |
| `CONFIG` | konfigurasi | INFO/DEBUG |
| `FINE` | debug detail | DEBUG |
| `FINER` | debug lebih detail | TRACE |
| `FINEST` | sangat detail | TRACE |

Application logging framework punya level:

```text
ERROR
WARN
INFO
DEBUG
TRACE
```

Mapping tidak selalu 1:1, terutama jika bridging dilakukan.

---

## 6. Konfigurasi Logging GlassFish

GlassFish logging dapat dikontrol via:

- Admin Console;
- `asadmin`;
- file konfigurasi logging domain;
- runtime log level change.

Command yang sering dipakai:

```bash
asadmin list-log-levels
asadmin set-log-levels
asadmin collect-log-files
```

Contoh konseptual:

```bash
asadmin list-log-levels

asadmin set-log-levels \
  com.example.case.workflow=FINE
```

Gunakan runtime log level change dengan hati-hati:

```text
1. Naikkan level untuk package spesifik.
2. Reproduce issue.
3. Ambil log.
4. Turunkan lagi.
5. Catat perubahan sebagai incident action.
```

Anti-pattern:

```text
Set global root logger to FINE in production and forget.
```

---

## 7. Struktur Pesan Log GlassFish

Server log GlassFish biasanya membawa informasi seperti:

```text
timestamp
log level
product/module/component
thread
logger name
message id
message
exception stack trace
```

Format aktual dapat berbeda antar versi dan konfigurasi.

Yang harus diperhatikan saat membaca log:

```text
timestamp
thread name/id
logger/component
level
message id
exception root cause
nested cause
application name
module name
transaction/request context jika ada
```

Root cause sering bukan stack trace paling atas. Baca nested cause:

```text
DeploymentException
  caused by CDI DeploymentException
    caused by UnsatisfiedResolutionException
```

Atau:

```text
EJBException
  caused by TransactionRolledbackException
    caused by SQLException
      caused by ORA-00060 deadlock
```

---

## 8. Server Log vs Application Log: Boundary Ownership

Ketika incident terjadi, pisahkan boundary:

```text
server.log:
  runtime/container evidence

application log:
  business/application evidence

access log:
  HTTP boundary evidence

DB/broker log:
  external dependency evidence

proxy log:
  edge/upstream evidence
```

Contoh incident:

```text
User sees 504 Gateway Timeout.
```

Kamu butuh:

```text
Proxy access/error log:
  upstream timed out?

GlassFish access log:
  request reached GlassFish?

Application log:
  endpoint started? external call?

Server log:
  thread pool/JDBC pool/transaction timeout?

DB log:
  query running slow?
```

Satu log jarang cukup.

---

## 9. Access Log di GlassFish

Access log penting untuk HTTP runtime.

Yang ideal dicatat:

```text
timestamp
remote IP
method
path
query length or sanitized query
status code
response bytes
duration
user agent
request id / correlation id
virtual server
```

Masalah umum:

- access log tidak aktif;
- tidak ada duration;
- tidak ada correlation ID;
- client IP hanya proxy;
- log terlalu besar;
- query string mengandung sensitive data;
- no rotation.

Jika GlassFish di belakang proxy:

```text
remote IP = proxy IP
```

Maka real client IP ada di:

```text
X-Forwarded-For
Forwarded
```

Tetapi hanya boleh dipercaya dari trusted proxy.

---

## 10. Logging Behind Reverse Proxy

Topology:

```text
Client
  |
  v
Nginx / ALB / Reverse Proxy
  |
  v
GlassFish
```

Ada dua access log:

```text
proxy access log
GlassFish access log
```

Gunakan correlation ID yang sama di keduanya.

Flow:

```text
Proxy receives request
  |
  | if X-Request-ID exists, validate/use
  | else generate X-Request-ID
  v
Forward to GlassFish with X-Request-ID
  |
  v
Application puts request ID into MDC/log context
```

Tanpa correlation ID, mencocokkan proxy log dan app log menjadi lambat.

---

## 11. Correlation ID: Konsep Dasar

Correlation ID adalah identifier yang mengikuti satu unit kerja.

Contoh:

```text
X-Request-ID: 9f7b3c2a1e0d4c1a
```

Digunakan untuk menghubungkan:

- proxy log;
- GlassFish access log;
- application log;
- DB audit;
- JMS message;
- external HTTP call;
- async job;
- error response.

Mental model:

```text
One user action
  |
  | correlation ID
  v
HTTP request
  |
  v
EJB call
  |
  v
DB transaction
  |
  v
JMS event
  |
  v
async consumer
  |
  v
external API call
```

Semuanya harus punya trace/correlation context.

---

## 12. MDC / Thread Context

SLF4J/Logback/Log4j2 punya konsep MDC/ThreadContext.

Contoh SLF4J MDC:

```java
MDC.put("correlationId", correlationId);
try {
    service.handle(request);
} finally {
    MDC.clear();
}
```

Log pattern:

```text
%date %-5level [%thread] cid=%X{correlationId} %logger - %msg%n
```

Masalah:

- MDC berbasis thread-local;
- async execution bisa kehilangan context;
- JMS consumer perlu mengambil dari message property;
- EJB async/thread pool perlu propagation;
- virtual threads/context propagation perlu diperhatikan;
- jangan lupa clear MDC supaya tidak bocor ke request lain.

---

## 13. Correlation ID di Servlet Filter

Contoh pattern:

```java
public class CorrelationIdFilter implements Filter {
    private static final String HEADER = "X-Request-ID";

    @Override
    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
            throws IOException, ServletException {

        HttpServletRequest httpReq = (HttpServletRequest) req;
        HttpServletResponse httpRes = (HttpServletResponse) res;

        String correlationId = httpReq.getHeader(HEADER);
        if (correlationId == null || correlationId.isBlank()) {
            correlationId = generateCorrelationId();
        }

        MDC.put("correlationId", correlationId);
        httpRes.setHeader(HEADER, correlationId);

        try {
            chain.doFilter(req, res);
        } finally {
            MDC.remove("correlationId");
        }
    }

    private String generateCorrelationId() {
        return UUID.randomUUID().toString();
    }
}
```

Production considerations:

```text
- validate length
- validate character set
- avoid accepting huge header
- avoid trusting externally supplied ID blindly for security-sensitive audit
- generate internal trace id if needed
```

---

## 14. Correlation ID ke External HTTP Call

Saat aplikasi memanggil service lain:

```text
Incoming X-Request-ID
  -> outgoing X-Request-ID
```

Contoh:

```java
requestBuilder.header("X-Request-ID", correlationId);
```

Jika external system tidak boleh menerima internal ID, buat mapping:

```text
internalCorrelationId
externalRequestId
```

Log:

```text
cid=internal-123 externalRequestId=partner-456 operation=OneMapSearch
```

---

## 15. Correlation ID ke JMS

Saat publish JMS message:

```java
message.setStringProperty("correlationId", correlationId);
```

Consumer:

```java
String correlationId = message.getStringProperty("correlationId");
MDC.put("correlationId", correlationId);
```

Perhatikan:

- JMS punya `JMSCorrelationID`, tapi bisa punya semantic berbeda;
- property custom sering lebih jelas;
- propagate causation ID juga berguna.

Pattern:

```text
correlationId:
  same across business workflow

messageId:
  unique per message

causationId:
  event/message that caused this message
```

---

## 16. Correlation untuk EJB Async / Managed Executor

Jika pekerjaan pindah thread:

```text
HTTP thread -> executor thread
```

MDC tidak otomatis selalu ikut.

Pattern:

```java
Map<String, String> contextMap = MDC.getCopyOfContextMap();

executor.submit(() -> {
    if (contextMap != null) {
        MDC.setContextMap(contextMap);
    }
    try {
        task.run();
    } finally {
        MDC.clear();
    }
});
```

Untuk Jakarta EE, gunakan managed executor supaya thread dikelola container, tetapi tetap pastikan logging context propagation sesuai implementasi/framework.

---

## 17. Structured Logging

Plain text log mudah dibaca manusia, tapi sulit untuk query.

Structured logging contoh JSON:

```json
{
  "timestamp": "2026-06-21T10:15:30.123+07:00",
  "level": "INFO",
  "logger": "com.example.case.SubmitCaseService",
  "thread": "http-thread-pool::http-listener-1(5)",
  "correlationId": "9f7b3c2a1e0d4c1a",
  "userId": "u12345",
  "module": "case",
  "operation": "submitCase",
  "caseId": "CASE-2026-00001",
  "durationMs": 245,
  "message": "Case submitted"
}
```

Kelebihan:

- mudah query;
- mudah dashboard;
- field-based alert;
- parsing lebih stabil;
- cocok untuk centralized logging.

Kekurangan:

- lebih sulit dibaca langsung;
- butuh formatter/library;
- JSON invalid jika salah escaping;
- volume lebih besar;
- harus disiplin field naming.

---

## 18. Field Naming Standard

Tetapkan field standar:

```text
timestamp
level
logger
thread
correlationId
traceId
spanId
userId
sessionId
clientIp
method
path
status
durationMs
module
operation
entityType
entityId
externalSystem
errorCode
exceptionClass
```

Jangan campur:

```text
corrId
correlation_id
correlationId
requestId
req_id
```

Pilih satu standar.

---

## 19. Apa yang Harus Dilog?

Log harus menjelaskan state transition, boundary call, dan failure.

### 19.1 Request Boundary

```text
request started
request completed
status
duration
correlationId
user/subject if safe
```

Biasanya access log sudah mencatat sebagian. Application log perlu mencatat operation-level event.

---

### 19.2 Business State Transition

Contoh:

```text
Case submitted
Case approved
Case escalated
Case rejected
Appeal created
Enforcement notice generated
```

Field:

```text
caseId
fromState
toState
actor
reasonCode
correlationId
```

Jangan log full sensitive payload jika tidak perlu.

---

### 19.3 External Call

```text
Calling OneMap
OneMap call succeeded
OneMap call failed
```

Field:

```text
externalSystem
operation
durationMs
statusCode/errorCode
retryAttempt
timeoutMs
correlationId
```

---

### 19.4 Transaction / Async Boundary

```text
Outbox event created
JMS message published
JMS message consumed
Batch job started/completed
```

Field:

```text
messageId
correlationId
causationId
jobId
attempt
durationMs
```

---

### 19.5 Error

Error log harus mencakup:

```text
what operation failed
why it failed
whether retryable
correlation ID
domain/entity id if safe
exception stack trace
external error code
```

Buruk:

```text
logger.error("Error", e);
```

Lebih baik:

```text
logger.error("Failed to submit case to enforcement registry: caseId={}, externalSystem={}, retryable={}, cid={}",
    caseId, "EnforcementRegistry", true, correlationId, e);
```

---

## 20. Apa yang Tidak Boleh Dilog?

Jangan log:

```text
password
access token
refresh token
authorization header
session cookie
API key
private key
full credit card number
NRIC/PII sensitif tanpa masking
medical/financial sensitive data jika tidak perlu
full request body by default
SQL with sensitive bind values
JWT full raw token
SAML assertion
client certificate private material
```

Masking contoh:

```text
NRIC: S****123A
Email: f***@example.com
Token: eyJ...<redacted>
```

Prinsip:

> Log adalah data store. Jika log berisi secret/PII, maka log platform menjadi breach surface.

---

## 21. Logging Framework di Aplikasi GlassFish

Aplikasi dapat memakai:

- JUL;
- SLF4J + Logback;
- SLF4J + Log4j2;
- Log4j2 API/Core;
- Commons Logging bridge;
- JBoss Logging.

Dalam application server, hati-hati:

1. Jangan membawa binding ganda.
2. Jangan membawa API Jakarta/Java EE provided.
3. Jangan membiarkan app logging library override server logging secara tidak sengaja.
4. Perhatikan classloader isolation.
5. Perhatikan duplicate logger output.

---

## 22. SLF4J Binding Problem

SLF4J adalah facade. Ia butuh binding/provider.

Masalah umum:

```text
Class path contains multiple SLF4J bindings.
```

Atau pada SLF4J 2.x:

```text
Multiple SLF4J providers found.
```

Contoh konflik:

```text
logback-classic.jar
slf4j-jdk14.jar
log4j-slf4j2-impl.jar
```

Harus pilih satu strategy:

```text
Option A: SLF4J -> Logback
Option B: SLF4J -> Log4j2
Option C: SLF4J -> JUL
```

Dalam GlassFish, jika ingin app log masuk ke server JUL log, gunakan bridge yang sesuai, tetapi pastikan tidak menciptakan loop.

---

## 23. Logging Bridge Loop

Bridge loop contoh:

```text
JUL -> SLF4J
SLF4J -> JUL
```

Ini bisa menyebabkan recursion atau duplicate logs.

Aturan:

```text
One direction only.
```

Contoh aman:

```text
Application uses SLF4J -> Logback file/stdout
GlassFish server uses JUL -> server.log
```

Atau:

```text
Application uses SLF4J -> JUL
GlassFish server collects JUL -> server.log
```

Tapi jangan:

```text
JUL -> SLF4J -> JUL
```

---

## 24. Per-App Log File vs Unified Server Log

### 24.1 Unified Server Log

Kelebihan:

- satu tempat;
- container + app event bersama;
- mudah untuk small deployment.

Kekurangan:

- noisy;
- multi-app bercampur;
- sulit isolate;
- rotation satu file besar;
- app bisa membanjiri server log.

---

### 24.2 Per-App Log File

Kelebihan:

- isolasi app;
- retention berbeda;
- ownership jelas;
- mudah volume control per app.

Kekurangan:

- lebih banyak file;
- correlation dengan server log perlu effort;
- containerized runtime lebih suka stdout;
- file path permission perlu dikelola.

---

### 24.3 Stdout/Stderr untuk Container

Dalam Kubernetes/container:

```text
Application/server logs -> stdout/stderr
Container runtime collects logs
Fluent Bit/agent ships logs
```

Tetapi GlassFish tradisional menulis ke file `server.log`.

Pilihan:

- symlink/tail server.log ke stdout;
- configure logging handler;
- sidecar log agent baca file;
- use container image pattern yang forward logs.

Prinsip:

```text
In containers, logs should be collectible without shelling into the pod.
```

---

## 25. Log Rotation

Log rotation menjawab:

```text
How large can log files grow?
How many files are retained?
How long are logs kept?
Who compresses old logs?
What happens when disk is full?
```

GlassFish punya mekanisme rotation untuk server/access log. Namun di production modern, kamu juga perlu mempertimbangkan:

- OS logrotate;
- container runtime log rotation;
- centralized logging retention;
- storage quota;
- compliance retention;
- hot vs cold storage;
- immutable archive.

Anti-pattern:

```text
server.log grows until disk full.
```

Disk full dapat menyebabkan:

- app gagal write temp file;
- deployment gagal;
- logging block/slow;
- DB local file issue;
- domain crash.

---

## 26. Retention

Retention berbeda untuk jenis log:

```text
debug log:
  pendek, hari

application operational log:
  sedang, minggu/bulan

security audit:
  lebih lama, sesuai compliance

access log:
  sesuai kebutuhan audit/security/traffic

GC log:
  cukup untuk performance investigation
```

Pertanyaan:

1. Siapa owner retention?
2. Apakah log mengandung PII?
3. Apakah log perlu immutable?
4. Apakah log dipakai untuk audit legal/regulatory?
5. Apakah user bisa meminta deletion?
6. Apakah cross-border data transfer relevan?
7. Apakah environment non-prod retention lebih pendek?

---

## 27. Centralized Logging Pipeline

Pipeline umum:

```text
GlassFish/server/app logs
  |
  v
local file or stdout
  |
  v
agent: Fluent Bit / Filebeat / Vector / CloudWatch Agent
  |
  v
central platform: OpenSearch / Elasticsearch / Loki / Splunk / CloudWatch
  |
  v
dashboard / alert / search / retention archive
```

Design concerns:

- multiline stack trace parsing;
- JSON vs plain text;
- timestamp timezone;
- source labels;
- environment labels;
- application/module labels;
- pod/host/instance labels;
- log volume;
- backpressure;
- agent failure;
- duplicate ingestion;
- sensitive data filtering.

---

## 28. Multiline Stack Trace Problem

Java stack trace multiline:

```text
java.lang.RuntimeException: failed
    at ...
    at ...
Caused by: ...
    at ...
```

If log shipper treats each line as separate event:

```text
search becomes painful
alerting becomes noisy
correlation incomplete
```

Solusi:

- structured JSON with exception field;
- multiline parser in agent;
- logback/log4j JSON encoder;
- configure Filebeat/Fluent Bit multiline;
- avoid arbitrary line breaks in app logs.

---

## 29. Timezone dan Timestamp

Production logs harus punya timestamp jelas.

Rekomendasi:

```text
Use ISO-8601 with timezone/offset.
Prefer UTC for centralized logs unless local timezone required.
Ensure host clocks synchronized via NTP.
```

Masalah jika tidak:

- sulit correlate across servers;
- DST/timezone confusion;
- incident timeline salah;
- audit menjadi lemah.

Untuk user di Indonesia/Asia/Jakarta, tampilan dashboard boleh local timezone, tapi storage sering lebih baik UTC.

---

## 30. Correlation dengan Thread Dump dan GC Log

Saat incident latency:

```text
App log shows request slow at 10:15:31.
Access log duration 30s.
GC log shows pause at 10:15:32.
Thread dump shows http threads waiting on DB.
```

Tanpa timestamp konsisten, korelasi sulit.

Praktik:

- enable GC logs with timestamp;
- take thread dumps with timestamp;
- log correlation IDs;
- ensure NTP;
- keep server log/access log aligned.

---

## 31. Dynamic Debug Logging di Production

Kadang perlu menaikkan logging di production.

Safe protocol:

```text
1. Tentukan package/class spesifik.
2. Tentukan durasi debugging.
3. Catat perubahan.
4. Naikkan level minimal yang diperlukan.
5. Reproduce atau tunggu event.
6. Ambil log.
7. Turunkan level.
8. Review apakah sensitive data tercetak.
```

Contoh:

```bash
asadmin set-log-levels com.example.integration.onemap=FINE
```

Jangan:

```bash
asadmin set-log-levels com.example=FINEST
```

tanpa batas waktu.

---

## 32. Logging dan Performance

Logging punya biaya:

- string construction;
- JSON serialization;
- stack trace generation;
- IO;
- lock contention;
- async queue memory;
- ingestion cost;
- disk usage.

Gunakan guard untuk debug expensive:

```java
if (logger.isDebugEnabled()) {
    logger.debug("Large payload summary: {}", buildExpensiveSummary(payload));
}
```

Dengan SLF4J parameterized logging:

```java
logger.debug("Case {} loaded in {} ms", caseId, durationMs);
```

lebih baik daripada:

```java
logger.debug("Case " + caseId + " loaded in " + durationMs + " ms");
```

Tetapi object yang dihitung sebelum call tetap mahal jika sudah dievaluasi.

---

## 33. Async Logging

Async logging dapat mengurangi latency request, tetapi punya trade-off:

Kelebihan:

- request thread tidak terlalu lama menulis IO;
- throughput lebih baik;
- batching.

Risiko:

- log hilang saat crash;
- queue penuh;
- memory pressure;
- ordering berubah;
- shutdown harus flush;
- backpressure behavior harus jelas.

Pertanyaan:

```text
If async log queue is full, drop logs or block application?
```

Untuk audit/security log, drop mungkin tidak boleh.

Untuk debug high-volume log, drop bisa diterima.

---

## 34. Audit Logging vs Operational Logging

Operational log:

```text
Failed to call payment API after 3 retries.
```

Audit log:

```text
User A approved case B at time T with reason R.
```

Operational log boleh berubah format lebih sering. Audit log harus lebih stabil.

Audit log harus punya:

- actor;
- action;
- target object;
- timestamp;
- outcome;
- reason if applicable;
- source;
- correlation ID;
- before/after state jika relevan;
- tamper resistance/retention.

Jangan campur audit penting dengan debug log yang retention-nya pendek.

---

## 35. Redaction Strategy

Redaction harus terjadi sedekat mungkin dengan sumber.

Layer:

```text
Application log helper
  -> mask fields before logging

Logging framework filter
  -> pattern-based redaction

Log shipper
  -> final safety filter

Central platform
  -> access control
```

Jangan hanya bergantung pada log shipper karena secret sudah sempat tertulis di disk lokal.

Contoh helper:

```java
public final class SafeLog {
    public static String maskEmail(String email) {
        if (email == null || !email.contains("@")) return "<invalid>";
        String[] parts = email.split("@", 2);
        return parts[0].charAt(0) + "***@" + parts[1];
    }
}
```

---

## 36. SQL Logging

SQL logging sangat berguna tetapi berbahaya.

Risiko:

- bind values mengandung PII;
- volume tinggi;
- performance overhead;
- leaking schema/internal detail;
- huge logs.

Use cases:

- DEV/SIT debugging;
- temporary production troubleshooting;
- slow query analysis with masking;
- DB-side AWR/pg_stat statements lebih cocok untuk production.

Production recommendation:

```text
Do not log all SQL with bind values by default.
Use slow query logs / DB monitoring / targeted debug.
```

---

## 37. Deployment Logging

Saat deploy/redeploy, log harus membantu menjawab:

```text
Artifact apa yang dideploy?
Versi/build hash apa?
Target mana?
Siapa/apa yang deploy?
Kapan?
Apakah deployment sukses?
Berapa lama?
Apakah resource binding berhasil?
```

Release pipeline sebaiknya mencatat:

```text
appName
version
gitCommit
buildNumber
artifactHash
target
operator/CI job
deployment timestamp
```

Aplikasi juga bisa log saat startup:

```text
Application started: version=1.4.7 commit=abc123 env=UAT
```

Jangan log secret config.

---

## 38. Startup Logging

Startup log penting untuk diagnosis config.

Log aman:

```text
app version
environment name
active profiles/config source
JDK version
GlassFish version if accessible
DB pool JNDI name
external endpoint hostname only
feature flags non-sensitive
```

Jangan log:

```text
DB password
full token
private key
secret env vars
full PII config
```

Startup validation:

```text
Can resolve DataSource?
Can query DB metadata safely?
Can resolve JMS resource?
Can reach required external dependency? maybe optional/deferred
```

---

## 39. Error ID untuk User-Facing Error

Untuk error yang muncul ke user, jangan tampilkan stack trace. Tampilkan error reference.

```text
Something went wrong.
Reference ID: ERR-20260621-9F7B3C
```

Log:

```text
level=ERROR errorId=ERR-20260621-9F7B3C correlationId=... exception=...
```

Ini membantu support:

```text
User reports Reference ID.
Engineer search log by errorId.
```

---

## 40. Logging for Regulatory / Case Management Systems

Untuk sistem regulatory/enforcement, logging harus memisahkan:

### Operational Logs

Untuk engineer:

```text
request failed
DB timeout
JMS retry
external API latency
deployment event
```

### Business Audit Logs

Untuk compliance/business:

```text
case created
case status changed
officer assigned
approval granted
notice generated
document viewed/downloaded
```

### Security Logs

Untuk security:

```text
login failed
privilege denied
admin access
role mapping failure
suspicious access pattern
```

Jangan mengandalkan satu log untuk semua kebutuhan.

---

## 41. Failure Mode: Log Disk Full

Scenario:

```text
server.log and access logs grow.
Disk fills.
GlassFish cannot write logs/temp/deploy artifacts.
Application starts failing.
```

Mitigation:

- log rotation;
- disk alerts;
- centralized shipping;
- retention policy;
- separate log volume;
- container log limits;
- no infinite debug logging.

Alert:

```text
disk usage > 80%
log volume sudden spike
server.log growth rate abnormal
```

---

## 42. Failure Mode: Missing Correlation ID

Symptom:

```text
Incident across proxy, GlassFish, JMS, DB cannot be traced.
```

Mitigation:

- enforce correlation filter;
- propagate to outgoing calls;
- add to JMS properties;
- add to MDC;
- include in error response;
- test correlation propagation.

---

## 43. Failure Mode: Duplicate Logs

Causes:

- multiple SLF4J bindings;
- additivity true with multiple appenders;
- bridge loop;
- app logs to server log and own file;
- log shipper reads same file twice;
- stdout + file both collected.

Impact:

- cost doubles;
- alert false positives;
- noisy search;
- confusion timeline.

Diagnosis:

```text
same timestamp, same message, same thread appears twice
different logger path maybe
different source labels in central platform
```

---

## 44. Failure Mode: Sensitive Data Leak in Logs

Immediate response:

```text
1. Stop further logging if possible.
2. Identify affected log files/platform.
3. Restrict access.
4. Rotate leaked secret if secret/token/password.
5. Purge logs if policy allows/requires.
6. File incident/security report.
7. Add redaction/test.
8. Review similar log statements.
```

Prevention:

- code review checklist;
- static scanning for logging sensitive fields;
- centralized redaction;
- lower log level for payloads;
- no full request/response logging in prod by default.

---

## 45. Production Logging Baseline for GlassFish

```text
[Server Log]
- enabled
- rotation configured
- retention defined
- log level baseline INFO
- targeted debug allowed with process

[Access Log]
- enabled for HTTP apps
- includes duration/status/method/path
- handles proxy client IP correctly
- no sensitive query logging if avoidable
- rotation configured

[Application Log]
- uses consistent framework
- no duplicate bindings
- has correlation ID
- structured or parseable
- masks sensitive data
- includes build/version at startup

[Correlation]
- generated at ingress
- returned in response header
- propagated to external HTTP calls
- propagated to JMS/async
- included in error response/reference

[Centralization]
- logs shipped to central platform
- multiline handled
- labels include env/app/instance
- retention and access control configured

[Security/Audit]
- auth/admin/security events captured
- audit logs separated or identifiable
- no secrets in logs
- access controlled

[Operations]
- disk usage monitored
- log volume monitored
- debug logging runbook exists
- incident search examples documented
```

---

## 46. Practical Log Pattern

Plain text pattern example:

```text
%d{yyyy-MM-dd'T'HH:mm:ss.SSSXXX} %-5level [%thread] cid=%X{correlationId} user=%X{userId} op=%X{operation} %logger - %msg%n%ex
```

JSON fields example:

```json
{
  "ts": "...",
  "level": "INFO",
  "app": "case-management",
  "env": "prod",
  "instance": "gf-prod-01",
  "thread": "...",
  "logger": "...",
  "correlationId": "...",
  "userId": "...",
  "operation": "submitCase",
  "entityType": "case",
  "entityId": "...",
  "message": "Case submitted"
}
```

---

## 47. Runbook: Investigating HTTP 500

Steps:

```text
1. Get timestamp, user, endpoint, correlation/error ID.
2. Search access log by path/time/correlation.
3. Confirm status and duration.
4. Search application log by correlation ID.
5. Find first ERROR/WARN in request timeline.
6. Expand nested exception root cause.
7. Check server.log for container/resource errors.
8. Check DB/JMS/external logs if boundary call failed.
9. Determine whether failure is app logic, runtime, resource, or dependency.
10. Write root cause and prevention.
```

---

## 48. Runbook: Investigating 504 Timeout

Steps:

```text
1. Check proxy log: upstream timeout?
2. Check GlassFish access log: did request complete?
3. Check app log by correlation ID.
4. Check thread dump around time if active.
5. Check JDBC/connector pool saturation.
6. Check external dependency latency.
7. Check GC log for pause.
8. Check transaction timeout.
9. Check whether request continued after proxy gave up.
10. Add timeout/backpressure fix.
```

---

## 49. Runbook: Temporary Debug Logging

Template:

```text
Reason:
  Investigate intermittent 403 for case approval.

Scope:
  com.example.security.RoleMappingResolver=DEBUG
  com.example.case.ApprovalResource=DEBUG

Duration:
  15 minutes or until issue reproduced.

Risk:
  no request body logged
  no token logged

Action:
  enable level
  collect logs
  disable level
  attach logs to incident
```

Command:

```bash
asadmin set-log-levels com.example.security.RoleMappingResolver=FINE
```

Rollback:

```bash
asadmin set-log-levels com.example.security.RoleMappingResolver=INFO
```

---

## 50. Top 1% Takeaways

1. **Logging is evidence, not decoration.**
2. **Server log, app log, access log, GC log, and audit log answer different questions.**
3. **GlassFish runtime logging is JUL-centered; app logging frameworks must be managed carefully.**
4. **Correlation ID is mandatory for serious production diagnosis.**
5. **MDC is thread-local; async/JMS/EJB propagation must be explicit.**
6. **Structured logging improves searchability, but field discipline matters.**
7. **Sensitive data in logs is a security incident waiting to happen.**
8. **Log rotation and retention are reliability controls, not housekeeping.**
9. **Dynamic debug logging needs scope, duration, and rollback.**
10. **A useful log explains boundary, operation, outcome, duration, and correlation.**

---

## 51. Mini Exercise

Design a logging architecture for:

```text
GlassFish-based regulatory case management system.
Topology:
- Nginx reverse proxy
- GlassFish cluster
- Oracle DB
- JMS/OpenMQ
- external OneMap API
- centralized OpenSearch logging
```

Answer:

1. What logs are produced at each layer?
2. What correlation ID header do you use?
3. How is correlation propagated to JMS?
4. What fields are mandatory in app logs?
5. What data must be redacted?
6. What log levels are allowed in production?
7. How are access logs shipped?
8. How do you handle Java stack traces multiline?
9. What retention is used for operational vs audit logs?
10. What runbook is used for 504 investigation?

---

## 52. Referensi

Referensi utama:

- Eclipse GlassFish Administration Guide, Release 8  
  https://glassfish.org/docs/latest/administration-guide.html

- Eclipse GlassFish Reference Manual, Release 8  
  https://glassfish.org/docs/latest/reference-manual.html

- Eclipse GlassFish Performance Tuning Guide, Release 8  
  https://glassfish.org/docs/latest/performance-tuning-guide.html

- Java Platform Logging / `java.util.logging`  
  https://docs.oracle.com/en/java/javase/

- SLF4J Manual  
  https://www.slf4j.org/manual.html

- Log4j 2 Manual  
  https://logging.apache.org/log4j/2.x/manual/

- Logback Manual  
  https://logback.qos.ch/manual/

- OpenTelemetry Logs Concepts  
  https://opentelemetry.io/docs/concepts/signals/logs/

---

## 53. Status Seri

Part ini selesai.

Progress:

```text
Part 0  - selesai
Part 1  - selesai
Part 2  - selesai
Part 3  - selesai
Part 4  - selesai
Part 5  - selesai
Part 6  - selesai
Part 7  - selesai
Part 8  - selesai
Part 9  - selesai
Part 10 - selesai
Part 11 - selesai
Part 12 - selesai
Part 13 - selesai
Part 14 - selesai
Part 15 - selesai
Part 16 - selesai
Part 17 - selesai
Part 18 - selesai
Part 19 - selesai
Part 20 - selesai
```

Seri belum selesai.

Part berikutnya:

```text
Part 21 — Monitoring, Metrics, Health, JMX, dan Observability
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-019.md">⬅️ Part 19 — Resource Adapter / JCA Engineering</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-021.md">Part 21 — Monitoring, Metrics, Health, JMX, dan Observability ➡️</a>
</div>
