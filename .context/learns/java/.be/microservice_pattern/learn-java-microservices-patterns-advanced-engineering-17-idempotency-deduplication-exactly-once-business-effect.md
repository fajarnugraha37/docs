# Learn Java Microservices Patterns Advanced Engineering
## Part 17 — Idempotency, Deduplication, and Exactly-Once Business Effect

> **Filename:** `learn-java-microservices-patterns-advanced-engineering-17-idempotency-deduplication-exactly-once-business-effect.md`  
> **Series:** `learn-java-microservices-patterns-advanced-engineering`  
> **Part:** 17 of 35  
> **Java Range:** Java 8 sampai Java 25  
> **Level:** Advanced / Principal Engineer Track

---

## 0. Tujuan Part Ini

Pada part sebelumnya kita sudah membahas:

- synchronous API communication,
- asynchronous messaging,
- event-driven architecture,
- saga dan compensation,
- transactional outbox/inbox,
- consistency dan distributed invariant,
- data ownership,
- query patterns,
- gateway/BFF,
- service discovery/configuration,
- resilience,
- backpressure dan capacity-aware design.

Part ini masuk ke salah satu kemampuan paling penting dalam microservices production-grade:

> Bagaimana memastikan operasi bisnis tidak terjadi dua kali walaupun request, message, event, timeout, retry, failover, dan recovery bisa terjadi berkali-kali.

Topik ini sering disederhanakan menjadi:

> “Tambahkan idempotency key.”

Itu terlalu dangkal.

Dalam sistem nyata, idempotency harus dipahami sebagai gabungan dari:

1. **intent identity** — operasi bisnis mana yang dianggap sama?
2. **deduplication boundary** — di mana duplicate dikenali?
3. **effect boundary** — efek apa yang tidak boleh terjadi dua kali?
4. **state transition rule** — apakah transisi boleh diulang?
5. **response replay** — apa yang dikembalikan saat request diulang?
6. **deduplication window** — berapa lama operasi dianggap duplikat?
7. **concurrency control** — bagaimana jika request sama datang paralel?
8. **failure recovery** — bagaimana jika sistem crash di tengah proses?
9. **audit defensibility** — bagaimana membuktikan bahwa operasi tidak diproses ganda?

Materi ini bertujuan membuat kamu mampu mendesain sistem Java microservices yang aman terhadap retry, duplicate delivery, double-submit, double-click, message redelivery, producer crash, consumer crash, and “unknown outcome” failure.

---

## 1. Problem Dasar: Sistem Terdistribusi Menghasilkan Duplicate

Dalam local program sederhana, kamu sering membayangkan satu method call terjadi satu kali:

```java
service.approve(applicationId);
```

Tetapi dalam microservices, operasi yang terlihat satu kali dari perspektif user bisa menjadi banyak percobaan di bawah permukaan:

```text
User clicks Approve
  -> browser sends POST /applications/123/approve
  -> gateway forwards request
  -> application service writes DB
  -> service publishes event
  -> notification service sends email
  -> audit service records audit
```

Duplicate bisa muncul dari banyak tempat:

1. User double-click.
2. Browser retry karena network timeout.
3. Mobile client retry karena koneksi putus.
4. API gateway retry.
5. Service mesh retry.
6. HTTP client retry.
7. Message broker redelivery.
8. Consumer crash after DB commit but before ack.
9. Producer crash after publish but before recording success.
10. Scheduler retry.
11. Batch job restart.
12. CDC relay publishes same outbox row twice.
13. Manual replay.
14. Disaster recovery failover.
15. Operator reruns a script.

Kesalahan engineer pemula adalah berpikir:

> “Duplicate adalah bug di infrastructure.”

Engineer senior berpikir:

> “Duplicate adalah kondisi normal dalam distributed system.”

Engineer top-tier berpikir lebih tajam:

> “Duplicate harus diperlakukan sebagai input domain yang valid. Setiap side effect penting harus punya semantic identity, dedup boundary, concurrency rule, and audit evidence.”

---

## 2. Idempotency: Definisi yang Benar

Secara umum, suatu operasi disebut idempotent jika menjalankannya berkali-kali menghasilkan efek akhir yang sama seperti menjalankannya satu kali.

Contoh sederhana:

```text
setStatus(applicationId, APPROVED)
```

Jika status sudah `APPROVED`, memanggil lagi operasi itu tidak mengubah hasil akhir.

Tetapi ini tidak otomatis berarti aman.

Misalnya:

```text
approve(applicationId)
```

Walaupun status akhirnya tetap `APPROVED`, operasi ini bisa memiliki side effect:

- kirim email approval,
- generate certificate,
- publish event,
- create audit row,
- trigger billing,
- notify external agency,
- start timer SLA,
- update reporting projection.

Jika side effect terjadi dua kali, maka operasi bisnis tidak benar-benar idempotent.

Jadi definisi production-grade-nya adalah:

> Operasi idempotent adalah operasi yang dapat dipanggil ulang dengan intent yang sama tanpa menghasilkan business effect tambahan yang tidak diinginkan.

Kata kuncinya: **business effect**, bukan hanya database row.

---

## 3. Delivery, Processing, and Business Effect

Dalam distributed systems, “exactly once” sering membingungkan karena orang mencampur tiga level berbeda.

| Level | Pertanyaan | Contoh |
|---|---|---|
| Delivery | Apakah message sampai satu kali? | Broker mengirim event ke consumer |
| Processing | Apakah handler menjalankan logic satu kali? | Consumer method dieksekusi |
| Business effect | Apakah efek bisnis terjadi satu kali? | Certificate dibuat satu kali |

Yang paling penting dalam enterprise system biasanya bukan exactly-once delivery, tetapi:

> **Exactly-once business effect.**

Contoh:

Message `ApplicationApproved` boleh dikirim dua kali.

Consumer `CertificateService` boleh menerima dua kali.

Handler bahkan boleh mulai dua kali.

Tetapi certificate untuk approval decision yang sama tidak boleh dibuat dua kali.

Maka target kita bukan:

```text
No duplicate message ever exists.
```

Target realistisnya:

```text
Duplicate message tidak menghasilkan duplicate business effect.
```

