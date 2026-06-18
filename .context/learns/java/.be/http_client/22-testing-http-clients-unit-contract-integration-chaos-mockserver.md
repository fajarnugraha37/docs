# Part 22 — Testing HTTP Clients: Unit, Contract, Integration, Chaos, Mock Server

Series: `learn-java-http-client-okhttp-retrofit-client-engineering`  
File: `22-testing-http-clients-unit-contract-integration-chaos-mockserver.md`

> HTTP client testing bukan sekadar memastikan `GET /users/1` mengembalikan object Java. Tujuan sebenarnya adalah memastikan boundary eksternal tetap benar ketika dunia luar lambat, rusak, berubah kontrak, mengembalikan payload aneh, memutus koneksi, menolak rate limit, mengubah certificate, atau memberi respons sukses secara HTTP tetapi gagal secara bisnis.

---

## 1. Posisi Materi Ini dalam Series

Di part sebelumnya kita sudah membahas:

1. lifecycle request,
2. URI/encoding,
3. headers,
4. body handling,
5. timeout,
6. pooling,
7. DNS/proxy/LB/NAT,
8. TLS/mTLS,
9. authentication,
10. retry/rate limit/circuit breaker,
11. error modelling,
12. observability.

Part ini menyatukan semua itu dalam **testing strategy**.

HTTP client production-grade harus bisa menjawab pertanyaan berikut:

- Apakah request yang dikirim benar?
- Apakah header/auth/correlation/idempotency key benar?
- Apakah timeout, retry, fallback, dan rate limit bekerja seperti policy?
- Apakah response body selalu ditutup?
- Apakah error external diterjemahkan ke domain error dengan benar?
- Apakah client aman terhadap payload rusak, response besar, response lambat, connection reset, dan partial write?
- Apakah kontrak consumer-provider masih kompatibel?
- Apakah observability cukup untuk incident?
- Apakah test suite membantu perubahan, bukan menjadi beban rapuh?

---

## 2. Core Mental Model: HTTP Client Test adalah Boundary Test

HTTP client berada di boundary antara sistem kita dan sistem eksternal.

```text
Application Use Case
  -> Outbound Port
  -> API Client Adapter
  -> HTTP Client Library
  -> Network / Mock Server / Real Provider
```

Ada dua jebakan umum:

1. **Terlalu banyak mock internal**  
   Test hanya memverifikasi method Java dipanggil, tetapi tidak memverifikasi request HTTP yang benar-benar terbentuk.

2. **Terlalu banyak real integration**  
   Test bergantung ke sistem eksternal nyata, lambat, flaky, mahal, dan sulit mensimulasikan failure.

Pendekatan matang adalah layered testing:

```text
Fast semantic test
  -> Unit test domain translation
  -> Adapter test with fake transport
  -> HTTP interaction test with mock server
  -> Contract test
  -> Integration test against controlled environment
  -> Fault injection / chaos-style test
  -> Production synthetic probe
```

Masing-masing layer punya tujuan berbeda. Jangan pakai satu jenis test untuk semua hal.

---

## 3. Testing Pyramid untuk HTTP Client

### 3.1 Unit Test

Tujuan:

- mapping DTO ke domain,
- error classification,
- retry decision function,
- timeout policy derivation,
- header construction function,
- URI builder function,
- redaction function,
- idempotency key generation,
- pagination iterator logic.

Karakteristik:

- cepat,
- tidak membuka socket,
- deterministik,
- tidak bergantung pada server.

Contoh yang cocok untuk unit test:

```java
@Test
void classify_429_with_retry_after_as_retryable_rate_limited() {
    ExternalHttpError error = ExternalHttpError.httpStatus(
            429,
            Map.of("Retry-After", List.of("3")),
            "{\"error\":\"too_many_requests\"}"
    );

    RetryDecision decision = classifier.classify(error);

    assertThat(decision.retryable()).isTrue();
    assertThat(decision.reason()).isEqualTo("RATE_LIMITED");
    assertThat(decision.minDelay()).isEqualTo(Duration.ofSeconds(3));
}
```

Hal yang tidak cukup hanya dengan unit test:

- apakah path/query benar-benar ter-encode sesuai library,
- apakah header case/duplicate behavior sesuai,
- apakah response body ditutup,
- apakah timeout library benar-benar berlaku,
- apakah interceptor ordering benar,
- apakah multipart body benar,
- apakah TLS/proxy/pooling behavior benar.

---

### 3.2 Adapter Test dengan Fake Transport

Jika client architecture sudah memakai port/adapter, kita bisa mengganti transport dengan fake implementation.

Contoh struktur:

```java
interface HttpTransport {
    HttpResult execute(HttpCommand command);
}

final class ExternalPaymentClient {
    private final HttpTransport transport;
    private final PaymentMapper mapper;

    PaymentStatus getPaymentStatus(PaymentId id) {
        HttpCommand command = HttpCommand.get("/payments/" + id.value());
        HttpResult result = transport.execute(command);
        return mapper.toPaymentStatus(result);
    }
}
```

Fake transport test:

```java
@Test
void maps_404_to_payment_not_found() {
    FakeHttpTransport transport = new FakeHttpTransport()
            .respondWith(HttpResult.status(404, "{\"code\":\"PAYMENT_NOT_FOUND\"}"));

    ExternalPaymentClient client = new ExternalPaymentClient(transport, mapper);

    assertThatThrownBy(() -> client.getPaymentStatus(new PaymentId("p-123")))
            .isInstanceOf(PaymentNotFoundException.class);
}
```

Kelebihan:

- sangat cepat,
- cocok untuk domain/error translation,
- tidak perlu socket.

Kekurangan:

- tidak membuktikan request HTTP aktual,
- bisa berbeda dari behavior library nyata,
- tidak menangkap encoding/body/header issue.

---

### 3.3 HTTP Interaction Test dengan Mock Server

Ini layer paling penting untuk HTTP client.

Mock server menerima request melalui socket lokal seperti server biasa, sehingga client menjalankan logic transport nyata:

```text
Client under test
  -> real JDK HttpClient / OkHttp / Retrofit / Apache / Spring
  -> localhost mock server
  -> canned response / fault / verification
```

Kelebihan:

- request benar-benar melewati HTTP stack,
- bisa verifikasi method, path, query, header, body,
- bisa simulasi delay, 429, 500, malformed JSON,
- tidak bergantung pada external provider.

Kekurangan:

- lebih lambat dari unit test,
- perlu lifecycle server,
- perlu menghindari port conflict,
- belum menjamin provider asli kompatibel.

---

### 3.4 Contract Test

