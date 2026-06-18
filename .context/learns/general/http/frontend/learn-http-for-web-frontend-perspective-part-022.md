# learn-http-for-web-frontend-perspective-part-022.md

# Part 022 — Browser Isolation Policies: CORP, COEP, COOP, CORS, and Fetch Metadata

> Seri: `learn-http-for-web-frontend-perspective`  
> Bagian: `022 / 035`  
> Fokus: memahami kebijakan isolasi browser modern sebagai lapisan keamanan di atas HTTP, terutama ketika aplikasi frontend berinteraksi dengan origin lain, iframe, CDN asset, third-party script, API, dan fitur browser sensitif seperti `SharedArrayBuffer`.

---

## 0. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, Anda harus bisa:

1. membedakan **CORS**, **CORP**, **COEP**, **COOP**, dan **Fetch Metadata** tanpa mencampuradukkan fungsi masing-masing;
2. menjelaskan kenapa resource terlihat “ada di Network tab” tetapi tetap diblok oleh browser;
3. mendesain policy untuk aplikasi frontend yang memakai CDN asset, API lintas origin, iframe, analytics, font, image, worker, dan third-party script;
4. memahami apa itu **cross-origin isolation** dan kenapa ia dibutuhkan untuk fitur tertentu;
5. membaca failure mode seperti:
   - image/font/script blocked;
   - iframe tidak bisa dimuat;
   - `SharedArrayBuffer is not defined`;
   - `Cross-Origin-Embedder-Policy` violation;
   - popup/window opener behavior berubah;
   - request ditolak server berdasarkan `Sec-Fetch-*`;
6. membuat rollout strategy yang aman untuk security headers modern tanpa merusak production traffic.

---

## 1. Masalah Besar yang Sering Disalahpahami

Banyak engineer melihat semua error cross-origin sebagai “CORS error”. Ini salah.

Di browser modern, ada beberapa lapisan yang berbeda:

```text
HTTP Semantics
  ↓
Fetch algorithm
  ↓
Same-Origin Policy
  ↓
CORS
  ↓
Embedding / isolation policies
  ↓
Document browsing-context policy
  ↓
Server-side request classification with Fetch Metadata
```

Ketika request gagal, penyebabnya bisa berada di salah satu lapisan ini.

Contoh:

```text
GET https://cdn.example.net/app.wasm
```

Response mungkin:

```http
HTTP/1.1 200 OK
Content-Type: application/wasm
```

Tetapi browser masih bisa memblok resource karena document utama memakai:

```http
Cross-Origin-Embedder-Policy: require-corp
```

dan response WASM tidak mengirim:

```http
Cross-Origin-Resource-Policy: cross-origin
```

atau tidak dimuat lewat CORS.

Jadi status HTTP `200` tidak berarti resource boleh dipakai browser.

---

## 2. Mental Model: “Can Fetch”, “Can Read”, “Can Embed”, “Can Share Context”

Untuk memahami topik ini, pisahkan pertanyaan menjadi empat kategori.

### 2.1 Can Fetch?

Apakah browser boleh membuat request?

Dipengaruhi oleh:

- URL scheme;
- mixed content;
- CSP `connect-src`, `img-src`, `script-src`, dll;
- Fetch mode;
- CORS preflight;
- service worker;
- browser privacy policy;
- network availability.

### 2.2 Can Read?

Apakah JavaScript boleh membaca isi response?

Dipengaruhi oleh:

- same-origin policy;
- CORS;
- response type (`basic`, `cors`, `opaque`, `opaqueredirect`);
- exposed headers;
- credentials mode;
- redirect behavior.

### 2.3 Can Embed?

Apakah document boleh memakai resource cross-origin sebagai subresource?

Dipengaruhi oleh:

- CORP;
- COEP;
- CORS;
- CSP;
- MIME type;
- `X-Content-Type-Options: nosniff`;
- iframe policy;
- sandbox;
- permissions policy.

### 2.4 Can Share Context?

Apakah document boleh berbagi browsing context group dengan document lain, seperti popup, opener, dan cross-window references?

Dipengaruhi oleh:

- COOP;
- origin relationship;
- navigation;
- popup behavior;
- cross-origin isolation requirement.

Model ringkas:

```text
CORS  → bolehkah JS membaca response lintas origin?
CORP  → bolehkah resource ini di-embed oleh origin lain?
COEP  → document ini mensyaratkan subresource cross-origin harus explicitly allowed?
COOP  → document ini dipisahkan dari cross-origin opener/window context?
Fetch Metadata → server diberi sinyal konteks request agar bisa menolak request mencurigakan.
```

---

## 3. Recap Singkat: Origin dan Cross-Origin

Origin adalah kombinasi:

```text
scheme + host + port
```

Contoh:

```text
https://app.example.com
https://api.example.com
```

Keduanya beda origin karena host berbeda.

```text
https://app.example.com
http://app.example.com
```

Beda origin karena scheme berbeda.

```text
https://app.example.com
https://app.example.com:8443
```

Beda origin karena port berbeda.

Beberapa policy memakai konsep origin. Beberapa memakai site. Fetch Metadata punya nilai seperti:

```text
same-origin
same-site
cross-site
none
```

Jangan menyamakan origin dan site.

---

## 4. Same-Origin Policy: Baseline Protection

Same-Origin Policy adalah aturan dasar browser: script dari satu origin tidak bebas membaca data dari origin lain.

Tanpa aturan ini, situs jahat bisa melakukan:

```js
fetch("https://bank.example.com/account")
  .then(r => r.text())
  .then(data => sendToAttacker(data));
```

Jika user sedang login di `bank.example.com`, cookie bank mungkin ikut terkirim. Same-Origin Policy mencegah script situs jahat membaca response bank.

Namun, SOP tidak berarti browser tidak bisa membuat request sama sekali. Browser tetap bisa memuat banyak subresource lintas origin:

```html
<img src="https://cdn.example.net/logo.png">
<script src="https://cdn.example.net/lib.js"></script>
<link rel="stylesheet" href="https://cdn.example.net/app.css">
```

Di sinilah CORS, CORP, COEP, dan CSP menjadi penting.

---

## 5. CORS: Membuka Hak Baca untuk JavaScript

CORS menjawab pertanyaan:

> “Bolehkah JavaScript dari origin A membaca response dari origin B?”

Contoh:

```js
fetch("https://api.example.com/me", {
  credentials: "include"
});
```

Browser akan mengirim request dari origin frontend, misalnya:

```http
Origin: https://app.example.com
```

Agar JS boleh membaca response, server API perlu mengirim response header yang sesuai:

```http
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Credentials: true
```

CORS bukan mekanisme utama untuk melindungi server dari request. CORS terutama melindungi browser user agar script asing tidak bisa membaca response yang tidak diizinkan.

### 5.1 CORS Tidak Sama dengan CORP

CORS:

```text
server berkata: origin ini boleh membaca response via browser JS
```

CORP:

```text
resource berkata: siapa yang boleh embed/load resource ini dalam context tertentu
```

---

## 6. CORP — Cross-Origin-Resource-Policy

CORP adalah response header yang dipasang pada resource.

Ia menjawab:

> “Bolehkah resource ini digunakan oleh document dari origin/site lain?”

Header:

```http
Cross-Origin-Resource-Policy: same-origin
```

Nilai umum:

```text
same-origin
same-site
cross-origin
```

### 6.1 `same-origin`

Resource hanya boleh digunakan oleh document dari origin yang sama.

```http
Cross-Origin-Resource-Policy: same-origin
```

Cocok untuk:

- API response sensitif;
- private image;
- user avatar private;
- export file;
- resource yang tidak boleh di-embed situs lain.

### 6.2 `same-site`

Resource boleh digunakan oleh document dari site yang sama.

Misal:

```text
https://app.example.com
https://static.example.com
```

Keduanya bisa dianggap same-site jika masih di bawah registrable domain yang sama dan scheme sesuai.

```http
Cross-Origin-Resource-Policy: same-site
```

Cocok untuk:

- asset internal lintas subdomain;
- image/font internal;
- resource antar aplikasi dalam satu organisasi/domain.

### 6.3 `cross-origin`

Resource boleh digunakan lintas origin.

```http
Cross-Origin-Resource-Policy: cross-origin
```

Cocok untuk:

- public CDN asset;
- public image;
- open font asset;
- public wasm/script yang memang didesain untuk dipakai pihak lain.

### 6.4 CORP Bukan CORS

CORP tidak memberi JavaScript hak membaca response.

Jika Anda punya:

```http
Cross-Origin-Resource-Policy: cross-origin
```

bukan berarti ini cukup untuk:

```js
const r = await fetch("https://cdn.example.net/data.json");
const data = await r.json();
```

Untuk JS read access lintas origin, tetap perlu CORS.

---

## 7. COEP — Cross-Origin-Embedder-Policy

COEP adalah response header pada document utama.

Ia menjawab:

> “Apakah document ini hanya boleh memuat cross-origin resource yang secara eksplisit mengizinkan dirinya untuk dimuat?”

Contoh:

```http
Cross-Origin-Embedder-Policy: require-corp
```

Artinya, document akan lebih ketat saat memuat resource cross-origin. Resource cross-origin harus:

1. memakai CORS; atau
2. mengirim CORP yang compatible.

### 7.1 Nilai COEP Umum

```http
Cross-Origin-Embedder-Policy: unsafe-none
```

Default. Tidak mengaktifkan embedding restriction tambahan.

```http
Cross-Origin-Embedder-Policy: require-corp
```

Mewajibkan cross-origin subresource untuk explicitly opt-in via CORS atau CORP.

```http
Cross-Origin-Embedder-Policy: credentialless
```

Mode yang memungkinkan resource tertentu dimuat tanpa credentials. Ini berguna untuk mengurangi kebutuhan resource cross-origin mengirim CORP, tetapi konsekuensinya credential seperti cookie tidak dikirim untuk request tertentu.

### 7.2 Kenapa COEP Merusak Asset Jika Tidak Direncanakan

Bayangkan document utama:

```http
Cross-Origin-Embedder-Policy: require-corp
```

Lalu HTML:

```html
<img src="https://images.partner-cdn.com/banner.jpg">
<script src="https://analytics.vendor.com/sdk.js"></script>
<link rel="stylesheet" href="https://fonts.vendor.com/font.css">
```

Jika vendor CDN tidak mengirim header yang compatible, browser bisa memblok resource tersebut.

Request terlihat di Network tab, mungkin `200 OK`, tetapi resource tidak usable.

### 7.3 COEP dan CORS Mode

COEP sering membingungkan karena banyak subresource browser dimuat dalam `no-cors` mode secara default.

Contoh image biasa:

```html
<img src="https://cdn.example.net/photo.jpg">
```

Ini biasanya `no-cors` request. Untuk COEP `require-corp`, resource cross-origin perlu CORP compatible.

