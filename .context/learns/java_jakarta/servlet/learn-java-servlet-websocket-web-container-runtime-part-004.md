# learn-java-servlet-websocket-web-container-runtime-part-004

# Part 004 — Servlet Lifecycle Deep Dive

> Seri: `learn-java-servlet-websocket-web-container-runtime`  
> Bagian: `004 / 031`  
> Topik: Servlet lifecycle, `Servlet`, `GenericServlet`, `HttpServlet`, thread-safety, initialization, destruction, and lifecycle failure modelling  
> Rentang versi: Java 8 sampai Java 25, Java EE `javax.servlet.*` sampai Jakarta EE `jakarta.servlet.*`

---

## 0. Tujuan Part Ini

Di part sebelumnya kita melihat servlet container sebagai runtime: ada connector, context, mapping, thread pool, classloader, deployment lifecycle, dan boundary antara network dengan aplikasi.

Part ini turun satu level lagi: **apa sebenarnya lifecycle sebuah Servlet object?**

Banyak developer modern memakai Spring MVC, JAX-RS, JSF, Struts, Wicket, Vaadin, atau framework lain tanpa pernah menulis `HttpServlet` langsung. Tetapi hampir semua model tersebut tetap berdiri di atas kontrak Servlet.

Part ini bertujuan membuat kamu paham bahwa servlet bukan sekadar class dengan method `doGet()` atau `doPost()`. Servlet adalah **managed component** yang:

1. dibuat oleh container,
2. diinisialisasi oleh container,
3. dipakai berkali-kali oleh banyak request,
4. dipanggil secara concurrent,
5. dihentikan oleh container,
6. dapat menyebabkan memory leak, race condition, stale state, dan production incident kalau lifecycle-nya salah dipahami.

Setelah part ini, kamu harus bisa menjawab pertanyaan seperti:

- Kapan servlet object dibuat?
- Apakah satu request punya satu servlet instance?
- Apakah `init()` dipanggil per request?
- Apakah field instance di servlet aman?
- Apa beda `Servlet`, `GenericServlet`, dan `HttpServlet`?
- Siapa yang memanggil `service()`?
- Kenapa biasanya kita override `doGet()`/`doPost()`, bukan `service()`?
- Apa konsekuensi `load-on-startup`?
- Apa yang terjadi kalau `init()` gagal?
- Apa yang terjadi kalau `destroy()` gagal membersihkan resource?
- Kenapa static field di web app berbahaya saat redeploy?
- Bagaimana lifecycle servlet berubah ketika ada async request?

---

## 1. Mental Model Utama

Servlet lifecycle bisa diringkas seperti ini:

```text
Container starts / web app deployed
        |
        v
Container discovers servlet definitions
        |
        v
Servlet class is loaded
        |
        v
Servlet instance is constructed
        |
        v
init(ServletConfig) is called once
        |
        v
Servlet becomes available for requests
        |
        v
Many concurrent requests call service(req, res)
        |
        v
service dispatches to HTTP method handlers
        |
        v
Application is stopped / redeployed / servlet removed
        |
        v
destroy() is called once
        |
        v
Servlet instance becomes eligible for GC
```

Tetapi ringkasan ini bisa menipu jika dibaca terlalu sederhana.

Ada beberapa invariant penting:

1. **Servlet dikelola oleh container, bukan oleh aplikasi.**
   Kamu tidak membuat servlet dengan `new MyServlet()` untuk request production. Container yang membuat, mengonfigurasi, dan memanggilnya.

2. **Default-nya, satu servlet instance dapat melayani banyak request.**
   Jadi instance field bukan tempat yang aman untuk menyimpan data request.

3. **`init()` bukan constructor pengganti, tapi lifecycle hook setelah container menyediakan `ServletConfig`.**
   Constructor belum punya akses aman ke konfigurasi container.

4. **`service()` adalah entry point request-level.**
   Untuk `HttpServlet`, `service()` akan mendispatch ke `doGet`, `doPost`, `doPut`, dan seterusnya.

5. **`destroy()` bukan shutdown hook universal.**
   Ia dipanggil ketika container mengeluarkan servlet dari service, tetapi kamu tetap harus mendesain cleanup yang deterministic, idempotent, dan cepat.

6. **Request dan response object bukan milik servlet untuk disimpan jangka panjang.**
   Mereka valid untuk lifecycle request tertentu, dan async punya aturan tersendiri.

Mental model yang benar:

```text
Servlet instance = long-lived container-managed component
Request object   = short-lived per-request object
Response object  = short-lived per-request output boundary
Thread           = execution carrier, may vary by container/runtime
Session          = per-client logical state, not servlet state
Context          = per-web-application shared state
```

---

## 2. Kontrak Dasar: `Servlet` Interface

Di Jakarta Servlet modern, kontrak paling dasar adalah:

```java
package jakarta.servlet;

public interface Servlet {
    void init(ServletConfig config) throws ServletException;

    ServletConfig getServletConfig();

    void service(ServletRequest req, ServletResponse res)
            throws ServletException, IOException;

    String getServletInfo();

    void destroy();
}
```

Pada Java EE legacy, package-nya adalah:

```java
javax.servlet.Servlet
```

Pada Jakarta EE modern:

```java
jakarta.servlet.Servlet
```

Secara konsep lifecycle-nya sama, tetapi package-nya berbeda. Perubahan `javax.*` ke `jakarta.*` sudah dibahas di Part 001.

### 2.1 Method `init(ServletConfig config)`

`init()` dipanggil oleh container setelah servlet instance dibuat.

Tujuannya:

- membaca initialization parameter,
- mengambil referensi `ServletContext`,
- mempersiapkan resource ringan,
- memvalidasi konfigurasi,
- gagal cepat bila konfigurasi invalid.

Contoh:

```java
import jakarta.servlet.ServletConfig;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServlet;

public class ReportServlet extends HttpServlet {

    private int maxPageSize;

    @Override
    public void init(ServletConfig config) throws ServletException {
        super.init(config);

        String raw = config.getInitParameter("maxPageSize");
        if (raw == null || raw.isBlank()) {
            throw new ServletException("Missing init-param: maxPageSize");
        }

        try {
            this.maxPageSize = Integer.parseInt(raw);
        } catch (NumberFormatException e) {
            throw new ServletException("Invalid maxPageSize: " + raw, e);
        }
    }
}
```

Hal penting:

```text
Constructor -> object belum punya ServletConfig
init()      -> object sudah diberi ServletConfig oleh container
```

Maka constructor sebaiknya tidak dipakai untuk membaca konfigurasi container.

### 2.2 Method `getServletConfig()`

`ServletConfig` adalah object konfigurasi per servlet.

Ia memberi akses ke:

- nama servlet,
- init parameters,
- `ServletContext`.

Contoh:

```java
String servletName = getServletConfig().getServletName();
String mode = getServletConfig().getInitParameter("mode");
ServletContext context = getServletConfig().getServletContext();
```

`ServletConfig` berbeda dari `ServletContext`:

| Object | Scope | Isi |
|---|---:|---|
| `ServletConfig` | per servlet | init-param servlet tertentu |
| `ServletContext` | per web application | context-param, resource, app-wide attributes |

### 2.3 Method `service(ServletRequest req, ServletResponse res)`

