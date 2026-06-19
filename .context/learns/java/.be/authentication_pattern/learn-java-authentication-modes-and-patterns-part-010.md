# learn-java-authentication-modes-and-patterns-part-010

# Part 10 — HMAC Request Signing

> Series: **Java Authentication Modes and Patterns**  
> Scope: **Java 8–25**  
> Level: **Advanced / Production Engineering**  
> Focus: **request-level authentication using keyed signatures, canonicalization, replay defense, key lifecycle, and operational failure modeling**

---

## 0. Apa yang Ingin Diselesaikan oleh Part Ini?

Pada part sebelumnya kita membahas **API key authentication**. API key adalah credential sederhana: client mengirim secret atau token, server mencari credential itu, lalu menentukan apakah request boleh diterima. Model ini mudah dipakai, tetapi punya satu kelemahan fundamental:

> Siapa pun yang mendapatkan API key bisa mengirim request valid selama key itu belum dicabut.

HMAC request signing mencoba meningkatkan model tersebut dengan mengubah credential dari:

```text
Client mengirim secret ke server pada setiap request
```

menjadi:

```text
Client membuktikan bahwa ia mengetahui secret tanpa mengirim secret itu sendiri.
```

Client membuat signature dari request menggunakan secret bersama. Server menghitung ulang signature dari request yang diterima. Jika hasilnya sama, server menyimpulkan bahwa request dibuat oleh pihak yang memiliki secret dan request tidak berubah sejak ditandatangani.

Namun ini hanya benar jika desainnya lengkap. HMAC yang hanya menghitung:

```text
HMAC(secret, body)
```

belum cukup untuk production. Sistem yang matang harus menjawab:

1. Bagian request mana yang ditandatangani?
2. Bagaimana cara menormalisasi URL, query, header, dan body?
3. Bagaimana mencegah replay?
4. Bagaimana key diidentifikasi tanpa membuka secret?
5. Bagaimana melakukan rotation tanpa downtime?
6. Bagaimana signature mismatch di-debug tanpa membocorkan secret?
7. Bagaimana memastikan implementasi Java konsisten lintas client, gateway, proxy, dan server?

Materi ini membahas HMAC request signing sebagai **authentication mode**, bukan sekadar potongan kode `Mac.getInstance("HmacSHA256")`.

---

## 1. Mental Model: HMAC Request Signing sebagai Proof-of-Knowledge

HMAC request signing adalah pola authentication berbasis **shared secret**.

Ada dua pihak:

```text
Client  <---- shared secret ---->  Server
```

Client tidak mengirim secret. Client mengirim:

```text
request + key id + timestamp + nonce + signature
```

Server memakai `key id` untuk menemukan secret, lalu menghitung ulang signature dari request yang diterima.

Jika signature cocok:

```text
request datang dari pihak yang mengetahui secret
request belum berubah pada bagian yang ikut ditandatangani
request berada dalam jendela waktu yang diterima
nonce/request id belum pernah dipakai dalam replay window
```

HMAC bukan encryption. HMAC tidak menyembunyikan data. HMAC memberi **message authentication** dan **integrity**. RFC 2104 mendefinisikan HMAC sebagai mekanisme message authentication menggunakan cryptographic hash function dan secret key; kekuatan cryptographic-nya bergantung pada hash function dan key yang digunakan.  
Source: RFC 2104 — HMAC: Keyed-Hashing for Message Authentication.

Model penting:

```text
Authentication claim:
  "I am client X."

Proof:
  "I can produce a valid MAC over this exact request using client X's secret."

Server verification:
  "Using the secret registered for client X, I can reproduce the same MAC."
```

Dengan kata lain, HMAC request signing memindahkan authentication dari:

```text
credential presentation
```

ke:

```text
cryptographic proof over request material
```

---

## 2. HMAC Bukan Digital Signature

Nama “request signing” sering membuat orang mengira HMAC sama dengan digital signature. Ini keliru.

| Aspek | HMAC | Digital Signature |
|---|---|---|
| Key model | Shared secret | Private key + public key |
| Verifier tahu secret? | Ya | Tidak |
| Non-repudiation | Tidak kuat | Lebih kuat |
| Cocok untuk | Partner API, internal API, gateway API, webhook | Legal-grade signing, asymmetric trust, multi-party verification |
| Jika server bocor | Bisa memalsukan client karena server punya secret | Tidak bisa memalsukan private key jika hanya public key yang disimpan |
| Complexity | Lebih sederhana | Lebih kompleks |

HMAC cocok ketika server dan client memang berada dalam hubungan bilateral dan server boleh menyimpan secret untuk memverifikasi signature.

HMAC kurang cocok ketika:

1. Banyak verifier perlu memverifikasi tanpa boleh memalsukan signer.
2. Diperlukan non-repudiation yang kuat.
3. Secret tidak boleh diketahui verifier.
4. Trust model bersifat multi-party.

Untuk kasus itu, gunakan asymmetric signature seperti RSA-PSS, ECDSA, EdDSA, atau private key JWT/OAuth mTLS sesuai konteks.

---

## 3. Kapan HMAC Request Signing Digunakan?

HMAC request signing sering dipakai pada:

1. Partner API.
2. Internal service-to-service API tanpa OAuth infrastructure penuh.
3. Webhook verification.
4. Payment gateway callback.
5. API gateway custom authentication.
6. Legacy enterprise integration.
7. High-value administrative API.
8. Request integrity di atas TLS untuk kebutuhan audit tambahan.
9. Client yang tidak cocok memakai browser session.
10. API yang butuh bukti bahwa method/path/body/header tertentu tidak diubah.

Contoh mental model:

```text
Partner A mengirim POST /payments/settlements
Body berisi settlement instruction
Server ingin memastikan:
  - request benar dari Partner A
  - body tidak berubah
  - request tidak replay dari request lama
  - request dikirim dalam time window yang wajar
```

HMAC bisa menjadi solusi.

Namun HMAC bukan pengganti TLS. OWASP REST Security Cheat Sheet menekankan bahwa secure REST service harus hanya menyediakan HTTPS endpoint untuk melindungi credential, API key, JWT, dan data in transit. HMAC melengkapi TLS untuk request authentication/integrity, bukan menggantikannya.

---

## 4. Core Flow

Flow minimal:

```text
Client:
  1. Menyiapkan request
  2. Membuat canonical request string
  3. Menghitung digest body jika body ikut ditandatangani
  4. Menghitung HMAC(secret, canonical_request)
  5. Mengirim key id, timestamp, nonce, signature

Server:
  1. Membaca key id
  2. Mengambil secret aktif/valid untuk key id
  3. Memvalidasi timestamp
  4. Memvalidasi nonce belum pernah dipakai
  5. Membuat canonical request string dari request aktual
  6. Menghitung HMAC(secret, canonical_request)
  7. Membandingkan signature secara constant-time
  8. Melanjutkan authentication context sebagai principal client
```

Diagram:

```text
+--------+                                             +--------+
| Client |                                             | Server |
+--------+                                             +--------+
    |                                                      |
    | 1. Build HTTP request                               |
    | 2. Canonicalize method/path/query/headers/body       |
    | 3. HMAC(secret, canonical_request)                   |
    |                                                      |
    |---- HTTP request + X-Key-Id + X-Timestamp ---------->|
    |     + X-Nonce + X-Signature                          |
    |                                                      |
    |                                      4. Lookup key   |
    |                                      5. Rebuild canonical request
    |                                      6. Check timestamp/nonce
    |                                      7. HMAC(secret, canonical_request)
    |                                      8. Constant-time compare
    |                                                      |
    |<---------------- 200 / 401 --------------------------|
```

---

## 5. What HMAC Actually Proves

HMAC proves only what is included in the MAC input.

Jika canonical request hanya berisi body:

```text
POST /transfer?to=A
body={"amount":100}
```

maka attacker yang bisa memodifikasi path atau query mungkin dapat mengubah target endpoint jika method/path/query tidak ikut ditandatangani.

Jika canonical request hanya berisi method dan path, body bisa diganti.

Jika timestamp tidak ikut ditandatangani, attacker bisa mengganti timestamp.

Jika nonce tidak ikut ditandatangani, attacker bisa mengganti nonce.

Rule utama:

> Field yang dipakai untuk security decision harus ikut ditandatangani atau divalidasi melalui channel yang sama-sama terlindungi.

Field yang biasanya harus ikut signature:

1. HTTP method.
2. Scheme atau host, jika relevant terhadap multi-host routing.
3. Path canonical.
4. Query canonical.
5. Selected headers.
6. Body digest.
7. Timestamp.
8. Nonce/request id.
9. Key id/client id.
10. Signature version.
11. Content type jika parsing body bergantung pada content type.
12. Content length atau body hash, bukan raw body length saja.

---

## 6. Canonical Request: Inti yang Paling Sering Salah

HMAC verification hanya berhasil jika client dan server menghitung MAC atas string byte yang sama.

Masalahnya, HTTP request punya banyak representasi yang secara semantik sama tetapi byte-nya berbeda:

```text
/a/b
/a//b
/a/%62
/a/b?x=1&y=2
/a/b?y=2&x=1
Header-Name: value
header-name:value
```

Canonicalization adalah proses mengubah request menjadi representasi deterministik.