Contract test memastikan consumer dan provider sepakat pada kontrak.

Ada dua arah:

1. **Consumer-driven contract**  
   Consumer mendefinisikan request/response expectation. Provider harus memenuhi kontrak itu.

2. **Provider contract validation**  
   Consumer menguji client terhadap OpenAPI/spec/stub resmi provider.

Contract test menjawab:

- apakah field yang consumer butuhkan masih ada,
- apakah enum baru tidak merusak parsing,
- apakah error body masih sesuai,
- apakah pagination/token format berubah,
- apakah status code berubah.

Contract test tidak menggantikan integration test karena provider bisa memenuhi kontrak tetapi environment/auth/network tetap bermasalah.

---

### 3.5 Integration Test

Integration test memanggil environment provider nyata atau controlled test environment.

Tujuan:

- validasi TLS/mTLS/certificate,
- validasi credential nyata,
- validasi proxy/network route,
- validasi actual provider behavior,
- validasi schema yang tidak terdokumentasi,
- validasi rate limit secara terbatas,
- validasi deployment/config.

Risiko:

- flaky,
- mahal,
- lambat,
- bisa mengubah state provider,
- sulit disimulasikan untuk negative case.

Aturan praktis:

- jalankan integration test lebih sedikit,
- pisahkan dari fast test,
- gunakan test account/test tenant,
- hindari destructive test ke production,
- berikan marker/tag seperti `@Tag("integration")`,
- jangan wajibkan semua integration test untuk setiap commit jika environment tidak stabil.

---

### 3.6 Chaos-Style / Fault Injection Test

Untuk HTTP client, “chaos” tidak harus langsung cluster-level chaos. Bisa dimulai dengan fault injection lokal:

- slow response,
- slow body,
- connection reset,
- empty response,
- invalid chunk,
- malformed JSON,
- huge body,
- 429 storm,
- 503 then success,
- TLS failure,
- DNS failure,
- pool starvation,
- server closes idle connection,
- timeout before/after side effect possible.

Tujuannya bukan membuktikan semua failure di dunia, tetapi memastikan policy client tidak runtuh saat failure umum terjadi.

---

## 4. Apa yang Harus Diuji pada HTTP Client

HTTP client production-grade minimal perlu test coverage untuk area berikut.

---

### 4.1 Request Construction

Validasi:

- HTTP method,
- scheme/host/base URL,
- path,
- path segment encoding,
- query parameter encoding,
- repeated query parameter,
- optional query omitted correctly,
- trailing slash behavior,
- canonical request untuk signing,
- header wajib,
- body content type,
- body shape.

Contoh assertion:

```text
Expected:
GET /v1/users/u-123/orders?status=OPEN&status=PENDING
Authorization: Bearer <redacted>
X-Correlation-Id: test-correlation
Accept: application/json

No request body
```

Bug umum:

- path variable mengandung `/` lalu salah encode,
- query parameter null berubah menjadi string `null`,
- double encoding `%2F` menjadi `%252F`,
- base URL salah slash,
- header auth tidak ikut karena interceptor ordering salah,
- `Content-Type` dikirim untuk GET tanpa body,
- sensitive token masuk query string.

---

### 4.2 Authentication and Authorization

Validasi:

- token ditambahkan pada request,
- token tidak dilog,
- token refresh sebelum expiry,
- single-flight refresh saat concurrent request,
- 401 handling tidak infinite loop,
- API key tidak dikirim ke host redirect yang tidak dipercaya,
- HMAC signature cocok dengan canonical request,
- timestamp skew ditangani.

Test penting:

```text
Given access token expired
When 20 concurrent requests are sent
Then only 1 refresh request is made
And all requests use the refreshed token
```

---

### 4.3 Timeout Behavior

Validasi:

- connect timeout,
- response/read timeout,
- call timeout,
- per-attempt timeout,
- total deadline,
- retry stops when deadline exhausted,
- cancellation propagates,
- no thread leak after timeout.

Test harus hati-hati: jangan membuat test tidur lama. Gunakan timeout kecil dan controlled delay.

Contoh skenario:

```text
Server delays response headers by 500ms
Client response timeout is 100ms
Expected: client fails with classified timeout within bounded time
```

---

### 4.4 Retry Behavior

Validasi:

- retry hanya untuk retryable failure,
- no retry untuk validation/business error,
- no retry untuk non-repeatable body,
- retry count benar,
- backoff/jitter bisa diuji dengan fake clock bila memungkinkan,
- `Retry-After` dihormati,
- retry tidak melebihi deadline,
- idempotency key konsisten antar retry.

Skenario:

```text
Attempt 1: 503
Attempt 2: 503
Attempt 3: 200
Expected:
- 3 requests received
- same Idempotency-Key used
- result success
- metric retry.count = 2
```

---

### 4.5 Rate Limit, Bulkhead, and Load Shedding

Validasi:

- concurrency limit bekerja,
- queue limit bekerja,
- request ditolak cepat saat saturated,
- 429 parsing benar,
- `Retry-After` diikuti,
- traffic class isolation benar,
- downstream A lambat tidak menghabiskan resource downstream B.

Skenario:

```text
Given max concurrent calls to provider X = 2
When 10 calls are triggered concurrently
Then only 2 are in-flight to provider X
And excess calls wait or fail fast according to policy
```

---

### 4.6 Circuit Breaker and Fallback

Validasi:

- breaker open setelah threshold,
- saat open request tidak dikirim ke server,
- half-open hanya mengizinkan probe terbatas,
- fallback hanya untuk failure yang aman,
- fallback metric/log jelas,
- failure classification tidak tercampur.

Skenario:

```text
Given provider returns 500 repeatedly
When failure rate exceeds threshold
Then circuit opens
And subsequent calls fail fast without hitting mock server
```

---

### 4.7 Error Mapping

Validasi:

- 400 validation error,
- 401 auth error,
- 403 permission error,
- 404 not found,
- 409 conflict,
- 422 semantic error,
- 429 rate limit,
- 500 provider error,
- malformed response,
- empty body with 204,
- error body not JSON,
- error body huge.

Tujuan: memastikan external failure diterjemahkan ke exception/result domain yang benar.

---

### 4.8 Body Handling

Validasi:

- JSON serialize/deserialize,
- unknown fields tolerated jika kontrak mengizinkan,
- missing mandatory fields rejected,
- enum unknown behavior,
- date/time parsing,
- BigDecimal precision,
- multipart format,
- streaming download tidak load semua ke memory,
- response body selalu ditutup,
- upload body repeatability untuk retry.

Skenario penting:

```text
Server returns 200 with malformed JSON
Expected:
- classified as decode failure
- no retry unless explicitly configured
- response body closed
- diagnostic includes provider/status/content-type but not raw sensitive body
```

---

### 4.9 Observability

Validasi:

- correlation ID dikirim,
- `traceparent` propagated,
- logs tidak memuat token/secret/PII,
- metric status code punya bounded cardinality,
- retry metric increment,
- timeout classification metric benar,
- fallback/circuit breaker event tercatat.

Testing observability sering diabaikan, padahal saat incident inilah yang menentukan apakah root cause dapat ditemukan cepat.

---

## 5. Mock Server Options di Java

---

## 5.1 OkHttp MockWebServer

MockWebServer cocok untuk HTTP client tests yang ringan, terutama jika client memakai OkHttp/Retrofit, tetapi juga bisa dipakai untuk JDK HttpClient, Apache, atau Spring karena server-nya HTTP biasa.

Kapan cocok:

- test request/response sederhana,
- verifikasi path/header/body,
- enqueue response berurutan,
- test Retrofit/OkHttp client,
- local fast integration test.

Contoh dependency Gradle:

```gradle
// Sesuaikan versi dengan OkHttp yang dipakai project
// OkHttp 4.x umum dipakai di banyak Java 8+ project
// OkHttp 5.x memakai package/API yang bisa berbeda pada module tertentu

testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
testImplementation("org.junit.jupiter:junit-jupiter:5.10.2")
```

Contoh JUnit 5:

```java
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;

import static org.assertj.core.api.Assertions.assertThat;

class UserClientTest {
    private MockWebServer server;
    private UserClient client;

    @BeforeEach
    void setUp() throws IOException {
        server = new MockWebServer();
        server.start();

        String baseUrl = server.url("/").toString();
        client = UserClient.create(baseUrl);
    }

    @AfterEach
    void tearDown() throws IOException {
        server.shutdown();
    }

    @Test
    void sends_expected_request_and_maps_response() throws Exception {
        server.enqueue(new MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", "application/json")
                .setBody("{\"id\":\"u-1\",\"name\":\"Alice\"}"));

        User user = client.getUser("u-1");

        assertThat(user.id()).isEqualTo("u-1");
        assertThat(user.name()).isEqualTo("Alice");

        RecordedRequest request = server.takeRequest();
        assertThat(request.getMethod()).isEqualTo("GET");
        assertThat(request.getPath()).isEqualTo("/users/u-1");
        assertThat(request.getHeader("Accept")).isEqualTo("application/json");
    }
}
```

Untuk retry sequence:

```java
@Test
void retries_503_then_succeeds() throws Exception {
    server.enqueue(new MockResponse().setResponseCode(503));
    server.enqueue(new MockResponse().setResponseCode(200)
            .setHeader("Content-Type", "application/json")
            .setBody("{\"status\":\"OK\"}"));

    Status status = client.checkStatus();

    assertThat(status.value()).isEqualTo("OK");
    assertThat(server.getRequestCount()).isEqualTo(2);
}
```

Untuk delay:

```java
server.enqueue(new MockResponse()
        .setResponseCode(200)
        .setHeadersDelay(500, java.util.concurrent.TimeUnit.MILLISECONDS)
        .setBody("{}"));
```

Catatan:

- gunakan dynamic port dari `server.url("/")`, jangan hardcode port,
- selalu shutdown server,
- gunakan `takeRequest(timeout, unit)` agar test tidak hang,
- jangan overfit terhadap header internal yang bisa berubah antar library.

---

## 5.2 WireMock

WireMock lebih kaya untuk API mocking, stubbing, stateful behavior, request matching kompleks, recording/playback, standalone server, dan fault simulation.

Kapan cocok:

- contract-like tests,
- stateful scenario,
- complex stubbing,
- test data besar,
- mock provider untuk local development,
- service virtualization,
- fault injection lebih kaya.

Contoh dependency:

```gradle
testImplementation("org.wiremock:wiremock:3.6.0")
testImplementation("org.junit.jupiter:junit-jupiter:5.10.2")
```

Contoh JUnit 5 dengan extension:

```java
import com.github.tomakehurst.wiremock.junit5.WireMockExtension;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.RegisterExtension;

import static com.github.tomakehurst.wiremock.client.WireMock.*;
import static org.assertj.core.api.Assertions.assertThat;

class OrderClientWireMockTest {

    @RegisterExtension
    static WireMockExtension wm = WireMockExtension.newInstance()
            .options(wireMockConfig().dynamicPort())
            .build();

    @Test
    void sends_expected_headers_and_body() {
        wm.stubFor(post(urlEqualTo("/orders"))
                .withHeader("Idempotency-Key", matching(".+"))
                .withRequestBody(matchingJsonPath("$.customerId", equalTo("c-1")))
                .willReturn(aResponse()
                        .withStatus(201)
                        .withHeader("Content-Type", "application/json")
                        .withBody("{\"orderId\":\"o-1\"}")));

        OrderClient client = OrderClient.create(wm.baseUrl());

        CreateOrderResult result = client.createOrder(new CreateOrderCommand("c-1"));

        assertThat(result.orderId()).isEqualTo("o-1");

        wm.verify(postRequestedFor(urlEqualTo("/orders"))
                .withHeader("Idempotency-Key", matching(".+")));
    }
}
```

Stateful scenario:

```java
wm.stubFor(get(urlEqualTo("/jobs/j-1"))
        .inScenario("job-progress")
        .whenScenarioStateIs(STARTED)
        .willReturn(okJson("{\"status\":\"RUNNING\"}"))
        .willSetStateTo("done"));

wm.stubFor(get(urlEqualTo("/jobs/j-1"))
        .inScenario("job-progress")
        .whenScenarioStateIs("done")
        .willReturn(okJson("{\"status\":\"DONE\"}")));
```

Fault simulation examples:

```java
wm.stubFor(get(urlEqualTo("/unstable"))
        .willReturn(aResponse()
                .withFixedDelay(1_000)
                .withStatus(200)
                .withBody("{}")));
```

WireMock juga mendukung fault yang lebih rendah level seperti empty response atau connection reset depending version/API.

---

## 5.3 MockServer

MockServer cocok ketika butuh expectation, verification, proxying, dan integrasi container-based test.

Kapan cocok:

- expectation-driven mocking,
- proxy/recording behavior,
- verification sequence,
- containerized integration test,
- test suite yang perlu mock server sebagai external dependency.

Contoh dengan Testcontainers:

```gradle
testImplementation("org.testcontainers:junit-jupiter:1.20.4")
testImplementation("org.testcontainers:mockserver:1.20.4")
testImplementation("org.mock-server:mockserver-client-java:5.15.0")
```

Contoh test:

```java
import org.junit.jupiter.api.Test;
import org.mockserver.client.MockServerClient;
import org.testcontainers.containers.MockServerContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

import static org.mockserver.model.HttpRequest.request;
import static org.mockserver.model.HttpResponse.response;
import static org.mockserver.verify.VerificationTimes.once;

@Testcontainers
class PaymentClientMockServerTest {

    @Container
    static MockServerContainer mockServer = new MockServerContainer(
            DockerImageName.parse("mockserver/mockserver:5.15.0")
    );

    @Test
    void verifies_payment_request() {
        MockServerClient mock = new MockServerClient(
                mockServer.getHost(),
                mockServer.getServerPort()
        );

        mock.when(request()
                        .withMethod("POST")
                        .withPath("/payments"))
                .respond(response()
                        .withStatusCode(202)
                        .withHeader("Content-Type", "application/json")
                        .withBody("{\"paymentId\":\"p-1\",\"status\":\"ACCEPTED\"}"));

        PaymentClient client = PaymentClient.create(mockServer.getEndpoint());
        client.createPayment(new PaymentCommand("100.00"));

        mock.verify(request()
                        .withMethod("POST")
                        .withPath("/payments"),
                once());
    }
}
```

---

## 5.4 Lightweight JDK HTTP Server

Untuk test yang sangat minimal, kita bisa memakai `com.sun.net.httpserver.HttpServer`.

Kapan cocok:

- tidak ingin dependency tambahan,
- test sederhana,
- custom behavior manual,
- belajar lifecycle socket.

Contoh:

```java
import com.sun.net.httpserver.HttpServer;

HttpServer server = HttpServer.create(new InetSocketAddress(0), 0);
server.createContext("/hello", exchange -> {
    byte[] body = "{\"message\":\"hello\"}".getBytes(StandardCharsets.UTF_8);
    exchange.getResponseHeaders().add("Content-Type", "application/json");
    exchange.sendResponseHeaders(200, body.length);
    try (OutputStream os = exchange.getResponseBody()) {
        os.write(body);
    }
});
server.start();

int port = server.getAddress().getPort();
```

Kekurangan:

- request matching manual,
- verification manual,
- fault simulation terbatas,
- tidak seergonomis MockWebServer/WireMock.

---

## 6. Library-Specific Testing Patterns

---

## 6.1 Testing JDK HttpClient Wrapper

Jangan menyebar `HttpClient` langsung di banyak service. Bungkus dalam client adapter.

Contoh production shape:

```java
public final class UserApiClient {
    private final HttpClient httpClient;
    private final URI baseUri;
    private final ObjectMapper objectMapper;

    public UserApiClient(HttpClient httpClient, URI baseUri, ObjectMapper objectMapper) {
        this.httpClient = httpClient;
        this.baseUri = baseUri;
        this.objectMapper = objectMapper;
    }

    public UserDto getUser(String userId) {
        URI uri = baseUri.resolve("/users/" + encodePathSegment(userId));

        HttpRequest request = HttpRequest.newBuilder(uri)
                .timeout(Duration.ofMillis(500))
                .header("Accept", "application/json")
                .GET()
                .build();

        try {
            HttpResponse<String> response = httpClient.send(
                    request,
                    HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)
            );

            if (response.statusCode() == 200) {
                return objectMapper.readValue(response.body(), UserDto.class);
            }

            throw mapError(response.statusCode(), response.body());
        } catch (IOException e) {
            throw new ExternalTransportException("USER_API_TRANSPORT_FAILURE", e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new ExternalInterruptedException("USER_API_INTERRUPTED", e);
        }
    }
}
```

Test dengan MockWebServer tetap valid karena JDK client bicara HTTP biasa:

```java
server.enqueue(new MockResponse()
        .setResponseCode(200)
        .setHeader("Content-Type", "application/json")
        .setBody("{\"id\":\"u-1\"}"));

UserDto user = client.getUser("u-1");
RecordedRequest req = server.takeRequest();

assertThat(req.getMethod()).isEqualTo("GET");
assertThat(req.getPath()).isEqualTo("/users/u-1");
```

Hal khusus JDK HttpClient yang perlu diuji:

- `sendAsync` exception wrapping via `CompletionException`,
- cancellation behavior,
- executor sizing jika custom executor,
- `BodyHandlers.ofFile` untuk download,
- `BodyHandlers.discarding` untuk no-body response,
- redirect policy,
- proxy/authenticator bila digunakan.

---

## 6.2 Testing OkHttp Client

OkHttp testing biasanya sangat natural dengan MockWebServer.

Contoh:

```java
@Test
void closes_response_body_and_reuses_connection() throws Exception {
    server.enqueue(new MockResponse()
            .setResponseCode(200)
            .setBody("{\"id\":\"u-1\"}"));
    server.enqueue(new MockResponse()
            .setResponseCode(200)
            .setBody("{\"id\":\"u-2\"}"));

    OkHttpUserClient client = new OkHttpUserClient(okHttpClient, server.url("/").toString());

    client.getUser("u-1");
    client.getUser("u-2");

    assertThat(server.getRequestCount()).isEqualTo(2);
}
```

Untuk response body leak, jangan hanya mengandalkan test sederhana. Pastikan code selalu memakai try-with-resources:

```java
try (Response response = okHttpClient.newCall(request).execute()) {
    ResponseBody body = response.body();
    if (body == null) {
        throw new EmptyBodyException();
    }
    return parse(body.string());
}
```

Interceptor test:

```java
@Test
void auth_interceptor_adds_authorization_header() throws Exception {
    server.enqueue(new MockResponse().setResponseCode(200).setBody("{}"));

    client.callSomething();

    RecordedRequest req = server.takeRequest();
    assertThat(req.getHeader("Authorization")).startsWith("Bearer ");
}
```

EventListener/metrics bisa dites dengan fake metric registry atau collector:

```text
Given server returns 500
When client call finishes
Then metric external.http.client.requests{provider="x",status="500"} increments
```

---

## 6.3 Testing Retrofit Client

Retrofit test harus memverifikasi dua hal:

1. interface annotation menghasilkan request yang benar,
2. wrapper/domain client memetakan response/error dengan benar.

Contoh interface:

```java
interface UserApi {
    @GET("users/{id}")
    Call<UserResponse> getUser(@Path("id") String id);
}
```

Test:

```java
@Test
void retrofit_encodes_path_and_parses_response() throws Exception {
    server.enqueue(new MockResponse()
            .setResponseCode(200)
            .setHeader("Content-Type", "application/json")
            .setBody("{\"id\":\"u/1\",\"name\":\"Alice\"}"));

    Retrofit retrofit = new Retrofit.Builder()
            .baseUrl(server.url("/"))
            .addConverterFactory(JacksonConverterFactory.create(objectMapper))
            .build();

    UserApi api = retrofit.create(UserApi.class);
    Response<UserResponse> response = api.getUser("u/1").execute();

    assertThat(response.isSuccessful()).isTrue();

    RecordedRequest req = server.takeRequest();
    assertThat(req.getPath()).isEqualTo("/users/u%2F1");
}
```

Error body parsing:

```java
server.enqueue(new MockResponse()
        .setResponseCode(422)
        .setHeader("Content-Type", "application/json")
        .setBody("{\"code\":\"INVALID_STATE\",\"message\":\"Invalid state\"}"));

Response<UserResponse> response = api.getUser("u-1").execute();

assertThat(response.isSuccessful()).isFalse();
assertThat(response.errorBody()).isNotNull();
```

Pola yang lebih baik: jangan expose `retrofit2.Response` ke domain service. Bungkus di adapter.

---

## 6.4 Testing Apache HttpClient 5

Hal penting untuk Apache:

- entity lifecycle,
- connection manager config,
- timeout config,
- per-route pool,
- proxy/credentials,
- TLS strategy.

Contoh classic client test dengan MockWebServer:

```java
server.enqueue(new MockResponse()
        .setResponseCode(200)
        .setBody("{\"ok\":true}"));

ApacheUserClient client = new ApacheUserClient(apacheHttpClient, server.url("/").uri());
client.getUser("u-1");

RecordedRequest req = server.takeRequest();
assertThat(req.getMethod()).isEqualTo("GET");
```

Pastikan response entity dikonsumsi/ditutup agar connection kembali ke pool.

---

## 6.5 Testing Spring RestClient / RestTemplate / WebClient

Spring sendiri merekomendasikan penggunaan mock web server untuk test client HTTP karena request tetap lewat HTTP stack nyata.

### RestClient

```java
RestClient restClient = RestClient.builder()
        .baseUrl(server.url("/").toString())
        .build();

UserSpringClient client = new UserSpringClient(restClient);
```

### WebClient

```java
WebClient webClient = WebClient.builder()
        .baseUrl(server.url("/").toString())
        .build();

UserReactiveClient client = new UserReactiveClient(webClient);
```

Untuk reactive client, gunakan `StepVerifier`:

```java
StepVerifier.create(client.getUser("u-1"))
        .expectNextMatches(user -> user.id().equals("u-1"))
        .verifyComplete();
```

Yang harus diuji pada WebClient:

- error mapping dari `retrieve().onStatus(...)`,
- timeout operator,
- cancellation,
- backpressure untuk streaming,
- no blocking call di event loop,
- connector timeout config.

---

## 7. Testing Fault Scenarios secara Sistematis

Buat matrix failure, jangan random.

---

## 7.1 Transport Failure Matrix

| Failure | Expected Behavior | Retry? | Important Assertion |
|---|---:|---:|---|
| DNS failure | transport failure | maybe | classified as DNS/unknown host |
| connect refused | transport failure | maybe | no body parse attempt |
| connect timeout | timeout | maybe | bounded duration |
| TLS handshake failure | security/transport failure | no/rare | no fallback to insecure |
| connection reset before response | transport failure | maybe | retry only if safe |
| connection reset after request body | ambiguous | careful | idempotency required |
| read timeout | timeout | maybe | body closed/call cancelled |
| malformed HTTP | protocol failure | no | diagnostic captured |

DNS and TLS are harder to simulate with simple mock server. Use integration/environment tests or custom resolver/SSL setup.

---

## 7.2 HTTP Status Matrix

| Status | Typical Meaning | Default Retry? | Test Focus |
|---:|---|---:|---|
| 200 | success | no | body parsing |
| 201 | created | no | Location/id parsing |
| 202 | accepted | no | async job/polling |
| 204 | no content | no | no body expected |
| 304 | not modified | no | cache/conditional |
| 400 | bad request | no | request bug/validation |
| 401 | unauthorized | maybe once after refresh | token refresh loop guard |
| 403 | forbidden | no | permission mapping |
| 404 | not found | no | domain not found vs config error |
| 409 | conflict | no/maybe domain-specific | idempotency/concurrency |
| 422 | semantic error | no | domain validation mapping |
| 429 | rate limited | yes with delay | Retry-After/rate limiter |
| 500 | provider error | maybe | retry budget |
| 502 | bad gateway | maybe | transient gateway |
| 503 | unavailable | maybe | backoff/circuit |
| 504 | gateway timeout | maybe | idempotency/deadline |

---

## 7.3 Body Failure Matrix

| Body Case | Expected Behavior |
|---|---|
| Empty body with 200 | decode error unless contract allows |
| Empty body with 204 | success no body |
| JSON missing required field | decode/schema failure |
| Unknown JSON field | tolerate or fail based on contract |
| Unknown enum | map to UNKNOWN or fail deliberately |
| Huge body | size limit / streaming |
| Invalid charset | decode failure |
| Wrong content type | protocol/contract failure |
| Error body malformed | preserve status and diagnostic safely |
| Partial body then disconnect | transport/decode failure |

---

## 8. Determinism: Membuat Test Tidak Flaky

HTTP client tests mudah flaky karena waktu, thread, port, network, dan concurrency.

Prinsip:

1. **Use dynamic port**  
   Jangan hardcode `localhost:8080`.

2. **Bound all waits**  
   Gunakan `takeRequest(timeout, unit)`, Awaitility timeout, atau StepVerifier timeout.

3. **Use fake clock for backoff when possible**  
   Jangan membuat test menunggu 30 detik hanya untuk retry.

4. **Avoid real sleep**  
   Kalau harus, gunakan delay sangat kecil dan toleransi cukup.

5. **Reset server state per test**  
   Hindari stub bocor antar test.

6. **Avoid asserting implementation-specific header terlalu ketat**  
   Beberapa library bisa menambah `User-Agent`, `Host`, `Connection`, `Accept-Encoding`.

7. **Separate fast and slow tests**  
   Gunakan tag:

```java
@Tag("integration")
@Tag("slow")
@Tag("fault")
```

8. **Control concurrency**  
   Jangan test race condition dengan harapan scheduler OS selalu sama. Gunakan latch/barrier.

---

## 9. Testing Concurrent HTTP Client Behavior

