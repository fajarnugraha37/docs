# learn-http-for-web-frontend-perspective-part-033

# Deployment, Environments, Proxies, Gateways, and Local Development

> Seri: `learn-http-for-web-frontend-perspective`  
> Part: `033`  
> Perspektif: Java software engineer yang ingin memahami HTTP dari sisi browser/frontend sampai level production-grade.  
> Prasyarat: Part 000–032, terutama origin/site, CORS, cookies, cache, redirects, TLS, security headers, observability, reliability, dan HTTP client architecture.

---

## 0. Tujuan Bagian Ini

Di banyak sistem enterprise, aplikasi frontend jarang berbicara langsung ke backend service final.

Yang terlihat sederhana:

```text
browser -> https://api.example.com/orders
```

sering kali sebenarnya adalah:

```text
browser
  -> local DNS / corporate DNS
  -> browser cache / service worker
  -> CDN edge
  -> WAF
  -> load balancer
  -> API gateway
  -> ingress controller
  -> reverse proxy
  -> backend-for-frontend
  -> internal service mesh
  -> Java service
```

Akibatnya, bug HTTP di production sering bukan bug di satu komponen, melainkan bug di **environment topology**.

Contoh:

- Berhasil di local, gagal di staging.
- Berhasil di Postman, gagal di browser.
- Berhasil di direct backend URL, gagal lewat gateway.
- Berhasil tanpa CDN, gagal setelah CDN diaktifkan.
- Berhasil di HTTP local, gagal di HTTPS production.
- Cookie tersimpan di dev, hilang di production.
- CORS sudah benar di backend, tapi tetap error karena gateway menimpa header.
- SPA route berhasil saat klik internal link, tapi 404 saat refresh.
- Asset sudah deploy, tapi user masih dapat JS lama.

Bagian ini bertujuan membangun mental model agar Anda bisa membaca deployment HTTP sebagai **multi-hop request pipeline**, bukan sekadar endpoint.

Setelah bagian ini, Anda harus bisa:

1. memetakan topology frontend/backend per environment;
2. membedakan masalah browser, proxy, gateway, CDN, ingress, dan backend;
3. mendesain local development setup yang mirip production tanpa membuat security policy palsu;
4. memahami efek TLS termination, path rewriting, subdomain routing, SPA fallback, dan header mutation;
5. mendiagnosis masalah CORS, cookie, cache, redirect, dan auth yang hanya muncul di environment tertentu;
6. membuat checklist deployment HTTP untuk frontend aplikasi enterprise.

---

## 1. Mental Model Utama: Environment adalah Bagian dari Kontrak HTTP

Banyak engineer memperlakukan environment sebagai detail deployment:

```text
local, dev, staging, prod cuma beda base URL.
```

Itu tidak cukup.

Dari perspektif browser, environment memengaruhi:

- origin;
- site;
- scheme HTTP/HTTPS;
- certificate trust;
- cookie Domain;
- cookie SameSite;
- CORS allowlist;
- redirect target;
- service worker scope;
- cache partition;
- security header policy;
- CDN behavior;
- HSTS behavior;
- mixed content behavior;
- request credentials behavior;
- path routing;
- asset URL;
- API URL;
- source map visibility;
- observability header propagation.

Jadi environment bukan hanya tempat aplikasi berjalan. Environment adalah **parameter protokol**.

### 1.1 Invariant Penting

Untuk setiap environment, Anda harus bisa menjawab:

```text
Apa origin aplikasi?
Apa origin API?
Apakah same-origin, same-site, atau cross-site?
Apakah HTTPS penuh dari browser sampai edge?
Di mana TLS terminate?
Siapa yang menambahkan/menghapus/mengubah header?
Siapa yang boleh cache response?
Siapa yang melakukan redirect?
Siapa yang menentukan fallback route SPA?
Cookie diset oleh host mana dan dikirim ke host mana?
Apakah browser menganggap context ini secure?
```

Jika tidak bisa menjawab pertanyaan ini, debugging HTTP akan spekulatif.

---

## 2. Environment Topology Dasar

Mari pecah beberapa pola umum.

---

## 3. Pola 1 — Local Frontend + Local Backend

Contoh:

```text
Frontend dev server: http://localhost:5173
Backend API:         http://localhost:8080
```

Secara browser:

```text
http://localhost:5173 != http://localhost:8080
```

Karena origin = scheme + host + port.

Port berbeda berarti origin berbeda.

Jadi request dari frontend ke backend adalah **cross-origin**.

```text
Page origin:    http://localhost:5173
API origin:     http://localhost:8080
Relation:       cross-origin, usually same-site-ish local special handling, but origin tetap beda
CORS needed:    yes, untuk fetch/XHR cross-origin
Cookie issue:   depends on host/domain/path/SameSite/Secure
```

### 3.1 Bug Umum

Frontend:

```ts
fetch('http://localhost:8080/api/me', {
  credentials: 'include'
})
```

Backend mengembalikan:

```http
Access-Control-Allow-Origin: *
Access-Control-Allow-Credentials: true
Set-Cookie: SESSION=abc; Path=/; HttpOnly; SameSite=Lax
```

Ini bermasalah untuk credentialed CORS karena wildcard origin tidak boleh dipakai untuk expose credentialed response ke JavaScript.

Browser akan menolak response.

### 3.2 Fix yang Benar

Backend local harus mengembalikan origin eksplisit:

```http
Access-Control-Allow-Origin: http://localhost:5173
Access-Control-Allow-Credentials: true
Vary: Origin
```

Dan frontend harus memakai:

```ts
fetch('http://localhost:8080/api/me', {
  credentials: 'include'
})
```

### 3.3 Localhost Bukan Production

Localhost punya beberapa pengecualian browser:

- `localhost` sering diperlakukan sebagai potentially trustworthy untuk beberapa secure-context behavior.
- `Secure` cookie punya perilaku khusus di beberapa browser untuk localhost, tetapi jangan menganggap ini identik dengan production.
- `localhost`, `127.0.0.1`, dan machine hostname bukan host yang sama.
- Cookie untuk `localhost` tidak otomatis berlaku untuk `127.0.0.1`.

