# learn-http-for-web-frontend-perspective-part-030.md

# Part 030 — Reliability: Retries, Timeouts, Cancellation, Backoff, Rate Limits

> Seri: `learn-http-for-web-frontend-perspective`  
> Target pembaca: Java software engineer yang ingin menguasai HTTP dari perspektif browser/frontend sampai level arsitektur dan produksi.  
> Posisi dalam seri: setelah performance engineering, sebelum frontend HTTP client architecture.

---

## 0. Tujuan Bagian Ini

Di bagian sebelumnya kita melihat HTTP dari perspektif performa: latency, payload, critical path, CDN, cache, dan waterfall.

Bagian ini bergeser dari pertanyaan:

> “Bagaimana membuat request cepat?”

menjadi:

> “Bagaimana membuat request tetap benar, aman, dan manusiawi ketika jaringan, browser, server, gateway, user, dan waktu tidak bekerja seperti yang kita harapkan?”

Reliability frontend bukan hanya masalah “coba ulang kalau gagal”. Kalau salah desain, retry justru bisa:

- menggandakan transaksi;
- memperparah overload backend;
- membuat UI menampilkan data lama;
- mengirim request setelah user sudah pindah halaman;
- memunculkan error monitoring palsu;
- menutupi root cause observability;
- membuat rate limit semakin parah;
- membuat state aplikasi tidak konsisten.

Di akhir bagian ini, Anda harus bisa:

1. membedakan network failure, HTTP failure, application failure, timeout, abort, offline, dan stale response;
2. menentukan kapan request boleh di-retry dan kapan tidak;
3. mendesain timeout yang masuk akal untuk browser;
4. menggunakan cancellation sebagai bagian dari correctness, bukan hanya optimasi;
5. memahami exponential backoff, jitter, retry budget, dan `Retry-After`;
6. menghindari race condition seperti stale response wins;
7. membangun state machine request yang eksplisit;
8. membuat frontend tidak ikut menjadi amplifikator incident backend.

---

## 1. Mental Model Utama: Frontend Reliability Adalah Boundary Management

Dalam backend, reliability sering dibahas sebagai:

- retry antar service;
- circuit breaker;
- timeout;
- bulkhead;
- queue;
- idempotency;
- transaction boundary;
- distributed tracing.

Di frontend, konsepnya mirip, tetapi boundary-nya berbeda.

Frontend berada di antara:

```text
Human
  ↓
Browser runtime
  ↓
JavaScript application
  ↓
Browser fetch/network stack
  ↓
OS network
  ↓
Wi-Fi/cellular/proxy/VPN/captive portal
  ↓
CDN/WAF/load balancer/API gateway
  ↓
Backend services
```

Karena itu, reliability frontend harus mempertimbangkan empat realitas:

1. **User bisa berubah niat kapan saja.**  
   User bisa mengetik lagi, klik ulang, pindah route, menutup tab, refresh, atau membuka tab kedua.

2. **Browser bisa membatasi, membatalkan, atau mengubah lifecycle request.**  
   Page navigation, background tab, bfcache, service worker, cache, mixed content, CORS, dan privacy policy semuanya bisa memengaruhi request.

3. **Network tidak punya failure mode yang bersih.**  
   Kadang request tidak pernah sampai server. Kadang sampai, tetapi response hilang. Kadang server memproses sukses, tetapi client timeout.

4. **HTTP status bukan satu-satunya sinyal.**  
   `fetch()` bisa reject karena network error, tetapi tidak reject untuk `500`. Response `200` bisa membawa domain error. Response `429` bisa membawa `Retry-After`. Response `409` bisa berarti user perlu resolve conflict, bukan retry otomatis.

Invariant penting:

> Frontend request reliability bukan tentang “selalu retry”; reliability adalah memastikan setiap transisi UI, setiap side effect server, dan setiap response yang diterima tetap sesuai dengan intent user terbaru.

---

## 2. Taxonomy Failure: Jangan Semua Disebut “API Error”

Kesalahan paling umum dalam frontend adalah menyatukan semua failure menjadi satu bucket:

```text
Something went wrong.
```

Untuk debugging dan desain sistem, ini terlalu miskin. Minimal kita butuh taxonomy berikut.

---

## 2.1 Network Error

Network error terjadi ketika browser tidak berhasil mendapatkan HTTP response yang bisa diekspos ke JavaScript.

Contoh penyebab:

- DNS failure;
- TCP/TLS failure;
- koneksi terputus;
- browser offline;
- CORS blocking;
- mixed content blocking;
- certificate error;
- request diblokir extension, privacy policy, atau corporate proxy;
- service worker error;
- connection reset;
- server tidak reachable.

Dengan `fetch()`, network error biasanya menyebabkan promise reject.

Contoh:

```js
try {
  const response = await fetch('/api/orders');
  // HTTP 500 tidak masuk catch di sini.
} catch (err) {
  // Ini network-level failure, abort, CORS-like failure, atau browser-level failure.
}
```

Hal penting:

> Kalau `fetch()` reject, Anda sering tidak punya HTTP status code.

Jangan membuat logic seperti:

```js
catch (err) {
  if (err.status === 500) { ... } // salah mental model
}
```

Karena `err` dari network failure bukan `Response` HTTP.

---

## 2.2 HTTP Error

HTTP error berarti browser berhasil menerima HTTP response, tetapi status-nya menunjukkan kegagalan atau kondisi khusus.

Contoh:

- `400 Bad Request`
- `401 Unauthorized`
- `403 Forbidden`
- `404 Not Found`
- `409 Conflict`
- `412 Precondition Failed`
- `422 Unprocessable Content`
- `429 Too Many Requests`
- `500 Internal Server Error`
- `502 Bad Gateway`
- `503 Service Unavailable`
- `504 Gateway Timeout`

Dengan `fetch()`, response seperti ini **tidak otomatis reject**.

```js
const response = await fetch('/api/orders/123');

if (!response.ok) {
  // Di sinilah HTTP error ditangani.
}
```

Invariant:

> Network error tidak punya HTTP response. HTTP error punya HTTP response.

---

## 2.3 Application Error

Application error berarti HTTP response mungkin saja `200 OK`, tetapi domain payload menyatakan operasi gagal atau sebagian gagal.

Contoh:

```json
{
  "success": false,
  "code": "PAYMENT_REQUIRES_3DS",
  "message": "Additional authentication required"
}
```

Atau:

```json
{
  "status": "PARTIAL_SUCCESS",
  "items": [
    { "id": "A", "status": "SUCCESS" },
    { "id": "B", "status": "FAILED", "reason": "LOCKED" }
  ]
}
```

Application error tidak selalu buruk. Ada domain flow yang memang bukan HTTP failure.

Namun anti-pattern berbahaya adalah memakai `200 OK` untuk semua hal:

```json
{
  "success": false,
  "error": "Unauthorized"
}
```

Padahal semestinya `401` atau `403`.

Konsekuensinya:

- browser/cache/proxy tidak memahami failure;
- observability status code rusak;
- frontend harus parsing body sebelum tahu class outcome;
- retry policy sulit dibuat;
- monitoring backend terlihat sehat karena semua `200`.

