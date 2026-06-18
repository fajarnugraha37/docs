# learn-http-for-web-frontend-perspective-part-034.md

# Part 034 — Case Studies: Diagnosing Real Browser HTTP Incidents

> Seri: `learn-http-for-web-frontend-perspective`  
> Bagian: `034 / 035`  
> Fokus: diagnosis insiden HTTP nyata dari perspektif browser/frontend  
> Target pembaca: Java software engineer / tech lead yang ingin mampu menganalisis bug browser HTTP secara sistematis, bukan sekadar menebak konfigurasi

---

## 0. Posisi Bagian Ini dalam Seri

Bagian sebelumnya sudah membangun komponen-komponen individual:

- URL, origin, site, scheme, host, port.
- HTTP message model.
- Method, status code, header, body.
- Fetch, form, navigation, beacon, XHR.
- CORS, cookies, auth, CSRF.
- Cache, redirect, content negotiation.
- Resource loading, HTTP/1.1, HTTP/2, HTTP/3.
- TLS, security headers, isolation policies.
- API design, mutation, error contract.
- Streaming, service worker, observability, performance, reliability.
- Frontend HTTP client architecture.
- Testing.
- Deployment, proxy, gateway, local development.

Part ini mengubah semua itu menjadi **incident diagnosis capability**.

Tujuannya bukan menghafal daftar error. Tujuannya membangun cara berpikir:

> “Gejala ini terlihat di frontend, tetapi boundary mana yang sebenarnya melanggar invariant?”

Dalam sistem web modern, banyak bug terlihat sama dari sisi user:

- login gagal;
- API gagal;
- loading lambat;
- data stale;
- halaman putih;
- request pending;
- hasil search salah;
- user tiba-tiba logout;
- file upload stuck;
- font/image tidak muncul;
- hanya gagal di production;
- hanya gagal di Safari;
- hanya gagal setelah release;
- hanya gagal di jaringan kantor;
- hanya gagal saat memakai domain tertentu.

Tetapi akar masalahnya bisa sangat berbeda:

- browser policy;
- CORS;
- cookies;
- SameSite;
- redirect;
- cache;
- service worker;
- CDN;
- gateway;
- TLS;
- CSP;
- CORP/COEP/COOP;
- fetch client bug;
- race condition;
- auth refresh;
- backend status code misuse;
- API contract drift;
- proxy header rewriting;
- stale deployment asset;
- DNS/connection/TLS latency;
- third-party script blocking;
- observability gap.

Top 1% engineer tidak hanya bertanya:

> “Errornya apa?”

Tapi bertanya:

> “Apa evidence paling dekat ke boundary yang gagal?”

---

## 1. Diagnosis Philosophy: Jangan Mulai dari Fix

Kesalahan umum ketika debugging HTTP frontend adalah langsung melompat ke fix:

- “Tambahin `Access-Control-Allow-Origin: *`.”
- “Pakai `no-cors`.”
- “Clear cache.”
- “Disable service worker.”
- “Ganti ke POST.”
- “Tambah retry.”
- “Refresh token saja.”
- “Set cookie domain ke `.example.com`.”
- “Proxy lewat backend.”
- “Matikan CSP dulu.”

Kadang fix ini bekerja secara lokal, tetapi merusak invariant di production.

Diagnosis yang baik dimulai dari model berikut:

```text
User symptom
  ↓
Browser evidence
  ↓
Protocol evidence
  ↓
Policy evidence
  ↓
Infrastructure evidence
  ↓
Server/application evidence
  ↓
Root cause
  ↓
Minimal safe fix
  ↓
Regression prevention
```

Jangan hanya mencari “apa yang membuat error hilang”. Cari **boundary mana yang memberi sinyal salah**.

---

## 2. Universal Incident Template

Untuk setiap kasus, gunakan template ini.

### 2.1 Symptom

Apa yang user lihat?

Contoh:

```text
User klik Login, backend mengembalikan 200, tetapi UI tetap menampilkan anonymous state.
```

Symptom harus ditulis dari perspektif user atau sistem eksternal, bukan asumsi teknis.

Buruk:

```text
CORS error.
```

Lebih baik:

```text
Browser memblokir pembacaan response login dari origin app ke origin API. Request terlihat terkirim, tetapi JavaScript tidak menerima response usable.
```

### 2.2 Scope

Siapa yang terkena?

- Semua user?
- Hanya browser tertentu?
- Hanya mobile?
- Hanya production?
- Hanya staging?
- Hanya domain custom?
- Hanya user login lama?
- Hanya setelah deployment?
- Hanya first visit?
- Hanya refresh?
- Hanya request dengan attachment?
- Hanya jaringan kantor/VPN?

Scope sering lebih berguna daripada stack trace.

### 2.3 Timeline

Kapan mulai terjadi?

- Setelah frontend release?
- Setelah backend release?
- Setelah CDN config change?
- Setelah certificate renewal?
- Setelah cookie/SameSite change?
- Setelah browser update?
- Setelah enabling CSP?
- Setelah moving API domain?
- Setelah changing gateway route?

Timeline membantu membedakan:

```text
code regression vs configuration regression vs environment regression vs browser behavior change
```

### 2.4 Browser Evidence

Ambil evidence dari:

- DevTools Console.
- DevTools Network.
- Application tab:
  - cookies;
  - localStorage/sessionStorage;
  - IndexedDB;
  - service worker;
  - Cache Storage.
- Security tab.
- Performance tab.
- HAR export.
- Resource Timing.

### 2.5 HTTP Evidence

Untuk request/response terkait:

- URL final.
- Method.
- Status code.
- Request headers.
- Response headers.
- Request body.
- Response body.
- Redirect chain.
- Timing.
- Protocol: HTTP/1.1, HTTP/2, HTTP/3.
- Remote address / connection reuse.
- Initiator.
- Priority.
- Transfer size vs resource size.
- From memory cache/disk cache/service worker.

### 2.6 Policy Evidence

Browser policy yang mungkin terlibat:

- CORS.
- Same-Origin Policy.
- Cookie SameSite.
- Secure Context.
- Mixed Content.
- CSP.
- CORP/COEP/COOP.
- Fetch Metadata.
- Referrer Policy.
- Permissions Policy.
- MIME sniffing protection.
- Service worker scope.

### 2.7 Infrastructure Evidence

Cek layer luar aplikasi:

- CDN.
- Reverse proxy.
- API gateway.
- Load balancer.
- TLS termination.
- WAF.
- Ingress.
- Service mesh.
- Edge function.
- Static hosting.
- DNS.

Pertanyaan penting:

```text
Apakah header yang dikirim backend sama dengan header yang diterima browser?
```

Jika tidak, masalahnya mungkin bukan di kode backend atau frontend, tetapi di middle layer.

### 2.8 Server Evidence

Cek:

- access log;
- application log;
- gateway log;
- auth log;
- session store;
- trace ID;
- correlation ID;
- idempotency key;
- database transaction;
- cache hit/miss;
- upstream timeout;
- rate limit decision;
- user agent;
- origin header;
- referer;
- cookie presence.

### 2.9 Root Cause

Root cause harus menjelaskan **mechanism**, bukan sekadar komponen.

Buruk:

```text
CORS salah.
```

Baik:

```text
Frontend mengirim credentialed cross-origin request dari https://app.example.com ke https://api.example.com dengan credentials: include, tetapi API mengembalikan Access-Control-Allow-Origin: * dan tidak mengembalikan Access-Control-Allow-Credentials: true. Browser mengirim request, server memprosesnya, tetapi browser menolak expose response ke JavaScript karena credentialed CORS tidak valid.
```

