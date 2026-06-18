# learn-java-servlet-websocket-web-container-runtime-part-005

# Part 005 — Request Object Internals: `HttpServletRequest`

> Seri: `learn-java-servlet-websocket-web-container-runtime`  
> Bagian: `005 / 031`  
> Topik: Servlet request object, HTTP request decomposition, parameters, headers, body, attributes, wrappers, proxy boundary, and production failure model  
> Target pembaca: Java engineer yang sudah memahami Java, concurrency, I/O, security basics, Jakarta EE fundamentals, JAX-RS basics/advance, dan ingin memahami Servlet runtime secara mendalam.

---

## 0. Tujuan Part Ini

Di part sebelumnya kita membahas **lifecycle servlet**: container membuat instance servlet, memanggil `init`, lalu banyak thread request memanggil `service`, dan akhirnya container memanggil `destroy` saat aplikasi dihentikan.

Part ini masuk ke object yang paling sering disentuh tetapi sering paling disalahpahami:

```java
jakarta.servlet.http.HttpServletRequest
```

atau di aplikasi lama:

```java
javax.servlet.http.HttpServletRequest
```

Secara sederhana, `HttpServletRequest` adalah object yang diberikan container ke servlet untuk mewakili **HTTP request yang sedang diproses**.

Tetapi untuk engineer yang ingin sangat kuat di server-side Java, definisi itu terlalu dangkal.

Mental model yang lebih tepat:

```text
HttpServletRequest adalah view container terhadap sebuah request HTTP
setelah container melakukan parsing protocol, decoding sebagian metadata,
routing ke web application, mapping ke servlet/filter chain,
dan melekatkan state runtime yang hanya valid selama lifecycle request tersebut.
```

Artinya, request object bukan hanya `Map<String, String>` dari query parameter. Ia adalah boundary object yang membawa:

- protocol metadata,
- request target,
- header,
- cookie,
- parameter,
- body stream,
- attribute internal container/framework,
- session handle,
- authentication principal,
- async lifecycle state,
- dispatch metadata,
- servlet mapping result,
- network/client information,
- proxy-related ambiguity.

Jika salah memahami object ini, bug yang muncul biasanya sulit dilacak:

- body request hilang setelah dibaca filter,
- encoding parameter rusak,
- redirect salah scheme `http` bukan `https`,
- URL callback salah karena reverse proxy,
- `getParameter()` tiba-tiba memicu body parsing,
- request attribute tertimpa framework,
- wrong client IP,
- duplicated context path,
- session tidak ditemukan,
- CORS/preflight dianggap request bisnis,
- multipart upload menyebabkan temp disk penuh,
- endpoint menerima URL yang sama tetapi `servletPath` dan `pathInfo` berbeda,
- security check melihat path yang berbeda dari router framework.

Part ini membangun mental model agar kita bisa men-debug dan mendesain request handling secara presisi.

---

## 1. Posisi `HttpServletRequest` dalam Lifecycle

Ketika client mengirim HTTP request:

```http
POST /aceas/applications/123/documents?draft=true HTTP/1.1
Host: eservice.example.gov
Content-Type: application/json; charset=UTF-8
Accept: application/json
Cookie: JSESSIONID=abc123
X-Forwarded-Proto: https
X-Forwarded-For: 203.0.113.10

{"documentType":"LICENSE"}
```

container tidak langsung memanggil controller/framework.

Urutan kasarnya:

```text
1. socket menerima bytes
2. connector membaca HTTP request line + headers
3. container memvalidasi protocol dasar
4. container menentukan virtual host/context
5. container menentukan web application berdasarkan context path
6. container menentukan servlet/filter mapping
7. container membuat atau menyiapkan HttpServletRequest object
8. container membuat atau menyiapkan HttpServletResponse object
9. filter chain dipanggil
10. servlet/service/framework dipanggil
11. response dikirim
12. request object tidak boleh dipakai lagi setelah lifecycle selesai
```

`HttpServletRequest` berada di tengah boundary ini.

```text
raw bytes from socket
  ↓
HTTP parser inside container
  ↓
container request representation
  ↓
HttpServletRequest facade/wrapper
  ↓
filter chain
  ↓
servlet/framework
```

Penting: object yang kita pegang sebagai `HttpServletRequest` biasanya bukan object internal paling bawah container. Ia adalah facade/wrapper yang mengekspos kontrak Servlet API. Tomcat, Jetty, Undertow, dan server lain punya representasi internal masing-masing.

Implikasinya:

- Jangan mengandalkan implementation class container.
- Jangan cast ke class Tomcat/Jetty internal kecuali sangat terpaksa dan sadar vendor lock-in.
- Gunakan API standar Servlet semaksimal mungkin.
- Jika perlu behavior khusus, pakai filter/wrapper/container config.

---

## 2. `ServletRequest` vs `HttpServletRequest`

Hierarki dasarnya:

```java
public interface ServletRequest {
    // protocol-agnostic request data
}

public interface HttpServletRequest extends ServletRequest {
    // HTTP-specific request data
}
```

`ServletRequest` membawa konsep umum:

- attribute,
- parameter,
- input stream,
- character encoding,
- content length,
- content type,
- locale,
- protocol,
- scheme,
- server name,
- server port,
- remote address,
- async context.

`HttpServletRequest` menambahkan HTTP-specific concept:

- method,
- URI,
- URL,
- context path,
- servlet path,
- path info,
- query string,
- headers,
- cookies,
- session,
- authentication principal,
- requested session id,
- HTTP upgrade,
- trailer fields,
- servlet mapping information.

Dalam praktik, hampir semua web app HTTP akan bekerja dengan `HttpServletRequest`, bukan hanya `ServletRequest`.

---

## 3. Jangan Anggap Request sebagai Object Domain

Kesalahan mental model yang umum:

```text
request = data input user
```

Lebih akurat:

```text
request = protocol envelope + runtime context + mutable dispatch carrier
```

Request object bukan DTO bisnis.

DTO bisnis adalah misalnya:

```java
public record CreateApplicationRequest(
    String applicantName,
    String licenceType,
    LocalDate effectiveDate
) {}
```

Sedangkan `HttpServletRequest` membawa banyak hal yang tidak boleh bocor ke domain layer:

- client address,
- cookies,
- servlet mapping,
- request attributes,
- session,
- raw headers,
- scheme/host/port,
- input stream,
- dispatcher state,
- async context,
- principal,
- locale.

Pattern yang sehat:

```text
Servlet boundary
  ↓ parse/validate/adapt
Application input model
  ↓ use case
Domain model
```

Bukan:

```text
Service layer menerima HttpServletRequest dan membaca parameter sendiri
```

Kenapa?

