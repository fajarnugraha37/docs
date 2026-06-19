# learn-redis-mastery-for-java-engineers-part-012.md

# Part 012 — Idempotency, Deduplication, dan Exactly-Once Illusion

> Seri: `learn-redis-mastery-for-java-engineers`  
> Part: `012`  
> Target pembaca: Java software engineer yang ingin memakai Redis secara aman untuk idempotency, deduplication, request replay, dan event-processing guardrail.  
> Fokus: mental model, correctness boundary, failure mode, Java implementation, Lua atomicity, TTL policy, dan desain yang defensible.

---

## 0. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu harus mampu:

1. Membedakan **idempotency**, **deduplication**, **retry safety**, dan **exactly-once illusion**.
2. Menjelaskan kenapa `SET NX EX` berguna tetapi tidak cukup untuk semua kasus.
3. Mendesain Redis-backed idempotency layer dengan state eksplisit:
   - `STARTED`
   - `COMPLETED`
   - `FAILED`
   - `EXPIRED`
4. Menentukan kapan response harus di-replay, kapan request harus ditolak, dan kapan retry boleh melanjutkan proses.
5. Menerapkan idempotency key untuk HTTP API di Java/Spring.
6. Menerapkan deduplication window untuk consumer event Kafka/RabbitMQ tanpa mengulang teori messaging.
7. Menggunakan Lua untuk transisi state atomik.
8. Mendesain TTL yang sesuai dengan domain, bukan asal `24 hours`.
9. Mengidentifikasi failure mode seperti partial failure, lock stuck, replay mismatch, response poisoning, dan Redis eviction.
10. Menentukan kapan Redis tidak cukup dan harus memakai database constraint/outbox/inbox table.

---

## 1. Masalah Nyata yang Ingin Diselesaikan

Bayangkan endpoint pembayaran:

```http
POST /payments
Idempotency-Key: 8f04d7f2-7e44-4c19-bf60-8bcfd3e92488
Content-Type: application/json

{
  "accountId": "acct-123",
  "amount": 150000,
  "currency": "IDR",
  "merchantRef": "order-789"
}
```

Client mengirim request, server memproses pembayaran, tetapi response timeout sebelum diterima client.

Client tidak tahu apakah pembayaran berhasil atau gagal.

Client retry dengan request yang sama.

Tanpa idempotency, sistem bisa:

1. Membuat dua payment record.
2. Mengurangi saldo dua kali.
3. Mengirim dua settlement event.
4. Membuat audit trail ambigu.
5. Menimbulkan dispute.

Tujuan idempotency bukan sekadar “menghindari duplikat”. Tujuannya adalah membuat **retry menghasilkan outcome yang sama secara aman**.

Dalam sistem regulatori, financial, enforcement lifecycle, case management, atau workflow stateful, idempotency adalah bagian dari **correctness contract**. Ia bukan optimasi.

---

## 2. Definisi yang Sering Tercampur

### 2.1 Idempotency

Operasi disebut idempotent jika menjalankannya beberapa kali dengan input yang sama menghasilkan efek akhir yang sama seperti menjalankannya sekali.

Contoh konseptual:

```text
apply(command) once  -> state S1
apply(command) twice -> state S1
```

Dalam API modern, idempotency biasanya berarti:

> Untuk request dengan idempotency key yang sama dan fingerprint payload yang sama, server hanya menjalankan efek bisnis sekali, lalu retry berikutnya mengembalikan hasil yang sama atau status yang konsisten.

Idempotency bukan berarti semua request aman diulang tanpa batas. Idempotency perlu scope, TTL, payload fingerprint, state, dan response policy.

---

### 2.2 Deduplication

Deduplication berarti mendeteksi dan menyingkirkan duplikat.

Contoh:

```text
Event E123 diterima consumer.
Consumer cek apakah E123 sudah pernah diproses.
Kalau sudah, skip.
Kalau belum, proses.
```

Deduplication biasanya lebih sempit daripada idempotency.

Deduplication menjawab:

```text
Sudah pernah lihat ID ini belum?
```

Idempotency menjawab:

```text
Untuk request ini, outcome canonical-nya apa?
Apakah request retry ini cocok dengan request original?
Apakah response boleh di-replay?
Apakah efek bisnis sudah committed?
```

---

### 2.3 Retry Safety

Retry safety adalah kemampuan sistem bertahan terhadap retry client, retry gateway, retry worker, retry message broker, atau retry scheduler.

Retry safety membutuhkan idempotency, timeout discipline, dan observability.

Retry tanpa idempotency sering lebih berbahaya daripada failure awal.

---

### 2.4 Exactly-Once Illusion

Banyak sistem mengklaim “exactly once”. Dalam praktik backend, yang lebih realistis adalah:

```text
At-least-once delivery + idempotent processing + deduplication + transactional boundary yang jelas
```

Redis bisa membantu membangun **effectively-once behavior** dalam boundary tertentu, tetapi Redis tidak menghapus realitas distributed systems:

1. Network bisa timeout setelah server commit.
2. Process bisa mati setelah DB commit sebelum Redis update.
3. Redis bisa failover dan kehilangan write tertentu jika replication async.
4. TTL bisa expired sebelum retry datang.
5. Eviction bisa menghapus idempotency record.
6. Client bisa mengirim same key dengan payload berbeda.

Maka klaim yang benar adalah:

> Sistem didesain agar retry dengan idempotency key yang sama tidak menghasilkan efek bisnis ganda dalam window dan failure model yang didefinisikan.

Bukan:

> Redis membuat operasi exactly-once secara absolut.

---

## 3. Mengapa Redis Cocok untuk Idempotency dan Deduplication

Redis cocok karena:

1. Command seperti `SET key value NX EX ttl` bersifat atomik untuk check-and-set sederhana.
2. Redis sangat cepat untuk lookup key pendek.
3. TTL built-in cocok untuk idempotency window.
4. Data structure fleksibel: String, Hash, Set, Sorted Set.
5. Lua memungkinkan multi-step state transition secara atomik di server.
6. Redis mudah dipakai sebagai shared state antar instance Java service.
7. Redis cocok untuk state transient yang tidak wajib menjadi system of record permanen.

Redis tidak otomatis cocok jika:

1. Idempotency record harus menjadi bukti audit permanen.
2. Efek bisnis utama ada di database dan harus atomic bersama idempotency record.
3. Redis dikonfigurasi dengan eviction yang bisa menghapus key penting.
4. Redis failover tidak diuji.
5. TTL tidak sesuai lifecycle domain.
6. Payload dan response terlalu besar.
7. Multi-region semantics tidak jelas.

---

## 4. Primitive Redis yang Dipakai

### 4.1 `SET key value NX EX seconds`

Ini primitive paling dasar.

Makna:

```text
Set key hanya kalau key belum ada.
Beri TTL.
Kalau key sudah ada, jangan ubah.
```

Contoh Redis CLI:

```redis
SET idem:payment:tenant-1:8f04d7f2 STARTED NX EX 900
```

Jika berhasil:

```text
OK
```

Jika key sudah ada:

```text
(nil)
```

Ini atomic karena check existence dan write dilakukan dalam satu command di Redis.

Namun pattern ini hanya memberi jawaban sederhana:

```text
Aku berhasil menjadi pemroses pertama atau tidak?
```

Ia belum menjawab:

1. Request pertama sudah selesai atau masih processing?
2. Response pertama apa?
3. Payload retry sama atau beda?
4. Jika proses pertama crash, kapan retry boleh mengambil alih?
5. Jika proses pertama commit ke DB tapi gagal update Redis, apa yang dilakukan retry?

