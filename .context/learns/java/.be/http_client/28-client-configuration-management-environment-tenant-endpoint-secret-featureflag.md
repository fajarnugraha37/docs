# Part 28 — Client Configuration Management: Environment, Tenant, Endpoint, Secret, Feature Flag

> Series: `learn-java-http-client-okhttp-retrofit-client-engineering`  
> File: `28-client-configuration-management-environment-tenant-endpoint-secret-featureflag.md`  
> Scope: Java 8–25, JDK HttpClient, OkHttp, Retrofit, Apache HttpClient 5, Spring RestClient/WebClient, generated clients, enterprise integration.

---

## 1. Tujuan Part Ini

Di part sebelumnya kita sudah membahas HTTP client dari banyak sisi: lifecycle, timeout, pooling, DNS, TLS, auth, retry, rate limiting, circuit breaker, observability, testing, mapping, performance, concurrency, security, dan generated client.

Part ini membahas satu hal yang sering terlihat “administratif”, tetapi di production justru menjadi salah satu sumber incident paling sering:

> **configuration management untuk HTTP client.**

HTTP client yang bagus bukan hanya punya kode yang benar. Ia juga harus punya konfigurasi yang benar, tervalidasi, aman, observable, dan dapat dikendalikan per environment, per tenant, per downstream, dan per mode operasi.

Konfigurasi HTTP client menentukan:

- request pergi ke endpoint mana,
- credential apa yang dipakai,
- timeout berapa,
- retry aktif atau tidak,
- rate limit berapa,
- circuit breaker policy seperti apa,
- proxy mana yang digunakan,
- TLS truststore/keystore apa yang dipakai,
- feature flag apa yang mengubah routing,
- apakah client melakukan canary ke endpoint baru,
- apakah failover boleh dilakukan,
- apakah logging body boleh aktif,
- apakah client sedang berada di degraded mode.

Dengan kata lain:

> **HTTP client configuration adalah control plane untuk outbound integration.**

Kalau config salah, kode sebagus apa pun akan tetap gagal.

---

## 2. Core Mental Model

### 2.1 Jangan Anggap Config sebagai “Key-Value Biasa”

Banyak engineer melihat konfigurasi seperti ini:

```properties
payment.base-url=https://api.payment.example.com
payment.timeout=3000
payment.api-key=xxx
```

Itu tidak salah, tetapi terlalu dangkal.

Top-tier engineer melihat konfigurasi sebagai **runtime contract**:

```text
ExternalIntegrationClient =
  DestinationPolicy
  + CredentialPolicy
  + TimeoutPolicy
  + RetryPolicy
  + RateLimitPolicy
  + CircuitBreakerPolicy
  + TLSPolicy
  + ProxyPolicy
  + ObservabilityPolicy
  + FeatureFlagPolicy
  + ValidationPolicy
```

Artinya, setiap HTTP client harus punya konfigurasi yang menjawab:

1. **Ke mana boleh connect?**
2. **Dengan identitas apa?**
3. **Berapa lama boleh menunggu?**
4. **Berapa banyak concurrency yang boleh dipakai?**
5. **Kapan boleh retry?**
6. **Kapan harus fail fast?**
7. **Bagaimana config berubah saat endpoint migrasi?**
8. **Bagaimana memastikan config invalid tidak lolos ke production?**
9. **Bagaimana membuktikan config yang aktif saat incident?**

### 2.2 Control Plane vs Data Plane

Pisahkan dua konsep:

```text
Data plane:
  actual HTTP request/response execution

Control plane:
  configuration, policy, routing, credential, limit, flags
```

Contoh:

```text
Data plane:
  call POST /v1/payments

Control plane:
  base URL = https://api.payment.example.com
  connect timeout = 500 ms
  response timeout = 2500 ms
  max concurrency = 50
  retry max attempts = 2
  retry allowed only for 502/503/504
  idempotency key required for POST
  bearer token source = AWS Secrets Manager
  mTLS keystore = /etc/secrets/payment-client.p12
  canary traffic = 5%
```

Kegagalan production sering terjadi karena engineer hanya menguji data plane, tetapi tidak menguji control plane.

---

## 3. Apa Saja yang Harus Dikonfigurasi pada HTTP Client?

### 3.1 Destination / Endpoint

Minimal:

```yaml
payment:
  base-url: https://api.payment.example.com
```

Tetapi production-grade biasanya butuh:

```yaml
payment:
  endpoints:
    primary: https://api.payment.example.com
    secondary: https://api2.payment.example.com
    sandbox: https://sandbox.payment.example.com
  routing:
    mode: primary
    canary-percent: 0
    failover-enabled: false
```

Pertanyaan desain:

- Apakah endpoint berubah per environment?
- Apakah endpoint berubah per tenant?
- Apakah endpoint bisa failover?
- Apakah endpoint baru akan diuji via canary?
- Apakah endpoint boleh berasal dari request user?
- Apakah endpoint harus lewat allowlist?
- Apakah redirect boleh mengubah host?

### 3.2 Timeout

Contoh:

```yaml
onemap:
  timeout:
    connect: 500ms
    response: 2s
    write: 1s
    call: 3s
```

Timeout harus dipisah berdasarkan fase. Jangan hanya punya satu `timeout=30000`.

Common config:

```text
connectTimeout
readTimeout / responseTimeout
writeTimeout
callTimeout / operationTimeout
poolAcquireTimeout
idleTimeout
keepAliveTimeout
retryTotalDeadline
```

### 3.3 Pool dan Concurrency

Contoh:

```yaml
payment:
  pool:
    max-total: 200
    max-per-host: 50
    max-idle: 20
    keep-alive: 60s
    ttl: 5m
  concurrency:
    max-in-flight: 50
    queue-size: 100
```

Pool config berbeda dari concurrency config:

```text
connection pool limit:
  berapa koneksi/socket boleh hidup

concurrency limit:
  berapa request boleh in-flight

queue limit:
  berapa request boleh menunggu sebelum ditolak
```

### 3.4 Retry Policy

Contoh:

```yaml
payment:
  retry:
    enabled: true
    max-attempts: 2
    backoff-initial: 100ms
    backoff-max: 1s
    jitter: full
    retryable-statuses: [502, 503, 504]
    retryable-methods: [GET, PUT, DELETE]
    retry-post-only-with-idempotency-key: true
```

Retry config harus eksplisit. Jangan global retry tanpa status/method/exception taxonomy.

### 3.5 Rate Limit / Throttle / Bulkhead

Contoh:

```yaml
onemap:
  rate-limit:
    enabled: true
    permits-per-minute: 250
  bulkhead:
    max-concurrent-calls: 25
    max-wait-time: 0ms
```

Ini penting untuk:

- third-party API dengan quota,
- endpoint mahal,
- downstream yang tidak bisa diskalakan cepat,
- batch job yang bisa membanjiri API,
- multi-tenant system yang butuh fairness.

### 3.6 Circuit Breaker

Contoh:

```yaml
payment:
  circuit-breaker:
    enabled: true
    failure-rate-threshold: 50
    slow-call-rate-threshold: 50
    slow-call-duration-threshold: 2s
    sliding-window-size: 100
    minimum-number-of-calls: 20
    wait-duration-in-open-state: 30s
    permitted-calls-in-half-open-state: 5
```

Circuit breaker bukan sekadar toggle. Ia harus sesuai dengan latency, traffic volume, dan criticality downstream.

### 3.7 Authentication / Credential

Contoh:

```yaml
payment:
  auth:
    type: oauth2-client-credentials
    token-url: https://auth.payment.example.com/oauth/token
    client-id: ${PAYMENT_CLIENT_ID}
    client-secret-ref: /prod/payment/client-secret
    token-expiry-skew: 60s
```

Credential config harus menjawab:

- secret berasal dari mana?
- secret disimpan bagaimana?
- secret bisa rotate tanpa redeploy?
- token cache TTL berapa?
- refresh single-flight ada atau tidak?
- audit logging redaction bagaimana?

### 3.8 TLS / mTLS

Contoh:

```yaml
payment:
  tls:
    truststore-path: /etc/certs/payment-truststore.p12
    truststore-password-ref: /prod/payment/truststore-password
    keystore-path: /etc/certs/payment-client.p12
    keystore-password-ref: /prod/payment/keystore-password
    hostname-verification: true
    protocols: [TLSv1.3, TLSv1.2]
```

Jangan hardcode trust-all. Jangan disable hostname verification sebagai solusi permanent.

### 3.9 Proxy

Contoh:

```yaml
external-api:
  proxy:
    enabled: true
    type: http
    host: proxy.corp.internal
    port: 8080
    username-ref: /prod/proxy/username
    password-ref: /prod/proxy/password
```

Proxy memengaruhi:

- routing,
- TLS inspection,
- auth,
- DNS resolution,
- latency,
- failure taxonomy.

### 3.10 Observability

Contoh:

```yaml
payment:
  observability:
    log-request: true
    log-response: false
    log-body: false
    redact-headers: [Authorization, Cookie, Set-Cookie, X-Api-Key]
    metric-name: outbound.payment
    trace-enabled: true
```

Observability juga konfigurasi. Ia tidak boleh diserahkan ke masing-masing developer secara ad hoc.

### 3.11 Feature Flag dan Routing Mode

Contoh:

```yaml
payment:
  routing:
    mode: feature-flag
    old-endpoint: https://api-v1.payment.example.com
    new-endpoint: https://api-v2.payment.example.com
    flag-name: payment.v2.enabled
```

Feature flag bisa mengontrol:

- endpoint switch,
- canary traffic,
- fallback mode,
- retry on/off,
- circuit breaker threshold,
- cache fallback,
- new authentication method,
- generated client version.

Tetapi jangan semua hal dijadikan dynamic flag. Config yang memengaruhi security dan trust boundary perlu guard yang lebih ketat.

---

## 4. Configuration Scope: Global, Per Client, Per Operation, Per Tenant

### 4.1 Global Config

Global config berlaku untuk semua HTTP client:

```yaml
http-client:
  defaults:
    connect-timeout: 500ms
    response-timeout: 2s
    max-in-flight: 100
    redacted-headers:
      - Authorization
      - Cookie
      - Set-Cookie
      - X-Api-Key
```

Gunakan global default untuk safety baseline.

Tetapi jangan hanya mengandalkan global config.

### 4.2 Per-Client Config

Setiap downstream harus punya config sendiri:

```yaml
clients:
  payment:
    base-url: https://api.payment.example.com
    timeout:
      connect: 300ms
      response: 2s
  notification:
    base-url: https://api.notification.example.com
    timeout:
      connect: 500ms
      response: 5s
```

Kenapa?

Karena setiap downstream punya:

- latency profile berbeda,
- SLA berbeda,
- auth berbeda,
- payload size berbeda,
- retry semantics berbeda,
- criticality berbeda.

### 4.3 Per-Operation Config

Satu downstream bisa punya operasi berbeda:

```yaml
payment:
  operations:
    create-payment:
      timeout:
        call: 3s
      retry:
        enabled: true
        requires-idempotency-key: true
    get-payment-status:
      timeout:
        call: 1s
      retry:
        enabled: true
        max-attempts: 3
    upload-settlement-file:
      timeout:
        call: 60s
      retry:
        enabled: false
```

Jangan pakai timeout upload file untuk semua endpoint. Jangan pakai retry GET untuk semua POST.

### 4.4 Per-Tenant Config

Untuk multi-tenant system:

```yaml
clients:
  reporting:
    tenants:
      agency-a:
        base-url: https://agency-a.reporting.example.com
        credential-ref: /prod/reporting/agency-a/token
        rate-limit: 100/min
      agency-b:
        base-url: https://agency-b.reporting.example.com
        credential-ref: /prod/reporting/agency-b/token
        rate-limit: 50/min
```

Per-tenant config perlu sangat hati-hati:

- tenant A tidak boleh memakai credential tenant B,
- metric harus punya cardinality aman,
- rate limit harus fair,
- secret access harus scoped,
- config validation harus mencegah duplikasi tenant ID.

---

## 5. Configuration Source

### 5.1 Common Sources

Sumber konfigurasi umum:

```text
application.yml / application.properties
environment variables
command-line arguments
Kubernetes ConfigMap
Kubernetes Secret
mounted file
Vault
AWS SSM Parameter Store
AWS Secrets Manager
Azure Key Vault
GCP Secret Manager
database-backed config
remote config service
feature flag provider
```

Setiap source punya trade-off.

### 5.2 File-Based Config

Contoh:

```yaml
clients:
  tax-api:
    base-url: https://tax.example.com
    timeout:
      connect: 500ms
      call: 3s
```

Kelebihan:

- sederhana,
- mudah review di Git,
- cocok untuk non-secret config,
- cocok untuk config stabil.

Kelemahan:

- butuh redeploy untuk berubah,
- risk jika secret ikut masuk repo,
- sulit dynamic reload tanpa tambahan mekanisme.

### 5.3 Environment Variables

Contoh:

```bash
PAYMENT_BASE_URL=https://api.payment.example.com
PAYMENT_CONNECT_TIMEOUT_MS=500
```

Kelebihan:

- cocok untuk container,
- environment-specific,
- mudah override.

Kelemahan:

- kurang terstruktur,
- raw string semua,
- secret bisa terekspos di process environment/logging,
- sulit validasi kompleks.

### 5.4 Secret Manager / Parameter Store

Secret/config sensitif sebaiknya tidak disimpan di Git.

Contoh struktur:

```text
/prod/payment/client-id
/prod/payment/client-secret
/prod/payment/token-url
/prod/payment/keystore-password
/prod/onemap/username
/prod/onemap/password
```

AWS Systems Manager Parameter Store mendukung penyimpanan konfigurasi dan lightweight secrets secara hierarkis. Untuk secret yang butuh rotation otomatis, AWS Secrets Manager biasanya lebih tepat. Parameter Store dapat mereferensikan secret dari Secrets Manager, tetapi Parameter Store sendiri bukan automatic rotation engine.

