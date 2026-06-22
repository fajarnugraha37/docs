# Part 35 — Capstone: Diagnose a Complex Java Production Incident End-to-End

> Series: `learn-java-logging-observability-profiling-troubleshooting-engineering`  
> File: `35-capstone-diagnose-complex-java-production-incident-end-to-end.md`  
> Scope: Java 8–25, SLF4J, Logback, Log4j2, OpenTelemetry, JFR, async-profiler, JVM diagnostic tooling, Kubernetes/container runtime, production incident reasoning  
> Status: **Final part of this series**

---

## 0. Tujuan Part Ini

Bagian ini adalah **capstone**. Semua konsep dari Part 0 sampai Part 34 akan dipakai untuk mendiagnosis satu incident kompleks secara end-to-end.

Di bagian-bagian sebelumnya kita sudah membahas:

- logging architecture,
- log semantics,
- SLF4J,
- Logback,
- Log4j2,
- structured logging,
- MDC/context propagation,
- correlation identity,
- OpenTelemetry,
- manual tracing,
- metrics engineering,
- cross-signal correlation,
- logging performance,
- secure logging,
- exception taxonomy,
- JFR,
- async-profiler,
- JVM diagnostic toolkit,
- thread dump,
- heap/memory troubleshooting,
- GC observability,
- dependency troubleshooting,
- async workflow observability,
- troubleshooting methodology,
- Java incident playbooks,
- Kubernetes observability,
- observability governance,
- observability starter kit.

Sekarang kita akan menyatukan semuanya menjadi satu latihan diagnosis produksi.

Targetnya bukan hanya tahu command atau tools. Targetnya adalah mampu menjawab:

1. **Apa yang sebenarnya rusak?**
2. **Apa dampaknya?**
3. **Di mana bottleneck terjadi?**
4. **Apa trigger-nya?**
5. **Apa root cause-nya?**
6. **Apa amplifier-nya?**
7. **Apa mitigation aman sekarang?**
8. **Apa permanent fix-nya?**
9. **Evidence apa yang membuktikan kesimpulan?**
10. **Observability gap apa yang harus diperbaiki agar incident berikutnya lebih cepat didiagnosis?**

Engineer top-tier tidak hanya “melihat error log lalu menebak”. Ia membangun **causal story** yang defensible dari bukti runtime.

---

## 1. Scenario Overview

Kita akan memakai simulasi production incident pada service Java backend enterprise.

Nama service:

```text
case-command-service
```

Fungsi service:

- menerima submission case baru,
- melakukan validation,
- mengambil profile applicant,
- mengecek duplicate submission,
- menyimpan case,
- publish event ke queue,
- mengirim notification,
- mencatat audit trail.

Runtime:

```text
Java                 : 21
Framework            : Spring Boot 3.4.x
Logging API          : SLF4J 2.x
Logging backend      : Logback JSON stdout
Tracing              : OpenTelemetry Java Agent + manual spans
Metrics              : Micrometer + OpenTelemetry
Database             : Oracle/PostgreSQL-like OLTP DB
Connection pool      : HikariCP
Queue                : RabbitMQ/Kafka-like broker
Container runtime    : Kubernetes
JVM                  : G1GC
JFR                  : enabled on-demand
Profiler             : async-profiler available
```

Aplikasi berjalan sebagai 6 pod:

```text
case-command-service-7c9df4c8b5-a1
case-command-service-7c9df4c8b5-a2
case-command-service-7c9df4c8b5-a3
case-command-service-7c9df4c8b5-a4
case-command-service-7c9df4c8b5-a5
case-command-service-7c9df4c8b5-a6
```

Incident dimulai pada:

```text
2026-06-18 14:07 Asia/Jakarta
```

User report:

```text
Users report intermittent timeout when submitting cases.
Some submissions eventually succeed after retry.
Some duplicate cases are created.
Support team sees inconsistent audit trail timing.
```

Alert yang fire:

```text
High HTTP p95 latency
HTTP 5xx rate elevated
DB connection pool saturation
Queue backlog increasing
Pod CPU throttling warning
Log ingestion volume spike
```

Di permukaan, ini terlihat seperti banyak masalah:

- aplikasi lambat,
- error naik,
- DB pool penuh,
- queue backlog,
- duplicate case,
- CPU throttling,
- logging volume spike.

Pertanyaan utama:

> Apakah ini incident DB, JVM, logging, queue, application logic, Kubernetes resource, atau semuanya?

Jawaban yang benar biasanya bukan “semuanya”. Yang benar adalah:

> Ada satu atau beberapa trigger utama, beberapa amplifier, beberapa symptom, dan beberapa observability side-effect.

---

## 2. Evidence Inventory

Sebelum menganalisis, kita tentukan evidence yang tersedia.

Kita punya:

1. Metrics:
   - HTTP request rate,
   - HTTP latency histogram,
   - HTTP status code rate,
   - JVM heap,
   - GC pause,
   - CPU usage,
   - CPU throttling,
   - HikariCP active/idle/pending/timeout,
   - DB query duration,
   - queue backlog,
   - queue publish latency,
   - log event rate.

2. Logs:
   - structured JSON logs,
   - trace/span/correlation IDs,
   - business event names,
   - exception taxonomy,
   - retry logs,
   - DB timeout logs,
   - duplicate submission logs.

3. Traces:
   - inbound HTTP spans,
   - validation spans,
   - duplicate-check span,
   - DB insert span,
   - audit insert span,
   - queue publish span,
   - notification span.

4. Thread dumps:
   - 3 dumps per affected pod, 10 seconds apart.

5. JFR:
   - 90-second recording during incident.

6. async-profiler:
   - 60-second wall-clock profile,
   - 30-second CPU profile.

7. Kubernetes evidence:
   - pod resource usage,
   - restart status,
   - CPU throttling,
   - deployment rollout timestamp,
   - config map/secret update timestamp.

8. Recent changes:
   - one deployment 25 minutes before incident,
   - config change for logging level,
   - new duplicate-check query,
   - new retry policy for notification provider.

Evidence pertama yang penting bukan command, tetapi **ordering**.

Kita tidak ingin langsung buka heap dump besar kalau symptom utamanya latency. Kita tidak ingin langsung blame GC kalau GC pause normal. Kita tidak ingin langsung blame DB kalau Hikari pending naik karena application threads memegang connection terlalu lama akibat downstream call dalam transaction.

---

## 3. Incident Timeline

Timeline adalah alat paling kuat untuk membedakan trigger, symptom, dan amplifier.

Initial evidence:

```text
13:42  Deployment v2026.06.18-13.40 completed
13:45  Logging level for com.company.case changed from INFO to DEBUG in production
13:47  New duplicate-check query enabled by feature flag
13:50  Notification retry policy changed from maxAttempts=2 to maxAttempts=5
14:03  Request traffic starts increasing due to campaign window
14:07  HTTP p95 latency alert fires
14:08  Hikari pending connections increasing
14:09  5xx error rate increasing
14:10  Queue backlog starts increasing
14:11  Log ingestion volume spikes 8x
14:12  CPU throttling warning on 4 of 6 pods
14:13  Duplicate case reports start
14:15  Support observes audit trail delay
14:17  On-call starts investigation
```

Already, this timeline suggests:

- deployment/config changes happened before incident,
- traffic increase likely triggered latent issue,
- DB pool pressure preceded queue backlog,
- log volume spike happened after latency started but may amplify,
- CPU throttling happened after log spike and higher load,
- duplicate cases appeared after retry/timeouts.

This is not proof, but it narrows the first hypothesis set.

---

## 4. Define the Incident Precisely

Bad incident statement:

```text
The system is slow and DB is bad.
```

Better incident statement:

```text
Between 14:07 and 14:30 Asia/Jakarta, case submission requests experienced elevated latency and intermittent 5xx/timeouts. HikariCP pending connection count increased, queue backlog grew, and duplicate case records were reported. The issue affected case submission paths but not read-only case listing.
```

This statement captures:

- time window,
- user-facing symptom,
- affected operation,
- unaffected operation,
- correlated internal symptoms,
- business impact.

A top-tier engineer avoids premature root cause wording in the initial statement.

Do not say:

```text
DB caused outage.
```

Say:

```text
DB connection acquisition was saturated during affected submissions.
```

That is evidence, not speculation.

---

## 5. Blast Radius Analysis

Question:

> Is this global, service-specific, endpoint-specific, tenant-specific, pod-specific, or dependency-specific?

Evidence:

HTTP metrics by route:

```text
POST /cases/submit       p95: 18s, 5xx: 7.8%
GET  /cases/{id}         p95: 190ms, 5xx: 0.1%
GET  /cases/search       p95: 320ms, 5xx: 0.2%
POST /appeals/submit     p95: 410ms, 5xx: 0.3%
```

By pod:

```text
a1 p95 19s
a2 p95 18s
a3 p95 20s
a4 p95 17s
a5 p95 18s
a6 p95 19s
```

By tenant:

```text
tenant=A p95 18s
tenant=B p95 19s
tenant=C p95 17s
```

By operation:

```text
case.submit p95 18s
case.list   p95 300ms
case.view   p95 200ms
```

Conclusion:

```text
The incident is operation-specific, not pod-specific and not tenant-specific.
Affected path: case submission command flow.
```

This reduces the search space.

Likely suspects:

- submission transaction,
- duplicate check,
- audit insert,
- notification call,
- queue publish,
- retry/idempotency,
- logging on submit flow.

Less likely:

- global JVM failure,
- network-wide outage,
- single bad pod,
- tenant-specific data skew.

---

## 6. Metrics First: What Changed?

Metrics are not root cause by themselves. Metrics tell us **where to look**.

### 6.1 HTTP Metrics

Observed:

```text
request rate:
  normal: 180 req/min
  incident: 420 req/min

POST /cases/submit latency:
  p50: 600ms -> 2.8s
  p95: 1.8s -> 18s
  p99: 3.5s -> 30s

error rate:
  5xx: 0.1% -> 7.8%
  4xx: stable
```

Interpretation:

- traffic doubled,
- latency exploded much more than traffic,
- error pattern is server-side, not validation-heavy,
- p95/p99 far worse than p50 suggests queueing, pool wait, lock wait, retry, throttling, or tail amplification.

### 6.2 HikariCP Metrics

Observed:

```text
hikaricp.connections.active:
  normal: 8-15
  incident: 40/40 maxed

hikaricp.connections.idle:
  normal: 20+
  incident: 0

hikaricp.connections.pending:
  normal: 0
  incident: 70-160

hikaricp.connections.timeout:
  normal: 0
  incident: increasing
```

Interpretation:

- DB pool is saturated.
- Threads are waiting for connections.
- But this does not yet prove DB is slow.
- Pool saturation can happen because:
  - queries are slow,
  - transactions are too long,
  - connections leak,
  - pool too small,
  - downstream call happens while transaction holds connection,
  - logging/audit blocks while holding connection,
  - duplicate retry storm increases concurrency.

### 6.3 DB Query Metrics

Observed:

```text
duplicate_check_query:
  p50: 90ms -> 1.2s
  p95: 220ms -> 9.8s
  p99: 400ms -> 22s

case_insert:
  p95: 80ms -> 140ms

audit_insert:
  p95: 110ms -> 450ms

commit_duration:
  p95: 150ms -> 8.5s
```

Interpretation:

- duplicate check became slow.
- commit duration also increased, possibly due to locks/contention.
- case insert itself is not the main latency.
- audit insert increased but not as much as duplicate check.
- DB problem appears query/lock/transaction-specific, not global DB outage.

### 6.4 Queue Metrics

Observed:

```text
publish_latency:
  normal p95: 30ms
  incident p95: 500ms

queue_backlog:
  normal: 1k
  incident: 45k

consumer_lag:
  increasing after 14:10
```

Interpretation:

- queue backlog starts after DB saturation.
- Could be downstream symptom because transactions complete slowly and publish bursts occur after retries.
- Could also be independent issue, but timeline suggests secondary.

### 6.5 JVM Metrics

Observed:

```text
heap usage:
  normal: 45-60%
  incident: 55-70%

GC pause:
  p95: 40ms
  max: 180ms

CPU usage:
  normal: 45%
  incident: 75%

CPU throttling:
  normal: near 0
  incident: visible on 4 pods

threads:
  platform threads: stable
  blocked/waiting threads: increased
```

Interpretation:

- GC is probably not primary.
- Heap not near OOM.
- CPU is elevated but not saturated at host level; throttling may add tail latency.
- Thread state evidence needed.

### 6.6 Logging Metrics

Observed:

```text
log_events_per_second:
  normal: 1,200/s across service
  incident: 9,500/s across service

DEBUG logs:
  normal: near 0
  incident: 7,000/s

stdout write latency:
  increased

logback async queue:
  utilization: 80-100%
  discarded debug events: high
```

Interpretation:

- Production DEBUG logging is an amplifier.
- It may increase CPU, allocation, stdout IO, and throttling.
- But DB pool saturation started before log queue saturation or roughly near it.
- Logging may be a major amplifier but not necessarily original root cause.

