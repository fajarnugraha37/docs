# learn-java-eclipse-jersey-deployment-models-part-006

# Part 6 — Jersey as Servlet Filter: Filter-Based Deployment Model

> Seri: **Java Eclipse Jersey Deployment Models**  
> Part: **6 dari 32**  
> Target pembaca: engineer Java yang sudah memahami JAX-RS/Jakarta REST, Servlet, Jersey runtime, packaging, dan basic deployment, lalu ingin naik ke level production architecture.  
> Rentang Java: **Java 8 sampai Java 25**  
> Rentang Jersey: **Jersey 2.x (`javax.*`)**, **Jersey 3.x (`jakarta.*`)**, **Jersey 4.x / Jakarta REST 4.0 era**

---

## 0. Tujuan Part Ini

Pada part sebelumnya kita membahas Jersey sebagai **Servlet**: request masuk ke servlet container, mapping mengarah ke `org.glassfish.jersey.servlet.ServletContainer`, lalu Jersey mengambil alih request tersebut sebagai JAX-RS/Jakarta REST request.

Part ini membahas model yang mirip tetapi secara arsitektural berbeda: **Jersey dipasang sebagai Servlet Filter**.

Di level pemula, perbedaannya tampak kecil:

- servlet model: Jersey adalah endpoint target;
- filter model: Jersey berada di dalam filter chain.

Namun di level production, perbedaannya sangat besar. Servlet filter bukan hanya cara alternatif mendaftarkan Jersey. Filter adalah mekanisme yang dapat:

- melihat request sebelum resource akhir dipanggil;
- melihat response setelah resource menghasilkan output;
- meneruskan request ke filter/servlet berikutnya;
- menghentikan chain dan menulis response sendiri;
- membungkus request/response object;
- ikut dalam dispatcher type tertentu seperti request biasa, forward, include, async, atau error;
- berinteraksi dengan security filter, logging filter, compression filter, static file handling, error page handling, dan reverse proxy assumptions.

Karena itu, **Jersey as Filter** harus dipahami sebagai deployment model yang mengubah ownership request.

Mental model utama:

> Ketika Jersey dipasang sebagai servlet, Jersey adalah terminal handler untuk mapping tertentu.  
> Ketika Jersey dipasang sebagai filter, Jersey adalah peserta dalam pipeline, dan pipeline itu dapat memiliki handler sebelum dan sesudah Jersey.

Sumber resmi Jersey menjelaskan bahwa aplikasi Jersey dapat dipublikasikan di Java SE environment atau container environment, dan container environment mencakup servlet-based deployment. Jersey juga mendokumentasikan deployment via `web.xml`, initialization parameters, servlet/filter-style registration, dan package scanning. Dokumentasi Jakarta Servlet mendefinisikan filter sebagai object yang melakukan filtering terhadap request, response, atau keduanya, serta `FilterChain` sebagai invocation chain untuk filtered request.

---

## 1. Apa Itu Servlet Filter dalam Konteks Jersey?

Servlet filter adalah komponen container-level yang berada di depan, di belakang, atau di sekitar target resource.

Secara konseptual:

```text
HTTP client
  |
  v
Servlet container connector
  |
  v
Filter 1
  |
  v
Filter 2
  |
  v
Jersey-as-filter
  |
  v
Filter / Servlet / Static resource berikutnya
  |
  v
Response kembali melewati chain secara reverse
```

Namun ketika Jersey menjadi filter, ada dua pola besar:

1. **Jersey terminal filter**  
   Jersey menangani request dan tidak meneruskan request ke target berikutnya jika cocok dengan JAX-RS resource.

2. **Jersey pass-through filter**  
   Jersey mencoba menangani request tertentu, tetapi request yang tidak cocok diteruskan ke chain berikutnya, misalnya static content, default servlet, JSP, atau servlet lain.

Perbedaan ini penting karena bug production sering muncul dari pertanyaan sederhana:

> Bila tidak ada JAX-RS resource yang cocok, apakah request harus 404 dari Jersey, atau diteruskan ke servlet/static handler lain?

Jawaban salah dapat membuat:

- static files tiba-tiba 404;
- SPA fallback gagal;
- `/index.html` ditangani Jersey padahal harus static;
- CORS preflight masuk chain yang salah;
- auth filter memblokir static asset;
- error page tidak terpanggil;
- monitoring endpoint salah diekspos;
- reverse proxy health check gagal;
- request forward dari MVC/JSP ditangkap Jersey secara tidak sengaja.

---

## 2. Kapan Jersey sebagai Filter Masuk Akal?

Jersey sebagai servlet biasanya lebih bersih untuk REST API murni. Filter-based deployment lebih cocok ketika aplikasi web bukan hanya API.

Gunakan Jersey sebagai filter ketika:

1. Satu WAR memiliki beberapa jenis handler:
   - JAX-RS API;
   - static file;
   - JSP/Facelets/server-side UI;
   - legacy servlet;
   - default servlet;
   - custom download servlet;
   - admin servlet;
   - monitoring servlet.

2. Ada kebutuhan pass-through:
   - request API ditangani Jersey;
   - request non-API diteruskan ke handler lain.

3. Ada integrasi legacy:
   - aplikasi lama sudah memiliki filter chain kompleks;
   - Jersey ditambahkan sebagai modul baru;
   - mapping servlet existing tidak boleh diubah besar-besaran.

4. Ada kebutuhan filter ordering yang spesifik:
   - security harus terjadi sebelum Jersey;
   - correlation ID harus dibuat sebelum Jersey;
   - compression harus setelah Jersey;
   - exception/error page perlu chain behavior tertentu.

5. Ada kebutuhan multi-runtime dalam satu webapp:
   - sebagian endpoint JAX-RS;
   - sebagian endpoint servlet native;
   - sebagian endpoint static atau MVC.

Jangan gunakan Jersey sebagai filter hanya karena “terlihat lebih fleksibel”. Fleksibilitas filter adalah biaya mental dan operasional.

Rule of thumb:

```text
REST-only application:
  prefer Jersey as Servlet

REST + static + legacy servlet + pass-through requirement:
  consider Jersey as Filter

Cloud microservice with one API surface:
  prefer explicit servlet mapping or embedded model

Legacy monolith gradually adding REST endpoints:
  filter model may be useful
```

---

## 3. Servlet vs Filter: Perbedaan Ownership

### 3.1 Jersey sebagai Servlet

```text
/api/* -> Jersey ServletContainer
```

Makna:

- container memilih Jersey servlet sebagai target;
- Jersey menjadi endpoint utama untuk mapping tersebut;
- request yang cocok dengan `/api/*` masuk Jersey;
- request yang tidak cocok mapping servlet tersebut tidak masuk Jersey;
- bila resource tidak ditemukan di dalam Jersey, Jersey mengembalikan JAX-RS 404.

### 3.2 Jersey sebagai Filter

```text
/* -> Jersey Filter
```

Makna:

- request masuk ke chain;
- Jersey filter dapat melihat request;
- Jersey dapat menangani request;
- Jersey dapat meneruskan request;
- urutan filter menentukan behavior;
- target akhir bisa servlet lain atau default servlet;
- tidak semua 404 berasal dari source yang sama.

Perhatikan perbedaan paling penting:

> Dalam servlet model, routing utama terjadi sebelum Jersey.  
> Dalam filter model, routing dapat terjadi di dalam Jersey dan di luar Jersey secara bersamaan.

