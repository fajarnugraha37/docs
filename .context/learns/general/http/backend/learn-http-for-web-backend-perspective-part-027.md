# learn-http-for-web-backend-perspective-part-027.md

# Part 027 — Security Headers and HTTP Hardening

> Seri: `learn-http-for-web-backend-perspective`  
> Bagian: `027 / 032`  
> Topik: Security Headers and HTTP Hardening  
> Perspektif: Java backend engineer, production API engineer, security-aware system designer

---

## 0. Tujuan Bagian Ini

Di bagian sebelumnya kita sudah membahas observability: bagaimana backend HTTP dibuat bisa dilihat, diukur, dan didiagnosis ketika terjadi masalah. Sekarang kita masuk ke sisi yang sangat berdekatan: **hardening permukaan HTTP**.

Security header sering dianggap sebagai daftar checklist yang tinggal ditempel:

```http
Strict-Transport-Security: max-age=31536000
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
```

Cara berpikir itu berbahaya. Header security bukan mantra. Header security adalah **policy yang dikirim server kepada client, browser, proxy, cache, dan kadang intermediate component** untuk membatasi perilaku berisiko.

Di backend production, security hardening berarti:

1. mengurangi attack surface,
2. membuat browser tidak mengeksekusi konten secara terlalu permisif,
3. mencegah data sensitif tersimpan di cache yang salah,
4. memastikan cookie tidak mudah dicuri atau disalahgunakan,
5. mencegah downgrade dari HTTPS ke HTTP,
6. mengurangi risiko clickjacking, MIME sniffing, open redirect, host header abuse, dan information disclosure,
7. memastikan API machine-to-machine tidak membawa header browser-only yang menyesatkan,
8. menempatkan policy di layer yang tepat: app, gateway, reverse proxy, CDN, atau ingress.

Setelah bagian ini, kamu harus bisa:

- membedakan header security yang relevan untuk browser-facing app vs pure API,
- memilih header berdasarkan threat model, bukan copy-paste,
- memahami HSTS, CSP, `X-Content-Type-Options`, frame policy, referrer policy, permissions policy, cache hardening, cookie hardening,
- memahami apa yang sebaiknya di-set oleh backend vs gateway,
- mendesain baseline hardening untuk Spring Boot API,
- menghindari anti-pattern seperti CSP palsu, HSTS salah domain, caching data sensitif, dan header leakage.

---

## 1. Mental Model: Security Header adalah Server-Declared Client Policy

HTTP response header memungkinkan server menyatakan metadata dan policy. Dalam konteks security, header sering bekerja dengan pola berikut:

```text
Server mengirim response
        ↓
Browser membaca security header
        ↓
Browser membatasi perilaku tertentu
        ↓
Exploit tertentu menjadi lebih sulit atau gagal
```

Contoh:

```http
X-Content-Type-Options: nosniff
```

Artinya: browser tidak boleh menebak-nebak MIME type jika server sudah menyatakan `Content-Type`.

```http
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

Artinya: setelah browser menerima header ini via HTTPS, browser harus memakai HTTPS untuk host itu selama periode tertentu.

```http
Content-Security-Policy: default-src 'self'
```

Artinya: browser membatasi sumber resource yang boleh dimuat.

Yang penting: **security header tidak selalu melindungi server dari non-browser client**.

Misalnya:

- `Content-Security-Policy` terutama ditegakkan oleh browser.
- `X-Frame-Options` relevan untuk rendering browser.
- `SameSite` cookie relevan untuk browser cookie behavior.
- `CORS` relevan untuk browser cross-origin request.

Client seperti `curl`, Postman, backend service, bot, atau attacker script tidak wajib mematuhi banyak header browser security.

Jadi jangan salah model:

```text
Security header ≠ server-side authorization
Security header ≠ input validation
Security header ≠ authentication
Security header ≠ WAF
Security header ≠ full vulnerability fix
```

Security header adalah **defense-in-depth**.

---

## 2. Klasifikasi Security Hardening HTTP

Untuk backend engineer, hardening HTTP dapat dikelompokkan menjadi beberapa area.

| Area | Tujuan | Contoh |
|---|---|---|
| Transport hardening | Paksa HTTPS, cegah downgrade | HSTS, HTTPS redirect |
| Content execution control | Batasi script/resource browser | CSP |
| MIME hardening | Cegah MIME sniffing | `X-Content-Type-Options` |
| Framing control | Cegah clickjacking | `X-Frame-Options`, `frame-ancestors` |
| Referrer privacy | Kurangi leakage URL | `Referrer-Policy` |
| Browser feature control | Batasi API browser | `Permissions-Policy` |
| Sensitive cache control | Cegah data private dicache | `Cache-Control: no-store` |
| Cookie hardening | Lindungi session cookie | `HttpOnly`, `Secure`, `SameSite`, prefixes |
| Cross-origin hardening | Batasi akses browser cross-origin | CORS headers |
| API hardening | Batasi method, size, timeout, media type | `405`, `415`, body limits |
| Information disclosure control | Kurangi fingerprinting | remove `Server`, stack traces |
| Proxy trust hardening | Cegah spoofed metadata | trusted forwarded headers |

Kunci desainnya: **tidak semua header cocok untuk semua endpoint**.

Contoh:

- HTML admin UI butuh CSP ketat.
- JSON API mungkin tidak banyak mendapat manfaat dari CSP, tetapi tetap butuh `Cache-Control`, `X-Content-Type-Options`, CORS, auth, dan cookie hardening jika browser-facing.
- File download butuh `Content-Disposition`, `Content-Type`, `nosniff`, authorization, dan cache policy.
- Public static asset bisa cache agresif, tetapi private report export harus `no-store`.

---

## 3. Threat Model Sebelum Header

Sebelum memilih header, tanyakan:

1. Apakah endpoint dikonsumsi browser?
2. Apakah response berisi HTML, JSON, file, atau redirect?
3. Apakah response berisi data sensitif user/tenant/case?
4. Apakah menggunakan cookie session?
5. Apakah domain memiliki subdomain yang tidak sepenuhnya kamu kontrol?
6. Apakah ada CDN/shared cache?
7. Apakah ada reverse proxy/gateway yang juga memodifikasi header?
8. Apakah API dipanggil dari frontend cross-origin?
9. Apakah endpoint bisa di-frame oleh partner legitimate?
10. Apakah endpoint mengembalikan file upload user?

Security header yang benar bergantung pada jawaban ini.

Contoh:

```text
Public marketing page:
- CSP penting
- HSTS penting
- cache public mungkin boleh
- frame policy tergantung embedding

