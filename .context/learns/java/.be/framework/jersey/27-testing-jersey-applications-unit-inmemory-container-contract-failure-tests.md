# Part 27 — Testing Jersey Applications: Unit, In-Memory, Container, Contract, and Failure Tests

Series: `learn-java-jersey-runtime-resource-client-extension-engineering`  
Previous: Part 26 — Configuration Engineering  
Next: Part 28 — Extension Engineering: Feature, DynamicFeature, Binder, Provider, and SPI Design

---

## 0. Tujuan Part Ini

Pada bagian sebelumnya kita sudah membahas bagaimana Jersey dikonfigurasi secara eksplisit: `ResourceConfig`, properties, auto-discovery, feature flags, environment profile, dan validasi konfigurasi saat startup. Setelah runtime bisa dikonfigurasi dengan deterministik, pertanyaan berikutnya adalah:

> Bagaimana membuktikan bahwa konfigurasi, resource matching, provider selection, filter chain, exception mapping, validation, security context, serialization, dan outbound client behavior benar-benar berjalan seperti yang kita desain?

Itulah fokus Part 27.

Testing Jersey tidak boleh hanya berarti unit test method Java biasa. Jersey adalah runtime. Banyak bug penting baru muncul ketika request benar-benar melewati runtime path:

```text
HTTP request
  -> container / servlet / embedded server
  -> Jersey application mapping
  -> resource matching
  -> request filters
  -> parameter conversion
  -> message body reader
  -> validation
  -> resource method
  -> service layer
  -> exception mapper / response builder
  -> message body writer
  -> response filters / writer interceptors
  -> HTTP response
```

Kalau test melewati resource method secara langsung, banyak bagian di atas tidak diuji.

Contoh test yang terlalu dangkal:

```java
@Test
void create_shouldReturnCreated() {
    OrderResource resource = new OrderResource(fakeService);
    Response response = resource.create(new CreateOrderRequest("A-001", 10));
    assertEquals(201, response.getStatus());
}
```

Test ini berguna, tapi tidak menjawab:

- apakah JSON body bisa dibaca oleh Jersey?
- apakah `@Valid` aktif?
- apakah `@Consumes` cocok dengan request?
- apakah `ExceptionMapper` dipakai?
- apakah `ContainerRequestFilter` security berjalan?
- apakah `Location` header benar saat deployed di base URI tertentu?
- apakah `MessageBodyWriter` menulis response shape yang benar?
- apakah `Content-Type` dan `Accept` negotiation bekerja?

Part ini akan membangun testing strategy bertingkat, dari unit test kecil sampai runtime integration test, contract test, failure test, dan test untuk production incident pattern.

---

## 1. Mental Model: Apa yang Sebenarnya Diuji?

Jersey application punya beberapa lapisan yang berbeda. Testing strategy yang baik harus tahu lapisan mana yang sedang diuji.

```text
+-------------------------------------------------------------+
| External HTTP behavior                                      |
| status, headers, media type, response body, error shape       |
+-------------------------------------------------------------+
| Jersey runtime behavior                                     |
| matching, providers, filters, interceptors, validation        |
+-------------------------------------------------------------+
| Adapter/resource behavior                                   |
| resource method, request DTO mapping, response mapping        |
+-------------------------------------------------------------+
| Application/service behavior                                |
| use case, transaction boundary, domain rule                  |
+-------------------------------------------------------------+
| Infrastructure behavior                                     |
| database, outbound HTTP, queue, file system, cache            |
+-------------------------------------------------------------+
```

Kesalahan umum adalah menganggap satu jenis test cukup untuk semua lapisan.

Tidak cukup.

Test yang langsung memanggil service tidak membuktikan Jersey provider bekerja. Test Jersey in-memory tidak membuktikan servlet mapping benar. Test Grizzly tidak membuktikan reverse proxy header benar. Test dengan mock repository tidak membuktikan transaction/DB constraint. Test dengan real DB tidak membuktikan consumer compatibility.

Top engineer tidak hanya bertanya:

> “Apakah sudah ada test?”

Tapi bertanya:

> “Behavior apa yang ingin kita buktikan, pada lapisan apa, dengan fidelity berapa, biaya maintenance berapa, dan failure mode apa yang masih lolos?”

---

## 2. Testing Pyramid Khusus Jersey

Untuk aplikasi Jersey, testing pyramid yang sehat bisa dilihat seperti ini:

```text
                         +--------------------------+
                         | End-to-End / Smoke       |
                         | real deployment path     |
                         +--------------------------+
                      +-------------------------------+
                      | Contract / Compatibility       |
                      | OpenAPI, schema, consumer test |
                      +-------------------------------+
                  +---------------------------------------+
                  | Jersey Runtime Integration Tests       |
                  | JerseyTest, Grizzly, servlet-like      |
                  +---------------------------------------+
              +-----------------------------------------------+
              | Resource Adapter Tests                         |
              | resource + mapper + fake service                |
              +-----------------------------------------------+
          +-------------------------------------------------------+
          | Unit Tests                                            |
          | service, mapper, validator, policy, utility            |
          +-------------------------------------------------------+
```

Pyramid ini bukan aturan absolut. Beberapa sistem regulatory/case-management membutuhkan contract dan failure tests lebih banyak daripada aplikasi CRUD kecil.

Prinsipnya:

- Unit test untuk logic yang tidak butuh Jersey.
- Jersey runtime test untuk behavior yang hanya muncul lewat Jersey.
- Contract test untuk menjaga client compatibility.
- Failure test untuk incident prevention.
- Smoke/E2E test untuk membuktikan deployment wiring.

---

## 3. Kapan Jangan Menggunakan Jersey Test Framework?

Sebelum masuk Jersey Test Framework, penting memahami kapan test biasa lebih tepat.

Gunakan unit test biasa untuk:

- domain service
- domain invariant
- mapper Java murni
- policy authorization murni
- idempotency decision logic
- retry decision logic
- pagination calculation
- date/time normalization
- error code mapping table
- validation helper
- DTO-to-command mapping kalau tidak bergantung pada Jersey context

Contoh:

```java
class OrderPolicyTest {

    @Test
    void submitterCannotApproveOwnOrder() {
        Order order = new Order("ORD-001", "alice");
        UserContext alice = new UserContext("alice", Set.of("APPROVER"));

        assertThrows(AuthorizationDenied.class,
            () -> OrderPolicy.requireCanApprove(alice, order));
    }
}
```

Tidak perlu Jersey untuk test seperti ini. Kalau semua test dimasukkan ke Jersey runtime, build akan lambat dan failure diagnosis menjadi lebih sulit.

Rule:

> Test logic di level paling rendah yang masih mempertahankan makna behavior.

---

## 4. Kapan Harus Menggunakan Jersey Runtime Test?

Gunakan Jersey runtime test jika behavior bergantung pada salah satu hal ini:

- `@Path` matching
- HTTP method selection
- `@Consumes` / `@Produces`
- `Accept` negotiation
- parameter injection
- `ParamConverter`
- `MessageBodyReader`
- `MessageBodyWriter`
- JSON provider
- `ExceptionMapper`
- `ContainerRequestFilter`
- `ContainerResponseFilter`
- `ReaderInterceptor`
- `WriterInterceptor`
- `@Context`
- `SecurityContext`
- `@BeanParam`
- Bean Validation integration
- multipart handling
- SSE/streaming behavior
- client/server header propagation
- Jersey-specific `Feature` / `DynamicFeature`
- HK2 binding / Jersey injection

Kalau behavior berada di daftar ini, memanggil resource method langsung biasanya tidak cukup.

---

## 5. Jersey Test Framework: Posisi dan Peran

Jersey menyediakan Jersey Test Framework untuk menjalankan aplikasi Jersey dalam test container. Dokumentasi resmi Jersey menyebut `JerseyTest` mendukung beberapa container, termasuk Grizzly, In-Memory, JDK `HttpServer`, Simple, Jetty, dan external container wrapper.

Mental model Jersey Test Framework:

```text
JUnit test
  -> extends JerseyTest
  -> override configure()
  -> build ResourceConfig/Application
  -> test container starts
  -> Jersey client sends HTTP-like request
  -> request passes Jersey runtime
  -> assertions inspect HTTP response
```

Contoh minimal:

```java
class OrderResourceJerseyTest extends JerseyTest {

    @Override
    protected Application configure() {
        return new ResourceConfig()
            .register(OrderResource.class)
            .register(JacksonFeature.class)
            .register(GlobalExceptionMapper.class)
            .register(new AbstractBinder() {
                @Override
                protected void configure() {
                    bind(new FakeOrderService()).to(OrderService.class);
                }
            });
    }

    @Test
    void createOrder_shouldReturn201() {
        Response response = target("/orders")
            .request(MediaType.APPLICATION_JSON_TYPE)
            .post(Entity.json("""
                {"customerId":"C-001","quantity":2}
                """));

        assertEquals(201, response.getStatus());
        assertThat(response.getHeaderString("Location")).contains("/orders/");
    }
}
```

