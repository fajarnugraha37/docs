# Part 32 — Case Study: Building a Production-Grade Third-Party API Client

> Series: `learn-java-http-client-okhttp-retrofit-client-engineering`  
> File: `32-case-study-production-grade-third-party-api-client.md`  
> Scope: Java 8–25, JDK HttpClient, OkHttp, Retrofit, resilience policy, observability, testing, and production operation.

---

## 1. Tujuan Part Ini

Pada part sebelumnya kita sudah membahas komponen-komponen individual:

- URI dan encoding.
- Headers.
- Body handling.
- Timeout.
- Connection pooling.
- DNS/proxy/LB/NAT.
- TLS/mTLS.
- Authentication.
- Retry, rate limit, bulkhead, circuit breaker.
- Error modelling.
- Observability.
- Testing.
- Configuration.
- Failure playbook.
- Migration.
- Advanced patterns.

Part ini menyatukan semuanya ke dalam satu studi kasus: **membangun third-party API client production-grade**.

Targetnya bukan hanya membuat kode yang bisa memanggil endpoint eksternal, tetapi membuat client yang:

1. jelas kontraknya;
2. aman terhadap credential leak;
3. punya timeout dan retry yang rasional;
4. tidak membanjiri downstream;
5. bisa didiagnosis saat incident;
6. bisa dites tanpa bergantung pada real external API;
7. bisa dioperasikan oleh tim lain;
8. bisa berevolusi saat third-party API berubah.

Mental model utama:

```text
A production-grade third-party client is not an HTTP call.
It is an integration subsystem with protocol, policy, security,
configuration, observability, testing, and operational ownership.
```

---

## 2. Studi Kasus: Address Verification API

Kita akan gunakan contoh fiktif tetapi realistis:

```text
Provider: Acme Address Verification API
Purpose : memvalidasi postal code dan mengembalikan normalized address
Auth    : OAuth2 client credentials
Limit   : 300 requests/minute per client_id
SLA     : P95 < 800 ms dari provider, best effort
Errors  : JSON error envelope
Payload : JSON
```

Endpoint:

```http
POST /v1/address/verify
Authorization: Bearer <access_token>
Content-Type: application/json
Accept: application/json
Idempotency-Key: <uuid>
X-Correlation-Id: <correlation_id>

{
  "postalCode": "123456",
  "unitNumber": "12-34",
  "country": "SG"
}
```

Response success:

```json
{
  "requestId": "av_123",
  "status": "VERIFIED",
  "confidence": 0.98,
  "normalizedAddress": {
    "line1": "10 Example Road",
    "line2": "#12-34",
    "postalCode": "123456",
    "country": "SG"
  }
}
```

Response domain-level failure:

```json
{
  "requestId": "av_124",
  "status": "NOT_FOUND",
  "reason": "POSTAL_CODE_NOT_FOUND"
}
```

Response error:

```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests",
    "retryAfterSeconds": 20
  }
}
```

---

## 3. Requirement Engineering untuk HTTP Client

Sebelum menulis client, kita harus mengubah kebutuhan menjadi policy.

### 3.1 Functional Requirement

Client harus bisa:

1. memvalidasi alamat;
2. mengambil token OAuth2 client credentials;
3. melakukan refresh token sebelum expired;
4. memetakan response provider ke domain-safe result;
5. membedakan verified, not found, invalid input, provider unavailable, rate limited, dan unknown error.

### 3.2 Non-Functional Requirement

Client harus:

1. membatasi outgoing request maksimal 250/minute agar tidak menyentuh hard limit 300/minute;
2. punya timeout total request 2 detik;
3. retry hanya untuk failure tertentu;
4. tidak retry untuk validation error;
5. punya observability tanpa log token/body sensitif;
6. bisa diuji dengan mock server;
7. bisa dimatikan cepat ketika provider incident;
8. bisa diganti implementation-nya tanpa mengubah domain layer.

### 3.3 Explicit Non-Goal

Client **tidak** bertugas:

- menyimpan address ke database;
- menentukan business decision akhir;
- menampilkan pesan UI;
- menyembunyikan semua error dari application layer;
- mengubah semua error menjadi `null` atau `Optional.empty()`.

Non-goal penting karena third-party client sering menjadi terlalu pintar sampai business logic bocor ke adapter.

---

## 4. Architecture Boundary

Desain high-level:

```text
Application Service
      |
      v
AddressVerificationPort
      |
      v
AcmeAddressVerificationClient
      |
      +-- TokenProvider
      +-- RequestSigner / HeaderFactory
      +-- Transport Adapter
      +-- ResponseMapper
      +-- ErrorClassifier
      +-- Policy Layer
      |     +-- Timeout
      |     +-- Retry
      |     +-- RateLimiter
      |     +-- Bulkhead
      |     +-- CircuitBreaker
      |
      +-- Telemetry Layer
            +-- logs
            +-- metrics
            +-- traces
```

Prinsip:

```text
Domain layer should depend on capability, not HTTP.
```

Jadi domain/application layer hanya melihat:

```java
public interface AddressVerificationPort {
    AddressVerificationResult verify(AddressVerificationCommand command);
}
```

Bukan:

```java
HttpResponse<String> call(String json);
```

Dan bukan:

```java
retrofit2.Response<AcmeVerifyResponse> verify(...);
```

---

## 5. Domain-Safe Contract

### 5.1 Command

```java
public final class AddressVerificationCommand {
    private final String postalCode;
    private final String unitNumber;
    private final String country;
    private final String correlationId;
    private final String idempotencyKey;

    public AddressVerificationCommand(
            String postalCode,
            String unitNumber,
            String country,
            String correlationId,
            String idempotencyKey
    ) {
        this.postalCode = requireNonBlank(postalCode, "postalCode");
        this.unitNumber = unitNumber;
        this.country = requireNonBlank(country, "country");
        this.correlationId = requireNonBlank(correlationId, "correlationId");
        this.idempotencyKey = requireNonBlank(idempotencyKey, "idempotencyKey");
    }

    public String postalCode() { return postalCode; }
    public String unitNumber() { return unitNumber; }
    public String country() { return country; }
    public String correlationId() { return correlationId; }
    public String idempotencyKey() { return idempotencyKey; }

    private static String requireNonBlank(String value, String name) {
        if (value == null || value.trim().isEmpty()) {
            throw new IllegalArgumentException(name + " must not be blank");
        }
        return value;
    }
}
```