Concurrency test diperlukan untuk:

- token refresh single-flight,
- bulkhead,
- rate limit,
- pool exhaustion,
- retry storm prevention,
- cancellation,
- shared client thread safety.

Contoh dengan latch:

```java
int n = 20;
ExecutorService executor = Executors.newFixedThreadPool(n);
CountDownLatch start = new CountDownLatch(1);
CountDownLatch done = new CountDownLatch(n);

for (int i = 0; i < n; i++) {
    executor.submit(() -> {
        try {
            start.await();
            client.callProtectedResource();
        } finally {
            done.countDown();
        }
    });
}

start.countDown();
assertThat(done.await(5, TimeUnit.SECONDS)).isTrue();
```

Untuk virtual threads Java 21+:

```java
try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
    List<Future<Result>> futures = IntStream.range(0, 1_000)
            .mapToObj(i -> executor.submit(() -> client.call()))
            .toList();

    for (Future<Result> future : futures) {
        future.get(2, TimeUnit.SECONDS);
    }
}
```

Tetap batasi concurrency ke downstream. Virtual thread bukan pengganti rate limit/bulkhead.

---

## 10. Testing Timeout and Retry Without Slow Test Suite

Masalah: retry/backoff real bisa membuat test lambat.

Solusi:

### 10.1 Inject Retry Scheduler / Sleeper

```java
interface Sleeper {
    void sleep(Duration duration) throws InterruptedException;
}

final class NoopSleeper implements Sleeper {
    @Override
    public void sleep(Duration duration) {
        // no-op for test
    }
}
```

Production memakai real sleeper, test memakai no-op/fake sleeper.

### 10.2 Use Small Timeout

```text
response timeout = 100ms
mock delay = 500ms
test timeout = 2s
```

Jangan gunakan:

```text
response timeout = 10s
mock delay = 30s
```

### 10.3 Assert Upper Bound

```java
long start = System.nanoTime();
assertThatThrownBy(() -> client.callSlowEndpoint())
        .isInstanceOf(ExternalTimeoutException.class);
long elapsedMillis = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start);
assertThat(elapsedMillis).isLessThan(1_000);
```

Gunakan toleransi. Jangan assert angka terlalu presisi.

---

## 11. Testing Redaction and Logging Safety

HTTP client sering bocor data lewat logs.

Test redaction seperti test business logic.

Contoh redactor:

```java
@Test
void redacts_sensitive_headers() {
    Map<String, List<String>> headers = Map.of(
            "Authorization", List.of("Bearer secret-token"),
            "X-Api-Key", List.of("secret-key"),
            "X-Correlation-Id", List.of("corr-1")
    );

    Map<String, List<String>> redacted = redactor.redact(headers);

    assertThat(redacted.get("Authorization")).containsExactly("<redacted>");
    assertThat(redacted.get("X-Api-Key")).containsExactly("<redacted>");
    assertThat(redacted.get("X-Correlation-Id")).containsExactly("corr-1");
}
```

Untuk log appender, bisa gunakan in-memory appender dan assert token tidak muncul:

```text
Given token = secret-token
When request fails
Then logs do not contain secret-token
```

---

## 12. Testing Metrics and Tracing

Observability harus diuji minimal di policy layer.

Metric examples:

```text
external_http_client_requests_total{provider="payment", outcome="success"}
external_http_client_requests_total{provider="payment", outcome="timeout"}
external_http_client_retries_total{provider="payment", reason="503"}
external_http_client_circuit_state{provider="payment", state="open"}
```

Yang diuji:

- metric increment saat success,
- metric increment saat error,
- status code bucket benar,
- exception class tidak jadi high-cardinality label,
- URL full path tidak jadi label,
- retry count tercatat,
- fallback count tercatat.

Untuk tracing:

- `traceparent` dikirim,
- correlation ID dikirim,
- span name tidak memakai raw URL dengan ID,
- sensitive headers tidak menjadi span attribute.

---

## 13. Contract Testing dan Schema Compatibility

HTTP client boundary rentan terhadap contract drift.

### 13.1 Consumer Contract Checklist

Consumer harus mendefinisikan:

- endpoint,
- method,
- path/query/header expectation,
- minimal required response fields,
- error response shape,
- status code expectation,
- pagination semantics,
- idempotency semantics,
- auth requirement.

### 13.2 Schema Compatibility Tests

Buat sample payload versi lama dan baru.

```java
@ParameterizedTest
@ValueSource(strings = {
        "fixtures/user-response-v1.json",
        "fixtures/user-response-v2-extra-field.json",
        "fixtures/user-response-v3-new-enum.json"
})
void parses_compatible_user_responses(String fixture) {
    String json = readFixture(fixture);
    UserResponse response = objectMapper.readValue(json, UserResponse.class);
    assertThat(response.id()).isNotBlank();
}
```

### 13.3 Golden Files

Golden files cocok untuk:

- complex JSON,
- XML/SOAP,
- generated client response,
- error body,
- signed canonical request.

Jangan overuse golden file untuk semua hal karena bisa membuat test sulit dipahami.

---

## 14. Testing Pagination, Polling, and Long-Running Operations

### 14.1 Pagination

Skenario:

```text
Response 1: items [a,b], nextPageToken=t2
Response 2: items [c], nextPageToken=null
Expected: client returns [a,b,c]
```

Hal yang harus diuji:

- next token encoded correctly,
- stops when token null,
- handles empty page with next token,
- prevents infinite loop,
- max pages guard,
- partial failure policy.

### 14.2 Polling

Skenario:

```text
POST /jobs -> 202 jobId=j-1
GET /jobs/j-1 -> RUNNING
GET /jobs/j-1 -> RUNNING
GET /jobs/j-1 -> DONE
```

Hal yang harus diuji:

- poll interval,
- max attempts/deadline,
- terminal failure state,
- cancellation,
- backoff,
- no unbounded loop.

### 14.3 Long-Running Operation

Test harus mencakup:

- accepted but not completed,
- eventual success,
- eventual business failure,
- timeout waiting,
- lost job ID,
- provider returns 404 during eventual consistency window.

---

## 15. Testing Streaming Upload and Download

### 15.1 Download

Tujuan:

- tidak load semua response ke memory,
- file checksum benar,
- partial download failure ditangani,
- temp file cleanup,
- max size guard,
- content type validation,
- content length mismatch.

Contoh:

```java
byte[] content = new byte[1024 * 1024];
new Random(1).nextBytes(content);

server.enqueue(new MockResponse()
        .setResponseCode(200)
        .setHeader("Content-Type", "application/octet-stream")
        .setBody(new okio.Buffer().write(content)));

Path downloaded = client.downloadFile("file-1");
assertThat(Files.size(downloaded)).isEqualTo(content.length);
```

### 15.2 Upload

Tujuan:

- content type benar,
- content length jika diperlukan,
- multipart boundary terbentuk,
- file stream ditutup,
- retry disabled untuk non-repeatable stream,
- checksum/signature benar.

Mock server bisa membaca body:

```java
RecordedRequest req = server.takeRequest();
String body = req.getBody().readUtf8();
assertThat(body).contains("form-data");
assertThat(req.getHeader("Content-Type")).contains("multipart/form-data");
```

---

## 16. Testing TLS and mTLS

TLS test bisa dilakukan pada beberapa level.

### 16.1 Unit/Config Test

- truststore path required,
- keystore password required,
- hostname verification not disabled,
- insecure trust manager rejected in production profile,
- TLS version policy valid.

### 16.2 Local TLS Mock Server

Gunakan mock server HTTPS mode bila library mendukung.

Yang diuji:

- custom truststore trusts server cert,
- wrong hostname rejected,
- expired cert rejected,
- self-signed cert rejected unless explicitly trusted,
- mTLS client cert required.

### 16.3 Environment Integration Test

Untuk mTLS production-like, sering lebih realistis di environment khusus karena melibatkan:

- certificate chain,
- secret mount,
- proxy,
- service mesh,
- cloud LB,
- rotation policy.

Jangan disable certificate validation hanya agar test lewat. Itu anti-pattern berbahaya.

---

## 17. Testing Generated OpenAPI Clients

Generated client perlu strategi khusus karena code sering besar dan berubah saat spec berubah.

Jangan test generated code line-by-line. Test boundary wrapper.

Struktur:

```text
GeneratedApiClient
  -> Wrapped by ProviderClientAdapter
  -> Exposes domain-safe interface
```

Test fokus:

- wrapper mapping,
- error translation,
- auth injection,
- timeout/retry policy,
- generated DTO compatibility,
- spec fixture compatibility,
- generated code regeneration does not break wrapper tests.

Jika generator menghasilkan transport config sendiri, pastikan config production tetap bisa diinjeksi:

- base URL,
- timeout,
- auth,
- proxy,
- TLS,
- interceptors,
- object mapper.

---

## 18. CI/CD Strategy

Pisahkan test berdasarkan biaya dan risiko.

```text
Every commit:
- unit tests
- adapter tests
- mock server HTTP tests
- redaction tests
- error mapping tests

Pull request:
- contract tests
- broader mock server scenarios
- limited concurrency tests

Nightly:
- integration tests against test provider
- fault injection tests
- TLS/mTLS tests
- performance smoke tests

Pre-release:
- full integration
- canary/synthetic validation
- provider sandbox validation
```

Gradle example:

```gradle
tasks.register("integrationTest", Test) {
    useJUnitPlatform {
        includeTags "integration"
    }
}

test {
    useJUnitPlatform {
        excludeTags "integration", "slow"
    }
}
```

JUnit tag:

```java
@Tag("integration")
class ProviderSandboxIntegrationTest {
}
```

---

## 19. Production Synthetic Tests

Selain test di CI, sistem yang matang punya synthetic probe di environment.

Synthetic test memanggil endpoint provider secara berkala dengan test account yang aman.

Validasi:

- DNS works,
- TLS works,
- auth works,
- provider reachable,
- response contract minimal valid,
- latency within SLO,
- no real business side effect.

Contoh:

```text
Every 5 minutes:
GET /health-like-provider-endpoint
or
POST /validate with dryRun=true
```

Harus hati-hati:

- jangan membuat transaksi nyata,
- jangan melanggar rate limit,
- jangan pakai production user data,
- jangan menghasilkan alert noise.

---

## 20. Anti-Patterns

### 20.1 Mocking HTTP Client Library Too Deep

Buruk:

```java
when(okHttpClient.newCall(any())).thenReturn(call);
```

Masalah:

- tidak memverifikasi URI/header/body,
- test tahu terlalu banyak implementasi,
- refactor kecil membuat test pecah.

Lebih baik:

- mock port untuk domain test,
- mock server untuk HTTP interaction test.

---

### 20.2 Testing Only Happy Path

HTTP client yang hanya dites 200 OK belum production-ready.

Minimal negative path:

- timeout,
- 401,
- 404,
- 409/422,
- 429,
- 500/503,
- malformed JSON,
- empty body,
- connection reset/delay.

---

### 20.3 Hardcoding External Sandbox in Unit Test

Buruk:

```text
test always calls https://sandbox.provider.com
```

Masalah:

- flaky,
- lambat,
- butuh credential,
- tidak bisa offline,
- bisa rate limited.

Gunakan integration test terpisah.

---

### 20.4 Ignoring Request Verification

Test hanya assert response object, tetapi tidak cek request.

Padahal bug sering ada pada:

- query encoding,
- missing header,
- wrong content type,
- wrong idempotency key,
- wrong path.

---

### 20.5 Real Sleep for Backoff

Buruk:

```java
Thread.sleep(30_000);
```

Solusi:

- inject sleeper,
- fake clock,
- reduce retry delay in test config.

---

### 20.6 Logging Raw Body in Test and Production

Test sering membuat helper yang print raw request/response body. Ini bisa terbawa ke production.

Gunakan redaction by default.

---

### 20.7 No Timeout in Tests

Jika test menunggu request yang tidak pernah datang:

```java
server.takeRequest(); // can hang forever
```

Lebih aman:

```java
RecordedRequest request = server.takeRequest(1, TimeUnit.SECONDS);
assertThat(request).isNotNull();
```

---

## 21. Design Pattern: Testable HTTP Client Architecture

Arsitektur yang testable:

```text
ProviderClientPort
  -> ProviderClientAdapter
       -> RequestFactory
       -> ResponseMapper
       -> ErrorMapper
       -> PolicyExecutor
       -> Transport
       -> Telemetry
```

Pisahkan concern:

### RequestFactory

- URI,
- method,
- headers,
- body,
- canonical signature.

Unit-testable.

### ResponseMapper

- 2xx body to DTO/domain.

Unit-testable with fixtures.

### ErrorMapper

- status/error body/exception to typed domain failure.

Unit-testable.

### PolicyExecutor

- timeout,
- retry,
- circuit,
- bulkhead.

Unit-testable/fault-testable.

### Transport

- actual library execution.

Mock server/integration test.

### Telemetry

- logs,
- metrics,
- traces.