Ini membuat filter model lebih kuat tetapi juga lebih rawan ambiguous ownership.

---

## 4. Minimal Konfigurasi `web.xml` untuk Jersey sebagai Filter

Contoh konseptual untuk Jersey 3.x/4.x era `jakarta.*`:

```xml
<web-app xmlns="https://jakarta.ee/xml/ns/jakartaee"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="https://jakarta.ee/xml/ns/jakartaee
                             https://jakarta.ee/xml/ns/jakartaee/web-app_5_0.xsd"
         version="5.0">

    <filter>
        <filter-name>jersey-filter</filter-name>
        <filter-class>org.glassfish.jersey.servlet.ServletContainer</filter-class>
        <init-param>
            <param-name>jersey.config.server.provider.packages</param-name>
            <param-value>com.example.api</param-value>
        </init-param>
    </filter>

    <filter-mapping>
        <filter-name>jersey-filter</filter-name>
        <url-pattern>/api/*</url-pattern>
    </filter-mapping>

</web-app>
```

Untuk Jersey 2.x/Java 8 era `javax.*`, namespace `web.xml` dan dependency berubah mengikuti Servlet versi lama, tetapi pola mentalnya sama.

Catatan penting:

- `ServletContainer` Jersey dapat dipakai di servlet-based deployment;
- class yang sama sering terlihat dalam konfigurasi servlet maupun filter;
- yang membedakan adalah apakah ia dideklarasikan di `<servlet>` atau `<filter>`;
- filter mapping menentukan request mana yang melewati Jersey filter;
- init-param menentukan bagaimana Jersey menemukan resource/provider.

Namun konfigurasi minimal bukan konfigurasi production-ready. Untuk production, kita perlu mengunci:

- package yang dipindai;
- provider yang didaftarkan;
- init order;
- dispatcher type;
- pass-through behavior;
- interaction dengan security/compression/logging filters;
- error behavior;
- observability.

---

## 5. Mapping Strategy untuk Filter-Based Jersey

Filter mapping adalah keputusan arsitektur, bukan detail syntax.

### 5.1 Mapping `/api/*`

```xml
<filter-mapping>
    <filter-name>jersey-filter</filter-name>
    <url-pattern>/api/*</url-pattern>
</filter-mapping>
```

Ini pola paling aman.

Request flow:

```text
/api/customers     -> melewati Jersey filter
/api/orders        -> melewati Jersey filter
/assets/app.js     -> tidak melewati Jersey filter
/index.html        -> tidak melewati Jersey filter
```

Kelebihan:

- API boundary jelas;
- static asset tidak ikut Jersey;
- security untuk API bisa dipisah;
- debugging mudah;
- reverse proxy routing lebih sederhana;
- risiko SPA/static conflict rendah.

Kekurangan:

- API selalu punya prefix;
- resource path JAX-RS harus disesuaikan dengan base path;
- absolute URL generation perlu memahami context path + filter path.

Rekomendasi production:

> Untuk aplikasi enterprise yang mencampur API dan non-API dalam satu WAR, gunakan `/api/*` kecuali ada alasan kuat untuk root-level API.

### 5.2 Mapping `/*`

```xml
<filter-mapping>
    <filter-name>jersey-filter</filter-name>
    <url-pattern>/*</url-pattern>
</filter-mapping>
```

Ini sangat kuat tetapi berbahaya.

Request flow:

```text
/api/customers     -> melewati Jersey
/assets/app.js     -> melewati Jersey
/index.html        -> melewati Jersey
/favicon.ico       -> melewati Jersey
/health            -> melewati Jersey
/error             -> melewati Jersey tergantung dispatcher
```

Kelebihan:

- bisa membuat root-level API;
- bisa membuat advanced pass-through;
- bisa menjadi facade untuk semua request.

Kekurangan:

- static resources dapat tertangkap;
- default servlet dapat terganggu;
- SPA fallback rawan konflik;
- auth/CORS/logging harus lebih hati-hati;
- error dispatcher bisa menciptakan recursion;
- health check bisa masuk pipeline mahal;
- setiap request asset melewati overhead Jersey/filter.

Gunakan `/*` hanya bila Anda benar-benar mendesain Jersey sebagai bagian dari front controller.

### 5.3 Extension Mapping

Contoh:

```xml
<url-pattern>*.api</url-pattern>
```

Jarang direkomendasikan untuk REST modern karena:

- URI menjadi transport-artifact oriented;
- gateway rewrite lebih sulit;
- resource matching membingungkan;
- tidak natural untuk REST path hierarchy;
- observability route grouping lebih buruk.

### 5.4 Multiple Filter Mapping

Contoh:

```xml
<filter-mapping>
    <filter-name>jersey-filter</filter-name>
    <url-pattern>/api/*</url-pattern>
</filter-mapping>

<filter-mapping>
    <filter-name>jersey-filter</filter-name>
    <url-pattern>/internal/*</url-pattern>
</filter-mapping>
```

Ini bisa dilakukan, tetapi perlu hati-hati karena satu Jersey application sekarang punya beberapa external entry points.

Pertanyaan yang harus dijawab:

- Apakah `/api/customers` dan `/internal/customers` masuk resource set yang sama?
- Apakah auth policy sama?
- Apakah rate limit sama?
- Apakah base URI generation benar?
- Apakah metrics membedakan external path?
- Apakah OpenAPI documentation memahami dua base path?

Dalam sistem regulated, multiple entry points harus didokumentasikan karena memengaruhi auditability.

---

## 6. Filter Ordering: Sumber Bug Paling Mahal

Filter chain berjalan sesuai urutan mapping/registration yang ditentukan container. Ketika request masuk, filter dieksekusi maju. Ketika response kembali, eksekusi kembali mundur.

Contoh chain:

```text
Request masuk
  -> CorrelationIdFilter
    -> SecurityFilter
      -> JerseyFilter
        -> CompressionFilter? / Target?
      <- Jersey response
    <- Security post-processing
  <- Correlation log completion
Response keluar
```

Namun ordering yang salah dapat mengubah behavior total.

### 6.1 Correlation ID Harus Sebelum Jersey

Benar:

```text
CorrelationIdFilter -> JerseyFilter
```

Salah:

```text
JerseyFilter -> CorrelationIdFilter
```

Jika correlation filter berada setelah Jersey dan Jersey menangani request terminal, correlation filter mungkin tidak pernah dipanggil.

Dampak:

- log resource tidak punya correlation ID;
- trace tidak tersambung;
- error response tidak punya request id;
- incident debugging menjadi sulit.

### 6.2 Security Harus Jelas: Sebelum atau di Dalam Jersey

Ada beberapa model:

```text
Model A: Container/security filter before Jersey
SecurityFilter -> JerseyFilter -> Resource

Model B: Jersey request filter handles auth
JerseyFilter -> ContainerRequestFilter -> Resource

Model C: Hybrid
Edge auth -> Servlet security -> Jersey role checks
```

Yang berbahaya adalah tidak jelas siapa owner auth.

Anti-pattern:

```text
Some endpoints protected by servlet filter
Some endpoints protected by Jersey filter
Some endpoints protected by reverse proxy
Some endpoints accidentally unprotected due to mapping mismatch
```

Production invariant:

> Untuk setiap URL pattern, harus bisa dijawab: auth dilakukan oleh siapa, pada layer apa, dengan fail-open atau fail-closed behavior apa?

### 6.3 CORS Filter Ordering

