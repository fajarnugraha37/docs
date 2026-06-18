# Part 26 — CSRF, CORS, Clickjacking, and Browser Security Around Authentication

> Seri: `learn-java-jakarta-security-authentication-authorization-identity`  
> File: `learn-java-jakarta-security-authentication-authorization-identity-part-26-browser-security-csrf-cors-clickjacking.md`  
> Scope: Java 8–25, Java EE / Jakarta EE, Servlet, Jakarta Security, Jakarta REST/JAX-RS, browser-based authentication, SPA/BFF, session cookie, token-based browser apps.

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas API gateway dan reverse proxy sebagai boundary di depan aplikasi Jakarta. Sekarang kita masuk ke boundary lain yang sering lebih berbahaya: **browser**.

Browser bukan sekadar HTTP client. Browser memiliki aturan keamanan sendiri:

- cookie otomatis dikirim ke origin tertentu,
- JavaScript dibatasi oleh Same-Origin Policy,
- CORS mengatur apakah JavaScript boleh membaca response cross-origin,
- form HTML bisa mengirim request lintas origin tanpa CORS preflight,
- iframe bisa memuat halaman aplikasi,
- redirect bisa membawa user melewati IdP / callback flow,
- session cookie bisa ikut terkirim walau request dimulai dari situs attacker,
- token di JavaScript bisa dicuri oleh XSS,
- UI bisa dimanipulasi oleh clickjacking.

Kesalahan umum engineer backend adalah berpikir:

> “Endpoint saya sudah pakai authentication, berarti aman.”

Untuk browser-based system, itu belum cukup. Authentication hanya menjawab **siapa caller-nya**. Browser attack sering mengeksploitasi fakta bahwa browser bisa membuat request authenticated **tanpa niat sadar user** atau bisa membuat user melakukan tindakan melalui UI yang ditipu.

Bagian ini bertujuan membangun mental model yang benar agar kamu bisa mendesain Jakarta backend yang aman untuk:

- aplikasi server-rendered,
- SPA + Jakarta API,
- BFF pattern,
- OIDC login,
- session cookie,
- token-based API,
- cross-origin frontend/backend,
- enterprise SSO,
- app switcher,
- multi-domain deployment,
- iframe/embed scenario,
- regulatory/case-management workflow.

---

## 1. Big Picture: Browser Security Is About Ambient Authority

Konsep paling penting: **ambient authority**.

Ambient authority berarti browser otomatis membawa authority tertentu tanpa aplikasi JavaScript harus secara eksplisit menambahkannya.

Contoh paling jelas:

```http
Cookie: JSESSIONID=abc123
```

Jika user sudah login ke `https://case.example.gov`, browser akan mengirim session cookie ke domain tersebut ketika request dibuat ke domain itu.

Request itu bisa berasal dari:

1. user klik tombol di aplikasi asli,
2. JavaScript aplikasi asli,
3. form tersembunyi di situs attacker,
4. image tag,
5. iframe,
6. redirect,
7. auto-submitted form.

Backend hanya melihat request dengan cookie valid. Backend tidak otomatis tahu apakah request itu berasal dari UI resmi, niat user, atau situs attacker.

Inilah basis CSRF.

---

## 2. Same-Origin Policy: Fondasi yang Sering Disalahpahami

Browser menerapkan **Same-Origin Policy** untuk membatasi JavaScript dari origin A membaca data dari origin B.

Origin terdiri dari:

```text
scheme + host + port
```

Contoh:

| URL | Origin |
|---|---|
| `https://app.example.gov` | `https://app.example.gov:443` |
| `https://api.example.gov` | `https://api.example.gov:443` |
| `http://app.example.gov` | `http://app.example.gov:80` |
| `https://app.example.gov:8443` | `https://app.example.gov:8443` |

Maka ini berbeda origin:

```text
https://app.example.gov
https://api.example.gov
```

Walaupun domain induknya sama, subdomain berbeda tetap berbeda origin.

### 2.1 Same-Origin Policy Tidak Mencegah Semua Cross-Origin Request

SOP terutama membatasi **membaca response** oleh JavaScript.

Namun browser tetap bisa mengirim banyak jenis request cross-origin:

```html
<img src="https://bank.example.gov/transfer?...">
<script src="https://cdn.example.com/app.js"></script>
<link rel="stylesheet" href="https://cdn.example.com/style.css">
<form method="POST" action="https://bank.example.gov/transfer">
```

Artinya:

- situs attacker mungkin tidak bisa membaca response,
- tetapi masih bisa membuat browser user mengirim request,
- cookie user bisa ikut terkirim,
- state-changing operation bisa terjadi.

Jadi:

```text
Same-Origin Policy ≠ CSRF protection
CORS ≠ CSRF protection
Authentication ≠ Intent verification
```

---

## 3. Threat Model Browser-Based Jakarta Application

Misalkan aplikasi Jakarta:

```text
Browser SPA
  ↓ HTTPS
Reverse proxy / gateway
  ↓
Jakarta Servlet / JAX-RS API
  ↓
Database / workflow engine
```

Authentication menggunakan session cookie:

```http
Set-Cookie: JSESSIONID=...; Secure; HttpOnly; SameSite=Lax
```

Threat actor bisa:

1. membuat website attacker,
2. membuat email phishing berisi link,
3. menanam auto-submit form,
4. mencoba CORS misconfiguration,
5. membuat iframe overlay,
6. mengeksploitasi open redirect,
7. memanfaatkan login/logout flow,
8. mengeksploitasi callback OIDC,
9. mencuri token jika XSS ada,
10. membuat user melakukan action melalui clickjacking.

