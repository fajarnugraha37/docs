# learn-java-servlet-websocket-web-container-runtime-part-003

# Part 003 — Servlet Container Architecture

> Seri: `learn-java-servlet-websocket-web-container-runtime`  
> Part: `003`  
> Topik: arsitektur servlet container, request admission, connector, context routing, servlet dispatch, threading, deployment unit, dan perbedaan servlet container vs application server  
> Target pembaca: engineer Java backend yang ingin memahami web runtime di bawah framework seperti Spring MVC, JAX-RS, JSF, Vaadin, Struts, atau framework internal perusahaan

---

## 0. Tujuan Part Ini

Part sebelumnya membahas fondasi HTTP. Sekarang kita masuk ke pertanyaan yang lebih rendah level:

> Setelah byte HTTP masuk ke server, siapa yang menerimanya, siapa yang membaca socket, siapa yang memilih aplikasi, siapa yang memilih servlet, siapa yang menjalankan filter, siapa yang memanggil kode kita, dan siapa yang mengirim response kembali ke client?

Jawabannya bukan “Spring”, bukan “controller”, dan bukan “annotation”. Jawabannya adalah **web container / servlet container**.

Dalam Java web application, framework biasanya duduk **di atas** Servlet API. Servlet container adalah runtime yang:

1. membuka port jaringan,
2. menerima koneksi TCP/TLS/HTTP,
3. membaca dan menulis HTTP message,
4. memilih web application berdasarkan host/context path,
5. memilih filter chain dan servlet mapping,
6. mengelola lifecycle object Servlet API,
7. mengatur thread/concurrency,
8. menyediakan session, cookie integration, request dispatch, async processing,
9. mengelola deployment/redeployment,
10. menghubungkan aplikasi dengan mekanisme container lain seperti logging, classloading, JNDI, WebSocket, JSP/Pages, dan security integration.

Mental model yang ingin dibangun:

```text
Servlet container is not a thin wrapper around your controller.
It is the protocol/runtime boundary between the outside world and your Java object model.
```

Kalau engineer hanya melihat `@GetMapping`, `@Path`, atau `@WebServlet`, ia hanya melihat bagian kecil dari sistem. Engineer top-tier melihat seluruh pipeline:

```text
client
  -> DNS / CDN / WAF / reverse proxy / load balancer
  -> TCP accept
  -> HTTP parser
  -> connector
  -> container request object
  -> virtual host
  -> context path
  -> web application
  -> filter chain
  -> servlet mapping
  -> framework front controller
  -> application handler
  -> response commit
  -> socket write
  -> connection reuse / close
```

---

## 1. Apa Itu Servlet Container?

### 1.1 Definisi praktis

Servlet container adalah runtime yang menjalankan aplikasi berbasis Servlet API.

Ia menyediakan implementasi untuk kontrak seperti:

```java
jakarta.servlet.Servlet
jakarta.servlet.Filter
jakarta.servlet.ServletContext
jakarta.servlet.ServletRequest
jakarta.servlet.ServletResponse
jakarta.servlet.RequestDispatcher
jakarta.servlet.AsyncContext
jakarta.servlet.http.HttpServletRequest
jakarta.servlet.http.HttpServletResponse
jakarta.servlet.http.HttpSession
```

Aplikasi kita biasanya hanya memakai interface tersebut. Implementasi konkretnya dibuat oleh container.

Misalnya saat kode kita menerima:

```java
protected void doGet(HttpServletRequest request, HttpServletResponse response) {
    String id = request.getParameter("id");
}
```

`request` itu bukan object buatan aplikasi. Itu object container-specific, misalnya implementasi internal Tomcat, Jetty, Undertow, Liberty, atau Payara.

### 1.2 Definisi konseptual

Servlet container adalah gabungan dari beberapa peran:

| Peran | Tanggung jawab |
|---|---|
| Network server | Menerima koneksi, membaca request, menulis response |
| HTTP engine | Parsing HTTP, header, body, keep-alive, protocol upgrade |
| Application router | Menentukan web app/context mana yang menerima request |
| Servlet runtime | Mengelola servlet/filter/listener/session/dispatch/async |
| Lifecycle manager | Deploy, start, stop, reload, destroy |
| Classloading boundary | Memisahkan library antar web application |
| Concurrency manager | Thread pool, async, timeout, connection admission |
| Integration point | Security, WebSocket, JSP/Pages, JNDI, metrics, logging |

Jadi container tidak sama dengan library biasa. Ia adalah runtime yang memanggil aplikasi, bukan aplikasi yang sekadar memanggil runtime.

---

## 2. Kenapa Servlet Container Penting Walaupun Kita Pakai Spring Boot?

Banyak developer modern merasa “saya tidak pakai servlet, saya pakai Spring Boot”. Ini framing yang keliru untuk aplikasi Spring MVC tradisional.

Spring Boot dengan embedded Tomcat/Jetty/Undertow tetap memakai servlet container. Bedanya container tidak diinstall terpisah sebagai server eksternal; container dibundel dan dijalankan di dalam process aplikasi.

Contoh stack Spring MVC di embedded Tomcat:

```text
java -jar app.jar
  -> SpringApplication.run(...)
  -> Embedded Tomcat starts
  -> HTTP connector opens port 8080
  -> Tomcat receives HTTP request
  -> Filter chain runs
  -> DispatcherServlet receives request
  -> Spring HandlerMapping selects controller
  -> Controller method executes
```

`DispatcherServlet` sendiri adalah servlet. Ia adalah front controller milik Spring MVC.

Secara sederhana:

```text
Spring MVC controller
  sits behind
DispatcherServlet
  sits behind
Servlet filter chain
  sits inside
Servlet container
  sits behind
HTTP connector / network stack
```

Maka ketika ada masalah seperti:

- request timeout,
- response already committed,
- filter membaca body dua kali,
- redirect salah scheme,
- session hilang,
- request body terlalu besar,
- WebSocket putus oleh load balancer,
- thread pool exhausted,
- graceful shutdown tidak menunggu request,
- memory leak setelah redeploy,

masalahnya sering bukan di controller. Masalahnya ada di container boundary.

---

## 3. Servlet Container vs Web Server vs Application Server

Istilah ini sering tercampur. Mari pisahkan.

### 3.1 Web server

Web server adalah server yang menerima HTTP dan mengirim response. Contoh:

- Nginx,
- Apache HTTP Server,
- Caddy,
- Envoy,
- HAProxy dalam mode HTTP,
- static file server.

Web server belum tentu bisa menjalankan Servlet API.

### 3.2 Servlet container

Servlet container menjalankan Servlet/JSP/Jakarta Pages/WebSocket endpoint dan menyediakan Servlet API runtime.

Contoh:

- Apache Tomcat,
- Eclipse Jetty,
- Undertow dalam mode servlet,
- embedded Tomcat pada Spring Boot,
- embedded Jetty,
- embedded Undertow.

### 3.3 Jakarta EE web profile server

Web Profile server mendukung subset Jakarta EE untuk aplikasi web enterprise. Biasanya mencakup Servlet, Pages, EL, CDI, REST, JSON-B/P, Bean Validation, Persistence, Transactions, dan sebagian teknologi lain sesuai versi platform.

Contoh implementasi yang dapat menyediakan Web Profile atau varian capability:

- GlassFish,
- Payara,
- Open Liberty,
- WildFly,
- TomEE.

### 3.4 Full Jakarta EE application server

Full application server mendukung lebih banyak teknologi enterprise seperti messaging, full transaction integration, EJB legacy, connectors, batch, mail, security, dan lain-lain sesuai platform.

Contoh:

- WildFly,
- Payara Server,
- GlassFish,
- Open Liberty,
- WebSphere Liberty,
- JBoss EAP.

### 3.5 Embedded server

Embedded server berarti container berjalan di dalam process aplikasi.

Contoh:

```text
Traditional:
  install Tomcat
  deploy app.war into webapps/

Embedded:
  java -jar app.jar
  app starts Tomcat programmatically
```

Trade-off:

| Model | Kelebihan | Risiko |
|---|---|---|
| External WAR | Ops bisa mengelola server terpisah, cocok legacy enterprise | shared container, dependency konflik, redeploy leak, environment drift |
| Embedded JAR | immutable deployment, mudah containerized, app owns runtime | setiap app membawa server sendiri, config harus benar, patching tersebar |
| Full app server | banyak layanan enterprise built-in | lebih kompleks, upgrade lebih berat, runtime behavior lebih banyak layer |

---

## 4. Big Picture: Dari Socket ke Servlet

Mari lihat pipeline request secara menyeluruh.

```text
[Client]
   |
   | TCP/TLS/HTTP
   v
[Connector / Network Listener]
   |
   | parse HTTP request
   v
[Container Request Object]
   |
   | host/context/path resolution
   v
[Engine / Host / Context]
   |
   | web application selected
   v
[Filter Chain]
   |
   | pre-processing / wrapping / security / logging
   v
[Servlet Mapping]
   |
   | selected servlet
   v
[Servlet.service()]
   |
   | framework or custom code
   v
[Application Logic]
   |
   | writes response
   v
[Response Buffer / Commit]
   |
   | headers/body flushed
   v
[Connector writes to socket]
```

Di Tomcat, istilah struktural yang sering muncul adalah:

```text
Server
  -> Service
      -> Connector
      -> Engine
          -> Host
              -> Context
                  -> Wrapper(Servlet)
```

Tidak semua container memakai nama yang sama, tetapi konsepnya mirip:

- ada komponen network listener/connector,
- ada konsep virtual host,
- ada konsep web application/context,
- ada mapping ke servlet/filter,
- ada thread/executor yang menjalankan pekerjaan.

---

## 5. Connector: Pintu Masuk Network

### 5.1 Apa itu connector?

Connector adalah komponen yang menerima koneksi dari client/proxy dan mengubah data network menjadi request/response yang bisa diproses container.

Tanggung jawab connector:

1. bind ke port, misalnya 8080 atau 8443,
2. menerima TCP connection,
3. menjalankan TLS jika container menjadi TLS endpoint,
4. membaca HTTP request,
5. parsing request line/header/body,
6. mengelola keep-alive,
7. mengelola protocol seperti HTTP/1.1, HTTP/2, AJP, atau upgrade WebSocket,
8. menyerahkan request ke pipeline container,
9. menulis response ke socket.

### 5.2 Connector bukan servlet

Servlet bekerja setelah request sudah diparse. Connector bekerja sebelum object `HttpServletRequest` sampai ke kode kita.

```text
socket bytes
  -> connector
  -> parsed request
  -> servlet request object
  -> filter/servlet
```

Karena itu banyak limit terjadi sebelum servlet:

- max header size,
- max request line size,
- invalid HTTP syntax,
- TLS handshake failure,
- connection timeout,
- keep-alive timeout,
- request body too large at connector/proxy,
- HTTP/2 stream limit,
- protocol upgrade failure.

Aplikasi tidak selalu bisa menangkap error tersebut karena request belum menjadi request Servlet normal.

### 5.3 Common connector parameters

Secara konseptual, connector biasanya punya parameter seperti:

| Parameter | Makna |
|---|---|
| port | Port listen |
| protocol | HTTP/1.1, HTTP/2, AJP, etc. |
| max connections | Berapa koneksi aktif yang diterima |
| max threads / executor | Berapa worker yang menjalankan request |
| accept count / backlog | Antrian koneksi ketika worker penuh |
| connection timeout | Timeout saat menunggu request data |
| keep-alive timeout | Timeout koneksi idle setelah response |
| max keep-alive requests | Batas request per persistent connection |
| max header size | Batas ukuran header |
| max post/request body size | Batas body tertentu |
| compression | Response compression di connector |
| redirect port / scheme | Informasi scheme untuk redirect/security |
| proxy/forwarded support | Interpretasi header dari proxy |

Kunci mental model:

```text
Application throughput is not determined only by code speed.
It is bounded by connector admission, worker availability, downstream capacity, and timeout alignment.
```

---

## 6. Acceptor, Selector, Worker: Tiga Jenis Aktivitas yang Sering Tertukar

Container modern biasanya memisahkan beberapa jenis pekerjaan.

### 6.1 Acceptor

Acceptor menerima koneksi baru dari socket server.

Tugasnya:

- accept TCP connection,
- menyerahkan connection ke komponen I/O berikutnya,
- tidak menjalankan business logic.

### 6.2 Selector / Poller / I/O thread

Selector/poller memantau socket readiness:

- socket siap dibaca,
- socket siap ditulis,
- connection idle,
- timeout.

Pada model NIO, satu thread bisa memantau banyak connection.

### 6.3 Worker thread

Worker thread menjalankan pekerjaan aplikasi:

- filter,
- servlet,
- framework dispatch,
- controller,
- blocking I/O ke DB/HTTP client,
- rendering response.

### 6.4 Kenapa pemisahan ini penting?

Karena error capacity berbeda-beda.

| Bottleneck | Gejala | Salah kaprah umum |
|---|---|---|
| Acceptor/backlog penuh | koneksi ditolak/timeout sebelum app log | “controller lambat” |
| Selector/I/O stuck | banyak koneksi idle/aneh, throughput jatuh | “thread app kurang” |
| Worker penuh | request antre, latency naik, 503/timeout | “database selalu salah” |
| DB pool penuh | worker block menunggu connection | “butuh maxThreads lebih besar” |
| Response write lambat | worker/async task tertahan slow client | “CPU kurang” |

Engineer senior tidak langsung menaikkan `maxThreads`. Ia menanyakan:

```text
Di mana antriannya?
Di connector?
Di worker pool?
Di DB pool?
Di HTTP client pool?
Di message broker?
Di proxy?
Di client karena slow read?
```

---

## 7. Request Admission: Kapan Request Diizinkan Masuk?

Sebelum kode kita berjalan, request harus melewati beberapa gate.

```text
1. TCP connection accepted?
2. TLS handshake valid?
3. HTTP syntax valid?
4. header size within limit?
5. request body allowed?
6. virtual host known?
7. context path exists?
8. application started?
9. filter/servlet mapping found?
10. worker available or queued?
```

Kalau gagal di gate awal, aplikasi mungkin tidak punya log sama sekali.

Contoh:

| Failure | Kemungkinan layer |
|---|---|
| Browser menunjukkan SSL error | TLS/proxy/container connector |
| 400 sebelum access log aplikasi | HTTP parser / connector |
| 404 untuk semua endpoint | context path / reverse proxy / deployment |
| 413 | proxy limit atau connector/body parser |
| 431 | header terlalu besar |
| 502 | proxy tidak bisa bicara ke upstream |
| 503 | app belum ready / worker exhausted / upstream unavailable |
| 504 | proxy timeout menunggu response |

---

## 8. Virtual Host, Context Path, Servlet Path

Salah satu tugas utama container adalah memilih aplikasi yang tepat.

### 8.1 Host

Satu container bisa melayani beberapa hostname.

```text
admin.example.com
api.example.com
internal.example.com
```

Pada container, ini bisa dimodelkan sebagai virtual host.

### 8.2 Context path

Context path adalah prefix URL untuk sebuah web application.

Contoh:

```text
https://example.com/aceas/...
https://example.com/cpds/...
```

Maka:

```text
/aceas -> web application A
/cpds  -> web application B
```

Root context biasanya `""` atau `/` secara URL visible.

### 8.3 Servlet path dan path info

Setelah web application dipilih, container mencocokkan URL dengan servlet mapping.

Misalnya:

```text
context path: /app
URL: /app/api/users/123
servlet mapping: /api/*
```

Maka secara konseptual:

```text
context path = /app
servlet path = /api
path info    = /users/123
```

Framework seperti Spring/JAX-RS kemudian biasanya memproses bagian path setelah servlet mapping.

### 8.4 Kenapa ini penting?

Banyak bug produksi berasal dari salah memahami path decomposition:

- redirect menjadi `http://` padahal harus `https://`,
- URL generated berisi context path dobel,
- reverse proxy strip prefix tapi aplikasi masih mengira prefix ada,
- static resource 404,
- SPA fallback mengambil API path,
- actuator/health endpoint tidak sesuai ingress path,
- callback URL OAuth/SAML salah karena host/scheme/path salah.

Mental model:

```text
Framework routing starts after container routing.
If container routing is wrong, framework routing never gets a fair chance.
```

---

## 9. Web Application as a Deployment Unit

Servlet container menjalankan web application sebagai unit deployment.

### 9.1 WAR structure

WAR tradisional memiliki struktur seperti:

```text
myapp.war
  /index.jsp
  /assets/app.js
  /WEB-INF/web.xml
  /WEB-INF/classes/...
  /WEB-INF/lib/*.jar
```

Makna:

| Lokasi | Fungsi |
|---|---|
| root WAR | static resources/JSP yang dapat diakses sesuai rules |
| `WEB-INF/web.xml` | deployment descriptor legacy/explicit config |
| `WEB-INF/classes` | compiled classes aplikasi |
| `WEB-INF/lib` | library aplikasi |
| `META-INF` | metadata jar/resources tertentu |

`WEB-INF` tidak boleh dilayani langsung sebagai static content ke browser.

### 9.2 Exploded WAR

Exploded WAR adalah WAR yang sudah diekstrak menjadi directory.

Kelebihan:

- mudah inspect,
- kadang dipakai untuk hot deploy/dev,
- static resource bisa dilihat langsung.

Risiko:

- file partial saat deployment,
- permission mismatch,
- timestamp/cache issue,
- environment drift.

### 9.3 Embedded JAR

Dalam model Spring Boot atau framework embedded lain:

```text
app.jar
  -> contains application classes
  -> contains embedded servlet container libraries
  -> starts HTTP server from main()
```

Deployment unit adalah process aplikasi, bukan WAR yang dimasukkan ke server eksternal.

### 9.4 Kubernetes/container image

Dalam containerized deployment, deployment unit lebih luas:

```text
OCI image
  -> base JRE/JDK
  -> app jar/war
  -> config/env integration
  -> startup command
  -> health endpoint
  -> resource limits
```

Servlet container tetap ada, tapi sekarang lifecycle-nya terhubung dengan:

- pod startup,
- readiness probe,
- liveness probe,
- preStop hook,
- termination grace period,
- service endpoint removal,
- ingress/load balancer draining.

---

## 10. Deployment Lifecycle

Container tidak hanya memanggil request. Ia juga mengelola aplikasi dari lahir sampai mati.

Secara sederhana:

```text
1. Discover deployment
2. Create web application context
3. Create classloader
4. Parse metadata
5. Scan annotations/fragments
6. Initialize ServletContext
7. Run ServletContainerInitializer
8. Run context listeners
9. Initialize filters
10. Initialize load-on-startup servlets
11. Mark app available
12. Process requests
13. Stop accepting new requests for app
14. Destroy servlets/filters/listeners
15. Release classloader/resources
```

Tidak semua container melakukan urutan internal persis sama, tetapi konsepnya mirip.

### 10.1 Metadata discovery

Container dapat membaca konfigurasi dari:

- `web.xml`,
- annotation seperti `@WebServlet`, `@WebFilter`, `@WebListener`,
- web fragments di JAR,
- `ServletContainerInitializer`,
- programmatic registration,
- framework bootstrap.

### 10.2 Startup failure

Kalau listener atau servlet `load-on-startup` gagal, aplikasi bisa gagal deploy.

Contoh akar masalah:

- dependency class tidak ditemukan,
- database unavailable saat startup,
- config invalid,
- port conflict,
- annotation scanning error,
- Jakarta/Javax mismatch,
- duplicate servlet mapping,
- incompatible bytecode version,
- failed CDI/Spring context bootstrap.

### 10.3 Runtime unavailable state

Aplikasi bisa sudah terdeploy tetapi belum ready secara bisnis.

Contoh:

- Spring context masih init,
- cache warming,
- DB migration berjalan,
- message listener belum siap,
- remote dependency belum reachable,
- health check belum green.

Container-level “started” tidak selalu sama dengan application-level “ready”.

---

## 11. ServletContext: Boundary Satu Web Application

`ServletContext` merepresentasikan satu web application dalam container.

Ia menyediakan:

- context attributes,
- init parameters,
- resource lookup,
- servlet/filter registration,
- logging hooks,
- request dispatcher,
- MIME type lookup,
- application identity seperti context path.

Mental model:

```text
ServletContext is the runtime boundary of one deployed web application.
```

Jika satu Tomcat menjalankan tiga web app:

```text
/app-a
/app-b
/app-c
```

maka masing-masing punya `ServletContext` sendiri.

Risiko desain:

- menaruh mutable global state sembarangan di context attribute,
- tidak membersihkan resource pada shutdown,
- menyimpan object dari classloader lama sehingga redeploy leak,
- memakai context sebagai service locator liar.

---

## 12. Filter Chain dan Servlet Wrapper

Setelah context dipilih, container membuat chain.

```text
Request
  -> Filter A
      -> Filter B
          -> Filter C
              -> Servlet
          <- Filter C returns
      <- Filter B returns
  <- Filter A returns
Response
```

Filter dapat:

- membaca/mengubah header,
- melakukan authentication/authorization integration,
- membuat correlation ID,
- wrap request/response,
- reject request lebih awal,
- logging access/application boundary,
- compression,
- CORS,
- rate limiting,
- body caching.

Tapi filter juga bisa merusak runtime:

| Bug filter | Dampak |
|---|---|
| Tidak memanggil `chain.doFilter` | request berhenti diam-diam |
| Memanggil chain dua kali | double execution / double write |
| Membaca body tanpa wrapper | controller tidak bisa baca body |
| Menulis response terlalu awal | downstream gagal karena response committed |
| Menelan exception | observability hilang |
| Tidak clear ThreadLocal | context leak antar request |

Part filter akan dibahas detail di Part 009. Di sini cukup pahami posisinya dalam arsitektur.

---

## 13. Servlet Mapping dan Wrapper

Container biasanya membungkus servlet dalam komponen internal yang mengelola lifecycle dan mapping. Di Tomcat istilahnya sering disebut `Wrapper` untuk satu servlet.

Contoh mapping:

```java
@WebServlet(urlPatterns = "/hello")
public class HelloServlet extends HttpServlet {
    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp) throws IOException {
        resp.getWriter().write("hello");
    }
}
```

Container tidak membuat servlet baru untuk setiap request. Biasanya satu servlet instance melayani banyak request secara concurrent.

Konsekuensi:

```java
public class BadServlet extends HttpServlet {
    private String currentUser; // dangerous
}
```

Field instance seperti ini shared antar request. Ini bug concurrency serius.

Mental model:

```text
Servlet instance is container-owned, long-lived, and concurrently accessed.
Request state belongs in request/session/application-specific safe storage, not servlet fields.
```

---

## 14. Front Controller: Kenapa Framework Hanya Punya Satu Servlet Besar

Banyak framework menggunakan pattern front controller.

Contoh:

| Framework | Servlet utama |
|---|---|
| Spring MVC | `DispatcherServlet` |
| Jersey/JAX-RS | servlet/container integration yang menerima request lalu dispatch ke resource |
| JSF | `FacesServlet` |
| Vaadin | framework servlet |
| Struts | action servlet/filter tergantung versi |

Pipeline:

```text
container servlet mapping
  -> DispatcherServlet
      -> framework routing
          -> controller/resource/action
```

Dengan ini framework bisa mengontrol:

- route matching,
- parameter binding,
- validation integration,
- exception handling,
- response serialization,
- interceptors,
- view rendering,
- content negotiation.

Tapi container tetap mengontrol layer sebelum itu:

- context path,
- filter chain,
- session ID,
- dispatch type,
- async lifecycle,
- request/response object,
- connection timeout,
- response commit.

---

## 15. Threading Model Container

### 15.1 Classic thread-per-request

Model klasik Servlet:

```text
one active request processing path -> one worker thread
```

Selama request berjalan, worker thread dipakai.

Jika kode melakukan blocking call:

```java
DataSource.getConnection()
externalHttpClient.send()
file.read()
Thread.sleep()
```

worker thread tetap tertahan.

### 15.2 Kenapa thread pool bukan silver bullet

Misalnya:

```text
container maxThreads = 400
DB pool maxSize      = 40
external API limit   = 100 req/s
CPU cores            = 4
```

Menaikkan maxThreads ke 800 tidak otomatis menaikkan throughput. Bisa jadi hanya menambah antrian, memory usage, context switching, dan pressure ke DB.

Kapasitas harus dilihat sebagai rantai:

```text
throughput <= min(
  connector capacity,
  worker capacity,
  CPU capacity,
  DB pool capacity,
  downstream API capacity,
  lock contention capacity,
  response write capacity
)
```

### 15.3 Little's Law mental model

Secara intuitif:

```text
concurrency ≈ arrival_rate × latency
```

Jika 100 request/detik dan latency rata-rata 500 ms:

```text
concurrency ≈ 100 × 0.5 = 50 in-flight requests
```

Jika latency naik menjadi 5 detik karena DB lambat:

```text
concurrency ≈ 100 × 5 = 500 in-flight requests
```

Jadi thread pool exhaustion sering akibat latency naik, bukan traffic naik.

### 15.4 Virtual threads

Java 21 memperkenalkan virtual threads sebagai fitur final. Untuk server-side Java, virtual threads dapat mengurangi biaya blocking thread pada model request-per-task.

Namun virtual threads tidak menghapus bottleneck:

- DB pool tetap terbatas,
- downstream tetap rate-limited,
- CPU tetap terbatas,
- synchronized lock tetap bisa menjadi bottleneck,
- memory object per request tetap ada,
- container/proxy timeout tetap berlaku.

Virtual threads mengubah biaya concurrency, bukan hukum kapasitas.

Part khusus threading akan dibahas di Part 018.

---

## 16. Async Processing dalam Container Architecture

Servlet async memungkinkan request dilepas dari worker thread sementara proses belum selesai.

Secara kasar:

```text
request enters worker
  -> servlet calls startAsync()
  -> worker returns to pool
  -> background task waits for dependency/event
  -> async dispatch or write response
  -> complete
```

Async berguna untuk:

- long polling,
- SSE,
- waiting for external callback,
- slow streaming,
- decoupling worker from long wait.

Tapi async bukan magic non-blocking. Kalau background task tetap memakai thread blocking tanpa kontrol, bottleneck pindah saja.

Failure umum:

- lupa `complete()`,
- timeout race,
- request object dipakai setelah lifecycle tidak valid,
- MDC/log context hilang,
- response sudah committed sebelum error handling,
- async queue tidak dibatasi.

Part async akan dibahas di Part 014 dan non-blocking I/O di Part 015.

---

## 17. Session Management dalam Arsitektur Container

Container menyediakan `HttpSession` sebagai state server-side yang dikaitkan dengan client lewat session tracking, biasanya cookie `JSESSIONID`.

Dalam arsitektur:

```text
request cookie JSESSIONID
  -> container finds session
  -> session attached to request
  -> application reads/writes attributes
  -> response may set/update cookie
```

Session terlihat sederhana, tetapi membawa konsekuensi arsitektur:

| Desain | Konsekuensi |
|---|---|
| sticky session | mudah, tapi node failure kehilangan session |
| replicated session | HA lebih baik, tapi serialization dan network overhead |
| external session store | cloud-friendly, tapi latency dan consistency trade-off |
| stateless token | scalable, tapi revocation dan size/security perlu desain |

Di Servlet, session bukan hanya map. Ia adalah runtime object yang lifecycle-nya dikelola container.

Part session akan dibahas di Part 012.

---

## 18. Static Resource, Default Servlet, JSP/Pages

Container juga bisa melayani static resource:

```text
/assets/app.js
/images/logo.png
/favicon.ico
```

Biasanya ada default servlet yang menangani static resource jika tidak ada servlet mapping lain.

JSP/Jakarta Pages juga berjalan sebagai servlet yang dihasilkan/diterjemahkan oleh container.

Secara konseptual:

```text
JSP file
  -> translated to servlet source/class
  -> compiled
  -> executed as servlet
```

Karena itu JSP bukan “di luar servlet”. JSP adalah teknologi view yang dibangun di atas servlet runtime.

---

## 19. WebSocket dalam Container

WebSocket berawal dari HTTP request dengan upgrade handshake.

```text
HTTP GET /ws
Upgrade: websocket
Connection: Upgrade
...
```

Container harus:

1. menerima HTTP upgrade request,
2. mencocokkan endpoint WebSocket,
3. melakukan handshake,
4. mengubah koneksi menjadi WebSocket session,
5. membaca/menulis frame WebSocket,
6. mengelola lifecycle open/message/error/close.