---

### 4.2 Hash untuk State Record

Untuk idempotency yang serius, value sebaiknya bukan string sederhana, tetapi record.

Contoh:

```redis
HSET idem:payment:tenant-1:8f04d7f2 \
  status STARTED \
  request_hash sha256:6b1f... \
  owner instance-17 \
  started_at 2026-06-20T10:15:00Z \
  updated_at 2026-06-20T10:15:00Z
EXPIRE idem:payment:tenant-1:8f04d7f2 900
```

Namun `HSET` + `EXPIRE` adalah dua command. Kalau process mati setelah `HSET` sebelum `EXPIRE`, key bisa hidup selamanya. Untuk state creation yang aman, gunakan Lua atau simpan JSON string dengan `SET NX EX`.

---

### 4.3 Lua untuk Atomic State Transition

Lua diperlukan jika operasi harus:

1. Membaca state sekarang.
2. Membandingkan request hash.
3. Memutuskan status response.
4. Mengubah state.
5. Mengatur TTL.
6. Mengembalikan decision.

Semua itu harus atomic agar dua request concurrent tidak sama-sama merasa berhak memproses.

---

## 5. Model Idempotency Sederhana vs Serius

### 5.1 Model Terlalu Sederhana

```java
boolean first = redis.setIfAbsent(key, "1", Duration.ofMinutes(15));
if (!first) {
    return ResponseEntity.status(409).body("duplicate");
}
processBusinessCommand();
return ok();
```

Masalah:

1. Retry setelah sukses akan mendapat `409 duplicate`, bukan response original.
2. Retry saat request pertama masih processing tidak bisa dibedakan dari retry setelah sukses.
3. Kalau proses crash setelah set key tetapi sebelum bisnis selesai, semua retry ditolak sampai TTL habis.
4. Payload berbeda dengan idempotency key sama tidak terdeteksi.
5. Tidak ada audit outcome.
6. Tidak ada response replay.

Pattern ini mungkin cukup untuk event dedup non-critical, tetapi tidak cukup untuk API penting.

---

### 5.2 Model Lebih Serius

Gunakan state record:

```json
{
  "status": "STARTED",
  "requestHash": "sha256:...",
  "owner": "payment-service-7",
  "startedAt": "2026-06-20T10:15:00Z",
  "updatedAt": "2026-06-20T10:15:00Z"
}
```

Setelah proses sukses:

```json
{
  "status": "COMPLETED",
  "requestHash": "sha256:...",
  "httpStatus": 201,
  "responseBody": "{...}",
  "resourceId": "pay_123",
  "completedAt": "2026-06-20T10:15:04Z"
}
```

Jika retry datang:

1. Key tidak ada → claim processing.
2. Key ada, request hash beda → reject `409 Idempotency-Key Reused With Different Payload`.
3. Key ada, status `STARTED` → return `409/425/202 processing`, atau wait/poll sesuai policy.
4. Key ada, status `COMPLETED` → replay response original.
5. Key ada, status `FAILED_RETRYABLE` → boleh claim ulang, tergantung policy.
6. Key ada, status `FAILED_FINAL` → replay failure atau reject.

---

## 6. State Machine Idempotency

State machine adalah cara paling sehat untuk memikirkan idempotency.

```text
           request baru
               │
               ▼
          ┌─────────┐
          │ STARTED │
          └────┬────┘
               │
       ┌───────┼────────┐
       │       │        │
       ▼       ▼        ▼
 COMPLETED  FAILED   EXPIRED
       │       │        │
       │       │        └── retry bisa menjadi STARTED baru
       │       │
       │       ├── retryable? bisa STARTED ulang dengan token baru
       │       └── final? replay/reject
       │
       └── retry replay response
```

### 6.1 `STARTED`

Makna:

```text
Ada request dengan idempotency key ini yang sedang atau pernah mulai diproses.
```

Field penting:

```text
status
request_hash
owner
started_at
updated_at
processing_ttl
```

Policy:

1. Request concurrent dengan same key dan same hash tidak boleh menjalankan efek bisnis kedua.
2. Bisa return `409 Conflict`, `425 Too Early`, `202 Accepted`, atau menunggu sebentar.
3. Kalau `STARTED` terlalu lama, sistem perlu menentukan apakah stale.

---

### 6.2 `COMPLETED`

Makna:

```text
Efek bisnis sudah selesai dan outcome canonical tersedia.
```

Field penting:

```text
status
request_hash
http_status
response_body atau resource_id
completed_at
```

Policy:

1. Retry same hash → replay response.
2. Retry different hash → reject.
3. TTL bisa lebih panjang daripada `STARTED` TTL.

---

### 6.3 `FAILED_RETRYABLE`

Makna:

```text
Processing gagal sebelum efek bisnis final, dan retry boleh mencoba lagi.
```

Contoh:

1. Timeout ke dependency sebelum ada commit.
2. Validation dependency temporary unavailable.
3. Database deadlock sebelum transaction commit.

Policy:

1. Bisa hapus idempotency key agar retry menjadi fresh.
2. Bisa simpan `FAILED_RETRYABLE` dengan TTL pendek.
3. Bisa membolehkan takeover dengan compare-and-set.

---

### 6.4 `FAILED_FINAL`

Makna:

```text
Request sudah diputuskan gagal secara final.
```

Contoh:

1. Payload invalid.
2. Account not eligible.
3. Business rule rejected.

Policy:

Retry dengan same key dan same payload harus mendapat failure yang sama.

---

### 6.5 `EXPIRED`

Redis tidak menyimpan status `EXPIRED` secara eksplisit. Key hilang.

Namun dari sisi domain, key yang hilang setelah TTL berarti:

```text
Sistem tidak lagi mengingat idempotency outcome dalam Redis.
```

Implikasi:

1. Retry setelah TTL bisa diproses sebagai request baru.
2. Untuk pembayaran atau case mutation penting, ini mungkin tidak aman tanpa DB-level unique constraint.
3. TTL harus mengikuti business retry window, settlement window, dan dispute model.

---

## 7. Request Fingerprint

Idempotency key tidak cukup. Client bisa mengirim:

Request pertama:

```json
{
  "amount": 100000,
  "currency": "IDR"
}
```

Retry salah atau bug client:

```json
{
  "amount": 200000,
  "currency": "IDR"
}
```

Idempotency key sama, payload beda.

Kalau server hanya cek key, ia mungkin replay response pembayaran 100000 untuk request 200000. Itu berbahaya.

Solusinya: simpan request hash.

### 7.1 Canonicalization

Hash harus dihitung dari representasi canonical, bukan string mentah yang rentan beda whitespace/order field.

Contoh canonical JSON:

```json
{"accountId":"acct-123","amount":150000,"currency":"IDR","merchantRef":"order-789"}
```

Lalu:

```text
request_hash = SHA-256(method + path + tenant + canonical_body + semantic_headers)
```

Jangan hash field yang tidak semantik seperti:

1. `Date`
2. `User-Agent`
3. `X-Request-Id`
4. Header tracing
5. Whitespace raw JSON

Hash harus mencerminkan command bisnis.

---

## 8. Key Design untuk Idempotency

Contoh format:

```text
idem:{tenantId}:{operation}:{idempotencyKey}
```

Contoh:

```text
idem:{tenant-1}:payment-create:8f04d7f2-7e44-4c19-bf60-8bcfd3e92488
```