Perhatikan bedanya dengan unit test biasa: request melewati Jersey resource matching, JSON provider, body reader, resource method, mapper, dan body writer.

---

## 6. Memilih Test Container: In-Memory, Grizzly, JDK, Jetty, External

Jersey Test Framework mendukung beberapa container. Pilihan container mempengaruhi fidelity dan biaya test.

### 6.1 In-Memory Test Container

Karakter:

- cepat
- ringan
- cocok untuk resource/provider/filter test
- tidak sepenuhnya mewakili HTTP server asli
- beberapa behavior container/servlet/network tidak muncul

Cocok untuk:

- resource matching
- entity provider
- exception mapper
- filter/interceptor
- validation
- security context fake
- JSON shape

Kurang cocok untuk:

- servlet mapping
- network timeout
- compression server
- low-level socket behavior
- proxy/header deployment issue
- multipart/temp file behavior yang bergantung container
- streaming/SSE fidelity tinggi

Contoh memilih in-memory:

```java
@Override
protected TestContainerFactory getTestContainerFactory() {
    return new InMemoryTestContainerFactory();
}
```

### 6.2 Grizzly Test Container

Karakter:

- lebih realistis karena ada HTTP server embedded
- lebih lambat daripada in-memory
- cocok untuk banyak integration test
- sering dipakai dalam contoh Jersey

Cocok untuk:

- end-to-end Jersey HTTP behavior
- headers
- media negotiation
- streaming dasar
- multipart lebih realistis
- client/server interaction

Contoh:

```java
@Override
protected TestContainerFactory getTestContainerFactory() {
    return new GrizzlyWebTestContainerFactory();
}
```

Atau provider yang sesuai versi artifact test framework yang dipakai.

### 6.3 JDK HttpServer Container

Karakter:

- menggunakan HTTP server JDK
- dependency lebih ringan
- fidelity berbeda dari servlet container

Cocok untuk:

- smoke integration sederhana
- environment yang menghindari extra server dependency

### 6.4 Jetty / Servlet-Like Container

Karakter:

- lebih dekat dengan servlet deployment
- lebih berat
- cocok jika production juga servlet-style

Cocok untuk:

- servlet filter interaction
- servlet context
- servlet mapping
- WAR-like behavior

### 6.5 External Container

Karakter:

- test berjalan terhadap aplikasi yang sudah deployed
- fidelity paling tinggi
- paling lambat dan paling mahal dikelola

Cocok untuk:

- smoke test environment
- pre-release verification
- compatibility deployment test
- Kubernetes ingress/gateway path test

### 6.6 Decision Table

| Kebutuhan | Container yang Cocok |
|---|---|
| Cepat, fokus resource/provider/filter | In-Memory |
| HTTP behavior lebih realistis | Grizzly/JDK |
| Servlet mapping penting | Jetty/servlet/external |
| Deployment real path | External |
| Contract regression cepat | In-Memory/Grizzly |
| Multipart/streaming lebih realistis | Grizzly/Jetty/external |
| Proxy/gateway behavior | External atau test khusus gateway |

---

## 7. Dependency Setup: Java 8–25, Jersey 2/3/4

Karena seri ini membahas Java 8 hingga 25, namespace dan versi penting.

### 7.1 Jersey 2.x

Biasanya:

```text
javax.ws.rs.*
org.glassfish.jersey.*
```

Cocok untuk legacy Java EE / Java 8+ ecosystem.

### 7.2 Jersey 3.x

Biasanya:

```text
jakarta.ws.rs.*
org.glassfish.jersey.*
```

Selaras dengan Jakarta EE 9/10 era.

### 7.3 Jersey 4.x

Jersey 4.x ditujukan untuk Jakarta EE 11 / Jakarta REST 4.0 compatibility. Jakarta REST 4.0 baseline Java SE 17. Artinya, untuk Java 8 compatibility kamu tidak bisa sembarang memakai Jersey 4.x.

### 7.4 Maven Example untuk Jersey 3.x/4.x Style

Contoh umum:

```xml
<dependencies>
    <dependency>
        <groupId>org.glassfish.jersey.test-framework</groupId>
        <artifactId>jersey-test-framework-core</artifactId>
        <version>${jersey.version}</version>
        <scope>test</scope>
    </dependency>

    <dependency>
        <groupId>org.glassfish.jersey.test-framework.providers</groupId>
        <artifactId>jersey-test-framework-provider-grizzly2</artifactId>
        <version>${jersey.version}</version>
        <scope>test</scope>
    </dependency>

    <dependency>
        <groupId>org.glassfish.jersey.media</groupId>
        <artifactId>jersey-media-json-jackson</artifactId>
        <version>${jersey.version}</version>
        <scope>test</scope>
    </dependency>

    <dependency>
        <groupId>org.junit.jupiter</groupId>
        <artifactId>junit-jupiter</artifactId>
        <version>${junit.jupiter.version}</version>
        <scope>test</scope>
    </dependency>
</dependencies>
```

Untuk in-memory:

```xml
<dependency>
    <groupId>org.glassfish.jersey.test-framework.providers</groupId>
    <artifactId>jersey-test-framework-provider-inmemory</artifactId>
    <version>${jersey.version}</version>
    <scope>test</scope>
</dependency>
```

Catatan penting:

- Jangan campur Jersey 2.x dengan `jakarta.ws.rs.*`.
- Jangan campur Jersey 3/4 dengan `javax.ws.rs.*`.
- Pastikan JSON provider versi sama dengan Jersey runtime.
- Pastikan test dependency tidak menarik provider berbeda yang mengubah behavior production.

---

## 8. Struktur Test Project yang Sehat

Contoh struktur:

```text
src/main/java
  com.example.api
    OrderResource.java
    OrderExceptionMapper.java
    CorrelationIdFilter.java
    ApiResourceConfig.java
  com.example.application
    OrderService.java
    OrderCommand.java
  com.example.domain
    Order.java
    OrderPolicy.java

src/test/java
  com.example.domain
    OrderPolicyTest.java
  com.example.application
    OrderServiceTest.java
  com.example.api.unit
    OrderResourceUnitTest.java
  com.example.api.jersey
    OrderResourceJerseyTest.java
    ErrorContractJerseyTest.java
    FilterChainJerseyTest.java
    JsonProviderJerseyTest.java
  com.example.api.contract
    OrderApiContractTest.java
  com.example.api.support
    TestResourceConfigFactory.java
    FakeSecurityFeature.java
    FakeOrderService.java
    JsonAssert.java
```

Prinsip:

- Pisahkan unit test dan Jersey runtime test.
- Buat factory test config agar `ResourceConfig` test konsisten.
- Jangan copy-paste registration antar test tanpa kontrol.
- Gunakan fake service yang deterministik.
- Jangan selalu boot full application context kalau yang diuji hanya resource boundary.

---

## 9. Test ResourceConfig: Jangan Beda Terlalu Jauh dari Production

Salah satu sumber false confidence adalah test config yang terlalu berbeda dari production.

Production:

```java
public final class ApiResourceConfig extends ResourceConfig {
    public ApiResourceConfig(AppConfig config) {
        register(OrderResource.class);
        register(CustomerResource.class);

        register(JacksonFeature.class);
        register(GlobalExceptionMapper.class);
        register(CorrelationIdFilter.class);
        register(SecurityFeature.class);
        register(ValidationFeature.class);

        property(ServerProperties.BV_SEND_ERROR_IN_RESPONSE, false);
    }
}
```

Test buruk:

```java
@Override
protected Application configure() {
    return new ResourceConfig(OrderResource.class);
}
```

Kenapa buruk?

Karena tidak meregister JSON provider yang sama, exception mapper yang sama, filter yang sama, validation behavior yang sama. Test mungkin hijau, production gagal.

Test lebih baik:

```java
final class TestResourceConfigFactory {

    static ResourceConfig apiWithFakes(OrderService orderService, UserContext userContext) {
        return new ResourceConfig()
            .register(OrderResource.class)
            .register(JacksonFeature.class)
            .register(GlobalExceptionMapper.class)
            .register(CorrelationIdFilter.class)
            .register(new FakeSecurityFeature(userContext))
            .register(new AbstractBinder() {
                @Override
                protected void configure() {
                    bind(orderService).to(OrderService.class);
                }
            })
            .property(ServerProperties.BV_SEND_ERROR_IN_RESPONSE, false);
    }
}
```

