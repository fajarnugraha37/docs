# Part 10 — Filters and Interceptors: Request/Response Pipeline Control

Series: `learn-java-jersey-runtime-resource-client-extension-engineering`  
File: `10-filters-and-interceptors-request-response-pipeline-control.md`  
Target: Java 8–25, Jersey 2.x/3.x/4.x, JAX-RS/Jakarta REST 2.x–4.x  
Status: Part 10 dari 32

---

## 0. Tujuan Bagian Ini

Di bagian sebelumnya kita sudah membangun fondasi penting:

1. bagaimana Jersey mem-bootstrap aplikasi,
2. bagaimana resource model dibaca,
3. bagaimana request di-match ke resource method,
4. bagaimana parameter diinjeksi,
5. bagaimana entity body dibaca/ditulis oleh provider,
6. bagaimana JSON dipilih dan dikendalikan,
7. bagaimana response dibangun,
8. bagaimana exception diubah menjadi error contract.

Sekarang kita masuk ke salah satu titik paling penting di Jersey production engineering:

> **filters dan interceptors sebagai mekanisme kontrol pipeline request/response.**

Pada aplikasi kecil, filter sering dianggap hanya tempat menaruh logging atau authentication sederhana. Pada sistem enterprise, terutama sistem yang perlu audit, keamanan, tracing, idempotency, masking, rate limiting, dan enforcement defensibility, filter/interceptor menjadi boundary yang sangat strategis.

Namun di titik ini banyak aplikasi Jersey menjadi rapuh karena developer tidak membedakan:

- filter vs interceptor,
- pre-matching vs post-matching,
- global binding vs name binding,
- request filter vs response filter,
- reader interceptor vs writer interceptor,
- metadata-level concern vs entity-stream-level concern,
- authentication vs authorization,
- observability vs payload logging,
- aborting vs throwing,
- provider ordering vs accidental ordering.

Bagian ini bertujuan membuat kamu tidak hanya tahu syntax, tetapi memahami **runtime geometry** dari pipeline Jersey.

---

## 1. Mental Model Utama

Bayangkan Jersey server pipeline sebagai rangkaian gerbang:

```text
HTTP request arrives
  |
  v
[Container / Servlet / HTTP server]
  |
  v
[Jersey enters request pipeline]
  |
  v
Pre-matching ContainerRequestFilter
  |
  v
Resource matching
  |
  v
Post-matching ContainerRequestFilter
  |
  v
ReaderInterceptor
  |
  v
MessageBodyReader
  |
  v
Resource method invocation
  |
  v
ExceptionMapper if failure occurs
  |
  v
WriterInterceptor
  |
  v
MessageBodyWriter
  |
  v
ContainerResponseFilter
  |
  v
HTTP response leaves
```

Tapi mental model ini masih terlalu linear. Di production, kita perlu memahami tiga sumbu:

```text
1. Waktu eksekusi
   - sebelum matching
   - setelah matching
   - sebelum body dibaca
   - setelah method menghasilkan response
   - sebelum body ditulis
   - setelah response metadata tersedia

2. Jenis hal yang boleh disentuh
   - request metadata
   - response metadata
   - URI/method/header
   - security context
   - entity input stream
   - entity output stream
   - abort/error flow

3. Scope binding
   - global
   - resource/method-specific via name binding
   - conditional via DynamicFeature
```

Kalau tiga sumbu ini tidak jelas, pipeline menjadi kumpulan hook acak.

---

## 2. Filter vs Interceptor

Perbedaan paling penting:

```text
Filter      -> concern metadata request/response.
Interceptor -> concern entity stream/body read-write.
```

Lebih konkret:

| Mechanism | Server-side Interface | Fokus |
|---|---|---|
| Request filter | `ContainerRequestFilter` | request metadata sebelum resource method |
| Response filter | `ContainerResponseFilter` | response metadata setelah resource method/error mapping |
| Reader interceptor | `ReaderInterceptor` | entity input stream sebelum `MessageBodyReader` |
| Writer interceptor | `WriterInterceptor` | entity output stream sebelum/saat `MessageBodyWriter` |

Contoh rule of thumb:

| Use case | Mekanisme yang tepat |
|---|---|
| Tambah correlation ID request | Request filter |
| Tambah correlation ID response header | Response filter |
| Reject missing Authorization header | Request filter |
| Decode compressed request body | Reader interceptor |
| Compress response body | Writer interceptor |
| Mask sensitive response header | Response filter |
| Log request path/method/status/duration | Request + response filter |
| Log raw request body | Reader interceptor, tapi sangat hati-hati |
| Audit command setelah berhasil | Bisa response filter atau service-level audit, tergantung invariant |
| Verify body signature sebelum deserialization | Reader interceptor atau request filter dengan buffering hati-hati |

Kesalahan umum:

```text
Developer membaca request body di ContainerRequestFilter untuk logging.
```

Ini berbahaya karena entity input stream biasanya hanya bisa dibaca sekali. Kalau stream sudah dikonsumsi filter dan tidak diganti dengan stream baru, `MessageBodyReader` tidak bisa membaca body lagi.

---

## 3. Server Pipeline dalam Detail

Mari kita pecah runtime-nya.

### 3.1 Request Masuk ke Jersey

Request pertama kali diterima oleh container:

- Servlet container,
- Grizzly,
- embedded server,
- Jakarta EE server,
- Spring Boot Jersey integration,
- atau deployment model lain.

Container bertanggung jawab atas:

- TCP/socket handling,
- HTTP parsing dasar,
- servlet mapping,
- thread allocation,
- TLS termination jika tidak di-proxy,
- request object/container abstraction.

Setelah request cocok dengan servlet mapping Jersey, Jersey mulai mengambil alih.

---

### 3.2 Pre-Matching Request Filter

Pre-matching filter adalah filter yang berjalan **sebelum Jersey memilih resource method**.

Biasanya dibuat dengan:

```java
import jakarta.annotation.Priority;
import jakarta.ws.rs.Priorities;
import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.container.ContainerRequestFilter;
import jakarta.ws.rs.container.PreMatching;
import jakarta.ws.rs.ext.Provider;

import java.io.IOException;

@Provider
@PreMatching
@Priority(Priorities.HEADER_DECORATOR)
public class RequestIdPreMatchingFilter implements ContainerRequestFilter {

    @Override
    public void filter(ContainerRequestContext requestContext) throws IOException {
        String requestId = requestContext.getHeaderString("X-Request-Id");

        if (requestId == null || requestId.isBlank()) {
            requestId = java.util.UUID.randomUUID().toString();
        }

        requestContext.setProperty("requestId", requestId);
    }
}
```

Pre-matching cocok untuk concern yang harus terjadi sebelum URI/resource method final diketahui.

Contoh:

- correlation ID awal,
- request normalization,
- HTTP method override jika memang diperlukan,
- path rewrite internal yang sangat terbatas,
- early rejection terhadap request yang jelas invalid secara envelope,
- CORS preflight tertentu,
- gateway compatibility workaround.

Pre-matching **tidak cocok** untuk concern yang membutuhkan informasi resource method, seperti:

- name-bound authorization berdasarkan annotation resource method,
- audit action type dari annotation method,
- validation yang butuh matched operation,
- role check berbasis resource method.

Alasannya sederhana:

> pada fase pre-matching, Jersey belum tahu method mana yang akan dipanggil.

---

### 3.3 Resource Matching

Setelah pre-matching selesai, Jersey melakukan resource matching:

```text
request URI + HTTP method + media negotiation
  -> matched resource method / sub-resource locator / failure
```

Jika gagal:

- bisa menjadi 404,
- 405,
- 406,
- 415,
- atau exception internal tergantung penyebab.

Perlu dicatat:

> Filter post-matching hanya berjalan kalau matching berhasil sampai titik yang relevan.

Jadi jangan menaruh logic yang wajib selalu terjadi di post-matching kalau logic tersebut harus berlaku juga untuk request yang tidak match.

Contoh: request ID sebaiknya pre-matching/global awal, bukan hanya post-matching.

---

### 3.4 Post-Matching Request Filter

Post-matching request filter berjalan setelah Jersey mengetahui resource method yang akan dipanggil.

Contoh:

```java
import jakarta.annotation.Priority;
import jakarta.ws.rs.Priorities;
import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.container.ContainerRequestFilter;
import jakarta.ws.rs.container.ResourceInfo;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.Provider;

import java.io.IOException;
import java.lang.reflect.Method;

@Provider
@Priority(Priorities.AUTHORIZATION)
public class OperationAuthorizationFilter implements ContainerRequestFilter {

    @Context
    private ResourceInfo resourceInfo;

    @Override
    public void filter(ContainerRequestContext requestContext) throws IOException {
        Method method = resourceInfo.getResourceMethod();

        RequiresPermission permission = method.getAnnotation(RequiresPermission.class);
        if (permission == null) {
            permission = resourceInfo.getResourceClass().getAnnotation(RequiresPermission.class);
        }

        if (permission == null) {
            return;
        }

        UserPrincipal principal = (UserPrincipal) requestContext.getSecurityContext().getUserPrincipal();
        if (principal == null || !principal.hasPermission(permission.value())) {
            requestContext.abortWith(
                Response.status(Response.Status.FORBIDDEN)
                    .entity(new ErrorResponse("FORBIDDEN", "Insufficient permission"))
                    .build()
            );
        }
    }
}
```

Post-matching cocok untuk:

- method/resource annotation processing,
- authorization,
- operation-level audit setup,
- idempotency untuk command method tertentu,
- business operation metadata,
- feature flag per endpoint,
- endpoint-specific rate limit.

---

## 4. ContainerRequestFilter

`ContainerRequestFilter` adalah hook untuk request sebelum resource method dipanggil.

Signature:

```java
void filter(ContainerRequestContext requestContext) throws IOException;
```

Yang bisa diakses dari `ContainerRequestContext` antara lain:

- HTTP method,
- URI info,
- headers,
- cookies,
- acceptable media types,
- language,
- entity stream,
- security context,
- request properties,
- abort response.

Contoh minimal:

```java
@Provider
public class SimpleRequestFilter implements ContainerRequestFilter {
    @Override
    public void filter(ContainerRequestContext requestContext) {
        String method = requestContext.getMethod();
        String path = requestContext.getUriInfo().getPath();
        requestContext.setProperty("startNanos", System.nanoTime());
    }
}
```

### 4.1 `abortWith`

Filter bisa menghentikan request dengan `abortWith`:

```java
requestContext.abortWith(
    Response.status(Response.Status.UNAUTHORIZED)
        .header("WWW-Authenticate", "Bearer")
        .entity(new ErrorResponse("UNAUTHORIZED", "Authentication required"))
        .build()
);
```

Makna `abortWith`:

```text
Jangan lanjut ke resource method.
Gunakan Response ini sebagai response final pipeline.
```

Tapi response filter masih dapat berjalan setelah abort, tergantung chain-nya.

Gunakan `abortWith` untuk expected rejection di boundary:

- missing auth header,
- invalid API key,
- blocked tenant,
- rate limit exceeded,
- invalid idempotency key format,
- maintenance mode.

Jangan gunakan `abortWith` untuk menyembunyikan bug internal.

Untuk bug internal, lebih baik throw exception dan biarkan exception mapper/toplevel failure handling membuat error 500 yang konsisten.

---

## 5. ContainerResponseFilter

`ContainerResponseFilter` berjalan ketika response sudah ada.

Signature:

```java
void filter(
    ContainerRequestContext requestContext,
    ContainerResponseContext responseContext
) throws IOException;
```

Contoh:

```java
@Provider
public class SecurityHeadersResponseFilter implements ContainerResponseFilter {

    @Override
    public void filter(ContainerRequestContext requestContext,
                       ContainerResponseContext responseContext) {
        responseContext.getHeaders().putSingle("X-Content-Type-Options", "nosniff");
        responseContext.getHeaders().putSingle("X-Frame-Options", "DENY");
        responseContext.getHeaders().putSingle("Referrer-Policy", "no-referrer");
    }
}
```

Response filter cocok untuk:

- add response headers,
- correlation ID response propagation,
- security headers,
- final request logging,
- response metadata normalization,
- cache header policy,
- response status observation,
- masking headers,
- adding deprecation/warning headers,
- CORS response headers.

Response filter kurang cocok untuk:

- business transaction commit,
- deep response entity transformation,
- heavy serialization-dependent logic,
- audit yang harus atomic dengan domain mutation.

Kenapa?

Karena response filter berada di HTTP boundary. Ia tidak selalu punya invariant bisnis yang sama kuat dengan service/transaction layer.

---

## 6. ReaderInterceptor

Reader interceptor berjalan di sekitar proses pembacaan entity request.

Pipeline:

```text
HTTP request body stream
  -> ReaderInterceptor(s)
  -> MessageBodyReader
  -> Java entity object
  -> resource method parameter
```

Contoh sederhana untuk menghitung ukuran body yang dibaca:

```java
@Provider
public class RequestBodySizeReaderInterceptor implements ReaderInterceptor {

    @Override
    public Object aroundReadFrom(ReaderInterceptorContext context) throws IOException {
        CountingInputStream counting = new CountingInputStream(context.getInputStream());
        context.setInputStream(counting);

        try {
            return context.proceed();
        } finally {
            long bytesRead = counting.getCount();
            // record metric carefully
        }
    }
}
```

Contoh utility minimal:

```java
public final class CountingInputStream extends java.io.FilterInputStream {
    private long count;

    public CountingInputStream(java.io.InputStream in) {
        super(in);
    }

    @Override
    public int read() throws IOException {
        int b = super.read();
        if (b != -1) count++;
        return b;
    }

    @Override
    public int read(byte[] b, int off, int len) throws IOException {
        int n = super.read(b, off, len);
        if (n > 0) count += n;
        return n;
    }

    public long getCount() {
        return count;
    }
}
```

Reader interceptor cocok untuk:

- decompression,
- decrypt before deserialization,
- verify signature over body,
- body size metrics,
- controlled body buffering,
- canonicalization sebelum reader,
- stream wrapping.

Risikonya besar:

- salah wrap stream,
- stream tidak ditutup,
- body terbaca habis sebelum provider,
- buffering terlalu besar menyebabkan OOM,
- signature verification berubah karena charset/canonicalization salah,
- logging raw body bocor PII/secret.

---

## 7. WriterInterceptor

Writer interceptor berjalan saat response entity akan ditulis.

Pipeline:

```text
Java response entity
  -> WriterInterceptor(s)
  -> MessageBodyWriter
  -> HTTP response output stream
```

Contoh konseptual compression:

```java
@Provider
public class GzipWriterInterceptor implements WriterInterceptor {

    @Override
    public void aroundWriteTo(WriterInterceptorContext context) throws IOException {
        Object acceptEncoding = context.getHeaders().getFirst("Accept-Encoding");

        // In real systems, inspect request header, response size, media type, and existing Content-Encoding.
        context.getHeaders().putSingle("Content-Encoding", "gzip");

        java.io.OutputStream original = context.getOutputStream();
        try (java.util.zip.GZIPOutputStream gzip = new java.util.zip.GZIPOutputStream(original)) {
            context.setOutputStream(gzip);
            context.proceed();
        }
    }
}
```

Catatan penting:

Kode di atas adalah ilustrasi. Implementasi production harus mempertimbangkan:

- apakah client menerima gzip,
- response sudah compressed atau belum,
- media type layak di-compress atau tidak,
- ukuran response,
- streaming behavior,
- `Content-Length` invalid setelah compression,
- interaction dengan reverse proxy yang juga melakukan compression.

Writer interceptor cocok untuk:

- compression,
- encryption,
- response signing,
- output stream counting,
- final payload transformation di level stream,
- redaction di level serialized stream bila benar-benar diperlukan.

Namun untuk transformasi DTO biasa, jangan gunakan writer interceptor. Gunakan DTO/service mapping sebelum response.

---

## 8. Ordering dan `@Priority`

Pipeline Jersey/Jakarta REST tidak boleh bergantung pada urutan registration acak. Gunakan `@Priority`.

Contoh:

```java
@Provider
@Priority(Priorities.AUTHENTICATION)
public class AuthenticationFilter implements ContainerRequestFilter {
    @Override
    public void filter(ContainerRequestContext requestContext) {
        // authenticate first
    }
}
```

Nilai priority lebih kecil biasanya berjalan lebih awal untuk request-side chain.

Konstanta umum:

```java
jakarta.ws.rs.Priorities.AUTHENTICATION
jakarta.ws.rs.Priorities.AUTHORIZATION
jakarta.ws.rs.Priorities.HEADER_DECORATOR
jakarta.ws.rs.Priorities.ENTITY_CODER
jakarta.ws.rs.Priorities.USER
```

Mental model:

```text
Request-side concerns:
  lower number -> earlier

Response-side post chain:
  sering dieksekusi reverse order agar response filter pair mengikuti nesting request.
```

Desain priority yang sehat:

```text
1. Request ID / correlation setup
2. Low-level request normalization
3. Authentication
4. Tenant resolution
5. Authorization
6. Idempotency / rate limit / feature flag
7. Resource method execution
8. Error mapping if needed
9. Response headers / metadata
10. Access logging / metrics finalization
```

Jangan membuat semua filter `@Priority(Priorities.USER)`. Itu hanya memindahkan masalah ke ordering implicit.

---

## 9. Name Binding

Name binding memungkinkan filter/interceptor hanya berlaku pada resource class/method tertentu.

### 9.1 Membuat Annotation Name Binding

```java
import jakarta.ws.rs.NameBinding;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

@NameBinding
@Retention(RetentionPolicy.RUNTIME)
@Target({ElementType.TYPE, ElementType.METHOD})
public @interface AuditedOperation {
    String value() default "";
}
```

### 9.2 Menggunakan pada Filter

```java
@Provider
@AuditedOperation
public class AuditMarkerFilter implements ContainerRequestFilter {
    @Override
    public void filter(ContainerRequestContext requestContext) {
        requestContext.setProperty("audit.required", true);
    }
}
```

### 9.3 Menggunakan pada Resource

```java
@Path("/cases")
public class CaseResource {

    @POST
    @AuditedOperation("CREATE_CASE")
    public Response createCase(CreateCaseRequest request) {
        return Response.status(Response.Status.CREATED).build();
    }
}
```

Hasilnya:

```text
AuditMarkerFilter hanya berjalan untuk resource/method yang memiliki @AuditedOperation.
```

Name binding cocok untuk:

- operation-specific audit,
- operation-specific authorization marker,
- optional idempotency,
- custom response headers untuk endpoint tertentu,
- compression/signature hanya untuk endpoint tertentu,
- experimental behavior per endpoint.

Kelemahannya:

- annotation bisa tersebar,
- default behavior bisa tidak jelas,
- sulit dipahami kalau terlalu banyak annotation custom,
- perlu test agar binding tidak hilang saat refactor.

---

## 10. DynamicFeature

`DynamicFeature` memberi kemampuan binding filter/interceptor secara programmatic berdasarkan resource method/class.

Contoh:

```java
import jakarta.ws.rs.container.DynamicFeature;
import jakarta.ws.rs.container.ResourceInfo;
import jakarta.ws.rs.core.FeatureContext;
import jakarta.ws.rs.ext.Provider;

@Provider
public class AuditDynamicFeature implements DynamicFeature {

    @Override
    public void configure(ResourceInfo resourceInfo, FeatureContext context) {
        AuditedOperation annotation = resourceInfo.getResourceMethod()
            .getAnnotation(AuditedOperation.class);

        if (annotation == null) {
            annotation = resourceInfo.getResourceClass()
                .getAnnotation(AuditedOperation.class);
        }

        if (annotation != null) {
            context.register(new AuditMarkerFilter(annotation.value()));
        }
    }
}
```

Filter instance:

```java
public class AuditMarkerFilter implements ContainerRequestFilter {
    private final String operation;

    public AuditMarkerFilter(String operation) {
        this.operation = operation;
    }

    @Override
    public void filter(ContainerRequestContext requestContext) {
        requestContext.setProperty("audit.operation", operation);
    }
}
```

DynamicFeature cocok untuk:

- binding berdasarkan annotation parameter,
- dynamic registration dengan state per operation,
- menghindari reflection ulang setiap request,
- platform extension yang mendaftarkan filter sesuai metadata resource,
- conditional feature berdasarkan resource method signature.

Perbedaan dengan name binding biasa:

```text
Name binding:
  declarative, simple, annotation-based.

DynamicFeature:
  programmatic, lebih kuat, bisa membaca ResourceInfo saat startup/configuration.
```

DynamicFeature sering lebih cocok untuk framework/platform internal.

---

## 11. Global vs Bound Filter

Tiga scope utama:

```text
1. Global provider
   Berjalan untuk semua request/response.

2. Name-bound provider
   Berjalan hanya untuk resource/method dengan annotation tertentu.

3. DynamicFeature-registered provider
   Berjalan sesuai keputusan programmatic saat konfigurasi resource.
```

Contoh desain:

| Concern | Scope disarankan |
|---|---|
| Correlation ID | Global |
| Access logging | Global |
| Security headers | Global |
| Authentication | Global atau path-specific tergantung API |
| Authorization | Bound/dynamic atau service-level |
| Audit command | Bound/dynamic |
| Idempotency | Bound/dynamic untuk command endpoint |
| Compression | Global dengan condition, atau proxy-level |
| Body signature | Bound/dynamic |
| Debug payload logging | Jangan global di production |

---

## 12. Context Object dan Request Property

Filter sering perlu berbagi informasi ke downstream pipeline.

Gunakan request property:

```java
requestContext.setProperty("request.startNanos", System.nanoTime());
requestContext.setProperty("request.correlationId", correlationId);
requestContext.setProperty("tenant.id", tenantId);
```

Ambil di response filter:

```java
Object start = requestContext.getProperty("request.startNanos");
if (start instanceof Long startNanos) {
    long durationMicros = (System.nanoTime() - startNanos) / 1_000;
    responseContext.getHeaders().putSingle("X-Request-Duration-Micros", durationMicros);
}
```

Untuk Java 8, pattern matching belum ada:

```java
Object start = requestContext.getProperty("request.startNanos");
if (start instanceof Long) {
    long startNanos = (Long) start;
    long durationMicros = (System.nanoTime() - startNanos) / 1_000L;
}
```

Best practice:

- gunakan constant key,
- hindari string magic tersebar,
- jangan simpan object besar,
- jangan simpan entity body raw kecuali sangat terkendali,
- jangan simpan object mutable yang dipakai lintas thread tanpa kontrol,
- bersihkan MDC/ThreadLocal setelah request.

Contoh constant:

```java
public final class RequestProperties {
    public static final String CORRELATION_ID = "app.correlationId";
    public static final String START_NANOS = "app.startNanos";
    public static final String TENANT_ID = "app.tenantId";

    private RequestProperties() {}
}
```