`service()` adalah method yang dipanggil container untuk setiap request yang cocok dengan mapping servlet.

Pada level `Servlet`, request dan response masih generic:

```java
ServletRequest
ServletResponse
```

Pada HTTP servlet, request/response akan berupa:

```java
HttpServletRequest
HttpServletResponse
```

Tetapi kontrak `Servlet` tidak terbatas hanya HTTP. Itulah mengapa ada `GenericServlet` dan `HttpServlet`.

### 2.4 Method `getServletInfo()`

Method ini biasanya mengembalikan informasi tentang servlet, misalnya nama, versi, atau deskripsi.

Dalam praktik modern, method ini jarang menjadi pusat desain, tetapi tetap bagian dari kontrak.

```java
@Override
public String getServletInfo() {
    return "ReportServlet v1.0";
}
```

### 2.5 Method `destroy()`

`destroy()` dipanggil saat servlet akan dikeluarkan dari service.

Biasanya terjadi ketika:

- application stop,
- redeploy,
- undeploy,
- container shutdown,
- servlet instance diganti oleh container.

Tugasnya:

- menghentikan resource yang dimiliki servlet,
- menghentikan scheduler/executor yang dibuat servlet,
- menutup file handle,
- menutup client connection yang dibuat manual,
- flush buffer internal,
- unregister listener/registry yang didaftarkan manual.

Contoh:

```java
public class UnsafeBackgroundServlet extends HttpServlet {

    private ScheduledExecutorService scheduler;

    @Override
    public void init() {
        this.scheduler = Executors.newSingleThreadScheduledExecutor();
        this.scheduler.scheduleAtFixedRate(
                () -> System.out.println("heartbeat"),
                0,
                30,
                TimeUnit.SECONDS
        );
    }

    @Override
    public void destroy() {
        if (scheduler != null) {
            scheduler.shutdownNow();
        }
    }
}
```

Tetapi perhatikan: membuat executor sendiri di servlet sering bukan desain ideal. Di Jakarta EE server, gunakan managed executor bila tersedia. Di Spring Boot, gunakan lifecycle bean. Di container bare Servlet, cleanup manual harus benar.

---

## 3. `GenericServlet`: Base Class Protocol-Neutral

`GenericServlet` adalah abstract class yang memudahkan implementasi `Servlet`.

Ia:

- mengimplementasikan `Servlet`,
- mengimplementasikan `ServletConfig`,
- menyimpan `ServletConfig`,
- menyediakan default implementation untuk beberapa method,
- tetap meninggalkan `service()` sebagai abstract method.

Secara konseptual:

```java
public abstract class GenericServlet implements Servlet, ServletConfig, Serializable {

    private transient ServletConfig config;

    @Override
    public void init(ServletConfig config) throws ServletException {
        this.config = config;
        this.init();
    }

    public void init() throws ServletException {
        // default no-op
    }

    @Override
    public ServletConfig getServletConfig() {
        return config;
    }

    public ServletContext getServletContext() {
        return getServletConfig().getServletContext();
    }

    public String getInitParameter(String name) {
        return getServletConfig().getInitParameter(name);
    }

    @Override
    public void destroy() {
        // default no-op
    }

    @Override
    public abstract void service(ServletRequest req, ServletResponse res)
            throws ServletException, IOException;
}
```

Karena `GenericServlet` menyediakan overload `init()` tanpa parameter, maka developer sering override:

```java
@Override
public void init() throws ServletException {
    // config sudah tersedia melalui getServletConfig()
}
```

Bukan:

```java
@Override
public void init(ServletConfig config) throws ServletException {
    // kalau override ini dan lupa super.init(config), config tidak tersimpan
}
```

### 3.1 Pitfall: Override `init(ServletConfig)` Tanpa `super.init(config)`

Salah:

```java
@Override
public void init(ServletConfig config) throws ServletException {
    // BUG: lupa super.init(config)
    String value = getInitParameter("x"); // bisa gagal karena config belum disimpan GenericServlet
}
```

Benar:

```java
@Override
public void init(ServletConfig config) throws ServletException {
    super.init(config);
    String value = getInitParameter("x");
}
```

Atau lebih aman:

```java
@Override
public void init() throws ServletException {
    String value = getInitParameter("x");
}
```

Mental model:

```text
Kalau extend GenericServlet/HttpServlet:
- override init() untuk kebanyakan kasus
- override init(ServletConfig) hanya jika perlu, dan wajib panggil super.init(config)
```

---

## 4. `HttpServlet`: Base Class HTTP-Specific

`HttpServlet` adalah subclass dari `GenericServlet` yang memahami HTTP.

Alih-alih kamu mengimplementasikan `service(ServletRequest, ServletResponse)` dari nol, `HttpServlet` menyediakan dispatch berdasarkan HTTP method.

Secara konseptual:

```text
Container
  -> HttpServlet.service(ServletRequest, ServletResponse)
       -> cast ke HttpServletRequest/HttpServletResponse
       -> HttpServlet.service(HttpServletRequest, HttpServletResponse)
            -> cek method HTTP
            -> doGet / doPost / doPut / doDelete / doOptions / doHead / doTrace
```

Contoh servlet sederhana:

```java
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServlet;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import java.io.IOException;

public class HealthServlet extends HttpServlet {

    @Override
    protected void doGet(HttpServletRequest request, HttpServletResponse response)
            throws ServletException, IOException {

        response.setStatus(HttpServletResponse.SC_OK);
        response.setContentType("text/plain;charset=UTF-8");
        response.getWriter().write("OK");
    }
}
```

### 4.1 Kenapa Biasanya Override `doGet()`/`doPost()`, Bukan `service()`?

Karena `HttpServlet` sudah menangani dispatch method HTTP.

Kalau override `service()` sembarangan, kamu bisa merusak behavior default:

- `HEAD` handling,
- `OPTIONS` handling,
- `TRACE` handling,
- `405 Method Not Allowed`,
- conditional behavior framework/container tertentu.

Sebaiknya:

```java
@Override
protected void doGet(HttpServletRequest req, HttpServletResponse resp) { ... }

@Override
protected void doPost(HttpServletRequest req, HttpServletResponse resp) { ... }
```

Hanya override `service()` jika kamu benar-benar ingin mengendalikan semua method dispatch sendiri.

### 4.2 HTTP Method Handlers

`HttpServlet` menyediakan method seperti:

```java
protected void doGet(HttpServletRequest req, HttpServletResponse resp)
protected void doPost(HttpServletRequest req, HttpServletResponse resp)
protected void doPut(HttpServletRequest req, HttpServletResponse resp)
protected void doDelete(HttpServletRequest req, HttpServletResponse resp)
protected void doOptions(HttpServletRequest req, HttpServletResponse resp)
protected void doTrace(HttpServletRequest req, HttpServletResponse resp)
protected void doHead(HttpServletRequest req, HttpServletResponse resp)
```

Default behavior untuk method yang tidak di-support biasanya mengembalikan error method not allowed.

Contoh:

```java
public class ReadOnlyServlet extends HttpServlet {

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp)
            throws IOException {
        resp.setContentType("application/json;charset=UTF-8");
        resp.getWriter().write("{\"status\":\"readable\"}");
    }
}
```

