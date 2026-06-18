# learn-http-for-web-frontend-perspective-part-012.md

# Part 012 — Cookies Part 1: Browser Cookie Model for Frontend Engineers

> Seri: `learn-http-for-web-frontend-perspective`  
> Bagian: `012 / 035`  
> Topik: Cookie model dari sudut pandang browser/frontend engineer  
> Fokus: `Set-Cookie`, `Cookie`, domain, path, expiration, `Secure`, `HttpOnly`, `SameSite`, cookie prefixes, third-party cookie, partitioned cookie, debugging, dan failure modelling.

---

## 0. Posisi Bagian Ini dalam Seri

Di bagian sebelumnya kita sudah membahas:

- HTTP message model;
- method;
- status code;
- header;
- body;
- Fetch API;
- request non-`fetch`;
- CORS;
- preflight;
- credentials;
- dan bug produksi lintas-origin.

Sekarang kita masuk ke salah satu bagian yang paling sering menjadi sumber incident frontend/backend: **cookies**.

Cookie terlihat sederhana:

```http
Set-Cookie: session_id=abc123; Path=/; Secure; HttpOnly; SameSite=Lax
```

Lalu browser mengirimnya kembali:

```http
Cookie: session_id=abc123
```

Tetapi perilaku sebenarnya jauh lebih kompleks karena cookie dipengaruhi oleh:

- URL target request;
- origin dan site;
- scheme `http` vs `https`;
- domain;
- path;
- expiration;
- `Secure`;
- `HttpOnly`;
- `SameSite`;
- CORS credentials mode;
- third-party context;
- iframe;
- navigation vs subresource request;
- browser privacy policy;
- service worker;
- proxy/CDN;
- local development topology;
- dan user/browser settings.

Untuk frontend engineer, cookie bukan sekadar storage kecil. Cookie adalah **ambient credential transport**: browser dapat mengirim credential secara otomatis tanpa JavaScript secara eksplisit membaca atau menambahkan token.

Itulah kekuatan sekaligus bahayanya.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, Anda harus mampu:

1. menjelaskan cookie sebagai mekanisme state di atas HTTP yang secara desain stateless;
2. membedakan `Set-Cookie` dan `Cookie`;
3. memahami kapan browser menyimpan cookie;
4. memahami kapan browser mengirim cookie;
5. menjelaskan efek `Domain`, `Path`, `Expires`, `Max-Age`, `Secure`, `HttpOnly`, dan `SameSite`;
6. membedakan same-origin, same-site, cross-origin, dan cross-site dalam konteks cookie;
7. men-debug masalah “cookie tidak tersimpan” dan “cookie tidak terkirim”;
8. memahami batasan `document.cookie`;
9. memahami cookie prefix `__Host-` dan `__Secure-`;
10. memahami risiko keamanan cookie;
11. memahami third-party cookie dan partitioned cookie secara konseptual;
12. membuat desain cookie yang lebih defensible untuk frontend/backend modern.

---

## 2. Mental Model Utama: Cookie adalah State yang Dikelola Browser

HTTP secara dasar adalah request-response protocol. Server tidak otomatis tahu bahwa request A dan request B berasal dari user yang sama.

Cookie menambahkan state dengan cara:

1. server mengirim instruksi penyimpanan state ke browser melalui `Set-Cookie`;
2. browser menyimpan cookie di cookie jar;
3. pada request berikutnya yang memenuhi aturan matching, browser otomatis menambahkan header `Cookie`;
4. server membaca cookie untuk mengenali session, preference, tracking state, CSRF token, atau data kecil lain.

Flow dasar:

```text
[1] Browser -> Server
    GET /login

[2] Server -> Browser
    200 OK
    Set-Cookie: session_id=s123; Path=/; Secure; HttpOnly; SameSite=Lax

[3] Browser stores cookie in cookie jar

[4] Browser -> Server
    GET /dashboard
    Cookie: session_id=s123

[5] Server recognizes session
```

Yang sering dilupakan: JavaScript tidak perlu menambahkan header `Cookie`. Bahkan dalam browser, JavaScript tidak boleh secara manual set header `Cookie` pada `fetch()`.

Contoh yang tidak valid di browser:

```js
fetch('/api/me', {
  headers: {
    Cookie: 'session_id=s123'
  }
})
```

Browser menolak atau mengabaikan header seperti ini karena `Cookie` termasuk header yang dikontrol user agent.

Jadi cookie adalah **browser-managed credential channel**, bukan sekadar key-value store JavaScript.

---

## 3. `Set-Cookie` vs `Cookie`

Ada dua header utama:

| Header | Arah | Pembuat | Tujuan |
|---|---:|---|---|
| `Set-Cookie` | response server → browser | server | instruksi untuk menyimpan/mengubah/menghapus cookie |
| `Cookie` | request browser → server | browser | mengirim cookie yang cocok untuk request tersebut |

Contoh response:

```http
HTTP/1.1 200 OK
Content-Type: application/json
Set-Cookie: session_id=abc123; Path=/; Secure; HttpOnly; SameSite=Lax

{ "ok": true }
```

Contoh request berikutnya:

```http
GET /api/me HTTP/1.1
Host: app.example.com
Cookie: session_id=abc123
```

### 3.1 `Set-Cookie` Tidak Sama dengan Header Biasa

`Set-Cookie` memiliki perilaku khusus:

- satu response bisa punya banyak `Set-Cookie`;
- tidak boleh digabung sembarangan seperti beberapa header lain;
- tidak dapat dibaca frontend JavaScript melalui `fetch().headers.get('Set-Cookie')`;
- browser memprosesnya sebagai instruksi cookie jar, bukan sebagai data response biasa;
- CORS `Access-Control-Expose-Headers` tidak membuat `Set-Cookie` bisa dibaca JavaScript.

Contoh:

```http
Set-Cookie: session_id=s123; Path=/; HttpOnly; Secure; SameSite=Lax
Set-Cookie: theme=dark; Path=/; Secure; SameSite=Lax
```

Frontend tidak seharusnya berpikir:

```js
const cookie = response.headers.get('Set-Cookie')
```

Itu bukan modelnya.

Yang benar:

```js
await fetch('/login', {
  method: 'POST',
  credentials: 'include',
  body: JSON.stringify(payload),
  headers: { 'Content-Type': 'application/json' }
})

// Browser mungkin menyimpan cookie jika Set-Cookie valid.
// JavaScript tidak perlu dan tidak bisa membaca HttpOnly session cookie.
```

---

## 4. Cookie Jar: Tempat Browser Menyimpan Cookie

Browser menyimpan cookie dalam struktur internal yang sering disebut **cookie jar**.

Secara konseptual, satu cookie berisi:

```text
name
value
domain
host-only flag
path
creation time
expiration time
secure flag
httpOnly flag
sameSite policy
partition key, jika partitioned
other metadata
```

Ketika request dibuat, browser bertanya:

> “Dari semua cookie yang saya punya, cookie mana yang boleh dikirim ke URL request ini?”

Keputusan itu bukan berdasarkan JavaScript call site, melainkan berdasarkan aturan cookie matching.

Contoh request:

```text
https://api.example.com/v1/orders?status=open
```

Browser mengecek:

- apakah cookie domain cocok dengan `api.example.com`?
- apakah path cookie cocok dengan `/v1/orders`?
- apakah cookie `Secure` hanya dikirim lewat HTTPS?
- apakah cookie expired?
- apakah `SameSite` mengizinkan request ini?
- apakah context third-party memblokir cookie ini?
- apakah request credentials mode mengizinkan cookie dikirim?
- apakah cookie partitioned dan partition key cocok?

Baru setelah itu header `Cookie` dibentuk.

---

## 5. Cookie Name dan Value

Format dasar:

```http
Set-Cookie: name=value
```

Contoh:

```http
Set-Cookie: theme=dark
Set-Cookie: session_id=abc123
Set-Cookie: locale=id-ID
```

