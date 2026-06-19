# learn-java-authentication-modes-and-patterns-part-003

# Part 3 — Password Authentication Done Properly

> Seri: **Java Authentication Modes and Patterns**  
> Target: Java 8 sampai Java 25  
> Level: Advanced / Production Engineering  
> Fokus: password authentication sebagai credential lifecycle, bukan sekadar hashing

---

## 0. Posisi Part Ini Dalam Series

Part 0 membangun peta besar authentication sebagai proses membuktikan identitas aktor.

Part 1 membahas fondasi runtime Java: `Subject`, `Principal`, credential, `LoginContext`, `LoginModule`, dan konteks identitas.

Part 2 membangun taxonomy: authentication berdasarkan jenis bukti, trust model, state model, dan failure model.

Part 3 sekarang masuk ke salah satu mode authentication paling tua tetapi masih sangat sering dipakai: **password authentication**.

Password authentication tampak sederhana:

```text
user memasukkan username + password
server mengecek password
kalau cocok, user dianggap authenticated
```

Namun di production, password authentication bukan hanya satu langkah pengecekan. Ia adalah sistem lengkap yang melibatkan:

1. credential enrollment,
2. password policy,
3. password hashing,
4. salt,
5. optional pepper,
6. verification,
7. throttling,
8. lockout,
9. reset flow,
10. session creation,
11. password migration,
12. breach response,
13. audit,
14. operational tuning,
15. incident recovery.

Kesalahan umum engineer adalah menganggap password authentication selesai ketika sudah memakai bcrypt. Itu hanya satu bagian kecil dari sistem.

Mental model yang harus dibawa dari part ini:

> Password authentication adalah proses membandingkan **secret yang user tahu** dengan **verifier yang server simpan**, sambil meminimalkan dampak ketika database, log, application server, atau flow recovery bocor.

---

## 1. Problem Yang Diselesaikan Password Authentication

Password authentication menjawab pertanyaan:

```text
Apakah claimant yang sedang mencoba login mengetahui secret yang sebelumnya diasosiasikan dengan account ini?
```

Istilah penting:

| Istilah | Arti |
|---|---|
| Claimant | Pihak yang mengklaim identitas saat login |
| Subscriber / account holder | Pemilik account yang terdaftar |
| Credential | Bukti authentication, dalam kasus ini password |
| Verifier | Server atau komponen yang memverifikasi credential |
| Password verifier | Bentuk password yang sudah diproses untuk disimpan, misalnya hash bcrypt/Argon2id |
| Authentication event | Kejadian saat klaim identitas diverifikasi |

Password authentication tidak membuktikan bahwa orang di depan layar benar-benar pemilik identitas biologis/legal. Password hanya membuktikan bahwa claimant mengetahui secret yang diasosiasikan dengan account.

Artinya, kalau password dicuri, sistem tidak bisa secara matematis membedakan antara pemilik sah dan attacker.

Karena itu password authentication harus selalu dilihat sebagai:

```text
knowledge-based authentication with high theft risk
```

Bukan:

```text
strong identity proof
```

---

## 2. Mengapa Password Authentication Sulit

Password buruk bukan hanya karena user memilih password lemah. Password sulit karena seluruh lifecycle-nya rapuh.

### 2.1 User Memilih Secret Yang Mudah Ditebak

User cenderung memilih password yang:

1. pendek,
2. berbasis kata umum,
3. memakai pola keyboard,
4. mengandung nama/tanggal,
5. reuse dari sistem lain,
6. sedikit dimodifikasi dari password lama.

Contoh pola lemah:

```text
Password123!
Company2026!
Jakarta@123
Qwerty12345
Welcome2026
```

Complexity rule tradisional sering gagal karena user hanya memenuhi aturan minimum.

Misalnya aturan:

```text
minimal 8 karakter
harus ada huruf besar
harus ada angka
harus ada simbol
```

sering menghasilkan password seperti:

```text
Password1!
Summer2026!
Admin@123
```

Secara aturan valid, secara keamanan buruk.

### 2.2 Password Sering Dipakai Ulang

Jika user memakai password sama di banyak layanan, kebocoran di layanan A bisa dipakai untuk menyerang layanan B.

Ini disebut:

```text
credential stuffing
```

Flow attacker:

```text
1. attacker memperoleh dump email/password dari breach lain
2. attacker mencoba kombinasi itu di aplikasi kita
3. sebagian user berhasil login karena password reuse
4. attacker mengambil alih account
```

Dalam situasi ini, hash password internal kita mungkin aman, tetapi account tetap bisa diambil alih karena password user bocor dari tempat lain.

### 2.3 Database Bisa Bocor

Desain password storage harus mengasumsikan bahwa suatu saat database bisa terbaca oleh pihak tidak sah.

Pertanyaan desainnya bukan:

```text
Bagaimana supaya database tidak pernah bocor?
```

Tetapi:

```text
Jika database bocor, seberapa mahal attacker mengubah password verifier menjadi password asli?
```

Itulah fungsi password hashing lambat seperti Argon2id, bcrypt, scrypt, atau PBKDF2.

### 2.4 Application Log Bisa Bocor

Password bisa bocor bukan hanya dari database. Ia bisa bocor dari:

1. access log,
2. debug log,
3. exception trace,
4. request body logging,
5. APM capture,
6. reverse proxy log,
7. browser autocomplete issue,
8. support screenshot,
9. audit payload,
10. dead-letter queue.

Password field tidak boleh masuk log dalam bentuk apa pun.

### 2.5 Reset Flow Sering Menjadi Backdoor

Password login bisa kuat, tetapi reset flow lemah.

Contoh:

```text
login password: bcrypt + MFA + rate limit
reset password: email OTP 6 digit, no rate limit, token valid 24 jam
```

Attacker tidak menyerang login. Attacker menyerang reset.

Rule penting:

> Password reset adalah authentication flow alternatif. Treat it with the same seriousness as login.

### 2.6 Operational Tuning Sulit

Password hashing harus lambat untuk attacker, tetapi tidak boleh terlalu lambat untuk server.

Jika hashing terlalu cepat:

```text
attacker mudah brute force dump hash
```

Jika hashing terlalu lambat:

```text
login storm bisa menghabiskan CPU
```

Jadi ada trade-off antara:

1. attacker cost,
2. user latency,
3. CPU capacity,
4. memory capacity,
5. horizontal scaling,
6. denial-of-service resistance.

---

## 3. Password Authentication Sebagai State Machine

Cara terbaik memahami password authentication adalah sebagai state machine account + credential.

### 3.1 Account State

Contoh account state:

```text
REGISTERED
EMAIL_UNVERIFIED
ACTIVE
PASSWORD_EXPIRED
TEMP_LOCKED
ADMIN_LOCKED
COMPROMISED
RESET_PENDING
DISABLED
DELETED
```

### 3.2 Credential State

Credential password juga punya state:

```text
NO_PASSWORD
ACTIVE_PASSWORD
TEMPORARY_PASSWORD
PASSWORD_RESET_REQUIRED
PASSWORD_EXPIRED
PASSWORD_COMPROMISED
PASSWORD_HASH_LEGACY
PASSWORD_HASH_CURRENT
PASSWORD_ROTATION_PENDING
```

### 3.3 Authentication Attempt State

Setiap login attempt juga stateful:

```text
RECEIVED
NORMALIZED_IDENTIFIER
ACCOUNT_LOOKUP_DONE
POLICY_CHECKED
PASSWORD_VERIFIED
RISK_EVALUATED
MFA_REQUIRED
AUTHENTICATED
SESSION_CREATED
FAILED
AUDITED
```

### 3.4 Kenapa Ini Penting

Banyak bug authentication berasal dari state yang tidak eksplisit.

Contoh bug:

```text
user berhasil verifikasi password
account ternyata DISABLED
sistem tetap membuat session
```

Atau:

```text
user password valid
account PASSWORD_RESET_REQUIRED
sistem tetap memberi access token penuh
```

Atau:

```text
user sedang TEMP_LOCKED
sistem tetap menjalankan password hash verification mahal
attacker bisa DoS CPU
```

State machine membantu kita membuat invariants.

Contoh invariant:

```text
A session must never be created unless:
- account state allows authentication
- credential state allows authentication
- password verification succeeds
- risk policy permits continuation
- required second factor is satisfied when applicable
```

---