CORS preflight biasanya request `OPTIONS` sebelum request aktual.

Jika Jersey filter menangkap `OPTIONS` dan tidak ada resource/method yang cocok, response bisa 404/405. Jika CORS filter berada setelah Jersey, CORS headers mungkin tidak pernah ditambahkan.

Pola aman:

```text
CORS preflight handler -> Security/auth decision -> Jersey
```

Namun jangan terlalu simplistis. Untuk sistem enterprise:

- CORS public browser API harus eksplisit;
- internal API mungkin tidak butuh CORS;
- credentialed CORS tidak boleh wildcard sembarangan;
- error response juga perlu CORS header agar browser client bisa membaca error.

### 6.4 Compression Filter Ordering

Compression bisa berada di container/proxy layer atau servlet filter layer.

Jika compression filter berada sebelum Jersey secara wrapping response, ia dapat mengompresi output Jersey. Jika salah urutan, streaming response/SSE/file download bisa terganggu.

Rule:

- jangan kompres semua response secara buta;
- hindari compression untuk already-compressed content;
- hati-hati dengan SSE/streaming;
- pastikan `Content-Length` tidak salah;
- pastikan error response juga konsisten.

### 6.5 Logging Filter Ordering

Access log bisa terjadi di:

- reverse proxy;
- container access log;
- servlet filter;
- Jersey request/response filter;
- application resource log.

Jangan mengandalkan hanya Jersey-level logging untuk semua request bila Jersey filter mapping tidak mencakup semua URL.

Untuk filter-based deployment:

```text
Container/reverse proxy access log = semua request
Jersey metrics/log = request yang diproses Jersey
Application log = business event/resource-level event
```

---

## 7. Dispatcher Type: REQUEST, FORWARD, INCLUDE, ASYNC, ERROR

Filter mapping bukan hanya URL pattern. Dalam Servlet, filter juga dapat dipanggil untuk dispatcher type tertentu.

Dispatcher type umum:

- `REQUEST`: request normal dari client;
- `FORWARD`: request hasil forward internal;
- `INCLUDE`: include internal;
- `ASYNC`: async dispatch;
- `ERROR`: error dispatch.

Contoh:

```xml
<filter-mapping>
    <filter-name>jersey-filter</filter-name>
    <url-pattern>/api/*</url-pattern>
    <dispatcher>REQUEST</dispatcher>
</filter-mapping>
```

### 7.1 Kenapa Dispatcher Type Penting?

Misalnya aplikasi punya error page:

```text
/api/orders/123 -> Jersey throws exception -> container error dispatch -> /error
```

Jika Jersey filter juga menangkap `ERROR` dispatch secara tidak sengaja, bisa terjadi:

```text
/error -> masuk Jersey lagi -> tidak ada resource -> error lagi -> recursive/ambiguous error
```

Atau aplikasi legacy melakukan forward:

```text
/legacy/action -> forward ke /api/internal/check
```

Jika Jersey filter hanya menangkap `REQUEST`, forward tidak masuk Jersey. Jika menangkap `FORWARD`, forward masuk Jersey.

Tidak ada jawaban universal. Yang penting adalah eksplisit.

Production advice:

- default aman: mulai dengan `REQUEST`;
- tambahkan `ASYNC` jika benar-benar memakai async dispatch;
- tambahkan `ERROR` hanya jika Anda tahu error handling perlu Jersey;
- hindari filter Jersey menangkap `INCLUDE` kecuali ada desain khusus;
- dokumentasikan reason setiap dispatcher type.

---

## 8. Pass-Through Semantics

Filter-based deployment sering dipakai supaya request yang bukan API diteruskan ke chain berikutnya.

Pertanyaan penting:

```text
Ketika Jersey tidak menemukan resource:
  apakah return 404?
  atau call chain.doFilter()?
```

Dalam praktik, behavior ini terkait konfigurasi Jersey servlet/filter dan container integration. Yang harus dipahami bukan hanya property spesifiknya, tetapi mental model-nya.

### 8.1 Terminal Behavior

Terminal behavior:

```text
Request -> Jersey filter -> no matching JAX-RS resource -> Jersey 404
```

Cocok untuk:

- API prefix jelas `/api/*`;
- semua request dalam prefix memang milik API;
- 404 API harus berupa JSON/problem detail;
- static resource berada di luar prefix.

### 8.2 Pass-Through Behavior

Pass-through behavior:

```text
Request -> Jersey filter -> no matching JAX-RS resource -> next filter/servlet/static resource
```

Cocok untuk:

- root mapping `/*`;
- static asset dan API berbagi namespace;
- SPA fallback;
- legacy migration;
- multi-handler webapp.

Risiko:

- security bypass bila Jersey auth hanya berjalan untuk matched resource;
- request yang harus 404 API malah diteruskan ke static fallback;
- default servlet mengembalikan HTML untuk API client;
- metrics Jersey tidak mencatat request yang pass-through;
- CORS/error response tidak konsisten.

### 8.3 Decision Rule

Gunakan terminal behavior untuk URL API yang tegas.

Gunakan pass-through hanya bila:

- non-API handler memang berada di URL pattern yang sama;
- security filter berada sebelum Jersey dan melindungi seluruh URL space;
- fallback behavior terdokumentasi;
- observability membedakan handled vs pass-through request;
- error format untuk API tetap konsisten.

---

## 9. Request Path Decomposition dalam Filter Model

Dalam servlet model, Jersey biasanya mendapat path yang sudah relatif terhadap servlet mapping.

Dalam filter model, Jersey harus memahami request URI berdasarkan context path, filter mapping, dan internal request attributes.

Contoh deployment:

```text
WAR context path: /shop
Filter mapping:   /api/*
JAX-RS @Path:     /orders
Client request:   GET /shop/api/orders
```

Logical decomposition:

```text
context path      = /shop
filter mapping    = /api/*
Jersey base path  = /api
resource path     = /orders
```

Jika reverse proxy menambahkan atau menghapus prefix:

```text
Public URL:  https://example.com/backend/orders
Internal:    http://app:8080/shop/api/orders
```

Maka ada dua URI reality:

1. **internal container URI**
2. **external public URI**

Bug muncul ketika aplikasi menghasilkan link absolut, redirect, Location header, OpenAPI server URL, atau HATEOAS link berdasarkan internal URI.

Production invariant:

> Dalam filter deployment, base URI harus diuji dari perspektif public URL, bukan hanya internal container URL.

Checklist:

- apakah `Location` header benar?
- apakah redirect scheme `https` atau malah `http`?
- apakah generated link mengandung `/shop/api` padahal public path berbeda?
- apakah reverse proxy mengirim `X-Forwarded-*` atau `Forwarded`?
- apakah container/Jersey mempercayai forwarded headers secara aman?
- apakah host header injection dicegah?

---

## 10. Jersey Filter + Static Content

Salah satu alasan memakai filter adalah co-existence dengan static content.

Contoh layout WAR:

```text
src/main/webapp/
  index.html
  assets/app.js
  assets/app.css
  WEB-INF/web.xml
src/main/java/
  com.example.api.OrderResource
```

Target behavior:

```text
GET /api/orders       -> Jersey
GET /assets/app.js    -> static/default servlet
GET /index.html       -> static/default servlet
GET /unknown          -> SPA fallback or 404 depending design
```

Jika Jersey filter mapping `/api/*`, static content aman.

Jika Jersey filter mapping `/*`, maka perlu strategi:

```text
1. Jersey handles known API paths.
2. Non-API paths pass through.
3. Static/default servlet handles assets.
4. Optional SPA fallback handles unknown non-API paths.
5. Unknown API paths return JSON 404, not index.html.
```

Anti-pattern paling umum:

```text
GET /api/does-not-exist -> pass-through -> index.html -> HTTP 200
```

Dampak:

- client mengira API berhasil;
- monitoring false positive;
- frontend mendapat HTML saat expect JSON;
- cache/CDN menyimpan response salah;
- security audit sulit.

Rule:

```text
API namespace harus terminal.
Static namespace boleh fallback.
Jangan campur fallback behavior API dan SPA.
```

---

## 11. Jersey Filter + Legacy Servlet

Misalnya ada aplikasi lama:

```text
/report/*        -> ReportServlet
/download/*      -> DownloadServlet
/admin/*         -> AdminServlet
/api/*           -> JerseyFilter
```

Ini relatif aman.

Namun jika mapping dibuat terlalu luas:

```text
/* -> JerseyFilter
/report/* -> ReportServlet
/download/* -> DownloadServlet
```

Maka semua request report/download melewati Jersey lebih dulu.

Pertanyaan:

- apakah Jersey akan pass-through untuk `/report/*`?
- apakah security untuk report terjadi sebelum atau setelah Jersey?
- apakah request body sudah dibaca oleh Jersey/provider sebelum servlet lain?
- apakah exception mapper Jersey memengaruhi error servlet lain?
- apakah metrics report tercatat sebagai Jersey attempted request?

Jangan biarkan deployment menjadi emergent behavior.

Design yang lebih baik:

```text
Filter chain global:
  CorrelationIdFilter -> SecurityFilter -> AuditFilter

Specific handlers:
  /api/*      -> Jersey
  /report/*   -> ReportServlet
  /download/* -> DownloadServlet
```

Dengan begitu, cross-cutting concerns ada di filter global, bukan diserahkan ke Jersey filter.

---

## 12. Jersey Filter + Security

Security adalah bagian paling sensitif dari filter deployment.

### 12.1 Security Layering

Ada beberapa lapisan:

```text
Edge / WAF / API Gateway
  -> Reverse proxy auth/mTLS
    -> Servlet container security
      -> Servlet filter auth
        -> Jersey ContainerRequestFilter
          -> Resource-level authorization
```

Filter deployment berisiko bila URL pattern masing-masing layer tidak identik.

Contoh bug:

```text
SecurityFilter maps /api/*
JerseyFilter maps /*
Resource available at /internal/health through Jersey
```

Atau:

```text
SecurityFilter before Jersey maps REQUEST only
JerseyFilter also handles FORWARD
Forwarded internal request bypasses security
```

### 12.2 Fail-Closed Principle

Untuk API:

```text
Unknown auth state -> deny
Unknown route under protected API prefix -> return controlled 404/401/403
Unexpected dispatcher -> deny or not mapped
```

Jangan biarkan pass-through membuat fail-open.

### 12.3 Role Mapping Boundary

Jika authorization dilakukan di Jersey resource:

```java
@RolesAllowed("ADMIN")
@Path("/admin/orders")
public class AdminOrderResource { ... }
```

Maka pastikan identity sudah tersedia sebelum resource matching/invocation.

Jika identity disediakan oleh servlet filter:

- request principal harus diset dengan benar;
- security context harus terlihat Jersey;
- async/thread switch tidak menghilangkan context;
- error handling tidak membocorkan detail auth.

Jika identity disediakan oleh Jersey `ContainerRequestFilter`:

- filter priority harus benar;
- authentication harus sebelum authorization;
- exception mapper harus tidak mengubah 401 menjadi 500;
- CORS preflight harus tidak dipaksa auth yang salah bila policy mengizinkan preflight.

---

## 13. Jersey Filter + CORS

CORS sering tampak seperti frontend issue, padahal akar masalahnya deployment filter.

Preflight request:

```http
OPTIONS /api/orders
Origin: https://app.example.com
Access-Control-Request-Method: POST
Access-Control-Request-Headers: authorization,content-type
```

Masalah umum:

1. Security filter menolak `OPTIONS` sebelum CORS headers ditambahkan.
2. Jersey tidak punya matching resource untuk `OPTIONS`.
3. CORS filter berada setelah Jersey sehingga tidak dipanggil saat Jersey terminal 404/405.
4. Error response tidak diberi CORS header.
5. Pass-through mengirim preflight ke default servlet.

Pola yang lebih stabil:

```text
CorrelationIdFilter
  -> CorsFilter
    -> AuthenticationFilter
      -> JerseyFilter
```

Namun `CorsFilter` tidak boleh terlalu permisif. Untuk regulated systems:

- origin whitelist eksplisit;
- method whitelist eksplisit;
- header whitelist eksplisit;
- credential policy eksplisit;
- max age dipertimbangkan;
- log denied preflight secukupnya;
- jangan log token/header sensitif.

---

## 14. Jersey Filter + Request Body

Filter bisa membaca request body. Jersey provider juga membaca request body.

Jika filter membaca body tanpa wrapping/caching yang benar, Jersey resource tidak bisa membaca body lagi.

Anti-pattern:

```java
public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain) {
    String body = new String(req.getInputStream().readAllBytes(), UTF_8);
    log.info("body={}", body);
    chain.doFilter(req, res); // Jersey now sees consumed stream
}
```

Dampak:

- Jersey resource mendapat empty body;
- JSON parser error;
- intermittent bug tergantung endpoint;
- upload rusak;
- memory blow-up bila body besar dibaca penuh.

Production rules:

- jangan baca body di filter global kecuali sangat perlu;
- gunakan wrapper dengan bounded buffer bila harus;
- jangan log payload sensitif;
- jangan buffer upload besar;
- jangan buffer streaming request;
- set max request size di proxy/container;
- gunakan request sampling untuk diagnostics.

Untuk Java 8 vs Java 25, API convenience berubah, tetapi prinsipnya sama: request input stream adalah resource yang harus diperlakukan sebagai one-shot stream kecuali wrapper menyediakan replay.

---

## 15. Jersey Filter + Response Wrapping

Filter juga bisa membungkus response untuk:

- menambahkan header;
- mengukur response size;
- mengompresi output;
- menangkap body untuk audit;
- mengubah status code;
- menambahkan security headers.

Risikonya tinggi:

- response committed sebelum header ditambah;
- `Content-Length` salah;
- streaming response tertahan;
- memory blow-up karena body buffering;
- SSE terputus;
- binary download rusak;
- exception setelah partial response sulit dipetakan.

Rule:

```text
Header-only filter relatif aman.
Body-wrapping filter harus diperlakukan sebagai infrastructure component serius.
```

Untuk Jersey response, provider pipeline mungkin menulis entity secara streaming. Filter yang mengharuskan full body buffer dapat menghancurkan karakteristik streaming tersebut.

---

## 16. Async Boundary

Servlet 3+ mendukung async request processing. Jersey juga memiliki async/resource model tertentu. Dalam filter deployment, async memperkenalkan boundary tambahan.

Pertanyaan penting:

- apakah filter mendukung async?
- apakah `asyncSupported` aktif?
- apakah dispatcher `ASYNC` dipetakan?
- apakah thread-local context hilang saat async dispatch?
- apakah security context ikut berpindah?
- apakah MDC/correlation ID ikut berpindah?
- apakah timeout async berbeda dengan request timeout proxy/container?

