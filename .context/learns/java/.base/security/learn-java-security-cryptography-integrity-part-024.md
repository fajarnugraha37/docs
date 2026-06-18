# learn-java-security-cryptography-integrity-part-024

# Part 24 — Secrets Management in Java Applications

> Seri: `learn-java-security-cryptography-integrity`  
> Bagian: `24 / 34`  
> Status seri: **belum selesai**  
> Fokus: secret sebagai security-critical runtime material, bukan sekadar configuration value.

---

## 0. Tujuan Part Ini

Setelah bagian sebelumnya membahas secure coding footguns, bagian ini masuk ke salah satu sumber incident paling umum di aplikasi enterprise: **secret leakage** dan **secret misuse**.

Di banyak sistem Java, secret sering diperlakukan seperti config biasa:

```text
DB_PASSWORD=...
JWT_SIGNING_SECRET=...
CLIENT_SECRET=...
API_KEY=...
PRIVATE_KEY=...
```

Secara teknis, semua itu memang sering “dikonfigurasi”. Tetapi secara security, secret adalah **capability**: siapa pun yang memegangnya dapat melakukan tindakan yang biasanya hanya boleh dilakukan oleh aplikasi, service, atau identity tertentu.

Part ini bertujuan membangun mental model yang membuat kamu bisa menjawab:

1. Secret apa saja yang ada di sistem Java saya?
2. Siapa yang boleh melihat, membaca, menggunakan, memutar, dan mencabut secret itu?
3. Secret masuk ke runtime lewat jalur apa?
4. Apakah secret pernah muncul di source code, build log, container image, environment, heap dump, thread dump, exception, metric, trace, atau audit log?
5. Apa blast radius jika secret bocor?
6. Bagaimana sistem tetap berjalan saat secret dirotasi?
7. Bagaimana membuktikan bahwa secret tidak dipakai di luar boundary yang seharusnya?

OWASP Secrets Management Cheat Sheet menekankan kebutuhan untuk melakukan centralized storage, provisioning, auditing, rotation, dan management of secrets agar secret tidak tersebar, tidak bocor, dan dapat dikontrol. AWS Secrets Manager juga menekankan praktik seperti storing sensitive information in a managed service, using caching, rotating secrets, limiting access, and monitoring access. Referensi utama part ini ada di akhir dokumen.

---

## 1. Mental Model Utama: Secret adalah Capability, Bukan String

Secret bukan hanya data sensitif. Secret adalah **otoritas yang dipadatkan menjadi material**.

Contoh:

| Secret | Capability yang diberikan |
|---|---|
| Database password | Membaca/mengubah data sesuai privilege DB user |
| OAuth client secret | Menukar authorization code/token sebagai client tertentu |
| JWT signing key | Membuat token yang dipercaya resource server |
| HMAC webhook secret | Membuat request yang dianggap berasal dari partner tepercaya |
| TLS private key | Membuktikan identity server/service |
| S3 access key | Mengakses object storage sesuai IAM permission |
| Encryption data key | Membuka data terenkripsi |
| SSH private key | Mengakses host/repository |
| Kubernetes service account token | Mengakses Kubernetes API sesuai RBAC |
| API key vendor | Mengonsumsi layanan eksternal dan menimbulkan biaya/risk |

Maka aturan pertamanya:

> Jangan tanyakan “di mana saya menyimpan string ini?”, tanyakan “capability apa yang saya berikan kepada siapa, selama berapa lama, dan dengan blast radius sebesar apa?”

### 1.1 Secret berbeda dari config biasa

Config biasa:

```text
FEATURE_X_ENABLED=true
MAX_UPLOAD_SIZE_MB=20
RETRY_TIMEOUT_MS=500
```

Secret:

```text
PAYMENT_GATEWAY_API_KEY=...
DB_PASSWORD=...
JWT_PRIVATE_KEY=...
```

Perbedaannya bukan hanya confidentiality. Secret punya konsekuensi langsung ketika bocor.

Config biasa bocor mungkin hanya menyebabkan informasi arsitektur terbaca. Secret bocor bisa langsung menyebabkan:

1. data exfiltration,
2. account takeover,
3. forged token,
4. unauthorized transaction,
5. supply-chain compromise,
6. privilege escalation,
7. operational outage karena harus emergency rotation.

---

## 2. Definisi: Apa yang Disebut Secret?

Dalam sistem Java enterprise, secret biasanya termasuk:

1. **Credential**
   - username/password DB,
   - basic auth credential,
   - LDAP bind credential,
   - SMTP credential.

2. **API token / API key**
   - vendor API key,
   - internal service token,
   - webhook secret,
   - integration token.

3. **Cryptographic key**
   - AES key,
   - HMAC key,
   - JWT signing key,
   - envelope encryption key,
   - key wrapping key.

4. **Private key**
   - TLS private key,
   - signing private key,
   - SSH private key,
   - mTLS client certificate private key.

5. **OAuth/OIDC material**
   - client secret,
   - refresh token,
   - private key JWT key,
   - token introspection credential.

6. **Cloud identity material**
   - access key,
   - secret access key,
   - session token,
   - service account JSON,
   - workload identity token.

7. **Infrastructure/runtime token**
   - Kubernetes service account token,
   - Vault token,
   - CI/CD token,
   - artifact repository token.

8. **Recovery material**
   - backup encryption key,
   - break-glass credential,
   - master password.

### 2.1 Bukan semua sensitive data adalah secret

PII, case data, medical data, financial data, dan audit data adalah sensitive data, tetapi belum tentu secret.

Perbedaannya:

```text
Sensitive data = data yang harus dilindungi karena impact terhadap subject/organization.
Secret         = material yang memberi kemampuan untuk mengakses, menandatangani, membuka, atau bertindak.
```

Contoh:

```text
Citizen ID number     -> sensitive data
Database password     -> secret
Signed audit record   -> sensitive/evidentiary data
Audit signing key     -> secret
```

Keduanya perlu perlindungan, tetapi desain lifecycle-nya berbeda.

---

## 3. Security Invariant untuk Secrets Management

Part ini harus dibaca dengan invariant berikut:

```text
A secret must only be available to the smallest runtime identity that needs it,
only for the shortest practical time,
only through an auditable delivery path,
only in memory/storage locations expected by design,
and must be rotatable without uncontrolled outage.
```

Turunan invariant:

1. Secret tidak boleh berada di source code.
2. Secret tidak boleh berada di Git history.
3. Secret tidak boleh berada di container image layer.
4. Secret tidak boleh muncul di log, metric, trace, error response, heap dump, thread dump, build output, atau alert message.
5. Secret tidak boleh dibagi lintas service kecuali ada alasan desain yang eksplisit.
6. Secret harus punya owner.
7. Secret harus punya lifecycle.
8. Secret harus punya access policy.
9. Secret harus bisa dirotasi.
10. Secret harus punya blast-radius model.
11. Secret access harus dapat diaudit.
12. Secret leak harus punya incident playbook.

---

## 4. Threat Model untuk Secret di Aplikasi Java

Secret bisa bocor dari banyak jalur. Jangan hanya berpikir attacker membaca database config file.

### 4.1 Threat actor