---

## 7. Logs: Convert Noise into Timeline

We search logs by `event.name`, not free text.

Important query dimensions:

```text
event.name
trace.id
correlation.id
request.id
case.id
idempotency.key
tenant.id
http.route
error.category
dependency.name
db.operation
retry.attempt
```

### 7.1 Example Structured Log Samples

Request accepted:

```json
{
  "timestamp": "2026-06-18T14:07:13.242+07:00",
  "severity": "INFO",
  "service.name": "case-command-service",
  "event.name": "case.submit.accepted",
  "trace.id": "4b12c7f9e1a34c4d97e65f9c44b52ad8",
  "span.id": "0f72c2a64c18d09b",
  "correlation.id": "corr-8a13b9",
  "request.id": "req-1290af",
  "idempotency.key": "idem-938f2d",
  "tenant.id": "agency-a",
  "actor.type": "external-user",
  "case.type": "LICENSE_RENEWAL"
}
```

Duplicate check slow:

```json
{
  "timestamp": "2026-06-18T14:07:22.942+07:00",
  "severity": "WARN",
  "event.name": "db.query.slow",
  "trace.id": "4b12c7f9e1a34c4d97e65f9c44b52ad8",
  "span.id": "a2e97c8a591b4f11",
  "db.operation": "duplicate_check",
  "db.statement.fingerprint": "select-count-case-by-applicant-status-type-window",
  "duration.ms": 9128,
  "threshold.ms": 1000
}
```

Connection pool wait:

```json
{
  "timestamp": "2026-06-18T14:07:24.110+07:00",
  "severity": "ERROR",
  "event.name": "db.connection.acquire.timeout",
  "trace.id": "9c41b8b7c33048d29520e3b754913f0e",
  "error.category": "RESOURCE_EXHAUSTED",
  "error.code": "DB_POOL_TIMEOUT",
  "hikari.pool.name": "main",
  "hikari.pending": 144,
  "timeout.ms": 30000
}
```

Duplicate case detected after retry:

```json
{
  "timestamp": "2026-06-18T14:14:08.333+07:00",
  "severity": "WARN",
  "event.name": "case.submit.duplicate_possible",
  "trace.id": "2f50de8d70e54e638bd835a0c04af8fd",
  "correlation.id": "corr-8a13b9",
  "idempotency.key": "idem-938f2d",
  "applicant.hash": "sha256:...",
  "case.type": "LICENSE_RENEWAL",
  "previous.case.id": "CASE-2026-001284",
  "current.case.id": "CASE-2026-001291"
}
```

Debug log storm:

```json
{
  "timestamp": "2026-06-18T14:11:01.129+07:00",
  "severity": "DEBUG",
  "event.name": "case.validation.rule.evaluated",
  "trace.id": "d18b9d9c7b8642afa70a4a7f634b720e",
  "rule.id": "RULE-337",
  "input.snapshot": "{...large payload...}",
  "duration.ms": 2
}
```

### 7.2 Immediate Log Findings

From logs:

1. `db.query.slow` for duplicate check begins after deployment.
2. `db.connection.acquire.timeout` begins after duplicate query latency increases.
3. duplicate case reports correlate with retry and missing idempotent completion record.
4. DEBUG logs include large payload snapshot.
5. Some logs contain high-cardinality fields and large body-like data.
6. Audit trail delay occurs because audit insert is within same overloaded transaction path.

Important conclusion:

```text
Logs suggest the incident is connected to duplicate-check query latency and idempotency weakness under timeout/retry. DEBUG logging amplifies runtime pressure.
```

But logs alone are not sufficient. We need traces and thread/JFR evidence.

---

## 8. Trace Analysis

We inspect slow traces for `POST /cases/submit`.

### 8.1 Normal Trace Shape

Normal trace:

```text
HTTP POST /cases/submit                          650ms
 ├─ validate request                              40ms
 ├─ load applicant profile                        80ms
 ├─ duplicate check                              120ms
 ├─ transaction: create case                     250ms
 │   ├─ insert case                               60ms
 │   ├─ insert audit                              80ms
 │   └─ commit                                   100ms
 ├─ publish case-submitted event                  40ms
 └─ response mapping                              20ms
```

### 8.2 Incident Trace Shape

Slow trace:

```text
HTTP POST /cases/submit                         28.4s
 ├─ validate request                             130ms
 ├─ load applicant profile                       190ms
 ├─ duplicate check                            12.6s
 ├─ transaction: create case                    9.4s
 │   ├─ insert case                              120ms
 │   ├─ insert audit                             420ms
 │   └─ commit                                  8.7s
 ├─ publish case-submitted event                 700ms
 └─ response mapping                              50ms
```

Failed trace:

```text
HTTP POST /cases/submit                         30.0s ERROR
 ├─ wait for db connection                     29.9s
 └─ error: DB_POOL_TIMEOUT
```

Retry trace from client:

```text
HTTP POST /cases/submit                         18.2s
 ├─ duplicate check                            10.1s
 ├─ transaction: create case                    7.2s
 └─ response 201
```

### 8.3 Trace Findings

Traces reveal:

- slow span is duplicate check and commit,
- connection wait spans dominate failed requests,
- queue publish is slower but not dominant,
- validation is noisy but not bottleneck,
- transaction duration is too long,
- duplicate submission has weak idempotency behavior.

Trace evidence improves the hypothesis:

```text
The submission flow has a slow duplicate-check query and transaction contention. Hikari pool saturation is a consequence of long-held DB connections. Client/application retries then create duplicate submissions because idempotency is not committed/resolved atomically.
```

But we still need thread/JFR evidence to confirm where threads spend time.

---

## 9. Thread Dump Analysis

We collect 3 thread dumps per pod, 10 seconds apart:

```bash
jcmd <pid> Thread.print -l > threaddump-1.txt
sleep 10
jcmd <pid> Thread.print -l > threaddump-2.txt
sleep 10
jcmd <pid> Thread.print -l > threaddump-3.txt
```

### 9.1 Dominant Patterns

Pattern A: waiting for DB connection

```text
"http-nio-8080-exec-184" WAITING
  at java.util.concurrent.locks.LockSupport.parkNanos
  at java.util.concurrent.SynchronousQueue$TransferStack.transfer
  at com.zaxxer.hikari.util.ConcurrentBag.borrow
  at com.zaxxer.hikari.pool.HikariPool.getConnection
  at com.zaxxer.hikari.HikariDataSource.getConnection
  at org.springframework.jdbc.datasource.DataSourceTransactionManager.doBegin
  at org.springframework.transaction.support.AbstractPlatformTransactionManager.startTransaction
  ...
  at com.company.case.SubmitCaseService.submit
```

