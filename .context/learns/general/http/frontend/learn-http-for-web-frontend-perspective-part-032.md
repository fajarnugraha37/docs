# learn-http-for-web-frontend-perspective-part-032.md

# Part 032 — Testing HTTP Behavior in Frontend Systems

> Seri: `learn-http-for-web-frontend-perspective`  
> Target pembaca: Java software engineer yang ingin menguasai HTTP dari sudut pandang web/frontend secara mendalam.  
> Posisi dalam seri: setelah kita membangun arsitektur HTTP client di Part 031, bagian ini membahas bagaimana memastikan perilaku HTTP tersebut benar, stabil, dan tahan regresi.

---

## 0. Tujuan Bagian Ini

Di bagian sebelumnya, kita sudah mendesain HTTP client layer yang menangani:

- base URL;
- headers;
- credentials;
- timeout;
- cancellation;
- retry;
- error normalization;
- response parsing;
- request deduplication;
- auth refresh;
- generated client;
- runtime validation;
- integration dengan query/cache layer.

Sekarang pertanyaannya:

> Bagaimana kita membuktikan bahwa semua perilaku itu benar?

Bukan hanya “test function berhasil”, tetapi:

- request dikirim dengan method, URL, header, body, credentials, dan signal yang benar;
- response sukses diparse sesuai kontrak;
- error HTTP tidak tertukar dengan network error;
- timeout benar-benar membatalkan request;
- retry hanya terjadi untuk kasus yang aman;
- cancellation tidak dianggap sebagai error user-facing;
- auth refresh tidak menyebabkan token stampede;
- stale response tidak mengalahkan response terbaru;
- schema mismatch terdeteksi sebelum merusak UI;
- contract backend/frontend tidak drift diam-diam;
- E2E flow tetap benar di browser sungguhan;
- bug CORS, cookie, redirect, cache, dan security header bisa direproduksi secara realistis.

Bagian ini bukan tentang “testing frontend umum”. Kita hanya fokus pada **testing HTTP behavior**.

---

## 1. Mental Model: HTTP Test Bukan Satu Jenis Test

Kesalahan umum engineer adalah mencoba menguji semua perilaku HTTP dengan satu jenis test.

Misalnya:

- semua dimock di unit test;
- semua dilakukan via E2E;
- semua dianggap cukup dengan contract test;
- semua dianggap cukup dengan generated client;
- semua dianggap cukup karena backend punya integration test.

Itu salah framing.

HTTP behavior berada di beberapa layer:

```text
User interaction
  ↓
UI state / component
  ↓
Data-fetching layer
  ↓
Frontend HTTP client
  ↓
Browser Fetch/XHR/Form/Navigation layer
  ↓
Browser policy: CORS, cookies, cache, credentials, redirects
  ↓
Network / proxy / CDN / gateway
  ↓
Backend API
  ↓
Backend domain logic
```

Setiap test layer punya kemampuan dan keterbatasan.

Tidak ada satu layer yang bisa membuktikan semuanya.

Yang Anda butuhkan adalah **testing portfolio**.

---

## 2. Testing Pyramid untuk HTTP Frontend

Untuk HTTP behavior, pyramid yang sehat kira-kira seperti ini:

```text
Few E2E browser tests
  - real browser
  - real routing
  - realistic auth/cookie/navigation
  - critical user journeys

Some integration/component tests with network boundary mocking
  - HTTP client + query layer + UI behavior
  - mocked API responses at network boundary
  - success/error/timeout/cancel/race cases

Many unit tests around pure transport logic
  - URL builder
  - error normalizer
  - retry policy
  - idempotency decision
  - schema decoder
  - header builder
  - cache key builder

Contract tests / schema validation
  - generated client correctness
  - OpenAPI response/request conformance
  - frontend assumptions vs backend API surface
```

Pyramid ini bukan dogma. Untuk aplikasi dengan risiko regulatori, financial, healthcare, atau enforcement lifecycle, Anda mungkin butuh lebih banyak integration dan contract testing daripada aplikasi marketing sederhana.

Prinsipnya:

> Test perilaku di layer paling murah yang masih realistis untuk perilaku itu.

---

## 3. Empat Pertanyaan Besar Sebelum Menulis Test

Sebelum menulis test HTTP, jawab empat pertanyaan ini.

### 3.1 Apa yang ingin dibuktikan?

Contoh buruk:

> Test fetch user.

Contoh lebih baik:

> Ketika API mengembalikan `409 Conflict`, UI menampilkan conflict resolution state, bukan generic error toast.

Atau:

> Ketika request search kedua selesai lebih dulu daripada request search pertama, hasil lama tidak boleh menimpa hasil baru.

Atau:

> Ketika refresh token dipicu oleh 5 request paralel, hanya satu refresh request dikirim.

### 3.2 Boundary mana yang ingin diuji?

Apakah Anda ingin menguji:

- function murni?
- HTTP client wrapper?
- query cache/data layer?
- UI component?
- browser behavior?
- backend contract?
- full end-to-end journey?

### 3.3 Seberapa realistis network yang dibutuhkan?

Apakah cukup mock function?

Atau harus intercept request di network boundary?

Atau harus pakai browser sungguhan?

Atau harus melawan backend staging?

### 3.4 Failure mode apa yang harus dipertahankan?

HTTP test yang hanya menguji success path hampir selalu underpowered.

Minimal pikirkan:

- 400 validation;
- 401 unauthenticated;
- 403 unauthorized;
- 404 not found;
- 409 conflict;
- 412 precondition failed;
- 422 validation error;
- 429 rate limited;
- 500 server error;
- 502/503/504 gateway/server unavailable;
- network error;
- timeout;
- abort/cancel;
- malformed JSON;
- empty body;
- wrong content type;
- schema mismatch;
- duplicate response;
- out-of-order response;
- redirect;
- cookie missing;
- cache stale.

---

## 4. Apa yang Harus Diuji di HTTP Client Layer

HTTP client layer biasanya punya tanggung jawab seperti ini:

```text
Domain caller
  ↓
API function
  ↓
HTTP client
  - build URL
  - apply headers
  - set credentials
  - serialize body
  - apply timeout
  - attach AbortSignal
  - parse response
  - normalize error
  - retry if allowed
  - refresh auth if needed
  - emit telemetry
  ↓
fetch/XHR
```

Yang perlu diuji:

1. URL construction.
2. Query parameter encoding.
3. Header building.
4. Body serialization.
5. Content-Type behavior.
6. Credentials mode.
7. Timeout behavior.
8. Cancellation behavior.
9. Response parsing.
10. Empty body handling.
11. Error normalization.
12. Retry decision.
13. Backoff behavior.
14. Rate-limit handling.
15. Auth refresh behavior.
16. Correlation/trace header propagation.
17. Runtime schema validation.
18. Telemetry emission.

Yang tidak perlu diuji di client layer:

- apakah browser benar-benar melakukan DNS;
- apakah TLS valid;
- apakah CDN meng-cache;
- apakah CORS benar-benar enforce;
- apakah cookie policy browser modern bekerja;
- apakah service worker intercept berjalan di semua browser.

Hal-hal itu perlu test di level lain.

---

## 5. Unit Test: Cocok untuk Logic Murni

Unit test cocok untuk behavior yang bisa diuji tanpa browser dan tanpa network.

Contoh target unit test:

- `buildUrl('/users', { page: 1, q: 'john doe' })`;
- `normalizeHttpError(response, body)`;
- `isRetryable(method, status, errorKind)`;
- `parseRetryAfter(headerValue, now)`;
- `makeIdempotencyKey(operation, payload)`;
- `shouldAttachCsrfToken(method, sameSiteContext)`;
- `deriveCacheKey(request)`;
- `decodeProblemDetails(json)`;
- `classifyError(error)`;
- `redactSensitiveHeaders(headers)`;
- `mergeAbortSignals(userSignal, timeoutSignal)`.

Unit test ideal jika fungsi punya karakter:

- input jelas;
- output jelas;
- tidak tergantung waktu nyata, network nyata, atau browser policy;
- deterministik;
- banyak edge case.

### 5.1 Contoh: Retry Policy

Misalnya retry policy:

```ts
function shouldRetry(input: {
  method: string;
  status?: number;
  errorKind?: 'network' | 'timeout' | 'abort' | 'http' | 'parse';
  hasIdempotencyKey?: boolean;
}): boolean {
  const method = input.method.toUpperCase();

  if (input.errorKind === 'abort') return false;

  const methodIsNaturallyRetryable = ['GET', 'HEAD', 'OPTIONS'].includes(method);
  const mutationIsProtected = input.hasIdempotencyKey === true;

  const safeToRetryByMethod = methodIsNaturallyRetryable || mutationIsProtected;

  if (!safeToRetryByMethod) return false;

  if (input.errorKind === 'network' || input.errorKind === 'timeout') return true;

  if (input.status === 408) return true;
  if (input.status === 429) return true;
  if (input.status !== undefined && input.status >= 500 && input.status <= 599) return true;

  return false;
}
```

Test cases:

```text
GET + 503                  => retry
GET + 404                  => no retry
GET + network error        => retry
POST + 503 + no key        => no retry
POST + 503 + idempotency   => retry
PUT + timeout              => depends on domain policy
DELETE + timeout           => dangerous unless idempotency/semantic is clear
GET + abort                => no retry
GET + malformed JSON       => no retry
GET + 429                  => retry with rate-limit policy
```

Ini bagus sebagai unit test karena Anda tidak perlu browser untuk membuktikannya.

---

## 6. Integration Test: Cocok untuk HTTP Client + Mock Network Boundary

Unit test tidak membuktikan bahwa layer HTTP client benar-benar memanggil `fetch` dengan benar.

Untuk itu, Anda butuh integration test dengan **mock network boundary**.

Ada dua pendekatan umum:

1. mock `fetch` secara langsung;
2. intercept request di boundary network menggunakan tool seperti Mock Service Worker.

### 6.1 Mock `fetch` Langsung

Contoh:

```ts
globalThis.fetch = vi.fn().mockResolvedValue(
  new Response(JSON.stringify({ id: 'u-1', name: 'Ayu' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
);
```

Kelebihan:

- simple;
- cepat;
- bagus untuk HTTP client wrapper;
- mudah inspect arguments.

Kekurangan:

- terlalu dekat dengan implementation detail;
- tidak menangkap request dari XHR/form/image/script;
- bisa membuat test pass padahal browser behavior berbeda;
- bisa menyembunyikan perbedaan `Request`, `Response`, stream, header, credentials, dan body.

Gunakan untuk test kecil yang memang ingin membuktikan wrapper memanggil `fetch` dengan argumen tertentu.

### 6.2 Mock Service Worker / Network Boundary Mocking

Mock Service Worker mengintercept request di boundary yang lebih mendekati network. Di browser, MSW memakai Service Worker API; di Node test environment, MSW menyediakan server interception. Keuntungan besarnya: aplikasi tidak tahu bahwa request dimock.

Ini lebih cocok untuk:

- component integration test;
- HTTP client + query layer;
- UI behavior berbasis response;
- error state;
- retry state;
- loading state;
- request order;
- test yang tidak ingin bergantung pada implementation detail `fetch`.

Mock Service Worker sendiri menyatakan fokusnya adalah intercept REST/GraphQL request apapun client yang dipakai, dan menangani request/response menggunakan standard Fetch API.

### 6.3 Apa yang Dites dengan Network Boundary Mocking?

Contoh:

- ketika `GET /api/users/123` sukses, screen menampilkan user;
- ketika `GET /api/users/123` mengembalikan 404, screen menampilkan not-found state;
- ketika `POST /api/orders` mengembalikan 422, field error muncul di form;
- ketika `GET /api/search?q=a` lambat lalu `GET /api/search?q=ab` cepat, hasil `a` tidak menimpa `ab`;
- ketika API mengembalikan body invalid, UI menampilkan “unexpected response” bukan crash;
- ketika request dibatalkan karena route berubah, tidak ada error toast;
- ketika response mengandung `Retry-After`, retry scheduler menghormatinya.

---

## 7. E2E Browser Test: Cocok untuk Journey dan Browser Policy

E2E browser test menggunakan browser sungguhan seperti Chromium, Firefox, atau WebKit.

Ini mahal, lebih lambat, dan lebih brittle. Jadi jangan pakai E2E untuk semua hal.

Namun beberapa perilaku hanya bisa diuji dengan baik di browser sungguhan:

- navigation;
- cookie handling;
- redirect flow;
- login/OAuth journey;
- form submission;
- browser storage interaction;
- service worker behavior;
- CORS-like real browser restrictions;
- secure context behavior;
- mixed content blocking;
- iframe behavior;
- resource loading;
- file upload/download;
- cache behavior yang bergantung browser;
- WebSocket/SSE lifecycle;
- race karena user interaction nyata.

