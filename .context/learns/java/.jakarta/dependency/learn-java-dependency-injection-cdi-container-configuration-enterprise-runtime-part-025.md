# Part 025 — Configuration Fundamentals: Values, Secrets, Environments, and Runtime Contracts

> Seri: `learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime`  
> Part: `025`  
> Topik: Configuration fundamentals sebelum masuk ke MicroProfile Config, profile, feature flag, dan conditional runtime selection  
> Target: Java 8–25, Java EE / Jakarta EE, CDI, app server, cloud/container runtime

---

## 0. Posisi Part Ini Dalam Seri

Pada part sebelumnya kita sudah membahas:

1. dependency management,
2. API/SPI/provider,
3. transisi `javax.*` ke `jakarta.*`,
4. container model,
5. classloader/deployment isolation,
6. DI/CDI core,
7. scope/proxy/producer/event/interceptor/decorator,
8. lifecycle callback,
9. CDI extension,
10. Enterprise Beans,
11. Jakarta annotations,
12. JNDI/resource/environment entries.

Part ini mulai masuk ke blok berikutnya: **configuration runtime**.

Kalau dependency injection menjawab:

```text
Object apa yang dibutuhkan object ini?
```

configuration menjawab:

```text
Nilai runtime apa yang membuat object ini berperilaku benar di environment tertentu?
```

Contoh:

```text
Dependency:
- AuditTrailWriter
- PaymentGatewayClient
- CaseAssignmentPolicy
- DataSource
- Clock

Configuration:
- audit.enabled=true
- payment.timeout.ms=3000
- case.assignment.max-active-cases=50
- datasource.jdbc-url=...
- system.timezone=Asia/Jakarta
```

Kesalahan dependency biasanya membuat aplikasi gagal start atau gagal injection.  
Kesalahan configuration bisa lebih licin:

- aplikasi berhasil start,
- health check hijau,
- request normal terlihat berjalan,
- tetapi keputusan bisnis salah,
- routing salah,
- feature aktif di environment yang salah,
- timeout terlalu besar,
- secret bocor,
- audit tidak terekam,
- retry menghantam sistem downstream,
- compliance rule diam-diam tidak berlaku.

Engineer senior tidak hanya bertanya:

```text
Bagaimana membaca config?
```

Tetapi:

```text
Apa kontrak config ini?
Siapa pemiliknya?
Kapan nilainya boleh berubah?
Bagaimana divalidasi?
Bagaimana dibuktikan di production?
Apa default-nya aman?
Apa failure mode-nya?
Apa dampaknya ke transaksi, security, audit, SLA, dan workflow?
```

---

## 1. Definisi Configuration

Configuration adalah **data eksternal atau semi-eksternal yang mengubah perilaku aplikasi tanpa mengubah kode business logic utama**.

Namun definisi ini perlu hati-hati.

Tidak semua nilai yang bisa diubah adalah configuration yang baik.

Misalnya:

```java
int maxRetry = 3;
```

Bisa jadi configuration.

Tetapi:

```java
if (country.equals("SG")) {
    applyCeaRegulatoryPolicy();
}
```

jangan langsung dijadikan:

```properties
country.policy=CEA
```

kalau sebenarnya itu adalah **domain rule**, bukan environment configuration.

### 1.1 Configuration vs Business Data

| Aspek | Configuration | Business Data |
|---|---|---|
| Tujuan | Mengatur perilaku sistem | Mewakili fakta/domain record |
| Contoh | timeout, endpoint URL, feature enabled | case status, application form, inspection result |
| Pemilik | platform/app owner/devops/app config owner | user/domain/process owner |
| Perubahan | controlled deployment/runtime operation | transaksi aplikasi biasa |
| Audit | perlu untuk config penting | wajib sebagai domain data |
| Validasi | startup/deploy/runtime validation | business validation |

Contoh salah:

```properties
case.status.approved=APPROVED
case.status.rejected=REJECTED
```

Kalau status adalah bagian domain model, jangan dijadikan configuration sembarangan. Itu harus menjadi enum/domain vocabulary yang stabil, dengan migration plan kalau berubah.

Contoh benar:

```properties
case.assignment.max-open-cases-per-officer=25
case.escalation.default-sla-days=14
case.audit.include-request-payload=false
case.notification.email.enabled=true
```

Ini mengatur perilaku operasional atau parameter kebijakan yang memang perlu externalized.

---

## 2. Mental Model: Configuration Sebagai Runtime Contract

Configuration bukan sekadar key-value.

Configuration adalah kontrak antara:

```text
Application code
    ↕
Runtime/container/platform
    ↕
Deployment environment
    ↕
Operational owner
```

Diagram:

```text
┌───────────────────────────────────────────────┐
│ Application Code                               │
│ - expects typed values                         │
│ - validates invariants                         │
│ - uses config at correct lifecycle phase       │
└───────────────────────┬───────────────────────┘
                        │
                        ▼
┌───────────────────────────────────────────────┐
│ Configuration Abstraction                      │
│ - lookup                                       │
│ - conversion                                   │
│ - precedence                                   │
│ - defaults                                     │
│ - dynamic/static semantics                     │
└───────────────────────┬───────────────────────┘
                        │
                        ▼
┌───────────────────────────────────────────────┐
│ Configuration Sources                          │
│ - env vars                                     │
│ - system properties                            │
│ - property files                               │
│ - server config                                │
│ - Kubernetes ConfigMap/Secret                  │
│ - cloud parameter store                        │
│ - database                                     │
│ - feature flag service                         │
└───────────────────────┬───────────────────────┘
                        │
                        ▼
┌───────────────────────────────────────────────┐
│ Operational Reality                            │
│ - dev/uat/prod                                 │
│ - tenant/agency                                │
│ - rollback                                     │
│ - incident response                            │
│ - audit/compliance                             │
└───────────────────────────────────────────────┘
```

A config key yang baik punya jawaban jelas untuk pertanyaan berikut:

1. Apa nama key-nya?
2. Apa tipe datanya?
3. Apakah wajib?
4. Apa default-nya?
5. Apakah default itu aman?
6. Kapan dibaca?
7. Apakah boleh berubah tanpa restart?
8. Siapa pemilik perubahan?
9. Apa rentang nilai valid?
10. Apa dampak jika salah?
11. Apakah mengandung secret?
12. Apakah boleh muncul di log?
13. Apakah perlu audit perubahan?
14. Bagaimana diuji?
15. Bagaimana didiagnosis di production?

Kalau sebuah config tidak punya jawaban tersebut, ia bukan kontrak. Ia hanya string random yang kebetulan dibaca aplikasi.

---

## 3. Kategori Configuration Berdasarkan Waktu Evaluasi

Salah satu kesalahan paling umum adalah menganggap semua config sama.

Padahal config berbeda berdasarkan **kapan** nilainya memengaruhi sistem.

### 3.1 Build-Time Configuration

Build-time config memengaruhi artifact saat dibuat.

Contoh:

```text
- target Java release
- annotation processing mode
- generated code toggle
- native image build option
- dependency profile
- build plugin setting
```

Contoh Maven:

```xml
<properties>
    <maven.compiler.release>17</maven.compiler.release>
</properties>
```

Contoh Gradle:

```kotlin
java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}
```

Karakteristik:

| Aspek | Build-Time Config |
|---|---|
| Dibaca saat | build/compile/package |
| Mengubah artifact? | ya |
| Butuh redeploy? | ya |
| Cocok untuk | compiler, codegen, dependency mode |
| Risiko | artifact environment-specific |

Prinsip penting:

> Jangan memasukkan environment production secret ke build-time config.

