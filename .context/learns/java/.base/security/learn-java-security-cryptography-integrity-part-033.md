# learn-java-security-cryptography-integrity-part-033

# Secure Design Patterns and Anti-Patterns for Java Enterprise Systems

> Seri: `learn-java-security-cryptography-integrity`  
> Part: `033`  
> Status seri: **belum selesai** — masih ada Part 34 sebagai capstone terakhir.  
> Fokus: mengubah seluruh prinsip security, cryptography, integrity, key management, TLS, token, audit, supply chain, runtime hardening, testing, dan incident response menjadi **reusable design patterns** dan **anti-pattern catalog** untuk sistem Java enterprise.

---

## 1. Tujuan Part Ini

Sampai Part 32, kita sudah membahas banyak lapisan:

- threat model;
- cryptographic guarantee;
- randomness, hash, password hashing;
- symmetric/asymmetric crypto;
- MAC, signature, key management;
- keystore, PKI, TLS;
- serialization, file integrity, XML, JWT/OIDC;
- authorization, validation, dangerous APIs;
- secrets management;
- audit trail integrity;
- distributed data integrity;
- supply chain, signed JAR, CI/CD;
- runtime hardening;
- security testing;
- incident response.

Part ini menyatukan semuanya menjadi **arsitektur yang bisa diulang**.

Tujuannya bukan menghafal nama pattern. Tujuannya adalah membangun kemampuan untuk melihat sistem Java enterprise dan bertanya:

1. **Di mana trust boundary-nya?**
2. **Security property apa yang harus dijamin?**
3. **Invariant apa yang tidak boleh rusak?**
4. **Pattern apa yang menjaga invariant itu?**
5. **Anti-pattern apa yang sedang mengancam desain?**
6. **Bagaimana desain ini gagal di production?**
7. **Bagaimana kita mendeteksi, mengaudit, dan memulihkan kegagalannya?**

Security pattern yang baik bukan “potongan solusi”. Security pattern yang baik adalah **cara menempatkan kontrol di lokasi yang benar dalam sistem**.

---

## 2. Mental Model Utama

### 2.1 Security Pattern adalah Invariant yang Diulang

Pattern bukan sekadar template kode.

Pattern adalah bentuk stabil dari jawaban terhadap masalah yang sering muncul.

Contoh:

```text
Masalah:
  Service menerima command penting dari actor eksternal.

Threat:
  Command dipalsukan, diubah, dikirim ulang, atau dieksekusi oleh actor yang tidak berwenang.

Security invariant:
  Hanya command yang autentik, authorized, fresh, complete, dan belum diproses yang boleh mengubah state.

Pattern:
  Signed Command + Authorization Boundary + Replay Protection + Idempotency + Audit Trail.
```

Kalau pattern hanya dipahami sebagai “pakai HMAC” maka desainnya rapuh. HMAC hanya satu kontrol. Pattern lengkap harus menjawab:

- siapa signer-nya;
- key apa yang dipakai;
- payload mana yang dicover;
- apakah metadata ikut ditandatangani;
- bagaimana canonicalization dilakukan;
- bagaimana replay dicegah;
- bagaimana idempotency dijaga;
- bagaimana hasilnya diaudit;
- bagaimana key dirotasi;
- bagaimana incident ditangani jika key bocor.

### 2.2 Security Design Harus Ditarik ke Kiri

Desain aman tidak boleh menunggu bug ditemukan di SAST/DAST.

SAST/DAST penting, tetapi banyak kelemahan besar tidak terlihat sebagai bug lokal. Contohnya:

- service A melakukan authorization, service B menganggap request internal pasti trusted;
- event penting tidak ditandatangani karena broker dianggap trusted;
- audit trail bisa diubah admin database;
- JWT divalidasi di API Gateway, tapi service downstream menerima token yang sudah tidak relevan;
- file upload divalidasi di UI, tapi batch ingestion menerima file dari SFTP tanpa validasi yang sama;
- artifact ditandatangani, tapi deployment mengambil image dari tag mutable `latest`;
- TLS aktif, tapi hostname verification dimatikan untuk “sementara”.

Itu bukan sekadar bug. Itu desain yang tidak punya invariant kuat.

### 2.3 Pattern Harus Membatasi Blast Radius

Security design yang matang tidak mengasumsikan semua kontrol selalu berhasil.

Pertanyaan senior:

```text
Jika kontrol ini gagal, seberapa jauh kerusakannya menyebar?
```

Contoh:

- jika token signing key bocor, apakah semua tenant terdampak?
- jika service account bocor, apakah bisa membaca semua case?
- jika audit writer compromise, apakah bisa menghapus audit lama?
- jika satu dependency disusupi, apakah build langsung memproduksi artifact production?
- jika TLS private key bocor, apakah historical traffic masih aman?

Pattern yang baik tidak hanya mencegah; pattern yang baik juga membatasi.

### 2.4 Anti-Pattern Biasanya Terlihat “Praktis”

Banyak anti-pattern security lahir dari alasan yang terdengar masuk akal:

```text
“Ini internal network.”
“Ini hanya admin.”
“Ini temporary bypass.”
“Ini biar cepat UAT.”
“Token sudah dicek di gateway.”
“File datang dari trusted partner.”
“DB admin memang bisa akses semua.”
“Kita encrypt saja semua field.”
“Kita log semua biar gampang debug.”
```

Security engineer yang baik tidak langsung berkata “tidak boleh”. Ia memecah asumsi itu:

- trusted karena apa?
- trust-nya dibuktikan dengan mekanisme apa?
- apakah trust itu masih benar setelah compromise?
- apakah trust itu berlaku untuk semua operation?
- apakah ada audit?
- apakah ada expiry?
- apakah ada rollback?
- apakah ada monitoring?
- apakah ada containment?

---

## 3. Peta Besar Pattern dalam Java Enterprise

Dalam sistem Java enterprise, secure design pattern biasanya jatuh ke beberapa kategori.

```text
Security Design Pattern Taxonomy

1. Boundary Patterns
   - Trust Gateway
   - Policy Enforcement Boundary
   - Token Verification Boundary
   - File Intake Boundary
   - Parser Isolation Boundary

2. Integrity Patterns
   - Signed Command
   - Signed Event
   - Tamper-Evident Audit Trail
   - Hash Chain
   - Integrity Manifest
   - Idempotent Receiver

3. Confidentiality Patterns
   - Secure Envelope
   - Envelope Encryption
   - Field-Level Encryption Boundary
   - Data Minimization Boundary

4. Identity and Authorization Patterns
   - Centralized Authentication, Distributed Authorization
   - PDP/PEP Split
   - Tenant Boundary Guard
   - Delegated Authority

5. Key and Secret Patterns
   - Key Ring
   - Versioned Key Identifier
   - KMS Envelope
   - Short-Lived Credential
   - Secret Injection Boundary

6. Runtime and Supply Chain Patterns
   - Verified Artifact Promotion
   - Signed Release
   - Immutable Runtime Image
   - Least-Privilege Runtime
   - Dependency Admission Gate

7. Observability and Recovery Patterns
   - Security Event Ledger
   - Compromise Playbook Binding
   - Detectable Control Failure
   - Evidence-Grade Logging
```

Bagian berikut akan membahas pattern paling penting satu per satu.

---

## 4. Pattern 1 — Trust Gateway Pattern

### 4.1 Masalah

Banyak sistem punya banyak entry point:

- public REST API;
- admin UI;
- callback/webhook;
- SFTP ingestion;
- batch import;
- message broker consumer;
- internal service API;
- scheduled job;
- integration adapter.

Anti-pattern umum: security hanya diletakkan di public REST API, sedangkan jalur lain dianggap “internal” atau “trusted”.

### 4.2 Intent

Trust Gateway Pattern memastikan setiap traffic yang masuk ke domain memiliki **entry boundary eksplisit** yang melakukan:

- authentication;
- source validation;
- schema validation;
- canonicalization;
- replay protection bila perlu;
- rate limiting bila relevan;
- request integrity verification;
- audit/security event recording;
- context normalization.

### 4.3 Struktur

```text
External Actor / Partner / System
        |
        v
+---------------------------+
| Trust Gateway             |
|---------------------------|
| authenticate source       |
| validate transport        |
| validate schema           |
| canonicalize input        |
| verify signature/MAC      |
| check replay/idempotency  |
| produce trusted context   |
+-------------+-------------+
              |
              v
+---------------------------+
| Domain Application        |
| consumes TrustedCommand   |
+---------------------------+
```

### 4.4 Java Mapping

Contoh mapping:

- Servlet filter / Jakarta filter / Spring filter;
- API gateway custom authorizer;
- message consumer adapter;
- SFTP file intake worker;
- batch ingestion pipeline;
- `HandlerInterceptor` untuk request context;
- dedicated module seperti `adapter.inbound` atau `boundary.inbound`.

Yang penting: gateway bukan hanya HTTP gateway. Gateway adalah **trust transition point**.

### 4.5 Invariant

```text
Tidak ada data hostile yang masuk ke domain layer tanpa melewati trust gateway.
```

### 4.6 Kesalahan Umum

```java
// Anti-pattern: service domain menerima raw request map dari controller/adapter.
public void approve(Map<String, Object> payload) {
    String caseId = (String) payload.get("caseId");
    String userId = (String) payload.get("userId");
    // domain logic langsung percaya payload
}
```

Lebih aman:

```java
public record TrustedApprovalCommand(
        CaseId caseId,
        ActorId actorId,
        Instant requestedAt,
        RequestId requestId,
        VerifiedSource source
) {}
```

Domain menerima command yang sudah melewati boundary, bukan raw hostile payload.

### 4.7 Review Questions

- Apakah semua entry point punya trust boundary?
- Apakah batch ingestion divalidasi seketat API?
- Apakah internal service call tetap diautentikasi?
- Apakah source identity dibuktikan atau hanya diasumsikan dari IP/network?
- Apakah hasil validasi disimpan sebagai typed trusted context?

---

## 5. Pattern 2 — Token Verification Boundary

### 5.1 Masalah

JWT/OIDC sering divalidasi di beberapa tempat secara tidak konsisten.

Contoh kegagalan:

- gateway hanya decode JWT tanpa verify signature;
- service downstream percaya header `X-User-Id` dari gateway tanpa mencegah spoofing;
- audience tidak dicek;
- issuer tidak dicek;
- `kid` dipakai untuk membaca file path lokal;
- expired token diterima karena clock skew terlalu longgar;
- service menerima token dari environment/realm berbeda;
- authorization mengambil role dari token lama yang belum direvokasi.

### 5.2 Intent

Token Verification Boundary memisahkan **token parsing** dari **verified security context**.

### 5.3 Struktur

```text
Raw Authorization Header
        |
        v
+------------------------------+
| Token Verification Boundary  |
|------------------------------|
| parse safely                 |
| enforce expected alg         |
| resolve trusted key          |
| verify signature             |
| validate iss/aud/exp/nbf     |
| validate nonce/state if flow |
| map claims to local context  |
+--------------+---------------+
               |
               v
VerifiedPrincipal / VerifiedClient / VerifiedSession
```

### 5.4 Java Mapping

Buat type eksplisit:

```java
public record VerifiedPrincipal(
        SubjectId subjectId,
        TenantId tenantId,
        Set<Role> roles,
        Set<Authority> authorities,
        String issuer,
        String audience,
        Instant authenticatedAt,
        Instant expiresAt
) {}
```

Jangan sebarkan raw JWT claims ke domain.

### 5.5 Invariant

```text
Business logic tidak pernah membaca claim langsung dari unverified token.
```

### 5.6 Anti-Pattern

```java
String token = authorization.substring("Bearer ".length());
String[] parts = token.split("\\.");
String claimsJson = new String(Base64.getUrlDecoder().decode(parts[1]));
// Anti-pattern: payload JWT dibaca tanpa signature verification.
```

### 5.7 Review Questions

- Apakah algorithm di-allowlist?
- Apakah issuer/audience dicek per service?
- Apakah JWKS source trusted?
- Apakah JWKS cache punya TTL dan failure policy?
- Apakah service downstream menerima identity dari trusted channel?
- Apakah header internal bisa dispoof oleh external client?

---

## 6. Pattern 3 — Policy Enforcement Boundary

### 6.1 Masalah

Authorization sering tersebar:

- sedikit di controller;
- sedikit di service;
- sedikit di repository;
- sedikit di frontend;
- sedikit di query SQL;
- sedikit di workflow engine.

Akibatnya sulit membuktikan bahwa setiap operation dilindungi.

### 6.2 Intent

Policy Enforcement Boundary memastikan setiap state-changing operation melewati authorization decision eksplisit.

### 6.3 Struktur

```text
Verified Principal
        |
        v
+--------------------+       +----------------------+
| Policy Enforcement | ----> | Policy Decision      |
| Point (PEP)        |       | Point (PDP)          |
+---------+----------+       +-----------+----------+
          |                              |
          v                              v
  Allow/Deny + reason              Policy rules
          |
          v
Domain Operation
```

### 6.4 Java Mapping

```java
public interface AuthorizationPolicy {
    AuthorizationDecision canApproveCase(
            VerifiedPrincipal principal,
            CaseSnapshot target,
            ApprovalAction action
    );
}
```

```java
public void approveCase(VerifiedPrincipal principal, CaseId caseId, ApprovalCommand command) {
    CaseSnapshot snapshot = caseRepository.getSnapshot(caseId);

    AuthorizationDecision decision = authorizationPolicy.canApproveCase(
            principal,
            snapshot,
            ApprovalAction.from(command)
    );

    if (decision.denied()) {
        securityAudit.recordDenied(principal, caseId, decision.reason());
        throw new ForbiddenException(decision.safeMessage());
    }

    caseAggregate.approve(command);
}
```

### 6.5 Invariant

```text
Tidak ada operation bernilai tinggi yang mengubah state tanpa authorization decision yang tercatat.
```

### 6.6 Anti-Pattern

```java
// Anti-pattern: hanya cek role generic.
@PreAuthorize("hasRole('OFFICER')")
public void approve(String caseId) {
    // Tidak cek ownership, tenant, status, assignment, delegation, conflict-of-interest.
}
```

Role tidak cukup untuk object-level authorization.

### 6.7 Review Questions

- Apakah authorization berbasis object dan action?
- Apakah denial diaudit?
- Apakah authorization dilakukan setelah target object diketahui?
- Apakah domain operation bisa dipanggil dari jalur lain tanpa PEP?
- Apakah policy bisa diuji dengan matrix?

---

## 7. Pattern 4 — Signed Command Pattern

### 7.1 Masalah

Command penting dapat dipalsukan atau diubah.

Contoh:

- callback payment;
- regulatory submission;
- partner integration;
- cross-agency data handoff;
- approval command;
- batch instruction;
- administrative operation.

TLS melindungi in transit, tetapi tidak selalu cukup untuk membuktikan command authenticity end-to-end.

### 7.2 Intent

Signed Command Pattern memastikan command memiliki:

- signer identity;
- payload integrity;
- timestamp/freshness;
- replay protection;
- canonical representation;
- key version;
- audit evidence.

### 7.3 Struktur

```text
Command Payload
  + metadata
  + timestamp
  + nonce/requestId
  + keyId
  + canonical form
        |
        v
Signature/MAC
        |
        v
SignedCommand Envelope
        |
        v
Verifier Boundary
        |
        v
TrustedCommand
```

### 7.4 Contoh Envelope

