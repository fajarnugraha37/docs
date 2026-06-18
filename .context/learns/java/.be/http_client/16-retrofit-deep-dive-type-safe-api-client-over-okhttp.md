# Part 16 — Retrofit Deep Dive: Type-Safe API Client di Atas OkHttp

Series: `learn-java-http-client-okhttp-retrofit-client-engineering`  
File: `16-retrofit-deep-dive-type-safe-api-client-over-okhttp.md`  
Target: Java 8 hingga Java 25  
Level: Advanced / production engineering

---

## 1. Tujuan Part Ini

Pada part sebelumnya kita sudah membahas JDK `HttpClient` dan OkHttp sebagai engine HTTP client. Sekarang kita masuk ke **Retrofit**.

Retrofit sering terlihat sederhana:

```java
interface UserApi {
    @GET("users/{id}")
    Call<UserDto> getUser(@Path("id") String id);
}
```

Namun untuk engineer senior/top-tier, Retrofit tidak boleh dipahami hanya sebagai library annotation. Retrofit adalah **contract-to-transport adapter**:

```text
Java interface contract
    ↓
method annotation parsing
    ↓
request template
    ↓
argument binding
    ↓
converter
    ↓
call adapter
    ↓
OkHttp Call
    ↓
network execution
    ↓
response classification
    ↓
domain-safe result
```

Dengan kata lain, Retrofit membantu kita membuat HTTP client yang:

- type-safe di level method signature;
- deklaratif;
- mudah dites;
- mudah di-wrap sebagai SDK internal;
- bisa memakai OkHttp sebagai transport engine;
- bisa memakai converter seperti Jackson/Gson/Moshi/Scalars;
- bisa memakai call adapter untuk model sinkron, async, reactive, atau wrapper hasil custom.

Tetapi Retrofit juga punya jebakan:

- interface terlalu dekat dengan domain layer;
- error body tidak dimodelkan dengan benar;
- `Call<T>` bocor ke business service;
- authentication logic tersebar;
- retry ditempatkan di interceptor tanpa idempotency;
- converter terlalu permisif;
- `Response<T>` dianggap sukses hanya karena request tidak melempar exception;
- base URL dan path composition salah;
- dynamic header dan query tidak divalidasi;
- generated API client menabrak governance internal.

Part ini akan membangun pemahaman Retrofit sebagai **API client boundary**, bukan hanya syntax annotation.

---

## 2. Posisi Retrofit dalam Stack HTTP Client Java

Retrofit bukan transport layer murni. Transport default dan paling lazimnya adalah OkHttp.

```text
Application Service
    ↓
Domain Port
    ↓
External API Adapter / Gateway
    ↓
Retrofit Interface
    ↓
Converter + CallAdapter
    ↓
OkHttpClient
    ↓
DNS / TCP / TLS / HTTP
    ↓
Remote API
```

Pembagian tanggung jawabnya:

| Layer | Tanggung jawab |
|---|---|
| Domain service | Membuat keputusan bisnis |
| Port/interface internal | Abstraksi kebutuhan domain |
| Adapter/gateway | Translate domain request ke API request |
| Retrofit interface | Deklarasi endpoint HTTP |
| Converter | Serialize/deserialize body |
| Call adapter | Mengubah `Call<T>` menjadi model return lain |
| OkHttp | Connection, timeout, TLS, interceptor, dispatcher, pool |
| Remote API | Contract eksternal |

Mental model penting:

> Retrofit bukan tempat domain logic. Retrofit adalah deklarasi protokol HTTP yang dibungkus oleh adapter yang domain-aware.

---

## 3. Apa yang Retrofit Selesaikan

Tanpa Retrofit, banyak code HTTP client berubah menjadi utility imperative:

```java
HttpUrl url = baseUrl.newBuilder()
    .addPathSegment("users")
    .addPathSegment(id)
    .addQueryParameter("include", "roles")
    .build();

Request request = new Request.Builder()
    .url(url)
    .header("Authorization", "Bearer " + token)
    .get()
    .build();

try (Response response = client.newCall(request).execute()) {
    if (!response.isSuccessful()) {
        throw ...;
    }
    return mapper.readValue(response.body().string(), UserDto.class);
}
```

Retrofit memindahkan sebagian besar detail itu menjadi deklarasi:

```java
interface UserRemoteApi {
    @GET("users/{id}")
    Call<UserDto> getUser(
        @Path("id") String id,
        @Query("include") String include
    );
}
```

Manfaatnya:

1. Endpoint terlihat jelas.
2. Path/query/header/body binding eksplisit.
3. Boilerplate turun.
4. Test terhadap request lebih mudah.
5. Converter bisa diganti secara terpusat.
6. Client interface bisa dipakai sebagai contract boundary.
7. Cocok untuk generated client dari OpenAPI.

Namun konsekuensinya:

1. Behavior tersembunyi di annotation.
2. Runtime validation baru terjadi ketika method dipakai atau service dibuat.
3. Error semantics tidak otomatis domain-safe.
4. Transport policy tetap harus dikonfigurasi di OkHttp.
5. Interface bisa menjadi terlalu mirip remote API dan mencemari domain model.

---

## 4. Retrofit Object Model

### 4.1 `Retrofit`

`Retrofit` adalah factory utama yang membaca interface dan menghasilkan implementation runtime.

```java
Retrofit retrofit = new Retrofit.Builder()
    .baseUrl("https://api.example.com/")
    .client(okHttpClient)
    .addConverterFactory(JacksonConverterFactory.create(objectMapper))
    .build();

UserRemoteApi api = retrofit.create(UserRemoteApi.class);
```

Yang perlu dipahami:

- `Retrofit` sebaiknya dibuat sekali per remote API/config utama.
- `Retrofit` biasanya berbagi `OkHttpClient` atau memakai client khusus per downstream.
- `baseUrl` harus berakhir dengan `/`.
- `create()` menghasilkan proxy implementation dari interface.
- Annotation method akan dipakai untuk membangun request.