Artifact idealnya dapat dipromosikan dari environment ke environment:

```text
build once → deploy many
```

Bukan:

```text
build-dev.jar
build-uat.jar
build-prod.jar
```

Kecuali ada alasan kuat dan terkontrol.

### 3.2 Packaging-Time Configuration

Packaging-time config terjadi saat artifact dirakit.

Contoh:

```text
- memasukkan file default `application.properties`
- memilih WAR descriptor
- memilih server deployment descriptor
- mengemas library tertentu
```

Risiko:

```text
Artifact menjadi environment-specific tanpa terlihat jelas.
```

Contoh smell:

```text
src/main/resources/application-prod.properties
```

Lalu build pipeline memilih file berdasarkan profile Maven.

Ini kadang praktis, tetapi berisiko karena artifact prod berbeda dengan artifact UAT.

### 3.3 Deploy-Time Configuration

Deploy-time config diberikan saat deployment.

Contoh:

```text
- environment variable di Kubernetes Deployment
- ConfigMap
- Secret
- app server datasource binding
- JNDI resource reference
- JVM system property
- container command argument
```

Contoh Kubernetes:

```yaml
env:
  - name: CASE_ASSIGNMENT_MAX_OPEN_CASES
    value: "25"
  - name: AUDIT_ENABLED
    value: "true"
```

Karakteristik:

| Aspek | Deploy-Time Config |
|---|---|
| Dibaca saat | process/container start |
| Mengubah artifact? | tidak |
| Butuh restart? | biasanya ya |
| Cocok untuk | endpoint, timeout, pool size, feature startup flag |
| Risiko | drift antar replica/environment |

### 3.4 Startup-Time Configuration

Startup-time config dibaca saat aplikasi boot.

Contoh:

```java
@PostConstruct
void init() {
    this.maxOpenCases = config.getValue("case.assignment.max-open-cases", Integer.class);
}
```

Karakteristik:

```text
Nilai dibaca sekali → disimpan di field → tidak berubah sampai restart.
```

Cocok untuk:

```text
- pool size
- fixed endpoint
- required secret reference
- startup validation
- static feature mode
- tenant registry yang tidak berubah sering
```

Risiko:

Jika operator mengubah config source tetapi aplikasi tidak restart, nilai efektif tetap lama.

Maka dokumentasi config harus menyebut:

```text
Requires restart: yes/no
```

### 3.5 Runtime Dynamic Configuration

Runtime config bisa berubah saat aplikasi berjalan.

Contoh:

```text
- feature flag
- kill switch
- rate limit threshold
- emergency downstream disable switch
- dynamic routing weight
```

Karakteristik:

| Aspek | Runtime Dynamic Config |
|---|---|
| Dibaca saat | per request/per operation/periodic refresh |
| Butuh restart? | tidak |
| Cocok untuk | ops control, progressive rollout, emergency switch |
| Risiko | inconsistent decision, stale cache, race condition |

Contoh interface:

```java
public interface FeatureFlagService {
    boolean isEnabled(String flagName, EvaluationContext context);
}
```

Runtime config harus memperjelas:

```text
- cache TTL
- fallback saat config service down
- consistency antar node
- audit decision
- observability
```

### 3.6 Tabel Ringkas

| Jenis | Kapan dibaca | Butuh rebuild | Butuh restart | Contoh |
|---|---:|---:|---:|---|
| Build-time | build | ya | ya | compiler release, codegen |
| Packaging-time | package | ya | ya | bundled property file |
| Deploy-time | deployment/start | tidak | biasanya ya | env var, JNDI binding |
| Startup-time | boot | tidak | ya | datasource URL, pool size |
| Runtime dynamic | request/runtime | tidak | tidak | feature flag, kill switch |

---

## 4. Configuration Source

Configuration source adalah tempat nilai config berasal.

Umumnya:

```text
1. hardcoded default
2. property file dalam artifact
3. external property file
4. JVM system properties
5. OS environment variables
6. app server config
7. JNDI env-entry/resource reference
8. Kubernetes ConfigMap
9. Kubernetes Secret
10. cloud parameter store / secret manager
11. database config table
12. feature flag service
13. command line arguments
14. config server
```

### 4.1 Hardcoded Default

Contoh:

```java
int timeoutMs = config.getOptionalValue("payment.timeout.ms", Integer.class)
                      .orElse(3000);
```

Hardcoded default boleh dipakai jika:

```text
- default aman,
- default berlaku lintas environment,
- default terdokumentasi,
- default tidak menyembunyikan missing critical config.
```

Contoh default aman:

```properties
notification.email.enabled=false
```

Contoh default berbahaya:

```properties
audit.enabled=false
```

Jika audit wajib secara compliance, missing config harus fail-fast, bukan default false.

### 4.2 Property File Dalam Artifact

Contoh:

```text
src/main/resources/META-INF/microprofile-config.properties
```

Atau:

```text
src/main/resources/application.properties
```

Kelebihan:

```text
- mudah dibaca developer,
- bagus untuk default,
- versioned bersama kode.
```

Kekurangan:

```text
- tidak cocok untuk secret,
- perubahan butuh rebuild/redeploy,
- risk environment-specific artifact.
```

Gunakan untuk default non-sensitive:

```properties
case.assignment.max-open-cases=25
http.client.default-timeout-ms=3000
feature.new-dashboard.enabled=false
```

Jangan gunakan untuk:

```properties
prod.db.password=...
prod.api.secret=...
```

### 4.3 JVM System Properties

Contoh:

```bash
java -Dcase.assignment.max-open-cases=25 -jar app.jar
```

Kelebihan:

```text
- explicit di startup command,
- mudah override,
- umum di Java runtime.
```

Kekurangan:

```text
- bisa terlihat di process args,
- kurang ideal untuk secret,
- sulit dikelola jika terlalu banyak.
```

### 4.4 Environment Variables

Contoh:

```bash
export CASE_ASSIGNMENT_MAX_OPEN_CASES=25
export AUDIT_ENABLED=true
```

Kelebihan:

```text
- language agnostic,
- natural untuk container/cloud,
- mudah disediakan platform,
- artifact tetap sama.
```

Kekurangan:

```text
- hanya string,
- naming conversion bisa membingungkan,
- tidak cocok untuk config sangat besar/terstruktur,
- secret di env var punya risiko exposure tergantung platform.
```

The Twelve-Factor App mendorong penyimpanan config di environment variables agar config bisa berubah antar deploy tanpa mengubah code, serta mengurangi risiko config file custom masuk ke repository.

Namun di sistem enterprise, env vars bukan satu-satunya jawaban. Env var adalah transport/config injection mechanism yang baik, tetapi governance tetap perlu:

```text
- siapa yang mengubah,
- bagaimana approval,
- bagaimana audit,
- bagaimana rollback,
- bagaimana masking.
```

### 4.5 App Server Configuration

Dalam Jakarta EE tradisional, banyak resource dikonfigurasi di server:

```text
- DataSource
- JMS ConnectionFactory
- Mail Session
- ManagedExecutorService
- security realm
- JNDI binding
```

Aplikasi hanya mereferensikan nama:

```java
@Resource(lookup = "java:jboss/datasources/CaseDS")
private DataSource dataSource;
```

Atau lebih portable melalui resource reference:

```java
@Resource(name = "jdbc/CaseDS")
private DataSource dataSource;
```

Lalu server/deployment descriptor mengikatnya ke resource aktual.

Kelebihan:

```text
- resource dikelola container,
- pooling/security/transaction integration,
- cocok untuk app server governance.
```

Kekurangan:

```text
- kurang portable antar server,
- debugging JNDI bisa sulit,
- config tersebar di luar repo aplikasi,
- cloud-native deployment kadang lebih memilih env/config file.
```

### 4.6 Kubernetes ConfigMap dan Secret

Contoh ConfigMap:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: case-service-config
data:
  CASE_ASSIGNMENT_MAX_OPEN_CASES: "25"
  AUDIT_ENABLED: "true"
```

Contoh Secret:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: case-service-secret
stringData:
  PAYMENT_API_SECRET: "replace-me"
```

Catatan penting:

```text
Kubernetes Secret bukan berarti otomatis aman secara sempurna.
```

Ia adalah mekanisme Kubernetes untuk secret object, tetapi keamanan sebenarnya bergantung pada:

```text
- RBAC,
- encryption at rest,
- access policy,
- namespace isolation,
- logging hygiene,
- secret rotation,
- mount/env exposure,
- pod security.
```

### 4.7 Cloud Parameter Store / Secret Manager

Contoh:

```text
- AWS SSM Parameter Store
- AWS Secrets Manager
- Azure Key Vault
- Google Secret Manager
- HashiCorp Vault
```

Kelebihan:

```text
- centralized secret governance,
- rotation support,
- access policy,
- audit trail,
- encryption integration.
```

Risiko:

```text
- startup dependency ke external service,
- throttling,
- IAM misconfiguration,
- network dependency,
- caching/staleness.
```

Untuk secret, umumnya lebih baik:

```text
Secret manager → deployment platform → app as env/mounted file/runtime fetch
```

Daripada aplikasi mengambil secret secara liar dari banyak tempat tanpa pola.

### 4.8 Database-Backed Configuration

Contoh table:

```sql
CREATE TABLE APP_CONFIG (
    CONFIG_KEY VARCHAR2(200) PRIMARY KEY,
    CONFIG_VALUE VARCHAR2(4000) NOT NULL,
    UPDATED_AT TIMESTAMP NOT NULL,
    UPDATED_BY VARCHAR2(100) NOT NULL
);
```

Kelebihan:

```text
- bisa diubah runtime,
- bisa diaudit,
- bisa dibuat UI internal,
- cocok untuk tenant-specific config.
```

Risiko:

```text
- aplikasi bergantung pada DB untuk config,
- circular dependency jika datasource config juga di DB,
- transaction coupling,
- cache invalidation,
- consistency antar node,
- schema migration,
- permission model.
```

Database-backed config cocok untuk **business-admin-controlled operational settings**, bukan untuk semua hal.

Contoh cocok:

```text
- agency-specific SLA threshold
- notification template toggle
- tenant routing rule
- workflow threshold that must be audited
```

Contoh tidak cocok:

```text
- datasource URL
- DB password
- low-level connection pool size
```

---

## 5. Precedence: Nilai Mana Yang Menang?

Kalau config key muncul di banyak source, sistem harus punya aturan precedence.

Contoh:

```text
application default: payment.timeout.ms=3000
env var:             PAYMENT_TIMEOUT_MS=5000
system property:     -Dpayment.timeout.ms=1000
```

Nilai mana yang efektif?

Tanpa precedence yang jelas, debugging production menjadi tebak-tebakan.

### 5.1 Generic Precedence Model

Satu model umum:

```text
Highest precedence
    command line args / system properties
    environment variables
    external config file
    server deployment config
    application bundled config
    code default
Lowest precedence
```

Namun setiap framework/runtime bisa berbeda.

Karena itu setiap project harus mendokumentasikan:

```text
Effective config source order
```

### 5.2 MicroProfile Config Preview

MicroProfile Config menyediakan model `ConfigSource` dengan ordinal. Sumber default yang umum dibahas dalam spesifikasi mencakup:

```text
- System properties
- Environment variables
- META-INF/microprofile-config.properties
```

Detail ini akan dibahas di Part 026. Untuk part ini cukup pahami bahwa config modern tidak boleh hanya `System.getenv()` tersebar di seluruh kode. Perlu abstraction yang menyatukan source, precedence, conversion, dan validation.

### 5.3 Precedence Failure Example

Misal aplikasi punya:

```properties
# bundled default
case.audit.enabled=false
```

Di production operator set:

```bash
CASE_AUDIT_ENABLED=true
```

Tetapi aplikasi membaca langsung:

```java
Properties props = loadFromClasspath("application.properties");
boolean audit = Boolean.parseBoolean(props.getProperty("case.audit.enabled"));
```

Maka env var tidak pernah dipakai.

Bug-nya bukan di value. Bug-nya di config abstraction.

---

## 6. Typing: Semua Source String, Tetapi Domain Butuh Type

Environment variables dan property file pada dasarnya string.

Tetapi aplikasi membutuhkan type:

```text
String
int
long
boolean
Duration
URI
URL
Path
Enum
List<String>
Set<String>
Map<String, String>
BigDecimal
LocalDate
```

### 6.1 Jangan Parse Sembarangan Di Mana-Mana

Buruk:

```java
int timeoutMs = Integer.parseInt(System.getenv("PAYMENT_TIMEOUT_MS"));
```

Masalah:

```text
- missing env → NullPointerException/NumberFormatException,
- tidak ada default policy,
- tidak ada pesan error yang domain-friendly,
- parsing tersebar,
- sulit test,
- sulit trace source.
```

Lebih baik:

```java
public record PaymentClientConfig(
    URI baseUri,
    Duration timeout,
    int maxRetries,
    boolean enabled
) {
    public PaymentClientConfig {
        if (timeout.isNegative() || timeout.isZero()) {
            throw new IllegalArgumentException("payment.timeout must be positive");
        }
        if (maxRetries < 0 || maxRetries > 5) {
            throw new IllegalArgumentException("payment.maxRetries must be between 0 and 5");
        }
    }
}
```

Kemudian config dibaca di satu tempat:

```java
@ApplicationScoped
public class PaymentClientConfigProducer {

    @Inject
    ConfigReader config;

    @Produces
    @ApplicationScoped
    PaymentClientConfig paymentClientConfig() {
        return new PaymentClientConfig(
            config.requiredUri("payment.base-uri"),
            config.requiredDuration("payment.timeout"),
            config.intValue("payment.max-retries", 3),
            config.booleanValue("payment.enabled", true)
        );
    }
}
```

Intinya:

```text
raw string → typed config object → validated runtime contract
```

### 6.2 Primitive Trap

Hati-hati dengan primitive:

```java
int maxRetries;
boolean enabled;
```

Primitive punya default Java:

```text
int     → 0
boolean → false
long    → 0
```

Kalau binding framework gagal atau config missing, default primitive bisa menyembunyikan error.

Untuk config binding, sering lebih aman menggunakan wrapper/object/record dengan validation:

```java
Integer maxRetries;
Boolean enabled;
```

Lalu fail-fast jika required value tidak ada.

---

## 7. Required Config, Optional Config, dan Default

Setiap config harus masuk salah satu kategori:

```text
1. required tanpa default
2. optional dengan default aman
3. optional tanpa default
4. derived dari config lain
5. runtime dynamic dengan fallback policy
```

### 7.1 Required Tanpa Default

Contoh:

```text
payment.base-uri
payment.client-id
payment.secret-ref
datasource.jndi-name
```

Kalau tidak ada, aplikasi harus gagal start.

```text
Fail fast > fail later under traffic
```

Contoh error baik:

```text
Missing required configuration: payment.base-uri
Expected: absolute URI, e.g. https://payment-api.example.gov
Source checked: system properties, environment variables, application defaults
Startup aborted because PaymentGatewayClient cannot be safely initialized.
```

