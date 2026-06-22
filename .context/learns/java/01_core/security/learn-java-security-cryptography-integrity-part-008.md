# learn-java-security-cryptography-integrity-part-008

# Part 8 — Message Authentication Code: HMAC, CMAC, and Integrity Tokens

> Seri: `learn-java-security-cryptography-integrity`  
> Part: `008` dari `034`  
> Status seri: **belum selesai**  
> Fokus: **message authentication**, **tamper detection**, **request signing**, **webhook verification**, **replay protection**, **canonicalization**, **constant-time verification**, dan **integrity-token design** di sistem Java.

---

## 0. Tujuan Part Ini

Pada part sebelumnya kita membahas symmetric encryption: AES, modes, padding, AEAD, format payload terenkripsi, dan kesalahan seperti ECB, IV reuse, GCM tag misuse, dan payload format yang tidak versioned.

Part ini membahas primitive yang sering lebih tepat daripada encryption ketika requirement-nya adalah:

> “Saya tidak perlu menyembunyikan isi message, tapi saya harus tahu message ini benar-benar dibuat oleh pihak yang punya secret key dan tidak berubah di tengah jalan.”

Itulah ruang kerja **Message Authentication Code** atau **MAC**.

Setelah menyelesaikan part ini, kamu harus bisa:

1. Membedakan **hash**, **MAC**, **signature**, dan **checksum**.
2. Menentukan kapan memakai **HMAC**, kapan cukup **AEAD**, kapan butuh **digital signature**.
3. Mendesain format request signing yang aman.
4. Mencegah replay attack dengan timestamp, nonce, idempotency key, dan replay cache.
5. Menghindari canonicalization bug.
6. Melakukan signature comparison secara aman.
7. Mendesain token integrity internal tanpa menciptakan mini-JWT yang rapuh.
8. Melakukan security review terhadap webhook/API callback yang memakai HMAC.
9. Menentukan key separation, key rotation, dan envelope format untuk MAC.
10. Menguji failure mode MAC di Java.

---

## 1. Core Mental Model

### 1.1 MAC Itu Bukan Hash Biasa

Hash biasa:

```text
digest = SHA-256(message)
```

Siapa pun bisa menghitung digest tersebut. Jadi hash biasa hanya membuktikan:

```text
message saat dicek menghasilkan digest tertentu
```

Tapi hash biasa tidak membuktikan:

```text
message dibuat oleh pihak terpercaya
message tidak dimodifikasi oleh attacker yang juga bisa menghitung hash baru
```

MAC:

```text
tag = HMAC(secretKey, message)
```

Hanya pihak yang punya `secretKey` yang bisa membuat tag valid.

Jadi MAC memberi dua guarantee utama:

```text
1. Integrity
   Message tidak berubah sejak tag dibuat.

2. Authenticity
   Message dibuat/dikirim oleh pihak yang memiliki secret key yang sama.
```

Namun MAC **tidak memberi confidentiality**.

Artinya:

```text
message + HMAC(message)
```

tetap membuat message bisa dibaca siapa pun yang melihat traffic/storage, kecuali transport/storage-nya juga dienkripsi.

---

### 1.2 MAC Memberi Authenticity Simetris

MAC memakai shared secret.

Jika Alice dan Bob sama-sama tahu key `K`, lalu Bob menerima:

```text
message
tag = HMAC(K, message)
```

Bob tahu bahwa message dibuat oleh seseorang yang punya `K`.

Tetapi Bob tidak bisa membuktikan kepada pihak ketiga bahwa Alice yang membuatnya, karena Bob sendiri juga bisa membuat tag valid.

Maka:

```text
MAC:
  - bagus untuk internal trust antara dua sistem
  - bagus untuk webhook, service-to-service, integrity token
  - tidak cocok untuk non-repudiation/legal proof terhadap pihak ketiga

Digital signature:
  - private key hanya di signer
  - public key bisa dipakai verifier
  - lebih cocok untuk non-repudiation dan multi-verifier environment
```

---

### 1.3 MAC Tidak Mencegah Replay Sendirian

Ini salah satu poin terpenting.

Jika attacker melihat request valid:

```http
POST /payment/confirm
X-Timestamp: 2026-06-16T10:00:00Z
X-Signature: valid-hmac

{"paymentId":"P-123","status":"confirmed"}
```

HMAC membuktikan message tidak berubah. Tapi attacker bisa mengirim ulang request yang sama.

Jika server hanya mengecek HMAC, replay bisa tetap valid.

Jadi invariant-nya:

```text
HMAC proves "not tampered".
HMAC alone does not prove "not replayed".
```

Untuk mencegah replay, MAC harus digabung dengan:

```text
- timestamp
- nonce
- idempotency key
- request id
- monotonic sequence
- replay cache
- narrow validity window
```

---

## 2. Hash vs MAC vs Signature vs AEAD

| Primitive | Key? | Confidentiality | Integrity | Authenticity | Non-repudiation | Typical Use |
|---|---:|---:|---:|---:|---:|---|
| Checksum | No | No | Accidental error only | No | No | corruption detection |
| Hash | No | No | weak against active attacker | No | No | fingerprint, dedup, manifest when digest is trusted separately |
| MAC/HMAC | Shared secret | No | Yes | Yes, symmetric | No | webhook, service-to-service signing, integrity token |
| Digital Signature | Private/public key | No | Yes | Yes, asymmetric | Sometimes, depending on key custody/legal process | signed document, artifact, multi-party verification |
| AEAD | Symmetric key | Yes | Yes | Yes, symmetric | No | encrypted payload with tamper protection |

Decision rule:

