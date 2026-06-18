# learn-java-servlet-websocket-web-container-runtime-part-007

# Part 007 — Servlet Mapping, URL Pattern, and Dispatch Resolution

> Seri: `learn-java-servlet-websocket-web-container-runtime`  
> Bagian: `007 / 031`  
> Topik: Servlet URL mapping, request-to-servlet resolution, default servlet, welcome file, static resources, SPA fallback, dan debugging routing di level container.

---

## 0. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Membaca URL request dan memprediksi servlet mana yang akan dipilih container.
2. Membedakan `contextPath`, `servletPath`, `pathInfo`, dan `queryString` tanpa menebak-nebak.
3. Memahami perbedaan exact mapping, path-prefix mapping, extension mapping, context-root mapping, dan default mapping.
4. Menjelaskan kenapa `/`, `/*`, `/api/*`, `*.jsp`, dan `/foo` punya perilaku yang sangat berbeda.
5. Mendesain mapping untuk aplikasi modern: classic servlet, Spring MVC front controller, JAX-RS servlet, JSP, static assets, dan SPA fallback.
6. Menghindari bug routing yang sering muncul di production: 404 misterius, static resource tertangkap controller, redirect salah path, error page tidak muncul, dan mapping conflict antar framework.
7. Membangun mental model bahwa routing web Java tidak dimulai di controller, melainkan di container.

---

## 1. Core Mental Model

Banyak developer berpikir alur request seperti ini:

```text
HTTP request
  -> Controller
  -> Service
  -> Repository
  -> Response
```

Untuk aplikasi Java berbasis Servlet, model itu terlalu tinggi. Urutan yang lebih akurat adalah:

```text
HTTP request bytes
  -> network connector
  -> HTTP parser
  -> virtual host / host selection
  -> web application / context selection
  -> servlet mapping resolution
  -> filter chain selection
  -> servlet service method
  -> framework router, if any
  -> application handler/controller/resource
```

Artinya, sebelum Spring MVC, JAX-RS, JSF, Struts, Vaadin, atau framework lain diberi kesempatan memilih handler, container sudah lebih dulu menjawab pertanyaan ini:

> “Untuk path ini, servlet mana yang harus menerima request?”

Framework routing biasanya baru terjadi **di dalam servlet yang sudah dipilih**.

Contoh:

```text
GET /aceas/api/applications/123 HTTP/1.1
Host: example.gov.sg
```

Bila context path adalah `/aceas`, container pertama-tama mengurangi context path dari request path:

```text
Full request path: /aceas/api/applications/123
Context path     : /aceas
Path to map      : /api/applications/123
```

Baru setelah itu container mencocokkan `/api/applications/123` terhadap servlet mappings seperti:

```xml
<url-pattern>/api/*</url-pattern>
<url-pattern>*.jsp</url-pattern>
<url-pattern>/</url-pattern>
```

Jika `/api/*` adalah mapping untuk JAX-RS servlet atau Spring `DispatcherServlet`, maka framework menerima request yang sudah “masuk” ke servlet itu. Framework kemudian melakukan routing internal, misalnya ke `@Path("/applications/{id}")` atau `@GetMapping("/applications/{id}")`.

---

## 2. Istilah Dasar: URL, Context, Servlet, dan Path

Misalkan request berikut masuk ke container:

```http
GET https://example.gov.sg/aceas/case/detail/123?tab=audit HTTP/1.1
Host: example.gov.sg
```

Anggap aplikasi dideploy dengan context path `/aceas`, dan servlet mapping-nya `/case/*`.

Maka pembagiannya kira-kira:

```text
Scheme          : https
Host            : example.gov.sg
Request URI     : /aceas/case/detail/123
Query string    : tab=audit
Context path    : /aceas
Path to map     : /case/detail/123
Servlet mapping : /case/*
Servlet path    : /case
Path info       : /detail/123
```

Di kode:

```java
String requestUri  = request.getRequestURI();      // /aceas/case/detail/123
String contextPath = request.getContextPath();     // /aceas
String servletPath = request.getServletPath();     // /case
String pathInfo    = request.getPathInfo();        // /detail/123
String queryString = request.getQueryString();     // tab=audit
```

Mental model penting:

```text
requestURI = contextPath + servletPath + pathInfo
```

Query string tidak termasuk ke dalam `requestURI`.

```text
Full visible URL path : /aceas/case/detail/123?tab=audit
requestURI            : /aceas/case/detail/123
queryString           : tab=audit
```

---

## 3. Apa Itu Context Path?

Satu servlet container dapat menjalankan banyak web application:

```text
https://example.gov.sg/aceas/...
https://example.gov.sg/cpds/...
https://example.gov.sg/admin/...
```

Masing-masing bisa menjadi web application berbeda:

```text
/aceas -> ACEAS WAR
/cpds  -> CPDS WAR
/admin -> Admin WAR
```

`contextPath` adalah prefix URL yang memilih web application.

```text
Host: example.gov.sg
Path: /aceas/api/users

Container chooses:
  context path = /aceas
  webapp       = ACEAS
  remaining    = /api/users
```

Servlet mapping hanya bekerja terhadap path **di dalam context**, bukan seluruh URL.

Jadi mapping:

```java
@WebServlet("/api/*")
```

berarti:

```text
/aceas/api/*   jika context path = /aceas
/cpds/api/*    jika context path = /cpds
/api/*         jika context path = root context ""
```

Bukan berarti mapping terhadap absolute server path `/api/*` di semua webapp.

---

## 4. Mapping Path yang Dipakai Container

Servlet specification mendefinisikan bahwa path yang dipakai untuk mapping adalah request URL path setelah dikurangi context path dan path parameters. Secara konseptual:

```text
mappingPath = requestPath - contextPath - pathParameters
```

Contoh dengan path parameter:

```http
GET /aceas/api/cases;v=1/123;tab=audit?x=1 HTTP/1.1
```

Secara praktis, container melakukan canonicalization dan memisahkan path/query/parameter sesuai aturan. Yang penting untuk mental model:

```text
context path tidak ikut dicocokkan dengan servlet mapping
query string tidak ikut dicocokkan dengan servlet mapping
path parameters tidak menentukan servlet mapping utama
```