Backend harus membedakan:

```text
authenticated request
vs
user-intended request
vs
authorized domain action
```

Ketiganya berbeda.

---

## 4. CSRF: Cross-Site Request Forgery

CSRF terjadi ketika attacker membuat browser korban mengirim request authenticated ke aplikasi target, memanfaatkan cookie/session yang otomatis dikirim browser.

### 4.1 Contoh Sederhana

User sudah login ke aplikasi internal:

```text
https://case.example.gov
```

Attacker membuat halaman:

```html
<form id="f" method="POST" action="https://case.example.gov/api/cases/123/approve">
  <input type="hidden" name="comment" value="approved">
</form>
<script>
  document.getElementById('f').submit();
</script>
```

Jika endpoint menerima POST berbasis cookie tanpa CSRF protection, browser bisa mengirim:

```http
POST /api/cases/123/approve HTTP/1.1
Host: case.example.gov
Cookie: JSESSIONID=victim-session
Content-Type: application/x-www-form-urlencoded

comment=approved
```

Backend melihat user valid dan mungkin menjalankan approval.

### 4.2 CSRF Bukan Tentang Mencuri Data

CSRF biasanya tidak perlu membaca response. Attacker hanya perlu membuat state berubah.

Target umum:

- update profile,
- change email,
- change password jika tidak butuh old password,
- create transaction,
- approve case,
- assign officer,
- upload setting,
- logout user,
- link account,
- change notification endpoint,
- add API key,
- add delegated user,
- approve regulatory decision.

### 4.3 CSRF Sangat Relevan untuk Session Cookie

Jika aplikasi memakai cookie untuk authentication, CSRF harus dipikirkan.

Jika API memakai bearer token di `Authorization` header dan token tidak otomatis dikirim browser, CSRF risk lebih kecil untuk API call tersebut. Tapi token-in-browser membuka risiko lain: XSS token theft.

Jadi pilihan bukan:

```text
cookie buruk, token baik
```

Pilihan sebenarnya:

```text
cookie: CSRF harus ditangani, token tidak terekspos JS jika HttpOnly
bearer token di JS: CSRF lebih kecil, XSS impact lebih besar
BFF: cookie HttpOnly + CSRF protection + backend token handling
```

---

## 5. CSRF Defense Layers

CSRF defense yang matang biasanya layered:

```text
1. Jangan gunakan GET untuk state-changing operation
2. CSRF token
3. SameSite cookie
4. Origin/Referer validation
5. Custom header untuk API
6. Fetch Metadata headers
7. Reauthentication / user interaction untuk high-risk action
8. Idempotency and workflow validation
9. Audit and anomaly detection
```

Tidak semua layer wajib untuk semua endpoint, tetapi endpoint high-risk sebaiknya memakai beberapa layer.

---

## 6. Rule 1: GET Harus Safe

HTTP GET harus dianggap safe/read-only.

Jangan desain endpoint seperti:

```http
GET /api/cases/123/approve
GET /api/users/456/delete
GET /logout-all-sessions
```

Kenapa?

Karena browser, proxy, crawler, prefetcher, link scanner, image tag, dan attacker bisa memicu GET.

Desain yang benar:

```http
POST /api/cases/123/approve
DELETE /api/users/456
POST /api/sessions/logout-all
```

Tetapi POST saja tidak cukup. Form attacker juga bisa POST.

---

## 7. CSRF Token Pattern

CSRF token adalah secret unpredictable yang harus dikirim bersama state-changing request dan diverifikasi server.

### 7.1 Synchronizer Token Pattern

Server menyimpan token di session:

```text
HttpSession
  csrfToken = random-256-bit-value
```

Server render token ke page atau endpoint bootstrap:

```html
<meta name="csrf-token" content="A_LONG_RANDOM_TOKEN">
```

Client mengirim token:

```http
POST /api/cases/123/approve
X-CSRF-Token: A_LONG_RANDOM_TOKEN
Cookie: JSESSIONID=...
```

Server memvalidasi:

```text
request token == session token
```

Jika tidak match:

```http
403 Forbidden
```

### 7.2 Double Submit Cookie Pattern

Server mengirim cookie CSRF non-HttpOnly:

```http
Set-Cookie: XSRF-TOKEN=random; Secure; SameSite=Lax
```

JavaScript membaca cookie itu dan mengirim header:

```http
X-CSRF-Token: random
```

Server membandingkan cookie dan header.

Versi lebih kuat memakai signed double-submit token:

```text
csrf_token = base64(nonce + HMAC(server_secret, session_id + nonce))
```

Tujuannya mencegah attacker menanam cookie palsu di subdomain tertentu.

### 7.3 Token Per Session vs Per Request

| Model | Kelebihan | Kekurangan |
|---|---|---|
| Per session | sederhana, cocok SPA | token lebih lama hidup |
| Per request | lebih kuat terhadap replay | rumit dengan tab/back/retry |
| Per action | cocok high-risk action | implementasi lebih kompleks |

Untuk enterprise workflow, kombinasi umum:

```text
normal mutation: session-level CSRF token
high-risk action: fresh confirmation token / step-up / user interaction
```

---

## 8. Jakarta Servlet CSRF Filter Model

Jakarta Security tidak secara otomatis memberi CSRF protection universal seperti beberapa framework lain. Di Jakarta Servlet/JAX-RS, kamu sering membuat filter/interceptor sendiri atau memakai framework pendukung.

Contoh konsep filter:

```java
import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.annotation.WebFilter;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;

import java.io.IOException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.Set;

@WebFilter("/api/*")
public class CsrfFilter implements Filter {

    private static final Set<String> SAFE_METHODS = Set.of("GET", "HEAD", "OPTIONS", "TRACE");
    private static final String SESSION_ATTR = "CSRF_TOKEN";
    private static final String HEADER = "X-CSRF-Token";
    private final SecureRandom random = new SecureRandom();

    @Override
    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
            throws IOException, ServletException {

        HttpServletRequest request = (HttpServletRequest) req;
        HttpServletResponse response = (HttpServletResponse) res;

        HttpSession session = request.getSession(false);

        if (session != null && session.getAttribute(SESSION_ATTR) == null) {
            session.setAttribute(SESSION_ATTR, newToken());
        }

        if (SAFE_METHODS.contains(request.getMethod())) {
            chain.doFilter(req, res);
            return;
        }

        if (session == null) {
            response.sendError(HttpServletResponse.SC_FORBIDDEN, "Missing session");
            return;
        }

        String expected = (String) session.getAttribute(SESSION_ATTR);
        String actual = request.getHeader(HEADER);

        if (expected == null || actual == null || !constantTimeEquals(expected, actual)) {
            response.sendError(HttpServletResponse.SC_FORBIDDEN, "Invalid CSRF token");
            return;
        }

        chain.doFilter(req, res);
    }

    private String newToken() {
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private boolean constantTimeEquals(String a, String b) {
        byte[] x = a.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        byte[] y = b.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        return java.security.MessageDigest.isEqual(x, y);
    }
}
```

Catatan desain:

1. Jangan generate token dengan `Random`.
2. Jangan log token.
3. Jangan kirim token lewat URL.
4. Jangan validasi CSRF hanya untuk endpoint UI tetapi lupa API mutation.
5. Jangan exclude endpoint penting karena “dipanggil AJAX”.
6. OPTIONS/preflight biasanya tidak mengubah state.
7. Login, logout, account-linking, callback flow perlu dipikirkan khusus.

---

## 9. CSRF Token Bootstrap untuk SPA

Untuk SPA + Jakarta backend, pola umum:

```http
GET /api/session/bootstrap
```

Response:

```json
{
  "authenticated": true,
  "principal": "fajar",
  "roles": ["CASE_OFFICER"],
  "csrfToken": "..."
}
```

Kemudian mutation:

```http
POST /api/cases/123/assign
X-CSRF-Token: ...
Cookie: JSESSIONID=...
Content-Type: application/json
```

Backend:

```text
validate session
validate CSRF
validate authorization
validate domain state
execute transaction
write audit
```

Urutan penting:

```text
authentication before CSRF? usually yes, because token tied to session
CSRF before expensive domain logic
authorization after authenticated identity established
business invariant inside transaction
```

---

## 10. SameSite Cookie

`SameSite` mengontrol kapan browser mengirim cookie dalam cross-site context.

Mode umum:

| SameSite | Efek |
|---|---|
| `Strict` | cookie tidak dikirim pada cross-site navigation; paling ketat, bisa mengganggu SSO/linking |
| `Lax` | cookie dikirim pada top-level safe navigation tertentu; umum untuk session modern |
| `None` | cookie dikirim cross-site; wajib `Secure` di browser modern |

### 10.1 SameSite Membantu, Tapi Bukan Pengganti CSRF Token

SameSite bisa mengurangi banyak CSRF klasik, tetapi tidak selalu cukup:

- browser compatibility lama,
- cross-site top-level navigation behavior,
- SSO/OIDC flow butuh cookie pada redirect tertentu,
- subdomain/same-site nuance,
- user interaction flow kompleks,
- embedded apps/iframe mungkin perlu `None`,
- beberapa attack bisa memanfaatkan same-site sibling domain jika domain boundary buruk.

Prinsip kuat:

```text
SameSite is defense-in-depth, not your only CSRF control.
```

### 10.2 Site vs Origin

SameSite memakai konsep “site” yang tidak identik dengan origin.

Contoh:

```text
https://app.example.gov
https://api.example.gov
```

Berbeda origin, tetapi bisa dianggap same-site jika registrable domain sama.

Ini penting karena:

```text
CORS bekerja pada origin
SameSite bekerja pada site
```

Jangan menyamakan keduanya.

### 10.3 Setting Cookie di Servlet

Untuk Jakarta Servlet modern, `Cookie` memiliki atribut yang bisa dipakai container/API tertentu, tetapi dukungan SameSite historically berbeda antar container/version. Banyak deployment masih mengatur SameSite lewat:

- container config,
- reverse proxy,
- response header filter,
- application server feature,
- framework security config.

Contoh header eksplisit:

```http
Set-Cookie: JSESSIONID=abc; Path=/; Secure; HttpOnly; SameSite=Lax
```

Untuk cookie security baseline:

```text
JSESSIONID:
  Secure = true
  HttpOnly = true
  SameSite = Lax or Strict if possible
  Path = narrow enough
  Domain = avoid broad domain unless required
```

---

## 11. Origin and Referer Validation

Browser biasanya mengirim header:

```http
Origin: https://app.example.gov
```

atau:

```http
Referer: https://app.example.gov/cases/123
```

Server bisa memvalidasi state-changing request:

```text
Origin must be allowed application origin
```

Contoh:

```java
private boolean isAllowedOrigin(HttpServletRequest request) {
    String origin = request.getHeader("Origin");
    if (origin == null) {
        return false; // or fallback to Referer for legacy scenarios
    }
    return origin.equals("https://app.example.gov");
}
```

Kelebihan:

- simple,
- bagus sebagai defense tambahan,
- efektif untuk banyak CSRF cross-site.