Pattern B: executing duplicate query

```text
"http-nio-8080-exec-092" RUNNABLE
  at java.net.SocketInputStream.socketRead0
  at java.net.SocketInputStream.socketRead
  at oracle.jdbc.driver.T4CMAREngineNIO.prepareForUnmarshall
  at oracle.jdbc.driver.T4CTTIfun.receive
  at oracle.jdbc.driver.T4CPreparedStatement.doOall8
  ...
  at com.company.case.DuplicateCheckRepository.existsSimilarCase
```

Pattern C: commit waiting / DB response wait

```text
"http-nio-8080-exec-133" RUNNABLE
  at java.net.SocketInputStream.socketRead0
  ...
  at oracle.jdbc.driver.T4CConnection.doCommit
  at com.zaxxer.hikari.pool.ProxyConnection.commit
  at org.springframework.jdbc.datasource.DataSourceTransactionManager.doCommit
```

Pattern D: logging async worker under pressure

```text
"logback-async-appender-worker" RUNNABLE
  at java.io.FileOutputStream.writeBytes
  at java.io.FileOutputStream.write
  at ch.qos.logback.core.OutputStreamAppender.writeBytes
  at ch.qos.logback.core.encoder.LayoutWrappingEncoder.encode
```

### 9.2 Thread Dump Interpretation

Thread dumps confirm:

- many HTTP worker threads are blocked waiting for Hikari connections,
- some active threads are waiting on DB socket reads,
- several threads are committing slowly,
- logging worker is busy but not blocking most HTTP threads directly,
- no Java monitor deadlock,
- no obvious infinite CPU loop,
- no global ForkJoin starvation.

This supports DB/transaction/pool saturation path.

However, thread dump cannot explain **why duplicate query became slow**. We need DB plan/indices and recent change analysis.

---

## 10. JFR Analysis

We capture JFR during incident:

```bash
jcmd <pid> JFR.start name=incident settings=profile delay=0s duration=90s filename=/tmp/incident.jfr
```

Or if continuous recording was already running:

```bash
jcmd <pid> JFR.dump name=continuous filename=/tmp/incident-$(date +%s).jfr
```

### 10.1 JFR Findings

JFR summary:

```text
Execution samples:
  DB driver socket read dominates wall time in request threads

Socket Read:
  high duration on DB host:5432/1521

Java Monitor Blocked:
  low

Thread Park:
  high in Hikari connection acquire wait

File Write:
  increased stdout/log writes

Object Allocation:
  increased allocation from JSON logging payload snapshots

GC Pause:
  low/moderate, not matching latency spike

Exceptions:
  increased SQLTransientConnectionException
  increased client timeout exceptions

CPU samples:
  JSON serialization and logging formatting visible but not top primary cost
```

### 10.2 JFR Interpretation

JFR confirms:

- high latency mostly wall time waiting on DB/pool, not CPU computation,
- logging increased allocation and file writes,
- GC pause not primary,
- CPU throttling likely exacerbated tail latency but not primary root,
- connection acquire waits are major failed-request contributor.

JFR helps avoid wrong conclusions:

Wrong:

```text
CPU increased, therefore CPU bottleneck.
```

Better:

```text
CPU increased partly due to log serialization, but wall-clock latency is dominated by DB socket wait and Hikari connection acquire wait.
```

Wrong:

```text
GC caused latency.
```

Better:

```text
GC pause does not align with p95/p99 latency spikes. GC is not primary.
```

---

## 11. async-profiler Analysis

We run two profiles:

```bash
asprof -e wall -d 60 -f wall.html <pid>
asprof -e cpu  -d 30 -f cpu.html  <pid>
```

### 11.1 Wall-Clock Profile

Dominant stacks:

```text
Thread waiting for Hikari connection
DB driver socket read
DB commit socket wait
stdout/logback write
HTTP client notification retry wait
```

Wall-clock profile answers:

> Where does elapsed time go?

Answer:

```text
Mostly waiting for DB connection or DB response. Some time in logging IO and notification retry waits.
```

### 11.2 CPU Profile

Dominant stacks:

```text
JSON logging serialization
validation rule evaluation
Jackson serialization
DB result mapping
small amount in GC/JIT/runtime
```

CPU profile answers:

> Where does CPU time go?

Answer:

```text
CPU is not the dominant reason for 30s latency, but DEBUG payload logging meaningfully increases CPU and allocation.
```

### 11.3 Profiler Conclusion

async-profiler separates two things:

- user-visible latency dominated by wall time wait,
- CPU overhead amplified by logging/config change.

This is a classic production trap: CPU profile alone would blame JSON/logging; metrics alone might blame DB; logs alone might blame duplicate check. Correct diagnosis needs cross-signal correlation.

---

## 12. Recent Change Analysis

Recent changes:

```text
13:42 Deployment v2026.06.18-13.40
13:45 DEBUG logging enabled for com.company.case
13:47 duplicate-check feature flag enabled
13:50 notification retry maxAttempts 2 -> 5
```

We inspect diff.

### 12.1 Duplicate Check Change

Old logic:

```sql
SELECT 1
FROM cases
WHERE applicant_id = ?
  AND case_type = ?
  AND status IN ('SUBMITTED', 'PROCESSING')
FETCH FIRST 1 ROW ONLY
```

Old index:

```sql
CREATE INDEX idx_cases_applicant_type_status
ON cases(applicant_id, case_type, status);
```

New logic:

```sql
SELECT COUNT(*)
FROM cases
WHERE applicant_id = ?
  AND case_type = ?
  AND status IN ('SUBMITTED', 'PROCESSING', 'PENDING_PAYMENT')
  AND created_at >= ?
  AND LOWER(normalized_address) = LOWER(?)
```

Problem:

```text
LOWER(normalized_address) prevents efficient use of existing plain column index.
created_at is added without supporting composite/function index.
COUNT(*) scans more than EXISTS/FETCH FIRST.
```

Potential DB plan:

```text
Before:
  index range scan on idx_cases_applicant_type_status
  stop after first match

After:
  index range scan less selective or full/large scan
  filter lower(normalized_address)
  count all matches
```

### 12.2 Transaction Boundary Change

Old service:

```java
public SubmitResult submit(Command command) {
    duplicateChecker.ensureNoDuplicate(command); // outside transaction

    return transactionTemplate.execute(tx -> {
        Case c = caseRepository.insert(command);
        auditRepository.insertCreated(c);
        outboxRepository.insertCaseSubmitted(c);
        return SubmitResult.created(c.id());
    });
}
```