Bug klasik:

```text
Frontend: http://localhost:5173
Backend:  http://127.0.0.1:8080
```

Bagi manusia keduanya “local machine”.

Bagi browser, host berbeda.

---

## 4. Pola 2 — Local Frontend + Remote Backend

Contoh:

```text
Frontend: http://localhost:5173
Backend:  https://api.dev.example.com
```

Ini umum saat developer menjalankan UI local tetapi memakai backend dev/staging.

Konsekuensi:

```text
Page origin:  http://localhost:5173
API origin:   https://api.dev.example.com
Relation:     cross-origin, cross-site
CORS:         required
Cookie:       cross-site rules apply
HTTPS:        API secure, page not secure
```

### 4.1 Problem: Cookie Auth Sulit

Jika backend menggunakan cookie session:

```http
Set-Cookie: SESSION=abc; Domain=.dev.example.com; Path=/; Secure; HttpOnly; SameSite=None
```

Frontend local di `http://localhost:5173` melakukan:

```ts
fetch('https://api.dev.example.com/me', {
  credentials: 'include'
})
```

Agar cookie ikut:

- request harus `credentials: 'include'`;
- response harus `Access-Control-Allow-Credentials: true`;
- response harus `Access-Control-Allow-Origin: http://localhost:5173`;
- cookie cross-site biasanya perlu `SameSite=None; Secure`;
- browser privacy policy dapat tetap membatasi third-party cookie behavior.

### 4.2 Problem: Localhost Origin dalam Allowlist

Backend/gateway perlu allowlist origin local:

```text
http://localhost:5173
http://127.0.0.1:5173
http://localhost:3000
```

Namun ini harus hanya aktif untuk dev/staging, bukan production.

Anti-pattern:

```http
Access-Control-Allow-Origin: *
Access-Control-Allow-Credentials: true
```

Atau lebih buruk:

```text
Allow all origins in production because local dev was painful.
```

### 4.3 Local Remote Backend dengan Token Auth

Jika memakai bearer token:

```ts
fetch('https://api.dev.example.com/me', {
  headers: {
    Authorization: `Bearer ${token}`
  }
})
```

Maka:

- custom `Authorization` header akan memicu preflight;
- gateway harus menerima OPTIONS;
- backend tidak boleh mewajibkan auth pada preflight;
- `Access-Control-Allow-Headers` harus mencakup `Authorization`;
- `Access-Control-Allow-Methods` harus mencakup method aktual.

---

## 5. Pola 3 — Same-Origin Production via Reverse Proxy

Contoh production:

```text
https://app.example.com/           -> frontend static assets / SPA
https://app.example.com/api/*      -> API gateway / BFF
```

Dari browser:

```text
Page origin: https://app.example.com
API origin:  https://app.example.com
Relation:    same-origin
CORS:        not needed for /api
Cookie:      simpler
```

Ini sering menjadi setup paling nyaman untuk SPA enterprise.

### 5.1 Reverse Proxy Routing

Nginx/ingress/gateway bisa mengatur:

```text
/              -> static frontend
/assets/*      -> static frontend assets
/api/*         -> backend API
/auth/*        -> identity/BFF/auth service
```

Keuntungan:

- tidak perlu CORS untuk API utama;
- cookie auth lebih sederhana;
- redirect login lebih mudah;
- observability bisa distandarkan di satu origin;
- CSP `connect-src 'self'` lebih sederhana.

Risiko:

- path rewriting salah;
- SPA fallback menangkap `/api/*` dan mengembalikan `index.html`;
- API error berubah menjadi HTML 200;
- cache rule untuk static asset ikut mengenai API;
- gateway menambahkan/menghapus header yang tidak disadari frontend/backend.

### 5.2 Bug Berbahaya: API Mengembalikan HTML

Misalnya routing salah:

```text
GET /api/me
```

Alih-alih ke backend, reverse proxy mengirim ke SPA fallback:

```http
HTTP/1.1 200 OK
Content-Type: text/html

<!doctype html><html>...</html>
```

Frontend:

```ts
const data = await response.json()
```

Error:

```text
Unexpected token '<', "<!doctype" is not valid JSON
```

Akar masalah bukan JSON parser. Akar masalah adalah routing/fallback.

### 5.3 Invariant

SPA fallback hanya boleh berlaku untuk navigation route, bukan API route dan bukan asset route.

Rule konseptual:

```text
if path starts with /api/:
  route to API; never fallback to index.html
elif path starts with /assets/:
  route to static asset; return 404 if missing
else if request accepts text/html and is navigation:
  fallback to index.html
else:
  return 404
```

---

## 6. Pola 4 — Subdomain Split Production

Contoh:

```text
Frontend: https://app.example.com
API:      https://api.example.com
Auth:     https://auth.example.com
CDN:      https://cdn.example.com
```

Dari browser:

```text
app.example.com -> api.example.com
Relation: cross-origin, same-site if schemeful site example.com sama
CORS: required for fetch/XHR
Cookies: Domain=.example.com possible, but SameSite still matters
```

### 6.1 Keuntungan

- separation of concerns;
- API bisa punya lifecycle sendiri;
- CDN asset host bisa dioptimalkan;
- auth domain bisa distandarkan;
- scaling/routing lebih fleksibel.

### 6.2 Kerugian

- CORS perlu benar;
- cookie Domain/SameSite lebih tricky;
- CSP perlu `connect-src https://api.example.com`;
- redirects lintas subdomain harus aman;
- observability harus korelasikan request lintas origin;
- local/staging topology sering berbeda dari production.

### 6.3 Cookie Domain

Jika API menetapkan:

```http
Set-Cookie: SESSION=abc; Domain=.example.com; Path=/; Secure; HttpOnly; SameSite=Lax
```

Cookie dapat dikirim ke subdomain terkait sesuai aturan domain/path.

Tetapi jangan otomatis menganggap ini selalu aman.

Trade-off:

```text
Domain=.example.com
  + memudahkan sharing session antar subdomain
  - memperluas blast radius cookie ke lebih banyak host

Host-only cookie untuk app.example.com
  + lebih sempit dan aman
  - tidak otomatis tersedia untuk api.example.com/auth.example.com
```

