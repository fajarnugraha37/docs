# learn-http-for-web-frontend-perspective-part-011

# CORS Part 2: Preflight, Credentials, Cookies, and Real Production Bugs

> Seri: `learn-http-for-web-frontend-perspective`  
> Part: `011`  
> Target pembaca: Java software engineer yang ingin memahami HTTP dari perspektif browser/frontend secara dalam, praktis, dan defensible.

---

## 0. Posisi Bagian Ini dalam Seri

Pada Part 010 kita membangun fondasi:

- Same-Origin Policy adalah default protection browser.
- CORS adalah mekanisme opt-in dari server agar browser boleh membaca response cross-origin.
- CORS bukan autentikasi.
- CORS bukan firewall.
- CORS tidak melindungi server dari non-browser client.
- CORS terutama membatasi **apa yang boleh dibaca oleh JavaScript di browser**.

Bagian ini masuk ke area yang paling sering menyebabkan bug produksi:

- kenapa request tiba-tiba melakukan `OPTIONS`;
- kenapa preflight gagal padahal endpoint utama benar;
- kenapa cookie tidak terkirim;
- kenapa cookie sudah terlihat di response tapi tidak tersimpan;
- kenapa header terlihat di DevTools tapi tidak bisa dibaca JavaScript;
- kenapa `Access-Control-Allow-Origin: *` tidak bisa dipakai bersama credential;
- kenapa CORS yang bekerja di local rusak di staging/production;
- kenapa CDN/proxy bisa membuat konfigurasi CORS menjadi bug security.

Tujuan bagian ini bukan hanya “bisa memperbaiki error CORS”, tetapi bisa membedakan:

```text
Apakah masalahnya ada di browser policy?
Apakah request sebenarnya tidak pernah dikirim?
Apakah preflight-nya gagal?
Apakah actual request-nya gagal?
Apakah response diterima tapi tidak diekspos ke JS?
Apakah cookie tidak dikirim?
Apakah cookie tidak disimpan?
Apakah CDN/proxy mengubah header?
Apakah server auth memblokir OPTIONS?
```

Engineer yang kuat tidak mengatakan “CORS error” sebagai diagnosis final. Ia membedah fase CORS-nya.

---

## 1. Mental Model Inti: CORS Adalah Multi-Phase Browser Protocol

Kesalahan umum adalah menganggap CORS sebagai satu header tunggal.

Padahal dari sudut browser, CORS adalah rangkaian keputusan:

```text
JavaScript membuat request
        |
        v
Browser melihat target URL
        |
        v
Apakah cross-origin?
        |
        +-- tidak --> same-origin path, CORS tidak relevan
        |
        +-- ya --> CORS path
                    |
                    v
              Apakah request simple?
                    |
          +---------+----------+
          |                    |
        ya                 tidak
          |                    |
          v                    v
Actual request        Preflight OPTIONS request
          |                    |
          v                    v
Server response       Server preflight response
          |                    |
          v                    v
Browser cek ACAO      Browser cek allow method/header/origin
          |                    |
          v                    v
JS boleh baca?        Jika lolos, kirim actual request
```

CORS bukan hanya terjadi di server. Server hanya memberikan sinyal lewat header. Browser yang mengambil keputusan akhir.

### 1.1 Komponen keputusan CORS

Browser mempertimbangkan beberapa hal:

1. Origin pemanggil.
2. Origin target.
3. Method request.
4. Header yang dikirim.
5. Content-Type.
6. Credentials mode.
7. Response CORS headers.
8. Redirect behavior.
9. Cache preflight.
10. Policy browser lain seperti cookie SameSite, mixed content, CSP, CORP/COEP pada kasus tertentu.

Itulah kenapa “sudah tambah `Access-Control-Allow-Origin`” belum tentu cukup.

---

## 2. Istilah Penting

Sebelum masuk kasus, kita perlu vocabulary yang presisi.

## 2.1 Origin

Origin adalah kombinasi:

```text
scheme + host + port
```

Contoh:

```text
https://app.example.com
https://api.example.com
```

Berbeda origin karena host berbeda.

```text
http://localhost:3000
http://localhost:8080
```

Berbeda origin karena port berbeda.

```text
http://app.example.com
https://app.example.com
```

Berbeda origin karena scheme berbeda.

---

## 2.2 Cross-Origin Request

Request cross-origin terjadi ketika origin dokumen/skrip berbeda dari origin target request.

Contoh:

```text
Frontend page:
https://app.example.com

API target:
https://api.example.com/users/me
```

Ini cross-origin walaupun masih satu organisasi dan satu domain induk `example.com`.

---

## 2.3 Simple Request

Dalam konteks CORS, sebagian request dianggap “simple” sehingga tidak perlu preflight.

Secara praktis, request simple biasanya memiliki karakteristik:

- method: `GET`, `HEAD`, atau `POST`;
- hanya menggunakan CORS-safelisted request headers;
- jika ada `Content-Type`, nilainya terbatas pada tipe tertentu seperti:
  - `application/x-www-form-urlencoded`
  - `multipart/form-data`
  - `text/plain`

Request yang simple tetap butuh response CORS header agar JavaScript boleh membaca response. Bedanya: tidak ada preflight `OPTIONS` sebelum actual request.

---

## 2.4 Non-Simple Request

Request non-simple memicu preflight.

Contoh pemicu umum:

- method `PUT`, `PATCH`, `DELETE`;
- header custom seperti `X-Request-ID`, `X-Tenant-ID`, `X-CSRF-Token`;
- header `Authorization`;
- `Content-Type: application/json` pada request tertentu;
- upload dengan header tertentu;
- kombinasi header yang tidak masuk safelist.

Inilah alasan banyak request API modern hampir selalu preflight, terutama SPA yang memakai JSON dan bearer token.

---

## 2.5 Preflight Request

Preflight adalah request `OPTIONS` yang dikirim browser sebelum actual request untuk bertanya:

```text
“Server, apakah origin ini boleh mengirim method dan headers seperti ini ke resource target?”
```

Contoh preflight:

```http
OPTIONS /orders/123 HTTP/1.1
Host: api.example.com
Origin: https://app.example.com
Access-Control-Request-Method: PATCH
Access-Control-Request-Headers: authorization, content-type, x-request-id
```

Server harus menjawab dengan header yang sesuai:

```http
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS
Access-Control-Allow-Headers: authorization, content-type, x-request-id
Access-Control-Max-Age: 600
Vary: Origin, Access-Control-Request-Method, Access-Control-Request-Headers
```

Jika preflight gagal, actual request tidak dikirim.

Ini sangat penting.

Kalau Anda melihat backend business endpoint tidak menerima request, bisa jadi bukan karena frontend tidak memanggil, tapi karena browser berhenti di preflight.

---

## 2.6 Actual Request

Actual request adalah request asli yang ingin dibuat JavaScript.

Contoh:

```http
PATCH /orders/123 HTTP/1.1
Host: api.example.com
Origin: https://app.example.com
Authorization: Bearer eyJ...
Content-Type: application/json
X-Request-ID: 8c1f...

{"status":"APPROVED"}
```

Response actual request juga harus memiliki CORS header yang benar:

```http
HTTP/1.1 200 OK
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Credentials: true
Content-Type: application/json

{"id":"123","status":"APPROVED"}
```