Alternatifnya, resource bisa dimuat via CORS dengan atribut tertentu, misalnya:

```html
<img src="https://cdn.example.net/photo.jpg" crossorigin="anonymous">
```

Tetapi server juga harus mengirim CORS header yang benar.

```http
Access-Control-Allow-Origin: https://app.example.com
```

atau untuk public non-credentialed asset:

```http
Access-Control-Allow-Origin: *
```

---

## 8. COOP — Cross-Origin-Opener-Policy

COOP adalah response header pada document utama.

Ia menjawab:

> “Apakah document ini boleh berbagi browsing context group dengan cross-origin document lain, khususnya opener/popup?”

Contoh:

```http
Cross-Origin-Opener-Policy: same-origin
```

COOP membantu melindungi dari serangan berbasis cross-window interaction dan XS-Leaks.

### 8.1 Browsing Context Group secara Sederhana

Ketika halaman membuka popup:

```js
window.open("https://other.example.com")
```

atau halaman dibuka dari link dengan opener, browser bisa memiliki relasi antar window.

Relasi ini bisa dipakai untuk komunikasi terbatas, manipulasi navigation, atau serangan side-channel tertentu.

COOP memungkinkan document memisahkan dirinya dari document cross-origin.

### 8.2 Nilai COOP Umum

```http
Cross-Origin-Opener-Policy: unsafe-none
```

Default. Tidak meminta isolasi khusus.

```http
Cross-Origin-Opener-Policy: same-origin
```

Document hanya berbagi browsing context group dengan document same-origin yang juga compatible.

```http
Cross-Origin-Opener-Policy: same-origin-allow-popups
```

Lebih longgar untuk kasus aplikasi yang perlu membuka popup cross-origin, misalnya OAuth/payment, tetapi tetap ingin beberapa proteksi.

### 8.3 COOP dan OAuth/Login Popup

Misal frontend membuka popup login:

```js
const popup = window.open("https://idp.example.com/login");
```

Jika COOP terlalu ketat, relasi opener dapat terputus. Ini bisa merusak flow yang bergantung pada:

```js
popup.opener.postMessage(...)
```

atau parent yang mengecek status popup.

Untuk OAuth/OIDC, lebih aman mendesain flow dengan explicit `postMessage` origin validation atau redirect-based flow yang tidak bergantung pada akses cross-origin window object berlebihan.

---

## 9. Cross-Origin Isolation

Cross-origin isolation adalah state browser ketika document memenuhi kombinasi policy yang cukup ketat sehingga browser mengizinkan fitur powerful tertentu.

Kombinasi umum:

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

atau varian COEP lain yang compatible.

Jika berhasil, JavaScript dapat mengecek:

```js
console.log(window.crossOriginIsolated);
```

Jika `true`, fitur tertentu bisa tersedia, misalnya:

```js
SharedArrayBuffer
```

### 9.1 Kenapa SharedArrayBuffer Butuh Isolasi

`SharedArrayBuffer` dan high-resolution timing dapat meningkatkan risiko side-channel attack jika halaman tidak terisolasi dengan baik. Browser mengharuskan policy isolasi agar origin tidak mudah melakukan observasi lintas origin melalui timing dan shared memory primitive.

### 9.2 Checklist Cross-Origin Isolation

Document utama:

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Subresource same-origin:

```text
umumnya aman
```

Subresource cross-origin public:

```http
Cross-Origin-Resource-Policy: cross-origin
```

atau CORS:

```http
Access-Control-Allow-Origin: https://app.example.com
```

Subresource cross-site private:

```text
harus dianalisis hati-hati: credentials, CORS, CORP, dan leakage risk
```

### 9.3 Rollout Risk

Mengaktifkan cross-origin isolation di aplikasi besar dapat memblok:

- analytics script;
- A/B testing script;
- tag manager;
- font provider;
- image CDN;
- iframe vendor;
- payment widget;
- map widget;
- chat widget;
- embedded report/dashboard;
- WASM asset dari CDN;
- worker script dari origin lain.

Jangan aktifkan secara global tanpa inventory resource.

---

## 10. Fetch Metadata Request Headers

Fetch Metadata adalah kumpulan request header yang dikirim browser untuk memberi tahu server konteks request.

Header penting:

```http
Sec-Fetch-Site
Sec-Fetch-Mode
Sec-Fetch-Dest
Sec-Fetch-User
```

Header ini diawali `Sec-`, sehingga JavaScript tidak bebas memalsukannya dari browser.

### 10.1 `Sec-Fetch-Site`

Menjelaskan relasi antara origin/site pemicu request dan target request.

Nilai umum:

```text
same-origin
same-site
cross-site
none
```

Contoh:

```http
Sec-Fetch-Site: same-origin
```

atau:

```http
Sec-Fetch-Site: cross-site
```

Server dapat memakai ini untuk menolak request cross-site yang tidak seharusnya terjadi.

### 10.2 `Sec-Fetch-Mode`

Menjelaskan mode request.

Contoh nilai:

```text
navigate
cors
no-cors
same-origin
websocket
```

Contoh:

```http
Sec-Fetch-Mode: navigate
```

Biasanya untuk top-level navigation.

```http
Sec-Fetch-Mode: no-cors
```

Bisa muncul untuk image/script/style tertentu.

```http
Sec-Fetch-Mode: cors
```

Bisa muncul untuk `fetch()` lintas origin dalam CORS mode.

### 10.3 `Sec-Fetch-Dest`

