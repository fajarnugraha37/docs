# Part 27 — Generated Clients: OpenAPI, Codegen, SDK Governance

> Series: `learn-java-http-client-okhttp-retrofit-client-engineering`  
> File: `27-generated-clients-openapi-codegen-sdk-governance.md`  
> Target Java: 8 sampai 25  
> Fokus: generated HTTP client sebagai **contract-to-code boundary**, bukan sekadar hasil auto-generate yang langsung dipakai di domain layer.

---

## 0. Tujuan Pembelajaran

Setelah bagian ini, kita ingin punya keluwesan untuk:

1. Menilai kapan generated client dari OpenAPI cocok dipakai dan kapan justru berbahaya.
2. Mendesain boundary agar generated code tidak mencemari domain/application layer.
3. Mengontrol timeout, retry, auth, observability, error mapping, dan DTO mapping pada generated client.
4. Menentukan strategi governance untuk banyak API, banyak versi, banyak environment, dan banyak tim.
5. Menghindari jebakan umum seperti generated DTO leaking, breaking change diam-diam, template fork tidak terawat, dan SDK yang tidak bisa dioperasikan di production.
6. Membuat generated client yang cocok untuk Java 8 legacy sampai Java 25 modern runtime.

Mental model utama:

```text
OpenAPI spec
→ generator configuration
→ generated transport/client/model code
→ organization wrapper / adapter
→ domain-safe port
→ application use case
```

Yang harus diingat: **generated client bukan architecture**. Ia hanya satu mekanisme produksi boilerplate dari contract. Architecture tetap harus kamu desain.

---

## 1. Kenapa Generated Client Penting di Level Advance

Di level basic, orang berpikir:

```text
Ada OpenAPI spec → generate Java client → panggil method → selesai
```

Di production, realitanya:

```text
Ada OpenAPI spec
→ apakah spec benar?
→ apakah spec stabil?
→ apakah response error lengkap?
→ apakah enum backward-compatible?
→ apakah nullable benar?
→ apakah authentication digambarkan?
→ apakah generated transport punya timeout?
→ apakah retry aman?
→ apakah DTO boleh bocor ke domain?
→ bagaimana versioning?
→ bagaimana observability?
→ bagaimana testing contract drift?
→ bagaimana upgrade generator?
```

Generated client bisa sangat membantu, tetapi juga bisa membuat coupling menjadi lebih buruk jika dipakai tanpa boundary.

### 1.1 Masalah yang Dipecahkan

Generated clients membantu pada:

- Mengurangi boilerplate request/response class.
- Mengurangi typo URL/path/query/header.
- Membuat client konsisten dengan spec.
- Mempercepat integrasi banyak endpoint.
- Mempermudah update ketika API berubah.
- Memungkinkan SDK internal/eksternal yang lebih mudah dikonsumsi.
- Menjadi artefak contract-driven development.

### 1.2 Masalah yang Tidak Otomatis Dipecahkan

Generated client tidak otomatis menyelesaikan:

- Timeout policy.
- Retry policy.
- Rate limit handling.
- Circuit breaker.
- Auth refresh.
- Redaction.
- Audit logging.
- Semantic error mapping.
- Domain isolation.
- Backward compatibility.
- Spec quality.
- Production runbook.

Generated client hanya membuat **shape of HTTP contract** lebih eksplisit. Operational correctness tetap harus ditambahkan.

---

## 2. Mental Model: Generated Client sebagai Boundary, Bukan Domain API

Ada tiga level API yang sering tercampur:

```text
1. Wire API
   Bentuk HTTP aktual: method, URL, header, body, status code.

2. Generated API
   Bentuk Java hasil generator: ApiClient, FooApi, FooRequest, FooResponse.

3. Domain API
   Bentuk yang dipakai use case: PaymentGateway, IdentityProviderClient, AddressLookupPort.
```

Kesalahan fatal: menjadikan generated API langsung sebagai domain API.

Contoh buruk:

```java
public class CaseService {
    private final ExternalRegulatorApi externalRegulatorApi;

    public void submit(CaseEntity caseEntity) {
        SubmitCaseRequest request = new SubmitCaseRequest(); // generated DTO
        request.setApplicantName(caseEntity.getApplicant().getName());
        externalRegulatorApi.submitCase(request);
    }
}
```

Masalah:

- Domain service tahu nama generated DTO.
- Jika spec berubah, domain service ikut berubah.
- Error eksternal bocor ke aplikasi.
- Timeout/retry/auth tidak terlihat sebagai policy eksplisit.
- Test domain jadi bergantung HTTP contract.

Pola lebih sehat:

```java
public interface RegulatorSubmissionPort {
    SubmissionResult submit(SubmissionCommand command);
}

public final class OpenApiRegulatorSubmissionAdapter implements RegulatorSubmissionPort {
    private final GeneratedRegulatorApi generatedApi;
    private final RegulatorSubmissionMapper mapper;
    private final ClientPolicyExecutor policyExecutor;

    @Override
    public SubmissionResult submit(SubmissionCommand command) {
        return policyExecutor.execute("regulator.submit", () -> {
            GeneratedSubmitRequest request = mapper.toExternalRequest(command);
            GeneratedSubmitResponse response = generatedApi.submit(request);
            return mapper.toDomainResult(response);
        });
    }
}
```

