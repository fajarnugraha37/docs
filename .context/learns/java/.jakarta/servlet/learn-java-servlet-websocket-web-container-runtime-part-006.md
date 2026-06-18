# learn-java-servlet-websocket-web-container-runtime-part-006

# Part 006 — Response Object Internals: `HttpServletResponse`

> Seri: `learn-java-servlet-websocket-web-container-runtime`  
> Part: `006 / 031`  
> Topik: Servlet response object, status, header, body, buffering, commit semantics, redirect, error, streaming, download, cache, wrapper, dan failure model.  
> Target: Java 8–25, Java EE `javax.servlet.*`, Jakarta EE `jakarta.servlet.*`

---

## 0. Posisi Part Ini Dalam Seri

Di Part 005 kita membahas `HttpServletRequest`: bagaimana request mentah dari HTTP diparsing container menjadi object Java yang dapat dibaca aplikasi.

Part ini membahas sisi sebaliknya: **bagaimana aplikasi membentuk response**.

Di level pemula, response sering dilihat hanya sebagai:

```java
response.getWriter().write("OK");
```

atau:

```java
response.setStatus(200);
```

Tetapi di level production, response adalah salah satu titik paling rawan di server-side web runtime, karena ia berada di boundary antara:

1. keputusan aplikasi,
2. aturan HTTP,
3. buffering container,
4. filter/framework chain,
5. reverse proxy,
6. browser/client behavior,
7. network failure,
8. observability,
9. error handling,
10. lifecycle request.

Kesalahan kecil di response bisa menghasilkan bug yang sangat membingungkan:

- status code sudah `200` padahal terjadi error,
- JSON error tidak terkirim karena response sudah committed,
- redirect loop karena scheme/host salah,
- file download corrupt karena `Writer` dipakai untuk binary,
- header CORS/cache tidak muncul karena ditulis setelah commit,
- `IllegalStateException` karena `getWriter()` dan `getOutputStream()` dipakai bersamaan,
- `Broken pipe` karena client menutup koneksi saat server masih menulis,
- 504 di proxy padahal aplikasi akhirnya sukses menulis response,
- memory naik karena seluruh response besar dibuffer dulu,
- audit/log salah karena status response berubah setelah filter logging mencatat.

Part ini bertujuan membangun mental model yang kuat:

> `HttpServletResponse` bukan sekadar object output. Ia adalah state machine yang dikendalikan bersama oleh aplikasi, filter, framework, container, dan transport HTTP.

---

## 1. Kontrak Dasar `ServletResponse` dan `HttpServletResponse`

Secara umum, Servlet API membagi response menjadi dua level:

| Interface | Peran |
|---|---|
| `ServletResponse` | Kontrak generic response untuk protokol request/response. |
| `HttpServletResponse` | Extension khusus HTTP: status code, header, cookie, redirect, error, trailer, dan HTTP-specific behavior. |

Secara konseptual:

```text
ServletResponse
  ├─ body output: Writer / OutputStream
  ├─ content type
  ├─ character encoding
  ├─ content length
  ├─ buffer size
  ├─ flush / reset / commit
  └─ locale

HttpServletResponse
  ├─ HTTP status code
  ├─ HTTP headers
  ├─ cookies
  ├─ redirect
  ├─ error response
  ├─ URL encoding for session tracking
  └─ HTTP trailer fields
```

Container membuat response object dan memberikannya ke servlet/framework:

```java
protected void doGet(HttpServletRequest request, HttpServletResponse response)
        throws ServletException, IOException {
    response.setStatus(HttpServletResponse.SC_OK);
    response.setContentType("text/plain;charset=UTF-8");
    response.getWriter().write("Hello");
}
```

Aplikasi tidak membuat `HttpServletResponse` sendiri. Aplikasi hanya **mengisi instruksi response** pada object yang dibuat container.

---

## 2. Mental Model: Response Sebagai State Machine

Response memiliki state internal. Secara sederhana:

```text
NEW
  ↓
MUTABLE_HEADERS
  ↓ write body / flush / sendError / sendRedirect / buffer full
COMMITTED
  ↓
BODY_STREAMING_OR_DONE
  ↓
COMPLETE
```

Sebelum committed:

- status bisa diubah,
- header bisa diubah,
- cookie bisa ditambah,
- content type bisa diubah,
- body bisa dibuffer,
- response bisa di-reset.

Setelah committed:

- status tidak efektif untuk diubah,
- header baru tidak dapat dikirim ke client,
- redirect/error tidak bisa dilakukan dengan benar,
- hanya body yang mungkin masih dapat dilanjutkan bila koneksi belum putus,
- sebagian method dapat melempar `IllegalStateException`.

Mental model penting:

> HTTP response header harus dikirim sebelum body. Begitu header dikirim ke client, keputusan status/header sudah terkunci.

Contoh raw HTTP response:

```http
HTTP/1.1 200 OK
Content-Type: application/json;charset=UTF-8
Cache-Control: no-store
Content-Length: 17

{"status":"ok"}
```

Bagian sebelum baris kosong adalah status line + header. Setelah baris kosong, body dimulai. Setelah body mulai dikirim, server tidak bisa berkata, “tunggu, statusnya sebenarnya 500.”

---

## 3. Tiga Bagian Response: Status, Header, Body

Setiap response HTTP praktis terdiri dari:

```text
Response = Status + Headers + Body
```

### 3.1 Status

Status menyatakan hasil semantik request:

```java
response.setStatus(HttpServletResponse.SC_CREATED); // 201
```

### 3.2 Header

Header memberi metadata tentang response:

```java
response.setHeader("Cache-Control", "no-store");
response.setHeader("Content-Type", "application/json;charset=UTF-8");
```

### 3.3 Body

Body adalah payload:

```java
response.getWriter().write("{\"id\":123}");
```

Kesalahan umum adalah menulis body tanpa mengunci metadata dengan benar:

```java
// Problematic
response.getWriter().write("{\"error\":\"bad request\"}");
response.setStatus(400); // mungkin sudah terlambat jika response committed
```

Urutan yang lebih aman:

```java
response.setStatus(HttpServletResponse.SC_BAD_REQUEST);
response.setContentType("application/json;charset=UTF-8");
response.getWriter().write("{\"error\":\"bad request\"}");
```

---

## 4. Status Code: Jangan Anggap Hanya Angka

`HttpServletResponse` menyediakan konstanta status code:

```java
response.setStatus(HttpServletResponse.SC_OK);                  // 200
response.setStatus(HttpServletResponse.SC_CREATED);             // 201
response.setStatus(HttpServletResponse.SC_BAD_REQUEST);         // 400
response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);        // 401
response.setStatus(HttpServletResponse.SC_FORBIDDEN);           // 403
response.setStatus(HttpServletResponse.SC_NOT_FOUND);           // 404
response.setStatus(HttpServletResponse.SC_CONFLICT);            // 409
response.setStatus(HttpServletResponse.SC_INTERNAL_SERVER_ERROR); // 500
```

