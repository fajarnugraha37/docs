# learn-http-for-web-frontend-perspective-part-035.md

# Part 035 — Synthesis: Top 1% HTTP Decision Framework for Frontend Engineers

> Seri: `learn-http-for-web-frontend-perspective`  
> Part: `035`  
> Status: **bagian terakhir / final synthesis**  
> Target pembaca: Java software engineer yang ingin menguasai HTTP dari perspektif web/frontend secara mendalam, operasional, dan defensible.

---

## 0. Posisi Bagian Ini dalam Seri

Bagian ini adalah sintesis akhir.

Kalau bagian-bagian sebelumnya membahas HTTP secara terpisah — URL, origin, message model, methods, status codes, headers, body, Fetch API, CORS, cookies, caching, redirects, TLS, security headers, isolation policies, API design, mutation, errors, streaming, service workers, observability, performance, reliability, client architecture, testing, deployment, dan case studies — bagian ini menyatukan semuanya menjadi **framework keputusan**.

Tujuan akhirnya bukan membuat Anda menghafal seluruh detail HTTP. Tujuannya adalah membuat Anda bisa menjawab pertanyaan seperti ini dengan tajam:

- “Apakah endpoint ini seharusnya GET, POST, PUT, PATCH, atau DELETE?”
- “Apakah response ini boleh dicache browser?”
- “Kenapa cookie login tidak terkirim padahal `Set-Cookie` terlihat di Network tab?”
- “Apakah error ini harus 400, 401, 403, 409, 422, 429, atau 500?”
- “Apakah retry aman?”
- “Apakah optimistic UI aman?”
- “Apakah masalah ini HTTP problem, browser policy problem, CDN problem, service worker problem, atau application state problem?”
- “Bagaimana saya review desain API agar tahan terhadap failure, caching, security, UX, dan observability?”

Top 1% engineer tidak sekadar tahu API browser atau daftar status code. Mereka bisa melihat HTTP sebagai **sistem kontrak antar boundary**.

---

## 1. Mental Model Akhir: HTTP Bukan Satu Layer

Kesalahan besar banyak engineer adalah memperlakukan HTTP sebagai satu hal tunggal:

```text
frontend calls backend using HTTP
```

Mental model yang lebih benar:

```text
User intent
  ↓
Browser UI event / navigation / resource load
  ↓
Browser fetch algorithm and security policy
  ↓
HTTP semantic model
  ↓
HTTP cache / service worker / memory cache / disk cache
  ↓
Transport connection: HTTP/1.1, HTTP/2, HTTP/3
  ↓
TLS / certificate / secure context
  ↓
CDN / proxy / gateway / load balancer
  ↓
Backend route / auth / business transaction
  ↓
Database / queue / downstream service
  ↓
Response semantics
  ↓
Browser policy interpretation
  ↓
Frontend state transition
  ↓
User-visible outcome
```

Jadi ketika ada masalah seperti:

```text
API gagal di browser tapi berhasil di Postman
```

Anda tidak boleh langsung menyimpulkan:

```text
backend bug
```

Kemungkinan layer penyebab:

- Same-Origin Policy
- CORS preflight
- missing `Access-Control-Allow-Origin`
- invalid credentialed CORS
- SameSite cookie
- Secure cookie di HTTP local dev
- service worker intercept
- cached response
- redirect ke login page
- mixed content
- CSP `connect-src`
- request header forbidden di browser
- body sudah consumed
- abort karena route berubah
- CDN/gateway stripping header
- TLS/certificate issue
- API benar, tetapi frontend error parser salah

Top 1% HTTP debugging dimulai dari pertanyaan:

> “Layer mana yang sedang mengambil keputusan?”

---

## 2. The Eight-Layer HTTP Frontend Decision Model

Gunakan model berikut untuk hampir semua analisis HTTP di frontend.

```text
1. Intent Layer
2. Resource Layer
3. Message Layer
4. Browser Policy Layer
5. Cache Layer
6. Security Layer
7. Reliability Layer
8. UX/State Layer
```

Setiap request harus bisa dijelaskan di delapan layer ini.

---

## 3. Layer 1 — Intent Layer

Pertanyaan pertama bukan “endpoint-nya apa?” melainkan:

> “User atau sistem sedang mencoba melakukan apa?”

Contoh intent:

- membaca data
- mencari data
- membuat resource
- mengubah resource
- menghapus resource
- upload file
- download file
- login
- logout
- refresh session
- subscribe realtime update
- prefetch data
- autosave draft
- optimistic update
- retry failed operation

Intent menentukan banyak hal:

- method HTTP
- status code yang benar
- apakah request aman diretry
- apakah response bisa dicache
- apakah butuh idempotency key
- apakah butuh optimistic locking
- apakah UI boleh optimistic
- apakah harus ada audit trail
- apakah user perlu feedback langsung

### 3.1 Mapping Intent ke HTTP Method

