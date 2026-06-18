# learn-java-security-cryptography-integrity-part-009

# Part 9 — Digital Signature: RSA, ECDSA, EdDSA, Signing Semantics

> Seri: `learn-java-security-cryptography-integrity`  
> Bagian: `Part 9 dari 35`  
> Status seri: **belum selesai**  
> Fokus: digital signature sebagai primitive untuk authenticity, integrity, origin binding, non-repudiation evidence, dan signed payload design di Java systems.

---

## 0. Tujuan Part Ini

Pada part sebelumnya kita membahas **MAC**: mekanisme integrity dan authenticity berbasis **shared secret**. MAC cocok ketika pihak yang membuat dan memverifikasi sama-sama memegang secret yang sama. Tetapi untuk banyak sistem enterprise, regulatory, supply chain, dokumen, audit, integrasi antar organisasi, dan artifact release, model shared secret tidak cukup.

Digital signature dibutuhkan ketika kita ingin properti berikut:

1. **Verifier dapat membuktikan bahwa payload dibuat/diotorisasi oleh pemilik private key tertentu.**
2. **Verifier tidak perlu memegang secret signing key.**
3. **Public key boleh disebarkan luas.**
4. **Signature dapat diverifikasi oleh pihak ketiga.**
5. **Signature dapat menjadi bagian dari evidence chain, audit trail, atau release integrity.**

Setelah menyelesaikan part ini, kamu harus mampu:

1. Membedakan secara tajam **signature**, **MAC**, **hash**, dan **encryption**.
2. Memahami apa yang sebenarnya dijamin digital signature dan apa yang tidak.
3. Memilih mental model antara **RSA-PSS**, **ECDSA**, dan **EdDSA**.
4. Mendesain signed payload format yang versioned, canonical, replay-aware, dan future-proof.
5. Menggunakan Java `Signature` API dengan benar.
6. Mengenali misuse pattern seperti `SHA1withRSA`, raw signature, signing non-canonical JSON, key confusion, algorithm confusion, timestamp ambiguity, dan detached-payload substitution.
7. Memahami kenapa private key custody lebih penting daripada sekadar memilih algorithm.
8. Mendesain signature verification boundary untuk API, event, file, artifact, audit, dan command.

Referensi utama: Oracle Java `Signature` API, Java Security Standard Algorithm Names, Oracle Provider Documentation, NIST FIPS 186-5 Digital Signature Standard, OWASP Key Management Cheat Sheet, dan OWASP Cryptographic Storage Cheat Sheet.

---

## 1. Mental Model Utama

Digital signature adalah mekanisme untuk menjawab pertanyaan:

> “Apakah data ini benar-benar ditandatangani oleh pemegang private key yang sesuai dengan public key tertentu, dan apakah data itu tidak berubah sejak ditandatangani?”

Digital signature tidak terutama bertanya:

> “Apakah data ini rahasia?”

Digital signature memberikan **integrity** dan **origin authenticity**, bukan confidentiality.

Jika payload-nya berupa plaintext JSON, semua orang tetap bisa membaca JSON itu. Signature hanya membuat perubahan payload dapat terdeteksi dan mengikat payload ke private key tertentu.

---

## 2. Signature vs Hash vs MAC vs Encryption

| Mechanism | Key? | Siapa bisa membuat? | Siapa bisa verifikasi? | Guarantee utama | Cocok untuk |
|---|---:|---|---|---|---|
| Hash | Tidak | Siapa saja | Siapa saja | Fingerprint/tamper detection jika digest dipercaya lewat channel lain | File fingerprint, dedup, manifest |
| MAC/HMAC | Shared secret | Siapa pun yang punya secret | Siapa pun yang punya secret | Integrity + authenticity antar pihak yang saling percaya secret | Webhook, internal request signing |
| Digital signature | Private/public key | Hanya pemegang private key | Siapa pun dengan public key valid | Integrity + authenticity + third-party verifiability | Document signing, artifact signing, inter-org message, audit evidence |
| Encryption | Symmetric/asymmetric key | Pengirim/encryptor | Penerima/decryptor | Confidentiality | Data at rest/in transit payload secrecy |

Kesalahan berpikir yang paling umum:

```text
“Saya mau memastikan data tidak diubah, maka saya encrypt.”
```

Encryption sendiri tidak selalu memberi integrity. Mode lama seperti AES-CBC tanpa MAC dapat rentan terhadap tampering/padding oracle. Untuk integrity kamu butuh AEAD, MAC, atau signature tergantung trust model.

Kesalahan lain:

```text
“Saya sign pakai private key artinya data jadi rahasia.”
```

Tidak. Signature tidak menyembunyikan data.

---

## 3. Properti Security Digital Signature

Digital signature dapat memberikan beberapa properti:

### 3.1 Integrity

Jika satu byte payload berubah, verification harus gagal.

Tetapi integrity ini hanya berlaku terhadap **byte sequence yang benar-benar ditandatangani**. Kalau sistem menampilkan atau mengeksekusi representasi berbeda dari byte sequence yang diverifikasi, integrity guarantee bisa hilang.

Contoh:

```json
{"amount": 1000, "currency": "IDR"}
```

Jika signature dibuat terhadap JSON string tertentu, tetapi verifier melakukan parsing fleksibel yang menerima duplicate key, whitespace, Unicode escape, atau angka dalam format berbeda, maka pertanyaan pentingnya adalah:

> Apakah yang diverifikasi sama persis dengan yang diproses bisnis?

Ini disebut **semantic integrity problem**.

### 3.2 Origin Authenticity

Signature membuktikan bahwa payload ditandatangani oleh private key yang sesuai dengan public key tertentu.

Namun itu belum otomatis membuktikan “siapa manusia/organisasi” di balik public key. Untuk itu perlu binding:

1. Certificate.
2. Trust store.
3. Key registry.
4. JWKS endpoint.
5. Manual key pinning.
6. Contractual public key exchange.
7. HSM-backed identity.

Tanpa binding, public key hanya angka.

### 3.3 Non-Repudiation Evidence

Non-repudiation bukan murni properti cryptographic; ia adalah kombinasi:

1. Private key custody.
2. Identity proofing.
3. Certificate policy.
4. Key usage constraints.
5. Audit trail.
6. Timestamping.
7. Operational control.
8. Legal/process context.

Digital signature dapat menjadi evidence bahwa private key digunakan, tetapi jika private key disalin banyak orang atau disimpan di config file, non-repudiation praktis runtuh.

### 3.4 Freshness

Signature tidak otomatis membuktikan payload baru.

Payload lama yang valid secara signature tetap valid jika diverifikasi ulang, kecuali ada kontrol replay seperti:

1. Timestamp.
2. Nonce.
3. Request ID.
4. Sequence number.
5. Expiry window.
6. One-time challenge.
7. Revocation list.
8. Deduplication cache.

Jadi signature menjawab “payload pernah ditandatangani”, bukan “payload ini fresh sekarang”.

### 3.5 Authorization

Signature tidak otomatis memberi izin bisnis.

Payload bisa valid secara cryptographic, tetapi tidak authorized secara domain.

Contoh:

```json
{
  "caseId": "CASE-001",
  "action": "APPROVE",
  "actorId": "officer-123"
}
```