Authenticated case management API:
- HSTS penting
- Cache-Control no-store/private sangat penting
- CORS ketat jika browser frontend beda origin
- cookie Secure/HttpOnly/SameSite jika cookie session
- CSP tidak terlalu berarti untuk JSON API, tetapi tetap bisa dikirim baseline

Evidence file download:
- authorization wajib
- Content-Disposition hati-hati
- Content-Type valid
- X-Content-Type-Options nosniff
- Cache-Control no-store
- audit log wajib
```

---

## 4. HTTPS as Non-Negotiable Baseline

Untuk backend API production, HTTPS bukan opsi tambahan. HTTPS melindungi:

- credential in transit,
- bearer token,
- session cookie,
- API key,
- request body,
- response body,
- headers,
- path/query yang mungkin mengandung identifier sensitif,
- integrity response.

OWASP REST Security guidance menekankan bahwa REST services harus hanya menyediakan HTTPS endpoints karena credential seperti password, API key, dan JWT perlu dilindungi dalam transit.

### 4.1 Backend rule

```text
Public production endpoint should be HTTPS-only.
HTTP should either be disabled or only redirect to HTTPS.
```

Namun ada detail penting:

```text
Redirect HTTP → HTTPS bukan pengganti HSTS.
HSTS bukan pengganti HTTPS.
Keduanya saling melengkapi.
```

---

## 5. Strict-Transport-Security / HSTS

Header:

```http
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

HSTS memberi tahu browser bahwa host harus diakses via HTTPS untuk periode tertentu. MDN mendeskripsikan `Strict-Transport-Security` sebagai response header yang memberi tahu browser bahwa host hanya boleh diakses memakai HTTPS dan request HTTP berikutnya harus di-upgrade otomatis.

### 5.1 Kenapa HSTS penting?

Tanpa HSTS:

1. user mengetik `example.com`,
2. browser mencoba HTTP dulu atau link lama HTTP,
3. attacker di jaringan bisa melakukan TLS stripping,
4. user tidak pernah mencapai HTTPS dengan aman.

Dengan HSTS yang sudah tersimpan:

1. browser langsung upgrade ke HTTPS,
2. browser tidak mengizinkan bypass error certificate,
3. downgrade attack menjadi jauh lebih sulit.

### 5.2 Header anatomy

```http
Strict-Transport-Security: max-age=31536000
```

Artinya berlaku 1 tahun.

```http
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

Berlaku untuk host dan semua subdomain.

```http
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
```

Menandakan intent untuk HSTS preload list.

### 5.3 HSTS pitfalls

#### Pitfall 1: Set HSTS saat subdomain belum siap HTTPS

Jika memakai:

```http
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

semua subdomain ikut dipaksa HTTPS.

Jika ada:

```text
legacy.example.com
internal.example.com
partner.example.com
```

yang belum mendukung HTTPS valid, mereka bisa rusak bagi browser yang sudah menerima HSTS.

#### Pitfall 2: HSTS hanya efektif setelah diterima via HTTPS

Browser tidak boleh mempercayai HSTS dari HTTP biasa, karena attacker bisa menyisipkan atau menghapus header di koneksi HTTP. Karena itu first visit problem masih ada kecuali memakai preload.

#### Pitfall 3: terlalu cepat pakai preload

Preload sulit dibalik dengan cepat. Jangan aktifkan preload sebelum domain/subdomain readiness benar-benar matang.

### 5.4 Backend/gateway placement

Biasanya HSTS diset di edge:

```text
CDN / reverse proxy / gateway / ingress
```

Karena TLS termination biasanya terjadi di sana. Application boleh ikut set, tetapi pastikan tidak konflik.

### 5.5 Spring Security HSTS

Spring Security menyediakan dukungan security response headers, termasuk HSTS pada konfigurasi header. Namun ingat: jika aplikasi berada di belakang reverse proxy, app harus tahu request original scheme. Kalau app mengira request adalah HTTP karena TLS sudah terminated di proxy, behavior security/redirect bisa salah.

---

## 6. Content-Security-Policy / CSP

Header:

```http
Content-Security-Policy: default-src 'self'; object-src 'none'; frame-ancestors 'none'
```

CSP adalah salah satu security header paling kuat dan paling sering salah dikonfigurasi.