Contoh error buruk:

```text
NullPointerException at PaymentClient.java:42
```

### 7.2 Optional Dengan Default Aman

Contoh:

```properties
payment.max-retries=3
payment.timeout=PT3S
feature.experimental-search.enabled=false
```

Default aman berarti:

```text
Jika operator lupa mengatur value, sistem tetap berada dalam mode konservatif.
```

Contoh:

```text
feature.enabled default false
```

Biasanya aman.

Tetapi:

```text
audit.enabled default false
```

mungkin tidak aman.

### 7.3 Optional Tanpa Default

Contoh:

```text
proxy.http.host
proxy.http.port
```

Artinya:

```text
Kalau absent, fitur proxy tidak dipakai.
```

Namun ini harus eksplisit dalam model:

```java
public record ProxyConfig(Optional<URI> proxyUri) {}
```

Jangan menyembunyikan optional di null liar.

### 7.4 Derived Config

Derived config dihitung dari config lain.

Contoh:

```text
base-url=https://api.example.gov
endpoint.case=/case
```

Derived:

```text
case-api-url=https://api.example.gov/case
```

Derived config sebaiknya dihitung dalam typed config object, bukan disalin manual di banyak source.

Buruk:

```properties
base-url=https://api.example.gov
case-api-url=https://api.example.gov/case
appeal-api-url=https://api.example.gov/appeal
```

Kalau base berubah, derived bisa drift.

Lebih baik:

```java
public URI caseApiUri() {
    return baseUri.resolve("/case");
}
```

---

## 8. Config Validation

Configuration validation adalah mekanisme untuk memastikan value memenuhi kontrak sebelum dipakai.

Ada beberapa level.

### 8.1 Syntax Validation

Apakah bisa diparse?

```text
"3000" → int valid
"abc"  → int invalid
```

```text
"PT3S" → Duration valid
"3 seconds" → mungkin invalid tergantung parser
```

### 8.2 Range Validation

Apakah berada di rentang aman?

```text
payment.timeout.ms > 0
payment.timeout.ms <= 30000
thread.pool.size >= 1
thread.pool.size <= 200
```

### 8.3 Semantic Validation

Apakah masuk akal secara domain/runtime?

```text
if payment.enabled=true, payment.base-uri must exist
if audit.mode=ASYNC, audit.queue-name must exist
if feature.x.enabled=true, dependency endpoint must be configured
```

### 8.4 Cross-Config Validation

Contoh:

```text
min <= max
connectTimeout <= requestTimeout
cacheTtl < tokenExpiry
rateLimitPerMinute <= downstreamContractLimit
```

Contoh Java:

```java
public record OneMapClientConfig(
    URI baseUri,
    Duration connectTimeout,
    Duration requestTimeout,
    Duration cacheTtl,
    Duration tokenTtl,
    int rateLimitPerMinute
) {
    public OneMapClientConfig {
        if (connectTimeout.compareTo(requestTimeout) > 0) {
            throw new IllegalArgumentException("connectTimeout must not exceed requestTimeout");
        }
        if (cacheTtl.compareTo(tokenTtl) >= 0) {
            throw new IllegalArgumentException("cacheTtl must be shorter than tokenTtl");
        }
        if (rateLimitPerMinute <= 0 || rateLimitPerMinute > 300) {
            throw new IllegalArgumentException("rateLimitPerMinute must be between 1 and 300");
        }
    }
}
```

### 8.5 Environment-Specific Validation

Contoh:

```text
In production:
- TLS must be enabled
- mock connector must be disabled
- audit must be enabled
- debug endpoint must be disabled
- insecure trust-all must be false
```

Ini bukan sekadar config parsing. Ini runtime safety invariant.

Contoh:

```java
if (env.isProduction() && paymentConfig.trustAllCertificates()) {
    throw new IllegalStateException("trustAllCertificates cannot be true in production");
}
```

---

## 9. Secrets vs Non-Secrets

Secret adalah config yang jika bocor dapat memberi akses, impersonation, privilege, atau data exposure.

Contoh secret:

```text
- DB password
- API token
- OAuth client secret
- private key
- signing key
- encryption key
- webhook secret
- keystore password
- SFTP password
```

Non-secret:

```text
- timeout
- base URL publik
- feature toggle umum
- pool size
- rate limit
- log level
```

Sensitive-but-not-secret:

```text
- internal hostnames
- tenant IDs
- account IDs
- queue names
- topic names
- operational topology
```

### 9.1 Rule: Jangan Log Secret

Buruk:

```java
log.info("Loaded payment config: {}", paymentConfig);
```

Kalau `paymentConfig.toString()` mencetak secret, bocor.

Lebih baik:

```java
public record PaymentConfig(
    URI baseUri,
    String clientId,
    SecretValue clientSecret,
    Duration timeout
) {
    @Override
    public String toString() {
        return "PaymentConfig[baseUri=" + baseUri
            + ", clientId=" + clientId
            + ", clientSecret=***"
            + ", timeout=" + timeout + "]";
    }
}
```

Atau jangan override manual; buat safe diagnostic view:

```java
public Map<String, String> safeDiagnosticView() {
    return Map.of(
        "payment.baseUri", baseUri.toString(),
        "payment.clientId", maskClientId(clientId),
        "payment.clientSecret", "***",
        "payment.timeout", timeout.toString()
    );
}
```

### 9.2 Secret Reference vs Secret Value

Lebih baik menyimpan reference:

```properties
payment.secret-ref=/prod/case-service/payment/client-secret
```

Daripada menyebar value:

```properties
payment.client-secret=actual-secret-value
```

Tetapi aplikasi tetap pada akhirnya membutuhkan value. Maka pertanyaannya:

```text
Siapa yang resolve secret reference menjadi secret value?
```

Pilihan:

```text
1. deployment platform resolve sebelum app start
2. sidecar/agent mount secret sebagai file
3. app fetch dari secret manager saat startup
4. app fetch dynamic dengan cache/rotation
```

Masing-masing punya trade-off.

### 9.3 Secret Rotation

Config design harus memikirkan rotation:

```text
- Apakah secret bisa rotate tanpa restart?
- Apakah client mendukung dual secret?
- Apakah downstream menerima old + new sementara?
- Apakah connection pool perlu refresh?
- Apakah cache harus invalidated?
```

Contoh DB password rotation bisa sulit karena connection pool menyimpan connection lama.

Model aman:

```text
rotation prepared → deploy config/new secret → reload pool or rolling restart → revoke old secret
```

---

## 10. Environment Variable Naming

Java property sering pakai dot/kebab:

```properties
case.assignment.max-open-cases=25
payment.timeout.ms=3000
```

Environment variable biasanya uppercase underscore:

```bash
CASE_ASSIGNMENT_MAX_OPEN_CASES=25
PAYMENT_TIMEOUT_MS=3000
```

Masalah muncul saat mapping tidak standar.

Contoh:

```text
case.assignment.max-open-cases
case.assignment.max.open.cases
CASE_ASSIGNMENT_MAX_OPEN_CASES
CASE_ASSIGNMENT_MAX_OPEN_CASES_
```

Harus ada naming convention.

### 10.1 Rekomendasi Naming

Gunakan hierarchy yang konsisten:

```text
<domain>.<component>.<property>
```

Contoh:

```properties
case.assignment.max-open-cases=25
case.assignment.rebalance.enabled=false
case.escalation.default-sla-days=14
audit.writer.mode=ASYNC
audit.writer.queue-size=1000
external.onemap.base-uri=https://...
external.onemap.rate-limit-per-minute=250
```

