# learn-http-for-web-frontend-perspective-part-013.md

# Part 013 — Cookies Part 2: Session, CSRF, Auth, and SPA Reality

> Seri: `learn-http-for-web-frontend-perspective`  
> Target pembaca: Java software engineer yang ingin memahami HTTP dari perspektif browser/frontend secara dalam, praktis, dan arsitektural.  
> Posisi dalam seri: setelah Part 012 yang membahas model cookie browser, bagian ini membahas bagaimana cookie dipakai untuk session/auth, bagaimana CSRF terjadi, bagaimana SPA memperumit auth, dan bagaimana mendesain state machine auth yang defensible.

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya, kita membahas cookie sebagai mekanisme browser:

- `Set-Cookie` dari server;
- `Cookie` dari browser ke server;
- `Domain`, `Path`, `Secure`, `HttpOnly`, `SameSite`;
- host-only cookie;
- cookie prefix;
- third-party cookie dan partitioned cookie;
- interaksi cookie dengan origin/site.

Bagian ini naik satu level: **bagaimana cookie, session, CSRF, token, SPA, BFF, dan OAuth/OIDC benar-benar bekerja sebagai sistem auth web**.

Target akhirnya bukan sekadar bisa menjawab:

> “Lebih aman cookie atau localStorage?”

Target sebenarnya adalah bisa mendesain dan men-debug sistem seperti ini:

```text
Browser SPA
   │
   │  HTTPS + cookie / bearer token / CSRF token
   ▼
BFF / API Gateway / Backend
   │
   │  session store / access token / refresh token / IdP token
   ▼
Identity Provider / Authorization Server
```

Dan bisa menjawab pertanyaan produksi seperti:

- Kenapa login berhasil tapi user tetap dianggap belum login?
- Kenapa cookie ada di DevTools tapi tidak terkirim ke API?
- Kenapa logout di satu tab tidak logout di tab lain?
- Kenapa refresh token rotation menyebabkan user tiba-tiba logout?
- Kenapa request POST dari halaman attacker bisa mengubah data user?
- Kenapa memakai `SameSite=None` membuat sistem lebih rentan CSRF?
- Kenapa menyimpan access token di `localStorage` memperbesar impact XSS?
- Kenapa CORS bukan solusi CSRF?
- Kenapa `HttpOnly` melindungi token dari pembacaan JS tapi tidak otomatis melindungi dari CSRF?
- Kenapa SPA murni sering lebih sulit diamankan daripada BFF?

---

## 1. Mental Model Utama: Authentication Bukan Sekadar “Token Ada atau Tidak”

Di UI, auth sering direduksi menjadi boolean:

```ts
const isAuthenticated = !!token;
```

Ini mental model yang terlalu dangkal.

Dalam sistem nyata, auth adalah gabungan dari beberapa state berbeda:

```text
Identity state:
  Siapa user ini?

Authentication state:
  Apakah user sudah membuktikan identitasnya?

Session state:
  Apakah ada continuity antara request saat ini dan login sebelumnya?

Authorization state:
  Apakah user boleh melakukan action/resource tertentu?

Frontend UI state:
  Apakah aplikasi percaya bahwa user masih login?

Backend/server state:
  Apakah server masih mengakui session/token ini?

Browser credential state:
  Apakah browser akan mengirim cookie/token pada request tertentu?
```

Kegagalan besar terjadi saat engineer mencampur semuanya.

Contoh:

```text
Cookie masih ada      ≠ session masih valid.
Token belum expired   ≠ user masih punya permission.
UI punya user object   ≠ backend menerima request.
CORS berhasil          ≠ request authorized.
Login redirect selesai ≠ cookie tersimpan.
```

### Invariant penting

Auth web harus dipahami sebagai **state machine terdistribusi** antara:

- browser;
- JavaScript runtime;
- HTTP layer;
- cookie jar;
- server session store;
- authorization server / identity provider;
- API resource server;
- cache/CDN/proxy;
- tab/window lain;
- user behavior.

Jika salah satu boundary salah dibaca, bug auth sering terlihat “random”.

---

## 2. Dua Keluarga Besar Auth Web

Secara praktis, sistem web modern biasanya jatuh ke salah satu dari dua keluarga besar:

1. **Cookie/session-based authentication**
2. **Token-based authentication**

Banyak sistem enterprise memakai campuran keduanya.

---

## 3. Cookie/Session-Based Authentication

Model klasik web:

```text
1. User submit login form.
2. Server memverifikasi credential.
3. Server membuat session di server-side session store.
4. Server mengirim Set-Cookie berisi session identifier.
5. Browser menyimpan cookie.
6. Request berikutnya otomatis membawa Cookie.
7. Server membaca session id dan mengambil session data.
```

Contoh response login:

```http
HTTP/1.1 204 No Content
Set-Cookie: __Host-session=abc123; Path=/; Secure; HttpOnly; SameSite=Lax
```

Request berikutnya:

```http
GET /api/me HTTP/1.1
Host: app.example.com
Cookie: __Host-session=abc123
```

Server membaca `abc123`, lalu lookup:

```text
session_id abc123 -> user_id 42, tenant_id A, issued_at, expires_at, auth_level, csrf_secret, etc.
```

### 3.1 Apa yang Disimpan di Cookie?

Idealnya cookie session hanya menyimpan **opaque identifier**, bukan data user mentah.

Baik:

```text
__Host-session = random_opaque_session_id
```

Berisiko:

```text
session = { "userId": 42, "role": "admin" }
```

Lebih berisiko jika tidak ditandatangani/encrypted.

### 3.2 Server-Side Session

Karakteristik:

- session bisa dicabut server kapan saja;
- logout mudah: hapus server-side session + expire cookie;
- permission bisa berubah tanpa menunggu token expire;
- perlu storage: memory, Redis, database, distributed cache;
- perlu strategi scaling dan replication;
- perlu cleanup expired sessions;
- cocok untuk browser app yang dikendalikan oleh satu domain/aplikasi.

### 3.3 Stateless Session Cookie

Beberapa framework menyimpan session data langsung di cookie, biasanya signed/encrypted.

Contoh konseptual:

```text
Set-Cookie: session=<signed_encrypted_blob>; Secure; HttpOnly; SameSite=Lax
```

Kelebihan:

- tidak perlu server-side session store;
- horizontal scaling lebih mudah;
- cocok untuk data kecil.

Kekurangan:

- ukuran cookie terbatas;
- data dikirim di setiap request;
- revocation lebih sulit;
- rotasi key menjadi isu;
- invalidation global lebih kompleks;
- jangan simpan data sensitif tanpa encryption yang benar.

### 3.4 Cookie Adalah Ambient Credential

Cookie disebut ambient credential karena browser mengirimkannya otomatis jika rule cocok.

