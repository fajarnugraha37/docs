# learn-http-for-web-frontend-perspective-part-028.md

# Part 028 — Observability: Network Debugging, Correlation, Tracing, and RUM

> Seri: `learn-http-for-web-frontend-perspective`  
> Perspektif: Java software engineer yang ingin memahami HTTP dari sisi browser/frontend secara top-tier  
> Status: Part 028 dari 035  
> Prasyarat langsung: Part 001–027, terutama HTTP message model, headers, caching, redirects, CORS, fetch, resource loading, security headers, dan service worker

---

## 0. Tujuan Bagian Ini

Di bagian-bagian sebelumnya, kita sudah membangun mental model HTTP dari sisi browser: URL, origin, request/response, headers, body, method, status, CORS, cookies, caching, redirect, resource loading, transport, TLS, security policy, API design, mutation, error contract, streaming, dan service worker.

Sekarang kita masuk ke pertanyaan yang sangat praktis:

> Ketika sesuatu lambat, gagal, random, hanya terjadi di production, hanya terjadi untuk user tertentu, hanya terjadi di browser tertentu, atau tidak bisa direproduksi secara lokal — bagaimana kita membuktikan apa yang sebenarnya terjadi?

Observability frontend HTTP bukan sekadar “lihat console”. Ia adalah kemampuan untuk menghubungkan:

```text
User action
  -> browser state
  -> request intent
  -> browser policy
  -> cache decision
  -> service worker decision
  -> network timing
  -> CDN / proxy / gateway behavior
  -> backend timing
  -> distributed trace
  -> response semantics
  -> frontend state transition
  -> user-visible outcome
```

Tanpa observability, engineer hanya menebak. Dengan observability, engineer dapat membedakan:

- UI lambat karena JavaScript main thread blocked;
- API lambat karena server lambat;
- API terlihat lambat karena browser queueing/stalled;
- request tidak sampai server karena CORS/preflight;
- request tidak keluar karena service worker/cache;
- response cepat tapi parsing/rendering lambat;
- TTFB tinggi karena CDN miss atau origin cold path;
- hanya user tertentu gagal karena cookie, auth, region, network, corporate proxy, atau cache partitioning;
- error backend tidak bisa dikorelasikan karena trace/correlation ID hilang.

Bagian ini bertujuan membuat Anda mampu membaca evidence HTTP seperti investigator sistem produksi.

---

## 1. Core Mental Model: Observability adalah Evidence Pipeline

Observability sering dibahas sebagai logs, metrics, traces. Untuk frontend HTTP, definisi operasional yang lebih tajam adalah:

> Observability adalah kemampuan untuk menjawab “apa yang terjadi, di mana, kapan, untuk siapa, akibat apa, dan buktinya apa” tanpa harus menebak dari gejala UI saja.

Dalam frontend HTTP, evidence tersebar di beberapa lapisan:

```text
Browser UI layer
  - user action
  - route
  - component state
  - error boundary
  - loading state
  - retry state

JavaScript HTTP layer
  - request config
  - method/url/header/body
  - timeout/abort/retry
  - response status/body/error envelope

Browser network layer
  - DevTools Network
  - request/response headers
  - timing waterfall
  - initiator
  - priority
  - cache/service worker indicators

Browser performance layer
  - Resource Timing API
  - Navigation Timing API
  - Server-Timing exposure
  - Long Tasks
  - Core Web Vitals

Edge/backend layer
  - CDN logs
  - gateway logs
  - application logs
  - DB/cache timings
  - distributed traces

Business/product layer
  - operation ID
  - user/session/tenant
  - workflow state
  - domain event
  - audit trail
```

Top 1% engineer tidak hanya melihat satu layer. Mereka menghubungkan semua layer dengan identifier yang stabil.

---

## 2. Observability vs Debugging vs Monitoring

Ketiganya berbeda.

### 2.1 Debugging

Debugging adalah aktivitas investigasi lokal atau spesifik:

```text
Symptom: request /api/orders gagal
Action: buka DevTools, lihat status, header, timing, response body
Goal: menemukan root cause kasus ini
```

Debugging biasanya manual dan event-driven.

### 2.2 Monitoring

Monitoring adalah pengukuran sistem secara terus-menerus terhadap signal yang sudah diketahui:

```text
- error rate naik
- p95 API latency naik
- LCP memburuk
- 5xx gateway naik
- checkout failure rate naik
```

Monitoring menjawab: “Apakah sistem sehat menurut indikator yang sudah kita tentukan?”

### 2.3 Observability

Observability menjawab pertanyaan yang belum tentu sudah diprediksi:

```text
- Kenapa hanya Safari user yang gagal login?
- Kenapa API cepat di backend trace tapi lambat di browser?
- Kenapa hanya tenant A mengalami stale data?
- Kenapa request tidak muncul di backend logs?
- Kenapa error meningkat setelah deploy frontend, padahal backend tidak berubah?
```

Observability membutuhkan struktur data yang cukup kaya untuk investigasi ad-hoc.

---

## 3. First Principle: “Slow API” Belum Tentu Server Lambat

Ketika user berkata:

```text
Halaman lambat karena API lambat.
```

Jangan langsung percaya. Dari sisi browser, waktu yang terlihat sebagai “API lambat” bisa berasal dari banyak tempat:

```text
User clicks button
  -> frontend waits before sending request
  -> request queued/stalled by browser
  -> DNS lookup
  -> TCP connect
  -> TLS handshake
  -> proxy/CDN routing
  -> request upload
  -> backend queue
  -> backend processing
  -> database/cache dependency
  -> response headers generated
  -> response body download
  -> decompression
  -> JSON parsing
  -> state update
  -> rendering
  -> layout/paint
```

Jadi pertanyaan yang benar bukan:

```text
Apakah API lambat?
```

Tapi:

```text
Di fase mana waktu habis?
```

Itu inti observability HTTP frontend.

---

## 4. DevTools Network: Sumber Bukti Pertama

Browser DevTools Network adalah alat diagnosis paling penting untuk HTTP frontend. Tapi banyak engineer membacanya hanya sebagai daftar request. Itu terlalu dangkal.

Network tab harus dibaca sebagai timeline sistem:

```text
- request apa yang dibuat?
- siapa initiator-nya?
- kapan request mulai?
- apakah request benar-benar keluar ke network?
- apakah diambil dari memory/disk cache/service worker?
- apakah kena redirect?
- apakah ada preflight?
- apakah credentials terkirim?
- apakah response readable oleh JavaScript?
- berapa status HTTP-nya?
- berapa TTFB?
- berapa download time?
- apakah response body sesuai kontrak?
- apakah header yang dibutuhkan tersedia?
- apakah request berulang tidak perlu?
```

### 4.1 Kolom yang Harus Diperhatikan

Di DevTools Network, kolom-kolom penting biasanya meliputi:

| Kolom | Makna Praktis |
|---|---|
| Name | Resource/request target |
| Status | HTTP outcome atau browser/internal status |
| Type | document, fetch, xhr, script, css, img, font, preflight, etc. |
| Initiator | Siapa yang memicu request |
| Size | Ukuran transfer atau cache indicator |
| Time | Total waktu request menurut browser |
| Waterfall | Distribusi waktu dan urutan relatif request |
| Priority | Prioritas loading menurut browser |
| Method | GET/POST/OPTIONS/etc. |
| Domain/Remote Address | Origin/server yang dihubungi |

Kolom `Initiator` sering sangat penting. Misalnya:

```text
- Request API dipicu oleh component effect?
- Request image dipicu oleh HTML parser?
- Request script dipicu oleh preload scanner?
- Request duplicate dipicu oleh React StrictMode/dev behavior?
- Request ulang dipicu oleh retry library?
- Request dipicu service worker?
```

Tanpa melihat initiator, Anda mudah salah menyalahkan backend.

---

## 5. Network Timing Breakdown

Timing breakdown adalah peta fase request.

Secara konseptual, sebuah request dapat melalui fase:

```text
Queueing / Stalled
DNS Lookup
Initial Connection
SSL / TLS
Request Sent
Waiting for Server Response (TTFB)
Content Download
```

Tidak semua fase muncul untuk setiap request. Jika koneksi sudah reuse, DNS/connect/TLS bisa nol atau sangat kecil. Jika cache digunakan, network phase bisa hilang.

### 5.1 Queueing / Stalled

`Queueing` atau `Stalled` berarti request belum aktif dikirim. Penyebab umum:

- browser menunda request karena prioritas resource;
- limit koneksi atau scheduling internal;
- request menunggu available socket/stream;
- request terpengaruh service worker;
- request menunggu proxy negotiation;
- request blocked oleh extension/security software;
- terlalu banyak resource dari origin yang sama;
- prioritas kalah dari resource critical lain.

Contoh diagnosis:

```text
Symptom:
API /search butuh 1.2s menurut Network tab.

Breakdown:
Stalled: 950ms
TTFB: 120ms
Download: 10ms

Conclusion:
Backend bukan penyebab utama. Request lama menunggu sebelum diproses jaringan.
```

### 5.2 DNS Lookup

DNS tinggi bisa berarti:

- origin baru;
- DNS resolver lambat;
- no preconnect/dns-prefetch untuk origin critical;
- network user bermasalah;
- corporate DNS/proxy;
- terlalu banyak origin berbeda.

Optimization path:

```html
<link rel="dns-prefetch" href="https://api.example.com">
<link rel="preconnect" href="https://api.example.com" crossorigin>
```

Tapi jangan overuse. Terlalu banyak preconnect dapat membuang resource.

### 5.3 Initial Connection

Connection time mencakup TCP connect untuk HTTP/1.1 atau HTTP/2 over TCP/TLS.

Tinggi di fase ini bisa berarti:

- user jauh dari edge;
- packet loss;
- origin tidak dekat secara geografis;
- koneksi baru terlalu sering dibuat;
- domain sharding berlebihan;
- tidak ada connection reuse;
- CDN/edge misconfiguration.

### 5.4 SSL/TLS

TLS tinggi bisa berarti:

- koneksi baru;
- handshake tidak reuse/resumed;
- certificate chain besar/bermasalah;
- corporate proxy/MITM;
- edge server lambat;
- HTTP/3 fallback/path negotiation issue.

Dari sisi frontend, yang bisa Anda kendalikan biasanya bukan TLS detail, tetapi:

- mengurangi jumlah origin critical;
- menggunakan preconnect secara selektif;
- memastikan HTTPS benar;
- menghindari redirect `http -> https` di critical path;
- berkoordinasi dengan infra/CDN.

### 5.5 Request Sent

Biasanya kecil untuk GET. Bisa besar untuk:

- upload file;
- body besar;
- multipart form;
- slow uplink mobile;
- retry upload;
- request body streaming.

Jika upload lambat, backend belum tentu melihat request lengkap dengan cepat.

### 5.6 Waiting / TTFB

TTFB atau time to first byte adalah waktu sampai byte pertama response diterima.

TTFB tinggi bisa berasal dari:

- backend processing;
- gateway queueing;
- CDN miss;
- cold start;
- auth middleware;
- database query;
- lock contention;
- origin shield;
- server-side rendering;
- streaming response yang tidak flush awal;
- network path latency.

Penting:

```text
TTFB tinggi bukan otomatis “database lambat”.
```

Ia hanya menunjukkan browser menunggu response pertama.

### 5.7 Content Download

Download tinggi berarti body transfer lama. Penyebab:

- payload besar;
- compression tidak aktif;
- image/video/font besar;
- slow network;
- streaming response;
- CDN tidak optimal;
- response tidak chunked padahal bisa;
- browser throttling/background tab.

Untuk API JSON, download tinggi sering mengindikasikan over-fetching.

---

## 6. HAR: Portable Evidence

HAR atau HTTP Archive adalah format untuk menyimpan detail network request dari browser.

HAR berguna untuk:

- membagikan bukti ke backend/infra/security team;
- menganalisis redirect chain;
- melihat header request/response;
- melihat timing breakdown;
- membandingkan environment;
- membuktikan cache behavior;
- mendokumentasikan incident.

Namun HAR bisa mengandung data sensitif:

```text
- cookies
- authorization headers
- tokens
- PII in URLs/query params
- response bodies
- internal hostnames
- session identifiers
```

Jangan sembarang mengirim HAR mentah ke channel publik. Sanitasi dulu.

### 6.1 Checklist Sanitasi HAR

Sebelum membagikan HAR:

```text
[ ] hapus Cookie header
[ ] hapus Set-Cookie response header
[ ] hapus Authorization header
[ ] hapus query params sensitif
[ ] hapus body dengan PII
[ ] hapus tokens di redirect URL
[ ] hapus internal hostname jika perlu
[ ] pertahankan timing/status/method/path secukupnya
```

Top-tier habit:

> Kirim HAR yang cukup untuk investigasi, bukan HAR yang membocorkan sesi user.

---

## 7. Resource Timing API

DevTools bagus untuk manual debugging. Tapi untuk production observability, kita butuh data dari real users.

Browser menyediakan Performance APIs. Salah satu yang sangat penting adalah Resource Timing API.

Resource Timing memungkinkan JavaScript mengambil timing detail untuk resource seperti:

- fetch/XHR;
- scripts;
- CSS;
- images;
- fonts;
- SVG;
- iframes;
- other resources.

Contoh sederhana:

```js
const entries = performance.getEntriesByType('resource');

for (const entry of entries) {
  console.log({
    name: entry.name,
    initiatorType: entry.initiatorType,
    duration: entry.duration,
    startTime: entry.startTime,
    dns: entry.domainLookupEnd - entry.domainLookupStart,
    connect: entry.connectEnd - entry.connectStart,
    tls: entry.secureConnectionStart > 0
      ? entry.connectEnd - entry.secureConnectionStart
      : 0,
    ttfb: entry.responseStart - entry.requestStart,
    download: entry.responseEnd - entry.responseStart,
    transferSize: entry.transferSize,
    encodedBodySize: entry.encodedBodySize,
    decodedBodySize: entry.decodedBodySize,
  });
}
```

