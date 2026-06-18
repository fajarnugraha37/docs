# Part 34 — Architecture Patterns: API Client SDK, Gateway Adapter, Anti-Corruption Layer, Protocol Bridge, and Sidecar

> Seri: `learn-java-io-network-http-grpc-protocol-engineering`  
> File: `034-architecture-patterns-api-client-sdk-gateway-adapter-anti-corruption-layer-protocol-bridge-sidecar.md`  
> Target: Java 8–25, advanced backend/network/system engineering  
> Status: Part 34 of 35

---

## 1. Tujuan Bagian Ini

Sampai Part 33, kita sudah membedah network communication dari bawah ke atas:

- TCP, DNS, socket, TLS.
- HTTP/1.1, HTTP/2, HTTP/3/QUIC secara konseptual.
- Java HTTP client generations.
- Timeout, retry, idempotency, pooling, observability, security, testing, dan incident diagnosis.
- gRPC fundamentals, transport internals, retry/load-balancing, streaming, dan backpressure.

Bagian ini menaikkan level dari **mechanism** ke **architecture**.

Pertanyaan utamanya bukan lagi:

```text
Bagaimana cara memanggil service X dari Java?
```

Tetapi:

```text
Di mana komunikasi service X harus diletakkan dalam arsitektur?
Siapa yang memiliki kontrak komunikasi itu?
Bagaimana error, timeout, retry, auth, observability, dan compatibility dijaga?
Bagaimana perubahan protocol tidak menyebar ke seluruh codebase?
Bagaimana agar sistem tetap defensible, testable, dan evolvable?
```

Seorang engineer biasa sering membuat call seperti ini tersebar di banyak tempat:

```java
HttpClient.newHttpClient().send(request, BodyHandlers.ofString());
```

atau:

```java
someGrpcStub.submitCase(request);
```

Top-tier engineer akan bertanya:

- Apakah call ini bagian dari domain capability atau technical integration?
- Apakah dependency ini stable, flaky, regulated, partner-owned, internal, atau legacy?
- Apakah call ini boleh retry?
- Apakah side effect-nya idempotent?
- Apakah error remote boleh bocor ke domain model internal?
- Apakah contract eksternal bisa berubah tanpa memaksa perubahan besar?
- Apakah trace, metrics, logs, timeout, retry, dan audit evidence konsisten?
- Apakah kita butuh direct call, SDK, gateway adapter, anti-corruption layer, protocol bridge, sidecar, atau asynchronous handoff?

Bagian ini memberi framework untuk menjawab pertanyaan-pertanyaan tersebut.

---

## 2. Premis Utama: Network Call Adalah Boundary, Bukan Detail Implementasi

Network call bukan sekadar baris kode.

Network call adalah boundary yang membawa:

1. **Boundary of ownership**  
   Service lain bisa dimiliki tim lain, vendor lain, agency lain, atau platform lain.

2. **Boundary of failure**  
   Remote system bisa lambat, partial outage, deploy, rate-limit, reject, atau berubah contract.

3. **Boundary of data meaning**  
   Field yang sama bisa punya makna berbeda di domain berbeda.

4. **Boundary of consistency**  
   Local transaction tidak otomatis mencakup remote effect.

5. **Boundary of trust**  
   Remote response harus divalidasi. Remote request harus dibatasi.

6. **Boundary of observability**  
   Tanpa instrumentation, network boundary adalah blind spot.

7. **Boundary of compliance/audit**  
   Dalam sistem regulatory/case-management, external call sering menjadi evidence trail.

Karena itu, pattern architecture yang benar bukan hanya mempercantik code. Pattern menentukan apakah komunikasi antar sistem bisa dikelola saat sistem membesar.

---

## 3. Anti-Pattern Dasar: Scattered Remote Calls

### 3.1 Bentuk Anti-Pattern

Misalnya dalam codebase terdapat call langsung dari banyak service:

```text
CaseService          -> external applicant profile API
AppealService        -> external applicant profile API
RenewalService       -> external applicant profile API
ComplianceService    -> external applicant profile API
ReportService        -> external applicant profile API
NotificationService  -> external applicant profile API
```

Masing-masing membuat client sendiri:

```java
public ApplicantDto fetchApplicant(String id) {
    HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(baseUrl + "/applicants/" + id))
            .timeout(Duration.ofSeconds(30))
            .GET()
            .build();

    try {
        HttpResponse<String> response = httpClient.send(request, BodyHandlers.ofString());
        return mapper.readValue(response.body(), ApplicantDto.class);
    } catch (Exception e) {
        throw new RuntimeException(e);
    }
}
```

Masalahnya bukan hanya duplikasi.

Masalah yang lebih serius:

- Timeout berbeda-beda.
- Retry berbeda-beda.
- Error mapping tidak konsisten.
- Token handling tersebar.
- Circuit breaker tidak konsisten.
- Logs/metrics/traces tidak seragam.
- External DTO masuk ke domain internal.
- Schema change merusak banyak module.
- Tidak ada owner untuk integration contract.
- Tidak jelas mana call read-only dan mana call side-effect.
- Tidak ada single place untuk rate limit, backoff, idempotency key, atau fallback.

Ini adalah contoh “network logic leaked into domain logic”.

### 3.2 Gejala di Production

Gejala yang sering muncul:

```text
- Beberapa endpoint timeout, beberapa tidak.
- Retry storm hanya terjadi dari module tertentu.
- External vendor bilang request duplicate.
- Trace terputus di tengah.
- Log penuh token/PII karena wrapper logging berbeda.
- Satu API change memaksa banyak PR.
- Incident sulit dianalisis karena setiap caller membungkus error berbeda.
- Connection pool terlalu banyak karena setiap component membuat client sendiri.
- Domain service menjadi sulit unit test.
```

Top-tier architecture menghilangkan scattering dengan membuat boundary eksplisit.

---

## 4. Pattern Map

Bagian ini akan membahas pattern berikut:

```text
1. Typed API Client SDK
2. Gateway Adapter
3. Anti-Corruption Layer
4. Protocol Bridge
5. Backend-for-Frontend / Experience API
6. API Gateway / Edge Gateway
7. Sidecar / Service Mesh Boundary
8. Outbox/Inbox Bridge
9. Webhook Adapter
10. File/Data Transfer Gateway
11. Integration Platform Module
12. Governance Pattern for Shared Client Libraries
```

Kita tidak akan membahas pattern sebagai katalog hafalan. Kita akan membahas:

- kapan digunakan,
- kapan berbahaya,
- responsibility boundary,
- Java implementation shape,
- observability,
- failure handling,
- testing,
- evolution strategy.

---

## 5. Pattern 1 — Typed API Client SDK

