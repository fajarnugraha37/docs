# Part 33 — Case Study: Internal Microservice Client at Scale

> Series: `learn-java-http-client-okhttp-retrofit-client-engineering`  
> File: `33-case-study-internal-microservice-client-at-scale.md`  
> Target: Java 8 hingga Java 25  
> Fokus: production-grade internal service-to-service HTTP client pada sistem microservice berskala besar

---

## 1. Posisi Part Ini dalam Series

Pada Part 32, kita membangun **third-party API client**. Fokusnya adalah integrasi dengan sistem eksternal yang tidak kita kendalikan: rate limit vendor, kontrak vendor, OAuth2 client credential, idempotency key, error envelope vendor, dan runbook terhadap dependency eksternal.

Pada Part 33 ini, fokusnya bergeser ke **internal microservice client at scale**.

Sekilas, internal client terlihat lebih mudah karena service-nya milik organisasi sendiri. Tetapi di skala besar, internal microservice client sering menjadi lebih rumit daripada third-party client karena:

1. jumlah dependency jauh lebih banyak;
2. latency chain lebih panjang;
3. retry antar-service bisa saling memperkuat;
4. deployment tidak serentak;
5. kontrak sering berubah cepat;
6. observability harus lintas puluhan atau ratusan service;
7. service discovery, DNS, load balancer, service mesh, mTLS, dan tracing ikut memengaruhi behavior client;
8. failure kecil pada satu dependency bisa menjadi cascading failure.

Mental model paling penting:

```text
Internal HTTP client bukan hanya “cara service A call service B”.

Ia adalah boundary antar bounded context, antar deployment unit, antar failure domain,
dan antar tim.
```

Jika third-party client adalah boundary terhadap vendor, internal microservice client adalah boundary terhadap **internal distributed system complexity**.

---

## 2. Case Study Context

Kita akan memakai case study hipotetis tetapi realistis.

Misalkan ada sistem case management regulatory/enterprise dengan beberapa service:

```text
case-service
application-service
profile-service
document-service
notification-service
audit-service
workflow-service
payment-service
search-service
identity-service
```

Salah satu use case:

```text
Officer membuka detail sebuah case.
```

`case-service` perlu mengambil data dari beberapa service:

```text
case-service
  ├─ profile-service       : party / applicant / officer profile
  ├─ document-service      : attached documents metadata
  ├─ workflow-service      : current workflow task/state
  ├─ audit-service         : recent relevant audit entries
  ├─ notification-service  : pending correspondence
  └─ payment-service       : outstanding fee / invoice status
```

Untuk user, ini hanya satu layar. Untuk backend, ini adalah fan-out internal call.

Masalahnya: kalau setiap call dibuat secara naif, kita bisa mendapatkan:

```text
1 request UI
→ 1 case-service call
→ 6 downstream calls
→ masing-masing punya retry 3x
→ setiap downstream juga fan-out lagi
→ traffic amplification
→ latency tail membesar
→ thread/pool terkunci
→ service mesh juga retry
→ cascading failure
```

Top 1% engineer tidak hanya bertanya:

```text
Bagaimana cara call profile-service?
```

Tetapi bertanya:

```text
Apa kontrak dependency ini?
Apa latency budget-nya?
Apa failure policy-nya?
Apa retry semantics-nya?
Apa observability boundary-nya?
Apa efeknya jika 1000 request bersamaan melakukan fan-out?
Apa yang terjadi saat profile-service rolling deployment?
Apa yang terjadi saat DNS/LB/service mesh berubah?
```

---

## 3. Perbedaan Third-Party Client vs Internal Microservice Client

| Aspek | Third-Party API Client | Internal Microservice Client |
|---|---|---|
| Ownership | eksternal | internal / antar tim |
| Contract speed | lambat, formal | cepat, sering berubah |
| Auth | API key/OAuth2/vendor-specific | mTLS, service token, mesh identity, internal JWT |
| Rate limit | vendor-enforced | self-imposed untuk stability |
| Retry risk | membebani vendor | bisa menyebabkan cascading failure internal |
| Observability | terbatas di sisi vendor | harus end-to-end traceable |
| Deployment | vendor tidak ikut pipeline kita | rolling/canary/blue-green internal |
| Version compatibility | mengikuti vendor API | harus dikelola antar service version |
| Failure ownership | eksternal | internal incident ownership |
| SLA/SLO | vendor SLA | internal SLO, dependency SLO, endpoint-level SLO |

Kesalahan umum: memperlakukan internal service sebagai “local module yang kebetulan dipanggil via HTTP”.

Itu keliru.

Internal service tetap remote, unreliable, independently deployed, independently scaled, dan independently failing.

---

## 4. Architectural Goal

Tujuan desain internal microservice client:

```text
Membuat komunikasi antar-service eksplisit, observable, bounded, versioned,
dan aman dari cascading failure.
```

Client yang baik harus menjawab:

1. **Who are we calling?**  
   Service name, endpoint, route, version, tenant/context.

2. **Why are we calling it?**  
   Use case, dependency purpose, criticality.

3. **What is the latency budget?**  
   Per endpoint, bukan global asal.

4. **What happens if it fails?**  
   Fail closed, fail open, degraded response, cached fallback, partial result, atau abort request.

5. **How do we prevent amplification?**  
   Bounded concurrency, retry budget, bulkhead, load shedding.

6. **How do we observe it?**  
   Metrics, logs, traces, correlation ID, span attributes, dependency dashboard.

7. **How do we evolve it?**  
   Versioning, compatibility, generated interface, contract test, deprecation.

---