```text
Need to hide data?
  Use authenticated encryption / AEAD.

Need to prove data was not tampered and both sides share a secret?
  Use HMAC or equivalent MAC.

Need anyone with public key to verify and signer cannot deny easily?
  Use digital signature.

Need only detect accidental corruption?
  Use checksum/hash, not MAC.
```

---

## 3. Java API Map

### 3.1 Main Class: `javax.crypto.Mac`

Java exposes MAC through:

```java
javax.crypto.Mac
```

Typical usage:

```java
Mac mac = Mac.getInstance("HmacSHA256");
mac.init(secretKey);
byte[] tag = mac.doFinal(messageBytes);
```

Oracle documents `Mac` as the class for Message Authentication Code operations. Current Java platform documentation lists standard MAC algorithms including `HmacSHA1`, `HmacSHA256`, and `PBEWithHmacSHA256`; Java security standard names also include HMAC variants such as `HmacSHA224`, `HmacSHA384`, `HmacSHA512`, and SHA-3 variants depending on platform/provider support.

### 3.2 Secret Key Type

For HMAC:

```java
SecretKeySpec key = new SecretKeySpec(keyBytes, "HmacSHA256");
```

Important:

```text
The algorithm name in SecretKeySpec should match intended MAC usage.
Do not reuse AES encryption keys as HMAC keys.
Do not derive MAC keys by string concatenation.
Use proper key separation.
```

### 3.3 Standard Algorithm Names

Common names:

```text
HmacSHA256
HmacSHA384
HmacSHA512
HmacSHA3-256
HmacSHA3-512
```

Practical default:

```text
HmacSHA256
```

For long-term conservative designs:

```text
HmacSHA256 or HmacSHA512
```

Avoid for new systems:

```text
HmacMD5
HmacSHA1
```

Even though HMAC-SHA1 is not the same as raw SHA-1 collision usage, new systems should avoid creating fresh dependency on SHA-1-era primitives unless there is a strict compatibility reason.

---

## 4. HMAC Deep Dive

### 4.1 What HMAC Solves

Naive construction:

```text
SHA-256(secret || message)
```

looks tempting but is not the right design.

Problems include:

1. Length-extension risks for Merkle-Damgård hashes when constructed incorrectly.
2. Ambiguous input boundaries.
3. No standard security proof for ad-hoc construction.
4. Easy misuse by future maintainers.

HMAC exists to avoid that.

Conceptually:

```text
HMAC(K, m) = H((K' xor opad) || H((K' xor ipad) || m))
```

You do not implement this yourself in application code. You use `Mac`.

---

### 4.2 HMAC Key Length

For HMAC-SHA256:

```text
reasonable key length: 256 bits / 32 bytes
```

For HMAC-SHA512:

```text
reasonable key length: 512 bits / 64 bytes
```

But the important part is:

```text
Generate keys using SecureRandom or KMS.
Do not use human passwords as raw HMAC keys.
If deriving from password, use password KDF first.
If deriving from master key, use HKDF/KDF with context.
```

Bad:

```java
byte[] key = "my-secret".getBytes(StandardCharsets.UTF_8);
```

Better:

```java
byte[] key = new byte[32];
SecureRandom.getInstanceStrong().nextBytes(key);
```

In production, key material should usually come from:

```text
- KMS
- HSM
- secret manager
- provisioned secret material
- derived key from a root key using a KDF
```

not hardcoded strings.

---

### 4.3 HMAC Output Length and Truncation

HMAC-SHA256 produces 32 bytes.

Can you truncate it?

Sometimes, but it must be a deliberate protocol decision.

Practical guidance:

```text
Internal request signing:
  Prefer full 32 bytes encoded as hex/base64url.

Short token:
  Avoid truncation unless you can reason about brute-force probability, rate limits, and token lifetime.

Do not truncate below 128 bits for serious authentication.
```

Example:

```text
Full HMAC-SHA256:
  256-bit tag

Truncated:
  128-bit tag may be acceptable in constrained protocols with rate limits

Danger:
  32-bit / 64-bit tags are often too small for online brute force or high-volume systems
```

---

## 5. CMAC Deep Dive

### 5.1 What CMAC Is

CMAC is a MAC built from a block cipher, commonly AES.

NIST SP 800-38B specifies CMAC and states it may be used to assure authenticity and integrity of binary data.

Conceptually:

```text
CMAC_AES(K, message)
```

Use case:

```text
- environments where AES hardware primitive is dominant
- protocol compatibility
- smart cards / constrained systems
- existing standards requiring CMAC
```

For most Java enterprise services, HMAC-SHA256 is simpler and more common.

---

### 5.2 CMAC in Java

The default JDK providers may not expose `AESCMAC` uniformly as a standard `Mac` algorithm across all Java distributions.

In practice, if you need CMAC in Java, you often use a provider/library such as:

```text
- Bouncy Castle
- vendor crypto provider
- HSM/KMS provider
```

Example shape with provider support:

```java
Mac mac = Mac.getInstance("AESCMAC", provider);
mac.init(new SecretKeySpec(keyBytes, "AES"));
byte[] tag = mac.doFinal(message);
```

Do not assume `"AESCMAC"` exists in every runtime.

Provider portability must be part of the design.

---

### 5.3 HMAC vs CMAC

| Dimension | HMAC | CMAC |
|---|---|---|
| Primitive | Hash function | Block cipher |
| Common Java availability | Very common | Provider-dependent |
| Default recommendation | HMAC-SHA256 | Use when protocol requires |
| Hardware acceleration | SHA may be accelerated | AES often accelerated |
| Misuse resistance | Good if using `Mac` correctly | Good if provider is correct |
| Enterprise API signing | Very common | Less common |

Default:

```text
Use HMAC-SHA256 unless a protocol, hardware, compliance, or interoperability constraint requires CMAC.
```