Perhatikan hash tag `{tenant-1}` jika Redis Cluster dan kamu perlu key-key terkait tenant berada di slot sama. Namun jangan sembarangan menaruh semua tenant besar di satu slot karena bisa hot slot.

Key harus mencakup:

1. Domain ownership: `idem`
2. Tenant/account boundary
3. Operation name
4. Idempotency key dari client

Jangan gunakan key terlalu global:

```text
idem:8f04d7f2
```

Masalah:

1. Collision antar tenant.
2. Sulit observability.
3. Sulit migration.
4. Sulit ACL/key pattern.
5. Sulit cleanup domain tertentu.

---

## 9. TTL Design

TTL adalah bagian dari kontrak.

Pertanyaan TTL:

1. Berapa lama client boleh retry?
2. Berapa lama gateway bisa retry otomatis?
3. Berapa lama message broker bisa redeliver?
4. Berapa lama user bisa refresh halaman dan mengirim ulang?
5. Berapa lama domain menganggap duplicate masih duplicate?
6. Apakah outcome perlu replay selama 1 jam, 24 jam, 7 hari?
7. Apakah ada kewajiban audit permanen?

### 9.1 TTL untuk `STARTED`

Biasanya pendek.

Contoh:

```text
processing timeout service = 30 detik
max dependency timeout = 10 detik
worst normal processing = 45 detik
STARTED ttl = 2-5 menit
```

Tujuannya agar crash tidak memblokir retry terlalu lama.

### 9.2 TTL untuk `COMPLETED`

Biasanya lebih panjang.

Contoh:

```text
HTTP API idempotency = 24 jam
payment command = 24-72 jam atau sesuai domain
workflow action = beberapa jam/hari
```

### 9.3 TTL untuk Event Dedup

TTL mengikuti redelivery window broker dan downstream lag.

Contoh:

```text
Kafka topic retention = 7 hari
consumer bisa replay 3 hari
Redis dedup TTL = minimal 3-7 hari, jika Redis digunakan sebagai dedup utama
```

Namun untuk event penting, dedup utama sebaiknya DB inbox table, bukan Redis saja.

---

## 10. API Idempotency Pattern

### 10.1 Flow Dasar

```text
1. Client mengirim request dengan Idempotency-Key.
2. Server validasi key format.
3. Server hitung request fingerprint.
4. Server coba claim key sebagai STARTED.
5. Jika claim berhasil, proses bisnis.
6. Jika sukses, simpan COMPLETED + response summary.
7. Jika gagal final, simpan FAILED_FINAL.
8. Jika gagal retryable sebelum commit, hapus key atau set FAILED_RETRYABLE.
9. Jika retry datang, baca state dan ambil keputusan.
```

---

### 10.2 Decision Table

| Existing State | Same Request Hash? | Decision |
|---|---:|---|
| Key missing | N/A | Claim `STARTED`, process |
| `STARTED` fresh | yes | Return processing/conflict/wait |
| `STARTED` stale | yes | Takeover if policy allows |
| `STARTED` | no | Reject key reuse |
| `COMPLETED` | yes | Replay response |
| `COMPLETED` | no | Reject key reuse |
| `FAILED_FINAL` | yes | Replay failure |
| `FAILED_FINAL` | no | Reject key reuse |
| `FAILED_RETRYABLE` | yes | Retry/takeover depending policy |
| `FAILED_RETRYABLE` | no | Reject key reuse |

---

## 11. Response Replay: Full Body atau Resource Reference?

Saat request selesai, kamu bisa menyimpan response di Redis.

Pilihan A: simpan full response body.

```json
{
  "status": "COMPLETED",
  "httpStatus": 201,
  "responseBody": "{\"paymentId\":\"pay_123\",\"status\":\"PENDING\"}",
  "contentType": "application/json"
}
```

Kelebihan:

1. Replay cepat.
2. Response benar-benar sama.
3. Tidak perlu query DB lagi.

Kekurangan:

1. Memory Redis lebih besar.
2. Risiko menyimpan PII/sensitive data.
3. Schema response lama tersimpan.
4. Bisa menjadi response poisoning kalau salah menyimpan error transient.

Pilihan B: simpan resource reference.

```json
{
  "status": "COMPLETED",
  "httpStatus": 201,
  "resourceType": "payment",
  "resourceId": "pay_123"
}
```

Retry query DB untuk membentuk response.

Kelebihan:

1. Redis lebih hemat.
2. Data utama tetap di database.
3. Lebih aman untuk payload besar.

Kekurangan:

1. Replay tidak selalu byte-identical.
2. Jika resource berubah setelah request awal, response retry bisa beda.
3. Perlu query tambahan.

Untuk domain penting, sering lebih baik menyimpan **outcome minimal yang canonical**:

```json
{
  "status": "COMPLETED",
  "httpStatus": 201,
  "resourceId": "pay_123",
  "businessStatus": "PENDING_SETTLEMENT"
}
```

---

## 12. Java/Spring Implementation Blueprint

### 12.1 Model

```java
public enum IdempotencyStatus {
    STARTED,
    COMPLETED,
    FAILED_FINAL,
    FAILED_RETRYABLE
}
```

```java
public record IdempotencyDecision(
        DecisionType type,
        String key,
        String requestHash,
        Integer httpStatus,
        String responseBody,
        String reason
) {
    public enum DecisionType {
        CLAIMED,
        REPLAY_COMPLETED,
        REPLAY_FAILED,
        IN_PROGRESS,
        KEY_REUSED_WITH_DIFFERENT_REQUEST,
        RETRYABLE_TAKEOVER_ALLOWED,
        RETRYABLE_REJECTED
    }
}
```

```java
public record IdempotencyRecord(
        IdempotencyStatus status,
        String requestHash,
        String owner,
        Instant startedAt,
        Instant updatedAt,
        Integer httpStatus,
        String responseBody,
        String resourceId,
        String errorCode
) {}
```

---

### 12.2 Key Builder

```java
public final class IdempotencyKeyBuilder {
    private IdempotencyKeyBuilder() {}

    public static String forOperation(String tenantId, String operation, String idempotencyKey) {
        requireSafe(tenantId, "tenantId");
        requireSafe(operation, "operation");
        requireSafe(idempotencyKey, "idempotencyKey");
        return "idem:{" + tenantId + "}:" + operation + ":" + idempotencyKey;
    }

    private static void requireSafe(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(field + " is required");
        }
        if (value.length() > 200) {
            throw new IllegalArgumentException(field + " too long");
        }
        if (!value.matches("[a-zA-Z0-9._:-]+")) {
            throw new IllegalArgumentException(field + " contains unsafe characters");
        }
    }
}
```

Catatan:

1. Hash tag `{tenantId}` hanya contoh untuk Redis Cluster.
2. Jika tenant besar, semua idempotency key tenant tersebut bisa terkonsentrasi di satu slot.
3. Alternatif: hash tag per logical shard, misalnya `{tenantHashBucket}`.

---

### 12.3 Request Fingerprint

Contoh sederhana:

```java
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;

public final class RequestFingerprint {
    private static final ObjectMapper CANONICAL_MAPPER = new ObjectMapper()
            .configure(SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS, true);

    private RequestFingerprint() {}

    public static String sha256(String method, String path, String tenantId, byte[] jsonBody) {
        try {
            JsonNode node = CANONICAL_MAPPER.readTree(jsonBody);
            byte[] canonicalJson = CANONICAL_MAPPER.writeValueAsBytes(node);

            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            digest.update(method.toUpperCase().getBytes(StandardCharsets.UTF_8));
            digest.update((byte) '\n');
            digest.update(path.getBytes(StandardCharsets.UTF_8));
            digest.update((byte) '\n');
            digest.update(tenantId.getBytes(StandardCharsets.UTF_8));
            digest.update((byte) '\n');
            digest.update(canonicalJson);

            return "sha256:" + HexFormat.of().formatHex(digest.digest());
        } catch (Exception e) {
            throw new IllegalArgumentException("Cannot fingerprint request", e);
        }
    }
}
```

Dalam produksi, canonicalization harus disesuaikan:

1. Hilangkan field non-semantic.
2. Normalisasi amount/currency jika perlu.
3. Pastikan format tanggal stabil.
4. Jangan hash signature yang berubah setiap request.
5. Sertakan operation path agar key tidak dipakai lintas endpoint.

---

## 13. Lua Script untuk Claim

Untuk menghindari race, claim logic bisa menggunakan Lua.

### 13.1 Claim Script dengan JSON String

Script:

```lua
-- KEYS[1] = idempotency key
-- ARGV[1] = request hash
-- ARGV[2] = owner
-- ARGV[3] = now iso
-- ARGV[4] = started ttl seconds
-- ARGV[5] = started record json

local existing = redis.call('GET', KEYS[1])

if not existing then
  redis.call('SET', KEYS[1], ARGV[5], 'EX', ARGV[4], 'NX')
  return {'CLAIMED'}
end

local status = string.match(existing, '"status"%s*:%s*"([^"]+)"')
local request_hash = string.match(existing, '"requestHash"%s*:%s*"([^"]+)"')
local http_status = string.match(existing, '"httpStatus"%s*:%s*(%d+)')

if request_hash ~= ARGV[1] then
  return {'KEY_REUSED_WITH_DIFFERENT_REQUEST'}
end

if status == 'COMPLETED' then
  return {'REPLAY_COMPLETED', existing}
end

if status == 'FAILED_FINAL' then
  return {'REPLAY_FAILED', existing}
end

if status == 'STARTED' then
  return {'IN_PROGRESS', existing}
end

if status == 'FAILED_RETRYABLE' then
  return {'RETRYABLE_REJECTED', existing}
end

return {'UNKNOWN_STATE', existing}
```

Catatan penting:

1. Parsing JSON dengan string match di Lua ini hanya contoh edukatif, bukan parser JSON robust.
2. Untuk produksi, gunakan Hash fields atau cjson jika tersedia dalam Redis Lua environment.
3. Redis Lua mendukung `cjson` di Redis scripting environment, tetapi desain tetap harus diuji.

---

### 13.2 Claim dengan Redis Hash

Hash lebih mudah dibaca parsial, tetapi creation + TTL harus atomic lewat Lua.

```lua
-- KEYS[1] = idempotency key
-- ARGV[1] = request hash
-- ARGV[2] = owner
-- ARGV[3] = now
-- ARGV[4] = ttl seconds

if redis.call('EXISTS', KEYS[1]) == 0 then
  redis.call('HSET', KEYS[1],
    'status', 'STARTED',
    'request_hash', ARGV[1],
    'owner', ARGV[2],
    'started_at', ARGV[3],
    'updated_at', ARGV[3]
  )
  redis.call('EXPIRE', KEYS[1], ARGV[4])
  return {'CLAIMED'}
end

local request_hash = redis.call('HGET', KEYS[1], 'request_hash')
local status = redis.call('HGET', KEYS[1], 'status')

if request_hash ~= ARGV[1] then
  return {'KEY_REUSED_WITH_DIFFERENT_REQUEST'}
end

if status == 'COMPLETED' then
  local http_status = redis.call('HGET', KEYS[1], 'http_status')
  local response_body = redis.call('HGET', KEYS[1], 'response_body')
  return {'REPLAY_COMPLETED', http_status or '', response_body or ''}
end

if status == 'FAILED_FINAL' then
  local http_status = redis.call('HGET', KEYS[1], 'http_status')
  local response_body = redis.call('HGET', KEYS[1], 'response_body')
  return {'REPLAY_FAILED', http_status or '', response_body or ''}
end

if status == 'STARTED' then
  return {'IN_PROGRESS'}
end

if status == 'FAILED_RETRYABLE' then
  return {'RETRYABLE_REJECTED'}
end

return {'UNKNOWN_STATE', status or ''}
```

---

## 14. Lua Script untuk Complete

Setelah proses bisnis sukses, update state ke `COMPLETED` hanya jika state masih milik request yang sama.

```lua
-- KEYS[1] = idempotency key
-- ARGV[1] = request hash
-- ARGV[2] = now
-- ARGV[3] = completed ttl seconds
-- ARGV[4] = http status
-- ARGV[5] = response body
-- ARGV[6] = resource id

if redis.call('EXISTS', KEYS[1]) == 0 then
  return {'MISSING'}
end

local request_hash = redis.call('HGET', KEYS[1], 'request_hash')
local status = redis.call('HGET', KEYS[1], 'status')

if request_hash ~= ARGV[1] then
  return {'HASH_MISMATCH'}
end

if status ~= 'STARTED' and status ~= 'FAILED_RETRYABLE' then
  return {'INVALID_STATE', status or ''}
end

redis.call('HSET', KEYS[1],
  'status', 'COMPLETED',
  'updated_at', ARGV[2],
  'completed_at', ARGV[2],
  'http_status', ARGV[4],
  'response_body', ARGV[5],
  'resource_id', ARGV[6]
)
redis.call('EXPIRE', KEYS[1], ARGV[3])

return {'COMPLETED'}
```

Failure mode penting:

Jika business transaction sukses di DB tetapi process mati sebelum script `complete`, retry akan melihat `STARTED` sampai TTL habis. Setelah TTL habis, retry bisa membuat efek kedua kecuali DB punya constraint.

Karena itu, untuk efek bisnis penting, Redis idempotency harus dipasangkan dengan database uniqueness/inbox/outbox.

---

## 15. Java Service Skeleton dengan Spring Data Redis

### 15.1 Idempotency Service Interface

```java
public interface IdempotencyService {
    IdempotencyDecision claim(
            String tenantId,
            String operation,
            String idempotencyKey,
            String requestHash
    );

    void markCompleted(
            String tenantId,
            String operation,
            String idempotencyKey,
            String requestHash,
            int httpStatus,
            String responseBody,
            String resourceId
    );

    void markFailedFinal(
            String tenantId,
            String operation,
            String idempotencyKey,
            String requestHash,
            int httpStatus,
            String responseBody,
            String errorCode
    );
}
```

---

### 15.2 RedisScript Wiring