| Intent | Method Umum | Catatan |
|---|---:|---|
| Read resource | `GET` | Safe, biasanya cacheable |
| Read metadata | `HEAD` | Berguna untuk file/validation |
| Create child resource | `POST` | Tidak otomatis idempotent |
| Replace known resource | `PUT` | Idempotent secara semantic |
| Partial update | `PATCH` | Tidak otomatis idempotent, tergantung desain |
| Delete resource | `DELETE` | Idempotent secara semantic jika didesain benar |
| Preflight | `OPTIONS` | Dipakai browser untuk CORS |
| Long-running action trigger | `POST` | Sering return `202 Accepted` |

### 3.2 Anti-Pattern Intent

Buruk:

```http
GET /api/orders/123/cancel
```

Masalah:

- `GET` semantically safe.
- Browser, crawler, cache, preload, dan monitoring tools bisa memanggil GET tanpa niat mutation.
- Side effect pada GET merusak reliability dan security.

Lebih benar:

```http
POST /api/orders/123/cancellation
```

atau:

```http
PATCH /api/orders/123
Content-Type: application/json

{
  "status": "CANCELLED"
}
```

Pilih berdasarkan domain model.

---

## 4. Layer 2 — Resource Layer

HTTP bukan hanya remote procedure call. HTTP berbicara tentang **resource** dan **representasi**.

Resource adalah sesuatu yang dapat diberi identifier.

Contoh resource:

```text
/orders/123
/users/42/profile
/reports/monthly/2026-06
/files/abc/content
/search/orders?q=delayed
/me/session
```

Representation adalah bentuk data yang dikirim untuk resource tersebut.

Contoh:

```http
GET /orders/123
Accept: application/json
```

Response:

```http
200 OK
Content-Type: application/json

{
  "id": "123",
  "status": "PAID"
}
```

Yang dikirim bukan “resource itu sendiri”, tetapi representasi dari resource pada saat tertentu.

### 4.1 Pertanyaan Resource Design

Untuk setiap endpoint, tanyakan:

1. Resource apa yang diidentifikasi URL ini?
2. Apakah resource ini stabil atau hanya view-model sementara?
3. Apakah response merepresentasikan satu resource, koleksi, search result, command result, atau operation status?
4. Apakah URL ini aman dicache?
5. Apakah query parameter mengubah resource representation?
6. Apakah response berbeda berdasarkan user, language, device, feature flag, atau auth context?
7. Apakah variasi response harus tercermin dalam `Vary` atau cache policy?

### 4.2 Resource vs Action

Tidak semua hal harus dimodelkan sebagai noun murni. Tetapi setiap action tetap harus punya boundary jelas.

Contoh action yang masuk akal:

```http
POST /invoices/123/send
```

Ini kadang lebih jujur daripada memaksakan:

```http
PATCH /invoices/123
{
  "sent": true
}
```

Gunakan action endpoint ketika operasi:

- punya side effect besar;
- tidak sekadar perubahan field;
- memicu workflow;
- punya audit semantics sendiri;
- butuh idempotency key;
- menghasilkan operation result.

---

## 5. Layer 3 — Message Layer

Setiap HTTP exchange adalah message pair:

```text
Request message  →  Response message
```

Request terdiri dari:

- method
- URL
- headers
- body optional

Response terdiri dari:

- status code
- headers
- body optional

### 5.1 Invariant Request

Sebuah request yang baik harus menjawab:

```text
What do I want?
Where is the target resource?
What representation do I send?
What representation do I accept?
What credentials/policies apply?
Can this be retried?
Can this be cached?
How can this be traced?
```

Contoh request baik:

```http
PUT /api/users/42/profile HTTP/1.1
Host: api.example.com
Content-Type: application/json
Accept: application/json
If-Match: "user-profile-v7"
Idempotency-Key: 3b241101-e2bb-4255-8caf-4136c566a962
Traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01

{
  "displayName": "Ayu",
  "timezone": "Asia/Jakarta"
}
```

Kenapa kuat?

- `PUT` menunjukkan replace/update known resource.
- `Content-Type` jelas.
- `Accept` jelas.
- `If-Match` mencegah lost update.
- `Idempotency-Key` membantu retry-safe mutation.
- `Traceparent` membantu observability.

### 5.2 Invariant Response

Sebuah response yang baik harus menjawab:

```text
Did the request succeed?
What is the resulting representation?
Can it be cached?
Can it be retried?
What should the user/client do next?
How can support/debugging trace it?
```

Contoh response baik:

```http
409 Conflict
Content-Type: application/problem+json
Cache-Control: no-store
Trace-Id: 4bf92f3577b34da6a3ce929d0e0e4736

{
  "type": "https://api.example.com/problems/profile-version-conflict",
  "title": "Profile was modified by another session",
  "status": 409,
  "code": "PROFILE_VERSION_CONFLICT",
  "retryable": false,
  "userAction": "reload_and_review",
  "detail": "The profile was updated after you opened this form. Reload the latest data before saving again."
}
```

Kenapa kuat?

- Status code sesuai kondisi konflik.
- Error body machine-readable dan human-actionable.
- `no-store` mencegah error sensitif dicache.
- Trace ID memudahkan debugging.
- UI bisa menentukan state transition.