---

## 6. MAC as an Integrity Boundary

A MAC is not just a crypto operation. It defines a boundary:

```text
Everything included in the MAC is protected.
Everything excluded from the MAC is attacker-controlled.
```

This is the core engineering invariant.

Example:

```http
POST /api/case/approve
X-Signature: HMAC(secret, body)

{"caseId":"C-123","decision":"APPROVED"}
```

If only body is signed, an attacker may alter:

```text
- HTTP method
- path
- query string
- host
- content type
- timestamp header
- tenant header
- user header
```

depending on how infrastructure forwards the request.

Safer signed material:

```text
method
path
canonical query string
selected headers
body hash
timestamp
nonce/request id
algorithm version
key id
```

The signed material should represent the actual security decision context.

---

## 7. Canonicalization: The Most Common MAC Design Bug

### 7.1 Why Canonicalization Matters

MAC verifies bytes.

Applications interpret structure.

If signer and verifier do not build the exact same byte sequence, verification fails or, worse, verification succeeds over a different interpretation.

Common ambiguity sources:

```text
- JSON field order
- JSON whitespace
- Unicode normalization
- URL encoding
- repeated query parameters
- case sensitivity in headers
- path normalization
- trailing slash
- default port
- percent encoding
- line endings
- charset assumptions
- number formatting
- timezone formatting
```

Bad design:

```text
HMAC(secret, jsonString)
```

where each side may serialize JSON differently.

Better design:

```text
HMAC(secret, canonicalRequest)
```

where `canonicalRequest` has a strict documented format.

---

### 7.2 Canonical Request Example

A robust canonical request format:

```text
MAC-V1
POST
/api/v1/cases/C-123/decision
decision=approve&reason=complete
content-type:application/json
x-request-id:01JZ...
x-timestamp:2026-06-16T10:15:30Z
sha256:8f2c...
```

Then sign:

```text
tag = HMAC-SHA256(signingKey, UTF8(canonicalRequest))
```

Notice:

```text
- body itself is not included raw
- body hash is included
- selected headers are normalized
- method and path are included
- timestamp and request id are included
- algorithm/protocol version is included
```

---

### 7.3 Canonicalization Rules Must Be Boring

Rules should be deterministic and boring:

```text
1. Method uppercase.
2. Path exactly as received after reverse proxy normalization policy.
3. Query parameters sorted by byte-order of encoded key/value.
4. Header names lowercase.
5. Header values trimmed using a precise rule.
6. Multiple spaces collapsed only if explicitly specified.
7. Body digest computed over exact raw bytes received.
8. Charset fixed to UTF-8 for canonical request string.
9. Timestamp format fixed to RFC 3339/ISO-8601 instant.
10. Newline fixed to '\n'.
```

Do not rely on “whatever framework gives me.”

---

## 8. Request Signing Pattern

### 8.1 Request Signing Invariant

A signed request should satisfy:

```text
The receiver can verify that:
  - the request was produced by a holder of the shared secret
  - the protected request parts were not changed
  - the request is recent enough
  - the request was not already processed
  - the key and algorithm are identifiable
```

### 8.2 Recommended Headers

Example:

```http
X-Signature-Version: v1
X-Signature-Key-Id: partner-a-2026-01
X-Signature-Algorithm: HMAC-SHA256
X-Signature-Timestamp: 2026-06-16T10:15:30Z
X-Signature-Nonce: 01JZ4R8R61QJXS...
X-Signature: base64url(...)
```

Why each exists:

| Header | Purpose |
|---|---|
| version | protocol evolution |
| key id | key lookup and rotation |
| algorithm | explicit crypto choice, often whitelisted |
| timestamp | replay window |
| nonce/request id | replay cache |
| signature | MAC tag |

Do not allow arbitrary algorithm negotiation.

Bad:

```text
Client says algorithm=HmacMD5 and server accepts dynamically.
```

Good:

```text
Server maps version/key-id to allowed algorithm.
Client header is checked against server-side allowlist.
```

---

### 8.3 Signing String

Example:

```text
v1
HMAC-SHA256
2026-06-16T10:15:30Z
01JZ4R8R61QJXS...
POST
/api/v1/cases/C-123/decision
decision=approve
content-type:application/json
sha256:8f2c...
```

The exact format must be part of the protocol.

Avoid this:

```text
method + path + timestamp + body
```

without delimiters.

Why?

```text
"AB" + "C" == "A" + "BC"
```

Ambiguous concatenation can produce equivalent strings from different fields.

Use:

```text
- newline-delimited fields with escaping rules
- length-prefixed fields
- canonical JSON with strict rules
- binary encoding with field lengths
```

Length-prefixed example:

```text
2:V1
4:POST
24:/api/v1/cases/C-123/...
64:<body-sha256-hex>
```

---

## 9. Java Implementation: HMAC Utility

### 9.1 Minimal Correct HMAC

```java
import javax.crypto.Mac;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import java.security.GeneralSecurityException;
import java.util.Base64;

public final class Hmacs {
    private Hmacs() {}

    public static byte[] hmacSha256(byte[] keyBytes, byte[] message) {
        try {
            SecretKey key = new SecretKeySpec(keyBytes, "HmacSHA256");
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(key);
            return mac.doFinal(message);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("HMAC-SHA256 is unavailable", e);
        }
    }

    public static String hmacSha256Base64Url(byte[] keyBytes, byte[] message) {
        byte[] tag = hmacSha256(keyBytes, message);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(tag);
    }
}
```

Good enough for basic operation, but incomplete as a protocol because it does not cover:

```text
- key id
- version
- timestamp
- nonce
- canonicalization
- replay cache
- constant-time comparison
- rotation
```

---