---

## 4. Why Exactly-Once Delivery Is Often the Wrong Goal

Banyak platform streaming atau broker menyediakan guarantee tertentu. Namun guarantee tersebut selalu punya boundary.

Misalnya, broker bisa menjamin bahwa producer transaction dan offset commit berada dalam satu mekanisme tertentu. Tetapi begitu handler memanggil database eksternal, email server, payment gateway, object storage, atau sistem legacy, guarantee broker tidak otomatis meluas ke semua side effect tersebut.

Karena itu, dalam microservices, prinsip aman adalah:

```text
Assume duplicate delivery.
Assume duplicate processing attempt.
Prevent duplicate business effect.
```

Ini mengarah pada desain:

- idempotent API,
- idempotent command handler,
- idempotent event consumer,
- inbox table,
- unique constraint,
- optimistic locking,
- deterministic state transition,
- business key uniqueness,
- response replay,
- compensation safety,
- audit correlation.

---

## 5. Natural Idempotency vs Artificial Idempotency

Ada dua kategori utama idempotency.

### 5.1 Natural Idempotency

Operasi secara alami idempotent jika efeknya sudah bersifat “set to value”.

Contoh:

```text
PUT /applications/123/status
body: { "status": "APPROVED" }
```

Jika dipanggil berkali-kali, status akhirnya tetap `APPROVED`.

Contoh lain:

```sql
UPDATE application
SET status = 'APPROVED'
WHERE id = ? AND status = 'PENDING_REVIEW';
```

Jika status sudah `APPROVED`, update kedua tidak mengubah apa pun.

Tetapi natural idempotency ini hanya aman jika side effect juga dikontrol.

### 5.2 Artificial Idempotency

Artificial idempotency memakai identifier eksternal untuk mengenali intent yang sama.

Contoh:

```http
POST /applications/123/approve
Idempotency-Key: approve-123-reviewer-456-decision-789
```

Server menyimpan key tersebut. Jika request yang sama datang lagi, server tidak menjalankan efek baru, tetapi mengembalikan hasil sebelumnya.

Artificial idempotency dibutuhkan untuk operasi yang secara HTTP atau domain adalah command:

- submit application,
- approve case,
- create payment,
- issue certificate,
- send notification,
- start workflow,
- schedule hearing,
- assign officer,
- generate invoice.

---

## 6. Request ID, Correlation ID, Message ID, Business ID, Idempotency Key

Banyak sistem kacau karena semua ID diperlakukan sama.

Mereka tidak sama.

| ID | Fungsi | Apakah cocok untuk idempotency? |
|---|---|---|
| Request ID | Identitas satu HTTP request attempt | Biasanya tidak |
| Correlation ID | Menghubungkan beberapa operasi dalam satu flow | Tidak cukup |
| Trace ID | Observability distributed tracing | Tidak |
| Message ID | Identitas satu message envelope | Kadang, untuk dedup delivery |
| Event ID | Identitas satu event fact | Bisa untuk event consumer dedup |
| Command ID | Identitas satu command intent | Sangat cocok |
| Business ID | Identitas entity/domain concept | Kadang cocok |
| Idempotency Key | Identitas retryable business intent | Ya |

### Kesalahan Umum

Menggunakan `requestId` sebagai idempotency key.

Masalahnya:

- retry bisa membuat request baru dengan request ID baru,
- gateway bisa generate request ID berbeda,
- client bisa tidak menyimpan request ID awal,
- observability ID tidak selalu stabil untuk intent bisnis.

### Prinsip

Gunakan idempotency key yang stabil terhadap retry.

Contoh:

```text
submit-application:<draftId>:<applicantId>:<clientGeneratedSubmitId>
approve-application:<applicationId>:<decisionId>
issue-certificate:<applicationId>:<approvalDecisionId>
send-email:<templateId>:<recipientId>:<businessEventId>
```

---

## 7. Intent Identity: Operasi Mana yang Dianggap Sama?

Idempotency bukan hanya soal “key unik”. Pertanyaan utamanya:

> Dua request ini merepresentasikan intent yang sama atau intent berbeda?

Contoh:

```text
POST /applications/123/approve
Idempotency-Key: abc
body: { "decision": "APPROVE", "remarks": "OK" }
```

Lalu request kedua:

```text
POST /applications/123/approve
Idempotency-Key: abc
body: { "decision": "REJECT", "remarks": "Not OK" }
```

Ini bukan retry yang sama. Ini konflik.

Server harus mendeteksi:

- same key + same normalized payload = duplicate retry,
- same key + different payload = idempotency conflict,
- different key + same business target = mungkin duplicate business intent,
- different key + different payload = operasi baru.

Maka record idempotency sebaiknya menyimpan:

```text
idempotency_key
operation_name
actor_id
tenant_id
business_scope
request_hash
status
response_code
response_body_hash / response_payload
created_at
expires_at
completed_at
```

---

## 8. Idempotency Record State Machine

Idempotency key tidak cukup disimpan sebagai boolean `processed=true`.

Dalam sistem production, request bisa crash di tengah proses. Maka idempotency record harus punya state.

Contoh state:

```text
RECEIVED
PROCESSING
COMPLETED
FAILED_RETRYABLE
FAILED_FINAL
EXPIRED
CONFLICTED
```

Flow sederhana:

```text
new request with key
  -> insert idempotency record as PROCESSING
  -> execute operation
  -> store response/result
  -> mark COMPLETED

duplicate request while PROCESSING
  -> return 409/202, or wait, or poll result

duplicate request after COMPLETED
  -> return stored response/result

duplicate request with different payload
  -> return 409 Idempotency Conflict
```

### Important Design Question

Apa yang dilakukan jika request kedua datang ketika request pertama masih `PROCESSING`?

Pilihan:

1. Return `409 Conflict` dengan pesan “operation still in progress”.
2. Return `202 Accepted` dengan operation status URL.
3. Wait briefly for first request to complete.
4. Return same eventual operation resource.

Untuk operasi long-running, biasanya lebih baik:

```text
POST command -> returns operationId
GET operation status -> client polls
```

---

## 9. Idempotency Key Scope

Idempotency key harus punya scope. Jangan global tanpa konteks.