Lolos preflight belum otomatis berarti actual response boleh dibaca. Browser tetap mengecek CORS header pada actual response.

---

## 3. Preflight secara Detail

## 3.1 Kapan Browser Melakukan Preflight?

Browser melakukan preflight ketika request cross-origin tidak memenuhi kriteria simple request.

Contoh yang memicu preflight:

```js
fetch("https://api.example.com/orders/123", {
  method: "PATCH",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify({ status: "APPROVED" })
});
```

`PATCH` bukan simple method, jadi preflight.

Contoh lain:

```js
fetch("https://api.example.com/users/me", {
  headers: {
    Authorization: `Bearer ${token}`
  }
});
```

`Authorization` bukan CORS-safelisted request header, jadi preflight.

Contoh lain:

```js
fetch("https://api.example.com/search", {
  method: "POST",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify({ q: "audit" })
});
```

Walaupun `POST` dapat menjadi simple method, `Content-Type: application/json` tidak termasuk safelisted content type, sehingga dapat memicu preflight.

---

## 3.2 Preflight Bukan Bug

Banyak tim mencoba “menghilangkan preflight” karena dianggap overhead.

Cara berpikir yang lebih tepat:

```text
Preflight adalah biaya policy negotiation.
```

Preflight bisa menjadi masalah performa jika:

- request sangat banyak;
- endpoint chatty;
- `Access-Control-Max-Age` tidak diset atau terlalu kecil;
- CDN/proxy tidak meng-cache sesuai kebutuhan;
- banyak custom header tidak perlu;
- frontend mengirim header berbeda-beda sehingga preflight cache tidak efektif.

Tetapi preflight sendiri adalah bagian normal dari browser security model.

Targetnya bukan “hapus semua preflight”, melainkan:

1. pahami kenapa terjadi;
2. minimalkan yang tidak perlu;
3. cache preflight dengan benar;
4. pastikan server/proxy menjawab cepat dan konsisten;
5. jangan mengorbankan security hanya demi menghindari OPTIONS.

---

## 3.3 Header Preflight Request

Preflight request biasanya membawa header penting berikut:

```http
Origin: https://app.example.com
Access-Control-Request-Method: PATCH
Access-Control-Request-Headers: authorization, content-type, x-request-id
```

Maknanya:

| Header | Makna |
|---|---|
| `Origin` | Origin frontend yang meminta akses |
| `Access-Control-Request-Method` | Method actual request yang ingin dikirim |
| `Access-Control-Request-Headers` | Header actual request yang ingin dikirim |

Server harus mengevaluasi ini, bukan hanya selalu menjawab wildcard.

---

## 3.4 Header Preflight Response

Response preflight yang benar biasanya berisi:

```http
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS
Access-Control-Allow-Headers: authorization, content-type, x-request-id
Access-Control-Max-Age: 600
```

Maknanya:

| Header | Makna |
|---|---|
| `Access-Control-Allow-Origin` | Origin yang diizinkan |
| `Access-Control-Allow-Methods` | Method yang diizinkan untuk actual request |
| `Access-Control-Allow-Headers` | Request headers yang diizinkan |
| `Access-Control-Max-Age` | Durasi browser boleh cache hasil preflight |

Untuk dynamic origin, response juga harus memperhatikan `Vary`.

---

## 3.5 Status Code Preflight

Preflight response biasanya memakai:

```http
204 No Content
```

atau:

```http
200 OK
```

Yang penting bukan body, tetapi header CORS-nya.

Preflight tidak perlu body JSON seperti:

```json
{"success": true}
```

Bahkan response body pada preflight sering tidak berguna.

Yang dibutuhkan browser adalah policy decision lewat header.

---

## 3.6 Preflight Tidak Sama dengan Business Authorization

Preflight bertanya:

```text
Apakah browser dari origin ini boleh mengirim request dengan method/header ini?
```

Actual request bertanya:

```text
Apakah user/client ini berhak melakukan operasi bisnis ini?
```

Jangan gabungkan keduanya secara sembrono.

Preflight sebaiknya tidak bergantung pada token user kecuali Anda benar-benar memahami konsekuensinya. Banyak browser preflight tidak membawa credential/auth header actual request dengan cara yang Anda harapkan.

Jika security layer memaksa semua `OPTIONS` harus authenticated, maka CORS sering gagal sebelum actual request punya kesempatan dikirim.

---

## 4. Preflight Cache

## 4.1 Apa Itu Preflight Cache?

Browser dapat menyimpan hasil preflight untuk kombinasi tertentu.

Secara konseptual cache key-nya bergantung pada:

- origin pemanggil;
- URL atau target resource;
- method actual request;
- request headers yang diminta;
- credentials mode dan detail implementasi browser;
- policy browser.

Jika cache preflight masih valid, browser tidak perlu mengirim `OPTIONS` lagi untuk request serupa.

---

## 4.2 `Access-Control-Max-Age`

Server dapat mengirim:

```http
Access-Control-Max-Age: 600
```

Artinya browser boleh menyimpan izin preflight selama sekitar 600 detik, tergantung batas implementasi browser.

Tanpa header ini, browser bisa melakukan preflight jauh lebih sering.

---

## 4.3 Jangan Set Terlalu Besar Tanpa Governance

Nilai besar mengurangi latency, tapi ada trade-off.

Jika Anda mengubah policy CORS untuk mencabut origin/header/method tertentu, browser yang sudah cache preflight mungkin masih memakai izin lama sampai cache expired.

Praktik yang masuk akal:

```text
Development: rendah atau tidak set, agar perubahan cepat terlihat.
Production stable API: beberapa menit sampai beberapa jam, sesuai risk appetite.
High-risk admin/security endpoint: lebih konservatif.
```

---

## 4.4 Header Variability dan Preflight Explosion

Misalkan frontend kadang mengirim:

```http
X-Request-ID
```

kadang:

```http
X-Request-ID, X-Client-Version
```

kadang:

```http
X-Request-ID, X-Client-Version, X-Feature-Flag
```

Setiap kombinasi header dapat mempengaruhi preflight cache.

Jika aplikasi memiliki banyak custom headers yang tidak konsisten, preflight bisa meningkat drastis.

Prinsip:

```text
Keep request headers minimal, stable, and intentional.
```

---

## 5. Credentials dalam CORS

## 5.1 Apa Itu Credentials?

Dalam konteks browser request, credentials mencakup hal seperti:

- cookies;
- TLS client certificates;
- HTTP authentication credentials;
- beberapa bentuk credential lain yang dikelola browser.

Dalam aplikasi web modern, yang paling sering relevan adalah cookies.

---

## 5.2 Fetch Credentials Mode

`fetch()` memiliki opsi `credentials`:

```js
fetch(url, { credentials: "omit" });
fetch(url, { credentials: "same-origin" });
fetch(url, { credentials: "include" });
```

Secara praktis:

| Mode | Perilaku umum |
|---|---|
| `omit` | Jangan kirim credentials |
| `same-origin` | Kirim credentials hanya untuk same-origin |
| `include` | Sertakan credentials juga untuk cross-origin jika policy mengizinkan |

Default modern untuk `fetch()` adalah `same-origin`.

Artinya request cross-origin ke API subdomain tidak otomatis membawa cookies.

Contoh:

```js
await fetch("https://api.example.com/users/me");
```

Dari halaman:

```text
https://app.example.com
```

Cookie untuk `api.example.com` belum tentu dikirim karena fetch default tidak include credential cross-origin.

Perlu:

```js
await fetch("https://api.example.com/users/me", {
  credentials: "include"
});
```

Namun itu saja belum cukup. Server juga harus mengizinkan credentialed CORS.

---

## 5.3 `Access-Control-Allow-Credentials`

Untuk credentialed CORS response, server perlu mengirim:

```http
Access-Control-Allow-Credentials: true
```

Dan juga:

```http
Access-Control-Allow-Origin: https://app.example.com
```

Bukan:

```http
Access-Control-Allow-Origin: *
```

Wildcard origin tidak dapat digunakan untuk response credentialed yang ingin dibaca oleh browser.

---

## 5.4 Tiga Syarat Credentialed Cross-Origin Fetch

Agar cookie cross-origin dapat berjalan dalam skenario SPA + API, minimal tiga layer harus benar.

### Layer 1 — JavaScript request

```js
fetch("https://api.example.com/users/me", {
  credentials: "include"
});
```

### Layer 2 — Server CORS response

```http
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Credentials: true
```

### Layer 3 — Cookie attributes

Untuk cookie cross-site tertentu:

```http
Set-Cookie: sid=abc; Path=/; Secure; HttpOnly; SameSite=None
```

Jika salah satu layer gagal, cookie bisa tidak terkirim atau response tidak bisa dibaca.

---

## 5.5 Cross-Origin Tidak Selalu Cross-Site

Ini sangat penting.

```text
https://app.example.com
https://api.example.com
```

Keduanya cross-origin, tetapi biasanya same-site karena registrable domain-nya sama (`example.com`) dan scheme sama-sama HTTPS.

```text
https://app.example.com
https://api.other.com
```

Ini cross-origin dan cross-site.

CORS bekerja pada origin.
Cookie SameSite bekerja pada site.

Mereka berhubungan, tapi bukan konsep yang sama.

---

## 6. Cookies dan CORS: Bug Paling Umum

## 6.1 Kasus: Login Sukses tapi Cookie Tidak Disimpan

### Gejala

Frontend memanggil:

```js
await fetch("https://api.example.com/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username, password })
});
```

Server response:

```http
HTTP/1.1 200 OK
Set-Cookie: sid=abc; Path=/; HttpOnly; Secure; SameSite=None
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Credentials: true
```

Di DevTools terlihat `Set-Cookie`, tetapi request berikutnya tidak authenticated.

### Diagnosis

Kemungkinan `fetch()` login tidak memakai:

```js
credentials: "include"
```

Untuk cross-origin fetch, browser tidak otomatis menerima/mengirim credential sesuai ekspektasi aplikasi.

### Fix

```js
await fetch("https://api.example.com/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  credentials: "include",
  body: JSON.stringify({ username, password })
});
```

Dan semua request yang bergantung cookie juga harus konsisten:

```js
await fetch("https://api.example.com/users/me", {
  credentials: "include"
});
```

---

## 6.2 Kasus: Cookie Ada di Browser tapi Tidak Terkirim

### Gejala

Cookie terlihat di Application tab, tetapi tidak dikirim pada request API.

### Kemungkinan penyebab

1. Domain cookie tidak cocok.
2. Path cookie tidak cocok.
3. Cookie `Secure` dipakai di HTTP non-HTTPS.
4. SameSite memblokir cross-site context.
5. `fetch()` tidak memakai `credentials: "include"`.
6. Request target host berbeda dari cookie host.
7. Browser privacy setting atau third-party cookie blocking.
8. Cookie expired atau Max-Age negatif.
9. Localhost vs 127.0.0.1 mismatch.

### Debug checklist

Periksa request actual di DevTools:

```text
Request Headers -> Cookie
```

Jika tidak ada `Cookie`, masalahnya sebelum server business logic.

Periksa Set-Cookie warnings di DevTools. Browser modern sering memberi alasan kenapa cookie ditolak, misalnya SameSite/Secure mismatch.

---

## 6.3 Kasus: Cookie Tidak Tersimpan karena `SameSite=None` Tanpa `Secure`

Untuk cross-site cookie, biasanya perlu:

```http
SameSite=None; Secure
```

Jika server mengirim:

```http
Set-Cookie: sid=abc; SameSite=None; HttpOnly
```

Tanpa `Secure`, browser modern cenderung menolak cookie tersebut.

Fix:

```http
Set-Cookie: sid=abc; Path=/; HttpOnly; Secure; SameSite=None
```

Konsekuensi: local development dengan HTTP bisa bermasalah. Anda perlu strategi local dev:

- gunakan HTTPS lokal;
- gunakan same-origin dev proxy;
- gunakan domain lokal khusus;
- bedakan cookie policy dev vs prod secara hati-hati.

---

## 6.4 Kasus: `localhost` dan `127.0.0.1` Dianggap Berbeda

Frontend:

```text
http://localhost:3000
```

API:

```text
http://127.0.0.1:8080
```

Ini berbeda host, sehingga berbeda origin.

Cookie untuk `localhost` tidak sama dengan cookie untuk `127.0.0.1`.

Gunakan konsisten:

```text
http://localhost:3000
http://localhost:8080
```

atau:

```text
http://127.0.0.1:3000
http://127.0.0.1:8080
```

Tetapi tetap cross-origin karena port berbeda.

---

## 7. Wildcard Origin dan Credentialed Requests

## 7.1 Kenapa `*` Tidak Cukup?

Untuk public non-credentialed resource, ini bisa valid:

```http
Access-Control-Allow-Origin: *
```

Contoh:

```text
public image metadata API
public static JSON
public read-only endpoint tanpa user data
```

Namun untuk cookie/session-based request, ini bermasalah:

```http
Access-Control-Allow-Origin: *
Access-Control-Allow-Credentials: true
```

Browser tidak akan mengizinkan credentialed response dibaca JavaScript dengan wildcard origin.

Server harus mengembalikan origin spesifik:

```http
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Credentials: true
```

---

## 7.2 Dynamic Origin Reflection

Banyak backend melakukan:

```text
Access-Control-Allow-Origin: <nilai Origin request>
```

Ini disebut origin reflection.

Aman hanya jika server memvalidasi origin terhadap allowlist.

Buruk:

```java
response.setHeader("Access-Control-Allow-Origin", request.getHeader("Origin"));
response.setHeader("Access-Control-Allow-Credentials", "true");
```

Jika tidak ada allowlist, server pada dasarnya berkata:

```text
Origin mana pun boleh membaca credentialed response.
```

Ini dapat menjadi risiko serius jika endpoint bergantung pada cookie/session.

Lebih aman:

```text
if Origin in allowedOrigins:
    Access-Control-Allow-Origin = Origin
    Access-Control-Allow-Credentials = true
else:
    no CORS allow header
```

---

## 7.3 Allowlist Harus Eksplisit

Contoh allowlist:

```text
https://app.example.com
https://admin.example.com
https://staging-app.example.com
```

Hindari pola terlalu luas seperti:

```text
*.example.com
```

kecuali Anda benar-benar mengontrol semua subdomain dan memahami risiko subdomain takeover.

Jika ada subdomain yang bisa dikendalikan user atau third-party, wildcard subdomain dapat menjadi celah.

---