### 4.2 Retrofit Interface

Interface mendeskripsikan endpoint.

```java
interface PaymentApi {
    @POST("payments")
    Call<PaymentResponseDto> createPayment(@Body PaymentRequestDto request);

    @GET("payments/{paymentId}")
    Call<PaymentResponseDto> getPayment(@Path("paymentId") String paymentId);
}
```

Prinsip:

- interface merepresentasikan remote API, bukan domain service;
- jangan campur logic;
- jangan pakai DTO domain langsung;
- jangan expose interface ini ke seluruh aplikasi;
- bungkus dengan adapter yang mengubahnya menjadi port internal.

### 4.3 `Call<T>`

`Call<T>` merepresentasikan satu HTTP request yang bisa dieksekusi.

```java
Call<UserDto> call = api.getUser("123", "roles");
Response<UserDto> response = call.execute();
```

Karakteristik penting:

- satu `Call` hanya untuk satu execution;
- untuk mengulang, gunakan `clone()`;
- bisa sync dengan `execute()`;
- bisa async dengan `enqueue()`;
- bisa dibatalkan dengan `cancel()`;
- response harus diklasifikasikan: transport success belum tentu business success.

### 4.4 `Response<T>`

`Response<T>` mewakili HTTP response.

```java
Response<UserDto> response = call.execute();

if (response.isSuccessful()) {
    UserDto body = response.body();
} else {
    ResponseBody errorBody = response.errorBody();
}
```

Jebakan umum:

- `isSuccessful()` hanya berarti status code 2xx.
- `body()` bisa `null`, bahkan pada 2xx tertentu seperti 204.
- `errorBody()` perlu dikonsumsi hati-hati.
- error body parsing harus eksplisit.
- 200 dengan body berisi `{ "success": false }` bukan otomatis sukses domain.

---

## 5. Annotation Model

Retrofit mengubah method annotation menjadi request template.

### 5.1 HTTP Method Annotation

Built-in annotation umum:

```java
@GET
@POST
@PUT
@PATCH
@DELETE
@HEAD
@OPTIONS
@HTTP
```

Contoh:

```java
interface CaseApi {
    @GET("cases/{id}")
    Call<CaseDto> getCase(@Path("id") String id);

    @POST("cases")
    Call<CreateCaseResponseDto> createCase(@Body CreateCaseRequestDto request);

    @PATCH("cases/{id}/status")
    Call<StatusUpdateResponseDto> updateStatus(
        @Path("id") String id,
        @Body StatusUpdateRequestDto request
    );
}
```

Rule mental:

```text
Annotation method = request method + relative URL template
Parameter annotation = cara mengisi template/header/query/body
Converter = cara mengubah object ↔ bytes
CallAdapter = cara mengubah Call<T> ↔ return type method
```

### 5.2 `@Path`

`@Path` mengganti placeholder dalam path.

```java
@GET("users/{userId}")
Call<UserDto> getUser(@Path("userId") String userId);
```

Jangan lakukan ini:

```java
@GET("users/" + userId) // tidak bisa, userId bukan compile-time constant
```

Security concern:

- path parameter tidak boleh trusted mentah;
- validasi identifier di adapter sebelum memanggil Retrofit;
- jangan izinkan path traversal semantic seperti `../`;
- hati-hati dengan `encoded = true`.

Contoh validasi:

```java
public User getUser(UserId userId) {
    String raw = userId.value();
    if (!raw.matches("[A-Za-z0-9_-]{1,64}")) {
        throw new IllegalArgumentException("Invalid user id");
    }
    return execute(api.getUser(raw));
}
```

### 5.3 `@Query`

`@Query` menambah query parameter.

```java
@GET("users")
Call<List<UserDto>> searchUsers(
    @Query("name") String name,
    @Query("page") int page,
    @Query("size") int size
);
```

Pertimbangan:

- `null` biasanya diabaikan;
- list bisa menjadi repeated query parameter;
- query parameter sensitif dapat muncul di log, proxy, browser history, observability tools;
- jangan taruh secret/token di query.

### 5.4 `@QueryMap`

`@QueryMap` fleksibel, tetapi rawan governance issue.

```java
@GET("reports")
Call<ReportPageDto> searchReports(@QueryMap Map<String, String> filters);
```

Masalah:

- key tidak type-safe;
- value validation tersebar;
- canonical ordering tidak eksplisit;
- bisa memasukkan query parameter tak diinginkan.

Lebih aman untuk API penting:

```java
record ReportSearchRequest(
    String status,
    LocalDate fromDate,
    LocalDate toDate,
    int page,
    int size
) {}
```

Lalu adapter mengubah request object menjadi parameter eksplisit.

### 5.5 `@Header`, `@HeaderMap`, `@Headers`

Static header:

```java
@Headers({
    "Accept: application/json"
})
@GET("users/{id}")
Call<UserDto> getUser(@Path("id") String id);
```

Dynamic header:

```java
@GET("users/{id}")
Call<UserDto> getUser(
    @Header("X-Correlation-Id") String correlationId,
    @Path("id") String id
);
```

Namun untuk header lintas semua request, lebih baik gunakan OkHttp interceptor:

```java
class CorrelationIdInterceptor implements Interceptor {
    @Override
    public Response intercept(Chain chain) throws IOException {
        Request original = chain.request();
        String correlationId = CorrelationContext.currentOrNew();

        Request request = original.newBuilder()
            .header("X-Correlation-Id", correlationId)
            .build();

        return chain.proceed(request);
    }
}
```

Rule:

| Header type | Tempat ideal |
|---|---|
| Per-endpoint static header | `@Headers` |
| Per-call dynamic business header | method parameter |
| Cross-cutting auth/correlation | OkHttp interceptor |
| Sensitive token | interceptor/token provider, bukan service method |
| Trace context | instrumentation/interceptor |

### 5.6 `@Body`

```java
@POST("orders")
Call<OrderResponseDto> createOrder(@Body CreateOrderRequestDto request);
```