Playwright menyediakan kemampuan untuk mengamati, memodifikasi, dan mock network request, termasuk HTTP/HTTPS request yang dibuat page seperti XHR dan fetch. Ini sangat berguna untuk E2E yang masih ingin deterministik.

### 7.1 E2E Jangan Jadi API Test

Anti-pattern:

```text
E2E test membuka UI hanya untuk membuktikan 200 response dari setiap endpoint.
```

Itu lambat dan tidak fokus.

E2E sebaiknya membuktikan journey:

```text
User login
  → cookie/session tersimpan
  → dashboard loaded
  → request authenticated
  → user melakukan mutation
  → UI optimistic update
  → server response confirmed
  → reload halaman tetap konsisten
```

Bukan sekadar:

```text
GET /api/users returns 200
```

### 7.2 Kapan E2E Harus Real Backend?

Gunakan real backend untuk:

- smoke test critical path;
- staging validation;
- auth integration;
- cookie domain/path/SameSite validation;
- CORS/gateway/proxy validation;
- migration validation;
- release confidence terhadap environment wiring.

Gunakan mocked backend untuk:

- deterministic UI journey;
- hard-to-trigger errors;
- timeout/race cases;
- edge case response;
- third-party dependency failure;
- fast CI feedback.

Hybrid sering paling sehat.

---

## 8. Contract Testing: Menjaga Frontend dan Backend Tidak Drift

Frontend sering gagal bukan karena logic frontend salah, tetapi karena contract berubah:

- field rename;
- enum value baru;
- nullable berubah;
- status code berubah;
- error envelope berubah;
- pagination metadata berubah;
- content type berubah;
- response 204 tiba-tiba punya body;
- response 200 tiba-tiba kosong;
- field yang dulu optional menjadi required;
- backend mengirim angka sebagai string;
- backend mengubah date format.

Contract testing mencoba menangkap drift ini.

### 8.1 OpenAPI sebagai Contract Artifact

OpenAPI Specification adalah standar formal untuk mendeskripsikan HTTP API sehingga manusia dan komputer dapat memahami capability API. OpenAPI dapat dipakai untuk dokumentasi, generated clients, tests, linting, dan governance.

Contract artifact yang baik harus mencakup:

- paths;
- methods;
- parameters;
- request bodies;
- response bodies;
- status codes;
- content types;
- schemas;
- auth/security schemes;
- error shapes;
- examples;
- pagination conventions;
- deprecation metadata.

### 8.2 Contract Test dari Sisi Frontend

Frontend dapat melakukan:

- generate TypeScript client dari OpenAPI;
- validate mock fixture terhadap schema;
- validate real staging response terhadap schema;
- fail CI jika OpenAPI breaking change tidak disetujui;
- run consumer-driven contract cases;
- test bahwa UI dapat menangani semua enum/status/error yang dideklarasikan.

### 8.3 Contract Test dari Sisi Backend

Backend dapat melakukan:

- verify implementation sesuai OpenAPI;
- generate schema-based integration tests;
- validate examples;
- reject undocumented response;
- enforce error envelope;
- run backward compatibility check;
- publish artifact version;
- notify consumers terhadap breaking change.

### 8.4 Contract Testing Tidak Mengganti Runtime Validation

Generated TypeScript type tidak cukup.

Kenapa?

Karena TypeScript type hilang saat runtime.

Jika backend mengirim response salah, TypeScript tidak otomatis menyelamatkan Anda.

Untuk boundary penting, gunakan runtime validation:

```text
HTTP response
  ↓
JSON parse
  ↓
runtime schema validation
  ↓
trusted domain data
```

Tanpa runtime validation, client mudah masuk ke kondisi “percaya pada data yang tidak benar”.

---

## 9. Testing Success Path

Success path tetap penting, tetapi harus diuji secara meaningful.

### 9.1 GET Success

Yang perlu dibuktikan:

- URL benar;
- query parameter benar;
- header benar;
- credentials policy benar;
- loading state muncul;
- response diparse;
- schema valid;
- UI menampilkan data;
- empty state ditangani;
- cache/query key benar;
- telemetry sukses dikirim jika perlu.

Test scenario:

```text
Given API returns user list with 2 users
When page opens
Then loading state appears
And GET /api/users?page=1 is sent
And user names are displayed
And no error state appears
```

### 9.2 POST Success

Yang perlu dibuktikan:

- body serialized dengan benar;
- `Content-Type` benar;
- CSRF/idempotency/correlation header benar jika berlaku;
- button disabled saat in-flight;
- duplicate submit dicegah;
- success response dipakai;
- UI state updated;
- query cache invalidated/updated;
- navigation/toast sesuai;
- form reset sesuai.

Test scenario:

```text
Given form is filled with valid data
When user submits
Then POST /api/orders is sent once
And submit button is disabled while pending
And success screen appears after 201 Created
And order list cache is invalidated
```

---

## 10. Testing Validation Error

Validation error biasanya domain/user-actionable.

Contoh response:

```http
HTTP/1.1 422 Unprocessable Content
Content-Type: application/problem+json

{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Validation failed",
  "status": 422,
  "detail": "One or more fields are invalid.",
  "errors": [
    { "field": "email", "code": "invalid_email", "message": "Email is invalid" },
    { "field": "age", "code": "too_young", "message": "Age must be at least 18" }
  ]
}
```

Test harus membuktikan:

- error tidak menjadi generic crash;
- field error dipasang pada field yang benar;
- global error summary muncul jika diperlukan;
- user bisa memperbaiki input;
- form state tidak hilang;
- focus management baik;
- submit dapat diulang setelah perbaikan;
- telemetry tidak menganggap ini system incident.

Validation error adalah bagian dari normal product flow. Jangan test seperti fatal error.

---

## 11. Testing Auth Error

Auth error punya beberapa jenis:

```text
401 unauthenticated
403 authenticated but forbidden
419/440 session expired (non-standard but common)
```

Test harus membedakan:

- user belum login;
- session expired;
- token refresh sukses;
- token refresh gagal;
- user tidak punya permission;
- backend mengembalikan 403 untuk resource tertentu;
- API mengembalikan 401 karena cookie tidak terkirim;
- refresh stampede dicegah.

### 11.1 Refresh Token Stampede Test

Scenario penting:

```text
Given 5 API calls return 401 nearly at the same time
When auth client handles them
Then only 1 refresh request is sent
And all original requests wait for refresh
And all original requests retry after refresh succeeds
```

Failure mode:

```text
5 original requests
  → 5 refresh requests
  → refresh token rotation invalidates older token
  → some requests fail
  → user randomly logged out
```