---

## 6. Layer 4 — Browser Policy Layer

Browser bukan HTTP client polos.

Browser menerapkan policy:

- Same-Origin Policy
- CORS
- Mixed Content blocking
- Secure Context requirements
- CSP
- Referrer Policy
- Permissions Policy
- COOP/COEP/CORP
- Fetch Metadata
- cookie policy
- storage partitioning
- service worker scope
- forbidden headers
- redirect restrictions

Postman, curl, backend service, dan mobile app tidak selalu mengikuti policy browser yang sama.

### 6.1 Browser Policy Diagnostic Question

Ketika request gagal di browser:

```text
Apakah server menolak request, atau browser menolak mengirim/membaca response?
```

Ini sangat berbeda.

#### Server menolak request

Evidence:

- request sampai ke server logs
- response punya status seperti 401/403/500
- frontend menerima response object
- body mungkin dapat dibaca

#### Browser menolak membaca response

Evidence:

- DevTools menunjukkan request/response ada
- console menampilkan CORS/CSP/mixed content error
- JavaScript tidak bisa akses body/header
- server log terlihat normal
- Postman/curl berhasil

### 6.2 Browser Policy Matrix

| Problem | Kemungkinan Layer |
|---|---|
| Cookie terlihat di response tapi tidak tersimpan | cookie attribute, SameSite, Secure, Domain, Path, third-party policy |
| Request tidak membawa cookie | credentials mode, SameSite, domain/path mismatch, Secure, CORS credential policy |
| Response header terlihat di Network tapi tidak bisa dibaca JS | missing `Access-Control-Expose-Headers` |
| API berhasil di Postman tapi gagal browser | CORS/SOP/CSP/mixed content/forbidden header |
| Request `Authorization` memicu OPTIONS | CORS preflight karena non-simple header |
| Redirect ke login gagal dalam fetch | redirect + CORS + credential + HTML response mismatch |
| Image/script/font blocked | CORS/CORP/COEP/CSP/MIME |

---

## 7. Layer 5 — Cache Layer

Caching adalah correctness problem.

Bukan hanya performance.

Cache salah bisa menyebabkan:

- user melihat data orang lain;
- UI menampilkan state lama;
- JS chunk 404 setelah deployment;
- login/logout tampak tidak konsisten;
- validation error lama muncul lagi;
- CDN menyajikan response personalized ke user lain;
- browser tidak mengambil HTML terbaru;
- API tampak “tidak terpanggil”.

### 7.1 Cache Decision Questions

Untuk setiap response, tanyakan:

1. Apakah response boleh disimpan?
2. Siapa yang boleh menyimpan: browser saja atau shared cache/CDN?
3. Berapa lama response fresh?
4. Bagaimana response divalidasi ulang?
5. Apakah response berbeda per user/auth/language/origin/device?
6. Apakah harus pakai `Vary`?
7. Apakah response mengandung data sensitif?
8. Apa failure mode jika response stale?
9. Apakah service worker juga menyimpan response ini?
10. Apakah CDN rule mengoverride header origin?

### 7.2 Default Cache Policy by Resource Type

| Resource | Suggested Policy | Reason |
|---|---|---|
| HTML app shell | `Cache-Control: no-cache` | Boleh disimpan, harus revalidate agar deployment baru terdeteksi |
| Hashed JS/CSS assets | `Cache-Control: public, max-age=31536000, immutable` | File name fingerprinted, aman long-cache |
| User-specific API | `Cache-Control: private, no-store` atau short private | Hindari shared cache leak |
| Public catalog data | explicit `public`/`max-age`/`s-maxage` | Bisa manfaatkan CDN |
| Error auth/session | `Cache-Control: no-store` | Hindari error state sensitif dicache |
| File download private | `Cache-Control: private, no-store` | Bergantung sensitivitas |
| Feature config | short TTL + revalidation | Balance freshness/performance |

### 7.3 Cache Smell

Waspadai:

```http
Cache-Control: public
Set-Cookie: session=...
```

```http
Cache-Control: max-age=31536000
Content-Type: text/html
```

```http
Vary: *
```

```http
Vary: Origin, Authorization, Cookie, Accept-Language, User-Agent
```

Yang terakhir tidak selalu salah, tapi bisa menyebabkan cache key explosion.

---

## 8. Layer 6 — Security Layer

Security di browser dikirim lewat HTTP headers dan policy.

Jangan berpikir security hanya backend auth.

### 8.1 Security Boundary Checklist

Untuk aplikasi web serius, review minimal:

- HTTPS everywhere
- HSTS
- Secure cookie
- HttpOnly session cookie
- SameSite strategy
- CSRF protection
- CORS allowlist eksplisit
- no wildcard credentialed CORS
- CSP minimal viable
- `frame-ancestors` atau `X-Frame-Options`
- `X-Content-Type-Options: nosniff`
- Referrer-Policy
- Permissions-Policy
- COOP/COEP/CORP jika butuh isolation
- no sensitive data in URL
- no token in fragment/query jika bisa dihindari
- no PII in headers/loggable fields
- safe redirect allowlist
- upload content validation
- download content disposition

