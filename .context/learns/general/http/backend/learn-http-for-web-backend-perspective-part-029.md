# learn-http-for-web-backend-perspective-part-029.md

# Part 029 — Java Backend Implementation: Servlet, Spring MVC, Filters, Interceptors

> Seri: **HTTP for Web/Backend Perspective**  
> Part: **029 dari 032**  
> Status seri: **belum selesai**  
> Fokus: memetakan mental model HTTP production ke implementasi Java synchronous stack: Servlet container, Spring MVC, filter, interceptor, argument resolver, message converter, exception resolver, async servlet, streaming, dan tuning.

---

## 0. Tujuan Part Ini

Sampai Part 028 kita sudah membangun fondasi HTTP dari sisi backend:

- semantics,
- method,
- status code,
- header,
- body,
- URI,
- negotiation,
- validation,
- error,
- idempotency,
- conditional request,
- caching,
- authentication,
- authorization,
- cookie/session/CSRF,
- CORS,
- rate limiting,
- timeout,
- streaming,
- protocol version,
- proxy/gateway,
- API style,
- API evolution,
- observability,
- hardening,
- attack model.

Part ini mengikat semuanya ke implementasi nyata di Java backend, terutama stack **Servlet + Spring MVC**.

Target setelah menyelesaikan bagian ini:

1. Kamu bisa menjelaskan request lifecycle di Java backend dari connector sampai controller.
2. Kamu paham perbedaan Servlet Filter, Spring HandlerInterceptor, controller advice, argument resolver, dan message converter.
3. Kamu tahu di layer mana sebaiknya authentication, authorization, logging, validation, error mapping, dan observability ditempatkan.
4. Kamu bisa menghindari bug umum: body dibaca dua kali, thread starvation, timeout tidak sejajar, response sudah committed, hidden 500, missing trust-boundary, filter ordering salah.
5. Kamu bisa mendesain Spring MVC API yang HTTP-correct, observable, aman, dan scalable dalam batas model thread-per-request.

---

## 1. Mental Model Utama: Spring MVC Bukan HTTP Itu Sendiri

Banyak Java engineer berpikir seperti ini:

```text
HTTP request -> @RestController -> service -> repository -> response
```

Model itu terlalu dangkal.

Model yang lebih akurat:

```text
client
  -> CDN / WAF / reverse proxy / gateway
  -> TCP accept / TLS termination
  -> Servlet container connector
  -> HTTP parser
  -> servlet request/response object
  -> container filter chain
  -> DispatcherServlet
  -> HandlerMapping
  -> HandlerInterceptor.preHandle
  -> HandlerAdapter
  -> argument resolvers
  -> message converters / data binders / validators
  -> controller method
  -> application service
  -> domain / repository / downstreams
  -> return value handlers
  -> message converters
  -> exception resolvers if error
  -> HandlerInterceptor.postHandle / afterCompletion
  -> filter response path
  -> container writes response bytes
  -> proxy/gateway/client
```

Spring MVC is a framework built on top of the Servlet stack. The Servlet container owns low-level connection handling, request/response objects, filter chain, servlet dispatch, async dispatch, and response commit behavior. Spring MVC owns handler mapping, controller invocation, argument binding, message conversion, validation integration, exception resolution, and return value handling.

Top-tier backend engineer tidak mencampur semua concern di controller. Mereka tahu **di mana sebuah concern seharusnya hidup**.

---

## 2. Servlet Stack: What It Actually Gives You

Servlet stack memberikan abstraction utama:

| Abstraction | Fungsi |
|---|---|
| `ServletRequest` / `HttpServletRequest` | representasi request dari container ke aplikasi |
| `ServletResponse` / `HttpServletResponse` | response mutable sebelum committed |
| `Servlet` | component yang memproses request |
| `Filter` | wrapper sebelum/sesudah resource |
| `FilterChain` | rantai filter menuju resource akhir |
| `ServletContext` | context aplikasi web |
| `AsyncContext` | async servlet processing |
| `ServletInputStream` | stream body request |
| `ServletOutputStream` | stream body response |

Dalam Spring MVC, `DispatcherServlet` adalah servlet utama yang menerima request dan mendistribusikannya ke controller.

Penting: `HttpServletRequest` dan `HttpServletResponse` bukan domain object. Keduanya adalah **container-facing mutable boundary objects**. Jangan bocorkan ke domain/application layer kecuali sangat terpaksa.

---

## 3. Servlet Container: Tomcat, Jetty, Undertow

Spring Boot biasanya menjalankan embedded container:

- Tomcat,
- Jetty,
- Undertow.

Container bertanggung jawab untuk:

1. listen port,
2. accept connection,
3. parse HTTP request,
4. manage connection keep-alive,
5. enforce sebagian limit,
6. allocate request processing thread,
7. invoke filter chain,
8. invoke servlet,
9. handle async dispatch,
10. write response bytes.

### 3.1 Connector sebagai pintu masuk

Di Tomcat, HTTP Connector mendengarkan port tertentu dan meneruskan request ke engine untuk diproses. Parameter seperti `maxThreads`, `maxConnections`, `acceptCount`, `connectionTimeout`, `keepAliveTimeout`, dan limit ukuran header/body memengaruhi survival aplikasi saat traffic tinggi.

Mental model:

```text
connection accepted != request processed != controller invoked != response completed
```

Sebuah server bisa:

- menerima koneksi tetapi belum punya thread,
- punya thread tetapi blocked di DB,
- selesai domain logic tetapi response belum terkirim karena client lambat,
- sudah commit response tetapi gagal menulis body lengkap.

---

## 4. Thread-per-Request Model

Spring MVC tradisional menggunakan model yang secara mental bisa dipahami sebagai:

```text
1 request aktif -> 1 container worker thread selama request synchronous berjalan
```

Tidak selalu literal untuk semua fase dan semua container, tetapi cukup akurat untuk reasoning production.

### 4.1 Konsekuensi

Jika controller melakukan operasi blocking:

- query database,
- call HTTP downstream,
- call Redis,
- wait lock,
- generate PDF,
- upload ke object storage,
- synchronous file scan,