AWS Signature Version 4 memakai konsep canonical request: request details dikanonikalisis, signature dihitung, lalu signature dikirim melalui Authorization header. Dokumentasi AWS menjelaskan flow SigV4 sebagai: membuat canonical request, menghitung signature, dan menambahkan signature pada request. Pola ini berguna sebagai mental model meski kita tidak mengimplementasikan SigV4 penuh.

Canonical request yang baik harus:

1. Deterministic.
2. Strict.
3. Documented.
4. Versioned.
5. Testable dengan golden vectors.
6. Tidak bergantung pada behavior framework yang berubah diam-diam.

Contoh canonical request sederhana:

```text
HMAC-SHA256
v1
POST
/api/v1/payments
amount=100&currency=SGD
host:api.example.com
content-type:application/json
x-client-id:partner-a
x-nonce:018f41e4-b7e2-7ce7-9102-d57a5cdd04c4
x-timestamp:2026-06-19T10:15:30Z
sha256:3a6eb0790f39ac87c94f3856b2dd2c5d110e6811602261a9a923d3bb23adc8b7
```

Signature:

```text
base64url(HMAC-SHA256(secret, UTF8(canonical_request)))
```

---

## 7. Canonical Request Components

### 7.1 Algorithm Line

Include algorithm/version line:

```text
HMAC-SHA256
v1
```

Ini membuat format bisa dievolusi.

Tanpa versioning, setiap perubahan kecil di canonicalization akan memecahkan compatibility.

Bad:

```text
signature = HMAC(secret, method + path + body)
```

Better:

```text
canonical_request = algorithm + version + method + path + query + headers + body_digest
signature = HMAC(secret, canonical_request)
```

### 7.2 HTTP Method

Normalize method menjadi uppercase:

```text
GET
POST
PUT
PATCH
DELETE
```

Jangan membiarkan method tidak ikut signature. Jika method tidak ikut signature, request `GET /resource` bisa disalahgunakan menjadi `DELETE /resource` pada layer tertentu jika ada canonicalization/forwarding bug.

### 7.3 Scheme and Host

Apakah host ikut ditandatangani?

Tergantung arsitektur.

Untuk public partner API, biasanya host sebaiknya ikut signed headers:

```text
host:api.example.com
```

Alasannya:

1. Menghindari cross-host replay.
2. Membantu multi-tenant routing.
3. Memastikan request memang ditargetkan ke host yang diharapkan.

Namun hati-hati jika request melewati proxy/gateway yang mengubah Host header. Jika gateway menerima host eksternal lalu upstream Java app melihat host internal, signature bisa mismatch.

Pilihan desain:

```text
Option A: Signature diverifikasi di edge/gateway menggunakan external Host.
Option B: Signature diverifikasi di app menggunakan X-Forwarded-Host yang dipercaya dari gateway.
Option C: Host tidak ditandatangani, tetapi audience/tenant/service id ditandatangani secara eksplisit.
```

Untuk production, hindari ambiguity. Tentukan satu sumber canonical host.

### 7.4 Path

Path canonicalization sering jadi sumber bug.

Pertanyaan sulit:

1. Apakah `%2F` dianggap slash atau literal encoded slash?
2. Apakah path case-sensitive?
3. Apakah `//` dinormalisasi?
4. Apakah `.` dan `..` di path di-resolve?
5. Apakah trailing slash signifikan?
6. Apakah framework sudah decode path sebelum filter authentication membaca request?

Recommendation:

1. Signature verification dilakukan sedekat mungkin dengan raw request.
2. Dokumentasikan aturan encoding path.
3. Jangan canonicalize terlalu “pintar”.
4. Reject path ambigu seperti encoded slash jika tidak benar-benar diperlukan.
5. Gunakan golden test untuk path edge cases.

Contoh:

```text
/api/v1/accounts/123
```

Bukan:

```text
/api/v1/accounts/%31%32%33
```

kecuali specification jelas.

### 7.5 Query String

Query canonicalization harus menentukan:

1. Parameter sorting.
2. Duplicate parameter handling.
3. Empty value handling.
4. Percent-encoding rules.
5. Space as `%20` atau `+`.
6. Case sensitivity.

Canonical query example:

```text
amount=100&currency=SGD&reference=abc%20123
```

Rules contoh:

```text
- Decode query according to RFC 3986-compatible percent decoding.
- Reject malformed percent encoding.
- Sort by parameter name, then by value.
- Preserve duplicate keys as repeated sorted pairs.
- Encode space as %20, not +.
- Encode reserved characters consistently.
```

Duplicate parameters:

```text
?tag=b&tag=a
```

Canonical:

```text
tag=a&tag=b
```

Atau reject duplicate jika API tidak butuh.

Rule yang paling aman:

> Jika duplicate query parameter tidak diperlukan, reject. Semakin kecil ambiguity, semakin kuat signature scheme.

### 7.6 Headers

Tidak semua header perlu ditandatangani.

Header yang umumnya ditandatangani:

```text
host
content-type
x-client-id
x-timestamp
x-nonce
x-content-sha256
```

Jangan sign header yang sering diubah oleh proxy kecuali memang dikontrol:

```text
connection
keep-alive
transfer-encoding
accept-encoding
user-agent
via
x-forwarded-for
```

Header canonicalization rules:

1. Lowercase header name.
2. Trim leading/trailing whitespace value.
3. Collapse sequential whitespace jika specification mengizinkan.
4. Sort by header name.
5. For duplicate headers, define combine/reject rule.
6. Signed headers list harus ikut signature.

Example:

```text
host:api.example.com
content-type:application/json
x-client-id:partner-a
x-content-sha256:3a6e...
x-nonce:018f...
x-timestamp:2026-06-19T10:15:30Z
```

Signed headers list:

```text
content-type;host;x-client-id;x-content-sha256;x-nonce;x-timestamp
```

Kenapa signed headers list penting?

Karena server harus tahu header mana yang dimaksud client sebagai bagian signature. Tanpa list, server dan client bisa menghitung subset berbeda.

### 7.7 Body Digest

Untuk body, biasanya jangan langsung menaruh raw body dalam canonical request string. Gunakan digest:

```text
SHA-256(body bytes)
```

Lalu canonical request menyertakan:

```text
sha256:<hex digest>
```

Keuntungan:

1. Canonical string tetap kecil.
2. Body besar tidak perlu dimasukkan ke string canonical.
3. Signature input lebih predictable.
4. Bisa mendukung streaming jika digest dihitung saat membaca body.

Namun body digest harus dihitung dari **exact bytes** yang diterima, bukan object JSON hasil parsing.

Bad:

```java
Object json = objectMapper.readValue(body, Object.class);
String normalized = objectMapper.writeValueAsString(json);
hash(normalized);
```

Ini berbahaya karena JSON serialization bisa berubah: field order, whitespace, number format, unicode escaping.

Better:

```text
hash(raw request body bytes)
```

Jika server perlu memverifikasi signature sebelum controller membaca body, Servlet request body harus dibaca dan di-cache/wrapped agar downstream masih bisa membacanya.

---

## 8. Replay Attack: Kelemahan HMAC Jika Sendirian

HMAC memastikan request tidak dimodifikasi dan dibuat oleh pemilik secret. Tetapi HMAC tidak otomatis mencegah request valid dikirim ulang.

Scenario:

```text
1. Client mengirim:
   POST /transfer
   amount=100
   signature=valid

2. Attacker menangkap request valid.

3. Attacker mengirim ulang request yang sama.

4. Signature tetap valid karena request sama.
```

Replay defense harus eksplisit.

Komponen umum:

```text
timestamp + nonce/request id + replay cache
```

### 8.1 Timestamp Window

Client mengirim timestamp:

```text
X-Timestamp: 2026-06-19T10:15:30Z
```

Server menerima hanya jika timestamp dalam window, misalnya:

```text
now - 5 minutes <= timestamp <= now + 1 minute
```

Forward skew kecil diberikan karena clock client bisa sedikit lebih maju.

Kebijakan umum:

```text
Past window: 5 minutes
Future window: 1 minute
```

Jangan terlalu panjang. Window panjang memperpanjang replay opportunity.

Jangan terlalu pendek jika partner API lintas network dan clock sync tidak kuat.

### 8.2 Nonce / Request ID

Client mengirim nonce unik:

```text
X-Nonce: 018f41e4-b7e2-7ce7-9102-d57a5cdd04c4
```

Server menyimpan nonce yang sudah pernah diterima dalam replay window.

Key cache:

```text
hmac-replay:{clientId}:{nonce}
```

TTL:

```text
pastWindow + futureWindow + safetyMargin
```

Jika nonce sudah ada, reject.

### 8.3 Idempotency Key Bukan Nonce

Idempotency key dan nonce sering tertukar.

| Aspek | Nonce | Idempotency Key |
|---|---|---|
| Tujuan | Mencegah replay | Membuat retry aman |
| Boleh dipakai ulang? | Tidak | Ya, untuk operasi yang sama |
| Response behavior | Reuse harus reject | Reuse boleh return response sebelumnya |
| Security role | Authentication freshness | Application consistency |

Untuk `POST /payments`, Anda mungkin butuh keduanya:

```text
X-Nonce: unique per HTTP attempt
Idempotency-Key: same for logical payment attempt
```

Jika network timeout terjadi, client retry dengan nonce baru tetapi idempotency key sama.

### 8.4 Replay Cache Availability

Replay cache biasanya Redis atau in-memory distributed cache.

Pertanyaan production:

1. Kalau Redis down, fail-open atau fail-closed?
2. Kalau cache partition, apakah replay bisa lewat di node lain?
3. Kalau request volume tinggi, apakah nonce storage jadi bottleneck?
4. Apakah key TTL benar-benar expire?
5. Apakah clock semua node sinkron?

Untuk high-risk operation, default aman:

```text
Replay cache unavailable => reject signed request
```

Untuk low-risk telemetry API mungkin bisa fail-open dengan compensating control.

Tetapi keputusan harus eksplisit, bukan accidental.

---

## 9. Signature Header Design

Ada dua pola umum.

### 9.1 Multiple Headers

```http
X-Client-Id: partner-a
X-Timestamp: 2026-06-19T10:15:30Z
X-Nonce: 018f41e4-b7e2-7ce7-9102-d57a5cdd04c4
X-Content-SHA256: 3a6eb0790f39ac87c94f3856b2dd2c5d110e6811602261a9a923d3bb23adc8b7
X-Signature-Version: v1
X-Signed-Headers: content-type;host;x-client-id;x-content-sha256;x-nonce;x-timestamp
X-Signature: base64url-signature
```

Kelebihan:

1. Mudah dibaca.
2. Mudah di-debug.
3. Mudah diintegrasikan dengan non-standard clients.

Kekurangan:

1. Header banyak.
2. Risiko ada header yang tidak ikut signature.
3. Bisa berantakan jika tidak ada parser ketat.

### 9.2 Authorization Header Structured Format

```http
Authorization: HMAC-SHA256 Credential=partner-a,Version=v1,SignedHeaders=content-type;host;x-content-sha256;x-nonce;x-timestamp,Timestamp=2026-06-19T10:15:30Z,Nonce=018f41e4-b7e2-7ce7-9102-d57a5cdd04c4,Signature=abc123
```

Kelebihan:

1. Lebih standard secara “authentication header”.
2. Semua metadata signature terkumpul.
3. Lebih mirip AWS SigV4 style.

Kekurangan:

1. Parser lebih kompleks.
2. Comma/quote escaping harus benar.
3. Lebih sulit manual testing.

Untuk enterprise custom API, multiple headers sering lebih pragmatis. Untuk platform API jangka panjang, structured Authorization header lebih rapi.

---

## 10. Secret and Key ID Model

Server tidak boleh mencari secret berdasarkan signature. Server harus mencari berdasarkan identifier.

```text
X-Key-Id: hmk_live_7Q9K2...
```

atau:

```text
X-Client-Id: partner-a
X-Key-Id: key-2026-06
```

Model yang lebih baik:

```text
client_id: partner-a
key_id: hmk_01J0W...
secret_hash: hash(secret)        // untuk audit/existence jika perlu
secret_encrypted: ciphertext     // encrypted at rest
status: ACTIVE | ROTATING | REVOKED
valid_from
valid_until
scopes
allowed_ips
allowed_hosts
created_at
last_used_at
last_rotated_at
```

Jangan menyimpan secret plaintext jika bisa dihindari. Namun untuk HMAC verification, server perlu secret asli atau material yang bisa dipakai sebagai key. Ini berbeda dengan API key bearer yang bisa disimpan sebagai hash saja.

Konsekuensi:

1. HMAC shared secrets perlu encryption at rest.
2. Akses baca secret harus sangat dibatasi.
3. Secret idealnya disimpan di KMS/HSM/secret manager.
4. App mungkin mengambil decrypted secret saat runtime melalui controlled path.
5. Audit akses secret penting.

### 10.1 Key ID Tidak Sama dengan Secret

Bad:

```text
X-Api-Key: secret
X-Signature: hmac(secret, request)
```

Ini mengirim secret dan signature sekaligus. HMAC-nya menjadi kurang bermakna karena secret tetap terekspos di request.

Better:

```text
X-Key-Id: public identifier
X-Signature: proof using secret
```

### 10.2 Key Prefix

Gunakan key ID yang memiliki prefix informatif:

```text
hmk_test_01J0WJ4V...
hmk_live_01J0WJ5A...
```

Keuntungan:

1. Mencegah key test dipakai ke production tanpa terlihat.
2. Mempermudah support.
3. Mempermudah log redaction.
4. Mempermudah routing.

Tetapi jangan menaruh secret dalam prefix.

---

## 11. Constant-Time Comparison

Signature comparison tidak boleh memakai string equality biasa jika ada risiko timing leak.

Bad:

```java
if (expected.equals(actual)) {
    // valid
}
```

Better:

```java
MessageDigest.isEqual(expectedBytes, actualBytes)
```

Kenapa?

String comparison biasa bisa berhenti pada byte pertama yang berbeda. Dalam beberapa konteks, timing difference bisa digunakan untuk menebak signature secara bertahap.

Di Java, gunakan:

```java
java.security.MessageDigest.isEqual(byte[] digesta, byte[] digestb)
```

Tetap validasi format dulu:

1. Base64url decode actual signature.
2. Jika decode gagal, reject.
3. Jika length berbeda, tetap gunakan comparison strategy aman atau reject dengan error generic.
4. Jangan bocorkan apakah mismatch karena key id, timestamp, nonce, atau signature.

Error external:

```json
{"error":"invalid_signature"}
```

Log internal boleh lebih detail, tetapi tanpa secret/signature penuh.

---

## 12. Java HMAC Implementation Basics

Java menyediakan `javax.crypto.Mac` dan `javax.crypto.spec.SecretKeySpec` sejak lama, sehingga kompatibel dari Java 8 sampai 25.

Contoh minimal:

```java
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.util.Base64;

public final class HmacSigner {
    public static String hmacSha256Base64Url(byte[] secret, String canonicalRequest) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret, "HmacSHA256"));
            byte[] raw = mac.doFinal(canonicalRequest.getBytes(StandardCharsets.UTF_8));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(raw);
        } catch (Exception e) {
            throw new IllegalStateException("Unable to calculate HMAC", e);
        }
    }
}
```

Namun production code perlu lebih dari itu:

1. Strict canonicalizer.
2. Strict parser.
3. Signature version abstraction.
4. Key resolver.
5. Replay guard.
6. Clock abstraction.
7. Body caching/digesting.
8. Audit event emitter.
9. Metrics.
10. Golden test vectors.

---

## 13. Production-Oriented Java Design

### 13.1 Core Interfaces

```java
public interface RequestSigner {
    SignedRequest sign(UnsignedRequest request, HmacCredential credential);
}

public interface RequestSignatureVerifier {
    VerificationResult verify(IncomingRequest request);
}

public interface CanonicalRequestFactory {
    CanonicalRequest canonicalize(IncomingRequest request, SignatureMetadata metadata);
}

public interface HmacKeyResolver {
    HmacKey resolve(String keyId);
}

public interface ReplayGuard {
    ReplayDecision checkAndMark(String clientId, String nonce, Instant timestamp);
}
```

Jangan campur semua dalam satu filter. Filter hanya orchestration.

### 13.2 Result Model

Gunakan result eksplisit, bukan boolean.

```java
public sealed interface VerificationResult permits VerificationResult.Valid, VerificationResult.Invalid {
    record Valid(AuthenticatedClient client, String keyId) implements VerificationResult {}

    record Invalid(FailureReason reason) implements VerificationResult {}
}
```

Untuk Java 8, sealed interface tidak tersedia. Gunakan class hierarchy biasa atau enum + value object.

```java
public final class VerificationResult {
    private final boolean valid;
    private final FailureReason failureReason;
    private final AuthenticatedClient client;
}
```

### 13.3 Failure Reason

Internal reason:

```java
public enum FailureReason {
    MISSING_SIGNATURE,
    MALFORMED_AUTHORIZATION,
    UNKNOWN_KEY_ID,
    REVOKED_KEY,
    TIMESTAMP_TOO_OLD,
    TIMESTAMP_TOO_FAR_IN_FUTURE,
    NONCE_REPLAYED,
    UNSIGNED_REQUIRED_HEADER,
    BODY_DIGEST_MISMATCH,
    SIGNATURE_MISMATCH,
    INTERNAL_KEY_RESOLUTION_ERROR,
    REPLAY_GUARD_UNAVAILABLE
}
```

External response sebaiknya tetap generic:

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: HMAC-SHA256 error="invalid_request_signature"
```

Jangan memberi attacker oracle:

```text
"signature correct but nonce replayed"
"unknown key id"
"timestamp valid but body digest mismatch"
```

Detail itu boleh ada di log internal dan security audit.

---

## 14. Servlet Filter Pattern

Di aplikasi Servlet/Spring/Jakarta, HMAC verification biasanya dilakukan di filter.

Flow:

```text
HmacAuthenticationFilter
  -> wrap request body if needed
  -> parse signature metadata
  -> verify timestamp
  -> resolve key
  -> canonicalize request
  -> verify body digest
  -> verify signature
  -> replay guard check
  -> create authentication/principal
  -> continue chain