```java
import org.springframework.core.io.ClassPathResource;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;

@Service
public class RedisIdempotencyService implements IdempotencyService {
    private final RedisTemplate<String, String> redisTemplate;
    private final Clock clock;
    private final DefaultRedisScript<List> claimScript;
    private final DefaultRedisScript<List> completeScript;

    private final Duration startedTtl = Duration.ofMinutes(5);
    private final Duration completedTtl = Duration.ofHours(24);

    public RedisIdempotencyService(RedisTemplate<String, String> redisTemplate, Clock clock) {
        this.redisTemplate = redisTemplate;
        this.clock = clock;

        this.claimScript = new DefaultRedisScript<>();
        this.claimScript.setLocation(new ClassPathResource("redis/idempotency-claim.lua"));
        this.claimScript.setResultType(List.class);

        this.completeScript = new DefaultRedisScript<>();
        this.completeScript.setLocation(new ClassPathResource("redis/idempotency-complete.lua"));
        this.completeScript.setResultType(List.class);
    }

    @Override
    public IdempotencyDecision claim(String tenantId, String operation, String idempotencyKey, String requestHash) {
        String key = IdempotencyKeyBuilder.forOperation(tenantId, operation, idempotencyKey);
        String now = Instant.now(clock).toString();
        String owner = ownerId();

        @SuppressWarnings("unchecked")
        List<String> result = redisTemplate.execute(
                claimScript,
                List.of(key),
                requestHash,
                owner,
                now,
                String.valueOf(startedTtl.toSeconds())
        );

        if (result == null || result.isEmpty()) {
            throw new IllegalStateException("Empty idempotency script result");
        }

        String code = result.get(0);
        return switch (code) {
            case "CLAIMED" -> new IdempotencyDecision(
                    IdempotencyDecision.DecisionType.CLAIMED,
                    key,
                    requestHash,
                    null,
                    null,
                    null
            );
            case "REPLAY_COMPLETED" -> new IdempotencyDecision(
                    IdempotencyDecision.DecisionType.REPLAY_COMPLETED,
                    key,
                    requestHash,
                    parseIntOrNull(result, 1),
                    getOrNull(result, 2),
                    null
            );
            case "REPLAY_FAILED" -> new IdempotencyDecision(
                    IdempotencyDecision.DecisionType.REPLAY_FAILED,
                    key,
                    requestHash,
                    parseIntOrNull(result, 1),
                    getOrNull(result, 2),
                    null
            );
            case "IN_PROGRESS" -> new IdempotencyDecision(
                    IdempotencyDecision.DecisionType.IN_PROGRESS,
                    key,
                    requestHash,
                    null,
                    null,
                    "Request with same idempotency key is still processing"
            );
            case "KEY_REUSED_WITH_DIFFERENT_REQUEST" -> new IdempotencyDecision(
                    IdempotencyDecision.DecisionType.KEY_REUSED_WITH_DIFFERENT_REQUEST,
                    key,
                    requestHash,
                    null,
                    null,
                    "Idempotency key was reused with a different request fingerprint"
            );
            default -> throw new IllegalStateException("Unknown idempotency script result: " + result);
        };
    }

    @Override
    public void markCompleted(
            String tenantId,
            String operation,
            String idempotencyKey,
            String requestHash,
            int httpStatus,
            String responseBody,
            String resourceId
    ) {
        String key = IdempotencyKeyBuilder.forOperation(tenantId, operation, idempotencyKey);
        String now = Instant.now(clock).toString();

        @SuppressWarnings("unchecked")
        List<String> result = redisTemplate.execute(
                completeScript,
                List.of(key),
                requestHash,
                now,
                String.valueOf(completedTtl.toSeconds()),
                String.valueOf(httpStatus),
                responseBody,
                resourceId == null ? "" : resourceId
        );

        if (result == null || result.isEmpty() || !"COMPLETED".equals(result.get(0))) {
            throw new IllegalStateException("Failed to mark idempotency as completed: " + result);
        }
    }

    @Override
    public void markFailedFinal(
            String tenantId,
            String operation,
            String idempotencyKey,
            String requestHash,
            int httpStatus,
            String responseBody,
            String errorCode
    ) {
        // Implementation mirip markCompleted, tapi status FAILED_FINAL.
        // Dalam sistem nyata, final validation failure juga sering disimpan agar retry mendapat failure yang sama.
        throw new UnsupportedOperationException("Exercise for reader");
    }

    private static Integer parseIntOrNull(List<String> result, int index) {
        String value = getOrNull(result, index);
        if (value == null || value.isBlank()) return null;
        return Integer.parseInt(value);
    }

    private static String getOrNull(List<String> result, int index) {
        return result.size() > index ? result.get(index) : null;
    }

    private static String ownerId() {
        return System.getenv().getOrDefault("HOSTNAME", "local-dev") + ":" + Thread.currentThread().getName();
    }
}
```

---

## 16. Controller Pattern

```java
@PostMapping("/payments")
public ResponseEntity<String> createPayment(
        @RequestHeader("Idempotency-Key") String idempotencyKey,
        @RequestHeader("X-Tenant-Id") String tenantId,
        @RequestBody byte[] body
) {
    String operation = "payment-create";
    String requestHash = RequestFingerprint.sha256("POST", "/payments", tenantId, body);

    IdempotencyDecision decision = idempotencyService.claim(
            tenantId,
            operation,
            idempotencyKey,
            requestHash
    );

    switch (decision.type()) {
        case REPLAY_COMPLETED, REPLAY_FAILED -> {
            return ResponseEntity
                    .status(decision.httpStatus())
                    .header("Idempotency-Replayed", "true")
                    .body(decision.responseBody());
        }
        case IN_PROGRESS -> {
            return ResponseEntity
                    .status(409)
                    .header("Retry-After", "2")
                    .body("{\"error\":\"request_in_progress\"}");
        }
        case KEY_REUSED_WITH_DIFFERENT_REQUEST -> {
            return ResponseEntity
                    .status(409)
                    .body("{\"error\":\"idempotency_key_reused_with_different_request\"}");
        }
        case CLAIMED -> {
            // continue below
        }
        default -> throw new IllegalStateException("Unhandled idempotency decision: " + decision.type());
    }

    try {
        PaymentResult result = paymentApplicationService.createPayment(tenantId, body);
        String responseBody = toJson(result);

        idempotencyService.markCompleted(
                tenantId,
                operation,
                idempotencyKey,
                requestHash,
                201,
                responseBody,
                result.paymentId()
        );

        return ResponseEntity.status(201).body(responseBody);
    } catch (BusinessValidationException e) {
        String responseBody = "{\"error\":\"" + e.code() + "\"}";
        idempotencyService.markFailedFinal(
                tenantId,
                operation,
                idempotencyKey,
                requestHash,
                422,
                responseBody,
                e.code()
        );
        return ResponseEntity.unprocessableEntity().body(responseBody);
    } catch (Exception e) {
        // Hati-hati: jangan sembarang menyimpan FAILED_FINAL untuk error transient.
        // Kalau efek bisnis mungkin sudah commit, jangan langsung hapus idempotency key.
        throw e;
    }
}
```

---

## 17. Critical Failure Mode: DB Commit Sukses, Redis Complete Gagal

Ini failure mode paling penting.

Flow:

```text
1. Redis claim STARTED sukses.
2. Service membuat payment di PostgreSQL sukses.
3. Service crash sebelum Redis mark COMPLETED.
4. Client retry.
5. Redis masih STARTED atau sudah expired.
```

Jika Redis masih `STARTED`, retry ditolak sementara.

Jika Redis expired, retry bisa membuat payment kedua.

Solusi:

### 17.1 Database Unique Constraint

Simpan idempotency key di table bisnis atau table idempotency permanen.

Contoh:

```sql
CREATE UNIQUE INDEX uq_payment_idempotency
ON payments (tenant_id, idempotency_key);
```

Saat retry setelah Redis hilang, database tetap mencegah duplicate.

### 17.2 Transactional Idempotency Record di DB

```sql
CREATE TABLE idempotency_records (
    tenant_id text NOT NULL,
    operation text NOT NULL,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    status text NOT NULL,
    resource_id text,
    response_code int,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    PRIMARY KEY (tenant_id, operation, idempotency_key)
);
```

