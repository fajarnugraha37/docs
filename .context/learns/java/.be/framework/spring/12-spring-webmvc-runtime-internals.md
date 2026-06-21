# Part 12 — Spring Web MVC Runtime Internals

> Seri: `learn-java-spring-framework-boot-enterprise-runtime-engineering`  
> File: `12-spring-webmvc-runtime-internals.md`  
> Status seri: Part 12 dari 35 — **belum selesai**  
> Fokus: memahami Spring MVC sebagai runtime pipeline, bukan sekadar `@RestController` + `@RequestMapping`.

---

## 0. Tujuan Pembelajaran

Setelah bagian ini, Anda diharapkan mampu:

1. Membaca Spring MVC sebagai **front-controller runtime** yang terdiri dari delegate components.
2. Menjelaskan request lifecycle dari request masuk sampai response keluar.
3. Membedakan peran:
   - Servlet filter,
   - `DispatcherServlet`,
   - `HandlerMapping`,
   - `HandlerAdapter`,
   - `HandlerInterceptor`,
   - `HandlerMethodArgumentResolver`,
   - `HandlerMethodReturnValueHandler`,
   - `HttpMessageConverter`,
   - `HandlerExceptionResolver`.
4. Memahami kenapa controller method bisa punya parameter sangat fleksibel.
5. Memahami kenapa return value controller bisa berupa object, `ResponseEntity`, `String`, `ModelAndView`, `Callable`, `DeferredResult`, stream, dan lainnya.
6. Mendesain API layer yang tidak hanya “jalan”, tetapi punya boundary, error semantics, observability, dan failure model yang jelas.
7. Mengetahui titik extension yang benar saat membangun internal platform di atas Spring MVC.

---

## 1. Posisi Part Ini dalam Seri

Sebelum part ini, kita sudah membahas:

1. Spring sebagai runtime.
2. IoC container.
3. Dependency injection resolution.
4. Bean lifecycle.
5. Annotation metadata.
6. Configuration model.
7. Environment dan config binding.
8. Boot auto-configuration.
9. Startup diagnostics.
10. AOP/proxy.
11. Transaction management.
12. Spring Data integration model.

Part ini masuk ke sisi **inbound HTTP runtime**.

Yang penting: Spring MVC bukan sekadar “controller framework”. Spring MVC adalah lapisan runtime yang mengubah:

```text
HTTP request
  -> mapped handler
  -> resolved Java method arguments
  -> invoked application method
  -> adapted return value
  -> serialized HTTP response
  -> handled error semantics
```

Spring MVC menyembunyikan banyak kompleksitas di balik controller method. Untuk engineer biasa, ini terasa seperti magic. Untuk engineer top-tier, ini adalah pipeline yang bisa dibaca, dikonfigurasi, diuji, dan di-debug.

---

## 2. Mental Model Utama: Spring MVC adalah Pipeline Adaptasi

Spring MVC bukan hanya MVC pattern klasik. Dalam backend API modern, Spring MVC lebih tepat dipahami sebagai:

```text
Servlet-based HTTP adapter runtime
```

Ia menjembatani dua dunia:

```text
Dunia HTTP/Servlet
  - request method
  - path
  - query string
  - headers
  - body
  - cookies
  - session
  - response status
  - response body
  - content type

Dunia Java application
  - controller class
  - method
  - parameter object
  - domain/application service
  - DTO
  - exception
  - return value
```

Spring MVC melakukan adaptasi dengan banyak komponen kecil:

```text
Filter
  -> DispatcherServlet
      -> HandlerMapping
      -> HandlerExecutionChain
      -> HandlerAdapter
          -> ArgumentResolvers
          -> Controller method invocation
          -> ReturnValueHandlers
          -> MessageConverters
      -> HandlerExceptionResolvers
      -> ViewResolvers / response writing
```

Jika Anda memahami tiap komponen, Anda bisa menjawab pertanyaan seperti:

- Kenapa endpoint tidak termapping?
- Kenapa parameter request tidak terisi?
- Kenapa validation tidak jalan?
- Kenapa response jadi XML bukan JSON?
- Kenapa exception tidak masuk `@ControllerAdvice`?
- Kenapa interceptor jalan tapi filter tidak?
- Kenapa async request timeout?
- Kenapa `@Transactional` di controller tidak ideal?
- Kenapa body request hanya bisa dibaca sekali?
- Kenapa path matching berubah setelah upgrade Spring?

---

## 3. Historical Context: Java 8 sampai Java 25

Spring MVC sudah ada lama dan tetap menjadi stack utama untuk banyak enterprise system.

Secara garis besar:

| Era | Java | Spring | Karakter MVC |
|---|---:|---|---|
| Legacy enterprise | 8 | Spring 4/5, Boot 1/2 | `javax.servlet`, WAR, external container, XML/annotation hybrid |
| Transitional | 11–17 | Spring 5.3/6.x, Boot 2.7/3.x | migrasi ke Jakarta, embedded container dominan |
| Modern baseline | 17–21 | Spring 6.x, Boot 3.x | `jakarta.servlet`, Problem Details, observability, virtual-thread support |
| Current/future | 17–25 | Spring 7.x, Boot 4.x | modular Boot, Java 25 support, Jakarta EE 11 alignment, API versioning improvement |

Poin penting:

1. Spring MVC tetap berbasis Servlet API.
2. Spring 6+ menggunakan namespace `jakarta.*`, bukan `javax.*`.
3. WebFlux bukan pengganti total MVC; WebFlux adalah stack berbeda dengan kontrak non-blocking.
4. Virtual threads membuat blocking MVC lebih menarik untuk banyak workload, tetapi tidak menghapus bottleneck seperti database pool, remote API timeout, atau memory pressure.

---

## 4. Front Controller Pattern

Spring MVC menggunakan pattern **Front Controller**.

Artinya, request HTTP tidak langsung masuk ke controller application Anda. Request terlebih dahulu masuk ke satu servlet pusat:

```text
DispatcherServlet
```

`DispatcherServlet` bertugas menyediakan algoritma bersama:

```text
receive request
  -> locate handler
  -> apply interceptors
  -> invoke handler through adapter
  -> process return value
  -> render/write response
  -> resolve exception if needed
```

Controller Anda bukan pusat runtime. Controller Anda hanya salah satu jenis handler yang bisa dipanggil oleh `DispatcherServlet`.

### Kenapa ini penting?

Karena banyak extension tidak perlu mengubah controller.

Contoh:

- global exception model,
- request correlation,
- locale resolution,
- content negotiation,
- validation,
- type conversion,
- CORS,
- API versioning,
- custom parameter annotation,
- custom return wrapper,
- audit interceptor.

Semua bisa masuk ke pipeline tanpa mencemari business logic.

---

## 5. Big Picture Request Lifecycle

Secara konseptual:

```text
Client
  |
  v
Servlet container
  |
  v
Filter chain
  |
  v
DispatcherServlet
  |
  +--> resolve multipart request
  |
  +--> determine handler via HandlerMapping
  |
  +--> build HandlerExecutionChain
  |
  +--> preHandle interceptors
  |
  +--> invoke handler via HandlerAdapter
  |       |
  |       +--> resolve method arguments
  |       +--> invoke controller method
  |       +--> handle return value
  |
  +--> postHandle interceptors
  |
  +--> render view / write body
  |
  +--> afterCompletion interceptors
  |
  v
Response
```

Jika terjadi exception:

```text
Exception
  -> HandlerExceptionResolver chain
      -> @ExceptionHandler
      -> @ResponseStatus
      -> default Spring MVC exception resolver
      -> container error handling if unresolved
```

Jika async:

```text
Initial request thread
  -> controller returns Callable/DeferredResult/etc
  -> request enters async mode
  -> container thread released
  -> async result completed later
  -> async dispatch back to DispatcherServlet
  -> response completed
```