```

Pseudocode:

```java
public final class HmacAuthenticationFilter extends OncePerRequestFilter {
    private final RequestSignatureVerifier verifier;

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain chain
    ) throws ServletException, IOException {

        CachedBodyHttpServletRequest wrapped = CachedBodyHttpServletRequest.wrapIfNeeded(request);

        VerificationResult result = verifier.verify(new ServletIncomingRequest(wrapped));

        if (result instanceof VerificationResult.Invalid invalid) {
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.setContentType("application/json");
            response.getWriter().write("{\"error\":\"invalid_request_signature\"}");
            return;
        }

        VerificationResult.Valid valid = (VerificationResult.Valid) result;

        Authentication authentication = new HmacAuthenticationToken(
                valid.client(),
                valid.keyId(),
                valid.client().authorities()
        );

        SecurityContextHolder.getContext().setAuthentication(authentication);

        try {
            chain.doFilter(wrapped, response);
        } finally {
            SecurityContextHolder.clearContext();
        }
    }
}
```

Catatan:

1. Filter harus berada sebelum authorization filter.
2. Jika Spring Security dipakai, integrasikan dengan `AuthenticationProvider` atau custom filter yang membuat `Authentication`.
3. Jangan lupa clear context.
4. Body wrapper harus aman untuk body besar.
5. Hindari membaca body besar ke memory tanpa limit.

---

## 15. Body Caching and Streaming Problem

Servlet request body hanya bisa dibaca sekali. Jika filter membaca body untuk digest, controller tidak bisa membaca lagi kecuali request di-wrap.

Strategi:

### 15.1 Cache Small Body in Memory

Cocok untuk:

```text
JSON API body <= 1 MB
```

Risiko:

```text
attacker mengirim body besar untuk membuat memory pressure
```

Mitigasi:

1. Limit request body.
2. Reject sebelum read jika content length terlalu besar.
3. Gunakan streaming digest untuk large upload.

### 15.2 Streaming Digest

Untuk upload besar:

```text
InputStream -> DigestInputStream -> downstream processing
```

Tetapi verification perlu selesai sebelum side effect. Jika body diproses sambil digest dihitung, jangan lakukan business side effect sebelum signature final valid.

Pattern:

```text
1. Spool body ke temp file sambil hitung digest.
2. Verify digest/signature.
3. Jika valid, downstream membaca temp file.
4. Hapus temp file.
```

### 15.3 Require Precomputed Content Hash

Client mengirim:

```http
X-Content-SHA256: <hash>
```

Header ini ikut signed canonical request.

Server tetap harus menghitung hash body aktual dan membandingkan dengan header. Jika tidak, attacker bisa mengganti body.

---

## 16. JSON Canonicalization: Hindari Jika Bisa

Sebagian tim mencoba menandatangani canonical JSON, bukan raw bytes.

Masalah:

```json
{"amount":100,"currency":"SGD"}
```

secara semantik mirip dengan:

```json
{
  "currency": "SGD",
  "amount": 100.0
}
```

Tetapi byte berbeda dan representasi number bisa tricky.

Jika Anda ingin menandatangani JSON secara semantik, butuh standard canonical JSON yang sangat ketat dan semua client harus konsisten.

Untuk API request signing, lebih sederhana dan aman:

```text
Sign raw body hash.
```

Dokumentasikan:

> Signature covers the exact UTF-8 bytes sent as the HTTP request body. Clients must calculate body hash after serialization, not before.

---

## 17. Proxy, Gateway, and Load Balancer Realities

HMAC request signing sering gagal di production karena request berubah di tengah jalan.

Layer yang bisa mengubah request:

1. CDN.
2. API Gateway.
3. WAF.
4. Reverse proxy.
5. Load balancer.
6. Service mesh sidecar.
7. Servlet container.
8. Framework routing layer.

Perubahan umum:

```text
Host header changed
Path prefix stripped
Query parameter decoded/re-encoded
Header whitespace normalized
Transfer-Encoding changed
Content-Encoding decompressed
Trailing slash redirected
HTTP/2 pseudo-headers converted
```

Desain yang benar:

```text
Verify signature at the layer that sees the same canonical form as the client intended.
```

Pilihan:

### 17.1 Verify at Edge

API Gateway memverifikasi signature sebelum rewrite.

Kelebihan:

1. Dekat dengan raw external request.
2. App menerima identity yang sudah diverifikasi.
3. Request invalid tidak membebani app.

Kekurangan:

1. App harus mempercayai gateway.
2. Perlu melindungi header identity dari spoofing.
3. Butuh internal auth antara gateway dan app.

### 17.2 Verify in Application

Java app memverifikasi signature.

Kelebihan:

1. Logic dekat dengan domain.
2. Audit app lebih lengkap.
3. Tidak bergantung pada gateway custom plugin.

Kekurangan:

1. App mungkin tidak melihat raw external request.
2. Perlu alignment ketat dengan proxy rewrite.
3. Performance cost masuk ke app.

### 17.3 Hybrid

Gateway melakukan coarse verification dan app melakukan selected verification.

Cocok untuk high-value API, tetapi complexity meningkat.

---

## 18. HMAC vs API Key vs mTLS vs OAuth2 Client Credentials

| Mode | Secret Sent? | Request Integrity | Replay Defense | Operational Complexity | Good For |
|---|---:|---:|---:|---:|---|
| API Key Bearer | Ya | Tidak | Tidak default | Rendah | Simple client auth |
| HMAC Signing | Tidak | Ya, untuk signed fields | Bisa jika timestamp+nonce | Medium | Partner/internal API |
| mTLS | Tidak | TLS channel integrity | TLS handles channel, app replay still contextual | Medium-high | Service/partner identity |
| OAuth2 Client Credentials | Tidak sebagai bearer token issuance, access token dikirim | Token integrity jika JWT; request body tidak signed | Token expiry, not per-request replay | Medium-high | Standard M2M auth |
| Private Key JWT | Tidak | Assertion integrity | Assertion expiry/jti | High | Client auth to authorization server |

HMAC bagus jika:

1. Anda butuh request-level integrity.
2. Client dan server bisa share secret secara aman.
3. OAuth2 infrastructure terlalu berat atau tidak tersedia.
4. Partner API perlu deterministic signing.
5. Webhook provider perlu membuktikan payload berasal dari provider.

HMAC kurang tepat jika:

1. Anda perlu user delegation.
2. Anda butuh standardized ecosystem-wide token lifecycle.
3. Secret distribution ke banyak client sulit dikontrol.
4. Banyak services perlu verify tanpa boleh memalsukan.
5. Ada requirement non-repudiation kuat.

---

## 19. Webhook Signature Pattern

Webhook adalah use case umum.

Provider mengirim event ke receiver:

```text
PaymentProvider -> POST /webhooks/payment
```

Receiver ingin memastikan event berasal dari provider dan body tidak berubah.

Signature header contoh:

```http
X-Webhook-Timestamp: 1781864130
X-Webhook-Signature: v1=base64url(...)
```

Canonical payload:

```text
timestamp + "." + raw_body
```

Verification:

1. Validate timestamp within tolerance.
2. Compute HMAC over exact raw body bytes plus timestamp.
3. Compare signature constant-time.
4. Check event id idempotency/replay.

Webhook biasanya tidak sign method/path/query karena endpoint receiver fixed. Tetapi untuk general API request signing, method/path/query harus signed.

Failure mode webhook:

1. Body parser membaca dan mengubah body sebelum verification.
2. JSON reserialization mengubah payload.
3. Receiver tidak memvalidasi timestamp.
4. Receiver tidak menyimpan event id sehingga duplicate event diproses dua kali.
5. Secret rotation tidak didukung.

---

## 20. Key Rotation Without Downtime

HMAC key rotation sulit karena client dan server harus sinkron.

### 20.1 Single Active Key Model

```text
client has one active key
```

Rotation:

```text
1. Create new key
2. Send new key to client securely
3. Client switches
4. Server revokes old key
```

Problem:

```text
Jika client switch belum serentak, request gagal.
```

### 20.2 Dual-Key Overlap Model

```text
client can have old and new key active during overlap
```

State:

```text
old key: ACTIVE_UNTIL 2026-07-01
new key: ACTIVE_FROM 2026-06-20
```

Server menerima keduanya selama overlap.

Client mulai memakai new key.

Setelah grace period, old key revoked.

### 20.3 Key ID Enables Rotation

Karena request membawa `key_id`, server tahu key mana yang dipakai.

Tanpa key id, server harus mencoba semua secret milik client sampai signature match. Ini buruk:

1. Lambat.
2. Membuka timing complexity.
3. Sulit audit.
4. Sulit revoke spesifik key.

### 20.4 Emergency Rotation

Jika secret bocor:

1. Revoke compromised key immediately.
2. Notify client/partner.
3. Issue new key through secure channel.
4. Review logs for suspicious signed requests.
5. Invalidate replay cache if needed.
6. Increase monitoring for affected client.
7. Determine whether signed request can be replayed within window.
8. Rotate dependent credentials if secret copied to other systems.

---

## 21. Error Handling Strategy

External errors harus sederhana:

```http
401 Unauthorized
{"error":"invalid_request_signature"}
```

atau:

```http
403 Forbidden
{"error":"signature_not_allowed_for_resource"}
```

Gunakan 401 untuk authentication gagal. Gunakan 403 jika authentication valid tetapi client tidak punya scope/resource access.

Jangan expose:

```text
unknown key id
timestamp expired
nonce replayed
body digest mismatch
signature mismatch
```

Detail internal log:

```json
{
  "event":"hmac_auth_failed",
  "reason":"TIMESTAMP_TOO_OLD",
  "clientId":"partner-a",
  "keyId":"hmk_live_01J0...",
  "requestId":"req-123",
  "path":"/api/v1/payments",
  "method":"POST",
  "timestamp":"2026-06-19T10:15:30Z",
  "serverTime":"2026-06-19T10:22:40Z",
  "remoteIp":"203.0.113.10"
}
```

Redaction:

1. Jangan log secret.
2. Jangan log full signature jika tidak perlu.
3. Boleh log signature prefix/suffix untuk troubleshooting.
4. Jangan log full body untuk sensitive operations.
5. Log canonical request hanya di debug secure environment, bukan production default.

---

## 22. Observability and Audit Events

Authentication system tanpa observability akan sulit dioperasikan.

Metrics:

```text
hmac_auth_requests_total{client_id, outcome}
hmac_auth_failures_total{reason}
hmac_auth_latency_ms
hmac_key_resolution_latency_ms
hmac_replay_cache_latency_ms
hmac_replay_detected_total{client_id}
hmac_timestamp_skew_seconds{client_id}
hmac_body_digest_mismatch_total{client_id}
```

Audit events:

1. Signature verification success.
2. Signature verification failure.
3. Replay detected.
4. Key created.
5. Key rotated.
6. Key revoked.
7. Key used after rotation warning window.
8. Key used from unusual source IP.
9. Clock skew too large.
10. High failure burst.

High-signal alerts:

```text
- sudden spike SIGNATURE_MISMATCH for one client
- repeated NONCE_REPLAYED
- timestamp skew gradually increasing
- key id unknown with same client id
- valid key used from unexpected ASN/IP range
```

---

## 23. Threat Model

### 23.1 Secret Theft

If attacker steals HMAC secret, they can create valid signatures.

Mitigation:

1. Store secret encrypted at rest.
2. Limit read access.
3. Rotate regularly.
4. Scope key narrowly.
5. Monitor usage anomaly.
6. Bind key to client, environment, IP range, and allowed APIs.

### 23.2 Replay

Valid signed request reused.

Mitigation:

1. Timestamp.
2. Nonce.
3. Replay cache.
4. Idempotency for side-effect operations.

### 23.3 Canonicalization Confusion

Client signs one representation, server interprets another.

Mitigation:

1. Strict canonicalization.
2. Reject ambiguous request.
3. Golden tests.
4. Verify before rewrite or define rewrite-aware canonicalization.

### 23.4 Header Injection / Duplicate Headers

Attacker sends duplicate signed/unsigned header variants.

Mitigation:

1. Reject duplicate security headers.
2. Lowercase and canonicalize header names.
3. Sign signed headers list.
4. Use strict parser.

### 23.5 Algorithm Downgrade

Attacker changes algorithm from `HMAC-SHA256` to weak algorithm.

Mitigation:

1. Server controls allowed algorithms.
2. Algorithm/version included in signature input.
3. Reject unknown/weak version.
4. Do not accept client-selected algorithm blindly.

### 23.6 Key Confusion

Request claims one key id but server verifies with another or falls back.

Mitigation:

1. Mandatory key id.
2. No fallback to default key.
3. Key bound to client id.
4. Key status validation.

### 23.7 Body Parser Confusion

Signature verified over one body representation, application uses another.

Mitigation:

1. Verify raw body bytes.
2. Enforce content-type.
3. Reject ambiguous encodings.
4. Avoid middleware altering body before verification.

### 23.8 Clock Manipulation

Client clock wrong or attacker manipulates timestamp.

Mitigation:

1. Timestamp signed.
2. Server-side window validation.
3. Monitor skew.
4. Provide clock sync guidance to partners.

---

## 24. Canonicalization Failure Examples

### 24.1 Query Order

Client signs:

```text
amount=100&currency=SGD
```

Server receives:

```text
currency=SGD&amount=100
```

If server uses raw query order and client sorted query, mismatch.

Fix:

```text
Both must sort or both must preserve raw order. Sorting is usually better.
```

### 24.2 JSON Whitespace

Client signs compact JSON:

```json
{"a":1}
```

Proxy pretty prints:

```json
{
  "a": 1
}
```

Body digest mismatch.

Fix:

```text
Do not allow proxies to transform signed body. Disable body transformation. Verify at edge before transformation.
```

### 24.3 Host Rewriting

Client signs:

```text
host:api.partner.example
```

Java app sees:

```text
host:internal-service.default.svc.cluster.local
```

Mismatch.

Fix:

```text
Verify at gateway or use trusted external host header with strict proxy trust boundary.
```

### 24.4 Encoded Slash

Client signs:

```text
/api/files/a%2Fb
```

Server route interprets:

```text
/api/files/a/b
```

Ambiguity.

Fix:

```text
Reject encoded slash or define exact handling.
```

---

## 25. Versioning Strategy

Every signature scheme should be versioned.

Example versions:

```text
v1: HMAC-SHA256, canonical query sorted, signed headers limited
v2: includes host and content-type, stricter duplicate header rejection
v3: supports streaming body digest and SHA-512/256
```

Server behavior:

```text
- Accept v1 and v2 during migration.
- Prefer v2 for new clients.
- Emit warning metric for v1 usage.
- Announce deprecation date.
- Reject v1 after cutoff.
```

Version must be included in canonical request:

```text
HMAC-SHA256
v1
...
```

Otherwise attacker may replay v1 signature under v2 parser or vice versa.

---

## 26. Scope and Authorization After Authentication

HMAC request signing authenticates the client. It does not automatically authorize action.

After successful authentication:

```text
principal = partner-a
credential = key-2026-06
scopes = payments:write, settlements:read
```

Authorization checks still needed:

```text
Can partner-a POST /payments?
Can partner-a access merchant 123?
Can this key perform write operations?
Is this operation allowed from this source IP?
Is the key environment live or test?
```

Authentication answer:

```text
Who sent this request?
```

Authorization answer:

```text
Is this authenticated caller allowed to do this?
```

Audit answer:

```text
Can we later prove which credential/key/client caused this action?
```

---

## 27. HMAC in Spring Security

Spring Security integration can be done via custom filter plus `AuthenticationProvider`.

### 27.1 Token Object

```java
public final class HmacAuthenticationToken extends AbstractAuthenticationToken {
    private final String clientId;
    private final String keyId;