Untuk cookie sensitif, prinsipnya:

```text
scope cookie sekecil mungkin yang masih memenuhi kebutuhan sistem.
```

---

## 7. Pola 5 — CDN-First Frontend Deployment

Contoh:

```text
User -> CDN -> static frontend files
User -> CDN/API gateway -> API
```

CDN bisa melayani:

- `index.html`;
- hashed JS/CSS assets;
- images/fonts;
- API response tertentu;
- redirect;
- edge function;
- security headers;
- compression;
- HTTP/2/3 termination.

### 7.1 CDN Mengubah HTTP Reality

CDN dapat:

- cache response;
- normalize headers;
- remove headers;
- add headers;
- compress response;
- coalesce requests;
- serve stale response;
- return its own error page;
- terminate TLS;
- rewrite paths;
- redirect HTTP to HTTPS;
- collapse query parameters depending config;
- ignore or respect `Vary`;
- split cache by host/path/header/query.

Frontend engineer perlu tahu CDN behavior karena browser hanya melihat response final.

### 7.2 Strategi Cache Frontend Umum

Biasanya:

```text
index.html:
  Cache-Control: no-cache atau max-age pendek dengan revalidation

/assets/app.[hash].js:
  Cache-Control: public, max-age=31536000, immutable

/assets/app.[hash].css:
  Cache-Control: public, max-age=31536000, immutable

/api/me:
  Cache-Control: private, no-store atau policy eksplisit sesuai sensitivitas
```

Kenapa?

- `index.html` menunjuk ke versi asset terbaru.
- hashed assets aman di-cache lama karena nama berubah saat konten berubah.
- API personalized tidak boleh bocor ke shared cache.

### 7.3 Deployment Bug: Old HTML vs New Assets

Kasus:

1. User punya `index.html` lama di cache.
2. `index.html` lama menunjuk ke `/assets/app.oldhash.js`.
3. Deployment baru menghapus `app.oldhash.js` dari CDN/origin.
4. User refresh.
5. Browser request `app.oldhash.js`.
6. CDN/origin return 404.
7. App blank.

Solusi defensible:

- jangan hapus asset lama terlalu cepat;
- gunakan retention window;
- cache `index.html` pendek/revalidate;
- cache hashed assets panjang;
- monitor chunk load error;
- implement reload recovery untuk chunk mismatch;
- deploy atomically jika memungkinkan.

---

## 8. API Gateway dan BFF

API gateway dan BFF sering tampak mirip, tetapi perannya berbeda.

### 8.1 API Gateway

API gateway biasanya bertanggung jawab untuk:

- routing;
- authentication delegation;
- authorization coarse-grained;
- rate limiting;
- request/response transformation;
- TLS termination;
- logging;
- tracing;
- CORS policy;
- version routing;
- tenant routing.

### 8.2 BFF

Backend-for-Frontend biasanya bertanggung jawab untuk:

- menyusun response sesuai screen;
- menyembunyikan kompleksitas domain services;
- session/token handling untuk browser;
- mengurangi chatty API calls;
- mapping error ke UI-friendly contract;
- menyatukan auth flow;
- mengontrol cache/API contract untuk frontend tertentu.

### 8.3 Kesalahan Desain

Kesalahan umum:

```text
Gateway dipakai sebagai BFF tanpa ownership product/API contract.
```

Akibat:

- gateway dipenuhi transformasi bisnis;
- logic tersebar di config;
- contract sulit dites;
- observability buruk;
- perubahan UI mengubah gateway config secara rapuh.

Rule:

```text
Gateway bagus untuk cross-cutting transport concerns.
BFF bagus untuk client-specific application composition.
```

---

## 9. TLS Termination dan Header Forwarding

TLS bisa terminate di beberapa tempat:

```text
browser --HTTPS--> CDN --HTTPS/HTTP--> load balancer --HTTP--> app
```

Atau:

```text
browser --HTTPS--> load balancer --HTTPS--> service
```

### 9.1 Kenapa Ini Penting untuk Frontend?

Backend mungkin perlu tahu original scheme/host untuk:

- membuat absolute redirect URL;
- membangun callback OAuth;
- menentukan cookie `Secure`;
- generating links;
- enforcing HTTPS;
- CORS origin check;
- HSTS policy.

Jika backend melihat request internal sebagai HTTP:

```text
X-Forwarded-Proto missing
```

Backend bisa menghasilkan redirect salah:

```http
Location: http://app.example.com/login
```

Dari halaman HTTPS, ini bisa menyebabkan mixed content/security issue atau downgrade yang diblokir/di-upgrade browser.

### 9.2 Forwarded Headers Umum

Sering dijumpai:

```http
X-Forwarded-For: 203.0.113.10
X-Forwarded-Proto: https
X-Forwarded-Host: app.example.com
X-Forwarded-Port: 443
Forwarded: for=203.0.113.10;proto=https;host=app.example.com
```

Aplikasi Java/Spring sering butuh konfigurasi agar menghormati forwarded headers.

Misconfiguration dapat menyebabkan:

- redirect loop HTTP↔HTTPS;
- callback OAuth salah;
- cookie tidak `Secure`;
- generated absolute URL salah;
- HATEOAS/link API salah;
- CORS origin mismatch.

### 9.3 Security Note

Jangan percaya forwarded headers dari internet secara mentah.

Forwarded headers harus dipercaya hanya jika datang dari trusted proxy/load balancer.

Jika tidak, attacker bisa spoof:

```http
X-Forwarded-Host: evil.example
```

lalu memengaruhi link generation atau redirect.

---

## 10. Path Rewriting

Path rewriting umum di reverse proxy/gateway.

Contoh eksternal:

```text
/api/orders/123
```

Dikirim ke backend sebagai:

```text
/orders/123
```

Atau:

```text
/bff/api/orders/123 -> /internal/v2/orders/123
```

### 10.1 Risiko

- backend menghasilkan link dengan path internal;
- cookie Path salah;
- CORS config path-based tidak kena;
- auth rule tidak match;
- OpenAPI docs tidak sesuai external path;
- SPA fallback menangkap path API;
- trailing slash redirect muncul dari backend internal;
- relative redirect `Location: ../login` menjadi salah.

