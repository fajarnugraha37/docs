# learn-java-reliability-part-015.md

# Part 015 — Idempotency as Core Reliability Primitive

> Seri: Graceful Shutdown, Error Handling, Exceptions, and Reliability  
> Status: Part 015 / 030  
> Bagian sebelumnya: Part 014 — Transaction Safety During Failure and Shutdown  
> Bagian berikutnya: Part 016 — Timeouts, Deadlines, and Cancellation

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita membahas bahwa transaksi tidak selalu memberi jawaban yang nyaman ketika failure terjadi. Ada kondisi ketika client menerima timeout, koneksi putus, process mati, pod di-terminate, atau response gagal terkirim, sementara server mungkin sudah melakukan sebagian atau seluruh efek bisnis.

Masalah intinya adalah:

> Setelah sebuah operasi gagal dari sudut pandang caller, kita sering tidak tahu apakah operasi itu benar-benar tidak terjadi, sedang terjadi, sudah terjadi sebagian, atau sudah selesai tetapi response-nya hilang.

Di sinilah **idempotency** menjadi primitive reliability yang sangat penting.

Materi ini bertujuan membuat kamu mampu:

1. memahami idempotency sebagai konsep state, bukan sekadar HTTP method;
2. membedakan retry-safe, duplicate-safe, naturally idempotent, dan artificially idempotent operation;
3. mendesain idempotency key, idempotency store, response replay, dan conflict semantics;
4. menerapkan idempotency pada REST API, command handler, worker, message consumer, batch job, dan external integration;
5. memahami failure window antara request diterima, lock dibuat, transaksi commit, side effect keluar, response disimpan, dan client retry;
6. menghindari anti-pattern seperti retry tanpa deduplication, idempotency key yang terlalu global, cache response tanpa payload fingerprint, dan fallback yang menciptakan false success.

---

## 1. Core Problem

Dalam sistem produksi, banyak operasi penting tidak boleh terjadi dua kali:

- membuat pembayaran;
- submit application;
- approve case;
- issue license;
- mengirim notification resmi;
- membuat invoice;
- deduct quota;
- create user account;
- publish enforcement action;
- melakukan external API call yang menghasilkan state provider;
- membuat resource cloud;
- memproses message dari broker;
- menjalankan batch correction.

Namun sistem distributed selalu menghadapi kemungkinan duplicate execution:

```text
Client sends request
Server processes request
Server commits DB transaction
Response is lost because network drops
Client times out
Client retries
Server receives the same intent again
```

Tanpa idempotency, retry dapat mengubah temporary uncertainty menjadi data corruption.

Contoh sederhana:

```text
POST /payments
body: { amount: 100000, account: "A" }

Attempt 1:
- server deducts balance
- server creates payment
- response timeout

Attempt 2:
- server deducts balance again
- server creates another payment
```

Dari sudut pandang client, retry terasa wajar. Dari sudut pandang server, itu dua request berbeda. Dari sudut pandang user, itu kerusakan data.

Idempotency memecahkan masalah ini dengan membuat server mampu mengenali bahwa dua attempt merepresentasikan **business intent yang sama**, bukan dua operasi bisnis berbeda.

---

## 2. Definisi yang Tepat

Secara konseptual:

> Operasi disebut idempotent jika menjalankan operasi yang sama lebih dari satu kali menghasilkan efek akhir yang sama seperti menjalankannya satu kali.

Yang penting adalah **efek akhir pada state**, bukan selalu response byte-for-byte sama.

Contoh:

```http
DELETE /documents/123
```

Attempt pertama mungkin menghapus dokumen dan return `204 No Content`.

Attempt kedua mungkin return `404 Not Found` karena dokumen sudah tidak ada.

Apakah ini idempotent? Secara state iya, karena hasil akhirnya sama: dokumen tidak ada.

Namun untuk operasi bisnis yang butuh retry-safe UX, sering kali kita ingin lebih dari sekadar state idempotency. Kita ingin:

1. side effect hanya terjadi sekali;
2. retry dengan key yang sama mengembalikan outcome yang sama atau equivalent;
3. request berbeda dengan key sama ditolak sebagai conflict;
4. client dapat membedakan duplicate retry dari business conflict biasa;
5. operator dapat menelusuri original attempt.

Jadi dalam enterprise reliability, idempotency bukan hanya properti matematis. Ia adalah **contract antara caller dan server untuk menangani uncertainty**.

---

## 3. Idempotency vs Safe vs Retryable

Banyak engineer mencampuradukkan tiga istilah ini.

### 3.1 Safe Operation

Safe operation adalah operasi yang tidak dimaksudkan mengubah state server.

Contoh umum:

```http
GET /applications/123
```

Safe bukan berarti tidak ada efek teknis sama sekali. Server bisa saja menulis access log, metrics, atau cache hit. Tetapi secara semantic, operasi itu tidak dimaksudkan mengubah resource bisnis.

### 3.2 Idempotent Operation

Idempotent operation boleh mengubah state, tetapi pengulangan operasi yang sama tidak menambah efek baru.

Contoh:

```http
PUT /profile/123
body: { email: "a@example.com" }
```

Dipanggil sekali atau sepuluh kali, target state tetap sama: email user menjadi `a@example.com`.

### 3.3 Retryable Operation

Retryable berarti caller boleh mencoba lagi setelah failure tertentu.

Retryability membutuhkan beberapa syarat:

- failure bersifat transient;
- operation idempotent atau dilindungi idempotency key;
- retry memiliki backoff/jitter;
- retry tidak memperparah overload;
- caller memiliki deadline;
- server dapat menangani duplicate attempt.

Operasi bisa idempotent tetapi tidak selalu aman di-retry tanpa kontrol. Misalnya `DELETE` resource besar bisa memicu proses mahal setiap kali dipanggil jika implementasinya buruk.

Operasi bisa tidak naturally idempotent tetapi dibuat retryable melalui idempotency key.

```http
POST /payments
Idempotency-Key: 8f5c9d4a-... 
```

---

## 4. Idempotency sebagai State Machine

Cara paling kuat memahami idempotency adalah sebagai state machine per business intent.

```text
                 ┌─────────────┐
                 │  NOT SEEN   │
                 └──────┬──────┘
                        │ first request with key
                        ▼
                 ┌─────────────┐
                 │ IN_PROGRESS │
                 └──────┬──────┘
           success      │       failure before effect
              ┌─────────┴─────────┐
              ▼                   ▼
       ┌─────────────┐      ┌─────────────┐
       │  SUCCEEDED  │      │   FAILED    │
       └──────┬──────┘      └──────┬──────┘
              │ retry same key      │ retry policy dependent
              ▼                     ▼
       replay result          retry/reject/recover
```

State penting:

| State | Meaning | Retry Behavior |
|---|---|---|
| `NOT_SEEN` | Key belum pernah diproses | Terima sebagai request baru |
| `IN_PROGRESS` | Request sedang diproses | Return `409`, `202`, wait, atau poll status |
| `SUCCEEDED` | Efek bisnis sudah selesai | Replay response / return equivalent success |
| `FAILED_RETRYABLE` | Gagal sebelum efek irreversible | Boleh retry |
| `FAILED_FINAL` | Gagal final/non-retryable | Replay failure atau return final error |
| `EXPIRED` | Idempotency record melewati retention window | Tergantung contract: reject, treat as new, atau require new key |

Mental model ini penting karena idempotency bukan hanya “cek key sudah ada”. Idempotency harus menjawab:

- apakah operation masih berjalan?
- apakah efek sudah terjadi?
- apakah response original tersedia?
- apakah retry memakai payload yang sama?
- apakah failure sebelumnya final atau retryable?
- apakah record masih valid?

---

## 5. Natural Idempotency vs Synthetic Idempotency

### 5.1 Natural Idempotency

Operasi naturally idempotent ketika target state ditentukan secara eksplisit.

Contoh:

```http
PUT /cases/CASE-123/status
body: { "status": "CLOSED" }
```

Jika status sudah `CLOSED`, melakukan operasi yang sama tidak mengubah state lagi.

Namun natural idempotency tetap membutuhkan guard:

```text
OPEN -> CLOSED allowed
CLOSED -> CLOSED duplicate allowed
CANCELLED -> CLOSED forbidden
```

Jadi walaupun operation terlihat idempotent, domain state machine tetap menentukan validitasnya.

### 5.2 Synthetic Idempotency

Synthetic idempotency dibuat dengan key unik yang merepresentasikan intent.

Contoh:

```http
POST /applications/123/submissions
Idempotency-Key: submit-application-123-v7
```

Server menyimpan key tersebut dan mengaitkannya dengan result.

Synthetic idempotency dibutuhkan untuk operasi seperti:

- `POST /payments`;
- `POST /orders`;
- `POST /applications/{id}/submit`;
- `POST /cases/{id}/approve`;
- `POST /notifications/send`;
- message consumer;
- batch step execution;
- external provisioning.

---

## 6. Idempotency Key Design

Idempotency key adalah identitas untuk **business intent**, bukan sekadar random UUID tanpa makna.

Ada dua pendekatan utama.

### 6.1 Client-Generated Key

Client membuat key dan mengirimkannya ke server.

Contoh:

```http
POST /payments
Idempotency-Key: 3f8a7e6b-9e20-4e6f-95f3-7a1e3f1c0012
```

Kelebihan:

- bagus untuk retry dari client;
- caller bisa menyimpan key;
- cocok untuk mobile/browser/backend client;
- cocok untuk unknown outcome.

Risiko:

- client bisa reuse key salah;
- client bisa mengirim payload berbeda dengan key sama;
- key bisa terlalu global;
- key bisa ditebak jika tidak random;
- retention harus jelas.

### 6.2 Server-Derived Key

Server membentuk key dari domain identity.

Contoh:

```text
submit-application:{applicationId}:{version}
approve-case:{caseId}:{decisionVersion}:{approverId}
send-notification:{templateId}:{recipientId}:{businessEventId}
```

Kelebihan:

- semantic lebih kuat;
- tidak bergantung pada disiplin client;
- cocok untuk internal command/message;
- bisa diproteksi dengan unique constraint.

Risiko:

- salah memilih komponen key dapat memblok operasi valid;
- key berubah ketika payload berubah kecil;
- harus hati-hati dengan versioning.

### 6.3 Scope Key

Key tidak boleh hanya unik secara global tanpa scope, karena conflict dan leakage bisa sulit dianalisis.

Lebih baik menyimpan:

```text
idempotency_scope = tenant/user/client/resource/action
idempotency_key   = caller supplied key
```

Contoh schema:

```sql
CREATE TABLE idempotency_record (
    id                  BIGSERIAL PRIMARY KEY,
    scope               VARCHAR(200) NOT NULL,
    idempotency_key     VARCHAR(200) NOT NULL,
    request_hash        VARCHAR(128) NOT NULL,
    status              VARCHAR(40) NOT NULL,
    response_status     INTEGER,
    response_body       TEXT,
    resource_type       VARCHAR(100),
    resource_id         VARCHAR(100),
    error_code          VARCHAR(100),
    created_at          TIMESTAMP NOT NULL,
    updated_at          TIMESTAMP NOT NULL,
    expires_at          TIMESTAMP NOT NULL,
    UNIQUE (scope, idempotency_key)
);
```

Key yang sama boleh dipakai oleh tenant berbeda jika scope berbeda. Tetapi dalam scope yang sama, key harus menunjuk ke intent yang sama.

---

## 7. Request Fingerprint: Melindungi dari Key Reuse yang Salah

Idempotency key saja tidak cukup. Server juga harus menyimpan fingerprint request.

Contoh masalah:

```http
POST /payments
Idempotency-Key: abc
body: { amount: 100000 }
```

Lalu client bug mengirim:

```http
POST /payments
Idempotency-Key: abc
body: { amount: 200000 }
```

Jika server hanya melihat key, ia mungkin mengembalikan result payment pertama. Ini berbahaya karena caller mengira payment 200000 diproses.

Maka simpan request hash:

```text
hash = SHA-256(canonical(method + path + normalized_body + relevant_headers))
```

Rules:

1. same key + same fingerprint + succeeded → replay result;
2. same key + same fingerprint + in progress → return in-progress response;
3. same key + different fingerprint → reject as idempotency conflict;
4. expired key → follow retention policy.

Contoh response conflict:

```json
{
  "type": "https://api.example.com/problems/idempotency-key-conflict",
  "title": "Idempotency key conflict",
  "status": 409,
  "code": "IDEMPOTENCY_KEY_CONFLICT",
  "detail": "The same idempotency key was used with a different request payload.",
  "correlationId": "01J..."
}
```

---

## 8. Response Replay vs Equivalent Success

Ada dua model.

### 8.1 Exact Response Replay

Server menyimpan status code dan response body original.

Attempt pertama:

```http
201 Created
{
  "paymentId": "PAY-123",
  "status": "SUCCEEDED"
}
```

Retry dengan key sama:

```http
201 Created
{
  "paymentId": "PAY-123",
  "status": "SUCCEEDED"
}
```

Kelebihan:

- client behavior stabil;
- retry transparan;
- cocok untuk API publik;
- mudah dipahami.

Risiko:

- response body bisa berisi PII;
- retention dan encryption perlu dipikirkan;
- response schema berubah bisa memengaruhi replay lama;
- storage bisa besar.

### 8.2 Equivalent Success

Server tidak menyimpan response penuh, hanya resource reference.

Retry:

```http
200 OK
{
  "paymentId": "PAY-123",
  "status": "SUCCEEDED",
  "duplicateOf": "original-request"
}
```

Kelebihan:

- storage lebih kecil;
- bisa mengambil latest resource state;
- cocok untuk internal API.

Risiko:

- response retry tidak sama dengan original;
- client harus siap;
- jika resource berubah setelah original attempt, response bisa membingungkan.

Untuk API publik, exact replay sering lebih aman secara contract. Untuk sistem internal, equivalent success sering cukup asal terdokumentasi.

---

## 9. Idempotency Store Pattern

### 9.1 Basic Flow

```text
1. Receive request with idempotency key
2. Compute request fingerprint
3. Try insert idempotency record as IN_PROGRESS
4. If insert succeeds, process operation
5. Commit business state
6. Store result in idempotency record as SUCCEEDED/FAILED
7. Return response
8. If duplicate request arrives, decide based on existing record
```

### 9.2 Pseudocode Java

```java
public PaymentResponse createPayment(CreatePaymentCommand command, IdempotencyContext idem) {
    String scope = "tenant:" + command.tenantId() + ":payment:create";
    String fingerprint = fingerprint(command);

    IdempotencyRecord record = idempotencyService.tryStart(scope, idem.key(), fingerprint);

    if (record.isDuplicate()) {
        return handleDuplicate(record, fingerprint);
    }

    try {
        Payment payment = paymentService.create(command);
        PaymentResponse response = PaymentResponse.from(payment);

        idempotencyService.markSucceeded(
            record.id(),
            201,
            serialize(response),
            "PAYMENT",
            payment.id()
        );

        return response;
    } catch (BusinessException ex) {
        idempotencyService.markFailedFinal(record.id(), ex.errorCode());
        throw ex;
    } catch (Exception ex) {
        idempotencyService.markFailedRetryable(record.id(), classify(ex));
        throw ex;
    }
}
```

