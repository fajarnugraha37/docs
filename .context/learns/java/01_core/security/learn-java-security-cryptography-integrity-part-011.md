# learn-java-security-cryptography-integrity-part-011

# Part 11 — Key Management: Lifecycle, Rotation, Wrapping, KMS, HSM

> Seri: `learn-java-security-cryptography-integrity`  
> Bagian: `011 / 034`  
> Status seri: **belum selesai**  
> Fokus: memahami key sebagai asset security, bukan sekadar parameter API crypto.

---

## 0. Tujuan Part Ini

Pada part sebelumnya kita sudah membahas primitive kriptografi: hash, password hashing, symmetric encryption, MAC, digital signature, asymmetric encryption, dan key agreement. Namun di sistem nyata, security paling sering gagal bukan karena AES, HMAC, RSA, ECDSA, atau TLS-nya “rusak”, melainkan karena **key management**-nya lemah.

Contoh kegagalan nyata:

- key disimpan di source code;
- key disimpan di config repo;
- key muncul di log, heap dump, thread dump, crash report, atau tracing span;
- key yang sama dipakai untuk encryption dan MAC;
- key tidak punya identifier sehingga payload lama tidak bisa didekripsi setelah rotasi;
- key rotation dianggap “ganti env var”, padahal data lama masih butuh dibaca;
- private signing key bocor, tetapi tidak ada plan revoke, re-sign, atau invalidate token;
- semua data dienkripsi dengan satu key global sehingga satu compromise menghancurkan seluruh sistem;
- KMS dipakai, tetapi plaintext data key disimpan sembarangan di memory/cache;
- developer salah paham bahwa “pakai AWS KMS” otomatis membuat desain aman.

Tujuan part ini adalah membangun mental model bahwa **cryptographic key adalah asset utama**, dan cryptographic primitive hanyalah mesin yang menggunakan asset tersebut.

Setelah menyelesaikan part ini, kamu diharapkan mampu:

1. membedakan data key, key-encryption-key, master key, wrapping key, signing key, verification key, TLS private key, token signing key, API HMAC key, password-derived key, dan session key;
2. mendesain key lifecycle dari generation sampai destruction;
3. membuat payload encrypted/signed yang mendukung rotasi key;
4. memahami envelope encryption dan key wrapping;
5. menentukan kapan cukup pakai Java KeyStore, kapan butuh cloud KMS, kapan butuh HSM;
6. menganalisis blast radius jika satu key bocor;
7. membuat runbook compromise response;
8. melakukan design review key management untuk Java enterprise system.

---

## 1. Core Thesis: Crypto Security Is Mostly Key Security

Kalimat yang perlu diingat:

> Algorithm yang kuat + key management yang buruk = sistem buruk.

AES-GCM, HMAC-SHA-256, RSA-PSS, Ed25519, atau ECDH bisa sangat kuat secara matematis. Tetapi kalau key-nya:

- mudah ditebak,
- pernah bocor,
- dipakai ulang di konteks yang salah,
- tidak bisa diputar,
- tidak tahu siapa pemiliknya,
- tidak punya expiry,
- tidak bisa dicabut,
- atau disimpan di tempat yang semua engineer bisa baca,

maka cryptographic guarantee runtuh.

Security engineer senior tidak bertanya hanya:

> “Algorithm apa yang dipakai?”

Mereka bertanya:

> “Key ini dibuat di mana, oleh siapa, dengan entropy apa, disimpan di mana, bisa dipakai untuk operasi apa, siapa yang boleh menggunakan, bagaimana dirotasi, bagaimana dicabut, bagaimana diaudit, bagaimana dihancurkan, dan apa dampaknya kalau bocor?”

Itulah inti key management.

---

## 2. Key Management Vocabulary

Sebelum desain, kita perlu vocabulary yang presisi.

### 2.1 Cryptographic Key

Cryptographic key adalah secret atau private value yang mengontrol operasi cryptographic.

Contoh:

- AES key untuk encryption/decryption;
- HMAC key untuk message authentication;
- RSA private key untuk signature atau decryption;
- ECDSA/EdDSA private key untuk signature;
- ECDH private key untuk key agreement;
- TLS private key;
- JWT signing private key;
- webhook signing secret;
- key-encryption-key untuk membungkus data key.

Key bukan “string config”. Key adalah **authority**.

Kalau key bisa dipakai untuk decrypt data, maka siapa pun yang punya key punya authority membaca data tersebut. Kalau key bisa dipakai untuk sign token, maka siapa pun yang punya key punya authority membuat token yang tampak valid.

---

### 2.2 Keying Material

Keying material adalah semua material yang berhubungan dengan key, termasuk:

- raw key bytes;
- private key;
- public key;
- wrapped/encrypted key;
- seed;
- nonce/IV tertentu bila perlu diproteksi;
- salt;
- password-derived key material;
- key metadata;
- certificate yang mengikat public key ke identity;
- key handle di KMS/HSM.

Tidak semua keying material harus dirahasiakan. Public key dan certificate memang boleh public. Tetapi integrity-nya tetap penting. Public key palsu bisa menyebabkan trust hijack.

---

### 2.3 Data Encryption Key / DEK

Data Encryption Key adalah key yang langsung dipakai untuk mengenkripsi data.

Contoh:

```text
AES-256-GCM key yang mengenkripsi file evidence.pdf
AES-256-GCM key yang mengenkripsi kolom national_id
AES-256-GCM key yang mengenkripsi object di S3
```

DEK biasanya banyak dan scoped kecil.

Desain yang baik:

```text
1 object/file/record/group kecil → 1 DEK atau key derivation context spesifik
```

Desain yang berisiko:

```text
1 global AES key → semua data semua tenant semua tahun
```

Kenapa? Karena blast radius. Jika satu DEK bocor, hanya subset kecil data terdampak.

---

### 2.4 Key Encryption Key / KEK

Key Encryption Key adalah key yang dipakai untuk mengenkripsi/membungkus key lain.

Contoh:

```text
KMS key / HSM key / master wrapping key
  ↓ wraps
DEK per file
  ↓ encrypts
actual file content
```

KEK biasanya lebih sedikit, lebih protected, dan jarang digunakan langsung untuk data besar.

---

### 2.5 Master Key

Istilah “master key” sering ambigu. Dalam sistem cloud/KMS, ia biasanya berarti root-level key yang mengontrol banyak data keys.

Namun hati-hati: “master key” bukan berarti boleh dipakai untuk semua operasi. Justru master key harus sangat terbatas.

Better naming:

- `customer-master-key` / `kms-key` untuk KMS;
- `tenant-kek` untuk tenant-level wrapping key;
- `root-signing-key` untuk certificate hierarchy;
- `token-signing-key` untuk JWT/JWS;
- `audit-log-signing-key` untuk audit trail.

Nama key harus menjelaskan usage boundary.

---

### 2.6 Wrapping Key

Wrapping key adalah KEK yang digunakan khusus untuk key wrapping.

Key wrapping berbeda dari “encrypt arbitrary data”. Tujuannya:

- melindungi key saat disimpan;
- melindungi key saat dipindahkan;
- mempertahankan metadata dan integrity key;
- membatasi plaintext key exposure.

Dalam Java, wrapping bisa dilakukan dengan `Cipher.WRAP_MODE` / `Cipher.UNWRAP_MODE` bila provider dan algorithm mendukung.

---

### 2.7 Signing Key

Signing key adalah private key atau symmetric key yang dipakai untuk menghasilkan bukti authenticity/integrity.

Contoh:

- JWT private signing key;
- document signing key;
- audit log signing key;
- release artifact signing key;
- webhook HMAC secret;
- SAML assertion signing key.