MDN merangkum bahwa `Content-Security-Policy` memungkinkan administrator website mengontrol resource yang boleh dimuat oleh user agent. OWASP HTTP Headers Cheat Sheet juga memasukkan CSP sebagai header penting untuk mengurangi risiko seperti XSS.

### 6.1 Apa yang dilindungi CSP?

CSP membantu mengurangi dampak:

- XSS,
- malicious script injection,
- data exfiltration via unauthorized connect target,
- clickjacking via `frame-ancestors`,
- mixed content,
- insecure plugin/object usage.

CSP bukan pengganti:

- output encoding,
- input validation,
- HTML sanitization,
- template safety,
- authorization,
- CSRF protection.

### 6.2 CSP untuk backend API?

Untuk pure JSON API, CSP biasanya tidak memberi banyak perlindungan karena response tidak dieksekusi sebagai document HTML. Tetapi tetap ada beberapa skenario:

1. API juga mengembalikan HTML error page.
2. API melayani Swagger UI / admin UI.
3. API mengembalikan file preview.
4. API berada di domain yang sama dengan frontend.
5. API response bisa dibuka langsung di browser.

Untuk HTML-facing endpoint, CSP sangat penting.

### 6.3 CSP directives penting

#### `default-src`

Fallback default untuk resource.

```http
Content-Security-Policy: default-src 'self'
```

#### `script-src`

Mengatur sumber script.

```http
Content-Security-Policy: script-src 'self'
```

Lebih aman dengan nonce:

```http
Content-Security-Policy: script-src 'self' 'nonce-randomValue'
```

#### `style-src`

Mengatur CSS.

```http
Content-Security-Policy: style-src 'self'
```

#### `img-src`

Mengatur image.

```http
Content-Security-Policy: img-src 'self' data:
```

#### `connect-src`

Mengatur endpoint yang boleh diakses oleh `fetch`, XHR, WebSocket, EventSource.

```http
Content-Security-Policy: connect-src 'self' https://api.example.com
```

Ini relevan jika backend melayani frontend HTML.

#### `frame-ancestors`

Mengatur siapa yang boleh men-frame halaman ini.

```http
Content-Security-Policy: frame-ancestors 'none'
```

Ini lebih modern dan lebih fleksibel daripada `X-Frame-Options`.

#### `object-src`

Umumnya set ke none.

```http
Content-Security-Policy: object-src 'none'
```

#### `base-uri`

Mencegah injeksi `<base>` yang mengubah resolusi URL.

```http
Content-Security-Policy: base-uri 'self'
```

#### `form-action`

Mengatur target form submit.

```http
Content-Security-Policy: form-action 'self'
```

### 6.4 CSP Report-Only

Sebelum enforce CSP ketat, gunakan:

```http
Content-Security-Policy-Report-Only: default-src 'self'; report-to csp-endpoint
```

MDN menjelaskan bahwa `Content-Security-Policy-Report-Only` memungkinkan monitoring violation tanpa enforcing policy.

Praktisnya:

1. mulai report-only,
2. kumpulkan violation,
3. bersihkan legitimate violation,
4. enforce policy,
5. terus monitor.

### 6.5 CSP anti-patterns

#### Anti-pattern 1: CSP dengan `unsafe-inline` dan `unsafe-eval`

```http
Content-Security-Policy: script-src 'self' 'unsafe-inline' 'unsafe-eval'
```

Ini sering melemahkan manfaat CSP.

#### Anti-pattern 2: wildcard terlalu luas

```http
Content-Security-Policy: default-src *
```

Ini hampir tidak berguna.

#### Anti-pattern 3: CSP hanya di homepage

CSP sebaiknya konsisten untuk document responses yang relevan.

#### Anti-pattern 4: mengandalkan CSP untuk memperbaiki XSS

CSP mengurangi impact. Root cause tetap harus diperbaiki.

---

## 7. X-Content-Type-Options: nosniff

Header:

```http
X-Content-Type-Options: nosniff
```

Tujuannya: mencegah browser melakukan MIME sniffing yang bisa membuat response diperlakukan sebagai tipe berbeda dari yang server nyatakan.

Contoh risiko:

1. server mengirim user-uploaded file dengan `Content-Type: text/plain`,
2. browser menebak sebagai HTML/JS,
3. konten malicious bisa dieksekusi.

### 7.1 Backend rule

Untuk API dan file download, hampir selalu aman dan dianjurkan:

```http
X-Content-Type-Options: nosniff
```

Tetapi header ini harus ditemani `Content-Type` yang benar. Jangan kirim `nosniff` lalu asal kirim `application/octet-stream` untuk semua hal tanpa memahami UX dan security implication.

### 7.2 User-uploaded content

Untuk file yang berasal dari user:

```http
Content-Type: application/octet-stream
Content-Disposition: attachment; filename="evidence.pdf"
X-Content-Type-Options: nosniff
Cache-Control: no-store
```

Jika ingin inline preview, threat model lebih kompleks:

- pastikan file type benar,
- scan malware,
- gunakan sandboxed preview domain,
- hindari serving untrusted HTML/SVG dari domain aplikasi utama,
- pertimbangkan separate domain tanpa cookie.

---

## 8. Clickjacking: X-Frame-Options and frame-ancestors

Clickjacking terjadi ketika attacker menempatkan halaman valid di dalam frame/iframe lalu menipu user untuk klik sesuatu.

Header lama:

```http
X-Frame-Options: DENY
```

atau:

```http
X-Frame-Options: SAMEORIGIN
```

CSP modern:

```http
Content-Security-Policy: frame-ancestors 'none'
```

atau:

```http
Content-Security-Policy: frame-ancestors 'self' https://partner.example.com
```

### 8.1 Pilihan policy

| Kebutuhan | Policy |
|---|---|
| Tidak boleh di-frame siapa pun | `frame-ancestors 'none'`, `X-Frame-Options: DENY` |
| Boleh di-frame same origin | `frame-ancestors 'self'`, `X-Frame-Options: SAMEORIGIN` |
| Boleh di-frame partner tertentu | `frame-ancestors https://partner.example.com` |

### 8.2 API JSON perlu frame policy?

Pure JSON API tidak dirender sebagai UI, tetapi baseline header sering tetap dikirim. Yang lebih penting adalah HTML/admin/document response.

### 8.3 Pitfall partner embedding

Jika ada partner portal yang legitimate men-frame halaman kamu, jangan pakai `DENY` global tanpa koordinasi. Gunakan policy per endpoint/host.

---

## 9. Referrer-Policy

Header:

```http
Referrer-Policy: strict-origin-when-cross-origin
```

Referrer header bisa membocorkan URL asal. Jika URL mengandung identifier sensitif:

```text
https://app.example.com/cases/CASE-123/evidence/EV-456?token=abc
```

lalu user klik link eksternal, browser bisa mengirim sebagian informasi referrer ke domain tujuan tergantung policy.

### 9.1 Recommended baseline

Umum:

```http
Referrer-Policy: strict-origin-when-cross-origin
```

Lebih ketat:

```http
Referrer-Policy: no-referrer
```

Untuk aplikasi sensitif/regulatory, sering masuk akal memakai:

```http
Referrer-Policy: no-referrer
```

atau minimal:

```http
Referrer-Policy: same-origin
```

### 9.2 Backend implication

Jangan pernah menaruh secret di URL.

Header ini membantu mengurangi leakage, tetapi tidak memperbaiki desain URL yang buruk.

Bad:

```text
/download?access_token=abc123
```

Better:

```http
Authorization: Bearer <token>
```

atau short-lived signed URL dengan threat model jelas.

---

## 10. Permissions-Policy

Header:

```http
Permissions-Policy: geolocation=(), camera=(), microphone=()
```

Header ini mengontrol fitur browser tertentu yang boleh digunakan oleh document atau embedded frame.

Contoh:

```http
Permissions-Policy: geolocation=(), microphone=(), camera=(), payment=(), usb=()
```

Untuk backend API pure JSON, header ini tidak terlalu bermakna. Untuk HTML/admin UI, sangat berguna sebagai hardening baseline.

### 10.1 Design rule

Default deny fitur yang tidak digunakan.

```text
If the application does not need a browser capability, disable it.
```

---

## 11. Cache-Control for Sensitive Data

Security hardening bukan hanya XSS/clickjacking. Banyak kebocoran data berasal dari cache.

Untuk authenticated sensitive responses:

```http
Cache-Control: no-store
Pragma: no-cache
Expires: 0
```

`no-store` berarti cache tidak boleh menyimpan response.

Untuk user-specific tetapi boleh browser cache dengan hati-hati:

```http
Cache-Control: private, max-age=60
```

Untuk public static assets:

```http
Cache-Control: public, max-age=31536000, immutable
```

### 11.1 Backend cache decision

| Response | Cache policy |
|---|---|
| Login page | `no-store` atau conservative |
| Authenticated profile | `no-store` atau `private` sangat hati-hati |
| Regulatory case details | `no-store` |
| Evidence download | `no-store` |
| Public lookup metadata | `public, max-age=...` jika benar public |
| Static JS/CSS hashed | `public, max-age=31536000, immutable` |

### 11.2 Authorization and shared cache

Jika response bergantung pada `Authorization`, jangan sampai shared cache menyimpan dan menyajikan ke user lain.

Baseline aman untuk sensitive API:

```http
Cache-Control: no-store
Vary: Authorization
```

Namun `Vary: Authorization` bukan pengganti `no-store` untuk data sangat sensitif.

### 11.3 Spring Security default cache headers

Spring Security documentation menunjukkan default security headers mencakup cache prevention seperti:

```http
Cache-Control: no-cache, no-store, max-age=0, must-revalidate
Pragma: no-cache
Expires: 0
```

Ini cocok untuk banyak authenticated apps, tetapi mungkin terlalu conservative untuk static asset jika semua response dilewati filter yang sama. Pisahkan static resource policy.

---

## 12. Cookie Hardening

Untuk session cookie:

```http
Set-Cookie: SESSION=abc; Path=/; HttpOnly; Secure; SameSite=Lax
```

Untuk sensitive app, pertimbangkan:

```http
Set-Cookie: __Host-SESSION=abc; Path=/; HttpOnly; Secure; SameSite=Lax
```

### 12.1 `HttpOnly`

Mencegah JavaScript membaca cookie.

```http
HttpOnly
```

Ini mengurangi dampak XSS terhadap pencurian cookie, tetapi XSS masih bisa melakukan request atas nama user selama session valid.

### 12.2 `Secure`

Cookie hanya dikirim melalui HTTPS.

```http
Secure
```

Untuk production session cookie, wajib.

### 12.3 `SameSite`

Mengontrol cookie dikirim pada cross-site request.

```http
SameSite=Lax
```

atau:

```http
SameSite=Strict
```