Prinsip:

```text
generated DTO boleh hidup di adapter layer
butuh alasan kuat untuk keluar dari adapter layer
```

---

## 3. OpenAPI sebagai Contract: Apa yang Harus Dipahami

OpenAPI adalah deskripsi machine-readable untuk HTTP API. Tetapi kualitas generated client sangat bergantung pada kualitas spec.

### 3.1 Spec Adalah Source of Truth, Tapi Bukan Selalu Truth Aktual

Dalam organisasi nyata, sering terjadi:

```text
implementation berubah
spec tidak berubah
```

atau:

```text
spec berubah
server belum deploy
```

atau:

```text
spec benar untuk happy path
error response tidak terdokumentasi
```

Karena itu, generated client harus divalidasi dengan:

- Contract test.
- Integration test against sandbox/staging.
- Consumer-driven contract if relevant.
- Golden payload samples.
- Backward compatibility checks.
- Runtime observability.

### 3.2 Area Spec yang Paling Mempengaruhi Java Client

Perhatikan bagian ini ketika review OpenAPI spec:

| Area | Dampak ke Generated Java Client |
|---|---|
| `operationId` | Nama method. Jika buruk, API client buruk. |
| `schema` | Nama DTO, field type, nullability. |
| `required` | Constructor/validation/nullable semantics. |
| `nullable` / OpenAPI 3.1 type union | Null handling. |
| `enum` | Java enum compatibility. |
| `oneOf` / `anyOf` / `allOf` | Polymorphic mapping complexity. |
| `additionalProperties` | Map/dynamic field semantics. |
| `format` | Date/time, UUID, binary, decimal. |
| `securitySchemes` | Auth injection. |
| `responses` | Error modelling. |
| `content` | JSON/XML/form/multipart converter. |
| `servers` | Base URL handling. |
| `parameters` | Path/query/header/cookie binding. |

---

## 4. Generator Landscape untuk Java

Pilihan umum:

```text
OpenAPI Generator
Swagger Codegen
Spring HTTP Interface generated/manual hybrid
Custom internal generator/template
Vendor SDK generator
```

### 4.1 OpenAPI Generator

OpenAPI Generator adalah pilihan populer untuk generate API client, server stub, dokumentasi, dan konfigurasi dari OpenAPI spec. Untuk Java, generator-nya mendukung berbagai HTTP library seperti Jersey, Retrofit 2, OpenFeign, OkHttp/Gson, RestTemplate, WebClient, native Java, dan lain-lain tergantung opsi generator dan versi. Referensi resmi OpenAPI Generator menyebut generator Java sebagai generator Java client library dengan opsi HTTP library yang beragam.

### 4.2 Swagger Codegen

Swagger Codegen adalah proyek lama/terpisah yang juga bisa generate API client/server stub/documentation dari OpenAPI/Swagger definition. Di banyak organisasi legacy, Swagger Codegen masih ada karena sudah masuk pipeline lama.

### 4.3 Spring HTTP Interface Client

Spring HTTP Interface Client memungkinkan HTTP service didefinisikan sebagai Java interface dengan exchange methods, lalu dibuat proxy untuk melakukan HTTP exchange. Ini tidak selalu “generated client” dalam arti OpenAPI generator, tetapi secara arsitektural punya problem yang mirip: interface contract bisa menjadi API client boundary.

### 4.4 Custom Template Internal

Custom template sering muncul ketika organisasi butuh:

- Standard error model.
- Standard auth interceptor.
- Standard telemetry.
- Standard package naming.
- Standard result wrapper.
- Standard dependency version.

Namun custom template juga berarti maintenance burden.

Rule:

```text
Jangan fork template hanya karena tidak suka style kecil.
Fork/customize template hanya jika ada policy organisasi yang benar-benar harus enforced.
```

---

## 5. Pilihan Generated Java Library: Apa Implikasinya?

OpenAPI Java generator biasanya punya opsi library. Setiap opsi membawa runtime model berbeda.

Contoh kategori:

```text
okhttp-gson
retrofit2
webclient
resttemplate
restclient
native
jersey
microprofile
feign
apache-httpclient
```

Nama dan availability bisa berubah antar versi generator, jadi selalu cek dokumentasi generator yang sedang dipakai.

### 5.1 `okhttp-gson`

Cocok ketika:

- Butuh OkHttp sebagai transport.
- Butuh kontrol interceptor, dispatcher, pool, TLS.
- Tidak keberatan Gson atau bisa customize converter.
- Ingin runtime yang familiar untuk JVM/Android heritage.

Risiko:

- Gson/Jackson mismatch dengan standar organisasi.
- Generated ApiClient bisa menyembunyikan OkHttp config.
- Error body parsing sering perlu wrapper.

### 5.2 `retrofit2`

Cocok ketika:

- Ingin interface-based client.
- Sudah memakai Retrofit/OkHttp.
- Butuh converter/call adapter extensibility.

Risiko:

- Retrofit interface terlihat “cantik”, lalu langsung dipakai domain layer.
- Error body tetap harus diparsing manual.
- Annotation semantics perlu diaudit untuk encoding/path/query.

### 5.3 `webclient`

Cocok ketika:

- Aplikasi Spring reactive.
- Butuh non-blocking pipeline.
- Downstream call menjadi bagian reactive composition.

Risiko:

- Dipakai dari blocking app tanpa memahami Reactor.
- `.block()` tersebar.
- Event loop bisa terblokir jika mapper/logic blocking.
- Debugging/cancellation lebih kompleks.

### 5.4 `resttemplate`

Cocok ketika:

- Legacy Spring codebase.
- Migrasi incremental.
- Blocking model sederhana.

Risiko:

- Banyak organisasi mulai prefer `RestClient` untuk synchronous modern Spring.
- Perlu konfigurasi request factory agar pooling/timeout benar.

### 5.5 `native`

Biasanya mengacu pada JDK native HTTP client, tergantung generator version.

Cocok ketika:

- Ingin mengurangi dependency eksternal.
- Java 11+ tersedia.
- Butuh HTTP/2 basic.
- Kebutuhan transport tidak terlalu custom.

Risiko:

- Java 8 tidak bisa.
- Interceptor model tidak sekuat OkHttp.
- Observability sering butuh wrapper eksplisit.

### 5.6 Feign / OpenFeign

Cocok ketika:

- Sudah di ecosystem Spring Cloud/OpenFeign.
- Declarative client style.
- Integrasi load balancing/service discovery tertentu.

Risiko:

- Abstraction bertingkat: Feign → underlying client → resilience layer.
- Error decoder harus serius.
- Retry default perlu diaudit.

---

## 6. Decision Matrix: Generated Client atau Handwritten Client?

Generated client cocok ketika:

| Kondisi | Alasan |
|---|---|
| API punya banyak endpoint | Boilerplate tinggi. |
| Spec cukup stabil dan akurat | Generated code dapat dipercaya. |
| Banyak consumer | SDK konsisten lebih penting. |
| DTO kompleks | Manual mapping raw HTTP rawan typo. |
| API third-party besar | Client manual mahal. |
| Contract-first workflow | Spec memang source of truth. |

Handwritten client lebih cocok ketika:

| Kondisi | Alasan |
|---|---|
| Endpoint sedikit | Generated code mungkin overkill. |
| Spec buruk/tidak lengkap | Generated client memberi ilusi correctness. |
| Butuh domain-specific abstraction kuat | Wrapper tetap dibutuhkan. |
| Error semantics rumit | Manual modelling sering lebih jelas. |
| Payload sangat dinamis | Schema codegen bisa melawan realitas. |
| Security/routing sangat custom | Generated template mungkin sulit dikontrol. |

Hybrid sering terbaik:

```text
generated low-level client
+ handwritten domain adapter
+ organization policy wrapper
```

---

## 7. Struktur Package yang Disarankan

Contoh struktur production-grade:

```text
com.company.identity
├── application
│   └── IdentityVerificationUseCase.java
├── domain
│   ├── IdentityVerificationCommand.java
│   └── IdentityVerificationResult.java
├── port
│   └── IdentityProviderPort.java
└── infrastructure
    └── external
        └── identityprovider
            ├── IdentityProviderOpenApiAdapter.java
            ├── IdentityProviderClientConfig.java
            ├── IdentityProviderClientPolicy.java
            ├── IdentityProviderErrorMapper.java
            ├── IdentityProviderDtoMapper.java
            ├── generated
            │   ├── api
            │   ├── model
            │   └── invoker
            └── testfixture
```

Rules:

```text
application/domain/port tidak import package generated
adapter boleh import generated
mapper menjadi satu-satunya tempat konversi generated DTO ↔ domain DTO
error mapper menjadi satu-satunya tempat konversi generated exception ↔ domain error
```

---

## 8. DTO Governance: Jangan Biarkan Generated DTO Bocor

Generated DTO adalah representasi external contract. Ia bukan domain model.

### 8.1 Kenapa Generated DTO Tidak Boleh Bocor?

Karena external provider bisa mengubah:

- Field name.
- Enum value.
- Required/optional field.
- Date format.
- Error envelope.
- Nested schema.
- Pagination structure.

Jika generated DTO bocor, perubahan eksternal menyebar ke application/domain/test.

### 8.2 Wrapper DTO Pattern

External generated DTO:

```java
public class VerifyIdentityResponse {
    private String verificationStatus;
    private String providerReferenceId;
    private List<String> warningCodes;
}
```

Domain result:

```java
public final class IdentityVerificationResult {
    private final VerificationOutcome outcome;
    private final ExternalReference reference;
    private final List<VerificationWarning> warnings;

    // constructor, getters
}
```

Mapper:

```java
public final class IdentityProviderDtoMapper {
    public IdentityVerificationResult toDomain(VerifyIdentityResponse response) {
        return new IdentityVerificationResult(
            mapOutcome(response.getVerificationStatus()),
            ExternalReference.of(response.getProviderReferenceId()),
            mapWarnings(response.getWarningCodes())
        );
    }
}
```