Signing key biasanya lebih sensitif daripada verification key. Kalau signing key bocor, attacker bisa membuat data palsu yang terlihat valid.

---

### 2.8 Verification Key

Verification key adalah key yang dipakai untuk memverifikasi signature atau MAC.

Untuk asymmetric signature:

```text
private key → sign
public key  → verify
```

Public verification key tidak harus secret, tapi integrity dan provenance-nya harus dijaga. Public key yang salah sama berbahayanya dengan trust anchor palsu.

Untuk symmetric MAC:

```text
same secret key → generate MAC and verify MAC
```

Karena key yang sama bisa membuat MAC, verifier juga bisa menjadi signer. Ini penting untuk trust boundary.

---

### 2.9 Session Key

Session key adalah key sementara yang berlaku untuk satu session/connection/context.

Contoh:

- TLS traffic secrets;
- ECDH-derived shared secret;
- temporary encryption key untuk transfer session;
- per-request derived key.

Session key idealnya ephemeral, scoped kecil, dan cepat hilang.

---

### 2.10 Key Identifier / `kid`

Key identifier adalah metadata untuk memilih key yang benar.

Contoh:

```json
{
  "version": 1,
  "alg": "AES-256-GCM",
  "kid": "tenant-a-data-2026-06",
  "nonce": "...",
  "ciphertext": "...",
  "tag": "..."
}
```

Tanpa `kid`, rotation sulit. Sistem tidak tahu key mana yang dipakai untuk decrypt/verify payload lama.

Namun `kid` juga bisa menjadi attack surface jika dipakai sembarangan, terutama di JWT/JWS/JWKS. Jangan pernah membiarkan `kid` menjadi path arbitrary file, SQL fragment, URL arbitrary, atau selector ke key tidak terpercaya.

---

## 3. Key Lifecycle: Dari Lahir Sampai Mati

Key lifecycle minimal:

```text
1. Policy/design
2. Generation
3. Registration/metadata
4. Distribution/provisioning
5. Storage/protection
6. Activation
7. Usage
8. Rotation/renewal
9. Suspension/deactivation
10. Revocation/compromise handling
11. Archival, if needed
12. Destruction/zeroization
```

Kita bahas satu per satu.

---

## 4. Step 1 — Policy and Design Before Generation

Sebelum membuat key, jawab pertanyaan berikut:

```text
Key ini untuk apa?
Data/operation apa yang dilindungi?
Siapa owner-nya?
Siapa boleh memakai?
Berapa lama aktif?
Bagaimana rotasi?
Bagaimana revoke?
Apa blast radius kalau bocor?
Apakah key perlu exportable?
Apakah perlu HSM/KMS?
Apakah perlu audit setiap penggunaan?
```

Key tanpa policy akan menjadi “secret liar”. Sistem mungkin berjalan, tapi security-nya tidak bisa dikelola.

### 4.1 Key Usage Harus Eksplisit

Jangan membuat key generik seperti:

```text
APP_SECRET
MASTER_SECRET
ENCRYPTION_KEY
JWT_SECRET
```

Lebih baik:

```text
case-file-content-aes-gcm-dek
case-file-kek-prod-ap-southeast-1
audit-log-ed25519-signing-prod-2026-q2
webhook-hmac-partner-x-prod-v3
jwt-access-token-rs256-prod-2026-06
```

Nama key yang baik menjawab:

- domain;
- operation;
- algorithm class;
- environment;
- validity period/version.

---

## 5. Step 2 — Secure Key Generation

Key harus dihasilkan dari CSPRNG atau dedicated key generation mechanism.

### 5.1 Java API: `KeyGenerator`

Untuk symmetric key:

```java
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import java.security.SecureRandom;

public final class AesKeyFactory {
    private AesKeyFactory() {}

    public static SecretKey generateAes256Key() throws Exception {
        KeyGenerator generator = KeyGenerator.getInstance("AES");
        generator.init(256, SecureRandom.getInstanceStrong());
        return generator.generateKey();
    }
}
```

Catatan:

- Gunakan `KeyGenerator`, bukan membuat random byte array sembarangan kecuali benar-benar paham.
- Pastikan key size sesuai policy.
- `SecureRandom.getInstanceStrong()` bisa punya karakteristik blocking/latency tergantung platform. Untuk service high-throughput, design initialization dengan hati-hati. Jangan memanggil strong RNG per request tanpa profiling.

### 5.2 Java API: `KeyPairGenerator`

Untuk asymmetric key:

```java
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.SecureRandom;
import java.security.spec.NamedParameterSpec;

public final class Ed25519KeyFactory {
    private Ed25519KeyFactory() {}

    public static KeyPair generateEd25519() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("Ed25519");
        // Ed25519 usually does not need explicit key size.
        generator.initialize(NamedParameterSpec.ED25519, SecureRandom.getInstanceStrong());
        return generator.generateKeyPair();
    }
}
```

Untuk RSA:

```java
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.SecureRandom;

public final class RsaKeyFactory {
    private RsaKeyFactory() {}

    public static KeyPair generateRsa3072() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(3072, SecureRandom.getInstanceStrong());
        return generator.generateKeyPair();
    }
}
```

RSA 2048 masih umum, tetapi untuk long-lived high-value signing, policy organisasi sering memilih 3072/4096 atau elliptic-curve/EdDSA sesuai compliance dan interoperability.

---

## 6. Step 3 — Key Registration and Metadata

Begitu key dibuat, sistem harus punya metadata.

Minimal metadata:

```text
key_id
algorithm
key_size / curve
usage
owner
environment
created_at
activated_at
expires_at
status
rotation_group
protection_level
exportable / non_exportable
description
```

Status key:

```text
PRE_ACTIVE     dibuat tapi belum boleh dipakai untuk write/sign
ACTIVE         boleh dipakai untuk write/sign/encrypt
VERIFY_ONLY    tidak boleh write/sign/encrypt baru, masih boleh verify/decrypt lama
RETIRED        tidak dipakai normal, hanya emergency/historical recovery
REVOKED        tidak boleh dipercaya karena compromise/superseded
DESTROYED      key material sudah dihancurkan
```

### 6.1 Kenapa Status Penting?

Rotasi aman membutuhkan dua dimensi:

```text
write/encrypt/sign key     → key untuk menghasilkan payload baru
read/decrypt/verify keys   → key untuk membaca payload lama
```

Kalau hanya ada satu env var `ENCRYPTION_KEY`, rotasi akan menjadi breaking change.

Desain yang benar:

```text
active_encrypt_kid = key-2026-06
allowed_decrypt_kids = [key-2026-06, key-2026-03, key-2025-12]
```

Untuk signature:

```text
active_signing_kid = jwt-rs256-2026-06
allowed_verify_kids = [jwt-rs256-2026-06, jwt-rs256-2026-05]
```

---

## 7. Step 4 — Distribution and Provisioning

Key distribution adalah proses membawa key dari tempat pembuatannya ke tempat pemakaiannya.

Ini salah satu fase paling berbahaya.

### 7.1 Hindari Distribution Jika Bisa

Golden rule:

> Jika key bisa tetap non-exportable di KMS/HSM, jangan distribusikan raw key ke aplikasi.

Contoh:

- Aplikasi memanggil KMS untuk decrypt data key.
- Private signing key tetap di HSM/KMS; aplikasi hanya mengirim payload untuk ditandatangani.
- TLS private key ada di managed load balancer/cert manager, bukan semua pod.

Namun tidak semua operasi bisa dilakukan remote. Kadang aplikasi perlu plaintext DEK untuk streaming encryption local. Dalam kasus ini exposure harus dibatasi.

---

### 7.2 Bad Key Distribution Pattern

