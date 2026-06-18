# Learn Java Part 015 — Security, Cryptography, dan Integrity di Java hingga Java 25

> Target pembaca: software engineer yang ingin memahami Java security bukan sebagai kumpulan API, tetapi sebagai model pertahanan sistem: bagaimana data dilindungi, bagaimana trust dibangun, bagaimana boundary dikontrol, bagaimana kesalahan crypto terjadi, dan bagaimana desain aplikasi tetap aman di production.

---

## 0. Posisi Bagian Ini dalam Roadmap

Pada bagian sebelumnya kita sudah membangun mental model tentang:

1. bahasa Java;
2. object model;
3. type system;
4. functional style;
5. collections;
6. error handling;
7. concurrency;
8. I/O;
9. text/Unicode/time;
10. JVM internal;
11. memory management;
12. observability.

Bagian ini menggabungkan semuanya dalam konteks **security**.

Security di Java bukan hanya:

```java
Cipher.getInstance("AES/GCM/NoPadding")
```

Security adalah desain sistem yang menjawab pertanyaan berikut:

- Data apa yang perlu dilindungi?
- Dari siapa data dilindungi?
- Pada boundary mana data berubah dari tidak dipercaya menjadi dipercaya?
- Algoritma apa yang dipakai?
- Kunci disimpan di mana?
- Siapa yang boleh melakukan operasi apa?
- Apa yang terjadi jika dependency, file, jaringan, serialized object, certificate, classpath, native library, atau configuration tidak dapat dipercaya?
- Bagaimana kita membuktikan bahwa sistem tidak diam-diam menurunkan level keamanan?

Java menyediakan banyak building block security:

- type safety;
- memory safety relatif terhadap C/C++;
- class loading;
- module encapsulation;
- JCA/JCE;
- JSSE/TLS;
- JAAS;
- KeyStore;
- certificate API;
- cryptographic provider model;
- serialization filtering;
- jar signing;
- security properties;
- algorithm constraints;
- preview PEM API di Java 25;
- final KDF API di Java 25;
- post-quantum crypto primitives dari JDK 24 yang tersedia dalam JDK 25.

Tetapi API yang banyak bukan berarti aplikasi otomatis aman. Justru Java security API sering disalahgunakan karena developer melihatnya sebagai “utility”, bukan sebagai **protocol dan trust model**.

---

# 1. Mental Model Security di Java

## 1.1 Security adalah properti sistem, bukan properti satu class

Sebuah class bisa memakai AES-GCM dengan benar, tetapi sistem tetap tidak aman jika:

- key disimpan hardcoded di source code;
- nonce/IV digunakan ulang;
- error message membocorkan secret;
- TLS certificate validation dimatikan;
- deserialization menerima object arbitrary;
- dependency supply-chain terinfeksi;
- log mengandung token;
- authorization dilakukan hanya di frontend;
- data integrity tidak dicek saat event replay;
- permission model tidak diterapkan di boundary domain.

Security harus dipikirkan sebagai pipeline:

```text
Untrusted input
  -> parse
  -> validate
  -> normalize
  -> authorize
  -> process
  -> persist
  -> emit event
  -> expose response/log/metric/trace
```

Setiap tahap punya risiko berbeda.

Top-tier Java engineer tidak bertanya:

> “Pakai library encryption apa?”

Mereka bertanya:

> “Threat model-nya apa, trust boundary-nya di mana, key lifecycle-nya bagaimana, dan failure mode-nya apa?”

---

## 1.2 CIA + AAA + Integrity-by-design

Security klasik sering diringkas sebagai CIA:

| Aspek | Pertanyaan | Contoh Java/system |
|---|---|---|
| Confidentiality | Siapa yang boleh membaca data? | AES-GCM, TLS, access control, secret management |
| Integrity | Bagaimana tahu data tidak berubah? | HMAC, digital signature, event hash chain, DB constraints |
| Availability | Bagaimana sistem tetap berjalan? | rate limit, timeout, circuit breaker, resource limits |

Untuk aplikasi enterprise, tambahkan AAA:

| Aspek | Pertanyaan |
|---|---|
| Authentication | Siapa aktornya? |
| Authorization | Apa yang boleh dilakukan aktor itu? |
| Accounting/Audit | Apa yang terjadi, oleh siapa, kapan, dan dengan bukti apa? |

Dalam sistem regulatory/case management, **integrity** sering lebih penting daripada encryption saja.

Contoh:

- status case tidak boleh lompat dari `DRAFT` langsung ke `CLOSED` tanpa approval;
- audit trail tidak boleh dapat diedit diam-diam;
- event harus idempotent;
- keputusan enforcement harus dapat direkonstruksi;
- attachment evidence harus punya hash;
- digital signature atau HMAC mungkin dibutuhkan untuk membuktikan origin dan non-tampering.

Security bukan hanya “data tidak bocor”, tetapi juga “data benar, sah, dapat dibuktikan, dan tidak berubah tanpa jejak”.

---

## 1.3 Threat model minimal untuk Java application

Sebelum menulis security code, buat model sederhana:

| Area | Pertanyaan |
|---|---|
| Asset | Apa yang dilindungi? Token, PII, credential, evidence, payment data, key? |
| Actor | User biasa, admin, integration partner, attacker eksternal, insider, compromised service? |
| Entry point | REST API, message broker, file upload, batch import, email, SFTP, DB CDC, CLI? |
| Trust boundary | Kapan data dianggap trusted? |
| Abuse case | Apa tindakan jahat yang realistis? |
| Detection | Bagaimana tahu abuse terjadi? |
| Recovery | Bagaimana rollback, revoke, rotate, isolate? |

Contoh threat model untuk endpoint upload evidence:

```text
Asset:
  - evidence file
  - metadata case
  - officer identity
  - audit trail

Entry points:
  - REST upload endpoint
  - object storage callback
  - malware scanner result

Threats:
  - file terlalu besar
  - path traversal di filename
  - MIME spoofing
  - malicious PDF
  - duplicate evidence overwrite
  - tampered metadata
  - unauthorized officer upload
  - log leaks filename containing PII

Controls:
  - size limit
  - content-type detection
  - random object key
  - hash digest
  - immutable evidence record
  - RBAC/ABAC authorization
  - malware scan state machine
  - audit event
  - object storage bucket policy
```

---

# 2. Java Security Model: Dulu dan Sekarang

## 2.1 Security Manager: sejarah singkat

Java sejak awal punya **Security Manager**, terutama untuk sandboxing applet dan kode tidak dipercaya. Ide dasarnya:

- class tertentu diberi permission tertentu;
- operasi sensitif seperti file/network/system property dapat dicek;
- `AccessController.doPrivileged` dipakai untuk menjalankan aksi dengan konteks permission tertentu;
- policy file mengontrol permission.

Namun model ini makin jarang dipakai untuk server-side application modern.

Alasannya:

1. Applet sudah mati.
2. Server-side security lebih banyak ditangani oleh OS, container, Kubernetes, IAM, network policy, sandbox process, seccomp/AppArmor/SELinux, dan dependency scanning.
3. Banyak aplikasi tidak berjalan dengan untrusted code di dalam JVM yang sama.
4. Security Manager sulit dipahami, sulit dipelihara, dan mahal untuk evolusi platform.

Di Java 17, Security Manager dideprecate for removal melalui JEP 411. Di JDK 24 dan seterusnya, termasuk JDK 25, Security Manager **permanently disabled**.

Implikasinya sangat penting:

> Jangan mendesain aplikasi modern dengan asumsi `SecurityManager` masih menjadi mekanisme sandbox.

---

## 2.2 Apa arti Security Manager disabled di Java 25?

Di Java 25:

- Security Manager tidak dapat di-enable saat startup.
- `System.setSecurityManager(...)` tidak lagi bisa dipakai untuk memasang custom manager.
- policy file Security Manager tidak menjadi fondasi kontrol akses aplikasi.
- beberapa API lama tetap ada untuk compatibility, tetapi tidak lagi menjadi mekanisme proteksi yang dapat diandalkan.

Contoh legacy yang harus dianggap obsolete:

```bash
java -Djava.security.manager -jar app.jar
```

Pendekatan modern:

```text
Security boundary dipindahkan ke:
  - OS user/process isolation
  - container isolation
  - Kubernetes securityContext
  - network policy
  - IAM/service account
  - database privileges
  - object storage bucket policy
  - application-level authorization
  - module encapsulation
  - dependency and artifact integrity
  - runtime observability
```

---

## 2.3 Java tetap punya security foundation

Security Manager mati bukan berarti Java tidak punya security.

Java tetap punya:

- type safety;
- memory safety;
- bytecode verification;
- class loading boundaries;
- JPMS module encapsulation;
- strong encapsulation terhadap internal JDK API;
- JCA/JCE;
- JSSE/TLS;
- PKI/certificate validation;
- KeyStore;
- signed JAR;
- algorithm constraints;
- serialization filtering;
- deserialization filter factory;
- security providers;
- native access restrictions direction;
- foreign memory API dengan lifetime safety.

Mental model-nya berubah:

```text
Old Java sandbox model:
  untrusted code inside JVM -> Security Manager policy

Modern Java security model:
  trusted application code inside JVM
  + untrusted input at boundaries
  + OS/container/cloud isolation
  + explicit app-level authorization
  + cryptographic integrity/confidentiality
  + supply-chain hardening
  + observability/audit
```

---

# 3. Secure Coding: Boundary Sebelum Crypto

Crypto tidak menyelamatkan desain boundary yang buruk.

Sebelum membahas JCA/JCE, pahami dulu bug security yang paling sering terjadi di aplikasi Java.

---

## 3.1 Input validation

Semua input eksternal harus dianggap tidak dipercaya:

- HTTP request;
- message broker payload;
- query parameter;
- header;
- file upload;
- CSV/Excel import;
- webhook;
- environment variable;
- system property;
- database value dari sistem lain;
- serialized object;
- XML/JSON/YAML;
- command-line argument;
- URL callback;
- S3/object storage event;
- Kafka event dari service lain.

Validasi yang baik bukan hanya regex.

Validasi harus mencakup:

| Dimensi | Contoh |
|---|---|
| Type | harus UUID, integer, enum, date |
| Range | amount > 0, date tidak lebih dari hari ini |
| Length | filename max 255, comment max 4000 |
| Format | email, UEN, NRIC-style masked ID |
| Domain invariant | transition state valid |
| Authorization | user boleh akses resource ini? |
| Consistency | `caseId` di path sama dengan body? |
| Normalization | Unicode normalization, trimming, case folding |
| Resource limit | max file size, max JSON depth, max rows |

Bad:

```java
public void updateCase(String caseId, String status) {
    repository.updateStatus(caseId, status);
}
```

Better:

```java
public void updateCase(String rawCaseId, String rawStatus, Actor actor) {
    CaseId caseId = CaseId.parse(rawCaseId);
    CaseStatus nextStatus = CaseStatus.parse(rawStatus);

    CaseRecord current = repository.findById(caseId)
            .orElseThrow(() -> new NotFoundException("Case not found"));

    authorization.requireCanTransition(actor, current, nextStatus);
    transitionPolicy.requireAllowed(current.status(), nextStatus);

    repository.save(current.transitionTo(nextStatus, actor));
}
```

Security benefit:

- input string tidak langsung masuk persistence;
- domain type membatasi format;
- authorization eksplisit;
- state invariant eksplisit;
- error boundary jelas.

---

## 3.2 Output encoding

Validasi input tidak menggantikan output encoding.

Contoh XSS:

```java
String html = "<p>" + userComment + "</p>";
```

Jika `userComment` berisi:

```html
<script>alert(1)</script>
```

maka browser menjalankan script.

Rule:

```text
Encode sesuai output context:
  HTML body       -> HTML escape
  HTML attribute  -> attribute escape
  JavaScript      -> JS string escape
  URL             -> URL encode
  SQL             -> parameterized query, bukan escape manual
  JSON            -> JSON serializer
  XML             -> XML escape/parser config
  Shell command   -> hindari shell; gunakan ProcessBuilder args
```

Java backend sering menganggap XSS urusan frontend. Itu salah jika backend:

- render server-side HTML;
- generate email HTML;
- generate PDF/HTML report;
- menyimpan data yang nanti ditampilkan UI;
- expose JSON yang dikonsumsi frontend tanpa sanitization contract.

---

## 3.3 Injection

Injection terjadi ketika data diperlakukan sebagai instruksi.

Jenis umum:

| Jenis | Contoh |
|---|---|
| SQL injection | concat query string |
| LDAP injection | concat filter LDAP |
| OS command injection | concat shell command |
| XPath/XML injection | concat query XML |
| Template injection | user input masuk template engine sebagai expression |
| Log injection | input mengandung newline/control char |
| Header injection | input mengandung CRLF |

Bad SQL:

```java
String sql = "select * from users where email = '" + email + "'";
```

Good SQL:

```java
String sql = "select * from users where email = ?";
try (PreparedStatement ps = connection.prepareStatement(sql)) {
    ps.setString(1, email);
    try (ResultSet rs = ps.executeQuery()) {
        // ...
    }
}
```

Bad command:

```java
Runtime.getRuntime().exec("convert " + fileName + " output.pdf");
```

Better:

```java
ProcessBuilder pb = new ProcessBuilder(
        "convert",
        safeInputPath.toString(),
        safeOutputPath.toString()
);
```

Tetap validasi path dan ekstensi. `ProcessBuilder` mengurangi shell parsing risk, tapi tidak membuat file otomatis aman.

---

## 3.4 Path traversal

Bad:

```java
Path root = Path.of("/data/uploads");
Path file = root.resolve(requestedFileName);
return Files.readAllBytes(file);
```

Jika `requestedFileName = "../../etc/passwd"`, path bisa keluar dari root.

Better:

```java
static Path resolveInsideRoot(Path root, String userInput) throws IOException {
    Path normalizedRoot = root.toRealPath();
    Path resolved = normalizedRoot.resolve(userInput).normalize();

    if (!resolved.startsWith(normalizedRoot)) {
        throw new SecurityException("Path escapes allowed root");
    }
    return resolved;
}
```

Tetapi hati-hati dengan symlink. Untuk sistem serius:

- gunakan object key random, bukan filename user;
- simpan original filename hanya sebagai metadata;
- jangan gunakan user filename untuk path actual;
- enforce allowed directory;
- pertimbangkan `toRealPath()` setelah file ada;
- batasi extension/content type;
- scan malware jika file dari user.

Best practice untuk upload:

```text
User filename:     "Evidence June.pdf"
Storage object key: evidence/2026/06/uuid-random.bin
Metadata:          originalFilename = "Evidence June.pdf"
Digest:            SHA-256(...)
Content type:      detected server-side
```

---

## 3.5 SSRF

SSRF terjadi ketika server mengambil URL yang dikontrol user.

Bad:

```java
URI uri = URI.create(request.url());
String body = httpClient.send(
        HttpRequest.newBuilder(uri).GET().build(),
        HttpResponse.BodyHandlers.ofString()
).body();
```

Attacker dapat mengirim URL seperti:

```text
http://169.254.169.254/latest/meta-data/
http://localhost:8080/admin
http://internal-service.default.svc.cluster.local
file:///etc/passwd
```

Mitigation:

- allowlist scheme: hanya `https`;
- allowlist host/domain;
- resolve DNS dan reject private/link-local/loopback IP;
- jangan follow redirect sembarangan;
- timeout ketat;
- size limit response;
- network egress policy;
- proxy outbound dengan allowlist;
- jangan expose raw response internal ke user.

Basic host policy:

```java
static void requireAllowedUri(URI uri) {
    if (!"https".equalsIgnoreCase(uri.getScheme())) {
        throw new SecurityException("Only HTTPS is allowed");
    }

    String host = uri.getHost();
    if (host == null || !host.endsWith(".trusted.example")) {
        throw new SecurityException("Host is not allowed");
    }
}
```

Catatan: validasi host string saja belum cukup untuk SSRF serius karena DNS rebinding dan IP literal tricks. Gunakan network-layer egress control.

---

## 3.6 XXE dan XML parser safety

XML External Entity dapat membuat parser membaca file lokal atau melakukan request jaringan.

Bad:

```java
DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
DocumentBuilder builder = factory.newDocumentBuilder();
Document doc = builder.parse(inputStream);
```

Safer baseline:

```java
DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
factory.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);
factory.setXIncludeAware(false);
factory.setExpandEntityReferences(false);

DocumentBuilder builder = factory.newDocumentBuilder();
Document doc = builder.parse(inputStream);
```

Untuk production:

- prefer JSON bila XML tidak perlu;
- disable external entities;
- batasi ukuran input;
- batasi depth;
- batasi entity expansion;
- hindari XML parser default tanpa config;
- test dengan malicious XML.

---

## 3.7 Secret leakage

Secret sering bocor melalui:

- log;
- exception;
- metrics label;
- trace attributes;
- thread dump;
- heap dump;
- config endpoint;
- actuator endpoint;
- error response;
- Git repository;
- CI/CD output;
- Docker layer;
- environment variable dump;
- command-line args.

Bad:

```java
log.info("Calling partner with token={} payload={}", token, payload);
```

Better:

```java
log.info("Calling partner requestId={} partner={} payloadSize={}",
        requestId,
        partnerCode,
        payloadSize);
```

Rule:

```text
Never log:
  - password
  - access token
  - refresh token
  - API key
  - private key
  - session cookie
  - OTP
  - full Authorization header
  - unmasked PII unless explicit audit need + access control
```

Masking helper:

```java
static String maskTail(String value, int visibleTail) {
    if (value == null || value.isBlank()) return "<empty>";
    int tail = Math.min(visibleTail, value.length());
    return "***" + value.substring(value.length() - tail);
}
```

Tetapi jangan over-rely pada masking; yang lebih baik adalah jangan masukkan secret ke log path sama sekali.

---

## 3.8 Timing attack basics

Timing attack terjadi ketika waktu eksekusi membocorkan informasi.

Bad token comparison:

```java
if (providedToken.equals(expectedToken)) {
    // authorized
}
```

`String.equals` berhenti saat karakter berbeda. Dalam konteks tertentu, attacker bisa mengukur waktu untuk menebak token byte by byte.

Better untuk byte secret:

```java
import java.security.MessageDigest;

boolean ok = MessageDigest.isEqual(providedBytes, expectedBytes);
```

Catatan:

- Jangan simpan token plaintext jika bisa simpan hash/HMAC token.
- Constant-time compare hanya satu bagian; rate limit, lockout, replay protection, dan monitoring tetap perlu.
- Timing attack realistis terutama pada local/high precision, tapi jangan menulis comparison secret yang jelas lemah.

---

# 4. Java Cryptography Architecture: Mental Model

## 4.1 JCA bukan satu implementation, tapi architecture

JCA/JCE menyediakan API abstrak untuk operasi cryptographic.

Mental model:

```text
Application code
  -> JCA/JCE API
      MessageDigest, Signature, Cipher, Mac, KeyPairGenerator, KeyStore, SecureRandom, KDF, KEM
  -> Provider lookup
      Sun, SunRsaSign, SunJCE, SunEC, SunJSSE, SunPKCS11, third-party provider
  -> Algorithm implementation
```

Contoh:

```java
MessageDigest digest = MessageDigest.getInstance("SHA-256");
```

Kode ini tidak membuat sendiri SHA-256. Ia meminta provider yang registered untuk memberi implementation.

Manfaat provider architecture:

- implementation independence;
- algorithm extensibility;
- hardware/HSM integration via PKCS#11;
- third-party provider;
- centralized algorithm policy.

Risiko:

- algorithm string salah;
- provider berbeda punya behavior/performance berbeda;
- relying on default provider tanpa sadar;
- incompatible algorithm availability across distributions;
- FIPS/compliance requirement tidak otomatis terpenuhi.

---

## 4.2 Provider lookup

JCA API biasanya punya method:

```java
getInstance(String algorithm)
getInstance(String algorithm, String provider)
getInstance(String algorithm, Provider provider)
```

Contoh:

```java
Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
```

JCA akan mencari provider yang mendukung transformation tersebut.

Untuk mengetahui provider:

```java
import java.security.Provider;
import java.security.Security;

public class ListProviders {
    public static void main(String[] args) {
        for (Provider p : Security.getProviders()) {
            System.out.println(p.getName() + " " + p.getVersionStr());
            p.getServices().stream()
                    .filter(s -> s.getType().equals("Cipher"))
                    .limit(5)
                    .forEach(s -> System.out.println("  " + s.getType() + " " + s.getAlgorithm()));
        }
    }
}
```

Top-tier rule:

```text
For ordinary app code:
  prefer standard algorithms and default provider unless compliance requires otherwise.

For regulated/FIPS/HSM contexts:
  be explicit about provider, key store, algorithm constraints, and operational certification.
```

---

## 4.3 Algorithm name vs transformation

Be precise.

For `MessageDigest`:

```java
MessageDigest.getInstance("SHA-256")
```

For `Mac`:

```java
Mac.getInstance("HmacSHA256")
```

For `Signature`:

```java
Signature.getInstance("SHA256withRSA")
```

For `Cipher`, usually transformation:

```java
Cipher.getInstance("AES/GCM/NoPadding")
```

`Cipher.getInstance("AES")` is dangerous because provider may choose defaults such as ECB mode.

Rule:

```text
Never use ambiguous transformation such as "AES".
Always specify mode and padding, e.g. "AES/GCM/NoPadding".
```

---

# 5. SecureRandom

## 5.1 Why randomness matters

Randomness digunakan untuk:

- key generation;
- IV/nonce;
- salt;
- token;
- session ID;
- password reset token;
- CSRF token;
- challenge;
- cryptographic protocol ephemeral value.

Bad:

```java
Random random = new Random();
String token = Long.toHexString(random.nextLong());
```

`java.util.Random` bukan cryptographically secure.

Better:

```java
import java.security.SecureRandom;
import java.util.Base64;

public final class Tokens {
    private static final SecureRandom RNG = new SecureRandom();

    public static String randomToken(int bytes) {
        byte[] value = new byte[bytes];
        RNG.nextBytes(value);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(value);
    }
}
```

Usage:

```java
String token = Tokens.randomToken(32); // 256-bit random token
```

---

## 5.2 SecureRandom rules

Do:

- use `SecureRandom` for security-sensitive randomness;
- generate at least 128-bit entropy for tokens, often 256-bit for long-lived secrets;
- use URL-safe Base64 for tokens in URLs;
- do not seed with predictable values;
- reuse `SecureRandom` instance or let JVM manage seeding;
- avoid exposing raw random bytes in logs.

Do not:

- use `Random`, `ThreadLocalRandom`, or `Math.random()` for secrets;
- create tokens from timestamp + user ID;
- use UUID as high-security secret unless threat model accepts it;
- truncate too aggressively;
- use predictable nonce for crypto mode that requires uniqueness/unpredictability incorrectly.

---

# 6. Hashing: MessageDigest

## 6.1 Hash is not encryption

Hash:

```text
input -> fixed-size digest
```

Properties desired:

- deterministic;
- preimage resistant;
- second-preimage resistant;
- collision resistant.

Hash is used for:

- file integrity;
- content fingerprint;
- cache key;
- event digest;
- signature input;
- Merkle tree;
- tamper detection when paired with trust mechanism.

Hash is not enough for authentication.

If attacker can modify both data and hash, hash does not protect anything.

Use HMAC or digital signature for authenticated integrity.

---

## 6.2 SHA-256 file digest

```java
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HexFormat;

public final class FileDigests {
    public static String sha256Hex(Path path) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");

        try (InputStream in = Files.newInputStream(path)) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = in.read(buffer)) != -1) {
                digest.update(buffer, 0, read);
            }
        }

        return HexFormat.of().formatHex(digest.digest());
    }
}
```

Design note:

- stream file; do not load entire file into memory;
- record digest with algorithm name and version;
- include digest in audit trail;
- digest alone does not prove who produced the file.

---

## 6.3 Password hashing is not ordinary hashing

Bad:

```java
String hash = sha256(password);
```

Why bad:

- too fast;
- no salt;
- vulnerable to rainbow table/dictionary attack;
- GPU/ASIC-friendly.

Use password hashing KDF:

- Argon2id preferred in modern systems when available through vetted provider/library;
- bcrypt/scrypt acceptable depending environment;
- PBKDF2 widely available in JDK but weaker than memory-hard options;
- parameter tuning matters.

PBKDF2 example with JDK:

```java
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import java.security.SecureRandom;
import java.util.Base64;

public final class PasswordHashes {
    private static final SecureRandom RNG = new SecureRandom();

    public static EncodedPassword hash(char[] password) throws Exception {
        byte[] salt = new byte[16];
        RNG.nextBytes(salt);

        int iterations = 600_000; // tune based on server budget and policy
        int keyLengthBits = 256;

        PBEKeySpec spec = new PBEKeySpec(password, salt, iterations, keyLengthBits);
        SecretKeyFactory factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256");
        byte[] hash = factory.generateSecret(spec).getEncoded();

        return new EncodedPassword(
                "PBKDF2WithHmacSHA256",
                iterations,
                Base64.getEncoder().encodeToString(salt),
                Base64.getEncoder().encodeToString(hash)
        );
    }

    public record EncodedPassword(
            String algorithm,
            int iterations,
            String saltBase64,
            String hashBase64
    ) {}
}
```

Rules:

- store algorithm + parameters + salt + hash;
- allow rehash on login when policy changes;
- compare using constant-time byte comparison;
- wipe char[] where practical, but be realistic about JVM copies;
- never log password or hash;
- rate-limit login attempts.

---

# 7. HMAC: Authenticated Integrity with Shared Secret

## 7.1 HMAC mental model

Hash alone:

```text
data -> digest
```

HMAC:

```text
secret key + data -> authentication tag
```

HMAC proves that someone with the secret key generated the tag.

Common uses:

- webhook signature;
- internal service request signing;
- tamper-evident event payload;
- signed callback URL;
- idempotency token integrity;
- audit chain.