Status code bukan kosmetik. Ia menentukan behavior client, browser, proxy, cache, monitoring, retry policy, dan SLO.

### 4.1 Kategori Status Code

| Range | Kategori | Meaning |
|---|---|---|
| `1xx` | Informational | Interim response. Jarang ditulis manual di servlet biasa. |
| `2xx` | Success | Request diterima dan diproses berhasil. |
| `3xx` | Redirection | Client perlu mengambil resource di lokasi lain. |
| `4xx` | Client error | Request dari client invalid atau tidak diizinkan. |
| `5xx` | Server error | Server gagal memenuhi request valid. |

### 4.2 Status Code yang Sering Salah Dipakai

| Situasi | Status yang sering salah | Lebih tepat |
|---|---:|---:|
| Validasi input gagal | `500` | `400` atau `422` bila stack mendukung convention itu |
| User belum login | `403` | `401` |
| User login tapi tidak punya akses | `401` | `403` |
| Resource tidak ada | `200` dengan body error | `404` |
| Duplicate business key | `500` | `409` |
| Upstream timeout | `500` | `504` di gateway/proxy, atau app-specific `503/504` bila app menjadi gateway |
| Overload sementara | `500` | `503` + optional `Retry-After` |
| Long-running accepted | `200` | `202` |
| Resource created | `200` | `201` + optional `Location` |

### 4.3 `setStatus` vs `sendError`

Ada dua cara umum memberi error status:

```java
response.setStatus(HttpServletResponse.SC_BAD_REQUEST);
```

atau:

```java
response.sendError(HttpServletResponse.SC_BAD_REQUEST, "Invalid request");
```

Perbedaannya penting.

#### `setStatus`

`setStatus` hanya mengatur status code. Aplikasi masih mengontrol body:

```java
response.setStatus(HttpServletResponse.SC_BAD_REQUEST);
response.setContentType("application/json;charset=UTF-8");
response.getWriter().write("{\"code\":\"INVALID_INPUT\"}");
```

Gunakan `setStatus` ketika ingin membuat response sendiri, terutama JSON API.

#### `sendError`

`sendError` memberi tahu container bahwa ini error response. Container boleh melakukan error dispatch ke error page yang dikonfigurasi dan dapat mengganti body menjadi HTML error page default.

```java
response.sendError(HttpServletResponse.SC_NOT_FOUND);
```

Gunakan `sendError` ketika memang ingin memakai mekanisme error page container atau default error behavior.

Untuk API modern, `sendError` sering menimbulkan kejutan:

- body JSON yang sudah disiapkan bisa hilang,
- container mengirim HTML error page,
- error dispatch memicu filter/error page lain,
- observability status mungkin berubah di layer berbeda.

Untuk JSON API, pola lebih deterministic:

```java
private void writeJsonError(HttpServletResponse response, int status, String code, String message)
        throws IOException {
    if (response.isCommitted()) {
        return;
    }
    response.resetBuffer();
    response.setStatus(status);
    response.setContentType("application/json;charset=UTF-8");
    response.getWriter().write("{"
            + "\"code\":\"" + escapeJson(code) + "\","
            + "\"message\":\"" + escapeJson(message) + "\""
            + "}");
}
```

Catatan: contoh `escapeJson` sengaja abstrak. Di production, gunakan JSON library, bukan string concatenation manual.

---

## 5. Header: Metadata yang Mengubah Behavior Sistem

Header bukan dekorasi. Header mengendalikan:

- cache,
- content type,
- encoding,
- download behavior,
- redirect behavior,
- cookie,
- CORS,
- security policy,
- tracing,
- compression,
- proxy handling,
- streaming semantics.

### 5.1 `setHeader` vs `addHeader`

```java
response.setHeader("Cache-Control", "no-store");
```

`setHeader` mengganti value lama.

```java
response.addHeader("Set-Cookie", "a=1; Path=/; HttpOnly");
response.addHeader("Set-Cookie", "b=2; Path=/; HttpOnly");
```

`addHeader` menambahkan value baru.

Gunakan mental model ini:

| Method | Efek |
|---|---|
| `setHeader(name, value)` | Replace existing header value. |
| `addHeader(name, value)` | Add another header value. |
| `setDateHeader` | Set date header dalam format HTTP date. |
| `addDateHeader` | Add date header. |
| `setIntHeader` | Set integer header. |
| `addIntHeader` | Add integer header. |

Untuk header yang boleh muncul multiple values seperti `Set-Cookie`, jangan sembarangan `setHeader` karena bisa menimpa cookie lain.

### 5.2 Header Case-Insensitive

HTTP header name case-insensitive. Namun convention umum:

```text
Content-Type
Cache-Control
Location
Set-Cookie
X-Request-Id
```

Jangan menulis logic yang menganggap `content-type` berbeda dari `Content-Type`.

### 5.3 Header Setelah Commit

Header harus ditulis sebelum response committed:

```java
response.getWriter().write(largeText); // dapat membuat buffer penuh dan commit
response.setHeader("Cache-Control", "no-store"); // mungkin terlambat
```

Lebih aman:

```java
response.setHeader("Cache-Control", "no-store");
response.setContentType("text/plain;charset=UTF-8");
response.getWriter().write(largeText);
```

---

## 6. Body Output: `getWriter()` vs `getOutputStream()`

Servlet response punya dua channel body:

| Method | Untuk |
|---|---|
| `getWriter()` | Character/text output. |
| `getOutputStream()` | Binary output. |

### 6.1 Text Response

```java
response.setContentType("text/plain;charset=UTF-8");
try (PrintWriter writer = response.getWriter()) {
    writer.write("Hello");
}
```

Namun dalam servlet, biasanya tidak perlu menutup writer secara eksplisit. Container mengelola lifecycle response. Menutup writer terlalu cepat dalam filter/wrapper bisa mengganggu chain. Yang lebih sering dipakai:

```java
PrintWriter writer = response.getWriter();
writer.write("Hello");
```

### 6.2 Binary Response

```java
response.setContentType("application/pdf");
response.setHeader("Content-Disposition", "attachment; filename=report.pdf");

try (InputStream in = Files.newInputStream(path)) {
    ServletOutputStream out = response.getOutputStream();
    in.transferTo(out); // Java 9+
}
```

Untuk Java 8:

```java
byte[] buffer = new byte[8192];
int read;
while ((read = in.read(buffer)) != -1) {
    out.write(buffer, 0, read);
}
```

### 6.3 Tidak Boleh Campur Writer dan OutputStream

Ini salah:

```java
response.getWriter().write("prefix");
response.getOutputStream().write(bytes); // IllegalStateException
```

Dan ini juga salah:

```java
response.getOutputStream().write(bytes);
response.getWriter().write("suffix"); // IllegalStateException
```

Pilih satu channel.

Jika harus membuat multipart/mixed response yang punya bagian text dan binary, gunakan `ServletOutputStream` dan encode bagian text secara manual sesuai charset.

---

## 7. Character Encoding dan Content Type

### 7.1 `setContentType`

```java
response.setContentType("application/json;charset=UTF-8");
```

Ini mengatur MIME type dan charset sekaligus.

### 7.2 `setCharacterEncoding`

```java
response.setCharacterEncoding("UTF-8");
response.setContentType("application/json");
```

Urutan dapat berpengaruh jika writer sudah diambil.

Rule praktis:

> Set `Content-Type` dan charset sebelum memanggil `getWriter()`.

Contoh aman:

```java
response.setStatus(HttpServletResponse.SC_OK);
response.setContentType("application/json;charset=UTF-8");
response.getWriter().write(json);
```

Contoh rawan:

```java
PrintWriter writer = response.getWriter();
response.setCharacterEncoding("UTF-8"); // bisa terlambat
writer.write(json);
```

### 7.3 Default Encoding Trap

Jika tidak eksplisit, container/framework dapat memakai default encoding yang tidak kamu harapkan. Ini bisa memunculkan bug:

- karakter non-ASCII rusak,
- JSON valid tapi teks rusak,
- CSV/Excel download bermasalah,
- signature/hash payload tidak cocok,
- test lokal pass, production gagal karena default berbeda.

Biasakan eksplisit:

```java
response.setContentType("application/json;charset=UTF-8");
```

---

## 8. Buffering dan Commit Semantics

### 8.1 Apa Itu Buffer?

Container biasanya tidak langsung mengirim setiap byte ke socket. Ia menyimpan sementara body response dalam buffer.

```text
Application writes body
  ↓
Servlet response buffer
  ↓ flush / buffer full / complete
HTTP response committed
  ↓
Socket/proxy/client
```

Manfaat buffering:

- memberi kesempatan aplikasi mengubah status/header sebelum response dikirim,
- mengurangi syscall/network writes kecil-kecil,
- memungkinkan error handling sebelum output final dikirim.

### 8.2 Commit Trigger

Response bisa committed karena:

1. `flushBuffer()` dipanggil,
2. `writer.flush()` atau output stream flush,
3. buffer penuh,
4. `sendError()` dipanggil,
5. `sendRedirect()` dipanggil,
6. servlet selesai dan container memutuskan mengirim response,
7. async complete,
8. framework melakukan flush internal.

### 8.3 Mengecek Commit

```java
if (!response.isCommitted()) {
    response.setStatus(500);
}
```

Tetapi `isCommitted()` bukan solusi ajaib. Ia hanya memberi tahu status saat itu. Race atau write berikutnya masih bisa mengubah keadaan.

### 8.4 `reset` vs `resetBuffer`

```java
response.resetBuffer();
```

Menghapus body buffer tetapi mempertahankan status/header.

```java
response.reset();
```

Menghapus status/header/body buffer, selama belum committed.

Jika sudah committed, operasi reset akan gagal atau tidak efektif.

### 8.5 Buffer Size

```java
response.setBufferSize(32 * 1024);
```

Harus dilakukan sebelum body ditulis.

Buffer lebih besar dapat memberi ruang error handling lebih lama, tetapi juga meningkatkan memory per response.

Mental model capacity:

```text
memory used by response buffers ≈ concurrent responses × buffer size
```

Jika 2.000 concurrent response masing-masing buffer 64 KB:

```text
2.000 × 64 KB = 128 MB
```

Belum termasuk object, framework buffers, JSON serialization buffers, compression buffers, dan proxy buffers.

---

## 9. Content Length, Chunked Transfer, dan Streaming

### 9.1 `setContentLength` dan `setContentLengthLong`

```java
response.setContentLengthLong(fileSize);
```

Gunakan `setContentLengthLong` untuk ukuran besar.

Manfaat `Content-Length`:

- client tahu progress,
- proxy bisa mengelola response lebih jelas,
- browser download progress lebih baik,
- keep-alive framing lebih jelas.

Namun jika ukuran tidak diketahui atau response streaming, jangan memaksa content length.

### 9.2 Chunked Transfer

Untuk HTTP/1.1, jika tidak ada `Content-Length`, container dapat memakai chunked transfer encoding.

Secara konseptual:

```text
Header dikirim dulu
Body dikirim dalam chunk bertahap
Koneksi tetap bisa keep-alive karena ada terminator chunk
```

Aplikasi biasanya tidak mengatur `Transfer-Encoding: chunked` sendiri. Biarkan container.

### 9.3 Streaming Response

Contoh streaming NDJSON:

```java
response.setStatus(HttpServletResponse.SC_OK);
response.setContentType("application/x-ndjson;charset=UTF-8");

PrintWriter writer = response.getWriter();
for (int i = 0; i < 10; i++) {
    writer.write("{\"index\":" + i + "}\n");
    writer.flush(); // commit dan kirim chunk
}
```

Trade-off flush:

| Flush sering | Flush jarang |
|---|---|
| Latency rendah | Throughput lebih baik |
| Header cepat committed | Error masih bisa diubah sebelum commit |
| Lebih banyak network overhead | Client menunggu lebih lama |
| Cocok streaming | Cocok response biasa |

Jangan flush dini kecuali memang ingin streaming.

---

## 10. Redirect Semantics

Redirect berarti server memberi tahu client untuk mengambil URL lain.

```java
response.sendRedirect("/login");
```

Secara HTTP, response redirect minimal punya:

```http
HTTP/1.1 302 Found
Location: /login
```

### 10.1 Redirect Bukan Forward

| Operation | Siapa yang bergerak? | URL browser berubah? | Request baru? |
|---|---|---:|---:|
| `forward` | Server internal | Tidak | Tidak |
| `sendRedirect` | Client/browser | Ya | Ya |

Redirect:

```text
Client request /private
  ↓
Server response 302 Location: /login
  ↓
Client request /login
```

Forward:

```text
Client request /private
  ↓
Server internally dispatches to /login.jsp
  ↓
Client still sees /private
```

### 10.2 Relative vs Absolute Redirect

```java
response.sendRedirect(request.getContextPath() + "/login");
```

Jika aplikasi deploy di context path `/app`, redirect menjadi `/app/login`.

Bug umum:

```java
response.sendRedirect("/login");
```

Ini redirect ke root domain, bukan root context aplikasi. Jika app berada di `/aceas`, user dikirim ke `/login`, bukan `/aceas/login`.

### 10.3 Redirect Behind Reverse Proxy