```json
{
  "version": "v1",
  "keyId": "partner-a-2026-q1",
  "algorithm": "HMAC-SHA256",
  "issuedAt": "2026-06-16T01:15:00Z",
  "expiresAt": "2026-06-16T01:20:00Z",
  "requestId": "7d2c43d4-08f2-4702-99df-0d4d70a0df8e",
  "payloadDigest": "sha256:...",
  "payload": {
    "caseId": "CASE-2026-00001",
    "action": "SUBMIT_EVIDENCE",
    "documentId": "DOC-999"
  },
  "signature": "base64url..."
}
```

### 7.5 Java Design

```java
public record SignedCommandEnvelope(
        String version,
        String keyId,
        String algorithm,
        Instant issuedAt,
        Instant expiresAt,
        String requestId,
        JsonNode payload,
        String signature
) {}
```

```java
public interface SignedCommandVerifier {
    VerifiedCommand verify(SignedCommandEnvelope envelope);
}
```

Verifier melakukan:

1. parse envelope;
2. validate version;
3. allowlist algorithm;
4. load key by `keyId` from trusted key registry;
5. canonicalize signed fields;
6. verify MAC/signature;
7. validate time window;
8. check replay store;
9. map payload ke typed command;
10. record verification event.

### 7.6 Invariant

```text
Command penting hanya dieksekusi setelah authenticity, integrity, freshness, dan replay status diverifikasi.
```

### 7.7 Anti-Pattern

```text
signature = HMAC(secret, body)
```

Ini belum tentu cukup. Yang sering tertinggal:

- HTTP method;
- path;
- query;
- content type;
- timestamp;
- nonce;
- tenant;
- target environment;
- key id;
- algorithm;
- canonicalization rule.

Akibatnya signature bisa valid tetapi maknanya berubah.

### 7.8 Review Questions

- Field mana yang ditandatangani?
- Apakah canonicalization deterministic?
- Apakah signature cover context, bukan hanya payload?
- Apakah requestId dicek idempotent/replay?
- Apakah keyId tidak bisa dipakai untuk path traversal/key confusion?
- Apakah verifier fail-closed?

---

## 8. Pattern 5 — Secure Envelope Pattern

### 8.1 Masalah

Data sensitif perlu disimpan atau dikirim dengan confidentiality dan integrity.

Kesalahan umum:

- hanya encrypt tanpa authentication;
- IV tidak disimpan;
- IV reuse;
- algorithm tidak disimpan;
- key rotation tidak mungkin karena tidak ada key id;
- payload format tidak versioned;
- decrypt langsung dipercaya tanpa AAD/context;
- encryption dipakai untuk password.

### 8.2 Intent

Secure Envelope Pattern membungkus ciphertext dengan metadata yang cukup untuk verifikasi dan evolusi aman.

### 8.3 Struktur

```text
Plaintext + Context/AAD
        |
        v
AEAD Encrypt with DEK
        |
        v
Secure Envelope:
  - version
  - alg
  - keyId
  - nonce/iv
  - aad/context
  - ciphertext
  - auth tag
```

### 8.4 Contoh Envelope

```json
{
  "version": "enc-v2",
  "alg": "AES-256-GCM",
  "keyId": "customer-data-key-2026-06",
  "nonce": "base64url...",
  "aad": {
    "tenantId": "tenant-a",
    "field": "identityNumber",
    "schemaVersion": "case-v3"
  },
  "ciphertext": "base64url...",
  "tag": "base64url..."
}
```

### 8.5 Java Mapping

Gunakan AEAD seperti AES-GCM atau ChaCha20-Poly1305 bila sesuai.

```java
public record EncryptedEnvelope(
        String version,
        String algorithm,
        String keyId,
        byte[] nonce,
        byte[] aad,
        byte[] ciphertextAndTag
) {}
```

### 8.6 Invariant

```text
Ciphertext tidak bisa didekripsi atau diterima sebagai valid kecuali context-nya cocok dengan AAD yang diharapkan.
```

### 8.7 Anti-Pattern

```java
Cipher cipher = Cipher.getInstance("AES");
```

Ini biasanya jatuh ke default mode/padding provider, sering kali ECB atau konfigurasi yang tidak diinginkan. Transformation harus eksplisit.

### 8.8 Review Questions

- Apakah encryption authenticated?
- Apakah format versioned?
- Apakah key id disimpan?
- Apakah nonce unique per key?
- Apakah AAD mengikat ciphertext ke tenant/field/context?
- Apakah rotation bisa dilakukan tanpa migration total?

---

## 9. Pattern 6 — Envelope Encryption Pattern

### 9.1 Masalah

Encrypt data langsung dengan master key menciptakan blast radius besar dan membuat rotation mahal.

### 9.2 Intent

Pisahkan:

- Data Encryption Key atau DEK;
- Key Encryption Key atau KEK.

DEK mengenkripsi data. KEK mengenkripsi DEK.

### 9.3 Struktur

```text
Plaintext
   |
   | encrypted by DEK
   v
Ciphertext

DEK
   |
   | wrapped by KEK/KMS/HSM
   v
Encrypted DEK

Envelope = ciphertext + encrypted DEK + key metadata
```

### 9.4 Kelebihan

- rotation KEK tidak perlu decrypt semua data;
- DEK bisa per object/per tenant/per batch;
- blast radius lebih kecil;
- KMS/HSM bisa mengontrol KEK;
- audit key usage lebih baik.

### 9.5 Java Mapping

```java
public record EnvelopeEncryptedPayload(
        String version,
        String kekId,
        String encryptedDek,
        String dataAlgorithm,
        byte[] nonce,
        byte[] ciphertextAndTag
) {}
```

### 9.6 Invariant

```text
Master key tidak pernah dipakai langsung untuk mengenkripsi data domain massal.
```

### 9.7 Anti-Pattern

```text
Satu AES key global disimpan di environment variable dan dipakai untuk semua tenant, semua field, semua tahun.
```

Jika key bocor, semua historical data terdampak.

### 9.8 Review Questions

- DEK scope apa: per object, per tenant, per batch, per field?
- KEK disimpan di mana?
- Apakah KEK rotation didukung?
- Apakah decrypt operation diaudit?
- Apakah cache plaintext DEK punya TTL?
- Apakah encrypted DEK ikut backup?

---

## 10. Pattern 7 — Tamper-Evident Audit Trail Pattern

### 10.1 Masalah

Audit trail sering dianggap aman karena berada di database.

Padahal:

- admin database bisa mengubah row;
- app bug bisa overwrite audit;
- migration script bisa menghapus audit;
- insider bisa menghapus evidence;
- log pipeline bisa drop event;
- ordering bisa berubah;
- timestamp bisa dimanipulasi.

### 10.2 Intent

Tamper-Evident Audit Trail Pattern membuat perubahan audit dapat dideteksi.

### 10.3 Struktur Hash Chain

```text
AuditRecord[0]
  hash0 = H(record0)

AuditRecord[1]
  hash1 = H(hash0 || canonical(record1))

AuditRecord[2]
  hash2 = H(hash1 || canonical(record2))
```

Untuk lebih kuat, anchor periodik bisa ditandatangani:

```text
DailyAnchor = Sign(privateKey, lastHashOfDay + metadata)
```

### 10.4 Java Mapping

```java
public record AuditRecord(
        String auditId,
        String eventType,
        String actorId,
        String targetType,
        String targetId,
        Instant occurredAt,
        JsonNode eventData,
        String previousHash,
        String currentHash,
        String keyId,
        String signature
) {}
```

### 10.5 Invariant

```text
Setiap perubahan terhadap urutan atau isi audit record dapat dideteksi.
```

### 10.6 Penting: Tamper-Evident Bukan Tamper-Proof

Hash chain tidak mencegah attacker menghapus semua audit jika ia menguasai storage penuh. Ia membantu mendeteksi bahwa audit sudah tidak valid.

Untuk memperkuat:

- append-only storage;
- WORM storage;
- offsite replication;
- signing anchor;
- independent time source;
- least privilege audit writer;
- separation of duties.

### 10.7 Anti-Pattern