maka worker thread tertahan.

Jika semua worker thread tertahan, server tidak bisa memproses request baru walaupun CPU masih rendah.

### 4.2 Gejala thread starvation

Gejala umum:

- latency naik tajam,
- request queue meningkat,
- throughput turun,
- CPU tidak penuh,
- DB/downstream lambat,
- 503/504 muncul dari gateway,
- health check ikut lambat,
- retry dari client memperparah beban.

Top-tier diagnosis:

```text
Apakah server lambat karena CPU saturated, thread pool exhausted, connection pool exhausted, DB saturated, downstream timeout, lock contention, GC, atau proxy queue?
```

Jangan langsung menaikkan `maxThreads`. Itu sering hanya memperbesar tekanan ke DB/downstream.

---

## 5. Request Lifecycle Detail di Spring MVC

### 5.1 Incoming request

Request masuk ke container:

```text
TCP connection -> HTTP parser -> HttpServletRequest/Response
```

Container mungkin sudah menolak request sebelum Spring melihatnya jika:

- header terlalu besar,
- request line invalid,
- body framing invalid,
- TLS handshake gagal,
- connection timeout,
- method tidak didukung container/proxy,
- request smuggling terdeteksi oleh proxy.

Artinya: tidak semua request error muncul di application logs. Sebagian muncul di access logs, proxy logs, container logs, atau bahkan tidak sampai ke app.

### 5.2 Filter chain

Filter dijalankan sebelum resource akhir. Dalam Spring Boot, filter dapat berasal dari:

- Servlet container,
- Spring Boot auto-configuration,
- Spring Security,
- observability instrumentation,
- custom application filters.

Contoh concern filter:

- request ID,
- trace propagation,
- security filter chain,
- CORS,
- CSRF,
- forwarded header handling,
- request/response logging,
- compression,
- rate limiting,
- tenant extraction,
- body wrapping,
- method override.

### 5.3 DispatcherServlet

`DispatcherServlet` adalah front controller Spring MVC. Ia tidak “menjalankan controller langsung”; ia mendelegasikan ke strategy components.

Pipeline konseptual:

```text
DispatcherServlet
  -> HandlerMapping: request cocok ke handler mana?
  -> HandlerExecutionChain: handler + interceptors
  -> HandlerAdapter: bagaimana memanggil handler ini?
  -> argument resolution
  -> type conversion / data binding / validation
  -> controller invocation
  -> return value handling
  -> message conversion / view resolution
  -> exception resolution if needed
```

### 5.4 HandlerMapping

`HandlerMapping` menentukan handler berdasarkan:

- path,
- HTTP method,
- parameters,
- headers,
- consumes,
- produces,
- custom condition.

Contoh:

```java
@RestController
@RequestMapping("/api/cases")
class CaseController {

    @GetMapping(value = "/{caseId}", produces = "application/json")
    CaseResponse getCase(@PathVariable UUID caseId) {
        // ...
    }

    @PostMapping(consumes = "application/json", produces = "application/json")
    ResponseEntity<CaseResponse> createCase(@Valid @RequestBody CreateCaseRequest request) {
        // ...
    }
}
```

Routing bukan sekadar string matching. Routing adalah bagian dari HTTP contract:

- method mismatch seharusnya `405`,
- media type mismatch seharusnya `415`,
- unacceptable response type seharusnya `406`,
- malformed path variable seharusnya `400`,
- unauthorized access bukan routing miss.

---

## 6. Filter vs Interceptor vs Controller Advice vs AOP

Ini salah satu area paling sering rancu.

| Mechanism | Layer | Melihat apa? | Cocok untuk | Kurang cocok untuk |
|---|---|---|---|---|
| Servlet Filter | Servlet/container boundary | raw-ish request/response | security chain, CORS, request ID, forwarded headers, low-level logging | domain-specific authorization detail |
| Spring HandlerInterceptor | Spring MVC handler boundary | matched handler, model | handler-level pre/post concern, tenant context, lightweight access checks | body transformation, exception taxonomy utama |
| Controller Advice | MVC exception/binding boundary | exceptions, binding errors | error response mapping, global validation handling | request pre-processing umum |
| Argument Resolver | controller parameter binding | method parameter | authenticated principal, tenant id, request context object | business logic |
| Message Converter | body serialization | body stream + Java type | JSON/XML/CSV conversion | domain validation |
| AOP | bean method boundary | Spring method invocation | cross-cutting application service concerns | raw HTTP concerns |

### 6.1 Rule of thumb

- Concern butuh raw request sebelum Spring? **Filter**.
- Concern butuh tahu controller/handler yang matched? **Interceptor**.
- Concern mengubah exception menjadi HTTP response? **ControllerAdvice**.
- Concern menyediakan parameter controller custom? **ArgumentResolver**.
- Concern membaca/menulis representation body? **HttpMessageConverter**.
- Concern domain/application cross-cutting? **AOP atau service decorator**, bukan HTTP layer.

---

## 7. Servlet Filter Deep Dive

Filter adalah component yang dapat menjalankan logic sebelum dan sesudah resource.

Bentuk dasar:

```java
@Component
public class RequestIdFilter extends OncePerRequestFilter {

    public static final String REQUEST_ID_HEADER = "X-Request-ID";

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain
    ) throws ServletException, IOException {

        String requestId = request.getHeader(REQUEST_ID_HEADER);
        if (requestId == null || requestId.isBlank()) {
            requestId = UUID.randomUUID().toString();
        }

        try {
            MDC.put("requestId", requestId);
            response.setHeader(REQUEST_ID_HEADER, requestId);
            filterChain.doFilter(request, response);
        } finally {
            MDC.remove("requestId");
        }
    }
}
```

### 7.1 Filter ordering

Filter order matters.

Contoh urutan konseptual:

```text
ForwardedHeaderFilter
  -> request id / trace filter
  -> security filter chain
  -> CORS/CSRF depending configuration
  -> rate limit filter
  -> request logging filter
  -> DispatcherServlet
```

Urutan salah bisa menyebabkan:

- log tidak punya user/tenant,
- security membaca wrong scheme/client IP,
- CORS preflight ditolak authentication,
- response header security hilang,
- body wrapper mengganggu multipart,
- exception tidak terformat problem details.

### 7.2 Jangan baca request body sembarangan di filter

Request body adalah stream. Jika filter membacanya, controller bisa gagal membaca body.

Anti-pattern:

```java
String body = request.getReader().lines().collect(Collectors.joining());
filterChain.doFilter(request, response); // controller may see empty body
```

Jika perlu logging body, gunakan wrapper dengan batas ukuran, redaction, dan sampling. Bahkan itu pun harus hati-hati untuk multipart, streaming, large body, dan sensitive data.

### 7.3 Filter and response commit

Setelah response committed, kamu tidak bisa bebas mengubah:

- status,
- header,
- body format.

Jika filter mencoba mengubah response setelah downstream menulis body, hasilnya bisa gagal atau tidak konsisten.

---

## 8. Spring Security Filter Chain

Spring Security berjalan sebagai filter chain. Ini penting karena banyak engineer mengira security terjadi “di controller annotation saja”.

Security concern bisa terjadi di beberapa level:

1. authentication extraction,
2. token validation,
3. session lookup,
4. CSRF validation,
5. CORS interaction,
6. request authorization,
7. method-level authorization,
8. exception translation,
9. security headers,
10. logout/session invalidation.

Contoh configuration modern:

```java
@Configuration
@EnableWebSecurity
class SecurityConfiguration {

    @Bean
    SecurityFilterChain apiSecurity(HttpSecurity http) throws Exception {
        return http
                .csrf(csrf -> csrf.disable()) // only if truly stateless non-browser API
                .cors(Customizer.withDefaults())
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers(HttpMethod.GET, "/api/public/**").permitAll()
                        .requestMatchers("/actuator/health").permitAll()
                        .requestMatchers("/api/**").authenticated()
                        .anyRequest().denyAll()
                )
                .oauth2ResourceServer(oauth2 -> oauth2.jwt(Customizer.withDefaults()))
                .build();
    }
}
```

Production note:

- Jangan disable CSRF untuk cookie-auth browser app tanpa threat model.
- Jangan permit all karena CORS sudah dibatasi.
- Jangan gunakan role check sebagai pengganti object-level authorization.
- Jangan percaya forwarded headers sebelum trust boundary dibereskan.

---

## 9. HandlerInterceptor Deep Dive

Interceptor berjalan setelah handler dipilih oleh Spring MVC.

Contoh:

```java
@Component
class TenantInterceptor implements HandlerInterceptor {

    @Override
    public boolean preHandle(
            HttpServletRequest request,
            HttpServletResponse response,
            Object handler
    ) {
        String tenantId = request.getHeader("X-Tenant-ID");
        TenantContext.set(tenantId);
        return true;
    }

    @Override
    public void afterCompletion(
            HttpServletRequest request,
            HttpServletResponse response,
            Object handler,
            Exception ex
    ) {
        TenantContext.clear();
    }
}
```

Registration:

```java
@Configuration
class WebConfiguration implements WebMvcConfigurer {

    private final TenantInterceptor tenantInterceptor;

    WebConfiguration(TenantInterceptor tenantInterceptor) {
        this.tenantInterceptor = tenantInterceptor;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(tenantInterceptor)
                .addPathPatterns("/api/**");
    }
}
```

### 9.1 Cocok untuk apa?

Interceptor cocok untuk:

- handler-aware logging,
- tenant context after route match,
- request timing,
- lightweight guard,
- adding common model attributes in MVC web apps,
- feature flag route guard.

Kurang cocok untuk:

- raw body handling,
- authentication token parsing,
- low-level security boundary,
- response body transformation,
- large payload inspection.

### 9.2 `postHandle` vs `afterCompletion`

- `postHandle`: setelah handler selesai, sebelum view rendering; tidak selalu cocok untuk REST body handling.
- `afterCompletion`: setelah request selesai; cocok untuk cleanup.

Untuk context cleanup, gunakan `afterCompletion`, bukan `postHandle`.

---

## 10. Controller Design as HTTP Adapter

Controller sebaiknya menjadi adapter HTTP, bukan tempat business logic.

Buruk:

```java
@PostMapping("/cases/{id}/approve")
public ResponseEntity<?> approve(@PathVariable String id, @RequestBody Map<String, Object> body) {
    // parse manually
    // check auth manually
    // load entity
    // mutate state
    // send email
    // write audit
    // catch every exception
    // return random map
}
```

Lebih baik:

```java
@RestController
@RequestMapping("/api/cases")
class CaseDecisionController {

    private final ApproveCaseUseCase approveCase;

    @PostMapping(
            value = "/{caseId}/approval-decisions",
            consumes = "application/json",
            produces = "application/json"
    )
    ResponseEntity<ApprovalDecisionResponse> approve(
            @PathVariable UUID caseId,
            @Valid @RequestBody ApproveCaseRequest request,
            AuthenticatedUser user,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey
    ) {
        ApprovalDecision result = approveCase.handle(new ApproveCaseCommand(
                caseId,
                request.reason(),
                user.userId(),
                idempotencyKey
        ));

        URI location = URI.create("/api/cases/%s/approval-decisions/%s"
                .formatted(caseId, result.decisionId()));

        return ResponseEntity.created(location)
                .eTag('"' + result.version() + '"')
                .body(ApprovalDecisionResponse.from(result));
    }
}
```

Controller responsibilities:

1. map HTTP input to command/query,
2. enforce syntactic request contract,
3. delegate to application use case,
4. map result to HTTP response,
5. expose headers/status correctly,
6. avoid leaking internals.

Controller should not own:

- transaction policy detail,
- domain invariant,
- authorization rules beyond adapter-level coarse checks,
- audit persistence,
- downstream orchestration details,
- retry/idempotency storage logic.

---

## 11. Argument Resolvers

Spring MVC can resolve controller method parameters.

Built-in examples:

- `@PathVariable`,
- `@RequestParam`,
- `@RequestHeader`,
- `@CookieValue`,
- `@RequestBody`,
- `Principal`,
- `HttpServletRequest`,
- `Locale`,
- `Pageable` if Spring Data integration.

Custom resolver is useful when you want clean controller signatures.

Example:

```java
public record AuthenticatedUser(UUID userId, String tenantId, Set<String> scopes) {}
```

```java
@Component
class AuthenticatedUserArgumentResolver implements HandlerMethodArgumentResolver {

    @Override
    public boolean supportsParameter(MethodParameter parameter) {
        return parameter.getParameterType().equals(AuthenticatedUser.class);
    }

    @Override
    public Object resolveArgument(
            MethodParameter parameter,
            ModelAndViewContainer mavContainer,
            NativeWebRequest webRequest,
            WebDataBinderFactory binderFactory
    ) {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        return AuthenticatedUserMapper.from(authentication);
    }
}
```

Registration:

```java
@Configuration
class MvcConfig implements WebMvcConfigurer {

    private final AuthenticatedUserArgumentResolver resolver;

    MvcConfig(AuthenticatedUserArgumentResolver resolver) {
        this.resolver = resolver;
    }

    @Override
    public void addArgumentResolvers(List<HandlerMethodArgumentResolver> resolvers) {
        resolvers.add(resolver);
    }
}
```

Benefits:

- controller tidak tergantung langsung pada `SecurityContextHolder`,
- test lebih bersih,
- principal mapping konsisten,
- HTTP/security boundary tetap eksplisit.

Risk:

- jangan menyembunyikan authorization rule kompleks di argument resolver,
- jangan membuat resolver melakukan DB query berat tanpa timeout/caching,
- jangan mengubah domain state.

---

## 12. HttpMessageConverter

`HttpMessageConverter` membaca request body menjadi Java object dan menulis Java object menjadi response body.

Contoh converter umum:

- JSON via Jackson,
- XML,
- String,
- byte array,
- resource/file,
- form data,
- multipart.

Pipeline:

```text
Content-Type + target Java type -> select converter -> deserialize request
Return type + Accept/produces -> select converter -> serialize response
```

### 12.1 `Content-Type` and `Accept`

Example:

```java
@PostMapping(
        value = "/reports",
        consumes = "application/json",
        produces = "application/json"
)
ReportResponse create(@Valid @RequestBody CreateReportRequest request) {
    return service.create(request);
}
```

If client sends:

```http
Content-Type: text/plain
```

server should reject with `415 Unsupported Media Type`.

If client sends:

```http
Accept: application/xml
```

but endpoint only produces JSON, server may respond `406 Not Acceptable` depending configuration.

### 12.2 Jackson configuration is API contract

Jackson settings are not implementation trivia. They affect external API behavior.

Important decisions:

- unknown fields accepted or rejected?
- null included or omitted?
- enum serialization string or object?
- date/time format?
- numeric precision?
- property naming strategy?
- polymorphic typing disabled?
- fail on invalid subtype?

Safer baseline for APIs:

```java
@Configuration
class JacksonConfig {

    @Bean
    Jackson2ObjectMapperBuilderCustomizer apiJacksonCustomizer() {
        return builder -> builder
                .featuresToDisable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
                .featuresToEnable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);
    }
}
```

But compatibility trade-off matters. Rejecting unknown fields catches client bugs and mass-assignment attempts, but can make forward compatibility harder. Choose deliberately.

---

## 13. Data Binding and Validation

Spring MVC binds:

- path variables,
- query parameters,
- headers,
- form fields,
- request body.

Validation examples:

```java
public record CreateCaseRequest(
        @NotBlank
        @Size(max = 200)
        String title,

        @NotNull
        CaseType type,

        @Valid
        List<EvidenceReferenceRequest> evidence
) {}
```

```java
@PostMapping("/api/cases")
ResponseEntity<CaseResponse> create(@Valid @RequestBody CreateCaseRequest request) {
    // ...
}
```

### 13.1 Validation layers

Do not put all validation in annotations.

| Layer | Example |
|---|---|
| Parser | invalid JSON, invalid UUID |
| Structural validation | required title, max length |
| Semantic validation | start date <= end date |
| Authorization-sensitive validation | user may assign only within tenant |
| Domain invariant | closed case cannot be reopened except by appeal process |
| Persistence constraint | unique case number |

Bean Validation is good for structural validation, not the entire domain model.

---

## 14. Exception Handling with `@ControllerAdvice`

A mature backend has explicit exception taxonomy.

Example Problem Details style:

```java
@RestControllerAdvice
class ApiExceptionHandler {

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<ProblemDetail> validationError(MethodArgumentNotValidException ex) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setTitle("Request validation failed");
        problem.setDetail("One or more fields are invalid.");
        problem.setProperty("errors", ex.getBindingResult().getFieldErrors().stream()
                .map(error -> Map.of(
                        "field", error.getField(),
                        "code", error.getCode(),
                        "message", error.getDefaultMessage()
                ))
                .toList());
        return ResponseEntity.badRequest().body(problem);
    }

    @ExceptionHandler(ResourceNotFoundException.class)
    ResponseEntity<ProblemDetail> notFound(ResourceNotFoundException ex) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.NOT_FOUND);
        problem.setTitle("Resource not found");
        problem.setDetail(ex.safeMessage());
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(problem);
    }

    @ExceptionHandler(OptimisticConflictException.class)
    ResponseEntity<ProblemDetail> conflict(OptimisticConflictException ex) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setTitle("Resource conflict");
        problem.setDetail("The resource state changed before this operation could complete.");
        return ResponseEntity.status(HttpStatus.CONFLICT).body(problem);
    }
}
```

### 14.1 Do not catch everything in controller

Bad:

```java
try {
   ...
} catch (Exception e) {
   return ResponseEntity.ok(Map.of("success", false, "message", e.getMessage()));
}
```

Why bad:

- turns failures into `200`,
- leaks internal message,
- breaks client retry behavior,
- hides incidents from metrics,
- duplicates error mapping,
- destroys observability.

Better:

- throw typed exception,
- map centrally,
- include correlation ID,
- log internally with full cause,
- return safe Problem Details externally.

---

## 15. Return Value Handling

Spring MVC can handle many return types:

- plain object,
- `ResponseEntity<T>`,
- `ProblemDetail`,
- `void`,
- `Callable<T>`,
- `DeferredResult<T>`,
- `StreamingResponseBody`,
- `SseEmitter`,
- `ResponseBodyEmitter`,
- `Resource`,
- `ModelAndView`.

For HTTP APIs, prefer `ResponseEntity<T>` when you need explicit:

- status,
- headers,
- ETag,
- Location,
- Cache-Control,
- Retry-After,
- content disposition.

Example:

```java
@GetMapping("/api/cases/{caseId}")
ResponseEntity<CaseResponse> get(
        @PathVariable UUID caseId,
        @RequestHeader(value = "If-None-Match", required = false) String ifNoneMatch
) {
    CaseView view = service.get(caseId);
    String etag = '"' + view.version() + '"';

    if (etag.equals(ifNoneMatch)) {
        return ResponseEntity.status(HttpStatus.NOT_MODIFIED)
                .eTag(etag)
                .cacheControl(CacheControl.noCache())
                .build();
    }

    return ResponseEntity.ok()
            .eTag(etag)
            .cacheControl(CacheControl.noCache())
            .body(CaseResponse.from(view));
}
```

---

## 16. Response Commit Semantics

HTTP response is mutable only until committed.

Response can be committed when:

- status/header buffer flushed,
- body starts writing beyond buffer,
- streaming response writes,
- redirect sent,
- error sent,
- container flushes.

After commit:

- cannot change status reliably,
- cannot add critical headers reliably,
- cannot switch to Problem Details body,
- cannot recover with clean JSON error.

### 16.1 Streaming implication

For streaming download:

```java
@GetMapping("/api/files/{id}/content")
ResponseEntity<StreamingResponseBody> download(@PathVariable UUID id) {
    FileDescriptor file = service.authorizeAndOpen(id);

    StreamingResponseBody body = outputStream -> {
        try (InputStream input = file.openStream()) {
            input.transferTo(outputStream);
        }
    };

    return ResponseEntity.ok()
            .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"evidence.pdf\"")
            .contentType(MediaType.APPLICATION_PDF)
            .body(body);
}
```

If error occurs after body starts, you usually cannot return JSON error. You need:

- validate before streaming,
- open resource before commit if possible,
- log stream failure,
- rely on client detecting incomplete body,
- use checksums for integrity-sensitive downloads.

---

## 17. Async Servlet and Spring MVC Async

Spring MVC supports async request processing through Servlet async.

Common return types:

- `Callable<T>`,
- `DeferredResult<T>`,
- `WebAsyncTask<T>`,
- `StreamingResponseBody`,
- `SseEmitter`,
- `ResponseBodyEmitter`.

### 17.1 What async does and does not do

Async can release the container request thread while work continues elsewhere.

But async does not magically make blocking work cheap. It just moves work to another executor if you configure it that way.

Bad async:

```text
container thread freed -> application executor saturated -> DB still saturated -> timeout still broken
```

Good async:

- long polling,
- waiting for event from broker,
- streaming/SSE,
- slow external callback completion,
- decoupling request thread from delayed result,
- async job status response.

### 17.2 Configure async executor

Do not rely blindly on defaults.

```java
@Configuration
class AsyncMvcConfig implements WebMvcConfigurer {

    @Override
    public void configureAsyncSupport(AsyncSupportConfigurer configurer) {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setThreadNamePrefix("mvc-async-");
        executor.setCorePoolSize(20);
        executor.setMaxPoolSize(100);
        executor.setQueueCapacity(200);
        executor.initialize();

        configurer.setTaskExecutor(executor);
        configurer.setDefaultTimeout(Duration.ofSeconds(30).toMillis());
    }
}
```

Production warning: queue capacity is not harmless. Large queues increase latency and hide saturation until it is too late.

---

## 18. Servlet MVC vs WebFlux Boundary

This part focuses on Servlet/Spring MVC. But you need to know the boundary.

Spring MVC:

- familiar imperative programming model,
- thread-per-request mental model,
- excellent for blocking JDBC/JPA workloads,
- easier debugging,
- integrates naturally with classic Java ecosystem.

WebFlux:

- non-blocking event loop model,
- useful for high concurrency I/O workloads,
- requires reactive discipline,
- blocking calls can damage event loops,
- different backpressure and context propagation model.

Do not migrate to WebFlux just because endpoint is slow. If slowness is DB lock, bad query, missing index, downstream latency, or no timeout, WebFlux will not fix the root cause.

---

## 19. Request Context and ThreadLocal

Spring MVC often uses thread-local context:

- MDC,
- SecurityContext,
- LocaleContext,
- RequestContextHolder,
- transaction context.

This works because synchronous request processing stays on one thread most of the time.

But async changes the story. If work moves to another executor, context may not propagate automatically.

Risks:

- missing trace ID in async log,
- missing security context,
- tenant context leak,
- MDC leak across reused thread,
- wrong audit actor.

Rule:

```text
Set context at boundary, clear it in finally/afterCompletion, propagate explicitly for async work.
```

---

## 20. HTTP Client Calls Inside MVC Request

A common Spring MVC endpoint calls downstream services.

Bad pattern:

```java
String response = restTemplate.getForObject(url, String.class); // no explicit timeout, unclear retry
```

Better mental model:

```text
incoming request deadline
  -> service use case budget
  -> DB budget
  -> downstream HTTP budget
  -> response write budget
```

For synchronous clients, configure:

- connection timeout,
- read/response timeout,
- connection pool size,
- max per route,
- retry only for idempotent operations,
- circuit breaker,
- trace propagation,
- auth propagation,
- error mapping.

Spring has modern synchronous client options such as `RestClient`, and reactive `WebClient` can also be used but must be integrated carefully. Do not call `.block()` everywhere without understanding pool/thread consequences.

---

## 21. Transactions and HTTP Boundary

Do not keep database transactions open across slow HTTP operations.

Bad:

```text
begin transaction
  -> update DB
  -> call downstream HTTP service
  -> wait 5 seconds
  -> send email
commit
```

Problems:

- locks held too long,
- DB connection held too long,
- retry ambiguity,
- partial side effects,
- increased deadlock risk,
- throughput collapse.

Better:

```text
validate command
begin transaction
  -> mutate local aggregate
  -> write outbox event
commit
async publisher sends downstream side effect
```

HTTP controller should not define transaction architecture. It should call a use case with clear command semantics.

---

## 22. Mapping HTTP Correctness to Spring MVC

### 22.1 Method semantics

```java
@GetMapping("/cases/{id}")       // retrieval
@PostMapping("/cases")          // create/process
@PutMapping("/cases/{id}")      // full replacement if supported
@PatchMapping("/cases/{id}")    // partial update
@DeleteMapping("/cases/{id}")   // delete/cancel semantics
```

Do not use GET for mutation.

### 22.2 Status codes

```java
return ResponseEntity.created(location).body(body); // 201
return ResponseEntity.accepted().body(job);         // 202
return ResponseEntity.noContent().build();          // 204
return ResponseEntity.status(CONFLICT).body(problem); // 409
```

### 22.3 Headers

```java
return ResponseEntity.ok()
        .eTag(etag)
        .lastModified(lastModified)
        .cacheControl(CacheControl.noCache())
        .header("X-Request-ID", requestId)
        .body(response);
```

### 22.4 Conditional requests

```java
@PutMapping("/cases/{id}")
ResponseEntity<CaseResponse> replace(
        @PathVariable UUID id,
        @RequestHeader("If-Match") String ifMatch,
        @Valid @RequestBody ReplaceCaseRequest request
) {
    CaseResult result = service.replace(id, parseVersion(ifMatch), request);
    return ResponseEntity.ok()
            .eTag('"' + result.version() + '"')
            .body(CaseResponse.from(result));
}
```

Missing `If-Match` for sensitive update can be mapped to `428 Precondition Required`.

### 22.5 Idempotency

```java
@PostMapping("/payments")
ResponseEntity<PaymentResponse> createPayment(
        @RequestHeader("Idempotency-Key") String idempotencyKey,
        @Valid @RequestBody CreatePaymentRequest request
) {
    PaymentResult result = service.create(idempotencyKey, request);
    return ResponseEntity.status(result.created() ? CREATED : OK)
            .body(PaymentResponse.from(result));
}
```

Idempotency logic belongs in application/infrastructure service, not controller alone.

---

## 23. Multipart in Spring MVC

Example:

```java
@PostMapping(value = "/api/cases/{caseId}/evidence", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
ResponseEntity<EvidenceUploadResponse> upload(
        @PathVariable UUID caseId,
        @RequestPart("metadata") @Valid EvidenceMetadataRequest metadata,
        @RequestPart("file") MultipartFile file,
        AuthenticatedUser user
) {
    EvidenceUploadResult result = service.upload(caseId, metadata, file, user);
    return ResponseEntity.created(URI.create("/api/evidence/" + result.evidenceId()))
            .body(EvidenceUploadResponse.from(result));
}
```

Production requirements:

- size limit,
- type validation,
- filename sanitization,
- virus/malware scanning,
- temporary file cleanup,
- object storage offload,
- authorization before persistence,
- audit log,
- checksum,
- timeout,
- avoid loading entire file into memory.

---

## 24. Observability in Spring MVC

Minimum signals:

- method,
- route template, not raw path,
- status,
- duration,
- request size,
- response size,
- exception class,
- request ID,
- trace ID,
- authenticated principal type,
- tenant ID where safe,
- upstream/downstream attribution.

Avoid high-cardinality labels:

Bad metric label:

```text
uri=/api/cases/550e8400-e29b-41d4-a716-446655440000
```

Better:

```text
route=/api/cases/{caseId}
```

Access logs should not contain:

- bearer token,
- cookie,
- password,
- full request body,
- personal data unless explicitly governed.

---

## 25. Health Checks and Actuator Endpoints

Health checks must be cheap and meaningful.

Types:

| Endpoint | Purpose |
|---|---|
| liveness | should process be restarted? |
| readiness | should receive traffic? |
| startup | has app initialized? |

Anti-pattern:

- liveness depends on DB,
- readiness always returns OK,
- health endpoint requires external auth not available to load balancer,
- health check does expensive downstream calls,
- health endpoint shares same overloaded path as normal app requests without protection.

In Spring Boot, Actuator can expose health and metrics endpoints, but production exposure must be controlled.

---

## 26. Container and Server Tuning Mental Model

Important knobs vary by container, but conceptually:

| Knob | Meaning | Failure if wrong |
|---|---|---|
| max threads | request worker capacity | starvation or overload amplification |
| accept queue | pending connections backlog | connection refused/timeouts |
| max connections | concurrent connections | memory/thread pressure |
| keep-alive timeout | idle connection retention | connection churn or resource hoarding |
| header size limit | max header bytes | reject large headers or allow abuse |
| body size limit | max request payload | memory/disk abuse |
| async timeout | async response bound | leaked requests |
| connection timeout | slow client defense | slowloris risk or false cutoff |

Tuning requires matching:

```text
gateway timeout
  >= app request timeout?
  >= downstream timeout?
  >= DB timeout?
```

Actually, the correct relationship is usually:

```text
client/gateway deadline > app deadline > downstream deadline > DB/query timeout
```

So inner operations fail first and the app can return controlled errors before outer layers return generic 504.

---

## 27. Common Production Failure Modes

### 27.1 Body read twice

Cause:

- logging filter reads body,
- security filter reads body,
- controller expects `@RequestBody`.

Symptom:

- empty body,
- JSON parse error,
- intermittent behavior with wrappers.

Fix:

- avoid body logging,
- use bounded caching wrapper,
- sample/redact,
- exclude multipart/large/streaming endpoints.

### 27.2 CORS preflight blocked by authentication

Cause:

- security chain requires authentication for `OPTIONS` preflight.

Symptom:

- browser says CORS error,
- server logs 401/403 for OPTIONS.

Fix:

- configure CORS at correct layer,
- allow valid preflight processing,
- do not confuse CORS with authorization.

### 27.3 Response committed before error mapping

Cause:

- streaming starts,
- later exception thrown.

Symptom:

- broken download,
- partial JSON,
- client connection reset,
- no Problem Details body.

Fix:

- validate early,
- stage before streaming,
- use async job for risky generation,
- log and expose integrity metadata.

### 27.4 Thread pool exhausted by slow downstream

Cause:

- no downstream timeout,
- high retry,
- blocking calls inside request thread.

Symptom:

- latency spike,
- 504 gateway timeout,
- low CPU,
- many threads waiting.

Fix:

- timeout budgets,
- circuit breaker,
- bulkhead,
- async job for long operations,
- reduce retry amplification.

### 27.5 Authorization hidden in controller only

Cause:

- endpoint checks role but service/repository can load any object.

Symptom:

- BOLA/IDOR vulnerability,
- tenant data leak.

Fix:

- resource-level authorization in use case/query layer,
- tenant-scoped queries,
- object-level tests.

### 27.6 Wrong client IP

Cause:

- app trusts `X-Forwarded-For` from public client.

Symptom:

- rate limit bypass,
- bad audit log,
- wrong geo/security decision.

Fix:

- strip/set forwarded headers at trusted edge,
- configure forwarded header filter only behind trusted proxy,
- use allowlisted proxy chain.

---

## 28. Example Production-Grade Spring MVC Endpoint

Scenario: update regulatory case summary with optimistic concurrency.

```java
@RestController
@RequestMapping("/api/cases")
class CaseSummaryController {

    private final UpdateCaseSummaryUseCase updateCaseSummary;

    CaseSummaryController(UpdateCaseSummaryUseCase updateCaseSummary) {
        this.updateCaseSummary = updateCaseSummary;
    }

    @PatchMapping(
            value = "/{caseId}/summary",
            consumes = "application/json",
            produces = "application/json"
    )
    ResponseEntity<CaseSummaryResponse> updateSummary(
            @PathVariable UUID caseId,
            @RequestHeader(HttpHeaders.IF_MATCH) String ifMatch,
            @Valid @RequestBody UpdateCaseSummaryRequest request,
            AuthenticatedUser user
    ) {
        long expectedVersion = ETags.parseStrongVersion(ifMatch);

        UpdateCaseSummaryResult result = updateCaseSummary.handle(new UpdateCaseSummaryCommand(
                caseId,
                expectedVersion,
                request.summary(),
                user.userId(),
                user.tenantId()
        ));

        return ResponseEntity.ok()
                .eTag(ETags.strong(result.newVersion()))
                .cacheControl(CacheControl.noCache())
                .body(CaseSummaryResponse.from(result));
    }
}
```

DTO:

```java
public record UpdateCaseSummaryRequest(
        @NotBlank
        @Size(max = 10_000)
        String summary
) {}
```

Use case:

```java
@Service
class UpdateCaseSummaryUseCase {

    private final CaseRepository caseRepository;
    private final AuthorizationService authorization;
    private final AuditLog auditLog;

    @Transactional
    UpdateCaseSummaryResult handle(UpdateCaseSummaryCommand command) {
        CaseRecord record = caseRepository.findByIdAndTenant(command.caseId(), command.tenantId())
                .orElseThrow(ResourceNotFoundException::new);

        authorization.assertCanEditSummary(command.userId(), record);

        record.updateSummary(command.summary(), command.expectedVersion());

        auditLog.recordCaseSummaryUpdated(record.id(), command.userId(), record.version());

        return new UpdateCaseSummaryResult(record.id(), record.version(), record.summary());
    }
}
```

Exception mapping:

```java
@ExceptionHandler(PreconditionRequiredException.class)
ResponseEntity<ProblemDetail> preconditionRequired(PreconditionRequiredException ex) {
    ProblemDetail problem = ProblemDetail.forStatus(428);
    problem.setTitle("Precondition required");
    problem.setDetail("This operation requires If-Match with the current resource ETag.");
    return ResponseEntity.status(428).body(problem);
}

@ExceptionHandler(VersionMismatchException.class)
ResponseEntity<ProblemDetail> preconditionFailed(VersionMismatchException ex) {
    ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.PRECONDITION_FAILED);
    problem.setTitle("Resource version mismatch");
    problem.setDetail("The resource was modified by another operation.");
    return ResponseEntity.status(HttpStatus.PRECONDITION_FAILED).body(problem);
}
```

This endpoint demonstrates:

- PATCH semantics,
- `If-Match`,
- strong ETag,
- tenant-scoped load,
- object-level authorization,
- structural validation,
- domain invariant,
- transaction boundary,
- audit log,
- Problem Details mapping,
- cache revalidation semantics.

---

## 29. Testing Spring MVC HTTP Contracts

### 29.1 MockMvc

```java
@WebMvcTest(CaseSummaryController.class)
class CaseSummaryControllerTest {

    @Autowired
    MockMvc mockMvc;

    @Test
    void updateSummaryRequiresIfMatch() throws Exception {
        mockMvc.perform(patch("/api/cases/{id}/summary", UUID.randomUUID())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"summary\":\"updated\"}"))
                .andExpect(status().isPreconditionRequired())
                .andExpect(content().contentTypeCompatibleWith("application/problem+json"));
    }
}
```

### 29.2 Test categories

Test these explicitly:

- unsupported method -> `405`,
- unsupported content type -> `415`,
- unacceptable accept header -> `406`,
- invalid JSON -> `400`,
- validation error -> stable Problem Details,
- unauthorized -> `401`,
- forbidden -> `403`,
- hidden resource -> `404`,
- version mismatch -> `412`,
- domain conflict -> `409`,
- idempotency replay -> same response,
- CORS preflight -> correct headers,
- response headers -> ETag/cache/security headers,
- route metric uses template not raw path.

### 29.3 Integration tests

MockMvc is not enough for:

- real container behavior,
- compression,
- TLS/proxy headers,
- multipart temp files,
- streaming,
- response commit,
- connection pool behavior,
- timeout behavior.