Ini bug produksi yang sangat umum di SPA.

### 11.2 Refresh Failure Test

Scenario:

```text
Given API returns 401
And refresh endpoint returns 401
Then user session is cleared
And user is redirected to login
And no infinite retry loop occurs
```

Invariant:

> Refresh failure harus terminal, bukan loop.

---

## 12. Testing Authorization Error

`403 Forbidden` bukan sama dengan `401 Unauthorized`.

Test harus memastikan UI tidak salah memperlakukan 403 sebagai “login ulang”.

Scenario:

```text
Given user is authenticated
And API returns 403 for admin endpoint
Then UI shows permission denied state
And does not clear session
And does not redirect to login
```

Untuk sistem enterprise/regulatori, 403 juga sering harus:

- audit event;
- disable action;
- hide sensitive detail;
- show escalation path;
- preserve evidence that user attempted prohibited action.

---

## 13. Testing Not Found

`404 Not Found` bisa berarti beberapa hal:

- resource tidak ada;
- resource sudah dihapus;
- user tidak boleh tahu resource ada;
- URL salah;
- route frontend salah;
- backend path salah;
- asset chunk hilang setelah deploy.

Test harus sesuai konteks.

### 13.1 Domain Resource 404

```text
GET /api/cases/case-123 returns 404
→ show not found state
→ allow user to return to list
→ do not crash
```

### 13.2 Static Asset 404

```text
app.abc.js references chunk.def.js
chunk.def.js deleted after deployment
browser gets 404
→ app fails to lazy-load route
→ user sees blank screen unless handled
```

Test ini biasanya bukan unit test; lebih cocok E2E/deployment smoke atau synthetic monitoring.

---

## 14. Testing Conflict and Concurrency

Conflict adalah kasus penting untuk aplikasi berbasis data.

Contoh:

```http
HTTP/1.1 409 Conflict
Content-Type: application/problem+json

{
  "type": "https://api.example.com/problems/version-conflict",
  "title": "Version conflict",
  "status": 409,
  "detail": "This record was modified by another user.",
  "currentVersion": 8,
  "attemptedVersion": 7
}
```

Test harus membuktikan:

- optimistic update dirollback;
- user diberi informasi conflict;
- data terbaru bisa direload;
- user tidak kehilangan input;
- retry otomatis tidak dilakukan sembarangan;
- audit flow tetap jelas.

Scenario:

```text
Given case version is 7 on screen
And another user updates case to version 8
When current user submits update with version 7
Then API returns 409
And UI shows conflict resolution state
And local draft is preserved
And latest server version can be fetched
```

---

## 15. Testing Rate Limit

`429 Too Many Requests` sering punya `Retry-After`.

Test harus membuktikan:

- request tidak diretry liar;
- `Retry-After` dihormati;
- UI memberi feedback yang tepat;
- user tidak bisa spam action;
- telemetry mencatat rate-limit secara benar;
- background retry tidak menghabiskan quota.

Scenario:

```text
Given API returns 429 with Retry-After: 30
When user submits again
Then client does not retry before 30 seconds
And UI shows retry countdown/state
```

Untuk unit test, jangan tunggu 30 detik nyata. Gunakan fake timers.

---

## 16. Testing Server and Gateway Errors

Server/gateway errors:

```text
500 Internal Server Error
502 Bad Gateway
503 Service Unavailable
504 Gateway Timeout
```

Test harus membuktikan:

- UI tidak crash;
- retry policy benar;
- retry tidak dilakukan untuk mutation yang tidak aman;
- user mendapat state actionable;
- correlation/support ID ditampilkan jika ada;
- background refresh failure tidak menghancurkan screen lama;
- fallback data mungkin tetap ditampilkan jika aman.

Scenario:

```text
Given dashboard already has cached data
When background refresh returns 503
Then previous data remains visible
And a non-blocking warning is shown
And retry button is available
```

Ini jauh lebih baik daripada screen kosong hanya karena refresh gagal.

---

## 17. Testing Network Error

Network error berbeda dari HTTP error.

HTTP error punya response:

```text
HTTP response received
status = 500/404/etc
```

Network error tidak punya response yang bisa dibaca:

```text
DNS failure
TLS failure
connection reset
CORS blocked response
offline
request aborted by browser
```

Dalam Fetch, banyak network-level failure muncul sebagai rejected promise, sementara HTTP 404/500 tidak membuat `fetch()` reject. Ini harus dites.

Scenario:

```text
Given network request rejects with TypeError
Then error normalizer classifies it as network_error
And UI shows connection problem state
And does not try to parse response body
```

Jangan samakan network error dengan status 500.

---

## 18. Testing Timeout

Timeout di Fetch biasanya dibangun dengan `AbortController` atau `AbortSignal.timeout()` di browser modern.

Test timeout harus membuktikan:

- timeout membatalkan request;
- error diklasifikasi sebagai timeout, bukan generic abort jika policy Anda membedakan;
- request tidak update state setelah timeout;
- retry policy sesuai;
- UI state pulih;
- timer dibersihkan.

Scenario:

```text
Given API never responds
When timeout reaches 5000ms
Then request is aborted
And UI shows timeout state
And retry button appears
```

Gunakan fake timers agar deterministic.

---

## 19. Testing Cancellation / Abort

Abort bisa terjadi karena:

- route berubah;
- component unmount;
- user menekan cancel;
- request baru menggantikan request lama;
- timeout;
- browser menghentikan page lifecycle;
- parent signal dibatalkan.

Cancellation bukan selalu error.

Scenario:

```text
Given user opens search page
And search request is in-flight
When user navigates away
Then request is aborted
And no error toast is shown
And no state update occurs on unmounted view
```

Invariant:

> User-intended abort tidak boleh tampil sebagai failure produk.

---

## 20. Testing Race Conditions

Race condition sering lebih berbahaya daripada error biasa.

### 20.1 Search-as-You-Type

Scenario:

```text
User types: a
→ request #1: /search?q=a, slow

User types: ab
→ request #2: /search?q=ab, fast

Response #2 arrives first
→ UI shows results for ab

Response #1 arrives later
→ UI must ignore it
```

Test harus membuktikan hasil lama tidak menang.

Strategi:

- abort request lama;
- request sequence number;
- latest-only state update;
- query library dedupe/cancel;
- cache key yang benar.

### 20.2 Route Change Race

Scenario:

```text
User opens /users/1
Request slow
User navigates to /users/2
Request fast
/users/2 data appears
/users/1 response arrives late
UI must not show user 1 on user 2 page
```