## 4. Password Storage: Yang Tidak Boleh Dilakukan

Sebelum membahas desain yang benar, kita harus jelas tentang anti-pattern.

### 4.1 Menyimpan Plain Text Password

Tidak boleh:

```text
users.password = "MyPassword123!"
```

Jika database bocor, semua password langsung bocor.

### 4.2 Menyimpan Encrypted Password

Banyak engineer berpikir:

```text
kalau password dienkripsi AES, aman
```

Masalahnya: jika aplikasi bisa decrypt password, maka attacker yang mendapatkan key juga bisa decrypt.

Password authentication tidak membutuhkan password asli. Yang dibutuhkan hanya kemampuan memverifikasi input.

Jadi password harus disimpan sebagai one-way verifier, bukan ciphertext reversible.

Tidak boleh:

```text
password_ciphertext = AES.encrypt(password, key)
```

Kecuali ada requirement sangat khusus di luar authentication, menyimpan password dalam bentuk yang bisa dikembalikan adalah desain buruk.

### 4.3 Hash Cepat Seperti SHA-256

Tidak boleh:

```java
hash = SHA256(password)
```

Juga tidak cukup:

```java
hash = SHA256(salt + password)
```

Masalahnya bukan SHA-256 sebagai primitive cryptographic. Masalahnya SHA-256 terlalu cepat untuk password guessing.

Attacker dengan GPU/ASIC bisa mencoba banyak kandidat per detik.

Password hashing harus sengaja lambat dan idealnya memory-hard.

### 4.4 Static Salt

Tidak boleh:

```text
hash = bcrypt(globalSalt + password)
```

Salt harus unik per password, bukan satu salt global untuk semua user.

Salt bertujuan agar password yang sama menghasilkan verifier yang berbeda antar user.

### 4.5 Custom Hashing Scheme

Tidak boleh membuat skema sendiri seperti:

```text
SHA512(SHA256(password) + reverse(username) + secret + timestamp)
```

Custom scheme biasanya gagal karena:

1. tidak cukup lambat,
2. tidak memory-hard,
3. sulit diverifikasi oleh library standar,
4. tidak punya format upgrade jelas,
5. sulit diaudit,
6. rawan bug encoding.

Gunakan algorithm dan library yang sudah matang.

---

## 5. Password Hashing Mental Model

Password hashing berbeda dari general hashing.

General hash seperti SHA-256 didesain untuk:

```text
cepat, deterministik, collision-resistant
```

Password hashing didesain untuk:

```text
lambat, salted, tunable, resistant terhadap brute force
```

### 5.1 Input dan Output

Input:

```text
password + salt + cost parameters + optional pepper
```

Output:

```text
encoded password verifier
```

Biasanya output menyimpan metadata:

```text
algorithm id
cost parameter
salt
hash output
```

Contoh format bcrypt:

```text
$2a$12$<22-char-salt><31-char-hash>
```

Contoh format Spring DelegatingPasswordEncoder:

```text
{bcrypt}$2a$12$...
{argon2}$argon2id$v=19$m=...,t=...,p=...$...
{pbkdf2}...
```

Format yang membawa algorithm id sangat penting untuk migration.

### 5.2 Verifikasi

Password verification bukan decrypt.

Flow:

```text
1. ambil encoded password verifier dari database
2. parse algorithm + parameter + salt
3. hash ulang candidate password dengan parameter yang sama
4. compare output dengan constant-time comparison
5. jika cocok, password valid
```

Pseudo-code:

```java
boolean verify(char[] candidatePassword, String storedVerifier) {
    PasswordHashSpec spec = PasswordHashSpec.parse(storedVerifier);
    byte[] candidateHash = hash(candidatePassword, spec.salt(), spec.parameters());
    return constantTimeEquals(candidateHash, spec.hash());
}
```

### 5.3 Kenapa Salt Tidak Rahasia

Salt bukan secret.

Salt boleh disimpan bersama hash.

Fungsinya:

1. membuat hash password sama menjadi berbeda,
2. membuat precomputed rainbow table tidak efektif,
3. membuat attacker harus menyerang tiap hash secara individual.

Salt tidak menggantikan password hashing lambat.

### 5.4 Kenapa Pepper Berbeda Dari Salt

Pepper adalah secret tambahan yang disimpan terpisah dari database.

Contoh:

```text
hash = Argon2id(password + pepper, salt, params)
```

Atau:

```text
hash = HMAC(pepperKey, Argon2id(password, salt, params))
```

Perbedaan:

| Aspek | Salt | Pepper |
|---|---|---|
| Unik per password | Ya | Biasanya global atau per environment |
| Rahasia | Tidak | Ya |
| Disimpan di DB | Ya | Tidak seharusnya |
| Fungsi utama | Mencegah precomputed attack | Mengurangi dampak DB-only breach |
| Rotasi mudah | Tidak perlu | Sulit, perlu desain |

Pepper membantu jika database bocor tetapi secret store tidak bocor.

Namun pepper bukan pengganti hashing kuat.

---

## 6. Algorithm Choices: Argon2id, bcrypt, scrypt, PBKDF2

Menurut praktik modern yang direkomendasikan OWASP, password harus disimpan dengan algorithm hashing lambat seperti Argon2id, bcrypt, scrypt, atau PBKDF2. Fast hash seperti SHA-256 tidak cocok untuk password storage karena terlalu cepat untuk guessing attack.

### 6.1 Argon2id

Argon2id adalah pilihan modern yang kuat karena memory-hard.

Karakteristik:

1. memiliki memory cost,
2. memiliki time cost,
3. memiliki parallelism parameter,
4. dirancang untuk menyulitkan GPU/ASIC cracking,
5. cocok untuk sistem baru bila library tersedia dan matang.

Kelebihan:

1. defense lebih baik terhadap hardware cracking,
2. parameter lebih ekspresif,
3. menjadi rekomendasi modern banyak guidance.

Kekurangan:

1. tidak built-in di JDK standar,
2. butuh library eksternal,
3. memory cost harus dituning hati-hati,
4. deployment di constrained environment perlu perhatian.

Kapan cocok:

```text
sistem baru, security-sensitive, bisa memakai library terpercaya, punya kapasitas memory/CPU cukup
```

### 6.2 bcrypt

bcrypt masih sangat umum dan matang.

Karakteristik:

1. adaptive cost,
2. salt built-in dalam encoded format,
3. output format matang,
4. library tersedia luas,
5. ada batas praktis input password sekitar 72 byte pada banyak implementasi.

Kelebihan:

1. battle-tested,
2. mudah dioperasikan,
3. cocok untuk migration dari sistem lama,
4. supported oleh Spring Security.

Kekurangan:

1. tidak memory-hard seperti Argon2id,
2. batas input perlu dipahami,
3. cost tinggi bisa menjadi CPU bottleneck.

Kapan cocok:

```text
sistem enterprise umum, migration praktis, butuh compatibility luas
```

### 6.3 scrypt

scrypt juga memory-hard.

Kelebihan:

1. lebih kuat daripada hash CPU-only dalam menghadapi hardware cracking,
2. sudah lama dikenal.

Kekurangan:

1. operational tuning tidak selalu sederhana,
2. support library/framework lebih tidak seuniversal bcrypt,
3. Argon2id sering menjadi pilihan modern yang lebih umum untuk sistem baru.

Kapan cocok:

```text
sistem yang sudah memakai scrypt dengan parameter kuat dan implementasi matang
```

### 6.4 PBKDF2

PBKDF2 tersedia di Java Cryptography Architecture sejak lama melalui `SecretKeyFactory` dan umum dipakai pada environment yang membutuhkan algorithm FIPS-friendly.

Karakteristik:

1. CPU-hard, bukan memory-hard,
2. memakai iterasi besar,
3. built-in tersedia di banyak JDK,
4. bisa memakai HMAC-SHA256/SHA512 tergantung provider.

Kelebihan:

1. tersedia luas,
2. cocok untuk compliance tertentu,
3. mudah dioperasikan tanpa library tambahan.

Kekurangan:

1. kurang kuat terhadap GPU dibanding memory-hard KDF,
2. butuh iteration count tinggi,
3. performa login bisa menjadi mahal.

Kapan cocok:

```text
environment ketat yang hanya membolehkan primitive standar/JDK/provider tertentu
```

### 6.5 Decision Matrix