```text
Developer membuat key lokal
→ copy ke Slack
→ paste ke application.yml
→ commit tidak sengaja
→ deploy ke semua environment
```

Ini bukan sekadar buruk. Ini unrecoverable tanpa rotation dan incident response.

---

### 7.3 Better Pattern

```text
KMS/HSM/Secret Manager membuat atau menyimpan key
→ aplikasi diberi identity/role
→ aplikasi request key operation atau secret retrieval saat runtime
→ access diaudit
→ policy membatasi environment dan operation
```

Untuk Kubernetes:

```text
Pod identity / workload identity
→ secret manager / KMS
→ short-lived retrieval
→ memory only
→ no static secret in image
```

Jika memakai Kubernetes Secret biasa, ingat: Kubernetes Secret bukan HSM. Ia hanya mekanisme distribusi secret. Protection sebenarnya tergantung encryption at rest, RBAC, admission policy, node security, log hygiene, dan process isolation.

---

## 8. Step 5 — Key Storage and Protection

### 8.1 Storage Levels

Urutan protection dari rendah ke tinggi:

```text
plaintext file/env var
password-protected file keystore
OS secret store
cloud secret manager
cloud KMS non-exportable key
dedicated HSM
multi-party controlled HSM/root ceremony
```

Tidak semua sistem butuh level tertinggi, tapi sistem harus sadar level yang dipilih.

---

### 8.2 Java KeyStore

Java `KeyStore` bisa menyimpan:

- private key + certificate chain;
- trusted certificates;
- secret keys, tergantung keystore type/provider.

Contoh loading PKCS12:

```java
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;

public final class KeyStoreLoader {
    private KeyStoreLoader() {}

    public static KeyStore loadPkcs12(Path path, char[] password) throws Exception {
        KeyStore keyStore = KeyStore.getInstance("PKCS12");
        try (InputStream input = Files.newInputStream(path)) {
            keyStore.load(input, password);
        }
        return keyStore;
    }
}
```

Mengambil private key:

```java
import java.security.Key;
import java.security.KeyStore;
import java.security.PrivateKey;

public final class PrivateKeyReader {
    private PrivateKeyReader() {}

    public static PrivateKey readPrivateKey(
            KeyStore keyStore,
            String alias,
            char[] keyPassword
    ) throws Exception {
        Key key = keyStore.getKey(alias, keyPassword);
        if (!(key instanceof PrivateKey privateKey)) {
            throw new IllegalStateException("Alias is not a private key entry: " + alias);
        }
        return privateKey;
    }
}
```

Catatan penting:

- Keystore file tetap file. Kalau attacker dapat file dan password, key bocor.
- Password keystore juga secret. Jangan hardcode.
- Keystore cocok untuk banyak aplikasi, tetapi bukan jawaban otomatis untuk high-value key custody.
- PKCS12 lebih portable daripada JKS legacy.

---

### 8.3 KeyStore Anti-Patterns

Anti-pattern umum:

```text
keystore.p12 commit ke Git
keystore password ada di README
password sama di semua environment
alias tidak jelas
private key exportable tanpa kontrol
keystore di-container-image
keystore dibuat manual tanpa inventory
expired certificate tidak dimonitor
```

Untuk production:

- simpan keystore di secret manager atau volume secure;
- jangan bake ke Docker image;
- gunakan per-environment key;
- monitor expiry;
- audit akses;
- punya rotation runbook.

---

## 9. Step 6 — Activation and Usage

Key yang sudah dibuat belum tentu langsung aktif.

### 9.1 Activation Window

Gunakan konsep:

```text
not_before
not_after
status
```

Contoh:

```json
{
  "kid": "audit-signing-prod-2026-q3",
  "status": "PRE_ACTIVE",
  "not_before": "2026-07-01T00:00:00Z",
  "not_after": "2026-10-01T00:00:00Z",
  "usage": ["SIGN_AUDIT_RECORD"]
}
```

Kenapa penting?

- rollout key bisa disiapkan sebelum aktif;
- verifier bisa mengenal public key sebelum signer memakainya;
- rotasi bisa dilakukan tanpa downtime.

---

### 9.2 Usage Boundary

Setiap key harus punya allowed usage.

Contoh allowed usage:

```text
ENCRYPT_DATA
DECRYPT_DATA
WRAP_KEY
UNWRAP_KEY
SIGN_TOKEN
VERIFY_TOKEN
SIGN_AUDIT_RECORD
VERIFY_AUDIT_RECORD
TLS_SERVER_AUTH
TLS_CLIENT_AUTH
```

Key yang sama tidak boleh dipakai lintas purpose tanpa desain key separation.

Bad:

```text
APP_SECRET dipakai untuk:
- JWT signing
- password reset token HMAC
- webhook signing
- AES encryption
- CSRF token
```

Good:

```text
jwt-signing-key-v3
password-reset-hmac-key-v2
webhook-partner-x-hmac-key-v4
pii-aes-gcm-dek-group-2026-06
csrf-token-hmac-key-v1
```

---

## 10. Key Separation

Key separation adalah prinsip bahwa key untuk satu purpose tidak boleh dipakai untuk purpose lain.

### 10.1 Kenapa Key Separation Penting?

Karena setiap primitive punya security model berbeda.

Misalnya key yang sama dipakai untuk AES encryption dan HMAC. Kalau ada bug di satu konteks, bug itu bisa membuka peluang attack di konteks lain. Key compromise juga menjadi lebih luas.

Key separation mengurangi blast radius dan mencegah cross-protocol attack.

---

### 10.2 Cara Menerapkan Key Separation

Ada dua pendekatan:

1. generate independent keys;
2. derive subkeys dari root key dengan KDF dan context.

Contoh konseptual:

```text
root key
  ├── derive("encryption", tenantId, version) → encryption key
  ├── derive("mac", tenantId, version)        → mac key
  └── derive("token", issuer, version)        → token key
```

Di Java, derivation bisa memakai HKDF jika tersedia lewat provider/library, atau PBKDF2 untuk password-derived keys. Jangan membuat KDF custom dengan `SHA-256(root + purpose)` sembarangan.

---

## 11. Envelope Encryption

Envelope encryption adalah pattern paling penting dalam key management modern.

### 11.1 Problem

Mengenkripsi data besar langsung dengan KMS/HSM biasanya tidak efisien dan sering tidak didesain untuk high-throughput bulk encryption.

Selain itu, satu global key untuk semua data menciptakan blast radius besar.

### 11.2 Pattern

```text
1. Generate random DEK.
2. Encrypt data locally with DEK using AEAD, e.g. AES-GCM.
3. Encrypt/wrap DEK with KEK/KMS key.
4. Store ciphertext data + encrypted DEK + metadata.
5. For decrypt: unwrap DEK via KMS/HSM, decrypt data locally.
```

Payload:

```json
{
  "version": 1,
  "alg": "AES-256-GCM",
  "dek_alg": "AES",
  "kek_kid": "kms:case-file-prod-2026",
  "encrypted_dek": "base64...",
  "nonce": "base64...",
  "aad": {
    "tenant_id": "cea",
    "case_id": "CASE-2026-001"
  },
  "ciphertext": "base64...",
  "tag": "base64..."
}
```

### 11.3 Why It Works

- Data encryption cepat dilakukan lokal.
- DEK bisa unique per object/file.
- KEK bisa disimpan di KMS/HSM.
- Rotation KEK bisa dilakukan dengan rewrap encrypted DEK, tanpa re-encrypt semua data.
- Blast radius plaintext DEK kecil.

---

## 12. Key Wrapping

Key wrapping adalah proses mengenkripsi key dengan key lain.

### 12.1 Java Example: Wrap SecretKey