| Actor | Risiko |
|---|---|
| External attacker | Mengeksploitasi app untuk dump env/heap/config |
| Insider | Membaca secret dari repo, CI, log, dashboard, cluster |
| Compromised dependency | Mengeksfiltrasi env var atau system property |
| Compromised container | Membaca mounted secret/token |
| Compromised CI runner | Membaca secret saat build/deploy |
| Misconfigured logging | Menulis secret ke log aggregator |
| Overprivileged service | Secret dipakai di luar boundary |
| Operator mistake | Secret di-copy ke ticket/chat/screenshot |

### 4.2 Attack surface

```text
Developer laptop
  -> Git working copy
  -> local .env
  -> IDE run config
  -> shell history
  -> Maven/Gradle settings
  -> Docker build context

Source control
  -> source file
  -> config file
  -> test fixture
  -> commit history
  -> pull request diff

CI/CD
  -> pipeline variables
  -> build logs
  -> artifact metadata
  -> image layer
  -> deployment manifest

Runtime
  -> environment variables
  -> system properties
  -> mounted files
  -> memory heap
  -> thread dump
  -> crash dump
  -> debug endpoint
  -> actuator endpoint
  -> metrics/traces/logs

Infrastructure
  -> secret manager
  -> KMS/HSM
  -> Kubernetes Secret
  -> cloud metadata service
  -> IAM/service account
  -> backup/snapshot
```

### 4.3 Common breach path

```text
1. Developer puts credential in application-dev.yml.
2. File accidentally committed.
3. Secret scanner absent or ignored.
4. Secret remains in Git history even after removal.
5. CI builds image with config included.
6. Image pushed to registry.
7. Multiple environments reuse same credential.
8. Attacker finds leaked secret.
9. Secret has broad privilege.
10. Rotation requires downtime, so team delays remediation.
```

Masalah utama bukan satu kesalahan. Masalahnya adalah **tidak ada lifecycle**.

---

## 5. Secret Taxonomy Berdasarkan Blast Radius

Tidak semua secret punya risiko sama. Senior engineer harus mengklasifikasi secret berdasarkan blast radius.

### 5.1 Local-only development secret

Contoh:

```text
local PostgreSQL password
local MinIO access key
local test SMTP password
```

Risiko relatif lebih kecil, tetapi tetap tidak boleh masuk repo karena kebiasaan buruk akan terbawa ke production.

### 5.2 Environment-bound secret

Contoh:

```text
DEV_DB_PASSWORD
UAT_DB_PASSWORD
PROD_DB_PASSWORD
```

Invariant:

```text
Secret satu environment tidak boleh valid di environment lain.
```

Jika DEV secret bisa mengakses PROD, boundary environment sudah gagal.

### 5.3 Service-bound secret

Contoh:

```text
case-service DB credential
payment-service API key
notification-service SMTP credential
```

Invariant:

```text
Secret service A tidak boleh digunakan service B.
```

Secret sharing lintas service membuat attribution dan blast-radius analysis sulit.

### 5.4 Tenant-bound secret

Contoh:

```text
tenant-specific encryption key
tenant-specific webhook signing secret
```

Invariant:

```text
Compromise tenant A tidak membuka tenant B.
```

### 5.5 Cryptographic root secret

Contoh:

```text
root key encryption key
JWT root signing private key
CA private key
backup master key
```

Ini harus diperlakukan sebagai crown jewel.

Invariant:

```text
Root secret tidak boleh berada di application runtime biasa.
```

Root key idealnya berada di KMS/HSM atau minimal environment yang sangat dibatasi.

---

## 6. Anti-Pattern Utama

### 6.1 Hardcoded secret

Buruk:

```java
private static final String DB_PASSWORD = "ProdPassword123!";
```

Masalah:

1. masuk source code,
2. masuk compiled artifact,
3. masuk decompiler output,
4. masuk Git history,
5. sulit dirotasi,
6. sering tersebar ke test dan local.

### 6.2 Secret di config repository plaintext

Buruk:

```yaml
spring:
  datasource:
    username: aceas_prod
    password: SuperSecret
```

Masalah:

1. repo menjadi secret store informal,
2. akses developer ke repo berarti akses secret,
3. secret sering muncul di PR review,
4. sulit audit siapa membaca secret,
5. rotation tidak terkontrol.

### 6.3 Secret di environment variable tanpa memahami risiko

Environment variable sering dipakai karena praktis. Namun secret di env bisa bocor lewat:

1. process inspection,
2. crash report,
3. debug endpoint,
4. accidental log of environment,
5. CI output,
6. child process inheritance,
7. container inspection tergantung platform dan permission.

Env var bukan otomatis salah, tetapi jangan menganggapnya “secure secret store”.

### 6.4 Secret di command-line argument

Buruk:

```bash
java -jar app.jar --db.password=secret
```

Risiko:

1. terlihat di process list,
2. masuk shell history,
3. masuk deployment logs,
4. masuk monitoring command capture.

### 6.5 Secret di Docker image layer

Buruk:

```dockerfile
COPY application-prod.yml /app/application.yml
ENV DB_PASSWORD=secret
```

Secret yang pernah masuk image layer bisa tetap ada di history layer walaupun dihapus di layer berikutnya.

### 6.6 Secret di log

Buruk:

```java
log.info("Calling vendor with apiKey={}", apiKey);
```

Atau lebih halus:

```java
log.error("Failed config: {}", configObject, e);
```

Jika `configObject.toString()` mencetak secret, log bocor.

### 6.7 Secret reuse

Buruk:

```text
Same HMAC key for webhook verification and internal token signing.
Same DB credential for multiple services.
Same secret across DEV/UAT/PROD.
```

Masalah:

1. blast radius besar,
2. sulit rotasi bertahap,
3. sulit attribution,
4. satu leak membuka banyak boundary.

### 6.8 Long-lived static secret tanpa rotation

Semakin lama secret hidup, semakin besar kemungkinan pernah bocor.

Anti-pattern:

```text
Secret dibuat saat project mulai, dipakai bertahun-tahun, tidak ada owner, tidak ada rotation calendar, tidak ada last-used audit.
```

---

## 7. Secret Lifecycle

Secret punya lifecycle. Kalau lifecycle tidak didefinisikan, secret akan menjadi “string abadi”.

```text
Design
  -> Generate
  -> Store
  -> Distribute/Inject
  -> Use
  -> Cache
  -> Rotate
  -> Revoke
  -> Retire
  -> Destroy
  -> Audit
```

### 7.1 Design

Pertanyaan:

1. Secret ini memberi capability apa?
2. Siapa owner-nya?
3. Runtime identity mana yang boleh mengakses?
4. Apakah secret ini environment-specific?
5. Apakah secret ini service-specific?
6. Apakah secret ini bisa dirotasi tanpa downtime?
7. Apa blast radius jika bocor?
8. Apakah ada alternatif tanpa static secret?

Contoh alternatif:

| Kebutuhan | Static secret | Alternatif lebih baik |
|---|---|---|
| Service access cloud resource | Access key | Workload identity / IAM role |
| DB access | Static password | IAM DB auth / rotated credential |
| Token signing | Shared HMAC key | Asymmetric signing with private key custody |
| Service-to-service trust | Shared API key | mTLS / workload identity |
| CI deploy | Long-lived deploy token | Short-lived OIDC federation |

