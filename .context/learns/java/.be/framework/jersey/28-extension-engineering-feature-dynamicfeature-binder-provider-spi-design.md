# Part 28 — Extension Engineering: Feature, DynamicFeature, Binder, Provider, and SPI Design

Series: `learn-java-jersey-runtime-resource-client-extension-engineering`  
Status: Part 28 dari 32  
Target pembaca: engineer yang sudah memahami Java, Jakarta REST/JAX-RS, Jersey runtime, provider pipeline, filter/interceptor, HK2 injection, client runtime, observability, deployment, dan testing.  
Scope Java: Java 8 sampai Java 25  
Scope Jersey: Jersey 2.x (`javax.ws.rs`), Jersey 3.x (`jakarta.ws.rs`, Jakarta EE 9/10), Jersey 4.x (`jakarta.ws.rs`, Jakarta REST 4.0/Jakarta EE 11)

---

## 0. Tujuan Part Ini

Part ini membahas cara membuat **extension Jersey** yang benar-benar bisa dipakai di production dan bisa dipelihara sebagai reusable internal platform component.

Kalau pada part sebelumnya kita memakai filter, interceptor, provider, exception mapper, binder, client, observability, dan security integration sebagai bagian aplikasi, pada part ini kita naik satu level:

> Bagaimana mengubah pattern yang berulang menjadi extension Jersey yang rapi, eksplisit, testable, versioned, dan aman dipakai banyak service.

Contoh extension yang realistis:

- `CorrelationIdFeature`
- `ProblemDetailsFeature`
- `AuditFeature`
- `RequestLoggingFeature`
- `IdempotencyFeature`
- `TenantContextFeature`
- `SecurityPrincipalFeature`
- `JacksonPlatformFeature`
- `OutboundClientFeature`
- `ValidationErrorFeature`
- `RateLimitFeature`
- `ApiVersionFeature`
- `StandardHeadersFeature`
- `EntityMaskingFeature`

Top 1% engineer tidak hanya tahu cara register filter. Mereka paham:

- kapan extension perlu dibuat,
- boundary extension harus di mana,
- dependency apa yang boleh dibawa,
- apa yang harus configurable,
- bagaimana ordering pipeline dikontrol,
- bagaimana extension diuji,
- bagaimana menjaga compatibility antar Jersey 2/3/4,
- dan bagaimana mencegah extension menjadi “magic framework” yang sulit didebug.

---

## 1. Extension Engineering Mental Model

### 1.1 Extension bukan sekadar util class

Dalam Jersey, extension adalah cara untuk menambahkan behavior ke runtime pipeline.

Extension bisa bekerja di beberapa titik:

```text
Startup / bootstrap
  ├─ Feature
  ├─ ResourceConfig registration
  ├─ Auto-discoverable component
  └─ HK2 Binder

Request matching
  ├─ Pre-matching ContainerRequestFilter
  └─ DynamicFeature registration decision

Resource invocation boundary
  ├─ Post-matching ContainerRequestFilter
  ├─ SecurityContext override
  ├─ Request-scoped context
  └─ Name-bound behavior

Entity body pipeline
  ├─ MessageBodyReader
  ├─ ReaderInterceptor
  ├─ MessageBodyWriter
  └─ WriterInterceptor

Error pipeline
  ├─ ExceptionMapper
  └─ error response provider

Response pipeline
  ├─ ContainerResponseFilter
  ├─ headers
  ├─ audit event
  └─ metrics/tracing closeout

Client pipeline
  ├─ ClientRequestFilter
  ├─ ClientResponseFilter
  ├─ connector config
  ├─ provider registration
  └─ outbound resilience wrapper
```

Maka extension bukan hanya class tambahan. Extension adalah **kontrak perubahan runtime behavior**.

### 1.2 Pertanyaan utama sebelum membuat extension

Sebelum membuat extension, tanyakan:

1. Apakah behavior ini dipakai di banyak endpoint/service?
2. Apakah behavior ini cross-cutting?
3. Apakah behavior ini harus konsisten secara organisasi?
4. Apakah behavior ini harus diuji sekali dan dipakai berulang?
5. Apakah behavior ini perlu ordering dalam pipeline?
6. Apakah behavior ini butuh configuration?
7. Apakah behavior ini punya failure mode yang harus distandarisasi?
8. Apakah behavior ini perlu opt-in, opt-out, atau global?

Jika jawabannya banyak “ya”, extension layak dibuat.

Jika behavior hanya milik satu endpoint, jangan buru-buru membuat extension. Resource/service biasa lebih mudah dipahami.

---

## 2. Taxonomy Extension di Jersey

### 2.1 Level extension

```text
Application-level extension
  Berlaku untuk seluruh aplikasi.
  Contoh: correlation ID, standard error mapper, JSON provider.

Resource-level extension
  Berlaku untuk resource class tertentu.
  Contoh: @Audited pada resource tertentu.

Method-level extension
  Berlaku untuk operation tertentu.
  Contoh: @Idempotent hanya untuk POST submit.

Entity-level extension
  Berlaku saat membaca/menulis entity.
  Contoh: payload encryption/decryption, compression, body hashing.

Client-level extension
  Berlaku untuk outbound HTTP calls.
  Contoh: retry filter, correlation propagation, auth token injection.

DI-level extension
  Menyediakan dependency/context ke runtime.
  Contoh: TenantContextFactory, Clock binding, RequestContext binding.
```

### 2.2 Spec API vs Jersey-specific API

Ada dua jenis extension point:

```text
Jakarta REST standard extension point
  ├─ Feature
  ├─ DynamicFeature
  ├─ ContainerRequestFilter
  ├─ ContainerResponseFilter
  ├─ ReaderInterceptor
  ├─ WriterInterceptor
  ├─ MessageBodyReader
  ├─ MessageBodyWriter
  ├─ ExceptionMapper
  ├─ ParamConverterProvider
  └─ ContextResolver

Jersey-specific extension point
  ├─ ResourceConfig
  ├─ ServerProperties
  ├─ ClientProperties
  ├─ HK2 AbstractBinder
  ├─ InjectionResolver patterns
  ├─ AutoDiscoverable
  ├─ ExtendedPropertiesDelegate-like runtime details
  └─ Jersey-specific monitoring/tracing components
```

Rule of thumb:

> Pakai standard Jakarta REST API jika cukup. Pakai Jersey-specific API hanya saat perlu behavior yang memang tidak distandarkan.

Kenapa?

- Standard API lebih portable.
- Jersey-specific API lebih powerful tetapi mengikat ke Jersey.
- Internal platform library boleh menggunakan Jersey-specific API, tetapi harus mengakui coupling tersebut secara eksplisit.

---

## 3. `Feature`: Extension Entry Point Paling Umum

### 3.1 Apa itu `Feature`?

`Feature` adalah komponen yang bisa meregistrasikan provider, filter, interceptor, mapper, binder, property, atau component lain ke Jersey/Jakarta REST runtime.

Mental model:

```text
Feature = startup-time module installer
```

Ia tidak memproses request secara langsung. Ia memasang komponen yang akan memproses request.

### 3.2 Bentuk dasar Feature

```java
import jakarta.ws.rs.core.Feature;
import jakarta.ws.rs.core.FeatureContext;

public final class CorrelationIdFeature implements Feature {
    @Override
    public boolean configure(FeatureContext context) {
        context.register(CorrelationIdRequestFilter.class);
        context.register(CorrelationIdResponseFilter.class);
        return true;
    }
}
```

Lalu di `ResourceConfig`:

```java
public final class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        register(new CorrelationIdFeature());
    }
}
```

Atau:

```java
register(CorrelationIdFeature.class);
```

### 3.3 Return value `true/false`

`Feature.configure()` mengembalikan boolean.

Maknanya:

- `true`: feature berhasil dikonfigurasi.
- `false`: feature tidak aktif / tidak dikonfigurasi.

Gunakan `false` untuk conditional feature yang secara eksplisit disabled.

Contoh:

```java
public final class AuditFeature implements Feature {
    private final boolean enabled;

    public AuditFeature(boolean enabled) {
        this.enabled = enabled;
    }

    @Override
    public boolean configure(FeatureContext context) {
        if (!enabled) {
            return false;
        }
        context.register(AuditRequestFilter.class);
        context.register(AuditResponseFilter.class);
        context.register(AuditExceptionMapper.class);
        return true;
    }
}
```

Namun hati-hati: jika feature disabled secara diam-diam, engineer bisa salah asumsi. Untuk feature yang wajib production, lebih baik fail fast saat config tidak valid.

---

## 4. Designing a Feature as a Module

### 4.1 Feature yang baik memiliki boundary jelas

Contoh buruk:

```java
public final class EnterpriseFeature implements Feature {
    @Override
    public boolean configure(FeatureContext context) {
        context.register(AuthFilter.class);
        context.register(AuditFilter.class);
        context.register(JsonMapperProvider.class);
        context.register(DatabaseTransactionFilter.class);
        context.register(MetricsFilter.class);
        context.register(CacheFilter.class);
        return true;
    }
}
```

Masalah:

- terlalu besar,
- sulit disable sebagian,
- ownership kabur,
- ordering sulit dilacak,
- testing melebar,
- perubahan kecil berisiko besar.

Lebih baik:

```text
PlatformJerseyFeature
  ├─ CorrelationFeature
  ├─ ErrorContractFeature
  ├─ JsonFeature
  ├─ SecurityContextFeature
  ├─ ObservabilityFeature
  └─ AuditFeature
```

Dengan aggregator feature opsional:

```java
public final class PlatformJerseyFeature implements Feature {
    private final PlatformJerseyOptions options;

    public PlatformJerseyFeature(PlatformJerseyOptions options) {
        this.options = options;
    }

    @Override
    public boolean configure(FeatureContext context) {
        context.register(new CorrelationIdFeature(options.correlation()));
        context.register(new ErrorContractFeature(options.errorContract()));
        context.register(new JsonPlatformFeature(options.json()));
        context.register(new ObservabilityFeature(options.observability()));
        return true;
    }
}
```

### 4.2 Feature harus punya single responsibility

Contoh boundary yang sehat:

```text
CorrelationIdFeature
  Tanggung jawab:
    - resolve incoming correlation id
    - generate jika absent
    - simpan di request context/MDC
    - expose ke response header
    - propagate ke client filter jika client extension juga dipakai

  Bukan tanggung jawab:
    - audit business action
    - authorize user
    - serialize JSON
    - map validation error
```

Feature yang terlalu luas akan menjadi mini-framework tersembunyi.

---

## 5. `DynamicFeature`: Conditional Registration per Resource Method

### 5.1 Apa itu `DynamicFeature`?

`DynamicFeature` memungkinkan registration filter/interceptor berdasarkan resource method/class saat runtime model dibangun.

Mental model:

```text
DynamicFeature = startup-time decision based on resource method metadata
```

Ia bukan dipanggil untuk setiap request. Ia dipakai saat Jersey membangun resource model.

### 5.2 Use case umum

- Register audit filter hanya untuk method dengan `@Audited`.
- Register idempotency filter hanya untuk method dengan `@Idempotent`.
- Register rate limit filter berdasarkan annotation `@RateLimited`.
- Register masking writer interceptor untuk endpoint tertentu.
- Register permission check filter berdasarkan annotation domain-specific.

### 5.3 Contoh custom annotation

```java
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

@Retention(RetentionPolicy.RUNTIME)
@Target({ElementType.TYPE, ElementType.METHOD})
public @interface Audited {
    String action();
    String objectType() default "";
}
```

### 5.4 Contoh DynamicFeature

```java
import jakarta.ws.rs.container.DynamicFeature;
import jakarta.ws.rs.container.ResourceInfo;
import jakarta.ws.rs.core.FeatureContext;

public final class AuditDynamicFeature implements DynamicFeature {
    @Override
    public void configure(ResourceInfo resourceInfo, FeatureContext context) {
        Audited methodAnnotation = resourceInfo.getResourceMethod()
                .getAnnotation(Audited.class);

        Audited classAnnotation = resourceInfo.getResourceClass()
                .getAnnotation(Audited.class);

        Audited effective = methodAnnotation != null ? methodAnnotation : classAnnotation;

        if (effective != null) {
            context.register(new AuditFilter(effective.action(), effective.objectType()));
        }
    }
}
```

### 5.5 Kenapa instance registration bisa berguna?

Pada contoh di atas, filter diberi parameter dari annotation.

```java
context.register(new AuditFilter(effective.action(), effective.objectType()));
```

Ini berguna, tetapi ada konsekuensi:

- instance filter bisa dibuat per registration,
- state harus immutable,
- jangan simpan request state di field,
- jangan menyimpan object yang tidak thread-safe kecuali aman dipakai bersamaan.

Lebih aman:

```java
public final class AuditFilter implements ContainerRequestFilter {
    private final String action;
    private final String objectType;

    public AuditFilter(String action, String objectType) {
        this.action = action;
        this.objectType = objectType;
    }

    @Override
    public void filter(ContainerRequestContext requestContext) {
        requestContext.setProperty("audit.action", action);
        requestContext.setProperty("audit.objectType", objectType);
    }
}
```

Immutable configuration boleh disimpan di field. Request-specific mutable state tidak boleh.

---

## 6. Name Binding vs DynamicFeature

### 6.1 Name Binding

Name binding memakai annotation dengan meta-annotation `@NameBinding`.

Contoh:

```java
import jakarta.ws.rs.NameBinding;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import java.lang.annotation.ElementType;

@NameBinding
@Retention(RetentionPolicy.RUNTIME)
@Target({ElementType.TYPE, ElementType.METHOD})
public @interface Logged {
}
```

Filter:

```java
@Logged
public final class LoggingFilter implements ContainerRequestFilter {
    @Override
    public void filter(ContainerRequestContext requestContext) {
        // log request metadata
    }
}
```

