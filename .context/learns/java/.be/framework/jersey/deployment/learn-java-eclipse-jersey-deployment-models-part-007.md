# learn-java-eclipse-jersey-deployment-models-part-007
# Servlet Mapping Semantics: `/`, `/*`, `/api/*`, Extension Mapping, dan Edge Cases

> Seri: **Java Eclipse Jersey Deployment Models**  
> Part: **7 dari 32**  
> Target pembaca: engineer Java/Jakarta/Jersey yang ingin memahami deployment boundary secara presisi, bukan sekadar bisa menjalankan endpoint.  
> Rentang Java: **Java 8 sampai Java 25**  
> Fokus part ini: memahami cara Servlet container menentukan request masuk ke Jersey, bagaimana path dipecah, dan bagaimana mapping salah dapat membuat API terlihat “rusak” padahal resource benar.

---

## 0. Kenapa Part Ini Penting?

Banyak bug Jersey deployment tidak berasal dari:

- salah `@Path`,
- salah method HTTP,
- salah JSON provider,
- salah dependency,
- atau resource tidak terdaftar.

Sering kali root cause-nya lebih rendah:

- context path berbeda dari asumsi,
- servlet mapping berbeda dari base URI,
- reverse proxy menghapus prefix,
- `/` disangka sama dengan `/*`,
- `@ApplicationPath` bertabrakan dengan `web.xml`,
- static file ikut tertangkap Jersey,
- filter mapping terlalu luas,
- path extension mapping mengubah resource matching,
- atau container memilih servlet lain sebelum Jersey.

Di level top-tier engineering, URL bukan hanya string. URL adalah hasil komposisi beberapa layer:

```text
client URL
  -> reverse proxy route
  -> container host/context
  -> web application context path
  -> servlet mapping
  -> servlet path
  -> path info
  -> Jersey application path/base URI
  -> Jersey resource @Path matching
```

Jika satu layer salah, seluruh request lifecycle bisa salah.

---

## 1. Mental Model Utama

Servlet mapping adalah proses **container-level routing**.

Jersey `@Path` adalah proses **JAX-RS/Jakarta REST resource-level routing**.

Keduanya berbeda.

```text
HTTP request path:
  /aceas/api/v1/cases/123

Servlet container first decides:
  which web application?
  which servlet/filter?
  what is context path?
  what is servlet path?
  what is path info?

Only after Jersey receives control:
  which JAX-RS application?
  which resource class?
  which resource method?
  which provider?
```

Jadi urutan konseptualnya:

```text
1. HTTP connector receives request
2. Container normalizes/parses URI
3. Container selects web application context
4. Container applies servlet/filter mapping
5. Jersey ServletContainer is invoked
6. Jersey computes application-relative path
7. Jersey runs resource matching
8. Resource method executes
9. Provider writes response
10. Container sends response
```

**Kesalahan paling umum:** mencampur level 4 dan level 7.

Misalnya:

```java
@Path("/api/cases")
public class CaseResource {}
```

Padahal servlet sudah dimapping ke `/api/*`.

Jika request adalah:

```text
GET /myapp/api/cases
```

Maka Jersey biasanya melihat path relatif:

```text
/cases
```

Bukan:

```text
/api/cases
```

Akibatnya resource `@Path("/api/cases")` bisa tidak match, tergantung model deployment dan base path.

---

## 2. Istilah yang Harus Dikuasai

### 2.1 Request URI

Request URI adalah path yang dikirim client ke server, tidak termasuk scheme/host.

Contoh:

```text
https://example.com/aceas/api/v1/cases/123?expand=true
```

Komponen:

```text
scheme      = https
host        = example.com
path        = /aceas/api/v1/cases/123
query       = expand=true
```

Servlet mapping bekerja terhadap path, bukan terhadap query string.

### 2.2 Context Path

Context path adalah prefix yang menunjuk ke web application.

Jika WAR bernama:

```text
aceas.war
```

dan dideploy default di Tomcat, sering kali context path menjadi:

```text
/aceas
```

Request:

```text
/aceas/api/v1/cases/123
```

Maka:

```text
context path = /aceas
remaining    = /api/v1/cases/123
```

Untuk root deployment:

```text
ROOT.war
```

context path biasanya:

```text
(empty string)
```

Bukan `/`.

Ini penting. Banyak bug muncul karena engineer menganggap root context path adalah `/`.

### 2.3 Servlet Path

Servlet path adalah bagian path yang cocok dengan servlet mapping.

Contoh mapping:

```xml
<url-pattern>/api/*</url-pattern>
```

Request:

```text
/aceas/api/v1/cases/123
```

Setelah context path `/aceas` dilepas:

```text
/api/v1/cases/123
```

Maka:

```text
servlet path = /api
path info    = /v1/cases/123
```

### 2.4 Path Info

Path info adalah sisa path setelah context path dan servlet path.

Dengan mapping:

```text
/api/*
```

dan request:

```text
/aceas/api/v1/cases/123
```

hasilnya:

```text
context path = /aceas
servlet path = /api
path info    = /v1/cases/123
```

Jersey biasanya melakukan resource matching terhadap path aplikasi yang diturunkan dari path info/base URI.

### 2.5 Application Path

Dalam Jersey/JAX-RS/Jakarta REST, `@ApplicationPath` mendefinisikan base path aplikasi REST jika menggunakan discovery berbasis `Application`.

Contoh:

```java
@ApplicationPath("/api")
public class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        packages("com.example.api");
    }
}
```

Ini bukan `@Path` resource. Ini base deployment path untuk aplikasi REST.

### 2.6 Resource Path

Resource path adalah path pada resource class/method.

```java
@Path("/cases")
public class CaseResource {

    @GET
    @Path("/{id}")
    public CaseDto find(@PathParam("id") String id) {
        ...
    }
}
```

Dengan base `/api`, endpoint menjadi:

```text
/api/cases/{id}
```

Tapi resource-nya tetap `cases`, bukan `api/cases`.

---

## 3. Layered Path Decomposition

Ambil contoh request:

```text
GET https://example.com/aceas/api/v1/cases/123?expand=true
```

Deployment:

```text
WAR context path       = /aceas
Jersey servlet mapping = /api/*
Resource class         = @Path("/v1/cases")
Resource method        = @Path("/{id}")
```

Decomposition:

```text
Full external URL:
  https://example.com/aceas/api/v1/cases/123?expand=true

Request path:
  /aceas/api/v1/cases/123

Context path:
  /aceas

Path inside web app:
  /api/v1/cases/123

Servlet mapping:
  /api/*

Servlet path:
  /api

Path info:
  /v1/cases/123

Jersey resource matching path:
  /v1/cases/123

Matched resource:
  @Path("/v1/cases") + @Path("/{id}")

PathParam:
  id = 123
```

Jika engineer menulis:

```java
@Path("/api/v1/cases")
```

maka resource path menjadi terlalu panjang untuk model ini.

---

## 4. Servlet Mapping Types

Servlet container memiliki beberapa bentuk URL pattern utama:

| Pattern Type | Contoh | Makna |
|---|---:|---|
| Exact mapping | `/health` | Cocok hanya path spesifik |
| Path/prefix mapping | `/api/*` | Cocok semua request di bawah `/api` |
| Extension mapping | `*.json` | Cocok berdasarkan extension |
| Default mapping | `/` | Fallback/default servlet |
| Context root mapping | `""` | Cocok context root tertentu |

Untuk Jersey, yang paling sering dipakai:

```text
/api/*
/
/*
```

Ketiganya tidak sama.

---

## 5. Mapping `/api/*`

Ini model paling eksplisit dan paling disarankan untuk banyak aplikasi enterprise.

```xml
<servlet>
    <servlet-name>Jersey API</servlet-name>
    <servlet-class>org.glassfish.jersey.servlet.ServletContainer</servlet-class>
    <init-param>
        <param-name>jersey.config.server.provider.packages</param-name>
        <param-value>com.example.api</param-value>
    </init-param>
    <load-on-startup>1</load-on-startup>
</servlet>

<servlet-mapping>
    <servlet-name>Jersey API</servlet-name>
    <url-pattern>/api/*</url-pattern>
</servlet-mapping>
```

Request:

```text
GET /myapp/api/cases/123
```

Container:

```text
context path = /myapp
servlet path = /api
path info    = /cases/123
```

Jersey resource:

```java
@Path("/cases")
public class CaseResource {
    @GET
    @Path("/{id}")
    public Response find(@PathParam("id") String id) {
        ...
    }
}
```

Endpoint effective:

```text
/myapp/api/cases/123
```

### 5.1 Keuntungan `/api/*`

- API boundary jelas.
- Static file dapat tetap dilayani servlet default.
- UI dan API bisa coexist dalam satu WAR.
- Reverse proxy routing mudah.
- Security rule bisa dipisah.
- Observability/access log lebih mudah dikategorikan.
- Mengurangi risiko Jersey menangkap semua request.

### 5.2 Kekurangan `/api/*`

- Resource path harus tidak mengulang `/api`.
- Reverse proxy harus mempertahankan prefix yang benar.
- Jika aplikasi dipindah ke root context, URL berubah jika proxy tidak mengabstraksi.
- Beberapa generated absolute URI perlu aware terhadap base URI.

---

## 6. Mapping `/`

Mapping `/` adalah default servlet mapping.

```xml
<servlet-mapping>
    <servlet-name>Jersey API</servlet-name>
    <url-pattern>/</url-pattern>
</servlet-mapping>
```

Secara intuitif banyak orang mengira `/` hanya cocok root path. Itu salah.

Dalam servlet mapping, `/` berarti default mapping untuk web application. Ia bisa menerima banyak request yang tidak dicocokkan oleh servlet mapping lain yang lebih spesifik.

Contoh:

```text
GET /myapp/cases/123
```

Bisa masuk ke Jersey jika tidak ada mapping lain yang lebih spesifik.

### 6.1 Kapan `/` Cocok?

Cocok jika aplikasi adalah pure API service:

```text
/myapp/cases
/myapp/users
/myapp/health
```

Tidak ada static UI, JSP, atau servlet lain yang perlu dipisahkan.

### 6.2 Risiko Mapping `/`

Jika satu WAR berisi:

- static frontend,
- JSP,
- Jersey API,
- legacy servlet,
- download endpoint,
- documentation assets,

maka mapping `/` dapat membuat boundary kabur.

Contoh masalah:

```text
GET /myapp/index.html
```

Mungkin diharapkan dilayani static file. Tapi jika Jersey menjadi default servlet, request bisa jatuh ke Jersey dan menghasilkan 404 JSON, bukan HTML static file.

### 6.3 Mental Model

Mapping `/` artinya:

```text
"Jersey adalah fallback utama untuk web app ini."
```

Bukan:

```text
"Jersey hanya menangani root URL."
```

---

## 7. Mapping `/*`

Mapping `/*` adalah prefix mapping yang sangat luas.

```xml
<url-pattern>/*</url-pattern>
```

Maknanya:

```text
Semua path di bawah web application context cocok.
```

Ini sering dipakai karena “pasti semua masuk”, tetapi justru sering menjadi anti-pattern.

### 7.1 Perbedaan `/` dan `/*`

Secara praktis:

```text
/   = default servlet mapping
/*  = path mapping seluruh path
```

`/*` lebih agresif sebagai path mapping. Ia dapat mengalahkan fallback/default behavior dan sering menangkap static resources, JSP, dan endpoint lain.

### 7.2 Kenapa `/*` Berbahaya untuk Jersey?

Karena request seperti ini:

```text
/myapp/assets/app.js
/myapp/index.html
/myapp/favicon.ico
```

dapat terseret ke Jersey matching.

Jersey lalu mencoba mencocokkan resource path:

```text
/assets/app.js
/index.html
/favicon.ico
```

Jika tidak ada resource, hasilnya 404 dari Jersey.

Bagi frontend/browser, ini tampak seperti asset hilang. Bagi backend, ini tampak seperti routing Jersey bermasalah. Root cause-nya mapping terlalu lebar.

### 7.3 Kapan `/*` Layak?

Jarang. Mungkin layak jika:

- aplikasi benar-benar hanya API,
- tidak ada static resource,
- tidak ada JSP,
- tidak ada servlet lain,
- semua error response ingin dikontrol Jersey,
- deployment sudah diuji untuk path metadata seperti `/health`, `/metrics`, `/favicon.ico`.

Namun untuk production enterprise, lebih aman memakai:

```text
/api/*
```

atau mapping eksplisit lain.

---

## 8. Exact Mapping

Exact mapping:

```xml
<url-pattern>/health</url-pattern>
```

Artinya hanya path tertentu yang masuk.

Untuk Jersey, exact mapping jarang dipakai sebagai mapping utama karena JAX-RS butuh sub-path matching. Tapi bisa dipakai untuk servlet khusus di luar Jersey.

Contoh:

```xml
<servlet-mapping>
    <servlet-name>HealthServlet</servlet-name>
    <url-pattern>/health</url-pattern>
</servlet-mapping>

<servlet-mapping>
    <servlet-name>Jersey API</servlet-name>
    <url-pattern>/api/*</url-pattern>
</servlet-mapping>
```

Ini membuat `/health` tidak melewati Jersey.

### 8.1 Kapan Exact Mapping Berguna?

- health check container yang sangat ringan,
- readiness check sebelum Jersey fully initialized,
- metrics endpoint dari servlet khusus,
- legacy servlet endpoint,
- file download servlet khusus,
- admin endpoint yang tidak ingin ikut JAX-RS pipeline.

Namun hati-hati: memecah terlalu banyak endpoint keluar dari Jersey dapat membuat observability dan security policy tidak konsisten.

---

## 9. Extension Mapping

Extension mapping:

```xml
<url-pattern>*.json</url-pattern>
```

Ini berarti request dengan extension `.json` masuk ke servlet.

Contoh:

```text
/users.json
/orders.json
```

### 9.1 Kenapa Extension Mapping Biasanya Tidak Disarankan untuk Jersey REST API?

REST modern biasanya memakai content negotiation via header:

```http
Accept: application/json
Content-Type: application/json
```

Bukan via URL extension.

Extension mapping dapat memunculkan ambiguitas:

```text
/api/users.json
```

Apakah `.json` bagian dari identity resource? Atau format response? Atau servlet mapping?

Dengan JAX-RS, hal semacam ini lebih baik diselesaikan melalui:

```java
@Produces(MediaType.APPLICATION_JSON)
```

dan header `Accept`.

### 9.2 Kapan Extension Mapping Masih Muncul?

- legacy API,
- compatibility dengan client lama,
- static export endpoint,
- servlet lama,
- migration dari framework lama.

Untuk Jersey deployment modern, jadikan extension mapping sebagai legacy bridge, bukan default design.

---

## 10. `@ApplicationPath` vs `web.xml`

Ada dua cara umum mendefinisikan base path aplikasi Jersey dalam servlet environment.

### 10.1 Annotation-Based

```java
@ApplicationPath("/api")
public class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        packages("com.example.api");
    }
}
```

Container/Jersey akan menggunakan annotation ini untuk menentukan path aplikasi.

### 10.2 `web.xml` Based

```xml
<servlet>
    <servlet-name>Jersey API</servlet-name>
    <servlet-class>org.glassfish.jersey.servlet.ServletContainer</servlet-class>
    <init-param>
        <param-name>jakarta.ws.rs.Application</param-name>
        <param-value>com.example.ApiApplication</param-value>
    </init-param>
</servlet>

<servlet-mapping>
    <servlet-name>Jersey API</servlet-name>
    <url-pattern>/api/*</url-pattern>
</servlet-mapping>
```

### 10.3 Jangan Campur Sembarangan

Problem umum:

```java
@ApplicationPath("/api")
public class ApiApplication extends ResourceConfig {}
```

Lalu di `web.xml`:

```xml
<url-pattern>/api/*</url-pattern>
```

Tergantung konfigurasi dan deployment mode, ini dapat menyebabkan:

- base path dobel,
- resource path tidak sesuai asumsi,
- dokumentasi endpoint membingungkan,
- test lokal dan server berbeda,
- generated URI salah.

### 10.4 Rule of Thumb

Pilih satu owner base path:

```text
Option A:
  @ApplicationPath("/api")
  no explicit servlet mapping unless container discovery handles it cleanly

Option B:
  web.xml maps Jersey to /api/*
  Application/ResourceConfig only registers resources/providers

Option C:
  programmatic servlet registration maps Jersey explicitly
  ResourceConfig does not pretend to own external path
```

Untuk sistem enterprise/regulatory, Option B atau C sering lebih auditable karena deployment descriptor/programmatic registration eksplisit.

---

## 11. Resource `@Path` Jangan Mengulang Deployment Prefix

Jika servlet mapping:

```text
/api/*
```

maka resource:

```java
@Path("/cases")
public class CaseResource {}
```

bukan:

```java
@Path("/api/cases")
public class CaseResource {}
```

Salah:

```java
@Path("/api/cases")
public class CaseResource {
    @GET
    public List<CaseDto> list() {}
}
```

Request:

```text
GET /myapp/api/cases
```

Dapat gagal karena Jersey melihat `/cases`, sementara resource menunggu `/api/cases`.

Benar:

```java
@Path("/cases")
public class CaseResource {
    @GET
    public List<CaseDto> list() {}
}
```

Effective URL:

```text
/myapp/api/cases
```

Mental model:

```text
Deployment prefix belongs to deployment config.
Resource path belongs to domain API model.
```

---

## 12. Context Path Tidak Sama dengan API Prefix

Context path:

```text
/aceas
```

API prefix:

```text
/api
```

Resource path:

```text
/cases
```

Effective external path:

```text
/aceas/api/cases
```

Jangan campur:

```java
@Path("/aceas/api/cases") // buruk
```

Kenapa buruk?

Karena ketika WAR dipindah:

```text
/aceas -> /
```

atau reverse proxy mengekspos:

```text
/regulatory/api/cases
```

resource ikut rusak.

Resource class tidak boleh tahu nama WAR/context path.

---

## 13. Reverse Proxy Path Rewriting

Deployment modern sering seperti ini:

```text
client:
  https://api.company.com/aceas/api/cases

reverse proxy:
  forwards to http://aceas-service:8080/aceas/api/cases
```

