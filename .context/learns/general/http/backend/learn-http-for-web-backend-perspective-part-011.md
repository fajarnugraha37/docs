# learn-http-for-web-backend-perspective-part-011.md

# Part 011 — Idempotency, Retries, and Exactly-Once Illusions

## Status Seri

- Series: `learn-http-for-web-backend-perspective`
- Part: `011 / 032`
- Topik: `Idempotency, Retries, and Exactly-Once Illusions`
- Fokus: bagaimana backend HTTP membuat operasi mutasi aman terhadap retry, timeout, duplicate submission, network uncertainty, gateway retry, dan partial failure.
- Seri belum selesai setelah part ini. Lanjut ke Part 012: `Conditional Requests and Optimistic Concurrency`.

---

## 0. Kenapa Part Ini Penting

Di backend production, banyak bug serius tidak muncul karena developer tidak tahu cara membuat endpoint.
Bug muncul karena developer mengasumsikan hal-hal yang tidak benar tentang network:

1. Request pasti diterima sekali.
2. Handler pasti dieksekusi sekali.
3. Response pasti diterima client.
4. Timeout berarti operasi gagal.
5. Retry selalu aman.
6. POST pasti tidak akan diulang.
7. Database commit dan HTTP response adalah satu kejadian atomik.
8. Gateway, load balancer, SDK, job worker, atau user tidak akan mengirim request duplicate.

Semua asumsi itu salah.

HTTP backend yang matang harus didesain dengan mental model berikut:

> Client tidak selalu tahu apakah operasi berhasil. Server tidak selalu tahu apakah client menerima response. Di antara keduanya ada network, proxy, timeout, retry policy, crash, duplicate request, dan partial failure.

Idempotency adalah teknik untuk membuat operasi tetap predictable ketika request yang sama dikirim lebih dari sekali.

Namun idempotency bukan magic.
Idempotency bukan exactly-once.
Idempotency bukan berarti tidak ada side effect.
Idempotency bukan berarti semua operasi aman di-retry tanpa desain.

Idempotency adalah kontrak bahwa **efek yang dimaksud terhadap server** dari beberapa request identik tidak lebih besar daripada efek dari satu request.

Dalam HTTP semantics modern, method seperti `GET`, `HEAD`, `OPTIONS`, `TRACE`, `PUT`, dan `DELETE` bersifat idempotent menurut semantics, sedangkan `POST` dan `PATCH` tidak otomatis idempotent. Tetapi dalam backend bisnis, operasi `POST` dan `PATCH` sering perlu dibuat retry-safe menggunakan pola seperti `Idempotency-Key`.

---

## 1. Target Mental Model

Setelah part ini, kamu harus bisa:

1. Membedakan HTTP method idempotency vs business operation idempotency.
2. Mendesain endpoint mutasi yang aman terhadap duplicate request.
3. Menjelaskan kenapa exactly-once biasanya ilusi dalam distributed systems.
4. Mendesain `Idempotency-Key` flow untuk `POST`.
5. Membuat deduplication store yang race-safe.
6. Menentukan kapan response lama harus di-replay.
7. Mendeteksi request replay dengan payload berbeda.
8. Memilih status code untuk idempotency conflict.
9. Mengintegrasikan idempotency dengan database transaction, outbox, message broker, dan downstream HTTP call.
10. Membuat failure matrix untuk kasus timeout, crash, retry, partial commit, dan concurrent duplicate.

---

## 2. Masalah Dasar: HTTP Response Bukan Commit Acknowledgement yang Sempurna

Misalkan client mengirim request:

```http
POST /payments HTTP/1.1
Content-Type: application/json

{
  "orderId": "ORD-1001",
  "amount": 250000,
  "currency": "IDR"
}
```

Server melakukan:

1. Validasi request.
2. Insert payment row.
3. Charge payment provider.
4. Update order status.
5. Commit transaction.
6. Return response `201 Created`.

Masalahnya, client bisa mengalami timeout pada titik mana pun:

```text
Client                Network/Proxy              Server
  | POST /payments         |                       |
  |----------------------->|---------------------->|
  |                        |                       | validate
  |                        |                       | create payment
  |                        |                       | charge provider
  |                        |                       | commit
  |                        |        response       |
  |      timeout           |<----------------------|
  | ???                    |                       |
```

Dari sisi client:

> Request timeout. Apakah payment berhasil?

Jawaban yang jujur:

> Tidak diketahui.

Timeout bukan bukti gagal.
Timeout hanya berarti client tidak menerima response dalam batas waktu.

Jika client mengirim ulang request tanpa idempotency, server mungkin membuat payment kedua.

---

## 3. Definisi Idempotency

Secara konseptual:

> Operasi idempotent adalah operasi yang jika dijalankan satu kali atau berkali-kali dengan input identik, efek akhirnya terhadap server tetap sama.

Contoh sederhana:

```http
PUT /users/42/email
Content-Type: application/json

{
  "email": "alice@example.com"
}
```

Jika request ini dikirim 1 kali, email user menjadi `alice@example.com`.
Jika dikirim 10 kali, email user tetap `alice@example.com`.

Efek akhirnya sama.

Bandingkan dengan:

```http
POST /users/42/email-changes
Content-Type: application/json

{
  "email": "alice@example.com"
}
```

Jika request ini membuat record perubahan baru setiap kali, maka 10 request akan membuat 10 records.
Itu tidak idempotent kecuali server menambahkan mekanisme deduplication.

---

## 4. HTTP Method Idempotency vs Business Idempotency

Ini perbedaan yang sangat penting.

### 4.1 HTTP Method Idempotency

HTTP method memiliki semantics standar.

| Method | Safe | Idempotent | Catatan |
|---|---:|---:|---|
| `GET` | Ya | Ya | Mengambil representation; tidak boleh dimaksudkan untuk mutasi. |
| `HEAD` | Ya | Ya | Seperti GET tanpa body. |
| `OPTIONS` | Ya | Ya | Capability discovery. |
| `TRACE` | Ya | Ya | Biasanya disabled untuk security. |
| `PUT` | Tidak | Ya | Replace/set resource state. |
| `DELETE` | Tidak | Ya | Delete/cancel/remove resource state. |
| `POST` | Tidak | Tidak otomatis | Process request; biasanya create/command. |
| `PATCH` | Tidak | Tidak otomatis | Partial modification; bisa idempotent atau tidak tergantung patch document. |

`PUT` idempotent bukan berarti tidak punya side effect. `PUT` bisa menulis database, menerbitkan event, mengubah cache, atau memicu indexing. Yang penting, efek yang dimaksud dari request identik tidak bertambah setelah request pertama.

### 4.2 Business Operation Idempotency

Business idempotency adalah apakah operasi domain aman terhadap retry.

Contoh:

```http
POST /payments
Idempotency-Key: "pay-req-123"
```