`@Body` memakai converter factory.

Risiko:

- DTO terlalu longgar;
- field null tidak dimodelkan;
- unknown field handling tidak dipikirkan;
- date/time format tidak jelas;
- BigDecimal precision rusak jika pakai floating point;
- enum baru dari provider menyebabkan failure.

### 5.7 `@FormUrlEncoded` dan `@Field`

```java
@FormUrlEncoded
@POST("oauth/token")
Call<TokenResponseDto> token(
    @Field("grant_type") String grantType,
    @Field("client_id") String clientId,
    @Field("client_secret") String clientSecret
);
```

Gunakan untuk endpoint yang memang mengharapkan `application/x-www-form-urlencoded`, misalnya token endpoint OAuth2 tertentu.

Security note:

- jangan log form body yang berisi secret;
- jangan expose form credential di exception message;
- pastikan TLS valid.

### 5.8 `@Multipart` dan `@Part`

```java
@Multipart
@POST("documents")
Call<DocumentUploadResponseDto> upload(
    @Part MultipartBody.Part file,
    @Part("caseId") RequestBody caseId
);
```

Contoh membangun part:

```java
RequestBody fileBody = RequestBody.create(file, MediaType.parse("application/pdf"));
MultipartBody.Part part = MultipartBody.Part.createFormData(
    "file",
    file.getName(),
    fileBody
);
```

Risiko:

- file besar dibuffer tidak sengaja;
- content type salah;
- filename mengandung karakter aneh;
- virus/malware scanning tidak ada;
- timeout upload terlalu kecil;
- retry upload bisa menggandakan side effect.

### 5.9 `@Url`

`@Url` memungkinkan dynamic URL.

```java
@GET
Call<ResponseBody> download(@Url String url);
```

Ini powerful tapi berbahaya.

Risiko:

- SSRF;
- bypass base URL;
- redirect ke host tidak dipercaya;
- call ke metadata endpoint cloud;
- call ke internal network.

Untuk production system, `@Url` harus dilindungi allowlist:

```java
final class SafeDownloadClient {
    private final DownloadApi api;
    private final Set<String> allowedHosts;

    public ResponseBody download(URI uri) throws IOException {
        if (!allowedHosts.contains(uri.getHost())) {
            throw new SecurityException("Host not allowed");
        }
        return execute(api.download(uri.toString()));
    }
}
```

---

## 6. Base URL dan Path Composition

Retrofit punya rule penting: `baseUrl` harus berakhir dengan slash.

```java
new Retrofit.Builder()
    .baseUrl("https://api.example.com/v1/")
    .build();
```

Relative URL:

```java
@GET("users")
```

akan menjadi:

```text
https://api.example.com/v1/users
```

Hindari ambiguity:

```java
.baseUrl("https://api.example.com/v1") // salah/bermasalah karena tidak trailing slash
```

Mental model:

```text
baseUrl = directory root
relative path = file/resource under root
```

Jika annotation path diawali `/`, ia bisa mengganti path base tertentu tergantung resolution semantics. Untuk governance, gunakan style konsisten:

```java
baseUrl: "https://api.example.com/v1/"
@GET("users/{id}")
```

bukan campuran:

```java
@GET("/v1/users/{id}")
@GET("users/{id}")
@GET("../users/{id}")
```

---

## 7. Converter Factory

Converter adalah layer yang mengubah:

```text
Java object → request body bytes
response body bytes → Java object
```

Contoh:

```java
Retrofit retrofit = new Retrofit.Builder()
    .baseUrl("https://api.example.com/")
    .client(okHttpClient)
    .addConverterFactory(JacksonConverterFactory.create(objectMapper))
    .build();
```

### 7.1 Jackson Converter

Cocok untuk backend Java yang sudah memakai Jackson.

Keunggulan:

- integrasi kuat dengan Java backend;
- kontrol `ObjectMapper` luas;
- dukungan Java time module;
- familiar di Spring ecosystem.

Checklist ObjectMapper boundary:

```java
ObjectMapper mapper = JsonMapper.builder()
    .addModule(new JavaTimeModule())
    .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES) // keputusan sadar
    .enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS)
    .build();
```

Catatan:

- `FAIL_ON_UNKNOWN_PROPERTIES=false` meningkatkan forward compatibility, tetapi bisa menyembunyikan drift;
- untuk regulated system, unknown field tertentu mungkin perlu audit/metric;
- enum handling harus dipikirkan.

### 7.2 Gson Converter

Gson populer karena sederhana, tetapi di backend modern sering kalah fleksibel dari Jackson untuk enterprise needs.

Perhatikan:

- date/time handling;
- null handling;
- custom type adapter;
- BigDecimal handling;
- field naming strategy.

### 7.3 Moshi Converter

Moshi umum di ekosistem Square/Kotlin, tetapi bisa juga dipakai JVM.

Perhatikan:

- Kotlin support jika pakai Kotlin;
- adapter explicit;
- nullability model lebih kuat di Kotlin.

### 7.4 Scalars Converter

Dipakai untuk response/request sederhana seperti plain text.

```java
.addConverterFactory(ScalarsConverterFactory.create())
```

Ordering converter penting. Converter pertama yang cocok bisa menangani tipe tertentu.

Contoh:

```java
Retrofit retrofit = new Retrofit.Builder()
    .baseUrl(baseUrl)
    .addConverterFactory(ScalarsConverterFactory.create())
    .addConverterFactory(JacksonConverterFactory.create(mapper))
    .build();
```

### 7.5 Custom Converter

Custom converter berguna jika API:

- membungkus response dalam envelope custom;
- memakai encrypted payload;
- memakai format legacy;
- butuh strict validation;
- butuh audit ketika unknown field muncul.

Namun jangan terlalu cepat membuat custom converter. Kadang lebih aman parsing di adapter setelah response dikembalikan.

---

## 8. Call Adapter

Call adapter mengubah return type method interface.

Default:

```java
Call<UserDto> getUser(...)
```