---

## 13. Authentication Filter Pattern

Authentication filter bertugas menjawab:

```text
Siapa caller ini?
```

Bukan:

```text
Apakah caller boleh melakukan action X terhadap object Y?
```

Contoh sederhana:

```java
@Provider
@Priority(Priorities.AUTHENTICATION)
public class BearerAuthenticationFilter implements ContainerRequestFilter {

    private final TokenVerifier tokenVerifier;

    public BearerAuthenticationFilter(TokenVerifier tokenVerifier) {
        this.tokenVerifier = tokenVerifier;
    }

    @Override
    public void filter(ContainerRequestContext requestContext) {
        String authorization = requestContext.getHeaderString("Authorization");

        if (authorization == null || !authorization.startsWith("Bearer ")) {
            requestContext.abortWith(
                Response.status(Response.Status.UNAUTHORIZED)
                    .header("WWW-Authenticate", "Bearer")
                    .entity(new ErrorResponse("UNAUTHORIZED", "Bearer token is required"))
                    .build()
            );
            return;
        }

        String token = authorization.substring("Bearer ".length());
        AuthenticatedUser user;
        try {
            user = tokenVerifier.verify(token);
        } catch (InvalidTokenException ex) {
            requestContext.abortWith(
                Response.status(Response.Status.UNAUTHORIZED)
                    .header("WWW-Authenticate", "Bearer error=\"invalid_token\"")
                    .entity(new ErrorResponse("INVALID_TOKEN", "Invalid access token"))
                    .build()
            );
            return;
        }

        requestContext.setSecurityContext(
            new ApplicationSecurityContext(user, requestContext.getSecurityContext().isSecure())
        );
    }
}
```

SecurityContext:

```java
public class ApplicationSecurityContext implements jakarta.ws.rs.core.SecurityContext {
    private final AuthenticatedUser user;
    private final boolean secure;

    public ApplicationSecurityContext(AuthenticatedUser user, boolean secure) {
        this.user = user;
        this.secure = secure;
    }

    @Override
    public java.security.Principal getUserPrincipal() {
        return user;
    }

    @Override
    public boolean isUserInRole(String role) {
        return user.hasRole(role);
    }

    @Override
    public boolean isSecure() {
        return secure;
    }

    @Override
    public String getAuthenticationScheme() {
        return "Bearer";
    }
}
```

AuthenticatedUser:

```java
public class AuthenticatedUser implements java.security.Principal {
    private final String subject;
    private final java.util.Set<String> roles;

    public AuthenticatedUser(String subject, java.util.Set<String> roles) {
        this.subject = subject;
        this.roles = java.util.Collections.unmodifiableSet(new java.util.HashSet<>(roles));
    }

    @Override
    public String getName() {
        return subject;
    }

    public boolean hasRole(String role) {
        return roles.contains(role);
    }
}
```

Production notes:

- Jangan log token.
- Jangan expose alasan detail token invalid ke public caller.
- Cache JWKS dengan TTL dan rotation strategy.
- Pisahkan token verification dari Jersey filter agar bisa dites.
- Jangan melakukan network introspection token tanpa timeout ketat.
- Pertimbangkan dependency failure: auth server down harus diperlakukan eksplisit.

---

## 14. Authorization Filter Pattern

Authorization filter bertugas menjawab:

```text
Apakah caller boleh melakukan operation ini?
```

Namun ada dua level authorization:

```text
1. Operation-level authorization
   Caller boleh invoke endpoint/action ini?

2. Object-level/domain authorization
   Caller boleh melakukan action ini terhadap object spesifik ini?
```

Filter cocok untuk operation-level.

Object-level authorization sering lebih tepat di service/domain layer karena perlu load object, tenant, ownership, status, workflow state, atau entitlement kompleks.

Contoh annotation:

```java
@NameBinding
@Retention(RetentionPolicy.RUNTIME)
@Target({ElementType.TYPE, ElementType.METHOD})
public @interface RequiresPermission {
    String value();
}
```

Resource:

```java
@Path("/cases")
public class CaseResource {

    @POST
    @RequiresPermission("case:create")
    public Response create(CreateCaseRequest request) {
        return Response.status(Response.Status.CREATED).build();
    }

    @POST
    @Path("/{caseId}/approve")
    @RequiresPermission("case:approve")
    public Response approve(@PathParam("caseId") String caseId) {
        return Response.ok().build();
    }
}
```

Filter:

```java
@Provider
@Priority(Priorities.AUTHORIZATION)
public class PermissionAuthorizationFilter implements ContainerRequestFilter {

    @Context
    private ResourceInfo resourceInfo;

    @Override
    public void filter(ContainerRequestContext requestContext) {
        RequiresPermission annotation = findPermissionAnnotation();
        if (annotation == null) {
            return;
        }

        java.security.Principal principal = requestContext.getSecurityContext().getUserPrincipal();
        if (!(principal instanceof AuthenticatedUser)) {
            requestContext.abortWith(Response.status(Response.Status.UNAUTHORIZED).build());
            return;
        }

        AuthenticatedUser user = (AuthenticatedUser) principal;
        if (!user.hasPermission(annotation.value())) {
            requestContext.abortWith(Response.status(Response.Status.FORBIDDEN).build());
        }
    }

    private RequiresPermission findPermissionAnnotation() {
        RequiresPermission onMethod = resourceInfo.getResourceMethod()
            .getAnnotation(RequiresPermission.class);
        if (onMethod != null) {
            return onMethod;
        }
        return resourceInfo.getResourceClass().getAnnotation(RequiresPermission.class);
    }
}
```

Design warning:

```text
Jangan menganggap @RequiresPermission("case:approve") cukup untuk approve case.
```

Masih perlu domain check:

- case exists,
- caller belongs to tenant/agency,
- case is in approvable state,
- caller is not approving own submission if prohibited,
- segregation of duty,
- delegation authority,
- deadline/lock condition,
- appeal/reopen/escalation state.

Filter hanya boundary awal.

---

## 15. Correlation ID Filter Pattern

Correlation ID adalah contoh global concern yang ideal untuk filter.

### 15.1 Request Filter

```java
@Provider
@Priority(Priorities.HEADER_DECORATOR)
public class CorrelationIdRequestFilter implements ContainerRequestFilter {

    public static final String HEADER = "X-Correlation-Id";
    public static final String PROPERTY = "app.correlationId";

    @Override
    public void filter(ContainerRequestContext requestContext) {
        String id = requestContext.getHeaderString(HEADER);
        if (!isValid(id)) {
            id = java.util.UUID.randomUUID().toString();
        }
        requestContext.setProperty(PROPERTY, id);

        // Optional: MDC setup if using SLF4J/logback/log4j2.
        org.slf4j.MDC.put("correlationId", id);
    }

    private boolean isValid(String id) {
        return id != null && id.length() <= 128 && id.matches("[A-Za-z0-9_.:-]+ ".trim());
    }
}
```

### 15.2 Response Filter

```java
@Provider
public class CorrelationIdResponseFilter implements ContainerResponseFilter {

    @Override
    public void filter(ContainerRequestContext requestContext,
                       ContainerResponseContext responseContext) {
        Object id = requestContext.getProperty(CorrelationIdRequestFilter.PROPERTY);
        if (id != null) {
            responseContext.getHeaders().putSingle(CorrelationIdRequestFilter.HEADER, id.toString());
        }
        org.slf4j.MDC.remove("correlationId");
    }
}
```

Masalah penting:

- MDC berbasis ThreadLocal.
- Async request bisa pindah thread.
- Virtual threads bisa mengubah asumsi thread pooling.
- Jika MDC tidak dibersihkan, log request berikutnya bisa tercemar.