Signature membuktikan payload tidak berubah dan berasal dari key tertentu. Tetapi sistem tetap harus mengecek:

1. Apakah key itu milik actor/issuer yang dipercaya?
2. Apakah actor boleh approve case ini?
3. Apakah case berada pada state yang mengizinkan approval?
4. Apakah delegation masih valid?
5. Apakah action tidak replay dari state lama?

---

## 4. Digital Signature sebagai State Transition Guard

Untuk engineer yang bekerja dengan case management atau regulatory workflow, signature sebaiknya dilihat sebagai guard terhadap transisi state.

Contoh state machine:

```text
DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED → ISSUED
```

Signature dapat mengikat command:

```json
{
  "schemaVersion": 1,
  "commandId": "cmd-2026-00001",
  "caseId": "CASE-123",
  "expectedPreviousState": "UNDER_REVIEW",
  "action": "APPROVE",
  "actorId": "officer-88",
  "issuedAt": "2026-06-16T10:15:30Z"
}
```

Tetapi signature harus dikombinasikan dengan invariant:

```text
A signed APPROVE command is valid only if:
1. signature verifies;
2. key belongs to authorized actor/client/system;
3. commandId has not been consumed;
4. issuedAt is within accepted skew/window;
5. case current state equals expectedPreviousState;
6. actor has authority over case scope;
7. command schema version is supported;
8. canonical payload equals business payload.
```

Digital signature menjadi salah satu guard, bukan satu-satunya guard.

---

## 5. Java `Signature` API: Big Picture

Java menyediakan digital signature lewat `java.security.Signature`.

Lifecycle umum:

```text
Signature.getInstance(algorithm)
→ initSign(privateKey) atau initVerify(publicKey)
→ update(data bytes)
→ sign() atau verify(signature bytes)
```

Contoh minimal Ed25519:

```java
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.Signature;
import java.util.Base64;

public class Ed25519SignatureExample {
    public static void main(String[] args) throws Exception {
        KeyPairGenerator kpg = KeyPairGenerator.getInstance("Ed25519");
        KeyPair keyPair = kpg.generateKeyPair();

        byte[] payload = "important-payload".getBytes(StandardCharsets.UTF_8);

        Signature signer = Signature.getInstance("Ed25519");
        signer.initSign(keyPair.getPrivate());
        signer.update(payload);
        byte[] sig = signer.sign();

        Signature verifier = Signature.getInstance("Ed25519");
        verifier.initVerify(keyPair.getPublic());
        verifier.update(payload);
        boolean ok = verifier.verify(sig);

        System.out.println("signature=" + Base64.getEncoder().encodeToString(sig));
        System.out.println("valid=" + ok);
    }
}
```

Contoh minimal RSA-PSS dengan explicit parameter:

```java
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.Signature;
import java.security.spec.MGF1ParameterSpec;
import java.security.spec.PSSParameterSpec;
import java.util.Base64;

public class RsaPssSignatureExample {
    public static void main(String[] args) throws Exception {
        KeyPairGenerator kpg = KeyPairGenerator.getInstance("RSA");
        kpg.initialize(3072);
        KeyPair keyPair = kpg.generateKeyPair();

        byte[] payload = "important-payload".getBytes(StandardCharsets.UTF_8);

        PSSParameterSpec pss = new PSSParameterSpec(
                "SHA-256",
                "MGF1",
                MGF1ParameterSpec.SHA256,
                32,
                1
        );

        Signature signer = Signature.getInstance("RSASSA-PSS");
        signer.setParameter(pss);
        signer.initSign(keyPair.getPrivate());
        signer.update(payload);
        byte[] signature = signer.sign();

        Signature verifier = Signature.getInstance("RSASSA-PSS");
        verifier.setParameter(pss);
        verifier.initVerify(keyPair.getPublic());
        verifier.update(payload);
        boolean ok = verifier.verify(signature);

        System.out.println(Base64.getEncoder().encodeToString(signature));
        System.out.println(ok);
    }
}
```

Catatan penting:

1. Jangan mengandalkan default parameter untuk RSA-PSS pada sistem lintas provider/lintas platform.
2. Dokumentasikan hash, MGF, salt length, trailer field.
3. Simpan algorithm dan parameter di metadata signature envelope.
4. Test verification lintas runtime jika sistem interoperable.

---

## 6. Algorithm Families

Digital signature modern di Java biasanya jatuh ke beberapa keluarga berikut.

---

## 6.1 RSA Signature

RSA memiliki dua bentuk umum untuk signature:

1. RSA PKCS#1 v1.5 signature, misalnya `SHA256withRSA`.
2. RSA-PSS, misalnya `RSASSA-PSS` dengan parameter SHA-256/MGF1/salt length.

### RSA PKCS#1 v1.5

Contoh Java algorithm name:

```text
SHA256withRSA
SHA384withRSA
SHA512withRSA
```

RSA PKCS#1 v1.5 masih banyak ditemukan karena legacy compatibility, certificate ecosystem, dan library support luas. Namun untuk desain baru, RSA-PSS biasanya lebih disukai karena padding scheme-nya lebih modern.

### RSA-PSS

RSA-PSS adalah probabilistic signature scheme. Parameter penting:

1. Hash algorithm.
2. MGF algorithm.
3. MGF hash.
4. Salt length.
5. Trailer field.

Untuk interoperabilitas, jangan tulis requirement seperti:

```text
Use RSA-PSS.
```

Tulis lengkap:

```text
Signature algorithm: RSASSA-PSS
Hash: SHA-256
MGF: MGF1 with SHA-256
Salt length: 32 bytes
Trailer field: 1
Key size: minimum 3072-bit RSA for new deployments
Payload canonicalization: JCS UTF-8 bytes
```

### RSA Failure Modes

1. Menggunakan `SHA1withRSA` untuk desain baru.
2. Key size terlalu kecil.
3. Salah mengira “encrypt with private key” adalah signature.
4. Tidak membedakan RSA encryption dan RSA signature key usage.
5. Menggunakan raw RSA primitive.
6. Tidak menyimpan parameter RSA-PSS.
7. Menggunakan certificate tanpa mengecek key usage.
8. Membiarkan provider default berbeda antar environment.

---

## 6.2 ECDSA

ECDSA berbasis elliptic curve. Umum dipakai di certificate, JWT, modern protocols, dan distributed systems.

Contoh algorithm name:

```text
SHA256withECDSA
SHA384withECDSA
SHA512withECDSA
```

ECDSA biasanya memakai curve seperti P-256/secp256r1, P-384/secp384r1.

### Kelebihan ECDSA

1. Signature lebih kecil daripada RSA untuk security level yang sebanding.
2. Public/private key lebih kecil.
3. Banyak dipakai dalam TLS dan JOSE ecosystem.
4. Verifikasi/signing cukup efisien tergantung platform.

### Kelemahan/Pitfalls ECDSA

ECDSA sangat sensitif terhadap nonce per-signature.

Jika nonce `k` bocor atau reused, private key bisa bocor.

Kesalahan besar:

```text
Same ECDSA nonce + same private key + different messages = private key recovery risk.
```

Karena itu:

1. Gunakan provider yang benar dan JDK yang terpatch.
2. Jangan implement ECDSA sendiri.
3. Jangan supply random source lemah.
4. Jangan mencoba “optimasi” signature generation.
5. Hindari custom curve kecuali ada alasan kuat dan review cryptographer.