### 7.1 Important Timing Fields

Conceptual fields:

```text
startTime
redirectStart / redirectEnd
fetchStart
domainLookupStart / domainLookupEnd
connectStart / connectEnd
secureConnectionStart
requestStart
responseStart
responseEnd
```

Derived metrics:

```js
const dns = entry.domainLookupEnd - entry.domainLookupStart;
const tcp = entry.connectEnd - entry.connectStart;
const tls = entry.secureConnectionStart > 0
  ? entry.connectEnd - entry.secureConnectionStart
  : 0;
const ttfb = entry.responseStart - entry.requestStart;
const download = entry.responseEnd - entry.responseStart;
const total = entry.duration;
```

### 7.2 Cache Indicators

Useful size fields:

```text
transferSize       bytes transferred over network, including headers/body metadata approximation
encodedBodySize    compressed body size
decodedBodySize    uncompressed body size
```

Common interpretation:

```text
transferSize > 0
  likely network transfer happened

transferSize = 0 and decodedBodySize > 0
  likely cache/local source, but details can vary by browser/privacy restrictions

encodedBodySize << decodedBodySize
  compression effective
```

Do not build brittle logic that assumes all browsers expose identical detail.

### 7.3 Cross-Origin Timing Restrictions

For cross-origin resources, browsers may hide detailed timing unless the server opts in using:

```http
Timing-Allow-Origin: https://app.example.com
```

or carefully:

```http
Timing-Allow-Origin: *
```

Do not expose sensitive timing accidentally. Timing can leak information. Use it intentionally.

### 7.4 Resource Timing Buffer

The browser does not keep infinite resource entries. High-traffic pages may exceed buffer limits.

You can observe entries as they arrive:

```js
const observer = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    if (entry.entryType === 'resource') {
      // send sanitized metrics to RUM pipeline
    }
  }
});

observer.observe({ type: 'resource', buffered: true });
```

Avoid sending every single resource unfiltered in large applications. Sample, aggregate, and whitelist important endpoints/resources.

---

## 8. Navigation Timing API

Navigation Timing focuses on page/document navigation.

It is useful for measuring:

- document request timing;
- redirects;
- DNS/connect/TLS;
- TTFB for HTML;
- DOMContentLoaded;
- load event;
- reload/back-forward/navigation type;
- server timing for navigation.

Example:

```js
const [nav] = performance.getEntriesByType('navigation');

if (nav) {
  const metrics = {
    type: nav.type,
    duration: nav.duration,
    redirect: nav.redirectEnd - nav.redirectStart,
    dns: nav.domainLookupEnd - nav.domainLookupStart,
    connect: nav.connectEnd - nav.connectStart,
    tls: nav.secureConnectionStart > 0
      ? nav.connectEnd - nav.secureConnectionStart
      : 0,
    ttfb: nav.responseStart - nav.requestStart,
    download: nav.responseEnd - nav.responseStart,
    domContentLoaded: nav.domContentLoadedEventEnd - nav.startTime,
    load: nav.loadEventEnd - nav.startTime,
  };

  console.log(metrics);
}
```

### 8.1 TTFB for Navigation

For navigation, TTFB is often measured as:

```js
const ttfb = nav.responseStart;
```

because `responseStart` is relative to navigation `startTime`.

But for detailed phase attribution, compare against `requestStart` too.

### 8.2 SPA Caveat

In SPA, initial navigation timing captures initial HTML load, not every route change.

For client-side route transitions, you need custom marks:

```js
performance.mark('route:/orders:start');

// after data loaded and main view committed
performance.mark('route:/orders:end');
performance.measure(
  'route:/orders',
  'route:/orders:start',
  'route:/orders:end'
);
```

A serious SPA observability model separates:

```text
initial document load
client-side route transition
API data load
component render/commit
user interaction latency
```

---

## 9. Server-Timing Header

`Server-Timing` lets backend expose timing metrics to the browser.

Example response:

```http
HTTP/1.1 200 OK
Content-Type: application/json
Server-Timing: app;dur=42, db;dur=18, cache;desc="miss", auth;dur=4
```

Browser DevTools can display these timings. JavaScript can also read them through Performance APIs when allowed.

Example:

```js
const entries = performance.getEntriesByName('https://api.example.com/orders');

for (const entry of entries) {
  console.log(entry.serverTiming);
}
```

### 9.1 Why Server-Timing Is Powerful

Without `Server-Timing`, frontend sees:

```text
TTFB = 900ms
```

With `Server-Timing`, frontend may see:

```text
TTFB = 900ms
Server-Timing:
  gateway = 20ms
  auth = 12ms
  app = 820ms
  db = 760ms
```

Now the conversation changes from:

```text
Frontend: API is slow.
Backend: Works on my machine.
```

to:

```text
The browser observed TTFB 900ms. Server-Timing shows db=760ms and app=820ms for trace abc123. Let's inspect backend trace.
```

That is the difference between complaint and evidence.

### 9.2 Server-Timing Design Guidelines

Expose useful stages:

```text
app
router
auth
cache
db
external
render
gateway
origin
```

Avoid exposing secrets:

```text
Bad:
Server-Timing: sql;desc="SELECT * FROM users WHERE email='alice@example.com'"

Good:
Server-Timing: db;dur=47
```

Use short names and stable semantics.

### 9.3 Cross-Origin Server-Timing

For JavaScript to access timing details cross-origin, the server may need:

```http
Timing-Allow-Origin: https://app.example.com
```

This should be deliberate. Timing data can become an information disclosure channel.

---

## 10. Correlation ID vs Trace ID

These are related but not identical.

### 10.1 Correlation ID

A correlation ID is an application-level identifier used to link logs/events related to the same request or operation.

Example:

```http
X-Request-ID: req_01JABCDEF...
X-Correlation-ID: corr_01JXYZ...
```

Common use:

```text
User reports error. UI shows support code corr_123.
Support searches logs by corr_123.
```

### 10.2 Trace ID

A trace ID belongs to distributed tracing. It represents a request path across services.

W3C Trace Context standardizes propagation using headers like:

```http
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
tracestate: vendor-specific-data
```

Conceptually:

```text
trace-id     identifies the distributed trace
span-id      identifies current operation/span
trace-flags  carries sampling/debug flags
```

### 10.3 Practical Difference

```text
Correlation ID:
  Often user/support/product friendly.
  Can cover multiple requests in one user operation.

Trace ID:
  Observability-system friendly.
  Usually one distributed request trace.
```

For frontend apps, you often want both:

```text
operationId / interactionId
  links all requests from one user action

requestId
  one HTTP request ID

traceparent
  distributed trace propagation
```

---

## 11. Designing IDs Across Frontend and Backend