### 5.1 Masalah yang Diselesaikan

Jika banyak module perlu memanggil API yang sama, jangan biarkan setiap module membangun HTTP/gRPC call sendiri.

Buat **typed client SDK**:

```text
Domain code -> ApplicantRegistryClient -> HTTP/gRPC details -> remote service
```

Caller tidak tahu:

- URL path detail,
- HTTP method,
- header auth,
- token refresh,
- retry policy,
- mapping status code,
- JSON parser detail,
- connection pool,
- telemetry,
- remote error structure.

Caller hanya tahu operasi bisnis atau integration capability:

```java
ApplicantProfile profile = applicantRegistryClient.getApplicantProfile(applicantId);
```

### 5.2 Responsibility

Client SDK bertanggung jawab untuk:

```text
- Typed request/response model
- URI/method/header construction
- Serialization/deserialization
- Timeout/deadline policy
- Retry/idempotency policy
- Error mapping
- Authentication/token injection
- Correlation/trace propagation
- Metrics/logging/tracing
- Rate limit awareness
- Payload size limits
- Backward-compatible parsing
- Test doubles/fake implementation
```

Client SDK tidak boleh menjadi tempat business orchestration kompleks.

Jika SDK mulai menggabungkan banyak remote service dan membuat keputusan business, ia berubah menjadi hidden service/gateway di library.

### 5.3 Java Shape

Contoh interface:

```java
public interface ApplicantRegistryClient {
    ApplicantProfile getApplicantProfile(ApplicantId applicantId, RequestContext context);

    SearchApplicantsResult searchApplicants(ApplicantSearchQuery query, RequestContext context);
}
```

Implementation HTTP:

```java
public final class HttpApplicantRegistryClient implements ApplicantRegistryClient {
    private final HttpClient httpClient;
    private final URI baseUri;
    private final ObjectMapper objectMapper;
    private final TokenProvider tokenProvider;
    private final RemoteCallPolicy policy;

    public HttpApplicantRegistryClient(
            HttpClient httpClient,
            URI baseUri,
            ObjectMapper objectMapper,
            TokenProvider tokenProvider,
            RemoteCallPolicy policy
    ) {
        this.httpClient = httpClient;
        this.baseUri = baseUri;
        this.objectMapper = objectMapper;
        this.tokenProvider = tokenProvider;
        this.policy = policy;
    }

    @Override
    public ApplicantProfile getApplicantProfile(ApplicantId applicantId, RequestContext context) {
        return policy.execute("ApplicantRegistry.getApplicantProfile", context, attempt -> {
            URI uri = baseUri.resolve("/v1/applicants/" + encode(applicantId.value()));

            HttpRequest request = HttpRequest.newBuilder(uri)
                    .timeout(attempt.remainingTimeout())
                    .header("Accept", "application/json")
                    .header("Authorization", "Bearer " + tokenProvider.getToken())
                    .header("X-Correlation-Id", context.correlationId())
                    .GET()
                    .build();

            HttpResponse<String> response = httpClient.send(
                    request,
                    HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)
            );

            return mapApplicantProfile(response);
        });
    }

    private ApplicantProfile mapApplicantProfile(HttpResponse<String> response) throws IOException {
        int status = response.statusCode();

        if (status == 200) {
            ExternalApplicantProfile dto = objectMapper.readValue(response.body(), ExternalApplicantProfile.class);
            return ApplicantProfileMapper.toDomain(dto);
        }

        if (status == 404) {
            throw new ApplicantNotFoundException();
        }

        if (status == 429 || status == 503 || status == 504) {
            throw new RemoteTemporaryUnavailableException("Applicant registry unavailable: " + status);
        }

        throw new RemoteProtocolException("Unexpected applicant registry status: " + status);
    }

    private static String encode(String raw) {
        return URLEncoder.encode(raw, StandardCharsets.UTF_8);
    }
}
```

### 5.4 Important Design Choice: SDK Model vs Domain Model

Jangan otomatis mengembalikan DTO remote ke domain.

Buruk:

```java
ExternalApplicantDto dto = registryClient.getApplicant(id);
caseService.approve(dto.getEligibilityCode());
```

Lebih baik:

```java
ApplicantProfile profile = registryClient.getApplicantProfile(id);
caseService.evaluate(profile);
```

Kenapa?

Karena external DTO adalah contract remote. Domain internal harus dilindungi dari perubahan remote.

### 5.5 SDK Versioning

Untuk internal SDK:

```text
client-app -> shared-client-lib:v1.8.0 -> remote service API
```

Risiko:

- Banyak service stuck di versi lama.
- Breaking change SDK memaksa mass upgrade.
- SDK terlalu berat membawa dependency besar.
- SDK menyembunyikan network behavior yang perlu diketahui caller.

Prinsip:

```text
- SDK harus kecil.
- SDK harus punya semantic versioning jelas.
- SDK harus expose timeout/deadline context.
- SDK harus dokumentasikan retry/idempotency.
- SDK harus publish metrics contract.
- SDK harus punya fake/test module.
```

### 5.6 Kapan SDK Cocok

Gunakan SDK jika:

```text
- API dipakai banyak module/service.
- Contract relatif stabil.
- Ada kebutuhan policy seragam.
- Remote call punya auth/error/pagination kompleks.
- Observability harus seragam.
- Team pemilik API dapat maintain SDK.
```

Hindari SDK jika:

```text
- API masih sangat volatile.
- Consumer hanya satu.
- SDK akan membuat coupling terlalu kuat.
- SDK akan memaksa dependency runtime besar.
- SDK menjadi tempat orchestration business lintas bounded context.
```

---

## 6. Pattern 2 — Gateway Adapter

### 6.1 Definisi

Gateway Adapter adalah komponen internal yang membungkus external system atau remote dependency di belakang interface lokal.

```text
Domain service -> PaymentGateway / IdentityGateway / DocumentGateway -> external system
```

Contoh:

```java
public interface IdentityVerificationGateway {
    VerifiedIdentity verify(ApplicantIdentity identity, VerificationContext context);
}
```

Implementation bisa HTTP, gRPC, SOAP, file drop, message queue, atau mock.

### 6.2 Perbedaan dengan API Client SDK

| Aspek | API Client SDK | Gateway Adapter |
|---|---|---|
| Fokus | Reusable technical client | Boundary use case/domain-facing integration |
| Ownership | Bisa dimiliki provider API | Biasanya dimiliki consuming service/team |
| Model | Typed remote API model | Local domain-facing model |
| Scope | Bisa generic untuk API | Biasanya spesifik untuk bounded context |
| Cocok untuk | Banyak consumer | Integrasi domain tertentu |

