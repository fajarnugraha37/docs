# learn-java-security-cryptography-integrity-part-004

# Part 4 — Randomness, Entropy, Nonce, Salt, IV, Token

> Seri: `learn-java-security-cryptography-integrity`  
> Bagian: `Part 4 dari 35`  
> Status seri: **belum selesai**  
> Fokus: membangun mental model yang benar tentang randomness, entropy, nonce, salt, IV, token, collision probability, dan failure mode yang sering membuat sistem kriptografi Java terlihat benar tetapi secara security rusak.

---

## 0. Kenapa Part Ini Sangat Penting

Banyak engineer menganggap randomness sebagai detail kecil:

```java
new SecureRandom().nextBytes(bytes);
```

Lalu selesai.

Padahal dalam cryptographic engineering, randomness adalah salah satu fondasi paling kritis. Algorithm yang kuat bisa runtuh jika:

- key dibuat dari randomness lemah,
- nonce dipakai ulang,
- IV dibuat deterministik pada mode yang butuh unpredictable IV,
- token terlalu pendek,
- UUID dianggap otomatis aman,
- salt disamakan dengan secret,
- seed dikontrol attacker,
- random source salah karena alasan performance,
- atau collision probability tidak dihitung.

Security failure pada randomness sering tidak terlihat dalam test biasa. Unit test akan hijau. Integration test akan hijau. Sistem production akan jalan. Tetapi attacker bisa memprediksi token, menebak reset link, memalsukan session, menghubungkan ciphertext, atau memulihkan plaintext/key dari nonce reuse.

Bagian ini membangun fondasi agar nanti ketika kita masuk AES-GCM, HMAC, signature, password hashing, token, mTLS, JWT, file integrity, dan audit evidence, kamu tidak hanya tahu API-nya, tetapi paham invariant random-related yang tidak boleh rusak.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu harus bisa:

1. Membedakan randomness biasa, pseudo-randomness, dan cryptographically secure randomness.
2. Menjelaskan kenapa `java.util.Random`, `Math.random()`, dan `ThreadLocalRandom` tidak boleh dipakai untuk security.
3. Menggunakan `SecureRandom` secara benar di Java modern.
4. Memahami entropy, seed, DRBG, reseed, prediction resistance, dan blocking behavior secara engineering-level.
5. Membedakan salt, nonce, IV, token, key, pepper, dan challenge.
6. Mendesain token dengan entropy yang cukup.
7. Menghitung collision risk secara praktis.
8. Menentukan kapan nilai random harus unpredictable, kapan cukup unique, dan kapan harus keduanya.
9. Mengenali failure mode seperti nonce reuse, predictable reset token, weak session id, dan deterministic key generation.
10. Membuat checklist review untuk setiap kode Java yang menghasilkan random value.

---

## 2. Referensi Teknis Utama

Materi ini disusun dengan mengacu pada referensi primer berikut:

1. Oracle Java `SecureRandom` API — `SecureRandom` menyediakan cryptographically strong random number generator dan harus menghasilkan output non-deterministic sesuai contract API Java.
2. Oracle Java Cryptography Architecture Reference Guide — menjelaskan `SecureRandom`, provider, DRBG configuration, dan integrasinya dengan JCA.
3. Java Security Standard Algorithm Names — menyediakan nama standar algorithm untuk `SecureRandom` seperti `DRBG`, `NativePRNG`, dan lainnya sesuai implementasi/provider.
4. OWASP Cryptographic Storage Cheat Sheet — menekankan pemilihan algorithm, mode, IV, key, dan secure random yang tepat.
5. OWASP Top 10 A02 Cryptographic Failures — menekankan bahwa IV/nonce harus dipilih sesuai mode dan tidak boleh dipakai ulang dengan key yang sama.
6. NIST SP 800-90A Rev. 1 — rekomendasi DRBG berbasis hash function dan block cipher untuk menghasilkan random bit secara deterministik dari entropy.

Catatan penting: standar dan JDK terus bergerak. Karena itu, prinsip yang dipakai di sini lebih penting daripada menghafal satu nama provider spesifik.

---

## 3. Mental Model Utama

Randomness dalam security bukan “acak supaya tidak rapi”. Randomness dipakai untuk membangun **ketidakmampuan attacker untuk menebak, menghubungkan, atau mengulang nilai penting**.

Model sederhananya:

```text
Security randomness = unpredictability under attacker observation
```

Artinya:

- attacker boleh melihat banyak output sebelumnya,
- attacker boleh tahu algorithm yang dipakai,
- attacker boleh tahu struktur sistem,
- attacker boleh tahu timestamp kasar,
- attacker boleh tahu format token,
- attacker boleh mengirim request berkali-kali,
- attacker boleh mengumpulkan banyak sample,
- tetapi attacker tetap tidak boleh bisa menebak output berikutnya dengan probabilitas praktis.

Dalam sistem Java enterprise, randomness biasanya dipakai untuk:

1. Generate cryptographic key.
2. Generate IV/nonce.
3. Generate password reset token.
4. Generate email verification token.
5. Generate session identifier.
6. Generate CSRF token.
7. Generate OAuth/OIDC `state`, `nonce`, PKCE verifier.
8. Generate challenge untuk challenge-response protocol.
9. Generate salt untuk password hashing.
10. Generate correlation-safe opaque identifier.
11. Generate temporary file name yang tidak bisa ditebak.
12. Generate idempotency key dari client/server boundary.
13. Generate bootstrap secret untuk node/service.

Tidak semua use case membutuhkan property yang sama.

---

## 4. Empat Property yang Harus Dibedakan

Random-related value dapat butuh satu atau lebih property berikut.

### 4.1 Unpredictability

Attacker tidak bisa menebak nilai tersebut sebelum melihatnya.

Contoh yang butuh unpredictability:

- session id,
- reset password token,
- CSRF token,
- OAuth `state`,
- cryptographic key,
- HMAC key,
- JWT signing key,
- AES key,
- challenge secret.

Jika value ini predictable, attacker bisa impersonate, bypass flow, atau decrypt/sign.

### 4.2 Uniqueness

Nilai tidak boleh sama dalam domain tertentu.

Contoh yang butuh uniqueness:

- nonce AES-GCM per key,
- message id,
- idempotency key,
- audit event id,
- IV/nonce untuk mode tertentu,
- request replay nonce.

Tidak semua nilai unique harus secret. Nonce AES-GCM misalnya boleh disimpan bersama ciphertext. Yang penting tidak reuse untuk key yang sama.

### 4.3 Non-repetition Under Same Key

Ini property yang lebih spesifik: nilai tidak boleh pernah dipakai ulang dengan cryptographic key yang sama.

Contoh:

```text
AES-GCM key K + nonce N
```