### ECDSA Encoding Pitfall

ECDSA signature sering muncul dalam dua encoding:

1. ASN.1 DER sequence `(r, s)`.
2. Raw concatenation `r || s`, umum di JOSE/JWT.

Java `Signature` umumnya menghasilkan DER-encoded ECDSA signature. Banyak protokol seperti JOSE mengharapkan raw fixed-length R/S concatenation. Library JOSE biasanya menangani konversi ini, tetapi custom implementation sering salah.

Anti-pattern:

```java
// Mengambil output SHA256withECDSA dari Java dan langsung masukkan ke JWT ES256
// tanpa memahami DER vs raw signature format.
```

Gunakan library JOSE yang matang untuk JWT/JWS daripada menulis encoding sendiri.

---

## 6.3 EdDSA / Ed25519 / Ed448

EdDSA adalah signature scheme berbasis Edwards curve. Di Java modern, algorithm seperti `Ed25519`, `Ed448`, dan `EdDSA` tersedia melalui provider JDK modern.

Contoh:

```java
KeyPairGenerator kpg = KeyPairGenerator.getInstance("Ed25519");
Signature sig = Signature.getInstance("Ed25519");
```

### Kelebihan Ed25519

1. Signature kecil.
2. Key kecil.
3. Deterministic signing secara desain.
4. Menghindari kelas masalah ECDSA nonce randomness tertentu.
5. API relatif sederhana.
6. Cocok untuk message signing modern, artifact signing, internal protocol, dan command signing jika ecosystem mendukung.

### Hal yang Tetap Harus Diperhatikan

EdDSA bukan “magic aman tanpa risiko”. Tetap harus:

1. Menjaga private key custody.
2. Menentukan payload canonicalization.
3. Melindungi dari replay.
4. Mengelola key rotation.
5. Menghindari public-key oracle misuse pada API/library yang rawan.
6. Mengecek support ecosystem, HSM/KMS, certificate, dan compliance requirement.

### Ed25519 vs Ed448

Secara praktis:

1. Ed25519 lebih umum dan luas didukung.
2. Ed448 menawarkan security margin lebih tinggi tetapi support/interoperability lebih terbatas.
3. Untuk enterprise Java, pilihan tidak hanya berdasarkan security teori, tetapi juga provider, protocol, certificate ecosystem, HSM/KMS, audit/compliance, dan partner compatibility.

---

## 7. NIST FIPS 186-5 dan Algorithm Awareness

NIST FIPS 186-5 adalah Digital Signature Standard modern yang mendefinisikan suite algorithm untuk digital signature generation. Digital signature digunakan untuk mendeteksi unauthorized modification terhadap data, mengautentikasi identitas signatory, dan membantu recipient membuktikan kepada pihak ketiga bahwa signature dibuat oleh claimed signatory.

Untuk engineer, point pentingnya bukan menghafal semua detail matematis, tetapi memahami:

1. Algorithm punya security level dan parameter.
2. Hash function adalah bagian dari signature scheme.
3. Key size/curve matters.
4. Randomness atau deterministic design matters.
5. Signature verification harus mengikat algorithm, key, payload, dan context.
6. Legacy algorithms harus dihindari untuk desain baru.

---

## 8. Signing Semantics: Hal yang Sebenarnya Ditandatangani

Ini inti part ini.

Banyak sistem “pakai signature” tapi security-nya tetap rapuh karena tidak jelas apa yang ditandatangani.

Pertanyaan wajib:

```text
1. Apakah yang ditandatangani adalah raw body?
2. Apakah termasuk HTTP method?
3. Apakah termasuk path?
4. Apakah termasuk query string?
5. Apakah termasuk selected headers?
6. Apakah termasuk timestamp?
7. Apakah termasuk nonce/request id?
8. Apakah termasuk issuer/key id?
9. Apakah termasuk schema version?
10. Apakah termasuk business context?
11. Apakah termasuk expected state/version?
12. Apakah termasuk content digest untuk large payload?
```

Contoh buruk:

```text
signature = Sign(body)
```

Kenapa buruk?

Karena body yang sama bisa dikirim ke endpoint berbeda:

```text
POST /cases/123/approve
POST /cases/123/reject
```

Jika signature hanya mengikat body, attacker bisa melakukan endpoint substitution jika ada celah routing/authorization.

Contoh lebih baik:

```text
stringToSign =
  "SIG-V1" + "\n" +
  method + "\n" +
  canonicalPath + "\n" +
  canonicalQuery + "\n" +
  canonicalHeaders + "\n" +
  hex(sha256(body)) + "\n" +
  issuedAt + "\n" +
  nonce
```

Untuk domain command:

```text
stringToSign = canonicalize({
  "signatureVersion": "SIG-V1",
  "commandSchema": "case-command-v3",
  "tenantId": "CEA",
  "caseId": "CASE-123",
  "expectedAggregateVersion": 42,
  "expectedPreviousState": "UNDER_REVIEW",
  "action": "APPROVE",
  "actorId": "officer-88",
  "delegationId": "del-2026-001",
  "issuedAt": "2026-06-16T10:15:30Z",
  "expiresAt": "2026-06-16T10:20:30Z",
  "commandId": "cmd-uuid"
})
```

---

## 9. Canonicalization: The Hidden Core of Signature Correctness

Signature memverifikasi bytes, bukan “makna bisnis”.

Jika dua representasi berbeda punya makna sama menurut parser, maka kamu harus menentukan representasi canonical sebelum signing.

### 9.1 JSON Problem

JSON secara umum tidak canonical secara default.

Contoh semantic equivalence:

```json
{"a":1,"b":2}
```

```json
{
  "b": 2,
  "a": 1
}
```

Secara object mungkin sama, tapi bytes berbeda.

Masalah lain:

1. Field ordering.
2. Whitespace.
3. Unicode escape.
4. Number formatting.
5. Duplicate keys.
6. Null vs missing field.
7. Date format.
8. Timezone normalization.
9. Map ordering.
10. Floating point representation.

### 9.2 Canonicalization Strategy

Ada tiga strategi umum.

#### Strategy A — Sign Exact Raw Bytes

Cocok untuk file/artifact:

```text
signature = Sign(raw bytes)
```

Kelebihan:

1. Simple.
2. Tidak ada ambiguity parser.
3. Cocok untuk binary/document/archive.

Kekurangan:

1. Tidak cocok jika payload bisa direformat.
2. Tidak otomatis mengikat metadata seperti content type, filename, or domain context.

#### Strategy B — Sign Canonical Representation

Cocok untuk JSON command/event:

```text
signature = Sign(canonicalJson(payload))
```

Kelebihan:

1. Stabil walau object dibuat dari map/DTO.
2. Cocok untuk domain event/command.

Kekurangan:

1. Canonicalization harus didefinisikan dengan sangat ketat.
2. Semua producer/consumer harus konsisten.

#### Strategy C — Sign Structured String-to-Sign

Cocok untuk HTTP request signing:

```text
signature = Sign(canonicalRequestString)
```

Kelebihan:

1. Bisa mengikat method/path/header/body digest/timestamp.
2. Cocok untuk API/webhook.

Kekurangan:

1. Rentan bug jika canonical query/header tidak konsisten.
2. Harus punya test vector.

---

## 10. Signature Envelope Design

Jangan hanya mengirim `signature` string tanpa metadata.

Butuh envelope.

Contoh envelope untuk payload kecil:

```json
{
  "protected": {
    "version": "SIG-V1",
    "alg": "Ed25519",
    "kid": "case-command-signing-key-2026-06",
    "typ": "case-command",
    "canonicalization": "JCS-UTF8",
    "issuedAt": "2026-06-16T10:15:30Z",
    "expiresAt": "2026-06-16T10:20:30Z",
    "nonce": "9f1c1cbd-2da0-4d33-b46e-2b31e7c18b9b"
  },
  "payload": {
    "tenantId": "CEA",
    "caseId": "CASE-123",
    "expectedAggregateVersion": 42,
    "expectedPreviousState": "UNDER_REVIEW",
    "action": "APPROVE",
    "actorId": "officer-88"
  },
  "signature": "base64url..."
}
```

Tetapi hati-hati:

> Header/protected metadata juga harus masuk ke signed bytes, bukan hanya payload.

Jika `alg`, `kid`, `issuedAt`, atau `expiresAt` tidak ikut signed bytes, attacker bisa memodifikasi metadata.

### 10.1 Protected Header

Protected header harus mengandung:

1. Signature format version.
2. Algorithm.
3. Key ID.
4. Payload type.
5. Canonicalization scheme.
6. Created/issued timestamp.
7. Expiry.
8. Optional nonce/request id.
9. Optional issuer.
10. Optional critical headers.

### 10.2 Payload

Payload harus mengandung business data yang relevan:

1. Tenant/scope.
2. Subject resource.
3. Action.
4. Actor/client.
5. Expected state/version.
6. Domain timestamp.
7. Correlation/request id.

### 10.3 Signature

Signature harus dihasilkan dari canonical bytes:

```text
signedBytes = canonicalize(protectedHeader) + "." + canonicalize(payload)
signature = Sign(privateKey, signedBytes)
```

---

## 11. Detached Signature

Detached signature berarti signature dikirim terpisah dari payload.

Contoh:

```text
file.pdf
file.pdf.sig
file.pdf.cert
```

Atau API:

```http
POST /upload
X-Signature: ...
X-Key-Id: ...
X-Content-SHA256: ...

<binary body>
```

Detached signature cocok untuk:

1. File besar.
2. Artifact release.
3. Report export.
4. Evidence package.
5. Integration with storage/object store.

Failure mode:

1. Signature file tidak mengikat filename/content type/context.
2. Digest file bisa dipindah ke payload lain.
3. Signature diverifikasi terhadap digest, tetapi digest tidak diverifikasi terhadap file sebenarnya.
4. Metadata seperti tenant/caseId tidak ikut signed.
5. Public key tidak dipercaya dengan benar.

Lebih aman:

```json
{
  "version": "DETACHED-SIG-V1",
  "alg": "Ed25519",
  "kid": "evidence-signing-key-2026-06",
  "payloadDigestAlg": "SHA-256",
  "payloadDigest": "base64url...",
  "contentType": "application/pdf",
  "fileName": "evidence-CASE-123.pdf",
  "caseId": "CASE-123",
  "tenantId": "CEA",
  "createdAt": "2026-06-16T10:15:30Z",
  "signature": "base64url..."
}
```

Lalu signature dibuat atas semua metadata kecuali field `signature`.

---

## 12. Key ID (`kid`) dan Key Selection

Signature verification perlu memilih public key.

Biasanya envelope punya `kid`.

Namun `kid` adalah input tidak dipercaya.

Anti-pattern:

```java
PublicKey key = fetchKeyFromUrl(header.get("jku"));
verify(key, payload, signature);
```

Bahaya:

1. Attacker mengarahkah verifier ke key miliknya sendiri.
2. SSRF.
3. Key confusion.
4. Algorithm confusion.
5. Cache poisoning.

Prinsip aman:

```text
kid selects from pre-trusted key registry only.
```

Key registry bisa berupa:

1. Local config pinned keys.
2. Database key registry with issuer binding.
3. Truststore/certificate chain.
4. JWKS from trusted issuer URL configured out-of-band.
5. KMS/HSM public key metadata.

Verifier harus melakukan:

```text
1. Parse envelope.
2. Validate allowed alg for issuer/use-case.
3. Lookup kid only within trusted issuer namespace.
4. Ensure key status is active or accepted for verification window.
5. Ensure key usage allows signature verification for this payload type.
6. Verify signature.
7. Verify replay/freshness/domain authorization.
```

---

## 13. Algorithm Confusion

Algorithm confusion terjadi ketika attacker bisa mempengaruhi algorithm verification.

Contoh terkenal di token systems:

```json
{"alg":"none"}
```

Atau:

```text
Expected: RS256 using public key
Attacker uses: HS256 using public key as HMAC secret
```

Walaupun contoh ini sering dibahas di JWT, mental model-nya berlaku umum.

Aturan:

```text
Algorithm is policy, not user preference.
```

Verifier tidak boleh berpikir:

```text
Header says alg=XYZ, so use XYZ.
```

Verifier harus berpikir:

```text
For issuer A and payload type T, allowed algorithms are exactly {Ed25519}.
Envelope alg must match policy.
Key type must match algorithm.
Signature must verify under that policy.
```

---

## 14. Private Key Custody

Digital signature security runtuh jika private key bocor.

Private key harus dianggap sebagai authority-bearing asset.

### 14.1 Private Key Storage Options

| Option | Risk | Cocok untuk |
|---|---|---|
| Plain file in server | Sangat tinggi | Hindari untuk production penting |
| Encrypted PKCS12/JKS file | Medium, tergantung password custody | Legacy/internal apps |
| Secret manager + app memory | Medium | Cloud apps dengan kontrol akses baik |
| KMS asymmetric signing | Lower app exposure | Enterprise/cloud signing |
| HSM | Strong custody | Regulated/high assurance signing |
| Smart card/token | Strong user-bound signing | Human/legal signatures |

### 14.2 KMS/HSM Pattern

Daripada aplikasi memuat private key:

```text
app → KMS.sign(keyId, digest/message) → signature
```

Kelebihan:

1. Private key tidak keluar dari KMS/HSM.
2. Audit signing request.
3. Access control lebih kuat.
4. Rotation lebih mudah.
5. Blast radius lebih kecil.

Trade-off:

1. Latency.
2. Throughput quota.
3. Cost.
4. Vendor dependency.
5. API semantics: sign raw message vs digest.
6. Interoperability dengan Java `Signature` lokal.

### 14.3 Human Signing vs Service Signing

Jangan campur private key untuk:

1. Human legal approval.
2. Service-to-service request signing.
3. Artifact release signing.
4. Audit log chain signing.
5. Test/dev signing.

Setiap use-case harus punya key usage dan lifecycle sendiri.

---

## 15. Key Usage and Separation

Satu key tidak boleh dipakai untuk semua hal.

Anti-pattern:

```text
Same RSA key used for:
- TLS server certificate
- JWT signing
- file encryption
- document signing
- artifact signing
```

Masalah:

1. Key compromise impact terlalu luas.
2. Certificate key usage mungkin tidak sesuai.
3. Rotation menjadi sulit.
4. Audit tidak jelas.
5. Cryptographic protocol context bercampur.
6. Confused deputy risk meningkat.

Prinsip:

```text
One key, one purpose, one trust domain, one lifecycle.
```

Contoh separation:

```text
case-command-signing-key-2026-06
webhook-signing-key-partner-a-2026-q2
audit-chain-signing-key-prod-2026
release-artifact-signing-key-v1
tls-server-key-api-prod
```

---

## 16. Replay Protection

Signature yang valid bisa direplay.

Contoh:

```http
POST /transfer
Signature: valid

{"amount":1000000,"to":"attacker"}
```

Jika request yang sama diterima 10 kali, signature tetap valid 10 kali.

Kontrol replay:

### 16.1 Timestamp Window

```text
issuedAt must be within ±5 minutes.
```

Kelemahan:

1. Replay masih mungkin dalam window.
2. Bergantung clock sync.
3. Window terlalu kecil menyebabkan false reject.

### 16.2 Nonce/Request ID

```text
nonce must be unique per issuer within expiry window.
```

Butuh storage/cache:

1. Redis.
2. Database unique constraint.
3. Distributed cache.
4. Idempotency table.

### 16.3 Sequence Number

Cocok untuk channel stateful:

```text
sequence must equal previous + 1.
```

Kelebihan:

1. Kuat terhadap replay/out-of-order.

Kekurangan:

1. Sulit untuk distributed producer.
2. Recovery kompleks.

### 16.4 Domain State Guard

Untuk command:

```text
expectedAggregateVersion must match current aggregate version.
```

Ini efektif karena replay command lama gagal setelah state berubah.

---

## 17. Timestamping and Long-Term Validation

Signature verification hari ini berbeda dengan verification 5 tahun kemudian.

Masalah long-term:

1. Certificate expired.
2. Key revoked.
3. Algorithm deprecated.
4. Hash weakened.
5. Timestamp tidak dipercaya.
6. Root CA berubah.
7. Public key registry hilang.
8. Signer organization berubah.

Jika signature menjadi evidence jangka panjang, butuh:

1. Trusted timestamp.
2. Certificate chain snapshot.
3. Revocation status at signing time.
4. Algorithm metadata.
5. Signature policy version.
6. Re-signing / archival sealing strategy.
7. Tamper-evident storage.

Untuk audit trail regulatory, signature tanpa timestamping dan key lifecycle evidence sering tidak cukup.

---

## 18. Java Implementation Pattern: Signed Command

Berikut contoh sederhana untuk command signing berbasis Ed25519.

### 18.1 Domain Model

```java
import java.time.Instant;

public record CaseCommand(
        int schemaVersion,
        String tenantId,
        String caseId,
        long expectedAggregateVersion,
        String expectedPreviousState,
        String action,
        String actorId,
        String commandId,
        Instant issuedAt,
        Instant expiresAt
) {}
```

### 18.2 Canonicalizer Sederhana

Untuk production, gunakan canonicalization yang benar-benar didefinisikan dan diuji. Contoh ini sengaja eksplisit agar mental model terlihat.

```java
import java.nio.charset.StandardCharsets;

public final class CaseCommandCanonicalizer {
    private CaseCommandCanonicalizer() {}

    public static byte[] canonicalBytes(CaseCommand c) {
        String canonical = String.join("\n",
                "CASE-COMMAND-SIG-V1",
                "schemaVersion=" + c.schemaVersion(),
                "tenantId=" + requireNoLf(c.tenantId()),
                "caseId=" + requireNoLf(c.caseId()),
                "expectedAggregateVersion=" + c.expectedAggregateVersion(),
                "expectedPreviousState=" + requireNoLf(c.expectedPreviousState()),
                "action=" + requireNoLf(c.action()),
                "actorId=" + requireNoLf(c.actorId()),
                "commandId=" + requireNoLf(c.commandId()),
                "issuedAt=" + c.issuedAt().toString(),
                "expiresAt=" + c.expiresAt().toString()
        );
        return canonical.getBytes(StandardCharsets.UTF_8);
    }

    private static String requireNoLf(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("value is blank");
        }
        if (value.contains("\n") || value.contains("\r")) {
            throw new IllegalArgumentException("value contains newline");
        }
        return value;
    }
}
```

Kenapa ada prefix `CASE-COMMAND-SIG-V1`?

Untuk domain separation.

Tanpa domain separation, bytes yang sama bisa disalahgunakan di context lain.

```text
Same bytes signed for login challenge should not be valid as case approval command.
```

### 18.3 Signing Service

```java
import java.security.PrivateKey;
import java.security.Signature;
import java.util.Base64;

public final class Ed25519CommandSigner {
    public String sign(CaseCommand command, PrivateKey privateKey) {
        try {
            Signature signature = Signature.getInstance("Ed25519");
            signature.initSign(privateKey);
            signature.update(CaseCommandCanonicalizer.canonicalBytes(command));
            byte[] signed = signature.sign();
            return Base64.getUrlEncoder().withoutPadding().encodeToString(signed);
        } catch (Exception e) {
            throw new IllegalStateException("failed to sign command", e);
        }
    }
}
```

### 18.4 Verification Service

```java
import java.security.PublicKey;
import java.security.Signature;
import java.time.Clock;
import java.time.Instant;
import java.util.Base64;

public final class Ed25519CommandVerifier {
    private final Clock clock;
    private final ConsumedCommandStore consumedCommandStore;

    public Ed25519CommandVerifier(Clock clock, ConsumedCommandStore consumedCommandStore) {
        this.clock = clock;
        this.consumedCommandStore = consumedCommandStore;
    }

    public VerificationResult verify(CaseCommand command, String encodedSignature, PublicKey publicKey) {
        Instant now = Instant.now(clock);

        if (command.issuedAt().isAfter(now.plusSeconds(60))) {
            return VerificationResult.reject("issuedAt is in the future");
        }
        if (command.expiresAt().isBefore(now)) {
            return VerificationResult.reject("signature envelope expired");
        }
        if (consumedCommandStore.isConsumed(command.commandId())) {
            return VerificationResult.reject("command replay detected");
        }

        boolean cryptographicOk = verifySignature(command, encodedSignature, publicKey);
        if (!cryptographicOk) {
            return VerificationResult.reject("invalid signature");
        }

        return VerificationResult.accept();
    }

    private boolean verifySignature(CaseCommand command, String encodedSignature, PublicKey publicKey) {
        try {
            byte[] sigBytes = Base64.getUrlDecoder().decode(encodedSignature);
            Signature verifier = Signature.getInstance("Ed25519");
            verifier.initVerify(publicKey);
            verifier.update(CaseCommandCanonicalizer.canonicalBytes(command));
            return verifier.verify(sigBytes);
        } catch (Exception e) {
            return false;
        }
    }
}
```

### 18.5 Result and Replay Store

```java
public record VerificationResult(boolean accepted, String reason) {
    public static VerificationResult accept() {
        return new VerificationResult(true, "accepted");
    }

    public static VerificationResult reject(String reason) {
        return new VerificationResult(false, reason);
    }
}

public interface ConsumedCommandStore {
    boolean isConsumed(String commandId);
    void markConsumed(String commandId);
}
```