Jika client mengirim `POST`, servlet ini tidak punya `doPost()`, maka default `HttpServlet` akan menangani sebagai method tidak didukung.

### 4.3 `doHead()` dan `doGet()`

HTTP `HEAD` mirip `GET` tetapi tidak mengirim body.

Dalam banyak implementation, `HttpServlet` dapat menggunakan behavior `doGet()` untuk menghitung metadata response tanpa mengirim body. Tetapi untuk endpoint yang streaming, mahal, atau punya efek samping tersembunyi, kamu perlu hati-hati.

Prinsip:

```text
GET harus safe.
HEAD harus semantik metadata dari GET.
Jangan desain GET yang melakukan mutasi.
```

---

## 5. Servlet Construction: Siapa yang Membuat Servlet?

Servlet dibuat oleh container.

Kamu mendefinisikan servlet melalui:

1. `web.xml`,
2. annotation seperti `@WebServlet`,
3. programmatic registration,
4. framework registration, misalnya Spring Boot mendaftarkan `DispatcherServlet`,
5. container-specific deployment descriptor.

Contoh annotation:

```java
import jakarta.servlet.annotation.WebServlet;
import jakarta.servlet.http.HttpServlet;

@WebServlet(
    name = "HealthServlet",
    urlPatterns = "/health",
    loadOnStartup = 1
)
public class HealthServlet extends HttpServlet {
    // ...
}
```

Contoh `web.xml`:

```xml
<web-app xmlns="https://jakarta.ee/xml/ns/jakartaee"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="https://jakarta.ee/xml/ns/jakartaee
                             https://jakarta.ee/xml/ns/jakartaee/web-app_6_1.xsd"
         version="6.1">

    <servlet>
        <servlet-name>HealthServlet</servlet-name>
        <servlet-class>com.example.HealthServlet</servlet-class>
        <load-on-startup>1</load-on-startup>
    </servlet>

    <servlet-mapping>
        <servlet-name>HealthServlet</servlet-name>
        <url-pattern>/health</url-pattern>
    </servlet-mapping>
</web-app>
```

### 5.1 Constructor Rules

Servlet class harus punya public no-arg constructor, atau setidaknya constructor yang bisa dipakai container sesuai aturan JavaBean-like instantiation.

Jangan lakukan ini:

```java
public class BadServlet extends HttpServlet {

    private final ReportService reportService;

    public BadServlet(ReportService reportService) {
        this.reportService = reportService;
    }
}
```

Container biasa tidak tahu cara memenuhi constructor parameter tersebut.

Pada framework seperti Spring, servlet atau filter tertentu bisa didaftarkan sebagai bean/wrapper, tetapi itu bukan kontrak dasar Servlet container murni.

Untuk servlet murni:

```java
public class GoodServlet extends HttpServlet {

    private ReportService reportService;

    public GoodServlet() {
        // container can instantiate
    }

    @Override
    public void init() throws ServletException {
        this.reportService = new ReportService();
    }
}
```

Namun untuk aplikasi modern, business dependency biasanya dikelola framework/DI container, bukan dibuat manual di servlet.

---

## 6. Kapan Servlet Di-load?

Ada dua mode utama:

1. **Lazy initialization**
2. **Load on startup**

### 6.1 Lazy Initialization

Jika tidak ada `load-on-startup`, servlet bisa dibuat ketika request pertama datang.

Flow:

```text
Application deployed
        |
        v
Servlet definition known, but instance may not exist
        |
        v
First request /report arrives
        |
        v
Container loads class
        |
        v
Container constructs servlet
        |
        v
Container calls init()
        |
        v
Container calls service()
```

Keuntungan:

- startup lebih cepat,
- servlet yang jarang dipakai tidak langsung memakai resource.

Kerugian:

- request pertama bisa lambat,
- error konfigurasi baru muncul saat request pertama,
- readiness check bisa hijau padahal servlet tertentu belum valid.

### 6.2 Load on Startup

`load-on-startup` memaksa container memuat servlet saat web app startup.

Annotation:

```java
@WebServlet(
    urlPatterns = "/report/*",
    loadOnStartup = 1
)
public class ReportServlet extends HttpServlet {
}
```

`web.xml`:

```xml
<load-on-startup>1</load-on-startup>
```

Angka lebih kecil biasanya dimuat lebih awal.

Keuntungan:

- fail fast saat startup,
- cold-start request pertama berkurang,
- dependency/config validation lebih awal,
- cocok untuk servlet penting seperti front controller.

Kerugian:

- startup lebih lama,
- semua resource dipakai lebih awal,
- init berat bisa membuat deployment timeout.

### 6.3 Kapan Memakai `load-on-startup`?

Gunakan untuk:

- front controller utama,
- servlet health/readiness penting,
- servlet yang harus valid sebelum app menerima traffic,
- servlet dengan config critical.

Hindari untuk:

- servlet jarang dipakai,
- servlet yang init-nya melakukan network call lambat,
- servlet yang memulai background job tidak perlu,
- servlet yang membuat banyak resource mahal.

Top-tier heuristic:

```text
Use load-on-startup for correctness-critical servlet readiness.
Do not use it as a place to hide slow boot logic.
```

---

## 7. `init()` Deep Dive

`init()` sering dianggap sederhana, tetapi banyak bug production lahir dari sini.

### 7.1 Apa yang Cocok Dilakukan di `init()`?

Cocok:

- validasi init parameters,
- precompute immutable configuration,
- membuat object stateless ringan,
- mengambil reference ke context,
- mempersiapkan cache kecil immutable,
- register resource yang punya cleanup jelas,
- fail fast jika konfigurasi invalid.

Contoh baik:

```java
public class ExportServlet extends HttpServlet {

    private int maxRows;
    private Set<String> allowedFormats;

    @Override
    public void init() throws ServletException {
        this.maxRows = parseRequiredInt("maxRows");
        this.allowedFormats = Set.of("csv", "json", "xlsx");
    }

    private int parseRequiredInt(String name) throws ServletException {
        String value = getInitParameter(name);
        if (value == null) {
            throw new ServletException("Missing init parameter: " + name);
        }
        try {
            return Integer.parseInt(value);
        } catch (NumberFormatException e) {
            throw new ServletException("Invalid integer for " + name + ": " + value, e);
        }
    }
}
```

### 7.2 Apa yang Tidak Cocok Dilakukan di `init()`?

Berisiko:

- memanggil external dependency lambat tanpa timeout,
- membuka koneksi DB manual permanen,
- membuat thread tanpa cleanup,
- menjalankan migration/schema update,
- membaca file besar ke memory,
- blocking indefinitely,
- membuat state mutable global tanpa synchronization,
- memulai job scheduler yang tidak terikat lifecycle app.

Contoh buruk:

```java
@Override
public void init() throws ServletException {
    // Bad: no timeout, blocks deployment, unknown lifecycle
    this.remoteConfig = httpClient.get("https://config-service/config");

    // Bad: single Connection shared across requests
    this.connection = DriverManager.getConnection(url, user, pass);

    // Bad: unmanaged thread
    new Thread(() -> runForever()).start();
}
```

### 7.3 Fail Fast vs Lazy Failure

Jika servlet membutuhkan config wajib, lebih baik gagal di `init()` daripada menerima request lalu gagal random.