Pasangan `(K, N)` tidak boleh muncul dua kali.

Nilai `N` boleh sama jika key berbeda. Key `K` boleh sama jika nonce berbeda. Tetapi kombinasi sama dapat fatal.

### 4.4 Non-linkability

Attacker tidak bisa menghubungkan dua event/user/message karena random value mengandung pola.

Contoh:

- public invitation link,
- opaque external id,
- tracking-safe file download token,
- case access token,
- anonymous survey token.

Non-linkability sering membutuhkan unpredictable random token, bukan sequential ID.

---

## 5. Istilah Dasar: Entropy, Seed, PRNG, CSPRNG, DRBG

### 5.1 Entropy

Entropy adalah ukuran ketidakpastian. Dalam konteks security, entropy menunjukkan berapa sulit nilai ditebak attacker.

Jika token memiliki 128 bit entropy ideal, attacker perlu rata-rata sekitar `2^127` tebakan untuk menebak token valid tertentu.

Tapi “panjang string” bukan sama dengan entropy.

Contoh:

```text
Token A: 00000000000000000000000000000000
Token B: 4f8a9e2c7b1d...
```

Keduanya bisa sama-sama panjang, tetapi Token A punya entropy sangat rendah jika selalu nol.

Entropy datang dari cara token dibuat, bukan tampilannya.

### 5.2 Seed

Seed adalah input awal yang digunakan generator untuk menghasilkan output.

Untuk PRNG biasa:

```text
seed -> deterministic sequence
```

Jika attacker tahu seed, seluruh sequence bisa direkonstruksi.

Untuk security, seed harus berasal dari entropy source yang tidak bisa ditebak.

### 5.3 PRNG

Pseudo-random number generator menghasilkan sequence yang terlihat random, tetapi deterministik dari seed.

`java.util.Random` adalah PRNG biasa. Cocok untuk simulasi ringan, randomized algorithm non-security, atau test deterministic. Tidak cocok untuk security.

### 5.4 CSPRNG

Cryptographically secure pseudo-random number generator dirancang agar output tidak bisa diprediksi secara praktis, bahkan setelah attacker melihat banyak output.

Di Java, API utamanya adalah:

```java
java.security.SecureRandom
```

### 5.5 DRBG

Deterministic Random Bit Generator adalah bentuk CSPRNG yang distandarkan. NIST SP 800-90A mendefinisikan mekanisme DRBG berbasis hash function atau block cipher. Java modern memiliki algorithm name `DRBG` melalui provider tertentu.

Mental model:

```text
entropy source -> instantiate DRBG -> generate bytes -> optional reseed -> generate bytes
```

DRBG bukan berarti “tidak aman karena deterministic”. Ia deterministic setelah di-instantiate, tetapi internal state-nya berasal dari entropy yang kuat dan didesain agar output tidak bisa diprediksi.

---

## 6. Java Randomness API Landscape

Java memiliki beberapa API random. Tidak semuanya aman untuk security.

| API | Cocok untuk security? | Catatan |
|---|---:|---|
| `Math.random()` | Tidak | Convenience API, bukan security. |
| `java.util.Random` | Tidak | Deterministic PRNG, mudah direplikasi jika seed diketahui/tertebak. |
| `ThreadLocalRandom` | Tidak | Bagus untuk concurrency/performance non-security; bukan CSPRNG. |
| `SplittableRandom` | Tidak | Bagus untuk stream/simulation, bukan security. |
| `RandomGenerator` API Java 17+ | Umumnya tidak | API modern random generator, tetapi tidak otomatis cryptographic. |
| `SecureRandom` | Ya | Gunakan untuk token, key material, nonce yang butuh CSPRNG, salt, challenge. |

Rule sederhana:

```text
Jika nilai random memengaruhi security, gunakan SecureRandom.
```

---

## 7. `SecureRandom` di Java

`SecureRandom` adalah abstraction di JCA. Ia provider-based. Artinya, implementation yang dipakai bisa berbeda tergantung:

- JDK,
- provider,
- OS,
- security properties,
- FIPS mode,
- konfigurasi runtime.

Contoh penggunaan dasar:

```java
import java.security.SecureRandom;

public final class SecureRandomExample {
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    public static byte[] randomBytes(int length) {
        byte[] bytes = new byte[length];
        SECURE_RANDOM.nextBytes(bytes);
        return bytes;
    }
}
```

Untuk mayoritas aplikasi Java modern, `new SecureRandom()` atau singleton `SecureRandom` yang dibuat sekali sudah cukup baik.

Namun ada detail penting.

---

## 8. Jangan Membuat `SecureRandom` dengan Seed yang Kamu Kontrol

Ini salah:

```java
SecureRandom random = new SecureRandom("my-fixed-seed".getBytes(StandardCharsets.UTF_8));
```

Kenapa?

Karena kamu sedang memasukkan determinism yang bisa ditebak. Banyak engineer melakukan ini agar test repeatable, tetapi kemudian pattern-nya bocor ke production code.

Lebih buruk:

```java
SecureRandom random = new SecureRandom();
random.setSeed(userId);
```

`setSeed` bukan cara membuat output “lebih aman” dari data application. Seed dari `userId`, timestamp, hostname, atau PID bukan entropy rahasia.

Mental model yang benar:

```text
Production security random source harus dibiarkan mengambil entropy dari platform/provider.
```

Untuk test deterministic, jangan membuat production token generator bergantung pada fixed `SecureRandom`. Buat abstraction.

Contoh:

```java
public interface RandomBytesSource {
    void nextBytes(byte[] target);
}

public final class SecureRandomBytesSource implements RandomBytesSource {
    private final SecureRandom secureRandom;

    public SecureRandomBytesSource(SecureRandom secureRandom) {
        this.secureRandom = Objects.requireNonNull(secureRandom);
    }

    @Override
    public void nextBytes(byte[] target) {
        secureRandom.nextBytes(target);
    }
}
```

Lalu test bisa memakai deterministic fake, sedangkan production memakai `SecureRandom`.

---

## 9. `getInstanceStrong()` Tidak Selalu Jawaban Terbaik

Java menyediakan:

```java
SecureRandom strong = SecureRandom.getInstanceStrong();
```

Ini memilih algorithm berdasarkan property `securerandom.strongAlgorithms`.

Kelihatannya ideal. Tetapi untuk service production high-throughput, `getInstanceStrong()` bisa memilih implementation yang lebih blocking atau lebih mahal tergantung platform/config. Jadi jangan otomatis mengganti semua random dengan `getInstanceStrong()` tanpa observasi.

Prinsip praktis:

1. Untuk kebanyakan token/key/salt/nonce application-level, `new SecureRandom()` cukup baik di JDK modern.
2. Untuk compliance/FIPS/high assurance, pilih provider/algorithm secara eksplisit sesuai policy organisasi.
3. Untuk key generation sensitif, boleh pakai configured provider yang approved, bukan sekadar `getInstanceStrong()` karena namanya terdengar kuat.
4. Ukur startup behavior dan latency jika generator dipakai saat boot.

---

## 10. `SecureRandom` dan Thread Safety

`SecureRandom` aman dipakai lintas thread dari sisi correctness API, tetapi performance bisa berbeda tergantung implementation. Ada provider yang melakukan synchronization internal.

Pattern yang umum:

```java
private static final SecureRandom SECURE_RANDOM = new SecureRandom();
```

Ini acceptable untuk banyak aplikasi.

Untuk throughput sangat tinggi, misalnya generate ratusan ribu token per detik, pertimbangkan:

1. benchmark provider yang digunakan,
2. gunakan pool kecil bila terbukti bottleneck,
3. hindari membuat instance baru per request,
4. jangan mengganti ke `ThreadLocalRandom` demi performance.

Salah:

```java
public String createToken() {
    SecureRandom random = new SecureRandom(); // dibuat terus-menerus per request
    byte[] token = new byte[32];
    random.nextBytes(token);
    return Base64.getUrlEncoder().withoutPadding().encodeToString(token);
}
```

Lebih baik:

```java
public final class TokenGenerator {
    private final SecureRandom secureRandom;

    public TokenGenerator(SecureRandom secureRandom) {
        this.secureRandom = Objects.requireNonNull(secureRandom);
    }

    public String generateUrlSafeToken(int byteLength) {
        if (byteLength < 16) {
            throw new IllegalArgumentException("Token must have at least 128 bits of entropy");
        }
        byte[] bytes = new byte[byteLength];
        secureRandom.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }
}
```

---

## 11. Random Byte Length and Entropy

Jika menggunakan `SecureRandom.nextBytes(byte[])`, idealnya entropy kira-kira sebesar jumlah bit output.

| Byte length | Bit length | Umum untuk |
|---:|---:|---|
| 8 bytes | 64 bits | Terlalu kecil untuk banyak token security modern. |
| 12 bytes | 96 bits | Umum untuk AES-GCM nonce, tapi nonce bukan token auth. |
| 16 bytes | 128 bits | Minimum umum untuk CSRF/session-ish token. |
| 24 bytes | 192 bits | Strong token. |
| 32 bytes | 256 bits | Sangat baik untuk reset token, API secret, opaque credential. |
| 64 bytes | 512 bits | Biasanya berlebihan untuk token; bisa dipakai untuk high-value secret. |

Prinsip:

```text
Token security-sensitive: minimal 128 bit entropy, prefer 192/256 bit untuk high-value flow.
```

Contoh reset password token:

```java
String token = tokenGenerator.generateUrlSafeToken(32); // 256-bit entropy
```

Jangan membuat token seperti ini:

```java
String token = userId + ":" + System.currentTimeMillis();
```

Atau:

```java
String token = Integer.toHexString(new Random().nextInt());
```

Itu bukan token security.

---

## 12. Encoding Bukan Entropy

Base64, hex, Base62, Base58, dan URL encoding hanya representasi.

Contoh:

```text
32 random bytes -> 256 bit entropy
hex encoding    -> 64 chars
base64url       -> sekitar 43 chars tanpa padding
```

Jika input random-nya cuma 4 byte, lalu di-base64, hasilnya tetap hanya 32 bit entropy.

Salah mental model:

```text
String panjang = aman
```

Benar:

```text
Entropy sumber random + panjang random bytes = security strength
```

---

## 13. Salt

Salt adalah nilai unik/random yang digabungkan dengan password sebelum password hashing.

Tujuan salt:

1. Mencegah dua password sama menghasilkan hash sama.
2. Menghambat precomputed rainbow table.
3. Membuat cracking harus dilakukan per-user/per-hash.

Salt bukan secret.

Salt boleh disimpan bersama password hash.

Contoh format konseptual:

```text
algorithm=argon2id
params=m=...,t=...,p=...
salt=base64(...)
hash=base64(...)
```

Salt harus unique per password credential. Biasanya 16 byte random cukup.

Salah:

```text
salt = username
```

Kenapa? Username bukan random, bisa ditebak, bisa sama setelah transformasi, dan tidak memberikan entropy tambahan.

Salah juga:

```text
satu global salt untuk semua user
```

Itu bukan salt per credential; itu lebih mirip pepper yang salah kelola.

---

## 14. Pepper

Pepper adalah secret tambahan yang disimpan terpisah dari database password.

Perbedaan:

| Aspek | Salt | Pepper |
|---|---|---|
| Secret? | Tidak | Ya |
| Per user? | Ya, biasanya | Biasanya global/per tenant/per generation |
| Disimpan di DB? | Ya | Tidak idealnya |
| Tujuan | Uniqueness dan anti-rainbow table | Menambah barrier jika DB bocor |
| Rotasi | Mudah | Sulit, perlu strategi |

Pepper bukan pengganti password hashing yang kuat. Pepper juga bukan alasan memakai MD5/SHA-1.

---

## 15. Nonce

Nonce berarti “number used once”. Dalam cryptography, nonce adalah nilai yang tidak boleh dipakai ulang dalam context tertentu.

Nonce tidak selalu harus random. Ia bisa:

1. random,
2. counter,
3. kombinasi prefix random + counter,
4. sequence per key.

Yang penting adalah invariant-nya.

Untuk banyak mode modern:

```text
Nonce must be unique per key.
```

Bukan selalu:

```text
Nonce must be secret.
```

Contoh AES-GCM:

- nonce umumnya 96 bit,
- tidak perlu secret,
- harus unik untuk key yang sama,
- reuse bisa fatal.

---

## 16. IV — Initialization Vector

IV adalah input tambahan ke mode encryption.

IV requirement tergantung mode.

| Mode | IV/nonce requirement | Catatan |
|---|---|---|
| ECB | Tidak ada | Jangan dipakai untuk data sensitif. |
| CBC | IV unpredictable/random | IV reuse/predictable dapat membuka pattern dan attack tertentu. |
| CTR | Nonce/counter unique | Reuse menghasilkan keystream reuse. |
| GCM | Nonce unique per key | 96-bit nonce umum; reuse sangat berbahaya. |
| ChaCha20-Poly1305 | Nonce unique per key | Reuse juga fatal. |

Jadi jangan berkata:

```text
IV harus selalu random.
```

Yang benar:

```text
IV/nonce harus memenuhi requirement mode yang dipakai.
```

OWASP juga menekankan bahwa IV harus dipilih sesuai mode operasi; untuk banyak mode perlu CSPRNG, untuk mode berbasis nonce IV tidak harus CSPRNG, tetapi tidak boleh dipakai dua kali dengan key yang sama.