### 10.2 Rule

Ada dua kontrak path:

```text
External contract: URL yang dilihat browser/client.
Internal contract: URL antar proxy/backend.
```

Jangan campur keduanya tanpa dokumentasi.

Untuk frontend, yang penting adalah external contract.

---

## 11. Subdomain Routing vs Path Routing

### 11.1 Subdomain Routing

```text
https://app.example.com
https://api.example.com
https://auth.example.com
```

Keuntungan:

- isolation jelas;
- TLS/cert/routing bisa dipisah;
- cache policy bisa dipisah;
- ownership bisa dipisah.

Kerugian:

- CORS;
- cookie domain;
- CSP lebih kompleks;
- more origins -> connection overhead tertentu;
- local dev parity lebih sulit.

### 11.2 Path Routing

```text
https://example.com/app
https://example.com/api
https://example.com/auth
```

Keuntungan:

- same-origin lebih mudah;
- cookie lebih mudah;
- CORS minimal;
- user-facing domain sederhana.

Kerugian:

- path rewrite kompleks;
- app harus aware base path;
- asset path dapat rusak;
- multiple SPA fallback sulit;
- cache rule harus hati-hati per path.

### 11.3 SPA Base Path Bug

Jika app dipasang di:

```text
https://example.com/portal/
```

Tapi build menganggap root:

```text
/assets/app.js
```

Maka browser request:

```text
https://example.com/assets/app.js
```

Padahal seharusnya:

```text
https://example.com/portal/assets/app.js
```

Solusi:

- configure base path pada bundler/router;
- test refresh nested route;
- test direct deep link;
- test asset loading;
- test service worker scope.

---

## 12. SPA Fallback Routing

SPA memakai client-side routing:

```text
/orders/123
/settings/profile
/admin/users
```

Server/CDN harus melayani `index.html` untuk navigation route.

Tetapi tidak semua 404 boleh berubah jadi `index.html`.

### 12.1 Fallback yang Salah

```text
All unknown paths -> index.html
```

Masalah:

```text
/api/unknown -> index.html
/assets/missing.js -> index.html
/favicon.ico missing -> index.html
```

Akibat:

- API caller dapat HTML;
- JS chunk missing berubah jadi HTML 200;
- monitoring 404 hilang;
- security scanner bingung;
- cache bisa menyimpan response salah.

### 12.2 Fallback yang Lebih Baik

Fallback hanya jika:

- method `GET`;
- request adalah navigation;
- `Accept` mencakup `text/html`;
- path bukan `/api/*`;
- path bukan asset extension known;
- path bukan internal health/static endpoint.

Pseudo-rule:

```text
GET /api/*          -> API
GET /assets/*       -> static asset or 404
GET /* Accept html  -> index.html
OTHER               -> 404/405
```

### 12.3 Test Minimal

Harus dites:

```text
GET /orders/123                  -> 200 text/html index.html
GET /assets/missing.js           -> 404, not HTML index
GET /api/missing                  -> API 404 JSON/problem, not HTML index
POST /orders/123                 -> 404/405, not index.html
GET /orders/123 Accept: json     -> probably 404, not index.html
```

---

## 13. CORS per Environment

CORS harus dianggap config keamanan, bukan “fix browser error”.

### 13.1 Bad Pattern

```text
allowedOrigins = *
allowedMethods = *
allowedHeaders = *
allowCredentials = true
```

Ini sering muncul karena ingin cepat unblock local dev.

### 13.2 Better Pattern

```yaml
local:
  allowedOrigins:
    - http://localhost:5173
    - http://127.0.0.1:5173
  allowCredentials: true

dev:
  allowedOrigins:
    - https://app.dev.example.com
  allowCredentials: true

staging:
  allowedOrigins:
    - https://app.staging.example.com
  allowCredentials: true

prod:
  allowedOrigins:
    - https://app.example.com
  allowCredentials: true
```

### 13.3 Dynamic Origin Reflection

Be careful dengan pattern:

```text
Access-Control-Allow-Origin: <whatever Origin request sent>
```

Ini aman hanya jika origin divalidasi terhadap allowlist.

Jika tidak, artinya semua origin boleh membaca response.

### 13.4 `Vary: Origin`

Jika server mengembalikan `Access-Control-Allow-Origin` berbeda berdasarkan request `Origin`, response perlu `Vary: Origin` agar shared cache/CDN tidak menyajikan header CORS untuk origin yang salah.

Tanpa ini:

```text
Request dari https://app-a.example.com -> response cached dengan ACAO: app-a
Request dari https://app-b.example.com -> CDN serve response cached dengan ACAO: app-a
Browser app-b gagal CORS
```

Atau skenario lebih buruk: response personalized cached salah.

---

## 14. Cookie per Environment

Cookie adalah salah satu sumber bug environment paling sering.

### 14.1 Domain

```http
Set-Cookie: SESSION=abc; Domain=.example.com; Path=/; Secure; HttpOnly; SameSite=Lax
```

Tidak akan bekerja untuk:

```text
app.localhost
localhost
staging.example.net
```

Cookie Domain harus domain-match host request.

### 14.2 Host-only Cookie

Jika tanpa `Domain`:

```http
Set-Cookie: SESSION=abc; Path=/; Secure; HttpOnly; SameSite=Lax
```

Cookie hanya berlaku untuk host yang menyetel cookie.

Ini sering lebih aman.

### 14.3 SameSite

Scenario:

```text
Frontend: https://app.example.com
API:      https://api.example.com
```

Mereka cross-origin tetapi same-site jika schemeful site sama-sama `https://example.com`.

Scenario:

```text
Frontend: http://localhost:5173
API:      https://api.dev.example.com
```

Ini cross-site.

Cookie behavior berubah.

### 14.4 Secure

Cookie dengan `Secure` hanya dikirim via HTTPS, kecuali browser local special cases tertentu.

Production cookie auth harus menggunakan `Secure`.

Jangan desain production auth berdasarkan toleransi localhost.

### 14.5 Cookie Path

Jika auth service menyetel:

```http
Set-Cookie: SESSION=abc; Path=/auth
```

Cookie tidak akan dikirim ke:

```text
/api/me
```

Kecuali path matching sesuai.

Bug ini sering terjadi saat path rewriting auth/API berbeda antara staging dan prod.

### 14.6 Checklist Cookie Debugging

Di DevTools Application/Storage:

- apakah cookie ada?
- host/domain apa?
- path apa?
- Secure?
- HttpOnly?
- SameSite?
- expiry?
- partitioned?
- blocked reason?

Di Network request:

- apakah request membawa `Cookie`?
- apakah response membawa `Set-Cookie`?
- apakah browser menolak `Set-Cookie`?
- apakah response credentialed CORS valid?

---

## 15. Dev Server Proxy

Frontend dev server seperti Vite/Webpack/Next dev sering punya proxy.

Contoh:

```text
Browser -> http://localhost:5173/api/me
Dev proxy -> http://localhost:8080/api/me
```

Dari browser:

```text
API terlihat same-origin dengan frontend dev server.
```

Jadi CORS tidak terjadi di browser.

### 15.1 Keuntungan

- local dev lebih mudah;
- tidak perlu CORS local;
- cookie path bisa lebih mirip same-origin production;
- frontend code bisa pakai relative URL `/api/me`.

### 15.2 Risiko

Dev proxy bisa menyembunyikan bug production:

- production subdomain split but local same-origin;
- CORS tidak pernah dites;
- cookie SameSite cross-origin tidak pernah dites;
- gateway header berbeda;
- path rewrite berbeda;
- HTTPS tidak dites.

### 15.3 Rule

Dev proxy bagus jika production juga same-origin/path-routed.

Jika production cross-origin, Anda tetap perlu environment test yang benar-benar cross-origin.

---

## 16. Environment Config untuk Frontend

Frontend berbeda dari backend: konfigurasi yang masuk ke bundle sering menjadi **public**.

### 16.1 Build-Time Config

Contoh:

```text
VITE_API_BASE_URL=https://api.example.com
```

Nilai ini dimasukkan saat build.

Jika Anda build sekali untuk staging, bundle staging akan mengandung staging URL.

### 16.2 Runtime Config

Alternatif:

```text
/config.json
window.__APP_CONFIG__
server-injected config
```

Keuntungan:

- build artifact bisa sama untuk beberapa environment;
- deployment lebih fleksibel;
- rollback config lebih cepat.

Risiko:

- config harus di-cache dengan benar;
- app boot bergantung pada config fetch;
- config tidak boleh mengandung secret;
- config harus tervalidasi.

### 16.3 Secret Tidak Boleh di Frontend

Semua yang dikirim ke browser dapat dibaca user.

Jangan taruh:

- client secret confidential OAuth;
- database password;
- internal API keys;
- signing secret;
- private service token.

Boleh taruh public identifiers:

- public API base URL;
- public OAuth client id untuk SPA flow;
- feature flag public;
- observability public ingest key jika memang dirancang publik.

### 16.4 Config Drift

Masalah umum:

```text
local points to dev API
staging points to prod auth
prod points to old CDN host
feature flag service points to wrong tenant
```

Config harus bisa diaudit.

---

## 17. Header Mutation oleh Proxy/Gateway/CDN

HTTP headers sering berubah di tengah jalan.

### 17.1 Header yang Sering Ditambah

```http
X-Request-ID
X-Correlation-ID
traceparent
tracestate
X-Forwarded-For
X-Forwarded-Proto
X-Forwarded-Host
Via
Server-Timing
Cache-Control
Strict-Transport-Security
Content-Security-Policy
```

### 17.2 Header yang Sering Dihapus

```http
Set-Cookie
Authorization
Cookie
Server
X-Powered-By
Access-Control-* sometimes
```

### 17.3 Header yang Sering Ditimpa

```http
Cache-Control
Content-Type
Content-Encoding
Access-Control-Allow-Origin
Location
```

### 17.4 Debugging

Bandingkan response dari:

```bash
curl -i https://origin-internal.example.com/api/me
curl -i https://api.example.com/api/me
curl -i -H 'Origin: https://app.example.com' https://api.example.com/api/me
```

Lalu bandingkan dengan browser DevTools.

Namun ingat: browser memiliki policy layer yang `curl` tidak punya.

---

## 18. Compression Differences

Local dev sering tidak memakai compression.

Production CDN/gateway sering memakai:

- gzip;
- br/Brotli;
- zstd di beberapa setup modern;
- automatic minification;
- image optimization.

### 18.1 Bug Potensial

- `Content-Encoding` salah;
- compressed response dikirim dua kali;
- incorrect `Content-Length` setelah compression;
- range request rusak;
- sourcemap serving berbeda;
- already-compressed assets dikompres ulang;
- CDN tidak compress karena missing MIME type.

### 18.2 Frontend Symptoms

- JS gagal parse;
- CSS tidak load;
- browser menampilkan `ERR_CONTENT_DECODING_FAILED`;
- download file corrupt;
- hanya terjadi di production.

---

## 19. Source Maps di Environment

Source map membantu debugging, tapi punya risiko.

### 19.1 Opsi

```text
local/dev:
  full source map

staging:
  source map protected or internal

prod:
  either hidden source maps uploaded to error monitoring
  or public source maps if risk accepted
```

### 19.2 Risiko Public Source Maps

- source code lebih mudah dibaca;
- internal comments terlihat;
- endpoint internal terlihat;
- feature flag logic terlihat;
- obfuscation hilang.

Tetapi jangan jadikan source map sebagai security boundary.

Jika ada secret di source map, akar masalahnya adalah secret masuk frontend bundle.

---

## 20. Health Checks dan Synthetic Monitoring

Frontend deployment bukan hanya “asset bisa diakses”.

Minimal health perspective:

```text
Can load index.html?
Can load critical JS/CSS assets?
Can fetch runtime config?
Can reach API base URL?
Can complete auth bootstrap?
Can call /me?
Can report telemetry?
```

### 20.1 Synthetic Check yang Lebih Berguna

Daripada hanya:

```text
GET / -> 200
```

Lebih baik:

```text
GET / -> 200 text/html
GET /assets/main.hash.js -> 200 application/javascript
GET /config.json -> 200 application/json with expected environment
GET /api/health/client -> 200 JSON
GET /deep/link/path -> 200 text/html
GET /api/not-found -> JSON 404, not index.html
```

### 20.2 Client-Side Boot Health

Frontend bisa mengirim boot telemetry:

```text
app_loaded
config_loaded
api_bootstrap_success
auth_state_resolved
chunk_load_error
service_worker_version
```

Ini membantu mendeteksi masalah yang tidak terlihat dari backend health check.

---

## 21. Observability Antar Environment

Setiap environment harus mudah dibedakan dari telemetry.

Tambahkan metadata:

```text
environment: local/dev/staging/prod
app_version: git sha / release version
build_time
config_version
cdn_pop / edge region if available
api_base_url hash or label
trace_id
correlation_id
```

### 21.1 Jangan Mengandalkan URL Saja

Jika staging dan prod memakai domain yang mirip, telemetry tanpa environment label bisa menyesatkan.

### 21.2 Correlation Across Layers

Ideal:

```text
Browser error event contains trace id
API request sends traceparent
Gateway logs trace id
Java service logs trace id
Backend error has same trace id
```

Tanpa ini, production debugging menjadi manual archaeology.

---

## 22. Local HTTPS

Banyak fitur browser butuh secure context.

Contoh:

- service worker;
- WebAuthn;
- certain clipboard APIs;
- geolocation behavior;
- notification/push;
- secure cookies;
- mixed content parity;
- OAuth redirect parity.

### 22.1 Kapan Local HTTPS Perlu?

Gunakan local HTTPS jika sedang mengerjakan:

- auth cookie production-like;
- service worker/PWA;
- WebAuthn/passkey;
- payment/browser secure APIs;
- iframe security policy;
- mixed content debugging;
- HSTS-like behavior;
- same-site HTTPS parity.

### 22.2 Risiko Mengabaikan HTTPS di Local

Bug muncul terlambat di staging/prod:

```text
Works on http://localhost
Fails on https://app.example.com
```

Karena production mengaktifkan:

- HSTS;
- Secure cookies;
- mixed content blocking;
- stricter CSP;
- service worker scope;
- secure context requirements.

---

## 23. Corporate Proxy dan Enterprise Network

Di enterprise, browser user bisa berada di balik:

- corporate proxy;
- TLS inspection/MITM appliance;
- DNS filtering;
- WAF;
- VPN;
- captive portal;
- endpoint security extension;
- browser managed policy.

### 23.1 Symptoms

- certificate error hanya untuk sebagian user;
- API 403 dari WAF, bukan backend;
- response body diganti proxy;
- request header ditambah/dihapus;
- WebSocket gagal;
- HTTP/3 disabled;
- large upload timeout;
- source map blocked;
- telemetry endpoint blocked.

### 23.2 Design Implication

Frontend reliability harus menerima bahwa network path tidak steril.

Butuh:

- timeout;
- retry safe;
- clear error state;
- fallback transport jika perlu;
- correlation ID;
- diagnostic screen/log export;
- graceful degradation.

---

## 24. Common Environment-Only Incident Patterns

### 24.1 Pattern A — Postman Berhasil, Browser Gagal

Kemungkinan:

- CORS;
- cookies/credentials;
- mixed content;
- preflight blocked;
- browser forbidden header;
- redirect blocked by fetch/CORS;
- CSP `connect-src`;
- service worker interception;
- HTTPS certificate trust.

Diagnosis:

```text
Apakah request muncul di Network?
Apakah OPTIONS preflight terjadi?
Apakah response preflight benar?
Apakah actual request terkirim?
Apakah browser console menunjukkan CORS/CSP/mixed content?
Apakah Postman mengirim header/cookie berbeda?
```

### 24.2 Pattern B — Local Berhasil, Staging Gagal

Kemungkinan:

- local dev proxy menyembunyikan CORS;
- staging cookie Domain salah;
- staging HTTPS/cert issue;
- staging gateway path rewrite salah;
- staging auth redirect URL salah;
- CORS allowlist tidak mencakup staging app origin;
- CSP staging lebih ketat;
- API base URL salah.

### 24.3 Pattern C — Staging Berhasil, Production Gagal

Kemungkinan:

- CDN production cache rule berbeda;
- production HSTS aktif;
- production cookie Domain/SameSite berbeda;
- production WAF rule;
- production asset retention berbeda;
- production CSP enforce, staging report-only;
- production auth callback URL belum allowlisted;
- production API rate limit lebih ketat.

### 24.4 Pattern D — Hanya Sebagian User Gagal

Kemungkinan:

- CDN edge tertentu bermasalah;
- browser version difference;
- third-party cookie policy difference;
- enterprise proxy;
- geographic routing;
- cached old asset;
- service worker stale;
- account/tenant-specific config;
- A/B flag.

---

## 25. Practical Debugging Flow

Saat issue environment muncul, gunakan flow berikut.

### Step 1 — Freeze the Coordinates

Catat:

```text
user/browser version
URL page
API URL
environment
timestamp
release version
tenant/account
network type/VPN/corporate proxy
```

### Step 2 — Identify Relation

```text
page origin vs API origin
same-origin?
cross-origin?
same-site?
cross-site?
HTTP or HTTPS?
```

### Step 3 — Inspect Browser Evidence

DevTools:

- Console error;
- Network request;
- preflight;
- request headers;
- response headers;
- cookies included or blocked;
- initiator;
- timing;
- service worker column;
- cache status;
- redirect chain.

### Step 4 — Compare Through Each Hop

Compare:

```text
browser visible response
curl via public URL
curl with Origin header
curl direct to gateway/origin if possible
backend logs
CDN logs
gateway logs
```

### Step 5 — Classify Root Cause

```text
browser policy?
CORS?
cookie?
cache?
redirect?
TLS?
proxy rewrite?
gateway auth?
backend behavior?
frontend config?
```

### Step 6 — Fix at the Right Layer

Do not fix CORS in frontend.

Do not fix cookie Domain with localStorage.

Do not fix CDN cache leak with frontend reload.

