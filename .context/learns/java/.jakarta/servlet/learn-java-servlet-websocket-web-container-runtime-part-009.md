# learn-java-servlet-websocket-web-container-runtime-part-009

# Part 009 — Filters: Cross-Cutting Boundary Before Frameworks

> Seri: `learn-java-servlet-websocket-web-container-runtime`  
> Part: `009 / 031`  
> Topik: Servlet Filter, FilterChain, dispatcher type, wrapper, cross-cutting boundary, dan failure modelling  
> Target: memahami filter sebagai boundary runtime, bukan sekadar tempat menaruh logging/CORS/security kecil-kecilan.

---

## 0. Posisi Part Ini Dalam Seri

Pada part sebelumnya kita sudah membahas:

1. HTTP sebagai protokol.
2. Container architecture.
3. Servlet lifecycle.
4. Request object.
5. Response object.
6. Servlet mapping.
7. Request dispatching: `forward`, `include`, `error`, dan `async`.

Sekarang kita masuk ke salah satu mekanisme paling penting di Servlet runtime: **Filter**.

Filter adalah komponen yang berdiri **di antara container dispatch dan target resource**.

Target resource bisa berupa:

- servlet langsung,
- framework front controller seperti Spring `DispatcherServlet`,
- JAX-RS servlet,
- JSP,
- static resource,
- error page,
- async dispatch target,
- forwarded/included resource.

Karena filter berada sebelum framework, banyak concern yang tampak sebagai “framework concern” sebenarnya dimulai di filter boundary.

Contoh:

- request correlation id,
- access logging,
- CORS,
- request body caching,
- response wrapping,
- compression,
- rate limiting,
- tenant resolution,
- reverse proxy normalization,
- authentication bootstrap,
- security headers,
- audit metadata,
- error normalization,
- MDC cleanup,
- async context propagation.

Namun filter juga mudah menjadi sumber bug besar jika salah memahami lifecycle dan chain semantics.

---

## 1. Mental Model Utama

### 1.1 Filter bukan servlet

Servlet adalah target request. Filter adalah interceptor yang mengelilingi target request.

Secara konseptual:

```text
Client
  ↓
Container connector
  ↓
Context selection
  ↓
Servlet mapping
  ↓
Matched filters
  ↓
Filter 1 pre-processing
  ↓
Filter 2 pre-processing
  ↓
Filter 3 pre-processing
  ↓
Target servlet / resource
  ↑
Filter 3 post-processing
  ↑
Filter 2 post-processing
  ↑
Filter 1 post-processing
  ↑
Response to client
```

Filter adalah **chain of responsibility**.

Setiap filter memutuskan:

1. Apakah request diteruskan ke filter/resource berikutnya?
2. Apakah request/response dibungkus?
3. Apakah response ditulis langsung?
4. Apakah exception dibiarkan naik?
5. Apakah cleanup dilakukan setelah downstream selesai?

---

### 1.2 Filter bekerja di level runtime boundary

Filter melihat request sebelum business code melihatnya.

Karena itu filter cocok untuk concern yang:

- berlaku lintas endpoint,
- harus konsisten sebelum framework routing,
- perlu melihat raw servlet request/response,
- perlu mengatur lifecycle request,
- perlu cleanup walaupun endpoint gagal,
- perlu mengontrol apakah request boleh masuk lebih jauh.

Filter buruk untuk concern yang:

- sangat domain-specific,
- membutuhkan rich business model,
- bergantung pada handler method framework,
- bergantung pada transaction boundary application service,
- membutuhkan authorization granular berbasis aggregate state,
- menghasilkan logic bercabang terlalu kompleks.

Rule of thumb:

> Filter adalah tempat bagus untuk **protocol/runtime policy**.  
> Filter bukan tempat bagus untuk **business workflow policy**.

---

### 1.3 Filter adalah state machine kecil

Setiap filter punya state machine implisit:

```text
CREATED
  ↓
INIT
  ↓
READY
  ↓
DO_FILTER_ENTERED
  ↓
[short-circuit OR chain.doFilter]
  ↓
DOWNSTREAM_RETURNED / DOWNSTREAM_THROWN
  ↓
POST_PROCESS / CLEANUP
  ↓
READY
  ↓
DESTROY
```

Di dalam satu request:

```text
ENTER
  ↓
validate / enrich / wrap / decide
  ↓
CALL_CHAIN? ── no ──> write response / send error / return
  ↓ yes
chain.doFilter(...)
  ↓
post-process / cleanup
  ↓
return to previous filter/container
```

Bug filter sering muncul karena developer lupa bahwa `chain.doFilter()` bukan “lanjut saja”. Ia adalah **call boundary** yang bisa:

- menulis response,
- commit response,
- throw exception,
- start async,
- forward request,
- include resource,
- dispatch error,
- return setelah response sudah selesai,
- return sebelum async processing selesai.

---

## 2. API Dasar Filter

Pada Jakarta Servlet modern, package-nya:

```java
import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.FilterConfig;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
```

Pada Java EE legacy:

```java
import javax.servlet.Filter;
import javax.servlet.FilterChain;
import javax.servlet.FilterConfig;
import javax.servlet.ServletException;
import javax.servlet.ServletRequest;
import javax.servlet.ServletResponse;
```

Perbedaan utamanya package namespace, bukan konsep.

---

## 3. Bentuk Minimal Filter

```java
package com.example.web;

import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.FilterConfig;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;

import java.io.IOException;

public final class SimpleFilter implements Filter {

    @Override
    public void init(FilterConfig filterConfig) throws ServletException {
        // Dipanggil container sekali saat filter dibuat.
    }

    @Override
    public void doFilter(
            ServletRequest request,
            ServletResponse response,
            FilterChain chain
    ) throws IOException, ServletException {
        // Pre-processing
        chain.doFilter(request, response);
        // Post-processing
    }

    @Override
    public void destroy() {
        // Dipanggil container saat filter dikeluarkan dari service.
    }
}
```

Sejak Servlet 4+/Jakarta Servlet, `Filter` memiliki default method untuk `init` dan `destroy`, sehingga filter sederhana dapat hanya override `doFilter`.

```java
public final class MinimalFilter implements Filter {
    @Override
    public void doFilter(
            ServletRequest request,
            ServletResponse response,
            FilterChain chain
    ) throws IOException, ServletException {
        chain.doFilter(request, response);
    }
}
```

Tetapi untuk materi advanced, lebih baik tetap memahami lifecycle penuh.

---

## 4. `Filter`, `FilterChain`, dan `FilterConfig`

### 4.1 `Filter`

`Filter` adalah komponen yang bisa melakukan filtering pada request menuju resource, response dari resource, atau keduanya.

Method penting:

```java
void init(FilterConfig filterConfig) throws ServletException;

void doFilter(
    ServletRequest request,
    ServletResponse response,
    FilterChain chain
) throws IOException, ServletException;

void destroy();
```

Maknanya:

| Method | Dipanggil oleh | Frekuensi | Fungsi |
|---|---|---:|---|
| `init` | container | sekali per filter instance | baca config, siapkan resource |
| `doFilter` | container | setiap matching request/dispatch | filtering utama |
| `destroy` | container | sekali saat shutdown/redeploy | cleanup resource |

---

### 4.2 `FilterChain`

`FilterChain` adalah object container yang mewakili sisa chain.

```java
chain.doFilter(request, response);
```

Berarti:

> “Container, lanjutkan request ini ke filter berikutnya. Jika sudah tidak ada filter berikutnya, panggil target resource.”