Buruk:

```java
protected void doGet(HttpServletRequest req, HttpServletResponse resp)
        throws IOException {
    String bucket = getServletConfig().getInitParameter("bucket");
    if (bucket == null) {
        resp.sendError(500, "Bucket not configured");
        return;
    }
}
```

Lebih baik:

```java
private String bucket;

@Override
public void init() throws ServletException {
    this.bucket = getInitParameter("bucket");
    if (bucket == null || bucket.isBlank()) {
        throw new ServletException("Missing required init-param: bucket");
    }
}
```

Mental model:

```text
Invalid deployment configuration is startup failure, not request failure.
```

### 7.4 `init()` dan Visibility ke Request Threads

Jika field diinisialisasi di `init()` sebelum servlet mulai melayani request, container lifecycle memberikan boundary yang membuat field tersebut tersedia untuk request threads.

Namun setelah servlet mulai melayani request, mutasi field harus thread-safe.

Aman:

```java
private Map<String, String> immutableMapping;

@Override
public void init() {
    Map<String, String> map = new HashMap<>();
    map.put("A", "Alpha");
    map.put("B", "Beta");
    this.immutableMapping = Map.copyOf(map);
}
```

Berisiko:

```java
private Map<String, String> mapping = new HashMap<>();

@Override
protected void doPost(HttpServletRequest req, HttpServletResponse resp) {
    mapping.put(req.getParameter("k"), req.getParameter("v")); // race condition
}
```

---

## 8. `service()` Deep Dive

`service()` adalah pusat request execution.

Pada `HttpServlet`, ada dua level:

```java
public void service(ServletRequest req, ServletResponse res)

protected void service(HttpServletRequest req, HttpServletResponse resp)
```

Container memanggil method public dari kontrak Servlet. `HttpServlet` kemudian memastikan object-nya adalah HTTP request/response dan mendispatch berdasarkan method.

### 8.1 Flow Request ke Handler

```text
HTTP request arrives
        |
        v
Container maps request to servlet
        |
        v
Filter chain executes before servlet
        |
        v
HttpServlet.service(ServletRequest, ServletResponse)
        |
        v
HttpServlet.service(HttpServletRequest, HttpServletResponse)
        |
        +-- GET     -> doGet()
        +-- POST    -> doPost()
        +-- PUT     -> doPut()
        +-- DELETE  -> doDelete()
        +-- HEAD    -> doHead()
        +-- OPTIONS -> doOptions()
        +-- TRACE   -> doTrace()
        |
        v
Filter chain unwinds after servlet
        |
        v
Response is committed/flushed
```

### 8.2 Jangan Simpan Request/Response di Field

Salah besar:

```java
public class BrokenServlet extends HttpServlet {

    private HttpServletRequest currentRequest;

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp)
            throws IOException {
        this.currentRequest = req;

        // request lain bisa menimpa currentRequest saat request ini masih berjalan
        String user = currentRequest.getParameter("user");
        resp.getWriter().write(user);
    }
}
```

Kenapa berbahaya?

Karena servlet instance dipakai bersama oleh banyak request.

Dua request paralel:

```text
Thread A handles request from Alice
Thread B handles request from Bob

Thread A: currentRequest = Alice
Thread B: currentRequest = Bob
Thread A: reads currentRequest -> Bob
```

Hasilnya:

- data leak,
- wrong user,
- intermittent bug,
- security incident.

Benar:

```java
@Override
protected void doGet(HttpServletRequest req, HttpServletResponse resp)
        throws IOException {
    String user = req.getParameter("user");
    resp.getWriter().write(user);
}
```

### 8.3 Jangan Simpan Per-Request Data di Instance Field

Salah:

```java
public class InvoiceServlet extends HttpServlet {

    private String invoiceId;

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp)
            throws IOException {
        this.invoiceId = req.getParameter("id");
        render(resp);
    }

    private void render(HttpServletResponse resp) throws IOException {
        resp.getWriter().write("Invoice: " + invoiceId);
    }
}
```

Benar:

```java
@Override
protected void doGet(HttpServletRequest req, HttpServletResponse resp)
        throws IOException {
    String invoiceId = req.getParameter("id");
    render(invoiceId, resp);
}

private void render(String invoiceId, HttpServletResponse resp) throws IOException {
    resp.getWriter().write("Invoice: " + invoiceId);
}
```

Rule:

```text
Per-request data belongs in local variables, request attributes, or request-scoped framework objects.
It does not belong in servlet instance fields.
```

---

## 9. Thread-Safety: Servlet Instance adalah Shared Object

Ini adalah konsep paling penting di part ini.

Servlet bukan dibuat satu per request.

Default mental model:

```text
1 servlet mapping -> usually 1 servlet instance -> many request threads
```

Diagram:

```text
                 +----------------------+
Thread-17 -----> |                      |
Thread-42 -----> |   ReportServlet      |
Thread-58 -----> |   same instance      |
Thread-91 -----> |                      |
                 +----------------------+
```

Artinya semua field instance dibagi oleh semua thread.

### 9.1 Aman: Immutable State

```java
public class SafeServlet extends HttpServlet {

    private Set<String> supportedFormats;

    @Override
    public void init() {
        this.supportedFormats = Set.of("csv", "json");
    }

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp)
            throws IOException {
        String format = req.getParameter("format");
        if (!supportedFormats.contains(format)) {
            resp.sendError(400, "Unsupported format");
            return;
        }
        resp.getWriter().write("format=" + format);
    }
}
```

`Set.of(...)` immutable, tidak dimutasi setelah init.

### 9.2 Aman: Thread-Safe Collaborator

```java
public class MetricsServlet extends HttpServlet {

    private final LongAdder requestCount = new LongAdder();

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp)
            throws IOException {
        requestCount.increment();
        resp.getWriter().write("count=" + requestCount.sum());
    }
}
```

### 9.3 Berisiko: Mutable Non-Thread-Safe Field

```java
public class BadCounterServlet extends HttpServlet {

    private int count = 0;

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp)
            throws IOException {
        count++; // race condition
        resp.getWriter().write("count=" + count);
    }
}
```

Masalah:

- lost update,
- value tidak akurat,
- behavior intermittent.

Lebih baik:

```java
private final AtomicInteger count = new AtomicInteger();

@Override
protected void doGet(HttpServletRequest req, HttpServletResponse resp)
        throws IOException {
    int value = count.incrementAndGet();
    resp.getWriter().write("count=" + value);
}
```

Tetapi untuk metrics production, biasanya gunakan metrics framework, bukan servlet field.

### 9.4 Berisiko: `SimpleDateFormat`

Java 8 legacy sering punya bug ini:

```java
public class DateServlet extends HttpServlet {

    private final SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd");

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp)
            throws IOException {
        resp.getWriter().write(format.format(new Date())); // SimpleDateFormat not thread-safe
    }
}
```

Lebih baik pakai `java.time`:

```java
private static final DateTimeFormatter FORMATTER = DateTimeFormatter.ISO_LOCAL_DATE;

@Override
protected void doGet(HttpServletRequest req, HttpServletResponse resp)
        throws IOException {
    String value = LocalDate.now(ZoneOffset.UTC).format(FORMATTER);
    resp.getWriter().write(value);
}
```