### 5.1 Cookie Value Bukan Tempat untuk Data Besar

Cookie dikirim ke server pada request yang cocok. Artinya setiap byte cookie menambah overhead request.

Buruk:

```http
Set-Cookie: user_profile={very_large_json_blob_here}; Path=/; Secure
```

Dampaknya:

- request menjadi lebih besar;
- mobile network lebih berat;
- CDN/proxy/header limit bisa kena;
- semua request ke path/domain terkait membawa data itu;
- data sensitif bisa bocor ke log server/proxy;
- parsing bisa kacau.

Lebih baik:

```http
Set-Cookie: session_id=opaque_random_identifier; Path=/; Secure; HttpOnly; SameSite=Lax
```

Lalu server menyimpan session state di server-side store.

### 5.2 Jangan Simpan PII di Cookie

Hindari:

```http
Set-Cookie: email=alice@example.com
Set-Cookie: role=admin
Set-Cookie: account_balance=1000000
```

Masalah:

- cookie bisa masuk access log;
- bisa ikut ke subdomain bila `Domain` terlalu luas;
- bisa dibaca JavaScript jika tidak `HttpOnly`;
- bisa dimodifikasi user jika server mempercayai value tanpa verifikasi;
- bisa bocor via debugging, HAR file, proxy, analytics, atau screenshot.

Cookie auth sebaiknya berisi **opaque identifier** atau token yang dilindungi secara kriptografis, bukan data domain mentah.

---

## 6. Session Cookie vs Persistent Cookie

Cookie bisa bersifat:

1. **session cookie**;
2. **persistent cookie**.

### 6.1 Session Cookie

Jika tidak ada `Expires` atau `Max-Age`, cookie biasanya dianggap session cookie.

```http
Set-Cookie: session_id=s123; Path=/; Secure; HttpOnly; SameSite=Lax
```

Secara konseptual cookie ini bertahan sampai browser session berakhir. Tetapi browser modern bisa melakukan session restore, sehingga jangan membuat asumsi terlalu kuat bahwa cookie pasti hilang saat window ditutup.

### 6.2 Persistent Cookie

Jika memakai `Expires` atau `Max-Age`, cookie punya masa hidup eksplisit.

```http
Set-Cookie: remember_me=r456; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000
```

`Max-Age=2592000` berarti sekitar 30 hari.

### 6.3 `Max-Age` vs `Expires`

Contoh `Expires`:

```http
Set-Cookie: promo_seen=true; Path=/; Expires=Wed, 31 Dec 2026 23:59:59 GMT
```

Contoh `Max-Age`:

```http
Set-Cookie: promo_seen=true; Path=/; Max-Age=86400
```

Secara praktik modern, `Max-Age` sering lebih mudah karena relatif terhadap waktu saat cookie diterima.

Jika keduanya ada, browser modern umumnya memprioritaskan `Max-Age`.

### 6.4 Menghapus Cookie

Cookie dihapus dengan mengirim cookie bernama sama dengan expiration di masa lalu atau `Max-Age=0`, dengan domain/path yang cocok.

```http
Set-Cookie: session_id=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax
```

Bug umum: server mencoba menghapus cookie tetapi `Path` atau `Domain` berbeda dari cookie asli.

Cookie asli:

```http
Set-Cookie: session_id=s123; Path=/app; Secure; HttpOnly
```

Penghapusan salah:

```http
Set-Cookie: session_id=; Path=/; Max-Age=0; Secure; HttpOnly
```

Ini bisa gagal menghapus cookie `/app` karena path tidak match cookie yang tersimpan.

---

## 7. Domain: Siapa yang Boleh Menerima Cookie

Atribut `Domain` menentukan host mana yang boleh menerima cookie.

Contoh:

```http
Set-Cookie: session_id=s123; Domain=example.com; Path=/; Secure; HttpOnly
```

Cookie ini dapat dikirim ke:

```text
example.com
app.example.com
api.example.com
admin.example.com
```

Jika tidak ada `Domain`, cookie menjadi **host-only cookie**.

Contoh:

```http
Set-Cookie: session_id=s123; Path=/; Secure; HttpOnly
```

Jika response datang dari:

```text
https://app.example.com/login
```

maka cookie hanya untuk:

```text
app.example.com
```

Tidak otomatis untuk:

```text
api.example.com
example.com
admin.example.com
```

### 7.1 Host-Only Cookie Lebih Aman

Host-only cookie lebih sempit.

Ini baik:

```http
Set-Cookie: __Host-session=s123; Path=/; Secure; HttpOnly; SameSite=Lax
```

Ini lebih berisiko:

```http
Set-Cookie: session=s123; Domain=example.com; Path=/; Secure; HttpOnly; SameSite=Lax
```

Karena semua subdomain yang memenuhi domain scope bisa menerima cookie tersebut.

Jika ada subdomain lemah seperti:

```text
old-blog.example.com
legacy-admin.example.com
staging.example.com
```

maka domain-wide cookie meningkatkan risiko.

### 7.2 Domain Tidak Bisa Sembarangan

Server di:

```text
evil.com
```

tidak bisa set cookie untuk:

```text
example.com
```

Browser menolak karena domain harus domain yang valid terkait host response.

Server di:

```text
app.example.com
```

bisa mencoba set:

```http
Set-Cookie: x=1; Domain=example.com
```

Tetapi tidak bisa set:

```http
Set-Cookie: x=1; Domain=another.com
```

### 7.3 Public Suffix

Cookie tidak boleh diset untuk public suffix seperti:

```text
.com
.co.id
.github.io    // tergantung public suffix list behavior
```

Tujuannya agar satu situs tidak bisa set cookie untuk seluruh domain publik.

---

## 8. Path: URL Path Mana yang Menerima Cookie

Atribut `Path` membatasi cookie berdasarkan path URL.

Contoh:

```http
Set-Cookie: admin_token=a1; Path=/admin; Secure; HttpOnly
```

Cookie ini dikirim ke:

```text
/admin
/admin/users
/admin/settings
```

Tidak dikirim ke:

```text
/api
/public
/dashboard
```

### 8.1 Path Bukan Security Boundary yang Kuat

Jangan menganggap `Path` sebagai isolasi keamanan solid seperti origin.

Kenapa?

- Banyak aplikasi satu host berbagi execution context.
- JavaScript dari `/public` tetap berjalan di origin yang sama dengan `/admin` jika dimuat di origin sama.
- Cookie `HttpOnly` memang tidak bisa dibaca JS, tetapi request same-origin bisa tetap mengirim cookie path tertentu saat URL cocok.
- Server routing/proxy bisa berubah.

`Path` berguna untuk scoping, tetapi bukan pengganti origin/subdomain isolation.

### 8.2 Default Path Bisa Mengejutkan

Jika `Path` tidak ditentukan, browser menetapkan default path berdasarkan path response.

Contoh response dari:

```text
https://example.com/app/login
```

Cookie tanpa `Path` bisa memiliki default path sekitar:

```text
/app
```

Ini bisa membuat cookie tidak terkirim ke `/api/me`.

Karena itu untuk session cookie aplikasi, sering lebih jelas menggunakan:

```http
Path=/
```

---

## 9. `Secure`: Hanya Kirim Cookie Lewat HTTPS

Atribut `Secure` berarti cookie hanya dikirim melalui request secure, umumnya HTTPS.

```http
Set-Cookie: session_id=s123; Path=/; Secure; HttpOnly; SameSite=Lax
```

Cookie ini dikirim ke:

```text
https://example.com/api/me
```

Tidak dikirim ke:

```text
http://example.com/api/me
```

### 9.1 `Secure` Hampir Wajib untuk Auth Cookie

Untuk cookie session/auth, gunakan `Secure`.

Tanpa `Secure`, cookie bisa terkirim melalui HTTP jika user atau sistem melakukan request non-HTTPS, membuka risiko interception.

