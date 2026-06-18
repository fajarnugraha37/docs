# learn-java-jakarta-part-016.md

# Bagian 16 — Jakarta Servlet (`jakarta.servlet`): Fondasi Web Container

> Target pembaca: Java engineer yang ingin memahami Servlet bukan sebagai teknologi “lama”, tetapi sebagai **fondasi web runtime** di Jakarta EE. Bahkan jika sehari-hari memakai Jakarta REST, Spring MVC, JSF, atau framework lain, banyak behavior web tetap berdiri di atas konsep Servlet: request, response, filter chain, dispatching, session, async, error handling, multipart upload, security constraints, dan web container lifecycle.
>
> Fokus bagian ini: mental model Servlet container, request-response lifecycle, `HttpServlet`, filter, listener, dispatcher, async processing, session/cookie, error handling, multipart, encoding, deployment descriptor vs annotation, security, performance, observability, testing, dan failure modes production.

---

## Daftar Isi

1. [Orientasi: Kenapa Masih Perlu Belajar Servlet?](#1-orientasi-kenapa-masih-perlu-belajar-servlet)
2. [Mental Model: Servlet Container sebagai HTTP Runtime](#2-mental-model-servlet-container-sebagai-http-runtime)
3. [Jakarta Servlet 6.1 dalam Jakarta EE 11](#3-jakarta-servlet-61-dalam-jakarta-ee-11)
4. [Servlet vs Jakarta REST vs Spring MVC](#4-servlet-vs-jakarta-rest-vs-spring-mvc)
5. [Dependency, Packaging, dan Runtime](#5-dependency-packaging-dan-runtime)
6. [Peta API `jakarta.servlet`](#6-peta-api-jakartaservlet)
7. [Lifecycle Servlet: Load, Init, Service, Destroy](#7-lifecycle-servlet-load-init-service-destroy)
8. [`HttpServlet`: `doGet`, `doPost`, `doPut`, `doDelete`, dan Method Semantics](#8-httpservlet-doget-dopost-doput-dodelete-dan-method-semantics)
9. [`HttpServletRequest`: Membaca Request dengan Benar](#9-httpservletrequest-membaca-request-dengan-benar)
10. [`HttpServletResponse`: Menulis Response dengan Benar](#10-httpservletresponse-menulis-response-dengan-benar)
11. [Request Body, Character Encoding, dan Content Type](#11-request-body-character-encoding-dan-content-type)
12. [Response Commit, Buffering, dan Header Timing](#12-response-commit-buffering-dan-header-timing)
13. [Mapping: URL Pattern, Annotation, dan `web.xml`](#13-mapping-url-pattern-annotation-dan-webxml)
14. [Filter: Cross-Cutting Pipeline sebelum Servlet](#14-filter-cross-cutting-pipeline-sebelum-servlet)
15. [Filter Chain Ordering](#15-filter-chain-ordering)
16. [Listener: Application, Request, Session Lifecycle](#16-listener-application-request-session-lifecycle)
17. [Request Dispatching: Forward, Include, Error, Async](#17-request-dispatching-forward-include-error-async)
18. [ServletContext: Application-Level Shared Context](#18-servletcontext-application-level-shared-context)
19. [Session Management: `HttpSession`, Cookie, URL Rewriting](#19-session-management-httpsession-cookie-url-rewriting)
20. [Cookie dan Header Security](#20-cookie-dan-header-security)
21. [Multipart Upload](#21-multipart-upload)
22. [Async Servlet](#22-async-servlet)
23. [Error Handling dan Error Pages](#23-error-handling-dan-error-pages)
24. [Servlet Security: Constraints, Roles, Programmatic Login](#24-servlet-security-constraints-roles-programmatic-login)
25. [Servlet dan CDI/Jakarta EE Integration](#25-servlet-dan-cdijakarta-ee-integration)
26. [Servlet dan Jakarta REST: Apa yang Terjadi di Bawahnya?](#26-servlet-dan-jakarta-rest-apa-yang-terjadi-di-bawahnya)
27. [Threading Model dan Concurrency](#27-threading-model-dan-concurrency)
28. [Virtual Threads dan Servlet](#28-virtual-threads-dan-servlet)
29. [Performance Engineering](#29-performance-engineering)
30. [Observability: Logging, Metrics, Tracing](#30-observability-logging-metrics-tracing)
31. [Testing Strategy](#31-testing-strategy)
32. [Production Failure Modes](#32-production-failure-modes)
33. [Best Practices dan Anti-Patterns](#33-best-practices-dan-anti-patterns)
34. [Checklist Review](#34-checklist-review)
35. [Case Study 1: Correlation ID Filter](#35-case-study-1-correlation-id-filter)
36. [Case Study 2: File Upload Memory Explosion](#36-case-study-2-file-upload-memory-explosion)
37. [Case Study 3: Session Leak pada Cluster](#37-case-study-3-session-leak-pada-cluster)
38. [Case Study 4: Response Sudah Commit](#38-case-study-4-response-sudah-commit)
39. [Latihan Bertahap](#39-latihan-bertahap)
40. [Mini Project: Servlet Runtime Lab](#40-mini-project-servlet-runtime-lab)
41. [Referensi Resmi](#41-referensi-resmi)

---

# 1. Orientasi: Kenapa Masih Perlu Belajar Servlet?

Banyak developer modern jarang menulis `HttpServlet` langsung.

Mereka lebih sering memakai:

- Jakarta REST / JAX-RS;
- Spring MVC;
- JSF/Jakarta Faces;
- MVC framework;
- framework microservice;
- API gateway abstraction.

Namun di Java web ecosystem, Servlet tetap foundational.

Banyak framework web berjalan di atas Servlet container.

Ketika terjadi masalah production seperti:

- request body tidak terbaca;
- filter tidak jalan;
- response sudah commit;
- session hilang;
- cookie tidak secure;
- upload file membuat memory naik;
- encoding rusak;
- async timeout;
- request stuck;
- reverse proxy header salah;
- CORS/preflight aneh;
- error page tidak muncul;
- `getInputStream()` sudah dipakai;
- request dispatch loop;
- container thread pool exhausted;

kamu perlu Servlet mental model.

## 1.1 Servlet bukan hanya “class lama”

Servlet adalah abstraction standard untuk server-side HTTP request/response.

```java
@WebServlet("/hello")
public class HelloServlet extends HttpServlet {

    @Override
    protected void doGet(HttpServletRequest request, HttpServletResponse response)
            throws IOException {
        response.setContentType("text/plain");
        response.getWriter().write("Hello Jakarta Servlet");
    }
}
```

Di balik kode kecil ini ada runtime besar:

```text
client
  ↓
reverse proxy / load balancer
  ↓
HTTP connector
  ↓
servlet container
  ↓
filter chain
  ↓
servlet
  ↓
response
```

## 1.2 Apa yang Servlet ajarkan?

Servlet mengajarkan:

- request lifecycle;
- response lifecycle;
- per-request object;
- application context;
- session context;
- filter pipeline;
- listener event;
- dispatch types;
- async processing;
- web container lifecycle;
- HTTP semantics;
- threading/concurrency model.

## 1.3 Kenapa penting untuk top-tier engineer?

Top-tier engineer tidak hanya tahu cara membuat endpoint.

Ia tahu:

- request melewati layer apa saja;
- kapan body boleh dibaca;
- kapan response header terkunci;
- bagaimana session disimpan;
- bagaimana filter ordering mempengaruhi security;
- kenapa self-written auth filter bisa bypass;
- kenapa file upload bisa OOM;
- kenapa async perlu timeout;
- kenapa thread pool habis;
- kenapa REST framework error mapper tidak menangkap error di filter.

Servlet memberi fondasi untuk memahami semua itu.

---

# 2. Mental Model: Servlet Container sebagai HTTP Runtime

Servlet container adalah runtime yang mengelola web components.

Ia bertanggung jawab untuk:

- menerima request HTTP;
- membuat request/response object;
- memilih servlet/filter berdasarkan mapping;
- menjalankan filter chain;
- memanggil servlet method;
- mengelola session;
- mengelola lifecycle servlet/filter/listener;
- menangani dispatch;
- menangani error;
- mendukung async;
- menyediakan application context;
- enforce security constraints;
- mengirim response.

## 2.1 Request lifecycle high-level

```text
HTTP request arrives
  ↓
connector parses request
  ↓
container creates HttpServletRequest / HttpServletResponse
  ↓
container resolves context path
  ↓
container selects filter chain
  ↓
filter 1 before
  ↓
filter 2 before
  ↓
servlet service()
  ↓
filter 2 after
  ↓
filter 1 after
  ↓
response committed/sent
```

## 2.2 Servlet object bukan dibuat per request

Servlet instance biasanya dibuat sekali atau beberapa kali oleh container.

Request object dibuat per request.

Jangan simpan request-specific state di field servlet.

Bad:

```java
@WebServlet("/case")
public class CaseServlet extends HttpServlet {
    private String currentUser; // BAD

    protected void doGet(HttpServletRequest req, HttpServletResponse resp) {
        currentUser = req.getUserPrincipal().getName();
    }
}
```

Jika request concurrent, data bisa bocor antar user.

## 2.3 Container controls lifecycle

Kamu tidak membuat servlet dengan `new`.

Container yang membuat, init, service, destroy.

```text
container creates servlet
  ↓
init()
  ↓
service many requests
  ↓
destroy()
```

## 2.4 Servlet adalah boundary rendah

Servlet bekerja dekat dengan HTTP raw model:

- path;
- method;
- headers;
- cookies;
- status code;
- body stream;
- attributes;
- session;
- dispatch.

Jakarta REST memberi abstraction lebih tinggi:

- resource method;
- param binding;
- entity provider;
- exception mapper;
- filters;
- content negotiation.

Tetapi REST runtime tetap berada di web runtime.

---

# 3. Jakarta Servlet 6.1 dalam Jakarta EE 11

Jakarta Servlet 6.1 adalah release untuk Jakarta EE 11.

Jakarta Servlet mendefinisikan server-side API untuk menangani HTTP requests dan responses.

## 3.1 Posisi di Jakarta EE

Servlet ada di Web Profile dan Platform.

Banyak spesifikasi web bergantung pada konsep servlet container.

## 3.2 Jakarta Servlet 6.1 highlights

Catatan release Servlet 6.1 mencakup:

- deprecate support untuk HTTP/2 push;
- mekanisme untuk aplikasi berinteraksi dengan HTTP session di luar standard HTTP request processing;
- penghapusan referensi ke SecurityManager dan associated APIs;
- clarifications terhadap expected behavior;
- enhancement kecil seperti status code/response body saat redirect dan overload `Charset`.

## 3.3 Kenapa HTTP/2 push deprecated?

HTTP/2 push secara industri tidak lagi menjadi fitur yang disarankan luas, dan browser support/usage menurun. Untuk aplikasi modern, optimasi delivery biasanya lewat caching, preload hints, CDN, bundling strategy, dan HTTP/3/QUIC ecosystem.

Dalam konteks Servlet, cukup pahami bahwa push bukan fokus utama desain web modern.

## 3.4 Jakarta Servlet 6.2

Jakarta Servlet 6.2 sedang under development untuk Jakarta EE 12. Untuk target Jakarta EE 11, fokus pada Servlet 6.1.

## 3.5 Namespace

Paket modern:

```java
jakarta.servlet
jakarta.servlet.http
jakarta.servlet.annotation
```

Bukan lagi:

```java
javax.servlet
```

---

# 4. Servlet vs Jakarta REST vs Spring MVC

## 4.1 Servlet

Low-level HTTP API.

```java
protected void doGet(HttpServletRequest req, HttpServletResponse resp)
```

Kamu mengurus:

- path parsing;
- param parsing;
- status;
- header;
- body;
- JSON mapping;
- error format.

## 4.2 Jakarta REST

Resource-oriented API.

```java
@Path("/cases")
public class CaseResource {

    @GET
    @Path("/{id}")
    public CaseDto get(@PathParam("id") UUID id) { ... }
}
```

Framework mengurus:

- resource matching;
- parameter binding;
- content negotiation;
- JSON provider;
- exception mapper;
- filters.

## 4.3 Spring MVC

Spring web framework di atas Servlet stack.

```java
@RestController
class CaseController {
    @GetMapping("/cases/{id}")
    CaseDto get(@PathVariable UUID id) { ... }
}
```

## 4.4 Kenapa Servlet tetap penting?

Karena banyak concern ada sebelum REST/controller:

```text
CORS
security filter
session
request wrapping
encoding
multipart
error dispatch
compression
correlation id
reverse proxy headers
```

## 4.5 Kapan menulis servlet langsung?

Jarang, tetapi berguna untuk:

- custom low-level endpoint;
- streaming;
- legacy integration;
- health endpoint minimal;
- proxy/gateway internal;
- custom file download/upload;
- framework infrastructure;
- debugging.

Untuk REST API biasa, gunakan Jakarta REST/Spring MVC.

---

# 5. Dependency, Packaging, dan Runtime

## 5.1 Maven API dependency

```xml
<dependency>
  <groupId>jakarta.servlet</groupId>
  <artifactId>jakarta.servlet-api</artifactId>
  <version>6.1.0</version>
  <scope>provided</scope>
</dependency>
```

## 5.2 Scope `provided`

Dalam WAR yang deploy ke servlet container/Jakarta EE runtime, container menyediakan Servlet API.

Jadi:

```xml
<scope>provided</scope>
```

## 5.3 Embedded container

Jika membuat executable app dengan embedded server, dependency dan packaging bisa berbeda.

Contoh embedded Tomcat/Jetty/Undertow membawa implementation runtime.

## 5.4 API jar bukan server

`jakarta.servlet-api` hanya API.

Kamu butuh container:

- Tomcat;
- Jetty;
- Undertow;
- GlassFish;
- Payara;
- WildFly;
- Open Liberty;
- WebLogic;
- WebSphere Liberty;
- atau Jakarta EE compatible runtime lain.

## 5.5 WAR structure

Typical WAR:

```text
app.war
  WEB-INF/
    web.xml
    classes/
    lib/
```

Servlet annotations dapat menggantikan sebagian `web.xml`, tetapi descriptor tetap berguna untuk centralized config.

## 5.6 Classloading warning

Jangan bundle servlet API jar ke WAR jika container sudah menyediakan.

Duplicate API dapat menyebabkan classloading conflict.

---

# 6. Peta API `jakarta.servlet`

## 6.1 Core package

```java
jakarta.servlet
```

Berisi:

- `Servlet`;
- `GenericServlet`;
- `ServletRequest`;
- `ServletResponse`;
- `ServletConfig`;
- `ServletContext`;
- `Filter`;
- `FilterChain`;
- `FilterConfig`;
- `RequestDispatcher`;
- `AsyncContext`;
- `ServletInputStream`;
- `ServletOutputStream`;
- listeners/events;
- dispatcher types;
- exceptions.

## 6.2 HTTP package

```java
jakarta.servlet.http
```

Berisi:

- `HttpServlet`;
- `HttpServletRequest`;
- `HttpServletResponse`;
- `HttpSession`;
- `Cookie`;
- `HttpFilter`;
- `HttpSessionListener`;
- `Part`;
- HTTP-specific wrappers/events.

## 6.3 Annotation package

```java
jakarta.servlet.annotation
```

Berisi:

- `@WebServlet`;
- `@WebFilter`;
- `@WebListener`;
- `@MultipartConfig`;
- `@ServletSecurity`;
- `@HttpConstraint`;
- `@HttpMethodConstraint`.

## 6.4 Descriptor

`web.xml` tetap standard deployment descriptor.

## 6.5 Mental map

```text
Servlet      → request handler
Filter       → pipeline middleware
Listener     → lifecycle observer
Context      → application shared environment
Session      → per-user/session state
Dispatcher   → internal routing
AsyncContext → async request handling
```

---

# 7. Lifecycle Servlet: Load, Init, Service, Destroy

Servlet lifecycle:

```text
load class
  ↓
instantiate servlet
  ↓
init()
  ↓
service() for each request
  ↓
destroy()
```

## 7.1 `init()`

Called once when servlet initialized.

```java
@Override
public void init() throws ServletException {
    // initialize resources
}
```

Use for lightweight initialization.

Avoid long blocking startup.

## 7.2 `service()`

Container calls `service()` for requests.

`HttpServlet.service()` dispatches to:

- `doGet`;
- `doPost`;
- `doPut`;
- `doDelete`;
- etc.

Usually override `doGet`/`doPost`, not `service`.

## 7.3 `destroy()`

Called before servlet taken out of service.

```java
@Override
public void destroy() {
    // cleanup
}
```

But like `@PreDestroy`, not guaranteed on crash/kill.

## 7.4 Load on startup

Annotation:

```java
@WebServlet(urlPatterns = "/health", loadOnStartup = 1)
```

`loadOnStartup` controls eager initialization order.

## 7.5 Threading

One servlet instance can serve many concurrent requests.

Fields must be thread-safe or immutable.

## 7.6 Bad stateful servlet

```java
public class BadServlet extends HttpServlet {
    private String requestId;

    protected void doGet(HttpServletRequest req, HttpServletResponse resp) {
        requestId = req.getHeader("X-Request-ID"); // race
    }
}
```

## 7.7 Good servlet

```java
protected void doGet(HttpServletRequest req, HttpServletResponse resp) {
    String requestId = req.getHeader("X-Request-ID"); // local variable
}
```

---

# 8. `HttpServlet`: `doGet`, `doPost`, `doPut`, `doDelete`, dan Method Semantics

`HttpServlet` is the common base class for HTTP servlets.

## 8.1 Basic structure

```java
@WebServlet("/cases")
public class CaseServlet extends HttpServlet {

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp)
            throws IOException {
        ...
    }

    @Override
    protected void doPost(HttpServletRequest req, HttpServletResponse resp)
            throws IOException {
        ...
    }
}
```

## 8.2 HTTP method semantics

### GET

- safe;
- should not modify server state;
- cacheable;
- idempotent.

### POST

- create/command/process;
- not necessarily idempotent;
- body usually carries command.

### PUT

- replace/create at known URI;
- idempotent.

### PATCH

- partial update;
- may or may not be idempotent depending design.

### DELETE

- delete resource;
- idempotent from client semantic view.

## 8.3 Servlet does not enforce REST semantics

Servlet lets you write:

```java
doGet() { deleteUser(); }
```

But that is bad HTTP design.

## 8.4 `doHead`

HEAD should return headers like GET without body.

`HttpServlet` has default behavior, but custom streaming endpoints may need attention.

## 8.5 `doOptions`

OPTIONS used for capabilities/CORS preflight.

Frameworks often handle CORS via filter.

## 8.6 Method not allowed

If method unsupported, respond:

```http
405 Method Not Allowed
```

Do not return 200 with error body.

## 8.7 Idempotency

For POST commands, consider idempotency key:

```http
Idempotency-Key: ...
```

Servlet gives raw access to headers; application owns semantics.

---

# 9. `HttpServletRequest`: Membaca Request dengan Benar

The servlet container creates an `HttpServletRequest` object and passes it to service methods such as `doGet`/`doPost`.

## 9.1 Common methods

```java
req.getMethod()
req.getRequestURI()
req.getContextPath()
req.getServletPath()
req.getPathInfo()
req.getQueryString()
req.getParameter("q")
req.getHeader("X-Request-ID")
req.getCookies()
req.getSession()
req.getInputStream()
req.getReader()
req.getUserPrincipal()
req.isUserInRole("ADMIN")
```

## 9.2 URI components

Example request:

```text
GET /app/api/cases/123?include=documents
```

If context path is `/app`, servlet mapping `/api/*`:

```text
contextPath = /app
servletPath = /api
pathInfo = /cases/123
queryString = include=documents
```

Understanding this matters for routing/proxy/filter.

## 9.3 Parameters

`getParameter` combines query parameters and form parameters depending content type and parsing.

Be careful:

- body may be consumed;
- encoding matters;
- multi-value parameters need `getParameterValues`.

## 9.4 Headers

Headers are strings.

```java
String correlationId = req.getHeader("X-Correlation-ID");
```

Normalize/validate.

Do not trust client-supplied security-sensitive headers unless set by trusted proxy and sanitized.

## 9.5 Body stream vs reader

You can read body as bytes:

```java
ServletInputStream in = req.getInputStream();
```

or chars:

```java
BufferedReader reader = req.getReader();
```

Do not use both for same request body.

## 9.6 Request attributes

Attributes are server-side per-request storage:

```java
req.setAttribute("correlationId", id);
Object id = req.getAttribute("correlationId");
```

Different from parameters.

## 9.7 Remote address and proxy

`req.getRemoteAddr()` may show load balancer/reverse proxy IP.

Use forwarded headers only if trusted proxy config is correct.

## 9.8 Security principal

```java
Principal p = req.getUserPrincipal();
boolean admin = req.isUserInRole("ADMIN");
```

Only meaningful if security configured.

---

# 10. `HttpServletResponse`: Menulis Response dengan Benar

`HttpServletResponse` extends `ServletResponse` to provide HTTP-specific functionality such as headers and cookies.

## 10.1 Common methods

```java
resp.setStatus(HttpServletResponse.SC_OK);
resp.setHeader("Cache-Control", "no-store");
resp.setContentType("application/json");
resp.setCharacterEncoding(StandardCharsets.UTF_8.name());
resp.getWriter().write(json);
```

## 10.2 Status before body

Set status before writing body.

```java
resp.setStatus(HttpServletResponse.SC_CREATED);
resp.getWriter().write(...);
```

## 10.3 Headers before commit

Headers must be set before response commits.

After commit, header/status changes may not work.

## 10.4 Writer vs output stream

Use one:

```java
resp.getWriter()
```

for text.

Use:

```java
resp.getOutputStream()
```

for binary.

Do not mix both.

## 10.5 Content type

JSON:

```java
resp.setContentType("application/json");
resp.setCharacterEncoding("UTF-8");
```

Text:

```java
resp.setContentType("text/plain");
```

File:

```java
resp.setContentType("application/pdf");
resp.setHeader("Content-Disposition", "attachment; filename="report.pdf"");
```

## 10.6 Redirect

```java
resp.sendRedirect(location);
```

Servlet 6.1 improved redirect-related control.

## 10.7 Error

```java
resp.sendError(HttpServletResponse.SC_NOT_FOUND, "Case not found");
```

But for JSON APIs, custom error contract is often better than container default HTML error.

---

# 11. Request Body, Character Encoding, dan Content Type

Encoding bugs are common.

## 11.1 Request character encoding

Set before reading parameters/body.

```java
req.setCharacterEncoding("UTF-8");
```

If parameters already parsed, setting encoding is too late.

## 11.2 Response character encoding

Set before writer obtained/response committed.

```java
resp.setCharacterEncoding("UTF-8");
resp.setContentType("application/json");
```

Better:

```java
resp.setContentType("application/json;charset=UTF-8");
```

depending style.

## 11.3 `Content-Type`

Client tells body type:

```http
Content-Type: application/json
```

Server should validate.

## 11.4 `Accept`

Client tells desired response:

```http
Accept: application/json
```

Servlet low-level code must handle content negotiation manually if needed.

Jakarta REST does this better.

## 11.5 Body read once

Request body stream is generally one-shot.

If filter reads body for logging, servlet later may see empty body unless request wrapper caches it.

## 11.6 Logging body safely

Avoid logging full body.

If needed:

- limit size;
- mask PII/secrets;
- only in debug;
- use request wrapper carefully;
- avoid consuming stream accidentally.

---

# 12. Response Commit, Buffering, dan Header Timing

## 12.1 What is commit?

Response committed means status and headers are sent to client.

After commit, you cannot reliably change status/header.

## 12.2 What causes commit?

- buffer full;
- flush called;
- writer/output stream closed;
- `sendError`;
- `sendRedirect`;
- container decides to send.

## 12.3 Check commit

```java
if (!resp.isCommitted()) {
    resp.setStatus(500);
}
```

## 12.4 Buffer size

```java
resp.setBufferSize(8192);
```

Must be before body write.

## 12.5 Common bug

```java
resp.getWriter().write("partial");
throw new RuntimeException();
```

Error handler tries to set 500, but response might already be committed.

## 12.6 Pattern

Prepare status/headers first, then body.

For JSON APIs, build response object before writing.

## 12.7 Streaming exception

For streaming downloads, once bytes are sent, failures cannot be converted to clean JSON error.

Design streaming endpoints carefully.

---

# 13. Mapping: URL Pattern, Annotation, dan `web.xml`

## 13.1 Annotation mapping

```java
@WebServlet(urlPatterns = "/hello")
public class HelloServlet extends HttpServlet { ... }
```

## 13.2 Multiple patterns

```java
@WebServlet(urlPatterns = {"/hello", "/hi"})
```

## 13.3 Wildcard mapping

```java
@WebServlet("/api/*")
```

## 13.4 Extension mapping

```java
@WebServlet("*.action")
```

Legacy style.

## 13.5 `web.xml`

```xml
<servlet>
  <servlet-name>hello</servlet-name>
  <servlet-class>com.example.HelloServlet</servlet-class>
</servlet>

<servlet-mapping>
  <servlet-name>hello</servlet-name>
  <url-pattern>/hello</url-pattern>
</servlet-mapping>
```

## 13.6 Annotation vs descriptor

Annotations:

- local and simple;
- good for small app;
- less centralized.

`web.xml`:

- centralized;
- can override;
- useful for enterprise config;
- useful when source cannot be changed.

## 13.7 Mapping conflicts

If multiple servlets match, container applies matching rules.

Understand:

- exact match;
- longest path-prefix match;
- extension match;
- default servlet.

## 13.8 Context path

Deployment context affects full URL.

If app deployed as `/caseapp`:

```text
/caseapp/hello
```

not just:

```text
/hello
```

---

# 14. Filter: Cross-Cutting Pipeline sebelum Servlet

Filter is middleware around servlet/resource.

```java
@WebFilter("/*")
public class CorrelationIdFilter implements Filter {

    @Override
    public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
            throws IOException, ServletException {
        try {
            // before
            chain.doFilter(request, response);
        } finally {
            // after
        }
    }
}
```

## 14.1 Filter use cases

- correlation ID;
- logging;
- CORS;
- security;
- compression;
- caching headers;
- request wrapping;
- response wrapping;
- rate limiting;
- tenant context;
- character encoding;
- metrics;
- tracing.

## 14.2 Filter vs Servlet

Filter can run before/after target.

Servlet is final request handler.

## 14.3 Must call chain

If filter does not call:

```java
chain.doFilter(request, response);
```

request stops.

This can be intentional:

- authentication failure;
- rate limit;
- maintenance mode;
- CORS preflight response.

But accidental missing chain is severe.

## 14.4 Cast to HTTP

```java
HttpServletRequest req = (HttpServletRequest) request;
HttpServletResponse resp = (HttpServletResponse) response;
```

Only if filter targets HTTP.

## 14.5 Filter should be fast

Filter runs on many/all requests.

Avoid:

- DB query per request unless necessary;
- remote call;
- heavy body logging;
- blocking without timeout.

## 14.6 Filter exception

If filter throws before REST framework, JAX-RS exception mapper may not catch it.

Container error handling applies.

---

# 15. Filter Chain Ordering

Ordering determines behavior.

## 15.1 Example desired order

```text
ForwardedHeaderFilter
  → CorrelationIdFilter
  → SecurityFilter
  → TenantFilter
  → MetricsFilter
  → CompressionFilter
  → Servlet/JAX-RS
```

## 15.2 Why order matters

Security before business.

Correlation before logging.

CORS may need before security for preflight.

Encoding filter before parameter parsing.

Compression after body produced.

## 15.3 Annotation ordering

Annotation-based filter ordering can be less explicit.

For precise order, use `web.xml`.

## 15.4 Dispatcher types

Filter can apply to:

- REQUEST;
- FORWARD;
- INCLUDE;
- ERROR;
- ASYNC.

Example:

```java
@WebFilter(
    urlPatterns = "/*",
    dispatcherTypes = {DispatcherType.REQUEST, DispatcherType.ERROR}
)
```

## 15.5 Common mistake

Filter only runs on REQUEST, but error dispatch not filtered.

Or filter runs on ERROR and logs duplicate entries.

## 15.6 Testing order

Create integration test:

```text
A.before
B.before
servlet
B.after
A.after
```

---

# 16. Listener: Application, Request, Session Lifecycle

Listeners observe lifecycle events.

## 16.1 Common listener types

- `ServletContextListener`;
- `ServletRequestListener`;
- `HttpSessionListener`;
- `ServletRequestAttributeListener`;
- `HttpSessionAttributeListener`;
- `HttpSessionIdListener`;
- `HttpSessionActivationListener`;
- `ServletContextAttributeListener`.

## 16.2 `ServletContextListener`

```java
@WebListener
public class AppLifecycleListener implements ServletContextListener {

    @Override
    public void contextInitialized(ServletContextEvent sce) {
        ...
    }

    @Override
    public void contextDestroyed(ServletContextEvent sce) {
        ...
    }
}
```

Use for application startup/shutdown integration.

## 16.3 Request listener

Tracks request start/end.

Useful for:

- metrics;
- context cleanup;
- leak detection.

## 16.4 Session listener

Tracks session create/destroy.

Useful for:

- active session metrics;
- cleanup;
- audit.

## 16.5 Listener caution

Do not put large business logic in listeners.

Startup/shutdown listeners should be bounded and observable.

## 16.6 Listener ordering

If multiple listeners, ordering matters and can be deployment-specific/descriptor-defined.

Document.

---

# 17. Request Dispatching: Forward, Include, Error, Async

`RequestDispatcher` allows server-side dispatch.

## 17.1 Forward

```java
RequestDispatcher dispatcher = req.getRequestDispatcher("/internal");
dispatcher.forward(req, resp);
```

Forward transfers control to another resource.

Client URL does not change.

## 17.2 Include

```java
dispatcher.include(req, resp);
```

Includes output from another resource into response.

Common in server-side rendering legacy.

## 17.3 Error dispatch

Container dispatches to error page/resource after error.

Dispatcher type:

```java
DispatcherType.ERROR
```

## 17.4 Async dispatch

Async request can dispatch later.

Dispatcher type:

```java
DispatcherType.ASYNC
```

## 17.5 Attributes

Dispatch sets request attributes such as forward/error-related metadata.

## 17.6 Pitfall

Forward after response committed fails.

## 17.7 Dispatch loop

Bad mapping can create infinite dispatch loop.

Test error/forward paths.

---

# 18. ServletContext: Application-Level Shared Context

`ServletContext` represents web application context.

## 18.1 Access

```java
ServletContext context = getServletContext();
```

or:

```java
req.getServletContext()
```

## 18.2 Use cases

- application init parameters;
- resource lookup;
- logging;
- context attributes;
- dispatchers;
- MIME type lookup.

## 18.3 Context attributes

```java
context.setAttribute("appVersion", version);
```

Shared across app.

Must be thread-safe.

## 18.4 Avoid global mutable state

Bad:

```java
context.setAttribute("currentUser", user);
```

This is application-wide, not request/session.

## 18.5 Resource loading

```java
InputStream in = context.getResourceAsStream("/WEB-INF/config.json");
```

## 18.6 Context path

```java
context.getContextPath()
```

Useful for generating links but beware reverse proxy.

---

# 19. Session Management: `HttpSession`, Cookie, URL Rewriting

## 19.1 Get session

```java
HttpSession session = req.getSession(); // creates if absent
```

or:

```java
HttpSession session = req.getSession(false); // do not create
```

## 19.2 Avoid accidental session creation

For stateless APIs, do not call `getSession()` accidentally.

Use:

```java
getSession(false)
```

## 19.3 Session attributes

```java
session.setAttribute("cart", cart);
```

Values may need to be serializable if session replication/passivation is used.

## 19.4 Session ID

Usually stored in cookie:

```text
JSESSIONID
```

Can also use URL rewriting if cookies disabled.

## 19.5 Session fixation

After login, change session ID:

```java
req.changeSessionId();
```

## 19.6 Session timeout

Configured in `web.xml` or server config.

## 19.7 Cluster issue

Session in cluster needs:

- sticky session; or
- session replication; or
- external session store; or
- stateless design.

## 19.8 Stateless REST

For modern REST APIs, prefer token/session-less design unless server-side session is explicitly needed.

## 19.9 Session data size

Do not store large object graph in session.

It hurts memory, replication, serialization, and failover.

---

# 20. Cookie dan Header Security

## 20.1 Cookie

```java
Cookie cookie = new Cookie("theme", "dark");
cookie.setHttpOnly(true);
cookie.setSecure(true);
cookie.setPath("/");
resp.addCookie(cookie);
```

## 20.2 Important flags

- `HttpOnly`;
- `Secure`;
- `SameSite`;
- Path;
- Domain;
- Max-Age;
- Expires.

Servlet Cookie API historically has gaps around SameSite depending version/container. You can set header manually if needed.

## 20.3 Security headers

Common headers:

```http
Strict-Transport-Security
Content-Security-Policy
X-Content-Type-Options
Referrer-Policy
Cache-Control
```

Use security filter or platform configuration.

## 20.4 Cache-Control for sensitive data

```http
Cache-Control: no-store
Pragma: no-cache
```

For sensitive pages/API responses.

## 20.5 Do not trust headers blindly

Headers like:

```http
X-Forwarded-For
X-Forwarded-Proto
X-User
```

must only be trusted from configured proxy.

## 20.6 Header injection

Validate values used in headers.

Avoid CRLF injection.

---

# 21. Multipart Upload

Servlet supports multipart upload through `@MultipartConfig` and `Part`.

## 21.1 Annotation

```java
@WebServlet("/upload")
@MultipartConfig(
    fileSizeThreshold = 1024 * 1024,
    maxFileSize = 10 * 1024 * 1024,
    maxRequestSize = 20 * 1024 * 1024
)
public class UploadServlet extends HttpServlet {
    @Override
    protected void doPost(HttpServletRequest req, HttpServletResponse resp)
            throws IOException, ServletException {
        Part file = req.getPart("file");
        ...
    }
}
```

## 21.2 Limits are mandatory

Always set:

- max file size;
- max request size;
- threshold;
- storage location if needed.

## 21.3 Never trust filename

```java
String submitted = part.getSubmittedFileName();
```

Sanitize. Do not write directly to filesystem path.

Bad:

```java
Path path = uploadDir.resolve(submittedFileName);
```

Attacker may use path traversal.

## 21.4 Content type cannot be trusted

Client-provided content type can lie.

Validate:

- extension allowlist;
- magic bytes;
- antivirus/malware scan;
- size;
- business rules.

## 21.5 Stream upload

Avoid reading entire file to memory.

Use stream:

```java
try (InputStream in = part.getInputStream()) {
    ...
}
```

## 21.6 Cleanup

Container handles temp files per rules, but application should manage copied files and failures.

## 21.7 Upload and transaction

Do not hold DB transaction while scanning/uploading large file to remote storage.

Use staged workflow.

---

# 22. Async Servlet

Async Servlet lets request processing continue without holding original container request thread.

## 22.1 Start async

```java
AsyncContext async = req.startAsync();
async.setTimeout(30_000);
executor.submit(() -> {
    try {
        HttpServletResponse resp = (HttpServletResponse) async.getResponse();
        resp.setContentType("text/plain");
        resp.getWriter().write("done");
        async.complete();
    } catch (Exception e) {
        async.complete();
    }
});
```

## 22.2 Why async?

Useful for:

- long polling;
- server push style;
- non-blocking IO integration;
- offloading slow work;
- streaming;
- resource control.

## 22.3 Async is not magic scalability

If you offload to another unbounded thread pool, you can still exhaust resources.

## 22.4 Always set timeout

```java
async.setTimeout(30000);
```

Handle timeout with `AsyncListener`.

## 22.5 Async listener

```java
async.addListener(new AsyncListener() {
    public void onComplete(AsyncEvent event) {}
    public void onTimeout(AsyncEvent event) {}
    public void onError(AsyncEvent event) {}
    public void onStartAsync(AsyncEvent event) {}
});
```

## 22.6 Context propagation

Security/CDI/request context may not automatically propagate to worker thread.

Use managed executor/context propagation where available.

## 22.7 Response ownership

Once async started, ensure exactly one path completes response.

Avoid double complete/write.

## 22.8 Async dispatch

You can dispatch:

```java
async.dispatch("/result");
```

## 22.9 Backpressure

Async endpoints need concurrency limits.

Otherwise many pending async requests can consume memory.

---

# 23. Error Handling dan Error Pages

## 23.1 `sendError`

```java
resp.sendError(HttpServletResponse.SC_NOT_FOUND);
```

Container may dispatch to error page.

## 23.2 `web.xml` error page

```xml
<error-page>
  <error-code>404</error-code>
  <location>/errors/404</location>
</error-page>

<error-page>
  <exception-type>java.lang.Throwable</exception-type>
  <location>/errors/500</location>
</error-page>
```

## 23.3 Error dispatch attributes

Error dispatch has attributes such as status code, exception, request URI.

## 23.4 JSON API error contract

For REST APIs, prefer framework exception mapper or custom filter/servlet error handling that returns consistent JSON:

```json
{
  "code": "CASE_NOT_FOUND",
  "message": "Case not found",
  "correlationId": "..."
}
```

## 23.5 Servlet error vs JAX-RS error

If exception happens before JAX-RS resource, JAX-RS exception mapper may not catch it.

Examples:

- filter exception;
- servlet container rejection;
- multipart parsing error before resource;
- auth failure;
- request too large.

## 23.6 Response committed

If response committed, error page may not apply.

## 23.7 Security

Do not expose stack trace to client.

Log server-side with correlation ID.

---

# 24. Servlet Security: Constraints, Roles, Programmatic Login

Servlet spec supports declarative and programmatic security.

## 24.1 Declarative annotation

```java
@ServletSecurity(
    @HttpConstraint(rolesAllowed = {"ADMIN"})
)
@WebServlet("/admin/*")
public class AdminServlet extends HttpServlet { ... }
```

## 24.2 Method-specific constraints

```java
@ServletSecurity(httpMethodConstraints = {
    @HttpMethodConstraint(value = "GET", rolesAllowed = {"USER"}),
    @HttpMethodConstraint(value = "POST", rolesAllowed = {"ADMIN"})
})
```

## 24.3 `web.xml` security constraints

Centralized security config possible.

## 24.4 Programmatic check

```java
if (req.isUserInRole("ADMIN")) { ... }
Principal principal = req.getUserPrincipal();
```

## 24.5 Login/logout

Servlet API includes programmatic authentication methods such as:

```java
req.login(username, password);
req.logout();
```

depending container/security setup.

## 24.6 Security filter caution

Do not build custom auth badly.

Common failures:

- bypass on FORWARD/ERROR dispatch;
- missing path normalization;
- trusting spoofed headers;
- not rotating session ID after login;
- not handling async dispatch;
- path pattern mismatch.

## 24.7 Prefer Jakarta Security / container security

Use standard security mechanisms where possible.

Custom filters should be carefully reviewed.

---

# 25. Servlet dan CDI/Jakarta EE Integration

## 25.1 Servlet as managed component?

In Jakarta EE runtime, servlets can participate in dependency injection and lifecycle integration.

Example:

```java
@WebServlet("/cases")
public class CaseServlet extends HttpServlet {

    @Inject
    CaseService service;
}
```

## 25.2 CDI scope caveat

Servlet instance is long-lived and multithreaded.

Injected request-scoped beans are usually proxies.

Do not store request-scoped actual object manually.

## 25.3 `@PostConstruct`

You can use lifecycle annotations depending runtime support.

```java
@PostConstruct
void initDependencies() {}
```

## 25.4 Transactions

Avoid putting transaction boundary directly in low-level servlet if using application service.

Better:

```java
servlet → application service @Transactional
```

## 25.5 Validation

Servlet raw input needs manual validation or delegate to service/DTO validator.

Jakarta REST integrates validation more conveniently.

## 25.6 Prefer thin servlet

Servlet should be adapter:

```text
HTTP request → command DTO → application use case → HTTP response
```

Not business logic container.

---

# 26. Servlet dan Jakarta REST: Apa yang Terjadi di Bawahnya?

Jakarta REST runtime usually integrates with servlet environment.

## 26.1 Typical flow

```text
HTTP request
  ↓
Servlet container
  ↓
filters
  ↓
JAX-RS servlet/filter/application
  ↓
resource matching
  ↓
JAX-RS filters/interceptors
  ↓
resource method
  ↓
message body writer
  ↓
servlet response
```

## 26.2 Servlet filter vs JAX-RS filter

Servlet filter runs earlier in web container pipeline.

JAX-RS filter runs within Jakarta REST runtime.

## 26.3 When use Servlet filter?

Use for:

- request correlation across all web endpoints;
- security before REST;
- CORS;
- compression;
- low-level request wrapping;
- static resources;
- all dispatches.

## 26.4 When use JAX-RS filter?

Use for:

- resource-aware REST concern;
- JAX-RS context;
- entity provider interaction;
- REST-specific headers;
- method/resource annotation.

## 26.5 Error mapper boundary

Exceptions thrown in servlet filter may not be handled by JAX-RS exception mapper.

## 26.6 Multipart

Jakarta REST has multipart support depending implementation/provider, but Servlet multipart may be underneath.

---

# 27. Threading Model dan Concurrency

## 27.1 Thread per request model

Traditional servlet container assigns a thread to request processing.

Blocking IO ties up thread.

## 27.2 Container thread pool

If all request threads blocked:

```text
new requests queued/rejected
latency spikes
timeouts
```

## 27.3 Avoid blocking slow external calls without timeout

Always use:

- connect timeout;
- read timeout;
- circuit breaker;
- bulkhead;
- request timeout.

## 27.4 Shared mutable fields

Servlet/filter/listener instances may be shared.

Use:

- local variables;
- immutable fields;
- thread-safe collaborators;
- concurrent structures where needed.

## 27.5 ThreadLocal

Filters often use ThreadLocal/MDC.

Always clear in finally.

```java
try {
    MDC.put("correlationId", id);
    chain.doFilter(req, resp);
} finally {
    MDC.remove("correlationId");
}
```

## 27.6 Request object thread safety

Do not access request/response from arbitrary thread unless async started and rules followed.

## 27.7 Background tasks

Do not start unmanaged threads in servlet.

Use managed executor/container facility.

---

# 28. Virtual Threads dan Servlet

Jakarta EE 11 supports latest Java LTS baseline and modern runtimes may expose virtual-thread options.

## 28.1 Virtual threads help blocking workloads

Virtual threads can reduce cost of blocking IO per request.

But they do not fix:

- database connection pool exhaustion;
- external service saturation;
- lock contention;
- CPU bottleneck;
- memory pressure;
- bad timeouts;
- unbounded concurrency.

## 28.2 Container support matters

Servlet spec API itself is not enough. Runtime must support/configure virtual threads.

## 28.3 ThreadLocal caution

Virtual threads still have ThreadLocal semantics but usage can have cost/propagation implications.

Avoid excessive ThreadLocal.

## 28.4 Blocking is cheaper, not free

If 10,000 requests block waiting for DB and pool has 50 connections, most are still waiting.

Need bulkheads/backpressure.

## 28.5 Test with your runtime

Do not assume virtual thread mode improves everything.

Benchmark under realistic load.

---

# 29. Performance Engineering

## 29.1 Main bottlenecks

- thread pool exhaustion;
- DB connection pool exhaustion;
- slow downstream;
- large request/response body;
- excessive logging;
- session replication;
- compression CPU;
- TLS termination;
- filter overhead;
- JSON serialization;
- file upload buffering;
- GC from allocations.

## 29.2 Timeouts

Set timeouts across layers:

- reverse proxy;
- connector;
- async timeout;
- HTTP client;
- DB query;
- transaction;
- request processing.

## 29.3 Backpressure

Use:

- max request size;
- max file size;
- connection limits;
- executor queue bounds;
- rate limit;
- circuit breaker;
- bulkhead.

## 29.4 Avoid full buffering large response

For large download, stream.

But understand error handling after commit.

## 29.5 Compression

Compression saves bandwidth but costs CPU.

Do not compress already compressed files.

## 29.6 Static resources

Let web server/CDN handle static resources when possible.

## 29.7 Session replication cost

Large session object graph can kill performance in cluster.

## 29.8 Measure

Use:

- access logs;
- JFR;
- container metrics;
- thread dumps;
- heap dumps;
- slow request logs;
- distributed tracing;
- load tests.

---

# 30. Observability: Logging, Metrics, Tracing

## 30.1 Access log

Container access logs provide:

- method;
- path;
- status;
- bytes;
- duration;
- remote IP;
- user agent.

## 30.2 Correlation ID

Use filter:

```text
if header exists and valid → use
else generate
set request attribute
put into MDC
set response header
clear MDC
```

## 30.3 Metrics

Track:

- request count;
- status code;
- latency;
- active requests;
- error count;
- request size;
- response size;
- async timeout;
- upload rejection;
- session count.

## 30.4 Tracing

Create spans at entry boundary.

Be careful with high cardinality path.

Prefer route template if available.

## 30.5 Logging body

Default no.

If debug required:

- mask;
- truncate;
- sample;
- disable in production;
- avoid binary/multipart.

## 30.6 Thread dump

For stuck servlet app, thread dump often reveals:

- blocked on DB pool;
- waiting external HTTP;
- deadlock;
- synchronized bottleneck;
- file IO;
- long GC.

---

# 31. Testing Strategy

## 31.1 Unit test servlet logic

Extract business logic to service.

Servlet unit test should be minimal.

Use mock request/response only for adapter behavior.

## 31.2 Integration test with container

Test:

- mapping;
- filters;
- listener;
- session;
- multipart;
- error page;
- security;
- async;
- headers.

## 31.3 Test filter ordering

Create test filter order log.

Assert.

## 31.4 Test response commit

Test error after partial write.

Understand behavior.

## 31.5 Test upload limits

Test:

- allowed file;
- too large file;
- wrong type;
- path traversal filename;
- malware scan failure path.

## 31.6 Test session behavior

- no session for stateless endpoint;
- session created only where expected;
- session ID changed after login;
- timeout;
- cluster if applicable.

## 31.7 Load test

Use k6/JMeter/Gatling.

Test:

- concurrency;
- slow downstream;
- large upload;
- slow client;
- timeout;
- thread pool saturation.

## 31.8 Security tests

- unauthenticated;
- wrong role;
- correct role;
- path traversal;
- header spoofing;
- CORS preflight;
- session fixation.

---

# 32. Production Failure Modes

## 32.1 Response already committed

Symptoms:

```text
Cannot call sendError() after response has been committed
```

Cause:

- wrote body before error;
- flushed output;
- buffer full;
- streaming failure.

## 32.2 Request body empty

Cause:

- filter read body before servlet;
- `getParameter` parsed form body;
- both `getReader` and `getInputStream` used.

## 32.3 Encoding corrupted

Cause:

- set encoding after reading;
- missing UTF-8;
- wrong content type;
- client sends wrong charset.

## 32.4 Filter not invoked

Cause:

- mapping mismatch;
- dispatcher type mismatch;
- ordering/config issue;
- endpoint handled outside expected context.

## 32.5 Security bypass

Cause:

- filter path mismatch;
- forward/error dispatch not secured;
- static resources exposed;
- reverse proxy header trusted blindly;
- missing security feature/config.

## 32.6 Session memory leak

Cause:

- large objects stored in session;
- session timeout too long;
- bots create sessions;
- no invalidation on logout;
- replication overhead.

## 32.7 Upload OOM/disk full

Cause:

- no multipart limits;
- threshold too high;
- temp dir fills;
- reads whole file into byte array.

## 32.8 Thread pool exhaustion

Cause:

- slow DB/downstream;
- no timeouts;
- blocking call;
- long synchronous processing;
- deadlock.

## 32.9 Async leak

Cause:

- async not completed;
- no timeout;
- executor queue unbounded;
- double complete/write race.

## 32.10 Incorrect remote IP/scheme

Cause:

- proxy headers not configured;
- app sees HTTP instead of HTTPS;
- secure cookie not set;
- redirect to wrong scheme.

---

# 33. Best Practices dan Anti-Patterns

## 33.1 Best practices

- Keep servlet thin.
- Put business logic in application service.
- Use filters for cross-cutting web concerns.
- Define filter order explicitly if important.
- Always set request/response encoding before IO.
- Do not store request state in servlet fields.
- Do not create sessions accidentally.
- Set upload limits.
- Use timeouts.
- Clear ThreadLocal/MDC.
- Do not log sensitive request body.
- Use standard security where possible.
- Test with real container.
- Monitor thread pool and request latency.

## 33.2 Anti-pattern: Business logic in servlet

Bad:

```java
doPost() {
    parse request;
    validate;
    open DB;
    update many tables;
    call external service;
    send email;
}
```

Better:

```text
Servlet parses HTTP → Application service handles use case
```

## 33.3 Anti-pattern: Mutable servlet field

```java
private User currentUser;
```

Never.

## 33.4 Anti-pattern: Reading body in logging filter

Without wrapper and limits, it breaks downstream and risks memory.

## 33.5 Anti-pattern: Unbounded upload

No `@MultipartConfig` limits.

## 33.6 Anti-pattern: Custom auth filter without threat model

Security is hard.

Use container/Jakarta Security where possible.

## 33.7 Anti-pattern: Creating session for every request

Calling `getSession()` in global filter creates sessions for static/API requests.

## 33.8 Anti-pattern: No timeout

Every external dependency call should have timeout.

---

# 34. Checklist Review

## 34.1 Servlet

- [ ] Servlet has no request-specific mutable fields.
- [ ] Business logic delegated to service.
- [ ] Status/header set before body.
- [ ] Writer/output stream not mixed.
- [ ] Encoding set before body/params.
- [ ] Errors handled consistently.

## 34.2 Filter

- [ ] Filter mapping correct.
- [ ] Dispatcher types intentional.
- [ ] Chain called or short-circuit documented.
- [ ] Order explicit if important.
- [ ] ThreadLocal/MDC cleaned.
- [ ] Body not consumed accidentally.
- [ ] Security/CORS order correct.

## 34.3 Session

- [ ] Stateless endpoints do not create session.
- [ ] Session timeout configured.
- [ ] Session size controlled.
- [ ] Session ID rotated after login.
- [ ] Cluster strategy defined.

## 34.4 Upload

- [ ] Max file size set.
- [ ] Max request size set.
- [ ] Filename sanitized.
- [ ] Content validated.
- [ ] Streamed, not fully buffered.
- [ ] Temp file cleanup considered.

## 34.5 Async

- [ ] Timeout set.
- [ ] Async complete called exactly once.
- [ ] Executor bounded/managed.
- [ ] Context propagation understood.
- [ ] Backpressure applied.

## 34.6 Production

- [ ] Access logs enabled.
- [ ] Metrics enabled.
- [ ] Thread pool monitored.
- [ ] Error pages/API errors configured.
- [ ] Reverse proxy headers trusted safely.
- [ ] Load tests cover slow downstream/upload/timeout.

---

# 35. Case Study 1: Correlation ID Filter

## 35.1 Requirement

Every request should have correlation ID:

- read `X-Correlation-ID` if valid;
- generate if absent;
- add to MDC;
- add to response;
- clear after request;
- available to application service.

## 35.2 Filter

```java
@WebFilter("/*")
public class CorrelationIdFilter implements Filter {

    private static final String HEADER = "X-Correlation-ID";

    @Override
    public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
            throws IOException, ServletException {
        HttpServletRequest req = (HttpServletRequest) request;
        HttpServletResponse resp = (HttpServletResponse) response;

        String correlationId = sanitizeOrGenerate(req.getHeader(HEADER));

        req.setAttribute("correlationId", correlationId);
        resp.setHeader(HEADER, correlationId);

        try {
            MDC.put("correlationId", correlationId);
            chain.doFilter(request, response);
        } finally {
            MDC.remove("correlationId");
        }
    }
}
```

## 35.3 Important details

- validate header length/characters;
- clear MDC in finally;
- set response header early;
- avoid trusting unbounded client value.

## 35.4 Failure mode

If MDC not cleared, next request on same thread may get wrong correlation ID.

---

# 36. Case Study 2: File Upload Memory Explosion

## 36.1 Bad code

```java
byte[] bytes = req.getPart("file").getInputStream().readAllBytes();
```

For 500MB file, memory spikes.

## 36.2 Bad config

No upload limit.

Attacker uploads huge file.

## 36.3 Better

```java
@MultipartConfig(
    fileSizeThreshold = 1024 * 1024,
    maxFileSize = 20L * 1024 * 1024,
    maxRequestSize = 25L * 1024 * 1024
)
```

Stream to controlled storage:

```java
try (InputStream in = part.getInputStream()) {
    storage.put(objectKey, in);
}
```

## 36.4 Additional controls

- content validation;
- malware scan;
- extension allowlist;
- filename sanitization;
- quota;
- rate limit;
- temp disk monitoring.

## 36.5 Lesson

Upload endpoint is security and capacity boundary.

---

# 37. Case Study 3: Session Leak pada Cluster

## 37.1 Problem

Global filter calls:

```java
req.getSession()
```

for every request.

Result:

- static resources create session;
- API calls create session;
- bot traffic creates sessions;
- memory grows;
- cluster replication expensive.

## 37.2 Fix

Use:

```java
req.getSession(false)
```

unless session creation intended.

## 37.3 Stateless API

For token-based API, avoid server session.

## 37.4 Session data

Store only small necessary data.

Do not store:

- large lists;
- entity graphs;
- uploaded files;
- security-sensitive raw data;
- non-serializable object if replication.

## 37.5 Lesson

Session is expensive shared state. Use intentionally.

---

# 38. Case Study 4: Response Sudah Commit

## 38.1 Problem

Servlet streams CSV:

```java
resp.setContentType("text/csv");
Writer w = resp.getWriter();
w.write("header\n");
for (...) {
    w.write(row);
    if (error) throw new RuntimeException();
}
```

After partial body sent, app wants JSON error.

Impossible.

## 38.2 Why?

Response headers/body already committed.

Client receives partial CSV, not JSON error.

## 38.3 Solutions

- validate before streaming;
- fail early before writing;
- use staging file then stream after success;
- include error row/trailer if protocol supports;
- make download retryable;
- log correlation ID;
- design client to handle incomplete stream.

## 38.4 Lesson

Streaming changes error handling semantics.

---

# 39. Latihan Bertahap

## Latihan 1 — Hello Servlet

Create `@WebServlet("/hello")`.

Return text response.

## Latihan 2 — Request URI parts

Deploy app under context `/app`.

Create servlet mapping `/api/*`.

Print:

- context path;
- servlet path;
- path info;
- query string.

## Latihan 3 — Filter chain

Create two filters A/B.

Log before/after.

Test ordering.

## Latihan 4 — Body logging trap

Create filter that reads body.

Observe servlet body empty.

Fix with request wrapper and size limit.

## Latihan 5 — Encoding

Send UTF-8 form/body.

Set encoding before vs after parameter read.

Compare.

## Latihan 6 — Session accidental creation

Create filter with `getSession()`.

Observe `JSESSIONID`.

Change to `getSession(false)`.

## Latihan 7 — Multipart upload

Implement upload with max size.

Test file too large.

## Latihan 8 — Async timeout

Create async servlet with timeout.

Simulate slow worker.

Handle timeout.

## Latihan 9 — Error page

Configure error page in `web.xml`.

Throw exception before and after response commit.

Observe difference.

## Latihan 10 — Security constraint

Protect `/admin/*`.

Test unauthenticated/wrong role/correct role.

---

# 40. Mini Project: Servlet Runtime Lab

## 40.1 Goal

Buat project:

```text
jakarta-servlet-runtime-lab/
```

## 40.2 Modules/features

```text
hello-servlet/
request-inspector/
filter-chain/
correlation-id/
session-lab/
multipart-upload/
async-servlet/
error-handling/
security-constraints/
performance-lab/
```

## 40.3 Deliverables

```text
README.md
REQUEST-LIFECYCLE.md
FILTER-ORDERING.md
SESSION-DESIGN.md
UPLOAD-SECURITY.md
ASYNC-DESIGN.md
ERROR-HANDLING.md
SECURITY-NOTES.md
PERFORMANCE-REPORT.md
FAILURE-MODES.md
```

## 40.4 Required experiments

1. Servlet lifecycle logs.
2. Filter chain order.
3. Dispatcher types REQUEST/FORWARD/ERROR.
4. Request body read-once behavior.
5. Response commit behavior.
6. Multipart size limit.
7. Session creation and invalidation.
8. Async timeout.
9. Security constraint.
10. Load test with slow downstream.

## 40.5 Evaluation questions

1. Who creates servlet instance?
2. Is servlet instance per request?
3. Why are servlet fields dangerous?
4. What happens if filter does not call chain?
5. Why can request body be read only once?
6. When is response committed?
7. What is dispatcher type?
8. Why can session hurt cluster performance?
9. Why must upload size be limited?
10. Why may JAX-RS exception mapper not catch filter exception?

---

# 41. Referensi Resmi

Referensi utama:

1. Jakarta Servlet 6.1  
   https://jakarta.ee/specifications/servlet/6.1/

2. Jakarta Servlet 6.1 Specification  
   https://jakarta.ee/specifications/servlet/6.1/jakarta-servlet-spec-6.1

3. Jakarta Servlet 6.1 API Docs  
   https://jakarta.ee/specifications/servlet/6.1/apidocs/

4. Jakarta Servlet Tutorial  
   https://jakarta.ee/learn/docs/jakartaee-tutorial/current/web/servlets/servlets.html

5. `HttpServletRequest` API Docs  
   https://jakarta.ee/specifications/servlet/6.1/apidocs/jakarta.servlet/jakarta/servlet/http/httpservletrequest

6. `HttpServletResponse` API Docs  
   https://jakarta.ee/specifications/servlet/6.1/apidocs/jakarta.servlet/jakarta/servlet/http/httpservletresponse

7. Jakarta Servlet project release 6.1  
   https://projects.eclipse.org/projects/ee4j.servlet/releases/6.1

8. Jakarta EE 11 Release  
   https://jakarta.ee/release/11/

9. Jakarta EE Platform 11  
   https://jakarta.ee/specifications/platform/11/

10. Jakarta Security  
    https://jakarta.ee/specifications/security/

---

# Penutup

Servlet adalah fondasi web runtime di Jakarta EE.

Walaupun kamu jarang menulis `HttpServlet` langsung, Servlet mental model membantu memahami:

```text
request lifecycle
filter chain
session management
dispatching
error handling
multipart upload
async processing
security boundary
response commit
threading model
```

Framework seperti Jakarta REST membuat web development lebih nyaman, tetapi saat production bermasalah, banyak root cause berada di layer Servlet/container.

Prinsip utama:

```text
Servlet is low-level HTTP power.
Use it carefully.
Keep it thin.
Respect lifecycle, threading, response commit, and container boundaries.
```

Engineer top-tier tidak hanya tahu endpoint bisa dibuat dengan annotation. Ia tahu request melewati pipeline apa, state disimpan di mana, kapan header terkunci, apa yang terjadi saat filter membaca body, dan bagaimana desain web runtime memengaruhi reliability.

Bagian berikutnya akan membahas **Jakarta Security (`jakarta.security.enterprise`)**: identity store, authentication mechanism, security context, roles, authorization, integration dengan Servlet/JAX-RS/CDI, dan cara membangun security boundary yang benar.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-jakarta-part-015.md](./learn-java-jakarta-part-015.md) | [🏠 Daftar Isi](../../index.md) | [Selanjutnya ➡️: learn-java-jakarta-part-017.md](./learn-java-jakarta-part-017.md)

</div>