Dengan adapter tertentu, method bisa mengembalikan:

```java
CompletableFuture<UserDto>
Single<UserDto>
Mono<UserDto>
ApiResult<UserDto>
```

Konsep:

```text
Retrofit Call<T>
    ↓ CallAdapter
Chosen return type
```

### 8.1 Kenapa Call Adapter Penting

Tanpa call adapter, wrapper logic sering tersebar:

```java
Response<UserDto> response = api.getUser(id).execute();
if (response.isSuccessful()) { ... }
else { ... }
```

Dengan custom adapter atau adapter wrapper, kita bisa memusatkan:

- response classification;
- error body parsing;
- exception mapping;
- cancellation semantics;
- metrics hook;
- default result envelope.

### 8.2 Tapi Jangan Berlebihan

Custom call adapter yang terlalu pintar bisa menyembunyikan behavior.

Rule:

- low-level transport failure boleh diklasifikasikan terpusat;
- business semantic failure tetap sebaiknya di adapter/gateway domain-aware;
- retry/circuit breaker sering lebih jelas di layer wrapper/resilience decorator daripada call adapter.

---

## 9. Sync vs Async Retrofit

### 9.1 Sync

```java
Response<UserDto> response = api.getUser("123").execute();
```

Cocok untuk:

- backend blocking flow;
- virtual threads;
- simple orchestration;
- batch job;
- command processing;
- code yang ingin deterministic dan mudah dibaca.

Perlu:

- timeout benar;
- bulkhead/concurrency limit;
- no infinite queue;
- response classification.

### 9.2 Async Callback

```java
api.getUser("123").enqueue(new Callback<UserDto>() {
    @Override
    public void onResponse(Call<UserDto> call, Response<UserDto> response) {
        // handle
    }

    @Override
    public void onFailure(Call<UserDto> call, Throwable t) {
        // handle
    }
});
```

Cocok untuk:

- Android legacy callback style;
- non-blocking integration tanpa reactive stack;
- fire-and-callback operation.

Kelemahan:

- callback nesting;
- error propagation lebih sulit;
- cancellation harus jelas;
- tracing context bisa hilang;
- testing lebih kompleks.

### 9.3 CompletableFuture Bridge

Untuk Java 8+ backend, `CompletableFuture` bisa jadi bridge:

```java
static <T> CompletableFuture<Response<T>> toFuture(Call<T> call) {
    CompletableFuture<Response<T>> future = new CompletableFuture<>();

    call.enqueue(new Callback<T>() {
        @Override
        public void onResponse(Call<T> call, Response<T> response) {
            future.complete(response);
        }

        @Override
        public void onFailure(Call<T> call, Throwable t) {
            if (call.isCanceled()) {
                future.cancel(false);
            } else {
                future.completeExceptionally(t);
            }
        }
    });

    future.whenComplete((ignored, throwable) -> {
        if (future.isCancelled()) {
            call.cancel();
        }
    });

    return future;
}
```

Perhatikan:

- cancellation harus diteruskan ke `Call.cancel()`;
- executor callback berasal dari OkHttp dispatcher;
- jangan lakukan CPU-heavy processing di thread callback;
- context propagation perlu dipikirkan.

---

## 10. Error Handling yang Benar

Retrofit memisahkan beberapa jenis hasil:

```text
Transport/network failure
    → onFailure / IOException / timeout / DNS / TLS

HTTP response diterima tetapi non-2xx
    → Response<T>.isSuccessful() == false
    → errorBody()

HTTP response 2xx tetapi body invalid
    → converter exception

HTTP response 2xx, body valid, tetapi semantic business error
    → domain-level classification
```

### 10.1 Jangan Samakan Semua Error

Buruk:

```java
try {
    Response<UserDto> response = api.getUser(id).execute();
    return response.body();
} catch (Exception e) {
    throw new RuntimeException("Failed to call user API", e);
}
```

Lebih baik:

```java
sealed interface RemoteFailure permits
    RemoteFailure.Transport,
    RemoteFailure.Timeout,
    RemoteFailure.Tls,
    RemoteFailure.HttpStatus,
    RemoteFailure.Decode,
    RemoteFailure.Semantic {

    record Transport(IOException cause) implements RemoteFailure {}
    record Timeout(Throwable cause) implements RemoteFailure {}
    record Tls(Throwable cause) implements RemoteFailure {}
    record HttpStatus(int status, String errorCode, String message) implements RemoteFailure {}
    record Decode(Throwable cause) implements RemoteFailure {}
    record Semantic(String code, String message) implements RemoteFailure {}
}
```

Untuk Java 8, gunakan interface/class biasa:

```java
abstract class RemoteFailure {
    static final class Transport extends RemoteFailure { ... }
    static final class HttpStatus extends RemoteFailure { ... }
}
```

### 10.2 Error Body Parsing

Contoh response error:

```json
{
  "code": "INVALID_STATUS_TRANSITION",
  "message": "Cannot approve a closed case"
}
```

Parser:

```java
final class ErrorBodyParser {
    private final Converter<ResponseBody, ApiErrorDto> converter;

    ErrorBodyParser(Retrofit retrofit) {
        this.converter = retrofit.responseBodyConverter(
            ApiErrorDto.class,
            new Annotation[0]
        );
    }

    ApiErrorDto parse(ResponseBody body) {
        if (body == null) {
            return new ApiErrorDto("UNKNOWN", "No error body");
        }
        try {
            return converter.convert(body);
        } catch (Exception e) {
            return new ApiErrorDto("UNPARSEABLE_ERROR", "Failed to parse error body");
        }
    }
}
```

Important:

- error body hanya bisa dikonsumsi sekali;
- jangan log full body jika mungkin mengandung PII/secret;
- batasi ukuran error body yang dibaca;
- parsing error body tidak boleh menutupi status code asli.

### 10.3 Domain Result Wrapper

Adapter internal sebaiknya tidak mengembalikan raw `Response<T>`.

Contoh:

```java
public final class UserGateway {
    private final UserRemoteApi api;
    private final ErrorBodyParser errorParser;

    public RemoteResult<User> findUser(UserId id) {
        try {
            Response<UserDto> response = api.getUser(id.value()).execute();

            if (response.isSuccessful()) {
                UserDto dto = response.body();
                if (dto == null) {
                    return RemoteResult.failure(RemoteFailure.decode("Empty body"));
                }
                return RemoteResult.success(mapToDomain(dto));
            }

            ApiErrorDto error = errorParser.parse(response.errorBody());
            return RemoteResult.failure(RemoteFailure.http(
                response.code(),
                error.code(),
                error.message()
            ));
        } catch (SocketTimeoutException e) {
            return RemoteResult.failure(RemoteFailure.timeout(e));
        } catch (SSLException e) {
            return RemoteResult.failure(RemoteFailure.tls(e));
        } catch (IOException e) {
            return RemoteResult.failure(RemoteFailure.transport(e));
        }
    }
}
```

---

## 11. Authentication dengan Retrofit + OkHttp

Jangan menaruh token acquisition di setiap method.

Buruk:

```java
api.getUser("Bearer " + tokenService.getToken(), id);
```

Lebih baik:

```java
class BearerTokenInterceptor implements Interceptor {
    private final TokenProvider tokenProvider;

    @Override
    public Response intercept(Chain chain) throws IOException {
        String token = tokenProvider.currentToken();
        Request request = chain.request().newBuilder()
            .header("Authorization", "Bearer " + token)
            .build();
        return chain.proceed(request);
    }
}
```

Untuk refresh setelah 401, gunakan `Authenticator` atau explicit wrapper policy.

Contoh conceptual:

```java
class RefreshingAuthenticator implements Authenticator {
    private final TokenProvider tokenProvider;

    @Override
    public Request authenticate(Route route, Response response) throws IOException {
        if (responseCount(response) >= 2) {
            return null;
        }

        String freshToken = tokenProvider.refreshSingleFlight();

        return response.request().newBuilder()
            .header("Authorization", "Bearer " + freshToken)
            .build();
    }

    private int responseCount(Response response) {
        int count = 1;
        while ((response = response.priorResponse()) != null) {
            count++;
        }
        return count;
    }
}
```

Rules:

- token refresh harus single-flight;
- refresh loop harus dibatasi;
- 401 untuk credential expired berbeda dengan 403 unauthorized;
- retry setelah refresh harus memperhatikan idempotency/body repeatability;
- log tidak boleh mengandung token.

---

## 12. Timeout, Retry, Circuit Breaker dengan Retrofit

Retrofit sendiri bukan tempat utama konfigurasi timeout. Timeout ada di OkHttp.

```java
OkHttpClient client = new OkHttpClient.Builder()
    .connectTimeout(Duration.ofSeconds(2))
    .readTimeout(Duration.ofSeconds(3))
    .writeTimeout(Duration.ofSeconds(3))
    .callTimeout(Duration.ofSeconds(5))
    .build();
```

Retrofit memakai client itu:

```java
Retrofit retrofit = new Retrofit.Builder()
    .baseUrl(baseUrl)
    .client(client)
    .addConverterFactory(JacksonConverterFactory.create(mapper))
    .build();
```

Retry/circuit breaker idealnya di wrapper/gateway:

```java
Supplier<RemoteResult<User>> supplier = () -> userGateway.findUser(userId);

RemoteResult<User> result = Decorators.ofSupplier(supplier)
    .withCircuitBreaker(circuitBreaker)
    .withRetry(retry)
    .withBulkhead(bulkhead)
    .get();
```

Namun pastikan ordering sesuai desain:

```text
bulkhead/rate limit
→ per-attempt timeout
→ retry policy
→ circuit breaker visibility
→ fallback/domain decision
```

Jangan lupa:

- OkHttp punya internal recovery untuk koneksi tertentu;
- application-level retry harus memahami idempotency;
- `POST` tanpa idempotency key jangan di-retry sembarangan;
- upload streaming body mungkin tidak repeatable;
- retry nested di interceptor + resilience library bisa menggandakan attempt.

---

## 13. Observability Retrofit Client

Observability tidak cukup di service layer. HTTP client boundary harus menghasilkan sinyal:

- remote service name;
- operation name;
- method;
- route template, bukan raw URL penuh;
- status code;
- failure kind;
- latency;
- retry count;
- timeout count;
- circuit breaker state;
- request size/response size jika aman;
- correlation id/trace id;
- redacted headers.

### 13.1 Route Template Problem

OkHttp request hanya tahu URL final, misalnya:

```text
/users/123456789
```

Metric dengan raw URL akan menghasilkan cardinality tinggi.

Lebih baik gunakan operation name eksplisit di adapter:

```java
try (Observation.Scope scope = observation.openScope()) {
    return execute(api.getUser(id.value()), "UserApi.getUser");
}
```

atau tambahkan tag via request header/internal tag.

OkHttp `Request.tag()` bisa digunakan untuk metadata internal:

```java
Request request = original.newBuilder()
    .tag(HttpOperation.class, new HttpOperation("UserApi.getUser"))
    .build();
```

Di Retrofit, penambahan tag bisa dilakukan via custom annotation/call adapter/interceptor pattern, tetapi harus dirancang hati-hati.

### 13.2 Logging

Aman:

```text
operation=UserApi.getUser
method=GET
host=api.example.com
status=404
failure_kind=HTTP_STATUS
latency_ms=82
correlation_id=...
```

Tidak aman:

```text
Authorization=Bearer eyJ...
Set-Cookie=...
url=https://api.example.com/users?token=...
body={"nric":"...","password":"..."}
```

---

## 14. Testing Retrofit Client

Retrofit sangat cocok dites dengan OkHttp `MockWebServer`.

### 14.1 Test Request Construction