---

## 17. Token

Token adalah value yang dipakai sebagai credential, reference, atau proof dalam workflow.

Contoh:

- password reset token,
- email verification token,
- remember-me token,
- API key,
- bearer token,
- invitation link,
- CSRF token,
- session id.

Token security-sensitive harus:

1. generated by `SecureRandom`,
2. punya entropy cukup,
3. tidak mengandung data sensitif kecuali dienkripsi/sign sesuai desain,
4. disimpan sebagai hash jika token bertindak seperti password,
5. punya expiry,
6. single-use untuk flow tertentu,
7. punya scope,
8. bisa revoked,
9. dibandingkan dengan timing-safe comparison jika relevan,
10. tidak muncul di log.

---

## 18. Token Opaque vs Structured

### 18.1 Opaque Token

Opaque token tidak memiliki meaning untuk client.

```text
8QgMLq7Mk93QG6pjrmgWspTb4qQpDxZyI21Yiz3mqxw
```

Server menyimpan metadata:

```text
hash(token) -> userId, purpose, expiry, consumedAt, scope
```

Kelebihan:

- mudah revoke,
- tidak leak data,
- simple threat model,
- bagus untuk reset/email/invitation.

Kekurangan:

- butuh storage lookup.

### 18.2 Structured Token

Structured token membawa data, misalnya JWT/JWS/JWE.

Kelebihan:

- self-contained,
- bisa diverifikasi tanpa DB lookup,
- cocok untuk distributed auth tertentu.

Kekurangan:

- revocation lebih sulit,
- claim leak jika tidak dienkripsi,
- signature validation harus benar,
- key rotation lebih rumit,
- `aud`, `iss`, `exp`, `nbf`, `kid`, algorithm confusion perlu hati-hati.

Untuk Part 4, prinsipnya:

```text
Untuk one-time security workflow, opaque random token sering lebih aman dan sederhana daripada structured token.
```

---

## 19. Token Harus Disimpan Seperti Password Jika Bisa Dipakai Login/Action

Jika attacker mendapatkan database berisi reset token plaintext, attacker bisa langsung reset akun.

Lebih aman:

```text
client receives token plaintext once
server stores hash(token)
```

Contoh desain:

```text
1. Generate 32 random bytes.
2. Encode base64url.
3. Send token to user.
4. Store SHA-256(token) or HMAC(serverSecret, token) in DB.
5. On verification, hash/HMAC submitted token and compare.
6. Mark consumed.
```

Untuk token random 256-bit, SHA-256 hash storage acceptable karena token punya entropy tinggi. Ini berbeda dari password manusia yang entropy-nya rendah dan butuh password hashing seperti Argon2id/bcrypt/scrypt/PBKDF2.

---

## 20. Contoh Secure Token Service

```java
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Objects;

public final class SecureTokenService {
    private static final int TOKEN_BYTES = 32; // 256-bit entropy

    private final SecureRandom secureRandom;
    private final Clock clock;

    public SecureTokenService(SecureRandom secureRandom, Clock clock) {
        this.secureRandom = Objects.requireNonNull(secureRandom);
        this.clock = Objects.requireNonNull(clock);
    }

    public IssuedToken issue(Duration ttl) {
        if (ttl.isNegative() || ttl.isZero()) {
            throw new IllegalArgumentException("ttl must be positive");
        }

        byte[] raw = new byte[TOKEN_BYTES];
        secureRandom.nextBytes(raw);

        String token = Base64.getUrlEncoder()
                .withoutPadding()
                .encodeToString(raw);

        String tokenHash = sha256Hex(token);
        Instant expiresAt = clock.instant().plus(ttl);

        return new IssuedToken(token, tokenHash, expiresAt);
    }

    public boolean matches(String submittedToken, String storedHashHex) {
        if (submittedToken == null || storedHashHex == null) {
            return false;
        }
        String submittedHash = sha256Hex(submittedToken);
        return MessageDigest.isEqual(
                submittedHash.getBytes(StandardCharsets.US_ASCII),
                storedHashHex.getBytes(StandardCharsets.US_ASCII)
        );
    }

    private static String sha256Hex(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hashed = digest.digest(value.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hashed);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is not available", e);
        }
    }

    public record IssuedToken(
            String plaintextToken,
            String tokenHashHex,
            Instant expiresAt
    ) {}
}
```

Catatan review:

1. Plaintext token hanya dikembalikan saat issue.
2. DB menyimpan hash.
3. Token 32 byte dari `SecureRandom`.
4. Encoding base64url tanpa padding aman untuk URL.
5. `MessageDigest.isEqual` dipakai untuk mengurangi timing leak pada comparison.
6. Token expiry berada di domain model, bukan hanya di UI.

---

## 21. UUID Bukan Otomatis Security Token

UUID sering disalahgunakan sebagai token.

### 21.1 UUID v4

UUID v4 berbasis random, tetapi hanya sekitar 122 bit random karena beberapa bit dipakai untuk version/variant.

Untuk beberapa use case low/medium risk, UUID v4 dari source random kuat bisa acceptable. Tetapi ada caveat:

1. Tidak semua generator UUID dijamin cocok untuk high-value credential di semua platform/library.
2. 122 bit bisa cukup untuk banyak token, tetapi 256-bit opaque token lebih nyaman untuk reset/API secret high value.
3. UUID format mudah dikenali dan sering diperlakukan seperti ID, sehingga raw token bisa lebih mudah muncul di log/URL/path.
4. UUID sering dipakai sebagai entity identifier; mencampur identifier dan credential adalah desain buruk.

Prinsip:

```text
UUID boleh untuk identifier. Untuk bearer credential, prefer explicit SecureRandom token.
```

### 21.2 Sequential UUID/ULID

ULID, UUID v7, KSUID, Snowflake-like ID bagus untuk sorting/distribution. Tetapi karena mengandung timestamp atau sequence, jangan jadikan secret token.

Contoh salah:

```text
password reset token = ULID
```

ULID punya komponen timestamp yang mengurangi search space attacker jika dipakai sebagai credential.

---

## 22. Collision Probability: Birthday Problem

Jika kamu generate banyak random token, risiko collision naik bukan secara linear sederhana, tetapi mengikuti birthday bound.

Approximation:

```text
p ≈ n² / 2^(b+1)
```

Di mana:

- `p` = probabilitas collision,
- `n` = jumlah token yang dibuat,
- `b` = bit entropy.

Contoh kasar:

| Entropy | Jumlah token | Collision risk kasar |
|---:|---:|---:|
| 64 bit | 1 juta | sekitar 2.7e-8 |
| 64 bit | 1 miliar | sekitar 2.7% |
| 96 bit | 1 miliar | sekitar 6.3e-12 |
| 128 bit | 1 miliar | sekitar 1.5e-21 |
| 256 bit | 1 miliar | praktis nol |