## 8. `Vary: Origin` dan Caching

## 8.1 Masalah Dynamic Origin dengan CDN/Proxy

Misalkan server menerima request dari:

```text
Origin: https://app.example.com
```

Server menjawab:

```http
Access-Control-Allow-Origin: https://app.example.com
```

Response ini disimpan oleh CDN.

Kemudian request dari:

```text
Origin: https://admin.example.com
```

Jika CDN mengembalikan response cache sebelumnya, browser melihat:

```http
Access-Control-Allow-Origin: https://app.example.com
```

Padahal origin saat ini `https://admin.example.com`.

Hasil: CORS gagal.

Atau lebih buruk, dalam konfigurasi tertentu caching response personalized dapat menyebabkan data leakage.

---

## 8.2 Solusi: `Vary: Origin`

Jika `Access-Control-Allow-Origin` berbeda tergantung request `Origin`, response harus mengandung:

```http
Vary: Origin
```

Untuk preflight, sering juga perlu:

```http
Vary: Origin, Access-Control-Request-Method, Access-Control-Request-Headers
```

Maknanya kepada cache:

```text
Response ini bisa berbeda tergantung nilai Origin dan header preflight terkait.
```

---

## 8.3 Jangan Campur Personalized Response dengan Cache Publik

Jika response berisi data user:

```http
Cache-Control: private, no-store
```

atau policy lain yang sesuai.

Jangan sampai response seperti `/users/me` disimpan shared cache dengan CORS dynamic origin.

Bug fatal:

```http
HTTP/1.1 200 OK
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Credentials: true
Cache-Control: public, max-age=600

{"userId":"alice"}
```

Endpoint personalized tidak boleh public-cacheable seperti itu.

---

## 9. Exposed Response Headers

## 9.1 Header Terlihat di Network Tapi Tidak Bisa Dibaca JS

Gejala:

Di DevTools response headers ada:

```http
X-Request-ID: abc-123
X-RateLimit-Remaining: 42
Content-Disposition: attachment; filename="report.csv"
```

Tetapi JavaScript:

```js
response.headers.get("X-Request-ID")
```

menghasilkan `null`.

### Penyebab

Untuk cross-origin response, browser hanya mengekspos header tertentu secara default.

Custom response headers harus diekspos lewat:

```http
Access-Control-Expose-Headers: X-Request-ID, X-RateLimit-Remaining, Content-Disposition
```

### Fix

Server response:

```http
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Credentials: true
Access-Control-Expose-Headers: X-Request-ID, X-RateLimit-Remaining, Content-Disposition
```

Lalu frontend dapat membaca:

```js
const requestId = response.headers.get("X-Request-ID");
const remaining = response.headers.get("X-RateLimit-Remaining");
const contentDisposition = response.headers.get("Content-Disposition");
```

---

## 9.2 Use Case Header yang Perlu Diekspos

Header yang sering perlu dibaca frontend:

| Header | Use case |
|---|---|
| `X-Request-ID` / `X-Correlation-ID` | Support/debugging |
| `Traceparent` atau trace-related header | Observability, jika memang dibutuhkan |
| `X-RateLimit-Remaining` | Menampilkan rate limit state |
| `X-RateLimit-Reset` | Menentukan kapan user bisa retry |
| `Retry-After` | Retry/backoff UI |
| `Content-Disposition` | Nama file download |
| `Link` | Pagination atau resource hints tertentu |
| `ETag` | Optimistic concurrency atau cache validation |

Namun jangan expose semua header tanpa alasan.

Prinsip:

```text
Expose only headers that frontend intentionally consumes.
```

---

## 10. Auth dan Preflight

## 10.1 Masalah Umum: Preflight 401

### Gejala

Frontend request:

```js
fetch("https://api.example.com/orders/123", {
  method: "PATCH",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({ status: "APPROVED" })
});
```

Browser mengirim preflight:

```http
OPTIONS /orders/123
Origin: https://app.example.com
Access-Control-Request-Method: PATCH
Access-Control-Request-Headers: authorization, content-type
```

Server menjawab:

```http
HTTP/1.1 401 Unauthorized
```

Actual `PATCH` tidak pernah dikirim.

### Root Cause

Security middleware mengharuskan semua request authenticated, termasuk `OPTIONS` preflight.

Tetapi preflight bukan request bisnis dan tidak membawa `Authorization` actual seperti yang diharapkan middleware.

### Fix Konseptual

CORS handling harus terjadi sebelum authentication business endpoint memblokir request.

Preflight valid harus dijawab sebagai policy negotiation:

```http
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Methods: PATCH
Access-Control-Allow-Headers: authorization, content-type
```

Actual request tetap harus melewati authentication dan authorization.

---

## 10.2 Spring Security Style Mental Model

Dalam stack Java/Spring, bug sering terjadi karena ordering filter:

```text
Request enters servlet container
        |
        v
CORS filter?
        |
        v
Security filter chain?
        |
        v
Controller?
```

Jika security chain memblokir `OPTIONS` sebelum CORS filter menjawab, browser melihat CORS failure.

Prinsip arsitektural:

```text
CORS policy evaluation must happen early enough for preflight to complete.
Business authentication still applies to actual request.
```

---

## 10.3 Jangan “Bypass OPTIONS” Secara Buta

Ada solusi cepat yang berbahaya:

```text
Allow all OPTIONS from anywhere.
```

Lebih baik:

- izinkan preflight hanya untuk origin allowlisted;
- izinkan method yang memang diperlukan;
- izinkan header yang memang diperlukan;
- jangan expose credentialed CORS ke semua origin;
- log origin yang ditolak.

Preflight bukan business operation, tapi tetap policy surface.

---

## 11. Content-Type dan Preflight

## 11.1 `application/json` Sering Memicu Preflight

Request:

```js
fetch("https://api.example.com/login", {
  method: "POST",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify({ username, password })
});
```

Walaupun method `POST`, `Content-Type: application/json` dapat membuat request tidak simple.

Akibatnya browser melakukan preflight.

Ini normal untuk API modern.

---

## 11.2 Jangan Mengubah ke `text/plain` Hanya untuk Menghindari Preflight

Kadang ada saran:

```js
headers: { "Content-Type": "text/plain" }
```

lalu body tetap JSON string.

Ini mungkin menghindari preflight pada kasus tertentu, tetapi biasanya mengorbankan kejelasan contract.

Kerugiannya:

- server harus parsing JSON dari `text/plain`;
- observability dan tooling menjadi misleading;
- security middleware bisa salah klasifikasi;
- API contract menjadi tidak jujur;
- developer lain bingung.

Lebih baik menerima preflight dan mengoptimalkannya dengan benar.

---

## 12. Custom Headers dan Preflight

## 12.1 Header Custom Memiliki Biaya

Contoh:

```js
fetch("https://api.example.com/users/me", {
  headers: {
    "X-App-Version": "1.2.3",
    "X-Platform": "web",
    "X-Feature-Set": "new-dashboard",
    "X-Request-ID": crypto.randomUUID()
  }
});
```

Setiap custom header perlu diizinkan di preflight.

Server harus menjawab:

```http
Access-Control-Allow-Headers: x-app-version, x-platform, x-feature-set, x-request-id
```

Jika salah satu tidak diizinkan, preflight gagal.

---

## 12.2 Evaluasi Apakah Header Perlu