### 8.2 CORS Security Truths

CORS bukan authentication.

CORS bukan authorization.

CORS bukan firewall.

CORS hanya memberi tahu browser apakah script dari origin tertentu boleh membaca response cross-origin.

Server-to-server clients tidak tunduk pada CORS.

Jadi jangan pernah berkata:

```text
API aman karena CORS hanya mengizinkan frontend kita.
```

Yang benar:

```text
API tetap harus punya authentication dan authorization. CORS hanya browser read-access policy.
```

### 8.3 Cookie Security Truths

Cookie adalah ambient credential.

Artinya browser dapat mengirim cookie otomatis berdasarkan domain/path/SameSite/credentials mode.

Konsekuensinya:

- cookie convenient untuk session;
- cookie rentan CSRF jika tidak didesain benar;
- HttpOnly melindungi dari direct JS read, bukan dari seluruh XSS impact;
- SameSite membantu, tetapi bukan pengganti full CSRF design dalam semua skenario;
- cross-site cookie makin dibatasi browser modern.

---

## 9. Layer 7 — Reliability Layer

Frontend HTTP reliability bukan sekadar retry.

Retry yang salah bisa menggandakan order, pembayaran, tiket, atau mutation.

### 9.1 Reliability Decision Questions

Untuk setiap operation:

1. Apakah operation safe?
2. Apakah idempotent?
3. Apakah punya idempotency key?
4. Apakah response bisa datang terlambat?
5. Apakah request bisa di-abort?
6. Apakah stale response bisa mengalahkan response terbaru?
7. Apakah user bisa double click?
8. Apakah browser bisa offline lalu online?
9. Apakah tab lain bisa mengubah resource yang sama?
10. Apakah backend punya optimistic lock?
11. Apakah retry dibatasi budget?
12. Apakah backoff pakai jitter?
13. Apakah rate limit dihormati?

### 9.2 Retry Matrix

| Condition | Retry? | Catatan |
|---|---:|---|
| GET network timeout | Usually yes | Dengan backoff/jitter |
| GET 500/502/503/504 | Usually yes | Perhatikan cache dan idempotency |
| POST create payment | No, unless idempotency key | Sangat berisiko duplicate side effect |
| PUT idempotent update | Maybe | Lebih aman jika idempotent dan punya versioning |
| PATCH partial update | Maybe not | Tergantung semantics |
| DELETE known resource | Maybe | Jika idempotent dan domain mengizinkan |
| 400/422 validation | No | User/input problem |
| 401 | No simple retry | Perlu auth/session flow |
| 403 | No | Authorization problem |
| 409 | No automatic retry | Perlu conflict resolution |
| 429 | Later | Hormati `Retry-After` jika ada |

### 9.3 Timeout Truth

Fetch tidak punya timeout default yang cukup sebagai application policy.

Anda harus mendesain:

- timeout per request type;
- cancellation saat route berubah;
- cancellation saat search query berubah;
- retry budget;
- UI feedback;
- cleanup state.

Contoh state bug:

```text
User search: "jo"
  request A sent
User search: "john"
  request B sent
Request B returns first: UI shows john
Request A returns later: UI wrongly shows jo
```

Solusi:

- abort request lama;
- ignore response jika request generation sudah obsolete;
- dedupe by query key;
- let data-fetching layer manage stale responses.

---

## 10. Layer 8 — UX/State Layer

HTTP result harus diterjemahkan menjadi state machine frontend.

Bukan hanya:

```js
try {
  const res = await fetch(...)
} catch (e) {
  showError()
}
```

Karena HTTP punya banyak outcome:

```text
idle
loading
success
empty
validation_error
auth_required
forbidden
not_found
conflict
rate_limited
server_error
network_error
timeout
aborted
offline
stale
retrying
partial_success
background_failed
```

### 10.1 UI Mapping by Failure Type

| HTTP/Network Outcome | UI Response |
|---|---|
| 200 with data | render content |
| 204 | success without body |
| 400/422 | inline form errors |
| 401 | session recovery/login flow |
| 403 | permission message, not retry |
| 404 | not found/empty depending context |
| 409 | conflict resolution UI |
| 412 | reload latest and retry manually |
| 429 | rate limit message + wait |
| 500 | retry option + support info |
| 502/503/504 | transient failure, retry/backoff |
| network error | offline/network message |
| timeout | retry/cancel affordance |
| abort | usually no user error |
| CORS blocked | technical error; needs configuration fix |

### 10.2 Important Principle

Do not expose protocol details directly to users.

Bad:

```text
HTTP 409 Conflict
```

Better:

```text
This record changed while you were editing. Reload the latest version before saving.
```

But keep protocol details available to support/observability:

```text
Support code: REQ-8F3A92
```

---

## 11. The Top 1% HTTP Review Checklist

Gunakan checklist ini saat design review API/frontend integration.

---

### 11.1 URL and Origin Checklist