Catatan Java 8–25:

- Untuk Java 16+, bisa memakai `record`.
- Untuk Java 8, gunakan final class immutable seperti di atas.
- Jangan membuat command langsung berupa DTO provider.

### 5.2 Result

Jangan hanya return DTO provider. Kita butuh hasil domain-safe.

```java
public abstract class AddressVerificationResult {
    private AddressVerificationResult() {}

    public static final class Verified extends AddressVerificationResult {
        private final String providerRequestId;
        private final NormalizedAddress address;
        private final double confidence;

        public Verified(String providerRequestId, NormalizedAddress address, double confidence) {
            this.providerRequestId = providerRequestId;
            this.address = address;
            this.confidence = confidence;
        }

        public String providerRequestId() { return providerRequestId; }
        public NormalizedAddress address() { return address; }
        public double confidence() { return confidence; }
    }

    public static final class NotFound extends AddressVerificationResult {
        private final String providerRequestId;
        private final String reason;

        public NotFound(String providerRequestId, String reason) {
            this.providerRequestId = providerRequestId;
            this.reason = reason;
        }

        public String providerRequestId() { return providerRequestId; }
        public String reason() { return reason; }
    }

    public static final class InvalidRequest extends AddressVerificationResult {
        private final String reason;

        public InvalidRequest(String reason) {
            this.reason = reason;
        }

        public String reason() { return reason; }
    }

    public static final class TemporarilyUnavailable extends AddressVerificationResult {
        private final String reason;
        private final boolean retryable;

        public TemporarilyUnavailable(String reason, boolean retryable) {
            this.reason = reason;
            this.retryable = retryable;
        }

        public String reason() { return reason; }
        public boolean retryable() { return retryable; }
    }
}
```

Di Java 17+, ini bisa dibuat dengan sealed interface:

```java
public sealed interface AddressVerificationResult
        permits Verified, NotFound, InvalidRequest, TemporarilyUnavailable {
}
```

Tapi untuk kompatibilitas Java 8, final nested classes masih aman.

---

## 6. External DTO Boundary

DTO provider dipisahkan dari domain object.

```java
public final class AcmeVerifyRequest {
    public String postalCode;
    public String unitNumber;
    public String country;

    public AcmeVerifyRequest() {}

    public AcmeVerifyRequest(String postalCode, String unitNumber, String country) {
        this.postalCode = postalCode;
        this.unitNumber = unitNumber;
        this.country = country;
    }
}
```

```java
public final class AcmeVerifyResponse {
    public String requestId;
    public String status;
    public Double confidence;
    public AcmeNormalizedAddress normalizedAddress;
    public String reason;
}
```

```java
public final class AcmeErrorResponse {
    public AcmeError error;

    public static final class AcmeError {
        public String code;
        public String message;
        public Integer retryAfterSeconds;
    }
}
```

Kenapa DTO provider tidak boleh bocor?

Karena provider bisa:

- rename field;
- tambah enum;
- ubah nullability;
- ubah error envelope;
- ubah precision number;
- menambah status baru.

Kalau DTO provider bocor ke domain, perubahan kecil eksternal bisa menjadi perubahan besar internal.

---

## 7. Configuration Model

Config harus eksplisit per client, bukan satu config global untuk semua outbound call.

```java
public final class AcmeClientConfig {
    private final String baseUrl;
    private final String tokenUrl;
    private final String clientId;
    private final String clientSecret;

    private final int connectTimeoutMillis;
    private final int callTimeoutMillis;
    private final int readTimeoutMillis;

    private final int maxRequestsPerMinute;
    private final int maxConcurrentRequests;
    private final int retryMaxAttempts;

    private final boolean enabled;

    // constructor/getters omitted for brevity
}
```

Config minimal yang seharusnya ada:

| Config | Kenapa penting |
|---|---|
| `baseUrl` | destination eksplisit |
| `tokenUrl` | auth endpoint bisa berbeda |
| `connectTimeout` | membatasi fase TCP connect |
| `read/call timeout` | membatasi total waktu tunggu |
| `maxRequestsPerMinute` | melindungi provider dan diri sendiri |
| `maxConcurrentRequests` | melindungi thread/pool/memory |
| `retryMaxAttempts` | mencegah retry storm |
| `enabled` | emergency kill switch |
| `proxy` | enterprise/corporate network |
| `truststore/keystore` | TLS/mTLS |
| `logBodyEnabled` | biasanya false default |

Rule:

```text
If a behavior affects production safety, it should be configurable, validated, and observable.
```

---

## 8. Policy Design

### 8.1 Timeout Policy

Untuk third-party API:

```text
connect timeout : 300 ms
read timeout    : 1500 ms
call timeout    : 2000 ms
```

Kenapa?

- Jika connect saja lama, kemungkinan network path/provider unreachable.
- Read timeout harus cukup untuk provider normal, tapi tidak boleh memblokir worker terlalu lama.
- Call timeout adalah batas operasi total.

Anti-pattern:

```text
connectTimeout = 30s
readTimeout    = 30s
retry           = 3x
```

Ini bisa membuat satu operasi menahan resource lebih dari 90 detik.

### 8.2 Retry Policy

Retry hanya untuk:

- connect reset sebelum request body terkirim;
- `408 Request Timeout`;
- `429 Too Many Requests` dengan `Retry-After` yang masih dalam deadline;
- `500/502/503/504` jika command idempotent;
- selected IO failure yang safe.

Tidak retry untuk:

- `400` invalid request;
- `401` setelah token refresh gagal;
- `403` forbidden;
- `404` domain not found;
- mapping error karena schema tidak kompatibel;
- timeout setelah side effect mungkin terjadi tanpa idempotency key.

### 8.3 Rate Limit Policy

Provider limit: 300/minute.

Client limit yang aman:

```text
250/minute
```

Kenapa tidak 300?

Karena distributed instances, clock skew, retry, dan traffic burst bisa membuat real rate lebih tinggi dari asumsi.

### 8.4 Bulkhead Policy

Misal:

```text
max concurrent requests: 50
queue size             : 100
```

Jika queue penuh:

```text
fail fast with TemporarilyUnavailable("client_overloaded")
```

Jangan biarkan unbounded queue.

### 8.5 Circuit Breaker Policy

Circuit breaker berguna ketika provider sedang buruk.

Contoh:

```text
sliding window          : 100 calls
failure rate threshold  : 50%
slow call threshold     : 1500 ms
slow call rate threshold: 60%
open duration           : 30 seconds
half-open permitted     : 5 calls
```

Peringatan:

- Circuit breaker bukan pengganti timeout.
- Circuit breaker bukan pengganti rate limit.
- Circuit breaker perlu error classification yang benar.

---

## 9. Token Provider dengan Single-Flight Refresh

OAuth2 token refresh sering menjadi sumber incident.

Problem:

```text
100 requests see token expired at same time
→ all call token endpoint
→ token endpoint overloaded
→ verification calls fail
```

Solusi: single-flight refresh.

```java
public interface AccessTokenProvider {
    AccessToken getToken();
}
```

```java
public final class AccessToken {
    private final String value;
    private final long expiresAtEpochMillis;

    public AccessToken(String value, long expiresAtEpochMillis) {
        this.value = value;
        this.expiresAtEpochMillis = expiresAtEpochMillis;
    }

    public String value() {
        return value;
    }

    public boolean isExpiringSoon(long nowMillis, long skewMillis) {
        return nowMillis + skewMillis >= expiresAtEpochMillis;
    }
}
```

Skeleton Java 8-compatible:

```java
public final class SingleFlightAccessTokenProvider implements AccessTokenProvider {
    private final Object lock = new Object();
    private final TokenClient tokenClient;
    private final long refreshSkewMillis;

    private volatile AccessToken cached;

    public SingleFlightAccessTokenProvider(TokenClient tokenClient, long refreshSkewMillis) {
        this.tokenClient = tokenClient;
        this.refreshSkewMillis = refreshSkewMillis;
    }

    @Override
    public AccessToken getToken() {
        long now = System.currentTimeMillis();
        AccessToken current = cached;

        if (current != null && !current.isExpiringSoon(now, refreshSkewMillis)) {
            return current;
        }

        synchronized (lock) {
            now = System.currentTimeMillis();
            current = cached;

            if (current != null && !current.isExpiringSoon(now, refreshSkewMillis)) {
                return current;
            }

            AccessToken refreshed = tokenClient.fetchToken();
            cached = refreshed;
            return refreshed;
        }
    }
}
```

Catatan:

- `volatile` memastikan visibility.
- Lock hanya di refresh path.
- Token endpoint perlu timeout dan retry policy sendiri.
- Token response tidak boleh dilog.

---

## 10. Transport Implementation dengan JDK HttpClient

JDK `HttpClient` cocok jika:

- Java 11+ tersedia;
- ingin dependency minimal;
- butuh HTTP/2 support bawaan;
- tidak perlu fitur OkHttp-specific seperti interceptor ecosystem.

JDK `HttpClient` bersifat reusable dan immutable setelah dibuat; `sendAsync` mengembalikan `CompletableFuture<HttpResponse<T>>`, sehingga cocok untuk async composition.

### 10.1 Client Construction

```java
HttpClient httpClient = HttpClient.newBuilder()
        .connectTimeout(Duration.ofMillis(config.connectTimeoutMillis()))
        .followRedirects(HttpClient.Redirect.NEVER)
        .version(HttpClient.Version.HTTP_2)
        .build();
```

Rule:

```text
Do not create HttpClient per request.
Reuse one configured client per downstream/policy group.
```

### 10.2 Verify Method

```java
public final class AcmeAddressClientJdk implements AddressVerificationPort {
    private final HttpClient httpClient;
    private final URI verifyUri;
    private final ObjectMapper objectMapper;
    private final AccessTokenProvider tokenProvider;
    private final AcmeResponseMapper mapper;
    private final AcmeErrorClassifier errorClassifier;
    private final AcmeClientConfig config;

    public AcmeAddressClientJdk(
            HttpClient httpClient,
            URI verifyUri,
            ObjectMapper objectMapper,
            AccessTokenProvider tokenProvider,
            AcmeResponseMapper mapper,
            AcmeErrorClassifier errorClassifier,
            AcmeClientConfig config
    ) {
        this.httpClient = httpClient;
        this.verifyUri = verifyUri;
        this.objectMapper = objectMapper;
        this.tokenProvider = tokenProvider;
        this.mapper = mapper;
        this.errorClassifier = errorClassifier;
        this.config = config;
    }

    @Override
    public AddressVerificationResult verify(AddressVerificationCommand command) {
        if (!config.enabled()) {
            return new AddressVerificationResult.TemporarilyUnavailable("client_disabled", true);
        }

        try {
            AcmeVerifyRequest requestDto = new AcmeVerifyRequest(
                    command.postalCode(),
                    command.unitNumber(),
                    command.country()
            );

            String body = objectMapper.writeValueAsString(requestDto);
            String token = tokenProvider.getToken().value();

            HttpRequest request = HttpRequest.newBuilder()
                    .uri(verifyUri)
                    .timeout(Duration.ofMillis(config.callTimeoutMillis()))
                    .header("Authorization", "Bearer " + token)
                    .header("Content-Type", "application/json")
                    .header("Accept", "application/json")
                    .header("Idempotency-Key", command.idempotencyKey())
                    .header("X-Correlation-Id", command.correlationId())
                    .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
                    .build();

            HttpResponse<String> response = httpClient.send(
                    request,
                    HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)
            );

            return handleResponse(response);
        } catch (HttpTimeoutException e) {
            return new AddressVerificationResult.TemporarilyUnavailable("timeout", true);
        } catch (IOException e) {
            return new AddressVerificationResult.TemporarilyUnavailable("io_failure", true);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return new AddressVerificationResult.TemporarilyUnavailable("interrupted", true);
        } catch (Exception e) {
            return new AddressVerificationResult.TemporarilyUnavailable("unexpected_client_failure", false);
        }
    }

    private AddressVerificationResult handleResponse(HttpResponse<String> response) throws IOException {
        int status = response.statusCode();
        String body = response.body();

        if (status >= 200 && status < 300) {
            AcmeVerifyResponse dto = objectMapper.readValue(body, AcmeVerifyResponse.class);
            return mapper.toDomain(dto);
        }

        return errorClassifier.classify(status, response.headers(), body);
    }
}
```