### 20.3 Mutation Race

Scenario:

```text
User clicks Save twice
Two POST requests are sent
First succeeds
Second also succeeds or fails unpredictably
```

Better invariant:

```text
One user intent → one mutation request
```

Atau gunakan idempotency key.

---

## 21. Testing Duplicate Submit

Duplicate submit sangat umum:

- user double-click;
- keyboard enter + button click;
- slow network;
- browser retry;
- user refresh;
- mobile tap delay;
- optimistic UI dengan retry.

Test:

```text
Given submit button is enabled
When user double-clicks submit quickly
Then only one POST is sent
And button becomes disabled while pending
```

Untuk mutation yang critical, UI prevention saja tidak cukup. Test juga idempotency behavior di backend/contract level.

---

## 22. Testing Body Parsing Edge Cases

Banyak bug HTTP frontend berasal dari asumsi body.

Test cases penting:

```text
200 + valid JSON               => parse success
200 + invalid JSON             => parse error normalized
200 + empty body               => depends on endpoint contract
204 + empty body               => success without json parse
204 + body                     => suspicious contract violation
201 + JSON body                => parse created resource
202 + status resource          => handle long-running operation
400 + problem+json             => parse problem details
500 + text/html error page     => normalize as server_error with raw snippet maybe
Content-Type missing           => handle defensively
Content-Type text/plain        => do not blindly json parse unless policy says so
```

Common bug:

```ts
const data = await response.json();
```

Pada semua response.

Ini gagal untuk `204 No Content`.

Test harus menangkapnya.

---

## 23. Testing Headers

Header behavior penting untuk:

- auth;
- CSRF;
- correlation;
- tracing;
- content negotiation;
- idempotency;
- feature flags;
- localization;
- caching;
- rate limit;
- problem details;
- conditional requests.

Test:

```text
GET /api/cases sends:
- Accept: application/json
- traceparent if tracing is enabled
- X-Request-ID or correlation ID if used
```

Mutation test:

```text
POST /api/cases sends:
- Content-Type: application/json
- Idempotency-Key
- CSRF token if cookie-authenticated
```

Do not over-test every default header browser generates. Fokus pada header yang aplikasi Anda kontrol.

---

## 24. Testing Credentials and Cookies

Credential behavior sulit diuji hanya dengan unit test.

Di HTTP client layer, Anda bisa test bahwa request menggunakan:

```ts
credentials: 'include'
```

Namun itu belum membuktikan cookie benar-benar tersimpan/dikirim oleh browser.

Untuk cookie behavior, butuh browser-level test.

Test cases:

```text
Login response sets session cookie
Next authenticated request includes cookie
Logout clears cookie/session
Cross-subdomain cookie works in intended environment
SameSite setting matches redirect/login flow
Secure cookie only works over HTTPS
HttpOnly cookie not visible to JavaScript
```

Beberapa test ini butuh environment yang realistis:

- HTTPS;
- domain/subdomain;
- correct cookie attributes;
- backend/gateway real atau near-real.

Localhost tidak selalu cukup untuk membuktikan production cookie behavior.

---

## 25. Testing CORS-like Behavior

CORS adalah browser-enforced policy. Node unit test tidak bisa membuktikan CORS secara realistis.

Mocking CORS error juga tricky karena JavaScript tidak mendapat detail response saat blocked by CORS.

Prinsip:

- unit test error normalizer untuk “network-like failure”;
- integration test UI behavior saat request rejects;
- E2E/environment test untuk actual CORS policy;
- backend/gateway test untuk expected CORS headers;
- CDN/proxy test untuk `Vary: Origin` dan credentials.

Test environment:

```text
Frontend origin: https://app.staging.example.com
API origin:      https://api.staging.example.com
```

Test:

```text
Given frontend calls API with credentials
Then preflight succeeds if needed
And actual response includes correct CORS headers
And cookie-authenticated request succeeds
```

Common mistake:

```text
CORS tested with same-origin dev proxy only
→ production cross-origin fails
```

---

## 26. Testing Redirects

Redirect behavior berbeda untuk navigation vs fetch.

Test cases:

```text
Navigation to protected page redirects to login
After login redirects back to original URL
fetch API receiving 302 to HTML login page is handled as auth/session failure
POST redirect uses expected 303/307 semantics
Open redirect is rejected/sanitized
OAuth callback validates state
```

For fetch:

- `fetch()` may follow redirects automatically;
- final response may be HTML login page instead of JSON;
- response URL may change;
- cross-origin redirect can fail depending mode/policy;
- manual redirect mode has browser restrictions.

Test harus menangkap bug:

```text
API expected JSON
but session expired
server returns 302 to /login
fetch follows
client tries response.json()
JSON parse fails on HTML
user sees generic crash
```

Expected handling:

```text
Detect unexpected content type or auth redirect
Normalize as session_expired/auth_required
Redirect or show login state
```

---

## 27. Testing Cache Behavior

Cache behavior punya beberapa layer:

```text
HTTP browser cache
Service worker cache
Data-fetching/query cache
CDN cache
Application memory cache
```

Jangan campur semua dalam satu test.

### 27.1 Query Cache Test

Test di integration level:

```text
GET /users called once for same query key
Second component reuses cached data
Invalidation after mutation triggers refetch
```

### 27.2 HTTP Cache Header Test

Lebih cocok backend/gateway/integration:

```text
HTML has Cache-Control: no-cache or short revalidation
Hashed JS has Cache-Control: public, max-age=31536000, immutable
Personalized API has Cache-Control: private or no-store as required
```

### 27.3 Service Worker Cache Test

Butuh browser/E2E atau service worker test harness:

```text
Offline navigation serves app shell
Runtime API cache does not cache personalized mutation response
New service worker activates without serving incompatible old shell forever
```

### 27.4 CDN Cache Test

Butuh environment-level/synthetic test:

```text
Response varies by Accept-Language or Origin correctly
Personalized response is not cached publicly
Static asset hit ratio behaves as expected
```

---

## 28. Testing File Upload

Upload test harus mencakup:

- multipart body;
- file metadata;
- size limit;
- content type;
- progress if supported;
- cancellation;
- server validation error;
- retry policy;
- duplicate upload;
- resumable upload if used.

Common bug:

```ts
headers: { 'Content-Type': 'multipart/form-data' }
```

Saat menggunakan `FormData`, browser harus menentukan boundary sendiri. Jika Anda set `Content-Type` manual tanpa boundary benar, request bisa rusak.