A robust frontend HTTP observability design uses several identifiers.

### 11.1 Recommended Identifier Model

```text
session_id
  anonymous or authenticated browser session identifier
  privacy-safe, not raw auth token

view_id
  current page/view instance
  changes on navigation or route transition

interaction_id
  one user action, e.g. click Submit Order
  may trigger multiple HTTP requests

request_id
  one HTTP request attempt
  changes for retries

operation_id
  business operation, e.g. create-order attempt
  may survive retries and async status polling

trace_id
  distributed trace ID propagated through backend
```

Example user action:

```text
User clicks "Submit Payment"
  interaction_id = int_123
  operation_id   = op_pay_456

HTTP attempt 1 POST /payments
  request_id = req_a
  trace_id   = trace_1
  -> timeout

HTTP attempt 2 POST /payments with same Idempotency-Key
  request_id = req_b
  trace_id   = trace_2
  operation_id remains op_pay_456
```

This model lets you answer:

```text
- Did user click once or twice?
- Did frontend retry?
- Did backend process duplicate mutation?
- Which trace corresponds to each attempt?
- Which operation did support see?
```

### 11.2 Header Example

```http
POST /api/payments HTTP/1.1
Host: api.example.com
Content-Type: application/json
Authorization: Bearer <token>
X-Request-ID: req_01J...
X-Interaction-ID: int_01J...
X-Operation-ID: op_01J...
Idempotency-Key: op_01J...
traceparent: 00-...
```

Be careful: custom headers can trigger CORS preflight. For cross-origin browser APIs, coordinate CORS policy intentionally.

---

## 12. Trace Context from Browser

Propagating `traceparent` from frontend is powerful but must be designed carefully.

### 12.1 Benefits

- correlate browser action to backend trace;
- see full path from frontend to gateway/services;
- investigate p95/p99 user flows;
- link RUM events and backend spans;
- debug production-only latency.

### 12.2 Risks

- CORS preflight due to custom header;
- exposing internal observability policy;
- trace sampling mismatch;
- user privacy concerns;
- trusting client-provided trace data too much;
- malicious clients forging trace headers.

Backend must treat trace context from clients as input, not proof.

### 12.3 Practical Strategy

For same-origin BFF:

```text
frontend -> same-origin BFF
  trace headers easier
  no CORS preflight issue if same-origin

BFF -> internal services
  BFF normalizes/trusts according to policy
```

For cross-origin API:

```text
frontend -> api.example.com
  traceparent/custom headers require CORS allow-list
  OPTIONS preflight must be supported
```

If preflight overhead is unacceptable, use a narrower approach:

- only trace important mutations;
- use backend-generated request IDs surfaced in response;
- rely on RUM beacon with operation ID;
- prefer same-origin BFF for complex enterprise flows.

---

## 13. RUM: Real User Monitoring

RUM collects performance and reliability data from real users.

Synthetic tests answer:

```text
How does the site behave from controlled test locations/devices?
```

RUM answers:

```text
How does the site behave for actual users, on actual networks/devices/browsers?
```

### 13.1 What to Capture

A practical RUM event for HTTP might include:

```json
{
  "event_type": "http_request",
  "timestamp": "2026-06-18T10:15:30.123Z",
  "session_id": "sess_...",
  "view_id": "view_...",
  "interaction_id": "int_...",
  "request_id": "req_...",
  "method": "GET",
  "url_group": "/api/orders/:id",
  "origin_group": "api",
  "status": 200,
  "ok": true,
  "duration_ms": 243,
  "ttfb_ms": 118,
  "download_ms": 8,
  "transfer_size": 12400,
  "encoded_body_size": 11200,
  "decoded_body_size": 56000,
  "from_cache_hint": false,
  "retry_count": 0,
  "aborted": false,
  "timeout": false,
  "browser": "Chrome",
  "effective_connection_type": "4g",
  "route": "/orders/123",
  "release": "web-2026.06.18.4"
}
```

### 13.2 What Not to Capture

Avoid collecting:

```text
- raw URLs with PII query params
- request/response bodies by default
- access tokens
- refresh tokens
- cookies
- full Authorization header
- full email/name/phone unless explicitly required and governed
- sensitive business data
```

Use URL grouping:

```text
Bad:
/api/users/alice@example.com/orders?token=abc

Good:
/api/users/:userId/orders
```

### 13.3 Sampling

Do not send every event from every user blindly.

Sampling strategies:

```text
- sample successful requests, e.g. 1–10%
- always capture severe failures
- always capture checkout/payment critical path failures
- sample high-volume endpoints more aggressively
- increase sampling temporarily during incident
- attach release/environment metadata
```

### 13.4 Bias in RUM Data

RUM data has bias:

- ad blockers may block telemetry;
- privacy settings reduce visibility;
- users with worst networks may fail before telemetry sends;
- background tabs throttle timers;
- browser APIs differ;
- corporate networks distort timing;
- sampling can hide rare failures.

RUM is evidence, not perfect truth.

---

## 14. Sending Telemetry Reliably

Browser telemetry itself is HTTP. It can fail.

Common options:

### 14.1 `sendBeacon()`

Good for fire-and-forget telemetry, especially during unload/pagehide.

```js
navigator.sendBeacon('/rum', JSON.stringify(payload));
```

Limitations:

- no custom rich response handling;
- payload size constraints vary;
- not for critical business operations;
- still can be blocked by network/policy.

### 14.2 `fetch(..., { keepalive: true })`

Useful for small requests that should outlive page unload.

```js
fetch('/rum', {
  method: 'POST',
  body: JSON.stringify(payload),
  headers: { 'Content-Type': 'application/json' },
  keepalive: true,
});
```

Be aware of browser constraints and size limits.

### 14.3 Batch and Flush

For ongoing telemetry:

```text
collect events in memory
  -> batch periodically
  -> flush on visibilitychange/pagehide
  -> drop oldest if buffer full
  -> never block user journey
```

Telemetry must not become a reliability hazard.

---

## 15. Core Web Vitals and HTTP

Core Web Vitals are user-centric performance signals. HTTP contributes heavily, but not exclusively.

Relevant relationships:

```text
LCP
  affected by HTML TTFB, render-blocking resources, image loading, priority, cache, CDN

INP
  affected more by main thread, JS, event handling, but API response timing can affect interaction completion

CLS
  affected by image/font loading, layout reservation, late resource arrival
```

Do not reduce Web Vitals to “API latency”. Example:

```text
LCP poor
  maybe HTML TTFB high
  maybe hero image low priority
  maybe CSS blocked
  maybe font delay
  maybe client-side rendering waits for JS
  maybe API waterfall blocks content
```

Frontend HTTP observability should connect:

```text
navigation timing
resource timing
critical resource URLs
route-level timings
API timings
render timings
web vitals
```

---

## 16. Waterfall Diagnosis Patterns

### 16.1 Sequential API Waterfall

Symptom:

```text
GET /me       200ms
GET /org      starts after /me, 250ms
GET /orders   starts after /org, 300ms
GET /summary  starts after /orders, 200ms
Total: ~950ms
```

Question:

```text
Are these dependencies real or accidental?
```

Fix possibilities:

- parallelize independent requests;
- create composite endpoint;
- use BFF;
- preload known data;
- cache stable data;
- restructure route loader.

### 16.2 Preflight Storm

Symptom:

```text
OPTIONS /api/a
GET /api/a
OPTIONS /api/b
GET /api/b
OPTIONS /api/c
GET /api/c
```

Causes:

- custom headers on every request;
- `Authorization` header cross-origin;
- non-simple `Content-Type`;
- low/no `Access-Control-Max-Age`;
- many origins;
- inconsistent CORS response.

Fix possibilities:

- same-origin BFF;
- reduce custom headers;
- tune preflight cache;
- consolidate calls;
- align API/CORS design.

### 16.3 Redirect Chain

Symptom:

```text
http://example.com
 -> https://example.com
 -> https://www.example.com
 -> https://www.example.com/home
 -> /app
```

Impact:

- wasted RTT;
- slower navigation;
- cookie/domain confusion;
- SEO/canonical complexity;
- auth redirect loops.

Fix:

- canonicalize links;
- configure edge redirect once;
- use HSTS carefully;
- avoid redirecting API calls to login HTML.

### 16.4 Cache Miss on Static Assets

Symptom:

```text
main.abc123.js 200 from network every reload
```

Expected:

```text
main.abc123.js from memory/disk cache or 304 rarely
```

Check:

```http
Cache-Control: public, max-age=31536000, immutable
```

For fingerprinted assets, long-lived immutable caching is usually correct.

### 16.5 HTML Cached Too Long

Symptom:

```text
User loads old index.html that references deleted chunk main.old.js
GET /assets/main.old.js -> 404
```

Fix:

```text
HTML: no-cache or short max-age with revalidation
Assets: long max-age immutable
Keep old assets available for a grace period
```

### 16.6 Backend Fast, Browser Slow

Backend trace:

```text
app duration: 80ms
```

Browser Network:

```text
Total: 1200ms
Stalled: 900ms
TTFB: 120ms
Download: 5ms
```

Conclusion:

```text
Backend app time is not the bottleneck. Investigate browser scheduling, connection, proxy, service worker, or origin contention.
```

### 16.7 Browser Fast, UI Slow

Network:

```text
API duration: 100ms
```

User sees content after:

```text
2.5s
```

Investigate:

- JSON parsing cost;
- state normalization;
- expensive render;
- hydration;
- main thread long tasks;
- layout thrashing;
- client-side waterfall after first API.

---

## 17. “Works Locally, Fails in Production” Playbook

When a frontend HTTP issue only occurs in production, compare layers explicitly.

### 17.1 Environment Comparison Matrix

| Dimension | Local | Staging | Production |
|---|---|---|---|
| Origin | localhost? | subdomain? | real domain? |
| HTTPS | maybe no | yes/no | yes |
| Cookie domain | localhost | staging domain | prod domain |
| SameSite behavior | different | close to prod? | real |
| CORS | dev proxy? | configured? | configured? |
| CDN | absent | maybe | yes |
| Service worker | maybe disabled | maybe | yes |
| Cache headers | dev defaults | partial | real |
| Security headers | absent | partial | strict |
| API gateway | bypassed | maybe | yes |
| Auth/IdP | mocked | staging IdP | prod IdP |
| Compression | dev off | maybe | yes |
| HTTP version | dev h1 | h2/h3 | h2/h3 |

Local success does not prove production correctness.

### 17.2 Evidence to Collect

```text
[ ] URL and route
[ ] user action
[ ] timestamp with timezone
[ ] release/build version
[ ] browser and version
[ ] network type if available
[ ] request URL group
[ ] method/status
[ ] request/response headers sanitized
[ ] timing breakdown
[ ] trace/correlation ID
[ ] service worker status
[ ] cache status
[ ] console errors
[ ] screenshot/video if UI state matters
```

---

## 18. “Request Not Seen by Backend” Playbook

If backend says “we never received it”, possible causes:

```text
Browser never sent request
  - JavaScript branch not executed
  - validation blocked submit
  - AbortController cancelled
  - route changed before send
  - request deduped

Browser policy blocked it
  - CORS preflight failed
  - mixed content blocked
  - CSP connect-src blocked
  - CORP/COEP/COOP issue

Service worker intercepted it
  - responded from cache
  - swallowed request
  - offline fallback

Cache satisfied it
  - memory cache
  - disk cache
  - HTTP cache revalidation not needed

Network/edge intercepted it
  - CDN answered
  - WAF blocked
  - gateway rejected
  - DNS/proxy issue
  - TLS failed

Request went elsewhere
  - wrong base URL
  - environment config bug
  - redirect to different origin
  - dev proxy vs prod route mismatch
```

Evidence path:

```text
DevTools Network request exists?
  no -> JS/application path
  yes -> status/timing/type?

Has OPTIONS but no actual request?
  -> preflight/CORS

Served from service worker/cache?
  -> SW/cache layer

Has remote address/CDN status?
  -> edge/proxy path

Has request ID/trace ID in response?
  -> backend/gateway received
```

---

## 19. Error Observability

Error observability should preserve semantics.

Bad telemetry:

```json
{
  "message": "Failed"
}
```

Good telemetry:

```json
{
  "event_type": "http_error",
  "request_id": "req_123",
  "interaction_id": "int_456",
  "method": "POST",
  "url_group": "/api/orders",
  "status": 409,
  "error_type": "domain_conflict",
  "problem_type": "https://docs.example.com/problems/order-state-conflict",
  "domain_code": "ORDER_ALREADY_SUBMITTED",
  "retryable": false,
  "user_actionable": true,
  "duration_ms": 187,
  "release": "web-2026.06.18.4"
}
```

### 19.1 Classify Error Source

At minimum:

```text
network_error
  fetch rejected due to network/CORS/mixed content/etc.

http_error
  response received but status not acceptable

parse_error
  response body could not be parsed as expected

contract_error
  response shape invalid

timeout
  client-side timeout/abort policy

abort
  intentional cancellation

render_error
  UI failed after response

state_error
  invalid frontend transition
```

This avoids mixing unrelated failures.

---

## 20. Network Error Is Not One Thing

In browser `fetch`, many different conditions collapse into a rejected promise with `TypeError` or generic failure.

Possible causes:

```text
- DNS failure
- TLS failure
- offline
- connection reset
- CORS failure
- mixed content blocked
- CSP connect-src blocked
- browser extension blocked
- ad blocker blocked
- corporate proxy blocked
- request aborted
```

Because browser intentionally hides some details for security, frontend observability must collect contextual hints:

```text
- navigator.onLine
- request mode/credentials
- URL group/origin
- elapsed time before failure
- console error category if available
- service worker state
- CSP violation reports
- browser/network info if available
```

