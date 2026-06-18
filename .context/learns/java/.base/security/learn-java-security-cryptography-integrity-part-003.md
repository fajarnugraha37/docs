# learn-java-security-cryptography-integrity-part-003

# Part 3 — Cryptography Mental Model: What Crypto Can and Cannot Guarantee

> Seri: Java Security, Cryptography, dan Integrity  
> Posisi: Part 3 dari 35  
> Prasyarat: Part 0 — Security Mental Model, Part 1 — Java Security Architecture, Part 2 — Threat Modeling  
> Fokus: membangun cara berpikir yang benar sebelum menyentuh API seperti `Cipher`, `Mac`, `Signature`, `MessageDigest`, `KeyStore`, atau TLS.

---

## 0. Tujuan Part Ini

Di banyak project Java enterprise, kesalahan cryptography jarang terjadi karena developer tidak tahu cara memanggil API. Kesalahan justru sering muncul karena developer tidak tahu **guarantee apa yang sedang dibutuhkan**.

Contoh kesalahan mental model:

```text
"Data ini sudah di-base64, berarti aman."
"Password kita encrypt saja supaya bisa dibandingkan nanti."
"Kalau pakai HTTPS, semua integrity problem selesai."
"Hash payload berarti payload tidak bisa dimanipulasi."
"Signature itu sama dengan encryption pakai private key."
"AES/GCM aman, jadi nonce tidak terlalu penting."
"JWT sudah signed, berarti user pasti masih aktif dan role-nya masih valid."
"Kita simpan key di source code dulu, nanti bisa diganti."
```

Part ini bertujuan membuat kamu mampu membedakan:

1. Kapan butuh **confidentiality**.
2. Kapan butuh **integrity**.
3. Kapan butuh **authenticity**.
4. Kapan butuh **non-repudiation**.
5. Kapan butuh **freshness / anti-replay**.
6. Kapan butuh **availability/security degradation handling**, bukan crypto primitive.
7. Kapan crypto tidak cukup karena masalahnya ada di trust boundary, key custody, authorization, data lifecycle, atau operational process.

Part ini belum bertujuan membuat kamu hafal syntax Java cryptography. Itu akan dibahas bertahap di part berikutnya. Di sini kita membangun fondasi agar saat nanti memakai `Cipher`, `Mac`, `Signature`, `KeyAgreement`, `KeyStore`, atau TLS, kamu tahu **mengapa memilih primitive tertentu dan failure mode apa yang wajib dicegah**.

---

## 1. Ringkasan Mental Model

Cryptography adalah alat untuk membangun **security properties** terhadap data dan komunikasi. Namun cryptography bukan magic shield. Crypto hanya memberi guarantee tertentu dalam asumsi tertentu.

Kalimat penting:

```text
Crypto tidak mengamankan sistem.
Crypto mengamankan property tertentu dari data/protocol, selama key, randomness,
algorithm, mode, composition, implementation, dan operational process benar.
```

Artinya, ketika kamu berkata “pakai crypto”, pertanyaan senior engineer seharusnya:

```text
Crypto untuk property apa?
Melawan attacker yang mana?
Pada trust boundary yang mana?
Dengan key yang dikuasai siapa?
Dengan lifecycle apa?
Apa yang terjadi saat key compromise?
Apa yang terjadi saat payload di-replay?
Apa yang terjadi saat algorithm harus diganti?
Apa yang terjadi saat clock drift?
Apa yang terjadi saat certificate expire?
Apa yang terjadi saat dependency punya CVE?
Apa yang terjadi saat log menyimpan plaintext?
```

---

## 2. Vocabulary Dasar: Jangan Campur Istilah

### 2.1 Encoding

Encoding mengubah representasi data agar bisa ditransfer atau disimpan.

Contoh:

- Base64.
- Hex.
- URL encoding.
- UTF-8 encoding.

Encoding **bukan security control**.

```java
String token = Base64.getEncoder().encodeToString(secretBytes);
```

Kode di atas tidak membuat data rahasia menjadi aman. Siapa pun bisa decode Base64.

Mental model:

```text
Encoding = representasi.
Encryption = kerahasiaan.
Hashing = fingerprint satu arah.
MAC = integrity + authenticity dengan shared secret.
Signature = integrity + authenticity dengan private/public key.
```

### 2.2 Obfuscation

Obfuscation membuat sesuatu lebih sulit dibaca, tetapi tidak memberi guarantee cryptographic yang kuat.

Contoh:

- Mengacak nama field.
- Mengubah format string.
- Menyembunyikan key di class Java.
- Menaruh secret dalam file resource dengan transformasi sederhana.

Obfuscation bisa memperlambat attacker, tetapi jangan dianggap sebagai boundary keamanan.

### 2.3 Hashing

Hash cryptographic mengubah input menjadi digest fixed-size.

Contoh Java:

```java
MessageDigest digest = MessageDigest.getInstance("SHA-256");
byte[] hash = digest.digest(data);
```

Hash memberi beberapa property tergantung algorithm:

- Preimage resistance.
- Second-preimage resistance.
- Collision resistance.

Namun hash biasa **tidak membuktikan siapa pembuat data**.

Jika attacker bisa mengubah data dan menghitung hash baru, maka hash tidak melindungi integrity terhadap attacker itu.

### 2.4 Checksum

Checksum dipakai untuk mendeteksi kesalahan tidak sengaja, bukan attacker aktif.

Contoh:

- CRC32.
- Adler32.

Checksum cocok untuk corruption detection, bukan tamper resistance.

```text
Checksum melawan noise.
Cryptographic hash/MAC/signature melawan adversary.
```

### 2.5 Encryption

Encryption melindungi confidentiality.

Jika data dienkripsi dengan benar, pihak tanpa key tidak bisa membaca plaintext.

Namun encryption saja belum tentu memberi integrity. Banyak mode lama seperti CBC tanpa MAC bisa rentan terhadap manipulasi tertentu.

