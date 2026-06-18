# learn-http-for-web-frontend-perspective-part-016.md

# Part 016 — Redirects: 301, 302, 303, 307, 308 and Browser Behavior

> Seri: `learn-http-for-web-frontend-perspective`  
> Target pembaca: Java software engineer yang ingin memahami HTTP dari perspektif browser/frontend secara top-tier.  
> Fokus bagian ini: memahami redirect sebagai control flow HTTP/browser, bukan sekadar status code `3xx`.

---

## 0. Posisi Part Ini dalam Seri

Sampai Part 015, kita sudah membangun fondasi:

1. browser sebagai HTTP client kompleks;
2. URL, origin, site, dan boundary browser;
3. request/response/header/body;
4. method semantics;
5. status code;
6. header sebagai control plane;
7. body/media type/encoding;
8. Fetch API;
9. request non-fetch;
10. CORS;
11. cookies, session, CSRF;
12. HTTP cache, ETag, conditional request, dan `304`.

Sekarang kita masuk ke redirect.

Redirect sering tampak sederhana:

```http
HTTP/1.1 302 Found
Location: /login
```

Tapi dari perspektif frontend, redirect adalah salah satu sumber bug paling membingungkan karena ia menyentuh banyak boundary sekaligus:

- HTTP semantics;
- browser navigation behavior;
- `fetch()` behavior;
- method rewriting;
- cookie/credential behavior;
- CORS;
- OAuth/OIDC login flow;
- cache;
- CDN/proxy;
- service worker;
- security risk seperti open redirect dan token leakage.

Redirect bukan hanya “pergi ke URL lain”. Redirect adalah **protocol-level control flow**.

---

## 1. Mental Model Utama: Redirect adalah Response yang Memerintahkan Client Membuat Request Baru

Redirect terjadi ketika server menjawab request dengan status `3xx` dan biasanya menyertakan header `Location`.

Contoh:

```http
GET /old-profile HTTP/1.1
Host: app.example.com
```

Server menjawab:

```http
HTTP/1.1 301 Moved Permanently
Location: /profile
```

Browser lalu membuat request baru:

```http
GET /profile HTTP/1.1
Host: app.example.com
```

Yang penting:

> Redirect bukan server “memindahkan” request lama ke endpoint baru. Redirect adalah server memberi tahu client untuk membuat request baru ke lokasi lain.

Konsekuensi:

- request kedua bisa punya method berbeda;
- request kedua bisa punya body berbeda atau tidak punya body;
- request kedua bisa punya credential behavior berbeda;
- request kedua bisa masuk origin berbeda;
- request kedua bisa memicu CORS rule baru;
- request kedua bisa punya cache behavior berbeda;
- request kedua bisa terlihat sebagai entry terpisah di Network tab;
- request kedua bisa gagal walaupun response redirect pertama sukses.

Ini sangat penting untuk frontend debugging.

---

## 2. Redirect Bukan Forward

Di banyak backend framework, engineer mengenal dua konsep:

1. redirect;
2. forward/internal dispatch.

Dalam HTTP browser, redirect berarti client melihat `3xx` lalu membuat request baru.

Internal forward terjadi di server tanpa client tahu.

Contoh internal forward konseptual:

```text
Browser -> GET /dashboard -> Server internally dispatches to /templates/dashboard.html -> 200 OK
```

Browser hanya melihat:

```http
HTTP/1.1 200 OK
Content-Type: text/html
```

Contoh redirect:

```text
Browser -> GET /dashboard -> 302 Location: /login -> Browser -> GET /login -> 200 OK
```

Browser melihat dua request.

Perbedaan ini penting untuk:

- DevTools Network;
- SEO;
- cache;
- method preservation;
- CORS;
- login flow;
- security;
- user-visible URL.

Rule praktis:

> Kalau browser URL berubah atau Network tab menunjukkan request baru akibat `3xx`, itu redirect. Kalau browser hanya menerima `200` dari URL yang sama, kemungkinan server-side forward/render.

---

## 3. Anatomy Redirect Response

Redirect response minimal biasanya punya:

```http
HTTP/1.1 302 Found
Location: /login
```

Elemen penting:

| Elemen | Fungsi |
|---|---|
| Status code `3xx` | Menandakan response adalah redirect atau redirect-related outcome |
| `Location` | Target URI/URL baru |
| Optional body | Kadang ada HTML fallback, biasanya tidak dipakai browser modern untuk auto-redirect |
| Cache headers | Menentukan apakah redirect boleh disimpan |
| Cookies | Redirect response bisa juga membawa `Set-Cookie` |
| Security headers | Tetap bisa relevan, terutama pada navigation response |

Contoh redirect login:

```http
HTTP/1.1 302 Found
Location: /dashboard
Set-Cookie: session=abc; Path=/; Secure; HttpOnly; SameSite=Lax
Cache-Control: no-store
```

Browser dapat menyimpan cookie dari response redirect, lalu memakai cookie itu pada request berikutnya ke `/dashboard`, selama cookie rules mengizinkan.

---

## 4. Relative vs Absolute `Location`

Header `Location` bisa absolute:

```http
Location: https://app.example.com/profile
```

Atau relative:

```http
Location: /profile
```

Atau relative terhadap current path:

```http
Location: ../profile
```

Untuk frontend engineer, bug sering terjadi ketika reverse proxy/gateway salah membangun absolute URL.

Contoh:

```http
Location: http://internal-service:8080/login
```

Di environment internal, ini mungkin masuk akal. Di browser user, ini gagal karena `internal-service` tidak resolvable.

Contoh lain:

```http
Location: http://app.example.com/login
```

Padahal production harus HTTPS:

```http
Location: https://app.example.com/login
```

Akibatnya:

- mixed content issue;
- cookie `Secure` tidak terkirim;
- browser upgrade behavior tergantung HSTS;
- security warning;
- redirect loop;
- CORS mismatch.

Rule praktis:

> Untuk aplikasi di balik proxy/gateway, pastikan server memahami external scheme/host lewat trusted forwarded headers seperti `X-Forwarded-Proto` atau `Forwarded`, bukan memakai internal host mentah.

---

## 5. Keluarga Status Code Redirect yang Paling Penting

Redirect status code yang paling sering muncul:

| Status | Nama | Permanent? | Method/body preserved? | Umum dipakai untuk |
|---:|---|---:|---:|---|
| 301 | Moved Permanently | Ya | Tidak selalu; historical clients bisa ubah POST ke GET | URL canonicalization, HTTP→HTTPS, SEO |
| 302 | Found | Tidak/default temporary | Tidak selalu; historical browser sering ubah POST ke GET | Login redirect, temporary move |
| 303 | See Other | Tidak | Tidak; follow-up harus GET/HEAD | POST-Redirect-GET |
| 307 | Temporary Redirect | Tidak | Ya | Temporary redirect untuk non-GET/API dengan method preserved |
| 308 | Permanent Redirect | Ya | Ya | Permanent move dengan method preserved |

Inilah inti redirect modern:

- `301/302` punya warisan historis: browser sering mengubah `POST` menjadi `GET`.
- `303` secara eksplisit mengarahkan follow-up menjadi `GET`.
- `307/308` menjaga method dan body.

---

## 6. Kenapa 301/302 Membingungkan: Legacy Browser Behavior

Secara desain modern, status code punya semantics. Tapi redirect adalah area yang dipengaruhi sejarah browser.

Dulu, banyak browser mengubah:

```http
POST /submit
```

Jika menerima:

```http
302 Found
Location: /thank-you
```