## 5. Target Architecture

Kita tidak ingin application service langsung menyentuh `OkHttpClient`, `HttpClient`, atau `WebClient` di mana-mana.

Target architecture:

```text
Application Use Case
  ↓
Outbound Port
  ↓
Typed Internal Service Client Interface
  ↓
Client Adapter / Gateway
  ↓
Policy Layer
  - timeout
  - retry
  - rate limit
  - bulkhead
  - circuit breaker
  - tracing
  - metrics
  - auth
  ↓
Transport Engine
  - JDK HttpClient
  - OkHttp
  - Apache HttpClient
  - Spring RestClient/WebClient
  ↓
Service Discovery / DNS / Mesh / Load Balancer
  ↓
Remote Internal Service
```

Contoh package:

```text
com.company.caseapp.casequery
  CaseDetailUseCase.java

com.company.caseapp.profile
  ProfilePort.java
  ProfileClient.java
  ProfileClientConfig.java
  ProfileHttpAdapter.java
  ProfileDto.java
  ProfileMapper.java
  ProfileErrorClassifier.java

com.company.platform.http
  InternalHttpClientFactory.java
  ClientPolicy.java
  DependencyId.java
  HttpClientMetrics.java
  TracePropagation.java
  RedactionPolicy.java
```

Prinsipnya:

```text
Domain/application layer bicara dengan port.
HTTP detail hidup di adapter.
Policy umum hidup di platform/shared infrastructure layer.
```

---

## 6. Dependency Classification

Tidak semua downstream dependency sama.

Kita perlu klasifikasi internal dependency berdasarkan **criticality**.

### 6.1 Critical Dependency

Jika dependency gagal, use case harus gagal.

Contoh:

```text
case-service → workflow-service untuk menentukan current workflow state
```

Jika workflow state tidak tersedia, case detail mungkin tidak boleh ditampilkan karena bisa menyesatkan officer.

Policy:

```text
fail request
short timeout
limited retry jika idempotent
clear error classification
high alert priority
```

### 6.2 Important but Degradable Dependency

Jika dependency gagal, user masih bisa mendapat partial response.

Contoh:

```text
case-service → audit-service untuk recent activity
```

Jika audit recent activity gagal, halaman utama case masih bisa tampil dengan warning.

Policy:

```text
partial response
no aggressive retry
fallback empty section
metric degradation
low/medium alert depending SLO
```

### 6.3 Optional Dependency

Jika dependency gagal, tidak perlu menggagalkan use case.

Contoh:

```text
case-service → recommendation-service untuk suggestion tambahan
```

Policy:

```text
very short timeout
no retry
fallback silently or with low-priority signal
bulkhead isolation
```

### 6.4 Write/Command Dependency

Dependency yang mengubah state.

Contoh:

```text
case-service → notification-service untuk send correspondence
case-service → payment-service untuk create invoice
```

Policy:

```text
idempotency required
retry only with idempotency key or delivery outbox
clear duplicate handling
strong audit
```

---

## 7. Latency Budget untuk Fan-Out

Misalkan UI SLO:

```text
Case detail P95 ≤ 800 ms
```

Budget kasar:

```text
browser/network          100 ms
API gateway              50 ms
case-service own work    150 ms
fan-out downstream       400 ms
serialization/logging    50 ms
margin                   50 ms
```

Jika `case-service` melakukan fan-out paralel, latency total kira-kira:

```text
max(profile, document, workflow, audit, notification, payment) + aggregation overhead
```

Jika sequential, latency total:

```text
profile + document + workflow + audit + notification + payment + aggregation overhead
```

Top-tier rule:

```text
Internal fan-out harus didesain dengan explicit concurrency, timeout, dan criticality policy.
Jangan biarkan call order tumbuh organik tanpa budget.
```

Contoh budget per dependency:

| Dependency | Criticality | Timeout | Retry | Fallback |
|---|---:|---:|---:|---|
| workflow-service | critical | 250 ms | 1 retry if safe | fail case detail |
| profile-service | critical-ish | 250 ms | 1 retry | partial masked profile only if allowed |
| document-service | important | 300 ms | no retry | show document section unavailable |
| audit-service | degradable | 150 ms | no retry | empty recent activity + warning |
| notification-service | optional | 120 ms | no retry | hide notification badge |
| payment-service | important | 250 ms | 1 retry if read-only | show payment unavailable |

---

## 8. Internal Client Interface Design

Jangan expose HTTP detail ke use case.

Buruk:

```java
ResponseEntity<String> response = restTemplate.getForEntity(url, String.class);
if (response.getStatusCodeValue() == 200) { ... }
```

Lebih baik:

```java
public interface ProfilePort {
    ProfileSnapshot getProfile(ProfileId profileId, RequestContext context);
}
```

Atau jika dependency degradable:

```java
public interface AuditPort {
    DependencyResult<List<AuditEntrySummary>> findRecentEntries(CaseId caseId, RequestContext context);
}
```

`DependencyResult` bisa membawa informasi:

```java
public sealed interface DependencyResult<T> permits DependencyResult.Success, DependencyResult.Degraded, DependencyResult.Failed {

    record Success<T>(T value) implements DependencyResult<T> {}

    record Degraded<T>(
        T fallbackValue,
        String dependency,
        String reason,
        boolean userVisible
    ) implements DependencyResult<T> {}

    record Failed<T>(
        String dependency,
        DependencyFailure failure
    ) implements DependencyResult<T> {}
}
```

Untuk Java 8, gunakan class/interface biasa tanpa sealed type.

---

## 9. DTO Boundary dan Version Compatibility

