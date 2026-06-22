# Learn Java Microservices Patterns — Advanced Engineering
## Part 22 — Observability Patterns for Microservices

**Nama file:** `learn-java-microservices-patterns-advanced-engineering-22-observability-patterns.md`  
**Seri:** `learn-java-microservices-patterns-advanced-engineering`  
**Part:** 22 dari 35  
**Target pembaca:** Java engineer senior/tech lead/principal-track yang ingin mampu mendesain, mengoperasikan, dan mempertanggungjawabkan sistem microservices production-grade.  
**Java scope:** Java 8 sampai Java 25.  

---

## 0. Posisi Part Ini Dalam Seri

Part sebelumnya membahas:

- service boundary,
- domain modeling,
- architecture styles,
- synchronous dan asynchronous communication,
- event-driven architecture,
- saga,
- outbox/inbox,
- consistency,
- data ownership,
- query patterns,
- API gateway/BFF,
- service discovery/configuration,
- resilience,
- backpressure,
- idempotency,
- workflow,
- state machine,
- service-to-service security,
- multi-tenancy dan isolation.

Semua itu akan gagal di production bila sistem tidak dapat **diobservasi**.

Observability bukan fitur tambahan. Observability adalah bagian dari desain correctness dan operability. Dalam microservices, bug sering tidak berada di satu service, tetapi di relasi antar service:

- request dari gateway berhasil, tetapi downstream timeout,
- event terkirim dua kali,
- projection tertinggal,
- consumer lag naik,
- tenant tertentu overload,
- workflow stuck di state tertentu,
- retry menyebabkan dependency collapse,
- data sudah benar di command service tetapi belum terlihat di read model,
- authorization gagal hanya untuk kombinasi role, tenant, dan case state tertentu,
- satu service lambat, tetapi gejalanya muncul di service lain.

Tanpa observability, engineer hanya melihat gejala. Dengan observability yang matang, engineer bisa menjawab:

> Apa yang terjadi?  
> Di service mana?  
> Untuk tenant/user/request/event/workflow mana?  
> Sejak kapan?  
> Seberapa luas dampaknya?  
> Apakah ini bug correctness, overload, dependency issue, config issue, deploy issue, data issue, atau abuse?  
> Apa tindakan paling aman sekarang?

OpenTelemetry mendefinisikan observability sebagai kemampuan memahami internal state sistem melalui output seperti traces, metrics, dan logs; sistem harus diinstrumentasi agar menghasilkan telemetry tersebut. Referensi resmi OpenTelemetry juga menekankan semantic conventions untuk menyamakan nama atribut lintas traces, metrics, logs, profiles, dan resources.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu diharapkan mampu:

1. Membedakan logging, monitoring, tracing, telemetry, dan observability.
2. Mendesain telemetry sebagai bagian dari kontrak sistem, bukan sekadar debugging tambahan.
3. Menentukan metrik yang penting untuk HTTP API, messaging, workflow, database, cache, gateway, tenant, dan business process.
4. Mendesain correlation ID, causation ID, trace context, request ID, message ID, dan business ID dengan benar.
5. Menghindari logging berlebihan, high-cardinality explosion, dan leakage data sensitif.
6. Mendesain distributed tracing yang berguna untuk synchronous dan asynchronous flow.
7. Mendesain log yang forensic-friendly tanpa menabrak privacy/security.
8. Membuat SLI, SLO, alert, dashboard, dan runbook yang benar-benar membantu operasi.
9. Menghubungkan technical telemetry dengan business telemetry dan auditability.
10. Menggunakan observability untuk incident response, reliability improvement, capacity planning, dan architecture review.
11. Memahami posisi Java 8–25, Spring Boot/Micrometer, MicroProfile Telemetry, OpenTelemetry Java Agent, Quarkus, dan plain Java.

---

## 2. Masalah Nyata Yang Diselesaikan Observability

Microservices menciptakan jarak antara **cause** dan **symptom**.

Dalam monolith, call stack sering cukup untuk memahami flow. Dalam microservices, call stack terpecah menjadi:

```text
Browser
  -> CDN / WAF / API Gateway
  -> BFF
  -> Application Service
  -> Case Service
  -> Profile Service
  -> Document Service
  -> Database
  -> Outbox Publisher
  -> Broker
  -> Projection Consumer
  -> Search Index
  -> Notification Service
```

Masalahnya:

1. Stack trace lokal hanya menjelaskan satu process.
2. Log lokal hanya menjelaskan satu service.
3. Metrics lokal hanya menjelaskan gejala agregat.
4. Trace tanpa business context sulit dipakai untuk investigasi domain.
5. Dashboard tanpa SLO sering menjadi pajangan.
6. Alert tanpa runbook menghasilkan kepanikan.
7. Logging semua payload menciptakan risiko PII/security dan biaya tinggi.
8. Sampling trace yang salah membuat incident penting tidak terlihat.
9. Metrics high-cardinality dapat merusak backend observability.
10. Event-driven flow sulit ditelusuri bila correlation dan causation tidak disiplin.

Observability yang baik bukan berarti “semua hal dicatat”. Observability yang baik berarti sistem menghasilkan sinyal yang cukup untuk mengambil keputusan.

---

## 3. Mental Model Utama

### 3.1 Observability Is A Decision System

Tujuan observability bukan mengumpulkan data sebanyak-banyaknya. Tujuannya adalah mempercepat pengambilan keputusan:

```text
Telemetry -> Understanding -> Decision -> Action -> Recovery/Learning
```

Telemetry yang tidak membantu keputusan adalah noise.

Contoh noise:

```text
INFO Request received
INFO Calling service
INFO Response received
INFO Done
```

Contoh telemetry yang berguna:

```json
{
  "timestamp": "2026-06-19T15:45:13.120Z",
  "level": "WARN",
  "service.name": "application-service",
  "operation": "submitApplication",
  "applicationId": "APP-2026-000812",
  "tenantId": "agency-a",
  "actorType": "USER",
  "actorIdHash": "u_7f12...",
  "traceId": "9f7c2d...",
  "spanId": "a91d...",
  "correlationId": "corr-6a8f...",
  "stateFrom": "DRAFT",
  "stateTo": "SUBMITTED",
  "dependency": "document-service",
  "failure.type": "TIMEOUT",
  "timeoutMs": 800,
  "elapsedMs": 832,
  "retryAttempt": 1,
  "result": "SIDE_EFFECT_DEFERRED_TO_OUTBOX"
}
```

Yang kedua menjawab:

- service apa,
- operation apa,
- object bisnis apa,
- tenant mana,
- actor mana tanpa membocorkan PII,
- trace/correlation mana,
- dependency mana,
- failure type apa,
- timeout berapa,
- dampak business state apa,
- mekanisme recovery apa.

### 3.2 Observability Is A Contract

Untuk sistem microservices, telemetry harus diperlakukan seperti kontrak.

Sama seperti API contract, telemetry contract harus menjelaskan:

- nama service,
- nama operation,
- semantic attribute,
- trace propagation,
- correlation propagation,
- error taxonomy,
- business event taxonomy,
- metric naming,
- label/cardinality rule,
- log redaction rule,
- retention rule,
- dashboard ownership,
- alert ownership.

Tanpa kontrak, setiap service akan menciptakan nama sendiri:

```text
serviceA: requestId
serviceB: correlation_id
serviceC: corr
serviceD: txId
serviceE: transaction_id
```

Hasilnya telemetry tidak bisa dikorelasikan.

### 3.3 Observability Has Three Time Horizons

Observability melayani tiga horizon:

```text
Now       -> monitoring, alerting, mitigation
Recent    -> debugging, incident triage, rollback decision
Long-term -> trend, capacity planning, reliability engineering, architecture evolution
```

Contoh:

- latency p95 naik sekarang -> alert/triage,
- setelah deploy v42 error naik -> rollback/roll-forward,
- selama 3 bulan consumer lag meningkat setiap akhir bulan -> capacity/re-architecture.

### 3.4 Observability Must Follow The Business Flow

Top 1% engineer tidak hanya bertanya:

```text
Apakah CPU tinggi?
```

Tetapi:

```text
Apakah user bisa submit application?
Apakah officer bisa approve case?
Apakah notification terkirim?
Apakah SLA escalation berjalan?
Apakah projection worklist tertinggal?
Apakah audit trail lengkap?
Apakah tenant tertentu terdampak?
Apakah regulatory deadline terancam?
```

Microservices observability harus mengikuti business flow, bukan hanya infrastructure flow.

---

## 4. Istilah Dasar

### 4.1 Telemetry

Telemetry adalah data yang dihasilkan sistem untuk memahami perilaku sistem.

Bentuk umum:

- logs,
- metrics,
- traces,
- profiles,
- events,
- audit records,
- synthetic check result,
- health check result,
- runtime metadata.

### 4.2 Monitoring

Monitoring adalah penggunaan telemetry untuk mengetahui kondisi sistem, biasanya dengan dashboard dan alert.

Monitoring bertanya:

```text
Apakah sistem sehat sekarang?
```

### 4.3 Observability

Observability lebih luas. Observability bertanya:

```text
Mengapa sistem berperilaku seperti ini?
```

Monitoring sering bekerja untuk masalah yang sudah diketahui. Observability membantu eksplorasi masalah yang belum diketahui.

### 4.4 Logging

Logging adalah record event tekstual/terstruktur dari aplikasi.

Log bagus untuk:

- debugging,
- forensic,
- audit-support,
- state transition explanation,
- rare event detail.

Log buruk untuk:

- high-volume metric aggregation,
- real-time alert massal,
- sensitive payload dump,
- setiap baris kode.

