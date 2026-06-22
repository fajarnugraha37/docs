# Part 19 — API Client Architecture: Port, Adapter, Gateway, SDK, Anti-Corruption Layer

> Series: `learn-java-http-client-okhttp-retrofit-client-engineering`  
> File: `19-api-client-architecture-port-adapter-gateway-sdk-acl.md`  
> Scope: Java 8–25, HTTP client architecture, external integration boundary, enterprise service design

---

## 0. Tujuan Part Ini

Pada part sebelumnya kita sudah membahas pilihan dan perilaku HTTP client layer:

- JDK `java.net.http.HttpClient`
- OkHttp
- Retrofit
- Apache HttpClient 5
- Spring `RestTemplate`, `RestClient`, `WebClient`, HTTP Interface Client

Part ini naik ke level desain arsitektur.

Masalah yang ingin diselesaikan bukan lagi:

```text
Bagaimana cara melakukan HTTP GET/POST?
```

Tetapi:

```text
Bagaimana mendesain boundary HTTP client agar domain aplikasi tetap bersih,
resilient, testable, observable, secure, versionable, dan mudah dioperasikan?
```

Dalam sistem production, bug HTTP client sering bukan karena `client.send()` salah, tetapi karena HTTP call diletakkan di tempat yang salah secara arsitektur.

Contoh buruk:

```java
public CaseDetails getCase(String caseId) {
    String url = externalBaseUrl + "/cases/" + caseId;
    ResponseEntity<String> response = restTemplate.getForEntity(url, String.class);
    return objectMapper.readValue(response.getBody(), CaseDetails.class);
}
```

Kode di atas tampak sederhana, tetapi banyak boundary tercampur:

- URI construction
- transport execution
- JSON parsing
- external DTO
- error handling
- retry decision
- timeout policy
- authentication
- observability
- domain mapping
- semantic fallback
- auditability

Top-tier engineer tidak hanya menulis HTTP client yang berhasil call API. Ia mendesain **external integration boundary** yang bisa bertahan terhadap perubahan kontrak, kegagalan jaringan, latency spike, versi API baru, partial failure, credential rotation, dan kebutuhan audit.

---

## 1. Mental Model: HTTP Client sebagai Boundary Antara Dua Dunia

Sebuah HTTP client menghubungkan dua bounded context:

```text
Internal Domain Model
        ↓
Application Use Case
        ↓
Outbound Port
        ↓
HTTP Client Adapter / Gateway
        ↓
External API Contract
        ↓
External System
```

Dua dunia tersebut punya model berbeda.

Internal system memiliki:

- domain language sendiri
- invariant sendiri
- transaction boundary sendiri
- error model sendiri
- security model sendiri
- observability convention sendiri
- release cadence sendiri

External system memiliki:

- endpoint sendiri
- DTO sendiri
- enum sendiri
- pagination sendiri
- rate limit sendiri
- status code sendiri
- error body sendiri
- authentication scheme sendiri
- versioning scheme sendiri
- operational behavior sendiri

HTTP client boundary bertugas menerjemahkan kedua dunia itu tanpa membuat domain layer terkontaminasi detail eksternal.

Mental model sehat:

```text
Domain tidak tahu HTTP.
Application tidak tahu header.
Use case tidak tahu JSON eksternal.
Business rule tidak tahu Retrofit annotation.
Controller tidak tahu access token downstream.
Repository tidak diam-diam call third-party API.
```

HTTP boleh dipakai sebagai mekanisme komunikasi, tetapi tidak boleh menjadi model mental domain.

---

## 2. Masalah Jika HTTP Call Disebar di Mana-mana

Anti-pattern yang sangat umum:

```text
Controller A call external API langsung.
Service B call external API langsung.
Scheduler C call external API langsung.
Listener D call external API langsung.
Validator E call external API langsung.
```

Akibatnya:

```text
1. Timeout tidak konsisten.
2. Retry policy berbeda-beda.
3. Auth token refresh duplicate.
4. Error translation berbeda di setiap tempat.
5. External DTO bocor ke domain.
6. Test menjadi rapuh.
7. Observability tidak seragam.
8. Rate limit sulit dikontrol.
9. Version migration menyakitkan.
10. Incident diagnosis sulit.
```

Contoh gejala:

```java
// Di service A
if (status == 404) return Optional.empty();

// Di service B
if (status == 404) throw new RuntimeException("Not found");

// Di service C
if (status == 404) retry();
```

Masalahnya bukan HTTP 404. Masalahnya adalah **tidak ada centralized semantic interpretation**.

---

## 3. Layering Ideal untuk API Client

Struktur yang lebih sehat:

```text
Domain Model
    ↑
Application Service / Use Case
    ↑
Outbound Port Interface
    ↑
External API Gateway / Adapter
    ↑
Low-Level HTTP Client
    ↑
Transport Engine
```

Contoh package:

```text
com.example.caseapp
├── domain
│   ├── Case.java
│   ├── Agent.java
│   └── CaseStatus.java
│
├── application
│   ├── VerifyAgentUseCase.java
│   └── ports
│       └── AgentVerificationPort.java
│
├── infrastructure
│   └── external
│       └── regulator
│           ├── RegulatorAgentVerificationAdapter.java
│           ├── RegulatorApiClient.java
│           ├── RegulatorHttpClientConfig.java
│           ├── dto
│           │   ├── RegulatorAgentResponse.java
│           │   └── RegulatorErrorResponse.java
│           ├── mapper
│           │   └── RegulatorAgentMapper.java
│           └── error
│               └── RegulatorErrorClassifier.java
```

Yang penting:

```text
application.port.AgentVerificationPort
```

adalah kontrak internal.

```text
infrastructure.external.regulator.RegulatorApiClient
```

adalah detail eksternal.

Application layer bergantung pada port, bukan pada HTTP client concrete.

---

## 4. Port: Kontrak yang Dibutuhkan Aplikasi

Port adalah interface yang menjelaskan kebutuhan internal aplikasi.

Contoh:

```java
public interface AgentVerificationPort {
    AgentVerificationResult verifyAgent(AgentId agentId);
}
```

Port tidak boleh terlihat seperti external API.

Buruk:

```java
public interface AgentVerificationPort {
    RegulatorAgentResponse getAgentByNric(String nric, String apiKey);
}
```

Kenapa buruk?

- `RegulatorAgentResponse` adalah DTO eksternal.
- `nric` mungkin detail identifier eksternal, bukan domain object.
- `apiKey` adalah infrastructure concern.
- Method name mengikuti endpoint, bukan business capability.

Lebih baik:

```java
public interface AgentVerificationPort {
    AgentVerificationResult verifyAgent(AgentIdentifier identifier);
}
```

Port harus menggunakan bahasa domain:

```text
verify agent
check eligibility
reserve payment reference
submit inspection result
fetch active licence
```

Bukan:

```text
GET /v1/agents/{id}
POST /token
PUT /api/ext/status
```

### 4.1 Port sebagai Stability Boundary

External API bisa berubah:

```text
/v1/agents/{id} → /v2/persons/{id}/licences
```

Tapi application use case seharusnya tetap:

```java
agentVerificationPort.verifyAgent(identifier)
```

Itulah manfaat port.

---

## 5. Adapter: Implementasi Port Menggunakan External API

Adapter menerjemahkan port ke detail eksternal.