SDK sering menjadi building block bagi gateway adapter.

```text
CaseService
  -> IdentityVerificationGateway
      -> SingpassClientSDK / PartnerClientSDK / HttpClient
```

### 6.3 Java Shape

```java
public interface AddressResolutionGateway {
    ResolvedAddress resolvePostalCode(PostalCode postalCode, RequestContext context);
}
```

Implementation:

```java
public final class OneMapAddressResolutionGateway implements AddressResolutionGateway {
    private final OneMapClient oneMapClient;
    private final AddressMapper mapper;

    @Override
    public ResolvedAddress resolvePostalCode(PostalCode postalCode, RequestContext context) {
        OneMapSearchResponse response = oneMapClient.searchByPostalCode(postalCode.value(), context);

        if (response.results().isEmpty()) {
            return ResolvedAddress.notFound(postalCode);
        }

        if (response.results().size() > 1) {
            return mapper.toAmbiguousAddress(postalCode, response.results());
        }

        return mapper.toResolvedAddress(response.results().get(0));
    }
}
```

Domain service tidak tahu bahwa OneMap memakai token, Redis cache, rate limit, retry 401, atau API response shape tertentu.

### 6.4 Apa yang Harus Ada di Gateway Adapter

Gateway Adapter idealnya punya:

```text
- Local domain-facing interface
- External-to-internal mapping
- Error translation
- Remote policy selection
- Idempotency decision
- Fallback behavior
- Audit event emission
- Observability tags
- Contract tests
- Fake implementation
```

### 6.5 Error Translation

External error tidak boleh bocor mentah.

Buruk:

```java
throw new RuntimeException("HTTP 503 from OneMap");
```

Lebih baik:

```java
throw new AddressResolutionTemporarilyUnavailableException(
    "Address provider temporarily unavailable",
    providerErrorCode,
    correlationId
);
```

Untuk regulatory/case-management, error harus bisa dibedakan:

```text
- Applicant data invalid
- Applicant data not found
- Provider unavailable
- Provider rejected request
- Provider response inconsistent
- Internal mapping error
- Timeout before side effect known
```

---

## 7. Pattern 3 — Anti-Corruption Layer

### 7.1 Masalah yang Diselesaikan

Anti-Corruption Layer atau ACL digunakan ketika sistem eksternal/legacy punya model yang tidak boleh mencemari model internal.

Microservices.io mendeskripsikan ACL sebagai layer yang menerjemahkan antara dua domain model, terutama untuk mencegah model legacy mencemari service baru. Microsoft Azure architecture guidance juga menjelaskan ACL sebagai adapter yang menerjemahkan request antar sistem dalam konteks modernisasi/strangler migration. 

### 7.2 Contoh Masalah

Sistem legacy punya status:

```text
A = Active
P = Pending
S = Suspended
X = Cancelled
9 = Unknown/Manual Override
```

Sistem baru punya state machine:

```text
DRAFT
SUBMITTED
UNDER_REVIEW
APPROVED
REJECTED
WITHDRAWN
SUSPENDED
REVOKED
```

Jika code internal langsung memakai status legacy:

```java
if (legacyRecord.status().equals("9")) {
    // ???
}
```

Maka legacy semantics bocor ke domain baru.

ACL membuat translasi eksplisit:

```java
public final class LegacyLicenceTranslator {
    public LicenceSnapshot translate(LegacyLicenceRecord record) {
        LicenceLifecycleState state = switch (record.status()) {
            case "A" -> LicenceLifecycleState.APPROVED;
            case "P" -> LicenceLifecycleState.UNDER_REVIEW;
            case "S" -> LicenceLifecycleState.SUSPENDED;
            case "X" -> LicenceLifecycleState.REVOKED;
            case "9" -> LicenceLifecycleState.REQUIRES_MANUAL_RECONCILIATION;
            default -> throw new UnknownLegacyStatusException(record.status());
        };

        return new LicenceSnapshot(record.licenceNo(), state, record.lastUpdatedAt());
    }
}
```

### 7.3 ACL Is Not Just a Mapper

ACL bukan hanya DTO mapper.

ACL bisa mencakup:

```text
- Semantic translation
- Status/state mapping
- Unit conversion
- Date/time normalization
- Identity reconciliation
- Error translation
- Protocol conversion
- Consistency compensation
- Audit evidence mapping
- Data quality validation
- Defaulting policy
- Backward compatibility handling
```

### 7.4 ACL Placement

Ada beberapa pilihan placement:

#### Option A — In-process ACL

```text
Service A -> ACL package -> Legacy client
```

Cocok jika:

```text
- Consumer sedikit.
- Latency harus rendah.
- Translation spesifik untuk service tersebut.
```

#### Option B — Dedicated ACL service

```text
Service A/B/C -> Legacy ACL Service -> Legacy system
```

Cocok jika:

```text
- Banyak consumer.
- Legacy integration rumit.
- Perlu caching, rate limit, audit, reconciliation terpusat.
```

Risiko:

```text
- ACL service menjadi bottleneck.
- ACL service menjadi mini-monolith.
- Domain ownership menjadi kabur.
```

#### Option C — Gateway-level ACL

```text
External clients -> Gateway -> New/legacy systems
```

Cocok untuk migration/strangler.

Namun jangan taruh business translation terlalu dalam di edge gateway jika logic-nya domain-heavy.

### 7.5 ACL Checklist

ACL yang baik menjawab:

```text
- Model eksternal mana yang tidak boleh bocor?
- Field mana yang semantically ambiguous?
- Status mana yang tidak punya mapping 1:1?
- Apa yang terjadi jika external enum menambah value baru?
- Apakah timestamp timezone jelas?
- Apakah identifier remote stable?
- Apakah null/missing/empty dibedakan?
- Apakah error remote diterjemahkan ke local error taxonomy?
- Apakah audit menyimpan raw external evidence secara aman?
- Apakah mapping punya contract test dan golden fixture?
```

---

## 8. Pattern 4 — Protocol Bridge

### 8.1 Definisi

Protocol Bridge menerjemahkan antara protocol komunikasi berbeda.

Contoh:

```text
REST -> gRPC
SOAP -> REST
HTTP callback -> message queue
file drop -> HTTP API
gRPC stream -> Kafka topic
internal gRPC -> external REST
```

Protocol bridge diperlukan ketika:

```text
- Client tidak mendukung protocol internal.
- Legacy system hanya punya SOAP/file transfer.
- External party hanya bisa webhook.
- Internal service ingin gRPC tapi public API tetap REST.
- Streaming internal perlu diekspos sebagai polling/SSE.
```

### 8.2 Protocol Bridge Bukan Sekadar Format Conversion