### 2.10 Prevention

Setiap insiden harus berakhir dengan guardrail:

- automated test;
- contract test;
- gateway config lint;
- CSP report monitor;
- CORS integration test;
- cache header assertion;
- release checklist;
- synthetic monitor;
- observability field;
- dashboard;
- alert;
- runbook;
- architecture decision record.

---

# Case 1 — Login Sukses di Backend, tetapi User Tetap Anonymous

## Symptom

User klik login. Network tab menunjukkan endpoint login mengembalikan `200 OK`. Response body terlihat berisi data user atau token. Tetapi setelah redirect/refresh, UI tetap menganggap user belum login.

Variasi umum:

- login berhasil di Postman;
- login berhasil di same-domain local dev;
- gagal di staging yang memakai subdomain berbeda;
- cookie terlihat di response `Set-Cookie`, tetapi tidak muncul di Application → Cookies;
- cookie tersimpan, tetapi tidak dikirim pada request berikutnya;
- hanya gagal di browser tertentu;
- hanya gagal untuk iframe embedded login.

## Mental Model

Login berbasis cookie membutuhkan beberapa hal benar sekaligus:

```text
server sends Set-Cookie
  ↓
browser accepts cookie
  ↓
browser stores cookie under correct domain/path/site partition
  ↓
frontend sends later request with appropriate credentials mode
  ↓
browser decides cookie is eligible for that request
  ↓
server receives Cookie header
  ↓
server maps cookie to valid session
  ↓
frontend updates auth state
```

Jika salah satu langkah gagal, user terlihat anonymous.

## Evidence yang Harus Dicari

### Di response login

Cek header:

```http
Set-Cookie: session=...; Path=/; HttpOnly; Secure; SameSite=None
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Credentials: true
Vary: Origin
```

### Di request login dari frontend

Cek apakah fetch/XHR memakai credentials:

```ts
await fetch("https://api.example.com/login", {
  method: "POST",
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload)
});
```

Default `fetch()` adalah tidak selalu mengirim cross-origin credentials. Untuk cookie cross-origin, `credentials: "include"` biasanya dibutuhkan.

### Di Application tab

Cek cookie:

- domain;
- path;
- expiry;
- SameSite;
- Secure;
- HttpOnly;
- Partitioned;
- blocked reason;
- priority;
- apakah cookie benar-benar tersimpan.

### Di request setelah login

Cek apakah request berikutnya membawa:

```http
Cookie: session=...
```

Jika tidak, masalahnya ada di acceptance/storing/eligibility/credentials mode.

Jika iya, tetapi server tetap menganggap anonymous, masalahnya ada di session validation/server-side auth.

## Common Root Causes

### Root Cause A — Cookie Cross-Site tetapi SameSite Bukan None

Contoh:

```http
Set-Cookie: session=abc; Path=/; HttpOnly; Secure; SameSite=Lax
```

Jika app dan API dianggap cross-site dalam skenario tertentu, cookie tidak dikirim untuk request subresource/fetch cross-site.

Fix:

```http
Set-Cookie: session=abc; Path=/; HttpOnly; Secure; SameSite=None
```

Catatan penting:

- `SameSite=None` harus disertai `Secure` di browser modern.
- `Secure` butuh HTTPS, kecuali perlakuan khusus localhost.

### Root Cause B — CORS Credentialed Response Tidak Valid

Contoh salah:

```http
Access-Control-Allow-Origin: *
Access-Control-Allow-Credentials: true
```

Untuk credentialed CORS, wildcard origin tidak valid. Server harus mengembalikan origin spesifik.

Benar:

```http
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Credentials: true
Vary: Origin
```

`Vary: Origin` penting jika response bisa berbeda berdasarkan `Origin`, terutama melalui CDN/shared cache.

### Root Cause C — Frontend Tidak Menggunakan `credentials: "include"`

Contoh salah:

```ts
fetch("https://api.example.com/me");
```

Untuk cross-origin cookie request:

```ts
fetch("https://api.example.com/me", {
  credentials: "include"
});
```

### Root Cause D — Cookie Domain Salah

Backend mengirim:

```http
Set-Cookie: session=abc; Domain=api.example.com; Path=/
```

Cookie tersebut hanya berlaku untuk `api.example.com` dan subdomain terkait sesuai aturan domain matching, bukan otomatis untuk `app.example.com`.

Jika arsitektur membutuhkan cookie shared antar subdomain, perlu desain domain yang benar, misalnya:

```http
Set-Cookie: session=abc; Domain=.example.com; Path=/; Secure; HttpOnly; SameSite=Lax
```

Tetapi ini harus diputuskan hati-hati karena memperluas scope cookie ke subdomain lain.

Untuk auth yang lebih defensible, sering lebih baik memakai BFF di same-origin app agar cookie host-only tetap sempit.

### Root Cause E — Login Response Di-Redirect ke Domain Lain

Flow:

```text
POST /login
  -> 302 https://idp.example.net/...
  -> 302 https://api.example.com/callback
```

Fetch redirect dan browser navigation redirect tidak selalu punya behavior yang sama untuk cookies, CORS, dan visibility response.

Jika login adalah browser navigation flow, jangan memaksanya menjadi `fetch()` kecuali flow memang didesain untuk AJAX login.

## Debugging Checklist

1. Apakah `Set-Cookie` terlihat di response?
2. Apakah browser menandai cookie sebagai blocked?
3. Apakah response CORS valid untuk credentialed request?
4. Apakah frontend memakai `credentials: "include"`?
5. Apakah cookie domain/path cocok dengan request berikutnya?
6. Apakah SameSite cocok dengan site relationship?
7. Apakah request berikutnya membawa `Cookie`?
8. Apakah server menerima cookie?
9. Apakah session store berisi session valid?
10. Apakah UI auth state menunggu `/me` atau hanya percaya response login?

## Prevention

- Buat integration test browser untuk login cross-origin.
- Assert CORS header di staging/prod.
- Monitor rejected/blocked cookies jika memungkinkan.
- Gunakan auth state machine eksplisit.
- Hindari wildcard CORS untuk credentialed endpoint.
- Dokumentasikan topology auth per environment.

---

# Case 2 — API Berhasil di Postman/cURL, Gagal di Browser

## Symptom

Developer berkata:

```text
API-nya jalan. Di Postman sukses. Di browser gagal.
```

Console menampilkan error seperti:

```text
Access to fetch at 'https://api.example.com/data' from origin 'https://app.example.com' has been blocked by CORS policy...
```

## Mental Model

Postman dan cURL bukan browser.

Mereka tidak menerapkan browser security policy seperti:

- Same-Origin Policy;
- CORS read blocking;
- preflight;
- forbidden request headers;
- cookie SameSite browser enforcement;
- mixed content blocking;
- CSP;
- CORP/COEP;
- credentialed fetch constraints.

Jadi kalimat “berhasil di Postman” hanya membuktikan:

```text
server reachable and can produce a response for that client
```

Bukan membuktikan:

```text
browser is allowed to expose that response to JavaScript
```

## Evidence

Cek apakah browser membuat preflight:

```http
OPTIONS /data HTTP/1.1
Origin: https://app.example.com
Access-Control-Request-Method: GET
Access-Control-Request-Headers: authorization
```

Jika preflight gagal, actual request bisa tidak dikirim.

Jika actual request dikirim, response tetap bisa tidak diekspos ke JS jika CORS response header salah.

## Common Root Causes

### Root Cause A — Missing `Access-Control-Allow-Origin`

Server tidak mengembalikan:

```http
Access-Control-Allow-Origin: https://app.example.com
```

Browser menolak expose response.