New service:

```java
@Transactional
public SubmitResult submit(Command command) {
    duplicateChecker.ensureNoDuplicate(command); // now inside transaction

    Case c = caseRepository.insert(command);
    auditRepository.insertCreated(c);
    notificationClient.notifyApplicant(c); // external call inside transaction
    eventPublisher.publishCaseSubmitted(c); // direct publish inside transaction
    return SubmitResult.created(c.id());
}
```

This is a serious design regression.

Consequences:

- duplicate check holds transaction connection,
- notification retry holds DB connection,
- queue publish may hold connection,
- commit contention increases,
- pool saturates faster,
- failures occur after partial side effects,
- duplicate idempotency record may not be committed before timeout/retry.

### 12.3 Logging Change

DEBUG enabled plus payload snapshot:

```java
log.debug("validation input snapshot={}", objectMapper.writeValueAsString(command));
```

Issues:

- expensive even if DEBUG enabled,
- large payload,
- possible PII leakage,
- allocation increase,
- log ingestion spike,
- stdout pressure,
- CPU throttling risk.

### 12.4 Retry Change

Notification retry changed:

```text
maxAttempts=2 -> 5
backoff=100ms fixed
timeout=3s per attempt
```

Inside transaction, worst-case notification time:

```text
5 * 3s + backoff ~= 15s+
```

This can hold DB connection for too long.

### 12.5 Idempotency Weakness

Idempotency implemented as:

```text
check if key exists
process case
insert idempotency record at end
```

This is not safe under timeout/retry.

Correct mental model:

```text
Idempotency key must be claimed atomically before side effects, or protected by a unique constraint / state machine.
```

---

## 13. Hypothesis Tree

At this point, build hypothesis tree.

```text
Incident: POST /cases/submit latency + 5xx + duplicates

H1: DB is globally slow
  Evidence for:
    DB query latency high
  Evidence against:
    read endpoints normal
    insert mostly normal
    specific duplicate query slow
  Status:
    unlikely as global root cause

H2: New duplicate-check query is inefficient
  Evidence for:
    duplicate_check span dominates latency
    recent feature flag
    query changed to COUNT + LOWER + created_at
    DB query metrics show p95 9.8s
  Evidence against:
    does not alone explain notification retry and duplicates
  Status:
    strong contributing/root cause candidate

H3: Transaction boundary holds DB connection while doing slow external work
  Evidence for:
    new @Transactional wraps duplicate check + notification + publish
    Hikari active maxed
    thread dumps show pool waits
    commit duration high
  Evidence against:
    need code/diff confirmation
  Status:
    strong root cause candidate

H4: Logging DEBUG caused incident
  Evidence for:
    log volume 8x
    CPU throttling
    JFR allocation/file write increase
  Evidence against:
    DB duplicate query latency starts before/with saturation
    wall profile dominated by DB/pool
  Status:
    amplifier, not sole root cause

H5: GC caused latency
  Evidence for:
    allocation up
  Evidence against:
    GC pause low, no alignment with p95
  Status:
    rejected

H6: Queue broker is root cause
  Evidence for:
    backlog increased
  Evidence against:
    backlog begins after DB saturation
    publish latency smaller than DB wait
  Status:
    downstream symptom/amplifier

H7: Kubernetes CPU throttling root cause
  Evidence for:
    throttling warning
  Evidence against:
    thread/JFR wall wait mostly DB/pool
    p95 dominated by DB spans
  Status:
    amplifier
```

Current best explanation:

```text
Primary root cause:
  A deployment changed submission flow so expensive duplicate-check query and external notification/publish operations run inside a database transaction, causing long DB connection hold time and Hikari pool saturation under traffic.

Major contributing causes:
  The new duplicate-check query is inefficient due to COUNT + LOWER(normalized_address) + missing supporting index/function index.
  Idempotency is implemented non-atomically, allowing duplicate creation when clients retry after timeout.
  Production DEBUG logging emits large payload snapshots, increasing CPU/allocation/stdout/log ingestion and amplifying tail latency.
  Notification retry policy was increased and executed inside transaction, further extending connection hold time.
```

---

## 14. Root Cause Narrative

A defensible RCA should distinguish:

- trigger,
- root cause,
- contributing factors,
- symptoms,
- detection,
- impact.

### 14.1 Trigger

```text
The incident was triggered by production traffic increase after deployment/config changes on 2026-06-18. The new duplicate-check feature flag and transaction boundary change became active shortly before the alert window.
```

### 14.2 Technical Root Cause

```text
The submission path held database connections for too long because expensive duplicate checking and external side effects were executed inside a transactional method. Under increased traffic, active Hikari connections reached max capacity and new requests waited until connection acquisition timeout.
```

### 14.3 Query-Level Cause

```text
The new duplicate-check query changed from existence lookup to COUNT-based lookup with LOWER(normalized_address) and created_at filtering without a supporting index/function index, increasing p95 query duration from hundreds of milliseconds to multiple seconds.
```

### 14.4 Duplicate Case Cause

```text
Idempotency handling was non-atomic. The system checked for an idempotency key before processing but inserted the completion record only after side effects. When clients retried after timeout, some requests created additional cases because the original request had not yet committed or had committed partial state without a completed idempotency record visible to the retry path.
```

### 14.5 Amplifiers

```text
DEBUG payload logging increased log volume by approximately 8x and added CPU/allocation/stdout pressure. The notification retry policy increased worst-case external wait time while the DB transaction was open. CPU throttling and queue backlog amplified tail latency but were not the initiating cause.
```

### 14.6 Rejected Causes

```text
GC was not a primary cause because JFR and JVM metrics showed GC pauses were low and did not align with request latency spikes. The queue broker was not primary because backlog increased after DB pool saturation. No single pod issue or JVM deadlock was found.
```

---

## 15. Mitigation Plan

Mitigation must reduce impact quickly without making data consistency worse.

### 15.1 Immediate Mitigation Priority

Do not start with tuning heap or increasing DB pool blindly.

First mitigation candidates:

1. Disable dangerous DEBUG logging.
2. Disable duplicate-check feature flag or revert query.
3. Reduce notification retry attempts.
4. Move notification call out of transaction if hotfix possible.
5. Temporarily increase application replicas if DB can handle it.
6. Temporarily reduce inbound concurrency if DB cannot handle it.
7. Enable stricter idempotency guard or temporarily reject duplicate retry windows.
8. Drain queue backlog after write path stabilizes.

### 15.2 Immediate Actions

Action A — disable DEBUG:

```text
Set com.company.case logging level back to INFO.
Remove payload snapshot logging from production path.
```

Expected effect:

- reduce CPU,
- reduce allocation,
- reduce stdout pressure,
- reduce log ingestion load.

Action B — disable duplicate-check feature flag:

```text
duplicateCheck.v2.enabled=false
```

Expected effect:

- restore old indexed existence check,
- reduce DB query latency,
- reduce connection hold time.

Action C — reduce notification retry:

```text
notification.retry.maxAttempts=2
notification.retry.timeout=1s
```

But ideally notification should not happen inside transaction.

Action D — protect concurrency:

```text
Reduce max concurrent submit workers / HTTP max threads / rate-limit submit path temporarily.
```

This prevents pool thrash.

Action E — freeze risky writes if duplicates continue:

```text
Temporarily require idempotency key for submission.
Reject repeated same idempotency key while IN_PROGRESS.
```

### 15.3 What Not to Do First

Avoid:

```text
Increase Hikari pool from 40 to 200
```

Why?

- can overload DB,
- can increase lock contention,
- can make incident worse,
- masks connection hold-time bug.

Avoid:

```text
Increase Kubernetes CPU limit only
```

Why?

- may reduce throttling but does not fix DB pool saturation.

Avoid:

```text
Disable all logging
```

Why?

- destroys evidence during active incident.
- Instead reduce DEBUG/noisy logs and preserve WARN/ERROR/business events.

Avoid:

```text
Restart all pods repeatedly
```

Why?

- may temporarily clear queues but not root cause,
- can drop in-memory context,
- may increase retry storm.

---

## 16. Permanent Fix Design

### 16.1 Transaction Boundary Fix

Bad:

```java
@Transactional
public SubmitResult submit(Command command) {
    duplicateChecker.ensureNoDuplicate(command);
    Case c = caseRepository.insert(command);
    auditRepository.insertCreated(c);
    notificationClient.notifyApplicant(c);
    eventPublisher.publishCaseSubmitted(c);
    return SubmitResult.created(c.id());
}
```

Better:

```java
public SubmitResult submit(Command command) {
    IdempotencyClaim claim = idempotencyService.claim(command.idempotencyKey(), command.requestHash());

    if (claim.isCompleted()) {
        return claim.previousResult();
    }

    duplicateChecker.ensureNoDuplicate(command);

    CaseCreated created = transactionTemplate.execute(tx -> {
        Case c = caseRepository.insert(command);
        auditRepository.insertCreated(c);
        outboxRepository.insertCaseSubmitted(c);
        idempotencyService.markCompleted(command.idempotencyKey(), c.id());
        return new CaseCreated(c.id());
    });

    return SubmitResult.created(created.caseId());
}
```

Key improvements:

- idempotency claimed before side effects,
- transaction contains only DB state changes,
- notification is not inside transaction,
- event publishing goes through outbox,
- duplicate check can be optimized separately,
- retry returns previous result safely.

### 16.2 Idempotency State Machine

Use states:

```text
CLAIMED
PROCESSING
COMPLETED
FAILED_RETRIABLE
FAILED_FINAL
EXPIRED
```

Required constraints:

```sql
CREATE UNIQUE INDEX uk_idempotency_key
ON idempotency_record(idempotency_key);

CREATE UNIQUE INDEX uk_case_business_dedup
ON cases(applicant_id, case_type, normalized_address_hash, active_dedup_window);
```

Pseudo-flow:

```text
1. Client sends idempotency key.
2. Server atomically inserts CLAIMED.
3. If key exists:
   - same request hash + COMPLETED => return stored result.
   - same request hash + PROCESSING => return 202/409/retry-after.
   - different request hash => reject.
4. Process DB state.
5. Mark COMPLETED inside same DB transaction as case creation.
```

### 16.3 Duplicate Query Fix

Replace:

```sql
SELECT COUNT(*)
FROM cases
WHERE ...
```

With:

```sql
SELECT 1
FROM cases
WHERE applicant_id = ?
  AND case_type = ?
  AND status IN (...)
  AND normalized_address_hash = ?
  AND created_at >= ?
FETCH FIRST 1 ROW ONLY
```

Index:

```sql
CREATE INDEX idx_cases_dedup_lookup
ON cases(applicant_id, case_type, normalized_address_hash, status, created_at);
```

Or database-specific function index if normalization must be done in DB:

```sql
CREATE INDEX idx_cases_lower_address_dedup
ON cases(applicant_id, case_type, LOWER(normalized_address), status, created_at);
```

But better is precompute normalized hash at write time.

### 16.4 Outbox Pattern

Inside transaction:

```text
insert case
insert audit
insert outbox event
mark idempotency completed
commit
```

Outside transaction:

```text
outbox relay publishes event
notification consumer sends notification
retry is isolated from case creation transaction
```

Benefits:

- no network call inside DB transaction,
- retry does not hold connection,
- queue failure does not corrupt DB write,
- event publish becomes recoverable.

### 16.5 Logging Fix

Remove payload DEBUG logs.

Replace:

```java
log.debug("validation input snapshot={}", objectMapper.writeValueAsString(command));
```

With structured, safe, low-cardinality log:

```java
log.debug("case.validation.completed caseType={} ruleCount={} failedRuleCount={}",
        command.caseType(),
        result.ruleCount(),
        result.failedRuleCount());
```

For audit/security:

```java
log.info("case.submit.completed caseId={} outcome={} durationMs={}",
        caseId,
        "success",
        durationMs);
```

Never log:

- full request body,
- tokens,
- PII,
- documents,
- raw address,
- full profile data.

### 16.6 Retry Fix

Do not retry everything.

Classify errors:

```text
validation failure       => no retry
duplicate conflict       => no retry
authorization failure    => no retry
DB pool exhausted        => maybe retry with backoff, but prefer backpressure
external notification    => retry async outside transaction
queue publish            => outbox retry
```

Retry policy:

```text
maxAttempts: small
backoff: exponential + jitter
deadline: bounded
idempotency: required for mutating operation
```

---

## 17. Observability Improvements

Incident revealed gaps.

### 17.1 Missing Metrics

Add:

```text
case_submit_duration_seconds
case_submit_duplicate_check_duration_seconds
case_submit_transaction_duration_seconds
case_submit_idempotency_claim_total
case_submit_idempotency_conflict_total
case_submit_in_progress_total
case_submit_duplicate_detected_total
case_submit_outbox_insert_total
case_submit_outbox_publish_lag_seconds
```

Labels must be low-cardinality:

```text
case.type
outcome
error.category
dependency
```