| Kondisi | Pilihan Umum |
|---|---|
| Sistem baru, bisa pakai library matang | Argon2id |
| Enterprise compatibility tinggi | bcrypt |
| Sudah ada scrypt kuat | Pertahankan + rencanakan evaluasi |
| FIPS/compliance/JDK-only constraint | PBKDF2-HMAC-SHA256/SHA512 |
| Legacy SHA/MD5 | Migrasi secepatnya |
| Password perlu didecrypt | Revisit requirement; biasanya desain salah |

---

## 7. Java 8–25 Relevance

Password authentication di Java dipengaruhi oleh versi Java dan ecosystem library.

### 7.1 Java 8

Java 8 masih banyak dipakai di legacy enterprise.

Yang tersedia:

1. JCA/JCE,
2. `SecretKeyFactory`,
3. `PBEKeySpec`,
4. PBKDF2 provider tergantung JDK/provider,
5. Servlet/Spring Security era lama,
6. JAAS masih tersedia.

Keterbatasan umum:

1. tidak ada Argon2 built-in,
2. banyak aplikasi masih memakai SHA-1/SHA-256 custom,
3. password encoder legacy Spring lama mungkin masih ada,
4. dependency upgrade sering terkunci.

Strategi Java 8:

```text
Gunakan library password hashing matang seperti Spring Security Crypto atau library Argon2/bcrypt terpercaya.
Jika compliance membatasi dependency, gunakan PBKDF2 dengan parameter kuat dan format versi yang bisa dimigrasikan.
```

### 7.2 Java 11–17

Java 11/17 sering menjadi baseline enterprise modern.

Yang berubah secara praktis:

1. TLS/security provider lebih modern,
2. library support lebih baik,
3. Spring Boot 2/3 migration umum,
4. Jakarta namespace mulai relevan di Java 17+ stack modern.

Strategi:

```text
Gunakan DelegatingPasswordEncoder untuk migration.
Pilih bcrypt/Argon2id sesuai library maturity dan operational capacity.
```

### 7.3 Java 21

Java 21 membawa virtual threads sebagai fitur stabil, tetapi password hashing adalah CPU/memory-bound work.

Virtual thread tidak membuat bcrypt/Argon2id lebih murah.

Rule:

```text
Jangan menganggap virtual thread menyelesaikan bottleneck password hashing.
Hashing tetap memakan CPU/memory nyata.
```

Jika login menggunakan virtual thread:

1. tetap batasi concurrency hashing,
2. tetap rate limit login,
3. tetap monitor CPU,
4. jangan membuat unlimited login verification parallelism.

### 7.4 Java 25

Java 25 relevan karena modernisasi security APIs dan cryptographic object handling, tetapi password hashing pilihan seperti Argon2id tetap biasanya memerlukan library eksternal bila tidak tersedia dari provider default.

Yang penting secara desain:

1. gunakan provider dan algorithm yang eksplisit,
2. jangan bergantung pada default yang ambigu,
3. simpan algorithm id dan parameter,
4. rancang upgrade path.

### 7.5 Cross-Version Rule

Agar desain berjalan dari Java 8 sampai 25:

```text
Jangan ikat database password verifier ke satu implementation detail framework.
Simpan password verifier dalam format self-describing:
- algorithm id
- version
- parameters
- salt
- hash
- optional pepper id
```

Contoh:

```text
{bcrypt}$2a$12$...
{argon2id-v1}$argon2id$v=19$m=65536,t=3,p=1$...
{pbkdf2-sha256-v2}$pbkdf2$iter=600000$salt=...$hash=...
```

---

## 8. Spring Security PasswordEncoder Mental Model

Spring Security menyediakan `PasswordEncoder` untuk transformasi one-way password dan `DelegatingPasswordEncoder` untuk memilih encoder berdasarkan prefix algorithm.

Konsep penting:

```java
public interface PasswordEncoder {
    String encode(CharSequence rawPassword);
    boolean matches(CharSequence rawPassword, String encodedPassword);
    default boolean upgradeEncoding(String encodedPassword) { ... }
}
```

### 8.1 Encode

`encode` digunakan saat:

1. registrasi,
2. password reset,
3. password change,
4. migration setelah login sukses.

```java
String encoded = passwordEncoder.encode(rawPassword);
```

### 8.2 Matches

`matches` digunakan saat login:

```java
boolean valid = passwordEncoder.matches(rawPassword, storedEncodedPassword);
```

### 8.3 DelegatingPasswordEncoder

`DelegatingPasswordEncoder` membaca prefix:

```text
{bcrypt}...
{pbkdf2}...
{argon2}...
```

Lalu memilih implementation yang sesuai.

Manfaat:

1. mendukung banyak algorithm sekaligus,
2. memudahkan migration,
3. password lama tetap bisa diverifikasi,
4. password baru bisa memakai algorithm baru,
5. rehash-on-login bisa dilakukan bertahap.

### 8.4 Pattern Migration

Misalnya database lama:

```text
{sha256}oldHash
```

Target baru:

```text
{bcrypt}$2a$12$...
```

Flow:

```text
1. user login dengan password benar
2. sistem verify memakai encoder lama berdasarkan prefix
3. jika valid dan upgradeEncoding == true
4. sistem encode ulang password dengan encoder baru
5. simpan verifier baru
```

Pseudo-code:

```java
if (passwordEncoder.matches(rawPassword, user.passwordHash())) {
    if (passwordEncoder.upgradeEncoding(user.passwordHash())) {
        String upgraded = passwordEncoder.encode(rawPassword);
        userRepository.updatePasswordHash(user.id(), upgraded);
    }
    return authenticated(user);
}
```

Caveat:

```text
Rehash-on-login hanya memigrasikan user yang login.
Account dormant tetap memakai hash lama sampai ada forced reset atau background migration yang tidak mungkin tanpa raw password.
```

---

## 9. Password Verification Flow Yang Benar

Login flow harus dirancang sebagai pipeline.

### 9.1 High-Level Flow

```text
1. receive login request
2. normalize identifier
3. find account by identifier
4. apply pre-verification policy
5. verify password safely
6. apply post-verification policy
7. evaluate risk
8. require MFA/step-up if needed
9. create session/token
10. audit event
11. update counters safely
```

### 9.2 Detail Flow

```text
REQUEST_RECEIVED
  -> validate request shape
  -> normalize username/email
  -> lookup account
  -> if account not found: perform dummy hash or uniform response
  -> if account locked: respond uniformly, avoid expensive work if safe
  -> verify password
  -> if fail: increment failure counter, audit
  -> if success: reset failure counter, maybe upgrade hash
  -> evaluate account state
  -> evaluate credential state
  -> maybe require MFA
  -> rotate session
  -> return success
```

### 9.3 Uniform Error Response

Jangan bedakan pesan:

```text
Email tidak ditemukan
Password salah
Account disabled
```

Gunakan:

```text
Invalid username or password.
```

Atau bahasa produk:

```text
Login failed. Please check your credentials or contact support.
```

Namun internal audit harus tetap spesifik.

Public response:

```text
LOGIN_FAILED
```

Internal reason:

```text
ACCOUNT_NOT_FOUND
PASSWORD_MISMATCH
ACCOUNT_LOCKED
PASSWORD_EXPIRED
MFA_REQUIRED
```

### 9.4 Dummy Hash Untuk Account Tidak Ditemukan

Jika account tidak ditemukan dan sistem langsung return, attacker bisa melakukan user enumeration lewat timing.

Mitigasi:

```text
jalankan dummy password verification dengan hash dummy yang cost-nya mirip
```

Pseudo-code:

```java
User user = userRepository.findByLoginId(loginId).orElse(null);
String storedHash = user != null ? user.passwordHash() : DUMMY_PASSWORD_HASH;

boolean passwordMatches = passwordEncoder.matches(rawPassword, storedHash);

if (user == null || !passwordMatches) {
    auditLoginFailure(loginId, user == null ? "UNKNOWN_ACCOUNT" : "BAD_PASSWORD");
    throw invalidCredentials();
}
```

Caveat:

```text
Dummy hash menambah CPU cost untuk enumeration attack.
Gabungkan dengan rate limiting.
```

### 9.5 Constant-Time Comparison

Library password hashing yang baik biasanya menangani comparison dengan aman.

Jika membuat verifier custom, gunakan constant-time comparison untuk output hash.

Jangan:

```java
Arrays.equals(expected, actual)
```