Karena jika service layer tergantung `HttpServletRequest`, maka:

- domain logic terikat Servlet API,
- testing lebih sulit,
- reuse di batch/message/event lebih sulit,
- security boundary kabur,
- request lifecycle bisa bocor ke async/background code,
- framework migration lebih mahal.

Rule sederhana:

```text
HttpServletRequest sebaiknya berhenti di web boundary.
```

---

## 4. Anatomy HTTP Request dari Sudut Pandang Servlet

HTTP request punya beberapa bagian:

```text
METHOD SP REQUEST_TARGET SP HTTP_VERSION CRLF
HEADER_NAME: HEADER_VALUE CRLF
HEADER_NAME: HEADER_VALUE CRLF
...
CRLF
BODY
```

Contoh:

```http
POST /app/cases/CASE-001/actions?dryRun=true HTTP/1.1
Host: agency.example.gov
Content-Type: application/json; charset=UTF-8
Accept: application/json
Authorization: Bearer eyJ...
Cookie: JSESSIONID=abc
Content-Length: 47

{"action":"ESCALATE","reason":"late response"}
```

Dari request ini, Servlet API bisa memberi kita:

| HTTP part | Servlet API |
|---|---|
| Method | `request.getMethod()` |
| Request URI | `request.getRequestURI()` |
| Request URL | `request.getRequestURL()` |
| Query string | `request.getQueryString()` |
| Protocol | `request.getProtocol()` |
| Headers | `request.getHeader(...)`, `getHeaders(...)`, `getHeaderNames()` |
| Cookies | `request.getCookies()` |
| Body as bytes | `request.getInputStream()` |
| Body as chars | `request.getReader()` |
| Parameters | `request.getParameter(...)`, `getParameterMap()` |
| Content type | `request.getContentType()` |
| Content length | `request.getContentLengthLong()` |
| Character encoding | `request.getCharacterEncoding()` |
| Scheme | `request.getScheme()` |
| Host/server | `request.getServerName()` |
| Port | `request.getServerPort()` |
| Remote address | `request.getRemoteAddr()` |
| Secure? | `request.isSecure()` |

Tetapi setiap method punya nuance.

---

## 5. URI Decomposition: Bagian yang Sering Membingungkan

Misalkan aplikasi di-deploy pada context path:

```text
/aceas
```

Servlet mapping:

```text
/api/*
```

Client request:

```http
GET /aceas/api/cases/CASE-123/documents?includeDraft=true HTTP/1.1
Host: eservice.example.gov
```

Maka umumnya:

```java
request.getContextPath();  // "/aceas"
request.getServletPath();  // "/api"
request.getPathInfo();     // "/cases/CASE-123/documents"
request.getQueryString();  // "includeDraft=true"
request.getRequestURI();   // "/aceas/api/cases/CASE-123/documents"
request.getRequestURL();   // "http://eservice.example.gov/aceas/api/cases/CASE-123/documents" as StringBuffer
```

Diagram:

```text
/aceas/api/cases/CASE-123/documents?includeDraft=true
 └───┘ └─┘ └──────────────────────┘ └───────────────┘
  |     |            |                    |
  |     |            |                    query string
  |     |            path info
  |     servlet path
  context path
```

### 5.1 `getRequestURI()`

`getRequestURI()` mengembalikan path portion dari URL dari setelah authority sampai sebelum query string.

Untuk:

```text
https://eservice.example.gov/aceas/api/cases/123?draft=true
```

hasilnya:

```text
/aceas/api/cases/123
```

Bukan full URL. Bukan query string. Bukan decoded parameter map.

### 5.2 `getRequestURL()`

`getRequestURL()` mengembalikan reconstructed URL sebagai `StringBuffer`.

Contoh:

```text
http://internal-service:8080/aceas/api/cases/123
```

Masalah muncul saat aplikasi berada di balik reverse proxy:

```text
External client sees:
https://eservice.example.gov/aceas/api/cases/123

Application sees internal connector:
http://aceas-app:8080/aceas/api/cases/123
```

Jika proxy header tidak dikonfigurasi, `getRequestURL()` bisa menghasilkan URL internal, bukan URL public.

### 5.3 `getContextPath()`

`getContextPath()` adalah prefix web application.

Contoh:

```text
/aceas
/cpds
/admin
```

Jika app di-root context, hasilnya biasanya empty string `""`, bukan `/`.

Bug umum:

```java
String url = request.getContextPath() + "/api/cases";
```

Aman.

Tapi jika developer menganggap context path selalu `/aceas`, deployment root context akan membuat asumsi rusak.

### 5.4 `getServletPath()`

`getServletPath()` adalah bagian URI yang cocok dengan servlet mapping.

Jika mapping:

```java
@WebServlet("/api/*")
```

request:

```text
/aceas/api/cases/123
```

maka:

```text
servletPath = /api
pathInfo    = /cases/123
```

Jika mapping exact:

```java
@WebServlet("/health")
```

request:

```text
/aceas/health
```

maka:

```text
servletPath = /health
pathInfo    = null
```

Jika mapping extension:

```java
@WebServlet("*.do")
```

request:

```text
/aceas/cases/list.do
```

maka result tergantung mapping semantics, tetapi intinya `servletPath` adalah bagian yang dipakai container untuk memilih servlet.

### 5.5 `getPathInfo()`

`getPathInfo()` adalah extra path setelah servlet path, sebelum query string.

Untuk REST-like servlet manual, ini sering dipakai:

```java
String pathInfo = request.getPathInfo(); // "/cases/123"
```

Tetapi di framework modern, biasanya framework routing sendiri mengambil alih setelah servlet mapping.

Contoh Spring `DispatcherServlet` mapping:

```text
/
```

atau:

```text
/*
```

hasil decomposition bisa sangat berbeda. Karena itu debugging path harus melihat mapping servlet/filer sebenarnya, bukan hanya URL browser.

### 5.6 `getQueryString()`

`getQueryString()` mengembalikan raw query string, tanpa leading `?`.

Contoh:

```text
includeDraft=true&page=1
```

Nilainya belum tentu decoded seperti parameter map. Jangan pakai query string raw untuk bisnis logic kecuali memang butuh preserve original string.

---

## 6. Parameter vs Header vs Attribute vs Body

Ini salah satu bagian terpenting.

Banyak bug terjadi karena developer mencampur empat konsep ini.

```text
Parameter  = data input yang diparsing container dari query string/form body
Header     = metadata HTTP dari client/proxy
Attribute  = server-side object yang ditempel selama request lifecycle
Body       = raw payload stream request
```

### 6.1 Request Parameter

Parameter diakses dengan:

```java
request.getParameter("name");
request.getParameterValues("name");
request.getParameterMap();
request.getParameterNames();
```

Sumber parameter biasanya:

- query string:

```http
GET /search?q=java&page=2 HTTP/1.1
```

- form URL encoded POST body:

```http
POST /login HTTP/1.1
Content-Type: application/x-www-form-urlencoded

username=fajar&remember=true
```

- multipart form, jika dikonfigurasi dan diproses sebagai multipart.

Parameter bukan JSON body.

Untuk request:

```http
POST /cases HTTP/1.1
Content-Type: application/json

{"caseId":"CASE-001"}
```

ini biasanya:

```java
request.getParameter("caseId") // null
```

Karena JSON body tidak otomatis menjadi request parameter oleh Servlet API.

### 6.2 Header

Header diakses dengan:

```java
String accept = request.getHeader("Accept");
Enumeration<String> values = request.getHeaders("Accept");
Enumeration<String> names = request.getHeaderNames();
long date = request.getDateHeader("If-Modified-Since");
int length = request.getIntHeader("Content-Length");
```

Header adalah metadata protocol. Contoh:

- `Accept`,
- `Content-Type`,
- `Authorization`,
- `Cookie`,
- `User-Agent`,
- `Forwarded`,
- `X-Forwarded-For`,
- `If-None-Match`,
- `Range`,
- `Origin`.

Header tidak boleh diperlakukan sebagai data tepercaya hanya karena datang dari client. Banyak header dapat dipalsukan kecuali di-set oleh trusted proxy yang sudah dikontrol.

### 6.3 Attribute

Attribute diakses dengan:

```java
request.setAttribute("correlationId", correlationId);
Object value = request.getAttribute("correlationId");
request.removeAttribute("correlationId");
```

Attribute adalah server-side carrier selama request lifecycle.

Sumber attribute:

- filter,
- servlet,
- framework,
- container,
- error dispatch,
- forward/include dispatch,
- async dispatch.

Attribute bukan input client langsung.

Contoh use case:

```java
request.setAttribute("requestStartNanos", System.nanoTime());
request.setAttribute("authenticatedUser", user);
request.setAttribute("validationErrors", errors);
```

Karena attribute mutable dan global untuk lifecycle request, gunakan naming yang jelas agar tidak bentrok.

Better:

```java
request.setAttribute("com.example.aceas.correlationId", id);
```

Risky:

```java
request.setAttribute("id", id);
```

### 6.4 Body

Body dibaca dengan:

```java
ServletInputStream in = request.getInputStream();
```

atau:

```java
BufferedReader reader = request.getReader();
```

Rule penting:

```text
Untuk satu request, pilih salah satu: getInputStream() atau getReader().
Jangan keduanya.
```

`getInputStream()` cocok untuk binary atau manual JSON parser.  
`getReader()` cocok untuk character text body dengan encoding yang benar.

Framework seperti Spring MVC/JAX-RS biasanya membaca body untuk kita dan mengubahnya menjadi DTO.

---

## 7. Side Effect `getParameter()` terhadap Body

Ini adalah jebakan klasik Servlet.

Pada request `application/x-www-form-urlencoded` dengan method POST, parameter bisa berasal dari body.

Contoh:

```http
POST /login HTTP/1.1
Content-Type: application/x-www-form-urlencoded

username=fajar&password=secret
```

Jika kode memanggil:

```java
String username = request.getParameter("username");
```

container mungkin perlu membaca body untuk mem-parse parameter.

Akibatnya, setelah parameter parsed, raw input stream bisa sudah dikonsumsi.

Sebaliknya, jika filter membaca body dulu:

```java
String raw = new String(request.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
chain.doFilter(request, response);
```

lalu downstream memanggil:

```java
request.getParameter("username")
```

parameter bisa hilang atau parsing gagal, tergantung container dan timing.

Mental model:

```text
Request body adalah stream satu arah.
Parameter parsing untuk form POST bisa membaca stream itu.
Jika filter/framework membaca stream tanpa wrapper yang benar,
downstream tidak bisa membaca ulang.
```

### 7.1 Safe Pattern: Caching Request Wrapper

Jika kita perlu membaca body di filter untuk logging/signature validation, kita perlu wrapper yang menyimpan copy body.

Contoh minimal:

```java
public final class CachedBodyHttpServletRequest extends HttpServletRequestWrapper {
    private final byte[] cachedBody;

    public CachedBodyHttpServletRequest(HttpServletRequest request) throws IOException {
        super(request);
        this.cachedBody = request.getInputStream().readAllBytes();
    }

    @Override
    public ServletInputStream getInputStream() {
        ByteArrayInputStream byteArrayInputStream = new ByteArrayInputStream(cachedBody);

        return new ServletInputStream() {
            @Override
            public int read() {
                return byteArrayInputStream.read();
            }

            @Override
            public boolean isFinished() {
                return byteArrayInputStream.available() == 0;
            }

            @Override
            public boolean isReady() {
                return true;
            }

            @Override
            public void setReadListener(ReadListener readListener) {
                throw new UnsupportedOperationException("Non-blocking read not implemented");
            }
        };
    }

    @Override
    public BufferedReader getReader() {
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

Tetapi wrapper ini belum production-grade untuk semua kondisi.

Problem:

- body besar bisa membebani heap,
- multipart upload tidak boleh sembarang di-cache ke memory,
- non-blocking I/O tidak diimplementasikan,
- form parameter parsing bisa berubah,
- encoding perlu hati-hati,
- sensitive data bisa masuk log.

Production pattern:

```text
Only cache small body + only for allowed content types + enforce max size + redact sensitive fields + avoid multipart + avoid binary.
```

---

## 8. Character Encoding

Encoding adalah sumber bug halus, terutama untuk form POST, query parameter, dan legacy systems.

Servlet API menyediakan:

```java
request.getCharacterEncoding();
request.setCharacterEncoding("UTF-8");
```

`setCharacterEncoding` harus dipanggil sebelum body/parameter dibaca.

Contoh filter:

```java
public final class Utf8RequestEncodingFilter implements Filter {
    @Override
    public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
            throws IOException, ServletException {

        if (request.getCharacterEncoding() == null) {
            request.setCharacterEncoding(StandardCharsets.UTF_8.name());
        }

        chain.doFilter(request, response);
    }
}
```

Kenapa harus sebelum `getParameter()`?

Karena `getParameter()` dapat memicu parsing body. Setelah parsing terjadi, mengganti encoding tidak akan memperbaiki parameter yang sudah salah decode.

### 8.1 Query String Encoding

Query string decoding sering dipengaruhi container configuration, bukan hanya Servlet API. Beberapa container punya setting seperti URI encoding pada connector.

Misalnya request:

```text
/search?q=izin%20usaha
```

Jika encoding salah, hasil bisa rusak untuk karakter non-ASCII.

Rule praktis modern:

```text
Gunakan UTF-8 end-to-end.
Pastikan connector/proxy/app sepakat.
Jangan mengandalkan default container legacy.
```

### 8.2 Body Encoding

Untuk body text:

```http
Content-Type: application/json; charset=UTF-8
```

atau:

```http
Content-Type: application/x-www-form-urlencoded; charset=UTF-8
```

Jika charset tidak diberikan, behavior bisa bergantung content type, spec, dan container. Untuk sistem modern, jangan membuat ambiguity: selalu kirim charset untuk text body ketika relevan.

### 8.3 Common Encoding Failure

Gejala:

```text
Rizky → Rizky aman
São Paulo → SÃ£o Paulo
中文 → ????
```

Root causes:

- client tidak encode UTF-8,
- proxy mengubah/normalisasi path,
- connector URI encoding salah,
- `setCharacterEncoding` terlambat,
- body dibaca sebagai default platform charset,
- data disimpan ke DB dengan charset/collation incompatible,
- log viewer salah encoding.

Debug checklist:

```text
1. capture raw HTTP request if possible
2. inspect Content-Type charset
3. inspect connector URI encoding
4. check first code that calls getParameter/getReader/getInputStream
5. check framework body converter
6. check DB column/connection encoding
7. check rendering/response encoding
```

---

## 9. Request Headers Deep Dive

Header tampak sederhana, tetapi sangat penting untuk routing, security, caching, content negotiation, dan proxy behavior.

### 9.1 Single vs Multiple Header Values

HTTP header bisa punya multiple values.

Servlet API menyediakan:

```java
String first = request.getHeader("Accept");
Enumeration<String> all = request.getHeaders("Accept");
```

Jangan selalu menganggap header hanya satu value.

Contoh:

```http
Accept: application/json
Accept: text/plain
```

atau:

```http
Accept: application/json, text/plain;q=0.9
```

### 9.2 Case Insensitivity

HTTP header names case-insensitive secara semantics.

Jangan membuat logic yang bergantung pada case:

```java
request.getHeader("content-type")
request.getHeader("Content-Type")
```

Container normalnya menangani ini.

### 9.3 Dangerous Headers

Header berikut sering disalahgunakan jika dipercaya mentah-mentah:

| Header | Risiko |
|---|---|
| `X-Forwarded-For` | Bisa dipalsukan jika tidak hanya diterima dari trusted proxy |
| `X-Forwarded-Proto` | Bisa menyebabkan wrong redirect/security decision |
| `Host` | Host header injection jika dipakai membangun URL tanpa validasi |
| `Origin` | Perlu validasi untuk CORS/WebSocket, tapi bukan authentication |
| `Referer` | Tidak reliable untuk security decision |
| `User-Agent` | Bisa dipalsukan, jangan untuk trust decision |
| `Authorization` | Sensitive, jangan log mentah |
| `Cookie` | Sensitive, jangan log mentah |

### 9.4 Header Size Limit

Jika cookie/token terlalu besar, container/proxy bisa mengembalikan:

```text
400 Bad Request
431 Request Header Fields Too Large
502/503 dari proxy
```

Batas header bisa ada di:

- browser,
- reverse proxy,
- load balancer,
- servlet connector,
- app gateway.

Jangan simpan data besar dalam cookie/header.

---

## 10. Cookies dari Request

Cookies diakses dengan:

```java
Cookie[] cookies = request.getCookies();
```

Nilai bisa `null` jika tidak ada cookie.

Safe helper:

```java
public static Optional<Cookie> findCookie(HttpServletRequest request, String name) {
    Cookie[] cookies = request.getCookies();
    if (cookies == null) {
        return Optional.empty();
    }

    return Arrays.stream(cookies)
        .filter(cookie -> cookie.getName().equals(name))
        .findFirst();
}
```

Cookie request biasanya membawa:

- `JSESSIONID`,
- CSRF token cookie,
- preference cookie,
- tracking cookie,
- SSO-related cookie,
- gateway session cookie.

Jangan log semua cookies mentah.

Cookie sering menjadi sumber masalah saat:

- domain berubah,
- path berubah,
- aplikasi dipindah dari `/aceas` ke `/`,
- HTTPS offload membuat `Secure` cookie tidak dikirim/ditulis benar,
- SameSite mengganggu SSO cross-site flow,
- cookie deletion memakai path/domain berbeda dari cookie creation.

Detail cookie akan dibahas lebih dalam di Part 013. Di part ini cukup pahami bahwa cookies adalah bagian dari request header, bukan server-side session object itu sendiri.

```text
Cookie header membawa session id.
HttpSession adalah server-side/session-store representation.
```

---

## 11. Remote Address, Scheme, Host, Port: Proxy Trap

Servlet API menyediakan:

```java
request.getRemoteAddr();
request.getRemoteHost();
request.getScheme();
request.getServerName();
request.getServerPort();
request.isSecure();
```

Jika aplikasi langsung menerima traffic dari client, ini cukup straightforward.

Tetapi production biasanya:

```text
Browser
  ↓ HTTPS
CDN/WAF
  ↓ HTTPS/HTTP
Load Balancer
  ↓ HTTP
Nginx/Ingress
  ↓ HTTP