Contoh buruk:

```sql
UNIQUE(idempotency_key)
```

Kenapa buruk?

Karena key dari client A bisa bentrok dengan key client B.

Lebih baik:

```sql
UNIQUE(tenant_id, actor_id, operation_name, idempotency_key)
```

Atau untuk service-to-service:

```sql
UNIQUE(source_service, operation_name, idempotency_key)
```

Untuk domain operation tertentu:

```sql
UNIQUE(application_id, operation_name, idempotency_key)
```

Scope harus menjawab:

- siapa yang mengirim?
- operasi apa?
- tenant mana?
- entity mana?
- apakah key reusable untuk operasi lain?

---

## 10. Deduplication Window

Idempotency record tidak bisa disimpan selamanya tanpa alasan. Tetapi menghapus terlalu cepat juga berbahaya.

Deduplication window adalah periode di mana request/message duplicate masih dikenali.

Faktor penentu:

1. Retry policy client.
2. Message retention broker.
3. DLQ replay window.
4. Business criticality.
5. Audit requirement.
6. Storage cost.
7. Legal retention.
8. Manual operation window.

Contoh:

| Use Case | Dedup Window |
|---|---:|
| UI double-click protection | menit sampai jam |
| API command retry | 24 jam sampai beberapa hari |
| Payment-like operation | beberapa hari sampai lebih lama |
| Regulatory decision | mengikuti audit/legal retention |
| Event consumer inbox | minimal sepanjang replay/retention window |

Untuk regulatory systems, sering kali idempotency evidence harus bertahan jauh lebih lama daripada cache teknis.

---

## 11. Idempotent HTTP API Design

### 11.1 PUT vs POST

Secara HTTP, `PUT` biasanya lebih mudah dibuat idempotent karena client menentukan resource identity.

Contoh:

```http
PUT /applications/APP-123
```

Dipanggil berkali-kali untuk resource yang sama.

`POST` biasanya digunakan untuk create command atau side-effecting action.

Contoh:

```http
POST /applications/APP-123/submit
```

Untuk `POST`, gunakan idempotency key.

```http
POST /applications/APP-123/submit
Idempotency-Key: 8f3c2f7e-9c3a-4d1a-9011-4a3c0e1d2f01
```

### 11.2 Response Replay

Saat duplicate request datang setelah sukses, server sebaiknya mengembalikan response yang kompatibel dengan response pertama.

Contoh:

```http
HTTP/1.1 201 Created
Location: /applications/APP-123
```

Request duplicate:

```http
HTTP/1.1 201 Created
Location: /applications/APP-123
Idempotent-Replayed: true
```

Atau:

```http
HTTP/1.1 200 OK
```

Konsistensi response penting karena client retry mungkin tidak tahu attempt pertama berhasil.

### 11.3 Payload Hash

Simpan hash dari normalized request payload.

```text
request_hash = sha256(canonical_json(request_body))
```

Saat duplicate key datang:

- jika hash sama: replay result,
- jika hash berbeda: return conflict.

### 11.4 Client-Generated Operation ID

Alternatif yang lebih explicit:

```http
PUT /operations/approve-application-789
body:
{
  "type": "APPROVE_APPLICATION",
  "applicationId": "APP-123",
  "decisionId": "DEC-789"
}
```

Dengan model ini, operation resource menjadi pusat idempotency.

---

## 12. Idempotent Command Handler

Dalam application layer, command harus punya identity.

```java
public record ApproveApplicationCommand(
        String commandId,
        String tenantId,
        String applicationId,
        String reviewerId,
        String decisionId,
        String remarks
) {}
```

Handler harus melakukan:

1. validasi command identity,
2. cek deduplication,
3. load aggregate,
4. apply transition idempotently,
5. write audit/outbox atomically,
6. store command result,
7. return stable response.

Pseudo-flow:

```text
handle(command)
  begin transaction
    insert command_dedup(command_id) or detect existing
    if existing completed:
        return stored result
    if existing processing:
        reject/wait/status

    load application for update/version
    result = application.approve(command)
    save application
    insert audit if not exists for decisionId
    insert outbox if not exists for eventId
    update command_dedup completed with result
  commit
```

---

## 13. State Transition Idempotency

Command idempotency tidak cukup. Domain transition juga harus aman.

Contoh naive:

```java
void approve(Application app) {
    if (app.status() != Status.PENDING_REVIEW) {
        throw new IllegalStateException("Cannot approve");
    }
    app.status(Status.APPROVED);
}
```

Jika command yang sama diulang setelah status `APPROVED`, handler akan error. Padahal retry dari command yang sama seharusnya dianggap sukses/replayed.

Lebih baik bedakan:

1. same command repeated,
2. different command attempting invalid transition.

Contoh domain model:

```java
public ApprovalResult approve(ApprovalDecision decision) {
    if (this.approvalDecisionId != null
            && this.approvalDecisionId.equals(decision.decisionId())) {
        return ApprovalResult.alreadyApplied(this.id, this.approvalDecisionId);
    }

    if (this.status != Status.PENDING_REVIEW) {
        throw new InvalidTransitionException(
                "Application is not pending review. Current status: " + this.status);
    }

    this.status = Status.APPROVED;
    this.approvalDecisionId = decision.decisionId();
    this.approvedBy = decision.reviewerId();
    this.approvedAt = decision.decidedAt();

    return ApprovalResult.applied(this.id, this.approvalDecisionId);
}
```

Key idea:

```text
Same transition identity -> idempotent success
Different transition identity -> enforce domain rule
```

---

## 14. Deduplication with Unique Constraints

In-memory deduplication is not enough.

Distributed systems need durable deduplication.

The most reliable primitive is often a database unique constraint.

Example:

```sql
CREATE TABLE idempotency_record (
    tenant_id          VARCHAR(64)  NOT NULL,
    operation_name    VARCHAR(128) NOT NULL,
    idempotency_key   VARCHAR(256) NOT NULL,
    request_hash      VARCHAR(128) NOT NULL,
    status            VARCHAR(32)  NOT NULL,
    response_code     INTEGER,
    response_body     CLOB,
    created_at        TIMESTAMP    NOT NULL,
    updated_at        TIMESTAMP    NOT NULL,
    expires_at        TIMESTAMP,
    PRIMARY KEY (tenant_id, operation_name, idempotency_key)
);
```