Buruk:

```http
Set-Cookie: session_id=s123; Path=/; HttpOnly; SameSite=Lax
```

Lebih baik:

```http
Set-Cookie: session_id=s123; Path=/; Secure; HttpOnly; SameSite=Lax
```

### 9.2 Localhost dan Development

Local development sering membingungkan.

Misalnya backend set:

```http
Set-Cookie: session_id=s123; Path=/; Secure; HttpOnly; SameSite=None
```

Tetapi frontend berjalan di:

```text
http://localhost:5173
```

Dan API di:

```text
http://localhost:8080
```

Karena bukan HTTPS, cookie `Secure` bisa tidak dikirim atau tidak disimpan sesuai browser behavior.

Solusi yang lebih representatif:

- gunakan HTTPS lokal;
- gunakan dev proxy sehingga origin lebih mirip production;
- buat profile cookie khusus development dengan risiko yang dipahami;
- jangan menyimpulkan production akan sama dengan localhost.

---

## 10. `HttpOnly`: Tidak Bisa Dibaca JavaScript

Atribut `HttpOnly` membuat cookie tidak tersedia melalui `document.cookie`.

```http
Set-Cookie: session_id=s123; Path=/; Secure; HttpOnly; SameSite=Lax
```

JavaScript:

```js
document.cookie
```

Tidak akan menampilkan `session_id` tersebut.

Tetapi browser masih bisa mengirim cookie itu pada request HTTP yang cocok.

### 10.1 `HttpOnly` Melindungi dari Token Theft via XSS

Jika aplikasi terkena XSS, attacker bisa menjalankan JavaScript.

Jika token disimpan di `localStorage`:

```js
localStorage.getItem('access_token')
```

attacker bisa membacanya.

Jika session ada di cookie `HttpOnly`, attacker tidak bisa membaca value session cookie langsung.

Namun jangan salah paham: `HttpOnly` tidak membuat XSS aman.

Dengan XSS, attacker masih bisa melakukan request atas nama user:

```js
fetch('/api/transfer', {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ to: 'attacker', amount: 1000 })
})
```

Jadi `HttpOnly` mengurangi risiko token exfiltration, tetapi tidak menghilangkan risiko session riding akibat XSS.

### 10.2 Cookie untuk UI State Tidak Selalu Perlu `HttpOnly`

Contoh cookie preferensi UI:

```http
Set-Cookie: theme=dark; Path=/; Secure; SameSite=Lax
```

Jika JavaScript perlu membaca theme, cookie tidak boleh `HttpOnly`.

Tetapi pertanyaan desainnya:

> Apakah theme perlu cookie? Atau cukup localStorage?

Untuk data yang hanya dipakai frontend, localStorage atau IndexedDB sering lebih tepat daripada cookie, karena cookie ikut terkirim ke server pada request.

---

## 11. `SameSite`: Mengontrol Pengiriman Cookie pada Cross-Site Request

`SameSite` adalah salah satu atribut paling penting dan paling sering disalahpahami.

Nilai umum:

```text
SameSite=Strict
SameSite=Lax
SameSite=None
```

Untuk memahami `SameSite`, Anda harus membedakan:

- **origin**: scheme + host + port;
- **site**: umumnya scheme + registrable domain.

Contoh:

```text
https://app.example.com
https://api.example.com
```

Mereka **cross-origin** karena host berbeda.

Tetapi mereka bisa **same-site** karena sama-sama berada di `example.com` dengan scheme HTTPS.

Contoh lain:

```text
https://example.com
https://evil.com
```

Mereka cross-site.

### 11.1 `SameSite=Strict`

```http
Set-Cookie: session_id=s123; Path=/; Secure; HttpOnly; SameSite=Strict
```

Cookie hanya dikirim dalam same-site context.

Kelebihan:

- proteksi kuat terhadap CSRF cross-site;
- cocok untuk beberapa aplikasi internal yang tidak butuh external entry flow.

Kekurangan:

- user klik link dari email atau external site ke aplikasi bisa tidak membawa cookie pada request awal;
- OAuth/payment redirect flow bisa terganggu;
- UX bisa terlihat seperti user logout sementara.

### 11.2 `SameSite=Lax`

```http
Set-Cookie: session_id=s123; Path=/; Secure; HttpOnly; SameSite=Lax
```

Ini sering menjadi default praktis untuk session cookie aplikasi web biasa.

Secara konseptual:

- cookie dikirim pada same-site request;
- cookie juga dapat dikirim pada top-level navigation tertentu dari cross-site context, terutama safe navigation seperti link GET;
- cookie tidak dikirim pada banyak subresource atau cross-site POST/fetch context.

Cocok untuk:

- aplikasi web dengan login session normal;
- mengurangi CSRF risiko dibanding `None`;
- tetap memungkinkan user masuk dari link eksternal.

Tetapi `Lax` bukan solusi CSRF lengkap untuk semua kasus.

### 11.3 `SameSite=None`

```http
Set-Cookie: session_id=s123; Path=/; Secure; HttpOnly; SameSite=None
```

`SameSite=None` berarti cookie boleh dikirim dalam cross-site context, jika browser mengizinkan.

Syarat modern penting:

```text
SameSite=None harus disertai Secure
```

Jika tidak:

```http
Set-Cookie: session_id=s123; Path=/; HttpOnly; SameSite=None
```

Browser modern dapat menolak cookie.

Gunakan `SameSite=None` hanya bila memang perlu, misalnya:

- embedded widget dalam iframe cross-site;
- SSO tertentu;
- API yang harus dipanggil dari top-level site berbeda dengan cookie credential;
- third-party integration yang benar-benar membutuhkan cookie.

Risikonya lebih tinggi karena cookie bisa ikut dalam cross-site context.

---

## 12. Same-Origin vs Same-Site: Contoh yang Sering Menjebak

### 12.1 App dan API di Subdomain Berbeda

```text
Frontend: https://app.example.com
API:      https://api.example.com
```

Status:

```text
cross-origin: yes
same-site:    yes
```

Implikasi:

- CORS tetap diperlukan karena cross-origin;
- `SameSite=Lax` atau `Strict` bisa tetap mengizinkan cookie karena same-site;
- `fetch()` tetap perlu `credentials: 'include'` untuk mengirim cookie cross-origin;
- server tetap perlu `Access-Control-Allow-Credentials: true` dan origin spesifik.

Contoh frontend:

```js
await fetch('https://api.example.com/me', {
  credentials: 'include'
})
```

Server response:

```http
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Credentials: true
```

### 12.2 App dan API di Domain Berbeda

```text
Frontend: https://app.company-web.com
API:      https://api.company-api.com
```

Status:

```text
cross-origin: yes
cross-site:   yes
```

Implikasi:

- CORS diperlukan;
- `SameSite=Lax` tidak cukup untuk banyak `fetch()` cross-site;
- cookie auth kemungkinan butuh `SameSite=None; Secure`;
- third-party cookie policy browser bisa memblokir;
- desain BFF atau same-site topology sering lebih stabil.

### 12.3 HTTP vs HTTPS pada Domain Sama

```text
http://example.com
https://example.com
```

Ini beda scheme. Dalam model modern, scheme berpengaruh pada site/origin consideration. Jangan menganggap “domain sama” berarti semua behavior sama.

Implikasi:

- `Secure` cookie tidak dikirim ke HTTP;
- mixed content bisa diblokir;
- service worker butuh secure context;
- SameSite schemeful behavior bisa berdampak.

---

## 13. `credentials` pada Fetch dan Cookie

Cookie tidak otomatis dikirim pada semua `fetch()` cross-origin.

Fetch punya `credentials` mode:

```js
fetch(url, {
  credentials: 'omit'        // jangan kirim credentials
})

fetch(url, {
  credentials: 'same-origin' // default umum: kirim untuk same-origin saja
})

fetch(url, {
  credentials: 'include'     // kirim juga untuk cross-origin bila diizinkan
})
```

