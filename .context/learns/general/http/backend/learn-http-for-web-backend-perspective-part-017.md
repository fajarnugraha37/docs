# learn-http-for-web-backend-perspective-part-017.md

# Part 017 — CORS from Backend Enforcement Perspective

> Seri: `learn-http-for-web-backend-perspective`  
> Target pembaca: Java backend engineer / tech lead  
> Fokus: memahami CORS sebagai kebijakan browser yang dideklarasikan oleh backend, bukan mekanisme authentication, authorization, atau proteksi server secara umum.

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita membahas cookie, session, dan CSRF. Itu penting karena browser memiliki mekanisme otomatis yang tidak dimiliki machine-to-machine client: browser otomatis menyimpan dan mengirim cookie sesuai aturan cookie, dan karena itulah CSRF menjadi relevan.

CORS berada di keluarga masalah yang sama: ia bukan murni fitur backend, juga bukan murni fitur frontend. CORS adalah mekanisme koordinasi antara:

1. browser,
2. origin halaman web,
3. server tujuan,
4. credentials seperti cookie atau Authorization header,
5. policy yang dikirim backend melalui response headers.

Kesalahan umum engineer backend adalah menganggap CORS sebagai “security server”. Itu framing yang salah. CORS tidak mencegah curl, Postman, backend service lain, script non-browser, atau attacker server-side mengirim request ke API. CORS hanya mengontrol apakah browser boleh mengekspos response cross-origin ke JavaScript yang berjalan di origin tertentu.

Di sisi backend, CORS adalah deklarasi: “untuk origin X, method Y, header Z, dan mode credentials tertentu, browser boleh atau tidak boleh melanjutkan/membaca interaksi ini.”

---

## 1. Learning Objectives

Setelah menyelesaikan part ini, kamu harus mampu:

1. Menjelaskan perbedaan origin, site, host, dan domain.
2. Menjelaskan kenapa Same-Origin Policy ada.
3. Menjelaskan apa yang CORS izinkan dan apa yang tidak ia lindungi.
4. Membedakan simple request dan preflighted request.
5. Mendesain allowlist origin yang aman untuk backend multi-environment dan multi-tenant.
6. Memilih nilai header CORS secara defensible:
   - `Access-Control-Allow-Origin`
   - `Access-Control-Allow-Methods`
   - `Access-Control-Allow-Headers`
   - `Access-Control-Allow-Credentials`
   - `Access-Control-Expose-Headers`
   - `Access-Control-Max-Age`
   - `Vary: Origin`
7. Memahami interaksi CORS dengan cookie, bearer token, CSRF, dan cache.
8. Menempatkan enforcement CORS secara tepat: gateway, reverse proxy, application, atau kombinasi.
9. Menghindari anti-pattern seperti wildcard origin dengan credentials, dynamic reflection tanpa allowlist, dan CORS sebagai pengganti authorization.
10. Mengimplementasikan CORS secara benar di Spring MVC dan Spring Security.

---

## 2. Mental Model Utama

### 2.1 CORS adalah browser access-control protocol

CORS bukan firewall.

CORS bukan authentication.

CORS bukan authorization.

CORS bukan proteksi API dari semua client.

CORS adalah mekanisme browser untuk memutuskan apakah JavaScript dari suatu origin boleh membaca response dari origin lain.

Contoh:

```text
User membuka:
https://app.example.com

JavaScript di halaman itu memanggil:
https://api.example.com/cases
```

Bagi browser, `app.example.com` dan `api.example.com` adalah origin berbeda, karena host berbeda. Tanpa izin CORS dari `api.example.com`, browser tidak akan mengekspos response ke JavaScript.

Tetapi request network mungkin tetap terkirim, terutama untuk kategori request tertentu. Yang dibatasi CORS terutama adalah kemampuan JavaScript membaca response dan, untuk request tertentu, kemampuan browser mengirim request tanpa preflight.

### 2.2 Server mendeklarasikan izin, browser menegakkan

Backend mengirim header seperti:

```http
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Credentials: true
```

Browser membaca header tersebut dan memutuskan apakah JavaScript boleh menerima response.

Server tidak “menjalankan CORS” dalam arti aktif memblokir semua cross-origin client. Server hanya mengirim metadata. Browserlah yang melakukan enforcement.

Karena itu, attacker masih bisa memanggil API dengan curl:

```bash
curl -H 'Origin: https://evil.example' https://api.example.com/cases
```

Kalau server tidak punya authentication/authorization yang benar, CORS tidak menyelamatkan apa pun.

### 2.3 CORS adalah policy untuk browser, authorization adalah policy untuk resource

CORS menjawab:

> Apakah script dari origin ini boleh membaca response API ini di browser?

Authorization menjawab:

> Apakah principal ini boleh melakukan operasi ini terhadap resource ini?

Keduanya berbeda.

Origin bukan user.

Origin bukan role.

Origin bukan tenant.

Origin hanya sumber dokumen web yang menjalankan JavaScript.

---

## 3. Same-Origin Policy sebagai Latar Belakang

### 3.1 Origin

Origin didefinisikan oleh tiga komponen:

```text
scheme + host + port
```

Contoh:

| URL | Origin |
|---|---|
| `https://app.example.com/dashboard` | `https://app.example.com` |
| `https://app.example.com:443/dashboard` | `https://app.example.com:443` |
| `http://app.example.com/dashboard` | `http://app.example.com` |
| `https://api.example.com/cases` | `https://api.example.com` |
| `https://app.example.com:8443/dashboard` | `https://app.example.com:8443` |

Origin berbeda jika scheme, host, atau port berbeda.

Ini berarti:

```text
https://app.example.com
https://api.example.com
```

adalah cross-origin.

Dan:

```text
http://app.example.com
https://app.example.com
```

juga cross-origin, karena scheme berbeda.

### 3.2 Same-Origin Policy

Same-Origin Policy adalah baseline proteksi browser. Tanpanya, JavaScript dari situs jahat dapat membaca response dari situs lain yang user sedang login.

Bayangkan user login ke:

```text
https://bank.example
```

Lalu user membuka:

```text
https://evil.example
```

Jika tidak ada same-origin policy, JavaScript dari `evil.example` bisa melakukan:

```javascript
fetch('https://bank.example/accounts')
```

Browser mungkin otomatis menyertakan cookie bank. Tanpa pembatasan response access, script jahat bisa membaca saldo user.

Same-Origin Policy mencegah script dari origin lain membaca data tersebut, kecuali server tujuan secara eksplisit mengizinkan melalui CORS.

### 3.3 CORS melonggarkan SOP secara terkontrol

CORS bukan mengganti Same-Origin Policy. CORS adalah cara server mengatakan:

> Untuk origin tertentu, saya mengizinkan browser melonggarkan pembatasan cross-origin.

Ini penting. Default browser adalah restriktif. CORS adalah opt-in relaxation.

---

## 4. Origin, Site, Domain, Host: Jangan Campur

Banyak bug CORS muncul karena engineer mencampur istilah.

### 4.1 Host

Host adalah nama host dalam URL.

```text
app.example.com
api.example.com
```

### 4.2 Domain

Domain bisa ambigu. Dalam percakapan sehari-hari, orang sering menyebut `example.com` sebagai domain dan `app.example.com` sebagai subdomain.