Secara HTTP, `POST` tidak otomatis idempotent.
Namun secara business, server bisa membuatnya idempotent dengan menyimpan key dan mengembalikan hasil yang sama untuk retry.

### 4.3 Method Idempotent Tetapi Implementasi Bisa Rusak

Endpoint berikut secara semantics harus idempotent:

```http
PUT /cases/CASE-1001/status

{
  "status": "UNDER_REVIEW"
}
```

Namun implementasi bisa membuatnya tidak idempotent jika setiap request melakukan:

1. Insert audit event duplicate tanpa deduplication.
2. Kirim email notification setiap kali.
3. Memanggil downstream billing setiap kali.
4. Increment counter.

Pertanyaan penting:

> Apakah side effect tambahan itu bagian dari efek yang dimaksud, atau hanya efek observability/operational?

Audit log boleh mencatat setiap request attempt, tetapi domain event seperti `CaseMovedToUnderReview` seharusnya hanya muncul ketika state benar-benar berubah.

---

## 5. Retry: Siapa yang Bisa Mengulang Request?

Jangan hanya membayangkan user menekan tombol dua kali.

Dalam production, request bisa diulang oleh banyak pihak:

1. Browser/user double click.
2. Mobile app retry after timeout.
3. Frontend library retry.
4. Backend SDK retry.
5. API gateway retry ke upstream lain.
6. Load balancer retry setelah connection reset.
7. Service mesh retry.
8. Message consumer retry.
9. Batch job retry.
10. Cron job retry.
11. Operator manual replay.
12. Queue redelivery.
13. Payment provider webhook retry.
14. Network intermediary after transient failure.

Backend harus mengasumsikan:

> Duplicate request bukan edge case. Duplicate request adalah normal failure mode.

---

## 6. Exactly-Once Illusion

Banyak engineer mencari exactly-once.
Di distributed systems, exactly-once end-to-end biasanya bukan properti yang bisa dijamin secara sederhana.

Yang bisa kita desain biasanya adalah kombinasi dari:

1. At-least-once delivery.
2. Idempotent processing.
3. Deduplication.
4. Transactional state transition.
5. Outbox/inbox pattern.
6. Unique constraints.
7. Monotonic state machine.
8. Retry-safe side effects.

### 6.1 Kenapa Exactly-Once Sulit

Operasi HTTP mutasi minimal melibatkan:

1. Client mengirim request.
2. Server menerima bytes.
3. Server parse request.
4. Server menjalankan domain logic.
5. Server commit database.
6. Server memanggil downstream.
7. Server menulis event/outbox.
8. Server mengirim response.
9. Client menerima response.

Tidak ada satu transaction manager global yang secara atomik menjamin semua titik itu terjadi tepat sekali dan diketahui semua pihak.

Bahkan jika database commit berhasil, response ke client bisa hilang.
Bahkan jika response terkirim, client process bisa crash sebelum mencatatnya.
Bahkan jika message broker memberi exactly-once semantics pada level tertentu, side effect eksternal seperti email, payment, atau HTTP call lain tetap harus dipikirkan.

### 6.2 Framing yang Lebih Realistis

Daripada bertanya:

> Bagaimana membuat exactly-once?

Tanya:

> Jika operasi ini diproses lebih dari sekali, bagaimana kita memastikan efek domain yang tidak boleh duplicate tetap tidak duplicate?

Itulah mindset idempotency.

---

## 7. Taxonomy Operasi Mutasi

Tidak semua mutasi sama.

### 7.1 Set State Operation

Contoh:

```http
PUT /cases/CASE-1001/assignee

{
  "assigneeId": "USR-9"
}
```

Efek yang dimaksud: assignee menjadi `USR-9`.
Ini natural idempotent.

### 7.2 Create With Client-Chosen ID

Contoh:

```http
PUT /cases/CASE-1001/evidence/EV-5001

{
  "filename": "inspection-report.pdf"
}
```

Jika client memilih ID resource, `PUT` bisa idempotent.
Retry dengan ID sama tidak membuat evidence kedua.

### 7.3 Create With Server-Chosen ID

Contoh:

```http
POST /cases/CASE-1001/evidence

{
  "filename": "inspection-report.pdf"
}
```

Server memilih evidence ID.
Retry bisa membuat duplicate evidence.
Butuh idempotency key atau natural unique constraint.

### 7.4 Append Event

Contoh:

```http
POST /cases/CASE-1001/comments

{
  "text": "Need additional verification."
}
```

Append biasanya non-idempotent.
Jika retry, comment bisa duplicate.
Butuh client-generated comment ID atau idempotency key.

### 7.5 Command Operation

Contoh:

```http
POST /cases/CASE-1001/submit-for-review
```

Command bisa dibuat idempotent jika state machine mendukung.
Jika case sudah submitted, retry bisa mengembalikan state submitted yang sama.

### 7.6 External Side Effect Operation

Contoh:

```http
POST /payments
POST /emails
POST /webhooks/replay
POST /agency-notifications
```

Operasi ini paling berbahaya karena efeknya keluar dari database lokal.
Butuh desain idempotency eksplisit.

---

## 8. Idempotency-Key Pattern

Untuk operasi non-idempotent seperti `POST`, pola umum adalah meminta client mengirim key unik:

```http
POST /payments HTTP/1.1
Content-Type: application/json
Idempotency-Key: "8e03978e-40d5-43e8-bc93-6894a57f9324"

{
  "orderId": "ORD-1001",
  "amount": 250000,
  "currency": "IDR"
}
```

Server menyimpan key tersebut bersama status processing dan hasil operasi.
Jika request dengan key yang sama datang lagi, server tidak menjalankan operasi duplicate.

### 8.1 Kontrak Dasar

Untuk setiap idempotency key dalam scope tertentu:

1. Request pertama memulai operasi.
2. Server menyimpan key secara atomik.
3. Server mengaitkan key dengan fingerprint request.
4. Server memproses operasi.
5. Server menyimpan response/result.
6. Retry dengan key dan payload identik mendapatkan response yang konsisten.
7. Retry dengan key sama tapi payload berbeda ditolak.

### 8.2 Header vs Body

Idempotency key biasanya dikirim di header:

```http
Idempotency-Key: "uuid-or-client-generated-token"
```

Kenapa header?

1. Berlaku sebagai metadata request.
2. Bisa diproses middleware/filter sebelum body domain.
3. Tidak mengotori domain payload.
4. Lebih mudah dipakai lintas endpoint.
5. Bisa dilog secara terkontrol.

Namun body field juga bisa dipakai jika domain memang memiliki client request ID.
Contoh AWS-style API sering memakai `ClientToken` dalam request body untuk idempotent operations.

---

## 9. Scope Idempotency Key

Idempotency key tidak boleh global tanpa berpikir.
Scope menentukan collision domain.