Catatan penting:

1. Mark consumed harus dilakukan secara atomic dengan command processing atau idempotency table.
2. Verification success belum berarti command boleh dieksekusi.
3. Authorization dan state transition harus dicek setelah signature verification.
4. Jangan return detail error terlalu spesifik ke external caller jika bisa membantu attacker.

---

## 19. Signature Verification Pipeline

Pipeline yang baik:

```text
Receive signed message
→ parse envelope safely
→ validate envelope version/type
→ validate issuer/client identity source
→ select key from trusted registry
→ validate allowed algorithm for that key/use-case
→ canonicalize protected header + payload
→ verify signature
→ validate freshness/replay
→ validate schema
→ validate authorization
→ validate domain state/invariant
→ process command/event/file
→ record verification evidence
```

Pipeline buruk:

```text
Receive message
→ use alg from header
→ download key from header URL
→ verify body only
→ process action
```

---

## 20. Signed HTTP Request Pattern

Untuk API partner/internal service yang butuh signature:

### 20.1 Headers

```http
X-Signature-Version: SIG-V1
X-Key-Id: partner-a-prod-2026-06
X-Signature-Algorithm: Ed25519
X-Signature-Timestamp: 2026-06-16T10:15:30Z
X-Signature-Nonce: 7f1d7a0f-84d2-4d4e-a9bd-2b7921baf97e
X-Content-SHA256: base64url(...)
X-Signature: base64url(...)
```

### 20.2 Canonical Request

```text
SIG-V1
POST
/v1/cases/CASE-123/approve
page=1&sort=createdAt
content-type:application/json
x-content-sha256:...
x-signature-timestamp:2026-06-16T10:15:30Z
x-signature-nonce:7f1d7a0f-84d2-4d4e-a9bd-2b7921baf97e

<base64url sha256 body>
```

Rules harus ketat:

1. Method uppercase.
2. Path normalized, no dot-segment ambiguity.
3. Query params sorted and percent-encoded consistently.
4. Header names lowercase.
5. Header values trimmed/collapsed sesuai spec.
6. Body digest wajib untuk non-empty body.
7. Timestamp format UTC ISO-8601.
8. Nonce unique per key/window.

---

## 21. Signed Event Pattern

Untuk event-driven system:

```json
{
  "eventId": "evt-2026-0001",
  "eventType": "CaseApproved",
  "eventSchemaVersion": 3,
  "aggregateId": "CASE-123",
  "aggregateVersion": 43,
  "occurredAt": "2026-06-16T10:15:30Z",
  "producer": "case-service",
  "payload": {
    "approvedBy": "officer-88",
    "previousState": "UNDER_REVIEW",
    "newState": "APPROVED"
  },
  "signature": {
    "version": "EVENT-SIG-V1",
    "alg": "Ed25519",
    "kid": "case-service-event-key-2026-06",
    "value": "base64url..."
  }
}
```

Signature should cover:

1. Event ID.
2. Event type.
3. Schema version.
4. Aggregate ID.
5. Aggregate version.
6. Occurred timestamp.
7. Producer.
8. Payload.
9. Signature metadata except signature value.

Verifier tetap harus cek:

1. Producer allowed to emit event type.
2. Aggregate version monotonicity.
3. Duplicate event ID.
4. Schema compatibility.
5. Event causality if needed.

---

## 22. Signed Audit Record Pattern

Audit log yang ingin tamper-evident bisa memakai signature per record atau hash chain + periodic signature.

Contoh record:

```json
{
  "auditRecordId": "aud-00000001",
  "sequence": 1001,
  "previousRecordHash": "base64url...",
  "recordHash": "base64url...",
  "timestamp": "2026-06-16T10:15:30Z",
  "actorId": "officer-88",
  "action": "CASE_APPROVED",
  "resourceId": "CASE-123",
  "result": "SUCCESS",
  "signature": {
    "version": "AUDIT-SIG-V1",
    "alg": "Ed25519",
    "kid": "audit-chain-key-2026-06",
    "value": "base64url..."
  }
}
```

Pattern kuat:

```text
recordHash = Hash(canonical record excluding recordHash/signature)
chainHash = Hash(previousChainHash || recordHash)
periodicSignature = Sign(chainHash at checkpoint)
```

Keuntungan periodic signature:

1. Lebih efisien daripada sign setiap record.
2. Membuat batch tamper-evident.
3. Cocok untuk high-volume audit.

Namun untuk high-value action, per-record signature bisa dibutuhkan.

---

## 23. Large Payload Signing

Untuk file besar, jangan selalu load seluruh file ke memory.

Java `Signature.update` bisa dipanggil streaming.

```java
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.PrivateKey;
import java.security.Signature;

public final class FileSigner {
    public byte[] signFile(Path file, PrivateKey privateKey) throws Exception {
        Signature sig = Signature.getInstance("Ed25519");
        sig.initSign(privateKey);

        byte[] buffer = new byte[8192];
        try (InputStream in = Files.newInputStream(file)) {
            int read;
            while ((read = in.read(buffer)) != -1) {
                sig.update(buffer, 0, read);
            }
        }
        return sig.sign();
    }
}
```

Tetapi untuk detached file signature, sebaiknya sign manifest, bukan raw file saja.

Manifest:

```json
{
  "version": "FILE-MANIFEST-SIG-V1",
  "fileName": "report.pdf",
  "contentType": "application/pdf",
  "length": 1250192,
  "sha256": "base64url...",
  "caseId": "CASE-123",
  "createdAt": "2026-06-16T10:15:30Z"
}
```

Lalu:

```text
signature = Sign(canonical manifest)
```

Verifier:

```text
1. Compute SHA-256 of actual file.
2. Compare with manifest digest.
3. Verify manifest signature.
4. Validate caseId/tenant/context.
5. Check key trust.
```

---

## 24. Signature and Certificates

Public key trust sering dibawa oleh X.509 certificate.

Signature verification dengan certificate tidak hanya:

```java
cert.getPublicKey()
```

Harus mempertimbangkan:

1. Certificate chain valid?
2. Root trusted?
3. Certificate expired?
4. Certificate revoked?
5. Key usage allows digital signature?
6. Extended key usage sesuai use-case?
7. Subject/SAN sesuai identity expected?
8. Policy OID relevant?
9. Signing time vs certificate validity time?
10. Apakah certificate untuk TLS server disalahgunakan untuk document signing?

Ini akan dibahas lebih dalam di Part 12 dan Part 13.

---

## 25. Signature and JWT/JWS

JWT/JWS adalah salah satu format signature paling umum.

Namun part ini bukan detail JWT; itu akan dibahas di Part 19.

Yang penting sekarang:

1. JWS protected header harus ikut ditandatangani.
2. `alg` harus divalidasi terhadap policy.
3. `kid` hanya boleh memilih trusted key.
4. `iss`, `aud`, `exp`, `nbf`, `iat`, `jti` penting untuk semantics.
5. Signature valid bukan berarti token authorized.
6. Key rotation/JWKS cache harus didesain.
7. Jangan implement JWS sendiri kecuali benar-benar perlu.

---

## 26. Signature and Non-Repudiation in Enterprise

Untuk sistem enterprise/regulatory, tanda tangan digital sering dikaitkan dengan akuntabilitas.