Test harus memastikan HTTP client tidak memaksa JSON content-type untuk `FormData`.

Scenario:

```text
Given user uploads file.pdf
When HTTP client sends FormData
Then Content-Type is not manually overwritten by JSON default
And server receives multipart body with file field
```

---

## 29. Testing File Download

Download test harus mencakup:

- binary response;
- blob handling;
- filename extraction;
- content disposition;
- error body when download fails;
- permission failure;
- partial content/range if supported;
- large file memory behavior.

Common bug:

```text
Client assumes every response is JSON
Download endpoint returns PDF
Client calls response.json()
```

Test:

```text
Given API returns application/pdf
When user clicks download
Then client reads blob/arrayBuffer
And creates/downloads file
And does not parse JSON
```

Error case:

```text
Given download endpoint returns 403 problem+json
Then client does not create a corrupt PDF
And shows permission error
```

---

## 30. Testing SSE / WebSocket / Streaming

Realtime/streaming test perlu memeriksa lifecycle, bukan hanya “connect”.

### 30.1 SSE

Test:

```text
connect
receive event
update UI
receive heartbeat
connection closes
reconnect with backoff
resume using Last-Event-ID if used
```

### 30.2 WebSocket

Test:

```text
connect
authenticate if protocol requires
send message
receive message
handle close code
reconnect
avoid duplicate subscription
clean up on unmount
```

### 30.3 Fetch Streaming

Test:

```text
response body emits chunks
UI updates incrementally
abort stops reader
malformed chunk handled
stream end finalizes state
```

Realtime bugs often come from lifecycle cleanup:

```text
component remounts
old socket remains open
new socket opens
user receives duplicate events
```

Test cleanup aggressively.

---

## 31. Testing Service Worker Behavior

Service worker tests are notoriously subtle.

Key scenarios:

```text
install
activate
claim clients
fetch navigation
fetch static asset
fetch API
offline fallback
cache version migration
update service worker
skipWaiting/clientsClaim behavior if used
navigation preload
```

Failure modes:

- stale app shell forever;
- old JS loads with new API contract;
- service worker caches auth response incorrectly;
- offline fallback served for API JSON request;
- cache storage grows unbounded;
- new service worker never activates because old tab stays open;
- debugging disabled cache but service worker still intercepts.

E2E/synthetic test examples:

```text
Load app online
Go offline
Reload
App shell appears
API-dependent section shows offline state
```

```text
Load version A
Deploy version B
Reload
App eventually serves version B
Old cache is cleaned
```

---

## 32. Testing Observability Behavior

HTTP client should emit observability signals.

Test:

- correlation ID created/propagated;
- traceparent attached when required;
- sensitive headers redacted;
- error classification logged;
- status code captured;
- duration captured;
- retry count captured;
- abort not counted as failure if user-intended;
- validation errors not marked as infrastructure incidents;
- support ID displayed for 5xx/problem details.

Example:

```text
Given API returns 500 with X-Correlation-ID: abc-123
Then UI shows support code abc-123
And logger records status=500, category=server_error
And Authorization header is redacted
```

Observability behavior is product-critical. Kalau user melihat error tapi support tidak bisa menemukan trace, sistem tidak operable.

---

## 33. Testing Security-Sensitive HTTP Behavior

Security-related behavior harus diuji dengan niat khusus.

Examples:

```text
CSRF token attached to unsafe same-site mutation
CSRF token not leaked to cross-origin untrusted endpoint
Authorization header not sent to external URL
Redirect URL validated before navigation
Sensitive data not put in query string
Error logs redact tokens/cookies
CSP report-only endpoint receives violation reports
SRI failure blocks tampered script in browser-level test
```

Important invariant:

> HTTP client must not be allowed to send credentials to arbitrary absolute URLs unless explicitly permitted.

Test:

```text
Given caller attempts client.get('https://evil.example/steal')
Then HTTP client rejects external origin
And no Authorization/Cookie-derived header is attached
```

Ini sangat penting jika aplikasi memakai helper generic seperti:

```ts
apiClient.get(urlFromServer)
```

---

## 34. Mocking Strategy: Jangan Terlalu Dalam, Jangan Terlalu Dangkal

Mocking buruk biasanya punya dua ekstrem.

### 34.1 Terlalu Dalam

```text
Mock function useGetUsers()
→ component test hanya membuktikan component bisa render array
→ tidak membuktikan HTTP behavior apapun
```

Ini kadang berguna untuk pure UI test, tapi bukan HTTP behavior test.

### 34.2 Terlalu Dangkal

```text
Mock real backend dengan environment kompleks untuk semua test
→ CI lambat
→ flaky
→ sulit reproduce edge case
→ developer mengabaikan test
```

### 34.3 Boundary yang Sehat

Untuk banyak kasus, mock di boundary HTTP:

```text
Component/Data layer
  ↓
Actual HTTP client
  ↓
Mock network handler
```

Dengan begitu:

- URL/method/header/body tetap diuji;
- UI behavior tetap diuji;
- response edge case mudah dibuat;
- test tetap cepat dan deterministik.

---

## 35. Fixture Design

Fixture buruk membuat test rapuh dan tidak bermakna.

### 35.1 Fixture Harus Realistis

Jangan gunakan:

```json
{ "foo": "bar" }
```

Jika kontrak real:

```json
{
  "id": "case-123",
  "status": "UNDER_REVIEW",
  "version": 12,
  "assignee": {
    "id": "user-7",
    "displayName": "Dewi"
  },
  "createdAt": "2026-06-18T10:30:00Z"
}
```

Fixture harus mencerminkan:

- required fields;
- optional fields;
- nullable fields;
- enum values;
- nested object;
- timestamps;
- pagination metadata;
- error body.

### 35.2 Minimal but Meaningful

Fixture tidak harus huge. Tapi harus memuat field yang memengaruhi behavior.

Jika UI memfilter status, fixture harus punya status.

Jika UI menampilkan stale/conflict, fixture harus punya version.

Jika UI localization, fixture harus punya label/message behavior.

### 35.3 Fixture Drift

Masalah besar:

```text
Mock fixture tidak sama dengan backend real
→ test pass
→ production fail
```

Solusi:

- validate fixture against OpenAPI schema;
- generate fixture builder dari schema;
- run periodic staging contract validation;
- use recorded HAR carefully;
- review fixture as part of API changes.

---

## 36. Testing Time Deterministically

HTTP reliability sering bergantung pada waktu:

- timeout;
- backoff;
- retry delay;
- debounce;
- cache stale time;
- token expiry;
- polling interval;
- rate-limit reset;
- optimistic update rollback;
- long-running operation polling.

Jangan pakai sleep nyata.

Anti-pattern:

```ts
await new Promise(resolve => setTimeout(resolve, 5000));
```

Gunakan:

- fake timers;
- injected clock;
- scheduler abstraction;
- deterministic backoff function;
- controlled promise resolution;
- test helpers untuk advance time.

Design terbaik:

```text
Production code depends on Clock/Scheduler interface
Test injects deterministic clock
```

Di frontend, fake timers sering cukup, tetapi hati-hati dengan microtask/macrotask scheduling.

---

## 37. Testing Request Ordering Deterministically

Untuk race condition, Anda perlu kontrol kapan response selesai.

Pattern:

```ts
const first = deferred<Response>();
const second = deferred<Response>();

// request #1 returns first.promise
// request #2 returns second.promise

second.resolve(successFor('ab'));
await screen.findByText('result for ab');

first.resolve(successFor('a'));
expect(screen.queryByText('result for a')).not.toBeInTheDocument();
```

Dengan pattern ini, test tidak bergantung latency nyata.

---

## 38. Testing with HAR Replay

HAR berisi rekaman network request/response.

Berguna untuk:

- reproduce production/staging issue;
- E2E mock besar;
- debugging third-party API;
- snapshot network behavior;
- compare before/after.

Namun HAR punya risiko:

- mengandung token/cookie/PII;
- cepat stale;
- sulit maintain;
- bisa menyembunyikan contract yang seharusnya diekspresikan sebagai schema;
- tidak cocok untuk semua test.

Gunakan HAR untuk reproduksi/debugging, bukan sebagai satu-satunya sumber kebenaran contract.

---

## 39. Testing Local Dev Proxy vs Production Topology

Dev proxy sering menyembunyikan bug.

Local:

```text
http://localhost:5173/api/users
  ↓ dev proxy
http://localhost:8080/users
```

Production:

```text
https://app.example.com
  calls
https://api.example.com
```

Perbedaan:

- origin;
- scheme;
- cookie domain;
- SameSite;
- Secure;
- CORS;
- preflight;
- HSTS;
- CDN;
- gateway header rewriting;
- compression;
- cache;
- service worker scope.

Test strategy harus punya minimal satu environment yang menyerupai production topology.

Jika semua test hanya melalui dev proxy same-origin, Anda tidak menguji real browser HTTP boundary.

---

## 40. Regression Matrix untuk HTTP Client

HTTP client regression matrix minimal:

| Category | Scenario | Expected Behavior |
|---|---|---|
| Success | 200 JSON | parse and return data |
| Success | 201 Created | parse created resource or location contract |
| Success | 202 Accepted | expose pending/status resource state |
| Success | 204 No Content | no JSON parse attempt |
| Client Error | 400 | normalized client error |
| Auth | 401 refresh succeeds | single refresh, retry original |
| Auth | 401 refresh fails | clear session, no loop |
| AuthZ | 403 | permission state, no logout |
| Not Found | 404 | not-found state |
| Conflict | 409 | conflict state, no blind retry |
| Precondition | 412 | stale version state |
| Validation | 422 | field errors |
| Rate Limit | 429 + Retry-After | scheduled retry/feedback |
| Server | 500 | server error state |
| Gateway | 502/503/504 | retry if safe, fallback if possible |
| Network | rejected fetch | network error state |
| Timeout | abort by timeout | timeout state, cleanup |
| Abort | user cancel | no error toast |
| Parse | invalid JSON | unexpected response error |
| Content-Type | HTML instead of JSON | auth redirect/unexpected content handling |
| Race | stale response late | ignored |
| Duplicate | double submit | one mutation or idempotent behavior |
| Upload | FormData | no forced JSON content-type |
| Download | binary | blob/arrayBuffer path |
| Observability | 5xx with correlation ID | support ID visible/logged |
| Security | external absolute URL | blocked or no credentials |

---

## 41. Example Test Plan for a Real Feature

Feature:

> Case review screen in a regulatory enforcement system.

HTTP interactions:

```text
GET /api/cases/{id}
GET /api/cases/{id}/timeline
PATCH /api/cases/{id}
POST /api/cases/{id}/submit-review
POST /api/cases/{id}/attachments
GET /api/cases/{id}/documents/{documentId}/download
```

### 41.1 Unit Tests

- URL builder includes encoded case ID.
- Retry policy does not retry unsafe submit without idempotency key.
- Error normalizer maps 409 to `conflict_error`.
- Problem Details validation error maps field errors.
- Download response parser handles PDF vs problem JSON.

### 41.2 Integration Tests with Mock Network

- screen loads case and timeline;
- 404 case shows not found;
- 403 case shows permission denied;
- PATCH validation error maps to fields;
- PATCH 409 preserves local draft;
- submit review uses idempotency key;
- double submit sends one request;
- upload uses FormData;
- download 403 does not produce corrupt file;
- late stale response does not overwrite newer data.

### 41.3 Contract Tests

- all fixtures validate against OpenAPI;
- staging response for case detail validates;
- `submit-review` documents 202/409/422 responses;
- error envelope consistent across endpoints;
- enum values accepted by frontend exhaustive mapping.

### 41.4 E2E Tests

- authenticated user opens case review screen;
- unauthorized user receives permission state;
- submit review journey works end-to-end;
- attachment upload/download works;
- session expiry during review redirects safely and preserves draft if required.

### 41.5 Environment Tests

- cookie works across app/api subdomains;
- CORS preflight succeeds for mutation endpoints;
- response headers include no-store for sensitive case data;
- correlation ID propagated through gateway;
- CDN does not cache personalized case response.

---

## 42. Anti-Patterns

### 42.1 Testing Implementation Detail Instead of Behavior

Bad:

```text
Expect useFetchUsers hook called once.
```

Better:

```text
Expect GET /api/users?page=1 sent and UI renders returned users.
```

### 42.2 Mocking Too High

Bad:

```text
Mock data hook for every component test.
```

This bypasses HTTP behavior.

### 42.3 Testing Only 200 OK

Bad:

```text
All mocks return 200.
```

Production mostly hurts in non-200 paths.

### 42.4 Treating CORS as Unit-Testable

CORS is browser policy. Unit tests can only test your response to CORS-like failure, not actual enforcement.

### 42.5 No Schema Validation for Fixtures

Mock can lie.

If mock lies, tests build false confidence.

### 42.6 E2E Everything