### 2.6 Authenticated Encryption

Authenticated Encryption with Associated Data atau AEAD memberi dua property sekaligus:

1. Confidentiality untuk plaintext.
2. Integrity/authenticity untuk ciphertext dan optional associated data.

Contoh umum:

- AES-GCM.
- ChaCha20-Poly1305.

AEAD adalah default modern untuk banyak kebutuhan encryption application-level.

### 2.7 MAC

Message Authentication Code membuktikan bahwa pesan dibuat oleh pihak yang memiliki shared secret key dan pesan tidak berubah.

Contoh:

- HMAC-SHA-256.
- CMAC.

MAC cocok untuk:

- Webhook verification.
- Internal service request signing.
- File manifest integrity antar sistem yang berbagi secret.
- Callback authenticity.

MAC tidak cocok untuk non-repudiation karena semua pihak yang punya secret bisa membuat MAC yang valid.

### 2.8 Digital Signature

Digital signature menggunakan private key untuk signing dan public key untuk verification.

Memberikan:

- Integrity.
- Authenticity.
- Dalam konteks tertentu, non-repudiation.

Contoh algorithm:

- RSA-PSS.
- ECDSA.
- EdDSA.

Signature cocok ketika verifier tidak boleh bisa membuat signature sendiri.

### 2.9 Key Agreement

Key agreement memungkinkan dua pihak membangun shared secret melalui public channel.

Contoh:

- ECDH.
- Diffie-Hellman.

Key agreement bukan encryption langsung. Ia menghasilkan shared secret yang kemudian biasanya dipakai untuk derive encryption/MAC keys.

### 2.10 Key Derivation

Key derivation mengubah secret/key material menjadi key lain yang sesuai konteks.

Contoh:

- HKDF.
- PBKDF2.
- Argon2id untuk password-derived secret.

Key derivation penting untuk:

- Key separation.
- Password-based encryption.
- Session key derivation.
- Protocol design.

---

## 3. Security Properties: Apa yang Sebenarnya Dijamin?

### 3.1 Confidentiality

Confidentiality berarti data tidak bisa dibaca oleh pihak yang tidak berwenang.

Contoh requirement:

```text
Nomor identitas, data case, dokumen bukti, dan token akses tidak boleh dapat dibaca
oleh pihak yang tidak memiliki akses sah, termasuk jika database snapshot bocor.
```

Primitive umum:

- Symmetric encryption.
- Asymmetric encryption.
- TLS untuk data in transit.
- Envelope encryption untuk data at rest.

Failure mode:

- Key bocor.
- IV/nonce reuse.
- Algorithm/mode lemah.
- Plaintext bocor di log.
- Plaintext bocor di cache.
- Plaintext bocor di exception.
- Plaintext bocor di metrics/traces.
- Data sudah didecrypt terlalu awal dan tersebar ke banyak layer.

### 3.2 Integrity

Integrity berarti data tidak berubah tanpa terdeteksi.

Contoh requirement:

```text
Case decision, evidence metadata, approval record, dan audit trail tidak boleh bisa
diubah tanpa terdeteksi.
```

Primitive umum:

- MAC.
- Digital signature.
- Cryptographic hash dalam manifest yang dipercaya.
- Hash chain.
- Merkle tree.
- AEAD.

Failure mode:

- Hash biasa disimpan bersama data di lokasi yang sama dan sama-sama bisa dimodifikasi attacker.
- Signature dibuat atas format non-canonical.
- Field penting tidak ikut di-sign.
- Replay data lama masih diterima.
- Integrity hanya dicek di ingress, tapi data berubah di internal pipeline.

### 3.3 Authenticity

Authenticity berarti kamu bisa memverifikasi asal data atau identitas pihak yang membuat data.

Contoh requirement:

```text
Sistem hanya menerima callback jika benar berasal dari partner resmi.
```

Primitive/protocol umum:

- MAC dengan shared secret.
- Digital signature dengan public key partner.
- TLS server authentication.
- mTLS client authentication.
- JWT/JWS verification.

Failure mode:

- Verifier tidak memeriksa issuer/audience.
- Truststore berisi CA terlalu luas.
- Hostname verification dimatikan.
- `kid` header dipercaya untuk mengambil key dari URL attacker.
- Public key didapat dari channel yang tidak trusted.

### 3.4 Non-repudiation

Non-repudiation berarti pihak yang menandatangani sulit menyangkal bahwa ia melakukan signing, terutama jika private key custody, certificate policy, timestamping, dan audit process valid.

Primitive umum:

- Digital signature.
- Timestamp authority.
- Certificate-based identity.
- Audit trail.

Namun non-repudiation bukan sekadar “pakai digital signature”. Ia membutuhkan:

- Private key custody yang kuat.
- Bukti siapa mengendalikan private key.
- Timestamp terpercaya.
- Certificate validity pada waktu signing.
- Revocation status.
- Auditability.
- Process governance.

### 3.5 Freshness

Freshness berarti data masih baru dan bukan replay dari transaksi lama.

Contoh requirement:

```text
Callback pembayaran yang valid kemarin tidak boleh bisa dikirim ulang hari ini untuk
mengubah status transaksi lagi.
```

Mechanism umum:

- Timestamp.
- Nonce.
- Sequence number.
- Challenge-response.
- Idempotency key.
- Replay cache.
- Token expiry.

Crypto signature/MAC tanpa freshness sering gagal melawan replay.

### 3.6 Authorization Correctness

Authorization correctness bukan property cryptographic murni, tetapi sering salah diasumsikan selesai karena token sudah signed.

Contoh salah:

```text
JWT signature valid, berarti user boleh melakukan action ini.
```

Yang benar:

```text
JWT signature valid hanya berarti token belum berubah dan diterbitkan oleh issuer yang dipercaya.
Authorization tetap harus mengecek subject, audience, scope, role, tenant, resource owner,
state, delegation, dan current policy.
```

### 3.7 Availability