Tetapi untuk CORS, yang penting bukan “domain utama sama”, melainkan origin lengkap.

### 4.3 Site

Site biasanya mengacu ke registrable domain plus scheme dalam konteks cookie SameSite dan browser security model.

Misalnya:

```text
https://app.example.com
https://api.example.com
```

bisa dianggap same-site, tetapi tetap cross-origin.

Ini penting karena cookie `SameSite` berbicara tentang site, sedangkan CORS berbicara tentang origin.

### 4.4 Origin

Origin adalah:

```text
scheme + host + port
```

CORS berbasis origin, bukan site.

### 4.5 Implikasi Backend

Jangan membuat kebijakan CORS seperti:

```text
allow all *.example.com
```

tanpa threat model.

Subdomain internal, staging, preview, customer-specific, atau takeover-prone bisa menjadi pintu masuk.

Contoh risiko:

```text
https://old-marketing.example.com
https://customer-upload.example.com
https://preview-123.example.com
```

Jika salah satu bisa dikontrol attacker dan kamu mengizinkan wildcard subdomain dengan credentials, API bisa terekspos ke JavaScript attacker dalam browser user.

---

## 5. Anatomy CORS Request

Ada dua kategori besar:

1. simple request,
2. preflighted request.

Istilah “simple” sering menyesatkan. Simple request bukan berarti aman. Simple request berarti browser dapat mengirim request langsung tanpa OPTIONS preflight karena bentuknya sesuai kriteria tertentu.

---

## 6. Simple Request

### 6.1 Definisi Praktis

Secara praktis, request bisa masuk kategori simple jika memenuhi batasan tertentu pada method, headers, dan content type.

Biasanya method simple:

```text
GET
HEAD
POST
```

Dengan header yang terbatas dan `Content-Type` tertentu seperti:

```text
application/x-www-form-urlencoded
multipart/form-data
text/plain
```

Tidak semua request `POST` otomatis preflight.

### 6.2 Kenapa Ini Penting?

Jika request simple, browser bisa langsung mengirim request ke server cross-origin.

Kalau server melakukan side effect berdasarkan cookie session tanpa CSRF protection, request tersebut bisa tetap berbahaya walaupun response tidak dapat dibaca oleh attacker.

Contoh:

```html
<form method="POST" action="https://api.example.com/cases/123/approve">
  <input name="decision" value="approved">
</form>
```

Atau JavaScript/form dari situs lain memicu request yang browser anggap simple.

Inilah alasan CORS bukan pengganti CSRF.

### 6.3 Backend Lesson

Untuk state-changing browser-backed endpoints:

1. jangan bergantung pada CORS untuk mencegah request,
2. tetap gunakan CSRF protection jika memakai cookie/session,
3. validasi method dan media type,
4. gunakan SameSite cookie sebagai lapisan tambahan, bukan satu-satunya proteksi,
5. pastikan authorization tetap berjalan.

---

## 7. Preflight Request

### 7.1 Apa Itu Preflight?

Preflight adalah request `OPTIONS` otomatis dari browser untuk bertanya ke server apakah cross-origin request tertentu diizinkan.

Contoh preflight:

```http
OPTIONS /cases/123 HTTP/1.1
Host: api.example.com
Origin: https://app.example.com
Access-Control-Request-Method: PATCH
Access-Control-Request-Headers: content-type, authorization, if-match
```

Server dapat menjawab:

```http
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Methods: GET, POST, PATCH, DELETE
Access-Control-Allow-Headers: Content-Type, Authorization, If-Match
Access-Control-Allow-Credentials: true
Access-Control-Max-Age: 600
Vary: Origin
```

Jika browser menerima jawaban yang cocok, browser melanjutkan request sebenarnya:

```http
PATCH /cases/123 HTTP/1.1
Host: api.example.com
Origin: https://app.example.com
Content-Type: application/json
Authorization: Bearer ...
If-Match: "v17"

{ "status": "UNDER_REVIEW" }
```

### 7.2 Preflight Bukan Authentication

Preflight biasanya tidak membawa credentials dengan cara yang sama seperti actual request. Jangan jadikan preflight sebagai authorization resource.

Server tidak boleh berpikir:

> OPTIONS berhasil, berarti request sebenarnya authorized.

Preflight hanya capability check untuk browser.

Actual request tetap harus menjalankan authentication, authorization, validation, idempotency, concurrency check, dan business rule.

### 7.3 Status Code untuk Preflight

Umumnya backend mengembalikan:

```http
204 No Content
```

atau:

```http
200 OK
```

Yang penting browser menerima header CORS yang sesuai.

Untuk request preflight yang tidak diizinkan, backend bisa tidak mengembalikan header CORS yang dibutuhkan atau mengembalikan 403. Dalam praktik, banyak framework/gateway hanya menolak tanpa header allow yang cocok, sehingga browser memblokir.

### 7.4 OPTIONS Routing

Backend perlu memastikan `OPTIONS` tidak masuk ke handler domain yang salah.

Misalnya endpoint:

```http
PATCH /cases/{caseId}
```

Preflight-nya:

```http
OPTIONS /cases/{caseId}
```

Jangan sampai ini menghasilkan:

```http
405 Method Not Allowed
```

tanpa CORS headers, padahal endpoint PATCH seharusnya diizinkan dari origin tertentu.

---

## 8. Header CORS Utama

---

## 8.1 `Origin`

Browser mengirim header:

```http
Origin: https://app.example.com
```

Origin adalah input utama untuk kebijakan CORS.

Backend harus memperlakukan `Origin` sebagai untrusted input. Client non-browser bisa memalsukan header ini.

Artinya:

1. boleh digunakan untuk menentukan CORS response,
2. boleh dilog untuk observability,
3. tidak boleh digunakan sebagai bukti identitas user,
4. tidak boleh digunakan sebagai satu-satunya authorization control.

### Contoh Salah

```java
if (origin.endsWith(".trusted-client.com")) {
    allowAccessToTenantData();
}
```

Ini fatal. Origin bukan principal.

---

## 8.2 `Access-Control-Allow-Origin`

Response header ini mengatakan origin mana yang diizinkan membaca response.

Contoh aman untuk satu origin:

```http
Access-Control-Allow-Origin: https://app.example.com
```

Untuk public non-credentialed API:

```http
Access-Control-Allow-Origin: *
```

Tetapi wildcard tidak boleh digunakan bersama credentials.

### Dynamic Allow-Origin

Jika banyak origin diizinkan, server sering membaca `Origin` request dan memantulkannya kembali jika ada di allowlist.

Contoh:

```http
Origin: https://admin.example.com
```

Response:

```http
Access-Control-Allow-Origin: https://admin.example.com
Vary: Origin
```

Ini valid jika origin dicek terhadap allowlist yang ketat.

Yang berbahaya adalah reflection tanpa validasi:

```text
Ambil Origin apa pun dari request, lalu set sebagai Access-Control-Allow-Origin.
```

Itu sama saja dengan allow all origins, bahkan lebih berbahaya jika dikombinasikan dengan credentials.

---

## 8.3 `Access-Control-Allow-Credentials`

Header ini mengizinkan browser menyertakan dan mengekspos response untuk request yang memakai credentials.