```text
Audit table bisa UPDATE/DELETE oleh aplikasi biasa.
```

Audit trail harus append-only secara semantic dan permission.

### 10.8 Review Questions

- Apakah audit write-only dari aplikasi?
- Apakah audit update/delete dicegah?
- Apakah audit event canonicalized?
- Apakah hash/signature diverifikasi berkala?
- Apakah timestamp source reliable?
- Apakah actor, target, action, reason, result dicatat?

---

## 11. Pattern 8 — Signed Event Pattern

### 11.1 Masalah

Event-driven system sering mempercayai broker.

Padahal threat-nya:

- event dipalsukan oleh producer tidak sah;
- event diubah di transit/pipeline;
- event direplay;
- event dari tenant lain masuk;
- schema berubah tanpa versioning;
- consumer salah mengartikan event;
- event lama diproses setelah state berubah.

### 11.2 Intent

Signed Event Pattern memberikan authenticity dan integrity pada event, terutama jika event melewati boundary organisasi, network, atau trust domain.

### 11.3 Struktur

```text
Event Envelope
  - eventId
  - eventType
  - schemaVersion
  - producerId
  - tenantId
  - aggregateId
  - sequence
  - occurredAt
  - payload
  - signature/MAC
  - keyId
```

### 11.4 Java Mapping

```java
public record SignedDomainEvent<T>(
        EventId eventId,
        String eventType,
        String schemaVersion,
        String producerId,
        TenantId tenantId,
        String aggregateId,
        long sequence,
        Instant occurredAt,
        T payload,
        String keyId,
        String signature
) {}
```

### 11.5 Invariant

```text
Consumer tidak memproses event state-changing dari trust boundary eksternal tanpa authenticity, integrity, schema, dan replay/ordering checks.
```

### 11.6 Anti-Pattern

```text
Kafka/RabbitMQ topic dianggap security boundary.
```

Broker adalah transport dan coordination mechanism, bukan pengganti domain-level authenticity.

### 11.7 Review Questions

- Apakah producer identity diverifikasi?
- Apakah event payload dan metadata ditandatangani?
- Apakah event punya eventId untuk dedup?
- Apakah sequence/aggregate version dicek?
- Apakah consumer idempotent?
- Apakah event schema versioned?

---

## 12. Pattern 9 — Idempotent Receiver Pattern

### 12.1 Masalah

Retry, duplicate delivery, timeout, dan replay membuat operation bisa dijalankan lebih dari sekali.

Dalam security/integrity context, duplicate processing bisa menyebabkan:

- double approval;
- double payment;
- duplicate evidence;
- repeated notification;
- repeated state transition;
- inconsistent audit;
- race condition authorization.

### 12.2 Intent

Idempotent Receiver Pattern memastikan request/event yang sama tidak menghasilkan efek samping berulang.

### 12.3 Struktur

```text
Incoming Command/Event
        |
        v
Check idempotency key/event id/request id
        |
        +-- already processed --> return recorded result / ignore safely
        |
        +-- new ---------------> acquire lock / persist processing marker
                                  execute once
                                  persist result
```

### 12.4 Java Mapping

```java
public interface IdempotencyStore {
    IdempotencyDecision begin(String key, Duration ttl);
    void markSucceeded(String key, String resultDigest);
    void markFailedRetryable(String key, String reason);
    void markFailedPermanent(String key, String reason);
}
```

### 12.5 Invariant

```text
Satu logical command hanya menghasilkan satu logical state transition.
```

### 12.6 Anti-Pattern

```text
Retry HTTP POST tanpa idempotency key.
```

Atau:

```text
Consumer RabbitMQ/Kafka melakukan side effect sebelum menyimpan dedup marker.
```

### 12.7 Review Questions

- Apa idempotency key-nya?
- Siapa yang generate key?
- Apakah key terikat ke actor/tenant/action?
- Apa TTL-nya?
- Apakah duplicate mengembalikan response sama atau ditolak?
- Apakah failure mode retryable/permanent dibedakan?

---

## 13. Pattern 10 — Tenant Boundary Guard Pattern

### 13.1 Masalah

Multi-tenant system sering bocor bukan karena authentication gagal, tetapi karena query atau object reference tidak terikat ke tenant.

Contoh:

```java
caseRepository.findById(caseId)
```

Lebih aman:

```java
caseRepository.findByTenantIdAndCaseId(tenantId, caseId)
```

### 13.2 Intent

Tenant Boundary Guard memastikan semua akses object terikat ke tenant/security partition.

### 13.3 Struktur

```text
VerifiedPrincipal(tenantId)
        |
        v
Repository/Policy/Query always includes tenant boundary
        |
        v
Domain Object scoped to tenant
```

### 13.4 Java Mapping

Gunakan typed ID:

```java
public record TenantScopedCaseId(TenantId tenantId, CaseId caseId) {}
```

Repository:

```java
Optional<CaseAggregate> findByScopedId(TenantScopedCaseId scopedId);
```

### 13.5 Invariant

```text
Tidak ada lookup object sensitif hanya berdasarkan object id global yang dapat ditebak/dicoba user.
```

### 13.6 Anti-Pattern

```sql
SELECT * FROM cases WHERE case_id = ?
```

Untuk multi-tenant/security partition, query harus membawa boundary:

```sql
SELECT * FROM cases WHERE tenant_id = ? AND case_id = ?
```

### 13.7 Review Questions

- Apakah tenant/security partition bagian dari type system?
- Apakah query selalu include tenant?
- Apakah background job juga tenant-aware?
- Apakah cache key include tenant?
- Apakah audit include tenant?
- Apakah object ID unpredictable tetapi tetap tidak dijadikan satu-satunya kontrol?

---

## 14. Pattern 11 — Parser Isolation Boundary Pattern

### 14.1 Masalah

Parser adalah attack surface besar:

- XML XXE;
- YAML unsafe deserialization;
- JSON polymorphic type injection;
- archive extraction path traversal;
- CSV formula injection;
- image/document parser CVE;
- regex DoS;
- native parser memory corruption.

### 14.2 Intent

Parser Isolation Boundary memisahkan parsing untrusted data dari domain processing.

### 14.3 Struktur

```text
Untrusted bytes
        |
        v
Parser Boundary
  - size limit
  - content type allowlist
  - safe parser config
  - schema validation
  - timeout/resource limit
  - DTO mapping
        |
        v
Validated DTO / Rejected Input
```

### 14.4 Java Mapping

Jangan parse langsung di domain service. Buat module khusus:

```text
adapter.file.parser
adapter.xml.parser
adapter.json.parser
adapter.archive.parser
```

Output parser harus typed DTO yang sudah divalidasi.

### 14.5 Invariant

```text
Untrusted serialized representation tidak pernah masuk ke domain tanpa parser boundary yang resource-limited dan schema-aware.
```

### 14.6 Anti-Pattern

```java
ObjectMapper mapper = new ObjectMapper();
mapper.activateDefaultTyping(...); // berbahaya bila tidak dikontrol ketat
```

Atau:

```java
ZipEntry entry = zipInputStream.getNextEntry();
Path out = targetDir.resolve(entry.getName()); // Zip Slip risk jika tidak normalize/check
```

### 14.7 Review Questions

- Apakah parser aman dari entity expansion/XXE?
- Apakah ada size/depth/field limit?
- Apakah polymorphic deserialization disabled/allowlisted?
- Apakah archive path dinormalisasi?
- Apakah parsing dilakukan sebelum authz atau sesudah? Apakah aman dari resource abuse?
- Apakah malicious input test tersedia?

---

## 15. Pattern 12 — Key Ring and Versioned Key Identifier Pattern

### 15.1 Masalah

Sistem crypto yang tidak menyimpan key id biasanya sulit dirotasi.

Contoh anti-pattern:

```text
encrypt(data) -> ciphertext
```

Tanpa metadata:

- key mana yang dipakai?
- algorithm apa?
- versi format apa?
- bagaimana decrypt data lama?
- bagaimana rotate key?