### 7.2 Generate

Secret harus digenerate dengan cryptographically secure randomness.

Java:

```java
import java.security.SecureRandom;
import java.util.Base64;

public final class SecretGenerator {
    private static final SecureRandom RNG = new SecureRandom();

    public static String randomBase64UrlSecret(int bytes) {
        byte[] raw = new byte[bytes];
        RNG.nextBytes(raw);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(raw);
    }

    public static void main(String[] args) {
        System.out.println(randomBase64UrlSecret(32)); // 256-bit random secret
    }
}
```

Catatan:

1. Jangan generate secret dengan `Random`.
2. Jangan pakai timestamp.
3. Jangan pakai UUID untuk high-value token tanpa analisis entropy.
4. Jangan membuat secret dari nama service + tanggal.
5. Jangan derive secret dari password manusia kecuali memakai KDF yang tepat.

### 7.3 Store

Secret idealnya disimpan di dedicated secret manager atau KMS-backed system.

Pilihan umum:

1. AWS Secrets Manager,
2. AWS Systems Manager Parameter Store dengan SecureString,
3. HashiCorp Vault,
4. Google Secret Manager,
5. Azure Key Vault,
6. Kubernetes Secret dengan encryption at rest + RBAC ketat,
7. HSM/KMS untuk key material tertentu.

Yang perlu dibedakan:

```text
Secret Manager = menyimpan dan mengatur secret.
KMS            = mengelola cryptographic key dan operasi crypto tertentu.
HSM            = hardware-backed custody untuk key bernilai tinggi.
```

### 7.4 Distribute / Inject

Cara secret masuk ke aplikasi:

1. environment variable,
2. system property,
3. mounted file,
4. sidecar/agent,
5. direct SDK fetch at startup,
6. direct SDK fetch lazily,
7. dynamic secret injection,
8. JDBC driver wrapper,
9. cloud workload identity.

Tidak ada cara yang sempurna. Pilihan harus sesuai threat model.

### 7.5 Use

Saat secret dipakai:

1. jangan log,
2. jangan convert ke string jika bisa dihindari untuk key material tertentu,
3. jangan pass ke exception message,
4. jangan expose via actuator/config endpoint,
5. jangan simpan di static mutable global tanpa refresh plan,
6. jangan share object secret ke komponen yang tidak perlu.

### 7.6 Cache

Secret caching meningkatkan availability dan latency, tetapi memperbesar window exposure.

Trade-off:

| Tanpa cache | Dengan cache |
|---|---|
| Selalu fresh | Bisa stale |
| Secret manager jadi dependency runtime kritikal | Lebih tahan transient failure |
| Latency lebih tinggi | Latency lebih rendah |
| Cost lebih tinggi | Cost lebih rendah |
| Rotation langsung terasa | Butuh refresh strategy |

### 7.7 Rotate

Rotation adalah proses mengganti secret lama ke secret baru.

Rotation yang baik mendukung overlap:

```text
T0: only old secret valid
T1: old + new secret valid
T2: applications gradually switch to new
T3: old secret revoked
T4: verify no old secret usage
```

Untuk signing/verifying:

```text
Signer uses new key.
Verifier accepts old + new until all old tokens expire.
Then old key retired.
```

Untuk DB password:

```text
Create new credential or update credential.
Roll application connection pool safely.
Verify old credential unused.
Disable old credential.
```

### 7.8 Revoke

Revocation diperlukan saat secret bocor atau tidak lagi boleh dipakai.

Pertanyaan:

1. Bagaimana cara mencabut secret sekarang?
2. Service mana yang akan terdampak?
3. Apakah ada consumer tersembunyi?
4. Apakah revoke menyebabkan outage?
5. Apakah ada fallback credential?
6. Bagaimana memverifikasi secret lama tidak lagi valid?

### 7.9 Retire and Destroy

Secret lama harus dihentikan secara eksplisit.

Checklist:

1. nonaktifkan di secret manager/vendor,
2. hapus dari runtime config,
3. hapus dari CI/CD variable,
4. hapus dari local documentation,
5. hapus dari emergency vault jika tidak diperlukan,
6. pastikan backup/snapshot risk diketahui,
7. dokumentasikan tanggal retirement.

### 7.10 Audit

Audit harus menjawab:

1. siapa membaca secret,
2. kapan secret dibaca,
3. runtime identity mana yang membaca,
4. dari environment mana,
5. apakah akses sesuai baseline,
6. apakah ada akses setelah retirement,
7. apakah ada secret yang tidak pernah dipakai.

---

## 8. Secret Delivery Pattern di Java

### 8.1 Pattern A — Fetch at startup

Aplikasi mengambil secret saat startup.

```text
App starts
  -> Authenticate as workload identity
  -> Fetch secret from secret manager
  -> Build datasource/client/signer
  -> Run
```

Kelebihan:

1. startup fail-fast,
2. akses secret terpusat,
3. tidak perlu mount secret file,
4. audit access tersedia di secret manager.

Kekurangan:

1. startup bergantung ke secret manager,
2. rotation butuh refresh/restart jika tidak didesain,
3. cold start lebih lambat,
4. secret ada di memory aplikasi.

Cocok untuk:

1. DB credential,
2. API key vendor,
3. HMAC secret,
4. config secret umum.

### 8.2 Pattern B — Lazy fetch with cache

Aplikasi mengambil secret saat pertama kali dibutuhkan, lalu cache.

```text
Need secret
  -> Check cache
  -> If missing/stale, fetch
  -> Use
  -> Refresh periodically or on failure
```

Kelebihan:

1. startup lebih ringan,
2. secret yang tidak dipakai tidak diambil,
3. bisa refresh otomatis,
4. resilient jika cache masih valid.

Kekurangan:

1. error muncul di runtime path,
2. concurrency refresh perlu benar,
3. stale secret bisa menyebabkan auth failure,
4. caching policy harus jelas.

### 8.3 Pattern C — Mounted file

Secret manager/operator menulis secret sebagai file.

```text
/var/run/secrets/app/db-password
/var/run/secrets/app/private-key.pem
```

Kelebihan:

1. mudah dipakai library yang butuh file,
2. cocok untuk TLS key/cert,
3. bisa diupdate atomically oleh platform tertentu,
4. tidak perlu expose secret sebagai env var.

Kekurangan:

1. file permission harus benar,
2. app perlu reload jika file berubah,
3. backup/sidecar bisa membaca jika permission salah,
4. path bisa tidak sengaja dilog.

### 8.4 Pattern D — Workload identity instead of secret

Aplikasi tidak membawa static credential. Runtime identity digunakan untuk mendapatkan akses.

Contoh:

```text
EKS service account -> IAM role -> AWS API access
GKE workload identity -> Google service account
Azure managed identity -> Key Vault access
```

Kelebihan:

1. mengurangi static secret,
2. short-lived credential,
3. akses bisa diaudit,
4. lebih mudah revoke melalui IAM.

Kekurangan:

1. konfigurasi infra lebih kompleks,
2. metadata/token endpoint menjadi target,
3. butuh RBAC/IAM yang presisi,
4. local development butuh strategi khusus.

### 8.5 Pattern E — Dynamic credentials

Secret manager membuat credential sementara.

Contoh:

```text
App asks Vault for DB credential
Vault creates DB user/password with TTL
App uses credential
Credential expires/revoked automatically
```

Kelebihan:

1. short-lived,
2. blast radius kecil,
3. rotation naturally built-in,
4. audit jelas.

Kekurangan:

1. butuh platform matang,
2. connection pooling harus aware TTL,
3. outage secret manager bisa berdampak,
4. operational complexity lebih tinggi.

---

## 9. Java Implementation Model

### 9.1 Jangan buat `SecretUtil` global yang menyebar secret

Buruk:

```java
public final class SecretUtil {
    public static String get(String name) {
        return System.getenv(name);
    }
}
```

Masalah:

1. semua kode bisa mengambil secret,
2. tidak ada ownership,
3. tidak ada audit lokal,
4. tidak ada type safety,
5. sulit rotate.

Lebih baik buat boundary eksplisit.

```java
public interface SecretProvider {
    SecretValue getSecret(SecretName name);
}

public record SecretName(String value) {
    public SecretName {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("Secret name must not be blank");
        }
    }
}

public final class SecretValue {
    private final String value;

    private SecretValue(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("Secret value must not be blank");
        }
        this.value = value;
    }

    public static SecretValue of(String value) {
        return new SecretValue(value);
    }

    public String revealToTrustedCaller() {
        return value;
    }

    @Override
    public String toString() {
        return "SecretValue(**redacted**)";
    }
}
```

Walaupun `String` tetap immutable dan tidak bisa benar-benar di-zeroize, wrapper seperti ini mencegah accidental logging.

### 9.2 Typed secret names

Buruk:

```java
secretProvider.getSecret("jwt-secret");
secretProvider.getSecret("jtw-secret"); // typo runtime
```

Lebih baik:

```java
public enum ApplicationSecret {
    DATABASE_PASSWORD("/prod/case-service/db/password"),
    VENDOR_API_KEY("/prod/case-service/vendor/api-key"),
    WEBHOOK_HMAC_KEY("/prod/case-service/webhook/hmac-key");

    private final SecretName secretName;

    ApplicationSecret(String name) {
        this.secretName = new SecretName(name);
    }

    public SecretName secretName() {
        return secretName;
    }
}
```

### 9.3 Redaction-first object design

```java
public record DatabaseCredential(String username, SecretValue password) {
    @Override
    public String toString() {
        return "DatabaseCredential(username=" + username + ", password=**redacted**)";
    }
}
```

Jangan mengandalkan developer ingat untuk tidak log object. Desain object harus redaction-first.

### 9.4 Secret-aware exception

Buruk:

```java
throw new IllegalStateException("Failed to login with password " + password);
```

Baik:

```java
throw new IllegalStateException("Failed to authenticate to database using configured credential");
```

Exception harus cukup untuk diagnosis tanpa membocorkan material.

### 9.5 Secret as dependency, not ambient global

Buruk:

```java
class PaymentClient {
    void call() {
        String apiKey = System.getenv("PAYMENT_API_KEY");
        // call vendor
    }
}
```

Lebih baik:

```java
class PaymentClient {
    private final SecretValue apiKey;

    PaymentClient(SecretValue apiKey) {
        this.apiKey = apiKey;
    }

    void call() {
        String key = apiKey.revealToTrustedCaller();
        // use key only at integration boundary
    }
}
```

Secret harus injected ke komponen yang memang membutuhkannya, bukan tersedia global untuk semua code.

---

## 10. Secret Caching Design

### 10.1 Requirement caching

Secret cache perlu menjawab:

1. TTL berapa lama?
2. Apakah refresh blocking atau background?
3. Apa yang terjadi saat refresh gagal?
4. Apakah stale secret masih boleh dipakai?
5. Bagaimana menghindari thundering herd saat cache expired?
6. Apakah cache menyimpan secret plaintext?
7. Apakah cache punya per-secret policy?
8. Bagaimana secret dirotasi?

### 10.2 Simple cache skeleton

```java
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.locks.ReentrantLock;

public final class CachingSecretProvider implements SecretProvider {
    private final SecretProvider delegate;
    private final Duration ttl;
    private final Clock clock;
    private final Map<SecretName, CacheEntry> cache = new ConcurrentHashMap<>();
    private final ReentrantLock refreshLock = new ReentrantLock();

    public CachingSecretProvider(SecretProvider delegate, Duration ttl, Clock clock) {
        if (ttl.isNegative() || ttl.isZero()) {
            throw new IllegalArgumentException("TTL must be positive");
        }
        this.delegate = delegate;
        this.ttl = ttl;
        this.clock = clock;
    }

    @Override
    public SecretValue getSecret(SecretName name) {
        CacheEntry current = cache.get(name);
        Instant now = clock.instant();

        if (current != null && current.expiresAt().isAfter(now)) {
            return current.value();
        }

        refreshLock.lock();
        try {
            CacheEntry afterLock = cache.get(name);
            if (afterLock != null && afterLock.expiresAt().isAfter(now)) {
                return afterLock.value();
            }

            SecretValue fresh = delegate.getSecret(name);
            cache.put(name, new CacheEntry(fresh, now.plus(ttl)));
            return fresh;
        } finally {
            refreshLock.unlock();
        }
    }

    private record CacheEntry(SecretValue value, Instant expiresAt) {}
}
```

Catatan:

1. Ini skeleton sederhana, bukan production-ready universal solution.
2. Production cache perlu metric, per-secret TTL, failure policy, refresh jitter, concurrency control, dan observability.
3. Jangan log secret value ketika refresh gagal.

### 10.3 Failure policy

| Kondisi | Pilihan | Trade-off |
|---|---|---|
| Secret manager down, cache valid | Pakai cache | Availability baik |
| Secret manager down, cache expired | Fail closed | Aman tapi bisa outage |
| Secret manager down, cache expired | Use stale for grace period | Availability baik, rotation delay |
| Secret invalid after rotation | Force refresh | Butuh retry-aware client |
| Access denied | Fail closed | Benar untuk security |

Untuk secret high-risk seperti signing key, fail policy harus sangat hati-hati.

---

## 11. Rotation-Friendly Design

### 11.1 Jangan desain single-secret assumption

Buruk:

```java
boolean valid = hmac.verify(payload, signature, currentSecret);
```

Jika secret dirotasi, semua request lama langsung gagal.

Lebih baik:

```java
boolean valid = verifier.verifyWithAnyActiveKey(payload, signature);
```

Dengan model:

```text
active_signing_key = key-2026-06
accepted_verification_keys = [key-2026-06, key-2026-05]
```

### 11.2 Secret versioning

Secret harus punya version metadata.

```text
secretName: /prod/case-service/webhook/hmac-key
version: 2026-06-01
status: active
createdAt: 2026-06-01T00:00:00Z
retireAfter: 2026-07-01T00:00:00Z
owner: integration-platform
```

### 11.3 Payload harus membawa key id jika ada multi-key

Untuk signature/MAC/token, payload/envelope sebaiknya membawa `kid` atau version.

```json
{
  "alg": "HS256",
  "kid": "webhook-key-2026-06",
  "ts": "2026-06-16T10:15:00Z",
  "bodyHash": "...",
  "sig": "..."
}
```