Jika filter tidak memanggil `chain.doFilter`, maka downstream tidak pernah jalan.

Itu bisa benar:

- request ditolak,
- rate limit exceeded,
- CORS preflight dijawab langsung,
- maintenance mode,
- authentication failed,
- invalid request size,
- invalid tenant,
- blocked IP.

Tapi bisa juga bug fatal:

- lupa panggil chain,
- return terlalu awal,
- exception tertelan,
- conditional branch tidak lengkap.

---

### 4.3 `FilterConfig`

`FilterConfig` memberi akses ke:

- nama filter,
- init parameter filter,
- `ServletContext`.

Contoh:

```java
public final class ConfigurableFilter implements Filter {

    private boolean enabled;

    @Override
    public void init(FilterConfig config) {
        this.enabled = Boolean.parseBoolean(
                config.getInitParameter("enabled")
        );
    }

    @Override
    public void doFilter(
            ServletRequest request,
            ServletResponse response,
            FilterChain chain
    ) throws IOException, ServletException {
        if (!enabled) {
            chain.doFilter(request, response);
            return;
        }

        // filtering logic
        chain.doFilter(request, response);
    }
}
```

Perhatikan: field `enabled` dibaca banyak thread. Jika di-set hanya pada `init` dan tidak diubah lagi, aman secara praktis karena lifecycle container menyiapkan filter sebelum request masuk. Untuk konfigurasi runtime mutable, gunakan mekanisme thread-safe.

---

## 5. Registrasi Filter

Ada beberapa cara utama.

---

### 5.1 `web.xml`

```xml
<filter>
    <filter-name>correlationIdFilter</filter-name>
    <filter-class>com.example.web.CorrelationIdFilter</filter-class>
</filter>

<filter-mapping>
    <filter-name>correlationIdFilter</filter-name>
    <url-pattern>/*</url-pattern>
    <dispatcher>REQUEST</dispatcher>
    <dispatcher>ERROR</dispatcher>
</filter-mapping>
```

Kelebihan:

- ordering jelas sesuai urutan deklarasi mapping,
- cocok untuk legacy enterprise app,
- bisa externalize wiring tanpa annotation scanning,
- eksplisit untuk deployment descriptor.

Kekurangan:

- verbose,
- raw string,
- bisa drift dengan code,
- sulit dipahami jika web.xml besar.

---

### 5.2 Annotation `@WebFilter`

```java
package com.example.web;

import jakarta.servlet.annotation.WebFilter;
import jakarta.servlet.DispatcherType;

@WebFilter(
    filterName = "correlationIdFilter",
    urlPatterns = "/*",
    dispatcherTypes = {
        DispatcherType.REQUEST,
        DispatcherType.ERROR
    },
    asyncSupported = true
)
public final class CorrelationIdFilter implements Filter {
    @Override
    public void doFilter(
            ServletRequest request,
            ServletResponse response,
            FilterChain chain
    ) throws IOException, ServletException {
        chain.doFilter(request, response);
    }
}
```

Kelebihan:

- dekat dengan code,
- ringkas,
- mudah untuk aplikasi kecil/medium.

Kekurangan:

- ordering antar annotation bisa lebih sulit dikontrol,
- pada aplikasi besar, scanning dan implicit wiring bisa membingungkan,
- framework sering punya registration mechanism sendiri.

---

### 5.3 Programmatic Registration

Dengan `ServletContext`:

```java
public final class AppInitializer implements ServletContainerInitializer {
    @Override
    public void onStartup(Set<Class<?>> classes, ServletContext ctx) {
        FilterRegistration.Dynamic registration =
                ctx.addFilter("correlationIdFilter", new CorrelationIdFilter());

        registration.setAsyncSupported(true);
        registration.addMappingForUrlPatterns(
                EnumSet.of(DispatcherType.REQUEST, DispatcherType.ERROR),
                false,
                "/*"
        );
    }
}
```

Atau di framework seperti Spring Boot, biasanya lewat `FilterRegistrationBean`.

Kelebihan:

- dynamic,
- bisa conditional by environment,
- mudah menentukan order pada framework tertentu,
- cocok untuk library/infrastructure module.

Kekurangan:

- lifecycle lebih implicit,
- perlu paham kapan initializer dipanggil,
- mudah konflik dengan annotation/web.xml.

---

## 6. Filter Mapping

Filter bisa dipetakan berdasarkan:

1. URL pattern.
2. Servlet name.
3. Dispatcher type.

---

### 6.1 URL Pattern Mapping

```xml
<filter-mapping>
    <filter-name>auditFilter</filter-name>
    <url-pattern>/api/*</url-pattern>
</filter-mapping>
```

Filter hanya berlaku untuk URL yang cocok.

Contoh umum:

| Pattern | Makna |
|---|---|
| `/*` | semua request dalam context |
| `/api/*` | semua path di bawah `/api` |
| `*.jsp` | semua JSP |
| `/download/*` | endpoint download |
| `/internal/*` | endpoint internal |

---

### 6.2 Servlet Name Mapping

```xml
<filter-mapping>
    <filter-name>mvcFilter</filter-name>
    <servlet-name>dispatcherServlet</servlet-name>
</filter-mapping>
```

Ini berguna jika ingin filter mengikuti servlet tertentu, bukan URL tertentu.

Contoh:

- filter hanya untuk Spring DispatcherServlet,
- filter hanya untuk JAX-RS servlet,
- filter hanya untuk file servlet custom,
- filter tidak berlaku untuk static resource.

---

### 6.3 Dispatcher Type Mapping

Dispatcher type menentukan **kapan** filter dijalankan.

Enum modern:

```java
jakarta.servlet.DispatcherType
```

Nilai utama:

| Dispatcher Type | Kapan terjadi |
|---|---|
| `REQUEST` | request langsung dari client |
| `FORWARD` | request diteruskan via `RequestDispatcher.forward` |
| `INCLUDE` | output resource lain disertakan via `include` |
| `ERROR` | error dispatch ke error page/handler |
| `ASYNC` | async dispatch setelah `startAsync` |

Ini sangat penting.

Filter yang dipetakan hanya ke `REQUEST` tidak otomatis jalan pada `ERROR`, `FORWARD`, atau `ASYNC`.

---

## 7. Filter Ordering

### 7.1 Ordering bukan detail kecil

Urutan filter bisa mengubah behavior aplikasi.

Contoh urutan sehat:

```text
1. ForwardedHeaderNormalizationFilter
2. CorrelationIdFilter
3. RequestContext/MDCFilter
4. SecurityBoundaryFilter
5. CorsFilter
6. RateLimitFilter
7. RequestBodyCachingFilter (hati-hati)
8. Compression/ResponseFilter
9. Framework servlet
```

Tapi urutan yang salah bisa menyebabkan:

- log tidak punya correlation id,
- CORS preflight masuk ke auth dan ditolak,
- security melihat scheme salah karena forwarded header belum diproses,
- body sudah dikonsumsi sebelum controller,
- compression membungkus response sebelum error handler siap,
- rate limit memakai IP proxy, bukan client IP sebenarnya,
- audit tidak tercatat saat error dispatch.

---

### 7.2 `web.xml` ordering

Dalam deployment descriptor, ordering filter biasanya mengikuti urutan `filter-mapping` yang cocok.

Contoh:

```xml
<filter-mapping>
    <filter-name>correlationIdFilter</filter-name>
    <url-pattern>/*</url-pattern>
</filter-mapping>

<filter-mapping>
    <filter-name>auditFilter</filter-name>
    <url-pattern>/api/*</url-pattern>
</filter-mapping>
```