E2E all HTTP edge cases is slow, flaky, expensive, and often ignored.

### 42.7 Sleep-Based Tests

Sleep makes tests slow and flaky.

Control time instead.

### 42.8 Not Testing Abort

Abort/cancel is one of the most common frontend HTTP lifecycle bugs.

### 42.9 Not Testing Race

If user can trigger multiple requests, race is not theoretical.

### 42.10 Ignoring Observability

A test suite that proves UI shows error but does not prove support can trace the error is incomplete for production systems.

---

## 43. Practical Checklist

Before shipping a frontend HTTP feature, ask:

### Request

- Is method correct?
- Is URL correct?
- Are query params encoded?
- Are headers correct?
- Is body serialized correctly?
- Is `Content-Type` correct or intentionally omitted for `FormData`?
- Are credentials intentionally included/excluded?
- Is external URL handling safe?

### Response

- Are 200/201/202/204 handled correctly?
- Is JSON parsed only when appropriate?
- Is unexpected content type handled?
- Is schema mismatch handled?
- Are binary responses handled?

### Error

- Are 400/401/403/404/409/412/422/429/5xx handled distinctly?
- Are problem details parsed?
- Are validation errors mapped to fields?
- Is correlation/support ID visible where useful?

### Reliability

- Is timeout tested?
- Is abort tested?
- Is retry policy tested?
- Is duplicate submit tested?
- Is race/out-of-order response tested?
- Is rate-limit behavior tested?

### Auth

- Is refresh success tested?
- Is refresh failure tested?
- Is refresh stampede prevented?
- Is logout/session clear tested?
- Is 403 not treated as 401?

### Browser Policy

- Is cookie behavior tested in browser-level environment?
- Is CORS tested outside same-origin dev proxy?
- Are redirect flows tested?
- Is service worker behavior tested if used?

### Contract

- Are fixtures schema-validated?
- Is OpenAPI kept in CI?
- Are breaking changes detected?
- Are enum exhaustiveness cases tested?

### Observability

- Are errors classified correctly?
- Are retries counted?
- Are sensitive values redacted?
- Are trace/correlation IDs propagated?

---

## 44. Top 1% Mental Model

A weak frontend HTTP test asks:

> Did my component render after I mocked some data?

A stronger test asks:

> Did my application behave correctly at the network boundary under realistic success, failure, timing, and browser constraints?

A top-tier engineer asks:

> Which invariant am I proving, at which boundary, with which confidence level, and what class of production failure would this test prevent?

That framing changes everything.

You stop writing tests as ceremony.

You start writing tests as executable risk controls.

For frontend HTTP systems, the risks are not only “wrong data rendered”. They include:

- stale data;
- duplicate mutation;
- leaked credentials;
- broken auth refresh;
- hidden CORS bug;
- corrupted download;
- infinite retry loop;
- untraceable production incident;
- stale service worker;
- contract drift;
- user losing unsaved work;
- personalized data cached publicly;
- compliance/audit evidence mismatch.

Good HTTP testing is not about maximizing test count.

It is about covering the boundary conditions where web systems actually fail.

---

## 45. Ringkasan

Di bagian ini kita membangun mental model testing HTTP behavior di frontend:

- HTTP test bukan satu jenis test.
- Unit test cocok untuk pure logic seperti URL builder, retry policy, error normalizer, dan schema decoder.
- Integration test dengan mock network boundary cocok untuk HTTP client + data layer + UI behavior.
- E2E browser test cocok untuk journey, cookie, redirect, browser policy, service worker, dan environment wiring.
- Contract testing menjaga frontend/backend tidak drift.
- Runtime validation tetap penting karena TypeScript type tidak hidup di runtime.
- Failure path lebih penting daripada sekadar 200 OK.
- Timeout, abort, race, retry, duplicate submit, auth refresh, dan stale response harus diuji eksplisit.
- CORS/cookies/cache/service worker tidak boleh hanya diuji dengan asumsi local dev proxy.
- Observability juga harus diuji sebagai bagian dari operability.

Part ini menutup satu kemampuan penting:

> Anda tidak hanya bisa mendesain HTTP client yang baik, tetapi juga bisa membuktikan perilakunya secara sistematis.

---

## 46. Latihan

### Latihan 1 — Buat Regression Matrix

Ambil satu feature frontend yang memanggil minimal tiga API.

Buat matrix:

```text
endpoint
method
success status
failure statuses
retry policy
timeout policy
schema validation
UI state
observability requirement
```

### Latihan 2 — Race Test

Buat test untuk search-as-you-type:

```text
request q=a slow
request q=ab fast
response ab arrives first
response a arrives later
```

Pastikan hasil `a` tidak menimpa hasil `ab`.

### Latihan 3 — Auth Refresh Stampede

Simulasikan 5 request paralel mendapat 401.

Pastikan hanya satu refresh request dikirim.

### Latihan 4 — 204 Body Handling

Buat test bahwa HTTP client tidak memanggil `response.json()` untuk `204 No Content`.

### Latihan 5 — Upload FormData

Buat test bahwa HTTP client tidak menimpa `Content-Type` menjadi `application/json` saat body adalah `FormData`.

### Latihan 6 — Contract Fixture Validation

Ambil fixture mock yang dipakai di test.

Validasi terhadap OpenAPI schema atau runtime schema.

Temukan apakah fixture selama ini berbohong.

---

## 47. Referensi

- WHATWG Fetch Standard — https://fetch.spec.whatwg.org/
- MDN — Fetch API — https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
- MDN — AbortSignal.timeout() — https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static
- MDN — AbortSignal — https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal
- Mock Service Worker — https://mswjs.io/
- OpenAPI Specification — https://swagger.io/specification/
- OpenAPI Initiative — https://www.openapis.org/
- Playwright Mock APIs — https://playwright.dev/docs/mock
- Playwright Network — https://playwright.dev/docs/network
- RFC 9110 — HTTP Semantics — https://www.rfc-editor.org/rfc/rfc9110.html
- RFC 9457 — Problem Details for HTTP APIs — https://www.rfc-editor.org/rfc/rfc9457.html

---

## Status Seri

```text
Part 032 selesai.
Seri belum selesai.
Lanjut ke Part 033: Deployment, Environments, Proxies, Gateways, and Local Development.
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-http-for-web-frontend-perspective-part-031.md">⬅️ Part 031 — Frontend HTTP Client Architecture</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-http-for-web-frontend-perspective-part-033.md">Deployment, Environments, Proxies, Gateways, and Local Development ➡️</a>
</div>