### 9.2 Constant-Time Verification

Do not compare signatures with:

```java
expected.equals(actual)
Arrays.equals(expectedBytes, actualBytes)
String.equals(...)
```

Use a constant-time comparison designed for digest equality:

```java
MessageDigest.isEqual(expected, actual)
```

Example:

```java
import java.security.MessageDigest;

public static boolean constantTimeEquals(byte[] expected, byte[] actual) {
    return MessageDigest.isEqual(expected, actual);
}
```

Important nuance:

```text
Do not compare encoded strings if you can compare decoded bytes.
Reject malformed base64 before comparison.
Normalize signature encoding strictly.
```

---

### 9.3 Verification Skeleton

```java
public final class HmacVerifier {
    private final KeyResolver keyResolver;
    private final ReplayCache replayCache;
    private final Clock clock;

    public HmacVerifier(KeyResolver keyResolver, ReplayCache replayCache, Clock clock) {
        this.keyResolver = keyResolver;
        this.replayCache = replayCache;
        this.clock = clock;
    }

    public VerificationResult verify(SignedRequest request) {
        SignatureHeaders headers = request.signatureHeaders();

        if (!"v1".equals(headers.version())) {
            return VerificationResult.reject("unsupported_version");
        }

        if (!"HMAC-SHA256".equals(headers.algorithm())) {
            return VerificationResult.reject("unsupported_algorithm");
        }

        Instant timestamp;
        try {
            timestamp = Instant.parse(headers.timestamp());
        } catch (DateTimeParseException e) {
            return VerificationResult.reject("invalid_timestamp");
        }

        Duration skew = Duration.between(timestamp, clock.instant()).abs();
        if (skew.compareTo(Duration.ofMinutes(5)) > 0) {
            return VerificationResult.reject("stale_request");
        }

        String replayKey = headers.keyId() + ":" + headers.nonce();
        if (!replayCache.tryMarkSeen(replayKey, Duration.ofMinutes(10))) {
            return VerificationResult.reject("replay_detected");
        }

        SecretKeyMaterial key = keyResolver.resolve(headers.keyId());
        if (key == null || !key.isActiveForVerification()) {
            return VerificationResult.reject("unknown_key");
        }

        byte[] canonical = CanonicalRequests.buildV1(request);
        byte[] expected = Hmacs.hmacSha256(key.bytes(), canonical);

        byte[] provided;
        try {
            provided = Base64.getUrlDecoder().decode(headers.signature());
        } catch (IllegalArgumentException e) {
            return VerificationResult.reject("invalid_signature_encoding");
        }

        if (!MessageDigest.isEqual(expected, provided)) {
            return VerificationResult.reject("invalid_signature");
        }

        return VerificationResult.accept(headers.keyId(), timestamp);
    }
}
```

This is intentionally more protocol-like than a one-liner.

Security lives in the protocol.

---

## 10. Replay Protection

### 10.1 Timestamp Window

A timestamp window limits how long captured requests remain valid.

Example policy:

```text
Accept only if abs(now - timestamp) <= 5 minutes.
```

But timestamp alone does not stop replay within 5 minutes.

It only narrows the window.

### 10.2 Nonce / Request ID

A nonce/request id lets receiver remember:

```text
I have already accepted this signed request.
```

Replay cache:

```text
key = keyId + ":" + nonce
ttl = replayWindow + clockSkewAllowance
```

Storage options:

```text
- Redis SET NX EX
- database unique constraint
- in-memory cache for single-node non-critical systems
- distributed cache for horizontally scaled services
```

Redis shape:

```text
SET replay:partner-a-2026-01:01JZ... 1 NX EX 600
```

If result is not OK:

```text
reject replay
```

### 10.3 Idempotency Is Not the Same as Replay Protection

Idempotency says:

```text
Repeated same operation produces same outcome or same response.
```

Replay protection says:

```text
Repeated same signed message is rejected or ignored as duplicate.
```

For money, case approval, entitlement grant, account update, or legal decision:

```text
Use both.
```

---

## 11. Webhook Verification Pattern

Webhook security is a classic HMAC use case.

### 11.1 Threats

```text
- attacker sends fake webhook
- attacker modifies body
- attacker replays old valid webhook
- attacker abuses parser differences
- attacker floods invalid signature attempts
- attacker obtains stale/old secret
- developer verifies parsed JSON instead of raw body
```

### 11.2 Receiver Rules

```text
1. Read raw request body bytes.
2. Extract signature headers.
3. Validate timestamp freshness.
4. Build provider-specific canonical string exactly.
5. Resolve signing secret using key id or endpoint id.
6. Compute HMAC over raw/canonical bytes.
7. Compare using constant-time byte comparison.
8. Check nonce/event id replay.
9. Only then parse JSON and process event.
10. Process idempotently.
```

Critical:

```text
Verify raw bytes before parsing.
```

Bad:

```java
WebhookEvent event = objectMapper.readValue(body, WebhookEvent.class);
String normalized = objectMapper.writeValueAsString(event);
verifyHmac(normalized);
```

This may change:

```text
- field order
- whitespace
- number formatting
- escaped characters
- Unicode representation
```

Verify the bytes that were actually signed.

---

## 12. Integrity Tokens

### 12.1 What Is an Integrity Token?

An integrity token is a compact blob that contains claims plus a MAC.

Example:

```text
base64url(payload) + "." + base64url(hmac(secret, payload))
```

Use cases:

```text
- unsubscribe link token
- password reset link token
- email verification token
- one-time action token
- tamper-proof page cursor
- short-lived form state
- anti-tampering redirect state
```

But be careful: once you create this, you are designing a token protocol.

---

### 12.2 Recommended Token Structure

Example payload:

```json
{
  "v": 1,
  "typ": "password-reset",
  "sub": "user-123",
  "iat": 1781594400,
  "exp": 1781595300,
  "jti": "01JZ4R8R61QJXS...",
  "ctx": {
    "purpose": "reset-password"
  }
}
```

Signing input:

```text
base64url(canonicalPayload)
```

Token:

```text
v1.<keyId>.<payloadB64>.<tagB64>
```

Recommended validation:

```text
1. Parse token structure.
2. Check version.
3. Resolve key id.
4. Verify MAC before trusting claims.
5. Parse payload.
6. Check type/purpose.
7. Check exp/iat.
8. Check jti replay/one-time use if required.
9. Check subject still valid.
10. Enforce business invariant.
```

Do not trust payload before MAC verification.

---

### 12.3 Do Not Invent JWT Unless Needed

If you need standard ecosystem interoperability:

```text
Use JWT/JWS with a well-maintained library.
```

If it is purely internal and tiny:

```text
A simple versioned HMAC token may be fine.
```

But never do halfway:

```text
base64(json).base64(hmac)
```

without:

```text
- version
- key id
- expiry
- purpose
- replay/jti when needed
- strict verification order
- canonicalization
- algorithm allowlist
```

---

## 13. MAC and Encryption Composition

### 13.1 Encrypt-then-MAC

For legacy non-AEAD modes:

```text
ciphertext = Encrypt(encKey, plaintext)
tag = MAC(macKey, associatedData || ciphertext)
```

Verification:

```text
1. Verify MAC first.
2. Only decrypt if MAC valid.
```

This prevents many padding oracle style attacks.

### 13.2 MAC-then-Encrypt

Usually avoid for application design.

Historically seen in protocols, but easy to get wrong.

### 13.3 Encrypt-and-MAC

Can be okay in some protocols but easier to misuse.

Default:

```text
Use AEAD such as AES-GCM or ChaCha20-Poly1305.
```

If you must compose manually:

```text
Use Encrypt-then-MAC with independent keys.
```

OWASP guidance also emphasizes authenticated modes where possible and, for separated encryption/authentication designs, independent keys and post-encryption authentication.

---

## 14. Key Separation

Never reuse the same key for multiple purposes.

Bad:

```text
K used for AES encryption
K used for HMAC request signing
K used for token signing
K used for webhook verification
```

Better:

```text
rootKey
  -> HKDF context "case-file-encryption:v1" -> encKey
  -> HKDF context "case-file-mac:v1"        -> macKey
  -> HKDF context "webhook-signing:v1"      -> webhookKey
  -> HKDF context "reset-token:v1"          -> resetTokenKey
```

Why key separation matters:

```text
- limits blast radius
- prevents cross-protocol attacks
- supports independent rotation
- clarifies audit and ownership
- prevents one primitive's misuse from compromising another domain
```

---

## 15. Key Rotation for MAC

### 15.1 MAC Rotation Problem

MAC verification needs old keys while old signed messages/tokens are still valid.

Therefore keys have lifecycle states:

```text
PENDING
ACTIVE_SIGNING
VERIFY_ONLY
RETIRED
DESTROYED
```

Signing:

```text
Use only ACTIVE_SIGNING key.
```

Verification:

```text
Accept ACTIVE_SIGNING and VERIFY_ONLY keys if token/request is within allowed validity.
```

### 15.2 Key ID

Always include `keyId`.

Without key id, verifier may try all keys:

```text
- slower
- leaks timing differences if poorly implemented
- complicates audit
- makes rotation ambiguous
```

Header:

```http
X-Signature-Key-Id: partner-a-2026-06
```

Token:

```text
v1.partner-a-2026-06.payload.tag
```

### 15.3 Rotation Invariant

```text
A compromised key must have bounded blast radius.
```

To achieve that:

```text
- short token lifetime
- key id
- replay detection
- audit logs
- separate keys per partner/purpose/environment
- emergency disable switch
- rotate old key to verify-only, then retired
```

---

## 16. Multi-Tenant and Partner Integration

For partner integrations:

```text
partner A must not share MAC key with partner B
tenant A must not share MAC key with tenant B
prod must not share MAC key with UAT
internal service A->B must not reuse public webhook key
```

Key scope should be explicit:

```text
scope = environment + partner + direction + purpose + version
```

Example:

```text
prod:partner-acme:incoming-webhook:v1:2026-06
prod:case-service:to-document-service:request-signing:v1:2026-06
uat:partner-acme:incoming-webhook:v1:2026-06
```

Avoid global shared secrets.

Global secrets create catastrophic blast radius.

---

## 17. MAC in Distributed Java Systems

### 17.1 Message Broker Integrity

For Kafka/RabbitMQ/internal queues, TLS and broker ACLs help, but do not necessarily protect against all internal tampering or confused-producer cases.

MAC can protect message content:

```json
{
  "headers": {
    "sigVersion": "v1",
    "keyId": "case-events-2026-06",
    "algorithm": "HMAC-SHA256",
    "timestamp": "2026-06-16T10:15:30Z",
    "eventId": "01JZ..."
  },
  "payload": {
    "caseId": "C-123",
    "eventType": "CASE_APPROVED"
  },
  "signature": "..."
}
```

Signed material should include:

```text
- event type
- aggregate id
- event id
- timestamp
- schema version
- payload digest/canonical payload
- producer identity if needed
```

### 17.2 Outbox Pattern and MAC

If event integrity matters:

```text
1. Write business state.
2. Write outbox event.
3. Include event digest/MAC in outbox row.
4. Relay publishes exactly the signed payload.
5. Consumer verifies signature before applying state transition.
```

MAC protects against:

```text
- accidental modification in relay
- unauthorized internal mutation
- corrupted payload in transit/storage
```