Untuk env var:

```text
CASE_ASSIGNMENT_MAX_OPEN_CASES
CASE_ASSIGNMENT_REBALANCE_ENABLED
CASE_ESCALATION_DEFAULT_SLA_DAYS
AUDIT_WRITER_MODE
AUDIT_WRITER_QUEUE_SIZE
EXTERNAL_ONEMAP_BASE_URI
EXTERNAL_ONEMAP_RATE_LIMIT_PER_MINUTE
```

### 10.2 Hindari Nama Terlalu Umum

Buruk:

```properties
timeout=3000
enabled=true
url=https://...
```

Lebih baik:

```properties
external.payment.timeout-ms=3000
feature.case-bulk-assignment.enabled=true
external.payment.base-uri=https://...
```

Kenapa?

Karena configuration space adalah namespace global. Nama umum akan tabrakan.

---

## 11. Environment: Dev, Test, UAT, Staging, Production

Environment adalah konteks deployment.

Contoh:

```text
local
dev
sit
uat
staging
prod
dr
```

Tetapi environment bukan satu-satunya dimensi.

Sistem enterprise sering punya:

```text
- zone: intranet / internet
- tenant: agency A / agency B
- region: ap-southeast-1 / ap-southeast-3
- mode: migration / normal
- user group: internal / public
- data classification: restricted / public
```

### 11.1 Jangan Semua Hal Dijadikan Environment

Buruk:

```text
profile=prod-agency-a-internet-migration-featurex
```

Ini profile explosion.

Lebih baik pisahkan dimensi:

```properties
runtime.environment=prod
runtime.zone=internet
runtime.tenant=agency-a
runtime.mode=migration
feature.x.enabled=true
```

### 11.2 Environment Config Invariant

Contoh invariant production:

```text
runtime.environment=prod
security.tls.required=true
audit.enabled=true
debug.enabled=false
mock.external-services=false
feature.experimental.enabled=false by default
```

Contoh invariant local:

```text
runtime.environment=local
mock.external-services=true allowed
debug.enabled=true allowed
```

Part 027 akan membahas profile lebih detail. Di part ini cukup pahami bahwa environment adalah satu dimensi configuration, bukan tempat membuang semua conditional logic.

---

## 12. Configuration Ownership

Config punya owner.

Tanpa owner, config akan jadi “siapa saja bisa ubah asal aplikasi jalan”.

Kategori owner:

| Config | Owner utama |
|---|---|
| timeout client | engineering/platform |
| datasource binding | infra/platform/DBA/app owner |
| feature flag rollout | product/app owner/engineering |
| business threshold | business owner + engineering guardrail |
| secret | security/platform/app owner |
| audit toggle | compliance/security/app owner |
| log level | operations/engineering |

### 12.1 Ownership Matrix

Contoh:

| Key | Type | Owner | Change approval | Restart | Secret | Audit |
|---|---|---|---|---:|---:|---:|
| `external.payment.base-uri` | URI | platform/app | change request | yes | no | yes |
| `external.payment.client-secret` | secret | security/platform | secret rotation | maybe | yes | yes |
| `audit.enabled` | boolean | compliance/app | CAB/security | yes | no | yes |
| `feature.new-case-routing.enabled` | boolean | product/app | rollout approval | no | no | yes |
| `case.assignment.max-open-cases` | int | business/app | product/business | maybe | no | yes |

Top-level engineering discipline:

```text
Configuration must be governed like code when it can change system behavior materially.
```

---

## 13. Configuration Drift

Configuration drift terjadi ketika value antar environment atau antar replica tidak sesuai ekspektasi.

Contoh:

```text
UAT:
external.payment.timeout-ms=3000

PROD node 1:
external.payment.timeout-ms=3000

PROD node 2:
external.payment.timeout-ms=10000
```

Atau:

```text
DEV has feature enabled
UAT disabled
PROD accidentally enabled
```

### 13.1 Jenis Drift

```text
1. environment drift
2. replica drift
3. source drift
4. documentation drift
5. runtime effective-value drift
6. secret version drift
```

### 13.2 Cara Mengendalikan Drift

```text
- config as code
- GitOps
- deployment templates
- generated config manifest
- startup config validation
- safe effective config endpoint
- config checksum annotation
- release checklist
- environment comparison report
```

### 13.3 Effective Config Manifest

Saat startup, aplikasi bisa membuat diagnostic manifest yang aman:

```json
{
  "runtime.environment": "prod",
  "runtime.zone": "internet",
  "external.payment.base-uri": "https://payment.example.gov",
  "external.payment.client-secret": "***",
  "external.payment.timeout-ms": "3000",
  "audit.enabled": "true",
  "feature.new-routing.enabled": "false"
}
```

Jangan tampilkan secret value.

Manfaat:

```text
- incident debugging,
- environment comparison,
- release verification,
- audit support.
```

Risiko:

```text
- endpoint diagnostic bisa membocorkan topology/internal config.
```

Maka perlu proteksi:

```text
- admin only,
- masked values,
- no raw secrets,
- no public exposure,
- maybe disabled in public zone.
```

---

## 14. Reload: Static vs Dynamic

Tidak semua config boleh reload otomatis.

### 14.1 Static Config

Static config butuh restart.

Contoh:

```text
- datasource URL
- server port
- connection pool size
- thread pool size
- CDI bean selection at startup
- cryptographic provider mode
```

Kenapa?

Karena nilai ini membentuk resource/lifecycle structure.

Mengubahnya di runtime tanpa orchestration bisa menyebabkan:

```text
- connection leak,
- half-updated state,
- inconsistent pool behavior,
- proxy graph tidak berubah,
- transactional resource mismatch.
```

### 14.2 Dynamic Config

Dynamic config boleh berubah tanpa restart.

Contoh:

```text
- feature flag,
- kill switch,
- rate limit,
- log level sementara,
- external connector disable switch,
- sampling rate.
```

Tetapi dynamic config perlu policy:

```text
- refresh interval,
- consistency model,
- cache TTL,
- fallback,
- observability,
- audit.
```

### 14.3 Reload Danger Example

Misal:

```properties
payment.base-uri=https://payment-v1.example.gov
```

Runtime berubah menjadi:

```properties
payment.base-uri=https://payment-v2.example.gov
```

Jika HTTP client dibuat saat startup:

```java
@ApplicationScoped
public class PaymentClient {
    private final URI baseUri;

    public PaymentClient(PaymentConfig config) {
        this.baseUri = config.baseUri();
    }
}
```

Maka perubahan config tidak berpengaruh.

Kalau engineer mengira dynamic, incident terjadi.

Dokumentasikan:

```text
payment.base-uri: startup-time, requires rolling restart
```

---

## 15. Configuration and CDI

Configuration sering masuk ke CDI melalui beberapa pola.

### 15.1 Direct Injection of Primitive Config

Contoh MicroProfile style:

```java
@Inject
@ConfigProperty(name = "case.assignment.max-open-cases")
int maxOpenCases;
```

Kelebihan:

```text
- ringkas,
- cocok untuk simple config,
- cepat dipahami.
```

Kekurangan:

```text
- tersebar di banyak class,
- cross-config validation sulit,
- config ownership tidak terkonsentrasi,
- primitive default trap,
- testing bisa lebih scattered.
```

### 15.2 Typed Config Object Producer

Lebih baik untuk config kompleks:

```java
public record CaseAssignmentConfig(
    int maxOpenCases,
    Duration rebalanceInterval,
    boolean rebalanceEnabled
) {}
```

Producer:

```java
@ApplicationScoped
public class CaseAssignmentConfigProducer {

    @Inject
    ConfigReader config;

    @Produces
    @ApplicationScoped
    CaseAssignmentConfig produce() {
        return new CaseAssignmentConfig(
            config.requiredInt("case.assignment.max-open-cases"),
            config.duration("case.assignment.rebalance-interval", Duration.ofMinutes(10)),
            config.booleanValue("case.assignment.rebalance-enabled", false)
        );
    }
}
```

Consumer:

```java
@ApplicationScoped
public class CaseAssignmentService {

    private final CaseAssignmentConfig config;

    @Inject
    public CaseAssignmentService(CaseAssignmentConfig config) {
        this.config = config;
    }
}
```

Keuntungan:

```text
- config terkonsentrasi,
- bisa divalidasi,
- mudah dites,
- domain intent jelas,
- mudah dibuat safe diagnostic.
```

### 15.3 Configuration Boundary Pattern

Buat layer khusus:

```text
infrastructure/config
    ConfigReader
    ConfigValidationException
    PaymentClientConfigProducer
    AuditConfigProducer
    FeatureFlagConfigProducer
```

Business service jangan tahu terlalu banyak tentang `System.getenv`, `ConfigProvider`, atau source detail.

---

## 16. Configuration and Transactions

Config bisa memengaruhi transaction boundary.

Contoh:

```properties
case.approval.requires-audit-before-commit=true
notification.send-after-commit=true
```

Bahaya jika config mengubah transaction semantics tanpa audit.

Misal:

```properties
payment.capture.requires-new-transaction=true
```

Ini bukan toggle ringan. Ini mengubah consistency model.

### 16.1 Transaction-Sensitive Config

Config berikut harus diperlakukan high-risk:

```text
- transaction timeout
- retry count for transactional operation
- async vs sync dispatch
- before-commit vs after-commit observer
- idempotency enabled/disabled
- outbox enabled/disabled
- batch chunk size
```

Perlu:

```text
- documented semantics,
- testing,
- rollout plan,
- monitoring,
- rollback.
```

---

## 17. Configuration and Security

Security config berisiko tinggi.

Contoh:

```properties
security.jwt.issuer=https://issuer.example.gov
security.jwt.audience=case-service
security.cors.allowed-origins=https://portal.example.gov
security.tls.trust-all=false
security.cookie.secure=true
security.csrf.enabled=true
```

### 17.1 Dangerous Defaults

Berbahaya:

```properties
security.tls.trust-all=true
security.csrf.enabled=false
security.cookie.secure=false
security.auth.required=false
```

Dalam local/dev mungkin diperlukan, tetapi production harus fail-fast jika value unsafe.

### 17.2 Redaction

Security config sering perlu masked diagnostic:

```text
security.jwt.issuer=https://issuer.example.gov
security.jwt.public-key=***
security.client-secret=***
security.cookie.secure=true
```

### 17.3 Config Injection Attack

Jika attacker bisa mengubah config, attacker bisa mengubah perilaku aplikasi.

Contoh:

```text
- mengganti OAuth issuer,
- mengganti redirect URI,
- menonaktifkan audit,
- mengubah endpoint external ke server attacker,
- menurunkan TLS verification,
- mengaktifkan debug endpoint.
```

Karena itu config source harus dilindungi seperti control plane.

---

## 18. Configuration and Observability

Config memengaruhi observability.

Contoh:

```properties
logging.level.com.example.case=INFO
metrics.enabled=true
tracing.sampling-rate=0.1
health.downstream.payment.enabled=true
```

### 18.1 Observability Config Jangan Menjadi Blindfold

Misal:

```properties
metrics.enabled=false
```

Jika production issue terjadi, sistem menjadi buta.

Aturan:

```text
Observability-disabling config in production must be restricted and audited.
```

### 18.2 Log Effective Config Safely

Saat startup:

```text
INFO Effective runtime profile: prod
INFO Effective zone: internet
INFO Audit enabled: true
INFO Payment base URI: https://payment.example.gov
INFO Payment secret: ***
INFO Feature new-routing: false
```

Jangan log semua env var mentah.

---

## 19. Configuration and Feature Flags

Feature flag adalah bentuk khusus runtime configuration, tetapi tidak semua config adalah feature flag.

Config biasa:

```properties
external.payment.timeout-ms=3000
```

Feature flag:

```properties
feature.case.new-routing.enabled=true
```

Feature flag biasanya punya lifecycle:

```text
create → rollout → observe → complete → remove
```

Config biasa bisa hidup lama.

Feature flag yang tidak dihapus menjadi flag debt.

Part 028 akan membahas ini detail. Di sini cukup pahami:

```text
Feature flag adalah runtime decisioning mechanism, bukan tempat menyimpan semua business rule.
```

---

## 20. Anti-Patterns Configuration

### 20.1 `System.getenv()` Everywhere

Buruk:

```java
public class PaymentService {
    void pay() {
        String timeout = System.getenv("PAYMENT_TIMEOUT_MS");
    }
}
```

Masalah:

```text
- parsing tersebar,
- sulit test,
- tidak ada validation,
- tidak ada precedence,
- tidak ada diagnostic,
- tidak ada ownership.
```

### 20.2 Silent Default for Critical Config

Buruk:

```java
boolean auditEnabled = Boolean.parseBoolean(
    config.getOrDefault("audit.enabled", "false")
);
```

Jika audit wajib, ini fatal.

### 20.3 Magic String Config Keys

Buruk:

```java
config.get("x.y.z")
```

di 50 tempat.

Lebih baik centralized constants atau typed config object.

### 20.4 Environment-Specific Code Branch Everywhere

Buruk:

```java
if (env.equals("prod")) {
    ...
} else if (env.equals("uat")) {
    ...
} else if (env.equals("dev")) {
    ...
}
```

Lebih baik:

```text
- inject different implementation,
- use config value,
- use profile/qualifier/producer,
- keep environment logic at composition/config boundary.
```

### 20.5 Config as Business Rule Dump

Buruk:

```properties
if.case.type.A.and.amount.gt.1000.then.approver=manager
```

Jika rule kompleks, gunakan rule engine/policy model/domain table yang diaudit, bukan property string liar.

### 20.6 Secret in Git

Buruk:

```properties
prod.db.password=actual-password
```

Sekali masuk Git, anggap bocor.

### 20.7 Dynamic Config Without Consistency Model

Buruk:

```text
Node A sees feature=true
Node B sees feature=false
User request bounces between nodes
Workflow outcome inconsistent
```

Kalau dynamic, tentukan consistency.

### 20.8 Over-Configurable System

Tidak semua hal harus configurable.

Semakin banyak config:

```text
- semakin besar state space,
- semakin sulit test,
- semakin banyak kombinasi invalid,
- semakin sulit support,
- semakin banyak failure mode.
```

Prinsip:

```text
Make things configurable only when there is a real operational or product need.
```

---

## 21. Designing a Configuration Contract

Untuk setiap config penting, buat spec kecil.

Template:

```text
Key:
Type:
Description:
Required:
Default:
Valid range:
Allowed values:
Secret:
Read timing:
Dynamic reload:
Owner:
Change approval:
Production invariant:
Failure behavior:
Observability:
Test coverage:
```

Contoh:

```text
Key: external.onemap.rate-limit-per-minute
Type: integer
Description: Maximum outbound OneMap calls per minute from this service.
Required: no
Default: 250
Valid range: 1..300
Secret: no
Read timing: startup
Dynamic reload: no
Owner: application engineering / platform
Change approval: app owner approval if production
Production invariant: must not exceed downstream contract limit
Failure behavior: startup fail if >300 or <=0
Observability: expose safe effective value in admin config endpoint
Test coverage: config validation unit test + startup smoke test
```