---

## 2.4 Timeout

Timeout adalah keputusan client atau sistem intermediate bahwa operasi terlalu lama.

Timeout bisa terjadi di banyak layer:

```text
Frontend app timeout
Browser/network internal timeout
CDN timeout
Load balancer timeout
API gateway timeout
Backend server timeout
Database timeout
```

Di browser `fetch()`, tidak ada “timeout option” universal seperti:

```js
fetch(url, { timeout: 5000 }) // bukan API fetch standar
```

Biasanya timeout dibuat dengan `AbortController` atau `AbortSignal.timeout()` jika tersedia.

Contoh pattern:

```js
async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }
}
```

Jika memakai runtime/browser yang mendukung:

```js
const response = await fetch('/api/orders', {
  signal: AbortSignal.timeout(8000)
});
```

Timeout tidak berarti server tidak memproses request.

Ini sangat penting.

```text
Client sends POST /payments
Server receives request
Server charges card
Client timeout happens before response arrives
Frontend thinks request failed
User clicks retry
Server charges card again unless idempotency exists
```

Invariant:

> Timeout adalah ketidaktahuan client terhadap outcome akhir, bukan bukti bahwa server tidak melakukan side effect.

---

## 2.5 Abort / Cancellation

Abort adalah pembatalan intentional dari sisi client/browser/app.

Contoh penyebab:

- user pindah halaman;
- user mengetik query baru;
- component unmount;
- modal ditutup;
- request lama tidak lagi relevan;
- timeout buatan app memanggil abort;
- user menekan cancel upload.

Abort berbeda dari “server error”. Abort sering bukan incident.

Contoh:

```js
const controller = new AbortController();

const promise = fetch('/api/search?q=abc', {
  signal: controller.signal
});

controller.abort();
```

Saat fetch di-abort, promise reject dengan error abort-related. Dalam monitoring, abort yang disengaja sebaiknya tidak dilaporkan sebagai error fatal.

Mental model:

> Cancellation adalah mekanisme correctness untuk membatalkan intent lama.

Bukan hanya optimasi bandwidth.

---

## 2.6 Offline dan Captive Portal

Browser bisa berada dalam kondisi:

- benar-benar offline;
- OS mengira online tetapi DNS gagal;
- Wi-Fi tersambung tetapi captive portal belum login;
- VPN memblokir domain tertentu;
- mobile network berpindah dari Wi-Fi ke cellular;
- koneksi flaky dengan packet loss tinggi.

`navigator.onLine` hanya sinyal kasar. Jangan menjadikannya sumber kebenaran tunggal.

Pattern yang lebih baik:

- gunakan `navigator.onLine` sebagai hint UI;
- tetap validasi lewat request nyata;
- bedakan offline message dari server error;
- sediakan retry manual;
- untuk mutation penting, gunakan queue/offline strategy hanya jika domain mendukung idempotency dan conflict resolution.

---

## 2.7 Stale Response

Stale response bukan selalu cache stale. Dalam frontend, stale response sering berarti:

> response dari intent lama tiba setelah intent baru.

Contoh search-as-you-type:

```text
User types: a
Request A sent
User types: ab
Request B sent
Request B returns first: results for "ab"
Request A returns later: results for "a"
UI accidentally renders "a"
```

Ini bukan masalah HTTP status. Ini masalah ordering dan relevance.

Solusi:

- abort request lama;
- beri request sequence number;
- ignore response yang bukan request terbaru;
- gunakan query library yang punya stale management;
- desain state machine eksplisit.

---

## 3. Retry: Obat yang Bisa Menjadi Racun

Retry adalah mekanisme mencoba ulang operasi setelah failure.

Retry berguna untuk failure sementara seperti:

- packet loss;
- transient `502/503/504`;
- connection reset;
- DNS blip;
- mobile network switch;
- server overload sementara;
- rate limit dengan `Retry-After`;
- eventually consistent resource belum siap.

Namun retry berbahaya untuk:

- request non-idempotent;
- pembayaran;
- submit order;
- create resource tanpa idempotency key;
- operasi yang user tidak lagi inginkan;
- validation error;
- unauthorized/forbidden;
- conflict yang perlu resolusi user;
- overloaded backend tanpa backoff.

Prinsip:

> Retry hanya aman jika operasi retriable secara semantic, bukan hanya karena error-nya terlihat sementara.

---

## 4. Klasifikasi Retry berdasarkan HTTP Method

Dari sisi HTTP semantics:

- `GET`, `HEAD`, `OPTIONS` adalah safe secara intent;
- `PUT`, `DELETE` idempotent secara semantics;
- `POST` tidak idempotent secara default;
- `PATCH` tidak otomatis idempotent.

Namun di produksi, method saja tidak cukup.

Contoh:

```http
GET /api/export/start
```

Walaupun method `GET`, endpoint ini buruk karena punya side effect.

Contoh lain:

```http
DELETE /api/cart/items/123
```

Biasanya aman di-retry kalau delete item yang sudah tidak ada dianggap sukses atau no-op.

Contoh:

```http
POST /api/payments
Idempotency-Key: 01J...
```

`POST` ini bisa aman di-retry jika backend benar-benar mendukung idempotency key.

Matrix awal:

| Operation | Default retry? | Syarat agar aman |
|---|---:|---|
| GET list/detail | Ya, terbatas | Tidak memicu side effect |
| HEAD metadata | Ya | Aman secara server |
| OPTIONS/preflight | Browser-managed | Jangan retry manual sembarangan |
| PUT replace resource | Mungkin | Payload sama, server idempotent |
| DELETE resource | Mungkin | Delete missing diperlakukan stabil |
| PATCH partial update | Hati-hati | Operation idempotent atau pakai precondition |
| POST create | Tidak default | Idempotency key |
| POST payment/order | Tidak tanpa idempotency | Idempotency + reconciliation |
| POST search/query | Bisa | Kalau read-only secara domain |

---

## 5. Klasifikasi Retry berdasarkan Status Code

Status code membantu, tetapi tidak cukup sendiri.

### Biasanya jangan retry otomatis

| Status | Makna | Alasan |
|---:|---|---|
| 400 | bad request | request invalid, retry sama akan gagal |
| 401 | unauthenticated | perlu auth/session refresh, bukan retry polos |
| 403 | forbidden | permission tidak berubah karena retry |
| 404 | not found | biasanya tidak transient, kecuali eventual consistency |
| 409 | conflict | perlu merge/refresh/resolution |
| 412 | precondition failed | perlu state baru/ETag baru |
| 422 | validation/domain error | user perlu perbaiki input |

### Bisa retry dengan syarat

| Status | Makna | Retry policy |
|---:|---|---|
| 408 | request timeout | bisa retry idempotent request |
| 425 | too early | retry setelah aman untuk early data scenario |
| 429 | too many requests | hormati `Retry-After`, backoff |
| 500 | server error | retry terbatas hanya jika idempotent/retriable |
| 502 | bad gateway | retry terbatas + backoff |
| 503 | service unavailable | hormati `Retry-After` jika ada |
| 504 | gateway timeout | hati-hati untuk mutation; outcome server unknown |