Untuk async/virtual-thread environment, context propagation harus dirancang eksplisit.

---

## 16. Access Logging Filter Pattern

Access log yang sehat mencatat metadata, bukan payload mentah.

Contoh:

```java
@Provider
@Priority(Priorities.HEADER_DECORATOR)
public class RequestTimingFilter implements ContainerRequestFilter, ContainerResponseFilter {

    private static final String START = "app.startNanos";

    @Override
    public void filter(ContainerRequestContext requestContext) {
        requestContext.setProperty(START, System.nanoTime());
    }

    @Override
    public void filter(ContainerRequestContext requestContext,
                       ContainerResponseContext responseContext) {
        long durationMicros = -1L;
        Object value = requestContext.getProperty(START);
        if (value instanceof Long) {
            durationMicros = (System.nanoTime() - (Long) value) / 1_000L;
        }

        String method = requestContext.getMethod();
        String path = requestContext.getUriInfo().getPath();
        int status = responseContext.getStatus();

        // Use structured logging in real systems.
        org.slf4j.LoggerFactory.getLogger(getClass()).info(
            "http_request method={} path={} status={} durationMicros={}",
            method,
            path,
            status,
            durationMicros
        );
    }
}
```

Good access log fields:

```text
timestamp
correlationId
traceId/spanId
method
path template if available
raw path if safe
status
duration
request size
response size
principal subject hash/id
tenant id
client app id
remote address / forwarded for with trust rules
user agent if needed
error code
```

Avoid by default:

```text
Authorization header
Cookie header
raw body
password/token/secret
NRIC/NIK/passport fields
full address
free text comments containing PII
large serialized response
```

---

## 17. Entity Stream Problem: Reading Body Twice

Ini salah satu failure mode paling umum.

### 17.1 Salah

```java
@Provider
public class BadBodyLoggingFilter implements ContainerRequestFilter {
    @Override
    public void filter(ContainerRequestContext requestContext) throws IOException {
        String body = new String(requestContext.getEntityStream().readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
        System.out.println(body);
        // BUG: entity stream consumed, MessageBodyReader may receive empty stream.
    }
}
```

Di Java 8, `readAllBytes()` belum ada, tapi masalahnya sama jika membaca stream sampai habis.

### 17.2 Lebih Aman, Tapi Tetap Perlu Limit

```java
@Provider
public class BoundedBodyBufferingFilter implements ContainerRequestFilter {

    private static final int MAX_LOGGABLE_BYTES = 8 * 1024;

    @Override
    public void filter(ContainerRequestContext requestContext) throws IOException {
        if (!requestContext.hasEntity()) {
            return;
        }

        byte[] bytes = readAtMost(requestContext.getEntityStream(), MAX_LOGGABLE_BYTES + 1);

        if (bytes.length <= MAX_LOGGABLE_BYTES) {
            String body = new String(bytes, java.nio.charset.StandardCharsets.UTF_8);
            String masked = mask(body);
            // log masked body only in controlled environments
        }

        requestContext.setEntityStream(new java.io.ByteArrayInputStream(bytes));
    }

    private byte[] readAtMost(java.io.InputStream input, int maxBytes) throws IOException {
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        byte[] buffer = new byte[1024];
        int total = 0;
        int n;
        while ((n = input.read(buffer)) != -1) {
            total += n;
            if (total > maxBytes) {
                throw new PayloadTooLargeForLoggingException();
            }
            out.write(buffer, 0, n);
        }
        return out.toByteArray();
    }

    private String mask(String body) {
        return body.replaceAll("(?i)\\\"password\\\"\\s*:\\s*\\\"[^\\\"]*\\\"", "\"password\":\"***\"");
    }
}
```

Namun desain di atas masih punya masalah:

- hanya cocok untuk body kecil,
- tidak cocok untuk file upload,
- tidak cocok untuk streaming,
- masking regex JSON rapuh,
- charset belum tentu UTF-8,
- request body bisa binary,
- exception dari filter dapat mengubah behavior API.

Production recommendation:

```text
Jangan global log raw body.
Gunakan metadata logging, targeted debug logging, sampling, redaction library, dan environment guard.
```

---

## 18. Idempotency Filter Pattern

Idempotency sering cocok untuk filter jika endpoint command perlu proteksi duplicate submission.

Contoh annotation:

```java
@NameBinding
@Retention(RetentionPolicy.RUNTIME)
@Target({ElementType.METHOD, ElementType.TYPE})
public @interface IdempotentCommand {
}
```

Resource:

```java
@POST
@IdempotentCommand
public Response submit(SubmitApplicationRequest request) {
    return Response.accepted().build();
}
```

Filter konseptual:

```java
@Provider
@IdempotentCommand
@Priority(Priorities.USER - 100)
public class IdempotencyFilter implements ContainerRequestFilter, ContainerResponseFilter {

    private static final String KEY_HEADER = "Idempotency-Key";
    private static final String IDEMPOTENCY_RECORD = "app.idempotencyRecord";

    private final IdempotencyStore store;

    public IdempotencyFilter(IdempotencyStore store) {
        this.store = store;
    }

    @Override
    public void filter(ContainerRequestContext requestContext) {
        String key = requestContext.getHeaderString(KEY_HEADER);
        if (key == null || key.isBlank()) {
            requestContext.abortWith(
                Response.status(Response.Status.BAD_REQUEST)
                    .entity(new ErrorResponse("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required"))
                    .build()
            );
            return;
        }

        IdempotencyDecision decision = store.tryStart(key, requestFingerprint(requestContext));

        if (decision.isReplay()) {
            requestContext.abortWith(decision.toStoredResponse());
            return;
        }

        if (decision.isConflict()) {
            requestContext.abortWith(
                Response.status(Response.Status.CONFLICT)
                    .entity(new ErrorResponse("IDEMPOTENCY_CONFLICT", "Idempotency key is already used with a different request"))
                    .build()
            );
            return;
        }

        requestContext.setProperty(IDEMPOTENCY_RECORD, decision.recordId());
    }

    @Override
    public void filter(ContainerRequestContext requestContext,
                       ContainerResponseContext responseContext) {
        Object record = requestContext.getProperty(IDEMPOTENCY_RECORD);
        if (record != null && responseContext.getStatus() < 500) {
            store.complete(record.toString(), responseContext);
        }
    }

    private String requestFingerprint(ContainerRequestContext requestContext) {
        // Real implementation must include method, path, selected stable headers, and usually body hash.
        return requestContext.getMethod() + " " + requestContext.getUriInfo().getPath();
    }
}
```

Important caveat:

> Idempotency based only on method/path is insufficient for most real systems.

Usually you need:

- tenant id,
- authenticated subject/client id,
- HTTP method,
- canonical path,
- normalized query if relevant,
- body hash,
- operation name,
- idempotency key,
- TTL,
- status lifecycle: started/completed/failed,
- concurrency lock.

For regulatory/case-management systems, idempotency should often be integrated with domain command table, not only HTTP filter.

---

## 19. Rate Limiting Filter Pattern

Rate limiting can be done at:

- API gateway,
- load balancer/WAF,
- service mesh,
- application filter,
- domain/service layer.

Application-level filter is useful when limiter key depends on application identity:

- tenant,
- agency,
- user,
- client app,
- operation,
- entitlement tier.

Example:

```java
@Provider
@Priority(Priorities.AUTHORIZATION + 100)
public class RateLimitFilter implements ContainerRequestFilter {

    private final RateLimiterService limiter;

    public RateLimitFilter(RateLimiterService limiter) {
        this.limiter = limiter;
    }

    @Override
    public void filter(ContainerRequestContext requestContext) {
        String tenantId = (String) requestContext.getProperty("app.tenantId");
        String path = requestContext.getUriInfo().getPath();

        RateLimitDecision decision = limiter.allow(tenantId, path);
        if (!decision.allowed()) {
            requestContext.abortWith(
                Response.status(429)
                    .header("Retry-After", decision.retryAfterSeconds())
                    .entity(new ErrorResponse("RATE_LIMITED", "Too many requests"))
                    .build()
            );
        }
    }
}
```