---

## 6. Servlet Filter vs Spring MVC Interceptor

Ini salah satu kebingungan paling umum.

### 6.1 Filter

Filter berasal dari Servlet API.

Filter berjalan sebelum request masuk ke `DispatcherServlet`.

```text
Client
  -> Filter 1
  -> Filter 2
  -> Filter 3
  -> DispatcherServlet
```

Filter cocok untuk concern yang berada di level HTTP/container:

- security filter chain,
- CORS,
- compression,
- request body wrapping,
- response wrapping,
- correlation ID,
- logging low-level,
- rate limit sebelum mapping MVC,
- character encoding,
- servlet session handling.

Filter tidak tahu detail controller method yang akan dipanggil, kecuali Anda melakukan kerja ekstra.

### 6.2 HandlerInterceptor

Interceptor adalah bagian dari Spring MVC.

Interceptor berjalan setelah Spring menemukan handler.

```text
DispatcherServlet
  -> HandlerMapping finds handler
  -> Interceptor.preHandle
  -> HandlerAdapter invokes handler
  -> Interceptor.postHandle
  -> render/write response
  -> Interceptor.afterCompletion
```

Interceptor cocok untuk concern yang membutuhkan pengetahuan MVC:

- handler method metadata,
- custom annotation di controller,
- audit per endpoint,
- tenant validation berbasis handler,
- API version guard,
- per-handler authorization tambahan,
- request timing per mapped handler.

### 6.3 Perbandingan

| Aspek | Filter | HandlerInterceptor |
|---|---|---|
| Layer | Servlet | Spring MVC |
| Berjalan sebelum handler mapping? | Ya | Tidak |
| Tahu controller method? | Tidak langsung | Ya, jika handler adalah `HandlerMethod` |
| Bisa wrap request/response? | Ya | Terbatas |
| Cocok untuk security low-level | Ya | Tidak sebagai utama |
| Cocok untuk endpoint audit | Bisa, tapi kurang metadata | Ya |
| Ikut async dispatch? | Tergantung konfigurasi dispatcher type | Ada async-aware contract |

### 6.4 Rule of Thumb

Gunakan filter jika concern harus berlaku sebelum Spring MVC mengetahui handler.

Gunakan interceptor jika concern membutuhkan metadata handler Spring MVC.

Jangan gunakan interceptor untuk menggantikan security filter chain.

---

## 7. DispatcherServlet Internals

`DispatcherServlet` adalah pusat dispatch request Spring MVC.

Ia tidak mengerjakan semua detail sendiri. Ia mencari delegate components dari application context.

Delegate penting:

```text
HandlerMapping
HandlerAdapter
HandlerExceptionResolver
ViewResolver
LocaleResolver / LocaleContextResolver
ThemeResolver
MultipartResolver
FlashMapManager
RequestToViewNameTranslator
```

Untuk REST API modern, yang paling sering relevan:

- `HandlerMapping`
- `HandlerAdapter`
- `HandlerExceptionResolver`
- `HttpMessageConverter`
- `ConversionService`
- `Validator`
- `ContentNegotiationManager`

### 7.1 Kenapa delegate model penting?

Karena Spring MVC dibuat open for extension.

Jika Anda ingin mengubah cara request dipetakan, Anda tidak mengubah `DispatcherServlet`.
Anda menambah/mengubah `HandlerMapping`.

Jika Anda ingin controller method menerima parameter custom, Anda tidak mengubah `DispatcherServlet`.
Anda menambah `HandlerMethodArgumentResolver`.

Jika Anda ingin return value custom, Anda menambah `HandlerMethodReturnValueHandler`.

Jika Anda ingin exception model global, Anda menambah `HandlerExceptionResolver` atau `@ControllerAdvice`.

---

## 8. HandlerMapping

`HandlerMapping` bertugas menjawab pertanyaan:

```text
Request ini harus ditangani oleh siapa?
```

Input:

```text
HTTP method
path
headers
params
content type
accept type
custom condition
```

Output:

```text
HandlerExecutionChain
  - handler
  - interceptors
```

Pada controller annotation model, handler biasanya berupa:

```text
HandlerMethod
```

`HandlerMethod` merepresentasikan:

```text
bean instance + Java method + method metadata
```

Contoh:

```java
@RestController
@RequestMapping("/cases")
class CaseController {

    @GetMapping("/{id}")
    CaseResponse getCase(@PathVariable Long id) {
        ...
    }
}
```

Secara runtime, Spring tidak melihat ini hanya sebagai annotation. Spring membangun mapping metadata:

```text
GET /cases/{id}
  -> bean: caseController
  -> method: getCase(Long)
  -> conditions:
      method = GET
      path = /cases/{id}
      consumes = none
      produces = inferred/declared
      params = none
      headers = none
```

### 8.1 RequestMappingInfo

Untuk annotated controller, mapping disimpan sebagai `RequestMappingInfo`.

Isi konseptual:

```text
path patterns
HTTP methods
params conditions
headers conditions
consumes conditions
produces conditions
custom conditions
```

Spring akan memilih mapping paling spesifik jika ada beberapa kandidat.

### 8.2 Ambiguous Mapping

Contoh buruk:

```java
@GetMapping("/cases/{value}")
CaseResponse byId(@PathVariable String value) { ... }

@GetMapping("/cases/{code}")
CaseResponse byCode(@PathVariable String code) { ... }
```

Bagi Spring, kedua mapping ini sama-sama:

```text
GET /cases/{variable}
```

Nama variable tidak membuat path lebih spesifik.

Solusi:

```java
@GetMapping("/cases/id/{id}")
CaseResponse byId(@PathVariable Long id) { ... }

@GetMapping("/cases/code/{code}")
CaseResponse byCode(@PathVariable String code) { ... }
```

Atau gunakan constraint jika tersedia dan jelas, tetapi explicit path biasanya lebih defensible.

### 8.3 Path Matching: Ant vs PathPatternParser

Legacy Spring banyak memakai Ant-style path matching.

Spring modern mendorong `PathPatternParser` untuk performa dan semantics yang lebih jelas.

Perbedaan path matching bisa memunculkan regression saat upgrade.

Contoh risiko:

```text
/cases/**
/cases/{id}
/cases/{id}/documents/**
```

Jika aplikasi punya banyak wildcard dan ambiguous route, migration path matching harus diuji serius.

### 8.4 HandlerMapping Failure Model

| Gejala | Kemungkinan Penyebab |
|---|---|
| 404 padahal controller ada | base package tidak terscan, path salah, context path, servlet path, profile disabled |
| Ambiguous mapping startup failure | dua method punya mapping identik atau setara |
| 405 Method Not Allowed | path match ada, HTTP method tidak cocok |
| 415 Unsupported Media Type | `Content-Type` tidak cocok dengan `consumes` atau converter |
| 406 Not Acceptable | `Accept` tidak cocok dengan `produces` atau converter |
| Endpoint kalah dari static resource | handler mapping order / resource handler |
| Setelah upgrade routing berubah | path pattern strategy berubah |

---

## 9. HandlerExecutionChain

`HandlerMapping` tidak hanya mengembalikan handler.

Ia mengembalikan:

```text
HandlerExecutionChain
  - handler
  - list of interceptors
```

Ini penting karena interceptor dipilih berdasarkan mapping.

Contoh:

```java
@Configuration
class WebConfig implements WebMvcConfigurer {

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(new AuditInterceptor())
                .addPathPatterns("/api/**")
                .excludePathPatterns("/api/health");
    }
}
```

Spring akan memasukkan interceptor tersebut ke chain hanya untuk path yang cocok.

### 9.1 Interceptor Methods