Untuk `429` dan `503`, server bisa mengirim `Retry-After`. Header ini dapat berisi delay dalam detik atau HTTP-date menurut HTTP semantics.

Contoh:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 30
```

Atau:

```http
HTTP/1.1 503 Service Unavailable
Retry-After: Fri, 31 Dec 2027 23:59:59 GMT
```

Prinsip:

> Jika server memberi `Retry-After`, client yang sopan tidak boleh mengabaikannya hanya karena exponential backoff lokal lebih cepat.

---

## 6. Klasifikasi Retry berdasarkan Error Type di `fetch()`

Dalam JavaScript, Anda perlu memisahkan minimal:

```text
success response
HTTP error response
network failure
abort/cancel
timeout
parse error
application error
```

Contoh normalizer sederhana:

```js
class HttpError extends Error {
  constructor(response, body) {
    super(`HTTP ${response.status}`);
    this.name = 'HttpError';
    this.response = response;
    this.status = response.status;
    this.body = body;
  }
}

class TimeoutError extends Error {
  constructor(message = 'Request timed out') {
    super(message);
    this.name = 'TimeoutError';
  }
}

function isAbortError(error) {
  return error?.name === 'AbortError';
}
```

Namun hati-hati: timeout yang dibuat via `AbortController` sering tampak sebagai abort. Karena itu wrapper Anda perlu tahu apakah abort terjadi karena timeout atau karena user/navigation.

Contoh:

```js
async function requestJson(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? 8000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new TimeoutError());
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: options.signal ?? controller.signal
    });

    const contentType = response.headers.get('content-type') || '';
    const hasJson = contentType.includes('application/json');
    const body = hasJson ? await response.json() : await response.text();

    if (!response.ok) {
      throw new HttpError(response, body);
    }

    return body;
  } catch (error) {
    if (error instanceof TimeoutError) {
      throw error;
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
```

Catatan: implementasi abort reason tidak selalu perlu dibuat rumit di semua app. Tetapi secara arsitektur, bedakan timeout, user cancellation, dan network failure di level observability.

---

## 7. Timeout: Bukan Angka Sakral, Melainkan Budget

Timeout buruk biasanya punya dua bentuk:

1. terlalu pendek sehingga request valid sering gagal;
2. terlalu panjang sehingga user menunggu tanpa kepastian.

Timeout harus ditentukan berdasarkan:

- jenis operasi;
- ekspektasi user;
- latency p95/p99 produksi;
- mobile vs desktop;
- criticality;
- retry policy;
- server timeout;
- gateway timeout;
- apakah operasi punya side effect.

Contoh budget kasar:

| Operation | Timeout awal | Catatan |
|---|---:|---|
| typeahead/search suggestion | 1–3 detik | abort saat query berubah |
| load detail page | 8–15 detik | tampilkan skeleton/progress |
| background refresh | 5–10 detik | boleh silent fail terbatas |
| file upload | berdasarkan ukuran/progress | jangan timeout statis pendek |
| payment/order submit | domain-specific | jangan retry tanpa idempotency |
| long-running export | jangan tunggu request sync | gunakan `202` + polling/status resource |

Rule of thumb:

> Timeout harus lebih pendek dari kesabaran user, tetapi lebih panjang dari p95 normal operasi yang sehat.

Namun untuk mutation penting:

> Timeout tidak boleh langsung diartikan gagal secara domain. Outcome-nya unknown sampai dikonfirmasi.

---

## 8. Server Timeout vs Client Timeout

Misalkan:

```text
Frontend timeout: 8s
API gateway timeout: 30s
Backend processing: 20s
```

Frontend akan abort di 8s, tetapi backend mungkin tetap memproses sampai selesai.

Atau:

```text
Frontend timeout: 60s
API gateway timeout: 30s
Backend processing: 45s
```

Frontend akan menerima `504` dari gateway setelah 30s, padahal backend mungkin masih berjalan atau sudah dibatalkan tergantung arsitektur.

Karena itu, untuk operasi panjang, jangan paksa synchronous request.

Lebih baik:

```http
POST /api/exports
→ 202 Accepted
Location: /api/exports/{jobId}
```

Lalu frontend polling:

```http
GET /api/exports/{jobId}
→ 200 { "status": "RUNNING" }
→ 200 { "status": "COMPLETED", "downloadUrl": "..." }
```

Pattern ini lebih reliable karena:

- request create job pendek;
- status bisa diulang;
- refresh page tidak kehilangan progress;
- backend bisa menjalankan job async;
- observability lebih jelas;
- timeout tidak mengaburkan outcome.

---

## 9. Cancellation: Correctness untuk Intent Terbaru

Cancellation bukan sekadar menghemat bandwidth. Ia menjaga UI dari response yang tidak lagi relevan.

Contoh buruk:

```js
async function onSearchChanged(q) {
  const results = await fetch(`/api/search?q=${encodeURIComponent(q)}`)
    .then(r => r.json());

  render(results);
}
```

Jika user mengetik cepat, response bisa datang tidak berurutan.

Pattern lebih baik:

```js
let currentSearchController = null;

async function onSearchChanged(q) {
  if (currentSearchController) {
    currentSearchController.abort();
  }

  const controller = new AbortController();
  currentSearchController = controller;

  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
      signal: controller.signal
    });

    const results = await response.json();

    if (controller.signal.aborted) return;

    render(results);
  } catch (error) {
    if (error.name === 'AbortError') return;
    showSearchError(error);
  }
}
```

Pattern alternatif: sequence number.

```js
let latestRequestId = 0;