Implikasi:

1. 64-bit token terlalu kecil untuk banyak sistem besar.
2. 96-bit nonce cukup untuk banyak mode jika lifecycle benar, tetapi bukan berarti ideal untuk semua bearer token.
3. 128-bit random token umumnya baseline bagus.
4. 256-bit token memberi margin sangat besar.

---

## 23. Collision Handling Tetap Harus Ada

Walaupun collision probability sangat kecil, sistem tetap harus robust.

Untuk token yang disimpan di DB:

1. Buat unique constraint pada `token_hash`.
2. Jika insert conflict, generate token baru.
3. Jangan abaikan conflict.

Contoh pseudo-flow:

```text
repeat up to 3:
  token = random(32 bytes)
  tokenHash = sha256(token)
  insert tokenHash unique
  if success return token
if still conflict throw infrastructure error
```

Kenapa?

Karena collision bukan satu-satunya penyebab conflict. Bisa juga:

- bug,
- replay issue,
- bad random provider,
- duplicate request,
- transaction retry,
- test fixture buruk.

Security-grade system tidak hanya mengandalkan probabilitas; ia juga memasang guardrail.

---

## 24. Randomness untuk Key Generation

Cryptographic key harus dibuat dari CSPRNG atau key generator yang menggunakan CSPRNG.

Untuk AES key:

```java
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;

public final class AesKeyFactory {
    public static SecretKey generateAes256Key(SecureRandom secureRandom) {
        try {
            KeyGenerator keyGenerator = KeyGenerator.getInstance("AES");
            keyGenerator.init(256, secureRandom);
            return keyGenerator.generateKey();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("AES is not available", e);
        }
    }
}
```

Jangan membuat key dari string biasa:

```java
byte[] key = "my-secret-key".getBytes(StandardCharsets.UTF_8); // salah
```

Jika key berasal dari password manusia, gunakan KDF/password hashing yang sesuai. Itu akan dibahas di Part 6.

---

## 25. Randomness untuk IV/Nonce AES-GCM

AES-GCM umum menggunakan 96-bit nonce.

Contoh konseptual:

```java
byte[] nonce = new byte[12]; // 96-bit
secureRandom.nextBytes(nonce);
```

Untuk banyak aplikasi dengan volume encryption moderat, random 96-bit nonce cukup praktis. Tetapi invariant tetap:

```text
Never reuse nonce with the same AES-GCM key.
```

Jika sistem mengenkripsi volume sangat besar dengan key yang sama, atau berjalan di banyak node, kamu harus mendesain nonce allocation dengan lebih hati-hati:

1. random nonce dengan collision monitoring,
2. per-node prefix + counter,
3. key rotation sebelum batas volume,
4. unique constraint pada metadata jika memungkinkan,
5. deterministic nonce allocator yang crash-safe.

Jangan generate nonce dari timestamp saja:

```java
byte[] nonce = ByteBuffer.allocate(12)
        .putLong(System.currentTimeMillis())
        .putInt(counter++)
        .array();
```

Ini rawan collision lintas node/restart jika tidak sangat hati-hati.

---

## 26. Randomness untuk Distributed Systems

Dalam single JVM, uniqueness lebih mudah. Dalam distributed system, tantangannya meningkat:

- banyak pod,
- autoscaling,
- restart,
- clock skew,
- duplicate deployment,
- snapshot restore,
- image clone,
- database retry,
- message replay,
- region split-brain.

Jika value harus unique secara global, jangan hanya mengandalkan local counter tanpa namespace.

Pattern:

```text
random high-entropy value + DB unique constraint
```

Atau:

```text
node unique prefix + monotonic counter + persistence + key separation
```

Untuk security token, random high-entropy jauh lebih sederhana daripada counter.

Untuk cryptographic nonce, tergantung volume dan mode. Counter bisa bagus jika benar-benar guaranteed unique per key, tetapi fatal jika reset.

---

## 27. Startup Entropy and Container Environments

Di masa lalu, Java services kadang mengalami startup delay karena entropy source blocking. Di environment modern, problem ini jauh lebih jarang, tetapi masih harus dipahami untuk container, VM, FIPS, dan hardened OS.

Hal yang perlu diperhatikan:

1. Jangan asal set `java.security.egd=file:/dev/./urandom` tanpa memahami JDK/OS modern.
2. Jangan downgrade random source demi mengatasi startup lambat tanpa security review.
3. Di container, pastikan host kernel entropy sehat.
4. Di FIPS environment, provider dan entropy source bisa berbeda.
5. Observability startup perlu membedakan “SecureRandom blocking” vs DNS/DB/config issue.

Prinsip:

```text
Jika startup lambat karena entropy, treat sebagai platform/security engineering issue, bukan alasan mengganti ke Random.
```

---

## 28. Randomness and Testing

Security randomness membuat test sulit jika test mengharapkan exact value. Jangan mengorbankan production code.

Buruk:

```java
SecureRandom random = new SecureRandom(new byte[] {1, 2, 3});
```

Lebih baik:

1. Extract interface untuk random byte generation.
2. Production implementation memakai `SecureRandom`.
3. Test implementation mengembalikan byte fixed.
4. Test property, bukan nilai acak production.

Contoh fake untuk test:

```java
public final class FixedRandomBytesSource implements RandomBytesSource {
    private final byte fill;

    public FixedRandomBytesSource(byte fill) {
        this.fill = fill;
    }

    @Override
    public void nextBytes(byte[] target) {
        Arrays.fill(target, fill);
    }
}
```

Test yang baik:

```text
- token length sesuai
- format URL-safe
- hash disimpan, plaintext tidak disimpan
- expiry benar
- consumed token tidak bisa dipakai ulang
- invalid token ditolak
```

Bukan:

```text
- token harus sama dengan string tertentu dari SecureRandom production
```

---

## 29. Jangan Log Random Secret

Token random sering bocor bukan karena generator lemah, tetapi karena logging.

Jangan log:

- reset token,
- email verification token,
- session id,
- API key,
- OAuth code,
- refresh token,
- CSRF token,
- raw nonce jika nonce dikaitkan dengan secret flow tertentu,
- generated key,
- seed,
- pepper.

Untuk troubleshooting, log metadata aman:

```text
purpose=PASSWORD_RESET
userId=...
tokenId=...
tokenHashPrefix=first8chars maybe only if policy allows
expiresAt=...
issuedBy=...
correlationId=...
```

Tetapi hati-hati: bahkan hash prefix bisa menjadi sensitive jika token entropy rendah. Untuk high entropy random token, hash prefix biasanya lebih aman, tetapi tetap perlu policy.