Jadi mapping tidak bergantung pada `?tab=audit`.

```text
/api/cases/123?tab=audit
/api/cases/123?tab=documents
/api/cases/123?tab=history
```

Ketiganya masuk ke mapping servlet yang sama bila path-nya sama.

---

## 5. Jenis URL Pattern dalam Servlet

Servlet mapping memakai beberapa bentuk pattern utama:

| Pattern Type | Contoh | Makna |
|---|---:|---|
| Exact match | `/login` | Hanya cocok dengan path tertentu |
| Path-prefix match | `/api/*` | Cocok dengan path yang diawali `/api/` |
| Extension match | `*.jsp`, `*.do` | Cocok berdasarkan ekstensi path terakhir |
| Context-root match | `` atau `/` dalam konteks tertentu | Cocok root context atau default handling, tergantung bentuknya |
| Default servlet mapping | `/` | Fallback ketika tidak ada mapping lain |

Yang sering membingungkan adalah perbedaan:

```text
/foo
/foo/*
/
/*
*.jsp
```

Kelima pattern ini tidak interchangeable.

---

## 6. Exact Match

Exact mapping cocok bila path di dalam context sama persis.

```java
@WebServlet("/health")
public class HealthServlet extends HttpServlet {
    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp) throws IOException {
        resp.setContentType("text/plain");
        resp.getWriter().write("OK");
    }
}
```

Cocok:

```text
/health
```

Tidak cocok:

```text
/health/
/health/check
/healthz
```

Jika context path `/aceas`, maka URL eksternalnya:

```text
/aceas/health
```

Tetapi mapping servlet tetap:

```text
/health
```

### 6.1 Kapan Exact Mapping Dipakai?

Exact mapping cocok untuk endpoint yang benar-benar spesifik:

```text
/health
/ready
/live
/login
/logout
/callback
/saml/acs
/oauth2/callback
```

Keunggulan:

- jelas,
- tidak menangkap path lain,
- mudah diobservasi,
- kecil risiko conflict.

Kelemahan:

- tidak cocok untuk routing dinamis banyak path,
- perlu banyak mapping bila endpoint banyak,
- biasanya bukan pilihan untuk front controller modern.

---

## 7. Path-Prefix Match

Path-prefix mapping memakai bentuk:

```text
/path/*
```

Contoh:

```java
@WebServlet("/api/*")
public class ApiServlet extends HttpServlet {
    @Override
    protected void service(HttpServletRequest req, HttpServletResponse resp) throws IOException {
        resp.setContentType("text/plain");
        resp.getWriter().write("API servlet");
    }
}
```

Cocok:

```text
/api
/api/
/api/users
/api/users/123
/api/cases/123/documents
```

Tidak cocok:

```text
/apis
/xapi/users
/static/api/file.js
```

Untuk request:

```text
GET /aceas/api/users/123
```

Dengan context path `/aceas` dan mapping `/api/*`:

```text
contextPath : /aceas
servletPath : /api
pathInfo    : /users/123
```

### 7.1 Kenapa Path-Prefix Sangat Penting?

Path-prefix mapping biasanya dipakai untuk front controller:

```text
/api/*       -> JAX-RS servlet
/app/*       -> Spring DispatcherServlet
/admin/*     -> Admin servlet/framework
/ws/*        -> sometimes WebSocket-related HTTP fallback
```

Container hanya memilih servlet berdasarkan prefix. Detail routing berikutnya diserahkan ke servlet/framework.

Contoh untuk JAX-RS:

```xml
<servlet>
    <servlet-name>JAX-RS</servlet-name>
    <servlet-class>org.glassfish.jersey.servlet.ServletContainer</servlet-class>
</servlet>

<servlet-mapping>
    <servlet-name>JAX-RS</servlet-name>
    <url-pattern>/api/*</url-pattern>
</servlet-mapping>
```

Request:

```text
/aceas/api/cases/123
```

Alurnya:

```text
/aceas/api/cases/123
  -> context /aceas
  -> servlet mapping /api/*
  -> Jersey ServletContainer
  -> JAX-RS resource matching /cases/123
```

---

## 8. Extension Match

Extension mapping memakai bentuk:

```text
*.ext
```

Contoh:

```xml
<servlet-mapping>
    <servlet-name>ReportServlet</servlet-name>
    <url-pattern>*.report</url-pattern>
</servlet-mapping>
```

Cocok:

```text
/monthly.report
/revenue/2025.report
/a/b/c.report
```

Tidak cocok:

```text
/report/monthly
/report/monthly.report/detail
/report/monthly.pdf
```

Extension mapping umum di aplikasi legacy:

```text
*.do       -> Struts style
*.action   -> legacy MVC action
*.jsp      -> JSP servlet
*.faces    -> JSF
```

### 8.1 Risiko Extension Mapping

Extension mapping sering membuat sistem terlihat “magis”. Contoh:

```text
/case/detail.do
/user/search.do
/report/export.do
```

Developer modern kadang mengira `.do` adalah file sungguhan. Padahal itu hanya URL pattern yang diarahkan ke servlet/controller.

Risiko lainnya:

- bentrok dengan static resource extension,
- susah migrate ke clean REST path,
- path design bergantung pada suffix teknis,
- filter/security rule bisa salah scope.

---

## 9. Default Servlet Mapping `/`

Pattern `/` punya arti khusus: default servlet mapping.

Default servlet menerima request yang tidak cocok dengan mapping lain.

Biasanya container punya default servlet untuk static resource:

```text
/css/app.css
/js/app.js
/images/logo.png
/favicon.ico
```

Jika aplikasi menambahkan servlet mapping `/`, servlet tersebut dapat menjadi fallback untuk semua request yang tidak ditangkap exact/path/extension mapping lain.

Contoh:

```java
@WebServlet("/")
public class DefaultLikeServlet extends HttpServlet {
    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp) throws IOException {
        resp.getWriter().write("fallback");
    }
}
```

Mapping `/` tidak sama dengan `/*`.

---

## 10. Path Mapping `/*`

Pattern `/*` berarti path-prefix match dari root.

```text
/*
```

Ini cocok hampir semua path di dalam context:

```text
/
/login
/api/users
/static/app.js
/WEB-INF? no direct public access tetap container protected
```

Jika kamu mapping servlet ke `/*`, servlet itu berpotensi menangkap semua request sebelum default servlet/static resource mendapat kesempatan.

Contoh berbahaya:

```java
@WebServlet("/*")
public class CatchAllServlet extends HttpServlet {
}
```

Efek:

```text
/css/app.css  -> masuk CatchAllServlet
/js/app.js    -> masuk CatchAllServlet
/api/users    -> masuk CatchAllServlet
/favicon.ico  -> masuk CatchAllServlet
```

### 10.1 `/` vs `/*`

Perbedaan mental model:

```text
/   = default fallback setelah exact/path/extension lain gagal
/*  = path-prefix match root, sangat agresif
```

Dalam banyak aplikasi modern, `/*` untuk front controller sering menjadi sumber masalah karena static assets ikut tertangkap.

Lebih aman:

```text
/api/*
/app/*
/admin/*
```

Atau gunakan `/` hanya bila kamu benar-benar memahami interaksi dengan default servlet/static resource.

---

## 11. Precedence: Urutan Pemilihan Mapping

Servlet container memakai urutan tertentu untuk memilih mapping. Secara mental model:

```text
1. Exact match
2. Longest path-prefix match
3. Extension match
4. Default servlet mapping
```

“First successful match” bukan berarti urutan deklarasi di `web.xml` selalu menang. Yang menang adalah aturan mapping specification.

Contoh mappings:

```text
/foo/bar
/foo/*
*.do
/
```

Request:

```text
/foo/bar
```

Yang dipilih:

```text
/foo/bar  exact match
```

Request:

```text
/foo/baz
```

Yang dipilih:

```text
/foo/*    path-prefix match
```

Request:

```text
/report.do
```

Yang dipilih:

```text
*.do      extension match
```

Request:

```text
/unknown/path
```

Yang dipilih:

```text
/         default mapping
```

### 11.1 Longest Path Prefix Wins

Jika ada beberapa path-prefix mapping:

```text
/api/*
/api/admin/*
/api/admin/internal/*
```

Request:

```text
/api/admin/internal/audit
```

Yang menang:

```text
/api/admin/internal/*
```

Request:

```text
/api/admin/users
```

Yang menang:

```text
/api/admin/*
```

Request:

```text
/api/public/info
```

Yang menang:

```text
/api/*
```

Ini penting ketika memisahkan servlet untuk area berbeda.

---

## 12. Mapping Resolution Examples

### 12.1 Example A: API + Static Resource + Default

Mappings:

```text
/api/*     -> ApiServlet
*.jsp      -> JspServlet
/          -> DefaultServlet
```

Request table:

| Request Path | Selected Servlet | Reason |
|---|---|---|
| `/api/users` | `ApiServlet` | path-prefix `/api/*` |
| `/api/users/1` | `ApiServlet` | path-prefix `/api/*` |
| `/index.jsp` | `JspServlet` | extension `*.jsp` |
| `/css/app.css` | `DefaultServlet` | fallback static/default |
| `/unknown` | `DefaultServlet` | fallback default |

### 12.2 Example B: Exact Beats Path Prefix

Mappings:

```text
/api/health -> HealthServlet
/api/*      -> ApiServlet
/           -> DefaultServlet
```

Request:

```text
/api/health
```

Selected:

```text
HealthServlet
```

Request:

```text
/api/health/detail
```

Selected:

```text
ApiServlet
```

Exact `/api/health` tidak cocok dengan `/api/health/detail`.

### 12.3 Example C: Longest Prefix Beats Shorter Prefix

Mappings:

```text
/api/*       -> PublicApiServlet
/api/admin/* -> AdminApiServlet
```

Request:

```text
/api/admin/users
```

Selected:

```text
AdminApiServlet
```

### 12.4 Example D: Extension Match After Prefix

Mappings:

```text
/reports/* -> ReportServlet
*.pdf      -> PdfServlet
/          -> DefaultServlet
```

Request:

```text
/reports/monthly.pdf
```

Selected:

```text
ReportServlet
```

Karena path-prefix match dievaluasi sebelum extension match.

Jika ingin semua `.pdf` ditangani `PdfServlet`, jangan letakkan path itu di bawah prefix yang lebih dulu menang, atau desain ulang routing.

---

## 13. `HttpServletMapping`: Melihat Mapping yang Dipakai Runtime

Servlet API modern menyediakan `HttpServletMapping` melalui:

```java
HttpServletMapping mapping = request.getHttpServletMapping();
```

Contoh diagnostic servlet/filter:

```java
HttpServletMapping mapping = request.getHttpServletMapping();

log.info("mappingMatch={}, pattern={}, matchValue={}, servletName={}",
        mapping.getMappingMatch(),
        mapping.getPattern(),
        mapping.getMatchValue(),
        mapping.getServletName());
```

Ini berguna untuk menjawab:

```text
Kenapa request ini masuk servlet A, bukan servlet B?
```

Informasi yang bisa didapat:

- jenis match,
- pattern yang cocok,
- nilai yang menyebabkan match,
- nama servlet.

Contoh output konseptual:

```text
GET /aceas/api/cases/123
contextPath=/aceas
servletPath=/api
pathInfo=/cases/123
mappingMatch=PATH
pattern=/api/*
matchValue=cases/123
servletName=ApiServlet
```

Untuk debugging routing production, ini jauh lebih solid daripada menebak dari URL.

---

## 14. Annotation Mapping vs `web.xml`

Servlet dapat dideklarasikan dengan annotation:

```java
@WebServlet(
    name = "HealthServlet",
    urlPatterns = {"/health", "/ready"},
    loadOnStartup = 1
)
public class HealthServlet extends HttpServlet {
}
```

Atau dengan `web.xml`:

```xml
<servlet>
    <servlet-name>HealthServlet</servlet-name>
    <servlet-class>com.example.HealthServlet</servlet-class>
    <load-on-startup>1</load-on-startup>
</servlet>

<servlet-mapping>
    <servlet-name>HealthServlet</servlet-name>
    <url-pattern>/health</url-pattern>
</servlet-mapping>

<servlet-mapping>
    <servlet-name>HealthServlet</servlet-name>
    <url-pattern>/ready</url-pattern>
</servlet-mapping>
```