Ini belum memasukkan retry/rate limit/circuit breaker agar core transport terlihat. Di production, policy layer sebaiknya membungkus method ini.

---

## 11. Transport Implementation dengan OkHttp

OkHttp cocok jika:

- butuh interceptor chain yang matang;
- butuh `EventListener` untuk lifecycle telemetry;
- butuh connection pool customization;
- butuh certificate pinning;
- ingin integrasi natural dengan Retrofit;
- memakai Java 8 dan belum bisa memakai JDK HttpClient.

OkHttp menekankan reuse client; `newBuilder()` bisa membuat client turunan yang berbagi connection pool/thread pool/config.

### 11.1 Client Construction

```java
OkHttpClient okHttpClient = new OkHttpClient.Builder()
        .connectTimeout(config.connectTimeoutMillis(), TimeUnit.MILLISECONDS)
        .readTimeout(config.readTimeoutMillis(), TimeUnit.MILLISECONDS)
        .writeTimeout(config.readTimeoutMillis(), TimeUnit.MILLISECONDS)
        .callTimeout(config.callTimeoutMillis(), TimeUnit.MILLISECONDS)
        .retryOnConnectionFailure(true)
        .followRedirects(false)
        .addInterceptor(new RedactingTelemetryInterceptor())
        .eventListenerFactory(call -> new AcmeOkHttpEventListener())
        .build();
```

Penting:

```text
retryOnConnectionFailure is transport recovery.
It is not your semantic retry policy.
```

### 11.2 Verify Method

```java
public final class AcmeAddressClientOkHttp implements AddressVerificationPort {
    private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");

    private final OkHttpClient client;
    private final HttpUrl verifyUrl;
    private final ObjectMapper objectMapper;
    private final AccessTokenProvider tokenProvider;
    private final AcmeResponseMapper mapper;
    private final AcmeErrorClassifier errorClassifier;
    private final AcmeClientConfig config;

    @Override
    public AddressVerificationResult verify(AddressVerificationCommand command) {
        if (!config.enabled()) {
            return new AddressVerificationResult.TemporarilyUnavailable("client_disabled", true);
        }

        try {
            AcmeVerifyRequest requestDto = new AcmeVerifyRequest(
                    command.postalCode(),
                    command.unitNumber(),
                    command.country()
            );

            String json = objectMapper.writeValueAsString(requestDto);
            String token = tokenProvider.getToken().value();

            Request request = new Request.Builder()
                    .url(verifyUrl)
                    .header("Authorization", "Bearer " + token)
                    .header("Content-Type", "application/json")
                    .header("Accept", "application/json")
                    .header("Idempotency-Key", command.idempotencyKey())
                    .header("X-Correlation-Id", command.correlationId())
                    .post(RequestBody.create(json, JSON))
                    .build();

            try (Response response = client.newCall(request).execute()) {
                ResponseBody responseBody = response.body();
                String body = responseBody == null ? "" : responseBody.string();
                return handleResponse(response.code(), response.headers(), body);
            }
        } catch (InterruptedIOException e) {
            return new AddressVerificationResult.TemporarilyUnavailable("timeout_or_interrupted_io", true);
        } catch (IOException e) {
            return new AddressVerificationResult.TemporarilyUnavailable("io_failure", true);
        } catch (Exception e) {
            return new AddressVerificationResult.TemporarilyUnavailable("unexpected_client_failure", false);
        }
    }

    private AddressVerificationResult handleResponse(int status, Headers headers, String body) throws IOException {
        if (status >= 200 && status < 300) {
            AcmeVerifyResponse dto = objectMapper.readValue(body, AcmeVerifyResponse.class);
            return mapper.toDomain(dto);
        }

        return errorClassifier.classify(status, headers, body);
    }
}
```

Critical detail:

```text
try-with-resources on Response is not optional.
If response body is not closed, connection reuse can break.
```

---

## 12. Retrofit Implementation

Retrofit cocok jika:

- API endpoint banyak;
- ingin type-safe interface;
- ingin annotation-based request mapping;
- ingin converter/call adapter;
- sudah memakai OkHttp sebagai transport.

Retrofit memakai annotation untuk mendeskripsikan HTTP request pada interface method, termasuk path/query replacement, body conversion, multipart, dan sync/async `Call`.

### 12.1 Retrofit Interface

```java
public interface AcmeAddressRetrofitApi {
    @POST("/v1/address/verify")
    Call<AcmeVerifyResponse> verify(
            @Header("Authorization") String authorization,
            @Header("Idempotency-Key") String idempotencyKey,
            @Header("X-Correlation-Id") String correlationId,
            @Body AcmeVerifyRequest request
    );
}
```

### 12.2 Retrofit Builder

