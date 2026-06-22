# Part 32 — Testing Networked Java Systems: Unit, Contract, Integration, Chaos, Fault Injection, and Replay

> Seri: `learn-java-io-network-http-grpc-protocol-engineering`  
> File: `032-testing-networked-java-systems-unit-contract-integration-chaos-fault-injection-replay.md`  
> Scope Java: Java 8–25  
> Posisi dalam seri: Part 32 dari 35

---

## 0. Tujuan Bagian Ini

Pada bagian-bagian sebelumnya kita sudah membahas TCP, DNS, HTTP/1.1, HTTP/2, HTTP/3, Java HTTP clients, timeout, retry, pooling, TLS, proxy, REST contract, streaming, WebSocket, gRPC, Netty, concurrency model, backpressure, observability, performance, file transfer, dan security.

Bagian ini menjawab pertanyaan berikut:

> Bagaimana cara membuktikan bahwa sistem Java network kita benar-benar tahan terhadap kondisi dunia nyata, bukan hanya lolos happy-path test?

Networked system tidak cukup dites dengan:

```text
Given valid request
When service returns 200
Then response is parsed correctly
```

Itu hanya membuktikan bahwa parser dan mapping happy-path bekerja. Production failure biasanya terjadi pada area yang tidak disentuh test seperti:

```text
DNS stale
connect timeout
TLS handshake failure
idle connection closed by load balancer
partial body
slow streaming response
429 with Retry-After
503 during deployment
HTTP/2 GOAWAY
RST_STREAM
connection pool exhausted
deadline exceeded
retry duplicate side effect
large payload halfway uploaded
server returns malformed JSON
server sends 200 with business error
proxy buffers streaming response
client cancels but server keeps processing
```

Tujuan bagian ini adalah membangun mental model dan toolkit untuk melakukan testing networked Java systems secara serius.

Setelah bagian ini, kamu diharapkan mampu:

1. Membedakan unit test, component test, contract test, integration test, system test, performance test, fault injection, chaos test, dan replay test.
2. Mendesain test berdasarkan failure taxonomy, bukan berdasarkan jumlah coverage line.
3. Menguji HTTP client wrapper, gRPC client, streaming endpoint, timeout, retry, idempotency, TLS, proxy, dan backpressure.
4. Memilih tool yang tepat: fake server, WireMock, MockWebServer, gRPC in-process, Testcontainers, Toxiproxy, embedded proxy, packet/network fault simulation, dan traffic replay.
5. Membuat deterministic test untuk kasus yang biasanya flaky.
6. Menentukan apa yang harus dites di CI, staging, pre-prod, dan production chaos experiment.
7. Menghubungkan testing dengan observability, sehingga failure yang dites menghasilkan signal yang bisa dibaca.

---

## 1. Core Thesis: Network Test Bukan Test Response, Tapi Test Conversation

Kesalahan umum engineer adalah menganggap network interaction sebagai satu function call:

```java
CustomerDto customer = customerClient.getCustomer(id);
```

Padahal secara sistem, itu adalah conversation:

```text
caller prepares request
caller selects endpoint
caller acquires connection/channel
caller resolves DNS
caller connects if needed
caller negotiates TLS
caller writes headers/body
remote/proxy accepts request
remote processes request
remote streams headers/body/trailers
caller reads body
caller maps result
caller releases resource
caller records observability
caller decides retry/fallback/error
```

Test yang baik harus bisa memverifikasi conversation tersebut.

Contoh test buruk:

```java
@Test
void getCustomer_returnsCustomer() {
    when(server.get("/customers/1")).thenReturn(200, "{...}");
    assertEquals("Alice", client.getCustomer("1").name());
}
```

Test ini tidak menjawab:

```text
Apakah timeout benar?
Apakah retry terjadi hanya pada error yang aman?
Apakah body ditutup?
Apakah 404 dimapping ke domain result, bukan exception generic?
Apakah 429 menghormati Retry-After?
Apakah correlation id dikirim?
Apakah Authorization tidak tertulis ke log?
Apakah connection pool tidak leak?
Apakah cancellation menghentikan request?
Apakah duplicate suppression bekerja?
```

Mental model top-tier engineer:

> Every remote interaction is a state machine under uncertainty. Test the state machine, not just the returned object.

---

## 2. Testing Pyramid untuk Networked Systems

Testing pyramid klasik biasanya:

```text
        E2E
     integration
       unit
```

Untuk networked Java systems, bentuknya lebih tepat seperti ini:

```text
                            production chaos probes
                         controlled chaos / fault injection
                    system / pre-prod integration tests
                contract compatibility tests
            component tests with fake remote dependency
        unit tests for mapping / policies / state machines
    static validation / schema lint / config validation
```

Setiap layer punya tujuan berbeda.

### 2.1 Static Validation

Menangkap error sebelum runtime:

```text
OpenAPI lint
Protobuf breaking-change check
TLS config validation
forbidden dependency rule
timeout config rule
retry policy rule
header allowlist rule
serialization schema rule
```

Contoh rule:

```text
No outbound HTTP client may have infinite request timeout.
No POST mutation may be retried unless idempotency key is required.
No gRPC method may omit deadline in client wrapper.
No HTTP client may follow redirects for internal metadata/import URL fetcher.
No payload log may include Authorization, Cookie, Set-Cookie, token, password, secret.
```

Static validation sering lebih murah dan lebih stabil daripada test runtime.

---

### 2.2 Unit Test

Unit test cocok untuk logic yang deterministik dan tidak butuh socket nyata:

```text
status code mapping
retry decision
backoff calculation
idempotency key validation
error response parsing
request builder
header propagation allowlist
deadline budget calculation
pagination cursor validation
serialization/deserialization mapping
```

Contoh retry decision:

```java
final class RetryPolicyTest {

    @Test
    void doesNotRetryNonIdempotentPostWithoutIdempotencyKey() {
        RetryDecision decision = RetryPolicy.defaultPolicy().decide(
                new AttemptContext(
                        "POST",
                        false,
                        HttpFailure.status(503),
                        Duration.ofMillis(800),
                        Duration.ofSeconds(2)
                )
        );

        assertEquals(RetryDecision.noRetry("unsafe-non-idempotent"), decision);
    }

    @Test
    void retriesGetOnConnectionResetWhenDeadlineAllows() {
        RetryDecision decision = RetryPolicy.defaultPolicy().decide(
                new AttemptContext(
                        "GET",
                        true,
                        HttpFailure.ioException("connection reset"),
                        Duration.ofMillis(100),
                        Duration.ofSeconds(2)
                )
        );

        assertTrue(decision.shouldRetry());
    }
}
```