### 14.1 Kapan Annotation Cocok?

Annotation cocok untuk:

- aplikasi kecil,
- servlet sederhana,
- endpoint teknis seperti `/health`,
- contoh/tutorial,
- embedded runtime.

Kelemahan annotation:

- mapping tersebar di class,
- sulit melihat global routing table,
- bisa conflict dengan framework auto-registration,
- sulit override per environment.

### 14.2 Kapan `web.xml` Cocok?

`web.xml` cocok untuk:

- aplikasi enterprise legacy,
- banyak servlet/filter/listener,
- butuh satu tempat membaca deployment contract,
- kontrol ordering lebih eksplisit,
- migrasi dari Java EE lama.

Kelemahan:

- verbose,
- mudah drift dari kode,
- developer modern jarang membaca dengan teliti.

### 14.3 Programmatic Registration

Servlet juga bisa didaftarkan secara programmatic melalui initializer/framework.

Contoh konsep:

```java
public class AppInitializer implements ServletContainerInitializer {
    @Override
    public void onStartup(Set<Class<?>> classes, ServletContext ctx) {
        ServletRegistration.Dynamic reg = ctx.addServlet("api", new ApiServlet());
        reg.addMapping("/api/*");
        reg.setLoadOnStartup(1);
    }
}
```

Framework modern sering memakai mekanisme sejenis untuk auto-configure servlet/filter/listener.

Implikasi:

> Mapping aplikasi tidak selalu terlihat di `web.xml` atau annotation. Bisa berasal dari framework registration.

---

## 15. Welcome File Resolution

Welcome file adalah file/resource yang dipakai ketika user mengakses directory path.

Contoh `web.xml`:

```xml
<welcome-file-list>
    <welcome-file>index.html</welcome-file>
    <welcome-file>index.jsp</welcome-file>
</welcome-file-list>
```

Request:

```text
GET /aceas/
```

Container mencoba:

```text
/aceas/index.html
/aceas/index.jsp
```

Jika ada, resource itu digunakan.

### 15.1 Welcome File dan Servlet Mapping

Welcome file bukan hanya static file. Ia bisa mengarah ke resource yang kemudian diproses servlet mapping.

Contoh:

```xml
<welcome-file-list>
    <welcome-file>home</welcome-file>
</welcome-file-list>
```

Jika `/home` adalah exact servlet mapping, request `/` bisa diarahkan ke servlet tersebut.

### 15.2 Common Bug: Welcome File di `/WEB-INF`

Resource di `/WEB-INF` tidak bisa diakses langsung oleh client. Jadi ini sering gagal:

```xml
<welcome-file-list>
    <welcome-file>WEB-INF/jsp/index.jsp</welcome-file>
</welcome-file-list>
```

Pattern yang lebih umum:

```text
GET /
  -> HomeServlet
  -> forward /WEB-INF/jsp/index.jsp
```

`/WEB-INF` cocok untuk view internal yang hanya bisa dicapai melalui forward server-side, bukan direct public URL.

---

## 16. Static Resource Serving

Static resource biasanya disajikan oleh default servlet container.

Contoh:

```text
/src/main/webapp/css/app.css
/src/main/webapp/js/app.js
/src/main/webapp/images/logo.png
```

URL:

```text
/css/app.css
/js/app.js
/images/logo.png
```

Jika tidak ada servlet mapping lain yang menangkap path tersebut, default servlet akan mencoba menyajikan file.

### 16.1 Masalah Saat Front Controller Terlalu Agresif

Mapping:

```text
/* -> DispatcherServlet
```

Efek:

```text
/css/app.css -> DispatcherServlet
/js/app.js   -> DispatcherServlet
```

Jika framework tidak dikonfigurasi untuk meneruskan static resource, hasilnya:

```text
404 static resource
```

Atau lebih buruk:

```text
HTML fallback dikirim untuk file JS
browser error: Unexpected token '<'
```

### 16.2 Strategi Aman

Pisahkan prefix:

```text
/api/*      -> API servlet/framework
/assets/*   -> default/static resource
/           -> SPA fallback/default
```

Atau gunakan framework static resource handling dengan sadar.

---

## 17. SPA Fallback Routing

Aplikasi SPA seperti Vue/React/Angular sering punya URL client-side:

```text
/app/dashboard
/app/cases/123
/app/settings/users
```

Secara browser, saat refresh di `/app/cases/123`, server menerima request HTTP sungguhan ke path itu.

Jika server tidak tahu fallback, hasilnya 404.

### 17.1 Pattern SPA Fallback

Target:

```text
/app/**       -> kirim index.html
/assets/**    -> static assets asli
/api/**       -> API backend, bukan index.html
```

Servlet mental model:

```text
/api/*       -> ApiServlet
/assets/*    -> static/default
/app/*       -> SpaFallbackServlet
/            -> maybe redirect to /app/
```

Contoh servlet fallback sederhana:

```java
@WebServlet("/app/*")
public class SpaFallbackServlet extends HttpServlet {
    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp)
            throws ServletException, IOException {

        String pathInfo = req.getPathInfo();

        if (pathInfo != null && pathInfo.contains(".")) {
            resp.sendError(HttpServletResponse.SC_NOT_FOUND);
            return;
        }

        req.getRequestDispatcher("/index.html").forward(req, resp);
    }
}
```

Catatan:

- fallback hanya untuk route app,
- jangan fallback API error menjadi `index.html`,
- jangan fallback static asset missing menjadi `index.html`,
- pastikan cache header `index.html` berbeda dari hashed assets.

### 17.2 Production Bug Umum

Bug:

```text
GET /api/users returns index.html
```

Gejala di frontend:

```text
SyntaxError: Unexpected token '<'
```

Akar masalah:

```text
SPA fallback terlalu luas dan menangkap /api/*
```

Solusi:

```text
/api/* harus menang sebelum SPA fallback
atau fallback harus mengecualikan /api
```

---

## 18. Error Page Mapping