async function loadUser(userId) {
  const requestId = ++latestRequestId;

  const response = await fetch(`/api/users/${userId}`);
  const user = await response.json();

  if (requestId !== latestRequestId) {
    return; // stale response, ignore
  }

  renderUser(user);
}
```

Keduanya berguna. Abort membatalkan request jika memungkinkan. Sequence guard tetap berguna karena tidak semua request benar-benar bisa dibatalkan di semua layer.

---

## 10. Retry Policy: Komponen Minimal

Retry policy yang sehat minimal punya:

1. **predicate**: error/status apa yang boleh di-retry;
2. **attempt limit**: maksimal berapa kali;
3. **time budget**: total durasi maksimal;
4. **backoff**: delay antar attempt;
5. **jitter**: randomness agar tidak serempak;
6. **method/operation awareness**: idempotency dan side effect;
7. **cancellation awareness**: retry berhenti jika user intent berubah;
8. **respect server hints**: `Retry-After`;
9. **observability**: log attempt count dan final outcome;
10. **UI strategy**: kapan silent, kapan tampilkan error, kapan retry manual.

Anti-pattern:

```js
while (true) {
  try {
    return await fetch(url);
  } catch (_) {
    // retry forever
  }
}
```

Ini bisa menciptakan infinite retry loop dan memperparah incident.

---

## 11. Exponential Backoff

Exponential backoff berarti delay meningkat seiring jumlah attempt.

Contoh:

```text
attempt 1: 250ms
attempt 2: 500ms
attempt 3: 1000ms
attempt 4: 2000ms
attempt 5: 4000ms
```

Dengan cap:

```text
min(base * 2^attempt, maxDelay)
```

Contoh:

```js
function exponentialBackoff(attempt, baseMs = 250, maxMs = 5000) {
  return Math.min(baseMs * 2 ** attempt, maxMs);
}
```

Namun backoff tanpa jitter bisa menyebabkan thundering herd.

Jika ribuan browser gagal bersamaan lalu retry dengan jadwal sama:

```text
0s: all fail
1s: all retry
2s: all retry
4s: all retry
8s: all retry
```

Backend mendapat gelombang traffic berulang.

---

## 12. Jitter: Mengacak Agar Tidak Serempak

Jitter menambahkan randomness ke delay.

### Full jitter

```js
function fullJitterDelay(attempt, baseMs = 250, maxMs = 5000) {
  const cap = Math.min(baseMs * 2 ** attempt, maxMs);
  return Math.floor(Math.random() * cap);
}
```

### Equal jitter

```js
function equalJitterDelay(attempt, baseMs = 250, maxMs = 5000) {
  const cap = Math.min(baseMs * 2 ** attempt, maxMs);
  return Math.floor(cap / 2 + Math.random() * cap / 2);
}
```

Untuk frontend, full jitter sering cukup baik untuk request background atau retry massal. Untuk user-visible operation, terlalu random bisa terasa aneh; gunakan batas yang manusiawi.

Prinsip:

> Backoff mengurangi frekuensi retry. Jitter mengurangi sinkronisasi retry.

---

## 13. `Retry-After`: Server Memberi Jadwal

`Retry-After` bisa muncul pada `429` atau `503`, juga pada beberapa redirect scenario.

Format:

```http
Retry-After: 120
```

atau:

```http
Retry-After: Wed, 21 Oct 2027 07:28:00 GMT
```

Parser sederhana:

```js
function parseRetryAfter(headerValue, now = Date.now()) {
  if (!headerValue) return null;

  const seconds = Number(headerValue);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const dateMs = Date.parse(headerValue);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - now);
  }

  return null;
}
```

Policy:

```js
function computeRetryDelay({ attempt, response }) {
  const retryAfter = parseRetryAfter(response?.headers?.get('retry-after'));

  if (retryAfter != null) {
    return Math.min(retryAfter, 60_000); // cap client-side if needed
  }

  return fullJitterDelay(attempt);
}
```

Catatan penting:

- Jangan retry `429` agresif.
- Tampilkan UI yang menjelaskan user harus menunggu jika action user-visible.
- Untuk background polling, kurangi frekuensi.
- Untuk shared quota, koordinasikan antar tab jika perlu.

---

## 14. Retry Budget

Retry budget membatasi total biaya retry.

Tanpa budget:

```text
User action → 5 retries
Background refresh → 5 retries
Polling → 5 retries every interval
Multiple tabs → multiplied
Multiple components → multiplied
```

Aplikasi bisa tanpa sadar menggandakan traffic.

Budget bisa berupa:

- maksimal attempt per request;
- total waktu retry;
- maksimal retry per endpoint per menit;
- maksimal retry global per browser session;
- maksimal concurrent retry;
- stop retry jika app background;
- stop retry jika user intent berubah.

Contoh:

```js
const retryPolicy = {
  maxAttempts: 3,
  maxElapsedMs: 10_000,
  baseDelayMs: 250,
  maxDelayMs: 3000
};
```

Budget bukan hanya melindungi client, tapi juga melindungi backend.

---

## 15. Implementasi `fetch` dengan Retry yang Lebih Aman

Contoh berikut bukan library production lengkap, tapi menunjukkan struktur mental yang benar.

```js
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const id = setTimeout(resolve, ms);

    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(id);
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    }
  });
}

function isRetriableStatus(status) {
  return status === 408 || status === 429 || status === 500 ||
         status === 502 || status === 503 || status === 504;
}

function isRetriableMethod(method) {
  return ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE'].includes(method.toUpperCase());
}

function shouldRetry({ error, response, method, idempotent }) {
  if (error?.name === 'AbortError') return false;

  const safeByOperation = idempotent || isRetriableMethod(method);
  if (!safeByOperation) return false;

  if (response) {
    return isRetriableStatus(response.status);
  }

  // Network failure: retry only if operation is safe/idempotent.
  return true;
}

async function fetchWithRetry(url, options = {}) {
  const method = options.method ?? 'GET';
  const maxAttempts = options.maxAttempts ?? 3;
  const startedAt = Date.now();
  const maxElapsedMs = options.maxElapsedMs ?? 10_000;
  const signal = options.signal;
  const idempotent = options.idempotent ?? false;

  let lastError;
  let lastResponse;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    }

    try {
      const response = await fetch(url, options);

      if (!response.ok && shouldRetry({ response, method, idempotent })) {
        lastResponse = response;
      } else {
        return response;
      }
    } catch (error) {
      if (!shouldRetry({ error, method, idempotent })) {
        throw error;
      }
      lastError = error;
    }

    const elapsed = Date.now() - startedAt;
    if (attempt === maxAttempts - 1 || elapsed >= maxElapsedMs) {
      break;
    }

    const retryAfter = parseRetryAfter(lastResponse?.headers?.get('retry-after'));
    const backoff = retryAfter ?? fullJitterDelay(attempt, 250, 3000);
    const remaining = maxElapsedMs - elapsed;

    await sleep(Math.min(backoff, remaining), signal);
  }

  if (lastResponse) return lastResponse;
  throw lastError ?? new Error('Request failed after retries');
}
```

Hal yang sengaja ada:

- retry predicate eksplisit;
- method/idempotency awareness;
- abort awareness;
- max attempts;
- max elapsed time;
- `Retry-After`;
- backoff+jitter;
- tidak retry abort;
- tidak retry non-idempotent by default.

Hal yang belum ada:

- parsing error body;
- tracing/correlation;
- timeout per attempt;
- global retry budget;
- metrics;
- token refresh coordination;
- request dedupe;
- special handling `401`.

Itu akan masuk lebih dalam di Part 031 tentang frontend HTTP client architecture.

---

## 16. Mutation Reliability: Outcome Unknown Problem

Masalah tersulit bukan retry `GET`. Masalah tersulit adalah mutation ketika client tidak tahu server sudah memproses atau belum.

Scenario:

```text
1. User klik "Submit Order".
2. Browser mengirim POST /orders.
3. Server menerima request.
4. Server membuat order.
5. Response hilang karena network putus.
6. Browser timeout.
7. UI menampilkan "failed".
8. User klik lagi.
```

Tanpa idempotency, hasilnya bisa double order.

Solusi arsitektural:

### 16.1 Idempotency Key

Frontend membuat key stabil per user intent:

```js
const idempotencyKey = crypto.randomUUID();