Contoh secret:

```text
Key: external.payment.client-secret
Type: secret string
Description: OAuth client secret for payment API client credentials flow.
Required: yes if external.payment.enabled=true
Default: none
Valid range: non-blank
Secret: yes
Read timing: startup
Dynamic reload: no, rotation via rolling restart
Owner: security/platform
Change approval: secret rotation process
Production invariant: must not be logged or exposed in diagnostics
Failure behavior: startup fail if missing while payment enabled
Observability: expose only "configured=true" and secret version/reference
Test coverage: missing secret startup failure; redaction test
```

---

## 22. Configuration Manifest Example

Untuk sistem case management/regulatory enforcement, config bisa dikelompokkan seperti ini:

```properties
# Runtime identity
runtime.environment=uat
runtime.zone=intranet
runtime.region=ap-southeast-1
runtime.application=case-management

# Case assignment
case.assignment.max-open-cases=25
case.assignment.rebalance-enabled=false
case.assignment.rebalance-interval=PT10M

# Escalation
case.escalation.default-sla-days=14
case.escalation.reminder-days-before-due=3

# Audit
audit.enabled=true
audit.writer.mode=ASYNC
audit.writer.queue-size=1000
audit.include-request-body=false

# External connector
external.onemap.enabled=true
external.onemap.base-uri=https://www.onemap.gov.sg
external.onemap.timeout=PT3S
external.onemap.rate-limit-per-minute=250
external.onemap.cache-ttl=PT24H

# Notification
notification.email.enabled=true
notification.email.retry-count=3
notification.email.timeout=PT5S

# Feature flags bootstrap default
feature.case.new-routing.enabled=false
feature.case.bulk-assignment.enabled=false

# Security
security.debug-endpoints.enabled=false
security.tls.trust-all=false
```

Setiap kelompok bisa punya typed config object:

```text
RuntimeConfig
CaseAssignmentConfig
CaseEscalationConfig
AuditConfig
OneMapClientConfig
NotificationConfig
FeatureBootstrapConfig
SecurityConfig
```

---

## 23. Example: Bad vs Good Configuration Design

### 23.1 Bad Version

```java
@ApplicationScoped
public class OneMapService {

    public Address lookup(String postalCode) {
        String enabled = System.getenv("ONEMAP_ENABLED");
        if ("false".equals(enabled)) {
            return null;
        }

        String url = System.getenv("ONEMAP_URL");
        int timeout = Integer.parseInt(System.getenv("TIMEOUT"));
        String token = System.getenv("TOKEN");

        // call external API
        return call(url, token, postalCode, timeout);
    }
}
```

Masalah:

```text
- config key terlalu umum: TIMEOUT, TOKEN,
- parsing runtime per call,
- no validation,
- no default policy,
- null return ambiguity,
- token raw string risk,
- no rate limit contract,
- no cache TTL config,
- no safe diagnostic,
- business service tahu env var source.
```

### 23.2 Better Version

```java
public record OneMapConfig(
    boolean enabled,
    URI baseUri,
    Duration timeout,
    int rateLimitPerMinute,
    Duration cacheTtl,
    SecretValue clientSecret
) {
    public OneMapConfig {
        if (enabled && baseUri == null) {
            throw new IllegalArgumentException("external.onemap.base-uri is required when OneMap is enabled");
        }
        if (timeout == null || timeout.isZero() || timeout.isNegative()) {
            throw new IllegalArgumentException("external.onemap.timeout must be positive");
        }
        if (rateLimitPerMinute <= 0 || rateLimitPerMinute > 300) {
            throw new IllegalArgumentException("external.onemap.rate-limit-per-minute must be 1..300");
        }
        if (cacheTtl == null || cacheTtl.isNegative()) {
            throw new IllegalArgumentException("external.onemap.cache-ttl must be zero or positive");
        }
    }

    public Map<String, String> safeDiagnosticView() {
        return Map.of(
            "external.onemap.enabled", Boolean.toString(enabled),
            "external.onemap.base-uri", baseUri == null ? "" : baseUri.toString(),
            "external.onemap.timeout", timeout.toString(),
            "external.onemap.rate-limit-per-minute", Integer.toString(rateLimitPerMinute),
            "external.onemap.cache-ttl", cacheTtl.toString(),
            "external.onemap.client-secret", clientSecret == null ? "not-configured" : "***"
        );
    }
}
```

Producer:

```java
@ApplicationScoped
public class OneMapConfigProducer {

    @Inject
    ConfigReader config;

    @Produces
    @ApplicationScoped
    OneMapConfig oneMapConfig() {
        boolean enabled = config.booleanValue("external.onemap.enabled", false);

        return new OneMapConfig(
            enabled,
            enabled ? config.requiredUri("external.onemap.base-uri") : null,
            config.duration("external.onemap.timeout", Duration.ofSeconds(3)),
            config.intValue("external.onemap.rate-limit-per-minute", 250),
            config.duration("external.onemap.cache-ttl", Duration.ofHours(24)),
            enabled ? config.requiredSecret("external.onemap.client-secret") : null
        );
    }
}
```

Service:

```java
@ApplicationScoped
public class OneMapService {

    private final OneMapConfig config;
    private final OneMapHttpClient client;

    @Inject
    public OneMapService(OneMapConfig config, OneMapHttpClient client) {
        this.config = config;
        this.client = client;
    }

    public Optional<Address> lookup(String postalCode) {
        if (!config.enabled()) {
            return Optional.empty();
        }
        return client.lookup(postalCode);
    }
}
```

Perbaikan:

```text
- config typed,
- validation terpusat,
- naming jelas,
- default aman,
- secret masked,
- service bersih dari source detail,
- failure saat startup, bukan saat traffic,
- mudah test.
```

---

## 24. Config Reader Abstraction

Sebelum masuk MicroProfile Config, kita bisa bayangkan abstraction minimal:

```java
public interface ConfigReader {
    String requiredString(String key);
    Optional<String> optionalString(String key);

    boolean booleanValue(String key, boolean defaultValue);
    int intValue(String key, int defaultValue);
    int requiredInt(String key);

    Duration duration(String key, Duration defaultValue);
    Duration requiredDuration(String key);

    URI requiredUri(String key);
    SecretValue requiredSecret(String key);
}
```

Implementation bisa pakai:

```text
- MicroProfile Config,
- app server env-entry,
- system properties,
- env vars,
- test map,
- custom config source.
```

Keuntungan interface:

```text
Business/application config producer tidak hard-coupled ke source detail.
```

Untuk test:

```java
public final class MapConfigReader implements ConfigReader {
    private final Map<String, String> values;

    public MapConfigReader(Map<String, String> values) {
        this.values = values;
    }

    @Override
    public String requiredString(String key) {
        String value = values.get(key);
        if (value == null || value.isBlank()) {
            throw new ConfigValidationException("Missing required config: " + key);
        }
        return value;
    }

    // other methods...
}
```

---

## 25. Fail-Fast vs Degraded Mode

Tidak semua config error harus menghasilkan startup failure. Tetapi keputusan ini harus sadar.

### 25.1 Fail-Fast

Gunakan fail-fast untuk:

```text
- required datasource missing,
- required secret missing,
- invalid security config,
- audit required but disabled,
- invalid transaction/resource config,
- config cross-validation failure,
- unsupported environment/profile.
```

Manfaat:

```text
- error ketahuan sebelum traffic,
- deployment gagal jelas,
- menghindari data corruption/compliance breach.
```