Resource:

```java
@Path("/cases")
public final class CaseResource {
    @GET
    @Logged
    public List<CaseSummary> listCases() {
        return List.of();
    }
}
```

Registration:

```java
register(LoggingFilter.class);
```

Jersey/Jakarta REST akan menerapkan filter hanya pada resource/method yang punya binding annotation.

### 6.2 Kapan pakai Name Binding?

Pakai name binding jika:

- behavior hanya perlu on/off,
- annotation tidak butuh parameter kompleks,
- filter/interceptor tidak butuh konfigurasi dari annotation,
- semantic sederhana.

Contoh:

```java
@Logged
@Compressed
@Masked
```

### 6.3 Kapan pakai DynamicFeature?

Pakai `DynamicFeature` jika:

- annotation punya parameter,
- perlu inspect method/class metadata,
- perlu membuat filter berbeda per method,
- perlu conditional registration berdasarkan HTTP method, path, return type, atau annotation kombinasi,
- perlu menerapkan beberapa component sekaligus.

Contoh:

```java
@RateLimited(limit = 50, windowSeconds = 60)
@Idempotent(scope = "payment-submit")
@Audited(action = "APPROVE_CASE", objectType = "CASE")
```

### 6.4 Perbandingan

| Aspek | Name Binding | DynamicFeature |
|---|---|---|
| Kompleksitas | rendah | sedang-tinggi |
| Annotation parameter | terbatas untuk filter statis | sangat fleksibel |
| Registration | register filter/interceptor | register dynamic feature |
| Timing | resource method binding | resource model build time |
| Cocok untuk | on/off behavior | metadata-driven behavior |
| Risiko | terlalu banyak annotation marker | terlalu banyak logic tersembunyi |

---

## 7. Custom Annotation Design

### 7.1 Annotation adalah public API

Jika extension dipakai banyak service, annotation menjadi API. Jangan desain sembarangan.

Contoh buruk:

```java
public @interface DoStuff {
    String value();
}
```

Masalah:

- nama tidak menjelaskan semantic,
- `value` tidak jelas,
- tidak ada default defensible,
- sulit dipakai audit/review.

Contoh lebih baik:

```java
@Retention(RetentionPolicy.RUNTIME)
@Target({ElementType.METHOD})
public @interface IdempotentOperation {
    String operation();
    IdempotencyScope scope() default IdempotencyScope.USER;
    long ttlSeconds() default 86_400;
}
```

### 7.2 Prinsip annotation design

1. Nama harus menjelaskan behavior.
2. Field harus semantic, bukan technical leak.
3. Default harus aman.
4. Jangan expose class internal implementation.
5. Hindari optional yang membuat behavior ambigu.
6. Document failure behavior.
7. Document interaction dengan annotation lain.
8. Jangan terlalu banyak parameter.

### 7.3 Annotation composition

Kadang satu endpoint punya banyak policy:

```java
@POST
@Path("/{id}/approve")
@Authenticated
@RequiresPermission("case.approve")
@Audited(action = "APPROVE_CASE", objectType = "CASE")
@IdempotentOperation(operation = "approve-case")
public Response approve(@PathParam("id") String id, ApproveRequest request) {
    ...
}
```

Ini eksplisit, tetapi bisa bising.

Alternatif:

```java
@CaseCommand(
    permission = "case.approve",
    auditAction = "APPROVE_CASE",
    idempotent = true
)
```

Namun hati-hati: composite annotation bisa menyembunyikan behavior. Untuk system regulatory, eksplisit sering lebih defendable.

---

## 8. Building a Production `CorrelationIdFeature`

### 8.1 Requirement

Kita ingin extension yang:

- membaca `X-Correlation-Id` dari request,
- generate ID baru jika absent/invalid,
- menyimpan di request context,
- memasukkan ke MDC logging,
- menambahkan header ke response,
- bisa digunakan oleh downstream client filter,
- tidak membocorkan request state antar thread,
- testable.

### 8.2 Options

```java
public final class CorrelationIdOptions {
    private final String headerName;
    private final int maxLength;
    private final boolean echoResponseHeader;

    public CorrelationIdOptions(String headerName, int maxLength, boolean echoResponseHeader) {
        this.headerName = requireText(headerName, "headerName");
        if (maxLength < 16 || maxLength > 256) {
            throw new IllegalArgumentException("maxLength must be between 16 and 256");
        }
        this.maxLength = maxLength;
        this.echoResponseHeader = echoResponseHeader;
    }

    public static CorrelationIdOptions defaults() {
        return new CorrelationIdOptions("X-Correlation-Id", 128, true);
    }

    public String headerName() {
        return headerName;
    }

    public int maxLength() {
        return maxLength;
    }

    public boolean echoResponseHeader() {
        return echoResponseHeader;
    }

    private static String requireText(String value, String name) {
        if (value == null || value.trim().isEmpty()) {
            throw new IllegalArgumentException(name + " must not be blank");
        }
        return value;
    }
}
```

Java 16+ bisa pakai record:

```java
public record CorrelationIdOptions(
        String headerName,
        int maxLength,
        boolean echoResponseHeader
) {
    public CorrelationIdOptions {
        if (headerName == null || headerName.isBlank()) {
            throw new IllegalArgumentException("headerName must not be blank");
        }
        if (maxLength < 16 || maxLength > 256) {
            throw new IllegalArgumentException("maxLength must be between 16 and 256");
        }
    }

    public static CorrelationIdOptions defaults() {
        return new CorrelationIdOptions("X-Correlation-Id", 128, true);
    }
}
```

Namun jika library harus support Java 8, jangan pakai record di main artifact.

### 8.3 Request filter

```java
import jakarta.annotation.Priority;
import jakarta.ws.rs.Priorities;
import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.container.ContainerRequestFilter;
import java.io.IOException;
import java.util.UUID;

@Priority(Priorities.AUTHENTICATION - 100)
public final class CorrelationIdRequestFilter implements ContainerRequestFilter {
    public static final String PROPERTY = "platform.correlationId";

    private final CorrelationIdOptions options;

    public CorrelationIdRequestFilter(CorrelationIdOptions options) {
        this.options = options;
    }

    @Override
    public void filter(ContainerRequestContext context) throws IOException {
        String incoming = context.getHeaderString(options.headerName());
        String correlationId = normalize(incoming);
        context.setProperty(PROPERTY, correlationId);

        // Integrasi MDC sengaja diabstraksikan agar tidak hard-couple ke SLF4J jika library ingin portable.
        CorrelationMdc.put(correlationId);
    }

    private String normalize(String incoming) {
        if (incoming == null || incoming.isBlank()) {
            return UUID.randomUUID().toString();
        }
        String trimmed = incoming.trim();
        if (trimmed.length() > options.maxLength()) {
            return UUID.randomUUID().toString();
        }
        if (!trimmed.matches("[A-Za-z0-9_.:\\-]+")) {
            return UUID.randomUUID().toString();
        }
        return trimmed;
    }
}
```