Servlet container
```

Maka dari sudut pandang container:

```text
remoteAddr = IP proxy/ingress, bukan IP asli client
scheme     = http, walaupun client external pakai https
serverName = internal service name, bukan public hostname
serverPort = 8080, bukan 443
isSecure   = false, walaupun external request secure
```

### 11.1 Forwarded Headers

Proxy biasanya menambahkan:

```http
Forwarded: for=203.0.113.10;proto=https;host=eservice.example.gov
```

atau legacy/de-facto headers:

```http
X-Forwarded-For: 203.0.113.10, 10.0.0.5
X-Forwarded-Proto: https
X-Forwarded-Host: eservice.example.gov
X-Forwarded-Port: 443
```

Tetapi aplikasi tidak boleh asal percaya header ini dari internet.

Correct model:

```text
Only trust forwarded headers if request comes from trusted proxy.
Configure container/framework to consume forwarded headers safely.
Reject or ignore direct spoofed forwarded headers.
```

### 11.2 Wrong Scheme Bug

Bug umum:

```java
String callbackUrl = request.getRequestURL().toString() + "/callback";
```

Di balik TLS offload, hasil bisa:

```text
http://aceas-app:8080/aceas/login/callback
```

padahal user butuh:

```text
https://eservice.example.gov/aceas/login/callback
```

Efek:

- OAuth/OIDC redirect URI mismatch,
- browser mixed content,
- secure cookie tidak bekerja,
- redirect loop,
- link email salah host,
- app switcher salah domain.

Pattern yang lebih baik:

```text
Public base URL adalah configuration, bukan selalu dihitung dari request.
```

Misalnya:

```properties
app.public-base-url=https://eservice.example.gov/aceas
```

Gunakan request-derived URL hanya jika proxy chain sudah dikonfigurasi dan trust boundary jelas.

### 11.3 Client IP Bug

Naive:

```java
String ip = request.getRemoteAddr();
```

Di Kubernetes/ALB/Nginx, ini sering IP proxy.

Naive fix yang berbahaya:

```java
String ip = request.getHeader("X-Forwarded-For").split(",")[0];
```

Kenapa berbahaya?

Client bisa mengirim:

```http
X-Forwarded-For: 1.2.3.4
```

Jika proxy meneruskan header tanpa sanitasi, attacker bisa spoof IP.

Correct approach:

- configure trusted proxy to overwrite/append headers correctly,
- configure container valve/filter/framework for forwarded headers,
- validate trusted proxy source,
- define canonical client IP extraction centrally,
- never duplicate ad-hoc logic in business code.

---

## 12. Request Attributes from Dispatching

Saat request di-forward, include, error dispatch, atau async dispatch, container menambahkan attribute tertentu.

Contoh error dispatch attributes biasanya mencakup informasi seperti:

```text
jakarta.servlet.error.status_code
jakarta.servlet.error.exception
jakarta.servlet.error.message
jakarta.servlet.error.request_uri
jakarta.servlet.error.servlet_name
```

Untuk namespace lama:

```text
javax.servlet.error.status_code
javax.servlet.error.exception
...
```

Forward/include juga punya attribute terkait original path.

Kenapa penting?

Karena saat error page dipanggil, method seperti `getRequestURI()` bisa mengarah ke error page atau dispatch target, sementara original request URI disimpan di attribute.

Mental model:

```text
Request object bisa melewati beberapa dispatch phase.
URI/mapping current request bisa berubah.
Original request metadata bisa disimpan dalam attributes.
```

Ini akan dibahas lebih detail di Part 008. Untuk sekarang, pahami bahwa attribute bukan sekadar tempat kita menaruh object sendiri; container juga memakai attribute sebagai internal lifecycle carrier.

---

## 13. `getHttpServletMapping()` dan Mapping Awareness

Modern Servlet API menyediakan mapping information:

```java
HttpServletMapping mapping = request.getHttpServletMapping();
```

Informasi ini membantu mengetahui bagaimana request dipetakan ke servlet.

Konsep mapping type:

- exact,
- path,
- extension,
- default,
- context root.

Kenapa ini penting?

Karena debugging routing tidak cukup dengan melihat URL. Kita perlu tahu:

```text
URL apa yang diminta?
context path apa?
servlet mapping mana yang menang?
pathInfo apa?
framework routing menerima path apa?
```

Contoh log diagnostik yang berguna:

```java
HttpServletMapping mapping = request.getHttpServletMapping();

log.info("request mapping: method={}, uri={}, contextPath={}, servletPath={}, pathInfo={}, mappingMatch={}, pattern={}, matchValue={}, servletName={}",
    request.getMethod(),
    request.getRequestURI(),
    request.getContextPath(),
    request.getServletPath(),
    request.getPathInfo(),
    mapping.getMappingMatch(),
    mapping.getPattern(),
    mapping.getMatchValue(),
    mapping.getServletName());
```

Ini sangat membantu untuk:

- 404 misterius,
- SPA fallback salah,
- static resource tertangkap servlet,
- extension mapping legacy,
- servlet path berbeda setelah migration container,
- context root berubah.

---

## 14. Request Body: Stream, Reader, and Lifecycle

Request body adalah stream.

```text
Network socket → container parser → ServletInputStream → application/framework
```

`ServletInputStream` bukan sekadar `InputStream`; ia juga mendukung non-blocking read di Servlet 3.1+ melalui `ReadListener`.

Tetapi untuk blocking servlet biasa, kita sering melihat:

```java
byte[] body = request.getInputStream().readAllBytes();
```

Ini sederhana, tetapi bisa berbahaya jika body besar.

Better with limit:

```java
public static byte[] readLimited(ServletInputStream in, long maxBytes) throws IOException {
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    byte[] buffer = new byte[8192];
    long total = 0;

    int read;
    while ((read = in.read(buffer)) != -1) {
        total += read;
        if (total > maxBytes) {
            throw new IOException("Request body too large");
        }
        out.write(buffer, 0, read);
    }

    return out.toByteArray();
}
```

But top-tier design asks first:

```text
Do we need to read the raw body at servlet layer at all?
```

Often:

- JSON body should be parsed by framework converter,
- multipart should be handled with multipart config/provider,
- file upload should stream to disk/object storage,
- audit logging should log metadata, not full body,
- signature verification may need raw body but must be bounded.

---

## 15. Multipart Request Boundary

Multipart is special.

Servlet supports multipart with:

```java
@MultipartConfig
public class UploadServlet extends HttpServlet {
    @Override
    protected void doPost(HttpServletRequest request, HttpServletResponse response)
            throws ServletException, IOException {
        Part file = request.getPart("file");
    }
}
```

At request level:

```java
request.getParts();
request.getPart("file");
```

But multipart has very different operational concerns:

- memory threshold,
- temp disk location,
- max file size,
- max request size,
- cleanup,
- filename sanitization,
- content-type trust,
- virus scanning,
- partial upload,
- client disconnect,
- proxy buffering,
- timeout.

Do not use generic body caching filter for multipart.

Bad:

```text
Log all request bodies including multipart upload.
```

This can fill heap/disk and leak sensitive files.

Multipart will be covered in Part 016. Here, the key message is:

```text
Multipart request is not just parameters + bytes. It is a resource management problem.
```

---

## 16. Locale and Content Negotiation Boundary

`ServletRequest` exposes:

```java
Locale locale = request.getLocale();
Enumeration<Locale> locales = request.getLocales();
```

This is usually derived from `Accept-Language`.

Example:

```http
Accept-Language: id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7
```

But locale should be handled intentionally.

Potential sources of locale:

- `Accept-Language` header,
- user profile setting,
- session preference,
- tenant/agency setting,
- explicit query parameter,
- URL prefix.

Rule:

```text
Accept-Language is a hint, not always the source of truth.
```

For regulatory/official systems, user profile or agency-level setting may be more authoritative.

---

## 17. Request Security-Related Methods

`HttpServletRequest` includes methods:

```java
request.getRemoteUser();
request.getUserPrincipal();
request.isUserInRole("ADMIN");
request.getAuthType();
```

These reflect container-managed security context if configured.

In modern apps using Spring Security, custom token filter, Keycloak adapter, or gateway authentication, these may or may not be populated depending on integration.

Avoid assuming:

```java
request.getUserPrincipal() != null
```

unless you know the authentication integration sets it.

Security details will not be repeated here, but request-level implication is important:

```text
Authentication data may be represented as Servlet principal, framework SecurityContext,
request attribute, session attribute, token claims, or gateway header.
Pick one canonical model and adapt at the boundary.
```

Dangerous pattern:

```java
String user = request.getHeader("X-User-Id");
```

unless:

- header is set only by trusted gateway,
- external clients cannot spoof it,
- ingress strips incoming version,
- application validates trust boundary.

---

## 18. `HttpServletRequestWrapper`: The Correct Way to Modify Request View

Request object is interface-based. If we want to alter behavior for downstream filters/servlets, use wrapper.

```java
public class HttpServletRequestWrapper implements HttpServletRequest {
    // delegates by default
}
```

Common uses:

- cache body,
- normalize path,
- override principal,
- override scheme/host from trusted proxy,
- add synthetic header,
- sanitize parameter map,
- expose decrypted body,
- make request reusable for downstream.

Example: synthetic header wrapper:

```java
public final class ExtraHeaderRequestWrapper extends HttpServletRequestWrapper {
    private final Map<String, String> extraHeaders;