Artinya JavaScript tidak perlu menambahkan header:

```ts
fetch('/api/orders', { credentials: 'include' });
```

Jika cookie rule cocok, browser mengirim cookie.

Ini nyaman, tapi juga sumber CSRF.

Mengapa?

Karena attacker site bisa membuat browser user melakukan request ke site korban, dan browser mungkin otomatis menyertakan cookie korban.

---

## 4. Token-Based Authentication

Model token-based umum:

```text
1. User login.
2. Authorization server menerbitkan access token.
3. Client menyimpan access token.
4. Client mengirim Authorization: Bearer <token> ke API.
5. API memvalidasi token.
```

Contoh:

```http
GET /api/me HTTP/1.1
Host: api.example.com
Authorization: Bearer eyJhbGciOi...
```

Token bisa berupa:

- opaque token;
- JWT;
- reference token;
- session-bound token;
- sender-constrained token dalam sistem lebih advanced.

### 4.1 Access Token

Access token biasanya pendek umur.

```text
Tujuan: memberi akses ke API resource.
Umur: pendek.
Disimpan: tergantung arsitektur.
Dikirim ke: resource server/API.
```

### 4.2 Refresh Token

Refresh token biasanya lebih sensitif.

```text
Tujuan: mendapatkan access token baru.
Umur: lebih panjang.
Risiko: jika dicuri, attacker dapat mempertahankan akses.
Perlindungan: rotasi, revocation, binding, HttpOnly cookie, BFF, device/session tracking.
```

OAuth 2.0 Security Best Current Practice membahas refresh token rotation sebagai teknik di mana authorization server menerbitkan refresh token baru pada setiap refresh dan refresh token lama tidak boleh dipakai ulang.

### 4.3 JWT Bukan Sinonim “Aman”

JWT hanyalah format token.

JWT yang buruk bisa sangat berbahaya:

- expired terlalu lama;
- tidak divalidasi `aud`/`iss`;
- secret lemah;
- algorithm confusion;
- data sensitif dimasukkan ke payload;
- token disimpan di localStorage lalu mudah dicuri saat XSS;
- backend tidak bisa revoke sebelum expiry;
- permission berubah tapi token lama masih berlaku.

Mental model yang benar:

```text
JWT = signed claims container.
Bukan session management lengkap.
Bukan automatic security solution.
Bukan pengganti threat modelling.
```

---

## 5. Cookie vs Token: Perbandingan yang Lebih Benar

Pertanyaan populer:

> “Mana lebih aman, cookie atau token?”

Pertanyaan ini kurang tepat.

Yang benar:

> “Credential apa disimpan di mana, dikirim bagaimana, dilindungi dari threat apa, dan dicabut bagaimana?”

### 5.1 Cookie Session

Kuat terhadap pencurian via JS jika:

```text
HttpOnly + Secure + SameSite sesuai + HTTPS + CSP + anti-CSRF
```

Tapi rentan CSRF jika endpoint state-changing tidak dilindungi.

### 5.2 Bearer Token di localStorage

Mudah dipakai untuk API:

```ts
fetch('/api/orders', {
  headers: {
    Authorization: `Bearer ${localStorage.getItem('access_token')}`
  }
});
```

Tapi jika terjadi XSS, token bisa dibaca dan dieksfiltrasi.

Web Storage API memang menyediakan mekanisme key/value di browser, tetapi storage tersebut dapat diakses oleh JavaScript pada origin yang sama. Artinya, bila attacker berhasil menjalankan script di origin aplikasi, data di localStorage/sessionStorage berisiko dibaca.

### 5.3 Bearer Token di Memory

Lebih baik dari localStorage terhadap persistent theft:

```text
Access token hanya di JS memory.
Refresh dilakukan melalui HttpOnly cookie / BFF.
```

Kelemahan:

- refresh halaman kehilangan token;
- multi-tab coordination lebih kompleks;
- XSS yang sedang aktif tetap bisa menggunakan token di runtime atau memanggil API.

### 5.4 Token di HttpOnly Cookie

Token tidak bisa dibaca JavaScript, tapi akan dikirim otomatis seperti cookie.

Artinya:

```text
XSS exfiltration risk turun.
CSRF risk perlu ditangani.
```

### 5.5 BFF Pattern

BFF = Backend for Frontend.

Model:

```text
Browser SPA
  - hanya punya session cookie HttpOnly
  - tidak menyimpan access token IdP

BFF
  - menyimpan token OAuth/OIDC server-side
  - memanggil downstream API
  - melakukan session management
```

Flow:

```text
Browser -> BFF: Cookie session
BFF -> API: Bearer access token
```

Kelebihan:

- browser tidak memegang token sensitif downstream;
- refresh token bisa server-side;
- CSRF dapat dikontrol di BFF;
- integrasi enterprise/legacy lebih mudah;
- observability lebih baik.

Kekurangan:

- perlu komponen backend tambahan;
- latency tambahan jika tidak dirancang baik;
- scaling session/BFF;
- coupling frontend-BFF lebih kuat;
- harus menghindari BFF menjadi God API.

---

## 6. Threat Model: XSS vs CSRF

Dua threat ini sering tertukar.

### 6.1 XSS: Attacker Menjalankan Script di Origin Anda

Jika XSS terjadi, attacker dapat menjalankan JavaScript seolah-olah bagian dari aplikasi.

Dampak:

- membaca localStorage;
- membaca sessionStorage;
- membaca non-HttpOnly cookie;
- memanggil API sebagai user;
- memodifikasi DOM;
- mencuri data yang tampil di halaman;
- membuat request dengan credential user;
- memasang persistence di UI jika supply chain/script compromised.

`HttpOnly` membantu karena cookie tidak bisa dibaca via `document.cookie`, tetapi XSS tetap bisa melakukan action melalui browser selama user masih authenticated.

Jadi:

```text
HttpOnly mengurangi token theft.
HttpOnly tidak membuat XSS harmless.
```

### 6.2 CSRF: Attacker Membuat Browser User Mengirim Request

CSRF terjadi saat attacker site menyebabkan browser korban mengirim request ke target site yang masih dipercaya oleh browser karena cookie otomatis terkirim.

Contoh konseptual:

```html
<form action="https://bank.example.com/transfer" method="POST">
  <input name="to" value="attacker" />
  <input name="amount" value="1000000" />
</form>
<script>document.forms[0].submit()</script>
```

Jika browser menyertakan session cookie dan server tidak punya CSRF protection, request bisa diterima.

### 6.3 Perbedaan Fundamental

```text
XSS:
  Attacker masuk ke origin Anda.
  Masalah utama: script execution.

CSRF:
  Attacker tetap di origin lain.
  Masalah utama: browser mengirim credential otomatis.
```

### 6.4 CORS Bukan CSRF Protection