Lebih aman:

```java
MessageDigest.isEqual(expected, actual)
```

Namun rule lebih kuat:

```text
Jangan membuat password hashing verifier sendiri kecuali benar-benar perlu.
```

---

## 10. Password Policy Modern

Password policy harus mengurangi risiko tanpa membuat user menciptakan password predictable.

### 10.1 Minimum Length

Password pendek buruk.

Minimum length harus cukup panjang. Untuk sistem serius, 8 karakter adalah minimum rendah. Banyak sistem enterprise memilih minimal 12 atau lebih, tetapi harus mempertimbangkan user base dan recovery burden.

### 10.2 Maximum Length

Jangan batasi terlalu pendek.

Password manager dan passphrase membutuhkan panjang besar.

Tetapi perlu batas atas untuk mencegah DoS.

Contoh:

```text
min length: 12
max length: 128 atau 256 karakter
```

Kenapa perlu max?

```text
attacker bisa mengirim password sangat besar untuk memicu CPU/memory cost saat hashing
```

### 10.3 Allow Spaces and Unicode?

Passphrase sering memakai spasi.

Unicode memberi fleksibilitas tetapi menambah risiko normalization mismatch.

Pilihan desain:

```text
Option A: allow full Unicode with clear normalization policy
Option B: restrict to broad printable ASCII for operational simplicity
```

Jika mendukung Unicode:

1. tentukan normalization form,
2. konsisten saat set password dan verify,
3. hati-hati karakter visually similar,
4. jangan silently transform berlebihan.

### 10.4 Complexity Rule

Complexity rule tradisional sering menghasilkan password predictable.

Lebih baik:

1. panjang yang cukup,
2. cek breached password,
3. cek dictionary/common password,
4. larang password mengandung username/email/app name,
5. support password manager,
6. MFA untuk risiko tinggi.

### 10.5 Password Expiry

Forced periodic password change sering membuat user memilih pola incremental:

```text
Company2024!
Company2025!
Company2026!
```

Modern guidance umumnya lebih memilih password change saat ada indikasi compromise, bukan rotasi kalender buta.

Kapan password harus diganti:

1. user meminta reset,
2. ada breach signal,
3. admin reset karena incident,
4. password sementara digunakan,
5. account recovery selesai,
6. hash algorithm migration dengan forced reset untuk dormant users.

### 10.6 Breached Password Check

Saat registrasi atau password change, cek apakah password termasuk daftar umum/bocor.

Pattern:

```text
candidate password -> privacy-preserving breach check -> reject if compromised
```

Jangan mengirim password plain ke external API.

Jika memakai external breach service:

1. gunakan k-anonymity pattern bila tersedia,
2. jangan log candidate password,
3. pastikan privacy/legal sesuai,
4. cache response secara aman bila perlu.

---

## 11. Throttling, Rate Limiting, and Lockout

Password authentication harus menghadapi online guessing.

### 11.1 Threat: Online Guessing

Attacker mencoba password langsung ke login endpoint.

```text
POST /login
username=victim@example.com
password=guess1
```

Online guessing dibatasi oleh:

1. rate limit,
2. lockout,
3. CAPTCHA/risk challenge,
4. MFA,
5. IP reputation,
6. device fingerprinting,
7. alerting.

### 11.2 Jangan Hanya Lock Per Account

Jika lock hanya per account, attacker bisa lock banyak account korban.

Ini menjadi denial-of-service.

```text
attacker mencoba 10 password salah ke setiap account karyawan
semua account terkunci
operasional terganggu
```

### 11.3 Jangan Hanya Limit Per IP

Jika limit hanya per IP, attacker bisa memakai botnet/proxy.

### 11.4 Multi-Dimensional Rate Limit

Gunakan beberapa dimensi:

```text
per account
per IP
per IP subnet / ASN
per device fingerprint
per username prefix/domain
per tenant
global login failure rate
```

### 11.5 Soft Lock vs Hard Lock

Soft lock:

```text
sementara menunda atau menolak login selama durasi pendek
bisa otomatis pulih
```

Hard lock:

```text
butuh admin/support atau recovery flow
```

Untuk sebagian besar sistem, soft lock lebih aman terhadap DoS.

### 11.6 Progressive Delay

Contoh:

```text
1-3 gagal: normal
4 gagal: delay 1 detik
5 gagal: delay 5 detik
6 gagal: delay 30 detik
7+ gagal: temporary lock 15 menit
```

Tetapi jangan implementasi delay dengan menahan thread mahal secara sembarangan.

Lebih baik:

```text
return 429 / generic failure dengan retry-after policy
atau simpan next_allowed_attempt_at
```

### 11.7 Account Lockout Invariant

```text
Failed login attempts must never allow an attacker to permanently deny access to a victim without recovery path.
```

### 11.8 Rate Limit Storage

Rate limit state bisa disimpan di:

1. Redis,
2. local cache + centralized audit,
3. database,
4. API gateway/WAF,
5. identity provider.

Redis umum dipakai, tetapi perlu fail-mode.

Jika Redis down:

```text
fail-open -> brute force risk naik
fail-closed -> user tidak bisa login
hybrid -> local emergency limiter + degraded mode
```

Production design harus menentukan ini eksplisit.

---

## 12. Password Reset Is Authentication

Password reset sering menjadi weakest link.

### 12.1 Reset Flow Minimal

```text
1. user meminta reset dengan email/username
2. sistem selalu memberi response generic
3. jika account ada, buat reset token
4. kirim token via channel terdaftar
5. user membuka link
6. sistem validasi token
7. user set password baru
8. invalidate old sessions jika policy mengharuskan
9. audit event
```

### 12.2 Reset Token Properties

Reset token harus:

1. random kuat,
2. panjang cukup,
3. single-use,
4. memiliki expiry pendek,
5. disimpan hashed di database,
6. bound ke account,
7. bound ke purpose,
8. invalidated setelah password change,
9. tidak masuk log,
10. tidak predictable.

Jangan simpan reset token plain text.

Simpan:

```text
reset_token_hash = SHA-256(token)
```

Karena reset token sudah random high entropy, SHA-256 untuk token lookup bisa diterima. Ini berbeda dari password karena token random tidak low entropy.

### 12.3 Response Generic

Request reset harus selalu menjawab:

```text
If the account exists, we will send instructions.
```

Jangan:

```text
Email not registered.
```

### 12.4 Expiry

Expiry terlalu panjang meningkatkan risiko.

Contoh umum:

```text
15 menit sampai 1 jam
```

Untuk low-risk consumer app mungkin berbeda, tetapi harus ada reasoning.

### 12.5 Reset Invalidates What?

Setelah password reset, pilihan:

```text
A. invalidate all active sessions
B. invalidate all except current reset flow
C. ask user whether to logout all devices
D. risk-based invalidation
```

Untuk sistem enterprise/regulatory, default yang kuat:

```text
invalidate all existing sessions and refresh tokens after password reset
```

### 12.6 Recovery Channel Risk

Email reset berarti email account menjadi authentication factor.

Jika email user compromise, account juga compromise.

Untuk high-risk system:

1. gunakan MFA recovery,
2. admin-assisted recovery,
3. identity proofing ulang,
4. recovery code,
5. delayed high-risk action setelah reset.

---

## 13. Password Change Flow

Password change berbeda dari reset.

Password change biasanya dilakukan oleh user yang sudah login.

### 13.1 Secure Password Change

Flow:

```text
1. user authenticated
2. user memasukkan current password
3. sistem verify current password
4. user memasukkan new password
5. validate password policy
6. check breached/common password
7. encode new password
8. update password hash
9. invalidate other sessions if needed
10. audit event
```

### 13.2 Kenapa Current Password Dibutuhkan

Jika attacker mencuri session aktif, current password requirement mengurangi risiko attacker langsung mengganti password.

Namun jika sistem memakai MFA kuat, bisa juga step-up MFA menggantikan current password.

### 13.3 Session Handling Setelah Change

Setelah password change:

1. rotate current session ID,
2. invalidate other sessions,
3. revoke refresh tokens,
4. notify user,
5. log event.

### 13.4 Prevent Password Reuse

Untuk enterprise, bisa melarang reuse beberapa password terakhir.

Namun jangan menyimpan password lama plain.

Simpan verifier lama dan saat password baru dimasukkan, test candidate terhadap verifier lama.