Tetapi `kid` tidak boleh langsung menjadi path bebas ke filesystem/URL/SQL.

```text
kid from request -> lookup in allowlisted key registry -> retrieve matching key
```

Bukan:

```text
kid from request -> read /keys/${kid}.pem
```

### 11.4 Dual credential for DB rotation

Untuk DB credential, rotation tanpa outage sering membutuhkan salah satu:

1. create new DB user credential, switch app, revoke old user,
2. managed secret rotation dengan connection driver/caching,
3. short-lived dynamic DB credentials,
4. connection pool refresh policy.

Masalah umum:

```text
Secret manager already rotated password,
but application connection pool still holds old connections,
new connections fail,
partial outage begins.
```

Checklist DB rotation:

1. Apakah pool bisa evict old connections?
2. Apakah app bisa refresh secret tanpa restart?
3. Apakah old credential masih valid selama grace period?
4. Apakah migration job/batch juga memakai credential baru?
5. Apakah read replica/reporting job punya secret terpisah?
6. Apakah connection failure memicu forced refresh?

---

## 12. Kubernetes Secrets: Useful, But Not Magic

Kubernetes Secret sering dipakai di Java microservices.

Contoh manifest:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: case-service-db
  namespace: aceas-prod
type: Opaque
stringData:
  username: case_service
  password: do-not-put-real-secret-in-git
```

Masalah besar: jika manifest ini ada di Git plaintext, kamu hanya memindahkan hardcoded secret dari Java ke YAML.

### 12.1 Base64 bukan encryption

Kubernetes Secret data sering terlihat base64 encoded.

```yaml
data:
  password: c2VjcmV0
```

Base64 hanya encoding. Siapa pun yang membaca object dapat decode.

### 12.2 Minimum control untuk Kubernetes Secret

1. Enable encryption at rest untuk etcd.
2. Gunakan RBAC least privilege.
3. Batasi siapa bisa `get/list/watch` Secret.
4. Jangan mount semua secret ke semua pods.
5. Gunakan namespace boundary dengan hati-hati.
6. Hindari secret dalam env var jika mounted file lebih sesuai.
7. Gunakan external secret operator jika policy organisasi mendukung.
8. Audit access ke Secret.
9. Jangan expose secret lewat debug shell sembarangan.
10. Lindungi node/kubelet karena pod/node compromise bisa membaca mounted secret.

### 12.3 Env var vs mounted file in Kubernetes

| Mekanisme | Kelebihan | Kekurangan |
|---|---|---|
| Env var | Simple, banyak framework mendukung | Tidak auto-update di process, mudah bocor via env dump |
| Mounted file | Bisa dirotasi oleh volume update, permission bisa diatur | App perlu watch/reload, file bisa dibaca jika container compromise |
| External fetch | Audit dan policy lebih kuat | App bergantung ke SDK/secret manager |
| Sidecar/agent | Pisah concern | Operational complexity |

### 12.4 Example mounted secret

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: case-service
spec:
  template:
    spec:
      containers:
        - name: app
          image: registry.example.com/case-service:1.0.0
          volumeMounts:
            - name: db-secret
              mountPath: /var/run/secrets/case-service/db
              readOnly: true
      volumes:
        - name: db-secret
          secret:
            secretName: case-service-db
            defaultMode: 0400
```

Java loader:

```java
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

public final class FileSecretProvider implements SecretProvider {
    private final Path baseDir;

    public FileSecretProvider(Path baseDir) {
        this.baseDir = baseDir.normalize();
    }

    @Override
    public SecretValue getSecret(SecretName name) {
        Path path = baseDir.resolve(name.value()).normalize();
        if (!path.startsWith(baseDir)) {
            throw new SecurityException("Secret path escapes base directory");
        }
        try {
            return SecretValue.of(Files.readString(path, StandardCharsets.UTF_8).trim());
        } catch (IOException e) {
            throw new IllegalStateException("Unable to read configured secret", e);
        }
    }
}
```

Catatan:

1. Jangan log path jika path mengandung nama sensitive.
2. Jangan menerima secret path dari user input.
3. Jangan gunakan symlink tanpa policy jelas.
4. Pastikan permission file/volume benar.

---

## 13. Cloud Secret Manager Pattern

### 13.1 AWS Secrets Manager model

Pola umum:

```text
Application running with IAM role
  -> AWS SDK authenticates with workload identity
  -> GetSecretValue(secretId)
  -> Cache secret
  -> Use secret to build client/connection
```

Prinsip:

1. IAM role aplikasi hanya boleh membaca secret yang dibutuhkan.
2. Secret policy bisa membatasi caller/environment.
3. KMS key policy harus sesuai.
4. Audit CloudTrail harus aktif.
5. Rotation harus diuji.
6. Cache harus punya TTL dan refresh behavior.

AWS menyarankan penggunaan caching untuk mengurangi latency/cost dan meningkatkan availability; AWS Secrets Manager juga mendukung JDBC connection drivers untuk beberapa database yang mengambil credential dari Secrets Manager dan melakukan caching.

### 13.2 Pseudocode Java boundary

```java
public final class AwsSecretsManagerProvider implements SecretProvider {
    // Pseudocode: intentionally not tied to one SDK version.
    // Production implementation should include retry policy, timeout,
    // metrics, JSON parsing discipline, and redacted logging.

    @Override
    public SecretValue getSecret(SecretName name) {
        try {
            String secret = fetchSecretValueFromAws(name.value());
            return SecretValue.of(secret);
        } catch (AccessDeniedException e) {
            throw new SecurityException("Secret access denied for configured runtime identity", e);
        } catch (RuntimeException e) {
            throw new IllegalStateException("Unable to retrieve configured secret", e);
        }
    }

    private String fetchSecretValueFromAws(String secretId) {
        throw new UnsupportedOperationException("Use AWS SDK implementation here");
    }
}
```

Design detail yang harus diputuskan:

1. Timeout pendek atau panjang?
2. Retry berapa kali?
3. Apakah secret fetch dilakukan startup atau lazy?
4. Apakah secret JSON atau raw string?
5. Apakah ada schema validation?
6. Apakah metrics memakai secret name atau alias non-sensitive?
7. Apakah error log membocorkan secret path?

---

## 14. Secrets in Spring Boot / Jakarta Applications

Bagian ini bukan tutorial Spring Security, tetapi membahas secret flow yang umum di Java enterprise.

### 14.1 Hati-hati dengan configuration binding

Spring Boot sering membuat config object:

```java
@ConfigurationProperties(prefix = "vendor.payment")
public record PaymentProperties(
    String baseUrl,
    String apiKey
) {}
```

Jika record ini dilog:

```java
log.info("Payment config: {}", paymentProperties);
```

`apiKey` bisa bocor karena `record.toString()` mencetak field.

Lebih aman:

```java
public record PaymentProperties(
    String baseUrl,
    SecretValue apiKey
) {
    @Override
    public String toString() {
        return "PaymentProperties(baseUrl=" + baseUrl + ", apiKey=**redacted**)";
    }
}
```

### 14.2 Actuator/config endpoint risk

Jika aplikasi expose environment/config properties, pastikan:

1. endpoint sensitif tidak public,
2. sanitization key pattern mencakup `password`, `secret`, `key`, `token`, `credential`, `private`, `client-secret`,
3. management port/network dibatasi,
4. actuator tidak tersedia ke internet,
5. access logs tidak mencetak query/header sensitive.