Menjadi:

```http
GET /thank-you
```

Perilaku ini menjadi umum dan akhirnya harus diakomodasi.

Karena itu, untuk POST form tradisional, pattern ini justru sering dipakai:

```text
POST /orders
-> 303 See Other Location: /orders/123
-> GET /orders/123
```

Dengan `303`, server menyatakan secara eksplisit:

> “Mutation sudah diterima; lihat representasi/result di URL lain dengan GET.”

Ini disebut **Post/Redirect/Get (PRG)** pattern.

---

## 7. 301 Moved Permanently

`301` berarti resource sudah pindah secara permanen.

Contoh:

```http
HTTP/1.1 301 Moved Permanently
Location: https://example.com/new-docs
```

Cocok untuk:

- migrasi URL lama ke URL baru;
- canonicalization trailing slash;
- canonical hostname;
- HTTP ke HTTPS;
- SEO-preserving redirects;
- dokumentasi/static pages.

Risiko:

- browser/cache/search engine bisa mengingat redirect;
- salah konfigurasi `301` bisa “lengket” dan sulit di-debug;
- untuk non-GET, method preservation tidak sekuat `308`;
- bisa menyebabkan request mutation berubah menjadi GET pada beberapa client/historical behavior.

Contoh aman:

```text
GET http://example.com/docs
-> 301 https://example.com/docs
```

Contoh berisiko:

```text
POST /api/v1/payment
-> 301 /api/v2/payment
```

Kenapa berisiko?

Karena client bisa mengubah follow-up menjadi `GET`, body hilang, atau behavior berbeda antar client.

Untuk API mutation permanen, lebih aman pakai `308` jika benar-benar harus redirect dan method/body harus dipertahankan.

---

## 8. 302 Found

`302` sering dipakai sebagai temporary redirect.

Contoh:

```http
HTTP/1.1 302 Found
Location: /login
```

Cocok untuk:

- unauthenticated navigation redirect ke login page;
- temporary maintenance routing;
- A/B routing tertentu;
- legacy app flow.

Tapi `302` harus hati-hati untuk API.

Contoh problem:

```text
fetch('/api/me')
-> 302 Location: /login
-> browser follows
-> 200 text/html login page
-> frontend tries response.json()
-> SyntaxError: Unexpected token '<'
```

Dari sisi user, kelihatannya “API JSON rusak”. Akar masalahnya: API endpoint mengembalikan HTML login page lewat redirect.

Untuk API, sering lebih baik:

```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json

{
  "code": "AUTH_REQUIRED",
  "message": "Authentication required"
}
```

Daripada:

```http
HTTP/1.1 302 Found
Location: /login
```

Rule penting:

> Redirect ke login cocok untuk browser navigation HTML. Untuk XHR/fetch API, lebih baik pakai status auth eksplisit seperti `401`/`403` dengan error body yang konsisten.

---

## 9. 303 See Other

`303` berarti client harus mengambil resource lain dengan `GET` atau `HEAD`.

Pattern klasik:

```text
POST /orders
-> 303 See Other Location: /orders/123
-> GET /orders/123
```

Ini berguna untuk:

- form submission;
- create operation yang setelah sukses menampilkan resource baru;
- menghindari duplicate form resubmission saat refresh;
- memisahkan mutation result dari representation page.

Contoh HTTP:

```http
POST /orders HTTP/1.1
Content-Type: application/json

{"sku":"A-001","quantity":2}
```

Response:

```http
HTTP/1.1 303 See Other
Location: /orders/ord_123
```

Browser/fetch follow-up:

```http
GET /orders/ord_123 HTTP/1.1
```

`303` adalah status code yang sangat “jujur” untuk mutation yang ingin mengarahkan user ke halaman/result lain.

Untuk SPA, Anda mungkin tidak selalu memakai HTTP redirect; sering mutation API menjawab:

```http
HTTP/1.1 201 Created
Location: /api/orders/ord_123
Content-Type: application/json

{
  "id": "ord_123",
  "status": "created"
}
```

Lalu frontend router melakukan navigation:

```js
router.push(`/orders/${order.id}`)
```

Keduanya valid, tapi boundary-nya berbeda:

- `303`: server mengontrol next location di protocol level;
- `201` + client navigation: frontend mengontrol UX flow.

---

## 10. 307 Temporary Redirect

`307` berarti redirect sementara dan method/body harus dipertahankan.

Contoh:

```http
HTTP/1.1 307 Temporary Redirect
Location: https://upload-region-2.example.com/files
```

Jika request awal:

```http
POST /files
Content-Type: application/octet-stream

<binary>
```

Follow-up tetap:

```http
POST /files
Content-Type: application/octet-stream

<binary>
```

Cocok untuk:

- temporary routing untuk API;
- regional failover;
- upload endpoint relocation;
- maintenance routing tanpa mengubah method;
- signed upload flow tertentu.

Tapi hati-hati:

- browser harus bisa replay body;
- stream body tertentu mungkin tidak reusable;
- redirect cross-origin bisa terkena CORS;
- credential behavior harus dipahami;
- large upload bisa dikirim ulang, mahal bagi user.

Rule praktis:

> Gunakan `307` ketika redirect bersifat sementara dan Anda benar-benar ingin follow-up request tetap sama secara method/body.

---

## 11. 308 Permanent Redirect

`308` adalah permanent redirect yang menjaga method/body.

Contoh:

```http
HTTP/1.1 308 Permanent Redirect
Location: /api/v2/payments
```

Jika request awal:

```http
POST /api/v1/payments
```

Follow-up tetap:

```http
POST /api/v2/payments
```

Cocok untuk:

- permanent API endpoint migration ketika method preservation penting;
- canonical API path dengan trailing slash policy;
- permanent upload endpoint move;
- non-GET permanent redirect.

Risiko:

- permanent redirect bisa di-cache;
- salah konfigurasi bisa bertahan lama;
- client/library lama mungkin tidak menangani `308` sebagus browser modern;
- tetap harus memperhatikan CORS/credentials.

Rule praktis:

> Untuk permanent redirect non-GET/API, `308` biasanya lebih tepat daripada `301` karena semantics method-preserving lebih jelas.

---

## 12. Quick Decision Table

| Situation | Recommended |
|---|---|
| HTTP ke HTTPS untuk website | `301` atau `308`, plus HSTS setelah yakin |
| URL page lama pindah permanen | `301` |
| API endpoint mutation pindah permanen | `308`, atau lebih baik client update endpoint tanpa redirect |
| Temporary page redirect | `302` atau `307`, tergantung method |
| Login redirect untuk browser navigation | `302` umum |
| Login failure untuk API/fetch | `401`/`403`, bukan redirect HTML |
| POST form sukses lalu tampilkan halaman result | `303` |
| Temporary API relocation dengan method/body preserved | `307` |
| Canonical trailing slash untuk GET page | `301`/`308`, tergantung policy |
| Prevent duplicate form resubmission | `303` PRG |
| OAuth authorization redirect | Biasanya `302` navigation flow |

---

## 13. Redirect Chain

Redirect chain terjadi ketika satu redirect diikuti redirect lain.

Contoh buruk:

```text
http://example.com
-> 301 https://example.com
-> 301 https://www.example.com
-> 302 https://www.example.com/home
-> 200
```

Setiap hop menambah latency.

Pada mobile network, satu round trip tambahan bisa terasa signifikan.

Dampak:

- lambat;
- TTFB efektif memburuk;
- SEO bisa terdampak;
- cache behavior makin sulit;
- DevTools waterfall makin panjang;
- cookie/auth flow lebih rentan salah;
- CORS redirect makin sulit dipahami.