atau:

```text
client:
  https://api.company.com/api/cases

reverse proxy:
  strips /api and forwards to http://service:8080/cases
```

atau:

```text
client:
  https://company.com/aceas/api/cases

reverse proxy:
  strips /aceas and forwards to http://service:8080/api/cases
```

Setiap mode mengubah path yang dilihat container.

### 13.1 Preserve Prefix

Proxy mempertahankan path:

```text
external: /aceas/api/cases
internal: /aceas/api/cases
```

Container mapping harus cocok dengan path internal.

### 13.2 Strip Prefix

Proxy menghapus prefix:

```text
external: /aceas/api/cases
internal: /api/cases
```

Aplikasi tidak melihat `/aceas`.

Jika aplikasi membangun absolute URI tanpa forwarded prefix awareness, response bisa berisi URL internal yang salah.

### 13.3 Add Prefix

Proxy menambahkan prefix:

```text
external: /api/cases
internal: /myapp/api/cases
```

Ini sering muncul saat container butuh context path tertentu tetapi public URL lebih pendek.

### 13.4 Problem Umum

Resource berjalan:

```text
GET /cases -> 200
```

Tapi dari public URL:

```text
GET /api/cases -> 404
```

Kemungkinan:

- proxy strip prefix tapi servlet mapping masih `/api/*`,
- proxy preserve prefix tapi servlet mapping `/`,
- context path berbeda,
- health check memakai internal path yang berbeda dari external path,
- generated OpenAPI base URL salah.

---

## 14. Forwarded Headers dan Base URI

Jika Jersey membuat absolute URI:

```java
URI created = uriInfo.getAbsolutePathBuilder()
    .path(id)
    .build();
return Response.created(created).build();
```

Jersey bergantung pada request URI yang dilihat runtime.

Di belakang proxy TLS termination:

```text
client sees:
  https://api.example.com/api/cases/123

application sees:
  http://service:8080/api/cases/123
```

Tanpa forwarded header handling, `Location` response bisa salah:

```http
Location: http://service:8080/api/cases/123
```

Harusnya:

```http
Location: https://api.example.com/api/cases/123
```

Relevant headers:

```http
X-Forwarded-Proto: https
X-Forwarded-Host: api.example.com
X-Forwarded-Port: 443
X-Forwarded-Prefix: /api
Forwarded: proto=https;host=api.example.com
```

Namun dukungan detail bergantung container/proxy/framework config. Jadi production design harus eksplisit.

---

## 15. Matrix: Mapping vs Resource Path

Anggap resource:

```java
@Path("/cases")
public class CaseResource {
    @GET
    @Path("/{id}")
    public Response find(@PathParam("id") String id) {}
}
```

| Context Path | Servlet Mapping | Request | Jersey Matching Path | Expected |
|---|---:|---|---|---|
| `/app` | `/api/*` | `/app/api/cases/1` | `/cases/1` | match |
| `/app` | `/` | `/app/cases/1` | `/cases/1` | match |
| empty | `/api/*` | `/api/cases/1` | `/cases/1` | match |
| empty | `/` | `/cases/1` | `/cases/1` | match |
| `/app` | `/*` | `/app/cases/1` | usually `/cases/1` | likely match |
| `/app` | `/api/*` | `/app/cases/1` | not routed to Jersey | no match |
| `/app` | `/` | `/app/api/cases/1` | `/api/cases/1` | no match unless resource includes `/api` |

Key lesson:

```text
Resource @Path must match the path Jersey receives,
not necessarily the full external URL.
```

---

## 16. Root Context Deployment

Root deployment means web app context path is empty.

Examples:

```text
Tomcat ROOT.war
```

External:

```text
https://example.com/api/cases
```

Container decomposition with mapping `/api/*`:

```text
context path = ""
servlet path = /api
path info    = /cases
```

Root context is operationally attractive because public URL is short.

But it has risks:

- collisions with other apps on same host,
- static/API boundary issues,
- hard to host multiple WARs under same virtual host,
- migration from non-root context can break absolute paths,
- tests often assume `/app`.

Rule:

```text
Do not bake context path into resource code.
```

---

## 17. Multiple Jersey Applications in One WAR

Satu WAR dapat punya lebih dari satu Jersey servlet.

Contoh:

```xml
<servlet>
    <servlet-name>Public API</servlet-name>
    <servlet-class>org.glassfish.jersey.servlet.ServletContainer</servlet-class>
    <init-param>
        <param-name>jakarta.ws.rs.Application</param-name>
        <param-value>com.example.publicapi.PublicApiApplication</param-value>
    </init-param>
</servlet>

<servlet>
    <servlet-name>Admin API</servlet-name>
    <servlet-class>org.glassfish.jersey.servlet.ServletContainer</servlet-class>
    <init-param>
        <param-name>jakarta.ws.rs.Application</param-name>
        <param-value>com.example.adminapi.AdminApiApplication</param-value>
    </init-param>
</servlet>

<servlet-mapping>
    <servlet-name>Public API</servlet-name>
    <url-pattern>/api/*</url-pattern>
</servlet-mapping>

<servlet-mapping>
    <servlet-name>Admin API</servlet-name>
    <url-pattern>/admin-api/*</url-pattern>
</servlet-mapping>
```

Effective:

```text
/app/api/cases
/app/admin-api/users
```

### 17.1 Benefits

- separate resource packages,
- separate providers,
- separate auth filters,
- separate exception mapper,
- separate operational policy.

### 17.2 Risks

- duplicate provider registration,
- inconsistent JSON behavior,
- shared singleton state accidentally,
- different error format,
- overlapping mapping,
- harder integration tests.

If using multiple Jersey applications, create explicit boundaries:

```text
PublicApiApplication
AdminApiApplication
InternalApiApplication
```

Do not rely on broad package scanning like:

```java
packages("com.example")
```

because it can accidentally register resources into both apps.

---

## 18. Mapping Collision

Servlet mapping collision happens when multiple servlets/filters can match the same request.

Example:

```xml
<servlet-mapping>
    <servlet-name>Jersey API</servlet-name>
    <url-pattern>/api/*</url-pattern>
</servlet-mapping>

<servlet-mapping>
    <servlet-name>LegacyServlet</servlet-name>
    <url-pattern>/api/legacy/*</url-pattern>
</servlet-mapping>
```

For:

```text
/api/legacy/status
```

The more specific path mapping should win.

But from a maintenance perspective, this is dangerous because API ownership is split.

Better:

```text
/api/*
/legacy/*
```

or:

```text
/api/v1/*
/api/internal/*
```

with clear ownership.

---

## 19. Filter Mapping and Servlet Mapping Interactions

If Jersey is deployed as filter:

```xml
<filter>
    <filter-name>Jersey Filter</filter-name>
    <filter-class>org.glassfish.jersey.servlet.ServletContainer</filter-class>
</filter>

<filter-mapping>
    <filter-name>Jersey Filter</filter-name>
    <url-pattern>/api/*</url-pattern>
</filter-mapping>
```

Then filter chain matters.

Example chain:

```text
Request
  -> CorrelationIdFilter
  -> SecurityFilter
  -> CORSFilter
  -> JerseyFilter
  -> Static/default servlet or next servlet
```

Depending on filter behavior, Jersey may:

- handle request and stop chain,
- pass request down chain if no resource match,
- write error directly,
- interact with wrapped request/response.

### 19.1 Dispatcher Types

Filter mapping may include dispatcher types:

```xml
<dispatcher>REQUEST</dispatcher>
<dispatcher>FORWARD</dispatcher>
<dispatcher>ERROR</dispatcher>
<dispatcher>ASYNC</dispatcher>
```

If not configured carefully:

- error dispatch may bypass Jersey,
- forwarded request may unexpectedly enter Jersey,
- async dispatch may lose correlation context,
- internal forward to static page may be intercepted.

For API-only Jersey servlet deployment, dispatcher complexity is usually lower than filter deployment.

---

## 20. Static Resources and Jersey

If WAR includes:

```text
src/main/webapp/index.html
src/main/webapp/assets/app.js
src/main/webapp/favicon.ico
```

Then mapping choice matters.

### 20.1 Safe Layout

```text
/static/*
/assets/*
/api/*
```

Jersey:

```xml
<url-pattern>/api/*</url-pattern>
```

Static resources handled by default servlet.

### 20.2 Risky Layout

Jersey:

```xml
<url-pattern>/*</url-pattern>
```

Now static resource requests may hit Jersey first.

### 20.3 SPA Fallback Problem

Single Page Applications often need:

```text
GET /app/dashboard -> return index.html
```

But API needs:

```text
GET /api/cases -> Jersey
```

Do not solve this by making Jersey catch everything unless intentional.

Better:

```text
/api/*        -> Jersey
/*            -> frontend fallback servlet/filter/static server
```

Or split FE and API into separate deployments.

---

## 21. Trailing Slash Semantics

JAX-RS/Jakarta REST path matching has its own normalization and matching rules, but deployment path still matters.

Examples:

```text
/api/cases
/api/cases/
/api/cases/123
/api/cases/123/
```

Potential issues:

- container may treat paths differently before Jersey,
- proxy may normalize double slashes,
- client may cache redirect from slash normalization,
- resource `@Path("/")` can behave differently from empty method path,
- generated links may differ.

Recommended API policy:

```text
Choose canonical trailing slash policy.
Redirect or normalize at edge if needed.
Test both slash and no-slash variants.
```

Common modern REST API policy:

```text
/api/cases      valid collection
/api/cases/     either redirect to /api/cases or also valid consistently
```

Do not leave this accidental.

---

## 22. Double Slash and Encoded Slash

Paths can contain:

```text
/api//cases
/api/cases/%2F
/api/cases/a%2Fb
/api/cases/%252F
```

Different containers/proxies may normalize or reject encoded slashes differently.

Security implication:

```text
/api/admin
/api/%61dmin
/api/a%2F..%2Fadmin
```

If reverse proxy and servlet container normalize differently, authorization rules can be bypassed.

Production invariant:

```text
Path normalization must be consistent across:
  reverse proxy,
  servlet container,
  Jersey,
  security filters,
  audit logs.
```

Do not authorize on one representation and route on another.

---

## 23. Matrix Parameters

JAX-RS historically supports matrix parameters:

```text
/cases;status=open/123;view=full
```

In modern APIs, matrix parameters are less common, but can still affect path parsing.

Important distinction:

```text
/cases;status=open
```

The semicolon part may be treated specially by JAX-RS, container, or proxy.

Some security hardening configurations strip or reject semicolon content because of past path traversal/security issues in servlet ecosystems.

If your platform does not intentionally use matrix parameters:

```text
Reject or normalize semicolon path parameters at edge.
```

If you do use them:

```text
Document and test proxy/container/Jersey behavior explicitly.
```

---

## 24. Case Sensitivity

URLs are generally case-sensitive in path segments.

```text
/api/cases
/api/Cases
/API/cases
```

These should not be assumed equivalent.

Production rule:

```text
Use lowercase path conventions.
Reject or 404 unexpected casing.
Avoid case-insensitive routing unless required by legacy compatibility.
```

Why?

Because case-insensitive behavior can differ between:

- Windows dev environment,
- Linux production,
- reverse proxy,
- servlet container,
- static resource resolution,
- application routing.

---

## 25. API Versioning and Mapping

Common options:

### 25.1 Version in Servlet Mapping

```xml
<url-pattern>/api/v1/*</url-pattern>
```

Resource:

```java
@Path("/cases")
```

Effective:

```text
/api/v1/cases
```

### 25.2 Version in Resource Path

```xml
<url-pattern>/api/*</url-pattern>
```

Resource:

```java
@Path("/v1/cases")
```

Effective:

```text
/api/v1/cases
```

### 25.3 Which One Is Better?

For most systems:

```text
/api/* as servlet mapping
/v1/... in resource path
```

Why?

Because `/api` is deployment boundary. `/v1` is API contract boundary.

Deployment boundary can change by environment. API version is part of public contract.

So:

```text
servlet mapping = platform/deployment concern
resource @Path  = API/domain contract concern
```

### 25.4 Multiple Versioned Jersey Applications

For strong isolation:

```text
/api/v1/* -> V1Application
/api/v2/* -> V2Application
```

This can help when:

- provider behavior differs,
- DTO serialization differs,
- auth differs,
- compatibility windows are long,
- old version is frozen.

But it increases deployment complexity.

---

## 26. Health, Metrics, and Management Paths

Should health be under Jersey?

Options:

```text
/api/health
/health
/actuator/health
/management/health
```

### 26.1 Health Outside Jersey

Benefits:

- works even if Jersey resource registration fails,
- simpler startup probe,
- lower dependency path.

Risks:

- may report healthy while Jersey is broken,
- security/logging format differs.

### 26.2 Health Inside Jersey

Benefits:

- tests actual Jersey pipeline,
- provider/DI/resource registration exercised,
- consistent auth/logging/error behavior.

Risks:

- if Jersey startup fails, health unavailable,
- readiness and liveness need careful separation.

Top-tier model:

```text
liveness:
  process/container is alive

readiness:
  Jersey app is initialized and dependencies required for serving traffic are ready

deep health:
  database, downstreams, queues, cache, storage are within acceptable limits
```

Do not let mapping hide these distinctions.

---

## 27. Error Dispatch and `/error`

Some servlet containers use error pages or error dispatch:

```xml
<error-page>
    <error-code>404</error-code>
    <location>/error/404</location>
</error-page>
```

If Jersey is mapped broadly:

```text
/*
```

then `/error/404` may be intercepted by Jersey, producing unexpected recursive error handling.

If Jersey is mapped narrowly:

```text
/api/*
```

then error pages outside `/api` can be separate.

For pure API services, it is usually better to let Jersey exception mappers produce API errors for Jersey-routed requests, and let container-level errors handle non-Jersey startup/container failures.

---

## 28. Practical Debugging Endpoint

For deployment debugging, create temporary endpoint in non-production or protected environment:

```java
@Path("/debug/request")
public class RequestDebugResource {

    @Context
    private jakarta.servlet.http.HttpServletRequest request;

    @Context
    private jakarta.ws.rs.core.UriInfo uriInfo;

    @GET
    @Produces(MediaType.TEXT_PLAIN)
    public String debug() {
        return """
            requestURI=%s
            contextPath=%s
            servletPath=%s
            pathInfo=%s
            queryString=%s
            uriInfo.baseUri=%s
            uriInfo.requestUri=%s
            uriInfo.path=%s
            """.formatted(
                request.getRequestURI(),
                request.getContextPath(),
                request.getServletPath(),
                request.getPathInfo(),
                request.getQueryString(),
                uriInfo.getBaseUri(),
                uriInfo.getRequestUri(),
                uriInfo.getPath()
            );
    }
}
```

For Java 8, no text blocks:

```java
return String.format(
    "requestURI=%s%ncontextPath=%s%nservletPath=%s%npathInfo=%s%nqueryString=%s%nbaseUri=%s%nrequestUri=%s%npath=%s%n",
    request.getRequestURI(),
    request.getContextPath(),
    request.getServletPath(),
    request.getPathInfo(),
    request.getQueryString(),
    uriInfo.getBaseUri(),
    uriInfo.getRequestUri(),
    uriInfo.getPath()
);
```

Use this to compare:

```text
local direct URL
container internal URL
reverse-proxy public URL
Kubernetes ingress URL
```

Remove or protect this endpoint in production because it leaks topology.

---

## 29. Diagnostic Procedure for 404

When Jersey endpoint returns 404, ask:

### Step 1 — Did request reach the correct host?

Check:

```text
DNS
reverse proxy route
load balancer target
container port
context root
```

### Step 2 — Did request reach the correct web application?

Check access log:

```text
/app/api/cases
```

If access log absent, request never reached this app.

### Step 3 — Did request reach Jersey servlet/filter?

Add/log:

```text
requestURI
contextPath
servletPath
pathInfo
```

If servlet path is not expected, mapping is wrong.

### Step 4 — Did Jersey application register resource?

Check startup logs:

```text
registered classes
packages scanned
provider list
resource model validation
```

### Step 5 — Does resource path match Jersey-relative path?

If Jersey sees:

```text
/cases
```

resource should be:

```java
@Path("/cases")
```

Not:

```java
@Path("/api/cases")
```

### Step 6 — Is HTTP method correct?

Resource may exist but method not allowed:

```text
GET vs POST
```

Jersey should normally return 405 if path matches but method does not.

### Step 7 — Is media type causing mismatch?

```text
@Consumes
@Produces
Content-Type
Accept
```

This may produce 415/406 rather than 404, but ambiguous diagnostics can happen if filters/proxies rewrite responses.

---

## 30. Diagnostic Procedure for Wrong Generated URL

Symptom:

```http
Location: http://internal-service:8080/app/api/cases/123
```

Expected:

```http
Location: https://api.company.com/api/cases/123
```

Check:

```text
1. Is reverse proxy setting Forwarded or X-Forwarded-* headers?
2. Is container configured to honor forwarded headers?
3. Does Jersey use UriInfo from container request?
4. Is public prefix stripped or preserved?
5. Is application context path internal-only?
6. Is Location generated manually or via UriInfo?
```

Bad:

```java
URI.create("http://localhost:8080/api/cases/" + id)
```

Better:

```java
uriInfo.getAbsolutePathBuilder()
    .path(id)
    .build();
```

But this only works correctly if deployment/proxy base URI is correct.

---

## 31. Diagnostic Procedure for Static File 404

Symptom:

```text
/index.html 404 JSON from Jersey
/assets/app.js 404 JSON from Jersey
```

Likely:

```xml
<url-pattern>/*</url-pattern>
```

or Jersey filter catches all paths.

Check:

```text
1. Is Jersey mapped to /*?
2. Is default servlet still reachable?
3. Is SPA fallback implemented separately?
4. Is reverse proxy forwarding static paths to API app?
5. Are static resources actually packaged in WAR?
```

Recommended fix:

```text
/api/* -> Jersey
/*     -> static/frontend/default servlet
```

or split FE/API deployments.

---

## 32. Diagnostic Procedure for Endpoint Works Locally but Fails Behind Proxy

Local:

```text
curl http://localhost:8080/app/api/cases
200
```

Public:

```text
curl https://example.com/api/cases
404
```

Check path transform:

```text
public path       = /api/cases
proxy internal    = ?
context path      = ?
servlet mapping   = ?
Jersey sees path  = ?
```

Common mismatch:

```text
proxy forwards /cases
Jersey expects /api/*
```

or:

```text
proxy forwards /api/cases
app context path is /app
container expects /app/api/cases
```

Fix by aligning one of:

- proxy rewrite rule,
- container context path,
- servlet mapping,
- deployment URL contract,
- health check path,
- generated documentation base URL.

---

## 33. Design Pattern: Stable External API, Flexible Internal Deployment

For long-lived enterprise/regulatory systems, public URLs should not depend on internal WAR name.

Bad:

```text
https://example.com/aceas-1.4.7/api/cases
```

Better:

```text
https://example.com/aceas/api/cases
```

or:

```text
https://api.example.com/cases
```

Then internal deployment can be:

```text
Tomcat context /aceas
Kubernetes service aceas-api
Jersey mapping /api/*
```

Reverse proxy/ingress owns public route stability.

Code owns resource model:

```text
/cases
/appeals
/compliance-checks
```

Deployment config owns:

```text
/aceas
/api
/internal
/admin
```

---

## 34. Design Pattern: Explicit API Boundary

Recommended default:

```text
Context path:
  /aceas

Jersey servlet mapping:
  /api/*

Resource paths:
  /cases
  /appeals
  /users
  /documents

Effective URLs:
  /aceas/api/cases
  /aceas/api/appeals
  /aceas/api/users
  /aceas/api/documents
```

Advantages:

- easy to reason,
- easy to secure,
- easy to proxy,
- easy to test,
- easy to separate static frontend,
- less accidental capture.

---

## 35. Design Pattern: API-Only Root Service

For microservice/containerized API:

```text
Context path:
  none

Jersey mapping:
  /

Resource paths:
  /cases
  /appeals
  /health
```

Effective:

```text
/cases
/appeals
/health
```

External proxy may expose:

```text
https://api.company.com/aceas/cases
```

with prefix handled by ingress.

This is clean if:

- service is API-only,
- no static assets,
- no legacy servlet,
- no multiple applications in same WAR,
- forwarded headers are configured,
- health paths are clear.

---

## 36. Design Pattern: Versioned API Boundary

```text
Context path:
  /aceas

Jersey mapping:
  /api/*

Resource paths:
  /v1/cases
  /v1/appeals
  /v2/cases
```

Effective:

```text
/aceas/api/v1/cases
/aceas/api/v2/cases
```

Why version in resource path?

Because version is API contract, not servlet deployment detail.

---

## 37. Anti-Pattern: Path Constants Including Context

Bad:

```java
public final class Paths {
    public static final String BASE = "/aceas/api";
    public static final String CASES = BASE + "/cases";
}
```

This mixes:

```text
context path + servlet mapping + resource path
```

in Java code.

Better:

```java
@Path(ApiPaths.CASES)
public class CaseResource {}

public final class ApiPaths {
    public static final String CASES = "/cases";
}
```

Deployment config owns `/aceas/api`.

---

## 38. Anti-Pattern: Copy-Pasted `@Path("/api/...")`

Bad:

```java
@Path("/api/users")
@Path("/api/cases")
@Path("/api/documents")
```

This usually means deployment prefix leaked into resource model.

If servlet mapping is `/api/*`, remove `/api`.

---

## 39. Anti-Pattern: Broad Package Scanning with Multiple Mappings

Bad:

```java
packages("com.example");
```

for both:

```text
/api/*
/admin/*
```

because both Jersey applications may register all resources.

Better:

```java
packages("com.example.publicapi");
packages("com.example.adminapi");
```

or explicit class registration:

```java
register(CaseResource.class);
register(AdminUserResource.class);
```

Explicit registration is more verbose but more deterministic.

---

## 40. Anti-Pattern: Proxy Rewrite Hidden from Application Tests

Tests call:

```text
/app/api/cases
```

Production calls:

```text
/api/cases
```

Ingress rewrites:

```text
/api/(.*) -> /app/api/$1
```

But no test validates this.

Fix:

- include deployment-level integration tests,
- test via ingress/proxy path,
- capture expected `contextPath`, `servletPath`, `pathInfo`,
- test generated `Location` headers,
- test OpenAPI server URL if applicable.

---

## 41. Test Matrix for Servlet Mapping

A serious deployment test should include:

```text
GET /context/api/cases
GET /context/api/cases/
GET /context/api/unknown
GET /context/assets/app.js
GET /context/
GET /context/api
GET /context/api/
GET /context/api//cases
GET /context/api/cases%2F123
GET /context/API/cases
```

Expected results must be explicit.

| Request | Expected |
|---|---|
| `/app/api/cases` | 200 |
| `/app/api/cases/` | 200 or redirect |
| `/app/api/unknown` | API 404 JSON |
| `/app/assets/app.js` | static 200 or static 404, not Jersey JSON |
| `/app/api` | defined behavior |
| `/app/api/` | defined behavior |
| `/app/api//cases` | reject or normalize |
| `/app/API/cases` | 404 |
| `/app/api/cases%2F123` | reject unless explicitly supported |

---

## 42. Build-Time Guardrails

Add tests that assert deployment paths.

Example with JerseyTest or servlet integration test:

```java
@Test
void caseEndpointIsUnderApiPrefix() {
    Response response = client
        .target(baseUri)
        .path("/api/cases")
        .request()
        .get();

    assertEquals(200, response.getStatus());
}
```

Also test wrong path:

```java
@Test
void caseEndpointWithoutApiPrefixShouldNotAccidentallyWork() {
    Response response = client
        .target(baseUri)
        .path("/cases")
        .request()
        .get();

    assertEquals(404, response.getStatus());
}
```

This prevents accidental broad mapping from hiding deployment mistakes.

---

## 43. Runtime Guardrails

At startup, log deployment configuration:

```text
Application name
Context path
Servlet mapping
Registered resource classes
Registered providers
Base URI if available
Effective API prefix
```

Example log:

```text
Jersey application initialized
  contextPath=/aceas
  servletMapping=/api/*
  resources=42
  providers=17
  apiBase=/aceas/api
```

Do not log secrets. Do log topology enough to debug routing.

---

## 44. Security Implications of Mapping

Security rules often use path matchers.

Example:

```text
/api/admin/*
/api/public/*
/api/internal/*
```

If servlet mapping/proxy path changes, security rules may not protect what you think.

Bad:

```text
Proxy strips /api before app
Security filter checks /api/admin/*
App sees /admin/*
```

Result:

```text
admin endpoint may bypass intended rule.
```

Rule:

```text
Authorize using the same normalized path representation that routing uses.
```

Better:

- security filter runs after path normalization,
- proxy and app path semantics documented,
- tests verify denied paths through public URL,
- audit log includes original URI and normalized route.

---

## 45. Audit and Regulatory Defensibility

For regulated systems, path mapping affects audit defensibility.

Audit should be able to answer:

```text
What external URL did user call?
What internal route handled it?
Which Jersey resource method handled it?
Which security policy applied?
Which tenant/context/module did it map to?
Was any prefix rewritten?
```

Suggested audit fields:

```text
external.scheme
external.host
external.path
request.uri.raw
request.contextPath
request.servletPath
request.pathInfo
jersey.resourceClass
jersey.resourceMethod
http.method
route.template
proxy.forwardedFor
correlationId
userId
tenantId
```

This makes deployment behavior explainable during incident review.

---

## 46. Java 8 vs Java 25 Considerations

The servlet mapping concepts are stable across Java versions, but implementation context changes.

### Java 8 Era

Common stack:

```text
Java 8
Jersey 2.x
javax.ws.rs.*
javax.servlet.*
Servlet 3.x/4.x
Tomcat 8/9
Jetty 9
GlassFish 4/5
```

Code imports:

```java
import javax.ws.rs.Path;
import javax.servlet.http.HttpServletRequest;
```

### Java 11/17/21/25 Modern Era

Common stack:

```text
Java 11+
Jersey 3.x
jakarta.ws.rs.*
jakarta.servlet.*
Servlet 5+
Tomcat 10+
Jetty 11/12+
GlassFish/Payara modern Jakarta versions
```

Jersey 4/Jakarta REST 4.0 era:

```text
Java 17+
Jakarta EE 11
Jakarta REST 4.0
```

Code imports:

```java
import jakarta.ws.rs.Path;
import jakarta.servlet.http.HttpServletRequest;
```

Mapping mental model remains the same. Namespace and container compatibility do not.

---

## 47. Practical Recommended Defaults

For enterprise Jersey WAR deployment:

```text
Context path:
  business application name, e.g. /aceas

Jersey mapping:
  /api/*

Resource paths:
  domain paths only, e.g. /cases, /appeals

Versioning:
  /v1 in resource path if needed

Static frontend:
  separate deployment preferred
  or outside /api

Health:
  /health or /api/health, decided explicitly

Proxy:
  preserve or strip prefix intentionally
  configure forwarded headers

Tests:
  include public URL and internal URL
```

For microservice Jersey embedded deployment:

```text
Context path:
  none

Jersey base:
  /

Public prefix:
  owned by ingress/API gateway

Resource paths:
  domain paths only

Forwarded headers:
  configured and tested

Health/readiness:
  explicit

No static assets:
  preferred
```

---

## 48. Summary

Servlet mapping is the bridge between the web container and Jersey.

The core mental model:

```text
External URL != Jersey resource path.
```

A full request path is decomposed into:

```text
context path
servlet path
path info
Jersey-relative path
resource @Path
```

The safest enterprise default is often:

```text
/context/api/... externally
/api/* servlet mapping
/domain-resource paths inside Jersey
```

Avoid:

```text
/* unless intentionally API-only
@Path("/api/...") if /api is deployment prefix
hardcoded context paths
unvalidated reverse proxy rewrites
ambiguous @ApplicationPath + web.xml ownership
```

A top-tier engineer can debug routing by looking at:

```text
requestURI
contextPath
servletPath
pathInfo
UriInfo baseUri
UriInfo requestUri
registered resources
proxy rewrite rule
```

Once this becomes instinctive, many “Jersey 404” problems stop being mysterious.

---

## 49. Checklist

Before declaring Jersey deployment correct, verify:

- [ ] Context path is known.
- [ ] Servlet mapping is explicit.
- [ ] Resource `@Path` does not duplicate deployment prefix.
- [ ] `@ApplicationPath` and `web.xml` do not conflict.
- [ ] `/`, `/*`, and `/api/*` semantics are understood.
- [ ] Static assets are not accidentally captured by Jersey.
- [ ] Health paths are intentionally routed.
- [ ] Reverse proxy preserves/strips prefix intentionally.
- [ ] Forwarded headers are configured if absolute URI generation matters.
- [ ] Tests cover public and internal paths.
- [ ] 404 diagnostics distinguish container routing from Jersey resource matching.
- [ ] Security rules use same normalized path as routing.
- [ ] Audit logs contain enough path decomposition data.
- [ ] Java/Jersey/Servlet namespace compatibility is correct.

---

## 50. What Comes Next

Part berikutnya:

```text
Part 8 — Programmatic Deployment with ResourceConfig
```

Kita akan membahas bagaimana membangun deployment Jersey tanpa terlalu bergantung pada `web.xml`, bagaimana `ResourceConfig` menjadi composition root aplikasi Jersey, bagaimana explicit registration mengalahkan package scanning untuk determinisme, dan bagaimana membuat startup fail-fast yang auditable.

---

## Status Seri

Seri belum selesai.

Progress:

```text
Part 0  selesai
Part 1  selesai
Part 2  selesai
Part 3  selesai
Part 4  selesai
Part 5  selesai
Part 6  selesai
Part 7  selesai
Part 8  berikutnya
Total rencana: 32 part
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-jersey-deployment-models-part-006.md">⬅️ Part 6 — Jersey as Servlet Filter: Filter-Based Deployment Model</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-jersey-deployment-models-part-008.md">Part 8 — Programmatic Deployment with `ResourceConfig` ➡️</a>
</div>