Jika request `/api/cases` masuk:

```text
correlationIdFilter → auditFilter → target
```

---

### 7.3 Annotation ordering problem

Dengan `@WebFilter`, ordering bisa lebih sulit diprediksi jika banyak filter di-scan dari classpath.

Untuk aplikasi serius, gunakan salah satu strategi:

1. web.xml untuk ordering eksplisit,
2. programmatic registration,
3. framework registration API dengan order,
4. satu composite filter yang memanggil internal chain milik aplikasi.

---

## 8. Anatomy `doFilter`

Bentuk paling aman:

```java
@Override
public void doFilter(
        ServletRequest request,
        ServletResponse response,
        FilterChain chain
) throws IOException, ServletException {
    try {
        // pre-processing
        chain.doFilter(request, response);
        // post-processing after normal downstream return
    } finally {
        // cleanup that must always happen
    }
}
```

Namun hati-hati: post-processing setelah `chain.doFilter` hanya berjalan jika downstream return ke caller. Jika downstream start async, response mungkin belum selesai saat method return.

---

### 8.1 Pre-processing

Pre-processing cocok untuk:

- validasi header,
- membuat correlation id,
- set MDC,
- normalize proxy header,
- reject request terlalu besar,
- handle CORS preflight,
- request wrapping,
- tenant extraction,
- set request attribute,
- start timer,
- admission control.

Contoh:

```java
String requestId = request.getHeader("X-Request-Id");
if (requestId == null || requestId.isBlank()) {
    requestId = UUID.randomUUID().toString();
}
request.setAttribute("requestId", requestId);
```

---

### 8.2 Chain invocation

```java
chain.doFilter(request, response);
```

Ini titik transisi ke downstream.

Downstream bisa:

- memanggil servlet,
- memanggil filter berikutnya,
- forward,
- include,
- start async,
- throw exception,
- commit response,
- send redirect,
- send error,
- close output stream.

Jangan menulis kode setelah `chain.doFilter` dengan asumsi response masih bisa diubah.

---

### 8.3 Post-processing

Post-processing cocok untuk:

- access log setelah downstream selesai,
- menghitung duration,
- menambahkan header jika response belum committed,
- inspect status pada response wrapper,
- cleanup context,
- metrics.

Contoh:

```java
long startedAt = System.nanoTime();
try {
    chain.doFilter(request, response);
} finally {
    long durationNanos = System.nanoTime() - startedAt;
    metrics.record(durationNanos);
}
```

---

## 9. Short-Circuit Pattern

Short-circuit berarti filter tidak memanggil `chain.doFilter`.

Contoh sederhana:

```java
public final class MaintenanceModeFilter implements Filter {
    private volatile boolean maintenanceMode = true;

    @Override
    public void doFilter(
            ServletRequest request,
            ServletResponse response,
            FilterChain chain
    ) throws IOException, ServletException {
        HttpServletResponse http = (HttpServletResponse) response;

        if (maintenanceMode) {
            http.setStatus(HttpServletResponse.SC_SERVICE_UNAVAILABLE);
            http.setContentType("application/json");
            http.getWriter().write("{\"error\":\"maintenance\"}");
            return;
        }

        chain.doFilter(request, response);
    }
}
```

Short-circuit harus jelas:

- status code ditentukan,
- response body konsisten,
- header penting tetap diset,
- metrics tetap tercatat,
- tidak lanjut ke chain,
- tidak menulis body dua kali.

---

## 10. Filter dan Type Casting HTTP

`Filter` menerima generic `ServletRequest`/`ServletResponse` karena Servlet API tidak hanya HTTP secara historis.

Dalam web app modern, biasanya kita cast ke HTTP.

```java
if (!(request instanceof HttpServletRequest httpRequest) ||
    !(response instanceof HttpServletResponse httpResponse)) {
    chain.doFilter(request, response);
    return;
}
```

Pada Java 8, belum ada pattern matching:

```java
if (!(request instanceof HttpServletRequest) ||
    !(response instanceof HttpServletResponse)) {
    chain.doFilter(request, response);
    return;
}

HttpServletRequest httpRequest = (HttpServletRequest) request;
HttpServletResponse httpResponse = (HttpServletResponse) response;
```

Untuk library yang ingin kompatibel Java 8, hindari syntax Java modern di source utama.

---

## 11. Request Wrapper Pattern

Filter sering perlu mengubah atau memperkaya request.

Jangan mutate object container langsung jika API tidak mendukung. Gunakan wrapper.

```java
public final class HeaderOverrideRequestWrapper extends HttpServletRequestWrapper {

    private final Map<String, String> extraHeaders;

    public HeaderOverrideRequestWrapper(
            HttpServletRequest request,
            Map<String, String> extraHeaders
    ) {
        super(request);
        this.extraHeaders = Map.copyOf(extraHeaders);
    }

    @Override
    public String getHeader(String name) {
        String value = extraHeaders.get(name);
        if (value != null) {
            return value;
        }
        return super.getHeader(name);
    }

    @Override
    public Enumeration<String> getHeaderNames() {
        Set<String> names = new LinkedHashSet<>();
        Enumeration<String> original = super.getHeaderNames();
        while (original.hasMoreElements()) {
            names.add(original.nextElement());
        }
        names.addAll(extraHeaders.keySet());
        return Collections.enumeration(names);
    }
}
```

Penggunaan:

```java
HttpServletRequest wrapped = new HeaderOverrideRequestWrapper(
        httpRequest,
        Map.of("X-Normalized-Scheme", "https")
);
chain.doFilter(wrapped, response);
```

---

## 12. Response Wrapper Pattern

Response wrapper berguna untuk:

- menangkap status code,
- menambahkan header konsisten,
- menghitung body size,
- buffering body,
- transform response,
- audit response metadata.

Contoh wrapper untuk status code:

```java
public final class StatusCaptureResponseWrapper extends HttpServletResponseWrapper {

    private int status = HttpServletResponse.SC_OK;

    public StatusCaptureResponseWrapper(HttpServletResponse response) {
        super(response);
    }

    @Override
    public void setStatus(int sc) {
        this.status = sc;
        super.setStatus(sc);
    }

    @Override
    public void sendError(int sc) throws IOException {
        this.status = sc;
        super.sendError(sc);
    }

    @Override
    public void sendError(int sc, String msg) throws IOException {
        this.status = sc;
        super.sendError(sc, msg);
    }

    @Override
    public void sendRedirect(String location) throws IOException {
        this.status = HttpServletResponse.SC_FOUND;
        super.sendRedirect(location);
    }

    public int getStatus() {
        return status;
    }
}
```

Filter:

```java
StatusCaptureResponseWrapper wrapped = new StatusCaptureResponseWrapper(httpResponse);
long startedAt = System.nanoTime();
try {
    chain.doFilter(httpRequest, wrapped);
} finally {
    long duration = System.nanoTime() - startedAt;
    accessLog.log(httpRequest, wrapped.getStatus(), duration);
}
```

Catatan:

- Servlet API modern sudah punya `HttpServletResponse#getStatus`, tapi wrapper tetap berguna untuk kompatibilitas lama atau behavior custom.
- Wrapper harus override semua method yang mengubah status jika ingin akurat.
- Redirect status bisa bervariasi pada Servlet modern jika API mendukung redirect status khusus.

---

## 13. Body Caching Filter

Ini salah satu area filter paling sering menyebabkan bug.

Masalah:

- `ServletInputStream` hanya bisa dibaca satu kali.
- `getReader()` dan `getInputStream()` saling eksklusif.
- Jika filter membaca body untuk logging/audit, controller bisa kehilangan body.

Solusi: wrapper yang membaca body lalu menyediakan stream baru.

### 13.1 Contoh sederhana body caching wrapper

```java
public final class CachedBodyHttpServletRequest extends HttpServletRequestWrapper {

    private final byte[] cachedBody;

    public CachedBodyHttpServletRequest(HttpServletRequest request) throws IOException {
        super(request);
        this.cachedBody = request.getInputStream().readAllBytes();
    }

    @Override
    public ServletInputStream getInputStream() {
        ByteArrayInputStream input = new ByteArrayInputStream(cachedBody);

        return new ServletInputStream() {
            @Override
            public boolean isFinished() {
                return input.available() == 0;
            }

            @Override
            public boolean isReady() {
                return true;
            }

            @Override
            public void setReadListener(ReadListener readListener) {
                throw new UnsupportedOperationException(
                        "Non-blocking read is not supported by this wrapper"
                );
            }

            @Override
            public int read() {
                return input.read();
            }
        };
    }

    @Override
    public BufferedReader getReader() throws IOException {
        Charset charset = Optional.ofNullable(getCharacterEncoding())
                .map(Charset::forName)
                .orElse(StandardCharsets.UTF_8);
        return new BufferedReader(new InputStreamReader(getInputStream(), charset));
    }

    public byte[] getCachedBody() {
        return cachedBody.clone();
    }
}
```

Filter:

```java
public final class RequestBodyLoggingFilter implements Filter {

    private static final int MAX_CACHE_BYTES = 64 * 1024;

    @Override
    public void doFilter(
            ServletRequest request,
            ServletResponse response,
            FilterChain chain
    ) throws IOException, ServletException {
        HttpServletRequest http = (HttpServletRequest) request;

        if (!shouldCache(http)) {
            chain.doFilter(request, response);
            return;
        }

        CachedBodyHttpServletRequest wrapped = new CachedBodyHttpServletRequest(http);

        if (wrapped.getCachedBody().length > MAX_CACHE_BYTES) {
            ((HttpServletResponse) response).sendError(413, "Payload too large for logging");
            return;
        }

        // Log carefully: redact secrets and avoid PII leakage.
        chain.doFilter(wrapped, response);
    }

    private boolean shouldCache(HttpServletRequest request) {
        String contentType = request.getContentType();
        return contentType != null && contentType.startsWith("application/json");
    }
}
```

### 13.2 Bahaya body caching

Body caching berisiko:

- memory spike,
- OOM saat large payload,
- double parsing multipart,
- melanggar streaming semantics,
- menyimpan PII/secrets di log,
- merusak non-blocking I/O,
- mengubah timing behavior,
- membuat upload besar sangat lambat.

Rule:

> Jangan pasang body caching global `/*` tanpa limit, content-type check, size check, redaction, dan alasan kuat.

---

## 14. Correlation ID Filter

Correlation ID adalah contoh filter yang sangat cocok.

### 14.1 Tujuan

- Semua log dalam satu request punya ID yang sama.
- ID dikirim balik ke client.
- ID diteruskan ke downstream service.
- Error bisa dilacak lintas layer.

### 14.2 Implementasi

```java
public final class CorrelationIdFilter implements Filter {

    public static final String HEADER = "X-Correlation-Id";
    public static final String ATTRIBUTE = "correlationId";

    @Override
    public void doFilter(
            ServletRequest request,
            ServletResponse response,
            FilterChain chain
    ) throws IOException, ServletException {
        HttpServletRequest httpRequest = (HttpServletRequest) request;
        HttpServletResponse httpResponse = (HttpServletResponse) response;

        String correlationId = sanitize(httpRequest.getHeader(HEADER));
        if (correlationId == null) {
            correlationId = UUID.randomUUID().toString();
        }

        request.setAttribute(ATTRIBUTE, correlationId);
        httpResponse.setHeader(HEADER, correlationId);

        try {
            MDC.put("correlationId", correlationId);
            chain.doFilter(request, response);
        } finally {
            MDC.remove("correlationId");
        }
    }

    private String sanitize(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        if (value.length() > 128) {
            return null;
        }
        if (!value.matches("[A-Za-z0-9._:-]+")) {
            return null;
        }
        return value;
    }
}
```

### 14.3 Design notes

- Jangan percaya header mentah tanpa sanitasi.
- Jangan gunakan correlation id sebagai authorization/session id.
- Jangan biarkan MDC bocor ke request lain.
- Jika async digunakan, MDC tidak otomatis pindah ke thread async.
- Untuk virtual threads, masih perlu memahami propagation semantics library logging yang dipakai.

---

## 15. Access Logging Filter

Access log bisa dilakukan container, reverse proxy, atau application filter.

Filter cocok jika ingin menangkap application-level metadata:

- user id setelah auth,
- tenant id,
- module id,
- case id,
- business endpoint category,
- response status hasil framework,
- exception mapping.

Contoh:

```java
public final class ApplicationAccessLogFilter implements Filter {

    @Override
    public void doFilter(
            ServletRequest request,
            ServletResponse response,
            FilterChain chain
    ) throws IOException, ServletException {
        HttpServletRequest req = (HttpServletRequest) request;
        HttpServletResponse res = (HttpServletResponse) response;
        StatusCaptureResponseWrapper wrapped = new StatusCaptureResponseWrapper(res);

        long start = System.nanoTime();
        Throwable failure = null;

        try {
            chain.doFilter(req, wrapped);
        } catch (Throwable t) {
            failure = t;
            throw t;
        } finally {
            long durationMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start);
            logAccess(req, wrapped.getStatus(), durationMs, failure);
        }
    }

    private void logAccess(
            HttpServletRequest req,
            int status,
            long durationMs,
            Throwable failure
    ) {
        // Use structured logging in real systems.
    }
}
```

### 15.1 Caveat async

Untuk async request, `chain.doFilter` bisa return sebelum request benar-benar selesai.

Jika butuh access log akurat untuk async, gunakan `AsyncListener`.

```java
if (req.isAsyncStarted()) {
    req.getAsyncContext().addListener(new AsyncListener() {
        @Override
        public void onComplete(AsyncEvent event) {
            // log final completion
        }

        @Override
        public void onTimeout(AsyncEvent event) {
            // log timeout
        }

        @Override
        public void onError(AsyncEvent event) {
            // log async error
        }

        @Override
        public void onStartAsync(AsyncEvent event) {
            // re-register if needed
        }
    });
}
```

Ini akan dibahas lebih dalam pada part async.

---

## 16. CORS Filter

CORS sering diletakkan di filter karena preflight `OPTIONS` terjadi sebelum endpoint business.

### 16.1 Mental model CORS

Browser melakukan enforcement CORS. Server hanya memberi header yang mengizinkan atau menolak.

CORS filter biasanya:

- membaca `Origin`,
- menentukan apakah origin allowed,
- menambahkan `Access-Control-Allow-Origin`,
- menambahkan `Vary: Origin`,
- meng-handle preflight `OPTIONS`,
- mengatur allowed methods/headers,
- mengatur credentials policy.

### 16.2 Contoh simplified CORS filter