```java
Retrofit retrofit = new Retrofit.Builder()
        .baseUrl(config.baseUrl())
        .client(okHttpClient)
        .addConverterFactory(JacksonConverterFactory.create(objectMapper))
        .build();

AcmeAddressRetrofitApi api = retrofit.create(AcmeAddressRetrofitApi.class);
```

### 12.3 Adapter Wrapper

Jangan expose `Call<AcmeVerifyResponse>` ke application layer.

```java
public final class AcmeAddressClientRetrofit implements AddressVerificationPort {
    private final AcmeAddressRetrofitApi api;
    private final AccessTokenProvider tokenProvider;
    private final AcmeResponseMapper mapper;
    private final AcmeErrorClassifier errorClassifier;
    private final AcmeClientConfig config;

    @Override
    public AddressVerificationResult verify(AddressVerificationCommand command) {
        if (!config.enabled()) {
            return new AddressVerificationResult.TemporarilyUnavailable("client_disabled", true);
        }

        try {
            AcmeVerifyRequest request = new AcmeVerifyRequest(
                    command.postalCode(),
                    command.unitNumber(),
                    command.country()
            );

            String auth = "Bearer " + tokenProvider.getToken().value();

            Response<AcmeVerifyResponse> response = api.verify(
                    auth,
                    command.idempotencyKey(),
                    command.correlationId(),
                    request
            ).execute();

            if (response.isSuccessful()) {
                AcmeVerifyResponse body = response.body();
                if (body == null) {
                    return new AddressVerificationResult.TemporarilyUnavailable("empty_success_body", false);
                }
                return mapper.toDomain(body);
            }

            String errorBody = response.errorBody() == null ? "" : response.errorBody().string();
            return errorClassifier.classify(response.code(), response.headers(), errorBody);
        } catch (IOException e) {
            return new AddressVerificationResult.TemporarilyUnavailable("io_failure", true);
        } catch (Exception e) {
            return new AddressVerificationResult.TemporarilyUnavailable("unexpected_client_failure", false);
        }
    }
}
```

Retrofit bagus untuk mapping request, tetapi wrapper tetap diperlukan untuk:

- error taxonomy;
- retry policy;
- domain-safe result;
- telemetry;
- hiding third-party DTO;
- testing.

---

## 13. Response Mapper

```java
public final class AcmeResponseMapper {
    public AddressVerificationResult toDomain(AcmeVerifyResponse dto) {
        if (dto == null) {
            return new AddressVerificationResult.TemporarilyUnavailable("null_response", false);
        }

        if ("VERIFIED".equals(dto.status)) {
            if (dto.normalizedAddress == null) {
                return new AddressVerificationResult.TemporarilyUnavailable("missing_normalized_address", false);
            }

            NormalizedAddress address = new NormalizedAddress(
                    dto.normalizedAddress.line1,
                    dto.normalizedAddress.line2,
                    dto.normalizedAddress.postalCode,
                    dto.normalizedAddress.country
            );

            double confidence = dto.confidence == null ? 0.0 : dto.confidence;
            return new AddressVerificationResult.Verified(dto.requestId, address, confidence);
        }

        if ("NOT_FOUND".equals(dto.status)) {
            return new AddressVerificationResult.NotFound(dto.requestId, dto.reason);
        }

        return new AddressVerificationResult.TemporarilyUnavailable(
                "unknown_provider_status:" + safeStatus(dto.status),
                false
        );
    }

    private String safeStatus(String status) {
        if (status == null) return "null";
        return status.replaceAll("[^A-Z0-9_:-]", "_");
    }
}
```

Design rule:

```text
Unknown provider enum must not crash the whole service without classification.
```

Tapi juga jangan silently map unknown status to success.

---

## 14. Error Classifier

```java
public final class AcmeErrorClassifier {
    private final ObjectMapper objectMapper;

    public AcmeErrorClassifier(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public AddressVerificationResult classify(int status, Object headers, String body) {
        if (status == 400) {
            return new AddressVerificationResult.InvalidRequest("provider_rejected_request");
        }

        if (status == 401) {
            return new AddressVerificationResult.TemporarilyUnavailable("unauthorized_after_token", true);
        }

        if (status == 403) {
            return new AddressVerificationResult.TemporarilyUnavailable("forbidden", false);
        }

        if (status == 404) {
            return new AddressVerificationResult.NotFound(null, "not_found");
        }

        if (status == 408 || status == 429 || status == 500 || status == 502 || status == 503 || status == 504) {
            String providerCode = tryExtractProviderCode(body);
            return new AddressVerificationResult.TemporarilyUnavailable(
                    "provider_retryable_status:" + status + ":" + providerCode,
                    true
            );
        }

        if (status >= 400 && status < 500) {
            return new AddressVerificationResult.TemporarilyUnavailable("provider_non_retryable_4xx:" + status, false);
        }

        if (status >= 500) {
            return new AddressVerificationResult.TemporarilyUnavailable("provider_5xx:" + status, true);
        }

        return new AddressVerificationResult.TemporarilyUnavailable("unexpected_status:" + status, false);
    }

    private String tryExtractProviderCode(String body) {
        if (body == null || body.isEmpty()) {
            return "empty_error_body";
        }
        try {
            AcmeErrorResponse error = objectMapper.readValue(body, AcmeErrorResponse.class);
            if (error != null && error.error != null && error.error.code != null) {
                return error.error.code;
            }
        } catch (Exception ignored) {
            return "unparseable_error_body";
        }
        return "missing_error_code";
    }
}
```

Error classifier harus menjawab minimal:

| Pertanyaan | Contoh |
|---|---|
| Apakah ini retryable? | 503 yes, 400 no |
| Apakah side effect mungkin terjadi? | timeout after write maybe |
| Apakah aman ditampilkan ke user? | usually no |
| Apakah perlu alert? | 401 spike yes |
| Apakah provider error atau client bug? | 400 often client bug |
| Apakah termasuk security incident? | TLS/auth anomaly maybe |

---

## 15. Policy Composition dengan Resilience4j/Failsafe