CORS mengontrol apakah browser mengizinkan JavaScript di origin lain membaca response tertentu.

CSRF tidak membutuhkan attacker membaca response.

Attacker hanya perlu membuat browser mengirim request state-changing.

Jadi:

```text
CORS blocks reading response.
CSRF abuses sending request.
```

---

## 7. SameSite sebagai Mitigasi CSRF

`SameSite` mengontrol kapan cookie dikirim pada cross-site request.

Ringkas:

```text
SameSite=Strict
  Cookie hanya dikirim pada same-site context.
  Proteksi kuat, UX bisa terganggu pada cross-site navigation.

SameSite=Lax
  Cookie dikirim pada same-site request dan beberapa top-level navigation GET.
  Default modern yang sering cocok untuk session web biasa.

SameSite=None
  Cookie dikirim juga dalam cross-site context.
  Harus Secure.
  Diperlukan untuk third-party/federated/embed scenario.
  Proteksi CSRF dari SameSite praktis dilepas.
```

### 7.1 SameSite Bukan Satu-Satunya CSRF Defense

`SameSite=Lax` membantu banyak kasus, tetapi jangan jadikan satu-satunya defense untuk aplikasi berisiko tinggi.

Alasannya:

- browser behavior dan compatibility bisa berbeda;
- flow auth/federated login bisa butuh cross-site;
- subdomain takeover bisa mengubah asumsi site;
- state-changing GET tetap berbahaya;
- endpoint tertentu mungkin dipanggil dari context yang tidak Anda duga;
- attacker bisa mengeksploitasi celah lain seperti XSS.

OWASP tetap membahas token-based mitigation seperti synchronizer token dan double-submit cookie, serta penggunaan custom header pada AJAX/API sebagai pola yang relevan untuk aplikasi modern.

---

## 8. CSRF Defense Patterns

### 8.1 Synchronizer Token Pattern

Server membuat CSRF token dan menyimpannya server-side dalam session.

Flow:

```text
1. User login.
2. Server membuat session + csrf_token.
3. Frontend menerima csrf_token melalui HTML/page bootstrap/API khusus.
4. Untuk mutation request, frontend mengirim token.
5. Server membandingkan token request dengan token session.
```

Contoh:

```http
POST /api/orders HTTP/1.1
Cookie: __Host-session=abc123
X-CSRF-Token: r4nd0m
Content-Type: application/json

{"itemId":"A1","qty":1}
```

Server:

```text
session abc123 has csrf_token r4nd0m
request header X-CSRF-Token must match
```

Kelebihan:

- kuat jika session server-side;
- token tidak perlu menjadi credential utama;
- attacker cross-site tidak bisa membaca token karena Same-Origin Policy/CORS.

Kekurangan:

- perlu bootstrap token;
- perlu handle token rotation;
- perlu jangan expose token ke tempat yang bisa bocor seperti URL/log.

### 8.2 Double-Submit Cookie

Server mengirim cookie CSRF yang bisa dibaca JavaScript, lalu frontend mengirim nilainya di header.

```http
Set-Cookie: csrf_token=xyz; Path=/; Secure; SameSite=Lax
Set-Cookie: __Host-session=abc; Path=/; Secure; HttpOnly; SameSite=Lax
```

Frontend:

```ts
const csrf = readCookie('csrf_token');
await fetch('/api/orders', {
  method: 'POST',
  credentials: 'include',
  headers: {
    'Content-Type': 'application/json',
    'X-CSRF-Token': csrf,
  },
  body: JSON.stringify(payload),
});
```

Server mengecek:

```text
X-CSRF-Token == csrf_token cookie
```

Lebih kuat jika token ditandatangani dan diikat ke session.

### 8.3 Custom Header untuk AJAX/API

Untuk request cross-site klasik seperti form/image/script, attacker tidak bisa menambahkan arbitrary custom header tanpa CORS preflight.

Maka beberapa API mensyaratkan header seperti:

```http
X-Requested-With: XMLHttpRequest
```

atau:

```http
X-CSRF-Token: <token>
```

Namun jangan menganggap custom header saja selalu cukup untuk semua sistem. Ia harus dikombinasikan dengan:

- CORS allowlist ketat;
- credential policy benar;
- SameSite cookie;
- validasi method dan content type;
- audit endpoint state-changing.

### 8.4 Origin/Referer Validation

Server bisa memeriksa:

```http
Origin: https://app.example.com
```

atau fallback:

```http
Referer: https://app.example.com/path
```

Ini berguna sebagai defense-in-depth.

Pertimbangan:

- `Origin` tidak selalu ada pada semua request lama/jenis tertentu;
- `Referer` bisa dipengaruhi Referrer-Policy;
- proxy/security product bisa mengubah header;
- tetap perlu fail-closed untuk endpoint penting.

### 8.5 Jangan Pakai GET untuk Mutation

Ini adalah invariant keras:

```text
GET harus safe.
GET tidak boleh mengubah state bisnis.
```

Karena browser, crawler, prefetcher, link preview, dan attacker bisa memicu GET lebih mudah.

Buruk:

```http
GET /api/delete-account?id=42
```

Benar:

```http
DELETE /api/account
```

atau mutation eksplisit:

```http
POST /api/account/deletion-request
```

---

## 9. SPA Auth Reality

SPA membuat auth lebih rumit karena UI hidup lama di browser.

Dalam server-rendered app klasik:

```text
Request page -> server checks session -> render page or redirect login.
```

Dalam SPA:

```text
Initial load -> JS app boots -> checks /me -> renders shell -> maybe refresh token -> maybe handle route guard -> maybe call many APIs.
```

Masalahnya:

- banyak request paralel saat startup;
- token bisa expire saat tab masih terbuka;
- user bisa punya banyak tab;
- refresh token rotation bisa race;
- UI state bisa stale;
- session server bisa revoked tanpa frontend tahu;
- app shell bisa cached sementara auth state berubah;
- redirect login bisa terjadi dalam `fetch`, bukan navigation;
- browser privacy policy bisa memblokir cookie third-party.

---

## 10. Auth State Machine untuk Frontend

Jangan modelkan auth hanya sebagai boolean.

Gunakan state machine.

Contoh minimal:

```text
unknown
  -> checking_session
  -> authenticated
  -> anonymous
  -> refreshing
  -> expired
  -> logging_out
  -> error
```

### 10.1 State: `unknown`

Saat app baru boot, frontend belum tahu status auth.

```text
Belum boleh render halaman protected sebagai authenticated.
Belum boleh langsung redirect agresif jika ada kemungkinan session valid.
```

UI:

```text
show splash/loading shell
```

### 10.2 State: `checking_session`

Frontend memanggil endpoint seperti:

```http
GET /api/me
```

Kemungkinan:

```text
200 -> authenticated
401 -> anonymous/expired
403 -> authenticated but forbidden for this resource
5xx -> error/retry
network error -> offline/degraded
```

### 10.3 State: `authenticated`

Frontend punya user context:

```ts
{
  userId: '42',
  displayName: 'Ayu',
  roles: ['case-reviewer'],
  tenantId: 'regulator-a',
  sessionExpiresAt: '...',
}
```

Catatan:

```text
User context bukan credential.
User context adalah cached representation dari identity/session server.
```

### 10.4 State: `refreshing`

Jika access token pendek umur atau session perlu diperpanjang:

```text
authenticated -> refreshing -> authenticated
authenticated -> refreshing -> expired
```

Risiko:

- banyak request memicu refresh bersamaan;
- refresh token rotation membuat salah satu request menang dan yang lain memakai token lama;
- UI melakukan logout karena salah menginterpretasi satu refresh failure.

### 10.5 State: `expired`

Session/token tidak valid lagi.

UI harus:

- hentikan request protected;
- bersihkan state sensitif;
- tampilkan login atau re-auth;
- simpan intended destination jika aman;
- jangan menampilkan data protected dari cache tanpa kontrol.

### 10.6 State: `logging_out`

Logout bukan sekadar hapus local variable.

Harus mempertimbangkan:

- server-side session invalidation;
- cookie expiry;
- token revocation jika ada;
- frontend cache cleanup;
- cross-tab notification;
- redirect ke login;
- back button behavior;
- service worker cache;
- in-flight requests.

---

## 11. Endpoint Auth yang Disarankan

Untuk SPA/BFF/API, biasanya perlu endpoint eksplisit.

### 11.1 `GET /api/session` atau `GET /api/me`

Tujuan:

```text
Menanyakan status session saat ini.
```

Response authenticated:

```http
HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

{
  "authenticated": true,
  "user": {
    "id": "u_123",
    "name": "Ayu",
    "roles": ["case-reviewer"]
  },
  "session": {
    "expiresAt": "2026-06-18T12:30:00Z"
  }
}
```

Response anonymous:

```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json
Cache-Control: no-store

{
  "type": "https://example.com/problems/authentication-required",
  "title": "Authentication required",
  "code": "AUTH_REQUIRED"
}
```

### 11.2 `POST /api/logout`

Tujuan:

```text
Mengakhiri session secara eksplisit.
```

Response:

```http
HTTP/1.1 204 No Content
Set-Cookie: __Host-session=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax
Cache-Control: no-store
```

### 11.3 `POST /api/session/refresh`

Jika memakai refresh flow eksplisit:

```http
POST /api/session/refresh HTTP/1.1
Cookie: __Host-session=abc
X-CSRF-Token: xyz
```

Response:

```http
HTTP/1.1 204 No Content
Set-Cookie: __Host-session=new; Path=/; Secure; HttpOnly; SameSite=Lax
Cache-Control: no-store
```

### 11.4 `GET /api/csrf-token`

Jika perlu bootstrap token:

```http
HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

{
  "csrfToken": "random"
}
```

Tapi jangan desain endpoint ini sehingga attacker cross-site bisa membacanya. SOP/CORS harus tetap ketat.

---

## 12. Login Flow dalam SPA

### 12.1 Username/Password Form ke Same-Origin BFF

```text
Browser SPA -> POST /api/login -> BFF
BFF validates credential
BFF sets HttpOnly session cookie
Browser calls /api/me
```

Contoh:

```http
POST /api/login HTTP/1.1
Content-Type: application/json

{"username":"ayu","password":"..."}
```

Response:

```http
HTTP/1.1 204 No Content
Set-Cookie: __Host-session=abc; Path=/; Secure; HttpOnly; SameSite=Lax
Cache-Control: no-store
```

Frontend:

```ts
await login(username, password);
const me = await fetchCurrentUser();
authStore.setAuthenticated(me);
```

Jangan hanya percaya bahwa login sukses berarti semua request berikutnya akan authenticated. Selalu verifikasi dengan `/me` atau state response yang jelas.

### 12.2 OAuth/OIDC Authorization Code + PKCE

Flow modern browser biasanya memakai Authorization Code + PKCE.

Konseptual:

```text
1. SPA/BFF mengarahkan browser ke Authorization Server.
2. User login di IdP.
3. IdP redirect balik dengan authorization code.
4. Client menukar code dengan token.
5. Session aplikasi dibuat.
```

Untuk BFF:

```text
Browser tidak perlu menyimpan token IdP.
BFF menukar code server-side.
BFF membuat session cookie ke browser.
```

Untuk SPA murni:

```text
SPA menukar code dengan PKCE.
Token berada di browser.
Storage strategy menjadi critical.
```

### 12.3 Jangan Taruh Token di URL Fragment/Query Setelah Login

Token di URL berisiko bocor melalui:

- browser history;
- logs;
- Referer;
- screenshots;
- analytics;
- crash reports;
- support tools.

Jika ada authorization code di URL, segera bersihkan setelah diproses:

```ts
window.history.replaceState({}, document.title, '/app');
```

Namun jangan sekadar membersihkan UI tanpa memastikan server/client sudah menyelesaikan flow dengan aman.

---

## 13. Refresh Token Rotation dan Race Condition

Ini salah satu sumber bug auth SPA paling sering.

### 13.1 Masalah

Misal access token expire. Saat app boot, ada 5 API call paralel:

```text
GET /api/me
GET /api/orders
GET /api/notifications
GET /api/settings
GET /api/tasks
```

Semuanya mendapat `401` dan mencoba refresh token.

```text
Request A refresh -> success, refresh token lama diganti token baru.
Request B refresh -> memakai refresh token lama -> dianggap reuse -> session revoked.
Request C refresh -> gagal.
```

Akibat:

- user tiba-tiba logout;
- refresh loop;
- session revoked karena reuse detection;
- error random tergantung timing.

### 13.2 Solusi: Single-Flight Refresh

Frontend HTTP client harus memastikan hanya satu refresh berjalan.

Pseudo-code:

```ts
let refreshPromise: Promise<void> | null = null;

async function refreshOnce(): Promise<void> {
  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

async function requestWithAuth(input: RequestInfo, init?: RequestInit) {
  let res = await fetch(input, init);

  if (res.status !== 401) {
    return res;
  }

  await refreshOnce();

  return fetch(input, init);
}
```

Tapi hati-hati:

- jangan retry non-idempotent mutation sembarangan;
- jangan retry jika body stream sudah consumed;
- jangan retry jika 401 berarti permission/user disabled;
- jangan infinite loop;
- bedakan expired token vs invalid session.

### 13.3 Backend Harus Mendukung Grace Window dengan Hati-Hati

Dalam sistem rotation, backend bisa memberi grace untuk refresh request bersamaan dari session/device yang sama.

