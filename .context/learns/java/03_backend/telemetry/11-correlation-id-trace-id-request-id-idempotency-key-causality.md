# Part 11 — Correlation ID, Trace ID, Request ID, Idempotency Key, Causality

> Series: `learn-java-logging-observability-profiling-troubleshooting-engineering`  
> Scope: Java 8 sampai Java 25  
> Fokus: identitas runtime, kausalitas, correlation model, request/message/job/process identity, distributed trace propagation, dan desain diagnosability untuk sistem Java enterprise.

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas **context propagation**: bagaimana context seperti MDC, `ThreadLocal`, OpenTelemetry Context, virtual threads, dan `ScopedValue` bergerak melewati boundary eksekusi.

Bagian ini menjawab pertanyaan yang lebih fundamental:

> **Context apa yang sebenarnya harus dibawa? ID mana yang mewakili apa? Bagaimana kita memastikan log, trace, metric, event, audit, dan workflow bisa disusun ulang menjadi cerita kausal yang benar?**

Banyak sistem punya banyak ID:

- `requestId`
- `correlationId`
- `traceId`
- `spanId`
- `sessionId`
- `transactionId`
- `idempotencyKey`
- `messageId`
- `jobExecutionId`
- `caseId`
- `workflowInstanceId`
- `tenantId`
- `userId`

Engineer biasa sering memperlakukannya sebagai label acak. Engineer senior memperlakukannya sebagai **runtime identity model**. Engineer top-tier memperlakukannya sebagai **causal graph contract**.

Artinya: setiap ID harus punya makna, boundary, lifecycle, ownership, cardinality, retention policy, trust model, dan failure behavior.

---

## 1. Masalah Dasar: Sistem Produksi Tidak Punya Satu Timeline

Di local development, kita sering merasa request berjalan seperti ini:

```text
User clicks button
  -> Controller
  -> Service
  -> Repository
  -> Database
  -> Response
```

Di production enterprise system, kenyataannya lebih seperti ini:

```text
Browser
  -> API Gateway
  -> Web Application Firewall
  -> Load Balancer
  -> Service A
      -> Database
      -> Redis
      -> Service B
          -> External API
      -> Message Broker
          -> Consumer C
              -> Batch Table
              -> Scheduler Retry
              -> Email Service
              -> Audit Service
```

Satu aksi user bisa menghasilkan:

- beberapa HTTP request,
- beberapa DB transaction,
- beberapa queue message,
- beberapa retry,
- beberapa asynchronous worker,
- beberapa scheduled follow-up,
- beberapa audit entry,
- beberapa notification,
- beberapa state transition,
- beberapa error yang muncul jauh setelah response awal berhasil.

Jadi pertanyaan troubleshooting bukan lagi:

> “Di method mana error terjadi?”

Tetapi:

> “Event mana yang punya hubungan kausal dengan event lain, dan bagaimana kita membuktikannya?”

Itulah fungsi ID runtime.

---

## 2. Core Mental Model: Identifier Is a Claim

Sebuah ID bukan sekadar string. Sebuah ID adalah **claim**.

Contoh:

```json
{
  "trace.id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "span.id": "00f067aa0ba902b7",
  "correlation.id": "CORR-2026-06-18-000123",
  "request.id": "REQ-abc123",
  "case.id": "CASE-2026-0000901"
}
```

Field-field itu membuat klaim berikut:

- `trace.id`: event ini bagian dari distributed trace yang sama.
- `span.id`: event ini terjadi dalam operation tertentu di trace itu.
- `correlation.id`: event ini bagian dari business/operational conversation yang sama.
- `request.id`: event ini terjadi dalam request attempt tertentu.
- `case.id`: event ini berdampak pada case/domain object tertentu.

Kalau klaim ini salah, observability menjadi misleading.

Misalnya:

- semua request memakai `correlation.id` yang sama karena MDC leak,
- retry request memakai `request.id` baru tapi `idempotency.key` hilang,
- async consumer membuat `trace.id` baru sehingga causal chain putus,
- scheduled job tidak punya `job.execution.id`, sehingga duplicate execution tidak bisa dibuktikan,
- audit event punya `case.id` tetapi tidak punya actor/request context.

Top-tier engineer tidak hanya menambahkan ID. Mereka memastikan **semantic correctness** dari ID.

---

## 3. Taxonomy: Jenis-Jenis Runtime Identity

Kita mulai dari peta besar.

| ID | Pertanyaan yang Dijawab | Scope | Biasanya Dibuat Oleh | Risiko Utama |
|---|---|---:|---|---|
| `trace.id` | Flow teknis end-to-end mana? | Distributed technical flow | Tracing system / OTel | Broken propagation |
| `span.id` | Operation teknis mana? | Single operation | Tracer | Wrong span boundary |
| `correlation.id` | Percakapan/aksi bisnis mana? | Business/operational flow | Edge service / client / gateway | Overused / ambiguous |
| `request.id` | HTTP request attempt mana? | Single inbound request | Gateway/service | Confused with correlation |
| `transaction.id` | Unit transaksi/domain operation mana? | Business transaction | Application | Too generic |
| `idempotency.key` | Duplicate-safe command mana? | Logical mutation request | Client or server | Stored incorrectly |
| `message.id` | Message broker event mana? | Single message | Producer/broker | Lost across retry |
| `causation.id` | Event mana yang menyebabkan event ini? | Event chain | Producer/application | Rarely modeled |
| `job.execution.id` | Eksekusi job tertentu mana? | Batch/scheduler run | Scheduler/job framework | Missing for retries |
| `workflow.instance.id` | Workflow/process instance mana? | Process orchestration | BPM/workflow engine | Mixed with case id |
| `case.id` | Domain case/entity mana? | Business entity | Domain system | PII/security exposure |
| `tenant.id` | Tenant/agency/customer mana? | Multi-tenant boundary | Auth/domain context | High-cardinality but needed |
| `user.id` | Actor manusia/sistem mana? | Security/business context | Auth system | PII/privacy |
| `session.id` | Login/browser session mana? | User session | Auth/session layer | Sensitive if raw |

Catatan penting: tidak semua ID wajib muncul di semua log. Yang wajib adalah ID yang membuat event bisa ditempatkan secara benar dalam timeline dan impact graph.

---

## 4. Trace ID: Identitas Distributed Technical Flow

`trace.id` menjawab:

> “Operation teknis ini bagian dari distributed trace mana?”

Dalam W3C Trace Context, `traceparent` membawa empat komponen:

```text
version-trace-id-parent-id-trace-flags
```

Contoh:

```text
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
```

Maknanya:

- `00`: version.
- `4bf92f3577b34da6a3ce929d0e0e4736`: trace ID.
- `00f067aa0ba902b7`: parent span ID.
- `01`: trace flags, misalnya sampled.

### 4.1 Karakteristik Trace ID

Trace ID:

- harus unik secara probabilistik,
- biasanya 16-byte/32 hex chars,
- merepresentasikan satu trace graph,
- melewati service boundary,
- tidak boleh mengandung data bisnis/PII,
- tidak boleh dijadikan authorization mechanism,
- tidak boleh dipakai sebagai idempotency key,
- tidak selalu cocok sebagai business correlation ID.

### 4.2 Trace ID Bukan Request ID

Satu HTTP request inbound biasanya menghasilkan satu root/server span dalam satu trace. Tetapi trace bisa melewati banyak request internal.

```text
External HTTP Request
  trace.id = T1
  request.id = R1

Service A -> Service B
  trace.id = T1
  outbound request.id maybe R2

Service B -> Service C
  trace.id = T1
  outbound request.id maybe R3
```