```java
public final class CorsFilter implements Filter {

    private final Set<String> allowedOrigins = Set.of(
            "https://app.example.com",
            "https://admin.example.com"
    );

    @Override
    public void doFilter(
            ServletRequest request,
            ServletResponse response,
            FilterChain chain
    ) throws IOException, ServletException {
        HttpServletRequest req = (HttpServletRequest) request;
        HttpServletResponse res = (HttpServletResponse) response;

        String origin = req.getHeader("Origin");
        if (origin != null && allowedOrigins.contains(origin)) {
            res.setHeader("Access-Control-Allow-Origin", origin);
            res.setHeader("Vary", "Origin");
            res.setHeader("Access-Control-Allow-Credentials", "true");
            res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Correlation-Id");
            res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
        }

        if ("OPTIONS".equalsIgnoreCase(req.getMethod()) &&
            req.getHeader("Access-Control-Request-Method") != null) {
            res.setStatus(HttpServletResponse.SC_NO_CONTENT);
            return;
        }

        chain.doFilter(request, response);
    }
}
```

### 16.3 CORS failure modes

| Bug | Dampak |
|---|---|
| `Access-Control-Allow-Origin: *` + credentials | browser reject |
| lupa `Vary: Origin` | cache bisa salah melayani origin lain |
| preflight masuk auth | browser melihat CORS failure, bukan auth failure |
| allowed headers kurang | request ditolak sebelum endpoint dipanggil |
| environment origin hardcoded | UAT/PROD mismatch |
| reflect origin tanpa whitelist | cross-origin policy bocor |

---

## 17. Security Header Filter

Security header filter cocok untuk policy HTTP-level.

Contoh:

```java
public final class SecurityHeadersFilter implements Filter {

    @Override
    public void doFilter(
            ServletRequest request,
            ServletResponse response,
            FilterChain chain
    ) throws IOException, ServletException {
        HttpServletResponse res = (HttpServletResponse) response;

        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("X-Frame-Options", "DENY");
        res.setHeader("Referrer-Policy", "no-referrer");
        res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");

        chain.doFilter(request, response);
    }
}
```

Untuk aplikasi modern, banyak header sebaiknya dikelola juga di reverse proxy atau security framework agar konsisten untuk static resource/error page.

---

## 18. Rate Limiting Filter

Rate limiting bisa diletakkan di filter karena ia adalah admission control.

Namun rate limiting serius perlu memperhatikan:

- identity key,
- proxy IP normalization,
- user/token/client id,
- distributed state,
- burst vs sustained rate,
- response code,
- retry header,
- bypass internal health checks,
- attack behavior,
- cost of limiter check.

### 18.1 Simplified local token bucket sketch

```java
public final class LocalRateLimitFilter implements Filter {

    private final ConcurrentHashMap<String, SimpleBucket> buckets = new ConcurrentHashMap<>();

    @Override
    public void doFilter(
            ServletRequest request,
            ServletResponse response,
            FilterChain chain
    ) throws IOException, ServletException {
        HttpServletRequest req = (HttpServletRequest) request;
        HttpServletResponse res = (HttpServletResponse) response;

        String key = clientKey(req);
        SimpleBucket bucket = buckets.computeIfAbsent(key, ignored -> new SimpleBucket(100, 100));

        if (!bucket.tryConsume()) {
            res.setStatus(429);
            res.setHeader("Retry-After", "1");
            res.setContentType("application/json");
            res.getWriter().write("{\"error\":\"rate_limited\"}");
            return;
        }

        chain.doFilter(request, response);
    }

    private String clientKey(HttpServletRequest req) {
        return req.getRemoteAddr();
    }
}
```

### 18.2 Why local limiter is incomplete

Local limiter tidak cukup jika:

- app punya banyak pod/node,
- traffic lewat load balancer,
- client bisa pindah node,
- perlu global quota,
- perlu per-user rate,
- perlu audit/compliance evidence,
- perlu distributed abuse prevention.

Untuk produksi multi-node, gunakan distributed limiter atau rate limiting di gateway/proxy plus application-level guard.

---

## 19. Forwarded Header Normalization Filter

Aplikasi Java sering berjalan di belakang proxy/load balancer.

Tanpa normalization, `HttpServletRequest` bisa melihat:

```text
scheme      = http
serverName  = internal-service
serverPort  = 8080
remoteAddr  = proxy-ip
```

Padahal client mengakses:

```text
https://portal.example.com
```

Filter bisa membantu normalisasi atau set attribute, tetapi harus hati-hati. Banyak container/framework punya fitur resmi seperti remote IP valve/filter atau forwarded header support. Jika membuat sendiri, jangan mempercayai forwarded header dari internet langsung.

### 19.1 Trust boundary

Forwarded headers hanya boleh dipercaya jika:

- request datang dari trusted proxy,
- proxy menghapus header spoofed dari client,
- network topology jelas,
- ingress/LB policy konsisten.

Jika tidak, attacker bisa mengirim:

```text
X-Forwarded-Proto: https
X-Forwarded-For: 1.2.3.4
X-Forwarded-Host: admin.example.com
```

Lalu aplikasi salah membuat redirect, audit, atau security decision.

---

## 20. Filter dan Exception Handling

Filter bisa menangkap exception dari downstream:

```java
try {
    chain.doFilter(request, response);
} catch (Exception ex) {
    // log, metric, maybe transform
    throw ex;
}
```

Namun jangan asal mengubah semua exception menjadi JSON response.

Masalah:

- response mungkin sudah committed,
- framework error handler mungkin lebih tepat,
- container error page mapping bisa terlewati,
- status code bisa salah,
- exception asli hilang,
- async error tidak tertangkap di call stack biasa.

Lebih aman:

- log/metric di filter,
- biarkan framework/container error handling bekerja,
- hanya short-circuit untuk error yang memang dibuat oleh filter sendiri,
- cek `response.isCommitted()` sebelum menulis.

Contoh:

```java
try {
    chain.doFilter(request, response);
} catch (RateLimitStorageUnavailableException ex) {
    HttpServletResponse res = (HttpServletResponse) response;
    if (!res.isCommitted()) {
        res.sendError(503, "Rate limit service unavailable");
    }
} catch (Exception ex) {
    metrics.increment("request.failure");
    throw ex;
}
```

---

## 21. Filter dan Response Commit

Response commit terjadi saat status/header/body sudah dikirim ke client.

Setelah committed:

- header tidak bisa diubah secara efektif,
- status tidak bisa diubah,
- redirect tidak bisa dilakukan,
- error response tidak bisa diganti penuh.

Filter post-processing harus selalu mempertimbangkan:

```java
if (!response.isCommitted()) {
    httpResponse.setHeader("X-Safe-To-Set", "true");
}
```

Tapi `isCommitted()` bukan solusi semua masalah. Antara check dan write masih bisa ada race pada async/concurrent behavior.

---

## 22. Filter dan Async Servlet

Filter punya atribut `asyncSupported`.

Jika request melewati filter yang tidak mendukung async, lalu downstream mencoba `startAsync`, container dapat menolak dengan error.

Contoh annotation:

```java
@WebFilter(
    urlPatterns = "/*",
    asyncSupported = true,
    dispatcherTypes = {
        DispatcherType.REQUEST,
        DispatcherType.ASYNC,
        DispatcherType.ERROR
    }
)
public final class AsyncAwareFilter implements Filter {
    @Override
    public void doFilter(
            ServletRequest request,
            ServletResponse response,
            FilterChain chain
    ) throws IOException, ServletException {
        chain.doFilter(request, response);
    }
}
```

### 22.1 Async dispatch nuance

Request pertama:

```text
DispatcherType.REQUEST
```

Jika downstream start async lalu dispatch lagi:

```text
DispatcherType.ASYNC
```

Filter akan dipanggil lagi untuk async dispatch hanya jika mapping mencakup `ASYNC`.