Tapi ini security-sensitive.

Perlu:

- session/device binding;
- reuse detection;
- audit log;
- revocation strategy;
- rate limiting;
- anomaly detection.

---

## 14. Cross-Tab Auth Coordination

User bisa membuka banyak tab.

Problem:

```text
Tab A logout.
Tab B masih menampilkan data protected.
Tab C mencoba refresh token lama.
```

Solusi frontend:

### 14.1 BroadcastChannel

```ts
const channel = new BroadcastChannel('auth');

function logoutEverywhere() {
  channel.postMessage({ type: 'LOGOUT' });
}

channel.onmessage = (event) => {
  if (event.data?.type === 'LOGOUT') {
    clearSensitiveState();
    redirectToLogin();
  }
};
```

### 14.2 Storage Event

Jika memakai localStorage sebagai signaling, bukan untuk menyimpan token sensitif:

```ts
localStorage.setItem('auth-event', JSON.stringify({
  type: 'LOGOUT',
  at: Date.now(),
}));
```

Tab lain menerima `storage` event.

### 14.3 Server-Side Truth Tetap Utama

Cross-tab signaling hanya UX improvement.

Server tetap harus menolak session/token yang sudah revoked.

---

## 15. Logout Semantics

Logout sering dianggap trivial, padahal banyak lapisan.

### 15.1 Logout Minimal yang Benar

```text
1. POST /api/logout dengan CSRF protection.
2. Server invalidates session.
3. Server expires cookie.
4. Frontend clears in-memory sensitive state.
5. Frontend clears client cache/query cache.
6. Frontend broadcasts logout to other tabs.
7. Frontend navigates to login/public page.
```

### 15.2 Cookie Expiry Harus Match Attribute

Untuk menghapus cookie, `Path` dan `Domain` harus cocok dengan cookie asli.

Jika cookie asli:

```http
Set-Cookie: __Host-session=abc; Path=/; Secure; HttpOnly; SameSite=Lax
```

Hapus dengan:

```http
Set-Cookie: __Host-session=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax
```

### 15.3 Logout dari IdP

Jika memakai SSO/OIDC:

```text
Application logout ≠ IdP logout.
```

Pilihan:

- local app logout only;
- federated logout;
- front-channel logout;
- back-channel logout;
- session management endpoint.

Setiap pilihan punya konsekuensi UX dan security.

### 15.4 Back Button Setelah Logout

Browser bisa menampilkan halaman dari bfcache atau memory cache.

Untuk halaman protected:

- jangan cache HTML/data protected secara sembarangan;
- gunakan `Cache-Control: no-store` untuk response sensitif;
- saat page visibility/pageshow, re-check session jika perlu;
- bersihkan state client.

---

## 16. Authorization: Jangan Campur dengan Authentication

Authentication menjawab:

```text
Siapa user ini?
```

Authorization menjawab:

```text
Apa yang user ini boleh lakukan?
```

Frontend sering salah:

```ts
if (user.role === 'admin') {
  showDeleteButton();
}
```

Ini boleh untuk UX, tapi bukan security boundary.

Backend harus tetap enforce:

```http
DELETE /api/cases/123 HTTP/1.1
```

Response jika tidak boleh:

```http
HTTP/1.1 403 Forbidden
```

### 16.1 UI Permission Model

Frontend boleh punya permission model untuk:

- menyembunyikan action yang tidak relevan;
- menghindari request yang pasti gagal;
- menjelaskan akses user;
- meningkatkan UX.

Tapi:

```text
Frontend permission is advisory.
Backend authorization is authoritative.
```

### 16.2 401 vs 403

Gunakan bedanya secara konsisten:

```text
401 Unauthorized:
  User belum authenticated atau credential tidak valid.
  Frontend boleh arahkan ke login/re-auth.

403 Forbidden:
  User authenticated tapi tidak punya permission.
  Frontend jangan refresh token terus-menerus.
```

Bug umum:

```text
Semua auth failure dibuat 401.
Frontend mencoba refresh token untuk authorization failure.
Terjadi loop atau logout salah.
```

---

## 17. Session Expiry Strategy

Ada dua pola umum:

### 17.1 Absolute Expiry

Session berakhir pada waktu tertentu sejak login.

```text
Login 09:00, absolute expiry 17:00.
```

Kelebihan:

- batas risiko jelas;
- compliance-friendly;
- cocok untuk sistem sensitif.

Kekurangan:

- user aktif tetap bisa dipaksa login ulang;
- perlu UX warning.

### 17.2 Idle Timeout / Sliding Expiry

Session diperpanjang selama user aktif.

```text
Jika tidak ada aktivitas 30 menit -> expired.
Jika aktif -> extend.
```

Kelebihan:

- UX lebih baik;
- cocok untuk aplikasi kerja panjang.

Kekurangan:

- risiko sesi panjang;
- perlu definisi aktivitas;
- background polling bisa secara tidak sengaja memperpanjang session;
- multi-tab activity lebih kompleks.

### 17.3 Frontend UX untuk Expiry

Untuk aplikasi enterprise:

- tampilkan warning sebelum expiry;
- jangan hilangkan form panjang tanpa recovery;
- autosave draft jika aman;
- bedakan session expired vs network error;
- jangan refresh session dengan background polling yang tidak merepresentasikan aktivitas user.

---

## 18. Storage Decision Matrix

### 18.1 HttpOnly Secure Cookie

Cocok untuk:

- session id;
- refresh token jika memang harus di browser;
- BFF session;
- auth credential yang tidak perlu dibaca JS.

Kekuatan:

- tidak bisa dibaca via JS;
- browser mengelola pengiriman;
- bisa diatur `SameSite`, `Secure`, `Path`, `Domain`.

Risiko:

- CSRF jika state-changing endpoint tidak dilindungi;
- cookie policy/third-party restrictions;
- ambient credential.

### 18.2 In-Memory JS

Cocok untuk:

- access token short-lived;
- temporary auth state;
- user context cache.

Kekuatan:

- tidak persistent;
- hilang saat reload;
- lebih sulit dicuri setelah XSS tidak aktif lagi.

Risiko:

- XSS aktif tetap bisa pakai;
- reload kehilangan state;
- multi-tab sulit.

### 18.3 sessionStorage

Cocok untuk:

- non-sensitive per-tab UI state;
- temporary redirect state jika threat model menerima.

Risiko:

- JS-readable;
- XSS can read;
- tab-scoped tapi tetap persistent selama tab hidup.

### 18.4 localStorage

Cocok untuk:

- non-sensitive preferences;
- feature flags cache;
- UI settings.

Tidak ideal untuk:

- long-lived bearer tokens;
- refresh tokens;
- secrets.

Alasan:

```text
Jika XSS terjadi, token bisa dibaca dan dikirim ke attacker.
```