### 15.2 Intent

Key Ring Pattern menyediakan kumpulan key aktif, lama, dan deprecated dengan policy penggunaan yang jelas.

### 15.3 Struktur

```text
Key Ring
  active encryption/signing key: key-2026-06
  verification/decryption keys:
    - key-2026-06 active
    - key-2026-03 verify/decrypt only
    - key-2025-12 decrypt only until retention end
```

### 15.4 Java Mapping

```java
public interface KeyRing {
    CryptoKey currentForEncryption(KeyPurpose purpose, TenantId tenantId);
    CryptoKey resolveForDecryption(String keyId, KeyPurpose purpose);
    CryptoKey currentForSigning(SignaturePurpose purpose);
    CryptoKey resolveForVerification(String keyId, SignaturePurpose purpose);
}
```

### 15.5 Invariant

```text
Setiap ciphertext/signature/MAC memiliki key identifier dan algorithm/version metadata yang cukup untuk verifikasi di masa depan.
```

### 15.6 Anti-Pattern

```text
SECRET_KEY=abc123
```

Satu secret global tanpa key id, purpose, rotation date, owner, atau audit.

### 15.7 Review Questions

- Apakah key punya purpose?
- Apakah key id tidak confidential tetapi tidak attacker-controlled?
- Apakah old key masih bisa decrypt/verify?
- Apakah old key tidak bisa dipakai encrypt/sign baru?
- Apakah key rotation tested?
- Apakah key compromise playbook ada?

---

## 16. Pattern 13 — Secure File Intake Pattern

### 16.1 Masalah

File intake tampak sederhana, tapi sering menjadi jalur bypass security.

Threat:

- file berisi malware;
- extension spoofing;
- MIME mismatch;
- oversized file;
- zip bomb;
- path traversal;
- duplicate file;
- tampered file;
- untrusted metadata;
- file diproses sebelum scanning selesai.

### 16.2 Intent

Secure File Intake Pattern membuat file melewati pipeline bertahap sebelum trusted domain processing.

### 16.3 Struktur

```text
Upload / SFTP / Batch Drop
        |
        v
Quarantine Storage
        |
        v
Validation:
  - size
  - extension allowlist
  - content type
  - magic bytes
  - archive safety
  - malware scanning if required
  - digest calculation
  - signature verification if required
        |
        v
Accepted File Registry
        |
        v
Domain Processing
```

### 16.4 Invariant

```text
File tidak pernah diproses oleh domain sebelum statusnya accepted dan digest-nya tercatat.
```

### 16.5 Java Mapping

```java
public record AcceptedFile(
        FileId fileId,
        String originalName,
        String normalizedName,
        String mediaType,
        long size,
        String sha256Digest,
        StorageLocation quarantineLocation,
        StorageLocation acceptedLocation,
        Instant acceptedAt
) {}
```

### 16.6 Anti-Pattern

```text
Controller menerima MultipartFile lalu langsung menyimpan ke public/static directory.
```

Atau:

```text
Batch worker langsung memproses semua file di shared folder tanpa registry, digest, atau status.
```

### 16.7 Review Questions

- Apakah file disimpan di quarantine dulu?
- Apakah nama asli tidak dipakai sebagai path?
- Apakah digest dicatat sebelum processing?
- Apakah duplicate handling jelas?
- Apakah file scan result diaudit?
- Apakah file rejected tetap ada retention untuk investigation?

---

## 17. Pattern 14 — Dependency Admission Gate Pattern

### 17.1 Masalah

Dependency baru sering masuk lewat PR kecil tanpa review security.

Threat:

- malicious package;
- compromised maintainer;
- typo-squatting;
- transitive dependency CVE;
- unexpected license;
- dependency confusion;
- build plugin malicious;
- shaded vulnerable library;
- generated code risk.

### 17.2 Intent

Dependency Admission Gate memastikan dependency baru harus melewati policy sebelum masuk main branch/build production.

### 17.3 Struktur

```text
Dependency Change PR
        |
        v
Admission Checks:
  - allow repository source
  - version pinned
  - SCA scan
  - license policy
  - maintainer/reputation review for risky libs
  - build plugin review
  - SBOM update
        |
        v
Approved Dependency Graph
```

### 17.4 Java Mapping

Untuk Maven/Gradle:

- lock dependency versions;
- ban dynamic versions;
- scan dependency tree;
- generate SBOM;
- fail build for severity threshold sesuai policy;
- require approval untuk plugin baru;
- separate internal repository/proxy.

### 17.5 Invariant

```text
Production artifact tidak boleh dibangun dari dependency graph yang tidak diketahui, tidak dipin, atau gagal policy.
```

### 17.6 Anti-Pattern

```groovy
implementation 'com.example:library:latest.release'
```

Atau:

```xml
<version>LATEST</version>
```

Dynamic version menghancurkan reproducibility dan auditability.

### 17.7 Review Questions

- Apakah dependency baru terlihat jelas di PR?
- Apakah transitive dependency berubah?
- Apakah plugin build baru direview lebih ketat dari library biasa?
- Apakah SBOM otomatis diperbarui?
- Apakah repository source trusted?
- Apakah production build bisa dilakukan offline dari repository terkontrol?

---

## 18. Pattern 15 — Verified Artifact Promotion Pattern

### 18.1 Masalah

CI/CD sering membuild ulang artifact di tiap environment.

Akibatnya artifact yang ditest bukan artifact yang diproduksikan.

### 18.2 Intent

Build once, verify, sign, promote.

### 18.3 Struktur

```text
Source Commit
    |
    v
Build Artifact Once
    |
    v
Test + Scan + SBOM
    |
    v
Sign Artifact + Provenance
    |
    v
Promote same digest across DEV/UAT/PROD
```

### 18.4 Invariant

```text
Artifact production harus memiliki digest yang sama dengan artifact yang lulus verification gate.
```

### 18.5 Java Mapping

- JAR/WAR checksum;
- container image digest;
- SBOM attached;
- provenance attached;
- signed release;
- deployment references digest, bukan mutable tag.

### 18.6 Anti-Pattern

```text
DEV build dari branch A.
UAT build ulang dari branch A setelah dependency berubah.
PROD build ulang dari branch A dengan plugin/cache berbeda.
```

### 18.7 Review Questions

- Apakah artifact dibuild sekali?
- Apakah artifact diidentifikasi dengan digest?
- Apakah deployment memakai digest immutable?
- Apakah artifact ditandatangani?
- Apakah provenance tersedia?
- Apakah rollback memakai artifact verified lama?

---

## 19. Pattern 16 — Security Event Ledger Pattern

### 19.1 Masalah

Security event tersebar di log aplikasi tanpa struktur.

Akibatnya incident sulit dianalisis.

### 19.2 Intent

Security Event Ledger Pattern mencatat event security penting dengan schema konsisten.

### 19.3 Event yang Harus Ada

- authentication success/failure;
- token verification failure;
- authorization denial;
- privilege change;
- secret/key access;
- key rotation;
- certificate renewal/failure;
- suspicious replay;
- file rejection;
- signature verification failure;
- audit integrity verification failure;
- dependency/security gate bypass;
- admin action.

### 19.4 Java Mapping

```java
public record SecurityEvent(
        String eventId,
        String eventType,
        String severity,
        Instant occurredAt,
        String actorId,
        String sourceIp,
        String tenantId,
        String targetType,
        String targetId,
        String action,
        String result,
        String reasonCode,
        String correlationId
) {}
```

### 19.5 Invariant

```text
Security-relevant decision menghasilkan event yang cukup untuk detection, investigation, dan audit.
```

### 19.6 Anti-Pattern

```java
log.info("failed");
```

Tidak ada actor, target, reason, correlation, tenant, result.

### 19.7 Review Questions