Production consideration:

- distributed counter consistency,
- Redis/network failure behavior,
- local fallback,
- fail-open vs fail-closed,
- clock skew,
- burst vs sustained limit,
- retry-after correctness,
- observability,
- fairness across tenants.

---

## 20. Audit Filter Pattern

Audit is tricky.

HTTP filter can see:

- method,
- path,
- headers,
- user principal,
- status,
- timing,
- selected operation metadata.

But HTTP filter often cannot reliably know:

- domain entity final state,
- transaction commit success,
- workflow transition details,
- generated IDs if not exposed,
- before/after values,
- business rule decision path,
- whether DB commit later failed.

Therefore:

```text
Use filter for audit envelope.
Use service/domain layer for authoritative business audit.
```

Example filter use:

```java
@Provider
public class AuditEnvelopeFilter implements ContainerRequestFilter, ContainerResponseFilter {

    @Override
    public void filter(ContainerRequestContext requestContext) {
        requestContext.setProperty("audit.start", System.currentTimeMillis());
    }

    @Override
    public void filter(ContainerRequestContext requestContext,
                       ContainerResponseContext responseContext) {
        // Emit HTTP access audit, not final domain audit.
        // Include operation name if provided by DynamicFeature/name binding.
    }
}
```

For regulatory systems, audit invariant should answer:

```text
who
did what
to which object
under what authority
with what input summary
from which channel
at what time
resulting in what state transition
with which decision reason
under which correlation/request id
```

A filter alone cannot guarantee all of that.

---

## 21. CORS Filter

CORS often appears as filter code, but in production it should be carefully controlled.

Example simplified response filter:

```java
@Provider
public class CorsResponseFilter implements ContainerResponseFilter {

    private final java.util.Set<String> allowedOrigins = java.util.Set.of(
        "https://app.example.com"
    );

    @Override
    public void filter(ContainerRequestContext requestContext,
                       ContainerResponseContext responseContext) {
        String origin = requestContext.getHeaderString("Origin");
        if (origin != null && allowedOrigins.contains(origin)) {
            responseContext.getHeaders().putSingle("Access-Control-Allow-Origin", origin);
            responseContext.getHeaders().putSingle("Vary", "Origin");
            responseContext.getHeaders().putSingle("Access-Control-Allow-Credentials", "true");
        }
    }
}
```

Preflight handling:

```java
@Provider
@PreMatching
public class CorsPreflightFilter implements ContainerRequestFilter {

    @Override
    public void filter(ContainerRequestContext requestContext) {
        if (!"OPTIONS".equalsIgnoreCase(requestContext.getMethod())) {
            return;
        }

        String origin = requestContext.getHeaderString("Origin");
        String requestMethod = requestContext.getHeaderString("Access-Control-Request-Method");

        if (origin != null && requestMethod != null && isAllowed(origin, requestMethod)) {
            Response response = Response.noContent()
                .header("Access-Control-Allow-Origin", origin)
                .header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
                .header("Access-Control-Allow-Headers", "Authorization,Content-Type,X-Correlation-Id,Idempotency-Key")
                .header("Access-Control-Max-Age", "600")
                .header("Vary", "Origin")
                .build();
            requestContext.abortWith(response);
        }
    }

    private boolean isAllowed(String origin, String method) {
        return "https://app.example.com".equals(origin);
    }
}
```

CORS warning:

- `Access-Control-Allow-Origin: *` with credentials is invalid/unsafe.
- CORS is browser security policy, not service-to-service auth.
- Do not use CORS as authorization.
- Prefer gateway/platform CORS when possible for consistency.

---

## 22. Header Mutation and Pre-Matching Method Override

Pre-matching filter can mutate method/URI in some implementations/spec allowances.

Example legacy method override:

```java
@Provider
@PreMatching
public class MethodOverrideFilter implements ContainerRequestFilter {

    @Override
    public void filter(ContainerRequestContext requestContext) {
        String override = requestContext.getHeaderString("X-HTTP-Method-Override");
        if (override == null) {
            return;
        }

        if ("PATCH".equalsIgnoreCase(override) && "POST".equalsIgnoreCase(requestContext.getMethod())) {
            requestContext.setMethod("PATCH");
        }
    }
}
```

Use sparingly.

Risks:

- audit confusion,
- security policy bypass,
- gateway mismatch,
- client behavior ambiguity,
- logs show POST but resource sees PATCH unless both are recorded.

If used, log both original and effective method.

---

## 23. Response Entity Mutation in Filter

`ContainerResponseContext` lets you inspect/change entity:

```java
@Provider
public class ResponseEnvelopeFilter implements ContainerResponseFilter {

    @Override
    public void filter(ContainerRequestContext requestContext,
                       ContainerResponseContext responseContext) {
        if (responseContext.hasEntity() && shouldWrap(requestContext, responseContext)) {
            Object original = responseContext.getEntity();
            responseContext.setEntity(new ApiEnvelope<>(original));
        }
    }

    private boolean shouldWrap(ContainerRequestContext requestContext,
                               ContainerResponseContext responseContext) {
        return responseContext.getStatus() >= 200 && responseContext.getStatus() < 300;
    }
}
```

Namun ini sering menjadi anti-pattern.

Masalah:

- entity type berubah setelah resource method,
- provider selection bisa berubah,
- OpenAPI/contract menjadi tidak jelas,
- streaming/file response bisa rusak,
- generic type hilang,
- error response bisa inconsistent,
- response filter menjadi hidden framework.

Lebih baik resource/helper secara eksplisit mengembalikan envelope jika itu memang kontrak API.

---

## 24. Filters and Exception Flow

Filter dapat:

1. `abortWith(response)`,
2. throw `WebApplicationException`,
3. throw custom exception,
4. throw `IOException`,
5. allow request to continue.

Perbedaannya:

```text
abortWith:
  expected boundary rejection, explicit response.

throw WebApplicationException:
  error path through exception mapping/default mapping.

throw custom exception:
  requires ExceptionMapper for consistency.

throw IOException:
  usually infrastructure-ish failure.
```

Guideline:

| Situation | Recommended |
|---|---|
| Missing token | `abortWith(401)` or throw mapped auth exception |
| Invalid permission | `abortWith(403)` or throw mapped authz exception |
| Rate limited | `abortWith(429)` |
| Unexpected null pointer | throw; do not convert to 400 |
| Downstream auth introspection timeout | throw mapped dependency exception or `abortWith(503)` depending architecture |
| Payload too large from filter check | `abortWith(413)` |

Consistency matters more than style. Pick one architecture and standardize.

---

## 25. Client-Side Filters and Interceptors

Jersey also supports client filters/interceptors.

Server-side:

```text
ContainerRequestFilter
ContainerResponseFilter
ReaderInterceptor
WriterInterceptor
```

Client-side:

```text
ClientRequestFilter
ClientResponseFilter
ReaderInterceptor
WriterInterceptor
```

Client request filter example:

```java
public class ClientCorrelationFilter implements ClientRequestFilter {

    private final CorrelationIdProvider provider;

    public ClientCorrelationFilter(CorrelationIdProvider provider) {
        this.provider = provider;
    }

    @Override
    public void filter(ClientRequestContext requestContext) {
        requestContext.getHeaders().putSingle("X-Correlation-Id", provider.currentOrNew());
    }
}
```

Client response filter:

```java
public class ClientErrorLoggingFilter implements ClientResponseFilter {
    @Override
    public void filter(ClientRequestContext requestContext,
                       ClientResponseContext responseContext) {
        int status = responseContext.getStatus();
        if (status >= 500) {
            // log dependency failure metadata, not raw body by default
        }
    }
}
```

Client-side use cases:

- correlation propagation,
- auth token injection,
- dependency metrics,
- retry metadata,
- request signing,
- response signature verification,
- safe logging,
- header normalization.

Do not confuse server `ContainerRequestFilter` with client `ClientRequestFilter`.

---

## 26. Jersey-Specific Considerations

Jersey implements Jakarta REST/JAX-RS APIs, but real behavior also depends on Jersey modules and configuration.

Key Jersey-specific points:

1. Provider registration can be explicit or discovered.
2. Auto-discovery can surprise production behavior.
3. HK2 injection may create filter/provider instances depending registration style.
4. `DynamicFeature` is powerful for Jersey platform modules.
5. Jersey has documentation and examples for filters/interceptors on both server and client.
6. Jersey entity logging features exist, but must be used cautiously in production.

Recommended registration style for production:

```java
public class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        register(CorrelationIdRequestFilter.class);
        register(CorrelationIdResponseFilter.class);
        register(AuthenticationFilter.class);
        register(PermissionAuthorizationFilter.class);
        register(AuditDynamicFeature.class);
        register(GlobalExceptionMapper.class);
    }
}
```

Avoid relying entirely on classpath scanning for critical filters.

---

## 27. Java 8–25 Considerations

### 27.1 Java 8

Constraints:

- no `InputStream.readAllBytes()`;
- no records;
- no pattern matching;
- no virtual threads;
- older TLS/runtime defaults;
- often paired with Jersey 2.x / `javax.ws.rs`.

Code style:

```java
if (principal instanceof AuthenticatedUser) {
    AuthenticatedUser user = (AuthenticatedUser) principal;
}
```

### 27.2 Java 11

Relevant changes:

- better runtime baseline,
- `InputStream.readAllBytes()` exists,
- modern TLS improvements,
- still no virtual threads.

### 27.3 Java 17

Important because Jakarta REST 4.0 minimum is Java SE 17.

Useful language features:

- records for DTO/error response,
- sealed classes for error taxonomy,
- pattern matching for instanceof,
- better GC/runtime behavior.

Example error response record:

```java
public record ErrorResponse(
    String code,
    String message,
    String correlationId
) {}
```

### 27.4 Java 21

Virtual threads become generally available.

Impact on filters:

- ThreadLocal/MDC assumptions need review.
- Blocking token introspection may scale better but still needs timeout.
- Pinning risk if synchronized/native blocking exists.
- Request-scoped data should remain request-context-driven, not raw ThreadLocal-driven.

### 27.5 Java 25

As a newer LTS, Java 25 matters for long-lived platform planning.

For filters/interceptors:

- prefer explicit context propagation,
- avoid hidden thread affinity,
- measure allocation and stream buffering,
- keep API source compatible if maintaining Java 8 branch separately.

---

## 28. Production Ordering Blueprint

A clean pipeline blueprint:

```text
Pre-matching request phase:
  001 Request envelope guard
  010 Correlation ID setup
  020 Forwarded/proxy header normalization
  030 CORS preflight if app-owned
  040 Method override only if explicitly supported

Post-matching request phase:
  100 Authentication
  110 Tenant resolution
  120 Authorization coarse check
  130 Feature flag / maintenance policy
  140 Rate limit
  150 Idempotency start
  160 Audit envelope start

Entity read phase:
  200 Request decompression/decryption/signature verification
  210 Body size counting
  220 MessageBodyReader

Resource execution:
  300 Resource method
  310 Service/domain transaction
  320 Domain audit

Exception phase:
  400 ExceptionMapper

Entity write phase:
  500 WriterInterceptor
  510 MessageBodyWriter

Response phase:
  600 Idempotency complete
  610 Security/cache/deprecation headers
  620 Correlation ID response header
  630 Metrics/access log finalization
  640 MDC cleanup
```

The exact numbers are conceptual. But the ordering principle matters.

---

## 29. Failure Modes and Diagnosis

### 29.1 Filter Not Running

Possible causes:

- not registered,
- package not scanned,
- missing `@Provider`,
- wrong `javax` vs `jakarta` import,
- name binding annotation missing on resource/method,
- DynamicFeature condition not met,
- provider disabled by config,
- resource matching failed before post-matching filter.

Diagnosis:

```text
1. Confirm registration in ResourceConfig.
2. Confirm package/class scanning.
3. Confirm namespace: javax vs jakarta.
4. Confirm @Provider or explicit register.
5. Confirm global vs name-bound expectation.
6. Add startup log in constructor/configure if needed.
7. Test with JerseyTest.
```

### 29.2 Filter Runs Too Late

Possible causes:

- missing `@PreMatching`,
- wrong priority,
- relying on registration order,
- response filter reverse ordering misunderstood.

Diagnosis:

- add structured debug log with filter name and phase,
- inspect priority values,
- write pipeline order test.

### 29.3 Body Empty in Resource Method

Likely causes:

- request filter consumed entity stream,
- reader interceptor did not call `context.proceed()`,
- stream replaced incorrectly,
- logging feature consumed body unexpectedly,
- multipart provider conflict.

Diagnosis:

```text
1. Search all filters/interceptors reading entity stream.
2. Confirm setEntityStream is called after buffering.
3. Check request Content-Type.
4. Check MessageBodyReader availability.
5. Disable body logging and retest.
```

### 29.4 Response Correlation Header Missing on Error

Possible causes:

- response filter not global,
- exception happened before Jersey response phase,
- container-level error outside Jersey,
- filter order/MDC cleanup issue,
- error produced by gateway/container.

Diagnosis:

- test resource exception,
- test 404/405/415,
- test servlet mapping miss,
- test container-level failure.

### 29.5 Authorization Not Applied

Possible causes:

- annotation on interface not seen as expected,
- annotation placed on wrong method/class,
- sub-resource locator behavior,
- DynamicFeature did not register,
- filter registered globally but logic fails to inspect class-level annotation,
- proxy class hides annotation.

Diagnosis:

- log `ResourceInfo.getResourceClass()` and `getResourceMethod()` in lower env,
- add unit test per secured endpoint,
- create security coverage test that scans resource model.

### 29.6 Memory Spike

Possible causes:

- body buffering filter,
- response buffering/compression,
- payload logging,
- large multipart upload,
- ByteArrayOutputStream without bound,
- reading response entity in client filter without restoring stream.

Diagnosis:

- heap dump,
- allocation profile,
- check filters/interceptors for byte arrays,
- inspect payload size distribution.

---

## 30. Testing Filters and Interceptors

### 30.1 Unit Test Business Logic Outside Filter

Filter should be thin.

Example:

```text
AuthenticationFilter
  -> delegates to TokenVerifier
  -> delegates to SecurityContextFactory
```

Unit test `TokenVerifier` and `SecurityContextFactory` separately.

### 30.2 JerseyTest for Runtime Behavior

Test:

- filter registration,
- priority behavior,
- abortWith response,
- response headers,
- entity stream preservation,
- name-bound filter activation,
- DynamicFeature binding,
- exception mapping interaction.

Example conceptual:

```java
public class CorrelationFilterTest extends JerseyTest {

    @Override
    protected Application configure() {
        return new ResourceConfig()
            .register(TestResource.class)
            .register(CorrelationIdRequestFilter.class)
            .register(CorrelationIdResponseFilter.class);
    }

    @Test
    public void shouldReturnCorrelationId() {
        Response response = target("test")
            .request()
            .header("X-Correlation-Id", "abc-123")
            .get();

        assertEquals("abc-123", response.getHeaderString("X-Correlation-Id"));
    }
}
```