```java
class AuditInterceptor implements HandlerInterceptor {

    @Override
    public boolean preHandle(
            HttpServletRequest request,
            HttpServletResponse response,
            Object handler) {
        return true;
    }

    @Override
    public void postHandle(
            HttpServletRequest request,
            HttpServletResponse response,
            Object handler,
            ModelAndView modelAndView) {
    }

    @Override
    public void afterCompletion(
            HttpServletRequest request,
            HttpServletResponse response,
            Object handler,
            Exception ex) {
    }
}
```

Meaning:

| Method | Timing | Use Case |
|---|---|---|
| `preHandle` | sebelum controller | reject, audit start, tenant check |
| `postHandle` | setelah controller sebelum render | model manipulation, rarely used for REST |
| `afterCompletion` | setelah completion | cleanup, audit finish, exception logging |

### 9.2 HandlerMethod Metadata dalam Interceptor

```java
if (handler instanceof HandlerMethod hm) {
    Method method = hm.getMethod();
    Class<?> beanType = hm.getBeanType();
    Audited audited = AnnotatedElementUtils.findMergedAnnotation(method, Audited.class);
}
```

Ini pola bagus untuk internal platform:

```java
@Target({ElementType.TYPE, ElementType.METHOD})
@Retention(RetentionPolicy.RUNTIME)
public @interface AuditedEndpoint {
    String action();
    String resource();
}
```

Lalu interceptor membaca annotation tersebut.

### 9.3 Interceptor Failure Model

| Masalah | Penyebab |
|---|---|
| Interceptor tidak jalan | path pattern salah, tidak registered, order kalah, endpoint bukan MVC |
| Interceptor jalan dua kali | async dispatch, forward, include, duplicate registration |
| Audit tidak tercatat saat exception | logic hanya di `postHandle`, bukan `afterCompletion` |
| Security bypass | interceptor dipakai sebagai security utama, padahal request tertentu tidak lewat MVC |
| Memory leak | context disimpan di ThreadLocal tapi tidak dibersihkan di `afterCompletion` |

---

## 10. HandlerAdapter

Setelah handler ditemukan, Spring perlu menjawab:

```text
Bagaimana cara menjalankan handler ini?
```

Itu tugas `HandlerAdapter`.

Kenapa perlu adapter?

Karena tidak semua handler adalah annotated controller method.

Secara historis, Spring MVC mendukung banyak model handler.

Untuk `@Controller`/`@RestController`, adapter yang relevan adalah:

```text
RequestMappingHandlerAdapter
```

`RequestMappingHandlerAdapter` adalah komponen yang membuat controller method fleksibel.

Ia mengelola:

```text
argument resolvers
return value handlers
message converters
init binder methods
model attribute methods
session attributes
async support
```

---

## 11. HandlerMethodArgumentResolver

Controller method bisa menerima banyak jenis parameter:

```java
@GetMapping("/cases/{id}")
CaseResponse get(
        @PathVariable Long id,
        @RequestParam Optional<String> view,
        @RequestHeader("X-Correlation-Id") String correlationId,
        @AuthenticationPrincipal UserPrincipal user,
        HttpServletRequest request) {
    ...
}
```

Ini mungkin karena Spring punya chain:

```text
HandlerMethodArgumentResolverComposite
  -> PathVariableMethodArgumentResolver
  -> RequestParamMethodArgumentResolver
  -> RequestHeaderMethodArgumentResolver
  -> RequestResponseBodyMethodProcessor
  -> ServletRequestMethodArgumentResolver
  -> PrincipalMethodArgumentResolver
  -> ...
```

Untuk setiap parameter method, Spring bertanya ke resolver satu per satu:

```text
supportsParameter(parameter)?
```

Resolver pertama yang mendukung akan dipakai:

```text
resolveArgument(parameter, request, binderFactory, conversionService)
```

### 11.1 Contoh Custom Argument Resolver

Misalnya Anda ingin controller menerima tenant context:

```java
@GetMapping("/cases/{id}")
CaseResponse getCase(
        @PathVariable Long id,
        CurrentTenant tenant) {
    ...
}
```

Resolver:

```java
public final class CurrentTenantArgumentResolver implements HandlerMethodArgumentResolver {

    @Override
    public boolean supportsParameter(MethodParameter parameter) {
        return parameter.getParameterType().equals(CurrentTenant.class);
    }

    @Override
    public Object resolveArgument(
            MethodParameter parameter,
            ModelAndViewContainer mavContainer,
            NativeWebRequest webRequest,
            WebDataBinderFactory binderFactory) {

        String tenantId = webRequest.getHeader("X-Tenant-Id");
        if (tenantId == null || tenantId.isBlank()) {
            throw new MissingTenantException("Missing X-Tenant-Id");
        }
        return new CurrentTenant(tenantId);
    }
}
```

Registration:

```java
@Configuration
class WebConfig implements WebMvcConfigurer {

    @Override
    public void addArgumentResolvers(List<HandlerMethodArgumentResolver> resolvers) {
        resolvers.add(new CurrentTenantArgumentResolver());
    }
}
```

### 11.2 Resolver Design Guideline

Custom argument resolver bagus untuk:

- current user,
- tenant context,
- correlation context,
- API client context,
- request metadata object,
- strongly-typed pagination/filter object,
- custom signed header claims.

Tapi jangan pakai resolver untuk:

- memanggil database berat,
- menjalankan business logic,
- melakukan remote API call,
- membuat transaksi,
- menyembunyikan authorization kompleks.

Argument resolver adalah boundary adapter, bukan application service.

### 11.3 Argument Resolution Failure Model

| Gejala | Kemungkinan Penyebab |
|---|---|
| 400 Bad Request | parameter missing, type conversion gagal, body invalid |
| `HttpMessageNotReadableException` | JSON malformed atau body tidak cocok |
| Parameter null tidak diharapkan | resolver tidak aktif, annotation salah, optional semantics salah |
| Custom resolver tidak dipakai | `supportsParameter` false atau order kalah |
| Body kosong | request body sudah dibaca filter/interceptor sebelumnya |
| Conversion gagal | `Converter` tidak registered atau input format salah |

---

## 12. Type Conversion and Formatting

Spring MVC tidak langsung mengubah string HTTP menjadi Java object secara manual di controller.

Ia menggunakan conversion infrastructure:

```text
String path/query/header value
  -> ConversionService
  -> Converter / Formatter
  -> target Java type
```

Contoh:

```java
@GetMapping("/reports")
ReportResponse get(
        @RequestParam LocalDate from,
        @RequestParam LocalDate to) {
    ...
}
```

Spring perlu tahu format tanggal.

Untuk format eksplisit:

```java
@GetMapping("/reports")
ReportResponse get(
        @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
        @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
    ...
}
```

### 12.1 Custom Converter

```java
@Component
class CaseIdConverter implements Converter<String, CaseId> {

    @Override
    public CaseId convert(String source) {
        if (!source.matches("CASE-[0-9]{8}")) {
            throw new IllegalArgumentException("Invalid case id");
        }
        return new CaseId(source);
    }
}
```

Controller:

```java
@GetMapping("/cases/{caseId}")
CaseResponse get(@PathVariable CaseId caseId) {
    ...
}
```

Ini membuat boundary lebih kuat:

```text
raw String tidak bocor terlalu jauh ke application layer
```

### 12.2 Conversion Design Rule

Gunakan converter untuk transformasi kecil, deterministic, local.

Jangan gunakan converter untuk:

- database lookup,
- authorization,
- remote service call,
- complex business validation.

---

## 13. DataBinder, WebDataBinder, and BindingResult

Binding adalah proses mengisi object dari request parameters/form/body tertentu.

Untuk API JSON modern, binding sering terlihat melalui `@RequestBody`. Untuk form/object binding, Spring menggunakan `DataBinder`.

Contoh:

```java
@PostMapping("/cases/search")
SearchResult search(@Valid CaseSearchRequest request, BindingResult bindingResult) {
    if (bindingResult.hasErrors()) {
        ...
    }
    ...
}
```