Target ideal:

```text
http://example.com
-> 301 https://www.example.com/
-> 200
```

Lebih baik lagi kalau user langsung memakai canonical URL:

```text
https://www.example.com/
-> 200
```

Frontend engineer harus bisa membaca redirect chain di Network tab.

---

## 14. Redirect Loop

Redirect loop terjadi ketika URL saling mengarahkan tanpa akhir.

Contoh:

```text
/login -> /dashboard -> /login -> /dashboard -> ...
```

Penyebab umum:

- cookie tidak terkirim;
- SameSite salah;
- Secure cookie dipakai di HTTP local dev;
- domain cookie salah;
- backend menganggap user unauthenticated;
- frontend router menganggap user authenticated dari stale state;
- API gateway dan app punya rule redirect berbeda;
- trailing slash canonicalization conflict;
- HTTP/HTTPS redirect conflict di proxy;
- locale redirect conflict;
- service worker menyajikan versi lama.

Browser/fetch punya limit redirect. Jika limit tercapai, request akan gagal.

Diagnosis:

1. buka Network tab;
2. preserve log;
3. lihat chain status `3xx`;
4. cek setiap `Location`;
5. cek apakah cookie diset dan dikirim;
6. cek scheme/host/path;
7. cek apakah response berasal dari server, CDN, gateway, atau service worker;
8. cek apakah satu layer mengubah URL dan layer lain mengembalikan lagi.

---

## 15. Navigation Redirect vs Fetch Redirect

Ini salah satu boundary paling penting.

### 15.1 Navigation Redirect

Navigation terjadi saat browser memuat halaman:

- user mengetik URL;
- klik link;
- form submit normal;
- `window.location = ...`;
- server redirect page request.

Contoh:

```text
GET /dashboard
-> 302 /login
-> GET /login
-> 200 text/html
```

Browser akan menampilkan `/login`.

Untuk page navigation, redirect login biasanya wajar.

### 15.2 Fetch Redirect

Fetch terjadi dari JavaScript:

```js
const response = await fetch('/api/me', {
  credentials: 'include'
});
```

Jika server menjawab:

```http
HTTP/1.1 302 Found
Location: /login
```

Default `fetch` akan follow redirect.

Akhirnya JavaScript mungkin menerima:

```http
HTTP/1.1 200 OK
Content-Type: text/html

<!doctype html>...
```

Lalu kode ini gagal:

```js
const user = await response.json();
```

Error yang muncul:

```text
SyntaxError: Unexpected token '<', "<!doctype" is not valid JSON
```

Root cause bukan JSON parser. Root cause adalah redirect auth HTML untuk API request.

Rule arsitektural:

> Browser navigation boleh menerima redirect ke page. API request sebaiknya menerima status machine-readable.

---

## 16. `fetch()` Redirect Modes

`fetch()` punya opsi `redirect`:

```js
fetch('/api/me', {
  redirect: 'follow' // default
});
```

Nilainya:

| Mode | Behavior |
|---|---|
| `follow` | Ikuti redirect secara otomatis |
| `error` | Treat redirect sebagai error |
| `manual` | Jangan expose redirect normal; browser memberi filtered/opaque redirect response dalam banyak kasus |

Contoh:

```js
const response = await fetch('/api/me', {
  redirect: 'error'
});
```

Jika server mengembalikan `302`, promise bisa reject.

Tapi hati-hati dengan `manual`:

```js
const response = await fetch('/api/me', {
  redirect: 'manual'
});
```

Di browser, manual redirect tidak sama dengan server-side HTTP client seperti Java `HttpClient`. Untuk security, browser sering memberikan `opaqueredirect`, sehingga JavaScript tidak bebas membaca target `Location` terutama untuk cross-origin scenario.

Jangan mendesain flow SPA dengan asumsi frontend selalu bisa membaca `Location` dari redirect response.

Lebih baik untuk API:

```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json

{
  "code": "AUTH_REQUIRED",
  "loginUrl": "/login?next=/dashboard"
}
```

Lalu frontend memutuskan:

```js
if (error.code === 'AUTH_REQUIRED') {
  router.push(error.loginUrl);
}
```

---

## 17. Redirect dan Method Rewriting

Ini bug klasik.

Misal frontend melakukan:

```js
await fetch('/api/orders', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ sku: 'A-001' })
});
```

Server menjawab:

```http
HTTP/1.1 302 Found
Location: /api/orders/new-location
```

Browser bisa melakukan follow-up sebagai:

```http
GET /api/orders/new-location
```

Body hilang.

Jika server kedua mengharapkan `POST`, hasilnya bisa:

- `405 Method Not Allowed`;
- `404 Not Found`;
- HTML error page;
- mutation tidak terjadi;
- frontend error ambigu.

Dengan `307`:

```http
HTTP/1.1 307 Temporary Redirect
Location: /api/orders/new-location
```

Follow-up tetap:

```http
POST /api/orders/new-location
Content-Type: application/json

{"sku":"A-001"}
```

Dengan `303`:

```http
HTTP/1.1 303 See Other
Location: /orders/123
```

Follow-up menjadi:

```http
GET /orders/123
```

Tiga status ini punya intent berbeda:

| Original | Redirect | Follow-up intent |
|---|---|---|
| POST | 302 | Ambiguous/historical |
| POST | 303 | Lihat result dengan GET |
| POST | 307 | Ulang request yang sama sementara |
| POST | 308 | Ulang request yang sama permanen |

---

## 18. Redirect dan Request Body

Redirect dengan body punya masalah tambahan.

Body request mungkin:

- JSON string biasa;
- `FormData`;
- file upload;
- stream;
- generated body yang tidak bisa diputar ulang;
- body besar yang mahal dikirim ulang.

Jika redirect butuh replay body, browser harus bisa mengirim ulang body itu.

Untuk small JSON, biasanya mudah.

Untuk stream body, bisa gagal tergantung body source dan fetch algorithm.

Prinsip:

> Jangan jadikan redirect sebagai mekanisme rutin untuk mutation body besar kecuali Anda benar-benar memahami replay, CORS, credentials, dan user cost.

Untuk upload besar, desain yang lebih eksplisit sering lebih baik:

1. frontend minta upload target;
2. server memberi URL upload final;
3. frontend upload langsung ke URL final.

Contoh:

```http
POST /api/uploads/init
Content-Type: application/json

{"filename":"video.mp4"}
```