Redis bisa menjadi acceleration layer, DB menjadi correctness layer.

### 17.3 Reconciliation on Retry

Jika Redis state `STARTED` terlalu lama, retry bisa query DB by idempotency key.

```text
Redis STARTED stale → query DB → if resource exists, repair Redis to COMPLETED → replay.
```

Ini pattern sangat berguna.

---

## 18. Redis sebagai Correctness Layer: Kapan Boleh, Kapan Tidak

Redis sebagai satu-satunya idempotency store boleh dipertimbangkan jika:

1. Efek bisnis tidak kritikal.
2. Duplicate bisa ditoleransi atau dikompensasi.
3. TTL window pendek.
4. Redis persistence/failover dipahami.
5. Eviction dimatikan untuk key idempotency penting.
6. Tidak ada kewajiban audit permanen.

Redis saja tidak cukup jika:

1. Double execution berdampak finansial/hukum/regulatory.
2. Perlu audit permanen.
3. Redis bisa kehilangan data saat failover.
4. Redis memakai eviction allkeys.
5. Business effect tersimpan di DB tapi idempotency state hanya di Redis.
6. Ada multi-region active-active tanpa conflict policy.

Prinsip:

```text
Redis boleh menjadi fast guard.
Database/ledger harus menjadi final correctness guard untuk efek irreversible.
```

---

## 19. Deduplication untuk Event Consumers

Event consumer sering menerima pesan lebih dari sekali.

Redis dedup pattern sederhana:

```redis
SET dedup:{consumer-group}:event-123 1 NX EX 604800
```

Jika OK, proses event.
Jika nil, skip.

### 19.1 Flow

```text
1. Consumer receive event.
2. Extract eventId.
3. SET dedup key NX EX ttl.
4. Jika berhasil, process.
5. Jika gagal, skip duplicate.
```

Masalah:

Jika consumer set dedup key dulu, lalu crash sebelum processing selesai, redelivery akan di-skip padahal belum diproses.

Jadi untuk event penting, naive dedup ini salah.

---

## 20. Event Dedup: Mark Before vs Mark After

### 20.1 Mark Before Processing

```text
SET dedup NX EX
process event
ack message
```

Kelebihan:

1. Mencegah concurrent duplicate.
2. Simple.

Kekurangan:

1. Crash setelah mark sebelum process → event hilang secara logis.

Cocok untuk:

1. Metrics approximate.
2. Notification best-effort.
3. Non-critical side effects.

---

### 20.2 Mark After Processing

```text
process event
SET dedup NX EX
ack message
```

Kelebihan:

1. Tidak skip event yang belum diproses.

Kekurangan:

1. Duplicate concurrent bisa sama-sama process.
2. Crash setelah process sebelum mark → duplicate bisa reprocess.

Cocok jika business operation sendiri idempotent di DB.

---

### 20.3 STARTED/COMPLETED untuk Event

Lebih baik:

```text
claim STARTED
process business effect with DB idempotency
mark COMPLETED
ack
```

Tapi tetap butuh DB correctness untuk efek penting.

---

## 21. Inbox Table vs Redis Dedup

Untuk event penting, gunakan inbox table.

```sql
CREATE TABLE processed_events (
    consumer_name text NOT NULL,
    event_id text NOT NULL,
    processed_at timestamptz NOT NULL,
    PRIMARY KEY (consumer_name, event_id)
);
```

Dalam transaction yang sama dengan business effect:

```text
BEGIN;
INSERT INTO processed_events ...;
apply business change;
COMMIT;
```

Jika insert duplicate gagal, skip.

Redis bisa dipakai untuk mempercepat common duplicate path, tetapi bukan satu-satunya guard.

---

## 22. Idempotency untuk Workflow/Case Management

Dalam workflow regulatory/case management, idempotency sering muncul pada action seperti:

1. Assign case.
2. Escalate case.
3. Submit evidence.
4. Generate notice.
5. Approve enforcement step.
6. Trigger notification.
7. Create task.

Masalah biasanya bukan sekadar duplicate HTTP request, tetapi duplicate command.

Command harus punya identity:

```json
{
  "commandId": "cmd-123",
  "caseId": "case-789",
  "actorId": "user-456",
  "action": "ESCALATE_CASE",
  "expectedVersion": 17,
  "reason": "SLA breached"
}
```

Redis idempotency bisa guard command retry, tetapi state transition case tetap harus dijaga dengan optimistic locking di database:

```sql
UPDATE cases
SET status = 'ESCALATED', version = version + 1
WHERE case_id = ?
  AND version = ?
  AND status = 'OPEN';
```

Redis membantu retry safety. Database menjaga legal state transition.

---

## 23. Idempotency Key Source

### 23.1 Client-Generated Key

Client mengirim `Idempotency-Key`.

Kelebihan:

1. Cocok untuk retry HTTP.
2. Client bisa mengontrol retry.
3. Standard pattern untuk payment-like APIs.

Risiko:

1. Client reuse key salah.
2. Client tidak mengirim key.
3. Key terlalu pendek/predictable.

Policy:

1. Wajib untuk POST non-idempotent penting.
2. Reject jika missing.
3. Batasi panjang.
4. Validasi karakter.
5. Simpan request hash untuk mencegah misuse.

---

### 23.2 Server-Generated Command ID

Server/gateway membuat command ID.

Cocok untuk:

1. Internal event processing.
2. Workflow commands.
3. Saga steps.
4. Job execution.

Risiko:

Jika ID dibuat setelah request masuk dan client retry membuat ID baru, idempotency gagal.

---

### 23.3 Domain Natural Key

Contoh:

```text
tenantId + merchantRef
caseId + action + expectedVersion
externalPaymentId
```

Kelebihan:

1. Lebih dekat dengan business uniqueness.
2. Bisa dipakai di DB unique constraint.

Kekurangan:

1. Harus benar-benar unique secara domain.
2. Perubahan business rule bisa merusak uniqueness assumption.

---

## 24. HTTP Status untuk Duplicate/Replay

Tidak ada satu jawaban universal.

Rekomendasi umum:

| Situation | Status |
|---|---:|
| Missing key for protected operation | `400 Bad Request` |
| Key reused with different payload | `409 Conflict` |
| Same key still processing | `409 Conflict`, `425 Too Early`, atau `202 Accepted` |
| Same key completed | Original status, plus replay header |
| Same key failed final | Original failure status |
| Idempotency store unavailable | `503 Service Unavailable` untuk operasi penting |

Header berguna:

```http
Idempotency-Replayed: true
Idempotency-Key: ...
Retry-After: 2
```

Untuk operasi penting, jangan silently process tanpa Redis jika idempotency layer down. Fail closed lebih aman daripada duplicate irreversible.

---

## 25. Serialization Boundary

Untuk idempotency record, hindari Java native serialization.

Gunakan:

1. JSON string eksplisit.
2. Redis Hash fields.
3. Small structured payload.
4. Stable schema with version.

Contoh field:

```text
schema_version = 1
status = COMPLETED
request_hash = sha256:...
http_status = 201
resource_id = pay_123
response_body = {...}
created_at = ...
updated_at = ...
```

Kenapa schema version penting?

Karena idempotency record bisa hidup 24 jam sampai beberapa hari. Deploy baru harus tetap bisa membaca record dari deploy lama.

---

## 26. Memory Budget

Idempotency bisa memakan memory besar.

Perkiraan:

```text
requests per day = 10 juta
completed TTL = 24 jam
average record = 1 KB
memory raw = 10 GB
Redis overhead + fragmentation bisa jauh lebih besar
```