Contoh konfigurasi:

```xml
<filter>
    <filter-name>jersey-filter</filter-name>
    <filter-class>org.glassfish.jersey.servlet.ServletContainer</filter-class>
    <async-supported>true</async-supported>
</filter>
```

Namun mengaktifkan async bukan berarti aplikasi otomatis scalable. Jika resource tetap blocking dan executor tidak dikontrol, async dapat hanya memindahkan masalah.

Mental model:

```text
Async improves ownership of waiting.
Async does not eliminate resource consumption.
```

---

## 17. Threading Model dalam Filter Deployment

Dalam servlet container, request biasanya diproses oleh worker thread container.

```text
Connector acceptor/poller
  -> container worker thread
    -> filter chain
      -> Jersey
        -> resource method
```

Filter deployment tidak mengubah fakta bahwa resource blocking akan memakai worker thread, kecuali Anda secara eksplisit memakai async/offload.

Yang perlu dipahami:

- filter sebelum Jersey berjalan di thread yang sama;
- Jersey resource biasanya berjalan di thread container yang sama;
- ThreadLocal dari filter dapat terlihat di Jersey;
- tetapi async/virtual-thread/offload dapat memutus ThreadLocal;
- MDC harus dipropagasikan dengan sadar;
- blocking DB/HTTP call tetap memakan capacity.

Java 21+ virtual threads membuat diskusi lebih menarik, tetapi deployment filter tetap perlu memahami host runtime. Bila container tidak menjalankan request dengan virtual threads, resource Jersey tidak otomatis memakai virtual threads. Bila Anda offload ke virtual thread sendiri, security/MDC context harus dipropagasikan.

---

## 18. Dependency dan Namespace dalam Filter Deployment

Jersey filter deployment tetap mengikuti boundary versi:

```text
Jersey 2.x:
  javax.ws.rs.*
  javax.servlet.*
  Java 8-compatible world

Jersey 3.x:
  jakarta.ws.rs.*
  jakarta.servlet.*
  Java 11+ world

Jersey 4.x:
  Jakarta REST 4.0 / Jakarta EE 11 era
  Java 17+ specification baseline for Jakarta REST 4.0
```

Bug paling umum:

```text
WAR contains jakarta servlet-based Jersey
Container only supports javax servlet
```

Atau:

```text
App imports jakarta.ws.rs.Path
Dependency provides javax.ws.rs-api
```

Atau:

```text
Tomcat 9 + Jersey 3.x
```

Tomcat 9 adalah dunia `javax.servlet`; Jersey 3.x servlet deployment adalah dunia `jakarta.servlet`. Kombinasi ini secara namespace tidak cocok.

Production invariant:

> Namespace API, Jersey major version, servlet container major version, dan Java target harus satu generasi.

---

## 19. Provider Discovery dalam Filter Deployment

Jersey perlu menemukan:

- resource class;
- providers;
- exception mappers;
- filters/interceptors;
- entity readers/writers;
- features;
- binders/injection components.

Dalam filter deployment, discovery bisa dikonfigurasi lewat init-param:

```xml
<init-param>
    <param-name>jersey.config.server.provider.packages</param-name>
    <param-value>com.example.api</param-value>
</init-param>
```

Atau melalui `Application`/`ResourceConfig` class:

```xml
<init-param>
    <param-name>jakarta.ws.rs.Application</param-name>
    <param-value>com.example.ApiApplication</param-value>
</init-param>
```

Konseptual Java:

```java
public final class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        register(OrderResource.class);
        register(CustomerResource.class);
        register(JsonMappingExceptionMapper.class);
        register(AuthenticationFeature.class);
    }
}
```

Untuk production, explicit registration sering lebih aman daripada package scanning luas.

Alasan:

- startup lebih deterministik;
- resource exposure lebih terkontrol;
- accidental provider registration berkurang;
- test lebih mudah;
- native image lebih siap;
- classpath conflict lebih mudah terlihat.

Package scanning masih berguna, tetapi jangan scan root package terlalu luas:

```text
Bad:
  com.example

Better:
  com.example.order.api, com.example.common.jaxrs
```

---

## 20. Multi-Jersey Filter dalam Satu WAR

Kadang satu WAR memiliki dua Jersey applications:

```text
/api/public/*    -> Public API Jersey filter
/api/internal/*  -> Internal API Jersey filter
```

Contoh:

```xml
<filter>
    <filter-name>public-api</filter-name>
    <filter-class>org.glassfish.jersey.servlet.ServletContainer</filter-class>
    <init-param>
        <param-name>jakarta.ws.rs.Application</param-name>
        <param-value>com.example.PublicApiApplication</param-value>
    </init-param>
</filter>

<filter>
    <filter-name>internal-api</filter-name>
    <filter-class>org.glassfish.jersey.servlet.ServletContainer</filter-class>
    <init-param>
        <param-name>jakarta.ws.rs.Application</param-name>
        <param-value>com.example.InternalApiApplication</param-value>
    </init-param>
</filter>
```

Ini bisa berguna, tetapi perlu boundary jelas:

- provider set boleh berbeda;
- exception format boleh berbeda;
- auth policy boleh berbeda;
- metrics tag harus berbeda;
- OpenAPI docs harus berbeda;
- classpath tetap sama, jadi dependency conflict tetap shared;
- singleton/shared services harus thread-safe dan lifecycle-aware.

Anti-pattern:

```text
Two Jersey apps sharing mutable static global config with different expectations.
```

Lebih aman:

```text
Shared infrastructure immutable.
API-specific ResourceConfig explicit.
No mutable static state.
```

---

## 21. Error Handling dalam Filter Model

Error bisa muncul di banyak layer:

```text
Reverse proxy error
Container connector error
Pre-Jersey filter error
Jersey matching error
Jersey provider error
Resource method error
Post-Jersey filter error
Default servlet error
Error page error
```

Jersey exception mapper hanya menangkap error yang terjadi di dalam Jersey pipeline.

Jika `SecurityFilter` sebelum Jersey throw exception atau menulis 401 sendiri, Jersey `ExceptionMapper` tidak jalan.

Jika compression filter setelah Jersey gagal saat write response, Jersey exception mapper mungkin sudah terlalu terlambat.

Jika request pass-through ke servlet lain, Jersey error handling tidak berlaku.

Production implication:

> Error response contract tidak boleh hanya bergantung pada Jersey `ExceptionMapper` bila filter chain memiliki komponen yang bisa menghasilkan error di luar Jersey.

Strategi:

1. Untuk API prefix, minimalkan external filter yang menulis body sendiri.
2. Buat security/CORS/error filter menghasilkan format konsisten.
3. Gunakan container error page dengan hati-hati.
4. Pastikan 404 API bukan HTML default container.
5. Pastikan 500 dari pre-Jersey filter tetap memiliki correlation ID.

---

## 22. Observability dalam Filter-Based Deployment

Filter deployment perlu observability di beberapa titik:

```text
Request arrival at edge/proxy
  -> Container access log
    -> Global servlet filter metrics
      -> Jersey request metrics
        -> Resource/business metrics
          -> Downstream dependency metrics
```

Jangan hanya mengandalkan Jersey metrics.

Kenapa?

- request static tidak masuk Jersey;
- pass-through request tidak selesai di Jersey;
- security-denied request sebelum Jersey tidak tercatat di Jersey;
- preflight mungkin tidak masuk resource;
- error before Jersey tidak terlihat sebagai Jersey exception;
- default servlet response tidak tercatat oleh Jersey.