```http
Access-Control-Allow-Credentials: true
```

Credentials dapat berupa:

1. cookie,
2. TLS client certificate,
3. authorization header dalam konteks fetch dengan credentials/config tertentu.

Jika menggunakan credentials, server harus mengembalikan origin eksplisit:

```http
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Credentials: true
```

Bukan:

```http
Access-Control-Allow-Origin: *
Access-Control-Allow-Credentials: true
```

### Backend Rule

Gunakan credentials hanya jika benar-benar perlu.

Jika API menggunakan bearer token di `Authorization` header dan client memang browser SPA, kamu masih perlu memperhatikan CORS karena `Authorization` adalah non-simple request header yang memicu preflight. Tetapi jangan otomatis mengaktifkan cookie credentials jika tidak menggunakan cookie.

---

## 8.4 `Access-Control-Allow-Methods`

Digunakan pada preflight response untuk menyatakan method yang diizinkan.

Contoh:

```http
Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS
```

Jangan memasukkan method yang tidak benar-benar didukung.

Kebijakan terlalu longgar menyulitkan audit dan debugging.

Lebih baik endpoint-aware:

```text
/cases
  GET, POST

/cases/{id}
  GET, PATCH, DELETE

/cases/{id}/decision
  POST
```

Namun secara operasional, banyak gateway/framework mengatur CORS per route group. Itu bisa diterima jika tetap least privilege per surface.

---

## 8.5 `Access-Control-Allow-Headers`

Digunakan pada preflight response untuk menyatakan request headers yang boleh dikirim actual request.

Contoh:

```http
Access-Control-Allow-Headers: Content-Type, Authorization, If-Match, Idempotency-Key, X-Request-ID
```

Headers penting untuk backend API:

| Header | Kenapa Mungkin Dibutuhkan |
|---|---|
| `Content-Type` | JSON body |
| `Authorization` | Bearer token |
| `If-Match` | optimistic concurrency |
| `Idempotency-Key` | retry-safe command |
| `X-Request-ID` | correlation |
| `Traceparent` | distributed tracing |

Jangan gunakan:

```http
Access-Control-Allow-Headers: *
```

secara default tanpa memahami implikasi. Untuk API internal/public tertentu mungkin diterima, tetapi untuk surface sensitif sebaiknya eksplisit.

---

## 8.6 `Access-Control-Expose-Headers`

Secara default, browser hanya mengekspos subset response headers ke JavaScript. Jika frontend perlu membaca header lain, backend harus mengeksposnya.

Contoh:

```http
Access-Control-Expose-Headers: ETag, Location, Retry-After, X-Request-ID
```

Use case backend:

| Header | Kenapa Diekspos |
|---|---|
| `ETag` | client perlu melakukan `If-Match` berikutnya |
| `Location` | setelah `201 Created` atau `202 Accepted` |
| `Retry-After` | rate limit / maintenance / async retry guidance |
| `X-Request-ID` | support/debugging |
| `Content-Disposition` | download filename |

Tanpa expose, response header mungkin ada di network tab tetapi tidak bisa dibaca oleh JavaScript.

### Example

Response:

```http
HTTP/1.1 200 OK
ETag: "case-v17"
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Expose-Headers: ETag
```

Frontend dapat membaca:

```javascript
const etag = response.headers.get('ETag');
```

---

## 8.7 `Access-Control-Max-Age`

Header ini menginstruksikan browser berapa lama hasil preflight bisa di-cache.

```http
Access-Control-Max-Age: 600
```

Manfaat:

1. mengurangi jumlah OPTIONS request,
2. menurunkan latency,
3. mengurangi beban gateway/backend.

Risiko:

1. perubahan policy tidak langsung terlihat,
2. revoke origin/method/header bisa tertunda di browser,
3. debugging lebih membingungkan.

Untuk production, nilai moderat sering lebih baik daripada terlalu tinggi.

Contoh:

```text
5–10 menit untuk policy sensitif
30–60 menit untuk policy stabil dan rendah risiko
```

Jangan jadikan angka ini dogma. Sesuaikan dengan kebutuhan deployment dan risiko revoke.

---

## 8.8 `Vary: Origin`

Jika server mengembalikan `Access-Control-Allow-Origin` secara dinamis berdasarkan request `Origin`, response harus menyertakan:

```http
Vary: Origin
```

Kenapa?

Karena shared cache/CDN perlu tahu bahwa response berbeda tergantung header `Origin`.

Tanpa `Vary: Origin`, cache bisa menyimpan response untuk satu origin lalu memberikannya ke origin lain.

Contoh bahaya:

1. Request dari `https://app.example.com` mendapat:

```http
Access-Control-Allow-Origin: https://app.example.com
```

2. CDN cache response.
3. Request dari `https://evil.example` menerima response cache yang masih berisi allow-origin untuk app atau response salah lainnya.

Efeknya bisa membingungkan atau berbahaya tergantung konfigurasi.

Rule sederhana:

> Jika `Access-Control-Allow-Origin` tidak selalu konstan, tambahkan `Vary: Origin`.

---

## 9. Credential Modes dan Backend Consequences

Browser fetch memiliki mode credentials:

```javascript
fetch(url, { credentials: 'omit' })
fetch(url, { credentials: 'same-origin' })
fetch(url, { credentials: 'include' })
```

Dari sisi backend, yang penting adalah memahami apakah request akan membawa cookie/session dan apakah response boleh diekspos.

### 9.1 Cookie Session API

Untuk API yang memakai cookie session cross-origin:

Backend biasanya perlu:

```http
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Credentials: true
Set-Cookie: SESSION=...; HttpOnly; Secure; SameSite=None
```

Selain itu frontend harus memakai:

```javascript
fetch('https://api.example.com/me', {
  credentials: 'include'
})
```

Tetapi dari sisi backend, jangan lupa:

1. CSRF protection tetap diperlukan untuk state-changing operations.
2. `SameSite=None` mensyaratkan `Secure` pada browser modern.
3. Origin allowlist harus ketat.
4. Jangan wildcard.

### 9.2 Bearer Token SPA API

Untuk API yang memakai bearer token:

```http
Authorization: Bearer eyJ...
```

Karena `Authorization` bukan simple header, request biasanya butuh preflight.

Backend perlu mengizinkan:

```http
Access-Control-Allow-Headers: Authorization, Content-Type
```

Jika tidak memakai cookie credentials, biasanya tidak perlu:

```http
Access-Control-Allow-Credentials: true
```

Namun tetap perlu origin allowlist jika API tidak public.

### 9.3 Machine-to-Machine API

CORS tidak relevan untuk machine-to-machine HTTP client.

Jika API hanya dipanggil backend service lain:

1. CORS tidak perlu,
2. gunakan authentication service-to-service,
3. gunakan mTLS, token, atau signed request,
4. filter Origin bukan proteksi.

---

## 10. CORS dan CSRF

### 10.1 CORS Tidak Menghapus CSRF

Jika API menggunakan cookie session, browser dapat otomatis mengirim cookie ke server target tergantung konfigurasi cookie dan request context.

CORS dapat mencegah attacker membaca response, tetapi state-changing request masih bisa terjadi pada kategori tertentu.