Jika response body 5 KB:

```text
10 juta × 5 KB = 50 GB raw
```

Maka desain harus menjawab:

1. Apakah perlu menyimpan full response?
2. Bisa simpan resource reference saja?
3. TTL bisa dipendekkan?
4. Apakah hanya operasi tertentu yang butuh idempotency?
5. Apakah perlu dedicated Redis cluster?
6. Apakah idempotency record perlu compression?
7. Apakah DB lebih cocok untuk long retention?

---

## 27. Eviction Policy Warning

Jika Redis dipakai untuk idempotency penting, jangan biarkan key hilang karena eviction tanpa sadar.

Bahaya policy seperti:

```text
allkeys-lru
allkeys-lfu
allkeys-random
```

Jika memory penuh, idempotency key bisa dihapus sebelum TTL. Retry kemudian bisa diproses ulang.

Untuk correctness-sensitive idempotency:

1. Gunakan Redis dedicated.
2. Gunakan memory budget ketat.
3. Gunakan `noeviction` atau desain yang sadar eviction.
4. Monitor `evicted_keys`.
5. Alert jika memory mendekati limit.
6. Jangan campur cache volatile besar dengan idempotency critical di instance yang sama.

---

## 28. Race Condition yang Harus Diuji

### 28.1 Concurrent Same Request

```text
T1 claim key → CLAIMED
T2 claim key → IN_PROGRESS
```

Expected:

Only one processes business effect.

### 28.2 Same Key Different Payload

```text
T1 claim hash A → CLAIMED
T2 claim hash B → KEY_REUSED_WITH_DIFFERENT_REQUEST
```

Expected:

Reject T2.

### 28.3 Success Then Retry

```text
T1 complete 201
T2 retry → replay 201
```

Expected:

No second business call.

### 28.4 Crash After Claim Before DB

```text
STARTED remains until TTL
retry during TTL → IN_PROGRESS
retry after TTL → new claim
```

Expected:

Acceptable if no business effect happened.

### 28.5 Crash After DB Commit Before Complete

```text
DB has payment
Redis STARTED or missing
retry → must not create duplicate
```

Expected:

DB unique constraint catches duplicate; service repairs Redis if possible.

---

## 29. Testcontainers Integration Test Ideas

### 29.1 Same Key Concurrent Test

```java
@Test
void sameKeyOnlyOneThreadCanClaim() throws Exception {
    int concurrency = 32;
    ExecutorService executor = Executors.newFixedThreadPool(concurrency);
    CountDownLatch start = new CountDownLatch(1);
    AtomicInteger claimed = new AtomicInteger();

    List<Future<?>> futures = IntStream.range(0, concurrency)
            .mapToObj(i -> executor.submit(() -> {
                start.await();
                IdempotencyDecision decision = service.claim(
                        "tenant-1",
                        "payment-create",
                        "idem-123",
                        "sha256:abc"
                );
                if (decision.type() == IdempotencyDecision.DecisionType.CLAIMED) {
                    claimed.incrementAndGet();
                }
                return null;
            }))
            .toList();

    start.countDown();
    for (Future<?> future : futures) {
        future.get();
    }

    assertEquals(1, claimed.get());
}
```

### 29.2 Payload Mismatch Test

```java
@Test
void sameKeyDifferentHashIsRejected() {
    IdempotencyDecision first = service.claim("tenant-1", "payment-create", "idem-1", "sha256:a");
    IdempotencyDecision second = service.claim("tenant-1", "payment-create", "idem-1", "sha256:b");

    assertEquals(IdempotencyDecision.DecisionType.CLAIMED, first.type());
    assertEquals(IdempotencyDecision.DecisionType.KEY_REUSED_WITH_DIFFERENT_REQUEST, second.type());
}
```

### 29.3 Replay Test

```java
@Test
void completedRequestIsReplayed() {
    service.claim("tenant-1", "payment-create", "idem-1", "sha256:a");
    service.markCompleted("tenant-1", "payment-create", "idem-1", "sha256:a", 201, "{\"id\":\"pay-1\"}", "pay-1");

    IdempotencyDecision retry = service.claim("tenant-1", "payment-create", "idem-1", "sha256:a");

    assertEquals(IdempotencyDecision.DecisionType.REPLAY_COMPLETED, retry.type());
    assertEquals(201, retry.httpStatus());
}
```

---

## 30. Observability

Metrics yang wajib:

```text
idempotency.claimed.count
idempotency.replayed.count
idempotency.in_progress.count
idempotency.key_reuse_conflict.count
idempotency.failed_final.count
idempotency.redis_error.count
idempotency.stale_started.count
idempotency.repair_from_db.count
idempotency.record_size.bytes
idempotency.lua.latency
```

Logs yang wajib structured:

```json
{
  "event": "idempotency_decision",
  "tenantId": "tenant-1",
  "operation": "payment-create",
  "idempotencyKeyHash": "sha256-of-key-not-raw-key",
  "requestHash": "sha256:...",
  "decision": "REPLAY_COMPLETED",
  "resourceId": "pay-123"
}
```

Jangan log raw idempotency key jika dianggap secret atau bisa dikorelasikan dengan user action sensitif. Hash key untuk observability.

Alert:

1. Conflict different payload naik tajam.
2. Redis errors naik.
3. `STARTED` stale naik.
4. Replay ratio abnormal.
5. Evicted keys > 0 untuk Redis idempotency.
6. Lua latency tinggi.
7. Memory mendekati limit.

---

## 31. Security dan Abuse

Idempotency key bisa menjadi attack vector.

Risiko:

1. Client mengirim key sangat panjang → memory abuse.
2. Banyak unique keys → Redis memory exhaustion.
3. Key predictable → attacker mencoba replay/conflict.
4. Response body sensitif disimpan di Redis.
5. Cross-tenant key collision jika key schema buruk.

Mitigasi:

1. Batasi panjang key, misalnya 128/255 chars.
2. Require entropy reasonable untuk external key.
3. Prefix tenant dan operation.
4. Rate-limit idempotency key creation.
5. Jangan simpan full sensitive response jika tidak perlu.
6. Encrypt at rest jika menggunakan managed Redis dengan persistence.
7. Pakai ACL Redis sesuai key pattern jika memungkinkan.
8. TTL wajib.

---

## 32. Cluster Considerations

Untuk Lua script, semua key yang dipakai script harus berada di slot yang sama di Redis Cluster.

Jika idempotency script hanya memakai satu key, aman.

Jika script memakai beberapa key, gunakan hash tag:

```text
idem:{tenant-1}:payment-create:key-123
idem-meta:{tenant-1}:payment-create
```

Namun hati-hati hot slot.

Better design:

1. Script idempotency satu key saja.
2. Hindari operasi multi-key lintas tenant.
3. Untuk analytics/counting, kirim metric ke monitoring, bukan update Redis counter global dalam script claim.

---

## 33. Multi-Region Considerations

Idempotency multi-region jauh lebih sulit.

Pertanyaan:

1. Apakah client bisa retry ke region berbeda?
2. Apakah Redis per-region atau global?
3. Apakah replication synchronous atau asynchronous?
4. Apakah idempotency key bisa diklaim di dua region saat network partition?
5. Apakah database global punya uniqueness constraint?

Untuk operasi penting, solusi biasanya:

1. Route same idempotency key ke home region.
2. Gunakan global database uniqueness.
3. Gunakan command ledger yang replicated dengan conflict policy.
4. Jangan mengandalkan Redis lokal per-region sebagai satu-satunya guard.