Minimum metrics:

- total HTTP requests by container/proxy;
- filter chain requests by URL pattern;
- Jersey handled requests;
- Jersey not found/method not allowed;
- pass-through count;
- pre-Jersey rejection count;
- auth failure count;
- CORS preflight count;
- request duration total;
- Jersey resource duration;
- downstream call duration;
- response status distribution;
- active request count;
- queue/thread pool utilization.

Minimum logs:

- access log at proxy/container;
- structured app log with correlation ID;
- startup log listing registered Jersey apps/resources/providers;
- mapping summary;
- config source summary;
- error log with layer classification.

Layer classification example:

```json
{
  "event": "http_request_failed",
  "layer": "pre_jersey_security_filter",
  "status": 401,
  "path": "/api/orders",
  "correlationId": "..."
}
```

This is superior to generic `500 Internal Server Error` logs.

---

## 23. Health Checks dalam Filter Model

Health endpoint bisa berada:

- outside Jersey, handled by container/servlet;
- inside Jersey resource;
- outside app, handled by sidecar/proxy;
- via MicroProfile Health in Jakarta EE runtime.

Jika Jersey filter maps `/api/*`, common pattern:

```text
/health/live       -> simple servlet/container endpoint
/health/ready      -> Jersey or app-level readiness
/api/...           -> Jersey API
```

Jika Jersey filter maps `/*`, health endpoint juga melewati Jersey kecuali dikecualikan/pass-through.

Production recommendation:

- liveness harus murah dan tidak bergantung DB;
- readiness boleh cek dependency penting;
- health endpoint jangan memicu expensive Jersey scanning/lazy init saat traffic awal;
- health endpoint harus jelas apakah ia menguji Jersey pipeline atau hanya JVM/container;
- Kubernetes readiness harus sesuai dengan actual API readiness.

Anti-pattern:

```text
/readiness returns 200 from static servlet while Jersey failed startup.
```

Atau:

```text
/liveness performs DB query and causes restart storm during DB incident.
```

---

## 24. Startup Lifecycle

Filter lifecycle mirip servlet lifecycle:

```text
WAR deploy
  -> classloader created
  -> web.xml / annotation processing
  -> filter instantiated
  -> filter init
  -> Jersey application initialized
  -> resources/providers registered
  -> application ready
```

Pertanyaan penting:

- apakah Jersey init terjadi saat startup atau lazy saat first request?
- apakah resource/provider validation fail-fast?
- apakah missing dependency terlihat sebelum readiness true?
- apakah startup order antar filter benar?
- apakah DI container sudah siap sebelum Jersey init?
- apakah configuration sudah loaded?

Untuk production, prefer fail-fast.

Reason:

```text
Startup failure before traffic is cheaper than first-request failure under live traffic.
```

Startup log yang baik:

```text
Jersey application: public-api
Mapping: /api/*
Application class: com.example.PublicApiApplication
Registered resources: 42
Registered providers: 18
JSON provider: Jackson
Auth mode: ServletSecurity + JerseyRoles
CORS mode: explicit whitelist
Pass-through: disabled for /api/*
```

---

## 25. Shutdown Lifecycle

Shutdown flow:

```text
SIGTERM / undeploy
  -> container stops accepting new requests
  -> existing request drain
  -> filter destroy
  -> Jersey shutdown
  -> DI/service cleanup
  -> classloader eligible for GC
```

Masalah umum:

- background executor tidak shutdown;
- scheduled task masih berjalan;
- static reference menahan classloader;
- HTTP client connection pool tidak close;
- DB pool tidak close;
- metrics exporter thread leak;
- async request masih berjalan;
- file handles leak;
- redeploy memory leak.

Filter model menambah risiko karena ada banyak filter/servlet lain dalam satu WAR. Shutdown order harus dipahami.

Production checklist:

- semua executor diberi owner;
- semua client/pool punya close hook;
- no unmanaged non-daemon threads;
- no mutable static caches kecuali sengaja;
- redeploy test dilakukan di non-prod;
- thread dump setelah undeploy diperiksa;
- classloader leak detector/container logs diperhatikan.

---

## 26. Deployment Descriptor vs Annotation Registration

Filter dapat diregistrasi melalui:

1. `web.xml`
2. annotation seperti `@WebFilter`
3. programmatic registration via servlet initializer/container API
4. framework-specific registration

Untuk enterprise deployment, `web.xml` sering tetap unggul dalam hal explicitness.

Kelebihan `web.xml`:

- ordering jelas;
- dispatcher type jelas;
- URL mapping jelas;
- init-param terlihat di satu tempat;
- environment-specific deployment lebih mudah diaudit;
- cocok untuk security descriptor.

Kekurangan:

- verbose;
- rawan drift bila tidak dites;
- refactoring class name tidak otomatis;
- kurang modern dibanding code-based config.

Kelebihan annotation:

- dekat dengan kode;
- lebih sedikit XML;
- cocok untuk aplikasi kecil.

Kekurangan annotation:

- ordering bisa kurang eksplisit;
- scanning cost;
- accidental registration;
- sulit melihat full deployment topology.

Untuk sistem besar:

> Gunakan pendekatan yang membuat deployment topology bisa dibaca dalam 5 menit oleh engineer on-call.

---

## 27. Production Patterns

### 27.1 API Prefix Pattern

```text
Context path: /
Jersey filter: /api/*
Static: /assets/*, /index.html
Health: /health/*
```

Cocok untuk:

- webapp campuran API + UI;
- legacy WAR;
- controlled REST namespace.

Kelebihan:

- boundary jelas;
- static tidak terganggu;
- security mapping mudah;
- API 404 konsisten.

### 27.2 Front Controller Pattern

```text
Jersey filter: /*
Pass-through enabled for static/non-API
```

Cocok untuk:

- aplikasi dengan advanced routing;
- migration dari legacy front controller;
- framework composition tertentu.

Risiko:

- semua request melewati Jersey;
- fallback harus sangat hati-hati;
- observability perlu lebih kompleks.

### 27.3 Legacy Coexistence Pattern

```text
Global filters:
  Correlation -> Security -> Audit

Handlers:
  /api/*      -> Jersey filter/servlet
  /legacy/*   -> Legacy servlet
  /assets/*   -> Default servlet
```

Cocok untuk:

- gradual modernization;
- monolith yang ditambah REST endpoints;
- regulated app yang tidak boleh rewrite total.

### 27.4 Internal/External Split Pattern

```text
/public-api/*    -> Public Jersey application
/internal-api/*  -> Internal Jersey application
/admin/*         -> Admin servlet/UI
```

Cocok untuk:

- security boundary berbeda;
- provider/exception format berbeda;
- different audit requirements.

Risiko:

- duplicate providers;
- inconsistent auth;
- docs drift;
- shared mutable state.

---

## 28. Anti-Patterns

### Anti-Pattern 1 — `/*` Tanpa Pass-Through Design

```text
JerseyFilter maps /*
No explicit static strategy
No explicit API 404 strategy
```

Akibat:

- asset 404;
- SPA fallback salah;
- API 404 HTML;
- debugging kacau.

### Anti-Pattern 2 — Security Filter dan Jersey Filter URL Pattern Tidak Sinkron

```text
Security: /secure/*
Jersey:   /api/*
```

Jika `/api/*` tidak seluruhnya secure, bisa terjadi exposure.

