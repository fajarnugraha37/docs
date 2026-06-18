# learn-java-servlet-websocket-web-container-runtime-part-017

# Part 017 — Error Handling and Failure Semantics in Servlet Apps

> Seri: `learn-java-servlet-websocket-web-container-runtime`  
> Part: `017` dari `031`  
> Topik: Servlet error handling, exception propagation, error dispatch, status code semantics, `sendError`, consistent error response, proxy interaction, observability, dan failure modelling.

---

## 0. Tujuan Part Ini

Di level beginner, error handling sering dipahami sebagai:

```java
try {
    doSomething();
} catch (Exception e) {
    response.setStatus(500);
}
```

Di level production engineer, pemahamannya harus jauh lebih tajam:

> Error handling di Servlet app bukan sekadar menangkap exception. Ia adalah mekanisme transisi state dari request normal menjadi response gagal, bisa melalui application code, filter, servlet, async task, container dispatch, custom error page, reverse proxy, dan client/network failure.

Part ini membahas error handling dari sudut pandang runtime.

Yang ingin dicapai:

1. Memahami perbedaan **exception**, **HTTP status**, **error dispatch**, dan **container-generated error response**.
2. Memahami kapan memakai `setStatus`, `sendError`, throw exception, forward ke error page, atau menulis body sendiri.
3. Memahami bagaimana error page mapping bekerja di `web.xml` atau programmatic registration.
4. Memahami attribute error yang disediakan container saat dispatcher type `ERROR`.
5. Memahami failure modes yang sering muncul di production: response sudah commit, double-write, client abort, proxy 502/503/504, async timeout, error loop.
6. Mendesain error response yang konsisten untuk HTML, JSON API, dan fallback container-level error.
7. Membuat observability error yang berguna untuk debugging dan audit tanpa membocorkan data sensitif.

Part ini tidak mengulang detail Spring MVC `@ControllerAdvice`, JAX-RS `ExceptionMapper`, Jakarta Security, atau Bean Validation. Semua itu punya layer masing-masing. Fokus kita adalah **Servlet runtime boundary**.

---

## 1. Mental Model Dasar: Error Bukan Hanya Exception

Dalam aplikasi Servlet, request bisa gagal melalui banyak jalur.

```text
Client
  |
  v
Reverse proxy / LB / ingress
  |
  v
Servlet container connector
  |
  v
Filter chain
  |
  v
Servlet / framework dispatcher
  |
  v
Application logic
  |
  v
Response generation
```

Error bisa muncul di setiap titik:

| Lokasi | Contoh error | Siapa yang menghasilkan response? |
|---|---|---|
| Reverse proxy | upstream timeout, body too large | proxy/LB |
| Connector | malformed request line, header terlalu besar | container/proxy |
| Filter | auth reject, rate limit, invalid body | filter/application |
| Servlet mapping | URL tidak cocok | container |
| Framework dispatcher | handler tidak ditemukan, method tidak didukung | framework/container |
| Business logic | domain conflict, invalid transition | application |
| Downstream | DB timeout, HTTP client timeout | application/container fallback |
| Response write | client disconnect, broken pipe | container/application log |
| Async task | timeout/race/error after initial thread released | async listener/container |

Jadi, error handling harus dilihat sebagai **responsibility chain**, bukan hanya `catch` block.

---

## 2. Empat Konsep yang Sering Tercampur

Ada empat hal yang sering dianggap sama padahal berbeda.

### 2.1 Java Exception

Exception adalah mekanisme kontrol kegagalan di JVM.

Contoh:

```java
throw new IllegalStateException("Order already closed");
```

Exception belum tentu berarti HTTP 500. Tergantung mapping aplikasi.

Contoh mapping yang masuk akal:

| Exception | HTTP status |
|---|---:|
| `IllegalArgumentException` untuk request malformed | 400 |
| `AccessDeniedException` | 403 |
| `EntityNotFoundException` | 404 |
| `OptimisticLockException` | 409 |
| `TimeoutException` downstream | 504 atau 503, tergantung boundary |
| Bug tak terduga | 500 |

### 2.2 HTTP Status Code

HTTP status adalah hasil request dari sudut pandang protocol.

Contoh:

```java
response.setStatus(HttpServletResponse.SC_NOT_FOUND);
```

Status code bisa dikirim tanpa exception.

### 2.3 Error Dispatch

Error dispatch adalah mekanisme Servlet container untuk mem-forward request ke error resource dengan `DispatcherType.ERROR`.

Contoh:

```xml
<error-page>
    <error-code>404</error-code>
    <location>/WEB-INF/error/404.jsp</location>
</error-page>
```

Saat error page dipanggil, request yang sama digunakan, tetapi dispatcher type berubah menjadi `ERROR` dan container mengisi error attributes.

### 2.4 Container Error Report

Jika aplikasi tidak menyediakan custom error page, container bisa menghasilkan default error page.

Contoh di Tomcat: default HTML error report. Di production, ini sering perlu dimatikan/diganti agar tidak membocorkan detail internal.

---

## 3. Lifecycle Error secara High-Level

Secara sederhana:

```text
Normal request
  |
  +--> filter/servlet writes success response
  |
  +--> app sets status manually
  |
  +--> app calls sendError(status)
  |
  +--> app throws exception
  |
  +--> container detects mapping/method/body/protocol error
```

Jika error terjadi, container mungkin melakukan:

```text
error detected
  |
  +--> find matching error-page by exception type
  |       |
  |       v
  |    dispatch to location as DispatcherType.ERROR
  |
  +--> else find matching error-page by status code
  |       |
  |       v
  |    dispatch to location as DispatcherType.ERROR
  |
  +--> else use container default error response
```

Tetapi alur ini memiliki syarat penting:

> Error dispatch hanya efektif jika response belum committed.

Jika response sudah committed, container tidak bebas mengganti status/header/body lagi.

---

## 4. `setStatus` vs `sendError` vs Throw Exception

Ini salah satu area paling penting.

### 4.1 `setStatus(int)`

`setStatus` hanya mengatur status code.

```java
response.setStatus(HttpServletResponse.SC_NOT_FOUND);
response.setContentType("application/json");
response.getWriter().write("{\"error\":\"not_found\"}");
```

Gunakan ketika aplikasi ingin mengontrol penuh response body.

Karakteristik:

| Aspek | `setStatus` |
|---|---|
| Mengubah status | Ya |
| Menganggap response sebagai error container | Tidak otomatis |
| Memicu error page | Umumnya tidak seperti `sendError` |
| Menghapus buffer | Tidak otomatis |
| Cocok untuk JSON API | Ya |
| Cocok untuk framework error response | Ya |

### 4.2 `sendError(int)`

`sendError` memberi tahu container bahwa response adalah error.

```java
response.sendError(HttpServletResponse.SC_NOT_FOUND);
```

Karakteristik penting:

| Aspek | `sendError` |
|---|---|
| Mengubah status | Ya |
| Menghapus buffer | Ya, jika belum committed |
| Bisa memicu error page mapping | Ya |
| Container dapat menghasilkan error body | Ya |
| Bisa gagal jika response committed | Ya |