For business effect:

```sql
CREATE TABLE certificate (
    certificate_id      VARCHAR(64) PRIMARY KEY,
    application_id      VARCHAR(64) NOT NULL,
    approval_decision_id VARCHAR(64) NOT NULL,
    issued_at           TIMESTAMP NOT NULL,
    UNIQUE(application_id, approval_decision_id)
);
```

For inbox:

```sql
CREATE TABLE message_inbox (
    consumer_name   VARCHAR(128) NOT NULL,
    message_id      VARCHAR(128) NOT NULL,
    processed_at    TIMESTAMP NOT NULL,
    status          VARCHAR(32) NOT NULL,
    PRIMARY KEY (consumer_name, message_id)
);
```

The unique constraint is a correctness tool, not just a data model detail.

---

## 15. Race Condition: Same Key Arrives Concurrently

Suppose two identical requests arrive at the same time:

```text
T1: POST approve with key K
T2: POST approve with key K
```

Both check idempotency table:

```text
SELECT * WHERE key = K -> none
```

Both proceed.

This is broken.

Correct approach:

```text
Try INSERT idempotency key first.
Only one transaction wins.
Loser reads existing record.
```

Pseudo SQL:

```sql
INSERT INTO idempotency_record (
    tenant_id,
    operation_name,
    idempotency_key,
    request_hash,
    status,
    created_at,
    updated_at
) VALUES (?, ?, ?, ?, 'PROCESSING', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
```

If insert fails due to unique constraint:

```text
read existing record
compare request_hash
return conflict/replay/in-progress
```

Do not implement dedup as:

```text
SELECT then INSERT
```

unless protected by transaction isolation/locking correctly.

---

## 16. Optimistic Locking and Idempotency

Optimistic locking solves concurrent modification of the same entity. Idempotency solves duplicate intent.

They are related but not the same.

Example:

```sql
UPDATE application
SET status = 'APPROVED', version = version + 1
WHERE id = ?
  AND version = ?;
```

This prevents lost update.

But it does not automatically prevent:

- duplicate email,
- duplicate event,
- duplicate certificate,
- duplicate audit record,
- duplicate external call.

Correct design often combines:

```text
idempotency key
+ optimistic locking
+ unique business constraint
+ outbox event id
+ inbox dedup
```

---

## 17. Idempotent Event Consumer

An event consumer must assume that message can be delivered multiple times.

Basic pattern:

```text
begin transaction
  insert into inbox(consumer_name, message_id)
  if duplicate:
      skip
  apply business effect
  commit
ack message
```

Important: insert inbox and business effect must be in the same local transaction.

Wrong design:

```text
check Redis if processed
apply DB effect
mark Redis processed
```

This can fail if DB commit succeeds but Redis mark fails.

Better:

```sql
BEGIN;

INSERT INTO message_inbox(consumer_name, message_id, processed_at, status)
VALUES ('CertificateService', :messageId, CURRENT_TIMESTAMP, 'PROCESSING');

INSERT INTO certificate(...)
VALUES (...)
ON CONFLICT / duplicate-key handling;

UPDATE message_inbox
SET status = 'COMPLETED'
WHERE consumer_name = 'CertificateService'
  AND message_id = :messageId;

COMMIT;
```

In Oracle-style systems, handle unique constraint exception explicitly.

---

## 18. Message ID vs Business Effect ID

Using message ID for inbox prevents processing same envelope twice.

But it does not prevent duplicate business event published with different message IDs.

Example:

```text
Message 1:
  messageId = M1
  eventType = ApplicationApproved
  decisionId = D123

Message 2:
  messageId = M2
  eventType = ApplicationApproved
  decisionId = D123
```

Inbox by message ID alone treats these as different.

To prevent duplicate certificate, use business effect unique constraint:

```sql
UNIQUE(application_id, approval_decision_id)
```

Therefore robust consumers usually need two layers:

1. **Delivery dedup**: message ID inbox.
2. **Business dedup**: unique business effect key.

---

## 19. Idempotent Producer

Consumers are not the only problem. Producers can also duplicate.

Producer failure scenario:

```text
1. service commits business transaction
2. service publishes event
3. service crashes before recording publish success
4. relay restarts
5. event is published again
```

This is why outbox relay must assume duplicate publishing. Consumers must be idempotent.

Producer-side tools:

- transactional outbox,
- stable event ID,
- event sequence per aggregate,
- producer idempotency if broker supports it,
- durable relay state,
- deterministic event generation.

But even with producer idempotency, consumers should still be idempotent because duplicates can arise elsewhere.

---

## 20. Idempotency and External Side Effects

External side effects are hardest:

- sending email,
- payment,
- SMS,
- document generation,
- PDF signing,
- external agency API call,
- file upload,
- webhook delivery.

### 20.1 Email

Sending same email twice may be unacceptable or merely annoying depending on context.

Design:

```sql
CREATE TABLE notification_delivery (
    delivery_id       VARCHAR(64) PRIMARY KEY,
    business_event_id VARCHAR(64) NOT NULL,
    recipient         VARCHAR(320) NOT NULL,
    template_code     VARCHAR(128) NOT NULL,
    status            VARCHAR(32) NOT NULL,
    sent_at           TIMESTAMP,
    UNIQUE(business_event_id, recipient, template_code)
);
```

If duplicate event arrives, unique constraint prevents duplicate delivery record.

But if SMTP send succeeds and DB update fails, outcome is unknown. For high-criticality notifications, design an explicit delivery state machine:

```text
REQUESTED -> SENDING -> SENT_CONFIRMED
                  -> SEND_UNKNOWN -> RECONCILE
                  -> FAILED_RETRYABLE
                  -> FAILED_FINAL
```

### 20.2 Payment-like Operation

Use provider idempotency key when available.

Also store local mapping:

```text
localPaymentIntentId -> providerRequestId -> providerPaymentId
```

Never generate a new provider idempotency key on retry of the same business intent.

### 20.3 File Generation

Use deterministic object key:

```text
certificates/{applicationId}/{approvalDecisionId}.pdf
```

Or unique DB constraint:

```text
UNIQUE(application_id, approval_decision_id, document_type)
```

---

## 21. Idempotency in State Machines

State machines provide a strong foundation for idempotency because each transition has:

- source state,
- target state,
- trigger,
- guard,
- action,
- actor,
- timestamp,
- transition identity.

Example transition table:

| Current State | Command | Transition ID | Result |
|---|---|---|---|
| PENDING_REVIEW | Approve(D1) | D1 | APPROVED |
| APPROVED | Approve(D1) | D1 | replay/already applied |
| APPROVED | Approve(D2) | D2 | invalid transition |
| REJECTED | Approve(D3) | D3 | invalid transition |

This is much stronger than checking only status.

A transition should answer:

1. Is this exact transition already applied?
2. Is this a new transition allowed from current state?
3. Is this a conflicting transition?
4. Is this transition expired?
5. Is this actor still authorized?

---

## 22. Idempotency and Authorization

Idempotency must not bypass authorization.

Dangerous scenario:

```text
User A sends request with key K.
User B somehow repeats key K.
Server returns stored response.
```

If response contains sensitive data, this leaks information.

Therefore idempotency scope should include security context:

```text
tenant_id
actor_id / client_id
operation_name
idempotency_key
```

When duplicate request arrives, verify:

- same tenant,
- same client/actor scope,
- compatible authorization,
- same operation.

For service-to-service, use source service identity.

---

## 23. Idempotency and Audit Trail

Audit logging itself must be carefully modeled.

If a command is retried, should audit contain one row or many?

There are two valid strategies depending on requirement.

### Strategy A: Audit Business Effect Once

Only record the actual business transition once:

```text
Application approved by reviewer R at time T using decision D.
```

Duplicate retries do not create business audit rows.

### Strategy B: Audit Attempts Separately

Record all attempts separately as technical/security audit:

```text
Attempt 1: command received
Attempt 2: duplicate command received
Attempt 3: replayed stored response
```

Best design often separates:

```text
business audit -> records domain facts
technical audit -> records request attempts
security audit -> records access/authorization attempts
```

Do not pollute business audit with duplicate technical retries unless regulation requires it.

---

## 24. Idempotency and Reconciliation

Idempotency reduces duplicate side effects, but it does not remove the need for reconciliation.

Unknown outcome still exists:

```text
Called external system.
Connection dropped.
Did external system process it?
Unknown.
```

Handling unknown outcome:

1. Query external system by idempotency key/reference.
2. Reconcile local state with external state.
3. Mark operation as confirmed or failed.
4. Avoid sending a new different request unless domain allows it.

State example:

```text
PENDING_EXTERNAL_CALL
EXTERNAL_CALL_SENT
EXTERNAL_OUTCOME_UNKNOWN
EXTERNAL_CONFIRMED
EXTERNAL_FAILED
RECONCILIATION_REQUIRED
```

Top-tier engineering habit:

> Every external side effect needs a reconciliation story.

---

## 25. Idempotency Data Model Patterns

### 25.1 Generic Idempotency Table

Good for APIs.

```sql
CREATE TABLE api_idempotency_record (
    tenant_id         VARCHAR(64)  NOT NULL,
    client_id         VARCHAR(128) NOT NULL,
    operation_name    VARCHAR(128) NOT NULL,
    idempotency_key   VARCHAR(256) NOT NULL,
    request_hash      VARCHAR(128) NOT NULL,
    status            VARCHAR(32)  NOT NULL,
    resource_type     VARCHAR(128),
    resource_id       VARCHAR(128),
    response_code     INTEGER,
    response_body     CLOB,
    error_code        VARCHAR(128),
    created_at        TIMESTAMP NOT NULL,
    updated_at        TIMESTAMP NOT NULL,
    expires_at        TIMESTAMP,
    PRIMARY KEY (tenant_id, client_id, operation_name, idempotency_key)
);
```

### 25.2 Command Dedup Table

Good for application layer.

```sql
CREATE TABLE processed_command (
    command_id       VARCHAR(128) PRIMARY KEY,
    command_type     VARCHAR(128) NOT NULL,
    aggregate_type   VARCHAR(128) NOT NULL,
    aggregate_id     VARCHAR(128) NOT NULL,
    actor_id         VARCHAR(128),
    status           VARCHAR(32) NOT NULL,
    result_ref       VARCHAR(256),
    created_at       TIMESTAMP NOT NULL,
    completed_at     TIMESTAMP
);
```

### 25.3 Inbox Table

Good for message consumers.

```sql
CREATE TABLE consumer_inbox (
    consumer_name    VARCHAR(128) NOT NULL,
    message_id       VARCHAR(128) NOT NULL,
    event_type       VARCHAR(128) NOT NULL,
    event_source     VARCHAR(128),
    aggregate_id     VARCHAR(128),
    event_version    INTEGER,
    status           VARCHAR(32) NOT NULL,
    received_at      TIMESTAMP NOT NULL,
    processed_at     TIMESTAMP,
    error_message    VARCHAR(1000),
    PRIMARY KEY (consumer_name, message_id)
);
```

### 25.4 Business Effect Table

Good for irreversible effect.

```sql
CREATE TABLE business_effect_log (
    effect_type       VARCHAR(128) NOT NULL,
    business_key      VARCHAR(256) NOT NULL,
    source_event_id   VARCHAR(128),
    source_command_id VARCHAR(128),
    status            VARCHAR(32) NOT NULL,
    created_at        TIMESTAMP NOT NULL,
    PRIMARY KEY (effect_type, business_key)
);
```

---

## 26. Java Implementation Considerations

### 26.1 Java 8 Baseline

Java 8 systems can still implement robust idempotency.

Use:

- immutable command classes manually,
- `Optional` carefully,
- JDBC/JPA transactions,
- unique constraints,
- explicit exception handling,
- stable UUID generation,
- clock abstraction.

Avoid relying on in-memory maps for correctness.

### 26.2 Java 11 / 17

Java 11/17 improve runtime maturity and language ergonomics.

Useful features:

- `var` for local readability,
- better HttpClient from Java 11,
- records from Java 16+ if available,
- sealed classes from Java 17 for result modeling,
- better container/JVM behavior.

Example result modeling in Java 17+:

```java
public sealed interface IdempotencyDecision
        permits IdempotencyDecision.NewOperation,
                IdempotencyDecision.ReplayCompleted,
                IdempotencyDecision.InProgress,
                IdempotencyDecision.Conflict {

    record NewOperation() implements IdempotencyDecision {}
    record ReplayCompleted(int statusCode, String body) implements IdempotencyDecision {}
    record InProgress(String operationId) implements IdempotencyDecision {}
    record Conflict(String reason) implements IdempotencyDecision {}
}
```

### 26.3 Java 21 / 25

Virtual threads make blocking request handling cheaper, but they do not solve duplicate processing.

Important:

```text
Virtual threads reduce thread scarcity.
They do not remove the need for idempotency, transaction boundaries, unique constraints, or concurrency limits.
```

Java 21+ can make synchronous idempotency workflows easier to structure, but correctness still lives in durable state.

---

## 27. Sample Java Design: Idempotency Service

### 27.1 Interface

```java
public interface IdempotencyService {
    IdempotencyDecision begin(
            String tenantId,
            String clientId,
            String operationName,
            String idempotencyKey,
            String requestHash
    );

    void complete(
            String tenantId,
            String clientId,
            String operationName,
            String idempotencyKey,
            int responseCode,
            String responseBody
    );

    void failRetryable(
            String tenantId,
            String clientId,
            String operationName,
            String idempotencyKey,
            String errorCode
    );

    void failFinal(
            String tenantId,
            String clientId,
            String operationName,
            String idempotencyKey,
            String errorCode
    );
}
```

### 27.2 Begin Logic

```java
public IdempotencyDecision begin(...) {
    try {
        repository.insertProcessingRecord(...);
        return new IdempotencyDecision.NewOperation();
    } catch (DuplicateKeyException duplicate) {
        IdempotencyRecord existing = repository.find(...)
                .orElseThrow(() -> new IllegalStateException("Duplicate key but record not found"));

        if (!existing.requestHash().equals(requestHash)) {
            return new IdempotencyDecision.Conflict("Same idempotency key used with different payload");
        }

        return switch (existing.status()) {
            case COMPLETED -> new IdempotencyDecision.ReplayCompleted(
                    existing.responseCode(),
                    existing.responseBody()
            );
            case PROCESSING -> new IdempotencyDecision.InProgress(existing.operationId());
            case FAILED_FINAL -> new IdempotencyDecision.ReplayCompleted(
                    existing.responseCode(),
                    existing.responseBody()
            );
            case FAILED_RETRYABLE -> new IdempotencyDecision.InProgress(existing.operationId());
            default -> new IdempotencyDecision.Conflict("Unsupported idempotency state");
        };
    }
}
```

### 27.3 Controller Flow

```java
@PostMapping("/applications/{id}/approve")
public ResponseEntity<?> approve(
        @PathVariable String id,
        @RequestHeader("Idempotency-Key") String idempotencyKey,
        @RequestBody ApproveApplicationRequest request,
        Principal principal
) {
    String tenantId = tenantContext.currentTenant();
    String clientId = principal.getName();
    String operation = "APPROVE_APPLICATION";
    String requestHash = canonicalHash(request);

    IdempotencyDecision decision = idempotencyService.begin(
            tenantId,
            clientId,
            operation,
            idempotencyKey,
            requestHash
    );

    if (decision instanceof IdempotencyDecision.ReplayCompleted replay) {
        return ResponseEntity.status(replay.statusCode())
                .header("Idempotent-Replayed", "true")
                .body(replay.body());
    }

    if (decision instanceof IdempotencyDecision.InProgress inProgress) {
        return ResponseEntity.status(202)
                .header("Operation-Id", inProgress.operationId())
                .body("Operation is still processing");
    }

    if (decision instanceof IdempotencyDecision.Conflict conflict) {
        return ResponseEntity.status(409).body(conflict.reason());
    }

    ApproveApplicationResult result = applicationService.approve(
            new ApproveApplicationCommand(
                    idempotencyKey,
                    tenantId,
                    id,
                    principal.getName(),
                    request.decisionId(),
                    request.remarks()
            )
    );

    String responseBody = serialize(result);

    idempotencyService.complete(
            tenantId,
            clientId,
            operation,
            idempotencyKey,
            200,
            responseBody
    );

    return ResponseEntity.ok(result);
}
```

In a real implementation, the idempotency record and business operation completion must be carefully coordinated. For operations where the business transaction and idempotency completion must be atomic, store both in the same database transaction or use a robust operation table as the command state.

---

## 28. Transaction Boundary for Idempotency

There are two common designs.

### 28.1 Idempotency Record and Business Effect in Same DB Transaction

Good when the API service owns the business database.

```text
BEGIN
  insert idempotency PROCESSING
  apply business change
  insert outbox
  update idempotency COMPLETED with response
COMMIT
```

Benefits:

- strong local correctness,
- simple recovery,
- durable dedup.

Risk:

- long transaction if operation includes slow external calls.

Do not call slow external systems inside the same DB transaction unless absolutely necessary.

### 28.2 Operation Resource Pattern

Good for long-running workflows.

```text
POST command
  -> create operation resource if not exists
  -> enqueue/process asynchronously
  -> return operationId

GET /operations/{operationId}
  -> check status/result
```

This fits:

- saga,
- workflow,
- document generation,
- external integration,
- batch-like processing,
- human approval process.

---

## 29. Idempotency and Caches

Cache can help performance but must not be source of correctness.

Bad:

```text
Redis SETNX key
then perform DB update
```

This is incomplete because Redis and DB are not atomically committed together.

Acceptable use:

1. Redis as fast duplicate shield.
2. Database unique constraint as final correctness layer.

Pattern:

```text
Check Redis duplicate shield
  -> if miss, continue
Try durable DB insert/unique constraint
  -> correctness decided here
Update Redis after success
```

If Redis is down, correctness should still work via DB.

---

## 30. Idempotency and Message Replay

Replay is not the same as duplicate retry.

