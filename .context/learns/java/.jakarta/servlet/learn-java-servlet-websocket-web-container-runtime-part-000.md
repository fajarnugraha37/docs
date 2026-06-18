# learn-java-servlet-websocket-web-container-runtime — Part 000

# Orientation: Mental Model Server-Side Java Web Runtime

> Seri: `learn-java-servlet-websocket-web-container-runtime`  
> Part: `000`  
> Topik: Orientasi besar, mental model, batas pembahasan, dan cara berpikir engineer tingkat lanjut terhadap Servlet, WebSocket, dan web-container runtime.  
> Rentang Java: Java 8 sampai Java 25  
> Namespace: legacy `javax.*` dan modern `jakarta.*`

---

## 0. Tujuan Part Ini

Part ini belum masuk terlalu dalam ke API seperti `HttpServletRequest`, `Filter`, `AsyncContext`, atau `@ServerEndpoint`. Part ini bertugas membangun **peta mental** terlebih dahulu.

Banyak engineer belajar Java web dari atas:

```text
Controller -> Service -> Repository -> Database
```

Itu berguna, tapi tidak cukup untuk level senior/architectural. Di production, banyak masalah tidak terjadi di controller. Masalah sering muncul di batas-batas berikut:

```text
Browser / Client
  -> DNS / CDN / WAF
  -> Reverse Proxy / Load Balancer
  -> TCP/TLS/HTTP connection
  -> Servlet Connector
  -> Container routing
  -> Filter chain
  -> Servlet / Framework dispatcher
  -> Application handler
  -> Downstream dependency
  -> Response write
  -> Connection reuse / close
```

Untuk WebSocket, alurnya lebih panjang umur:

```text
HTTP request
  -> Upgrade handshake
  -> WebSocket session open
  -> message receive/send loop
  -> heartbeat / idle timeout
  -> network failure / close frame / reconnect
```

Target part ini adalah membuat kamu melihat Java web runtime sebagai **sistem lifecycle, concurrency, protocol, resource, dan failure boundary**, bukan sekadar tempat menaruh endpoint.

Setelah part ini, kamu harus bisa menjawab pertanyaan seperti:

1. Apa perbedaan framework, servlet API, servlet container, embedded server, dan application server?
2. Kenapa servlet tetap penting walaupun kita memakai Spring MVC, JAX-RS, JSF, atau framework lain?
3. Kenapa WebSocket bukan sekadar “HTTP yang live”?
4. Di mana request berubah dari bytes menjadi object Java?
5. Di mana thread dialokasikan?
6. Kapan response dianggap committed?
7. Kenapa timeout 504 sering bukan bug controller?
8. Kenapa session, cookie, proxy, dan context path bisa menjadi sumber bug serius?
9. Kenapa graceful shutdown untuk HTTP biasa berbeda dari WebSocket?
10. Bagaimana cara berpikir top-tier engineer saat mendesain runtime web application?

---

## 1. Posisi Servlet dan WebSocket dalam Ekosistem Java

### 1.1 Servlet sebagai kontrak paling dasar untuk Java HTTP server-side

Servlet adalah standard API Java untuk menangani request dan response berbasis HTTP di server-side web application.

Dalam aplikasi modern, kamu mungkin jarang menulis class seperti ini secara langsung:

```java
import jakarta.servlet.http.HttpServlet;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

public class HelloServlet extends HttpServlet {
    @Override
    protected void doGet(HttpServletRequest request, HttpServletResponse response) throws IOException {
        response.setContentType("text/plain");
        response.getWriter().write("Hello");
    }
}
```

Namun framework seperti Spring MVC, Jersey/JAX-RS implementation, JSF/Jakarta Faces, Vaadin, Wicket, Struts, dan banyak teknologi Java web lain berjalan di atas konsep yang sama:

```text
HTTP request masuk
  -> container memilih web application
  -> container menjalankan filter chain
  -> container memanggil servlet tertentu
  -> framework dispatcher memetakan request ke handler/controller/resource
  -> response ditulis ke HttpServletResponse
```

Contoh pada Spring MVC:

```text
Client request
  -> Tomcat/Jetty/Undertow connector
  -> Servlet filter chain
  -> DispatcherServlet
  -> HandlerMapping
  -> Controller method
  -> View/ResponseBody handling
  -> HttpServletResponse
```

Contoh pada JAX-RS:

```text
Client request
  -> Servlet container
  -> JAX-RS servlet/filter integration
  -> Resource matching
  -> Resource method
  -> MessageBodyWriter
  -> HttpServletResponse
```

Jadi ketika kamu memahami Servlet, kamu memahami lapisan bawah yang menjelaskan banyak perilaku framework.

**Mental model penting:**

```text
Framework route terjadi setelah container route.
Framework security/filter terjadi setelah atau di dalam Servlet filter chain.
Framework exception handling terjadi sebelum response benar-benar selesai ditulis.
Framework async/reactive tetap harus berdamai dengan container, socket, timeout, dan response lifecycle.
```

---

### 1.2 WebSocket sebagai API untuk koneksi long-lived full-duplex

HTTP request/response biasa memiliki pola:

```text
request -> response -> selesai
```

WebSocket memiliki pola:

```text
HTTP handshake -> upgrade -> koneksi tetap hidup -> banyak message dua arah -> close
```

Servlet menangani request/response HTTP. Jakarta WebSocket menyediakan API server dan client endpoint untuk WebSocket protocol.

Contoh endpoint sederhana:

```java
import jakarta.websocket.OnMessage;
import jakarta.websocket.server.ServerEndpoint;

@ServerEndpoint("/ws/echo")
public class EchoEndpoint {
    @OnMessage
    public String echo(String message) {
        return message;
    }
}
```

Tapi secara production, WebSocket bukan hanya `@OnMessage`.

WebSocket berarti kamu harus memikirkan:

- open connection registry,
- user-to-session mapping,
- heartbeat,
- idle timeout,
- slow consumer,
- reconnect,
- duplicate connection,
- load balancer affinity,
- node-local state,
- clustered fan-out,
- backpressure,
- message ordering,
- delivery guarantee,
- close code,
- graceful shutdown.

**Mental model penting:**

```text
Servlet endpoint adalah event pendek.
WebSocket endpoint adalah lifecycle panjang.
```

HTTP biasa gagal sebagai satu transaksi. WebSocket gagal sebagai hubungan yang bisa setengah mati, idle, putus diam-diam, reconnect, atau pindah node.

---

## 2. Kenapa Seri Ini Penting untuk Engineer Level Tinggi

Engineer biasa sering bertanya:

```text
Bagaimana cara membuat endpoint?
```

Engineer kuat bertanya:

```text
Apa lifecycle endpoint ini?
Apa invariant-nya?
Apa timeout-nya?
Apa resource yang ditahan?
Apa yang terjadi saat client disconnect?
Apa yang terjadi saat node rolling restart?
Apa yang terjadi saat proxy timeout lebih pendek dari app timeout?
Apa yang terjadi saat response sudah committed lalu exception terjadi?
Apa yang terjadi saat filter membaca request body sebelum controller?
Apa yang terjadi saat 1 user membuka 8 tab WebSocket?
```

Top-tier engineer tidak hanya tahu API. Ia tahu **konsekuensi operasional dari API**.

Servlet dan WebSocket adalah area yang sering dianggap “lama”, padahal justru di sinilah banyak failure production modern terjadi:

- 504 Gateway Timeout padahal aplikasi “tidak error”.
- Redirect loop karena scheme salah di balik TLS offload.
- Cookie tidak terhapus karena path/domain tidak sama.
- Session hilang setelah rolling deployment karena sticky session tidak aktif.
- Memory leak setelah redeploy karena static executor tidak dimatikan.
- Request body hilang karena filter sudah membaca input stream.
- Response tidak bisa diubah karena sudah committed.
- WebSocket mati tiap 60 detik karena load balancer idle timeout.
- Reconnect storm setelah deploy.
- Thread pool penuh karena blocking downstream call.
- Virtual thread membantu request concurrency tapi tidak menyelesaikan DB connection pool bottleneck.

Part ini akan membangun bahasa dan peta mental untuk membaca semua part berikutnya.

---

## 3. Layering Besar Java Web Runtime

Bayangkan sebuah request masuk dari browser ke aplikasi Java.

```text
[1] Browser / HTTP client
      |
[2] DNS / CDN / WAF
      |
[3] Reverse Proxy / API Gateway / Load Balancer
      |
[4] TCP/TLS connection to server/pod/node
      |
[5] Servlet container connector
      |
[6] Web application selection
      |
[7] Servlet routing and filter chain
      |
[8] Framework dispatcher / servlet
      |
[9] Application logic
      |
[10] Downstream systems
      |
[11] Response serialization/write
      |
[12] Proxy/client receive response
```

Mari uraikan satu per satu.

---

### 3.1 Browser / HTTP client

Client bukan hanya browser. Client bisa berupa:

- browser,
- mobile app,
- backend service,
- API gateway,
- scheduled job,
- integration partner,
- synthetic monitoring,
- load test tool,
- WebSocket client,
- reverse proxy health checker.

Client menentukan banyak hal:

- method,
- URL,
- headers,
- cookies,
- body,
- timeout,
- retry behavior,
- connection reuse,
- compression support,
- WebSocket support,
- TLS behavior.

Bug sering muncul karena asumsi server terhadap client tidak benar.

Contoh:

```text
Server menganggap request selalu punya Content-Type: application/json.
Client mengirim Content-Type: text/plain.
Framework gagal parse body.
```

Atau:

```text
Server menganggap browser akan selalu kirim cookie.
SameSite policy membuat cookie tidak dikirim pada flow cross-site.
Login/SSO rusak.
```

---

### 3.2 DNS / CDN / WAF

Sebelum request mencapai Java, bisa ada layer:

- DNS,
- CDN,
- WAF,
- DDoS protection,
- API protection,
- bot protection.

Layer ini bisa:

- terminate TLS,
- block request,
- rewrite header,
- add trace header,
- cache response,
- limit body size,
- enforce rate limit,
- challenge browser,
- reject suspicious payload.

Dari sisi aplikasi Java, request bisa tidak pernah sampai. Ini penting saat mendiagnosis:

```text
Client bilang API error.
Aplikasi tidak punya log request.
Kemungkinan request berhenti sebelum container.
```

Top-tier diagnosis tidak langsung membuka controller. Ia bertanya:

```text
Apakah request mencapai access log container?
Apakah mencapai reverse proxy log?
Apakah WAF meng-block?
Apakah DNS mengarah ke endpoint yang benar?
Apakah TLS handshake sukses?
```

---

### 3.3 Reverse proxy / load balancer

Layer ini sangat penting dalam production modern.

Contoh:

- Nginx,
- Apache HTTPD,
- HAProxy,
- Envoy,
- Traefik,
- AWS ALB,
- AWS NLB,
- API Gateway,
- Kubernetes Ingress Controller,
- service mesh sidecar.

Proxy/load balancer bisa melakukan:

- TLS termination,
- routing host/path,
- health check,
- connection pooling ke backend,
- buffering request/response,
- compression,
- timeout enforcement,
- header injection,
- WebSocket upgrade forwarding,
- sticky session,
- circuit breaking,
- retry,
- body size limit.

Contoh bug klasik:

```text
Client -> https://app.example.com
ALB terminates TLS
ALB -> http://pod:8080
Servlet container melihat scheme = http
Application membuat redirect ke http://app.example.com/login
Browser redirect dari https ke http atau terjadi loop
```

Solusi bukan di controller, tapi di forwarded headers:

```text
X-Forwarded-Proto: https
X-Forwarded-Host: app.example.com
Forwarded: proto=https;host=app.example.com
```

Aplikasi/container harus dikonfigurasi agar percaya pada header tersebut dari proxy yang trusted.

---

### 3.4 TCP/TLS connection

HTTP berjalan di atas koneksi network. Ini menciptakan failure yang tidak terlihat di code business logic:

- client disconnect,
- broken pipe,
- connection reset,
- TLS handshake failure,
- idle timeout,
- keep-alive reuse issue,
- slow client,
- packet loss,
- half-open connection.

Servlet API membuat request terlihat seperti object Java, tapi object itu berasal dari stream network.

Jika client menutup browser saat file sedang di-download, aplikasi mungkin melihat:

```text
java.io.IOException: Broken pipe
java.io.IOException: Connection reset by peer
ClientAbortException
```

Itu tidak selalu bug aplikasi. Bisa jadi client memang pergi.

**Mental model:**

```text
HttpServletResponse bukan StringBuilder.
Itu abstraction di atas network socket yang bisa gagal saat ditulis.
```

---

### 3.5 Servlet container connector

Connector adalah bagian container yang menerima koneksi network dan menerjemahkan bytes HTTP menjadi request yang bisa diproses.

Pada Tomcat misalnya, connector mengatur hal seperti:

- port,
- protocol,
- max threads,
- max connections,
- accept count,
- connection timeout,
- keep-alive timeout,
- max header size,
- body size behavior,
- HTTP/2 support,
- SSL/TLS bila terminasi di container.

Secara mental:

```text
Connector = pintu network container.
```

Jika connector penuh, controller bahkan belum dipanggil.

Misalnya:

```text
maxThreads = 200
Semua worker thread sedang blocking ke downstream 30 detik
Request baru masuk
Request menunggu di queue/accept backlog
Proxy timeout 30 detik
Client melihat 504
Application mungkin tidak log error apapun
```

---

### 3.6 Web application selection