Kalau Anda menyamakan `trace.id` dan `request.id`, Anda kehilangan kemampuan membedakan request attempt di setiap boundary.

### 4.3 Trace ID Bukan Correlation ID

Trace ID sangat kuat untuk flow teknis yang relatif dekat secara waktu. Tetapi business process bisa berlangsung lebih lama dari satu trace:

```text
Submit application
  -> HTTP trace T1
  -> async verification trace T2
  -> officer review trace T3
  -> notification trace T4
```

Semua bisa punya `correlation.id` atau `case.id` yang sama, tetapi trace ID berbeda.

### 4.4 Kapan Trace Baru Dibuat?

Trace baru biasanya dibuat saat:

- tidak ada incoming trace context,
- trust boundary memutus propagation,
- scheduled job dimulai,
- batch execution dimulai,
- message dikonsumsi tanpa valid propagated context,
- async operation memang dipisahkan secara causal tetapi masih bisa di-link.

OpenTelemetry juga mengenal konsep span link untuk menghubungkan trace/span tanpa parent-child relationship langsung. Ini penting untuk messaging, batch fan-out/fan-in, dan retry.

---

## 5. Span ID: Identitas Operation dalam Trace

`span.id` menjawab:

> “Event ini terjadi di operation teknis yang mana?”

Dalam trace:

```text
Trace T1
  Span S1: HTTP POST /applications
    Span S2: validate request
    Span S3: SELECT applicant
    Span S4: POST /external/profile
    Span S5: publish message
```

Log yang memiliki `trace.id=T1` dan `span.id=S4` bisa langsung dikaitkan dengan outbound external API call tertentu.

### 5.1 Span Boundary yang Baik

Span boundary yang baik merepresentasikan operation yang:

- punya awal dan akhir jelas,
- punya durasi bermakna,
- punya outcome,
- punya dependency atau business operation yang ingin dianalisis,
- tidak terlalu halus sampai trace menjadi noisy,
- tidak terlalu kasar sampai kehilangan diagnosis.

Contoh buruk:

```text
Span: methodA
Span: methodB
Span: methodC
```

Contoh lebih baik:

```text
Span: eligibility.evaluate
Span: oracle.application.select
Span: onemap.address.lookup
Span: document.generate.pdf
Span: notification.email.send
```

### 5.2 Log dalam Span

Log structured idealnya menyertakan:

```json
{
  "trace.id": "...",
  "span.id": "...",
  "event.name": "external_call_failed",
  "dependency.name": "onemap",
  "http.status_code": 429,
  "retry.attempt": 2
}
```

Artinya event log bisa ditemukan dari trace, dan trace bisa ditemukan dari log.

---

## 6. Correlation ID: Identitas Percakapan Operasional/Bisnis

`correlation.id` menjawab:

> “Event-event ini bagian dari percakapan atau aksi bisnis yang sama?”

Correlation ID biasanya lebih long-lived daripada request ID dan kadang lebih business-aware daripada trace ID.

Contoh:

```text
User submits renewal application
  correlation.id = CORR-2026-06-18-000123

HTTP submit request
  trace.id = T1
  request.id = R1

Async validation message
  trace.id = T2
  message.id = M1
  correlation.id = CORR-2026-06-18-000123

Officer review
  trace.id = T3
  request.id = R2
  correlation.id = CORR-2026-06-18-000123
```

### 6.1 Correlation ID yang Baik

Correlation ID yang baik:

- tidak mengandung PII,
- stabil sepanjang flow yang ingin dikorelasikan,
- tidak dipakai terlalu global,
- tidak berubah tanpa alasan,
- tidak menggantikan trace ID,
- tidak menggantikan domain ID,
- dibuat di boundary yang konsisten,
- divalidasi saat diterima dari luar.

### 6.2 Siapa yang Membuat Correlation ID?

Ada beberapa opsi:

#### Opsi A — Client membuat

Contoh mobile/web client mengirim:

```text
X-Correlation-ID: abc123
```

Kelebihan:

- correlation bisa dimulai dari client,
- berguna untuk support issue dari frontend.

Risiko:

- client tidak trusted,
- format bisa buruk,
- cardinality/length abuse,
- injection risk,
- bisa collision.

#### Opsi B — Gateway membuat

API gateway/load balancer membuat ID jika tidak ada.

Kelebihan:

- konsisten di edge,
- semua service menerima ID,
- lebih mudah enforce policy.

Risiko:

- kalau gateway tidak meneruskan header, hilang,
- internal jobs tetap butuh strategi sendiri.

#### Opsi C — Service pertama membuat

Application service membuat ID saat request masuk.

Kelebihan:

- mudah diimplementasikan,
- tidak tergantung gateway.

Risiko:

- multi-entrypoint bisa tidak konsisten,
- service internal mungkin membuat ulang ID.

Rekomendasi enterprise:

```text
Accept valid external correlation ID only at trusted edge.
If absent or invalid, generate new correlation ID.
Propagate internally as immutable operational context.
Never trust correlation ID as authentication/authorization evidence.
```

### 6.3 Header Naming

Header umum:

```text
X-Correlation-ID
X-Request-ID
traceparent
tracestate
baggage
```

Untuk sistem baru, jangan membuat custom trace header menggantikan `traceparent`. Gunakan W3C Trace Context untuk tracing, dan custom header untuk correlation/request ID bila memang diperlukan.

---

## 7. Request ID: Identitas Attempt di Boundary Request/Response

`request.id` menjawab:

> “HTTP request attempt yang mana?”

Request ID berguna untuk:

- access log,
- ingress/gateway log,
- API error response,
- support ticket,
- request replay analysis,
- retry attempt differentiation.

### 7.1 Request ID Scope

Request ID idealnya scoped ke satu inbound request.

```text
Client -> Service A
  request.id = R1

Service A -> Service B
  outbound request to B may carry:
    correlation.id = C1
    trace.id = T1
    parent span = S1
    request.id? depends on convention
```

Ada dua pilihan desain:

1. `request.id` hanya inbound edge ID untuk service penerima.
2. `request.id` dipropagasi sebagai original request ID.

Agar tidak ambigu, beberapa organisasi memakai:

```text
request.id           = local inbound request id
origin.request.id    = original edge request id
correlation.id       = business/operational flow id
trace.id             = distributed trace id
```

### 7.2 Request ID di Error Response

Saat API gagal, response bisa menyertakan:

```json
{
  "errorCode": "APPLICATION_SUBMIT_FAILED",
  "message": "Unable to submit application at this time.",
  "requestId": "REQ-20260618-abc123",
  "correlationId": "CORR-20260618-def456"
}
```

Support team kemudian bisa mencari log dengan `request.id` atau `correlation.id`.

### 7.3 Request ID Bukan Security Token

Request ID boleh dikembalikan ke client. Karena itu:

- jangan gunakan session ID sebagai request ID,
- jangan masukkan user ID sensitif,
- jangan pakai sequential predictable ID jika bisa membuka traffic volume,
- jangan jadikan request ID sebagai bukti identitas user.

---

## 8. Transaction ID: Ambiguous Unless Defined

`transaction.id` adalah salah satu field paling sering ambigu.

Ia bisa berarti:

- database transaction ID,
- payment transaction ID,
- business transaction ID,
- distributed transaction ID,
- workflow transaction,
- user action transaction,
- audit transaction.

Karena itu, jangan memakai `transaction.id` tanpa definisi jelas.

Lebih baik gunakan nama spesifik:

```text
payment.transaction.id
oracle.transaction.id
business.transaction.id
workflow.transaction.id
submission.transaction.id
```

Dalam sistem case management/regulatory, sering lebih jelas memakai:

```text
case.id
application.id
appeal.id
inspection.id
enforcement.action.id
workflow.instance.id
state.transition.id
```

Daripada `transaction.id` generik.

---

## 9. Idempotency Key: Identitas Logical Mutation

`idempotency.key` menjawab:

> “Apakah command mutation ini sudah pernah diproses?”

Ini berbeda total dari correlation ID atau trace ID.

### 9.1 Problem yang Diselesaikan

Client mengirim POST:

```text
POST /applications/submit
Idempotency-Key: 8f62c4c0-...
```

Server berhasil memproses, tetapi response timeout di client. Client retry.

Tanpa idempotency key:

```text
Attempt 1: create application -> success, response lost
Attempt 2: create application -> success again
Result: duplicate application
```

Dengan idempotency key:

```text
Attempt 1: process key K -> success, store result
Attempt 2: same key K -> return stored result or duplicate-safe response
Result: one logical mutation
```

### 9.2 Idempotency Key vs Correlation ID

| Aspek | Idempotency Key | Correlation ID |
|---|---|---|
| Tujuan | Duplicate prevention | Observability correlation |
| Dipakai untuk keputusan bisnis? | Ya | Tidak langsung |
| Harus disimpan durable? | Biasanya ya | Tidak selalu |
| Bisa muncul di log? | Ya, hati-hati | Ya |
| Bisa dipakai lintas banyak event? | Untuk satu logical mutation | Untuk conversation/flow |
| Boleh generate ulang saat retry? | Tidak | Tidak, jika masih flow sama |
| Boleh dipakai untuk auth? | Tidak | Tidak |

### 9.3 Idempotency Storage Model

Minimal table:

```sql
CREATE TABLE idempotency_record (
    idempotency_key       VARCHAR2(128) NOT NULL,
    operation_name        VARCHAR2(128) NOT NULL,
    requester_id_hash     VARCHAR2(128),
    request_fingerprint   VARCHAR2(256) NOT NULL,
    status                VARCHAR2(32) NOT NULL,
    response_code         NUMBER,
    response_body_hash    VARCHAR2(256),
    resource_type         VARCHAR2(128),
    resource_id           VARCHAR2(128),
    created_at            TIMESTAMP NOT NULL,
    updated_at            TIMESTAMP NOT NULL,
    expires_at            TIMESTAMP,
    CONSTRAINT pk_idempotency_record PRIMARY KEY (operation_name, idempotency_key)
);
```

Status examples:

```text
IN_PROGRESS
SUCCEEDED
FAILED_RETRYABLE
FAILED_FINAL
EXPIRED
```

### 9.4 Request Fingerprint

Idempotency key alone is not enough.

If same key is reused with different payload, server should detect conflict.

```text
same idempotency.key + same operation + same fingerprint -> safe duplicate
same idempotency.key + same operation + different fingerprint -> conflict
```

Example fingerprint fields:

- operation name,
- authenticated actor/tenant,
- normalized request body hash,
- target resource,
- semantic command type.

### 9.5 Logging Idempotency

Good event sequence:

```json
{
  "event.name": "idempotency_record_lookup",
  "idempotency.key_hash": "sha256:...",
  "operation.name": "application.submit",
  "idempotency.status": "MISS"
}
```

```json
{
  "event.name": "idempotency_record_created",
  "idempotency.key_hash": "sha256:...",
  "operation.name": "application.submit",
  "idempotency.status": "IN_PROGRESS"
}
```

```json
{
  "event.name": "idempotency_record_completed",
  "idempotency.key_hash": "sha256:...",
  "operation.name": "application.submit",
  "idempotency.status": "SUCCEEDED",
  "resource.type": "application",
  "resource.id": "APP-2026-0001"
}
```

Do not log raw idempotency key if it could be treated as sensitive or replay-relevant. Prefer hash in logs.

### 9.6 Java Filter/Interceptor Sketch

```java
public final class IdempotencyContext {
    private final String operationName;
    private final String keyHash;
    private final String fingerprint;

    public IdempotencyContext(String operationName, String keyHash, String fingerprint) {
        this.operationName = operationName;
        this.keyHash = keyHash;
        this.fingerprint = fingerprint;
    }

    public String operationName() {
        return operationName;
    }

    public String keyHash() {
        return keyHash;
    }

    public String fingerprint() {
        return fingerprint;
    }
}
```

```java
public final class IdempotencyHeaders {
    public static final String IDEMPOTENCY_KEY = "Idempotency-Key";

    private IdempotencyHeaders() {
    }

    public static String normalize(String raw) {
        if (raw == null || raw.isBlank()) {
            throw new IllegalArgumentException("Missing Idempotency-Key");
        }
        String value = raw.trim();
        if (value.length() > 128) {
            throw new IllegalArgumentException("Idempotency-Key too long");
        }
        if (!value.matches("[A-Za-z0-9._:-]{8,128}")) {
            throw new IllegalArgumentException("Invalid Idempotency-Key format");
        }
        return value;
    }
}
```

For Java 8 compatibility, replace `isBlank()` with `trim().isEmpty()`.

### 9.7 Idempotency Failure Modes

Common failure modes:

1. Idempotency key not required for unsafe POST.
2. Key stored after side effect, not before.
3. Key table not transactionally consistent with domain write.
4. Same key accepted for different payload.
5. In-progress record never expires.
6. Failed retryable/final status not modeled.
7. Raw key logged everywhere.
8. Correlation ID reused as idempotency key.
9. Idempotency implemented only in memory.
10. Duplicate processing possible across multiple service instances.

---

## 10. Message ID: Identitas Event/Message Individual

`message.id` menjawab:

> “Broker message/event yang mana?”

Message ID penting karena asynchronous systems tidak punya request-response timeline sederhana.

### 10.1 Producer Context

Saat service publish message:

```json
{
  "event.name": "message_published",
  "message.id": "MSG-001",
  "message.type": "ApplicationSubmitted",
  "destination.name": "application.submitted",
  "correlation.id": "CORR-001",
  "trace.id": "T1",
  "case.id": "APP-001"
}
```

### 10.2 Consumer Context

Saat consumer menerima:

```json
{
  "event.name": "message_consumed",
  "message.id": "MSG-001",
  "message.type": "ApplicationSubmitted",
  "destination.name": "application.submitted",
  "consumer.group": "eligibility-worker",
  "delivery.attempt": 1,
  "correlation.id": "CORR-001",
  "trace.id": "T2"
}
```

Trace mungkin sama atau berbeda tergantung propagation dan broker semantics. Tetapi correlation/message/domain ID harus memungkinkan rekonstruksi.

### 10.3 Message ID vs Event ID

Sering perlu membedakan:

```text
event.id     = domain event identity
message.id   = broker transport message identity
```

Contoh:

```text
ApplicationSubmitted event E1
  published to RabbitMQ as message M1
  retried/re-published as message M2
```

Kalau hanya punya `message.id`, Anda bisa kehilangan domain-level duplicate detection. Kalau hanya punya `event.id`, Anda bisa kehilangan transport-level delivery analysis.

### 10.4 Causation ID dalam Event-Driven Architecture

Dalam event-sourced/event-driven system, sering dipakai:

```text
event.id
correlation.id
causation.id
```

Makna:

- `event.id`: ID event ini.
- `correlation.id`: conversation besar yang menaungi event ini.
- `causation.id`: event/command yang menyebabkan event ini.

Contoh:

```text
Command C1: SubmitApplication
  -> Event E1: ApplicationSubmitted
      correlation.id = C1 or CORR-001
      causation.id = C1

Consumer handles E1
  -> Command C2: StartEligibilityCheck
      correlation.id = CORR-001
      causation.id = E1

Command C2
  -> Event E2: EligibilityCheckStarted
      correlation.id = CORR-001
      causation.id = C2
```