Pseudocode ini belum cukup untuk semua production case, tetapi menunjukkan prinsip utama: duplicate detection harus terjadi sebelum side effect utama.

---

## 10. Atomicity Problem pada Idempotency Record dan Business State

Masalah paling penting:

> Bagaimana memastikan idempotency record dan business state konsisten?

Jika keduanya dalam database yang sama, gunakan satu transaction boundary.

```text
BEGIN
  insert idempotency IN_PROGRESS
  create payment
  update idempotency SUCCEEDED with payment id
COMMIT
```

Tetapi ada subtle failure window:

```text
COMMIT succeeds
process dies before HTTP response reaches client
client retries
server sees SUCCEEDED record
server replays response
```

Ini justru scenario ideal.

Masalah muncul jika:

- idempotency record di Redis, business state di DB;
- business state commit, idempotency update gagal;
- external side effect terjadi sebelum record success disimpan;
- response disimpan di store berbeda;
- transaction terlalu besar dan memegang lock lama.

### 10.1 Preferred Model

Untuk command penting:

```text
Idempotency record + business state + outbox event
harus berada dalam database transaction yang sama.
```

Jika external side effect dibutuhkan, jangan lakukan langsung di tengah command transaction. Simpan outbox event, lalu worker yang idempotent mengirim side effect tersebut.

---

## 11. Handling IN_PROGRESS Duplicate

Jika duplicate request datang ketika original request masih berjalan, apa yang harus dilakukan?

Pilihan:

### 11.1 Return 409 Conflict

```http
409 Conflict
{
  "code": "IDEMPOTENCY_REQUEST_IN_PROGRESS"
}
```

Cocok jika client bisa retry setelah delay.

### 11.2 Return 202 Accepted

```http
202 Accepted
{
  "status": "PROCESSING",
  "statusUrl": "/operations/op-123"
}
```

Cocok untuk long-running operation.

### 11.3 Wait Briefly

Server menunggu sebentar sampai original selesai.

Risiko:

- thread/request resource tertahan;
- bisa memperparah overload;
- butuh strict timeout.

### 11.4 Return Current Operation Resource

Jika sistem punya operation tracking:

```json
{
  "operationId": "OP-123",
  "status": "RUNNING"
}
```

Ini paling baik untuk operasi yang memang bisa lama.

Rule praktis:

- operasi cepat: duplicate `IN_PROGRESS` boleh return `409` + `Retry-After`;
- operasi lama: gunakan operation resource + polling;
- jangan block indefinite;
- jangan create second worker untuk key yang sama.

---

## 12. Expiration and Retention Window

Idempotency record tidak bisa disimpan selamanya untuk semua operasi. Tetapi retention terlalu pendek merusak guarantee.

Pertimbangkan:

- berapa lama client bisa retry?
- berapa lama network/client timeout ambiguity relevan?
- apakah operasi punya konsekuensi finansial/regulatory?
- apakah duplicate setelah 24 jam harus dianggap duplicate atau intent baru?
- apakah audit membutuhkan history lebih lama?
- apakah response body mengandung data sensitif?

Contoh kebijakan:

```text
Payment creation:       retain key 24-72 hours, audit forever by payment id
Submission command:     retain key 7-30 days
Notification send:      retain dedup by event id permanently or per campaign
Batch step execution:   retain by job id + step id forever operationally
External provisioning:  retain by client token until terminal resource state
```

Jika key expired, contract harus jelas:

- reject expired key and require new key;
- treat as new request;
- search business resource by natural key;
- return ambiguous error requiring manual check.

Untuk high-risk operation, “treat as new” setelah expiry bisa berbahaya.

---

## 13. HTTP API Idempotency Design

### 13.1 Which Methods Need Key?

HTTP `GET`, `HEAD`, `OPTIONS`, `TRACE` biasanya safe. `PUT` dan `DELETE` didefinisikan idempotent dalam HTTP semantics, tetapi implementasi tetap harus menjaga efek bisnisnya tidak berulang. `POST` biasanya tidak idempotent secara natural, sehingga sering membutuhkan idempotency key untuk operasi create/command yang retryable.

Contoh:

```http
POST /applications/{applicationId}/submit
Idempotency-Key: 01J9Q4...
```

### 13.2 Header Contract

Gunakan header eksplisit:

```http
Idempotency-Key: <unique-key>
```

Tambahkan optional response header:

```http
Idempotency-Replayed: true
Idempotency-Status: succeeded
```

Namun jangan membuat client bergantung pada header non-standard tanpa dokumentasi.

### 13.3 Missing Key

Untuk high-risk command, missing key sebaiknya ditolak.

```http
400 Bad Request
{
  "code": "IDEMPOTENCY_KEY_REQUIRED"
}
```

