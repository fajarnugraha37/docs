# learn-java-security-cryptography-integrity-part-006

# Part 6 — Password Storage, Password Verification, and Secret-Derived Keys

> Seri: `learn-java-security-cryptography-integrity`  
> Status: Part 6 dari 35  
> Topik utama: password hashing, verifier design, KDF, salt, pepper, work factor, migration, Unicode, timing safety, operational security

---

## 0. Executive Summary

Password adalah salah satu bentuk secret paling berbahaya dalam sistem karena:

1. Dibuat oleh manusia, sehingga sering lemah, reuse, predictable, dan dipengaruhi kebiasaan.
2. Harus diverifikasi oleh server, sehingga server perlu menyimpan bentuk turunan dari password.
3. Jika database credential bocor, attacker dapat melakukan **offline guessing attack** tanpa berinteraksi lagi dengan sistem.
4. Jika disimpan salah, satu breach dapat berubah menjadi kompromi massal lintas sistem karena password reuse.

Prinsip paling penting:

> Password tidak disimpan. Password juga tidak dienkripsi untuk nanti didekripsi. Password diverifikasi menggunakan password hashing/KDF yang lambat, salted, parameterized, dan dapat dimigrasikan.

Dalam desain yang benar, sistem tidak pernah perlu tahu password asli setelah user mengirimkannya saat login/registration/change password. Yang disimpan adalah **password verifier**: hasil dari algorithm password hashing dengan salt, parameter cost, versi algorithm, dan metadata yang cukup untuk verifikasi dan migrasi.

Security property yang ingin dicapai bukan “password must be impossible to crack”. Itu tidak realistis. Property yang benar:

> Jika database credential bocor, biaya per tebakan attacker harus cukup mahal sehingga cracking massal menjadi tidak ekonomis, terutama untuk password yang tidak trivially weak.

Bagian ini membangun mental model tersebut secara mendalam.

---

## 1. Posisi Part Ini dalam Seri

Part sebelumnya membahas:

- Part 0: security mental model.
- Part 1: Java security architecture.
- Part 2: threat modeling.
- Part 3: cryptographic guarantee.
- Part 4: randomness, salt, nonce, IV, token.
- Part 5: hash, digest, fingerprint, checksum, integrity boundary.

Part ini menggunakan semua fondasi itu untuk satu domain yang sangat sering salah: **password storage dan password verification**.

Yang sengaja tidak dibahas mendalam di sini:

- Full OAuth2/OIDC flow: akan dibahas pada Part 20.
- Authorization model: Part 21.
- Token signing/JWT: Part 19.
- Secrets management infra-wide: Part 24.
- Incident response credential leak: Part 32.

Namun bagian ini tetap akan menyentuh aspek tersebut saat relevan untuk password verifier.

---

## 2. Core Problem: Password Verification Setelah Database Bocor

Banyak engineer junior berpikir problem password storage adalah:

> “Bagaimana agar orang lain tidak bisa membaca password di database?”

Itu kurang tepat.

Masalah sebenarnya:

> “Jika attacker mendapatkan seluruh tabel credential, termasuk hash, salt, metadata algorithm, dan mungkin source code, seberapa mahal bagi attacker untuk menebak password user satu per satu?”

Ini perubahan mental model besar.

Security design password harus mengasumsikan:

1. Attacker bisa mendapatkan database dump.
2. Attacker tahu algorithm yang dipakai.
3. Attacker tahu format hash.
4. Attacker tahu salt setiap user.
5. Attacker bisa menjalankan cracking di GPU/ASIC/cloud.
6. Attacker akan mencoba password umum, leaked password, mutation, bahasa lokal, nama, tanggal lahir, keyboard pattern, dan credential stuffing.
7. Attacker tidak perlu melewati rate limit login karena attack dilakukan offline.

Jadi pertahanan utama bukan secrecy algorithm, melainkan **cost amplification**.

---

## 3. Password Storage Invariant

Untuk sistem Java production, invariant minimalnya:

```text
INVARIANT PWD-001:
Plaintext password must never be stored, logged, cached, returned, indexed, persisted,
serialized, emitted to telemetry, included in exception, or retained longer than required.
```

```text
INVARIANT PWD-002:
Stored credential verifier must be resistant to offline guessing by using a modern,
salted, slow password hashing scheme with configurable cost parameters.
```

```text
INVARIANT PWD-003:
The verifier record must include enough metadata to verify old hashes and migrate them
without forcing global password reset.
```

```text
INVARIANT PWD-004:
Password verification must not leak meaningful difference between “user not found”,
“wrong password”, “disabled user”, “expired password”, or “wrong MFA” to untrusted clients.
```

```text
INVARIANT PWD-005:
No password-derived key may be reused across incompatible purposes without domain separation.
```

Jika salah satu invariant ini dilanggar, sistem bisa tetap “jalan”, tetapi security property-nya rusak.

---

## 4. Password Must Not Be Encrypted

Kesalahan klasik:

```text
password -> AES encrypt -> store ciphertext
```

Lalu saat login:

```text
stored ciphertext -> decrypt -> compare plaintext
```

Ini buruk karena jika attacker mendapatkan database dan encryption key, semua password bisa dipulihkan. Dalam banyak breach nyata, secret key sering berada di application config, environment variable, CI/CD variable, Kubernetes Secret, image layer, log, backup, atau memory dump yang bisa ikut bocor.

Password verification tidak membutuhkan password asli. Maka sistem tidak boleh mendesain dirinya agar bisa membaca kembali password asli.

Desain benar:

```text
registration:
  password + random salt + cost parameters -> password hashing algorithm -> verifier
  store verifier metadata

login:
  submitted password + stored salt + stored cost parameters -> recomputed verifier
  constant-time compare recomputed verifier with stored verifier
```

Perbedaan mendasarnya:

| Approach | Bisa recover password asli? | Cocok untuk password? | Risiko utama |
|---|---:|---:|---|
| Plaintext | Ya | Tidak | Total compromise saat DB bocor |
| Reversible encryption | Ya, jika key bocor | Tidak | Key compromise membuka semua password |
| Fast hash SHA-256 | Tidak langsung | Tidak | Offline guessing sangat cepat |
| Salted slow password hash | Tidak praktis untuk password kuat | Ya | Tetap lemah untuk password buruk |

---

## 5. Password Hashing Bukan Hash Biasa

Dari Part 5, kita tahu cryptographic hash seperti SHA-256 cepat dan deterministic. Untuk file integrity, speed bagus. Untuk password, speed justru buruk.

Kenapa?

Password user biasanya entropy-nya rendah. Attacker tidak mencoba seluruh ruang 256-bit. Mereka mencoba password umum dan variasi pintar:

```text
password
Password1
P@ssw0rd
jakarta2026
fajar123
companyname2026!
qwerty123
TanggalLahirNama
```

Jika hash function sangat cepat, attacker bisa mencoba sangat banyak kandidat per detik.

Maka password hashing membutuhkan property tambahan:

1. Salted: mencegah precomputed/rainbow table dan membuat hash user berbeda walau password sama.
2. Slow: membuat setiap tebakan mahal.
3. Memory-hard: membuat GPU/ASIC parallelism lebih mahal.
4. Parameterized: cost bisa dinaikkan saat hardware makin cepat.
5. Self-describing: format menyimpan algorithm/cost/salt agar bisa migrasi.

---

## 6. Threat Model Password Storage

### 6.1 Primary Threat: Offline Cracking

Attacker mencuri tabel:

```text
user_id | username | password_hash | salt | algorithm | cost | created_at
```

Lalu menjalankan:

```text
for candidate_password in wordlist:
  derived = password_hash(candidate_password, salt, cost)
  if derived == stored_hash:
      cracked
```

Dalam offline attack:

- rate limit login tidak berguna;
- account lockout tidak berguna;
- CAPTCHA tidak berguna;
- WAF tidak berguna;
- attacker bebas parallelize;
- attacker bebas memilih target bernilai tinggi;
- attacker bisa melanjutkan selama berbulan-bulan.

Password hashing yang benar menaikkan biaya per tebakan.

### 6.2 Secondary Threat: Credential Stuffing

Credential stuffing bukan cracking hash. Attacker memakai username/password dari breach lain untuk login ke sistem kita.

Kontrolnya berbeda:

- breached password screening;
- MFA;
- risk-based authentication;
- login throttling;
- device/session anomaly detection;
- alert user;
- password reuse education.

Password hashing tidak menyelesaikan credential stuffing, karena attacker sudah tahu password plaintext dari breach lain.

### 6.3 Secondary Threat: Online Guessing

Attacker mencoba login langsung.

Kontrolnya:

- rate limit per account, IP, subnet, ASN, device fingerprint;
- progressive delay;
- MFA;
- generic error message;
- monitoring;
- lockout yang hati-hati agar tidak menjadi DoS vector.

Password hashing membantu server-side storage, tetapi bukan kontrol utama online guessing.

### 6.4 Insider and Operational Leakage

Risiko:

- password masuk log request;
- password masuk APM span;
- password masuk exception;
- password masuk audit trail;
- password masuk heap dump;
- password masuk debug endpoint;
- password masuk test fixture;
- password masuk BI/reporting replica.

Kontrol:

- field-level redaction;
- DTO separation;
- logging allowlist, bukan denylist;
- secure diagnostics policy;
- memory lifetime reduction;
- no plaintext password in domain event.

---

## 7. Terminology: Salt, Pepper, Work Factor, KDF, Verifier

### 7.1 Password

Secret yang user ingat. Bisa berupa passphrase.

### 7.2 Password Hash / Verifier

Output dari password hashing algorithm yang disimpan untuk memverifikasi password berikutnya.

Lebih akurat disebut **verifier** daripada “hash”, karena isinya sering self-describing:

```text
$argon2id$v=19$m=65536,t=3,p=1$<salt>$<hash>
```

### 7.3 Salt

Random value unik per password record.

Tujuan salt:

1. Password sama menghasilkan verifier berbeda.
2. Precomputed rainbow table tidak praktis.
3. Attacker harus menyerang per-user, bukan satu hash untuk semua user.

Salt tidak perlu rahasia.

Salt harus:

- random;
- unik secara praktis;
- cukup panjang;
- disimpan bersama verifier;
- tidak reuse antar user/password update.

### 7.4 Pepper

Secret tambahan global atau scoped yang disimpan terpisah dari database credential, misalnya di KMS/HSM/secret manager.

Tujuannya:

> Jika database credential bocor tetapi pepper tidak bocor, attacker tidak bisa langsung melakukan offline verification.

Namun pepper punya trade-off:

- harus dikelola seperti key;
- rotasi sulit;
- kehilangan pepper dapat membuat semua password unverifiable;
- jika app server compromise, pepper bisa ikut bocor;
- implementasi salah bisa tidak menambah banyak security.

Pepper bukan pengganti password hashing.

### 7.5 Work Factor / Cost Parameter

Parameter yang mengontrol biaya hashing.

Contoh:

- Argon2id: memory, iterations, parallelism.
- bcrypt: cost/log rounds.
- scrypt: N, r, p.
- PBKDF2: iteration count dan PRF.

Cost harus bisa dinaikkan di masa depan.

### 7.6 KDF

Key Derivation Function. Fungsi yang mengambil secret/password/input keying material dan menghasilkan key material.

Tidak semua KDF cocok untuk password storage. HKDF bagus untuk key expansion dari key material yang sudah kuat, tetapi bukan password hashing untuk password manusia.

### 7.7 Secret-Derived Key

Key yang diturunkan dari password atau passphrase untuk encryption/signing/MAC.

Contoh:

```text
user passphrase -> KDF -> file encryption key
```

Ini berbeda dari password verifier untuk login. Password verifier hanya untuk verifikasi. Secret-derived key dipakai untuk cryptographic operation.

---

## 8. Algorithm Selection

### 8.1 Preferred: Argon2id

Argon2id adalah pilihan modern yang umum direkomendasikan karena memory-hard dan menggabungkan karakteristik Argon2i/Argon2d.

Mental model:

```text
password + salt + memory + iterations + parallelism -> verifier
```

Kekuatan utama:

- memory-hard;
- lebih menekan keuntungan GPU dibanding fast hash;
- parameter explicit;
- format umum self-describing;
- cocok untuk password storage modern.

Kelemahan/pertimbangan:

- tidak built-in di standard Java SE;
- biasanya perlu library seperti Bouncy Castle, libsodium binding, atau library password hashing khusus;
- memory parameter harus diuji agar tidak menyebabkan DoS terhadap server sendiri;
- konfigurasi lemah tetap lemah meski algorithm-nya modern.

### 8.2 Acceptable: bcrypt

bcrypt masih banyak dipakai dan mature.

Kekuatan:

- battle-tested;
- built-in salt di format umum;
- cost mudah dipahami;
- library Java banyak.

Kelemahan:

- bukan memory-hard seperti Argon2id;
- beberapa implementasi memiliki batas/truncation password sekitar 72 bytes;
- perlu hati-hati Unicode/encoding;
- cost harus di-tune.

### 8.3 Acceptable Under Constraint: PBKDF2

PBKDF2 tersedia di Java SE melalui `SecretKeyFactory`, misalnya `PBKDF2WithHmacSHA256` pada JDK modern.

Kekuatan:

- standard dan widely available;
- cocok untuk compliance tertentu;
- tidak perlu native dependency;
- mudah dijalankan di Java standard environment.