Pipeline-nya tidak sama dengan request/response biasa setelah upgrade.

```text
HTTP request-response lifecycle
  -> short-lived per request

WebSocket lifecycle
  -> long-lived connection
  -> many messages over one connection
```

Ini berdampak besar pada:

- load balancer idle timeout,
- graceful shutdown,
- session affinity,
- memory per connection,
- backpressure,
- reconnection,
- per-user connection registry.

WebSocket akan dibahas detail mulai Part 021.

---

## 20. Classloading Boundary

Dalam external container, setiap web application biasanya punya classloader sendiri.

Konsep:

```text
Bootstrap/System classloader
  -> Container common classloader
      -> WebApp classloader A
      -> WebApp classloader B
```

Tujuannya agar:

- app A bisa punya versi library berbeda dari app B,
- redeploy app A tidak mematikan app B,
- container API dipisahkan dari app library.

Tapi classloading adalah sumber banyak bug:

- `ClassNotFoundException`,
- `NoClassDefFoundError`,
- `ClassCastException` karena class yang sama dimuat dua classloader berbeda,
- `LinkageError`,
- Javax/Jakarta mismatch,
- dependency container vs app konflik,
- memory leak setelah redeploy karena static reference/thread masih memegang classloader lama.

Mental model:

```text
In Java web containers, class identity is not just package + class name.
It is package + class name + defining classloader.
```

Part classloading akan dibahas detail di Part 019.

---

## 21. Container-managed Object Lifecycle

Object yang dikelola container punya lifecycle berbeda dari object yang kita buat sendiri.

| Object | Dibuat oleh | Lifecycle |
|---|---|---|
| Servlet | Container | init → many requests → destroy |
| Filter | Container | init → many dispatches → destroy |
| Listener | Container | registered → event callbacks → destroyed |
| ServletContext | Container | per web app deployment |
| HttpServletRequest | Container | per request/dispatch lifecycle |
| HttpServletResponse | Container | per response lifecycle |
| HttpSession | Container | per client session, timeout/invalidate |
| WebSocket Session | WebSocket runtime | per WebSocket connection |

Kesalahan umum adalah memperlakukan semua object sama seperti POJO biasa.

Contoh:

```java
public class MyServlet extends HttpServlet {
    private final List<String> recentUsers = new ArrayList<>();
}
```

Ini bukan local request state. Ini shared mutable state antar thread.

Aturan praktis:

```text
If container owns the lifecycle, understand the concurrency and cleanup contract before storing state.
```

---

## 22. Container Pipeline sebagai State Machine

Untuk engineer yang sering mendesain workflow/state machine, Servlet container bisa dipahami sebagai state machine.

### 22.1 Request state machine

```text
NEW_CONNECTION
  -> REQUEST_BYTES_RECEIVED
  -> REQUEST_PARSED
  -> CONTEXT_SELECTED
  -> FILTER_CHAIN_ENTERED
  -> SERVLET_INVOKED
  -> RESPONSE_WRITING
  -> RESPONSE_COMMITTED
  -> COMPLETE
```

Dengan cabang error:

```text
REQUEST_PARSED
  -> BAD_REQUEST

CONTEXT_SELECTED
  -> NOT_FOUND

FILTER_CHAIN_ENTERED
  -> REJECTED_BY_FILTER

SERVLET_INVOKED
  -> EXCEPTION
  -> ERROR_DISPATCH

RESPONSE_WRITING
  -> CLIENT_ABORT
```

### 22.2 Deployment state machine

```text
DISCOVERED
  -> PARSING_METADATA
  -> CREATING_CLASSLOADER
  -> INITIALIZING_CONTEXT
  -> INITIALIZING_LISTENERS
  -> INITIALIZING_FILTERS
  -> INITIALIZING_SERVLETS
  -> STARTED
  -> STOPPING
  -> DESTROYING_COMPONENTS
  -> RELEASED
```

### 22.3 WebSocket state machine

```text
HTTP_HANDSHAKE
  -> UPGRADED
  -> OPEN
  -> MESSAGE_FLOW
  -> CLOSING
  -> CLOSED
```

Dengan cabang:

```text
OPEN
  -> IDLE_TIMEOUT
  -> PROTOCOL_ERROR
  -> NETWORK_DROP
  -> SERVER_SHUTDOWN
  -> CLIENT_CLOSE
```

Melihat container sebagai state machine membuat debugging lebih sistematis: cari state mana yang gagal, bukan sekadar melihat stack trace terakhir.

---

## 23. Tomcat: Mental Model Arsitektur

Apache Tomcat adalah servlet/JSP container yang sangat umum, termasuk sebagai default embedded container di banyak Spring Boot aplikasi.

Model internal yang sering dipakai untuk memahami Tomcat:

```text
Server
  Service
    Connector(s)
    Engine
      Host(s)
        Context(s)
          Wrapper(s)
```

Makna konseptual:

| Komponen | Makna |
|---|---|
| Server | keseluruhan Tomcat runtime |
| Service | menggabungkan connector dengan engine |
| Connector | network endpoint/protocol handler |
| Engine | request processing engine |
| Host | virtual host |
| Context | web application |
| Wrapper | servlet |

Tomcat cocok dipahami sebagai:

```text
Focused Servlet/JSP/WebSocket container with strong production maturity.
```

Kekuatan:

- mature,
- dokumentasi luas,
- integrasi Spring Boot kuat,
- konfigurasi connector jelas,
- cocok untuk WAR dan embedded,
- operationally familiar.

Hal yang perlu diingat:

- Tomcat bukan full Jakarta EE server,
- CDI/JPA/JTA penuh tidak otomatis disediakan seperti full app server,
- banyak fitur enterprise berasal dari aplikasi/framework, bukan Tomcat.

---

## 24. Jetty: Mental Model Arsitektur

Eclipse Jetty adalah web server dan servlet container yang kuat untuk embedded dan standalone deployment.

Jetty sering menonjol pada:

- modularity,
- embeddability,
- HTTP/2/HTTP/3/WebSocket support,
- asynchronous I/O architecture,
- fine-grained handler model,
- thread strategy yang eksplisit.

Jetty dapat dipahami sebagai kombinasi:

```text
Server
  -> Connectors
  -> Handlers
      -> ContextHandler
      -> ServletContextHandler / WebAppContext
          -> filters/servlets
```

Jetty punya konsep handler yang lebih general daripada servlet. Servlet support adalah salah satu layer di atas handler model.

Kekuatan:

- sangat cocok embedded/custom server,
- modular,
- kuat untuk protocol-heavy use cases,
- dokumentasi threading architecture baik,
- mendukung model server modern termasuk virtual thread integration di generasi baru.

Risiko:

- operational model berbeda dari Tomcat,
- konfigurasi modular bisa terasa asing,
- team perlu memahami handler vs servlet layer.

---

## 25. Undertow: Mental Model Arsitektur

Undertow dikenal sebagai web server berbasis non-blocking I/O yang digunakan oleh WildFly/JBoss ecosystem dan pernah populer sebagai embedded alternative di Spring Boot.

Undertow punya dua sisi:

1. low-level handler-based web server,
2. servlet container implementation.

Mental model:

```text
Undertow listener
  -> XNIO workers / I/O threads
  -> handler chain
  -> servlet initial handler
  -> servlet/filter dispatch
```

Kekuatan:

- non-blocking architecture,
- lightweight,
- handler chain fleksibel,
- integrasi kuat dengan WildFly,
- cocok untuk high-concurrency workloads jika dikonfigurasi benar.

Risiko:

- I/O thread tidak boleh diblokir sembarangan,
- konfigurasi worker/buffer perlu pemahaman,
- debugging bisa berbeda dari Tomcat-style thread-per-request mental model.

---

## 26. Full Application Server: WildFly, Payara, GlassFish, Open Liberty

Full application server menyediakan lebih dari servlet.

Di dalamnya ada web subsystem/container, tetapi juga ada:

- CDI,
- JPA,
- JTA,
- Jakarta REST,
- Jakarta Security,
- Jakarta Messaging,
- Jakarta Batch,
- Jakarta Mail,
- JNDI,
- resource adapters,
- management model,
- deployment scanner,
- clustering integration,
- transaction/security integration.

Pipeline request web tetap melalui Servlet/Web subsystem, tetapi object aplikasi bisa masuk ke banyak subsystem lain.

Mental model:

```text
Servlet container = web runtime
Application server = web runtime + enterprise service runtime + management runtime
```

Keuntungan full app server:

- platform services standar,
- consistent enterprise integration,
- centralized resource configuration,
- management/monitoring capability,
- cocok untuk enterprise legacy/regulated environments.

Trade-off:

- lebih banyak moving parts,
- startup/deployment lebih kompleks,
- upgrade perlu compatibility planning,
- debugging perlu tahu subsystem mana yang terlibat.

---

## 27. Embedded vs External Container: Arsitektur Operasional

### 27.1 External container model

```text
Tomcat process
  -> app-a.war
  -> app-b.war
  -> app-c.war
```

Kelebihan:

- satu server bisa host banyak app,
- ops bisa patch/configure container terpisah,
- cocok legacy deployment.

Kekurangan:

- noisy neighbor,
- shared config risk,
- shared memory/process failure domain,
- classloader/redeploy leak,
- sulit immutable deployment,
- versi container mungkin tidak cocok semua app.

### 27.2 Embedded model

```text
app-a process includes container
app-b process includes container
app-c process includes container
```

Kelebihan:

- one app = one runtime,
- immutable artifact,
- container image friendly,
- version pinning lebih jelas,
- scaling per app lebih mudah.

Kekurangan:

- setiap app membawa server sendiri,
- patching harus rebuild banyak app,
- config duplication,
- memory overhead per process,
- team harus mengerti runtime config di aplikasi.

### 27.3 Top-tier view

Tidak ada model absolut terbaik. Pilihan tergantung:

- deployment governance,
- compliance,
- team ownership,
- runtime isolation,
- patching policy,
- ops maturity,
- cloud/container strategy,
- need for Jakarta EE services.

---

## 28. Reverse Proxy dan Container Boundary

Dalam produksi, container jarang langsung menghadap internet.

Biasanya:

```text
Browser
  -> CDN/WAF
  -> Load Balancer
  -> Reverse Proxy / Ingress
  -> Servlet Container
  -> Application
```

Setiap layer punya limit dan timeout sendiri.

| Layer | Contoh limit |
|---|---|
| CDN/WAF | max body, security rule, idle timeout |
| Load balancer | idle timeout, TLS policy, health check |
| Reverse proxy | body size, header size, buffering, upstream timeout |
| Container connector | max threads, max header, keep-alive, request timeout |
| App framework | multipart limit, validation, business timeout |
| Downstream | DB pool, API timeout, broker backpressure |

Banyak incident terjadi karena limit tidak selaras.

Contoh:

```text
Proxy timeout:       60s
Application timeout: 120s
DB query timeout:    none
```

Hasil:

- proxy mengembalikan 504 pada detik 60,
- aplikasi masih bekerja sampai 120 detik atau lebih,
- DB tetap terbebani,
- user retry,
- traffic makin berat,
- cascading failure.

Aturan desain:

```text
Timeout must form a coherent chain from outside to inside.
Usually outer timeout should be slightly longer than inner controlled timeout, or app should fail before proxy gives up.
```

---

## 29. Graceful Shutdown dalam Container

Graceful shutdown berarti:

1. berhenti menerima request baru,
2. membiarkan request in-flight selesai dalam batas waktu,
3. menutup session/koneksi long-lived secara terkontrol,
4. menjalankan destroy hooks,
5. melepas resource.

Dalam Kubernetes:

```text
SIGTERM
  -> app starts graceful shutdown
  -> readiness becomes false
  -> service endpoints removed
  -> load balancer stops sending new traffic
  -> in-flight requests complete
  -> app exits before terminationGracePeriodSeconds
```

Masalah umum:

- readiness masih true saat shutdown,
- app langsung exit tanpa drain,
- WebSocket connections diputus brutal,
- long request lebih lama dari grace period,
- preStop hook tidur tapi app masih menerima traffic,
- background executor tidak shutdown,
- database connection pool ditutup saat request masih jalan.

Top-tier engineer mendesain shutdown sebagai lifecycle, bukan berharap orchestrator selalu benar.

---

## 30. Observability Container-Level

Application log saja tidak cukup.

Minimal container-level signals:

| Signal | Kenapa penting |
|---|---|
| access log | melihat request masuk/keluar di boundary HTTP |
| status distribution | 2xx/3xx/4xx/5xx trend |
| request duration | latency sebelum framework metrics kadang hilang |
| active threads | worker saturation |
| busy threads | bottleneck request processing |
| connection count | keep-alive/WebSocket/load profile |
| queue/backlog | admission pressure |
| session count | memory/state pressure |
| error dispatch count | failure mapping |
| async timeout count | async lifecycle issue |
| WebSocket open/close code | connection health |
| bytes in/out | payload pressure |
| header/body reject count | malformed/oversized traffic |

Thread dump juga sangat berharga.

Contoh interpretasi:

```text
Many worker threads WAITING on HikariPool.getConnection()
  -> not a servlet thread problem first
  -> DB pool/downstream latency problem

Many threads BLOCKED on same synchronized lock
  -> application contention

Many threads in socketRead to downstream service
  -> HTTP client timeout/downstream issue

Few busy threads but many connections
  -> keep-alive/WebSocket/idle connection profile
```

---

## 31. Container Architecture Failure Model

Berikut failure surface utama di servlet container architecture.

### 31.1 Startup/deployment failures

| Failure | Penyebab umum |
|---|---|
| app gagal deploy | dependency mismatch, annotation scan error, invalid web.xml |
| `ClassNotFoundException` | library tidak ada/scope salah |
| `NoSuchMethodError` | versi library konflik |
| duplicate mapping | annotation + web.xml bentrok |
| Jakarta/Javax mismatch | container Jakarta menjalankan app javax atau sebaliknya |
| port bind failure | port sudah dipakai |

### 31.2 Request admission failures

| Failure | Penyebab umum |
|---|---|
| 400 | invalid HTTP/header terlalu besar |
| 404 | context/mapping salah |
| 405 | method tidak didukung servlet/framework |
| 413 | body terlalu besar |
| 431 | header/cookie terlalu besar |
| 503 | app unavailable/worker exhausted |
| 504 | proxy timeout |