Pertanyaan desain:

```text
Apakah data ini benar-benar metadata transport?
Atau sebenarnya bagian dari body/domain request?
Apakah header ini harus dikirim pada semua request?
Apakah header ini bisa memakai standar yang sudah ada?
Apakah header ini mempengaruhi caching?
Apakah header ini membuat preflight lebih sering?
```

Contoh:

| Kebutuhan | Lebih cocok |
|---|---|
| Correlation ID | Header |
| User input filter | Query/body |
| Tenant context eksplisit | Bisa header, tapi harus governance ketat |
| Feature flag experiment | Bisa header, cookie, atau config endpoint tergantung arsitektur |
| App version | Header atau User-Agent-like custom, tapi stabil |

---

## 13. Redirect dan CORS

## 13.1 Redirect Dapat Membingungkan Diagnosis

Request:

```text
https://api.example.com/users/me
```

Mendapat:

```http
302 Location: https://login.example.com
```

Browser mengikuti redirect, tetapi CORS policy bisa berubah karena target origin berubah.

Dari sudut frontend, error-nya mungkin tampak seperti CORS, padahal akar masalahnya:

```text
API mengembalikan login redirect HTML untuk AJAX request.
```

Untuk SPA/API, sering lebih baik mengembalikan:

```http
401 Unauthorized
Content-Type: application/json
```

bukan redirect ke halaman login.

---

## 13.2 Auth Redirect Anti-Pattern untuk API

Backend tradisional sering punya behavior:

```text
Unauthenticated request -> 302 /login
```

Ini cocok untuk browser navigation pada server-rendered app.

Untuk API consumed by SPA, lebih jelas:

```text
Unauthenticated API request -> 401 JSON error
Forbidden API request -> 403 JSON error
```

Frontend kemudian mengubah state:

```text
AUTHENTICATED -> SESSION_EXPIRED -> REDIRECT_TO_LOGIN
```

Bukan membiarkan HTTP redirect diam-diam mengembalikan HTML login page ke `fetch()`.

---

## 14. DevTools Diagnosis: Cara Membaca CORS Failure

## 14.1 Jangan Hanya Membaca Console Error

Console sering menampilkan pesan seperti:

```text
Access to fetch at 'https://api.example.com/...' from origin 'https://app.example.com' has been blocked by CORS policy
```

Itu gejala, bukan akar masalah.

Buka Network tab dan cari:

1. Apakah ada `OPTIONS`?
2. Status `OPTIONS` berapa?
3. Apakah actual request dikirim?
4. Apakah response punya `Access-Control-Allow-Origin`?
5. Apakah origin-nya tepat?
6. Apakah ada `Access-Control-Allow-Credentials`?
7. Apakah request memakai cookies?
8. Apakah response `Set-Cookie` ditolak?
9. Apakah redirect terjadi?
10. Apakah proxy/CDN menghapus header?

---

## 14.2 Diagnosis Tree

```text
CORS error di browser
        |
        v
Apakah request cross-origin?
        |
        +-- tidak --> mungkin bukan CORS; cek CSP/mixed content/network
        |
        +-- ya
             |
             v
Apakah ada preflight OPTIONS?
             |
        +----+----+
        |         |
      ya        tidak
        |         |
        v         v
OPTIONS sukses?  Actual response punya ACAO?
        |         |
   +----+----+    +----+----+
   |         |    |         |
 tidak      ya  tidak      ya
   |         |    |         |
fix preflight  cek actual  fix actual  cek credentials/exposed headers/cookies
```

---

## 14.3 Apa yang Harus Dilihat di Preflight

Di request `OPTIONS`, lihat:

```text
Request Headers:
- Origin
- Access-Control-Request-Method
- Access-Control-Request-Headers
```

Di response `OPTIONS`, lihat:

```text
Response Headers:
- Access-Control-Allow-Origin
- Access-Control-Allow-Methods
- Access-Control-Allow-Headers
- Access-Control-Allow-Credentials
- Access-Control-Max-Age
- Vary
```

Jika request ingin memakai `Authorization`, pastikan response preflight mengizinkan:

```http
Access-Control-Allow-Headers: authorization
```

Case-insensitive, tapi konsistensi tetap baik.

---

## 14.4 Apa yang Harus Dilihat di Actual Request

Di actual request, lihat:

```text
Request Headers:
- Origin
- Cookie
- Authorization
- Content-Type
```

Di actual response, lihat:

```text
Response Headers:
- Access-Control-Allow-Origin
- Access-Control-Allow-Credentials
- Access-Control-Expose-Headers
- Set-Cookie
- Cache-Control
- Vary
```

Jika cookie tidak ada di request, backend auth tidak akan melihat session.

Jika `Set-Cookie` ada tapi rejected, cek cookie warnings.

---

## 15. Server-Side CORS Contract

## 15.1 CORS Bukan Sekadar Middleware Default

CORS policy adalah contract. Ia harus didesain.

Minimal tentukan:

```text
Origins mana yang boleh?
Methods mana yang boleh?
Headers mana yang boleh?
Apakah credentials boleh?
Headers response mana yang diekspos?
Max age berapa?
Apakah policy sama untuk semua endpoint?
Bagaimana policy berbeda untuk public vs private API?
Bagaimana policy untuk staging/preview environment?
Bagaimana logging origin yang ditolak?
```

---

## 15.2 Public API vs Private Credentialed API

### Public non-credentialed API

```http
Access-Control-Allow-Origin: *
```

Cocok jika:

- tidak mengandung user data;
- tidak bergantung cookie/session;
- memang dirancang untuk public browser consumption.

### Private credentialed API

```http
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Credentials: true
Vary: Origin
```

Cocok jika:

- memakai cookie/session;
- response personalized;
- hanya frontend tertentu yang boleh membaca response.

---

## 15.3 Endpoint-Specific Policy

Tidak semua endpoint perlu policy sama.

Contoh:

| Endpoint | Policy |
|---|---|
| `/public/catalog` | Public read, no credentials, mungkin ACAO `*` |
| `/auth/login` | Specific origin, credentials true, POST |
| `/users/me` | Specific origin, credentials true, no-store |
| `/admin/*` | Admin origin only |
| `/internal/*` | No browser CORS access |
| `/metrics` | No public CORS |

Policy terlalu luas biasanya tanda desain malas.

---

## 16. Java/Spring-Oriented Example

Bagian ini bukan tutorial lengkap Spring, tetapi memberi mental model untuk engineer Java.

## 16.1 Prinsip Konfigurasi

Untuk credentialed SPA di:

```text
https://app.example.com
```

API di:

```text
https://api.example.com
```

Policy konseptual:

```text
Allowed origin: https://app.example.com
Allowed methods: GET, POST, PUT, PATCH, DELETE, OPTIONS
Allowed headers: Authorization, Content-Type, X-Request-ID, X-CSRF-Token
Exposed headers: X-Request-ID, Retry-After, ETag, Content-Disposition
Allow credentials: true
Max age: 600
```

---

## 16.2 Pseudocode Policy

```java
allowedOrigins = Set.of(
    "https://app.example.com",
    "https://admin.example.com"
);

origin = request.getHeader("Origin");

if (allowedOrigins.contains(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Credentials", "true");
    response.addHeader("Vary", "Origin");
}

if (isPreflight(request)) {
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Request-ID, X-CSRF-Token");
    response.setHeader("Access-Control-Max-Age", "600");
    response.addHeader("Vary", "Access-Control-Request-Method");
    response.addHeader("Vary", "Access-Control-Request-Headers");
    response.setStatus(204);
    return;
}
```