Jika container melihat request sebagai HTTP karena TLS terminate di proxy, aplikasi bisa membuat redirect salah:

```text
Browser → https://example.com/app
Proxy   → http://app:8080/app
App thinks scheme = http
Redirect Location: http://example.com/app/login
```

Akibat:

- mixed scheme,
- redirect loop,
- cookie `Secure` tidak sesuai,
- SSO callback salah,
- browser block karena downgrade.

Solusi bukan di `sendRedirect` semata, tetapi di konfigurasi forwarded headers pada proxy dan container/framework.

### 10.4 Redirect Status Code

Status redirect memiliki semantik berbeda:

| Status | Meaning umum |
|---:|---|
| `301` | Permanent redirect. Method dapat berubah di beberapa client legacy. |
| `302` | Temporary redirect. Historically method bisa berubah menjadi GET. |
| `303` | See Other. Cocok POST-redirect-GET. |
| `307` | Temporary redirect, method/body dipertahankan. |
| `308` | Permanent redirect, method/body dipertahankan. |

Untuk flow form submit:

```text
POST /orders
  ↓ create order
303 See Other Location: /orders/123
  ↓ browser GET /orders/123
```

Pola ini disebut **Post/Redirect/Get** dan mencegah duplicate submit saat refresh.

---

## 11. Error Response: Controlled Failure vs Container Failure

### 11.1 Error JSON Manual

Untuk API:

```java
response.setStatus(HttpServletResponse.SC_BAD_REQUEST);
response.setContentType("application/json;charset=UTF-8");
response.getWriter().write("""
    {"code":"INVALID_REQUEST","message":"Invalid request"}
    """);
```

Java 15+ text block dipakai di contoh. Untuk Java 8, gunakan string biasa.

### 11.2 Error Page Container

Di `web.xml`, legacy app dapat punya:

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

Ketika `sendError(404)` atau exception terjadi, container bisa melakukan error dispatch.

### 11.3 Problem Detail JSON

Untuk API modern, bisa memakai format mirip RFC 9457 Problem Details:

```json
{
  "type": "https://example.com/problems/invalid-request",
  "title": "Invalid request",
  "status": 400,
  "detail": "Field 'email' is required",
  "instance": "/applications/123"
}
```

Servlet-level implementation:

```java
response.setStatus(400);
response.setContentType("application/problem+json;charset=UTF-8");
jsonMapper.writeValue(response.getOutputStream(), problem);
```

Catatan desain:

- jangan expose stack trace ke client,
- jangan expose SQL/internal class name,
- sertakan correlation/request id,
- log detail internal di server,
- body client harus stabil dan aman.

### 11.4 Error Setelah Partial Body

Salah satu failure tersulit:

```java
response.setContentType("application/json;charset=UTF-8");
PrintWriter writer = response.getWriter();
writer.write("{\"items\":[");
writer.flush(); // committed

// error terjadi di tengah streaming
throw new RuntimeException("DB failed");
```

Client menerima JSON rusak. Server tidak bisa mengubah status menjadi 500 karena response sudah committed.

Solusi tergantung kebutuhan:

1. Jangan streaming jika atomic JSON diperlukan.
2. Buffer dulu seluruh data, baru tulis ketika sukses.
3. Gunakan NDJSON/event stream agar setiap record berdiri sendiri.
4. Sertakan event error dalam stream protocol.
5. Untuk file besar, terima bahwa partial transfer adalah failure transport-level.

---

## 12. Cookie pada Response

Cookie dikirim lewat header `Set-Cookie`.

```java
Cookie cookie = new Cookie("theme", "dark");
cookie.setPath(request.getContextPath().isEmpty() ? "/" : request.getContextPath());
cookie.setHttpOnly(true);
cookie.setSecure(true);
response.addCookie(cookie);
```

### 12.1 Deleting Cookie

Menghapus cookie berarti mengirim cookie dengan nama, path, domain yang sama dan umur nol:

```java
Cookie cookie = new Cookie("theme", "");
cookie.setPath(request.getContextPath().isEmpty() ? "/" : request.getContextPath());
cookie.setMaxAge(0);
cookie.setHttpOnly(true);
cookie.setSecure(true);
response.addCookie(cookie);
```

Bug umum: cookie tidak terhapus karena path/domain tidak sama dengan cookie original.

### 12.2 Session Cookie

Untuk session, container biasanya mengelola `JSESSIONID`. Jangan sembarangan menulis `Set-Cookie: JSESSIONID=...` manual kecuali benar-benar memahami session manager container.

---

## 13. Cache Headers

Cache behavior sangat dipengaruhi response header.

### 13.1 Jangan Cache Sensitive Response

Untuk halaman/data sensitif:

```java
response.setHeader("Cache-Control", "no-store");
response.setHeader("Pragma", "no-cache");       // legacy HTTP/1.0 compatibility
response.setDateHeader("Expires", 0);
```

`no-store` berarti browser/proxy tidak boleh menyimpan response.

### 13.2 Static Resource Cache

Untuk asset versioned:

```java
response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
```

Ini aman jika filename mengandung hash/version:

```text
/app.8f3a91.js
/main.12ab90.css
```

Tidak aman jika file bisa berubah tanpa URL berubah.

### 13.3 Conditional Request

Header relevan:

```text
ETag
Last-Modified
If-None-Match
If-Modified-Since
```

Jika resource belum berubah:

```java
response.setStatus(HttpServletResponse.SC_NOT_MODIFIED); // 304
```

Response `304` tidak membawa body normal. Ini menghemat bandwidth.

---

## 14. File Download Response

Contoh download aman:

```java
protected void doGet(HttpServletRequest request, HttpServletResponse response)
        throws IOException {

    Path file = Path.of("/safe/storage/report-123.pdf");
    long size = Files.size(file);

    response.setStatus(HttpServletResponse.SC_OK);
    response.setContentType("application/pdf");
    response.setContentLengthLong(size);
    response.setHeader("Content-Disposition", "attachment; filename=\"report-123.pdf\"");
    response.setHeader("Cache-Control", "no-store");

    try (InputStream in = Files.newInputStream(file)) {
        ServletOutputStream out = response.getOutputStream();
        byte[] buffer = new byte[8192];
        int read;
        while ((read = in.read(buffer)) != -1) {
            out.write(buffer, 0, read);
        }
    }
}
```

### 14.1 Filename Encoding Problem

Filename dengan spasi/non-ASCII perlu hati-hati. Header modern bisa memakai `filename*`:

```text
Content-Disposition: attachment; filename="report.pdf"; filename*=UTF-8''report%20final.pdf
```

Jangan memasukkan filename user langsung ke header tanpa sanitasi.

Problem:

```java
response.setHeader("Content-Disposition", "attachment; filename=\"" + userFilename + "\"");
```