### 13.1 Same-Origin Request

```js
await fetch('/api/me')
```

Jika request same-origin dan cookie cocok, browser dapat mengirim cookie.

### 13.2 Cross-Origin Request

```js
await fetch('https://api.example.com/me')
```

Jika frontend di `https://app.example.com`, ini cross-origin.

Agar cookie dikirim:

```js
await fetch('https://api.example.com/me', {
  credentials: 'include'
})
```

Server harus mengizinkan:

```http
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Credentials: true
```

Dan cookie sendiri harus valid untuk target domain/path/scheme/SameSite.

### 13.3 Tiga Gate untuk Cookie Cross-Origin

Untuk cookie terkirim pada cross-origin `fetch`, minimal ada beberapa gate:

```text
Gate 1: fetch credentials mode mengizinkan?
Gate 2: cookie domain/path/secure/expiry match?
Gate 3: SameSite/browser privacy policy mengizinkan?
Gate 4: server CORS response mengizinkan frontend membaca response?
```

Penting: cookie mungkin terkirim tetapi response tetap tidak bisa dibaca jika CORS salah.

Atau sebaliknya: CORS benar tetapi cookie tidak terkirim karena credentials/cookie attribute salah.

---

## 14. `document.cookie`: API Tua yang Banyak Batasannya

JavaScript dapat membaca dan menulis sebagian cookie melalui:

```js
console.log(document.cookie)
```

Contoh output:

```text
theme=dark; locale=id-ID
```

Cookie `HttpOnly` tidak muncul.

### 14.1 Membaca Cookie dengan `document.cookie`

`document.cookie` mengembalikan string, bukan object.

Contoh parser sederhana:

```js
function getCookie(name) {
  return document.cookie
    .split('; ')
    .find(row => row.startsWith(`${encodeURIComponent(name)}=`))
    ?.split('=')[1]
}
```

Tetapi dalam production, parsing cookie manual sering rawan. Gunakan utility yang memahami encoding jika memang perlu.

### 14.2 Menulis Cookie dengan `document.cookie`

```js
document.cookie = 'theme=dark; Path=/; Max-Age=31536000; SameSite=Lax; Secure'
```

Catatan:

- JavaScript tidak bisa membuat cookie `HttpOnly`;
- JavaScript hanya bisa menulis cookie untuk scope yang diizinkan browser;
- `Secure` hanya masuk akal di secure context;
- cookie yang dibuat JavaScript bisa terkena path/domain default bila tidak eksplisit.

### 14.3 Jangan Simpan Auth Token Sensitif di Cookie yang Bisa Dibaca JS

Buruk:

```js
document.cookie = `access_token=${token}; Path=/; Secure; SameSite=Lax`
```

Karena token dapat dibaca oleh script bila terjadi XSS.

Lebih baik untuk session cookie:

```http
Set-Cookie: session_id=opaque; Path=/; Secure; HttpOnly; SameSite=Lax
```

Server yang mengatur.

---

## 15. Cookie Prefixes: `__Host-` dan `__Secure-`

Cookie prefixes membantu browser menegakkan aturan keamanan tertentu berdasarkan nama cookie.

### 15.1 `__Secure-`

Cookie dengan nama diawali `__Secure-` harus diset dengan `Secure` dari secure origin.

Contoh:

```http
Set-Cookie: __Secure-session=s123; Path=/; Secure; HttpOnly; SameSite=Lax
```

Jika `Secure` tidak ada, browser dapat menolak.

### 15.2 `__Host-`

`__Host-` lebih ketat.

Syarat umum:

- harus `Secure`;
- harus `Path=/`;
- tidak boleh memakai `Domain`;
- harus diset dari secure origin.

Contoh bagus:

```http
Set-Cookie: __Host-session=s123; Path=/; Secure; HttpOnly; SameSite=Lax
```

Contoh buruk:

```http
Set-Cookie: __Host-session=s123; Domain=example.com; Path=/; Secure; HttpOnly
```

Karena `__Host-` tidak boleh memiliki `Domain`.

### 15.3 Kenapa `__Host-` Bagus untuk Session Cookie

Karena cookie menjadi host-only dan path root.

Ini mengurangi risiko subdomain lain mengatur cookie dengan nama yang sama untuk domain induk.

Untuk aplikasi yang bisa memakai satu host canonical, `__Host-` adalah default kuat untuk session cookie.

---

## 16. Cookie Scope dan Multiple Cookies dengan Nama Sama

Browser bisa menyimpan cookie dengan nama sama tetapi domain/path berbeda.

Contoh:

```http
Set-Cookie: session=s-root; Path=/; Secure; HttpOnly
Set-Cookie: session=s-admin; Path=/admin; Secure; HttpOnly
```

Request ke:

```text
/admin/users
```

bisa membawa lebih dari satu cookie bernama `session`.

Header:

```http
Cookie: session=s-admin; session=s-root
```

Server yang naïf bisa salah membaca mana yang dimaksud.

Praktik lebih baik:

- hindari nama cookie sama dengan path berbeda kecuali sangat paham konsekuensinya;
- gunakan nama berbeda;
- gunakan host isolation bila perlu;
- pastikan parser cookie server konsisten;
- gunakan prefix untuk auth cookie.

---

## 17. Cookie Deletion Gotchas

Cookie deletion harus match cookie yang ingin dihapus.

Cookie awal:

```http
Set-Cookie: session=s123; Domain=example.com; Path=/; Secure; HttpOnly; SameSite=Lax
```

Delete harus memakai domain/path yang sama:

```http
Set-Cookie: session=; Domain=example.com; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax
```

Jika server menghapus tanpa `Domain`:

```http
Set-Cookie: session=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax
```

browser dapat menghapus host-only cookie yang berbeda, bukan domain cookie asli.

### 17.1 Logout yang Terlihat Berhasil tapi Session Masih Ada

Gejala:

- user klik logout;
- UI pindah ke login page;
- refresh halaman;
- user login lagi otomatis.

Kemungkinan:

- cookie tidak benar-benar terhapus;
- path/domain delete mismatch;
- ada refresh cookie lain;
- service worker menyajikan state lama;
- frontend hanya menghapus local state tetapi server session masih valid;
- ada SSO cookie upstream.

Logout yang benar harus dipandang sebagai multi-state cleanup:

```text
frontend memory state
frontend persistent state
browser cookie jar
server session store
refresh token store
identity provider session
service worker/cache state jika relevan
```

---

## 18. Cookie dan CORS: Kombinasi yang Sering Membingungkan

Misalnya:

```text
Frontend: https://app.example.com
API:      https://api.example.com
```

Login:

```js
await fetch('https://api.example.com/login', {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username, password })
})
```

Response:

```http
HTTP/1.1 200 OK
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Credentials: true
Set-Cookie: __Host-session=s123; Path=/; Secure; HttpOnly; SameSite=Lax
```

Masalah: `__Host-session` diset oleh `api.example.com`, maka cookie host-only untuk `api.example.com`.

Request berikutnya ke API:

```js
await fetch('https://api.example.com/me', {
  credentials: 'include'
})
```

Cookie bisa terkirim ke `api.example.com`.

Tetapi request ke frontend host:

```text
https://app.example.com
```

tidak menerima cookie itu.

Ini bisa benar atau salah tergantung arsitektur.

Jika Anda ingin cookie berlaku untuk banyak subdomain:

```http
Set-Cookie: session=s123; Domain=example.com; Path=/; Secure; HttpOnly; SameSite=Lax
```

Tetapi ini lebih luas dan punya risiko subdomain.

Trade-off:

| Pilihan | Kelebihan | Kekurangan |
|---|---|---|
| Host-only cookie di `api.example.com` | scope sempit, lebih aman | hanya API host yang menerima |
| Domain cookie `.example.com` | mudah share antar subdomain | risiko subdomain lebih besar |
| BFF same-origin `/api` | sederhana bagi browser | butuh layer backend/proxy |
| Token memory + refresh cookie | kontrol lebih eksplisit | kompleksitas auth state machine |

---

## 19. First-Party vs Third-Party Cookie

Istilah first-party/third-party bergantung pada top-level site tempat user berada.

Jika user membuka:

```text
https://shop.example
```

Request ke:

```text
https://shop.example/api/me
```

adalah first-party context.

Request subresource/iframe ke:

```text
https://tracker.example
```

adalah third-party context dari sudut `shop.example`.

Cookie milik `tracker.example` yang digunakan saat tertanam di `shop.example` disebut third-party cookie.

### 19.1 Third-Party Cookie Semakin Tidak Stabil sebagai Fondasi Desain

Browser modern semakin membatasi third-party cookie untuk privasi. Kebijakan detail berbeda antar browser dan dapat berubah.

Untuk engineering, kesimpulan praktisnya:

> Jangan desain core auth flow yang hanya bekerja jika third-party cookie selalu tersedia.

Pertimbangkan:

- same-site topology;
- BFF;
- top-level redirect flow;
- token exchange yang eksplisit;
- partitioned cookies untuk use case embedded tertentu;
- Storage Access API jika relevan;
- browser compatibility matrix.

---

## 20. Partitioned Cookies / CHIPS: Konsep Modern

Partitioned cookies memungkinkan cookie third-party dipisahkan berdasarkan top-level site.

Secara konseptual:

```text
Cookie dari widget.example ketika tertanam di shop-a.com
berbeda dari cookie widget.example ketika tertanam di shop-b.com
```

Bukan satu cookie global lintas semua situs.

Contoh atribut:

```http
Set-Cookie: widget_session=w123; Path=/; Secure; SameSite=None; Partitioned
```

Catatan penting:

- `Partitioned` membutuhkan `Secure`;
- biasanya relevan untuk embedded third-party use case;
- tidak menggantikan first-party session design;
- compatibility harus dicek per target browser;
- debugging perlu melihat partition key/top-level site.

Untuk aplikasi enterprise biasa, jangan mulai dari CHIPS. Mulai dari topology yang menghindari third-party cookie dependency.

---

## 21. Cookie Size dan Limit

Cookie punya batas ukuran dan jumlah. Angka detail bisa berbeda antar browser, tetapi mental modelnya jelas:

- cookie kecil;
- jangan simpan payload besar;
- jangan simpan banyak cookie tanpa kontrol;
- semua cookie yang match akan dikirim pada request;
- header terlalu besar bisa menyebabkan error seperti `400 Bad Request`, `431 Request Header Fields Too Large`, atau ditolak proxy/gateway.

Anti-pattern:

```text
session cookie + tracking cookie + preference cookie + feature flag cookie + huge JWT + A/B test cookie + analytics cookie + legacy cookie
```

Lalu setiap API request membawa header `Cookie` sangat besar.

Dampak:

- latency naik;
- request gagal di gateway;
- log membengkak;
- privacy risk;
- observability noise.

Untuk frontend/backend architecture review, selalu tanya:

> Cookie apa saja yang ikut pada endpoint ini? Apakah semuanya perlu?

---

## 22. JWT dalam Cookie: Boleh, tapi Jangan Naif

JWT sering disimpan dalam cookie.

Contoh:

```http
Set-Cookie: access_token=eyJhbGciOi...; Path=/; Secure; HttpOnly; SameSite=Lax
```

Ini bisa bekerja, tetapi ada trade-off.

Kelebihan:

- `HttpOnly` melindungi dari direct JS token read;
- browser otomatis mengirim;
- cocok untuk session-like auth.

Kekurangan:

- JWT bisa besar;
- setiap request membawa token besar;
- revocation lebih sulit jika stateless murni;
- rotation harus hati-hati;
- CSRF tetap perlu dipikirkan;
- token bisa masuk log server jika tidak hati-hati;
- cookie size limit bisa tercapai.

Untuk banyak aplikasi enterprise, opaque session id + server-side session store sering lebih operasional dan defensible daripada JWT besar dalam cookie.

Namun keputusan bergantung pada:

- scaling model;
- identity provider;
- gateway architecture;
- revocation requirement;
- audit requirement;
- latency;
- mobile/native client needs;
- BFF availability.

---

## 23. Cookie dan CSRF: Kenapa Cookie Disebut Ambient Authority

Cookie disebut ambient credential karena browser mengirimnya otomatis ketika request match.

Ini berbahaya untuk CSRF.

Misalnya user login di:

```text
https://bank.example
```

Attacker membuat page di:

```text
https://evil.example
```

Yang mengirim form:

```html
<form action="https://bank.example/transfer" method="POST">
  <input name="to" value="attacker">
  <input name="amount" value="1000">
</form>
<script>document.forms[0].submit()</script>
```

Jika browser otomatis mengirim cookie bank, server bisa menganggap request valid.

Mitigasi:

- `SameSite=Lax` atau `Strict`;
- CSRF token;
- Origin/Referer validation;
- re-auth for sensitive action;
- custom headers plus CORS model untuk AJAX-only endpoint;
- idempotency dan confirmation flows;
- proper content-type checks.

Bagian berikutnya akan membahas ini lebih dalam.

---

## 24. Cookie dan XSS: Jangan Salah Menyimpulkan

`HttpOnly` membantu mencegah attacker membaca cookie value.

Tetapi XSS tetap fatal karena attacker dapat:

- memanggil API dengan `credentials: 'include'`;
- membaca response API jika same-origin;
- mengubah DOM;
- mencuri data dari halaman;
- melakukan action atas nama user;
- memasang persistence di client state;
- memanipulasi form.

Jadi:

```text
HttpOnly protects cookie confidentiality.
It does not protect application integrity under XSS.
```

Untuk XSS, lapisan lain diperlukan:

- output encoding;
- framework escaping;
- CSP;
- Trusted Types;
- dependency hygiene;
- sanitization;
- no inline script;
- secure review;
- least privilege API;
- step-up auth untuk aksi sensitif.

---

## 25. Cookie dan Browser DevTools

Untuk debugging cookie, gunakan dua area utama:

### 25.1 Network Tab

Lihat request:

```text
Request Headers -> Cookie
```

Lihat response:

```text
Response Headers -> Set-Cookie
```

Pertanyaan:

- Apakah server mengirim `Set-Cookie`?
- Apakah browser menandai `Set-Cookie` blocked?
- Apakah cookie muncul di request berikutnya?
- Apakah request memakai HTTPS?
- Apakah request URL domain/path cocok?
- Apakah request cross-origin?
- Apakah fetch memakai `credentials: 'include'`?
- Apakah preflight berhasil?
- Apakah response CORS valid?

### 25.2 Application/Storage Tab

Lihat Cookies untuk domain tertentu.

Pertanyaan:

- Apakah cookie benar-benar tersimpan?
- Domain apa?
- Path apa?
- Expires kapan?
- HttpOnly?
- Secure?
- SameSite?
- Partitioned?
- Size?
- Priority, jika browser menampilkan?

### 25.3 Network Tab Bisa Menipu Jika Tidak Dibaca Lengkap

Kadang response menampilkan:

```http
Set-Cookie: session=s123; SameSite=None
```

Tetapi browser menolak karena tidak ada `Secure`.

Atau:

```http
Set-Cookie: session=s123; Domain=localhost
```

Perilaku bisa tidak sesuai harapan karena `localhost` punya aturan khusus.

Atau:

```http
Set-Cookie: session=s123; Secure
```

Tetapi request development memakai HTTP.

Jadi jangan hanya lihat “ada `Set-Cookie` di response”. Lihat apakah cookie **accepted**, **stored**, dan **sent**.

---