Test with fake registry/appender.

---

## 22. Example End-to-End Test Matrix

Untuk client `PaymentProviderClient`:

| Category | Scenario | Test Layer |
|---|---|---|
| Request | POST `/payments` body and headers correct | Mock server |
| Auth | token added | Mock server |
| Auth | expired token refresh single-flight | Concurrency + mock server |
| Success | 201 maps to domain payment ID | Mock server/unit mapper |
| Validation | 422 maps to `PaymentRejected` | Mock server/unit mapper |
| Conflict | 409 idempotency replay maps to existing payment | Mock server |
| Rate limit | 429 + Retry-After retried once | Mock server + fake sleeper |
| Provider down | 503 opens circuit after threshold | Fault/policy test |
| Timeout | delayed response classified as timeout | Mock server |
| Decode | malformed JSON is decode failure | Mock server |
| Redaction | token not in log | Unit/log test |
| Metrics | retry and status metrics emitted | Fake metric registry |
| Contract | provider OpenAPI fixture compatible | Contract/schema test |
| Integration | sandbox auth and TLS works | Integration tag |

---

## 23. Practical Checklist

Sebelum HTTP client dianggap production-ready, minimal jawab “ya” untuk checklist berikut.

### Request and Contract

- [ ] Method/path/query/header/body diverifikasi dengan mock server.
- [ ] URI encoding path/query diuji.
- [ ] Content-Type/Accept diuji.
- [ ] Idempotency key diuji jika ada command operation.
- [ ] Contract/schema fixture tersedia.

### Failure Handling

- [ ] 4xx utama diuji.
- [ ] 5xx utama diuji.
- [ ] 429 + Retry-After diuji.
- [ ] Timeout diuji.
- [ ] Malformed body diuji.
- [ ] Empty/204 body diuji.
- [ ] Retry count dan stop condition diuji.
- [ ] Circuit/fallback diuji jika dipakai.

### Resource Safety

- [ ] Response body ditutup/dikonsumsi.
- [ ] Large body tidak selalu di-buffer.
- [ ] Streaming upload/download diuji jika dipakai.
- [ ] No test hang karena wait tanpa timeout.

### Security

- [ ] Token/API key tidak masuk log.
- [ ] Sensitive headers redacted.
- [ ] Redirect credential leakage diuji jika redirect enabled.
- [ ] TLS/mTLS config diuji minimal di integration.

### Observability

- [ ] Correlation ID propagated.
- [ ] Trace header propagated jika digunakan.
- [ ] Metrics success/error/timeout/retry diuji.
- [ ] Metric labels tidak high-cardinality.

### CI Strategy

- [ ] Fast tests jalan setiap commit.
- [ ] Slow/integration tests dipisah dengan tag.
- [ ] External sandbox dependency tidak membuat unit test flaky.
- [ ] Test data aman dan tidak mengandung secret.

---

## 24. Heuristik Top 1% untuk Testing HTTP Client

Engineer biasa bertanya:

> “Apakah client bisa call API dan parse response?”

Engineer top-tier bertanya:

> “Apakah boundary ini tetap benar, aman, terukur, dan dapat didiagnosis saat provider lambat, rusak, berubah kontrak, memberi response ambigu, membatasi rate, memutus koneksi, atau memicu retry storm?”

Heuristik penting:

1. **Test behavior, not implementation detail.**
2. **Mock server lebih bernilai daripada mock library internal.**
3. **Every retry policy needs a failure test and a no-retry test.**
4. **Every timeout config needs a deterministic timeout test.**
5. **Every external error needs typed classification.**
6. **Every auth refresh needs concurrency test.**
7. **Every log path must be tested for redaction.**
8. **Every API client should have at least one malformed response test.**
9. **Every generated client should be wrapped and tested at wrapper boundary.**
10. **Every integration test should be isolated, tagged, and safe.**

---

## 25. Ringkasan

HTTP client testing yang matang tidak berhenti pada “mock response 200 OK”.

Yang harus diuji adalah keseluruhan boundary:

```text
request construction
→ auth
→ transport execution
→ timeout/retry/rate/circuit behavior
→ response parsing
→ error classification
→ resource cleanup
→ observability
→ security redaction
→ contract compatibility
→ production-like integration
```

Mock server seperti MockWebServer, WireMock, dan MockServer membantu menjalankan HTTP stack nyata tanpa bergantung pada provider eksternal. Unit test tetap penting untuk logic kecil seperti mapper, classifier, policy, redactor, dan URI builder. Integration test tetap penting untuk TLS, auth, network route, dan provider behavior nyata.

HTTP client production-grade harus diuji sebagai **resilience boundary**, **security boundary**, **contract boundary**, dan **diagnostic boundary** sekaligus.

---

## 26. Latihan Praktis

Untuk memperkuat materi ini, implementasikan latihan berikut.

### Latihan 1 — MockWebServer Basic

Buat client `UserClient` dengan method:

```java
User getUser(String id)
```

Test:

- request path benar,
- `Accept: application/json` dikirim,
- response 200 diparse,
- response 404 menjadi `UserNotFoundException`.

### Latihan 2 — Retry with Idempotency Key

Buat client `OrderClient#createOrder`.

Test:

- attempt 1: 503,
- attempt 2: 201,
- idempotency key sama di kedua request,
- retry count metric increment.

### Latihan 3 — Token Refresh Single-Flight

Buat token provider dengan expired token.

Test:

- 20 concurrent request,
- hanya satu call ke `/oauth/token`,
- semua request business memakai token baru.

### Latihan 4 — Redaction Test

Buat logging interceptor/filter.

Test:

- `Authorization` tidak muncul di log,
- `X-Api-Key` tidak muncul di log,
- `X-Correlation-Id` tetap muncul.

### Latihan 5 — Timeout and Circuit Breaker

Buat endpoint mock yang delay.

Test:

- timeout terjadi dalam waktu bounded,
- setelah beberapa failure circuit open,
- saat circuit open request tidak sampai ke mock server.

---

## 27. Selesai untuk Part 22

Part ini membangun dasar testing HTTP client production-grade. Part berikutnya akan masuk ke **JSON/XML Mapping for HTTP Client Boundary**, dengan fokus pada DTO boundary, unknown fields, enum evolution, date/time, BigDecimal, null semantics, error body format, streaming parser, dan compatibility.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 21 — Observability: Logging, Metrics, Tracing, Correlation, Redaction](./21-observability-logging-metrics-tracing-correlation-redaction.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 23 — JSON/XML Mapping for HTTP Client Boundary](./23-json-xml-mapping-at-http-client-boundary.md)