Jika `userFilename` mengandung quote, CRLF, slash, atau karakter aneh, bisa muncul header injection atau behavior browser tidak konsisten.

### 14.2 Download Besar

Untuk file besar:

- jangan baca seluruh file ke memory,
- gunakan stream buffer,
- set content length jika diketahui,
- handle client abort sebagai kejadian normal,
- perhatikan proxy timeout,
- perhatikan download speed lambat,
- jangan menahan DB transaction selama streaming file.

Anti-pattern:

```java
byte[] all = Files.readAllBytes(file); // buruk untuk file besar
response.getOutputStream().write(all);
```

---

## 15. JSON Response: Manual Servlet vs Framework

Servlet manual:

```java
response.setStatus(200);
response.setContentType("application/json;charset=UTF-8");
objectMapper.writeValue(response.getOutputStream(), dto);
```

Dengan framework seperti Spring MVC/JAX-RS, response sering dibentuk oleh framework:

```java
return ResponseEntity.ok(dto);
```

atau:

```java
return Response.ok(dto).build();
```

Tetapi di bawahnya tetap memakai servlet response di runtime servlet-based.

Mental model penting:

> Framework mengabstraksi response, tetapi tidak menghapus aturan commit, header, buffer, status, stream, dan client abort.

Jika framework menulis body lewat message converter, lalu filter mencoba menambah header setelah chain selesai, header itu mungkin terlambat bila response sudah committed.

---

## 16. Response Wrapper Pattern

`HttpServletResponseWrapper` memungkinkan filter/framework membungkus response untuk:

- mencatat status code,
- menambah header,
- mengganti output stream,
- menghitung response size,
- melakukan compression,
- caching body,
- audit response,
- sanitasi header,
- observability.

### 16.1 Capture Status Code

Masalah: filter logging ingin tahu status response setelah chain selesai.

```java
public final class StatusCaptureResponse extends HttpServletResponseWrapper {
    private int status = SC_OK;

    public StatusCaptureResponse(HttpServletResponse response) {
        super(response);
    }

    @Override
    public void setStatus(int sc) {
        this.status = sc;
        super.setStatus(sc);
    }

    @Override
    public void sendError(int sc) throws IOException {
        this.status = sc;
        super.sendError(sc);
    }

    @Override
    public void sendError(int sc, String msg) throws IOException {
        this.status = sc;
        super.sendError(sc, msg);
    }

    @Override
    public void sendRedirect(String location) throws IOException {
        this.status = SC_FOUND;
        super.sendRedirect(location);
    }

    public int getCapturedStatus() {
        return status;
    }
}
```

Filter:

```java
public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
        throws IOException, ServletException {

    HttpServletResponse httpRes = (HttpServletResponse) res;
    StatusCaptureResponse wrapped = new StatusCaptureResponse(httpRes);

    long start = System.nanoTime();
    try {
        chain.doFilter(req, wrapped);
    } finally {
        long durationMs = (System.nanoTime() - start) / 1_000_000;
        log.info("status={} durationMs={}", wrapped.getCapturedStatus(), durationMs);
    }
}
```

Caveat:

- Servlet 6.1 menambah overload redirect yang lebih kaya di beberapa API implementation; wrapper production perlu override method relevan sesuai versi.
- Framework bisa melakukan async processing; logging setelah `chain.doFilter` belum tentu berarti response selesai jika async started.

### 16.2 Body Caching Wrapper

Body capture terlihat menarik, tetapi berbahaya untuk response besar.

Anti-pattern:

```text
Capture all response body into ByteArrayOutputStream for every request
```

Risiko:

- memory spike,
- latency naik,
- streaming rusak,
- file download besar masuk heap,
- SSE/WebSocket-like stream tidak selesai,
- response tidak terkirim jika lupa copy body ke original response.

Gunakan body capture hanya untuk endpoint kecil dan dengan limit eksplisit.

---

## 17. Compression dan Response

Compression biasanya dilakukan oleh container, reverse proxy, atau filter.

Header terkait:

```text
Accept-Encoding: gzip, br
Content-Encoding: gzip
Vary: Accept-Encoding
```

Aplikasi biasanya tidak perlu meng-gzip manual.

### 17.1 Mengapa Manual Compression Rawan

Jika aplikasi gzip manual:

- harus set `Content-Encoding`,
- content length berubah,
- error handling lebih sulit,
- double compression bisa terjadi,
- range request dapat terganggu,
- proxy juga mungkin compress.

Lebih baik konfigurasi di container/proxy:

```text
Client Accept-Encoding
  ↓
Proxy/container decides compression
  ↓
Application writes normal body
```

### 17.2 Jangan Compress Semua

Tidak semua response cocok dikompresi:

- JPEG/PNG/PDF/video sudah compressed,
- response sangat kecil overhead-nya tidak sepadan,
- response sensitif tertentu perlu mempertimbangkan side-channel attack jika ada secret reflektif,
- CPU overhead dapat signifikan saat high traffic.

---

## 18. Trailer Fields

HTTP trailer adalah header yang dikirim setelah body, biasanya untuk chunked response atau HTTP/2 trailer use cases.

Servlet API modern menyediakan mekanisme trailer fields.

Use case teoretis:

- checksum setelah streaming selesai,
- signature setelah body dihitung,
- metadata final setelah stream.

Namun dalam praktik web app biasa, trailer jarang dipakai karena:

- client/browser support tidak selalu convenient,
- proxy dapat menghapus/tidak meneruskan trailer,
- framework jarang mengeksposnya high-level,
- observability dan debugging lebih sulit.

Rule praktis:

> Jangan pakai trailer sebagai mekanisme inti business protocol kecuali seluruh chain client-proxy-server benar-benar mendukungnya.

---

## 19. Interaction dengan Filter Chain

Response dapat dimodifikasi oleh banyak pihak:

```text
Client
  ↓
Filter A: correlation id header
  ↓
Filter B: security header
  ↓
Filter C: compression wrapper
  ↓
Servlet / Framework controller
  ↓
Filter C after-chain
  ↓
Filter B after-chain
  ↓
Filter A after-chain logging
  ↓
Client
```

### 19.1 After-Chain Header Mutation

```java
chain.doFilter(request, response);
response.setHeader("X-Foo", "bar"); // bisa terlambat
```

Jika servlet/controller sudah commit response, header tidak terkirim.

Lebih aman untuk mandatory header:

```java
response.setHeader("X-Frame-Options", "DENY");
chain.doFilter(request, response);
```

Tetapi untuk header yang bergantung hasil response, butuh wrapper atau framework hook.

### 19.2 Filter Menulis Response Sendiri

Filter boleh menghentikan chain:

```java
if (!allowed) {
    response.setStatus(HttpServletResponse.SC_FORBIDDEN);
    response.setContentType("application/json;charset=UTF-8");
    response.getWriter().write("{\"error\":\"forbidden\"}");
    return;
}

chain.doFilter(request, response);
```

Failure umum:

```java
response.setStatus(403);
response.getWriter().write("Forbidden");
chain.doFilter(request, response); // salah: chain tetap jalan
```

Atau:

```java
chain.doFilter(request, response);
response.getWriter().write("tail"); // bisa merusak JSON/file/download
```

---

## 20. Response dan Async Servlet

Dalam async servlet, response lifecycle lebih panjang dari thread awal.

```java
AsyncContext async = request.startAsync();
executor.submit(() -> {
    try {
        HttpServletResponse response = (HttpServletResponse) async.getResponse();
        response.setContentType("text/plain;charset=UTF-8");
        response.getWriter().write("done");
    } catch (IOException e) {
        // log
    } finally {
        async.complete();
    }
});
```

Caveat:

- jangan tulis response setelah `async.complete()`,
- handle timeout,
- handle race antara timeout dan worker completion,
- response object masih milik container,
- request/response tidak boleh dipakai sembarangan setelah lifecycle selesai,
- filter after-chain perlu sadar async.

Async failure race:

```text
T0 request start async
T1 async timeout fires, container commits 503/error
T2 worker completes and tries writing 200 body
T3 IllegalStateException / ignored write / broken response
```

Solusi:

- gunakan atomic completion guard,
- cancel worker jika timeout,
- cek `response.isCommitted()` sebagai guard tambahan,
- desain timeout response di satu tempat.

---

## 21. Response dan Virtual Threads

Java 21 membawa virtual threads sebagai fitur final. Untuk servlet runtime modern, virtual threads dapat memengaruhi cara request blocking ditangani.

Namun aturan response tidak berubah:

- status/header tetap harus sebelum commit,
- writer/output stream tetap mutually exclusive,
- client abort tetap mungkin,
- DB/downstream capacity tetap limit,
- buffering tetap menggunakan memory,
- response object tetap tidak otomatis thread-safe untuk multi-writer.

Virtual threads membantu ketika banyak request blocking menunggu I/O, tetapi bukan lisensi untuk menulis response dari banyak thread sekaligus.

Anti-pattern:

```java
var executor = Executors.newVirtualThreadPerTaskExecutor();
for (Item item : items) {
    executor.submit(() -> response.getWriter().write(render(item))); // buruk
}
```

Masalah:

- writer tidak dirancang untuk concurrent unsynchronized multi-writer,
- output ordering rusak,
- error handling kacau,
- commit race,
- response corruption.

Pola lebih aman:

```java
List<String> rendered = items.parallelStream()
        .map(this::renderSafely)
        .toList();

response.setContentType("text/plain;charset=UTF-8");
PrintWriter writer = response.getWriter();
for (String line : rendered) {
    writer.write(line);
}
```

Atau gunakan satu writer loop dengan queue/backpressure jika streaming.

---

## 22. Client Abort, Broken Pipe, Connection Reset

Client bisa menutup koneksi sebelum server selesai menulis.

Contoh:

- user menutup tab,
- browser cancel download,
- mobile network drop,
- proxy timeout,
- load balancer reset,
- client navigasi ke halaman lain,
- SPA abort fetch request.

Server mungkin melihat:

```text
java.io.IOException: Broken pipe
java.io.IOException: Connection reset by peer
ClientAbortException: java.io.IOException
```

Ini tidak selalu bug aplikasi. Dalam banyak sistem, client abort adalah noise operasional yang harus diklasifikasikan berbeda dari server failure.

### 22.1 Logging Client Abort

Jangan selalu log sebagai ERROR penuh stack trace untuk endpoint download/streaming high volume.

Pola:

```java
try {
    streamResponse(response);
} catch (IOException e) {
    if (isClientAbort(e)) {
        log.info("client aborted response requestId={}", requestId);
    } else {
        throw e;
    }
}
```

`isClientAbort` sangat container-specific. Tomcat, Jetty, Undertow dapat punya exception class/message berbeda.

### 22.2 Observability

Metric yang berguna:

- total client abort,
- client abort by endpoint,
- abort during download,
- abort after N bytes,
- abort after duration,
- proxy 499-like status bila tersedia,
- mismatch app status vs proxy status.

---

## 23. Reverse Proxy dan Response

Aplikasi jarang bicara langsung ke browser. Biasanya ada:

```text
Browser
  ↓
CDN / WAF
  ↓
Load Balancer
  ↓
Ingress / Reverse Proxy
  ↓
Servlet Container
```

Response bisa dimodifikasi tiap layer.

### 23.1 Header dari App Bisa Diubah Proxy

Proxy dapat:

- menambah security header,
- menghapus header internal,
- mengubah compression,
- mengubah status pada timeout,
- mengganti error page,
- buffer response,
- chunk/dechunk body,
- enforce body size,
- close connection.

Artinya access log aplikasi dan access log proxy bisa berbeda.

Contoh:

```text
App logs: 200 after 65 seconds
Proxy timeout: 504 after 60 seconds
Client sees: 504
```

Aplikasi merasa sukses, client melihat gagal.

### 23.2 Proxy Buffering

Proxy seperti Nginx dapat membuffer response upstream sebelum mengirim ke client.

Dampak:

- aplikasi flush tetapi client belum menerima,
- SSE/streaming tidak jalan realtime,
- memory/disk proxy terpakai,
- latency berubah,
- error behavior berbeda.

Untuk streaming/SSE, proxy buffering sering perlu dimatikan di route tertentu.

### 23.3 Timeout Alignment

Timeout harus sejajar:

```text
Application async timeout <= proxy upstream timeout <= LB idle timeout? tergantung desain
```

Yang penting: jangan biarkan layer luar timeout lebih dulu tanpa aplikasi sadar.

Contoh buruk:

```text
App request processing timeout: 120s
Nginx proxy_read_timeout: 60s
ALB idle timeout: 60s
```

Client akan dapat 504/connection close pada 60s, sementara app masih bekerja sampai 120s.

---

## 24. Security Headers dari Response Layer

Walau detail security sudah seri lain, response layer adalah tempat banyak security header dikirim.

Contoh:

```java
response.setHeader("X-Content-Type-Options", "nosniff");
response.setHeader("X-Frame-Options", "DENY");
response.setHeader("Referrer-Policy", "no-referrer");
response.setHeader("Content-Security-Policy", "default-src 'self'");
```

Caveat:

- CSP harus disesuaikan dengan front-end asset dan integration.
- `X-Frame-Options` bisa bentrok dengan legitimate embedding.
- `Strict-Transport-Security` hanya aman jika HTTPS sudah benar untuk domain/subdomain.
- Header harus dikirim sebelum commit.
- Jangan mengandalkan servlet app saja jika proxy juga mengelola security header.