Crypto bisa merusak availability jika salah desain.

Contoh:

- Password hashing cost terlalu tinggi sehingga login endpoint mudah DoS.
- TLS handshake terlalu berat tanpa connection reuse.
- Key service unavailable membuat semua request gagal.
- Revocation checking blocking menyebabkan outage.
- Entropy starvation pada startup.

Security design harus selalu mempertimbangkan availability.

---

## 4. Crypto Primitive vs Security Goal

| Security Goal | Primitive/Mechanism | Catatan |
|---|---|---|
| Menyembunyikan isi data | Encryption | Butuh key management dan mode aman. |
| Mendeteksi perubahan data | MAC/signature/hash manifest | Hash biasa hanya aman jika digest dilindungi. |
| Membuktikan asal pesan antar dua service yang berbagi secret | HMAC | Tidak memberi non-repudiation. |
| Membuktikan asal dokumen ke banyak verifier | Digital signature | Verifier tidak butuh private key. |
| Menyimpan password | Password hashing | Jangan reversible encryption. |
| Membuktikan koneksi ke server benar | TLS + hostname verification | Jangan disable certificate validation. |
| Membuktikan client juga punya identity | mTLS | Perlu certificate mapping dan revocation strategy. |
| Menghindari replay | Timestamp/nonce/sequence/replay cache | Signature/MAC saja tidak cukup. |
| Mengganti key tanpa re-encrypt semua data | Envelope encryption | Pisah DEK dan KEK. |
| Membuat audit trail tamper-evident | Hash chain/signature | Butuh canonical event dan protected anchor. |

---

## 5. Model Paling Penting: Attacker Capability

Sebelum memilih primitive, definisikan attacker capability.

### 5.1 Passive Network Attacker

Attacker hanya bisa membaca traffic.

Control umum:

- TLS.
- Encryption.

### 5.2 Active Network Attacker

Attacker bisa membaca, mengubah, menghapus, menyisipkan, dan replay traffic.

Control umum:

- TLS dengan certificate validation.
- MAC/signature.
- Freshness mechanism.
- Replay detection.

### 5.3 Database Read Attacker

Attacker bisa membaca database, backup, snapshot, atau replica.

Control umum:

- Field-level encryption.
- Envelope encryption.
- Password hashing.
- Token hashing.
- PII minimization.

### 5.4 Database Write Attacker

Attacker bisa mengubah row database.

Control umum:

- MAC/signature atas record penting.
- Tamper-evident audit trail.
- Immutable/event-sourced record dengan protected anchor.
- Segregated key custody.

Catatan penting:

```text
Encryption saja tidak mencegah attacker dengan akses tulis database mengganti ciphertext
lama dengan ciphertext valid lain, kecuali desain menangani substitution/replay/version binding.
```

### 5.5 Application Server Attacker

Attacker bisa menjalankan code di app server.

Control menjadi jauh lebih sulit karena plaintext dan key mungkin tersedia di runtime.

Mitigation:

- Least privilege.
- KMS/HSM.
- Tokenization.
- Short-lived credentials.
- Segmented service responsibility.
- Runtime hardening.
- Detection and incident response.

### 5.6 Insider / Privileged Operator

Attacker punya akses administratif tertentu.

Control:

- Separation of duties.
- Dual control.
- Audit trail.
- Key access policy.
- HSM/KMS policy.
- Break-glass workflow.
- Tamper-evident logging.

### 5.7 Malicious Dependency

Library bisa membaca memory, environment variable, filesystem, network.

Control:

- Dependency governance.
- SBOM.
- Repository trust.
- Runtime egress control.
- Secret minimization.
- Code review.
- Sandbox where possible.

---

## 6. Data States: At Rest, In Transit, In Use

### 6.1 Data at Rest

Data tersimpan di:

- Database.
- File storage.
- Backup.
- Object storage.
- Queue persistence.
- Cache.
- Search index.
- Log.
- Heap dump.

Control:

- Disk/database encryption.
- Field-level encryption.
- Key management.
- Retention control.
- Access control.
- Integrity manifest.

Important distinction:

```text
Storage-level encryption melindungi jika media/storage dicuri.
Field-level encryption bisa melindungi terhadap sebagian database-read exposure.
Namun jika aplikasi punya key dan attacker menguasai aplikasi, plaintext tetap berisiko.
```

### 6.2 Data in Transit

Data bergerak melalui:

- HTTP.
- gRPC.
- Message broker.
- File transfer.
- Webhook.
- Database connection.
- Internal service call.

Control:

- TLS.
- mTLS.
- Request signing.
- Message-level signature.
- Replay protection.

Important distinction:

```text
TLS melindungi channel.
Message-level signing melindungi payload lintas hop dan lintas storage.
```

Jika data melewati API gateway, queue, file drop, ETL, atau partner system, TLS saja mungkin tidak cukup untuk end-to-end integrity.

### 6.3 Data in Use

Data sedang diproses di:

- JVM heap.
- Thread stack.
- CPU registers.
- Temporary buffers.
- Logs/traces.
- Object mapper.
- Exception message.

Control lebih terbatas:

- Minimize plaintext lifetime.
- Avoid unnecessary copies.
- Do not log secrets.
- Use char array only where meaningful.
- Clear buffers where practical.
- Avoid heap dumps in production or protect them.
- Segment services.

Important reality:

```text
Java tidak memberi deterministic memory zeroization guarantee untuk semua object.
Karena itu desain harus mengurangi secret exposure, bukan hanya mengandalkan clear memory.
```

---

## 7. Crypto Composition: Sering Lebih Penting dari Primitive

Primitive yang aman bisa menjadi tidak aman jika composition salah.

### 7.1 Encrypt-Only Problem

Misal sistem mengenkripsi JSON approval:

```json
{
  "caseId": "C-100",
  "decision": "APPROVED",
  "officerId": "U-01"
}
```