Gunakan ketika ingin menyerahkan rendering error ke container/error page mechanism.

### 4.3 Throw Exception

```java
protected void doGet(HttpServletRequest request, HttpServletResponse response)
        throws ServletException, IOException {
    throw new ServletException("Unexpected failure");
}
```

Container akan menangani exception sesuai rules error page exception mapping atau default behavior.

Gunakan untuk kondisi tak terduga atau ketika layer atas memang punya centralized exception handling.

### 4.4 Decision Rule

```text
Butuh kontrol penuh JSON/body?
  -> setStatus + write body sendiri

Butuh container custom error page?
  -> sendError atau throw exception

Bug tak terduga?
  -> throw exception / propagate

Response sudah partially written?
  -> jangan berharap error page bisa mengganti response

Framework sudah punya exception resolver?
  -> jangan campur raw sendError sembarangan
```

---

## 5. Response Commit: Titik Tidak Bisa Balik

Response memiliki fase:

```text
Mutable response
  |
  | setStatus, setHeader, setContentType, write buffer
  v
Buffer full / flush / close / sendRedirect / sendError
  |
  v
Committed response
  |
  v
Body bytes sedang/selesai dikirim ke client
```

Sebelum committed:

- status bisa diubah,
- header bisa diubah,
- buffer bisa di-reset,
- error page masih mungkin dipakai.

Setelah committed:

- status line sudah terkirim,
- header sudah terkirim,
- error page tidak bisa mengganti response secara bersih,
- exception setelah commit biasanya hanya menjadi log/server-side failure.

Contoh bug:

```java
response.setContentType("application/json");
response.getWriter().write("{\"partial\":true");
response.flushBuffer();

// Terlambat. Response sudah committed.
throw new RuntimeException("DB failed after partial write");
```

Client mungkin menerima HTTP 200 dengan body rusak, sementara server log menunjukkan error.

Mental model:

> Setelah commit, failure tidak lagi bisa selalu diterjemahkan menjadi HTTP error yang rapi. Ia menjadi transport/application consistency failure.

---

## 6. Error Page Mapping di Deployment Descriptor

Servlet mendukung deklarasi error page.

### 6.1 By Status Code

```xml
<error-page>
    <error-code>404</error-code>
    <location>/WEB-INF/errors/404.jsp</location>
</error-page>
```

### 6.2 By Exception Type

```xml
<error-page>
    <exception-type>java.lang.Throwable</exception-type>
    <location>/WEB-INF/errors/500.jsp</location>
</error-page>
```

### 6.3 Default Error Page

Dalam Servlet spec modern, error-page tanpa `error-code` dan tanpa `exception-type` dapat dipakai sebagai default error page.

```xml
<error-page>
    <location>/WEB-INF/errors/default.jsp</location>
</error-page>
```

### 6.4 Urutan Pemilihan Konseptual

Secara praktis:

```text
Exception thrown?
  -> cari exception-type paling sesuai
  -> jika tidak ada, status/error code mapping
  -> jika tidak ada, default error page
  -> jika tidak ada, container default

Status error via sendError?
  -> cari error-code mapping
  -> jika tidak ada, default error page
  -> jika tidak ada, container default
```

Catatan:

- Exception mapping biasanya lebih spesifik daripada default mapping.
- Mapping by superclass dapat menangkap banyak exception.
- Terlalu luas menggunakan `Throwable` dapat menyembunyikan error serius seperti `OutOfMemoryError` jika tidak hati-hati.

---

## 7. DispatcherType.ERROR dan Error Attributes

Saat container melakukan error dispatch, request masuk ke resource error dengan dispatcher type:

```java
DispatcherType.ERROR
```

Resource error dapat membaca attribute standar seperti:

```java
Object statusCode = request.getAttribute(RequestDispatcher.ERROR_STATUS_CODE);
Object exceptionType = request.getAttribute(RequestDispatcher.ERROR_EXCEPTION_TYPE);
Object message = request.getAttribute(RequestDispatcher.ERROR_MESSAGE);
Object exception = request.getAttribute(RequestDispatcher.ERROR_EXCEPTION);
Object requestUri = request.getAttribute(RequestDispatcher.ERROR_REQUEST_URI);
Object servletName = request.getAttribute(RequestDispatcher.ERROR_SERVLET_NAME);
```

Biasanya constant tersebut merepresentasikan attribute dengan nama seperti:

```text
jakarta.servlet.error.status_code
jakarta.servlet.error.exception_type
jakarta.servlet.error.message
jakarta.servlet.error.exception
jakarta.servlet.error.request_uri
jakarta.servlet.error.servlet_name
```

Pada legacy Java EE, prefix-nya:

```text
javax.servlet.error.*
```

Dalam kode modern, gunakan constant dari `RequestDispatcher`, bukan hardcode string.

Contoh servlet error handler:

```java
@WebServlet("/error/json")
public class JsonErrorServlet extends HttpServlet {

    @Override
    protected void service(HttpServletRequest request, HttpServletResponse response)
            throws IOException {

        Integer status = (Integer) request.getAttribute(RequestDispatcher.ERROR_STATUS_CODE);
        Throwable throwable = (Throwable) request.getAttribute(RequestDispatcher.ERROR_EXCEPTION);
        String requestUri = (String) request.getAttribute(RequestDispatcher.ERROR_REQUEST_URI);

        int code = status != null ? status : 500;

        response.setStatus(code);
        response.setContentType("application/json");
        response.setCharacterEncoding("UTF-8");

        String errorCode = switch (code) {
            case 400 -> "bad_request";
            case 401 -> "unauthorized";
            case 403 -> "forbidden";
            case 404 -> "not_found";
            case 409 -> "conflict";
            case 429 -> "too_many_requests";
            case 503 -> "service_unavailable";
            case 504 -> "gateway_timeout";
            default -> "internal_error";
        };

        String traceId = (String) request.getAttribute("traceId");

        response.getWriter().write("""
            {
              "error": "%s",
              "status": %d,
              "path": "%s",
              "traceId": "%s"
            }
            """.formatted(
                escapeJson(errorCode),
                code,
                escapeJson(requestUri),
                escapeJson(traceId)
            ));
    }

    private static String escapeJson(String value) {
        if (value == null) return "";
        return value
                .replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r");
    }
}
```

Mapping:

```xml
<error-page>
    <error-code>400</error-code>
    <location>/error/json</location>
</error-page>
<error-page>
    <error-code>404</error-code>
    <location>/error/json</location>
</error-page>
<error-page>
    <error-code>500</error-code>
    <location>/error/json</location>
</error-page>
<error-page>
    <location>/error/json</location>
</error-page>
```

Catatan penting:

> Error servlet harus sangat defensive. Ia dipanggil saat sistem sudah dalam kondisi gagal.

Jangan melakukan operasi berat seperti query database, remote API call, atau template rendering kompleks tanpa fallback.

---

## 8. Filter dan Error Dispatch

Filter dapat berjalan pada dispatcher type berbeda.