## 26. Debugging: Cookie Tidak Tersimpan

Gejala:

```text
Login response punya Set-Cookie, tetapi Application tab tidak menunjukkan cookie.
```

Checklist:

### 26.1 Apakah `Set-Cookie` Valid?

Cek format:

```http
Set-Cookie: session=s123; Path=/; Secure; HttpOnly; SameSite=Lax
```

Masalah umum:

- invalid characters;
- wrong date format pada `Expires`;
- domain invalid;
- public suffix;
- `SameSite=None` tanpa `Secure`;
- `Partitioned` tanpa `Secure`;
- cookie size terlalu besar.

### 26.2 Apakah Response Berasal dari Host yang Boleh Set Domain Itu?

Response dari:

```text
https://api.example.com
```

Tidak boleh set:

```http
Set-Cookie: session=x; Domain=another.com
```

### 26.3 Apakah HTTPS Diperlukan?

Jika cookie memakai `Secure`, development HTTP bisa gagal.

### 26.4 Apakah CORS dan Credentials Benar?

Untuk cross-origin `fetch`, agar browser menerima `Set-Cookie`, request perlu credentials mode yang sesuai.

```js
fetch('https://api.example.com/login', {
  method: 'POST',
  credentials: 'include'
})
```

Server:

```http
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Credentials: true
```

Jangan pakai wildcard untuk credentialed response:

```http
Access-Control-Allow-Origin: *
Access-Control-Allow-Credentials: true
```

Itu invalid untuk credentialed CORS.

### 26.5 Apakah Browser Memblokir Third-Party Cookie?

Jika response terjadi dalam iframe atau third-party context, browser privacy policy bisa memblokir.

---

## 27. Debugging: Cookie Tersimpan tapi Tidak Terkirim

Gejala:

```text
Cookie terlihat di Application tab, tetapi request API tidak membawa Cookie header.
```

Checklist:

### 27.1 Domain Cocok?

Cookie untuk:

```text
app.example.com
```

Tidak dikirim ke:

```text
api.example.com
```

kecuali cookie domain diset ke `example.com`.

### 27.2 Path Cocok?

Cookie:

```http
Path=/admin
```

Request:

```text
/api/me
```

Tidak match.

### 27.3 Secure Cocok?

Cookie `Secure` tidak dikirim ke HTTP.

### 27.4 Expired?

Cookie mungkin sudah expired atau dihapus.

### 27.5 SameSite Mengizinkan?

Cross-site `fetch()` dengan `SameSite=Lax` bisa tidak mengirim cookie.

### 27.6 Fetch Credentials Mode?

Cross-origin request perlu:

```js
credentials: 'include'
```

### 27.7 Browser Privacy Policy?

Third-party context bisa diblokir atau dipartisi.

### 27.8 Service Worker?

Service worker bisa mengintercept request. Pastikan request final tetap ke URL yang Anda kira.

---

## 28. Cookie dan Subdomain Architecture

Ada beberapa pola umum.

### 28.1 Same-Origin BFF

```text
Frontend: https://app.example.com
API via BFF: https://app.example.com/api
Backend internal: https://internal-api.example.net
```

Cookie:

```http
Set-Cookie: __Host-session=s123; Path=/; Secure; HttpOnly; SameSite=Lax
```

Kelebihan:

- browser sederhana;
- tidak perlu CORS untuk app ke BFF;
- cookie host-only kuat;
- auth boundary jelas;
- backend internal tersembunyi.

Kekurangan:

- butuh BFF/proxy layer;
- scaling dan ownership perlu jelas;
- API reuse lintas client perlu dirancang.

### 28.2 Cross-Origin Same-Site API

```text
Frontend: https://app.example.com
API:      https://api.example.com
```

Cookie host-only API:

```http
Set-Cookie: __Host-session=s123; Path=/; Secure; HttpOnly; SameSite=Lax
```

Frontend:

```js
fetch('https://api.example.com/me', { credentials: 'include' })
```

Kelebihan:

- API terpisah;
- masih same-site;
- cookie tidak harus domain-wide.

Kekurangan:

- CORS tetap perlu;
- frontend harus konsisten credentials;
- local dev lebih kompleks.

### 28.3 Domain-Wide Cookie

```http
Set-Cookie: session=s123; Domain=example.com; Path=/; Secure; HttpOnly; SameSite=Lax
```

Kelebihan:

- mudah share antar subdomain;
- cocok untuk beberapa SSO internal.

Kekurangan:

- risiko subdomain;
- cookie terkirim ke lebih banyak host;
- debugging lebih rumit;
- naming collision lebih mungkin.

### 28.4 Cross-Site API

```text
Frontend: https://app.example-ui.com
API:      https://api.example-auth.com
```

Cookie mungkin butuh:

```http
SameSite=None; Secure
```

Kekurangan besar:

- third-party cookie dependency;
- browser privacy variance;
- CORS complexity;
- iframe/SSO edge cases;
- user settings bisa merusak flow.

Untuk core web app, hindari jika memungkinkan.

---

## 29. Localhost Cookie Gotchas

Local development sering punya topology seperti:

```text
Frontend: http://localhost:5173
Backend:  http://localhost:8080
```

Mereka beda origin karena port berbeda.

Implikasi:

- CORS diperlukan;
- `credentials: 'include'` diperlukan untuk cookie cross-origin;
- `Secure` cookie tidak cocok dengan HTTP;
- `SameSite` behavior bisa berbeda dari production;
- `localhost`, `127.0.0.1`, dan custom domain seperti `app.local.test` berbeda host;
- cookie untuk `localhost` tidak sama dengan cookie untuk `127.0.0.1`.

Lebih representatif:

```text
Frontend: https://app.local.test
API:      https://api.local.test
```

Atau gunakan dev proxy:

```text
Frontend: http://localhost:5173
API path: http://localhost:5173/api -> proxy ke backend
```

Dengan dev proxy, browser melihat same-origin `/api`, sehingga banyak problem CORS/cookie tersembunyi. Ini bagus untuk development ergonomics, tetapi jangan sampai membuat engineer tidak memahami production topology.

---

## 30. Cookie dan CDN/Proxy/Gateway

Cookie melewati banyak layer:

```text
Browser -> CDN -> WAF -> Load Balancer -> Gateway -> Service
```

Risiko:

- CDN tidak cache response karena ada cookie;
- CDN salah cache personalized response;
- gateway strip `Set-Cookie`;
- proxy rewrite domain/path;
- header size limit;
- multiple `Set-Cookie` digabung salah;
- TLS termination mengubah persepsi scheme aplikasi;
- backend mengira HTTP padahal original request HTTPS.

### 30.1 `Set-Cookie` dan Caching

Response dengan `Set-Cookie` biasanya perlu diperlakukan hati-hati.

Buruk:

```http
HTTP/1.1 200 OK
Cache-Control: public, max-age=3600
Set-Cookie: session=s123; Path=/; Secure; HttpOnly
```

Ini berisiko jika response personalized dicache shared cache.

Lebih aman untuk personalized response:

```http
Cache-Control: private, no-store
Set-Cookie: session=s123; Path=/; Secure; HttpOnly; SameSite=Lax
```

Atau pisahkan static cacheable asset dari personalized API.

### 30.2 `Vary: Cookie`

`Vary: Cookie` bisa menyebabkan cache key explosion karena cookie header sangat variatif.

Jika Anda melihat:

```http
Vary: Cookie
```

Tanya:

- apakah benar response bervariasi berdasarkan seluruh Cookie header?
- apakah lebih baik bypass cache?
- apakah bisa vary berdasarkan header yang lebih sempit?
- apakah endpoint ini memang personalized?

---

## 31. Recommended Cookie Attribute Profiles

### 31.1 Session Cookie Same-Origin / BFF

```http
Set-Cookie: __Host-session=<opaque>; Path=/; Secure; HttpOnly; SameSite=Lax
```