await fetch('/api/orders', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Idempotency-Key': idempotencyKey
  },
  body: JSON.stringify(orderDraft)
});
```

Backend menyimpan mapping:

```text
(idempotency_key, user_id, endpoint, request_hash) → outcome
```

Jika request yang sama datang lagi:

- jika masih processing: return pending/conflict sesuai desain;
- jika sudah selesai: return outcome yang sama;
- jika payload berbeda dengan key sama: reject.

### 16.2 Status Resource

Untuk operasi panjang:

```http
POST /api/orders
Idempotency-Key: abc
→ 202 Accepted
Location: /api/operations/op_123
```

Frontend kemudian:

```http
GET /api/operations/op_123
```

### 16.3 Reconciliation

Setelah timeout, frontend jangan langsung menyatakan “gagal” untuk mutation penting.

Lebih tepat:

```text
We are checking whether your order was created...
```

Lalu query by idempotency key atau client reference id.

---

## 17. Duplicate Submit dan Double Click

Double click bukan edge case; itu normal user behavior.

Layer mitigasi:

1. disable submit button saat request in-flight;
2. gunakan client-side in-flight guard;
3. gunakan idempotency key untuk server-side correctness;
4. tampilkan progress state;
5. jangan mengandalkan frontend saja.

Contoh frontend guard:

```js
let submitting = false;

async function submitOrder(order) {
  if (submitting) return;
  submitting = true;

  try {
    await createOrder(order);
  } finally {
    submitting = false;
  }
}
```

Ini membantu UX, tetapi bukan guarantee. User bisa refresh, membuka tab lain, atau request bisa dikirim ulang oleh layer lain.

Guarantee harus ada di backend melalui idempotency atau uniqueness constraint.

---

## 18. Request Deduplication

Deduplication menghindari request identik berjalan paralel.

Contoh masalah:

```text
Navbar loads current user
Page loads current user
Sidebar loads current user
All call GET /me at the same time
```

Deduping pattern:

```js
const inFlight = new Map();

function dedupeKey(url, options = {}) {
  return `${options.method ?? 'GET'} ${url}`;
}

async function dedupedFetch(url, options = {}) {
  const key = dedupeKey(url, options);

  if (inFlight.has(key)) {
    return inFlight.get(key).then(response => response.clone());
  }

  const promise = fetch(url, options).finally(() => {
    inFlight.delete(key);
  });

  inFlight.set(key, promise);

  const response = await promise;
  return response.clone();
}
```

Catatan penting:

- `Response` body hanya bisa dibaca sekali, sehingga perlu `clone()` jika dibagi.
- Deduping cocok untuk `GET` read-only.
- Jangan dedupe mutation hanya berdasarkan URL.
- Query library seperti TanStack Query/SWR biasanya menangani ini lebih matang.

---

## 19. Race Condition: Stale Response Wins

Race condition umum:

### 19.1 Route change race

```text
User buka /users/1
Request user 1 berjalan
User pindah ke /users/2
Request user 2 selesai
Request user 1 selesai belakangan
UI menampilkan user 1 di route /users/2
```

Mitigasi:

- abort on route change;
- sequence guard;
- state keyed by resource ID;
- query cache keyed by parameter.

### 19.2 Search race

Mitigasi:

- debounce input;
- abort previous request;
- ignore stale response;
- tampilkan loading per query, bukan global.

### 19.3 Save race

```text
Autosave version A sent
Autosave version B sent
B saved first
A saved later and overwrites B
```

Mitigasi:

- serialize saves;
- version/ETag precondition;
- server-side optimistic locking;
- discard older save;
- design autosave as patch with revision.

### 19.4 Token refresh race

```text
5 API calls get 401
All trigger refresh token
Refresh token rotation invalidates previous token
Some calls fail unpredictably
```

Mitigasi:

- single-flight refresh;
- queue pending calls;
- refresh token rotation aware;
- global auth state machine;
- clear session deterministically on refresh failure.

---

## 20. Polling Reliability

Polling tampak sederhana, tetapi bisa berbahaya.

Naive polling:

```js
setInterval(async () => {
  await fetch('/api/notifications');
}, 1000);
```

Masalah:

- request bisa overlap jika response > interval;
- tetap berjalan saat tab background;
- tetap berjalan saat user offline;
- tidak backoff saat error;
- memperparah backend overload;
- tidak hormati `429`/`Retry-After`.

Pattern lebih aman:

```js
async function poll({ signal }) {
  let delayMs = 5000;

  while (!signal.aborted) {
    const started = Date.now();

    try {
      const response = await fetch('/api/notifications', { signal });

      if (response.status === 429 || response.status === 503) {
        const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
        delayMs = retryAfter ?? Math.min(delayMs * 2, 60_000);
      } else if (response.ok) {
        const data = await response.json();
        renderNotifications(data);
        delayMs = 5000;
      } else {
        delayMs = Math.min(delayMs * 2, 60_000);
      }
    } catch (error) {
      if (error.name === 'AbortError') return;
      delayMs = Math.min(delayMs * 2, 60_000);
    }

    const elapsed = Date.now() - started;
    await sleep(Math.max(0, delayMs - elapsed), signal);
  }
}
```

Lebih baik lagi:

- pause saat document hidden;
- gunakan SSE/WebSocket jika realtime lebih cocok;
- gunakan server-provided polling interval;
- gunakan cache validator/ETag;
- kurangi interval saat error.

---

## 21. Rate Limit dari Perspektif Frontend

`429 Too Many Requests` berarti client mengirim terlalu banyak request dalam window tertentu.

Rate limit bisa berbasis:

- IP;
- user;
- API key;
- session;
- endpoint;
- tenant;
- organization;
- global service health.

Frontend perlu memikirkan:

1. apakah limit dipicu user action atau background activity;
2. apakah retry akan membantu atau memperburuk;
3. apakah ada `Retry-After`;
4. apakah perlu men-disable action sementara;
5. apakah tab lain juga melakukan request;
6. apakah service worker/background sync ikut memicu request;
7. apakah polling terlalu agresif.

UI untuk `429`:

- untuk action user: jelaskan harus menunggu;
- untuk background: silent backoff;
- untuk search/typeahead: throttle/debounce;
- untuk upload/import: tampilkan retry schedule atau manual retry;
- untuk tenant quota: arahkan ke admin/billing jika relevan.

Anti-pattern:

```text
429 received → immediately retry → 429 → retry → 429 → retry
```

Itu bukan resilience. Itu denial-of-service terhadap diri sendiri.

---

## 22. Circuit Breaker dari Perspektif Frontend

Circuit breaker di frontend bukan selalu sama dengan backend circuit breaker, tetapi ide dasarnya sama:

> Jika endpoint sedang gagal berat, berhenti memukulnya untuk sementara.

State:

```text
CLOSED → normal request
OPEN → fail fast / show degraded UI
HALF_OPEN → coba request terbatas untuk recovery
```

Contoh penggunaan:

- dashboard widget yang memanggil endpoint error terus;
- background refresh yang gagal massal;
- analytics endpoint down;
- notification polling overload;
- feature optional yang tidak boleh merusak app utama.

Frontend circuit breaker harus hati-hati:

- jangan fail-fast untuk operasi kritikal tanpa fallback;
- jangan menyembunyikan recovery terlalu lama;
- jangan membuat state per component saja kalau traffic global yang perlu dikurangi;
- jangan buka circuit karena abort user yang normal.

Pseudo model:

```js
const breaker = {
  state: 'CLOSED',
  failureCount: 0,
  openedAt: null
};