Do not claim exact cause if browser does not expose it.

---

## 21. CSP and Security Policy Reports

Some HTTP failures are caused by browser security policy, not server application behavior.

Useful signals:

- CSP violation reports;
- Reporting API;
- Network Error Logging where supported/deployed;
- console security errors;
- blocked mixed content messages;
- CORS errors;
- COEP/CORP/COOP failures.

Security reports can be noisy. Treat them as telemetry streams requiring aggregation and filtering.

Example CSP report-only rollout:

```http
Content-Security-Policy-Report-Only: default-src 'self'; report-to csp-endpoint
```

Policy report telemetry should include:

```text
- directive violated
- blocked URI group
- document URI group
- release
- route
- browser
- sample if safe
```

---

## 22. Service Worker Observability

Service workers make observability harder because they can intercept requests.

Collect or inspect:

```text
- service worker registered?
- active service worker version?
- controller present?
- fetch handler used?
- cache strategy selected?
- network fallback used?
- cache hit/miss?
- offline fallback served?
- navigation preload used?
```

In DevTools, look for indicators like:

```text
- from ServiceWorker
- request served from cache
- service worker console logs
- application/cache storage entries
```

For production, include SW version in telemetry:

```js
navigator.serviceWorker?.controller?.postMessage({ type: 'GET_VERSION' });
```

Or expose version via app shell metadata.

Failure pattern:

```text
Backend fixed API.
User still sees old behavior.
Root cause: service worker serves stale app shell or cached API response.
```

---

## 23. Observability for Retries and Cancellation

Retries without observability create confusion.

You need to record:

```text
- attempt number
- reason for retry
- delay before retry
- status/error that triggered retry
- same operation ID or not
- same idempotency key or not
- final outcome
```

Example:

```json
{
  "event_type": "http_retry",
  "operation_id": "op_123",
  "request_id": "req_attempt_2",
  "previous_request_id": "req_attempt_1",
  "attempt": 2,
  "max_attempts": 3,
  "reason": "timeout",
  "backoff_ms": 500,
  "idempotency_key_reused": true
}
```

Cancellation should not be treated as failure by default.

Examples of normal abort:

```text
- user navigates away
- search query changes
- route loader cancelled
- component unmounted
- duplicate in-flight request deduped
```

But unexpected aborts should be visible:

```text
- timeout policy too aggressive
- abort signal shared incorrectly
- global route transition cancels critical mutation
```

---

## 24. Observability for Auth Flows

Auth bugs are notoriously hard because they involve browser storage, cookies, redirects, CORS, and IdP behavior.

Capture safe signals:

```text
- auth_state before request: anonymous/authenticated/refreshing/expired
- endpoint group
- credentials mode
- status code
- redirect occurred?
- cookie expected? never log cookie value
- SameSite-related context: same-site/cross-site if derivable
- refresh attempt count
- refresh lock acquired?
- token refresh result
- logout reason
```

Do not log:

```text
- access token
- refresh token
- raw cookie
- authorization header
- ID token claims unless governed
```

Common auth observability incident:

```text
Symptom:
Users randomly get logged out.

Without observability:
Maybe backend session bug?

With observability:
Multiple tabs trigger refresh simultaneously.
Refresh token rotation invalidates one tab's token.
Second tab receives 401.
Global interceptor logs out entire session.
```

---

## 25. Observability for API Contract Drift

Frontend can receive responses that are syntactically valid but semantically invalid.

Examples:

```text
- field changed from string to object
- enum gains unexpected value
- nullable field becomes missing
- error envelope changes
- content-type says JSON but body is HTML
- 204 response returns body unexpectedly
- 200 response contains login HTML due to redirect/auth gateway
```

Runtime validation can produce telemetry:

```json
{
  "event_type": "contract_error",
  "url_group": "/api/orders/:id",
  "status": 200,
  "content_type": "application/json",
  "schema": "OrderDetailResponse@v3",
  "error": "missing_required_field",
  "field": "order.status",
  "release": "web-2026.06.18.4"
}
```

Do not upload full payload unless safe and explicitly allowed.

---

## 26. Production Debugging: Minimal Frontend HTTP Client Instrumentation

A frontend HTTP client layer should emit structured events around requests.

Pseudo TypeScript:

```ts
type HttpTelemetry = {
  requestId: string;
  interactionId?: string;
  operationId?: string;
  method: string;
  urlGroup: string;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  status?: number;
  ok?: boolean;
  retryCount: number;
  errorKind?:
    | 'network_error'
    | 'http_error'
    | 'timeout'
    | 'abort'
    | 'parse_error'
    | 'contract_error';
  traceId?: string;
};
```

Example wrapper:

```ts
async function observedFetch(input: RequestInfo, init: RequestInit = {}) {
  const requestId = crypto.randomUUID();
  const startedAt = performance.now();

  const headers = new Headers(init.headers);
  headers.set('X-Request-ID', requestId);

  let response: Response | undefined;

  try {
    response = await fetch(input, { ...init, headers });

    const durationMs = performance.now() - startedAt;

    emitHttpTelemetry({
      requestId,
      method: init.method ?? 'GET',
      urlGroup: groupUrl(input),
      startedAt,
      endedAt: performance.now(),
      durationMs,
      status: response.status,
      ok: response.ok,
      retryCount: 0,
      errorKind: response.ok ? undefined : 'http_error',
    });

    return response;
  } catch (error) {
    const durationMs = performance.now() - startedAt;

    emitHttpTelemetry({
      requestId,
      method: init.method ?? 'GET',
      urlGroup: groupUrl(input),
      startedAt,
      endedAt: performance.now(),
      durationMs,
      retryCount: 0,
      errorKind: classifyFetchError(error),
    });

    throw error;
  }
}
```

Important caveat:

> Adding `X-Request-ID` to cross-origin requests may trigger CORS preflight. Decide intentionally.

For same-origin BFF, this is usually easier.

---

## 27. URL Grouping

Never group metrics by full raw URL if URLs contain identifiers or query params.

Bad cardinality:

```text
/api/orders/1001
/api/orders/1002
/api/orders/1003
```

Good grouping:

```text
/api/orders/:orderId
```

Bad query capture:

```text
/api/search?q=alice@example.com
```

Good:

```text
/api/search?q=<redacted>
```

High-cardinality observability data can destroy metrics systems and leak private data.

### 27.1 Cardinality Discipline

Be careful with labels/tags:

Good tags:

```text
route_group
endpoint_group
method
status_class
browser_family
release
environment
region
```

Dangerous tags:

```text
user_id
full_url
email
token
tenant_name if very high-cardinality
raw error message from backend
```

Use logs/traces for high-cardinality investigation, metrics for aggregate health.

---

## 28. Metrics That Matter

### 28.1 HTTP Frontend Metrics

Track:

```text
request count by endpoint group
error rate by endpoint/status/error kind
latency p50/p75/p95/p99 by endpoint
timeout rate
abort rate
retry rate
preflight count ratio
cache hit hints
payload size distribution
contract error rate
auth refresh failure rate
```