Satu servlet container bisa menjalankan banyak web application.

Contoh:

```text
https://example.com/aceas
https://example.com/cpds
https://example.com/admin
```

Container perlu memilih web application berdasarkan context path:

```text
/aceas -> ACEAS web app
/cpds  -> CPDS web app
/admin -> admin web app
```

Jika context path salah, request bisa:

- masuk ke app yang salah,
- jatuh ke default app,
- menghasilkan 404 dari container,
- menghasilkan 404 dari framework,
- menghasilkan redirect path yang salah.

404 tidak selalu sama.

```text
404 dari proxy: route tidak sampai container.
404 dari container: context/servlet mapping tidak cocok.
404 dari framework: servlet cocok, tapi controller/resource tidak cocok.
404 dari application: business object tidak ditemukan.
```

Top-tier engineer membedakan lapisan 404.

---

### 3.7 Servlet routing and filter chain

Setelah web application dipilih, container menentukan servlet/filter mana yang cocok.

Sebelum servlet dipanggil, filter chain berjalan.

```text
Request
  -> Filter A
  -> Filter B
  -> Filter C
  -> Servlet
  -> Filter C after-chain
  -> Filter B after-chain
  -> Filter A after-chain
  -> Response
```

Filter adalah boundary kuat untuk concern seperti:

- correlation ID,
- logging,
- CORS,
- compression,
- auth pre-processing,
- body wrapping,
- request normalization,
- rate limiting,
- tenant resolution,
- proxy header handling,
- audit boundary.

Tapi filter juga sumber bug besar:

```java
public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain) {
    // BUG: membaca body tanpa wrapper
    String body = new String(req.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
    chain.doFilter(req, res);
}
```

Setelah input stream dibaca, controller/framework mungkin tidak bisa membaca body lagi.

**Mental model:**

```text
Filter berada sebelum framework.
Filter bisa mengubah realitas yang dilihat framework.
```

---

### 3.8 Framework dispatcher / servlet

Framework Java web biasanya memiliki satu atau beberapa entrypoint servlet/filter.

Contoh:

```text
Spring MVC -> DispatcherServlet
Jersey     -> ServletContainer
JSF        -> FacesServlet
```

Dari sudut pandang container, framework hanyalah servlet/filter yang menerima request.

Dari sudut pandang developer, framework tampak seperti dunia utama.

Masalahnya, ketika terjadi issue production, kamu perlu tahu apakah problem berada:

```text
sebelum framework
  atau
saat framework routing
  atau
setelah handler dipanggil
  atau
saat response ditulis
```

Contoh:

```text
Request tidak masuk controller.
Mungkin:
- proxy route salah,
- context path salah,
- servlet mapping salah,
- filter menghentikan chain,
- CORS preflight gagal,
- method OPTIONS tidak ditangani,
- body terlalu besar ditolak container,
- authentication filter redirect duluan.
```

---

### 3.9 Application logic

Application logic adalah bagian yang paling sering dibahas dalam tutorial:

```text
Controller/Resource
  -> Service
  -> Domain logic
  -> Repository/Client
```

Seri ini tidak akan mengulang detail service/repository karena sudah dibahas di seri lain. Yang penting untuk Servlet/WebSocket runtime adalah bagaimana application logic memengaruhi runtime:

- blocking call menahan request thread,
- long transaction memperpanjang response time,
- large object serialization menahan memory,
- streaming response mengubah commit behavior,
- exception setelah response committed tidak bisa mengubah status code,
- thread-local context harus dibersihkan,
- session mutation bisa race pada parallel request,
- async callback bisa kehilangan request context,
- virtual thread bisa memperbesar concurrency tapi bottleneck downstream tetap ada.

---

### 3.10 Downstream systems

Aplikasi Java web hampir selalu memanggil downstream:

- database,
- Redis,
- RabbitMQ,
- Kafka,
- external HTTP API,
- S3/object storage,
- file system,
- identity provider,
- email service,
- document generator,
- search engine.

Dari sisi Servlet runtime, downstream menentukan service time.

Jika request thread menunggu database 20 detik, thread itu tidak bisa melayani request lain.

```text
Concurrency ≈ arrival_rate × service_time
```

Jika 50 request/detik dan rata-rata request berjalan 2 detik:

```text
concurrency ≈ 50 × 2 = 100 active requests
```

Jika downstream melambat menjadi 10 detik:

```text
concurrency ≈ 50 × 10 = 500 active requests
```

Thread pool, queue, memory, timeout, dan connection pool mulai tertekan.

**Mental model:**

```text
Servlet performance bukan hanya CPU Java.
Servlet performance adalah komposisi thread, queue, downstream latency, timeout, payload size, dan client behavior.
```

---

### 3.11 Response serialization/write

Setelah application logic selesai, response belum tentu selesai.

Response masih perlu:

- status code ditentukan,
- header ditulis,
- body diserialisasi,
- buffer di-flush,
- compression mungkin dilakukan,
- bytes dikirim ke socket,
- proxy meneruskan ke client,
- client membaca.

Di sinilah muncul isu:

- response already committed,
- broken pipe,
- slow client,
- serialization error,
- output stream closed,
- wrong content length,
- wrong content type,
- character encoding salah,
- partial response.

Jika body sudah mulai dikirim, kamu tidak bisa tiba-tiba mengubah status menjadi 500 secara reliable.

```text
Sebelum commit: status/header masih bisa berubah.
Setelah commit: status/header sudah keluar ke client.
```

Ini sangat penting untuk error handling.

---

## 4. Istilah-Istilah yang Harus Dibedakan

Bagian ini penting karena banyak diskusi Java web kacau karena istilah bercampur.

---

### 4.1 Servlet API

Servlet API adalah kontrak standard.

Contoh package:

```text
javax.servlet.*        // legacy Java EE / Jakarta EE 8 era
jakarta.servlet.*      // Jakarta EE 9+
```

Contoh class/interface:

```text
Servlet
GenericServlet
HttpServlet
ServletRequest
ServletResponse
HttpServletRequest
HttpServletResponse
Filter
FilterChain
ServletContext
RequestDispatcher
AsyncContext
ServletInputStream
ServletOutputStream
```

API ini tidak menerima koneksi sendiri. Ia butuh implementation/container.

---

### 4.2 Servlet container

Servlet container adalah runtime yang mengimplementasikan Servlet API.

Contoh:

- Apache Tomcat,
- Jetty,
- Undertow,
- servlet engine di GlassFish/Payara,
- servlet engine di WildFly,
- servlet engine di Open Liberty.

Container bertanggung jawab atas:

- network connector,
- request parsing,
- response writing,
- servlet lifecycle,
- filter lifecycle,
- listener lifecycle,
- session management,
- dispatching,
- async lifecycle,
- classloading,
- deployment,
- static resource handling,
- error page handling,
- WebSocket integration, bila didukung.