```java
MockWebServer server = new MockWebServer();
server.enqueue(new MockResponse()
    .setResponseCode(200)
    .setHeader("Content-Type", "application/json")
    .setBody("{\"id\":\"u-1\",\"name\":\"Alice\"}"));

Retrofit retrofit = new Retrofit.Builder()
    .baseUrl(server.url("/"))
    .client(new OkHttpClient())
    .addConverterFactory(JacksonConverterFactory.create(objectMapper))
    .build();

UserRemoteApi api = retrofit.create(UserRemoteApi.class);
Response<UserDto> response = api.getUser("u-1").execute();

RecordedRequest request = server.takeRequest();
assertEquals("GET", request.getMethod());
assertEquals("/users/u-1", request.getPath());
assertEquals("application/json", request.getHeader("Accept"));
```

### 14.2 Test Error Body

```java
server.enqueue(new MockResponse()
    .setResponseCode(400)
    .setHeader("Content-Type", "application/json")
    .setBody("{\"code\":\"INVALID_REQUEST\",\"message\":\"Bad input\"}"));
```

Verify:

- status code mapped;
- error code parsed;
- body not logged raw;
- retry not attempted for non-retryable 400.

### 14.3 Test Timeout

```java
server.enqueue(new MockResponse()
    .setBody("{\"id\":\"u-1\"}")
    .setBodyDelay(5, TimeUnit.SECONDS));
```

Verify:

- timeout exception classified;
- circuit breaker metrics updated;
- no infinite wait.

### 14.4 Test Auth Header Redaction

Use interceptor logs/test appender to ensure token is not printed.

### 14.5 Test Multipart

Verify:

- content type;
- file part name;
- filename;
- metadata field;
- boundary exists;
- large file path does not buffer unnecessarily.

---

## 15. Retrofit dalam Clean Architecture / Hexagonal Architecture

Jangan expose Retrofit interface sebagai dependency business service.

Buruk:

```java
class CaseService {
    private final RemoteCaseApi api;

    void approve(String caseId) {
        api.updateStatus(caseId, new StatusUpdateRequestDto("APPROVED"));
    }
}
```

Masalah:

- business service tahu DTO remote;
- business service tahu HTTP operation;
- error handling tersebar;
- migration remote API sulit;
- testing business service bergantung pada Retrofit semantics.

Lebih baik:

```java
interface CaseRegistryPort {
    RemoteResult<ExternalCase> findCase(ExternalCaseId id);
    RemoteResult<Void> submitStatusChange(ExternalCaseId id, StatusChange change);
}
```

Implementation:

```java
final class RetrofitCaseRegistryAdapter implements CaseRegistryPort {
    private final CaseRemoteApi api;
    private final RetrofitExecutor executor;
    private final CaseMapper mapper;

    @Override
    public RemoteResult<ExternalCase> findCase(ExternalCaseId id) {
        return executor.execute(
            "CaseRemoteApi.getCase",
            api.getCase(id.value()),
            dto -> mapper.toDomain(dto)
        );
    }
}
```

Hasil:

```text
Domain service
    depends on CaseRegistryPort
        implemented by RetrofitCaseRegistryAdapter
            depends on CaseRemoteApi
```

---

## 16. Retrofit Executor Pattern

Agar error handling tidak berulang, buat executor kecil.

```java
public final class RetrofitExecutor {
    private final ErrorBodyParser errorParser;

    public <D, R> RemoteResult<R> execute(
        String operation,
        Call<D> call,
        Function<D, R> mapper
    ) {
        long start = System.nanoTime();
        try {
            Response<D> response = call.execute();

            if (response.isSuccessful()) {
                D body = response.body();
                if (body == null) {
                    return RemoteResult.failure(RemoteFailure.decode("Empty response body"));
                }
                return RemoteResult.success(mapper.apply(body));
            }

            ApiErrorDto apiError = errorParser.parse(response.errorBody());
            return RemoteResult.failure(RemoteFailure.http(
                response.code(),
                apiError.code(),
                apiError.message()
            ));
        } catch (SocketTimeoutException e) {
            return RemoteResult.failure(RemoteFailure.timeout(e));
        } catch (SSLException e) {
            return RemoteResult.failure(RemoteFailure.tls(e));
        } catch (IOException e) {
            return RemoteResult.failure(RemoteFailure.transport(e));
        } catch (RuntimeException e) {
            return RemoteResult.failure(RemoteFailure.decode(e));
        } finally {
            long elapsedMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start);
            recordMetrics(operation, elapsedMs);
        }
    }
}
```

Kelebihan:

- consistent classification;
- consistent metrics;
- body null handling;
- centralized error body parsing;
- adapter tetap ringkas.

Namun jangan masukkan domain-specific business decision terlalu banyak ke executor generic.

---

## 17. Pagination Pattern

Banyak API memakai pagination.

Retrofit method:

```java
@GET("cases")
Call<CasePageDto> searchCases(
    @Query("status") String status,
    @Query("page") int page,
    @Query("size") int size
);
```

Adapter iterator:

```java
public Stream<ExternalCase> streamCasesByStatus(String status) {
    Spliterator<ExternalCase> spliterator = new CasePageSpliterator(status);
    return StreamSupport.stream(spliterator, false);
}
```

Atau lebih sederhana:

```java
public List<ExternalCase> fetchAllOpenCases() {
    List<ExternalCase> result = new ArrayList<>();
    int page = 0;

    while (true) {
        RemoteResult<CasePage> pageResult = fetchPage("OPEN", page, 100);
        CasePage casePage = pageResult.orThrow();

        result.addAll(casePage.items());

        if (!casePage.hasNext()) {
            break;
        }
        page++;
    }

    return result;
}
```

Production concerns:

- max page cap;
- timeout budget per page and total operation;
- retry per page;
- duplicate/missing data if server data changes during scan;
- memory if collecting all pages;
- checkpoint for batch job.

---

## 18. Long-Running Operation Pattern

API sering mengembalikan operation id:

```java
@POST("exports")
Call<ExportStartResponseDto> startExport(@Body ExportRequestDto request);

@GET("exports/{operationId}")
Call<ExportStatusDto> getExportStatus(@Path("operationId") String operationId);

@GET("exports/{operationId}/file")
Call<ResponseBody> downloadExport(@Path("operationId") String operationId);
```