Buruk:

```text
HTTP JSON -> Protobuf -> call gRPC -> return JSON
```

Jika hanya melakukan format conversion tanpa semantic translation, bridge mudah rusak.

Protocol berbeda punya semantics berbeda:

| Concern | REST/HTTP | gRPC | Messaging |
|---|---|---|---|
| Error | HTTP status + body | gRPC status + trailers | ack/nack/dead-letter |
| Timeout | client/proxy/request timeout | deadline | visibility timeout / consumer timeout |
| Retry | method/idempotency/status | service config/status | redelivery semantics |
| Streaming | SSE/chunked/WebSocket | native streaming | event stream/topic |
| Identity | headers/token/cookie | metadata/channel credentials | message headers |
| Observability | HTTP spans | RPC spans | producer/consumer spans |

Bridge harus menerjemahkan semantics, bukan hanya bytes.

### 8.3 REST-to-gRPC Bridge

Example:

```text
External REST API
POST /cases/{id}/submit
  -> internal gRPC CaseWorkflowService.SubmitCase
```

Mapping:

| REST | gRPC |
|---|---|
| HTTP path/body | Protobuf request |
| Authorization header | gRPC metadata |
| X-Correlation-Id | gRPC metadata/context |
| 200/202/409/422/503 | OK/FAILED_PRECONDITION/INVALID_ARGUMENT/UNAVAILABLE |
| Problem Details | Error details/trailers |
| HTTP timeout | gRPC deadline |

Java bridge controller:

```java
@PostMapping("/cases/{caseId}/submit")
public ResponseEntity<?> submit(
        @PathVariable String caseId,
        @RequestBody SubmitCaseHttpRequest body,
        HttpServletRequest servletRequest
) {
    RequestContext context = RequestContext.from(servletRequest);

    SubmitCaseRequest grpcRequest = SubmitCaseRequest.newBuilder()
            .setCaseId(caseId)
            .setSubmittedBy(context.userId())
            .setReason(body.reason())
            .build();

    try {
        SubmitCaseResponse grpcResponse = caseWorkflowStub
                .withDeadlineAfter(context.remainingMillis(), TimeUnit.MILLISECONDS)
                .withInterceptors(new CorrelationClientInterceptor(context))
                .submitCase(grpcRequest);

        return ResponseEntity.accepted()
                .header("Location", "/cases/" + caseId + "/submission-status")
                .body(toHttpResponse(grpcResponse));
    } catch (StatusRuntimeException e) {
        return GrpcToHttpErrorMapper.toResponse(e, context);
    }
}
```

### 8.4 SOAP-to-REST Bridge

Common in enterprise/government systems.

Bridge concerns:

```text
- XML namespace handling
- SOAP fault mapping
- WS-Security / certificate / signature
- Large XML payload limits
- XXE protection
- Idempotency for retried SOAP calls
- Legacy status code mapping
- Audit evidence preservation
```

Do not let SOAP generated classes spread into domain modules.

### 8.5 File-to-API Bridge

Some agencies or legacy systems exchange files.

```text
Remote SFTP folder -> file ingestion bridge -> validation -> internal API/event
```

Bridge responsibilities:

```text
- File discovery
- Atomic pickup / lock / rename
- Idempotent file processing
- Checksum validation
- Schema validation
- Poison file quarantine
- Replay support
- Audit record
- Backpressure/rate limit toward internal API
```

### 8.6 Bridge Risk

Protocol bridge can become dangerous if it becomes:

```text
- Hidden orchestrator
- Unowned business logic hub
- Silent error swallowing layer
- Performance bottleneck
- Security blind spot
- Contract dumping ground
```

Rule:

```text
A protocol bridge may translate transport semantics.
It should not become the owner of business truth unless explicitly designed as such.
```

---

## 9. Pattern 5 — Backend for Frontend / Experience API

### 9.1 Definisi

Backend-for-Frontend atau BFF membuat backend khusus untuk kebutuhan frontend/client tertentu.

Microsoft Azure Architecture Center menjelaskan BFF sebagai pattern untuk memisahkan backend berdasarkan frontend/interface agar tidak ada satu backend general-purpose yang harus melayani semua variasi client. API gateway pattern juga sering dibandingkan dengan direct client-to-microservice communication; Microsoft memperingatkan bahwa gateway tunggal yang mengagregasi semua microservice bisa berubah menjadi monolithic orchestrator jika tidak dibatasi oleh boundary.

### 9.2 Kapan BFF Cocok

Gunakan BFF jika:

```text
- Web, mobile, internal admin, dan partner API punya kebutuhan response berbeda.
- Frontend membutuhkan aggregation dari banyak service.
- Security/session/cookie model khusus client tertentu.
- UI performance perlu mengurangi chatter.
- Client tidak boleh tahu topology internal.
```

Contoh:

```text
Admin Portal BFF
  -> Case Service
  -> User Profile Service
  -> Document Service
  -> Notification Service
```

Endpoint:

```text
GET /admin/cases/{caseId}/overview
```

Response sudah tailored untuk screen.

### 9.3 Bahaya BFF

BFF buruk jika:

```text
- Semua business logic dipindahkan ke BFF.
- BFF menjadi orchestrator transaksi lintas domain.
- BFF mengabaikan domain API dan langsung akses database service lain.
- BFF punya retry agresif ke banyak service.
- BFF tidak punya ownership jelas.
```

BFF harus memahami UI experience, bukan mengambil alih domain ownership.

### 9.4 Java Implementation Shape

```text
Controller -> Application Query Handler -> Service Clients -> View Model Assembler
```

Example:

```java
public CaseOverviewView getCaseOverview(CaseId caseId, RequestContext context) {
    CaseSummary caseSummary = caseClient.getSummary(caseId, context);
    ApplicantProfile applicant = applicantClient.getProfile(caseSummary.applicantId(), context);
    List<DocumentSummary> documents = documentClient.listCaseDocuments(caseId, context);

    return CaseOverviewViewAssembler.assemble(caseSummary, applicant, documents);
}
```

Key design:

```text
- Deadline must be shared across fan-out.
- Partial failure policy must be explicit.
- Aggregated endpoint must expose degraded sections clearly.
- BFF should use bulkheads per downstream.
- BFF should avoid fan-out explosion.
```

### 9.5 Partial Failure Model

For read-only UI:

```json
{
  "case": { "id": "C-123", "status": "UNDER_REVIEW" },
  "applicant": { "name": "..." },
  "documents": {
    "status": "UNAVAILABLE",
    "message": "Documents are temporarily unavailable"
  }
}
```

For command operation:

```text
Do not silently partially succeed unless command is explicitly modeled as async workflow.
```