Kemungkinan scope:

1. Per tenant.
2. Per authenticated principal.
3. Per endpoint/operation.
4. Per resource.
5. Per business aggregate.
6. Global per service.

Contoh recommended scope:

```text
tenant_id + operation_name + idempotency_key
```

Atau:

```text
tenant_id + actor_id + method + route_template + idempotency_key
```

Jangan hanya pakai raw key global jika:

1. Multi-tenant system.
2. Client berbeda bisa generate key sama.
3. Key pendek atau tidak cryptographically random.
4. Ada risiko user A melihat replay response user B.

### 9.1 Scope Example

Misalnya dua tenant mengirim key sama:

```text
Tenant A: Idempotency-Key = "create-case-1"
Tenant B: Idempotency-Key = "create-case-1"
```

Jika key global, request tenant B bisa dianggap duplicate tenant A.
Itu data isolation bug.

Dengan scope:

```text
(A, create-case, create-case-1)
(B, create-case, create-case-1)
```

Mereka berbeda.

---

## 10. Request Fingerprint

Idempotency key saja tidak cukup.

Client bisa melakukan bug:

Request pertama:

```http
POST /payments
Idempotency-Key: "abc"

{
  "orderId": "ORD-1001",
  "amount": 250000
}
```

Request kedua:

```http
POST /payments
Idempotency-Key: "abc"

{
  "orderId": "ORD-1001",
  "amount": 300000
}
```

Apa yang harus dilakukan server?

Server tidak boleh diam-diam mengembalikan hasil request pertama untuk payload berbeda.
Itu akan menyembunyikan bug serius.

Server harus menyimpan fingerprint request pertama dan membandingkan retry.

Fingerprint bisa meliputi:

1. HTTP method.
2. Route template atau operation name.
3. Canonical request body.
4. Relevant query parameters.
5. Relevant content type.
6. Tenant/principal scope.
7. Domain operation version.

### 10.1 Fingerprint Jangan Naif

Jangan hash raw body tanpa memahami canonicalization.

Dua JSON berikut semantically sama tapi raw bytes berbeda:

```json
{"amount":250000,"currency":"IDR"}
```

```json
{
  "currency": "IDR",
  "amount": 250000
}
```

Pilihan:

1. Hash canonical JSON.
2. Hash normalized DTO setelah parsing.
3. Hash selected semantic fields.
4. Reject retry jika raw body beda, tetapi dokumentasikan behavior.

Untuk sistem serius, gunakan semantic fingerprint dari normalized request DTO.

---

## 11. Idempotency Store State Machine

Idempotency record sebaiknya punya state machine eksplisit.

```text
ABSENT
  -> IN_PROGRESS
  -> COMPLETED
  -> FAILED_RETRYABLE
  -> FAILED_FINAL
  -> EXPIRED
```

Minimal table:

```sql
CREATE TABLE idempotency_record (
    scope_key           VARCHAR(300) PRIMARY KEY,
    operation_name      VARCHAR(100) NOT NULL,
    tenant_id           VARCHAR(100) NOT NULL,
    actor_id            VARCHAR(100),
    idempotency_key     VARCHAR(200) NOT NULL,
    request_fingerprint VARCHAR(128) NOT NULL,
    status              VARCHAR(30) NOT NULL,
    http_status         INT,
    response_body       TEXT,
    response_headers    TEXT,
    resource_type       VARCHAR(100),
    resource_id         VARCHAR(100),
    error_code          VARCHAR(100),
    locked_until        TIMESTAMP,
    created_at          TIMESTAMP NOT NULL,
    updated_at          TIMESTAMP NOT NULL,
    expires_at          TIMESTAMP NOT NULL
);
```

### 11.1 State: ABSENT

Belum ada record untuk key.
Request pertama boleh mencoba acquire.

### 11.2 State: IN_PROGRESS

Request sedang diproses.
Jika duplicate datang bersamaan, pilihan response:

1. Return `409 Conflict` dengan pesan operation in progress.
2. Return `425 Too Early` jarang dipakai dan konteksnya spesifik.
3. Block/wait sebentar lalu replay result jika selesai.
4. Return `202 Accepted` jika operasi async.

Untuk kebanyakan API synchronous, `409 Conflict` atau short wait + replay adalah pilihan praktis.

### 11.3 State: COMPLETED

Operasi berhasil selesai.
Retry harus mengembalikan response yang sama atau equivalent.

### 11.4 State: FAILED_RETRYABLE

Operasi gagal sebelum side effect final.
Retry boleh memproses ulang.
Harus hati-hati membedakan gagal sebelum commit vs gagal setelah commit.

### 11.5 State: FAILED_FINAL

Operasi gagal validasi/domain/security dan tidak boleh diproses ulang kecuali request berubah.
Retry dengan key sama bisa mengembalikan error yang sama.

### 11.6 State: EXPIRED

Record sudah melewati retention window.
Request dengan key lama bisa dianggap request baru atau ditolak, tergantung kontrak.

---

## 12. Atomic Acquire: Bagian Paling Penting

Idempotency store harus race-safe.

Dua duplicate request bisa masuk bersamaan:

```text
Request A checks key -> not found
Request B checks key -> not found
Request A creates payment
Request B creates payment
```

Ini bug.

Jangan implementasi:

```java
if (!idempotencyRepository.exists(scopeKey)) {
    processBusinessOperation();
    idempotencyRepository.save(record);
}
```

Itu race condition.

Gunakan atomic insert dengan unique constraint:

```sql
INSERT INTO idempotency_record (
    scope_key,
    operation_name,
    tenant_id,
    idempotency_key,
    request_fingerprint,
    status,
    created_at,
    updated_at,
    expires_at
) VALUES (?, ?, ?, ?, ?, 'IN_PROGRESS', now(), now(), ?)
ON CONFLICT (scope_key) DO NOTHING;
```

Jika insert berhasil, request ini owner pertama.
Jika insert gagal, request ini duplicate dan harus membaca existing record.

### 12.1 Pseudocode

```java
IdempotencyDecision decision = idempotencyService.tryAcquire(
    scope,
    key,
    fingerprint,
    operation
);

switch (decision.type()) {
    case ACQUIRED -> {
        try {
            OperationResult result = businessOperation.execute();
            idempotencyService.markCompleted(scope, key, result);
            return result.toResponse();
        } catch (FinalBusinessException e) {
            idempotencyService.markFailedFinal(scope, key, e.toProblem());
            throw e;
        } catch (Exception e) {
            idempotencyService.markUnknownOrRetryable(scope, key, e);
            throw e;
        }
    }
    case REPLAY_COMPLETED -> {
        return decision.savedResponse();
    }
    case IN_PROGRESS -> {
        throw new OperationInProgressException();
    }
    case FINGERPRINT_MISMATCH -> {
        throw new IdempotencyConflictException();
    }
    case EXPIRED -> {
        throw new IdempotencyKeyExpiredException();
    }
}
```