Benefit:

- Domain memakai vocabulary sendiri.
- Unknown provider value bisa dimodelkan eksplisit.
- Tidak semua external field harus terekspos.
- Migration lebih aman.

---

## 9. Error Governance untuk Generated Clients

Generated client sering menghasilkan exception seperti:

```text
ApiException
HttpClientErrorException
WebClientResponseException
Retrofit HttpException
FeignException
```

Jangan biarkan exception ini bocor ke use case.

### 9.1 Error Mapper

Buat mapper eksplisit:

```java
public final class IdentityProviderErrorMapper {
    public ExternalCallFailure map(Throwable throwable) {
        if (throwable instanceof ApiException apiException) {
            return mapApiException(apiException);
        }
        if (isTimeout(throwable)) {
            return ExternalCallFailure.timeout("identity-provider", throwable);
        }
        if (isConnectionFailure(throwable)) {
            return ExternalCallFailure.transport("identity-provider", throwable);
        }
        return ExternalCallFailure.unknown("identity-provider", throwable);
    }
}
```

### 9.2 Status Code Classification

```text
400 → caller contract bug or validation failure
401 → auth token invalid/expired
403 → authorization/configuration problem
404 → not found or wrong resource scope
409 → conflict/concurrency/business duplicate
422 → semantic validation failure
429 → rate limited, maybe retry later
500 → downstream internal error
502/503/504 → transient infrastructure/downstream failure candidate
```

Tapi jangan mapping buta. Setiap API punya semantics sendiri.

### 9.3 Error Body Parsing

Generated clients sering tidak memberi typed error body secara nyaman. Buat helper:

```java
public final class ProblemDetailsParser {
    public Optional<ProblemDetails> parse(String contentType, String body) {
        if (body == null || body.isBlank()) return Optional.empty();
        if (!contentType.contains("application/problem+json") &&
            !contentType.contains("application/json")) {
            return Optional.empty();
        }
        // parse safely with size limit
    }
}
```

Prinsip:

```text
HTTP status tells category
error body tells detail
domain mapper tells meaning
```

---

## 10. Auth Injection untuk Generated Clients

Generated client bisa mendukung auth berdasarkan `securitySchemes`, tetapi production auth biasanya lebih kompleks.

### 10.1 Auth yang Harus Dipertimbangkan

- Static API key.
- Bearer token.
- OAuth2 client credentials.
- Token refresh.
- HMAC signing.
- mTLS.
- Per-tenant credential.
- Per-environment credential.

### 10.2 Jangan Embed Secret di Generated Code

Buruk:

```java
apiClient.setApiKey("hardcoded-secret");
```

Lebih baik:

```java
public final class IdentityProviderAuthInterceptor implements Interceptor {
    private final TokenProvider tokenProvider;

    @Override
    public Response intercept(Chain chain) throws IOException {
        Request request = chain.request().newBuilder()
            .header("Authorization", "Bearer " + tokenProvider.currentToken())
            .build();
        return chain.proceed(request);
    }
}
```

Untuk generated client non-OkHttp, tempat injeksi berbeda, tetapi prinsipnya sama:

```text
authentication adalah runtime policy
bukan generated static constant
```

### 10.3 Single-Flight Token Refresh

Jika banyak thread menerima 401/expired token bersamaan, jangan semua refresh token.

```text
100 concurrent calls
→ token expired
→ 100 refresh calls  ❌
```

Harus:

```text
100 concurrent calls
→ 1 refresh call
→ 99 menunggu / reuse token baru ✅
```

Generated client jarang memberi ini otomatis. Tambahkan di wrapper/interceptor.

---

## 11. Timeout, Retry, Rate Limit, Circuit Breaker untuk Generated Client

Generated code sering mengatur timeout default terlalu umum, atau bahkan tidak jelas. Untuk production, semua generated client harus masuk policy layer.

### 11.1 Policy Object

```java
public final class ExternalClientPolicy {
    private final Duration connectTimeout;
    private final Duration readTimeout;
    private final Duration callTimeout;
    private final int maxAttempts;
    private final Duration retryBudget;
    private final int maxConcurrentCalls;
    private final boolean circuitBreakerEnabled;
}
```

### 11.2 Per-Operation Policy

Tidak semua endpoint sama.

```text
GET /reference-data
→ can cache
→ retryable
→ low timeout

POST /payments
→ side effect
→ idempotency key needed
→ retry carefully

GET /large-report
→ long response
→ streaming
→ different timeout
```

Jangan satu timeout untuk semua operation hanya karena satu generated `ApiClient`.

### 11.3 Wrapper Execution

```java
public final class PolicyExecutor {
    public <T> T execute(String operationName, Supplier<T> supplier) {
        // metric start
        // bulkhead acquire
        // circuit breaker
        // timeout/deadline
        // retry if operation policy allows
        // metric end
    }
}
```

Generated client dipakai sebagai implementation detail di dalam policy executor.

---

## 12. Observability untuk Generated Clients

Generated client harus menghasilkan observability yang bisa menjawab:

```text
Downstream mana yang lambat?
Endpoint mana yang error?
Apakah gagal di DNS, connect, TLS, read, decode, atau status code?
Berapa retry attempt?
Berapa 429?
Apakah token refresh spike?
Apakah generated client version baru menaikkan error?
```

### 12.1 Metric Names

Contoh metric:

```text
http.client.requests
http.client.duration
http.client.errors
http.client.retries
http.client.timeouts
http.client.rate_limited
http.client.circuit_breaker.state
http.client.generated.version
```

Suggested tags:

```text
client = identity-provider
operation = verifyIdentity
method = POST
status_class = 2xx/4xx/5xx
error_kind = timeout/transport/protocol/domain/decode
retry_attempt = 0/1/2
```

Hindari high cardinality:

```text
❌ full_url
❌ raw_query
❌ user_id
❌ provider_reference_id
❌ exception_message raw
```

### 12.2 Generated Version Tag

Saat upgrade spec/generator, observability harus bisa membedakan versi.

```text
client_spec_version = 2026-06-18
client_artifact_version = 1.8.0
generator_version = 7.x
```

Ini sangat membantu saat incident setelah deploy.

---

## 13. Versioning dan Compatibility

Generated client membuat perubahan contract lebih terlihat, tetapi juga bisa membuat breaking change masuk diam-diam.

### 13.1 Jenis Perubahan OpenAPI

| Perubahan | Biasanya Aman? | Catatan |
|---|---:|---|
| Tambah optional response field | Ya | Jika deserializer toleran unknown field. |
| Tambah required response field | Mungkin | Client lama biasanya tidak peduli, tapi schema semantic berubah. |
| Hapus response field | Tidak | Mapper bisa gagal. |
| Ubah field type | Tidak | Breaking. |
| Tambah enum value | Sering breaking | Java enum tidak otomatis menerima unknown value. |
| Ubah path/method | Tidak | Breaking. |
| Tambah optional request field | Ya | Client lama tidak mengirim. |
| Tambah required request field | Tidak | Client lama invalid. |
| Ubah error response | Mungkin | Error mapper bisa gagal. |

### 13.2 Enum Evolution Problem

Generated Java enum sering seperti:

```java
public enum Status {
    APPROVED,
    REJECTED
}
```

Jika server menambah:

```text
PENDING_REVIEW
```

Client lama bisa gagal deserialize.

Better strategy:

```text
- configure unknown enum handling if supported
- map external enum to domain enum with UNKNOWN
- do not expose generated enum to domain
```

Domain enum:

```java
public enum VerificationOutcome {
    APPROVED,
    REJECTED,
    PENDING,
    UNKNOWN
}
```

### 13.3 Semantic Versioning untuk SDK

Jika kamu publish SDK internal:

```text
MAJOR: breaking contract / package / method changes
MINOR: compatible endpoint/model additions
PATCH: bugfix, dependency patch, template fix
```

Tapi ingat: generated code version dan API spec version tidak selalu sama.

Recommended metadata:

```text
provider-api-version: v3
openapi-spec-version: 2026-06-18
sdk-version: 2.4.1
 generator-version: 7.14.0
```

---

## 14. Build Integration: Maven dan Gradle

Generated clients bisa dibuat:

```text
manual CLI generation
build-time generation
CI generated artifact
pre-generated committed source
separate SDK module
```

### 14.1 Jangan Generate Sembarangan di Build Utama

Jika setiap build aplikasi generate client dari remote spec:

```text
mvn test
→ fetch latest OpenAPI spec
→ generate code
→ compile
```

Risiko:

- Build tidak reproducible.
- Spec berubah tanpa review.
- CI tiba-tiba gagal.
- Developer lokal berbeda hasil.

Lebih baik:

```text
spec pinned in repository or artifact registry
→ generator version pinned
→ config pinned
→ generated diff reviewed
```

### 14.2 Committed Generated Code vs Generated at Build

Committed generated code:

Pros:

- Diff terlihat di PR.
- IDE mudah.
- Build lebih sederhana.
- Tidak butuh generator di semua environment.

Cons:

- Repository bengkak.
- Merge conflict generated files.
- Bisa diedit manual tanpa sadar.

Generated at build:

Pros:

- Source lebih bersih.
- Generated output reproducible jika config benar.

Cons:

- Build lebih kompleks.
- Debugging generated source kadang kurang nyaman.
- Perlu cache/toolchain.

Untuk enterprise, sering paling sehat:

```text
separate generated-sdk module
→ generated code committed or built reproducibly
→ published as internal artifact
→ application depends on SDK artifact
```

---

## 15. Template Customization: Kapan Perlu?

Generator biasanya memakai template Mustache/Handlebars atau mekanisme serupa. Customization powerful, tetapi berbahaya.

### 15.1 Alasan Valid untuk Custom Template

- Menambahkan standard telemetry hook.
- Menambahkan standard error wrapper.
- Mengganti dependency yang tidak allowed.
- Mengatur package architecture organisasi.
- Menambahkan nullability annotation.
- Mengganti date/time type.
- Menambahkan generated metadata.
- Menghapus unsafe default.

### 15.2 Alasan Lemah