---

## 10. Pattern 6 — API Gateway / Edge Gateway

### 10.1 Responsibility

API Gateway/Edge Gateway is often used for:

```text
- Routing
- TLS termination
- Authentication at edge
- Rate limiting
- Request size limits
- WAF integration
- Header normalization
- API version routing
- Client-specific routing
- Protocol termination
- Observability at ingress
```

Microservices.io describes API Gateway as a single entry point that can route requests or fan out to multiple services. Microsoft’s microservices guidance cautions that a gateway aggregating all internal microservices can become a monolithic orchestrator and should be separated by business/client boundaries.

### 10.2 What Gateway Should Not Own

Avoid putting deep domain logic in generic gateway.

Gateway should not become:

```text
- Business workflow engine
- Central database-access layer
- Cross-domain transaction manager
- God aggregator
- Hidden policy engine with no tests
```

### 10.3 Gateway vs BFF vs Service

| Component | Owns | Should Avoid |
|---|---|---|
| Edge Gateway | Edge concerns, routing, auth, limits | Deep business logic |
| BFF | Client experience aggregation | Domain truth |
| Domain Service | Business capability | UI-specific view shaping |
| Integration Gateway | External system boundary | Becoming unbounded orchestration hub |

### 10.4 Gateway Policy Examples

```text
- Reject request body > 10 MB unless upload endpoint.
- Normalize and validate forwarded headers only from trusted proxies.
- Enforce auth token presence.
- Rate-limit by client/app/tenant.
- Add trace headers if missing.
- Strip dangerous hop-by-hop headers.
- Route /v1 and /v2 separately.
- Enforce timeout lower than client patience and higher than downstream budget only if designed.
```

### 10.5 Gateway and Java Services

Java services behind gateway must still enforce:

```text
- Authorization
- Payload validation
- Domain invariants
- Idempotency
- Timeout/deadline
- Audit
```

Gateway security is not a replacement for service security.

---

## 11. Pattern 7 — Sidecar / Service Mesh Boundary

### 11.1 What Sidecar/Mesh Does

Service mesh sidecar, commonly Envoy-based in many platforms, may handle:

```text
- mTLS between services
- Traffic routing
- Retry
- Timeout
- Circuit breaking
- Load balancing
- Telemetry
- Access logs
- Policy enforcement
```

From Java service perspective:

```text
Java app -> localhost sidecar -> network -> remote sidecar -> remote app
```

### 11.2 Benefits

```text
- Uniform mTLS without every app owning certificates directly.
- Central traffic policy.
- Consistent telemetry.
- Gradual rollout/canary routing.
- Cross-language standardization.
```

### 11.3 Risks

```text
- Retry duplicated between Java client and mesh.
- Timeout duplicated or conflicting.
- gRPC/HTTP2 behavior changed by proxy.
- Localhost call looks healthy while remote sidecar path fails.
- Observability split between app span and proxy span.
- Debugging becomes multi-layer.
```

### 11.4 Golden Rule

```text
Only one layer should own a specific resilience decision unless explicitly coordinated.
```

Example bad layering:

```text
Java client: 3 retries
Mesh:        3 retries
Gateway:     2 retries
Total worst-case attempts = 3 * 3 * 2 = 18
```

Better:

```text
Java client owns idempotency-aware retry.
Mesh owns connection-level failover for safe transient failures only.
Gateway does not retry commands.
```

### 11.5 Java Design with Mesh

Java app should still:

```text
- Set deadlines.
- Propagate trace/correlation context.
- Use idempotency keys for commands.
- Emit application-level metrics.
- Handle remote errors semantically.
- Expose readiness/liveness correctly.
```

Mesh cannot know business semantics.

---

## 12. Pattern 8 — Outbox/Inbox Bridge

### 12.1 Problem

A synchronous network call inside a local transaction creates ambiguity:

```text
1. Save case approval in DB.
2. Call notification service.
3. Call audit service.
4. Call external agency.
```

If step 3 times out, what is the truth?

If transaction rolls back after external agency accepted request, what happens?

### 12.2 Outbox Pattern

Outbox stores intended external effects in the same local transaction as domain state.

```text
DB transaction:
  - update case state
  - insert outbox event

Async publisher:
  - reads outbox
  - sends event/call
  - marks delivered
```

### 12.3 Java Shape

```java
@Transactional
public void approveCase(CaseId caseId, OfficerId officerId) {
    CaseAggregate aggregate = repository.load(caseId);
    aggregate.approve(officerId);

    repository.save(aggregate);

    outboxRepository.insert(OutboxMessage.of(
            "CaseApproved",
            aggregate.id().value(),
            aggregate.version(),
            aggregate.toEventPayload()
    ));
}
```

Publisher:

```java
public void publishBatch() {
    List<OutboxMessage> messages = outboxRepository.lockNextBatch(100);

    for (OutboxMessage message : messages) {
        try {
            externalPublisher.publish(message);
            outboxRepository.markPublished(message.id());
        } catch (TemporaryRemoteException e) {
            outboxRepository.scheduleRetry(message.id(), backoff.nextDelay(message.attempt()));
        } catch (PermanentRemoteException e) {
            outboxRepository.markFailed(message.id(), e.reason());
        }
    }
}
```

### 12.4 Inbox Pattern

Inbox deduplicates inbound messages/callbacks.

```text
Receive message/callback
  -> check inbox by messageId/idempotencyKey
  -> if already processed, return success
  -> process in transaction
  -> mark processed
```

### 12.5 When to Use

Use outbox/inbox if:

```text
- Side effect must be reliable.
- Remote call cannot be part of local transaction.
- Retry may happen later.
- Duplicate delivery must be tolerated.
- Audit trail matters.
```

Avoid if:

```text
- Operation truly requires immediate synchronous result.
- Added eventual consistency is unacceptable.
- Team cannot operate background delivery/reconciliation.
```

---

## 13. Pattern 9 — Webhook Adapter

### 13.1 Webhook Is Reverse Integration

Webhook means external system calls you.

```text
External partner -> your webhook endpoint -> validation -> inbox -> domain handling
```

Webhook must not be handled like normal UI request.

### 13.2 Responsibilities

```text
- Authenticate caller
- Verify signature
- Validate timestamp/replay window
- Enforce payload size
- Store raw event safely if needed
- Deduplicate event id
- Acknowledge quickly
- Process asynchronously when possible
- Provide replay/reconciliation mechanism
```

### 13.3 Java Shape