Ini membuat causal chain eksplisit, bukan hanya “kebetulan timestamp berdekatan”.

---

## 11. Job Execution ID: Identitas Batch/Scheduler Run

`job.execution.id` menjawab:

> “Eksekusi job yang mana?”

Batch/scheduler observability sering buruk karena tidak ada HTTP request. Tanpa job ID, log terlihat seperti aktivitas random.

### 11.1 Minimal Job Context

```json
{
  "job.name": "audit-retention-housekeeping",
  "job.execution.id": "JOB-20260618-030000-001",
  "job.schedule.id": "daily-0300",
  "job.trigger.type": "SCHEDULED",
  "job.attempt": 1
}
```

### 11.2 Chunk Context

Untuk job besar:

```json
{
  "job.name": "audit-retention-housekeeping",
  "job.execution.id": "JOB-20260618-030000-001",
  "job.chunk.index": 12,
  "job.chunk.size": 5000,
  "job.chunk.start_id": "1000000",
  "job.chunk.end_id": "1004999"
}
```

### 11.3 Duplicate Execution Diagnosis

Masalah umum:

```text
03:00 scheduler starts job on pod A
03:01 pod A slow, liveness restarts
03:02 scheduler starts job on pod B
03:05 pod A resumes/was not killed properly
Result: duplicate processing
```

Dengan `job.execution.id`, `pod.name`, `leader.election.term`, dan `lock.owner`, diagnosis menjadi mungkin.

### 11.4 Job ID vs Trace ID

Setiap job execution bisa punya trace ID root, tetapi long-running batch sering menghasilkan banyak traces atau sampled traces. `job.execution.id` tetap menjadi identity yang lebih stabil untuk keseluruhan execution.

---

## 12. Workflow Instance ID dan Case ID

Dalam sistem enterprise/regulatory/case management, flow bisnis sering lebih penting daripada request teknis.

### 12.1 Case ID

`case.id` menjawab:

> “Domain case/entity mana yang terdampak?”

Contoh:

```json
{
  "case.id": "CASE-2026-000901",
  "case.type": "ENFORCEMENT",
  "case.status.from": "UNDER_REVIEW",
  "case.status.to": "PENDING_APPROVAL"
}
```

### 12.2 Workflow Instance ID

`workflow.instance.id` menjawab:

> “Instance proses/workflow mana?”

Satu case bisa punya beberapa workflow:

```text
Case CASE-001
  Workflow W1: initial assessment
  Workflow W2: appeal
  Workflow W3: enforcement action
  Workflow W4: closure review
```

Jangan menyamakan `case.id` dan `workflow.instance.id`.

### 12.3 State Transition ID

Untuk defensibility, terutama regulatory systems, setiap state transition idealnya punya ID sendiri:

```json
{
  "event.name": "case_state_transition_completed",
  "state.transition.id": "TRN-2026-000011",
  "case.id": "CASE-2026-000901",
  "state.from": "DRAFT",
  "state.to": "SUBMITTED",
  "actor.type": "USER",
  "actor.id_hash": "sha256:...",
  "reason.code": "USER_SUBMISSION"
}
```

Ini membantu membedakan:

- current state,
- transition event,
- workflow instance,
- user action,
- audit evidence.

---

## 13. Tenant ID, User ID, Session ID, Actor ID

Identity fields yang berhubungan dengan manusia/tenant harus dirancang dengan hati-hati.

### 13.1 Tenant ID

`tenant.id` atau `agency.id` penting untuk blast radius analysis:

```text
Apakah error terjadi untuk semua tenant, atau hanya tenant tertentu?
```

Tetapi tenant ID bisa punya cardinality tinggi. Still acceptable jika memang domain critical. Yang harus dihindari adalah label metric high-cardinality tanpa kontrol.

### 13.2 User ID

Untuk logs, sering lebih aman:

```text
user.id_hash
actor.id_hash
```

Daripada raw national ID/email/username.

### 13.3 Actor Model

Dalam enterprise system, actor tidak selalu user manusia.

Gunakan:

```json
{
  "actor.type": "USER",
  "actor.id_hash": "sha256:..."
}
```

atau:

```json
{
  "actor.type": "SYSTEM",
  "actor.id": "scheduler:audit-retention-housekeeping"
}
```

atau:

```json
{
  "actor.type": "SERVICE",
  "actor.id": "interface-connector"
}
```

### 13.4 Session ID

Raw session ID sangat sensitif. Jangan log raw session token/cookie.

Jika perlu correlation:

```text
session.id_hash
```

Dengan secret salt/HMAC jika ingin mencegah brute-force terhadap ID pendek.

---

## 14. W3C Trace Context: `traceparent` dan `tracestate`

Untuk distributed tracing modern, gunakan W3C Trace Context.

### 14.1 `traceparent`

Format:

```text
traceparent: {version}-{trace-id}-{parent-id}-{trace-flags}
```

Contoh:

```text
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
```

Rules penting:

- `trace-id` tidak boleh all zero.
- `parent-id` tidak boleh all zero.
- format hex lowercase lebih umum.
- invalid header harus ditangani dengan aman.
- jangan percaya header sebagai security identity.

### 14.2 `tracestate`

`tracestate` membawa vendor-specific trace information.

Contoh:

```text
tracestate: rojo=00f067aa0ba902b7,congo=t61rcWkgMzE
```

Aplikasi biasanya tidak perlu memanipulasi manual kecuali membuat instrumentation/library.

### 14.3 Jangan Membuat Trace Header Sendiri Tanpa Alasan

Anti-pattern:

```text
X-Trace-Id: ...
X-Span-Id: ...
X-Parent-Span-Id: ...
```

Jika sudah memakai OpenTelemetry, gunakan propagator standar. Custom header boleh untuk `X-Correlation-ID` atau `X-Request-ID`, tetapi trace context sebaiknya mengikuti W3C.

---

## 15. Baggage: Context Key-Value yang Dipropagasikan

Baggage adalah mekanisme untuk membawa key-value context lintas service boundary.

Contoh baggage:

```text
baggage: tenant.id=agency-a,feature.flag=beta-flow
```

### 15.1 Kapan Memakai Baggage

Baggage cocok untuk data kecil yang:

- perlu tersedia di downstream service,
- berguna untuk telemetry enrichment,
- tidak sensitif,
- cardinality-nya dikontrol,
- valid untuk flow tersebut.

Contoh masuk akal:

```text
tenant.tier=enterprise
release.channel=blue
experiment.group=A
```

Contoh berbahaya:

```text
email=user@example.com
national.id=...
authorization=Bearer ...
largePayload=...
```

### 15.2 Baggage Bukan MDC Global Bebas

Baggage dipropagasikan lintas boundary. Jadi semua isinya berpotensi keluar dari service.

Rule:

```text
Only put into baggage what you are comfortable propagating across process and trust boundaries.
```

### 15.3 Baggage vs Correlation ID

`correlation.id` biasanya header/log field sendiri. Baggage bisa membawa correlation ID, tetapi banyak organisasi tetap memisahkannya untuk kontrol, compatibility, dan governance.

---

## 16. Designing the Identity Model

Sebelum implementasi, desain identity model eksplisit.

### 16.1 Pertanyaan Desain

Untuk setiap ID, jawab:

1. Apa nama field canonical-nya?
2. Apa makna tepatnya?
3. Siapa yang membuat?
4. Di boundary mana dibuat?
5. Apakah diterima dari external client?
6. Jika diterima, bagaimana validasinya?
7. Apakah dipropagasikan?
8. Ke media apa saja dipropagasikan?
   - HTTP header,
   - message header,
   - MDC,
   - OTel Context,
   - database/audit,
   - error response.