---

## 7.2 HMAC-SHA256 example

```java
import javax.crypto.Mac;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;

public final class Hmacs {
    public static String signBase64(byte[] key, String message) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        SecretKey secretKey = new SecretKeySpec(key, "HmacSHA256");
        mac.init(secretKey);
        byte[] tag = mac.doFinal(message.getBytes(StandardCharsets.UTF_8));
        return Base64.getEncoder().encodeToString(tag);
    }

    public static boolean verifyBase64(byte[] key, String message, String expectedBase64) throws Exception {
        byte[] actual = Base64.getDecoder().decode(signBase64(key, message));
        byte[] expected = Base64.getDecoder().decode(expectedBase64);
        return MessageDigest.isEqual(actual, expected);
    }
}
```

Production protocol should sign canonical representation:

```text
method + "\n" +
path + "\n" +
timestamp + "\n" +
bodySha256Hex
```

Include:

- timestamp;
- nonce/request id;
- body digest;
- key id;
- algorithm;
- version.

Reject:

- old timestamp;
- reused nonce;
- unknown key id;
- invalid algorithm;
- invalid signature.

---

# 8. Symmetric Encryption: AES-GCM

## 8.1 Encryption goals

Encryption protects confidentiality.

But encryption alone may not protect integrity unless using authenticated encryption.

Use AEAD mode such as:

- AES-GCM;
- ChaCha20-Poly1305 if available/provider supports and appropriate.

Do not use:

- ECB;
- CBC without authentication;
- custom mode;
- homemade padding;
- reused IV/nonce in GCM.

---

## 8.2 AES-GCM mental model

AES-GCM inputs:

```text
key
IV/nonce
plaintext
AAD optional authenticated metadata
```

Outputs:

```text
ciphertext
authentication tag
```

AAD is not encrypted, but authenticated.

Example AAD:

- case ID;
- document type;
- tenant ID;
- algorithm version;
- created timestamp;
- key ID.

If AAD changes, decryption fails.

This is useful for binding ciphertext to context.

---

## 8.3 AES-GCM example

```java
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import java.security.SecureRandom;
import java.util.Base64;

public final class AesGcm {
    private static final SecureRandom RNG = new SecureRandom();
    private static final int IV_BYTES = 12;       // common recommendation for GCM
    private static final int TAG_BITS = 128;

    public static SecretKey generateKey() throws Exception {
        KeyGenerator kg = KeyGenerator.getInstance("AES");
        kg.init(256);
        return kg.generateKey();
    }

    public static Encrypted encrypt(SecretKey key, byte[] plaintext, byte[] aad) throws Exception {
        byte[] iv = new byte[IV_BYTES];
        RNG.nextBytes(iv);

        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, iv));
        if (aad != null) {
            cipher.updateAAD(aad);
        }
        byte[] ciphertextAndTag = cipher.doFinal(plaintext);

        return new Encrypted(
                "AES/GCM/NoPadding",
                Base64.getEncoder().encodeToString(iv),
                Base64.getEncoder().encodeToString(ciphertextAndTag)
        );
    }

    public static byte[] decrypt(SecretKey key, Encrypted encrypted, byte[] aad) throws Exception {
        byte[] iv = Base64.getDecoder().decode(encrypted.ivBase64());
        byte[] ciphertextAndTag = Base64.getDecoder().decode(encrypted.ciphertextBase64());

        Cipher cipher = Cipher.getInstance(encrypted.algorithm());
        cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, iv));
        if (aad != null) {
            cipher.updateAAD(aad);
        }
        return cipher.doFinal(ciphertextAndTag);
    }

    public record Encrypted(
            String algorithm,
            String ivBase64,
            String ciphertextBase64
    ) {}
}
```

Production notes:

- never reuse same IV with same key in GCM;
- store algorithm, key id, IV, ciphertext+tag;
- use random 96-bit IV for typical use;
- rotate key;
- separate encryption key from signing/HMAC key;
- do not log plaintext, key, IV+key context enough for attack analysis;
- consider envelope encryption with KMS/HSM.

---

## 8.4 Common AES mistakes

Bad:

```java
Cipher.getInstance("AES")
```

Reason: ambiguous, may imply ECB.

Bad:

```java
byte[] iv = new byte[12]; // all zero
```

Reason: nonce reuse breaks GCM security.

Bad:

```java
SecretKeySpec key = new SecretKeySpec(password.getBytes(UTF_8), "AES");
```

Reason: password bytes are not a cryptographic key.

Better:

- use KDF/password hashing scheme if deriving from password;
- use KMS/HSM-generated data key;
- use `KeyGenerator` for random symmetric key.

---

# 9. Key Management

## 9.1 Key management is harder than encryption

Many teams can write AES-GCM code. Fewer teams can answer:

- Who generated the key?
- Where is it stored?
- Who can read it?
- How is it rotated?
- How is old data decrypted after rotation?
- How is compromise handled?
- How is key usage audited?
- Is key material in heap dump?
- Is key material in log/traces?
- Is key accessible by CI/CD?
- Is key environment-specific?

Encryption without key management is theater.

---

## 9.2 Key hierarchy

Common production design:

```text
KMS/HSM master key
  -> encrypts data encryption key (DEK)
      -> DEK encrypts actual data
```

Envelope encryption record:

```json
{
  "algorithm": "AES/GCM/NoPadding",
  "keyId": "kms-key-prod-2026-01",
  "encryptedDataKey": "...",
  "iv": "...",
  "ciphertext": "...",
  "aadVersion": 1
}
```

Benefits:

- data encrypted with fast local symmetric key;
- DEK protected by KMS/HSM;
- key rotation manageable;
- audit key decrypt operations;
- blast radius reduced.

---

## 9.3 Key rotation strategy

Rotation types:

| Type | Description |
|---|---|
| Key version rotation | new writes use new key, old reads use old key |
| Re-encryption | old ciphertext decrypted and encrypted with new key |
| Key wrapping rotation | re-wrap encrypted data keys, data ciphertext unchanged |
| Emergency revoke | compromised key disabled, affected data quarantined/recovered |

Data record should contain:

- algorithm;
- key id;
- key version;
- IV/nonce;
- tag length;
- encoding;
- creation timestamp.

Do not design encryption format without metadata.

Bad:

```text
base64(ciphertext)
```

Better:

```text
v1:kid=case-dek-2026-01:alg=AES-GCM-256:iv=...:ct=...
```

Or structured JSON/binary envelope.

---

# 10. KeyStore, Certificates, and PKI

## 10.1 KeyStore mental model

Java `KeyStore` is a storage abstraction for:

- private keys;
- secret keys;
- trusted certificates;
- certificate chains.

Common types:

- `PKCS12` modern default in many Java contexts;
- `JKS` legacy Java keystore;
- `PKCS11` for hardware token/HSM provider use cases.

Basic load:

```java
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;

public final class KeyStores {
    public static KeyStore loadPkcs12(Path path, char[] password) throws Exception {
        KeyStore ks = KeyStore.getInstance("PKCS12");
        try (InputStream in = Files.newInputStream(path)) {
            ks.load(in, password);
        }
        return ks;
    }
}
```

Rules:

- do not commit keystores with real keys;
- do not put keystore password in source;
- restrict file permissions;
- rotate keystore password;
- prefer secret manager/KMS integration in cloud;
- use separate keystores/truststores per environment;
- know whether store contains private key or only trust anchors.

---

## 10.2 keytool

`keytool` manages keys and certificates.

Examples:

Generate keypair:

```bash
keytool -genkeypair \
  -alias app-server \
  -keyalg RSA \
  -keysize 3072 \
  -validity 365 \
  -keystore server.p12 \
  -storetype PKCS12
```

List keystore:

```bash
keytool -list -v -keystore server.p12 -storetype PKCS12
```

Generate CSR:

```bash
keytool -certreq \
  -alias app-server \
  -keystore server.p12 \
  -file server.csr
```

Import certificate chain:

```bash
keytool -importcert \
  -alias app-server \
  -keystore server.p12 \
  -file server-chain.pem
```

Production note:

- Use appropriate key algorithm and size per policy.
- Prefer CA-issued certificates for production service identity.
- Automate certificate rotation.
- Monitor expiry.

---

## 10.3 Certificate validation mental model

Certificate trust is not:

```text
certificate exists -> trusted
```

It is:

```text
certificate chain builds to trusted anchor
AND certificate is within validity period
AND key usage is appropriate
AND name matches endpoint
AND constraints/policies pass
AND revocation policy if enabled passes
AND algorithm constraints pass
```

Common failure:

- self-signed cert trusted accidentally;
- hostname verification disabled;
- trust-all manager;
- expired cert;
- wrong SAN;
- missing intermediate cert;
- weak signature algorithm;
- mTLS client certificate accepted without mapping to identity/authorization.