### 5.5 Feature Flag Provider

Feature flag cocok untuk dynamic decision:

```text
payment.v2.enabled
payment.canary.percent
payment.retry.enabled
payment.failover.enabled
```

OpenFeature menyediakan vendor-agnostic API untuk feature flag, sehingga application code tidak terlalu terikat pada vendor flag tertentu.

Namun feature flag harus dibatasi:

- jangan mengubah trust boundary sembarangan,
- jangan membuat behavior sulit diaudit,
- jangan membuat production policy tidak deterministic,
- jangan menyimpan secret di feature flag.

---

## 6. Config Precedence dan Override

Spring Boot, Kubernetes, container runtime, command-line args, env vars, dan config file biasanya punya precedence masing-masing.

Masalah umum:

```text
application.yml bilang timeout 2s
ENV override timeout jadi 30s
developer tidak sadar
incident terjadi karena request menggantung terlalu lama
```

Top-tier design:

1. Config source precedence didokumentasikan.
2. Effective config dicetak secara aman saat startup.
3. Secret tidak pernah dicetak.
4. Config diff antar environment bisa dibandingkan.
5. Unknown config key bisa dideteksi.
6. Invalid config membuat startup gagal.

Contoh effective config log:

```text
HTTP_CLIENT_CONFIG payment:
  baseUrl=https://api.payment.example.com
  connectTimeout=500ms
  callTimeout=3000ms
  retry.enabled=true
  retry.maxAttempts=2
  bulkhead.maxConcurrentCalls=50
  auth.type=oauth2-client-credentials
  auth.clientSecret=<redacted>
  tls.mtls.enabled=true
```

---

## 7. Typed Configuration Object

Jangan sebar config sebagai string literal.

Buruk:

```java
String url = env.getProperty("payment.base-url");
int timeout = Integer.parseInt(env.getProperty("payment.timeout"));
```

Lebih baik:

```java
public final class HttpClientProperties {
    private URI baseUrl;
    private TimeoutProperties timeout;
    private RetryProperties retry;
    private BulkheadProperties bulkhead;
    private AuthProperties auth;
    private TlsProperties tls;

    public URI baseUrl() {
        return baseUrl;
    }

    public TimeoutProperties timeout() {
        return timeout;
    }
}
```

Spring-style:

```java
@ConfigurationProperties(prefix = "clients.payment")
public record PaymentClientProperties(
        URI baseUrl,
        TimeoutProperties timeout,
        RetryProperties retry,
        AuthProperties auth
) {
}

public record TimeoutProperties(
        Duration connect,
        Duration response,
        Duration call
) {
}
```

Kelebihan typed config:

- validasi lebih mudah,
- auto-completion,
- testable,
- tidak typo-prone,
- bisa punya invariant,
- bisa dipakai untuk effective config report.

---

## 8. Configuration Validation

### 8.1 Fail Fast at Startup

HTTP client config harus divalidasi saat startup.

Contoh invariant:

```text
baseUrl must be absolute URI
baseUrl scheme must be https in production
connectTimeout > 0
callTimeout >= connectTimeout
retry max attempts >= 1
retry total budget <= call timeout
rate limit > 0 if enabled
mTLS keystore required if auth type = mtls
client secret required if auth type = oauth2-client-credentials
fallback endpoint must not equal primary endpoint
canary percent between 0 and 100
```

Jika config invalid:

```text
application should fail startup
```

Jangan membiarkan config invalid baru ketahuan saat request pertama.

### 8.2 Validate Destination

Contoh:

```java
static void validateBaseUrl(URI baseUrl, boolean production) {
    if (!baseUrl.isAbsolute()) {
        throw new IllegalArgumentException("baseUrl must be absolute");
    }

    if (baseUrl.getHost() == null || baseUrl.getHost().isBlank()) {
        throw new IllegalArgumentException("baseUrl must have host");
    }

    if (production && !"https".equalsIgnoreCase(baseUrl.getScheme())) {
        throw new IllegalArgumentException("Production baseUrl must use https");
    }

    if (baseUrl.getUserInfo() != null) {
        throw new IllegalArgumentException("Credentials in URL are not allowed");
    }

    if (baseUrl.getQuery() != null || baseUrl.getFragment() != null) {
        throw new IllegalArgumentException("baseUrl must not contain query or fragment");
    }
}
```

### 8.3 Validate Timeout Relationship

```java
static void validateTimeouts(TimeoutConfig timeout) {
    requirePositive(timeout.connect(), "connectTimeout");
    requirePositive(timeout.call(), "callTimeout");

    if (timeout.call().compareTo(timeout.connect()) < 0) {
        throw new IllegalArgumentException("callTimeout must be >= connectTimeout");
    }

    if (timeout.response() != null && timeout.call().compareTo(timeout.response()) < 0) {
        throw new IllegalArgumentException("callTimeout should be >= responseTimeout");
    }
}
```

### 8.4 Validate Retry and Idempotency

```java
static void validateRetry(RetryConfig retry) {
    if (!retry.enabled()) {
        return;
    }

    if (retry.maxAttempts() < 1) {
        throw new IllegalArgumentException("retry.maxAttempts must be >= 1");
    }

    if (retry.retryableMethods().contains("POST") && !retry.requiresIdempotencyKey()) {
        throw new IllegalArgumentException("POST retry requires idempotency key policy");
    }
}
```

### 8.5 Validate Secret References, Not Secret Values

Prefer:

```yaml
auth:
  client-secret-ref: /prod/payment/client-secret
```

Avoid:

```yaml
auth:
  client-secret: plaintext-secret-in-yaml
```

Validation should check:

```text
secret ref exists
application has permission
secret can be read
secret format valid
secret value not logged
```

---

## 9. Effective Configuration Reporting

Saat startup, tampilkan effective config secara aman.

Contoh:

```java
public final class SafeConfigPrinter {
    public static String print(ClientConfig config) {
        return """
                client=%s
                baseUrl=%s
                connectTimeout=%s
                callTimeout=%s
                retryEnabled=%s
                retryMaxAttempts=%s
                rateLimit=%s
                authType=%s
                clientSecret=%s
                tlsMtlsEnabled=%s
                """.formatted(
                config.name(),
                config.baseUrl(),
                config.timeout().connect(),
                config.timeout().call(),
                config.retry().enabled(),
                config.retry().maxAttempts(),
                config.rateLimit().summary(),
                config.auth().type(),
                "<redacted>",
                config.tls().mtlsEnabled()
        );
    }
}
```

Kenapa penting?

Saat incident, pertanyaan pertama sering:

```text
Config sebenarnya yang sedang aktif apa?
```

Tanpa effective config report, engineer sering menebak.

---

## 10. Environment Strategy

### 10.1 Jangan Samakan DEV/UAT/PROD Tanpa Sengaja

Contoh environment matrix:

| Config | DEV | UAT | PROD |
|---|---:|---:|---:|
| base URL | sandbox | staging | production |
| connect timeout | 1s | 500ms | 300ms |
| call timeout | 10s | 5s | 3s |
| retry | enabled | enabled | enabled with stricter budget |
| rate limit | low | close to prod | vendor-approved |
| logging body | allowed with fake data | limited | disabled/redacted |
| TLS verification | enabled | enabled | enabled |
| mTLS | optional if mock | required if contract | required |
| feature flag | dev override | controlled | controlled/audited |

DEV config yang terlalu longgar bisa menyembunyikan issue. PROD config yang terlalu berbeda bisa menyebabkan surprise.

### 10.2 Environment Drift

Environment drift terjadi ketika UAT tidak cukup mirip dengan PROD.

Contoh:

```text
UAT timeout = 30s
PROD timeout = 3s
UAT proxy disabled
PROD proxy enabled
UAT TLS uses public CA
PROD uses private CA
UAT payload small
PROD payload large
```

Efek:

- test lulus di UAT,
- production gagal karena topology/config berbeda.

Mitigasi:

- config diff report,
- contract test dengan prod-like config,
- synthetic test di staging/prod,
- config review sebelum release.

---

## 11. Endpoint Migration dan Feature Flag

### 11.1 Problem

Downstream mengganti endpoint:

```text
old: https://api.vendor.com/v1
new: https://api.vendor.com/v2
```

Risiko:

- schema berubah,
- auth berubah,
- timeout berubah,
- rate limit berubah,
- error code berubah,
- cert chain berubah,
- DNS berubah,
- observability dashboard masih pakai label lama.

### 11.2 Migration Mode

Gunakan explicit routing mode:

```yaml
vendor:
  routing:
    mode: old-only # old-only | new-only | canary | shadow | failover
    old-base-url: https://api.vendor.com/v1
    new-base-url: https://api.vendor.com/v2
    canary-percent: 0
```

Mode:

```text
old-only:
  semua request ke old endpoint

new-only:
  semua request ke new endpoint

canary:
  sebagian traffic production ke new endpoint

shadow:
  request utama ke old, copy non-impact ke new untuk observasi

failover:
  pakai secondary jika primary gagal sesuai policy
```

### 11.3 Canary Routing

Contoh deterministic canary:

```java
public URI chooseEndpoint(String stableKey, RoutingConfig config) {
    if (config.mode() == RoutingMode.OLD_ONLY) {
        return config.oldBaseUrl();
    }
    if (config.mode() == RoutingMode.NEW_ONLY) {
        return config.newBaseUrl();
    }
    if (config.mode() == RoutingMode.CANARY) {
        int bucket = Math.floorMod(stableKey.hashCode(), 100);
        return bucket < config.canaryPercent()
                ? config.newBaseUrl()
                : config.oldBaseUrl();
    }
    throw new IllegalStateException("Unsupported routing mode: " + config.mode());
}
```

Gunakan stable key seperti tenant ID, user group, agency ID, atau request category. Jangan random per request jika downstream operation tidak idempotent atau butuh konsistensi.

### 11.4 Shadow Traffic

Shadow traffic hati-hati:

```text
main call:
  old endpoint, response dipakai

shadow call:
  new endpoint, response hanya dibandingkan/logged, side effect harus tidak ada
```

Shadow hanya aman untuk:

- read-only operation,
- endpoint sandbox,
- operation yang explicit non-mutating,
- downstream mendukung dry-run.

Jangan shadow `POST createPayment` ke production endpoint tanpa idempotency/dry-run.

---

## 12. Failover Configuration

### 12.1 Failover Bukan Retry Biasa

Retry:

```text
same endpoint, repeat attempt
```

Failover:

```text
different endpoint/region/vendor, repeat or redirect operation
```

Failover punya risiko:

- duplicate side effect,
- inconsistent data,
- stale replica,
- different auth,
- different quota,
- split-brain,
- audit ambiguity.

### 12.2 Failover Config

```yaml
payment:
  failover:
    enabled: false
    primary: https://api-primary.payment.example.com
    secondary: https://api-secondary.payment.example.com
    allowed-methods: [GET]
    failover-on-statuses: [502, 503, 504]
    failover-on-exceptions:
      - connect-timeout
      - connection-refused
    require-idempotency-key-for-commands: true
```

Default yang aman:

```text
failover disabled for commands
failover allowed for safe reads only
explicit enable per operation
```

### 12.3 Failover Observability

Log/metric wajib:

```text
primary endpoint
secondary endpoint
reason for failover
operation
attempt number
idempotency key presence
final result
```

Jangan failover diam-diam.

---

## 13. Dynamic Reload

### 13.1 Kapan Dynamic Reload Berguna?

Dynamic reload berguna untuk:

- menurunkan concurrency saat downstream sakit,
- mematikan retry saat retry storm,
- mengaktifkan fallback sementara,
- menaikkan/menurunkan canary percent,
- switch endpoint saat migration,
- rotate certificate/secret jika framework mendukung aman.

Tetapi tidak semua config cocok dynamic.

### 13.2 Static vs Dynamic Config

| Config | Dynamic? | Catatan |
|---|---:|---|
| base URL | kadang | perlu validation dan audit |
| timeout | ya, hati-hati | perubahan ekstrem bisa bikin incident baru |
| retry enabled | ya | useful untuk mematikan retry storm |
| retry max attempts | ya | perlu budget invariant |
| rate limit | ya | common operational knob |
| circuit threshold | ya | perlu observability |
| TLS truststore | sulit | sering butuh recreate client |
| keystore/mTLS cert | sulit | perlu rotation plan |
| proxy | kadang | bisa butuh recreate client |
| auth client secret | ya, dengan secret manager | token cache harus invalidate |
| logging body | sebaiknya tidak di PROD | security risk |

### 13.3 Atomic Config Snapshot

Jangan update sebagian config secara terpisah.

Buruk:

```text
baseUrl updated
retry policy not yet updated
auth config still old
request fails inconsistently
```

Lebih baik:

```java
public final class ClientRuntimeConfigHolder {
    private final AtomicReference<ClientRuntimeConfig> current;

    public ClientRuntimeConfigHolder(ClientRuntimeConfig initial) {
        this.current = new AtomicReference<>(initial);
    }

    public ClientRuntimeConfig get() {
        return current.get();
    }

    public void replace(ClientRuntimeConfig next) {
        next.validate();
        current.set(next);
    }
}
```

Gunakan immutable config snapshot.

### 13.4 Rebuilding HTTP Client

Beberapa config tidak bisa diubah pada existing client immutable.

Contoh:

- JDK `HttpClient` immutable setelah dibangun.
- OkHttp `OkHttpClient` immutable-style, konfigurasi baru lewat builder/new client.
- Apache client/connection manager punya lifecycle sendiri.

Jika config berubah:

```text
policy-only config:
  update runtime policy object

transport config:
  build new client instance
  warm up if needed
  atomically swap reference
  close old client gracefully
```

Pseudo-pattern:

```java
public final class SwappableHttpTransport<T extends AutoCloseable> {
    private final AtomicReference<T> current;

    public SwappableHttpTransport(T initial) {
        this.current = new AtomicReference<>(initial);
    }

    public T get() {
        return current.get();
    }

    public void swap(T next) {
        T old = current.getAndSet(next);
        closeLater(old);
    }

    private void closeLater(T old) {
        // Graceful shutdown strategy:
        // - stop accepting new requests on old client if possible
        // - wait for in-flight calls
        // - evict idle connections / close resources
    }
}
```

Jangan recreate client per request.

---

## 14. Secret Rotation

### 14.1 Problem

Credential bisa berubah:

- API key rotated,
- OAuth2 client secret rotated,
- certificate rotated,
- truststore updated,
- password changed.

Jika app hanya membaca secret saat startup, rotation butuh restart/redeploy.

### 14.2 Token Credential Rotation

Untuk OAuth2 client credentials:

```text
secret source updated
→ token provider detects new secret version
→ token cache invalidated
→ next token request uses new secret
```

Pattern:

```java
public final class VersionedSecret<T> {
    private final String version;
    private final T value;

    public VersionedSecret(String version, T value) {
        this.version = version;
        this.value = value;
    }

    public String version() {
        return version;
    }

    public T value() {
        return value;
    }
}
```

Token cache should know the secret version used to acquire token.

```java
public final class CachedToken {
    private final String accessToken;
    private final Instant expiresAt;
    private final String secretVersion;
}
```

Jika secret version berubah, token lama bisa dianggap stale.

### 14.3 API Key Rotation

Support dual key window:

```yaml
vendor:
  auth:
    api-key-primary-ref: /prod/vendor/api-key/current
    api-key-secondary-ref: /prod/vendor/api-key/next
    active-key: primary
```

Atau gunakan secret manager versioning.

### 14.4 Certificate Rotation

mTLS/certificate rotation lebih rumit:

- keystore berubah,
- SSLContext perlu dibuat ulang,
- existing pooled TLS connection masih memakai handshake lama,
- downstream mungkin menerima old/new cert selama overlap window.

Pattern:

```text
publish new cert
configure downstream trust first
load new keystore
build new HTTP client with new SSLContext
swap client
allow old in-flight requests finish
close old pool
remove old cert after overlap
```

---

## 15. Config as Code vs Runtime Admin Console

### 15.1 Config as Code

Kelebihan:

- reviewable,
- versioned,
- auditable,
- reproducible,
- rollback via Git.

Cocok untuk:

- base URL,
- timeout baseline,
- TLS requirement,
- auth type,
- default retry policy.

### 15.2 Runtime Admin Console

Kelebihan:

- cepat untuk incident mitigation,
- bisa dynamic,
- cocok untuk operational knobs.

Cocok untuk:

- rate limit sementara,
- disable retry,
- enable circuit open/fallback,
- canary percent,
- endpoint migration toggle.

Risiko:

- perubahan tidak direview,
- audit kurang,
- config drift,
- operator error.

### 15.3 Hybrid Model

Best practice:

```text
baseline policy in Git
runtime override with audited control plane
runtime override has TTL
runtime override has owner/reason
runtime override is visible in dashboard
```

Contoh runtime override:

```json
{
  "client": "payment",
  "override": "retry.enabled=false",
  "reason": "Downstream vendor 503 spike; prevent retry storm",
  "owner": "oncall-fajar",
  "expiresAt": "2026-06-18T12:00:00+07:00"
}
```

---

## 16. Client Factory Pattern

### 16.1 Why Client Factory?

Jika setiap team membuat client sendiri, hasilnya:

- timeout tidak konsisten,
- redaction beda-beda,
- TLS config beda,
- retry policy liar,
- logging body bocor,
- observability tidak seragam,
- secret handling raw.

Solusi:

> Buat `HttpClientFactory` / `OutboundClientFactory` sebagai standard construction path.

### 16.2 Model

```text
ClientConfig
→ validate
→ resolve secrets
→ build TLS context
→ build transport client
→ attach interceptors/filters
→ attach telemetry
→ attach policies
→ expose typed adapter
```

### 16.3 Example: Policy-Aware Factory

```java
public final class OutboundClientFactory {
    private final SecretResolver secretResolver;
    private final MeterRegistryFacade metrics;
    private final TraceContextPropagator traceContext;

    public OutboundClientFactory(
            SecretResolver secretResolver,
            MeterRegistryFacade metrics,
            TraceContextPropagator traceContext
    ) {
        this.secretResolver = secretResolver;
        this.metrics = metrics;
        this.traceContext = traceContext;
    }

    public OkHttpClient createOkHttp(ClientConfig config) {
        config.validate();

        OkHttpClient.Builder builder = new OkHttpClient.Builder()
                .connectTimeout(config.timeout().connect())
                .readTimeout(config.timeout().response())
                .writeTimeout(config.timeout().write())
                .callTimeout(config.timeout().call())
                .addInterceptor(new CorrelationIdInterceptor(traceContext))
                .addInterceptor(new SafeLoggingInterceptor(config.observability()))
                .eventListenerFactory(call -> new MetricsEventListener(metrics, config.name()));

        if (config.proxy().enabled()) {
            builder.proxy(config.proxy().toProxy());
        }

        if (config.tls().customSslContextRequired()) {
            TlsMaterial tls = config.tls().resolve(secretResolver);
            builder.sslSocketFactory(tls.sslSocketFactory(), tls.trustManager());
        }

        return builder.build();
    }
}
```

### 16.4 Factory Invariants

Factory harus memaksa:

```text
no trust-all in production
no infinite timeout
no raw secret logs
no dynamic user-controlled base URL
redaction interceptor always installed
trace propagation always installed
metrics always installed
connection pool not created per request
```

---

## 17. Java 8–25 Considerations

### 17.1 Java 8

Java 8 tidak punya JDK `java.net.http.HttpClient` modern.

Umum dipakai:

- Apache HttpClient 4/5,
- OkHttp,
- Retrofit,
- Spring RestTemplate,
- generated client.

Config concern sama:

```text
timeout
pool
TLS
proxy
auth
retry
observability
```

Tetapi beberapa API modern seperti `Duration`, records, virtual threads, dan structured concurrency tidak tersedia penuh.

### 17.2 Java 11+

JDK `HttpClient` tersedia.

Config penting:

```java
HttpClient client = HttpClient.newBuilder()
        .connectTimeout(Duration.ofMillis(500))
        .followRedirects(HttpClient.Redirect.NEVER)
        .version(HttpClient.Version.HTTP_2)
        .proxy(ProxySelector.getDefault())
        .sslContext(sslContext)
        .build();
```

Perlu wrapper untuk:

- read/call timeout semantics,
- retry,
- auth,
- redaction,
- metrics,
- typed error.

### 17.3 Java 17/21/25

Dengan virtual threads:

```text
blocking client can scale better for I/O-bound calls
```

Tetapi config tetap penting:

```text
virtual threads do not remove need for timeout
virtual threads do not remove need for bulkhead
virtual threads do not remove downstream quota
virtual threads do not remove connection pool limits
```

