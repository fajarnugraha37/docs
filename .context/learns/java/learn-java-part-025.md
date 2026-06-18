# learn-java-part-025.md

# Bagian 25 — Production Case Studies dan Reference Architecture Playbook

> Target pembaca: Java engineer yang sudah memahami fondasi Java hingga capstone, lalu ingin melatih “insting produksi”: bagaimana membaca gejala, membuat hipotesis, memilih evidence, memperbaiki sistem, dan merancang arsitektur Java yang siap menghadapi failure nyata.
>
> Target hasil: kamu mampu mengambil seluruh pengetahuan Java—language, JVM, GC, concurrency, security, testing, framework, cloud, performance, migration, domain modeling—dan menerapkannya dalam skenario production nyata secara sistematis.

---

## Daftar Isi

1. [Orientasi: Dari Pengetahuan ke Judgment](#1-orientasi-dari-pengetahuan-ke-judgment)
2. [Cara Membaca Case Study Production](#2-cara-membaca-case-study-production)
3. [Template Analisis Incident Java](#3-template-analisis-incident-java)
4. [Reference Architecture 1: Java REST Service Production-Grade](#4-reference-architecture-1-java-rest-service-production-grade)
5. [Reference Architecture 2: Command Service dengan Outbox dan Kafka](#5-reference-architecture-2-command-service-dengan-outbox-dan-kafka)
6. [Reference Architecture 3: Query Service dan Read Model](#6-reference-architecture-3-query-service-dan-read-model)
7. [Reference Architecture 4: Worker/Consumer Service](#7-reference-architecture-4-workerconsumer-service)
8. [Reference Architecture 5: Java Service di Kubernetes](#8-reference-architecture-5-java-service-di-kubernetes)
9. [Case Study 1: Latency Naik Setelah Deployment](#9-case-study-1-latency-naik-setelah-deployment)
10. [Case Study 2: Container OOMKilled Tanpa Heap Dump](#10-case-study-2-container-oomkilled-tanpa-heap-dump)
11. [Case Study 3: Java Heap OOM karena Cache Tidak Bounded](#11-case-study-3-java-heap-oom-karena-cache-tidak-bounded)
12. [Case Study 4: DB Pool Exhaustion Saat HPA Scale Out](#12-case-study-4-db-pool-exhaustion-saat-hpa-scale-out)
13. [Case Study 5: Kafka Lag Tidak Turun Walau Pod Ditambah](#13-case-study-5-kafka-lag-tidak-turun-walau-pod-ditambah)
14. [Case Study 6: Duplicate Command Menghasilkan Double Side Effect](#14-case-study-6-duplicate-command-menghasilkan-double-side-effect)
15. [Case Study 7: `@Transactional` Tidak Bekerja karena Self-Invocation](#15-case-study-7-transactional-tidak-bekerja-karena-self-invocation)
16. [Case Study 8: N+1 Query Setelah Refactor DTO](#16-case-study-8-n1-query-setelah-refactor-dto)
17. [Case Study 9: CPU Tinggi karena Regex Catastrophic Backtracking](#17-case-study-9-cpu-tinggi-karena-regex-catastrophic-backtracking)
18. [Case Study 10: CPU Throttling yang Disangka GC Problem](#18-case-study-10-cpu-throttling-yang-disangka-gc-problem)
19. [Case Study 11: Thread Pool Starvation karena Blocking di Common Pool](#19-case-study-11-thread-pool-starvation-karena-blocking-di-common-pool)
20. [Case Study 12: Virtual Thread Adoption yang Membanjiri Database](#20-case-study-12-virtual-thread-adoption-yang-membanjiri-database)
21. [Case Study 13: JSON Contract Break Setelah Upgrade Jackson](#21-case-study-13-json-contract-break-setelah-upgrade-jackson)
22. [Case Study 14: Java 8 ke 17 Gagal karena Strong Encapsulation](#22-case-study-14-java-8-ke-17-gagal-karena-strong-encapsulation)
23. [Case Study 15: Security Regression karena Trust-All TLS](#23-case-study-15-security-regression-karena-trust-all-tls)
24. [Case Study 16: Observability Blind Spot Saat Incident](#24-case-study-16-observability-blind-spot-saat-incident)
25. [Case Study 17: Slow Startup dan Probe Restart Loop](#25-case-study-17-slow-startup-dan-probe-restart-loop)
26. [Case Study 18: Graceful Shutdown Gagal dan Message Hilang](#26-case-study-18-graceful-shutdown-gagal-dan-message-hilang)
27. [Case Study 19: Clock/Timezone Bug di Deadline Regulatori](#27-case-study-19-clocktimezone-bug-di-deadline-regulatori)
28. [Case Study 20: Audit Trail Tidak Bisa Menjelaskan Keputusan](#28-case-study-20-audit-trail-tidak-bisa-menjelaskan-keputusan)
29. [Playbook: Memilih Solusi Berdasarkan Failure Mode](#29-playbook-memilih-solusi-berdasarkan-failure-mode)
30. [Playbook: Evidence Matrix untuk Java Production](#30-playbook-evidence-matrix-untuk-java-production)
31. [Playbook: Architecture Review Board untuk Java Services](#31-playbook-architecture-review-board-untuk-java-services)
32. [Practical Labs](#32-practical-labs)
33. [Final Integrated Project](#33-final-integrated-project)
34. [Referensi Resmi](#34-referensi-resmi)

---

# 1. Orientasi: Dari Pengetahuan ke Judgment

Setelah mempelajari banyak topik Java, tantangan berikutnya bukan lagi “tahu fitur”. Tantangan berikutnya adalah judgment.

Judgment berarti kemampuan untuk menjawab:

```text
Dalam situasi ini, pengetahuan mana yang relevan?
Evidence apa yang harus dilihat?
Hipotesis apa yang paling mungkin?
Perubahan apa yang paling aman?
Apa trade-off yang harus diterima?
Apa yang tidak boleh dilakukan walaupun terlihat cepat?
```

Engineer pemula sering melihat incident seperti daftar error:

```text
timeout
OOM
lag
GC
CPU
DB
Kafka
```

Engineer senior melihatnya sebagai sistem sebab-akibat:

```text
traffic naik
  → request concurrency naik
  → DB pool pending naik
  → request latency naik
  → client retry naik
  → traffic efektif naik lagi
  → HPA menambah pod
  → total DB connection naik
  → DB makin lambat
  → error rate naik
```

Java production engineering adalah latihan membaca causal chain.

## 1.1 Case study melatih insting

Case study bukan cerita. Case study adalah simulasi pengambilan keputusan.

Setiap case harus menjawab:

1. Apa gejalanya?
2. Apa impact-nya?
3. Apa hipotesis awal?
4. Evidence apa yang mendukung/menolak?
5. Apa mitigasi cepat?
6. Apa root cause?
7. Apa fix permanen?
8. Apa test/monitoring yang mencegah regresi?
9. Apa standar yang perlu diubah?
10. Apa pelajaran arsitekturalnya?

## 1.2 Kenapa Java-specific?

Banyak failure mode umum terjadi di semua bahasa, tetapi Java punya pola khusus:

- heap vs native memory;
- GC pause/allocation pressure;
- JIT warmup;
- thread pool starvation;
- virtual thread misuse;
- reflection/proxy framework magic;
- `@Transactional` proxy boundaries;
- `ObjectMapper`/Jackson behavior;
- Hibernate lazy loading/N+1;
- JVM container ergonomics;
- JFR diagnostics;
- strong encapsulation migration;
- APM agent bytecode instrumentation.

Karena itu case study Java harus menghubungkan application symptom dengan JVM/framework/runtime behavior.

---

# 2. Cara Membaca Case Study Production

Gunakan format:

```text
Symptom
Impact
Context
Timeline
Initial hypotheses
Evidence
Diagnosis
Mitigation
Permanent fix
Prevention
Lessons
```

## 2.1 Jangan mulai dari solusi

Saat melihat:

```text
p99 latency naik
```

jangan langsung:

```text
Tambah pod.
```

Buat hipotesis:

```text
H1: CPU saturated/throttled
H2: GC pause/allocation spike
H3: DB pool wait
H4: downstream latency
H5: lock contention
H6: request queue
H7: DNS/TLS issue
H8: rollout cold-start
```

Lalu cari evidence.

## 2.2 Evidence mengalahkan opini

Kalimat:

```text
Kayaknya GC.
```

harus diganti dengan:

```text
GC pause p99 naik dari 12 ms ke 700 ms setelah deploy,
allocation rate naik dari 80 MB/s ke 950 MB/s,
JFR menunjukkan top allocation dari CaseResponseMapper.
```

## 2.3 Bedakan mitigation dan fix

Mitigation:

```text
mengurangi dampak sekarang
```

Fix:

```text
menghilangkan penyebab atau mengurangi probabilitas kejadian ulang
```

Contoh:

```text
Mitigation: rollback deployment.
Permanent fix: add performance test for mapper and remove per-request ObjectMapper creation.
```

## 2.4 Jangan root cause tunggal jika sistem kompleks

Banyak incident punya contributing factors:

```text
root cause:
  unbounded cache

contributing factors:
  missing cache metrics
  no heap alert
  container memory limit too close to heap
  no load test with high cardinality tenant keys
```

## 2.5 Post-incident artifact

Setiap case harus menghasilkan artifact:

- runbook update;
- alert update;
- test;
- ADR;
- code fix;
- standard update;
- dashboard;
- migration note;
- capacity model.

Tanpa artifact, pembelajaran mudah hilang.

---

# 3. Template Analisis Incident Java

```markdown
# Incident Analysis — <title>

## 1. Summary

What happened in 3–5 sentences?

## 2. Impact

- User impact:
- Duration:
- Error rate:
- Latency:
- Data impact:
- Business/regulatory impact:

## 3. Timeline

| Time | Event |
|---|---|

## 4. System Context

- Java version:
- Framework:
- Deployment:
- JVM flags:
- Resource limits:
- Dependencies:
- Recent changes:

## 5. Symptoms

- Logs:
- Metrics:
- Traces:
- JFR:
- Thread dump:
- Heap/GC:
- Kubernetes events:
- Database/broker metrics:

## 6. Initial Hypotheses

| Hypothesis | Evidence for | Evidence against | Status |
|---|---|---|---|

## 7. Root Cause and Contributing Factors

## 8. Mitigation

What reduced impact immediately?

## 9. Permanent Fix

What code/config/architecture change prevents recurrence?

## 10. Regression Tests

What tests prove the fix?

## 11. Observability Improvements

What new logs/metrics/traces/alerts/runbooks?

## 12. Lessons

What principle was violated?
What standard must change?
```

---

# 4. Reference Architecture 1: Java REST Service Production-Grade

## 4.1 Context

A typical Java REST service:

```text
Client
  → Ingress/Gateway
  → Java REST Service
  → Database
  → Cache
  → Downstream APIs
```

Technology example:

- Java 25;
- Spring Boot;
- PostgreSQL;
- Redis optional;
- OpenTelemetry;
- Micrometer/Prometheus;
- Kubernetes.

## 4.2 Layering

```text
api/
  REST controllers, request/response DTO, error mapping

application/
  use cases, transaction boundary, orchestration

domain/
  aggregate, value object, policy, domain event

infrastructure/
  JPA/JDBC repository, HTTP clients, messaging, config

observability/
  metrics, tracing, audit, logging helpers
```

Dependency direction:

```text
api → application → domain
infrastructure → application/domain ports
domain → no framework
```

## 4.3 Request flow

```text
HTTP request
  ↓
authentication
  ↓
authorization
  ↓
request validation
  ↓
controller maps DTO to command
  ↓
application use case begins transaction
  ↓
repository loads aggregate
  ↓
domain behavior executes
  ↓
repository saves aggregate
  ↓
outbox/audit stored
  ↓
transaction commits
  ↓
response DTO returned
  ↓
metrics/logs/traces emitted
```

## 4.4 Required production features

- stable error contract;
- idempotency for commands;
- explicit timeout on downstream;
- DB pool metrics;
- structured logs;
- trace propagation;
- readiness/liveness/startup probes;
- graceful shutdown;
- resource sizing;
- security headers/auth;
- input validation;
- dependency scan;
- runbook.

## 4.5 Key design decisions

| Decision | Preferred default |
|---|---|
| DTO vs entity | separate DTO |
| Transaction boundary | application service |
| Domain state changes | aggregate methods |
| External event consistency | outbox |
| Time | injected `Clock` |
| ID | typed value object |
| Error response | stable code + correlation ID |
| Logging | structured |
| Metrics | RED/USE + JVM + pool |
| Shutdown | graceful |

## 4.6 Anti-patterns

- controller directly uses JPA entity;
- service method contains all business logic;
- no transaction boundary clarity;
- no timeout on HTTP client;
- unbounded executor;
- `ObjectMapper` created per request;
- liveness checks DB;
- no idempotency for POST;
- no audit for state change.

---

# 5. Reference Architecture 2: Command Service dengan Outbox dan Kafka

## 5.1 Context

Command service menerima command yang mengubah state dan perlu publish event.

```text
Client
  → Command API
  → DB transaction
      update aggregate
      insert outbox row
  → Outbox publisher
  → Kafka
  → Consumers
```

## 5.2 Why outbox?

Masalah klasik:

```text
DB commit succeeds
Kafka publish fails
```

Atau:

```text
Kafka publish succeeds
DB rollback
```

Outbox menyimpan event dalam DB transaction yang sama dengan state change.

## 5.3 Data flow

```text
POST /cases/{id}/escalate
  ↓
validate idempotency key
  ↓
load case aggregate
  ↓
case.escalate(...)
  ↓
save case
  ↓
insert outbox event CaseEscalated
  ↓
commit
  ↓
publisher reads unsent outbox
  ↓
publish Kafka
  ↓
mark sent
```

## 5.4 Outbox table

```sql
CREATE TABLE outbox_event (
    id UUID PRIMARY KEY,
    aggregate_type VARCHAR(100) NOT NULL,
    aggregate_id VARCHAR(100) NOT NULL,
    aggregate_version BIGINT NOT NULL,
    event_type VARCHAR(200) NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    published_at TIMESTAMPTZ,
    status VARCHAR(20) NOT NULL,
    retry_count INT NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX ux_outbox_aggregate_version
ON outbox_event(aggregate_type, aggregate_id, aggregate_version);
```

## 5.5 Idempotency table

```sql
CREATE TABLE idempotency_record (
    key VARCHAR(200) PRIMARY KEY,
    request_hash VARCHAR(128) NOT NULL,
    response_payload JSONB,
    status VARCHAR(20) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ
);
```

## 5.6 Failure modes

| Failure | Behavior |
|---|---|
| client retry same command | return stored result |
| DB commit fails | no outbox event |
| publisher fails | outbox remains unsent |
| Kafka duplicate publish | consumer idempotency required |
| consumer receives out of order | aggregate version detection |
| poison event | DLQ/manual handling |
| schema incompatible | publish blocked or consumer fails |

## 5.7 Observability

Metrics:

- command rate;
- command latency;
- idempotency hit;
- outbox backlog;
- outbox publish latency;
- publish failures;
- Kafka producer errors;
- DLQ count.

Logs:

- commandId;
- aggregateId;
- aggregateVersion;
- eventId;
- correlationId.

Traces:

```text
HTTP command span
  → DB transaction span
  → outbox insert span
  → Kafka publish span
```

---

# 6. Reference Architecture 3: Query Service dan Read Model

## 6.1 Context

Command model optimal untuk correctness. Query model optimal untuk read performance.

```text
Kafka events
  → Projection worker
  → Read database/search index
  → Query API
```

## 6.2 Why separate read model?

Karena query sering butuh:

- join banyak data;
- denormalized view;
- full-text search;
- sorting/filtering;
- pagination;
- dashboard;
- reporting;
- low-latency reads.

Aggregate write model tidak harus memenuhi semua query.

## 6.3 Projection pattern

```text
CaseEscalated event
  ↓
projection worker
  ↓
upsert case_summary
  ↓
query endpoint reads case_summary
```

## 6.4 Read model table

```sql
CREATE TABLE case_summary (
    case_id VARCHAR(100) PRIMARY KEY,
    status VARCHAR(50) NOT NULL,
    severity VARCHAR(50) NOT NULL,
    assigned_officer VARCHAR(100),
    last_event_id UUID NOT NULL,
    last_aggregate_version BIGINT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);
```

## 6.5 Idempotent projection

Consumer must handle duplicate event:

```sql
UPDATE case_summary
SET ...
WHERE case_id = ?
  AND last_aggregate_version < ?
```

If event version already processed, ignore.

## 6.6 Consistency model

Read model is eventually consistent.

API should communicate if necessary:

- `lastUpdatedAt`;
- event version;
- command result includes write version;
- client can poll until read model catches up;
- SSE/WebSocket for updates.

## 6.7 Failure modes

| Failure | Mitigation |
|---|---|
| duplicate event | version/idempotency |
| out-of-order event | version check / buffer / replay |
| projection bug | replay from event log |
| read model lag | lag metric/alert |
| schema change | versioned projection |
| search index stale | reindex job |

---

# 7. Reference Architecture 4: Worker/Consumer Service

## 7.1 Context

Worker consumes messages and performs background work.

```text
Kafka/RabbitMQ
  → Java Worker
  → DB/HTTP/Storage
```

## 7.2 Worker design

Core loop:

```text
poll/receive message
  ↓
validate schema
  ↓
deduplicate
  ↓
process with timeout
  ↓
commit/ack only after success
  ↓
on failure retry/DLQ
```

## 7.3 Kafka consumer concerns

- partition count limits parallelism;
- consumer group rebalance;
- offset commit after success;
- `max.poll.interval.ms`;
- `max.poll.records`;
- poison message;
- idempotency;
- ordering by key;
- graceful shutdown.

## 7.4 RabbitMQ/JMS concerns

- prefetch;
- ack/nack;
- redelivery;
- DLQ;
- message TTL;
- requeue storm;
- ordering;
- poison message.

## 7.5 Worker concurrency

Do not simply spawn unbounded work.

Use:

- bounded executor;
- semaphore;
- partition-aware processing;
- per-key ordering;
- backpressure;
- pause/resume consumer.

## 7.6 Shutdown

On SIGTERM:

```text
stop polling new messages
finish in-flight within deadline
commit/ack successful
nack/retry unfinished
close clients
exit
```

## 7.7 Metrics

- lag;
- message processing latency;
- success/failure count;
- retry count;
- DLQ count;
- in-flight messages;
- executor queue;
- downstream latency;
- commit latency.

---

# 8. Reference Architecture 5: Java Service di Kubernetes

## 8.1 Deployment manifest essentials

```yaml
resources:
  requests:
    cpu: "500m"
    memory: "768Mi"
  limits:
    cpu: "1"
    memory: "768Mi"
```

Java flags:

```bash
-Xms512m
-Xmx512m
-XX:+ExitOnOutOfMemoryError
-Dfile.encoding=UTF-8
-Duser.timezone=UTC
```

or percentage-based:

```bash
-XX:MaxRAMPercentage=60
```

## 8.2 Probes

```yaml
startupProbe:
  httpGet:
    path: /actuator/health/liveness
    port: 8080
  periodSeconds: 2
  failureThreshold: 60

readinessProbe:
  httpGet:
    path: /actuator/health/readiness
    port: 8080
  periodSeconds: 5
  failureThreshold: 3

livenessProbe:
  httpGet:
    path: /actuator/health/liveness
    port: 8080
  periodSeconds: 10
  failureThreshold: 3
```

## 8.3 Liveness rule

Liveness should not depend on volatile downstream like DB/Kafka.

Bad:

```text
if DB down → liveness fails → all pods restart
```

Good:

```text
liveness indicates process is not deadlocked/unrecoverable
readiness indicates whether pod should receive traffic
```

## 8.4 Memory budget

```text
container limit =
  heap
  + metaspace
  + code cache
  + thread stacks
  + direct memory
  + native/JVM/agent
  + margin
```

## 8.5 CPU limit risk

CPU limit can cause throttling. Throttling can look like:

- latency spike;
- GC pause longer;
- timeout;
- lower throughput;
- runnable threads.

Monitor cgroup CPU throttling metrics.

## 8.6 Graceful shutdown

```yaml
terminationGracePeriodSeconds: 45
lifecycle:
  preStop:
    exec:
      command: ["sh", "-c", "sleep 10"]
```

Application:

```yaml
server:
  shutdown: graceful
spring:
  lifecycle:
    timeout-per-shutdown-phase: 30s
```

## 8.7 Debuggability

Decide how to get:

- logs;
- metrics;
- traces;
- thread dump;
- heap dump;
- JFR;
- GC logs;
- `jcmd`.

Distroless images improve security but reduce ad-hoc debugging. Plan ephemeral debug container or startup JFR.

---

# 9. Case Study 1: Latency Naik Setelah Deployment

## 9.1 Symptom

After deployment:

```text
p50: 80 ms → 90 ms
p95: 220 ms → 600 ms
p99: 700 ms → 4.5 s
error rate: slight increase
CPU: moderate
DB CPU: normal
```

## 9.2 Recent change

A mapper was refactored:

```java
public CaseResponse map(CaseEntity entity) {
    ObjectMapper mapper = new ObjectMapper();
    return mapper.convertValue(entity, CaseResponse.class);
}
```

## 9.3 Initial hypotheses

| Hypothesis | Evidence to check |
|---|---|
| GC/allocation spike | JFR allocation, GC log |
| DB slow | trace DB spans |
| CPU throttling | container throttling |
| serialization issue | CPU profile |
| JIT cold start | latency by pod age |
| lock contention | JFR monitor/thread park |

## 9.4 Evidence

JFR shows:

```text
Top allocation:
  com.fasterxml.jackson.databind.ObjectMapper
  serializer/deserializer caches
  reflection metadata
```

Metrics:

```text
allocation rate: 120 MB/s → 1.1 GB/s
young GC frequency increases
p99 correlates with GC pressure
```

## 9.5 Root cause

`ObjectMapper` was created per request. `ObjectMapper` is expensive and should be reused after configuration.

## 9.6 Mitigation

Rollback deployment.

## 9.7 Permanent fix

Use singleton/configured mapper:

```java
@Component
public final class CaseResponseMapper {
    private final ObjectMapper objectMapper;

    public CaseResponseMapper(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public CaseResponse map(CaseEntity entity) {
        return objectMapper.convertValue(entity, CaseResponse.class);
    }
}
```

Better: explicit mapper without generic reflection if hot path.

## 9.8 Prevention

- performance test mapper;
- JFR allocation smoke test in staging;
- code review rule: no per-request `ObjectMapper`;
- add allocation dashboard;
- add unit benchmark for hot mapping if critical.

---

# 10. Case Study 2: Container OOMKilled Tanpa Heap Dump

## 10.1 Symptom

Kubernetes:

```text
Last State: Terminated
Reason: OOMKilled
Exit Code: 137
```

App logs show no Java `OutOfMemoryError`.

## 10.2 Configuration

```yaml
memory limit: 1024Mi
```

JVM:

```bash
-Xmx900m
-XX:+HeapDumpOnOutOfMemoryError
```

Threads:

```text
platform threads: ~350
-Xss1m
APM agent enabled
Netty/direct buffers used
```

## 10.3 Misleading assumption

Team assumed:

```text
Heap 900Mi under 1024Mi, safe.
```

Wrong because container memory includes native memory.

## 10.4 Evidence

- container memory near 1024Mi;
- heap used only 650Mi;
- direct buffer pool high;
- thread count high;
- no heap dump because kernel killed process.

## 10.5 Root cause

Native memory + thread stacks + direct buffers + agent overhead exceeded remaining memory.

## 10.6 Mitigation

Reduce heap:

```bash
-Xmx600m
```

or increase container memory temporarily.

## 10.7 Permanent fix

Budget memory:

```text
limit 1024Mi:
  heap 600Mi
  metaspace 120Mi
  code cache 64Mi
  thread stack 200Mi worst-case reserved/committed risk
  direct 128Mi
  agent/native/margin 112Mi
```

Set:

```bash
-Xmx600m
-XX:MaxDirectMemorySize=128m
-XX:+ExitOnOutOfMemoryError
```

Reduce platform thread count, adopt virtual thread only with bulkheads if appropriate.

## 10.8 Prevention

- dashboard container RSS vs heap;
- buffer pool metrics;
- thread count alert;
- NMT in staging;
- resource review checklist;
- no `Xmx` above 60–70% of container limit without evidence.

---

# 11. Case Study 3: Java Heap OOM karena Cache Tidak Bounded

## 11.1 Symptom

```text
java.lang.OutOfMemoryError: Java heap space
```

Heap dump shows:

```text
ConcurrentHashMap
  key: tenantId + query parameters
  value: report result
```

## 11.2 Code

```java
private final Map<String, Report> cache = new ConcurrentHashMap<>();

public Report getReport(Query q) {
    return cache.computeIfAbsent(q.cacheKey(), key -> generate(q));
}
```

## 11.3 Root cause

Unbounded cache with high-cardinality key.

## 11.4 Why it passed tests

Tests used 3 query keys. Production had millions of unique combinations.

## 11.5 Mitigation

- clear cache;
- rollback;
- increase heap temporarily only if needed to stabilize;
- reduce traffic to report endpoint.

## 11.6 Permanent fix

Use bounded cache:

```java
Caffeine.newBuilder()
    .maximumSize(10_000)
    .expireAfterWrite(Duration.ofMinutes(15))
    .recordStats()
    .build();
```

Review key cardinality.

## 11.7 Prevention

- cache metrics: size, hit rate, eviction count;
- load test with high cardinality;
- code review rule: no unbounded cache;
- memory alert before OOM;
- heap dump runbook.

---

# 12. Case Study 4: DB Pool Exhaustion Saat HPA Scale Out

## 12.1 Symptom

Traffic spike. HPA scales from 5 to 25 pods.

Then:

```text
p99 latency: 800ms → 12s
DB CPU: 95%
DB active connections: maxed
Hikari pending threads high
```

## 12.2 Configuration

```yaml
hpa maxReplicas: 25
```

```yaml
spring.datasource.hikari.maximum-pool-size: 30
```

Total possible DB connections:

```text
25 * 30 = 750
```

Database safe app connection budget:

```text
200
```

## 12.3 Root cause

Scaling app multiplied DB connections beyond DB capacity.

## 12.4 Mitigation

- reduce HPA max replicas;
- reduce pool size;
- shed load;
- rollback recent traffic feature;
- scale DB if possible.

## 12.5 Permanent fix

Formula:

```text
maxPoolSize <= DB connection budget / maxReplicas
```

If budget = 200 and maxReplicas = 20:

```text
maxPoolSize <= 10
```

Set:

```yaml
maximum-pool-size: 8
```

Add backpressure:

```text
connection-timeout: 1000ms
fail fast when pool exhausted
```

## 12.6 Prevention

- architecture review includes `replicas * pool`;
- DB connection dashboard;
- Hikari pending alert;
- load test with HPA scenario;
- query optimization;
- read model/cache if DB read-heavy.

---

# 13. Case Study 5: Kafka Lag Tidak Turun Walau Pod Ditambah

## 13.1 Symptom

Kafka lag grows. Team scales consumer pods:

```text
3 → 20 pods
```

Lag does not improve.

## 13.2 Topic

```text
partitions = 6
consumer group = case-projection
```

Only 6 consumers can actively own partitions.

## 13.3 Evidence

Kafka consumer group assignment shows:

```text
6 active consumers
14 idle consumers
```

Processing latency per message high due to downstream DB.

## 13.4 Root cause

Partition count and DB bottleneck limit throughput. Adding pods beyond partition count doesn't help.

## 13.5 Mitigation

- optimize processing query;
- reduce batch size if causing transaction too long;
- pause non-critical consumers;
- temporarily increase partitions if ordering model allows;
- scale DB/read model capacity.

## 13.6 Permanent fix

- partition by correct key;
- choose partition count based on target throughput;
- make consumer idempotent;
- optimize DB writes;
- monitor lag by partition;
- use DLQ for poison messages;
- implement backpressure.

## 13.7 Prevention

- capacity model includes partitions;
- alert on lag growth rate;
- consumer assignment dashboard;
- load test consumer throughput.

---

# 14. Case Study 6: Duplicate Command Menghasilkan Double Side Effect

## 14.1 Symptom

User clicks submit twice or client retries after timeout.

System creates two approvals and sends two notifications.

## 14.2 Code

```java
@PostMapping("/cases/{id}/approve")
public ApproveResponse approve(@PathVariable String id) {
    service.approve(id);
    return new ApproveResponse("OK");
}
```

No idempotency key.

## 14.3 Failure chain

```text
client sends approve
  → server processes successfully
  → response times out
  → client retries
  → server processes again
```

## 14.4 Root cause

Command not idempotent.

## 14.5 Permanent fix

Require idempotency key:

```http
POST /cases/{id}/approve
Idempotency-Key: <uuid>
```

Store:

```sql
CREATE TABLE command_dedup (
    idempotency_key VARCHAR(200) PRIMARY KEY,
    request_hash VARCHAR(128) NOT NULL,
    response_json JSONB,
    status VARCHAR(20) NOT NULL
);
```

Application flow:

```text
if key exists and hash same:
  return previous result
if key exists and hash different:
  return 409
else:
  process command and store result atomically
```

## 14.6 Prevention

- all non-idempotent POST command requires idempotency;
- API review checklist;
- duplicate command tests;
- unique constraint on command ID;
- event consumers idempotent too.

---

# 15. Case Study 7: `@Transactional` Tidak Bekerja karena Self-Invocation

## 15.1 Symptom

`REQUIRES_NEW` transaction not created.

## 15.2 Code

```java
@Service
public class CaseService {

    @Transactional
    public void closeCase(CaseId id) {
        saveAudit(id);
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void saveAudit(CaseId id) {
        auditRepository.save(...);
    }
}
```

## 15.3 Root cause

Spring AOP proxy-based transaction only applies when call goes through proxy. `this.saveAudit(...)` is self-invocation and bypasses proxy.

## 15.4 Evidence

- transaction logs show no new transaction;
- breakpoint in proxy interceptor not hit;
- target method called directly.

## 15.5 Fix options

### Option A — separate bean

```java
@Service
public class AuditService {
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void saveAudit(CaseId id) { ... }
}
```

### Option B — TransactionTemplate

```java
transactionTemplate.executeWithoutResult(status -> auditRepository.save(...));
```

### Option C — AspectJ weaving

More complex, usually not necessary.

## 15.6 Prevention

- code review rule: no assumption that internal method calls trigger AOP;
- architecture test for transaction boundaries;
- transaction integration tests;
- avoid overusing annotations for hidden behavior.

---

# 16. Case Study 8: N+1 Query Setelah Refactor DTO

## 16.1 Symptom

Endpoint previously 200ms, now 4s for list of 100 cases.

## 16.2 Code

```java
return cases.stream()
    .map(c -> new CaseDto(
        c.getId(),
        c.getStatus(),
        c.getDocuments().size()
    ))
    .toList();
```

`documents` is lazy association.

## 16.3 Root cause

Each `getDocuments()` triggers query:

```text
1 query for cases
100 queries for documents
```

## 16.4 Evidence

SQL logs/tracing show 101 queries.

## 16.5 Fix options

- projection query;
- fetch join where appropriate;
- batch size;
- separate count query grouped by case_id;
- read model.

Example projection:

```sql
SELECT c.id, c.status, COUNT(d.id)
FROM cases c
LEFT JOIN documents d ON d.case_id = c.id
GROUP BY c.id, c.status
LIMIT ? OFFSET ?
```

## 16.6 Prevention

- SQL count in integration tests;
- tracing DB spans;
- code review warning for lazy association in DTO mapping;
- avoid exposing JPA entity directly;
- use read model/projection for list endpoints.

---

# 17. Case Study 9: CPU Tinggi karena Regex Catastrophic Backtracking

## 17.1 Symptom

CPU 100%, request stuck, no DB issue.

## 17.2 Code

```java
private static final Pattern P = Pattern.compile("(a+)+$");
```

Input:

```text
aaaaaaaaaaaaaaaaaaaaaaaaaaaaX
```

## 17.3 Root cause

Catastrophic backtracking in regex.

## 17.4 Evidence

Thread dump:

```text
java.util.regex.Pattern$...
```

CPU profile points to regex matching.

## 17.5 Fix

- simplify regex;
- use possessive quantifier/atomic group if correct;
- validate length before regex;
- use parser/manual check;
- timeout at request level;
- reject excessive input.

Example:

```java
private static final Pattern SAFE = Pattern.compile("a++$");
```

only if semantics match.

## 17.6 Prevention

- regex review for untrusted input;
- fuzz/property tests;
- input length limit;
- CPU profiling in load tests;
- OWASP ReDoS awareness.

---

# 18. Case Study 10: CPU Throttling yang Disangka GC Problem

## 18.1 Symptom

```text
p99 latency high
GC pause appears longer
CPU usage not obviously 100%
```

Team starts tuning GC.

## 18.2 Kubernetes config

```yaml
limits:
  cpu: "500m"
```

Under load, container CPU throttling high.

## 18.3 Root cause

CPU quota throttles JVM. GC and application threads cannot run when throttled, making pauses and request time appear worse.

## 18.4 Evidence

- `container_cpu_cfs_throttled_seconds_total` high;
- JFR shows runnable threads waiting;
- removing/increasing CPU limit reduces latency;
- GC logs improve without changing GC.

## 18.5 Fix

- increase CPU request/limit;
- remove CPU limit if policy allows;
- set realistic `ActiveProcessorCount`;
- reduce CPU-heavy work;
- scale horizontally only if downstream allows.

## 18.6 Prevention

- dashboard includes throttling;
- performance tests run with same CPU limits;
- don't tune GC before checking CPU quota.

---

# 19. Case Study 11: Thread Pool Starvation karena Blocking di Common Pool

## 19.1 Symptom

`CompletableFuture` tasks hang under load.

## 19.2 Code

```java
CompletableFuture<Profile> p =
    CompletableFuture.supplyAsync(() -> profileClient.getProfile(id));

CompletableFuture<History> h =
    CompletableFuture.supplyAsync(() -> historyClient.getHistory(id));
```

No executor specified. Blocking HTTP calls run on ForkJoin common pool.

## 19.3 Root cause

Blocking I/O starves common pool used by other async tasks/parallel streams.

## 19.4 Fix

Use explicit executor:

```java
CompletableFuture.supplyAsync(() -> profileClient.getProfile(id), ioExecutor);
```

Or virtual threads with bulkheads:

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    ...
}
```

but still limit downstream concurrency.

## 19.5 Prevention

- rule: no blocking in common pool;
- code review search for `supplyAsync(` without executor;
- executor metrics;
- timeout on futures.

---

# 20. Case Study 12: Virtual Thread Adoption yang Membanjiri Database

## 20.1 Symptom

After migrating request handling to virtual threads:

```text
thread exhaustion gone
DB CPU maxed
DB pool wait high
p99 worsens
```

## 20.2 Misunderstanding

Team thought:

```text
Virtual threads allow unlimited concurrency.
```

Reality:

```text
Virtual threads reduce cost of waiting, but downstream resources remain finite.
```

## 20.3 Root cause

More concurrent requests reached DB than before. Previous platform-thread bottleneck accidentally protected DB.

## 20.4 Fix

Add bulkhead:

```java
private final Semaphore dbPermits = new Semaphore(100);

public Result callDb(Command c) throws InterruptedException {
    if (!dbPermits.tryAcquire(200, TimeUnit.MILLISECONDS)) {
        throw new TooManyRequestsException();
    }
    try {
        return repository.execute(c);
    } finally {
        dbPermits.release();
    }
}
```

Tune DB pool and HPA together.

## 20.5 Prevention

- virtual thread adoption review;
- downstream concurrency budget;
- DB pool pending alert;
- load test with realistic traffic;
- ThreadLocal audit.

---

# 21. Case Study 13: JSON Contract Break Setelah Upgrade Jackson

## 21.1 Symptom

Consumer fails after producer upgrade.

## 21.2 Change

DTO moved from class to record:

```java
public record CaseResponse(
    String caseId,
    CaseStatus status,
    Instant updatedAt
) {}
```

Serialization changed date format or enum inclusion due to ObjectMapper config change.

## 21.3 Root cause

Contract tests missing. ObjectMapper configuration changed during upgrade.

## 21.4 Fix

- restore explicit serialization config;
- add contract tests;
- version API/event schema if change intentional.

Example:

```java
objectMapper.registerModule(new JavaTimeModule());
objectMapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
```

## 21.5 Prevention

- golden JSON tests;
- consumer-driven contract tests;
- schema versioning;
- no global ObjectMapper mutation after startup;
- API review for DTO refactor.

---

# 22. Case Study 14: Java 8 ke 17 Gagal karena Strong Encapsulation

## 22.1 Symptom

After JDK upgrade:

```text
InaccessibleObjectException
```

## 22.2 Root cause

Old library reflects into JDK internals.

## 22.3 Bad fix

```bash
--add-opens java.base/java.lang=ALL-UNNAMED
--add-opens java.base/java.util=ALL-UNNAMED
--add-opens ...
```

Blindly opening internals without tracking.

## 22.4 Good fix

1. Identify library.
2. Upgrade library.
3. Remove internal API use.
4. Use narrow temporary opens only if unavoidable.
5. Create removal ticket.

## 22.5 Prevention

- `jdeps --jdk-internals`;
- dependency modernization;
- migration checklist;
- test on target JDK early.

---

# 23. Case Study 15: Security Regression karena Trust-All TLS

## 23.1 Symptom

Integration with partner fails due to certificate issue. Developer adds:

```java
TrustManager[] trustAll = ...
HostnameVerifier trustAllHosts = (host, session) -> true;
```

Incident discovered in security review.

## 23.2 Root cause

TLS validation disabled instead of fixing truststore/certificate chain.

## 23.3 Risk

- man-in-the-middle;
- credential leakage;
- data tampering;
- compliance violation.

## 23.4 Correct fix

- import partner CA/cert to truststore;
- verify hostname;
- rotate certificate properly;
- use mTLS if required;
- document certificate owner/expiry;
- monitor expiry.

## 23.5 Prevention

- static scan for trust-all patterns;
- code review security checklist;
- TLS integration test;
- certificate expiry alert;
- no insecure workaround allowed in production.

---

# 24. Case Study 16: Observability Blind Spot Saat Incident

## 24.1 Symptom

Users report failures. Metrics show error rate, but logs cannot correlate request to case ID or downstream call.

## 24.2 Missing

- no trace ID in logs;
- no domain ID;
- no DB pool metrics;
- no downstream latency;
- no structured error code;
- no runbook.

## 24.3 Impact

MTTR high because team cannot determine whether root cause is DB, downstream, validation, or deployment.

## 24.4 Fix

Add:

- structured logging;
- correlation ID propagation;
- OpenTelemetry tracing;
- Micrometer metrics;
- error code taxonomy;
- dashboard;
- runbook.

## 24.5 Prevention

Observability is a feature requirement, not post-release decoration.

---

# 25. Case Study 17: Slow Startup dan Probe Restart Loop

## 25.1 Symptom

Pod repeatedly restarts during deployment.

Kubernetes events:

```text
Liveness probe failed
Back-off restarting failed container
```

## 25.2 Context

Spring Boot app runs DB migration and cache warmup on startup. Startup time sometimes 80 seconds.

Probe:

```yaml
livenessProbe:
  initialDelaySeconds: 20
  failureThreshold: 3
  periodSeconds: 10
```

No startup probe.

## 25.3 Root cause

Liveness kills app while still starting.

## 25.4 Fix

Add startup probe:

```yaml
startupProbe:
  httpGet:
    path: /actuator/health/liveness
    port: 8080
  periodSeconds: 2
  failureThreshold: 60
```

Make readiness true only after app is ready.

## 25.5 Prevention

- measure startup time distribution;
- use startup probe for slow apps;
- don't put volatile downstream checks in liveness;
- separate migration strategy if startup too long.

---

# 26. Case Study 18: Graceful Shutdown Gagal dan Message Hilang

## 26.1 Symptom

During rolling update, some messages are missing.

## 26.2 Code

Worker acknowledges message before processing:

```java
ack(message);
process(message);
```

If pod receives SIGTERM after ack but before process completes, message is lost.

## 26.3 Correct flow

```java
process(message);
ack(message);
```

If process fails, no ack; broker redelivers or routes to DLQ depending config.

## 26.4 Shutdown flow

On SIGTERM:

```text
stop consuming new messages
finish in-flight
ack successful
nack/requeue unfinished
close consumer
exit
```

## 26.5 Prevention

- rolling update test;
- worker shutdown integration test;
- idempotent processing;
- DLQ;
- processing timeout;
- runbook.

---

# 27. Case Study 19: Clock/Timezone Bug di Deadline Regulatori

## 27.1 Symptom

Cases close one day early/late around timezone boundary.

## 27.2 Code

```java
LocalDate deadline = LocalDate.now().plusDays(14);
```

Runs on server UTC, but business deadline is Asia/Singapore or Asia/Jakarta.

## 27.3 Root cause

Implicit system timezone and direct `now()` in domain logic.

## 27.4 Fix

Use `Clock` and explicit `ZoneId` policy:

```java
public final class DeadlinePolicy {
    private final ZoneId businessZone;
    private final Clock clock;

    public LocalDate calculateDeadline(int days) {
        return LocalDate.now(clock.withZone(businessZone)).plusDays(days);
    }
}
```

Store instants for audit, local dates for business rules if appropriate.

## 27.5 Prevention

- no direct `now()` in domain;
- timezone tests;
- DST/boundary tests;
- explicit business zone config;
- audit stores `Instant` + business date where needed.

---

# 28. Case Study 20: Audit Trail Tidak Bisa Menjelaskan Keputusan

## 28.1 Symptom

Auditor asks:

```text
Why was this case rejected?
Which officer did it?
Which rule was applied?
What evidence supported the decision?
```

System only has:

```text
status = REJECTED
updated_at = ...
```

## 28.2 Root cause

State mutation without domain event/audit model.

## 28.3 Fix

Model decision explicitly:

```java
public record CaseRejected(
    EventId eventId,
    CaseId caseId,
    OfficerId rejectedBy,
    RejectionReason reason,
    PolicyVersion policyVersion,
    List<EvidenceReference> evidence,
    Instant occurredAt,
    long aggregateVersion
) implements DomainEvent {}
```

Audit table stores:

- actor;
- action;
- from/to state;
- reason;
- policy version;
- evidence references;
- correlation ID;
- timestamp;
- aggregate version.

## 28.4 Prevention

- every state transition emits event;
- auditability checklist in design review;
- domain event tests;
- no direct status setter.

---

# 29. Playbook: Memilih Solusi Berdasarkan Failure Mode

| Failure mode | Bad reflex | Better response |
|---|---|---|
| latency high | add pod | find bottleneck: CPU/DB/queue/downstream/GC |
| OOMKilled | increase heap | inspect container memory budget |
| heap OOM | increase heap only | heap dump + leak/allocation analysis |
| DB pool full | increase pool | calculate replicas * pool vs DB capacity |
| Kafka lag | add pods | check partition count, processing bottleneck |
| duplicate side effect | blame user retry | idempotency key + unique constraint |
| GC pause | switch GC | inspect allocation/live set/CPU |
| CPU high | add threads | profile CPU and check contention |
| thread starvation | increase pool | separate blocking executor/backpressure |
| probe restart | increase delay randomly | define startup/readiness/liveness semantics |
| TLS error | trust all | fix truststore/cert chain |
| JSON break | blame consumer | contract tests/schema version |
| migration error | add broad opens | upgrade dependency/use supported API |
| incident blind | add logs everywhere | structured observability design |

---

# 30. Playbook: Evidence Matrix untuk Java Production

| Question | Evidence |
|---|---|
| Is JVM alive and responsive? | health, `jcmd`, logs |
| Is CPU saturated? | CPU usage, throttling, JFR CPU profile |
| Is memory issue heap or native? | heap metrics, RSS, NMT, OOM reason |
| Is GC causing latency? | GC logs, JFR GC events |
| Is request waiting DB? | trace DB spans, pool pending |
| Is downstream slow? | trace external spans, client metrics |
| Is thread pool saturated? | active/queue/rejected metrics, thread dump |
| Is lock contention high? | JFR monitor blocked/thread park |
| Is Kafka bottleneck? | lag by partition, consumer assignment |
| Is serialization hot? | CPU/allocation profile |
| Is deployment cold? | latency by pod age, startup metrics |
| Is retry amplifying? | retry count, traffic vs request count |
| Is DNS/TLS issue? | trace connection/handshake, logs |
| Is data inconsistent? | DB rows, event versions, audit trail |
| Is API contract broken? | contract tests, schema diff |

---

# 31. Playbook: Architecture Review Board untuk Java Services

## 31.1 Required artifacts

For critical Java service:

```text
ARCHITECTURE.md
ADR/
API_SPEC.md
DATA_MODEL.md
STATE_MACHINE.md
FAILURE_MODEL.md
OBSERVABILITY.md
SECURITY_REVIEW.md
RUNBOOK.md
PERFORMANCE_REPORT.md
```

## 31.2 Review agenda

1. Domain model.
2. State transitions.
3. API contract.
4. Transaction boundary.
5. Data consistency.
6. Failure modes.
7. Security.
8. Observability.
9. Deployment.
10. Migration/rollback.
11. Capacity.
12. Ownership.

## 31.3 Go/no-go questions

- Can we explain every state transition?
- Can we recover from duplicate command?
- Can we replay/repair event processing?
- Can we diagnose p99 latency?
- Can we rollback safely?
- Can we meet security/audit requirements?
- Can on-call operate it at 3 AM?

---

# 32. Practical Labs

## Lab 1 — Build latency incident

Create endpoint with per-request `ObjectMapper`. Load test. Capture JFR. Fix.

## Lab 2 — Container OOMKilled

Run Java app with high `-Xmx` relative to container limit and many threads/direct buffers. Observe OOMKilled.

## Lab 3 — DB pool multiplication

Deploy service with HPA and large pool. Simulate traffic. Observe DB connection explosion.

## Lab 4 — Kafka lag

Topic with 3 partitions, 10 consumers. Observe idle consumers. Increase partitions and compare.

## Lab 5 — Transaction self-invocation

Prove `@Transactional(REQUIRES_NEW)` internal call doesn't work. Refactor.

## Lab 6 — N+1 query

Create JPA lazy association and DTO mapper. Observe query count. Fix with projection.

## Lab 7 — Virtual thread bulkhead

Compare virtual thread service with/without DB semaphore.

## Lab 8 — Probe failure

Create slow startup app. Run with only liveness. Add startup probe.

## Lab 9 — Graceful shutdown worker

Ack before processing vs after processing. Delete pod mid-message. Observe data loss vs redelivery.

## Lab 10 — Audit model

Implement state transition events and prove audit can answer who/what/when/why.

---

# 33. Final Integrated Project

## 33.1 Project

```text
java-production-casebook
```

A repository containing:

```text
services/
  command-service/
  query-service/
  worker-service/
infra/
  docker-compose.yaml
  k8s/
docs/
  architecture/
  runbooks/
  incident-case-studies/
  performance-reports/
```

## 33.2 Requirements

- Java 25;
- REST command API;
- PostgreSQL;
- Kafka;
- outbox;
- projection read model;
- worker;
- structured logs;
- OpenTelemetry;
- Micrometer;
- JFR scripts;
- Kubernetes manifests;
- HPA;
- Testcontainers;
- JMH benchmark;
- failure labs.

## 33.3 Required scenarios

1. Duplicate command.
2. DB pool exhaustion.
3. Kafka lag.
4. OOMKilled.
5. Heap leak.
6. CPU regex spike.
7. N+1 query.
8. Slow startup/probe loop.
9. Graceful shutdown.
10. Java migration check.

## 33.4 Deliverables

```text
README.md
ARCHITECTURE.md
ADR-001-runtime-java25.md
ADR-002-outbox.md
ADR-003-idempotency.md
RUNBOOK-latency.md
RUNBOOK-db-pool.md
RUNBOOK-oom.md
PERFORMANCE_BASELINE.md
SECURITY_REVIEW.md
PRODUCTION_READINESS_REVIEW.md
```

## 33.5 Evaluation

You should be able to demonstrate:

- system behavior under normal load;
- system behavior under failure;
- how to diagnose with logs/metrics/traces/JFR;
- how to rollback;
- how events remain consistent;
- how audit explains decisions;
- how capacity is calculated.

---

# 34. Referensi Resmi

Referensi utama untuk bagian ini:

1. Oracle Java SE 25 Troubleshooting Guide — Diagnostic Tools  
   https://docs.oracle.com/en/java/javase/25/troubleshoot/diagnostic-tools.html

2. Oracle Java SE 25 Troubleshooting Guide — Troubleshoot Performance Issues Using JFR  
   https://docs.oracle.com/en/java/javase/25/troubleshoot/troubleshoot-performance-issues-using-jfr.html

3. Oracle Java SE 25 `java` command documentation  
   https://docs.oracle.com/en/java/javase/25/docs/specs/man/java.html

4. Kubernetes Documentation — Configure Liveness, Readiness and Startup Probes  
   https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/

5. Spring Boot Reference Documentation — Actuator, production-ready features, graceful shutdown, Kubernetes probes  
   https://docs.spring.io/spring-boot/

6. OpenTelemetry Java Documentation  
   https://opentelemetry.io/docs/languages/java/

7. Apache Kafka Documentation  
   https://kafka.apache.org/documentation/

8. RabbitMQ Documentation  
   https://www.rabbitmq.com/docs

9. OWASP Application Security Verification Standard  
   https://owasp.org/www-project-application-security-verification-standard/

10. Oracle Secure Coding Guidelines for Java SE  
    https://www.oracle.com/java/technologies/javase/seccodeguide.html

11. OpenJDK JMH  
    https://github.com/openjdk/jmh

12. Oracle JDK Migration Guide Release 25  
    https://docs.oracle.com/en/java/javase/25/migrate/index.html

---

# Penutup

Bagian ini adalah latihan mengubah pengetahuan menjadi judgment.

Java production system jarang gagal karena satu hal sederhana. Ia gagal karena interaksi:

```text
code
  + framework
  + JVM
  + database
  + message broker
  + container
  + network
  + traffic
  + human process
```

Engineer top-tier tidak hanya menghafal solusi. Ia membangun kemampuan diagnosis:

```text
symptom → hypothesis → evidence → mitigation → root cause → permanent fix → prevention
```

Dan untuk Java, evidence terbaik sering datang dari kombinasi:

```text
logs
metrics
traces
JFR
GC logs
thread dumps
heap dumps
database metrics
broker metrics
Kubernetes events
domain audit trail
```

Jika kamu bisa membaca semua sinyal itu dan menghubungkannya dengan domain serta arsitektur, kamu tidak hanya “bisa Java”. Kamu bisa mengoperasikan sistem Java nyata.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-part-024.md">⬅️ Bagian 24 — Capstone: Java Engineering Mastery dan Production-Grade Decision Making</a>
<a href="./index.md">📚 Kategori</a>
<a href="../index.md">🏠 Home</a>
<span></span>
</div>