Untuk low-risk create, boleh optional, tetapi retry safety tidak dijamin.

### 13.4 Payload Mismatch

```http
409 Conflict
{
  "code": "IDEMPOTENCY_KEY_CONFLICT"
}
```

### 13.5 In Progress

```http
409 Conflict
Retry-After: 3
{
  "code": "IDEMPOTENCY_REQUEST_IN_PROGRESS"
}
```

Atau:

```http
202 Accepted
Location: /operations/OP-123
```

---

## 14. Idempotency for Message Consumers

Broker seperti Kafka/RabbitMQ sering memberi delivery guarantee `at-least-once`. Artinya message bisa diterima lebih dari sekali.

Penyebab duplicate:

- consumer memproses message lalu crash sebelum ack/commit offset;
- broker redeliver;
- producer publish duplicate;
- rebalance;
- network failure;
- ack timeout;
- manual replay;
- DLQ reprocessing.

Maka consumer harus idempotent.

### 14.1 Processed Message Table

```sql
CREATE TABLE processed_message (
    consumer_name   VARCHAR(100) NOT NULL,
    message_id      VARCHAR(200) NOT NULL,
    processed_at    TIMESTAMP NOT NULL,
    result_ref      VARCHAR(200),
    PRIMARY KEY (consumer_name, message_id)
);
```

Flow:

```text
BEGIN
  insert into processed_message(consumer, message_id)
  if duplicate key -> skip safely
  apply business change
COMMIT
ack message
```

Important:

```text
ack message hanya setelah transaction commit.
```

Jika ack dilakukan sebelum commit, message hilang tetapi state belum berubah.

Jika commit dilakukan sebelum ack lalu crash, message dikirim ulang, tetapi processed table mencegah efek kedua.

### 14.2 Natural Business Key

Kadang tidak perlu table terpisah jika business table punya unique key.

Contoh:

```sql
CREATE UNIQUE INDEX uq_notification_event_recipient
ON notification_delivery(event_id, recipient_id);
```

Duplicate insert gagal, consumer tahu notification sudah pernah diproses.

### 14.3 Inbox Pattern

Untuk event-driven system, gunakan inbox table:

```text
incoming_event
- event_id
- producer
- aggregate_id
- event_type
- payload
- status
- received_at
- processed_at
```

Ini memberi audit dan replay control lebih kuat daripada processed-message table minimal.

---

## 15. Idempotency for Batch Jobs

Batch job juga sering mengalami duplicate execution:

- scheduler trigger dua kali;
- pod restart;
- manual rerun;
- timeout;
- partial completion;
- worker parallel overlap;
- retry per chunk.

Desain idempotent batch:

```text
job_instance_id + step_name + partition_key + item_key
```

Setiap item harus punya deterministic identity.

Contoh:

```sql
CREATE TABLE batch_item_result (
    job_name        VARCHAR(100) NOT NULL,
    job_instance_id VARCHAR(100) NOT NULL,
    step_name       VARCHAR(100) NOT NULL,
    item_key        VARCHAR(200) NOT NULL,
    status          VARCHAR(40) NOT NULL,
    result_hash     VARCHAR(128),
    processed_at    TIMESTAMP NOT NULL,
    PRIMARY KEY (job_name, job_instance_id, step_name, item_key)
);
```

Rule:

- batch rerun tidak boleh memproses ulang item sukses secara destruktif;
- failed item boleh retry jika failure retryable;
- partial progress harus checkpointed;
- output harus deterministic;
- side effect eksternal harus punya idempotency key sendiri;
- operator harus bisa melihat item mana done, failed, skipped, duplicate.

---

## 16. Idempotency for External Integrations

Ketika memanggil external provider, kamu tidak selalu bisa mengontrol idempotency mereka.

Kemungkinan:

1. provider mendukung idempotency key/client token;
2. provider punya natural unique reference;
3. provider tidak mendukung idempotency;
4. provider mendukung idempotency tapi retention pendek;
5. provider response timeout tetapi operation berhasil.

### 16.1 Provider Supports Idempotency

Gunakan key stabil dari business intent.

```text
providerKey = "payment:" + internalPaymentId
```

Jangan generate UUID baru setiap retry. Itu menghancurkan idempotency.

### 16.2 Provider Has Natural Reference

Misalnya provider menerima `merchantReference` unik.

```json
{
  "merchantReference": "PAY-123",
  "amount": 100000
}
```

Pastikan reference unik dan provider benar-benar enforce uniqueness.

### 16.3 Provider Has No Idempotency

Maka kamu harus mengurangi risiko:

- call provider hanya dari outbox worker;
- gunakan local state machine;
- setelah timeout, query status provider sebelum retry;
- gunakan reconciliation job;
- batasi automatic retry;
- butuh manual review untuk ambiguous outcome;
- jangan blind retry irreversible action.

---

## 17. State Machine Example: Submit Application

Misalnya domain regulatory application:

```text
DRAFT -> SUBMITTED -> UNDER_REVIEW -> APPROVED/REJECTED
```