Kekurangan:

- beberapa request legacy mungkin tidak punya `Origin`,
- `Referer` bisa hilang karena privacy policy/referrer-policy,
- harus hati-hati dengan allowed origins,
- tidak boleh pakai suffix matching naïf.

Jangan validasi seperti ini:

```java
origin.endsWith("example.gov")
```

Karena bisa lolos:

```text
https://evil-example.gov
https://example.gov.attacker.com
```

Gunakan exact origin allowlist:

```text
https://app.example.gov
https://admin.example.gov
```

---

## 12. Fetch Metadata Headers

Browser modern dapat mengirim header seperti:

```http
Sec-Fetch-Site: same-origin
Sec-Fetch-Mode: cors
Sec-Fetch-Dest: empty
```

`Sec-Fetch-Site` bisa bernilai:

- `same-origin`,
- `same-site`,
- `cross-site`,
- `none`.

Policy sederhana:

```text
For state-changing endpoints:
  reject Sec-Fetch-Site: cross-site
```

Contoh filter konseptual:

```java
String site = request.getHeader("Sec-Fetch-Site");
boolean unsafe = !SAFE_METHODS.contains(request.getMethod());

if (unsafe && "cross-site".equals(site)) {
    response.sendError(403, "Cross-site request rejected");
    return;
}
```

Namun jangan jadikan ini satu-satunya kontrol. Anggap sebagai tambahan bersama CSRF token dan SameSite.

---

## 13. Login CSRF

CSRF bukan hanya setelah login. Login flow juga bisa diserang.

Login CSRF terjadi ketika attacker membuat korban login ke aplikasi target sebagai akun attacker.

Dampaknya:

- korban mengisi data sensitif ke akun attacker,
- korban melakukan action yang tercatat sebagai attacker,
- account linking kacau,
- audit trail misleading,
- user confusion.

Mitigasi:

1. CSRF protection pada login form.
2. Regenerate session setelah login.
3. OIDC `state` dan `nonce` harus benar.
4. Jangan auto-link account tanpa verifikasi kuat.
5. Tampilkan identity setelah login.
6. Audit login source.

---

## 14. Logout CSRF

Logout CSRF membuat user keluar dari aplikasi tanpa niat.

Dampaknya biasanya lebih rendah daripada approve/delete, tetapi bisa:

- mengganggu workflow,
- memaksa user login ulang,
- memicu reauth phishing,
- merusak SSO state.

Logout sebaiknya:

```text
POST /logout
with CSRF token
```

Bukan:

```text
GET /logout
```

Namun OIDC front-channel logout sering memakai iframe/redirect dari IdP. Ini kasus khusus dan harus dipisahkan dari user-initiated local logout.

---

## 15. CORS: Cross-Origin Resource Sharing

CORS adalah mekanisme browser yang memberi server cara menyatakan origin mana yang boleh membaca response cross-origin.

CORS bukan mekanisme authentication. CORS juga bukan mekanisme authorization bisnis.

CORS menjawab:

```text
May JavaScript from origin X read this response?
```

Bukan:

```text
Is user allowed to approve this case?
```

### 15.1 Simple Request vs Preflight

Beberapa request cross-origin dianggap simple, misalnya:

```text
GET
POST with application/x-www-form-urlencoded, multipart/form-data, text/plain
certain simple headers
```

Request yang tidak simple akan memicu preflight:

```http
OPTIONS /api/cases/123/approve
Origin: https://app.example.gov
Access-Control-Request-Method: POST
Access-Control-Request-Headers: content-type,x-csrf-token
```

Server merespons:

```http
Access-Control-Allow-Origin: https://app.example.gov
Access-Control-Allow-Methods: POST
Access-Control-Allow-Headers: content-type,x-csrf-token
Access-Control-Allow-Credentials: true
```

Setelah itu browser mengirim request sebenarnya.

### 15.2 Credentialed CORS

Jika frontend dan backend berbeda origin, dan backend memakai cookie session, frontend perlu:

```javascript
fetch("https://api.example.gov/api/cases", {
  credentials: "include"
})
```

Backend perlu mengirim:

```http
Access-Control-Allow-Origin: https://app.example.gov
Access-Control-Allow-Credentials: true
```

Tidak boleh:

```http
Access-Control-Allow-Origin: *
Access-Control-Allow-Credentials: true
```

Wildcard origin dengan credential adalah konfigurasi berbahaya dan browser modern juga membatasi kombinasi ini.

### 15.3 Dynamic Origin Reflection Anti-Pattern

Anti-pattern:

```java
response.setHeader("Access-Control-Allow-Origin", request.getHeader("Origin"));
response.setHeader("Access-Control-Allow-Credentials", "true");
```

Ini berarti semua origin dipercaya.

Yang benar:

```java
private static final Set<String> ALLOWED_ORIGINS = Set.of(
    "https://app.example.gov",
    "https://admin.example.gov"
);

String origin = request.getHeader("Origin");
if (ALLOWED_ORIGINS.contains(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    response.setHeader("Access-Control-Allow-Credentials", "true");
}
```

Tambahkan:

```http
Vary: Origin
```

Agar cache/proxy tidak salah menyajikan response CORS antar origin.

---

## 16. CORS Filter untuk Jakarta Servlet

Contoh filter minimal:

```java
import jakarta.servlet.*;
import jakarta.servlet.annotation.WebFilter;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import java.io.IOException;
import java.util.Set;

@WebFilter("/api/*")
public class CorsFilter implements Filter {

    private static final Set<String> ALLOWED_ORIGINS = Set.of(
            "https://app.example.gov",
            "https://admin.example.gov"
    );

    @Override
    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
            throws IOException, ServletException {

        HttpServletRequest request = (HttpServletRequest) req;
        HttpServletResponse response = (HttpServletResponse) res;

        String origin = request.getHeader("Origin");

        if (origin != null && ALLOWED_ORIGINS.contains(origin)) {
            response.setHeader("Access-Control-Allow-Origin", origin);
            response.setHeader("Access-Control-Allow-Credentials", "true");
            response.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
            response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-CSRF-Token, X-Request-ID");
            response.setHeader("Access-Control-Max-Age", "600");
            response.addHeader("Vary", "Origin");
            response.addHeader("Vary", "Access-Control-Request-Method");
            response.addHeader("Vary", "Access-Control-Request-Headers");
        }

        if ("OPTIONS".equalsIgnoreCase(request.getMethod())) {
            response.setStatus(HttpServletResponse.SC_NO_CONTENT);
            return;
        }

        chain.doFilter(req, res);
    }
}
```

Design notes:

1. Jangan allow semua origin untuk API credentialed.
2. Jangan allow semua headers tanpa alasan.
3. Jangan allow semua methods.
4. Jangan expose sensitive response headers sembarangan.
5. Jangan menganggap preflight sebagai authorization decision.
6. Preflight tidak boleh mengubah state.
7. Real request tetap harus authenticate + authorize + CSRF-check.

---

## 17. CORS and CSRF: Hubungannya

CORS dan CSRF sering tertukar.

| Aspek | CORS | CSRF |
|---|---|---|
| Masalah | JS cross-origin boleh baca response atau tidak | Browser mengirim authenticated state-changing request tanpa intent |
| Dikontrol oleh | Browser + server CORS headers | Server-side anti-CSRF validation |
| Melindungi data read? | Ya, jika benar | Tidak langsung |
| Melindungi state change? | Tidak cukup | Ya |
| Relevan untuk cookie auth? | Ya, untuk SPA cross-origin | Sangat ya |
| Relevan untuk bearer header token? | Ya | Lebih rendah, karena header tidak ambient |

Rule:

```text
CORS controls who can read.
CSRF controls who can cause state change.
Authorization controls who is allowed.
```

Ketiganya harus ada sesuai konteks.

---

## 18. Clickjacking

Clickjacking terjadi ketika attacker menampilkan aplikasi target di iframe transparan/tersembunyi lalu menipu user mengklik tombol berbahaya.

Contoh:

```html
<style>
iframe {
  opacity: 0.01;
  position: absolute;
  top: 0;
  left: 0;
  width: 1000px;
  height: 800px;
}
.fake-button {
  position: absolute;
  top: 300px;
  left: 400px;
}
</style>

<button class="fake-button">Click to claim reward</button>
<iframe src="https://case.example.gov/cases/123/approve-page"></iframe>
```

User merasa klik tombol harmless, padahal klik tombol approval di iframe.

### 18.1 Defense: CSP frame-ancestors

Header modern:

```http
Content-Security-Policy: frame-ancestors 'self'
```

Atau deny semua framing:

```http
Content-Security-Policy: frame-ancestors 'none'
```

Jika aplikasi harus di-embed oleh trusted portal:

```http
Content-Security-Policy: frame-ancestors 'self' https://portal.example.gov
```

### 18.2 Defense: X-Frame-Options

Legacy header:

```http
X-Frame-Options: DENY
```

atau:

```http
X-Frame-Options: SAMEORIGIN
```

`ALLOW-FROM` tidak portable modern. CSP `frame-ancestors` lebih fleksibel.

Praktik umum:

```http
Content-Security-Policy: frame-ancestors 'self'
X-Frame-Options: SAMEORIGIN
```

Jika tidak perlu iframe:

```http
Content-Security-Policy: frame-ancestors 'none'
X-Frame-Options: DENY
```

---

## 19. Security Headers untuk Browser Authentication Surface

Baseline header:

```http
Content-Security-Policy: frame-ancestors 'self'; object-src 'none'; base-uri 'self'
X-Frame-Options: SAMEORIGIN
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Cache-Control: no-store
```

Untuk sensitive authenticated pages:

```http
Cache-Control: no-store
Pragma: no-cache
```

Untuk HSTS:

```http
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

HSTS harus dipakai hati-hati jika subdomain belum siap HTTPS.

---

## 20. Jakarta Servlet Security Header Filter

Contoh filter:

```java
@WebFilter("/*")
public class SecurityHeadersFilter implements Filter {

    @Override
    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
            throws IOException, ServletException {

        HttpServletResponse response = (HttpServletResponse) res;

        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
        response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
        response.setHeader("Content-Security-Policy", "frame-ancestors 'self'; object-src 'none'; base-uri 'self'");
        response.setHeader("X-Frame-Options", "SAMEORIGIN");

        chain.doFilter(req, res);
    }
}
```

Untuk halaman sangat sensitif:

```java
response.setHeader("Cache-Control", "no-store");
```

Hati-hati: `Cache-Control: no-store` di semua asset bisa merusak performa static assets. Pisahkan policy untuk:

```text
authenticated HTML/API response: no-store
static versioned asset: cache long
```

---

## 21. Redirect Security and Open Redirect

Authentication flow sering memakai redirect:

```text
/login?returnUrl=/cases/123
```

Anti-pattern:

```java
String returnUrl = request.getParameter("returnUrl");
response.sendRedirect(returnUrl);
```

Attacker bisa membuat:

```text
https://case.example.gov/login?returnUrl=https://evil.example/phishing
```

Setelah login, user diarahkan ke phishing site.

Mitigasi:

1. Allow only relative paths.
2. Jika absolute URL perlu, exact origin allowlist.
3. Normalize path.
4. Reject protocol-relative URL seperti `//evil.com`.
5. Reject CRLF/control characters.
6. Jangan redirect ke value dari header tanpa validasi.