Jika filter tidak idempotent, ini bisa menyebabkan:

- duplicate logging,
- duplicate correlation id,
- duplicate wrapper,
- duplicate auth check,
- duplicate metrics,
- duplicated body caching.

Maka filter async-aware harus tahu apakah ia sedang di request awal atau async dispatch.

```java
DispatcherType type = request.getDispatcherType();
if (type == DispatcherType.ASYNC) {
    // avoid repeating one-time request initialization
}
```

---

## 23. Filter dan Error Dispatch

Jika terjadi error, container bisa melakukan error dispatch.

Filter dengan dispatcher `ERROR` akan dipanggil pada error dispatch.

Ini berguna untuk:

- menambahkan correlation id ke error page,
- mencatat final error response,
- security headers untuk error page,
- JSON error normalization pada layer tertentu.

Namun berbahaya jika:

- filter melempar error lagi,
- filter melakukan redirect saat error dispatch,
- filter logging mencatat dua kali tanpa membedakan dispatcher,
- filter menganggap target resource normal.

Gunakan:

```java
if (request.getDispatcherType() == DispatcherType.ERROR) {
    Object status = request.getAttribute(RequestDispatcher.ERROR_STATUS_CODE);
    Object exception = request.getAttribute(RequestDispatcher.ERROR_EXCEPTION);
}
```

---

## 24. Filter dan Forward/Include

Filter bisa dipanggil pada forward/include jika mapping mencakup:

- `FORWARD`,
- `INCLUDE`.

Contoh use case `FORWARD`:

- internal MVC forward ke JSP tetap butuh security headers,
- audit perlu tahu final view,
- request attribute normalization.

Contoh use case `INCLUDE`:

- legacy JSP include fragment,
- templating behavior,
- resource composition.

Namun sebagian filter sebaiknya hanya `REQUEST`, misalnya:

- rate limiting external request,
- request id generation satu kali,
- raw access logging,
- body caching.

---

## 25. Filter Idempotency

Filter yang bisa dipanggil lebih dari sekali dalam satu logical request harus idempotent.

Contoh idempotent correlation id:

```java
String existing = (String) request.getAttribute(CorrelationIdFilter.ATTRIBUTE);
if (existing != null) {
    chain.doFilter(request, response);
    return;
}
```

Atau:

```java
if (request.getAttribute("filter.applied.correlation") == null) {
    request.setAttribute("filter.applied.correlation", Boolean.TRUE);
    // initialize
}
```

Gunakan request attribute sebagai marker. Jangan gunakan static global marker.

---

## 26. Filter Thread-Safety

Seperti servlet, filter instance biasanya dibuat sekali dan dipakai banyak request secara concurrent.

Jangan lakukan ini:

```java
public final class BrokenFilter implements Filter {
    private HttpServletRequest currentRequest;

    @Override
    public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
            throws IOException, ServletException {
        this.currentRequest = (HttpServletRequest) request; // BUG
        chain.doFilter(request, response);
    }
}
```

Karena field `currentRequest` akan ditimpa request lain.

Aman:

- local variable,
- immutable config setelah init,
- thread-safe shared object,
- stateless service,
- concurrent collection dengan lifecycle jelas.

---

## 27. Filter dan `ThreadLocal`

Filter sering dipakai untuk set dan clear `ThreadLocal`.

Contoh:

```java
try {
    RequestContextHolder.set(context);
    chain.doFilter(request, response);
} finally {
    RequestContextHolder.clear();
}
```

Ini benar untuk thread-per-request klasik.

Namun ada caveat:

1. Async processing bisa lanjut di thread lain.
2. Downstream executor tidak otomatis mendapat context.
3. Thread pool reuse membuat leak jika `clear` lupa.
4. Virtual threads mengubah cost model, tapi tidak menghilangkan kebutuhan cleanup.
5. Library berbeda punya propagation mechanism sendiri.

Rule:

> Setiap `ThreadLocal.set` di filter harus punya `finally clear`.

---

## 28. Filter dan Static Resource

Filter `/*` juga bisa mengenai static resource:

- CSS,
- JS,
- image,
- font,
- favicon,
- SPA bundle.

Ini bisa membuat overhead besar.

Contoh bug:

- auth filter memblokir `/assets/app.js`,
- logging body filter mencoba membaca image upload/static file,
- security header filter tidak masalah tapi terlalu verbose logging,
- rate limiter menghitung setiap asset sebagai API call,
- CORS filter memodifikasi asset response tidak perlu.

Strategi:

1. Pisahkan URL pattern `/api/*` untuk API.
2. Exclude static paths.
3. Letakkan static asset di CDN/proxy.
4. Gunakan servlet-name mapping ke framework servlet.

---

## 29. Filter dan Health Check

Health endpoint perlu diperlakukan hati-hati.

Jika semua filter berat berlaku untuk health check:

- readiness bisa lambat,
- liveness bisa gagal karena dependency eksternal,
- rate limiter bisa memblokir kubelet/LB,
- auth bisa menolak health check,
- log bisa penuh noise.

Biasanya:

- liveness minimal dan murah,
- readiness boleh cek dependency penting tapi tetap bounded,
- metrics endpoint punya security model sendiri,
- health path dikecualikan dari body caching/audit berat.

Contoh:

```java
private boolean isHealthCheck(HttpServletRequest req) {
    String path = req.getRequestURI();
    return path.endsWith("/health") || path.endsWith("/ready") || path.endsWith("/live");
}
```

---

## 30. Filter Chain Sebagai Architecture Boundary

Dalam aplikasi enterprise, filter chain idealnya didesain seperti pipeline.

Contoh pipeline:

```text
External HTTP request
  ↓
TrustedProxyFilter
  ↓
CorrelationIdFilter
  ↓
RequestTimingFilter
  ↓
SecurityHeadersFilter
  ↓
CorsFilter
  ↓
RequestSizeGuardFilter
  ↓
AuthenticationBootstrapFilter
  ↓
TenantResolutionFilter
  ↓
RateLimitFilter
  ↓
AuditContextFilter
  ↓
Framework Servlet
  ↓
Application service
```

Setiap filter harus punya:

- responsibility tunggal,
- order yang jelas,
- input invariant,
- output invariant,
- error behavior,
- async behavior,
- dispatcher behavior,
- observability behavior,
- cost budget.

---

## 31. Invariant Design untuk Filter

Filter yang baik mendefinisikan invariant.

Contoh `CorrelationIdFilter`:

Input assumptions:

- request adalah HTTP request,
- header `X-Correlation-Id` opsional,
- header bisa malicious.

Output guarantees:

- request attribute `correlationId` tersedia,
- response header `X-Correlation-Id` diset,
- MDC berisi correlation id saat downstream berjalan,
- MDC dibersihkan setelah selesai.

Failure behavior:

- invalid incoming id diganti id baru,
- filter tidak pernah menolak request hanya karena id invalid,
- cleanup selalu terjadi.

Async behavior:

- initial thread punya MDC,
- async propagation tidak otomatis dijamin,
- request attribute tetap tersedia.

---

## 32. Anti-Patterns

### 32.1 God Filter

Filter yang melakukan semuanya:

- auth,
- tenant,
- audit,
- body parsing,
- rate limit,
- logging,
- exception mapping,
- response transform,
- feature flag,
- business validation.

Masalah:

- sulit diuji,
- sulit diorder,
- sulit dipahami,
- perubahan satu concern mempengaruhi semua,
- raw servlet boundary tercampur business logic.

---

### 32.2 Swallow Exception