### 14.3 DataSource secret

Buruk:

```yaml
spring.datasource.password: ${DB_PASSWORD}
```

Bukan selalu salah, tapi perlu sadar bahwa secret lewat env.

Alternatif:

```text
App fetches DB credential from secret manager
  -> builds Hikari DataSource programmatically
  -> refresh/evict pool on rotation
```

### 14.4 JWT signing secret

Buruk:

```yaml
security.jwt.secret: my-shared-secret
```

Masalah:

1. sering terlalu pendek,
2. sering sama antar environment,
3. sering dipakai untuk signing dan encryption sekaligus,
4. rotasi sulit,
5. verifier hanya tahu satu secret.

Lebih baik:

1. gunakan asymmetric key untuk banyak verifier,
2. gunakan key id,
3. simpan private key di KMS/HSM/secret manager,
4. publish public key via JWKS internal,
5. dukung key rotation overlap.

---

## 15. Secret Leakage Channels in Java Runtime

### 15.1 Logs

Sumber leakage:

1. config object `toString()`,
2. exception message,
3. HTTP request/response logging,
4. SQL connection URL,
5. debug log library,
6. failed authentication log,
7. MDC/correlation context,
8. structured logging fields,
9. third-party client logging,
10. access log headers.

Checklist:

```text
- Redact Authorization header.
- Redact Cookie header.
- Redact Set-Cookie header.
- Redact X-API-Key.
- Redact client_secret.
- Redact password.
- Redact private_key.
- Redact token.
- Redact signed URL query string.
```

### 15.2 Metrics

Buruk:

```java
counter.tag("apiKey", apiKey).increment();
```

Metrics label/tag sering dikirim ke external systems dan disimpan lama.

Aturan:

```text
Metric label must never contain raw secret, token, credential, or user-provided high-cardinality sensitive value.
```

### 15.3 Traces

Distributed tracing sering menangkap:

1. HTTP headers,
2. URL query parameters,
3. DB statements,
4. messaging headers,
5. exception stack traces.

Pastikan instrumentation melakukan redaction.

### 15.4 Heap dump

Java heap dump bisa berisi:

1. `String` password,
2. JWT token,
3. API key,
4. private key material,
5. request body,
6. cached secret,
7. HTTP header.

Oracle diagnostic tools seperti `jmap`/`jhsdb jmap` dapat mengambil memory map/heap information dari process Java. Artinya, akses ke diagnostic tools di production adalah security-sensitive capability.

Prinsip:

1. heap dump production harus access-controlled,
2. heap dump harus dianggap sensitive artifact,
3. upload heap dump ke third-party tool butuh approval,
4. heap dump retention harus pendek,
5. heap dump harus encrypted at rest,
6. heap dump tidak boleh dilampirkan ke public ticket/chat.

### 15.5 Thread dump

Thread dump bisa membocorkan secret jika secret muncul di:

1. thread name,
2. exception message,
3. stack local captured by tooling tertentu,
4. URL string,
5. command argument.

Jangan set thread name dengan data sensitive.

### 15.6 Crash dump and core dump

Core dump lebih berbahaya daripada log biasa karena bisa memuat memory process.

Hardening:

1. disable core dump jika tidak perlu,
2. restrict dump directory,
3. encrypt dumps,
4. scrub sebelum sharing,
5. control who can trigger dump.

---

## 16. Secret in Build and CI/CD

### 16.1 CI secret exposure

CI/CD sering punya secret lebih powerful daripada aplikasi:

1. registry push token,
2. deployment token,
3. cloud admin credential,
4. signing key,
5. package repository token,
6. database migration credential.

Threat model CI/CD harus lebih ketat.

### 16.2 Rules

1. Jangan echo secret.
2. Jangan jalankan build dengan `set -x` saat secret ada di environment.
3. Jangan pass secret sebagai CLI arg.
4. Jangan bake secret ke artifact.
5. Jangan expose secret ke untrusted pull request build.
6. Jangan reuse production deploy token untuk DEV.
7. Gunakan short-lived federated credential jika tersedia.
8. Batasi secret per pipeline/job.
9. Audit usage.
10. Rotate token setelah runner compromise.

### 16.3 Maven/Gradle settings

File seperti berikut bisa mengandung token:

```text
~/.m2/settings.xml
~/.gradle/gradle.properties
```

Jangan commit file ini.

Jika butuh repository credential:

1. gunakan CI secret injection,
2. gunakan least privilege token,
3. pisahkan read token dan publish token,
4. rotasi token,
5. jangan tampilkan effective settings di log.

---

## 17. Secret Scanning and Prevention

### 17.1 Shift-left secret detection

Pasang scanner di:

1. pre-commit,
2. pull request,
3. CI pipeline,
4. repository history scanning,
5. container image scanning,
6. artifact scanning,
7. log scanning.

### 17.2 Jika secret terlanjur committed

Langkah benar:

```text
1. Treat as compromised.
2. Revoke/rotate secret immediately.
3. Identify blast radius.
4. Search where else secret exists.
5. Remove from current code.
6. Clean Git history only as hygiene, not as remediation substitute.
7. Audit usage since suspected exposure.
8. Add detection rule/regression guard.
```

Menghapus commit tidak cukup. Secret harus dianggap bocor.

### 17.3 False positive handling

Secret scanner akan punya false positive. Jangan matikan scanner. Buat process:

1. allowlist dengan expiry,
2. review oleh security owner,
3. reason wajib,
4. jangan allowlist pattern terlalu luas,
5. test scanner rule dengan known dummy secret.

---

## 18. Zeroization and Java Memory Reality

Di C, kadang secret bisa dihapus dari memory buffer secara eksplisit. Di Java, situasinya lebih sulit.

### 18.1 `String` problem

`String` immutable. Jika password/API key disimpan sebagai `String`:

1. tidak bisa dihapus deterministik,
2. bisa bertahan sampai GC,
3. bisa muncul di heap dump,
4. bisa tercopy saat concat/logging,
5. bisa muncul di intern/cache tergantung usage.

### 18.2 `char[]` / `byte[]`

Untuk beberapa secret, `char[]`/`byte[]` memberi kesempatan wipe:

```java
import java.util.Arrays;

byte[] key = loadKeyMaterial();
try {
    useKey(key);
} finally {
    Arrays.fill(key, (byte) 0);
}
```

Tetapi jangan overclaim:

1. JVM/JIT bisa membuat copy,
2. library bisa copy ke internal structure,
3. GC movement bisa meninggalkan copy lama,
4. OS swap/core dump masih risiko,
5. wiping membantu tapi bukan jaminan absolut.

### 18.3 Practical guidance

1. Untuk password input, prefer `char[]` jika API mendukung.
2. Untuk cryptographic key, gunakan `KeyStore`, `SecretKey`, provider/KMS/HSM jika memungkinkan.
3. Jangan convert private key ke `String` jika tidak perlu.
4. Jangan simpan secret lebih lama dari kebutuhan.
5. Lindungi dump artifacts.
6. Prioritaskan pencegahan leak channel dibanding berharap zeroization sempurna.

---

## 19. Secret Access Authorization Model