It does not solve:

```text
- producer intentionally lying
- wrong business transition before signing
- consumer authorization bug
```

---

## 18. Common Misuse Patterns

### 18.1 Using Plain SHA-256 as Signature

Bad:

```text
X-Signature: SHA256(body)
```

Attacker can modify body and recompute digest.

Use:

```text
X-Signature: HMAC-SHA256(secret, canonicalRequest)
```

---

### 18.2 Signing Parsed JSON Instead of Raw Body

Bad:

```text
parse JSON -> serialize JSON -> verify
```

Use:

```text
verify raw body bytes or strict canonical form
```

---

### 18.3 Omitting Method and Path

Bad:

```text
HMAC(secret, body)
```

An attacker may replay body to another endpoint if routing/auth permits.

Use:

```text
HMAC(secret, method + path + query + headers + bodyDigest + timestamp + nonce)
```

---

### 18.4 No Replay Defense

Bad:

```text
if signature valid -> process
```

Use:

```text
if signature valid and timestamp fresh and nonce unseen -> process
```

---

### 18.5 Accepting Client-Chosen Algorithm

Bad:

```java
Mac.getInstance(request.getHeader("X-Alg"));
```

Use:

```java
if (!"HMAC-SHA256".equals(headerAlg)) reject;
Mac.getInstance("HmacSHA256");
```

Better:

```text
server maps version/key-id to algorithm
```

---

### 18.6 Comparing Hex Strings with `equals`

Bad:

```java
expectedHex.equals(providedHex)
```

Use:

```java
MessageDigest.isEqual(expectedBytes, providedBytes)
```

---

### 18.7 Logging Secrets or Signatures Carelessly

Do not log:

```text
- secret key
- raw Authorization header
- full token if bearer-like
- HMAC secret
```

Signature itself is usually less sensitive than secret, but can still help replay if timestamp/nonce weakness exists. Log carefully:

```text
keyId
signature prefix
reason code
request id
partner id
timestamp skew
```

---

### 18.8 Reusing Key Across Purposes

Bad:

```text
same key for reset token, webhook, and service request
```

Use per-purpose keys.

---

### 18.9 Ambiguous String Concatenation

Bad:

```text
HMAC(K, userId + action + timestamp)
```

Use:

```text
length-prefixed fields
canonical JSON
newline-delimited with strict escaping
```

---

### 18.10 Not Versioning the Protocol

Bad:

```text
X-Signature: ...
```

Use:

```text
X-Signature-Version: v1
X-Signature-Key-Id: ...
X-Signature-Algorithm: HMAC-SHA256
```

---

## 19. Production-Grade Verification Flow

```text
receive request
  ↓
extract signature headers
  ↓
reject missing/duplicated malformed headers
  ↓
check version allowlist
  ↓
check algorithm allowlist
  ↓
resolve key by key id + partner + environment + purpose
  ↓
check timestamp freshness
  ↓
check nonce format
  ↓
mark nonce/request id as seen atomically
  ↓
compute body digest over raw bytes
  ↓
build canonical request
  ↓
compute expected HMAC
  ↓
constant-time compare decoded tag bytes
  ↓
parse body
  ↓
validate schema
  ↓
authorize business operation
  ↓
process idempotently
  ↓
audit success/failure
```

Important ordering:

```text
Do not parse and trust body before signature verification.
Do not mutate business state before replay check.
Do not accept unknown key id.
Do not let algorithm come from user input dynamically.
```

---

## 20. Error Handling and Side Channels

### 20.1 What Error Should Client See?

External response should be boring:

```http
401 Unauthorized
```

or:

```http
403 Forbidden
```

with:

```json
{"error":"invalid_signature"}
```

Avoid revealing too much:

```text
unknown_key
bad_timestamp
invalid_nonce
invalid_signature
```

Internally log structured reason codes.

### 20.2 Timing Differences

Potential leak:

```text
unknown key returns immediately
known key computes HMAC
```

In most API/webhook settings, this is usually less critical than password verification timing, but high-security APIs should reduce observable differences.

Practical approach:

```text
- use key id that is not secret
- rate limit invalid attempts
- avoid detailed external errors
- constant-time compare tags
- monitor failures
```

---

## 21. Testing Strategy

### 21.1 Known Answer Test

Use known key/message/signature fixtures.

```java
@Test
void hmacSha256KnownAnswer() {
    byte[] key = hex("000102030405060708090a0b0c0d0e0f"
                   + "101112131415161718191a1b1c1d1e1f");
    byte[] msg = "hello".getBytes(StandardCharsets.UTF_8);

    String tag = Hmacs.hmacSha256Base64Url(key, msg);

    assertEquals("...", tag);
}
```

Use official test vectors where possible for primitive tests.

### 21.2 Tamper Tests

Every protected field should have a negative test:

```text
change method -> reject
change path -> reject
change query -> reject
change body byte -> reject
change content type -> reject if signed
change timestamp -> reject
change nonce -> reject unless signature recomputed
change key id -> reject
change version -> reject
```

### 21.3 Replay Tests

```text
first request -> accept
same request again -> reject replay
same signature with old timestamp -> reject stale
same body with new nonce but old signature -> reject invalid signature
```

### 21.4 Parser/CANON Tests

Test equivalent-looking inputs:

```text
/a/b vs /a//b
%2F vs /
space vs %20 vs +
header case
duplicate headers
duplicate query params
Unicode composed vs decomposed
JSON field order
line endings \r\n vs \n
```

### 21.5 Rotation Tests

```text
active key signs -> accept
verify-only key verifies old token -> accept
verify-only key cannot sign new token
retired key rejects
unknown key rejects
expired token signed by old key rejects
```