Contoh sederhana dengan RSA-OAEP sebagai wrapping key. Dalam production, biasanya lebih baik memakai KMS/HSM untuk wrapping.

```java
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.SecureRandom;

public final class RsaOaepKeyWrappingDemo {
    private RsaOaepKeyWrappingDemo() {}

    public static void main(String[] args) throws Exception {
        KeyPairGenerator rsa = KeyPairGenerator.getInstance("RSA");
        rsa.initialize(3072, SecureRandom.getInstanceStrong());
        KeyPair wrappingKeyPair = rsa.generateKeyPair();

        KeyGenerator aes = KeyGenerator.getInstance("AES");
        aes.init(256, SecureRandom.getInstanceStrong());
        SecretKey dataKey = aes.generateKey();

        Cipher wrapper = Cipher.getInstance("RSA/ECB/OAEPWithSHA-256AndMGF1Padding");
        wrapper.init(Cipher.WRAP_MODE, wrappingKeyPair.getPublic());
        byte[] wrappedDataKey = wrapper.wrap(dataKey);

        Cipher unwrapper = Cipher.getInstance("RSA/ECB/OAEPWithSHA-256AndMGF1Padding");
        unwrapper.init(Cipher.UNWRAP_MODE, wrappingKeyPair.getPrivate());
        SecretKey unwrapped = (SecretKey) unwrapper.unwrap(wrappedDataKey, "AES", Cipher.SECRET_KEY);

        System.out.println(unwrapped.getAlgorithm());
    }
}
```

Catatan:

- `RSA/ECB/...` pada nama transformation JCE untuk RSA bukan ECB block mode seperti AES-ECB. Namun naming ini membingungkan dan sering jadi sumber salah paham.
- Pastikan OAEP parameter kompatibel antar provider/system.
- Untuk bulk object, jangan wrap banyak data besar dengan RSA. Wrap key, bukan data.

---

### 12.2 AES Key Wrap

Untuk symmetric wrapping, ada standard seperti AES Key Wrap. Support bergantung provider/algorithm names yang tersedia. Dalam enterprise, operasi ini sering diserahkan ke KMS/HSM.

---

## 13. Rotation: The Hard Part Everyone Underestimates

Rotation bukan hanya “membuat key baru”.

Rotation berarti:

```text
sistem dapat menghasilkan payload baru dengan key baru
sistem tetap bisa membaca payload lama dengan key lama
sistem tahu kapan key lama tidak boleh dipakai untuk write/sign
sistem tahu kapan key lama boleh dihapus
semua consumer sudah menerima metadata/public key/trust update
monitoring bisa membedakan error rotasi dari attack
```

---

### 13.1 Rotation Types

#### 13.1.1 Scheduled Rotation

Rotasi berkala:

```text
setiap 90 hari / 180 hari / 1 tahun
```

Cocok untuk:

- HMAC webhook key;
- token signing key;
- service-to-service symmetric secret;
- KEK/KMS key sesuai policy;
- certificate/private key.

#### 13.1.2 On-Demand Rotation

Rotasi karena kebutuhan:

- suspected compromise;
- staff/vendor offboarding;
- algorithm migration;
- environment breach;
- partner integration change;
- compliance event.

#### 13.1.3 Emergency Rotation

Rotasi cepat karena confirmed compromise.

Ini butuh runbook. Jangan baru mendesain saat incident.

---

### 13.2 Rotation Strategies

#### Strategy A — New Writes, Old Reads

Pattern paling umum.

```text
T0: key-v1 active
T1: deploy key-v2 as active write key
T2: keep key-v1 for decrypt/verify only
T3: wait until all old payload/token expired or migrated
T4: retire/destroy key-v1
```

Cocok untuk:

- JWT signing key;
- HMAC request signing;
- encrypted records;
- signed audit entries.

#### Strategy B — Re-encrypt Data

```text
read ciphertext with old key
→ decrypt
→ encrypt with new key
→ write back
```

Kelebihan:

- setelah selesai, old key bisa dihancurkan.

Kekurangan:

- mahal;
- risk data corruption;
- perlu idempotent migration;
- perlu resume capability;
- perlu audit.

#### Strategy C — Rewrap Only

Untuk envelope encryption:

```text
old KEK unwraps encrypted DEK
new KEK wraps same DEK
ciphertext data tidak berubah
```

Kelebihan:

- jauh lebih murah dari re-encrypt data;
- cocok untuk KEK rotation.

Kekurangan:

- DEK yang sama tetap melindungi data;
- jika DEK compromise, rewrap tidak cukup.

#### Strategy D — Dual Sign / Dual Verify

Untuk ecosystem dengan banyak consumer:

```text
periode transisi:
- signer bisa publish public key baru
- verifier menerima old + new key
- optional dual signature untuk high assurance migration
```

---

### 13.3 Rotation Payload Design

Payload harus membawa metadata cukup:

```json
{
  "v": 1,
  "kid": "pii-aes-gcm-2026-06",
  "alg": "AES-256-GCM",
  "nonce": "...",
  "aad_ref": "case-id+tenant-id+schema-v3",
  "ct": "..."
}
```

Tanpa `kid`, rotation menjadi tebak-tebakan.

Tanpa `alg/version`, migration menjadi sulit.

Tanpa AAD/canonicalization, context substitution attack bisa terjadi.

---

## 14. Revocation and Compromise Response

Rotasi normal berbeda dari compromise response.

### 14.1 Kalau Encryption Key Bocor

Pertanyaan pertama:

```text
Key apa yang bocor?
Data apa yang bisa didekripsi?
Apakah attacker punya ciphertext?
Apakah attacker punya access ke DB/object storage?
Apakah ada AAD/context yang membatasi misuse?
Sejak kapan bocor?
Apakah key masih aktif?
Apakah key digunakan lintas environment?
```

Tindakan:

1. stop penggunaan key untuk new encryption;
2. revoke/deactivate key jika memungkinkan;
3. rotate ke key baru;
4. re-encrypt data terdampak jika perlu;
5. audit access log;
6. assess data exposure;
7. notify sesuai policy/regulation;
8. remove key dari semua lokasi bocor;
9. review root cause.

### 14.2 Kalau Signing Key Bocor

Ini sering lebih berbahaya.

Jika JWT signing key bocor, attacker bisa membuat token valid.

Tindakan:

```text
1. revoke signing key immediately
2. publish new verification key
3. invalidate active tokens signed by compromised kid
4. force re-authentication if needed
5. inspect logs for forged token usage
6. rotate dependent keys if same secret reused
7. shorten token lifetime if too long
```

Untuk asymmetric signing, public key tetap public, tapi verification trust harus menolak `kid` compromised.

### 14.3 Kalau HMAC Key Bocor

HMAC key bocor berarti attacker bisa membuat pesan palsu dan memverifikasi pesan.

Tindakan:

- rotate shared secret;
- koordinasi dengan partner;
- gunakan overlap window kecil;
- reject replay lama;
- audit timestamps/nonces;
- jika tidak ada replay store, asumsikan replay mungkin terjadi.

---

## 15. Destruction and Zeroization

Destroying key bukan sekadar delete row.

### 15.1 Physical/Logical Destruction

Untuk KMS/HSM:

- schedule key deletion;
- disable key;
- destroy imported key material;
- follow provider retention/delay policy.

Untuk file:

- delete tidak selalu cukup karena backup, snapshot, journaling filesystem.
- destruction harus mencakup backup lifecycle.

Untuk memory:

- Java sulit menjamin zeroization karena GC, copies, immutable `String`, heap dump, JIT optimization.

---

### 15.2 Java Memory Reality

Hindari menyimpan secret di `String` jika bisa, karena `String` immutable dan sulit dihapus.