Response:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "uploadUrl": "https://upload-region-2.example.com/signed/abc",
  "method": "PUT",
  "headers": {
    "Content-Type": "video/mp4"
  }
}
```

Lalu frontend melakukan upload langsung, bukan mengandalkan redirect upload.

---

## 19. Redirect dan CORS

Redirect cross-origin bisa sangat membingungkan.

Contoh:

```js
await fetch('https://api.example.com/me', {
  mode: 'cors',
  credentials: 'include'
});
```

Response awal:

```http
HTTP/1.1 302 Found
Location: https://login.example.net/sso
```

Sekarang browser harus follow ke origin lain:

```text
https://login.example.net
```

Masalah potensial:

- CORS policy origin pertama berbeda dari origin kedua;
- credential policy berubah;
- cookies untuk domain login berbeda;
- redirect target mungkin tidak mengizinkan CORS;
- browser tidak boleh expose response tertentu ke JavaScript;
- preflight dan actual request bisa punya redirect behavior berbeda;
- API call akhirnya menjadi navigation-like auth flow yang tidak cocok untuk fetch.

Rule penting:

> CORS harus valid untuk final response yang ingin dibaca JavaScript, bukan hanya response awal.

Masalah umum:

```text
fetch('/api/me')
-> API gateway 302 ke IdP login page
-> IdP login page tidak mengizinkan CORS ke app origin
-> browser reports CORS error
```

Developer sering mengira “CORS API salah”. Padahal root cause-nya adalah API request diarahkan ke HTML login/IdP flow.

Solusi arsitektural:

- API endpoint mengembalikan `401` machine-readable;
- frontend melakukan top-level navigation ke login endpoint;
- BFF menangani OAuth callback;
- hindari memulai full OAuth authorization redirect dari XHR/fetch API response.

---

## 20. Redirect dan Credentials/Cookies

Redirect tidak otomatis berarti semua cookies ikut ke semua hop.

Cookie dikirim berdasarkan:

- target URL follow-up;
- cookie Domain;
- cookie Path;
- Secure;
- SameSite;
- third-party context;
- credentials mode pada fetch;
- browser privacy policy.

Contoh:

```js
fetch('https://api.example.com/me', {
  credentials: 'include'
});
```

Jika redirect ke:

```text
https://app.example.com/login
```

Cookie yang dikirim ke `app.example.com` belum tentu sama dengan cookie yang dikirim ke `api.example.com`.

Jika redirect ke cross-site:

```text
https://identity-provider.com/login
```

SameSite dan third-party cookie rules bisa mengubah behavior.

Untuk navigation OAuth, browser top-level navigation biasanya memang dipakai agar cookie IdP bekerja sesuai model browser.

Untuk fetch API, jangan berharap redirect ke IdP bisa bekerja seperti navigation penuh.

---

## 21. Redirect dan `Set-Cookie`

Redirect response boleh membawa `Set-Cookie`.

Contoh login callback:

```http
HTTP/1.1 302 Found
Location: /dashboard
Set-Cookie: session=abc; Path=/; Secure; HttpOnly; SameSite=Lax
Cache-Control: no-store
```

Browser akan memproses `Set-Cookie`, lalu follow ke `/dashboard`.

Flow:

```text
GET /auth/callback?code=...
-> 302 Set-Cookie session=abc; Location=/dashboard
-> GET /dashboard Cookie: session=abc
```

Ini pattern umum dan valid.

Bug umum:

- cookie tidak disimpan karena `Secure` di HTTP;
- cookie tidak dikirim karena `SameSite=None` tanpa `Secure`;
- domain cookie salah;
- path cookie terlalu sempit;
- response redirect cross-origin tidak memenuhi CORS/credentials ketika dipakai dari fetch;
- `Set-Cookie` tidak terlihat di JavaScript karena forbidden response header;
- DevTools menampilkan `Set-Cookie`, tapi application state tidak berubah karena browser menolak cookie.

Diagnosis:

1. lihat response `Set-Cookie`;
2. cek tab Issues di DevTools;
3. cek Application → Cookies;
4. cek apakah cookie disimpan;
5. cek request berikutnya membawa cookie atau tidak;
6. cek scheme/host/path/SameSite.

---

## 22. Redirect dan Cache

Redirect bisa di-cache.

Terutama:

- `301`;
- `308`;
- redirect dengan explicit cache headers.

Contoh:

```http
HTTP/1.1 301 Moved Permanently
Location: /new-path
Cache-Control: max-age=86400
```

Browser bisa mengingat bahwa `/old-path` harus ke `/new-path`.

Masalah:

- salah redirect permanen bisa bertahan;
- developer sudah memperbaiki server, tapi browser tetap redirect dari cache;
- QA sulit mereproduksi;
- DevTools “Disable cache” hanya saat DevTools terbuka;
- HSTS juga bisa terlihat seperti redirect HTTP→HTTPS, tapi sebenarnya upgrade policy browser.

Debugging:

- cek apakah status ditampilkan sebagai `from disk cache` atau browser internal;
- hard reload / clear site data;
- coba profile baru/incognito;
- cek cache headers response redirect;
- gunakan canonical URL langsung;
- cek CDN cache.

Rule:

> Jangan kirim `301/308` untuk rule yang belum stabil. Untuk eksperimen atau migration awal, pakai temporary redirect dulu.

---

## 23. Redirect dan HSTS

HSTS bukan redirect HTTP biasa.

Dengan HSTS, browser menyimpan policy:

> Untuk host ini, selalu gunakan HTTPS.

Setelah policy aktif, user yang mengetik:

```text
http://example.com
```

Browser bisa langsung upgrade ke:

```text
https://example.com
```

Tanpa request HTTP awal.

Di Network tab, ini bisa terlihat berbeda dari server-side `301`.

Common production setup:

1. HTTP endpoint mengembalikan `301` ke HTTPS;
2. HTTPS response mengirim `Strict-Transport-Security`;
3. browser berikutnya langsung memakai HTTPS.

Hati-hati:

- jangan aktifkan HSTS preload sembarangan;
- pastikan semua subdomain siap HTTPS jika memakai `includeSubDomains`;
- salah konfigurasi HSTS bisa memutus akses subdomain lama.

---

## 24. Redirect dan SPA Routing

SPA punya client-side router.

Contoh URL:

```text
https://app.example.com/orders/123
```

Server mungkin tidak punya file `/orders/123`. Server harus mengirim app shell:

```http
HTTP/1.1 200 OK
Content-Type: text/html

<div id="app"></div>
<script src="/assets/app.js"></script>
```

Lalu frontend router menampilkan page.

Ini bukan redirect.

Namun banyak konfigurasi salah memakai redirect:

```http
HTTP/1.1 302 Found
Location: /
```

Akibatnya:

- URL user berubah dari `/orders/123` ke `/`;
- deep link hilang;
- refresh page tidak preserve route;
- analytics kacau;
- back button aneh.

Untuk SPA fallback, biasanya yang benar:

```text
Request /orders/123
-> serve /index.html with 200
```

Bukan:

```text
Request /orders/123
-> 302 /
```

Namun ada pengecualian:

- canonical URL normalization;
- auth navigation redirect;
- locale redirect;
- moved route.

Rule:

> SPA fallback umumnya rewrite/internal fallback, bukan HTTP redirect.

---

## 25. Redirect dan OAuth/OIDC

OAuth/OIDC authorization code flow memang banyak memakai redirect.

Simplified flow:

```text
User opens /login
-> app redirects browser to IdP authorization endpoint
-> user authenticates at IdP
-> IdP redirects browser to app callback with code
-> app exchanges code server-side
-> app sets session cookie
-> app redirects to original page
```

Contoh:

```http
HTTP/1.1 302 Found
Location: https://idp.example.com/oauth2/authorize?client_id=...&redirect_uri=...
```

Callback:

```http
GET /auth/callback?code=abc&state=xyz
```

Response:

```http
HTTP/1.1 302 Found
Set-Cookie: session=...
Location: /dashboard
```

Hal penting untuk frontend:

- OAuth authorization redirect sebaiknya top-level navigation, bukan fetch;
- `state` harus divalidasi untuk CSRF/login CSRF protection;
- PKCE dipakai untuk public clients/browser-based flows;
- jangan taruh access token di URL fragment/query lalu bocor ke logs/referrer;
- callback harus menghindari open redirect pada `next` parameter;
- session cookie harus aman;
- setelah callback, redirect ke clean URL tanpa `code`.

Problem umum:

```js
await fetch('/login')
```

Jika `/login` mengembalikan redirect ke IdP, ini bukan cara ideal memulai OAuth flow. Gunakan navigation:

```js
window.location.assign('/login?next=/dashboard');
```

Karena login flow butuh browser navigation, cookie jar, IdP UI, dan top-level context.

---

## 26. Open Redirect

Open redirect terjadi ketika aplikasi menerima input user lalu menggunakannya sebagai target redirect tanpa validasi.

Contoh rentan:

```text
https://app.example.com/login?next=https://evil.example/phishing
```

Server:

```http
HTTP/1.1 302 Found
Location: https://evil.example/phishing
```

Kenapa bahaya?

- link awal terlihat berasal dari domain trusted;
- user percaya karena domain pertama benar;
- bisa dipakai phishing;
- bisa mencuri token/code jika flow auth salah;
- bisa bypass allowlist redirect_uri yang lemah;
- bisa dipakai chaining attack.

Contoh kode rentan konseptual:

```java
@GetMapping("/login/success")
public ResponseEntity<Void> success(@RequestParam String next) {
    return ResponseEntity.status(302)
        .location(URI.create(next))
        .build();
}
```

Lebih aman:

```java
private static final Set<String> ALLOWED_PATH_PREFIXES = Set.of(
    "/dashboard",
    "/orders",
    "/profile"
);