---

## 13. Response Replay

Jika request pertama berhasil:

```http
HTTP/1.1 201 Created
Location: /payments/PAY-9001
Content-Type: application/json

{
  "paymentId": "PAY-9001",
  "status": "AUTHORIZED"
}
```

Retry dengan key sama idealnya mendapat response yang sama:

```http
HTTP/1.1 201 Created
Location: /payments/PAY-9001
Content-Type: application/json
Idempotency-Replayed: true

{
  "paymentId": "PAY-9001",
  "status": "AUTHORIZED"
}
```

Header `Idempotency-Replayed` bukan standar umum, tetapi bisa berguna sebagai internal/API convention.
Dokumentasikan jika dipakai.

### 13.1 Replay Response Apa yang Disimpan?

Pilihan:

1. Simpan full HTTP response.
2. Simpan resource reference lalu regenerate response.
3. Simpan operation result minimal.

#### Full Response Replay

Kelebihan:

- Paling konsisten untuk client.
- Cocok untuk payment atau operasi sensitif.

Kekurangan:

- Perlu storage lebih besar.
- Hati-hati PII/sensitive data.
- Response schema versioning bisa tricky.

#### Resource Reference Replay

Contoh simpan:

```text
resource_type = PAYMENT
resource_id = PAY-9001
```

Saat retry, server fetch resource terbaru dan return representation.

Kelebihan:

- Storage kecil.
- Response mengikuti state terbaru.

Kekurangan:

- Bisa berbeda dari response awal.
- Jika resource berubah setelah operasi, client mendapat informasi berbeda.

#### Operation Result Minimal

Simpan status, ID resource, error code, timestamp.

Cocok untuk operasi workflow.

---

## 14. Apakah Error Harus Di-Replay?

Tidak semua error sama.

### 14.1 Validation Error

Request invalid:

```http
POST /payments
Idempotency-Key: "abc"

{
  "amount": -1
}
```

Pilihan:

1. Tidak simpan idempotency record karena operasi tidak dimulai.
2. Simpan failed final agar retry mendapat error yang sama.

Banyak sistem memilih tidak menyimpan untuk validation error sebelum execution.
Tapi jika client retry dengan key sama dan payload diperbaiki, apakah boleh?

Harus dokumentasikan.

Rekomendasi praktis:

- Untuk error sebelum idempotency acquire seperti missing auth, unsupported media type, malformed JSON: tidak perlu simpan.
- Untuk error setelah key valid dan request parsed: bisa simpan `FAILED_FINAL` jika ingin replay konsisten.

### 14.2 Transient Error

Jika downstream timeout sebelum diketahui sukses/gagal, jangan sembarangan mark failed retryable.
Bisa jadi downstream berhasil.

Untuk side effect eksternal, gunakan downstream idempotency key juga.

### 14.3 Server Error Setelah Commit

Ini kasus penting:

```text
DB commit success
Response serialization fails
Client receives 500
Client retries
```

Jika idempotency record belum completed, retry bisa memproses ulang.

Solusi:

1. Commit business result dan idempotency result dalam transaction yang sama jika memungkinkan.
2. Simpan resource reference sebelum response serialization.
3. Mark completed berdasarkan business commit, bukan berdasarkan response successfully written.

---

## 15. Failure Matrix

### 15.1 Request Tidak Sampai Server

```text
Client sends request
Network fails before server receives
```

Server state: unchanged.
Client state: unknown.
Retry aman jika operation idempotent atau punya key.

### 15.2 Server Menerima Request, Gagal Sebelum Commit

```text
Server validates
Business operation starts
Exception before commit
```

Server state: likely unchanged, tergantung side effects.
Retry aman hanya jika tidak ada external side effect atau side effect idempotent.

### 15.3 Commit Berhasil, Response Hilang

```text
Server commit success
Network drops response
Client timeout
```

Server state: changed.
Client state: unknown.
Retry tanpa idempotency berbahaya.
Retry dengan key harus replay success.

### 15.4 Commit Berhasil, Idempotency Record Gagal Disimpan

```text
Business commit success
Idempotency update fails
```

Ini desain buruk jika keduanya bisa dipisah.

Solusi:

- Simpan idempotency record dan business change dalam DB transaction yang sama.
- Jika external store terpisah, gunakan recovery job dan natural unique constraint.

### 15.5 Concurrent Duplicate

```text
Request A and B arrive same time with same key
```

Harus ada atomic acquire.

### 15.6 Same Key Different Payload

Harus reject dengan idempotency conflict.

### 15.7 Key Expired Then Retried

Harus sesuai dokumentasi:

1. Treat as new request.
2. Reject expired key.
3. Require client to query resource state.

Untuk payment-like operation, lebih aman reject expired duplicate jika bisa dideteksi, tetapi setelah data dihapus dari dedup store server mungkin tidak bisa tahu.

---

## 16. Status Code Design untuk Idempotency

Tidak ada satu status code universal untuk semua kasus, tetapi pola berikut berguna.

| Situasi | Status umum | Catatan |
|---|---:|---|
| First request accepted and completed create | `201 Created` | Simpan/replay response. |
| Retry completed create | `201 Created` atau `200 OK` | Banyak API replay response asli. |
| Retry completed command | `200 OK` / `204 No Content` | Tergantung response awal. |
| Duplicate sedang diproses | `409 Conflict` | Bisa disertai problem detail. |
| Same key different payload | `409 Conflict` atau `422 Unprocessable Content` | `409` lebih jelas sebagai key conflict. |
| Missing required idempotency key untuk operation sensitif | `400 Bad Request` atau `428 Precondition Required` | `428` cocok jika API mewajibkan precondition-like behavior, tapi tidak semua client familiar. |
| Key expired | `409 Conflict` atau `400 Bad Request` | Dokumentasikan. |
| Validation error | `400` / `422` | Tergantung validation taxonomy dari Part 010. |
| Accepted async operation | `202 Accepted` | Return operation status URI. |

Contoh Problem Details untuk key conflict:

```http
HTTP/1.1 409 Conflict
Content-Type: application/problem+json

{
  "type": "https://api.example.com/problems/idempotency-key-conflict",
  "title": "Idempotency key conflict",
  "status": 409,
  "detail": "The provided Idempotency-Key was already used with a different request payload.",
  "code": "IDEMPOTENCY_KEY_CONFLICT",
  "instance": "/problems/req-7f4c"
}
```

---

## 17. Retention Window dan Expiry

Idempotency record tidak bisa disimpan selamanya tanpa biaya.
Tentukan retention window.

Contoh:

1. Payment: 24 jam sampai beberapa hari.
2. Case submission: beberapa hari atau permanen via business unique key.
3. Evidence upload: sampai upload finalized.
4. Webhook ingestion: sesuai retry window provider.
5. Internal command: sesuai job retry policy.