### 13.1 `@InitBinder`

Controller dapat mendefinisikan binder customization:

```java
@InitBinder
void initBinder(WebDataBinder binder) {
    binder.setDisallowedFields("role", "admin", "createdBy");
}
```

Namun di API modern, lebih baik menggunakan DTO eksplisit daripada mengandalkan disallowed fields.

### 13.2 Mass Assignment Risk

Bahaya klasik:

```java
@PostMapping("/users")
void create(UserEntity user) {
    userRepository.save(user);
}
```

Jika entity punya field:

```java
boolean admin;
String status;
String createdBy;
```

Client bisa mengirim field yang tidak seharusnya.

Rule:

```text
Never bind external request directly into entity or aggregate.
```

Gunakan DTO boundary:

```java
record CreateUserRequest(
        @NotBlank String name,
        @Email String email) {
}
```

---

## 14. Validation Integration

Spring MVC mengintegrasikan Bean Validation melalui `@Valid` atau `@Validated`.

Contoh:

```java
@PostMapping("/cases")
ResponseEntity<CaseResponse> create(@Valid @RequestBody CreateCaseRequest request) {
    ...
}
```

Jika validation gagal, Spring melempar exception seperti:

```text
MethodArgumentNotValidException
```

Untuk query/path/method validation, modelnya bisa berbeda tergantung setup Spring version dan method validation integration.

### 14.1 Validation Placement

Validasi sebaiknya dibagi:

```text
API boundary validation
  - required field
  - format
  - length
  - enum value
  - simple cross-field constraint

Application/domain validation
  - state transition allowed?
  - user can perform action?
  - case already closed?
  - deadline passed?
  - external policy satisfied?
```

Jangan meletakkan domain rule kompleks di annotation validation hanya karena bisa.

### 14.2 Validation Failure Model

| Jenis Error | Biasanya dari |
|---|---|
| malformed JSON | message converter |
| missing body | request body processor |
| invalid field | Bean Validation |
| invalid state transition | application/domain service |
| unauthorized action | security/authorization layer |
| stale update | optimistic locking/application check |

---

## 15. HttpMessageConverter

Untuk REST API, `HttpMessageConverter` sangat penting.

Ia menjawab dua pertanyaan:

```text
Can read request body of Content-Type X into Java type Y?
Can write Java type Y into response body with media type X?
```

Contoh umum:

```text
application/json <-> Jackson JSON converter
text/plain       <-> String converter
application/xml  <-> XML converter if enabled
byte[]           <-> ByteArray converter
Resource         <-> Resource converter
```

### 15.1 Request Body Flow

```text
HTTP request body
  -> Content-Type: application/json
  -> RequestResponseBodyMethodProcessor
  -> choose HttpMessageConverter
  -> ObjectMapper deserializes JSON
  -> Java DTO
  -> validation if @Valid
  -> controller method invoked
```

### 15.2 Response Body Flow

```text
Controller returns object
  -> ReturnValueHandler detects @ResponseBody / @RestController
  -> Content negotiation determines media type
  -> HttpMessageConverter writes object
  -> response body
```

### 15.3 Common Errors

| Error | Meaning |
|---|---|
| 415 Unsupported Media Type | tidak ada converter untuk request `Content-Type` |
| 406 Not Acceptable | tidak bisa menghasilkan media type sesuai `Accept` |
| `HttpMessageNotReadableException` | body tidak bisa dibaca/deserialized |
| `HttpMessageNotWritableException` | response object tidak bisa diserialized |

### 15.4 Jackson Is Not Spring MVC

Jackson adalah library JSON. Spring MVC menggunakan Jackson melalui converter.

Jangan mencampur mental model:

```text
Spring MVC chooses when/how to read/write body.
Jackson handles JSON serialization/deserialization details.
```

---

## 16. Content Negotiation

Content negotiation menentukan format response.

Input umum:

```text
Accept header
produces condition
configured media type mapping
converter availability
```

Contoh:

```java
@GetMapping(value = "/cases/{id}", produces = MediaType.APPLICATION_JSON_VALUE)
CaseResponse get(@PathVariable Long id) { ... }
```

Jika client mengirim:

```http
Accept: application/xml
```

dan endpoint hanya menghasilkan JSON, response bisa menjadi:

```text
406 Not Acceptable
```

### 16.1 Design Rule untuk Enterprise API

Untuk API internal/enterprise, lebih baik eksplisit:

```java
@RequestMapping(
    path = "/api/v1/cases",
    produces = MediaType.APPLICATION_JSON_VALUE
)
@RestController
class CaseController { ... }
```

Untuk command endpoint:

```java
@PostMapping(
    consumes = MediaType.APPLICATION_JSON_VALUE
)
```

Ini membuat contract jelas dan menghindari converter surprise.

---

## 17. HandlerMethodReturnValueHandler

Setelah controller method selesai, Spring perlu menjawab:

```text
Apa arti return value ini?
```

Contoh return value:

```java
CaseResponse
ResponseEntity<CaseResponse>
String
void
ModelAndView
Callable<CaseResponse>
DeferredResult<CaseResponse>
StreamingResponseBody
SseEmitter
```

Masing-masing ditangani oleh return value handler berbeda.

### 17.1 `@RestController`

`@RestController` adalah gabungan:

```text
@Controller + @ResponseBody
```

Artinya return value dianggap response body, bukan nama view.

### 17.2 `ResponseEntity`

`ResponseEntity` memberi kontrol terhadap:

- status,
- headers,
- body.

Contoh:

```java
@PostMapping("/cases")
ResponseEntity<CaseResponse> create(@Valid @RequestBody CreateCaseRequest request) {
    CaseResponse response = service.create(request);
    return ResponseEntity
            .created(URI.create("/cases/" + response.id()))
            .body(response);
}
```

### 17.3 Custom Return Value Handler

Kadang platform internal ingin controller return custom type:

```java
ApiResult<CaseResponse>
```

Namun sebelum membuat custom return value handler, evaluasi dulu apakah cukup dengan:

- `ResponseBodyAdvice`,
- common response DTO,
- exception handler,
- controller convention.

Custom return value handler menambah kompleksitas pipeline.

---

## 18. ResponseBodyAdvice and RequestBodyAdvice

`ResponseBodyAdvice` memungkinkan Anda mengintervensi body sebelum ditulis converter.

Contoh use case:

- response envelope,
- response metadata,
- trace id injection,
- masking tertentu,
- API compatibility wrapper.

Contoh sederhana:

```java
@RestControllerAdvice
class ApiEnvelopeAdvice implements ResponseBodyAdvice<Object> {

    @Override
    public boolean supports(
            MethodParameter returnType,
            Class<? extends HttpMessageConverter<?>> converterType) {
        return !returnType.getParameterType().equals(ApiResponse.class);
    }

    @Override
    public Object beforeBodyWrite(
            Object body,
            MethodParameter returnType,
            MediaType selectedContentType,
            Class<? extends HttpMessageConverter<?>> selectedConverterType,
            ServerHttpRequest request,
            ServerHttpResponse response) {
        return new ApiResponse<>(body);
    }
}
```

### 18.1 Risiko Envelope Global

Global response wrapping bisa berbahaya jika tidak hati-hati:

- file download ikut ter-wrap,
- error response double wrapped,
- actuator endpoint terganggu,
- OpenAPI contract tidak cocok,
- streaming rusak,
- `String` response bermasalah dengan converter.

Rule:

```text
Global advice harus punya exclusion model yang eksplisit.
```

---

## 19. Exception Handling Runtime

Spring MVC menggunakan chain:

```text
HandlerExceptionResolverComposite
  -> ExceptionHandlerExceptionResolver
  -> ResponseStatusExceptionResolver
  -> DefaultHandlerExceptionResolver
  -> custom resolvers if configured
```