`DateTimeFormatter` immutable dan thread-safe.

### 9.5 Field Classification

| Field Type | Aman? | Catatan |
|---|---:|---|
| Immutable config set in `init()` | Ya | Jangan dimutasi setelah servlet aktif |
| Stateless service object | Ya | Asal object-nya thread-safe |
| `AtomicInteger`, `LongAdder` | Ya | Untuk counter sederhana |
| `HashMap` yang dimutasi request | Tidak | Gunakan `ConcurrentHashMap` atau desain lain |
| `ArrayList` yang dimutasi request | Tidak | Race dan visibility issue |
| `HttpServletRequest` field | Tidak | Data leak antar request |
| `HttpServletResponse` field | Tidak | Response corrupt |
| `Connection` JDBC single shared | Tidak | Gunakan pool, jangan shared connection |
| `SimpleDateFormat` shared | Tidak | Gunakan `DateTimeFormatter` |
| Static mutable state | Sangat berisiko | Apalagi saat redeploy/classloader |

---

## 10. `destroy()` Deep Dive

`destroy()` dipanggil ketika servlet akan dihentikan.

Namun jangan membayangkan `destroy()` selalu seperti graceful shutdown sempurna. Production environment bisa punya:

- process kill,
- container crash,
- pod eviction,
- node failure,
- OOM kill,
- forced redeploy,
- timeout saat shutdown.

Jadi `destroy()` penting, tapi bukan satu-satunya safety net.

### 10.1 Apa yang Cocok Dilakukan di `destroy()`?

Cocok:

- stop scheduler yang dibuat servlet,
- close HTTP client custom jika lifecycle-nya milik servlet,
- flush in-memory queue kecil,
- unregister callback/listener,
- release native/file handle,
- log shutdown signal.

Contoh:

```java
public class ResourceServlet extends HttpServlet {

    private CloseableHttpClient client;

    @Override
    public void init() {
        this.client = HttpClients.createDefault();
    }

    @Override
    public void destroy() {
        if (client != null) {
            try {
                client.close();
            } catch (IOException e) {
                getServletContext().log("Failed to close HTTP client", e);
            }
        }
    }
}
```

### 10.2 `destroy()` Harus Idempotent

Walaupun container normalnya memanggil sekali, cleanup yang baik sebaiknya aman bila terpanggil lebih dari sekali.

```java
private final AtomicBoolean stopped = new AtomicBoolean(false);

@Override
public void destroy() {
    if (!stopped.compareAndSet(false, true)) {
        return;
    }
    // cleanup once
}
```

### 10.3 `destroy()` Harus Cepat

Jangan lakukan operasi panjang tanpa batas:

```java
@Override
public void destroy() {
    remoteService.flushEverything(); // bad if no timeout
}
```

Lebih baik:

```java
@Override
public void destroy() {
    try {
        remoteService.flushWithTimeout(Duration.ofSeconds(5));
    } catch (Exception e) {
        getServletContext().log("Flush failed during destroy", e);
    }
}
```

Prinsip:

```text
Shutdown cleanup must be bounded.
Unbounded shutdown logic becomes deployment risk.
```

### 10.4 Apa yang Tidak Bisa Dijamin `destroy()`?

`destroy()` tidak menjamin:

- semua request selesai secara sempurna,
- semua data in-memory pasti terkirim,
- semua background thread pasti berhenti kalau kamu tidak desain dengan benar,
- akan dipanggil saat process crash/OOM kill,
- akan punya waktu tak terbatas.

Maka data penting jangan hanya disimpan di memory servlet.

---

## 11. Lifecycle Failure Model

Engineer top-tier tidak hanya tahu happy path. Ia harus tahu failure path.

### 11.1 Class Loading Failure

Flow gagal:

```text
Container discovers servlet class
        |
        v
ClassNotFoundException / NoClassDefFoundError
        |
        v
Deployment fails or servlet unavailable
```

Penyebab:

- dependency tidak ada di `WEB-INF/lib`,
- salah scope Maven/Gradle,
- package `javax.*` vs `jakarta.*` mismatch,
- library butuh Java lebih baru,
- duplicate class dari container lib dan app lib.

Gejala:

- 404 untuk servlet tertentu,
- 500 saat first request,
- deployment failed,
- log `ClassNotFoundException`,
- log `NoSuchMethodError`,
- log `LinkageError`.

### 11.2 Constructor Failure

```java
public BadServlet() {
    throw new RuntimeException("boom");
}
```

Penyebab realistis:

- constructor melakukan IO,
- constructor membaca config yang belum tersedia,
- constructor membuat dependency manual yang gagal.

Solusi:

- constructor minimal,
- pindahkan validation ke `init()`,
- fail dengan `ServletException` yang jelas.

### 11.3 `init()` Failure

Jika `init()` melempar `ServletException` atau `UnavailableException`, servlet tidak siap melayani request.

Contoh:

```java
@Override
public void init() throws ServletException {
    if (getInitParameter("endpoint") == null) {
        throw new UnavailableException("Missing endpoint config");
    }
}
```

Pola yang baik:

- error message jelas,
- sebut config yang hilang,
- jangan telan exception,
- jangan biarkan servlet setengah siap.

Buruk:

```java
@Override
public void init() {
    try {
        loadConfig();
    } catch (Exception e) {
        e.printStackTrace(); // servlet tetap hidup tapi rusak
    }
}
```

Lebih baik:

```java
@Override
public void init() throws ServletException {
    try {
        loadConfig();
    } catch (Exception e) {
        throw new ServletException("Failed to initialize ReportServlet", e);
    }
}
```

### 11.4 `service()` Failure

`service()` atau `doXxx()` bisa gagal dengan:

- `ServletException`,
- `IOException`,
- unchecked exception,
- client abort,
- timeout,
- response already committed.

Contoh:

```java
@Override
protected void doGet(HttpServletRequest req, HttpServletResponse resp)
        throws ServletException, IOException {
    try {
        renderReport(req, resp);
    } catch (ReportNotFoundException e) {
        resp.sendError(HttpServletResponse.SC_NOT_FOUND, "Report not found");
    } catch (Exception e) {
        throw new ServletException("Failed to render report", e);
    }
}
```

Jangan selalu convert semua exception menjadi 500 manual jika framework/container error handling sudah menangani. Namun servlet mentah perlu desain error boundary sendiri.

### 11.5 `destroy()` Failure

`destroy()` tidak declare checked exception.

Artinya cleanup error harus ditangani sendiri.

```java
@Override
public void destroy() {
    try {
        closeResource();
    } catch (Exception e) {
        getServletContext().log("Cleanup failed", e);
    }
}
```

Jangan:

```java
@Override
public void destroy() {
    throw new RuntimeException("failed"); // noisy, cleanup incomplete
}
```

---

## 12. Servlet State: Local, Request, Session, Context, Static

Salah satu skill penting adalah memilih scope state yang benar.

### 12.1 Local Variable

Scope: satu method invocation, satu request thread.

```java
protected void doGet(HttpServletRequest req, HttpServletResponse resp)
        throws IOException {
    String id = req.getParameter("id");
    String result = find(id);
    resp.getWriter().write(result);
}
```

Paling aman untuk per-request data.