---

# 11. TLS/JSSE

## 11.1 JSSE mental model

JSSE provides Java TLS/DTLS implementation and API around:

- `SSLContext`;
- `SSLSocket`;
- `SSLEngine`;
- `TrustManager`;
- `KeyManager`;
- `HostnameVerifier`;
- `HttpsURLConnection`;
- `HttpClient` TLS integration.

TLS provides:

- confidentiality;
- integrity;
- server authentication;
- optional client authentication.

TLS does not automatically provide:

- application authorization;
- protection after data reaches server memory;
- protection against compromised server;
- protection if you trust the wrong CA;
- business-level integrity.

---

## 11.2 Never disable certificate validation

Bad:

```java
TrustManager[] trustAll = new TrustManager[] {
    new X509TrustManager() {
        public void checkClientTrusted(X509Certificate[] chain, String authType) {}
        public void checkServerTrusted(X509Certificate[] chain, String authType) {}
        public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
    }
};
```

Bad:

```java
hostnameVerifier = (hostname, session) -> true;
```

These are acceptable only in isolated throwaway local test code, never in committed production code.

Better:

- use proper truststore;
- configure CA bundle;
- enforce hostname verification;
- use mTLS with explicit trust and identity mapping;
- automate cert provisioning.

---

## 11.3 SSLContext with custom truststore

```java
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManagerFactory;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;

public final class TlsContexts {
    public static SSLContext fromTrustStore(Path trustStorePath, char[] password) throws Exception {
        KeyStore trustStore = KeyStore.getInstance("PKCS12");
        try (InputStream in = Files.newInputStream(trustStorePath)) {
            trustStore.load(in, password);
        }

        TrustManagerFactory tmf = TrustManagerFactory.getInstance(
                TrustManagerFactory.getDefaultAlgorithm()
        );
        tmf.init(trustStore);

        SSLContext context = SSLContext.getInstance("TLS");
        context.init(null, tmf.getTrustManagers(), null);
        return context;
    }
}
```

Usage with `HttpClient`:

```java
HttpClient client = HttpClient.newBuilder()
        .sslContext(TlsContexts.fromTrustStore(Path.of("truststore.p12"), password))
        .build();
```

---

## 11.4 mTLS design

mTLS gives both sides certificates.

But mTLS authentication must be mapped to application identity.

Bad:

```text
client cert valid -> allow all operations
```

Better:

```text
client cert valid
  -> extract identity from SAN/subject/extension
  -> map to service account / partner / tenant
  -> apply authorization policy
  -> audit identity + certificate fingerprint
```

mTLS is transport-level identity, not domain permission.

---

# 12. Digital Signatures

## 12.1 Signature vs HMAC

| Feature | HMAC | Digital Signature |
|---|---|---|
| Key model | shared secret | private/public key |
| Verifier can forge? | yes, verifier has secret | no, verifier has public key only |
| Non-repudiation-ish | weak | stronger |
| Common use | internal APIs/webhooks | documents, artifacts, external proofs |
| Performance | fast | slower |

Use HMAC when both sides are trusted to share a secret.

Use digital signature when verifier should not be able to sign.

---

## 12.2 RSA/ECDSA signature example

```java
import java.security.*;
import java.util.Base64;

public final class Signatures {
    public static KeyPair generateRsaKeyPair() throws Exception {
        KeyPairGenerator kpg = KeyPairGenerator.getInstance("RSA");
        kpg.initialize(3072);
        return kpg.generateKeyPair();
    }

    public static String signBase64(PrivateKey privateKey, byte[] data) throws Exception {
        Signature sig = Signature.getInstance("SHA256withRSA");
        sig.initSign(privateKey);
        sig.update(data);
        return Base64.getEncoder().encodeToString(sig.sign());
    }

    public static boolean verify(PublicKey publicKey, byte[] data, String signatureBase64) throws Exception {
        Signature sig = Signature.getInstance("SHA256withRSA");
        sig.initVerify(publicKey);
        sig.update(data);
        return sig.verify(Base64.getDecoder().decode(signatureBase64));
    }
}
```

Production rules:

- sign canonical bytes, not ambiguous object representation;
- include algorithm/key id/signature version;
- manage public key distribution;
- rotate signing keys;
- timestamp signature;
- protect private key in HSM/KMS where appropriate;
- verify certificate chain if public key comes from certificate;
- do not confuse signature with encryption.

---

## 12.3 Signing domain events

For tamper-evident event:

```json
{
  "eventId": "...",
  "caseId": "...",
  "type": "CASE_ESCALATED",
  "version": 7,
  "occurredAt": "2026-06-11T10:15:30Z",
  "payload": { ... },
  "hash": "sha256:...",
  "signature": {
    "algorithm": "SHA256withRSA",
    "keyId": "signing-key-2026-01",
    "value": "..."
  }
}
```

Canonicalization matters. JSON field order, whitespace, number formatting, Unicode normalization, and timestamp format can break verification.

Prefer signing a canonical binary representation or explicitly canonicalized JSON.

---

# 13. JAR Signing and Artifact Integrity

## 13.1 Why sign artifacts?

JAR signing can verify that an artifact was signed by a holder of a private key and has not been modified since signing.

Useful for:

- plugin systems;
- internal distribution;
- regulated release artifacts;
- supply-chain evidence;
- code provenance.

But signed JAR is not full supply-chain security by itself.

You still need:

- dependency verification;
- repository trust;
- CI/CD hardening;
- SBOM;
- vulnerability scanning;
- reproducible builds when possible;
- artifact promotion controls.

---

## 13.2 jarsigner basic flow

```bash
jar --create --file app.jar -C build/classes .

jarsigner \
  -keystore signing.p12 \
  -storetype PKCS12 \
  -signedjar app-signed.jar \
  app.jar signing-key

jarsigner -verify -verbose -certs app-signed.jar
```

Timestamping matters because certificates expire.

```bash
jarsigner \
  -tsa https://timestamp.example/tsa \
  -keystore signing.p12 \
  -storetype PKCS12 \
  app.jar signing-key
```

---

# 14. Java 25 Cryptography Updates

## 14.1 KDF API finalized in Java 25

Java 25 finalizes the Key Derivation Function API.

KDF is used to derive additional keys or key material from a secret and other context.

Important distinction:

```text
KeyGenerator:
  creates new random key material

KDF:
  deterministically derives key material from input key material + salt/info/context
```

Use cases:

- HKDF in protocol key schedule;
- derive encryption and MAC keys from shared secret;
- HPKE/TLS-related building blocks;
- KEM integration;
- structured derivation instead of ad-hoc hash concatenation.

Conceptual HKDF example:

```java
import javax.crypto.KDF;
import javax.crypto.SecretKey;
import javax.crypto.spec.HKDFParameterSpec;
import java.security.spec.AlgorithmParameterSpec;

public final class HkdfExample {
    public static SecretKey deriveAesKey(byte[] ikm, byte[] salt, byte[] info) throws Exception {
        KDF hkdf = KDF.getInstance("HKDF-SHA256");

        AlgorithmParameterSpec params = HKDFParameterSpec.ofExtract()
                .addIKM(ikm)
                .addSalt(salt)
                .thenExpand(info, 32);

        return hkdf.deriveKey("AES", params);
    }
}
```

Design rule:

- use HKDF `salt` and `info` deliberately;
- `info` should bind derived key to purpose/context;
- derive separate keys for separate purposes;
- never derive encryption and MAC key by manual slicing of a hash unless protocol specifically defines it.

Example purpose separation:

```text
HKDF(..., info="case-event/encryption/v1") -> AES key
HKDF(..., info="case-event/hmac/v1")       -> HMAC key
```

---

## 14.2 PEM API preview in Java 25

PEM is widely used for:

- public keys;
- private keys;
- certificates;
- certificate chains;
- certificate revocation lists.

Before Java 25, Java could handle many underlying binary formats, but PEM parsing often required manual Base64/header/footer handling or third-party libraries.

Java 25 introduces a preview API for PEM encoding/decoding of cryptographic objects.

Because it is preview in Java 25:

- compile/run with preview enabled where required;
- do not treat API shape as permanently stable;
- isolate usage behind your own adapter if adopting early.

Conceptual command:

```bash
javac --release 25 --enable-preview PemExample.java
java --enable-preview PemExample
```

Production rule:

```text
Preview API can be evaluated, but adopting it in long-lived enterprise code requires explicit migration policy.
```

---

## 14.3 Post-quantum algorithms available from JDK 24 into JDK 25

JDK 24 added implementations for:

- ML-KEM: Module-Lattice-Based Key Encapsulation Mechanism;
- ML-DSA: Module-Lattice-Based Digital Signature Algorithm.