- Apakah event schema konsisten?
- Apakah log menghindari secret/PII berlebihan?
- Apakah denied event terlihat?
- Apakah high-risk success juga terlihat?
- Apakah correlation ID end-to-end?
- Apakah event bisa dipakai untuk alert?

---

## 20. Pattern 17 — Fail-Closed Security Control Pattern

### 20.1 Masalah

Security control sering gagal lalu sistem “sementara” allow.

Contoh:

- authorization service timeout lalu allow;
- JWKS fetch gagal lalu skip verification;
- certificate revocation check gagal lalu ignore;
- signature verification exception lalu proceed;
- malware scanner down lalu file accepted;
- KMS decrypt gagal lalu pakai fallback local key.

### 20.2 Intent

Security control untuk operation bernilai tinggi harus fail-closed kecuali ada policy eksplisit untuk degraded mode yang aman.

### 20.3 Struktur

```text
Security Control Call
        |
        +-- explicit allow --> proceed
        +-- explicit deny  --> block
        +-- error/timeout  --> safe failure policy
```

### 20.4 Invariant

```text
Unknown security state tidak boleh diperlakukan sebagai trusted state.
```

### 20.5 Java Mapping

```java
AuthorizationDecision decision;
try {
    decision = policy.evaluate(context, action, target);
} catch (PolicyUnavailableException ex) {
    securityAudit.recordControlFailure(context, action, target, ex);
    throw new ServiceUnavailableException("Authorization temporarily unavailable");
}

if (!decision.allowed()) {
    throw new ForbiddenException("Forbidden");
}
```

### 20.6 Anti-Pattern

```java
try {
    verifySignature(request);
} catch (Exception ex) {
    log.warn("signature verification failed, continuing for compatibility", ex);
}
process(request);
```

### 20.7 Review Questions

- Apa default saat control gagal?
- Apakah failure diaudit?
- Apakah retry aman?
- Apakah degraded mode documented?
- Apakah ada circuit breaker yang tidak membuka security gate?
- Apakah test mencakup control unavailable?

---

## 21. Anti-Pattern Catalog untuk Java Enterprise Security

Bagian ini penting. Banyak desain buruk muncul berulang.

### 21.1 Anti-Pattern: Internal Network Equals Trusted

```text
Premis salah:
  Request dari network internal pasti aman.

Masalah:
  Internal network bisa ditembus, service bisa compromise, SSRF bisa mencapai internal endpoint,
  pod bisa bocor, credential bisa dicuri.

Perbaikan:
  Authenticating service identity, mTLS/workload identity, authorization per action,
  signed command/event untuk boundary penting, network policy sebagai tambahan bukan satu-satunya kontrol.
```

### 21.2 Anti-Pattern: Gateway-Only Authorization

```text
Premis salah:
  Semua authorization cukup di API gateway.

Masalah:
  Downstream service bisa dipanggil dari jalur lain, job/event/adapter bypass gateway,
  object-level context sering tidak tersedia di gateway.

Perbaikan:
  Gateway melakukan coarse control; service/domain melakukan object/action-level authorization.
```

### 21.3 Anti-Pattern: Raw Claim Driven Domain Logic

```text
Premis salah:
  Claim dari JWT bisa langsung dipakai di business logic.

Masalah:
  Token mungkin unverified, stale, salah audience, salah issuer, atau role mapping berubah.

Perbaikan:
  Map verified token ke VerifiedPrincipal dan lakukan policy evaluation lokal.
```

### 21.4 Anti-Pattern: Encrypt Everything Without Purpose

```text
Premis salah:
  Semakin banyak encryption selalu semakin aman.

Masalah:
  Search/reporting rusak, key management kacau, audit sulit, false sense of security,
  password bisa salah dienkripsi, data minimization diabaikan.

Perbaikan:
  Tentukan data classification, threat, field-level need, key scope, AAD, rotation, access model.
```

### 21.5 Anti-Pattern: One Global Secret

```text
Premis salah:
  Satu secret global lebih mudah.

Masalah:
  Blast radius total, rotation sulit, audit tidak granular, tenant isolation lemah.

Perbaikan:
  Key purpose, key id, tenant/object scope bila perlu, KMS/HSM, key ring, rotation playbook.
```

### 21.6 Anti-Pattern: Logging as Debug Dump

```text
Premis salah:
  Log sebanyak mungkin agar mudah debug.

Masalah:
  Secret/PII leak, token leak, password reset link leak, private data retention problem.

Perbaikan:
  Structured logging, redaction, event schema, data minimization, security event ledger.
```

### 21.7 Anti-Pattern: Signature Covers Payload Only

```text
Premis salah:
  Kalau body sudah signed, aman.

Masalah:
  Method/path/query/timestamp/tenant/context bisa berubah.

Perbaikan:
  Canonical request signing yang mencakup semantic context.
```

### 21.8 Anti-Pattern: Mutable Production Artifact

```text
Premis salah:
  Tag image atau artifact name cukup.

Masalah:
  Tag bisa berubah; artifact yang dideploy belum tentu yang ditest.

Perbaikan:
  Digest-based deployment, signed artifact, provenance, build once promote.
```

### 21.9 Anti-Pattern: Security Scanner Equals Secure

```text
Premis salah:
  Jika SAST/SCA clean, desain aman.

Masalah:
  Scanner tidak memahami business authorization, trust boundary, audit defensibility,
  replay semantics, tenant invariant, incident blast radius.

Perbaikan:
  Combine threat model, secure design review, negative test, abuse case, scanner, audit review.
```

### 21.10 Anti-Pattern: Temporary Bypass That Becomes Permanent

```text
Premis salah:
  Bypass sementara tidak berbahaya.

Masalah:
  Bypass jarang dihapus, tidak diaudit, tidak punya expiry, menjadi backdoor operasional.

Perbaikan:
  Feature flag with owner, expiry, audit, approval, limited scope, production alert.
```

---

## 22. Design Decision Template untuk Security Pattern

Setiap security pattern sebaiknya punya ADR/security decision record.

```markdown
# Security Design Decision: <Title>

## Context
Sistem/fitur apa yang didesain?

## Assets
Data, identity, key, workflow, atau evidence apa yang dilindungi?

## Trust Boundaries
Boundary apa saja yang dilewati?

## Threats
Threat utama apa?

## Security Properties Required
- Confidentiality:
- Integrity:
- Authenticity:
- Authorization correctness:
- Freshness/replay resistance:
- Non-repudiation/auditability:
- Availability:

## Chosen Pattern
Pattern apa yang dipakai dan kenapa?

## Invariants
Apa yang tidak boleh pernah rusak?

## Controls
Kontrol teknis apa yang menjaga invariant?

## Failure Modes
Bagaimana kontrol bisa gagal?

## Detection
Bagaimana kegagalan dideteksi?

## Recovery
Bagaimana recovery/rotation/rollback dilakukan?

## Residual Risk
Risiko apa yang masih diterima?

## Tests
Security tests apa yang wajib ada?

## Operational Notes
Runbook, monitoring, key ownership, retention, dan approval.
```

---

## 23. Pattern Selection Matrix

| Masalah | Pattern Utama | Kontrol Pendukung |
|---|---|---|
| Public API menerima request user | Trust Gateway | Token Verification, PEP, input validation, rate limit |
| Partner callback | Signed Command | Replay protection, key ring, audit |
| Sensitive field storage | Secure Envelope | Envelope encryption, AAD, key rotation |
| High-value audit | Tamper-Evident Audit Trail | Append-only storage, signature anchor |
| Event lintas trust boundary | Signed Event | Idempotent receiver, schema versioning |
| Multi-tenant data access | Tenant Boundary Guard | Object-level authz, tenant cache key |
| File upload/batch intake | Secure File Intake | Quarantine, digest, scanner, parser isolation |
| Dependency update | Dependency Admission Gate | SCA, SBOM, repository policy |
| Release promotion | Verified Artifact Promotion | Signing, provenance, immutable digest |
| Authorization consistency | Policy Enforcement Boundary | PDP/PEP, matrix tests, denial audit |
| Secret/key rotation | Key Ring | KMS/HSM, versioned key id, playbook |
| Incident detection | Security Event Ledger | SIEM, alert rules, correlation ID |