---

## 22. Observability and Audit

Log security-relevant fields:

```text
event = signature_verification_failed
partner_id
key_id
version
algorithm
reason_code
timestamp_skew_ms
request_id
nonce_prefix/hash
source_ip
route
correlation_id
```

Do not log:

```text
raw secret
full token
full signature if it can be replayed
sensitive body
password reset token
bearer tokens
```

Metrics:

```text
signature.verify.success.count
signature.verify.failure.count by reason
signature.timestamp.skew.histogram
signature.replay.detected.count
signature.unknown_key.count
signature.invalid_encoding.count
```

Alert on:

```text
- spike in invalid signatures
- unknown key attempts
- replay attempts
- timestamp skew spikes
- signature failures from same partner after rotation
```

---

## 23. Case Study: Regulatory Case Event Integrity

Suppose `case-service` emits an event:

```json
{
  "eventId": "01JZ4R8R61QJXS",
  "caseId": "CASE-2026-000123",
  "eventType": "CASE_DECISION_RECORDED",
  "decision": "WARNING_LETTER",
  "actor": "officer-812",
  "occurredAt": "2026-06-16T10:15:30Z"
}
```

Threats:

```text
- internal compromised worker changes decision
- integration bug changes caseId
- replay old decision event
- event relay corrupts payload
- consumer receives event from wrong producer
```

Security design:

```text
1. Producer has per-purpose HMAC key:
   prod:case-service:case-events:v1:2026-06

2. Producer canonicalizes event envelope:
   version
   producer
   eventId
   eventType
   aggregateId
   occurredAt
   schemaVersion
   payloadSha256

3. Producer signs canonical envelope.

4. Consumer verifies:
   key id belongs to case-service event producer
   event type allowed
   timestamp sane
   event id unseen for this producer
   payload digest matches
   HMAC valid

5. Consumer applies idempotently:
   event id unique
   state transition valid
   actor authorization can be audited separately
```

Important:

```text
MAC can prove event was emitted by holder of producer key.
MAC cannot prove the business decision was correct.
```

For regulatory defensibility, combine:

```text
- authorization checks
- audit trail
- tamper-evident logs
- event signing/MAC
- immutable storage or append-only controls
- operational key custody
```

---

## 24. Design Checklist

Before approving a MAC design, ask:

```text
1. What exact data is protected by the MAC?
2. What important data is not protected?
3. Is the message confidential? If yes, why not AEAD?
4. Is symmetric authenticity sufficient?
5. Is non-repudiation required? If yes, why not digital signature?
6. How is the key generated?
7. Where is the key stored?
8. How is the key rotated?
9. Is there a key id?
10. Is there a protocol version?
11. Is algorithm selection server-controlled?
12. Is canonicalization deterministic?
13. Is raw body or body digest signed?
14. Are method/path/query/security-relevant headers signed?
15. Is timestamp included and checked?
16. Is nonce/request id included?
17. Is replay cache atomic and distributed?
18. Is comparison constant-time?
19. Are errors externally boring but internally observable?
20. Are tests covering tampering, replay, rotation, and canonicalization?
```

---

## 25. Implementation Checklist for Java

```text
Use:
  javax.crypto.Mac
  SecretKeySpec
  SecureRandom/KMS-generated key
  Base64 URL-safe encoding
  MessageDigest.isEqual for comparison
  strict canonicalization
  strict algorithm allowlist
  key id + version
  timestamp + nonce
  replay cache
  structured audit logs

Avoid:
  SHA256(secret + message)
  SHA256(message)
  String.equals for signatures
  dynamic Mac.getInstance(headerAlg)
  JSON reserialization before verify
  no timestamp
  no nonce
  global shared secret
  key reuse across purposes
  logging secrets
```

---

## 26. Mini Reference Implementation: Signed Request Model

```java
public record SignatureHeaders(
        String version,
        String keyId,
        String algorithm,
        String timestamp,
        String nonce,
        String signature
) {}

public record SignedRequest(
        String method,
        String path,
        String rawQuery,
        Map<String, List<String>> headers,
        byte[] body,
        SignatureHeaders signatureHeaders
) {}
```

Canonical builder:

```java
public final class CanonicalRequests {
    private CanonicalRequests() {}

    public static byte[] buildV1(SignedRequest request) {
        String bodyHash = sha256Hex(request.body());

        String canonical = String.join("\n",
                "MAC-V1",
                request.method().toUpperCase(Locale.ROOT),
                normalizePath(request.path()),
                normalizeQuery(request.rawQuery()),
                canonicalHeader(request, "content-type"),
                "x-signature-timestamp:" + request.signatureHeaders().timestamp(),
                "x-signature-nonce:" + request.signatureHeaders().nonce(),
                "sha256:" + bodyHash
        );

        return canonical.getBytes(StandardCharsets.UTF_8);
    }

    private static String canonicalHeader(SignedRequest request, String name) {
        List<String> values = request.headers().getOrDefault(name.toLowerCase(Locale.ROOT), List.of());
        if (values.size() != 1) {
            throw new IllegalArgumentException("Missing or duplicated signed header: " + name);
        }
        return name.toLowerCase(Locale.ROOT) + ":" + values.get(0).trim();
    }

    private static String normalizePath(String path) {
        // Protocol decision:
        // either sign exactly what edge forwards,
        // or apply one documented normalization rule.
        if (path == null || path.isBlank()) {
            throw new IllegalArgumentException("Missing path");
        }
        return path;
    }

    private static String normalizeQuery(String rawQuery) {
        // Real implementation should parse and sort encoded pairs deterministically.
        return rawQuery == null ? "" : rawQuery;
    }

    private static String sha256Hex(byte[] bytes) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(bytes);
            return HexFormat.of().formatHex(hash);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }
}
```