### 19.1 Least privilege

Jangan beri aplikasi akses ke semua secret namespace.

Buruk:

```text
case-service IAM role can read /prod/*
```

Baik:

```text
case-service IAM role can read:
- /prod/case-service/db/password
- /prod/case-service/vendor/onemap/api-key
- /prod/case-service/webhook/hmac-key
```

Lebih baik lagi jika per-secret policy bisa membatasi environment, VPC endpoint, principal, dan tag.

### 19.2 Separate read and manage permission

Aplikasi biasanya hanya perlu read secret, bukan update/delete secret.

```text
Runtime app identity:
  allow GetSecretValue
  deny PutSecretValue
  deny DeleteSecret
  deny UpdateSecret
```

Secret rotation job mungkin perlu permission berbeda.

### 19.3 Break-glass access

Production secret manual read harus jarang dan diaudit.

Policy:

1. require approval,
2. time-bound,
3. logged,
4. reason required,
5. automatically revoked,
6. post-access review.

---

## 20. Secrets and Regulatory / Evidence Systems

Untuk regulatory/enforcement platform, secret management terkait langsung dengan defensibility.

Contoh secret bernilai tinggi:

1. audit signing private key,
2. evidence file encryption key,
3. case export signing key,
4. service-to-service token,
5. database credential untuk case data,
6. integration credential ke agency/partner,
7. report generation storage key,
8. notification gateway credential.

### 20.1 Evidence integrity key

Jika audit/evidence signing key bocor, attacker bisa membuat evidence palsu yang terlihat valid.

Invariant:

```text
Evidence signing private key must not be extractable by ordinary application code if legal defensibility depends on it.
```

Lebih aman:

1. signing via KMS/HSM,
2. app tidak pernah melihat private key raw,
3. signing operation audited,
4. key usage policy terbatas,
5. key rotation punya verification chain.

### 20.2 Audit trail secret

Jika audit log memakai HMAC/hash-chain, HMAC key harus diperlakukan sebagai high-value secret.

Jika key bocor:

1. attacker bisa forge log chain,
2. tamper-evidence melemah,
3. historical records harus dianalisis ulang,
4. incident scope besar.

### 20.3 Cross-agency integration

Secret partner integration harus:

1. per-partner,
2. per-environment,
3. rotatable,
4. scoped,
5. monitored,
6. never reused as internal secret.

---

## 21. Production Checklist

### 21.1 Inventory

- [ ] Semua secret terdaftar.
- [ ] Setiap secret punya owner.
- [ ] Setiap secret punya purpose.
- [ ] Setiap secret punya environment.
- [ ] Setiap secret punya consumer list.
- [ ] Setiap secret punya rotation policy.
- [ ] Setiap secret punya blast-radius classification.
- [ ] Tidak ada orphan secret.

### 21.2 Storage

- [ ] Tidak ada secret di source code.
- [ ] Tidak ada secret di Git history aktif tanpa remediation.
- [ ] Tidak ada secret di container image layer.
- [ ] Tidak ada secret di deployment manifest plaintext.
- [ ] Secret manager/KMS digunakan untuk production.
- [ ] Secret encrypted at rest.
- [ ] Access to secret audited.

### 21.3 Access

- [ ] Runtime identity memakai least privilege.
- [ ] Service hanya bisa membaca secret miliknya.
- [ ] Read permission dipisah dari manage permission.
- [ ] Break-glass access diaudit.
- [ ] CI/CD secret scoped per job/environment.

### 21.4 Runtime

- [ ] Secret tidak dilog.
- [ ] Secret tidak masuk metric/tracing label.
- [ ] Secret tidak muncul di exception message.
- [ ] Secret tidak diexpose actuator/debug endpoint.
- [ ] Heap/thread/core dump diperlakukan sensitive.
- [ ] Diagnostic access dibatasi.

### 21.5 Rotation

- [ ] Secret bisa dirotasi.
- [ ] Rotation diuji di non-prod.
- [ ] Consumer mendukung overlap jika perlu.
- [ ] Secret cache punya refresh policy.
- [ ] Old secret bisa direvoke.
- [ ] Usage old secret bisa dipantau.

### 21.6 Incident

- [ ] Ada secret leak playbook.
- [ ] Ada scanner/prevention.
- [ ] Ada owner untuk emergency rotation.
- [ ] Ada audit query untuk access investigation.
- [ ] Ada process revoke vendor key.
- [ ] Ada communication path untuk affected teams.

---

## 22. Code Review Heuristics

Saat review PR Java, cari pattern ini:

```text
System.getenv
System.getProperty
@ConfigurationProperties
application.yml
application-*.yml
Dockerfile ENV
Kubernetes Secret/ConfigMap
Base64.getDecoder
PrivateKeyFactory
KeyStore.load
new String(secretBytes)
log.info/debug/error with config object
Object.toString on properties
Authorization header logging
Cookie logging
ProcessBuilder environment
```

Pertanyaan review:

1. Apakah ini secret atau config biasa?
2. Dari mana asal secret?
3. Siapa yang bisa membaca secret di path itu?
4. Apakah secret bisa masuk log?
5. Apakah secret bisa masuk heap dump?
6. Apakah secret environment-specific?
7. Apakah secret service-specific?
8. Apakah secret bisa dirotasi?
9. Apakah ada overlap untuk rotation?
10. Apa blast radius jika bocor?
11. Apakah ada secret scanner?
12. Apakah error handling membocorkan value?
13. Apakah dependency/library bisa membaca secret ini?
14. Apakah child process mewarisi env secret?
15. Apakah CI job membatasi exposure?

---

## 23. Mini Case Study: Java Service dengan DB, JWT, Vendor API, dan Webhook

### 23.1 Initial design buruk

```text
case-service
  application-prod.yml:
    db.password: plaintext
    jwt.secret: same-across-env
    vendor.apiKey: plaintext
    webhook.secret: plaintext

Docker image includes application-prod.yml.
Logs print configuration at startup.
JWT verifier only supports one HMAC secret.
DB password rotation requires application restart.
Vendor API key shared with another service.
```

Failure modes:

1. image registry compromise membuka PROD secret,
2. log aggregator menyimpan API key,
3. satu JWT secret leak memungkinkan forged tokens,
4. rotation JWT memutus semua existing token,
5. vendor API abuse tidak bisa diatribusikan ke service tertentu,
6. DB credential reuse memperbesar blast radius.

### 23.2 Improved design

```text
case-service runtime identity
  can read only:
    /prod/case-service/db/credential
    /prod/case-service/vendor/onemap/api-key
    /prod/case-service/webhook/hmac-key/active
    /prod/case-service/webhook/hmac-key/previous

JWT signing moved to asymmetric key model:
  auth-service signs with private key in KMS
  case-service verifies with JWKS public keys

DB credential:
  secret manager + caching + connection pool refresh policy

Vendor API key:
  service-specific key
  rate-limited
  monitored

Webhook HMAC:
  key id + active/previous overlap
  replay protection

Logging:
  config objects redacted
  headers redacted
  actuator restricted

CI/CD:
  no production secret in build
  secret injected only at deploy/runtime
```

### 23.3 Resulting invariants