---

## 24. Example: Designing Secure Partner Submission Flow

### 24.1 Scenario

Partner agency mengirim submission ke Java application.

Submission berisi:

- case reference;
- applicant data;
- document metadata;
- timestamp;
- partner officer ID.

Requirement:

- hanya partner sah yang bisa submit;
- payload tidak boleh berubah;
- duplicate tidak boleh membuat double case;
- submission harus bisa diaudit;
- partner key bisa dirotasi;
- file attachment harus divalidasi;
- incident key compromise harus bisa ditangani.

### 24.2 Design

Pattern yang dipakai:

1. Trust Gateway Pattern;
2. Signed Command Pattern;
3. Key Ring Pattern;
4. Idempotent Receiver Pattern;
5. Secure File Intake Pattern;
6. Policy Enforcement Boundary;
7. Security Event Ledger;
8. Tamper-Evident Audit Trail.

### 24.3 Flow

```text
Partner
  |
  | HTTPS + Signed Submission Envelope
  v
Partner Submission Gateway
  - TLS validation
  - source validation
  - schema validation
  - signature verification
  - timestamp/expiry check
  - replay/idempotency check
  - keyId resolution
  |
  v
TrustedSubmissionCommand
  |
  v
Policy Enforcement
  - partner allowed for submission type?
  - partner allowed for target agency/domain?
  |
  v
Domain Service
  - create/update case
  - persist idempotency result
  |
  v
Audit Trail
  - record verified signer
  - record digest
  - record result
  - chain hash/signature anchor
```

### 24.4 Invariants

```text
1. No unsigned submission can create a case.
2. No expired submission can create a case.
3. No duplicate requestId can create duplicate state.
4. No submission from partner A can affect partner B boundary.
5. No accepted file can be processed before quarantine validation.
6. Every accept/reject decision is auditable.
```

### 24.5 Failure Modes

| Failure | Desired Behavior |
|---|---|
| Signature invalid | Reject, audit security event |
| Unknown keyId | Reject, audit security event |
| Expired timestamp | Reject, audit possible replay |
| Duplicate requestId | Return previous result or safe duplicate response |
| Schema invalid | Reject before domain logic |
| File scan unavailable | Hold in quarantine, do not process |
| Key compromise | Disable key, rotate, identify submissions signed by compromised key |

---

## 25. Example: Designing Secure Internal Approval Flow

### 25.1 Scenario

Officer approves a regulatory case.

Requirement:

- officer authenticated;
- officer authorized for case;
- case status must allow approval;
- approval reason must be present;
- approval must be non-repudiable enough for internal audit;
- duplicate click must not approve twice;
- audit trail must be tamper-evident.

### 25.2 Pattern Combination

- Token Verification Boundary;
- Policy Enforcement Boundary;
- Tenant Boundary Guard;
- Idempotent Receiver;
- Tamper-Evident Audit Trail;
- Security Event Ledger.

### 25.3 Flow

```text
Browser
  |
  v
API Boundary
  - verify session/token
  - CSRF protection if cookie session
  - input validation
  |
  v
VerifiedPrincipal
  |
  v
Approval Application Service
  - load case scoped by tenant/assignment
  - evaluate policy
  - validate state transition
  - check idempotency key
  - apply domain command
  - append audit record
```

### 25.4 Invariant

```text
Approval is valid only if actor, target case, current state, authority, reason, and idempotency key are all valid at the time of decision.
```

### 25.5 Anti-Pattern to Avoid

```java
@PreAuthorize("hasRole('APPROVER')")
@PostMapping("/cases/{id}/approve")
public void approve(@PathVariable String id) {
    caseService.approve(id);
}
```

Missing:

- object-level authorization;
- tenant boundary;
- assignment check;
- case status check;
- reason validation;
- idempotency;
- audit evidence.

---

## 26. Security Pattern Composition Rules

### Rule 1 — Boundary Before Domain

Raw data must become trusted typed input before entering domain logic.

```text
Raw Request -> Boundary -> Trusted Command -> Domain
```

### Rule 2 — Authentication Before Authorization, But Authorization Near Object

Authentication can be centralized. Authorization must know the target object/action.

### Rule 3 — Integrity Requires Context

Hash/signature/MAC/encryption must bind data to context.

Bad:

```text
sign(payload)
```

Better:

```text
sign(method + path + tenant + actor + timestamp + nonce + payloadDigest)
```

### Rule 4 — Key Rotation Requires Metadata

No key id means no sane rotation.

### Rule 5 — Audit Requires Decision, Not Just Error

Audit must record:

- who;
- did what;
- to what;
- when;
- from where;
- result;
- reason;
- correlation.

### Rule 6 — Internal Is Not Trusted by Default

Network location is not identity.

### Rule 7 — Fail Unknown as Unsafe

Unknown token, unknown key, unknown tenant, unknown policy decision, unknown scanner result: do not treat as valid.

### Rule 8 — Make Security State Typed

Avoid passing `String userId`, `Map claims`, `JsonNode payload`, `boolean isAdmin` across layers.

Use:

- `VerifiedPrincipal`;
- `TrustedCommand`;
- `TenantScopedId`;
- `AuthorizationDecision`;
- `AcceptedFile`;
- `VerifiedSignature`.

### Rule 9 — Make Bypass Visible

Any bypass must have:

- owner;
- reason;
- expiry;
- scope;
- approval;
- audit;
- alert.

### Rule 10 — Test Abuse, Not Only Happy Path

Every pattern should have negative tests:

- invalid signature;
- wrong tenant;
- expired token;
- duplicate request;
- policy unavailable;
- parser malicious input;
- dependency gate failure;
- key rotation scenario.

---

## 27. Java Package Architecture Recommendation

Untuk sistem Java enterprise besar, security pattern lebih mudah dijaga jika package boundary jelas.

```text
com.example.app
  security
    principal
      VerifiedPrincipal.java
      VerifiedClient.java
    token
      TokenVerifier.java
      JwtVerificationPolicy.java
    authorization
      AuthorizationPolicy.java
      AuthorizationDecision.java
      PolicyEnforcer.java
    crypto
      SecureEnvelopeService.java
      KeyRing.java
      MacVerifier.java
      SignatureVerifier.java
    audit
      SecurityEvent.java
      AuditRecord.java
      AuditIntegrityService.java
    file
      FileIntakeService.java
      AcceptedFile.java
      FileDigestService.java
    replay
      ReplayProtectionStore.java
      IdempotencyStore.java
    secrets
      SecretProvider.java
      SecretLease.java

  adapter
    inbound
      rest
      message
      file
      batch

  domain
    case
    evidence
    approval
```

Prinsipnya:

```text
security package owns security semantics;
domain package consumes trusted types;
adapter package handles hostile external representations.
```

---

## 28. Code Review Heuristics

Saat review PR Java enterprise, cari smell berikut.

### 28.1 Boundary Smells

- Controller langsung memanggil domain dengan raw DTO tanpa validation.
- Consumer message langsung apply state change.
- Batch job membaca file folder langsung tanpa registry.
- Internal endpoint tidak punya authn/authz.

### 28.2 Crypto Smells

- `Cipher.getInstance("AES")`.
- Random menggunakan `java.util.Random` untuk token/security.
- Hash dipakai sebagai MAC tanpa secret.
- Password dienkripsi bukan di-hash.
- Tidak ada key id di encrypted payload.
- Signature tidak mencakup metadata.

### 28.3 Authorization Smells

- `hasRole` menjadi satu-satunya check untuk object operation.
- Repository lookup tanpa tenant/user scope.
- Admin bypass tanpa audit.
- Authorization hanya di frontend.

### 28.4 Logging Smells

- Log token/header penuh.
- Log password reset URL.
- Log request body sensitif.
- Error security tidak punya reason code.