    public HmacAuthenticationToken(String clientId, String keyId, Collection<? extends GrantedAuthority> authorities) {
        super(authorities);
        this.clientId = clientId;
        this.keyId = keyId;
        setAuthenticated(true);
    }

    @Override
    public Object getCredentials() {
        return "[PROTECTED]";
    }

    @Override
    public Object getPrincipal() {
        return clientId;
    }

    public String getKeyId() {
        return keyId;
    }
}
```

Do not put secret in `credentials`.

### 27.2 Filter Order

Filter should run before authorization decisions.

Conceptual:

```java
http.addFilterBefore(hmacFilter, UsernamePasswordAuthenticationFilter.class);
```

Actual order depends on other authentication mechanisms.

If endpoint supports both Bearer token and HMAC, define deterministic precedence:

```text
Authorization: Bearer ... -> JWT/Bearer flow
Authorization: HMAC-SHA256 ... -> HMAC flow
X-Signature headers -> HMAC flow
No auth -> anonymous/reject
```

Avoid accepting multiple auth modes simultaneously for same request unless explicitly defined.

---

## 28. HMAC in Jakarta Security / Servlet

In Jakarta Security, HMAC could be implemented as custom `HttpAuthenticationMechanism`.

Conceptual flow:

```java
@ApplicationScoped
public class HmacHttpAuthenticationMechanism implements HttpAuthenticationMechanism {
    @Inject
    RequestSignatureVerifier verifier;

    @Override
    public AuthenticationStatus validateRequest(
            HttpServletRequest request,
            HttpServletResponse response,
            HttpMessageContext context) throws AuthenticationException {

        VerificationResult result = verifier.verify(new ServletIncomingRequest(request));

        if (result.isValid()) {
            CredentialValidationResult cvr = new CredentialValidationResult(
                    result.clientId(),
                    result.groups()
            );
            return context.notifyContainerAboutLogin(cvr);
        }

        return context.responseUnauthorized();
    }
}
```

Keuntungan:

1. Integrated dengan Jakarta Security context.
2. Principal/group bisa diteruskan ke container.
3. Cocok untuk Jakarta EE application.

Tetapi untuk full request body verification, tetap perlu hati-hati dengan request wrapping dan container behavior.

---

## 29. Clock and Time Design

Timestamp harus diproses dengan `java.time`.

Gunakan:

```java
Instant
Clock
Duration
```

Jangan gunakan:

```java
new Date()
System.currentTimeMillis() scattered everywhere
LocalDateTime without timezone
```

Pattern:

```java
public final class TimestampValidator {
    private final Clock clock;
    private final Duration pastTolerance;
    private final Duration futureTolerance;