Replay may intentionally process historical events to rebuild projections or recover state.

A consumer must know whether it is in:

```text
LIVE mode
REPLAY mode
BACKFILL mode
RECONCILIATION mode
```

Some side effects are allowed only in live mode.

Example:

| Side Effect | Live | Replay |
|---|---:|---:|
| Update projection | yes | yes |
| Send email | yes | no |
| Generate audit read model | yes | yes |
| Call external agency | yes | usually no |
| Emit downstream notification | maybe | controlled |

Replay-safe handler design:

```java
public void handle(ApplicationApprovedEvent event, ProcessingMode mode) {
    projectionUpdater.apply(event);

    if (mode == ProcessingMode.LIVE) {
        notificationService.sendApprovalEmailOnce(event);
    }
}
```

Better: separate projection consumers from side-effect consumers.

---

## 31. Idempotency Failure Modes

| Failure Mode | Cause | Mitigation |
|---|---|---|
| Duplicate entity creation | retry after timeout | idempotency key + client-generated resource ID |
| Duplicate state transition | same command redelivered | transition identity stored in aggregate |
| Duplicate event handling | at-least-once broker | inbox table |
| Duplicate business effect | duplicate event with different message ID | business unique constraint |
| Same key different payload | client bug/reuse | request hash conflict |
| Idempotency record stuck PROCESSING | crash mid-operation | timeout/recovery process |
| Dedup window too short | late retry/replay | align TTL with retry/replay/legal window |
| Redis dedup lost | cache eviction/restart | durable DB dedup |
| Replay sends email | side effect not mode-aware | separate live/replay consumers |
| Authorization leak | key not scoped | scope by tenant/client/actor |
| Audit duplicated | retries logged as business facts | separate business vs technical audit |

---

## 32. Testing Idempotency

Idempotency must be tested as a first-class correctness property.

### 32.1 Unit Test

Test domain transition:

```text
same decision applied twice -> same result, no duplicate event
same entity different decision after approval -> invalid transition
```

### 32.2 Integration Test

Test database constraints:

```text
same idempotency key concurrently -> one insert wins
same business effect key concurrently -> one effect created
```

### 32.3 Consumer Test

```text
deliver same message twice -> one business effect
same business event with different envelope ID -> one business effect
```

### 32.4 Failure Injection Test

Simulate crash points:

1. after idempotency record insert,
2. after business DB commit,
3. before outbox insert,
4. after outbox insert before publish,
5. after publish before ack,
6. after external call before local update.

### 32.5 Concurrent Test

Run 100 parallel identical commands and assert:

```text
one business transition
one certificate
one outbox business event
many technical attempts allowed
stable final response
```

---

## 33. Observability for Idempotency

Important metrics:

```text
idempotency.new.count
idempotency.replay.count
idempotency.conflict.count
idempotency.in_progress.count
idempotency.stuck_processing.count
idempotency.expired.count
inbox.duplicate.count
business_effect.duplicate_prevented.count
unique_constraint.violation.count
external_outcome_unknown.count
reconciliation.required.count
```

Important logs:

```text
operationName
idempotencyKey hash
commandId
messageId
businessKey
tenantId
actorId
status
requestHash
correlationId
causationId
```

Do not log raw sensitive idempotency keys if they contain business-sensitive data. Prefer hashing.

Important traces:

```text
HTTP command span
idempotency begin span
domain transition span
outbox insert span
external call span
idempotency complete span
```

---

## 34. Security and Privacy

Idempotency tables can become sensitive.

They may contain:

- request body,
- response body,
- actor ID,
- tenant ID,
- business operation,
- error details,
- external references.

Security practices:

1. Store minimal response needed for replay.
2. Mask sensitive fields.
3. Encrypt if required.
4. Hash keys for logs.
5. Scope keys by tenant/client.
6. Apply retention policy.
7. Ensure support/admin access is audited.
8. Avoid raw PII in idempotency key.

Bad key:

```text
approve-application-NRIC-S1234567A
```

Better:

```text
client-generated UUID + server-side business scope
```

---

## 35. Idempotency Design Checklist

For every operation, ask:

```text
1. What is the business effect?
2. Is the operation naturally idempotent?
3. If not, what is the idempotency key?
4. Who generates the key?
5. What is the key scope?
6. What payload fields define same intent?
7. Do we store request hash?
8. What happens if same key comes with different payload?
9. What happens if duplicate arrives while original is processing?
10. What response is replayed?
11. How long is dedup evidence retained?
12. What unique constraint protects the business effect?
13. Are side effects idempotent too?
14. Is external provider called with stable idempotency key?
15. Is message consumer idempotent?
16. Is replay mode safe?
17. Is authorization checked on duplicate replay?
18. Is audit separated between business fact and technical attempt?
19. Is stuck PROCESSING recoverable?
20. Are duplicate-prevention metrics observable?
```

---

## 36. Common Anti-Patterns

### 36.1 “We Don’t Retry, So We Don’t Need Idempotency”

Infrastructure, clients, operators, and brokers can still duplicate.

### 36.2 “Kafka/RabbitMQ/SQS Will Handle It”

Broker guarantees do not automatically protect your database, emails, external calls, or domain state.

### 36.3 “Use UUID Every Time”

If a new UUID is generated on every retry, it does not identify the same intent.

### 36.4 “Dedup in Memory”

In-memory dedup disappears on restart and does not work across replicas.

### 36.5 “Dedup in Redis Only”

Redis-only dedup is usually insufficient for correctness unless the entire effect is also in Redis or atomic with Redis.

### 36.6 “Status Check Is Enough”

Checking status alone cannot distinguish same command retry from conflicting command.

### 36.7 “Message ID Is Enough”

Message ID prevents duplicate envelope processing, not duplicate business facts with different IDs.

### 36.8 “Replay the Event and Everything Will Be Fine”

Replay can accidentally resend email, re-call external systems, or duplicate downstream commands.

### 36.9 “Audit Everything as a New Business Event”

Technical retries should not always become business audit facts.

### 36.10 “Exactly-Once Means I Can Ignore Idempotency”

Exactly-once is bounded by the platform. Business correctness still needs explicit design.

---

## 37. Regulatory Case Management Example