@GetMapping("/login/success")
public ResponseEntity<Void> success(@RequestParam(defaultValue = "/dashboard") String next) {
    String safeNext = normalizeAndValidateRelativePath(next);

    return ResponseEntity.status(302)
        .location(URI.create(safeNext))
        .build();
}
```

Validasi yang baik:

- hanya izinkan relative path internal;
- tolak absolute URL dari user input;
- normalize path sebelum validasi;
- tolak protocol-relative URL seperti `//evil.example`;
- tolak encoded bypass seperti `%2f%2fevil.example`;
- tolak backslash ambiguity;
- gunakan allowlist route/prefix;
- jangan hanya cek `startsWith("/")` secara naif tanpa normalisasi.

---

## 27. Protocol-Relative URL Trap

Ini sering lolos review.

```text
//evil.example/path
```

URL ini tidak punya scheme eksplisit, tapi browser dapat menafsirkannya sebagai:

```text
https://evil.example/path
```

Jika validasi hanya berkata “harus diawali slash”, maka `//evil.example` lolos.

Contoh buruk:

```java
if (next.startsWith("/")) {
    redirect(next);
}
```

`next = "//evil.example"` lolos.

Validasi lebih aman:

```text
allow only paths that start with exactly one slash and not two slashes
```

Tapi itu belum cukup. Anda juga harus handle:

- encoded slash;
- backslash;
- path normalization;
- control characters;
- unicode confusion;
- whitespace trimming.

Rule:

> Redirect target dari user input harus diperlakukan seperti untrusted URL parser problem, bukan string prefix problem.

---

## 28. Redirect dan Token Leakage

Jangan taruh token sensitif di URL redirect.

Buruk:

```http
Location: /dashboard?access_token=eyJhbGciOi...
```

Risiko:

- browser history;
- server logs;
- CDN logs;
- analytics;
- referer header;
- screenshot/support tools;
- copy-paste URL;
- third-party scripts;
- crash reports.

Lebih aman:

- set session cookie `HttpOnly; Secure; SameSite`;
- gunakan authorization code flow dengan PKCE;
- exchange token server-side bila memakai BFF;
- redirect ke clean URL;
- simpan transient state secara aman.

Untuk OAuth/OIDC modern, URL callback dengan `code` masih umum, tapi code harus:

- short-lived;
- single-use;
- ditukar dengan PKCE/state validation;
- tidak diperlakukan sebagai access token;
- segera dibersihkan dari URL setelah callback bila frontend menerima callback.

---

## 29. Redirect dan `Referer`

Ketika browser mengikuti redirect atau memuat resource setelah navigation, `Referer` bisa membocorkan URL sebelumnya tergantung `Referrer-Policy`.

Jika URL mengandung data sensitif:

```text
https://app.example.com/callback?code=abc&state=xyz
```

Lalu page memuat third-party resource, referer policy buruk bisa membocorkan URL.

Mitigasi:

- jangan taruh secrets di URL;
- gunakan `Referrer-Policy` yang tepat;
- redirect cepat ke clean URL;
- hindari third-party script di callback page;
- gunakan server-side exchange untuk auth.

Contoh header:

```http
Referrer-Policy: strict-origin-when-cross-origin
```

Atau lebih ketat untuk callback:

```http
Referrer-Policy: no-referrer
```

---

## 30. Redirect dan Preflight

CORS preflight memakai `OPTIONS`.

Contoh actual request:

```js
fetch('https://api.example.com/orders', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Request-Id': 'abc'
  },
  credentials: 'include',
  body: JSON.stringify({ sku: 'A-001' })
});
```

Browser mungkin kirim preflight:

```http
OPTIONS /orders HTTP/1.1
Origin: https://app.example.com
Access-Control-Request-Method: POST
Access-Control-Request-Headers: content-type,x-request-id
```

Jika preflight response redirect:

```http
HTTP/1.1 302 Found
Location: /login
```

Ini biasanya buruk.

Preflight seharusnya menjawab CORS permission, bukan auth redirect.

Correct-ish preflight response:

```http
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Credentials: true
Access-Control-Allow-Methods: POST
Access-Control-Allow-Headers: content-type,x-request-id
Access-Control-Max-Age: 600
Vary: Origin
```

Actual request kemudian boleh menentukan auth outcome:

```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Credentials: true

{"code":"AUTH_REQUIRED"}
```

Rule:

> Jangan redirect preflight ke login page.

---

## 31. Redirect dan Service Worker

Service worker bisa melihat/intercept request dan dapat menghasilkan redirect response.

Contoh:

```js
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  if (url.pathname === '/old') {
    event.respondWith(Response.redirect('/new', 302));
  }
});
```

Service worker juga bisa menyebabkan bug redirect:

- app lama masih redirect ke route lama;
- offline fallback redirect salah;
- cached redirect response stale;
- navigation preload dan service worker response berbeda;
- DevTools menunjukkan request served by service worker.

Diagnosis:

- cek kolom “ServiceWorker” di Network;
- bypass service worker;
- unregister service worker;
- clear storage;
- cek cache storage;
- bandingkan incognito/new profile.

Rule:

> Jika redirect behavior tidak masuk akal dan hanya terjadi di browser tertentu, service worker harus masuk daftar tersangka.

---

## 32. Redirect dan CDN/Gateway/Proxy

Redirect sering tidak berasal dari application code.

Sumber redirect bisa:

- CDN;
- load balancer;
- ingress;
- API gateway;
- reverse proxy;
- backend app;
- identity provider;
- service worker;
- browser HSTS;
- frontend router navigation.

Contoh CDN rule:

```text
/* -> force HTTPS
```

Contoh gateway rule:

```text
/api/* unauthenticated -> 302 /login
```

Contoh backend rule:

```text
/orders -> /orders/
```

Contoh conflict:

```text
CDN removes trailing slash
Backend adds trailing slash
```

Loop:

```text
/orders/ -> /orders -> /orders/ -> ...
```

Diagnosis harus menentukan layer mana yang menghasilkan `3xx`.

Clue:

- `Server` header;
- CDN-specific headers;
- response body/error page style;
- timing;
- logs;
- trace ID;
- gateway access logs;
- response headers inserted by proxy.

---

## 33. Redirect dan API Design

Untuk API, redirect harus dipakai lebih hati-hati daripada page.