```java
try {
    chain.doFilter(request, response);
} catch (Exception ex) {
    log.warn("ignored", ex);
}
```

Ini buruk karena:

- client bisa dapat response tidak jelas,
- transaction mungkin sudah rollback tapi response 200,
- error monitoring tidak melihat failure,
- container error page tidak jalan,
- debugging sulit.

---

### 32.3 Always Read Body

```java
String body = request.getReader().lines().collect(joining("\n"));
chain.doFilter(request, response);
```

Bug:

- downstream tidak bisa baca body,
- memory risk,
- encoding issue,
- multipart rusak,
- PII leak.

---

### 32.4 Write After Chain Without Commit Check

```java
chain.doFilter(request, response);
response.getWriter().write("footer");
```

Bisa gagal karena:

- response sudah committed,
- output stream sudah dipakai,
- content-length sudah ditentukan,
- JSON menjadi invalid,
- binary download rusak.

---

### 32.5 Mutable Shared Field

```java
private String currentUser;
```

Pada filter, field seperti ini akan shared across requests.

Gunakan local variable atau request attribute.

---

### 32.6 Filter Order by Accident

Mengandalkan ordering annotation scanning tanpa kontrol pada sistem besar adalah risiko.

---

### 32.7 Business Authorization in Raw Filter

Contoh buruk:

```java
if (req.getRequestURI().contains("/case/approve")) {
    // query DB, inspect case status, decide workflow transition
}
```

Ini mencampur HTTP boundary dengan domain workflow.

Lebih baik:

- filter melakukan authentication/context bootstrap,
- framework/controller/application service melakukan domain authorization.

---

## 33. Testing Strategy untuk Filter

Karena seri testing sudah dibahas sebelumnya, di sini hanya fokus konteks filter.

Level testing:

| Level | Tujuan |
|---|---|
| Unit test wrapper | memastikan header/body/status behavior |
| Unit test filter | memastikan chain dipanggil/tidak dipanggil |
| Integration test embedded container | memastikan mapping/order/dispatcher benar |
| Reverse proxy test | memastikan forwarded header/CORS/timeout benar |
| Async test | memastikan listener/logging tidak premature |
| Failure test | committed response, exception, client abort |

Hal yang harus dites:

- matching URL,
- dispatcher type,
- order,
- short-circuit,
- response status,
- header output,
- body not consumed,
- cleanup happens on exception,
- async request behavior,
- error dispatch behavior.

---

## 34. Production Checklist

Sebelum filter masuk produksi, tanyakan:

1. Apakah filter berlaku untuk URL yang tepat?
2. Apakah dispatcher type sudah benar?
3. Apakah order sudah eksplisit?
4. Apakah filter thread-safe?
5. Apakah `chain.doFilter` dipanggil tepat sekali untuk path normal?
6. Apakah short-circuit punya status/body/header yang benar?
7. Apakah response commit diperhatikan?
8. Apakah request body tidak dikonsumsi sembarangan?
9. Apakah wrapper kompatibel dengan async/non-blocking?
10. Apakah cleanup selalu di `finally`?
11. Apakah static resource/health check terkena filter berat?
12. Apakah proxy header trust boundary jelas?
13. Apakah CORS preflight tidak salah masuk auth?
14. Apakah error dispatch tidak double log/double transform?
15. Apakah log tidak menyimpan PII/secrets?
16. Apakah rate limit key benar di belakang proxy?
17. Apakah metrics membedakan success/error/short-circuit?
18. Apakah filter behavior terdokumentasi sebagai invariant?

---

## 35. Contoh Composite Filter Design

Untuk aplikasi besar, daripada puluhan filter kecil dengan ordering sulit, kadang lebih baik membuat satu filter eksternal yang menjalankan internal pipeline eksplisit.

```java
public final class PlatformBoundaryFilter implements Filter {

    private List<BoundaryStep> steps;

    @Override
    public void init(FilterConfig config) {
        this.steps = List.of(
                new CorrelationStep(),
                new SecurityHeaderStep(),
                new TimingStep(),
                new TenantStep()
        );
    }

    @Override
    public void doFilter(
            ServletRequest request,
            ServletResponse response,
            FilterChain chain
    ) throws IOException, ServletException {
        BoundaryChain internal = new BoundaryChain(steps, chain);
        internal.proceed((HttpServletRequest) request, (HttpServletResponse) response);
    }
}
```

Ini pattern advanced. Ia berguna jika:

- perlu order deterministik,
- setiap step kecil dan testable,
- deployment descriptor tidak ingin penuh,
- ingin policy boundary modular.

Tapi jangan membuat mini-framework tanpa kebutuhan nyata.

---

## 36. Advanced Mental Model: Filter as Around Advice

Filter mirip `around advice` pada AOP, tetapi di level Servlet runtime.

```text
before()
try {
    proceed()
    afterReturning()
} catch (Throwable t) {
    afterThrowing(t)
    throw t
} finally {
    afterFinally()
}
```

Mapping ke filter:

```java
try {
    before(request, response);
    chain.doFilter(request, response);
    afterReturning(request, response);
} catch (Throwable t) {
    afterThrowing(request, response, t);
    throw t;
} finally {
    afterFinally(request, response);
}
```

Tetapi ada perbedaan besar:

- response bisa committed kapan saja,
- async membuat completion tidak selalu sama dengan method return,
- request bisa dispatch ulang,
- include/forward bisa memicu chain berbeda,
- container punya error dispatch sendiri,
- output stream/writer punya state ketat.

Jadi jangan membawa mental model AOP terlalu sederhana.

---

## 37. Java 8 sampai Java 25 Relevance

Filter API sendiri relatif stabil dari Java 8 sampai Java 25. Yang berubah adalah ekosistem dan runtime style.

### 37.1 Java 8 era

- `javax.servlet.*` dominan.
- WAR deployment umum.
- Tomcat 8/9, Jetty 9, Java EE app server.
- Thread-per-request platform thread.
- Async Servlet sudah tersedia, tapi tidak selalu banyak dipakai.

### 37.2 Java 11/17 era

- LTS modernisasi.
- Spring Boot 2.x masih `javax`, Spring Boot 3.x pindah `jakarta`.
- Container migration mulai penting.
- Observability dan cloud deployment lebih dominan.

### 37.3 Java 21+ era

- Virtual threads mengubah cost blocking thread.
- Namun filter tetap harus thread-safe.
- `ThreadLocal` masih perlu cleanup.
- Async/non-blocking bukan otomatis digantikan virtual thread; pilih sesuai bottleneck.
- Container support virtual thread bervariasi berdasarkan versi.

### 37.4 Java 25 era

- JDK runtime makin modern, tetapi Servlet contract tetap boundary HTTP yang stabil.
- Hal yang makin penting: graceful shutdown, observability, structured request lifecycle, context propagation, dan compatibility `javax`/`jakarta`.

---

## 38. Decision Matrix: Apakah Concern Ini Cocok di Filter?

| Concern | Cocok di Filter? | Catatan |
|---|---:|---|
| Correlation ID | Ya | boundary-wide, cheap, deterministic |
| Security headers | Ya | sering juga di proxy |
| CORS | Ya | terutama preflight |
| Access logging | Ya | hati-hati async |
| Body logging | Kadang | hanya dengan limit/redaction |
| Authentication bootstrap | Ya/kadang | tergantung security framework |
| Domain authorization | Tidak ideal | pindah ke service/domain layer |
| Rate limiting | Ya/kadang | distributed concern perlu infra support |
| Tenant extraction | Ya | tenant decision detail bisa di service |
| Request validation schema | Tidak ideal | lebih cocok framework/controller validation |
| Multipart file scanning | Kadang | sering lebih baik di dedicated upload pipeline |
| Response compression | Ya/kadang | container/proxy sering lebih baik |
| Business audit | Kadang | filter bisa siapkan context, service mencatat event domain |
| Exception-to-JSON global | Kadang | framework handler biasanya lebih tepat |