---

## 30. Case Study 1 — Password Reset Token yang Terlihat Aman tapi Lemah

Kode:

```java
String token = userId + "-" + System.currentTimeMillis() + "-" + new Random().nextInt(999999);
```

Masalah:

1. `userId` sering diketahui.
2. Timestamp bisa ditebak dari waktu request.
3. `Random` bukan CSPRNG.
4. Search space `999999` kecil.
5. Token mungkin tersimpan plaintext.
6. Tidak jelas single-use.
7. Tidak jelas expiry.

Desain lebih baik:

```text
- Generate 32 bytes with SecureRandom.
- Encode base64url.
- Store hash(token) with purpose, userId, expiry, consumedAt.
- Send token once.
- On use, compare hash, check purpose, expiry, consumedAt.
- Mark consumed in same transaction.
```

Security invariant:

```text
An attacker who can guess userId and request time still cannot derive a valid reset token.
```

---

## 31. Case Study 2 — AES-GCM Nonce Reuse Karena Pod Restart

Scenario:

```text
Service encrypts records with AES-GCM.
Nonce = local AtomicLong counter encoded as 12 bytes.
Key = same for all pods.
Pod restarts -> counter starts at 0 again.
```

Masalah:

- Nonce reused with same key.
- AES-GCM security breaks under nonce reuse.
- Unit test tidak menangkap karena single JVM run.
- Production autoscaling membuat collision.

Solusi:

1. Use random 96-bit nonce for moderate volume.
2. Or allocate durable counter per key.
3. Or include unique node prefix assigned durably.
4. Rotate key before nonce space risk grows.
5. Store nonce with ciphertext.
6. Add monitoring/unique constraint if feasible.

Security invariant:

```text
For each AES-GCM key, no nonce value may be used more than once.
```

---

## 32. Case Study 3 — CSRF Token yang Bisa Ditebak

Kode:

```java
String csrf = session.getId() + ":" + LocalDate.now();
```

Masalah:

1. Token derived dari session id.
2. Jika session id bocor di log, CSRF token bisa dibuat.
3. Date predictable.
4. Tidak ada independent randomness.
5. Token mungkin reusable terlalu lama.

Lebih baik:

```text
CSRF token = independent high-entropy SecureRandom token bound to session/user/action policy
```

Security invariant:

```text
Knowledge of user identity, date, or request pattern must not allow attacker to forge CSRF token.
```

---

## 33. Case Study 4 — Temporary File Name Predictability

Kode:

```java
Path path = Path.of("/tmp/upload-" + userId + "-" + System.currentTimeMillis());
```

Masalah:

- Path predictable.
- Race condition/symlink attack possible depending context.
- User-controlled influence.
- File overwrite risk.

Lebih baik:

```java
Path tempFile = Files.createTempFile("upload-", ".bin");
```

Atau untuk security-sensitive flow, combine OS temp API, directory permission, atomic create, and random suffix.

Security invariant:

```text
Attacker must not be able to predict or pre-create the path used for sensitive temporary file writes.
```

---

## 34. Common Anti-Patterns

### 34.1 `Random` for Token

```java
new Random().nextLong()
```

Masalah: predictable PRNG.

### 34.2 Timestamp as Random

```java
System.nanoTime()
```

Masalah: timestamp bukan secret.

### 34.3 Hashing Predictable Data

```java
sha256(userId + timestamp)
```

Masalah: hash tidak menciptakan entropy baru.

### 34.4 Base64 as Security

```java
Base64.encode(userId + ":" + timestamp)
```

Masalah: encoding bukan encryption, bukan randomness.

### 34.5 Reusing IV/Nonce

```text
same key + same nonce = broken for many modes
```

### 34.6 Fixed IV

```java
byte[] iv = new byte[16];
```

Masalah: deterministic encryption pattern leak; fatal di mode tertentu.

### 34.7 Global Salt

```text
salt = applicationName
```

Masalah: bukan salt per credential.

### 34.8 UUID for Everything

```text
resetToken = UUID.randomUUID()
```

Masalah: mungkin acceptable untuk beberapa risk level, tetapi sering lebih baik pakai explicit 256-bit token dan hash storage.

### 34.9 Logging Secret Token

```java
log.info("Issued reset token {}", token);
```

Masalah: token bocor ke log aggregation.

### 34.10 Deterministic SecureRandom in Production

```java
new SecureRandom(fixedSeed)
```

Masalah: output predictable/reproducible.

---

## 35. Design Decision Matrix

| Use case | Butuh unpredictable? | Butuh unique? | Secret disimpan? | Rekomendasi |
|---|---:|---:|---:|---|
| AES key | Ya | Ya secara probabilistik | Ya | `KeyGenerator` + `SecureRandom`/approved provider. |
| AES-GCM nonce | Tidak harus | Ya per key | Tidak | 96-bit random atau durable counter design. |
| Password salt | Tidak harus secret | Ya per credential | Tidak | 16+ byte random. |
| Password reset token | Ya | Ya | Store hash only | 32 byte `SecureRandom`, base64url, expiry, single-use. |
| Session id | Ya | Ya | Server-side/session store | Framework/session manager yang secure; jangan custom sembarangan. |
| CSRF token | Ya | Ya per session/action policy | Server/session-bound | 16–32 byte random. |
| OAuth state | Ya | Ya per flow | Bound to browser session | 16–32 byte random. |
| PKCE verifier | Ya | Ya per auth flow | Client-side temporary | Generate per spec with CSPRNG. |
| Public entity ID | Tidak selalu | Ya | Tidak | UUID/ULID acceptable, tapi jangan sebagai credential. |
| Temporary file suffix | Ya jika path sensitive | Ya | Tidak | OS temp API + secure permissions. |

---

## 36. SecureRandom Utility yang Lebih Aman

Contoh utility minimal dengan guardrail:

```java
import java.security.SecureRandom;
import java.util.Base64;
import java.util.Objects;

public final class RandomSecurity {
    private static final int MIN_SECURITY_TOKEN_BYTES = 16;

    private final SecureRandom secureRandom;

    public RandomSecurity(SecureRandom secureRandom) {
        this.secureRandom = Objects.requireNonNull(secureRandom);
    }

    public byte[] bytes(int length) {
        if (length <= 0) {
            throw new IllegalArgumentException("length must be positive");
        }
        byte[] bytes = new byte[length];
        secureRandom.nextBytes(bytes);
        return bytes;
    }

    public String urlSafeToken(int byteLength) {
        if (byteLength < MIN_SECURITY_TOKEN_BYTES) {
            throw new IllegalArgumentException("security token requires at least 16 bytes");
        }
        return Base64.getUrlEncoder()
                .withoutPadding()
                .encodeToString(bytes(byteLength));
    }

    public byte[] aesGcmNonce96() {
        return bytes(12);
    }

    public byte[] passwordSalt128() {
        return bytes(16);
    }
}
```