### 19.1 `@ExceptionHandler`

```java
@RestControllerAdvice
class ApiExceptionHandler {

    @ExceptionHandler(CaseNotFoundException.class)
    ResponseEntity<ProblemDetail> handle(CaseNotFoundException ex) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.NOT_FOUND);
        problem.setTitle("Case not found");
        problem.setDetail(ex.getMessage());
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(problem);
    }
}
```

### 19.2 Problem Details

Modern Spring mendukung model Problem Details untuk HTTP API error.

Format konseptual:

```json
{
  "type": "https://example.com/problems/case-not-found",
  "title": "Case not found",
  "status": 404,
  "detail": "Case CASE-0001 does not exist",
  "instance": "/api/v1/cases/CASE-0001"
}
```

### 19.3 Error Handling Design

Pisahkan error menjadi:

```text
client input error      -> 400
validation error        -> 400 / 422 depending convention
unauthenticated         -> 401
unauthorized            -> 403
not found               -> 404
conflict/state error    -> 409
precondition failed     -> 412
rate limited            -> 429
unexpected system error -> 500
dependency unavailable  -> 502/503/504 depending gateway/service role
```

### 19.4 Exception Handling Failure Model

| Gejala | Penyebab |
|---|---|
| Exception jadi HTML error page | tidak ditangani resolver/API advice, request masuk container error page |
| `@ExceptionHandler` tidak jalan | advice tidak terscan, exception terjadi di filter sebelum MVC, response already committed |
| Error response beda antar endpoint | multiple advice/order tidak jelas |
| Sensitive data bocor | detail exception langsung dikirim ke client |
| Validation error tidak konsisten | binding exception dan method validation exception ditangani berbeda |

---

## 20. View Resolution vs REST Response

Spring MVC awalnya mendukung server-side rendered views.

Untuk controller biasa:

```java
@Controller
class PageController {

    @GetMapping("/home")
    String home(Model model) {
        model.addAttribute("name", "Fajar");
        return "home";
    }
}
```

Return `"home"` berarti nama view.

Untuk REST:

```java
@RestController
class ApiController {

    @GetMapping("/hello")
    String hello() {
        return "hello";
    }
}
```

Return `"hello"` berarti response body.

Perbedaan ini berasal dari:

```text
@Controller + view resolution
@RestController/@ResponseBody + message conversion
```

### 20.1 Pitfall

Jika Anda memakai `@Controller` tapi lupa `@ResponseBody`:

```java
@Controller
class ApiController {
    @GetMapping("/api/ping")
    String ping() {
        return "pong";
    }
}
```

Spring akan mencari view bernama `pong`, bukan mengirim body `pong`.

---

## 21. Multipart Handling

Multipart request diproses sebelum handler invocation.

Contoh:

```java
@PostMapping(value = "/documents", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
DocumentResponse upload(
        @RequestPart("file") MultipartFile file,
        @RequestPart("metadata") DocumentMetadata metadata) {
    ...
}
```

Design concerns:

- max file size,
- max request size,
- temp file location,
- virus scanning,
- content type validation,
- filename sanitization,
- streaming vs memory buffering,
- transaction boundary,
- object storage consistency,
- cleanup on failure.

Do not treat multipart as just another DTO.

Multipart is an operational boundary.

---

## 22. Static Resource Handling

Spring MVC can serve static resources.

Conceptual mapping:

```text
/static/**
/public/**
/resources/**
/META-INF/resources/**
```

In Boot, static resource configuration is opinionated.

Risk in API service:

- unexpected static handler handles path,
- SPA fallback conflicts with API route,
- resource handler order surprises,
- security permits static path too broadly.

For pure backend API, keep static resource exposure intentional.

---

## 23. CORS in Spring MVC

CORS can be configured at multiple levels:

- controller annotation,
- `WebMvcConfigurer`,
- Spring Security CORS integration,
- gateway/reverse proxy.

Example:

```java
@Configuration
class WebConfig implements WebMvcConfigurer {

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOrigins("https://app.example.com")
                .allowedMethods("GET", "POST", "PUT", "PATCH", "DELETE")
                .allowedHeaders("Authorization", "Content-Type", "X-Correlation-Id")
                .allowCredentials(true);
    }
}
```

### 23.1 CORS Design Rule

Do not solve CORS by:

```text
allowedOrigins("*") + credentials
```

For enterprise systems, CORS is part of client trust boundary.

CORS misconfiguration can cause frontend integration failure or unintended browser-accessible API surface.

---

## 24. Async Spring MVC

Spring MVC supports async request processing on top of Servlet async mechanism.

Types include:

```text
Callable<T>
DeferredResult<T>
WebAsyncTask<T>
ResponseBodyEmitter
SseEmitter
StreamingResponseBody
```

### 24.1 Callable

```java
@GetMapping("/reports/{id}")
Callable<ReportResponse> generate(@PathVariable Long id) {
    return () -> reportService.generate(id);
}
```

Flow:

```text
request thread enters controller
  -> controller returns Callable
  -> Spring starts async processing
  -> Callable runs on AsyncTaskExecutor
  -> original servlet thread released
  -> result dispatched back
  -> response completed
```

### 24.2 DeferredResult

```java
@GetMapping("/jobs/{id}/result")
DeferredResult<JobResult> result(@PathVariable Long id) {
    DeferredResult<JobResult> deferred = new DeferredResult<>(30_000L);
    jobResultRegistry.register(id, deferred);
    return deferred;
}
```

Useful when result is completed by another thread/event.

### 24.3 Async MVC Is Not WebFlux

Important distinction:

```text
Spring MVC async:
  Servlet-based, can release request thread while waiting.
  Response writes may still be blocking.

WebFlux:
  non-blocking contracts through the stack.
```

Async MVC can improve thread utilization for long waits, but it does not magically make blocking downstream calls non-blocking.

### 24.4 Async Failure Model

| Problem | Cause |
|---|---|
| Timeout | async result not completed in time |
| Lost MDC/security context | context not propagated to executor |
| Double completion | `DeferredResult` completed from multiple paths |
| Memory leak | deferred results stored but not removed |
| Thread pool exhaustion | async executor too small/unbounded queue |
| Exception not formatted | async error not routed consistently |

---

## 25. Streaming Response

Spring MVC supports streaming patterns:

```java
@GetMapping("/export")
StreamingResponseBody export() {
    return outputStream -> {
        exportService.writeCsv(outputStream);
    };
}
```

Useful for:

- CSV export,
- large file generation,
- report download,
- incremental output.

### 25.1 Streaming Design Concerns

- response may already be committed,
- exception after partial write cannot become normal JSON error,
- transaction should not remain open during long stream,
- DB cursor/resource lifecycle must be explicit,
- client disconnect handling,
- timeout,
- backpressure limitations.

Rule:

```text
Do not perform long streaming inside a transaction unless you fully understand resource lifetime.
```

Often better:

```text
request export
  -> create job
  -> generate file asynchronously
  -> store in object storage
  -> download when ready
```

---

## 26. Request Body Can Usually Be Read Once

Servlet request body is stream-based.

If a filter reads body and does not wrap/copy it correctly, controller may see empty body.

Bad pattern:

```java
String body = request.getReader().lines().collect(joining());
chain.doFilter(request, response);
```

After this, downstream cannot read body again.

Use proper wrapper if body logging is required.

But be careful:

- large body memory impact,
- sensitive data exposure,
- multipart body logging disaster,
- binary body corruption,
- performance overhead.

For production, prefer structured audit fields over raw body logging.

---

## 27. Request Context and ThreadLocal

Spring MVC exposes request-related context through ThreadLocal-based holders:

```text
RequestContextHolder
LocaleContextHolder
SecurityContextHolder
MDC/logging context, often external
TransactionSynchronizationManager, if transaction active
```