```java
public final class RegulatorAgentVerificationAdapter implements AgentVerificationPort {

    private final RegulatorApiClient apiClient;
    private final RegulatorAgentMapper mapper;
    private final RegulatorErrorTranslator errorTranslator;

    public RegulatorAgentVerificationAdapter(
            RegulatorApiClient apiClient,
            RegulatorAgentMapper mapper,
            RegulatorErrorTranslator errorTranslator
    ) {
        this.apiClient = apiClient;
        this.mapper = mapper;
        this.errorTranslator = errorTranslator;
    }

    @Override
    public AgentVerificationResult verifyAgent(AgentIdentifier identifier) {
        try {
            RegulatorAgentResponse response = apiClient.getAgent(identifier.value());
            return mapper.toDomainResult(response);
        } catch (RegulatorApiException ex) {
            throw errorTranslator.toApplicationException(ex);
        }
    }
}
```

Adapter bertanggung jawab atas:

- request mapping
- response mapping
- external error translation
- semantic classification
- logging context
- correlation metadata
- deciding what is domain-relevant

Adapter tidak harus tahu detail socket/TLS. Itu tugas lower-level HTTP client/configuration.

---

## 6. Gateway: Facade untuk External System

Istilah “gateway” sering dipakai untuk class yang merepresentasikan satu external system.

Contoh:

```java
public interface PaymentGateway {
    PaymentReservation reserve(PaymentReservationCommand command);
    PaymentStatus getStatus(PaymentReference reference);
    void cancelReservation(PaymentReference reference);
}
```

Gateway biasanya lebih luas dari satu endpoint.

```text
External Payment API
├── POST /payments/reservations
├── GET  /payments/{reference}
├── POST /payments/{reference}/cancel
└── GET  /payments/{reference}/receipt
```

Dari sisi internal, itu bisa dimodelkan sebagai satu `PaymentGateway`.

Gateway cocok jika:

- satu external system menyediakan banyak endpoint terkait
- ada shared auth, timeout, retry, mapper, dan error model
- domain ingin melihat external system sebagai capability, bukan endpoint collection

---

## 7. SDK: Reusable Client untuk Banyak Aplikasi

Kadang HTTP client perlu digunakan oleh banyak service internal. Maka kita bisa membuat internal SDK.

```text
regulator-api-sdk
├── RegulatorClient
├── RegulatorClientConfig
├── RegulatorException
├── dto
├── auth
├── retry
├── telemetry
└── test-support
```

SDK berguna jika:

- banyak service memanggil API yang sama
- auth/signing kompleks
- error taxonomy perlu konsisten
- observability harus standar
- API contract sering berubah
- ingin menghindari copy-paste HTTP client

Tetapi SDK juga bisa menjadi coupling hazard.

Risiko SDK:

```text
1. Semua service terikat versi SDK.
2. Breaking change SDK menyulitkan banyak tim.
3. SDK membawa dependency berat.
4. SDK terlalu opinionated terhadap domain tertentu.
5. SDK menyembunyikan network behavior yang seharusnya terlihat.
```

Prinsip SDK internal yang baik:

```text
1. SDK expose external API language, bukan domain service tertentu.
2. SDK menyediakan extension point untuk timeout/auth/logging.
3. SDK tidak memaksa global singleton.
4. SDK tidak menelan error menjadi null.
5. SDK punya test-support module.
6. SDK punya semantic versioning.
7. SDK dokumentasikan retry/idempotency behavior secara eksplisit.
```

---

## 8. Anti-Corruption Layer: Melindungi Domain dari Model Eksternal

Anti-Corruption Layer atau ACL mencegah konsep eksternal merusak domain internal.

Contoh external API:

```json
{
  "agent_status": "A",
  "licence_type": "SP",
  "disciplinary_flag": "Y",
  "last_update": "2026-04-01T10:22:10+08:00"
}
```

Jika domain langsung memakai enum eksternal:

```java
enum AgentStatus {
    A, I, S, X
}
```

Domain menjadi bergantung pada kode eksternal yang mungkin tidak bermakna bagi business internal.

Lebih baik:

```java
public enum AgentEligibilityStatus {
    ELIGIBLE,
    NOT_ELIGIBLE,
    SUSPENDED,
    UNKNOWN
}
```

Mapper ACL:

```java
public final class RegulatorAgentMapper {

    public AgentVerificationResult toDomainResult(RegulatorAgentResponse response) {
        AgentEligibilityStatus status = switch (response.agentStatus()) {
            case "A" -> AgentEligibilityStatus.ELIGIBLE;
            case "S" -> AgentEligibilityStatus.SUSPENDED;
            case "I", "X" -> AgentEligibilityStatus.NOT_ELIGIBLE;
            default -> AgentEligibilityStatus.UNKNOWN;
        };

        return new AgentVerificationResult(
                status,
                response.disciplinaryFlag().equals("Y"),
                response.lastUpdate()
        );
    }
}
```

ACL bukan sekadar mapper DTO. ACL adalah semantic firewall.

Ia menjawab:

```text
Apa arti data eksternal ini bagi domain kita?
```

Bukan hanya:

```text
Bagaimana copy field A ke field B?
```

---

## 9. External DTO Tidak Boleh Bocor ke Domain

Aturan praktis:

```text
DTO eksternal hanya hidup di package infrastructure/external/<system>/dto.
```

Buruk:

```java
public class CreateCaseUseCase {
    public void create(RegulatorAgentResponse regulatorResponse) {
        ...
    }
}
```

Baik:

```java
public class CreateCaseUseCase {
    public void create(AgentVerificationResult verificationResult) {
        ...
    }
}
```

Kenapa penting?

Jika DTO eksternal bocor:

- domain ikut berubah saat external API berubah
- test domain butuh fixture eksternal
- error parsing menjadi business concern
- enum eksternal menjadi invariant internal palsu
- refactoring API client menjadi mahal

---

## 10. Error Translation: Dari HTTP Failure ke Application Semantics

External API bisa gagal dalam banyak cara:

```text
DNS failure
connect timeout
TLS handshake failure
connection reset
request timeout
response timeout
HTTP 400
HTTP 401
HTTP 403
HTTP 404
HTTP 409
HTTP 429
HTTP 500
malformed JSON
semantic business error in 200 response
```

Domain tidak perlu tahu semua detail ini.

Domain butuh semantic result:

```text
AGENT_NOT_FOUND
AGENT_NOT_ELIGIBLE
VERIFICATION_TEMPORARILY_UNAVAILABLE
VERIFICATION_REJECTED_BY_PROVIDER
AUTHENTICATION_WITH_PROVIDER_FAILED
PROVIDER_RATE_LIMITED
PROVIDER_CONTRACT_CHANGED
```

Contoh error translator:

```java
public final class RegulatorErrorTranslator {

    public RuntimeException toApplicationException(RegulatorApiException ex) {
        return switch (ex.classification()) {
            case NOT_FOUND -> new AgentNotFoundException(ex.externalReference());
            case RATE_LIMITED -> new AgentVerificationTemporarilyUnavailableException("Provider rate limited", ex);
            case AUTH_FAILED -> new ExternalProviderAuthenticationException("Provider auth failed", ex);
            case CONTRACT_VIOLATION -> new ExternalProviderContractException("Unexpected provider response", ex);
            case TEMPORARY_FAILURE -> new AgentVerificationTemporarilyUnavailableException("Provider temporary failure", ex);
            case PERMANENT_FAILURE -> new ExternalProviderRejectedRequestException("Provider rejected request", ex);
        };
    }
}
```

