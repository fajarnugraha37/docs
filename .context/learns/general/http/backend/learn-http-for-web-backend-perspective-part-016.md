# learn-http-for-web-backend-perspective-part-016.md

# Part 016 — Cookies, Sessions, CSRF, and Browser-Coupled Backend

> Seri: **HTTP for Web/Backend Perspective**  
> Target pembaca: **Java software engineer** yang ingin memahami HTTP backend sampai level production-grade  
> Posisi dalam seri: **Part 016 dari 032**  
> Status seri: **Belum selesai**

---

## 0. Tujuan Part Ini

Pada part sebelumnya kita sudah membahas authentication dan authorization dari sisi HTTP backend. Sekarang kita masuk ke area yang sering membingungkan karena berada di perbatasan antara backend, browser, security, dan user experience:

- cookies,
- sessions,
- CSRF,
- browser-coupled backend,
- cookie-based authentication,
- session lifecycle,
- cross-site request behavior,
- dan desain backend API ketika client-nya adalah browser.

Banyak backend engineer salah memahami topik ini karena melihat cookie sebagai “sekadar tempat menyimpan token”. Padahal cookie adalah mekanisme HTTP state yang memiliki aturan pengiriman otomatis oleh browser. Karena otomatis, cookie sangat nyaman untuk session, tetapi juga membuka threat model khusus seperti CSRF, session fixation, session hijacking, cookie injection, dan cache leakage.

Part ini bertujuan membuat kamu memahami bukan hanya cara setting `HttpOnly`, `Secure`, atau `SameSite`, tetapi **mengapa atribut-atribut itu ada, threat model apa yang ditutup, trade-off apa yang muncul, dan bagaimana merancang backend yang aman ketika browser ikut menjadi bagian dari protocol behavior**.

Setelah menyelesaikan part ini, kamu harus mampu:

1. Membedakan HTTP statelessness vs application session state.
2. Memahami cookie sebagai state mechanism yang dikendalikan server tetapi disimpan dan dikirim oleh browser.
3. Mendesain session cookie yang aman untuk backend Java/Spring.
4. Menjelaskan kenapa CSRF terjadi pada cookie/session authentication.
5. Memilih strategi CSRF defense yang tepat untuk server-rendered apps, SPA, dan API hybrid.
6. Memahami `HttpOnly`, `Secure`, `SameSite`, `Domain`, `Path`, `Max-Age`, `Expires`, dan prefix cookie.
7. Membedakan cookie session vs bearer token dari sisi browser security.
8. Menghindari kesalahan umum seperti menyimpan JWT di `localStorage`, wildcard CORS dengan credentials, session tanpa rotation, dan CSRF token tanpa binding.
9. Mendesain lifecycle login, logout, session renewal, revocation, dan audit.
10. Memetakan implementasi ke Spring Security/Spring Boot.

---

## 1. Mental Model Utama: Browser-Coupled Backend

HTTP secara konsep stateless: setiap request membawa informasi yang cukup agar server bisa memprosesnya. Tetapi aplikasi web hampir selalu membutuhkan state:

- siapa user yang sedang login,
- tenant mana yang sedang aktif,
- permission apa yang berlaku,
- apakah MFA sudah selesai,
- apakah session masih valid,
- apakah device dipercaya,
- apakah CSRF token cocok,
- apakah user harus forced logout.

Cookie memungkinkan server menyimpan state kecil pada browser dan membuat browser mengirim state itu secara otomatis pada request berikutnya.

Mental modelnya:

```text
Server mengirim:

Set-Cookie: SESSION=abc123; HttpOnly; Secure; SameSite=Lax; Path=/

Browser menyimpan cookie sesuai rule.

Browser otomatis mengirim pada request yang cocok:

Cookie: SESSION=abc123
```

Yang penting: **browser mengirim cookie secara otomatis berdasarkan origin/site/path/security rules, bukan berdasarkan niat application JavaScript**.

Konsekuensinya:

- JavaScript tidak perlu menambahkan `Authorization` header.
- User tidak perlu tahu session id.
- Browser otomatis menjaga session continuity.
- Tetapi request dari halaman lain juga dapat membuat browser mengirim cookie jika rules mengizinkan.
- Karena itulah CSRF muncul.

Backend yang menggunakan cookie harus berpikir seperti ini:

> “Setiap endpoint state-changing yang menerima cookie credentials harus mengasumsikan bahwa request mungkin dipicu oleh pihak ketiga melalui browser user, kecuali server memverifikasi sinyal anti-CSRF yang tidak bisa dipalsukan oleh attacker.”

---

## 2. Cookie Bukan Storage Biasa

Cookie sering disalahpahami sebagai storage seperti `localStorage`. Ini salah.

Cookie adalah bagian dari HTTP state management:

- dibuat oleh server melalui `Set-Cookie`,
- disimpan oleh user agent,
- dikirim kembali melalui `Cookie`,
- memiliki rule domain/path/secure/same-site,
- dapat bersifat session atau persistent,
- dapat dibuat tidak bisa dibaca JavaScript dengan `HttpOnly`,
- dapat dibatasi hanya lewat HTTPS dengan `Secure`.

Bandingkan:

| Mechanism | Dikirim otomatis pada request? | Bisa dibuat HttpOnly? | Cocok untuk session secret? | Risiko utama |
|---|---:|---:|---:|---|
| Cookie | Ya | Ya | Ya, jika dikonfigurasi benar | CSRF, session hijack |
| localStorage | Tidak | Tidak | Tidak ideal | XSS token theft |
| sessionStorage | Tidak | Tidak | Tidak ideal | XSS token theft |
| In-memory JS variable | Tidak | Tidak | Lebih baik dari localStorage, tetapi volatile | XSS runtime access |
| Authorization header | Tidak otomatis | N/A | Cocok untuk API clients | token storage problem di browser |

Untuk backend, pertanyaan utamanya bukan “cookie vs token”, tetapi:

> “Apakah credential dikirim otomatis oleh browser?”

Jika ya, kamu perlu threat model CSRF. Jika tidak, kamu perlu threat model token theft, token storage, dan XSS exposure.

---

## 3. Anatomy `Set-Cookie`

Contoh cookie session production-style:

```http
Set-Cookie: __Host-session=7f3a...; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=1800
```

Komponen utama:

```text
Set-Cookie: <name>=<value>; <attribute>; <attribute>; ...
```

### 3.1 `name=value`

Contoh:

```http
Set-Cookie: SESSION=abc123
```

`SESSION` adalah nama cookie. `abc123` adalah value. Value ini sebaiknya:

- opaque,
- high entropy,
- tidak mengandung data sensitif readable,
- tidak mudah ditebak,
- tidak sequential,
- tidak memuat permission yang tidak bisa direvoke.

Untuk server-side session, value biasanya hanya identifier:

```text
SESSION=opaque_session_id
```

Server menyimpan state di session store:

```text
opaque_session_id -> user_id, tenant_id, auth_time, expiry, csrf_secret, mfa_state, roles_snapshot, etc.
```

### 3.2 `HttpOnly`

```http
Set-Cookie: SESSION=abc123; HttpOnly
```

`HttpOnly` membuat cookie tidak tersedia bagi JavaScript via `document.cookie`.

Tujuannya: mengurangi dampak XSS terhadap pencurian session cookie.

Namun penting:

- `HttpOnly` tidak mencegah browser mengirim cookie pada request.
- `HttpOnly` tidak mencegah CSRF.
- `HttpOnly` tidak membuat aplikasi aman dari XSS sepenuhnya.
- XSS masih bisa melakukan aksi sebagai user dengan mengirim request dari halaman yang sama.

Mental model:

```text
HttpOnly protects the secret from JavaScript read access.
It does not protect the session from being used by the browser.
```

### 3.3 `Secure`

```http
Set-Cookie: SESSION=abc123; Secure
```