atau untuk cross-site embedded/login integration:

```http
SameSite=None; Secure
```

### 12.4 Cookie prefix

`__Secure-` membutuhkan `Secure`.

`__Host-` lebih ketat:

- harus `Secure`,
- tidak boleh punya `Domain`,
- harus `Path=/`.

Ini membantu mencegah subdomain cookie injection.

### 12.5 Regulatory app baseline

Untuk internal case management:

```http
Set-Cookie: __Host-SESSION=<opaque>; Path=/; HttpOnly; Secure; SameSite=Lax
Cache-Control: no-store
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

Jika app menggunakan cross-site SSO flow, policy bisa perlu penyesuaian sementara untuk auth callback. Jangan global melemahkan semua cookie hanya karena satu flow.

---

## 13. CORS Hardening

CORS sudah dibahas di Part 017, tetapi sebagai hardening baseline:

Bad:

```http
Access-Control-Allow-Origin: *
Access-Control-Allow-Credentials: true
```

Ini tidak valid secara browser untuk credentials dan juga menunjukkan model security yang kacau.

Better:

```http
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Credentials: true
Vary: Origin
```

Untuk machine-to-machine API yang tidak dipanggil browser, CORS mungkin tidak perlu sama sekali.

### 13.1 Rule

```text
CORS is not authentication.
CORS is not authorization.
CORS is browser access policy.
```

---

## 14. Method Allowlist and OPTIONS Discipline

HTTP hardening juga mencakup method surface.

Jika endpoint hanya mendukung `GET`, jangan diam-diam menerima semua method.

```http
HTTP/1.1 405 Method Not Allowed
Allow: GET, HEAD
```

Matikan method yang tidak diperlukan, terutama:

- TRACE,
- insecure debug endpoints,
- accidental actuator exposure,
- unsafe admin methods.

### 14.1 TRACE

`TRACE` sering dimatikan karena bisa membantu cross-site tracing attack di konfigurasi lama/tertentu. Biasanya tidak dibutuhkan aplikasi backend modern.

### 14.2 Spring MVC

Spring biasanya mengembalikan `405` jika route ada tetapi method tidak cocok. Namun method filtering juga bisa dilakukan di gateway/WAF.

---

## 15. Content-Type Hardening

Endpoint yang menerima JSON harus menolak media type yang salah.

```http
POST /cases HTTP/1.1
Content-Type: text/plain
```

Response yang benar:

```http
HTTP/1.1 415 Unsupported Media Type
```

Endpoint yang menghasilkan JSON harus set:

```http
Content-Type: application/json
X-Content-Type-Options: nosniff
```

### 15.1 Jangan menerima semua content type

Bad:

```java
@PostMapping("/cases")
public CaseResponse create(@RequestBody CaseRequest request) { ... }
```

tanpa constraint consumes.

Better:

```java
@PostMapping(
    path = "/cases",
    consumes = MediaType.APPLICATION_JSON_VALUE,
    produces = MediaType.APPLICATION_JSON_VALUE
)
public ResponseEntity<CaseResponse> create(@Valid @RequestBody CaseRequest request) {
    ...
}
```

---

## 16. Request Size Limits

Security hardening tidak cukup dengan header response. Server juga perlu batas input.

Harus ada limit untuk:

- request header size,
- request body size,
- multipart size,
- number of parts,
- filename length,
- JSON nesting depth,
- array length,
- query parameter count,
- path length,
- timeout body upload,
- concurrent request count.

Contoh policy:

```text
JSON API body: max 1 MB
Bulk endpoint: max 10 MB and max 1000 items
Evidence upload: handled by object storage signed URL
Header size: max 8–16 KB depending gateway/app
Request timeout: 30s app, 35s gateway, aligned deliberately
```

Tanpa limit, endpoint bisa menjadi DoS vector.

---

## 17. Information Disclosure Hardening

### 17.1 Remove unnecessary server banners

Bad:

```http
Server: Apache-Coyote/1.1
X-Powered-By: Express
```

Header seperti ini membantu fingerprinting. Tidak semua bisa dihapus sempurna, tapi kurangi detail.

### 17.2 Error response leakage

Bad:

```json
{
  "error": "org.postgresql.util.PSQLException: relation case_table not found",
  "stackTrace": "..."
}
```

Better:

```json
{
  "type": "https://api.example.com/problems/internal-error",
  "title": "Internal server error",
  "status": 500,
  "code": "INTERNAL_ERROR",
  "correlationId": "req-123"
}
```

### 17.3 Avoid leaking internal topology

Bad response headers:

```http
X-Upstream-Host: case-service-prod-az1-node-17
X-Database-Replica: postgres-replica-3
```

Use internal logs/traces for topology, not public response.

---

## 18. Host Header Hardening

Backend often uses `Host` or forwarded host to generate absolute URLs:

- password reset link,
- email verification link,
- callback URL,
- pagination links,
- redirect target,
- canonical URL.

If attacker controls `Host`, backend may generate malicious links.

Bad:

```http
Host: attacker.com
```

Backend sends email:

```text
Reset your password: https://attacker.com/reset?token=...
```

### 18.1 Defense

1. Configure allowed hostnames.
2. Do not blindly trust `Host`.
3. Do not blindly trust `X-Forwarded-Host`.
4. Generate external URLs from configured canonical base URL.
5. Configure reverse proxy to normalize/overwrite forwarded headers.

Spring apps behind proxy need explicit forwarded header strategy and trusted proxy configuration.

---

## 19. Open Redirect Hardening

Redirect endpoint:

```text
/login?returnUrl=https://evil.example/phish
```

Bad:

```java
return "redirect:" + returnUrl;
```

Defense:

- allow only relative paths,
- or allowlist trusted domains,
- normalize before validating,
- reject scheme-relative URLs like `//evil.com`,
- reject encoded bypass.