Resilience4j menyediakan decorator seperti CircuitBreaker, RateLimiter, Retry, dan Bulkhead yang bisa dikomposisikan untuk functional interface. Failsafe juga menyediakan policy seperti retry, circuit breaker, timeout, bulkhead, dan fallback untuk Java 8+.

Contoh conceptual wrapper:

```java
public final class ResilientAddressVerificationClient implements AddressVerificationPort {
    private final AddressVerificationPort delegate;
    private final RateLimiter rateLimiter;
    private final Bulkhead bulkhead;
    private final CircuitBreaker circuitBreaker;
    private final Retry retry;

    @Override
    public AddressVerificationResult verify(AddressVerificationCommand command) {
        Supplier<AddressVerificationResult> supplier = () -> delegate.verify(command);

        Supplier<AddressVerificationResult> decorated = Decorators.ofSupplier(supplier)
                .withBulkhead(bulkhead)
                .withRateLimiter(rateLimiter)
                .withCircuitBreaker(circuitBreaker)
                .withRetry(retry)
                .decorate();

        try {
            return decorated.get();
        } catch (Exception e) {
            return new AddressVerificationResult.TemporarilyUnavailable("resilience_policy_rejected", true);
        }
    }
}
```

Namun urutan harus dipikirkan.

Salah satu pola yang lebih eksplisit:

```text
bulkhead/rate limit guards outside
→ per-attempt timeout inside transport
→ retry only classified retryable results
→ circuit breaker records operation result
→ fallback only after policy exhaustion
```

Dalam praktik, jangan hanya mengandalkan exception. Banyak client production mengembalikan typed result, jadi retry predicate harus bisa melihat result:

```java
boolean shouldRetry(AddressVerificationResult result) {
    if (result instanceof AddressVerificationResult.TemporarilyUnavailable) {
        return ((AddressVerificationResult.TemporarilyUnavailable) result).retryable();
    }
    return false;
}
```

---

## 16. Idempotency Strategy

Untuk `POST /verify`, mungkin terlihat seperti command, tetapi verifikasi alamat biasanya bisa dibuat idempotent.

Client mengirim:

```http
Idempotency-Key: <uuid-or-stable-hash>
```

Ada dua strategi:

### 16.1 Random Key per User Operation

```text
same user operation → same idempotency key
retry attempt       → same idempotency key
new operation       → new idempotency key
```

Cocok untuk workflow application.

### 16.2 Stable Hash Key

```text
hash(provider + normalized input + tenant + purpose)
```

Cocok untuk dedup/cache-like operation, tapi hati-hati privacy dan collision.

Rule:

```text
Retrying POST without idempotency key is a conscious risk, not a harmless default.
```

---

## 17. Client-Side Cache

Address verification mungkin bisa dicache.

Cache key:

```text
tenant + country + normalizedPostalCode + normalizedUnitNumber
```

Cache value:

```text
Verified/NotFound result + providerRequestId + timestamp
```

TTL:

```text
Verified: 24h
NotFound : 1h
Error    : do not cache, or very short negative cache for specific conditions
```

Peringatan:

- Jangan cache auth error.
- Jangan cache provider outage sebagai not found.
- Jangan cache response yang mengandung PII tanpa policy.
- Jangan lupa invalidation jika address source berubah.

---

## 18. Observability Design

### 18.1 Metrics

Minimal metrics:

```text
http_client_requests_total{client,operation,status_class,outcome}
http_client_request_duration_seconds{client,operation,outcome}
http_client_retries_total{client,operation,reason}
http_client_rate_limited_total{client,operation}
http_client_circuit_state{client}
http_client_token_refresh_total{client,outcome}
http_client_token_refresh_duration_seconds{client,outcome}
http_client_mapping_failures_total{client,operation,reason}
```

Avoid:

```text
label=postalCode
label=fullUrlWithQuery
label=exceptionMessageWithDynamicText
label=providerRequestId
```

High-cardinality label bisa membunuh metrics backend.

### 18.2 Logs

Good log:

```json
{
  "event": "third_party_http_call_completed",
  "client": "acme-address",
  "operation": "verifyAddress",
  "correlationId": "corr-123",
  "providerRequestId": "av_123",
  "statusCode": 200,
  "outcome": "verified",
  "durationMs": 231,
  "retryAttempts": 0
}
```

Bad log:

```json
{
  "authorization": "Bearer eyJhbGci...",
  "requestBody": { "postalCode": "123456", "unitNumber": "12-34" },
  "fullErrorBody": "...possibly sensitive..."
}
```

### 18.3 Tracing

Span name:

```text
HTTP POST acme-address verifyAddress
```

Attributes:

```text
http.request.method=POST
server.address=api.acme.example
url.scheme=https
http.response.status_code=200
peer.service=acme-address-api
client.operation=verifyAddress
```

Do not attach:

```text
Authorization
full request body
PII
raw access token
```

---

## 19. Security Checklist

Third-party client harus punya security guardrails:

| Area | Control |
|---|---|
| Destination | fixed base URL / allowlist |
| Redirect | disabled by default or validated |
| Auth | token in header, not query |
| Secret | loaded from secret manager/env, not code |
| Logging | token/body redacted |
| TLS | hostname verification on |
| mTLS | keystore protected if used |
| SSRF | no arbitrary user URL |
| Header injection | validate dynamic header values |
| Error body | size limit before parsing/logging |
| XML | disable external entity if XML used |
| Dependency | track CVE for client libs |

Critical rule:

```text
Never let user input decide the target host directly.
```

---

## 20. Testing Strategy

### 20.1 Unit Test

Test mapper:

- `VERIFIED` maps to `Verified`.
- `NOT_FOUND` maps to `NotFound`.
- unknown status maps to safe failure.
- missing normalized address maps to non-retryable mapping failure.

Test error classifier:

- 400 → invalid request.
- 401 → auth failure.
- 429 → retryable rate limited.
- 500 → retryable provider failure.
- malformed error body → classified safely.