### Anti-Pattern 3 — CORS Setelah Jersey

```text
JerseyFilter -> CorsFilter
```

Jika Jersey terminal response, CORS filter mungkin tidak memberi header yang dibutuhkan.

### Anti-Pattern 4 — Body Logging Filter Global

Membaca semua body untuk logging adalah bencana:

- stream consumed;
- PII leak;
- memory blow-up;
- upload rusak;
- latency naik.

### Anti-Pattern 5 — Exception Mapper Dianggap Global

Jersey `ExceptionMapper` bukan global servlet/container error handler.

### Anti-Pattern 6 — Package Scanning Terlalu Luas

```xml
<param-value>com.example</param-value>
```

Risiko:

- accidental resource exposure;
- startup lambat;
- provider conflict;
- difficult reproducibility.

### Anti-Pattern 7 — Mixing `javax.*` dan `jakarta.*`

Ini bukan sekadar import mismatch. Ini generational boundary.

### Anti-Pattern 8 — Health Check Tidak Menguji Jersey

Jika readiness tidak memvalidasi Jersey initialized, service bisa menerima traffic padahal API mati.

---

## 29. Diagnostics: Cara Berpikir Saat Jersey Filter Bermasalah

### 29.1 Symptom: Static File 404

Pertanyaan:

- Apakah Jersey filter mapping `/*`?
- Apakah pass-through aktif?
- Apakah default servlet masih registered?
- Apakah security filter memblokir asset?
- Apakah context path berubah?
- Apakah reverse proxy rewrite benar?

### 29.2 Symptom: API Mengembalikan HTML

Kemungkinan:

- request pass-through ke SPA fallback;
- container default error page;
- security login page redirect;
- wrong Accept handling;
- reverse proxy error page.

Cek:

```text
Content-Type
Status code
Response body source
Access log handler
Jersey request log ada/tidak
```

### 29.3 Symptom: CORS Error di Browser

Cek dengan curl:

```bash
curl -i -X OPTIONS 'https://example.com/api/orders' \
  -H 'Origin: https://app.example.com' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: authorization,content-type'
```

Pertanyaan:

- apakah response punya `Access-Control-Allow-Origin`?
- apakah status 200/204 atau 401/404/405?
- filter mana yang menghasilkan response?
- apakah CORS filter sebelum Jersey?

### 29.4 Symptom: Jersey Resource Tidak Terpanggil

Cek:

- URL pattern filter;
- context path;
- resource `@Path`;
- package scanning;
- Application/ResourceConfig class;
- namespace `javax/jakarta`;
- provider registration error saat startup;
- request method;
- trailing slash;
- reverse proxy prefix.

### 29.5 Symptom: ExceptionMapper Tidak Jalan

Kemungkinan:

- exception terjadi sebelum Jersey;
- exception terjadi setelah Jersey response committed;
- request tidak ditangani Jersey;
- wrong exception type;
- mapper tidak registered;
- provider scanning gagal.

### 29.6 Symptom: Auth Bypass atau Inconsistent Auth

Cek:

- security filter pattern;
- dispatcher type;
- Jersey filter pattern;
- pass-through;
- resource-level annotations;
- default servlet/static fallback;
- forwarded/internal URLs;
- direct pod/container access bypassing gateway.

---

## 30. Testing Strategy

Filter deployment harus dites sebagai deployment, bukan hanya unit resource.

### 30.1 Unit Test

Cocok untuk:

- resource logic;
- provider behavior;
- exception mapper;
- auth utility;
- CORS policy function.

Tidak cukup untuk:

- filter order;
- servlet mapping;
- dispatcher type;
- static pass-through;
- context path;
- reverse proxy behavior.

### 30.2 Integration Test dengan Embedded Container

Test:

```text
GET /api/orders -> JSON
GET /api/unknown -> JSON 404
GET /assets/app.js -> static 200
OPTIONS /api/orders -> CORS headers
GET /admin -> protected
GET /health/live -> cheap 200
GET /health/ready -> app readiness
```

### 30.3 Deployment Contract Test

Jalankan terhadap artifact real:

- WAR actual;
- container actual version;
- same web.xml;
- same context path;
- same reverse proxy prefix if possible.

### 30.4 Negative Tests

Wajib ada:

- unknown API path;
- unknown static path;
- unsupported method;
- missing auth;
- invalid token;
- CORS denied origin;
- large body;
- malformed JSON;
- request to legacy servlet;
- error thrown before Jersey;
- error thrown inside Jersey;
- error thrown after Jersey if filter exists.

---

## 31. Reference Configuration: Safer Enterprise Baseline

Contoh baseline konseptual:

```xml
<web-app xmlns="https://jakarta.ee/xml/ns/jakartaee"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="https://jakarta.ee/xml/ns/jakartaee
                             https://jakarta.ee/xml/ns/jakartaee/web-app_5_0.xsd"
         version="5.0">

    <filter>
        <filter-name>correlation-id</filter-name>
        <filter-class>com.example.web.CorrelationIdFilter</filter-class>
        <async-supported>true</async-supported>
    </filter>

    <filter-mapping>
        <filter-name>correlation-id</filter-name>
        <url-pattern>/*</url-pattern>
        <dispatcher>REQUEST</dispatcher>
        <dispatcher>ASYNC</dispatcher>
    </filter-mapping>

    <filter>
        <filter-name>cors</filter-name>
        <filter-class>com.example.web.CorsFilter</filter-class>
        <async-supported>true</async-supported>
    </filter>

    <filter-mapping>
        <filter-name>cors</filter-name>
        <url-pattern>/api/*</url-pattern>
        <dispatcher>REQUEST</dispatcher>
    </filter-mapping>

    <filter>
        <filter-name>security</filter-name>
        <filter-class>com.example.web.SecurityFilter</filter-class>
        <async-supported>true</async-supported>
    </filter>

    <filter-mapping>
        <filter-name>security</filter-name>
        <url-pattern>/api/*</url-pattern>
        <dispatcher>REQUEST</dispatcher>
    </filter-mapping>

    <filter>
        <filter-name>jersey-api</filter-name>
        <filter-class>org.glassfish.jersey.servlet.ServletContainer</filter-class>
        <init-param>
            <param-name>jakarta.ws.rs.Application</param-name>
            <param-value>com.example.api.ApiApplication</param-value>
        </init-param>
        <async-supported>true</async-supported>
    </filter>

    <filter-mapping>
        <filter-name>jersey-api</filter-name>
        <url-pattern>/api/*</url-pattern>
        <dispatcher>REQUEST</dispatcher>
        <dispatcher>ASYNC</dispatcher>
    </filter-mapping>

</web-app>
```

Catatan:

- ini contoh mental model, bukan copy-paste universal;
- security detail harus mengikuti kebutuhan nyata;
- CORS tidak selalu dibutuhkan;
- async tidak perlu diaktifkan jika tidak digunakan;
- `jakarta.ws.rs.Application` param bergantung versi Jersey/konfigurasi;
- Java 8/Jersey 2 memakai namespace lama.

---

## 32. Decision Framework

Gunakan pertanyaan berikut sebelum memilih Jersey sebagai filter:

### 32.1 Application Shape

```text
Apakah aplikasi REST-only?
  Ya  -> prefer Jersey servlet/embedded
  Tidak -> filter mungkin relevan
```

### 32.2 URL Ownership