Use full integration tests with embedded server when necessary.

---

## 30. Checklist: Spring MVC Production API

### 30.1 Controller checklist

- [ ] Uses correct HTTP method.
- [ ] Declares `consumes` where body exists.
- [ ] Declares `produces` where representation matters.
- [ ] Returns correct status code.
- [ ] Sets `Location` for created resource.
- [ ] Sets `ETag` where concurrency/cache validation matters.
- [ ] Does not catch generic exception.
- [ ] Does not perform heavy domain logic.
- [ ] Does not expose entity directly.
- [ ] Does not accept raw `Map<String,Object>` unless explicitly dynamic.

### 30.2 Filter/interceptor checklist

- [ ] Filter ordering is explicit.
- [ ] Request ID/trace context is set early.
- [ ] Context is cleared in finally/afterCompletion.
- [ ] Body is not consumed accidentally.
- [ ] Forwarded headers are trusted only behind trusted proxy.
- [ ] Security chain handles CORS/preflight correctly.
- [ ] Logging redacts sensitive data.

### 30.3 Error checklist

- [ ] Error response is stable and machine-readable.
- [ ] Problem Details shape is consistent.
- [ ] Validation errors are structured.
- [ ] Stack traces are not exposed.
- [ ] `4xx` vs `5xx` is correct.
- [ ] Correlation ID is included.
- [ ] Internal log has diagnostic detail.

### 30.4 Timeout/resource checklist

- [ ] Server timeout configured.
- [ ] Downstream HTTP timeout configured.
- [ ] DB query timeout configured where needed.
- [ ] Thread pool sizing understood.
- [ ] Connection pool sizing understood.
- [ ] Async executor configured if async MVC is used.
- [ ] Large upload/download handled without memory blowup.
- [ ] Long-running operation uses async job when appropriate.

### 30.5 Security checklist

- [ ] Authentication is central and consistent.
- [ ] Object-level authorization exists.
- [ ] Tenant boundary enforced in queries.
- [ ] CSRF policy matches credential style.
- [ ] CORS is not treated as auth.
- [ ] Security headers are set.
- [ ] Request size/header limits exist.
- [ ] Sensitive fields are not logged.
- [ ] Mass assignment is prevented.

---

## 31. Practical Exercises

### Exercise 1 — Map the pipeline

Take one existing Spring MVC endpoint and write its full pipeline:

```text
proxy -> container -> filters -> security -> dispatcher -> interceptor -> resolver -> converter -> validation -> controller -> service -> repository -> response mapping
```

Identify where each of these occurs:

- authentication,
- authorization,
- validation,
- error mapping,
- logging,
- tracing,
- transaction,
- idempotency,
- ETag handling.

### Exercise 2 — Fix a bad controller

Given this endpoint:

```java
@PostMapping("/case/update")
Map<String, Object> update(@RequestBody Map<String, Object> body) {
    try {
        service.update(body);
        return Map.of("success", true);
    } catch (Exception e) {
        return Map.of("success", false, "error", e.getMessage());
    }
}
```

Refactor it to:

- resource-oriented URI,
- explicit method semantics,
- typed DTO,
- validation,
- correct status codes,
- Problem Details error mapping,
- authorization boundary,
- ETag/If-Match if needed.

### Exercise 3 — Design a filter ordering policy

Define ordering for:

- forwarded header handling,
- request ID,
- trace context,
- CORS,
- Spring Security,
- rate limiting,
- request logging,
- tenant context.

Explain why each order is chosen.

### Exercise 4 — Diagnose thread starvation

Given symptoms:

- CPU 30%,
- p95 latency 20s,
- Tomcat threads maxed,
- DB pool maxed,
- gateway 504,
- clients retrying POST,

produce:

- likely root causes,
- immediate mitigation,
- long-term fix,
- observability signals to confirm.

---

## 32. Key Takeaways

1. Spring MVC is an HTTP adapter framework on top of Servlet, not the whole HTTP system.
2. Servlet filters live at container boundary; interceptors live at Spring handler boundary.
3. Controllers should map HTTP contract to application use case, not contain all business logic.
4. Message converters and Jackson settings are external API contract, not mere serialization detail.
5. Exception handling must be centralized, stable, safe, and observable.
6. Thread-per-request works well for many Java backends, but only if timeout, pool, and blocking behavior are designed deliberately.
7. Async MVC helps specific workloads, but it does not remove the cost of blocking work.
8. Response commit semantics matter for streaming, downloads, and late failures.
9. Production correctness depends on where concerns are placed: filter, interceptor, resolver, controller, service, domain, repository, proxy.
10. A top-tier Java backend engineer understands both HTTP semantics and the framework machinery that enforces or violates them.

---

## 33. References

- RFC 9110 — HTTP Semantics.
- Jakarta Servlet Specification.
- Jakarta Servlet API documentation for `Filter` and `FilterChain`.
- Spring Framework Reference — Spring Web MVC.
- Spring Framework Reference — HTTP Message Conversion.
- Spring Framework Reference — Handler Interceptors.
- Spring Framework Reference — Asynchronous Requests.
- Spring Framework API — `DispatcherServlet`, `HandlerAdapter`, `DeferredResult`, `ProblemDetail`.
- Apache Tomcat HTTP Connector Configuration Reference.
- Spring Security Reference.
- OWASP REST Security Cheat Sheet.
- OWASP API Security Top 10.
- OpenTelemetry Semantic Conventions for HTTP.

---

# Status Seri

Part ini adalah **Part 029 dari 032**.

Seri **belum selesai**.

Part berikutnya:

```text
learn-http-for-web-backend-perspective-part-030.md
```

Topik berikutnya:

```text
Java Backend Implementation: WebFlux, Reactor Netty, and Reactive HTTP
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-http-for-web-backend-perspective-part-028.md">⬅️ Part 028 — HTTP Attacks and Defensive Backend Design</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-http-for-web-backend-perspective-part-030.md">HTTP for Web/Backend Perspective — Part 030 ➡️</a>
</div>