Contoh validator:

```java
private String safeReturnPath(String input) {
    if (input == null || input.isBlank()) return "/";
    if (!input.startsWith("/")) return "/";
    if (input.startsWith("//")) return "/";
    if (input.contains("\\")) return "/";
    if (input.contains("\r") || input.contains("\n")) return "/";
    return input;
}
```

---

## 22. OIDC State, Nonce, and Browser Attacks

OIDC login flow sangat bergantung pada browser redirect.

Security parameter penting:

```text
state = CSRF protection for authorization response
nonce = binds ID token to authentication request
PKCE = protects authorization code interception
redirect_uri = exact registered callback
```

Kesalahan umum:

1. `state` tidak divalidasi.
2. `state` reusable.
3. `nonce` tidak dicek.
4. redirect URI wildcard terlalu longgar.
5. callback endpoint menerima method/parameter tidak semestinya.
6. session login tidak diregenerate setelah callback.
7. open redirect setelah callback.
8. account linking otomatis berdasarkan email tanpa assurance.

Flow aman secara konseptual:

```text
GET /login/oidc
  create login transaction in session
  state=random
  nonce=random
  code_verifier=random
  redirect to IdP

GET /callback?code=...&state=...
  validate state from session
  exchange code with PKCE
  validate ID token issuer/audience/exp/nonce/signature
  map issuer+sub to local account
  regenerate session
  establish caller identity
  redirect to safe relative path
```

---

## 23. SPA, BFF, and Token Storage

### 23.1 SPA Direct Token Model

```text
SPA stores access token in browser
SPA calls API with Authorization: Bearer
```

Pros:

- CSRF risk lebih rendah karena token tidak otomatis dikirim,
- scalable API model,
- cocok untuk pure API.

Cons:

- XSS bisa mencuri token jika token disimpan di JS-accessible storage,
- refresh token di browser sangat sensitif,
- token lifecycle complexity tinggi,
- logout/revocation sulit.

### 23.2 Cookie Session Model

```text
Browser stores HttpOnly session cookie
Backend stores session/token server-side
```

Pros:

- token tidak terekspos JavaScript,
- session invalidation lebih mudah,
- cocok enterprise web app.

Cons:

- perlu CSRF protection,
- cookie domain/SameSite harus benar,
- session clustering/timeout harus matang.

### 23.3 BFF Pattern

BFF = Backend For Frontend.

```text
SPA → BFF with HttpOnly cookie
BFF → downstream API with server-side token
```

Keuntungan:

- browser tidak menyimpan access token sensitif,
- CSRF bisa ditangani di BFF,
- downstream token tidak bocor ke frontend,
- authorization/logging bisa centralized.

Trade-off:

- BFF menjadi stateful/security-critical,
- perlu session management,
- perlu scaling strategy,
- perlu clear boundary antara frontend session dan backend token.

Untuk enterprise Jakarta apps, BFF sering menjadi pattern paling defensible.

---

## 24. Browser Security for Case Management Workflow

Dalam sistem case-management, browser attack bukan hanya “submit form palsu”. Dampaknya bisa regulatory.

Contoh action high-risk:

```text
approve enforcement action
close case
assign case to officer
change case priority
grant extension
send correspondence
publish decision
override screening result
change agency/company profile
```

Untuk action seperti ini, layer minimum:

```text
1. Authenticated session
2. CSRF token
3. Origin/Fetch Metadata check
4. Domain authorization
5. State-machine guard
6. Maker-checker/separation-of-duty if required
7. Freshness/step-up for sensitive action
8. Audit with actor, tenant, case state, decision reason
9. Idempotency key for retry-sensitive operation
10. Transactional check at write time
```

Jangan pernah mengandalkan frontend confirmation modal sebagai security control. Modal adalah UX, bukan authorization.

---

## 25. Step-Up Authentication for Browser Actions

Untuk action kritikal, minta bukti fresh authentication.

Contoh:

```text
User logged in 4 hours ago.
User wants to approve high-impact enforcement decision.
System requires step-up within last 5 minutes.
```

Model:

```text
session.authenticatedAt
session.stepUpAt
```

Policy:

```java
boolean freshEnough = session.getStepUpAt().isAfter(now.minusMinutes(5));
```

Jika tidak fresh:

```http
403 with step_up_required
```

atau redirect ke:

```text
/reauth?return=/cases/123/approve
```

Untuk OIDC, bisa memakai prompt/max_age sesuai IdP support.

---

## 26. Cache and Back Button Issues

Setelah logout, user bisa menekan back button dan melihat halaman cached.

Untuk authenticated HTML/API response:

```http
Cache-Control: no-store
```

Untuk SPA, issue lebih kompleks:

- shell app mungkin masih cached,
- API call harus return 401,
- frontend harus clear local state,
- service worker harus tidak cache sensitive API response,
- logout harus invalidate session server-side.

Rule:

```text
Do not treat frontend state clearing as logout.
Logout must invalidate server-side authority.
```

---

## 27. WebSocket and Browser Security

WebSocket juga membawa browser security concern.

Handshake bisa membawa cookie:

```http
GET /ws HTTP/1.1
Upgrade: websocket
Cookie: JSESSIONID=...
Origin: https://app.example.gov
```

Perlu validasi:

1. authenticated session,
2. Origin allowlist,
3. tenant/role authorization,
4. subscription-level authorization,
5. message-level authorization,
6. disconnect on logout/session expiry,
7. no sensitive broadcast across tenant.

CSRF token tidak selalu cocok untuk semua WebSocket message, tetapi handshake perlu origin/session validation dan message action perlu authorization.

---

## 28. Service Worker Risk

Service worker bisa mengintercept request frontend.

Risiko:

- caching sensitive response,
- stale session view,
- serving old app shell after logout,
- scope terlalu luas,
- compromised frontend asset controls network behavior.

Controls:

```text
Cache-Control: no-store for sensitive API
narrow service worker scope
integrity/deployment pipeline protection
clear caches on logout/version upgrade
no token in service worker unless absolutely necessary
```

---

## 29. Testing Matrix

### 29.1 CSRF Tests

Test cases:

| Case | Expected |
|---|---|
| POST without CSRF token | 403 |
| POST with wrong token | 403 |
| POST with old token after logout | 403 |
| POST with token from different session | 403 |
| GET read endpoint without token | 200 if authorized |
| GET state-changing endpoint | should not exist / 405 |
| login without valid state/token | rejected |
| logout GET | rejected or harmless page only |

### 29.2 CORS Tests

| Case | Expected |
|---|---|
| Origin allowed | ACAO exact origin |
| Origin evil | no ACAO / rejected |
| Credentialed request | ACAC true only for allowlisted origin |
| Wildcard with credentials | never |
| Preflight allowed method/header | 204 |
| Preflight disallowed method/header | no allow / 403 |
| Vary Origin present | yes |

### 29.3 Clickjacking Tests

| Case | Expected |
|---|---|
| App loaded in attacker iframe | blocked |
| App loaded in same-origin iframe if allowed | allowed only if policy permits |
| Sensitive page iframe | blocked |
| Trusted portal embed | allowed only exact origin |

### 29.4 Redirect Tests

| Return URL | Expected |
|---|---|
| `/cases/123` | allowed |
| `https://evil.com` | rejected |
| `//evil.com` | rejected |
| `/\\evil` | rejected |
| encoded CRLF | rejected |
| external same-looking domain | rejected |

---

## 30. Observability and Audit

Untuk browser security, log harus membantu investigasi tanpa membocorkan secret.

Log event:

```json
{
  "event": "csrf_rejected",
  "requestId": "...",
  "actor": "user-123 or anonymous",
  "method": "POST",
  "path": "/api/cases/123/approve",
  "origin": "https://evil.example",
  "secFetchSite": "cross-site",
  "ip": "...",
  "userAgentHash": "...",
  "reason": "missing_csrf_token"
}
```

Jangan log:

- CSRF token value,
- session ID,
- bearer token,
- authorization code,
- ID token,
- refresh token,
- full cookie header.

Untuk high-risk operation, audit success dan denial:

```text
who attempted
what action
which resource
which tenant
from which origin
authorization result
csrf result
domain state
reason code
correlation id
```

---

## 31. Common Production Failure Patterns

### 31.1 “Kami Sudah Pakai CORS Jadi Aman dari CSRF”

Salah. CORS bukan CSRF protection.

### 31.2 `Access-Control-Allow-Origin` Reflect Semua Origin

Ini memberi attacker ability membaca response jika credential juga diizinkan.

### 31.3 CSRF Token Ada di UI, Tapi API Mutation Lupa

Sering terjadi saat migrasi server-rendered ke SPA.

### 31.4 SameSite `None` Tanpa Alasan

Biasanya dipakai agar SSO/embed “cepat jalan”, tapi memperbesar CSRF surface.

### 31.5 Logout via GET

Mudah dipicu oleh image/link/iframe.

### 31.6 Open Redirect Setelah Login

Dipakai untuk phishing yang terlihat berasal dari domain resmi.

### 31.7 Clickjacking Header Hanya di Homepage

Sensitive action page masih bisa di-frame.

### 31.8 Token Disimpan di `localStorage`

Tidak otomatis salah untuk semua sistem, tetapi XSS impact menjadi sangat tinggi.

### 31.9 CSRF Token Tidak Di-Rotate Setelah Login

Session fixation/login CSRF risk meningkat.

### 31.10 Preflight Dianggap Authorization

OPTIONS sukses bukan berarti POST boleh secara bisnis.

---

## 32. Design Blueprint: Jakarta SPA + BFF Secure Browser Model

Recommended enterprise pattern:

```text
Browser SPA
  - no access token in localStorage
  - uses HttpOnly Secure SameSite cookie
  - sends X-CSRF-Token on mutations

Jakarta BFF/API
  - authenticates session
  - validates CSRF for unsafe methods
  - validates Origin/Fetch Metadata
  - performs domain authorization
  - calls downstream APIs with server-side token
  - writes audit events

IdP
  - OIDC authorization code + PKCE
  - state/nonce validation
  - logout support
```

Session cookie:

```http
Set-Cookie: JSESSIONID=...; Path=/; Secure; HttpOnly; SameSite=Lax
```

CSRF bootstrap:

```http
GET /api/session
```

Mutation:

```http
POST /api/cases/123/approve
X-CSRF-Token: ...
Origin: https://app.example.gov
Cookie: JSESSIONID=...
```

Backend pipeline:

```text
1. TLS/proxy trust validation
2. CORS if cross-origin
3. Authentication/session validation
4. CSRF validation
5. Origin/Fetch Metadata validation
6. Domain authorization
7. State-machine guard
8. Transactional write
9. Audit
10. Safe response
```

---

## 33. Java 8–25 Considerations

### Java 8