### 28.2 User Journey Metrics

More important than raw endpoint metrics:

```text
login success rate
checkout completion latency
search interaction latency
save draft success rate
file upload success rate
dashboard load complete time
route transition latency
```

A system can have healthy API p95 but terrible user journey due to sequential waterfalls.

### 28.3 Release Metrics

Always attach release/build metadata.

```text
web_release = 2026.06.18.4
api_version = 2026.06.18
config_version = cfg_123
sw_version = sw_456
```

This enables:

```text
Did errors start exactly after frontend release?
Only users with old service worker?
Only one CDN region?
Only one backend version?
```

---

## 29. Logs, Metrics, Traces: What Goes Where?

### 29.1 Metrics

Use for aggregate numerical health:

```text
- p95 latency
- error rate
- request count
- retry rate
- timeout rate
```

### 29.2 Logs

Use for event records:

```text
- user action started
- request failed
- auth refresh failed
- contract validation failed
- service worker cache strategy selected
```

### 29.3 Traces

Use for causal path:

```text
frontend interaction
  -> API gateway
  -> service A
  -> DB
  -> service B
  -> response
```

### 29.4 Events

For frontend, many observability systems treat user actions as events:

```text
search_submitted
order_save_started
order_save_succeeded
order_save_failed
route_transition_completed
```

The best production debugging often requires all four.

---

## 30. Case Study 1: API “Slow” Because of Browser Waterfall

### Symptom

User says dashboard takes 4 seconds.

### Evidence

Network waterfall:

```text
GET /api/me            300ms
GET /api/permissions   starts after /me, 400ms
GET /api/org           starts after /permissions, 300ms
GET /api/widgets       starts after /org, 800ms
GET /api/alerts        starts after /widgets, 500ms
GET /api/news          starts after /alerts, 300ms
```

Backend p95 per endpoint:

```text
all under 900ms
```

### Root Cause

Sequential dependency in frontend loader, not single slow endpoint.

### Fix

- parallelize independent requests;
- combine dashboard summary endpoint;
- use BFF for composite view;
- cache permissions/org metadata;
- render progressive sections.

### Prevention

Add route-level observability:

```text
dashboard_route_start
me_loaded
permissions_loaded
widgets_loaded
dashboard_interactive
```

---

## 31. Case Study 2: API Fast in Backend Trace, Slow in Browser

### Symptom

Frontend reports `/api/search` p95 = 1.8s.
Backend reports handler p95 = 120ms.

### Evidence

Resource Timing:

```text
queue/stalled: 1200ms
TTFB: 160ms
download: 20ms
```

Network shows many image/font/script requests competing during route load.

### Root Cause

Request scheduling and critical resource contention, not backend processing.

### Fix

- defer non-critical resources;
- reduce initial request fanout;
- preconnect to API origin;
- avoid low-priority API call behind resource flood;
- restructure route load.

---

## 32. Case Study 3: Request Not in Backend Logs

### Symptom

Frontend says save failed. Backend cannot find request.

### Evidence

DevTools:

```text
OPTIONS /api/orders -> 401
POST /api/orders not sent
```

### Root Cause

CORS preflight failed due to auth middleware requiring credentials on OPTIONS.

### Fix

- allow unauthenticated OPTIONS preflight;
- return correct CORS headers;
- ensure actual request still requires auth;
- add preflight failure monitoring.

### Prevention

CORS observability should count:

```text
OPTIONS status
preflight failures
actual request missing after preflight
```

---

## 33. Case Study 4: Support Code Without Trace

### Symptom

User sees:

```text
Something went wrong.
```

No support code. Backend logs huge. Investigation slow.

### Fix Pattern

Return error response with safe identifiers:

```http
HTTP/1.1 500 Internal Server Error
Content-Type: application/problem+json
X-Request-ID: req_123
traceparent: 00-...
```

Body:

```json
{
  "type": "https://docs.example.com/problems/internal-error",
  "title": "Unexpected error",
  "status": 500,
  "detail": "Something went wrong. Contact support with code req_123.",
  "requestId": "req_123"
}
```

Frontend displays:

```text
Something went wrong.
Support code: req_123
```

Now support can search by request ID.

---

## 34. Case Study 5: Service Worker Hides Fixed Bug

### Symptom

Bug fixed and deployed. Some users still see old broken behavior.

### Evidence

Telemetry:

```text
web_release: 2026.06.18.4
sw_version: 2026.06.10.1
api response served_from: service_worker_cache
```

### Root Cause

Old service worker/cache strategy serves stale app shell or stale API.

### Fix

- improve SW update flow;
- version caches;
- avoid caching unsafe API responses;
- expose SW version in telemetry;
- add kill switch if needed.

---

## 35. Frontend HTTP Observability Checklist

### 35.1 Request Evidence

```text
[ ] method
[ ] URL group
[ ] origin group
[ ] request ID
[ ] interaction/operation ID
[ ] trace context if used
[ ] status
[ ] duration
[ ] error classification
[ ] retry count
[ ] abort/timeout distinction
[ ] response content-type
[ ] release/build version
```

### 35.2 Timing Evidence

```text
[ ] total duration
[ ] TTFB
[ ] download time
[ ] DNS/connect/TLS where available
[ ] transfer size
[ ] encoded/decoded body size
[ ] cache hint
[ ] server timing when available
```

### 35.3 Browser Context

```text
[ ] browser family/version
[ ] device class
[ ] viewport if relevant
[ ] effective connection type if available
[ ] route/view
[ ] visibility state
[ ] service worker version/status
[ ] locale/timezone if relevant and privacy-safe
```

### 35.4 Security/Policy Evidence

```text
[ ] CORS failure category if inferable
[ ] CSP violation reports
[ ] mixed content errors
[ ] COEP/CORP/COOP issues
[ ] cookie expected/not expected, never value
[ ] credentials mode
```

### 35.5 Privacy Guardrails

```text
[ ] no raw tokens
[ ] no raw cookies
[ ] no full Authorization header
[ ] no PII in URL logs
[ ] no full response body by default
[ ] sampling and retention defined
[ ] user consent/regulatory posture considered
```

---

## 36. Practical DevTools Investigation Flow

When debugging one HTTP issue manually:

```text
1. Reproduce with DevTools Network open.
2. Preserve log if navigation/redirect involved.
3. Disable cache only if testing network behavior intentionally.
4. Identify request by user action and initiator.
5. Check if preflight exists.
6. Check if request is served from cache/service worker.
7. Check method, URL, status.
8. Check request headers: Origin, Cookie, Authorization, Content-Type.
9. Check response headers: CORS, Cache-Control, Content-Type, Set-Cookie, Location.
10. Check response body/error envelope.
11. Open Timing tab and identify dominant phase.
12. Capture request ID/trace ID.
13. Compare with backend/gateway/CDN logs.
14. Form hypothesis only after evidence.
```

---