CSRF bertanya:

> Bisakah attacker membuat browser user mengirim request state-changing yang membawa otoritas user?

CORS bertanya:

> Bolehkah JavaScript attacker membaca response cross-origin?

Keduanya berbeda.

### 10.2 CORS Bisa Membantu, Tapi Bukan Lapisan Utama CSRF

Backend bisa menggunakan Origin/Referer validation sebagai lapisan CSRF defense.

Contoh:

```text
Jika method state-changing dan session cookie digunakan:
  require valid CSRF token
  verify Origin/Referer when present
  reject unexpected content type
  require application/json for API endpoints
```

Tetapi jangan hanya mengandalkan CORS.

### 10.3 SameSite Interactions

Cookie `SameSite=Lax` atau `Strict` dapat mengurangi risiko CSRF, tetapi tidak sama dengan CORS.

Kasus cross-origin tetapi same-site, misalnya:

```text
https://app.example.com
https://api.example.com
```

Bisa memiliki perilaku cookie yang berbeda dari cross-site scenario.

Backend harus mendesain secara eksplisit:

1. apakah API dipanggil dari same-origin frontend?
2. cross-origin same-site frontend?
3. cross-site external frontend?
4. embedded third-party context?

---

## 11. CORS dan Authorization

### 11.1 CORS Bukan Authorization

Jangan pernah menulis logic:

```text
Origin allowed => user allowed
```

Yang benar:

```text
Origin allowed => browser may send/read cross-origin interaction
Principal authorized => operation may happen
```

### 11.2 Resource-Level Authorization Tetap Wajib

Contoh request:

```http
GET /cases/CASE-123 HTTP/1.1
Origin: https://app.example.com
Authorization: Bearer token-user-a
```

Backend harus tetap memeriksa:

1. token valid,
2. user aktif,
3. tenant cocok,
4. user boleh membaca CASE-123,
5. field-level authorization,
6. state-dependent access.

CORS hanya memastikan origin `https://app.example.com` boleh digunakan sebagai browser client.

### 11.3 Public Origin Bukan Public Data

Bahkan jika banyak origin diizinkan, data tetap harus diproteksi.

Misalnya API partner:

```text
https://partner-a.example
https://partner-b.example
```

Kedua origin boleh memanggil API, tetapi partner A tidak boleh membaca data partner B.

CORS allowlist bukan tenant isolation.

---

## 12. CORS dan Cache

### 12.1 Dynamic Origin Requires Vary

Seperti dibahas sebelumnya:

```http
Vary: Origin
```

wajib ketika CORS response bergantung pada Origin.

### 12.2 Credentials and Shared Cache

Jika response berisi data user-specific:

```http
Cache-Control: private, no-store
```

atau policy cache yang sangat ketat sesuai data.

Jangan mengandalkan CORS untuk mencegah cache leak.

### 12.3 Preflight Cache

Preflight cache berada di browser dan dikontrol oleh `Access-Control-Max-Age`.

Ini berbeda dari HTTP response cache biasa.

Backend observability perlu memperhitungkan bahwa OPTIONS traffic bisa turun karena preflight cached, bukan karena request actual turun.

---

## 13. CORS Placement: Gateway vs Application

### 13.1 CORS di Gateway

Keuntungan:

1. konsisten antar service,
2. mengurangi duplikasi konfigurasi,
3. preflight bisa dijawab tanpa menyentuh application,
4. policy lebih mudah dikelola di edge,
5. mengurangi latency dan beban app.

Risiko:

1. gateway tidak tahu detail route/domain,
2. policy terlalu longgar,
3. per-tenant/per-resource CORS sulit,
4. mismatch antara gateway allowed methods dan application actual methods,
5. debugging lintas layer lebih sulit.

### 13.2 CORS di Application

Keuntungan:

1. bisa route-aware,
2. bisa environment-aware,
3. dekat dengan API contract,
4. mudah dites dalam integration test,
5. bisa disesuaikan per controller.

Risiko:

1. duplikasi antar service,
2. inconsistent policy,
3. preflight tetap membebani app,
4. security review lebih sulit jika tersebar.

### 13.3 Hybrid Approach

Untuk sistem besar, pendekatan hybrid sering paling realistis:

1. gateway menangani baseline CORS,
2. application mendefinisikan route-level policy jika perlu,
3. central platform menyediakan library/standard,
4. CI memvalidasi policy,
5. observability dikonsolidasikan.

### 13.4 Rule of Thumb

| Situasi | Placement Disarankan |
|---|---|
| Satu frontend resmi, banyak backend services | Gateway baseline |
| API publik dengan banyak consumers browser | Gateway + registry allowlist |
| Policy sangat domain-specific | Application |
| Multi-tenant custom domains | Dedicated CORS policy service/library |
| Internal M2M only | Disable CORS |

---

## 14. CORS Policy Design

### 14.1 Jangan Mulai dari Header

Jangan mulai dengan pertanyaan:

> Header apa yang perlu ditambahkan supaya error hilang?

Mulai dari pertanyaan:

1. Siapa browser client yang sah?
2. Origin mana yang menjalankan JavaScript client sah?
3. Apakah request memakai cookie/session?
4. Apakah request memakai bearer token?
5. Method apa saja yang dibutuhkan?
6. Request header apa saja yang dibutuhkan?
7. Response header apa yang perlu dibaca frontend?
8. Apakah API public, partner, internal, atau admin?
9. Apakah origin bisa berubah per tenant?
10. Bagaimana policy direvoke?

### 14.2 Policy Matrix

Contoh matrix:

| Surface | Allowed Origin | Credentials | Methods | Headers | Exposed Headers |
|---|---|---:|---|---|---|
| Public catalog | `*` | no | GET | none/custom minimal | none |
| User app API | `https://app.example.com` | yes | GET, POST, PATCH, DELETE | Content-Type, If-Match, X-CSRF-Token | ETag, Location, X-Request-ID |
| Admin API | `https://admin.example.com` | yes | GET, POST, PATCH, DELETE | Content-Type, Authorization, If-Match, Idempotency-Key | ETag, Location, Retry-After, X-Request-ID |
| Partner portal | allowlisted partner origins | maybe | GET, POST | Content-Type, Authorization, Idempotency-Key | Location, Retry-After |
| Internal service API | none | n/a | n/a | n/a | n/a |

### 14.3 Environment Separation

Do not mix production and dev origins carelessly.

Example bad policy:

```text
allow:
  http://localhost:3000
  https://app.example.com
  https://*.preview.example.com
  https://admin.example.com
```

Potential issues:

1. local dev origin accidentally enabled in production,
2. preview environments controlled by many people,
3. wildcard subdomain takeover risk,
4. admin and normal app have same access surface.

Better:

```text
production:
  https://app.example.com
  https://admin.example.com

staging:
  https://app.staging.example.com
  https://admin.staging.example.com

development:
  http://localhost:3000
  http://localhost:5173
```

### 14.4 Multi-Tenant Custom Domains

If tenants can configure custom domains:

```text
https://portal.tenant-a.com
https://cases.tenant-b.org
```

Backend must validate origins against tenant configuration.

But do not use requested tenant path alone.

Bad:

```text
GET /tenants/tenant-a/cases
Origin: https://cases.tenant-b.org
```