Servlet container dapat memetakan error status atau exception ke resource tertentu.

Contoh:

```xml
<error-page>
    <error-code>404</error-code>
    <location>/WEB-INF/errors/404.jsp</location>
</error-page>

<error-page>
    <exception-type>java.lang.Throwable</exception-type>
    <location>/WEB-INF/errors/500.jsp</location>
</error-page>
```

Ketika error terjadi, container melakukan **error dispatch** ke location.

Ini bukan redirect browser. URL di browser biasanya tetap sama.

### 18.1 Error Page dan API

Aplikasi modern sering perlu membedakan:

```text
/api/* -> JSON error
/web/* -> HTML error
```

Jika semua error diarahkan ke JSP HTML, API client bisa menerima HTML ketika mengharapkan JSON.

Contoh buruk:

```json
Expected JSON, got '<html>...'
```

Strategi:

- error handling framework untuk API,
- fallback error page HTML untuk browser,
- filter/error servlet yang melihat `Accept` header atau path prefix,
- jangan satu global HTML error page untuk semua surface.

### 18.2 Error Dispatch dan Mapping

Error page location juga melewati dispatching rules. Jika location `/error` adalah servlet mapping, maka servlet itu akan dipanggil pada dispatcher type `ERROR`.

Filter juga bisa dikonfigurasi untuk `ERROR` dispatcher type. Ini akan dibahas lebih dalam di Part 008 dan 009.

---

## 19. RequestDispatcher: Mapping Internal vs Client URL

`RequestDispatcher` memungkinkan server meneruskan request ke resource lain tanpa redirect ke client.

```java
request.getRequestDispatcher("/WEB-INF/jsp/detail.jsp")
       .forward(request, response);
```

Browser tetap melihat URL lama.

```text
Browser URL : /case/123
Server view : /WEB-INF/jsp/detail.jsp
```

Forward berbeda dari redirect:

```text
forward  = server-side transfer, satu request
redirect = client disuruh request URL baru
```

Mapping tetap relevan karena forward target bisa berupa:

- servlet,
- JSP,
- static resource,
- error page,
- internal resource.

Contoh:

```java
request.getRequestDispatcher("/api/internal/status").forward(req, resp);
```

Jika `/api/*` mapped ke ApiServlet, forward itu masuk ke ApiServlet dengan dispatcher type `FORWARD`.

---

## 20. Servlet Name Mapping

Selain URL mapping, beberapa mekanisme bisa dispatch berdasarkan nama servlet.

Contoh filter mapping by servlet name:

```xml
<filter-mapping>
    <filter-name>AuditFilter</filter-name>
    <servlet-name>ApiServlet</servlet-name>
</filter-mapping>
```

Ini berarti filter berlaku untuk request yang diarahkan ke servlet bernama `ApiServlet`, terlepas dari URL pattern yang dipakai.

Kapan berguna?

- satu servlet punya banyak URL pattern,
- ingin filter mengikuti servlet target, bukan path,
- internal forward bisa tetap dikenali berdasarkan servlet.

Namun untuk readability, URL-pattern filter mapping biasanya lebih mudah dipahami.

---

## 21. Multi-Framework Mapping

Aplikasi enterprise sering punya beberapa web technology sekaligus:

```text
/api/*          -> JAX-RS
/mvc/*          -> Spring MVC
/faces/*        -> JSF
*.jsp           -> JSP servlet
/assets/*       -> static assets
/ws/*           -> WebSocket handshake or related endpoint
/               -> default servlet or SPA fallback
```

Masalah muncul ketika mapping overlap.

### 21.1 Contoh Conflict

```text
/*       -> Spring DispatcherServlet
/api/*   -> Jersey ServletContainer
```

Request:

```text
/api/cases
```

Secara aturan, `/api/*` lebih spesifik dibanding `/*`, jadi `/api/*` menang.

Tetapi jika framework melakukan programmatic registration berbeda, atau filter chain memodifikasi request, debugging bisa sulit.

### 21.2 Prinsip Desain

Gunakan prefix jelas:

```text
/api/*       API machine-to-machine/browser API
/admin/*     admin UI/controller
/app/*       SPA fallback
/assets/*    static assets
/health      health exact endpoint
/ready       readiness exact endpoint
```

Hindari mencampur:

```text
/api/*.do
/*.action
/*
/
```

kecuali sedang memelihara legacy.

---

## 22. Mapping dan Reverse Proxy

Reverse proxy bisa mengubah path sebelum sampai ke servlet container.

Contoh external URL:

```text
https://example.gov.sg/aceas/api/cases
```

Proxy bisa meneruskan ke app sebagai:

```text
http://aceas-service:8080/aceas/api/cases
```

atau strip prefix:

```text
http://aceas-service:8080/api/cases
```

Ini sangat mempengaruhi `contextPath`.

### 22.1 Prefix Preserved

Jika app dideploy dengan context `/aceas` dan proxy preserve prefix:

```text
External : /aceas/api/cases
Internal : /aceas/api/cases
Context  : /aceas
Mapping  : /api/*
```

Ini konsisten.

### 22.2 Prefix Stripped

Jika proxy strip `/aceas`:

```text
External : /aceas/api/cases
Internal : /api/cases
Context  : root context
Mapping  : /api/*
```

Ini juga bisa benar, tetapi aplikasi harus tahu external prefix untuk redirect/link generation.

### 22.3 Common Bug: Double Context Path

App generate redirect:

```text
/aceas/login
```

Proxy menambahkan prefix lagi:

```text
/aceas/aceas/login
```

Akar masalah sering bukan servlet mapping, melainkan mismatch antara:

- context path internal,
- external path prefix,
- forwarded headers,
- proxy rewrite rule,
- framework base URL configuration.

---

## 23. Mapping dan Security Boundary

Walaupun security detail tidak dibahas di seri ini, mapping sangat mempengaruhi security.

Contoh salah:

```xml
<security-constraint>
    <web-resource-collection>
        <url-pattern>/admin/*</url-pattern>
    </web-resource-collection>
</security-constraint>
```

Tetapi servlet admin sebenarnya mapped ke:

```text
/internal-admin/*
```

Atau ada endpoint exact:

```text
/admin
```