```java
@WebFilter(
    urlPatterns = "/*",
    dispatcherTypes = {
        DispatcherType.REQUEST,
        DispatcherType.ERROR
    }
)
public class CorrelationFilter implements Filter {
    @Override
    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
            throws IOException, ServletException {
        HttpServletRequest request = (HttpServletRequest) req;
        HttpServletResponse response = (HttpServletResponse) res;

        String traceId = request.getHeader("X-Request-ID");
        if (traceId == null || traceId.isBlank()) {
            traceId = UUID.randomUUID().toString();
        }

        request.setAttribute("traceId", traceId);
        response.setHeader("X-Request-ID", traceId);

        chain.doFilter(request, response);
    }
}
```

Jika filter hanya mapped ke `REQUEST`, error dispatch mungkin tidak melewati filter tersebut.

Itu bisa menyebabkan:

- error page tidak punya trace ID,
- security headers hilang dari error response,
- access log tidak konsisten,
- response wrapping tidak berlaku pada error.

Namun mapping filter ke `ERROR` juga punya risiko:

- filter logging bisa double-log request,
- body wrapper bisa mencoba membaca ulang body,
- auth filter bisa memblokir error page,
- CORS filter bisa berbeda antara normal dan error.

Rule praktis:

| Filter | REQUEST | ERROR | ASYNC |
|---|---:|---:|---:|
| Correlation ID | Ya | Ya | Ya, jika async app |
| Security headers | Ya | Ya | Ya |
| Access logging | Ya | Hati-hati supaya tidak double count | Ya, jika desain mendukung |
| Authentication | Ya | Biasanya tidak untuk error page internal | Tergantung |
| Body parsing/caching | Ya | Biasanya tidak | Hati-hati |
| Rate limiting | Ya | Tidak perlu | Tidak perlu |

---

## 9. Exception Propagation dari Filter

Filter bisa melakukan:

```java
try {
    chain.doFilter(request, response);
} catch (Exception e) {
    // handle
}
```

Tapi ini berbahaya jika tidak jelas.

### 9.1 Anti-Pattern: Semua Exception Jadi 500 JSON

```java
try {
    chain.doFilter(request, response);
} catch (Exception e) {
    response.setStatus(500);
    response.getWriter().write("{\"error\":\"internal\"}");
}
```

Masalah:

- response mungkin sudah committed,
- mengalahkan framework exception handling,
- menelan exception sehingga monitoring tidak melihat error asli,
- tidak membedakan business error vs infrastructure error,
- bisa menulis body dua kali.

### 9.2 Lebih Aman: Boundary Filter Terbatas

Filter boleh menangani exception jika memang ia adalah owner boundary tersebut.

Contoh rate-limit filter:

```java
if (!allowed) {
    response.setStatus(429);
    response.setContentType("application/json");
    response.getWriter().write("{\"error\":\"too_many_requests\"}");
    return;
}

chain.doFilter(request, response);
```

Contoh correlation/logging filter:

```java
try {
    chain.doFilter(request, response);
} catch (IOException | ServletException | RuntimeException e) {
    log.error("Request failed traceId={}", traceId, e);
    throw e;
} finally {
    clearMdc();
}
```

Filter ini mengobservasi, bukan mengganti semantic error.

---

## 10. Mapping Exception ke HTTP Status

Tidak semua exception sama.

### 10.1 Taxonomy

| Kategori | Contoh | Status wajar |
|---|---|---:|
| Request malformed | invalid JSON, missing required query | 400 |
| Authentication missing | belum login/token missing | 401 |
| Authenticated tapi tidak berhak | akses module dilarang | 403 |
| Resource tidak ada | id tidak ditemukan | 404 |
| Method tidak cocok | POST ke endpoint GET-only | 405 |
| Media type salah | `Content-Type` tidak didukung | 415 |
| Accept tidak bisa dipenuhi | client minta format tidak tersedia | 406 |
| Business conflict | state transition tidak valid | 409 atau 422 |
| Rate limit | terlalu banyak request | 429 |
| Downstream unavailable | dependency mati | 503 |
| Gateway timeout | app sebagai gateway timeout ke service lain | 504 |
| Bug internal | NPE, invariant pecah | 500 |

### 10.2 400 vs 422 vs 409

Di Servlet layer murni, tidak ada kewajiban memakai 422. Namun dalam API design, bedakan:

| Status | Makna |
|---|---|
| 400 | Request tidak bisa dipahami/diparse/struktur salah |
| 409 | Request valid secara bentuk, tetapi konflik dengan state resource saat ini |
| 422 | Request valid secara sintaks, tetapi semantic validation gagal |

Contoh enforcement/case-management domain:

| Skenario | Status |
|---|---:|
| JSON rusak | 400 |
| `caseId` format invalid | 400 |
| Case tidak ditemukan | 404 |
| User mencoba approve case yang sudah closed | 409 |
| Field wajib business rule kosong | 422 atau 400, tergantung API convention |
| User tidak punya role officer | 403 |

Yang penting bukan memilih status paling “keren”, tetapi **konsisten dan defensible**.

---

## 11. Desain Error Response yang Konsisten

Untuk API, hindari response error yang berubah-ubah:

```json
{"error":"x"}
```

lalu:

```json
{"message":"x","code":123}
```

lalu HTML default Tomcat.

Buat struktur stabil.

Contoh:

```json
{
  "type": "https://example.com/problems/case-state-conflict",
  "title": "Case state conflict",
  "status": 409,
  "code": "CASE_STATE_CONFLICT",
  "detail": "The case cannot be approved because it is already closed.",
  "traceId": "f2f6b8b8-1f1e-4567-8a7c-2e7b7f7a1234",
  "timestamp": "2026-06-17T16:30:10Z"
}
```

### 11.1 Field yang Direkomendasikan

| Field | Tujuan |
|---|---|
| `status` | HTTP status code |
| `code` | stable application error code |
| `title` | ringkasan human-readable |
| `detail` | informasi cukup untuk client, tidak bocor internal |
| `traceId` | korelasi dengan log server |
| `path` | path request, jika aman |
| `timestamp` | waktu error |

### 11.2 Field yang Harus Dihindari di Production

Jangan kirim ke client:

- stack trace,
- SQL query internal,
- nama host/pod/node,
- internal class name,
- secret/token,
- PII,
- full downstream payload,
- path file server,
- detail authorization internal.

Client butuh **actionable error**, bukan isi perut server.

---

## 12. HTML Error Page vs JSON Error Response

Servlet app sering melayani dua tipe client:

1. browser biasa yang ingin HTML,
2. API client yang ingin JSON.

Salah satu pendekatan:

```java
private boolean wantsJson(HttpServletRequest request) {
    String accept = request.getHeader("Accept");
    String xhr = request.getHeader("X-Requested-With");
    String path = request.getRequestURI();

    return path.startsWith(request.getContextPath() + "/api/")
            || (accept != null && accept.contains("application/json"))
            || "XMLHttpRequest".equalsIgnoreCase(xhr);
}
```

Namun hati-hati:

- `Accept: */*` sangat umum,
- browser navigation sering accept HTML,
- `fetch()` kadang membawa accept default,
- endpoint API lebih baik dipisah path/host daripada hanya content negotiation.

Pattern yang lebih bersih:

```text
/api/*      -> JSON error handler
/web/*      -> HTML error page
static/*    -> simple 404/static fallback
```

---

## 13. `sendError` dan Error Page Body

Misal:

```java
response.getWriter().write("some body");
response.sendError(404);
```

Ini problematik.

Kenapa?

- `sendError` akan clear buffer jika belum committed.
- Jika buffer sudah committed, `sendError` bisa gagal/throw `IllegalStateException`.
- Body yang sudah ditulis mungkin hilang.

Rule:

> Pilih satu model: tulis response sendiri dengan `setStatus`, atau delegasikan ke error mechanism dengan `sendError`. Jangan campur sembarangan.

---

## 14. Error Setelah Partial Streaming

Streaming response punya failure semantic khusus.

Contoh download:

```java
response.setStatus(200);
response.setContentType("application/octet-stream");

try (InputStream in = fileStore.open(id);
     OutputStream out = response.getOutputStream()) {
    in.transferTo(out);
}
```

Jika error terjadi setelah 10MB terkirim:

- status 200 mungkin sudah terkirim,
- header sudah terkirim,
- tidak bisa mengganti menjadi 500,
- client menerima partial file,
- server log harus mencatat partial transfer,
- client harus validasi checksum/length jika penting.

Untuk streaming, error handling harus didesain sebelum commit:

```text
Validate permission
Validate metadata
Validate file exists
Set headers
Start streaming
If failure after streaming begins -> log + close connection; cannot make clean JSON error
```

---

## 15. Async Servlet Error Handling

Async memperkenalkan race condition.

```java
AsyncContext async = request.startAsync();
async.setTimeout(5000);

executor.submit(() -> {
    try {
        HttpServletResponse response = (HttpServletResponse) async.getResponse();
        response.setContentType("application/json");
        response.getWriter().write("{\"ok\":true}");
        async.complete();
    } catch (Exception e) {
        async.dispatch("/error/json");
    }
});
```

Masalah:

- timeout bisa terjadi sebelum task selesai,
- task bisa menulis response setelah timeout dispatch,
- `complete()` bisa dipanggil dua kali,
- error dispatch bisa terjadi setelah response committed,
- MDC/security context hilang di executor thread.

Lebih defensif:

```java
AtomicBoolean done = new AtomicBoolean(false);
AsyncContext async = request.startAsync();
async.setTimeout(5000);

async.addListener(new AsyncListener() {
    @Override
    public void onTimeout(AsyncEvent event) throws IOException {
        if (done.compareAndSet(false, true)) {
            HttpServletResponse response = (HttpServletResponse) event.getAsyncContext().getResponse();
            if (!response.isCommitted()) {
                response.setStatus(503);
                response.setContentType("application/json");
                response.getWriter().write("{\"error\":\"timeout\"}");
            }
            event.getAsyncContext().complete();
        }
    }

    @Override
    public void onError(AsyncEvent event) throws IOException {
        if (done.compareAndSet(false, true)) {
            HttpServletResponse response = (HttpServletResponse) event.getAsyncContext().getResponse();
            if (!response.isCommitted()) {
                response.setStatus(500);
                response.setContentType("application/json");
                response.getWriter().write("{\"error\":\"internal\"}");
            }
            event.getAsyncContext().complete();
        }
    }

    @Override public void onComplete(AsyncEvent event) {}
    @Override public void onStartAsync(AsyncEvent event) {}
});

executor.submit(() -> {
    try {
        if (done.get()) return;

        HttpServletResponse response = (HttpServletResponse) async.getResponse();
        String payload = computePayload();

        if (done.compareAndSet(false, true)) {
            response.setStatus(200);
            response.setContentType("application/json");
            response.getWriter().write(payload);
            async.complete();
        }
    } catch (Exception e) {
        if (done.compareAndSet(false, true)) {
            try {
                HttpServletResponse response = (HttpServletResponse) async.getResponse();
                if (!response.isCommitted()) {
                    response.setStatus(500);
                    response.setContentType("application/json");
                    response.getWriter().write("{\"error\":\"internal\"}");
                }
            } catch (IOException ignored) {
                // log in real code
            } finally {
                async.complete();
            }
        }
    }
});
```

Intinya:

> Async error handling harus punya single-owner completion gate.

---

## 16. Client Abort, Broken Pipe, Connection Reset

Tidak semua IOException saat menulis response adalah server bug.

Contoh:

- user menutup tab,
- browser cancel request karena navigasi,
- mobile network putus,
- reverse proxy menutup idle upstream,
- client timeout lebih pendek dari server processing.

Server bisa melihat:

```text
java.io.IOException: Broken pipe
java.io.IOException: Connection reset by peer
ClientAbortException
```

Rule:

| Situasi | Interpretasi |
|---|---|
| Client abort saat download besar | Sering normal |
| Client abort banyak pada endpoint lambat | Indikasi latency/timeout mismatch |
| Client abort setelah proxy timeout | App terlalu lambat atau timeout tidak selaras |
| Client abort saat response kecil | Perlu investigasi network/proxy/browser |

Jangan langsung menaikkan semua client abort menjadi incident P1. Tapi jangan juga mengabaikan pattern-nya.

Observability yang berguna:

- endpoint,
- bytes sent,
- duration sebelum abort,
- user agent,
- upstream proxy status,
- trace ID,
- request size/response size,
- pod/node/container.

---

## 17. Proxy 502, 503, 504 vs Servlet Error

Banyak error yang terlihat di browser bukan berasal dari aplikasi.

| Status | Bisa berasal dari | Makna umum |
|---:|---|---|
| 502 | proxy/LB | upstream response invalid/connection reset |
| 503 | proxy/app/container | service unavailable/overloaded/not ready |
| 504 | proxy/LB/gateway | upstream timeout |
| 413 | proxy/container/app | body terlalu besar |
| 431 | proxy/container | header terlalu besar |
| 499-like | Nginx-style log | client closed request |

Contoh mismatch:

```text
ALB idle timeout: 60s
Nginx proxy_read_timeout: 30s
Servlet async timeout: 120s
Application DB query timeout: 90s
Client fetch timeout: 20s
```

Hasilnya:

- client timeout di 20s,
- proxy mungkin log client closed,
- nginx timeout di 30s,
- app masih kerja sampai 90s,
- servlet async timeout 120s tidak pernah relevan.

Top-tier engineer selalu menyelaraskan timeout:

```text
Client timeout >= expected UX boundary
Proxy timeout >= app timeout + small margin
App timeout <= downstream timeout budget
DB/HTTP client timeout < app request timeout
Servlet async timeout >= app controlled timeout or acts as final guard
```

---

## 18. Designing Error as State Machine

Daripada berpikir “try/catch”, gunakan state machine.