`Secure` membuat cookie hanya dikirim lewat HTTPS.

Tanpa `Secure`, cookie dapat terkirim lewat HTTP plaintext jika user mengakses endpoint HTTP atau ada downgrade/misconfiguration.

Production rule:

> Session/auth cookies harus `Secure`.

Jika backend berada di belakang TLS-terminating proxy, pastikan aplikasi memahami original scheme melalui trusted forwarded headers. Kalau tidak, framework bisa salah mengira request adalah HTTP dan gagal mengatur secure cookie atau redirect.

### 3.4 `SameSite`

```http
Set-Cookie: SESSION=abc123; SameSite=Lax
```

`SameSite` mengontrol apakah cookie dikirim pada cross-site request.

Nilai umum:

- `Strict`
- `Lax`
- `None`

Konsep kunci: `SameSite` berbicara tentang **site**, bukan sekadar origin.

Simplifikasi:

```text
same-site   : request berasal dari site yang sama
cross-site  : request berasal dari site berbeda
```

`SameSite` adalah mitigasi CSRF yang sangat penting, tetapi bukan pengganti total CSRF token untuk semua skenario.

#### SameSite=Strict

Cookie hanya dikirim pada same-site navigation/request.

Kelebihan:

- proteksi CSRF paling ketat.

Kekurangan:

- bisa mengganggu UX saat user datang dari link eksternal.
- misalnya user klik link dari email ke aplikasi; session cookie mungkin tidak dikirim pada top-level navigation tertentu tergantung behavior browser.

Cocok untuk:

- admin console sangat sensitif,
- internal systems,
- high-risk operations,
- session tambahan untuk step-up auth.

#### SameSite=Lax

Cookie dikirim pada same-site request dan beberapa top-level navigation yang aman.

Ini sering menjadi default praktis untuk session cookie web app.

Cocok untuk:

- server-rendered apps,
- dashboard internal,
- session browser umum.

Tetapi untuk state-changing methods, tetap lebih aman memakai CSRF token.

#### SameSite=None

Cookie boleh dikirim dalam cross-site context, tetapi harus disertai `Secure` pada browser modern.

Cocok untuk:

- embedded iframe cross-site,
- third-party integration,
- SSO tertentu,
- frontend dan backend benar-benar beda site dan perlu cookie credential.

Risikonya:

- CSRF surface lebih besar.
- perlu CORS credentials yang sangat ketat.
- perlu CSRF defense yang kuat.

Production warning:

```http
Set-Cookie: SESSION=abc; SameSite=None; Secure; HttpOnly
```

`SameSite=None` tanpa desain CSRF/CORS yang benar adalah red flag.

### 3.5 `Domain`

```http
Set-Cookie: SESSION=abc123; Domain=example.com
```

`Domain` menentukan host mana yang dapat menerima cookie.

Jika `Domain` tidak diset, cookie biasanya host-only:

```text
api.example.com only
```

Jika `Domain=example.com`, cookie dapat dikirim ke subdomain yang cocok:

```text
app.example.com
api.example.com
admin.example.com
```

Security trade-off:

- Host-only cookie lebih sempit dan lebih aman.
- Domain-wide cookie lebih nyaman untuk SSO antar-subdomain tetapi memperluas blast radius.
- Jika satu subdomain compromised, risiko terhadap domain-wide cookie meningkat.

Rule praktis:

> Jangan set `Domain` kecuali benar-benar perlu share cookie antar-subdomain.

### 3.6 `Path`

```http
Set-Cookie: SESSION=abc123; Path=/admin
```

`Path` membatasi path request yang akan menerima cookie.

Namun jangan menganggap `Path` sebagai boundary security yang kuat. Ini lebih untuk scoping dan collision management.

Rule praktis:

- auth session utama biasanya `Path=/`.
- cookie khusus area dapat diberi path spesifik.
- jangan bergantung pada `Path` untuk isolasi tenant/security kritis.

### 3.7 `Max-Age` dan `Expires`

```http
Set-Cookie: SESSION=abc123; Max-Age=1800
```

atau:

```http
Set-Cookie: SESSION=abc123; Expires=Wed, 19 Jun 2026 12:00:00 GMT
```

`Max-Age` menentukan lifetime relatif dalam detik. `Expires` menentukan absolute expiry.

Jenis cookie:

| Jenis | Ciri | Risiko |
|---|---|---|
| Session cookie | Tanpa persistent expiry eksplisit | Hilang saat browser/session berakhir, tetapi behavior browser modern bisa restore session |
| Persistent cookie | Ada `Max-Age`/`Expires` | Lebih nyaman tetapi lebih lama terekspos |

Backend harus membedakan:

- browser cookie lifetime,
- server session lifetime,
- idle timeout,
- absolute timeout,
- token lifetime,
- refresh lifecycle.

Jangan hanya mengandalkan cookie expiry. Server tetap harus memvalidasi session expiry di session store.

### 3.8 Cookie Prefix: `__Host-` dan `__Secure-`

Cookie prefix adalah defense-in-depth.

`__Secure-` biasanya mensyaratkan cookie diset dengan `Secure` dari secure origin.

`__Host-` lebih ketat. Praktik umum untuk host-bound session cookie:

```http
Set-Cookie: __Host-session=abc123; Secure; HttpOnly; Path=/; SameSite=Lax
```

Untuk `__Host-`, jangan set `Domain`, dan `Path` harus `/`.

Manfaat:

- mengurangi risiko subdomain cookie injection,
- memperjelas security intent,
- cocok untuk session cookie utama.

---

## 4. `Cookie` Request Header

Saat request cocok dengan cookie rules, browser mengirim:

```http
Cookie: SESSION=abc123; theme=dark; locale=id-ID
```

Backend perlu memahami beberapa hal:

1. Banyak cookie bisa dikirim sekaligus.
2. Header `Cookie` dapat menjadi besar.
3. Urutan cookie tidak boleh dijadikan contract kritis.
4. Duplicate cookie name dapat menyebabkan ambiguity.
5. Cookie dari client tidak boleh dipercaya tanpa validasi.
6. Cookie value bisa dimanipulasi oleh user.
7. Cookie harus diperlakukan seperti untrusted input.

Session cookie boleh opaque, tetapi tetap harus:

- diverifikasi keberadaannya di server store,
- dicek expiry,
- dicek revocation,
- dicek binding tambahan jika diterapkan,
- dicek MFA/auth state,
- dicek tenant/context.

---

## 5. Session: State di Atas HTTP

Session adalah logical authenticated interaction antara user agent dan backend.

Ada dua model besar:

1. server-side session,
2. client-side/self-contained session.

### 5.1 Server-Side Session

Cookie hanya berisi session id:

```http
Cookie: __Host-session=sid_8Ykw...
```

Server menyimpan state:

```text
sid_8Ykw... -> {
  userId: "u-123",
  tenantId: "t-001",
  authTime: "2026-06-19T08:12:00Z",
  lastSeen: "2026-06-19T08:40:12Z",
  mfaSatisfied: true,
  csrfSecret: "...",
  expiry: "2026-06-19T09:12:00Z",
  absoluteExpiry: "2026-06-19T18:12:00Z",
  revoked: false
}
```

Kelebihan:

- mudah revoke,
- state bisa diubah server-side,
- value cookie tidak mengandung data sensitif,
- cocok untuk high-security apps,
- dapat menyimpan CSRF secret/session metadata,
- mudah forced logout.

Kekurangan:

- butuh session store,
- perlu distributed session strategy,
- ada latency store,
- perlu cleanup,
- scaling harus dirancang.

### 5.2 Client-Side/Self-Contained Session

Cookie berisi token signed/encrypted, misalnya JWT atau encrypted blob.

Kelebihan:

- tidak selalu butuh session store,
- mudah scale read-only,
- cocok untuk beberapa use case stateless.

Kekurangan:

- revocation lebih sulit,
- token bisa tetap valid sampai expiry,
- perubahan permission tidak langsung berlaku,
- ukuran cookie bisa besar,
- klaim mudah disalahgunakan jika tidak diverifikasi benar,
- rotasi key harus dikelola,
- tidak cocok untuk banyak state mutable.

Rule penting:

> Self-contained token bukan berarti tidak perlu server-side control. Untuk aplikasi sensitif, sering tetap diperlukan denylist, session version, user security stamp, atau introspection.

### 5.3 Session Store Options

Pilihan umum:

| Store | Kelebihan | Risiko |
|---|---|---|
| In-memory per node | sederhana | tidak cocok multi-node tanpa sticky session |
| Distributed cache Redis | cepat, umum | perlu HA, eviction policy, TTL benar |
| Database | durable, auditable | latency lebih tinggi |
| Hybrid | fleksibel | kompleksitas lebih tinggi |

Untuk production multi-instance, jangan mengandalkan memory lokal kecuali:

- ada sticky session yang benar,
- risiko failover diterima,
- session tidak penting,
- atau sistem memang single-node/internal.

Untuk regulatory/high-audit systems, session event sering perlu dicatat di durable audit log walau session state ada di Redis.

---

## 6. Session Lifecycle

Session bukan hanya “login lalu simpan cookie”. Session memiliki lifecycle.

```text
Anonymous
  -> Authentication Started
  -> Credentials Verified
  -> MFA Pending
  -> Authenticated Session Created
  -> Active
  -> Idle Extended / Renewed
  -> Step-Up Required
  -> Logout / Expired / Revoked / Forced Logout
```

### 6.1 Login

Login flow yang aman:

1. User submit credential.
2. Server validates credential.
3. Server invalidates pre-login session if any.
4. Server creates new session id.
5. Server stores session state.
6. Server sets cookie with secure attributes.
7. Server returns response.

Contoh response:

```http
HTTP/1.1 204 No Content
Set-Cookie: __Host-session=sid_xxx; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=1800
Cache-Control: no-store
```

Kenapa harus rotate session id setelah login?

Karena session fixation.

### 6.2 Session Fixation

Session fixation terjadi ketika attacker membuat/menetapkan session id yang kemudian dipakai victim setelah login.

Skenario sederhana:

1. Attacker memperoleh session id anonymous.
2. Attacker membuat victim memakai session id tersebut.
3. Victim login.
4. Jika server tidak rotate session id, session id attacker sekarang authenticated.

Defense:

- rotate session id setelah authentication berhasil,
- rotate setelah privilege escalation/MFA,
- jangan menerima session id dari URL,
- gunakan cookie secure attributes,
- invalidate old session.

### 6.3 Idle Timeout

Idle timeout mengakhiri session jika tidak ada aktivitas selama periode tertentu.

Contoh:

```text
idleTimeout = 30 minutes
```

Setiap request valid memperbarui `lastSeen`.

Risiko:

- terlalu pendek mengganggu UX,
- terlalu panjang memperbesar risiko session hijack,
- sliding renewal tanpa absolute timeout bisa membuat session hidup selamanya.

### 6.4 Absolute Timeout

Absolute timeout mengakhiri session setelah durasi maksimum sejak login, terlepas dari aktivitas.

Contoh:

```text
absoluteTimeout = 12 hours
```

Ini penting untuk:

- security,
- compliance,
- forced reauthentication,
- membatasi lifetime credential.

### 6.5 Session Renewal

Session renewal dapat berarti:

- memperpanjang server-side expiry,
- menerbitkan cookie baru,
- rotate session id,
- refresh token/session pair.

Backend harus menghindari race condition:

```text
Request A renews session
Request B uses old session concurrently
Logout happens concurrently
```

Semua state transition session harus dirancang sebagai state machine, bukan boolean sederhana.

### 6.6 Logout

Logout bukan hanya menghapus cookie di browser.

Logout aman:

1. Revoke/invalidate session server-side.
2. Clear cookie client-side.
3. Return no-store response.
4. Optionally revoke refresh token/device session.
5. Audit event.

Contoh:

```http
HTTP/1.1 204 No Content
Set-Cookie: __Host-session=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0
Cache-Control: no-store
```

Jika hanya menghapus cookie tetapi session store masih valid, session bisa dipakai lagi jika cookie dicuri sebelumnya.

### 6.7 Forced Logout / Revocation

Sistem production perlu forced logout:

- password changed,
- account disabled,
- role revoked,
- suspicious activity,
- admin terminate session,
- device removed,
- tenant access removed.

Server-side session mempermudah ini.

Untuk stateless JWT-cookie, perlu strategi tambahan:

- short access token lifetime,
- refresh token store,
- token version/security stamp,
- denylist untuk high-risk events,
- introspection.

---

## 7. CSRF: Core Threat Model

CSRF adalah Cross-Site Request Forgery.

Intinya:

> Attacker membuat browser victim mengirim request ke target site, dan browser otomatis menyertakan cookie/session victim.

Contoh:

User sedang login ke:

```text
https://bank.example.com
```

Attacker mengontrol:

```text
https://evil.example.net
```

Attacker membuat form tersembunyi:

```html
<form action="https://bank.example.com/transfer" method="POST">
  <input name="to" value="attacker" />
  <input name="amount" value="1000000" />
</form>
<script>document.forms[0].submit()</script>
```

Jika browser mengirim session cookie bank pada request tersebut dan server hanya memeriksa cookie, server bisa menganggap request sah.

CSRF terjadi karena kombinasi:

1. browser otomatis mengirim credential,
2. server menerima state-changing operation berdasarkan credential tersebut,
3. attacker bisa memicu request lintas site,
4. server tidak memverifikasi intent signal yang attacker tidak bisa tahu/buat.

### 7.1 CSRF Bukan XSS

| Threat | Attacker bisa menjalankan JS di origin target? | Credential otomatis dipakai? | Defense utama |
|---|---:|---:|---|
| CSRF | Tidak | Ya | CSRF token, SameSite, Origin check |
| XSS | Ya | Ya | output encoding, CSP, sanitization, HttpOnly helps token theft |

CSRF mengandalkan browser victim. XSS menguasai origin target.

Jika ada XSS, CSRF token sering bisa dicuri/dipakai karena attacker menjalankan JavaScript di origin yang sah. Jadi CSRF defense bukan pengganti XSS defense.

### 7.2 CSRF dan JSON API

Banyak engineer mengira JSON API aman dari CSRF. Tidak selalu.

Memang, browser tidak bisa sembarang membuat cross-site JSON `Content-Type: application/json` tanpa preflight via simple HTML form. Tetapi:

- endpoint yang menerima `application/x-www-form-urlencoded`, `multipart/form-data`, atau `text/plain` bisa rentan,
- CORS misconfiguration dapat membuka jalan,
- method override bisa menciptakan celah,
- beberapa endpoint state-changing mungkin GET/POST simple,
- login/logout endpoint juga bisa punya CSRF implications.

Rule aman:

> Jika backend memakai cookie credential dan endpoint mengubah state, gunakan CSRF defense kecuali kamu bisa membuktikan threat model menutupnya dengan cara lain.

---

## 8. CSRF Defense Patterns

### 8.1 Synchronizer Token Pattern

Server menyimpan CSRF token/secret di session. Form/page menerima token. Request state-changing harus mengirim token.

Flow:

```text
1. Server creates session with csrf_secret.
2. Server renders page or exposes endpoint to get CSRF token.
3. Client sends token in hidden field or header.
4. Server compares token with session-bound expected value.
```

Example form:

```html
<form method="post" action="/cases/C-123/approve">
  <input type="hidden" name="_csrf" value="token123" />
  <button>Approve</button>
</form>
```

Backend checks:

```text
session.csrfSecret matches request token
```

Kelebihan:

- kuat untuk server-side session,
- token bound to session,
- cocok untuk server-rendered app.

Kekurangan:

- perlu server-side state,
- SPA perlu cara mengambil token.

### 8.2 Double Submit Cookie Pattern

Server mengirim CSRF token di cookie yang bisa dibaca JavaScript, lalu client mengirim nilai yang sama di header/request parameter.

```http
Set-Cookie: XSRF-TOKEN=random123; Path=/; Secure; SameSite=Lax
```

Client mengirim:

```http
X-XSRF-TOKEN: random123
```

Server membandingkan:

```text
cookie XSRF-TOKEN == header X-XSRF-TOKEN
```

Namun versi naive punya risiko cookie injection. Pattern yang lebih kuat adalah **signed double-submit cookie** yang mengikat token ke session/user-specific data.

Production direction:

- token harus high entropy,
- token harus signed/HMAC,
- token harus bound ke session id atau session secret,
- jangan hanya membandingkan cookie dan header tanpa binding pada aplikasi sensitif.

### 8.3 Custom Header Defense

Untuk API yang hanya menerima state-changing request dengan custom header seperti:

```http
X-CSRF-Token: ...
```

Attacker dari cross-site HTML form tidak bisa menambahkan custom header. Jika request cross-origin menggunakan `fetch` dengan custom header, browser memerlukan CORS preflight. Jika CORS policy ketat, attacker gagal.

Tetapi ini tidak cukup jika:

- CORS allowlist terlalu longgar,
- `Access-Control-Allow-Origin` memantulkan origin sembarang,
- `Access-Control-Allow-Credentials: true` dipakai sembrono,
- token bisa ditebak/dicuri,
- same-origin XSS ada.

### 8.4 Origin / Referer Check

Server dapat memeriksa:

```http
Origin: https://app.example.com
```

atau `Referer` untuk request state-changing.

Kelebihan:

- defense-in-depth,
- berguna untuk API cookie-based.

Kekurangan:

- beberapa request mungkin tidak menyertakan header,
- privacy tools/proxy bisa menghapus,
- implementasi harus hati-hati terhadap parsing origin,
- jangan jadikan satu-satunya defense untuk high-risk endpoint.

Pattern bagus:

```text
Require valid CSRF token
AND optionally verify Origin/Referer for unsafe methods
```

### 8.5 SameSite as Defense-in-Depth

`SameSite=Lax` atau `Strict` mengurangi CSRF surface karena cookie tidak selalu dikirim pada cross-site request.

Namun:

- bukan semua browser/environment sama,
- `SameSite=None` diperlukan untuk beberapa integration,
- login CSRF dan top-level navigation edge cases tetap perlu dipahami,
- SameSite tidak menggantikan authorization.

Praktik umum:

```text
Session cookie: SameSite=Lax by default
High-risk cookie: SameSite=Strict if UX allows
Cross-site embedded flows: SameSite=None; Secure + strong CSRF/CORS
```

---

## 9. Endpoint Mana yang Perlu CSRF Protection?

CSRF protection terutama untuk request yang:

1. menggunakan browser automatic credentials,
2. mengubah server state,
3. punya dampak user/security/business.

Biasanya wajib untuk:

- POST create/update/action,
- PUT,
- PATCH,
- DELETE,
- logout,
- change password,
- change email,
- approve/reject workflow,
- upload evidence,
- submit form,
- configure notification/beneficiary/payment,
- tenant switch jika mengubah server-side default context,
- OAuth consent/authorization flows.

Safe methods seperti GET seharusnya tidak mengubah state. Jika GET mengubah state, kamu menciptakan CSRF-friendly endpoint.

Rule:

> Jangan membuat GET untuk mutation. CSRF defense tidak boleh dipakai untuk menutupi method semantics yang salah.

---

## 10. Cookie Session vs Bearer Token untuk Browser

Banyak modern SPA memakai bearer token. Pertanyaannya: di mana token disimpan?

### 10.1 Cookie Session

Credential otomatis dikirim oleh browser.

Kelebihan:

- `HttpOnly` melindungi dari token theft via JavaScript read,
- mudah revoke jika server-side session,
- cocok untuk browser app,
- terintegrasi dengan session lifecycle.

Kekurangan:

- butuh CSRF defense,
- CORS credentials lebih tricky jika beda origin/site,
- session store mungkin diperlukan.

### 10.2 Bearer Token di localStorage

Client menyimpan token di `localStorage`, lalu mengirim:

```http
Authorization: Bearer eyJ...
```

Kelebihan:

- tidak otomatis dikirim, sehingga CSRF surface lebih rendah,
- mudah untuk API-style client.

Kekurangan:

- token mudah dicuri oleh XSS karena JavaScript bisa membaca localStorage,
- revocation sering sulit jika JWT long-lived,
- token bisa bocor via logs/debugging,
- sering disalahgunakan sebagai “stateless security”.

### 10.3 Bearer Token di HttpOnly Cookie

Kadang tim menyimpan JWT di HttpOnly cookie.

Ini membuat token tidak bisa dibaca JS, tetapi karena cookie otomatis dikirim, threat model menjadi mirip cookie session:

- perlu CSRF defense,
- perlu SameSite,
- perlu revocation strategy,
- JWT size/lifetime perlu dikontrol.

Jangan berpikir:

```text
JWT in HttpOnly cookie => no CSRF needed
```

Yang menentukan CSRF adalah automatic credential sending.

### 10.4 In-Memory Token

Token disimpan di memory JS runtime.

Kelebihan:

- tidak persistent setelah refresh/tab close,
- tidak semudah localStorage untuk dicuri secara pasif.

Kekurangan:

- XSS aktif tetap bisa memakai token,
- refresh flow kompleks,
- UX bisa terganggu,
- sering butuh refresh token di cookie.

### 10.5 Recommendation Matrix

| Scenario | Rekomendasi umum |
|---|---|
| Server-rendered Java web app | Server-side session cookie + CSRF token |
| Same-site SPA + backend | HttpOnly session cookie + CSRF header + SameSite=Lax |
| Cross-site SPA + backend | Cookie only jika benar-benar perlu; SameSite=None; Secure + strict CORS + CSRF |
| Mobile/native app | Bearer token, no browser CSRF model |
| Service-to-service | mTLS/client credentials/API token, no browser cookie |
| High-security admin | Server-side session + SameSite=Strict if possible + step-up + strong audit |
| Public API for third parties | Bearer/OAuth2 token, not browser session cookie |

---

## 11. CORS + Cookie Credentials

CORS akan dibahas lebih detail di Part 017, tetapi untuk cookie/session kita perlu memahami interaksinya.

Browser cross-origin `fetch` tidak akan mengirim cookie kecuali client memakai credentials mode:

```javascript
fetch("https://api.example.com/me", {
  credentials: "include"
})
```

Server juga harus mengizinkan credentials:

```http
Access-Control-Allow-Credentials: true
Access-Control-Allow-Origin: https://app.example.com
```

Tidak boleh:

```http
Access-Control-Allow-Origin: *
Access-Control-Allow-Credentials: true
```

Backend harus menerapkan allowlist origin eksplisit.

Jika memakai cookie cross-site:

```http
Set-Cookie: __Host-session=...; Secure; HttpOnly; SameSite=None; Path=/
```

Maka kamu harus sangat serius dengan:

- CORS allowlist,
- CSRF token,
- Origin validation,
- cookie domain scoping,
- logout/revocation,
- audit.

---

## 12. Session Cookie Configuration Baseline

Baseline untuk session cookie same-site app:

```http
Set-Cookie: __Host-session=<opaque>; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=1800
```

Untuk high-security admin:

```http
Set-Cookie: __Host-admin-session=<opaque>; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=900
```

Untuk cross-site embedded/integration:

```http
Set-Cookie: __Host-session=<opaque>; Path=/; Secure; HttpOnly; SameSite=None; Max-Age=1800
```