Caveat:

```text
Ini menambah biaya hashing saat password change, bukan saat login.
```

---

## 14. Temporary Passwords

Temporary password sering dipakai dalam enterprise onboarding.

Risikonya tinggi karena temporary password sering:

1. dikirim via email,
2. dibuat predictable,
3. berlaku terlalu lama,
4. tidak dipaksa diganti,
5. bisa dipakai berulang.

### 14.1 Better Pattern

Daripada temporary password, gunakan invite link single-use.

```text
admin creates user
system sends activation link
user sets password directly
activation token expires quickly
```

### 14.2 Jika Temporary Password Harus Ada

Pastikan:

1. random kuat,
2. single-use,
3. expiry pendek,
4. user wajib set password baru,
5. tidak bisa dipakai untuk API access,
6. audit jelas,
7. tidak ditampilkan lagi setelah dibuat.

State:

```text
TEMPORARY_PASSWORD_ACTIVE
PASSWORD_RESET_REQUIRED
```

Invariant:

```text
Temporary password must never create a long-lived fully privileged session before password replacement.
```

---

## 15. Password Hash Upgrade Strategy

Password hashing parameter akan berubah seiring waktu.

Contoh:

```text
bcrypt cost 10 -> 12 -> 14
PBKDF2 100k -> 300k -> 600k+
Argon2id memory/time cost naik
```

### 15.1 Kenapa Perlu Upgrade

Hardware attacker makin cepat.

Cost yang aman 5 tahun lalu mungkin tidak cukup hari ini.

### 15.2 Upgrade Modes

#### Mode A — Rehash on Login

```text
saat user login sukses, re-encode password dengan parameter baru
```

Kelebihan:

1. tidak mengganggu user aktif,
2. tidak perlu raw password tambahan,
3. gradual.

Kekurangan:

1. user dormant tidak termigrasi,
2. butuh kode migration tetap ada lama.

#### Mode B — Forced Reset

```text
user diminta reset password pada login berikutnya
```

Kelebihan:

1. semua user aktif bisa dipaksa pindah,
2. cocok untuk legacy hash lemah.

Kekurangan:

1. mengganggu user,
2. support load naik,
3. recovery channel jadi critical.

#### Mode C — Background Migration

Untuk password, background migration tidak bisa menaikkan hash tanpa raw password.

Yang bisa dilakukan hanya:

1. menambahkan wrapper HMAC/pepper di atas hash lama jika memiliki secret,
2. menandai account legacy,
3. memaksa reset.

### 15.3 Password Version Column

Simpan versi secara eksplisit.

Contoh schema:

```sql
password_hash              varchar(512) not null,
password_algorithm         varchar(64)  not null,
password_hash_version      integer      not null,
password_updated_at        timestamp    not null,
password_must_change       boolean      not null,
password_compromised_at    timestamp    null
```

Jika encoded hash sudah self-describing, kolom algorithm bisa redundant, tetapi berguna untuk query/report.

### 15.4 Upgrade Decision

```java
if (passwordEncoder.matches(rawPassword, storedHash)) {
    if (passwordPolicy.needsUpgrade(storedHash)) {
        String newHash = passwordEncoder.encode(rawPassword);
        userRepository.updatePasswordHash(userId, newHash);
    }
}
```

Pastikan update aman terhadap race.

```sql
update users
set password_hash = :newHash,
    password_hash_version = :newVersion,
    password_updated_at = :now
where id = :userId
  and password_hash = :oldHash
```

---

## 16. Pepper Design

Pepper sering disebut, jarang dirancang benar.

### 16.1 Kapan Pepper Berguna

Pepper berguna jika:

```text
attacker mendapatkan database password hash
attacker tidak mendapatkan secret store / environment secret / KMS
```

Dengan pepper, attacker tidak bisa langsung melakukan offline guessing tanpa pepper.

### 16.2 Pepper Storage

Pepper jangan disimpan di database yang sama dengan password hash.

Pilihan:

1. environment secret,
2. secret manager,
3. HSM/KMS,
4. config server dengan access control ketat.

### 16.3 Pepper Rotation Problem

Jika pepper berubah, hash lama tidak bisa diverifikasi kecuali sistem tahu pepper lama.

Karena itu butuh pepper id.

Schema:

```text
password_hash
password_algorithm
pepper_id
```

Runtime:

```text
pepper_id -> retrieve pepper key -> verify password
```

### 16.4 Rotation Strategy

```text
1. introduce pepper-v2
2. new password uses pepper-v2
3. old password still verified with pepper-v1
4. on successful login, rehash with pepper-v2
5. after sufficient migration, force reset remaining pepper-v1 users
6. retire pepper-v1
```

### 16.5 Pepper Failure Mode

Jika pepper hilang:

```text
semua password dengan pepper itu tidak bisa diverifikasi
```

Jadi pepper harus:

1. backed up securely,
2. access-controlled,
3. monitored,
4. rotatable,
5. tested in disaster recovery.

---

## 17. Database Schema Patterns

### 17.1 Minimal Schema

```sql
create table app_user (
    id                      bigint primary key,
    login_id                varchar(320) not null unique,
    password_hash           varchar(512) not null,
    password_updated_at     timestamp not null,
    password_must_change    boolean not null default false,
    failed_login_count      integer not null default 0,
    locked_until            timestamp null,
    created_at              timestamp not null,
    updated_at              timestamp not null
);
```

### 17.2 Better Enterprise Schema

```sql
create table user_credential_password (
    user_id                    bigint primary key,
    password_hash              varchar(1024) not null,
    password_algorithm         varchar(64) not null,
    password_hash_version      integer not null,
    pepper_id                  varchar(64) null,
    password_set_at            timestamp not null,
    password_expires_at        timestamp null,
    password_must_change       boolean not null default false,
    compromised_at             timestamp null,
    disabled_at                timestamp null,
    last_verified_at           timestamp null,
    created_at                 timestamp not null,
    updated_at                 timestamp not null
);

create table user_login_failure_counter (
    user_id                    bigint not null,
    window_start               timestamp not null,
    failure_count              integer not null,
    last_failure_at            timestamp not null,
    primary key (user_id, window_start)
);

create table password_reset_token (
    id                         bigint primary key,
    user_id                    bigint not null,
    token_hash                 varchar(128) not null unique,
    purpose                    varchar(64) not null,
    expires_at                 timestamp not null,
    consumed_at                timestamp null,
    created_at                 timestamp not null,
    created_ip_hash            varchar(128) null
);
```

### 17.3 Why Separate Credential Table?

Memisahkan credential dari profile berguna karena:

1. user profile sering dibaca,
2. password hash harus minim exposure,
3. access control database bisa lebih ketat,
4. audit credential update lebih jelas,
5. mendukung multiple credential type.

---

## 18. Java Implementation Skeleton

Bagian ini bukan library final, tetapi struktur mental.

### 18.1 Domain Model

```java
public final class PasswordCredential {
    private final long userId;
    private final String encodedHash;
    private final String algorithm;
    private final int version;
    private final String pepperId;
    private final boolean mustChange;
    private final Instant compromisedAt;
    private final Instant disabledAt;

    public boolean isUsableForLogin(Instant now) {
        return disabledAt == null && compromisedAt == null;
    }
}
```

### 18.2 Authentication Result

```java
public sealed interface PasswordAuthenticationResult {
    record Success(long userId, boolean hashUpgraded) implements PasswordAuthenticationResult {}
    record InvalidCredential() implements PasswordAuthenticationResult {}
    record Locked(Instant until) implements PasswordAuthenticationResult {}
    record PasswordChangeRequired(long userId) implements PasswordAuthenticationResult {}
    record CredentialDisabled() implements PasswordAuthenticationResult {}
}
```

Jika belum memakai Java 17 sealed class, Java 8 bisa memakai class hierarchy biasa atau enum + payload.

### 18.3 Service Flow