### Root Cause B — Preflight Tidak Didukung Gateway

Backend mendukung endpoint `GET /data`, tetapi gateway tidak mengizinkan `OPTIONS /data`.

Akibatnya:

```text
OPTIONS returns 404/405/401/403
actual request never happens
```

Fix:

- Handle OPTIONS di edge/gateway/backend.
- Pastikan CORS middleware berjalan sebelum auth middleware untuk preflight.
- Jangan memaksa preflight membawa cookie/token.

### Root Cause C — Custom Header Memicu Preflight

Contoh:

```ts
fetch(url, {
  headers: {
    "X-Client-Version": "1.2.3"
  }
});
```

Custom header bisa membuat request non-simple dan memicu preflight.

Ini bukan selalu buruk, tetapi harus disadari.

### Root Cause D — `Content-Type: application/json` pada POST Memicu Preflight

Banyak POST JSON akan preflight.

Contoh:

```http
Content-Type: application/json
```

Ini normal. Jangan menganggap preflight sebagai bug.

Bug terjadi jika preflight tidak ditangani dengan benar.

### Root Cause E — Authorization Header Tidak Diizinkan

Browser preflight meminta:

```http
Access-Control-Request-Headers: authorization
```

Server harus menjawab:

```http
Access-Control-Allow-Headers: Authorization, Content-Type
```

Header name case-insensitive, tetapi konfigurasi server/proxy kadang memperlakukan string secara tidak fleksibel.

## Debugging Checklist

1. Apakah ada OPTIONS sebelum request utama?
2. Status OPTIONS berapa?
3. Response OPTIONS punya CORS header yang benar?
4. Apakah actual request dikirim?
5. Jika actual dikirim, response actual punya CORS header yang benar?
6. Apakah request memakai credentials?
7. Apakah wildcard origin dipakai bersama credentials?
8. Apakah CDN/gateway menghapus header CORS?
9. Apakah error terjadi hanya untuk method/header tertentu?
10. Apakah server log menunjukkan OPTIONS?

## Prevention

- Buat automated browser integration test, bukan hanya API test.
- Test OPTIONS + actual request.
- CORS config harus environment-aware.
- CORS rule jangan hanya ditaruh di service jika gateway menolak OPTIONS duluan.
- Dokumentasikan header frontend yang memang diperlukan.

---

# Case 3 — Custom Header Menyebabkan Preflight Storm

## Symptom

Setelah menambahkan header baru seperti:

```http
X-Tenant-Id: tenant-a
X-Client-Version: 1.4.0
X-Feature-Flag: abc
```

jumlah request di Network tab melonjak. Banyak endpoint sekarang memiliki request OPTIONS sebelum request utama. Latency terasa naik.

## Mental Model

Preflight adalah round trip tambahan.

Jika setiap API call memicu preflight, waterfall dapat menjadi:

```text
OPTIONS /a  -> GET /a
OPTIONS /b  -> GET /b
OPTIONS /c  -> GET /c
OPTIONS /d  -> GET /d
```

Dampaknya besar terutama jika:

- RTT tinggi;
- API tersebar di banyak origin;
- `Access-Control-Max-Age` kecil atau tidak ada;
- banyak request paralel ke endpoint berbeda;
- mobile network;
- cold browser cache;
- CDN tidak cache preflight secara efektif;
- gateway logging/rate-limit memperlakukan OPTIONS seperti request bisnis.

## Common Root Causes

### Root Cause A — Header Tidak Perlu

Contoh tenant sebenarnya bisa diketahui dari hostname/path/token claim, tetapi frontend mengirim `X-Tenant-Id` ke semua request.

Better:

```text
https://tenant-a.example.com
```

atau:

```text
/api/tenants/{tenantId}/...
```

atau claim dalam access token jika cocok dengan threat model.

### Root Cause B — Header Observability Dikirim dari Browser Padahal Bisa Dibuat Edge

Contoh:

```http
X-Request-Source: web
X-Client-Version: 1.2.3
```

Jika header ini hanya observability, pertimbangkan:

- inject di BFF;
- masukkan versi client ke query static config;
- gunakan standard header yang sudah safelisted jika relevan;
- kirim hanya untuk endpoint yang perlu.

### Root Cause C — `Access-Control-Max-Age` Tidak Diset

Preflight cache dapat mengurangi OPTIONS berulang.

Contoh:

```http
Access-Control-Max-Age: 600
```

Tetapi jangan menjadikan ini satu-satunya solusi. Preflight cache behavior bisa berbeda antar browser dan dapat dibatasi.

## Diagnostic Questions

1. Header mana yang mulai memicu preflight?
2. Apakah header itu benar-benar perlu dari browser?
3. Apakah semua endpoint butuh header itu?
4. Bisa dipindahkan ke URL/path/token/BFF/edge?
5. Apakah preflight cache aktif?
6. Apakah OPTIONS kena auth/rate limit/log mahal?
7. Apakah custom header merusak CDN cache key?

## Prevention

- Review setiap custom request header sebagai performance/security decision.
- Buat lint rule di HTTP client layer.
- Observability header browser harus minimal dan intentional.
- Monitor ratio OPTIONS:actual request.

---

# Case 4 — CDN Cache Membocorkan Personalized Response

## Symptom

User A melihat data User B.

Atau:

- dashboard user salah;
- avatar/nama user tertukar;
- response `/me` dari cache;
- hanya terjadi di production melalui CDN;
- tidak terjadi saat cache disabled;
- tidak terjadi di local/staging tanpa CDN.

Ini salah satu insiden HTTP paling serius.

## Mental Model

Response personalized tidak boleh masuk shared cache kecuali cache key benar-benar memisahkan user, dan itu jarang aman untuk response auth umum.

Shared cache seperti CDN tidak sama dengan browser private cache.

Jika response user-specific dikirim dengan header cacheable, CDN bisa menyimpan response dan memberikannya ke user lain.

## Evidence

Cek response header:

```http
Cache-Control: public, max-age=300
```

atau tidak ada cache header tetapi CDN menerapkan default caching.

Cek juga:

```http
Age: 123
X-Cache: HIT
CF-Cache-Status: HIT
Via: ...
```

Jika endpoint personalized memiliki `X-Cache: HIT`, itu red flag.

## Common Root Causes

### Root Cause A — Missing `Cache-Control: private` atau `no-store`

Untuk response session/user-specific sensitif:

```http
Cache-Control: no-store
```

Untuk response user-specific yang boleh disimpan browser tetapi tidak shared cache:

```http
Cache-Control: private, max-age=60
```

Tetapi untuk auth/session endpoint seperti `/me`, `/account`, `/billing`, `/permissions`, sering paling aman:

```http
Cache-Control: no-store
```

### Root Cause B — CDN Cache Rule Terlalu Agresif

Contoh rule:

```text
Cache everything under /api/* for 5 minutes
```

Ini sangat berbahaya jika `/api/*` berisi response personalized.

### Root Cause C — `Authorization`/`Cookie` Tidak Masuk Cache Policy dengan Benar

Banyak CDN secara default tidak cache response dengan Authorization/Cookie, tetapi konfigurasi dapat mengubah ini.

Jangan mengandalkan asumsi. Verifikasi behavior CDN.

### Root Cause D — `Vary` Tidak Lengkap

Jika response berbeda berdasarkan `Origin`, `Accept-Language`, atau header lain, shared cache perlu tahu via `Vary`.

Contoh untuk CORS dynamic origin:

```http
Vary: Origin
```

Untuk localization:

```http
Vary: Accept-Language
```