Tetapi `SameSite=None` harus disertai:

- strict CSRF token,
- strict CORS,
- Origin check,
- tight expiry,
- audit,
- no wildcard origin.

---

## 13. Cache Rules untuk Session Responses

Authenticated/session responses sering mengandung data sensitif. Backend harus mengatur cache header.

Untuk response sensitif:

```http
Cache-Control: no-store
Pragma: no-cache
```

`no-store` memberi sinyal bahwa response tidak boleh disimpan oleh cache.

Gunakan untuk:

- login response,
- logout response,
- account page,
- personal data,
- regulatory case confidential details,
- token/session exchange,
- CSRF token endpoint,
- permission-sensitive response.

Jangan mengandalkan default framework.

Kesalahan umum:

```http
GET /me
HTTP/1.1 200 OK
Cache-Control: public, max-age=3600
```

Ini berbahaya jika response user-specific.

---

## 14. CSRF Token Response Design untuk SPA

Untuk SPA same-site dengan cookie session, pattern umum:

1. User login.
2. Server set HttpOnly session cookie.
3. SPA mengambil CSRF token via endpoint atau cookie non-HttpOnly khusus.
4. SPA mengirim token via header pada unsafe methods.

### 14.1 Endpoint Token

```http
GET /csrf-token
Cookie: __Host-session=sid_x
```

Response:

```json
{
  "token": "csrf_..."
}
```

Headers:

```http
Cache-Control: no-store
```

Lalu client:

```http
POST /cases/C-123/approve
Cookie: __Host-session=sid_x
X-CSRF-Token: csrf_...
Content-Type: application/json
```

Server:

- validate session,
- validate CSRF token bound to session,
- validate authorization,
- process operation.

### 14.2 XSRF Cookie Pattern

Server set:

```http
Set-Cookie: XSRF-TOKEN=<token>; Path=/; Secure; SameSite=Lax
```

Cookie ini **tidak** `HttpOnly` agar JavaScript bisa membacanya dan menaruh di header.

Session cookie tetap `HttpOnly`:

```http
Set-Cookie: __Host-session=<sid>; Path=/; Secure; HttpOnly; SameSite=Lax
```

Request:

```http
Cookie: __Host-session=<sid>; XSRF-TOKEN=<token>
X-XSRF-TOKEN: <token>
```

Backend harus memastikan token valid dan preferably bound ke session.

Catatan penting:

- CSRF token bukan authentication secret.
- Token boleh readable oleh JavaScript jika pattern memerlukannya.
- Session cookie tetap harus HttpOnly.

---

## 15. Spring Security Mental Model

Spring Security menyediakan CSRF protection terutama untuk browser-based applications. Prinsipnya:

- unsafe HTTP methods butuh CSRF token,
- token bisa disimpan di session atau cookie repository,
- server memvalidasi token sebelum request masuk ke controller,
- API stateless non-browser dapat menonaktifkan CSRF jika tidak memakai browser automatic credentials.

### 15.1 Servlet Stack: Session Cookie + CSRF

Contoh konseptual:

```java
@Configuration
class SecurityConfig {

    @Bean
    SecurityFilterChain security(HttpSecurity http) throws Exception {
        return http
            .csrf(csrf -> csrf
                .csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse())
            )
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/login", "/csrf-token").permitAll()
                .anyRequest().authenticated()
            )
            .formLogin(Customizer.withDefaults())
            .logout(logout -> logout
                .deleteCookies("JSESSIONID", "XSRF-TOKEN")
                .invalidateHttpSession(true)
            )
            .build();
    }
}
```

Catatan:

- `CookieCsrfTokenRepository.withHttpOnlyFalse()` membuat token bisa dibaca JavaScript.
- Jangan samakan CSRF token cookie dengan session cookie.
- Session cookie tetap harus protected.
- Cookie attributes sering dikonfigurasi via Spring Boot/server properties atau custom cookie serializer tergantung stack.

### 15.2 Session Creation Policy

Spring Security dapat dikonfigurasi dengan session policy:

- `ALWAYS`
- `IF_REQUIRED`
- `NEVER`
- `STATELESS`

Untuk browser session app, `IF_REQUIRED` biasanya normal.

Untuk pure bearer token API non-browser:

```java
.sessionManagement(sm -> sm.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
.csrf(csrf -> csrf.disable())
```

Tetapi jangan disable CSRF hanya karena endpoint JSON. Pertanyaannya:

> Apakah browser akan mengirim credential otomatis?

Jika ya, disabling CSRF perlu justifikasi kuat.

### 15.3 WebFlux

WebFlux memiliki security chain reactive. Konsepnya sama:

- validate authentication,
- validate CSRF for unsafe methods,
- continue reactive handler jika lolos.

Perhatian khusus:

- jangan blocking session store di event loop,
- reactive session store harus non-blocking,
- token generation/validation harus murah,
- context propagation perlu hati-hati.

---

## 16. Java Servlet Session: `JSESSIONID`

Dalam Servlet stack, session default sering memakai cookie bernama `JSESSIONID`.

Contoh:

```http
Set-Cookie: JSESSIONID=abc123; Path=/; HttpOnly
```

Production hardening perlu memastikan:

- `Secure`,
- `HttpOnly`,
- `SameSite`,
- session timeout,
- session fixation protection,
- session invalidation on logout,
- no URL rewriting session id,
- distributed session strategy.

### 16.1 Jangan Letakkan Session ID di URL

URL-based session tracking seperti:

```text
/app;jsessionid=abc123
```

berbahaya karena session id bisa bocor lewat:

- logs,
- browser history,
- referer,
- screenshots,
- monitoring tools,
- shared links.

Production rule:

> Session id harus lewat secure cookie, bukan URL.

### 16.2 Session Attribute Hygiene

Jangan menyimpan object besar/kompleks sembarangan di session.

Risiko:

- memory bloat,
- serialization problem,
- stale authorization,
- data leakage,
- distributed session replication overhead,
- class version incompatibility.

Simpan minimal state:

- user id,
- tenant id/current context,
- auth strength,
- csrf secret,
- session metadata.

Permission dapat dihitung ulang atau disimpan sebagai snapshot dengan invalidation strategy.

---

## 17. Multi-Tenant Session Design

Untuk aplikasi multi-tenant, session tidak hanya menjawab “siapa user”, tetapi juga “dalam konteks tenant mana”.

Pertanyaan penting:

1. Apakah user bisa punya akses ke banyak tenant?
2. Apakah tenant dipilih per session, per request, atau per resource?
3. Apakah tenant berasal dari subdomain, path, header, atau session state?
4. Apakah CSRF token bound ke tenant context?
5. Apa yang terjadi jika tenant access dicabut saat session aktif?

Pattern aman:

- session menyimpan user id dan allowed tenant summary,
- setiap request tetap memvalidasi resource tenant boundary,
- current tenant tidak boleh menjadi satu-satunya authorization proof,
- tenant switch harus diaudit,
- tenant switch bisa memerlukan CSRF protection jika stateful.

Contoh endpoint:

```http
POST /session/current-tenant
Content-Type: application/json
X-CSRF-Token: ...

{
  "tenantId": "t-002"
}
```

Kenapa POST? Karena mengubah server-side session context.

---

## 18. Regulatory Case Management Example

Misalkan sistem enforcement lifecycle memiliki roles:

- investigator,
- supervisor,
- legal reviewer,
- admin,
- external agency user.

Session state:

```json
{
  "sessionId": "sid_...",
  "userId": "u-123",
  "tenantId": "agency-01",
  "authStrength": "MFA",
  "roles": ["INVESTIGATOR"],
  "caseAccessMode": "INTERNAL",
  "csrfSecret": "...",
  "issuedAt": "2026-06-19T01:00:00Z",
  "lastSeenAt": "2026-06-19T01:22:00Z",
  "absoluteExpiresAt": "2026-06-19T09:00:00Z"
}
```