### 28.5 Supply Chain Smells

- Dependency dynamic version.
- Build plugin baru tanpa review.
- Generated code tanpa provenance.
- Artifact rebuild per environment.
- Deployment pakai mutable tag.

---

## 29. Production Checklist

Sebelum pattern dianggap production-ready:

```text
[ ] Threat model sudah dibuat.
[ ] Asset dan trust boundary jelas.
[ ] Security invariant tertulis.
[ ] Pattern yang dipilih punya alasan.
[ ] Data hostile tidak masuk domain langsung.
[ ] Authentication menghasilkan verified context.
[ ] Authorization berbasis actor + action + object.
[ ] Integrity control mencakup metadata/context.
[ ] Key id dan version metadata tersedia.
[ ] Replay/idempotency dipikirkan.
[ ] Failure mode fail-closed.
[ ] Security event tercatat.
[ ] Audit trail cukup untuk investigation.
[ ] Negative tests tersedia.
[ ] Rotation/recovery playbook tersedia.
[ ] Monitoring/alert tersedia.
[ ] Bypass punya owner dan expiry.
```

---

## 30. Mini Case Study: Anti-Pattern Refactor

### 30.1 Initial Design

```text
- Public REST API validates JWT at gateway.
- Gateway forwards X-User-Id and X-Roles.
- Service trusts headers.
- Approval endpoint checks role APPROVER.
- Service loads case by caseId only.
- Audit inserts row into AUDIT table.
- No idempotency key.
- Logs full request body on error.
```

### 30.2 Problems

- internal header spoofing risk;
- gateway-only authorization;
- missing object-level authorization;
- missing tenant boundary;
- duplicate approval risk;
- audit not tamper-evident;
- sensitive data leakage in logs.

### 30.3 Refactored Design

```text
- Service verifies trusted identity propagation or validates token locally.
- Header from gateway accepted only over authenticated internal channel.
- Convert identity to VerifiedPrincipal.
- Load case by tenantId + caseId.
- Evaluate approval policy using principal + case snapshot + action.
- Require idempotency key.
- Apply domain transition once.
- Append tamper-evident audit record.
- Emit structured security event.
- Redact logs.
```

### 30.4 Resulting Invariants

```text
1. Spoofed identity header cannot approve case.
2. APPROVER role alone is insufficient.
3. Cross-tenant case access fails.
4. Duplicate request cannot create duplicate transition.
5. Audit tampering can be detected.
6. Sensitive request data is not leaked to logs.
```

---

## 31. Common Trade-Offs

### 31.1 Centralized vs Distributed Authorization

Centralized PDP improves consistency, but service-level PEP is still needed.

Trade-off:

- centralized policy easier to govern;
- local enforcement closer to object state;
- network dependency can affect availability;
- caching can introduce stale decisions.

Design choice:

```text
Use central policy where possible, but enforce near domain object and fail closed for high-risk operation.
```

### 31.2 Signed Event vs Broker ACL Only

Broker ACL controls who can publish to topic. Signed event proves event origin and integrity beyond broker boundary.

Use signed events when:

- event crosses organization/trust boundary;
- event has legal/regulatory impact;
- broker admin is not fully trusted;
- event is archived as evidence;
- multiple consumers rely on authenticity.

### 31.3 Field Encryption vs Database Controls

Field encryption helps when DB/storage compromise is a threat, but it complicates:

- search;
- indexing;
- reporting;
- migration;
- key rotation;
- debugging.

Use only after data classification and threat model.

### 31.4 Strict Fail-Closed vs Availability

For high-risk operations, fail-closed is correct. For low-risk read-only operation, degraded mode may be acceptable if explicitly designed.

Never let “availability” become unreviewed security bypass.

---

## 32. Latihan

### Latihan 1 — Identify Pattern

Kamu punya endpoint:

```text
POST /api/cases/{caseId}/appeals/{appealId}/decision
```

Actor harus:

- authenticated;
- assigned to case;
- not conflicted;
- allowed for decision stage;
- cannot decide twice;
- decision must be audited.

Tentukan pattern yang diperlukan.

Jawaban ideal:

- Token Verification Boundary;
- Policy Enforcement Boundary;
- Tenant Boundary Guard;
- Idempotent Receiver;
- Tamper-Evident Audit Trail;
- Security Event Ledger.

### Latihan 2 — Refactor Anti-Pattern

Diberikan desain:

```text
Webhook partner hanya dicek IP allowlist dan HTTPS.
```

Apa masalahnya?

Jawaban:

- IP bukan identity kuat;
- IP bisa berubah/shared/proxy;
- tidak ada payload integrity end-to-end;
- tidak ada replay protection;
- tidak ada key rotation;
- tidak ada canonical signature;
- tidak ada audit verification result.

Pattern:

- Trust Gateway;
- Signed Command;
- Key Ring;
- Replay Protection;
- Security Event Ledger.

### Latihan 3 — Design Secure Envelope

Data `identityNumber` perlu disimpan terenkripsi per tenant.

Envelope minimal:

```json
{
  "version": "enc-v1",
  "alg": "AES-256-GCM",
  "keyId": "tenant-a-pii-2026-06",
  "nonce": "...",
  "aad": {
    "tenantId": "tenant-a",
    "field": "identityNumber",
    "schemaVersion": "applicant-v2"
  },
  "ciphertextAndTag": "..."
}
```

Invariant:

```text
Ciphertext tenant A tidak bisa dipindahkan dan diterima sebagai field tenant B.
```

---

## 33. Summary

Part ini menyatukan seluruh seri menjadi design vocabulary.

Hal paling penting:

1. Security pattern adalah cara menjaga invariant berulang.
2. Pattern harus ditempatkan di trust boundary yang benar.
3. Crypto primitive bukan pattern lengkap; ia hanya salah satu kontrol.
4. Authorization harus dekat dengan object/action.
5. Integrity harus mengikat context.
6. Key rotation butuh key id dan metadata.
7. Audit harus evidence-grade, bukan sekadar log.
8. Internal network bukan trust proof.
9. Security control harus fail-closed untuk unknown state.
10. Anti-pattern sering tampak praktis sampai terjadi incident.

Formula mental:

```text
Threat + Asset + Trust Boundary + Invariant
    -> Pattern Selection
    -> Control Placement
    -> Failure Mode
    -> Detection
    -> Recovery
```

---

## 34. Referensi

Referensi utama yang relevan untuk Part 33:

1. OWASP Secure-by-Design Framework — practical guidance to embed security into software architecture and system design before code is written.
2. OWASP Top 10 Proactive Controls — application security controls developers should know and apply.
3. OWASP Secure Coding Practices Quick Reference Guide — secure coding checklist including fail-safe controls, trusted logging, and input handling.
4. OWASP Application Security Verification Standard — technical security requirements and verification basis.
5. OWASP Threat Modeling Cheat Sheet — application decomposition, threat identification/ranking, mitigations, and review/validation.
6. OWASP Secure Product Design Cheat Sheet — least privilege, separation of duties, defense-in-depth, zero trust, and secure design principles.
7. OWASP Microservices Security Cheat Sheet — security architecture patterns and recommendations for microservices.
8. NIST SP 800-218 Secure Software Development Framework — recommendations for mitigating software vulnerability risk through secure development practices.
9. NIST SP 800-57 — key management lifecycle and cryptographic keying material guidance.
10. NIST SP 800-61 Rev. 3 — incident response and cybersecurity risk management integration.

---

## 35. Status Seri

Part ini adalah:

```text
Part 33 dari 35
```

Seri **belum selesai**.

Masih tersisa:

```text
Part 34 — Capstone: Designing a Secure Java Regulatory Case Management Platform
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-security-cryptography-integrity-part-032.md](./learn-java-security-cryptography-integrity-part-032.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-security-cryptography-integrity-part-034](./learn-java-security-cryptography-integrity-part-034.md)