If tenant is inferred from path and origin is separately allowlisted globally, cross-tenant confusion can occur.

Better:

1. resolve tenant from authenticated principal and host/origin binding,
2. verify origin belongs to same tenant context,
3. enforce authorization on resource,
4. log mismatches.

---

## 15. Anti-Patterns

### 15.1 `Access-Control-Allow-Origin: *` Everywhere

This may be fine for truly public, unauthenticated, non-sensitive GET APIs.

It is wrong for authenticated user data.

### 15.2 Wildcard with Credentials

Bad:

```http
Access-Control-Allow-Origin: *
Access-Control-Allow-Credentials: true
```

Browsers generally reject this combination. But its presence shows broken mental model.

### 15.3 Reflect Any Origin

Bad:

```java
response.setHeader("Access-Control-Allow-Origin", request.getHeader("Origin"));
response.setHeader("Access-Control-Allow-Credentials", "true");
```

This effectively grants any website access in browser context.

### 15.4 Allow All Headers and Methods by Default

Bad:

```http
Access-Control-Allow-Methods: *
Access-Control-Allow-Headers: *
```

It hides API contract and makes abuse/debugging harder.

### 15.5 Treating CORS Error as Backend Authorization Error

A browser CORS error may mean:

1. missing CORS header,
2. preflight rejected,
3. wrong allowed header,
4. wrong allowed method,
5. credentials mismatch,
6. redirect issue,
7. TLS issue,
8. browser blocked response visibility.

It does not necessarily mean the backend endpoint returned 403.

### 15.6 Fixing CORS by Disabling Security

Bad quick fix:

```text
allow all origins
allow all methods
allow all headers
allow credentials
```

This turns a debugging problem into a production security problem.

### 15.7 Applying CORS to Non-Browser Internal APIs

Unnecessary CORS config on internal service APIs creates noise and false assumptions.

For internal APIs, solve identity and authorization through service auth, network policy, mTLS, gateway policy, and application authorization.

---

## 16. Debugging CORS Correctly

### 16.1 Browser Error Is Not Enough

Browser often reports generic messages like:

```text
Access to fetch at ... from origin ... has been blocked by CORS policy
```

Do not stop there.

Inspect:

1. actual request method,
2. preflight OPTIONS request,
3. request `Origin`,
4. `Access-Control-Request-Method`,
5. `Access-Control-Request-Headers`,
6. response status,
7. response CORS headers,
8. redirects,
9. whether credentials are included,
10. whether response header is exposed.

### 16.2 Use curl Carefully

Curl can simulate CORS headers, but curl does not enforce browser CORS.

Example preflight simulation:

```bash
curl -i -X OPTIONS 'https://api.example.com/cases/123' \
  -H 'Origin: https://app.example.com' \
  -H 'Access-Control-Request-Method: PATCH' \
  -H 'Access-Control-Request-Headers: content-type, authorization, if-match'
```

Expected response:

```http
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Methods: GET, POST, PATCH, DELETE
Access-Control-Allow-Headers: Content-Type, Authorization, If-Match
Access-Control-Allow-Credentials: true
Vary: Origin
```

Actual request simulation:

```bash
curl -i -X PATCH 'https://api.example.com/cases/123' \
  -H 'Origin: https://app.example.com' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer test' \
  -H 'If-Match: "v17"' \
  --data '{"status":"UNDER_REVIEW"}'
```

But remember: curl will show response even if browser would block it.

### 16.3 Common Debug Cases

#### Case 1: Missing Authorization in Allow-Headers

Preflight:

```http
Access-Control-Request-Headers: authorization, content-type
```

Response:

```http
Access-Control-Allow-Headers: Content-Type
```

Browser blocks.

Fix:

```http
Access-Control-Allow-Headers: Content-Type, Authorization
```

#### Case 2: Credentials Used But Server Does Not Allow Credentials

Frontend:

```javascript
fetch(url, { credentials: 'include' })
```

Response:

```http
Access-Control-Allow-Origin: https://app.example.com
```

Missing:

```http
Access-Control-Allow-Credentials: true
```

#### Case 3: Wildcard Origin with Credentials

Response:

```http
Access-Control-Allow-Origin: *
Access-Control-Allow-Credentials: true
```

Browser rejects.

Fix: return explicit allowlisted origin.

#### Case 4: Header Exists But Frontend Cannot Read It

Response:

```http
ETag: "v17"
Access-Control-Allow-Origin: https://app.example.com
```

Frontend:

```javascript
response.headers.get('ETag') // null
```

Fix:

```http
Access-Control-Expose-Headers: ETag
```

#### Case 5: Redirect Breaks Preflight/Actual Request

CORS and redirects can be confusing because preflight/actual request may hit different hosts or paths.

Example:

```text
https://api.example.com/v1/cases -> 301 -> https://new-api.example.com/v1/cases
```

The redirected origin/path must also satisfy CORS. Avoid unnecessary redirects for API endpoints.

---

## 17. Spring MVC CORS

Spring provides several ways to configure CORS.

### 17.1 Controller-Level `@CrossOrigin`

Example:

```java
@RestController
@RequestMapping("/api/cases")
@CrossOrigin(
    origins = "https://app.example.com",
    allowedHeaders = {"Content-Type", "Authorization", "If-Match", "Idempotency-Key"},
    exposedHeaders = {"ETag", "Location", "X-Request-ID"},
    methods = {RequestMethod.GET, RequestMethod.POST, RequestMethod.PATCH, RequestMethod.DELETE},
    allowCredentials = "true",
    maxAge = 600
)
class CaseController {

    @GetMapping("/{caseId}")
    CaseResponse getCase(@PathVariable String caseId) {
        throw new UnsupportedOperationException("example");
    }
}
```

This is explicit, but can become repetitive and inconsistent across controllers.

### 17.2 Global MVC CORS Configuration

```java
@Configuration
class WebCorsConfig implements WebMvcConfigurer {

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
            .allowedOrigins("https://app.example.com", "https://admin.example.com")
            .allowedMethods("GET", "POST", "PATCH", "DELETE", "OPTIONS")
            .allowedHeaders("Content-Type", "Authorization", "If-Match", "Idempotency-Key", "X-Request-ID")
            .exposedHeaders("ETag", "Location", "Retry-After", "X-Request-ID")
            .allowCredentials(true)
            .maxAge(600);
    }
}
```

This is easier to govern.

### 17.3 Dynamic Origin with `CorsConfigurationSource`

For environment/tenant-aware policy, use explicit logic.

```java
@Configuration
class CorsConfigurationProvider {

    @Bean
    CorsConfigurationSource corsConfigurationSource(AllowedOriginService allowedOriginService) {
        return request -> {
            String origin = request.getHeader("Origin");

            if (origin == null || !allowedOriginService.isAllowed(origin)) {
                return null;
            }

            CorsConfiguration config = new CorsConfiguration();
            config.setAllowedOrigins(List.of(origin));
            config.setAllowedMethods(List.of("GET", "POST", "PATCH", "DELETE", "OPTIONS"));
            config.setAllowedHeaders(List.of(
                "Content-Type",
                "Authorization",
                "If-Match",
                "Idempotency-Key",
                "X-Request-ID",
                "Traceparent"
            ));
            config.setExposedHeaders(List.of("ETag", "Location", "Retry-After", "X-Request-ID"));
            config.setAllowCredentials(true);
            config.setMaxAge(600L);
            return config;
        };
    }
}
```