Records/sealed types juga membantu modelling config dan error taxonomy.

---

## 18. Spring Boot Configuration Pattern

### 18.1 Example YAML

```yaml
clients:
  payment:
    base-url: https://api.payment.example.com
    timeout:
      connect: 500ms
      response: 2s
      call: 3s
    retry:
      enabled: true
      max-attempts: 2
      retryable-statuses: [502, 503, 504]
    auth:
      type: oauth2-client-credentials
      token-url: https://auth.payment.example.com/oauth/token
      client-id: payment-client
      client-secret-ref: /prod/payment/client-secret
    observability:
      log-body: false
      trace-enabled: true
```

### 18.2 Typed Properties

```java
@ConfigurationProperties(prefix = "clients.payment")
@Validated
public record PaymentClientProperties(
        @NotNull URI baseUrl,
        @Valid @NotNull TimeoutProperties timeout,
        @Valid @NotNull RetryProperties retry,
        @Valid @NotNull AuthProperties auth,
        @Valid @NotNull ObservabilityProperties observability
) {
    public PaymentClientProperties {
        validateBaseUrl(baseUrl);
        validateTimeouts(timeout);
        validateRetry(retry);
    }
}
```

### 18.3 Bean Construction

```java
@Configuration
@EnableConfigurationProperties(PaymentClientProperties.class)
public class PaymentClientConfiguration {

    @Bean
    PaymentGateway paymentGateway(
            PaymentClientProperties properties,
            OutboundClientFactory factory
    ) {
        OkHttpClient okHttp = factory.createOkHttp(ClientConfig.from(properties));

        Retrofit retrofit = new Retrofit.Builder()
                .baseUrl(properties.baseUrl().toString())
                .client(okHttp)
                .addConverterFactory(JacksonConverterFactory.create())
                .build();

        PaymentRetrofitApi api = retrofit.create(PaymentRetrofitApi.class);
        return new PaymentGateway(api);
    }
}
```

---

## 19. Kubernetes Configuration Pattern

### 19.1 ConfigMap for Non-Secret

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: outbound-client-config
data:
  PAYMENT_BASE_URL: "https://api.payment.example.com"
  PAYMENT_CONNECT_TIMEOUT: "500ms"
  PAYMENT_CALL_TIMEOUT: "3s"
  PAYMENT_RETRY_ENABLED: "true"
```

### 19.2 Secret for Sensitive Data

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: payment-client-secret
type: Opaque
stringData:
  PAYMENT_CLIENT_SECRET: "replace-me"
```

In real production, prefer external secret integration rather than manually writing secrets to manifests.

### 19.3 Mounted Certs

```yaml
volumeMounts:
  - name: payment-mtls
    mountPath: /etc/payment/certs
    readOnly: true
volumes:
  - name: payment-mtls
    secret:
      secretName: payment-mtls-secret
```

### 19.4 Rollout Concern

ConfigMap/Secret update tidak selalu otomatis membuat application reload. Biasanya perlu:

- rollout restart,
- reloader controller,
- app-level file watcher,
- sidecar sync,
- dynamic config provider.

Jangan berasumsi config berubah berarti app otomatis memakai config baru.

---

## 20. Multi-Client Registry

Untuk sistem besar, buat registry:

```java
public final class ClientRegistry {
    private final Map<ClientName, ClientRuntime> clients;

    public ClientRuntime get(ClientName name) {
        ClientRuntime client = clients.get(name);
        if (client == null) {
            throw new IllegalArgumentException("Unknown client: " + name);
        }
        return client;
    }
}
```

`ClientRuntime` bisa berisi:

```java
public record ClientRuntime(
        String name,
        URI baseUrl,
        Object transport,
        TimeoutPolicy timeout,
        RetryPolicy retry,
        RateLimitPolicy rateLimit,
        CircuitBreakerPolicy circuitBreaker,
        CredentialProvider credentialProvider,
        ObservabilityPolicy observability
) {
}
```

Keuntungan:

- all clients visible,
- effective config dapat diekspor,
- health check per client,
- metrics per client konsisten,
- runtime override bisa dikontrol.

---

## 21. Health Check dan Readiness

HTTP client config perlu dicek, tetapi jangan health check yang terlalu agresif.

### 21.1 Startup Validation vs Runtime Health

Startup validation:

```text
config valid?
secret readable?
cert readable?
URI valid?
policy invariant valid?
```

Runtime health:

```text
downstream reachable?
auth server reachable?
TLS handshake works?
latency acceptable?
rate limit not exhausted?
```

### 21.2 Readiness Trap

Jika service readiness bergantung pada semua downstream harus reachable, maka satu vendor down bisa membuat service tidak ready dan memperbesar outage.

Better:

```text
critical downstream required for readiness:
  maybe yes

optional downstream:
  not readiness blocker, but degraded status
```

Expose:

```json
{
  "payment": {
    "configValid": true,
    "secretLoaded": true,
    "lastProbeStatus": "OK",
    "degraded": false
  },
  "reporting": {
    "configValid": true,
    "secretLoaded": true,
    "lastProbeStatus": "TIMEOUT",
    "degraded": true
  }
}
```

---

## 22. Config Observability

### 22.1 Metrics

Expose safe config-related metrics:

```text
http_client_config_version{client="payment"}
http_client_runtime_override_active{client="payment",key="retry.enabled"}
http_client_config_reload_total{client="payment",result="success|failure"}
http_client_secret_refresh_total{client="payment",result="success|failure"}
http_client_endpoint_mode{client="payment",mode="canary"}
```

Avoid high-cardinality labels:

```text
bad:
  base_url as label if many dynamic URLs
  tenant_id as label if thousands of tenants
  secret_version as label if high churn
```

### 22.2 Logs

Log config changes:

```json
{
  "event": "http_client_config_changed",
  "client": "payment",
  "oldVersion": "42",
  "newVersion": "43",
  "changedKeys": ["retry.enabled", "rateLimit.permitsPerMinute"],
  "owner": "ops",
  "reason": "vendor instability",
  "secretValues": "<redacted>"
}
```

### 22.3 Audit Trail

For regulated systems, config changes need audit attributes:

```text
who changed
what changed
when changed
why changed
approval reference
old value
new value
expiry / rollback
```

Secret values must not be included.

---

## 23. Common Anti-Patterns

### 23.1 One Global Timeout for Everything

```yaml
http.timeout: 30s
```

Problem:

- fast endpoint waits too long,
- slow upload might still be too short,
- retry budget unclear,
- tail latency explodes.

### 23.2 Endpoint from User Input

```java
client.get(request.getTargetUrl());
```

Problem:

- SSRF,
- internal metadata endpoint exposure,
- credential leakage,
- redirect abuse.

Use allowlist and logical destination names.

### 23.3 Hardcoded Secret

```java
String apiKey = "prod-key-123";
```

Problem:

- leaked in repo,
- difficult rotation,
- impossible audit.

### 23.4 Config Without Validation

```java
Duration timeout = Duration.parse(config.get("timeout"));
```

No invariant. No fail fast. No environment guard.