Kelemahan:

- CPU-hard, bukan memory-hard;
- GPU/ASIC relatif lebih mudah melakukan parallel cracking;
- butuh iteration count tinggi;
- sering dikonfigurasi terlalu rendah.

PBKDF2 masih valid jika environment/compliance/library constraint tidak memungkinkan Argon2id, tetapi harus dikonfigurasi serius.

### 8.4 Avoid: SHA-256(password), SHA-512(password), MD5, SHA-1

Contoh buruk:

```java
MessageDigest md = MessageDigest.getInstance("SHA-256");
byte[] hash = md.digest(password.getBytes(StandardCharsets.UTF_8));
```

Ini bukan password hashing. Ini fast hash.

Menambahkan salt ke SHA-256 masih tidak cukup untuk password storage modern:

```text
SHA-256(salt || password)
```

Salt membantu melawan rainbow table, tetapi tidak membuat tebakan mahal.

---

## 9. Decision Matrix

| Kondisi | Rekomendasi |
|---|---|
| Sistem baru, tidak ada constraint berat | Argon2id |
| Sistem Java enterprise butuh library mature dan portable | Argon2id dengan library tepercaya, atau bcrypt jika Argon2id belum approved |
| Compliance/FIPS-like environment ketat | PBKDF2WithHmacSHA256/HmacSHA512 dengan iteration tinggi dan review compliance |
| Legacy bcrypt sudah berjalan | Pertahankan sambil naikkan cost dan siapkan migration ke Argon2id bila cocok |
| Legacy SHA/MD5 | Migrasi bertahap secepat mungkin |
| Password dipakai untuk encryption key lokal/file | Gunakan KDF sesuai use case; jangan simpan verifier sebagai encryption key |

---

## 10. Password Verifier Record Design

Jangan desain tabel seperti ini:

```sql
password_hash varchar(255) not null
```

Itu terlalu miskin metadata.

Desain minimal:

```sql
create table account_credential (
    account_id              uuid primary key,
    password_verifier        text not null,
    password_algorithm       varchar(64) not null,
    password_params_version  integer not null,
    password_updated_at      timestamp not null,
    password_must_change     boolean not null default false,
    password_locked_until    timestamp null,
    failed_attempt_count     integer not null default 0,
    created_at               timestamp not null,
    updated_at               timestamp not null
);
```

Namun jika format verifier sudah self-describing seperti PHC string:

```text
$argon2id$v=19$m=65536,t=3,p=1$base64salt$base64hash
```

`password_algorithm` bisa redundant. Tetap banyak sistem menyimpannya eksplisit untuk query/migration/reporting.

### 10.1 PHC String Format

Format seperti:

```text
$argon2id$v=19$m=65536,t=3,p=1$<salt>$<hash>
```

Keuntungan:

- algorithm jelas;
- parameter jelas;
- salt ikut tersimpan;
- verification library bisa parse;
- mudah detect needs rehash.

### 10.2 Versioned Custom Format

Jika memakai format sendiri, minimal harus punya:

```json
{
  "v": 3,
  "alg": "PBKDF2WithHmacSHA256",
  "iterations": 600000,
  "salt": "base64url...",
  "hash": "base64url...",
  "keyLengthBits": 256,
  "createdAt": "2026-06-16T00:00:00Z"
}
```

Jangan simpan format opaque tanpa versi.

---

## 11. Java Implementation Strategy

### 11.1 Prefer Library yang Memang Didesain untuk Password Hashing

Untuk Argon2id/bcrypt, lebih baik memakai library yang menyediakan high-level API:

```java
PasswordHasher hasher = ...;
String verifier = hasher.hash(password);
boolean ok = hasher.verify(password, verifier);
boolean needsRehash = hasher.needsRehash(verifier);
```

Jangan menulis Argon2/bcrypt sendiri.

Yang perlu direview dari library:

1. Maintenance status.
2. Vulnerability history.
3. Algorithm support.
4. Format verifier.
5. Constant-time compare behavior.
6. Password length handling.
7. Unicode/encoding behavior.
8. Memory clearing behavior, jika tersedia.
9. Dependency tree.
10. Compatibility dengan JDK dan deployment target.

### 11.2 PBKDF2 dengan Standard Java

PBKDF2 bisa dilakukan dengan `SecretKeyFactory` dan `PBEKeySpec`.

Contoh implementasi minimal yang lebih aman daripada SHA-256, tetapi tetap perlu tuning:

```java
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;

public final class Pbkdf2PasswordHasher {
    private static final String ALGORITHM = "PBKDF2WithHmacSHA256";
    private static final int SALT_BYTES = 16;
    private static final int KEY_BITS = 256;
    private static final int ITERATIONS = 600_000; // tune based on production hardware

    private final SecureRandom secureRandom = new SecureRandom();

    public String hash(char[] password) {
        byte[] salt = new byte[SALT_BYTES];
        secureRandom.nextBytes(salt);
        byte[] derived = derive(password, salt, ITERATIONS, KEY_BITS);

        return String.join("$",
                "pbkdf2-sha256",
                String.valueOf(ITERATIONS),
                Base64.getUrlEncoder().withoutPadding().encodeToString(salt),
                Base64.getUrlEncoder().withoutPadding().encodeToString(derived));
    }

    public boolean verify(char[] password, String verifier) {
        String[] parts = verifier.split("\\$");
        if (parts.length != 4 || !parts[0].equals("pbkdf2-sha256")) {
            throw new IllegalArgumentException("Unsupported verifier format");
        }

        int iterations = Integer.parseInt(parts[1]);
        byte[] salt = Base64.getUrlDecoder().decode(parts[2]);
        byte[] expected = Base64.getUrlDecoder().decode(parts[3]);
        byte[] actual = derive(password, salt, iterations, expected.length * 8);

        return MessageDigest.isEqual(expected, actual);
    }

    private static byte[] derive(char[] password, byte[] salt, int iterations, int keyBits) {
        try {
            PBEKeySpec spec = new PBEKeySpec(password, salt, iterations, keyBits);
            try {
                SecretKeyFactory factory = SecretKeyFactory.getInstance(ALGORITHM);
                return factory.generateSecret(spec).getEncoded();
            } finally {
                spec.clearPassword();
            }
        } catch (Exception e) {
            throw new IllegalStateException("Password hashing failed", e);
        }
    }
}
```

Catatan penting:

- Ini contoh edukatif, bukan final library production.
- Production code harus punya error handling lebih baik, metrics, parameter migration, dan test compatibility.
- Jangan hardcode iteration tanpa benchmark.
- Jangan log verifier/password.
- `char[]` membantu mengurangi lifetime dibanding `String`, tetapi tidak menyelesaikan semua memory retention problem di JVM.