Important: `allowedOriginService.isAllowed(origin)` must be strict.

Do not use naive suffix matching.

Bad:

```java
origin.endsWith("example.com")
```

This may match:

```text
https://evil-example.com
```

If using wildcard/subdomain logic, parse origin with URI parser and verify scheme/host/port carefully.

---

## 18. Spring Security and CORS

If using Spring Security, CORS must be integrated with the security filter chain.

Example:

```java
@Configuration
@EnableWebSecurity
class SecurityConfig {

    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        return http
            .cors(Customizer.withDefaults())
            .csrf(csrf -> csrf
                .csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse())
            )
            .authorizeHttpRequests(auth -> auth
                .requestMatchers(HttpMethod.OPTIONS, "/api/**").permitAll()
                .requestMatchers("/api/admin/**").hasRole("ADMIN")
                .requestMatchers("/api/**").authenticated()
                .anyRequest().denyAll()
            )
            .oauth2ResourceServer(oauth2 -> oauth2.jwt(Customizer.withDefaults()))
            .build();
    }
}
```

Notes:

1. CORS should run before authorization blocks preflight.
2. OPTIONS preflight should not require user authentication in most cases.
3. Actual requests still require authentication/authorization.
4. CSRF decision depends on whether cookie/session is used.

### 18.1 Common Spring Mistake

A frequent issue:

```text
Preflight OPTIONS receives 401/403 from Spring Security before CORS headers are applied.
```

Browser reports CORS error, but root cause is security filter ordering/configuration.

Fix by enabling CORS in security config and providing a `CorsConfigurationSource`.

---

## 19. WebFlux CORS

For WebFlux, configuration is similar conceptually but uses reactive stack components.

### 19.1 Global WebFlux CORS

```java
@Configuration
class WebFluxCorsConfig implements WebFluxConfigurer {

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
            .allowedOrigins("https://app.example.com")
            .allowedMethods("GET", "POST", "PATCH", "DELETE", "OPTIONS")
            .allowedHeaders("Content-Type", "Authorization", "If-Match", "Idempotency-Key")
            .exposedHeaders("ETag", "Location", "Retry-After", "X-Request-ID")
            .allowCredentials(true)
            .maxAge(600);
    }
}
```

### 19.2 Reactive Security

```java
@Configuration
@EnableWebFluxSecurity
class ReactiveSecurityConfig {

    @Bean
    SecurityWebFilterChain springSecurityFilterChain(ServerHttpSecurity http) {
        return http
            .cors(Customizer.withDefaults())
            .csrf(ServerHttpSecurity.CsrfSpec::disable)
            .authorizeExchange(exchanges -> exchanges
                .pathMatchers(HttpMethod.OPTIONS, "/api/**").permitAll()
                .pathMatchers("/api/**").authenticated()
                .anyExchange().denyAll()
            )
            .oauth2ResourceServer(oauth2 -> oauth2.jwt(Customizer.withDefaults()))
            .build();
    }
}
```

Disable CSRF only if your threat model supports it, for example bearer-token-only API without cookie credentials.

---

## 20. CORS in Nginx/Gateway

Example Nginx-style conceptual config:

```nginx
set $cors_origin "";

if ($http_origin = "https://app.example.com") {
    set $cors_origin $http_origin;
}

if ($http_origin = "https://admin.example.com") {
    set $cors_origin $http_origin;
}

add_header Access-Control-Allow-Origin $cors_origin always;
add_header Access-Control-Allow-Credentials "true" always;
add_header Access-Control-Expose-Headers "ETag, Location, Retry-After, X-Request-ID" always;
add_header Vary "Origin" always;

if ($request_method = OPTIONS) {
    add_header Access-Control-Allow-Origin $cors_origin always;
    add_header Access-Control-Allow-Credentials "true" always;
    add_header Access-Control-Allow-Methods "GET, POST, PATCH, DELETE, OPTIONS" always;
    add_header Access-Control-Allow-Headers "Content-Type, Authorization, If-Match, Idempotency-Key, X-Request-ID" always;
    add_header Access-Control-Max-Age 600 always;
    add_header Vary "Origin" always;
    return 204;
}
```

Caution: actual Nginx config needs careful review. `if` in Nginx has caveats depending on context. For production, prefer map-based config or gateway-native CORS plugin when available.

Conceptual principle:

1. only allow known origins,
2. include CORS headers on error responses too when helpful,
3. handle preflight consistently,
4. do not hide application authorization failures as CORS failures unnecessarily,
5. preserve `Vary: Origin`.

---

## 21. CORS and Error Responses

Suppose actual request fails authorization:

```http
HTTP/1.1 403 Forbidden
Content-Type: application/problem+json
```

If browser client is allowed origin, backend should still include CORS headers:

```http
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Credentials: true
```

Otherwise frontend sees generic CORS failure instead of structured 403 problem response.

### 21.1 Backend Rule

For allowed origins, CORS headers should usually be added to both success and error responses.

This improves debuggability and UX.

But do not add allow headers for disallowed origins merely to explain. Browser blocking is acceptable for disallowed origins.

---

## 22. CORS and Regulatory/Case Management Systems

Consider an enforcement lifecycle platform:

Surfaces:

1. public respondent portal,
2. internal investigator UI,
3. supervisor review UI,
4. legal review UI,
5. external agency portal,
6. machine-to-machine integration API.

Naive CORS policy:

```text
Allow all origins with credentials.
```

Unacceptable.

Better policy:

| Surface | Origin | API Surface | Credentials | Notes |
|---|---|---|---:|---|
| Respondent portal | `https://respondent.example.gov` | `/api/respondent/**` | yes | CSRF required if cookie session |
| Investigator UI | `https://investigator.example.gov` | `/api/internal/**` | yes | internal role authorization |
| Legal UI | `https://legal.example.gov` | `/api/legal/**` | yes | stricter authorization/audit |
| External agency portal | allowlisted agency domains | `/api/agency/**` | maybe | partner identity required |
| M2M API | none | `/api/integration/**` | n/a | no CORS; use mTLS/token |

Important:

1. CORS separates browser surfaces.
2. Authorization separates user/resource permissions.
3. Audit records should include origin where useful, but origin is not identity.
4. Different UIs may require different exposed headers.
5. Partner origins need lifecycle management: approval, rotation, revoke, expiration.

---

## 23. Testing Strategy

### 23.1 Unit Tests for Policy

Test pure function:

```text
origin -> allowed/not allowed
```

Cases:

1. exact production origin allowed,
2. staging origin not allowed in production,
3. localhost not allowed in production,
4. malicious suffix not allowed,
5. null origin handled deliberately,
6. tenant origin bound to tenant,
7. uppercase/mixed-case normalization handled safely,
8. trailing slash rejected/normalized according to parser.

### 23.2 Integration Tests for Preflight

Example with MockMvc:

```java
mockMvc.perform(options("/api/cases/CASE-123")
        .header("Origin", "https://app.example.com")
        .header("Access-Control-Request-Method", "PATCH")
        .header("Access-Control-Request-Headers", "content-type,authorization,if-match"))
    .andExpect(status().isNoContent())
    .andExpect(header().string("Access-Control-Allow-Origin", "https://app.example.com"))
    .andExpect(header().string("Access-Control-Allow-Credentials", "true"))
    .andExpect(header().string("Vary", Matchers.containsString("Origin")));
```

### 23.3 Integration Tests for Actual Request

```java
mockMvc.perform(get("/api/cases/CASE-123")
        .header("Origin", "https://app.example.com")
        .header("Authorization", "Bearer test-token"))
    .andExpect(header().string("Access-Control-Allow-Origin", "https://app.example.com"));
```

### 23.4 Negative Tests

```java
mockMvc.perform(options("/api/cases/CASE-123")
        .header("Origin", "https://evil.example")
        .header("Access-Control-Request-Method", "PATCH"))
    .andExpect(header().doesNotExist("Access-Control-Allow-Origin"));
```

### 23.5 Browser-Level Tests

Use end-to-end tests for realistic browser behavior:

1. credentialed fetch,
2. exposed headers,
3. preflight caching,
4. disallowed origin,
5. 401/403 structured error visibility,
6. redirect behavior.

---

## 24. Observability

Log CORS-related data carefully.

Useful fields:

```text
http.request.method
http.route
http.status_code
http.request.header.origin
cors.allowed
cors.preflight
cors.request_method
cors.request_headers
cors.policy_id
cors.decision_reason
user.id or principal id if authenticated
tenant.id if known
request.id
trace.id
```

Do not log sensitive tokens.

### 24.1 Metrics

Useful metrics:

1. preflight request count,
2. preflight deny count,
3. actual request denied by CORS count,
4. origin distribution,
5. unknown origin attempts,
6. CORS errors by route,
7. OPTIONS latency,
8. 401/403 with allowed origin,
9. missing exposed header incidents.

### 24.2 Alerting

Potential alerts:

1. sudden spike in unknown origins,
2. spike in OPTIONS traffic,
3. production requests from localhost origin,
4. partner origin suddenly denied,
5. CORS denies after deployment,
6. admin API accessed from non-admin origin.

---

## 25. Null Origin

Sometimes browser sends:

```http
Origin: null
```

This can occur in contexts such as sandboxed documents, local files, or privacy-sensitive scenarios.

Do not casually allow `null`.

Bad:

```http
Access-Control-Allow-Origin: null
Access-Control-Allow-Credentials: true
```

Unless you have a very specific trusted use case, reject it.

---

## 26. Origin Parsing Safely

Do not parse origin with string hacks.

Bad:

```java
boolean allowed = origin.contains("example.com");
```

Bad:

```java
boolean allowed = origin.endsWith(".example.com");
```

Problems:

```text
https://notexample.com
https://evil-example.com
https://example.com.evil.org
https://example.com@evil.org
```

Better:

1. parse as URI,
2. require scheme `https` in production,
3. compare normalized host exactly or against controlled suffix rules,
4. verify port,
5. do not allow userinfo,
6. reject malformed origin,
7. store origins in canonical form.

Example conceptual Java:

```java
final class OriginPolicy {
    private final Set<String> exactAllowedOrigins = Set.of(
        "https://app.example.com",
        "https://admin.example.com"
    );

    boolean isAllowed(String origin) {
        if (origin == null || origin.isBlank()) {
            return false;
        }

        URI uri;
        try {
            uri = URI.create(origin);
        } catch (IllegalArgumentException ex) {
            return false;
        }

        if (!"https".equalsIgnoreCase(uri.getScheme())) {
            return false;
        }

        if (uri.getUserInfo() != null || uri.getPath() != null && !uri.getPath().isBlank()) {
            return false;
        }

        String host = uri.getHost();
        if (host == null) {
            return false;
        }

        int port = uri.getPort();
        String canonical = port == -1
            ? "https://" + host.toLowerCase(Locale.ROOT)
            : "https://" + host.toLowerCase(Locale.ROOT) + ":" + port;

        return exactAllowedOrigins.contains(canonical);
    }
}
```

Note: actual origin grammar is stricter than general URI in some ways. The key point is: do deliberate parsing and canonical comparison, not substring matching.

---

## 27. Security Review Checklist

Use this checklist before approving CORS config:

1. Is this endpoint intended for browser clients?
2. Are all allowed origins explicitly known?
3. Are dev/staging origins excluded from production?
4. Is wildcard origin avoided for authenticated data?
5. Is `Access-Control-Allow-Credentials` used only when required?
6. Are allowed methods least-privilege?
7. Are allowed headers least-privilege?
8. Are exposed headers intentional?
9. Is `Vary: Origin` set for dynamic origin responses?
10. Are preflight requests handled before authentication blocks them?
11. Are actual requests still authenticated and authorized?
12. Is CSRF handled for cookie-backed state-changing operations?
13. Are error responses CORS-compatible for allowed origins?
14. Are origins parsed safely?
15. Is `null` origin rejected unless explicitly needed?
16. Are partner/tenant origins lifecycle-managed?
17. Is policy observable?
18. Are negative tests included?
19. Are gateway and application policies consistent?
20. Is CORS disabled for non-browser internal APIs?

---

## 28. Decision Framework

When designing CORS for an endpoint, answer in this order:

### Step 1: Is the caller a browser JavaScript app?

If no, CORS likely not needed.

### Step 2: Is the API response public?

If yes and no credentials:

```http
Access-Control-Allow-Origin: *
```

may be acceptable.

### Step 3: Does request use cookie/session?

If yes:

1. explicit origin allowlist,
2. `Access-Control-Allow-Credentials: true`,
3. CSRF protection for state-changing requests,
4. no wildcard,
5. secure cookies.

### Step 4: Does request use Authorization header?

If yes:

1. allow `Authorization` in preflight,
2. validate token normally,
3. do not assume CORS is auth.

### Step 5: Does frontend need response headers?

Expose only needed headers:

```http
Access-Control-Expose-Headers: ETag, Location, Retry-After, X-Request-ID
```

### Step 6: Is policy dynamic?

If yes:

```http
Vary: Origin
```

### Step 7: Where should policy live?

Choose gateway, app, or hybrid based on governance and route specificity.

---

## 29. Practical Policy Examples

### 29.1 Public Read-Only API

```http
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, OPTIONS
Access-Control-Allow-Headers: Content-Type
Access-Control-Max-Age: 3600
```

No credentials.

### 29.2 Authenticated SPA with Bearer Token

```http
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization, If-Match, Idempotency-Key, X-Request-ID
Access-Control-Expose-Headers: ETag, Location, Retry-After, X-Request-ID
Access-Control-Max-Age: 600
Vary: Origin
```

Credentials may not be needed if no cookies are involved.

### 29.3 Cookie Session Web App Cross-Origin

```http
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Credentials: true
Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, X-CSRF-Token, If-Match, Idempotency-Key, X-Request-ID
Access-Control-Expose-Headers: ETag, Location, Retry-After, X-Request-ID
Access-Control-Max-Age: 600
Vary: Origin
```

Also required:

```http
Set-Cookie: SESSION=...; HttpOnly; Secure; SameSite=None
```