### 23.5 Recreate Client on Config Read

```java
OkHttpClient client = new OkHttpClient.Builder().build();
```

inside every request path.

Problem:

- no pooling,
- TLS handshake storm,
- socket churn,
- GC pressure.

### 23.6 Feature Flag Everything

If every behavior is dynamic, debugging becomes hard.

Use feature flags for controlled operational decision, not arbitrary hidden logic.

### 23.7 Silent Runtime Override

An operator changes retry from 1 to 5 during incident, no audit, no TTL.

Result:

- retry storm,
- downstream worse,
- nobody knows why.

### 23.8 PROD Allows HTTP

```yaml
base-url: http://api.vendor.com
```

In production, default should reject non-HTTPS unless there is explicit approved exception.

---

## 24. Production Configuration Checklist

### 24.1 Destination

- [ ] Base URL absolute.
- [ ] Scheme allowed.
- [ ] HTTPS required in production.
- [ ] No credentials in URL.
- [ ] No query/fragment in base URL.
- [ ] Host allowlisted.
- [ ] Redirect policy explicit.
- [ ] Failover endpoint explicit.
- [ ] Canary mode explicit.

### 24.2 Timeout

- [ ] Connect timeout set.
- [ ] Response/read timeout set.
- [ ] Write timeout set if supported.
- [ ] Call/operation timeout set.
- [ ] Retry total budget bounded.
- [ ] Timeout values differ per operation if needed.
- [ ] Timeout aligned with upstream SLA.

### 24.3 Pool and Concurrency

- [ ] Client reused/singleton.
- [ ] Pool max configured.
- [ ] Per-host/per-route max configured if supported.
- [ ] Max in-flight configured.
- [ ] Queue size bounded.
- [ ] Idle timeout aligned with LB.
- [ ] Client shutdown lifecycle defined.

### 24.4 Auth and Secret

- [ ] Secret not in Git.
- [ ] Secret source explicit.
- [ ] Secret access permission scoped.
- [ ] Secret redacted from logs.
- [ ] Rotation plan exists.
- [ ] Token cache expiry skew configured.
- [ ] Token refresh single-flight implemented.

### 24.5 TLS

- [ ] TLS verification enabled.
- [ ] Hostname verification enabled.
- [ ] Truststore configured if needed.
- [ ] Keystore configured for mTLS if needed.
- [ ] Certificate rotation plan exists.
- [ ] No trust-all in production.

### 24.6 Retry and Resilience

- [ ] Retry enabled only where safe.
- [ ] Retry status/exception list explicit.
- [ ] POST retry requires idempotency key.
- [ ] Backoff and jitter configured.
- [ ] Rate limit configured for quota-bound APIs.
- [ ] Bulkhead configured.
- [ ] Circuit breaker configured where useful.
- [ ] Fallback explicit and domain-safe.

### 24.7 Observability

- [ ] Client name included in metric/log/span.
- [ ] Effective config logged safely at startup.
- [ ] Runtime config changes logged.
- [ ] Sensitive headers redacted.
- [ ] Body logging disabled/redacted in production.
- [ ] Retry/circuit/failover metrics visible.
- [ ] Config version visible.

### 24.8 Validation

- [ ] Config validated at startup.
- [ ] Unknown/unused keys detected if possible.
- [ ] Environment-specific invariant enforced.
- [ ] Invalid config fails startup.
- [ ] Config diff reviewed before release.

---

## 25. Design Review Questions

Saat review HTTP client config, tanyakan:

1. Apakah endpoint bisa berubah tanpa code change?
2. Apakah endpoint boleh berasal dari user input?
3. Apa default jika config missing?
4. Apakah timeout disesuaikan dengan operation?
5. Apakah retry total duration bounded?
6. Apakah retry command operation aman?
7. Apakah config effective terlihat saat startup?
8. Apakah secret pernah muncul di log?
9. Apakah TLS verification bisa accidentally disabled?
10. Apakah feature flag changes diaudit?
11. Apakah runtime override punya TTL?
12. Apakah tenant A bisa memakai credential tenant B?
13. Apakah failover bisa menghasilkan duplicate side effect?
14. Apakah config bisa divalidasi di CI?
15. Apakah config UAT cukup mirip dengan PROD?
16. Apakah config changes punya rollback plan?
17. Apakah observability tetap konsisten setelah endpoint migration?
18. Apakah client perlu rebuild saat config berubah?
19. Apakah old client/pool ditutup saat swap?
20. Apakah config mendukung incident mitigation tanpa redeploy?

---

## 26. Mini Case Study: Third-Party Address API

### 26.1 Requirement

Aplikasi perlu memanggil external address lookup API.

Constraints:

```text
quota: 300 requests/minute
OAuth2 token expires every 1 hour
vendor sometimes returns 429
postal code lookup can be cached
production must not expose token to browser
endpoint migration scheduled next month
```

### 26.2 Config

```yaml
clients:
  address-api:
    base-url: https://api.address.example.com
    timeout:
      connect: 500ms
      response: 2s
      call: 3s
    auth:
      type: oauth2-client-credentials
      token-url: https://auth.address.example.com/oauth/token
      client-id: address-client
      client-secret-ref: /prod/address/client-secret
      token-expiry-skew: 60s
    rate-limit:
      permits-per-minute: 250
    retry:
      enabled: true
      max-attempts: 2
      retryable-statuses: [429, 502, 503, 504]
      respect-retry-after: true
      backoff-initial: 250ms
      backoff-max: 1s
      jitter: full
    cache:
      enabled: true
      key: exact-postal-code
      ttl: 7d
    routing:
      mode: old-only
      old-base-url: https://api.address.example.com/v1
      new-base-url: https://api.address.example.com/v2
      canary-percent: 0
    observability:
      trace-enabled: true
      log-body: false
      redact-headers: [Authorization]
```

### 26.3 Why This Is Good

- Token controlled server-side.
- Rate limit below vendor quota.
- Retry respects `429` and `Retry-After`.
- Cache reduces repeated external calls.
- Endpoint migration modeled explicitly.
- Timeout budget bounded.
- Body logging disabled.
- Config can be validated at startup.

---

## 27. Minimal Reference Implementation Sketch

### 27.1 Config Records

```java
public record ClientConfig(
        String name,
        URI baseUrl,
        TimeoutConfig timeout,
        RetryConfig retry,
        RateLimitConfig rateLimit,
        AuthConfig auth,
        TlsConfig tls,
        ObservabilityConfig observability
) {
    public void validate(EnvironmentKind environment) {
        ConfigValidators.validateBaseUrl(baseUrl, environment);
        ConfigValidators.validateTimeout(timeout);
        ConfigValidators.validateRetry(retry);
        ConfigValidators.validateAuth(auth);
        ConfigValidators.validateTls(tls, environment);
    }
}

public record TimeoutConfig(
        Duration connect,
        Duration response,
        Duration write,
        Duration call
) {
}

public record RetryConfig(
        boolean enabled,
        int maxAttempts,
        Set<Integer> retryableStatuses,
        boolean respectRetryAfter,
        Duration initialBackoff,
        Duration maxBackoff,
        boolean requiresIdempotencyKeyForPost
) {
}
```