function canRequest() {
  if (breaker.state === 'CLOSED') return true;

  if (breaker.state === 'OPEN' && Date.now() - breaker.openedAt > 30_000) {
    breaker.state = 'HALF_OPEN';
    return true;
  }

  return breaker.state === 'HALF_OPEN';
}
```

Dalam banyak aplikasi, query library + retry/backoff + feature-level fallback sudah cukup. Jangan membuat circuit breaker kompleks kecuali ada kebutuhan nyata.

---

## 23. Offline Strategy untuk Read dan Mutation

Offline strategy berbeda untuk read dan write.

### Read

Untuk read, fallback bisa berupa:

- cached data;
- stale data dengan label;
- skeleton lalu retry;
- offline page;
- manual refresh.

UI harus jujur:

```text
Showing last updated data from 10:32. You appear to be offline.
```

Jangan menampilkan stale data sebagai seolah-olah fresh jika keputusan user berisiko.

### Mutation

Offline mutation jauh lebih sulit.

Aman jika:

- operasi idempotent;
- ada client-generated id;
- konflik bisa diselesaikan;
- ordering jelas;
- user paham status pending;
- backend bisa menerima replay;
- audit trail jelas.

Berbahaya untuk:

- payment;
- legal submission;
- irreversible action;
- operation dengan external side effect;
- domain dengan strict ordering.

Pattern:

```text
PENDING_LOCAL → QUEUED → SENDING → CONFIRMED
                       ↘ FAILED_RETRYABLE
                       ↘ FAILED_CONFLICT
                       ↘ FAILED_PERMANENT
```

Untuk regulatory/case-management style system, offline mutation harus sangat hati-hati karena auditability dan legal defensibility sering lebih penting daripada convenience.

---

## 24. UI State Machine untuk Request

Jangan hanya pakai boolean:

```js
isLoading = true/false
```

Itu terlalu miskin.

State minimal:

```text
idle
loading
success
empty
http_error
network_error
timeout
aborted
retrying
rate_limited
offline
stale
conflict
unauthorized
forbidden
```

Untuk mutation:

```text
idle
validating
submitting
submitted
unknown_outcome
reconciling
success
validation_failed
conflict
retryable_failure
permanent_failure
cancelled
```

Contoh reducer:

```js
const initialState = {
  status: 'idle',
  data: null,
  error: null,
  attempt: 0,
  lastUpdatedAt: null
};

function requestReducer(state, event) {
  switch (event.type) {
    case 'START':
      return { ...state, status: 'loading', error: null, attempt: 0 };
    case 'RETRY':
      return { ...state, status: 'retrying', attempt: state.attempt + 1 };
    case 'SUCCESS':
      return { ...state, status: 'success', data: event.data, lastUpdatedAt: Date.now() };
    case 'RATE_LIMITED':
      return { ...state, status: 'rate_limited', retryAt: event.retryAt };
    case 'TIMEOUT':
      return { ...state, status: 'timeout', error: event.error };
    case 'NETWORK_ERROR':
      return { ...state, status: 'network_error', error: event.error };
    case 'HTTP_ERROR':
      return { ...state, status: 'http_error', error: event.error };
    case 'ABORT':
      return { ...state, status: 'aborted' };
    default:
      return state;
  }
}
```

State machine yang baik membantu:

- UI konsisten;
- retry policy eksplisit;
- observability lebih tajam;
- testing lebih mudah;
- edge case lebih terlihat.

---

## 25. Auth Reliability: Jangan Retry `401` secara Naif

`401` sering berarti access token/session expired.

Naive approach:

```text
Request gets 401
Refresh token
Retry request
```

Masalah:

- banyak request paralel bisa memicu banyak refresh;
- refresh token rotation bisa membuat token lama invalid;
- refresh endpoint sendiri bisa gagal;
- retry mutation setelah refresh bisa menggandakan side effect jika request pertama sebenarnya diproses;
- user logout di tab lain;
- session revoked server-side.

Pattern lebih aman:

1. single-flight refresh: hanya satu refresh berjalan;
2. request lain menunggu hasil refresh;
3. jika refresh sukses, retry request yang aman;
4. jika refresh gagal, transisi global ke unauthenticated;
5. jangan retry mutation non-idempotent tanpa domain guarantee;
6. observability bedakan auth expiry normal vs refresh failure incident.

Pseudo:

```js
let refreshPromise = null;