Because MVC usually runs on one request thread, ThreadLocal appears convenient.

But async processing, task executor, virtual threads, and event dispatch can break assumptions.

### 27.1 Design Rule

For core application service, pass explicit context object when context is part of business decision.

Example:

```java
record CommandContext(
        UserId userId,
        TenantId tenantId,
        CorrelationId correlationId) {
}
```

Then:

```java
caseService.approve(command, context);
```

Do not let deep domain/application logic randomly call `RequestContextHolder`.

---

## 28. Controller Design: Thin, But Not Anemic

A controller should primarily handle transport concerns:

- HTTP mapping,
- request DTO,
- validation trigger,
- current user/tenant extraction,
- calling application service,
- response DTO,
- status/header semantics.

A controller should not contain:

- complex business branching,
- persistence logic,
- transaction orchestration with multiple repositories,
- remote integration workflow,
- authorization policy matrix,
- domain state transition logic.

But “thin” does not mean “zero logic”. It may contain HTTP semantics.

Example acceptable:

```java
@PostMapping("/{id}/approval")
ResponseEntity<ApprovalResponse> approve(
        @PathVariable CaseId id,
        @Valid @RequestBody ApproveCaseRequest request,
        CurrentUser user) {

    ApprovalResponse response = approveCaseUseCase.approve(
            new ApproveCaseCommand(id, request.comment()),
            user.toCommandContext());

    return ResponseEntity.ok(response);
}
```

This controller maps HTTP to application command. That is its job.

---

## 29. API Boundary Architecture

For large Spring MVC application, avoid this:

```text
Controller -> Repository -> Entity -> Response
```

Prefer:

```text
Controller
  -> Request DTO
  -> Command/Query object
  -> Application service/use case
  -> Domain/persistence/integration
  -> Response DTO
```

Example:

```java
@RestController
@RequestMapping(path = "/api/v1/cases", produces = MediaType.APPLICATION_JSON_VALUE)
class CaseController {

    private final ApproveCaseUseCase approveCase;

    CaseController(ApproveCaseUseCase approveCase) {
        this.approveCase = approveCase;
    }

    @PostMapping(path = "/{caseId}/approval", consumes = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<ApproveCaseResponse> approve(
            @PathVariable CaseId caseId,
            @Valid @RequestBody ApproveCaseRequest request,
            CurrentUser user) {

        ApproveCaseCommand command = new ApproveCaseCommand(
                caseId,
                request.comment(),
                request.decision());

        ApproveCaseResult result = approveCase.handle(command, user.toActor());

        return ResponseEntity.ok(ApproveCaseResponse.from(result));
    }
}
```

This gives clear boundaries:

```text
HTTP DTO != application command != domain entity != persistence entity
```

In small apps, this may feel verbose. In regulatory/case-management systems, this separation pays back heavily.

---

## 30. WebMvcConfigurer

`WebMvcConfigurer` is the common extension point for MVC configuration.

Methods include:

```text
addArgumentResolvers
addReturnValueHandlers
configureMessageConverters
extendMessageConverters
addFormatters
addInterceptors
addCorsMappings
addResourceHandlers
configureAsyncSupport
configureContentNegotiation
configurePathMatch
```

### 30.1 `configureMessageConverters` vs `extendMessageConverters`

Important difference:

```text
configureMessageConverters:
  replaces/defaults may be disabled depending usage.

extendMessageConverters:
  modify existing configured list.
```

For Boot apps, prefer `extendMessageConverters` unless you intentionally want to replace defaults.

### 30.2 Avoid `@EnableWebMvc` Accidentally

In Spring Boot, adding `@EnableWebMvc` usually disables Boot MVC auto-configuration behavior and switches to manual MVC setup.

This can break:

- message converters,
- static resources,
- formatters,
- error handling,
- content negotiation,
- argument resolvers,
- CORS defaults.

Rule:

```text
In Spring Boot applications, do not add @EnableWebMvc unless you intentionally want full MVC control.
```

---

## 31. Spring Boot MVC Auto-Configuration

Spring Boot configures MVC based on classpath, properties, and beans.

Boot commonly configures:

- embedded servlet container,
- `DispatcherServlet`,
- JSON converter,
- validation,
- static resources,
- error handling,
- formatting,
- content negotiation,
- multipart,
- path matching,
- Problem Details behavior depending version/config,
- actuator web endpoint integration.

This is why a minimal Boot controller works.

But in production, you need to understand which part is Boot convention and which part is Spring Framework MVC.

Diagnostic question:

```text
Is this behavior coming from Spring MVC core, Spring Boot auto-config, Spring Security, custom WebMvcConfigurer, or servlet container?
```

That question often shortens debugging time dramatically.

---

## 32. Security Filter Chain Interaction

Spring Security usually operates as Servlet filters before MVC.

Simplified:

```text
Client
  -> Security filters
  -> DispatcherServlet
  -> HandlerMapping
  -> Controller
```

Consequences:

1. Authentication usually happens before MVC handler invocation.
2. Some security exceptions occur before `@ControllerAdvice`.
3. CORS preflight may be handled before controller.
4. Method security happens later through AOP proxy.
5. MVC interceptor is not a replacement for security filter chain.

If an exception occurs in filter chain, your MVC exception handler may not catch it.

That is why Spring Security has its own:

```text
AuthenticationEntryPoint
AccessDeniedHandler
```

---

## 33. Transaction Boundary and MVC

Technically, you can put `@Transactional` on controller method.

But generally avoid it.

Why?

Controller is transport boundary. Transaction belongs to application service/use case boundary.

Bad:

```java
@PostMapping("/{id}/approve")
@Transactional
void approve(@PathVariable Long id) {
    ...
}
```

Better:

```java
@PostMapping("/{id}/approve")
void approve(@PathVariable Long id) {
    approveCaseUseCase.approve(id);
}

@Service
class ApproveCaseUseCase {

    @Transactional
    public void approve(Long id) {
        ...
    }
}
```

Reason:

- transaction should not include HTTP serialization,
- controller concerns should remain transport-level,
- service can be reused from batch/message/job,
- testing transaction boundary easier,
- proxy semantics clearer.

---

## 34. Observability in MVC Runtime

Spring MVC request lifecycle is an important observability boundary.

Track:

- request method,
- route pattern, not raw path,
- status,
- exception class,
- duration,
- request size,
- response size,
- authenticated principal category, not PII,
- tenant id only if cardinality controlled,
- correlation id,
- trace id.

### 34.1 Route Pattern vs Raw URL

Metric tag should be:

```text
/api/v1/cases/{caseId}
```

Not:

```text
/api/v1/cases/CASE-2026-000001
/api/v1/cases/CASE-2026-000002
/api/v1/cases/CASE-2026-000003
```

Raw path causes high-cardinality metric explosion.

### 34.2 Interceptor vs Observation

For simple audit, interceptor may be enough.

For metrics/tracing, prefer Spring Boot/Micrometer observation integration where possible.

Custom instrumentation should follow existing observation semantics, not create parallel inconsistent metrics.

---

## 35. Testing Spring MVC Runtime

### 35.1 `@WebMvcTest`

Good for controller slice:

```java
@WebMvcTest(CaseController.class)
class CaseControllerTest {

    @Autowired
    MockMvc mockMvc;

    @MockitoBean
    ApproveCaseUseCase approveCase;

    @Test
    void approveCase() throws Exception {
        mockMvc.perform(post("/api/v1/cases/CASE-0001/approval")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"decision":"APPROVE","comment":"ok"}
                                """))
                .andExpect(status().isOk());
    }
}
```

Test scope:

- mapping,
- validation,
- serialization,
- exception handler,
- argument resolver if included,
- security if configured in test.

### 35.2 `MockMvc`

`MockMvc` tests MVC pipeline without real server socket.

Good for:

- controller contract,
- validation error,
- exception mapping,
- content negotiation,
- headers,
- status.

### 35.3 Full Integration Test

Use `@SpringBootTest(webEnvironment = RANDOM_PORT)` when you need:

- real embedded server,
- actual network stack,
- real filters/security,
- serialization over HTTP client,
- container behavior closer to production.

### 35.4 Testing Custom Argument Resolver

Test both:

1. resolver unit test;
2. MVC integration test showing controller receives resolved argument.

### 35.5 Test Failure Smell

If every MVC test uses full `@SpringBootTest`, suite will become slow.

If every test mocks MVC manually, you may miss binding/converter/validation issues.

Balance:

```text
Many @WebMvcTest slice tests
Some full integration HTTP tests
Few end-to-end system tests
```

---

## 36. Common Production Failure Scenarios

### 36.1 Endpoint Returns 404

Checklist:

1. Is application started successfully?
2. Is controller bean registered?
3. Is package scanned?
4. Is profile/condition disabling controller?
5. Is servlet context path configured?
6. Is servlet path configured?
7. Is gateway stripping prefix?
8. Is method/path exactly correct?
9. Is trailing slash relevant?
10. Is API version prefix correct?

### 36.2 Endpoint Returns 415

Checklist:

1. Is `Content-Type` set?
2. Does endpoint declare `consumes`?
3. Is JSON converter available?
4. Is body actually JSON?
5. Is multipart endpoint receiving multipart?
6. Is client sending charset/media type variant?

### 36.3 Endpoint Returns 406

Checklist:

1. What `Accept` header does client send?
2. Does endpoint declare `produces`?
3. Is converter able to write selected type?
4. Is XML requested accidentally?
5. Does browser send broad Accept header causing unexpected negotiation?

### 36.4 Validation Not Triggered

Checklist:

1. Is `@Valid`/`@Validated` present?
2. Is validation dependency present?
3. Is DTO annotated correctly?
4. Are nested fields annotated with `@Valid`?
5. Is parameter using `BindingResult` and swallowing error?
6. Is method validation enabled for non-body params?

### 36.5 `@ControllerAdvice` Not Handling Error

Checklist:

1. Did exception occur inside MVC or before MVC in filter?
2. Is advice in scanned package?
3. Does advice target correct package/annotation?
4. Is exception wrapped?
5. Is response already committed?
6. Is another resolver handling it first?

### 36.6 Request Body Empty

Checklist:

1. Did filter read input stream?
2. Is request wrapper correct?
3. Is content length zero?
4. Is reverse proxy stripping body?
5. Is multipart configured?
6. Is client sending body with GET unexpectedly?

---

## 37. Design Heuristics for Top-Tier Spring MVC Engineering

### 37.1 Treat Controller as Adapter

Controller adapts HTTP to application use case.

It should not become the use case.

### 37.2 Be Explicit with API Contract

Prefer explicit:

```java
@RequestMapping(
    path = "/api/v1/cases",
    produces = MediaType.APPLICATION_JSON_VALUE
)
```

and command endpoints with:

```java
consumes = MediaType.APPLICATION_JSON_VALUE
```

### 37.3 Centralize Error Semantics

Use consistent `@RestControllerAdvice` and error catalog.

Do not let each controller invent its own error response shape.

### 37.4 Do Not Leak Entity

Never expose persistence entity directly as request or response contract.

### 37.5 Prefer Custom Argument Resolver for Cross-Cutting Request Context

For current user, tenant, correlation, client metadata, resolver can keep controllers clean.

But keep resolver lightweight.

### 37.6 Know Where Errors Happen

Errors before `DispatcherServlet` are not MVC errors.

Errors inside controller pipeline are MVC errors.

Errors after response commit are operational/logging concerns, not normal API errors.

### 37.7 Separate API Compatibility from Internal Model

API DTO is long-lived public/semi-public contract.
Internal command/domain model can evolve differently.

### 37.8 Make Async Explicit

Async MVC is not a magic performance switch.

Define:

- timeout,
- executor,
- context propagation,
- cancellation behavior,
- memory cleanup,
- error handling.

### 37.9 Avoid Global Magic Without Exclusion Model

Global response wrappers, global interceptors, global converters, and global exception handlers must have precise inclusion/exclusion rules.

### 37.10 Test the Pipeline, Not Only the Method

A controller unit test that calls method directly does not test:

- routing,
- binding,
- conversion,
- validation,
- serialization,
- exception resolution.

Use `MockMvc`/slice tests for MVC contract.

---

## 38. Practical Architecture Pattern

A strong Spring MVC application often uses this package structure:

```text
com.example.caseapp
  casecore
    application
      ApproveCaseUseCase.java
      SearchCaseQueryService.java
    domain
      Case.java
      CaseStatus.java
      CasePolicy.java
    persistence
      CaseRepository.java
      JpaCaseRepository.java
    web
      CaseController.java
      dto
        ApproveCaseRequest.java
        CaseResponse.java
      mapper
        CaseWebMapper.java
  platform
    web
      ApiExceptionHandler.java
      CurrentUserArgumentResolver.java
      CorrelationIdFilter.java
      ApiErrorResponse.java
      WebMvcConfig.java
```

Controller depends inward:

```text
web -> application -> domain
```

Platform web components support many modules:

```text
platform.web -> reusable MVC infrastructure
```

Avoid:

```text
controller -> entity manager
controller -> repository directly for commands
controller -> external API client directly
controller -> static security context everywhere
```

---

## 39. Mini Case Study: Regulatory Case Approval Endpoint

Requirement:

```text
Officer approves a case.
System must validate state, actor permission, optimistic version, comment, audit, and return updated case summary.
```

### 39.1 API Contract

```http
POST /api/v1/cases/{caseId}/approval
Content-Type: application/json
Accept: application/json
X-Correlation-Id: 2d77f...
```

Body:

```json
{
  "decision": "APPROVE",
  "comment": "Documents verified.",
  "expectedVersion": 12
}
```

### 39.2 Controller

```java
@RestController
@RequestMapping(path = "/api/v1/cases", produces = MediaType.APPLICATION_JSON_VALUE)
final class CaseApprovalController {

    private final ApproveCaseUseCase approveCase;

    CaseApprovalController(ApproveCaseUseCase approveCase) {
        this.approveCase = approveCase;
    }

    @PostMapping(path = "/{caseId}/approval", consumes = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<CaseApprovalResponse> approve(
            @PathVariable CaseId caseId,
            @Valid @RequestBody ApproveCaseRequest request,
            CurrentActor actor,
            CorrelationContext correlation) {

        ApproveCaseCommand command = new ApproveCaseCommand(
                caseId,
                request.decision(),
                request.comment(),
                request.expectedVersion());

        ApproveCaseResult result = approveCase.handle(command, actor, correlation);

        return ResponseEntity.ok(CaseApprovalResponse.from(result));
    }
}
```

### 39.3 What MVC Handles

```text
@PathVariable CaseId
  -> Converter<String, CaseId>

@Valid @RequestBody ApproveCaseRequest
  -> JSON converter
  -> Bean Validation

CurrentActor
  -> custom argument resolver

CorrelationContext
  -> custom argument resolver/filter

ResponseEntity<CaseApprovalResponse>
  -> return value handler
  -> JSON converter
```

### 39.4 What Application Service Handles

```text
- transaction boundary
- load case
- check current state
- check actor permission/policy
- check expected version
- perform transition
- persist
- publish domain event after commit
- audit application action
```

This separation makes the system easier to test, audit, and evolve.

---

## 40. Checklist Review untuk Pull Request Spring MVC

Gunakan checklist ini saat review PR controller/API.

### Mapping

- [ ] Path jelas dan tidak ambiguous.
- [ ] HTTP method sesuai semantics.
- [ ] `consumes` eksplisit untuk body endpoint.
- [ ] `produces` eksplisit untuk API JSON.
- [ ] Versioning konsisten.