Jika menggunakan encryption mode tanpa integrity, attacker mungkin tidak bisa membaca plaintext, tetapi bisa memodifikasi ciphertext sehingga plaintext berubah secara terkontrol atau menyebabkan oracle.

Solusi modern:

- AEAD seperti AES-GCM.
- Encrypt-then-MAC jika memakai primitive lama secara manual.

### 7.2 Hash-Only Problem

Sistem menyimpan:

```text
payload
sha256(payload)
```

Jika attacker bisa mengubah payload dan hash, maka hash tidak berguna sebagai tamper protection.

Hash hanya menjadi integrity control jika:

- Digest disimpan di tempat yang tidak bisa diubah attacker.
- Digest ditandatangani.
- Digest masuk hash chain yang anchored ke protected storage.
- Digest dipublikasikan ke append-only ledger/log yang berbeda trust boundary.

### 7.3 Sign-Wrong-Thing Problem

Signature hanya melindungi byte yang ditandatangani.

Jika field penting tidak ikut disign, attacker bisa mengubah field itu.

Contoh buruk:

```text
Sign: caseId + decision
Not signed: effectiveDate, officerRole, tenantId
```

Akibat:

- Signature valid.
- Semantics berubah.

Rule:

```text
Sign semantic decision, not random subset of fields.
```

### 7.4 No Canonicalization Problem

Jika signer dan verifier membentuk byte berbeda dari objek yang “terlihat sama”, verification bisa gagal atau lebih buruk: attacker bisa membuat dua representasi berbeda dengan meaning berbeda.

Contoh area rawan:

- JSON field order.
- Whitespace.
- Unicode normalization.
- XML canonicalization.
- Decimal formatting.
- Timestamp timezone.
- Null vs absent field.
- Map iteration order.

Rule:

```text
Canonicalize before hashing/signing/verifying.
```

### 7.5 No Context Binding Problem

Ciphertext/signature/MAC valid untuk satu konteks, lalu dipakai di konteks lain.

Contoh:

```text
Encrypted value untuk userId dipindahkan ke field officerId.
Signed approval untuk tenant A diterima di tenant B.
Token untuk service A diterima service B.
```

Solusi:

- Include context in AAD/signature/MAC.
- Bind tenantId, purpose, schema version, issuer, audience, resource type.
- Use key separation per purpose.

---

## 8. Key Is the System

Dalam cryptography, algorithm sering jadi fokus diskusi, tetapi key biasanya adalah sistem sebenarnya.

Pertanyaan penting:

```text
Siapa yang membuat key?
Di mana key disimpan?
Siapa yang bisa membaca key?
Siapa yang bisa memakai key tanpa membacanya?
Bagaimana key diputar?
Bagaimana key dicabut?
Apa blast radius jika key bocor?
Bagaimana tahu key bocor?
Bagaimana decrypt data lama setelah rotation?
Bagaimana mencegah key dipakai untuk purpose yang salah?
```

### 8.1 Data Encryption Key vs Key Encryption Key

Envelope encryption memisahkan:

- DEK: Data Encryption Key, untuk encrypt data.
- KEK: Key Encryption Key, untuk wrap/encrypt DEK.

Mental model:

```text
Data dienkripsi oleh DEK.
DEK dilindungi oleh KEK.
KEK dikelola oleh KMS/HSM atau protected keystore.
```

Keuntungan:

- Rotation KEK tidak harus re-encrypt semua data.
- Blast radius lebih kecil.
- Audit key usage lebih baik.

### 8.2 Key Separation

Jangan gunakan satu key untuk semua purpose.

Buruk:

```text
sameKey untuk encrypt PII, sign token, HMAC webhook, dan encrypt file.
```

Baik:

```text
key.pii.encryption.v1
key.audit.signing.v1
key.webhook.hmac.partnerA.v3
key.jwt.signing.authServer.v2
```

Key harus terikat pada:

- Purpose.
- Algorithm.
- Environment.
- Tenant/partner jika perlu.
- Version.
- Validity period.

### 8.3 Key Versioning

Encrypted/signed payload harus menyimpan key version atau key id yang aman.

Contoh envelope:

```json
{
  "version": 1,
  "alg": "AES-256-GCM",
  "keyId": "pii-dek-2026-01",
  "nonce": "...",
  "aad": "...",
  "ciphertext": "...",
  "tag": "..."
}
```

Tetapi `keyId` tidak boleh menjadi injection vector. Jangan biarkan attacker mengontrol `keyId` untuk mengambil key dari lokasi arbitrary.

---

## 9. Randomness: Source of Many Catastrophic Failures

Randomness dipakai untuk:

- Key generation.
- Nonce.
- IV.
- Salt.
- Session ID.
- CSRF token.
- Password reset token.
- Challenge.

Dalam Java security, default berpikirnya:

```text
Untuk security randomness, gunakan SecureRandom atau API yang jelas menggunakan CSPRNG.
Jangan gunakan Random, Math.random, atau ThreadLocalRandom untuk token/key/secret.
```

Namun randomness bukan hanya “pakai SecureRandom”. Perhatikan:

1. Apakah nilai harus unpredictable?
2. Apakah nilai harus unique?
3. Apakah nilai boleh public?
4. Apakah nilai harus disimpan?
5. Apakah collision fatal?
6. Apakah reuse fatal?

### 9.1 Salt

Salt biasanya public dan unique per password/item.

Tujuan:

- Mencegah precomputed rainbow table.
- Membuat password yang sama menghasilkan hash berbeda.

Salt tidak harus secret.

### 9.2 Nonce

Nonce sering tidak harus secret, tetapi harus unique untuk key tertentu.

Pada mode seperti GCM, nonce reuse dengan key yang sama bisa menjadi catastrophic.

### 9.3 IV

IV tergantung mode:

- Untuk beberapa mode harus random/unpredictable.
- Untuk beberapa mode cukup unique.
- Untuk AEAD modern seperti GCM, uniqueness sangat kritis.

### 9.4 Token