### 18.5 IndexedDB

Cocok untuk:

- offline data;
- cache aplikasi;
- data besar;
- sync queue.

Risiko:

- JS-readable;
- perlu encryption/key management jika data sensitif;
- cleanup saat logout harus eksplisit;
- service worker bisa berinteraksi.

---

## 19. Recommended Architectures

### 19.1 Same-Origin SPA + BFF + HttpOnly Session Cookie

```text
https://app.example.com
  serves SPA
  exposes /api/* BFF endpoints
  uses __Host-session HttpOnly cookie
```

Flow:

```text
Browser -> /api/* with cookie
BFF -> downstream services with server-side token
```

Cookie:

```http
Set-Cookie: __Host-session=<id>; Path=/; Secure; HttpOnly; SameSite=Lax
```

CORS:

```text
Not needed for same-origin.
```

CSRF:

```text
Still needed for mutation endpoints, but simpler.
```

Kapan cocok:

- enterprise web app;
- complex auth/SSO;
- regulatory/audit requirements;
- backend team bisa maintain BFF;
- API downstream tidak ingin expose token ke browser.

### 19.2 SPA on app.example.com + API on api.example.com

```text
App origin: https://app.example.com
API origin: https://api.example.com
Site: example.com
```

Perlu:

- CORS allowlist;
- `credentials: include` jika pakai cookie;
- cookie Domain mungkin `.example.com`, atau API host cookie tergantung flow;
- `SameSite=Lax` bisa cukup jika same-site;
- CSRF tetap diperlukan;
- `Vary: Origin` jika ACAO dinamis.

Risiko:

- CORS misconfig;
- cookie domain/path salah;
- staging/prod beda behavior;
- local dev sulit.

### 19.3 Cross-Site SPA + API

```text
App: https://app-company.com
API: https://api-vendor.com
```

Jika pakai cookie credential:

- perlu `SameSite=None; Secure`;
- third-party cookie restrictions bisa memblokir;
- perlu CORS credentialed;
- CSRF defense wajib kuat;
- browser privacy changes membuat desain rapuh.

Sering lebih baik:

- gunakan BFF pada origin aplikasi;
- gunakan OAuth code flow;
- hindari ketergantungan pada third-party cookie.

### 19.4 Pure SPA with Access Token in Memory

```text
SPA menyimpan access token short-lived di memory.
Refresh token ditangani via secure mechanism.
```

Bisa cocok jika:

- aplikasi public client;
- IdP mendukung browser-based app best practices;
- token lifetime pendek;
- refresh rotation benar;
- XSS defense kuat;
- tidak ada kebutuhan compliance berat terhadap token exposure.

Tapi untuk enterprise/regulatory case management, sering BFF lebih defensible.

---

## 20. CORS, Cookies, dan Auth: Kombinasi yang Sering Salah

### 20.1 Frontend Lupa `credentials`

```ts
fetch('https://api.example.com/me');
```

Default fetch credentials untuk cross-origin tidak mengirim cookie.

Harus:

```ts
fetch('https://api.example.com/me', {
  credentials: 'include',
});
```

### 20.2 Server Lupa `Access-Control-Allow-Credentials`

Response harus menyertakan:

```http
Access-Control-Allow-Credentials: true
```

Dan origin tidak boleh wildcard jika credentialed.

Buruk:

```http
Access-Control-Allow-Origin: *
Access-Control-Allow-Credentials: true
```

Benar:

```http
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Credentials: true
Vary: Origin
```

### 20.3 Cookie `SameSite=None` Tanpa `Secure`

Modern browser menolak/mengabaikan cookie `SameSite=None` tanpa `Secure`.

Benar:

```http
Set-Cookie: session=abc; Path=/; Secure; HttpOnly; SameSite=None
```

Namun gunakan `SameSite=None` hanya jika benar-benar butuh cross-site cookie.

### 20.4 Preflight 401

Browser mengirim preflight OPTIONS tanpa credential dalam banyak skenario atau tanpa auth header aplikasi.

Jika security filter backend memaksa auth untuk OPTIONS, actual request tidak pernah terjadi.

Fix:

```text
CORS handling harus terjadi sebelum auth enforcement untuk preflight.
OPTIONS preflight harus dijawab sesuai CORS policy.
```

---

## 21. Service Worker dan Auth

Service worker dapat mengintercept request.

Risiko:

- menyajikan response protected setelah logout;
- cache `/api/me` secara tidak sengaja;
- offline cache menyimpan data sensitif;
- mutation queue replay setelah session berubah;
- service worker versi lama memakai auth logic lama.

Rule:

```text
Jangan cache response auth/session tanpa desain eksplisit.
Gunakan Cache-Control: no-store untuk data sensitif.
Saat logout, bersihkan Cache API/IndexedDB yang relevan.
```

---

## 22. Cache dan Auth

Auth response harus sangat hati-hati terhadap caching.

Untuk endpoint seperti:

```http
GET /api/me
GET /api/session
POST /api/login
POST /api/logout
```

Umumnya gunakan:

```http
Cache-Control: no-store
```

Untuk personalized API response:

```http
Cache-Control: private, no-store
```

atau cache private dengan aturan sangat jelas jika memang diperlukan.

Jangan sampai response user A tersimpan di shared cache dan dikirim ke user B.

---

## 23. Error Handling Auth yang Baik

### 23.1 Jangan Semua Error Dianggap Logout

Buruk:

```ts
if (!response.ok) logout();
```

Lebih baik:

```ts
switch (response.status) {
  case 401:
    handleUnauthenticated();
    break;
  case 403:
    showForbidden();
    break;
  case 429:
    showRateLimit();
    break;
  case 500:
  case 502:
  case 503:
  case 504:
    showTemporaryFailure();
    break;
}
```

### 23.2 Problem Details untuk Auth

Contoh 401 expired:

```json
{
  "type": "https://example.com/problems/session-expired",
  "title": "Session expired",
  "status": 401,
  "code": "SESSION_EXPIRED",
  "detail": "Please sign in again."
}
```

Contoh 401 refresh failed:

```json
{
  "type": "https://example.com/problems/refresh-token-reused",
  "title": "Session can no longer be refreshed",
  "status": 401,
  "code": "REFRESH_REUSE_DETECTED"
}
```

Contoh 403:

```json
{
  "type": "https://example.com/problems/forbidden",
  "title": "You do not have access to this case",
  "status": 403,
  "code": "CASE_ACCESS_DENIED"
}
```

Frontend bisa mengambil keputusan tepat.

---

## 24. Java Backend Perspective: Apa yang Harus Disediakan untuk Frontend

Sebagai Java engineer, Anda harus melihat auth frontend sebagai kontrak backend juga.

### 24.1 Security Filter Ordering