Internal tidak berarti boleh sharing domain object sembarangan.

Buruk:

```text
profile-service domain entity
→ serialized langsung
→ case-service memakai class yang sama
→ perubahan internal profile-service memecahkan consumer
```

Lebih baik:

```text
profile-service API DTO v1
→ profile-client external DTO
→ anti-corruption mapper
→ case-service domain-safe model
```

Contoh DTO:

```java
public final class ProfileResponseV1 {
    public String profileId;
    public String displayName;
    public String status;
    public String type;
    public String updatedAt;
}
```

Domain-safe model:

```java
public record ProfileSnapshot(
    ProfileId id,
    String displayName,
    ProfileStatus status,
    ProfileType type,
    Instant updatedAt
) {}
```

Mapping harus explicit:

```java
public final class ProfileMapper {
    public ProfileSnapshot toDomain(ProfileResponseV1 dto) {
        return new ProfileSnapshot(
            new ProfileId(dto.profileId),
            safeDisplayName(dto.displayName),
            parseStatus(dto.status),
            parseType(dto.type),
            Instant.parse(dto.updatedAt)
        );
    }
}
```

Version compatibility rule:

```text
Producer boleh menambah optional field.
Producer tidak boleh menghapus/mengubah semantic field tanpa versi baru.
Consumer harus toleran terhadap unknown field.
Consumer harus explicit terhadap missing required field.
```

---

## 10. Service Discovery dan Addressing

Internal microservice client biasanya tidak memakai hardcoded IP.

Kemungkinan addressing:

```text
http://profile-service.default.svc.cluster.local
http://profile-service
https://profile-service.internal.company
https://profile-api.company.local
mesh://profile-service
```

Di Kubernetes, service name sering diarahkan oleh DNS ke ClusterIP. Tetapi di production besar, jalur bisa melibatkan:

```text
client pod
→ CoreDNS
→ Kubernetes Service
→ kube-proxy / CNI
→ sidecar proxy
→ service mesh control plane
→ destination pod
```

Atau:

```text
client service
→ internal load balancer
→ target group
→ service pod/node
```

Implication untuk client:

1. DNS failure bisa menyebabkan request failure walaupun service sehat.
2. DNS TTL bisa menyebabkan client lambat mengikuti endpoint change.
3. Connection pool bisa tetap memakai koneksi lama saat deployment/draining.
4. Service mesh bisa menambah retry/timeout sendiri.
5. Load balancer idle timeout bisa memutus connection yang menurut client masih reusable.

Karena itu, client config tidak boleh berdiri sendiri. Ia harus konsisten dengan:

```text
DNS TTL
load balancer idle timeout
service mesh timeout
upstream server timeout
connection pool idle timeout
rolling deployment drain time
```

---

## 11. mTLS, Service Identity, dan Internal Auth

Internal traffic tidak otomatis trusted.

Pilihan identity antar-service:

```text
mTLS via service mesh
mTLS directly in client
internal JWT/service token
OAuth2 client credentials internal IdP
signed request/HMAC
network-level trust only — biasanya terlalu lemah
```

Dalam platform modern, mTLS sering disediakan oleh service mesh. Tetapi application client tetap perlu tahu beberapa hal:

1. Apakah identity di-enforce di mesh atau aplikasi?
2. Apakah service-to-service authorization berbasis workload identity?
3. Apakah header user context boleh dipropagate?
4. Apakah token end-user boleh diteruskan downstream?
5. Apakah token harus ditukar menjadi service token?
6. Apakah audit harus mencatat caller service dan user actor?

Contoh request context:

```java
public record RequestContext(
    String correlationId,
    String traceId,
    String actorUserId,
    String callerService,
    String tenantId,
    Set<String> scopes
) {}
```

Header propagation harus dikontrol:

```text
Allowed:
- traceparent
- tracestate if governed
- x-correlation-id
- x-request-id
- x-actor-id if allowed
- x-caller-service
- idempotency-key for commands

Dangerous if blindly propagated:
- Authorization
- Cookie
- X-Forwarded-For
- internal admin headers
- debug headers
- tenant override headers
```

---

## 12. Service Mesh Interaction

Jika menggunakan service mesh seperti Istio/Linkerd/Consul Connect, client application tidak lagi send request langsung ke remote pod secara murni. Request melewati sidecar/proxy.

```text
application container
→ local sidecar proxy
→ mTLS / routing / retry / timeout / circuit policy
→ remote sidecar proxy
→ remote application container
```

Ini memberi keuntungan:

```text
mTLS standardized
traffic policy centralized
canary routing
observability layer
outlier detection
retry/timeout policy at mesh level
```

Tetapi juga risiko:

```text
application retry + mesh retry = retry amplification
application timeout > mesh timeout = confusing failures
mesh timeout > application timeout = wasted work after caller cancels
mesh circuit breaker + app circuit breaker = difficult diagnosis
sidecar resource saturation = hidden bottleneck
```

Rule:

```text
Jika mesh punya retry/timeout policy, application client harus sadar dan policy-nya harus diselaraskan.
Jangan mendesain retry dua lapis tanpa budget total.
```

Contoh:

```text
Application retry: 1 retry, total deadline 300 ms
Mesh retry: disabled for this route
```

Atau:

```text
Application retry: none
Mesh retry: 1 retry for connection reset only
Application timeout: 300 ms
Mesh timeout: 280 ms
```

Yang penting bukan mana yang benar universal, tetapi **satu ownership model jelas**.

---

## 13. Internal Retry Strategy

Internal retry harus lebih konservatif daripada yang sering diasumsikan.