Targetnya bukan full production config, tapi production-representative config.

---

## 10. Unit Test Resource Method: Masih Berguna, Tapi Batasnya Jelas

Resource unit test cocok untuk logic adapter yang kecil:

```java
class OrderResourceUnitTest {

    @Test
    void create_shouldDelegateToServiceAndBuildLocation() {
        FakeOrderService service = new FakeOrderService()
            .willCreate("ORD-001");

        OrderResource resource = new OrderResource(service);

        Response response = resource.create(new CreateOrderRequest("C-001", 2));

        assertEquals(201, response.getStatus());
    }
}
```

Gunakan test ini untuk:

- memastikan resource memanggil service benar
- memastikan mapping sederhana benar
- memastikan branch kecil di adapter benar

Jangan gunakan test ini untuk membuktikan:

- JSON parsing
- media negotiation
- validation annotation
- security filter
- exception mapper
- parameter conversion

---

## 11. Testing Resource Matching

Resource matching sering menjadi sumber bug saat endpoint bertambah.

Contoh resource:

```java
@Path("/orders")
public class OrderResource {

    @GET
    @Path("/{id}")
    @Produces(MediaType.APPLICATION_JSON)
    public OrderResponse get(@PathParam("id") String id) {
        return service.get(id);
    }

    @GET
    @Path("/search")
    @Produces(MediaType.APPLICATION_JSON)
    public SearchResponse search(@QueryParam("q") String q) {
        return service.search(q);
    }
}
```

Test penting:

```java
@Test
void searchPath_shouldNotBeCapturedAsId() {
    Response response = target("/orders/search")
        .queryParam("q", "alice")
        .request(MediaType.APPLICATION_JSON_TYPE)
        .get();

    assertEquals(200, response.getStatus());
    assertEquals("search", response.readEntity(JsonObject.class).getString("kind"));
}
```

Bug yang ingin dicegah:

```text
/orders/search
  accidentally matched by /orders/{id}
```

Dalam resource yang kompleks, test matching adalah regression guard.

---

## 12. Testing Method Selection: 404 vs 405 vs 406 vs 415

Endpoint production sering gagal bukan karena method tidak ada, tetapi karena media type tidak cocok.

### 12.1 404 Not Found

```java
@Test
void unknownPath_shouldReturn404Problem() {
    Response response = target("/unknown")
        .request(MediaType.APPLICATION_JSON_TYPE)
        .get();

    assertEquals(404, response.getStatus());
    assertProblem(response, "NOT_FOUND");
}
```

### 12.2 405 Method Not Allowed

```java
@Test
void unsupportedMethod_shouldReturn405() {
    Response response = target("/orders/ORD-001")
        .request(MediaType.APPLICATION_JSON_TYPE)
        .delete();

    assertEquals(405, response.getStatus());
}
```

### 12.3 406 Not Acceptable

```java
@Test
void unsupportedAccept_shouldReturn406() {
    Response response = target("/orders/ORD-001")
        .request(MediaType.TEXT_PLAIN_TYPE)
        .get();

    assertEquals(406, response.getStatus());
}
```

### 12.4 415 Unsupported Media Type

```java
@Test
void unsupportedContentType_shouldReturn415() {
    Response response = target("/orders")
        .request(MediaType.APPLICATION_JSON_TYPE)
        .post(Entity.entity("abc", MediaType.TEXT_PLAIN_TYPE));

    assertEquals(415, response.getStatus());
}
```

Kenapa test ini penting?

Karena 404/405/406/415 menyatakan kegagalan di lapisan yang berbeda. Kalau error mapper menyamakan semuanya menjadi `400`, observability dan diagnosis menjadi buruk.

---

## 13. Testing Parameter Injection

Contoh resource:

```java
@GET
@Path("/orders")
public OrderSearchResponse search(@BeanParam OrderSearchParams params) {
    return service.search(params.toCriteria());
}
```

Parameter object:

```java
public class OrderSearchParams {

    @QueryParam("status")
    private List<String> statuses;

    @QueryParam("page")
    @DefaultValue("1")
    private int page;

    @QueryParam("size")
    @DefaultValue("20")
    private int size;

    @HeaderParam("X-Tenant-Id")
    private String tenantId;
}
```

Test:

```java
@Test
void search_shouldBindQueryAndHeaderParams() {
    Response response = target("/orders")
        .queryParam("status", "SUBMITTED")
        .queryParam("status", "APPROVED")
        .queryParam("page", "2")
        .request(MediaType.APPLICATION_JSON_TYPE)
        .header("X-Tenant-Id", "tenant-a")
        .get();

    assertEquals(200, response.getStatus());

    SearchCapture capture = fakeService.lastSearch();
    assertEquals(List.of("SUBMITTED", "APPROVED"), capture.statuses());
    assertEquals(2, capture.page());
    assertEquals(20, capture.size());
    assertEquals("tenant-a", capture.tenantId());
}
```

Test edge cases:

- query param absent
- query param empty string
- repeated query param
- invalid enum
- invalid number
- default value applied
- header missing
- cookie missing
- matrix param used intentionally

---

## 14. Testing ParamConverter

Custom `ParamConverter` sering gagal karena provider tidak teregister atau generic type tidak cocok.

Contoh value object:

```java
public record OrderId(String value) {
    public OrderId {
        if (value == null || !value.matches("ORD-[0-9]{3,}")) {
            throw new IllegalArgumentException("Invalid order id");
        }
    }
}
```

Resource:

```java
@GET
@Path("/orders/{id}")
public OrderResponse get(@PathParam("id") OrderId id) {
    return service.get(id);
}
```

Test sukses:

```java
@Test
void pathParam_shouldConvertToOrderId() {
    Response response = target("/orders/ORD-001")
        .request(MediaType.APPLICATION_JSON_TYPE)
        .get();

    assertEquals(200, response.getStatus());
    assertEquals(new OrderId("ORD-001"), fakeService.lastOrderId());
}
```

Test gagal:

```java
@Test
void invalidOrderId_shouldReturn400() {
    Response response = target("/orders/abc")
        .request(MediaType.APPLICATION_JSON_TYPE)
        .get();

    assertEquals(400, response.getStatus());
    assertProblem(response, "INVALID_PARAMETER");
}
```

Hal yang diuji bukan constructor `OrderId`; itu bisa unit test. Yang diuji di sini adalah Jersey converter integration.

---

## 15. Testing MessageBodyReader / Writer dan JSON Provider

Test JSON provider harus membuktikan shape, bukan hanya status.

Contoh response:

```json
{
  "id": "ORD-001",
  "createdAt": "2026-06-16T10:15:30Z",
  "status": "SUBMITTED"
}
```

Test:

```java
@Test
void getOrder_shouldSerializeExpectedJsonShape() {
    Response response = target("/orders/ORD-001")
        .request(MediaType.APPLICATION_JSON_TYPE)
        .get();

    assertEquals(200, response.getStatus());
    assertEquals("application/json", response.getMediaType().toString());

    String json = response.readEntity(String.class);
    assertJsonEquals("""
        {
          "id": "ORD-001",
          "createdAt": "2026-06-16T10:15:30Z",
          "status": "SUBMITTED"
        }
        """, json);
}
```

Test penting untuk JSON:

- Java time format
- null field handling
- unknown input field behavior
- enum serialization
- enum deserialization
- record serialization/deserialization
- polymorphism disabled/controlled
- lazy proxy tidak bocor
- internal fields tidak muncul
- error payload shape stabil

### 15.1 Testing Unknown Field

```java
@Test
void create_shouldRejectUnknownField_ifContractStrict() {
    Response response = target("/orders")
        .request(MediaType.APPLICATION_JSON_TYPE)
        .post(Entity.json("""
            {
              "customerId":"C-001",
              "quantity":2,
              "unexpected":"value"
            }
            """));

    assertEquals(400, response.getStatus());
    assertProblem(response, "MALFORMED_JSON");
}
```

Atau jika policy API memperbolehkan unknown field, test harus membuktikan sebaliknya.

Intinya: pilih policy, lalu kunci lewat test.

---

## 16. Testing ExceptionMapper dan Error Contract

Error contract harus diuji seperti success contract.

Contoh mapper:

```java
@Provider
public class DomainExceptionMapper implements ExceptionMapper<DomainException> {
    @Override
    public Response toResponse(DomainException ex) {
        Problem problem = Problem.of(
            ex.httpStatus(),
            ex.code(),
            ex.safeMessage()
        );
        return Response.status(ex.httpStatus())
            .type("application/problem+json")
            .entity(problem)
            .build();
    }
}
```

Test:

```java
@Test
void domainException_shouldMapToProblemJson() {
    fakeService.failWith(new OrderAlreadySubmitted("ORD-001"));

    Response response = target("/orders/ORD-001/submit")
        .request("application/problem+json")
        .post(Entity.json("{}"));

    assertEquals(409, response.getStatus());
    assertEquals("application/problem+json", response.getMediaType().toString());

    String json = response.readEntity(String.class);
    assertJsonPath(json, "$.code", "ORDER_ALREADY_SUBMITTED");
    assertJsonPath(json, "$.status", 409);
    assertJsonPathAbsent(json, "$.stackTrace");
}
```

Test mapper hierarchy:

```java
@Test
void specificMapper_shouldWinOverGenericMapper() {
    fakeService.failWith(new OptimisticLockConflict("ORD-001"));

    Response response = target("/orders/ORD-001")
        .request("application/problem+json")
        .put(Entity.json("{" + "\"status\":\"APPROVED\"}"));

    assertEquals(409, response.getStatus());
    assertProblem(response, "CONCURRENT_MODIFICATION");
}
```

Failure mode yang ingin dicegah:

- generic mapper menelan semua exception
- stack trace bocor
- HTTP status salah
- error code tidak stabil
- correlation ID hilang
- media type error tidak konsisten
- validation error shape berbeda dari domain error shape tanpa alasan

---

## 17. Testing Filters

Filter sering menjadi tempat cross-cutting concern: correlation ID, security, audit, idempotency, rate limit, logging.

### 17.1 Correlation ID Filter

```java
@Test
void missingCorrelationId_shouldGenerateOne() {
    Response response = target("/orders/ORD-001")
        .request(MediaType.APPLICATION_JSON_TYPE)
        .get();

    assertEquals(200, response.getStatus());
    assertNotNull(response.getHeaderString("X-Correlation-Id"));
}

@Test
void existingCorrelationId_shouldBePreserved() {
    Response response = target("/orders/ORD-001")
        .request(MediaType.APPLICATION_JSON_TYPE)
        .header("X-Correlation-Id", "corr-123")
        .get();

    assertEquals("corr-123", response.getHeaderString("X-Correlation-Id"));
}
```

### 17.2 Security Filter

```java
@Test
void missingToken_shouldReturn401() {
    Response response = target("/orders/ORD-001")
        .request(MediaType.APPLICATION_JSON_TYPE)
        .get();

    assertEquals(401, response.getStatus());
    assertProblem(response, "UNAUTHENTICATED");
}

@Test
void insufficientRole_shouldReturn403() {
    Response response = target("/orders/ORD-001/approve")
        .request(MediaType.APPLICATION_JSON_TYPE)
        .header("Authorization", "Bearer token-without-approver-role")
        .post(Entity.json("{}"));

    assertEquals(403, response.getStatus());
    assertProblem(response, "FORBIDDEN");
}
```

### 17.3 Filter Ordering

Jika ada beberapa filter, ordering harus diuji.

Contoh urutan yang diharapkan:

```text
CorrelationIdFilter
  -> AuthenticationFilter
  -> AuthorizationFilter
  -> IdempotencyFilter
  -> AuditFilter
  -> Resource method
```

Test dengan capture:

```java
@Test
void filters_shouldRunInExpectedOrder() {
    Response response = target("/orders/ORD-001")
        .request(MediaType.APPLICATION_JSON_TYPE)
        .header("Authorization", "Bearer valid-token")
        .get();

    assertEquals(200, response.getStatus());
    assertEquals(List.of(
        "correlation.request",
        "authn.request",
        "authz.request",
        "audit.request",
        "resource",
        "audit.response",
        "correlation.response"
    ), eventRecorder.events());
}
```

---

## 18. Testing Interceptors

Interceptors berbeda dari filters. Filters mengelola request/response metadata dan flow, sedangkan reader/writer interceptors berada di sekitar entity stream.

Test interceptor penting jika kamu punya:

- payload compression
- payload encryption/decryption
- body hashing
- masking
- audit body digest
- signature verification

Contoh writer interceptor yang menambahkan hash response:

```java
@Provider
public class ResponseDigestInterceptor implements WriterInterceptor {
    @Override
    public void aroundWriteTo(WriterInterceptorContext context)
            throws IOException, WebApplicationException {
        // simplified example
        context.getHeaders().add("X-Body-Digest", "sha256:...");
        context.proceed();
    }
}
```

Test:

```java
@Test
void responseDigestInterceptor_shouldAddDigestHeader() {
    Response response = target("/orders/ORD-001")
        .request(MediaType.APPLICATION_JSON_TYPE)
        .get();

    assertEquals(200, response.getStatus());
    assertThat(response.getHeaderString("X-Body-Digest"))
        .startsWith("sha256:");
}
```

Test stream safety:

- request body tetap bisa dibaca resource setelah interceptor berjalan
- response body tetap lengkap
- exception di interceptor masuk error mapper yang sesuai
- sensitive body tidak tercatat mentah di log

---

## 19. Testing Bean Validation Integration

Validation test harus membuktikan bahwa annotation benar-benar dipakai oleh Jersey runtime.

DTO:

```java
public record CreateOrderRequest(
    @NotBlank String customerId,
    @Min(1) int quantity
) {}
```

Resource:

```java
@POST
@Path("/orders")
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public Response create(@Valid CreateOrderRequest request) {
    OrderId id = service.create(request);
    return Response.created(uriInfo.getAbsolutePathBuilder().path(id.value()).build())
        .entity(new CreateOrderResponse(id.value()))
        .build();
}
```

Test:

```java
@Test
void invalidRequest_shouldReturnValidationProblem() {
    Response response = target("/orders")
        .request("application/problem+json")
        .post(Entity.json("""
            {"customerId":"","quantity":0}
            """));

    assertEquals(400, response.getStatus());

    String json = response.readEntity(String.class);
    assertJsonPath(json, "$.code", "VALIDATION_FAILED");
    assertJsonArrayContains(json, "$.violations[*].field", "customerId");
    assertJsonArrayContains(json, "$.violations[*].field", "quantity");
}
```

Test group validation:

```java
@Test
void approve_shouldUseApprovalValidationGroup() {
    Response response = target("/orders/ORD-001/approval")
        .request("application/problem+json")
        .post(Entity.json("""
            {"decision":"APPROVE","approvalReason":""}
            """));

    assertEquals(400, response.getStatus());
    assertProblem(response, "VALIDATION_FAILED");
}
```

---

## 20. Testing SecurityContext

Jika resource menggunakan `@Context SecurityContext`, jangan unit-test dengan asumsi kosong. Buat test runtime yang inject security context lewat filter.

Resource:

```java
@GET
@Path("/me")
public MeResponse me(@Context SecurityContext securityContext) {
    return new MeResponse(securityContext.getUserPrincipal().getName());
}
```

Fake security filter:

```java
public class TestSecurityFilter implements ContainerRequestFilter {
    @Override
    public void filter(ContainerRequestContext requestContext) {
        String user = requestContext.getHeaderString("X-Test-User");
        if (user == null) {
            requestContext.abortWith(Response.status(401).build());
            return;
        }

        requestContext.setSecurityContext(new SecurityContext() {
            @Override
            public Principal getUserPrincipal() {
                return () -> user;
            }

            @Override
            public boolean isUserInRole(String role) {
                return "admin".equals(user) && "ADMIN".equals(role);
            }

            @Override
            public boolean isSecure() {
                return true;
            }

            @Override
            public String getAuthenticationScheme() {
                return "TEST";
            }
        });
    }
}
```

Test:

```java
@Test
void me_shouldReadPrincipalFromSecurityContext() {
    Response response = target("/me")
        .request(MediaType.APPLICATION_JSON_TYPE)
        .header("X-Test-User", "alice")
        .get();

    assertEquals(200, response.getStatus());
    assertJsonPath(response.readEntity(String.class), "$.username", "alice");
}
```

Prinsip:

- Jangan test JWT parsing di semua resource test.
- Test JWT parsing di security component test.
- Untuk resource authorization behavior, gunakan fake security context yang deterministik.

---

## 21. Testing HK2 Binding dan Injection

Binding bug sering baru muncul saat Jersey membuat resource/provider.

Test startup injection:

```java
@Test
void application_shouldStartWithAllRequiredBindings() {
    Response response = target("/health")
        .request(MediaType.APPLICATION_JSON_TYPE)
        .get();

    assertEquals(200, response.getStatus());
}
```

Test provider injection:

```java
@Provider
public class TenantFilter implements ContainerRequestFilter {
    private final TenantResolver tenantResolver;

    @Inject
    public TenantFilter(TenantResolver tenantResolver) {
        this.tenantResolver = tenantResolver;
    }

    @Override
    public void filter(ContainerRequestContext context) {
        context.setProperty("tenant", tenantResolver.resolve(context));
    }
}
```