    public TimestampDecision validate(Instant requestTime) {
        Instant now = clock.instant();
        if (requestTime.isBefore(now.minus(pastTolerance))) {
            return TimestampDecision.TOO_OLD;
        }
        if (requestTime.isAfter(now.plus(futureTolerance))) {
            return TimestampDecision.TOO_FAR_IN_FUTURE;
        }
        return TimestampDecision.ACCEPTED;
    }
}
```

Use UTC:

```text
2026-06-19T10:15:30Z
```

Do not accept ambiguous local timestamps.

---

## 30. Encoding Rules

### 30.1 Signature Encoding

Prefer base64url without padding:

```text
Base64 URL encoder without padding
```

Java:

```java
Base64.getUrlEncoder().withoutPadding()
Base64.getUrlDecoder()
```

Why base64url?

1. Safe in headers.
2. No `+` and `/` ambiguity.
3. Padding can be omitted consistently.

Hex is also acceptable but longer.

### 30.2 String Encoding

Canonical request string should be encoded as UTF-8 before HMAC.

```java
canonicalRequest.getBytes(StandardCharsets.UTF_8)
```

Never rely on platform default charset.

### 30.3 Newline

Define newline separator:

```text
\n
```

Do not use platform-specific line separator.

Bad:

```java
System.lineSeparator()
```

Better:

```java
"\n"
```

---

## 31. Golden Test Vectors

A production signature scheme needs official test vectors.

Example test vector document:

```text
Secret:
  base64url: c2VjcmV0XzEyMzQ1Njc4OTA

Request:
  Method: POST
  Path: /api/v1/payments
  Query: currency=SGD&amount=100
  Headers:
    Host: api.example.com
    Content-Type: application/json
    X-Client-Id: partner-a
    X-Timestamp: 2026-06-19T10:15:30Z
    X-Nonce: 018f41e4-b7e2-7ce7-9102-d57a5cdd04c4
  Body bytes UTF-8:
    {"amount":100,"currency":"SGD"}

Canonical query:
  amount=100&currency=SGD

Body SHA-256:
  ...

Canonical request:
  ...

Expected signature:
  ...
```

Tests should cover:

1. Empty body.
2. Empty query.
3. Duplicate query.
4. Space encoding.
5. Unicode path/query.
6. Header case variation.
7. Extra unsigned header.
8. Missing signed header.
9. Old timestamp.
10. Replayed nonce.
11. Body digest mismatch.
12. Wrong key id.
13. Rotated key.
14. Different HTTP method.
15. Path with trailing slash.

Golden vectors make non-Java partner implementation possible.

---

## 32. Advanced Pattern: Derived Signing Key

Instead of using master secret directly for every request:

```text
signature = HMAC(masterSecret, canonicalRequest)
```

You can derive signing keys:

```text
dateKey = HMAC(masterSecret, yyyyMMdd)
serviceKey = HMAC(dateKey, serviceName)
signingKey = HMAC(serviceKey, "request-signing-v1")
signature = HMAC(signingKey, canonicalRequest)
```

AWS SigV4 uses a derived signing key style where the raw secret is not used directly for final request signing.

Benefits:

1. Limits use context.
2. Supports date/service scoping.
3. Reduces blast radius of derived key exposure.
4. Makes multi-service signing safer.

Costs:

1. More complexity.
2. Harder for partners to implement.
3. More test vectors required.

For simple partner APIs, direct HMAC with strong random secret may be enough. For platform APIs, derived key model is worth considering.

---

## 33. Secret Generation

HMAC secrets must be high entropy.

Do not generate with:

```java
UUID.randomUUID().toString()
Random
current time
human-readable phrase
```

Use:

```java
SecureRandom
```

Example:

```java
SecureRandom secureRandom = SecureRandom.getInstanceStrong();
byte[] secret = new byte[32]; // 256-bit
secureRandom.nextBytes(secret);
String encoded = Base64.getUrlEncoder().withoutPadding().encodeToString(secret);
```

Practical note:

`SecureRandom.getInstanceStrong()` can block on some systems. For server generation path this may be acceptable. For high-throughput generation, default `new SecureRandom()` is usually sufficient in modern Java, but policy may vary by environment.

Secret length:

```text
At least 256-bit random secret for HMAC-SHA256
```

Human-memorable secrets are unacceptable.

---

## 34. Storage Model

Because HMAC verifier needs secret material, storage is more sensitive than password hash storage.

Recommended layers:

```text
Database:
  key_id
  client_id
  encrypted_secret
  status
  scopes
  metadata

KMS:
  encrypt/decrypt data key or secret

Application:
  decrypt only when needed
  cache secret briefly if allowed
  never log secret