- Apakah URL merepresentasikan resource/action dengan jelas?
- Apakah scheme/host/port/path/query benar di semua environment?
- Apakah app dan API same-origin, same-site, cross-origin, atau cross-site?
- Apakah keputusan domain/subdomain memengaruhi cookie, CORS, storage, dan service worker?
- Apakah fragment digunakan untuk data yang tidak boleh dikirim ke server?
- Apakah query mengandung PII atau token?
- Apakah URL stabil untuk caching/share/bookmark?

---

### 11.2 Method Checklist

- Apakah `GET` benar-benar safe?
- Apakah mutation tidak memakai `GET`?
- Apakah `PUT` benar-benar replace known resource?
- Apakah `PATCH` punya semantics jelas?
- Apakah `DELETE` idempotent?
- Apakah `POST` mutation punya idempotency key jika retry mungkin terjadi?
- Apakah `OPTIONS`/preflight ditangani gateway/backend/security layer?

---

### 11.3 Status Code Checklist

- Apakah success menggunakan 200/201/202/204 dengan tepat?
- Apakah validation error bukan 500?
- Apakah unauthenticated = 401, unauthorized = 403?
- Apakah conflict = 409 atau precondition failure = 412?
- Apakah rate limit = 429 + optional `Retry-After`?
- Apakah gateway failures dibedakan dari app failures?
- Apakah frontend bisa branch berdasarkan status code tanpa parsing string message?

---

### 11.4 Header Checklist

- Apakah `Content-Type` benar?
- Apakah `Accept` dipakai jika response variant penting?
- Apakah `Cache-Control` eksplisit?
- Apakah `Vary` benar dan tidak meledakkan cache?
- Apakah CORS headers konsisten?
- Apakah credentialed CORS tidak memakai wildcard origin?
- Apakah custom response headers yang perlu dibaca JS diekspos?
- Apakah correlation/trace ID tersedia?
- Apakah security headers ada?
- Apakah header tidak membawa PII sensitif?

---

### 11.5 Body/Representation Checklist

- Apakah body sesuai media type?
- Apakah 204 benar-benar tidak punya body?
- Apakah error body konsisten?
- Apakah JSON field nullability jelas?
- Apakah pagination metadata jelas?
- Apakah file upload memakai multipart dengan benar?
- Apakah large response perlu streaming/pagination?
- Apakah frontend tidak membaca body stream dua kali?

---

### 11.6 CORS/Cookie/Auth Checklist

- Apakah request cross-origin?
- Apakah request simple atau preflighted?
- Apakah preflight tidak butuh auth yang tidak tersedia?
- Apakah `Access-Control-Allow-Origin` eksplisit?
- Apakah `Access-Control-Allow-Credentials: true` hanya jika diperlukan?
- Apakah fetch memakai `credentials: "include"` jika butuh cookie cross-origin?
- Apakah cookie punya `Secure`, `HttpOnly`, `SameSite`, `Domain`, `Path` benar?
- Apakah CSRF threat model sudah jelas?
- Apakah logout benar-benar menghapus cookie dengan attribute yang sama?
- Apakah refresh token race condition ditangani?

---

### 11.7 Cache Checklist

- Apakah response personalized tidak masuk shared cache?
- Apakah HTML app shell tidak long-cache tanpa revalidation?
- Apakah hashed assets long-cache + immutable?
- Apakah API response punya explicit cache policy?
- Apakah ETag/Last-Modified dipakai jika revalidation berguna?
- Apakah CDN cache key mempertimbangkan auth/language/origin?
- Apakah service worker cache tidak menyajikan app lama tanpa kontrol?
- Apakah deployment tidak menghapus chunk lama terlalu cepat?

---

### 11.8 Security Checklist

- HTTPS mandatory?
- HSTS enabled?
- CSP minimal viable?
- Frame protection ada?
- MIME sniffing disabled?
- Referrer leakage dikontrol?
- Permissions dibatasi?
- Mixed content tidak ada?
- SRI dipakai untuk third-party static assets jika relevan?
- Open redirect dicegah?
- Token tidak bocor ke URL/log/referrer?
- Upload/download content safe?

---

### 11.9 Reliability Checklist

- Timeout ada?
- Abort/cancellation ada?
- Retry policy eksplisit?
- Retry hanya untuk operation yang aman?
- Backoff + jitter?
- Rate limit dihormati?
- Duplicate submit dicegah?
- Idempotency key untuk unsafe retry?
- Stale response tidak bisa overwrite state baru?
- Offline behavior jelas?
- Long-running operation pakai status resource?

---

### 11.10 Observability Checklist

- Trace/correlation ID ada dari browser ke backend?
- Error response punya support/debug ID?
- Server-Timing dipakai untuk breakdown backend jika relevan?
- Frontend RUM menangkap status/network/timing?
- HAR bisa menjelaskan problem?
- Logs bisa dikorelasikan antar gateway/backend?
- CORS/CSP/security violations dikumpulkan?
- Metrics membedakan network error vs HTTP error vs parse error vs abort?