Prefer `char[]` untuk password input, tapi sadar bahwa ini bukan silver bullet.

```java
import java.util.Arrays;

public final class SecretHandling {
    private SecretHandling() {}

    public static void clear(char[] secret) {
        if (secret != null) {
            Arrays.fill(secret, '\0');
        }
    }

    public static void clear(byte[] secret) {
        if (secret != null) {
            Arrays.fill(secret, (byte) 0);
        }
    }
}
```

Limitasi:

- object bisa sudah dicopy oleh library;
- JIT/GC bisa membuat behavior tidak sekuat low-level zeroization;
- heap dump tetap risiko;
- secret bisa muncul di exception/log.

Jadi zeroization di Java adalah defense-in-depth, bukan guarantee absolut.

---

## 16. KMS: Key Management Service

KMS adalah managed service untuk create/control/use cryptographic keys.

Contoh:

- AWS KMS;
- Google Cloud KMS;
- Azure Key Vault Managed HSM/Keys;
- HashiCorp Vault transit engine;
- on-prem KMS.

### 16.1 Apa yang KMS Berikan?

Biasanya:

- key generation;
- non-exportable key storage;
- encrypt/decrypt small payload or data key;
- sign/verify;
- key rotation;
- access control;
- audit logging;
- HSM-backed protection;
- policy enforcement.

### 16.2 Apa yang KMS Tidak Otomatis Berikan?

KMS tidak otomatis menyelesaikan:

- payload format;
- AAD/context design;
- application-level authorization;
- plaintext data key caching;
- replay protection;
- misuse of decrypted data;
- bad IAM policy;
- leaking plaintext after decrypt;
- database/object storage access control;
- regulatory data minimization.

KMS melindungi key, bukan seluruh application design.

---

## 17. Envelope Encryption with KMS: Conceptual Flow

```text
Encrypt:
  app → KMS GenerateDataKey(kek_id, encryption_context)
  KMS → plaintext_dek + encrypted_dek
  app → AES-GCM encrypt data with plaintext_dek and AAD
  app → clear plaintext_dek from memory as best effort
  store → encrypted_dek + nonce + ciphertext + metadata

Decrypt:
  app → load encrypted_dek + metadata
  app → KMS Decrypt(encrypted_dek, encryption_context)
  KMS → plaintext_dek if authorized and context matches
  app → AES-GCM decrypt with AAD
  app → clear plaintext_dek as best effort
```

### 17.1 Encryption Context / AAD

KMS encryption context dan AEAD AAD harus diperlakukan sebagai integrity-bound context.

Contoh:

```text
tenant_id = CEA
case_id = CASE-2026-001
record_type = EVIDENCE_FILE
schema_version = 3
```

Jika ciphertext untuk case A bisa dipindah ke case B dan tetap valid, integrity boundary lemah.

---

## 18. HSM: Hardware Security Module

HSM adalah hardware khusus untuk melindungi key dan melakukan operasi cryptographic di boundary yang lebih keras.

### 18.1 Kapan Butuh HSM?

Pertimbangkan HSM jika:

- private key bernilai sangat tinggi;
- ada regulatory requirement;
- butuh non-exportable key dengan tamper-resistant hardware;
- butuh signing legal/audit evidence;
- root CA/private key custody;
- payment/financial cryptography;
- high-assurance token signing;
- multi-party key ceremony.

### 18.2 HSM Trade-Off

Kelebihan:

- key non-exportable;
- audit kuat;
- access control ketat;
- tamper resistance;
- compliance alignment.

Kekurangan:

- latency;
- throughput limit;
- operational complexity;
- cost;
- vendor-specific behavior;
- failover design;
- integration complexity dengan Java provider/PKCS#11.

---

## 19. Java + HSM / PKCS#11 Mental Model

Java bisa berintegrasi dengan HSM melalui provider, sering menggunakan PKCS#11.

Mental model:

```text
Java crypto API
  ↓
JCA/JCE Provider
  ↓
PKCS#11 bridge/provider
  ↓
HSM/token
```

Aplikasi mungkin memanggil `Signature.getInstance(...)`, tetapi key operation dilakukan oleh provider/HSM.

### 19.1 Design Considerations

- Key alias harus stabil.
- Provider initialization harus aman.
- Slot/token configuration harus environment-specific.
- HSM outage harus punya fallback policy, bukan fallback ke plaintext key diam-diam.
- Performance test wajib.
- Audit event harus dikorelasikan dengan application request ID.

---

## 20. Access Control for Keys

Key harus punya access policy.

### 20.1 Principle of Least Privilege

Aplikasi yang hanya perlu decrypt tidak boleh bisa schedule key deletion.

Worker yang hanya perlu verify signature tidak perlu private signing key.

Service yang hanya perlu encrypt tidak selalu harus decrypt.

Contoh pemisahan:

```text
case-api-service:
  can Encrypt with case-data-kek
  can Decrypt only for authorized read path

case-ingestion-worker:
  can Encrypt evidence file
  cannot Decrypt evidence file after write

audit-verifier-service:
  can Verify audit signatures
  cannot Sign audit records

audit-writer-service:
  can Sign audit records
  cannot Delete signing key
```

### 20.2 Separate Admin and Usage Permissions

Ada dua kategori permission:

```text
key administration:
  create, rotate, disable, delete, update policy

key usage:
  encrypt, decrypt, sign, verify, generate data key
```

Jangan campur.

---

## 21. Environment Separation

Key harus dipisahkan antar environment.

Bad:

```text
same JWT signing key for dev, uat, prod
same AES key for test and prod
same partner webhook secret for staging and prod
```

Good:

```text
jwt-signing-dev-v1
jwt-signing-uat-v1
jwt-signing-prod-v1
```

Jika key dev bocor, prod tidak boleh terdampak.

---

## 22. Tenant and Domain Separation

Untuk sistem multi-tenant atau multi-agency, pertimbangkan separation:

```text
per tenant KEK
per data domain KEK
per sensitivity level KEK
per object DEK
```

Contoh regulatory case management:

```text
case-file-kek-prod-cea
case-file-kek-prod-cpds
case-audit-signing-prod-cea
case-pii-kek-prod-cea
case-public-document-kek-prod-cea
```

Pertanyaan desain:

```text
Jika tenant A compromise, apakah tenant B aman?
Jika evidence file key bocor, apakah PII database ikut bocor?
Jika JWT signing key bocor, apakah audit signing key tetap aman?
```

---

## 23. Key Caching

KMS/HSM call punya latency dan cost. Aplikasi sering ingin cache key/data key.

### 23.1 Caching Trade-Off

Caching meningkatkan performance, tapi memperbesar exposure window.

Pertanyaan:

```text
Apa yang dicache? plaintext DEK, encrypted DEK, public key, KMS client, trust metadata?
Berapa TTL?
Apakah cache per tenant/per object?
Apakah cache bisa muncul di heap dump?
Apakah cache clear saat revoke?
Apakah revoke propagation cukup cepat?
```

### 23.2 Safer Cache Pattern

- Cache public verification keys lebih aman daripada private/secret keys.
- Cache encrypted DEK lebih aman daripada plaintext DEK.
- Cache plaintext DEK hanya jika benar-benar perlu, TTL pendek, scoped kecil.
- Cache harus bisa invalidated saat key status berubah.
- Jangan cache di distributed cache yang tidak didesain untuk secret.

---

## 24. Logging and Observability Without Leaking Keys

Forbidden in logs:

```text
raw key bytes
Base64 key
private key PEM
keystore password
KMS plaintext data key
HMAC secret
JWT signing secret
password-derived key
```

Safe-ish metadata:

```text
kid
key alias
key status
algorithm
operation type
environment
request id
failure reason category
```

Contoh log baik:

```text
INFO crypto.encrypt success kid=case-file-kek-prod-2026 op=ENCRYPT tenant=cea request_id=abc123
WARN crypto.decrypt denied kid=case-file-kek-prod-2026 reason=KEY_DISABLED request_id=abc124
```

Contoh log buruk:

```text
ERROR decrypt failed key=QkFTRTY0U0VDUkVU... ciphertext=...
```

---

## 25. Key Metadata Model for Java Applications

Contoh model metadata:

```java
import java.time.Instant;
import java.util.Set;

public record CryptoKeyMetadata(
        String keyId,
        String algorithm,
        String provider,
        Set<KeyUsage> usages,
        KeyStatus status,
        String owner,
        String environment,
        Instant createdAt,
        Instant activatedAt,
        Instant expiresAt,
        boolean exportable
) {}

enum KeyUsage {
    ENCRYPT,
    DECRYPT,
    WRAP_KEY,
    UNWRAP_KEY,
    SIGN,
    VERIFY,
    DERIVE
}

enum KeyStatus {
    PRE_ACTIVE,
    ACTIVE,
    VERIFY_ONLY,
    RETIRED,
    REVOKED,
    DESTROYED
}
```

Policy check:

```java
public final class KeyPolicy {
    private KeyPolicy() {}

    public static void requireUsage(
            CryptoKeyMetadata metadata,
            KeyUsage requestedUsage,
            Instant now
    ) {
        if (metadata.status() == KeyStatus.REVOKED || metadata.status() == KeyStatus.DESTROYED) {
            throw new SecurityException("Key is not usable: " + metadata.keyId());
        }

        if (!metadata.usages().contains(requestedUsage)) {
            throw new SecurityException("Key usage not allowed: " + requestedUsage);
        }

        if (metadata.activatedAt() != null && now.isBefore(metadata.activatedAt())) {
            throw new SecurityException("Key is not active yet: " + metadata.keyId());
        }

        if (metadata.expiresAt() != null && now.isAfter(metadata.expiresAt())) {
            throw new SecurityException("Key is expired: " + metadata.keyId());
        }
    }
}
```

Catatan:

- Jangan hanya mengandalkan metadata di aplikasi jika KMS/HSM bisa enforce policy.
- Aplikasi-level metadata tetap berguna untuk routing, payload versioning, observability, dan domain policy.

---

## 26. Versioned Encrypted Payload Design

Contoh envelope payload Java-friendly:

```java
import java.util.Map;

public record EncryptedEnvelope(
        int version,
        String algorithm,
        String keyId,
        String keyEncryptionKeyId,
        String encryptedDataKeyBase64,
        String nonceBase64,
        Map<String, String> aad,
        String ciphertextBase64
) {}
```

Invariant:

```text
version wajib ada
algorithm wajib allowlisted
kid wajib known dan trusted
aad wajib canonical
nonce wajib unique per DEK/key
ciphertext tidak boleh diproses sebelum tag valid
unknown version harus fail closed
unknown algorithm harus fail closed
revoked key harus fail closed
```

---

## 27. Algorithm Agility vs Algorithm Confusion

Algorithm agility berarti sistem bisa migrasi algorithm tanpa rewrite total.

Tetapi terlalu fleksibel bisa menjadi algorithm confusion.

Bad:

```java
Cipher.getInstance(payload.alg())
```

Jika attacker bisa mengontrol `alg`, sistem rentan downgrade/confusion.

Good:

```java
switch (payload.algorithm()) {
    case "AES-256-GCM-V1" -> decryptAesGcmV1(payload);
    default -> throw new SecurityException("Unsupported algorithm");
}
```

Algorithm agility harus allowlisted, versioned, dan policy-controlled.

---

## 28. Key Rotation Example: JWT Signing Key

### 28.1 Normal Rotation

```text
T-7 days:
  generate new signing key pair
  publish new public key in JWKS as inactive/available
  ensure verifiers refresh JWKS

T0:
  signer starts using new kid
  verifiers accept old + new kid

T0 + token_max_lifetime:
  old tokens expire naturally
  old key moved to retired/verify-only

T0 + safety_window:
  old key removed from JWKS or marked revoked
```

### 28.2 Failure Modes

- JWKS cache terlalu lama.
- `kid` collision.
- verifier fetches JWKS from untrusted URL.
- signer uses new key before verifier knows it.
- old key removed before old token expired.
- compromised key tidak bisa di-block per `kid`.

---

## 29. Key Rotation Example: Encrypted Database Field

### 29.1 Payload-Level Rotation

Record:

```json
{
  "person_id": "P-001",
  "national_id_enc": {
    "v": 1,
    "kid": "pii-field-key-2026-06",
    "nonce": "...",
    "ct": "..."
  }
}
```

Rotation:

```text
1. create pii-field-key-2026-09
2. make it active for new writes
3. keep pii-field-key-2026-06 for reads
4. background migration re-encrypts old rows gradually
5. metrics track remaining rows per kid
6. after zero remaining + backup expiry, retire old key
```

### 29.2 Metrics

Track:

```text
records_by_kid
decrypt_failures_by_kid
encrypt_operations_by_active_kid
migration_lag
old_key_remaining_records
```

Without metrics, rotation is guesswork.

---

## 30. Key Rotation Example: Envelope Encryption KEK

Data object stores:

```text
ciphertext encrypted with DEK
encrypted_dek wrapped by KEK v1
```

KEK rotation:

```text
1. unwrap encrypted_dek with KEK v1
2. wrap same DEK with KEK v2
3. update metadata: kek_kid = v2
4. ciphertext remains unchanged
```

This is cheaper than re-encrypting data.

But if DEK itself might be compromised, rewrap is insufficient. You must generate new DEK and re-encrypt data.

---

## 31. Key Compromise Blast Radius Model

For every key, define blast radius.

Template:

```text
Key ID:
Usage:
Owner:
Environment:
Data protected:
Operations enabled:
Who can use:
Where plaintext can appear:
Rotation strategy:
If compromised, attacker can:
If compromised, attacker cannot:
Detection signals:
Emergency action:
Residual risk:
```

Example:

```text
Key ID: audit-signing-prod-2026-q2
Usage: sign audit record hash chain checkpoints
If compromised, attacker can: forge future-looking audit checkpoints if system accepts key
If compromised, attacker cannot: modify old records without breaking existing timestamped checkpoints, if old checkpoints are externally anchored
Emergency action: revoke kid, publish new verification policy, freeze audit ingestion, run forensic verification
```

---

## 32. Key Management for Regulatory Case Management Platform

Bayangkan sistem enforcement lifecycle/case management.

Assets:

- case record;
- evidence files;
- audit trail;
- correspondence;
- officer decision notes;
- external submission documents;
- token/session;
- service-to-service events;
- report exports.

Key domains:

```text
1. evidence-file-content encryption
2. PII field encryption
3. audit trail signing/hash-chain checkpoint
4. JWT/session token signing
5. webhook/API request signing
6. service-to-service mTLS private key
7. release artifact signing
8. database backup encryption
```

Bad design:

```text
one APP_SECRET for all security operations
```

Better design:

```text
case-evidence-kek-prod-tenant-cea
case-pii-kek-prod-tenant-cea
case-audit-signing-prod-2026-q2
case-token-signing-prod-2026-06
case-partner-rom-hmac-prod-v4
case-mtls-service-a-prod-cert-2026
release-signing-prod-2026
backup-kek-prod-db-2026
```

Reasoning:

- Evidence file breach should not imply token forgery.
- Token signing breach should not imply audit record forgery.
- Partner HMAC breach should not decrypt PII.
- Backup key compromise has different blast radius from application field key.

---

## 33. Key Management Architecture Patterns