Test:

```java
@Test
void tenantFilter_shouldUseInjectedTenantResolver() {
    Response response = target("/tenant-aware-resource")
        .request(MediaType.APPLICATION_JSON_TYPE)
        .header("X-Tenant-Id", "tenant-a")
        .get();

    assertEquals(200, response.getStatus());
    assertEquals("tenant-a", fakeTenantResolver.lastResolvedTenant());
}
```

Failure mode:

- resource created by Jersey, service expected from Spring/CDI but not bridged
- provider registered as instance, injection not applied as expected
- singleton holds request-scoped dependency
- factory returns mutable singleton accidentally
- test config binds fake differently from production

---

## 22. Testing Jersey Client

Jersey Client test harus membuktikan outbound contract:

- URL construction
- method
- headers
- body shape
- timeout config
- response parsing
- error mapping
- connection closing
- retry/circuit integration jika ada

### 22.1 Mock HTTP Server Approach

Gunakan mock server seperti WireMock, MockWebServer, atau server test kecil. Intinya: jangan mock Jersey `Invocation.Builder` terlalu dalam. Itu biasanya brittle dan tidak menguji serialization/header behavior.

Client wrapper:

```java
public final class PaymentGatewayClient {
    private final WebTarget baseTarget;

    public PaymentGatewayClient(Client client, URI baseUri) {
        this.baseTarget = client.target(baseUri);
    }

    public PaymentResult pay(PaymentRequest request, String correlationId) {
        Response response = baseTarget.path("/payments")
            .request(MediaType.APPLICATION_JSON_TYPE)
            .header("X-Correlation-Id", correlationId)
            .post(Entity.json(request));

        try (response) {
            if (response.getStatus() == 201) {
                return response.readEntity(PaymentResult.class);
            }
            throw mapError(response);
        }
    }
}
```

Test behavior:

```java
@Test
void pay_shouldSendCorrelationIdAndJsonBody() {
    mockServer.stubPost("/payments")
        .willReturn(201, "application/json", """
            {"paymentId":"PAY-001","status":"ACCEPTED"}
            """);

    PaymentResult result = client.pay(
        new PaymentRequest("ORD-001", BigDecimal.TEN),
        "corr-123"
    );

    assertEquals("PAY-001", result.paymentId());
    mockServer.verifyPost("/payments")
        .withHeader("X-Correlation-Id", "corr-123")
        .withJsonBodyPath("$.orderId", "ORD-001");
}
```

### 22.2 Testing Response Closing

Connection leak tidak selalu mudah ditangkap unit test. Tapi pattern bisa ditegakkan:

- wrapper selalu `try (Response response = ...)`
- static analysis/checkstyle untuk melarang response tidak ditutup
- integration test dengan connection pool kecil

Contoh stress-style test:

```java
@Test
void repeatedErrorResponses_shouldNotExhaustConnectionPool() {
    mockServer.stubGet("/unstable").willReturn(500, "application/json", "{} ");

    for (int i = 0; i < 100; i++) {
        assertThrows(RemoteServiceException.class, () -> client.callUnstable());
    }
}
```

Kalau response tidak ditutup, test dengan pool kecil bisa hang/fail.

---

## 23. Testing Timeout and Resilience Behavior

Timeout/retry/circuit tests sering flaky jika bergantung pada sleep panjang. Buat cepat dan deterministik.

### 23.1 Timeout Test

```java
@Test
void slowRemoteCall_shouldTimeoutQuickly() {
    mockServer.stubGet("/slow")
        .delay(Duration.ofMillis(500))
        .willReturn(200, "application/json", "{}");

    assertThrows(RemoteTimeoutException.class, () -> client.callSlowEndpoint());
}
```

Pastikan timeout test tidak memakai durasi besar.

### 23.2 Retry Test

```java
@Test
void retryableFailure_shouldRetryWithLimit() {
    mockServer.stubPostSequence("/payments")
        .thenReturn(503, "application/json", "{}")
        .thenReturn(503, "application/json", "{}")
        .thenReturn(201, "application/json", "{" + "\"paymentId\":\"PAY-001\"}");

    PaymentResult result = client.pay(request, "corr-123");

    assertEquals("PAY-001", result.paymentId());
    mockServer.verifyRequestCount("POST", "/payments", 3);
}
```

### 23.3 Non-Retryable Test

```java
@Test
void validationFailure_shouldNotRetry() {
    mockServer.stubPost("/payments")
        .willReturn(400, "application/problem+json", """
            {"code":"INVALID_REQUEST"}
            """);

    assertThrows(RemoteBadRequestException.class, () -> client.pay(request, "corr-123"));
    mockServer.verifyRequestCount("POST", "/payments", 1);
}
```

### 23.4 Idempotency Key Test

```java
@Test
void retryingPost_shouldSendSameIdempotencyKey() {
    client.pay(request, "corr-123");

    mockServer.verifyAllRequests("POST", "/payments", req ->
        assertEquals("idem-ORD-001", req.header("Idempotency-Key"))
    );
}
```

---

## 24. Testing Multipart Upload

Multipart testing harus membuktikan:

- field metadata terbaca
- file stream terbaca
- ukuran file dibatasi
- filename tidak dipercaya
- MIME divalidasi
- error shape benar

Contoh:

```java
@Test
void uploadDocument_shouldAcceptMultipart() {
    FileDataBodyPart filePart = new FileDataBodyPart(
        "file",
        tempPdfFile.toFile(),
        MediaType.APPLICATION_OCTET_STREAM_TYPE
    );

    FormDataMultiPart multipart = new FormDataMultiPart()
        .field("documentType", "INVOICE")
        .bodyPart(filePart);

    Response response = target("/documents")
        .request(MediaType.APPLICATION_JSON_TYPE)
        .post(Entity.entity(multipart, multipart.getMediaType()));

    assertEquals(201, response.getStatus());
}
```

Test security:

```java
@Test
void uploadWithPathTraversalFilename_shouldIgnoreClientFilename() {
    MultipartRequest request = multipartFile(
        "../../etc/passwd",
        "text/plain",
        "hello".getBytes(UTF_8)
    );

    Response response = postMultipart("/documents", request);

    assertEquals(201, response.getStatus());
    assertFalse(fakeStorage.lastStoredPath().contains(".."));
}
```

Test size limit:

```java
@Test
void tooLargeUpload_shouldReturn413() {
    Response response = postMultipart("/documents", hugeFile());

    assertEquals(413, response.getStatus());
    assertProblem(response, "PAYLOAD_TOO_LARGE");
}
```

---

## 25. Testing Streaming and SSE

Streaming/SSE test lebih tricky karena:

- response tidak selesai langsung
- client disconnect harus disimulasikan
- proxy buffering tidak terlihat di in-memory container
- test bisa hang kalau timeout tidak disiplin

### 25.1 StreamingOutput Test

```java
@Test
void download_shouldStreamExpectedContent() {
    Response response = target("/exports/EXP-001/file")
        .request("text/csv")
        .get();

    assertEquals(200, response.getStatus());
    assertEquals("text/csv", response.getMediaType().toString());

    String body = response.readEntity(String.class);
    assertThat(body).contains("order_id,status");
}
```

### 25.2 SSE Test

Untuk SSE, lebih baik test kecil:

- endpoint membuka stream
- event pertama terkirim
- heartbeat terkirim
- close tidak leak broadcaster registration

Pseudo-test:

```java
@Test
void sse_shouldReceiveFirstEvent() {
    SseEventSource source = SseEventSource.target(target("/events")).build();
    BlockingQueue<String> events = new LinkedBlockingQueue<>();

    source.register(event -> events.add(event.readData(String.class)));
    source.open();

    eventPublisher.publish("hello");

    assertEquals("hello", events.poll(2, TimeUnit.SECONDS));
    source.close();
}
```

Jangan biarkan SSE test tanpa timeout.

---

## 26. Contract Testing

Runtime test membuktikan implementation sekarang. Contract test membuktikan compatibility terhadap client.

Contract yang perlu dijaga:

- path
- method
- request headers
- request media type
- request body schema
- response status
- response headers
- response media type
- response body schema
- error body schema
- enum values
- pagination shape
- versioning/deprecation headers

### 26.1 OpenAPI-Based Contract Test

Pattern:

```text
1. Generate or maintain OpenAPI spec.
2. Run Jersey runtime test.
3. Validate every response against OpenAPI schema.
4. Fail build if implementation diverges.
```

Contoh assertion konseptual:

```java
@Test
void getOrder_shouldMatchOpenApiContract() {
    Response response = target("/orders/ORD-001")
        .request(MediaType.APPLICATION_JSON_TYPE)
        .get();

    openApiValidator.assertResponse(
        "GET",
        "/orders/{id}",
        response.getStatus(),
        response.getHeaders(),
        response.readEntity(String.class)
    );
}
```

### 26.2 Consumer-Driven Contract

Consumer-driven contract cocok saat ada client penting:

- frontend SPA
- mobile app
- agency integration
- partner integration
- internal service lain

Contract berasal dari ekspektasi consumer, bukan hanya schema provider.

Contoh consumer expectation:

```json
{
  "request": {
    "method": "GET",
    "path": "/orders/ORD-001",
    "headers": {
      "Accept": "application/json"
    }
  },
  "response": {
    "status": 200,
    "body": {
      "id": "ORD-001",
      "status": "SUBMITTED"
    }
  }
}
```

Contract test mencegah perubahan tidak sengaja seperti:

- rename field `status` menjadi `orderStatus`
- mengubah enum `SUBMITTED` menjadi `Submitted`
- menghapus nullable field yang consumer masih baca
- mengubah error status dari `409` ke `400`

---

## 27. Snapshot Testing: Berguna, Tapi Berbahaya Jika Malas

Snapshot testing menyimpan response body sebagai baseline.

Contoh:

```text
src/test/resources/snapshots/order-get-200.json
```

Keuntungan:

- mudah melihat perubahan shape
- bagus untuk response besar
- bagus untuk regression API

Risiko:

- developer update snapshot tanpa review
- snapshot terlalu brittle karena field timestamp/random
- test menjadi “approve everything”

Gunakan snapshot dengan normalisasi:

```java
String normalized = normalizeDynamicFields(responseBody,
    "$.timestamp",
    "$.traceId",
    "$.links.self.href"
);

assertMatchesSnapshot("order-get-200.json", normalized);
```

---

## 28. Failure Scenario Testing

Production-grade API harus punya failure tests.

Contoh failure matrix:

| Scenario | Expected |
|---|---|
| malformed JSON | 400 `MALFORMED_JSON` |
| invalid field | 400 `VALIDATION_FAILED` |
| unknown resource | 404 `NOT_FOUND` |
| unauthorized | 401 `UNAUTHENTICATED` |
| forbidden | 403 `FORBIDDEN` |
| conflict | 409 `CONFLICT` |
| optimistic lock | 409 `CONCURRENT_MODIFICATION` |
| payload too large | 413 `PAYLOAD_TOO_LARGE` |
| unsupported media | 415 `UNSUPPORTED_MEDIA_TYPE` |
| unacceptable accept | 406 `NOT_ACCEPTABLE` |
| remote timeout | 504 or mapped dependency error |
| dependency unavailable | 503 `DEPENDENCY_UNAVAILABLE` |
| unexpected exception | 500 generic safe error |

Test unexpected exception:

```java
@Test
void unexpectedException_shouldReturnSafe500() {
    fakeService.failWith(new NullPointerException("sensitive internal detail"));

    Response response = target("/orders/ORD-001")
        .request("application/problem+json")
        .get();

    assertEquals(500, response.getStatus());

    String json = response.readEntity(String.class);
    assertJsonPath(json, "$.code", "INTERNAL_ERROR");
    assertThat(json).doesNotContain("sensitive internal detail");
    assertThat(json).doesNotContain("NullPointerException");
}
```

---

## 29. Testing Audit and Regulatory Evidence

Dalam sistem case management/regulatory, test API tidak cukup hanya status/body. Harus membuktikan evidence trail.

Pertanyaan penting:

- siapa melakukan aksi?
- terhadap entity apa?
- kapan?
- dari channel apa?
- dengan correlation ID apa?
- input penting apa yang dicatat?
- keputusan apa yang terjadi?
- error apa yang terjadi?
- apakah sensitive data dimasking?

Contoh:

```java
@Test
void approveOrder_shouldEmitAuditEvent() {
    Response response = target("/orders/ORD-001/approve")
        .request(MediaType.APPLICATION_JSON_TYPE)
        .header("X-Test-User", "approver-a")
        .header("X-Correlation-Id", "corr-123")
        .post(Entity.json("""
            {"reason":"All documents verified"}
            """));

    assertEquals(200, response.getStatus());

    AuditEvent event = auditSink.singleEvent();
    assertEquals("ORDER_APPROVED", event.action());
    assertEquals("ORD-001", event.entityId());
    assertEquals("approver-a", event.actor());
    assertEquals("corr-123", event.correlationId());
    assertFalse(event.payload().contains("password"));
}
```

Ini bukan sekadar testing teknis. Ini testing defensibility.

---

## 30. Testing Idempotency

Idempotency test penting untuk command endpoint.

Scenario:

```text
POST /payments
Idempotency-Key: idem-001

First call succeeds but client times out.
Client retries with same key.
Server must return same result or safe equivalent.
```

Test:

```java
@Test
void repeatedPostWithSameIdempotencyKey_shouldReturnSameResultWithoutDuplicateCommand() {
    String body = """
        {"orderId":"ORD-001","amount":10.00}
        """;

    Response first = target("/payments")
        .request(MediaType.APPLICATION_JSON_TYPE)
        .header("Idempotency-Key", "idem-001")
        .post(Entity.json(body));

    Response second = target("/payments")
        .request(MediaType.APPLICATION_JSON_TYPE)
        .header("Idempotency-Key", "idem-001")
        .post(Entity.json(body));

    assertEquals(201, first.getStatus());
    assertEquals(201, second.getStatus());
    assertEquals(1, fakePaymentService.createCallCount());
}
```

Conflict case:

```java
@Test
void sameIdempotencyKeyWithDifferentBody_shouldReturn409() {
    postPayment("idem-001", "{" + "\"orderId\":\"ORD-001\",\"amount\":10}");

    Response response = postPayment("idem-001", "{" + "\"orderId\":\"ORD-001\",\"amount\":99}");

    assertEquals(409, response.getStatus());
    assertProblem(response, "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST");
}
```

---

## 31. Testing Pagination, Sorting, and Search APIs

Search endpoints sering terlihat sederhana tapi bug-nya banyak.

Test cases:

- default page/size
- max size enforced
- negative page rejected
- unknown sort field rejected
- stable ordering
- cursor pagination token valid
- cursor pagination token tampered
- filter combination
- empty result
- large result shape

Contoh:

```java
@Test
void search_shouldApplyDefaultPagination() {
    Response response = target("/orders")
        .request(MediaType.APPLICATION_JSON_TYPE)
        .get();

    assertEquals(200, response.getStatus());
    assertEquals(1, fakeService.lastCriteria().page());
    assertEquals(20, fakeService.lastCriteria().size());
}

@Test
void searchWithTooLargeSize_shouldReturn400OrClampAccordingToPolicy() {
    Response response = target("/orders")
        .queryParam("size", "10000")
        .request("application/problem+json")
        .get();

    assertEquals(400, response.getStatus());
    assertProblem(response, "INVALID_PAGE_SIZE");
}
```

Pilih policy:

- reject terlalu besar
- clamp ke maksimum

Jangan biarkan ambigu.

---

## 32. Testing URI Building and Proxy Headers

Jika resource membuat `Location` atau link, test harus membuktikan URL benar.

```java
@Test
void create_shouldReturnLocationHeader() {
    Response response = target("/orders")
        .request(MediaType.APPLICATION_JSON_TYPE)
        .post(Entity.json("{" + "\"customerId\":\"C-001\",\"quantity\":1}"));

    assertEquals(201, response.getStatus());
    assertThat(response.getHeaderString("Location"))
        .endsWith("/orders/ORD-001");
}
```

Untuk reverse proxy, in-memory test biasanya tidak cukup. Buat test external/servlet/gateway-specific:

```text
Request to internal app:
  Host: internal-service:8080
  X-Forwarded-Proto: https
  X-Forwarded-Host: api.example.com
  X-Forwarded-Prefix: /v1

Expected Location:
  https://api.example.com/v1/orders/ORD-001
```

Kalau framework/container tidak mengolah forwarded headers otomatis, kamu perlu filter/config khusus dan test khusus.

---

## 33. Testing Configuration Differences

Part 26 membahas config. Part 27 harus menguncinya lewat test.

Test startup config:

```java
@Test
void productionLikeConfig_shouldDisableWadlAndEntityFilteringDebug() {
    ResourceConfig config = TestResourceConfigFactory.productionLike(fakeService);

    assertEquals(false, config.getProperty("jersey.config.server.wadl.disableWadl"));
}
```

Lebih penting: behavioral config test.