### 4.5 Metrics

Metrics adalah pengukuran numerik yang biasanya diaggregasi dalam time series.

Metrics bagus untuk:

- alerting,
- dashboard,
- trend,
- SLO,
- capacity planning,
- anomaly detection.

Metrics buruk untuk:

- menjelaskan satu request spesifik,
- forensic detail,
- payload-level debugging.

### 4.6 Traces

Trace adalah representasi perjalanan satu operation/request/workflow melintasi komponen.

Trace terdiri dari spans.

```text
Trace: submit application
  Span: gateway POST /applications/{id}/submit
  Span: bff call application-service
  Span: application-service validate
  Span: application-service DB transaction
  Span: document-service verify documents
  Span: outbox insert
  Span: broker publish ApplicationSubmitted
  Span: projection-service consume event
```

Trace bagus untuk:

- memahami critical path,
- latency breakdown,
- dependency graph,
- failure propagation,
- cross-service debugging.

Trace buruk bila:

- sampling terlalu agresif,
- tidak ada business attributes,
- async boundary tidak dipropagasikan,
- span terlalu noisy,
- trace context hilang di queue/event.

### 4.7 Profiling

Profiling mengukur penggunaan CPU, memory allocation, lock contention, thread state, GC, dan runtime hotspot.

Profiling berguna untuk menjawab:

```text
Kenapa service lambat dari dalam process?
```

Tracing menjawab:

```text
Bagian mana dari distributed flow yang lambat?
```

Profiling menjawab:

```text
Kenapa span/service itu lambat secara internal?
```

### 4.8 Audit Trail

Audit trail bukan sekadar log.

Audit trail adalah record defensible untuk menjawab:

- siapa melakukan apa,
- kapan,
- atas objek apa,
- dari state apa ke state apa,
- berdasarkan otorisasi/policy apa,
- dengan hasil apa,
- apakah ada override/delegation,
- apakah ada alasan bisnis/legal.

Audit trail harus immutable/append-only secara logis, retention-aware, dan queryable untuk compliance.

---

## 5. Three Pillars Are Not Enough

Sering dikatakan observability memiliki tiga pilar:

1. logs,
2. metrics,
3. traces.

Ini berguna sebagai pengantar, tetapi tidak cukup untuk microservices production-grade.

Kamu juga membutuhkan:

1. **Events** — domain/business/operational events.
2. **Profiles** — CPU/allocation/thread/lock/GC behavior.
3. **Topology** — service dependency, runtime placement, version map.
4. **Configuration state** — effective config saat incident terjadi.
5. **Deployment metadata** — version, build SHA, feature flags.
6. **Business state** — workflow state, case status, projection lag.
7. **Security context** — actor, service identity, tenant, auth decision.
8. **Runbooks** — cara bertindak ketika sinyal muncul.
9. **SLO** — apa arti sehat dari perspektif user/business.

Tanpa SLO, dashboard hanya angka. Tanpa runbook, alert hanya suara alarm. Tanpa topology, trace hanya garis-garis. Tanpa deployment metadata, engineer sulit tahu apakah incident terkait release.

---

## 6. Golden Signals dan Beyond

Google SRE Book mendefinisikan empat golden signals untuk monitoring user-facing systems:

1. latency,
2. traffic,
3. errors,
4. saturation.

Ini sangat berguna sebagai baseline.

### 6.1 Latency

Latency mengukur waktu menyelesaikan operation.

Yang harus diperhatikan:

- average sering menipu,
- gunakan percentiles: p50, p90, p95, p99,
- bedakan successful latency dan failed latency,
- bedakan queue wait dan processing time,
- bedakan client-observed latency dan server-side latency.

Contoh metric:

```text
http.server.request.duration{service="application-service", route="POST /applications/{id}/submit", status="200"}
```

Jangan pakai label path mentah:

```text
BAD:
http_request_duration{path="/applications/APP-2026-000812/submit"}
```

Karena itu high-cardinality.

### 6.2 Traffic

Traffic mengukur demand.

Contoh:

- request per second,
- messages per second,
- events consumed per second,
- jobs started per minute,
- workflow transitions per hour,
- tenant-specific traffic.

Traffic harus dilihat bersama latency. Traffic turun drastis bisa berarti user tidak masuk, gateway reject, atau service mati.

### 6.3 Errors

Errors mengukur failure.

Error harus diklasifikasikan:

- client error,
- validation error,
- authorization error,
- dependency timeout,
- database error,
- conflict/concurrency error,
- retry exhausted,
- poison message,
- business rule rejection,
- system invariant violation.

Tidak semua non-2xx adalah incident.

Contoh:

- `400 VALIDATION_FAILED` mungkin normal,
- `401 TOKEN_EXPIRED` mungkin normal sampai rate tertentu,
- `403 ACCESS_DENIED` mungkin security signal,
- `409 STATE_CONFLICT` mungkin concurrency normal atau UX issue,
- `500 NULL_POINTER` adalah defect,
- `503 DEPENDENCY_UNAVAILABLE` adalah dependency/reliability signal.

### 6.4 Saturation

Saturation mengukur seberapa penuh resource.

Contoh:

- CPU utilization,
- memory/heap pressure,
- GC pause,
- thread pool active count,
- executor queue depth,
- connection pool active/waiting,
- message consumer lag,
- disk I/O,
- DB session count,
- broker queue depth,
- rate limit token exhaustion.

Saturation sering menjadi leading indicator sebelum error meningkat.

---

## 7. USE Method dan RED Method

### 7.1 USE Method

Untuk resource, gunakan USE:

```text
Utilization
Saturation
Errors
```

Contoh untuk database connection pool:

```text
Utilization: active connections / max connections
Saturation: pending acquisition / wait time
Errors: acquisition timeout / connection validation failure
```

Contoh untuk executor:

```text
Utilization: active threads / max threads
Saturation: queue depth / rejected tasks
Errors: task failure / rejection count
```

### 7.2 RED Method

Untuk service/API, gunakan RED:

```text
Rate
Errors
Duration
```

Contoh:

```text
Rate: requests/sec per route
Errors: error rate per route
Duration: p95/p99 per route
```

Untuk messaging consumer:

```text
Rate: messages consumed/sec
Errors: processing failure/sec
Duration: processing duration per message
```

Tambahkan:

```text
Lag: consumer lag / queue age
Retry: retry attempt distribution
DLQ: dead-letter count
```

---

## 8. Observability By Layer

### 8.1 Edge / Gateway

Gateway harus memantau:

- inbound request rate,
- status code distribution,
- authentication failure,
- authorization failure,
- request size rejection,
- rate limit rejection,
- route latency,
- upstream latency,
- upstream error,
- token validation latency,
- tenant-level traffic,
- client IP/user-agent anomaly,
- WAF/security events.

Gateway log harus punya:

```text
traceId
correlationId
requestId
routeId
clientId
actorType
actorIdHash
tenantId
method
routeTemplate
status
elapsedMs
upstreamService
upstreamStatus
rateLimitDecision
authDecision
```

Gateway tidak boleh menyimpan raw token, password, authorization header, atau payload sensitif.

### 8.2 BFF / Experience Layer

BFF harus memantau:

- screen/page operation latency,
- downstream fan-out count,
- partial response rate,
- fallback rate,
- UX-specific error,
- client version,
- feature flag,
- API composition latency breakdown.

BFF metric penting:

```text
bff.operation.duration{operation="loadOfficerWorklist"}
bff.downstream.calls{operation="loadOfficerWorklist", downstream="case-service"}
bff.partial_response.count{operation="loadOfficerWorklist"}
```

### 8.3 Domain Service

Domain service harus memantau:

- command rate,
- command success/failure,
- state transition count,
- business validation failure,
- concurrency conflict,
- invariant violation,
- outbox insertion,
- local transaction duration,
- dependency calls,
- domain event publication.

Contoh business metric:

```text
application.transition.count{from="DRAFT", to="SUBMITTED", tenant="agency-a"}
application.submit.failure.count{reason="MISSING_DOCUMENT"}
application.state.conflict.count{operation="submit"}
```

Hati-hati: `applicationId` tidak boleh menjadi metric label.

### 8.4 Database

Database observability harus mencakup:

- query latency,
- slow query count,
- connection pool active/idle/waiting,
- acquisition timeout,
- transaction duration,
- lock wait,
- deadlock,
- row contention,
- replication lag,
- storage usage,
- index usage,
- table growth,
- vacuum/analyze/statistics health untuk DB tertentu,
- redo/archive/log growth untuk DB tertentu.

Aplikasi Java minimal harus expose:

```text
jdbc.pool.active
jdbc.pool.idle
jdbc.pool.pending
jdbc.pool.max
jdbc.pool.acquire.duration
jdbc.query.duration
transaction.duration
```

Untuk SQL logging, jangan log semua query dengan parameter sensitif di production. Gunakan sampling, slow query threshold, dan redaction.

### 8.5 Messaging

Messaging observability harus mencakup:

- publish rate,
- publish latency,
- publish failure,
- consumer rate,
- consumer processing duration,
- consumer lag,
- queue depth,
- oldest message age,
- retry count,
- DLQ count,
- poison message count,
- duplicate message count,
- idempotency hit count,
- outbox pending count,
- outbox publish delay,
- inbox duplicate count,
- event schema version distribution.

Contoh:

```text
outbox.pending.count{service="application-service"}
outbox.oldest.age.seconds{service="application-service"}
consumer.lag{topic="application-events", consumerGroup="worklist-projection"}
message.processing.duration{messageType="ApplicationSubmitted"}
message.dlq.count{messageType="ApplicationSubmitted", reason="SCHEMA_INCOMPATIBLE"}
```