Mengapa?

Karena internal services sering saling memanggil. Jika semua service retry otomatis, traffic bisa meledak.

Contoh:

```text
A → B retry 2x
B → C retry 2x
C → D retry 2x
```

Satu request A bisa menjadi banyak attempt di D.

Formula kasar:

```text
attempts = product(maxAttempts per layer)
```

Jika tiap layer punya 3 attempts:

```text
A to B: 3
B to C: 3
C to D: 3
Total worst-case toward D: 27 attempts per original request
```

Internal retry policy:

```text
Retry only for clearly transient failure.
Retry only within total deadline.
Retry only if operation is safe/idempotent.
Retry only at one layer if possible.
Retry must emit metric attempt_count.
Retry must respect Retry-After or downstream overload signal.
```

Status yang mungkin retryable:

```text
502 Bad Gateway
503 Service Unavailable
504 Gateway Timeout
429 Too Many Requests — only respecting Retry-After and budget
connection reset before request committed
connect timeout
```

Status yang biasanya tidak retryable:

```text
400 Bad Request
401 Unauthorized
403 Forbidden
404 Not Found — unless eventual consistency explicitly known
409 Conflict — depends on command semantics
422 Validation error
```

---

## 14. Bulkhead dan Concurrency Limit per Dependency

Internal microservice client harus mencegah satu dependency lambat menghabiskan resource caller.

Buruk:

```text
case-service thread pool semua habis menunggu profile-service
akibatnya endpoint lain di case-service ikut down
```

Lebih baik:

```text
profile-service client punya bulkhead sendiri
document-service client punya bulkhead sendiri
audit-service client punya bulkhead sendiri
```

Contoh config:

```yaml
internal-clients:
  profile-service:
    timeout: 250ms
    max-concurrency: 80
    queue-size: 0
    retry-max-attempts: 2
  audit-service:
    timeout: 150ms
    max-concurrency: 20
    queue-size: 0
    retry-max-attempts: 1
  document-service:
    timeout: 300ms
    max-concurrency: 50
    queue-size: 10
    retry-max-attempts: 1
```

Queue size `0` sering lebih aman daripada queue besar untuk request-response path latency-sensitive.

Mengapa?

```text
queue besar menyembunyikan overload
menambah latency tail
membuat caller tetap menerima request yang hampir pasti timeout
meningkatkan memory pressure
```

Untuk request-response interactive path, prefer:

```text
bounded concurrency + fast reject + clear degradation
```

---

## 15. Circuit Breaker untuk Internal Dependency

Circuit breaker internal berguna ketika dependency mengalami failure/slowdown berkelanjutan.

Tetapi circuit breaker harus dikaitkan dengan dependency dan endpoint, bukan asal global.

Buruk:

```text
satu circuit breaker untuk semua call ke profile-service
```

Jika endpoint `/profiles/{id}` bermasalah, endpoint `/profiles/search` ikut terdampak.

Lebih baik:

```text
profile-service.get-profile
profile-service.search-profile
profile-service.batch-get-profile
```

Circuit breaker dimension:

```text
dependency service
operation/endpoint class
criticality
traffic class
```

Half-open probe harus hati-hati. Jangan biarkan ribuan request masuk saat breaker half-open.

Policy:

```text
half-open permitted calls small
probe timeout short
probe endpoint representative
fallback/degrade if still open
emit breaker state metric
```

---

## 16. API Versioning dan Deployment Compatibility

Internal services deploy independently. Maka client harus mendukung compatibility window.

Problem umum:

```text
consumer deploy duluan, expect field baru
producer belum deploy semua pod
sebagian response tidak punya field
consumer error
```

Atau:

```text
producer deploy duluan, hapus field lama
consumer lama masih butuh field
production incident
```

Versioning rules:

1. Additive changes are usually safe.
2. Removing field is breaking.
3. Changing field semantics is breaking even if type same.
4. Changing enum value set can break strict consumer.
5. Required-to-optional and optional-to-required need compatibility review.
6. Error response schema must also be versioned.
7. Pagination semantics must not silently change.

Recommended internal compatibility flow:

```text
Design contract
→ consumer review
→ contract test update
→ producer supports old+new
→ consumer migrates
→ observe adoption
→ deprecate old
→ remove old after agreed window
```

---

## 17. Contract Test Strategy

Internal client at scale needs contract tests.

Types:

```text
Consumer contract test
Producer contract verification
Schema compatibility check
Golden response test
Backward compatibility test
Forward compatibility test
```

Example contract concern:

```text
profile-service GET /internal/v1/profiles/{id}
- returns 200 with profileId, displayName, status, type
- status is one of ACTIVE, SUSPENDED, ARCHIVED, UNKNOWN
- missing displayName maps to safe placeholder or validation failure depending contract
- 404 maps to ProfileNotFound
- 503 maps to transient dependency failure
```

A good contract test does not merely assert JSON equals exact text. It asserts **semantic compatibility**.

---

## 18. OpenAPI / Generated Internal SDK

At scale, handwritten clients for every service become inconsistent.

Options:

```text
handwritten client
OpenAPI generated client
Spring HTTP Interface client
Retrofit interface client
Feign-like declarative client
platform-generated SDK wrapper
```

Generated internal SDK can help, but raw generated client should not leak directly into domain/use case.

Recommended:

```text
OpenAPI spec
→ generated low-level client
→ organization wrapper
→ policy injection
→ domain-safe port
```

Why?

Raw generated client often exposes:

```text
transport exceptions
raw response types
generated DTOs everywhere
inconsistent error model
no organization-standard retry/timeout/metrics
```