Top-tier design membedakan:

```text
transport error ≠ protocol error ≠ application error ≠ domain error
```

---

## 11. Result Model: Exception atau Typed Result?

Ada dua pendekatan umum.

### 11.1 Exception-Based Boundary

```java
AgentVerificationResult result = agentVerificationPort.verifyAgent(identifier);
```

Kemungkinan:

```text
return result
throw AgentNotFoundException
throw ProviderUnavailableException
throw ProviderContractException
```

Cocok jika:

- failure adalah exceptional path
- caller ingin flow sederhana
- exception taxonomy jelas
- framework transaction/error handling mendukung

Risiko:

- exception terlalu umum
- retryability hilang
- caller sulit membedakan temporary/permanent
- stacktrace noise

### 11.2 Typed Result Boundary

```java
VerificationOutcome outcome = agentVerificationPort.verifyAgent(identifier);
```

Contoh:

```java
public sealed interface VerificationOutcome permits
        VerificationOutcome.Verified,
        VerificationOutcome.NotFound,
        VerificationOutcome.TemporarilyUnavailable,
        VerificationOutcome.ProviderRejected,
        VerificationOutcome.ContractViolation {

    record Verified(AgentVerificationResult result) implements VerificationOutcome {}
    record NotFound(AgentIdentifier identifier) implements VerificationOutcome {}
    record TemporarilyUnavailable(String reason) implements VerificationOutcome {}
    record ProviderRejected(String reason) implements VerificationOutcome {}
    record ContractViolation(String reason) implements VerificationOutcome {}
}
```

Cocok jika:

- external failure adalah expected business decision input
- caller harus eksplisit menangani semua outcome
- Java 17+ sealed interface tersedia
- ingin menghindari exception-driven flow

Untuk Java 8, bisa memakai class hierarchy biasa atau `Either` style sendiri.

### 11.3 Prinsip Pemilihan

Gunakan exception jika:

```text
failure berarti use case tidak bisa lanjut secara normal
```

Gunakan typed result jika:

```text
failure adalah bagian dari business decision matrix
```

Contoh:

```text
Payment declined       → typed result
Payment provider down  → exception atau typed temporary failure, tergantung use case
Malformed provider JSON → exception contract violation
Agent not found        → typed result jika expected, exception jika seharusnya tidak terjadi
```

---

## 12. Designing an External API Client Stack

Satu API client production-grade biasanya terdiri dari beberapa lapisan:

```text
Domain/Application Port
        ↓
Adapter/Gateway
        ↓
Remote API Facade
        ↓
HTTP Transport Client
        ↓
Policy Layer
        ↓
Serialization Layer
        ↓
Telemetry Layer
```

Contoh konkret:

```text
AgentVerificationPort
    ↓
RegulatorAgentVerificationAdapter
    ↓
RegulatorApiClient
    ↓
OkHttp/JDK/Apache/Spring client
    ↓
Retry/timeout/rate-limit/circuit-breaker
    ↓
Jackson DTO mapper
    ↓
Metrics/log/tracing wrapper
```

Jangan semua tanggung jawab dimasukkan ke satu class `ExternalApiService`.

---

## 13. Low-Level Client vs High-Level Client

Bedakan dua jenis client:

### 13.1 Low-Level HTTP Client

Contoh:

```java
public interface HttpTransport {
    HttpResult execute(HttpRequestSpec request);
}
```

Tanggung jawab:

- execute HTTP request
- apply timeout
- apply auth interceptor
- record telemetry
- return raw-ish HTTP response

### 13.2 High-Level API Client

Contoh:

```java
public interface RegulatorApiClient {
    RegulatorAgentResponse getAgent(String agentId);
    RegulatorSubmissionResponse submitCase(RegulatorCaseSubmission request);
}
```

Tanggung jawab:

- endpoint-specific request construction
- DTO serialization/deserialization
- external error parsing
- external API semantics

### 13.3 Domain Port

Contoh:

```java
public interface AgentVerificationPort {
    AgentVerificationResult verifyAgent(AgentIdentifier identifier);
}
```

Tanggung jawab:

- internal business capability
- stable language for application use case
- no external DTO
- no HTTP detail

Lapisan yang sehat:

```text
Domain Port ≠ API Client ≠ HTTP Transport
```

---

## 14. Package Boundary yang Direkomendasikan

Contoh untuk service Java/Spring:

```text
src/main/java/com/acme/caseapp
├── domain
│   ├── model
│   └── service
│
├── application
│   ├── usecase
│   └── port
│       └── outbound
│           └── LicenceVerificationPort.java
│
├── infrastructure
│   ├── external
│   │   └── licenceprovider
│   │       ├── LicenceProviderAdapter.java
│   │       ├── LicenceProviderClient.java
│   │       ├── LicenceProviderClientConfig.java
│   │       ├── LicenceProviderProperties.java
│   │       ├── LicenceProviderAuthInterceptor.java
│   │       ├── LicenceProviderErrorDecoder.java
│   │       ├── LicenceProviderMapper.java
│   │       ├── dto
│   │       │   ├── LicenceProviderRequest.java
│   │       │   ├── LicenceProviderResponse.java
│   │       │   └── LicenceProviderErrorBody.java
│   │       └── test
│   │           └── LicenceProviderFixtures.java
│   │
│   └── http
│       ├── HttpClientFactory.java
│       ├── HttpTimeoutPolicy.java
│       ├── HttpClientMetrics.java
│       └── HttpClientObservationInterceptor.java
```

Kaidah dependency:

```text
application → port only
infrastructure → implements port
domain → no dependency on infrastructure
controller → use case, not external client directly
```

---

## 15. Configuration as Architecture, Bukan Sekadar Properties

API client harus punya configuration boundary sendiri.

Contoh:

```yaml
external:
  licence-provider:
    base-url: https://api.provider.example
    connect-timeout: 500ms
    response-timeout: 2500ms
    call-timeout: 3000ms
    max-concurrency: 30
    rate-limit-per-second: 20
    retry:
      max-attempts: 2
      backoff: 200ms
      max-backoff: 1s
    circuit-breaker:
      failure-rate-threshold: 50
      slow-call-threshold: 2s
    auth:
      token-endpoint: https://auth.provider.example/oauth/token
      expiry-skew: 60s
```

Kaidah:

```text
1. Setiap downstream punya config sendiri.
2. Jangan pakai global timeout tunggal untuk semua API.
3. Config harus divalidasi saat startup.
4. Secret tidak disimpan dalam config biasa.
5. Default harus safe, bukan convenient.
6. Critical config harus observable.
```

Contoh validation:

```java
public record ExternalClientProperties(
        URI baseUrl,
        Duration connectTimeout,
        Duration responseTimeout,
        Duration callTimeout,
        int maxConcurrency
) {
    public ExternalClientProperties {
        Objects.requireNonNull(baseUrl, "baseUrl");
        requirePositive(connectTimeout, "connectTimeout");
        requirePositive(responseTimeout, "responseTimeout");
        requirePositive(callTimeout, "callTimeout");
        if (callTimeout.compareTo(responseTimeout) < 0) {
            throw new IllegalArgumentException("callTimeout should not be smaller than responseTimeout");
        }
        if (maxConcurrency <= 0) {
            throw new IllegalArgumentException("maxConcurrency must be positive");
        }
    }

    private static void requirePositive(Duration value, String name) {
        if (value == null || value.isZero() || value.isNegative()) {
            throw new IllegalArgumentException(name + " must be positive");
        }
    }
}
```