### 27.2 Effective Config Endpoint

For internal admin only:

```java
public final class ClientConfigView {
    public static Map<String, Object> safeView(ClientConfig config) {
        return Map.of(
                "name", config.name(),
                "baseUrl", config.baseUrl().toString(),
                "timeout", Map.of(
                        "connect", config.timeout().connect().toString(),
                        "response", config.timeout().response().toString(),
                        "call", config.timeout().call().toString()
                ),
                "retry", Map.of(
                        "enabled", config.retry().enabled(),
                        "maxAttempts", config.retry().maxAttempts(),
                        "retryableStatuses", config.retry().retryableStatuses()
                ),
                "auth", Map.of(
                        "type", config.auth().type(),
                        "secret", "<redacted>"
                )
        );
    }
}
```

### 27.3 CI Config Test

```java
class ClientConfigTest {

    @Test
    void productionConfigShouldBeValid() {
        ClientConfig config = loadConfig("application-prod.yml", "payment");
        assertDoesNotThrow(() -> config.validate(EnvironmentKind.PRODUCTION));
    }

    @Test
    void productionBaseUrlShouldUseHttps() {
        ClientConfig config = loadConfig("application-prod.yml", "payment");
        assertEquals("https", config.baseUrl().getScheme());
    }

    @Test
    void postRetryShouldRequireIdempotencyKey() {
        ClientConfig config = loadConfig("application-prod.yml", "payment");
        if (config.retry().enabled()) {
            assertTrue(config.retry().requiresIdempotencyKeyForPost());
        }
    }
}
```

---

## 28. Key Takeaways

1. **HTTP client configuration is production control plane.**
   Ia menentukan destination, identity, timeout, retry, concurrency, failover, dan observability.

2. **Config harus typed, validated, dan observable.**
   Raw string config tanpa invariant adalah incident waiting to happen.

3. **Config scope harus jelas.**
   Bedakan global default, per-client, per-operation, per-tenant, dan runtime override.

4. **Secrets bukan config biasa.**
   Secret butuh source, permission, rotation, redaction, dan audit boundary.

5. **Feature flags harus dipakai dengan discipline.**
   Berguna untuk migration/canary/incident mitigation, tetapi bisa membuat behavior sulit diaudit jika tidak dikontrol.

6. **Dynamic reload butuh atomic snapshot.**
   Jangan update config sebagian-sebagian.

7. **Transport config mungkin perlu rebuild client.**
   Karena banyak HTTP client immutable atau punya connection pool state.

8. **Effective config harus terlihat saat incident.**
   Tanpa safe config report, diagnosis berubah menjadi tebak-tebakan.

9. **Production-ready config punya checklist.**
   Endpoint, timeout, pool, auth, TLS, retry, rate limit, observability, validation, dan rollback harus ada.

10. **Top 1% engineer mendesain config sebagai governable runtime system.**
    Bukan sekadar `application.yml` yang kebetulan dibaca oleh kode.

---

## 29. Referensi Resmi dan Lanjutan

- Oracle Java SE 25 — `HttpClient.Builder`: konfigurasi `connectTimeout`, `sslContext`, proxy, authenticator, redirect, dan versi protokol.
- Spring Boot Reference — Externalized Configuration: file properties/YAML, environment variables, command-line arguments, dan sumber konfigurasi lain.
- AWS Systems Manager Parameter Store — hierarchical storage untuk configuration data dan lightweight secrets.
- AWS Secrets Manager — secret management dan integration dengan Parameter Store.
- OpenFeature — vendor-agnostic API/specification untuk feature flagging.
- OWASP SSRF Prevention Cheat Sheet — destination validation, allowlist, dan DNS rebinding concern.
- OWASP REST Security Cheat Sheet — token/API key leakage, URL safety, dan transport security.

---

## 30. Posisi Kita dalam Series

Sudah selesai:

```text
Part 0  — Orientation: HTTP Client sebagai Production Subsystem, Bukan Utility
Part 1  — Java HTTP Client Landscape di Java 8–25
Part 2  — Request Lifecycle Deep Dive: Dari Method Call Sampai Response Body
Part 3  — URI, URL, Encoding, Query Parameter, dan Canonical Request
Part 4  — Headers, Content Negotiation, Compression, dan Metadata Contract
Part 5  — Body Handling: JSON, Form, Multipart, Streaming, File Upload/Download
Part 6  — Timeout Engineering: Connect, Read, Write, Call, Pool, DNS, TLS
Part 7  — Connection Pooling, Keep-Alive, HTTP/2 Multiplexing, dan Resource Reuse
Part 8  — DNS, Proxy, Load Balancer, NAT, dan Network Topology Awareness
Part 9  — TLS, mTLS, Trust Store, Key Store, ALPN, Certificate Pinning
Part 10 — Authentication Client-Side: Basic, Bearer, OAuth2, API Key, HMAC, Token Refresh
Part 11 — Retry Engineering: Idempotency, Backoff, Jitter, Retry Budget, dan Hedging
Part 12 — Rate Limiting, Throttling, Bulkhead, dan Client-Side Load Shedding
Part 13 — Circuit Breaker, Timeout, Retry, dan Fallback Composition
Part 14 — JDK HttpClient Deep Dive
Part 15 — OkHttp Deep Dive: Client, Dispatcher, Interceptor, ConnectionPool
Part 16 — Retrofit Deep Dive: Type-Safe API Client di Atas OkHttp
Part 17 — Apache HttpClient 5 Deep Dive
Part 18 — Spring HTTP Client Layer: RestTemplate, WebClient, RestClient
Part 19 — API Client Architecture: Port, Adapter, Gateway, SDK, Anti-Corruption Layer
Part 20 — Error Modelling: Status Code, Transport Failure, Protocol Failure, Domain Failure
Part 21 — Observability: Logging, Metrics, Tracing, Correlation, Redaction
Part 22 — Testing HTTP Clients: Unit, Contract, Integration, Chaos, Mock Server
Part 23 — JSON/XML Mapping for HTTP Client Boundary
Part 24 — Performance Engineering: Throughput, Latency, Allocation, GC, Threading
Part 25 — Virtual Threads, CompletableFuture, Reactive, dan Structured Concurrency
Part 26 — Security Hardening for HTTP Clients
Part 27 — Generated Clients: OpenAPI, Codegen, SDK Governance
Part 28 — Client Configuration Management: Environment, Tenant, Endpoint, Secret, Feature Flag
```

Berikutnya:

```text
Part 29 — Production Failure Playbook: Diagnosis and Incident Response
File: 29-production-failure-playbook-diagnosis-incident-response.md
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 27 — Generated Clients: OpenAPI, Codegen, SDK Governance](./27-generated-clients-openapi-codegen-sdk-governance.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 29 — Production Failure Playbook: Diagnosis and Incident Response](./29-production-failure-playbook-diagnosis-incident-response.md)