---

## 34. Anti-Patterns

### 34.1 `SETNX` lalu `EXPIRE` Terpisah

```redis
SETNX idem:key STARTED
EXPIRE idem:key 900
```

Jika process mati di antara dua command, key bisa tidak punya TTL.

Gunakan:

```redis
SET idem:key STARTED NX EX 900
```

atau Lua untuk Hash.

---

### 34.2 Tidak Menyimpan Request Hash

Akibat:

Same key different payload bisa mendapat response yang salah.

---

### 34.3 Menghapus Key Saat Error Tanpa Tahu Efek Bisnis

Jika error terjadi setelah DB commit tetapi sebelum response, menghapus key memungkinkan duplicate.

---

### 34.4 Menyimpan Semua Response Besar

Redis berubah menjadi storage response body besar.

Akibat:

1. Memory blow-up.
2. Latency naik.
3. Eviction meningkat.
4. Cost tinggi.

---

### 34.5 Redis Idempotency Dicampur dengan Cache Besar

Cache eviction bisa menghapus idempotency record.

---

### 34.6 Menganggap Redis Dedup Sama dengan Exactly Once

Redis dedup hanya guard dalam window tertentu.

---

### 34.7 Idempotency Key Tidak Di-scope by Tenant/Operation

Akibat:

1. Cross operation collision.
2. Cross tenant bug.
3. Security risk.

---

## 35. Practical Decision Framework

Gunakan Redis-only idempotency jika:

```text
Duplicate tidak fatal
TTL pendek cukup
Tidak ada audit permanen
Redis dedicated/noeviction
Failure sudah diuji
```

Gunakan Redis + DB constraint jika:

```text
Efek bisnis penting
Retry client mungkin lama
DB adalah source of truth
Duplicate tidak boleh terjadi
Redis dipakai untuk fast path/replay
```

Gunakan DB-only idempotency jika:

```text
Throughput masih cukup
Correctness lebih penting daripada latency
Record harus auditable
Transaction dengan business effect wajib atomic
```

Gunakan message inbox/outbox jika:

```text
Event processing penting
At-least-once broker
Business update dan processed marker harus atomic
Replay historis perlu aman
```

---

## 36. Checklist Desain Idempotency

Sebelum production, jawab:

1. Apa operasi yang dilindungi?
2. Siapa pembuat idempotency key?
3. Apakah key wajib atau optional?
4. Apa scope key?
5. Apa request fingerprint?
6. Apa response replay policy?
7. Apa TTL `STARTED`?
8. Apa TTL `COMPLETED`?
9. Apa yang terjadi jika Redis down?
10. Apa yang terjadi jika Redis eviction?
11. Apa yang terjadi jika DB commit sukses tapi Redis update gagal?
12. Apakah ada DB unique constraint?
13. Apakah record perlu audit permanen?
14. Bagaimana stale `STARTED` diperbaiki?
15. Bagaimana observability decision?
16. Bagaimana concurrency test?
17. Bagaimana failover test?
18. Bagaimana schema versioning record?
19. Apakah full response aman disimpan?
20. Apakah Redis memory budget cukup?

---

## 37. Latihan Mandiri

### Latihan 1 — HTTP Idempotency

Bangun endpoint:

```http
POST /transfers
Idempotency-Key: ...
```

Requirement:

1. Same key + same payload hanya membuat transfer sekali.
2. Retry setelah sukses replay response.
3. Same key + beda amount return `409`.
4. Concurrent 50 request hanya satu yang memproses.
5. Simpan `resourceId`, bukan full response body.

---

### Latihan 2 — Crash Simulation

Simulasikan crash setelah DB commit sebelum Redis complete.

Requirement:

1. Retry tidak boleh membuat transfer kedua.
2. Service harus menemukan record DB by idempotency key.
3. Service repair Redis menjadi `COMPLETED`.
4. Retry replay response.

---

### Latihan 3 — Event Dedup

Bangun consumer event:

```json
{
  "eventId": "evt-123",
  "type": "CASE_ESCALATED",
  "caseId": "case-789"
}
```

Requirement:

1. Duplicate event tidak membuat task duplicate.
2. Business effect dan processed marker atomic di DB.
3. Redis dipakai sebagai fast duplicate filter.
4. Jika Redis hilang, correctness tetap aman.

---

## 38. Mental Model Akhir

Idempotency dengan Redis bukan hanya command:

```redis
SET key value NX EX ttl
```

Itu hanya pintu masuk.

Model yang benar:

```text
idempotency = command identity + payload fingerprint + state machine + TTL contract + replay policy + durable correctness boundary + observability
```

Redis memberi:

1. Fast atomic claim.
2. Shared transient state.
3. TTL lifecycle.
4. Lua-based decision logic.
5. Response replay cache.

Redis tidak memberi secara otomatis:

1. Absolute exactly-once.
2. Durable audit guarantee.
3. Atomicity dengan database.
4. Multi-region linearizability.
5. Protection dari bad TTL/eviction.

Engineer top-tier tidak bertanya:

```text
Bisa pakai Redis untuk idempotency?
```

Tapi bertanya:

```text
Apa correctness boundary-nya?
Apa yang terjadi jika Redis tahu STARTED tetapi DB sudah commit?
Apa yang terjadi jika Redis lupa tetapi client retry?
Apa yang harus direplay?
Apa yang harus ditolak?
Apa yang harus diaudit permanen?
```

Itulah perbedaan antara memakai Redis sebagai tool dan memakai Redis sebagai bagian dari sistem yang bisa dipertanggungjawabkan.

---

## 39. Ringkasan

Di bagian ini kita mempelajari:

1. Idempotency berbeda dari deduplication.
2. Exactly-once absolut adalah ilusi dalam distributed systems umum.
3. Redis cocok untuk fast idempotency guard karena `SET NX EX`, TTL, dan Lua.
4. Pattern serius membutuhkan state machine, bukan boolean flag.
5. Request hash wajib untuk mencegah key reuse dengan payload berbeda.
6. TTL adalah kontrak domain, bukan angka acak.
7. Response replay bisa full body atau resource reference.
8. Failure paling penting adalah DB commit sukses tetapi Redis complete gagal.
9. Untuk efek penting, Redis harus dipasangkan dengan DB uniqueness/inbox/outbox.
10. Observability dan testing concurrency/failure wajib.

---

## 40. Referensi

- Redis command documentation: `SET`, `NX`, `EX`, `XX`, and related options.
- Redis command documentation: `SETNX`, including deprecation guidance toward `SET` with options for modern usage.
- Redis documentation: distributed locks and safe compare-delete patterns using Lua.
- Redis documentation and blog material on idempotency patterns using Redis.
- Spring Data Redis reference: `RedisTemplate`, scripting, serialization, transactions, and pipelining.
- General distributed systems practice: at-least-once delivery, idempotent consumers, inbox/outbox, and transactional uniqueness boundaries.

---

# Status Seri

```text
Part 012 selesai.
Seri belum selesai.
Belum mencapai bagian terakhir.
Berikutnya: learn-redis-mastery-for-java-engineers-part-013.md
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-redis-mastery-for-java-engineers-part-011.md">⬅️ Part 011 — Rate Limiting dan Quota Enforcement dengan Redis</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-redis-mastery-for-java-engineers-part-013.md">Part 013 — Distributed Locks: Useful, Dangerous, Often Misused ➡️</a>
</div>