Avoid labels:

```text
case.id
user.id
idempotency.key
address
applicant.id
```

### 17.2 Better Trace Spans

Add manual spans:

```text
case.submit.validate
case.submit.idempotency.claim
case.submit.duplicate_check
case.submit.transaction
case.submit.audit_insert
case.submit.outbox_insert
case.submit.idempotency.complete
```

Attributes:

```text
case.type
tenant.id/hash/classification
idempotency.status
duplicate_check.version
outcome
error.category
```

Do not include:

```text
raw applicant id
raw address
raw payload
document content
```

### 17.3 Better Logs

Essential events:

```text
case.submit.accepted
case.submit.idempotency.claimed
case.submit.idempotency.replayed
case.submit.duplicate_check.slow
case.submit.transaction.completed
case.submit.completed
case.submit.failed
case.submit.outbox.created
case.submit.outbox.publish.failed
```

Each event should include:

```text
trace.id
span.id
correlation.id
request.id
idempotency.key.hash
case.type
outcome
duration.ms
error.category
```

### 17.4 Alert Improvements

Add alerts:

```text
Submit p95 latency high
Submit error rate high
Hikari pending > 0 sustained
DB connection acquisition timeout > 0
Duplicate check p95 high
Transaction duration p95 high
Idempotency conflict spike
Outbox lag high
Log volume spike
DEBUG log enabled in production
CPU throttling sustained
```

### 17.5 Dashboards

Dashboard panels:

1. Submit health:
   - rate,
   - p50/p95/p99,
   - errors,
   - saturation.

2. Submit breakdown:
   - validation,
   - duplicate check,
   - transaction,
   - audit,
   - outbox.

3. DB pool:
   - active,
   - idle,
   - pending,
   - timeout.

4. Idempotency:
   - claimed,
   - replayed,
   - conflict,
   - in progress.

5. Logging:
   - events/sec,
   - level distribution,
   - dropped logs,
   - stdout latency.

6. Runtime:
   - CPU,
   - throttling,
   - heap,
   - GC,
   - threads.

7. Queue/outbox:
   - backlog,
   - publish lag,
   - failure rate.

---

## 18. Evidence-Backed RCA Template

A mature RCA should be short but evidence-dense.

### 18.1 Executive Summary

```text
On 2026-06-18 between 14:07 and 14:30 Asia/Jakarta, POST /cases/submit experienced elevated latency and intermittent 5xx responses. The incident was caused by a submission flow change that executed an expensive duplicate-check query and external side effects inside a database transaction, increasing DB connection hold time and saturating the HikariCP pool. A non-atomic idempotency implementation allowed duplicate cases during client retries. DEBUG payload logging and increased notification retries amplified CPU/allocation/stdout pressure and tail latency.
```

### 18.2 Impact

```text
Affected operation:
  POST /cases/submit

Unaffected operations:
  case view/list and most read-only operations

User impact:
  intermittent timeouts
  delayed confirmation
  some duplicate case creation

Operational impact:
  queue backlog
  delayed audit trail visibility
  increased log ingestion volume
```

### 18.3 Root Cause

```text
The new release expanded the transactional boundary around duplicate check, case insert, audit insert, notification call, and event publish. The duplicate-check query was also changed to a slower COUNT-based query with non-index-friendly address normalization. Under increased traffic, request threads held DB connections for multiple seconds, saturating the 40-connection HikariCP pool. New requests waited for connections and timed out.
```

### 18.4 Contributing Factors

```text
1. DEBUG logging was enabled in production for the submission package and logged large validation payload snapshots.
2. Notification retry attempts were increased and executed while the DB transaction was open.
3. Idempotency records were written at the end of processing, not atomically claimed before side effects.
4. Missing alert on duplicate-check p95 latency delayed precise detection.
```

### 18.5 Detection

```text
Detected by:
  HTTP p95 latency alert
  5xx rate alert
  DB pool pending connections alert

Not detected early enough by:
  duplicate-check span latency
  transaction duration
  idempotency conflict rate
  DEBUG log volume alert
```

### 18.6 What Went Well

```text
Structured logs included trace.id and correlation.id.
OpenTelemetry traces identified duplicate_check and transaction spans as dominant.
Thread dumps confirmed Hikari pool wait.
JFR separated DB wait from GC/CPU.
```

### 18.7 What Went Poorly

```text
DEBUG logging was enabled in production without guardrail.
The transaction boundary change was not reviewed for connection hold time.
The duplicate-check query lacked explain-plan/load-test validation.
Idempotency was not modeled as an atomic state machine.
```

### 18.8 Action Items

Immediate:

```text
Disable DEBUG logging.
Disable duplicate-check v2 feature flag.
Reduce notification retry attempts.
Apply rate limiting to submit endpoint.
```

Short-term:

```text
Move notification/event publish out of transaction via outbox.
Rewrite duplicate check to indexed EXISTS query.
Add idempotency claim/complete state machine.
Add alerts for duplicate-check latency and transaction duration.
```

Long-term:

```text
Add PR review checklist for transaction boundaries.
Add load test for submit path with observability assertions.
Add CI query-plan validation for critical queries.
Add production logging governance to prevent unsafe DEBUG payload logs.
```

---

## 19. End-to-End Investigation Workflow

This is the reusable workflow.

### Step 1 — State the Incident Without Guessing

```text
What operation is affected?
What symptom is user-visible?
When did it start?
How severe is it?
What is unaffected?
```

### Step 2 — Establish Timeline

```text
Alerts
deployments
config changes
traffic changes
dependency events
first error
first recovery
```

### Step 3 — Determine Blast Radius

```text
all routes or one route?
all pods or one pod?
all tenants or one tenant?
all dependencies or one dependency?
read and write paths both affected?
```

### Step 4 — Read Metrics for Direction

```text
latency
traffic
errors
saturation
pool metrics
GC
CPU
queue backlog
log volume
```

### Step 5 — Use Traces for Path Breakdown

```text
Which span dominates?
Is time spent before DB, inside DB, waiting for connection, external dependency, queue publish, or app logic?
```

### Step 6 — Use Logs for State and Error Semantics

```text
event.name
outcome
error.category
retry.attempt
idempotency.status
business key hash
```

### Step 7 — Use Thread Dump/JFR/Profiler for Runtime Truth

```text
thread states
wall-clock waiting
CPU hotspots
allocation pressure
lock contention
socket/file IO
GC events
```

### Step 8 — Check Recent Changes

```text
code
config
feature flags
schema/index
traffic
infra
dependency
logging level
retry policy
```

### Step 9 — Build Hypothesis Tree