```

Options:

### 34.1 Store Secret in Secret Manager

```text
key_id -> secret manager path
```

Pros:

1. Better secret access audit.
2. Rotation integrations.
3. Reduced DB exposure.

Cons:

1. Runtime latency.
2. Availability dependency.
3. Need caching.

### 34.2 Envelope Encryption in DB

```text
encrypted_secret = encrypt(data_key, secret)
encrypted_data_key = KMS.encrypt(master_key, data_key)
```

Pros:

1. App can resolve metadata and secret together.
2. Lower external calls with caching.

Cons:

1. More implementation complexity.
2. Must protect decrypt permission.

---

## 35. Caching Keys

Key lookup on every request can be expensive.

Cache by `key_id`:

```text
hmac-key-cache:{key_id} -> key material + status + scopes
```

Considerations:

1. TTL short enough to respect revocation.
2. Event-driven invalidation for emergency revoke.
3. Negative cache for unknown keys to reduce DB load.
4. Do not cache revoked key too long.
5. Ensure cache memory is protected.

Emergency revoke problem:

```text
If key cache TTL is 10 minutes, revoked key may still work for 10 minutes.
```

Mitigations:

1. Short TTL, e.g. 30–120 seconds.
2. Push invalidation.
3. Check revoked version stamp.
4. Keep emergency blocklist in fast store.

---

## 36. Rate Limiting and Abuse Control

Even signed APIs need rate limiting.

Rate limit dimensions:

```text
client_id
key_id
source_ip
endpoint
failure_reason
```

Special controls:

1. High failure rate for unknown key id: protect key lookup.
2. High signature mismatch: possible integration issue or attack.
3. High replay: possible captured request or buggy retry.
4. High timestamp skew: client clock issue.
5. High body digest mismatch: proxy/body transformation issue.

HMAC authentication should run before expensive business logic, but canonicalization/body digest can still be expensive. Apply request size limit before digesting huge bodies.

---

## 37. Order of Validation

Order affects security, performance, and observability.

Recommended high-level order:

```text
1. Reject if HTTP method/path not protected by HMAC policy.
2. Parse auth headers strictly.
3. Validate required fields exist and format.
4. Validate signature version allowed.
5. Validate timestamp coarse window.
6. Resolve key by key id.
7. Validate key status/client binding/scope coarse.
8. Validate body size limit.
9. Compute body digest.
10. Build canonical request.
11. Compute signature.
12. Constant-time compare.
13. Check and mark nonce replay.
14. Create authentication context.
15. Run authorization.
```

Should replay check happen before or after signature check?

Usually after signature check to avoid letting attackers fill replay cache with arbitrary nonces for valid key ids without valid signatures.

But timestamp validation can happen before key lookup if timestamp is in header and signed later; a malicious timestamp can be rejected early for performance. It still must be included in signature so it cannot be tampered with after signing.

---

## 38. Failure Mode: Valid Signature, Invalid Business Intent

HMAC validates request transport/authentication, not business semantic correctness.

Example:

```text
Client signs POST /payments
Body: {"amount": -1000000}
Signature valid.
```

Authentication passes. Business validation must still reject.

Another example:

```text
Client partner-a signs request for merchant owned by partner-b.
Signature valid.
```

Authentication passes. Authorization must reject.

Rule:

```text
Valid signature means authentic caller and untampered signed request.
It does not mean allowed action, correct data, safe operation, or non-fraudulent intent.
```

---

## 39. Failure Mode: Canonicalization Oracle

If server returns very specific errors externally, attacker can learn parser behavior.

Bad response sequence:

```text
missing signed header: x-content-sha256
invalid header canonicalization
signature mismatch at query step
```

Better:

```text
invalid_request_signature
```

Internal logs can have reason codes. External response should not reveal canonicalization internals.

---

## 40. Failure Mode: Retry vs Replay Conflict

Client sends request, server processes it, but response times out. Client retries exact same signed request.

If nonce is same, server rejects replay.

Client may think operation failed.

Solution:

```text
Retry must generate new nonce and timestamp.
Business operation must use idempotency key for logical deduplication.
```

Pattern:

```text
POST /payments
X-Nonce: unique per request attempt
Idempotency-Key: stable per logical payment
```

Server:

```text
- HMAC verifies each request attempt independently.
- Replay guard rejects exact nonce reuse.
- Idempotency layer returns existing result for same logical operation.
```

---

## 41. Failure Mode: Multi-Region Replay

If API runs in multiple regions and replay cache is regional, a request accepted in region A might be replayed in region B.

Options:

1. Global replay cache.
2. Region-bound signature.
3. Route same client to same region within replay window.
4. Include region/audience in canonical request.
5. Accept regional replay risk for low-risk operations.

For high-value financial/regulatory operations, region-bound signature plus global or strongly consistent replay defense is safer.

Canonical request can include:

```text
x-audience: payments-api-prod-ap-southeast-1
```

or:

```text
region: ap-southeast-1
```

---

## 42. HMAC for Internal Microservices

For internal services, HMAC may be used when:

1. Service mesh mTLS is unavailable.
2. OAuth2 client credentials is not yet deployed.
3. You need simple request integrity between known services.
4. Legacy services need gradual hardening.

But be careful:

```text
If every service shares the same secret, any compromised service can impersonate any other service.
```

Better:

```text
pairwise secret per client-service pair
```

or:

```text
service identity + scoped key
```

Example:

```text
order-service -> payment-service secret A
refund-service -> payment-service secret B
```

Then payment-service can revoke refund-service without affecting order-service.

However, for large microservice estates, mTLS/OAuth2 workload identity scales better.

---

## 43. HMAC and Message Queues

HMAC can also sign message payloads, but this is different from HTTP request signing.

Message signing canonical input:

```text
message_type
message_id
producer_id
created_at
audience
payload_digest
```

Use cases:

1. Producer authenticity.
2. Payload integrity after passing through broker.
3. Cross-boundary event verification.

Caution:

1. Broker-level auth is still needed.
2. Message replay still possible unless message id is tracked.
3. Consumer must validate audience and freshness.
4. If broker transforms payload, signature breaks.

This will connect to later Part 28.

---

## 44. Java Version Notes: 8 to 25

### Java 8

Available:

1. `javax.crypto.Mac`.
2. `SecretKeySpec`.
3. `MessageDigest.isEqual`.
4. `java.time` introduced.
5. `Base64` introduced.

Good enough for HMAC request signing.

### Java 11

Useful improvements:

1. Standard HTTP Client for client-side signing integrations.
2. Better TLS defaults over time.
3. Long-term support adoption.

### Java 17

Useful production baseline:

1. Stronger ecosystem support.
2. Records and sealed classes available, depending on design.
3. Better runtime performance.

### Java 21

Useful:

1. Virtual threads for request/client concurrency.
2. Pattern matching and records mature.
3. Need context propagation care if signing/verifying inside async/virtual-thread code.

### Java 25

Relevant direction:

1. Modern Java runtime continues to strengthen cryptographic/key material APIs.
2. PEM encoding support and KDF API are relevant in broader authentication key lifecycle, especially when integrating asymmetric or derived key patterns.
3. For HMAC itself, `Mac` remains the central API.

Core HMAC code remains portable across Java 8–25.

---

## 45. Recommended Signature Specification Template

When designing HMAC authentication, write a formal spec.

Example outline:

```text
1. Overview
2. Authentication Scheme Name
3. Supported Algorithms
4. Credential Model
5. Required Headers
6. Timestamp Format
7. Nonce Format
8. Body Digest
9. Canonical Request Construction
10. Query Canonicalization
11. Header Canonicalization
12. Signature Calculation
13. Signature Encoding
14. Verification Algorithm
15. Replay Prevention
16. Error Responses
17. Key Rotation
18. Test Vectors
19. Security Considerations
20. Change Log
```

Without a written spec, every client implementation becomes a reverse-engineered guess.

---

## 46. Example Specification: HMAC-SHA256 v1

This is a teaching example, not a universal standard.

### 46.1 Required Headers

```http
X-Key-Id: <public key id>
X-Timestamp: <RFC3339 UTC instant>
X-Nonce: <unique request nonce>
X-Content-SHA256: <lowercase hex sha256 of request body bytes>
X-Signed-Headers: <semicolon-separated lowercase header names>
X-Signature: <base64url no-padding HMAC signature>
```

### 46.2 Canonical Request

```text
HMAC-SHA256
v1
<UPPERCASE_METHOD>
<CANONICAL_PATH>
<CANONICAL_QUERY>
<CANONICAL_HEADERS>
<SIGNED_HEADERS>
sha256:<BODY_SHA256_HEX>
```

### 46.3 Canonical Headers

```text
<header-name>:<trimmed-value>
<header-name>:<trimmed-value>
```

Sorted by header name.

Required signed headers:

```text
host
content-type
x-key-id
x-timestamp
x-nonce
x-content-sha256
```

### 46.4 Signature

```text
signature = base64url_no_padding(
  HMAC_SHA256(secret_bytes, UTF8(canonical_request))
)
```

### 46.5 Replay

Server accepts timestamp if:

```text
now - 300 seconds <= timestamp <= now + 60 seconds
```

Nonce uniqueness is enforced per key id for:

```text
360 seconds
```

### 46.6 Errors

All authentication failures return:

```http
401 Unauthorized
{"error":"invalid_request_signature"}
```

---

## 47. Minimal End-to-End Example

Request:

```http
POST /api/v1/payments?currency=SGD&amount=100 HTTP/1.1
Host: api.example.com
Content-Type: application/json
X-Key-Id: hmk_live_01J0WJ4V
X-Timestamp: 2026-06-19T10:15:30Z
X-Nonce: 018f41e4-b7e2-7ce7-9102-d57a5cdd04c4
X-Content-SHA256: 3fb75453225c732a76b7899ea2096dda1455189c89817239732182f73fe5a09f
X-Signed-Headers: content-type;host;x-content-sha256;x-key-id;x-nonce;x-timestamp
X-Signature: <signature>