Tetapi `Vary` bukan solusi untuk personalized user data berbasis cookie jika cache key tidak aman. Untuk data sensitif, prefer `no-store`.

## Minimal Safe Fix

Untuk endpoint user-specific:

```http
Cache-Control: no-store
```

Di CDN:

```text
Bypass cache for /api/auth/*
Bypass cache for /api/me
Bypass cache when Cookie present
Bypass cache when Authorization present
```

Lakukan purge cache segera jika data sudah bocor.

## Prevention

- Contract test untuk cache header pada endpoint sensitif.
- CDN rule review.
- Synthetic test dengan dua user berbeda.
- Monitor HIT pada endpoint yang seharusnya BYPASS.
- Security review untuk caching.

---

# Case 5 — Release Frontend Menyebabkan Chunk 404

## Symptom

Setelah deployment frontend, sebagian user melihat blank page atau error:

```text
Loading chunk 123 failed
```

Network tab:

```text
GET /assets/chunk-abc123.js -> 404
```

Biasanya hanya terjadi pada user yang sudah membuka app sebelum release, atau user yang mendapat HTML lama.

## Mental Model

SPA build modern biasanya menghasilkan:

```text
index.html
assets/main-A.js
assets/chunk-B.js
assets/chunk-C.js
```

`index.html` mereferensikan hashed asset tertentu.

Jika deployment menghapus asset lama terlalu cepat, HTML lama atau runtime lama bisa mencoba memuat chunk yang sudah tidak ada.

Flow bug:

```text
User has old index.html or old JS runtime
  ↓
New deployment removes old chunks
  ↓
User navigates to lazy route
  ↓
Old runtime requests old chunk URL
  ↓
404
  ↓
Blank page / chunk load error
```

## Evidence

Cek:

- apakah `index.html` cached terlalu lama;
- apakah asset filename hashed;
- apakah old chunk masih ada di static hosting;
- apakah service worker menyajikan old app shell;
- apakah CDN edge belum konsisten;
- apakah deployment atomic;
- apakah build cleanup menghapus asset lama;
- apakah response 404 berasal dari origin atau CDN.

## Common Root Causes

### Root Cause A — `index.html` Cached Terlalu Lama

Salah:

```http
Cache-Control: public, max-age=31536000, immutable
```

Untuk HTML SPA, biasanya lebih aman:

```http
Cache-Control: no-cache
```

Artinya browser boleh menyimpan tetapi harus revalidate sebelum menggunakan.

Atau untuk aplikasi yang sangat sensitif:

```http
Cache-Control: no-store
```

Tetapi `no-store` bisa mengorbankan performa dan offline behavior.

### Root Cause B — Static Asset Lama Dihapus Terlalu Cepat

Hashed assets harus boleh disimpan lama:

```http
Cache-Control: public, max-age=31536000, immutable
```

Tetapi karena user lama bisa masih mereferensikan chunk lama, asset lama perlu dipertahankan selama window tertentu.

Strategi:

```text
Keep old hashed assets for N days/releases
Deploy new assets before new HTML
Never delete chunks synchronously with release
```

### Root Cause C — Service Worker Menyajikan App Shell Lama

Service worker mungkin masih meng-cache `index.html` lama atau route shell lama.

Cek DevTools:

```text
Application -> Service Workers
Application -> Cache Storage
Network -> from ServiceWorker
```

### Root Cause D — Non-Atomic Deployment

Jika `index.html` terdeploy sebelum assets, user bisa mendapat HTML baru yang menunjuk asset yang belum tersedia.

Atau asset baru terdeploy, tetapi CDN edge tertentu belum sinkron.

## Fix

- HTML: short cache/revalidate.
- Hashed assets: long immutable.
- Keep old assets.
- Deploy assets first, then HTML.
- Add chunk load error recovery:

```ts
window.addEventListener("error", (event) => {
  const message = String(event.message || "");
  if (message.includes("Loading chunk") || message.includes("Failed to fetch dynamically imported module")) {
    // show controlled reload banner, not infinite reload
  }
});
```

Jangan auto reload infinite. Bisa menyebabkan loop jika asset memang hilang.

## Prevention

- Deployment should be atomic from client perspective.
- E2E smoke test against newly deployed asset graph.
- Keep old assets.
- Monitor 404 for `/assets/*.js` and dynamic imports.
- Test service worker update lifecycle.

---

# Case 6 — Search UI Menampilkan Hasil Lama

## Symptom

User mengetik:

```text
a
ap
app
apple
```

UI akhirnya menampilkan hasil untuk `ap`, bukan `apple`.

Atau user pindah filter cepat, tetapi response lama overwrite state baru.

## Mental Model

HTTP response arrival order tidak selalu sama dengan request issue order.

```text
Request A: q=ap     starts at t1, slow, returns at t5
Request B: q=apple  starts at t2, fast, returns at t3
```

Jika frontend tidak menjaga ordering invariant:

```text
A overwrites B
```

Ini bukan bug HTTP protocol. Ini bug state management di atas HTTP.

## Evidence

Network tab menunjukkan beberapa request search dengan query berbeda. Response lama tiba belakangan.

Cek initiator dan timing.

## Root Causes

### Root Cause A — Tidak Ada Cancellation

Gunakan `AbortController` untuk request yang sudah obsolete.

```ts
let currentController: AbortController | null = null;

async function search(q: string) {
  currentController?.abort();

  const controller = new AbortController();
  currentController = controller;

  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
      signal: controller.signal
    });

    const data = await response.json();

    if (controller.signal.aborted) return;

    renderResults(data);
  } catch (error) {
    if (controller.signal.aborted) return;
    renderError(error);
  }
}
```

### Root Cause B — Tidak Ada Request Sequence Guard

Cancellation tidak selalu cukup. Response bisa sudah selesai saat abort terjadi.

Gunakan sequence:

```ts
let latestSearchSeq = 0;

async function search(q: string) {
  const seq = ++latestSearchSeq;
  const response = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
  const data = await response.json();

  if (seq !== latestSearchSeq) return;

  renderResults(data);
}
```

### Root Cause C — Cache Key Salah di Client Data Layer

Contoh buruk:

```ts
useQuery({ queryKey: ["search"], queryFn: () => search(q) });
```

Seharusnya query memasukkan parameter:

```ts
useQuery({ queryKey: ["search", q], queryFn: () => search(q) });
```

## Prevention

- Semua request berbasis user input cepat harus punya cancellation/sequence guard.
- Query cache key harus memasukkan semua parameter yang memengaruhi response.
- Test race condition dengan artificial delay.
- Jangan menganggap “last request sent == last response received”.

---

# Case 7 — Token Refresh Race Condition

## Symptom

User sedang aktif, lalu banyak request API terjadi bersamaan. Access token expired. Semua request mendapat `401`. Frontend melakukan refresh token berkali-kali. Beberapa berhasil, beberapa gagal. User tiba-tiba logout.

## Mental Model

Refresh token flow adalah distributed concurrency problem dalam browser.

Masalah umum:

```text
Request A gets 401
Request B gets 401
Request C gets 401
A starts refresh
B starts refresh
C starts refresh
Refresh token rotation invalidates old token
Only one refresh should have happened
Other refresh calls now fail
Client interprets failure as logout
```

## Evidence

Network tab:

```text
GET /api/a -> 401
GET /api/b -> 401
GET /api/c -> 401
POST /auth/refresh -> 200
POST /auth/refresh -> 401
POST /auth/refresh -> 401
```

Auth logs menunjukkan refresh token reuse/invalidated token.

## Root Causes

### Root Cause A — No Single-Flight Refresh

Solusi: hanya satu refresh in-flight pada satu waktu.