```java
@PostMapping("/webhooks/payment-provider")
public ResponseEntity<Void> receive(
        @RequestHeader("X-Signature") String signature,
        @RequestHeader("X-Timestamp") String timestamp,
        @RequestBody byte[] body
) {
    webhookVerifier.verify(signature, timestamp, body);

    WebhookEnvelope envelope = parser.parse(body);

    inboxService.recordIfNew(
            envelope.eventId(),
            envelope.eventType(),
            body
    );

    return ResponseEntity.accepted().build();
}
```

Process later:

```java
public void processWebhook(WebhookEvent event) {
    switch (event.type()) {
        case "payment.completed" -> paymentHandler.handleCompleted(event);
        case "payment.failed" -> paymentHandler.handleFailed(event);
        default -> event.markIgnored("Unknown event type");
    }
}
```

### 13.4 Common Mistake

Do not do this:

```text
Webhook request thread -> complex domain workflow -> multiple remote calls -> slow response
```

Better:

```text
Webhook request -> verify -> persist inbox -> ack -> async processing
```

---

## 14. Pattern 10 — File/Data Transfer Gateway

### 14.1 Why Separate File Transfer

Large payload/data transfer has different constraints than normal API:

```text
- Long duration
- Large memory risk
- Malware scan
- Resume/retry
- Checksum
- Storage lifecycle
- Audit evidence
- Access control
- Slow client
```

Do not mix file transfer logic into normal domain service casually.

### 14.2 Data Plane vs Control Plane

Better architecture:

```text
Client -> Control API: request upload session
Client -> Object storage / file gateway: upload bytes
Gateway -> scan/validate/checksum
Client -> Control API: commit upload
Domain service -> references immutable object id
```

Control plane:

```text
- create session
- authorize upload
- track metadata
- commit/reject
- expose status
```

Data plane:

```text
- stream bytes
- store file
- verify checksum
- scan
- enforce size/type
```

### 14.3 Java Service Role

Java domain service should avoid becoming accidental file proxy if object storage/gateway can handle data plane.

If Java must stream:

```text
- Never buffer full file in heap.
- Enforce size before and during read.
- Use temp file or streaming pipe.
- Track progress and cancellation.
- Separate pool/bulkhead for large transfer endpoints.
```

---

## 15. Pattern 11 — Integration Platform Module

### 15.1 Definition

For large enterprise/regulatory systems, integrations often become their own platform module:

```text
integration-core
integration-http
integration-grpc
integration-security
integration-observability
integration-testkit
```

This is not a generic “utility module”.

It encodes approved communication policies.

### 15.2 What It Provides

```text
- Standard RequestContext
- Correlation/trace propagation
- Deadline model
- Standard timeout policy
- Retry/backoff/idempotency helpers
- Circuit breaker/bulkhead wrappers
- HTTP/gRPC client factory
- Error taxonomy
- Secure logging filters
- Metrics/tracing decorators
- Test fake helpers
- Contract test harness
```

### 15.3 Example Package Structure

```text
com.example.platform.integration
  ├── context
  │   ├── RequestContext
  │   ├── Deadline
  │   └── CorrelationIds
  ├── policy
  │   ├── RemoteCallPolicy
  │   ├── RetryPolicy
  │   ├── TimeoutPolicy
  │   └── IdempotencyPolicy
  ├── http
  │   ├── HttpClientFactory
  │   ├── HttpRequestExecutor
  │   └── ProblemDetailsMapper
  ├── grpc
  │   ├── GrpcChannelFactory
  │   ├── GrpcDeadlineInterceptor
  │   └── GrpcErrorMapper
  ├── security
  │   ├── TokenProvider
  │   ├── MtlsConfig
  │   └── HeaderSanitizer
  ├── observability
  │   ├── RemoteCallMetrics
  │   ├── RemoteCallLogger
  │   └── TracePropagator
  └── testkit
      ├── FakeRemoteServer
      ├── FailureScenario
      └── GoldenContractFixture
```

### 15.4 Governance Risk

Shared integration platform can become harmful if:

```text
- It becomes too abstract.
- It hides important behavior.
- It forces one policy for all dependencies.
- It is hard to upgrade.
- It makes debugging harder.
- It introduces dependency hell.
```

Design principle:

```text
Standardize the invariants.
Parameterize the dependency-specific policies.
Do not abstract away semantics.
```

---

## 16. Pattern 12 — Governance for Shared Client Libraries

### 16.1 Why Governance Matters

A client library is production infrastructure.

If broken, every service using it can fail.

Governance needs:

```text
- Ownership
- Versioning
- Compatibility policy
- Release notes
- Security patch path
- Deprecation policy
- Observability contract
- Test matrix
- Sample usage
```

### 16.2 Library Compatibility Rules

For a shared Java client:

```text
- Minor version must not change default retry behavior unexpectedly.
- Minor version must not change timeout defaults unexpectedly.
- Minor version must not change error mapping in breaking ways.
- Metrics names should remain stable or migration must be documented.
- Public DTO changes must preserve binary/source compatibility where possible.
- New enum values must be handled by consumers safely.
```

### 16.3 Operational Contract

Every official client should document:

```text
- Which operations are safe to retry.
- Which operations require idempotency key.
- Default timeout and max attempts.
- Connection/channel lifecycle expectations.
- Metrics emitted.
- Logs emitted.
- Trace propagation behavior.
- Authentication mechanism.
- Threading/executor model.
- Shutdown requirements.
```

For gRPC, official performance guidance recommends reusing stubs and channels where possible; in Java architecture, this should become a documented rule in the client library rather than a tribal-memory detail.

---

## 17. Choosing the Right Pattern

### 17.1 Decision Matrix

| Situation | Recommended Pattern |
|---|---|
| Many Java services call same stable internal API | Typed API Client SDK |
| One bounded context talks to external provider | Gateway Adapter |
| Legacy/external model must not pollute internal model | Anti-Corruption Layer |
| Need REST public API over internal gRPC | Protocol Bridge |
| UI needs screen-specific aggregation | BFF / Experience API |
| Need edge routing/auth/rate limit | API Gateway |
| Need platform-level mTLS/traffic policy | Service Mesh/Sidecar |
| Need reliable side effects after DB transaction | Outbox/Inbox Bridge |
| External system calls you asynchronously | Webhook Adapter |
| Large file payload | File/Data Transfer Gateway |
| Many teams need standard network policy | Integration Platform Module |

### 17.2 Three Diagnostic Questions

Ask these before choosing a pattern:

```text
1. Is this boundary primarily technical, domain, experience, or platform?
2. Who owns the semantic contract?
3. What failure mode must be contained here?
```

Examples:

```text
External address lookup:
- Boundary: domain integration
- Owner: consuming bounded context + provider contract
- Failure contained by: Gateway Adapter + cache + rate limit
```