Do not fix routing fallback by catching JSON parse errors.

Fix the layer that broke the contract.

---

## 26. Environment Contract Document

Untuk aplikasi serius, buat dokumen kontrak environment.

Template:

```md
# Environment HTTP Contract

## Environment
- Name:
- Purpose:
- Owner:

## Frontend
- Public URL:
- Origin:
- Base path:
- CDN:
- Asset cache policy:
- HTML cache policy:
- Service worker enabled:

## API
- Public API base URL:
- Same-origin/cross-origin:
- CORS allowed origins:
- Credentials mode:
- Auth mechanism:
- Error format:

## Cookies
- Cookie names:
- Domain:
- Path:
- SameSite:
- Secure:
- HttpOnly:
- Partitioned:

## Routing
- SPA fallback rules:
- API path prefix:
- Auth path prefix:
- Static asset prefix:
- Redirect rules:

## Security Headers
- CSP:
- HSTS:
- X-Content-Type-Options:
- X-Frame-Options/frame-ancestors:
- Referrer-Policy:
- Permissions-Policy:

## Proxy/Gateway
- TLS termination:
- Forwarded headers:
- Header mutation:
- Path rewriting:
- Rate limits:

## Observability
- Trace header:
- Correlation ID:
- RUM enabled:
- Source maps:
- Log locations:
```

Dokumen seperti ini mencegah knowledge hanya hidup di kepala infra engineer.

---

## 27. Java/Spring Backend Implication

Sebagai Java engineer, beberapa titik penting:

### 27.1 Forwarded Headers

Spring/Java app di balik proxy perlu tahu original scheme/host.

Jika tidak:

- redirect bisa HTTP;
- generated URL salah;
- OAuth callback salah;
- cookie Secure logic salah.

Pastikan konfigurasi forwarded headers sesuai deployment.

### 27.2 CORS Ordering dengan Security Filter

CORS preflight adalah `OPTIONS` request tanpa credentials.

Jika security filter memblokir OPTIONS sebelum CORS headers ditambahkan, browser akan gagal.

Prinsip:

```text
CORS handling harus terjadi sebelum auth enforcement untuk preflight.
```

### 27.3 Error Format di Gateway vs App

Backend mungkin mengembalikan Problem Details JSON.

Gateway/WAF mungkin mengembalikan HTML error page.

Frontend harus siap membedakan:

```text
Content-Type: application/problem+json
Content-Type: application/json
Content-Type: text/html
```

Tetapi root cause tetap perlu diperbaiki agar gateway errors punya contract yang konsisten jika memungkinkan.

### 27.4 Actuator/Health Jangan Terekspos Sembarangan

Health endpoint untuk infra tidak sama dengan health endpoint untuk browser.

Pisahkan:

```text
/internal/health   -> infra/internal
/client/health     -> safe for frontend synthetic check
```

---

## 28. Anti-Patterns dan Replacement

### Anti-pattern 1 — Hardcoded API URL di Code

Buruk:

```ts
const API = 'https://api.prod.example.com'
```

Lebih baik:

```ts
const API = appConfig.apiBaseUrl
```

Dengan config tervalidasi.

### Anti-pattern 2 — Wildcard CORS untuk Semua Environment

Buruk:

```text
allow all origins because frontend changes often
```

Lebih baik:

```text
explicit allowlist per environment
```

### Anti-pattern 3 — Dev Proxy Menjadi Satu-satunya Test

Buruk:

```text
local works behind proxy, so production should work
```

Lebih baik:

```text
test same-origin and cross-origin topology explicitly sesuai production
```

### Anti-pattern 4 — SPA Fallback untuk Semua 404

Buruk:

```text
any missing path -> index.html
```

Lebih baik:

```text
navigation fallback only; API/assets return proper errors
```

### Anti-pattern 5 — Cache Rule Global

Buruk:

```text
Cache-Control: public, max-age=31536000 for everything
```

Lebih baik:

```text
HTML, assets, API, config, sourcemaps, images punya policy berbeda
```

### Anti-pattern 6 — Production Secret di Frontend Env

Buruk:

```text
VITE_INTERNAL_API_KEY=secret
```

Lebih baik:

```text
secret stays backend-side; browser gets only public config
```

### Anti-pattern 7 — Fix Browser Policy by Weakening Security

Buruk:

```text
CORS error? allow all.
Cookie issue? move token to localStorage.
CSP error? remove CSP.
Mixed content? use HTTP everywhere in dev.
```

Lebih baik:

```text
understand violated invariant; fix contract at correct boundary.
```

---

## 29. Deployment Review Checklist

Sebelum release frontend production, tanyakan:

### Origin and Routing

```text
Apa origin app?
Apa origin API?
Same-origin/cross-origin?
Apakah SPA fallback tidak menangkap API/assets?
Apakah deep link refresh berhasil?
Apakah base path benar?
```

### CORS

```text
Apakah origin production ada di allowlist?
Apakah localhost hanya di non-prod?
Apakah credentials + ACAO eksplisit benar?
Apakah Vary: Origin ada jika origin dinamis?
Apakah OPTIONS tidak diblokir auth/WAF?
```

### Cookies/Auth

```text
Apakah Domain/Path/SameSite/Secure benar?
Apakah cookie dikirim pada request aktual?
Apakah logout menghapus cookie dengan atribut yang sama?
Apakah cross-site local/staging behavior dites?
```

### Cache/CDN

```text
Apakah index.html tidak cached terlalu lama?
Apakah hashed assets cached panjang?
Apakah API personalized tidak public cached?
Apakah config.json punya cache policy tepat?
Apakah old assets punya retention window?
```

### Security

```text
HTTPS penuh dari browser ke edge?
HSTS benar?
CSP benar?
Mixed content tidak ada?
X-Content-Type-Options nosniff?
frame-ancestors/X-Frame-Options sesuai?
```

### Observability

```text
App version terlihat di telemetry?
Trace/correlation ID propagated?
Server-Timing jika relevan?
Chunk load error dimonitor?
RUM aktif?
Source maps strategy jelas?
```

### Reliability