Java 8 note: `String.isBlank()` tidak tersedia. Gunakan `trim().isEmpty()`.

### 8.4 Response filter

```java
import jakarta.annotation.Priority;
import jakarta.ws.rs.Priorities;
import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.container.ContainerResponseContext;
import jakarta.ws.rs.container.ContainerResponseFilter;
import java.io.IOException;

@Priority(Priorities.HEADER_DECORATOR)
public final class CorrelationIdResponseFilter implements ContainerResponseFilter {
    private final CorrelationIdOptions options;

    public CorrelationIdResponseFilter(CorrelationIdOptions options) {
        this.options = options;
    }

    @Override
    public void filter(ContainerRequestContext request, ContainerResponseContext response) throws IOException {
        Object value = request.getProperty(CorrelationIdRequestFilter.PROPERTY);
        if (options.echoResponseHeader() && value instanceof String) {
            response.getHeaders().putSingle(options.headerName(), value);
        }
        CorrelationMdc.clear();
    }
}
```

### 8.5 Feature

```java
import jakarta.ws.rs.core.Feature;
import jakarta.ws.rs.core.FeatureContext;

public final class CorrelationIdFeature implements Feature {
    private final CorrelationIdOptions options;

    public CorrelationIdFeature() {
        this(CorrelationIdOptions.defaults());
    }

    public CorrelationIdFeature(CorrelationIdOptions options) {
        this.options = options;
    }

    @Override
    public boolean configure(FeatureContext context) {
        context.register(new CorrelationIdRequestFilter(options));
        context.register(new CorrelationIdResponseFilter(options));
        return true;
    }
}
```

### 8.6 Hidden failure mode: response filter may not clear MDC in all paths

Jika request gagal sangat awal sebelum response filter berjalan, MDC bisa tidak dibersihkan pada thread pooled tertentu.

Solusi lebih robust:

- pastikan clear di response filter,
- tambahkan try/finally pada container/server layer jika memungkinkan,
- gunakan observability framework yang aware request lifecycle,
- hindari menyimpan data request di static mutable state,
- untuk virtual threads, tetap jangan mengandalkan lifecycle thread sebagai lifecycle request.

---

## 9. Building an `IdempotencyFeature`

### 9.1 Why extension?

Idempotency adalah cross-cutting policy untuk command endpoint.

Tanpa extension, setiap resource akan menulis logic berulang:

- baca header `Idempotency-Key`,
- validasi key,
- cek storage,
- lock/in-flight guard,
- replay response,
- simpan response sukses/gagal tertentu,
- handle conflict,
- release lock.

Ini mudah tidak konsisten.

### 9.2 Annotation

```java
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
public @interface IdempotentOperation {
    String operation();
    IdempotencyScope scope() default IdempotencyScope.AUTHENTICATED_SUBJECT;
    int ttlSeconds() default 86_400;
}
```

```java
public enum IdempotencyScope {
    GLOBAL,
    AUTHENTICATED_SUBJECT,
    TENANT,
    TENANT_AND_SUBJECT
}
```

### 9.3 Store contract

```java
public interface IdempotencyStore {
    IdempotencyDecision begin(IdempotencyCommand command);
    void complete(IdempotencyCompletion completion);
    void fail(IdempotencyFailure failure);
}
```

Decision:

```java
public sealed interface IdempotencyDecision permits FirstExecution, ReplayStoredResponse, InProgressConflict {
}
```

Java 8 version:

```java
public interface IdempotencyDecision {
    DecisionType type();
}
```

### 9.4 Filter registration via DynamicFeature

```java
public final class IdempotencyDynamicFeature implements DynamicFeature {
    private final IdempotencyStore store;

    public IdempotencyDynamicFeature(IdempotencyStore store) {
        this.store = store;
    }

    @Override
    public void configure(ResourceInfo resourceInfo, FeatureContext context) {
        IdempotentOperation annotation =
                resourceInfo.getResourceMethod().getAnnotation(IdempotentOperation.class);

        if (annotation != null) {
            context.register(new IdempotencyFilter(store, annotation));
            context.register(new IdempotencyResponseFilter(store, annotation));
        }
    }
}
```

### 9.5 Why this is hard

Idempotency extension is not just filter code. It touches:

- request identity,
- tenant identity,
- body hashing,
- operation name,
- storage consistency,
- concurrency,
- response replay,
- error taxonomy,
- transaction boundary,
- distributed lock semantics,
- retry semantics,
- audit and observability.

A weak idempotency extension is worse than no extension because it creates false confidence.

### 9.6 Important design invariant

For the same idempotency key, same scope, and same operation:

```text
same request semantic input -> same stored/replayed outcome
same key but different semantic input -> conflict, not accidental replay
```

That means extension should store a fingerprint:

```text
fingerprint = hash(method + canonicalPath + operation + tenant + subject + canonicalBodyHash)
```

Do not use only raw key.

---

## 10. HK2 Binder Extension

### 10.1 Binder as dependency module

Jersey uses HK2 internally. `AbstractBinder` lets you bind services into Jersey's injection graph.

Example:

```java
import org.glassfish.hk2.utilities.binding.AbstractBinder;

public final class PlatformBinder extends AbstractBinder {
    private final Clock clock;
    private final AuditSink auditSink;

    public PlatformBinder(Clock clock, AuditSink auditSink) {
        this.clock = clock;
        this.auditSink = auditSink;
    }

    @Override
    protected void configure() {
        bind(clock).to(Clock.class);
        bind(auditSink).to(AuditSink.class);
        bindFactory(RequestContextFactory.class)
                .to(RequestContext.class)
                .proxy(true)
                .proxyForSameScope(false)
                .in(RequestScoped.class);
    }
}
```

Note: exact scope classes/imports differ between Jersey/HK2 versions and javax/jakarta generation. Always verify against your Jersey major version.

### 10.2 Feature registering binder

```java
public final class PlatformInjectionFeature implements Feature {
    private final PlatformBinder binder;

    public PlatformInjectionFeature(PlatformBinder binder) {
        this.binder = binder;
    }

    @Override
    public boolean configure(FeatureContext context) {
        context.register(binder);
        return true;
    }
}
```

### 10.3 Binder design rules

1. Bind interfaces, not concrete implementations, where possible.
2. Avoid binding request-specific mutable object as singleton.
3. Prefer immutable service dependencies.
4. Explicitly document scope.
5. Do not hide huge application dependency graph in Jersey HK2 if Spring/CDI owns app services.
6. Keep Jersey extension dependencies small.
7. Fail fast when required dependencies are missing.

---

## 11. Provider Extension

### 11.1 Common provider types

```text
MessageBodyReader<T>
  Reads request body into Java object.

MessageBodyWriter<T>
  Writes Java object to response body.

ExceptionMapper<E>
  Maps exception into Response.

ParamConverterProvider
  Converts string parameters into domain/value types.

ContextResolver<T>
  Supplies context object such as ObjectMapper.
```