```text
Public mobile API aggregation:
- Boundary: client experience
- Owner: mobile/web platform team
- Failure contained by: BFF partial response and deadline fan-out
```

```text
Legacy status migration:
- Boundary: domain model mismatch
- Owner: modernization team/domain owner
- Failure contained by: ACL with explicit unknown-state handling
```

---

## 18. Architecture Smells

### 18.1 HTTP Calls from Entities/Aggregates

Bad:

```java
public class CaseAggregate {
    public void approve() {
        remoteAuditClient.call(...);
    }
}
```

Aggregate should not own network I/O.

### 18.2 DTO Leakage

Bad:

```java
ExternalMyInfoResponse response = service.getApplicantData(...);
caseAggregate.apply(response);
```

External DTO should be translated.

### 18.3 No Deadline Propagation

Bad:

```text
Inbound request timeout: 5 seconds
Downstream A timeout: 10 seconds
Downstream B timeout: 10 seconds
```

### 18.4 Shared Client Without Shutdown/Lifecycle Rule

Bad:

```text
Every request creates a new HTTP client/channel.
```

### 18.5 Gateway as God Orchestrator

Bad:

```text
Gateway owns approval workflow, payment workflow, notification workflow, case status transition.
```

### 18.6 Mesh Retry + App Retry + Gateway Retry

Bad:

```text
Retry policy exists in three places and nobody can compute max attempts.
```

### 18.7 ACL Without Unknown Handling

Bad:

```java
return switch (externalStatus) {
    case "A" -> ACTIVE;
    case "P" -> PENDING;
    default -> ACTIVE;
};
```

Unknown external values must not silently map to valid internal states.

---

## 19. Production-Grade Remote Boundary Template

For every remote dependency, document:

```text
Dependency name:
Owner:
Protocol:
Transport:
Authentication:
Authorization model:
Data classification:
Operations:
Side-effect operations:
Idempotency support:
Timeout budget:
Retry policy:
Rate limit:
Circuit breaker/bulkhead:
Connection/channel lifecycle:
Error taxonomy:
Fallback/degradation:
Schema/versioning:
Observability:
Audit evidence:
Test strategy:
Runbook:
```

Example:

```text
Dependency name: Address Provider
Owner: External map provider / Integration team
Protocol: HTTPS JSON REST
Authentication: Bearer token from SSM/secret store
Operations: Search by postal code
Side effects: None
Timeout budget: 800 ms within 2s UI budget
Retry: 1 retry on 401 after token refresh, 1 retry on 429/503 with jitter if deadline allows
Rate limit: 250/min worker pool below provider 300/min limit
Fallback: Cached exact postal result if fresh
Observability: dependency=address-provider, operation=searchPostalCode
Audit: store resolved address source and timestamp, not full token/header
Test: fake server, rate-limit test, malformed response test, token expiry test
Runbook: check provider status, Redis token, 429 count, latency p95/p99
```

---

## 20. Case Study — Regulatory Case Management Integration Architecture

### 20.1 Context

System has modules:

```text
Application Management
Case Management
Compliance
Appeal
Document
Correspondence
Survey
Payment/Revenue
External identity provider
External address provider
External notification provider
External agency data exchange
```

Naive architecture:

```text
Every module directly calls every external/internal service.
```

Result:

```text
- Many duplicated clients.
- No consistent timeout.
- Status mapping duplicated.
- Audit evidence inconsistent.
- Incidents hard to triage.
```

### 20.2 Improved Architecture

```text
UI / Portal
  -> BFF / Experience API
      -> Case Service
      -> Document Service
      -> Profile Service
      -> Correspondence Service

Case Service
  -> IdentityVerificationGateway
      -> Identity Provider SDK
  -> AddressResolutionGateway
      -> Address Provider SDK
  -> Outbox
      -> Notification Publisher
      -> External Agency Submission Publisher

Integration Platform
  -> HTTP/gRPC client factories
  -> Remote call policy
  -> Observability
  -> Security/token management
  -> Testkit

External Legacy ACL Service
  -> Legacy licence database/API
```

### 20.3 Important Boundaries

```text
- BFF shapes UI responses, not domain truth.
- Case Service owns case lifecycle.
- Gateway adapters translate external provider semantics.
- ACL protects domain from legacy status model.
- Outbox handles reliable external side effects.
- Integration platform standardizes network mechanics.
- API gateway handles edge concerns.
```

### 20.4 Example Request Path

Officer approves case:

```text
1. Browser sends POST /cases/{id}/approve to BFF/API.
2. API validates token and forwards command to Case Service.
3. Case Service checks case state machine.
4. Case Service updates DB and inserts outbox event in one transaction.
5. Response returns 202/200 depending workflow.
6. Outbox worker sends notification and external agency update.
7. If external update fails, retry/reconciliation happens independently.
8. Audit trail links approval decision, outbox message, and delivery attempts.
```

This is more robust than doing all remote calls inside approval request transaction.

---

## 21. Java 8–25 Considerations

### Java 8

Common stack:

```text
- Apache HttpClient / OkHttp
- CompletableFuture limited but available
- Hystrix/Resilience4j depending era
- Servlet blocking model
- gRPC Java supported
```

Architecture impact:

```text
- Be explicit with thread pools.
- Avoid creating too many blocking integrations without bulkheads.
- Use mature clients for pooling/timeouts.
```

### Java 11+

JDK `HttpClient` becomes available as standard modern client supporting HTTP/1.1 and HTTP/2.

Architecture impact:

```text
- Good baseline for simple-to-moderate HTTP integrations.
- Still wrap it in SDK/gateway adapter for policy/semantics.
```

### Java 17/21/25

Modern Java introduces virtual threads, structured concurrency previews/incubation path, scoped values, and better concurrency ergonomics.

Architecture impact:

```text
- BFF fan-out can be written more directly with virtual threads/structured concurrency.
- Blocking integration code becomes simpler.
- Capacity limits still require bulkheads, deadlines, and pool limits.
- Context propagation needs deliberate design.
```

Virtual threads do not remove the need for architecture boundaries.

They make it easier to write readable blocking code, but external dependency semantics remain unchanged.

---

## 22. Observability Contract for Architecture Patterns

Every pattern must emit consistent telemetry.

### 22.1 For SDK/Gateway Adapter

```text
metric: remote.client.requests
labels:
  dependency
  operation
  protocol
  outcome
  status_class
  error_type
  retry_attempt
  idempotent
```

### 22.2 For BFF

```text
metric: bff.downstream.fanout
labels:
  screen
  downstream
  partial_failure
```

### 22.3 For Protocol Bridge

```text
metric: protocol_bridge.translation
labels:
  source_protocol
  target_protocol
  source_operation
  target_operation
  translation_outcome
```