- Tidak suka formatting.
- Ingin nama method sedikit lebih cantik.
- Ingin menghindari wrapper layer.
- Ingin memasukkan business logic ke generated code.

### 15.3 Template Fork Risk

Template fork harus dijaga seperti produk:

```text
upstream generator release
→ template change
→ internal fork drift
→ generated code bug/security issue
→ sulit upgrade
```

Governance:

- Pinned upstream generator version.
- Internal template version.
- Regression test generated output.
- Template changelog.
- Owner jelas.

---

## 16. Generated Client sebagai Internal SDK

Jika API dipakai banyak service, generated client bisa menjadi internal SDK.

Namun SDK yang baik bukan hanya generated source. SDK harus mengemas:

```text
transport config
→ auth strategy
→ timeout defaults
→ retry/circuit policy
→ typed domain-ish result
→ observability
→ error taxonomy
→ compatibility policy
→ documentation
→ examples
```

### 16.1 SDK Layering

```text
sdk-public-api
    interfaces and domain-safe commands/results

sdk-internal-adapter
    uses generated OpenAPI client

sdk-generated
    generated api/model/invoker
```

Konsumen SDK sebaiknya tidak perlu tahu generator apa yang dipakai.

### 16.2 SDK Public Contract

Buruk:

```java
VerifyIdentityResponse verifyIdentity(VerifyIdentityRequest request);
```

Jika `VerifyIdentityResponse` adalah generated DTO.

Lebih baik:

```java
IdentityVerificationResult verifyIdentity(IdentityVerificationCommand command);
```

atau jika ingin lebih eksplisit:

```java
ExternalResult<IdentityVerificationResult, IdentityProviderFailure> verifyIdentity(
    IdentityVerificationCommand command
);
```

---

## 17. Governance untuk Banyak API dan Banyak Tim

Di organisasi besar, masalahnya bukan cuma satu client.

Masalah nyata:

```text
20 downstream APIs
→ 20 generated clients
→ 20 timeout styles
→ 20 auth implementations
→ 20 error mapping styles
→ 20 logging risk profiles
```

Butuh platform/governance.

### 17.1 Standard Generator Profile

Buat profile standar:

```yaml
java-client-profile:
  generator: java
  library: okhttp-gson
  generatorVersion: 7.x.x
  dateLibrary: java8
  serializationLibrary: jackson/gson sesuai standar
  hideGenerationTimestamp: true
  invokerPackage: com.company.external.<client>.generated.invoker
  apiPackage: com.company.external.<client>.generated.api
  modelPackage: com.company.external.<client>.generated.model
```

### 17.2 Standard Review Checklist

Setiap generated client baru harus menjawab:

```text
- Source OpenAPI spec dari mana?
- Versi spec apa?
- Siapa owner provider?
- Endpoint mana dipakai?
- Auth scheme apa?
- Timeout per operation apa?
- Retryable operation mana?
- Apakah ada idempotency key?
- Error body format apa?
- Apakah generated DTO bocor ke domain?
- Apakah logging meredact token/body sensitive?
- Apakah test mencakup 4xx/5xx/timeout/malformed response?
- Bagaimana upgrade spec dilakukan?
- Bagaimana rollback SDK?
```

### 17.3 Internal Catalog

Jaga catalog:

```text
client name
provider/system
owner team
artifact coordinates
spec version
SDK version
runtime library
auth type
SLA/SLO
rate limit
runbook link
```

---

## 18. Security untuk Generated Clients

Generated code bisa membawa security risk.

### 18.1 URL dan Server Selection

OpenAPI `servers` bisa berisi base URL. Jangan blindly trust jika spec berasal dari luar.

Risiko:

- SSRF.
- Wrong environment.
- Redirect to untrusted host.
- Sensitive token sent to wrong host.

Enforce:

```text
base URL from controlled config
allowed host list
allowed scheme https only
redirect policy restricted
proxy policy explicit
```

### 18.2 Header dan Auth Leakage

Generated clients bisa menaruh auth pada global ApiClient. Pastikan token tidak terkirim ke host lain saat redirect.

Rule:

```text
auth header attached only after final destination is validated
redirect across host requires explicit decision
```

### 18.3 Sensitive Generated Models

Generated DTO bisa memiliki fields seperti:

```text
password
accessToken
refreshToken
nric
ssn
email
phone
bankAccount
```

Jangan auto-log DTO dengan `toString()`.

Jika generator membuat `toString()` yang mencetak semua field, itu risk.

Mitigation:

- Disable model `toString` jika bisa.
- Use redaction wrapper.
- Jangan log whole object.
- Sanitize in error mapper.

---

## 19. Testing Generated Clients

Testing generated client bukan berarti menguji generator. Yang diuji adalah integration boundary dan wrapper behavior.

### 19.1 Test Pyramid

```text
mapper unit test
→ error mapper test
→ policy executor test
→ mock server generated client test
→ contract test against OpenAPI examples
→ sandbox integration test
```

### 19.2 Golden Payload Test

Simpan sample provider payload:

```text
src/test/resources/provider/verify-success.json
src/test/resources/provider/verify-rejected.json
src/test/resources/provider/error-rate-limited.json
src/test/resources/provider/error-validation.json
src/test/resources/provider/unknown-enum.json
```

Test:

- Parse success.
- Parse error.
- Unknown field tolerated.
- Unknown enum handled.
- Missing optional field handled.
- Missing required field classified as decode/schema failure.

### 19.3 Mock Server Test

Test bahwa generated/wrapper mengirim:

```text
method benar
path benar
query benar
header auth ada
idempotency key ada
content-type benar
body sesuai
```

Test response:

```text
200 success
400 validation
401 refresh path
429 retry-after
500 no unsafe retry for non-idempotent command
malformed JSON
slow response timeout
connection reset
```

---

## 20. CI/CD Pipeline untuk Generated Clients

Ideal pipeline:

```text
1. Fetch/pin OpenAPI spec
2. Validate spec syntax
3. Run lint rules
4. Run breaking change detection
5. Generate client with pinned generator
6. Compile generated code
7. Run unit tests
8. Run mock server contract tests
9. Publish SDK artifact
10. Generate changelog
11. Notify consumers
```

### 20.1 Spec Lint Rules

Contoh rules:

```text
operationId wajib unik dan stable
error responses wajib terdokumentasi
401/403/429/500/503 harus ada jika relevan
schema harus punya required eksplisit
enum harus punya compatibility strategy
nullable harus eksplisit
format date/time harus jelas
securitySchemes harus benar
servers tidak boleh production hardcoded untuk generated SDK
```

### 20.2 Breaking Change Detection

Detect:

- Removed endpoint.
- Removed response field used by consumer.
- Type change.
- Required field added to request.
- Enum value behavior change.
- Status code removed.
- Media type changed.

Tools bisa bervariasi, tetapi prinsipnya lebih penting: **jangan biarkan breaking change masuk sebagai generated diff biasa**.

---

## 21. Java 8 sampai Java 25 Considerations

### 21.1 Java 8

Constraints:

- Tidak ada JDK `HttpClient` modern.
- Gunakan OkHttp, Apache HttpClient, Retrofit, RestTemplate, Feign, Jersey, dll.
- `CompletableFuture` tersedia.
- Tidak ada virtual threads.
- TLS/default cipher tergantung runtime update.

Recommendation:

```text
OkHttp/Apache + wrapper + explicit executor/bulkhead
```

### 21.2 Java 11+

Options:

- Native JDK `HttpClient` tersedia.
- Generated `native` client bisa dipertimbangkan jika fitur cukup.
- HTTP/2 support baseline lebih baik.

Recommendation:

```text
JDK native if dependency minimization matters
OkHttp/Apache if need richer transport customization
```

### 21.3 Java 17 LTS

Good baseline untuk enterprise modern.

Consider:

- Stronger TLS defaults than older Java.
- Records possible for handwritten wrappers, tapi generated models belum tentu pakai records.
- Sealed interface bisa dipakai untuk domain-safe result/failure model.

### 21.4 Java 21+

Virtual threads mengubah cara melihat blocking generated clients.

```text
blocking generated client + virtual threads
```

bisa sangat masuk akal, asalkan:

- concurrency tetap dibatasi;
- connection pool cukup;
- timeout jelas;
- downstream tidak dibanjiri;
- logging/mapper tidak menjadi bottleneck.

### 21.5 Java 25

Gunakan prinsip yang sama:

```text
runtime makin modern tidak menghapus kebutuhan policy boundary
```

Generated client tetap perlu:

- auth injection;
- timeout;
- retry semantics;
- metrics;
- error mapping;
- compatibility governance.

---

## 22. Anti-Patterns yang Harus Dihindari

### 22.1 Generated DTO Everywhere

```text
domain imports generated.model.*
```

Ini hampir selalu red flag.

### 22.2 Generated Client Tanpa Timeout

Jika default timeout tidak jelas, anggap tidak aman.

### 22.3 Retry Semua Error

Generated client tidak tahu operation semantics. Jangan retry `POST` tanpa idempotency.

### 22.4 Edit Manual Generated Code

Perubahan akan hilang saat regenerate.

Jika perlu perubahan:

```text
wrapper
template customization
post-processing script with test
upstream generator contribution
```

### 22.5 Spec dari Remote Latest Saat Build

Build harus reproducible.

### 22.6 Auto-Log Request/Response Body

Generated model `toString()` bisa membocorkan PII/secret.

### 22.7 Satu SDK untuk Semua Use Case Tanpa Policy Per Operation

Endpoint reference data dan endpoint payment command tidak punya policy yang sama.

### 22.8 Tidak Ada Owner

Generated SDK tanpa owner akan membusuk.

---

## 23. Production-Grade Generated Client Blueprint

Blueprint minimal:

```text
GeneratedClientModule
├── Spec artifact pinned
├── Generator config pinned
├── Generated code isolated
├── Public port/domain-safe interface
├── Adapter wrapping generated code
├── DTO mapper
├── Error mapper
├── Auth provider
├── Timeout/retry/rate/circuit policy
├── Observability hook
├── Redaction policy
├── Mock server tests
├── Contract drift checks
├── Version metadata
└── Runbook
```