Pertimbangan retention:

1. Maksimum durasi client retry.
2. Gateway retry window.
3. Mobile offline retry behavior.
4. Regulatory/audit requirement.
5. Storage cost.
6. PII retention policy.
7. Key collision risk.

Jika key expired, dokumentasikan:

```text
Idempotency keys are retained for 48 hours. Reusing a key after expiry may be treated as a new request.
```

Untuk operasi yang tidak boleh duplicate bahkan setelah window habis, jangan hanya mengandalkan idempotency key. Gunakan natural uniqueness/business invariant.

---

## 18. Idempotency dan Database Transaction

### 18.1 Ideal Case: Satu Database

Jika business data dan idempotency record berada di database yang sama, gunakan transaction:

```text
BEGIN
  insert idempotency IN_PROGRESS
  perform business mutation
  update idempotency COMPLETED with result/resource id
COMMIT
```

Namun perlu atomic acquire sebelum business mutation.
Biasanya:

1. Insert `IN_PROGRESS` dengan unique constraint.
2. Jika berhasil, lanjut dalam transaction.
3. Jika gagal, baca existing record.

### 18.2 Problem: Long Processing

Jangan tahan transaction terbuka selama call eksternal yang lama.

Buruk:

```text
BEGIN DB TRANSACTION
  insert idempotency
  call payment provider 10 seconds
  update DB
COMMIT
```

Risiko:

1. Lock terlalu lama.
2. Connection pool habis.
3. Transaction timeout.
4. Deadlock meningkat.

Alternatif:

1. Insert idempotency `IN_PROGRESS` cepat.
2. Create local operation record.
3. Commit.
4. Process external side effect via workflow/outbox.
5. Update operation result.
6. Replay based on operation record.

### 18.3 Unique Constraint sebagai Guard Terakhir

Idempotency store penting, tapi domain uniqueness tetap harus menjaga invariant.

Contoh payment:

```sql
CREATE UNIQUE INDEX ux_payment_order_intent
ON payment (tenant_id, order_id, payment_intent_type)
WHERE status IN ('PENDING', 'AUTHORIZED', 'CAPTURED');
```

Jika idempotency layer gagal, database masih mencegah duplicate payment intent untuk order yang sama.

---

## 19. Idempotency dan Outbox Pattern

Banyak operasi HTTP tidak hanya update database, tetapi juga publish event:

```text
POST /cases/CASE-1001/submit
  -> update case status
  -> publish CaseSubmitted event
  -> notify reviewer
```

Jika update DB berhasil tapi event publish gagal, sistem inconsistent.

Outbox pattern:

1. Dalam DB transaction yang sama:
   - update aggregate
   - insert outbox event
   - update idempotency record
2. Background publisher membaca outbox.
3. Publisher mengirim event at-least-once.
4. Consumer harus idempotent.

```sql
BEGIN;

UPDATE cases
SET status = 'SUBMITTED', version = version + 1
WHERE case_id = 'CASE-1001' AND status = 'DRAFT';

INSERT INTO outbox_event(event_id, aggregate_id, event_type, payload, created_at)
VALUES ('EVT-123', 'CASE-1001', 'CaseSubmitted', '{...}', now());

UPDATE idempotency_record
SET status = 'COMPLETED', resource_id = 'CASE-1001', http_status = 200
WHERE scope_key = ?;

COMMIT;
```

Outbox does not remove duplicates by itself.
It shifts the problem to at-least-once event delivery + idempotent consumers.

---

## 20. Idempotency and Downstream HTTP Calls

Jika service A menerima idempotent request lalu memanggil service B, A harus memikirkan downstream idempotency.

```text
Client -> Service A: POST /payments Idempotency-Key: abc
Service A -> Payment Provider: POST /charges ???
```

Jika Service A retry ke provider tanpa provider idempotency key, duplicate charge bisa terjadi.

Strategi:

1. Propagate same idempotency key dengan scope yang aman.
2. Generate downstream idempotency key derived dari upstream operation ID.
3. Store downstream request ID locally.
4. Use provider's idempotency mechanism.
5. Query provider by business reference after unknown timeout.

Jangan propagate raw user key ke semua downstream tanpa scope, karena:

1. Key bisa collision antar operation.
2. Downstream semantics berbeda.
3. Security/logging exposure.
4. Tenant boundary bisa kabur.

Lebih baik:

```text
upstream_key = client supplied UUID
operation_id = internal payment_intent_id
provider_idempotency_key = "payment-intent:" + operation_id
```

---

## 21. Webhooks: Idempotency dari Arah Sebaliknya

Webhook provider sering mengirim event berulang sampai menerima success response.
Backend receiver harus idempotent.

Contoh:

```http
POST /webhooks/payment-provider
X-Provider-Event-Id: evt_123

{
  "type": "payment.authorized",
  "paymentId": "PAY-9001"
}
```

Receiver harus:

1. Verify signature.
2. Extract event ID.
3. Insert event ID ke inbox table dengan unique constraint.
4. Jika duplicate, return success tanpa proses ulang side effect.
5. Process event idempotently.

Inbox table:

```sql
CREATE TABLE webhook_inbox (
    provider          VARCHAR(100) NOT NULL,
    event_id          VARCHAR(200) NOT NULL,
    payload_hash      VARCHAR(128) NOT NULL,
    status            VARCHAR(30) NOT NULL,
    received_at       TIMESTAMP NOT NULL,
    processed_at      TIMESTAMP,
    PRIMARY KEY (provider, event_id)
);
```

Webhook receiver biasanya harus mengembalikan `2xx` untuk duplicate yang sudah diproses, agar provider berhenti retry.

---

## 22. Idempotency for Workflow/State Machine Systems

Dalam sistem regulatory/case management, banyak endpoint adalah transition:

```http
POST /cases/CASE-1001/submit
POST /cases/CASE-1001/assign
POST /cases/CASE-1001/escalate
POST /cases/CASE-1001/approve
POST /cases/CASE-1001/reopen
```

Idempotency bisa muncul dari state machine.

### 22.1 Command Already Applied

Jika request:

```http
POST /cases/CASE-1001/submit
Idempotency-Key: "submit-1"
```

Pertama kali:

```text
DRAFT -> SUBMITTED
```

Retry:

```text
SUBMITTED -> SUBMITTED
```

Server bisa return success yang sama.

### 22.2 Same Command Without Key

Jika case sudah `SUBMITTED`, lalu request submit datang lagi tanpa key:

Pilihan:

1. Return `409 Conflict` because transition invalid from current state.
2. Return `200 OK` because desired state already achieved.

Mana yang benar?

Tergantung domain semantics.