- Banyak legacy apps masih `javax.servlet`.
- SameSite support sering container-specific.
- Manual security filters umum.
- OIDC/SAML integration sering lewat external adapter/proxy.

### Java 11/17

- Common baseline untuk Jakarta EE 9/10 runtimes.
- HTTP client modern tersedia sejak Java 11 untuk backend calls.
- TLS defaults membaik dibanding era lama.

### Java 21+

- Virtual threads mengubah mental model concurrency tetapi tidak menghilangkan kebutuhan context propagation.
- Jangan mengasumsikan security context otomatis ikut ke virtual thread atau async task.
- BFF/session model tetap valid.

### Java 25

- Prinsip browser security tidak berubah karena ini dikendalikan oleh browser/protocol/container lebih dari JDK.
- Yang berubah biasanya container/framework support, TLS provider defaults, dan API compatibility.

### `javax` vs `jakarta`

Legacy:

```java
javax.servlet.Filter
javax.servlet.http.HttpServletRequest
javax.servlet.http.Cookie
```

Jakarta:

```java
jakarta.servlet.Filter
jakarta.servlet.http.HttpServletRequest
jakarta.servlet.http.Cookie
```

Konsep security sama, package dan container baseline berbeda.

---

## 34. Review Checklist

### CSRF

- [ ] Semua state-changing endpoint bukan GET.
- [ ] Unsafe methods memerlukan CSRF token jika cookie/session auth dipakai.
- [ ] Token unpredictable dan tidak dikirim di URL.
- [ ] Token tied to session.
- [ ] Login/account-linking flow dilindungi state/nonce/CSRF.
- [ ] Logout bukan GET sederhana.
- [ ] High-risk action punya step-up/user confirmation server-side.

### CORS

- [ ] Exact origin allowlist.
- [ ] Tidak reflect arbitrary origin.
- [ ] Tidak wildcard untuk credentialed API.
- [ ] `Vary: Origin` ada.
- [ ] Allowed methods/headers minimal.
- [ ] Preflight tidak mengubah state.
- [ ] Real request tetap authenticate/authorize/CSRF-check.

### Cookies

- [ ] `Secure`.
- [ ] `HttpOnly`.
- [ ] `SameSite` dipilih sadar.
- [ ] `Domain` tidak terlalu luas.
- [ ] `Path` tidak terlalu luas jika tidak perlu.
- [ ] Session regenerated after login.
- [ ] Session invalidated on logout.

### Clickjacking

- [ ] `Content-Security-Policy: frame-ancestors ...`.
- [ ] `X-Frame-Options` untuk compatibility.
- [ ] Sensitive action pages tidak bisa di-frame sembarangan.
- [ ] Trusted iframe origin exact allowlist jika embed diperlukan.

### Redirect

- [ ] Return URL relative-only atau exact allowlist.
- [ ] Protocol-relative URL ditolak.
- [ ] CRLF/control char ditolak.
- [ ] OIDC callback tidak membuka redirect liar.

### Audit

- [ ] CSRF rejection logged without token value.
- [ ] CORS/origin rejection observable.
- [ ] Sensitive action denial logged.
- [ ] Request ID/correlation ID konsisten.

---

## 35. Mental Model Akhir

Browser security untuk Jakarta authentication/authorization bisa diringkas seperti ini:

```text
Authentication proves who the browser session represents.
CSRF protection proves the request came through an intended application channel.
CORS controls whether JavaScript from another origin can read the response.
Clickjacking defense controls whether another site can visually embed and trick the user.
Authorization proves the actor may perform the action on that resource in that state.
Audit proves what happened and why it was allowed or denied.
```

Jangan campur keenam hal ini.

Sistem yang matang tidak bertanya hanya:

```text
Is the user logged in?
```

Sistem yang matang bertanya:

```text
Is this authenticated?
Is this request intentional?
Is this origin trusted?
Is this UI embedding allowed?
Is this actor authorized for this resource/action/state/tenant?
Can we prove the decision later?
```

Itulah perbedaan antara aplikasi yang “login-nya jalan” dan sistem enterprise yang defensible.

---

## 36. Referensi Utama

- Jakarta Servlet Specification / API — session cookie, Servlet request/response/filter model, `HttpOnly` support, `Cookie` API.
- Jakarta Security 4.0 — modern Jakarta EE security API: authentication mechanism, identity store, security context.
- OWASP Cross-Site Request Forgery Prevention Cheat Sheet — CSRF token, SameSite, Origin/Referer, defense-in-depth.
- OWASP CORS / Web Security Testing Guide — CORS testing, origin allowlist, credentialed request risks.
- OWASP Clickjacking Defense Cheat Sheet — CSP `frame-ancestors`, `X-Frame-Options`, SameSite defense.
- OWASP Content Security Policy Cheat Sheet — browser-side framing and CSP guidance.
- OpenID Connect Core — `state`, `nonce`, redirect-based login security.

---

## 37. Status Seri

Selesai:

```text
Part 26 — CSRF, CORS, Clickjacking, and Browser Security Around Authentication
```

Seri belum selesai.

Berikutnya:

```text
Part 27 — Secure Error Handling, 401/403 Semantics, and User Experience
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-jakarta-security-authentication-authorization-identity-part-25-api-gateway-reverse-proxy-container-boundary.md">⬅️ Part 25 — API Gateway, Reverse Proxy, and Container Boundary Security</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-jakarta-security-authentication-authorization-identity-part-27-secure-error-handling-401-403-user-experience.md">Part 27 — Secure Error Handling, 401/403 Semantics, and User Experience ➡️</a>
</div>