### 31.3 Runtime processing failures

| Failure | Penyebab umum |
|---|---|
| response committed | output sudah flush sebelum error handling |
| broken pipe | client/proxy menutup koneksi |
| connection reset | network/proxy/client abort |
| thread pool exhaustion | latency/downstream/blocking naik |
| session inconsistency | sticky/replication/external store issue |
| body unreadable | filter sudah consume stream |
| memory leak | session bloat/classloader/thread leak |

### 31.4 Shutdown/redeploy failures

| Failure | Penyebab umum |
|---|---|
| request abruptly terminated | no graceful drain |
| stale thread running | executor tidak shutdown |
| metaspace growth | classloader leak |
| old JDBC driver retained | driver tidak deregister |
| scheduled job duplicate | old app belum mati bersih |

---

## 32. Practical Debugging Framework

Saat ada masalah produksi, gunakan pertanyaan berurutan.

### 32.1 Apakah request sampai ke container?

Cek:

- load balancer access log,
- proxy access log,
- container access log,
- app log correlation ID.

Jika ada di proxy tapi tidak ada di container:

```text
problem likely between proxy and container:
- upstream config
- service discovery
- pod readiness
- network policy
- port mismatch
- TLS mismatch
```

### 32.2 Apakah container menemukan context?

Gejala:

- 404 dari container default page,
- access log ada tapi app log tidak ada,
- context path salah,
- deployment belum started.

### 32.3 Apakah filter chain berjalan?

Gejala:

- correlation ID tidak muncul,
- auth filter tidak jalan,
- body hilang,
- CORS header tidak keluar,
- request berhenti sebelum controller.

### 32.4 Apakah servlet/framework menerima request?

Cek:

- framework access/interceptor log,
- controller mapping log,
- exception resolver,
- dispatch type.

### 32.5 Apakah response sudah committed?

Cek:

- partial response,
- streaming,
- flush,
- writer/outputstream usage,
- exception setelah body ditulis.

### 32.6 Apakah bottleneck ada di worker atau downstream?

Cek:

- busy threads,
- thread dump,
- DB pool metrics,
- HTTP client pool metrics,
- CPU,
- GC pause,
- queue length,
- downstream latency.

---

## 33. Capacity Mental Model

Untuk servlet container, kapasitas bukan hanya angka max thread.

Gunakan model:

```text
Capacity = min(
  network accept capacity,
  protocol parsing capacity,
  worker execution capacity,
  CPU capacity,
  memory capacity,
  DB connection capacity,
  external service capacity,
  lock/contention capacity,
  response egress capacity
)
```

### 33.1 Request classes

Tidak semua request sama.

| Request type | Resource dominan |
|---|---|
| static asset | network/file/cache |
| JSON read small | CPU + DB read |
| report generation | DB + CPU + memory |
| file upload | network + disk/temp + validation |
| file download | disk/object storage + network |
| SSE | connection + async state |
| WebSocket | long-lived connection + memory + heartbeat |
| login callback | session + security + redirect correctness |

Capacity planning harus per request class.

### 33.2 Queue discipline

Kalau semua request boleh masuk tanpa kontrol, overload menjadi tidak terkendali.

Lebih baik punya admission control:

- limit request body,
- limit concurrency endpoint berat,
- timeout downstream,
- rate limit,
- circuit breaker,
- bulkhead,
- bounded executor,
- backpressure,
- fail fast dengan 503/429 yang jelas.

Container memberi beberapa gate, aplikasi perlu melengkapi gate domain-specific.

---

## 34. Security Boundary pada Container Architecture

Walaupun security detail dibahas di seri lain, container architecture punya security surface sendiri.

Contoh:

- trust terhadap forwarded header,
- host header injection,
- request smuggling jika proxy/container interpretasi HTTP berbeda,
- oversized header/cookie DoS,
- path normalization issue,
- encoded slash behavior,
- session cookie attributes,
- default error page membocorkan info,
- directory listing/static resource exposure,
- insecure management endpoint,
- WebSocket origin validation,
- TLS termination mismatch.

Top-tier engineer tidak hanya bertanya “apakah endpoint pakai auth?”, tetapi juga:

```text
Apakah semua layer sepakat tentang host, scheme, path, body length, timeout, dan identity?
```

---

## 35. Design Checklist: Saat Mendesain Java Web Runtime

Gunakan checklist ini untuk aplikasi servlet/container-based.

### 35.1 Topology

- Apakah aplikasi direct-facing atau behind proxy/LB?
- Apakah TLS terminate di proxy atau container?
- Apakah context path root atau prefix?
- Apakah ada path rewrite?
- Apakah forwarded headers dipercaya secara aman?

### 35.2 Deployment

- WAR external, executable JAR, atau full app server?
- Siapa owner versi container?
- Bagaimana patching runtime?
- Bagaimana config injection?
- Bagaimana rollback?

### 35.3 Request processing

- Berapa max request body?
- Berapa max header/cookie?
- Apa timeout app/proxy/downstream?
- Apakah endpoint berat punya concurrency limit?
- Apakah response streaming butuh special handling?

### 35.4 Threading/capacity

- Berapa max worker?
- Berapa DB pool?
- Berapa HTTP client pool?
- Apakah ada blocking call lama?
- Apakah virtual threads relevan?
- Apakah executor bounded?

### 35.5 State

- Apakah memakai `HttpSession`?
- Apakah sticky session diperlukan?
- Apakah session serializable?
- Apakah session terlalu besar?
- Bagaimana logout/invalidation?

### 35.6 Lifecycle

- Startup dependency apa saja?
- Readiness menunggu apa?
- Shutdown drain bagaimana?
- Executor/background job dimatikan bagaimana?
- WebSocket/long request ditutup bagaimana?

### 35.7 Observability

- Access log aktif?
- Correlation ID masuk access + app log?
- Thread pool metrics ada?
- Active connection/session metrics ada?
- Error dispatch terlihat?
- WebSocket close code terlihat?
- Timeout bisa dibedakan layer-nya?

---

## 36. Worked Example: Membaca Satu Request Secara End-to-End

Misalnya request:

```http
GET /aceas/api/cases/123 HTTP/1.1
Host: eservice.example.gov
X-Forwarded-Proto: https
X-Forwarded-For: 203.0.113.10
Cookie: JSESSIONID=abc123
Accept: application/json
```

Topology:

```text
Browser
  -> ALB
  -> Ingress Nginx
  -> Spring Boot app with embedded Tomcat
```

End-to-end:

```text
1. Browser connects to ALB over HTTPS.
2. ALB terminates or forwards TLS depending config.
3. Ingress receives request and forwards to pod.
4. Tomcat connector accepts HTTP request on app port.
5. Connector parses request line and headers.
6. Tomcat creates internal request/response objects.
7. Host is resolved from Host header or connector default.
8. Context path /aceas is matched.
9. Filter chain is built for /api/cases/123.
10. Correlation filter attaches request ID.
11. Security/session filter reads JSESSIONID and resolves session.
12. DispatcherServlet is selected by mapping, often `/`.
13. Spring routing maps to CaseController.getCase(123).
14. Controller calls service/repository/downstream.
15. Response body serialized to JSON.
16. Headers/status are set.
17. Response buffer commits.
18. Connector writes bytes to socket.
19. Proxy forwards response to browser.
20. Connection may be reused via keep-alive.
```