And CSRF protection.

### 29.4 Admin API

```http
Access-Control-Allow-Origin: https://admin.example.com
Access-Control-Allow-Credentials: true
Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization, X-CSRF-Token, If-Match, Idempotency-Key, X-Request-ID
Access-Control-Expose-Headers: ETag, Location, Retry-After, X-Request-ID
Access-Control-Max-Age: 300
Vary: Origin
```

Shorter max age may be preferred for sensitive admin surfaces.

---

## 30. Capstone Mini-Case: Regulatory Case API

### Scenario

A regulatory enforcement platform exposes these browser clients:

1. investigator UI: `https://investigator.regsys.example`
2. supervisor UI: `https://supervisor.regsys.example`
3. respondent portal: `https://respondent.regsys.example`
4. public search portal: `https://public.regsys.example`

API:

```text
GET    /api/cases/{caseId}
PATCH  /api/cases/{caseId}
POST   /api/cases/{caseId}/submit-evidence
POST   /api/cases/{caseId}/decision
GET    /api/public/cases
```

### Design

Public search:

```text
Origin: any
Credentials: no
Methods: GET
Expose: maybe none
```

Internal case APIs:

```text
Allowed origins:
  https://investigator.regsys.example
  https://supervisor.regsys.example

Credentials:
  true if cookie session
  false if bearer-only

Allowed headers:
  Content-Type
  Authorization or X-CSRF-Token depending auth mode
  If-Match
  Idempotency-Key
  X-Request-ID

Exposed headers:
  ETag
  Location
  Retry-After
  X-Request-ID
```

Respondent evidence upload:

```text
Allowed origin:
  https://respondent.regsys.example

Methods:
  GET, POST, OPTIONS

Headers:
  Content-Type
  Authorization/X-CSRF-Token
  Idempotency-Key
  X-Request-ID

Additional controls:
  file size limit
  malware scan pipeline
  object-level authorization
  evidence ownership
  audit logging
```

### Why This Matters

If investigator and respondent origins share one overly broad CORS policy, a bug in one UI surface can increase blast radius. CORS is not primary authorization, but it can reduce unintended browser integration paths.

---

## 31. Summary

CORS is a backend responsibility because only the server can declare cross-origin policy. But CORS is enforced by browser, not by backend against all clients.

The most important conclusions:

1. CORS controls browser JavaScript access to cross-origin responses.
2. CORS is not authentication.
3. CORS is not authorization.
4. CORS is not CSRF protection.
5. `Origin` is untrusted input.
6. Wildcard origin is only acceptable for truly public non-credentialed APIs.
7. Credentialed requests require explicit allowed origin.
8. Dynamic origin responses require `Vary: Origin`.
9. Preflight must be handled separately from actual authorization.
10. Actual requests must still run full security, validation, concurrency, and business logic.
11. CORS policy should be designed as an API surface contract, not as an emergency browser-error patch.

---

## 32. Exercises

### Exercise 1 — Diagnose Preflight Failure

Given this preflight:

```http
OPTIONS /api/cases/CASE-123 HTTP/1.1
Origin: https://app.example.com
Access-Control-Request-Method: PATCH
Access-Control-Request-Headers: content-type, authorization, if-match
```

And this response:

```http
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Methods: GET, POST, PATCH
Access-Control-Allow-Headers: Content-Type
```

Question:

1. Why will browser block?
2. What header should be changed?
3. Does this say anything about whether user is authorized to PATCH the case?

Expected reasoning:

1. `authorization` and `if-match` were requested but not allowed.
2. Add `Authorization, If-Match` to `Access-Control-Allow-Headers`.
3. No. Authorization is checked on actual request.

### Exercise 2 — Design CORS for Cookie Session API

Design CORS policy for:

```text
Frontend: https://app.example.com
API: https://api.example.com
Auth: cookie session
State-changing methods: POST, PATCH, DELETE
CSRF token header: X-CSRF-Token
Client needs to read ETag and Location
```

Expected answer includes:

```http
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Credentials: true
Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, X-CSRF-Token, If-Match, Idempotency-Key, X-Request-ID
Access-Control-Expose-Headers: ETag, Location, X-Request-ID
Vary: Origin
```

And server-side CSRF validation.

### Exercise 3 — Find the Vulnerability

Policy:

```java
String origin = request.getHeader("Origin");
response.setHeader("Access-Control-Allow-Origin", origin);
response.setHeader("Access-Control-Allow-Credentials", "true");
```

Question:

What is wrong?

Expected answer:

The server reflects any origin and allows credentials. Any attacker-controlled website can become an allowed browser origin. This defeats the purpose of origin allowlisting.

### Exercise 4 — Gateway vs Application

You operate 30 microservices behind one API gateway. Only 3 services are browser-facing. Where should CORS live?

Expected reasoning:

A gateway baseline is useful to avoid duplication and answer preflight early, but only browser-facing routes should have CORS. Application-level or route-level policy may still be needed for sensitive/admin/tenant-specific endpoints. Do not apply broad CORS to all internal services.

### Exercise 5 — Exposed Header

Backend returns:

```http
ETag: "v42"
```

Frontend cannot read it with:

```javascript
response.headers.get('ETag')
```

Question:

What is missing?

Expected answer:

```http
Access-Control-Expose-Headers: ETag
```

---

## 33. Production Readiness Checklist

Before shipping CORS to production:

```text
[ ] CORS is enabled only for browser-facing APIs.
[ ] Production origins are explicitly listed.
[ ] Localhost/dev origins are not allowed in production.
[ ] Wildcard origin is not used with credentials.
[ ] Origin reflection is protected by strict allowlist.
[ ] Null origin is rejected unless specifically needed.
[ ] Allowed methods match real API methods.
[ ] Allowed headers match real client needs.
[ ] Exposed headers match real frontend needs.
[ ] Vary: Origin is set for dynamic origin responses.
[ ] Preflight OPTIONS works without requiring user authentication.
[ ] Actual requests still require authentication and authorization.
[ ] Cookie-backed state-changing requests have CSRF protection.
[ ] Error responses include CORS headers for allowed origins.
[ ] Gateway and application policies do not conflict.
[ ] CORS decisions are logged and measurable.
[ ] Negative tests cover malicious/disallowed origins.
[ ] Tenant/partner origins have approval and revoke process.
```

---

## 34. What Comes Next

Part 018 will cover:

```text
Rate Limiting, Quotas, and Abuse Control
```

This moves from browser-origin policy into backend resource protection:

1. rate limit vs quota vs concurrency limit,
2. identity dimension,
3. token bucket and sliding window,
4. distributed rate limiting,
5. `429 Too Many Requests`,
6. `Retry-After`,
7. tenant fairness,
8. gateway vs application enforcement,
9. Java implementation patterns,
10. observability and abuse detection.

CORS limits which browser origins may read responses. Rate limiting limits how much traffic a caller can consume. They solve different problems and are often both required.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-http-for-web-backend-perspective-part-016.md">⬅️ Part 016 — Cookies, Sessions, CSRF, and Browser-Coupled Backend</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-http-for-web-backend-perspective-part-018.md">Part 018 — Rate Limiting, Quotas, and Abuse Control ➡️</a>
</div>