Untuk Java 8, gunakan final class biasa.

---

## 16. Policy Object Pattern

Daripada hardcode timeout/retry di banyak tempat, buat policy object.

```java
public record ClientPolicy(
        Duration connectTimeout,
        Duration responseTimeout,
        Duration callTimeout,
        RetryPolicy retryPolicy,
        RateLimitPolicy rateLimitPolicy,
        BulkheadPolicy bulkheadPolicy
) {}
```

Untuk Java 8:

```java
public final class ClientPolicy {
    private final Duration connectTimeout;
    private final Duration responseTimeout;
    private final Duration callTimeout;
    private final RetryPolicy retryPolicy;

    public ClientPolicy(
            Duration connectTimeout,
            Duration responseTimeout,
            Duration callTimeout,
            RetryPolicy retryPolicy
    ) {
        this.connectTimeout = Objects.requireNonNull(connectTimeout);
        this.responseTimeout = Objects.requireNonNull(responseTimeout);
        this.callTimeout = Objects.requireNonNull(callTimeout);
        this.retryPolicy = Objects.requireNonNull(retryPolicy);
    }

    public Duration connectTimeout() { return connectTimeout; }
    public Duration responseTimeout() { return responseTimeout; }
    public Duration callTimeout() { return callTimeout; }
    public RetryPolicy retryPolicy() { return retryPolicy; }
}
```

Keuntungan:

- policy eksplisit
- testable
- reviewable
- comparable antar downstream
- bisa diekspor sebagai diagnostic endpoint
- mengurangi magic number

---

## 17. Client Factory Pattern

Client factory membantu membuat client konsisten.

```java
public final class ExternalHttpClientFactory {

    public OkHttpClient createOkHttpClient(ClientPolicy policy, ClientTelemetry telemetry) {
        return new OkHttpClient.Builder()
                .connectTimeout(policy.connectTimeout())
                .readTimeout(policy.responseTimeout())
                .callTimeout(policy.callTimeout())
                .eventListenerFactory(call -> telemetry.newEventListener())
                .build();
    }
}
```

Tapi hati-hati: factory tidak boleh menjadi “God factory”.

Factory boleh mengatur:

- timeout
- connection pool
- TLS
- proxy
- telemetry
- base interceptor standar

Factory tidak seharusnya tahu:

- business endpoint
- domain mapping
- use case rule
- fallback business semantics

---

## 18. One Client per Downstream, Bukan One Client per Request

Anti-pattern:

```java
public Response call() {
    OkHttpClient client = new OkHttpClient();
    return client.newCall(request).execute();
}
```

Masalah:

- connection pool tidak efektif
- thread/resource lifecycle buruk
- TLS handshake berulang
- metric sulit dikaitkan
- config tidak konsisten

Prinsip:

```text
Reuse client instance per downstream/policy.
```

Contoh:

```text
licenceProviderHttpClient
paymentProviderHttpClient
notificationProviderHttpClient
internalUserServiceHttpClient
```

Bukan:

```text
new client for every call
```

Tetapi juga jangan ekstrem memakai satu global client untuk semua downstream jika policy berbeda.

```text
Satu shared transport bisa masuk akal hanya jika timeout, pool, TLS, proxy, dan auth policy memang sama.
```

---

## 19. Versioned Client

External API berubah. Maka client perlu versioning.

Contoh:

```text
LicenceProviderClientV1
LicenceProviderClientV2
```

Atau:

```java
public interface LicenceProviderClient {
    LicenceResponse getLicence(String id);
}

public final class LicenceProviderV1Client implements LicenceProviderClient { ... }
public final class LicenceProviderV2Client implements LicenceProviderClient { ... }
```

Dengan adapter:

```java
public final class LicenceVerificationAdapter implements LicenceVerificationPort {
    private final LicenceProviderClient client;
    private final LicenceProviderMapper mapper;
}
```

Keuntungan:

- migration bisa gradual
- contract test bisa dipisahkan
- rollback mudah
- domain port tetap stabil

### 19.1 Dual-Run Pattern

Untuk migration risiko tinggi:

```text
1. Primary call ke V1.
2. Shadow call ke V2.
3. Compare response secara async.
4. Log difference.
5. Jangan pengaruhi user flow.
6. Setelah confidence cukup, switch primary ke V2.
```

Cocok untuk:

- regulatory data provider
- payment provider
- identity provider
- address/geocoding provider
- API dengan perubahan kontrak besar

---

## 20. Multi-Tenant Client

Beberapa sistem perlu credential/base URL berbeda per tenant/agency/customer.

Jangan buat desain seperti ini:

```java
client.setApiKey(currentTenant.apiKey());
client.call();
```

Mutable shared client sangat berbahaya.

Risiko:

- credential tenant A terkirim ke tenant B
- race condition
- log/audit salah
- security incident

Lebih baik:

```java
public interface TenantAwareLicenceClient {
    LicenceResponse getLicence(TenantContext tenant, LicenceId licenceId);
}
```

Dengan credential resolver:

```java
public final class TenantCredentialResolver {
    public ProviderCredential resolve(TenantId tenantId) {
        // read from vault/secret manager/cache
    }
}
```

Dan request dibuat immutable:

```java
ProviderCredential credential = credentialResolver.resolve(tenant.id());
HttpRequest request = requestFactory.createGetLicenceRequest(tenant, licenceId, credential);
```

Kaidah multi-tenant:

```text
1. Jangan simpan credential tenant di mutable singleton.
2. Jangan cache token tanpa tenant key.
3. Metric harus punya tenant grouping yang aman.
4. Log tenant id boleh jika bukan sensitive; jangan log credential.
5. Rate limit sering harus per tenant + global.
```

---

## 21. Authentication as Client Concern, Not Use Case Concern

Buruk:

```java
public void verify(String id) {
    String token = tokenService.getToken();
    externalClient.getAgent(id, token);
}
```

Use case tidak perlu tahu token.

Lebih baik:

```java
public void verify(String id) {
    agentVerificationPort.verifyAgent(new AgentIdentifier(id));
}
```

Auth dilakukan di infrastructure:

```text
Adapter/Gateway
    ↓
API client
    ↓
Auth interceptor/token provider
    ↓
HTTP transport
```

Namun auth error harus diterjemahkan:

```text
401 from provider token endpoint
→ ExternalProviderAuthenticationException
→ operational alert, not user validation error
```

---

## 22. Pagination as Abstraction

External API sering memakai pagination.

Jangan bocorkan pagination eksternal ke domain jika domain hanya butuh stream/list semantic.

Buruk:

```java
Page1Response page1 = providerClient.search(query, 1, 100);
Page2Response page2 = providerClient.search(query, 2, 100);
```

Lebih baik:

```java
public interface LicenceSearchPort {
    Stream<LicenceSummary> searchActiveLicences(LicenceSearchCriteria criteria);
}
```

Atau iterator:

```java
public interface ExternalPagedResult<T> extends AutoCloseable {
    boolean hasNextPage();
    List<T> nextPage();
}
```

Untuk batch workload:

```java
public final class LicenceProviderPager {
    public void forEachLicence(LicenceSearchCriteria criteria, Consumer<LicenceSummary> consumer) {
        String cursor = null;
        do {
            LicencePage page = client.search(criteria, cursor);
            page.items().forEach(consumer);
            cursor = page.nextCursor();
        } while (cursor != null);
    }
}
```

