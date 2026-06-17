# learn-java-servlet-websocket-web-container-runtime-part-008

# Part 008 — Request Dispatching: Forward, Include, Async, Error

> Seri: `learn-java-servlet-websocket-web-container-runtime`  
> Part: `008 / 031`  
> Fokus: `RequestDispatcher`, `forward`, `include`, `ERROR`, `ASYNC`, dispatcher type, request attributes, filter interaction, dispatch loop, dan mental model lifecycle request yang berpindah antar resource di dalam container.

---

## 0. Tujuan Pembelajaran

Setelah bagian ini, kamu diharapkan mampu memahami bahwa request di Servlet container tidak selalu berjalan lurus seperti:

```text
client -> servlet -> response
```

Dalam aplikasi nyata, request bisa berpindah antar resource di dalam container:

```text
client
  -> Filter A
  -> ControllerServlet
      -> forward ke JSP/error servlet/internal servlet
          -> Filter B? tergantung DispatcherType
          -> target resource
  -> response
```

Atau:

```text
client
  -> Servlet
      -> include header.jsp
      -> include menu.jsp
      -> include content.jsp
      -> include footer.jsp
  -> response final
```

Atau:

```text
client
  -> Servlet
      -> startAsync()
      -> return worker thread ke container
      -> background task selesai
      -> async dispatch ke servlet lain
  -> response
```

Atau ketika error:

```text
client
  -> Servlet
      -> throw exception / sendError(500)
  -> container error dispatch
      -> /error
  -> response error final
```

Target utamanya bukan sekadar tahu method `forward()` dan `include()`, tetapi mampu membaca request lifecycle sebagai **state machine** yang bisa berpindah antar state:

```text
REQUEST -> FORWARD -> RESPONSE_COMMITTED
REQUEST -> INCLUDE -> REQUEST_CONTINUES
REQUEST -> ERROR -> ERROR_RESPONSE
REQUEST -> ASYNC_STARTED -> ASYNC_DISPATCH -> COMPLETE
```

Di level top-tier engineering, ini penting karena banyak bug produksi di Java web app bukan berasal dari business logic, melainkan dari salah memahami boundary ini:

- filter tidak terpanggil saat forward;
- filter terpanggil dua kali saat error;
- response sudah commit sebelum forward;
- body error hilang karena response sudah sebagian ditulis;
- logging duplicate karena `REQUEST` dan `ASYNC` dispatch sama-sama dicatat;
- authorization bypass karena internal forward tidak melewati filter yang tepat;
- redirect loop karena error page melempar error lagi;
- observability kacau karena satu HTTP request punya beberapa dispatch internal.

---

## 1. Mental Model: Request Tidak Selalu Satu Resource

Servlet container menerima request dari client, memilih resource awal berdasarkan mapping, lalu menjalankan filter chain dan servlet target. Namun setelah servlet target aktif, aplikasi dapat meminta container untuk meneruskan request ke resource lain.

Ada empat bentuk dispatch penting:

| Dispatch | Makna | Efek utama |
|---|---|---|
| `REQUEST` | Request awal dari client | Entry point pertama ke aplikasi |
| `FORWARD` | Memindahkan request ke resource lain di server | Target baru mengambil alih response |
| `INCLUDE` | Menyisipkan output resource lain ke response sekarang | Caller tetap mengontrol response |
| `ERROR` | Container mengirim request ke error page/resource | Dipakai setelah exception atau `sendError` |
| `ASYNC` | Request dilanjutkan setelah async boundary | Dipakai oleh Servlet async processing |

Secara konsep:

```text
REQUEST  = external entry
FORWARD  = internal transfer of responsibility
INCLUDE  = internal composition
ERROR    = internal failure rendering
ASYNC    = internal continuation after delayed work
```

Yang sering membingungkan: semua ini masih berada dalam **satu HTTP request dari perspektif client**, tetapi container bisa membuat beberapa siklus internal.

Contoh:

```text
Browser meminta: GET /app/orders/123

Container mapping awal:
  /orders/* -> FrontControllerServlet

FrontControllerServlet:
  request.getRequestDispatcher("/WEB-INF/views/order-detail.jsp").forward(req, res)

Internal dispatch:
  target JSP menghasilkan HTML

Client tetap melihat:
  GET /app/orders/123
```

Client tidak tahu bahwa server melakukan forward ke JSP. URL browser tidak berubah. Ini berbeda dari redirect.

---

## 2. Dispatch vs Redirect

Sebelum masuk detail, bedakan dua konsep yang sering tertukar:

| Aspek | Dispatch / Forward | Redirect |
|---|---|---|
| Terjadi di mana | Server-side | Client-side melalui response 3xx |
| Browser tahu? | Tidak | Ya |
| URL browser berubah? | Tidak | Ya |
| Request object sama? | Ya, dengan atribut dispatch tambahan | Tidak, request baru |
| Bisa akses resource tersembunyi seperti `/WEB-INF`? | Ya, dari server | Tidak langsung dari browser |
| Cocok untuk | MVC view rendering, internal routing, error page | Post/Redirect/Get, canonical URL, login redirect |

Forward:

```java
request.getRequestDispatcher("/WEB-INF/views/order.jsp")
       .forward(request, response);
```

Redirect:

```java
response.sendRedirect(request.getContextPath() + "/orders/123");
```

Mental model:

```text
forward  = server berkata: "resource internal lain, lanjutkan request ini"
redirect = server berkata ke browser: "silakan buat request baru ke URL ini"
```

Forward tidak boleh dipakai untuk mengganti URL publik. Redirect tidak boleh dipakai untuk mengakses internal JSP yang seharusnya tersembunyi.

---

## 3. `RequestDispatcher`: Objek untuk Dispatch Internal

`RequestDispatcher` adalah object yang dibuat oleh container sebagai wrapper menuju resource server-side tertentu. Resource target bisa berupa:

- servlet;
- JSP/Jakarta Pages;
- static resource;
- default servlet;
- error page;
- resource lain dalam web application yang sama.

Dua method utama:

```java
void forward(ServletRequest request, ServletResponse response)
    throws ServletException, IOException;

void include(ServletRequest request, ServletResponse response)
    throws ServletException, IOException;
```

Cara mendapatkannya:

```java
RequestDispatcher dispatcher = request.getRequestDispatcher("/WEB-INF/views/home.jsp");
```

atau:

```java
RequestDispatcher dispatcher = servletContext.getRequestDispatcher("/WEB-INF/views/home.jsp");
```

atau by name:

```java
RequestDispatcher dispatcher = servletContext.getNamedDispatcher("default");
```

Perbedaan penting:

| Cara | Path relatif? | Umum dipakai untuk |
|---|---:|---|
| `request.getRequestDispatcher(path)` | Bisa relatif terhadap current request | MVC internal routing dekat dengan request |
| `servletContext.getRequestDispatcher(path)` | Harus context-root relative, biasanya diawali `/` | Dispatch eksplisit dari context |
| `getNamedDispatcher(name)` | Berdasarkan servlet name | Advanced/container-specific integration |

Praktik yang paling aman untuk aplikasi besar:

```java
request.getRequestDispatcher("/WEB-INF/views/order.jsp")
       .forward(request, response);
```

Gunakan path absolut relatif terhadap context root. Ini mengurangi ambiguity ketika URL request berubah.

---

## 4. Forward: Transfer Tanggung Jawab ke Resource Lain

`forward()` digunakan ketika satu servlet melakukan preprocessing, lalu menyerahkan generation response ke resource lain.

Contoh klasik MVC:

```java
@WebServlet("/orders/*")
public class OrderControllerServlet extends HttpServlet {

    @Override
    protected void doGet(HttpServletRequest request, HttpServletResponse response)
            throws ServletException, IOException {

        String pathInfo = request.getPathInfo(); // e.g. /123
        OrderViewModel vm = loadOrder(pathInfo);

        request.setAttribute("order", vm);

        request.getRequestDispatcher("/WEB-INF/views/order-detail.jsp")
               .forward(request, response);
    }
}
```

Di sini:

- browser meminta `/orders/123`;
- servlet membaca input dan menyiapkan model;
- model disimpan sebagai request attribute;
- JSP menghasilkan HTML;
- browser tetap melihat `/orders/123`.

### 4.1 Forward harus terjadi sebelum response committed

Forward butuh target resource mengambil alih response. Kalau response sudah committed, container tidak bisa mengubah status/header/body dari awal.

Contoh buruk:

```java
protected void doGet(HttpServletRequest request, HttpServletResponse response)
        throws IOException, ServletException {

    response.getWriter().println("partial output");
    response.flushBuffer(); // commit

    request.getRequestDispatcher("/WEB-INF/views/page.jsp")
           .forward(request, response); // kemungkinan IllegalStateException
}
```

Response committed berarti status line dan headers sudah dikirim ke client. Setelah itu forward tidak lagi aman.

Prinsip:

```text
forward adalah keputusan routing internal.
Keputusan routing harus selesai sebelum response final mulai dikirim.
```

### 4.2 Setelah forward, caller sebaiknya return

Secara Java, method `forward()` akan kembali ke caller setelah target selesai. Namun secara desain, setelah forward kamu biasanya harus `return`.

Contoh buruk:

```java
request.getRequestDispatcher("/WEB-INF/views/home.jsp")
       .forward(request, response);

response.getWriter().println("extra output"); // bug konseptual
```

Contoh baik:

```java
request.getRequestDispatcher("/WEB-INF/views/home.jsp")
       .forward(request, response);
return;
```

Kenapa?

Karena setelah forward, target resource dianggap sudah bertanggung jawab atas response. Menulis lagi setelah forward sering menyebabkan output tak terduga, double rendering, atau error setelah commit.

### 4.3 Forward tidak membuat request baru

Forward mempertahankan object request yang sama. Karena itu attribute yang diset di servlet awal bisa dibaca target.

```java
request.setAttribute("userMessage", "Order created");
request.getRequestDispatcher("/WEB-INF/views/success.jsp")
       .forward(request, response);
```

Di JSP:

```jsp
${userMessage}
```

Parameter, header, cookie, session juga tetap dapat diakses. Namun container menambahkan atribut khusus untuk memberi tahu original path.

---

## 5. Forward Attributes

Ketika forward terjadi, Servlet spec mendefinisikan atribut request khusus. Nama modernnya berada di `RequestDispatcher` constants.

Atribut umum:

```java
RequestDispatcher.FORWARD_REQUEST_URI
RequestDispatcher.FORWARD_CONTEXT_PATH
RequestDispatcher.FORWARD_SERVLET_PATH
RequestDispatcher.FORWARD_PATH_INFO
RequestDispatcher.FORWARD_QUERY_STRING
RequestDispatcher.FORWARD_MAPPING
```

Contoh membaca original URI:

```java
String originalUri = (String) request.getAttribute(RequestDispatcher.FORWARD_REQUEST_URI);
String originalQuery = (String) request.getAttribute(RequestDispatcher.FORWARD_QUERY_STRING);
```

Gunanya:

- logging original request walaupun target sudah berubah;
- audit trail;
- debugging routing;
- error response yang ingin tahu URL asli;
- framework internals;
- security diagnostics.

Contoh mental model:

```text
Client request URI : /app/orders/123?tab=payment
Forward target     : /WEB-INF/views/order.jsp

Target JSP/servlet bisa melihat:
  current servlet path mungkin target JSP
  FORWARD_REQUEST_URI = /app/orders/123
  FORWARD_QUERY_STRING = tab=payment
```

Ini penting karena kalau kamu hanya log `request.getRequestURI()` di target, kamu bisa mendapatkan perspektif target, bukan selalu original entry point.

---

## 6. Include: Komposisi Output Resource

`include()` digunakan ketika servlet ingin menyisipkan output resource lain ke response yang sedang dibuat.

Contoh:

```java
protected void doGet(HttpServletRequest request, HttpServletResponse response)
        throws ServletException, IOException {

    response.setContentType("text/html;charset=UTF-8");

    response.getWriter().println("<html><body>");

    request.getRequestDispatcher("/WEB-INF/fragments/header.jsp")
           .include(request, response);

    response.getWriter().println("<main>Content</main>");

    request.getRequestDispatcher("/WEB-INF/fragments/footer.jsp")
           .include(request, response);

    response.getWriter().println("</body></html>");
}
```

Include bukan transfer tanggung jawab. Caller tetap mengontrol response final.

Perbandingan:

| Aspek | `forward()` | `include()` |
|---|---|---|
| Target mengambil alih response? | Ya | Tidak |
| Caller lanjut menulis setelah dispatch? | Umumnya tidak | Ya |
| Cocok untuk | View final / internal routing | Fragment composition |
| Boleh setelah response committed? | Tidak | Bisa, karena hanya menambah body |
| Target boleh mengubah status/header efektif? | Ya sebelum commit | Sangat terbatas/tidak efektif |

### 6.1 Include target tidak seharusnya mengubah response global

Resource yang di-include tidak boleh dianggap punya kontrol penuh atas status code atau header final.

Contoh buruk:

```java
// fragment servlet
response.setStatus(404);
response.setHeader("X-Fragment", "abc");
response.getWriter().println("fragment");
```

Secara desain, include target hanya menghasilkan body fragment. Header/status final adalah tanggung jawab caller.

### 6.2 Include Attributes

Saat include terjadi, container menambahkan atribut:

```java
RequestDispatcher.INCLUDE_REQUEST_URI
RequestDispatcher.INCLUDE_CONTEXT_PATH
RequestDispatcher.INCLUDE_SERVLET_PATH
RequestDispatcher.INCLUDE_PATH_INFO
RequestDispatcher.INCLUDE_QUERY_STRING
RequestDispatcher.INCLUDE_MAPPING
```

Gunanya mirip forward attributes, tetapi untuk resource yang sedang di-include.

---

## 7. DispatcherType

`DispatcherType` adalah enum yang menjelaskan jenis dispatch saat ini.

Nilai utamanya:

```java
DispatcherType.REQUEST
DispatcherType.FORWARD
DispatcherType.INCLUDE
DispatcherType.ERROR
DispatcherType.ASYNC
```

Kamu bisa membacanya dari request:

```java
DispatcherType type = request.getDispatcherType();
```

Contoh logging:

```java
System.out.printf("dispatcher=%s uri=%s%n",
        request.getDispatcherType(),
        ((HttpServletRequest) request).getRequestURI());
```

Kenapa ini penting?

Karena satu HTTP request bisa melewati beberapa internal dispatch, dan filter/listener/logging bisa melihat lebih dari satu fase.

Contoh lifecycle:

```text
REQUEST /orders/123
  -> OrderController
      forward /WEB-INF/views/order.jsp
FORWARD /WEB-INF/views/order.jsp
  -> JSP renders output
```

Atau:

```text
REQUEST /report/export
  -> ReportServlet throws RuntimeException
ERROR /error
  -> ErrorServlet renders JSON error
```

Tanpa membaca dispatcher type, kamu akan mengira ada dua request berbeda.

---

## 8. Filter dan DispatcherType

Filter tidak otomatis berlaku untuk semua dispatch dalam cara yang sama. Mapping filter dapat menentukan dispatcher type.

Dengan annotation:

```java
@WebFilter(
    urlPatterns = "/*",
    dispatcherTypes = {
        DispatcherType.REQUEST,
        DispatcherType.ERROR
    }
)
public class RequestLoggingFilter implements Filter {
    @Override
    public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
            throws IOException, ServletException {
        chain.doFilter(request, response);
    }
}
```

Dengan `web.xml`:

```xml
<filter-mapping>
    <filter-name>requestLoggingFilter</filter-name>
    <url-pattern>/*</url-pattern>
    <dispatcher>REQUEST</dispatcher>
    <dispatcher>ERROR</dispatcher>
</filter-mapping>
```

### 8.1 Filter REQUEST-only

Jika filter hanya dipasang untuk `REQUEST`, maka forward/include/error/async dispatch mungkin tidak melewati filter itu.

```java
@WebFilter(urlPatterns = "/*", dispatcherTypes = DispatcherType.REQUEST)
public class RequestOnlyFilter implements Filter { ... }
```

Lifecycle:

```text
REQUEST /orders/123
  -> RequestOnlyFilter
  -> OrderServlet
      forward /WEB-INF/views/order.jsp
FORWARD /WEB-INF/views/order.jsp
  -> JSP directly, filter tidak jalan lagi
```

Ini bisa benar atau salah tergantung tujuan.

### 8.2 Filter FORWARD

Gunakan `FORWARD` jika logic harus berlaku ketika request dipindah ke resource internal.

Contoh:

```java
@WebFilter(
    urlPatterns = "/WEB-INF/views/*",
    dispatcherTypes = DispatcherType.FORWARD
)
public class InternalViewFilter implements Filter { ... }
```

Use case:

- memastikan view model tersedia;
- logging rendering view;
- instrumentation internal dispatch;
- mencegah akses view yang salah secara internal.

Namun hati-hati: filter authorization biasanya tidak cukup hanya FORWARD. Authorization harus diletakkan pada boundary request publik, bukan hanya view internal.

### 8.3 Filter INCLUDE

Gunakan `INCLUDE` untuk fragment rendering.

Use case jarang, tetapi ada:

- instrumentation JSP fragment;
- layout engine lama;
- include-specific transformation.

### 8.4 Filter ERROR

Gunakan `ERROR` ketika ingin memproses error dispatch.

Contoh:

```java
@WebFilter(
    urlPatterns = "/*",
    dispatcherTypes = {DispatcherType.REQUEST, DispatcherType.ERROR}
)
public class ErrorAwareCorrelationFilter implements Filter {
    @Override
    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
            throws IOException, ServletException {

        HttpServletRequest request = (HttpServletRequest) req;
        String cid = ensureCorrelationId(request);

        try {
            chain.doFilter(req, res);
        } finally {
            // hati-hati agar tidak double-count sebagai dua request independen
            logDispatch(cid, request.getDispatcherType(), request.getRequestURI());
        }
    }
}
```

Risiko:

```text
REQUEST filter log: status 500
ERROR filter log  : status 500
```

Kalau metric kamu menghitung dua-duanya sebagai request terpisah, angka error rate bisa salah.

### 8.5 Filter ASYNC

Gunakan `ASYNC` ketika filter perlu ikut pada async continuation.

Contoh:

```java
@WebFilter(
    urlPatterns = "/*",
    asyncSupported = true,
    dispatcherTypes = {DispatcherType.REQUEST, DispatcherType.ASYNC}
)
public class AsyncAwareFilter implements Filter { ... }
```

Untuk async processing, filter juga harus `asyncSupported = true` jika request dapat melewati async boundary.

---

## 9. Error Dispatch

Error dispatch terjadi ketika container mengarahkan request ke error page/resource karena:

- servlet melempar exception;
- filter melempar exception;
- container mendeteksi error;
- application memanggil `response.sendError(status)`;
- status code tertentu dimapping ke error page.

Contoh `web.xml`:

```xml
<error-page>
    <error-code>404</error-code>
    <location>/WEB-INF/errors/404.jsp</location>
</error-page>

<error-page>
    <exception-type>java.lang.Throwable</exception-type>
    <location>/error</location>
</error-page>
```

Contoh servlet error endpoint:

```java
@WebServlet("/error")
public class ErrorServlet extends HttpServlet {

    @Override
    protected void service(HttpServletRequest request, HttpServletResponse response)
            throws IOException {

        Integer status = (Integer) request.getAttribute(RequestDispatcher.ERROR_STATUS_CODE);
        Throwable throwable = (Throwable) request.getAttribute(RequestDispatcher.ERROR_EXCEPTION);
        String requestUri = (String) request.getAttribute(RequestDispatcher.ERROR_REQUEST_URI);

        int code = status != null ? status : 500;

        response.setStatus(code);
        response.setContentType("application/json;charset=UTF-8");

        String message = code >= 500 ? "Internal server error" : "Request failed";

        response.getWriter().printf(
                "{\"status\":%d,\"message\":\"%s\",\"path\":\"%s\"}",
                code,
                escapeJson(message),
                escapeJson(requestUri)
        );
    }
}
```