```ts
let refreshPromise: Promise<void> | null = null;

async function ensureFreshToken() {
  if (!refreshPromise) {
    refreshPromise = refreshToken().finally(() => {
      refreshPromise = null;
    });
  }

  return refreshPromise;
}
```

### Root Cause B — Retrying Non-Idempotent Request Tanpa Idempotency

Jika request mutation gagal karena token expired dan di-retry otomatis, pastikan retry aman.

Untuk POST create/payment/order:

```http
Idempotency-Key: <uuid>
```

atau jangan auto retry tanpa desain.

### Root Cause C — Multiple Tabs Tidak Koordinasi

Tab A refresh token, Tab B juga refresh token.

Solusi:

- BroadcastChannel;
- storage event;
- cookie session + BFF;
- server-side grace window;
- short-lived access token plus robust refresh rotation;
- auth state reconciliation.

## Prevention

- Model auth sebagai state machine:

```text
anonymous
  -> authenticating
  -> authenticated
  -> refreshing
  -> expired
  -> logout_pending
```

- Single-flight refresh.
- Cross-tab coordination.
- Refresh failure classification.
- Explicit retry policy for idempotent vs non-idempotent request.
- Test with 10 concurrent 401 responses.

---

# Case 8 — 302 Login Redirect Membuat `fetch()` Gagal

## Symptom

Session expired. Frontend memanggil API:

```text
GET /api/orders
```

Server mengembalikan redirect ke login:

```http
302 Found
Location: /login
```

Di browser, fetch gagal parsing JSON, atau CORS error muncul, atau response menjadi HTML login page.

## Mental Model

Redirect cocok untuk browser navigation. Tetapi untuk API consumed by JavaScript, redirect ke HTML login page sering menjadi error contract buruk.

Jika API endpoint mengembalikan HTML login page dengan `200 OK`, frontend mengira menerima JSON dan gagal:

```ts
await response.json(); // SyntaxError: Unexpected token '<'
```

## Common Root Causes

### Root Cause A — Backend Security Framework Default Redirect

Framework security sering default:

```text
unauthenticated browser request -> 302 /login
```

Ini bagus untuk server-rendered app, buruk untuk JSON API.

Untuk API, lebih baik:

```http
401 Unauthorized
Content-Type: application/problem+json
```

Body:

```json
{
  "type": "https://example.com/problems/unauthenticated",
  "title": "Authentication required",
  "status": 401,
  "code": "AUTH_REQUIRED"
}
```

### Root Cause B — Cross-Origin Redirect ke IdP

API response redirect ke identity provider:

```text
https://idp.example.com/login
```

Fetch follows redirect by default, tetapi CORS/credentials/response visibility dapat gagal karena final response bukan API CORS response.

Untuk SPA, biasanya lebih baik:

- API return `401` with machine-readable code;
- frontend initiates top-level navigation to login;
- BFF handles OIDC redirect flow;
- avoid hidden AJAX login redirect unless explicitly designed.

## Debugging Checklist

1. Apakah response asli 302?
2. Apakah DevTools menunjukkan redirect chain?
3. Apakah final response HTML?
4. Apakah frontend mencoba parse HTML sebagai JSON?
5. Apakah API seharusnya mengembalikan 401/403?
6. Apakah redirect cross-origin?
7. Apakah fetch `redirect` mode default/follow/manual?

## Prevention

- Pisahkan behavior API dan page navigation.
- API unauthenticated → 401, not 302.
- Page navigation unauthenticated → 302 login.
- Test expired session dari frontend.
- Error client harus cek `Content-Type` sebelum parse JSON.

---

# Case 9 — Font atau Image Blocked karena CORS/CORP/COEP

## Symptom

Di production, font tidak muncul atau image/script/wasm gagal dimuat.

Console:

```text
Access to font at ... from origin ... has been blocked by CORS policy
```

atau:

```text
Cross-Origin Read Blocking / CORP / COEP error
```

## Mental Model

Resource embedding punya aturan berbeda tergantung destination:

- image;
- font;
- script;
- style;
- iframe;
- worker;
- wasm;
- fetch/XHR;
- module script.

Beberapa resource cross-origin boleh dimuat tanpa CORS untuk rendering tertentu, tetapi tidak boleh dibaca oleh JS. Beberapa resource seperti font sering membutuhkan CORS header agar bisa dipakai lintas origin.

Jika aplikasi mengaktifkan COEP/COOP untuk cross-origin isolation, resource cross-origin harus memenuhi CORS atau CORP policy tertentu.

## Evidence

Network tab:

- request URL;
- initiator;
- destination;
- response status;
- `Access-Control-Allow-Origin`;
- `Cross-Origin-Resource-Policy`;
- `Cross-Origin-Embedder-Policy`;
- `Cross-Origin-Opener-Policy`;
- MIME type;
- CSP errors.

## Common Root Causes

### Root Cause A — Font CDN Tidak Mengirim CORS Header

Fix:

```http
Access-Control-Allow-Origin: https://app.example.com
```

atau untuk public static font:

```http
Access-Control-Allow-Origin: *
```

Jika tidak memakai credentials dan resource public, wildcard bisa masuk akal.

### Root Cause B — COEP Enabled tapi Third-Party Resource Tidak Compatible

Jika document memakai:

```http
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Opener-Policy: same-origin
```

Cross-origin resources perlu CORS atau CORP yang cocok.

Resource pihak ketiga yang tidak mengirim header yang dibutuhkan bisa blocked.

### Root Cause C — CSP `font-src` / `img-src` / `script-src` Tidak Mengizinkan Origin

CSP error terlihat di Console.

Contoh:

```http
Content-Security-Policy: default-src 'self'; font-src 'self'
```

Jika font dari CDN:

```http
Content-Security-Policy: default-src 'self'; font-src 'self' https://cdn.example.com
```

## Prevention

- Inventory semua third-party resource sebelum mengaktifkan COEP/COOP ketat.
- Static asset CDN harus punya header CORS/CORP yang jelas.
- CSP rollout dengan report-only dulu.
- Test font/image/script loading lintas environment.

---

# Case 10 — Service Worker Menyajikan App Lama

## Symptom

User sudah deploy versi baru, tetapi sebagian user tetap melihat versi lama. Hard refresh kadang memperbaiki. Incognito bersih. Network tab menunjukkan response `from ServiceWorker`.

## Mental Model

Service worker adalah programmable proxy di browser.

Ia bisa mencegat request dan mengembalikan cached response tanpa menyentuh network.

Deployment static asset tidak otomatis mengganti service worker yang sedang mengontrol page.

Lifecycle:

```text
install -> waiting -> activate -> controlling pages
```

Service worker baru bisa menunggu sampai tab lama ditutup, kecuali memakai strategi `skipWaiting()` dan `clientsClaim()` dengan hati-hati.

## Evidence

DevTools:

```text
Application -> Service Workers
Application -> Cache Storage
Network -> Size: from ServiceWorker
```

Cek cache names:

```text
app-shell-v1
runtime-v1
precache-manifest-old
```

Cek response headers dan content hash.

## Common Root Causes

### Root Cause A — Cache Version Tidak Diupdate

Service worker masih memakai cache lama:

```js
const CACHE_NAME = "app-v1";
```

Release baru lupa bump cache.

### Root Cause B — Runtime Caching untuk HTML Terlalu Agresif

Jika `index.html` cache-first, user bisa terus mendapat app shell lama.

Untuk navigation HTML, sering lebih aman:

```text
network-first with fallback
```

atau revalidation strategy yang jelas.

### Root Cause C — Old Service Worker Tidak Membersihkan Cache Lama

Pada activate:

```js
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CURRENT_CACHE).map((key) => caches.delete(key)))
    )
  );
});
```

Tetapi jangan hapus asset yang masih dibutuhkan tab lama tanpa strategi.

## Fix

- Add app version endpoint/build metadata.
- Provide update available UX.
- Use controlled service worker update flow.
- Avoid cache-first for `index.html` unless offline-first app benar-benar didesain.
- Clean old caches safely.

## Prevention

- Test upgrade path, not just fresh install.
- Synthetic test with old service worker.
- Monitor version skew.
- Provide kill switch for service worker if possible.

---

# Case 11 — API Lambat Bukan karena Server, tetapi Waterfall

## Symptom

User bilang halaman lambat. Backend log menunjukkan endpoint cepat, misalnya 80 ms. Tetapi UI baru usable setelah 4 detik.

## Mental Model

Backend duration bukan user-perceived latency.

User-perceived latency mencakup:

```text
DNS
TCP/QUIC connection
TLS
request queueing
server processing
CDN/proxy
TTFB
download
main thread work
render blocking CSS/JS
client waterfall dependencies
hydration
subsequent API calls
```

## Evidence

Network waterfall menunjukkan:

```text
HTML -> JS bundle -> config.json -> /me -> /permissions -> /dashboard -> /widgets -> /widget-details
```

Setiap request menunggu request sebelumnya.

Backend bisa cepat, tetapi dependency chain panjang.

## Common Root Causes

### Root Cause A — Sequential API Calls

Buruk:

```ts
const user = await getUser();
const permissions = await getPermissions(user.id);
const dashboard = await getDashboard(permissions.scope);
const widgets = await getWidgets(dashboard.id);
```

Jika beberapa request bisa paralel, paralelkan.

Atau buat BFF endpoint:

```http
GET /api/dashboard-page
```

yang mengembalikan view model untuk first paint.

### Root Cause B — Config Fetch Blocks Everything

Frontend mengambil config runtime setelah JS load, lalu baru tahu API base URL.

Pertimbangkan:

- inline minimal config ke HTML;
- cache config dengan revalidation;
- avoid blocking critical path.

### Root Cause C — Wrong Resource Priority

Hero image lazy loaded atau critical CSS terlambat.

`fetchpriority="high"` bisa membantu untuk LCP image jika browser tidak bisa infer priority dengan cukup baik.

### Root Cause D — Too Many Origins

Setiap origin baru bisa memerlukan DNS/connect/TLS.

Gunakan `preconnect` hanya untuk origin critical dan pasti dipakai.

## Debugging Checklist

1. Mana request pertama yang memblokir meaningful UI?
2. Apakah bottleneck server time atau queue/connect/TTFB/download?
3. Apakah request bisa paralel?
4. Apakah data first paint terlalu fragmented?
5. Apakah critical resource punya priority benar?
6. Apakah resource datang dari terlalu banyak origin?
7. Apakah JS main thread menjadi bottleneck setelah network selesai?

## Prevention

- Performance budget.
- RUM metrics.
- Waterfall review pada PR besar.
- BFF untuk screen yang kompleks.
- Avoid chatty frontend.
- Test on realistic network latency.

---

# Case 12 — SameSite Cookie Berubah Behavior Setelah Domain Dipisah

## Symptom

Awalnya app dan API berada di same-origin:

```text
https://example.com
https://example.com/api
```

Kemudian dipisah:

```text
https://app.example.com
https://api.example.com
```

Setelah itu login/session/CSRF mulai gagal.

## Mental Model

Perubahan deployment topology mengubah:

- origin;
- site relationship;
- cookie domain matching;
- SameSite behavior;
- CORS requirement;
- credentials mode;
- CSRF threat surface;
- local dev/prod parity.

Same-origin ke cross-origin bukan perubahan kosmetik. Itu perubahan security boundary.

## Evidence

Bandingkan sebelum/sesudah:

```text
Old origin: https://example.com
New app origin: https://app.example.com
New API origin: https://api.example.com
```

Cek:

- CORS headers;
- fetch `credentials`;
- cookie domain;
- SameSite;
- CSRF token transport;
- preflight;
- redirect path;
- CSP `connect-src`;
- service worker scope.

## Common Root Causes

### Root Cause A — Frontend Tetap Menganggap Same-Origin

Kode lama:

```ts
fetch("/api/me");
```

Setelah API pindah:

```ts
fetch("https://api.example.com/me");
```

Sekarang cross-origin. Perlu CORS dan credentials.

### Root Cause B — CSRF Token Sebelumnya Bergantung Same-Origin Form Flow

Jika memakai CSRF token di cookie + header:

```text
Set-Cookie: XSRF-TOKEN=...
X-XSRF-TOKEN: ...
```

Pastikan cookie readable/non-HttpOnly jika double submit pattern memang dipakai, SameSite sesuai, dan CORS mengizinkan custom header.

### Root Cause C — Cookie Host-Only Tidak Berlaku ke Subdomain Lain

Cookie dari `example.com` tidak otomatis cocok untuk `api.example.com` jika host/domain attribute tidak sesuai.

## Prevention

- Treat topology change as security architecture change.
- Buat migration checklist untuk origin/site/cookie/CORS/CSP/service worker.
- Test production-like domain sejak staging.
- Dokumentasikan auth mode per topology.

---

# Case 13 — File Upload Stuck atau Progress Tidak Akurat

## Symptom

User upload file besar. UI progress berhenti di 100% tetapi request masih pending. Atau progress tidak muncul jika memakai `fetch()`.

## Mental Model

Upload memiliki beberapa fase:

```text
client reads file
  ↓
request body upload to network
  ↓
server receives bytes
  ↓
server processes file
  ↓
server writes storage/db
  ↓
server returns response
  ↓
client parses response
```

Progress upload 100% hanya berarti browser selesai mengirim body, bukan server selesai memproses.

## Root Causes

### Root Cause A — Menggunakan `fetch()` tetapi Butuh Upload Progress

Classic upload progress lebih mudah dengan XHR:

```ts
const xhr = new XMLHttpRequest();
xhr.upload.onprogress = (event) => {
  if (event.lengthComputable) {
    const percent = Math.round((event.loaded / event.total) * 100);
    updateProgress(percent);
  }
};
xhr.open("POST", "/api/upload");
xhr.send(formData);
```

### Root Cause B — Server Processing Tidak Dipisah dari Upload Progress

UI harus membedakan:

```text
Uploading -> Processing -> Done
```

Bukan hanya 0–100%.

### Root Cause C — Multipart Boundary Salah

Jika memakai `FormData`, jangan set `Content-Type` manual:

Buruk:

```ts
fetch("/upload", {
  method: "POST",
  headers: { "Content-Type": "multipart/form-data" },
  body: formData
});
```

Browser harus menambahkan boundary sendiri.

Benar:

```ts
fetch("/upload", {
  method: "POST",
  body: formData
});
```

## Prevention

- Distinguish upload progress and server processing state.
- Use resumable upload for large files.
- Use idempotency/upload session ID.
- Set file size/type validation client and server side.
- Test slow network and large file.

---

# Case 14 — API Response Terlihat di Network, tetapi Header Tidak Bisa Dibaca JS

## Symptom

Network tab menunjukkan response header:

```http
X-Request-Id: abc
X-Total-Count: 123
Content-Disposition: attachment; filename="report.csv"
```

Tetapi JavaScript:

```ts
response.headers.get("X-Total-Count") // null
```

## Mental Model

Untuk cross-origin response, browser tidak otomatis expose semua response headers ke JavaScript.

Server harus mengirim:

```http
Access-Control-Expose-Headers: X-Total-Count, X-Request-Id, Content-Disposition
```

Network tab dapat menampilkan header yang JS tidak boleh baca.

## Common Root Causes

- Missing `Access-Control-Expose-Headers`.
- Header hanya ditambahkan di actual response, bukan di error response.
- CDN/gateway strip header.
- Case sensitivity bug di client code walau HTTP header name seharusnya case-insensitive.

## Prevention

- Define exposed headers as API contract.
- Test cross-origin header reading in browser.
- Include exposed headers for success and error responses.

---

# Case 15 — CSP Rollout Membuat Production Blank Page

## Symptom

Setelah menambahkan CSP, production blank. Console:

```text
Refused to execute inline script because it violates Content Security Policy
```

atau:

```text
Refused to load script from ... because it violates script-src
```

## Mental Model

CSP adalah policy enforcement oleh browser. Ia tidak peduli bahwa script “dibutuhkan aplikasi”. Jika policy tidak mengizinkan, resource diblokir.

## Common Root Causes

- Inline bootstrap script tidak memakai nonce/hash.
- Third-party analytics tidak masuk `script-src`.
- API origin tidak masuk `connect-src`.
- Image CDN tidak masuk `img-src`.
- WebSocket endpoint tidak masuk `connect-src`.
- Styles injected by CSS-in-JS ditolak.
- `frame-ancestors` memblokir embedding legitimate.

## Safe Rollout

Mulai dari:

```http
Content-Security-Policy-Report-Only: ...
```

Kumpulkan report, perbaiki violation, baru enforce:

```http
Content-Security-Policy: ...
```

## Prevention

- CSP report-only stage wajib.
- Automated smoke test dengan production-like CSP.
- Inventory third-party resource.
- Nonce/hash strategy untuk inline script yang legitimate.
- Avoid `unsafe-inline` kecuali benar-benar temporary.

---

# 16. Cross-Case Pattern: Cara Mengenali Kategori Bug

## 16.1 Jika Console Mengatakan CORS

Jangan langsung ubah CORS.

Tanyakan:

1. Apakah request actual dikirim?
2. Apakah preflight gagal?
3. Apakah response actual tidak expose header?
4. Apakah credentials involved?
5. Apakah redirect terjadi sebelum CORS check?
6. Apakah gateway menambah/menghapus header?
7. Apakah error sebenarnya mixed content/CORP/CSP tapi terlihat mirip?

## 16.2 Jika Network Menampilkan 200 tetapi UI Error

Kemungkinan:

- response body bukan format yang diharapkan;
- `Content-Type` salah;
- frontend parse error;
- application error disembunyikan dalam `200`;
- CORS expose issue;
- old response from cache;
- race condition overwrite;
- client state machine salah;
- service worker menyajikan response lama;
- JSON schema drift.

## 16.3 Jika Hanya Gagal di Production

Kemungkinan:

- CDN;
- HTTPS/Secure cookie;
- real domain changes origin/site;
- gateway route;
- CSP/security header;
- compression;
- HTTP/2/3 behavior;
- service worker active;
- cache;
- environment config;
- third-party script;
- WAF/rate limit;
- certificate chain;
- mixed content;
- old deployment asset.

## 16.4 Jika Hanya Gagal Setelah Refresh

Kemungkinan:

- SPA fallback routing;
- service worker app shell;
- auth state rehydration;
- cookie not sent to `/me`;
- localStorage/sessionStorage mismatch;
- cached HTML;
- server route missing;
- redirect loop.

## 16.5 Jika Hanya Gagal di Safari/Mobile

Kemungkinan:

- cookie/privacy restrictions;
- third-party cookie behavior;
- storage limitations;
- service worker/browser support differences;
- autoplay/permission differences;
- network instability;
- TLS/certificate issue;
- memory pressure;
- background tab throttling.

---

# 17. Evidence Matrix

Gunakan matrix ini saat incident review.

| Evidence | Lokasi | Menjawab Pertanyaan |
|---|---|---|
| Console error | DevTools Console | Browser policy apa yang eksplisit memblokir? |
| Request URL/method/status | Network | Request mana yang gagal? |
| Request headers | Network | Browser mengirim Origin/Cookie/Auth/header custom? |
| Response headers | Network | Server/CDN memberi CORS/cache/security header yang benar? |
| Redirect chain | Network | Apakah response final bukan yang dipikirkan frontend? |
| Timing | Network/Performance | Bottleneck network/server/download/queue? |
| Initiator | Network | Siapa yang membuat request: fetch/script/img/service worker? |
| Cookies | Application | Cookie tersimpan, blocked, expired, domain/path cocok? |
| Service worker | Application | Response berasal dari network atau SW cache? |
| Cache storage | Application | Apakah app shell/API response lama tersimpan? |
| Security tab | DevTools | TLS/mixed content/certificate problem? |
| HAR | Export | Evidence shareable lintas tim. |
| Server access log | Backend/gateway | Apakah request sampai server? |
| Trace/correlation ID | Observability | Request browser cocok dengan backend trace mana? |
| CDN headers | Network/CDN log | HIT/MISS/BYPASS? Edge mana? |

---

# 18. Browser HTTP Incident Decision Tree

## Step 1 — Apakah Request Terlihat di Network?

Jika tidak:

- kode tidak memanggil request;
- request dibatalkan sebelum dikirim;
- service worker intercept;
- CSP/mixed content memblokir sebelum network;
- browser policy blocking;
- URL salah;
- route belum aktif;
- feature flag mati.

Jika iya, lanjut.

## Step 2 — Apakah Request Sampai Server?

Bandingkan Network dengan access log.

Jika tidak:

- DNS;
- TLS;
- CDN;
- WAF;
- proxy;
- preflight blocked;
- browser blocked;
- offline;
- request served from cache/SW.

Jika iya, lanjut.

## Step 3 — Apakah Server Menghasilkan Response yang Diharapkan?

Cek server log/trace.

Jika tidak:

- auth/session;
- validation;
- backend exception;
- upstream timeout;
- wrong route;
- wrong environment;
- bad request body;
- method mismatch;
- content negotiation.

Jika iya, lanjut.

## Step 4 — Apakah Response Sampai Browser Tanpa Dimutasi?

Cek:

- gateway header rewriting;
- CDN cache;
- compression;
- redirect;
- status code transform;
- error page injection;
- WAF block page;
- proxy stripping header.

Jika response berubah, root cause ada di middle layer.

Jika tidak, lanjut.

## Step 5 — Apakah Browser Mengizinkan JavaScript Membaca/Memakai Response?

Cek:

- CORS;
- exposed headers;
- CSP;
- CORP/COEP;
- MIME type;
- mixed content;
- credentials;
- redirect mode.

Jika browser memblokir, fix policy/header/topology.

Jika browser mengizinkan, lanjut.

## Step 6 — Apakah Frontend Menginterpretasi Response dengan Benar?

Cek:

- status handling;
- response parser;
- schema mismatch;
- error envelope;
- stale request race;
- query key;
- cache layer;
- state machine;
- retry logic;
- auth refresh logic.

---

# 19. Incident Review Rubric

Untuk setiap insiden HTTP frontend, tulis review dengan struktur ini:

```md
# Incident: <title>

## User Impact
- Who was affected?
- What did they experience?
- Duration?
- Severity?

## Timeline
- First bad deploy/config change:
- First detection:
- Mitigation:
- Full fix:

## Technical Symptom
- Browser symptom:
- HTTP symptom:
- Backend symptom:

## Evidence
- HAR:
- Console:
- Server logs:
- CDN/gateway logs:
- Trace IDs:

## Root Cause
Explain exact mechanism.

## Why It Escaped
- Missing test?
- Missing staging parity?
- Missing observability?
- Missing review checklist?
- Hidden browser behavior?

## Fix
- Immediate mitigation:
- Long-term fix:

## Prevention
- Tests:
- Alerts:
- Documentation:
- Ownership:
```