async function refreshOnce() {
  if (!refreshPromise) {
    refreshPromise = refreshSession().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}
```

---

## 26. Observability untuk Reliability

Reliability tanpa observability hanya tebakan.

Minimal capture:

- URL pattern, bukan full URL sensitif;
- method;
- status code;
- error category;
- attempt count;
- timeout duration;
- request duration;
- whether aborted intentionally;
- retry delay;
- final outcome;
- correlation/trace ID;
- user action context;
- page/route;
- online/offline hint;
- browser/device class;
- response headers penting seperti `Retry-After`;
- whether served from service worker/cache jika bisa diketahui.

Jangan log:

- token;
- cookie;
- full PII payload;
- authorization header;
- sensitive query string;
- raw error body yang bisa berisi data user.

Kategori error yang lebih berguna:

```text
network_failure
http_4xx_validation
http_401_auth_expired
http_403_forbidden
http_409_conflict
http_429_rate_limited
http_5xx_server
timeout
abort_user_intent
abort_navigation
parse_error
stale_response_ignored
```

Abort karena user mengetik ulang search tidak boleh menaikkan error rate production.

---

## 27. Checklist: Apakah Request Ini Boleh Di-Retry?

Sebelum menambahkan retry, jawab:

1. Apakah operasi safe/idempotent?
2. Jika mutation, apakah ada idempotency key?
3. Jika timeout, apakah outcome server unknown?
4. Apakah response status retriable?
5. Apakah server memberi `Retry-After`?
6. Apakah user masih berada di konteks yang sama?
7. Apakah request lama masih relevan?
8. Apakah retry akan memperparah rate limit?
9. Apakah ada max attempt dan max elapsed time?
10. Apakah retry bisa dibatalkan?
11. Apakah retry tercatat di observability?
12. Apakah UI memberi feedback yang sesuai?
13. Apakah ada global retry budget?
14. Apakah request berasal dari background polling?
15. Apakah ada multiple tabs yang mungkin melakukan hal sama?

Kalau Anda tidak bisa menjawab sebagian besar, retry otomatis kemungkinan terlalu dini.

---

## 28. Checklist: Timeout yang Sehat

Untuk setiap endpoint penting:

- Apakah frontend punya timeout eksplisit?
- Apakah timeout sesuai operation type?
- Apakah timeout lebih pendek dari gateway timeout?
- Apakah mutation timeout diperlakukan sebagai unknown outcome?
- Apakah user mendapat feedback sebelum timeout?
- Apakah request bisa dibatalkan saat route berubah?
- Apakah timeout dibedakan dari manual abort?
- Apakah timeout rate dimonitor?
- Apakah ada trace/correlation ID untuk timeout?
- Apakah long-running operation memakai async job/status resource?

---

## 29. Checklist: Cancellation yang Benar

- Abort request saat component/route tidak lagi membutuhkan data.
- Ignore response yang sudah stale.
- Jangan report intentional abort sebagai error fatal.
- Pastikan loading state tidak stuck saat abort.
- Jangan abort mutation penting tanpa desain server cancellation/reconciliation.
- Gunakan sequence guard untuk race yang tidak bisa dijamin oleh abort.
- Bersihkan timer dan listener.
- Pastikan retry sleep juga abortable.

---

## 30. Pattern Decision Table

| Scenario | Recommended behavior |
|---|---|
| GET detail gagal network | retry terbatas + backoff, lalu show retry UI |
| GET search saat user mengetik lagi | abort request lama, ignore stale response |
| POST create order timeout | jangan retry buta; reconcile via idempotency/status |
| POST payment 504 | outcome unknown; query status/reconcile |
| 401 access token expired | single-flight refresh, lalu retry safe requests |
| 403 | jangan retry; show permission issue |
| 409 conflict | fetch latest, minta user resolve/merge |
| 429 | hormati `Retry-After`, throttle UI/background |
| 503 dengan Retry-After | backoff sampai jadwal server |
| Polling error terus | exponential backoff, pause hidden/offline |
| Component unmount | abort/ignore response |
| Upload besar | progress + resumable jika domain mendukung |
| Offline read | show stale cached data dengan label |
| Offline mutation | queue hanya jika idempotent dan conflict model jelas |

---

## 31. Reliability Anti-Patterns

### 31.1 Retry semua error

```js
catch (e) {
  retry();
}
```

Masalah: validation error, auth error, conflict, dan forbidden tidak hilang dengan retry.

### 31.2 Retry mutation tanpa idempotency

Berbahaya untuk payment, order, submission, approval, case action.

### 31.3 Timeout tanpa reconciliation

Menampilkan “failed” untuk mutation timeout bisa salah. Lebih tepat “outcome unknown” untuk operasi kritikal.

### 31.4 Tidak membatalkan request lama

Menyebabkan stale UI dan race condition.

### 31.5 Polling dengan `setInterval` buta

Menyebabkan overlap, overload, dan background traffic tidak terkendali.

### 31.6 Menganggap `navigator.onLine` sumber kebenaran

Itu hint, bukan guarantee.

### 31.7 Melaporkan abort sebagai production error

Membuat error monitoring penuh noise.

### 31.8 Mengabaikan `Retry-After`

Tidak sopan terhadap server dan bisa memperparah rate limit.

### 31.9 Tidak membedakan timeout vs network error

Keduanya punya UX dan diagnosis berbeda.

### 31.10 Tidak memberi retry manual

Kadang retry otomatis tidak cukup; user perlu tombol “Try again” yang jelas.

---

## 32. Example: Request State Machine untuk Search

Search typeahead constraints:

- request lama tidak relevan setelah query berubah;
- tidak perlu retry agresif;
- user bisa mengetik cepat;
- response stale harus diabaikan;
- error tidak boleh mengganggu seluruh page.

State:

```text
idle
waiting_debounce
loading
success
empty
network_error
stale_ignored
```

Policy:

- debounce 200–300ms;
- abort previous request;
- max one in-flight per query input;
- no retry for every keystroke;
- maybe retry manual if final query fails;
- ignore stale response.

Pseudo:

```js
let controller;
let seq = 0;

async function search(q) {
  const mySeq = ++seq;

  controller?.abort();
  controller = new AbortController();

  setState({ status: 'loading', q });

  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
      signal: controller.signal
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();

    if (mySeq !== seq) return;

    setState({
      status: data.items.length ? 'success' : 'empty',
      data
    });
  } catch (err) {
    if (err.name === 'AbortError') return;
    if (mySeq !== seq) return;

    setState({ status: 'network_error', error: err });
  }
}
```

---

## 33. Example: Request State Machine untuk Submit Order

Submit order constraints:

- mutation punya side effect;
- duplicate submit berbahaya;
- timeout outcome unknown;
- retry perlu idempotency key;
- user harus tahu status sebenarnya;
- backend harus mendukung reconciliation.

State:

```text
idle
submitting
unknown_outcome
reconciling
success
validation_failed
payment_action_required
conflict
retryable_failure
permanent_failure
```

Policy:

- generate idempotency key per submit intent;
- disable button saat in-flight;
- timeout masuk `unknown_outcome`;
- reconcile by idempotency key;
- retry hanya jika backend idempotent;
- show support/correlation ID jika final unknown.

Pseudo:

```js
async function submitOrder(order) {
  const idempotencyKey = crypto.randomUUID();

  dispatch({ type: 'SUBMITTING' });

  try {
    const response = await fetchWithTimeout('/api/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey
      },
      body: JSON.stringify(order),
      idempotent: true,
      timeoutMs: 12_000
    });

    if (response.status === 201) {
      dispatch({ type: 'SUCCESS', order: await response.json() });
      return;
    }

    if (response.status === 202) {
      const operationUrl = response.headers.get('location');
      dispatch({ type: 'RECONCILING' });
      await pollOperation(operationUrl);
      return;
    }

    handleOrderError(response);
  } catch (error) {
    if (error.name === 'TimeoutError') {
      dispatch({ type: 'UNKNOWN_OUTCOME' });
      await reconcileOrderByIdempotencyKey(idempotencyKey);
      return;
    }

    dispatch({ type: 'RETRYABLE_FAILURE', error });
  }
}
```

---

## 34. Example: Background Refresh

Background refresh constraints:

- user tidak selalu menunggu;
- stale data bisa tetap ditampilkan;
- failure tidak perlu toast setiap kali;
- jangan mengganggu foreground task;
- jangan overload backend.

Policy:

- retry silent terbatas;
- backoff saat gagal;
- pause saat offline;
- pause atau slow down saat tab hidden;
- show stale indicator jika data terlalu lama;
- do not clear existing data on refresh failure.

Rule penting:

> Background refresh failure tidak boleh menghapus data yang masih valid secara UI. Failure memperbarui freshness metadata, bukan menghancurkan state.

---

## 35. Reliability untuk Multi-Tab

Browser app sering berjalan di banyak tab.

Masalah:

- multiple tabs refresh token bersamaan;
- multiple tabs polling endpoint sama;
- logout di satu tab tidak diketahui tab lain;
- rate limit dibagi per user/session;
- offline queue replay ganda;
- notification read/unread race.

Tools/pattern:

- `BroadcastChannel` untuk koordinasi tab;
- `localStorage` event untuk fallback;
- service worker sebagai coordination layer;
- server-side idempotency;
- query cache per tab dengan conservative polling;
- refresh token single-flight per tab plus server tolerance.

Contoh logout propagation:

```js
const channel = new BroadcastChannel('auth');

function logout() {
  clearSession();
  channel.postMessage({ type: 'LOGOUT' });
}