Tetapi non-repudiation membutuhkan chain:

```text
identity proofing
→ key issuance
→ private key custody
→ signing policy
→ signature timestamp
→ audit evidence
→ verification evidence
→ revocation status
→ retention policy
```

Jika private key service disimpan di environment variable dan semua developer punya akses, maka signature tidak bisa membuktikan action oleh individu tertentu. Ia hanya membuktikan “seseorang/sesuatu yang punya akses ke key menandatangani”.

Jadi desain harus jelas:

| Use-case | Signer Identity | Non-repudiation Strength |
|---|---|---|
| Internal service event | Service identity | Medium |
| User approval with server key | System attestation of recorded action | Medium, not direct user signature |
| User approval with personal key/smartcard | Individual signer | Higher |
| Artifact release signed by CI key | Release pipeline identity | Medium-high if CI controls strong |
| Audit chain signed by HSM key | System integrity evidence | High for tamper evidence, not user intent |

---

## 27. Misuse Pattern Catalog

### 27.1 Signing Hash Without Domain Context

Bad:

```text
signature = Sign(SHA256(payload))
```

Better:

```text
signature = Sign(canonicalEnvelopeIncludingContextAndDigest)
```

### 27.2 Not Signing Metadata

Bad:

```json
{
  "alg": "Ed25519",
  "kid": "key-1",
  "payload": {...},
  "signature": "..."
}
```

Signature covers only payload.

Attacker can change `kid` or `alg`.

### 27.3 Accepting Algorithm from Caller

Bad:

```java
Signature verifier = Signature.getInstance(header.alg());
```

Better:

```java
Signature verifier = Signature.getInstance(policy.expectedAlgorithm());
```

### 27.4 No Replay Protection

Valid signed command can be executed repeatedly.

### 27.5 No Key Rotation Model

System has one forever key.

Result:

1. Cannot rotate safely.
2. Cannot retire compromised key.
3. Cannot verify old signatures under policy.
4. Cannot distinguish historical vs active key.

### 27.6 Reusing TLS Certificate for Application Signing

TLS server certificate key is for server authentication. Application signing should use a dedicated key unless certificate policy explicitly allows and risk is understood.

### 27.7 ECDSA DER/Raw Confusion

Breaks interoperability or causes invalid verification in JWT/JOSE.

### 27.8 Logging Private Key or Signature Material

Signature is usually public, but private key must never appear in:

1. Logs.
2. Metrics.
3. Heap dump.
4. Thread dump.
5. Exception message.
6. Test fixture committed to repository.

### 27.9 Signing Pretty JSON

Pretty JSON output may change across library version or configuration.

### 27.10 Verifying Then Processing Different Object

Bad:

```text
verify(rawBody)
parse(request.getParameterMap())
process(mappedObjectFromDifferentSource)
```

Verifier and processor must operate on the same canonical payload semantics.

---

## 28. Production Checklist

### 28.1 Algorithm Policy

- [ ] Allowed algorithm is configured by server-side policy.
- [ ] Legacy algorithms disabled for new signatures.
- [ ] RSA-PSS parameters explicit if used.
- [ ] ECDSA curve allowed list defined.
- [ ] EdDSA support verified across environments.
- [ ] Provider behavior tested.

### 28.2 Payload Semantics

- [ ] Payload type/version included.
- [ ] Domain context included.
- [ ] Tenant/scope included.
- [ ] Actor/client/issuer included.
- [ ] Expected state/version included for commands.
- [ ] Timestamp/expiry included.
- [ ] Nonce/request id included when replay matters.

### 28.3 Canonicalization

- [ ] Canonicalization scheme documented.
- [ ] Test vectors exist.
- [ ] Duplicate keys rejected for JSON.
- [ ] Unicode normalization policy defined.
- [ ] Date/time format strict.
- [ ] Number format strict.
- [ ] Header/query canonicalization tested if HTTP signing.

### 28.4 Key Management

- [ ] Key has single purpose.
- [ ] Key ID naming is stable.
- [ ] Key registry is trusted.
- [ ] Key rotation process exists.
- [ ] Compromise response exists.
- [ ] Old signatures verification policy exists.
- [ ] Private key custody documented.
- [ ] KMS/HSM considered for high-value signing.

### 28.5 Verification

- [ ] Parse envelope safely.
- [ ] Validate version/type before verification.
- [ ] Select key from trusted registry only.
- [ ] Validate algorithm matches policy.
- [ ] Verify protected header and payload.
- [ ] Verify freshness/replay.
- [ ] Verify authorization separately.
- [ ] Verify domain invariant separately.
- [ ] Record verification evidence.

### 28.6 Observability

- [ ] Log verification failure category safely.
- [ ] Do not log private key.
- [ ] Do not log full sensitive payload unless allowed.
- [ ] Metric invalid signature rate.
- [ ] Alert on replay spikes.
- [ ] Alert on unknown key id.
- [ ] Alert on expired key usage.

---

## 29. Review Questions

Use these during architecture review or PR review.

1. What exact bytes are signed?
2. Is the signature attached or detached?
3. Is metadata protected by the signature?
4. Is the algorithm selected by policy or by caller input?
5. How is `kid` resolved?
6. What prevents replay?
7. What prevents cross-endpoint or cross-context reuse?
8. Is canonicalization deterministic across producer and verifier?
9. Are test vectors included?
10. What happens if the key is compromised?
11. Can we rotate signing key without downtime?
12. Can we verify signatures created before rotation?
13. What is the blast radius of key compromise?
14. Does private key ever leave KMS/HSM/secure storage?
15. Does signature verification imply authorization? If yes, that is probably a bug.
16. Is certificate chain validated if certificate is used?
17. Are key usage and extended key usage checked?
18. Does verification reject unknown critical metadata?
19. Does verification fail closed?
20. Is failure handling safe against oracle behavior?

---

## 30. Mini Case Study — Signed Case Approval Command

### 30.1 Scenario

A regulatory case management platform receives approval commands from an internal review portal and later from a partner agency integration.

Requirement:

```text
The system must ensure that an APPROVE command cannot be forged, tampered, replayed, or applied to a stale case state.
```

### 30.2 Weak Design

```json
{
  "caseId": "CASE-123",
  "action": "APPROVE",
  "signature": "Sign(caseId + action)"
}
```

Problems:

1. No actor.
2. No tenant.
3. No expected state.
4. No command ID.
5. No timestamp/expiry.
6. No key ID.
7. No signature version.
8. No canonicalization spec.
9. No authorization binding.
10. Replay possible forever.

### 30.3 Stronger Design

```json
{
  "protected": {
    "signatureVersion": "CASE-COMMAND-SIG-V1",
    "alg": "Ed25519",
    "kid": "review-portal-command-key-2026-06",
    "issuer": "review-portal",
    "issuedAt": "2026-06-16T10:15:30Z",
    "expiresAt": "2026-06-16T10:20:30Z",
    "nonce": "8f02f9d0-3ae0-40da-a64c-87a314d0de39"
  },
  "payload": {
    "tenantId": "CEA",
    "caseId": "CASE-123",
    "expectedAggregateVersion": 42,
    "expectedPreviousState": "UNDER_REVIEW",
    "action": "APPROVE",
    "actorId": "officer-88",
    "delegationId": "del-2026-001",
    "commandId": "cmd-2026-000001"
  },
  "signature": "base64url..."
}
```