Unit test harus digunakan untuk memastikan policy tidak berubah diam-diam.

---

### 2.3 Component Test with Fake Remote

Di layer ini client/server benar-benar memakai HTTP/gRPC stack, tetapi remote dependency diganti fake server.

Tujuan:

```text
menguji request shape
menguji header propagation
menguji parsing response
menguji timeout
menguji retry
menguji error mapping
menguji body streaming
menguji TLS local
menguji resource release
```

Tools yang umum:

```text
WireMock
OkHttp MockWebServer
MockServer
Spring MockWebServer-like setup
embedded Jetty/Undertow/Netty
JDK HttpServer for minimal tests
gRPC InProcessServerBuilder
gRPC in-process channel
```

WireMock sangat kuat untuk HTTP stubbing, request matching, response templating, delays, dan fault simulation. WireMock menyediakan request matching terhadap URL, header, query parameter, body JSON/XML, cookie, dan matcher lain; juga mendukung delay/fault seperti chunked dribble delay untuk mensimulasikan slow network.

---

### 2.4 Contract Test

Contract test menjawab:

> Apakah provider dan consumer masih sepakat tentang bentuk, semantics, dan compatibility API?

Contract test bukan hanya schema. Ia harus mencakup:

```text
method
path
query parameter
headers
content type
required/optional fields
status codes
error payload
idempotency behavior
pagination behavior
backward compatibility
unknown field tolerance
field deprecation
```

Untuk REST:

```text
OpenAPI validation
Pact consumer-driven contract
schemathesis / property-based API fuzzing
snapshot contract test
custom compatibility test
```

Untuk gRPC/Protobuf:

```text
buf breaking check
reserved field number check
reserved enum value check
unknown fields compatibility
old client vs new server test
new client vs old server test
```

Contract test yang baik mencegah perubahan seperti:

```text
rename JSON field
change number to string
remove enum value
change 404 to 200 with error body
change nullable to required
remove unknown field tolerance
reuse protobuf field number
change gRPC status semantics
```

---

### 2.5 Integration Test

Integration test menggunakan dependency lebih nyata:

```text
real database
real Redis
real message broker
real TLS config
real containerized dependency
real service image
real proxy/gateway simulation
```

Biasanya menggunakan:

```text
Testcontainers
Docker Compose
Kubernetes namespace ephemeral environment
LocalStack for selected AWS-like services
real Nginx/Envoy container
Toxiproxy for network fault
```

Tujuannya bukan hanya “bisa jalan bersama”, tapi:

```text
Apakah timeout cocok dengan real service?
Apakah connection pool size aman?
Apakah TLS truststore benar?
Apakah proxy header benar?
Apakah retry menyebabkan duplicate DB insert?
Apakah schema migration compatible?
Apakah observability keluar?
```

---

### 2.6 Fault Injection Test

Fault injection sengaja membuat dependency berperilaku buruk.

Contoh fault:

```text
latency tambahan
bandwidth terbatas
connection reset
timeout
partial response
malformed response
TLS failure
DNS failure
server returns 429/503/504
server sends GOAWAY
server closes idle connection
proxy buffers response
packet loss
blackhole
slow read
slow write
```

Tool:

```text
WireMock delays/faults
MockWebServer SocketPolicy
Toxiproxy
Linux tc/netem
iptables
Envoy fault filter
Istio fault injection
Chaos Mesh
LitmusChaos
Gremlin-like platform
custom fake server
```

Testcontainers menyediakan modul Toxiproxy untuk mensimulasikan network failure conditions dalam test Java/containerized environment. Toxiproxy sendiri adalah TCP proxy untuk mensimulasikan kondisi network di test, CI, dan development environment.

---

### 2.7 Chaos Test

Chaos test adalah fault injection yang dilakukan pada environment yang lebih realistis dan biasanya lebih luas.

Bedanya:

```text
Fault injection test:
- deterministic
- scoped
- biasanya CI/integration env
- membuktikan behavior spesifik

Chaos test:
- controlled experiment
- environment lebih nyata
- menguji hypothesis resiliency
- membutuhkan observability dan rollback
```

Contoh chaos experiment:

```text
Hypothesis:
If downstream Case Profile service returns 503 for 10 minutes,
then Application service should shed low-priority requests,
serve cached read-only profile where allowed,
not retry more than 2 attempts per request,
keep p95 below 2s for unrelated endpoints,
and emit dependency_unavailable metric.
```

Chaos test tanpa hypothesis hanyalah merusak sistem.

---

### 2.8 Replay Test

Replay test menggunakan traffic nyata atau recorded interaction.

Jenis replay:

```text
request replay to mock
golden cassette replay
shadow traffic
dark launch
production read-only replay
log-based replay
pcap-like protocol replay
```

Tujuan:

```text
mendeteksi compatibility regression
membandingkan old vs new client
membandingkan old vs new parser
memvalidasi migration
menguji real-world payload distribution
mendeteksi field/data shape yang tidak ada di synthetic test
```

Risiko replay:

```text
PII leakage
secret leakage
side effects
timing mismatch
non-deterministic dependency
old auth token
replayed idempotency key
rate-limit impact
```

Replay untuk production-like traffic harus sanitize payload dan memastikan operation read-only atau diarahkan ke isolated environment.

---

## 3. Failure-Based Test Matrix

Top-tier network testing dimulai dari failure matrix, bukan dari framework.

Contoh matrix untuk outbound HTTP client:

| Failure | Expected Behavior | Test Layer |
|---|---|---|
| DNS resolution fails | fail fast, no retry storm, clear error | component/fault |
| Connect timeout | retry only if safe and deadline remains | component/fault |
| TLS handshake fails | no retry unless cert rotation transient scenario, alert | integration |
| 401 token expired | refresh token once, retry once | component |
| 403 forbidden | no retry, domain auth error | unit/component |
| 404 not found | typed not-found result where expected | unit/component |
| 409 conflict | no blind retry, expose conflict | unit/component |
| 429 Retry-After | respect server hint and budget | component |
| 500 | maybe retry if idempotent | component |
| 503 | retry with backoff/jitter if safe | component/fault |
| 504 from gateway | classify as ambiguous remote state | component |
| connection reset after write | ambiguous; retry only if idempotent | component/fault |
| slow body | body/read timeout triggers | fault |
| partial JSON | parse error with response metadata | component |
| large body | enforce max body size | component/security |
| malformed header | safe failure | component/security |
| redirect to internal IP | block | security |
| response missing required field | mapping error with diagnostics | component |
| pool exhausted | bounded wait, clear metric | integration/perf |

Untuk gRPC:

| Failure | Expected Behavior | Test Layer |
|---|---|---|
| `UNAVAILABLE` | retry if configured and idempotent | component |
| `DEADLINE_EXCEEDED` | no endless retry, preserve deadline | component |
| `INVALID_ARGUMENT` | no retry, validation error | unit/component |
| `ABORTED` | retry transaction if semantics supports | unit/component |
| `RESOURCE_EXHAUSTED` | backoff or shed load | component |
| server cancels stream | cleanup and expose partial state | component |
| client cancels | server stops work | integration |
| flow control stalls | bounded buffer, no OOM | integration/perf |
| max message exceeded | clear error, no retry | component |
| GOAWAY | reconnect/drain according to library behavior | integration/fault |

---

## 4. Test Design Principle: Separate Policy, Transport, and Business Logic

Network code yang sulit dites biasanya mencampur semuanya:

```java
public Customer getCustomer(String id) {
    HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(baseUrl + "/customers/" + id))
            .header("Authorization", "Bearer " + tokenProvider.get())
            .timeout(Duration.ofSeconds(10))
            .GET()
            .build();

    HttpResponse<String> response = httpClient.send(request, BodyHandlers.ofString());

    if (response.statusCode() == 401) { ... refresh ... retry ... }
    if (response.statusCode() >= 500) { ... retry ... }

    return mapper.readValue(response.body(), Customer.class);
}
```

Lebih testable jika dipisah:

```text
RequestFactory
AuthHeaderProvider
TransportClient
RetryPolicy
DeadlineBudget
ResponseClassifier
ErrorMapper
JsonCodec
DomainClientFacade
MetricsRecorder
```

Struktur:

```text
CustomerClient
  -> builds semantic operation
  -> delegates to ResilientHttpExecutor
       -> applies deadline / retry / metrics
       -> uses low-level HttpTransport
  -> maps HttpResult to domain result
```

Dengan ini:

```text
RetryPolicy dites unit.
RequestFactory dites unit.
HttpTransport dites dengan fake server.
CustomerClient dites component.
End-to-end interaction dites integration.
```

---

## 5. Testing Outbound HTTP Client

### 5.1 Production Wrapper Shape

Misalnya kita punya abstraction:

```java
public interface RemoteHttpClient {
    RemoteResponse execute(RemoteRequest request, Deadline deadline) throws RemoteCallException;
}
```

Dan domain client:

```java
public final class CaseProfileClient {
    private final RemoteHttpClient http;
    private final ObjectMapper mapper;

    public CaseProfileClient(RemoteHttpClient http, ObjectMapper mapper) {
        this.http = http;
        this.mapper = mapper;
    }

    public CaseProfileResult getProfile(String caseId, Deadline deadline) {
        RemoteRequest request = RemoteRequest.get("/case-profiles/" + UrlEscaper.escapePath(caseId))
                .accept("application/json")
                .header("X-Correlation-Id", Correlation.current())
                .build();

        RemoteResponse response = http.execute(request, deadline);

        return switch (response.statusCode()) {
            case 200 -> CaseProfileResult.found(readProfile(response.bodyBytes()));
            case 404 -> CaseProfileResult.notFound(caseId);
            case 409 -> CaseProfileResult.conflict(readProblem(response.bodyBytes()));
            default -> throw ErrorMapper.map(response);
        };
    }

    private CaseProfile readProfile(byte[] bytes) {
        try {
            return mapper.readValue(bytes, CaseProfile.class);
        } catch (IOException e) {
            throw new RemoteProtocolException("Invalid case profile JSON", e);
        }
    }
}
```

Test target:

```text
URI path escaping
Accept header
correlation id
status mapping
invalid JSON
error body mapping
resource closure
```

---

### 5.2 Testing Request Shape

Dengan fake server, verifikasi request:

```java
@Test
void sendsCorrelationIdAndAcceptHeader() {
    fakeServer.stubFor(get(urlEqualTo("/case-profiles/CASE-123"))
            .withHeader("Accept", equalTo("application/json"))
            .withHeader("X-Correlation-Id", matching(".+"))
            .willReturn(okJson("{\"caseId\":\"CASE-123\"}")));

    CaseProfileResult result = client.getProfile("CASE-123", Deadline.after(Duration.ofSeconds(2)));

    assertTrue(result.isFound());
}
```

Jangan hanya assert response. Assert juga request yang dikirim.

---

### 5.3 Testing Error Mapping

```java
@Test
void maps404ToNotFoundInsteadOfThrowingGenericException() {
    fakeServer.stubFor(get("/case-profiles/CASE-404")
            .willReturn(aResponse()
                    .withStatus(404)
                    .withHeader("Content-Type", "application/problem+json")
                    .withBody("""
                        {
                          "type": "https://errors.example.com/case-not-found",
                          "title": "Case not found",
                          "status": 404,
                          "detail": "CASE-404 does not exist"
                        }
                    """)));

    CaseProfileResult result = client.getProfile("CASE-404", Deadline.after(Duration.ofSeconds(2)));

    assertTrue(result.isNotFound());
}
```

Error mapping adalah contract. Test harus mengunci semantics.

---

### 5.4 Testing Timeout

Timeout test harus deterministic. Jangan gunakan sleep random tanpa margin.

Contoh dengan delayed response:

```java
@Test
void failsWithRequestTimeoutWhenServerIsTooSlow() {
    fakeServer.stubFor(get("/case-profiles/CASE-SLOW")
            .willReturn(aResponse()
                    .withFixedDelay(2_000)
                    .withStatus(200)
                    .withBody("{}")));

    RemoteCallException ex = assertThrows(
            RemoteCallException.class,
            () -> client.getProfile("CASE-SLOW", Deadline.after(Duration.ofMillis(300)))
    );

    assertEquals(RemoteFailureKind.TIMEOUT, ex.kind());
}
```

Hal yang diuji:

```text
apakah deadline dipakai
apakah error diklasifikasi sebagai timeout
apakah retry tidak melampaui deadline
apakah metric timeout naik
apakah log menyebut dependency dan phase
```

---

### 5.5 Testing Retry

Test retry harus membuktikan:

```text
jumlah attempt
jarak attempt tidak nol jika backoff wajib
request id/correlation id konsisten
idempotency key ada untuk mutation
non-retryable error tidak diretry
retry berhenti saat deadline habis
```

Contoh:

```java
@Test
void retriesIdempotentGetOn503ThenSucceeds() {
    fakeServer.stubFor(get("/case-profiles/CASE-1")
            .inScenario("recover")
            .whenScenarioStateIs(STARTED)
            .willReturn(serverError())
            .willSetStateTo("second"));

    fakeServer.stubFor(get("/case-profiles/CASE-1")
            .inScenario("recover")
            .whenScenarioStateIs("second")
            .willReturn(okJson("{\"caseId\":\"CASE-1\"}")));

    CaseProfileResult result = client.getProfile("CASE-1", Deadline.after(Duration.ofSeconds(2)));

    assertTrue(result.isFound());
    fakeServer.verify(2, getRequestedFor(urlEqualTo("/case-profiles/CASE-1")));
}
```