Command:

```http
POST /applications/APP-123/submit
Idempotency-Key: submit-APP-123-v5
```

Rules:

```text
If state = DRAFT and version = 5:
  submit, create submission record, emit event

If state = SUBMITTED and same idempotency key:
  return original submission result

If state = SUBMITTED and different key:
  return APPLICATION_ALREADY_SUBMITTED

If state = UNDER_REVIEW:
  return APPLICATION_NOT_SUBMITTABLE

If same key but different payload hash:
  return IDEMPOTENCY_KEY_CONFLICT
```

This is important: duplicate retry is not the same as normal business conflict.

Duplicate retry means:

```text
same caller intent, same key, same payload
```

Business conflict means:

```text
new command conflicts with current state
```

A top-tier system distinguishes both.

---

## 18. Idempotency and Optimistic Locking

Optimistic locking prevents lost update. Idempotency prevents duplicate intent execution. They solve different problems.

Example:

```text
Optimistic lock:
  "You are updating version 5, but current version is 6."

Idempotency:
  "You already submitted this command; here is the original result."
```

For command APIs, they often work together:

```http
POST /cases/CASE-123/approve
If-Match: "version-7"
Idempotency-Key: approve-case-CASE-123-v7-user-456
```

Flow:

1. idempotency checks duplicate intent;
2. optimistic lock checks state version;
3. domain state machine checks transition validity;
4. transaction commits state change;
5. result is stored for replay.

---

## 19. Idempotency and Unique Constraints

The strongest idempotency guarantee often comes from database uniqueness.

Example:

```sql
CREATE UNIQUE INDEX uq_payment_business_intent
ON payment(tenant_id, order_id, payment_attempt_no);
```

Then even if two nodes race:

```text
Node A receives request
Node B receives retry/duplicate
Both try create same payment
Only one insert succeeds
Other reads existing payment and returns duplicate-equivalent response
```

Do not rely only on application-level `if exists then insert` without DB constraint. Under concurrency, both can pass existence check.

Bad:

```java
if (!repository.existsByOrderId(orderId)) {
    repository.save(new Payment(orderId));
}
```

Good:

```text
insert with unique key
if duplicate key:
  load existing row
  compare semantic intent
  return existing result or conflict
```

---

## 20. Idempotency Failure Windows

### 20.1 Failure Before Idempotency Record Insert

```text
Request arrives
Process dies before insert
Client retries
Server treats as new
```

Usually safe because no effect happened.

### 20.2 Failure After IN_PROGRESS Insert Before Business Effect

```text
Insert IN_PROGRESS
Process dies
Client retries
Server sees stale IN_PROGRESS
```

Need stale in-progress handling.

Options:

- mark as `ABANDONED` after timeout;
- allow retry takeover with lock/version;
- expose operation status unknown;
- background sweeper.

### 20.3 Failure After Business Commit Before Mark SUCCEEDED

If same DB transaction: impossible because both commit together.

If separate stores: dangerous.

Mitigation:

- same transaction if possible;
- reconciliation from business resource;
- store resource reference early;
- avoid separate Redis-only idempotency for critical writes.

### 20.4 Failure After External Side Effect Before Local Success

Very dangerous.

Mitigation:

- use external idempotency key;
- use outbox;
- query provider before retry;
- reconciliation;
- manual review for ambiguity.

### 20.5 Failure After Success Before Response

This is the main scenario idempotency solves.

```text
Business success
Result stored
Response lost
Retry replays result
```

---

## 21. Common Implementation Pattern in Spring

### 21.1 Filter/Interceptor Level

API layer extracts:

- idempotency key;
- tenant/client/user scope;
- method/path;
- canonical body hash;
- correlation ID.

But API filter should not always complete the whole idempotency behavior because business semantics may be needed.

Recommended split:

```text
Web layer:
  parse and validate key presence/format
  build idempotency context

Application service:
  decide scope/action
  start idempotency record in transaction
  execute command
  store outcome

Exception mapper:
  translate idempotency errors into API error contract
```

### 21.2 Domain-Specific Idempotency

Avoid one generic magical annotation for all operations unless the semantics are simple.

Bad:

```java
@Idempotent
public Response doAnything(Request request) { ... }
```

Better:

```java
submitApplication(command, IdempotencyContext.forAction("application.submit"));
approveCase(command, IdempotencyContext.forAction("case.approve"));
createPayment(command, IdempotencyContext.forAction("payment.create"));
```

Each action can define:

- required key or not;
- retention;
- response replay mode;
- conflict policy;
- stale in-progress timeout;
- final failure replay policy;
- domain resource reference.

---

## 22. Error Semantics for Idempotency

Recommended error codes:

| Code | HTTP | Meaning |
|---|---:|---|
| `IDEMPOTENCY_KEY_REQUIRED` | 400 | Operation requires idempotency key |
| `IDEMPOTENCY_KEY_INVALID` | 400 | Key format invalid |
| `IDEMPOTENCY_KEY_CONFLICT` | 409 | Same key used with different request fingerprint |
| `IDEMPOTENCY_REQUEST_IN_PROGRESS` | 409 or 202 | Original request still processing |
| `IDEMPOTENCY_RECORD_EXPIRED` | 409/422 | Key existed but outside replay window |
| `IDEMPOTENCY_OUTCOME_UNKNOWN` | 500/202/409 | Server cannot safely determine prior outcome |
| `DUPLICATE_COMMAND` | 409/200 | Business intent already completed without same key |