Pertanyaan desain:

```text
1. Apakah caller perlu tahu page size?
2. Apakah caller perlu cursor?
3. Apakah partial result boleh?
4. Apa yang terjadi jika page 7 gagal?
5. Apakah pagination call boleh retry?
6. Apakah order stable?
7. Apakah result berubah saat sedang dipaginasi?
```

---

## 23. Long-Running Operation Client

Beberapa API tidak menyelesaikan operasi langsung.

Pattern:

```text
POST /jobs
→ 202 Accepted + jobId
GET /jobs/{jobId}
→ PENDING/RUNNING/DONE/FAILED
```

Jangan sembunyikan semua ini sebagai blocking call tanpa kontrol.

Buruk:

```java
SubmitResult result = client.submitAndWait(request); // bisa blocking 10 menit
```

Lebih sehat:

```java
OperationHandle handle = client.submit(request);
OperationStatus status = client.getStatus(handle);
```

Atau domain-level:

```java
SubmissionReceipt receipt = submissionPort.submit(command);
```

Lalu orchestration dilakukan oleh scheduler/workflow engine.

Pertanyaan penting:

```text
1. Apakah polling interval fixed atau adaptive?
2. Apakah status endpoint rate limited?
3. Apakah job id idempotent?
4. Apakah submit bisa duplicate?
5. Apakah timeout operation sama dengan timeout HTTP request?
6. Bagaimana resume setelah service restart?
7. Bagaimana audit trail per polling?
```

---

## 24. Idempotent Command Client

Untuk external command API:

```text
POST /payments
POST /submissions
POST /cases
POST /notifications
```

Pertanyaan utama:

```text
Jika client timeout setelah mengirim request, apakah command berhasil di server?
```

Arsitektur client harus mendukung idempotency.

Contoh command:

```java
public record SubmitCaseCommand(
        CaseId caseId,
        ApplicantId applicantId,
        List<DocumentReference> documents,
        IdempotencyKey idempotencyKey
) {}
```

Adapter mengirim:

```text
Idempotency-Key: <key>
```

Atau field body sesuai kontrak provider.

Client boundary harus menyimpan hubungan:

```text
internal command id → external request id/idempotency key → external response/reference
```

Tanpa ini, retry command bisa menciptakan duplicate side effect.

---

## 25. External Reference Mapping

Banyak integrasi butuh menyimpan external reference.

Contoh:

```text
internalCaseId = CASE-123
externalSubmissionId = SUB-99881
externalCorrelationId = abc-xyz
```

Jangan hanya log external reference. Simpan sebagai data operasional jika diperlukan untuk reconciliation.

Model:

```java
public record ExternalSubmissionReference(
        CaseId caseId,
        String providerName,
        String providerSubmissionId,
        String idempotencyKey,
        Instant submittedAt
) {}
```

Manfaat:

- retry safe
- reconciliation possible
- support manual operation
- audit trail clear
- duplicate detection

---

## 26. Observability Boundary

API client harus punya observability konsisten.

Metric minimal per downstream:

```text
external.client.requests.total
external.client.duration
external.client.errors.total
external.client.timeout.total
external.client.retries.total
external.client.rate_limited.total
external.client.circuit_breaker.state
external.client.inflight
external.client.pool.active
external.client.pool.idle
```

Tag yang aman:

```text
client_name
operation
method
status_class
outcome
retry_attempt
```

Tag yang berbahaya:

```text
full_url
user_id
case_id
nric
access_token
raw_error_message with PII
```

Trace span naming:

```text
HTTP GET external.licence-provider.get-licence
```

Bukan:

```text
GET https://api.provider.example/licences/ABC123?token=...
```

Log struktur:

```json
{
  "event": "external_api_call_failed",
  "client": "licence-provider",
  "operation": "getLicence",
  "method": "GET",
  "status": 503,
  "classification": "TEMPORARY_FAILURE",
  "retryable": true,
  "durationMs": 1840,
  "correlationId": "...",
  "externalRequestId": "..."
}
```

---

## 27. Auditable API Client

Untuk regulatory/enterprise system, HTTP client sering harus auditable.

Audit bukan debug log.

Debug log menjawab:

```text
Apa yang terjadi secara teknis?
```

Audit menjawab:

```text
Siapa/apa melakukan aksi apa, kapan, terhadap external system mana, dengan outcome apa?
```

Audit event contoh:

```java
public record ExternalApiAuditEvent(
        String clientName,
        String operation,
        String actorType,
        String actorId,
        String businessReference,
        String externalReference,
        String outcome,
        Instant occurredAt
) {}
```

Jangan audit:

- raw access token
- full payload dengan PII tanpa kebutuhan jelas
- full response body dari provider jika mengandung sensitive data
- TLS material

Audit harus didesain bersama data retention policy.

---

## 28. Security Boundary

API client architecture harus menjawab:

```text
1. Dari mana base URL berasal?
2. Apakah URL user-controlled?
3. Apakah redirect diikuti?
4. Apakah redirect boleh membawa Authorization?
5. Apakah host allowlist diterapkan?
6. Apakah proxy dipercaya?
7. Apakah TLS validation normal?
8. Apakah mTLS key aman?
9. Apakah token pernah masuk log?
10. Apakah request body bisa berisi PII?
```

Untuk external client, base URL idealnya immutable dari config tervalidasi.

Buruk:

```java
public String fetch(String urlFromUser) {
    return httpClient.get(urlFromUser);
}
```

Lebih aman:

```java
public LicenceResponse getLicence(LicenceId id) {
    URI uri = baseUrl.resolve("/licences/" + encodePathSegment(id.value()));
    return transport.get(uri);
}
```

Untuk URL yang memang dinamis, pakai allowlist dan validation.

---

## 29. Testing Strategy untuk API Client Architecture

Testing harus mengikuti layer.

### 29.1 Domain/Application Test

Mock port:

```java
AgentVerificationPort port = identifier -> new AgentVerificationResult(...);
```

Tidak perlu HTTP.

### 29.2 Adapter Test

Test mapping dan error translation.

```text
external DTO → domain result
external 404 → AgentNotFound
external 429 → TemporarilyUnavailable
malformed response → ContractViolation
```

### 29.3 HTTP Client Test

Gunakan mock HTTP server:

- OkHttp MockWebServer
- WireMock
- MockServer
- JDK test server

Test:

```text
headers benar
path/query encoding benar
body benar
timeout behavior
retry behavior
error body parsing
correlation id propagation
redaction tidak bocor
```

### 29.4 Contract Test

Validasi terhadap OpenAPI/schema/provider sandbox.

### 29.5 Integration Test

Test end-to-end dengan config test, fake secret, dan mock provider.

---

## 30. Fixture Governance

External API test sering butuh fixture JSON.

Struktur:

```text
src/test/resources/external/licence-provider
├── get-licence-success.json
├── get-licence-not-found.json
├── get-licence-suspended.json
├── error-rate-limited.json
├── error-validation.json
└── malformed-missing-required-field.json
```

Aturan:

```text
1. Fixture harus mewakili real provider contract.
2. Jangan hanya happy path.
3. Include unknown field.
4. Include missing optional field.
5. Include enum baru/tidak dikenal.
6. Include null field jika provider mungkin mengirim null.
7. Include error body.
8. Include large response sample jika relevan.
```