Adapter:

```text
start operation
→ poll status with backoff
→ stop on success/failure/timeout
→ download result
→ classify partial failure
```

Risiko:

- polling terlalu agresif;
- no max wait;
- operation id hilang saat crash;
- duplicate start jika retry POST tanpa idempotency key;
- download besar tanpa streaming.

---

## 19. Dynamic Endpoint dan Multi-Tenant Client

Kadang base URL berbeda per tenant/environment.

Opsi:

### 19.1 Retrofit Per Downstream/Environment

```java
Map<TenantId, UserRemoteApi> clients;
```

Cocok jika tenant sedikit dan stabil.

### 19.2 `@Url` Dynamic

Powerful tetapi riskan SSRF.

### 19.3 OkHttp Interceptor Rewrite Host

Bisa, tetapi bisa membingungkan observability dan security.

Rekomendasi:

- untuk multi-environment: Retrofit instance per environment;
- untuk multi-tenant: client registry dengan validated base URL;
- hindari dynamic arbitrary URL;
- validate host/scheme/port at startup;
- expose operation name dan tenant di metric, tetapi jaga cardinality.

---

## 20. Generated Retrofit Client dari OpenAPI

Retrofit cocok untuk generated client, tetapi generated code jarang langsung production-ready.

Masalah umum generated client:

- DTO terlalu banyak;
- nullability tidak sesuai domain;
- error handling generic;
- raw `Call<T>` bocor;
- no resilience policy;
- no observability;
- generated package masuk domain;
- upgrade spec memecahkan consumer;
- auth injection kurang sesuai internal standard.

Pattern yang lebih aman:

```text
OpenAPI generated Retrofit interface + DTO
    ↓
Generated client module
    ↓
Internal adapter/wrapper
    ↓
Domain port
```

Jangan:

```text
Domain service → generated Retrofit API directly
```

Lebih baik:

```text
Domain service → PaymentPort → PaymentProviderRetrofitAdapter → GeneratedPaymentApi
```

---

## 21. Dependency dan Version Governance

Retrofit umumnya membawa dependency ke OkHttp/Okio/converter.

Governance checklist:

- pin versi Retrofit;
- pin versi OkHttp;
- pastikan converter compatible;
- satu BOM/version alignment jika tersedia;
- scan CVE;
- jangan campur OkHttp major version sembarangan;
- perhatikan Java minimum version;
- cek Android concern jika shared library untuk Android;
- test TLS/cipher behavior saat upgrade OkHttp;
- test converter behavior saat upgrade Jackson/Gson/Moshi.

Contoh Gradle konseptual:

```kotlin
dependencies {
    implementation("com.squareup.retrofit2:retrofit:2.x.x")
    implementation("com.squareup.retrofit2:converter-jackson:2.x.x")
    implementation("com.squareup.okhttp3:okhttp:4.x.x")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.x.x")
}
```

Catatan: sesuaikan versi aktual dengan BOM/standar organisasi.

---

## 22. Retrofit di Java 8 hingga Java 25

### Java 8

- Retrofit usable.
- `Call<T>` sync/async.
- `CompletableFuture` bridge bisa dibuat manual.
- Tidak ada JDK modern `HttpClient`, jadi Retrofit+OkHttp sangat menarik.
- Hati-hati thread pool dan blocking call.

### Java 11

- JDK `HttpClient` tersedia, tetapi Retrofit tetap relevan untuk type-safe interface di atas OkHttp.
- Pilihan menjadi:
  - JDK client manual/wrapper;
  - Retrofit+OkHttp;
  - Spring client layer.

### Java 17

- Baseline LTS umum enterprise.
- Retrofit cocok untuk SDK internal.
- Sealed class/record bisa membantu error/domain wrapper jika source level mengizinkan.

### Java 21

- Virtual threads membuat blocking `execute()` lebih menarik.
- Tetap perlu concurrency limit; virtual threads bukan pengganti downstream protection.
- Retrofit sync wrapper bisa lebih readable untuk fan-out/fan-in, selama bound concurrency jelas.

### Java 25

- Prinsip sama.
- JDK ecosystem makin kuat, tetapi Retrofit tetap berguna untuk interface-driven API clients.
- Pertanyaan desain bukan “mana paling baru”, tapi “mana paling cocok dengan governance, contract, testability, dan operational model”.

---

## 23. Anti-Pattern Retrofit

### 23.1 Membuat Retrofit/OkHttpClient per Request

Buruk:

```java
Retrofit retrofit = new Retrofit.Builder().baseUrl(...).build();
return retrofit.create(Api.class).getUser(id).execute();
```

Dampak:

- pool tidak efektif;
- TLS handshake berulang;
- resource boros;
- konfigurasi tersebar.

### 23.2 Expose `Call<T>` ke Domain

Buruk:

```java
public Call<UserDto> findUser(String id)
```

Dampak:

- domain tahu Retrofit;
- error handling bocor;
- testing domain makin teknis.

### 23.3 Semua Error Jadi Exception Sama

Buruk:

```java
throw new ExternalApiException("failed");
```

Dampak:

- retryability tidak jelas;
- observability miskin;
- user-facing error buruk;
- incident diagnosis sulit.

### 23.4 Logging Full Request/Response Body

Dampak:

- PII leakage;
- token leakage;
- compliance issue;
- log explosion.

### 23.5 `@Url` Tanpa Allowlist

Dampak:

- SSRF;
- data exfiltration;
- metadata endpoint exposure;
- bypass intended base URL.

### 23.6 Retry di Interceptor Tanpa Semantics

Dampak:

- duplicate payment/order/case action;
- retry storm;
- hidden attempt count;
- circuit breaker metric misleading.

### 23.7 DTO Remote Dipakai sebagai Domain Model

Dampak:

- remote API drift merusak domain;
- business invariants lemah;
- migration sulit.