### 20.2 Mock Server Test

Use MockWebServer/WireMock/MockServer.

Test real HTTP behavior:

1. request path is `/v1/address/verify`;
2. method is POST;
3. headers include `Authorization`, `Content-Type`, `Accept`, `Idempotency-Key`, `X-Correlation-Id`;
4. token value is not logged;
5. body JSON has expected field names;
6. response body is parsed;
7. non-2xx error body is parsed;
8. timeout path works;
9. retry does not duplicate idempotency key;
10. 429 honors `Retry-After` within budget.

### 20.3 Fault Injection Test Matrix

| Scenario | Expected behavior |
|---|---|
| DNS failure | retryable temporary unavailable |
| connect timeout | retryable if within budget |
| TLS handshake failure | non-retryable/security failure unless transient known |
| 400 | invalid request/no retry |
| 401 then token refresh success | one refresh then retry |
| 401 after refresh | auth failure/no loop |
| 429 with small Retry-After | retry if budget allows |
| 429 with huge Retry-After | fail fast/retryable later |
| 500 | retry with backoff |
| malformed JSON success body | mapping failure/no blind retry |
| slow response | timeout/circuit slow-call metric |
| response body huge | reject or stream |

### 20.4 Contract Test

If provider has OpenAPI spec:

- validate generated/request DTO compatibility;
- validate required fields;
- validate enum behavior;
- validate error envelope;
- validate response examples.

If no spec:

- capture golden examples;
- maintain provider contract fixtures;
- alert on breaking field changes.

---

## 21. Production Runbook

### 21.1 Symptoms

| Symptom | Likely cause |
|---|---|
| timeout spike | provider slowness, network path, pool starvation |
| 401 spike | token expired, secret rotated, clock skew |
| 429 spike | rate limit exceeded, retry amplification, new traffic |
| 400 spike | request schema/client bug |
| TLS failure | cert rotation, truststore issue, proxy inspection |
| connection reset | provider/LB closing stale connection |
| pool wait spike | leaked response body, concurrency too high |
| CPU spike | JSON parsing, retry storm, logging body |
| memory spike | buffering large response, unbounded queue |

### 21.2 Immediate Checks

1. Error distribution by status/exception.
2. Latency P50/P95/P99.
3. Retry count and attempt distribution.
4. Rate limiter rejection count.
5. Circuit breaker state.
6. Token refresh success/failure.
7. Pool active/idle/wait if available.
8. Thread dump if blocking calls pile up.
9. Recent config/secret/cert changes.
10. Provider status page or communication channel.

### 21.3 Safe Mitigations

Safer:

- lower concurrency;
- reduce retry attempts;
- temporarily open circuit for non-critical feature;
- enable cached fallback if semantically safe;
- disable affected operation via feature flag;
- rotate credential if confirmed invalid;
- rollback recent client release.

Dangerous:

- blindly increase timeout;
- blindly increase retry;
- disable TLS validation;
- log full request/response body;
- remove rate limit;
- switch endpoint without validation.

---

## 22. Recommended Package Structure

```text
com.example.integration.acme.address
├── AddressVerificationPort.java
├── AddressVerificationCommand.java
├── AddressVerificationResult.java
├── NormalizedAddress.java
│
├── client
│   ├── AcmeAddressClientJdk.java
│   ├── AcmeAddressClientOkHttp.java
│   ├── AcmeAddressClientRetrofit.java
│   └── ResilientAddressVerificationClient.java
│
├── dto
│   ├── AcmeVerifyRequest.java
│   ├── AcmeVerifyResponse.java
│   ├── AcmeNormalizedAddress.java
│   └── AcmeErrorResponse.java
│
├── auth
│   ├── AccessToken.java
│   ├── AccessTokenProvider.java
│   ├── TokenClient.java
│   └── SingleFlightAccessTokenProvider.java
│
├── mapper
│   ├── AcmeResponseMapper.java
│   └── AcmeErrorClassifier.java
│
├── config
│   ├── AcmeClientConfig.java
│   └── AcmeClientFactory.java
│
├── telemetry
│   ├── AcmeClientMetrics.java
│   ├── RedactingTelemetryInterceptor.java
│   └── AcmeOkHttpEventListener.java
│
└── test
    ├── AcmeAddressClientContractTest.java
    ├── AcmeAddressClientTimeoutTest.java
    └── AcmeAddressClientRetryTest.java
```

Rule:

```text
Group by integration boundary when the client has ownership, policy, and lifecycle.
```

---

## 23. Production Readiness Checklist

### Contract

- [ ] External DTO tidak bocor ke domain layer.
- [ ] Result model membedakan success/domain failure/temporary failure.
- [ ] Unknown provider enum ditangani.
- [ ] Empty body semantics jelas.
- [ ] Error body parsing aman.

### Transport

- [ ] Client instance reusable.
- [ ] Timeout eksplisit.
- [ ] Redirect policy eksplisit.
- [ ] Body ditutup/dikonsumsi benar.
- [ ] Connection pool behavior dipahami.

### Auth

- [ ] Token tidak dilog.
- [ ] Token refresh single-flight.
- [ ] Token expiry skew ada.
- [ ] 401 retry tidak infinite loop.
- [ ] Secret source aman.

### Resilience

- [ ] Retry hanya untuk retryable failure.
- [ ] Retry bounded by deadline.
- [ ] Idempotency key dipakai untuk POST retry.
- [ ] Rate limiter di bawah provider limit.
- [ ] Bulkhead mencegah unbounded concurrency.
- [ ] Circuit breaker punya classification benar.

### Observability

- [ ] Metrics by client/operation/outcome/status class.
- [ ] No high-cardinality labels.
- [ ] Correlation ID propagated.
- [ ] Trace context propagated.
- [ ] Logs redacted.
- [ ] Token/body sensitive tidak muncul.

### Security