### 8.6 Workflow / Process Manager

Workflow observability harus mencakup:

- workflow instances started,
- completed,
- failed,
- stuck,
- timed out,
- compensated,
- escalated,
- average duration,
- p95 duration,
- state age,
- SLA breach count,
- timer fired,
- human task pending,
- retry exhausted,
- compensation failure.

Contoh:

```text
workflow.instance.count{workflow="ApplicationApproval", status="RUNNING"}
workflow.state.age.seconds{workflow="ApplicationApproval", state="PENDING_MANAGER_REVIEW"}
workflow.sla.breach.count{workflow="ApplicationApproval", sla="MANAGER_REVIEW_3D"}
workflow.compensation.count{workflow="ApplicationApproval", reason="DOCUMENT_REJECTED"}
```

### 8.7 Cache

Cache observability harus mencakup:

- hit rate,
- miss rate,
- eviction count,
- stale read count,
- cache load duration,
- cache error,
- key cardinality estimate,
- memory usage,
- stampede protection hit,
- in-flight dedup count,
- tenant-specific cache usage.

Cache hit rate saja tidak cukup. Cache dengan hit rate tinggi bisa tetap salah bila berisi data stale/security-leaking.

### 8.8 External Dependency

Untuk setiap dependency eksternal:

- latency,
- success rate,
- timeout count,
- retry count,
- circuit breaker state,
- rate limit response,
- authentication failure,
- quota remaining,
- dependency-specific error code,
- SLA/SLO dari vendor.

Gunakan dependency name stabil:

```text
external.dependency.duration{dependency="identity-provider", operation="tokenIntrospection"}
external.dependency.duration{dependency="postal-address-api", operation="resolvePostalCode"}
```

---

## 9. Correlation, Causation, Trace, Request, Message, Business ID

Salah satu kesalahan paling umum adalah mencampur semua ID menjadi satu.

### 9.1 Request ID

Request ID mengidentifikasi satu HTTP request masuk.

Scope:

```text
single inbound request
```

### 9.2 Trace ID

Trace ID mengidentifikasi satu distributed trace.

Scope:

```text
end-to-end technical execution path
```

### 9.3 Span ID

Span ID mengidentifikasi satu unit work dalam trace.

Scope:

```text
one operation inside trace
```

### 9.4 Correlation ID

Correlation ID mengelompokkan pekerjaan terkait secara logis.

Scope:

```text
business interaction / workflow / user action
```

Satu correlation ID bisa mencakup beberapa traces, terutama bila flow asynchronous dan long-running.

### 9.5 Causation ID

Causation ID menjelaskan sebab langsung sebuah event/message.

Contoh:

```text
Command SubmitApplication
  -> causes Event ApplicationSubmitted
      -> causes Command CreateWorklistItem
          -> causes Event WorklistItemCreated
```

Causation membantu rekonstruksi chain.

### 9.6 Message ID

Message ID mengidentifikasi satu message/event individual.

Scope:

```text
single message instance
```

Dipakai untuk deduplication.

### 9.7 Business ID

Business ID mengidentifikasi objek bisnis.

Contoh:

- applicationId,
- caseId,
- appealId,
- workflowInstanceId,
- documentId.

Business ID sangat berguna di logs/traces, tetapi jangan selalu dipakai sebagai metric label karena cardinality bisa sangat tinggi.

### 9.8 Tenant ID

Tenant ID mengidentifikasi boundary isolasi.

Tenant ID sering berguna sebagai label, tetapi harus dikontrol. Jika tenant sedikit/stabil, aman. Jika tenant bisa ribuan/jutaan, perlu strategi aggregation.

### 9.9 Recommended Propagation Model

Untuk HTTP:

```http
traceparent: 00-<trace-id>-<span-id>-01
tracestate: <vendor-state>
x-correlation-id: corr-...
x-request-id: req-...
x-tenant-id: agency-a
```

Untuk message envelope:

```json
{
  "messageId": "msg-...",
  "correlationId": "corr-...",
  "causationId": "cmd-...",
  "traceContext": {
    "traceparent": "00-...",
    "tracestate": "..."
  },
  "tenantId": "agency-a",
  "actor": {
    "type": "USER",
    "idHash": "u_..."
  },
  "schemaVersion": 3,
  "occurredAt": "2026-06-19T10:15:00Z",
  "publishedAt": "2026-06-19T10:15:01Z"
}
```

---

## 10. Distributed Tracing Design

### 10.1 Trace What Matters

Tidak semua function perlu span manual.

Span harus dibuat untuk:

- inbound request,
- outbound HTTP call,
- database transaction/query group,
- message publish,
- message consume,
- workflow step,
- state transition,
- external dependency call,
- expensive computation,
- cache load,
- lock wait,
- bulk job step.

Jangan membuat span untuk setiap getter/setter/helper kecil.

### 10.2 Span Naming

Gunakan nama stabil, bukan ID spesifik.

Good:

```text
POST /applications/{applicationId}/submit
ApplicationService.submit
DocumentService.verifyRequiredDocuments
ApplicationApproval.workflow.managerReview
```

Bad:

```text
POST /applications/APP-2026-000812/submit
submit APP-2026-000812
call method line 123
```

### 10.3 Span Attributes

Gunakan semantic attributes standar jika ada.

Tambahkan domain attributes dengan hati-hati:

```text
service.name=application-service
service.version=1.42.0
deployment.environment=prod
tenant.id=agency-a
application.type=SALESPERSON_LICENSE
application.state.from=DRAFT
application.state.to=SUBMITTED
workflow.name=ApplicationApproval
workflow.step=ManagerReview
error.type=DEPENDENCY_TIMEOUT
```

Jangan masukkan:

- raw NRIC/NIK/passport,
- access token,
- password,
- full address,
- email jika tidak perlu,
- full payload,
- free-form user input.

### 10.4 Async Trace Propagation

Async boundary sering memutus trace.

Saat publish event:

1. inject trace context ke message headers/envelope,
2. set causation ID,
3. set correlation ID,
4. consumer extract context,
5. consumer span harus `CONSUMER` kind,
6. publish berikutnya membuat child/link span sesuai kebutuhan.

Untuk long-running workflows, jangan memaksakan satu trace raksasa selama berhari-hari. Gunakan correlation ID/workflowInstanceId untuk menghubungkan beberapa traces.

### 10.5 Span Links

Dalam messaging, satu consumer processing bisa terkait dengan message yang berasal dari trace lama. Span link kadang lebih tepat daripada parent-child langsung.

Mental model:

```text
Synchronous call -> parent-child span
Async message    -> parent-child or span link depending semantics
Batch consume    -> span links to multiple message contexts
```

### 10.6 Sampling Strategy

Trace sampling harus disesuaikan dengan risiko.

Strategi:

1. Always sample errors.
2. Always sample slow requests.
3. Always sample rare workflows.
4. Sample normal high-volume traffic secara probabilistic.
5. Increase sampling during incident.
6. Sample per tenant/service/route secara adaptif jika perlu.

Bahaya sampling:

- error tidak terekam,
- low-volume critical path hilang,
- tenant tertentu tidak terlihat,
- async flow tidak lengkap.

### 10.7 Trace Anti-Patterns

1. Trace semua method internal.
2. Span name berisi ID unik.
3. Tidak propagate context ke async message.
4. Tidak ada business attribute.
5. Sampling semua traffic sama rata.
6. Trace hanya untuk HTTP, bukan messaging/workflow.
7. Trace mengandung PII.
8. Trace backend menjadi sangat mahal karena cardinality.

---

## 11. Logging Design

### 11.1 Structured Logging

Gunakan structured logging JSON untuk production.

Contoh:

```json
{
  "timestamp": "2026-06-19T13:45:00.123Z",
  "level": "WARN",
  "service.name": "application-service",
  "service.version": "1.42.0",
  "environment": "prod",
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
  "spanId": "00f067aa0ba902b7",
  "correlationId": "corr-20260619-001",
  "tenantId": "agency-a",
  "operation": "SubmitApplication",
  "applicationId": "APP-2026-000812",
  "event": "APPLICATION_SUBMIT_DEPENDENCY_TIMEOUT",
  "dependency": "document-service",
  "elapsedMs": 830,
  "timeoutMs": 800,
  "retryAttempt": 1,
  "result": "RETRY_SCHEDULED"
}
```

### 11.2 Log Levels

Gunakan level dengan disiplin.

#### TRACE

Untuk detail sangat granular. Biasanya disabled di production.

#### DEBUG

Untuk diagnostic detail. Bisa dinyalakan sementara.

#### INFO

Untuk event operational normal yang penting.

Contoh:

- service started,
- config loaded summary,
- state transition success,
- workflow completed,
- outbox publisher resumed.

#### WARN

Untuk kondisi abnormal tetapi masih recoverable.

Contoh:

- dependency timeout tetapi retryable,
- circuit breaker opened,
- projection lag melewati warning threshold,
- idempotency duplicate detected,
- near quota limit.

#### ERROR

Untuk failure yang butuh perhatian atau berdampak pada operation.

Contoh:

- command failed unexpectedly,
- invariant violation,
- retry exhausted,
- message moved to DLQ,
- data reconciliation mismatch.

### 11.3 What To Log

Log hal-hal berikut:

- business operation boundary,
- state transition,
- external side effect,
- security decision penting,
- retry exhausted,
- fallback used,
- circuit breaker open/close,
- poison message,
- reconciliation mismatch,
- migration/cutover step,
- admin/support action,
- data correction.

### 11.4 What Not To Log

Jangan log:

- password,
- token,
- session cookie,
- private key,
- full JWT,
- raw PII,
- full request body tanpa redaction,
- file content,
- large payload,
- repeated noisy success logs,
- SQL bind parameter sensitif.

### 11.5 Log Event Taxonomy

Buat taxonomy event log.

Contoh:

```text
APPLICATION_SUBMITTED
APPLICATION_SUBMIT_REJECTED_BY_RULE
APPLICATION_SUBMIT_DUPLICATE_REQUEST
APPLICATION_STATE_CONFLICT
APPLICATION_OUTBOX_INSERTED
APPLICATION_OUTBOX_PUBLISH_FAILED
APPLICATION_RECONCILIATION_MISMATCH
```

Nama event harus stabil dan queryable.

### 11.6 Logging Anti-Patterns

1. Log semua hal sebagai `INFO`.
2. Log exception tanpa context.
3. Log context tanpa stack trace.
4. Log payload penuh.
5. Log message free-form tidak queryable.
6. Log correlation ID tidak konsisten.
7. Log terlalu banyak sehingga signal tenggelam.
8. Log hanya error, tidak log state transition penting.

---

## 12. Metrics Design

### 12.1 Counter

Counter hanya naik.

Contoh:

```text
application_submit_total
application_submit_failed_total
message_consumed_total
message_dlq_total
```

### 12.2 Gauge

Gauge naik turun.

Contoh:

```text
outbox_pending_count
workflow_running_count
queue_depth
connection_pool_active
```

### 12.3 Histogram

Histogram untuk distribusi duration/size.

Contoh:

```text
http_server_request_duration_seconds
message_processing_duration_seconds
workflow_step_duration_seconds
```

### 12.4 Metric Naming

Gunakan nama stabil dan jelas.

Good:

```text
application_submission_total
application_submission_duration_seconds
outbox_publish_delay_seconds
workflow_state_age_seconds
```

Bad:

```text
count1
submitMetric
latency
foo_bar
```

### 12.5 Label Cardinality

Label cardinality adalah jumlah kemungkinan nilai label.

Low cardinality:

```text
service
route template
status code class
operation
result
error type
tenant group
message type
workflow state
```

High cardinality:

```text
userId
applicationId
caseId
email
full URL
requestId
traceId
exception message
SQL text
```

High-cardinality label dapat membuat metrics backend mahal atau crash.

Rule:

```text
Use high-cardinality fields in logs/traces, not metrics.
```

### 12.6 Business Metrics

Business metrics mengukur outcome domain.

Contoh regulatory/case-management:

```text
application_submitted_total{type="SALESPERSON_LICENSE"}
application_approved_total{type="SALESPERSON_LICENSE"}
case_escalated_total{reason="SLA_BREACH"}
case_pending_review_count{age_bucket="3_7_days"}
appeal_decision_total{decision="APPROVED"}
notification_sent_total{channel="EMAIL"}
```

Business metrics tidak menggantikan audit trail, tetapi membantu health dan trend.

### 12.7 Correctness Metrics

Correctness metrics penting untuk microservices.

Contoh:

```text
idempotency_duplicate_total
state_conflict_total
invariant_violation_total
reconciliation_mismatch_total
projection_lag_seconds
outbox_oldest_pending_age_seconds
inbox_duplicate_total
dlq_total
```

Ini sering lebih penting dari CPU.

### 12.8 Metric Anti-Patterns

1. Terlalu banyak metric tanpa owner.
2. Metric label berisi ID unik.
3. Metric tidak punya unit.
4. Metric tidak punya dashboard/runbook.
5. Metric teknis tanpa business interpretation.
6. Semua alert berbasis CPU.
7. Alert pada average latency, bukan percentile/SLO.
8. Tidak membedakan error expected vs unexpected.

---

## 13. SLI, SLO, SLA, Error Budget

### 13.1 SLI

Service Level Indicator adalah pengukuran.

Contoh:

```text
percentage of successful application submissions under 2 seconds
```

### 13.2 SLO

Service Level Objective adalah target internal.

Contoh:

```text
99.5% of application submission requests complete successfully under 2 seconds over 30 days.
```

### 13.3 SLA

Service Level Agreement adalah komitmen formal/kontrak, biasanya dengan konsekuensi bisnis/legal.

### 13.4 Error Budget

Error budget adalah toleransi failure yang tersisa.

Jika SLO 99.9%, error budget adalah 0.1%.

Error budget membantu trade-off:

```text
Banyak incident -> freeze risky releases, invest reliability.
SLO healthy     -> boleh ambil risiko delivery lebih cepat.
```

### 13.5 Contoh SLO Microservices

#### User-facing API

```text
SLI: successful HTTP requests under latency threshold
SLO: 99.5% POST /applications/{id}/submit returns 2xx/expected 4xx under 2s over 28 days
```

#### Async Processing

```text
SLI: event processed within freshness target
SLO: 99% ApplicationSubmitted events update worklist projection within 60 seconds
```

#### Workflow

```text
SLI: workflow reaches terminal state or expected waiting state
SLO: 99% of application approval workflows do not remain in transient system-processing states longer than 10 minutes
```

#### Notification

```text
SLI: notification accepted by provider
SLO: 99% of approval notifications are accepted by email provider within 5 minutes
```

#### Audit

```text
SLI: audit record created for auditable command
SLO: 100% of state-changing commands have an audit record in the same local transaction
```

Perhatikan: beberapa SLO harus 100% jika terkait compliance, tetapi harus sangat hati-hati karena 100% SLO membuat error budget nol.

---

## 14. Alert Design

### 14.1 Alert Should Be Actionable

Alert yang baik memiliki:

- impact,
- threshold,
- owner,
- severity,
- dashboard link,
- runbook link,
- likely causes,
- first mitigation,
- escalation path.

Alert yang buruk:

```text
CPU high
```

Alert yang lebih baik:

```text
Application submission success SLO burn rate high.
Impact: users may fail to submit applications.
Likely causes: document-service timeout, DB connection pool saturation, gateway 5xx.
First action: check dashboard X, trace query Y, recent deploy Z.
```

### 14.2 Symptom-Based vs Cause-Based Alert

Prioritaskan symptom-based alert untuk paging.

Good paging alert:

```text
Users cannot submit application.
Projection freshness SLO breached.
DLQ receiving critical event type.
Audit record creation failure.
```

Cause-based alerts bisa menjadi warning:

```text
CPU high.
Memory high.
Thread pool saturated.
DB pool active high.
```

Cause alerts sering noisy bila tidak berdampak user/business.

### 14.3 Multi-Window Burn Rate

Untuk SLO, burn-rate alert lebih baik daripada threshold sederhana.

Contoh konsep:

```text
Fast burn: error budget habis cepat dalam 5–30 menit -> page.
Slow burn: error budget terkikis selama beberapa jam/hari -> ticket/investigation.
```

### 14.4 Alert Severity

Contoh severity:

```text
SEV1: critical business function unavailable or data integrity risk
SEV2: degraded service with significant user impact
SEV3: localized issue or workaround available
SEV4: warning/trend/non-urgent
```

### 14.5 Alert Anti-Patterns

1. Alert untuk setiap exception.
2. Alert untuk semua 4xx.
3. Alert tanpa runbook.
4. Alert tanpa owner.
5. Alert threshold statis tanpa traffic context.
6. Alert CPU tinggi tanpa user impact.
7. Alert terlalu banyak sampai diabaikan.
8. Tidak alert untuk DLQ/audit failure/projection lag.

---

## 15. Dashboard Design

### 15.1 Dashboard Hierarchy

Buat dashboard berlapis:

1. Executive/business health.
2. System overview.
3. Service detail.
4. Dependency detail.
5. Workflow/detail domain.
6. Tenant detail.
7. Runtime/JVM detail.
8. Incident drill-down.

### 15.2 System Overview Dashboard

Isi minimal:

- SLO status,
- request rate,
- error rate,
- latency p50/p95/p99,
- saturation summary,
- top failing routes,
- top slow routes,
- dependency health,
- consumer lag,
- DLQ count,
- outbox pending age,
- recent deploys,
- feature flag changes.

### 15.3 Service Dashboard

Untuk setiap service:

- inbound rate/error/duration,
- outbound dependency rate/error/duration,
- DB pool usage,
- transaction duration,
- cache hit/miss,
- message publish/consume,
- JVM heap/non-heap,
- GC pause,
- CPU,
- thread count,
- virtual thread/pinned thread signal jika relevan,
- error taxonomy,
- circuit breaker state,
- config/version.

### 15.4 Business Workflow Dashboard

Untuk workflow:

- started/completed/failed,
- current state distribution,
- state age,
- SLA breach,
- escalation count,
- compensation count,
- stuck instance count,
- tenant breakdown,
- queue/projection lag related to workflow.

### 15.5 Dashboard Anti-Patterns

1. Semua metric dimasukkan ke satu dashboard.
2. Dashboard tidak menjawab pertanyaan operasional.
3. Tidak ada business view.
4. Tidak ada drill-down path.
5. Tidak menunjukkan deploy/config change.
6. Tidak menampilkan dependency.
7. Tidak membedakan environment.
8. Tidak ada owner.

---

## 16. Observability For Synchronous Flow

Untuk synchronous API, trace harus memperlihatkan critical path.

Contoh:

```text
POST /applications/{id}/submit
  Gateway auth/token validation       25 ms
  BFF input mapping                   10 ms
  ApplicationService command          80 ms
    DB load application               12 ms
    DocumentService verify            420 ms
    State transition                  8 ms
    DB commit + outbox insert         35 ms
  Response mapping                    5 ms
Total client latency                  620 ms
```

Pertanyaan yang harus bisa dijawab:

- route mana lambat,
- dependency mana lambat,
- berapa fan-out,
- timeout budget habis di mana,
- retry terjadi di layer mana,
- fallback dipakai atau tidak,
- tenant mana terdampak,
- deploy version mana,
- apakah error expected atau unexpected.

Synchronous API telemetry minimal:

```text
http.server.request.duration
http.server.request.count
http.server.error.count
http.client.request.duration
http.client.error.count
dependency.timeout.count
circuit.breaker.state
rate.limit.rejected.count
```

---

## 17. Observability For Asynchronous Flow

Asynchronous flow lebih sulit karena user request selesai sebelum side effect downstream selesai.

Contoh:

```text
Submit Application API returns 202 Accepted
  -> outbox record pending
  -> publisher emits ApplicationSubmitted
  -> worklist projection consumes event
  -> notification service sends email
```

Kamu perlu mengukur:

- outbox delay,
- publish success,
- broker lag,
- consumer processing time,
- projection freshness,
- notification delivery,
- DLQ,
- replay progress.

Metric penting:

```text
outbox_oldest_pending_age_seconds
message_publish_duration_seconds
consumer_lag
message_processing_duration_seconds
projection_freshness_seconds
message_dlq_total
message_retry_total
```

Trace harus menghubungkan:

- original command,
- outbox publish,
- consumer processing,
- projection update,
- notification side effect.

Jika trace tidak bisa kontinu karena long-running, gunakan:

```text
correlationId
causationId
workflowInstanceId
businessId
messageId
```

---

## 18. Observability For State Machines

State machine observability harus menjawab:

- state apa paling banyak,
- transition apa paling sering gagal,
- guard apa paling sering menolak,
- state apa yang stuck,
- berapa umur entity di state tertentu,
- siapa actor yang melakukan transition,
- policy version apa yang dipakai,
- apakah ada invalid transition attempt,
- apakah ada concurrency conflict.

Metric:

```text
state_transition_total{entity="Application", from="DRAFT", to="SUBMITTED"}
state_transition_rejected_total{entity="Application", reason="MISSING_DOCUMENT"}
state_conflict_total{entity="Application", transition="SUBMIT"}
entity_state_age_seconds{entity="Application", state="PENDING_REVIEW"}
invalid_transition_attempt_total{entity="Application", transition="APPROVE"}
```

Log event:

```json
{
  "event": "STATE_TRANSITION_COMPLETED",
  "entity": "Application",
  "entityId": "APP-2026-000812",
  "from": "DRAFT",
  "to": "SUBMITTED",
  "transition": "SUBMIT",
  "actorType": "USER",
  "actorIdHash": "u_...",
  "policyVersion": "submission-policy-v7",
  "correlationId": "corr-..."
}
```

---

## 19. Observability For Sagas and Workflows

Saga/workflow observability harus melacak step-level correctness.

Untuk setiap step:

- started,
- succeeded,
- failed,
- retrying,
- timed out,
- compensated,
- compensation failed,
- skipped,
- waiting human action,
- waiting external callback.

Contoh metric:

```text
saga_step_duration_seconds{saga="ApplicationSubmission", step="VerifyDocuments"}
saga_step_failure_total{saga="ApplicationSubmission", step="ReserveSlot", reason="TIMEOUT"}
saga_compensation_total{saga="ApplicationSubmission", step="ReleaseSlot"}
saga_instance_stuck_total{saga="ApplicationSubmission", state="WAITING_DOCUMENT_VERIFICATION"}
```

Untuk workflow long-running:

```text
workflow_instance_age_seconds
workflow_state_age_seconds
workflow_sla_breach_total
workflow_timer_fired_total
workflow_human_task_pending_count
```

Log harus bisa merekonstruksi timeline workflow.

---

## 20. Observability For Data Consistency

Distributed consistency membutuhkan telemetry khusus.

Metric:

```text
projection_lag_seconds
projection_rebuild_progress_percent
projection_replay_error_total
reconciliation_mismatch_total
reconciliation_correction_total
outbox_oldest_pending_age_seconds
inbox_duplicate_total
idempotency_replay_total
stale_read_total
```

Pertanyaan:

- apakah read model tertinggal,
- berapa lama tertinggal,
- apakah mismatch meningkat,
- apakah correction berjalan,
- apakah ada event tidak bisa diproses,
- apakah stale read masih dalam consistency SLA.

Contoh log reconciliation:

```json
{
  "event": "RECONCILIATION_MISMATCH_DETECTED",
  "sourceService": "application-service",
  "projection": "officer-worklist",
  "applicationId": "APP-2026-000812",
  "sourceState": "PENDING_REVIEW",
  "projectionState": "SUBMITTED",
  "lagSeconds": 780,
  "correlationId": "recon-20260619-001"
}
```

---

## 21. Observability For Security

Security observability harus menjawab:

- siapa mencoba apa,
- dari mana,
- dengan credential/token jenis apa,
- authorization decision apa,
- policy version apa,
- tenant mana,
- resource mana,
- apakah denied normal atau anomali,
- apakah ada token misuse,
- apakah ada cross-tenant attempt,
- apakah ada service identity mismatch.

Metric:

```text
authentication_failure_total{reason="TOKEN_EXPIRED"}
authorization_denied_total{policy="case-access", reason="TENANT_MISMATCH"}
mtls_handshake_failure_total{peer="unknown"}
token_exchange_failure_total{reason="AUDIENCE_INVALID"}
secret_rotation_failure_total
cross_tenant_access_denied_total
```

Security log harus aman:

- jangan log token,
- log hash actor ID bila perlu,
- log policy decision dan reason code,
- log tenant/resource ID dengan aturan privacy,
- log admin action detail.

Contoh:

```json
{
  "event": "AUTHORIZATION_DENIED",
  "policy": "case-read-policy",
  "policyVersion": "v12",
  "actorType": "USER",
  "actorIdHash": "u_...",
  "tenantId": "agency-a",
  "resourceType": "CASE",
  "resourceId": "CASE-2026-00091",
  "decision": "DENY",
  "reason": "TENANT_MISMATCH",
  "traceId": "..."
}
```

---

## 22. Observability For Multi-Tenancy

Tenant observability penting untuk isolation.

Pertanyaan:

- tenant mana paling banyak traffic,
- tenant mana paling banyak error,
- tenant mana paling lambat,
- tenant mana menyebabkan saturation,
- apakah noisy neighbor terjadi,
- apakah tenant tertentu terkena feature flag/config berbeda,
- apakah tenant tertentu mengalami projection lag.

Metric:

```text
http_request_total{tenantGroup="agency-a"}
http_request_duration_seconds{tenantGroup="agency-a"}
rate_limit_rejected_total{tenantGroup="agency-a"}
queue_depth{tenantGroup="agency-a"}
workflow_sla_breach_total{tenantGroup="agency-a"}
```

Jika tenant terlalu banyak, jangan label semua tenant mentah. Gunakan:

- top-N tenant dashboard,
- tenant tier,
- tenant group,
- sampled logs/traces dengan tenantId,
- ad hoc query di logs/traces,
- per-tenant metric hanya untuk premium/regulated tenant.

---

## 23. JVM and Java Runtime Observability

Untuk Java microservices, runtime observability wajib.

### 23.1 JVM Metrics

Pantau:

- heap used/committed/max,
- non-heap/metaspace,
- GC count/duration,
- allocation rate,
- thread count,
- blocked/waiting threads,
- class loading,
- direct buffer memory,
- file descriptors,
- CPU process/system,
- safepoint time jika tersedia,
- JIT compilation time,
- virtual thread metrics jika stack mendukung.

### 23.2 GC Observability

Untuk Java 8:

- CMS/Parallel/G1 tergantung konfigurasi.

Untuk Java 11/17:

- G1 default umum,
- ZGC tersedia dan makin matang.

Untuk Java 21/25:

- virtual threads memengaruhi concurrency model,
- ZGC generational dapat relevan untuk low-latency services,
- profiling dan pinned thread analysis menjadi penting bila memakai virtual threads.

Metric penting:

```text
jvm_gc_pause_seconds
jvm_memory_used_bytes
jvm_threads_live
jvm_threads_blocked
jvm_buffer_memory_used_bytes
process_cpu_usage
system_cpu_usage
```

### 23.3 Java Flight Recorder

JFR sangat berguna untuk:

- allocation hotspot,
- lock contention,
- socket read/write,
- file I/O,
- GC pause,
- thread park/block,
- virtual thread pinning,
- method profiling.

JFR bukan pengganti OpenTelemetry; JFR melengkapi telemetry distributed dengan insight runtime internal.

### 23.4 Virtual Threads Observability

Virtual threads membuat blocking style lebih scalable, tetapi tidak menghapus kebutuhan:

- timeout,
- concurrency limiter,
- DB pool limit,
- rate limit,
- backpressure,
- cancellation,
- structured logging,
- tracing.

Yang harus dipantau:

- carrier thread saturation,
- pinned virtual thread,
- blocking native/synchronized sections,
- downstream pool wait,
- request concurrency explosion,
- memory pressure dari terlalu banyak outstanding work.

---

## 24. Java 8–25 Implementation Considerations

### 24.1 Java 8

Karakteristik:

- masih banyak legacy enterprise,
- tidak ada module system,
- tidak ada records/sealed classes,
- observability sering berbasis servlet filter, MDC, Dropwizard Metrics, Micrometer versi kompatibel, agent-based instrumentation.

Rekomendasi:

- gunakan structured logging,
- disiplin MDC propagation,
- instrumentasi HTTP client/server,
- expose JVM metrics,
- hindari custom framework observability terlalu besar.