```java
public final class PasswordAuthenticationService {
    private final UserRepository userRepository;
    private final PasswordCredentialRepository credentialRepository;
    private final PasswordHasher passwordHasher;
    private final LoginRateLimiter rateLimiter;
    private final AuditSink auditSink;
    private final Clock clock;

    public PasswordAuthenticationResult authenticate(String loginId, char[] password, LoginContext ctx) {
        Instant now = clock.instant();
        String normalizedLoginId = normalizeLoginId(loginId);

        RateLimitDecision rateDecision = rateLimiter.check(normalizedLoginId, ctx);
        if (!rateDecision.allowed()) {
            auditSink.loginRejected(normalizedLoginId, "RATE_LIMITED", ctx, now);
            return new PasswordAuthenticationResult.Locked(rateDecision.retryAfter());
        }

        User user = userRepository.findByLoginId(normalizedLoginId).orElse(null);
        PasswordCredential credential = user == null
            ? PasswordCredentialFixtures.dummyCredential()
            : credentialRepository.findByUserId(user.id()).orElse(null);

        boolean matches = credential != null && passwordHasher.matches(password, credential.encodedHash());

        try {
            if (user == null || credential == null || !matches) {
                rateLimiter.recordFailure(normalizedLoginId, ctx);
                auditSink.loginFailed(normalizedLoginId, user == null ? null : user.id(), "INVALID_CREDENTIAL", ctx, now);
                return new PasswordAuthenticationResult.InvalidCredential();
            }

            if (!user.isAllowedToLogin()) {
                auditSink.loginFailed(normalizedLoginId, user.id(), "ACCOUNT_NOT_ALLOWED", ctx, now);
                return new PasswordAuthenticationResult.InvalidCredential();
            }

            if (!credential.isUsableForLogin(now)) {
                auditSink.loginFailed(normalizedLoginId, user.id(), "CREDENTIAL_DISABLED", ctx, now);
                return new PasswordAuthenticationResult.CredentialDisabled();
            }

            boolean upgraded = false;
            if (passwordHasher.needsUpgrade(credential.encodedHash())) {
                String newHash = passwordHasher.encode(password);
                upgraded = credentialRepository.upgradeHash(user.id(), credential.encodedHash(), newHash);
            }

            rateLimiter.recordSuccess(normalizedLoginId, ctx);
            auditSink.loginSucceeded(normalizedLoginId, user.id(), ctx, now);

            if (credential.mustChange()) {
                return new PasswordAuthenticationResult.PasswordChangeRequired(user.id());
            }

            return new PasswordAuthenticationResult.Success(user.id(), upgraded);
        } finally {
            wipe(password);
        }
    }
}
```

### 18.4 Notes on `char[]` vs `String`

Historically Java security APIs often prefer `char[]` so secret can be wiped.

Reality:

1. HTTP request body often already became `String`,
2. framework may copy password internally,
3. GC/lifetime cannot be fully controlled,
4. `char[]` still helps avoid additional immutable copies in your own layer.

Rule practical:

```text
Do not overclaim memory wiping, but avoid unnecessary copies and always prevent logging.
```

### 18.5 Wiping

```java
private static void wipe(char[] password) {
    if (password != null) {
        Arrays.fill(password, '\0');
    }
}
```

This is best-effort, not absolute guarantee.

---

## 19. Password Hashing With PBKDF2 in Plain Java

Jika tidak memakai Spring Security Crypto atau library eksternal, PBKDF2 bisa dibuat dengan JCA/JCE.

Namun ingat:

```text
PBKDF2 is acceptable under some constraints, but Argon2id/bcrypt may be preferred depending on policy and library availability.
```

### 19.1 Example Verifier Format

```text
pbkdf2-sha256$v=1$iter=600000$salt=<base64url>$hash=<base64url>
```

### 19.2 PBKDF2 Utility Skeleton

```java
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.security.spec.KeySpec;
import java.util.Base64;

public final class Pbkdf2PasswordHasher {
    private static final String ALGORITHM = "PBKDF2WithHmacSHA256";
    private static final int SALT_BYTES = 16;
    private static final int KEY_BITS = 256;
    private static final int ITERATIONS = 600_000;

    private final SecureRandom secureRandom = new SecureRandom();

    public String encode(char[] password) {
        byte[] salt = new byte[SALT_BYTES];
        secureRandom.nextBytes(salt);
        byte[] hash = pbkdf2(password, salt, ITERATIONS, KEY_BITS);

        return "pbkdf2-sha256$v=1$iter=" + ITERATIONS
            + "$salt=" + b64(salt)
            + "$hash=" + b64(hash);
    }

    public boolean matches(char[] password, String encoded) {
        Parsed parsed = Parsed.parse(encoded);
        byte[] candidate = pbkdf2(password, parsed.salt(), parsed.iterations(), parsed.keyBits());
        return MessageDigest.isEqual(candidate, parsed.hash());
    }

    private static byte[] pbkdf2(char[] password, byte[] salt, int iterations, int keyBits) {
        try {
            KeySpec spec = new PBEKeySpec(password, salt, iterations, keyBits);
            SecretKeyFactory factory = SecretKeyFactory.getInstance(ALGORITHM);
            return factory.generateSecret(spec).getEncoded();
        } catch (Exception e) {
            throw new IllegalStateException("Password hashing failed", e);
        }
    }

    private static String b64(byte[] bytes) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }
}
```

Caveats:

1. parsing harus robust,
2. reject malformed verifier,
3. algorithm harus eksplisit,
4. parameter harus disimpan,
5. iteration harus benchmark di environment sendiri,
6. jangan copy-paste skeleton ini tanpa test dan review.

---

## 20. Authentication Failure Modes

### 20.1 User Enumeration

Bug:

```text
email tidak ada -> response cepat
password salah -> response lambat karena hashing
```

Mitigasi:

1. generic response,
2. dummy hash,
3. timing normalization reasonable,
4. rate limit enumeration.

### 20.2 CPU DoS Via Login

Password hashing mahal. Attacker bisa spam login.

Mitigasi:

1. rate limit sebelum hashing,
2. global login concurrency cap,
3. circuit breaker,
4. bot detection,
5. progressive delay,
6. separate auth worker pool.

### 20.3 Weak Reset Token

Bug:

```text
reset token = 6 digit OTP valid 24 jam no rate limit
```

Mitigasi:

1. high entropy token,
2. short expiry,
3. single-use,
4. rate limit token verification,
5. store hash only.

### 20.4 Password Hash Downgrade

Bug:

```text
attacker modifies stored hash prefix to {noop}password
```

Mitigasi:

1. never allow noop in production,
2. restrict accepted algorithms,
3. validate encoded format,
4. protect DB write access,
5. audit hash metadata changes.

### 20.5 Race Condition on Failed Attempts

Bug:

```text
parallel failed login attempts overwrite counter
```

Mitigasi:

1. atomic increment,
2. Redis INCR with TTL,
3. DB update with optimistic/pessimistic locking,
4. event-based aggregation.

### 20.6 Password Reset Race

Bug:

```text
two reset tokens valid at once
old token remains valid after new token created
```

Mitigasi:

1. invalidate prior tokens when creating new one,
2. token purpose and single-use,
3. transaction boundary.

### 20.7 Session Not Invalidated

Bug:

```text
password reset succeeds
attacker session remains active
```

Mitigasi:

1. revoke sessions,
2. revoke refresh tokens,
3. increment user credential version,
4. resource server checks token version if needed.

---

## 21. Password Authentication and Session Creation

Password verification only proves initial credential. Setelah itu sistem biasanya membuat session/token.

Flow:

```text
password valid -> authentication successful -> session/token issued
```

Bahaya:

```text
password valid tapi session creation tidak memperhatikan account state
```

### 21.1 Session Rotation

Setelah login sukses, session ID harus baru.

Ini mencegah session fixation.

```text
anonymous session id -> login -> authenticated session id baru
```

### 21.2 Credential Version Binding

Untuk sistem token/session modern, simpan `credential_version`.

```text
user.credential_version = 42
session.credential_version = 42
```

Saat password reset:

```text
user.credential_version = 43
```

Session lama dengan version 42 invalid.

### 21.3 Token Claim Pattern

JWT bisa membawa claim:

```json
{
  "sub": "12345",
  "auth_time": 1780000000,
  "credential_version": 42,
  "amr": ["pwd"]
}
```

Resource server harus bisa mengecek version jika immediate revocation diperlukan.

Trade-off:

```text
stateless JWT sulit immediate revoke tanpa lookup
```

---

## 22. Audit Model

Authentication harus bisa diaudit tanpa membocorkan secret.

### 22.1 Event Yang Perlu Dicatat