### 11.2 Provider extension example: `ProblemDetailsFeature`

Goal:

- register standard exception mappers,
- produce consistent error response,
- include correlation ID,
- hide internal messages,
- map domain/infrastructure/security validation failures.

```java
public final class ProblemDetailsFeature implements Feature {
    private final ProblemDetailsOptions options;

    public ProblemDetailsFeature(ProblemDetailsOptions options) {
        this.options = options;
    }

    @Override
    public boolean configure(FeatureContext context) {
        context.register(new DomainExceptionMapper(options));
        context.register(new ValidationExceptionMapper(options));
        context.register(new NotFoundExceptionMapper(options));
        context.register(new GenericExceptionMapper(options));
        return true;
    }
}
```

Important:

- generic mapper should not shadow specific mapper unexpectedly,
- mapper should not leak stack trace,
- mapper should emit stable machine-readable error code,
- mapper should integrate correlation ID.

### 11.3 Provider priority and ambiguity

Providers can conflict.

Examples:

- two JSON providers registered,
- two exception mappers for same exception hierarchy,
- custom `MessageBodyWriter<Object>` too broad,
- custom `ParamConverterProvider` greedily claims types.

Rule:

> Provider extension should be narrow by default and explicit when broad.

Bad:

```java
@Provider
public final class EverythingWriter implements MessageBodyWriter<Object> {
    ...
}
```

Better:

```java
@Provider
@Produces("application/vnd.company.problem+json")
public final class ProblemDetailsWriter implements MessageBodyWriter<ProblemDetails> {
    ...
}
```

---

## 12. Filter and Interceptor Extension

### 12.1 Filter extension is ideal for metadata and headers

Good use cases:

- correlation ID,
- authentication token extraction,
- request timing,
- rate limit,
- tenant resolution,
- audit metadata setup,
- standard response headers,
- CORS when appropriate,
- deprecation/sunset headers.

Bad use cases:

- heavy business logic,
- database transaction orchestration without clear boundary,
- reading large body for logging,
- authorization with insufficient domain context,
- mutating entity in surprising ways.

### 12.2 Interceptor extension is ideal for entity stream boundary

Good use cases:

- gzip/deflate,
- body hashing,
- payload encryption/signature,
- controlled logging with buffering limit,
- response envelope transformation if absolutely required.

Danger:

- reading stream twice,
- buffering huge payload,
- breaking streaming response,
- losing charset/media type,
- consuming entity before `MessageBodyReader`.

### 12.3 Ordering with `@Priority`

`@Priority` controls order in filter/interceptor chains. Lower number usually means earlier for most chains, while response post chain can be reverse ordered depending on chain semantics.

Common conceptual order:

```text
Request inbound:
  1. correlation id
  2. request logging metadata
  3. authentication
  4. tenant resolution
  5. authorization precheck
  6. idempotency/rate limit
  7. resource method

Response outbound:
  1. mapper/resource response produced
  2. audit/metrics finalize
  3. standard headers
  4. correlation id echo
  5. logging closeout
```

Do not rely on accidental classpath registration order.

---

## 13. Auto-discovery: Powerful but Dangerous

### 13.1 What is auto-discovery?

Jersey supports auto-discovery mechanisms for components/features in some modules. This can make extension registration convenient.

But production platform engineering often prefers explicit registration.

### 13.2 Why auto-discovery is risky

Risks:

- behavior changes when dependency is added,
- startup graph is less obvious,
- tests may pass with different classpath than production,
- duplicate provider conflicts are harder to trace,
- security/observability behavior may become implicit.

### 13.3 Recommended stance

For internal platform extensions:

```text
Default: explicit registration
Optional: auto-discovery only for very stable, low-risk infrastructure feature
Never: hidden security or data-mutating behavior via auto-discovery
```

Good:

```java
register(new PlatformJerseyFeature(options));
```

Risky:

```text
Add dependency -> suddenly filters/mappers/providers activate.
```

---

## 14. Configuration Model for Extension

### 14.1 Avoid raw Map everywhere

Bad:

```java
public final class AuditFeature implements Feature {
    private final Map<String, Object> config;
}
```

Problems:

- no type safety,
- late failure,
- unclear defaults,
- typo-prone,
- hard to document.

Better:

```java
public final class AuditOptions {
    private final boolean enabled;
    private final String headerName;
    private final int maxPayloadBytes;
    private final boolean includeResponseStatus;

    // constructor validates all invariants
}
```

### 14.2 Validate config at startup

Do not wait until first request.

```java
public AuditOptions(...) {
    if (maxPayloadBytes < 0 || maxPayloadBytes > 64_000) {
        throw new IllegalArgumentException("maxPayloadBytes out of supported range");
    }
}
```

### 14.3 Safe defaults

Default should be safe, not convenient.

Examples:

```text
Payload logging default: disabled or metadata-only
Error stack trace default: disabled
Unknown incoming correlation ID format: replace/generate
Idempotency TTL default: bounded
Audit failure behavior: explicit
Security bypass: never default true
```

### 14.4 Options object should be immutable

Immutability avoids runtime surprises.

```java
public final class RequestLoggingOptions {
    private final boolean logHeaders;
    private final boolean logBody;
    private final int maxBodyBytes;
    private final Set<String> maskedHeaders;
}
```

Make defensive copies.

```java
this.maskedHeaders = Collections.unmodifiableSet(new HashSet<>(maskedHeaders));
```

Java 10+:

```java
this.maskedHeaders = Set.copyOf(maskedHeaders);
```

---

## 15. Packaging Internal Jersey Extensions

### 15.1 Suggested module structure

```text
platform-jersey-core
  ├─ correlation
  ├─ error
  ├─ json
  ├─ headers
  ├─ common options
  └─ test support

platform-jersey-security
  ├─ authentication context
  ├─ principal mapping
  ├─ permission annotation
  └─ authorization filters

platform-jersey-observability
  ├─ logging filters
  ├─ metrics filters
  ├─ tracing filters
  └─ masking

platform-jersey-client
  ├─ client factory
  ├─ outbound filters
  ├─ timeout config
  └─ resilience adapters

platform-jersey-spring
  ├─ Spring Boot integration
  └─ bridge configuration

platform-jersey-cdi
  ├─ CDI integration
  └─ producer/qualifier support
```

Do not put everything in one artifact unless the organization is small and lifecycle is simple.

### 15.2 Dependency hygiene

A platform Jersey extension should avoid pulling huge transitive dependency graph.

Bad:

```text
platform-jersey-core -> spring-boot-starter-web -> jackson -> hibernate -> database driver
```

Better:

```text
platform-jersey-core
  depends on:
    jakarta.ws.rs-api
    jersey-common/server as needed
    slf4j-api optional

platform-jersey-spring
  depends on:
    spring boot integration
```

Keep adapters separate.

### 15.3 Optional dependencies

Use optional dependencies carefully:

- SLF4J optional for logging adapter.
- OpenTelemetry optional for tracing adapter.
- Micrometer optional for metrics adapter.
- Spring optional only in Spring adapter artifact.
- CDI optional only in CDI adapter artifact.

Do not force all applications to carry all integrations.

---

## 16. Binary Compatibility and Jersey 2/3/4

### 16.1 Main breaking line: `javax` to `jakarta`

Jersey 2.x uses `javax.ws.rs`.

Jersey 3.x/4.x uses `jakarta.ws.rs`.

This is binary incompatible.

You cannot compile one artifact against `javax.ws.rs` and expect it to directly run in `jakarta.ws.rs` runtime.

### 16.2 Practical strategy

```text
platform-jersey2-core
  for Java EE / javax / Jersey 2.x

platform-jersey3-core
  for Jakarta EE 9/10 / Jersey 3.x

platform-jersey4-core
  for Jakarta EE 11 / Jersey 4.x if needed
```

Or:

```text
same source with build profiles/source transformation
  ├─ javax variant
  └─ jakarta variant
```

But do not pretend they are the same binary.

### 16.3 Java baseline strategy

If supporting Java 8:

- avoid records,
- avoid sealed classes,
- avoid pattern matching,
- avoid virtual thread APIs,
- avoid `List.of`, `Set.of`, `Map.of`, unless Java 9+ only,
- use old date/time APIs only if necessary, but `java.time` is available since Java 8.

If supporting Java 17+:

- records for immutable options are excellent,
- sealed interfaces improve decision models,
- pattern matching can simplify code,
- modern TLS/runtime is better.

If supporting Java 21/25:

- virtual thread integration can be adapter-specific,
- structured concurrency concepts can guide client orchestration,
- but do not force Java 21 APIs into core extension if Java 8 consumers exist.

### 16.4 Recommended artifact matrix

```text
core-jakarta-java17
  Jersey 3/4 line, Java 17+

core-javax-java8
  Jersey 2 line, Java 8+

modern-adapter-java21
  Optional virtual-thread-aware utilities
```

Top-level decision:

> It is often cleaner to maintain two small explicit artifacts than one magical artifact with complex shading/transformation.

---

## 17. SPI Design for Your Extension Users

### 17.1 Extension API vs SPI

API is what application developers call.

SPI is what advanced users implement to customize extension behavior.

Example API:

```java
register(new AuditFeature(AuditOptions.defaults()));
```

Example SPI:

```java
public interface AuditSink {
    void publish(AuditEvent event);
}
```

### 17.2 Keep SPI narrow

Bad:

```java
public interface AuditPlugin {
    void beforeRequest(...);
    void afterRequest(...);
    void onException(...);
    void configureJersey(...);
    void configureDatabase(...);
    void configureSecurity(...);
}
```

This is not an SPI. This is a hidden framework.

Better:

```java
public interface AuditSink {
    void publish(AuditEvent event);
}
```

```java
public interface AuditSubjectResolver {
    AuditSubject resolve(ContainerRequestContext requestContext);
}
```

```java
public interface AuditObjectResolver {
    Optional<AuditObject> resolve(ContainerRequestContext requestContext, ContainerResponseContext responseContext);
}
```

Each SPI does one thing.

### 17.3 SPI stability rules

- Use immutable value objects.
- Do not expose Jersey internals unless necessary.
- Do not expose HK2 internals unless the SPI is explicitly Jersey-specific.
- Prefer returning domain-neutral abstractions.
- Version SPI carefully.
- Add methods via new subinterface or default method only if Java baseline allows.

Java 8 default methods can help compatibility, but use carefully.

---

## 18. Example: `AuditFeature` Design

### 18.1 Requirements

For regulatory/case-management style systems, audit extension must capture:

- who acted,
- under which tenant/agency,
- what operation,
- on what object,
- when,
- request correlation ID,
- outcome status,
- error category if failed,
- relevant metadata,
- without logging sensitive payload unnecessarily.

### 18.2 Annotation

```java
@Retention(RetentionPolicy.RUNTIME)
@Target({ElementType.METHOD})
public @interface AuditedOperation {
    String action();
    String objectType();
    AuditTiming timing() default AuditTiming.AFTER_RESPONSE;
}
```

```java
public enum AuditTiming {
    BEFORE_INVOCATION,
    AFTER_RESPONSE
}
```

### 18.3 Event model

```java
public final class AuditEvent {
    private final String correlationId;
    private final String subjectId;
    private final String tenantId;
    private final String action;
    private final String objectType;
    private final String objectId;
    private final int responseStatus;
    private final Instant occurredAt;
    private final Map<String, String> metadata;

    // constructor + getters
}
```

For Java 17+:

```java
public record AuditEvent(
        String correlationId,
        String subjectId,
        String tenantId,
        String action,
        String objectType,
        String objectId,
        int responseStatus,
        Instant occurredAt,
        Map<String, String> metadata
) {}
```

### 18.4 Sink SPI

```java
public interface AuditSink {
    void publish(AuditEvent event) throws AuditPublishException;
}
```

### 18.5 Failure policy

Audit failure policy must be explicit:

```java
public enum AuditFailurePolicy {
    FAIL_REQUEST,
    LOG_AND_CONTINUE,
    QUEUE_FOR_RETRY
}
```

Regulatory systems often require fail-closed for certain operations, but not all. Example:

```text
Login audit failure: maybe log and continue depending on policy
Case approval audit failure: often fail request or queue durably before success
Read-only search audit failure: maybe continue with degraded telemetry
```

Do not bury this decision inside the extension.

### 18.6 DynamicFeature

```java
public final class AuditDynamicFeature implements DynamicFeature {
    private final AuditOptions options;
    private final AuditSink sink;

    public AuditDynamicFeature(AuditOptions options, AuditSink sink) {
        this.options = options;
        this.sink = sink;
    }

    @Override
    public void configure(ResourceInfo resourceInfo, FeatureContext context) {
        AuditedOperation annotation =
                resourceInfo.getResourceMethod().getAnnotation(AuditedOperation.class);

        if (annotation == null) {
            return;
        }

        context.register(new AuditRequestFilter(annotation, options));
        context.register(new AuditResponseFilter(annotation, options, sink));
    }
}
```

### 18.7 Feature

```java
public final class AuditFeature implements Feature {
    private final AuditOptions options;
    private final AuditSink sink;

    public AuditFeature(AuditOptions options, AuditSink sink) {
        this.options = options;
        this.sink = sink;
    }

    @Override
    public boolean configure(FeatureContext context) {
        if (!options.enabled()) {
            return false;
        }
        context.register(new AuditDynamicFeature(options, sink));
        return true;
    }
}
```

### 18.8 Invariant

For audited operation:

```text
If resource method produces a final business outcome, audit event must represent that outcome exactly once.
```

This sounds simple but is hard with:

- retries,
- async processing,
- response streaming,
- exception mappers,
- transaction rollback,
- client disconnect,
- duplicate idempotency submissions.

Audit extension should document these edge cases.

---

## 19. Client Extension Design