### 12.2 Request Attribute

Scope: satu request lifecycle, termasuk forward/include/error/async dispatch tergantung flow.

```java
req.setAttribute("validatedUser", user);
req.getRequestDispatcher("/WEB-INF/view.jsp").forward(req, resp);
```

Cocok untuk data yang perlu dibagikan antar servlet/filter/JSP dalam request yang sama.

### 12.3 Session Attribute

Scope: satu logical client session.

```java
HttpSession session = req.getSession();
session.setAttribute("cart", cart);
```

Harus hati-hati:

- bisa diakses parallel oleh beberapa request dari browser yang sama,
- bisa perlu serialization pada clustered session,
- bisa menyebabkan memory bloat,
- harus invalidated saat logout.

### 12.4 ServletContext Attribute

Scope: satu web application.

```java
getServletContext().setAttribute("appVersion", "1.2.3");
```

Berbagi antar servlet/filter/listener dalam satu web app.

Harus thread-safe jika mutable.

### 12.5 Static Field

Scope: classloader-level.

```java
private static final Map<String, Object> CACHE = new HashMap<>();
```

Static field sangat berbahaya di web container karena:

- classloader bisa berubah saat redeploy,
- static mutable state bisa leak,
- thread dari old classloader bisa menahan classloader lama,
- state bisa tidak sesuai lifecycle web app,
- test/redeploy behavior sulit diprediksi.

Prinsip:

```text
Use static final constants for constants.
Avoid static mutable state in web apps.
```

### 12.6 Scope Decision Table

| Data | Scope yang Tepat | Alasan |
|---|---|---|
| Request parameter normalized | local variable/request attribute | hanya berlaku untuk request itu |
| Current authenticated user for rendering | request attribute/security context | tidak boleh instance field |
| Shopping cart | session/database | per user/session |
| App version | ServletContext/init config | app-wide immutable |
| Regex Pattern immutable | static final atau instance final | thread-safe immutable |
| Mutable cache | managed cache/thread-safe component | perlu eviction/concurrency/lifecycle |
| JDBC connection | connection pool | bukan servlet field |
| Per-request DTO | local variable | aman dan jelas |

---

## 13. Servlet Lifecycle vs Framework Lifecycle

Framework modern sering menyembunyikan servlet lifecycle.

Contoh Spring MVC:

```text
Container
  -> DispatcherServlet
      -> HandlerMapping
      -> Controller
      -> Service
      -> Repository
      -> View/ResponseBody
```

`DispatcherServlet` sendiri adalah servlet.

Biasanya hanya ada satu atau beberapa servlet utama:

- Spring MVC: `DispatcherServlet`
- Jersey/JAX-RS: `ServletContainer`
- RESTEasy: dispatcher servlet/filter
- JSF: `FacesServlet`
- Vaadin: Vaadin servlet
- Wicket: Wicket filter/servlet

Jadi walaupun kamu tidak menulis servlet, lifecycle ini tetap terjadi.

### 13.1 Framework Controller Bukan Servlet

Spring controller:

```java
@RestController
class ReportController {
    @GetMapping("/reports/{id}")
    Report get(@PathVariable String id) { ... }
}
```

Controller ini bukan Servlet. Request melewati:

```text
HTTP request
  -> Container
  -> Filter chain
  -> DispatcherServlet.service()
  -> Spring MVC dispatch
  -> Controller method
```

Ketika terjadi bug seperti:

- body sudah terbaca,
- response sudah committed,
- wrong context path,
- wrong forwarded proto,
- async timeout,
- multipart temp file issue,

akar masalahnya sering ada di Servlet layer, bukan controller layer.

### 13.2 Servlet Lifecycle dan DI Container Lifecycle

Dalam Jakarta EE/Spring, object lifecycle bisa bertumpuk:

```text
Servlet container lifecycle
  -> Web application lifecycle
      -> Framework/DI container lifecycle
          -> Bean/controller/service lifecycle
```

Misalnya Spring Boot embedded Tomcat:

```text
JVM process starts
  -> Spring ApplicationContext starts
      -> Embedded Tomcat starts
          -> DispatcherServlet registered/initialized
              -> Requests handled
```

Pada external WAR:

```text
External Tomcat starts
  -> WAR deployed
      -> ServletContext initialized
          -> Spring root/web context starts
              -> DispatcherServlet initialized
```

Memahami urutan ini penting untuk debugging startup failure.

---

## 14. Lifecycle dan Annotation Registration

Servlet bisa didaftarkan dengan `@WebServlet`.

```java
@WebServlet(
    name = "AuditServlet",
    urlPatterns = {"/audit", "/audit/*"},
    initParams = {
        @WebInitParam(name = "maxRows", value = "1000"),
        @WebInitParam(name = "mode", value = "readonly")
    },
    loadOnStartup = 2,
    asyncSupported = true
)
public class AuditServlet extends HttpServlet {
}
```

Field penting:

| Annotation Attribute | Makna |
|---|---|
| `name` | nama servlet |
| `urlPatterns` / `value` | mapping URL |
| `initParams` | parameter khusus servlet |
| `loadOnStartup` | eager initialization order |
| `asyncSupported` | apakah servlet mendukung async |
| `description`, `displayName` | metadata |

### 14.1 Annotation vs `web.xml`

Annotation cocok untuk:

- app kecil,
- servlet sederhana,
- mapping dekat dengan code.

`web.xml` cocok untuk:

- legacy enterprise,
- konfigurasi deployment-specific,
- central mapping control,
- override annotation,
- aplikasi yang banyak servlet/filter/listener.

Framework modern sering memakai programmatic registration.

### 14.2 Programmatic Registration

Via `ServletContext`:

```java
public class AppInitializer implements ServletContextListener {

    @Override
    public void contextInitialized(ServletContextEvent sce) {
        ServletContext context = sce.getServletContext();

        ServletRegistration.Dynamic servlet =
                context.addServlet("health", new HealthServlet());

        servlet.addMapping("/health");
        servlet.setLoadOnStartup(1);
    }
}
```

Atau via `ServletContainerInitializer`, yang akan dibahas lebih dalam di part deployment/container configuration.

---

## 15. Async Lifecycle Interaction

Async Servlet akan dibahas mendalam di Part 014, tapi lifecycle dasarnya perlu dikenalkan di sini.

Dalam servlet sync biasa:

```text
service() starts
  -> app writes response
service() returns
  -> request considered complete
```

Dalam async servlet:

```java
@Override
protected void doGet(HttpServletRequest req, HttpServletResponse resp) {
    AsyncContext async = req.startAsync();

    executor.submit(() -> {
        try {
            HttpServletResponse response =
                    (HttpServletResponse) async.getResponse();
            response.getWriter().write("done");
            async.complete();
        } catch (Exception e) {
            async.complete();
        }
    });
}
```

Flow:

```text
service() starts
  -> startAsync()
  -> service() returns
  -> request not complete yet
  -> async work continues
  -> async.complete()
  -> request complete
```

Poin penting:

- `service()` return tidak selalu berarti request selesai jika async dimulai.
- Request/response object punya lifecycle yang diperpanjang oleh async context.
- Thread yang memulai request bisa dilepas.
- Kamu wajib memanggil `complete()` atau `dispatch()`.
- Timeout harus ditangani.