Jika command `submit` berarti “perform submission action once, generating submission timestamp and audit event”, duplicate tanpa key sebaiknya conflict.

Jika command berarti “ensure case is submitted”, bisa idempotent.

Naming membantu:

```http
PUT /cases/CASE-1001/state
{ "status": "SUBMITTED" }
```

lebih idempotent daripada:

```http
POST /cases/CASE-1001/submit
```

### 22.3 Transition ID

Untuk workflow penting, gunakan transition ID:

```http
POST /cases/CASE-1001/transitions
Idempotency-Key: "transition-uuid-1"

{
  "transitionType": "SUBMIT",
  "reason": "All required evidence uploaded"
}
```

Server membuat transition record unik.

---

## 23. Idempotency and Audit Logs

Audit log sering menyebabkan kebingungan.

Pertanyaan:

> Jika request duplicate datang, apakah audit log harus mencatat duplicate?

Jawaban: tergantung jenis audit.

Pisahkan:

1. Request audit / access log.
2. Security audit.
3. Domain audit.
4. State transition audit.

Duplicate request boleh muncul di access log:

```text
request received key=abc replay=true
```

Tetapi domain audit seperti:

```text
CaseSubmitted by user U at time T
```

seharusnya tidak duplicate jika transition hanya terjadi sekali.

Praktik baik:

1. Setiap request punya `request_id`.
2. Setiap idempotent operation punya `operation_id`.
3. Setiap domain transition punya `transition_id`.
4. Audit domain merujuk operation/transition, bukan raw HTTP attempt.

---

## 24. Idempotency and Observability

Tambahkan metric:

1. `idempotency.acquire.success`
2. `idempotency.acquire.conflict`
3. `idempotency.replay.completed`
4. `idempotency.in_progress`
5. `idempotency.fingerprint_mismatch`
6. `idempotency.expired`
7. `idempotency.store.error`
8. `duplicate_request.rate`

Log fields:

```json
{
  "requestId": "req-123",
  "traceId": "trace-abc",
  "tenantId": "tenant-1",
  "operation": "createPayment",
  "idempotencyKeyHash": "sha256:...",
  "idempotencyDecision": "REPLAY_COMPLETED",
  "resourceId": "PAY-9001"
}
```

Jangan log raw idempotency key jika key bisa dianggap secret atau user-provided sensitive token.
Hash cukup.

---

## 25. Security Considerations

### 25.1 Key Guessing

Jika idempotency key mudah ditebak dan scope buruk, attacker bisa mencoba replay response orang lain.

Mitigasi:

1. Scope by tenant/user.
2. Require authentication before idempotency lookup.
3. Do not expose cross-user replay.
4. Use high-entropy keys.
5. Hash key at rest if needed.

### 25.2 Resource Exhaustion

Attacker bisa mengirim banyak unique idempotency keys untuk memenuhi store.

Mitigasi:

1. Rate limit.
2. Quota per tenant/user.
3. Retention TTL.
4. Reject keys too long.
5. Validate key syntax.
6. Do not create record before auth.
7. Do not create record for malformed requests.

### 25.3 Payload Mismatch Abuse

Same key different payload harus ditolak.
Jangan overwrite fingerprint.

### 25.4 Idempotency Store as PII Store

Jika menyimpan response body, bisa menyimpan PII.
Pertimbangkan:

1. Encryption at rest.
2. Field minimization.
3. Redaction.
4. TTL.
5. Access control.
6. Audit access.

---

## 26. Java/Spring MVC Implementation Sketch

### 26.1 Annotation

```java
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface IdempotentOperation {
    String name();
    boolean required() default true;
}
```

### 26.2 Filter or Interceptor?

Idempotency needs request body fingerprint.
For Spring MVC, body can usually be read once. If you compute fingerprint in filter, you need caching wrapper.

Better options:

1. Implement at controller/service boundary after DTO binding.
2. Use `RequestBodyAdvice` carefully.
3. Require command DTO implements fingerprint method.
4. Avoid global body-reading filter unless necessary.

### 26.3 Controller Example

```java
@RestController
@RequestMapping("/payments")
class PaymentController {

    private final IdempotencyExecutor idempotencyExecutor;
    private final PaymentApplicationService paymentService;

    @PostMapping
    ResponseEntity<PaymentResponse> createPayment(
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @Valid @RequestBody CreatePaymentRequest request,
            Authentication authentication
    ) {
        TenantId tenantId = currentTenant(authentication);
        ActorId actorId = currentActor(authentication);

        IdempotencyScope scope = IdempotencyScope.of(
                tenantId,
                actorId,
                "createPayment",
                idempotencyKey
        );

        RequestFingerprint fingerprint = RequestFingerprint.fromCanonical(request);

        return idempotencyExecutor.execute(
                scope,
                fingerprint,
                () -> {
                    PaymentResult result = paymentService.createPayment(request, tenantId, actorId);
                    URI location = URI.create("/payments/" + result.paymentId());
                    return ResponseEntity
                            .created(location)
                            .body(PaymentResponse.from(result));
                }
        );
    }
}
```

### 26.4 Executor Sketch

```java
public class IdempotencyExecutor {

    private final IdempotencyRepository repository;
    private final TransactionTemplate transactionTemplate;

    public <T> ResponseEntity<T> execute(
            IdempotencyScope scope,
            RequestFingerprint fingerprint,
            Supplier<ResponseEntity<T>> operation
    ) {
        IdempotencyRecord record = repository.tryInsertInProgress(scope, fingerprint);

        if (record.inserted()) {
            return executeAsOwner(scope, fingerprint, operation);
        }

        IdempotencyRecord existing = repository.findForUpdateOrRead(scope);

        if (!existing.fingerprint().equals(fingerprint)) {
            throw new IdempotencyKeyConflictException();
        }

        if (existing.status() == IdempotencyStatus.COMPLETED) {
            return existing.replayResponse();
        }

        if (existing.status() == IdempotencyStatus.IN_PROGRESS) {
            throw new OperationInProgressException();
        }

        if (existing.status() == IdempotencyStatus.FAILED_FINAL) {
            throw existing.replayProblem();
        }

        throw new IdempotencyStateException(existing.status());
    }

    private <T> ResponseEntity<T> executeAsOwner(
            IdempotencyScope scope,
            RequestFingerprint fingerprint,
            Supplier<ResponseEntity<T>> operation
    ) {
        try {
            ResponseEntity<T> response = operation.get();
            repository.markCompleted(scope, response);
            return response;
        } catch (BusinessFinalException e) {
            repository.markFailedFinal(scope, e.toProblemDetail());
            throw e;
        } catch (RuntimeException e) {
            repository.markFailedUnknown(scope, e);
            throw e;
        }
    }
}
```

This sketch is intentionally incomplete. Production implementation must decide transaction boundaries, serialization of replay response, error mapping, locking, TTL, and race behavior.

---