Each hypothesis needs:

```text
evidence for
evidence against
missing evidence
confidence
next test
```

### Step 10 — Mitigate Safely

Mitigation should reduce user impact while preserving data correctness.

### Step 11 — Confirm Recovery

Watch:

```text
p95/p99 latency
5xx rate
pool pending
query latency
queue backlog
CPU throttling
log volume
duplicate rate
```

### Step 12 — Write RCA

Make it evidence-backed and action-oriented.

---

## 20. Capstone Checklist

A top-tier engineer should be able to answer each item.

### 20.1 Runtime Evidence

- [ ] Can identify which signal answers which question.
- [ ] Can avoid blaming the loudest metric.
- [ ] Can correlate logs/traces/metrics/dumps/profiles.
- [ ] Can separate root cause, trigger, amplifier, symptom.

### 20.2 Logging

- [ ] Can query logs by `event.name`, not random text.
- [ ] Can detect unsafe DEBUG payload logging.
- [ ] Can distinguish diagnostic logs from audit logs.
- [ ] Can identify missing correlation fields.

### 20.3 Tracing

- [ ] Can interpret trace breakdown.
- [ ] Can detect bad span design.
- [ ] Can separate connection wait from query execution.
- [ ] Can identify retry/fan-out amplification.

### 20.4 Metrics

- [ ] Can read RED/USE signals.
- [ ] Can detect pool saturation.
- [ ] Can avoid high-cardinality labels.
- [ ] Can define missing SLI/SLO.

### 20.5 JVM Diagnostics

- [ ] Can collect thread dumps safely.
- [ ] Can use `jcmd` for JFR/heap/thread evidence.
- [ ] Can interpret JFR wall-time vs CPU-time evidence.
- [ ] Can use async-profiler appropriately.

### 20.6 Java Architecture

- [ ] Can identify transaction boundary mistakes.
- [ ] Can detect external call inside transaction.
- [ ] Can design outbox/idempotency fix.
- [ ] Can classify retry-safe vs retry-unsafe failures.

### 20.7 Kubernetes

- [ ] Can distinguish JVM OOM from `OOMKilled`.
- [ ] Can interpret CPU throttling as amplifier.
- [ ] Can understand stdout logging pressure.
- [ ] Can use pod events as evidence.

### 20.8 RCA

- [ ] Can write clear impact statement.
- [ ] Can explain root cause with evidence.
- [ ] Can list rejected hypotheses.
- [ ] Can produce mitigation and permanent fix plan.

---

## 21. Final Mental Model

The whole series can be compressed into one principle:

> Production systems do not tell the truth through one signal. They tell partial truths through many signals. Your job is to reconstruct the causal story without lying to yourself.

Logs tell you:

```text
what events happened and what the application believed at boundaries
```

Metrics tell you:

```text
how much, how often, how slow, how saturated
```

Traces tell you:

```text
where request time went across components
```

Thread dumps tell you:

```text
what threads were doing at a point in time
```

JFR tells you:

```text
what the JVM observed over a time window
```

Profilers tell you:

```text
where CPU/wall/allocation/lock/native cost accumulated
```

Kubernetes events tell you:

```text
what the runtime platform did to your process
```

Database evidence tells you:

```text
whether data access patterns, locks, plans, or transactions are causing delay
```

RCA tells you:

```text
what actually caused impact and how to prevent recurrence
```

The top 1% difference is not memorizing every command. It is knowing:

- which evidence is relevant,
- which evidence is misleading,
- what question each signal can answer,
- when a symptom is not a cause,
- how architecture choices create runtime failure modes,
- how to fix the system instead of only silencing alerts.

---

## 22. Suggested Personal Practice

To internalize this capstone, repeat the same incident with different root causes.

Create variants:

1. GC root cause:
   - allocation storm,
   - humongous objects,
   - Full GC,
   - latency spike.

2. DB lock root cause:
   - one long transaction,
   - lock wait cascade,
   - pool saturation.

3. Logging root cause:
   - synchronous network appender,
   - DEBUG payload logging,
   - stdout backpressure.

4. External dependency root cause:
   - missing timeout,
   - retry storm,
   - circuit breaker absent.

5. Kubernetes root cause:
   - CPU throttling,
   - memory limit too low,
   - bad readiness probe.

6. Async workflow root cause:
   - poison message,
   - DLQ not monitored,
   - idempotency missing.

For each variant, produce:

```text
timeline
metrics
sample logs
trace tree
thread dump excerpt
JFR/profiler finding
hypothesis tree
mitigation
RCA
permanent fix
observability backlog
```

This practice will move knowledge from “I understand the material” to “I can operate under production pressure”.

---

## 23. End of Series

This is the final part of:

```text
learn-java-logging-observability-profiling-troubleshooting-engineering
```

You have now covered the complete arc:

```text
logging semantics
  -> logging frameworks
  -> structured logging
  -> context propagation
  -> OpenTelemetry
  -> metrics/traces/logs correlation
  -> secure/performance-aware logging
  -> exception taxonomy
  -> JFR/profiling/JVM diagnostics
  -> memory/thread/GC troubleshooting
  -> dependency/async/Kubernetes observability
  -> governance/starter kit
  -> end-to-end incident diagnosis
```

The next natural advanced series after this would not be “more logging”. It would be one of:

1. **Java Reliability Engineering and Failure Injection**
   - chaos testing,
   - timeout budget,
   - retries,
   - bulkheads,
   - circuit breakers,
   - degradation,
   - operational semantics.

2. **Java Performance Engineering Deep Dive**
   - JIT,
   - GC internals,
   - allocation,
   - CPU cache,
   - concurrency bottleneck,
   - benchmarking,
   - profiling-heavy case studies.

3. **Production Architecture for Regulated Enterprise Systems**
   - auditability,
   - state machines,
   - case lifecycle,
   - idempotency,
   - workflow integrity,
   - evidence-grade system design.

4. **Distributed Systems Incident Simulation Lab**
   - many capstones,
   - one incident per module,
   - full evidence sets,
   - root cause and mitigation practice.

---

## 24. Final Takeaway

A production Java system is not “observable” because it has logs, dashboards, or traces.

It is observable when an engineer can answer, quickly and defensibly:

```text
what happened,
where it happened,
why it happened,
who/what was affected,
how bad it was,
what changed,
what to do now,
what to fix permanently,
and what evidence supports the conclusion.
```

That is the standard this series has been building toward.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./34-building-production-grade-java-observability-starter-kit.md">⬅️ Part 34 — Building a Production-Grade Java Observability Starter Kit</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<span></span>
</div>