In JDK 25, these are part of the platform inherited from JDK 24.

Mental model:

| Algorithm | Purpose |
|---|---|
| ML-KEM | establish/shared symmetric key material over insecure channel |
| ML-DSA | sign and verify data with post-quantum-resistant signature |

Do not randomly replace TLS/application crypto with ML-KEM/ML-DSA without protocol support.

Use cases today:

- experimentation;
- long-term confidentiality planning;
- hybrid protocol designs;
- compliance roadmap;
- internal prototypes;
- future-ready cryptographic architecture.

Important caveat:

```text
Cryptographic primitive availability != complete protocol readiness.
```

You need:

- protocol design;
- key format;
- certificate support;
- TLS/library support;
- interoperability;
- standardization;
- compliance review;
- performance testing;
- migration plan.

---

# 15. PEM, DER, X.509, PKCS: Format Mental Model

## 15.1 Encoding stack

Common confusion:

```text
Key/certificate object
  -> ASN.1 structure
  -> DER binary encoding
  -> Base64
  -> PEM text wrapper
```

Example PEM:

```text
-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A...
-----END PUBLIC KEY-----
```

The header matters:

| Header | Meaning |
|---|---|
| `BEGIN CERTIFICATE` | X.509 certificate |
| `BEGIN PUBLIC KEY` | SubjectPublicKeyInfo |
| `BEGIN PRIVATE KEY` | PKCS#8 private key |
| `BEGIN ENCRYPTED PRIVATE KEY` | encrypted PKCS#8 private key |
| `BEGIN RSA PRIVATE KEY` | PKCS#1 RSA private key, common from OpenSSL |

Java APIs often expect specific encodings:

- `X509EncodedKeySpec` for public key;
- `PKCS8EncodedKeySpec` for private key;
- `CertificateFactory` for X.509 certificate.

---

## 15.2 Manual PEM parsing is easy to get wrong

Common mistakes:

- accepting wrong header;
- ignoring encrypted private key;
- stripping lines incorrectly;
- not validating algorithm;
- not validating certificate chain;
- assuming public key alone means identity;
- storing private key unencrypted;
- logging PEM content.

If using Java 25 PEM preview API, prefer it over ad-hoc parsing once adoption policy is acceptable.

If using third-party libraries, choose maintained and well-reviewed libraries.

---

# 16. Deserialization Security

## 16.1 Java serialization risk

Java Object Serialization can instantiate object graphs and trigger code paths during deserialization.

Risk:

- gadget chains;
- remote code execution;
- denial of service via huge object graph;
- memory exhaustion;
- type confusion;
- bypass constructor invariants;
- unexpected class loading.

Rule:

```text
Do not deserialize untrusted Java serialized objects.
```

If you must:

- use `ObjectInputFilter`;
- allowlist classes;
- limit depth;
- limit references;
- limit bytes;
- isolate process;
- sign/encrypt payload;
- migrate to safer format.

---

## 16.2 ObjectInputFilter example

```java
import java.io.*;

public final class SafeDeserialization {
    public static Object readAllowed(InputStream input) throws Exception {
        ObjectInputFilter filter = ObjectInputFilter.Config.createFilter(
                "maxdepth=10;maxrefs=1000;maxbytes=1048576;" +
                "com.example.safe.*;java.base/*;!*"
        );

        try (ObjectInputStream ois = new ObjectInputStream(input)) {
            ois.setObjectInputFilter(filter);
            return ois.readObject();
        }
    }
}
```

Filter syntax above is illustrative; test your filter carefully.

Rules:

- default deny is preferred;
- allowlist minimal packages/classes;
- set global filter for legacy systems;
- set stream-specific filter for context;
- monitor rejected deserialization attempts;
- never accept serialized object from public internet.

---

## 16.3 JSON is not automatically safe

Replacing Java serialization with JSON reduces gadget risk, but JSON parsers can still be dangerous if:

- polymorphic deserialization is enabled broadly;
- type info from input controls class instantiation;
- parser has no size/depth limit;
- unknown fields ignored in security-sensitive command;
- duplicate fields handled unexpectedly;
- numeric precision changes;
- date parsing ambiguous;
- input maps directly to entity without validation.

Bad Jackson pattern:

```java
objectMapper.enableDefaultTyping(); // dangerous legacy pattern
```

Better:

- avoid global default typing;
- use explicit DTOs;
- validate DTO before domain conversion;
- use sealed/domain type mapping explicitly;
- limit payload size at HTTP layer;
- fail on unknown fields for command APIs when appropriate.

---

# 17. Class Loading, Reflection, Agents, and Integrity

## 17.1 Classpath is an execution boundary

Anything on classpath/module path can execute code:

- static initializer;
- service loader provider;
- annotation processor at build time;
- Java agent;
- reflection-invoked class;
- framework auto-configuration;
- deserialization gadget;
- logging implementation;
- JDBC driver.

Security consequence:

```text
Dependency is code execution.
```

Dependency hygiene:

- pin versions;
- use dependency lock/verification;
- scan vulnerabilities;
- remove unused dependencies;
- avoid untrusted repositories;
- validate plugin dependencies;
- isolate build pipeline;
- review annotation processors;
- use SBOM;
- verify checksums/signatures where possible.

---

## 17.2 Annotation processors are build-time code execution

Annotation processors run during compilation.

That means compromised annotation processor can:

- read source files;
- read environment variables;
- exfiltrate secrets available in build env;
- generate malicious code;
- modify build output.

Rules:

- treat annotation processors as privileged build dependencies;
- do not put CI production secrets in build environment;
- pin versions;
- review processors;
- isolate build;
- use dependency verification.

---

## 17.3 Java agents

Java agents can instrument bytecode.

Useful for:

- observability;
- profiling;
- security monitoring;
- APM;
- test instrumentation.

Risk:

- agent can alter application behavior;
- agent can see method arguments;
- agent can exfiltrate data;
- agent can weaken security;
- agent can cause startup/performance issues.

Rule:

```text
-javaagent is a high-trust operational control. Treat it like code running inside your application.
```

---

# 18. Unsafe, Native Boundary, JNI, and FFM

## 18.1 Java memory safety stops at unsafe/native boundary

Java normally prevents:

- arbitrary pointer arithmetic;
- use-after-free;
- buffer overflow;
- type confusion via raw memory.

But this safety can be bypassed by:

- `sun.misc.Unsafe`;
- JNI;
- native libraries;
- direct memory misuse;
- reflection/internal API access;
- foreign memory misuse.

Modern Java direction is:

```text
reduce dependence on internal unsafe APIs
move native interop toward Foreign Function & Memory API
strengthen integrity by default
warn/restrict dangerous native/unsafe access over time
```

---

## 18.2 Unsafe risk

`Unsafe` can:

- allocate memory manually;
- read/write arbitrary memory offsets;
- bypass constructors;
- mutate final fields;
- break type safety;
- crash JVM.

Use only if:

- building low-level library;
- no safer API exists;
- behavior is tested across JDK versions;
- encapsulated behind narrow API;
- risk is documented;
- migration plan exists.

Application business code should almost never use `Unsafe`.

---

## 18.3 JNI risk

JNI lets Java call native code.

Risk:

- memory corruption;
- JVM crash;
- platform-specific behavior;
- library loading hijack;
- secret leakage;
- thread attachment bugs;
- resource lifecycle bugs;
- supply-chain risk in native binary.

Rules:

- load native libraries from controlled path;
- verify checksums/signatures;
- avoid user-controlled library names;
- isolate process for high-risk native code;
- monitor crash logs;
- prefer FFM API where suitable;
- maintain platform-specific test matrix.

---

## 18.4 FFM API as safer direction

Foreign Function & Memory API provides:

- `MemorySegment`;
- `Arena`;
- `MemoryLayout`;
- `Linker`;
- scoped lifetime management;
- bounds/lifetime checks.

It does not remove all risk, but it makes native interop more explicit and manageable than ad-hoc JNI/Unsafe in many cases.

Security mindset:

```text
Native interop is a trust boundary.
Treat native calls as external system calls, not ordinary Java methods.
```

---

# 19. Authentication and Authorization in Java Apps

## 19.1 Authentication vs authorization

Authentication:

```text
Who are you?
```

Authorization:

```text
Are you allowed to do this action on this resource in this context?
```

Common bug:

```text
User is logged in -> allow operation
```

Better:

```text
Actor + action + resource + context -> policy decision
```

Example:

```java
public interface AuthorizationPolicy {
    void requireAllowed(Actor actor, Action action, Resource resource, Context context);
}
```

---

## 19.2 RBAC vs ABAC vs domain policy

RBAC:

```text
role -> permission
```

Example:

```text
ENFORCEMENT_OFFICER can CREATE_CASE
SUPERVISOR can APPROVE_ESCALATION
ADMIN can MANAGE_USERS
```