Cocok untuk:

```text
https://app.example.com
```

dengan BFF/API same-origin.

### 31.2 High-Security Internal App

```http
Set-Cookie: __Host-session=<opaque>; Path=/; Secure; HttpOnly; SameSite=Strict
```

Gunakan jika external link/login redirect tidak terganggu atau sudah didesain.

### 31.3 Cross-Site Embedded Use Case

```http
Set-Cookie: widget_session=<opaque>; Path=/; Secure; HttpOnly; SameSite=None; Partitioned
```

Gunakan hanya bila memang embedded third-party dan browser target mendukung.

### 31.4 Non-Sensitive UI Preference

```http
Set-Cookie: theme=dark; Path=/; Secure; SameSite=Lax; Max-Age=31536000
```

Atau lebih baik:

```js
localStorage.setItem('theme', 'dark')
```

jika server tidak membutuhkan value tersebut.

### 31.5 Anti-Profile: Jangan Ini

```http
Set-Cookie: token=<huge-jwt-with-pii>; Domain=example.com; Path=/; SameSite=None
```

Masalah:

- tidak `Secure`;
- tidak `HttpOnly`;
- domain terlalu luas;
- cross-site exposure;
- payload besar;
- potensi PII;
- CSRF risk;
- browser rejection untuk `SameSite=None` tanpa `Secure`.

---

## 32. Decision Framework: Memilih Cookie Strategy

Gunakan pertanyaan berikut.

### 32.1 Apakah Data Ini Perlu Dikirim ke Server pada Setiap Request?

Jika tidak, jangan pakai cookie.

Gunakan:

- memory state;
- localStorage;
- sessionStorage;
- IndexedDB;
- Cache API;
- server-side storage dengan ID kecil.

### 32.2 Apakah Ini Credential?

Jika ya:

- gunakan `Secure`;
- gunakan `HttpOnly` jika tidak perlu dibaca JS;
- gunakan `SameSite=Lax` atau `Strict` bila memungkinkan;
- gunakan opaque value;
- pertimbangkan `__Host-`;
- pikirkan CSRF;
- pikirkan logout dan revocation.

### 32.3 Apakah Perlu Cross-Subdomain?

Jika tidak, host-only lebih baik.

Jika ya, pertimbangkan risiko semua subdomain.

### 32.4 Apakah Perlu Cross-Site?

Jika ya, pertimbangkan ulang arsitektur.

Cross-site cookie auth adalah area yang semakin rapuh karena privacy restrictions.

### 32.5 Apakah Bisa Diselesaikan dengan BFF?

BFF sering menyederhanakan:

- CORS;
- cookie;
- CSRF;
- token storage;
- backend aggregation;
- observability;
- rate limiting;
- security boundary.

Tetapi BFF menambah layer dan ownership.

---

## 33. Failure Model: Cookie Auth State Machine

Untuk cookie-based session, frontend harus berpikir seperti state machine.

```text
Anonymous
  -> submitting credentials
  -> authenticated cookie set
  -> authenticated UI loaded
  -> session expired
  -> re-auth needed
  -> logout requested
  -> server session destroyed
  -> cookie cleared
  -> anonymous
```

Failure transition:

```text
login request succeeds but cookie rejected
login request succeeds but frontend cannot read response due CORS
cookie stored but not sent to API
cookie sent but server session missing
cookie expired but frontend still has user state
logout clears frontend state but not server session
server rotates session but old concurrent request overwrites UI
third-party cookie blocked in embedded flow
```

Frontend architecture harus membedakan:

- “I have user object in memory”;
- “browser has session cookie”;
- “server recognizes session”;
- “identity provider session exists”;
- “API request is authorized”.

Jangan menganggap semuanya sama.

---

## 34. Practical Debugging Playbooks

### 34.1 Login Sukses tapi Refresh Kembali Logout

Kemungkinan:

- cookie tidak tersimpan;
- cookie session hilang;
- `Secure` di HTTP dev;
- `SameSite=None` tanpa `Secure`;
- wrong domain/path;
- server tidak mengirim `Set-Cookie` pada environment tertentu;
- frontend hanya menyimpan user di memory;
- API `/me` tidak menerima cookie;
- CORS credentials salah.

Langkah:

1. buka Network tab pada login response;
2. cek `Set-Cookie`;
3. cek apakah browser memberi warning blocked;
4. buka Application tab cookies;
5. cek domain/path/samesite/secure/httponly/expiry;
6. refresh;
7. cek request `/me` membawa `Cookie` atau tidak;
8. cek response `/me` status dan body;
9. cek server log session lookup.

### 34.2 Cookie Ada tapi API 401

Kemungkinan:

- cookie yang dikirim bukan cookie yang benar;
- cookie expired server-side;
- session revoked;
- server membaca cookie path/domain/name berbeda;
- load balancer sticky session issue;
- key rotation;
- JWT invalid;
- clock skew;
- gateway strip cookie;
- API membutuhkan CSRF header selain cookie.

Langkah:

1. cek request header `Cookie`;
2. cek nama cookie;
3. cek server/gateway log;
4. cek session store;
5. cek auth middleware order;
6. cek apakah request masuk ke service yang benar;
7. cek CORS hanya setelah tahu response 401 bukan browser block.

### 34.3 Works in Postman, Fails in Browser

Postman tidak menerapkan semua browser policies.

Browser punya:

- CORS;
- SameSite;
- credentials mode;
- third-party cookie blocking;
- secure context rules;
- forbidden headers;
- mixed content blocking;
- storage partitioning.

Jadi “Postman berhasil” hanya membuktikan server bisa menerima request HTTP tertentu, bukan bahwa browser boleh melakukan request tersebut dengan policy yang sama.

---

## 35. Backend Implementation Notes untuk Java Engineer

Karena konteks Anda Java engineer, beberapa perhatian backend:

### 35.1 Spring Boot / Servlet Cookie

Pastikan attribute diset eksplisit.

Pseudo-example:

```java
ResponseCookie cookie = ResponseCookie.from("__Host-session", sessionId)
    .path("/")
    .secure(true)
    .httpOnly(true)
    .sameSite("Lax")
    .maxAge(Duration.ofHours(8))
    .build();

response.addHeader(HttpHeaders.SET_COOKIE, cookie.toString());
```

Jangan membuat cookie auth tanpa review attribute.

### 35.2 Reverse Proxy Awareness

Jika aplikasi Java di belakang proxy, aplikasi mungkin melihat request sebagai HTTP internal, padahal user memakai HTTPS.

Perlu konfigurasi forwarded headers:

```text
X-Forwarded-Proto: https
Forwarded: proto=https;host=app.example.com
```

Jika tidak, framework bisa salah menghasilkan cookie/redirect.

### 35.3 Multiple `Set-Cookie`

Gunakan API yang menambahkan header, bukan replace.

Salah secara konseptual:

```java
response.setHeader("Set-Cookie", cookie1);
response.setHeader("Set-Cookie", cookie2); // menimpa cookie1
```

Lebih benar:

```java
response.addHeader("Set-Cookie", cookie1);
response.addHeader("Set-Cookie", cookie2);
```

### 35.4 Gateway dan Security Filter Order

Untuk login/CORS/cookie:

- preflight harus dijawab sebelum auth filter memaksa session;
- login response harus bisa mengirim `Set-Cookie`;
- CORS response harus benar untuk credentialed request;
- CSRF filter harus selaras dengan frontend mechanism;
- logout harus clear cookie dan invalidate server session.

---

## 36. Checklist Review Cookie untuk Production

Gunakan checklist ini saat review API/login/session.

### 36.1 Attribute Checklist

Untuk auth cookie:

```text
[ ] Nama cookie jelas dan tidak collision
[ ] Value opaque atau protected
[ ] Secure
[ ] HttpOnly
[ ] SameSite eksplisit
[ ] Path eksplisit
[ ] Domain sengaja dipilih atau tidak ada untuk host-only
[ ] Max-Age/Expires sengaja dipilih
[ ] Deletion memakai Path/Domain yang sama
[ ] Tidak menyimpan PII
[ ] Tidak terlalu besar
[ ] Tidak bergantung pada third-party cookie kecuali memang didesain
```

### 36.2 Browser Flow Checklist

```text
[ ] Login response mengirim Set-Cookie
[ ] Browser menerima cookie
[ ] Cookie tersimpan dengan attribute benar
[ ] Request berikutnya membawa Cookie
[ ] API mengenali session
[ ] Refresh page tetap authenticated jika memang harus
[ ] Logout menghapus cookie dan server session
[ ] Expired session menghasilkan response konsisten
[ ] Cross-origin request memakai credentials include jika perlu
[ ] Credentialed CORS tidak memakai wildcard origin
```

### 36.3 Security Checklist

```text
[ ] CSRF threat model jelas
[ ] SameSite dipilih dengan alasan
[ ] CSRF token atau Origin validation ada jika dibutuhkan
[ ] XSS mitigasi tidak bergantung hanya pada HttpOnly
[ ] Domain tidak terlalu luas
[ ] Subdomain risk direview
[ ] Cookie tidak masuk log sensitif
[ ] Session rotation dilakukan setelah login/privilege change
[ ] Logout/revocation jelas
```

---

## 37. Common Anti-Patterns dan Replacement

### Anti-Pattern 1: “Cookie Tidak Terkirim, Tambah CORS `*` Saja”

Buruk:

```http
Access-Control-Allow-Origin: *
Access-Control-Allow-Credentials: true
```

Replacement:

```http
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Credentials: true
Vary: Origin
```

Dan frontend:

```js
fetch('https://api.example.com/me', {
  credentials: 'include'
})
```

### Anti-Pattern 2: Simpan JWT Besar di Cookie Domain-Wide

Buruk:

```http
Set-Cookie: token=<huge-jwt>; Domain=example.com; Path=/; Secure; SameSite=None
```

Replacement:

```http
Set-Cookie: __Host-session=<opaque>; Path=/; Secure; HttpOnly; SameSite=Lax
```

Lalu server-side session atau BFF token handling.

### Anti-Pattern 3: Logout Hanya Hapus Local Storage

Buruk:

```js
localStorage.removeItem('user')
navigate('/login')
```

Replacement:

```js
await fetch('/api/logout', {
  method: 'POST',
  credentials: 'include'
})
clearClientState()
navigate('/login')
```

Server:

```http
Set-Cookie: __Host-session=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax
```

Dan invalidate server session.

### Anti-Pattern 4: Menganggap Cookie Path adalah Security Boundary

Buruk:

```http
Set-Cookie: admin_session=a; Path=/admin; Secure; HttpOnly
Set-Cookie: user_session=u; Path=/; Secure; HttpOnly
```

Lalu menganggap `/public` tidak bisa memengaruhi `/admin` karena path beda.

Replacement:

- isolasi origin/subdomain untuk aplikasi dengan trust boundary berbeda;
- gunakan authorization server-side;
- jangan bergantung pada path cookie untuk security critical isolation.

### Anti-Pattern 5: Debug Hanya dari Response Header

Buruk:

```text
Saya melihat Set-Cookie, berarti cookie sudah benar.
```

Replacement:

```text
Set-Cookie sent -> browser accepted -> stored -> matched -> sent -> server accepted
```

Debug seluruh lifecycle.

---

## 38. Latihan Praktis

### Latihan 1: Tentukan Cookie Dikirim atau Tidak

Cookie:

```http
Set-Cookie: session=s1; Domain=example.com; Path=/api; Secure; HttpOnly; SameSite=Lax
```

Request:

```text
https://api.example.com/api/me
```

Dikirim?

Jawaban: ya, jika belum expired dan context SameSite mengizinkan.

Request:

```text
https://api.example.com/admin
```

Dikirim?

Jawaban: tidak, path `/admin` tidak match `/api`.

Request:

```text
http://api.example.com/api/me
```

Dikirim?

Jawaban: tidak, cookie `Secure` hanya untuk HTTPS.

### Latihan 2: Debug Login Cross-Origin

Topology:

```text
Frontend: http://localhost:5173
API:      http://localhost:8080
```

Response login:

```http
Set-Cookie: session=s1; Path=/; Secure; HttpOnly; SameSite=None
Access-Control-Allow-Origin: http://localhost:5173
Access-Control-Allow-Credentials: true
```

Frontend:

```js
fetch('http://localhost:8080/login', {
  method: 'POST',
  credentials: 'include'
})
```

Masalah: cookie tidak tersimpan.

Kemungkinan besar:

- cookie `Secure` pada HTTP localhost topology;
- `SameSite=None` mensyaratkan `Secure`, tetapi secure delivery tetap bermasalah pada HTTP;
- gunakan HTTPS local atau dev profile berbeda.

### Latihan 3: Pilih Cookie Strategy

Requirement:

```text
Enterprise SPA
Frontend dan BFF bisa berada di host yang sama
Session harus aman dari JS token theft
Tidak perlu akses cross-site
```

Rekomendasi:

```http
Set-Cookie: __Host-session=<opaque>; Path=/; Secure; HttpOnly; SameSite=Lax
```

Dengan BFF same-origin:

```text
https://app.example.com/api
```

---

## 39. Ringkasan Mental Model

Cookie lifecycle:

```text
Server sends Set-Cookie
Browser validates attributes
Browser stores cookie in cookie jar
Future request is created
Browser matches cookie by domain/path/scheme/expiry/SameSite/privacy/partition/credentials
Browser sends Cookie header
Server validates cookie/session
```

Untuk debugging, jangan lompat dari `Set-Cookie` ke “session harusnya jalan”. Selalu cek setiap gate.

Cookie adalah:

```text
small browser-managed state
sent automatically when matched
dangerous if over-scoped
useful for session
risky for CSRF
partly protected by HttpOnly/Secure/SameSite
increasingly constrained by privacy policies
```

Default defensible untuk banyak aplikasi:

```http
Set-Cookie: __Host-session=<opaque>; Path=/; Secure; HttpOnly; SameSite=Lax
```

Tetapi default ini hanya benar jika topology Anda mendukung host-only same-site/same-origin session model.

---

## 40. Referensi Utama

- RFC 6265 — HTTP State Management Mechanism.
- IETF HTTPbis `rfc6265bis` draft — modern cookie model including SameSite and cookie prefixes.
- MDN — `Set-Cookie` header reference.
- MDN — HTTP cookies guide.
- MDN — CHIPS / Partitioned cookies.
- WHATWG Fetch Standard — credentials mode and browser fetching model.
- MDN — CORS guide and credentialed requests.

---

## 41. Koneksi ke Bagian Berikutnya

Bagian ini membangun model browser cookie.

Bagian berikutnya akan masuk ke:

```text
Part 013 — Cookies Part 2: Session, CSRF, Auth, and SPA Reality
```

Fokus berikutnya:

- session cookie vs token auth;
- CSRF secara detail;
- SameSite sebagai mitigasi parsial;
- CSRF token pattern;
- OAuth/OIDC browser redirect;
- BFF pattern;
- refresh token rotation;
- logout semantics;
- auth state machine untuk SPA;
- failure model login/logout/session renewal.

---

## 42. Status Seri

```text
Part 012 selesai.
Seri belum selesai.
Lanjut ke Part 013: Cookies Part 2: Session, CSRF, Auth, and SPA Reality.
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-http-for-web-frontend-perspective-part-011.md">⬅️ CORS Part 2: Preflight, Credentials, Cookies, and Real Production Bugs</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-http-for-web-frontend-perspective-part-013.md">Part 013 — Cookies Part 2: Session, CSRF, Auth, and SPA Reality ➡️</a>
</div>