## 27. WebFlux Considerations

In WebFlux, avoid blocking idempotency store calls on event loop.

Bad:

```java
public Mono<ServerResponse> create(ServerRequest request) {
    IdempotencyRecord record = blockingRepository.find(...); // bad on event loop
    ...
}
```

Options:

1. Use reactive database driver.
2. Offload blocking repository to bounded elastic scheduler.
3. Keep operation fully non-blocking.
4. Be careful with body consumption; body can be read once.
5. Generate fingerprint after decoding body into DTO.

Example shape:

```java
public Mono<ResponseEntity<PaymentResponse>> createPayment(
        String idempotencyKey,
        Mono<CreatePaymentRequest> requestMono
) {
    return requestMono.flatMap(request -> {
        IdempotencyScope scope = buildScope(idempotencyKey);
        RequestFingerprint fingerprint = RequestFingerprint.fromCanonical(request);

        return idempotencyService.execute(scope, fingerprint,
                () -> paymentService.createPayment(request)
                        .map(result -> ResponseEntity
                                .created(URI.create("/payments/" + result.paymentId()))
                                .body(PaymentResponse.from(result)))
        );
    });
}
```

Reactive idempotency must also handle cancellation.
If client disconnects after operation starts, server may still complete mutation.
The idempotency record should reflect operation outcome, not client connection state.

---

## 28. Async Operation Pattern

For long-running operation, avoid making client wait.

Request:

```http
POST /exports
Idempotency-Key: "export-2026-06-18-a"
Content-Type: application/json

{
  "caseStatus": "UNDER_REVIEW",
  "format": "CSV"
}
```

Response:

```http
HTTP/1.1 202 Accepted
Location: /operations/OP-7001
Content-Type: application/json

{
  "operationId": "OP-7001",
  "status": "ACCEPTED",
  "statusUrl": "/operations/OP-7001"
}
```

Retry with same key returns same operation:

```http
HTTP/1.1 202 Accepted
Location: /operations/OP-7001

{
  "operationId": "OP-7001",
  "status": "RUNNING",
  "statusUrl": "/operations/OP-7001"
}
```

For async operations, idempotency record usually maps key to operation ID, not final response body.

---

## 29. Design Decision Framework

When designing a mutating endpoint, ask:

### 29.1 What Kind of Operation Is This?

1. Set state?
2. Replace resource?
3. Create resource with client ID?
4. Create resource with server ID?
5. Append event?
6. Execute command?
7. Trigger external side effect?
8. Start async job?

### 29.2 What Happens on Duplicate?

1. Return same response?
2. Return current resource state?
3. Return conflict?
4. Return operation status?
5. Ignore duplicate?
6. Reject if payload mismatch?

### 29.3 What Is the Dedup Key?

1. HTTP idempotency key?
2. Client-generated resource ID?
3. Natural business key?
4. Provider event ID?
5. Operation/transition ID?

### 29.4 What Is the Storage Authority?

1. Idempotency table?
2. Domain table unique constraint?
3. Operation table?
4. Inbox/outbox table?
5. External provider?

### 29.5 What Are the Failure Windows?

1. Before idempotency record insert.
2. After record insert before business mutation.
3. After mutation before response.
4. After local commit before downstream side effect.
5. After downstream side effect before local record.
6. After response before client receives.

If you cannot answer these, endpoint is not production-ready.

---

## 30. Case Study: Regulatory Case Submission

### 30.1 Requirement

A respondent submits a compliance response for a regulatory case.
Submission must happen once.
Duplicate browser clicks or mobile retries must not create duplicate submissions.
If submission already succeeded but response was lost, retry should return the same submitted state.

Endpoint:

```http
POST /cases/CASE-1001/submissions
Idempotency-Key: "c1b442e0-1a52-4a82-b9d0-5c859bfeb3a8"
Content-Type: application/json

{
  "statement": "We have completed remediation.",
  "evidenceIds": ["EV-1", "EV-2"],
  "submittedBy": "RESPONDENT-9"
}
```

### 30.2 Domain Rules

1. Case must be in `AWAITING_RESPONSE`.
2. Actor must be authorized respondent.
3. Evidence must belong to case.
4. Submission creates one submission record.
5. Case state becomes `RESPONSE_SUBMITTED`.
6. Reviewer notification is emitted once.
7. Audit transition recorded once.

### 30.3 Tables

```sql
CREATE TABLE case_submission (
    submission_id VARCHAR(100) PRIMARY KEY,
    case_id       VARCHAR(100) NOT NULL,
    tenant_id     VARCHAR(100) NOT NULL,
    submitted_by  VARCHAR(100) NOT NULL,
    statement     TEXT NOT NULL,
    created_at    TIMESTAMP NOT NULL,
    UNIQUE (tenant_id, case_id)
);
```

The unique constraint ensures only one submission per case if domain requires that.

```sql
CREATE TABLE idempotency_record (
    scope_key VARCHAR(300) PRIMARY KEY,
    request_fingerprint VARCHAR(128) NOT NULL,
    status VARCHAR(30) NOT NULL,
    resource_id VARCHAR(100),
    http_status INT,
    response_body TEXT,
    created_at TIMESTAMP NOT NULL,
    expires_at TIMESTAMP NOT NULL
);
```

### 30.4 Processing Flow

```text
1. Authenticate actor.
2. Parse and validate request.
3. Build idempotency scope:
   tenant + actor + "submitCaseResponse" + key
4. Build semantic fingerprint.
5. Atomic insert idempotency IN_PROGRESS.
6. If duplicate:
   a. fingerprint mismatch -> 409
   b. completed -> replay response
   c. in progress -> 409 or 202
7. Execute domain transaction:
   a. lock case row or use optimistic version
   b. verify state
   c. create submission
   d. update case status
   e. insert outbox event
   f. update idempotency completed with submission ID
8. Return 201 Created or 200 OK.
```

### 30.5 Response

```http
HTTP/1.1 201 Created
Location: /cases/CASE-1001/submissions/SUB-9001
Content-Type: application/json

{
  "submissionId": "SUB-9001",
  "caseId": "CASE-1001",
  "status": "RESPONSE_SUBMITTED",
  "submittedAt": "2026-06-18T10:15:30Z"
}
```

Retry:

```http
HTTP/1.1 201 Created
Location: /cases/CASE-1001/submissions/SUB-9001
Content-Type: application/json
Idempotency-Replayed: true

{
  "submissionId": "SUB-9001",
  "caseId": "CASE-1001",
  "status": "RESPONSE_SUBMITTED",
  "submittedAt": "2026-06-18T10:15:30Z"
}
```

---

## 31. Common Anti-Patterns

### 31.1 “POST Is Fine, Client Won't Retry”

False.
Clients, users, gateways, and job workers retry all the time.

### 31.2 Check-Then-Insert