### 24.2 Java 11

Karakteristik:

- LTS modern baseline lama,
- JDK HttpClient tersedia,
- container awareness lebih baik dari era Java 8,
- cocok untuk migrasi observability modern.

Rekomendasi:

- gunakan OpenTelemetry Java Agent jika memungkinkan,
- gunakan Micrometer/OpenTelemetry bridge,
- tambah manual spans untuk domain/workflow.

### 24.3 Java 17

Karakteristik:

- baseline modern umum untuk Spring Boot 3,
- records/sealed classes membantu domain telemetry event modeling,
- strong encapsulation berdampak pada agent/reflection tertentu.

Rekomendasi:

- pakai records untuk structured event payload internal,
- sealed hierarchy untuk error taxonomy,
- standardize instrumentation.

### 24.4 Java 21

Karakteristik:

- virtual threads final,
- pattern matching switch final,
- sequencing APIs,
- sangat relevan untuk request-per-task server model.

Rekomendasi:

- tetap pakai concurrency limit,
- monitor virtual thread pinning,
- jangan menganggap virtual threads menggantikan resilience/backpressure,
- instrument structured concurrency jika digunakan.

### 24.5 Java 25

Karakteristik:

- latest GA generation,
- relevan untuk organisasi yang mengejar platform modern,
- harus dicek kompatibilitas framework/agent/library.

Rekomendasi:

- validasi OpenTelemetry agent compatibility,
- validasi framework runtime,
- lakukan staged rollout,
- bandingkan telemetry before/after upgrade.

---

## 25. Framework Positioning

### 25.1 OpenTelemetry

OpenTelemetry adalah standard utama untuk instrumentation, generation, collection, dan export telemetry seperti traces, metrics, dan logs.

Gunakan OpenTelemetry untuk:

- vendor-neutral telemetry,
- trace context propagation,
- semantic conventions,
- automatic instrumentation,
- manual instrumentation untuk domain spans,
- collector pipeline.

### 25.2 OpenTelemetry Collector

Collector berguna sebagai telemetry pipeline:

```text
Application -> OTel Collector -> Backend(s)
```

Fungsi:

- receive,
- process,
- batch,
- sample,
- filter,
- redact,
- enrich,
- export.

Collector membantu mengurangi vendor lock-in dan memusatkan policy telemetry.

### 25.3 Spring Boot / Micrometer

Spring Boot Actuator + Micrometer menyediakan observability untuk metrics/tracing/log correlation. Spring Boot documentation menyatakan OpenTelemetry didukung melalui Micrometer dan OTLP exporter.

Cocok untuk:

- Spring Boot services,
- metrics standardization,
- tracing integration,
- actuator endpoints,
- health/readiness/liveness,
- JVM metrics.

### 25.4 MicroProfile Telemetry

MicroProfile Telemetry mengadopsi OpenTelemetry untuk MicroProfile applications dan Jakarta RESTful Web Services auto tracing ketika dikonfigurasi.

Cocok untuk:

- Jakarta EE/MicroProfile services,
- Open Liberty/Quarkus/Helidon-style runtime,
- standardized enterprise Java telemetry.

### 25.5 Quarkus

Quarkus memiliki integrasi OpenTelemetry dan Micrometer/metrics depending stack. Cocok untuk:

- cloud-native Java,
- fast startup,
- native image consideration,
- Kubernetes-native deployment.

### 25.6 Plain Java

Plain Java tetap bisa production-grade bila memiliki:

- OpenTelemetry SDK/agent,
- structured logging,
- metrics registry,
- health endpoints,
- config/version endpoint,
- trace propagation wrapper,
- consistent executor/context propagation.

---

## 26. Context Propagation In Java

### 26.1 ThreadLocal and MDC Problem

Banyak Java logging/tracing memakai ThreadLocal/MDC.

Masalah:

- async execution pindah thread,
- executor tidak otomatis propagate context,
- CompletableFuture bisa kehilangan MDC,
- reactive pipeline punya context sendiri,
- virtual threads mengubah asumsi pooling,
- message consumer butuh extract context manual.

### 26.2 Context Propagation Rules

Aturan:

1. Extract context at boundary.
2. Store in request-scoped context.
3. Propagate to outbound calls.
4. Inject into messages.
5. Clear after use.
6. Never trust client-provided context blindly.
7. Generate missing IDs at edge.
8. Validate format/length.

### 26.3 Executor Wrapping

Untuk Java 8/11 style:

```java
public final class ContextAwareRunnable implements Runnable {
    private final Runnable delegate;
    private final Map<String, String> mdcContext;

    public ContextAwareRunnable(Runnable delegate) {
        this.delegate = delegate;
        this.mdcContext = org.slf4j.MDC.getCopyOfContextMap();
    }

    @Override
    public void run() {
        Map<String, String> previous = org.slf4j.MDC.getCopyOfContextMap();
        try {
            if (mdcContext != null) {
                org.slf4j.MDC.setContextMap(mdcContext);
            } else {
                org.slf4j.MDC.clear();
            }
            delegate.run();
        } finally {
            if (previous != null) {
                org.slf4j.MDC.setContextMap(previous);
            } else {
                org.slf4j.MDC.clear();
            }
        }
    }
}
```

Di stack modern, prefer integrasi OpenTelemetry context propagation/library resmi daripada custom wrapper di mana memungkinkan.

### 26.4 Reactive Context

Untuk reactive stack, jangan mengandalkan ThreadLocal biasa. Gunakan context propagation mekanisme framework.

Mental model:

```text
ThreadLocal works by thread identity.
Reactive works by pipeline context.
Virtual thread works by task identity but still needs boundary discipline.
```

---

## 27. Health Checks Are Not Observability

Health check penting, tetapi bukan observability penuh.

### 27.1 Liveness

Liveness menjawab:

```text
Apakah process perlu direstart?
```

Liveness tidak boleh gagal hanya karena dependency downstream sedang down, kecuali process benar-benar broken.

### 27.2 Readiness

Readiness menjawab:

```text
Apakah instance siap menerima traffic?
```

Readiness bisa mempertimbangkan:

- config valid,
- DB connection available,
- migration complete,
- cache warmed minimally,
- critical dependency reachable jika wajib.

### 27.3 Startup

Startup probe membantu aplikasi lambat start agar tidak dibunuh terlalu cepat.

### 27.4 Deep Health

Deep health untuk dashboard/operator, bukan selalu untuk Kubernetes readiness.

Contoh:

```text
identity-provider: degraded
postal-api: unavailable
broker: healthy
outbox: delayed
projection: lagging
```

### 27.5 Health Check Anti-Patterns

1. Liveness call DB sehingga semua pod restart saat DB down.
2. Readiness terlalu shallow sehingga menerima traffic sebelum siap.
3. Health endpoint mahal.
4. Health endpoint membuka informasi sensitif publik.
5. Tidak ada dependency health dashboard.

---

## 28. Observability And Deployment Metadata

Setiap telemetry harus bisa dikaitkan dengan deployment.

Tambahkan resource attributes:

```text
service.name
service.version
service.instance.id
deployment.environment
cloud.region
k8s.namespace.name
k8s.pod.name
container.name
git.commit.sha
build.number
runtime.java.version
feature.flag.snapshot
```

Pertanyaan saat incident:

- apakah error mulai setelah deploy,
- versi mana yang error,
- hanya pod tertentu atau semua,
- hanya node/zone tertentu,
- feature flag apa aktif,
- config apa berubah,
- Java runtime versi apa,
- dependency version apa.

Deployment annotation di dashboard sangat penting.

---

## 29. Observability And Configuration

Config adalah bagian dari root cause.

Log saat startup:

- config source summary,
- active profile,
- sanitized important config,
- feature flags,
- timeout values,
- retry values,
- pool sizes,
- endpoint names, bukan secrets.

Jangan log secret values.

Expose config snapshot endpoint untuk internal/admin bisa berguna, tetapi harus:

- protected,
- redacted,
- audited,
- environment-restricted.

Metric untuk config:

```text
config_reload_total
config_reload_failure_total
feature_flag_change_total
invalid_config_total
```

---

## 30. Observability Cost Control

Observability bisa mahal.

Biaya datang dari:

- log volume,
- trace volume,
- metric cardinality,
- retention panjang,
- indexing semua field,
- high-frequency scraping,
- duplicate telemetry pipeline,
- verbose payload logging,
- too many dashboards/alerts.

Strategi kontrol:

1. Structured logs with selected indexed fields.
2. Sampling traces.
3. Tail-based sampling for errors/slow traces.
4. Drop noisy logs at collector.
5. Redact at source/collector.
6. Limit metric labels.
7. Different retention by data class.
8. Archive audit separately from debug logs.
9. Use exemplars to link metrics to traces.
10. Define telemetry budget per service.

Observability harus cukup kaya untuk investigasi, tetapi tidak boleh menjadi sumber biaya tak terkendali.

---

## 31. Security and Privacy In Observability

Telemetry sering berisi data sensitif.

### 31.1 Data Classification

Klasifikasikan:

- public,
- internal,
- confidential,
- restricted,
- regulated/PII.

### 31.2 Redaction

Redact:

- password,
- token,
- cookie,
- API key,
- personal identifier,
- full address,
- phone/email jika tidak perlu,
- financial data,
- document content,
- free text field sensitif.

### 31.3 Hashing

Untuk actor/user ID, gunakan hash stabil bila perlu korelasi tanpa membuka ID mentah.

```text
actorIdHash = HMAC-SHA256(secret, actorId)
```

Jangan gunakan plain SHA tanpa secret untuk ID yang mudah ditebak.

### 31.4 Access Control