```java
@Test
void whenDetailedErrorsDisabled_shouldNotExposeValidationInternals() {
    ResourceConfig config = TestResourceConfigFactory.withDetailedErrors(false);
    restartWith(config);

    Response response = target("/orders")
        .request("application/problem+json")
        .post(Entity.json("{" + "\"customerId\":\"\",\"quantity\":0}"));

    assertEquals(400, response.getStatus());
    assertThat(response.readEntity(String.class)).doesNotContain("ConstraintViolationImpl");
}
```

Config test yang baik membuktikan efek, bukan hanya nilai property.

---

## 34. Testing Auto-Discovery and Explicit Registration

Jika production mematikan auto-discovery, test harus sama. Jika production bergantung pada auto-discovery, test harus mendeteksi provider yang hilang.

Recommended production posture:

```text
Prefer explicit registration for critical providers.
Use auto-discovery only when trade-off understood.
```

Test:

```java
@Test
void jsonProvider_shouldBeExplicitlyRegistered() {
    ResourceConfig config = TestResourceConfigFactory.productionLike(fakeService);

    assertTrue(config.getClasses().contains(JacksonFeature.class));
}
```

Behavioral test:

```java
@Test
void jsonSerialization_shouldWorkWithProductionLikeConfig() {
    Response response = target("/orders/ORD-001")
        .request(MediaType.APPLICATION_JSON_TYPE)
        .get();

    assertEquals(200, response.getStatus());
    assertThat(response.readEntity(String.class)).contains("ORD-001");
}
```

---

## 35. Testing Backward Compatibility Across Versions

Jika API punya v1 dan v2, test keduanya.

```java
@Test
void v1OrderResponse_shouldKeepLegacyFieldName() {
    Response response = target("/v1/orders/ORD-001")
        .request(MediaType.APPLICATION_JSON_TYPE)
        .get();

    assertEquals(200, response.getStatus());
    assertJsonPath(response.readEntity(String.class), "$.order_status", "SUBMITTED");
}

@Test
void v2OrderResponse_shouldUseNewFieldName() {
    Response response = target("/v2/orders/ORD-001")
        .request(MediaType.APPLICATION_JSON_TYPE)
        .get();

    assertEquals(200, response.getStatus());
    assertJsonPath(response.readEntity(String.class), "$.status", "SUBMITTED");
}
```

Media type versioning:

```java
@Test
void vendorMediaTypeV1_shouldSelectV1Representation() {
    Response response = target("/orders/ORD-001")
        .request("application/vnd.example.order.v1+json")
        .get();

    assertEquals(200, response.getStatus());
    assertJsonPath(response.readEntity(String.class), "$.order_status", "SUBMITTED");
}
```

---

## 36. Test Data Strategy

Bad test data membuat test rapuh.

### 36.1 Avoid Magic Global Fixtures

Buruk:

```java
Order order = TestFixtures.defaultOrder();
```

Lalu semua test bergantung pada default yang berubah.

Lebih baik:

```java
Order order = OrderBuilder.anOrder()
    .id("ORD-001")
    .status(OrderStatus.SUBMITTED)
    .customerId("C-001")
    .build();
```

### 36.2 Use Builders for Intent

```java
CreateOrderRequest request = CreateOrderRequestBuilder.valid()
    .quantity(2)
    .build();
```

### 36.3 Keep API JSON Fixtures Close to Contract

```text
src/test/resources/api/orders/create-valid.json
src/test/resources/api/orders/create-invalid-missing-customer.json
src/test/resources/api/errors/validation-failed.json
```

### 36.4 Deterministic Time and IDs

Inject clock/id generator:

```java
bind(Clock.fixed(Instant.parse("2026-06-16T10:15:30Z"), ZoneOffset.UTC))
    .to(Clock.class);

bind(new FixedIdGenerator("ORD-001"))
    .to(IdGenerator.class);
```

Tanpa deterministik time/id, snapshot dan contract test akan noisy.

---

## 37. Parallel Test Execution

Jersey tests bisa bermasalah saat parallel jika:

- port fixed
- static mutable fake
- global system property
- shared temp directory
- shared mock server
- shared singleton client
- MDC/ThreadLocal tidak dibersihkan

Rule:

- gunakan random port
- jangan share mutable singleton antar test
- reset fake service di `@BeforeEach`
- gunakan temporary directory per test
- close `Client`, `Response`, `SseEventSource`
- jangan mutate global config tanpa restore

Contoh cleanup:

```java
@AfterEach
void cleanup() {
    fakeService.reset();
    auditSink.clear();
    MDC.clear();
}
```

---

## 38. Test Flakiness: Penyebab dan Obat

Flaky test lebih buruk daripada tidak ada test karena mengikis kepercayaan tim.

Penyebab umum:

- sleep-based wait
- async tanpa timeout
- port conflict
- real clock
- external dependency sungguhan
- test order dependency
- shared mutable state
- thread pool tidak shutdown
- response tidak ditutup
- SSE stream tidak ditutup

Obat:

- gunakan Awaitility atau polling dengan timeout
- gunakan fixed clock
- gunakan fake deterministic service
- gunakan random port
- isolate test data
- close resources
- fail fast
- log request/response hanya saat failure

Buruk:

```java
Thread.sleep(1000);
assertEquals(1, auditSink.count());
```

Lebih baik:

```java
await().atMost(2, TimeUnit.SECONDS)
    .untilAsserted(() -> assertEquals(1, auditSink.count()));
```

---

## 39. CI Strategy

Pisahkan test berdasarkan biaya.

```text
Fast lane, every commit:
  - unit tests
  - resource adapter tests
  - in-memory Jersey tests
  - contract schema tests

Medium lane, pull request:
  - Grizzly/servlet Jersey tests
  - outbound client mock server tests
  - multipart tests
  - failure matrix tests

Slow lane, nightly/pre-release:
  - external container tests
  - DB integration tests
  - Kubernetes smoke tests
  - performance smoke tests
  - compatibility tests across versions
```

Maven profile example:

```xml
<profiles>
    <profile>
        <id>fast-tests</id>
        <properties>
            <groups>unit,jersey-fast</groups>
        </properties>
    </profile>

    <profile>
        <id>integration-tests</id>
        <properties>
            <groups>jersey-container,contract,client</groups>
        </properties>
    </profile>
</profiles>
```

Atau gunakan naming convention:

```text
*Test.java       -> unit/fast
*IT.java         -> integration
*ContractTest.java
*SmokeTest.java
```

---

## 40. Performance Smoke Tests, Bukan Benchmark Palsu

Jersey runtime performance tidak bisa dinilai dari microbenchmark resource method.

Tapi performance smoke test tetap berguna untuk mendeteksi regression kasar:

- response time naik 5x
- JSON serialization meledak
- endpoint melakukan call dependency berulang
- memory allocation naik drastis
- pagination tidak dibatasi

Contoh sederhana:

```java
@Test
void listOrders_shouldCompleteWithinReasonableBudget() {
    long start = System.nanoTime();

    Response response = target("/orders")
        .queryParam("size", "100")
        .request(MediaType.APPLICATION_JSON_TYPE)
        .get();

    long elapsedMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start);

    assertEquals(200, response.getStatus());
    assertTrue(elapsedMs < 500, "unexpectedly slow response: " + elapsedMs + "ms");
}
```

Catatan:

- Jangan jadikan angka ini benchmark absolut.
- Gunakan untuk regression guard kasar.
- Untuk benchmark serius, gunakan metodologi load test/profiling terpisah.

---

## 41. Mutation Testing untuk Mapper/Policy

Untuk logic penting seperti authorization policy, error mapping, validation mapping, mutation testing bisa membantu.

Contoh bug yang sering lolos:

```java
if (user.hasRole("APPROVER") || user.id().equals(order.submitter())) {
    allow();
}
```

Seharusnya mungkin:

```java
if (user.hasRole("APPROVER") && !user.id().equals(order.submitter())) {
    allow();
}
```

Unit test biasa bisa miss jika tidak ada negative case. Mutation testing membantu mendeteksi assertion lemah.

Gunakan terutama untuk:

- authorization policy
- state transition rules
- error classification
- retry decision
- idempotency conflict logic
- validation mapping

---

## 42. Testing Checklist per Jersey Component

### Resource

- path benar
- method benar
- status code benar
- request DTO terbaca
- response DTO tertulis
- service dipanggil dengan command benar
- no business logic berlebihan

### Provider

- media type cocok
- generic type cocok
- priority benar
- conflict provider tidak terjadi
- failure mapping benar

### ExceptionMapper

- status benar
- error code benar
- safe message
- no stack trace leak
- correlation ID ada
- content type benar

### Filter