Biasanya API client mengharapkan:

- status code meaningful;
- response body machine-readable;
- media type konsisten;
- no surprise HTML;
- no surprise method rewriting;
- observability jelas.

API redirect valid untuk beberapa kasus:

1. object download URL;
2. signed URL;
3. regional endpoint;
4. resource canonicalization;
5. long-running job result see-other;
6. protocol-level resource move.

Tapi untuk auth API, biasanya lebih baik tidak redirect.

Buruk:

```http
GET /api/me
-> 302 /login
-> 200 text/html
```

Lebih baik:

```http
GET /api/me
-> 401 application/json
```

Buruk:

```http
POST /api/orders
-> 302 /api/orders/123
```

Lebih jelas:

```http
POST /api/orders
-> 201 Created
Location: /api/orders/123
Content-Type: application/json

{"id":"123"}
```

Atau:

```http
POST /orders-form
-> 303 See Other
Location: /orders/123
```

Boundary:

- HTML form/page flow: redirect natural;
- JSON API flow: explicit status/body usually better.

---

## 34. Redirect dan File Download

Pattern umum:

```text
GET /api/reports/123/download
-> 302 https://storage.example.com/signed-url
-> 200 application/pdf
```

Ini bisa valid.

Tapi frontend harus memahami:

- final URL mungkin cross-origin;
- CORS diperlukan jika JavaScript ingin membaca body;
- CORS tidak diperlukan jika browser navigation/download langsung;
- `Content-Disposition` pada final response menentukan filename;
- signed URL bisa expire;
- cookies mungkin tidak dikirim ke storage host;
- authorization harus sudah ditransfer ke signature/token URL.

Dua model:

### Model A — Browser navigation download

```js
window.location.assign('/api/reports/123/download');
```

Browser follow redirect dan download. JS tidak membaca body.

### Model B — Fetch blob download

```js
const response = await fetch('/api/reports/123/download', {
  credentials: 'include'
});
const blob = await response.blob();
```

Jika redirect final cross-origin, final response harus CORS-readable.

Rule:

> Kalau JavaScript perlu membaca response, CORS final destination matters. Kalau browser hanya navigasi/download, modelnya berbeda.

---

## 35. Redirect dan SEO / Canonical URL

Untuk frontend-heavy apps, SEO mungkin tetap relevan pada public pages.

Redirect dipakai untuk:

- canonical host;
- canonical scheme;
- trailing slash policy;
- old URL migration;
- locale path;
- slug update.

Contoh:

```text
http://example.com/product/123 -> https://www.example.com/products/nice-slug
```

Best practice umum:

- permanent move: `301`/`308`;
- temporary experiment: `302`/`307`;
- minimize chain;
- avoid redirecting everything to homepage;
- preserve meaningful path;
- update internal links ke final URL;
- ensure sitemap uses canonical URLs.

Untuk SPA, jangan mengandalkan client-side router saja untuk canonical public URL jika SEO penting. Server/CDN harus punya redirect/canonical strategy yang benar.

---

## 36. Debugging Redirect di DevTools

Checklist praktis:

### 36.1 Setup

1. Open DevTools → Network.
2. Enable Preserve log.
3. Disable cache saat debugging cache-related redirect.
4. Clear site data jika curiga permanent redirect/HSTS/cookie.
5. Reproduce dari fresh tab.

### 36.2 Baca Chain

Untuk setiap request:

- URL;
- status;
- method;
- `Location`;
- request headers;
- response headers;
- cookies sent;
- cookies set/blocked;
- initiator;
- timing;
- scheme/host/port;
- service worker involvement.

### 36.3 Pertanyaan Diagnosis

1. Redirect berasal dari layer mana?
2. Apakah redirect permanent atau temporary?
3. Apakah method berubah?
4. Apakah body hilang?
5. Apakah target same-origin atau cross-origin?
6. Apakah CORS final response valid?
7. Apakah cookie disimpan pada redirect response?
8. Apakah cookie dikirim pada follow-up request?
9. Apakah redirect di-cache?
10. Apakah service worker ikut campur?
11. Apakah final response media type sesuai ekspektasi frontend?
12. Apakah API menerima HTML login page?

---

## 37. Common Bugs dan Root Cause

### Bug 1 — `response.json()` gagal dengan `Unexpected token '<'`

Symptom:

```text
SyntaxError: Unexpected token '<'
```

Kemungkinan chain:

```text
GET /api/me
-> 302 /login
-> 200 text/html
```

Root cause:

- API auth redirect ke HTML login page.

Fix:

- API return `401 application/json`;
- frontend navigate ke login explicitly;
- server bedakan request HTML navigation vs API request.

---

### Bug 2 — POST berubah jadi GET

Symptom:

```text
POST /api/orders -> 302 -> GET /api/orders/new
```

Root cause:

- memakai `302` untuk mutation redirect.

Fix:

- gunakan `303` jika memang ingin GET result;
- gunakan `307/308` jika ingin preserve method/body;
- lebih baik ubah client endpoint jika API migration.

---

### Bug 3 — Redirect loop login

Symptom:

```text
/dashboard -> /login -> /dashboard -> /login
```

Root cause candidates:

- cookie tidak tersimpan;
- SameSite/Secure/domain/path salah;
- frontend stale auth state;
- backend session invalid;
- gateway dan app tidak sepakat auth;
- callback redirect ke protected page sebelum session committed.

Fix:

- inspect cookie store;
- inspect request cookie;
- align auth state machine;
- avoid client-side “logged in” assumption without `/me` validation.

---

### Bug 4 — CORS error setelah redirect ke IdP

Symptom:

```text
Access to fetch at 'https://idp.example.com/login' from origin 'https://app.example.com' has been blocked by CORS policy
```

Root cause:

- API request diarahkan ke IdP login page;
- full login flow dicoba lewat fetch.

Fix:

- API return `401`;
- frontend top-level navigate to `/login`;
- BFF/IdP flow via browser navigation.

---

### Bug 5 — Browser tetap redirect setelah server diperbaiki

Symptom:

- server config sudah berubah;
- browser masih redirect.

Root cause:

- cached `301/308`;
- HSTS;
- service worker;
- CDN cache;
- DNS/proxy environment.

Fix:

- clear site data;
- test new profile;
- check HSTS;
- purge CDN;
- avoid premature permanent redirect during rollout.

---

### Bug 6 — Deep link SPA berubah ke homepage

Symptom:

```text
/orders/123 -> 302 /
```

Root cause:

- server uses redirect instead of SPA fallback rewrite.

Fix:

- configure server/CDN to serve `index.html` with `200` for app routes;
- reserve redirects for actual canonicalization/auth.

---

## 38. Java/Spring-Oriented Notes

Sebagai Java engineer, Anda mungkin sering melihat pattern seperti:

```java
return "redirect:/login";
```

Atau:

```java
response.sendRedirect("/login");
```

Ini cocok untuk MVC/page navigation.

Tapi untuk REST/API controller, hati-hati.

### 38.1 MVC Login Redirect

```java
@GetMapping("/dashboard")
public String dashboard() {
    return "dashboard";
}
```

Jika unauthenticated, security layer redirect ke login page. Ini wajar untuk web MVC.

### 38.2 API Auth Failure

Untuk API:

```java
@GetMapping("/api/me")
public UserDto me(Authentication authentication) {
    ...
}
```

Jika unauthenticated, lebih baik response:

```http
401 Unauthorized
Content-Type: application/json
```

Bukan:

```http
302 Location: /login
```

Di Spring Security, biasanya perlu konfigurasi berbeda untuk:

- HTML pages;
- `/api/**` endpoints;
- AJAX/fetch requests;
- OAuth login routes.

Konsep:

```text
/api/** unauthenticated -> 401 JSON
/page unauthenticated -> 302 /login
```

Boundary ini harus eksplisit.

---

## 39. Design Pattern: Separate Page Flow and API Flow

Arsitektur yang sehat sering memisahkan:

### Page/navigation flow

```text
GET /dashboard
-> if unauthenticated: 302 /login?next=/dashboard
-> if authenticated: 200 text/html
```

### API flow

```text
GET /api/me
-> if unauthenticated: 401 application/json
-> if authenticated: 200 application/json
```

Frontend:

```js
async function getMe() {
  const response = await fetch('/api/me', {
    credentials: 'include',
    headers: { 'Accept': 'application/json' }
  });

  if (response.status === 401) {
    return { type: 'anonymous' };
  }

  if (!response.ok) {
    throw new Error(`Unexpected HTTP ${response.status}`);
  }

  return { type: 'authenticated', user: await response.json() };
}
```

Login navigation:

```js
function login(next = window.location.pathname + window.location.search) {
  const safeNext = encodeURIComponent(next);
  window.location.assign(`/login?next=${safeNext}`);
}
```

Server must validate `next`.

---

## 40. Redirect Response Body: Should You Care?

Redirect response may contain a body:

```http
HTTP/1.1 302 Found
Location: /new
Content-Type: text/html

<a href="/new">Found</a>
```

Browser normally follows redirect automatically and user does not see body.

But body can matter for:

- old clients;
- debugging;
- non-browser clients;
- `redirect: manual` in some environments;
- accessibility fallback in ancient contexts.

For modern frontend apps, focus more on `Location`, status, headers, cache, and follow-up behavior.

---

## 41. Redirect and Observability

Redirect can hide root cause if observability only tracks final response.

Example:

```text
GET /api/me -> 302 /login -> 200 login HTML
```

If frontend only logs final status `200`, it misses auth failure.

Better frontend client should capture:

- `response.redirected`;
- `response.url` final URL;
- expected content type;
- status code;
- trace ID if exposed;
- error classification.

Example:

```js
async function requestJson(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.headers || {})
    }
  });

  const contentType = response.headers.get('content-type') || '';

  if (response.redirected) {
    console.warn('Request was redirected', {
      originalUrl: url,
      finalUrl: response.url,
      status: response.status,
      contentType
    });
  }

  if (!contentType.includes('application/json')) {
    throw new Error(`Expected JSON but got ${contentType || 'unknown content type'}`);
  }

  return response.json();
}
```

Caution:

- `response.url` may reveal final URL;
- do not log secrets;
- logging `Location` may be unavailable in browser manual redirects.

---

## 42. Redirect and Content-Type Mismatch

A robust frontend HTTP client should not blindly parse JSON just because the request was intended as API.

Bad:

```js
const data = await response.json();
```

Better:

```js
const contentType = response.headers.get('content-type') || '';

if (!contentType.includes('application/json')) {
  const text = await response.text();
  throw new Error(`Expected JSON, got ${contentType}. Body starts with: ${text.slice(0, 80)}`);
}

const data = await response.json();
```

In production, avoid logging body if it may contain sensitive HTML/user data. But during debugging, content-type mismatch is often the clue that redirect to login/error page happened.

---

## 43. Redirect and Relative URL Construction in Frontend

Frontend code sometimes constructs URLs that trigger unnecessary redirect.

Example:

```js
fetch('/api/users/')
```

But server canonical endpoint is:

```text
/api/users
```

Server responds:

```http
301 Location: /api/users
```

Every request pays redirect unless cache handles it.

Worse for mutation:

```js
fetch('/api/orders/', { method: 'POST', body })
```

Server redirects to `/api/orders`, method may change depending status.

Rule:

> API client should use canonical endpoints exactly. Do not rely on redirect normalization for application calls.

For generated clients/OpenAPI, canonical path consistency matters.

---

## 44. Redirect and Trailing Slash Policy

Trailing slash redirects are common:

```text
/docs -> /docs/
```

or:

```text
/api/users/ -> /api/users
```

For static pages, this may be fine.

For API, be careful.

Recommended:

- choose one convention;
- document it;
- generate clients consistently;
- avoid redirecting non-GET mutation due to slash mismatch;
- test both with method/body if server normalizes.

Bad pattern:

```text
POST /api/orders/ -> 301 /api/orders -> GET /api/orders
```

Catastrophic if mutation body is lost.

---

## 45. Redirect and Localization

Some apps redirect based on language:

```text
GET /
Accept-Language: id-ID,id;q=0.9,en;q=0.8
-> 302 /id/
```

This can be valid.

Risks:

- cache poisoning if `Vary: Accept-Language` missing;
- redirect loop if locale cookie conflicts with URL;
- user cannot manually choose locale;
- crawler behavior weird;
- app shell and API locale mismatch.

Better model:

- choose canonical locale URL;
- store user preference deliberately;
- include correct `Vary` if response depends on headers;
- avoid redirecting every visit if locale already in URL;
- allow explicit override.

---

## 46. Redirect and Maintenance Mode

Maintenance mode often uses redirect:

```text
GET /dashboard -> 302 /maintenance
```

But API should not necessarily redirect:

```text
GET /api/orders -> 503 Service Unavailable
Retry-After: 120
Content-Type: application/json
```

Why?

Frontend API client can interpret:

- system unavailable;
- retry later;
- show banner;
- stop background polling.

If API returns HTML maintenance page with `200`, frontend breaks.

Rule:

> Page traffic may redirect to maintenance page. API traffic should return machine-readable `503` with retry semantics.

---

## 47. Redirect and Rate Limiting

Do not redirect API clients to a rate-limit page.

Bad:

```http
HTTP/1.1 302 Found
Location: /too-many-requests
```

Better:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 60
Content-Type: application/json

{
  "code": "RATE_LIMITED",
  "retryAfterSeconds": 60
}
```

Redirect is for resource location/control flow, not for every application state.

---

## 48. Redirect and Authorization

Differentiate:

- unauthenticated: user identity missing;
- unauthorized: user identity known but lacks permission.

Page navigation:

```text
Unauthenticated -> 302 /login
Unauthorized -> 403 page
```

API:

```text
Unauthenticated -> 401 JSON
Unauthorized -> 403 JSON
```

Avoid:

```text
Unauthorized -> 302 /login
```

This can cause bad UX:

- user is logged in but sees login page;
- frontend clears session incorrectly;
- audit/observability loses authorization signal.

---

## 49. Redirect and Browser History

Redirect affects history differently depending how navigation happens.

Common cases:

- server redirect during navigation often results in final URL in history;
- JS `location.assign()` adds history entry;
- JS `location.replace()` replaces current entry;
- frontend router push/replace has analogous semantics.

For login flow:

```js
window.location.assign('/login?next=/dashboard');
```

After successful login, server may redirect to `/dashboard`.

For cleanup after callback:

```js
window.history.replaceState(null, '', '/dashboard');
```

Or server:

```http
302 Location: /dashboard
```

Use replace semantics when you do not want user Back button returning to callback/transient URL.

---

## 50. Redirect and Security Headers

Security headers still matter around redirect flows.

Examples:

### Login/callback redirects

```http
Cache-Control: no-store
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
```

### HTTPS canonical response

```http
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

### Prevent framing login pages

```http
Content-Security-Policy: frame-ancestors 'none'
```