### 9.1 Error Attributes

Atribut error umum:

```java
RequestDispatcher.ERROR_STATUS_CODE
RequestDispatcher.ERROR_EXCEPTION
RequestDispatcher.ERROR_EXCEPTION_TYPE
RequestDispatcher.ERROR_MESSAGE
RequestDispatcher.ERROR_REQUEST_URI
RequestDispatcher.ERROR_SERVLET_NAME
RequestDispatcher.ERROR_QUERY_STRING // Servlet 6.1+
```

Gunanya:

- menentukan status code final;
- mengetahui exception asli;
- logging path asli;
- menghindari expose stack trace ke client;
- membuat error response konsisten.

### 9.2 `sendError` vs throw exception

```java
response.sendError(404, "Order not found");
```

berbeda dari:

```java
throw new OrderNotFoundException(orderId);
```

`sendError` adalah sinyal eksplisit ke container bahwa response error harus dikirim. Throw exception adalah kegagalan execution yang container tangkap dan petakan ke error page jika ada mapping.

Dalam aplikasi modern yang pakai framework, exception biasanya ditangani oleh framework exception mapper. Tetapi di level Servlet murni, container error dispatch adalah mekanisme fundamental.

### 9.3 Error dispatch dapat gagal lagi

Error page juga bisa error.

Contoh buruk:

```java
@WebServlet("/error")
public class ErrorServlet extends HttpServlet {
    protected void service(HttpServletRequest request, HttpServletResponse response) {
        throw new RuntimeException("error page failed");
    }
}
```

Ini bisa menyebabkan:

- fallback container error page;
- recursive dispatch protection;
- response kosong/partial;
- noisy logs;
- 500 tanpa body yang konsisten.

Prinsip:

```text
Error handler harus sangat defensif.
Jangan bergantung pada dependency rapuh.
Jangan melakukan query DB berat.
Jangan memanggil service yang mungkin sumber error awal.
```

---

## 10. Async Dispatch

Async Servlet sudah akan dibahas lebih detail di Part 014, tetapi di sini kita perlu memahami hubungannya dengan dispatch.

Async processing memungkinkan servlet memulai async context, mengembalikan thread container, lalu menyelesaikan request nanti.

Contoh sederhana:

```java
@WebServlet(urlPatterns = "/async-report", asyncSupported = true)
public class AsyncReportServlet extends HttpServlet {

    private final ExecutorService executor = Executors.newFixedThreadPool(16);

    @Override
    protected void doGet(HttpServletRequest request, HttpServletResponse response)
            throws IOException {

        AsyncContext async = request.startAsync();
        async.setTimeout(30_000);

        executor.submit(() -> {
            try {
                ReportResult result = generateReport();
                async.getRequest().setAttribute("result", result);
                async.dispatch("/WEB-INF/views/report.jsp");
            } catch (Exception e) {
                async.getRequest().setAttribute("asyncError", e);
                async.dispatch("/error");
            }
        });
    }
}
```

Lifecycle:

```text
REQUEST /async-report
  -> startAsync()
  -> servlet returns, container thread released
  -> background task runs
  -> async.dispatch("/WEB-INF/views/report.jsp")
ASYNC /WEB-INF/views/report.jsp
  -> JSP renders response
```

Poin penting:

- async dispatch adalah dispatch internal baru;
- dispatcher type menjadi `ASYNC`;
- filter harus mendukung async jika ingin berada di lifecycle itu;
- request/response tetap dikelola container;
- jangan menyimpan request/response di static/global;
- harus memanggil `complete()` jika tidak dispatch.

Contoh complete langsung:

```java
AsyncContext async = request.startAsync();
executor.submit(() -> {
    try {
        HttpServletResponse res = (HttpServletResponse) async.getResponse();
        res.setContentType("text/plain;charset=UTF-8");
        res.getWriter().println("done");
    } catch (IOException e) {
        // log safely
    } finally {
        async.complete();
    }
});
```

`dispatch()` berarti lanjut ke resource lain. `complete()` berarti response selesai di async task.

---

## 11. Request Attributes Across Dispatch

Request attributes adalah mekanisme utama untuk membawa data internal antar servlet/JSP selama satu request.

Contoh:

```java
request.setAttribute("viewModel", vm);
request.getRequestDispatcher("/WEB-INF/views/page.jsp")
       .forward(request, response);
```

Target:

```java
Object vm = request.getAttribute("viewModel");
```

Karakteristik:

| Properti | Request attribute |
|---|---|
| Scope | Satu request lifecycle, termasuk forward/include/error/async selama request sama |
| Visible ke client? | Tidak langsung |
| Thread-safe? | Tidak otomatis |
| Cocok untuk | View model, internal flags, correlation data, parsed request info |
| Tidak cocok untuk | Data session user jangka panjang, cache global, object mutable lintas request |

### 11.1 Attribute collision

Di aplikasi besar, attribute name mudah bentrok.

Buruk:

```java
request.setAttribute("user", user);
```

Lebih aman:

```java
request.setAttribute("com.acme.order.viewModel", orderViewModel);
```

Atau gunakan constant:

```java
public final class RequestAttributes {
    public static final String ORDER_VIEW_MODEL =
            "com.acme.order.ORDER_VIEW_MODEL";

    private RequestAttributes() {}
}
```

### 11.2 Attribute sebagai hidden control flow

Request attributes bisa menjadi “jalan belakang” yang sulit dilacak.

Contoh buruk:

```java
// Filter A
request.setAttribute("skipValidation", true);

// Servlet B
if (Boolean.TRUE.equals(request.getAttribute("skipValidation"))) {
    // skip
}
```

Masalah:

- coupling tidak eksplisit;
- susah dites;
- rawan security bypass;
- forward/include bisa membawa flag ke tempat tak terduga.

Gunakan attribute untuk data request, bukan sebagai sistem permission tersembunyi.

---

## 12. Dispatch as State Machine

Agar tidak tersesat, bayangkan request sebagai state machine.

### 12.1 Forward State Machine

```text
[REQUEST_RECEIVED]
  -> [FILTER_CHAIN_REQUEST]
  -> [SERVLET_A]
  -> forward(target)
  -> [FILTER_CHAIN_FORWARD?]
  -> [TARGET_RESOURCE]
  -> [RESPONSE_COMMIT]
  -> [DONE]
```

Invariant:

```text
forward harus terjadi sebelum response committed.
```

### 12.2 Include State Machine

```text
[REQUEST_RECEIVED]
  -> [SERVLET_A_WRITES_BEGIN]
  -> include(fragment)
  -> [FILTER_CHAIN_INCLUDE?]
  -> [FRAGMENT_WRITES_BODY]
  -> [SERVLET_A_CONTINUES]
  -> [RESPONSE_COMMIT]
  -> [DONE]
```