- [ ] Base URL fixed/allowlisted.
- [ ] No arbitrary user-controlled host.
- [ ] TLS verification enabled.
- [ ] Redirect validated/disabled.
- [ ] Header values sanitized.
- [ ] Dependency tracked.

### Testing

- [ ] Mapper unit tests.
- [ ] Error classifier tests.
- [ ] Mock server interaction tests.
- [ ] Timeout test.
- [ ] Retry/idempotency test.
- [ ] Token refresh concurrency test.
- [ ] Fault injection test.
- [ ] Contract fixture test.

### Operation

- [ ] Runbook exists.
- [ ] Dashboard exists.
- [ ] Alert thresholds defined.
- [ ] Feature flag/kill switch exists.
- [ ] Rollback plan exists.
- [ ] Provider contact/status channel known.

---

## 24. Common Design Mistakes

### Mistake 1 — HTTP Client Created Per Request

Bad:

```java
HttpClient client = HttpClient.newHttpClient();
client.send(request, BodyHandlers.ofString());
```

inside every method call.

Why bad:

- loses pooling benefit;
- can increase connection churn;
- harder to configure consistently;
- harder to observe.

### Mistake 2 — Retry All Exceptions

Bad:

```java
catch (Exception e) {
    retry();
}
```

Why bad:

- retries invalid request;
- retries auth bug;
- retries mapping bug;
- amplifies incident;
- may duplicate side effects.

### Mistake 3 — Logging Full Body

Bad:

```java
log.info("request={}, response={}", requestBody, responseBody);
```

Why bad:

- PII leak;
- token leak;
- huge log volume;
- regulatory exposure.

### Mistake 4 — Provider DTO Used as Domain DTO

Bad:

```java
public AcmeVerifyResponse verifyAddress(...)
```

Why bad:

- external schema infects internal model;
- provider changes become domain changes;
- error semantics unclear.

### Mistake 5 — Timeout Without Deadline

Bad:

```text
connect timeout = 5s
read timeout    = 5s
retry           = 3
```

No operation deadline.

Why bad:

- total latency unbounded or too high;
- caller SLA broken;
- thread/pool retention.

### Mistake 6 — Token Refresh Race

Bad:

```text
every request refreshes token independently when expired
```

Why bad:

- token endpoint thundering herd;
- cascading auth failure;
- rate limit on auth endpoint.

---

## 25. Decision Matrix: JDK vs OkHttp vs Retrofit

| Need | JDK HttpClient | OkHttp | Retrofit |
|---|---:|---:|---:|
| Minimal dependency | Very good | Medium | Medium/Low |
| Java 8 support | No | Yes | Yes |
| HTTP/2 | Yes | Yes | Via OkHttp |
| Interceptor ecosystem | Limited | Strong | Via OkHttp |
| Type-safe API interface | Manual | Manual | Strong |
| Connection pool control | Moderate | Strong | Via OkHttp |
| Event lifecycle hooks | Limited | Strong | Via OkHttp |
| Many endpoints | Manual boilerplate | Manual boilerplate | Strong |
| Generated client alternative | Possible | Possible | Common |
| Enterprise proxy/TLS special control | Moderate | Strong | Via OkHttp |
| Dependency policy strict | Strong | Depends | Depends |

Practical recommendation:

```text
Java 11+ simple internal/third-party client:
  consider JDK HttpClient.

Java 8 or need mature interceptors/event hooks:
  consider OkHttp.

Many endpoints with interface-style contract:
  consider Retrofit over OkHttp, wrapped by domain adapter.

Complex enterprise proxy/connection management:
  also evaluate Apache HttpClient 5.
```

---

## 26. Top 1% Heuristics untuk Third-Party Client

1. **Treat every external API as unreliable, changing, and partially observable.**
2. **Never let transport details leak into domain layer.**
3. **Never retry without a classification model.**
4. **Never retry side-effecting operations without idempotency semantics.**
5. **Never use unbounded queue/concurrency for downstream calls.**
6. **Never log secrets, tokens, or full sensitive payloads.**
7. **Make timeout a budget, not a random number.**
8. **Design token refresh as concurrency problem, not only auth problem.**
9. **Observe attempts, not only operations.**
10. **Test failure modes more than happy path.**
11. **Expose client health through metrics and runbooks.**
12. **Own the integration boundary as a product, not a helper class.**

---

## 27. Ringkasan

Production-grade third-party API client adalah gabungan dari:

```text
contract design
+ DTO isolation
+ safe auth lifecycle
+ timeout budget
+ retry/idempotency semantics
+ rate/concurrency control
+ circuit breaker/fallback
+ observability
+ security hardening
+ mock/contract/fault testing
+ operational runbook
```

Kode HTTP-nya mungkin hanya beberapa puluh baris. Tetapi engineering yang benar ada pada boundary, policy, classification, telemetry, dan operability.

Seorang engineer biasa bertanya:

```text
How do I call this API?
```

Engineer yang matang bertanya:

```text
What contract am I creating with this dependency,
what failures can occur,
how will I limit blast radius,
how will I know what happened,
and how will the system behave when the provider changes or fails?
```

Itulah perbedaan antara HTTP client utility dan integration subsystem.

---

## 28. Referensi Utama

- Java SE 25 `java.net.http.HttpClient` official API documentation.
- OpenJDK HTTP Client examples and recipes.
- OkHttp official documentation for client reuse, connection pooling, interceptor, event listener, and MockWebServer.
- Retrofit official documentation for type-safe HTTP interfaces, annotations, converter, and call model.
- Resilience4j documentation for Retry, CircuitBreaker, RateLimiter, and Bulkhead decorators.
- OWASP guidance for outbound request security, secret leakage prevention, and SSRF defense.


<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 31 — Advanced Patterns: Fan-Out Aggregator, Token Single-Flight, Client-Side Cache, Idempotent Command](./31-advanced-patterns-fanout-token-singleflight-cache-idempotent-command.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 33 — Case Study: Internal Microservice Client at Scale](./33-case-study-internal-microservice-client-at-scale.md)