Menjelaskan tujuan resource.

Contoh:

```text
document
script
style
image
font
empty
iframe
worker
```

`fetch()` biasanya:

```http
Sec-Fetch-Dest: empty
```

Navigation document:

```http
Sec-Fetch-Dest: document
```

Image:

```http
Sec-Fetch-Dest: image
```

### 10.4 `Sec-Fetch-User`

Biasanya dikirim untuk navigation yang dipicu aktivasi user.

Contoh:

```http
Sec-Fetch-User: ?1
```

Ini berguna untuk membedakan top-level navigation karena klik user vs request otomatis.

---

## 11. Fetch Metadata sebagai Server-Side Policy

Fetch Metadata memungkinkan server membuat policy defensif seperti:

```text
Jika request cross-site dan bukan top-level navigation aman, tolak.
```

Contoh pseudo-policy:

```text
Allow if Sec-Fetch-Site is same-origin or same-site.
Allow if Sec-Fetch-Mode is navigate and method is GET.
Allow public static assets if destination is image/style/script and route memang public.
Reject cross-site state-changing requests.
```

### 11.1 Contoh Middleware Konseptual

Pseudo-code:

```java
boolean isCrossSite = "cross-site".equals(req.header("Sec-Fetch-Site"));
boolean isNavigate = "navigate".equals(req.header("Sec-Fetch-Mode"));
boolean isDocument = "document".equals(req.header("Sec-Fetch-Dest"));
boolean isSafeMethod = Set.of("GET", "HEAD", "OPTIONS").contains(req.method());

if (isCrossSite && !isSafeMethod) {
    reject(403);
}

if (isCrossSite && isNavigate && isDocument && req.method().equals("GET")) {
    allow();
}
```

Ini bukan kode production lengkap, tetapi menggambarkan pola pikirnya.

### 11.2 Jangan Jadikan Fetch Metadata Satu-Satunya Proteksi

Fetch Metadata adalah lapisan tambahan, bukan pengganti:

- authentication;
- authorization;
- CSRF token;
- SameSite cookie;
- CORS policy;
- input validation;
- origin checking untuk endpoint sensitif.

Kenapa?

1. Tidak semua client adalah browser modern.
2. Mobile app/server-to-server mungkin tidak mengirim header ini.
3. Legacy browser bisa berbeda.
4. Endpoint public punya kebutuhan berbeda.

---

## 12. CORS vs CORP vs COEP vs COOP vs Fetch Metadata

Tabel ringkas:

| Policy | Dipasang di | Mengatur | Pertanyaan Utama |
|---|---|---|---|
| CORS | Response resource/API | JS read access | Bolehkah origin A membaca response origin B? |
| CORP | Response resource | Embedding/loading protection | Bolehkah resource ini dipakai origin/site lain? |
| COEP | Response document utama | Syarat subresource | Apakah page ini menuntut resource cross-origin explicit opt-in? |
| COOP | Response document utama | Browsing context isolation | Apakah page ini dipisahkan dari opener/popup cross-origin? |
| Fetch Metadata | Request browser ke server | Server-side request classification | Request ini datang dari konteks apa? |

Kesalahan umum:

```text
Mengira Access-Control-Allow-Origin menyelesaikan semua cross-origin issue.
```

Tidak. CORS hanya satu layer.

---

## 13. Resource Type Matrix

### 13.1 API Call via `fetch()`

```js
fetch("https://api.example.com/me", {
  credentials: "include"
});
```

Butuh:

```http
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Credentials: true
```

Jika custom header/method non-simple:

```http
Access-Control-Allow-Methods: GET, POST, PATCH
Access-Control-Allow-Headers: Authorization, Content-Type, X-CSRF-Token
```

COEP/CORP biasanya bukan alat utama untuk API read access, tetapi COEP dapat memengaruhi resource request tertentu tergantung mode/destination.

### 13.2 Image dari CDN

```html
<img src="https://cdn.example.net/photo.jpg">
```

Untuk page biasa:

```text
sering boleh tanpa CORS
```

Untuk page dengan COEP `require-corp`, CDN perlu:

```http
Cross-Origin-Resource-Policy: cross-origin
```

atau image dimuat dengan CORS:

```html
<img src="https://cdn.example.net/photo.jpg" crossorigin="anonymous">
```

plus server:

```http
Access-Control-Allow-Origin: *
```

### 13.3 Font

Font cross-origin sering butuh CORS.

```css
@font-face {
  font-family: Inter;
  src: url("https://font-cdn.example.net/inter.woff2") format("woff2");
}
```

Server font:

```http
Access-Control-Allow-Origin: https://app.example.com
```

atau:

```http
Access-Control-Allow-Origin: *
```

untuk public font.

Jika COEP aktif, cek juga apakah resource loading compatible.

### 13.4 Script dari Third-Party

```html
<script src="https://analytics.vendor.com/sdk.js"></script>
```

Tanpa COEP, script classic sering bisa dimuat lintas origin.

Dengan COEP `require-corp`, vendor mungkin perlu:

```http
Cross-Origin-Resource-Policy: cross-origin
```

atau script dimuat dengan CORS-compatible setup.

Namun hati-hati: script third-party adalah supply-chain risk. CORS/CORP tidak membuat script “aman”. Jika script dieksekusi di origin Anda, ia memiliki privilege tinggi dalam page Anda.

### 13.5 Module Script

```html
<script type="module" src="https://cdn.example.net/app-module.js"></script>
```