Observability backend harus punya access control:

- siapa boleh lihat prod logs,
- siapa boleh lihat security logs,
- siapa boleh lihat tenant-specific data,
- siapa boleh export telemetry,
- audit akses observability.

### 31.5 Retention

Retention berbeda:

```text
Debug logs: short
Operational logs: medium
Security logs: longer
Audit records: according to policy/legal requirement
Metrics: aggregated long-term
Traces: sampled short/medium
```

---

## 32. Observability For Auditability

Auditability dan observability beririsan, tetapi tidak sama.

| Aspect | Observability | Auditability |
|---|---|---|
| Tujuan | Operasi/debug/reliability | Pembuktian/defensibility/compliance |
| Data | Logs/metrics/traces | Audit records |
| Retention | Variatif | Biasanya lebih panjang |
| Mutability | Bisa ephemeral | Harus defensible/append-only secara logis |
| Query | Operational | Legal/business/accountability |
| Detail | Technical + business | Actor/action/object/time/reason/outcome |

State-changing command harus menghasilkan audit record dalam transaction boundary yang tepat.

Contoh:

```text
Command: ApproveApplication
DB transaction:
  - update application state
  - insert audit record
  - insert outbox event
commit
```

Log boleh membantu debugging, tetapi audit record adalah sumber pembuktian.

---

## 33. Observability-Driven Design Checklist

Saat mendesain endpoint/consumer/workflow baru, jawab:

### 33.1 For API

- Apa operation name stabilnya?
- Apa route template-nya?
- Apa latency SLO-nya?
- Error taxonomy apa?
- Apa correlation/request/trace propagation?
- Apa metrics minimal?
- Apa log event penting?
- Apa field yang harus direksi?
- Apa dashboard yang perlu diperbarui?
- Apa alert yang perlu dibuat?

### 33.2 For Event Consumer

- Apa message type?
- Apa schema version?
- Apa correlation/causation propagation?
- Apa idempotency metric?
- Apa retry/DLQ metric?
- Apa lag/freshness SLO?
- Apa replay behavior?
- Apa log untuk poison message?
- Apa business impact jika consumer tertinggal?

### 33.3 For Workflow

- Apa workflow instance ID?
- Apa state/step taxonomy?
- Apa stuck condition?
- Apa SLA?
- Apa escalation metric?
- Apa compensation metric?
- Apa audit requirement?
- Apa dashboard untuk operator?

### 33.4 For External Dependency

- Apa dependency name?
- Apa operation name?
- Apa timeout?
- Apa retry policy?
- Apa circuit breaker?
- Apa error code mapping?
- Apa fallback?
- Apa alert bila dependency degraded?

---

## 34. Case Study: Regulatory Application Submission

### 34.1 Flow

```text
User submits application
  -> API Gateway authenticates user
  -> BFF validates UI-level request
  -> Application Service validates business rules
  -> Document Service verifies required documents
  -> Application Service changes state DRAFT -> SUBMITTED
  -> Audit record inserted
  -> Outbox event inserted
  -> Publisher emits ApplicationSubmitted
  -> Worklist Projection updates officer worklist
  -> Notification Service sends confirmation email
```

### 34.2 Observability Requirements

#### User-facing SLO

```text
99.5% of application submission attempts return expected result under 2 seconds.
```

Expected result includes:

- success,
- validation rejection,
- state conflict,
- authorization denied.

Unexpected result includes:

- 5xx,
- dependency timeout without graceful handling,
- DB failure,
- unknown error.

#### Async Freshness SLO

```text
99% of submitted applications appear in officer worklist within 60 seconds.
```

#### Audit Correctness

```text
100% of successful state-changing commands create audit record in same local transaction.
```

### 34.3 Metrics

```text
application_submit_total{result="SUCCESS"}
application_submit_total{result="VALIDATION_FAILED"}
application_submit_total{result="STATE_CONFLICT"}
application_submit_total{result="SYSTEM_ERROR"}
application_submit_duration_seconds
application_state_transition_total{from="DRAFT", to="SUBMITTED"}
audit_record_insert_total{entity="Application"}
outbox_pending_count
outbox_oldest_pending_age_seconds
projection_freshness_seconds{projection="officer-worklist"}
notification_send_total{channel="EMAIL", result="SUCCESS"}
```

### 34.4 Logs

Important log events:

```text
APPLICATION_SUBMIT_RECEIVED
APPLICATION_SUBMIT_REJECTED
APPLICATION_STATE_TRANSITION_COMPLETED
APPLICATION_AUDIT_RECORD_CREATED
APPLICATION_OUTBOX_EVENT_CREATED
APPLICATION_SUBMITTED_EVENT_PUBLISHED
APPLICATION_WORKLIST_PROJECTION_UPDATED
APPLICATION_NOTIFICATION_SENT
```

### 34.5 Trace

```text
Trace: SubmitApplication
  Span: Gateway POST /applications/{id}/submit
  Span: BFF submitApplication
  Span: ApplicationService.submit
  Span: DocumentService.verifyRequiredDocuments
  Span: ApplicationRepository.load
  Span: ApplicationStateMachine.transition
  Span: AuditRepository.insert
  Span: OutboxRepository.insert
  Span: DB commit
```

Async continuation:

```text
Trace/Linked Trace: Publish ApplicationSubmitted
  Span: OutboxPublisher.poll
  Span: Broker.publish

Trace/Linked Trace: Consume ApplicationSubmitted
  Span: WorklistProjection.consume
  Span: WorklistRepository.upsert

Trace/Linked Trace: Send Notification
  Span: NotificationService.consume
  Span: EmailProvider.send
```

### 34.6 Alerts

```text
Application submission SLO burn rate high
Projection freshness SLO breached
Outbox oldest pending age > 5 minutes
ApplicationSubmitted DLQ count > 0
Audit record insert failure > 0
Document-service timeout rate high
```

---

## 35. Example Java Code Sketch

### 35.1 Domain Error Taxonomy With Java 17+

```java
public sealed interface SubmitFailure permits
        SubmitFailure.ValidationFailed,
        SubmitFailure.StateConflict,
        SubmitFailure.DependencyTimeout,
        SubmitFailure.UnexpectedFailure {

    String code();

    record ValidationFailed(String code, String rule) implements SubmitFailure {}
    record StateConflict(String code, String currentState) implements SubmitFailure {}
    record DependencyTimeout(String code, String dependency, long timeoutMs) implements SubmitFailure {}
    record UnexpectedFailure(String code, String category) implements SubmitFailure {}
}
```

For Java 8, use interface + final classes or enum-backed error code.

### 35.2 Structured Log Helper Concept

```java
public final class AuditLogFields {
    private AuditLogFields() {}

    public static Map<String, Object> applicationTransition(
            String applicationId,
            String tenantId,
            String from,
            String to,
            String actorIdHash,
            String policyVersion
    ) {
        Map<String, Object> fields = new LinkedHashMap<>();
        fields.put("event", "APPLICATION_STATE_TRANSITION_COMPLETED");
        fields.put("entity", "Application");
        fields.put("applicationId", applicationId);
        fields.put("tenantId", tenantId);
        fields.put("from", from);
        fields.put("to", to);
        fields.put("actorIdHash", actorIdHash);
        fields.put("policyVersion", policyVersion);
        return fields;
    }
}
```

### 35.3 Metric Naming Example

Pseudo-code:

```java
Timer.Sample sample = Timer.start(registry);
try {
    SubmitResult result = handler.submit(command);
    registry.counter("application_submit_total", "result", result.metricResult()).increment();
    return result;
} catch (SubmitException ex) {
    registry.counter("application_submit_total", "result", ex.metricResult()).increment();
    throw ex;
} finally {
    sample.stop(registry.timer("application_submit_duration_seconds"));
}
```

In production, adapt to Micrometer/OpenTelemetry conventions and avoid duplicating framework-provided HTTP metrics.

### 35.4 Manual Span Concept

Pseudo-code:

```java
Span span = tracer.spanBuilder("ApplicationStateMachine.transition")
        .setAttribute("application.state.from", fromState)
        .setAttribute("application.state.to", toState)
        .setAttribute("application.transition", transitionName)
        .setAttribute("tenant.id", tenantId)
        .startSpan();
try (Scope ignored = span.makeCurrent()) {
    transitionExecutor.execute(command);
    span.setStatus(StatusCode.OK);
} catch (Exception ex) {
    span.recordException(ex);
    span.setStatus(StatusCode.ERROR, ex.getClass().getSimpleName());
    throw ex;
} finally {
    span.end();
}
```

---

## 36. Failure Modes Observability Must Reveal

### 36.1 Dependency Slowdown

Signals:

- downstream latency p95/p99 naik,
- client timeout naik,
- circuit breaker opens,
- retry count naik,
- thread/connection pool saturation naik.

### 36.2 Retry Storm

Signals:

- inbound traffic normal,
- outbound traffic ke dependency naik drastis,
- retry attempt distribution naik,
- error rate tetap tinggi,
- dependency makin lambat.

### 36.3 Projection Lag

Signals:

- event publish normal,
- consumer lag naik,
- projection freshness breach,
- user complaints stale worklist.

### 36.4 Poison Message

Signals:

- one message repeatedly fails,
- retry exhausted,
- DLQ count naik,
- consumer throughput turun,
- same messageId appears repeatedly.

### 36.5 Tenant Noisy Neighbor

Signals:

- one tenant traffic spike,
- global latency naik,
- tenant-specific rate limit triggered,
- shared pool saturation,
- other tenants affected.

### 36.6 Config Drift

Signals:

- only subset pods fail,
- different timeout/pool setting,
- service.version same but config hash different,
- issue appears after config reload.