Important distinction:

```text
IDEMPOTENCY_KEY_CONFLICT:
  caller reused same technical key incorrectly

DUPLICATE_COMMAND:
  business operation already done, possibly by another request/key
```

---

## 23. Security Considerations

Idempotency has security implications.

### 23.1 Key Guessability

Keys should be high entropy when client-generated. If attacker can guess keys, they might infer operations or cause conflicts.

### 23.2 Scope Isolation

Never let idempotency key alone identify record globally across tenants/users.

Bad:

```sql
UNIQUE(idempotency_key)
```

Better:

```sql
UNIQUE(tenant_id, client_id, idempotency_key)
```

### 23.3 PII in Stored Response

If storing full response body, consider:

- encryption at rest;
- retention;
- redaction;
- whether response includes sensitive data;
- access control for support tooling;
- audit access.

### 23.4 Replay Across Authorization Context

Same key should not allow user B to replay user A’s response.

Scope must include authorization boundary:

```text
tenant + client application + authenticated subject + action
```

For machine-to-machine integrations, include client ID and tenant.

---

## 24. Observability for Idempotency

Metrics:

```text
idempotency.started.count
idempotency.replayed.count
idempotency.conflict.count
idempotency.in_progress.count
idempotency.expired.count
idempotency.stale_in_progress.count
idempotency.outcome_unknown.count
idempotency.store.latency
idempotency.store.error.count
```

Log fields:

```json
{
  "event": "idempotency_replayed",
  "scope": "tenant:T1:payment:create",
  "keyHash": "sha256:...",
  "requestHash": "sha256:...",
  "originalResourceType": "PAYMENT",
  "originalResourceId": "PAY-123",
  "correlationId": "01J..."
}
```

Do not log raw key if it can be sensitive or used as bearer-like proof. Hash it.

Operational dashboards should answer:

- Are clients retrying too much?
- Is one client causing many conflicts?
- Are in-progress records becoming stale?
- Are response replay rates normal?
- Is idempotency store becoming a bottleneck?
- Are duplicate messages increasing after broker rebalance?

---

## 25. Testing Idempotency

Minimum tests:

### 25.1 Same Key Same Payload

```text
Given request with key K
When request succeeds
And same request retried with key K
Then side effect occurs once
And response is replayed/equivalent
```

### 25.2 Same Key Different Payload

```text
Given request with key K and payload A succeeds
When request with key K and payload B arrives
Then server returns IDEMPOTENCY_KEY_CONFLICT
And no new side effect occurs
```

### 25.3 Concurrent Duplicate

```text
Given two identical requests with key K arrive concurrently
Then only one business resource is created
And second receives replay/in-progress response
```

### 25.4 Timeout After Commit

Simulate:

```text
server commits but client times out before reading response
client retries same key
server returns original result
```

### 25.5 Crash After IN_PROGRESS

```text
insert IN_PROGRESS
crash before business effect
retry after stale timeout
operation can recover safely
```

### 25.6 Message Redelivery

```text
consumer processes message
commit business DB
crash before ack
broker redelivers
consumer skips duplicate effect
```

---

## 26. Anti-Patterns

### Anti-Pattern 1 — Retry Without Idempotency

```text
Timeout? Just retry 3 times.
```

This is dangerous for non-idempotent operations.

### Anti-Pattern 2 — New UUID Per Retry

```java
headers.put("Idempotency-Key", UUID.randomUUID().toString());
```

This makes every retry a new intent.

### Anti-Pattern 3 — Key Without Payload Hash

Same key reused with different payload silently returns old result.

### Anti-Pattern 4 — Redis-Only Idempotency for Critical DB Writes

If Redis and DB get out of sync, duplicate protection may fail.

Redis can be useful for low-risk dedup/cache, but critical business idempotency should usually be anchored in durable storage with transactional semantics.

### Anti-Pattern 5 — Idempotency Key Too Broad

```text
user-id as key
```

This blocks all future operations by same user.

### Anti-Pattern 6 — Idempotency Key Too Narrow

```text
timestamp millisecond only
```

Collision or wrong duplicate classification.

### Anti-Pattern 7 — Treating All Duplicate as Success

Some duplicates are safe replay. Some are conflicting commands. Some indicate client bug.

### Anti-Pattern 8 — Expiry Without Business Guard

After record expiry, duplicate operation creates second business effect.

### Anti-Pattern 9 — No Observability

If you cannot see duplicate/replay/conflict rates, idempotency bugs become silent.

### Anti-Pattern 10 — Idempotency as Infrastructure Only

Idempotency is domain-aware. A generic layer cannot know every operation’s semantic conflict rules.

---

## 27. Production Checklist