Pola production: security header didefinisikan di satu layer yang jelas, app atau proxy, dengan pengecualian yang terdokumentasi.

---

## 25. CORS Response Headers

CORS dikendalikan oleh response header.

Contoh preflight response:

```java
response.setStatus(HttpServletResponse.SC_NO_CONTENT);
response.setHeader("Access-Control-Allow-Origin", "https://app.example.com");
response.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
response.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
response.setHeader("Access-Control-Allow-Credentials", "true");
response.setHeader("Vary", "Origin");
```

Caveat penting:

- Jika credentials digunakan, `Access-Control-Allow-Origin: *` tidak boleh dipakai untuk credentialed browser requests.
- `Vary: Origin` penting jika response dapat berbeda per origin dan melewati cache/proxy.
- CORS error di browser sering terlihat seperti network error, padahal server sudah memberi response.
- Preflight `OPTIONS` harus ditangani sebelum auth filter tertentu bila desain mengizinkan.

---

## 26. Observability: Response Logging yang Benar

Minimal log response production:

```text
timestamp
requestId/correlationId
method
path
status
bytesWritten
contentType
durationMs
user/session/client identity if allowed
remoteIp/proxy info
exception class if any
clientAbort true/false
```

### 26.1 Access Log vs Application Log

Access log container/proxy biasanya lebih akurat untuk final wire-level response.

Application log lebih kaya business context.

Keduanya perlu dikorelasikan dengan request id.

### 26.2 Status Code Capture Problem

Filter logging naive:

```java
chain.doFilter(request, response);
log.info("status=200"); // salah
```

Lebih baik pakai wrapper untuk capture status.

### 26.3 Bytes Written

Mengukur bytes written dari aplikasi tidak selalu sama dengan bytes di network karena:

- compression,
- chunk framing,
- TLS overhead,
- proxy buffering,
- error page substitution,
- client abort.

Tetap berguna untuk mendeteksi response besar.

---

## 27. Common Production Bugs dan Cara Membacanya

### 27.1 `Cannot call sendError() after the response has been committed`

Makna:

```text
Aplikasi/framework mencoba mengubah response menjadi error setelah header/body sudah dikirim.
```

Akar penyebab umum:

- flush terlalu awal,
- streaming lalu exception,
- filter menulis response sebelum chain selesai,
- JSP sudah menulis output lalu error,
- buffer terlalu kecil,
- framework exception handler terlambat.

Solusi:

- jangan flush sebelum yakin,
- tulis header/status sebelum body,
- gunakan buffering untuk atomic response kecil,
- desain stream protocol yang punya event error,
- hindari menulis output di filter sebelum validasi lengkap.

### 27.2 `getWriter() has already been called for this response`

Makna:

```text
Satu komponen sudah memilih text channel, komponen lain mencoba binary channel.
```

Akar:

- filter logging body memakai writer,
- servlet download memakai output stream,
- error handler mencoba writer setelah binary response,
- JSP/include bercampur binary.

Solusi:

- tentukan ownership body,
- wrapper harus implement writer/output stream dengan benar,
- jangan logging body untuk download,
- pisahkan endpoint binary dan text.

### 27.3 Browser Download File Corrupt

Akar:

- pakai `Writer` untuk binary,
- content length salah,
- extra bytes dari JSP/template/filter,
- response dikompresi tidak sesuai,
- exception HTML error page tercampur ke file,
- encoding transform terjadi.

Solusi:

- gunakan `OutputStream`,
- jangan ada output lain,
- set content type/disposition sebelum body,
- hindari filter yang memodifikasi binary response,
- log status sebelum streaming.

### 27.4 Client Melihat 504, App Log 200

Akar:

```text
Proxy/LB timeout lebih dulu, app tetap menyelesaikan request dan mencatat 200.
```

Solusi:

- align timeout,
- app-level timeout lebih pendek dari proxy,
- cancellable downstream work,
- async job + polling untuk long operation,
- monitor proxy access log.

### 27.5 Header Tidak Muncul di Browser

Akar:

- ditulis setelah commit,
- proxy menghapus/mengganti,
- CORS tidak expose header ke browser JS,
- header name/value invalid,
- response berasal dari error page container, bukan servlet normal.

Solusi:

- set sebelum body,
- cek network tab raw response,
- cek proxy config,
- cek error dispatch,
- tambahkan `Access-Control-Expose-Headers` bila perlu untuk JS.

---

## 28. Design Pattern: Response Ownership

Dalam aplikasi kompleks, masalah sering muncul karena tidak jelas siapa pemilik response.

Pertanyaan arsitektural:

1. Siapa yang menentukan status code?
2. Siapa yang menentukan content type?
3. Siapa yang menulis body?
4. Siapa yang boleh redirect?
5. Siapa yang menangani exception?
6. Siapa yang menambah security/cache/CORS header?
7. Siapa yang mencatat final status?
8. Siapa yang boleh flush?
9. Siapa yang boleh close stream?
10. Siapa yang bertanggung jawab saat response sudah committed?

### 28.1 Single Owner Principle

Untuk satu request, idealnya body response hanya ditulis oleh satu owner:

```text
Controller/Servlet OR ErrorHandler OR FilterShortCircuit OR StaticResourceHandler
```

Bukan semuanya sekaligus.

### 28.2 Layer Responsibility

Contoh pembagian sehat:

| Layer | Boleh |
|---|---|
| Correlation filter | Tambah request id header, MDC. |
| Security/CORS filter | Short-circuit unauthorized/preflight, set related header. |
| Controller/servlet | Tentukan business status/body normal. |
| Exception mapper/error handler | Tentukan error status/body. |
| Compression/proxy | Optimasi transport. |
| Access log | Observasi final result. |

---

## 29. Checklist Menulis Response yang Aman

Sebelum menulis body:

- [ ] Status code sudah benar.
- [ ] Content type sudah benar.
- [ ] Charset sudah eksplisit untuk text.
- [ ] Cache header sudah sesuai sensitivitas data.
- [ ] Security header/CORS header sudah ditentukan layer-nya.
- [ ] Cookie path/domain/secure/httpOnly/sameSite sudah benar bila ada cookie.
- [ ] Tidak mencampur writer dan output stream.
- [ ] Tidak flush terlalu awal kecuali streaming.
- [ ] Content length benar bila diset.
- [ ] Response besar tidak dibuffer penuh di heap.
- [ ] Client abort diperlakukan sebagai kemungkinan normal.
- [ ] Error setelah commit sudah dipikirkan.
- [ ] Proxy timeout dan buffering sesuai jenis response.

---

## 30. Mini State Machine Response

Untuk membantu reasoning, modelkan response seperti ini:

```text
State: OpenMutable
  allowed:
    setStatus
    setHeader/addHeader
    addCookie
    setContentType
    setCharacterEncoding
    setBufferSize
    write body into buffer
    reset/resetBuffer
    sendError
    sendRedirect

Transition to Committed when:
    flush
    buffer full
    sendError
    sendRedirect
    container commits at end
    async complete

State: Committed
  allowed:
    continue body write if connection alive
    flush body
  not reliably allowed:
    change status
    change header
    redirect
    sendError
    reset

State: Completed/Closed
  allowed:
    nothing useful from app perspective
```

Inilah kenapa response bug sering bersifat temporal: operasi yang benar pada waktu T1 menjadi salah pada T2 karena response sudah committed.

---

## 31. Advanced Exercise: Build a Response Discipline Filter

Tujuan: membangun filter yang:

- menambahkan correlation header,
- menangkap final status,
- mengukur durasi,
- tidak merusak body,
- tidak menulis header setelah commit,
- sadar client abort.

Skeleton:

```java
public final class ResponseDisciplineFilter implements Filter {

    @Override
    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
            throws IOException, ServletException {

        HttpServletRequest request = (HttpServletRequest) req;
        HttpServletResponse response = (HttpServletResponse) res;

        String requestId = resolveOrGenerateRequestId(request);
        response.setHeader("X-Request-Id", requestId);

        StatusCaptureResponse wrapped = new StatusCaptureResponse(response);
        long start = System.nanoTime();
        boolean clientAbort = false;
        Throwable failure = null;

        try {
            chain.doFilter(request, wrapped);
        } catch (IOException e) {
            if (isClientAbort(e)) {
                clientAbort = true;
            }
            failure = e;
            throw e;
        } catch (ServletException | RuntimeException e) {
            failure = e;
            throw e;
        } finally {
            long durationMs = (System.nanoTime() - start) / 1_000_000;
            logResult(request, wrapped, requestId, durationMs, clientAbort, failure);
        }
    }

    private String resolveOrGenerateRequestId(HttpServletRequest request) {
        String incoming = request.getHeader("X-Request-Id");
        if (incoming != null && !incoming.isBlank()) {
            return incoming;
        }
        return UUID.randomUUID().toString();
    }

    private boolean isClientAbort(IOException e) {
        String name = e.getClass().getName();
        String message = String.valueOf(e.getMessage()).toLowerCase(Locale.ROOT);
        return name.contains("ClientAbort")
                || message.contains("broken pipe")
                || message.contains("connection reset");
    }

    private void logResult(
            HttpServletRequest request,
            StatusCaptureResponse response,
            String requestId,
            long durationMs,
            boolean clientAbort,
            Throwable failure) {

        // Use structured logging in real systems.
        System.out.printf(
                "requestId=%s method=%s uri=%s status=%d durationMs=%d clientAbort=%s failure=%s%n",
                requestId,
                request.getMethod(),
                request.getRequestURI(),
                response.getCapturedStatus(),
                durationMs,
                clientAbort,
                failure == null ? "-" : failure.getClass().getName()
        );
    }
}
```

Limitasi exercise:

- belum async-aware,
- belum capture bytes written,
- belum handle Servlet 6.1 redirect overload lengkap,
- belum integrate MDC,
- belum distinguish proxy timeout,
- belum production-grade JSON escaping.

Tugas lanjut:

1. Tambahkan async listener jika `request.isAsyncStarted()`.
2. Capture bytes written dengan wrapping output stream/writer.
3. Jangan capture body.
4. Tambahkan allowlist endpoint yang boleh streaming.
5. Tambahkan metric per status family: 2xx/3xx/4xx/5xx.

---

## 32. Ringkasan Mental Model

`HttpServletResponse` adalah contract object yang dipakai aplikasi untuk membentuk HTTP response. Tetapi response bukan sekadar `write()`.

Yang harus selalu diingat:

1. Response terdiri dari status, header, body.
2. Status/header harus diputuskan sebelum commit.
3. Body bisa text atau binary, tetapi jangan campur `Writer` dan `OutputStream`.
4. Buffer memberi ruang untuk mengubah response sebelum dikirim.
5. Flush dini berarti commit dini.
6. `setStatus` memberi kontrol manual; `sendError` melibatkan error handling container.
7. Redirect adalah response ke client, bukan dispatch internal.
8. Streaming mengorbankan atomic error response.
9. Client abort adalah failure transport yang normal di banyak sistem.
10. Proxy dapat mengubah apa yang akhirnya dilihat client.
11. Filter/framework harus jelas ownership-nya terhadap response.
12. Observability response butuh wrapper atau access log, bukan asumsi.

Kalimat kunci:

> Engineer yang kuat tidak hanya tahu cara menulis response. Ia tahu kapan response masih bisa diubah, siapa yang sudah menyentuhnya, layer mana yang bisa menggantinya, dan failure apa yang mungkin terjadi setelah byte pertama keluar.

---

## 33. Apa yang Tidak Dibahas Detail di Part Ini

Agar tidak mengulang seri lain, part ini tidak mendalami:

- desain REST response JAX-RS,
- Spring MVC response abstraction,
- cryptographic security header secara mendalam,
- authentication/authorization,
- JSON serialization performance,
- browser cache internals mendalam,
- load balancer configuration detail,
- non-blocking output detail.

Topik yang akan muncul lagi:

- non-blocking output di Part 015,
- file upload/download besar di Part 016,
- error handling menyeluruh di Part 017,
- thread/virtual thread di Part 018,
- proxy/cloud runtime di Part 029,
- observability di Part 030.

---

## 34. Referensi

- Jakarta Servlet 6.1 Specification.
- Jakarta Servlet 6.1 API: `ServletResponse`.
- Jakarta Servlet 6.1 API: `HttpServletResponse`.
- Jakarta Servlet 6.1 API: `HttpServletResponseWrapper`.
- RFC 9110: HTTP Semantics.
- RFC 9112: HTTP/1.1.
- RFC 9113: HTTP/2.
- RFC 6266: Content-Disposition in HTTP.
- RFC 9457: Problem Details for HTTP APIs.
- Apache Tomcat Servlet 6.1 API documentation.

---

## 35. Status Seri

Part ini adalah **Part 006 dari 031**.

Seri **belum selesai**.

Part berikutnya:

```text
learn-java-servlet-websocket-web-container-runtime-part-007.md
```

Topik berikutnya:

```text
Servlet Mapping, URL Pattern, and Dispatch Resolution
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-servlet-websocket-web-container-runtime-part-005](./learn-java-servlet-websocket-web-container-runtime-part-005.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-servlet-websocket-web-container-runtime-part-007](./learn-java-servlet-websocket-web-container-runtime-part-007.md)

</div>