Verification:

```text
1. Validate envelope version.
2. Resolve issuer review-portal.
3. Lookup kid in trusted registry under issuer namespace.
4. Ensure alg Ed25519 is allowed for this issuer and command type.
5. Canonicalize protected + payload.
6. Verify signature.
7. Check issuedAt/expiresAt.
8. Check nonce/commandId not used.
9. Check actor/delegation authorization.
10. Check case current version == expectedAggregateVersion.
11. Check state transition UNDER_REVIEW → APPROVE is valid.
12. Execute command atomically with consumed-command marker.
13. Append audit record with verification evidence.
```

### 30.4 Security Invariants

```text
Invariant 1:
No unsigned or invalidly signed command can mutate case state.

Invariant 2:
No valid signed command can be applied more than once.

Invariant 3:
No valid signed command can be applied to a case version other than the version it was intended for.

Invariant 4:
Signature validity never bypasses authorization.

Invariant 5:
Signature verification uses only keys from trusted registry.

Invariant 6:
The bytes verified are semantically identical to the command processed.
```

---

## 31. Practical Java Guidance

### 31.1 Prefer High-Level Formats When Appropriate

For JWT/JWS, use mature JOSE libraries.

For document signing, use standards-compatible libraries.

For artifact signing, use ecosystem tooling.

Use raw `Signature` API when:

1. Building internal signed command/event/file manifest.
2. You control both producer and verifier.
3. You can define canonicalization and test vectors.
4. You understand key lifecycle.

### 31.2 Always Include Test Vectors

For any custom signature format, include test vectors:

```text
private/public test key
payload object
canonical bytes hex/base64
signature base64url
expected verification result
negative case: changed payload
negative case: changed header
negative case: expired timestamp
negative case: unknown kid
negative case: replayed nonce
```

### 31.3 Fail Closed

If anything is ambiguous, reject.

Reject:

1. Unknown version.
2. Unknown critical header.
3. Unknown algorithm.
4. Unknown key ID.
5. Expired envelope.
6. Future timestamp beyond skew.
7. Duplicate JSON keys.
8. Unsupported canonicalization.
9. Multiple conflicting signatures unless policy supports it.

### 31.4 Avoid Boolean-Only Verification API Internally

Bad:

```java
boolean verify(...)
```

Better:

```java
VerificationResult verify(...)
```

Where result contains safe internal reason codes:

```text
INVALID_FORMAT
UNKNOWN_KEY
ALGORITHM_NOT_ALLOWED
INVALID_SIGNATURE
EXPIRED
REPLAY_DETECTED
UNAUTHORIZED_SIGNER
DOMAIN_INVARIANT_FAILED
```

External response can still be generic:

```text
401 invalid signature
```

---

## 32. Signature in Distributed Systems

In microservices, signature can be used for:

1. Service-to-service request signing.
2. Event signing.
3. Command signing.
4. Webhook verification.
5. Artifact/package verification.
6. Audit log sealing.
7. Evidence file integrity.

But beware overuse.

If all services already communicate over mutually authenticated TLS, do you still need per-message signature?

Maybe yes if:

1. Messages are stored and verified later.
2. Broker/storage is not fully trusted.
3. Payload crosses trust domains.
4. You need end-to-end integrity beyond transport.
5. You need audit evidence after transport session ends.
6. You need non-repudiation-ish service attestation.

Maybe no if:

1. Message never leaves trusted transport boundary.
2. mTLS + authorization + broker ACL is enough.
3. Operational complexity outweighs benefit.
4. Key management maturity is low.

Decision rule:

```text
Use signatures when integrity/authenticity must survive beyond the transport/session boundary.
```

---

## 33. Common Java Algorithm Names

Common names you may encounter:

```text
SHA256withRSA
SHA384withRSA
SHA512withRSA
RSASSA-PSS
SHA256withECDSA
SHA384withECDSA
SHA512withECDSA
Ed25519
Ed448
EdDSA
```

Avoid for new design:

```text
MD2withRSA
MD5withRSA
SHA1withRSA
SHA1withDSA
SHA1withECDSA
```

For portability, always check Java Security Standard Algorithm Names and provider documentation for the JDK version and provider you deploy.

---

## 34. Summary

Digital signature is not “encryption with private key”. It is a mechanism for binding bytes to a private key such that anyone with the corresponding trusted public key can verify integrity and origin authenticity.

The hard part is rarely calling Java `Signature.sign()`.

The hard parts are:

1. Deciding what must be signed.
2. Canonicalizing bytes correctly.
3. Binding signature to domain context.
4. Preventing replay.
5. Selecting key from a trusted registry.
6. Preventing algorithm confusion.
7. Managing private key custody.
8. Rotating keys safely.
9. Separating signature verification from authorization.
10. Preserving evidence over time.

Mental model paling penting:

```text
A signature is valid only for the exact bytes, algorithm policy, key identity, trust context, time window, and domain semantics it was designed for.
```

Jika salah satu bagian itu ambiguity, signature bisa memberi rasa aman palsu.

---

## 35. Checklist Singkat untuk Part Berikutnya

Sebelum lanjut, pastikan kamu bisa menjawab:

1. Kapan memakai MAC dan kapan memakai digital signature?
2. Kenapa signature tidak memberikan confidentiality?
3. Kenapa signature valid tidak otomatis berarti authorized?
4. Kenapa canonicalization adalah inti signature correctness?
5. Apa risiko `kid` jika digunakan untuk mengambil public key secara bebas?
6. Apa perbedaan RSA-PSS, ECDSA, dan Ed25519 dari sisi engineering?
7. Bagaimana replay bisa terjadi walaupun signature valid?
8. Apa yang harus ada dalam signed command envelope?
9. Mengapa private key custody menentukan kekuatan non-repudiation?
10. Mengapa signing exact bytes berbeda dari signing semantic object?

---

## 36. Referensi

1. Oracle Java `Signature` API — `java.security.Signature`.
2. Oracle Java Security Standard Algorithm Names.
3. Oracle JDK Providers Documentation.
4. NIST FIPS 186-5 — Digital Signature Standard.
5. OWASP Key Management Cheat Sheet.
6. OWASP Cryptographic Storage Cheat Sheet.
7. RFC 8032 — Edwards-Curve Digital Signature Algorithm.
8. RFC 7515 — JSON Web Signature.
9. RFC 8785 — JSON Canonicalization Scheme.
10. Java platform security documentation for provider-specific algorithm support.

---

# Status Seri

Seri **belum selesai**.

Progress saat ini:

```text
Part 0  — selesai
Part 1  — selesai
Part 2  — selesai
Part 3  — selesai
Part 4  — selesai
Part 5  — selesai
Part 6  — selesai
Part 7  — selesai
Part 8  — selesai
Part 9  — selesai
Part 10 — berikutnya
...
Part 34 — target akhir seri
```

Bagian berikutnya:

```text
Part 10 — Asymmetric Encryption and Key Agreement
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-security-cryptography-integrity-part-008](./learn-java-security-cryptography-integrity-part-008.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-security-cryptography-integrity-part-010.md](./learn-java-security-cryptography-integrity-part-010.md)