---

## 12. HTTP Debugging Playbook

Ketika ada masalah HTTP, jangan lompat ke solusi. Jalankan playbook.

---

### Step 1 — Define Symptom Precisely

Buruk:

```text
API error.
```

Baik:

```text
In Chrome production, after login POST returns 200 and Set-Cookie appears in response, subsequent GET /me does not include Cookie header. It works in local dev with same-origin proxy.
```

Symptom yang baik punya:

- browser
- environment
- action
- request URL/method
- status code
- relevant headers
- expected behavior
- actual behavior
- whether server logs see request

---

### Step 2 — Classify Failure Layer

Gunakan pertanyaan:

```text
Did the request leave the browser?
Did it reach the server?
Did the server respond?
Did the browser block the response?
Did JS parse the response?
Did app state apply it correctly?
```

Mapping:

| Evidence | Likely Area |
|---|---|
| No request in Network tab | app logic, CSP, service worker, URL bug |
| Request in Network, no server log | DNS/TLS/proxy/CDN/network |
| Server log exists, browser shows CORS error | CORS/browser policy |
| Response 200 but UI error | parsing/app state/schema mismatch |
| Response cached unexpectedly | cache/service worker/CDN |
| Cookie absent | cookie attribute/credentials/SameSite/domain |
| Redirect to HTML login page | auth redirect not API-friendly |
| Works in curl not browser | browser policy |

---

### Step 3 — Inspect DevTools Network

Always inspect:

- Request URL
- Request method
- Status code
- Remote address / protocol
- Request headers
- Response headers
- Preview/body
- Timing tab
- Initiator
- Cookies tab
- Cache indication
- Service worker indication
- Redirect chain
- Console errors

Do not trust application logs alone.

---

### Step 4 — Compare With curl/Postman Carefully

curl/Postman useful untuk server behavior.

Browser DevTools useful untuk browser behavior.

If curl works but browser fails, look for:

- Origin header
- CORS response headers
- preflight OPTIONS
- credential mode
- cookie SameSite/Secure
- CSP
- mixed content
- redirect handling
- forbidden headers

---

### Step 5 — Reduce to Minimal Reproduction

Create minimal matrix:

```text
same-origin vs cross-origin
with credentials vs without credentials
simple request vs preflighted request
GET vs POST
JSON vs form-urlencoded
localhost vs staging domain
HTTP vs HTTPS
browser cache enabled vs disabled
service worker enabled vs disabled
```

This isolates policy and environment factors.

---

### Step 6 — Fix Root Cause, Not Symptom

Bad fixes:

```http
Access-Control-Allow-Origin: *
Access-Control-Allow-Credentials: true
```

This is invalid for credentialed CORS.

Bad fix:

```js
mode: "no-cors"
```

This often hides response from JavaScript and does not solve API access.

Bad fix:

```http
Cache-Control: no-store
```

on everything.

This may “solve” stale bugs while destroying performance.

Good fix means you can explain:

- which layer made the decision;
- what invariant was violated;
- what header/config/code restores the invariant;
- what regression test or monitoring prevents recurrence.

---

## 13. Design Review Framework: From Feature to HTTP Contract

When designing a new frontend feature, walk through this.

### 13.1 Feature Example

Feature:

```text
User edits a regulatory case assessment form with autosave, optimistic UI, conflict handling, attachment upload, and auditability.
```

### 13.2 HTTP Contract Design

#### Load form

```http
GET /api/cases/{caseId}/assessment
Accept: application/json
```

Response:

```http
200 OK
Content-Type: application/json
ETag: "assessment-v17"
Cache-Control: private, no-cache
```

Why:

- User-specific/authenticated.
- Can be stored privately but must revalidate.
- ETag supports conflict detection.

#### Autosave draft

```http
PATCH /api/cases/{caseId}/assessment-draft
Content-Type: application/json
If-Match: "assessment-v17"
Idempotency-Key: <uuid>
```

Response:

```http
200 OK
ETag: "assessment-v18"
```

Why:

- Partial update.
- Conflict-safe.
- Retry-safe with idempotency key.

#### Conflict

```http
412 Precondition Failed
Content-Type: application/problem+json
```

Body:

```json
{
  "type": "https://api.example.com/problems/assessment-stale-version",
  "title": "Assessment was changed by another user",
  "status": 412,
  "code": "ASSESSMENT_STALE_VERSION",
  "userAction": "reload_compare_merge",
  "retryable": false
}
```

Why:

- UI can show merge/reload.
- Backend protects lost update.

#### Submit final

```http
POST /api/cases/{caseId}/assessment-submissions
Idempotency-Key: <uuid>
```

Response:

```http
202 Accepted
Location: /api/operations/{operationId}
```

Why:

- Submission may trigger workflow, validation, audit, notifications.
- Long-running process represented as operation resource.

#### Upload attachment

```http
POST /api/cases/{caseId}/attachments
Content-Type: multipart/form-data; boundary=...
Idempotency-Key: <uuid>
```

Response:

```http
201 Created
Location: /api/cases/{caseId}/attachments/{attachmentId}
```

Why:

- Creates child resource.

#### Download attachment

```http
GET /api/cases/{caseId}/attachments/{attachmentId}/content
```

Response headers:

```http
Content-Type: application/pdf
Content-Disposition: attachment; filename="evidence.pdf"
Cache-Control: private, no-store
```

Why:

- Sensitive case data.
- Browser download behavior controlled.

### 13.3 Frontend State Machine

```text
idle
  → loading
  → loaded_clean
  → editing_dirty
  → autosaving
  → saved_clean
  → conflict_detected
  → resolving_conflict
  → submitting
  → submitted_pending
  → submitted_success
  → submitted_failed
```

Each transition maps to HTTP outcome.

This is how protocol design becomes product behavior.

---

## 14. The “Never Again” Anti-Pattern Catalog

### 14.1 HTTP Semantics Anti-Patterns

- Mutation via GET.
- Always returning `200 OK` with `{ success: false }`.
- Validation error as `500`.
- Auth failure as `200` with login HTML.
- Conflict as generic `400`.
- No idempotency strategy for payment/order/form submit.
- No status resource for long-running operations.

### 14.2 Browser Policy Anti-Patterns

- “It works in Postman, so browser should work.”
- `mode: "no-cors"` as fix.
- Wildcard CORS with credentials.
- Missing `Vary: Origin` when dynamically reflecting origin.
- Expecting JS to read non-exposed response headers.
- Assuming cookie sent because cookie exists.
- Ignoring SameSite/Secure in environment design.

### 14.3 Caching Anti-Patterns

- HTML app shell cached for one year.
- Hashed assets not long-cached.
- Personalized API response cached publicly.
- CDN ignores `Authorization`/`Cookie` variation.
- Service worker caches API errors permanently.
- Deleting old chunks immediately after deployment.

### 14.4 Error Contract Anti-Patterns

- Error body shape differs per endpoint.
- User-visible message used as machine code.
- No correlation ID.
- Leaking stack trace to browser.
- No retryability signal.
- Field validation errors not structured.

### 14.5 Reliability Anti-Patterns

- Retrying all POST blindly.
- No timeout.
- No abort on navigation/search changes.
- Race condition where stale response wins.
- Refresh token stampede.
- Infinite retry loop under 429.
- Ignoring `Retry-After`.

### 14.6 Observability Anti-Patterns

- No trace propagation.
- Browser errors grouped as “API failed”.
- Abort counted as failure.
- CORS error indistinguishable from server error.
- No HAR/debug recipe for support.
- No environment/version information in frontend error reports.

---

## 15. A Practical HTTP Client Architecture Blueprint

A mature frontend should not scatter raw `fetch()` calls everywhere.

Recommended layers:

```text
UI Component
  ↓
Domain Hook / Use Case Layer
  ↓
Query/Mutation Orchestration Layer
  ↓
Typed API Client
  ↓
HTTP Transport Adapter
  ↓
fetch / browser
```

### 15.1 Transport Adapter Responsibilities

- base URL resolution
- credentials policy
- default headers
- timeout via AbortSignal
- cancellation propagation
- response parsing
- error normalization
- trace/correlation header injection
- retry only if policy allows
- idempotency key support
- upload/download handling

### 15.2 Typed API Client Responsibilities

- endpoint functions
- request/response types
- runtime validation optional
- OpenAPI-generated or hand-written contract
- no UI concerns

### 15.3 Query/Mutation Layer Responsibilities

- cache key
- request dedupe
- stale/fresh policy
- background refetch
- optimistic update
- rollback
- retry policy
- mutation lifecycle

### 15.4 UI Layer Responsibilities

- render state
- collect user input
- show meaningful messages
- trigger domain actions
- never parse raw HTTP details deeply

### 15.5 Example Error Type

```ts
type HttpClientError =
  | {
      kind: "http";
      status: number;
      code?: string;
      title?: string;
      detail?: string;
      retryable?: boolean;
      traceId?: string;
      fieldErrors?: Array<{ field: string; message: string; code?: string }>;
    }
  | {
      kind: "network";
      reason: "offline" | "dns" | "tls" | "connection" | "unknown";
      retryable: boolean;
    }
  | {
      kind: "timeout";
      retryable: boolean;
    }
  | {
      kind: "aborted";
      intentional: boolean;
    }
  | {
      kind: "parse";
      status: number;
      contentType?: string;
      traceId?: string;
    };
```

This lets UI handle errors structurally.

---

## 16. Final Capstone Exercise

Design an HTTP contract for this system:

```text
Enterprise regulatory case management SPA.

Requirements:
- browser-based SPA
- authenticated users
- role-based access
- case list with filtering/sorting/pagination
- case detail page
- attachment upload/download
- autosave investigation notes
- final case submission
- audit log
- realtime status update
- offline read-only fallback for recently viewed cases
- strict security headers
- observable across browser, gateway, backend, and downstream services
- CDN in front of static assets and API gateway
```

### 16.1 Expected Design Areas