- ordering benar
- abort response benar
- context property/security context benar
- stream tidak rusak
- sensitive data tidak bocor

### Interceptor

- body tetap bisa dibaca/ditulis
- header tambahan benar
- exception aman
- stream close benar

### Client

- URL benar
- headers benar
- timeout benar
- response ditutup
- retry sesuai policy
- non-retryable tidak di-retry
- error mapping benar

### Config

- production-like config diuji
- feature flags behavior diuji
- auto-discovery policy jelas
- sensitive config tidak bocor

---

## 43. Anti-Patterns

### 43.1 Semua Test Mock Resource Method

```java
resource.create(dto);
```

Masalah: tidak menguji Jersey.

### 43.2 Semua Test Full E2E

Masalah: lambat, flaky, sulit diagnosis.

### 43.3 Test Config Terlalu Berbeda dari Production

Masalah: test hijau, production gagal.

### 43.4 Snapshot Tanpa Review

Masalah: breaking change di-approve tanpa sadar.

### 43.5 Mocking Jersey Client Internals

Masalah: test mengunci implementasi, bukan behavior HTTP.

### 43.6 Tidak Menutup Response

Masalah: connection leak baru muncul saat load.

### 43.7 Error Contract Tidak Diuji

Masalah: client gagal saat error, padahal success path hijau.

### 43.8 Tidak Ada Negative Authorization Test

Masalah: security bug lolos.

### 43.9 Tidak Test Media Type

Masalah: 406/415 muncul di integrasi client.

### 43.10 Sleep-Based Async Test

Masalah: flaky.

---

## 44. Reference Test Blueprint untuk Jersey API

Minimal production-grade test suite untuk satu resource penting:

```text
OrderResourceJerseyTest
  - create valid -> 201 + Location + body
  - create malformed JSON -> 400 MALFORMED_JSON
  - create invalid DTO -> 400 VALIDATION_FAILED
  - create unsupported media -> 415
  - create unacceptable accept -> 406
  - get existing -> 200 JSON shape
  - get missing -> 404 NOT_FOUND
  - approve unauthorized -> 401
  - approve forbidden -> 403
  - approve conflict -> 409
  - approve emits audit event
  - repeated idempotent create -> same result
  - same idempotency key different body -> 409
  - correlation ID propagated
  - error response contains correlation ID
  - no stack trace leak

OrderClientTest
  - sends URL/header/body correctly
  - maps 2xx response
  - maps 4xx response
  - maps 5xx response
  - timeout maps to dependency timeout
  - retry only retryable failures
  - closes response

OrderContractTest
  - success response matches OpenAPI/schema
  - error response matches problem schema
  - v1 compatibility preserved
  - v2 shape correct
```

---

## 45. Java 8–25 Considerations

### Java 8

- Jersey 2.x legacy likely.
- JUnit 4 may still appear in older codebases.
- Records unavailable; DTO classes need constructors/getters.
- Date/time with `java.time` available but JSON module must be configured.
- No virtual threads.

### Java 11

- Better baseline for many modern libraries.
- JDK HTTP client available, but Jersey Client still has its own connector model.
- TLS/runtime differences may affect integration tests.

### Java 17

- Baseline for many Jakarta EE 11-aligned stacks.
- Records/sealed classes may affect JSON tests.
- Stronger encapsulation can expose reflection/config issues.

### Java 21

- Virtual threads available.
- Test assumptions around thread names/thread locals may break.
- Async tests must be explicit about executor/context propagation.

### Java 25

- Treat as modern LTS runtime target.
- Re-run runtime integration tests under Java 25 before claiming compatibility.
- Watch dependency compatibility: Jersey version, JSON provider, servlet container, test framework, bytecode instrumentation, OpenTelemetry agent.

Compatibility test matrix idea:

```text
Legacy branch:
  Java 8 + Jersey 2.x + javax.ws.rs

Modern branch:
  Java 17/21/25 + Jersey 3.x/4.x + jakarta.ws.rs
```

Do not pretend one binary supports all versions unless dependency graph actually supports it.

---

## 46. Practical Decision Framework

When adding a new Jersey feature, ask:

```text
1. Is this pure logic?
   -> unit test.

2. Does it depend on annotation/resource matching/provider/filter/mapper?
   -> Jersey runtime test.

3. Does it affect external API contract?
   -> contract test.

4. Does it involve security/audit/idempotency/failure?
   -> negative/failure test.

5. Does it depend on servlet/container/proxy behavior?
   -> container/external integration test.

6. Does it involve outbound HTTP?
   -> mock HTTP server client test.

7. Does it involve performance/resource usage?
   -> performance smoke/profiling test.
```

---

## 47. Mini Exercises

### Exercise 1

Ambil satu resource existing. Buat daftar behavior yang tidak akan diuji jika resource dipanggil langsung sebagai Java object.

### Exercise 2

Buat Jersey runtime test untuk:

- valid request
- malformed JSON
- validation error
- domain conflict
- unauthorized
- unsupported media type

### Exercise 3

Buat fake security filter yang mengisi `SecurityContext`, lalu test resource yang membaca principal dan role.

### Exercise 4

Buat test untuk `ParamConverter<OrderId>`:

- valid path param
- invalid path param
- absent optional query param

### Exercise 5

Buat contract test untuk satu endpoint dengan response success dan error.

### Exercise 6

Buat outbound Jersey Client wrapper dan test menggunakan mock HTTP server:

- URL
- headers
- JSON body
- timeout
- retry
- error mapping

---

## 48. Review Questions

1. Kenapa unit test resource method tidak cukup untuk membuktikan Jersey API behavior?
2. Apa perbedaan fidelity antara in-memory dan Grizzly test container?
3. Kapan external container test diperlukan?
4. Kenapa error contract perlu diuji sama seriusnya dengan success contract?
5. Bagaimana cara menguji `SecurityContext` tanpa bergantung pada real OIDC provider?
6. Apa risiko test config yang berbeda dari production config?
7. Kenapa mocking Jersey Client internal sering buruk?
8. Apa saja failure mode yang harus diuji untuk multipart upload?
9. Bagaimana test idempotency untuk POST retry?
10. Apa bedanya contract test dan Jersey runtime integration test?
11. Kenapa response harus ditutup pada Jersey Client?
12. Bagaimana mencegah flaky test pada SSE/async endpoint?
13. Apa yang harus diuji ketika API berjalan di balik reverse proxy?
14. Bagaimana Java 8 vs Java 17/21/25 mempengaruhi Jersey testing?
15. Bagaimana kamu memutuskan apakah sebuah behavior perlu unit test, Jersey test, contract test, atau E2E test?

---

## 49. Ringkasan

Testing Jersey yang matang tidak dimulai dari “pakai JUnit apa?”, tetapi dari pemahaman bahwa Jersey adalah runtime dengan banyak keputusan tersembunyi:

- route matching
- method selection
- media negotiation
- body reader/writer
- provider priority
- exception mapper resolution
- filter/interceptor ordering
- injection lifecycle
- validation integration
- security context
- client connector behavior
- deployment/container behavior

Unit test tetap penting, tetapi tidak cukup untuk membuktikan API behavior. Jersey Test Framework mengisi gap dengan menjalankan request melalui runtime Jersey. Contract test menjaga compatibility. Failure test menjaga reliability dan security. External/container test menjaga deployment fidelity.

Testing strategy yang baik selalu eksplisit tentang trade-off:

```text
speed vs fidelity
isolation vs realism
unit confidence vs runtime confidence
provider behavior vs business logic
contract stability vs implementation freedom
```

Top 1% engineer tidak hanya menulis banyak test. Mereka menulis test yang membuktikan boundary penting, mencegah incident nyata, dan tetap maintainable saat sistem tumbuh.

---

## 50. Apa yang Berlanjut ke Part 28

Part 27 membahas bagaimana membuktikan behavior Jersey. Part 28 akan masuk ke level berikutnya: bagaimana membuat extension Jersey sendiri.

Kita akan membahas:

- `Feature`
- `DynamicFeature`
- custom annotation
- name binding
- provider module
- filter/interceptor extension
- HK2 binder extension
- reusable platform module
- version compatibility
- testing extension
- desain extension yang tidak menjadi magic framework berbahaya

Dengan kata lain, setelah tahu cara menguji Jersey, kita akan belajar cara memperluas Jersey secara aman.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 26 — Configuration Engineering: Properties, Environments, Features, and Runtime Flags](./26-configuration-engineering-properties-environments-features-runtime-flags.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 28 — Extension Engineering: Feature, DynamicFeature, Binder, Provider, and SPI Design](./28-extension-engineering-feature-dynamicfeature-binder-provider-spi-design.md)