Review note:

- Method names membawa semantic intent.
- `urlSafeToken` mencegah token terlalu kecil.
- AES-GCM nonce dipisahkan dari token agar engineer tidak menyamakan requirement.
- Salt dipisahkan agar mudah direview.

---

## 37. Token Domain Model

Jangan hanya menyimpan token sebagai string. Buat domain model yang memaksa lifecycle.

Contoh table konseptual:

```sql
CREATE TABLE security_token (
    id                VARCHAR(36) PRIMARY KEY,
    token_hash        VARCHAR(64) NOT NULL UNIQUE,
    purpose           VARCHAR(64) NOT NULL,
    subject_type      VARCHAR(64) NOT NULL,
    subject_id        VARCHAR(128) NOT NULL,
    issued_at         TIMESTAMP NOT NULL,
    expires_at        TIMESTAMP NOT NULL,
    consumed_at       TIMESTAMP NULL,
    revoked_at        TIMESTAMP NULL,
    issued_ip_hash    VARCHAR(64) NULL,
    user_agent_hash   VARCHAR(64) NULL
);
```

Verification invariant:

```text
Token valid iff:
- hash matches,
- purpose matches,
- subject matches expected boundary,
- now < expiresAt,
- consumedAt is null,
- revokedAt is null,
- any additional binding policy passes.
```

Consume harus atomic:

```sql
UPDATE security_token
SET consumed_at = CURRENT_TIMESTAMP
WHERE token_hash = ?
  AND purpose = ?
  AND consumed_at IS NULL
  AND revoked_at IS NULL
  AND expires_at > CURRENT_TIMESTAMP;
```

Jika affected rows = 1, token berhasil dipakai. Jika 0, token invalid/expired/already used.

---

## 38. Randomness Review Checklist

Gunakan checklist ini saat code review.

### 38.1 Source

- Apakah semua security-sensitive random memakai `SecureRandom`?
- Apakah ada `Random`, `Math.random`, `ThreadLocalRandom`, `SplittableRandom` di security path?
- Apakah `SecureRandom` dibuat dengan seed fixed/user-controlled?
- Apakah provider/algorithm sesuai compliance requirement?

### 38.2 Length

- Berapa byte random yang dibuat?
- Apakah entropy cukup untuk use case?
- Apakah token minimal 128 bit entropy?
- Untuk high-value credential, apakah 192/256 bit lebih tepat?

### 38.3 Semantic

- Apakah value ini key, token, salt, nonce, IV, challenge, atau identifier?
- Apakah requirement-nya unpredictability, uniqueness, atau keduanya?
- Apakah developer menyamakan salt dengan nonce/token?
- Apakah UUID dipakai sebagai bearer credential?

### 38.4 Lifecycle

- Apakah token punya expiry?
- Apakah token single-use jika workflow membutuhkan?
- Apakah token bisa revoked?
- Apakah plaintext token disimpan?
- Apakah token muncul di log/metric/error?

### 38.5 Distributed Safety

- Apakah uniqueness tetap aman lintas pod/node/restart/region?
- Apakah counter persistent jika dipakai sebagai nonce?
- Apakah ada risk snapshot restore mengulang state random/counter?
- Apakah ada DB unique constraint untuk token hash?

### 38.6 Crypto Mode

- Untuk IV/nonce, apakah requirement sesuai mode encryption?
- Apakah AES-GCM nonce unique per key?
- Apakah CBC IV unpredictable?
- Apakah nonce disimpan bersama ciphertext?
- Apakah key rotation mempertimbangkan nonce space?

---

## 39. Failure Modes yang Harus Diingat

| Failure | Root cause | Impact |
|---|---|---|
| Predictable reset token | Timestamp + weak PRNG | Account takeover. |
| Session hijack | Session id low entropy/logged | Impersonation. |
| AES-GCM nonce reuse | Counter reset/distributed collision | Confidentiality/integrity collapse. |
| Duplicate salt | Fixed/global salt | Easier password cracking correlation. |
| Token leaked in logs | Unsafe logging | Credential compromise. |
| Weak API key | Too short/random wrong | Brute force feasible. |
| Deterministic key | Fixed seed/password raw | Decryption/signing compromise. |
| UUID as credential | Identifier treated as secret | Guessability/logging/design confusion. |
| Collision not handled | No unique constraint | Token aliasing/logic corruption. |
| Insecure test pattern copied | Fixed SecureRandom seed | Production predictability. |

---

## 40. Practical Rules of Thumb

1. Security random berarti `SecureRandom`, bukan `Random`.
2. Jangan seed `SecureRandom` dengan value buatan sendiri untuk production.
3. Token security minimal 16 byte random; prefer 32 byte untuk high-value flow.
4. Encoding bukan entropy.
5. Hash tidak menciptakan entropy baru.
6. Salt tidak secret; pepper secret.
7. Nonce tidak selalu secret, tetapi sering harus unique per key.
8. IV requirement tergantung encryption mode.
9. UUID bagus untuk ID, bukan default untuk credential.
10. Store reset/API/invitation token as hash, not plaintext.
11. Jangan log token, key, seed, pepper, credential.
12. Pasang unique constraint walaupun collision probability kecil.
13. Distributed system memperbesar risiko nonce/counter reuse.
14. Performance bukan alasan memakai PRNG non-security untuk security path.
15. Testability harus dicapai dengan abstraction, bukan melemahkan production randomness.

---

## 41. Mini Exercise

### Exercise 1

Kamu menemukan kode:

```java
String token = DigestUtils.sha256Hex(userId + System.currentTimeMillis());
```

Pertanyaan:

1. Apakah token ini random?
2. Apa entropy source-nya?
3. Apa yang bisa ditebak attacker?
4. Bagaimana desain ulangnya?

Jawaban yang diharapkan:

- Token bukan random secara security.
- Entropy hampir nol jika userId dan waktu bisa ditebak.
- Hash tidak menambah entropy.
- Gunakan 32 byte `SecureRandom`, base64url, store hash, expiry, single-use.

### Exercise 2

Kamu melihat AES-GCM encryption service:

```java
byte[] nonce = ByteBuffer.allocate(12)
    .putLong(Instant.now().toEpochMilli())
    .putInt(new Random().nextInt())
    .array();
```

Pertanyaan:

1. Apa invariant nonce AES-GCM?
2. Apakah kode ini menjamin invariant tersebut?
3. Bagaimana failure terjadi lintas pod?
4. Apa opsi desain lebih aman?

Jawaban yang diharapkan:

- Nonce unique per key.
- Kode tidak menjamin uniqueness.
- Pod dapat menghasilkan timestamp sama dan random lemah/collision.
- Gunakan random 96-bit dari `SecureRandom` untuk moderate volume atau durable counter/prefix strategy.

### Exercise 3

Sistem menyimpan reset token plaintext di DB.

Pertanyaan:

1. Apa impact jika DB read-only bocor?
2. Kenapa hash token lebih baik?
3. Kenapa SHA-256 cukup untuk random token tetapi tidak cukup untuk password?

Jawaban yang diharapkan:

- Attacker bisa langsung pakai token.
- Hash membuat DB leak tidak langsung usable.
- Token 256-bit punya entropy tinggi; password manusia entropy rendah sehingga butuh slow password hashing.

---

## 42. Production Checklist

Sebelum release fitur yang memakai random value, pastikan:

```text
[ ] Semua security-sensitive random memakai SecureRandom atau approved provider.
[ ] Tidak ada fixed/user-controlled seed di production.
[ ] Token memiliki minimal 128-bit entropy; high-value token 256-bit.
[ ] Token URL-safe memakai base64url tanpa data sensitif embedded.
[ ] Token disimpan sebagai hash jika bertindak sebagai credential.
[ ] Token punya purpose, scope, expiry, revocation/consumed state.
[ ] Token verification atomic untuk single-use flow.
[ ] IV/nonce memenuhi requirement encryption mode.
[ ] AES-GCM nonce tidak reuse untuk key yang sama.
[ ] Salt unique per credential dan tidak dianggap secret.
[ ] Secret random value tidak muncul di log, metric, exception, audit payload.
[ ] Collision handling ada melalui unique constraint/retry.
[ ] Distributed deployment tidak mengulang counter/nonce setelah restart.
[ ] Test deterministic tidak melemahkan production randomness.
[ ] Security review mencatat invariant random-related.
```

---

## 43. Ringkasan

Randomness adalah security primitive yang sering diremehkan. Dalam Java, jawaban API-nya sering sederhana: gunakan `SecureRandom`. Tetapi engineering problem-nya jauh lebih luas:

- value apa yang sedang dibuat,
- property apa yang dibutuhkan,
- berapa entropy yang cukup,
- apakah value harus secret atau hanya unique,
- apakah uniqueness berlaku per key, per user, per flow, atau global,
- bagaimana lifecycle token,
- bagaimana distributed system bisa mengulang nilai,
- bagaimana failure terlihat di production,
- dan bagaimana code review menangkap misuse.

Mental model paling penting dari part ini:

```text
Randomness bukan tentang membuat nilai terlihat acak.
Randomness adalah tentang mempertahankan invariant security:
attacker tidak bisa menebak, mengulang, atau menghubungkan nilai yang seharusnya tidak bisa ditebak, diulang, atau dihubungkan.
```

Di part berikutnya kita akan masuk ke **Hashing, Digest, Fingerprint, Checksum, and Integrity Boundaries**. Di sana kita akan membedakan hash untuk integrity, checksum, fingerprint, deduplication, password-adjacent design, streaming digest, canonicalization, dan hash-chain sebagai fondasi audit/integrity system.

---

# Status Seri

Seri `learn-java-security-cryptography-integrity` belum selesai.

Progress saat ini:

- [x] Part 0 — Security Mental Model for Senior Java Engineers
- [x] Part 1 — Java Security Architecture: JCA, JCE, JAAS, JSSE, JGSS, SASL, CertPath
- [x] Part 2 — Threat Modeling for Java Systems
- [x] Part 3 — Cryptography Mental Model: What Crypto Can and Cannot Guarantee
- [x] Part 4 — Randomness, Entropy, Nonce, Salt, IV, Token
- [ ] Part 5 — Hashing, Digest, Fingerprint, Checksum, and Integrity Boundaries
- [ ] Part 6 — Password Storage, Password Verification, and Secret-Derived Keys
- [ ] Part 7 — Symmetric Encryption in Java: AES, Modes, Padding, AEAD
- [ ] Part 8 — Message Authentication Code: HMAC, CMAC, and Integrity Tokens
- [ ] Part 9 — Digital Signature: RSA, ECDSA, EdDSA, Signing Semantics
- [ ] Part 10 — Asymmetric Encryption and Key Agreement
- [ ] Part 11 — Key Management: Lifecycle, Rotation, Wrapping, KMS, HSM
- [ ] Part 12 — Java KeyStore, TrustStore, Certificates, and Private Key Custody
- [ ] Part 13 — X.509, PKI, Certificate Path Validation, Revocation
- [ ] Part 14 — TLS/JSSE Deep Dive for Java Engineers
- [ ] Part 15 — TLS Hardening, Disabled Algorithms, and Runtime Security Properties
- [ ] Part 16 — Secure Serialization, Deserialization, and Object Integrity
- [ ] Part 17 — Secure File, Archive, and Data Transfer Integrity
- [ ] Part 18 — XML Security, XXE, XML Signature, XML Encryption
- [ ] Part 19 — JSON, JWT, JWS, JWE, JOSE, and Token Integrity
- [ ] Part 20 — OAuth2/OIDC Security for Java Systems Without Repeating Jakarta/JAX-RS
- [ ] Part 21 — Authorization Integrity: Policy, Permission, and Confused Deputy
- [ ] Part 22 — Input Validation, Canonicalization, Injection Resistance
- [ ] Part 23 — Secure Coding in Java: Dangerous APIs, Footguns, and Review Heuristics
- [ ] Part 24 — Secrets Management in Java Applications
- [ ] Part 25 — Secure Logging, Audit Trail Integrity, Evidence, and Non-Repudiation
- [ ] Part 26 — Data Integrity in Distributed Java Systems
- [ ] Part 27 — Supply Chain Security for Java: Maven, Gradle, SBOM, Provenance
- [ ] Part 28 — Signed JARs, JAR Integrity, Classloading, and Runtime Trust
- [ ] Part 29 — Secure Build, CI/CD, and Release Integrity for Java
- [ ] Part 30 — Runtime Hardening: JVM, Container, OS, Network
- [ ] Part 31 — Security Testing: Unit, Property, Fuzzing, SAST, DAST, IAST
- [ ] Part 32 — Incident Response for Java Security Failures
- [ ] Part 33 — Secure Design Patterns and Anti-Patterns for Java Enterprise Systems
- [ ] Part 34 — Capstone: Designing a Secure Java Regulatory Case Management Platform

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 3 — Cryptography Mental Model: What Crypto Can and Cannot Guarantee](./learn-java-security-cryptography-integrity-part-003.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Hashing, Digest, Fingerprint, Checksum, and Integrity Boundaries](./learn-java-security-cryptography-integrity-part-005.md)