Invariant:

```text
include target tidak memiliki ownership penuh atas response.
```

### 12.3 Error State Machine

```text
[REQUEST_RECEIVED]
  -> [FILTER/SERVLET]
  -> exception OR sendError
  -> [CONTAINER_ERROR_MAPPING]
  -> [FILTER_CHAIN_ERROR?]
  -> [ERROR_RESOURCE]
  -> [ERROR_RESPONSE_COMMIT]
  -> [DONE]
```

Invariant:

```text
error handler harus aman walaupun request sudah dalam kondisi gagal.
```

### 12.4 Async State Machine

```text
[REQUEST_RECEIVED]
  -> [SERVLET_START_ASYNC]
  -> [CONTAINER_THREAD_RELEASED]
  -> [ASYNC_WORK]
  -> dispatch OR write+complete OR timeout
  -> [ASYNC_DISPATCH_RESOURCE?]
  -> [COMPLETE]
```

Invariant:

```text
async request harus complete, dispatch, atau timeout secara terkendali.
```

---

## 13. Common Dispatch Patterns

### 13.1 Front Controller to View

```java
@WebServlet("/app/*")
public class FrontControllerServlet extends HttpServlet {

    @Override
    protected void service(HttpServletRequest request, HttpServletResponse response)
            throws ServletException, IOException {

        RouteResult result = route(request);

        if (result.notFound()) {
            response.sendError(HttpServletResponse.SC_NOT_FOUND);
            return;
        }

        request.setAttribute("model", result.model());
        request.getRequestDispatcher(result.viewPath())
               .forward(request, response);
    }
}
```

Mental model:

```text
public URL stable
internal view hidden under /WEB-INF
controller prepares model
view renders final response
```

### 13.2 Error Controller

```java
@WebServlet("/error")
public class JsonErrorServlet extends HttpServlet {

    @Override
    protected void service(HttpServletRequest request, HttpServletResponse response)
            throws IOException {

        Integer status = (Integer) request.getAttribute(RequestDispatcher.ERROR_STATUS_CODE);
        String uri = (String) request.getAttribute(RequestDispatcher.ERROR_REQUEST_URI);

        int code = status == null ? 500 : status;

        response.setStatus(code);
        response.setContentType("application/json;charset=UTF-8");
        response.getWriter().write("{\"status\":" + code + ",\"path\":\"" + escapeJson(uri) + "\"}");
    }
}
```

### 13.3 Internal Access Guard

Kadang resource internal harus hanya bisa diakses via forward, bukan direct request.

```java
@WebFilter(
    urlPatterns = "/WEB-INF/views/*",
    dispatcherTypes = {DispatcherType.REQUEST, DispatcherType.FORWARD}
)
public class InternalViewGuardFilter implements Filter {
    @Override
    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
            throws IOException, ServletException {

        HttpServletRequest request = (HttpServletRequest) req;
        HttpServletResponse response = (HttpServletResponse) res;

        if (request.getDispatcherType() == DispatcherType.REQUEST) {
            response.sendError(HttpServletResponse.SC_NOT_FOUND);
            return;
        }

        chain.doFilter(req, res);
    }
}
```

Catatan: resource di `/WEB-INF` memang tidak bisa diakses langsung oleh client melalui URL normal. Guard ini lebih relevan untuk internal path lain yang tidak berada di `/WEB-INF`.

### 13.4 Async to View

```java
@WebServlet(urlPatterns = "/jobs/status", asyncSupported = true)
public class JobStatusServlet extends HttpServlet {

    @Override
    protected void doGet(HttpServletRequest request, HttpServletResponse response) {
        AsyncContext async = request.startAsync();
        async.setTimeout(10_000);

        CompletableFuture
                .supplyAsync(() -> loadJobStatus(request.getParameter("id")))
                .whenComplete((status, error) -> {
                    try {
                        if (error != null) {
                            async.getRequest().setAttribute("error", error);
                            async.dispatch("/error");
                        } else {
                            async.getRequest().setAttribute("status", status);
                            async.dispatch("/WEB-INF/views/job-status.jsp");
                        }
                    } catch (Exception dispatchError) {
                        async.complete();
                    }
                });
    }
}
```

---

## 14. Production Bug: Filter Double Logging

Misalnya filter logging dipasang untuk `REQUEST` dan `ERROR`:

```java
@WebFilter(
    urlPatterns = "/*",
    dispatcherTypes = {DispatcherType.REQUEST, DispatcherType.ERROR}
)
public class AccessLogFilter implements Filter {
    @Override
    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
            throws IOException, ServletException {
        long start = System.nanoTime();
        try {
            chain.doFilter(req, res);
        } finally {
            HttpServletRequest request = (HttpServletRequest) req;
            log(request.getDispatcherType(), request.getRequestURI(), elapsedMs(start));
        }
    }
}
```

Jika servlet awal throw exception:

```text
log: REQUEST /orders/123 500 12ms
log: ERROR   /error      500 3ms
```

Apakah ini salah? Tidak selalu. Tetapi kalau kamu mengirim dua log ini ke access metric sebagai “dua HTTP requests”, metrik kamu salah.

Solusi: bedakan **dispatch log** dari **request access log**.

Contoh:

```java
boolean isInitialRequest = request.getDispatcherType() == DispatcherType.REQUEST;

try {
    chain.doFilter(req, res);
} finally {
    if (isInitialRequest) {
        logOneClientRequest(request, response);
    } else {
        logInternalDispatch(request);
    }
}
```

Atau simpan marker:

```java
private static final String ACCESS_LOGGED = "com.acme.ACCESS_LOGGED";

if (request.getAttribute(ACCESS_LOGGED) == null) {
    request.setAttribute(ACCESS_LOGGED, Boolean.TRUE);
    logOneClientRequest(...);
}
```

Namun marker juga harus hati-hati jika filter order dan async dispatch kompleks.

---

## 15. Production Bug: Response Already Committed Before Forward

Kasus umum:

```java
protected void doGet(HttpServletRequest request, HttpServletResponse response)
        throws IOException, ServletException {

    PrintWriter out = response.getWriter();
    out.println("debug: start");

    if (!authorized(request)) {
        request.getRequestDispatcher("/WEB-INF/views/login.jsp")
               .forward(request, response);
        return;
    }
}
```

Saat output kecil, mungkin buffer belum commit. Saat output cukup besar atau flush terjadi, forward gagal.

Lebih buruk, bug ini bisa intermittent:

- di DEV aman karena buffer besar;
- di PROD gagal karena compression/proxy/filter flush;
- hanya gagal pada response besar;
- hanya gagal saat exception path.

Prinsip:

```text
Jangan tulis response sebelum keputusan final dibuat:
- status?
- redirect?
- forward?
- error?
- content type?
```

Pattern aman:

```java
if (!authorized(request)) {
    response.sendRedirect(request.getContextPath() + "/login");
    return;
}

request.setAttribute("model", model);
request.getRequestDispatcher("/WEB-INF/views/page.jsp")
       .forward(request, response);
```

---

## 16. Production Bug: Security Filter Tidak Berlaku Saat Forward

Misalnya security filter hanya memeriksa direct request ke `/admin/*`.

```java
@WebFilter(urlPatterns = "/admin/*", dispatcherTypes = DispatcherType.REQUEST)
public class AdminSecurityFilter implements Filter { ... }
```

Servlet lain melakukan:

```java
request.getRequestDispatcher("/admin/delete-user")
       .forward(request, response);
```

Jika filter tidak mencakup `FORWARD`, internal forward tersebut bisa melewati security filter.

Solusi bukan selalu “tambahkan FORWARD ke semua security filter”. Solusi yang benar tergantung arsitektur:

1. jangan expose operation sensitif sebagai servlet internal yang bisa diforward sembarang;
2. letakkan authorization di service/domain layer juga;
3. filter boundary publik tetap penting;
4. untuk path sensitif, pertimbangkan dispatcher type `REQUEST` + `FORWARD`;
5. hindari internal forward ke endpoint mutating operation.

Mental model:

```text
Authorization tidak boleh hanya bergantung pada asumsi URL entry point.
Internal dispatch adalah alternate path menuju resource.
```

---

## 17. Production Bug: Error Page Membocorkan Exception

Buruk:

```java
Throwable t = (Throwable) request.getAttribute(RequestDispatcher.ERROR_EXCEPTION);
response.getWriter().println(t.toString());
```

Masalah:

- class name internal bocor;
- SQL error bocor;
- path server bocor;
- stack trace bocor;
- data sensitif mungkin muncul di message exception.

Lebih aman:

```java
Throwable t = (Throwable) request.getAttribute(RequestDispatcher.ERROR_EXCEPTION);
String errorId = UUID.randomUUID().toString();

log.error("errorId={} requestUri={} failure", errorId,
        request.getAttribute(RequestDispatcher.ERROR_REQUEST_URI),
        t);

response.setStatus(500);
response.setContentType("application/json;charset=UTF-8");
response.getWriter().write("{\"errorId\":\"" + errorId + "\",\"message\":\"Internal server error\"}");
```

Prinsip:

```text
Client butuh stable error contract.
Operator butuh detailed error log.
Jangan tukar keduanya.
```

---

## 18. Production Bug: Error Dispatch Loop

Misalnya mapping error 404 ke `/not-found`, tetapi `/not-found` sendiri tidak termapping.

```xml
<error-page>
    <error-code>404</error-code>
    <location>/not-found</location>
</error-page>
```

Jika `/not-found` menghasilkan 404 juga, container bisa masuk error handling ulang atau fallback.

Pattern aman:

- pastikan error location valid;
- hindari error page yang bergantung ke resource opsional;
- buat error servlet sederhana;
- jangan forward error ke path yang bisa kena rule routing kompleks;
- tes semua mapped error code.

Checklist:

```text
/error exists? yes
/error can render without DB? yes
/error can render without session? yes
/error can handle missing attributes? yes
/error does not throw? yes
/error does not call sendError again blindly? yes
```

---

## 19. Production Bug: Async Dispatch Lost Context

Di request awal:

```java
MDC.put("correlationId", cid);
AsyncContext async = request.startAsync();
executor.submit(() -> {
    log.info("generating report"); // correlationId hilang
    async.dispatch("/done");
});
```

ThreadLocal/MDC tidak otomatis pindah ke thread executor.

Solusi konseptual:

```java
String cid = MDC.get("correlationId");
executor.submit(() -> {
    MDC.put("correlationId", cid);
    try {
        async.dispatch("/done");
    } finally {
        MDC.remove("correlationId");
    }
});
```

Namun jangan hanya copy-paste. Di aplikasi besar, buat wrapper executor/context propagation yang eksplisit.

Async dispatch membuat lifecycle request lebih panjang daripada stack call awal. Semua context yang berbasis thread harus dipikirkan ulang.

---

## 20. Debugging Dispatch

Untuk memahami request dispatch, buat diagnostic filter sementara:

```java
@WebFilter(
    urlPatterns = "/*",
    dispatcherTypes = {
        DispatcherType.REQUEST,
        DispatcherType.FORWARD,
        DispatcherType.INCLUDE,
        DispatcherType.ERROR,
        DispatcherType.ASYNC
    },
    asyncSupported = true
)
public class DispatchTraceFilter implements Filter {

    @Override
    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
            throws IOException, ServletException {

        HttpServletRequest request = (HttpServletRequest) req;

        System.out.printf(
                "dispatch=%s method=%s uri=%s servletPath=%s pathInfo=%s forwardUri=%s errorUri=%s%n",
                request.getDispatcherType(),
                request.getMethod(),
                request.getRequestURI(),
                request.getServletPath(),
                request.getPathInfo(),
                request.getAttribute(RequestDispatcher.FORWARD_REQUEST_URI),
                request.getAttribute(RequestDispatcher.ERROR_REQUEST_URI)
        );

        chain.doFilter(req, res);
    }
}
```

Output contoh:

```text
dispatch=REQUEST method=GET uri=/app/orders/123 servletPath=/orders pathInfo=/123 forwardUri=null errorUri=null
dispatch=FORWARD method=GET uri=/app/WEB-INF/views/order.jsp servletPath=/WEB-INF/views/order.jsp pathInfo=null forwardUri=/app/orders/123 errorUri=null
```

Untuk error:

```text
dispatch=REQUEST method=GET uri=/app/orders/999 servletPath=/orders pathInfo=/999 forwardUri=null errorUri=null
dispatch=ERROR method=GET uri=/app/error servletPath=/error pathInfo=null forwardUri=null errorUri=/app/orders/999
```

Kegunaan:

- melihat apakah filter kena dispatch yang diharapkan;
- melihat target forward sebenarnya;
- melihat error URI asli;
- menemukan dispatch loop;
- membedakan 404 container vs 404 application;
- melihat async continuation.

---

## 21. Framework Internals: Kenapa Ini Tetap Penting Walaupun Pakai Spring/JAX-RS

Banyak framework berdiri di atas Servlet API.

Contoh mental model Spring MVC:

```text
REQUEST /orders/123
  -> Servlet container mapping
  -> Filter chain
  -> DispatcherServlet
  -> HandlerMapping
  -> Controller
  -> ViewResolver
  -> forward/render view or write body
```

JAX-RS runtime juga biasanya dipasang sebagai servlet/filter di container:

```text
REQUEST /api/orders/123
  -> container mapping to JAX-RS servlet
  -> JAX-RS resource matching
  -> resource method
  -> response writer
```

Walaupun kamu jarang memanggil `RequestDispatcher` langsung, framework tetap hidup dalam boundary:

- dispatcher type;
- request attributes;
- response committed;
- error dispatch;
- async dispatch;
- filter chain;
- servlet mapping.

Bug seperti ini tetap muncul:

- Spring Security filter tidak apply ke error dispatch;
- custom filter membaca body lalu controller tidak bisa membaca body;
- framework exception handler tidak jalan karena error sudah terjadi di filter sebelum masuk framework;
- servlet container error page mengambil alih error dari framework;
- async request timeout terjadi di container, bukan di controller;
- reverse proxy melihat 200 karena response sudah commit sebelum exception.

Top-tier engineer tidak berhenti di “controller saya benar”. Ia menelusuri boundary dari proxy sampai container dispatch.

---

## 22. Dispatch dan Observability

Satu client request bisa menghasilkan beberapa internal dispatch. Karena itu observability harus punya dua level:

```text
Client Request Level:
  - method
  - public URI
  - final status
  - total duration
  - correlation ID
  - user/principal if safe
  - bytes in/out

Internal Dispatch Level:
  - dispatcher type
  - target URI/resource
  - duration per dispatch
  - forward/error/include/async attributes
  - exception if any
```

Jangan campur keduanya.

### 22.1 Access log

Access log idealnya mencatat satu entry per client request.

```text
cid=abc method=GET uri=/orders/123 status=200 durationMs=42
```

### 22.2 Dispatch trace

Dispatch trace boleh mencatat beberapa entry.

```text
cid=abc dispatch=REQUEST target=/orders/123 durationMs=10
cid=abc dispatch=FORWARD target=/WEB-INF/views/order.jsp durationMs=32
```

### 22.3 Error observability

Error dispatch harus menyimpan original request URI:

```java
String errorUri = (String) request.getAttribute(RequestDispatcher.ERROR_REQUEST_URI);
Integer status = (Integer) request.getAttribute(RequestDispatcher.ERROR_STATUS_CODE);
Throwable error = (Throwable) request.getAttribute(RequestDispatcher.ERROR_EXCEPTION);
```

Jangan hanya log `/error`, karena itu target error handler, bukan URL yang gagal.

---

## 23. Dispatch dan Performance

Dispatch internal bukan gratis, tetapi biasanya bukan bottleneck utama. Biaya utamanya:

- filter chain tambahan;
- JSP/rendering cost;
- object/attribute handling;
- potential buffering;
- nested include;
- error dispatch after expensive failure;
- async context overhead.

Yang lebih berbahaya dari biaya CPU adalah kompleksitas control flow.

Contoh include berlebihan:

```text
page.jsp
  include header.jsp
    include user-menu.jsp
      include notification-count.jsp
        query DB
  include sidebar.jsp
    query DB
  include footer.jsp
```

Masalahnya bukan `include()` saja. Masalahnya hidden dependency:

- fragment melakukan query sendiri;
- rendering memicu banyak backend call;
- observability tidak menunjukkan fragment cost;
- cache tidak jelas;
- error fragment mempengaruhi whole page.

Prinsip:

```text
Dispatch internal harus membuat control flow lebih jelas, bukan menyembunyikan dependency mahal.
```

---

## 24. Dispatch dan API Design

Untuk API JSON modern, forward/include lebih jarang dipakai dibanding server-rendered HTML. Namun error dispatch tetap penting.

Dalam API:

- `forward` kadang dipakai untuk internal fallback;
- `include` hampir tidak dipakai;
- `ERROR` sangat penting untuk consistent error response;
- `ASYNC` penting untuk long-running/non-blocking endpoint;
- filter dispatcher type penting untuk observability dan auth boundary.

Contoh API error servlet:

```java
@WebServlet("/api-error")
public class ApiErrorServlet extends HttpServlet {
    protected void service(HttpServletRequest request, HttpServletResponse response)
            throws IOException {
        Integer code = (Integer) request.getAttribute(RequestDispatcher.ERROR_STATUS_CODE);
        if (code == null) code = 500;

        response.setStatus(code);
        response.setContentType("application/problem+json;charset=UTF-8");
        response.getWriter().write("{\"status\":" + code + ",\"title\":\"Request failed\"}");
    }
}
```

Namun untuk API yang memakai framework, biasanya gunakan framework exception mapper. Tetap pahami container error dispatch karena error yang terjadi sebelum framework bisa jatuh ke layer ini.

---

## 25. Dispatch dan Reverse Proxy

Reverse proxy tidak tahu internal dispatch.

Dari perspektif proxy:

```text
GET /orders/123 -> upstream -> 200
```

Proxy tidak tahu bahwa upstream melakukan:

```text
REQUEST /orders/123
FORWARD /WEB-INF/views/order.jsp
INCLUDE /WEB-INF/fragments/header.jsp
```

Ini berarti:

- proxy access log hanya melihat public URI;
- app internal log harus menambahkan dispatch trace jika perlu;
- redirect adalah satu-satunya yang terlihat ke client/proxy sebagai request baru;
- forward tidak mengubah URL di client;
- error dispatch tidak mengubah URL di client, tetapi status final berubah.

Timeout implication:

```text
client/proxy timeout menghitung total request duration,
bukan hanya durasi servlet awal.
```

Kalau servlet start async lalu dispatch 55 detik kemudian, proxy dengan idle timeout 30 detik mungkin sudah menutup koneksi.

---

## 26. Design Guidelines

### 26.1 Gunakan forward untuk server-side view final

Cocok:

```text
Controller prepares model -> forward to /WEB-INF/views/*.jsp
```

Tidak cocok:

```text
Forward antar operation mutating yang punya authorization berbeda
```

### 26.2 Gunakan include untuk fragment yang benar-benar presentational

Cocok:

```text
header/footer/menu static-ish fragment
```

Hati-hati:

```text
fragment melakukan DB call, authorization, external service call
```

### 26.3 Gunakan error dispatch sebagai fallback, bukan business exception framework utama

Untuk Servlet murni, error dispatch normal. Untuk framework modern, gunakan exception mapper/controller advice, tetapi tetap siapkan container fallback error page.

### 26.4 Gunakan async dispatch dengan lifecycle yang eksplisit

Setiap async request harus jelas berakhir dengan:

```text
dispatch() -> target completes response
complete() -> async task completes response
timeout -> listener/error handling
```

### 26.5 Selalu desain filter berdasarkan dispatcher type

Saat membuat filter, selalu jawab:

```text
Apakah filter ini berlaku untuk REQUEST?
Apakah harus berlaku untuk FORWARD?
Apakah harus berlaku untuk INCLUDE?
Apakah harus berlaku untuk ERROR?
Apakah harus berlaku untuk ASYNC?
Apakah aman jika terpanggil lebih dari sekali dalam satu client request?
```

Kalau tidak bisa menjawab, filter tersebut belum matang.

---

## 27. Anti-Patterns

### 27.1 Forward Setelah Menulis Response

```java
response.getWriter().println("hello");
request.getRequestDispatcher("/view.jsp").forward(request, response);
```

Masalah: response mungkin sudah committed.

### 27.2 Include untuk Business Logic

```java
request.getRequestDispatcher("/calculate-discount")
       .include(request, response);
```

Masalah: include adalah composition response, bukan service call internal.

Gunakan Java service method biasa.

### 27.3 Error Handler Memanggil Dependency Berat

```java
Order order = orderService.load(...); // di /error
```

Masalah: dependency yang sama mungkin penyebab error awal.

### 27.4 Filter Tidak Dispatcher-Aware

```java
@WebFilter("/*")
public class MetricsFilter implements Filter { ... }
```

Tanpa memikirkan dispatcher type, metric bisa salah atau async error tidak terukur.

### 27.5 Request Attribute sebagai Global State

```java
request.setAttribute("currentUser", mutableUserObject);
```

Lalu banyak resource mengubah object tersebut. Ini membuat control flow rapuh.

### 27.6 Forward sebagai Access Control

```java
if (admin) forward("/admin/page.jsp");
```

Forward ke view boleh, tetapi access control harus tetap eksplisit dan tidak bergantung hanya pada “user tidak tahu URL internal”.

---

## 28. Practical Checklist untuk Code Review

Saat review kode yang memakai dispatch, cek:

```text
[ ] Apakah path dispatcher absolute context-relative dan jelas?
[ ] Apakah forward terjadi sebelum response ditulis/commit?
[ ] Apakah method return setelah forward/redirect/sendError?
[ ] Apakah include target hanya menulis fragment body?
[ ] Apakah request attributes punya nama jelas dan tidak collision?
[ ] Apakah error handler defensif dan tidak expose stack trace?
[ ] Apakah filter dispatcherTypes sengaja dipilih?
[ ] Apakah logging membedakan client request vs internal dispatch?
[ ] Apakah async request punya complete/dispatch/timeout path?
[ ] Apakah security tidak bisa dilewati via internal forward?
[ ] Apakah error page tidak bisa loop?
[ ] Apakah response committed path dipahami?
[ ] Apakah proxy timeout lebih besar dari total lifecycle request?
```

---

## 29. Latihan Mental Model

### Kasus 1

```java
response.getWriter().println("loading");
request.getRequestDispatcher("/WEB-INF/views/home.jsp")
       .forward(request, response);
```

Pertanyaan:

- Apakah selalu gagal?
- Kenapa bisa intermittent?
- Apa invariant yang dilanggar?

Jawaban:

Tidak selalu gagal jika response belum committed. Tetapi ini desain buruk karena output bisa mengisi buffer dan commit tergantung ukuran buffer/flush/filter/container. Invariant yang dilanggar: forward harus diputuskan sebelum response body final mulai ditulis.

### Kasus 2

Security filter:

```java
@WebFilter(urlPatterns = "/admin/*", dispatcherTypes = DispatcherType.REQUEST)
```

Servlet publik:

```java
request.getRequestDispatcher("/admin/delete-user")
       .forward(request, response);
```

Pertanyaan:

- Apakah security filter pasti jalan?
- Apa risikonya?

Jawaban:

Tidak pasti, karena filter hanya untuk `REQUEST`, bukan `FORWARD`. Risiko: endpoint sensitif bisa dicapai melalui internal dispatch tanpa filter tersebut. Solusi harus melibatkan desain authorization yang eksplisit, bukan sekadar URL assumption.

### Kasus 3

Logging filter untuk `REQUEST` dan `ERROR` menghasilkan dua log untuk satu request gagal.

Pertanyaan:

- Apakah bug?
- Bagaimana menanganinya?

Jawaban:

Bukan selalu bug. Itu bisa benar sebagai dispatch trace. Tetapi jika dihitung sebagai dua HTTP request, metric salah. Pisahkan access log per client request dari dispatch log internal.

### Kasus 4

Async servlet memanggil `startAsync()` lalu background task gagal sebelum `complete()`.

Pertanyaan:

- Apa yang terjadi?
- Apa desain yang benar?

Jawaban:

Request bisa menggantung sampai timeout, atau container menjalankan timeout handling. Desain yang benar: semua path async harus berakhir dengan `dispatch()`, `complete()`, atau timeout listener yang terkendali.

---

## 30. Ringkasan

Request dispatch adalah mekanisme internal Servlet container untuk memindahkan, menyisipkan, meneruskan, atau memulihkan request tanpa membuat client request baru.

Inti mental model:

```text
REQUEST = entry dari client
FORWARD = transfer ownership response ke resource internal
INCLUDE = composition body fragment
ERROR   = failure rendering oleh container
ASYNC   = continuation setelah async boundary
```

Hal terpenting:

1. `forward()` berbeda dari redirect; forward server-side, redirect client-side.
2. `forward()` harus dilakukan sebelum response committed.
3. Setelah forward, caller sebaiknya `return`.
4. `include()` hanya menyisipkan output, bukan memberi ownership response ke target.
5. `DispatcherType` menentukan fase internal request.
6. Filter harus didesain sadar dispatcher type.
7. Error dispatch membawa atribut error yang harus dipakai untuk observability dan response aman.
8. Async dispatch memperpanjang lifecycle request setelah thread awal dilepas.
9. Satu client request bisa menghasilkan beberapa internal dispatch.
10. Observability harus membedakan request publik dan dispatch internal.

Top-tier Servlet engineer tidak hanya bertanya:

```text
Controller mana yang menerima URL ini?
```

Tetapi juga:

```text
Apa dispatcher type saat ini?
Apakah response sudah committed?
Filter apa yang berlaku pada fase ini?
Apakah ini public request, forward, include, error, atau async continuation?
Apa original URI-nya?
Apakah request ini sudah pernah melalui dispatch lain?
Apa final ownership response-nya?
```

---

## 31. Referensi

- Jakarta Servlet 6.1 Specification — Request dispatching, filters, async processing, error handling, and dispatcher semantics.
- Jakarta Servlet 6.1 API — `jakarta.servlet.RequestDispatcher`.
- Jakarta Servlet 6.1 API — `jakarta.servlet.DispatcherType`.
- Jakarta Servlet 6.1 API — `jakarta.servlet.ServletRequest` and `jakarta.servlet.http.HttpServletRequest`.
- Apache Tomcat Servlet 6.1 API documentation for implementation-facing API reference.