### 36.7 Data Integrity Mismatch

Signals:

- reconciliation mismatch count naik,
- source state != projection state,
- missing audit record,
- outbox pending/stuck,
- duplicate business effect.

---

## 37. Anti-Patterns

### 37.1 Log-Driven Observability Only

Semua investigasi memakai grep log.

Masalah:

- lambat,
- mahal,
- tidak cocok untuk alert,
- sulit lihat trend,
- trace hilang.

### 37.2 Metrics Without Context

Ada metrics, tetapi tidak ada trace/log yang bisa menjelaskan outlier.

### 37.3 Trace Without Business Meaning

Trace menunjukkan HTTP calls, tetapi tidak tahu applicationId, workflow, state, tenant, atau business operation.

### 37.4 Dashboard Theater

Banyak dashboard, tetapi saat incident tetap bingung.

### 37.5 Alert Fatigue

Terlalu banyak alert membuat tim mengabaikan semuanya.

### 37.6 High-Cardinality Explosion

Metric label memakai userId/requestId/entityId sehingga backend telemetry berat/mahal.

### 37.7 PII Logging

Payload sensitif masuk log/traces dan menjadi risiko compliance.

### 37.8 Missing Async Correlation

HTTP trace bagus, tetapi event-driven continuation hilang.

### 37.9 No Deploy Metadata

Incident terjadi, tetapi tidak tahu versi/config/feature flag yang aktif.

### 37.10 No Ownership

Alert dan dashboard ada, tetapi tidak ada tim yang bertanggung jawab.

---

## 38. Production Readiness Checklist

### 38.1 Baseline

- [ ] Semua service punya `service.name`, `service.version`, environment, instance ID.
- [ ] Structured logging aktif.
- [ ] Trace ID dan correlation ID muncul di logs.
- [ ] HTTP server/client tracing aktif.
- [ ] Messaging publish/consume tracing aktif.
- [ ] JVM metrics aktif.
- [ ] DB pool metrics aktif.
- [ ] Health/readiness/liveness endpoint benar.

### 38.2 Logs

- [ ] Log taxonomy tersedia.
- [ ] Error logs memiliki context cukup.
- [ ] State transition penting dicatat.
- [ ] Payload sensitif tidak dilog.
- [ ] Redaction policy diuji.
- [ ] Log volume dipantau.

### 38.3 Metrics

- [ ] RED metrics untuk API.
- [ ] USE metrics untuk resource.
- [ ] Messaging lag/DLQ/retry metrics.
- [ ] Outbox/inbox metrics.
- [ ] Workflow/state machine metrics.
- [ ] Business metrics penting.
- [ ] Metric labels dikontrol cardinality-nya.

### 38.4 Traces

- [ ] Trace context propagated across HTTP.
- [ ] Trace/correlation propagated across messages.
- [ ] Important domain spans ada.
- [ ] Errors and slow traces sampled.
- [ ] Trace attributes tidak berisi PII.
- [ ] Sampling strategy jelas.

### 38.5 SLO and Alerts

- [ ] Critical user journeys punya SLO.
- [ ] Async freshness punya SLO.
- [ ] Audit/data integrity punya alert.
- [ ] Alerts actionable dan punya runbook.
- [ ] Burn-rate alert untuk SLO penting.
- [ ] DLQ/outbox/projection lag alert tersedia.

### 38.6 Dashboards

- [ ] System overview dashboard.
- [ ] Service dashboard.
- [ ] Dependency dashboard.
- [ ] Workflow dashboard.
- [ ] Tenant dashboard jika multi-tenant.
- [ ] Deployment/config annotation.

### 38.7 Security/Privacy

- [ ] Telemetry access controlled.
- [ ] Secrets/tokens redacted.
- [ ] PII policy jelas.
- [ ] Security events monitored.
- [ ] Audit trail terpisah dari debug logs.

### 38.8 Operations

- [ ] Runbook tersedia.
- [ ] On-call ownership jelas.
- [ ] Incident review memakai telemetry.
- [ ] Telemetry cost monitored.
- [ ] Observability tested in staging/load test.

---

## 39. Architecture Review Questions

Gunakan pertanyaan ini saat review desain microservice:

1. Apa user journey utama dan SLO-nya?
2. Apa business operation yang harus terlihat di telemetry?
3. Apakah route/message/workflow naming stabil?
4. Bagaimana correlation ID dibuat dan dipropagasikan?
5. Bagaimana trace context melewati async boundary?
6. Apa metric untuk latency, traffic, error, saturation?
7. Apa metric untuk correctness?
8. Apa metric untuk workflow/state machine?
9. Apa metric untuk projection freshness?
10. Apa metric untuk outbox/inbox/DLQ?
11. Apa yang terjadi bila dependency lambat?
12. Alert apa yang muncul?
13. Runbook apa yang dipakai?
14. Apa dashboard pertama saat incident?
15. Apakah telemetry menyertakan service version/config/deploy metadata?
16. Apakah ada high-cardinality label?
17. Apakah ada PII/token di logs/traces?
18. Apakah tenant impact bisa dipisahkan?
19. Apakah audit record cukup defensible?
20. Berapa biaya telemetry dan retention-nya?

---

## 40. Practical Exercises

### Exercise 1 — Design Observability For One Endpoint

Ambil endpoint:

```text
POST /applications/{id}/submit
```

Desain:

- spans,
- logs,
- metrics,
- SLO,
- alerts,
- dashboard panel,
- redaction rule.

### Exercise 2 — Design Observability For One Event Flow

Ambil event:

```text
ApplicationSubmitted
```

Desain:

- envelope context,
- publish metrics,
- consume metrics,
- DLQ handling,
- replay metric,
- projection freshness,
- trace/span link.

### Exercise 3 — Find Bad Metric Labels

Evaluasi metric berikut:

```text
http_request_duration_seconds{path="/applications/APP-123/submit", userId="U-991", traceId="abc"}
```

Perbaiki agar cardinality aman.

### Exercise 4 — Build Incident Timeline

Diberikan:

```text
10:00 deploy v42
10:05 p95 submit latency naik
10:07 document-service timeout naik
10:08 retry count naik
10:10 DB pool pending naik
10:12 submit SLO burn alert
10:15 outbox pending age naik
```

Susun hipotesis root cause dan tindakan mitigasi awal.

### Exercise 5 — Audit vs Log

Untuk command:

```text
ApproveApplication
```

Tentukan mana yang harus masuk:

- log,
- audit record,
- metric,
- trace attribute.

---

## 41. Summary

Observability untuk microservices bukan hanya logs, metrics, dan traces. Observability adalah kemampuan sistem untuk menjelaskan perilakunya sendiri dalam konteks:

- technical execution,
- business operation,
- tenant boundary,
- security decision,
- workflow lifecycle,
- data consistency,
- deployment/configuration,
- runtime capacity,
- audit defensibility.

Engineer top-tier tidak mendesain observability setelah sistem jadi. Mereka mendesain observability bersama API, event, workflow, state machine, database, security, dan deployment.

Prinsip utama:

1. Telemetry harus menjawab pertanyaan operasional.
2. Metrics untuk alert/trend, logs untuk detail/forensic, traces untuk path/latency/correlation.
3. Business metrics dan correctness metrics sama pentingnya dengan CPU/memory.
4. Correlation, causation, trace, message, dan business ID tidak boleh dicampur sembarangan.
5. Async flow butuh observability khusus: lag, freshness, DLQ, replay, outbox/inbox.
6. State machine/workflow harus punya metrics state age, transition, stuck, SLA, compensation.
7. High-cardinality dan PII adalah dua musuh besar observability production.
8. Alert harus actionable, symptom-oriented, punya owner dan runbook.
9. Observability harus menyertakan deployment/config metadata.
10. Observability yang baik mempercepat recovery dan memperbaiki arsitektur jangka panjang.

---

## 42. Referensi

Referensi yang relevan untuk part ini:

1. OpenTelemetry Documentation — What is OpenTelemetry?  
   https://opentelemetry.io/docs/what-is-opentelemetry/

2. OpenTelemetry Semantic Conventions  
   https://opentelemetry.io/docs/concepts/semantic-conventions/

3. Google SRE Book — Monitoring Distributed Systems  
   https://sre.google/sre-book/monitoring-distributed-systems/

4. MicroProfile Telemetry 2.0  
   https://microprofile.io/specifications/telemetry/2-0/

5. Micrometer Documentation  
   https://micrometer.io/docs/

6. Spring Boot Observability  
   https://docs.spring.io/spring-boot/reference/actuator/observability.html

7. Spring Boot Tracing  
   https://docs.spring.io/spring-boot/reference/actuator/tracing.html

8. OpenTelemetry Java Instrumentation  
   https://github.com/open-telemetry/opentelemetry-java-instrumentation

9. OpenTelemetry Collector  
   https://opentelemetry.io/docs/collector/

10. Google SRE Workbook — Alerting on SLOs  
    https://sre.google/workbook/alerting-on-slos/

---

## 43. Status Seri

Part ini adalah **Part 22 dari 35**.

Seri belum selesai.

Part berikutnya:

```text
Part 23 — Testing Strategy for Microservices
```

Filename berikutnya:

```text
learn-java-microservices-patterns-advanced-engineering-23-testing-strategy.md
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-microservices-patterns-advanced-engineering-21-multi-tenancy-isolation-regulatory-segmentation.md">⬅️ Part 21 — Tenancy, Isolation, and Regulatory Segmentation</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-microservices-patterns-advanced-engineering-23-testing-strategy.md">0. Posisi Part Ini Dalam Seri ➡️</a>
</div>