Imagine a regulatory system with application approval.

### Operation

```text
Officer approves application APP-1001.
```

### Business Effects

1. Application status becomes APPROVED.
2. Approval decision is recorded.
3. Certificate is generated.
4. Applicant is notified.
5. Audit fact is recorded.
6. Reporting projection is updated.
7. Downstream compliance monitoring may start.

### Correctness Requirements

```text
Same approval decision must not approve twice.
Certificate must be generated once.
Applicant should not receive duplicate official approval email.
Audit business fact should be recorded once.
Technical retries may be recorded separately.
```

### Design

```text
Command ID:
  approve-APP-1001-DEC-777

Idempotency scope:
  tenant + officer + APPROVE_APPLICATION + key

Application table:
  approval_decision_id unique per application approval

Outbox event:
  eventId = ApplicationApproved:APP-1001:DEC-777

Certificate table:
  unique(application_id, approval_decision_id)

Notification delivery:
  unique(event_id, recipient, template_code)

Inbox:
  unique(consumer_name, message_id)

Audit:
  business audit unique(application_id, transition_id)
  technical audit records attempts
```

### Failure Scenario

Officer clicks approve. Browser times out.

Unknown to browser, backend succeeded.

Officer clicks again.

Expected behavior:

```text
Server recognizes same idempotency key.
Returns approval result.
Does not create second decision.
Does not generate second certificate.
Does not send duplicate email.
Does not emit duplicate business audit fact.
May record duplicate technical attempt.
```

---

## 38. Mental Model Summary

The deepest mental model of this part:

```text
Distributed systems cannot promise that attempts happen once.

Therefore production systems must make repeated attempts safe.

Safety is achieved by assigning stable identity to business intent,
storing durable evidence of processing,
controlling state transitions,
protecting business effects with unique constraints,
and making side effects replay-aware.
```

Do not ask only:

```text
Will this request be sent once?
```

Ask:

```text
If this request, command, event, handler, or external call happens twice,
what exact business effect can duplicate?
Where is that prevented?
How do we prove it?
How do we recover if the outcome is unknown?
```

---

## 39. Practical Exercises

### Exercise 1 — Idempotent Submit Application

Design idempotency for:

```text
POST /applications/{draftId}/submit
```

Answer:

1. Who generates idempotency key?
2. What is the key scope?
3. What table stores dedup?
4. What unique constraint prevents duplicate application?
5. What response is replayed?
6. What is retained for audit?

### Exercise 2 — Idempotent Event Consumer

Design consumer for:

```text
ApplicationApproved
```

Consumer must:

- generate certificate once,
- update projection,
- send notification once,
- handle duplicate message,
- handle replay.

### Exercise 3 — Same Key Different Payload

Given:

```text
Idempotency-Key: K1
request A: approve APP-1 with remarks OK
request B: reject APP-1 with remarks Invalid
```

Design response and audit behavior.

### Exercise 4 — Unknown External Outcome

A service calls an external license registry. HTTP timeout occurs after request body is sent.

Design:

1. local state,
2. retry behavior,
3. reconciliation,
4. idempotency key usage,
5. operator visibility.

---

## 40. Production Readiness Checklist

A microservice is not production-ready for duplicate/retry scenarios unless:

```text
[ ] Every side-effecting API has idempotency strategy.
[ ] Every command has stable identity.
[ ] Every consumer is idempotent.
[ ] Deduplication is durable, not memory-only.
[ ] Unique constraints protect business effects.
[ ] Same key + different payload returns conflict.
[ ] In-progress duplicate behavior is defined.
[ ] Completed duplicate returns stable/replayed response.
[ ] Dedup window is explicitly defined.
[ ] Replay mode does not trigger unsafe side effects.
[ ] External calls use stable reference/idempotency key where possible.
[ ] Unknown external outcome has reconciliation path.
[ ] Authorization is checked for replayed idempotent responses.
[ ] Idempotency records have retention and privacy policy.
[ ] Metrics exist for duplicate, replay, conflict, and stuck operations.
[ ] Tests cover duplicate, concurrent duplicate, crash, and replay cases.
```

---

## 41. Architecture Review Questions

Use these in design review:

1. What operation identity survives retry?
2. What happens if client retries after timeout?
3. What happens if broker redelivers message after DB commit?
4. What happens if consumer receives same business event with different message ID?
5. What happens if request is duplicated concurrently?
6. What unique constraint protects each irreversible effect?
7. How is duplicate response generated?
8. How long are idempotency records retained?
9. Can replay accidentally trigger notification or external call?
10. How do we detect stuck idempotency records?
11. How do we distinguish same command retry from conflicting command?
12. Is idempotency scoped by tenant/client/actor?
13. Can support safely inspect/reconcile unknown outcomes?
14. Is audit trail business-meaningful or polluted by technical retries?
15. Does the design still work with Java 8 legacy services and Java 21/25 modern services coexisting?

---

## 42. Closing

Idempotency is not a small API feature. It is a distributed correctness pattern.

A system that cannot tolerate duplicate requests and duplicate messages is not truly resilient, regardless of how many retries, circuit breakers, queues, or autoscalers it has.

The top-tier mindset is:

```text
Retries are necessary for availability.
Retries create duplicates.
Duplicates threaten correctness.
Idempotency converts duplicate attempts into safe convergence.
```

Part ini menjadi fondasi penting untuk part berikutnya karena workflow, orchestration, state machine, security, observability, deployment, and incident recovery all depend on duplicate-safe behavior.

---

# Status Seri

```text
Part 17 of 35 completed.
```

Seri belum selesai.

Part berikutnya:

```text
Part 18 — Workflow, Orchestration, Choreography, and Process Managers
```

Filename berikutnya:

```text
learn-java-microservices-patterns-advanced-engineering-18-workflow-orchestration-choreography-process-manager.md
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-microservices-patterns-advanced-engineering-16-backpressure-flow-control-capacity-aware-design.md">⬅️ Learn Java Microservices Patterns — Advanced Engineering</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-microservices-patterns-advanced-engineering-18-workflow-orchestration-choreography-process-manager.md">Learn Java Microservices Patterns — Advanced Engineering ➡️</a>
</div>