```text
RECEIVED
  |
  v
VALIDATING_PROTOCOL
  |-- malformed --> REJECTED_400
  |
  v
AUTHENTICATING
  |-- missing --> REJECTED_401
  |-- invalid --> REJECTED_401
  |
  v
AUTHORIZING
  |-- denied --> REJECTED_403
  |
  v
LOADING_RESOURCE
  |-- not found --> REJECTED_404
  |
  v
CHECKING_BUSINESS_INVARIANT
  |-- conflict --> REJECTED_409
  |
  v
EXECUTING
  |-- downstream timeout --> FAILED_503_OR_504
  |-- bug --> FAILED_500
  |
  v
WRITING_RESPONSE
  |-- client abort --> ABORTED_BY_CLIENT
  |-- partial write failure --> PARTIAL_RESPONSE_FAILURE
  |
  v
COMPLETED
```

Untuk regulatory/case-management system, ini penting karena error harus bisa dipertanggungjawabkan:

- apakah request ditolak karena input salah?
- apakah user tidak berwenang?
- apakah state transition tidak valid?
- apakah dependency gagal?
- apakah operation sebenarnya berhasil tapi response gagal dikirim?

Pertanyaan terakhir sering terlupakan.

Contoh:

```text
User clicks Approve Case
  -> DB transaction commits successfully
  -> response write fails because client disconnected
```

Dari sisi server: approval berhasil.  
Dari sisi user: mungkin terlihat gagal.  
Dari sisi audit: harus ada record sukses.  
Dari sisi retry: retry harus idempotent atau mendeteksi already-approved.

---

## 19. Application Error Code Design

HTTP status saja tidak cukup.

Status `409` bisa berarti:

- duplicate submission,
- stale version,
- invalid workflow transition,
- entity locked,
- already processed.

Gunakan stable error code.

Contoh:

```text
CASE_NOT_FOUND
CASE_ALREADY_CLOSED
CASE_VERSION_CONFLICT
CASE_LOCKED_BY_OTHER_USER
CASE_TRANSITION_NOT_ALLOWED
DOCUMENT_UPLOAD_TOO_LARGE
DOCUMENT_SCAN_PENDING
DOWNSTREAM_DMS_UNAVAILABLE
```

Pattern naming:

```text
<DOMAIN>_<CONDITION>
```

Jangan:

```text
ERR001
ERR002
ERR003
```

kecuali ada registry yang jelas.

Good error code harus:

- stable,
- searchable di log,
- bisa didokumentasikan,
- tidak bergantung pada bahasa UI,
- tidak membocorkan internal implementation,
- punya mapping ke HTTP status.

---

## 20. Centralized Error Handler di Servlet Murni

Dalam framework modern, centralized error handling biasanya disediakan framework. Tetapi di Servlet murni, kita bisa membuat error servlet.

### 20.1 Domain Exception

```java
public class AppException extends RuntimeException {
    private final int status;
    private final String code;
    private final String safeMessage;

    public AppException(int status, String code, String safeMessage) {
        super(safeMessage);
        this.status = status;
        this.code = code;
        this.safeMessage = safeMessage;
    }

    public int status() {
        return status;
    }

    public String code() {
        return code;
    }

    public String safeMessage() {
        return safeMessage;
    }
}
```

### 20.2 Throw from Servlet

```java
throw new AppException(409, "CASE_ALREADY_CLOSED", "Case is already closed.");
```

### 20.3 Error Servlet Reads Throwable

```java
@WebServlet("/internal/error")
public class AppErrorServlet extends HttpServlet {

    @Override
    protected void service(HttpServletRequest request, HttpServletResponse response)
            throws IOException {

        Throwable throwable = (Throwable) request.getAttribute(RequestDispatcher.ERROR_EXCEPTION);
        Integer servletStatus = (Integer) request.getAttribute(RequestDispatcher.ERROR_STATUS_CODE);

        int status = servletStatus != null ? servletStatus : 500;
        String code = "INTERNAL_ERROR";
        String title = "Unexpected error";

        Throwable root = unwrap(throwable);

        if (root instanceof AppException app) {
            status = app.status();
            code = app.code();
            title = app.safeMessage();
        } else if (status == 404) {
            code = "NOT_FOUND";
            title = "Resource not found";
        } else if (status == 405) {
            code = "METHOD_NOT_ALLOWED";
            title = "Method not allowed";
        }

        response.setStatus(status);
        response.setContentType("application/json");
        response.setCharacterEncoding("UTF-8");

        String traceId = String.valueOf(request.getAttribute("traceId"));
        String path = String.valueOf(request.getAttribute(RequestDispatcher.ERROR_REQUEST_URI));

        response.getWriter().write("""
            {
              "status": %d,
              "code": "%s",
              "title": "%s",
              "path": "%s",
              "traceId": "%s"
            }
            """.formatted(
                status,
                escapeJson(code),
                escapeJson(title),
                escapeJson(path),
                escapeJson(traceId)
            ));
    }

    private static Throwable unwrap(Throwable throwable) {
        if (throwable == null) return null;
        if (throwable instanceof ServletException se && se.getRootCause() != null) {
            return se.getRootCause();
        }
        return throwable;
    }

    private static String escapeJson(String value) {
        if (value == null) return "";
        return value
                .replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r");
    }
}
```

### 20.4 Mapping

```xml
<error-page>
    <exception-type>java.lang.Throwable</exception-type>
    <location>/internal/error</location>
</error-page>

<error-page>
    <error-code>404</error-code>
    <location>/internal/error</location>
</error-page>

<error-page>
    <error-code>405</error-code>
    <location>/internal/error</location>
</error-page>

<error-page>
    <location>/internal/error</location>
</error-page>
```

Caveat:

- Jangan expose `/internal/error` sebagai public endpoint yang bisa dipanggil langsung tanpa konteks.
- Jika dipanggil langsung, ia harus tetap aman.
- Jangan melakukan business logic di error servlet.

---

## 21. Preventing Error Loops

Error page juga bisa error.

```text
Original servlet throws exception
  -> container dispatches /error.jsp
  -> /error.jsp throws exception
  -> container tries error mapping again
  -> loop or fallback default error
```

Cara menghindari:

1. Error handler harus minimalis.
2. Jangan bergantung pada database.
3. Jangan bergantung pada remote service.
4. Jangan memakai template kompleks untuk fallback utama.
5. Pastikan error page tidak dilindungi filter auth yang bisa redirect lagi.
6. Pastikan error page tidak memanggil resource yang juga error.
7. Gunakan static fallback untuk catastrophic failure.

Contoh defensive guard:

```java
if (request.getAttribute("app.error.handled") != null) {
    response.setStatus(500);
    response.setContentType("text/plain");
    response.getWriter().write("Internal Server Error");
    return;
}
request.setAttribute("app.error.handled", Boolean.TRUE);
```

---

## 22. Error Handling and Transactions

Servlet layer sering berada di luar transaction, tetapi error semantics tetap memengaruhi transaction.

Pattern yang aman:

```text
Validate request before transaction
  -> reject 400/403/404 early
Open transaction
  -> mutate state
Commit transaction
After commit
  -> build response
```

Bahaya:

```text
Start response streaming
  -> write partial success body
  -> perform DB mutation
  -> DB fails
```