Module script lebih ketat dan umumnya memakai CORS behavior. CDN harus mengirim CORS header yang sesuai.

### 13.6 Worker

```js
new Worker("https://cdn.example.net/worker.js");
```

Worker punya restriction origin dan CORS/COEP terkait yang lebih ketat dibanding script biasa. Untuk architecture frontend serius, lebih aman host worker script di same-origin atau atur CORS/CORP/COEP dengan sangat eksplisit.

### 13.7 Iframe

```html
<iframe src="https://partner.example.com/report"></iframe>
```

Dipengaruhi oleh:

- `X-Frame-Options`;
- CSP `frame-ancestors`;
- COEP;
- COOP;
- Permissions-Policy;
- sandbox attribute;
- third-party cookie restrictions.

Jika iframe gagal dimuat, jangan langsung menyalahkan CORS. CORS bukan mekanisme utama untuk iframe embedding.

---

## 14. Failure Mode: Resource Terlihat 200 tetapi Diblok

### 14.1 Gejala

Di DevTools Network:

```text
GET https://cdn.vendor.com/sdk.js → 200 OK
```

Tetapi Console:

```text
Cross-Origin-Embedder-Policy blocked loading of resource ...
```

### 14.2 Penyebab

Document utama mengirim:

```http
Cross-Origin-Embedder-Policy: require-corp
```

Resource vendor tidak mengirim:

```http
Cross-Origin-Resource-Policy: cross-origin
```

atau tidak CORS-compatible.

### 14.3 Fix

Opsi:

1. minta vendor menambahkan CORP/CORS header;
2. self-host asset;
3. pindahkan fitur ke iframe/subdomain terpisah;
4. jangan aktifkan COEP secara global;
5. gunakan COEP `credentialless` jika sesuai dan kompatibel;
6. buat allowlist resource sebelum rollout.

---

## 15. Failure Mode: `SharedArrayBuffer` Tidak Tersedia

### 15.1 Gejala

```js
console.log(typeof SharedArrayBuffer);
// "undefined"
```

atau:

```js
console.log(window.crossOriginIsolated);
// false
```

### 15.2 Kemungkinan Penyebab

Document tidak mengirim policy yang cukup:

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

atau ada subresource cross-origin yang melanggar requirement.

### 15.3 Diagnosis

Cek response document utama:

```http
Cross-Origin-Opener-Policy
Cross-Origin-Embedder-Policy
```

Cek console untuk blocked resource.

Cek semua resource cross-origin:

```text
script
worker
wasm
image
font
iframe
```

Cek apakah resource punya:

```http
Cross-Origin-Resource-Policy
```

atau CORS header yang compatible.

---

## 16. Failure Mode: OAuth Popup Tidak Bisa Komunikasi

### 16.1 Gejala

Login popup terbuka, tetapi parent tidak menerima hasil.

Kode lama:

```js
const popup = window.open(loginUrl);

window.addEventListener("message", (event) => {
  // never called
});
```

atau popup tidak bisa akses:

```js
window.opener
```

### 16.2 Kemungkinan Penyebab

COOP memisahkan browsing context group.

```http
Cross-Origin-Opener-Policy: same-origin
```

### 16.3 Solusi Desain

- Hindari flow yang bergantung pada akses langsung cross-origin window object.
- Pakai redirect callback yang jelas.
- Jika memakai `postMessage`, validasi `event.origin` secara ketat.
- Pertimbangkan `same-origin-allow-popups` jika sesuai, tetapi jangan jadikan default tanpa security review.
- Dokumentasikan constraint IdP/payment provider.

---

## 17. Failure Mode: Server Menolak Request karena Fetch Metadata

### 17.1 Gejala

Request mendapat:

```http
HTTP/1.1 403 Forbidden
```

Response body:

```json
{
  "error": "cross_site_request_blocked"
}
```

Request header:

```http
Sec-Fetch-Site: cross-site
Sec-Fetch-Mode: no-cors
Sec-Fetch-Dest: image
```

### 17.2 Kemungkinan Penyebab

Server punya policy yang menolak request cross-site.

Ini bisa benar untuk endpoint sensitif, tetapi salah untuk public asset seperti image.

### 17.3 Fix

Pisahkan policy berdasarkan route:

```text
/api/private/**       strict
/api/public/**        controlled public
/assets/**            public subresource allowed
/auth/callback        allow top-level navigation
/webhook/**           not browser-driven, use separate auth model
```

Jangan menerapkan rule global yang menolak semua `cross-site` request tanpa memahami endpoint.

---

## 18. Designing Browser Isolation Policy untuk Aplikasi Enterprise

Misal aplikasi:

```text
Frontend: https://app.company.com
API:      https://api.company.com
CDN:      https://static.companycdn.com
IdP:      https://login.idp.com
Vendor:   analytics, payment, chat, map
```

### 18.1 Baseline Aman Tanpa Cross-Origin Isolation

Document utama:

```http
Content-Security-Policy: default-src 'self'; ...
Referrer-Policy: strict-origin-when-cross-origin
X-Content-Type-Options: nosniff
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

API:

```http
Access-Control-Allow-Origin: https://app.company.com
Access-Control-Allow-Credentials: true
Vary: Origin
```

Sensitive resource:

```http
Cross-Origin-Resource-Policy: same-origin
```

Public CDN asset:

```http
Cross-Origin-Resource-Policy: cross-origin
Access-Control-Allow-Origin: *
```

Server Fetch Metadata:

```text
reject cross-site unsafe methods for private endpoints
allow public assets explicitly
allow auth callback routes explicitly
```

### 18.2 Jika Butuh Cross-Origin Isolation

Document utama:

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Lalu inventory semua resource cross-origin.

Untuk setiap resource, tentukan:

| Resource | Owned? | Credentialed? | Bisa self-host? | Perlu CORS? | Perlu CORP? |
|---|---:|---:|---:|---:|---:|
| JS bundle CDN | Ya | Tidak | Ya | Mungkin | Ya |
| Font CDN | Ya/third-party | Tidak | Ya | Ya | Mungkin |
| Analytics script | Tidak | Tidak | Kadang | Vendor-dependent | Vendor-dependent |
| Payment iframe | Tidak | Ya/Kadang | Tidak | Bukan CORS utama | Provider-dependent |
| API | Ya | Ya | N/A | Ya | Route-dependent |

Jika ada vendor yang tidak bisa comply, jangan paksa COEP global. Gunakan isolated route/subdomain untuk fitur yang membutuhkan `SharedArrayBuffer`.

---

## 19. Policy Placement: Siapa yang Harus Mengirim Header?

### 19.1 Document Headers

Dikirim oleh server yang menyajikan HTML document utama:

```http
Cross-Origin-Opener-Policy
Cross-Origin-Embedder-Policy
Content-Security-Policy
Permissions-Policy
Referrer-Policy
```

Biasanya dikonfigurasi di:

- web server;
- CDN;
- reverse proxy;
- application server;
- SSR framework.

### 19.2 Resource Headers

Dikirim oleh server resource:

```http
Cross-Origin-Resource-Policy
Access-Control-Allow-Origin
Access-Control-Allow-Credentials
Content-Type
X-Content-Type-Options
Cache-Control
```

Resource owner harus memasangnya. Anda tidak bisa memperbaiki header third-party kecuali:

- vendor mendukung konfigurasi;
- Anda proxy resource;
- Anda self-host;
- Anda mengganti vendor.

### 19.3 Request Metadata Headers

Dikirim oleh browser:

```http
Sec-Fetch-Site
Sec-Fetch-Mode
Sec-Fetch-Dest
Sec-Fetch-User
```

Server membaca header ini untuk policy decision.

Frontend JavaScript tidak boleh mengarang header `Sec-*` tersebut.

---

## 20. Debugging Checklist

Ketika resource/request cross-origin gagal, jangan mulai dari solusi. Mulai dari klasifikasi.

### 20.1 Klasifikasi Request

Tentukan:

```text
request type: fetch? image? script? module? font? iframe? worker? navigation?
initiator: JS? parser? CSS? preload scanner? service worker?
origin relation: same-origin? same-site? cross-site?
credentials: include? omit? same-origin?
mode: cors? no-cors? navigate?
destination: empty? image? script? style? font? document? worker?
```

### 20.2 Cek Request Header

Lihat:

```http
Origin
Sec-Fetch-Site
Sec-Fetch-Mode
Sec-Fetch-Dest
Sec-Fetch-User
Cookie
Authorization
Referer
```

### 20.3 Cek Response Header Document Utama

Lihat:

```http
Cross-Origin-Opener-Policy
Cross-Origin-Embedder-Policy
Content-Security-Policy
Permissions-Policy
```

### 20.4 Cek Response Header Resource

Lihat:

```http
Access-Control-Allow-Origin
Access-Control-Allow-Credentials
Access-Control-Expose-Headers
Cross-Origin-Resource-Policy
Content-Type
X-Content-Type-Options
Cache-Control
Vary
```

### 20.5 Cek Console

Network tab menunjukkan HTTP-level result. Console sering menunjukkan browser policy violation.

Cari pesan seperti:

```text
blocked by CORS policy
blocked by Cross-Origin-Embedder-Policy
blocked by Cross-Origin-Resource-Policy
Refused to frame
Refused to load script
MIME type checking is enforced
```

---

## 21. Rollout Strategy untuk Policy Modern

### 21.1 Jangan Mulai dari Header Paling Ketat

Urutan aman:

1. inventory semua resource dan origin;
2. aktifkan logging/reporting jika tersedia;
3. rollout di staging dengan traffic representatif;
4. uji semua flow:
   - login;
   - logout;
   - upload;
   - download;
   - iframe;
   - payment;
   - analytics;
   - chat widget;
   - map;
   - report embed;
   - worker/WASM;
5. rollout per route/subdomain;
6. monitor console errors dan RUM;
7. enforce bertahap.

### 21.2 Gunakan Route/Subdomain Isolation

Jika hanya satu fitur butuh cross-origin isolation, misalnya editor WASM atau video processing:

```text
https://app.company.com                 normal app
https://isolated-tools.company.com      COOP/COEP strict
```

Ini menghindari seluruh aplikasi rusak karena third-party widget yang tidak compliant.

### 21.3 Definisikan Ownership

Untuk setiap origin:

```text
owned by us?
owned by vendor?
public?
private?
credentialed?
cacheable?
script executable?
embeddable?
```

Policy tidak bisa dibuat benar tanpa ownership map.

---

## 22. Common Anti-Patterns

### Anti-Pattern 1 — “Tambahkan CORS Header untuk Semua”

```http
Access-Control-Allow-Origin: *
```

Masalah:

- tidak valid untuk credentialed request;
- membuka read access public yang mungkin tidak dimaksudkan;
- tidak menyelesaikan CORP/COEP/iframe/CSP issue;
- bisa merusak cache jika origin reflection tidak memakai `Vary: Origin`.

### Anti-Pattern 2 — Mengaktifkan COEP Global Tanpa Inventory

```http
Cross-Origin-Embedder-Policy: require-corp
```

lalu banyak resource vendor rusak.

Lebih baik:

```text
inventory → route-specific rollout → vendor validation → enforce
```

### Anti-Pattern 3 — Mengira CORP Membuat API Aman

```http
Cross-Origin-Resource-Policy: same-origin
```

Ini bukan pengganti authz. API tetap harus mengecek identity dan permission.

### Anti-Pattern 4 — Fetch Metadata Rule Terlalu Kasar

```text
Reject all Sec-Fetch-Site: cross-site
```

Ini bisa merusak:

- auth callback;
- payment callback;
- public image;
- shared link preview;
- CDN assets;
- legitimate navigation.

### Anti-Pattern 5 — Third-Party Script Dianggap Aman karena Header Sudah Ketat

Jika script berjalan di halaman Anda, ia punya privilege besar. Header network tidak mengubah fakta bahwa script executable bisa membaca DOM, token non-HttpOnly, dan melakukan request atas nama page sesuai boundary browser.

---

## 23. Practical Policy Recipes

### 23.1 Private API dengan Cookie Auth

```http
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Credentials: true
Vary: Origin
Cache-Control: no-store
Cross-Origin-Resource-Policy: same-site
```

Plus server-side:

```text
Authn required
Authz required
CSRF protection for cookie-based unsafe methods
Fetch Metadata reject suspicious cross-site unsafe requests
```

### 23.2 Public Static Asset CDN

```http
Access-Control-Allow-Origin: *
Cross-Origin-Resource-Policy: cross-origin
Cache-Control: public, max-age=31536000, immutable
X-Content-Type-Options: nosniff
```

Cocok untuk hashed static assets yang memang public.

### 23.3 Internal Static Asset Same-Site

```http
Cross-Origin-Resource-Policy: same-site
Cache-Control: public, max-age=31536000, immutable
X-Content-Type-Options: nosniff
```

Jika dipakai oleh `app.example.com` dari `static.example.com`, pastikan site relationship benar.

### 23.4 Cross-Origin Isolated Tool Page

HTML document:

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Content-Security-Policy: default-src 'self'; script-src 'self'; worker-src 'self'; connect-src 'self' https://api.example.com
```