Poin penting:

- origin tidak direfleksikan tanpa validasi;
- credential hanya untuk origin spesifik;
- `Vary` diperhatikan;
- preflight dijawab sebelum business auth;
- actual request tetap melewati auth.

---

## 16.3 Spring Security Ordering Problem

Secara konseptual, pastikan:

```text
CORS configuration is integrated with security filter chain.
Preflight is not rejected as unauthenticated business request.
```

Jika melihat preflight `401` atau `403`, cari di security config:

- apakah CORS enabled di security layer?
- apakah `OPTIONS` diblokir global?
- apakah CSRF filter memblokir preflight?
- apakah custom auth filter membaca token pada preflight?
- apakah API gateway juga punya CORS policy berbeda?

---

## 17. API Gateway, CDN, and Reverse Proxy Problems

## 17.1 Header Hilang di Proxy

Frontend melihat CORS gagal, backend app merasa sudah mengirim header.

Kemungkinan:

```text
Backend app -> API gateway -> CDN -> browser
```

Salah satu layer menghapus/mengubah:

- `Access-Control-Allow-Origin`
- `Access-Control-Allow-Credentials`
- `Access-Control-Allow-Headers`
- `Access-Control-Expose-Headers`
- `Vary`
- `Set-Cookie`

Diagnosis:

- compare response langsung ke origin service vs melalui public domain;
- inspect gateway config;
- inspect CDN response headers;
- gunakan curl dengan `Origin` header;
- cek apakah error hanya terjadi di production.

---

## 17.2 Double CORS Header

Bug lain:

```http
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Origin: *
```

atau proxy/app sama-sama menambahkan header.

Browser bisa menolak karena header ambigu/invalid.

Prinsip:

```text
Exactly one layer should own final CORS policy, or layers must be coordinated strictly.
```

---

## 17.3 CDN Cache dan Origin Reflection

Jika response CORS dynamic origin di-cache tanpa `Vary: Origin`, bug akan intermittent.

Gejala:

- user A dari app berhasil;
- user B dari admin gagal;
- setelah cache purge, behavior berubah;
- local/staging tidak reproduce;
- hanya endpoint cacheable yang bermasalah.

Cek:

```http
Vary: Origin
Cache-Control
CDN cache key configuration
```

---

## 18. Security Pitfalls

## 18.1 CORS Terlalu Permisif dengan Credentials

Konfigurasi buruk:

```text
Reflect any Origin
Allow-Credentials true
Allow all methods
Allow all headers
```

Risiko:

Jika user sedang login ke API dan mengunjungi origin malicious, malicious site bisa membuat browser mengirim cookie ke API. CORS yang terlalu permisif bisa membuat malicious JS membaca response.

SameSite dan CSRF defense bisa mengurangi sebagian risiko, tapi jangan menjadikan CORS policy longgar sebagai default.

---

## 18.2 CORS Tidak Mencegah CSRF Send

CORS terutama mengontrol read access oleh JS.

CSRF berfokus pada kemampuan site lain untuk membuat browser mengirim request state-changing dengan credential.

Walaupun CORS tidak mengizinkan malicious JS membaca response, request tertentu masih bisa terkirim tergantung mekanisme browser, form, cookie SameSite, dan endpoint design.

Karena itu state-changing cookie-authenticated endpoint tetap perlu CSRF defense yang sesuai.

---

## 18.3 Jangan Pakai CORS sebagai Authorization

Buruk:

```text
Jika Origin adalah app.example.com, izinkan operasi admin.
```

Origin header bukan user identity.

Authorization tetap harus berdasarkan:

- authenticated user;
- session/token;
- role/permission;
- tenant boundary;
- object-level authorization.

CORS menentukan browser origin mana yang boleh membaca response, bukan siapa user-nya.

---

## 19. Production Bug Playbook

## 19.1 Bug: “Works in Postman, Fails in Browser”

### Penyebab umum

Postman bukan browser dan tidak menerapkan Same-Origin Policy/CORS seperti browser.

### Diagnosis

Jika Postman berhasil tapi browser gagal:

```text
Server business logic mungkin benar.
Browser policy layer mungkin gagal.
```

Cek:

- preflight;
- CORS headers;
- cookie attributes;
- credentials mode;
- mixed content;
- redirects;
- CSP.

---

## 19.2 Bug: “GET Berhasil, POST Gagal”

Kemungkinan:

- GET simple/no preflight;
- POST dengan JSON memicu preflight;
- server tidak handle OPTIONS;
- `Access-Control-Allow-Methods` tidak memasukkan POST;
- `Access-Control-Allow-Headers` tidak memasukkan `content-type`;
- CSRF/security filter memblokir POST.

---

## 19.3 Bug: “POST Berhasil, PATCH Gagal”

Kemungkinan:

- `PATCH` tidak ada di `Access-Control-Allow-Methods`;
- gateway tidak mengizinkan PATCH;
- backend framework route tidak support OPTIONS untuk PATCH;
- method override kacau;
- security rules hanya allow GET/POST.

---

## 19.4 Bug: “Header Authorization Membuat Request Gagal”

Kemungkinan:

`Authorization` memicu preflight, tapi server tidak mengizinkan header tersebut.

Fix:

```http
Access-Control-Allow-Headers: authorization, content-type
```

Namun jangan lupa actual request tetap perlu auth logic.

---

## 19.5 Bug: “Response Header Ada Tapi JS Tidak Bisa Baca”

Fix:

```http
Access-Control-Expose-Headers: X-Request-ID, Retry-After, ETag
```

---

## 19.6 Bug: “Login Sukses Tapi `/me` 401”

Cek:

- login fetch pakai `credentials: include`?
- `/me` fetch pakai `credentials: include`?
- `Set-Cookie` accepted atau rejected?
- Cookie domain/path cocok?
- SameSite/Secure cocok?
- API dan frontend cross-site atau same-site?
- response CORS punya `Allow-Credentials: true`?
- wildcard origin dipakai?

---

## 20. Designing a Defensible CORS Policy

## 20.1 Step-by-Step Policy Design

### Step 1 — Klasifikasi client

```text
Browser frontend mana yang boleh access API?
```

Contoh:

```text
https://app.example.com
https://admin.example.com
https://partner-portal.example.net
```

---

### Step 2 — Klasifikasi endpoint

```text
Public read?
User-authenticated?
Admin?
Internal only?
Webhook/server-to-server?
```

Tidak semua endpoint perlu browser CORS.

---

### Step 3 — Tentukan credential model

```text
Cookie/session?
Bearer token?
No credentials?
```

Cookie/session biasanya membutuhkan credentialed CORS dan CSRF design.

Bearer token biasanya memicu preflight karena `Authorization` header.

---

### Step 4 — Tentukan allowed methods

Jangan asal:

```http
Access-Control-Allow-Methods: *
```

Lebih baik eksplisit:

```http
Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS
```

Sesuai kebutuhan endpoint/API.

---

### Step 5 — Tentukan allowed headers

Daftar minimal:

```http
Access-Control-Allow-Headers: authorization, content-type, x-request-id, x-csrf-token
```