Client mungkin menerima sinyal sukses parsial padahal operasi gagal.

Rule:

> Jangan commit response sukses sebelum outcome bisnis final diketahui, kecuali memang endpoint didesain streaming/progressive dan punya semantic khusus.

Untuk operasi penting:

- commit DB dulu,
- simpan audit event,
- baru kirim response sukses,
- jika response gagal setelah commit, jangan rollback bisnis karena client disconnected.

---

## 23. Idempotency dan Ambiguous Failure

Ambiguous failure terjadi ketika client tidak tahu apakah server berhasil memproses request.

Contoh:

```text
Client sends POST /case/123/approve
Server commits approval
Network drops before response reaches client
Client sees timeout
```

Client bertanya: boleh retry?

Jika retry tanpa idempotency, bisa:

- double approval,
- duplicate document,
- duplicate email,
- duplicate payment-like operation,
- duplicate audit trail.

Pattern:

```text
Idempotency-Key: <client-generated-key>
```

Server menyimpan:

```text
key + user + operation + request fingerprint + final result
```

Jika retry datang:

- jika key sama dan request sama, return stored result,
- jika key sama tapi request berbeda, return 409,
- jika operation sudah committed, return final state.

Ini bukan fitur Servlet, tetapi Servlet engineer top-tier harus memahami bahwa transport failure memengaruhi business correctness.

---

## 24. Logging Error dengan Benar

Bad logging:

```java
log.error("Error: " + e.getMessage());
```

Masalah:

- stack trace hilang,
- trace ID tidak ada,
- endpoint/user tidak ada,
- bisa bocor data,
- sulit korelasi dengan proxy log.

Better:

```java
log.error(
    "request_failed traceId={} method={} path={} status={} userId={} errorCode={}",
    traceId,
    request.getMethod(),
    safePath(request),
    status,
    safeUserId,
    errorCode,
    throwable
);
```

Tetapi hati-hati dengan:

- request body,
- authorization header,
- cookie,
- PII,
- uploaded file name sensitif,
- stack trace untuk expected 4xx.

Rule praktis:

| Error | Log level |
|---|---|
| 400 karena input user | INFO/WARN tergantung volume |
| 401/403 biasa | INFO/WARN, jangan spam |
| 404 random internet noise | DEBUG/INFO aggregated |
| 409 business conflict | INFO |
| 429 rate limit | INFO/WARN with aggregation |
| 500 bug | ERROR |
| 503 dependency unavailable | ERROR/WARN tergantung known outage |
| client abort download | DEBUG/INFO, aggregate metric |

---

## 25. Metrics yang Harus Ada

Minimal:

```text
http.server.requests.count{method,path,status}
http.server.requests.duration{method,path,status}
http.server.errors.count{status,error_code}
http.server.client_aborts.count{path}
http.server.response.committed_before_error.count{path}
http.server.async.timeouts.count{path}
http.server.error_dispatch.count{status}
```

Untuk WebSocket nanti akan ada metric terpisah, tetapi untuk Servlet error:

- status distribution,
- p95/p99 latency for errors,
- 5xx rate,
- 4xx rate,
- 404 spike,
- 413 spike,
- 429 spike,
- async timeout rate,
- client abort rate,
- downstream timeout correlation.

Metric tanpa dimensi path/status sulit digunakan.

Tapi terlalu banyak dimensi juga bahaya:

```text
path=/case/123
path=/case/124
path=/case/125
```

akan menyebabkan cardinality explosion.

Gunakan route template:

```text
/case/{caseId}
```

---

## 26. Access Log vs Application Log

Access log menjawab:

```text
Apa yang dikirim ke client/proxy?
```

Application log menjawab:

```text
Apa yang terjadi di dalam aplikasi?
```

Keduanya bisa berbeda.

Contoh:

```text
Application log:
  case approved successfully traceId=abc

Access log:
  200 bytes=0 duration=1200 client_abort=true traceId=abc
```

Artinya business operation sukses, tetapi client tidak menerima response sempurna.

Gunakan trace ID yang sama di:

- reverse proxy access log,
- servlet access log,
- application log,
- downstream HTTP calls,
- audit trail jika relevant.

---

## 27. Container-Level Error Before Application Code

Ada error yang terjadi sebelum filter/servlet dipanggil.

Contoh:

- request line invalid,
- HTTP header terlalu besar,
- invalid chunked encoding,
- TLS handshake failure,
- connector rejects connection,
- request body terlalu besar di proxy,
- malformed URI.

Dalam kasus ini:

- application correlation filter mungkin tidak jalan,
- error servlet mungkin tidak dipanggil,
- app log tidak ada,
- hanya proxy/container access log yang punya bukti.

Karena itu production diagnosis tidak boleh hanya melihat application log.

Checklist:

```text
1. Apakah request mencapai app?
2. Apakah filter pertama berjalan?
3. Apakah trace ID tercipta?
4. Apakah access log container mencatat?
5. Apakah proxy access log mencatat upstream_status?
6. Apakah LB log mencatat target_status?
```

---

## 28. Tomcat ErrorReportValve dan Container Default Error

Tomcat memiliki default error report mechanism yang bisa menghasilkan HTML error page saat tidak ada aplikasi error page yang cocok.

Di production, pertimbangkan:

- custom error page per app,
- menonaktifkan/menyembunyikan detail stack trace,
- tidak menampilkan server version,
- konsisten untuk 404/500,
- fallback static error page.

Contoh konsep Tomcat config:

```xml
<Host ...>
    <Valve className="org.apache.catalina.valves.ErrorReportValve"
           showReport="false"
           showServerInfo="false" />
</Host>
```

Detail atribut tergantung versi Tomcat. Selalu cek dokumentasi versi container yang dipakai.

---

## 29. 404 dan 405: Container vs Framework

`404` bisa muncul dari beberapa level:

| Level | Contoh |
|---|---|
| Proxy | route tidak cocok ke service |
| Container context | context path salah |
| Servlet mapping | tidak ada servlet match |
| Framework routing | servlet match, handler tidak ada |
| Application | resource id tidak ditemukan |

Sama-sama 404, tetapi root cause berbeda.

`405` juga bisa dari:

- `HttpServlet` default method handling,
- framework dispatcher,
- application convention.

Contoh:

```java
@WebServlet("/cases")
public class CaseServlet extends HttpServlet {
    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp) {
        // supported
    }
}
```

Jika client mengirim POST, default `HttpServlet` bisa mengembalikan method not allowed.

Debugging 404/405 harus melihat:

```text
Original URI
Context path
Servlet path
Path info
Dispatcher type
Matched servlet
Framework route
HTTP method
Forwarded prefix/path rewrite
```

---

## 30. 413, 414, 431: Error yang Sering Salah Layer

### 30.1 413 Payload Too Large

Bisa berasal dari:

- browser/client library,
- CDN/WAF,
- Nginx `client_max_body_size`,
- ingress limit,
- Tomcat `maxPostSize`/multipart config,
- application validation.

Jika app tidak menerima request, error handler Servlet tidak akan jalan.

### 30.2 414 URI Too Long

Biasanya akibat:

- GET dipakai untuk payload besar,
- query param terlalu banyak,
- redirect loop menambah parameter,
- encoded state terlalu besar.

### 30.3 431 Request Header Fields Too Large

Sering akibat:

- cookie bloat,
- JWT terlalu besar di cookie/header,
- terlalu banyak tracking cookies,
- SSO cookie domain terlalu luas,
- reverse proxy header limit lebih kecil dari container.

Error ini harus didiagnosis lintas layer.

---

## 31. CORS dan Error Response

API bisa gagal bukan karena status-nya salah, tetapi karena browser tidak mengizinkan client JS membaca error response.

Contoh:

- normal response punya `Access-Control-Allow-Origin`,
- error response tidak punya header CORS,
- browser menampilkan CORS error,
- developer tidak melihat JSON error body.

CORS/security header filter sebaiknya berlaku juga untuk error dispatch atau minimal memastikan error response tetap punya header yang dibutuhkan.

Contoh:

```java
response.setHeader("Access-Control-Allow-Origin", allowedOrigin);
response.setHeader("Vary", "Origin");
```

Caveat:

- jangan wildcard `*` jika credentials/cookie dipakai,
- jangan reflect origin tanpa allowlist,
- preflight error harus jelas.

---

## 32. Security Implications of Error Handling

Error handling bisa menjadi vulnerability.

### 32.1 Information Disclosure

Jangan expose:

```text
java.sql.SQLSyntaxErrorException: ORA-00942 table ACEAS_CASE not found
```

ke client.

### 32.2 User Enumeration

Hati-hati response:

```text
Email not registered
```

vs

```text
Wrong password
```

Untuk auth flow, error harus dirancang agar tidak membantu attacker.

### 32.3 Authorization Detail Leakage

Jangan beritahu:

```text
You need role SENIOR_ENFORCEMENT_OFFICER_LEVEL_3 to access /internal/legal/escalation
```

Lebih aman:

```json
{
  "code": "ACCESS_DENIED",
  "status": 403
}
```

### 32.4 Stack Trace in HTML

Default container error page bisa membocorkan:

- server version,
- class name,
- stack trace,
- file path,
- library version.

Matikan di production.

---

## 33. Error Handling in Multi-Module Enterprise Apps

Dalam aplikasi besar, setiap module sering punya error sendiri.

Contoh module:

```text
case
appeal
compliance
correspondence
document
exam
revenue
survey
```

Jangan biarkan setiap module membuat format error sendiri.

Buat registry:

```text
CASE_NOT_FOUND -> 404
CASE_STATE_CONFLICT -> 409
DOCUMENT_TOO_LARGE -> 413
DOCUMENT_SCAN_FAILED -> 422/500 depending reason
SURVEY_ALREADY_SUBMITTED -> 409
REVENUE_PAYMENT_PENDING -> 409
EXAM_SLOT_FULL -> 409
```

Tambahkan owner:

```text
code, http_status, owner_module, retryable, user_message_key, audit_required
```

Contoh table:

| Code | Status | Retryable | Audit? | Meaning |
|---|---:|---:|---:|---|
| `CASE_NOT_FOUND` | 404 | No | Optional | Case ID not visible/found |
| `CASE_LOCKED` | 409 | Yes | Yes | Case locked by another workflow |
| `DOCUMENT_UPLOAD_TOO_LARGE` | 413 | No | Optional | File exceeds limit |
| `DMS_UNAVAILABLE` | 503 | Yes | Yes | Document service unavailable |
| `APPROVAL_ALREADY_COMPLETED` | 409/200 | Depends | Yes | Duplicate approval attempt |

For critical workflows, decide whether duplicate operation returns:

- `409 conflict`, or
- `200/204 idempotent success`, or
- `303 see existing result`.

This is domain decision, not just technical status choice.

---

## 34. Retryability Semantics

Error response should imply whether retry makes sense.

| Status | Retry? | Notes |
|---:|---|---|
| 400 | No | Client must fix request |
| 401 | After re-auth | Token/session issue |
| 403 | No | Permission issue |
| 404 | Usually no | Unless eventual consistency |
| 409 | Maybe | Depends conflict type |
| 429 | Yes after delay | Include `Retry-After` if possible |
| 500 | Maybe | But risk duplicate for non-idempotent POST |
| 503 | Yes | Include `Retry-After` if known |
| 504 | Maybe | Ambiguous; server may still process downstream |

For retryable errors:

```java
response.setHeader("Retry-After", "30");
```

But only use `Retry-After` if meaningful. Jangan asal memberi 30 detik jika sistem tidak tahu kapan pulih.

---

## 35. Error Handling for Redirect-Based Web Apps

Untuk browser app server-rendered, error flow sering memakai redirect.

Contoh:

```java
response.sendRedirect(request.getContextPath() + "/login?expired=true");
```

Caveat:

- redirect mengubah request method menjadi GET pada banyak skenario,
- original error attributes hilang karena request baru,
- flash message perlu session/temp storage,
- open redirect risk,
- redirect loop risk,
- AJAX/fetch tidak selalu menginginkan HTML login page.

Contoh bug:

```text
API request gets 302 to /login
fetch follows redirect
browser receives HTML
frontend tries JSON.parse
frontend shows generic error
```

Untuk API:

- 401 JSON lebih baik daripada 302 HTML login.

Untuk browser navigation:

- 302 ke login bisa benar.

Boundary harus jelas.

---

## 36. Error Handling with SPA Fallback

SPA sering memakai fallback:

```text
/anything -> index.html
```

Ini bisa merusak error semantics.

Contoh buruk:

```text
GET /api/cases/unknown
  -> fallback index.html 200
```

Client menerima HTML padahal expected JSON 404.

Rule:

```text
/api/*     never fallback to SPA index.html
/assets/*  static resource or 404
/*         SPA fallback only for browser routes
```

Mapping Servlet/proxy harus menegakkan boundary ini.

---

## 37. Production Debugging Playbook

Ketika ada laporan “user dapat error”, jangan langsung cari stack trace.

### Step 1: Identifikasi Response yang Diterima User

```text
Status code?
Body JSON/HTML/kosong?
Trace ID ada?
Timestamp?
Endpoint/path?
Method?
User action?
```

### Step 2: Cari di Access Log

```text
traceId / requestId
status
bytes sent
duration
upstream status
client IP/proxy IP
user agent
```

### Step 3: Cari di Application Log

```text
traceId
exception
error code
business operation
transaction outcome
```

### Step 4: Tentukan Layer

```text
Did request reach app?
Did filter run?
Did servlet/framework route match?
Did business operation start?
Did transaction commit?
Did response commit?
Did proxy timeout first?
Did client disconnect?
```

### Step 5: Classify

```text
client input error
permission error
business conflict
dependency failure
capacity/timeout
bug
network/proxy/client abort
unknown
```

### Step 6: Decide Action

```text
fix code
fix config
align timeout
increase capacity
improve client message
add metric/log
add idempotency
add validation
```

---

## 38. Anti-Patterns

### 38.1 Catch-All Filter That Swallows Everything