High-risk operations:

```http
POST /cases/C-100/evidence
POST /cases/C-100/submit-for-review
POST /cases/C-100/assignments
POST /cases/C-100/escalations
POST /cases/C-100/decisions
DELETE /cases/C-100/evidence/E-9
PATCH /cases/C-100/parties/P-7
```

All require:

- authenticated session,
- CSRF token,
- object-level authorization,
- state transition guard,
- audit event,
- idempotency where needed,
- no-store response for sensitive data,
- correlation id.

Example approval request:

```http
POST /cases/C-100/submit-for-review
Cookie: __Host-session=sid_abc
X-CSRF-Token: csrf_xyz
Idempotency-Key: submit-review-C-100-20260619-001
Content-Type: application/json

{
  "comment": "Evidence package complete."
}
```

Server pipeline:

```text
1. Validate TLS/proxy trust.
2. Parse cookie.
3. Lookup session.
4. Check session expiry/revocation.
5. Validate CSRF token bound to session.
6. Validate JSON body.
7. Check authorization: user can submit this case.
8. Check state machine: case is DRAFT/READY.
9. Check idempotency key.
10. Execute transition transactionally.
11. Append audit log.
12. Return stable response.
```

Notice: CSRF is only one gate. It proves browser request intent signal, not business permission.

---

## 19. Login CSRF and Logout CSRF

### 19.1 Login CSRF

Login CSRF occurs when attacker logs victim into attacker-controlled account on target site. Victim then performs actions unknowingly under attacker account.

This can matter when:

- actions are linked to account identity,
- user uploads sensitive data,
- user binds device/payment/profile,
- audit attribution matters.

Defense:

- CSRF protection on login forms,
- SameSite cookies,
- re-authentication for sensitive actions,
- clear account identity UI,
- rotate session after login.

### 19.2 Logout CSRF

Logout CSRF forces victim logout. Often lower severity, but can be used in attacks:

- denial of service,
- forcing re-login phishing,
- disrupting workflow,
- weakening user trust.

Use POST for logout and CSRF protection where practical.

Avoid:

```http
GET /logout
```

---

## 20. Step-Up Authentication and Session Strength

Not all authenticated sessions are equal.

Session may have auth strength:

```text
ANONYMOUS
PASSWORD_ONLY
MFA_VERIFIED
RECENT_REAUTH
ADMIN_STEP_UP
```

Sensitive operations may require stronger session:

- change password,
- export sensitive case data,
- approve enforcement decision,
- modify role/permission,
- delete evidence,
- create API key.

Backend checks:

```text
if session.authStrength < requiredStrength:
    return 403 or 401 with step-up challenge
```

HTTP design:

```http
HTTP/1.1 403 Forbidden
Content-Type: application/problem+json
Cache-Control: no-store

{
  "type": "https://api.example.com/problems/step-up-required",
  "title": "Step-up authentication required",
  "status": 403,
  "requiredAuthStrength": "MFA_RECENT"
}
```

After successful step-up:

- rotate session id or update session strength,
- record timestamp,
- expire step-up after short time,
- audit event.

---

## 21. Session Binding: Useful but Dangerous if Overdone

Some systems bind session to:

- IP address,
- user agent,
- device id,
- TLS client cert,
- risk score.

Benefits:

- detect stolen cookies,
- reduce replay risk,
- support anomaly detection.

Risks:

- mobile IP changes,
- corporate proxy/NAT,
- privacy tooling,
- false positives,
- accessibility/user frustration.

Practical approach:

- do not hard-bind to IP for general consumer apps,
- use signals for risk scoring,
- require step-up on suspicious change,
- hard-bind only in controlled environments or mTLS contexts.

---

## 22. Cookie Size and Header Bloat

Cookies are sent on matching requests. Large cookies increase every request size.

Risks:

- latency overhead,
- gateway header limit exceeded,
- `431 Request Header Fields Too Large`,
- load balancer rejection,
- logs filled with sensitive data,
- mobile network inefficiency.

Avoid putting large JWTs or permission lists in cookies.

Rule:

> Auth cookie should be small, opaque, and scoped.

---

## 23. Security Anti-Patterns

### Anti-pattern 1: JWT in localStorage for browser session

Problem:

- XSS can steal token.
- Token often long-lived.
- Revocation difficult.

Better:

- HttpOnly secure cookie session,
- or short-lived memory token with strong refresh design,
- and invest in XSS prevention.

### Anti-pattern 2: HttpOnly cookie but no CSRF

Problem:

- cookie is still sent automatically.
- CSRF still possible.

Better:

- SameSite + CSRF token + Origin checks for unsafe methods.

### Anti-pattern 3: `SameSite=None` without strict CORS and CSRF

Problem:

- cross-site cookie sending is enabled.

Better:

- use only when required,
- add `Secure`,
- strict origin allowlist,
- CSRF token,
- audit.

### Anti-pattern 4: Domain-wide cookie unnecessarily

Problem:

```http
Domain=example.com
```

makes cookie available to many subdomains.

Better:

- host-only cookie,
- `__Host-` prefix.

### Anti-pattern 5: GET mutation

Problem:

- browser/previews/crawlers/link clicks can trigger state change,
- CSRF becomes easier,
- caching/proxy semantics break.

Better:

- unsafe operations use POST/PUT/PATCH/DELETE,
- require CSRF where cookie-authenticated.

### Anti-pattern 6: Logout only clears browser cookie

Problem:

- stolen cookie remains valid.

Better:

- revoke server session,
- then clear cookie.

### Anti-pattern 7: CSRF token not bound to session

Problem:

- token injection/reuse attacks.

Better:

- synchronizer token or signed double-submit bound to session-specific data.

### Anti-pattern 8: Storing sensitive data in cookie

Problem:

- user can view/manipulate non-HttpOnly cookies,
- cookie may leak via logs/tools,
- size bloat.

Better:

- opaque id only,
- server-side state,
- signed/encrypted only if justified.

### Anti-pattern 9: Trusting CORS as auth

Problem:

- CORS is browser policy, not authentication.
- non-browser clients ignore it.

Better:

- authenticate and authorize every request.

### Anti-pattern 10: No session audit

Problem:

- impossible to investigate compromised account.

Better:

- audit login/logout/session revoke/step-up/failed CSRF/high-risk action.

---

## 24. Backend Checklist: Cookie Session Production Baseline

For session cookie:

- [ ] Cookie value is opaque and high entropy.
- [ ] `Secure` enabled.
- [ ] `HttpOnly` enabled for session credential.
- [ ] `SameSite=Lax` or stricter by default.
- [ ] `SameSite=None` only with strong reason.
- [ ] `Path=/` deliberate.
- [ ] `Domain` omitted unless required.
- [ ] Prefer `__Host-` prefix for host-bound session.
- [ ] Server validates session expiry.
- [ ] Server supports revocation.
- [ ] Session id rotates after login.
- [ ] Session id rotates after privilege escalation if needed.
- [ ] Logout invalidates server-side session.
- [ ] Session store has TTL and cleanup.
- [ ] Sensitive responses use `Cache-Control: no-store`.
- [ ] Session id never appears in URL.
- [ ] Cookie/header values are not logged raw.

For CSRF:

- [ ] Unsafe methods require CSRF token when using cookie credentials.
- [ ] Token is high entropy.
- [ ] Token is bound to session or signed with session-specific data.
- [ ] Token is verified before state mutation.
- [ ] Missing/invalid token returns stable 403 problem response.
- [ ] Login/logout behavior considered.
- [ ] Origin/Referer checks used as defense-in-depth where appropriate.
- [ ] CORS credentials policy is strict.
- [ ] `GET` endpoints do not mutate state.
- [ ] CSRF events are observable and rate-limited if abused.

For browser-coupled backend:

- [ ] Decide same-site vs cross-site deployment explicitly.
- [ ] Define cookie strategy per environment.
- [ ] Define CORS allowlist if cross-origin.
- [ ] Define session timeout and absolute timeout.
- [ ] Define step-up authentication policy.
- [ ] Define forced logout triggers.
- [ ] Define audit requirements.
- [ ] Test with real browser behavior, not only curl/Postman.

---

## 25. Testing Strategy

### 25.1 Unit Tests

Test:

- cookie builder sets expected attributes,
- CSRF token generation/validation,
- token/session binding,
- session expiry logic,
- session rotation logic,
- logout invalidation.

### 25.2 Integration Tests

Test with MockMvc/WebTestClient:

- unsafe method without token -> 403,
- unsafe method with invalid token -> 403,
- unsafe method with valid token -> allowed if authorized,
- GET safe endpoint does not require token,
- login rotates session,
- logout invalidates session,
- sensitive responses have no-store.

Example conceptual MockMvc:

```java
mockMvc.perform(post("/cases/C-100/submit-for-review")
        .with(user("alice"))
        .contentType(MediaType.APPLICATION_JSON)
        .content("{\"comment\":\"ready\"}"))
    .andExpect(status().isForbidden());

mockMvc.perform(post("/cases/C-100/submit-for-review")
        .with(user("alice"))
        .with(csrf())
        .contentType(MediaType.APPLICATION_JSON)
        .content("{\"comment\":\"ready\"}"))
    .andExpect(status().isOk());
```

### 25.3 Browser/E2E Tests

Use Playwright/Cypress/Selenium to verify:

- cookie attributes in browser,
- cross-site behavior,
- CORS credentials,
- CSRF header injection,
- logout clears cookie,
- session expiry UX,
- multi-tab behavior,
- back button after logout does not expose cached sensitive page.

### 25.4 Security Tests

Try:

- cross-site form POST,
- missing Origin,
- spoofed Origin,
- invalid CSRF token,
- reused CSRF token across sessions,
- duplicated cookie names,
- oversized Cookie header,
- subdomain cookie injection scenario,
- GET mutation scan,
- CORS origin reflection.

---

## 26. Observability

Track metrics:

- login success/failure,
- logout count,
- active sessions,
- session creation rate,
- session expiry count,
- forced logout count,
- CSRF validation failures,
- invalid/expired session usage,
- cookie/header too large,
- step-up challenges,
- suspicious origin failures.

Logs should include:

- correlation id,
- user id if authenticated,
- session id hash, not raw session id,
- tenant id,
- event type,
- remote IP after trusted proxy resolution,
- user agent hash/summary,
- reason code.

Never log raw:

- session cookie,
- CSRF token,
- bearer token,
- password,
- full `Cookie` header.

Example audit event:

```json
{
  "eventType": "CSRF_VALIDATION_FAILED",
  "timestamp": "2026-06-19T03:12:34Z",
  "userId": "u-123",
  "sessionHash": "sha256:...",
  "tenantId": "agency-01",
  "method": "POST",
  "path": "/cases/C-100/submit-for-review",
  "origin": "https://evil.example.net",
  "correlationId": "req-abc",
  "decision": "DENY"
}
```

---

## 27. Failure Mode Analysis

| Failure | Cause | Impact | Defense |
|---|---|---|---|
| CSRF mutation succeeds | no token validation | unauthorized action via victim browser | CSRF token + SameSite + Origin check |
| Session stolen via XSS | cookie not HttpOnly or token in localStorage | account takeover | HttpOnly + XSS prevention + CSP |
| Session persists after logout | only cookie cleared | stolen old cookie works | server-side revoke |
| User remains logged in forever | sliding expiry only | long exposure window | absolute timeout |
| Cookie sent to subdomain | broad Domain | subdomain compromise impact | host-only cookie + `__Host-` |
| Cookie sent over HTTP | no Secure | network theft | Secure + HSTS |
| JWT cookie too large | many claims | 431/header bloat | opaque session id |
| CSRF token reuse across sessions | token not bound | token injection/replay | bind token to session |
| Sensitive page cached | missing no-store | data leak after logout/shared device | `Cache-Control: no-store` |
| Cross-site cookie exposed | SameSite=None careless | larger CSRF surface | strict CORS + CSRF + Origin |

---

## 28. Design Decision Framework

When designing browser-authenticated backend, answer these in order:

### 28.1 Client Type

```text
Is the client a browser?
```

If no, CSRF usually irrelevant. Use bearer/mTLS/API auth.

If yes:

```text
Will credentials be sent automatically by browser?
```

If yes, CSRF matters.

### 28.2 Deployment Relationship

```text
Frontend and backend same site?
Same origin?
Cross origin but same site?
Cross site?
Embedded iframe?
```

This drives SameSite and CORS.

### 28.3 Credential Form

```text
Server-side session cookie?
JWT in cookie?
Bearer token in JS memory?
Bearer token in localStorage?
```

This drives CSRF vs token theft trade-off.

### 28.4 Sensitivity

```text
What can user do with this session?
```

For high-risk systems:

- server-side revocation,
- shorter expiry,
- step-up auth,
- strong audit,
- no-store,
- strict cookie scoping.

### 28.5 Operational Model

```text
Single app? Multi-node? Multiple subdomains? Gateway? Service mesh?
```

This drives session store, proxy headers, cookie domain, and TLS behavior.

---

## 29. Practical Backend Architecture Patterns

### Pattern A — Classic Server-Rendered App

```text
Browser -> Spring MVC app -> server-side session store
```

Use:

- session cookie HttpOnly Secure SameSite=Lax,
- synchronizer token,
- server-rendered hidden CSRF field,
- session fixation protection,
- no-store sensitive pages.

Best for:

- internal tools,
- admin apps,
- case management UIs,
- simpler deployment.

### Pattern B — Same-Site SPA + API

```text
https://app.example.com -> https://api.example.com
```

Depending site calculation, may be same-site but cross-origin.

Use:

- HttpOnly session cookie,
- CSRF token endpoint or XSRF cookie,
- CORS allowlist if cross-origin,
- `credentials: include`,
- SameSite=Lax often works if same-site,
- no wildcard CORS.

Best for:

- modern SPA with first-party backend.

### Pattern C — Cross-Site SPA + API

```text
https://frontend.vendor.com -> https://api.company.com
```

Use cookie only if required.

If cookie required:

- SameSite=None; Secure,
- strict CORS allowlist,
- CSRF token/header,
- Origin validation,
- tighter expiry,
- audit.

Often better:

- OAuth/OIDC Authorization Code with PKCE,
- backend-for-frontend,
- token exchange strategy,
- avoid third-party cookie dependency where possible.

### Pattern D — Backend-for-Frontend

```text
Browser -> BFF -> internal APIs
```

BFF owns browser session. Internal APIs use service auth.

Use:

- BFF session cookie,
- CSRF at BFF,
- BFF calls internal services with service credentials/user context,
- internal services still enforce authorization where needed.

Best for:

- complex SPA,
- microservices,
- reducing token exposure to browser,
- centralizing browser security.

---

## 30. Mini Implementation Sketch: Spring Boot Session + CSRF-Aware API

### 30.1 Login Response

```java
@PostMapping("/login")
public ResponseEntity<Void> login(@Valid @RequestBody LoginRequest request,
                                  HttpServletRequest httpRequest) {
    AuthenticationResult result = authService.authenticate(request.username(), request.password());

    httpRequest.changeSessionId(); // session fixation defense if session exists

    sessionService.bindAuthenticatedUser(
        httpRequest.getSession(true).getId(),
        result.userId(),
        result.tenantIds(),
        result.authStrength()
    );

    return ResponseEntity.noContent()
        .cacheControl(CacheControl.noStore())
        .build();
}
```

In real Spring Security, authentication/session handling is usually delegated to filters/providers, but the mental model remains useful.