Lifecycle servlet instance tetap sama, tetapi request lifecycle berubah.

---

## 16. `SingleThreadModel`: Historical Trap

Di Servlet lama ada interface `SingleThreadModel`.

Tujuannya dulu adalah mencegah dua thread menjalankan `service()` pada servlet instance yang sama secara bersamaan.

Namun interface ini sudah lama deprecated dan tidak boleh dipakai.

Kenapa bukan solusi?

- tidak menyelesaikan shared static state,
- tidak menyelesaikan shared external resource,
- bisa membuat container membuat beberapa instance atau serialize request,
- buruk untuk throughput,
- memberi ilusi keamanan concurrency.

Prinsip modern:

```text
Do not use SingleThreadModel.
Design servlet as thread-safe shared component.
```

---

## 17. Servlet Lifecycle dalam Embedded Server

Pada embedded server, lifecycle tetap ada, hanya packaging-nya berbeda.

Traditional WAR:

```text
External Tomcat
  -> deploy WAR
  -> create ServletContext
  -> initialize servlets
```

Embedded server:

```text
Application main()
  -> create embedded Tomcat/Jetty/Undertow
  -> register servlet/context/filter
  -> start server
  -> initialize servlets
```

Contoh embedded-style conceptual:

```java
public static void main(String[] args) throws Exception {
    Tomcat tomcat = new Tomcat();
    tomcat.setPort(8080);

    Context ctx = tomcat.addContext("", new File(".").getAbsolutePath());

    Tomcat.addServlet(ctx, "health", new HealthServlet());
    ctx.addServletMappingDecoded("/health", "health");

    tomcat.start();
    tomcat.getServer().await();
}
```

Spring Boot menyembunyikan detail ini, tetapi secara prinsip tetap:

```text
register servlet -> initialize servlet -> service requests -> destroy servlet
```

---

## 18. Production Failure Examples

### 18.1 Data Leak Karena Instance Field

Bug:

```java
private User currentUser;

protected void doGet(HttpServletRequest req, HttpServletResponse resp) {
    currentUser = authenticate(req);
    renderDashboard(currentUser, resp);
}
```

Incident:

```text
User A melihat data User B secara intermittent.
Hanya terjadi saat traffic tinggi.
Tidak reproducible di local.
```

Root cause:

```text
Shared servlet instance + mutable instance field + concurrent requests.
```

Fix:

```java
User currentUser = authenticate(req);
renderDashboard(currentUser, resp);
```

### 18.2 Redeploy Leak Karena Thread Tidak Dihentikan

Bug:

```java
@Override
public void init() {
    new Thread(this::pollForever).start();
}
```

Incident:

```text
Setelah redeploy berkali-kali, memory naik.
Old app version masih menulis log.
Metaspace naik.
Container perlu restart full.
```

Root cause:

```text
Unmanaged thread keeps reference to old webapp classloader.
```

Fix:

- pakai managed executor/lifecycle bean,
- simpan reference thread/executor,
- stop di `destroy()`,
- gunakan shutdown flag,
- pastikan thread keluar.

### 18.3 First Request Lambat Karena Lazy Init

Bug:

```text
Servlet report tidak load-on-startup.
Init membaca template besar dan memvalidasi config.
Request pertama user menunggu 15 detik.
```

Fix:

- gunakan `load-on-startup` untuk servlet critical,
- pindahkan heavy warmup ke startup lifecycle yang terukur,
- readiness baru hijau setelah komponen critical siap.

### 18.4 Init Menelan Exception

Bug:

```java
@Override
public void init() {
    try {
        config = loadConfig();
    } catch (Exception ignored) {
    }
}
```

Incident:

```text
Deployment sukses, tetapi request tertentu selalu 500.
Root cause config missing tidak terlihat di startup log.
```

Fix:

```java
throw new ServletException("Failed to load config", e);
```

### 18.5 Shared JDBC Connection

Bug:

```java
private Connection connection;

@Override
public void init() throws ServletException {
    connection = DriverManager.getConnection(url, user, pass);
}
```

Incident:

```text
Intermittent SQL error, transaction corrupt, connection closed unexpectedly.
```

Root cause:

```text
JDBC Connection bukan request-safe shared singleton.
Gunakan DataSource/pool dan ambil connection per unit of work.
```

Fix conceptual:

```java
try (Connection connection = dataSource.getConnection()) {
    // use connection within request/unit-of-work
}
```

---

## 19. Designing a Good Servlet Class

Servlet yang baik biasanya punya karakteristik:

1. Constructor kosong atau minimal.
2. `init()` melakukan validation yang bounded.
3. Field immutable setelah init.
4. Tidak menyimpan request/response/session sebagai field.
5. Request data memakai local variable.
6. Mutable shared state memakai concurrency-safe abstraction.
7. Heavy business logic didelegasikan ke service layer.
8. Error handling jelas.
9. Resource cleanup ada di `destroy()` bila resource dimiliki servlet.
10. Tidak membuat unmanaged thread tanpa lifecycle.
11. Tidak memakai static mutable state.
12. Tidak override `service()` kecuali perlu.
13. Tidak mencampur parsing, business logic, rendering, dan infrastructure berlebihan.

### 19.1 Example: Clean Servlet Skeleton

```java
package com.example.web;

import jakarta.servlet.ServletException;
import jakarta.servlet.annotation.WebServlet;
import jakarta.servlet.http.HttpServlet;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import java.io.IOException;
import java.time.Duration;
import java.util.Set;

@WebServlet(
        name = "ExportServlet",
        urlPatterns = "/exports/*",
        loadOnStartup = 1
)
public class ExportServlet extends HttpServlet {

    private int maxRows;
    private Set<String> supportedFormats;
    private ExportService exportService;

    @Override
    public void init() throws ServletException {
        this.maxRows = parseRequiredPositiveInt("maxRows");
        this.supportedFormats = Set.of("csv", "json");
        this.exportService = new ExportService(Duration.ofSeconds(10));
    }

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp)
            throws ServletException, IOException {

        String format = req.getParameter("format");
        if (format == null || !supportedFormats.contains(format)) {
            resp.sendError(HttpServletResponse.SC_BAD_REQUEST, "Unsupported format");
            return;
        }

        String resourceId = req.getPathInfo();
        if (resourceId == null || resourceId.equals("/")) {
            resp.sendError(HttpServletResponse.SC_BAD_REQUEST, "Missing resource id");
            return;
        }

        ExportResult result;
        try {
            result = exportService.export(resourceId.substring(1), format, maxRows);
        } catch (ExportNotFoundException e) {
            resp.sendError(HttpServletResponse.SC_NOT_FOUND, "Resource not found");
            return;
        } catch (ExportTooLargeException e) {
            resp.sendError(HttpServletResponse.SC_REQUEST_ENTITY_TOO_LARGE, "Export too large");
            return;
        } catch (Exception e) {
            throw new ServletException("Export failed", e);
        }

        resp.setStatus(HttpServletResponse.SC_OK);
        resp.setContentType(result.contentType());
        resp.setHeader("Content-Disposition", "attachment; filename=\"export." + format + "\"");
        resp.getOutputStream().write(result.bytes());
    }

    @Override
    public void destroy() {
        if (exportService != null) {
            exportService.close();
        }
    }

    private int parseRequiredPositiveInt(String name) throws ServletException {
        String value = getInitParameter(name);
        if (value == null || value.isBlank()) {
            throw new ServletException("Missing init-param: " + name);
        }
        try {
            int parsed = Integer.parseInt(value);
            if (parsed <= 0) {
                throw new ServletException("Init-param must be positive: " + name);
            }
            return parsed;
        } catch (NumberFormatException e) {
            throw new ServletException("Invalid integer init-param " + name + ": " + value, e);
        }
    }
}
```