---

## 12. Password Verification Flow

Flow yang benar harus menghindari user enumeration dan timing leak kasar.

```text
login(username, password):
  account = findAccountByUsername(username)

  if account exists:
      verifier = account.passwordVerifier
  else:
      verifier = DUMMY_VERIFIER

  passwordOk = verify(password, verifier)

  if account not exists:
      return genericFailure

  if not passwordOk:
      recordFailedAttempt(account)
      return genericFailure

  if account disabled/locked:
      return genericFailure or safe business message

  if password needs rehash:
      rehash and update verifier

  continue MFA/session issuance
```

### 12.1 Why Dummy Verifier?

Jika user tidak ditemukan dan sistem langsung return, response time bisa berbeda dari user valid dengan password salah. Attacker dapat melakukan enumeration.

Dummy verifier membuat path lebih mirip:

```java
private static final String DUMMY_VERIFIER =
    "$argon2id$v=19$m=65536,t=3,p=1$...$...";
```

Dummy verifier harus dibuat dengan parameter saat ini.

### 12.2 Generic Failure Message

Jangan:

```text
Username not found
Password incorrect
Account disabled
Password expired
```

Lebih aman:

```text
Invalid username or password.
```

Untuk account disabled/locked, pesan business-friendly boleh dipertimbangkan setelah risk assessment, tetapi jangan memberi oracle gratis untuk enumerasi account.

---

## 13. Timing-Safe Comparison

Jangan bandingkan hash dengan:

```java
expected.equals(actual)
Arrays.equals(expected, actual)
```

Untuk byte digest/verifier raw, gunakan constant-time comparison yang sesuai, misalnya:

```java
MessageDigest.isEqual(expected, actual)
```

Mental model:

- comparison biasa bisa berhenti di byte pertama yang berbeda;
- waktu response dapat mengungkap berapa banyak prefix yang sama;
- untuk verifier password, risiko paling besar biasanya offline cracking, tetapi timing-safe compare tetap hygiene penting;
- timing safety harus dilihat end-to-end, bukan hanya satu method.

Catatan realistis:

- Network jitter sering menutupi timing kecil.
- Tapi attacker lokal/internal/high-volume bisa memperbesar sinyal.
- Untuk security code, gunakan primitive aman sebagai default.

---

## 14. Password Length, Unicode, and Normalization

Ini area yang sering diabaikan.

### 14.1 Encoding

Password dari user adalah text. Hashing/KDF butuh bytes.

Harus jelas:

```text
password characters -> normalization policy -> UTF-8 bytes -> KDF/hash
```

Jika library menerima `char[]`, pastikan dokumentasi encoding behavior-nya.

### 14.2 Unicode Normalization

Masalah:

```text
é
```

Bisa direpresentasikan sebagai:

```text
U+00E9
```

atau:

```text
U+0065 + U+0301
```

Secara visual sama, byte berbeda.

Pilihan desain:

1. Normalize sebelum hashing.
2. Tidak normalize, tetapi konsisten.
3. Ikuti standard identitas yang dipakai organisasi.

Jika normalize, lakukan:

- konsisten di registration, login, password change;
- dokumentasikan bentuknya;
- test dengan karakter non-ASCII;
- hindari perubahan policy tanpa migration plan.

Contoh:

```java
import java.text.Normalizer;

String normalized = Normalizer.normalize(inputPassword, Normalizer.Form.NFKC);
```

Namun hati-hati: normalisasi bisa mengubah makna/karakter tertentu. Ini harus menjadi keputusan security/product, bukan kebetulan implementasi.

### 14.3 Password Length

Password panjang baik untuk passphrase, tetapi sangat panjang bisa menjadi DoS jika hashing mahal.

Policy yang masuk akal:

- minimum cukup untuk security/business requirement;
- maximum cukup besar, misalnya minimal mendukung passphrase panjang;
- jangan silently truncate;
- reject terlalu panjang dengan pesan jelas;
- ukur biaya hashing terhadap maximum length.

Untuk bcrypt, perhatikan batas byte/truncation implementasi. Jangan mengizinkan user percaya password 200 karakter dipakai penuh jika library hanya memakai sebagian.

---

## 15. Password Policy Modern

Password policy lama sering buruk:

```text
Must contain uppercase, lowercase, number, special character.
Must change every 30 days.
Cannot reuse last 24 passwords.
```

Masalah:

- user membuat pattern predictable seperti `Summer2026!`;
- forced rotation mendorong variasi kecil;
- complexity rule tidak selalu menaikkan entropy secara efektif;
- user menulis password di tempat tidak aman.

Policy modern lebih baik:

1. Izinkan password panjang/passphrase.
2. Jangan silently truncate.
3. Cek terhadap breached/common password list.
4. Hindari forced rotation tanpa indikasi compromise.
5. Gunakan MFA untuk account bernilai tinggi.
6. Rate limit online guessing.
7. Beri UX password manager friendly.
8. Jangan membatasi karakter secara tidak perlu.

Security bukan hanya “password harus rumit”, tetapi “authentication system resilient terhadap real attack”.

---

## 16. Breached Password Screening

Saat registration/change password, sistem bisa menolak password yang sudah umum bocor.

Flow:

```text
user enters new password
  -> local/common denylist check
  -> optional privacy-preserving breached password check
  -> password hash generation
```

Jangan mengirim password plaintext ke third-party API.

Approach:

- local top leaked password list;
- k-anonymity API jika tersedia dan approved;
- internal compromised credential intelligence;
- enterprise policy integration.

Pesan error:

```text
This password is commonly used or has appeared in known breaches. Choose a different password.
```

Jangan:

```text
Your password was found in breach X.
```

Karena bisa membuka privacy/security issue.

---

## 17. Pepper Design

Pepper dapat menambah layer jika database credential bocor tetapi application secret tidak bocor.

Ada dua pola umum.

### 17.1 Pre-hash Pepper

```text
password' = HMAC(pepper, password)
verifier = Argon2id(password', salt, params)
```

Kelebihan:

- attacker butuh pepper untuk test password.

Kekurangan:

- rotasi pepper sulit karena perlu password asli;
- jika pepper hilang, password tidak bisa diverifikasi;
- perlu desain multi-pepper/version.

### 17.2 Post-hash Pepper

```text
base = Argon2id(password, salt, params)
verifier = HMAC(pepper, base)
```

Kelebihan:

- bisa memungkinkan rotasi pepper jika base disimpan atau punya format tertentu.

Kekurangan:

- jika base disimpan bersama DB, attacker tetap bisa crack base;
- jika base tidak disimpan, rotasi tetap sulit;
- desain mudah salah.

### 17.3 Practical Recommendation

Gunakan pepper hanya jika organisasi punya:

- KMS/HSM/secret manager yang benar;
- key rotation procedure;
- incident runbook;
- startup dependency model;
- observability tanpa membocorkan secret;
- availability plan jika KMS down.

Untuk banyak sistem, Argon2id/bcrypt/PBKDF2 yang dikonfigurasi benar + MFA + breached password screening + secret management yang baik lebih penting daripada pepper rumit yang tidak bisa dioperasikan.

---

## 18. Work Factor Tuning

Parameter tidak boleh dipilih hanya dari blog.

Harus benchmark di production-like hardware.

Target umum:

```text
single password verification latency: cukup mahal untuk attacker,
tetapi masih acceptable untuk login p95/p99 dan peak traffic.
```

Faktor:

1. Login traffic peak.
2. CPU/memory per pod/instance.
3. Number of concurrent login attempts.
4. Rate limit policy.
5. Autoscaling behavior.
6. DoS risk.
7. Hardware generation.
8. Compliance minimum.
9. Account risk tier.
10. SLO authentication service.

### 18.1 Benchmark Harness Example

```java
public final class PasswordHashBenchmark {
    public static void main(String[] args) {
        char[] password = "correct horse battery staple".toCharArray();
        Pbkdf2PasswordHasher hasher = new Pbkdf2PasswordHasher();

        int warmup = 10;
        int runs = 100;

        for (int i = 0; i < warmup; i++) {
            hasher.hash(password);
        }

        long start = System.nanoTime();
        for (int i = 0; i < runs; i++) {
            String verifier = hasher.hash(password);
            if (!hasher.verify(password, verifier)) {
                throw new IllegalStateException("Verification failed");
            }
        }
        long elapsed = System.nanoTime() - start;
        double avgMs = elapsed / 1_000_000.0 / runs;
        System.out.printf("Average hash+verify: %.2f ms%n", avgMs);
    }
}
```

Untuk benchmark serius gunakan JMH. Contoh di atas hanya sanity check.

### 18.2 Parameter Migration

Jangan rehash semua user dalam satu batch besar jika password asli tidak tersedia. Rehash saat login berhasil:

```text
if verify succeeds and verifier parameters are old:
    newVerifier = hash(submittedPassword, currentParams)
    update credential record atomically
```

Untuk account dormant, bisa:

- force password reset;
- rehash setelah login berikutnya;
- risk-based prompt;
- background migration hanya jika format lama memungkinkan safe wrapping, dengan caveat.

---

## 19. Migration from Legacy Hashes

Legacy yang sering ditemui:

```text
MD5(password)
SHA1(password)
SHA256(password)
SHA256(salt + password)
PBKDF2 low iteration
bcrypt low cost
custom hash
encrypted password
```

### 19.1 Verify-Then-Rehash Pattern

```text
login:
  read credential version
  verify using legacy verifier
  if success:
      create new verifier with current algorithm
      update credential version
```

Pseudo-code:

```java
boolean verifyAndMaybeUpgrade(Account account, char[] password) {
    Credential credential = account.credential();

    boolean ok = switch (credential.algorithm()) {
        case "argon2id" -> argon2.verify(password, credential.verifier());
        case "bcrypt" -> bcrypt.verify(password, credential.verifier());
        case "legacy-sha256" -> legacySha256.verify(password, credential.verifier());
        default -> false;
    };

    if (!ok) {
        return false;
    }

    if (policy.needsUpgrade(credential)) {
        String newVerifier = currentHasher.hash(password);
        credentialRepository.updateVerifier(account.id(), credential.version(), newVerifier);
    }

    return true;
}
```

Gunakan optimistic locking agar tidak overwrite update concurrent.

### 19.2 Forced Reset

Pakai forced reset jika:

- algorithm terlalu lemah;
- ada breach;
- format lama ambiguous;
- password encrypted dan key exposure dicurigai;
- compliance menuntut.

### 19.3 Layered Hashing Caution

Kadang migrasi tanpa password asli dilakukan dengan:

```text
new = bcrypt(old_md5_hash)
```

Ini lebih baik daripada tetap MD5 dalam beberapa skenario, tetapi tidak setara dengan:

```text
bcrypt(password)
```

Karena input space `old_md5_hash` berasal dari password lama yang mungkin sudah bisa ditebak, dan attacker yang punya hash lama bisa membangun attack tertentu tergantung data yang bocor. Gunakan hanya sebagai mitigasi sementara dengan dokumentasi risiko.

---

## 20. Secret-Derived Keys vs Password Verifier

Jangan campur dua use case:

1. Password verifier untuk login.
2. Key derivation untuk encryption.

### 20.1 Password Verifier

```text
password -> password hashing -> verifier stored in DB
```

Tujuan:

- membuktikan user tahu password;
- tidak menghasilkan key untuk decrypt data.

### 20.2 Password-Derived Encryption Key

```text
password/passphrase -> KDF -> encryption key
```

Tujuan:

- decrypt local/private data;
- server mungkin tidak bisa reset password tanpa kehilangan access ke encrypted data;
- desain recovery jauh lebih sulit.

### 20.3 Jangan Reuse Output

Buruk:

```text
verifier hash digunakan sebagai AES key
```

Kenapa buruk:

- verifier disimpan di database;
- siapa pun yang mendapat verifier dapat menjadi pemegang key;
- domain separation rusak;
- parameter/verifier format tidak didesain sebagai encryption key lifecycle.

Benar:

```text
password + saltAuth + paramsAuth -> verifier
password + saltEnc + paramsEnc + context -> encryptionKey
```

Gunakan salt/context berbeda dan domain separation jelas.

---

## 21. Account Lockout, Rate Limit, and DoS Trade-Off

Password hashing mahal. Ini bagus untuk melawan attacker offline, tetapi bisa menjadi DoS vector online.

Attacker dapat mengirim banyak login attempt dan memaksa server melakukan Argon2/PBKDF2 mahal.

Kontrol:

1. Rate limit sebelum expensive hash jika sinyal cukup aman.
2. Per-account throttling.
3. Per-IP/subnet throttling.
4. Device/cookie-based throttling.
5. Queue isolation untuk login service.
6. Circuit breaker terhadap credential verification backend.
7. Dummy verifier tetap perlu, tetapi bisa dipadukan dengan rate limit.
8. MFA setelah password valid, bukan sebelum hash.
9. Monitoring CPU/memory auth path.
10. Separate auth workload dari core business API.

Trade-off:

- Terlalu agresif lockout → attacker bisa lock banyak account.
- Terlalu longgar → online guessing lebih mudah.
- Terlalu mahal hash → DoS.
- Terlalu murah hash → offline cracking mudah.

Security design harus mencari titik operasi, bukan nilai absolut.

---

## 22. Password Reset Token

Password reset sering lebih berbahaya daripada password login.