```text
LOGIN_SUCCESS
LOGIN_FAILURE
PASSWORD_CHANGED
PASSWORD_RESET_REQUESTED
PASSWORD_RESET_TOKEN_SENT
PASSWORD_RESET_COMPLETED
PASSWORD_RESET_FAILED
PASSWORD_HASH_UPGRADED
PASSWORD_COMPROMISED_MARKED
ACCOUNT_LOCKED
ACCOUNT_UNLOCKED
```

### 22.2 Field Audit

```text
event_id
occurred_at
actor_user_id nullable
login_identifier_hash
tenant_id
source_ip_hash/source_ip_truncated
user_agent_hash
device_id nullable
result
failure_reason_internal
correlation_id
request_id
authentication_method = password
authentication_assurance_level
risk_score nullable
```

### 22.3 Jangan Log

Tidak boleh log:

1. raw password,
2. password hash jika tidak perlu,
3. reset token plain,
4. OTP plain,
5. full Authorization header,
6. session ID,
7. cookie value.

### 22.4 Internal vs External Reason

External:

```text
Invalid username or password.
```

Internal audit:

```text
PASSWORD_MISMATCH
UNKNOWN_ACCOUNT
ACCOUNT_TEMP_LOCKED
CREDENTIAL_DISABLED
PASSWORD_EXPIRED
```

---

## 23. Operational Tuning

### 23.1 Benchmark Hash Cost

Jangan memilih cost parameter dari internet tanpa benchmark.

Benchmark di environment sendiri:

1. instance type production,
2. container CPU limit sama,
3. JVM version sama,
4. concurrency realistis,
5. peak login scenario,
6. cold start behavior,
7. memory limit.

### 23.2 Target Latency

Misalnya target:

```text
single password verification: 100–300 ms
p95 login endpoint: < 1s under normal load
```

Angka ini bukan hukum universal. Sistem high-security bisa memilih lebih mahal.

### 23.3 Capacity Planning

Jika satu hash butuh 200 ms CPU efektif, satu core kira-kira hanya bisa menjalankan 5 hash/detik secara serial.

Dengan 8 core:

```text
~40 hash/detik sebelum overhead
```

Jika login storm 500 req/s, server bisa overload.

Mitigasi:

1. rate limit,
2. queue/concurrency cap,
3. autoscaling,
4. separate auth service,
5. bot protection.

### 23.4 Separate Auth Pool

Jangan biarkan hashing menghabiskan semua request worker.

Pattern:

```text
HTTP request thread/virtual thread
  -> submit password verification to bounded executor
  -> if queue full, reject/degrade
```

Tetapi hati-hati:

```text
bounded executor + blocking wait juga bisa bottleneck
```

Yang penting adalah explicit concurrency budget.

---

## 24. Password Authentication in Distributed Systems

### 24.1 Centralized Auth Service

Pattern:

```text
applications -> auth service -> user credential store
```

Kelebihan:

1. policy terpusat,
2. audit konsisten,
3. hashing implementation satu tempat,
4. migration lebih mudah.

Kekurangan:

1. auth service menjadi critical dependency,
2. latency tambahan,
3. outage impact besar,
4. perlu HA serius.

### 24.2 Embedded Auth Per Application

Pattern:

```text
setiap app melakukan password verification sendiri
```

Kelebihan:

1. sederhana untuk monolith,
2. dependency lebih sedikit.

Kekurangan:

1. policy drift,
2. duplicated code,
3. audit fragmented,
4. migration lebih sulit.

### 24.3 Identity Provider Pattern

Modern enterprise biasanya memindahkan password handling ke IdP:

```text
application -> OIDC/SAML -> IdP handles password
```

Aplikasi tidak menyimpan password.

Kelebihan:

1. password lifecycle centralized,
2. MFA centralized,
3. federation support,
4. lower app liability.

Kekurangan:

1. dependency pada IdP,
2. custom business state harus diintegrasikan,
3. claim mapping complexity,
4. logout/session complexity.

Part ini tetap penting karena bahkan jika memakai IdP, top engineer harus memahami password mechanics agar bisa menilai IdP policy dan failure mode.

---

## 25. Threat Modeling Password Authentication

Gunakan pertanyaan berikut.

### 25.1 Credential Theft

```text
Bagaimana jika password user bocor dari layanan lain?
```

Controls:

1. breached password check,
2. MFA,
3. risk-based login,
4. impossible travel detection,
5. user notification.

### 25.2 Database Breach

```text
Bagaimana jika table password hash terbaca?
```

Controls:

1. Argon2id/bcrypt/PBKDF2 strong parameters,
2. unique salt,
3. optional pepper,
4. DB access minimization,
5. incident reset plan.

### 25.3 Application Server Breach

```text
Bagaimana jika attacker membaca memory/config app server?
```

Controls:

1. secret manager access control,
2. short-lived secret fetch,
3. rotation,
4. least privilege,
5. detect anomalous access.

Pepper mungkin ikut bocor jika app server compromise.

### 25.4 Log Breach

```text
Bagaimana jika logs/APM/trace bocor?
```

Controls:

1. request body redaction,
2. field-level denylist,
3. no password in exception,
4. secure debug policy.

### 25.5 Reset Channel Compromise

```text
Bagaimana jika email user compromise?
```

Controls:

1. MFA recovery,
2. notification,
3. delayed sensitive action,
4. session invalidation,
5. support workflow.

### 25.6 Insider Threat

```text
Bisakah DBA/support melihat password hash/reset token dan mengambil alih account?
```

Controls:

1. hash reset token,
2. strong password hash,
3. pepper outside DB,
4. admin action audit,
5. dual control for account recovery.

---

## 26. Common Mistakes

### Mistake 1 — Menggunakan SHA-256 Untuk Password

```text
SHA-256 cepat. Password hashing harus lambat.
```

### Mistake 2 — Tidak Menyimpan Algorithm Metadata

Tanpa metadata, migration sulit.

### Mistake 3 — Login Error Terlalu Spesifik

```text
Email not found
```

membantu enumeration.

### Mistake 4 — Password Reset Token Disimpan Plain

Jika DB bocor, attacker bisa memakai token yang belum expired.

### Mistake 5 — Lockout Permanen Berdasarkan Failure Count

Attacker bisa DoS account korban.

### Mistake 6 — Tidak Ada Rate Limit Sebelum Hashing

Attacker bisa membuat CPU habis.

### Mistake 7 — Password Change Tidak Meminta Current Password/Step-Up

Session theft bisa menjadi full account takeover.

### Mistake 8 — Tidak Invalidate Session Setelah Reset

Attacker tetap login walau password sudah diganti.

### Mistake 9 — Logging Request Body Login

Password bocor ke log.

### Mistake 10 — Menganggap MFA Menyelesaikan Password Storage

MFA membantu account takeover, tetapi DB breach tetap butuh password storage kuat.

---

## 27. Production Checklist

### 27.1 Storage

- [ ] Tidak menyimpan plain text password.
- [ ] Tidak menyimpan encrypted reversible password.
- [ ] Menggunakan Argon2id/bcrypt/scrypt/PBKDF2 dengan parameter kuat.
- [ ] Salt unik per password.
- [ ] Format hash self-describing.
- [ ] Legacy hash punya migration path.
- [ ] Optional pepper disimpan terpisah dari DB.
- [ ] Pepper punya rotation strategy.

### 27.2 Login Flow

- [ ] Response login failure generic.
- [ ] Account enumeration dimitigasi.
- [ ] Rate limit multi-dimensional.
- [ ] Lockout tidak mudah dipakai untuk DoS.
- [ ] Password verification memakai library matang.
- [ ] Session ID rotated after login.
- [ ] Account state dicek sebelum session/token full dibuat.
- [ ] Audit event lengkap.

### 27.3 Reset and Change

- [ ] Reset token random high entropy.
- [ ] Reset token disimpan hashed.
- [ ] Reset token single-use.
- [ ] Reset token expiry pendek.
- [ ] Reset response tidak mengungkap account existence.
- [ ] Password change meminta current password atau step-up.
- [ ] Reset/change menginvalidate session/token sesuai policy.
- [ ] User diberi notification.

### 27.4 Operations

- [ ] Hash cost dibenchmark di production-like environment.
- [ ] Login concurrency dibatasi.
- [ ] CPU/memory login path dimonitor.
- [ ] Alert untuk spike failure.
- [ ] Runbook credential stuffing tersedia.
- [ ] Runbook DB breach tersedia.
- [ ] Runbook pepper compromise tersedia.
- [ ] Test recovery flow rutin.