### 22.4 For Outbox

```text
metric: outbox.delivery
labels:
  event_type
  destination
  attempt
  outcome
```

OpenTelemetry semantic conventions provide common attributes for HTTP and RPC/gRPC spans, which helps avoid every team inventing incompatible telemetry vocabulary. For streaming RPC, OpenTelemetry RPC span guidance covers the full lifetime of the request/response stream until closure or termination.

---

## 23. Testing Architecture Patterns

### 23.1 SDK Tests

```text
- request construction
- response mapping
- error mapping
- timeout/retry behavior
- auth header injection
- trace propagation
- malformed payload
- unknown enum value
- large response limit
```

### 23.2 Gateway Adapter Tests

```text
- external-to-domain translation
- provider unavailable
- provider inconsistent response
- provider returns duplicate records
- cache fallback
- audit evidence generation
```

### 23.3 ACL Tests

```text
- golden fixtures from legacy system
- unknown status handling
- null/missing field semantics
- timezone conversion
- identity reconciliation
```

### 23.4 Protocol Bridge Tests

```text
- HTTP status <-> gRPC status mapping
- deadline propagation
- metadata/header propagation
- streaming cancellation
- retry/idempotency preservation
```

### 23.5 BFF Tests

```text
- fan-out deadline
- partial failure policy
- response shaping
- no domain state mutation in BFF
```

### 23.6 Outbox/Inbox Tests

```text
- transaction inserts outbox
- duplicate message ignored
- retry schedule
- poison message handling
- reconciliation query
```

---

## 24. Design Heuristics

### 24.1 Keep Mechanics Out of Domain

Domain should say:

```java
identityVerificationGateway.verify(identity, context);
```

not:

```java
httpClient.send(...);
```

### 24.2 Keep Semantics Out of Generic Infrastructure

Generic HTTP executor should not decide:

```text
409 means applicant cannot resubmit.
```

That belongs in gateway/adapter/domain boundary.

### 24.3 Separate Technical Retry from Business Retry

Technical retry:

```text
connection reset before request processed
```

Business retry:

```text
officer resubmits application after validation failure
```

Do not confuse them.

### 24.4 Prefer Explicit Boundary Names

Good:

```text
IdentityVerificationGateway
LicenceRegistryAcl
CaseWorkflowGrpcBridge
DocumentTransferGateway
```

Weak:

```text
HttpUtil
RestClient
ExternalServiceHelper
CommonIntegrationService
```

Names should reveal boundary purpose.

### 24.5 Design for Unknown Remote Behavior

Always assume:

```text
- Remote enum can add value.
- Remote 500 can hide partial success.
- Remote timeout can happen after side effect.
- Remote docs can be wrong.
- Remote payload can be too large.
- Remote dependency can rate-limit.
- Remote certificate can rotate.
```

---

## 25. Exercises

### Exercise 1 — Identify Pattern

Given this requirement:

```text
Mobile app needs one endpoint that returns user profile, active licence, pending applications, and unread notifications.
```

Choose pattern and justify:

```text
- Direct service calls from mobile?
- API Gateway?
- BFF?
- Shared SDK?
```

Expected direction:

```text
BFF/Experience API, possibly behind API Gateway.
```

### Exercise 2 — Gateway Adapter Design

Design an `AddressResolutionGateway` for an external address API with:

```text
- 300 requests/min provider limit
- token expiration
- postal-code exact cache
- ambiguous result
- provider 429/503
- audit evidence
```

Define:

```text
- interface
- error taxonomy
- timeout/retry policy
- cache policy
- metrics
- tests
```

### Exercise 3 — ACL Mapping

Legacy statuses:

```text
A, P, S, X, 9, null
```

Internal states:

```text
ACTIVE, PENDING_REVIEW, SUSPENDED, REVOKED, REQUIRES_RECONCILIATION
```

Write mapping and define what happens for unknown values.

### Exercise 4 — REST-to-gRPC Bridge

Map:

```text
POST /cases/{caseId}/approve
```

to:

```proto
rpc ApproveCase(ApproveCaseRequest) returns (ApproveCaseResponse);
```

Define:

```text
- HTTP status mapping
- gRPC status mapping
- deadline propagation
- error response
- idempotency key
- trace propagation
```

### Exercise 5 — Outbox Decision

For each operation, decide sync call vs outbox:

```text
- Validate postal code
- Send approval email
- Submit final decision to external agency
- Fetch applicant profile
- Generate audit event
```

Explain consistency and retry implications.

---

## 26. Summary

Architecture patterns are not decorative.

They decide where network complexity lives.

A strong Java network architecture does not let every module make remote calls freely. It creates explicit boundaries:

```text
- SDK for reusable typed remote clients.
- Gateway Adapter for domain-facing integration.
- ACL for semantic protection from legacy/external models.
- Protocol Bridge for transport/semantic translation.
- BFF for client-experience aggregation.
- API Gateway for edge concerns.
- Sidecar/Mesh for platform traffic policy.
- Outbox/Inbox for reliable asynchronous side effects.
- Webhook Adapter for inbound external events.
- File/Data Gateway for large payload data plane.
- Integration Platform for shared mechanics and governance.
```

The top-tier mental model is:

```text
A remote dependency is not just a URL.
It is an owned boundary with semantics, failure modes, policies, evidence, and lifecycle.
```

If you can name the boundary, define its ownership, constrain its failure modes, test its contract, and observe its behavior, then your Java network architecture becomes maintainable under scale, regulation, and production pressure.

---

## 27. References

- Microsoft Azure Architecture Center — Backends for Frontends pattern.
- Microsoft .NET Microservices Architecture guidance — API Gateway pattern vs direct client-to-microservice communication.
- Microsoft Azure Architecture Center — Strangler Fig pattern and Anti-Corruption Layer discussion.
- Microservices.io — API Gateway / Backends for Frontends pattern.
- Microservices.io — Anti-corruption layer pattern.
- gRPC documentation — Performance best practices and channel/stub reuse guidance.
- OpenTelemetry Semantic Conventions — HTTP, RPC, and gRPC spans/metrics.
- Java SE 25 Documentation — `java.net.http.HttpClient`.

---

## 28. Status Seri

```text
Part 34 of 35 selesai.
Seri belum selesai.
Part berikutnya: Part 35 — Capstone: Building a Production-Grade Java Network Client and Service Platform
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 33 — Production Failure Catalogue: Diagnosing Real Incidents](./033-production-failure-catalogue-diagnosing-real-incidents.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 35 — Capstone: Building a Production-Grade Java Network Client and Service Platform](./035-capstone-production-grade-java-network-client-and-service-platform.md)