Urutan salah:

```text
Auth filter -> CORS filter -> CSRF filter
```

Preflight bisa gagal.

Lebih baik secara konseptual:

```text
Request normalization
CORS/preflight handling
Security headers
Session/cookie parsing
CSRF validation for state-changing requests
Authentication
Authorization
Controller
```

Framework nyata punya detail masing-masing, tetapi prinsipnya:

```text
Preflight harus bisa dijawab tanpa dipaksa login.
CSRF harus berlaku pada mutation credentialed.
Auth/authorization harus authoritative.
```

### 24.2 Session Store

Jika memakai session store:

- Redis timeout harus sinkron dengan cookie max-age;
- session id harus random kuat;
- rotate session id after login;
- invalidate on logout;
- bind metadata jika perlu: user-agent, device id, tenant;
- audit login/logout/refresh;
- protect against session fixation.

### 24.3 Response Contract

Backend harus konsisten:

```text
401 -> unauthenticated/invalid credential
403 -> authenticated but forbidden
409 -> conflict
429 -> rate limited
5xx -> system failure
```

Jangan pakai:

```http
200 OK
{"error":"not logged in"}
```

Itu merusak frontend branching, monitoring, cache, dan incident diagnosis.

---

## 25. Session Fixation

Session fixation terjadi saat attacker membuat korban menggunakan session id yang sudah diketahui attacker, lalu korban login dengan session itu.

Mitigasi:

```text
Rotate session id after login.
Rotate session id after privilege elevation.
Do not accept session id from URL.
Use Secure + HttpOnly + SameSite.
Invalidate old session id.
```

Flow aman:

```text
anonymous session id A
login success
server creates authenticated session id B
server invalidates A
browser gets B
```

---

## 26. Re-Authentication untuk Action Sensitif

Untuk action berisiko tinggi:

- change password;
- change MFA;
- transfer money;
- delete account;
- approve enforcement action;
- export sensitive data;
- privilege escalation;
- view regulated confidential record;

jangan hanya mengandalkan session lama.

Pakai step-up auth:

```text
User authenticated normally.
Sensitive action requested.
Server requires recent authentication / MFA.
Frontend shows re-auth flow.
Server grants temporary elevated auth context.
```

Auth context bisa punya:

```text
auth_time
acr/amr
mfa_verified
step_up_expires_at
```

---

## 27. Regulatory/Enterprise Case Management Angle

Untuk sistem enforcement/case management, auth bukan sekadar login.

Perlu model:

```text
User
  belongs to organization/tenant
  has roles
  has permissions
  may be delegated
  may act under assignment
  may view case only at certain lifecycle state
  may require reason/audit for access
```

HTTP/auth consequence:

- `/api/me` harus memuat context minimum yang dibutuhkan UI;
- permission harus server-enforced per resource/action;
- audit log harus punya correlation id;
- impersonation/delegation harus eksplisit;
- sensitive export harus step-up;
- cache harus tidak membocorkan data;
- logout/session expiry harus tidak meninggalkan data di browser cache;
- 403 harus cukup informatif untuk UX, tapi tidak membocorkan data sensitif.

Contoh authorization failure yang baik:

```http
HTTP/1.1 403 Forbidden
Content-Type: application/problem+json
Cache-Control: no-store

{
  "type": "https://example.com/problems/case-access-denied",
  "title": "Access denied",
  "status": 403,
  "code": "CASE_ACCESS_DENIED",
  "correlationId": "01HX..."
}
```

Jangan mengembalikan:

```json
{
  "reason": "Case belongs to Enforcement Unit X and contains protected witness data"
}
```

kecuali user memang boleh mengetahui detail itu.

---

## 28. Production Debugging Playbook

### 28.1 Login Berhasil tapi User Tetap Anonymous

Cek:

1. Apakah response login mengirim `Set-Cookie`?
2. Apakah cookie diterima browser atau blocked?
3. Apakah `Secure` dipakai di HTTP local dev?
4. Apakah `SameSite=None` tanpa `Secure`?
5. Apakah domain/path cookie cocok?
6. Apakah API origin berbeda dan `credentials: include` dipakai?
7. Apakah CORS credentialed benar?
8. Apakah `/api/me` mengembalikan 401 karena session store tidak menemukan id?
9. Apakah load balancer tidak sticky sementara session memory lokal?
10. Apakah server mengirim multiple `Set-Cookie` conflicting?

### 28.2 Cookie Ada tapi Tidak Terkirim

Cek:

- request URL host/path;
- cookie `Domain`;
- cookie `Path`;
- `Secure` vs HTTP;
- `SameSite` dan request context;
- third-party cookie blocking;
- fetch `credentials`;
- service worker;
- browser devtools blocked reason.

### 28.3 POST Gagal CORS Preflight

Cek:

- OPTIONS response status;
- `Access-Control-Allow-Origin`;
- `Access-Control-Allow-Methods`;
- `Access-Control-Allow-Headers`;
- `Access-Control-Allow-Credentials`;
- preflight kena auth filter;
- `Vary: Origin`;
- custom header memicu preflight.

### 28.4 User Logout Random

Cek:

- refresh token rotation race;
- clock skew;
- session store eviction;
- Redis TTL lebih pendek dari cookie;
- multiple tabs;
- mobile network retry;
- duplicate refresh request;
- backend invalidates session on one failed refresh;
- frontend treats 403/500 as logout.

### 28.5 Logout Tidak Efektif

Cek:

- server session benar-benar invalidated;
- cookie deletion attribute match;
- frontend cache cleared;
- other tabs notified;
- service worker cache;
- bfcache/back button;
- IdP session masih aktif;
- refresh token still valid.

---

## 29. Design Checklist

### 29.1 Cookie Checklist

- [ ] `Secure` untuk auth cookie.
- [ ] `HttpOnly` untuk credential yang tidak perlu dibaca JS.
- [ ] `SameSite=Lax` default jika memungkinkan.
- [ ] `SameSite=None; Secure` hanya jika perlu cross-site.
- [ ] `__Host-` prefix untuk host-only session cookie jika cocok.
- [ ] `Path=/` jelas.
- [ ] Hindari `Domain` kecuali benar-benar perlu subdomain sharing.
- [ ] Cookie expiry sesuai session store expiry.
- [ ] Logout menghapus cookie dengan attribute yang cocok.

### 29.2 CSRF Checklist

- [ ] Semua mutation memakai POST/PUT/PATCH/DELETE, bukan GET.
- [ ] CSRF token/custom header untuk credentialed mutation.
- [ ] SameSite digunakan sebagai defense-in-depth.
- [ ] Origin/Referer validation untuk endpoint sensitif.
- [ ] CORS allowlist ketat.
- [ ] Preflight tidak dipaksa authenticated.
- [ ] Tidak menerima state-changing request dari content type/method yang tidak diharapkan.