```java
if (!exists(key)) {
    create();
    saveKey();
}
```

Race condition.
Use unique constraint/atomic insert.

### 31.3 Store Idempotency Record After Business Operation

If operation succeeds and record write fails, retry duplicates operation.

### 31.4 Same Key Different Payload Accepted

This hides client bugs and creates data integrity risk.

### 31.5 Idempotency Without Scope

Global raw keys can cause cross-tenant/user leakage.

### 31.6 No Expiry Policy

Store grows forever.

### 31.7 Expiry as Only Duplicate Protection

If duplicate must never happen, use domain invariant/unique constraint.

### 31.8 External Side Effect Without Downstream Idempotency

Local idempotency does not prevent duplicate downstream charge/email/webhook if downstream call is repeated unsafely.

### 31.9 Treat Timeout as Failure

Timeout means unknown.

### 31.10 Duplicate Domain Audit Events

Separate request attempt logs from domain state transition logs.

---

## 32. Production Checklist

Use this checklist before releasing mutating endpoint.

### 32.1 Semantics

- [ ] Is method selection correct?
- [ ] Is operation naturally idempotent?
- [ ] If not, is idempotency key required?
- [ ] Is duplicate behavior documented?
- [ ] Is same key different payload behavior documented?

### 32.2 Key and Scope

- [ ] Key has length limit.
- [ ] Key syntax is validated.
- [ ] Scope includes tenant/user/operation as needed.
- [ ] Raw key is not logged.
- [ ] Key lookup happens after authentication.

### 32.3 Store

- [ ] Unique constraint enforces atomic acquire.
- [ ] Record has state machine.
- [ ] `IN_PROGRESS` is handled.
- [ ] Completed result can be replayed.
- [ ] Expiry policy exists.
- [ ] Cleanup job exists.
- [ ] Store failure behavior is defined.

### 32.4 Fingerprint

- [ ] Request fingerprint is stored.
- [ ] Same key different payload is rejected.
- [ ] Canonicalization is defined.
- [ ] Relevant query/path/body fields included.

### 32.5 Transaction and Side Effects

- [ ] Business mutation and idempotency completion are coordinated.
- [ ] Domain unique constraints protect invariants.
- [ ] Downstream calls are idempotent or recoverable.
- [ ] Outbox/inbox used where appropriate.
- [ ] Unknown downstream result is handled.

### 32.6 Observability

- [ ] Idempotency decisions are logged.
- [ ] Metrics distinguish first execution vs replay.
- [ ] Fingerprint mismatch is alertable if high.
- [ ] In-progress stuck records are monitored.
- [ ] Trace spans include operation ID.

### 32.7 Security

- [ ] Store cannot be abused with unbounded unique keys.
- [ ] Rate limiting/quota exists.
- [ ] Sensitive response replay storage minimized.
- [ ] Cross-tenant replay impossible.
- [ ] Authorization checked before replaying sensitive result.

---

## 33. Exercises

### Exercise 1 — Payment Timeout

Design a `POST /payments` endpoint where:

1. Client may retry after timeout.
2. Payment provider supports idempotency key.
3. Database stores payment intent.
4. Response can be lost after provider success.

Write:

- URI.
- Required headers.
- Idempotency scope.
- Database tables.
- Failure matrix.
- Retry behavior.
- Status codes.

### Exercise 2 — Case Assignment

Endpoint:

```http
POST /cases/{caseId}/assign
```

Question:

1. Should this be `POST`, `PUT`, or `PATCH`?
2. Is it naturally idempotent?
3. What if assignment triggers email?
4. What if reassignment is allowed?
5. What audit events should be deduplicated?

### Exercise 3 — Webhook Receiver

Design receiver for provider webhook with event ID.

Include:

- Signature verification order.
- Inbox table.
- Duplicate behavior.
- Payload mismatch behavior.
- Return status strategy.
- Consumer idempotency.

### Exercise 4 — Same Key Different Payload

A client sends same `Idempotency-Key` with different amount.
Design exact error response using Problem Details.

### Exercise 5 — Expired Key

Define idempotency retention policy for:

1. Payment creation.
2. Evidence upload.
3. Large export job.
4. Case submission.
5. Internal notification command.

Explain why each window differs.

---

## 34. Ringkasan

Idempotency adalah salah satu skill pembeda backend engineer senior.
Bukan karena konsepnya sulit secara definisi, tetapi karena implementasinya menyentuh banyak lapisan:

1. HTTP method semantics.
2. Retry behavior.
3. Network uncertainty.
4. Database transaction.
5. Unique constraints.
6. External side effects.
7. Workflow state machine.
8. Event delivery.
9. Observability.
10. Security.

Prinsip paling penting:

> Timeout means unknown, not failed.

> Retry safety is a server contract, not client optimism.

> Exactly-once is usually replaced by at-least-once delivery plus idempotent effects.

> Idempotency key without atomic acquire is false safety.

> Idempotency key without payload fingerprint is dangerous.

> Idempotency without domain invariants is incomplete.

Jika kamu bisa mendesain endpoint mutasi dengan failure matrix yang jelas, duplicate behavior yang eksplisit, transaction boundary yang benar, dan observability yang memadai, kamu sudah jauh di atas mayoritas backend API implementations.

---

## 35. Referensi

- RFC 9110 — HTTP Semantics. Terutama bagian method properties: safe dan idempotent methods.
- IETF HTTPAPI draft — `Idempotency-Key` HTTP Header Field. Draft ini expired, tetapi tetap berguna sebagai referensi konsep: syntax, uniqueness, fingerprint, expiry, responsibilities, dan enforcement scenarios.
- Stripe API Documentation — Idempotent Requests. Praktik nyata penggunaan idempotency key untuk API payment.
- AWS Builders' Library — Making retries safe with idempotent APIs. Pembahasan production tentang retry-safe API design dan client request identifiers.
- OWASP API Security guidance. Relevan untuk object-level authorization, replay, abuse, dan resource exhaustion.

---

## 36. Status Lanjutan

Part ini adalah `011 / 032`.

Seri belum selesai.

Lanjut ke:

```text
learn-http-for-web-backend-perspective-part-012.md
```

Topik berikutnya:

```text
Conditional Requests and Optimistic Concurrency
```

Part berikutnya akan membahas bagaimana HTTP menyediakan mekanisme native untuk mencegah lost update menggunakan `ETag`, `If-Match`, `If-None-Match`, `Last-Modified`, `304 Not Modified`, `412 Precondition Failed`, dan `428 Precondition Required`, termasuk mapping ke database version seperti JPA `@Version`.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-http-for-web-backend-perspective-part-010.md">⬅️ Part 010 — Error Response Design and Problem Details</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-http-for-web-backend-perspective-part-012.md">Part 012 — Conditional Requests and Optimistic Concurrency ➡️</a>
</div>