Example public interface:

```java
public interface AddressLookupPort {
    AddressLookupResult lookupByPostalCode(PostalCode postalCode);
}
```

Adapter:

```java
public final class OpenApiAddressLookupAdapter implements AddressLookupPort {
    private final GeneratedAddressApi api;
    private final AddressMapper mapper;
    private final ExternalClientExecutor executor;

    @Override
    public AddressLookupResult lookupByPostalCode(PostalCode postalCode) {
        return executor.execute("address.lookupByPostalCode", () -> {
            try {
                GeneratedAddressResponse response = api.lookup(postalCode.value());
                return mapper.toDomain(response);
            } catch (Exception ex) {
                throw mapper.toDomainFailure(ex);
            }
        });
    }
}
```

Key point:

```text
Use case sees AddressLookupPort
Adapter sees generated code
Generated code sees HTTP
```

---

## 24. Design Review Questions

Sebelum approve generated client, tanyakan:

### 24.1 Contract

```text
- OpenAPI spec source-nya official?
- Spec version dipin?
- operationId stable?
- error responses lengkap?
- examples tersedia?
- nullable/required jelas?
- enum evolution dipikirkan?
```

### 24.2 Runtime

```text
- HTTP library apa yang dipakai generated client?
- Timeout di mana dikonfigurasi?
- Pooling di mana dikontrol?
- Auth token injection di mana?
- Token refresh single-flight?
- Retry policy per operation?
- Circuit breaker dan rate limit ada?
```

### 24.3 Architecture

```text
- Generated package isolated?
- Domain import generated class?
- Adapter punya mapper?
- Error mapper eksplisit?
- Public SDK API stabil?
```

### 24.4 Security

```text
- Base URL allowlisted?
- HTTPS enforced?
- Redirect restricted?
- Auth header tidak bocor cross-host?
- Sensitive fields tidak dilog?
- Dependency generator/runtime discan?
```

### 24.5 Operation

```text
- Metrics per operation ada?
- Logs redacted?
- Trace context propagated?
- SDK version terlihat di telemetry?
- Runbook tersedia?
- Sandbox/integration test tersedia?
```

---

## 25. Ringkasan Mental Model

Generated client adalah accelerator, bukan pengganti engineering judgement.

Formula sehat:

```text
good spec
+ pinned generator
+ isolated generated code
+ domain-safe wrapper
+ explicit runtime policies
+ error mapping
+ observability
+ contract tests
+ version governance
= production-grade generated client
```

Formula berbahaya:

```text
unknown spec
+ latest generator
+ generated DTO everywhere
+ default timeout
+ no retry semantics
+ no error mapper
+ no redaction
= fragile integration hidden behind generated code
```

Top-tier engineer tidak menolak generated code secara dogmatis, tetapi juga tidak percaya generated code secara buta. Ia menempatkannya di boundary yang tepat, mengontrol policy yang generated code tidak pahami, dan membuat perubahan contract dapat diaudit.

---

## 26. Checklist Akhir

Generated client siap production jika:

```text
[ ] Spec source jelas dan versioned.
[ ] Generator version pinned.
[ ] Generator config committed/reviewed.
[ ] Generated package isolated.
[ ] Domain/application tidak import generated DTO/API.
[ ] Adapter/wrapper tersedia.
[ ] DTO mapper tersedia.
[ ] Error mapper tersedia.
[ ] Timeout explicit.
[ ] Retry policy explicit per operation.
[ ] Idempotency policy jelas.
[ ] Rate limit/bulkhead/circuit breaker sesuai kebutuhan.
[ ] Auth injection aman.
[ ] Token refresh concurrency safe.
[ ] Base URL controlled by config dan allowlist.
[ ] Redirect behavior reviewed.
[ ] Logging redacted.
[ ] Metrics/tracing tersedia.
[ ] Contract/golden payload tests tersedia.
[ ] Unknown enum/field handling diuji.
[ ] Dependency dan generated template punya owner.
[ ] Upgrade path dan rollback path jelas.
```

---

## 27. Hubungan dengan Part Berikutnya

Part ini membahas bagaimana generated client dibangun dan dikelola. Part berikutnya akan masuk ke **client configuration management**:

```text
environment
→ tenant
→ endpoint
→ secret
→ feature flag
→ dynamic reload
→ failover/canary
→ startup validation
```

Generated client yang baik tetap bisa gagal jika konfigurasi environment, secret, endpoint, atau tenant salah. Karena itu konfigurasi adalah bagian dari correctness, bukan sekadar deployment detail.

---

## Referensi

- OpenAPI Generator — Java Generator Documentation.
- OpenAPI Generator — Generators List.
- OpenAPI Generator — Project Overview.
- Swagger Codegen — Official Tool Documentation.
- Spring Framework — REST Clients and HTTP Interface Client Documentation.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 26 — Security Hardening for HTTP Clients](./26-security-hardening-for-http-clients.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 28 — Client Configuration Management: Environment, Tenant, Endpoint, Secret, Feature Flag](./28-client-configuration-management-environment-tenant-endpoint-secret-featureflag.md)