Governance requirement:

```text
all internal clients must have:
- dependency id
- endpoint operation id
- timeout policy
- retry policy
- bulkhead policy
- tracing
- metrics
- redaction
- error classifier
- version declaration
```

---

## 19. Observability for Internal Clients

Internal client observability must let us answer:

```text
Which dependency is slow?
Which operation is failing?
Is failure from caller, network, mesh, or callee?
Is this one tenant or global?
Is retry helping or amplifying?
Is circuit breaker open?
Is pool/concurrency limit saturated?
```

Minimum metrics:

```text
http.client.request.duration
http.client.request.count
http.client.error.count
http.client.timeout.count
http.client.retry.attempts
http.client.circuit.state
http.client.bulkhead.rejected
http.client.pool.active
http.client.pool.idle
http.client.pool.pending
```

Recommended dimensions:

```text
service.name = case-service
dependency.service = profile-service
operation = get-profile
method = GET
status_code = 200/404/503
outcome = success/error/timeout/degraded
retry_attempt = 0/1/2
criticality = critical/degradable/optional
```

Avoid high-cardinality dimensions:

```text
bad: full URL /profiles/123456789
bad: user id
bad: case id
bad: raw query string
bad: exception message with dynamic IDs
```

Use route template:

```text
GET /internal/v1/profiles/{profileId}
```

OpenTelemetry semantic conventions define HTTP spans, metrics, and logs for HTTP client/server activity and should be followed where possible.

---

## 20. Distributed Tracing

Every internal call should propagate trace context.

Typical propagation:

```text
traceparent
tracestate
baggage — only if governed carefully
x-correlation-id — if organization still uses explicit correlation ID
```

Trace shape:

```text
GET /case/{id}
  case-service span
    profile-service client span
      profile-service server span
    document-service client span
      document-service server span
    workflow-service client span
      workflow-service server span
```

A good trace helps diagnose:

```text
fan-out latency
which dependency dominates P99
which dependency retries
whether server received request
whether timeout happened before response
whether downstream continued after caller cancelled
```

Important distinction:

```text
client span timeout does not always mean server did no work.
```

For write operations, this matters greatly.

---

## 21. Request Context Propagation

Internal client should propagate context explicitly, not by copying all inbound headers.

Example policy:

```java
public final class InternalHeaderPolicy {
    private static final Set<String> ALLOWED_INBOUND_TO_OUTBOUND = Set.of(
        "traceparent",
        "tracestate",
        "x-correlation-id"
    );

    public Map<String, String> outboundHeaders(RequestContext context) {
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("x-correlation-id", context.correlationId());
        headers.put("x-caller-service", context.callerService());
        headers.put("x-tenant-id", context.tenantId());
        return headers;
    }
}
```

Do not blindly forward:

```text
Authorization
Cookie
X-Admin
X-Debug
X-Internal-Override
```

Unless explicitly reviewed.

---

## 22. Cancellation and Request Abandonment

Internal HTTP client at scale must care about cancellation.

Scenario:

```text
user request cancelled
API gateway timeout reached
caller service returns timeout
but downstream calls continue doing expensive work
```

This wastes capacity and can amplify incidents.

Design goal:

```text
When upstream request is cancelled or deadline exceeded,
in-flight downstream calls should be cancelled if possible.
```

With Java 8 `CompletableFuture`, cancellation propagation is not always intuitive. With Java 21+ structured concurrency, related tasks can be scoped more naturally.

Pseudo pattern:

```java
try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
    var profile = scope.fork(() -> profileClient.getProfile(profileId, ctx));
    var docs = scope.fork(() -> documentClient.getDocuments(caseId, ctx));
    var wf = scope.fork(() -> workflowClient.getState(caseId, ctx));

    scope.joinUntil(deadlineInstant);
    scope.throwIfFailed();

    return aggregate(profile.get(), docs.get(), wf.get());
}
```

For Java 8/11, create explicit executor + timeout + cancellation discipline.

---

## 23. Fan-Out Aggregation Design

Use case: build `CaseDetailView`.

Naive:

```java
ProfileSnapshot profile = profileClient.getProfile(profileId, ctx);
List<DocumentSummary> documents = documentClient.getDocuments(caseId, ctx);
WorkflowState workflow = workflowClient.getWorkflowState(caseId, ctx);
List<AuditEntry> audit = auditClient.getRecentEntries(caseId, ctx);
return assemble(profile, documents, workflow, audit);
```

Problem:

```text
sequential latency
one optional dependency can delay whole response
no partial failure policy
no explicit deadline
```

Better:

```text
parallel by dependency
critical dependency failure aborts
optional dependency failure degrades
bounded concurrency
shared deadline
```

Pseudo:

```java
public CaseDetailView getCaseDetail(CaseId caseId, RequestContext ctx) {
    Deadline deadline = Deadline.after(Duration.ofMillis(700));

    var profileFuture = executor.submit(() -> profileClient.getProfile(caseId.profileId(), ctx.withDeadline(deadline)));
    var workflowFuture = executor.submit(() -> workflowClient.getState(caseId, ctx.withDeadline(deadline)));
    var docsFuture = executor.submit(() -> documentClient.findDocuments(caseId, ctx.withDeadline(deadline)));
    var auditFuture = executor.submit(() -> auditClient.findRecentEntries(caseId, ctx.withDeadline(deadline)));

    ProfileSnapshot profile = require(profileFuture, "profile-service");
    WorkflowState workflow = require(workflowFuture, "workflow-service");
    DocumentSection docs = degradeIfFailed(docsFuture, DocumentSection.unavailable());
    AuditSection audit = degradeIfFailed(auditFuture, AuditSection.unavailable());

    return assemble(profile, workflow, docs, audit);
}
```