Better:

```text
returnUrl=/cases/123
```

not:

```text
returnUrl=https://external-domain.example
```

unless explicitly intended and controlled.

---

## 20. File Response Hardening

For download:

```http
Content-Type: application/pdf
Content-Disposition: attachment; filename="evidence.pdf"
X-Content-Type-Options: nosniff
Cache-Control: no-store
```

### 20.1 Filename risk

User-provided filename can contain:

- path separators,
- quotes,
- CRLF injection,
- Unicode confusion,
- misleading extension.

Normalize filename and consider storing original filename separately from safe download filename.

### 20.2 Inline preview risk

Inline preview:

```http
Content-Disposition: inline
```

is riskier for untrusted files. Consider:

- separate preview domain,
- no cookies on preview domain,
- sandboxed rendering,
- virus scanning,
- file type allowlist.

---

## 21. Security Headers for Different Response Types

### 21.1 HTML document baseline

```http
Strict-Transport-Security: max-age=31536000; includeSubDomains
Content-Security-Policy: default-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Cache-Control: no-store
```

Adjust CSP for real resources.

### 21.2 Authenticated JSON API baseline

```http
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
Cache-Control: no-store
Referrer-Policy: no-referrer
Content-Type: application/json
```

If browser cross-origin:

```http
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Credentials: true
Vary: Origin
```

### 21.3 Public JSON metadata baseline

```http
Content-Type: application/json
X-Content-Type-Options: nosniff
Cache-Control: public, max-age=300
ETag: "..."
```

### 21.4 File download sensitive baseline

```http
Content-Type: application/octet-stream
Content-Disposition: attachment; filename="download.bin"
X-Content-Type-Options: nosniff
Cache-Control: no-store
```

### 21.5 Static asset baseline

For hashed assets:

```http
Cache-Control: public, max-age=31536000, immutable
X-Content-Type-Options: nosniff
```

Do not use `no-store` for hashed JS/CSS unless there is a special reason.

---

## 22. Spring Security Header Support

Spring Security provides explicit support for security response headers. Documentation notes that HTTP response headers can increase web application security and can be configured through Spring Security.

### 22.1 Servlet stack example

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        return http
            .headers(headers -> headers
                .httpStrictTransportSecurity(hsts -> hsts
                    .includeSubDomains(true)
                    .maxAgeInSeconds(31536000)
                )
                .contentTypeOptions(contentType -> {})
                .frameOptions(frame -> frame.deny())
                .referrerPolicy(referrer -> referrer
                    .policy(ReferrerPolicyHeaderWriter.ReferrerPolicy.NO_REFERRER)
                )
                .contentSecurityPolicy(csp -> csp
                    .policyDirectives("default-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'")
                )
            )
            .build();
    }
}
```

Exact API names can vary by Spring Security version, so always check your version’s documentation.

### 22.2 Cache-Control nuance

Spring Security default cache headers may be right for authenticated pages but wrong for static assets. Configure static assets separately:

```java
@Configuration
public class WebConfig implements WebMvcConfigurer {
    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        registry.addResourceHandler("/assets/**")
            .addResourceLocations("classpath:/static/assets/")
            .setCacheControl(CacheControl.maxAge(365, TimeUnit.DAYS).cachePublic().immutable());
    }
}
```

### 22.3 WebFlux note

Reactive stack uses `ServerHttpSecurity` instead of `HttpSecurity`.

```java
@Bean
SecurityWebFilterChain springSecurityFilterChain(ServerHttpSecurity http) {
    return http
        .headers(headers -> headers
            .hsts(hsts -> hsts.includeSubdomains(true))
            .frameOptions(frame -> frame.mode(Mode.DENY))
        )
        .build();
}
```

Again, verify exact API for your Spring Security version.

---

## 23. Reverse Proxy / Gateway Hardening

Many headers should be set at edge:

- HSTS,
- TLS redirects,
- request size limits,
- method blocklist,
- header normalization,
- CORS for simple centralized APIs,
- security response header baseline,
- remove server banners,
- WAF rules.

But some must be app-aware:

- CSP nonce,
- per-resource cache policy,
- per-endpoint frame policy,
- per-tenant CORS allowlist,
- content disposition filename,
- authorization-specific cache decisions.

### 23.1 Edge-only hardening can be too blunt

If gateway blindly adds:

```http
Cache-Control: no-store
```

to everything, static assets suffer.

If gateway blindly adds:

```http
X-Frame-Options: DENY
```

partner embedding breaks.

If gateway blindly adds:

```http
Access-Control-Allow-Origin: *
```

authenticated browser API becomes unsafe/misleading.

### 23.2 Recommended split

| Policy | Best layer |
|---|---|
| HSTS | edge/gateway |
| TLS redirect | edge/gateway |
| CSP nonce | app |
| Static CSP baseline | app or edge |
| Per-endpoint cache | app |
| Generic no-sniff | edge/app |
| Cookie attributes | app/auth component |
| Request body limit | edge + app |
| Method deny TRACE | edge + app |
| Remove server banners | edge + server config |
| CORS allowlist | app if dynamic, edge if static |

---

## 24. Nginx Example

Example only; adapt carefully.

```nginx
server {
    listen 443 ssl http2;
    server_name api.example.com;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer" always;

    # Conservative default for API; app may override for public/static endpoints.
    add_header Cache-Control "no-store" always;

    # Disable TRACE-like unsupported methods if needed.
    if ($request_method = TRACE) {
        return 405;
    }

    client_max_body_size 1m;
    large_client_header_buffers 4 8k;

    location / {
        proxy_pass http://backend;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Request-ID $request_id;
    }
}
```

Caution: Nginx `add_header` inheritance and `always` behavior can surprise teams. Test actual responses for success and error paths.

---

## 25. Security Header Testing

### 25.1 Curl

```bash
curl -I https://api.example.com/cases/123
```

Check:

```text
Strict-Transport-Security
X-Content-Type-Options
Cache-Control
Content-Type
Referrer-Policy
```

### 25.2 Check error responses too

Security headers often disappear on 4xx/5xx generated by gateway.

Test:

```bash
curl -I https://api.example.com/not-found
curl -I -X POST https://api.example.com/get-only-endpoint
curl -I https://api.example.com/trigger-500-test
```

### 25.3 Browser devtools

Useful for:

- CSP violations,
- CORS behavior,
- cookie attributes,
- frame blocking,
- referrer behavior.

### 25.4 Automated tests

In Spring MockMvc:

```java
mockMvc.perform(get("/cases/{id}", caseId))
    .andExpect(header().string("X-Content-Type-Options", "nosniff"))
    .andExpect(header().string("Cache-Control", containsString("no-store")));