9. Apakah boleh muncul di log?
10. Apakah raw atau hashed?
11. Apakah boleh menjadi metric label?
12. Berapa retention-nya?
13. Apa failure behavior kalau hilang/invalid?

### 16.2 Recommended Canonical Fields

Untuk Java backend enterprise:

```text
trace.id
span.id
correlation.id
request.id
origin.request.id
idempotency.key_hash
message.id
event.id
causation.id
job.execution.id
workflow.instance.id
state.transition.id
case.id
tenant.id
actor.type
actor.id_hash
service.name
service.instance.id
```

### 16.3 Field Naming Notes

Gunakan nama stabil dan konsisten. Jangan campur:

```text
correlationId
correlation_id
corrId
corr_id
x-correlation-id
```

Dalam Java code, camelCase boleh:

```java
context.correlationId()
```

Dalam JSON logs, pilih satu style. Banyak schema telemetry modern memakai dotted names:

```json
{
  "correlation.id": "...",
  "trace.id": "...",
  "service.name": "application-service"
}
```

---

## 17. Identity Across HTTP Boundary

### 17.1 Inbound HTTP Filter

Responsibility:

1. Extract `traceparent` via OpenTelemetry instrumentation.
2. Extract or generate `correlation.id`.
3. Generate local `request.id`.
4. Extract actor/tenant from security context after authentication.
5. Put safe fields into MDC.
6. Ensure cleanup in `finally`.
7. Return `request.id`/`correlation.id` in response headers if policy allows.

### 17.2 Java Servlet Filter Sketch

```java
public final class CorrelationFilter implements javax.servlet.Filter {
    private static final String CORRELATION_HEADER = "X-Correlation-ID";
    private static final String REQUEST_HEADER = "X-Request-ID";

    @Override
    public void doFilter(
            javax.servlet.ServletRequest servletRequest,
            javax.servlet.ServletResponse servletResponse,
            javax.servlet.FilterChain chain
    ) throws java.io.IOException, javax.servlet.ServletException {

        javax.servlet.http.HttpServletRequest request =
                (javax.servlet.http.HttpServletRequest) servletRequest;
        javax.servlet.http.HttpServletResponse response =
                (javax.servlet.http.HttpServletResponse) servletResponse;

        String correlationId = normalizeOrGenerate(request.getHeader(CORRELATION_HEADER));
        String requestId = generateRequestId();

        org.slf4j.MDC.put("correlation.id", correlationId);
        org.slf4j.MDC.put("request.id", requestId);

        response.setHeader(CORRELATION_HEADER, correlationId);
        response.setHeader(REQUEST_HEADER, requestId);

        try {
            chain.doFilter(request, response);
        } finally {
            org.slf4j.MDC.remove("correlation.id");
            org.slf4j.MDC.remove("request.id");
        }
    }

    private static String normalizeOrGenerate(String raw) {
        if (raw == null || raw.trim().isEmpty()) {
            return generateCorrelationId();
        }
        String value = raw.trim();
        if (value.length() > 128 || !value.matches("[A-Za-z0-9._:-]+")) {
            return generateCorrelationId();
        }
        return value;
    }

    private static String generateCorrelationId() {
        return "corr-" + java.util.UUID.randomUUID();
    }

    private static String generateRequestId() {
        return "req-" + java.util.UUID.randomUUID();
    }
}
```

### 17.3 Spring Boot `OncePerRequestFilter` Sketch

```java
public final class RequestIdentityFilter extends org.springframework.web.filter.OncePerRequestFilter {
    private static final String CORRELATION_HEADER = "X-Correlation-ID";
    private static final String REQUEST_HEADER = "X-Request-ID";

    @Override
    protected void doFilterInternal(
            jakarta.servlet.http.HttpServletRequest request,
            jakarta.servlet.http.HttpServletResponse response,
            jakarta.servlet.FilterChain filterChain
    ) throws jakarta.servlet.ServletException, java.io.IOException {

        String correlationId = IdentityIds.normalizeOrNew(
                request.getHeader(CORRELATION_HEADER),
                IdentityIds::newCorrelationId
        );
        String requestId = IdentityIds.newRequestId();

        org.slf4j.MDC.put("correlation.id", correlationId);
        org.slf4j.MDC.put("request.id", requestId);

        response.setHeader(CORRELATION_HEADER, correlationId);
        response.setHeader(REQUEST_HEADER, requestId);

        try {
            filterChain.doFilter(request, response);
        } finally {
            org.slf4j.MDC.clear();
        }
    }
}
```

Caution: `MDC.clear()` aman jika filter ini owner semua MDC fields. Kalau framework/instrumentation lain juga memakai MDC, prefer remove only keys owned by this filter or restore previous context snapshot.

### 17.4 Outbound HTTP Propagation

Outbound call harus membawa:

```text
traceparent       from OTel propagator
tracestate        from OTel propagator
X-Correlation-ID  from context
X-Request-ID      optional new outbound request id or original request id, based on policy
```

Pseudo-code:

```java
public final class IdentityHeaderInjector {
    public static void inject(java.util.function.BiConsumer<String, String> setter) {
        String correlationId = org.slf4j.MDC.get("correlation.id");
        if (correlationId != null) {
            setter.accept("X-Correlation-ID", correlationId);
        }
    }
}
```

If using OpenTelemetry, do not manually craft `traceparent`; use OTel propagators or auto instrumentation.

---

## 18. Identity Across Messaging Boundary

Messaging is harder than HTTP because consumer may execute later, multiple times, or in parallel.

### 18.1 Producer Headers

Recommended message headers:

```text
traceparent
tracestate
baggage
x-correlation-id
x-causation-id
x-event-id
x-message-type
```

Broker-specific names may differ, but semantic mapping should be stable.

### 18.2 Consumer Extraction

Consumer should:

1. Extract trace context if present.
2. Extract correlation ID.
3. Extract event/message ID.
4. Generate consumer execution ID if needed.
5. Put relevant fields into MDC during processing.
6. Remove/restore context after processing.
7. Log ack/nack/retry/DLQ decisions.

### 18.3 Messaging Log Events

Producer:

```json
{
  "event.name": "message_publish_attempt",
  "messaging.system": "rabbitmq",
  "messaging.destination.name": "application.submitted",
  "message.type": "ApplicationSubmitted",
  "event.id": "EVT-001",
  "correlation.id": "CORR-001"
}
```

Consumer success:

```json
{
  "event.name": "message_processing_completed",
  "messaging.system": "rabbitmq",
  "messaging.destination.name": "application.submitted",
  "message.id": "MSG-001",
  "event.id": "EVT-001",
  "delivery.attempt": 1,
  "processing.duration_ms": 235,
  "outcome": "SUCCESS"
}
```

Consumer failure:

```json
{
  "event.name": "message_processing_failed",
  "message.id": "MSG-001",
  "event.id": "EVT-001",
  "delivery.attempt": 3,
  "error.type": "ExternalDependencyTimeoutException",
  "retry.decision": "DLQ",
  "outcome": "FAILURE"
}
```

---

## 19. Identity Across Batch and Scheduler Boundary

Batch/scheduler entrypoint should create a root identity.