yang tidak tertangkap oleh asumsi `/admin/*` pada beberapa ekspektasi developer.

Prinsip:

```text
Security path rule harus diuji terhadap servlet mapping aktual.
```

Jangan menganggap `/admin/*` otomatis melindungi `/admin` atau sebaliknya tanpa memverifikasi behavior container dan config.

---

## 24. Mapping dan Filter Chain

Filter bisa mapped ke URL pattern yang sama atau berbeda dari servlet.

Contoh:

```text
Filter: /api/*
Servlet: /api/*
```

Ini jelas.

Tapi bisa juga:

```text
Filter: /*
Servlet: /api/*
```

Maka static resource juga melewati filter.

Atau:

```text
Filter: *.jsp
Servlet: /app/*
```

Jika servlet `/app/*` forward ke JSP di `/WEB-INF`, filter `*.jsp` hanya ikut jika dispatcher type dan mapping mendukung forward/include sesuai konfigurasi.

Ini akan dibahas detail di Part 009, tapi untuk sekarang ingat:

> Servlet mapping menentukan target utama. Filter mapping menentukan chain sebelum/sesudah target. Keduanya terkait, tapi bukan hal yang sama.

---

## 25. Designing a Clean Mapping Table

Untuk aplikasi enterprise modern, mulai dari mapping table eksplisit.

Contoh:

| Surface | URL Pattern | Handler | Notes |
|---|---|---|---|
| Health | `/health` | Health servlet/controller | exact, no auth maybe internal only |
| Readiness | `/ready` | Readiness servlet/controller | exact |
| API | `/api/*` | JAX-RS/Spring API servlet | JSON |
| Admin API | `/admin/api/*` | Admin API servlet | stronger auth |
| Static assets | `/assets/*` | default/static handler | cache long |
| SPA routes | `/app/*` | SPA fallback | index.html only |
| JSP internal | `/WEB-INF/jsp/*` | not public | forward only |
| Error | `/error` | Error servlet | JSON/HTML negotiation |
| Root | `/` | redirect/fallback/default | carefully designed |

Kemudian validasi:

```text
/api/users             -> API, JSON
/assets/app.123.js     -> static, JS
/app/cases/1           -> SPA index.html
/app/assets/app.js     -> should this exist? decide explicitly
/health                -> health
/unknown               -> 404 or redirect? decide explicitly
```

---

## 26. Bad Mapping Smells

### 26.1 Everything Uses `/*`

```text
/* -> MainServlet
```

Smell:

- static resource conflict,
- API fallback ambiguity,
- error handling ambiguity,
- security rule becomes broad and brittle.

### 26.2 API and UI Share Same Prefix

```text
/app/users        -> SPA route
/app/users/list   -> API endpoint
/app/users.jsp    -> JSP
```

Smell:

- hard to separate browser page from machine API,
- content negotiation bugs,
- cache/security confusion.

Better:

```text
/app/*        -> UI route
/api/*        -> JSON API
/assets/*     -> static
```

### 26.3 Extension Mapping for New API

```text
/createUser.do
/updateCase.action
/export.report
```

Acceptable for legacy. For new design, prefer resource-oriented path unless there is a real compatibility reason.

### 26.4 Static Assets Under Dynamic Prefix

```text
/api/js/app.js
/api/css/app.css
```

Smell:

- API filters may affect assets,
- wrong cache policy,
- auth may accidentally protect public static resources,
- fallback may return JSON for assets or HTML for API.

---

## 27. Debugging 404: A Structured Method

When request returns 404, jangan langsung lihat controller.

Gunakan sequence:

```text
1. Did request reach the container?
2. Did host/virtual host match?
3. Did context path match a deployed webapp?
4. Did servlet mapping match?
5. Did filter reject/short-circuit?
6. Did servlet/framework route match?
7. Did application intentionally return 404?
8. Did proxy rewrite response?
```

### 27.1 Example: Controller Exists But Still 404

Symptom:

```text
GET /aceas/api/cases/123 -> 404
```

JAX-RS resource exists:

```java
@Path("/cases/{id}")
public class CaseResource { ... }
```

Check mapping:

```xml
<url-pattern>/rest/*</url-pattern>
```

Actual correct URL:

```text
/aceas/rest/cases/123
```

Akar masalah:

```text
Framework route benar, servlet mapping prefix salah diasumsikan.
```

### 27.2 Example: Static Resource 404

Symptom:

```text
GET /assets/app.js -> 404
```

Possible causes:

```text
file missing from WAR
wrong context path
front controller catches /assets/*
default servlet disabled/replaced
proxy strips /assets
case-sensitive path mismatch
cache refers old hashed filename
```

---

## 28. Debugging 405: Method Not Allowed

405 berarti target ditemukan, tetapi HTTP method tidak didukung.

Contoh:

```java
@WebServlet("/submit")
public class SubmitServlet extends HttpServlet {
    @Override
    protected void doPost(HttpServletRequest req, HttpServletResponse resp) {
    }
}
```

Request:

```text
GET /submit
```

Akan masuk servlet, tetapi `doGet` tidak dioverride. `HttpServlet` default behavior dapat mengembalikan 405.

Debugging:

```text
404 = mapping/route/resource not found
405 = target found but method unsupported
```

Namun hati-hati: framework bisa mengubah behavior.

---

## 29. Debugging 302/Redirect Loop

Redirect loop sering terkait mapping/context/proxy.

Contoh:

```text
GET /aceas
  -> redirect /aceas/
GET /aceas/
  -> redirect /aceas/login
GET /aceas/login
  -> redirect /aceas/aceas/login
```

Possible causes:

- context path digabung manual,
- proxy prefix ditambahkan dua kali,
- app tidak percaya `X-Forwarded-Proto`,
- HTTP dianggap bukan HTTPS sehingga redirect ke HTTPS terus,
- trailing slash canonicalization salah.

Prinsip:

```java
String target = request.getContextPath() + "/login";
response.sendRedirect(response.encodeRedirectURL(target));
```

Tetapi di reverse proxy complex, framework-level forwarded header config juga harus benar.

---

## 30. Trailing Slash Semantics

Mapping exact `/foo` tidak sama dengan `/foo/`.