### 19.1 Jersey Client extension points

For outbound HTTP:

- `ClientRequestFilter`
- `ClientResponseFilter`
- `Feature`
- `ContextResolver`
- `MessageBodyReader/Writer`
- connector properties

### 19.2 Example: correlation propagation

```java
public final class CorrelationClientFeature implements Feature {
    private final CorrelationIdProvider provider;
    private final String headerName;

    public CorrelationClientFeature(CorrelationIdProvider provider, String headerName) {
        this.provider = provider;
        this.headerName = headerName;
    }

    @Override
    public boolean configure(FeatureContext context) {
        context.register(new CorrelationClientRequestFilter(provider, headerName));
        return true;
    }
}
```

```java
public final class CorrelationClientRequestFilter implements ClientRequestFilter {
    private final CorrelationIdProvider provider;
    private final String headerName;

    public CorrelationClientRequestFilter(CorrelationIdProvider provider, String headerName) {
        this.provider = provider;
        this.headerName = headerName;
    }

    @Override
    public void filter(ClientRequestContext requestContext) {
        provider.currentCorrelationId()
                .ifPresent(id -> requestContext.getHeaders().putSingle(headerName, id));
    }
}
```

### 19.3 Avoid client extension overreach

A client extension should not secretly:

- retry non-idempotent request,
- swallow errors,
- change target URL,
- mutate payload unexpectedly,
- ignore configured timeout,
- open/close client per request,
- create hidden thread pools without lifecycle.

---

## 20. Testing Extension

### 20.1 Unit test

Test small logic:

- options validation,
- annotation parsing,
- header normalization,
- error mapping function,
- ID generation rule,
- masking rule.

### 20.2 Jersey Test Framework

Use Jersey runtime test for:

- feature registration,
- filter ordering,
- name binding,
- dynamic feature application,
- exception mapper selection,
- provider selection,
- entity interceptor behavior.

Example pattern:

```java
public final class CorrelationIdFeatureTest extends JerseyTest {
    @Override
    protected Application configure() {
        return new ResourceConfig()
                .register(new CorrelationIdFeature(CorrelationIdOptions.defaults()))
                .register(TestResource.class);
    }

    @Test
    public void echoesGeneratedCorrelationId() {
        Response response = target("/test").request().get();
        assertEquals(200, response.getStatus());
        assertNotNull(response.getHeaderString("X-Correlation-Id"));
    }
}
```

### 20.3 Negative tests

Do not only test happy path.

Test:

- invalid config fails startup,
- duplicate provider conflict behavior,
- annotation absent means filter not applied,
- annotation present at class level applies to method,
- method-level annotation overrides class-level annotation,
- exception mapper still includes correlation ID,
- response filter runs after exception mapping,
- streaming endpoint does not buffer body,
- large payload is not logged,
- client filter propagates correlation ID.

### 20.4 Contract tests for extension users

If extension is platform library, provide reusable tests or test fixtures.

Example:

```text
platform-jersey-testkit
  ├─ CorrelationAssertions
  ├─ ProblemDetailsAssertions
  ├─ AuditSinkFake
  ├─ SecurityContextStub
  └─ JerseyResourceConfigTestSupport
```

This helps teams verify they integrated platform extension correctly.

---

## 21. Documentation Contract

Every extension should document:

```text
1. What it does
2. What it does not do
3. How to register it
4. Default behavior
5. Configuration options
6. Required dependencies
7. Ordering/priority
8. Thread-safety model
9. Failure behavior
10. Security considerations
11. Observability emitted
12. Compatibility matrix
13. Testing examples
14. Known limitations
```

A good extension without documentation becomes tribal knowledge.

---

## 22. Anti-Patterns

### 22.1 Magic platform feature

```java
register(new CompanyMagicFeature());
```

Nobody knows what it registers. It changes behavior silently.

Fix:

- expose component list,
- log startup registration summary,
- split features,
- make options explicit.

### 22.2 Broad provider claims everything

```java
MessageBodyWriter<Object>
ExceptionMapper<Throwable>
ParamConverterProvider that tries every type
```

These can shadow legitimate Jersey/default providers.

Fix:

- narrow type,
- restrict media type,
- use priority carefully,
- test conflict cases.

### 22.3 Request state in singleton fields

Bad:

```java
public final class BadFilter implements ContainerRequestFilter {
    private String currentUser;
}
```

In concurrent requests, this leaks state.

Fix:

- use `ContainerRequestContext.setProperty`,
- request-scoped dependency,
- immutable local variables.

### 22.4 Body logging without size limit

Bad:

```text
Read full body -> log -> replay body
```

This can cause:

- OOM,
- sensitive data leak,
- streaming broken,
- latency spike.

Fix:

- metadata-only default,
- bounded buffering,
- masking,
- media type allowlist,
- disable for multipart/binary/streaming.

### 22.5 Retrying inside client filter blindly

Client filters are not always the best place for retry. Retrying there may conflict with caller expectations.

Better:

- resilience wrapper at service client layer,
- explicit policy per operation,
- idempotency-aware retry.

### 22.6 Extension owns business policy secretly

If extension decides business authorization, audit semantics, tenant mapping, or transaction outcome without explicit SPI/configuration, it becomes dangerous.

Extension should enforce infrastructure policy, not hide business rules.

---

## 23. Startup Diagnostics for Extension

Platform extension should emit startup summary.

Example:

```text
Platform Jersey Extension initialized:
  correlation: enabled header=X-Correlation-Id maxLength=128
  problemDetails: enabled mediaType=application/problem+json includeStackTrace=false
  requestLogging: enabled bodyLogging=false maskedHeaders=[Authorization, Cookie]
  audit: enabled failurePolicy=QUEUE_FOR_RETRY
  idempotency: enabled store=Redis ttl=86400
```

But never log secrets.

This helps during incident:

- Was feature registered?
- Which header name?
- Was body logging enabled?
- Which failure policy?
- Which provider variant?

---

## 24. Observability for Extension

An extension should instrument itself.

Useful metrics:

```text
correlation.generated.count
correlation.accepted.count
correlation.rejected.count

problem_details.mapped.count{exception,status,errorCode}

idempotency.first_execution.count
idempotency.replay.count
idempotency.conflict.count
idempotency.store_error.count

audit.publish.success.count
audit.publish.failure.count
audit.publish.latency

request_logging.body_skipped.count{reason}
```

Useful logs:

- startup summary,
- invalid config fail-fast,
- audit publish failure,
- idempotency conflict,
- suspicious invalid correlation IDs,
- provider conflict warning.

Useful traces:

- add span events for idempotency decision,
- audit publish,
- error mapping,
- outbound propagation.

---

## 25. Security Review Checklist

Before shipping extension:

```text
[ ] Does it log request/response body?
[ ] Does it mask Authorization/Cookie/Set-Cookie/token fields?
[ ] Does it trust incoming headers?
[ ] Can client spoof user/tenant/correlation/security metadata?
[ ] Does it expose stack trace?
[ ] Does it change authorization behavior?
[ ] Does it fail open or fail closed?
[ ] Is failure policy explicit?
[ ] Does it use global mutable state?
[ ] Does it handle concurrency?
[ ] Does it process multipart/binary safely?
[ ] Does it create hidden thread pools?
[ ] Does it propagate sensitive headers outbound?
[ ] Does it have denial-of-service risk from unbounded buffering?
```

---

## 26. Production Readiness Checklist

```text
[ ] Feature has single responsibility.
[ ] Registration is explicit.
[ ] Options object is immutable and validated.
[ ] Defaults are safe.
[ ] Priorities are explicit.
[ ] Providers are narrow.
[ ] Annotation API is documented.
[ ] SPI is narrow and stable.
[ ] Request state is not stored in singleton fields.
[ ] Body stream is not consumed unexpectedly.
[ ] Large payload behavior is bounded.
[ ] Error behavior is documented.
[ ] Observability is included.
[ ] Startup summary exists.
[ ] Unit tests exist.
[ ] Jersey runtime tests exist.
[ ] Negative tests exist.
[ ] Compatibility matrix is documented.
[ ] javax/jakarta artifact strategy is explicit.
[ ] Java baseline is explicit.
[ ] Security review completed.
```

---

## 27. Java 8–25 Considerations

### Java 8

Use:

- final classes,
- immutable options manually,
- `Optional` carefully,
- `CompletableFuture` if needed,
- no records/sealed/pattern matching.

Avoid:

- `String.isBlank`,
- `List.of`,
- records,
- sealed interfaces,
- virtual thread APIs.

### Java 11

Useful:

- better HTTP/TLS baseline,
- `String.isBlank`,
- collection factory from Java 9,
- improved runtime/container ecosystem.

### Java 17

Useful:

- records for options/events,
- sealed classes for decision models,
- stronger baseline for Jakarta EE 11 ecosystems.

### Java 21

Useful:

- virtual threads where supported by container/client layer,
- better concurrency model for blocking integration code,
- but extension must not assume request lifecycle equals thread lifecycle.

### Java 25

Use Java 25 as modern LTS target where organization has adopted it, but keep extension core conservative if you need broad platform adoption.

Recommended split:

```text
Core extension: Java 8 or 17 baseline depending on org reality
Modern adapter: Java 21/25 optimized utilities
```

---

## 28. Mini Capstone for This Part: Platform Jersey Extension Set

Design a small internal platform extension set:

```text
platform-jersey-core
  CorrelationIdFeature
  ProblemDetailsFeature
  StandardHeadersFeature

platform-jersey-observability
  RequestLoggingFeature
  MetricsFeature
  TracingFeature

platform-jersey-security
  AuthenticatedPrincipalFeature
  PermissionFeature

platform-jersey-governance
  AuditFeature
  IdempotencyFeature
  ApiLifecycleHeaderFeature
```

Recommended registration:

```java
public final class ApiApplication extends ResourceConfig {
    public ApiApplication(PlatformOptions options, PlatformDependencies deps) {
        register(new CorrelationIdFeature(options.correlation()));
        register(new ProblemDetailsFeature(options.problemDetails()));
        register(new StandardHeadersFeature(options.headers()));
        register(new ObservabilityFeature(options.observability(), deps.metrics(), deps.tracer()));
        register(new SecurityPrincipalFeature(options.security(), deps.tokenVerifier()));
        register(new AuditFeature(options.audit(), deps.auditSink()));
        register(new IdempotencyFeature(options.idempotency(), deps.idempotencyStore()));

        packages("com.example.api.resources");
    }
}
```

This is explicit, reviewable, and testable.

---

## 29. Review Questions

1. Apa perbedaan `Feature` dan `DynamicFeature`?
2. Kapan name binding lebih baik daripada dynamic feature?
3. Kenapa extension tidak boleh menyimpan request state di field singleton?
4. Apa risiko provider yang terlalu broad?
5. Kenapa auto-discovery bisa berbahaya di production?
6. Apa beda API dan SPI dalam platform extension?
7. Kenapa `javax.ws.rs` dan `jakarta.ws.rs` perlu artifact strategy berbeda?
8. Bagaimana cara menguji bahwa dynamic feature hanya aktif pada method tertentu?
9. Apa failure mode paling berbahaya dari body logging extension?
10. Kenapa audit extension harus punya failure policy eksplisit?

---

## 30. Kesimpulan

Extension engineering adalah titik di mana Jersey berubah dari sekadar framework REST menjadi **platform runtime yang bisa distandarisasi**.

Namun extension adalah pedang bermata dua.

Extension yang baik membuat aplikasi:

- lebih konsisten,
- lebih aman,
- lebih mudah diobservasi,
- lebih mudah diuji,
- lebih cepat dibangun,
- lebih defendable secara production/regulatory.

Extension yang buruk membuat aplikasi:

- penuh magic,
- sulit didebug,
- rawan conflict provider,
- rawan leak request state,
- rawan behavior tersembunyi,
- sulit migrasi antar Jersey/Java/Jakarta version.

Mental model utama:

```text
A Jersey extension is a runtime behavior contract.
It must be explicit, narrow, immutable, observable, testable, and versioned.
```

Jika kamu bisa mendesain extension seperti itu, kamu tidak hanya memakai Jersey. Kamu sedang membangun platform engineering layer di atas Jersey.

---

## 31. Referensi

- Eclipse Jersey Documentation — User Guide, Filters and Interceptors, IoC/HK2, Configuration, Monitoring, Test Framework.  
  https://eclipse-ee4j.github.io/jersey.github.io/documentation/latest/
- Eclipse Jersey official release overview.  
  https://jersey.github.io/
- Eclipse Jersey 4.0.0 project release page.  
  https://projects.eclipse.org/projects/ee4j.jersey/releases/4.0.0-0
- Jakarta RESTful Web Services 4.0 specification and API docs.  
  https://jakarta.ee/specifications/restful-ws/4.0/
- Jakarta REST `Priorities` API docs.  
  https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/priorities
- Jakarta REST `NameBinding`, `Feature`, `DynamicFeature`, filter/interceptor APIs.  
  https://jakarta.ee/specifications/restful-ws/4.0/apidocs/
- HK2 project documentation/API references.  
  https://javaee.github.io/hk2/

---

## 32. Status Seri

Part 28 selesai.

Belum mencapai bagian terakhir.

Berikutnya:

**Part 29 — Migration Engineering: Jersey 2 to 3 to 4, javax to jakarta, Java 8 to 25**

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./27-testing-jersey-applications-unit-inmemory-container-contract-failure-tests.md">⬅️ Part 27 — Testing Jersey Applications: Unit, In-Memory, Container, Contract, and Failure Tests</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./29-migration-engineering-jersey-2-to-3-to-4-javax-to-jakarta-java-8-to-25.md">Part 29 — Migration Engineering: Jersey 2 to 3 to 4, `javax` to `jakarta`, Java 8 to 25 ➡️</a>
</div>