### 33.1 Central KMS + Envelope Encryption

```text
Application
  ├── requests data key from KMS
  ├── encrypts data locally
  └── stores encrypted data key with ciphertext
```

Use when:

- many objects/files;
- need scalable encryption;
- need KMS audit;
- need per-object DEK.

### 33.2 HSM-Backed Signing Service

```text
Application → Signing Service → HSM/KMS Sign
```

Use when:

- signing key high value;
- multiple apps need signing;
- need centralized audit;
- want to avoid private key in each service.

### 33.3 Verification Key Distribution via JWKS/Metadata Endpoint

```text
Signer publishes public keys
Verifiers cache allowed public keys
kid selects verification key
```

Use when:

- JWT/JWS/OIDC-style tokens;
- multiple consumers;
- planned key rotation.

### 33.4 Per-Tenant Key Hierarchy

```text
root/platform KEK
  ↓
tenant KEK
  ↓
object/record DEK
```

Use when:

- tenant isolation matters;
- regulatory boundary matters;
- tenant-specific deletion/export required.

### 33.5 Key Broker / Crypto Service

```text
business services do not directly handle crypto keys
crypto service enforces policy and performs operations
```

Use when:

- many teams;
- high compliance;
- need uniform audit;
- need prevent crypto misuse.

Trade-off: creates critical dependency and performance bottleneck if poorly designed.

---

## 34. Common Key Management Anti-Patterns

### 34.1 One Secret to Rule Them All

```text
APP_SECRET used for everything
```

Impact:

- no separation;
- huge blast radius;
- impossible targeted rotation.

---

### 34.2 No Key Identifier

Encrypted data stores only ciphertext.

Impact:

- cannot rotate cleanly;
- cannot audit algorithm/key usage;
- decrypt code tries all keys;
- incident response slow.

---

### 34.3 Key Rotation That Breaks Old Data

Replace env var and redeploy.

Impact:

- old data undecryptable;
- emergency rollback restores old key;
- team stops rotating keys forever.

---

### 34.4 Key in Source Code

Impact:

- history compromise;
- forks/clones/backups leak;
- scanners may detect too late;
- hard to prove non-exposure.

---

### 34.5 Key in Logs

Often happens with debug:

```java
log.debug("key={}, payload={}", key, payload);
```

Impact:

- centralized log system becomes secret store;
- many people/tools access logs;
- retention extends compromise.

---

### 34.6 No Decrypt Authorization

Because service can decrypt, every endpoint path can accidentally decrypt.

Fix:

- separate decrypt capability;
- enforce business authorization before decrypt;
- audit decrypt operation;
- decrypt as late as possible;
- minimize plaintext lifetime.

---

### 34.7 Public Key Without Provenance

Application downloads public key from URL supplied by attacker.

Impact:

- attacker signs with own private key;
- app verifies with attacker public key;
- authentication bypass.

---

### 34.8 KMS Policy Too Broad

```text
principal: *
action: kms:Decrypt
resource: *
```

Impact:

- KMS exists but provides little security boundary.

---

### 34.9 Backup Forgotten

Old key destroyed, but old backup still encrypted with it.

Or key compromised, but backups still contain plaintext copy/config.

Key lifecycle must include backup lifecycle.

---

## 35. Design Review Checklist

Use this checklist for every key.

### 35.1 Identity

```text
[ ] Does the key have a stable key id?
[ ] Is the key name meaningful?
[ ] Is owner/team known?
[ ] Is environment explicit?
[ ] Is algorithm/key size/curve known?
```

### 35.2 Purpose

```text
[ ] Is usage restricted?
[ ] Is key separation applied?
[ ] Is this key used for only one security purpose?
[ ] Are encrypt/decrypt/sign/verify/wrap permissions separated?
```

### 35.3 Generation

```text
[ ] Was the key generated by CSPRNG/KMS/HSM?
[ ] Is entropy sufficient?
[ ] Is key import controlled if externally generated?
[ ] Is key provenance documented?
```

### 35.4 Storage

```text
[ ] Where is the key stored?
[ ] Is it exportable?
[ ] Is it encrypted at rest?
[ ] Who can read/export/use it?
[ ] Is access audited?
[ ] Can it appear in logs/dumps/traces?
```

### 35.5 Runtime Usage

```text
[ ] Is plaintext key lifetime minimized?
[ ] Is caching necessary and bounded?
[ ] Is operation authorized before key use?
[ ] Is AAD/context bound to cryptographic operation?
[ ] Are errors safe and non-leaky?
```

### 35.6 Rotation

```text
[ ] Is active write/sign key separated from read/verify keys?
[ ] Does payload carry kid/version/algorithm?
[ ] Is old data readable during transition?
[ ] Is there a migration/rewrap plan?
[ ] Are metrics available per kid?
```

### 35.7 Revocation

```text
[ ] Can the key be disabled quickly?
[ ] Can consumers reject compromised kid?
[ ] Is there emergency rotation runbook?
[ ] Is blast radius documented?
[ ] Are alerts defined for unusual key usage?
```

### 35.8 Destruction

```text
[ ] When can key be destroyed?
[ ] Are backups considered?
[ ] Are old payloads migrated/expired?
[ ] Is destruction auditable?
```

---

## 36. Failure Mode Table

| Failure | Root Cause | Impact | Prevention |
|---|---|---|---|
| Old data cannot decrypt after rotation | No `kid`, single env key | Data loss/outage | Versioned payload + read key ring |
| Attacker forges JWT | Signing key leaked | Auth bypass | KMS/HSM, short token TTL, kid revoke |
| Cross-tenant data exposure | Shared global DEK | Massive blast radius | Tenant KEK + object DEK |
| Replay accepted | HMAC without nonce/timestamp | Duplicate/fake actions | Freshness + replay cache |
| Key appears in logs | Debug or exception leakage | Secret compromise | redaction + safe logging policy |
| KMS used but too broad IAM | Poor access policy | Any service can decrypt | least privilege + encryption context |
| Public key substitution | Untrusted JWKS/source | Signature bypass | pinned issuer/trust anchor/allowlist |
| Rewrap used after DEK leak | Wrong incident response | Data remains decryptable | re-encrypt with new DEK |
| Destroyed key too early | Backup/old data ignored | Permanent data loss | retention-aware destruction |
| Key reused for many purposes | No key separation | Cross-protocol/blast radius | usage-specific keys/KDF context |

---

## 37. Production Metrics and Alerts

Track:

```text
kms_decrypt_count_by_key
kms_encrypt_count_by_key
kms_sign_count_by_key
kms_access_denied_count
crypto_decrypt_failure_by_kid
crypto_verify_failure_by_kid
unknown_kid_count
retired_key_usage_count
revoked_key_usage_attempt_count
old_key_remaining_payload_count
key_expiry_days_remaining
jwks_refresh_failure_count
hsm_latency_p95_p99
hsm_error_rate
```

Alerts:

```text
revoked key used
unknown kid spike
decrypt failures spike
signing operation from unexpected service
KMS/HSM access denied spike
key expires within threshold
old key still used after migration window
```

---

## 38. Mini Case Study: Evidence File Encryption

### 38.1 Requirement

A regulatory case management system stores uploaded evidence files.

Requirements:

- evidence file content confidential;
- file cannot be moved between case IDs undetected;
- per-tenant isolation;
- rotation without re-encrypting all files when only KEK changes;
- audit every decrypt;
- deletion policy must support retention rules.

### 38.2 Design

```text
Tenant KEK in KMS:
  case-evidence-kek-prod-tenant-cea

For each file:
  generate DEK
  encrypt file stream with AES-256-GCM
  AAD = tenant_id + case_id + file_id + schema_version
  wrap DEK with tenant KEK using KMS
  store encrypted_dek + kek_kid + nonce + ciphertext + metadata
```