    public ExtraHeaderRequestWrapper(HttpServletRequest request, Map<String, String> extraHeaders) {
        super(request);
        this.extraHeaders = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
        this.extraHeaders.putAll(extraHeaders);
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

But be careful: wrappers can create security ambiguity.

If you override:

```java
getRemoteAddr()
getScheme()
getServerName()
getUserPrincipal()
getHeader("Authorization")
```

then downstream code may make security decisions based on synthetic data. This must be centralized, audited, and tested.

---

## 19. Request Object Lifetime

`HttpServletRequest` is valid only during request processing.

Bad:

```java
public void doPost(HttpServletRequest request, HttpServletResponse response) {
    executor.submit(() -> {
        String user = request.getParameter("user");
        // unsafe: request lifecycle may already be over
    });
}
```

Why bad?

- container may recycle object,
- input stream may close,
- attributes may no longer be valid,
- thread context/security context not propagated,
- response may be committed,
- session access may be unsafe/ambiguous.

Correct approach:

```java
public void doPost(HttpServletRequest request, HttpServletResponse response) {
    String user = request.getParameter("user");
    String correlationId = (String) request.getAttribute("correlationId");

    BackgroundCommand command = new BackgroundCommand(user, correlationId, Instant.now());

    executor.submit(() -> handle(command));
}
```

Copy the data you need into an immutable command object before leaving request thread.

For async servlet, use official async lifecycle (`AsyncContext`) instead of arbitrary background access. Async will be covered later.

---

## 20. Logging Request Data Safely

Request logging is useful but dangerous.

Good log fields:

```text
correlation_id
method
request_uri
query_present boolean or redacted query
status
duration_ms
content_type
content_length
remote_addr canonicalized
user_id if available and allowed
servlet mapping
user agent maybe truncated
```

Dangerous log fields:

```text
Authorization header
Cookie header
password parameter
raw JSON body
multipart file content
access token
refresh token
PII fields
full query string with sensitive values
```

Example safer logging filter:

```java
public final class RequestSummaryLoggingFilter implements Filter {
    @Override
    public void doFilter(ServletRequest servletRequest, ServletResponse servletResponse, FilterChain chain)
            throws IOException, ServletException {

        HttpServletRequest request = (HttpServletRequest) servletRequest;
        long start = System.nanoTime();

        try {
            chain.doFilter(servletRequest, servletResponse);
        } finally {
            long durationMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start);

            log.info("http request method={} uri={} contentType={} contentLength={} remoteAddr={} durationMs={}",
                request.getMethod(),
                request.getRequestURI(),
                request.getContentType(),
                request.getContentLengthLong(),
                request.getRemoteAddr(),
                durationMs);
        }
    }
}
```

Production-grade version should include response status too, usually by wrapping `HttpServletResponse`.

---

## 21. Request Mutability and Thread Safety

`HttpServletRequest` is request-scoped, but that does not mean all usage is automatically safe.

Within a single request, multiple components can mutate attributes:

```text
Filter A sets attribute X
Filter B overwrites attribute X
Framework reads X
Servlet forwards request
Error handler reads X again
```

In async processing, different threads may touch request lifecycle under container rules.

Rules:

- Do not use request object as general shared mutable map.
- Namespace custom attributes.
- Keep attribute values immutable where possible.
- Avoid concurrent mutation of request attributes.
- For async workflows, understand `AsyncContext` lifecycle.
- Do not store request object in static fields or long-lived objects.

Bad:

```java
static HttpServletRequest lastRequest;
```

Very bad:

```java
cache.put(userId, request);
```

---

## 22. Request as State Machine

For advanced debugging, model request lifecycle as state machine.

Simplified states:

```text
RECEIVED
  ↓
PARSED_HEADERS
  ↓
MAPPED_TO_CONTEXT
  ↓
MAPPED_TO_FILTER_CHAIN
  ↓
BODY_NOT_READ
  ├── PARAMETERS_PARSED
  ├── BODY_STREAM_OPENED
  └── READER_OPENED
  ↓
DISPATCHING
  ├── REQUEST_DISPATCH
  ├── FORWARD_DISPATCH
  ├── INCLUDE_DISPATCH
  ├── ERROR_DISPATCH
  └── ASYNC_DISPATCH
  ↓
APPLICATION_HANDLED
  ↓
RESPONSE_COMMITTED
  ↓
COMPLETED
```

Key one-way transitions:

```text
BODY_NOT_READ → BODY_STREAM_OPENED
BODY_NOT_READ → READER_OPENED
BODY_NOT_READ → PARAMETERS_PARSED for form body
```

You generally cannot go back to pristine body state unless you wrap/cache intentionally.

This state-machine view explains many bugs:

```text
Why did getParameter return null?
Because body stream was consumed earlier.

Why did setCharacterEncoding not work?
Because parameters were already parsed.

Why did error handler see different URI?
Because request entered ERROR_DISPATCH.

Why did redirect URL use http?
Because container saw internal proxy connection, not external scheme.
```

---

## 23. Production Bug Catalog

### 23.1 Body Disappears After Logging Filter

Symptom:

```text
Controller receives empty body.
```

Likely root cause:

```text
Filter read request.getInputStream() for logging and passed original request downstream.
```

Fix:

- do not log full body,
- or use bounded caching wrapper,
- skip multipart/binary,
- redact sensitive data.

### 23.2 UTF-8 Parameter Corruption

Symptom:

```text
Nama orang/alamat rusak untuk karakter non-ASCII.
```

Likely root cause:

- `setCharacterEncoding("UTF-8")` called too late,
- connector URI encoding not UTF-8,
- client omitted charset,
- body decoded with default charset.

Fix:

- enforce UTF-8 filter early,
- configure connector/proxy,
- use explicit charset,
- test with non-ASCII data.

### 23.3 Wrong Public URL Behind Proxy

Symptom:

```text
Generated link is http://internal:8080/... instead of https://public-domain/...
```

Likely root cause:

- `getRequestURL()` used behind reverse proxy,
- forwarded headers not configured/trusted,
- public base URL not configured.

Fix:

- set canonical public base URL,
- configure forwarded headers at container/framework,
- sanitize Host header.

### 23.4 Wrong Client IP

Symptom:

```text
Audit log shows load balancer IP for all users.
```

Likely root cause:

```text
Using getRemoteAddr() behind proxy.
```

Fix:

- configure trusted proxy forwarding,
- centralize client IP extraction,
- do not trust spoofable header blindly.

### 23.5 Duplicated Context Path

Symptom:

```text
Redirect goes to /aceas/aceas/login
```

Likely root cause:

- manual URL concatenation,
- public base URL already includes context path,
- `getContextPath()` appended twice.

Fix:

- define URL builder policy,
- distinguish origin base from application base,
- test root context and non-root context.

### 23.6 Framework Route Not Matching

Symptom:

```text
Servlet receives request, but controller route 404.
```

Likely root cause:

- servlet mapping consumes different path than expected,
- `servletPath`/`pathInfo` changed,
- context path changed,
- extension mapping involved.

Fix:

- log `getHttpServletMapping`, `contextPath`, `servletPath`, `pathInfo`, `requestURI`,
- inspect servlet registration,
- compare framework routing path.

### 23.7 Parameter Pollution

Symptom:

```text
Expected one parameter value, got attacker-controlled ambiguity.
```

Example:

```text
?role=user&role=admin
```

Naive code:

```java
String role = request.getParameter("role");
```

But multiple values exist:

```java
String[] roles = request.getParameterValues("role");
```

Fix:

- define cardinality rules,
- reject multiple values for scalar fields,
- validate strictly at boundary.

### 23.8 Request Attribute Collision

Symptom:

```text
Framework behavior changes unexpectedly.
```

Likely root cause:

- application uses generic request attribute name also used by framework/container.

Fix:

- namespace attributes,
- avoid generic names,
- document cross-filter attributes.

---

## 24. Designing a Robust Request Boundary

A strong Java web boundary should do these steps explicitly.

```text
1. Normalize trust boundary
2. Assign correlation/request id
3. Establish canonical client/public request metadata
4. Enforce size and content-type limits
5. Set character encoding early
6. Parse/adapt request into application input model
7. Validate cardinality and schema
8. Avoid passing HttpServletRequest deeper than web adapter
9. Log metadata safely
10. Preserve diagnostics for failure handling
```

### 24.1 Example Boundary Adapter

```java
public record RequestContext(
    String correlationId,
    String method,
    String requestUri,
    String canonicalClientIp,
    URI publicBaseUri,
    Optional<String> userId
) {}
```

Factory:

```java
public final class RequestContextFactory {
    private final URI publicBaseUri;
    private final ClientIpResolver clientIpResolver;

    public RequestContextFactory(URI publicBaseUri, ClientIpResolver clientIpResolver) {
        this.publicBaseUri = publicBaseUri;
        this.clientIpResolver = clientIpResolver;
    }

    public RequestContext from(HttpServletRequest request) {
        String correlationId = Optional.ofNullable((String) request.getAttribute("com.example.correlationId"))
            .orElseGet(() -> UUID.randomUUID().toString());

        Optional<String> userId = Optional.ofNullable(request.getUserPrincipal())
            .map(Principal::getName);

        return new RequestContext(
            correlationId,
            request.getMethod(),
            request.getRequestURI(),
            clientIpResolver.resolve(request),
            publicBaseUri,
            userId
        );
    }
}
```

This object is safe to pass deeper than Servlet boundary. It is immutable and contains only selected, canonical metadata.

---

## 25. Mini Lab: Observe Request Decomposition

Create servlet:

```java
@WebServlet("/api/*")
public class RequestDebugServlet extends HttpServlet {
    @Override
    protected void service(HttpServletRequest request, HttpServletResponse response)
            throws IOException {

        response.setContentType("text/plain; charset=UTF-8");

        PrintWriter out = response.getWriter();
        out.println("method=" + request.getMethod());
        out.println("protocol=" + request.getProtocol());
        out.println("scheme=" + request.getScheme());
        out.println("serverName=" + request.getServerName());
        out.println("serverPort=" + request.getServerPort());
        out.println("secure=" + request.isSecure());
        out.println("remoteAddr=" + request.getRemoteAddr());
        out.println("contextPath=" + request.getContextPath());
        out.println("servletPath=" + request.getServletPath());
        out.println("pathInfo=" + request.getPathInfo());
        out.println("queryString=" + request.getQueryString());
        out.println("requestURI=" + request.getRequestURI());
        out.println("requestURL=" + request.getRequestURL());

        HttpServletMapping mapping = request.getHttpServletMapping();
        out.println("mapping.pattern=" + mapping.getPattern());
        out.println("mapping.matchValue=" + mapping.getMatchValue());
        out.println("mapping.mappingMatch=" + mapping.getMappingMatch());
        out.println("mapping.servletName=" + mapping.getServletName());
    }
}
```

Request:

```bash
curl -i 'http://localhost:8080/aceas/api/cases/CASE-123/documents?includeDraft=true'
```

Then place app behind reverse proxy and compare:

```text
scheme
serverName
serverPort
remoteAddr
requestURL
```

This lab quickly teaches the difference between external user-visible URL and container-visible URL.

---

## 26. Mini Lab: Body Read Once

Servlet:

```java
@WebServlet("/echo-body")
public class EchoBodyServlet extends HttpServlet {
    @Override
    protected void doPost(HttpServletRequest request, HttpServletResponse response)
            throws IOException {

        String body = new String(request.getInputStream().readAllBytes(), StandardCharsets.UTF_8);

        response.setContentType("text/plain; charset=UTF-8");
        response.getWriter().println(body);
    }
}
```

Now add filter before it:

```java
@WebFilter("/*")
public class BadBodyLoggingFilter implements Filter {
    @Override
    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
            throws IOException, ServletException {

        HttpServletRequest request = (HttpServletRequest) req;
        String body = new String(request.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        System.out.println("body=" + body);

        chain.doFilter(req, res);
    }
}
```

Call:

```bash
curl -i -X POST 'http://localhost:8080/echo-body' \
  -H 'Content-Type: application/json' \
  -d '{"hello":"world"}'
```

Expected learning:

```text
The servlet downstream cannot read the original body again.
```

Then replace filter with caching wrapper and observe behavior.

---

## 27. Mini Lab: Parameter Cardinality

Call:

```bash
curl -i 'http://localhost:8080/debug?role=user&role=admin'
```

Servlet:

```java
String role = request.getParameter("role");
String[] roles = request.getParameterValues("role");
```

Observe:

```text
getParameter returns one value.
getParameterValues reveals all values.
```

Lesson:

```text
For scalar business fields, reject multiple values explicitly.
```

Example:

```java
public static String requiredSingleParameter(HttpServletRequest request, String name) {
    String[] values = request.getParameterValues(name);
    if (values == null || values.length == 0) {
        throw new IllegalArgumentException("Missing parameter: " + name);
    }
    if (values.length > 1) {
        throw new IllegalArgumentException("Multiple values not allowed for parameter: " + name);
    }
    return values[0];
}
```

---

## 28. Checklist: Reading `HttpServletRequest` Correctly

Before using request data, ask:

```text
1. Is this data from client, proxy, container, framework, or our own filter?
2. Is it trusted?
3. Is it decoded? If yes, by whom and using what encoding?
4. Can it have multiple values?
5. Can reading it consume the body?
6. Is the request behind reverse proxy?
7. Is this the original request or forwarded/error/async dispatch?
8. Is this value valid only during request lifecycle?
9. Could it contain sensitive data?
10. Should this be converted into an immutable application model first?
```

---

## 29. Practical Do and Don't

### Do

- Set character encoding early.
- Treat request object as boundary object.
- Use `getParameterValues` when cardinality matters.
- Use request wrappers intentionally.
- Centralize forwarded header/client IP handling.
- Prefer configured public base URL for externally visible links.
- Log metadata, not raw sensitive payload.
- Copy required data before async/background processing.
- Namespace request attributes.
- Inspect `contextPath`, `servletPath`, `pathInfo`, and `getHttpServletMapping()` when debugging routing.

### Don't

- Don't pass `HttpServletRequest` deep into domain/service layer.
- Don't read request body in filter without a wrapper if downstream needs it.
- Don't call `setCharacterEncoding` after parameters are parsed.
- Don't blindly trust `X-Forwarded-For`.
- Don't build security decisions from spoofable headers.
- Don't store request object in static/cache/session.
- Don't log `Authorization`, `Cookie`, password, token, or raw body.
- Don't assume `getRequestURL()` is public URL behind proxy.
- Don't assume `getParameter()` reads JSON body.
- Don't assume query/form parameter has only one value.

---

## 30. Mental Model Summary

`HttpServletRequest` is not just input data.

It is:

```text
container-created HTTP request facade
+ parsed protocol metadata
+ path/mapping decomposition
+ parameter/body access boundary
+ header/cookie carrier
+ request lifecycle attribute map
+ session/security handle
+ dispatch/async state
+ proxy ambiguity surface
```

The most important distinctions:

```text
Parameter ≠ Header ≠ Attribute ≠ Body
RequestURI ≠ RequestURL ≠ ContextPath ≠ ServletPath ≠ PathInfo
RemoteAddr ≠ Real Client IP behind proxy
getParameter(JSON field) usually does not work
getInputStream and getReader are mutually exclusive
form parameter parsing can consume body
request object must not outlive request lifecycle
```

Top-tier engineers debug request bugs by asking:

```text
What did the client send?
What did the proxy change?
What did the container parse?
Which web context and servlet mapping won?
Has the body already been consumed?
Which dispatch phase are we in?
Which value is canonical for the business decision?
```

---

## 31. How This Part Connects to the Next Parts

This part gives the request-side foundation for:

- Part 006: `HttpServletResponse` internals.
- Part 007: servlet mapping and URL pattern resolution.
- Part 008: request dispatching: forward, include, async, error.
- Part 009: filters and request/response wrappers.
- Part 012: session management.
- Part 013: cookies and browser boundary.
- Part 014–015: async and non-blocking request lifecycle.
- Part 029: reverse proxy, load balancer, Kubernetes, cloud runtime.
- Part 030: observability and diagnostics.

Jika Part 004 menjawab:

```text
Kapan servlet object hidup dan siapa yang memanggilnya?
```

maka Part 005 menjawab:

```text
Apa sebenarnya request object yang diberikan container kepada servlet,
dan bagaimana cara membacanya tanpa merusak correctness/security/runtime behavior?
```

---

## 32. References

- Jakarta Servlet 6.1 Specification: https://jakarta.ee/specifications/servlet/6.1/jakarta-servlet-spec-6.1
- Jakarta Servlet 6.1 API Documentation — `HttpServletRequest`: https://jakarta.ee/specifications/servlet/6.1/apidocs/jakarta.servlet/jakarta/servlet/http/httpservletrequest
- Jakarta Servlet 6.1 API Documentation — `ServletRequest`: https://jakarta.ee/specifications/servlet/6.1/apidocs/jakarta.servlet/jakarta/servlet/servletrequest
- Apache Tomcat 11 Servlet API Documentation: https://tomcat.apache.org/tomcat-11.0-doc/servletapi/
- RFC 9110 — HTTP Semantics: https://www.rfc-editor.org/rfc/rfc9110.html
- RFC 7239 — Forwarded HTTP Extension: https://www.rfc-editor.org/rfc/rfc7239.html

---

# Status Seri

Seri `learn-java-servlet-websocket-web-container-runtime` **belum selesai**.

Part yang sudah dibuat:

- Part 000 — Orientation: Mental Model Server-Side Java Web Runtime
- Part 001 — Evolution: Java EE `javax.*` ke Jakarta EE `jakarta.*`
- Part 002 — HTTP Fundamentals for Servlet Engineers
- Part 003 — Servlet Container Architecture
- Part 004 — Servlet Lifecycle Deep Dive
- Part 005 — Request Object Internals: `HttpServletRequest`

Part berikutnya:

- Part 006 — Response Object Internals: `HttpServletResponse`

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 004 — Servlet Lifecycle Deep Dive](./learn-java-servlet-websocket-web-container-runtime-part-004.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 006 — Response Object Internals: `HttpServletResponse`](./learn-java-servlet-websocket-web-container-runtime-part-006.md)