Fixture membantu mendeteksi contract drift.

---

## 31. OpenAPI Generated Client dalam Architecture

Generated client berguna, tetapi jangan biarkan generated DTO masuk ke domain.

Struktur sehat:

```text
application port
    ↓
adapter
    ↓
generated OpenAPI client
    ↓
HTTP transport
```

Anti-pattern:

```java
public void useCase(OpenApiGeneratedPaymentResponse response) {
    ...
}
```

Masalah generated client:

- model terlalu dekat ke schema provider
- error handling default sering miskin
- timeout/retry tidak sesuai standard internal
- generated package bisa berubah besar saat spec berubah
- DTO generated bisa mengandung nullable semantics yang tidak cocok dengan domain

Wrapper tetap dibutuhkan.

---

## 32. Choosing Between Retrofit Interface and Domain Port

Retrofit interface bukan domain port.

Retrofit:

```java
interface RegulatorRetrofitApi {
    @GET("/agents/{id}")
    Call<RegulatorAgentResponse> getAgent(@Path("id") String id);
}
```

Domain port:

```java
interface AgentVerificationPort {
    AgentVerificationResult verifyAgent(AgentIdentifier identifier);
}
```

Retrofit interface adalah external API contract. Domain port adalah internal need.

Jangan inject Retrofit interface langsung ke use case.

Buruk:

```java
public class VerifyAgentUseCase {
    private final RegulatorRetrofitApi api;
}
```

Baik:

```java
public class VerifyAgentUseCase {
    private final AgentVerificationPort verificationPort;
}
```

Adapter boleh memakai Retrofit di dalamnya.

---

## 33. Choosing Between WebClient and Port

Sama seperti Retrofit, `WebClient` bukan domain port.

Buruk:

```java
public class CaseService {
    private final WebClient webClient;
}
```

Lebih sehat:

```java
public class CaseService {
    private final LicenceVerificationPort licenceVerificationPort;
}
```

`WebClient` tinggal di infrastructure.

Reasoning:

```text
WebClient adalah mechanism.
Port adalah capability.
```

---

## 34. API Client Operation Naming

Operation name harus stabil dan semantic.

Contoh:

```text
client_name = licence-provider
operation = verifyLicence
```

Jangan gunakan raw path sebagai operation utama:

```text
operation = GET /v1/licences/{id}
```

Kenapa?

Jika provider migrasi:

```text
GET /v1/licences/{id}
→ POST /v2/licence-verifications/search
```

Business operation tetap:

```text
verifyLicence
```

Metric continuity terjaga.

---

## 35. Inbound vs Outbound Model Jangan Dicampur

Banyak aplikasi membuat kesalahan:

```text
REST controller DTO = external provider DTO = domain command
```

Ini buruk.

Layer sehat:

```text
Inbound REST DTO
    ↓ mapper
Application Command
    ↓ use case
Domain Model
    ↓ outbound port
External Provider DTO
```

Setiap boundary punya model sendiri karena alasan perubahan berbeda:

```text
Inbound DTO berubah karena frontend/API consumer.
Domain berubah karena business rule.
External DTO berubah karena provider.
```

Jika semua digabung, satu perubahan kecil bisa merusak banyak layer.

---

## 36. Client-Side Caching Boundary

Cache untuk HTTP client harus diletakkan dengan jelas.

Jenis cache:

```text
1. HTTP cache berdasarkan Cache-Control/ETag.
2. Application cache berdasarkan domain meaning.
3. Token cache untuk auth.
4. In-flight deduplication cache.
5. Reference data cache.
```

Jangan campur semua menjadi satu `Map`.

Contoh domain cache:

```java
public final class CachedLicenceVerificationPort implements LicenceVerificationPort {
    private final LicenceVerificationPort delegate;
    private final Cache<LicenceId, LicenceVerificationResult> cache;

    @Override
    public LicenceVerificationResult verify(LicenceId id) {
        return cache.get(id, delegate::verify);
    }
}
```

Pertanyaan penting:

```text
1. Apakah data boleh stale?
2. Berapa TTL berdasarkan business risk?
3. Apakah negative result boleh di-cache?
4. Apakah cache harus per tenant?
5. Apakah cache harus invalidated oleh event?
6. Apakah cache hit/miss observable?
```

---

## 37. Feature Flag dan Endpoint Migration

External API migration sering membutuhkan switch.

Pattern:

```java
public final class SwitchingLicenceVerificationPort implements LicenceVerificationPort {
    private final LicenceVerificationPort v1;
    private final LicenceVerificationPort v2;
    private final FeatureFlag flags;

    @Override
    public LicenceVerificationResult verify(LicenceId id) {
        if (flags.isEnabled("licence-provider-v2")) {
            return v2.verify(id);
        }
        return v1.verify(id);
    }
}
```

Lebih advanced:

```text
1. Route by tenant.
2. Route by percentage.
3. Route by operation.
4. Shadow v2 while primary v1.
5. Fail back to v1 only for safe read operations.
```

Caution:

```text
Fallback dari v2 ke v1 untuk write command bisa membuat duplicate side effect jika tidak idempotent.
```

---

## 38. Threading and Concurrency Boundary

Use case tidak boleh mengatur low-level concurrency HTTP secara sembarangan.

Buruk:

```java
ids.parallelStream()
   .map(id -> externalClient.call(id))
   .toList();
```

Masalah:

- concurrency tidak bounded jelas
- common ForkJoinPool terpakai
- rate limit bisa dilanggar
- observability buruk
- retry storm mudah terjadi

Lebih sehat:

```java
public interface BatchLicenceVerificationPort {
    List<LicenceVerificationResult> verifyAll(List<LicenceId> ids, BatchVerificationPolicy policy);
}
```

Infrastructure mengontrol:

- max concurrency
- queue size
- timeout budget
- partial failure policy
- rate limit
- cancellation

Untuk Java 21+ virtual threads, tetap butuh concurrency limit. Virtual threads mengurangi biaya blocking, bukan menghapus kapasitas downstream.

---

## 39. Policy Composition at Architecture Boundary

Policy tidak boleh tersebar random.

Pertanyaan:

```text
Di mana retry diterapkan?
Di mana circuit breaker diterapkan?
Di mana fallback diterapkan?
Di mana rate limit diterapkan?
Di mana auth refresh diterapkan?
```

Rekomendasi umum:

```text
Auth interceptor/token refresh:
    dekat HTTP transport/API client.

Retry transport-level:
    dekat HTTP/API client, berdasarkan classification.

Retry business command:
    di application workflow, dengan idempotency.

Circuit breaker:
    per downstream operation, biasanya di gateway/adapter boundary.

Fallback:
    dekat application semantics, bukan di transport mentah.

Rate limit/bulkhead:
    per downstream client/gateway.
```

Contoh:

```text
UseCase
  → Fallback decision if verification unavailable
  → Port
  → Adapter
  → CircuitBreaker(operation=verifyAgent)
  → Retry(retryable temporary provider failure)
  → RateLimiter(client=regulator)
  → HTTP client with timeout/auth/telemetry
```

---

## 40. External Client Interface Granularity

Terlalu coarse:

```java
interface ExternalSystemClient {
    Object call(String operation, Object payload);
}
```

Terlalu fine:

```java
interface GetAgentEndpointClient { ... }
interface GetLicenceEndpointClient { ... }
interface PostSubmissionEndpointClient { ... }
```