---

## 24. Internal Client with JDK HttpClient

JDK `HttpClient` is suitable when you want standard JDK dependency, HTTP/1.1/HTTP/2 support, sync/async API, and can build missing policy layer yourself.

Skeleton:

```java
public final class ProfileJdkHttpClient implements ProfilePort {
    private final HttpClient httpClient;
    private final URI baseUri;
    private final ObjectMapper objectMapper;
    private final ClientPolicy policy;
    private final ProfileMapper mapper;

    public ProfileJdkHttpClient(
        HttpClient httpClient,
        URI baseUri,
        ObjectMapper objectMapper,
        ClientPolicy policy,
        ProfileMapper mapper
    ) {
        this.httpClient = httpClient;
        this.baseUri = baseUri;
        this.objectMapper = objectMapper;
        this.policy = policy;
        this.mapper = mapper;
    }

    @Override
    public ProfileSnapshot getProfile(ProfileId profileId, RequestContext ctx) {
        URI uri = baseUri.resolve("/internal/v1/profiles/" + encodePath(profileId.value()));

        HttpRequest request = HttpRequest.newBuilder(uri)
            .timeout(policy.operationTimeout())
            .header("Accept", "application/json")
            .header("x-correlation-id", ctx.correlationId())
            .header("x-caller-service", ctx.callerService())
            .GET()
            .build();

        try {
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            return handle(response);
        } catch (IOException e) {
            throw DependencyFailureException.transport("profile-service", e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw DependencyFailureException.cancelled("profile-service", e);
        }
    }

    private ProfileSnapshot handle(HttpResponse<String> response) throws IOException {
        int status = response.statusCode();
        if (status == 200) {
            ProfileResponseV1 dto = objectMapper.readValue(response.body(), ProfileResponseV1.class);
            return mapper.toDomain(dto);
        }
        if (status == 404) {
            throw new ProfileNotFoundException();
        }
        if (status == 503 || status == 504) {
            throw DependencyFailureException.transientHttp("profile-service", status);
        }
        throw DependencyFailureException.unexpectedHttp("profile-service", status);
    }
}
```

Production additions:

```text
metrics wrapper
trace wrapper
retry/circuit wrapper
bulkhead wrapper
redacted logging
content-type validation
error body parser
route template tagging
```

---

## 25. Internal Client with OkHttp

OkHttp is strong for reusable client, interceptors, event listener, connection pooling, HTTP/2, and advanced TLS/custom DNS features.

Skeleton:

```java
public final class ProfileOkHttpClient implements ProfilePort {
    private final OkHttpClient client;
    private final HttpUrl baseUrl;
    private final ObjectMapper objectMapper;
    private final ProfileMapper mapper;

    public ProfileOkHttpClient(
        OkHttpClient client,
        HttpUrl baseUrl,
        ObjectMapper objectMapper,
        ProfileMapper mapper
    ) {
        this.client = client;
        this.baseUrl = baseUrl;
        this.objectMapper = objectMapper;
        this.mapper = mapper;
    }

    @Override
    public ProfileSnapshot getProfile(ProfileId profileId, RequestContext ctx) {
        HttpUrl url = baseUrl.newBuilder()
            .addPathSegments("internal/v1/profiles")
            .addPathSegment(profileId.value())
            .build();

        Request request = new Request.Builder()
            .url(url)
            .header("Accept", "application/json")
            .header("x-correlation-id", ctx.correlationId())
            .header("x-caller-service", ctx.callerService())
            .get()
            .build();

        try (Response response = client.newCall(request).execute()) {
            return handle(response);
        } catch (IOException e) {
            throw DependencyFailureException.transport("profile-service", e);
        }
    }

    private ProfileSnapshot handle(Response response) throws IOException {
        int status = response.code();
        ResponseBody body = response.body();

        if (status == 200) {
            if (body == null) {
                throw DependencyFailureException.protocol("profile-service", "empty body");
            }
            ProfileResponseV1 dto = objectMapper.readValue(body.charStream(), ProfileResponseV1.class);
            return mapper.toDomain(dto);
        }

        if (status == 404) {
            throw new ProfileNotFoundException();
        }
        if (status == 503 || status == 504) {
            throw DependencyFailureException.transientHttp("profile-service", status);
        }
        throw DependencyFailureException.unexpectedHttp("profile-service", status);
    }
}
```

Important:

```text
Always close Response.
Do not create OkHttpClient per request.
Use route template in metrics, not full URL.
Put auth/tracing/logging in interceptors carefully.
Do not put complex business fallback inside low-level interceptor.
```

---

## 26. Internal Client with Spring RestClient / WebClient

For Spring services, `RestClient` and `WebClient` are common.

`RestClient` fits synchronous code and virtual-thread-friendly architectures.

`WebClient` fits reactive pipelines and high-concurrency non-blocking architecture.

RestClient-style:

```java
public final class ProfileSpringRestClient implements ProfilePort {
    private final RestClient restClient;
    private final ProfileMapper mapper;

    public ProfileSpringRestClient(RestClient restClient, ProfileMapper mapper) {
        this.restClient = restClient;
        this.mapper = mapper;
    }

    @Override
    public ProfileSnapshot getProfile(ProfileId profileId, RequestContext ctx) {
        ProfileResponseV1 dto = restClient.get()
            .uri("/internal/v1/profiles/{id}", profileId.value())
            .header("x-correlation-id", ctx.correlationId())
            .retrieve()
            .body(ProfileResponseV1.class);

        return mapper.toDomain(dto);
    }
}
```