---

### 4.3 Web framework

Web framework menggunakan Servlet API untuk menyediakan developer model yang lebih tinggi.

Contoh:

- Spring MVC,
- JAX-RS implementation seperti Jersey/RESTEasy,
- Jakarta Faces,
- Struts,
- Vaadin,
- Wicket.

Framework menyediakan:

- controller/resource mapping,
- parameter binding,
- validation integration,
- exception mapper,
- response serialization,
- view rendering,
- middleware abstraction,
- dependency injection integration,
- security integration.

Tapi framework tidak menghapus kenyataan Servlet runtime di bawahnya.

---

### 4.4 Embedded server

Embedded server berarti container dijalankan sebagai bagian dari aplikasi.

Contoh Spring Boot embedded Tomcat:

```text
java -jar app.jar
  -> main method
  -> Spring Boot starts embedded Tomcat
  -> Tomcat listens on port 8080
```

Ini berbeda dari external container:

```text
Tomcat already running
  -> deploy app.war into webapps/
```

Embedded server memberi kontrol deployment yang lebih sederhana untuk cloud/container environment, tapi tetap memakai konsep Servlet container.

---

### 4.5 Application server

Application server lebih luas dari servlet container.

Servlet container fokus pada web/HTTP/Servlet.

Full Jakarta EE application server dapat menyediakan banyak specification:

- Servlet,
- WebSocket,
- CDI,
- JPA,
- Transactions,
- Messaging,
- Security,
- Bean Validation,
- JSON-B/P,
- Mail,
- RESTful Web Services,
- dan lain-lain.

Contoh:

- GlassFish,
- Payara,
- WildFly,
- Open Liberty,
- WebSphere Liberty.

**Mental model:**

```text
Servlet container ⊂ Jakarta EE application server
```

Tidak semua servlet container adalah full application server.

---

### 4.6 WAR

WAR adalah packaging format web application tradisional.

Struktur umum:

```text
my-app.war
  WEB-INF/
    web.xml
    classes/
    lib/
  index.jsp
  assets/
```

WAR memberi container informasi:

- servlet,
- filter,
- listener,
- welcome file,
- error page,
- security constraint,
- session config,
- static resources,
- dependencies app-local.

Pada era modern, banyak aplikasi memakai executable JAR, tapi konsep deployment unit tetap penting.

---

### 4.7 Context path

Context path adalah prefix URL untuk satu web application.

Contoh:

```text
https://example.com/aceas/api/cases/123
```

Jika app dideploy di `/aceas`:

```text
context path = /aceas
path inside app = /api/cases/123
```

Kesalahan context path bisa menghasilkan:

- broken redirect,
- broken static asset,
- wrong cookie path,
- wrong API base URL,
- SPA route mismatch,
- reverse proxy route mismatch.

---

## 5. Javax vs Jakarta: Kenapa Ini Penting

### 5.1 Package rename bukan kosmetik

Legacy Java EE memakai:

```java
import javax.servlet.http.HttpServlet;
import javax.websocket.server.ServerEndpoint;
```

Modern Jakarta EE memakai:

```java
import jakarta.servlet.http.HttpServlet;
import jakarta.websocket.server.ServerEndpoint;
```

Perubahan `javax.*` ke `jakarta.*` adalah breaking change di level source dan binary compatibility.

Artinya:

```text
Library yang dikompilasi untuk javax.servlet tidak otomatis kompatibel dengan jakarta.servlet.
```

Ini berdampak pada migration:

- Spring Boot 2.x umumnya masih `javax.*`.
- Spring Boot 3.x pindah ke `jakarta.*`.
- Tomcat 9 untuk `javax.*` Servlet 4.0 era.
- Tomcat 10+ untuk `jakarta.*`.
- Banyak library lama harus di-upgrade.
- Custom filter/servlet/listener perlu import migration.
- WebSocket endpoint juga ikut migration.

---

### 5.2 Dua dunia dependency

Contoh Maven legacy:

```xml
<dependency>
    <groupId>javax.servlet</groupId>
    <artifactId>javax.servlet-api</artifactId>
    <version>4.0.1</version>
    <scope>provided</scope>
</dependency>
```

Contoh Maven modern:

```xml
<dependency>
    <groupId>jakarta.servlet</groupId>
    <artifactId>jakarta.servlet-api</artifactId>
    <version>6.1.0</version>
    <scope>provided</scope>
</dependency>
```

`provided` berarti API tersedia saat compile, tapi implementation disediakan oleh container saat runtime.

Pada embedded server, dependency model berbeda karena container ikut dipaketkan.

---

### 5.3 Seri ini akan menyebut dua namespace bila relevan

Karena target Java 8 sampai Java 25, kita perlu memahami dua dunia:

```text
Legacy stack:
Java 8/11 + Java EE/Jakarta EE 8 + javax.*

Modern stack:
Java 17/21/25 + Jakarta EE 10/11 + jakarta.*
```

Saat konsep sama, seri akan menggunakan istilah umum seperti:

```text
Servlet API
HttpServletRequest
Filter
WebSocket Session
```

Saat migration penting, seri akan eksplisit membedakan:

```text
javax.servlet.Filter
jakarta.servlet.Filter
```

---

## 6. Mental Model Request Lifecycle

Mari mulai dari request HTTP biasa.

### 6.1 Lifecycle sederhana

```text
Client sends HTTP request
  -> server accepts TCP connection
  -> container parses HTTP request
  -> container selects web app by context path
  -> container selects servlet/filter mapping
  -> filter chain runs
  -> servlet/service method runs
  -> application writes response
  -> container commits response
  -> bytes sent to client/proxy
  -> request objects become invalid for normal use
```

Secara kode, developer melihat:

```java
protected void doGet(HttpServletRequest request, HttpServletResponse response) {
    // application logic
}
```

Tapi secara runtime, itu hanya satu titik kecil di tengah lifecycle.

---

### 6.2 Request object bukan domain object

`HttpServletRequest` adalah view terhadap request yang sedang diproses.

Ia membawa:

- method,
- URI,
- query string,
- headers,
- cookies,
- parameters,
- input stream,
- attributes,
- session access,
- async support,
- dispatcher information,
- remote/local network information.

Ia bukan object yang bebas disimpan untuk dipakai nanti.

Anti-pattern:

```java
public class BadService {
    private HttpServletRequest lastRequest;

    public void remember(HttpServletRequest request) {
        this.lastRequest = request; // buruk
    }
}
```

Masalah:

- request object lifecycle dikontrol container,
- object bisa didaur ulang oleh implementation,
- data bisa tidak valid setelah request selesai,
- memory leak,
- thread-safety issue,
- accidental exposure data user lain.

Yang boleh disimpan adalah data yang memang diekstrak dan dimodelkan:

```java
public record RequestContext(
    String correlationId,
    String userId,
    String tenantId,
    String clientIp
) {}
```

---

### 6.3 Response object adalah state machine

`HttpServletResponse` bukan sekadar output object.

Ia punya state:

```text
INITIAL
  -> headers/status can be changed
  -> body can be buffered
  -> commit happens
COMMITTED
  -> status/header effectively sent
  -> body may continue streaming
  -> cannot reliably change response status/header
DONE
  -> response complete or connection closed
```

Commit bisa terjadi karena:

- buffer penuh,
- `flushBuffer()` dipanggil,
- output stream/writer di-flush,
- redirect/error dikirim,
- request selesai dan container flush response,
- streaming response memang memulai write lebih awal.

Contoh bug:

```java
response.getWriter().write("partial data");
response.flushBuffer();

throw new RuntimeException("later failure");
```

Exception handler mungkin ingin mengubah status menjadi 500, tapi response sudah committed. Client bisa menerima partial response, bukan JSON error yang rapi.

---

### 6.4 Request lifecycle sebagai state machine

Untuk berpikir lebih kuat, modelkan request sebagai state machine:

```text
RECEIVED
  -> PARSED
  -> ROUTED_TO_CONTEXT
  -> FILTERING
  -> HANDLING
  -> WRITING_RESPONSE
  -> COMPLETED
```

Failure bisa terjadi di setiap state:

```text
RECEIVED
  -> malformed request / TLS issue / connection reset

PARSED
  -> header too large / unsupported method / invalid encoding

ROUTED_TO_CONTEXT
  -> context not found / wrong host / wrong path

FILTERING
  -> auth rejected / CORS rejected / rate limit / filter bug

HANDLING
  -> application exception / downstream timeout / validation fail

WRITING_RESPONSE
  -> serialization error / broken pipe / response committed

COMPLETED
  -> access log / metrics / cleanup / thread-local cleanup
```

Top-tier engineer menggunakan state ini untuk diagnosis.

---

## 7. Mental Model Filter Chain

Filter chain adalah salah satu konsep paling penting.

### 7.1 Filter sebagai nested boundary

Jika ada tiga filter:

```text
A -> B -> C -> Servlet
```

Eksekusinya sebenarnya nested:

```java
A.before
  B.before
    C.before
      Servlet
    C.after
  B.after
A.after
```

Ini mirip stack.

Artinya filter bisa:

- menjalankan logic sebelum handler,
- menghentikan request sebelum handler,
- membungkus request/response,
- menjalankan cleanup setelah handler,
- menangkap exception dari bawahnya,
- menambahkan header setelah handler selama response belum committed.

---

### 7.2 Filter chain invariant

Filter yang baik menjaga invariant:

```text
1. Memanggil chain tepat sekali, kecuali memang sengaja menghentikan request.
2. Tidak membaca body tanpa menyediakan replay/wrapper bila downstream masih perlu body.
3. Tidak menulis response sebelum yakin request harus berhenti.
4. Membersihkan ThreadLocal/MDC di finally.
5. Tidak menelan exception tanpa observability.
6. Tidak mengubah semantic request secara diam-diam.
```

Contoh pattern correlation ID:

```java
public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
        throws IOException, ServletException {
    HttpServletRequest request = (HttpServletRequest) req;
    HttpServletResponse response = (HttpServletResponse) res;

    String correlationId = Optional
            .ofNullable(request.getHeader("X-Correlation-Id"))
            .filter(s -> !s.isBlank())
            .orElse(UUID.randomUUID().toString());

    try {
        MDC.put("correlationId", correlationId);
        response.setHeader("X-Correlation-Id", correlationId);
        chain.doFilter(req, res);
    } finally {
        MDC.remove("correlationId");
    }
}
```

Poin pentingnya bukan syntax MDC, tapi lifecycle:

```text
Set context sebelum chain.
Pastikan cleanup setelah chain, apa pun hasilnya.
```

---

## 8. Mental Model Session dan Cookie

### 8.1 HTTP stateless, session memberi state illusion

HTTP secara dasar tidak menyimpan state antar request.

Session membuat ilusi:

```text
Request 1 -> login -> session created
Request 2 -> browser sends JSESSIONID -> server finds same session
Request 3 -> browser sends JSESSIONID -> server finds same session
```

Biasanya session ID dikirim lewat cookie:

```text
Set-Cookie: JSESSIONID=abc123; Path=/app; HttpOnly; Secure; SameSite=Lax
```

Browser mengirim kembali:

```text
Cookie: JSESSIONID=abc123
```

---

### 8.2 Session adalah shared mutable state per user/browser context

Session bukan variable lokal. Session bisa diakses oleh beberapa request paralel.

Contoh:

```text
User membuka 5 tab.
Semua tab memakai JSESSIONID sama.
5 AJAX request berjalan paralel.
Semua membaca/menulis HttpSession yang sama.
```

Jika session menyimpan mutable object:

```java
List<String> steps = (List<String>) session.getAttribute("steps");
steps.add("x");
```

Maka kamu harus memikirkan concurrency.

**Mental model:**

```text
HttpSession adalah shared mutable map yang lifecycle-nya dikelola container.
```

Untuk aplikasi modern, session sebaiknya dipakai minimal dan hati-hati.

---

### 8.3 Cookie path/domain adalah bagian dari correctness

Menghapus cookie harus memakai path/domain yang sama dengan saat membuat.

Bug klasik:

```text
Set-Cookie saat login:
JSESSIONID=abc; Path=/aceas; Domain=.example.com

Delete saat logout:
JSESSIONID=; Max-Age=0; Path=/; Domain=.example.com
```

Cookie dengan `Path=/aceas` belum tentu terhapus oleh deletion cookie dengan `Path=/`.

Akibat:

- logout tampak berhasil,
- browser masih menyimpan cookie lama,
- request berikutnya login lagi/loop/aneh.

---

## 9. Mental Model Async Servlet

### 9.1 Async bukan otomatis non-blocking everything

Servlet async memungkinkan request thread dilepas sementara response diselesaikan nanti.

Sederhana:

```text
Request thread receives request
  -> startAsync()
  -> request thread returns to container
  -> background work completes later
  -> write response
  -> asyncContext.complete()
```

Namun ini tidak berarti semua operasi menjadi non-blocking.

Jika background worker tetap blocking menunggu database, maka blocking hanya pindah dari worker thread container ke executor lain.

**Mental model:**

```text
Async Servlet memisahkan request lifecycle dari original container thread.
Itu bukan jaminan I/O non-blocking end-to-end.
```

---

### 9.2 Async introduces lifecycle complexity

Dengan async, request tidak selesai saat method servlet return.

State-nya kira-kira:

```text
REQUEST_RECEIVED
  -> ASYNC_STARTED
  -> ORIGINAL_THREAD_RELEASED
  -> ASYNC_WORK_RUNNING
  -> ASYNC_DISPATCH_OR_WRITE
  -> COMPLETE / TIMEOUT / ERROR
```