---

## 24. Production-Grade Retrofit Client Blueprint

Struktur module:

```text
external-user-client/
  src/main/java/...
    config/
      UserClientConfig.java
    transport/
      OkHttpClientFactory.java
      RetrofitFactory.java
    api/
      UserRemoteApi.java
    dto/
      UserDto.java
      ApiErrorDto.java
    adapter/
      UserGateway.java
      UserMapper.java
      RetrofitExecutor.java
    resilience/
      UserClientPolicies.java
    observability/
      HttpClientMetrics.java
    security/
      BearerTokenInterceptor.java
      Redaction.java
  src/test/java/...
    UserGatewayTest.java
    UserRemoteApiRequestTest.java
```

Interface:

```java
interface UserRemoteApi {
    @GET("users/{id}")
    Call<UserDto> getUser(@Path("id") String id);
}
```

Port:

```java
interface UserDirectoryPort {
    RemoteResult<User> findUser(UserId id);
}
```

Adapter:

```java
final class UserDirectoryRetrofitAdapter implements UserDirectoryPort {
    private final UserRemoteApi api;
    private final RetrofitExecutor executor;
    private final UserMapper mapper;

    @Override
    public RemoteResult<User> findUser(UserId id) {
        return executor.execute(
            "UserRemoteApi.getUser",
            api.getUser(id.value()),
            mapper::toDomain
        );
    }
}
```

OkHttp config:

```java
OkHttpClient okHttp = new OkHttpClient.Builder()
    .connectTimeout(Duration.ofSeconds(2))
    .readTimeout(Duration.ofSeconds(3))
    .writeTimeout(Duration.ofSeconds(3))
    .callTimeout(Duration.ofSeconds(5))
    .addInterceptor(new CorrelationIdInterceptor())
    .addInterceptor(new BearerTokenInterceptor(tokenProvider))
    .eventListenerFactory(new MetricsEventListenerFactory(metrics))
    .build();
```

Retrofit config:

```java
Retrofit retrofit = new Retrofit.Builder()
    .baseUrl(config.baseUrl())
    .client(okHttp)
    .addConverterFactory(JacksonConverterFactory.create(objectMapper))
    .build();
```

---

## 25. Design Review Checklist

### Contract

- Apakah Retrofit interface hanya merepresentasikan remote API?
- Apakah domain service tidak bergantung langsung pada Retrofit?
- Apakah DTO remote tidak bocor ke domain?
- Apakah base URL konsisten dan tervalidasi?
- Apakah `@Url` dihindari atau dilindungi allowlist?

### Request Construction

- Apakah path parameter divalidasi?
- Apakah query parameter sensitif tidak dipakai untuk secret?
- Apakah header cross-cutting memakai interceptor?
- Apakah content type/accept jelas?
- Apakah multipart upload tidak membuffer file besar tanpa sadar?

### Converter

- Apakah ObjectMapper/converter diset khusus untuk boundary ini?
- Apakah unknown field, enum evolution, date/time, BigDecimal dipikirkan?
- Apakah error body parsing punya fallback aman?

### Execution

- Apakah Retrofit dan OkHttpClient reusable singleton?
- Apakah timeout dikonfigurasi per downstream?
- Apakah concurrency limit/bulkhead ada?
- Apakah retry hanya untuk operasi retryable?
- Apakah circuit breaker mengamati failure yang tepat?

### Error Model

- Apakah transport, timeout, TLS, HTTP status, decode, dan semantic error dibedakan?
- Apakah 204/null body ditangani?
- Apakah error body dibaca terbatas dan tidak bocor ke log?
- Apakah domain mendapatkan result yang jelas?

### Observability

- Apakah metric pakai route/operation name, bukan raw URL?
- Apakah latency/status/failure kind terekam?
- Apakah token/header sensitif diredact?
- Apakah correlation/trace context dipropagate?

### Testing

- Apakah request path/query/header dites dengan MockWebServer?
- Apakah 2xx, 4xx, 5xx, invalid JSON, timeout dites?
- Apakah auth refresh dites?
- Apakah retry attempt count dites?
- Apakah cancellation dites jika async/future dipakai?

---

## 26. Kesimpulan

Retrofit adalah tool yang sangat kuat karena ia mengubah HTTP API menjadi Java interface yang deklaratif dan type-safe. Namun kekuatan itu baru benar-benar bernilai di production jika Retrofit ditempatkan pada layer yang benar.

Ringkasan mental model:

```text
Retrofit bukan domain service.
Retrofit bukan resilience engine.
Retrofit bukan security boundary lengkap.
Retrofit bukan observability strategy.

Retrofit adalah declarative HTTP contract adapter.
OkHttp adalah transport engine.
Adapter/gateway adalah domain boundary.
Policy layer adalah resilience boundary.
Converter adalah serialization boundary.
Executor/wrapper adalah error classification boundary.
```

Engineer biasa memakai Retrofit untuk mengurangi boilerplate.

Engineer kuat memakai Retrofit untuk membuat HTTP client yang:

- jelas kontraknya;
- aman boundary-nya;
- konsisten error model-nya;
- observable;
- testable;
- bisa dikembangkan;
- tidak mencemari domain;
- tahan terhadap API drift;
- sesuai dengan timeout/retry/security governance.

Pada part berikutnya kita akan masuk ke Apache HttpClient 5, yaitu client yang tetap penting di enterprise karena kontrolnya kuat atas connection management, routing, TLS, proxy, classic blocking API, dan async API.

---

## 27. Status Series

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
```

Belum selesai. Part berikutnya:

```text
Part 17 — Apache HttpClient 5 Deep Dive
File: 17-apache-httpclient-5-deep-dive.md
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 15 — OkHttp Deep Dive: Client, Dispatcher, Interceptor, ConnectionPool](./15-okhttp-deep-dive-client-dispatcher-interceptor-connectionpool.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 17 — Apache HttpClient 5 Deep Dive](./17-apache-httpclient-5-deep-dive.md)