Redirect response itself may not render content, but the flow around it is security-sensitive.

---

## 51. Decision Framework

When you see or design a redirect, ask:

### 51.1 Intent

- Is this permanent or temporary?
- Is this page navigation or API request?
- Is this after mutation?
- Is this auth flow?
- Is this canonicalization?
- Is this operational failover?

### 51.2 Method/Body

- Should method/body be preserved?
- Is request body replayable?
- Is body large/streaming?
- Could POST accidentally become GET?

### 51.3 Browser Policy

- Is target same-origin?
- Is target same-site?
- Does CORS need to pass?
- Are credentials included?
- Are cookies valid for target?
- Is SameSite relevant?

### 51.4 Security

- Is target derived from user input?
- Is it normalized and allowlisted?
- Could token leak via URL/Referer?
- Is this OAuth-related?
- Could it be phishing/open redirect?

### 51.5 Caching

- Could browser/CDN cache this redirect?
- Is permanent redirect safe now?
- Do we need `Cache-Control`?
- How do we roll back?

### 51.6 Observability

- Can we see the whole chain?
- Do logs correlate redirect hops?
- Does frontend detect unexpected redirected API response?
- Is final content-type what client expects?

---

## 52. Recommended Patterns

### 52.1 Page Auth

```text
GET /dashboard
if anonymous -> 302 /login?next=/dashboard
if authenticated -> 200 text/html
```

### 52.2 API Auth

```text
GET /api/me
if anonymous -> 401 application/json
if authenticated -> 200 application/json
```

### 52.3 Form Success

```text
POST /orders
-> 303 /orders/123
-> GET /orders/123
```

### 52.4 SPA Mutation Success

```text
POST /api/orders
-> 201 Created
Location: /api/orders/123
{"id":"123"}
```

Frontend routes itself.

### 52.5 API Permanent Migration

Prefer updating clients.

If redirect unavoidable:

```text
POST /api/v1/resource
-> 308 /api/v2/resource
```

### 52.6 Maintenance

Page:

```text
GET /dashboard -> 302 /maintenance
```

API:

```text
GET /api/orders -> 503 JSON + Retry-After
```

### 52.7 Login Callback

```text
GET /auth/callback?code=...&state=...
-> validate
-> Set-Cookie session=...
-> 302 /original-path
```

Validate `original-path` strictly.

---

## 53. Anti-Patterns

### Anti-pattern 1 — API redirecting to HTML login

```text
/api/me -> 302 /login -> 200 text/html
```

Replace with:

```text
/api/me -> 401 JSON
```

---

### Anti-pattern 2 — User-controlled absolute redirect

```text
/login?next=https://evil.example
```

Replace with:

```text
/login?next=/dashboard
```

Strictly validate relative internal paths.

---

### Anti-pattern 3 — Permanent redirect during uncertain rollout

```text
301 /old-api -> /new-api
```

If rollout uncertain, use temporary redirect or update clients directly.

---

### Anti-pattern 4 — Slash redirect on mutation endpoint

```text
POST /orders/ -> 301 /orders
```

Replace with canonical client paths and server route handling that does not break method/body.

---

### Anti-pattern 5 — OAuth via fetch

```js
await fetch('/login')
```

Replace with:

```js
window.location.assign('/login')
```

when starting top-level browser auth flow.

---

### Anti-pattern 6 — Redirect as generic error handling

```text
/api/orders -> 302 /error
```

Replace with proper status:

```text
400/401/403/409/422/429/500/503 + JSON error envelope
```

---

## 54. Exercises

### Exercise 1 — Identify Method Behavior

For each case, determine follow-up method:

```text
POST /submit -> 303 /result
POST /submit -> 307 /new-submit
POST /submit -> 308 /new-submit
POST /submit -> 302 /result
```

Expected reasoning:

- `303`: follow-up GET;
- `307`: follow-up POST;
- `308`: follow-up POST;
- `302`: historically often GET; avoid ambiguity for mutation semantics.

---

### Exercise 2 — Diagnose JSON Parse Error

Frontend code:

```js
const response = await fetch('/api/me', { credentials: 'include' });
const me = await response.json();
```

Error:

```text
Unexpected token '<'
```

Network:

```text
/api/me -> 302 /login
/login -> 200 text/html
```

Answer:

- API is redirecting to HTML login;
- return `401 JSON` for API;
- use top-level navigation for login.

---

### Exercise 3 — Secure `next` Redirect

Given:

```text
/login?next=//evil.example
```

What should happen?

Answer:

- reject it;
- default to safe internal path;
- log validation failure if useful;
- do not redirect to user-controlled absolute/protocol-relative URL.

---

### Exercise 4 — CDN Redirect Chain

Given:

```text
http://example.com/products/123
-> https://example.com/products/123
-> https://www.example.com/products/123
-> https://www.example.com/product/123
-> 200
```

Improve it.

Answer:

- canonicalize in one hop where possible;
- update internal links;
- use final canonical URL in sitemap/app;
- avoid chain in critical path.

---

### Exercise 5 — Choose Status

You submit form:

```text
POST /profile/update
```

After success, user should see:

```text
/profile
```

Choose status.

Answer:

```text
303 See Other
Location: /profile
```

Because follow-up should be GET and refresh should not resubmit POST.

---

## 55. Summary

Redirect is protocol-level control flow.

The key insights:

1. Redirect means the client makes a new request.
2. `301/302` carry historical method-rewriting ambiguity.
3. `303` explicitly converts post-mutation flow to GET.
4. `307/308` preserve method and body.
5. Navigation redirects and fetch redirects have different UX/security implications.
6. API auth should usually return `401/403`, not HTML login redirects.
7. CORS must work for the final response JavaScript wants to read.
8. Redirect can set cookies, but cookie rules still decide storage/sending.
9. Permanent redirects can be cached and become hard to undo.
10. OAuth uses redirect as top-level browser flow, not normal API fetch flow.
11. Open redirect is a serious security bug, especially around login and OAuth.
12. SPA fallback is usually rewrite/serve `index.html`, not redirect to `/`.
13. Redirect chain and loop are performance and reliability problems.
14. DevTools Network with Preserve log is your primary diagnostic tool.

Top-tier frontend engineers do not treat redirect as “just 302”. They ask:

- Who initiated the request?
- Is this navigation or API?
- What method/body should survive?
- Which origin/site is next?
- Which cookies are valid?
- Does CORS allow final read?
- Is target trusted?
- Is redirect cacheable?
- What will the user see?
- What will observability record?

That is the real mental model.

---

## 56. Referensi

- RFC 9110 — HTTP Semantics: redirection status codes, `Location`, method semantics.
- WHATWG Fetch Standard — fetch redirect handling, redirect count, method rewriting, redirect modes, CORS interaction.
- MDN Web Docs — Redirections in HTTP, individual status code references for `301`, `302`, `303`, `307`, `308`.
- OWASP Unvalidated Redirects and Forwards Cheat Sheet — open redirect risks and mitigation.
- MDN Fetch API — `RequestInit.redirect`, `Response.redirected`, response URL behavior.

---

## 57. Status Seri

```text
Part 016 selesai.
Seri belum selesai.
Lanjut ke Part 017: Content Negotiation, Localization, Compression, and Variants.
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-http-for-web-frontend-perspective-part-015.md">⬅️ Part 015 — HTTP Caching Part 2: ETag, Last-Modified, Revalidation, and 304</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-http-for-web-frontend-perspective-part-017.md">Part 017 — Content Negotiation, Localization, Compression, and Variants ➡️</a>
</div>