ABAC:

```text
attributes -> decision
```

Example:

```text
officer.region == case.region
AND case.status == UNDER_REVIEW
AND actor.clearance >= requiredClearance
```

Domain policy:

```text
case transition allowed only if required evidence exists and supervisor approved
```

Top-tier systems combine them:

```text
Authentication identity
  -> roles/scopes
  -> resource attributes
  -> domain invariant
  -> decision
  -> audit
```

---

## 19.3 Authorization must be server-side

Frontend authorization is UX, not security.

Backend must enforce:

- object-level access;
- action-level access;
- tenant boundary;
- state transition permissions;
- field-level restrictions;
- data export restrictions;
- admin operation approval.

Bad:

```java
@GetMapping("/cases/{id}")
CaseDto get(@PathVariable String id) {
    return caseService.get(id);
}
```

Better:

```java
@GetMapping("/cases/{id}")
CaseDto get(@PathVariable String id, AuthenticatedUser user) {
    CaseRecord record = caseService.get(CaseId.parse(id));
    authorization.requireCanView(user.toActor(), record);
    return mapper.toDto(record);
}
```

---

# 20. Token, Session, and API Key Handling

## 20.1 Token storage

Rules:

- access token short-lived;
- refresh token protected and rotated;
- API key hashed at rest if possible;
- token should have audience/scope/issuer/expiry;
- never log token;
- never put long-lived token in URL;
- use HTTPS;
- apply replay protection for sensitive operations.

API key storage pattern:

```text
raw key shown once
store:
  keyId
  hash/HMAC(raw key)
  owner
  scopes
  createdAt
  expiresAt
  lastUsedAt
  status
```

Verification:

```text
extract keyId
load active key metadata
compute HMAC/hash of provided key
constant-time compare
check scope/expiry/status
record usage
```

---

## 20.2 JWT pitfalls

JWT is a token format, not a security architecture.

Common mistakes:

- accepting `alg=none`;
- not validating issuer;
- not validating audience;
- not checking expiry;
- using access token as long-lived session;
- storing sensitive PII in JWT claims;
- trusting roles from token issued by wrong issuer;
- weak key;
- no key rotation/JWKS caching policy;
- no revocation story.

Rule:

```text
Validate signature, issuer, audience, expiry, not-before, algorithm, key id, and scopes.
```

---

# 21. Security in Logging, Metrics, Tracing, and Dumps

## 21.1 Observability can leak secrets

From Part 14, observability is critical. But security requires observability hygiene.

Sensitive sinks:

- logs;
- metrics labels;
- trace attributes;
- JFR events;
- heap dump;
- thread dump;
- crash dump;
- audit export;
- support bundle.

Rules:

- never put secrets in MDC;
- avoid high-cardinality PII metrics labels;
- redact Authorization/Cookie headers;
- secure access to observability backend;
- encrypt support bundles;
- apply retention policy;
- restrict heap dump generation in production;
- treat heap dump as sensitive artifact.

---

## 21.2 Secure audit vs ordinary log

Ordinary log:

```text
for debugging/operation
```

Audit log:

```text
for accountability/evidence
```

Audit event should capture:

- actor;
- action;
- resource;
- decision;
- timestamp;
- source system;
- correlation id;
- before/after when allowed;
- reason/rejection code;
- policy version;
- integrity marker/hash/signature if needed.

Do not mix audit semantics into arbitrary debug logs.

---

# 22. Supply Chain Security for Java

## 22.1 Dependency risk

Java apps often include hundreds of transitive dependencies.

Risk:

- vulnerable library;
- malicious package;
- dependency confusion;
- compromised maintainer;
- abandoned project;
- malicious Maven plugin;
- malicious annotation processor;
- build script exfiltration;
- unsafe shaded copy;
- version conflict hiding patched dependency.

---

## 22.2 Controls

Recommended controls:

- use Maven/Gradle lockfiles or version catalogs;
- pin plugin versions;
- avoid dynamic versions;
- use dependency verification/checksums;
- generate SBOM;
- scan dependencies;
- fail builds on critical vulnerabilities with reachable risk review;
- restrict repositories;
- use internal artifact proxy;
- separate build credentials from production credentials;
- review dependency diff in PR;
- remove unused dependencies.

Maven example principle:

```xml
<dependencyManagement>
  <!-- centralize versions via BOM -->
</dependencyManagement>
```

Gradle principle:

```kotlin
dependencyLocking {
    lockAllConfigurations()
}
```

Do not let CI fetch arbitrary dependency versions from arbitrary repositories.

---

# 23. Secure Defaults and Security Properties

## 23.1 Algorithm constraints

Java security can restrict weak algorithms via security properties.

Examples of things often constrained:

- weak TLS protocol versions;
- weak key sizes;
- MD5/SHA1 in certificate signatures;
- legacy algorithms;
- disabled named curves;
- jar signing algorithms.

Do not “fix” production by re-enabling weak algorithms unless there is explicit temporary risk acceptance and migration plan.

---

## 23.2 Backward compatibility vs security

Security upgrades often break old integrations.

Examples:

- partner only supports TLS 1.0;
- old certificate uses SHA1;
- old key size too small;
- old JAR signature algorithm disabled;
- old DB driver uses weak crypto;
- old LDAP endpoint has invalid cert.

Weak response:

```text
Disable validation globally.
```

Strong response:

```text
Scope exception narrowly
Document risk acceptance
Set expiry date
Monitor usage
Plan partner migration
Keep global default secure
```

---

# 24. Case Study: Secure Evidence Package

## 24.1 Requirement

Design a Java service that stores and transfers regulatory evidence packages.

Requirements:

- evidence file confidentiality;
- evidence integrity;
- officer identity;
- tamper-evident metadata;
- external partner verification;
- key rotation;
- audit trail;
- no secrets in logs;
- support large files.

---

## 24.2 Design

```text
Upload request
  -> authenticate officer
  -> authorize case access
  -> validate file size/type
  -> stream SHA-256 digest
  -> malware scan pending
  -> generate DEK
  -> AES-GCM encrypt file stream
  -> AAD = caseId + evidenceId + metadataVersion
  -> wrap DEK with KMS
  -> store encrypted object
  -> persist metadata with digest + keyId + encryptedDEK + iv
  -> emit EvidenceUploaded event
  -> sign event or HMAC internal event
  -> audit action
```

Metadata:

```json
{
  "evidenceId": "evd-123",
  "caseId": "case-456",
  "objectKey": "evidence/2026/06/...",
  "originalFilename": "statement.pdf",
  "contentType": "application/pdf",
  "size": 1048576,
  "sha256": "...",
  "encryption": {
    "algorithm": "AES/GCM/NoPadding",
    "keyId": "kms-prod-evidence-2026-01",
    "encryptedDataKey": "...",
    "iv": "...",
    "aadVersion": 1
  },
  "audit": {
    "uploadedBy": "officer-001",
    "uploadedAt": "2026-06-11T10:15:30Z"
  }
}
```

---

## 24.3 Failure model

| Failure | Handling |
|---|---|
| Upload interrupted | abort incomplete object |
| Encryption fails | no metadata commit |
| Metadata commit fails after object write | delete/quarantine orphan object |
| Malware scan fails | state = SCAN_FAILED, no release |
| KMS unavailable | fail closed, retry with backoff |
| Digest mismatch | reject, audit security event |
| Unauthorized user | deny, audit decision |
| Key compromised | identify affected keyId, rotate/quarantine/re-encrypt |

---

# 25. Security Code Review Checklist

## 25.1 Input and boundary

- [ ] Is every external input identified?
- [ ] Is validation done before domain processing?
- [ ] Are size/depth/resource limits enforced?
- [ ] Is Unicode normalization/case handling correct where needed?
- [ ] Is authorization server-side and object-level?
- [ ] Are state transitions guarded by domain policy?

## 25.2 Crypto

- [ ] No custom crypto algorithm.
- [ ] No ambiguous `Cipher.getInstance("AES")`.
- [ ] AEAD mode used for encryption where appropriate.
- [ ] IV/nonce unique for key.
- [ ] Key generated/stored/rotated properly.
- [ ] Algorithm/key id stored with ciphertext/signature.
- [ ] HMAC/signature verifies canonical bytes.
- [ ] Constant-time compare used for secret tags/tokens.
- [ ] Password hashing uses proper KDF parameters.
- [ ] Secret not logged.

## 25.3 TLS/PKI

- [ ] Certificate validation not disabled.
- [ ] Hostname verification enabled.
- [ ] Truststore scoped correctly.
- [ ] mTLS identity mapped to app authorization.
- [ ] Cert expiry monitored.
- [ ] Weak protocol/algorithm not re-enabled globally.

## 25.4 Serialization/deserialization