```

For endpoint-specific policy:

```java
mockMvc.perform(get("/assets/app.abc123.js"))
    .andExpect(header().string("Cache-Control", containsString("max-age=31536000")));
```

---

## 26. Observability for Hardening

Track:

- missing security headers by route,
- CSP violations,
- CORS rejection count,
- 405 method not allowed count,
- 415 unsupported media type count,
- request body too large count,
- invalid Host header count,
- blocked redirect attempt,
- suspicious Origin/Referer mismatch,
- cookie/session anomaly,
- file download denied count,
- security header regression in CI.

Do not log secrets:

- cookie values,
- bearer tokens,
- API keys,
- signed URL full query,
- CSRF token,
- authorization header.

---

## 27. Regulatory Case Management Hardening Example

Imagine platform:

```text
https://case.example.gov
```

Features:

- investigator UI,
- authenticated JSON API,
- evidence upload/download,
- public status lookup,
- partner agency integration,
- audit export.

### 27.1 Investigator UI

```http
Strict-Transport-Security: max-age=31536000; includeSubDomains
Content-Security-Policy: default-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; connect-src 'self' https://api.case.example.gov
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=()
Cache-Control: no-store
```

### 27.2 Authenticated case API

```http
Content-Type: application/json
X-Content-Type-Options: nosniff
Cache-Control: no-store
Referrer-Policy: no-referrer
```

CORS only for official frontend origin:

```http
Access-Control-Allow-Origin: https://case.example.gov
Access-Control-Allow-Credentials: true
Vary: Origin
```

### 27.3 Evidence download

```http
Content-Type: application/pdf
Content-Disposition: attachment; filename="evidence-EV-2026-001.pdf"
X-Content-Type-Options: nosniff
Cache-Control: no-store
```

Additional controls:

- authorization per evidence object,
- audit log every download,
- watermark for highly sensitive evidence,
- separate preview pipeline,
- signed temporary URL only after authorization,
- no long-lived public object storage URLs.

### 27.4 Public status lookup

If truly public:

```http
Cache-Control: public, max-age=60
ETag: "..."
X-Content-Type-Options: nosniff
```

But never expose internal case state or sensitive identifiers.

---

## 28. Common Anti-Patterns

### Anti-pattern 1: Security header copy-paste tanpa threat model

Header yang benar untuk static asset belum tentu benar untuk authenticated API.

### Anti-pattern 2: CSP terlalu permisif

```http
Content-Security-Policy: default-src * 'unsafe-inline' 'unsafe-eval'
```

### Anti-pattern 3: HSTS includeSubDomains tanpa readiness

Bisa merusak subdomain legacy.

### Anti-pattern 4: caching authenticated response

```http
Cache-Control: public, max-age=3600
```

untuk case detail authenticated adalah kebocoran serius.

### Anti-pattern 5: percaya CORS sebagai security server-side

Non-browser client tidak peduli CORS.

### Anti-pattern 6: `SameSite=None` global untuk semua cookie

Sering melemahkan CSRF posture tanpa alasan.

### Anti-pattern 7: expose stack trace dan server version

Membantu attacker fingerprint dan exploit.

### Anti-pattern 8: all security headers only on 200 response

Error page juga harus hardened.

### Anti-pattern 9: file download tanpa `nosniff` dan safe `Content-Disposition`

Berisiko terutama untuk user-uploaded content.

### Anti-pattern 10: gateway dan app saling overwrite header

Policy menjadi tidak terprediksi.

---

## 29. Production Checklist

### Transport

- [ ] HTTPS-only in production.
- [ ] HTTP redirects to HTTPS or disabled.
- [ ] HSTS enabled after readiness.
- [ ] `includeSubDomains` only after subdomain audit.
- [ ] preload only after strong operational confidence.

### Browser-facing document

- [ ] CSP defined and tested.
- [ ] CSP Report-Only used before enforcement for complex apps.
- [ ] `frame-ancestors` or `X-Frame-Options` configured.
- [ ] `Referrer-Policy` configured.
- [ ] `Permissions-Policy` configured.

### API response

- [ ] `Content-Type` explicit.
- [ ] `X-Content-Type-Options: nosniff`.
- [ ] sensitive response uses `Cache-Control: no-store`.
- [ ] CORS allowlist if browser cross-origin.
- [ ] error responses do not leak internals.

### Cookie/session

- [ ] session cookie `HttpOnly`.
- [ ] session cookie `Secure`.
- [ ] `SameSite` deliberately chosen.
- [ ] `__Host-` prefix considered for host-bound session.
- [ ] logout invalidates server-side session/token.

### Input surface

- [ ] method allowlist.
- [ ] TRACE disabled unless explicitly needed.
- [ ] body size limit.
- [ ] header size limit.
- [ ] multipart limit.
- [ ] content type enforcement.
- [ ] timeout configured.

### Proxy/gateway

- [ ] forwarded headers trusted only from known proxies.
- [ ] external URL generation does not trust raw Host.
- [ ] gateway-generated errors include baseline headers.
- [ ] app and gateway header ownership documented.

### File handling

- [ ] safe `Content-Disposition`.
- [ ] safe filename.
- [ ] `nosniff`.
- [ ] sensitive downloads `no-store`.
- [ ] authorization and audit per download.

### Testing

- [ ] security headers tested in CI.
- [ ] 4xx/5xx paths tested.
- [ ] static asset exception tested.
- [ ] CSP violations monitored.
- [ ] CORS behavior tested with credentials.

---

## 30. Exercises

### Exercise 1 — Header classification

For each endpoint, choose security/cache headers:

1. `GET /api/me`
2. `GET /api/public/countries`
3. `GET /assets/app.a1b2c3.js`
4. `GET /cases/{caseId}/evidence/{evidenceId}/download`
5. `GET /admin/dashboard`
6. `POST /api/cases`
7. `GET /swagger-ui/index.html`

Explain why each header belongs there.

### Exercise 2 — HSTS rollout plan

Design HSTS rollout for:

```text
example.gov
api.example.gov
legacy.example.gov
partner.example.gov
```

where `legacy.example.gov` does not yet support HTTPS.

Questions:

1. Should you use `includeSubDomains` immediately?
2. Should you use preload?
3. What migration plan is safest?

### Exercise 3 — CSP hardening

Given current frontend needs:

- scripts from self,
- styles from self,
- API fetch to `https://api.example.gov`,
- images from self and data URI,
- no iframe embedding,
- no plugins.