Test yang harus ada untuk mutation:

```java
@Test
void doesNotRetryPostWithoutIdempotencyKeyAfterAmbiguousFailure() {
    // Simulate connection reset after request may have reached server.
    // Expected: fail as ambiguous, do not replay unsafe mutation.
}
```

---

### 5.6 Testing 429 and Retry-After

```java
@Test
void respectsRetryAfterWithinDeadline() {
    fakeServer.stubFor(get("/quota")
            .inScenario("quota")
            .whenScenarioStateIs(STARTED)
            .willReturn(aResponse()
                    .withStatus(429)
                    .withHeader("Retry-After", "1"))
            .willSetStateTo("ok"));

    fakeServer.stubFor(get("/quota")
            .inScenario("quota")
            .whenScenarioStateIs("ok")
            .willReturn(okJson("{\"available\":true}")));

    Quota quota = quotaClient.check(Deadline.after(Duration.ofSeconds(3)));

    assertTrue(quota.available());
}
```

Tetapi test juga harus mencakup:

```text
Retry-After lebih lama dari remaining deadline => jangan tunggu, fail cepat.
Retry-After malformed => fallback ke policy bounded.
429 untuk mutation => tidak retry kecuali aman.
```

---

### 5.7 Testing Response Body Resource Release

Masalah klasik HTTP client: body tidak dibaca/ditutup sehingga connection tidak kembali ke pool.

Test bisa dilakukan dengan pool kecil:

```text
pool max = 1
server returns error with body
client maps error
then second request must still succeed
```

Jika body leak, request kedua akan hang/pool timeout.

Pseudo-test:

```java
@Test
void releasesConnectionAfterErrorBody() {
    httpClient = clientWithMaxConnections(1);

    fakeServer.stubFor(get("/first").willReturn(aResponse()
            .withStatus(500)
            .withBody("large error body")));

    fakeServer.stubFor(get("/second").willReturn(okJson("{}")));

    assertThrows(RemoteCallException.class, () -> client.first());
    assertDoesNotThrow(() -> client.second());
}
```

---

## 6. Testing Inbound HTTP Server

Inbound server test harus mencakup:

```text
routing
method semantics
content-type
accept negotiation
validation
error mapping
idempotency
authorization
payload limit
timeout/cancellation
streaming behavior
proxy header trust
observability
```

### 6.1 Test Method Semantics

Contoh:

```text
GET must not mutate state.
PUT must be idempotent.
POST mutation must return 201/202/200 according to semantics.
DELETE repeated call must be defined.
PATCH must validate precondition if required.
```

Test idempotency:

```java
@Test
void repeatedPutProducesSameFinalState() {
    PutApplicationRequest request = new PutApplicationRequest("APP-1", "DRAFT");

    api.putApplication("APP-1", request);
    api.putApplication("APP-1", request);

    Application app = repository.find("APP-1");

    assertEquals("DRAFT", app.status());
    assertEquals(1, auditTrail.countBusinessUpdate("APP-1"));
}
```

Catatan: idempotent final state tidak selalu berarti audit row hanya satu. Dalam regulated systems, repeated command bisa punya audit attempt berbeda. Yang penting semantics-nya eksplisit dan dites.

---

### 6.2 Test Error Contract

Jangan biarkan exception framework bocor.

Test:

```java
@Test
void validationErrorUsesProblemJson() {
    Response response = http.post("/applications", "{\"name\":\"\"}");

    assertEquals(422, response.statusCode());
    assertEquals("application/problem+json", response.contentType());
    assertEquals("https://errors.example.com/validation-error", response.jsonPath("$.type"));
    assertEquals(422, response.jsonPath("$.status"));
    assertNotNull(response.jsonPath("$.traceId"));
}
```

Error contract harus stabil agar consumer tidak reverse-engineer pesan error manusia.

---

### 6.3 Test Header Trust Boundary

Jika service di belakang proxy:

```text
Do not trust X-Forwarded-For from public clients.
Only trust forwarded headers from known proxy boundary.
Do not use spoofable header for authorization.
```

Test:

```text
Direct request with X-Forwarded-For: 127.0.0.1 must not be treated as internal.
Request from trusted proxy with Forwarded header may be accepted.
Malformed Forwarded header must fail safely.
```

---

## 7. Testing gRPC Systems

### 7.1 Use In-Process for Fast Component Tests

gRPC Java menyediakan in-process server/channel yang berguna untuk testing karena tidak perlu real socket. `InProcessServerBuilder` dan `InProcessChannelBuilder` dapat menjalankan server dan client dalam proses yang sama, dan dokumentasi gRPC Java menunjukkan pattern penggunaan `directExecutor()` untuk unit/component test.

Contoh shape:

```java
class CaseGrpcServiceTest {
    private Server server;
    private ManagedChannel channel;
    private CaseServiceGrpc.CaseServiceBlockingStub stub;

    @BeforeEach
    void setUp() throws IOException {
        String name = InProcessServerBuilder.generateName();

        server = InProcessServerBuilder.forName(name)
                .directExecutor()
                .addService(new CaseGrpcService(fakeCaseRepository))
                .build()
                .start();

        channel = InProcessChannelBuilder.forName(name)
                .directExecutor()
                .build();

        stub = CaseServiceGrpc.newBlockingStub(channel);
    }

    @AfterEach
    void tearDown() {
        channel.shutdownNow();
        server.shutdownNow();
    }

    @Test
    void returnsNotFoundAsGrpcStatus() {
        StatusRuntimeException ex = assertThrows(
                StatusRuntimeException.class,
                () -> stub.getCase(GetCaseRequest.newBuilder()
                        .setCaseId("MISSING")
                        .build())
        );

        assertEquals(Status.Code.NOT_FOUND, ex.getStatus().getCode());
    }
}
```

Kelebihan:

```text
fast
deterministic
no port conflict
no TLS complexity
suitable for service logic and interceptor tests
```

Keterbatasan:

```text
not testing real HTTP/2 transport
not testing TLS/ALPN
not testing Netty event-loop behavior
not testing proxy/LB behavior
not testing socket failures
```

Jadi in-process test bagus, tapi tidak cukup.

---

### 7.2 Test gRPC Status Mapping

Pastikan domain error dipetakan ke status yang benar:

```text
validation error -> INVALID_ARGUMENT
missing entity -> NOT_FOUND
state conflict -> FAILED_PRECONDITION or ABORTED depending semantics
auth missing -> UNAUTHENTICATED
auth insufficient -> PERMISSION_DENIED
rate limit -> RESOURCE_EXHAUSTED
transient dependency down -> UNAVAILABLE
server bug -> INTERNAL
```

Test:

```java
@Test
void invalidTransitionReturnsFailedPrecondition() {
    StatusRuntimeException ex = assertThrows(
            StatusRuntimeException.class,
            () -> stub.approveCase(ApproveCaseRequest.newBuilder()
                    .setCaseId("CASE-DRAFT")
                    .build())
    );

    assertEquals(Status.Code.FAILED_PRECONDITION, ex.getStatus().getCode());
    assertTrue(ex.getStatus().getDescription().contains("not ready for approval"));
}
```

---

### 7.3 Test Deadlines

Client wrapper harus selalu memberi deadline.

```java
@Test
void clientAppliesDeadline() {
    CaseServiceGrpc.CaseServiceBlockingStub slowStub = stub.withDeadlineAfter(100, TimeUnit.MILLISECONDS);

    StatusRuntimeException ex = assertThrows(
            StatusRuntimeException.class,
            () -> slowStub.longRunningExport(ExportRequest.newBuilder().build())
    );

    assertEquals(Status.Code.DEADLINE_EXCEEDED, ex.getStatus().getCode());
}
```

Server juga harus menghentikan pekerjaan saat context cancelled:

```java
while (!Context.current().isCancelled()) {
    // continue work
}
```

Test cancellation harus membuktikan bahwa worker tidak terus berjalan.

---

### 7.4 Test Streaming Backpressure

Untuk server streaming:

```text
client lambat
server tidak boleh menumpuk semua message di memory
server harus menghormati isReady/onReady
cancellation harus menghentikan producer
```

Pseudo-test:

```java
@Test
void serverStreamingDoesNotBufferUnboundedWhenClientIsSlow() {
    // Use manual flow control / custom observer.
    // Produce many messages.
    // Assert bounded queue never exceeds configured max.
    // Assert server pauses production when not ready.
}
```

Untuk bidi streaming:

```text
ordering
ack
resume
half-close
error mid-stream
client cancellation
server cancellation
```

---

### 7.5 Test Real Transport for Selected Cases

Beberapa kasus harus memakai real socket/Netty:

```text
TLS/mTLS
ALPN
HTTP/2 frame behavior
max inbound message size
keepalive
flow-control edge cases
LB/proxy behavior
connection failure
```

Gunakan:

```text
NettyServerBuilder
ManagedChannelBuilder/NettyChannelBuilder
Testcontainers
Toxiproxy
real certificates
```

---

## 8. Testing TLS/mTLS

TLS bugs sering tidak muncul di unit test karena fake server biasanya HTTP plaintext.

Test yang harus ada untuk system yang memakai TLS/mTLS:

```text
valid server certificate accepted
expired certificate rejected
wrong hostname rejected
unknown CA rejected
client certificate required
wrong client certificate rejected
rotated certificate accepted
truststore missing fails clearly
TLS version/cipher incompatible fails clearly
ALPN negotiation works for HTTP/2/gRPC
```

Local TLS test architecture:

```text
test generates CA
server cert signed by CA
client truststore contains CA
optional client cert for mTLS
server requires client auth
client keystore contains client cert/private key
```

Things to assert:

```text
error classification
no silent fallback to plaintext
no hostname verification disabled
no trust-all manager in production profile
no logging private key/cert secret
```

Anti-pattern:

```java
TrustManager[] trustAll = new TrustManager[] { ... };
HostnameVerifier allowAll = (host, session) -> true;
```

Test should fail if production code uses trust-all behavior.

---

## 9. Testing DNS and Endpoint Discovery

DNS test sulit karena JVM/OS cache dan environment berbeda. Tetapi tetap bisa dites melalui abstraction atau controlled resolver.

Test targets:

```text
DNS failure classification
stale IP behavior
discovery refresh
negative cache behavior
endpoint rotation
connection pool does not pin removed endpoint forever
client handles old connection close
gRPC resolver returns updated addresses
```

Design for testability:

```java
interface EndpointResolver {
    List<Endpoint> resolve(ServiceName serviceName);
}
```

Unit test resolver policy:

```text
empty endpoints -> fail fast or open circuit
changed endpoints -> new connection strategy
unhealthy endpoint removed
TTL honored
```

Integration test can use:

```text
custom DNS container
Kubernetes headless service test
fake resolver for gRPC NameResolver
Toxiproxy per endpoint
```

---

## 10. Testing Proxy/Gateway/Load Balancer Behavior

Production path often includes:

```text
client -> proxy -> gateway -> ingress -> service
```

Test should cover:

```text
X-Forwarded-* and Forwarded handling
trusted proxy boundary
gateway timeout mapping
body size limit
header size limit
connection draining
idle timeout mismatch
chunked transfer behavior
HTTP/2 to HTTP/1.1 downgrade
proxy buffering breaks streaming
request id propagation
client IP preservation
TLS termination
mTLS hop behavior
```

Integration environment can include Nginx/Envoy container.

Example experiment:

```text
Nginx proxy_read_timeout = 1s
Java server sleeps 2s
Expected client sees 504 from proxy
Expected server may still continue unless cancellation propagated
Expected logs distinguish gateway timeout from app timeout
```

---

## 11. Testing Connection Pooling

Connection pool behavior is frequently untested until production outage.

Test matrix:

```text
pool max reached
pending acquisition timeout
idle eviction
stale connection after LB close
connection TTL rotation
response body leak
long streaming call does not starve short call
bulkhead per dependency
HTTP/2 max concurrent streams queueing
```

Example body leak test was shown earlier.

Pool saturation test:

```text
pool size = 1
request A blocks server
request B attempts call
B should fail with pool acquisition timeout within configured limit
metric pool_pending should be visible
```

This test prevents hidden infinite waits.

---

## 12. Testing Timeout Hierarchy

Timeout tests should verify hierarchy:

```text
connect timeout < request deadline
pool acquisition timeout < request deadline
read timeout < request deadline
retry backoff must fit remaining deadline
server timeout should be slightly less than gateway timeout or vice versa depending contract
```

Bad timeout test:

```text
Set timeout 100ms, server sleeps 101ms.
```

This is flaky.

Better:

```text
Set timeout 200ms, server never responds or sleeps 5s.
Assert failure below 1s.
Do not assert exact millisecond.
```

Use broad bounds:

```java
long started = System.nanoTime();
assertThrows(RemoteCallException.class, () -> client.callSlow());
long elapsedMs = Duration.ofNanos(System.nanoTime() - started).toMillis();

assertTrue(elapsedMs >= 150);
assertTrue(elapsedMs < 1_000);
```

---

## 13. Testing Retry and Idempotency

Retry tests must check both positive and negative cases.

### 13.1 Positive Retry

```text
GET 503 then 200 -> retry once and succeed
GET connection reset before response -> retry if deadline remains
POST with idempotency key 503 then 201 -> retry and no duplicate effect
```

### 13.2 Negative Retry

```text
POST without idempotency key ambiguous failure -> no retry
400 -> no retry
401 after refresh already attempted -> no retry loop
403 -> no retry
404 -> no retry except eventually-consistent read policy explicitly allows
409 -> no blind retry
request deadline insufficient -> no retry
body is non-replayable stream -> no retry
```

### 13.3 Duplicate Suppression Test

For mutation:

```text
first attempt reaches server but response lost
client retries with same idempotency key
server returns same operation result
only one business effect happens
both attempts may be audited as attempts
```

Test design:

```java
@Test
void repeatedIdempotencyKeyDoesNotCreateDuplicateApplication() {
    String key = UUID.randomUUID().toString();

    CreateApplicationRequest request = new CreateApplicationRequest("EA", "Applicant A");

    ApplicationResult first = api.createApplication(request, key);
    ApplicationResult second = api.createApplication(request, key);

    assertEquals(first.applicationId(), second.applicationId());
    assertEquals(1, repository.countByApplicant("Applicant A"));
    assertEquals(2, audit.countAttemptsByIdempotencyKey(key));
}
```

---

## 14. Testing Streaming

Streaming test harus menolak dua ekstrem:

```text
membaca semua ke memory
mengabaikan slow consumer
```

### 14.1 HTTP Streaming Download Test

```text
server sends 10GB-like stream simulated by chunks
client writes to temp file
memory stays bounded
checksum validated
partial failure cleans temp file
```

### 14.2 HTTP Streaming Upload Test

```text
client streams file
server reads slowly
client timeout/backpressure works
no full file loaded to heap
```

### 14.3 SSE Test

```text
client receives event id 1,2,3
connection drops
client reconnects with Last-Event-ID: 3
server resumes from 4
heartbeat keeps connection alive
proxy buffering disabled
```

### 14.4 WebSocket Test

```text
ping/pong liveness
slow client bounded outbound queue
reconnect resume
session cleanup on close
sticky session or external pub/sub behavior
```

### 14.5 gRPC Streaming Test

```text
manual flow control honored
client cancellation stops server producer
server error mid-stream propagates status
partial result semantics defined
```

---

## 15. Testing Large Payload and File Transfer

Test cases:

```text
valid small upload
valid large upload
payload exceeds max size
slow upload
client disconnect mid-upload
checksum mismatch
malware scan fail
metadata valid but file missing
file stored but DB commit fails
DB commit succeeds but object store commit fails
range download
resume upload
duplicate upload id
orphan cleanup
```

Important invariant:

```text
No uncommitted file should become visible as final evidence.
No failed upload should create final business state.
No retried upload should create duplicate final object.
```

State machine test:

```text
INITIATED -> UPLOADING -> UPLOADED -> SCANNING -> ACCEPTED -> COMMITTED
                                  -> REJECTED
                                  -> EXPIRED
```

For regulated systems, test audit events for each transition.

---

## 16. Security Testing for Network Code

Security test should be part of normal pipeline, not separate annual ritual.

Test matrix:

```text
SSRF blocked for localhost/private CIDR/metadata IP
redirect to private IP blocked
DNS rebinding prevented or revalidated
header injection rejected
CRLF in header value rejected
large header rejected
Content-Length/Transfer-Encoding ambiguity rejected by proxy/server setup
XXE disabled
entity expansion rejected
Java deserialization forbidden or filtered
JSON polymorphic deserialization restricted
zip slip rejected
decompression bomb rejected
secrets redacted in logs/traces
Authorization header not propagated to untrusted host
cookies not logged
```

Example SSRF test:

```java
@Test
void blocksMetadataEndpointImportUrl() {
    URI uri = URI.create("http://169.254.169.254/latest/meta-data/iam/security-credentials/");

    assertThrows(SecurityException.class, () -> importClient.importFrom(uri));
}
```

But SSRF test must also cover:

```text
http://localhost
http://127.0.0.1
http://[::1]
http://0.0.0.0
http://10.0.0.1
http://172.16.0.1
http://192.168.0.1
redirect to internal
DNS name resolving to internal
DNS rebind after validation
integer/hex/IPv6-embedded forms
```

---

## 17. Property-Based and Fuzz Testing

Network parsers and protocol boundaries benefit from fuzz/property tests.

Useful targets:

```text
URL parser/validator
header parser
pagination cursor parser
idempotency key parser
problem+json parser
custom binary protocol frame decoder
length-prefix decoder
CSV/NDJSON streaming parser
multipart parser wrapper
```

Properties:

```text
parser never throws unexpected exception type
invalid input fails safely
size limit always enforced
round-trip encode/decode preserves value
unknown fields ignored where required
canonicalization is stable
malformed input never creates side effect
```

Example property:

```text
For any header value containing CR or LF,
request builder must reject it before transport.
```

Fuzz testing is especially valuable for custom protocol parser and security-sensitive importers.

---

## 18. Determinism and Flakiness Control

Network tests easily become flaky. Top-tier engineers design for determinism.

Avoid:

```text
real internet dependency
sleep-based waiting
assert exact timing
shared ports
shared global JVM properties
unbounded retry
parallel tests sharing fake server state
DNS cache pollution
random clock
real wall-clock dependency
```

Prefer:

```text
fake clock
controlled executor
random port allocation
per-test fake server
scenario-based fake server
bounded assert time
awaitility-style polling with timeout
isolated containers
explicit cleanup
unique idempotency keys
explicit JVM DNS cache settings in test fork
```

Timing assertion rule:

```text
Do not assert: timeout happens at exactly 200ms.
Assert: timeout happens after about 200ms and before a safe upper bound.
```

---

## 19. Test Observability Itself

A network feature is not production-ready unless it emits usable signals.

Test should verify:

```text
traceparent propagated
correlation id propagated
dependency name included in metric
method/route normalized, not raw high-cardinality URL
status/failure kind recorded
attempt count recorded
retry reason recorded
timeout phase recorded
pool saturation metric exists
payload not logged
secret redaction works
```

Example assertions:

```java
@Test
void recordsTimeoutMetricWithDependencyAndOperation() {
    fakeServer.stubFor(get("/slow").willReturn(aResponse().withFixedDelay(5_000)));

    assertThrows(RemoteCallException.class, () -> client.callSlow());

    assertMetricExists("remote_client_requests_total",
            tag("dependency", "case-profile"),
            tag("operation", "getProfile"),
            tag("outcome", "timeout"));
}
```

Logs should be tested with log appender or structured logging collector in test.

---

## 20. Test Data and Golden Files

Network payloads often need golden files.

Use golden files for:

```text
complex JSON problem details
real-world malformed-but-accepted legacy payload
large but sanitized sample payload
protobuf binary compatibility fixture
XML namespace/canonicalization sample
CSV edge cases
multipart boundary sample
```

Rules:

```text
store sanitized payloads only
avoid production secrets/PII
version golden files
make expected semantics explicit
avoid brittle whitespace-only snapshots
include backward compatibility fixtures
```

For Protobuf:

```text
serialize old message fixture
new parser must read it
serialize new message with added field
old parser should ignore unknown field if compatibility requires
```

---

## 21. CI Strategy

Not all tests should run at the same frequency.

Suggested split:

### Every Commit

```text
unit tests
policy tests
request/response mapping tests
schema lint
protobuf breaking check
fast fake server tests
gRPC in-process tests
security parser tests
```

### Pull Request / Merge Gate

```text
WireMock/MockWebServer component tests
Testcontainers integration tests
TLS local tests
selected Toxiproxy fault tests
contract tests
observability assertions
```

### Nightly

```text
full integration matrix
longer timeout/retry tests
pool saturation tests
streaming tests
large payload tests
compatibility replay tests
performance smoke test
```

### Pre-Release

```text
chaos experiments in staging
gateway/proxy tests
deployment draining tests
canary validation
shadow traffic comparison
soak test
p95/p99 regression test
```

### Production Safe Probes

```text
synthetic dependency checks
read-only canary call
limited chaos with strict blast radius
observability verification
certificate expiry monitor
DNS resolution monitor
```

---

## 22. Example: Production-Grade HTTP Client Test Plan

Suppose we have `ExternalProfileClient`.

### Unit Tests

```text
builds correct URI
escapes path variables
adds required headers
does not add forbidden headers
maps 200
maps 404
maps 409
maps 429
maps malformed JSON
retry decision matrix
backoff calculation
redaction logic
```

### Component Tests with Fake Server

```text
sends correct request
handles delayed response timeout
handles connection reset
retries 503 once
does not retry POST without idempotency key
refreshes token once on 401
honors Retry-After
rejects oversized response
closes response body on error
propagates traceparent
records metrics
```

### Integration Tests

```text
TLS truststore valid
wrong hostname rejected
proxy path works
pool max saturation behavior
large response streaming
object mapper config compatible
```

### Fault Injection Tests

```text
Toxiproxy latency
Toxiproxy timeout/blackhole
bandwidth limit
server closes connection mid-body
proxy returns 504
```

### Chaos/Staging

```text
downstream 50% 503 for 10 minutes
gateway idle timeout lower than client idle TTL
downstream slow p99 for 5 minutes
certificate rotation drill
```

---

## 23. Example: gRPC Client Test Plan

For `CaseDecisionGrpcClient`:

### Unit Tests

```text
maps domain command to protobuf
validates required fields
maps status codes to typed domain errors
applies deadline policy
classifies retryable status
redacts metadata
```

### In-Process Tests

```text
unary success
NOT_FOUND mapping
FAILED_PRECONDITION mapping
metadata propagation
interceptor adds correlation id
deadline exceeded
server cancellation observed
```

### Real Transport Tests

```text
Netty channel startup
TLS/mTLS
max inbound message size
large metadata rejected
keepalive policy
connection shutdown
```

### Streaming Tests

```text
server streaming backpressure
client streaming chunk upload
bidi ack/resume protocol
cancellation cleanup
partial failure semantics
```

### Fault Injection

```text
server returns UNAVAILABLE then OK
server stalls stream
server closes connection
Toxiproxy latency
Toxiproxy bandwidth limit
```

---

## 24. Example: Replay-Based Compatibility Test

Scenario:

```text
A Java service upgrades external API client from Apache HttpClient to JDK HttpClient.
```

Risk:

```text
different redirect behavior
different header casing/order
different timeout semantics
different cookie behavior
different HTTP/2 negotiation
different body streaming behavior
```

Replay plan:

```text
1. Collect sanitized historical request fixtures.
2. Replay fixtures against fake server with strict request verification.
3. Compare old client and new client outbound request shape.
4. Replay historical response fixtures into both clients.
5. Compare domain result mapping.
6. Inject representative faults.
7. Compare metrics/log output.
```

Diff dimensions:

```text
method
path
query encoding
headers
body
timeout
retry attempt count
error mapping
observability tags
```

---

## 25. Testing in Regulatory / Case Management Systems

Untuk sistem enforcement/case management, testing networked system harus memperhatikan:

```text
auditability
idempotency
duplicate side effect
state transition correctness
authorization context
case confidentiality
long-running workflow
external agency dependency
file/evidence integrity
notification delivery
partial failure and compensation
```

Contoh test penting:

```text
External identity provider timeout does not create partial login session.
Payment callback duplicate does not create duplicate receipt.
Evidence upload retry does not create duplicate evidence record.
Approval API retry does not approve twice.
Email delivery failure records pending notification, not silent success.
External agency API 503 moves sync job to retryable state with audit trail.
Case status transition fails atomically if downstream document generation fails.
```

Invariant yang harus dites:

```text
No remote uncertainty may silently become business certainty.
No retry may create duplicate legal/business effect.
No technical failure may erase audit evidence.
No external data import may bypass validation/authorization.
No partial network success may be represented as final domain success.
```

---

## 26. Anti-Patterns

### 26.1 Mocking the HTTP Client Interface Only

```java
when(httpClient.get(...)).thenReturn(...)
```

Ini tidak menguji:

```text
real request shape
headers
timeouts
body handling
status parsing
connection release
```

Gunakan untuk business logic, bukan untuk network behavior.

---

### 26.2 Testing Only 200 OK

Jika hanya ada test 200 OK, berarti sistem tidak dites sebagai distributed system.

Minimal harus ada:

```text
4xx
5xx
timeout
malformed response
large response
slow response
retry/no retry
```

---

### 26.3 Infinite Timeout in Tests

Test yang memakai infinite timeout bisa hang CI dan menyembunyikan bug.

Semua network test harus punya test-level timeout.

---

### 26.4 Sleep-Based Flaky Test

```java
Thread.sleep(500);
assertTrue(done);
```

Ganti dengan polling bounded:

```java
await().atMost(Duration.ofSeconds(2)).untilAsserted(() -> assertTrue(done.get()));
```

---

### 26.5 Real External Sandbox in Unit/CI Tests

Real sandbox menyebabkan:

```text
flaky
slow
rate-limited
non-deterministic
credential risk
hard-to-debug
```

Gunakan sandbox untuk limited integration/certification, bukan unit pipeline.

---

### 26.6 Not Testing Observability

Jika test tidak memverifikasi metrics/log/traces, incident nanti akan buta.

---

### 26.7 Chaos Without Blast Radius

Chaos test tanpa scope, rollback, dan hypothesis adalah operational risk.

---

## 27. Practical Checklist

Sebelum networked Java component dianggap production-ready, tanyakan:

```text
[ ] Apakah semua outbound call punya timeout/deadline?
[ ] Apakah retry policy dites untuk retry dan no-retry cases?
[ ] Apakah mutation retry membutuhkan idempotency key?
[ ] Apakah duplicate suppression dites?
[ ] Apakah 4xx/5xx/error body mapping dites?
[ ] Apakah malformed/oversized response dites?
[ ] Apakah response body release dites?
[ ] Apakah connection pool saturation dites?
[ ] Apakah TLS trust/hostname/mTLS dites jika relevan?
[ ] Apakah proxy/gateway behavior dites jika production path memakainya?
[ ] Apakah DNS/discovery behavior punya abstraction/test?
[ ] Apakah streaming punya backpressure/cancellation test?
[ ] Apakah large payload tidak masuk heap seluruhnya?
[ ] Apakah SSRF/header injection/deserialization risk dites?
[ ] Apakah observability signal dites?
[ ] Apakah contract compatibility dites?
[ ] Apakah chaos/fault experiment punya hypothesis dan rollback?
```

---

## 28. Mental Model Akhir

Testing networked Java systems bukan tentang menambah mock sebanyak mungkin.

Testing yang matang bertanya:

```text
Apa contract-nya?
Apa state machine-nya?
Apa resource boundary-nya?
Apa failure taxonomy-nya?
Apa retry/idempotency semantics-nya?
Apa observability signal-nya?
Apa blast radius-nya?
Apa bukti bahwa behavior tetap benar saat network tidak kooperatif?
```

Engineer biasa mengetes function.

Engineer senior mengetes integration.

Engineer top-tier mengetes **assumption**.

Assumption yang harus dihancurkan dalam test:

```text
remote selalu cepat
remote selalu benar
network selalu stabil
response selalu lengkap
connection selalu reusable
DNS selalu fresh
TLS selalu valid
retry selalu aman
stream consumer selalu cepat
payload selalu kecil
proxy transparan
observability otomatis cukup
```

Dalam production distributed systems, bug paling mahal sering muncul dari assumption yang tidak pernah dites.

---

## 29. Latihan

### Latihan 1 — HTTP Client Failure Matrix

Ambil satu client HTTP di sistemmu. Buat matrix:

```text
status code
network failure
timeout phase
retry decision
idempotency requirement
error mapping
metric/log expected
```

Lalu implementasikan minimal 10 component tests dari matrix tersebut.

---

### Latihan 2 — gRPC Status Contract

Ambil satu gRPC service. Definisikan mapping:

```text
domain validation error -> ?
missing entity -> ?
invalid state transition -> ?
concurrent modification -> ?
downstream unavailable -> ?
rate limited -> ?
```

Buat test yang mengunci mapping tersebut.

---

### Latihan 3 — Retry Safety Test

Buat mutation API yang sengaja mengalami response loss setelah commit.

Expected:

```text
retry dengan idempotency key menghasilkan satu business effect
retry tanpa idempotency key ditolak atau tidak dilakukan
```

---

### Latihan 4 — Pool Leak Test

Set pool max connection kecil.

Simulasikan error response dengan body.

Pastikan request berikutnya tetap berhasil.

---

### Latihan 5 — Streaming Cancellation Test

Buat server streaming endpoint.

Client membatalkan stream setelah 5 message.

Pastikan producer server berhenti dan queue dibersihkan.

---

### Latihan 6 — TLS Negative Test

Buat local TLS server dengan certificate hostname berbeda.

Pastikan client production profile menolak koneksi.

---

### Latihan 7 — Observability Test

Buat fake timeout.

Pastikan metric/log/trace memuat:

```text
dependency
operation
failure kind
timeout phase
attempt count
correlation id
```

Dan tidak memuat:

```text
Authorization
Cookie
token
password
PII sensitive payload
```

---

## 30. Ringkasan

Bagian ini membangun pendekatan testing untuk Java networked systems:

```text
unit test untuk policy dan mapping
component test dengan fake server untuk behavior HTTP/gRPC
contract test untuk compatibility
integration test untuk real runtime boundaries
fault injection untuk failure deterministic
chaos test untuk hypothesis resilience
replay test untuk real-world compatibility
observability test untuk incident readiness
security test untuk hostile input/network path
```

Prinsip terpenting:

> Test bukan hanya membuktikan sistem bekerja saat benar. Test harus membuktikan sistem gagal dengan cara yang aman, terbatas, observable, dan sesuai semantics saat dunia luar berperilaku buruk.

---

## 31. Referensi

- WireMock Documentation — Request Matching, Simulating Faults, Response Templating.
- OkHttp Documentation — MockWebServer and HTTP client testing ecosystem.
- gRPC Java Javadoc — `InProcessServerBuilder`, `InProcessChannelBuilder`, testing support.
- gRPC Documentation — Status Codes, Deadlines, Cancellation, Flow Control, Retry.
- Testcontainers Documentation — Toxiproxy Module.
- Shopify Toxiproxy — TCP proxy for simulating network conditions.
- OpenTelemetry Documentation — Java instrumentation and semantic conventions.
- RFC 9110 — HTTP Semantics.
- RFC 9112 — HTTP/1.1.
- RFC 9113 — HTTP/2.
- OWASP Cheat Sheets — SSRF Prevention, Deserialization, XXE, Logging, DoS.

---

## 32. Status Seri

```text
Part 32 of 35 selesai.
Seri belum selesai.
Part berikutnya: Part 33 — Production Failure Catalogue: Diagnosing Real Incidents
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./031-security-beyond-tls-ssrf-request-smuggling-deserialization-header-injection-dos-data-leakage.md">⬅️ Part 31 — Security Beyond TLS: SSRF, Request Smuggling, Deserialization, Header Injection, DoS, and Data Leakage</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./033-production-failure-catalogue-diagnosing-real-incidents.md">Part 33 — Production Failure Catalogue: Diagnosing Real Incidents ➡️</a>
</div>