- [ ] No untrusted Java deserialization.
- [ ] `ObjectInputFilter` used if legacy serialization required.
- [ ] JSON polymorphic typing not globally enabled.
- [ ] DTO validation before domain conversion.
- [ ] Payload size/depth limited.

## 25.5 Supply chain/runtime

- [ ] Dependency versions pinned.
- [ ] Build plugins trusted and pinned.
- [ ] Annotation processors reviewed.
- [ ] SBOM generated.
- [ ] Vulnerability scanning configured.
- [ ] Java agents approved.
- [ ] Native libraries controlled.

## 25.6 Observability

- [ ] Logs do not contain secrets.
- [ ] Metrics labels do not contain PII/secrets.
- [ ] Traces redact sensitive headers/attributes.
- [ ] Heap dumps protected.
- [ ] Audit log is distinct from debug log.
- [ ] Security events are detectable.

---

# 26. Common Anti-Patterns

## 26.1 Crypto anti-patterns

```java
Cipher.getInstance("AES");              // ambiguous, often ECB risk
MessageDigest.getInstance("MD5");       // broken for security use
new Random();                            // not secure random
password.getBytes();                     // not a key
iv = new byte[12];                       // repeated IV
String.equals(secret);                   // timing leak risk
```

## 26.2 TLS anti-patterns

```java
trustAllCerts();
hostnameVerifier = (h, s) -> true;
System.setProperty("jdk.tls.client.protocols", "TLSv1");
```

## 26.3 Authorization anti-patterns

```text
admin endpoint hidden in UI only
role checked but resource ownership ignored
service-to-service call trusted without caller identity
JWT accepted without issuer/audience validation
mTLS cert accepted without mapping to domain actor
```

## 26.4 Logging anti-patterns

```text
log full request headers
log Authorization token
log payload with PII by default
put user email in metric label
export heap dump to shared bucket
```

## 26.5 Deserialization anti-patterns

```text
ObjectInputStream on public endpoint
Jackson default typing globally enabled
YAML parser on untrusted input with unsafe constructors
no size/depth limit
```

---

# 27. Practical Labs

## Lab 1 — Provider Inventory

Write a program that lists installed security providers and supported services.

Goals:

- understand provider architecture;
- see available algorithms;
- compare JDK distributions if needed.

---

## Lab 2 — Secure Token Generator

Build:

- random token generator;
- API key hash storage;
- constant-time verification;
- key id prefix.

Example token format:

```text
ak_live_AbCdEf...
```

Store:

```text
keyId, hash, owner, scopes, status, createdAt, lastUsedAt
```

---

## Lab 3 — AES-GCM Envelope

Implement:

- key generation;
- encryption;
- decryption;
- AAD;
- metadata envelope;
- failure on tampered AAD/ciphertext.

Test:

- wrong key fails;
- modified ciphertext fails;
- modified AAD fails;
- reused IV detector if you maintain key/IV registry in test.

---

## Lab 4 — Webhook HMAC

Implement webhook verification:

- timestamp;
- nonce;
- body digest;
- canonical string;
- HMAC-SHA256;
- replay cache;
- constant-time verification.

---

## Lab 5 — Safe File Resolver

Implement file download resolver:

- root directory;
- normalize path;
- reject traversal;
- random object key;
- original filename metadata;
- content disposition escaping.

---

## Lab 6 — Serialization Filter

Create a small serialized object demo and apply `ObjectInputFilter`.

Test:

- allowed class passes;
- disallowed class rejected;
- max depth exceeded rejected;
- max bytes exceeded rejected.

---

## Lab 7 — TLS Truststore

Build small client using `HttpClient` with custom truststore.

Validate:

- correct certificate succeeds;
- wrong truststore fails;
- hostname mismatch fails.

Do not implement trust-all manager except as a negative test.

---

# 28. Mini Project — Secure Case Evidence Vault

## 28.1 Objective

Build a Java CLI/service library that can:

1. ingest an evidence file;
2. compute SHA-256 digest;
3. encrypt with AES-GCM;
4. bind metadata with AAD;
5. generate HMAC or digital signature for metadata;
6. verify and decrypt;
7. rotate encryption metadata format;
8. produce audit event.

---

## 28.2 Suggested modules

```text
secure-case-vault/
  build.gradle.kts or pom.xml
  src/main/java/
    com.example.vault.crypto/
      AesGcmEnvelope.java
      HmacSigner.java
      Digests.java
      Keys.java
    com.example.vault.domain/
      EvidenceId.java
      CaseId.java
      EvidenceMetadata.java
      EvidenceEnvelope.java
    com.example.vault.storage/
      ObjectKeyPolicy.java
      LocalObjectStore.java
    com.example.vault.audit/
      AuditEvent.java
      AuditSigner.java
    com.example.vault.cli/
      Main.java
  src/test/java/
```

---

## 28.3 Invariants

- Raw filename never becomes storage path.
- Every encrypted object has algorithm, key id, IV, tag.
- Every evidence metadata has SHA-256 digest.
- Decryption requires matching AAD.
- Audit event is append-only.
- Signature/HMAC verification happens before trusting metadata.
- Secret values never appear in logs.

---

## 28.4 Commands

```bash
java -jar vault.jar ingest \
  --case-id CASE-001 \
  --file statement.pdf \
  --out vault-data

java -jar vault.jar verify \
  --metadata vault-data/evd-001.json

java -jar vault.jar decrypt \
  --metadata vault-data/evd-001.json \
  --out restored.pdf
```

---

# 29. What Top 1% Java Engineers Internalize

A strong Java security engineer knows that:

1. Security starts at trust boundary, not at crypto API.
2. Crypto primitives are easy to call and easy to misuse.
3. Key management is harder than encryption.
4. TLS validation must not be disabled to “fix” integration.
5. HMAC and digital signature solve different trust models.
6. Hash is not authentication.
7. Password hashing is not ordinary hashing.
8. Deserialization is dangerous even if code “just reads an object”.
9. Dependency is code execution.
10. Annotation processor and Java agent are privileged code.
11. Native boundary can destroy Java memory safety.
12. Security Manager is not the modern sandbox story in Java 25.
13. Preview APIs like Java 25 PEM support need explicit adoption policy.
14. JDK crypto evolves; do not freeze knowledge at Java 8.
15. Observability must be designed not to leak sensitive data.
16. Authorization is domain logic, not UI logic.
17. Auditability and integrity are first-class design concerns in regulatory systems.

---

# 30. Further Reading / Official References

Use these as primary sources:

1. Oracle Java SE 25 Security Developer's Guide  
   https://docs.oracle.com/en/java/javase/25/security/

2. Java Cryptography Architecture Reference Guide  
   https://docs.oracle.com/en/java/javase/25/security/java-cryptography-architecture-jca-reference-guide.html

3. Java Secure Socket Extension Reference Guide  
   https://docs.oracle.com/en/java/javase/25/security/java-secure-socket-extension-jsse-reference-guide.html

4. Java PKI Programmer's Guide  
   https://docs.oracle.com/en/java/javase/25/security/java-pki-programmers-guide.html

5. Java SE 25 API Documentation  
   https://docs.oracle.com/en/java/javase/25/docs/api/

6. ObjectInputFilter Java SE 25 API  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/io/ObjectInputFilter.html

7. JEP 486 — Permanently Disable the Security Manager  
   https://openjdk.org/jeps/486

8. JEP 510 — Key Derivation Function API  
   https://openjdk.org/jeps/510

9. JEP 470 — PEM Encodings of Cryptographic Objects Preview  
   https://openjdk.org/jeps/470

10. JEP 496 — Quantum-Resistant ML-KEM  
    https://openjdk.org/jeps/496

11. JEP 497 — Quantum-Resistant ML-DSA  
    https://openjdk.org/jeps/497

---

# 31. Closing Mental Model

Java security yang matang bukan seperti ini:

```text
Need security -> call crypto API -> done
```

Melainkan:

```text
Threat model
  -> trust boundaries
  -> validation and authorization
  -> secure protocol design
  -> correct crypto primitive
  -> key lifecycle
  -> secure storage and transport
  -> audit and observability
  -> supply-chain/runtime integrity
  -> incident response and rotation
```

Pada bagian berikutnya, kita akan masuk ke **Modules, Packaging, dan Runtime Images**, yang sangat terkait dengan integrity juga: bagaimana Java membatasi module boundary, membuat custom runtime image, mengemas aplikasi, dan mengurangi attack surface deployment.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Learn Java Part 014 — Observability, Profiling, dan Troubleshooting di Java hingga Java 25](./learn-java-part-014.md) | [🏠 Daftar Isi](../index.md) | [Selanjutnya ➡️: Learn Java Part 016 — Modules, Packaging, dan Runtime Images](./learn-java-part-016.md)