Failure baru muncul:

- lupa `complete()`,
- async timeout,
- callback selesai setelah timeout,
- response sudah error tapi worker masih write,
- ThreadLocal tidak propagate,
- request attribute dipakai setelah lifecycle tidak tepat,
- executor penuh.

Async powerful, tapi perlu discipline.

---

## 10. Mental Model WebSocket Lifecycle

### 10.1 WebSocket dimulai sebagai HTTP

WebSocket tidak muncul langsung sebagai koneksi WebSocket. Ia dimulai dari HTTP upgrade handshake.

```text
Client sends HTTP GET with Upgrade: websocket
Server validates handshake
Server responds 101 Switching Protocols
Connection changes protocol to WebSocket frames
```

Setelah upgrade, pola request/response biasa tidak berlaku.

```text
Before upgrade: HTTP request/response
After upgrade : WebSocket frame exchange
```

---

### 10.2 WebSocket endpoint bukan request handler biasa

Untuk HTTP:

```text
1 request -> 1 response
```

Untuk WebSocket:

```text
1 connection -> many messages -> eventual close
```

State machine:

```text
CONNECTING
  -> OPEN
  -> ACTIVE
  -> IDLE
  -> CLOSING
  -> CLOSED
```

Failure state:

```text
CONNECTING
  -> rejected handshake

OPEN/ACTIVE
  -> network drop
  -> idle timeout
  -> app error
  -> message too large
  -> unauthorized message
  -> slow consumer

CLOSING
  -> graceful close frame
  -> abrupt close
```

---

### 10.3 WebSocket state is often node-local

Jika kamu menyimpan open sessions dalam memory:

```java
static Set<Session> sessions = ConcurrentHashMap.newKeySet();
```

Maka registry itu hanya berlaku untuk satu JVM/node.

Dalam cluster:

```text
Node A has sessions A1, A2
Node B has sessions B1, B2
Node C has sessions C1
```

Jika event bisnis terjadi di Node B, tapi user terkoneksi ke Node A, Node B tidak bisa langsung mengirim ke session Node A kecuali ada mekanisme distribusi.

Solusi bisa berupa:

- sticky session,
- broker fan-out,
- Redis pub/sub,
- Kafka/RabbitMQ event distribution,
- external WebSocket gateway,
- stateful routing,
- centralized connection service.

**Mental model:**

```text
WebSocket turns your stateless web tier into partially stateful connection layer.
```

Ini sangat besar dampaknya pada architecture.

---

## 11. Threading Mental Model

### 11.1 Classic servlet: thread per request

Model tradisional:

```text
1 active blocking request ≈ 1 worker thread occupied
```

Jika controller memanggil API eksternal selama 5 detik, thread request itu menunggu.

Thread pool container terbatas.

```text
maxThreads = 200
active blocking requests = 200
new requests must wait or be rejected/timeout upstream
```

---

### 11.2 Thread safety servlet

Servlet instance biasanya dibuat sekali dan dipakai banyak thread.

Buruk:

```java
public class BadServlet extends HttpServlet {
    private String currentUser;

    protected void doGet(HttpServletRequest req, HttpServletResponse res) {
        currentUser = req.getParameter("user");
        // request lain bisa mengubah field ini
    }
}
```

Lebih benar:

```java
protected void doGet(HttpServletRequest req, HttpServletResponse res) {
    String currentUser = req.getParameter("user");
    // local variable aman per thread/request
}
```

Invariant:

```text
Jangan simpan request-specific mutable state di field servlet/filter/listener singleton-like object.
```

---

### 11.3 Virtual threads mengubah biaya blocking, bukan hukum kapasitas

Java 21 memperkenalkan virtual threads sebagai fitur final. Dalam rentang Java 21-25, virtual threads relevan untuk server-side blocking style.

Virtual threads dapat membuat blocking I/O lebih murah dari sisi thread scheduling/memory dibanding platform threads. Namun:

```text
Virtual thread tidak membuat database lebih cepat.
Virtual thread tidak memperbesar connection pool.
Virtual thread tidak menghilangkan rate limit downstream.
Virtual thread tidak memperbaiki lock contention.
Virtual thread tidak membuat CPU-bound work gratis.
```

Misalnya:

```text
1000 virtual threads menunggu DB
DB pool hanya 50 connections
950 virtual threads tetap menunggu pool
```

Jadi mental model kapasitas tetap perlu memasukkan:

- request concurrency,
- DB pool size,
- HTTP client pool size,
- downstream rate limit,
- CPU core,
- queue length,
- timeout,
- memory per request,
- payload size.

Virtual threads adalah alat kuat, bukan pengganti desain kapasitas.

---

## 12. Timeout sebagai Arsitektur, Bukan Konfigurasi Sampingan

Timeout di web runtime bukan satu angka.

Ada banyak timeout:

```text
Browser/client timeout
CDN/WAF timeout
Load balancer idle timeout
Reverse proxy connect/read/send timeout
Ingress timeout
Servlet connector connection timeout
Application request timeout
Async servlet timeout
HTTP client timeout ke downstream
DB query timeout
Transaction timeout
WebSocket idle timeout
Kubernetes termination grace period
```

Jika tidak disejajarkan, failure menjadi aneh.

Contoh:

```text
Proxy read timeout = 30s
Application async timeout = 60s
DB query timeout = 120s
```

Hasil:

```text
Client mendapat 504 setelah 30s.
Application masih bekerja sampai 60/120s.
Beban backend tetap berjalan walaupun client sudah pergi.
```

Better:

```text
Client/proxy/app/downstream timeout disusun sebagai budget.
```

Contoh:

```text
External client timeout     35s
Proxy timeout               32s
Application timeout          28s
Downstream call timeout      20s
DB query timeout             15s
```

Ini hanya contoh, bukan angka universal. Prinsipnya:

```text
Layer dalam harus gagal lebih cepat daripada layer luar yang menunggu.
```

---

## 13. Deployment Mental Model

### 13.1 External container deployment

Model tradisional:

```text
Tomcat/WildFly/Payara running
  -> deploy myapp.war
  -> container creates web app classloader
  -> scans annotations/descriptors
  -> initializes listeners/servlets/filters
  -> app available
```

Redeploy:

```text
stop old web app
  -> call destroy/listener shutdown
  -> release classloader
  -> deploy new web app
```

Risiko:

- old threads masih hidup,
- static references menahan classloader,
- JDBC drivers tidak deregister,
- scheduled executor tidak shutdown,
- WebSocket sessions belum ditutup,
- memory/metaspace leak.

---

### 13.2 Embedded server deployment

Model modern cloud:

```text
java -jar app.jar
  -> app starts embedded server
  -> process maps 1 app
  -> container image deployed to Kubernetes
```