Granularity baik mengikuti capability/aggregate eksternal:

```java
interface RegulatorAgentClient {
    RegulatorAgentResponse getAgent(String id);
    RegulatorLicenceResponse getLicence(String id);
}

interface RegulatorSubmissionClient {
    RegulatorSubmissionResponse submit(RegulatorSubmissionRequest request);
    RegulatorSubmissionStatusResponse getStatus(String submissionId);
}
```

Domain port tetap lebih semantic:

```java
interface AgentEligibilityPort {
    AgentEligibilityResult checkEligibility(AgentIdentifier id);
}
```

---

## 41. Governance untuk Banyak HTTP Client

Dalam organisasi besar, setiap tim sering membuat client sendiri dengan style berbeda.

Masalah:

```text
1. Timeout default berbeda.
2. Logging ada yang bocor token.
3. Retry tanpa jitter.
4. Metric name tidak konsisten.
5. TLS config custom tidak aman.
6. Error taxonomy tidak standar.
7. Proxy behavior berbeda.
8. Test strategy lemah.
```

Solusi governance:

```text
1. Standard client factory.
2. Standard timeout/retry template.
3. Standard telemetry interceptor.
4. Standard redaction utility.
5. Standard error classification model.
6. Standard design review checklist.
7. Standard mock server test pattern.
8. Internal SDK untuk provider penting.
9. Dependency version policy.
10. Production readiness checklist.
```

Governance bukan berarti semua client identik. Governance berarti semua client memenuhi minimum reliability/security/observability bar.

---

## 42. Example End-to-End Design

Kita desain client untuk external address provider.

### 42.1 Domain Need

Use case butuh:

```text
Given postal code, resolve normalized address.
```

Domain port:

```java
public interface AddressResolutionPort {
    AddressResolutionResult resolvePostalCode(PostalCode postalCode);
}
```

Domain result:

```java
public sealed interface AddressResolutionResult permits
        AddressResolutionResult.Found,
        AddressResolutionResult.NotFound,
        AddressResolutionResult.TemporarilyUnavailable {

    record Found(NormalizedAddress address) implements AddressResolutionResult {}
    record NotFound(PostalCode postalCode) implements AddressResolutionResult {}
    record TemporarilyUnavailable(String reason) implements AddressResolutionResult {}
}
```

Untuk Java 8, ganti sealed interface dengan abstract class atau interface + final implementation classes.

### 42.2 External Client DTO

```java
public record AddressProviderResponse(
        String postalCode,
        String block,
        String streetName,
        String buildingName,
        String latitude,
        String longitude
) {}
```

### 42.3 API Client

```java
public interface AddressProviderApiClient {
    AddressProviderResponse searchByPostalCode(String postalCode);
}
```

### 42.4 Adapter

```java
public final class AddressProviderAdapter implements AddressResolutionPort {

    private final AddressProviderApiClient client;
    private final AddressProviderMapper mapper;
    private final AddressProviderErrorTranslator errorTranslator;

    public AddressProviderAdapter(
            AddressProviderApiClient client,
            AddressProviderMapper mapper,
            AddressProviderErrorTranslator errorTranslator
    ) {
        this.client = client;
        this.mapper = mapper;
        this.errorTranslator = errorTranslator;
    }

    @Override
    public AddressResolutionResult resolvePostalCode(PostalCode postalCode) {
        try {
            AddressProviderResponse response = client.searchByPostalCode(postalCode.value());
            return mapper.toResult(postalCode, response);
        } catch (AddressProviderException ex) {
            return errorTranslator.toResult(postalCode, ex);
        }
    }
}
```

### 42.5 Mapper

```java
public final class AddressProviderMapper {
    public AddressResolutionResult toResult(PostalCode postalCode, AddressProviderResponse response) {
        if (response == null) {
            return new AddressResolutionResult.NotFound(postalCode);
        }

        NormalizedAddress address = new NormalizedAddress(
                response.postalCode(),
                response.block(),
                response.streetName(),
                response.buildingName()
        );

        return new AddressResolutionResult.Found(address);
    }
}
```

### 42.6 Error Translator

```java
public final class AddressProviderErrorTranslator {
    public AddressResolutionResult toResult(PostalCode postalCode, AddressProviderException ex) {
        return switch (ex.classification()) {
            case NOT_FOUND -> new AddressResolutionResult.NotFound(postalCode);
            case RATE_LIMITED, TIMEOUT, TEMPORARY_FAILURE ->
                    new AddressResolutionResult.TemporarilyUnavailable(ex.classification().name());
            case CONTRACT_VIOLATION ->
                    throw new ExternalProviderContractException("Address provider contract changed", ex);
            case AUTH_FAILED ->
                    throw new ExternalProviderAuthenticationException("Address provider auth failed", ex);
        };
    }
}
```

### 42.7 Architecture Outcome

Use case hanya melihat:

```java
AddressResolutionResult result = addressResolutionPort.resolvePostalCode(postalCode);
```

Ia tidak tahu:

- endpoint URL
- token
- retry
- 429
- JSON field name
- HTTP client library
- provider status code

Itulah boundary yang sehat.

---

## 43. Code Review Checklist

Gunakan checklist ini saat review HTTP API client.

### 43.1 Boundary

```text
[ ] Apakah use case bergantung pada port, bukan HTTP client concrete?
[ ] Apakah external DTO tidak bocor ke domain/application?
[ ] Apakah endpoint detail tidak bocor ke business logic?
[ ] Apakah adapter/gateway punya tanggung jawab jelas?
```

### 43.2 Error Model

```text
[ ] Apakah transport/protocol/domain failure dibedakan?
[ ] Apakah 4xx/5xx dipetakan dengan benar?
[ ] Apakah 404 semantics jelas?
[ ] Apakah 429 diperlakukan berbeda dari 500?
[ ] Apakah malformed response menjadi contract violation?
```

### 43.3 Resilience

```text
[ ] Apakah timeout per downstream jelas?
[ ] Apakah retry hanya untuk case aman?
[ ] Apakah write command punya idempotency?
[ ] Apakah concurrency/rate limit dibatasi?
[ ] Apakah circuit breaker per downstream operation?
[ ] Apakah fallback tidak menyembunyikan data penting?
```

### 43.4 Security

```text
[ ] Apakah base URL tervalidasi?
[ ] Apakah redirect aman?
[ ] Apakah token tidak bocor ke log?
[ ] Apakah sensitive header diredaсt?
[ ] Apakah TLS validation tidak dimatikan?
[ ] Apakah tenant credential tidak tercampur?
```

### 43.5 Observability

```text
[ ] Apakah client_name dan operation_name konsisten?
[ ] Apakah metric latency/error/retry/timeout tersedia?
[ ] Apakah correlation id dikirim?
[ ] Apakah external request id ditangkap jika ada?
[ ] Apakah high-cardinality tag dihindari?
```

### 43.6 Testing

```text
[ ] Apakah adapter mapping dites?
[ ] Apakah error translation dites?
[ ] Apakah HTTP request shape dites dengan mock server?
[ ] Apakah timeout/retry/rate limit behavior dites?
[ ] Apakah fixture mencakup unknown enum/null/missing field?
[ ] Apakah contract test tersedia untuk provider penting?
```

---

## 44. Common Anti-Patterns

### 44.1 HTTP Call Langsung di Controller