Assets:

```http
Cross-Origin-Resource-Policy: same-origin
```

atau jika dari CDN owned:

```http
Cross-Origin-Resource-Policy: cross-origin
Access-Control-Allow-Origin: https://tools.example.com
```

### 23.5 Embedded Partner Iframe

Parent:

```html
<iframe
  src="https://partner.example.com/report"
  sandbox="allow-scripts allow-same-origin allow-forms"
  referrerpolicy="strict-origin-when-cross-origin">
</iframe>
```

Partner harus mengizinkan framing via:

```http
Content-Security-Policy: frame-ancestors https://app.example.com
```

atau tidak mengirim `X-Frame-Options: DENY/SAMEORIGIN` yang konflik.

CORS bukan solusi utama untuk iframe embed.

---

## 24. Browser DevTools Reading Pattern

Saat melihat Network tab, tambahkan kolom/cek:

```text
Status
Type
Initiator
Protocol
Domain
Remote Address
Response Headers
Request Headers
Timing
```

Lalu buka Console.

Urutan diagnosis:

```text
1. Apakah HTTP request terjadi?
2. Apakah response status berhasil?
3. Apakah response MIME benar?
4. Apakah response boleh dibaca oleh JS?
5. Apakah response boleh di-embed oleh document?
6. Apakah document utama punya policy yang memblok?
7. Apakah server menolak berdasarkan Fetch Metadata?
8. Apakah third-party resource kompatibel?
```

---

## 25. Mental Model untuk Java Engineer

Sebagai Java/backend engineer, analogi yang berguna:

```text
CORS  ≈ access rule agar browser JS boleh membaca response
CORP  ≈ resource-level export/visibility policy
COEP  ≈ module/app-level dependency policy: dependency eksternal harus explicit opt-in
COOP  ≈ process/context isolation boundary
Fetch Metadata ≈ request classification attributes untuk middleware/security filter
```

Namun jangan terlalu jauh membawa analogi backend. Browser punya enforcement model sendiri.

Di backend, jika method return `200`, caller biasanya dapat membaca payload.

Di browser:

```text
HTTP 200 != JS can read
HTTP 200 != resource can execute/embed
HTTP 200 != iframe allowed
HTTP 200 != cookie accepted
HTTP 200 != cross-origin isolated
```

Ini invariant penting.

---

## 26. Design Review Questions

Gunakan pertanyaan berikut saat review frontend/backend/platform design.

### 26.1 Untuk API

- Origin frontend mana yang boleh membaca API ini?
- Apakah request memakai credentials?
- Apakah `Vary: Origin` diperlukan?
- Apakah unsafe method dilindungi CSRF?
- Apakah Fetch Metadata dipakai sebagai defense-in-depth?
- Apakah error CORS bisa dibedakan dari 401/403 application error?

### 26.2 Untuk Asset

- Asset ini public atau private?
- Boleh di-embed cross-origin?
- Perlu CORS?
- Perlu CORP?
- Apakah dipakai oleh page dengan COEP?
- Apakah MIME type benar?
- Apakah `nosniff` aman untuk asset ini?