You should be able to specify:

#### Static asset strategy

- HTML cache policy
- JS/CSS hashed asset policy
- source map visibility
- CDN invalidation strategy
- old chunk retention

#### API topology

- same-origin BFF or cross-origin API
- CORS policy
- cookie/session strategy
- CSRF strategy
- refresh/session renewal strategy

#### Case list API

- endpoint
- pagination model
- filtering syntax
- sorting syntax
- cache policy
- empty state
- error states

#### Case detail API

- ETag/versioning
- conditional request
- partial data loading
- permission errors

#### Mutation API

- autosave
- optimistic/pessimistic UI
- idempotency key
- conflict handling
- 409/412 behavior

#### Attachment API

- multipart upload
- size limits
- resumability decision
- content type validation
- download headers
- private cache policy

#### Realtime

- SSE/WebSocket choice
- reconnect strategy
- event IDs
- ordering
- auth expiry

#### Offline

- service worker scope
- precache/runtime cache
- offline fallback
- stale data warning
- no offline mutation unless explicitly designed

#### Security

- HTTPS/HSTS
- CSP
- frame protection
- MIME sniffing
- referrer policy
- permissions policy
- CORS/CORP/COEP/COOP where relevant

#### Observability

- traceparent propagation
- request ID
- Server-Timing
- RUM
- error grouping
- HAR support process

### 16.2 Evaluation Rubric

A top-tier solution should:

- not use GET for mutations;
- not rely on wildcard CORS;
- not cache personalized responses publicly;
- not retry unsafe mutations blindly;
- not hide all errors behind generic toast;
- not treat auth/session as simple boolean;
- not ignore browser-specific policy;
- not break deployment with stale chunks;
- not make observability an afterthought;
- not let stale network responses overwrite newer UI state.

---

## 17. Final First-Principles Questions

When uncertain, ask these in order:

1. What is the user/system intent?
2. What resource is targeted?
3. What method expresses the intent safely?
4. What request metadata is required?
5. What response status expresses the outcome?
6. What body shape does the client need?
7. What can be cached, by whom, and for how long?
8. What browser policies apply?
9. What credentials are sent, stored, or exposed?
10. What security headers constrain behavior?
11. What happens if the request is slow, duplicated, aborted, retried, or reordered?
12. What should the UI state machine do?
13. How will we observe and debug this in production?
14. What invariant prevents this class of bug from returning?

If you can answer these, you are no longer “using HTTP”.

You are designing with HTTP.

---

## 18. Recommended Personal Mastery Path After This Series

To go beyond this series, practice in this order:

### 18.1 Build a Minimal HTTP Lab

Create a small frontend and backend where you can toggle:

- CORS allow/missing/wildcard/dynamic origin
- credentials include/omit
- SameSite cookie modes
- cache headers
- ETag/304
- redirect codes
- CSP policies
- service worker caching
- HTTP status codes
- delay/timeouts/errors

Then inspect everything in DevTools.

### 18.2 Write an HTTP Client Layer

Implement:

- timeout
- abort
- error normalization
- retry policy
- idempotency key
- trace ID
- JSON parse safety
- typed error objects
- upload/download
- auth/session handling

### 18.3 Review Real Production Incidents

For every frontend/API incident, write:

```text
symptom
layer
root cause
violated invariant
fix
preventive test/check
observability gap
```

This creates real mastery.

---

## 19. Reference Map

Use these as anchor references:

- RFC 9110 — HTTP Semantics
- RFC 9111 — HTTP Caching
- RFC 9112 — HTTP/1.1
- RFC 9113 — HTTP/2
- RFC 9114 — HTTP/3
- WHATWG Fetch Standard
- WHATWG HTML Standard
- MDN HTTP documentation
- MDN Fetch API
- MDN CORS guide
- MDN Cookies / Set-Cookie
- MDN Cache-Control / HTTP caching
- MDN Service Worker API
- OWASP CSRF Prevention Cheat Sheet
- OWASP HTTP Security Response Headers Cheat Sheet
- W3C Trace Context
- W3C Resource Timing
- W3C Server Timing
- RFC 9457 — Problem Details for HTTP APIs

---

## 20. Final Summary

HTTP dari perspektif frontend adalah gabungan dari:

```text
protocol semantics
+ browser security policy
+ cache behavior
+ credential model
+ resource loading pipeline
+ transport realities
+ API contract design
+ UI state machine
+ reliability engineering
+ observability discipline
```

Engineer biasa melihat:

```text
fetch('/api/data')
```

Engineer kuat melihat:

```text
intent → resource → method → headers → body → browser policy → cache → transport → server → status → representation → state transition → user outcome → observability
```

Itulah perbedaan utama.

---

# Status Seri

```text
Part 035 selesai.
Seri learn-http-for-web-frontend-perspective selesai.
Ini adalah bagian terakhir dari seri.
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-http-for-web-frontend-perspective-part-034.md">⬅️ Part 034 — Case Studies: Diagnosing Real Browser HTTP Incidents</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<span></span>
</div>