---

## 28. Design Review Questions

Gunakan pertanyaan ini saat review sistem password authentication.

### 28.1 Credential Storage

1. Algorithm apa yang dipakai?
2. Parameter cost berapa dan kapan terakhir dievaluasi?
3. Apakah hash format menyimpan algorithm dan parameter?
4. Apakah salt unik per user/password?
5. Apakah ada legacy hash?
6. Bagaimana migration legacy hash?
7. Apakah ada pepper?
8. Di mana pepper disimpan?
9. Apa yang terjadi jika pepper hilang?
10. Apa yang terjadi jika pepper bocor?

### 28.2 Login Flow

1. Apakah login response membedakan account missing vs password wrong?
2. Apakah timing account missing terlalu berbeda?
3. Apakah rate limit dilakukan sebelum hashing?
4. Apakah failed attempt counter atomic?
5. Apakah lockout bisa dipakai untuk DoS?
6. Apakah session rotated setelah login?
7. Apakah disabled account masih bisa login?
8. Apakah password expired masih membuat token penuh?
9. Apakah audit event aman dari secret leakage?
10. Apakah login endpoint punya abuse monitoring?

### 28.3 Reset Flow

1. Reset token entropy cukup?
2. Token disimpan hashed?
3. Token single-use?
4. Token expiry berapa?
5. Apakah token lama invalid saat token baru dibuat?
6. Apakah reset invalidates sessions?
7. Apakah email reset response generic?
8. Apakah reset endpoint rate-limited?
9. Apakah reset event memberi notification?
10. Apakah support bisa bypass reset dengan aman?

### 28.4 Migration

1. Apakah semua active users sudah hash modern?
2. Bagaimana dormant users?
3. Apakah ada forced reset plan?
4. Apakah rollback aman?
5. Apakah old encoder masih dibutuhkan?
6. Apakah old encoder bisa disalahgunakan untuk downgrade?
7. Apakah migration audited?
8. Apakah compatibility Java 8–25 sudah dipikirkan?
9. Apakah library dependency maintained?
10. Apakah parameter bisa dinaikkan tanpa schema change?

---

## 29. Mini Case Study: Legacy SHA-256 Migration

### 29.1 Kondisi Awal

Database:

```sql
users(id, email, password_hash)
```

Hash lama:

```text
SHA256(password)
```

Masalah:

1. fast hash,
2. tidak ada salt,
3. tidak ada algorithm metadata,
4. raw password tidak tersedia,
5. semua dormant account tetap lemah.

### 29.2 Target

```text
{bcrypt}$2a$12$...
```

atau:

```text
{argon2id}$argon2id$v=19$...
```

### 29.3 Migration Plan

Step 1 — Tambah kolom/format:

```sql
alter table users add password_hash_version integer default 1 not null;
alter table users add password_must_change boolean default false not null;
```

Step 2 — Prefix hash lama:

```text
{legacy-sha256}<oldhash>
```

Step 3 — Implement Delegating Verifier:

```text
legacy-sha256 verifier
bcrypt/argon2id encoder baru
```

Step 4 — Rehash on login:

```text
if legacy matches -> encode with new algorithm -> save
```

Step 5 — Monitor migration:

```sql
select password_hash_version, count(*) from users group by password_hash_version;
```

Step 6 — Forced reset dormant users after deadline.

Step 7 — Disable legacy verifier after migration window.

### 29.4 Risk

Selama legacy verifier aktif, sistem masih menerima hash lama.

Mitigasi:

1. restrict legacy prefix only to existing users,
2. no new password can use legacy,
3. audit every legacy login,
4. deadline forced reset,
5. remove code path.

---

## 30. Mini Case Study: Login Storm After Outage

### 30.1 Scenario

Sistem down 30 menit. Setelah pulih, semua user mencoba login ulang.

Akibat:

1. password hashing CPU spike,
2. DB lookup spike,
3. Redis session spike,
4. login latency naik,
5. autoscaling lambat,
6. health check mulai gagal.

### 30.2 Bad Design

```text
unlimited login attempts
bcrypt cost tinggi
tidak ada global limiter
tidak ada queue cap
semua request masuk ke app worker yang sama
```

### 30.3 Better Design

```text
- global login concurrency limit
- per-account/IP limiter
- bounded auth executor
- clear 429/retry response
- autoscaling based on CPU + auth queue
- login failure/success dashboard
- circuit breaker untuk dependency reset/email
```

### 30.4 Lesson

Password hashing adalah security control sekaligus capacity risk.

Top engineer harus mengoptimalkan keduanya, bukan memilih salah satu secara buta.

---

## 31. Summary

Password authentication yang benar bukan sekadar:

```text
gunakan bcrypt
```

Melainkan desain lengkap:

```text
credential lifecycle + verifier storage + login flow + reset flow + migration + abuse defense + audit + operations
```

Core mental model:

1. Password adalah knowledge factor yang mudah dicuri dan sering reused.
2. Server tidak boleh menyimpan password asli atau bentuk reversible.
3. Password harus disimpan sebagai salted, slow, tunable verifier.
4. Argon2id, bcrypt, scrypt, dan PBKDF2 adalah keluarga pilihan umum, dengan trade-off masing-masing.
5. Java 8–25 tidak mengubah prinsip utama: simpan format self-describing dan gunakan library/provider matang.
6. Login endpoint adalah hot path yang bisa diserang untuk brute force dan CPU DoS.
7. Password reset adalah authentication flow alternatif, bukan fitur kecil.
8. Migration harus dirancang sejak awal karena algorithm dan cost akan berubah.
9. Audit harus detail secara internal tetapi tidak boleh membocorkan secret.
10. Production-grade password auth membutuhkan threat modeling dan operational readiness.

---

## 32. Referensi Resmi dan Rujukan Teknis

1. OWASP Password Storage Cheat Sheet — rekomendasi password storage, penggunaan salt, algorithm lambat seperti Argon2id/bcrypt/PBKDF2, dan warning terhadap fast hash untuk password.
2. NIST SP 800-63B Digital Identity Guidelines — panduan authenticator dan memorized secrets untuk digital identity.
3. Spring Security Reference — Password Storage dan `PasswordEncoder` / `DelegatingPasswordEncoder`.
4. Java SE 8 `SecretKeyFactory` API — fondasi JCA/JCE untuk PBKDF2-style secret key factory.
5. Java SE 25 cryptography APIs — konteks modern JDK security dan cryptographic object handling.

---

## 33. Apa Yang Tidak Dibahas Mendalam Di Part Ini

Agar efisien dan tidak mengulang seri sebelumnya, part ini tidak masuk terlalu dalam ke:

1. detail matematis cryptographic hash,
2. implementasi Argon2 internal,
3. JCA provider engineering,
4. Spring Security full filter chain,
5. OAuth/OIDC login,
6. MFA implementation,
7. session security lengkap,
8. breach monitoring platform.

Topik tersebut akan muncul di part berikutnya sesuai konteks.

---

## 34. Hubungan Ke Part Berikutnya

Part berikutnya adalah:

```text
Part 4 — Session-Based Authentication: Cookies, Server State, and Browser Reality
```

Kenapa setelah password kita masuk ke session?

Karena password biasanya hanya dipakai saat login awal. Setelah password valid, sistem membuat continuity mechanism:

```text
password verification -> authenticated session -> subsequent requests
```

Tanpa memahami session, engineer sering salah mengira bahwa keamanan login hanya bergantung pada password hash.

Padahal banyak account takeover terjadi setelah password verification selesai, melalui session fixation, stolen cookie, weak logout, atau distributed session bug.

---

## 35. Status Series

Part yang sudah selesai:

1. Part 0 — Orientation: Mental Model of Authentication in Java Systems
2. Part 1 — Java Runtime Security Foundations: Subject, Principal, Credential, Context
3. Part 2 — Authentication Taxonomy: Modes, Proof Types, and Trust Models
4. Part 3 — Password Authentication Done Properly

Status:

```text
Series belum selesai.
```



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authentication-modes-and-patterns-part-002.md">⬅️ Part 2 — Authentication Taxonomy: Modes, Proof Types, and Trust Models</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authentication-modes-and-patterns-part-004.md">Part 4 — Session-Based Authentication: Cookies, Server State, and Browser Reality ➡️</a>
</div>