```java
public final class JobIdentity implements AutoCloseable {
    private final java.util.Map<String, String> previous;

    private JobIdentity(String jobName, String executionId) {
        this.previous = org.slf4j.MDC.getCopyOfContextMap();
        org.slf4j.MDC.put("job.name", jobName);
        org.slf4j.MDC.put("job.execution.id", executionId);
    }

    public static JobIdentity start(String jobName) {
        String executionId = "job-" + java.time.Instant.now().toString() + "-" + java.util.UUID.randomUUID();
        return new JobIdentity(jobName, executionId);
    }

    @Override
    public void close() {
        org.slf4j.MDC.clear();
        if (previous != null) {
            org.slf4j.MDC.setContextMap(previous);
        }
    }
}
```

Usage:

```java
try (JobIdentity ignored = JobIdentity.start("audit-retention-housekeeping")) {
    log.info("job_started");
    runJob();
    log.info("job_completed");
}
```

In Java 8, this pattern works because `AutoCloseable` and try-with-resources exist.

---

## 20. Identity and MDC: What Goes into MDC?

MDC should contain fields that apply broadly to logs within current execution context.

Good MDC fields:

```text
trace.id
span.id
correlation.id
request.id
job.execution.id
message.id
case.id
tenant.id
actor.type
actor.id_hash
```

But avoid putting too much in MDC.

Bad MDC fields:

```text
full request body
full response body
SQL query with literals
access token
password
large object
per-loop item id for huge loop without cleanup
```

### 20.1 MDC Is Ambient State

Ambient state is convenient but dangerous.

Rule:

```text
MDC is a projection of authoritative context, not the authoritative context itself.
```

Better architecture:

```text
RequestContext object / OTel Context / ScopedValue
  -> selected fields projected into MDC
  -> logs include MDC
```

---

## 21. Identity and OpenTelemetry Context

OpenTelemetry context is designed for propagation of trace context and related values. For Java systems using OTel agent/SDK:

- let OTel manage `trace.id` and `span.id`,
- inject trace identifiers into logs via logging integration/layout/MDC enrichment,
- use baggage carefully for selected cross-service context,
- do not manually generate trace IDs unless writing instrumentation.

### 21.1 Logs with Trace Context

Structured log should include:

```json
{
  "timestamp": "2026-06-18T02:30:00.000Z",
  "severity": "ERROR",
  "service.name": "application-service",
  "trace.id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "span.id": "00f067aa0ba902b7",
  "correlation.id": "CORR-001",
  "request.id": "REQ-001",
  "event.name": "external_dependency_failed"
}
```

### 21.2 When Trace Context Is Missing

Possible causes:

1. No OTel agent/SDK installed.
2. Unsupported framework/library.
3. Async boundary lost context.
4. Custom thread/executor not instrumented.
5. Message headers not propagated.
6. `traceparent` stripped by gateway.
7. Sampling makes trace absent in backend, but trace ID may still appear in logs.
8. Logs emitted before span started or after span ended.

---

## 22. Causality: Beyond Correlation

Correlation says:

> “These events are related.”

Causality says:

> “This event caused that event.”

Correlation is weaker than causality.

Example:

```text
10:00:00 Service A logs error
10:00:01 Service B logs error
```

This does not prove A caused B.

Causality requires stronger evidence:

- parent span relationship,
- causation ID,
- message header,
- command/event relationship,
- database record lineage,
- workflow transition linkage,
- explicit dependency call.

### 22.1 Causal Graph Example

```text
HTTP request R1
  trace T1
  command C1 SubmitApplication
    -> domain event E1 ApplicationSubmitted
      -> message M1
        -> consumer execution CE1
          -> command C2 StartScreening
            -> external call X1
            -> event E2 ScreeningCompleted
```

Each edge should be supported by evidence.

```text
R1 caused C1
C1 caused E1
E1 transported as M1
M1 caused CE1
CE1 caused C2
C2 caused X1 and E2
```

### 22.2 Fields for Causality

Recommended:

```text
event.id
causation.id
correlation.id
command.id
message.id
parent.message.id
workflow.instance.id
state.transition.id
```

Not every system needs all fields. But if asynchronous causal chains matter, `causation.id` becomes powerful.

---

## 23. ID Lifecycle Patterns

### 23.1 Synchronous HTTP Flow

```text
Client request arrives
  if traceparent exists: continue trace
  else: create new trace
  if X-Correlation-ID valid: accept
  else: create correlation ID
  create request ID
  process
  propagate trace/correlation outbound
  return request/correlation ID
```

### 23.2 Async Message Flow

```text
Service handles request
  publish event with:
    trace context
    correlation ID
    event ID
    causation ID

Consumer receives message
  continue/extract context or create linked trace
  use same correlation ID
  log message ID and delivery attempt
  create new downstream events with causation ID
```

### 23.3 Batch Flow

```text
Scheduler starts job
  create job.execution.id
  create root trace if tracing enabled
  for each chunk:
    create chunk identity
    log progress and outcome
  for each produced message:
    include job.execution.id and correlation/event identity if relevant
```

### 23.4 Workflow Flow

```text
User action
  request.id R1
  correlation.id C1
  workflow.instance.id W1
  state.transition.id ST1
  event.id E1

Async task
  new trace T2
  same correlation.id C1
  same workflow.instance.id W1
  causation.id E1
```

---

## 24. Trust Boundaries and Validation

Incoming IDs are untrusted unless generated inside your trusted infrastructure.

### 24.1 Validation Rules

For external incoming headers:

- max length,
- allowed characters,
- reject/control CR/LF,
- trim whitespace,
- normalize case if needed,
- do not accept huge header,
- do not accept JSON/XML as ID,
- optionally replace invalid ID rather than failing request,
- log invalid header as security/diagnostic event without echoing raw dangerous value.

Example:

```java
public final class SafeHeaderId {
    private static final int MAX_LEN = 128;
    private static final java.util.regex.Pattern SAFE =
            java.util.regex.Pattern.compile("[A-Za-z0-9._:-]{1,128}");

    public static java.util.Optional<String> normalize(String raw) {
        if (raw == null) {
            return java.util.Optional.empty();
        }
        String value = raw.trim();
        if (value.isEmpty() || value.length() > MAX_LEN) {
            return java.util.Optional.empty();
        }
        if (!SAFE.matcher(value).matches()) {
            return java.util.Optional.empty();
        }
        return java.util.Optional.of(value);
    }
}
```

For Java 8, avoid `Optional.isEmpty()` and use `!optional.isPresent()`.

### 24.2 Do Not Trust ID for Authorization

Never implement:

```text
if request has correlation.id for case X, allow access to case X
```

IDs in headers/logs are observability context, not security proof.

---

## 25. Cardinality and Cost

IDs are high-cardinality by nature.

### 25.1 Logs

High-cardinality fields in logs are usually okay because logs are event documents. Cost concern is storage/query, not time-series explosion.

### 25.2 Metrics

Do not add high-cardinality IDs as metric labels:

Bad:

```text
http.server.duration{request_id="REQ-001"}
```

Bad:

```text
db.query.duration{user_id="123456"}
```

Usually okay:

```text
http.server.duration{route="/applications/{id}", method="POST", status_code="500"}
```

### 25.3 Traces

Trace/span attributes can have high-cardinality values, but too much cardinality can hurt backend indexing and cost. Use intentionally.

### 25.4 Baggage

Baggage propagates. Keep it small and governed.

---

## 26. ID Generation Strategy

### 26.1 UUID

Good default:

```java
String id = UUID.randomUUID().toString();
```

Pros:

- easy,
- Java 8+,
- low collision risk,
- no central coordination.

Cons:

- not time sortable,
- verbose,
- not friendly for support.

### 26.2 ULID/UUIDv7-style IDs

Time-sortable IDs are useful for logs and DB indexes, but Java standard library may not provide them directly depending on version. Use vetted library if needed.

### 26.3 Prefixes

Prefixes improve readability:

```text
req-...
corr-...
job-...
evt-...
cmd-...
```

But do not encode sensitive business meaning in public-facing ID if not needed.

### 26.4 Sequential IDs

Sequential IDs are easy to read but can leak volume and enable enumeration. Use only where appropriate and protected.

---

## 27. Error Response Identity Contract

A production API should return enough identity for support without leaking internals.

Example:

```json
{
  "error": {
    "code": "APPLICATION_SUBMISSION_FAILED",
    "message": "Unable to submit the application at this time.",
    "requestId": "req-018f...",
    "correlationId": "corr-018f..."
  }
}
```

Do not return:

```json
{
  "traceId": "...",
  "spanId": "...",
  "stackTrace": "...",
  "sql": "..."
}
```

Trace ID may be safe in many internal systems, but exposing it externally should be a deliberate policy decision.

---

## 28. Logging Patterns for Identity

### 28.1 Request Start/End

```java
log.info("request_started method={} path={} request.id={} correlation.id={}",
        method, path, requestId, correlationId);
```

With SLF4J 2.x fluent API:

```java
log.atInfo()
        .setMessage("request_started")
        .addKeyValue("http.request.method", method)
        .addKeyValue("url.path", path)
        .addKeyValue("request.id", requestId)
        .addKeyValue("correlation.id", correlationId)
        .log();
```

### 28.2 State Transition

```java
log.atInfo()
        .setMessage("case_state_transition_completed")
        .addKeyValue("case.id", caseId)
        .addKeyValue("state.from", from)
        .addKeyValue("state.to", to)
        .addKeyValue("state.transition.id", transitionId)
        .addKeyValue("actor.type", actorType)
        .log();
```

### 28.3 Dependency Call

```java
log.atWarn()
        .setMessage("external_dependency_retry_scheduled")
        .addKeyValue("dependency.name", "onemap")
        .addKeyValue("http.status_code", 429)
        .addKeyValue("retry.attempt", attempt)
        .addKeyValue("retry.delay_ms", delayMs)
        .addKeyValue("correlation.id", correlationId)
        .log();
```

### 28.4 Idempotency Conflict

```java
log.atWarn()
        .setMessage("idempotency_key_reused_with_different_fingerprint")
        .addKeyValue("operation.name", operationName)
        .addKeyValue("idempotency.key_hash", keyHash)
        .addKeyValue("request.fingerprint_hash", fingerprintHash)
        .addKeyValue("outcome", "CONFLICT")
        .log();
```

---

## 29. Troubleshooting with Identity: Practical Queries

### 29.1 User Reports Error with Request ID

Given:

```text
request.id = req-123
```

Find:

```text
request.id:req-123
```

Then pivot to:

```text
correlation.id
trace.id
case.id
actor.id_hash
tenant.id
```

### 29.2 Find All Events for Business Flow

```text
correlation.id:corr-456
```

Sort by timestamp. Group by:

```text
service.name
event.name
trace.id
message.id
job.execution.id
```

### 29.3 Find Async Continuation

From request logs find:

```text
event.id=EVT-001
message.id=MSG-001
```

Then query consumer:

```text
message.id:MSG-001 OR causation.id:EVT-001
```

### 29.4 Find Duplicate Mutation

```text
idempotency.key_hash:sha256-abc AND operation.name:application.submit
```

Look for:

```text
idempotency.status
request.fingerprint_hash
resource.id
outcome
```

### 29.5 Find Tenant-Specific Incident

```text
tenant.id:agency-a AND severity:ERROR AND timestamp:[...]
```

Then compare with all tenants:

```text
event.name:external_dependency_failed GROUP BY tenant.id
```

---

## 30. Common Anti-Patterns

### 30.1 One ID to Rule Them All

Bad:

```text
Use traceId as requestId, correlationId, idempotencyKey, transactionId.
```

Why bad:

- different lifecycle,
- different trust model,
- different semantics,
- impossible to reason about retries/async/processes.

### 30.2 Generate New Correlation ID Everywhere

Bad:

```text
Every service creates its own correlation ID.
```

Result:

- cross-service flow cannot be reconstructed.

### 30.3 Never Generate Local Request ID

Bad:

```text
Only correlation ID exists.
```

Result:

- cannot distinguish retry attempts or multiple inbound requests in same flow.

### 30.4 Put Raw Token/User Data in ID Fields

Bad:

```text
correlation.id = user email
request.id = session cookie
```

Result:

- privacy/security incident.

### 30.5 Store Idempotency Only in Memory

Bad in distributed systems:

```text
Concurrent retry hits another instance and bypasses memory map.
```

### 30.6 Use Timestamp Proximity as Causality

Bad:

```text
Service B failed one second after Service A, therefore A caused B.
```

Need evidence:

- trace parent,
- message ID,
- causation ID,
- dependency call,
- workflow linkage.

### 30.7 Metric Labels with Request ID

Bad:

```text
request.id as Prometheus label
```

Result:

- cardinality explosion.

### 30.8 MDC Leak

Bad:

```text
Thread pool thread keeps previous request's correlation ID.
```

Result:

- logs falsely attribute events to wrong user/request.

---

## 31. Java 8 to Java 25 Considerations

### 31.1 Java 8

Available:

- servlet filters,
- `ThreadLocal`,
- MDC,
- `ExecutorService`,
- `CompletableFuture`,
- UUID,
- OpenTelemetry Java agent support.

Challenges:

- no virtual threads,
- no scoped values,
- older framework versions,
- more manual context propagation.

### 31.2 Java 11/17

Common enterprise baselines:

- better TLS/runtime,
- widely supported by frameworks,
- stable OTel/Spring ecosystem.

### 31.3 Java 21

Virtual threads change concurrency model.

Impact:

- per-request virtual thread reduces thread-pool MDC leak risk for synchronous code,
- but async boundaries still exist,
- ThreadLocal overuse can become costly at massive scale,
- context design still matters.

### 31.4 Java 25

Scoped Values are finalized in JDK 25. They are useful for immutable context shared within a dynamic scope, especially with virtual threads and structured concurrency.

Potential future identity model:

```java
static final ScopedValue<RequestContext> REQUEST_CONTEXT = ScopedValue.newInstance();

ScopedValue.where(REQUEST_CONTEXT, context).run(() -> {
    service.handle();
});
```

MDC can be populated from scoped context at logging boundary, while authoritative context remains immutable.

---

## 32. Reference Architecture: Runtime Identity Flow

```text
Inbound HTTP
  ├─ W3C traceparent extracted by OTel
  ├─ correlation.id extracted/generated
  ├─ request.id generated
  ├─ security context resolved
  ├─ tenant/actor projected
  └─ selected context placed into MDC/logs

Application command
  ├─ command.id generated
  ├─ idempotency.key validated for unsafe mutation
  ├─ case/workflow IDs resolved
  └─ state transition/audit event emitted

Outbound HTTP
  ├─ OTel injects traceparent/tracestate
  ├─ correlation.id propagated
  └─ dependency logs include span/correlation/request

Message publish
  ├─ event.id generated
  ├─ causation.id set
  ├─ correlation.id propagated
  ├─ trace context injected if supported
  └─ message.id recorded

Message consume
  ├─ context extracted
  ├─ consumer execution context created
  ├─ processing logs include message/event/correlation
  └─ ack/nack/retry/DLQ event logged

Batch/Scheduler
  ├─ job.execution.id generated
  ├─ root trace started if applicable
  ├─ chunk identity logged
  └─ downstream events carry job/correlation where relevant
```

---

## 33. Production Identity Contract Template

Use this as a starting team standard.