```java
catch (Exception e) {
    response.setStatus(500);
}
```

Hilang stack trace, salah status, sulit debugging.

### 38.2 Returning 200 for Error

```json
{
  "success": false,
  "error": "not found"
}
```

dengan HTTP 200.

Ini merusak:

- cache,
- retry logic,
- monitoring,
- client SDK,
- proxy behavior,
- SLO metrics.

Ada exception untuk legacy contract, tapi default-nya jangan.

### 38.3 Exposing Stack Trace to Client

Berguna di local dev, berbahaya di production.

### 38.4 Different Error Shape Per Module

Membuat frontend dan integrator bingung.

### 38.5 Error Handler Calls Downstream

Error handler yang memanggil DB/remote service bisa gagal lagi saat sistem sedang bermasalah.

### 38.6 Logging Expected 4xx as ERROR

Membuat alert fatigue.

### 38.7 Not Logging 5xx with Stack Trace

Membuat root cause hilang.

### 38.8 Ignoring Response Commit

Mencoba mengirim JSON error setelah download/stream sudah dimulai.

---

## 39. Design Checklist

Sebelum production, jawab:

```text
[ ] Apakah semua API error punya consistent JSON shape?
[ ] Apakah HTML error page tidak membocorkan stack trace?
[ ] Apakah 404 dari API tidak jatuh ke SPA fallback?
[ ] Apakah CORS/security headers tetap ada pada error response?
[ ] Apakah correlation ID ada pada normal dan error response?
[ ] Apakah error page mapping mencakup 400/404/405/413/500/default?
[ ] Apakah expected 4xx tidak dilog sebagai ERROR?
[ ] Apakah 5xx selalu punya stack trace server-side?
[ ] Apakah client abort dibedakan dari server failure?
[ ] Apakah timeout app/proxy/downstream selaras?
[ ] Apakah async timeout punya single completion owner?
[ ] Apakah error handler tidak bergantung pada dependency rapuh?
[ ] Apakah response committed sebelum mutation selesai dihindari?
[ ] Apakah non-idempotent operation punya idempotency strategy?
[ ] Apakah default container error report aman untuk production?
```

---

## 40. Mini Case Study: Approval Endpoint

Misal endpoint:

```text
POST /api/cases/{caseId}/approve
```

### 40.1 Failure Taxonomy

| Stage | Failure | Status | Error code |
|---|---|---:|---|
| Parse | invalid JSON | 400 | `INVALID_JSON` |
| Auth | not logged in | 401 | `AUTH_REQUIRED` |
| Authz | role not allowed | 403 | `ACCESS_DENIED` |
| Load | case not found | 404 | `CASE_NOT_FOUND` |
| State | already closed | 409 | `CASE_ALREADY_CLOSED` |
| State | stale version | 409 | `CASE_VERSION_CONFLICT` |
| Dependency | audit service unavailable | 503 | `AUDIT_UNAVAILABLE` |
| Internal | NPE/bug | 500 | `INTERNAL_ERROR` |
| Response | client disconnect after commit | log only | `CLIENT_ABORT_AFTER_COMMIT` metric |

### 40.2 Important Invariant

```text
If approval transaction committed, response failure must not imply approval failure.
```

Karena itu retry harus idempotent:

```text
POST /api/cases/123/approve
Idempotency-Key: abc
```

Jika response hilang dan client retry:

```json
{
  "status": 200,
  "code": "CASE_APPROVAL_ALREADY_CONFIRMED",
  "caseId": "123",
  "approvedAt": "2026-06-17T16:30:10Z",
  "traceId": "..."
}
```

Atau return `409`, tergantung contract. Yang penting deterministic.

---

## 41. Summary Mental Model

Simpan model ini:

```text
Error handling = protocol semantics + container lifecycle + response state + business outcome + observability.
```

Key points:

1. `setStatus` berarti aplikasi mengontrol response.
2. `sendError` berarti aplikasi meminta container menjalankan error mechanism.
3. Throw exception berarti container/framework menentukan mapping error.
4. Error dispatch memakai request yang sama dengan `DispatcherType.ERROR`.
5. Error page hanya efektif jika response belum committed.
6. Error setelah streaming dimulai tidak selalu bisa menjadi HTTP error rapi.
7. Proxy/LB bisa menghasilkan error sebelum aplikasi melihat request.
8. API error butuh stable shape dan stable error code.
9. 5xx harus observable; 4xx harus classified, bukan dibanjiri alert.
10. Untuk operasi penting, transport failure setelah commit menciptakan ambiguous outcome yang harus ditangani dengan idempotency/audit.

---

## 42. Latihan

### Latihan 1 — Classify Error

Untuk setiap skenario, tentukan status code, error code, dan layer owner:

1. User mengirim JSON rusak.
2. User tidak punya role untuk approve case.
3. Case ID valid tetapi tidak ditemukan.
4. Case sudah closed.
5. DB timeout sebelum transaction dimulai.
6. Transaction commit sukses, tetapi client disconnect sebelum response selesai.
7. Upload file 100MB, limit app 20MB, limit Nginx 10MB.
8. Header cookie terlalu besar karena JWT/cookie bloat.
9. `NullPointerException` di servlet.
10. Async request timeout, task masih berjalan.

### Latihan 2 — Design Error Response

Buat JSON error contract untuk:

```text
CASE_STATE_CONFLICT
DOCUMENT_UPLOAD_TOO_LARGE
AUTH_REQUIRED
DOWNSTREAM_TIMEOUT
INTERNAL_ERROR
```

Untuk tiap error, tentukan:

```text
HTTP status
code
title
retryable
safe detail
audit required?
```

### Latihan 3 — Debugging 504

User mendapat 504 dari browser. Application log tidak menunjukkan error.

Investigasi:

```text
1. Log mana yang harus dicek?
2. Apa kemungkinan request tidak mencapai aplikasi?
3. Apa kemungkinan aplikasi masih memproses setelah proxy timeout?
4. Timeout mana yang harus dibandingkan?
5. Metric apa yang membuktikan bottleneck?
```

---

## 43. Referensi

- Jakarta Servlet 6.1 Specification — error page, dispatching, Servlet runtime behavior.
- Jakarta Servlet API — `HttpServletResponse`, `RequestDispatcher`, `DispatcherType`, `AsyncContext`, `AsyncListener`.
- RFC 9110 — HTTP status code semantics.
- Apache Tomcat documentation — ErrorReportValve and container-level error reporting.
- Jakarta EE Platform API — Servlet HTTP response contracts.

---

## 44. Status Seri

Part ini adalah **Part 017** dari seri:

```text
learn-java-servlet-websocket-web-container-runtime
```

Seri belum selesai. Lanjut ke:

```text
Part 018 — Threading Model: Classic Servlet, Platform Threads, Virtual Threads
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 016 — Multipart Upload, File Download, and Large Payload Handling](./learn-java-servlet-websocket-web-container-runtime-part-016.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 018 — Threading Model: Classic Servlet, Platform Threads, Virtual Threads](./learn-java-servlet-websocket-web-container-runtime-part-018.md)