### 29.3 SPA Auth Checklist

- [ ] Ada `unknown/checking/authenticated/anonymous/refreshing/expired` state.
- [ ] `/api/me` atau `/api/session` jelas.
- [ ] 401 dan 403 dibedakan.
- [ ] Refresh single-flight.
- [ ] Non-idempotent retry tidak otomatis.
- [ ] Cross-tab logout handled.
- [ ] Client cache dibersihkan saat logout.
- [ ] Data sensitif tidak disimpan permanen tanpa alasan kuat.
- [ ] Service worker tidak menyajikan data protected setelah logout.

### 29.4 Backend Contract Checklist

- [ ] `Cache-Control: no-store` untuk auth/session response.
- [ ] Session id rotate after login.
- [ ] Session invalidated on logout.
- [ ] Refresh token rotation race dipertimbangkan.
- [ ] Audit login/logout/refresh/failure.
- [ ] Correlation id pada error.
- [ ] Permission server-side authoritative.
- [ ] Response error envelope konsisten.

---

## 30. Anti-Pattern dan Replacement

### Anti-pattern 1: Access token long-lived di localStorage

Buruk:

```text
localStorage.access_token = long-lived bearer token
```

Replacement:

```text
BFF + HttpOnly session cookie
atau short-lived access token in memory + refresh strategy aman
```

### Anti-pattern 2: Semua auth failure = logout

Buruk:

```ts
if (status >= 400) logout();
```

Replacement:

```text
401 -> re-auth/refresh/anonymous
403 -> forbidden UI
429 -> wait/retry later
5xx -> temporary failure
```

### Anti-pattern 3: CORS wildcard dengan credentials

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

### Anti-pattern 4: `SameSite=None` untuk semua cookie

Buruk:

```http
Set-Cookie: session=abc; SameSite=None; Secure
```

Replacement:

```text
Gunakan Lax/Strict jika flow memungkinkan.
Pakai None hanya untuk cross-site requirement yang nyata.
Tambah CSRF defense.
```

### Anti-pattern 5: UI role dianggap security

Buruk:

```text
Hide button = secured
```

Replacement:

```text
Hide button untuk UX.
Backend tetap enforce authorization.
```

### Anti-pattern 6: Refresh token rotation tanpa single-flight

Buruk:

```text
Setiap 401 langsung refresh secara independen.
```

Replacement:

```text
Single-flight refresh + retry policy terbatas + backend grace design.
```

---

## 31. Mini Lab: Mendiagnosis Auth Bug

### Scenario

Frontend:

```ts
await fetch('https://api.example.com/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username, password }),
});

const me = await fetch('https://api.example.com/me');
```

Login response:

```http
HTTP/1.1 204 No Content
Set-Cookie: session=abc; Path=/; Secure; HttpOnly; SameSite=None
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Credentials: true
```

`/me` response:

```http
HTTP/1.1 401 Unauthorized
```

### Diagnosis

Bug paling jelas:

```ts
fetch('https://api.example.com/me')
```

tidak menyertakan:

```ts
credentials: 'include'
```

Untuk cross-origin request, cookie tidak otomatis dikirim seperti same-origin fetch biasa.

Fix:

```ts
await fetch('https://api.example.com/login', {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username, password }),
});

const me = await fetch('https://api.example.com/me', {
  credentials: 'include',
});
```

Tapi diagnosis belum selesai. Cek juga:

- apakah browser menerima cookie;
- apakah cookie third-party blocked;
- apakah `SameSite=None; Secure` memang diperlukan;
- apakah CORS preflight sukses;
- apakah `Vary: Origin` ada jika ACAO dinamis;
- apakah API dan app sebenarnya same-site atau cross-site;
- apakah session store menerima session id.

---

## 32. Mental Model Ringkas

```text
Cookie:
  Browser-managed credential/state.
  Bisa HttpOnly.
  Otomatis dikirim.
  Perlu CSRF defense.

Bearer token:
  Explicit credential.
  Dikirim via Authorization header.
  Tidak otomatis kena CSRF klasik.
  Jika JS-readable, XSS impact lebih besar.

HttpOnly:
  Melindungi dari JS read.
  Tidak otomatis mencegah action via XSS/CSRF.

SameSite:
  Mengurangi cross-site cookie sending.
  Bukan pengganti CSRF token untuk sistem kritikal.

CORS:
  Browser read/access policy.
  Bukan authentication.
  Bukan CSRF defense utama.

BFF:
  Memindahkan token sensitif ke server side.
  Browser cukup punya session cookie.
  Sangat sering lebih defensible untuk enterprise SPA.

SPA auth:
  Harus state machine.
  Jangan boolean.
```

---

## 33. Kesimpulan

Auth web modern adalah pertemuan antara:

- HTTP semantics;
- browser cookie rules;
- same-origin/same-site policy;
- CORS;
- CSRF;
- XSS;
- OAuth/OIDC;
- frontend state management;
- backend session/token lifecycle;
- observability;
- compliance dan UX.

Untuk menjadi engineer yang kuat, jangan mulai dari “pakai cookie atau token?”. Mulailah dari threat model dan boundary:

```text
Apa credential-nya?
Siapa yang bisa membacanya?
Kapan browser mengirimnya?
Apa yang terjadi jika XSS?
Apa yang terjadi jika CSRF?
Bagaimana credential dicabut?
Bagaimana multi-tab/retry/refresh bekerja?
Apa response contract untuk frontend?
Bagaimana kita tahu saat terjadi incident?
```

Jika Anda bisa menjawab pertanyaan-pertanyaan itu secara konkret, Anda bukan hanya “mengimplementasikan login”. Anda sedang mendesain sistem auth browser yang dapat dipertahankan di production.

---

## 34. Referensi Utama

Referensi berikut digunakan sebagai landasan konsep dan terminologi modern:

- MDN Web Docs — `Set-Cookie`, secure cookie configuration, SameSite, Web Storage API, Storage Access API.
- OWASP Cheat Sheet Series — Cross-Site Request Forgery Prevention Cheat Sheet.
- RFC 6265 — HTTP State Management Mechanism.
- IETF HTTP State Management Mechanism revision / `rfc6265bis` untuk konsep modern seperti SameSite dan cookie prefix.
- RFC 9700 — Best Current Practice for OAuth 2.0 Security, termasuk refresh token rotation.
- OAuth 2.0 for Browser-Based Applications draft/BCP track untuk threat model browser-based apps.
- WHATWG Fetch Standard untuk credentials mode, CORS, request/response model, dan browser fetch architecture.

---

## 35. Status Seri

```text
Part 013 selesai.
Seri belum selesai.
Lanjut ke Part 014: HTTP Caching Part 1: Browser Cache Mental Model.
```