Root cause tanpa prevention adalah debugging, bukan engineering improvement.

---

# 20. Golden Rules dari Semua Case

## Rule 1 — Browser adalah Security Enforcement Runtime

Browser bukan sekadar HTTP client. Browser menjalankan policy:

- CORS;
- cookies;
- SameSite;
- CSP;
- mixed content;
- secure context;
- CORP/COEP/COOP;
- service worker;
- storage partitioning;
- fetch mode/credentials/redirect.

## Rule 2 — Network Tab Menunjukkan Lebih dari “Request Gagal”

Network tab menunjukkan:

- siapa initiator;
- apakah preflight ada;
- redirect chain;
- request/response header;
- cache source;
- service worker involvement;
- timing;
- protocol;
- status;
- transfer size.

Gunakan semua, bukan hanya status code.

## Rule 3 — Postman/cURL Bukan Bukti Browser Akan Berhasil

Postman/cURL berguna untuk reachability dan backend behavior, tetapi tidak membuktikan browser policy compatibility.

## Rule 4 — Cache Bug adalah Correctness Bug

Caching bukan hanya performance. Cache salah bisa menyebabkan:

- data stale;
- data user bocor;
- app shell lama;
- chunk 404;
- wrong localization;
- wrong authorization state.

## Rule 5 — Redirect adalah Control Flow yang Sering Tidak Cocok untuk API

Untuk API consumed by JS, gunakan status dan error body yang machine-readable. Redirect login cocok untuk navigation, bukan generic JSON API.

## Rule 6 — Auth di Browser adalah State Machine, Bukan Boolean

Auth state minimal:

```text
unknown
anonymous
authenticating
authenticated
refreshing
expired
forbidden
logout_pending
```

`isLoggedIn: boolean` terlalu miskin untuk sistem nyata.

## Rule 7 — Deployment Topology adalah Bagian dari API Contract

Mengubah domain/path/proxy/CDN berarti mengubah:

- origin;
- site;
- cookie behavior;
- CORS;
- CSP;
- cache;
- service worker scope;
- redirect behavior.

## Rule 8 — Setiap Header adalah Contract

Header bukan dekorasi. Header mengubah behavior browser, cache, proxy, dan security layer.

## Rule 9 — Retry Tanpa Idempotency Bisa Menggandakan Efek Bisnis

Frontend retry harus tahu:

- method;
- idempotency;
- request body;
- status code;
- error class;
- user action;
- server guarantee.

## Rule 10 — Diagnosis Harus Berakhir dengan Guardrail

Kalau root cause hanya ditulis di chat dan tidak menjadi test/monitor/checklist, insiden yang sama akan kembali.

---

# 21. Latihan Mandiri

## Exercise 1 — Login Cross-Origin

Buat mini app:

```text
Frontend: http://localhost:3000
API: http://localhost:8080
```

Lalu ubah menjadi:

```text
Frontend: https://app.local.test
API: https://api.local.test
```

Eksperimen:

- cookie tanpa SameSite;
- `SameSite=Lax`;
- `SameSite=None; Secure`;
- fetch tanpa credentials;
- fetch dengan credentials;
- wildcard CORS;
- specific origin CORS;
- tanpa `Access-Control-Allow-Credentials`.

Catat kapan cookie:

- diterima;
- diblokir;
- disimpan;
- dikirim;
- tidak dikirim.

## Exercise 2 — Chunk 404 Deployment

Simulasikan dua build SPA:

```text
build-1: index.html -> chunk-A.js
build-2: index.html -> chunk-B.js
```

Deploy build-2 sambil menghapus chunk-A. Buka app build-1 lalu navigasi lazy route.

Tujuan:

- pahami old runtime requesting old chunk;
- desain asset retention strategy.

## Exercise 3 — Search Race

Buat endpoint search dengan delay random:

```text
/api/search?q=a     delay 800ms
/api/search?q=app   delay 100ms
```

Implementasi:

1. tanpa cancellation;
2. dengan AbortController;
3. dengan sequence guard;
4. dengan query cache key yang benar.

Bandingkan hasil.

## Exercise 4 — CORS Preflight Storm

Tambahkan header custom ke semua request:

```http
X-Debug: true
```

Amati OPTIONS. Lalu:

- hapus header;
- set `Access-Control-Max-Age`;
- pindahkan metadata ke server-side injection;
- bandingkan waterfall.

## Exercise 5 — Service Worker Old App

Buat service worker cache-first untuk `index.html`. Deploy versi baru. Amati user tetap melihat versi lama.

Lalu ubah strategi menjadi network-first untuk navigation.

---

# 22. Checklist Diagnosis Cepat

Saat ada bug HTTP frontend, mulai dari ini:

```text
[ ] Apa exact user symptom?
[ ] Apakah request terlihat di Network?
[ ] Siapa initiator request?
[ ] Apakah ada preflight?
[ ] Apakah actual request terkirim?
[ ] Apakah request sampai server?
[ ] Apakah response server sama dengan response browser?
[ ] Apakah ada redirect chain?
[ ] Apakah response dari network/cache/service worker?
[ ] Apakah status code benar secara semantic?
[ ] Apakah Content-Type sesuai body?
[ ] Apakah CORS valid?
[ ] Apakah credentials/cookie behavior sesuai?
[ ] Apakah cache header sesuai sensitivity?
[ ] Apakah CSP/CORP/COEP/COOP/mixed content memblokir?
[ ] Apakah frontend parser/state machine benar?
[ ] Apakah ada race/cancellation issue?
[ ] Apakah issue environment/topology-specific?
[ ] Apakah ada trace/correlation ID end-to-end?
[ ] Guardrail apa yang mencegah regresi?
```

---

# 23. Ringkasan

Part ini menunjukkan bahwa insiden HTTP frontend jarang selesai dengan “tambahkan header X”. Masalah nyata biasanya terjadi di pertemuan beberapa boundary:

```text
browser policy + HTTP semantics + deployment topology + frontend state + infrastructure mutation
```

Kemampuan penting bukan menghafal semua error browser, tetapi membangun kebiasaan diagnosis:

1. mulai dari symptom user;
2. kumpulkan evidence browser;
3. cocokkan dengan HTTP evidence;
4. identifikasi policy layer;
5. verifikasi middle layer/CDN/gateway;
6. cek server-side truth;
7. jelaskan mechanism root cause;
8. buat guardrail.

Jika Anda bisa melakukan ini konsisten, Anda bukan hanya “frontend yang bisa pakai fetch”, tetapi engineer yang mampu menjaga web system boundary secara defensible.

---

# 24. Apa Selanjutnya

Part berikutnya adalah bagian terakhir seri:

```text
learn-http-for-web-frontend-perspective-part-035.md
```

Topik:

```text
Synthesis: Top 1% HTTP Decision Framework for Frontend Engineers
```

Part 035 akan menggabungkan seluruh seri menjadi:

- decision framework;
- review checklist;
- design rubric;
- incident playbook;
- capstone exercise;
- mental model final.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-http-for-web-frontend-perspective-part-033.md">⬅️ Deployment, Environments, Proxies, Gateways, and Local Development</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-http-for-web-frontend-perspective-part-035.md">Part 035 — Synthesis: Top 1% HTTP Decision Framework for Frontend Engineers ➡️</a>
</div>