Jangan izinkan header tidak jelas tanpa alasan.

---

### Step 6 — Tentukan exposed headers

Expose hanya yang digunakan frontend:

```http
Access-Control-Expose-Headers: x-request-id, retry-after, etag, content-disposition
```

---

### Step 7 — Tentukan max age

Contoh:

```http
Access-Control-Max-Age: 600
```

Sesuaikan dengan kebutuhan security dan deployment.

---

### Step 8 — Tentukan cache headers

Jika dynamic origin:

```http
Vary: Origin
```

Jika preflight response tergantung requested method/header:

```http
Vary: Origin, Access-Control-Request-Method, Access-Control-Request-Headers
```

Jika personalized:

```http
Cache-Control: no-store
```

atau policy private yang tepat.

---

## 21. Frontend HTTP Client Rules

Untuk frontend, buat aturan eksplisit di HTTP client layer.

## 21.1 Jangan Sebar `credentials` Secara Ad-hoc

Buruk:

```js
fetch(url, { credentials: "include" });
// di tempat lain lupa
fetch(url);
```

Lebih baik punya wrapper:

```ts
async function apiFetch(path: string, init: RequestInit = {}) {
  return fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-Request-ID": crypto.randomUUID(),
      ...(init.headers ?? {})
    }
  });
}
```

Namun hati-hati: wrapper default `Content-Type: application/json` untuk semua request bisa salah untuk `FormData` upload. Part 031 akan membahas client architecture lebih dalam.

---

## 21.2 Jangan Pakai `no-cors` untuk Memperbaiki CORS

Ini anti-pattern klasik.

```js
fetch("https://api.example.com/users/me", {
  mode: "no-cors"
});
```

Mode `no-cors` menghasilkan opaque response yang tidak bisa dibaca JS secara bermakna.

Ini bukan solusi untuk API JSON.

Jika API perlu dibaca frontend, server harus mengirim CORS headers yang benar.

---

## 21.3 Baca Error sebagai State Machine

Untuk request cross-origin credentialed:

```text
INIT
  -> PREFLIGHT_NEEDED
  -> PREFLIGHT_ALLOWED / PREFLIGHT_REJECTED
  -> ACTUAL_SENT
  -> ACTUAL_RESPONSE_RECEIVED
  -> CORS_RESPONSE_ALLOWED / CORS_RESPONSE_REJECTED
  -> BODY_PARSED / BODY_PARSE_FAILED
  -> DOMAIN_SUCCESS / DOMAIN_ERROR
```

Jangan langsung lompat dari “fetch gagal” ke “backend error”.

---

## 22. Curl untuk Debugging CORS

Browser adalah source of truth, tapi `curl` berguna untuk melihat header server.

## 22.1 Simulasi Preflight

```bash
curl -i -X OPTIONS 'https://api.example.com/orders/123' \
  -H 'Origin: https://app.example.com' \
  -H 'Access-Control-Request-Method: PATCH' \
  -H 'Access-Control-Request-Headers: authorization, content-type, x-request-id'
```

Expected:

```http
HTTP/2 204
access-control-allow-origin: https://app.example.com
access-control-allow-methods: GET, POST, PATCH, DELETE, OPTIONS
access-control-allow-headers: authorization, content-type, x-request-id
access-control-max-age: 600
vary: Origin, Access-Control-Request-Method, Access-Control-Request-Headers
```

---

## 22.2 Simulasi Actual Request

```bash
curl -i 'https://api.example.com/users/me' \
  -H 'Origin: https://app.example.com' \
  -H 'Cookie: sid=abc'
```

Expected:

```http
HTTP/2 200
access-control-allow-origin: https://app.example.com
access-control-allow-credentials: true
cache-control: no-store
vary: Origin
content-type: application/json
```

Catatan penting: curl tidak memblokir response karena CORS. Anda harus menilai sendiri apakah header-nya akan diterima browser.

---

## 23. Common Anti-Patterns and Better Alternatives

## 23.1 Anti-Pattern: `Access-Control-Allow-Origin: *` untuk Semua

Masalah:

- tidak cocok untuk credentialed response;
- terlalu luas untuk private API;
- bisa membuat policy tidak defensible.

Alternatif:

```text
Use explicit allowlist per environment and endpoint class.
```

---

## 23.2 Anti-Pattern: Reflect Origin Tanpa Validasi

Masalah:

- malicious origin bisa diberi akses;
- sangat berbahaya jika `Allow-Credentials: true`.

Alternatif:

```text
Reflect only if origin is in validated allowlist.
```

---

## 23.3 Anti-Pattern: Auth Middleware Memblokir OPTIONS

Masalah:

- preflight gagal;
- actual request tidak pernah dikirim.

Alternatif:

```text
Handle valid preflight before business authentication. Authenticate actual request.
```

---

## 23.4 Anti-Pattern: Menambahkan Banyak Custom Header

Masalah:

- preflight meningkat;
- allow headers sulit dijaga;
- cache key bervariasi;
- observability noisy.

Alternatif:

```text
Minimize and standardize headers. Put domain data in body/query when appropriate.
```

---

## 23.5 Anti-Pattern: Menggunakan `no-cors`

Masalah:

- response opaque;
- API JSON tidak bisa dibaca;
- menyembunyikan akar masalah.

Alternatif:

```text
Fix server CORS policy.
```

---

## 23.6 Anti-Pattern: Same CORS Policy untuk Semua Endpoint

Masalah:

- public endpoint terlalu ketat atau private endpoint terlalu longgar;
- admin/internal exposure risk.

Alternatif:

```text
Classify endpoints and assign policy intentionally.
```

---

## 24. Review Checklist untuk Pull Request

Gunakan checklist ini saat review frontend/backend/API gateway change.

### 24.1 Frontend Request Checklist

```text
[ ] Apakah request cross-origin?
[ ] Apakah method/header/content-type memicu preflight?
[ ] Apakah credentials mode benar?
[ ] Apakah request perlu cookie/session?
[ ] Apakah header custom benar-benar perlu?
[ ] Apakah FormData tidak dipaksa Content-Type manual?
[ ] Apakah error handling membedakan network/CORS/HTTP/domain error?
```

### 24.2 Backend CORS Checklist

```text
[ ] Origin allowlist eksplisit?
[ ] Tidak reflect Origin tanpa validasi?
[ ] Credentialed response tidak memakai wildcard?
[ ] OPTIONS preflight dijawab sebelum auth business logic?
[ ] Allowed methods sesuai kebutuhan?
[ ] Allowed headers sesuai request nyata?
[ ] Exposed headers sesuai kebutuhan frontend?
[ ] Access-Control-Max-Age diset masuk akal?
[ ] Vary: Origin diset untuk dynamic origin?
[ ] Personalized response tidak public-cacheable?
```

### 24.3 Infra/CDN Checklist

```text
[ ] Proxy tidak menghapus CORS headers?
[ ] Tidak ada duplicate ACAO?
[ ] CDN cache key memperhitungkan Origin jika perlu?
[ ] Vary dihormati?
[ ] Set-Cookie tidak di-strip?
[ ] HTTP->HTTPS redirect tidak mengubah CORS flow secara buruk?
[ ] Gateway method allowlist mencakup OPTIONS dan actual methods?
```

---

## 25. Case Study End-to-End

## 25.1 Scenario