### 38.3 Read Flow

```text
1. Authorize user for case/file access.
2. Load file metadata.
3. Check key status.
4. Call KMS decrypt for encrypted DEK with encryption context.
5. Decrypt file stream with AES-GCM and same AAD.
6. Audit decrypt event with user/case/file/reason.
7. Clear plaintext DEK as best effort.
```

### 38.4 Invariants

```text
File encrypted under tenant-specific KEK.
AAD binds ciphertext to tenant/case/file.
Decrypt requires both business authorization and KMS permission.
Payload contains key metadata for rotation.
Old KEK can decrypt only while status allows.
Every decrypt creates audit event.
```

### 38.5 Failure Review

| Scenario | Expected Behavior |
|---|---|
| File ciphertext copied to another case | AEAD tag verification fails because AAD differs |
| Old KEK rotated | encrypted DEK rewrapped, ciphertext unchanged |
| DEK suspected compromised | re-encrypt file with new DEK, not just rewrap |
| KMS unavailable | decrypt fails closed; no plaintext fallback |
| User unauthorized | no KMS decrypt call should happen |

---

## 39. Exercises

### Exercise 1 — Key Inventory

Ambil satu sistem Java yang kamu punya. Buat inventory:

```text
secret/key name
purpose
algorithm
location
owner
environment
rotation policy
blast radius
```

Kemungkinan besar kamu akan menemukan banyak secret yang tidak jelas purpose-nya.

---

### Exercise 2 — Redesign `APP_SECRET`

Jika sistem punya satu `APP_SECRET`, pecah menjadi:

```text
jwt signing key
password reset HMAC key
csrf token key
field encryption key
webhook signing key
```

Tentukan mana yang symmetric, mana asymmetric, mana butuh KMS/HSM, mana cukup secret manager.

---

### Exercise 3 — Rotation Simulation

Desain rotasi untuk encrypted database field.

Wajib mencakup:

```text
payload format
kid
active key
read key ring
migration job
metrics
rollback
old key retirement
```

---

### Exercise 4 — Compromise Runbook

Buat runbook untuk:

```text
JWT signing key leaked
HMAC webhook key leaked
AES DEK leaked
KMS admin permission abused
TLS private key leaked
```

Untuk masing-masing, tulis:

```text
immediate action
blast radius
customer/user impact
recovery
long-term prevention
```

---

## 40. Practical Rules of Thumb

1. Jangan pernah hardcode key.
2. Jangan pakai satu key untuk banyak purpose.
3. Jangan mengenkripsi data besar langsung dengan asymmetric key.
4. Gunakan envelope encryption untuk object/file/field high-value.
5. Payload encrypted/signed harus versioned dan membawa `kid`.
6. Pisahkan active write/sign key dari read/verify key set.
7. KMS/HSM melindungi key, bukan otomatis membetulkan desain aplikasi.
8. Rotation harus diuji sebelum incident.
9. Compromised signing key biasanya emergency lebih besar daripada expired key.
10. Public key tidak secret, tapi trust provenance-nya wajib dijaga.
11. Jangan cache plaintext key kecuali perlu, dan TTL harus pendek.
12. Observability harus mencatat metadata key, bukan material key.
13. Key destruction harus mempertimbangkan backup, old payload, dan retention.
14. Unknown algorithm/key/version harus fail closed.
15. Setiap key harus punya owner, usage, status, expiry, dan runbook.

---

## 41. Senior Engineer Mental Model

Engineer biasa berpikir:

```text
Saya butuh encrypt data → pakai AES key.
```

Engineer senior berpikir:

```text
Data apa?
Threat apa?
Boundary apa?
Key dibuat di mana?
Key disimpan di mana?
Siapa bisa decrypt?
Apakah decrypt harus diaudit?
Apakah key per tenant/per object?
Bagaimana rotasi?
Apa payload membawa kid?
Apa yang terjadi jika key bocor?
Apa yang terjadi jika KMS down?
Apakah old backup masih butuh key lama?
Bagaimana membuktikan integrity desain ini saat audit?
```

Itulah perbedaan antara memakai crypto dan melakukan cryptographic engineering.

---

## 42. Summary

Key management adalah pusat dari security kriptografi.

Part ini membangun beberapa prinsip utama:

- key adalah authority, bukan config;
- key harus punya lifecycle;
- key usage harus dibatasi;
- key separation mengurangi blast radius;
- envelope encryption adalah pattern utama untuk data besar/object/field;
- rotation harus didesain sejak payload format pertama;
- compromise response berbeda dari scheduled rotation;
- KMS/HSM membantu custody dan audit, tapi tidak menggantikan desain aplikasi;
- Java KeyStore berguna, tetapi bukan magic vault;
- observability harus melihat key metadata tanpa membocorkan key material;
- setiap key perlu owner, status, usage, expiry, audit, dan runbook.

Jika Part 3–10 menjawab “primitive apa yang tersedia?”, Part 11 menjawab:

> “Bagaimana primitive itu tetap aman selama bertahun-tahun di sistem production yang punya data lama, rotasi, incident, audit, compliance, banyak service, dan banyak manusia?”

---

## 43. Referensi

Referensi yang relevan untuk pendalaman:

1. NIST SP 800-57 Part 1 Rev. 5 — Recommendation for Key Management: Part 1, General.
2. OWASP Key Management Cheat Sheet.
3. OWASP Secrets Management Cheat Sheet.
4. OWASP Cryptographic Storage Cheat Sheet.
5. Oracle Java Cryptography Architecture Reference Guide.
6. Oracle Java Security Standard Algorithm Names.
7. Oracle `KeyStore`, `KeyGenerator`, `KeyPairGenerator`, `SecretKeyFactory`, `Cipher`, `Signature`, `Mac` API docs.
8. AWS KMS Developer Guide — envelope encryption, data keys, rotation, and KMS key concepts.
9. PKCS#11 and HSM vendor documentation for Java provider integration.

---

## 44. Status Seri

Seri **belum selesai**.

Progress saat ini:

```text
[x] Part 0  — Security Mental Model for Senior Java Engineers
[x] Part 1  — Java Security Architecture: JCA, JCE, JAAS, JSSE, JGSS, SASL, CertPath
[x] Part 2  — Threat Modeling for Java Systems
[x] Part 3  — Cryptography Mental Model: What Crypto Can and Cannot Guarantee
[x] Part 4  — Randomness, Entropy, Nonce, Salt, IV, Token
[x] Part 5  — Hashing, Digest, Fingerprint, Checksum, and Integrity Boundaries
[x] Part 6  — Password Storage, Password Verification, and Secret-Derived Keys
[x] Part 7  — Symmetric Encryption in Java: AES, Modes, Padding, AEAD
[x] Part 8  — Message Authentication Code: HMAC, CMAC, and Integrity Tokens
[x] Part 9  — Digital Signature: RSA, ECDSA, EdDSA, Signing Semantics
[x] Part 10 — Asymmetric Encryption and Key Agreement
[x] Part 11 — Key Management: Lifecycle, Rotation, Wrapping, KMS, HSM
[ ] Part 12 — Java KeyStore, TrustStore, Certificates, and Private Key Custody
...
[ ] Part 34 — Capstone: Designing a Secure Java Regulatory Case Management Platform
```

Total rencana: **35 part** (`Part 0` sampai `Part 34`).

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-security-cryptography-integrity-part-010.md">⬅️ Part 10 — Asymmetric Encryption and Key Agreement</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-security-cryptography-integrity-part-012.md">Java KeyStore, TrustStore, Certificates, and Private Key Custody ➡️</a>
</div>