```text
Timeout/retry/cancel policy ada?
429/Retry-After dihormati?
Gateway errors diparse aman?
Offline/captive portal handled?
```

---

## 30. Case Study: Login Works Locally, Fails in Production

### Symptom

User login berhasil. Backend return 200. Tapi setelah redirect ke app, user tetap anonymous.

### Topology

Local:

```text
http://localhost:5173 -> dev proxy -> http://localhost:8080
same-origin from browser perspective
```

Production:

```text
https://app.example.com -> https://api.example.com
cross-origin same-site
```

### Evidence

Network response login:

```http
HTTP/1.1 200 OK
Set-Cookie: SESSION=abc; Path=/api; HttpOnly; SameSite=Lax
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Credentials: true
```

Next request:

```text
GET https://api.example.com/me
Cookie not sent
```

### Root Cause

Cookie `Path=/api` mungkin hanya dikirim untuk `/api/*`, tetapi login/me path sebenarnya berbeda setelah gateway rewrite.

Atau cookie Domain host-only diset oleh `auth.example.com`, lalu diharapkan terkirim ke `api.example.com`.

Atau frontend tidak memakai `credentials: 'include'`.

### Correct Fix

Tentukan cookie scope sesuai topology:

```http
Set-Cookie: SESSION=abc; Domain=.example.com; Path=/; Secure; HttpOnly; SameSite=Lax
```

Atau gunakan BFF same-origin sehingga cookie host-only cukup.

Dan pastikan frontend request credentialed jika cross-origin:

```ts
fetch('https://api.example.com/me', { credentials: 'include' })
```

---

## 31. Case Study: API Returns 200 but UI Crashes Parsing JSON

### Symptom

```text
Unexpected token '<' at JSON.parse
```

### Evidence

Network:

```http
GET /api/orders
HTTP/1.1 200 OK
Content-Type: text/html

<!doctype html>
```

### Root Cause

SPA fallback menangkap `/api/orders` dan mengembalikan `index.html`.

### Correct Fix

Routing order:

```text
/api/* -> backend
/assets/* -> static or 404
navigation fallback -> index.html
```

Frontend tetap bisa memperbaiki error handling agar menampilkan pesan lebih baik, tetapi root fix ada di routing.

---

## 32. Case Study: Only Production Has CORS Error

### Symptom

Staging OK. Production CORS error.

### Evidence

Production response:

```http
Access-Control-Allow-Origin: https://app.staging.example.com
```

Padahal request origin:

```http
Origin: https://app.example.com
```

### Root Cause

CDN cached response CORS header dari staging/previous origin atau config allowlist salah.

Jika dynamic origin reflection dipakai tanpa `Vary: Origin`, shared cache bisa menyajikan CORS header yang salah.

### Correct Fix

- explicit production allowlist;
- `Vary: Origin`;
- purge CDN cache jika response sudah terlanjur cached;
- add synthetic check dengan `Origin` production.

---

## 33. Capstone Exercise

Desain environment HTTP contract untuk aplikasi berikut:

```text
Aplikasi: Enterprise Case Management SPA
Frontend prod: https://case.example.com
API prod: https://case.example.com/api
Auth: https://case.example.com/auth
CDN: same host behind CDN
Backend: Java/Spring services behind API gateway
Requirement:
  - cookie session auth
  - no CORS for main API
  - service worker disabled initially
  - hashed assets
  - runtime config
  - CSP enforce
  - RUM telemetry
  - OAuth/OIDC login via same-origin BFF
```

Jawab:

1. Apa origin app dan API?
2. Apakah CORS dibutuhkan?
3. Cookie attribute apa yang digunakan?
4. Bagaimana cache policy untuk `index.html`, assets, `/config.json`, dan `/api/me`?
5. Bagaimana SPA fallback rule?
6. Header security apa yang wajib?
7. Header observability apa yang dikirim browser/API?
8. Apa synthetic checks minimal?
9. Apa risiko deployment terbesar?
10. Bagaimana rollback aman jika asset chunk mismatch?

---

## 34. Ringkasan Mental Model

Deployment HTTP frontend bukan hanya proses menaruh file JS/CSS ke server.

Ia adalah penyusunan pipeline:

```text
browser policy
  + origin/site model
  + TLS/security context
  + cache layers
  + proxy/gateway routing
  + cookie/auth scope
  + CORS/security headers
  + CDN behavior
  + observability propagation
  + environment config
```

Top 1% engineer tidak berhenti pada:

```text
endpoint-nya apa?
```

Mereka bertanya:

```text
Dari origin mana request dibuat?
Lewat hop apa saja?
Header apa yang berubah?
Siapa yang cache?
Cookie scope-nya apa?
Fallback route-nya apa?
TLS terminate di mana?
Apakah environment ini meniru production topology?
Apa bukti dari browser, CDN, gateway, dan backend?
```

Jika Anda bisa menjawab itu, Anda tidak hanya debugging HTTP. Anda sedang memodelkan sistem distribusi end-to-end dari sudut pandang browser.

---

## 35. Referensi

Referensi yang relevan untuk bagian ini:

- RFC 9110 — HTTP Semantics.
- RFC 9111 — HTTP Caching.
- MDN — Cross-Origin Resource Sharing.
- MDN — Access-Control-Allow-Origin.
- MDN — Set-Cookie.
- MDN — Using HTTP cookies.
- MDN — Cache-Control.
- MDN — Mixed Content.
- MDN — Secure Contexts.
- MDN — HTTP Strict Transport Security.
- web.dev — Prevent unnecessary network requests with the HTTP Cache.
- OWASP — HTTP Security Response Headers Cheat Sheet.
- OWASP — Cross-Site Request Forgery Prevention Cheat Sheet.

---

## 36. Status Seri

```text
Part 033 selesai.
Seri belum selesai.
Lanjut ke Part 034: Case Studies: Diagnosing Real Browser HTTP Incidents.
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-http-for-web-frontend-perspective-part-032.md">⬅️ Part 032 — Testing HTTP Behavior in Frontend Systems</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-http-for-web-frontend-perspective-part-034.md">Part 034 — Case Studies: Diagnosing Real Browser HTTP Incidents ➡️</a>
</div>