Frontend:

```text
https://app.regsys.example
```

API:

```text
https://api.regsys.example
```

Feature:

```text
Case officer approves an enforcement action.
```

Frontend request:

```ts
await fetch("https://api.regsys.example/enforcement-actions/EA-123/approval", {
  method: "PATCH",
  credentials: "include",
  headers: {
    "Content-Type": "application/json",
    "X-Request-ID": requestId,
    "X-CSRF-Token": csrfToken
  },
  body: JSON.stringify({ decision: "APPROVE", note: "Evidence threshold met." })
});
```

---

## 25.2 Browser Preflight

```http
OPTIONS /enforcement-actions/EA-123/approval HTTP/1.1
Host: api.regsys.example
Origin: https://app.regsys.example
Access-Control-Request-Method: PATCH
Access-Control-Request-Headers: content-type, x-request-id, x-csrf-token
```

Server should respond:

```http
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: https://app.regsys.example
Access-Control-Allow-Credentials: true
Access-Control-Allow-Methods: PATCH, OPTIONS
Access-Control-Allow-Headers: content-type, x-request-id, x-csrf-token
Access-Control-Max-Age: 600
Vary: Origin, Access-Control-Request-Method, Access-Control-Request-Headers
```

---

## 25.3 Actual Request

```http
PATCH /enforcement-actions/EA-123/approval HTTP/1.1
Host: api.regsys.example
Origin: https://app.regsys.example
Cookie: sid=...
Content-Type: application/json
X-Request-ID: req-789
X-CSRF-Token: csrf-456

{"decision":"APPROVE","note":"Evidence threshold met."}
```

Actual response:

```http
HTTP/1.1 200 OK
Access-Control-Allow-Origin: https://app.regsys.example
Access-Control-Allow-Credentials: true
Access-Control-Expose-Headers: X-Request-ID, ETag
Cache-Control: no-store
Vary: Origin
X-Request-ID: req-789
ETag: "case-version-17"
Content-Type: application/json

{
  "id": "EA-123",
  "state": "APPROVED",
  "version": 17
}
```

---

## 25.4 Failure Matrix

| Failure | Symptom | Root Cause | Fix |
|---|---|---|---|
| Preflight 403 | Actual PATCH never sent | OPTIONS blocked by security | Handle CORS before auth |
| Missing `x-csrf-token` allow header | CORS preflight failed | Header not in ACAH | Add to allow headers |
| No cookie on PATCH | API returns 401 | Missing `credentials: include` or cookie attrs wrong | Fix fetch and cookie policy |
| Response unreadable | Console CORS error | Missing ACAO on actual response | Add ACAO to actual response |
| Cannot read ETag | `headers.get("ETag")` null | Missing expose headers | Add `Access-Control-Expose-Headers: ETag` |
| Intermittent CORS | Only some origins fail | Missing `Vary: Origin` with CDN | Fix Vary/cache key |

---

## 26. Key Invariants

Simpan invariants ini.

```text
1. CORS is enforced by the browser, not by Postman/curl/server-to-server clients.
```

```text
2. Preflight failure means the actual request may never reach the business endpoint.
```

```text
3. Passing preflight does not guarantee actual response is readable.
```

```text
4. Credentialed CORS requires both frontend credentials mode and server credential policy.
```

```text
5. Wildcard origin is not valid for readable credentialed responses.
```

```text
6. Cookie SameSite is about site, while CORS is about origin.
```

```text
7. Header visible in DevTools is not necessarily exposed to JavaScript.
```

```text
8. Dynamic CORS origin plus cache requires Vary: Origin.
```

```text
9. CORS is not authentication or authorization.
```

```text
10. Do not fix CORS by using no-cors for JSON APIs.
```

---

## 27. Latihan

## 27.1 Latihan 1 — Identifikasi Fase Gagal

Diberikan gejala:

```text
Frontend PATCH ke API gagal.
Backend controller tidak menerima request.
Network tab menunjukkan OPTIONS 401.
```

Jawab:

1. Fase mana yang gagal?
2. Apakah actual PATCH terkirim?
3. Apakah ini masalah business authorization?
4. Perbaikan arsitekturalnya apa?

Expected reasoning:

```text
Preflight gagal. Actual request tidak terkirim. Ini biasanya masalah CORS/security filter ordering, bukan authorization PATCH. Valid preflight perlu dijawab sebelum business auth; actual request tetap diautentikasi.
```

---

## 27.2 Latihan 2 — Cookie Login

Diberikan:

```http
Set-Cookie: sid=abc; HttpOnly; Secure; SameSite=None
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Credentials: true
```

Frontend:

```js
fetch("https://api.example.com/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(credentials)
});
```

Masalah:

```text
Login 200, tetapi request berikutnya 401.
```

Pertanyaan:

1. Apa yang kurang?
2. Apakah server CORS sudah cukup?
3. Apa yang perlu dicek di browser?

Expected reasoning:

```text
Fetch login tidak memakai credentials: include. Untuk cross-origin cookie flow, frontend request dan subsequent request perlu credentials include. Cek apakah Set-Cookie accepted, domain/path/samesite/secure cocok, dan apakah Cookie header muncul di request berikutnya.
```

---

## 27.3 Latihan 3 — Header Tidak Terbaca

Diberikan response:

```http
HTTP/1.1 200 OK
Access-Control-Allow-Origin: https://app.example.com
X-Request-ID: abc
```

Frontend:

```js
const id = response.headers.get("X-Request-ID");
```

Hasil:

```text
null
```

Fix?

Expected:

```http
Access-Control-Expose-Headers: X-Request-ID
```

---

## 28. Ringkasan

CORS production bugs jarang selesai dengan “tambahkan satu header”. Yang perlu Anda kuasai adalah memecah request menjadi fase:

```text
JavaScript intent
Browser classification
Preflight policy negotiation
Actual request
Actual response exposure
Credential/cookie handling
Cache/proxy interaction
Frontend state handling
```

Ketika Anda memahami fase ini, error yang tampak kabur menjadi diagnosa sistematis.

CORS yang baik harus memenuhi tiga kualitas:

1. **Correct** — browser request valid bekerja sesuai contract.
2. **Secure** — origin, credential, method, dan headers tidak terlalu luas.
3. **Operable** — mudah didebug, observable, konsisten di local/staging/prod, dan tidak rusak oleh CDN/proxy.

---

## 29. Apa yang Tidak Dibahas Mendalam di Bagian Ini

Beberapa topik hanya disentuh dan akan dibahas lebih dalam di part berikutnya:

- cookie attribute detail dan browser cookie model: Part 012;
- session, CSRF, auth state machine: Part 013;
- HTTP caching dan `Vary`: Part 014–015;
- redirect behavior: Part 016;
- security headers dan isolation policies: Part 021–022;
- frontend HTTP client architecture: Part 031.

---

## 30. Status Seri

```text
Part 011 selesai.
Seri belum selesai.
Lanjut ke Part 012: Cookies Part 1: Browser Cookie Model for Frontend Engineers.
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-http-for-web-frontend-perspective-part-010.md">⬅️ CORS Part 1: Same-Origin Policy and Why CORS Exists</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-http-for-web-frontend-perspective-part-012.md">Part 012 — Cookies Part 1: Browser Cookie Model for Frontend Engineers ➡️</a>
</div>