Rolling update:

```text
new pod starts
  -> readiness true
  -> traffic shifted
  -> old pod receives termination
  -> old pod should stop accepting new traffic
  -> active requests drain
  -> WebSocket sessions close/reconnect
  -> process exits
```

Masalah yang harus didesain:

- readiness jangan true sebelum app siap,
- liveness jangan membunuh app saat startup lambat,
- graceful shutdown harus lebih pendek dari termination grace period,
- proxy/LB harus drain endpoint,
- WebSocket reconnect storm harus dikendalikan,
- background jobs harus berhenti rapi.

---

## 14. Observability Mental Model

Java web runtime perlu observability di beberapa layer.

### 14.1 Minimal signals

Untuk HTTP:

- request count,
- status code distribution,
- latency percentiles,
- in-flight requests,
- request size,
- response size,
- error count,
- timeout count,
- client abort count,
- thread pool active/queued,
- connector connections,
- session count,
- downstream call latency,
- correlation ID.

Untuk WebSocket:

- open connection count,
- connection open rate,
- connection close rate,
- close code distribution,
- message receive/send rate,
- message size,
- send queue/backpressure,
- heartbeat failures,
- reconnect rate,
- per-node connection distribution,
- slow consumer count.

---

### 14.2 Access log vs application log

Access log menjawab:

```text
Apakah request mencapai server?
Berapa status akhirnya?
Berapa durasinya?
Berapa bytes dikirim?
Dari IP mana?
Ke path mana?
```

Application log menjawab:

```text
Apa yang dilakukan aplikasi?
Handler mana dipanggil?
Downstream mana gagal?
Exception apa?
Business context apa?
```

Keduanya perlu correlation.

Tanpa correlation ID, debugging distributed web runtime menjadi tebak-tebakan.

---

## 15. Failure Taxonomy untuk Servlet/WebSocket Engineer

Top-tier engineer punya taksonomi failure. Bukan semua disebut “error”.

### 15.1 Request tidak mencapai aplikasi

Kemungkinan:

- DNS salah,
- TLS handshake gagal,
- WAF block,
- proxy route salah,
- load balancer target unhealthy,
- network policy,
- security group/firewall,
- ingress rule salah.

Evidence:

- tidak ada application log,
- tidak ada container access log,
- mungkin ada proxy/WAF log.

---

### 15.2 Request mencapai container tapi tidak mencapai framework handler

Kemungkinan:

- context path salah,
- servlet mapping salah,
- method tidak didukung,
- filter stop chain,
- CORS preflight rejected,
- body/header terlalu besar,
- authentication redirect,
- session expired,
- multipart parsing gagal sebelum controller.

Evidence:

- container access log ada,
- framework/controller log tidak ada,
- status bisa 404/405/413/431/302/401/403.

---

### 15.3 Handler berjalan tapi response gagal

Kemungkinan:

- serialization error,
- response already committed,
- client abort,
- broken pipe,
- compression error,
- invalid character encoding,
- stream closed,
- exception after partial write.

Evidence:

- handler log ada,
- access log mungkin status tidak sesuai harapan,
- client menerima partial/empty response.

---

### 15.4 Request lambat/timeout

Kemungkinan:

- thread pool saturated,
- DB pool exhausted,
- downstream slow,
- lock contention,
- GC pause,
- large payload,
- proxy buffering,
- slow client,
- queue buildup,
- retry storm.

Evidence:

- latency percentile naik,
- active thread naik,
- queue naik,
- DB wait naik,
- 504 dari proxy,
- application mungkin masih running setelah client timeout.

---

### 15.5 WebSocket sering putus

Kemungkinan:

- LB idle timeout,
- missing ping/pong,
- proxy tidak support upgrade,
- app close karena error,
- message too large,
- network unstable,
- deployment rolling restart,
- authentication/session expiry,
- client background tab throttling,
- load balancer target drain.

Evidence:

- close code,
- close reason,
- open/close metric,
- LB logs,
- reconnect rate,
- per-node distribution.

---

## 16. Core Invariants yang Akan Dipakai Sepanjang Seri

Part berikutnya akan sering kembali ke invariant ini.

### 16.1 Request invariant

```text
Request-specific data harus tetap request-scoped.
Jangan disimpan di singleton mutable field.
```

---

### 16.2 Response invariant

```text
Sebelum committed, status/header bisa dirancang.
Setelah committed, hanya body continuation/connection failure yang realistis.
```

---

### 16.3 Filter invariant

```text
Filter harus jelas: meneruskan chain tepat sekali, menghentikan request secara eksplisit, atau membungkus request/response dengan aman.
```

---

### 16.4 Session invariant

```text
Session adalah shared mutable state dengan lifecycle browser/container.
Minimalisasi isi session dan desain concurrency-nya.
```

---

### 16.5 Async invariant

```text
Async memindahkan lifecycle completion keluar dari original request thread.
Semua timeout, cleanup, context propagation, dan completion harus eksplisit.
```

---

### 16.6 WebSocket invariant

```text
WebSocket adalah connection lifecycle, bukan request lifecycle.
Connection registry, heartbeat, backpressure, close, dan reconnect adalah bagian dari desain utama.
```

---

### 16.7 Capacity invariant

```text
Throughput stabil jika semua resource boundary selaras:
threads, connections, queues, CPU, memory, downstream capacity, timeout, dan retry.
```

---

### 16.8 Deployment invariant

```text
Startup, readiness, shutdown, redeploy, dan drain adalah bagian dari correctness, bukan operasi tambahan.
```

---

## 17. Cara Membaca Seri Ini

Setiap part setelah ini akan memakai pola:

1. **Problem space** — masalah apa yang sebenarnya diselesaikan.
2. **Mental model** — cara memikirkan konsepnya.
3. **API surface** — class/interface/annotation utama.
4. **Lifecycle** — kapan object dibuat, dipakai, dihancurkan.
5. **Concurrency model** — thread-safety, sharing, race condition.
6. **Failure model** — bagaimana konsep ini gagal di production.
7. **Design pattern** — cara memakai dengan benar.
8. **Anti-pattern** — cara penggunaan yang berbahaya.
9. **Operational notes** — observability, config, deployment impact.
10. **Checklist** — hal yang perlu dicek sebelum production.

Tujuannya bukan hafal API. Tujuannya adalah bisa mendesain, membaca, mendiagnosis, dan memperbaiki sistem web Java production-grade.

---

## 18. Peta Seri ke Depan

Ringkasan arah 31 part berikutnya:

```text
Part 001: Evolution javax -> jakarta
Part 002: HTTP fundamentals
Part 003: Servlet container architecture
Part 004: Servlet lifecycle
Part 005: Request internals
Part 006: Response internals
Part 007: Mapping and dispatch resolution
Part 008: Forward/include/async/error dispatch
Part 009: Filters
Part 010: Listeners
Part 011: ServletContext
Part 012: Session management
Part 013: Cookies and browser boundary
Part 014: Async Servlet
Part 015: Non-blocking I/O
Part 016: Multipart and large payload
Part 017: Error handling
Part 018: Threading, platform threads, virtual threads
Part 019: Classloading and redeployment
Part 020: Packaging and deployment models
Part 021: WebSocket protocol fundamentals
Part 022: WebSocket endpoint model
Part 023: WebSocket session/concurrency/state
Part 024: WebSocket reliability
Part 025: WebSocket security boundary
Part 026: SSE, long polling, alternatives
Part 027: JSP/Jakarta Pages/EL/JSTL
Part 028: Container configuration
Part 029: Reverse proxy, LB, Kubernetes, cloud runtime
Part 030: Observability and diagnostics
Part 031: Architecture patterns and final integration
```

---

## 19. A Small But Important Example: One Request, Many Boundaries

Misalkan ada endpoint:

```text
POST /aceas/api/cases/123/documents
```

Developer junior mungkin melihat:

```text
Controller upload document.
```

Engineer yang lebih matang melihat:

```text
Client/browser
  - Apakah multipart benar?
  - Apakah file besar?
  - Apakah user bisa cancel upload?

Proxy/LB
  - Apakah body size limit cukup?
  - Apakah timeout upload cukup?
  - Apakah buffering aktif?

Servlet container
  - Apakah multipart config benar?
  - Apakah temp directory cukup?
  - Apakah max request size sesuai?
  - Apakah request body sudah dibaca filter?

Filter chain
  - Correlation ID?
  - Auth/session valid?
  - Audit boundary?
  - Rate limit?

Application
  - Authorization object-level?
  - Filename sanitization?
  - Malware scanning?
  - Storage write?
  - DB metadata transaction?

Response
  - Jika storage sukses tapi DB gagal, apa status?
  - Jika response sudah committed, bagaimana error?

Operations
  - Access log mencatat upload size?
  - Metrics latency?
  - Temp file cleanup?
  - Failure traceable?
```

Inilah perbedaan cara berpikir.

---

## 20. Another Example: WebSocket Notification

Misalkan ada requirement:

```text
User harus menerima live notification saat case status berubah.
```

Developer junior mungkin langsung membuat:

```java
@ServerEndpoint("/ws/notifications")
public class NotificationEndpoint { }
```

Engineer yang lebih matang bertanya:

```text
Authentication:
  - Bagaimana user dibuktikan saat handshake?
  - Apakah cookie/session tersedia?
  - Apakah token di query string aman?

Authorization:
  - Apakah user boleh menerima notification case tersebut?
  - Apakah authorization dicek saat subscribe atau setiap message?

Connection state:
  - Satu user bisa punya berapa connection?
  - Multiple tabs?
  - Mobile reconnect?

Cluster:
  - Jika event terjadi di node lain, bagaimana message dikirim ke node pemilik connection?

Reliability:
  - Jika user offline, apakah message hilang?
  - Perlu ack/replay?
  - Apakah notification boleh duplicate?

Backpressure:
  - Jika client lambat, queue message di memory sampai berapa?

Timeout:
  - LB idle timeout berapa?
  - Heartbeat interval berapa?

Deployment:
  - Saat rolling restart, apakah connection ditutup dengan close code yang jelas?
  - Apakah client reconnect dengan jitter?

Observability:
  - Berapa open connection per node?
  - Berapa reconnect per minute?
  - Close code apa yang dominan?
```

WebSocket bukan sekadar API. WebSocket adalah distributed stateful connection design.

---

## 21. Practical Checklist Setelah Part 000

Sebelum lanjut ke Part 001, pastikan kamu bisa menjelaskan ini tanpa menghafal:

```text
[ ] Servlet API berbeda dari servlet container.
[ ] Web framework berjalan di atas servlet/filter/dispatcher model.
[ ] Request lifecycle dimulai sebelum controller dan berakhir setelah response write.
[ ] Filter chain adalah nested boundary yang bisa mengubah request/response.
[ ] Response punya committed state.
[ ] Session adalah shared mutable state, bukan variable lokal user.
[ ] Cookie correctness bergantung pada path/domain/security attributes.
[ ] Async Servlet memisahkan completion dari original request thread.
[ ] WebSocket adalah connection lifecycle, bukan request lifecycle.
[ ] Proxy/LB/container/app/downstream timeout harus disejajarkan.
[ ] 404/504/broken pipe/client abort harus didiagnosis berdasarkan layer.
[ ] Virtual threads mengurangi biaya blocking thread, bukan menghilangkan bottleneck downstream.
[ ] Deployment dan graceful shutdown adalah bagian dari web runtime correctness.
```

---

## 22. References

Sumber resmi dan relevan yang menjadi acuan orientasi seri:

1. Jakarta Servlet 6.1 Specification — Eclipse Foundation  
   `https://jakarta.ee/specifications/servlet/6.1/`

2. Jakarta Servlet Specification Document 6.1  
   `https://jakarta.ee/specifications/servlet/6.1/jakarta-servlet-spec-6.1`

3. Jakarta WebSocket 2.2 Specification — Eclipse Foundation  
   `https://jakarta.ee/specifications/websocket/2.2/`

4. Jakarta WebSocket Specification Document 2.2  
   `https://jakarta.ee/specifications/websocket/2.2/jakarta-websocket-spec-2.2`

5. Jakarta EE Platform 11 Specification — Eclipse Foundation  
   `https://jakarta.ee/specifications/platform/11/`

6. Jakarta EE Specifications Index  
   `https://jakarta.ee/specifications/`

7. OpenJDK JDK 25 Project  
   `https://openjdk.org/projects/jdk/25/`

---

## 23. Penutup Part 000

Part ini adalah fondasi mental. Kalau disingkat menjadi satu kalimat:

```text
Java web runtime bukan controller layer; ia adalah gabungan protocol boundary, container lifecycle, filter/dispatch pipeline, session/cookie state, thread/resource management, deployment behavior, dan failure semantics.
```

Setelah fondasi ini, Part 001 akan masuk ke evolusi:

```text
javax.* -> jakarta.*
Java EE -> Jakarta EE
Servlet 3.x/4.x -> Servlet 5/6/6.1
WebSocket 1.x -> WebSocket 2.x/2.2
Legacy runtime -> modern Java 17/21/25 runtime
```

Seri **belum selesai**. Ini adalah **Part 000 dari 032**.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 34 — Capstone Architecture: Designing an Enterprise Jakarta Security Platform](../security/learn-java-jakarta-security-authentication-authorization-identity-part-34-capstone-enterprise-jakarta-security-platform.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-servlet-websocket-web-container-runtime-part-001](./learn-java-servlet-websocket-web-container-runtime-part-001.md)

</div>