```text
/foo   != /foo/
```

Path-prefix `/foo/*` biasanya cocok dengan:

```text
/foo/
/foo/bar
```

Dan dalam banyak container, `/foo` juga diperlakukan sesuai special path-prefix behavior untuk mapping `/foo/*`, tetapi jangan bergantung pada intuisi tanpa test.

Desain rule:

- pilih canonical form,
- redirect non-canonical ke canonical,
- jangan biarkan `/foo` dan `/foo/` punya behavior berbeda tanpa sengaja.

Contoh:

```text
/api/cases      canonical collection
/api/cases/     either redirect or also accepted intentionally
```

Untuk API, biasanya lebih aman menerima keduanya atau melakukan redirect konsisten, tergantung client compatibility.

---

## 31. Path Normalization and Encoded Characters

Request path bisa mengandung hal-hal tricky:

```text
/a/../b
/a/%2e%2e/b
/a//b
/a/%2F/b
/a;b=1/c
```

Container melakukan decoding/canonicalization berdasarkan aturan dan konfigurasi. Ini berdampak pada:

- servlet mapping,
- security constraint,
- static resource serving,
- path traversal prevention,
- reverse proxy consistency.

Prinsip top-tier:

```text
Jangan membuat security decision dari raw path yang belum dinormalisasi secara jelas.
```

Jika app menggunakan path untuk file/resource lookup:

```java
Path base = Paths.get("/safe/base").toRealPath();
Path target = base.resolve(userPath).normalize().toRealPath();

if (!target.startsWith(base)) {
    throw new SecurityException("Path traversal attempt");
}
```

Jangan percaya bahwa servlet mapping saja cukup melindungi file system path.

---

## 32. Mapping in Embedded Spring Boot / Jakarta Apps

Walaupun seri ini bukan Spring Boot series, banyak aplikasi Servlet modern berjalan embedded.

Dalam embedded model, servlet mapping bisa datang dari:

- auto-configured `DispatcherServlet`,
- `ServletRegistrationBean`,
- `FilterRegistrationBean`,
- servlet annotations if scanning enabled,
- framework-specific property.

Contoh konseptual:

```java
@Bean
ServletRegistrationBean<MyServlet> myServlet() {
    ServletRegistrationBean<MyServlet> bean =
            new ServletRegistrationBean<>(new MyServlet(), "/legacy/*");
    bean.setName("legacyServlet");
    return bean;
}
```

Mental model tetap sama:

```text
embedded container still performs servlet mapping before framework routing
```

Yang berubah hanya sumber konfigurasinya.

---

## 33. Mapping in JAX-RS Applications

JAX-RS biasanya memiliki dua level mapping:

```text
Servlet mapping level : /api/*
JAX-RS application    : @ApplicationPath or framework config
Resource path         : @Path
```

Contoh:

```java
@ApplicationPath("/api")
public class MyApplication extends Application {
}
```

Resource:

```java
@Path("/cases")
public class CaseResource {
    @GET
    @Path("/{id}")
    public Response get(@PathParam("id") String id) {
        return Response.ok().build();
    }
}
```

URL:

```text
/context/api/cases/123
```

Jika menggunakan web.xml servlet mapping dan `@ApplicationPath` sekaligus, pastikan tidak double-prefix:

```text
/api/api/cases
```

Common migration bug:

```text
Before: /rest/cases
After : /api/rest/cases
```

karena prefix didefinisikan di dua tempat.

---

## 34. Mapping in WebSocket Context

WebSocket endpoint juga hidup di web application context.

Contoh:

```java
@ServerEndpoint("/ws/notifications/{userId}")
public class NotificationSocket {
}
```

External URL dengan context `/aceas`:

```text
wss://example.gov.sg/aceas/ws/notifications/123
```

Walaupun WebSocket handshake diawali HTTP upgrade, endpoint resolution WebSocket punya mekanisme sendiri di container. Namun tetap penting memahami context path dan proxy path.

Common bug:

```text
Frontend connects to /ws/notifications
App deployed under /aceas
Correct path should be /aceas/ws/notifications
```

Atau proxy strips prefix sehingga internal path berbeda dari external path.

WebSocket akan dibahas detail di Part 021–025.

---

## 35. Production Mapping Checklist

Sebelum release aplikasi Servlet/WebSocket, buat tabel dan uji minimal:

```text
[ ] Apa context path internal?
[ ] Apa external base path di reverse proxy?
[ ] Apakah proxy preserve atau strip prefix?
[ ] Apa mapping API utama?
[ ] Apa mapping static assets?
[ ] Apa mapping SPA fallback?
[ ] Apa mapping health/readiness?
[ ] Apa mapping error page?
[ ] Apakah / dan /* dipakai dengan sadar?
[ ] Apakah exact endpoint penting tertimpa prefix mapping?
[ ] Apakah extension mapping legacy masih diperlukan?
[ ] Apakah /WEB-INF tidak diekspos langsung?
[ ] Apakah redirect memakai context path dengan benar?
[ ] Apakah API 404 mengembalikan JSON, bukan HTML fallback?
[ ] Apakah missing JS/CSS tidak mengembalikan index.html?
[ ] Apakah WebSocket URL memasukkan context path external yang benar?
```

---

## 36. Failure Model: Routing as State Machine

Modelkan request mapping sebagai state machine:

```text
START
  -> parse HTTP request
  -> select host
  -> select context
      if no context: 404
  -> compute mapping path
  -> find servlet mapping
      if exact match: selected
      else if longest path-prefix: selected
      else if extension: selected
      else if default: selected
      else 404
  -> build filter chain
  -> invoke servlet
  -> framework route, if any
      if no framework route: 404/405
  -> produce response
END
```

Dengan model ini, bug bisa diklasifikasikan:

| Failure | State yang Gagal | Contoh |
|---|---|---|
| Wrong host | select host | domain baru belum diarahkan |
| Wrong context | select context | `/aceas` tidak deployed |
| Wrong servlet | find servlet mapping | `/api/*` vs `/rest/*` |
| Static missing | default servlet/resource | file tidak ada di WAR |
| Framework 404 | framework route | servlet benar, controller/resource tidak cocok |
| 405 | method dispatch | servlet/resource ada, method tidak support |
| Wrong fallback | default/fallback | SPA index menangkap API |
| Redirect loop | response path generation | context/proxy mismatch |