### 26.3 Untuk Document

- Apakah butuh cross-origin isolation?
- Jika ya, semua subresource sudah compatible?
- Apakah OAuth/payment popup masih bekerja?
- Apakah iframe vendor masih bisa dimuat?
- Apakah CSP, COOP, COEP, Permissions-Policy saling konsisten?

### 26.4 Untuk Vendor

- Script vendor dieksekusi di origin kita atau iframe terisolasi?
- Vendor mengirim CORP/CORS header?
- Vendor butuh cookies pihak ketiga?
- Apa failure behavior jika vendor blocked?
- Apakah ada fallback?

---

## 27. Mini Lab: Membuktikan Bedanya CORS dan CORP

### 27.1 Setup Mental

Punya dua origin:

```text
http://localhost:3000  frontend
http://localhost:4000  resource server
```

Frontend:

```html
<img src="http://localhost:4000/image.png">
<script>
  fetch("http://localhost:4000/data.json")
    .then(r => r.json())
    .then(console.log)
    .catch(console.error);
</script>
```

Resource server tanpa CORS.

Ekspektasi:

```text
image mungkin tampil
fetch data.json gagal dibaca karena CORS
```

Lalu tambahkan di document utama:

```http
Cross-Origin-Embedder-Policy: require-corp
```

Sekarang image cross-origin bisa ikut blocked kecuali resource server menambahkan:

```http
Cross-Origin-Resource-Policy: cross-origin
```

atau image dimuat dengan CORS-compatible setup.

Pelajaran:

```text
CORS mengatur JS read access.
CORP/COEP memengaruhi embedding/loading policy.
```

---

## 28. Mini Lab: Fetch Metadata Policy

Log request headers pada backend:

```java
System.out.println("Sec-Fetch-Site = " + request.getHeader("Sec-Fetch-Site"));
System.out.println("Sec-Fetch-Mode = " + request.getHeader("Sec-Fetch-Mode"));
System.out.println("Sec-Fetch-Dest = " + request.getHeader("Sec-Fetch-Dest"));
System.out.println("Sec-Fetch-User = " + request.getHeader("Sec-Fetch-User"));
```

Coba request dari:

1. direct browser navigation;
2. `<img>` tag dari origin lain;
3. `fetch()` same-origin;
4. `fetch()` cross-origin;
5. form POST dari origin lain.

Amati perbedaan nilai.

Tujuan lab:

```text
melihat bahwa server mendapat konteks tambahan dari browser modern, bukan hanya method/path/cookie.
```

---

## 29. Synthesis: Invariant yang Harus Diingat

1. **CORS** membuka hak baca response lintas origin untuk JavaScript.
2. **CORP** memberi resource kemampuan menyatakan siapa yang boleh memakai/meng-embed resource tersebut.
3. **COEP** membuat document menolak cross-origin resource yang tidak explicit opt-in.
4. **COOP** memisahkan document dari cross-origin opener/popup context.
5. **Cross-origin isolation** biasanya butuh kombinasi COOP + COEP.
6. **Fetch Metadata** memberi server sinyal konteks request agar bisa membuat decision defensif.
7. `200 OK` tidak cukup untuk menyimpulkan resource dapat digunakan browser.
8. Network tab menunjukkan transport/protocol evidence; Console menunjukkan browser policy evidence.
9. Policy modern harus dirancang per resource type, bukan satu header global membabi buta.
10. Third-party script tetap berisiko meskipun semua header terlihat “aman”.

---

## 30. Kesimpulan

Browser isolation policies adalah bagian dari HTTP frontend modern yang sering tidak terlihat sampai production rusak.

CORS saja tidak cukup untuk memahami cross-origin behavior. Anda perlu membedakan:

```text
read access     → CORS
embed access    → CORP + COEP + CSP
window isolation → COOP
server filtering → Fetch Metadata
powerful features → cross-origin isolation
```

Sebagai engineer yang kuat di backend dan architecture layer, cara berpikir yang tepat adalah melihat browser sebagai runtime dengan policy enforcement sendiri. Server tidak hanya mengirim data. Server juga mengirim instruksi keamanan yang mengubah cara browser mengeksekusi, membaca, memuat, mengisolasi, dan menolak resource.

Jika Anda menguasai perbedaan ini, Anda akan jauh lebih cepat mendiagnosis bug yang sering membuat tim berputar-putar:

```text
“Padahal status 200.”
“Padahal sudah pakai CORS.”
“Padahal bisa di Postman.”
“Padahal file ada di CDN.”
“Padahal cuma tambah security header.”
```

Di browser modern, HTTP bukan hanya request-response. HTTP juga merupakan delivery mechanism untuk policy.

---

## 31. Referensi

- MDN Web Docs — Cross-Origin-Embedder-Policy
- MDN Web Docs — Cross-Origin-Opener-Policy
- MDN Web Docs — Cross-Origin-Resource-Policy
- MDN Web Docs — Cross-Origin Resource Sharing
- MDN Web Docs — Fetch Metadata request headers
- W3C — Fetch Metadata Request Headers
- web.dev — Making your website cross-origin isolated using COOP and COEP
- web.dev — A guide to enable cross-origin isolation
- WHATWG Fetch Standard


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-http-for-web-frontend-perspective-part-021.md">⬅️ Security Headers for Frontend Engineers</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-http-for-web-frontend-perspective-part-023.md">Part 023 — API Design for Frontend: Resource Shape, Pagination, Filtering, Sorting ➡️</a>
</div>