This is not complete production code unless error mapping, timeout, observability, and policy are configured.

WebClient-style:

```java
public Mono<ProfileSnapshot> getProfile(ProfileId profileId, RequestContext ctx) {
    return webClient.get()
        .uri("/internal/v1/profiles/{id}", profileId.value())
        .header("x-correlation-id", ctx.correlationId())
        .retrieve()
        .bodyToMono(ProfileResponseV1.class)
        .map(mapper::toDomain)
        .timeout(Duration.ofMillis(250));
}
```

Be careful:

```text
Do not block inside reactive event loop.
Do not mix reactive and blocking without scheduler discipline.
Do not assume WebClient automatically solves resilience.
```

---

## 27. Gateway/Aggregator Anti-Pattern

A common internal microservice pattern is building aggregator services.

Useful:

```text
case-service aggregates case detail from multiple domain services
```

Dangerous:

```text
generic gateway-service aggregates everything for everyone
```

Signs of bad aggregator:

```text
contains business logic from many domains
calls 20+ services per request
has unclear ownership
has no dependency criticality policy
becomes single bottleneck
hides true service dependency graph
retries everything
caches inconsistently
```

Better:

```text
bounded-context-specific aggregation
explicit dependency graph
clear fallback policy
strict SLO
traceable fan-out
consumer-driven contract
```

---

## 28. Internal Client SDK Governance

At scale, every team writing HTTP clients differently creates chaos.

Platform team should provide:

```text
standard client factory
standard timeout policy model
standard retry classifier
standard telemetry wrapper
standard header propagation
standard redaction policy
standard error model
standard contract test template
standard generated client wrapper pattern
```

But avoid over-centralizing business semantics.

Platform owns:

```text
transport defaults
security defaults
observability defaults
resilience primitives
```

Service team owns:

```text
dependency criticality
endpoint semantics
fallback behavior
domain mapping
version compatibility
```

---

## 29. Example Policy Object

```java
public record InternalClientPolicy(
    String dependencyService,
    String operation,
    Duration timeout,
    int maxAttempts,
    Duration retryBaseDelay,
    int maxConcurrency,
    boolean circuitBreakerEnabled,
    Criticality criticality
) {
    public void validate() {
        if (timeout.isZero() || timeout.isNegative()) {
            throw new IllegalArgumentException("timeout must be positive");
        }
        if (maxAttempts < 1 || maxAttempts > 3) {
            throw new IllegalArgumentException("maxAttempts must be between 1 and 3 for internal clients");
        }
        if (maxConcurrency < 1) {
            throw new IllegalArgumentException("maxConcurrency must be positive");
        }
    }
}
```

Example config:

```yaml
internal-clients:
  profile-service:
    base-url: http://profile-service.default.svc.cluster.local
    operations:
      get-profile:
        timeout: 250ms
        max-attempts: 2
        retry-base-delay: 25ms
        max-concurrency: 80
        circuit-breaker-enabled: true
        criticality: CRITICAL
      search-profile:
        timeout: 500ms
        max-attempts: 1
        max-concurrency: 30
        circuit-breaker-enabled: true
        criticality: IMPORTANT
```

---

## 30. Failure Scenario: Profile-Service Slowdown

Symptom:

```text
case detail P95 jumps from 450 ms to 2.5 s
case-service CPU normal
case-service thread count increasing
profile-service 5xx low but latency high
```

Possible causes:

```text
profile-service database slow
profile-service connection pool exhausted
profile-service rolling deployment with cold start
mesh retries hiding failures
case-service retry amplifying slow calls
case-service bulkhead too large
case-service timeout too high
```

Good dashboard should show:

```text
case-service outbound profile-service latency P50/P95/P99
profile-service inbound latency P50/P95/P99
client timeout count
retry attempts
bulkhead active/rejected
circuit breaker state
trace samples showing time spent in profile client span
```

Safe mitigation options:

```text
reduce timeout for non-critical call
disable retry temporarily
lower max concurrency to profile-service
open circuit / degrade non-critical profile enrichment
scale profile-service if bottleneck is CPU/thread
roll back profile-service deployment if regression
```

Unsafe mitigation:

```text
increase timeout globally
increase retry globally
increase thread pool blindly
scale caller only
ignore mesh retry layer
```

---

## 31. Failure Scenario: Retry Storm

Symptom:

```text
profile-service gets 3x normal traffic
case-service request volume unchanged
error rate rises across multiple services
```

Likely cause:

```text
caller retry + mesh retry + downstream retry
```

Diagnosis:

```text
compare original request count vs downstream attempt count
check retry_attempt metric
check service mesh metrics
check logs for repeated correlation id to same dependency
```

Mitigation:

```text
disable one retry layer
reduce max attempts
respect retry budget
add jitter
lower concurrency
use circuit breaker to stop useless attempts
```

Postmortem question:

```text
Which layer owns retry for this dependency?
Was there a documented retry budget?
Were retry attempts observable before incident?
```

---

## 32. Failure Scenario: Deployment Compatibility Break

Symptom:

```text
case-service starts failing deserialization after profile-service deployment
HTTP status remains 200
profile-service logs look healthy
```

Likely causes:

```text
field removed
enum value added
date format changed
content-type changed
schema changed without version bump
```

Mitigation:

```text
rollback producer
hotfix tolerant consumer
restore old field
add UNKNOWN enum mapping
add compatibility test
```

Preventive controls:

```text
consumer-driven contract test
schema compatibility check in CI
versioned endpoint
unknown field tolerance
safe enum fallback
producer deprecation policy
```

---

## 33. Failure Scenario: Connection Pool / HTTP/2 Stream Saturation

Symptom:

```text
latency rises under load
CPU not high
downstream healthy
client pending requests increasing
few TCP connections active
```

Possible causes:

```text
HTTP/2 max concurrent streams reached
per-host dispatcher limit reached
connection pool misconfigured
response body not closed
load balancer closing idle connection
sidecar bottleneck
```

Diagnosis:

```text
check client dispatcher queued/running
check pool active/idle
check response body leak indicators
check HTTP/2 stream reset/errors
check sidecar metrics
check downstream server max concurrent streams
```

Mitigation:

```text
fix body closing
adjust max concurrent requests per host
increase downstream stream capacity carefully
split traffic by criticality
use bulkhead per operation
align idle timeout with LB/mesh
```

---

## 34. Design Review Checklist

Use this checklist before approving internal microservice client design.

### 34.1 Contract

```text
[ ] Is the dependency service explicitly named?
[ ] Is the operation/endpoint explicitly named?
[ ] Is there a stable route template?
[ ] Is the API version declared?
[ ] Is DTO isolated from domain model?
[ ] Are unknown fields tolerated where appropriate?
[ ] Are enum evolutions handled safely?
[ ] Are error responses modelled?
```

### 34.2 Latency and Resilience

```text
[ ] Is there a per-operation timeout?
[ ] Is there a total deadline for fan-out?
[ ] Is retry limited and idempotency-aware?
[ ] Is retry ownership clear between app and mesh?
[ ] Is there per-dependency bulkhead/concurrency limit?
[ ] Is circuit breaker per operation or useful dependency group?
[ ] Is fallback/degradation explicitly defined?
[ ] Is queueing bounded or avoided?
```

### 34.3 Security

```text
[ ] Is mTLS/service identity handled?
[ ] Is user/service auth propagation explicit?
[ ] Are sensitive headers not blindly forwarded?
[ ] Are internal admin headers protected?
[ ] Are logs redacted?
[ ] Is tenant context validated, not trusted blindly?
```

### 34.4 Observability

```text
[ ] Are metrics tagged by dependency and operation?
[ ] Is route template used instead of full URL?
[ ] Are retry attempts visible?
[ ] Are timeouts classified?
[ ] Is circuit/bulkhead state observable?
[ ] Is trace context propagated?
[ ] Can we distinguish client timeout from server error?
```

### 34.5 Deployment and Governance

```text
[ ] Is there contract test coverage?
[ ] Is backward compatibility checked?
[ ] Is rollout/canary strategy defined?
[ ] Is rollback safe?
[ ] Is config externalized and validated?
[ ] Is client factory standardized?
[ ] Is ownership documented?
```

---

## 35. Top 1% Heuristics

### 35.1 Internal Is Still Remote

Never treat internal HTTP call as local function call.

Remote means:

```text
latency
partial failure
deployment skew
network uncertainty
security boundary
version mismatch
observability requirement
```

### 35.2 Dependency Criticality Must Be Explicit

Every outbound call should be classified:

```text
critical
important
degradable
optional
command/write
```

Without this, fallback and timeout decisions become arbitrary.

### 35.3 Retry Is a Load Multiplier

Before adding retry, ask:

```text
Is operation idempotent?
Is failure transient?
Is there total deadline?
Is retry attempt observable?
Is another layer already retrying?
```

### 35.4 Pool and Bulkhead Are Part of Architecture

Connection pool, dispatcher limit, max concurrency, and bulkhead are not low-level tuning trivia. They define failure isolation.

### 35.5 Contract Compatibility Beats Fast Local Refactor

Internal teams move fast, but distributed contract changes must be slow and deliberate.

### 35.6 Observability Is Part of the API Client Contract

A client that cannot explain its failures is not production-grade.

### 35.7 Service Mesh Does Not Remove Application Responsibility

Mesh can provide transport policy. It does not understand domain criticality, idempotency, user-visible degradation, or command semantics.

### 35.8 Generated Client Is Not Governance

Generated code solves typing. It does not solve timeout, retry, security, observability, fallback, or domain mapping.

---

## 36. Summary Mental Model

Internal microservice client at scale is a combination of:

```text
remote dependency contract
+ service identity
+ service discovery
+ version compatibility
+ failure classification
+ latency budget
+ bounded concurrency
+ controlled retry
+ explicit fallback
+ tracing and metrics
+ deployment governance
```

The mature engineer does not merely ask:

```text
Can this service call that service?
```

They ask:

```text
What happens when that service is slow, partially deployed, overloaded,
returning a new enum value, behind a mesh retry policy, and being called by
1000 concurrent requests during peak traffic?
```

That is the difference between writing HTTP client code and engineering internal service communication.

---

## 37. What Comes Next

Next part:

```text
Part 34 — Final Synthesis: Decision Framework, Checklist, and Top 1% Engineering Heuristics
File: 34-final-synthesis-decision-framework-checklist-top-engineering-heuristics.md
```

Part 34 will close the series by turning the entire 35-part journey into a unified decision framework, design review checklist, operational checklist, and mental model summary.



<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 32 — Case Study: Building a Production-Grade Third-Party API Client](./32-case-study-production-grade-third-party-api-client.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 34 — Final Synthesis: Decision Framework, Checklist, and Top 1% Engineering Heuristics](./34-final-synthesis-decision-framework-checklist-top-engineering-heuristics.md)