```java
@GetMapping("/cases/{id}")
public CaseDto get(@PathVariable String id) {
    return restTemplate.getForObject(providerUrl + "/cases/" + id, CaseDto.class);
}
```

Masalah:

- controller tahu provider
- error mapping kacau
- test rapuh
- observability domain tidak jelas

### 44.2 External DTO sebagai Domain Model

```java
public class Case {
    private ProviderStatus providerStatus;
}
```

Masalah:

- domain ikut provider vocabulary
- provider enum baru bisa merusak business logic

### 44.3 Catch Exception Return Null

```java
try {
    return client.call();
} catch (Exception e) {
    return null;
}
```

Masalah:

- failure hilang
- caller bingung apakah data tidak ada atau provider gagal
- incident diagnosis sulit

### 44.4 Global HTTP Client untuk Semua Downstream

```java
@Bean
OkHttpClient okHttpClient() { ... }
```

Lalu dipakai semua API dengan policy sama.

Masalah jika downstream berbeda:

- timeout tidak cocok
- pool contention antar provider
- auth interceptor konflik
- metric kurang jelas

### 44.5 Retry di Banyak Layer

```text
OkHttp retry
+ Retrofit wrapper retry
+ Resilience4j retry
+ scheduler retry
+ message queue redelivery
```

Akibat:

```text
1 logical operation bisa menjadi puluhan request.
```

### 44.6 Generated Client Dianggap Architecture

Generated client hanya membantu membuat call. Ia tidak otomatis menyelesaikan:

- domain mapping
- error translation
- retry semantics
- security policy
- audit
- operational playbook

---

## 45. Decision Matrix

| Situasi | Desain yang Disarankan |
|---|---|
| Satu service call satu third-party API sederhana | Port + adapter + small typed client |
| Banyak service call provider yang sama | Internal SDK + adapter per domain |
| API contract besar dan terdokumentasi OpenAPI | Generated client + wrapper + ACL |
| Provider sering berubah | Versioned client + contract test + mapper isolation |
| Write command berisiko duplicate | Idempotency key + external reference store |
| Provider rate limited | Client-side limiter + retry-after handling + queue policy |
| Batch call ribuan item | Worker pool + bounded concurrency + page/partial failure model |
| Regulatory/audit-heavy | Audit event + external reference + deterministic error taxonomy |
| Multi-tenant credential | Tenant-aware credential resolver + immutable request auth |
| Migration v1 ke v2 | Feature flag + dual-run/shadow + comparison telemetry |

---

## 46. Design Template untuk API Client Baru

Saat membuat client baru, isi template ini.

```text
1. Client Identity
   - client_name:
   - external system owner:
   - business capability:

2. Operations
   - operation name:
   - endpoint/method:
   - read/write:
   - idempotent:
   - expected latency:
   - expected traffic:

3. Contract
   - request DTO:
   - response DTO:
   - error body:
   - version:
   - compatibility concern:

4. Authentication
   - scheme:
   - credential source:
   - token cache:
   - refresh behavior:

5. Resilience
   - timeout:
   - retry:
   - rate limit:
   - bulkhead:
   - circuit breaker:
   - fallback:

6. Error Semantics
   - 400:
   - 401/403:
   - 404:
   - 409:
   - 429:
   - 5xx:
   - malformed response:

7. Observability
   - metrics:
   - trace operation name:
   - log fields:
   - redaction:
   - alert threshold:

8. Security
   - base URL validation:
   - redirect policy:
   - TLS/mTLS:
   - secret handling:
   - PII handling:

9. Testing
   - unit tests:
   - mock server tests:
   - contract tests:
   - failure injection:

10. Operations
   - dashboard:
   - runbook:
   - fallback/manual process:
   - owner:
```

---

## 47. What Top 1% Engineers Do Differently

Engineer biasa bertanya:

```text
Bagaimana cara call API ini?
```

Engineer kuat bertanya:

```text
Apa boundary antara domain saya dan provider ini?
Apa semantic error model-nya?
Apa retry yang aman?
Apa timeout budget-nya?
Apa observability yang dibutuhkan saat incident?
Apa yang terjadi saat provider berubah?
Apa yang terjadi saat token refresh race?
Apa yang terjadi saat call berhasil di provider tapi timeout di client?
Apa yang terjadi saat provider mengirim enum baru?
Apa yang terjadi saat rate limit tercapai?
Apa yang terjadi saat satu tenant credential salah?
```

Top-tier engineer melihat HTTP client sebagai bagian dari system design, bukan utility function.

---

## 48. Ringkasan Mental Model

API client architecture yang sehat memiliki struktur:

```text
Use Case
  depends on
Outbound Port
  implemented by
Adapter/Gateway
  uses
External API Client
  uses
HTTP Transport Engine
  configured by
Policy + Security + Telemetry
```

Ingat invariants berikut:

```text
1. Domain tidak tahu HTTP.
2. Domain tidak tahu external DTO.
3. Use case tidak tahu token/header/base URL.
4. Error eksternal harus diterjemahkan.
5. Retry harus berdasarkan semantics.
6. Timeout adalah budget, bukan angka dekoratif.
7. Credential adalah infrastructure concern.
8. Observability harus per client dan per operation.
9. API versioning harus dipersiapkan.
10. Generated client bukan pengganti architecture.
```

Jika satu kalimat:

> HTTP client yang baik bukan yang paling singkat kodenya, tetapi yang paling jelas boundary, failure semantics, resource policy, security posture, dan operational behavior-nya.

---

## 49. Checklist Belajar Setelah Part Ini

Setelah memahami part ini, kamu seharusnya bisa:

```text
[ ] Menjelaskan perbedaan port, adapter, gateway, SDK, dan ACL.
[ ] Mendesain HTTP client tanpa membocorkan DTO eksternal ke domain.
[ ] Membuat error translation dari HTTP failure ke application semantics.
[ ] Menentukan kapan memakai exception vs typed result.
[ ] Mendesain package structure untuk external API client.
[ ] Menentukan boundary timeout/retry/auth/cache/observability.
[ ] Membuat strategy versioning untuk API provider.
[ ] Mendesain multi-tenant API client yang aman.
[ ] Menyiapkan checklist review production API client.
```

---

## 50. Penutup

Part ini adalah transisi penting dari **library mastery** ke **architecture mastery**.

Pada level library, kita bertanya:

```text
Bagaimana memakai JDK HttpClient, OkHttp, Retrofit, Apache, atau Spring client?
```

Pada level architecture, kita bertanya:

```text
Bagaimana memastikan external integration tidak merusak domain,
tidak menyebarkan failure secara liar,
tidak membocorkan credential,
tidak membuat incident sulit didiagnosis,
dan tetap bisa berevolusi saat provider berubah?
```

Inilah perbedaan besar antara HTTP client sebagai utility dan HTTP client sebagai production-grade integration boundary.

---

## Status Series

Selesai:

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
```

Berikutnya:

```text
Part 20 — Error Modelling: Status Code, Transport Failure, Protocol Failure, Domain Failure
File: 20-error-modelling-status-transport-protocol-domain-failure.md
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./18-spring-http-client-layer-resttemplate-webclient-restclient.md">⬅️ Part 18 — Spring HTTP Client Layer: RestTemplate, WebClient, RestClient</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./20-error-modelling-status-transport-protocol-domain-failure.md">Part 20 — Error Modelling: Status Code, Transport Failure, Protocol Failure, Domain Failure ➡️</a>
</div>