```text
1. Every inbound HTTP request must have:
   - request.id
   - correlation.id
   - trace.id/span.id when tracing is enabled

2. Every structured application log should include, when available:
   - service.name
   - service.instance.id
   - environment
   - trace.id
   - span.id
   - correlation.id
   - request.id or job.execution.id or message.id
   - tenant.id
   - actor.type
   - actor.id_hash

3. Every unsafe mutation endpoint should support idempotency when retry/duplicate risk exists.

4. Idempotency key must not be replaced by correlation ID or trace ID.

5. Every published domain event should have:
   - event.id
   - event.type
   - correlation.id
   - causation.id where applicable
   - domain entity ID where applicable

6. Every consumed message should log:
   - message.id
   - event.id if present
   - message.type
   - delivery.attempt
   - consumer identity
   - ack/nack/retry/DLQ decision

7. Every scheduler/batch execution should have:
   - job.name
   - job.execution.id
   - trigger type
   - attempt number

8. Raw secrets, tokens, cookies, and sensitive session IDs must never be logged.

9. High-cardinality IDs must not be used as metric labels unless explicitly approved.

10. Incoming external IDs must be validated and sanitized.
```

---

## 34. Practical Lab 1 — Build an Identity Filter

Goal:

- create `correlation.id`,
- create `request.id`,
- add to MDC,
- return response headers,
- cleanup safely.

Acceptance criteria:

1. Request without `X-Correlation-ID` gets generated ID.
2. Request with valid `X-Correlation-ID` preserves it.
3. Request with invalid ID gets replacement ID.
4. Logs contain `correlation.id` and `request.id`.
5. Second request on same worker thread does not inherit previous ID.
6. Error response contains safe request/correlation identity.

---

## 35. Practical Lab 2 — Propagate Identity to Outbound HTTP

Goal:

- propagate `X-Correlation-ID`,
- let OTel handle `traceparent`,
- log dependency call attempt/success/failure.

Acceptance criteria:

1. Downstream receives same `correlation.id`.
2. Trace graph shows client/server span relation.
3. Logs in both services can be queried by same `correlation.id`.
4. Retry attempts are distinguishable.
5. Timeout logs include dependency and request context.

---

## 36. Practical Lab 3 — Idempotency Key for POST

Goal:

- implement durable idempotency for unsafe mutation.

Acceptance criteria:

1. First request with key creates record and resource.
2. Retry with same key and same payload returns same result.
3. Retry with same key and different payload returns conflict.
4. Concurrent duplicate requests do not create duplicate resources.
5. Logs include `idempotency.key_hash`, not raw key.
6. Failure states are modeled.

---

## 37. Practical Lab 4 — Async Message Causality

Goal:

- publish event with `event.id`, `correlation.id`, and `causation.id`,
- consume message and preserve correlation,
- produce downstream event.

Acceptance criteria:

1. Producer logs event publish with `event.id`.
2. Consumer logs processing with same `event.id` and `correlation.id`.
3. Downstream event has `causation.id` pointing to previous event/command.
4. DLQ log includes causal identity.
5. Timeline can be reconstructed without guessing from timestamps.

---

## 38. Code Review Checklist

Use this checklist during PR review.

### HTTP Identity

- [ ] Inbound request creates/validates correlation ID.
- [ ] Inbound request creates local request ID.
- [ ] IDs are added to MDC and cleaned/restored.
- [ ] Response includes support-safe request/correlation ID.
- [ ] Outbound HTTP propagates correlation ID.
- [ ] Trace context is handled by OTel/standard propagator.

### Logging Identity

- [ ] Structured logs include trace/span IDs when available.
- [ ] Logs include either request, message, or job execution context.
- [ ] Business logs include domain IDs where safe.
- [ ] Actor/user/session values are hashed or redacted when needed.
- [ ] No secrets/tokens/cookies in logs.

### Idempotency

- [ ] Unsafe retryable mutation has idempotency strategy.
- [ ] Idempotency key is not confused with correlation ID.
- [ ] Duplicate payload and conflicting payload are handled differently.
- [ ] Idempotency record is durable and concurrency-safe.

### Messaging

- [ ] Message publish logs event/message identity.
- [ ] Message headers carry correlation and trace context.
- [ ] Consumer restores context and cleans it.
- [ ] Retry/DLQ decision is logged.
- [ ] Causation ID exists where causal chain matters.

### Metrics

- [ ] High-cardinality IDs are not metric labels.
- [ ] Route/template used instead of raw URL with IDs.
- [ ] Tenant label usage is explicitly approved.

---

## 39. Incident Drill: Broken Causality

Scenario:

```text
A user reports duplicate application submission.
Support has request.id = req-001.
Logs show two application records created within 3 seconds.
```

Naive conclusion:

```text
Frontend double-click bug.
```

Better investigation:

1. Query `request.id=req-001`.
2. Extract `correlation.id`.
3. Query all logs for correlation ID.
4. Check idempotency logs.
5. Check whether retry used same idempotency key.
6. Check gateway timeout/access log.
7. Check if second request had different request ID but same correlation ID.
8. Check DB unique constraints.
9. Check async message duplicate processing.
10. Check if state transition repeated.

Possible findings:

```text
Attempt 1:
  request.id=req-001
  idempotency.key_hash=K1
  DB insert succeeded
  response timeout at gateway

Attempt 2:
  request.id=req-002
  idempotency.key_hash missing
  DB insert succeeded again
```

Root cause:

```text
Client retry did not preserve Idempotency-Key, and server did not enforce idempotency for unsafe POST.
```

Permanent fix:

- require idempotency key for submit endpoint,
- persist idempotency record before side effect,
- return same result for duplicate retry,
- add unique domain constraint where possible,
- add log event for missing idempotency key,
- add metric for idempotency conflict/miss/hit.

---

## 40. Summary

Bagian ini membahas bahwa runtime identity bukan aksesori logging. Ia adalah fondasi untuk causality, troubleshooting, support, auditability, and operational defensibility.

Key takeaways:

1. `trace.id` mengikat distributed technical flow.
2. `span.id` mengikat operation tertentu dalam trace.
3. `correlation.id` mengikat business/operational conversation.
4. `request.id` mengikat satu inbound request attempt.
5. `idempotency.key` mengikat duplicate-safe logical mutation.
6. `message.id` mengikat transport message.
7. `event.id` dan `causation.id` mengikat causal event chain.
8. `job.execution.id` mengikat batch/scheduler run.
9. `case.id` dan `workflow.instance.id` mengikat domain/process context.
10. Semua ID harus punya lifecycle, owner, trust model, propagation rule, and logging policy.

Top-tier Java engineer tidak hanya bertanya:

```text
Apakah log punya correlation ID?
```

Mereka bertanya:

```text
Apakah setiap runtime event punya identitas yang benar untuk membuktikan hubungan kausalnya dengan event lain?
```

---

## 41. Apa Berikutnya

Bagian berikutnya:

```text
Part 12 — OpenTelemetry Mental Model: Signals, Resource, Scope, Context
```

Kita akan masuk ke OpenTelemetry secara sistematis:

- traces,
- metrics,
- logs,
- resources,
- instrumentation scope,
- attributes,
- semantic conventions,
- context propagation,
- OTLP,
- collector,
- SDK vs API,
- auto vs manual instrumentation.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./10-context-propagation-mdc-threadlocal-virtual-threads-scoped-values.md">⬅️ Part 10 — Context Propagation: MDC, ThreadLocal, Virtual Threads, Scoped Values</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./12-opentelemetry-mental-model-signals-resource-scope-context.md">Part 12 — OpenTelemetry Mental Model: Signals, Resource, Scope, Context ➡️</a>
</div>