{"amount":100,"currency":"SGD"}
```

Canonical request:

```text
HMAC-SHA256
v1
POST
/api/v1/payments
amount=100&currency=SGD
content-type:application/json
host:api.example.com
x-content-sha256:3fb75453225c732a76b7899ea2096dda1455189c89817239732182f73fe5a09f
x-key-id:hmk_live_01J0WJ4V
x-nonce:018f41e4-b7e2-7ce7-9102-d57a5cdd04c4
x-timestamp:2026-06-19T10:15:30Z
content-type;host;x-content-sha256;x-key-id;x-nonce;x-timestamp
sha256:3fb75453225c732a76b7899ea2096dda1455189c89817239732182f73fe5a09f
```

Note:

Body hash appears both as signed header and final payload hash line. This redundancy can be simplified, but it is sometimes useful for explicitness. If used, both must match.

---

## 48. Implementation Trap: Charset and Unicode

Suppose query value contains:

```text
name=Fajar Nugraha
```

Client encodes:

```text
name=Fajar%20Nugraha
```

Another client encodes:

```text
name=Fajar+Nugraha
```

In form encoding, `+` may mean space. In URI encoding, `+` can be literal plus depending context.

Your spec must define exact rules.

Recommendation:

```text
- UTF-8 only.
- Percent-encode according to RFC 3986 style.
- Space as %20.
- Reject malformed encodings.
- Normalize neither Unicode forms unless explicitly specified.
```

Unicode normalization is dangerous. `é` can be represented as one code point or as `e` + combining mark. If you normalize, all clients must normalize exactly the same way. If not, sign exact bytes/encoded form.

---

## 49. Implementation Trap: Content-Encoding

If client sends:

```http
Content-Encoding: gzip
```

What is body hash computed over?

Option A:

```text
Hash compressed bytes as sent over HTTP.
```

Option B:

```text
Hash decompressed body bytes.
```

Option A is closer to transport bytes but may be hard if server auto-decompresses.

Option B is closer to application payload but can create ambiguity.

Simplest production recommendation:

```text
Do not allow content-encoding transformation on signed APIs unless explicitly designed.
```

Reject:

```http
Content-Encoding: gzip
```

unless you have full deterministic handling.

---

## 50. Implementation Trap: Transfer-Encoding Chunked

Chunking should not affect body digest if digest is calculated over body payload bytes after transfer decoding.

But if gateway or container handles transfer decoding before app, the app does not see chunks.

Define:

```text
X-Content-SHA256 is SHA-256 of HTTP message body payload bytes after transfer decoding and before content decoding.
```

Or avoid chunked signed request bodies unless required.

---

## 51. HMAC and TLS

HMAC request signing should still require HTTPS.

Why?

1. HMAC does not hide request body.
2. HMAC metadata can leak client id, endpoint, timestamp.
3. Replay risk increases if attacker can capture traffic, even if replay window exists.
4. TLS authenticates server to client.
5. TLS protects response, not just request.

HMAC over HTTP is usually unacceptable for sensitive APIs.

---

## 52. Practical Decision Matrix

Use HMAC request signing when:

```text
- Request-level integrity matters.
- Client can securely store a shared secret.
- You control or document canonicalization for all clients.
- You can operate key rotation and replay cache.
- You do not need user delegation semantics.
```

Prefer OAuth2 client credentials when:

```text
- You need standard token issuance.
- There are many services/resource servers.
- Scope/audience/token lifecycle are important.
- You already have authorization server infrastructure.
```

Prefer mTLS when:

```text
- Workload identity can be certificate-based.
- You want transport-level mutual authentication.
- Service mesh or gateway manages cert lifecycle.
```

Prefer asymmetric signing when:

```text
- Verifier should not be able to impersonate signer.
- Multiple independent verifiers exist.
- Non-repudiation matters.
```

Prefer simple API key only when:

```text
- Low risk.
- Simplicity more important.
- TLS is mandatory.
- Key scope and rotation are acceptable.
```

---

## 53. Production Checklist

### Design

- [ ] Authentication scheme name defined.
- [ ] Signature version defined.
- [ ] Allowed algorithms defined.
- [ ] Canonical request format documented.
- [ ] Required signed fields defined.
- [ ] Ambiguous path/query/header behavior rejected or specified.
- [ ] Replay defense designed.
- [ ] Key rotation designed.
- [ ] Error response policy defined.
- [ ] Test vectors published.

### Security

- [ ] TLS required.
- [ ] Strong random secrets.
- [ ] Secrets encrypted at rest.
- [ ] Key ID is not secret.
- [ ] Signature compared constant-time.
- [ ] Timestamp signed and validated.
- [ ] Nonce signed and checked.
- [ ] Required security headers cannot be duplicated.
- [ ] Body hash verified from raw bytes.
- [ ] Algorithm downgrade rejected.

### Operations

- [ ] Metrics for success/failure.
- [ ] Audit events emitted.
- [ ] Replay cache monitored.
- [ ] Clock skew monitored.
- [ ] Key cache invalidation exists.
- [ ] Emergency revoke works.
- [ ] Debug mode does not leak secret.
- [ ] Partner onboarding guide exists.
- [ ] Golden test suite exists.
- [ ] Runbook for signature mismatch exists.

### Java Implementation

- [ ] Use `Mac` with `HmacSHA256` or stronger approved algorithm.
- [ ] Use `StandardCharsets.UTF_8`.
- [ ] Use `Base64.getUrlEncoder().withoutPadding()` or documented encoding.
- [ ] Use `MessageDigest.isEqual`.
- [ ] Use `Instant`, `Clock`, `Duration`.
- [ ] Use request wrapper for body if Servlet.
- [ ] Limit body size before caching.
- [ ] Clear security context after request.
- [ ] Avoid storing secret in principal/authentication token.
- [ ] Unit and integration tests cover edge cases.

---

## 54. Common Mistakes

1. Signing only body, not method/path/query.
2. Signing parsed JSON instead of raw body bytes.
3. Not validating timestamp.
4. Not using nonce/replay cache.
5. Sending secret and signature together.
6. Comparing signature with `String.equals`.
7. Using platform default charset.
8. Not versioning canonicalization.
9. Allowing duplicate security headers.
10. Letting proxy rewrite signed fields.
11. Logging full secret/signature/body.
12. No key rotation overlap.
13. No emergency revocation.
14. Using one global secret for all clients.
15. Treating valid signature as authorization approval.
16. Returning detailed external error messages.
17. Failing open when replay cache is down without explicit risk decision.
18. No golden test vectors for partner clients.
19. Not accounting for clock skew.
20. Forgetting idempotency for retryable side-effect operations.

---

## 55. Top 1% Engineering Questions

When reviewing an HMAC authentication design, ask:

1. What exact bytes are signed?
2. Can any signed field be modified by gateway/proxy before verification?
3. Does the server verify the same representation the client signed?
4. What happens if the request is replayed in 30 seconds?
5. What happens if the request is replayed in another region?
6. What happens if Redis/replay cache is down?
7. How are duplicate query parameters handled?
8. How are duplicate headers handled?
9. Is timestamp part of the signature?
10. Is nonce part of the signature?
11. Does retry reuse nonce or generate a new nonce?
12. Is idempotency separate from replay defense?
13. How is key rotation performed without downtime?
14. Can one compromised client key access all tenants?
15. Can the server impersonate the client because it stores the shared secret?
16. Would asymmetric signing be more appropriate?
17. Does valid signature become principal only, or also authorization?
18. Are logs enough to reconstruct an incident?
19. Can support debug signature mismatch without seeing the secret?
20. Are test vectors complete enough for non-Java clients?

---

## 56. Reference Implementation Sketch

This is intentionally simplified but shows production boundaries.

```java
public final class HmacRequestSignatureVerifier implements RequestSignatureVerifier {
    private final HmacKeyResolver keyResolver;
    private final CanonicalRequestFactory canonicalRequestFactory;
    private final ReplayGuard replayGuard;
    private final Clock clock;
    private final Duration pastWindow;
    private final Duration futureWindow;

    public VerificationResult verify(IncomingRequest request) {
        SignatureMetadata metadata = SignatureMetadata.parse(request.headers());
        if (!metadata.isValidFormat()) {
            return VerificationResult.invalid(FailureReason.MALFORMED_AUTHORIZATION);
        }

        TimestampDecision ts = validateTimestamp(metadata.timestamp());
        if (!ts.accepted()) {
            return VerificationResult.invalid(ts.failureReason());
        }

        HmacKey key = keyResolver.resolve(metadata.keyId());
        if (key == null || !key.isUsableAt(clock.instant())) {
            return VerificationResult.invalid(FailureReason.UNKNOWN_KEY_ID);
        }

        BodyDigestDecision bodyDigest = verifyBodyDigest(request, metadata);
        if (!bodyDigest.accepted()) {
            return VerificationResult.invalid(FailureReason.BODY_DIGEST_MISMATCH);
        }

        CanonicalRequest canonical = canonicalRequestFactory.canonicalize(request, metadata);

        byte[] expected = hmacSha256(key.secretBytes(), canonical.asUtf8Bytes());
        byte[] actual = metadata.signatureBytes();

        if (!MessageDigest.isEqual(expected, actual)) {
            return VerificationResult.invalid(FailureReason.SIGNATURE_MISMATCH);
        }

        ReplayDecision replay = replayGuard.checkAndMark(
                key.clientId(),
                metadata.nonce(),
                metadata.timestamp()
        );
        if (!replay.accepted()) {
            return VerificationResult.invalid(FailureReason.NONCE_REPLAYED);
        }

        return VerificationResult.valid(
                new AuthenticatedClient(key.clientId(), key.scopes()),
                key.keyId()
        );
    }
}
```

Important nuance:

```text
replayGuard.checkAndMark must be atomic.
```

Redis example:

```text
SET hmac-replay:{clientId}:{nonce} 1 NX EX 360
```

If result is not OK, nonce already exists.

---

## 57. Runbook: Signature Mismatch

When partner says “signature mismatch”, debug systematically.

Ask for safe diagnostic bundle:

```text
- key id, not secret
- request id
- timestamp
- nonce
- method
- path
- raw query string
- signed headers list
- body SHA-256
- canonical request string generated by client
- signature prefix only, e.g. first 8 chars
```

Server compares:

1. Did server parse same method?
2. Did path differ due to proxy prefix?
3. Did query order/encoding differ?
4. Did host differ?
5. Did content-type differ?
6. Did body hash match?
7. Did timestamp format differ?
8. Did newline differ?
9. Did signed headers list differ?
10. Was wrong key used?

Never ask partner to send secret in ticket/email/chat.

---

## 58. Summary

HMAC request signing is a powerful middle ground between simple API key authentication and heavier standardized identity protocols.

It gives:

1. Proof that client knows a shared secret.
2. Integrity over selected request components.
3. Better protection than sending API key directly.
4. A practical pattern for partner APIs and webhooks.

But it only becomes production-grade when combined with:

1. Strict canonicalization.
2. Timestamp validation.
3. Nonce/replay cache.
4. Constant-time comparison.
5. Key ID and key lifecycle.
6. Secret protection.
7. Clear error model.
8. Audit and observability.
9. Versioned specification.
10. Golden test vectors.

The core top-level rule:

> HMAC does not authenticate “an HTTP request” in the abstract. It authenticates the exact canonical representation you choose. If your canonicalization is weak, your authentication is weak.

---

## 59. Sources and Further Reading

1. RFC 2104 — **HMAC: Keyed-Hashing for Message Authentication**  
   https://datatracker.ietf.org/doc/html/rfc2104

2. OWASP Cheat Sheet Series — **REST Security Cheat Sheet**  
   https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html

3. OWASP Cheat Sheet Series — **Secrets Management Cheat Sheet**  
   https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html

4. OWASP Cheat Sheet Series — **Key Management Cheat Sheet**  
   https://cheatsheetseries.owasp.org/cheatsheets/Key_Management_Cheat_Sheet.html

5. AWS Documentation — **Authenticating Requests: Signature Version 4**  
   https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-authenticating-requests.html

6. AWS IAM Documentation — **AWS Signature Version 4 for API requests**  
   https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv.html

7. NIST SP 800-107 Rev. 1 — **Recommendation for Applications Using Approved Hash Algorithms**  
   https://csrc.nist.gov/pubs/sp/800/107/r1/final

8. Java Platform API — `javax.crypto.Mac`, `javax.crypto.spec.SecretKeySpec`, `java.security.MessageDigest`, `java.time`, `java.util.Base64`.

---

## 60. Status

**Part 10 selesai.**

Series **belum selesai**.

Part berikutnya:

```text
Part 11 — JWT Authentication: Claims, Validation, and Misuse
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authentication-modes-and-patterns-part-009.md">⬅️ Part 9 — API Key Authentication</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authentication-modes-and-patterns-part-011.md">Part 11 — JWT Authentication: Claims, Validation, and Misuse ➡️</a>
</div>