channel.onmessage = (event) => {
  if (event.data?.type === 'LOGOUT') {
    clearSession();
    redirectToLogin();
  }
};
```

---

## 36. Reliability dan Accessibility

Reliability bukan hanya network mechanics. UI harus memberi feedback yang bisa dipahami semua user.

Praktik:

- loading state jelas;
- retry button bisa diakses keyboard;
- error message tidak hanya warna merah;
- status update penting pakai ARIA live region jika relevan;
- jangan membuat spinner tanpa batas;
- jangan reset form input setelah network error;
- simpan draft user sebelum retry;
- jelaskan apakah action berhasil, gagal, atau masih dicek.

Untuk mutation penting, hindari pesan ambigu:

```text
Something went wrong.
```

Lebih baik:

```text
We could not confirm whether the order was created. We are checking its status now.
```

Atau:

```text
Your changes were not saved because the connection was lost. Your draft is still on this page.
```

---

## 37. Reliability Review Rubric

Saat review PR frontend HTTP/client code, tanyakan:

### Semantics

- Apakah method sesuai intent?
- Apakah mutation idempotent jika di-retry?
- Apakah timeout outcome ditangani benar?
- Apakah conflict diperlakukan sebagai conflict, bukan generic error?

### Lifecycle

- Apakah request dibatalkan saat tidak relevan?
- Apakah response stale bisa menang?
- Apakah loading state bisa stuck?
- Apakah component unmount aman?

### Retry

- Apakah retry punya limit?
- Apakah ada backoff+jitter?
- Apakah `Retry-After` dihormati?
- Apakah retry berhenti saat abort/offline/user intent berubah?

### UI

- Apakah user tahu apa yang terjadi?
- Apakah ada retry manual?
- Apakah data lama diberi label stale?
- Apakah form input hilang saat error?

### Observability

- Apakah attempt count tercatat?
- Apakah timeout, abort, network error, HTTP error dibedakan?
- Apakah trace/correlation ID dipropagasikan?
- Apakah PII tidak bocor ke log?

### Backend contract

- Apakah endpoint mendukung idempotency?
- Apakah rate limit mengirim `Retry-After`?
- Apakah long-running operation punya status resource?
- Apakah error envelope memberi retryability/actionability?

---

## 38. Latihan Praktis

### Latihan 1 — Classify Failure

Untuk setiap kasus, klasifikasikan sebagai network error, HTTP error, application error, timeout, abort, stale response, atau unknown outcome:

1. `fetch()` reject karena `TypeError: Failed to fetch`.
2. Response `500` diterima.
3. Response `200` dengan `{ "status": "FAILED_VALIDATION" }`.
4. User pindah route sebelum response tiba.
5. POST payment timeout setelah 10 detik.
6. Response search query lama tiba setelah query baru.
7. Response `429` dengan `Retry-After: 60`.
8. CORS error di browser, tetapi Postman berhasil.

### Latihan 2 — Design Retry Policy

Buat retry policy untuk:

1. `GET /api/products?query=abc`
2. `POST /api/orders`
3. `PUT /api/profile`
4. `GET /api/notifications` polling
5. `POST /api/uploads/{id}/chunks`

Untuk masing-masing tentukan:

- retriable atau tidak;
- max attempts;
- timeout;
- backoff;
- apakah butuh idempotency key;
- UI state;
- observability fields.

### Latihan 3 — Fix Race Condition

Diberikan kode:

```js
async function loadUser(id) {
  setLoading(true);
  const res = await fetch(`/api/users/${id}`);
  const user = await res.json();
  setUser(user);
  setLoading(false);
}
```

Perbaiki agar aman terhadap:

- route change;
- request lama selesai belakangan;
- HTTP error;
- network error;
- abort;
- loading state stuck.

---

## 39. Ringkasan Mental Model

Reliability frontend bukan sekadar menambahkan retry.

Model yang benar:

```text
User intent
  ↓
Request lifecycle
  ↓
HTTP/browser/network outcome
  ↓
Retry/cancel/reconcile decision
  ↓
UI state transition
  ↓
Observability event
```

Prinsip utama:

1. Bedakan network error, HTTP error, application error, timeout, abort, dan stale response.
2. Retry hanya jika semantic operation aman.
3. Timeout pada mutation berarti outcome unknown.
4. Cancellation menjaga intent terbaru.
5. Backoff tanpa jitter bisa membuat retry herd.
6. `Retry-After` adalah sinyal server yang harus dihormati.
7. Polling harus adaptif, tidak buta.
8. Abort intentional bukan production error.
9. Request state sebaiknya state machine, bukan satu boolean `loading`.
10. Observability harus mencatat kategori failure dan attempt, bukan hanya “API failed”.

---

## 40. Referensi Utama

- RFC 9110 — HTTP Semantics: status code, method semantics, `Retry-After`, dan HTTP metadata.
- RFC 6585 — Additional HTTP Status Codes, termasuk `429 Too Many Requests`.
- MDN — Fetch API, AbortController, AbortSignal, HTTP status code, `Retry-After`.
- web.dev — Fetch API error handling.
- WHATWG Fetch Standard — model fetch browser, network error, abort, request/response lifecycle.
- Prior parts dalam seri ini:
  - Part 004: HTTP methods, safety, idempotency.
  - Part 005: status code interpretation.
  - Part 008: Fetch API mental model.
  - Part 024: mutation design, idempotency, concurrency.
  - Part 025: error contract.
  - Part 028: observability.
  - Part 029: performance engineering.

---

## 41. Posisi Kita dalam Seri

Kita sudah menyelesaikan:

- Part 000 — Foundation
- Part 001 — Browser HTTP orientation
- Part 002 — URL, origin, site
- Part 003 — HTTP message model
- Part 004 — HTTP methods
- Part 005 — status codes
- Part 006 — headers
- Part 007 — body/media type/encoding
- Part 008 — Fetch API
- Part 009 — non-fetch requests
- Part 010 — CORS part 1
- Part 011 — CORS part 2
- Part 012 — cookies part 1
- Part 013 — cookies/auth/CSRF
- Part 014 — caching mental model
- Part 015 — ETag/revalidation/304
- Part 016 — redirects
- Part 017 — content negotiation
- Part 018 — resource loading
- Part 019 — HTTP/1.1, HTTP/2, HTTP/3
- Part 020 — TLS/HTTPS
- Part 021 — security headers
- Part 022 — browser isolation policies
- Part 023 — API design for frontend
- Part 024 — mutation design
- Part 025 — error contract design
- Part 026 — streaming/SSE/WebSocket/WebTransport
- Part 027 — service workers/offline/request interception
- Part 028 — observability
- Part 029 — performance engineering
- Part 030 — reliability

Seri belum selesai.

Bagian berikutnya:

```text
Part 031 — Frontend HTTP Client Architecture
```

Di sana kita akan menggabungkan semua konsep sebelumnya menjadi desain HTTP client layer yang production-grade: base URL, auth, credentials, timeout, retry, cancellation, error normalization, interceptors, generated clients, runtime validation, query layer, dedupe, upload/download, testing, dan anti-pattern arsitektural.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-http-for-web-frontend-perspective-part-029.md">⬅️ Part 029 — Performance Engineering: Latency, Payload, Critical Path, and CDN Strategy</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-http-for-web-frontend-perspective-part-031.md">Part 031 — Frontend HTTP Client Architecture ➡️</a>
</div>