Token security biasanya membutuhkan unpredictability dan entropy cukup besar.

Contoh:

- Reset password token.
- Email verification token.
- API key.
- Session ID.

Jangan gunakan timestamp, incremental ID, atau UUID tertentu tanpa analisis entropy.

---

## 10. Algorithm Choice: Jangan Mendesain dari Nama Algorithm Saja

Pertanyaan yang benar bukan:

```text
AES atau RSA?
```

Pertanyaan yang benar:

```text
Apa security property?
Berapa ukuran data?
Siapa yang punya key?
Berapa banyak verifier?
Apakah perlu non-repudiation?
Apakah perlu streaming?
Apakah perlu random access?
Apakah perlu rotate key?
Apakah perlu backward compatibility?
Apakah ada compliance requirement?
```

### 10.1 Symmetric Encryption

Cocok untuk data besar dan data at rest.

Contoh:

- Field-level encryption.
- File encryption.
- Message encryption.

Biasanya cepat dan efisien.

Tantangan utama:

- Key sharing.
- Key custody.
- Key rotation.

### 10.2 Asymmetric Encryption

Cocok untuk:

- Encrypt small key material.
- Hybrid/envelope encryption.
- Key exchange.

Tidak cocok untuk encrypt file besar langsung.

### 10.3 Signature

Cocok ketika:

- Banyak verifier.
- Verifier tidak boleh bisa membuat pesan valid.
- Butuh audit/legal assertion.

### 10.4 MAC

Cocok ketika:

- Pihak terbatas berbagi secret.
- Butuh performance.
- Tidak butuh non-repudiation.

### 10.5 Password Hashing

Cocok untuk password verification.

Password storage tidak boleh memakai encryption reversible sebagai mekanisme utama. Password harus disimpan dengan password hashing yang dirancang lambat/adaptive dan memakai salt.

---

## 11. Java Mapping: Primitive ke API

Berikut peta awal. Detail akan dibahas pada part berikutnya.

| Need | Java API Umum | Catatan |
|---|---|---|
| Cryptographic hash | `MessageDigest` | Misalnya SHA-256/SHA-3. Jangan untuk password langsung. |
| MAC | `Mac` | Misalnya HmacSHA256. |
| Symmetric encryption | `Cipher` | Mode/padding sangat penting. |
| AEAD | `Cipher` + GCM/ChaCha20-Poly1305 | Perhatikan nonce/tag/AAD. |
| Digital signature | `Signature` | Algorithm selection penting. |
| Key pair generation | `KeyPairGenerator` | Butuh parameter benar. |
| Secret key generation | `KeyGenerator` | Butuh secure randomness. |
| Key agreement | `KeyAgreement` | Biasanya perlu KDF setelah shared secret. |
| Randomness | `SecureRandom` | Jangan `Random` untuk security. |
| Key storage | `KeyStore` | JKS/PKCS12/HSM provider/KMS integration. |
| Certificate validation | `CertPath`, `TrustManager` | Jangan custom trust-all. |
| TLS | JSSE | Hostname verification dan trust manager penting. |

---

## 12. Misuse Patterns Paling Umum

### 12.1 Base64 dianggap encryption

Buruk:

```java
String stored = Base64.getEncoder().encodeToString(secret.getBytes(StandardCharsets.UTF_8));
```

Masalah:

- Reversible tanpa key.
- Tidak memberi confidentiality.

### 12.2 Password dienkripsi

Buruk:

```text
password_plaintext -> AES encrypt -> database
```

Masalah:

- Jika key bocor, semua password kembali plaintext.
- Sistem tidak seharusnya bisa recover password.

Benar:

```text
password -> Argon2id/bcrypt/scrypt/PBKDF2 + salt + work factor -> verifier
```

### 12.3 Hash untuk authentication tanpa secret

Buruk:

```text
header: X-Signature = sha256(body)
```

Masalah:

- Attacker yang mengubah body bisa menghitung SHA-256 baru.

Benar:

```text
X-Signature = HMAC-SHA256(secret, canonicalRequest)
```

atau digital signature jika verifier tidak boleh punya signing capability.

### 12.4 Disable TLS Validation

Buruk:

```java
TrustManager[] trustAll = ...
HostnameVerifier allHostsValid = (hostname, session) -> true;
```

Masalah:

- Active MITM bisa sukses.
- TLS berubah menjadi encryption ke attacker.

### 12.5 Hardcoded Key

Buruk:

```java
private static final String SECRET = "prod-secret-key";
```

Masalah:

- Source leak = key leak.
- Tidak ada rotation.
- Sulit audit usage.
- Bisa tersebar ke artifact, logs, decompiler.

### 12.6 Reusing Nonce/IV

Buruk:

```text
AES-GCM key sama + nonce sama untuk banyak pesan.
```

Masalah:

- Bisa membocorkan informasi plaintext.
- Bisa memungkinkan forgery.

### 12.7 Algorithm Agility Tanpa Policy

Buruk:

```text
Payload header menentukan alg, server mengikuti tanpa allowlist.
```

Masalah:

- Downgrade attack.
- Algorithm confusion.
- `none`/weak algorithm class mistakes.

Benar:

```text
Verifier menentukan allowed algorithms berdasarkan trusted configuration.
Header hanya hint, bukan otoritas.
```

### 12.8 Signing Non-Canonical JSON

Buruk:

```text
Sign JSON string hasil serialisasi default tanpa menjamin field order/timezone/number format.
```

Masalah:

- Verification rapuh.
- Bisa terjadi semantic ambiguity.

### 12.9 Key Digunakan untuk Banyak Purpose

Buruk:

```text
Satu secret dipakai untuk JWT, webhook, encryption, dan CSRF.
```

Masalah:

- Compromise satu area menghancurkan semua area.
- Cryptographic separation rusak.
- Audit dan rotation sulit.

### 12.10 Tidak Ada Failure Strategy

Buruk:

```text
Jika KMS down, fallback ke plaintext.
Jika signature verification gagal, log warning tapi tetap proses.
Jika certificate invalid, allow untuk sementara.
```

Security failure harus default-deny untuk boundary penting.

---

## 13. Crypto Does Not Solve These Problems Alone

### 13.1 Authorization Bug

Signature valid tidak berarti action authorized.

Contoh:

```text
User punya signed token valid, tetapi mencoba mengakses case tenant lain.
```

Crypto hanya membuktikan token tidak berubah dan issuer valid. Authorization tetap harus memeriksa resource-level permission.

### 13.2 Business Logic Abuse

Encryption tidak mencegah user memanfaatkan workflow yang salah.

Contoh:

- Submit appeal setelah deadline karena server hanya cek di frontend.
- Approve case sendiri karena role conflict tidak dicek.
- Replay callback valid untuk menggandakan settlement.

### 13.3 Compromised Endpoint

Jika endpoint sudah compromise, TLS tidak membantu karena attacker membaca data sebelum/after encryption.

### 13.4 Bad Key Custody

Algorithm kuat tidak berguna jika key:

- Ada di Git.
- Ada di Docker image.
- Ada di logs.
- Bisa dibaca semua pod.
- Tidak pernah rotate.
- Dipakai lintas environment.

### 13.5 Bad Data Lifecycle

Data dienkripsi di database tetapi plaintext disalin ke:

- Search index.
- Cache.
- Audit log.
- Analytics export.
- CSV download.
- Exception message.
- Support ticket.

Security harus melihat data lineage, bukan hanya primary table.

---

## 14. Design Framework: Dari Requirement ke Primitive

Gunakan proses berikut sebelum implementasi crypto.

### Step 1 — Define Asset

Contoh:

```text
Asset: case decision record.
```

### Step 2 — Define Security Properties

Contoh:

```text
Need:
- Integrity: decision tidak boleh berubah tanpa terdeteksi.
- Authenticity: harus tahu officer/system mana yang membuat decision.
- Freshness: approval lama tidak boleh di-replay sebagai approval baru.
- Confidentiality: reason mungkin mengandung PII, perlu field-level encryption.
```

### Step 3 — Define Attacker Capability

Contoh:

```text
Assume attacker may read database backup.
Assume attacker may modify application database row through SQL injection.
Assume attacker cannot access signing key stored in KMS/HSM.
```

### Step 4 — Define Trust Boundary

Contoh:

```text
Application DB is not trusted for integrity of final decision.
KMS signing key boundary is trusted.
Audit anchor storage is separate trust boundary.
```

### Step 5 — Choose Primitive/Mechanism

Contoh:

```text
- Field-level encryption for sensitive reason text.
- Digital signature over canonical decision envelope.
- Hash chain for audit event sequence.
- Nonce/sequence/version included in signed payload.
```

### Step 6 — Define Key Lifecycle

Contoh:

```text
- signing-key.case-decision.v1 in KMS/HSM.
- encryption-key.case-reason.v1 envelope encryption.
- rotation every N months or on compromise.
- old keys verify/decrypt only.
```

### Step 7 — Define Failure Behavior

Contoh:

```text
- If signature verification fails: reject and alert.
- If key unavailable: fail closed for decision finalization.
- If decrypt fails: return controlled error, no partial update.
```

### Step 8 — Define Test Cases

Contoh:

```text
- Tampered field rejected.
- Missing field rejected.
- Reordered JSON still verifies if canonicalized.
- Changed tenantId rejected.
- Replayed sequence rejected.
- Old key still verifies old record.
- Retired key cannot sign new record.
```

---

## 15. Case Study 1: Securing a Webhook Callback

### 15.1 Scenario

Partner system sends payment status callback:

```json
{
  "transactionId": "T-100",
  "status": "PAID",
  "amount": 1500000,
  "currency": "IDR",
  "timestamp": "2026-06-16T10:00:00Z"
}
```

### 15.2 Threats

- Attacker sends fake callback.
- Attacker modifies amount/status.
- Attacker replays old valid callback.
- Attacker changes endpoint path but reuses signature.
- Attacker exploits JSON formatting ambiguity.

### 15.3 Bad Design

```text
X-Signature = SHA256(body)
```

Why bad:

- No secret.
- Anyone can compute hash.

### 15.4 Better Design with HMAC

Canonical request:

```text
METHOD + "\n" +
PATH + "\n" +
QUERY_CANONICAL + "\n" +
TIMESTAMP + "\n" +
NONCE + "\n" +
SHA256(BODY)
```

Signature:

```text
HMAC-SHA256(partnerSecret, canonicalRequest)
```

Server checks:

1. Partner identity known.
2. Timestamp within allowed window.
3. Nonce not seen before.
4. HMAC valid using constant-time comparison.
5. Body schema valid.
6. Transaction state transition valid.
7. Idempotency respected.

### 15.5 Security Invariants

```text
A callback can update transaction state only if:
- it is authenticated as a known partner,
- its body is untampered,
- it is fresh,
- it targets the expected endpoint/context,
- it is valid under business state transition rules.
```

Crypto solves only part of this. State machine correctness still matters.

---

## 16. Case Study 2: Protecting Case Evidence Files

### 16.1 Scenario

A regulatory system stores uploaded evidence files. Files may be used months later in enforcement proceedings.

Need:

- Confidentiality.
- Integrity.
- Chain of custody.
- Auditability.
- Retention.

### 16.2 Naive Design

```text
Store file in object storage.
Rely on HTTPS upload/download.
Store filename and path in database.
```

Weakness:

- Object may be replaced by privileged operator or compromised process.
- DB metadata may be changed.
- No independent proof of original content.
- No canonical evidence manifest.

### 16.3 Better Design

On upload:

1. Validate file type and size.
2. Stream file to object storage.
3. Compute SHA-256 while streaming.
4. Create evidence manifest:

```json
{
  "schemaVersion": 1,
  "caseId": "C-100",
  "evidenceId": "E-900",
  "objectKey": "cases/C-100/evidence/E-900.bin",
  "sha256": "...",
  "size": 981233,
  "uploadedBy": "U-01",
  "uploadedAt": "2026-06-16T10:00:00Z",
  "contentTypeDeclared": "application/pdf",
  "contentTypeDetected": "application/pdf"
}
```

5. Canonicalize manifest.
6. Sign manifest or append it to tamper-evident audit chain.
7. Store signature separately or in protected metadata.

On download/review:

1. Fetch object.
2. Recompute hash.
3. Verify against signed manifest.
4. Verify manifest signature.
5. Log access.

### 16.4 Security Invariant

```text
A file may be used as evidence only if its current bytes match the signed manifest
created at intake time.
```

---

## 17. Case Study 3: Encrypting PII in Database

### 17.1 Scenario

A Java service stores citizen identity data.

Requirement:

```text
If database snapshot leaks, sensitive fields should remain unreadable.
```

### 17.2 Threat Model

Protect against:

- DB snapshot leak.
- Read-only DB credential compromise.
- Backup exposure.

Not fully protect against:

- Application runtime compromise.
- KMS admin misuse.
- User with legitimate access exporting data.

### 17.3 Design

Use field-level AEAD encryption:

- AES-GCM or equivalent approved AEAD.
- Unique nonce per encryption under same key.
- AAD binds context:

```text
tableName | columnName | tenantId | recordId | schemaVersion
```

Encrypted envelope:

```json
{
  "version": 1,
  "alg": "AES-256-GCM",
  "keyId": "pii-field-2026-01",
  "nonce": "...",
  "ciphertext": "...",
  "tag": "..."
}
```

### 17.4 Why AAD Matters

Without AAD, attacker with DB write access may move ciphertext from one row/field to another.

AAD makes ciphertext valid only for the expected context.

### 17.5 Operational Issues

- Search/indexing becomes harder.
- Sorting becomes harder.
- Partial match becomes harder.
- Data migration requires decrypt/re-encrypt process.
- Key rotation needs staged plan.
- Logs must not print decrypted values.

---

## 18. Case Study 4: Signed Audit Events

### 18.1 Scenario

System logs important lifecycle event:

```json
{
  "eventType": "CASE_DECISION_FINALIZED",
  "caseId": "C-100",
  "decision": "SUSPENDED",
  "actor": "officer-01",
  "timestamp": "2026-06-16T10:00:00Z"
}
```

Need:

- Later verifier can detect tampering.
- Event order cannot be silently rewritten.
- Actor/action context preserved.

### 18.2 Pattern

Use hash chain:

```json
{
  "sequence": 1021,
  "event": {...},
  "previousHash": "abc...",
  "eventHash": "def...",
  "signature": "sig..."
}
```

`eventHash` computed over:

```text
canonical(event) + previousHash + sequence + streamId
```

Signature over the envelope.

### 18.3 Invariant

```text
If any event is changed, removed, inserted, or reordered, the chain verification fails.
```

### 18.4 Limitations

Hash chain does not prevent deletion of entire suffix unless anchored externally.

Possible anchors:

- Periodic signed checkpoint.
- Separate append-only storage.
- External timestamping.
- Independent audit system.

---

## 19. Threat-to-Control Matrix

| Threat | Crypto Control | Non-Crypto Control | Notes |
|---|---|---|---|
| Passive network sniffing | TLS | Network segmentation | TLS must validate certificates. |
| Active MITM | TLS + cert validation/mTLS | Pinning in special cases | Trust-all destroys protection. |
| Payload tampering across queue | Message signature/MAC | Schema validation, state validation | TLS only protects hop, not stored message. |
| Replay callback | Signature/MAC + timestamp/nonce | Replay cache, idempotency | Signature alone not enough. |
| DB snapshot leak | Field encryption | Access control, backup policy | Key must not be in DB. |
| DB row modification | MAC/signature/AAD | Audit, least privilege | Encryption alone not enough. |
| Password database leak | Password hashing | MFA, breach monitoring | Never reversible encryption. |
| Token forgery | JWS/signature/MAC | Issuer/audience/scope checks | Signature valid ≠ authorized. |
| Evidence file replacement | Hash/sign manifest | Object lock, audit trail | Hash must be protected. |
| Malicious dependency | Artifact signing maybe | SCA, SBOM, sandbox, egress control | Crypto only partial. |
| Key compromise | Key rotation/wrapping | Incident response, access policy | Need blast-radius plan. |

---

## 20. Java Engineer Review Checklist

Saat melihat crypto-related code, tanyakan:

### 20.1 Requirement

```text
[ ] Security property disebut eksplisit?
[ ] Threat model jelas?
[ ] Attacker capability jelas?
[ ] Trust boundary jelas?
[ ] Data lifecycle jelas?
```

### 20.2 Primitive

```text
[ ] Primitive sesuai property?
[ ] Algorithm/mode modern dan allowed?
[ ] Tidak memakai deprecated/weak primitive?
[ ] Tidak custom crypto?
[ ] Tidak mengandalkan Base64/obfuscation?
```

### 20.3 Key

```text
[ ] Key dibuat dari secure source?
[ ] Key tidak hardcoded?
[ ] Key tidak ada di log/config/source?
[ ] Key punya purpose/version?
[ ] Key rotation strategy ada?
[ ] Key compromise strategy ada?
```

### 20.4 Randomness

```text
[ ] Menggunakan SecureRandom untuk security values?
[ ] Nonce/IV requirement dipenuhi?
[ ] Tidak reuse nonce/IV dengan key sama?
[ ] Token entropy cukup?
```

### 20.5 Composition

```text
[ ] Encryption authenticated?
[ ] MAC/signature mencakup semua field penting?
[ ] Payload canonicalized?
[ ] Context bound via AAD/signature?
[ ] Replay protection ada jika diperlukan?
```