### 30.3 Pipeline Order Test

Create filters that append their name to request property/list and assert final order.

This is useful for platform modules.

### 30.4 Security Coverage Test

For regulated systems, test all mutating endpoints have required security/audit annotation.

Pseudo:

```text
for each resource method:
  if HTTP method in POST/PUT/PATCH/DELETE:
    assert has @RequiresPermission
    assert has @AuditedOperation
```

This catches human omission.

---

## 31. Design Heuristics

Use these heuristics when deciding whether to implement something as filter/interceptor.

### 31.1 Good Filter Concern

A concern is a good filter candidate if:

```text
- it is HTTP-boundary concern,
- it applies consistently across many endpoints,
- it depends on request/response metadata,
- it should happen before/after resource method,
- it can be tested independently,
- it does not require deep domain state.
```

Examples:

- correlation ID,
- authentication,
- coarse authorization,
- CORS,
- access logging,
- security headers,
- idempotency envelope,
- rate limit envelope,
- request size guard.

### 31.2 Bad Filter Concern

A concern is usually bad for filter if:

```text
- it requires transaction consistency,
- it mutates domain state,
- it needs detailed business invariant,
- it transforms DTO invisibly,
- it reads/writes large body unnecessarily,
- it hides API contract,
- it depends on fragile ordering with many unrelated filters.
```

Examples:

- final domain audit only in response filter,
- workflow transition logic,
- DTO envelope wrapping globally without explicit contract,
- business validation,
- persistence transaction control,
- entity lazy-loading workaround.

---

## 32. Practical Blueprint: Platform Filters for Enterprise Jersey API

A good internal Jersey platform module might provide:

```text
app-jersey-platform
  /correlation
    CorrelationIdRequestFilter
    CorrelationIdResponseFilter
    CorrelationContext
  /security
    BearerAuthenticationFilter
    PermissionAuthorizationFilter
    SecurityContextFactory
  /error
    ProblemDetailsExceptionMapper
    ErrorResponseFactory
  /observability
    AccessLogFilter
    MetricsFilter
    TracingFeature
  /audit
    AuditedOperation annotation
    AuditDynamicFeature
    AuditEnvelopeFilter
  /idempotency
    IdempotentCommand annotation
    IdempotencyDynamicFeature
    IdempotencyFilter
  /http
    SecurityHeadersFilter
    CachePolicyFilter
  /testing
    JerseyPipelineTestSupport
    ResourceAnnotationScanner
```

Registration:

```java
public class PlatformFeature implements Feature {
    @Override
    public boolean configure(FeatureContext context) {
        context.register(CorrelationIdRequestFilter.class);
        context.register(CorrelationIdResponseFilter.class);
        context.register(SecurityHeadersResponseFilter.class);
        context.register(AccessLogFilter.class);
        context.register(AuditDynamicFeature.class);
        context.register(IdempotencyDynamicFeature.class);
        return true;
    }
}
```

Application:

```java
public class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        register(new PlatformFeature());
        packages("com.example.api.resources");
    }
}
```

Production note:

Do not make platform feature too magical. Every behavior should be documented:

- when it runs,
- what headers it reads/writes,
- what request properties it sets,
- what exceptions/responses it can produce,
- how to disable/configure it,
- how to test it.

---

## 33. Checklist

### 33.1 Filter Design Checklist

```text
[ ] Is this concern metadata-level or entity-stream-level?
[ ] Should it be a filter or interceptor?
[ ] Should it run pre-matching or post-matching?
[ ] Should it be global, name-bound, or DynamicFeature-bound?
[ ] What priority should it have?
[ ] Does it abort requests? With what error contract?
[ ] Does it throw exceptions? Are they mapped?
[ ] Does it read entity stream? If yes, is it bounded and restored?
[ ] Does it log sensitive data?
[ ] Does it use ThreadLocal/MDC? Is cleanup guaranteed?
[ ] Does it work with async/virtual threads?
[ ] Does it affect 404/405/406/415 responses?
[ ] Does it work with streaming/multipart endpoints?
[ ] Is behavior covered by Jersey runtime tests?
```

### 33.2 Production Safety Checklist

```text
[ ] Critical filters are explicitly registered.
[ ] Priority values are documented.
[ ] Correlation ID appears on success and mapped error responses.
[ ] Access logs do not expose secrets/PII.
[ ] Authentication failure is 401; authorization failure is 403.
[ ] Rate limit returns 429 with reasonable Retry-After.
[ ] Body logging is disabled or tightly controlled in production.
[ ] Response filters do not wrap file/streaming responses accidentally.
[ ] MDC/ThreadLocal cleanup is tested.
[ ] Security annotation coverage is tested for mutating endpoints.
[ ] javax/jakarta namespace is consistent.
[ ] Java 8 and Java 17+ code paths are separated if supporting both.
```

---

## 34. Mini Exercises

### Exercise 1

Design a filter chain for an API with:

- public health endpoint,
- authenticated business endpoints,
- admin endpoints,
- idempotent submit endpoint,
- audit-required approval endpoint.

Decide which filters are global, which are name-bound, and which are DynamicFeature-bound.

### Exercise 2

Implement a correlation ID request/response filter pair.

Requirements:

- accept incoming `X-Correlation-Id`,
- validate max length,
- generate if missing,
- put into response header,
- put into MDC,
- cleanup MDC.

Then test success and exception response.

### Exercise 3

Create a name-bound `@AuditedOperation` annotation.

Requirements:

- annotation can be on class or method,
- DynamicFeature extracts operation name,
- filter stores operation name in request property,
- response filter logs operation + status.

### Exercise 4

Write a failing test that proves reading request body in `ContainerRequestFilter` breaks JSON deserialization.

Then fix it by restoring `setEntityStream` with bounded buffer.

### Exercise 5

Create a security coverage scanner for resource classes.

Rule:

```text
Every POST/PUT/PATCH/DELETE method must have @RequiresPermission and @AuditedOperation.
```

---

## 35. Summary

Filters and interceptors are not just extension hooks. They are the control surface of Jersey's HTTP pipeline.

Core mental model:

```text
Filters handle request/response metadata.
Interceptors handle entity streams.
Pre-matching happens before resource selection.
Post-matching happens after resource selection.
Name binding limits a provider to annotated resource methods/classes.
DynamicFeature lets you bind providers programmatically based on resource metadata.
Priority makes ordering explicit.
```

The most important production lessons:

1. Do not read entity streams casually.
2. Do not hide business logic inside filters.
3. Do not rely on provider discovery for critical security behavior.
4. Keep authentication, authorization, audit, idempotency, and logging boundaries separate.
5. Test pipeline behavior through Jersey runtime, not only unit mocks.
6. Treat filter order as architecture, not incidental implementation.

When designed well, filters/interceptors make Jersey applications consistent, observable, secure, and easier to govern. When designed poorly, they create hidden behavior, fragile ordering, security gaps, body-stream bugs, and production incidents that are hard to diagnose.

---

## 36. Posisi dalam Series

Selesai:

```text
Part 0  — Orientasi Seri
Part 1  — Jersey Mental Model
Part 2  — Application Bootstrap
Part 3  — Resource Model Internals
Part 4  — Request Matching Deep Dive
Part 5  — Parameter Injection Semantics
Part 6  — Entity Provider Pipeline
Part 7  — JSON in Jersey
Part 8  — Response Engineering
Part 9  — Exception Mapping Architecture
Part 10 — Filters and Interceptors
```

Berikutnya:

```text
Part 11 — Jersey Injection Model: HK2, Binder, Factories, Scopes, and Lifecycle
```

Status seri: **belum selesai**. Masih ada Part 11 sampai Part 32.