Jika user mendapatkan 504, root cause bisa di banyak tempat:

```text
- controller slow
- DB slow
- HTTP client dependency slow
- worker thread queued too long
- ingress upstream timeout too short
- ALB idle timeout
- pod terminating mid-request
- response streaming stalled
```

Tanpa container mental model, engineer hanya melihat controller dan kehilangan sebagian besar failure surface.

---

## 37. Anti-Patterns

### 37.1 Treating servlet container as invisible

Gejala:

- semua masalah dianggap bug framework,
- tidak tahu access log,
- tidak tahu connector timeout,
- tidak tahu context path,
- tidak tahu thread pool.

Konsekuensi:

- debugging lambat,
- capacity tuning salah,
- incident RCA dangkal.

### 37.2 Increasing maxThreads blindly

Menaikkan thread tanpa melihat DB/downstream dapat membuat sistem makin buruk.

```text
More threads can mean more blocked work, more memory, more contention, and faster collapse.
```

### 37.3 Storing request state in servlet fields

Servlet instance shared antar request. Field mutable adalah bug concurrency kecuali didesain thread-safe.

### 37.4 Startup does too much blocking work

Listener/init yang melakukan heavy external call dapat membuat deployment rapuh.

Lebih baik pisahkan:

- mandatory config validation,
- readiness-dependent dependency check,
- async warming,
- fail-fast untuk dependency yang benar-benar wajib.

### 37.5 Ignoring proxy/container timeout alignment

Timeout mismatch menyebabkan ghost work: client sudah menerima timeout, server masih bekerja.

### 37.6 Assuming WebSocket behaves like HTTP request

WebSocket adalah long-lived connection. Ia butuh lifecycle, heartbeat, drain, backpressure, dan reconnect design.

---

## 38. What Top 1% Engineers Understand About Servlet Containers

Engineer biasa tahu:

```text
Controller menerima request.
```

Engineer kuat tahu:

```text
Servlet container memanggil framework servlet setelah melewati connector, context mapping, filter chain, session resolution, thread dispatch, dan lifecycle rules.
```

Engineer top-tier tahu:

```text
Every production behavior is an interaction among protocol semantics, container lifecycle, thread admission, proxy topology, application state, downstream capacity, and failure handling.
```

Mereka tidak hanya bertanya:

```text
Endpoint mana yang error?
```

Mereka bertanya:

```text
Apakah request sampai ke container?
Apakah context dipilih benar?
Apakah filter chain lengkap?
Apakah worker tersedia?
Apakah response sudah committed?
Apakah proxy timeout lebih dulu?
Apakah session state valid di node ini?
Apakah shutdown/redeploy sedang terjadi?
Apakah WebSocket connection masuk drain path?
```

---

## 39. Ringkasan

Servlet container adalah runtime boundary yang menghubungkan dunia network/protocol dengan object Java.

Hal penting dari Part 003:

1. Servlet container bukan sekadar tempat controller berjalan.
2. Connector menerima koneksi dan menerjemahkan bytes menjadi request/response object.
3. Container memilih host, context, filter chain, dan servlet sebelum framework routing berjalan.
4. Servlet, filter, listener, session, request, response, context punya lifecycle berbeda.
5. Threading/capacity harus dilihat sebagai rantai bottleneck, bukan hanya `maxThreads`.
6. Embedded server tetap servlet container; hanya packaging dan lifecycle ownership yang berubah.
7. Full application server adalah servlet container plus enterprise service runtime.
8. Reverse proxy/load balancer adalah bagian dari web runtime nyata, bukan detail ops terpisah.
9. Banyak error HTTP/production terjadi sebelum kode controller dipanggil.
10. Engineer top-tier melihat request sebagai state machine dan failure surface lintas layer.

---

## 40. Latihan Mental Model

Jawab pertanyaan ini sebelum lanjut:

1. Jika access log container tidak mencatat request, layer mana saja yang harus dicek?
2. Jika framework controller tidak terpanggil tapi container access log ada, kemungkinan masalahnya di mana?
3. Jika banyak worker thread menunggu DB connection, apakah menaikkan maxThreads membantu?
4. Apa perbedaan context path dan servlet path?
5. Kenapa servlet instance field berbahaya untuk menyimpan request-specific state?
6. Apa bedanya external WAR deployment dan embedded JAR deployment dari sisi ownership runtime?
7. Kenapa 504 dari proxy belum tentu berarti aplikasi mati?
8. Apa yang harus terjadi saat graceful shutdown agar request tidak putus brutal?
9. Kenapa WebSocket membutuhkan desain drain berbeda dari HTTP request biasa?
10. Apa saja metric container-level yang perlu ada selain application log?

---

## 41. Preview Part 004

Part berikutnya akan masuk ke **Servlet Lifecycle Deep Dive**.

Kita akan membahas:

- `Servlet` interface,
- `GenericServlet`,
- `HttpServlet`,
- `init`, `service`, `destroy`,
- `doGet`, `doPost`, `doPut`, `doDelete`, `doOptions`, `doHead`,
- load-on-startup,
- lazy servlet initialization,
- servlet instance concurrency,
- thread-safety rules,
- lifecycle failure,
- init parameter vs context parameter,
- kenapa servlet harus dipahami sebagai container-owned singleton-ish component.

---

## References

- Jakarta Servlet 6.1 Specification: https://jakarta.ee/specifications/servlet/6.1/jakarta-servlet-spec-6.1
- Jakarta Servlet 6.1 Release Page: https://jakarta.ee/specifications/servlet/6.1/
- Apache Tomcat 11 Documentation Index: https://tomcat.apache.org/tomcat-11.0-doc/index.html
- Apache Tomcat 11 Architecture Overview: https://tomcat.apache.org/tomcat-11.0-doc/architecture/overview.html
- Apache Tomcat 11 Configuration Reference: https://tomcat.apache.org/tomcat-11.0-doc/config/index.html
- Apache Tomcat Servlet 6.1 API Documentation: https://tomcat.apache.org/tomcat-11.0-doc/servletapi/index.html
- Eclipse Jetty 12.1 Documentation: https://jetty.org/docs/jetty/12.1/index.html
- Eclipse Jetty Threading Architecture: https://jetty.org/docs/jetty/12.1/programming-guide/arch/threads.html
- Eclipse Jetty Operations Guide — Server/Thread Pooling: https://jetty.org/docs/jetty/12.1/operations-guide/server/index.html
- WildFly Undertow Subsystem Model Reference: https://docs.wildfly.org/25/wildscribe/subsystem/undertow/servlet-container/index.html
- Red Hat JBoss EAP Undertow Configuration Guide: https://docs.redhat.com/en/documentation/red_hat_jboss_enterprise_application_platform/7.0/html/configuration_guide/configuring_the_web_server_undertow

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 002 — HTTP Fundamentals for Servlet Engineers](./learn-java-servlet-websocket-web-container-runtime-part-002.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 004 — Servlet Lifecycle Deep Dive](./learn-java-servlet-websocket-web-container-runtime-part-004.md)