### Request Boundary

- [ ] Request DTO bukan entity.
- [ ] Validation ada di boundary.
- [ ] Nested validation tidak lupa `@Valid`.
- [ ] Type conversion jelas.
- [ ] File upload punya limit dan validation.

### Application Boundary

- [ ] Controller tidak berisi business workflow kompleks.
- [ ] Transaction ada di service/use case, bukan controller.
- [ ] Authorization tidak tersembunyi random di controller.
- [ ] Command/query object jelas.

### Response Boundary

- [ ] Response DTO bukan entity.
- [ ] Status code sesuai.
- [ ] Header penting diset jika perlu.
- [ ] Error model konsisten.

### Runtime

- [ ] Custom argument resolver ringan.
- [ ] Interceptor tidak menggantikan security.
- [ ] Async endpoint punya timeout/executor/context cleanup.
- [ ] Streaming tidak membuka transaction terlalu lama.
- [ ] Observability menggunakan route pattern, bukan raw path.

### Test

- [ ] MVC slice test untuk mapping/validation/error.
- [ ] Full integration test untuk critical endpoint.
- [ ] Negative cases diuji.
- [ ] Content negotiation diuji jika API publik/internal luas.

---

## 41. Anti-Pattern yang Harus Dihindari

### 41.1 God Controller

Controller berisi:

- query database,
- update entity,
- remote call,
- authorization,
- audit,
- state transition,
- response mapping.

Ini membuat endpoint sulit diuji dan sulit dipindahkan ke batch/message/job.

### 41.2 Entity as Request/Response

Entity persistence menjadi external API contract.

Akibat:

- field internal bocor,
- lazy loading error,
- serialization recursion,
- security risk,
- API sulit evolve.

### 41.3 Catch All Exception in Controller

```java
try {
    ...
} catch (Exception e) {
    return ResponseEntity.status(500).body(...);
}
```

Ini merusak global error semantics.

### 41.4 Raw Map Everywhere

```java
@PostMapping
Map<String, Object> create(@RequestBody Map<String, Object> body) { ... }
```

Kadang berguna untuk dynamic payload, tapi buruk sebagai default karena kehilangan:

- type safety,
- validation,
- documentation,
- refactoring support,
- contract clarity.

### 41.5 Interceptor for Everything

Interceptor dipakai untuk business logic, security, transaction, remote calls.

Ini membuat pipeline sulit diprediksi.

### 41.6 Global Response Wrapper Tanpa Exclusion

Semua response dibungkus, termasuk:

- file download,
- actuator,
- error response,
- streaming,
- string response.

Hasilnya contract rusak.

### 41.7 Async tanpa Execution Model

Endpoint dibuat async, tetapi:

- executor default tidak diketahui,
- timeout tidak diset,
- context tidak propagated,
- cancellation tidak dipikirkan,
- result registry leak.

---

## 42. Spring MVC vs WebFlux vs Virtual Threads

High-level decision:

| Model | Cocok untuk | Risiko |
|---|---|---|
| Spring MVC classic | CRUD/API enterprise, JDBC, blocking integration | thread pool bottleneck jika call lambat banyak |
| Spring MVC + virtual threads | banyak blocking I/O, ingin imperative code | DB/HTTP pool tetap bottleneck, ThreadLocal/context harus dipahami |
| WebFlux | non-blocking stack end-to-end, streaming, high concurrency I/O | kompleksitas reactive, blocking call berbahaya |
| Async MVC | long wait tertentu, deferred result, SSE ringan | bukan full non-blocking, executor/context complexity |

Rule praktis:

```text
Jika stack Anda JDBC + blocking HTTP + tim lebih kuat imperative,
Spring MVC modern + timeout + pool sizing + mungkin virtual threads sering lebih masuk akal.

Jika workload Anda butuh non-blocking end-to-end dan library mendukung reactive,
WebFlux bisa tepat.
```

Tidak ada pilihan universal.

---

## 43. Ringkasan Mental Model

Spring MVC adalah pipeline:

```text
Filter
  -> DispatcherServlet
  -> HandlerMapping
  -> HandlerExecutionChain
  -> HandlerInterceptor
  -> HandlerAdapter
  -> ArgumentResolver
  -> Controller method
  -> ReturnValueHandler
  -> HttpMessageConverter / ViewResolver
  -> ExceptionResolver if failure
```

Controller method yang terlihat sederhana sebenarnya didukung oleh banyak adapter.

Contoh:

```java
@PostMapping("/{id}/approval")
ResponseEntity<Response> approve(
        @PathVariable CaseId id,
        @Valid @RequestBody Request request,
        CurrentUser user) {
    ...
}
```

Di baliknya:

```text
path variable conversion
JSON deserialization
validation
custom argument resolution
method invocation
return value handling
JSON serialization
exception mapping
interceptor lifecycle
security filter chain
observability instrumentation
```

Engineer yang kuat tidak hanya tahu annotation-nya. Ia tahu runtime path-nya.

---

## 44. Latihan

### Latihan 1 — Trace Request Lifecycle

Ambil satu endpoint di aplikasi Spring Anda.

Tuliskan:

```text
URL:
HTTP method:
Controller method:
HandlerMapping condition:
Argument resolvers involved:
Message converter involved:
Return value handler:
Exception handler:
Filters before MVC:
Interceptors:
Transaction boundary:
Security boundary:
```

### Latihan 2 — Custom Argument Resolver

Buat `CurrentActorArgumentResolver` yang membaca actor dari security principal dan menghasilkan object:

```java
record CurrentActor(String userId, String tenantId, Set<String> roles) {}
```

Pastikan:

- resolver ringan,
- tidak query database,
- gagal eksplisit jika principal invalid,
- ada MVC slice test.

### Latihan 3 — Global Error Model

Buat `@RestControllerAdvice` yang menangani:

- validation error,
- malformed JSON,
- not found,
- conflict,
- unauthorized/forbidden boundary jika masuk MVC,
- unexpected error.

Gunakan format Problem Details atau error envelope konsisten.

### Latihan 4 — Diagnose 415/406

Buat endpoint dengan `consumes` dan `produces` eksplisit.

Uji kombinasi:

```text
Content-Type missing
Content-Type text/plain
Accept application/xml
Accept application/json
Malformed JSON
```

Catat exception dan status code yang muncul.

### Latihan 5 — Async MVC Failure

Buat endpoint `DeferredResult` dengan timeout.

Uji:

- result selesai normal,
- timeout,
- error result,
- double completion,
- client disconnect jika memungkinkan.

---

## 45. Koneksi ke Part Berikutnya

Part berikutnya adalah:

```text
13-rest-api-engineering-with-spring.md
```

Part 12 ini membahas runtime internal Spring MVC.

Part 13 akan naik satu level ke desain REST API production-grade:

- resource design,
- DTO boundary,
- envelope,
- Problem Details,
- API versioning,
- pagination/filtering/sorting,
- idempotency key,
- conditional request,
- optimistic concurrency,
- partial update,
- file transfer,
- compatibility testing,
- API governance.

Jika Part 12 menjawab:

```text
Bagaimana Spring MVC menjalankan request?
```

Part 13 menjawab:

```text
Bagaimana kita mendesain API di atas Spring MVC agar stabil, evolvable, dan production-grade?
```

---

## 46. Status Seri

```text
Part saat ini : 12 dari 35
Status        : belum selesai
Berikutnya    : 13-rest-api-engineering-with-spring.md
```



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./11-spring-data-integration-model.md">⬅️ Part 11 — Spring Data Integration Model Without Repeating JPA</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./13-rest-api-engineering-with-spring.md">Part 13 — REST API Engineering with Spring MVC and Boot ➡️</a>
</div>