Use this checklist before releasing any retryable command.

### 27.1 API Contract

- [ ] Is idempotency required for this operation?
- [ ] Is the key sent in a documented header/body field?
- [ ] Is key format validated?
- [ ] Is missing key handled explicitly?
- [ ] Is payload mismatch rejected?
- [ ] Is in-progress duplicate behavior defined?
- [ ] Is expiry behavior defined?
- [ ] Are error codes stable?

### 27.2 Storage

- [ ] Is idempotency record durable enough?
- [ ] Is uniqueness enforced by DB constraint?
- [ ] Is scope included in uniqueness?
- [ ] Is request fingerprint stored?
- [ ] Is result/resource reference stored?
- [ ] Is retention policy defined?
- [ ] Is stale `IN_PROGRESS` handled?

### 27.3 Business Semantics

- [ ] Does the key represent business intent?
- [ ] Does duplicate retry differ from business conflict?
- [ ] Does the domain state machine allow duplicate-equivalent success?
- [ ] Does optimistic lock/version interact correctly?
- [ ] Are side effects only triggered once?

### 27.4 External Effects

- [ ] Does provider support idempotency key?
- [ ] Is the same provider key reused across retries?
- [ ] Is there reconciliation for unknown outcome?
- [ ] Are irreversible external operations not blindly retried?

### 27.5 Messaging/Batch

- [ ] Are message IDs stored or naturally deduped?
- [ ] Is ack/offset commit after business commit?
- [ ] Are duplicate messages safe?
- [ ] Can batch rerun skip completed items?

### 27.6 Observability

- [ ] Are replay/conflict/in-progress metrics emitted?
- [ ] Are idempotency logs structured?
- [ ] Are raw keys protected or hashed?
- [ ] Are support tools able to find original outcome?

---

## 28. Practical Design Heuristics

1. **Retry safety must be designed before retry is enabled.**
2. **The idempotency key should identify intent, not attempt.**
3. **A retry must reuse the same key.**
4. **A new business intent must use a new key.**
5. **Same key with different payload is a client bug, not a duplicate.**
6. **Critical idempotency belongs close to the business transaction.**
7. **Unique constraints are stronger than application-level checks.**
8. **External side effects need their own idempotency or reconciliation.**
9. **Message consumers must assume duplicate delivery.**
10. **Idempotency is incomplete without observability and expiry policy.**

---

## 29. Review Questions

1. Apa perbedaan idempotent, safe, dan retryable?
2. Kenapa retry tanpa idempotency bisa menyebabkan data corruption?
3. Apa yang harus terjadi jika idempotency key sama tetapi payload berbeda?
4. Apa bedanya duplicate retry dan business conflict?
5. Kenapa idempotency record sebaiknya satu transaction dengan business state?
6. Bagaimana cara menangani duplicate request saat original masih `IN_PROGRESS`?
7. Bagaimana idempotency diterapkan pada message consumer dengan at-least-once delivery?
8. Kenapa UUID baru per retry adalah bug?
9. Apa risiko menyimpan full response body untuk replay?
10. Bagaimana mendesain idempotency untuk external provider yang tidak mendukung idempotency key?

---

## 30. Key Takeaways

Idempotency adalah salah satu primitive reliability paling penting dalam distributed systems.

Tanpa idempotency:

```text
retry + timeout + unknown outcome = duplicate side effect risk
```

Dengan idempotency:

```text
same intent + same key + same payload = same business outcome
```

Engineer yang matang tidak bertanya:

> “Apakah kita perlu retry?”

Tetapi bertanya lebih dulu:

> “Apakah operasi ini aman jika attempt yang sama terjadi lebih dari sekali?”

Jika jawabannya belum jelas, retry belum boleh dianggap aman.

---

## 31. Referensi

- RFC 9110 — HTTP Semantics: https://www.rfc-editor.org/rfc/rfc9110.html
- Stripe API Reference — Idempotent Requests: https://docs.stripe.com/api/idempotent_requests
- Stripe Blog — Designing robust and predictable APIs with idempotency: https://stripe.com/blog/idempotency
- AWS EC2 Developer Guide — Ensuring idempotency in Amazon EC2 API requests: https://docs.aws.amazon.com/ec2/latest/devguide/ec2-api-idempotency.html
- AWS ECS API Reference — Ensuring idempotency: https://docs.aws.amazon.com/AmazonECS/latest/APIReference/ECS_Idempotency.html
- Microservices.io — Idempotent Consumer Pattern: https://microservices.io/patterns/communication-style/idempotent-consumer.html
- Microservices.io — Handling duplicate messages using the Idempotent Consumer pattern: https://microservices.io/post/microservices/patterns/2020/10/16/idempotent-consumer.html

---

# Status Seri

```text
Part 015 / 030 completed
Seri belum selesai.
```

Bagian berikutnya:

```text
Part 016 — Timeouts, Deadlines, and Cancellation
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 014 — Transaction Safety During Failure and Shutdown](./learn-java-reliability-part-014.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 016 — Timeouts, Deadlines, and Cancellation](./learn-java-reliability-part-016.md)