---

## 39. Mini Case Study: Audit dan Correlation Filter untuk Regulatory System

Misalkan sistem case management regulator punya requirement:

- setiap request punya correlation id,
- audit trail harus tahu module/action,
- error response harus tetap punya request id,
- user action harus bisa dilacak,
- API berjalan di belakang ALB/API gateway,
- sebagian endpoint async,
- sebagian endpoint download file besar.

Desain yang masuk akal:

```text
TrustedProxyFilter
  - normalize scheme/client ip from trusted proxy only

CorrelationIdFilter
  - create/sanitize correlation id
  - set response header
  - set request attribute
  - set MDC

SecurityHeadersFilter
  - set protocol-level security headers

CorsFilter
  - handle browser preflight

RequestTimingFilter
  - start timer
  - handle async completion if async started

AuditContextFilter
  - create lightweight audit context
  - do not read full body globally
  - do not write domain audit event alone

Framework Servlet
  - route to controller/resource
  - domain service performs workflow operation
  - domain audit emitted with business outcome
```

Avoid:

```text
AuditFilter reads all request body, parses JSON, queries DB, decides case action,
writes audit row before service commits, then swallows exception.
```

Karena itu menciptakan:

- audit tidak konsisten dengan transaction outcome,
- body consumption bug,
- PII leakage,
- performance cost,
- duplicated domain logic,
- failure behavior sulit dipertanggungjawabkan.

---

## 40. Failure Modelling Table

| Failure | Root Cause | Detection | Mitigation |
|---|---|---|---|
| Endpoint tidak terpanggil | filter short-circuit tidak sengaja | access log berhenti di filter | test branch, log decision |
| Body kosong di controller | filter membaca input stream | controller parse error | request wrapper dengan limit |
| Response 200 padahal error | exception ditelan filter | monitoring mismatch | rethrow exception |
| Header tidak muncul | response sudah committed | inspect commit timing | set header before chain atau check committed |
| Double access log | filter jalan pada REQUEST dan ERROR/ASYNC | duplicate same request id | include dispatcher in log, idempotency marker |
| Async illegal state | filter `asyncSupported=false` | exception saat `startAsync` | set async support where needed |
| CORS gagal | preflight masuk auth/filter salah order | browser CORS error | CORS before auth or security config aware |
| Rate limit salah client | memakai proxy IP | semua traffic dianggap satu IP | trusted forwarded header handling |
| Memory spike | body caching global | heap high/OOM | size limit, content-type filter, streaming |
| MDC leak | lupa clear ThreadLocal | log request tercampur | `finally` cleanup |
| Static asset blocked | filter `/*` terlalu luas | UI blank/assets 401 | exclude static path |
| Error page loop | ERROR filter throw lagi | repeated error dispatch | defensive error dispatcher logic |
| Wrapper breaks streaming | buffering response besar | latency/memory high | avoid wrapping streaming endpoints |

---

## 41. Practical Rules for Top-Tier Engineers

1. Filter adalah runtime boundary, bukan tempat business workflow utama.
2. Selalu desain filter sebagai state machine.
3. Selalu tahu apakah filter berlaku untuk `REQUEST`, `ERROR`, `ASYNC`, `FORWARD`, atau `INCLUDE`.
4. Jangan membaca request body tanpa wrapper, limit, dan alasan kuat.
5. Jangan menulis response setelah chain kecuali tahu response belum committed dan formatnya aman.
6. Jangan swallow exception.
7. Jangan menyimpan request-specific data di field instance.
8. Selalu cleanup `ThreadLocal`/MDC di `finally`.
9. Perhatikan async: method return bukan selalu request selesai.
10. Pisahkan protocol policy dari domain policy.
11. Buat ordering eksplisit pada aplikasi serius.
12. Dokumentasikan invariant setiap filter.
13. Test filter pada container, bukan hanya mock, untuk mapping/order/dispatcher.
14. Di belakang proxy, treat forwarded header sebagai untrusted kecuali trust boundary jelas.
15. Untuk observability, log decision filter terutama saat short-circuit.

---

## 42. Ringkasan

Filter adalah salah satu mekanisme paling powerful di Servlet runtime karena ia berada sebelum target resource dan framework.

Dengan filter, kita bisa mengelola:

- request enrichment,
- response policy,
- logging,
- metrics,
- CORS,
- rate limiting,
- tenant/correlation context,
- error boundary,
- wrapper-based adaptation.

Namun filter juga berbahaya karena:

- satu filter bisa memblokir semua endpoint,
- satu body read bisa merusak semua controller,
- satu exception swallow bisa menyembunyikan insiden,
- satu ordering salah bisa membuat security/CORS/proxy behavior gagal,
- satu missing cleanup bisa mencampur context antar request,
- satu async misunderstanding bisa membuat logging dan metrics salah.

Mental model yang harus dibawa:

```text
Filter = deterministic, ordered, thread-safe, dispatcher-aware boundary step
```

Bukan:

```text
Filter = tempat taruh kode global apa saja
```

Engineer yang matang tidak hanya tahu cara membuat `@WebFilter`, tetapi bisa menjawab:

- kapan filter dipanggil,
- berapa kali dipanggil dalam satu logical request,
- apa yang terjadi jika downstream forward/error/async,
- apakah response sudah committed,
- apakah body masih bisa dibaca,
- apakah context bocor ke request lain,
- apakah order filter valid,
- apakah filter cocok untuk concern tersebut,
- bagaimana filter gagal di production.

---

## 43. Referensi

- Jakarta Servlet 6.1 Specification — https://jakarta.ee/specifications/servlet/6.1/jakarta-servlet-spec-6.1
- Jakarta Servlet API Docs — `Filter`, `FilterChain`, `FilterConfig`, `DispatcherType`, `HttpServletRequestWrapper`, `HttpServletResponseWrapper`
- Jakarta EE Tutorial — Servlet and Filter annotation usage
- Apache Tomcat Servlet API Documentation — Filter API behavior
- Apache Tomcat Container Provided Filters documentation

---

## 44. Status Seri

Seri belum selesai.

Part yang sudah dibuat:

- Part 000 — Orientation: Mental Model Server-Side Java Web Runtime
- Part 001 — Evolution: Java EE `javax.*` ke Jakarta EE `jakarta.*`
- Part 002 — HTTP Fundamentals for Servlet Engineers
- Part 003 — Servlet Container Architecture
- Part 004 — Servlet Lifecycle Deep Dive
- Part 005 — Request Object Internals: `HttpServletRequest`
- Part 006 — Response Object Internals: `HttpServletResponse`
- Part 007 — Servlet Mapping, URL Pattern, and Dispatch Resolution
- Part 008 — Request Dispatching: Forward, Include, Async, Error
- Part 009 — Filters: Cross-Cutting Boundary Before Frameworks

Part berikutnya:

- Part 010 — Listeners: Observing Web Application Lifecycle

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 008 — Request Dispatching: Forward, Include, Async, Error](./learn-java-servlet-websocket-web-container-runtime-part-008.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 010 — Observing Web Application Lifecycle](./learn-java-servlet-websocket-web-container-runtime-part-010.md)