---

## 37. Concrete Mini-Lab

Buat tiga servlet:

```java
@WebServlet(name = "ExactServlet", urlPatterns = "/api/health")
public class ExactServlet extends HttpServlet {
    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp) throws IOException {
        write(req, resp, "ExactServlet");
    }

    static void write(HttpServletRequest req, HttpServletResponse resp, String name) throws IOException {
        HttpServletMapping m = req.getHttpServletMapping();
        resp.setContentType("text/plain");
        resp.getWriter().printf("""
                servlet=%s
                requestURI=%s
                contextPath=%s
                servletPath=%s
                pathInfo=%s
                queryString=%s
                mappingMatch=%s
                pattern=%s
                matchValue=%s
                servletName=%s
                """,
                name,
                req.getRequestURI(),
                req.getContextPath(),
                req.getServletPath(),
                req.getPathInfo(),
                req.getQueryString(),
                m.getMappingMatch(),
                m.getPattern(),
                m.getMatchValue(),
                m.getServletName());
    }
}
```

```java
@WebServlet(name = "ApiServlet", urlPatterns = "/api/*")
public class ApiServlet extends HttpServlet {
    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp) throws IOException {
        ExactServlet.write(req, resp, "ApiServlet");
    }
}
```

```java
@WebServlet(name = "FallbackServlet", urlPatterns = "/")
public class FallbackServlet extends HttpServlet {
    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp) throws IOException {
        ExactServlet.write(req, resp, "FallbackServlet");
    }
}
```

Test:

```text
/api/health
/api/health/detail
/api/users/123
/index.html
/unknown
```

Prediksi dulu servlet mana yang akan dipanggil, baru jalankan.

Expected mental output:

```text
/api/health         -> ExactServlet
/api/health/detail  -> ApiServlet
/api/users/123      -> ApiServlet
/index.html         -> FallbackServlet or static/default depending config
/unknown            -> FallbackServlet
```

Tambahkan extension servlet:

```java
@WebServlet(name = "DoServlet", urlPatterns = "*.do")
public class DoServlet extends HttpServlet { ... }
```

Test:

```text
/report.do
/api/report.do
```

Prediksi:

```text
/report.do      -> DoServlet
/api/report.do  -> ApiServlet, because path-prefix /api/* beats extension *.do
```

---

## 38. Design Heuristics for Top-Tier Engineers

1. **Jangan mulai dari controller. Mulai dari URL surface.**  
   Definisikan public contract path, lalu mapping container, lalu framework route.

2. **Pisahkan machine API dan browser UI.**  
   Gunakan `/api/*` untuk API dan `/app/*` untuk SPA/UI bila memungkinkan.

3. **Gunakan exact mapping untuk endpoint teknis.**  
   `/health`, `/ready`, `/metrics`, `/callback` lebih aman sebagai exact mapping.

4. **Hindari `/*` kecuali benar-benar perlu.**  
   Catch-all mapping sering menciptakan static resource dan fallback bugs.

5. **Pahami `/` sebagai default mapping, bukan root-only endpoint.**  
   `/` bukan hanya `/context/`; ia dapat menjadi fallback default.

6. **Jangan campur prefix tanpa alasan.**  
   `/api`, `/assets`, `/app`, `/admin` harus punya semantic boundary jelas.

7. **Debug dengan runtime mapping, bukan asumsi.**  
   Gunakan `request.getHttpServletMapping()` di diagnostic filter/servlet.

8. **Selalu pikirkan proxy path.**  
   External URL dan internal servlet path bisa berbeda karena rewrite/strip prefix.

9. **Tes 404 dan fallback secara eksplisit.**  
   Missing API harus JSON 404; missing asset harus 404; unknown SPA route boleh index.html.

10. **Treat routing as compatibility contract.**  
    Mengubah servlet mapping bisa menjadi breaking change walaupun controller code tidak berubah.

---

## 39. Ringkasan

Servlet mapping adalah tahap routing paling awal di aplikasi Java web. Framework routing baru berjalan setelah container memilih servlet. Karena itu, engineer yang kuat tidak hanya tahu `@GetMapping`, `@Path`, atau `@WebServlet`, tetapi bisa menjawab:

```text
Untuk URL ini:
- context mana yang dipilih?
- path mana yang dicocokkan?
- mapping pattern mana yang menang?
- filter chain mana yang berlaku?
- servlet mana yang dipanggil?
- framework route mana yang dipakai setelah itu?
```

Mental model utama:

```text
requestURI = contextPath + servletPath + pathInfo
```

Mapping precedence utama:

```text
exact match
  -> longest path-prefix match
  -> extension match
  -> default mapping
```

Perbedaan penting:

```text
/   = default fallback mapping
/*  = aggressive root path-prefix mapping
```

Dan prinsip desain production:

```text
Mapping bukan detail konfigurasi kecil.
Mapping adalah public protocol boundary aplikasi.
```

---

## 40. Referensi

- Jakarta Servlet 6.1 Specification — Servlet mapping, request path, deployment, dispatching.
- Jakarta Servlet 6.1 API — `HttpServletRequest`, `HttpServletMapping`, `ServletRegistration`, `RequestDispatcher`.
- Apache Tomcat 11 Servlet 6.1 API documentation.
- RFC 9110 — HTTP Semantics, untuk memahami request target, status code, dan semantics HTTP di bawah Servlet.

---

## 41. Status Seri

Part ini adalah:

```text
Part 007 dari 031
```

Seri belum selesai. Lanjut ke part berikutnya:

```text
learn-java-servlet-websocket-web-container-runtime-part-008.md
```

Topik berikutnya:

```text
Request Dispatching: Forward, Include, Async, Error
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-servlet-websocket-web-container-runtime-part-006.md">⬅️ Part 006 — Response Object Internals: `HttpServletResponse`</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-servlet-websocket-web-container-runtime-part-008.md">Part 008 — Request Dispatching: Forward, Include, Async, Error ➡️</a>
</div>