```text
Apakah semua path dalam mapping adalah API?
  Ya  -> terminal behavior aman
  Tidak -> perlu pass-through design
```

### 32.3 Security

```text
Apakah security URL pattern identik dengan Jersey URL pattern?
Apakah dispatcher type aman?
Apakah pass-through tidak membuka bypass?
```

### 32.4 Observability

```text
Bisakah kita membedakan:
  - request ditangani Jersey
  - request pass-through
  - request ditolak sebelum Jersey
  - request gagal setelah Jersey
```

### 32.5 Operational Simplicity

```text
Apakah on-call engineer dapat menjelaskan request flow dari proxy sampai resource dalam 5 menit?
```

Jika jawabannya tidak, deployment terlalu kompleks.

---

## 33. Top 1% Mental Model

Engineer biasa melihat filter sebagai konfigurasi tambahan.

Engineer kuat melihat filter sebagai **control point**.

Engineer top-tier melihat filter sebagai **ownership boundary**:

- siapa pemilik URL?
- siapa pemilik auth?
- siapa pemilik error format?
- siapa pemilik request body?
- siapa pemilik response body?
- siapa pemilik metrics?
- siapa pemilik timeout?
- siapa pemilik fallback?
- siapa pemilik shutdown?
- siapa pemilik public URI?

Jersey filter deployment bukan tentang “bisa jalan”. Ia tentang memastikan request lifecycle tetap deterministik saat ada banyak komponen yang semuanya punya hak untuk melihat, mengubah, meneruskan, atau menghentikan request.

Mental model final:

```text
Jersey as Servlet:
  clean terminal endpoint model

Jersey as Filter:
  pipeline participant model

Servlet model optimizes clarity.
Filter model optimizes composition.
Composition increases power and failure surface.
```

---

## 34. Checklist Production Readiness

Sebelum memakai Jersey sebagai filter, pastikan:

- [ ] URL pattern Jersey eksplisit.
- [ ] Security filter pattern sinkron dengan Jersey pattern.
- [ ] Dispatcher type eksplisit.
- [ ] CORS ordering jelas bila browser API.
- [ ] Correlation ID dibuat sebelum Jersey.
- [ ] Static asset behavior diuji.
- [ ] Unknown API path menghasilkan response API, bukan HTML fallback.
- [ ] Request body tidak dibaca sembarangan oleh pre-Jersey filter.
- [ ] Response body tidak dibungkus sembarangan oleh post-Jersey filter.
- [ ] Exception before/inside/after Jersey punya error contract.
- [ ] Package scanning tidak terlalu luas.
- [ ] Resource/provider registration deterministic.
- [ ] Startup fail-fast.
- [ ] Readiness menguji Jersey bila API bergantung Jersey.
- [ ] Shutdown menutup executor/client/pool.
- [ ] Metrics membedakan handled/pass-through/rejected requests.
- [ ] Access log tersedia di proxy/container.
- [ ] Namespace `javax.*`/`jakarta.*` konsisten.
- [ ] Container version sesuai Jersey major version.
- [ ] Reverse proxy prefix/base URI diuji.
- [ ] Contract tests menjalankan artifact/container sebenarnya.

---

## 35. Ringkasan

Jersey sebagai Servlet Filter adalah deployment model yang berguna tetapi rawan jika dipakai tanpa desain eksplisit.

Poin inti:

1. Filter model membuat Jersey menjadi bagian dari pipeline, bukan selalu terminal endpoint.
2. Mapping `/api/*` jauh lebih aman daripada `/*` untuk aplikasi campuran.
3. Filter ordering menentukan security, CORS, logging, compression, dan observability.
4. Dispatcher type dapat mengubah behavior request normal, forward, async, dan error.
5. Pass-through harus didesain, bukan dibiarkan sebagai efek samping.
6. Jersey exception mapper hanya berlaku untuk error di dalam Jersey pipeline.
7. Request/response body wrapping di filter adalah area berisiko tinggi.
8. Observability harus mencakup request sebelum Jersey, di dalam Jersey, dan setelah Jersey.
9. Namespace dan container generation harus konsisten: `javax.*` tidak boleh dicampur sembarangan dengan `jakarta.*`.
10. Filter deployment layak untuk composition, tetapi servlet deployment sering lebih unggul untuk clarity.

---

## 36. Latihan Berpikir

Jawab pertanyaan ini sebelum lanjut:

1. Jika Jersey filter mapping `/*`, bagaimana Anda memastikan `/assets/app.js` tidak diproses sebagai API?
2. Jika `/api/unknown` mengembalikan `index.html`, layer mana yang kemungkinan salah?
3. Mengapa CORS filter sering harus berada sebelum Jersey?
4. Apa bedanya error yang dilempar `SecurityFilter` sebelum Jersey dan exception dari resource method Jersey?
5. Jika request body dibaca oleh logging filter sebelum Jersey, apa yang bisa rusak?
6. Dispatcher type apa yang paling aman sebagai default untuk Jersey filter?
7. Bagaimana membuktikan bahwa security filter dan Jersey filter tidak punya URL pattern gap?
8. Apa metrik minimum untuk membedakan handled vs pass-through request?
9. Mengapa filter model lebih berisiko untuk SPA fallback?
10. Kapan Anda akan menolak penggunaan Jersey sebagai filter dan memilih servlet model biasa?

---

## 37. Referensi

- Eclipse Jersey Documentation — Application Deployment and Runtime, Jersey 3.x.  
  https://eclipse-ee4j.github.io/jersey.github.io/documentation/latest3x/deployment.html

- Eclipse Jersey Documentation — Deployment using `web.xml`, Servlet/Filter model, initialization parameters.  
  https://eclipse-ee4j.github.io/jersey.github.io/documentation/3.0.0/deployment.html

- Jakarta Servlet API — `Filter`.  
  https://jakarta.ee/specifications/servlet/5.0/apidocs/jakarta/servlet/filter

- Jakarta Servlet API — `FilterChain`.  
  https://jakarta.ee/specifications/servlet/5.0/apidocs/jakarta/servlet/filterchain

- Jakarta Servlet Specification 6.0.  
  https://jakarta.ee/specifications/servlet/6.0/jakarta-servlet-spec-6.0

---

## 38. Status Seri

Seri **Java Eclipse Jersey Deployment Models** belum selesai.

Progress saat ini:

- [x] Part 0 — Orientation: Mental Model Deployment Jersey dari Java 8 sampai Java 25
- [x] Part 1 — Version Matrix: Java 8–25, Jersey 2.x/3.x/4.x, `javax.*` vs `jakarta.*`
- [x] Part 2 — Deployment Invariants: Apa yang Tidak Boleh Salah di Semua Model
- [x] Part 3 — The Hosting Contract: Bagaimana Request Masuk ke Jersey
- [x] Part 4 — WAR Deployment Model di Servlet Container
- [x] Part 5 — Jersey as Servlet: `ServletContainer` Deep Dive
- [x] Part 6 — Jersey as Servlet Filter: Filter-Based Deployment Model

Berikutnya:

**Part 7 — Servlet Mapping Semantics: `/`, `/*`, `/api/*`, Extension Mapping, dan Edge Cases**


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-jersey-deployment-models-part-005.md">⬅️ Part 5 — Jersey as Servlet: `ServletContainer` Deep Dive</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-jersey-deployment-models-part-007.md">Servlet Mapping Semantics: `/`, `/*`, `/api/*`, Extension Mapping, dan Edge Cases ➡️</a>
</div>