### 25.2 Degraded Mode

Gunakan degraded mode untuk:

```text
- optional external connector down,
- non-critical notification disabled,
- optional cache unavailable,
- feature flag service temporarily unavailable with safe fallback.
```

Tetapi degraded mode harus eksplisit:

```text
- log warning,
- health status degraded,
- metric emitted,
- user behavior defined,
- operational alert if needed.
```

Contoh:

```java
if (!notificationConfig.enabled()) {
    log.warn("Email notification is disabled by configuration");
    metrics.counter("notification.disabled.config").increment();
}
```

---

## 26. Configuration Testing Strategy

### 26.1 Unit Test Typed Config

```java
@Test
void shouldRejectInvalidRateLimit() {
    assertThrows(IllegalArgumentException.class, () ->
        new OneMapConfig(
            true,
            URI.create("https://onemap.example"),
            Duration.ofSeconds(3),
            999,
            Duration.ofHours(1),
            SecretValue.of("secret")
        )
    );
}
```

### 26.2 Test Missing Required Config

```java
@Test
void shouldFailWhenPaymentEnabledButSecretMissing() {
    ConfigReader reader = new MapConfigReader(Map.of(
        "external.payment.enabled", "true",
        "external.payment.base-uri", "https://payment.example"
    ));

    PaymentConfigProducer producer = new PaymentConfigProducer(reader);

    assertThrows(ConfigValidationException.class, producer::produce);
}
```

### 26.3 Test Production Invariant

```java
@Test
void productionMustNotAllowTrustAllTls() {
    SecurityConfig config = new SecurityConfig(
        RuntimeEnvironment.PROD,
        true
    );

    assertThrows(IllegalStateException.class, config::validate);
}
```

### 26.4 Test Redaction

```java
@Test
void diagnosticViewMustRedactSecret() {
    PaymentConfig config = new PaymentConfig(
        URI.create("https://payment.example"),
        "client-a",
        SecretValue.of("super-secret"),
        Duration.ofSeconds(3)
    );

    assertThat(config.safeDiagnosticView().toString())
        .doesNotContain("super-secret");
}
```

### 26.5 Startup Smoke Test

Deploy app with test config and verify:

```text
- application starts,
- invalid config fails,
- effective config endpoint masks secret,
- required profiles work,
- unsafe production config rejected.
```

---

## 27. Production Configuration Checklist

Gunakan checklist ini sebelum production release.

### 27.1 Contract

```text
[ ] Every config key has documented type.
[ ] Required/default semantics are documented.
[ ] Valid range/allowed values are documented.
[ ] Owner is defined.
[ ] Change process is defined for high-risk config.
```

### 27.2 Safety

```text
[ ] Critical config fails fast if missing.
[ ] Unsafe production config is rejected.
[ ] Secrets are not in Git.
[ ] Secrets are masked in logs/diagnostics.
[ ] Secret rotation path exists.
```

### 27.3 Runtime

```text
[ ] Static vs dynamic config is documented.
[ ] Restart requirement is documented.
[ ] Effective config can be inspected safely.
[ ] Config source precedence is known.
[ ] Replica drift can be detected.
```

### 27.4 Testing

```text
[ ] Typed config validation is unit tested.
[ ] Missing required config is tested.
[ ] Invalid range is tested.
[ ] Production invariant is tested.
[ ] Redaction is tested.
```

### 27.5 Operations

```text
[ ] Config changes are auditable.
[ ] Rollback plan exists.
[ ] Alerting exists for degraded config mode.
[ ] Feature/ops toggles have owner.
[ ] Dead flags/config keys are cleaned up.
```

---

## 28. Failure Model: Configuration Incident Taxonomy

| Failure | Example | Symptom | Prevention |
|---|---|---|---|
| Missing required config | no `payment.base-uri` | startup fail / runtime NPE | fail-fast validation |
| Invalid type | `timeout=abc` | parse error | typed conversion |
| Invalid range | `pool.size=10000` | resource exhaustion | range validation |
| Unsafe default | `audit=false` | compliance gap | no default for critical config |
| Wrong precedence | env ignored | unexpected behavior | documented config abstraction |
| Drift | node values differ | inconsistent behavior | effective config checksum |
| Secret leak | config logged | credential exposure | redaction tests |
| Dynamic inconsistency | flag differs per node | inconsistent workflow | cache/consistency policy |
| Runtime stale value | config changed but not reloaded | operator confusion | restart/reload documentation |
| Source outage | secret manager unavailable | startup fail | cache/sidecar/fallback policy |
| Profile explosion | too many env branches | untested combinations | separate dimensions |
| Over-configurability | dozens of toggles | support nightmare | reduce config surface |

---

## 29. Top 1% Mental Model

A top-level engineer sees configuration as **runtime state with governance**, not just properties.

They ask:

```text
1. Is this value truly configuration, or is it domain data/code?
2. Is it static, startup-time, or dynamic?
3. Is the default safe?
4. Is missing value safer than fallback?
5. Is the config typed and validated?
6. Is the source precedence deterministic?
7. Is it safe to show in diagnostics?
8. Is it secret/sensitive/non-sensitive?
9. Can it drift between replicas?
10. Does it affect transaction/security/audit/compliance?
11. Who owns changing it?
12. How do we test invalid values?
13. How do we rollback a bad config change?
14. How do we know what value is effective in production?
```

This is the key shift:

```text
Junior view:
Configuration is a map of strings.

Senior view:
Configuration is a typed, validated, governed runtime contract.

Top 1% view:
Configuration is part of the system's control plane.
A bad config change can be equivalent to a bad code deploy.
```

---

## 30. Connection to Next Parts

Part ini memberi fondasi konseptual.

Berikutnya:

```text
Part 026 — MicroProfile Config Deep Dive
```

Akan masuk ke:

```text
- ConfigSource
- ordinal/precedence
- default sources
- `Config`
- `ConfigProvider`
- `@ConfigProperty`
- Optional/default values
- Provider<T>
- conversion
- custom converter
- dynamic lookup
- CDI integration
- testing pattern
```

Lalu:

```text
Part 027 — Profiles
Part 028 — Feature Flags
Part 029 — Conditional Beans and Runtime Selection Patterns
```

---

## 31. Ringkasan

Configuration adalah runtime contract.

Yang harus dikuasai:

```text
- config category by timing,
- config source,
- precedence,
- typing,
- validation,
- required/default semantics,
- secret handling,
- drift detection,
- reload model,
- CDI integration,
- governance,
- testing,
- incident diagnosis.
```

Prinsip desain paling penting:

```text
Do not let raw strings leak across your system.
Convert raw config into typed, validated, domain-intent configuration objects at the boundary.
```

Jika configuration didesain buruk, sistem akan rapuh walaupun kode terlihat bersih.

Jika configuration didesain baik, deployment lebih aman, incident lebih mudah didiagnosis, dan behavior antar environment bisa dipertanggungjawabkan.

---

## 32. Referensi Resmi dan Bacaan Lanjutan

- MicroProfile Config specification: config sources, aggregation, source precedence/ordinal, typed access, converters.
- Jakarta EE Platform specification: deployment, resource environment, application server contract.
- Jakarta Annotations specification: `@Resource`, lifecycle annotations, common annotation model.
- The Twelve-Factor App — Config: environment-based externalized configuration principle.
- Vendor runtime documentation seperti Open Liberty, WildFly, Payara, Quarkus untuk detail implementasi config source dan deployment environment.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 024 — Naming, JNDI, Environment Entries, and Externalized Resources](./learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-024.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 026 — MicroProfile Config Deep Dive](./learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-026.md)