### 20.6 Verification

```text
[ ] Verification fail closed?
[ ] Constant-time compare untuk secret-derived values?
[ ] Algorithm allowlist digunakan?
[ ] Issuer/audience/purpose dicek?
[ ] Error message tidak leak sensitive detail?
```

### 20.7 Operation

```text
[ ] Logging aman?
[ ] Metrics/tracing tidak leak secret/PII?
[ ] Heap dump/thread dump policy jelas?
[ ] KMS/HSM outage behavior jelas?
[ ] Monitoring verification failure ada?
```

---

## 21. Common Decision Table

| Situation | Prefer | Avoid |
|---|---|---|
| Password storage | Argon2id/bcrypt/scrypt/PBKDF2 | SHA-256(password), AES(password) |
| API request authenticity between two backend systems | HMAC with canonical request | Plain SHA-256 body |
| Publicly verifiable document authenticity | Digital signature | Shared secret MAC |
| Sensitive field in DB | AEAD field encryption + AAD | AES/ECB, encryption without integrity |
| File tamper detection | Signed manifest/hash chain | Unprotected checksum in same DB |
| Token format | JWS/JWE with strict verification | Trusting claims before verification |
| Data in transit | TLS with validation | Trust-all TLS |
| Multiple crypto purposes | Separate keys/KDF/context | One global secret |
| Replay-sensitive callback | MAC/signature + timestamp/nonce | Signature only |
| Long-term audit | Hash chain + signature + external anchor | Mutable log table only |

---

## 22. How to Think Like a Top-Level Engineer

A top-level engineer does not ask only:

```text
How do I encrypt this string in Java?
```

They ask:

```text
Why does this string need encryption?
Who can read it now?
Who must not read it?
Where else will plaintext flow?
Who owns the key?
How is key access audited?
What happens when key rotates?
What happens when decrypt fails?
Does encryption also need integrity?
Could ciphertext be moved to another context?
Could old ciphertext be replayed?
How do we test all of this?
```

The real maturity jump is from API usage to **security invariant design**.

---

## 23. Practical Exercise

Ambil satu feature Java enterprise, misalnya:

```text
Officer uploads evidence file and finalizes enforcement decision.
```

Jawab:

1. Asset apa saja?
2. Data mana yang confidential?
3. Data mana yang integrity-critical?
4. Siapa attacker realistis?
5. Apa trust boundary?
6. Apa yang harus ditandatangani?
7. Apa yang harus dienkripsi?
8. Apa yang harus dicegah dari replay?
9. Apa key yang dibutuhkan?
10. Bagaimana key rotation?
11. Apa failure mode paling berbahaya?
12. Test negatif apa yang wajib ada?

Contoh jawaban ringkas:

```text
Evidence bytes tidak harus selalu encrypted per-file jika storage encryption cukup untuk risk model,
tetapi evidence manifest harus integrity-protected karena chain of custody bergantung pada hash,
metadata, uploader, timestamp, dan case binding.

Decision record harus ditandatangani atau masuk tamper-evident audit chain karena DB write attacker
tidak boleh bisa mengubah final decision tanpa detection.

Replay harus dicegah pada finalization command karena command lama tidak boleh menciptakan state
transition baru setelah case berubah.
```

---

## 24. Summary

Part ini membangun fondasi mental model cryptography:

1. Encoding bukan encryption.
2. Hash bukan MAC.
3. MAC bukan signature.
4. Signature bukan authorization.
5. Encryption bukan integrity kecuali authenticated encryption.
6. TLS melindungi channel, bukan seluruh lifecycle data.
7. Crypto tanpa key management adalah ilusi.
8. Crypto tanpa freshness bisa kalah oleh replay.
9. Crypto tanpa canonicalization bisa rapuh atau salah semantics.
10. Crypto tanpa threat model sering salah primitive.
11. Crypto tanpa operational plan sering gagal di production.

Kalimat penutup:

```text
Cryptography yang benar selalu dimulai dari security property dan threat model,
bukan dari API dan algorithm name.
```

---

## 25. Referensi Utama

1. Oracle Java Cryptography Architecture Reference Guide  
   https://docs.oracle.com/en/java/javase/26/security/java-cryptography-architecture-jca-reference-guide.html

2. Oracle Java Security Standard Algorithm Names  
   https://docs.oracle.com/en/java/javase/26/docs/specs/security/standard-names.html

3. OWASP Cryptographic Storage Cheat Sheet  
   https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html

4. OWASP Password Storage Cheat Sheet  
   https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html

5. OWASP Key Management Cheat Sheet  
   https://cheatsheetseries.owasp.org/cheatsheets/Key_Management_Cheat_Sheet.html

6. OWASP Top 10 2021 — A02 Cryptographic Failures  
   https://owasp.org/Top10/A02_2021-Cryptographic_Failures/

7. NIST SP 800-57 Part 1 Revision 5 — Recommendation for Key Management  
   https://csrc.nist.gov/pubs/sp/800/57/pt1/r5/final

8. NIST FIPS 197 — Advanced Encryption Standard  
   https://csrc.nist.gov/pubs/fips/197/final

---

## 26. Status Seri

Seri belum selesai.

Progress:

```text
[x] Part 0 — Security Mental Model for Senior Java Engineers
[x] Part 1 — Java Security Architecture: JCA, JCE, JAAS, JSSE, JGSS, SASL, CertPath
[x] Part 2 — Threat Modeling for Java Systems
[x] Part 3 — Cryptography Mental Model: What Crypto Can and Cannot Guarantee
[ ] Part 4 — Randomness, Entropy, Nonce, Salt, IV, Token
...
[ ] Part 34 — Capstone: Designing a Secure Java Regulatory Case Management Platform
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 2 — Threat Modeling for Java Systems](./learn-java-security-cryptography-integrity-part-002.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 4 — Randomness, Entropy, Nonce, Salt, IV, Token](./learn-java-security-cryptography-integrity-part-004.md)