Note:

```text
This is not a drop-in universal standard.
It is a shape showing what must be made explicit.
Production canonicalization must be specified precisely.
```

---

## 27. Failure Modes

| Failure | Root Cause | Consequence | Prevention |
|---|---|---|---|
| Valid signature but wrong endpoint | path/method not signed | cross-endpoint replay | sign method/path/query |
| Replay accepted | no nonce cache | duplicate state change | timestamp + nonce + atomic cache |
| Valid body but wrong tenant | tenant header not signed | tenant boundary violation | sign tenant/security context |
| Signature mismatch between services | inconsistent canonicalization | integration outage | shared test vectors |
| Old key accepted forever | no key lifecycle | long blast radius | verify-only window + retirement |
| Weak algorithm accepted | dynamic algorithm | downgrade | allowlist |
| Timing leak | string compare | oracle-ish behavior | constant-time compare |
| Token valid for wrong purpose | no `typ`/purpose | confused token use | include purpose in MAC payload |
| Body modified after verification | mutable request object | TOCTOU bug | verify exact bytes processed |
| Secret leaked in logs | bad observability | full compromise | secret redaction |

---

## 28. Key Takeaways

1. A MAC gives **integrity** and **symmetric authenticity**, not confidentiality.
2. HMAC is usually the default MAC for Java enterprise systems.
3. CMAC is valid but usually provider/protocol-driven in Java.
4. MAC protects only what is included in the signing input.
5. Canonicalization is as important as the cryptographic primitive.
6. HMAC alone does not prevent replay.
7. Request signing needs version, key id, algorithm allowlist, timestamp, nonce, and canonical request.
8. Compare decoded signature bytes using constant-time comparison.
9. Keys must be separated by purpose and rotated with verify-only windows.
10. For encrypted data, prefer AEAD; if composing manually, use Encrypt-then-MAC with independent keys.

---

## 29. References

- Oracle Java `javax.crypto.Mac` API.
- Oracle Java Security Standard Algorithm Names.
- RFC 2104 — HMAC: Keyed-Hashing for Message Authentication.
- NIST SP 800-38B — Recommendation for Block Cipher Modes of Operation: The CMAC Mode for Authentication.
- NIST Message Authentication Codes project.
- NIST SP 800-107 Rev. 1 — Recommendation for Applications Using Approved Hash Algorithms.
- OWASP Cryptographic Storage Cheat Sheet.
- OWASP Key Management Cheat Sheet.
- OWASP Webhook/security guidance patterns from industry implementations.
- Java `MessageDigest.isEqual` API for digest comparison.

---

## 30. Status Seri

Kita baru menyelesaikan:

```text
Part 0  - Security Mental Model for Senior Java Engineers
Part 1  - Java Security Architecture
Part 2  - Threat Modeling for Java Systems
Part 3  - Cryptography Mental Model
Part 4  - Randomness, Entropy, Nonce, Salt, IV, Token
Part 5  - Hashing, Digest, Fingerprint, Checksum, and Integrity Boundaries
Part 6  - Password Storage, Password Verification, and Secret-Derived Keys
Part 7  - Symmetric Encryption in Java: AES, Modes, Padding, AEAD
Part 8  - Message Authentication Code: HMAC, CMAC, and Integrity Tokens
```

Seri **belum selesai**.

Masih tersisa:

```text
Part 9  - Digital Signature: RSA, ECDSA, EdDSA, Signing Semantics
Part 10 - Asymmetric Encryption and Key Agreement
Part 11 - Key Management: Lifecycle, Rotation, Wrapping, KMS, HSM
Part 12 - Java KeyStore, TrustStore, Certificates, and Private Key Custody
Part 13 - X.509, PKI, Certificate Path Validation, Revocation
Part 14 - TLS/JSSE Deep Dive for Java Engineers
Part 15 - TLS Hardening, Disabled Algorithms, and Runtime Security Properties
Part 16 - Secure Serialization, Deserialization, and Object Integrity
Part 17 - Secure File, Archive, and Data Transfer Integrity
Part 18 - XML Security, XXE, XML Signature, XML Encryption
Part 19 - JSON, JWT, JWS, JWE, JOSE, and Token Integrity
Part 20 - OAuth2/OIDC Security for Java Systems
Part 21 - Authorization Integrity: Policy, Permission, and Confused Deputy
Part 22 - Input Validation, Canonicalization, Injection Resistance
Part 23 - Secure Coding in Java: Dangerous APIs, Footguns, and Review Heuristics
Part 24 - Secrets Management in Java Applications
Part 25 - Secure Logging, Audit Trail Integrity, Evidence, and Non-Repudiation
Part 26 - Data Integrity in Distributed Java Systems
Part 27 - Supply Chain Security for Java: Maven, Gradle, SBOM, Provenance
Part 28 - Signed JARs, JAR Integrity, Classloading, and Runtime Trust
Part 29 - Secure Build, CI/CD, and Release Integrity for Java
Part 30 - Runtime Hardening: JVM, Container, OS, Network
Part 31 - Security Testing: Unit, Property, Fuzzing, SAST, DAST, IAST
Part 32 - Incident Response for Java Security Failures
Part 33 - Secure Design Patterns and Anti-Patterns for Java Enterprise Systems
Part 34 - Capstone: Designing a Secure Java Regulatory Case Management Platform
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-security-cryptography-integrity-part-007.md">⬅️ Part 7 — Symmetric Encryption in Java: AES, Modes, Padding, AEAD</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-security-cryptography-integrity-part-009.md">Part 9 — Digital Signature: RSA, ECDSA, EdDSA, Signing Semantics ➡️</a>
</div>