## 37. Architecture Recommendation: Observability-Aware HTTP Client

A serious frontend app should avoid raw `fetch()` scattered everywhere.

Recommended layers:

```text
UI component
  -> domain action / route loader
  -> data client / query layer
  -> HTTP client wrapper
  -> fetch/browser
```

HTTP wrapper responsibilities:

```text
- request ID generation
- URL grouping
- timing measurement
- timeout/abort handling
- retry instrumentation
- response classification
- error normalization
- safe telemetry emission
- trace/correlation propagation where appropriate
```

But avoid over-centralized magic:

```text
Bad:
Global interceptor silently retries every POST and logs user out on any 401.

Good:
Policy is explicit per request category: read, mutation, auth refresh, upload, telemetry.
```

---

## 38. Anti-Patterns

### 38.1 Logging Full URLs

Bad:

```text
/api/search?q=customer-email@example.com
```

Fix:

```text
/api/search?q=<redacted>
```

### 38.2 Treating All Fetch Rejections as Offline

Bad:

```text
TypeError => user offline
```

Fix:

```text
TypeError => network/policy failure category unknown; add context
```

### 38.3 No Request ID in Errors

Bad:

```text
Something went wrong
```

Fix:

```text
Something went wrong. Support code: req_123
```

### 38.4 Measuring Only Average Latency

Bad:

```text
Average API latency = 200ms
```

Fix:

```text
p50, p75, p95, p99 by endpoint group, browser, region, release
```

### 38.5 Mixing Abort With Failure

Bad:

```text
Search request aborted because user typed again -> counted as error
```

Fix:

```text
intentional_abort category excluded from error rate
```

### 38.6 Observability That Changes Behavior Too Much

Bad:

```text
Adding custom telemetry headers to all cross-origin requests creates preflight storm.
```

Fix:

```text
Use same-origin BFF, sample, or propagate headers selectively.
```

---

## 39. Top 1% Mental Model

For frontend HTTP observability, always separate these questions:

```text
1. Did the frontend intend to send a request?
2. Did browser policy allow it?
3. Did the browser send it to network?
4. Was it intercepted by cache/service worker/CDN?
5. Did gateway/backend receive it?
6. How long did each phase take?
7. What semantic outcome did HTTP report?
8. What did the application contract report?
9. How did frontend state transition?
10. What did the user experience?
```

Most debugging failures happen because engineers collapse these questions into one vague statement:

```text
The API failed.
```

Top-tier diagnosis expands it:

```text
The user clicked Save once. The frontend created operation op_123 and attempt req_1.
Browser sent OPTIONS because Authorization and X-Request-ID made the request non-simple.
OPTIONS returned 401 from gateway, so browser never sent POST.
Backend application logs do not show POST because it never happened.
Root cause is gateway auth middleware applied before CORS preflight handling.
Fix OPTIONS policy, keep POST authenticated, add preflight failure telemetry.
```

That is observability-driven reasoning.

---

## 40. Exercises

### Exercise 1 — Waterfall Reading

Open a real SPA route and capture Network waterfall.

Answer:

```text
- What was the first request?
- What was the LCP candidate resource?
- Which requests were sequential but could be parallel?
- Were there preflights?
- Which requests came from cache?
- Which request had highest TTFB?
- Which request had highest download time?
- Which request was stalled longest?
```

### Exercise 2 — Add Request IDs

Design a request ID strategy for your frontend app.

Specify:

```text
- where ID is generated
- which headers carry it
- how backend returns it
- how UI displays it on error
- how logs/traces search by it
- how CORS preflight impact is handled
```

### Exercise 3 — RUM Event Schema

Create a safe telemetry schema for API calls.

Must include:

```text
- endpoint grouping
- method/status
- duration
- error kind
- retry count
- release
- route
- privacy redaction rules
```

Must not include:

```text
- raw cookie
- token
- raw query containing PII
- full response body
```

### Exercise 4 — Server-Timing Design

For a Java backend endpoint `/api/orders/:id`, design `Server-Timing` metrics.

Example categories:

```text
auth
cache
db
app
external
serialization
```

Then define what each duration means precisely.

### Exercise 5 — Incident Report

Write a short incident analysis for:

```text
Users report Save button sometimes spins forever.
```

Your report must distinguish:

```text
- frontend state machine
- request sent or not
- timeout/abort/retry
- backend trace
- user-visible outcome
- prevention telemetry
```

---

## 41. Summary

In this part, we built a production-grade mental model for frontend HTTP observability.

Key takeaways:

1. “API slow” is not a root cause. It is a symptom.
2. Browser Network waterfall must be read by phase: queueing, DNS, connect, TLS, TTFB, download.
3. Resource Timing and Navigation Timing bring browser-side network evidence into production telemetry.
4. `Server-Timing` connects browser-observed latency to backend internal phases.
5. Correlation IDs, operation IDs, request IDs, and trace IDs solve different problems.
6. RUM measures real users, but it must be sampled, privacy-safe, and cardinality-aware.
7. Fetch network errors collapse many causes; avoid overclaiming what browser does not expose.
8. Service workers, CORS, CSP, cache, redirects, and security policies can prevent requests before backend sees them.
9. Good observability preserves semantics: HTTP error, network error, parse error, contract error, timeout, abort, and render error are different.
10. Top-tier debugging follows evidence across browser, network, edge, backend, and UI state.

---

## 42. References

- MDN — Resource Timing API: https://developer.mozilla.org/en-US/docs/Web/API/Performance_API/Resource_timing
- MDN — `PerformanceResourceTiming`: https://developer.mozilla.org/en-US/docs/Web/API/PerformanceResourceTiming
- MDN — `PerformanceNavigationTiming`: https://developer.mozilla.org/en-US/docs/Web/API/PerformanceNavigationTiming
- MDN — `Server-Timing` header: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Server-Timing
- MDN — Server Timing API: https://developer.mozilla.org/en-US/docs/Web/API/Performance_API/Server_timing
- W3C — Resource Timing: https://www.w3.org/TR/resource-timing/
- W3C — Server Timing: https://www.w3.org/TR/server-timing/
- W3C — Trace Context: https://www.w3.org/TR/trace-context/
- W3C — Trace Context Level 2: https://www.w3.org/TR/trace-context-2/
- web.dev — Navigation and Resource Timing: https://web.dev/articles/navigation-and-resource-timing
- web.dev — TTFB: https://web.dev/articles/ttfb
- web.dev — Custom Metrics: https://web.dev/articles/custom-metrics

---

## 43. Status Seri

```text
Part 028 selesai.
Seri belum selesai.
Lanjut ke Part 029: Performance Engineering: Latency, Payload, Critical Path, and CDN Strategy.
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-http-for-web-frontend-perspective-part-027.md">⬅️ Part 027 — Service Workers, Cache API, Offline, and Request Interception</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-http-for-web-frontend-perspective-part-029.md">Part 029 — Performance Engineering: Latency, Payload, Critical Path, and CDN Strategy ➡️</a>
</div>