```text
- Compromise of case-service cannot read unrelated service secrets.
- JWT verification does not require sharing signing secret across services.
- Vendor key abuse can be attributed to case-service.
- Webhook key can rotate without breaking in-flight partner calls.
- DB credential can rotate with controlled pool refresh.
- Logs/dumps are treated as sensitive but should not intentionally contain secrets.
```

---

## 24. Practical Design Template

Gunakan template ini untuk setiap secret baru.

```text
Secret Name:
Owner:
Purpose:
Capability Granted:
Environment:
Consumer Service(s):
Producer/Issuer:
Storage Location:
Delivery Mechanism:
Runtime Identity Allowed to Read:
Human Access Policy:
Rotation Frequency:
Rotation Mechanism:
Overlap Required:
Revocation Procedure:
Blast Radius if Leaked:
Detection/Audit Source:
Logging/Tracing Redaction Requirement:
Incident Playbook Link:
```

Contoh:

```text
Secret Name: /prod/case-service/vendor/onemap/api-key
Owner: Integration Platform Team
Purpose: Authenticate case-service to OneMap proxy/API
Capability Granted: Consume geocoding API within configured quota
Environment: PROD
Consumer Service(s): case-service
Producer/Issuer: Vendor portal / integration admin
Storage Location: AWS Secrets Manager
Delivery Mechanism: Runtime fetch with cache
Runtime Identity Allowed to Read: case-service-prod IAM role
Human Access Policy: Break-glass only, approved and audited
Rotation Frequency: 90 days or vendor/security event
Rotation Mechanism: Create new vendor key, deploy secret version, revoke old
Overlap Required: Yes, if vendor supports dual keys
Revocation Procedure: Disable key in vendor portal and secret manager
Blast Radius if Leaked: Unauthorized API consumption, possible data leakage depending endpoint
Detection/Audit Source: Secret access logs, vendor API usage logs, app egress logs
Logging/Tracing Redaction Requirement: Redact Authorization/X-API-Key headers
Incident Playbook Link: IR-SECRET-LEAK-001
```

---

## 25. Common Misconceptions

### Misconception 1: “Secret sudah di env var, berarti aman”

Env var adalah delivery mechanism, bukan secret manager.

### Misconception 2: “Secret sudah base64, berarti terenkripsi”

Base64 adalah encoding, bukan encryption.

### Misconception 3: “Secret sudah di Kubernetes Secret, berarti aman”

Kubernetes Secret butuh encryption at rest, RBAC, audit, namespace policy, dan node hardening.

### Misconception 4: “Kalau sudah dihapus dari Git, aman”

Secret yang pernah committed harus dianggap compromised sampai dirotasi.

### Misconception 5: “Secret manager menyelesaikan semua masalah”

Secret manager membantu storage/audit/rotation, tetapi runtime leakage masih bisa terjadi lewat log, dump, metrics, trace, dan overprivileged app identity.

### Misconception 6: “Private key boleh dibaca app selama tidak dilog”

Untuk high-value signing, app sebaiknya tidak bisa mengekstrak private key. Gunakan KMS/HSM signing jika threat model menuntut.

### Misconception 7: “Rotation tinggal ganti value”

Rotation adalah distributed protocol antara secret producer, storage, application cache, connection pool, verifier, monitoring, dan revocation.

---

## 26. What Excellent Engineers Do Differently

Engineer biasa bertanya:

```text
Di mana saya taruh password ini?
```

Engineer senior bertanya:

```text
Capability apa yang secret ini berikan?
Siapa runtime identity yang harus punya akses?
Bisakah saya menghilangkan static secret ini?
Apa blast radius jika bocor?
Bagaimana rotation tanpa outage?
Bagaimana saya tahu secret lama tidak dipakai lagi?
Di mana secret ini bisa bocor secara tidak sengaja?
```

Engineer top-tier membangun sistem yang:

1. punya secret inventory,
2. meminimalkan static secret,
3. memakai workload identity bila mungkin,
4. menerapkan least privilege,
5. redaction-first by design,
6. rotation-friendly,
7. observable tanpa leaking,
8. punya incident playbook,
9. bisa diaudit,
10. memperlakukan dump/log/artifact sebagai sensitive assets.

---

## 27. Ringkasan

Secrets management adalah disiplin desain, bukan hanya pilihan storage.

Core takeaway:

1. Secret adalah capability.
2. Secret harus punya lifecycle.
3. Secret harus punya owner dan access policy.
4. Secret tidak boleh diperlakukan sebagai config biasa.
5. Secret manager membantu, tapi tidak menghapus risiko runtime leakage.
6. Rotation harus didesain sejak awal.
7. Java runtime punya leakage channel: logs, metrics, traces, heap dump, thread dump, crash dump, config endpoint.
8. Kubernetes Secret bukan magic; base64 bukan encryption.
9. CI/CD sering memiliki secret paling powerful.
10. Untuk high-value key, pertimbangkan KMS/HSM agar app tidak melihat raw key.

---

## 28. Review Questions

Jawab pertanyaan ini untuk sistem Java yang sedang kamu maintain:

1. Secret apa saja yang ada di setiap service?
2. Secret mana yang shared lintas service?
3. Secret mana yang sama antar environment?
4. Secret mana yang tidak pernah dirotasi?
5. Secret mana yang tidak punya owner?
6. Apakah ada secret di Git history?
7. Apakah ada secret di container image?
8. Apakah actuator/debug endpoint bisa menampilkan config/env?
9. Apakah heap dump production pernah diambil dan disimpan di mana?
10. Apakah log sanitizer mencakup Authorization, Cookie, API key, token, password, private key?
11. Apakah CI/CD secret tersedia untuk untrusted PR?
12. Apakah service identity bisa membaca secret service lain?
13. Apakah DB credential bisa dirotasi tanpa outage?
14. Apakah JWT/key verifier mendukung key overlap?
15. Apa secret yang jika bocor paling merusak legal/audit defensibility?

---

## 29. Referensi Utama

1. OWASP Secrets Management Cheat Sheet — best practices untuk storage, provisioning, auditing, rotation, dan management secrets.
2. OWASP Kubernetes Security Cheat Sheet — kontrol Kubernetes seperti RBAC, kubelet hardening, dan prinsip keamanan cluster.
3. AWS Secrets Manager Best Practices — storing sensitive information, caching, rotation, limiting access, monitoring.
4. AWS Secrets Manager JDBC credential retrieval/caching documentation — Java JDBC driver wrapper dan default cache refresh behavior.
5. Oracle Java Diagnostic Tools — `jmap`, `jstack`, dan diagnostic utility yang relevan terhadap risiko heap/thread dump.
6. OWASP Logging Cheat Sheet — prinsip redaction dan logging sensitive data.
7. OWASP Cryptographic Storage Cheat Sheet — key/secret handling untuk cryptographic material.
8. NIST SP 800-57 — key management lifecycle dan security strength guidance.

---

## 30. Status Seri

Part ini adalah **Part 24 dari 35**.

Seri belum selesai. Berikutnya:

```text
Part 25 — Secure Logging, Audit Trail Integrity, Evidence, and Non-Repudiation
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-security-cryptography-integrity-part-023](./learn-java-security-cryptography-integrity-part-023.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-security-cryptography-integrity-part-025](./learn-java-security-cryptography-integrity-part-025.md)