Invariant:

```text
Reset token must be high-entropy, single-use, time-limited, stored hashed,
and invalidated after use or relevant account security changes.
```

Desain:

```text
generate random token bytes using SecureRandom
send token to user via approved channel
store hash(token) with expiry and purpose
on submit, hash submitted token and compare
if valid, allow password reset and delete token
```

Jangan simpan reset token plaintext di DB.

Contoh:

```java
byte[] tokenBytes = new byte[32];
secureRandom.nextBytes(tokenBytes);
String token = Base64.getUrlEncoder().withoutPadding().encodeToString(tokenBytes);
byte[] tokenDigest = MessageDigest.getInstance("SHA-256")
        .digest(token.getBytes(StandardCharsets.UTF_8));
```

Kenapa SHA-256 boleh untuk reset token?

Karena reset token harus random high-entropy, bukan password manusia low-entropy. Untuk high-entropy random token, fast hash untuk storage lookup/integrity dapat diterima.

---

## 23. Password Change Flow

Saat user mengganti password:

1. Re-authenticate current password atau step-up MFA.
2. Verify current password.
3. Check new password policy.
4. Check breached/common list.
5. Generate new salt.
6. Hash dengan current parameter.
7. Update verifier atomically.
8. Invalidate reset tokens.
9. Invalidate or rotate sessions sesuai risk policy.
10. Notify user.
11. Audit event without logging password.

Audit event harus berisi:

```json
{
  "eventType": "PASSWORD_CHANGED",
  "accountId": "...",
  "actorType": "USER",
  "timestamp": "...",
  "ipRiskLevel": "LOW",
  "correlationId": "..."
}
```

Jangan berisi:

```json
{
  "newPassword": "..."
}
```

---

## 24. Admin Reset Flow

Admin reset lebih sensitif karena bisa menjadi privilege abuse.

Pattern aman:

1. Admin tidak melihat password user.
2. Admin tidak membuat permanent password manual jika bisa dihindari.
3. Sistem membuat reset flow ke user.
4. Jika temporary password wajib, harus one-time, short-lived, forced change.
5. Semua action diaudit.
6. High-risk account butuh approval/dual control.
7. User diberi notifikasi.

Anti-pattern:

```text
Admin sets user password to Welcome@123 and sends through email/chat.
```

---

## 25. Storage and Logging Hygiene

### 25.1 DTO Separation

Jangan gunakan object yang sama untuk request, domain, persistence, event, dan log.

Buruk:

```java
public record UserDto(
    String username,
    String password,
    String email
) {}
```

Lalu object ini tidak sengaja ke-log.

Lebih baik:

```java
public record RegisterUserRequest(
    String username,
    char[] password,
    String email
) {}

public record UserCreatedEvent(
    UUID userId,
    String username,
    String email
) {}
```

### 25.2 Redaction by Allowlist

Buruk:

```text
log all fields except password
```

Lebih aman:

```text
log only explicitly allowed fields
```

### 25.3 Avoid Password in Exceptions

Buruk:

```java
throw new IllegalArgumentException("Invalid password: " + password);
```

### 25.4 Heap Dump and Diagnostics

Password bisa muncul di heap dump karena:

- request body;
- JSON parser buffer;
- String immutable;
- framework binding;
- logs buffer;
- APM instrumentation;
- exception object;
- thread local;
- cache.

Mitigation:

- restrict heap dump access;
- disable automatic heap dump upload;
- redact diagnostics;
- avoid String where possible;
- clear `char[]` after use;
- reduce password lifetime;
- separate auth service observability policy.

---

## 26. Java `String` vs `char[]` Reality

Sering dikatakan: “pakai `char[]`, jangan `String`, karena bisa dihapus.”

Itu benar sebagian, tetapi tidak cukup.

Kelebihan `char[]`:

- bisa overwrite setelah dipakai;
- tidak interned;
- lifetime bisa lebih dikontrol.

Keterbatasan:

- framework HTTP biasanya membaca body sebagai byte/string buffer;
- JSON binding mungkin membuat String;
- GC/JIT/runtime bisa membuat copy;
- logs/APM bisa menangkap sebelum conversion;
- password tetap melewati banyak layer.

Praktik realistis:

1. Gunakan `char[]` di boundary internal security code bila memungkinkan.
2. Clear setelah use:

```java
Arrays.fill(password, '\0');
```

3. Jangan mengklaim ini “menghapus password dari memory secara absolut”.
4. Fokus juga pada logging, diagnostics, heap dump, APM, and request lifecycle.

---

## 27. Multi-Tenant and Regulatory Context

Untuk sistem regulatory/case management, password design harus mempertimbangkan:

1. User internal agency vs external public user.
2. Privileged admin.
3. Vendor/operator account.
4. Service account.
5. Cross-agency identity.
6. Audit defensibility.
7. Data classification.
8. Incident reporting.
9. Evidence of compliance.
10. Account lifecycle governance.

Password verifier event harus bisa menjawab:

- kapan password berubah;
- siapa yang memicu perubahan;
- lewat flow apa;
- apakah reset token digunakan;
- apakah MFA step-up terjadi;
- apakah ada failed login anomaly;
- apakah account disabled/locked;
- tanpa pernah menyimpan password.

---

## 28. Common Anti-Patterns

### Anti-Pattern 1: SHA-256 Password

```java
sha256(password)
```

Masalah: terlalu cepat.

### Anti-Pattern 2: Salt Global

```text
hash = SHA256(globalSalt + password)
```

Masalah: user dengan password sama tetap punya hash sama jika salt global sama; compromise salt global melemahkan semua.

### Anti-Pattern 3: Reversible Password Encryption

Masalah: key compromise membuka semua password.

### Anti-Pattern 4: Hidden Custom Algorithm

```text
SHA256(reverse(password) + secret + username)
```

Masalah: security by obscurity, tidak memory-hard, sulit direview.

### Anti-Pattern 5: Password in Audit Log

Masalah: log retention sering lebih luas daripada DB, sehingga breach surface membesar.

### Anti-Pattern 6: No Algorithm Version

Masalah: tidak bisa migrasi aman.

### Anti-Pattern 7: Silent Truncation

Masalah: user mengira password kuat, sistem memakai hanya prefix.

### Anti-Pattern 8: Same Error for Humans? Wrong Place

Generic external error bagus. Tetapi internal audit/metrics harus tetap cukup kaya untuk operasi.

### Anti-Pattern 9: Reusing Password Hash as API Secret

Masalah: verifier bukan key.

### Anti-Pattern 10: Hardcoding Cost Forever

Masalah: hardware attacker makin cepat; cost harus bisa dinaikkan.

---

## 29. Production Checklist

### 29.1 Algorithm