### 30.2 Unsafe Operation

```java
@PostMapping("/cases/{caseId}/submit-for-review")
public ResponseEntity<CaseRepresentation> submitForReview(
        @PathVariable String caseId,
        @Valid @RequestBody SubmitForReviewRequest request,
        Principal principal) {

    CaseRepresentation result = caseWorkflow.submitForReview(
        principal.getName(),
        caseId,
        request.comment()
    );

    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(result);
}
```

CSRF validation should happen before controller in security filter chain. Controller should focus on domain operation, but must still enforce authorization and state invariants in service layer.

### 30.3 Logout

```java
@PostMapping("/logout")
public ResponseEntity<Void> logout(HttpServletRequest request, HttpServletResponse response) {
    HttpSession session = request.getSession(false);
    if (session != null) {
        session.invalidate();
    }

    ResponseCookie expired = ResponseCookie.from("__Host-session", "")
        .path("/")
        .secure(true)
        .httpOnly(true)
        .sameSite("Lax")
        .maxAge(0)
        .build();

    response.addHeader(HttpHeaders.SET_COOKIE, expired.toString());

    return ResponseEntity.noContent()
        .cacheControl(CacheControl.noStore())
        .build();
}
```

Actual cookie name may be controlled by container/Spring Session. The point is: invalidate server state and expire browser cookie.

---

## 31. Common Interview/Design Questions

### Q1: Does `HttpOnly` prevent CSRF?

No. `HttpOnly` prevents JavaScript from reading the cookie. Browser still sends cookie automatically. CSRF is about automatic credential sending.

### Q2: Does `SameSite=Lax` mean no CSRF token needed?

Not universally. It reduces many CSRF cases, but for high-risk state-changing operations, CSRF token remains best practice, especially when compatibility, cross-site flows, or unusual browser behavior matter.

### Q3: If I use JWT, do I need CSRF?

Depends where JWT is stored and how sent. JWT in `Authorization` header from non-automatic JS storage has lower CSRF risk but higher XSS theft risk. JWT in cookie is automatically sent, so CSRF applies.

### Q4: Should session be stateless?

For browser high-security apps, server-side session is often simpler and safer operationally because revocation and session lifecycle are explicit. Stateless token can be useful, but it shifts complexity to token lifetime, revocation, and key management.

### Q5: Is CORS security?

CORS is browser-enforced cross-origin access control. It is not authentication or authorization. Non-browser clients can ignore it.

### Q6: Why use POST for logout?

Logout changes server/client authentication state. GET should be safe and should not trigger mutation. GET logout can be triggered by links, images, crawlers, prefetchers, and CSRF-like contexts.

---

## 32. Exercises

### Exercise 1 — Cookie Attribute Review

Given:

```http
Set-Cookie: SESSION=abc123; Domain=example.com; Path=/; SameSite=None
```

Identify issues and propose a safer version.

Expected considerations:

- missing Secure,
- missing HttpOnly,
- broad Domain,
- SameSite=None needs justification,
- value should be high entropy opaque,
- consider `__Host-` prefix.

Safer same-site version:

```http
Set-Cookie: __Host-session=<opaque>; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=1800
```

### Exercise 2 — CSRF Threat Model

You have:

```http
POST /cases/C-100/approve
Cookie: SESSION=sid_x
Content-Type: application/json
```

Questions:

1. Is this endpoint CSRF-sensitive?
2. What defenses should exist?
3. What status should be returned if CSRF token missing?
4. What should be logged?

Expected answer:

- yes, if browser cookie auth is used,
- require CSRF token/header bound to session,
- SameSite=Lax/Strict where possible,
- strict CORS if cross-origin,
- return 403 Problem Details,
- log event without raw tokens.

### Exercise 3 — Session Lifecycle

Design session policy for internal regulatory admin system:

- idle timeout,
- absolute timeout,
- step-up auth,
- forced logout triggers,
- audit events,
- cookie attributes.

Suggested baseline:

```text
idle timeout: 30 minutes
absolute timeout: 8-12 hours
step-up: required for delete evidence, approve decision, change roles
forced logout: password change, role revoke, account disable, suspected compromise
cookie: __Host-admin-session; Secure; HttpOnly; SameSite=Strict or Lax based UX; Path=/
audit: login, logout, timeout, revoke, step-up, CSRF fail, high-risk action
```

### Exercise 4 — Architecture Choice

Compare these options for a same-site SPA:

1. JWT in localStorage.
2. JWT in HttpOnly cookie.
3. Server-side session cookie.
4. BFF session cookie.

Evaluate:

- XSS token theft,
- CSRF,
- revocation,
- complexity,
- compatibility,
- observability.

---

## 33. Summary

Cookie/session/CSRF is not a frontend-only topic. It is a backend contract with the browser.

Key takeaways:

1. Cookie is HTTP state mechanism, not generic storage.
2. Cookie credentials are sent automatically by browser.
3. Automatic credential sending creates CSRF threat model.
4. `HttpOnly` protects against JavaScript cookie theft, not CSRF.
5. `Secure` is mandatory for session/auth cookies in production.
6. `SameSite` reduces CSRF surface but does not replace full design.
7. Server-side session enables revocation and lifecycle control.
8. Session id must rotate after login to prevent session fixation.
9. Logout must revoke server-side session, not only clear browser cookie.
10. CSRF token should be bound to session or signed with session-specific data.
11. CORS is not authentication.
12. Sensitive authenticated responses should use `Cache-Control: no-store`.
13. Browser-coupled backend must be tested in real browser conditions.
14. For high-security workflows, session, CSRF, authorization, state machine, and audit must work together.

A top-tier backend engineer does not ask only:

> “Where do I store the token?”

They ask:

> “Who sends the credential, under what browser rules, across which site boundary, with what revocation model, against what threat, and with what auditability?”

---

## 34. References

- RFC 6265 — HTTP State Management Mechanism.
- IETF HTTPbis draft rfc6265bis — Cookies: HTTP State Management Mechanism.
- OWASP Cross-Site Request Forgery Prevention Cheat Sheet.
- OWASP Session Management Cheat Sheet.
- OWASP HTML5 Security Cheat Sheet.
- OWASP API Security Top 10.
- Spring Security Reference — CSRF protection.
- Spring Security Reference — Session Management.
- Spring Boot Reference — server/session/cookie configuration.
- MDN Web Docs — `Set-Cookie`, `Cookie`, `SameSite`, CORS credentials.

---

## 35. Status Seri

Kita sudah menyelesaikan:

- Part 000 — Orientation: HTTP Backend Mental Model
- Part 001 — HTTP Semantics from Server Point of View
- Part 002 — Request Lifecycle: From Socket to Controller
- Part 003 — Methods Deep Dive for Backend Correctness
- Part 004 — Status Codes as Backend State Contracts
- Part 005 — Headers as Backend Control Plane
- Part 006 — Request Body, Response Body, and Message Framing
- Part 007 — URI, Routing, and Resource Modeling
- Part 008 — Content Negotiation and Representation Design
- Part 009 — Validation, Parsing, and Defensive Boundaries
- Part 010 — Error Response Design and Problem Details
- Part 011 — Idempotency, Retries, and Exactly-Once Illusions
- Part 012 — Conditional Requests and Optimistic Concurrency
- Part 013 — Caching for Backend Engineers
- Part 014 — Authentication over HTTP
- Part 015 — Authorization and Resource-Level Security
- Part 016 — Cookies, Sessions, CSRF, and Browser-Coupled Backend

Seri belum selesai. Berikutnya:

**Part 017 — CORS from Backend Enforcement Perspective**



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-http-for-web-backend-perspective-part-015.md">⬅️ Part 015 — Authorization and Resource-Level Security</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-http-for-web-backend-perspective-part-017.md">Part 017 — CORS from Backend Enforcement Perspective ➡️</a>
</div>