Catatan:

- `maxRows` immutable setelah init.
- `supportedFormats` immutable.
- Request data local variable.
- Error response eksplisit untuk expected errors.
- Unexpected error dibungkus `ServletException`.
- Resource cleanup dilakukan di `destroy()`.

---

## 20. Lifecycle State Machine

Untuk berpikir seperti engineer sistem, modelkan servlet sebagai state machine.

```text
[DEFINED]
    |
    | class load + instantiate
    v
[CONSTRUCTED]
    |
    | init success
    v
[INITIALIZED]
    |
    | available for mapping
    v
[IN_SERVICE]
    |      ^
    |      |
    | service requests concurrently
    |      |
    +------+
    |
    | shutdown/redeploy/remove
    v
[DESTROYING]
    |
    | destroy returns
    v
[DESTROYED]
```

Failure transitions:

```text
[DEFINED]      -- class loading fails --> [UNAVAILABLE]
[CONSTRUCTED]  -- init fails ---------> [UNAVAILABLE]
[IN_SERVICE]   -- service throws -----> [REQUEST_FAILED] but servlet may remain IN_SERVICE
[DESTROYING]   -- cleanup fails ------> [DESTROYED_WITH_LEAK_RISK]
```

Important distinction:

```text
Request failure usually does not destroy servlet.
Servlet init failure can make servlet unavailable.
Application/container shutdown destroys servlet.
```

---

## 21. Servlet Lifecycle Checklist

Gunakan checklist ini saat review servlet/filter/framework integration.

### 21.1 Construction

- Apakah class bisa diinstantiate container?
- Apakah constructor kosong/minimal?
- Apakah constructor bebas IO/network/config lookup?
- Apakah dependency injection yang dipakai memang didukung runtime?

### 21.2 Init

- Apakah required config divalidasi?
- Apakah error init dilempar sebagai `ServletException`?
- Apakah init bounded dan tidak blocking indefinite?
- Apakah field yang di-set immutable atau thread-safe?
- Apakah `super.init(config)` dipanggil jika override `init(ServletConfig)`?
- Apakah `load-on-startup` dipakai untuk servlet critical?

### 21.3 Service

- Apakah request data hanya local/request scope?
- Apakah tidak ada request/response/session disimpan di field?
- Apakah mutable shared state thread-safe?
- Apakah expected error dipetakan ke status code benar?
- Apakah unexpected error tidak ditelan?
- Apakah body/request stream tidak dibaca dua kali tanpa wrapper?
- Apakah response tidak ditulis setelah commit?

### 21.4 Destroy

- Apakah resource milik servlet dibersihkan?
- Apakah cleanup idempotent?
- Apakah cleanup punya timeout/bounded?
- Apakah background thread/executor dihentikan?
- Apakah error cleanup dilog, bukan dilempar liar?

### 21.5 Redeploy

- Apakah tidak ada static mutable state yang menahan classloader?
- Apakah thread lama tidak hidup setelah redeploy?
- Apakah JDBC driver/client/resource unregister/close bila perlu?
- Apakah cache global tidak bocor antar deployment?

---

## 22. Relation to Upcoming Parts

Part ini adalah fondasi untuk part berikutnya.

Setelah memahami servlet lifecycle, kita bisa masuk ke object yang dipakai lifecycle tersebut:

- Part 005: `HttpServletRequest` internals
- Part 006: `HttpServletResponse` internals
- Part 007: mapping dan dispatch resolution
- Part 008: forward/include/error/async dispatch
- Part 009: filter chain
- Part 010: listeners
- Part 011: `ServletContext`
- Part 012: `HttpSession`

Kalau lifecycle ini belum kuat, topic berikutnya akan terlihat seperti API hafalan. Kalau lifecycle ini kuat, setiap API berikutnya akan terlihat sebagai bagian dari satu runtime model yang konsisten.

---

## 23. Ringkasan Inti

Servlet lifecycle bukan sekadar:

```text
init -> service -> destroy
```

Model yang lebih akurat:

```text
Container owns servlet instance.
Servlet instance is long-lived.
Request/response are short-lived.
Multiple threads can call same servlet concurrently.
init prepares shared servlet state.
service handles per-request execution.
destroy releases servlet-owned resources.
```

Hal yang paling penting:

1. Jangan simpan per-request data di servlet field.
2. Jangan anggap servlet object dibuat per request.
3. Jangan lakukan heavy unbounded work di `init()` atau `destroy()`.
4. Gunakan `init()` untuk fail fast terhadap config invalid.
5. Gunakan local variable/request scope untuk request data.
6. Gunakan immutable atau thread-safe object untuk shared state.
7. Jangan membuat unmanaged thread tanpa cleanup.
8. Jangan mengandalkan `destroy()` sebagai satu-satunya mekanisme keselamatan data.
9. Pahami bahwa framework controller tetap berjalan di atas servlet lifecycle.
10. Treat lifecycle as a state machine with explicit failure transitions.

---

## 24. Latihan Mental Model

Jawab pertanyaan ini sebelum lanjut:

1. Jika ada 100 request paralel ke satu `HttpServlet`, berapa servlet instance default-nya?
2. Apakah aman menyimpan `HttpServletRequest` di instance field? Kenapa?
3. Kapan `init()` dipanggil jika servlet lazy?
4. Kapan `init()` dipanggil jika `load-on-startup = 1`?
5. Apa risiko override `init(ServletConfig)` tanpa `super.init(config)`?
6. Apa beda `ServletConfig` dan `ServletContext`?
7. Kenapa shared `SimpleDateFormat` di servlet berbahaya?
8. Kenapa `destroy()` harus bounded?
9. Apakah request failure otomatis menghancurkan servlet?
10. Kenapa static mutable state bisa menyebabkan redeploy leak?

Jika jawabanmu sudah jelas, kamu siap masuk ke Part 005: `HttpServletRequest` internals.

---

## 25. Referensi

- Jakarta Servlet 6.1 Specification — Servlet lifecycle, `Servlet`, `GenericServlet`, `HttpServlet`, request/response contract.
- Jakarta Servlet 6.1 API Documentation — package `jakarta.servlet` dan `jakarta.servlet.http`.
- Apache Tomcat 11 Servlet API documentation — Servlet 6.1 API surface as implemented/documented by Tomcat.
- Jakarta EE Platform documentation — relationship between Jakarta EE web components and runtime.
- Java SE API documentation — Java concurrency primitives, `java.time`, and lifecycle-safe utilities.

---

## Status Seri

Seri belum selesai.

Progress saat ini:

```text
Part 000 selesai
Part 001 selesai
Part 002 selesai
Part 003 selesai
Part 004 selesai
Part 005 berikutnya
```