- [ ] Menggunakan Argon2id/bcrypt/PBKDF2 yang sesuai constraint.
- [ ] Tidak memakai MD5/SHA-1/SHA-256 fast hash untuk password storage.
- [ ] Algorithm dan parameter terdokumentasi.
- [ ] Cost sudah di-benchmark.
- [ ] Ada policy untuk menaikkan cost.

### 29.2 Salt

- [ ] Salt random per credential.
- [ ] Salt dibuat dengan `SecureRandom` atau library trusted.
- [ ] Salt tidak reuse saat password change.
- [ ] Salt cukup panjang.

### 29.3 Verifier Format

- [ ] Self-describing atau punya metadata versi.
- [ ] Bisa verify legacy hash.
- [ ] Bisa detect `needsRehash`.
- [ ] Panjang kolom cukup.

### 29.4 Verification Flow

- [ ] Generic error message.
- [ ] Dummy verifier untuk user not found jika perlu.
- [ ] Constant-time compare.
- [ ] Rate limit.
- [ ] Lockout tidak menciptakan DoS mudah.
- [ ] Rehash on successful login.

### 29.5 Password Policy

- [ ] Minimum length masuk akal.
- [ ] Maximum length jelas dan tidak silently truncate.
- [ ] Mendukung passphrase.
- [ ] Breached/common password screening.
- [ ] Tidak forced rotation tanpa alasan security/compliance kuat.

### 29.6 Operational Security

- [ ] Password tidak masuk log/APM/audit.
- [ ] Reset token disimpan hashed.
- [ ] Heap dump access dibatasi.
- [ ] Credential table backup terenkripsi dan access-controlled.
- [ ] Incident runbook credential leak tersedia.

---

## 30. Code Review Questions

Saat review PR terkait password, tanyakan:

1. Apakah password pernah disimpan atau dikembalikan dalam bentuk plaintext?
2. Apakah password pernah masuk log, exception, audit event, metric, tracing span?
3. Algorithm apa yang dipakai dan kenapa?
4. Apakah salt unik per credential?
5. Apakah cost parameter cukup dan sudah benchmark?
6. Apakah format verifier punya versioning?
7. Bagaimana migration dari hash lama?
8. Apakah comparison timing-safe?
9. Apakah user enumeration dicegah?
10. Apakah reset token high-entropy, single-use, dan disimpan hashed?
11. Apakah password panjang dan Unicode ditangani konsisten?
12. Apakah password hashing dapat menjadi DoS vector?
13. Apakah pepper dipakai? Jika ya, bagaimana rotasi dan recovery?
14. Apakah ada alert untuk brute force/credential stuffing?
15. Apakah account lifecycle dan audit trail lengkap?

---

## 31. Mini Case Study: Migrasi Legacy SHA-256 ke Argon2id

### 31.1 Situasi

Sistem lama menyimpan:

```text
password_hash = SHA256(salt + password)
salt = random 16 bytes
```

Masalah:

- Salt ada, tetapi hash cepat.
- Jika DB bocor, attacker bisa cracking cepat.
- Tidak ada metadata algorithm.
- User banyak, tidak realistis reset semua sekaligus.

### 31.2 Target

Migrasi ke:

```text
$argon2id$v=19$m=65536,t=3,p=1$<salt>$<hash>
```

### 31.3 Plan

1. Tambah kolom `credential_version` dan `password_verifier` baru.
2. Buat verifier abstraction:

```java
interface PasswordVerifierStrategy {
    boolean supports(Credential credential);
    boolean verify(char[] password, Credential credential);
    boolean needsUpgrade(Credential credential);
    String hash(char[] password);
}
```

3. Pada login:
   - detect legacy;
   - verify SHA-256 lama;
   - jika berhasil, hash ulang Argon2id;
   - update credential atomically.
4. Monitor progress migration.
5. Setelah periode tertentu, force reset untuk account dormant.
6. Hapus legacy verification code setelah migration selesai.
7. Dokumentasikan risk acceptance selama masa transisi.

### 31.4 Failure Modes

| Failure | Dampak | Mitigasi |
|---|---|---|
| Bug verifier legacy | User tidak bisa login | Compatibility test dengan sample hash lama |
| Cost terlalu mahal | Login latency/DoS | Benchmark dan rate limit |
| Update race | Verifier overwrite | Optimistic locking |
| Tidak ada monitoring | Migrasi tidak selesai | Dashboard credential version distribution |
| Legacy code tidak dihapus | Long-term attack surface | Sunset date dan enforcement |

---

## 32. Mini Case Study: Password Reset Token Leak

### 32.1 Situasi

Aplikasi menyimpan reset token plaintext:

```sql
reset_token varchar(255)
expires_at timestamp
```

Jika DB bocor, attacker bisa langsung reset password account yang tokennya belum expired.

### 32.2 Fix

Simpan digest token:

```sql
reset_token_digest varchar(64)
expires_at timestamp
used_at timestamp null
purpose varchar(64)
```

Flow:

```text
raw token sent once to user
server stores SHA-256(raw token)
verification hashes submitted token and compares digest
```

Karena reset token random 256-bit, SHA-256 digest cukup untuk storage representation.

### 32.3 Additional Controls

- token single-use;
- short expiry;
- rate limit reset attempt;
- invalidate old tokens after password change;
- notify user;
- audit event;
- do not leak whether email exists.

---

## 33. Mental Model: Password Defense Layers

```text
Layer 1: User password quality
  - breached password check
  - passphrase-friendly policy
  - no forced weak patterns

Layer 2: Online attack resistance
  - rate limit
  - MFA
  - anomaly detection
  - generic errors

Layer 3: Offline attack resistance
  - salted slow password hashing
  - memory-hard algorithm
  - cost tuning
  - optional pepper

Layer 4: Operational secrecy
  - no logs
  - no plaintext storage
  - protected backups
  - heap dump controls

Layer 5: Lifecycle and recovery
  - migration
  - reset flow
  - incident response
  - audit trail
```

Jangan mengandalkan satu layer.

---

## 34. Practical Architecture Pattern

### 34.1 Password Module Boundary

Buat satu module/class boundary untuk password:

```text
security-password/
  PasswordHasher
  PasswordVerifier
  PasswordPolicy
  PasswordMigrationPolicy
  ResetTokenService
  CredentialAuditService
```

Aplikasi lain tidak boleh langsung memanggil `MessageDigest`, `SecretKeyFactory`, atau crypto library untuk password.

### 34.2 API Design

```java
public interface PasswordService {
    PasswordHashResult hashNewPassword(char[] password);
    PasswordVerificationResult verify(char[] submittedPassword, StoredCredential credential);
    PasswordPolicyResult validateNewPassword(char[] password, AccountContext context);
}
```

Result object:

```java
public record PasswordVerificationResult(
        boolean valid,
        boolean needsRehash,
        String upgradedVerifier
) {}
```

Jangan expose low-level details ke controller.

### 34.3 Controller Flow

Controller tidak tahu algorithm.

```java
@PostMapping("/login")
public ResponseEntity<?> login(@RequestBody LoginRequest request) {
    authenticationApplicationService.login(request.username(), request.password());
    return ResponseEntity.ok().build();
}
```

Application service handle:

- account lookup;
- dummy verifier;
- password verification;
- throttling;
- MFA transition;
- audit;
- session issuance.

---

## 35. Testing Strategy

### 35.1 Unit Tests

- hash then verify succeeds;
- wrong password fails;
- different salts produce different verifiers;
- malformed verifier rejected safely;
- old parameter verifier triggers `needsRehash`;
- current parameter verifier does not trigger `needsRehash`;
- Unicode password behaves consistently;
- long password policy enforced;
- password not included in exception message.

### 35.2 Compatibility Tests

Keep test vectors for all legacy formats:

```text
legacy-md5
legacy-sha1
legacy-sha256-salted
pbkdf2-v1
bcrypt-v2
argon2id-v3
```

### 35.3 Security Regression Tests

- generic error response for user not found vs wrong password;
- reset token single-use;
- reset token expiry;
- token digest compare;
- password change invalidates reset tokens;
- password reset invalidates sessions if policy requires;
- breached password rejected.

### 35.4 Performance Tests

- login p50/p95/p99;
- CPU/memory under burst login;
- rate limit effectiveness;
- Argon2 memory pressure;
- pod autoscaling behavior;
- dummy verifier cost under enumeration attack.

---

## 36. Observability Without Secret Leakage

Metrics yang berguna:

```text
login_attempt_total{result="success|failure|locked|mfa_required"}
password_verify_duration_ms
password_rehash_total{from="bcrypt10",to="argon2id-v3"}
credential_version_count{version="..."}
password_reset_requested_total
password_reset_completed_total
breached_password_rejected_total
```

Jangan:

- label metric dengan username/email;
- log password;
- log verifier;
- log reset token;
- log full credential object.

Trace:

```text
span: AuthService.login
attributes:
  auth.result = failure
  auth.failure_category = generic_invalid_credential
  credential.version = argon2id-v3
```

Hindari:

```text
password=...
resetToken=...
passwordHash=...
```

---

## 37. Failure Model

| Failure Mode | Root Cause | Consequence | Control |
|---|---|---|---|
| Fast hash used | Misunderstanding hash vs password hash | Offline cracking cheap | Argon2id/bcrypt/PBKDF2 review gate |
| Salt missing | Custom implementation | Same passwords same hash | Library/self-describing verifier |
| Cost too low | Default copied from old code | Cracking cheaper | Benchmark and periodic cost review |
| Cost too high | No load testing | Login DoS | Performance test and rate limit |
| Password logged | DTO/logging mistake | Secret leakage | Redaction allowlist |
| Reset token plaintext | Convenience | Account takeover after DB leak | Store token digest only |
| Algorithm no version | Poor schema | Cannot migrate | Versioned verifier format |
| bcrypt truncation ignored | Library behavior unknown | Password weaker than expected | Length/encoding tests |
| Pepper lost | Secret lifecycle failure | All passwords unverifiable | KMS runbook and backup/rotation design |
| User enumeration | Different errors/timing | Account discovery | Generic response and dummy verifier |

---

## 38. Review Checklist for Top 1% Engineer

A senior/top-tier engineer should be able to say:

1. “Our password storage threat model assumes DB compromise.”
2. “We use algorithm X because of constraint Y, not because it was copied from a blog.”
3. “Our verifier format is versioned and migration-safe.”
4. “We benchmarked cost on production-like hardware.”
5. “We have rehash-on-login for parameter upgrades.”
6. “We have a plan for dormant accounts.”
7. “We do not store reset tokens plaintext.”
8. “We have redaction and diagnostics controls.”
9. “We can answer how many credentials still use legacy algorithm.”
10. “We know what to do if credential DB leaks.”

That is the difference between “I know password hashing” and “I can operate password security in production.”

---

## 39. Summary

Password security is not a single API call. It is a full lifecycle:

```text
input handling
  -> policy validation
  -> breached password screening
  -> salted slow password hashing
  -> versioned verifier storage
  -> timing-safe verification
  -> rate limiting
  -> migration
  -> reset flow
  -> logging hygiene
  -> incident response
```

The key mental models:

1. Passwords are low-entropy human secrets.
2. Password storage design assumes database compromise.
3. Fast cryptographic hash is wrong for password storage.
4. Salt prevents precomputation and cross-user hash equality, but does not make hashing slow.
5. Work factor makes guessing expensive.
6. Memory-hard algorithms reduce attacker hardware advantage.
7. Verifier metadata is necessary for migration.
8. Password verifier is not an encryption key.
9. Reset tokens are credentials and must be treated like credentials.
10. Operational leakage can defeat good cryptography.

---

## 40. References

- OWASP Password Storage Cheat Sheet — password hashing, salt, pepper, work factor, Argon2id/bcrypt/PBKDF2 guidance.  
  https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html

- OWASP Authentication Cheat Sheet — authentication controls, password length guidance, generic errors, account recovery concerns.  
  https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html

- NIST SP 800-63B Digital Identity Guidelines — verifier requirements for passwords/memorized secrets and offline attack resistance.  
  https://pages.nist.gov/800-63-4/sp800-63b.html

- RFC 9106 — Argon2 Memory-Hard Function for Password Hashing and Proof-of-Work Applications.  
  https://www.rfc-editor.org/info/rfc9106

- Oracle Java `SecretKeyFactory` API — Java API for secret key factories and PBKDF2-related algorithm support.  
  https://docs.oracle.com/en/java/javase/26/docs/api/java.base/javax/crypto/SecretKeyFactory.html

- Oracle Java Security Standard Algorithm Names — standard algorithm names including PBKDF2 variants.  
  https://docs.oracle.com/en/java/javase/11/docs/specs/security/standard-names.html

- Oracle Java `MessageDigest` API — message digest API and digest comparison support.  
  https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/security/MessageDigest.html

---

## 41. What Comes Next

Part berikutnya:

```text
Part 7 — Symmetric Encryption in Java: AES, Modes, Padding, AEAD
```

Di sana kita akan mulai masuk ke encryption sungguhan: AES, mode operasi, padding oracle, GCM, nonce reuse, associated authenticated data, envelope format, dan misuse pattern Java `Cipher`.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-security-cryptography-integrity-part-005](./learn-java-security-cryptography-integrity-part-005.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-security-cryptography-integrity-part-007](./learn-java-security-cryptography-integrity-part-007.md)

</div>