Write a CSP policy.

### Exercise 4 — Cache leak diagnosis

A user reports seeing another user's case summary after logging out and logging in as different user on shared browser.

Investigate:

1. Which headers do you check?
2. Browser cache or shared proxy cache?
3. Was `Cache-Control` wrong?
4. Was logout incomplete?
5. Was response keyed incorrectly by CDN?

### Exercise 5 — Host header attack

Your service sends password reset emails using request host.

Design a safer implementation.

---

## 31. Key Takeaways

Security headers are not magic. They are explicit browser/client/cache/proxy policies that reduce specific classes of risk.

A strong backend engineer does not ask:

```text
What security headers should I paste?
```

They ask:

```text
What is this endpoint's threat model?
Who consumes it?
Is it browser-rendered?
Is it authenticated?
Is it cacheable?
Does it carry cookies?
Can it be framed?
Can it expose secrets through referrer, cache, content sniffing, or file rendering?
Which layer owns this policy?
```

For production HTTP backend systems, the baseline is:

- HTTPS only,
- HSTS carefully rolled out,
- explicit `Content-Type`,
- `nosniff`,
- sensitive response `no-store`,
- safe cookie attributes,
- tight CORS where needed,
- CSP for browser-rendered documents,
- frame protection,
- referrer policy,
- permissions policy,
- method/media/body limits,
- no internal leakage,
- app/gateway header ownership,
- tests for success and error paths.

In regulatory and case-management systems, security header design is not just technical hygiene. It contributes to confidentiality, evidentiary integrity, auditability, and defensible handling of sensitive records.

---

## 32. Referensi

- RFC 9110 — HTTP Semantics.
- RFC 9111 — HTTP Caching.
- RFC 6265 — HTTP State Management Mechanism.
- MDN — `Strict-Transport-Security`.
- MDN — `Content-Security-Policy`.
- MDN — `Content-Security-Policy-Report-Only`.
- OWASP HTTP Headers Cheat Sheet.
- OWASP Secure Headers Project.
- OWASP REST Security Cheat Sheet.
- Spring Security Reference — Security HTTP Response Headers.
- Spring Security Reference — Default Security Headers.

---

# Status Seri

Seri `learn-http-for-web-backend-perspective` belum selesai.

Progress saat ini:

```text
Part 027 / 032 selesai.
```

Bagian berikutnya:

```text
learn-http-for-web-backend-perspective-part-028.md
```

Topik berikutnya:

```text
HTTP Attacks and Defensive Backend Design
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-http-for-web-backend-perspective-part-026.md">⬅️ Part 026 — Observability: Logs, Metrics, Traces, and HTTP Diagnostics</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-http-for-web-backend-perspective-part-028.md">Part 028 — HTTP Attacks and Defensive Backend Design ➡️</a>
</div>
