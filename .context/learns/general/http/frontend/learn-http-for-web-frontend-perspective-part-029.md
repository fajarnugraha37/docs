# learn-http-for-web-frontend-perspective-part-029.md

# Part 029 — Performance Engineering: Latency, Payload, Critical Path, and CDN Strategy

> Seri: `learn-http-for-web-frontend-perspective`  
> Bagian: `029 / 035`  
> Fokus: memahami performa web sebagai hasil dari interaksi browser, HTTP semantics, transport, resource graph, API design, cache, CDN, dan user-perceived latency.

---

## 0. Posisi Bagian Ini dalam Seri

Sampai Part 028, kita sudah membangun fondasi:

- HTTP message model.
- Method dan status semantics.
- Header, body, media type, encoding.
- Fetch, form, navigation, XHR, beacon, SSE, WebSocket.
- CORS, cookies, auth, CSRF.
- HTTP cache, ETag, revalidation.
- Redirect.
- Content negotiation.
- Resource loading.
- HTTP/1.1, HTTP/2, HTTP/3.
- HTTPS/TLS.
- Security headers dan isolation policies.
- API design, mutation design, error contract.
- Observability: DevTools, Resource Timing, Server-Timing, RUM, trace context.

Part ini menggabungkan semua itu menjadi satu pertanyaan praktis:

> Bagaimana membuat aplikasi web terasa cepat, stabil, dan dapat dipertanggungjawabkan secara teknis?

Kata kuncinya bukan hanya “optimasi”. Kata kuncinya adalah **mengurangi jarak antara user intent dan useful pixels**.

Frontend performance bukan sekadar:

```text
minify JS
compress response
use CDN
```

Itu hanya potongan kecil.

Frontend performance adalah gabungan dari:

```text
user action
  -> browser scheduling
  -> network path
  -> DNS/connect/TLS
  -> CDN/cache/origin
  -> backend latency
  -> response size
  -> parse/compile/evaluate
  -> rendering
  -> interactivity
  -> perception
```

Jika Anda hanya mengoptimalkan satu titik tanpa memahami jalur lengkapnya, Anda sering memindahkan bottleneck, bukan menghilangkannya.

---

## 1. Tujuan Pembelajaran

Setelah bagian ini, Anda harus bisa:

1. membaca performa web sebagai sistem dependency graph, bukan daftar request acak;
2. membedakan latency, bandwidth, throughput, TTFB, download time, render blocking, dan CPU blocking;
3. memahami mengapa aplikasi dengan backend cepat tetap bisa terasa lambat;
4. memahami mengapa aplikasi dengan bundle kecil tetap bisa lambat;
5. memahami bagaimana HTTP cache dan CDN mengubah performa dan correctness;
6. mendesain API yang tidak menciptakan waterfall frontend;
7. menentukan kapan perlu BFF/API aggregation;
8. memahami hubungan resource loading dengan Core Web Vitals;
9. membuat performance budget yang bisa dipakai di engineering review;
10. melakukan diagnosis performa berbasis evidence, bukan feeling.

---

## 2. Mental Model Utama: Performance Is Dependency Management

Kesalahan umum adalah menganggap performance sebagai “membuat setiap request lebih cepat”.

Itu tidak salah, tapi tidak cukup.

Dalam browser, performance lebih sering ditentukan oleh **urutan dependency** daripada kecepatan individual.

Contoh sederhana:

```text
HTML
  -> CSS
      -> font
  -> JS bundle
      -> API config
          -> user profile
              -> permissions
                  -> dashboard data
```

Meskipun setiap request hanya 100 ms, jika semuanya serial:

```text
6 dependency serial x 100 ms = 600 ms minimum sebelum UI lengkap
```

Sedangkan jika dependency bisa diparalelkan:

```text
max(100 ms, 100 ms, 100 ms, 100 ms) = sekitar 100-150 ms + overhead
```

Jadi pertanyaan top 1% bukan hanya:

> “Request mana yang lambat?”

Tetapi:

> “Dependency mana yang tidak perlu berada di critical path?”

### 2.1 Critical Path

Critical path adalah jalur terpanjang dari awal navigasi sampai user bisa melihat/menggunakan bagian penting dari halaman.

Dalam web frontend, critical path dapat mencakup:

- HTML document request.
- Redirect chain.
- DNS/connect/TLS.
- CSS render-blocking.
- JavaScript parser-blocking atau hydration-blocking.
- Font loading.
- LCP image discovery.
- API request untuk above-the-fold content.
- Client-side route bootstrapping.
- Auth/session validation.
- Feature flag/config request.
- Third-party scripts.

Critical path tidak selalu sama dengan request paling lambat.

Request 3 detik untuk analytics yang tidak menghalangi render mungkin tidak terlalu memengaruhi user-perceived load.

Request 80 ms untuk config yang memblokir seluruh app bisa sangat merusak.

---

## 3. Performance Taxonomy: Jangan Campur Semua Latency

Untuk mendiagnosis performa, kita perlu memisahkan beberapa jenis waktu.

### 3.1 Network Latency

Network latency adalah waktu bolak-balik minimum antara client dan server/CDN/origin.

Biasanya dipengaruhi oleh:

- jarak geografis;
- routing ISP;
- mobile network;
- packet loss;
- VPN/corporate proxy;
- DNS;
- TCP/TLS/QUIC handshake;
- CDN point of presence;
- congestion.

Latency tidak bisa diselesaikan hanya dengan menambah server CPU.

Jika user di Jakarta mengakses origin di Virginia tanpa CDN, ada batas fisik yang tidak bisa Anda “optimize away”.

### 3.2 Bandwidth

Bandwidth menentukan seberapa cepat payload besar bisa ditransfer setelah koneksi berjalan.

Payload besar memperburuk:

- image download;
- video;
- JS bundle;
- CSS besar;
- JSON response besar;
- source map yang tidak sengaja terkirim;
- font file besar;
- uncompressed text.

Bandwidth besar tidak otomatis mengatasi latency tinggi.

Request kecil yang banyak dan serial tetap lambat walau bandwidth bagus.

### 3.3 Server Processing Time

Server processing time adalah waktu backend/gateway/CDN/origin menghasilkan response.

Dari frontend, ini sering terlihat sebagai bagian dari `Waiting for server response` atau TTFB.

Penyebab umum:

- slow DB query;
- cold start;
- synchronous downstream call;
- lock contention;
- cache miss;
- rate limiter;
- auth introspection;
- service mesh overhead;
- overloaded origin;
- dynamic rendering;
- personalization;
- request fan-out.

### 3.4 Browser Main Thread Time

Frontend sering menyalahkan network padahal bottleneck ada di CPU browser.

Main thread dapat sibuk karena:

- parsing JavaScript;
- compiling JavaScript;
- evaluating JavaScript;
- hydration;
- layout;
- style recalculation;
- rendering;
- long tasks;
- expensive event handlers;
- JSON parse besar;
- DOM mutation masif;
- synchronous storage;
- third-party scripts.

Jika main thread blocked, response network bisa sudah selesai tapi UI belum bisa merespons.

### 3.5 Queueing and Scheduling

Browser tidak selalu langsung mengirim request.

Request bisa tertahan karena:

- priority lebih rendah;
- connection limit;
- HTTP/2 prioritization;
- service worker;
- main thread busy;
- resource discovery terlambat;
- preloader tidak melihat resource;
- preload salah konfigurasi;
- origin connection belum siap.

Jadi “request start time” sendiri adalah data penting.

---

## 4. Performance Metrics: Apa yang Sebenarnya Diukur?

### 4.1 Core Web Vitals

Core Web Vitals saat ini berfokus pada tiga dimensi utama:

| Metric | Mengukur | Target umum |
|---|---|---:|
| LCP | loading performance / kapan konten utama terlihat | <= 2.5 s |
| INP | responsiveness / respons interaksi user | <= 200 ms |
| CLS | visual stability / layout shift | <= 0.1 |

Web.dev dan dokumentasi Google menjelaskan threshold ini sebagai acuan user experience untuk mayoritas page load.

Poin penting: Core Web Vitals bukan murni HTTP metrics.

Tapi HTTP sangat memengaruhi LCP, dan secara tidak langsung bisa memengaruhi INP/CLS.

### 4.2 LCP: Largest Contentful Paint

LCP biasanya dipengaruhi oleh:

- TTFB HTML;
- render-blocking CSS;
- late-discovered hero image;
- lazy-loaded LCP image;
- low priority image;
- font blocking;
- client-side rendering delay;
- large JS blocking render;
- API dependency untuk konten utama;
- CDN/origin latency.

Jika LCP element adalah image, performa sangat dipengaruhi oleh kapan browser menemukan URL image tersebut.

Buruk:

```text
HTML -> JS bundle -> API -> render hero image URL -> image request starts
```

Lebih baik:

```text
HTML contains/preloads hero image -> image request starts early
```

### 4.3 INP: Interaction to Next Paint

INP dipengaruhi oleh:

- JavaScript long tasks;
- hydration mahal;
- event handler berat;
- rendering ulang besar;
- synchronous work setelah click/input;
- third-party code;
- excessive client-side state updates.

HTTP berpengaruh tidak langsung:

- bundle terlalu besar membuat main thread sibuk;
- response JSON terlalu besar membuat parse lama;
- terlalu banyak data menyebabkan render berat;
- API design memaksa client melakukan transformasi mahal.

### 4.4 CLS: Cumulative Layout Shift

CLS dipengaruhi oleh:

- image/video tanpa dimension;
- font swap;
- ads/iframe dinamis;
- late content insertion;
- skeleton/loading placeholder yang tidak menjaga layout;
- API response yang mengubah ukuran layout setelah render awal.

HTTP berpengaruh melalui:

- font loading;
- image loading;
- late API content;
- third-party embeds;
- caching.

### 4.5 Lab vs Field Metrics

Lab metrics:

- Lighthouse;
- WebPageTest;
- local DevTools;
- synthetic environment.

Field metrics:

- RUM;
- CrUX;
- production telemetry;
- user-device/network diversity.

Lab bagus untuk debugging deterministik.

Field bagus untuk realitas user.

Top 1% engineer tidak memilih salah satu. Ia memakai keduanya:

```text
field tells what hurts users
lab explains why it may happen
trace/network data proves the mechanism
```

---

## 5. Waterfall: Cara Membaca Performance sebagai Timeline

Network waterfall bukan daftar request. Itu grafik dependency.

Saat membaca waterfall, tanyakan:

1. request pertama apa?
2. apakah ada redirect?
3. berapa lama DNS/connect/TLS?
4. kapan HTML diterima?
5. kapan CSS/JS ditemukan?
6. resource mana render-blocking?
7. kapan LCP resource ditemukan?
8. apakah API request baru dimulai setelah JS selesai?
9. apakah request penting serial padahal bisa paralel?
10. apakah banyak request ke origin berbeda?
11. apakah cache hit/miss terlihat?
12. apakah TTFB tinggi atau download tinggi?
13. apakah main thread blocking setelah response selesai?

### 5.1 Waterfall Anti-Pattern: Late Discovery

Contoh:

```text
0 ms     GET /document
300 ms   HTML complete
350 ms   GET /app.js
900 ms   app.js complete
1000 ms  GET /api/home
1400 ms  API complete
1450 ms  GET /hero.jpg
2300 ms  hero complete
```

Masalahnya bukan hanya hero image besar.

Masalahnya hero image ditemukan sangat terlambat.

Solusi bisa berupa:

- render URL image di HTML;
- gunakan SSR/SSG untuk content above-the-fold;
- preload LCP image;
- jangan lazy-load LCP image;
- pastikan image priority tinggi;
- kurangi JS boot dependency.

### 5.2 Waterfall Anti-Pattern: Config Gate

```text
HTML -> JS -> /config -> /me -> /permissions -> /dashboard
```

Jika config harus selesai sebelum semua API, config menjadi global lock.

Alternatif:

- embed config minimal di HTML;
- preload config;
- pisahkan config critical vs non-critical;
- gunakan build-time config untuk hal statis;
- jalankan request independen paralel;
- gunakan BFF untuk menggabungkan initial state.

### 5.3 Waterfall Anti-Pattern: Auth Probe Blocking Everything

Banyak SPA melakukan:

```text
load app
  -> call /session
      -> if authenticated, call data
```

Untuk halaman yang selalu butuh auth, ini bisa masuk akal.

Namun jika session bisa diketahui dari server-side HTML/BFF, request tambahan bisa dihilangkan.

Alternatif:

```text
HTML includes bootstrap auth state
  -> app requests data immediately
```

Atau:

```text
BFF /page-data returns user + permissions + initial data
```

Trade-off: response lebih besar dan coupling lebih tinggi, tapi critical path lebih pendek.

---

## 6. Latency: The Hidden Tax

### 6.1 Round Trip Time

RTT adalah biaya dasar setiap interaksi jaringan.

Jika RTT 150 ms, maka setiap dependency serial minimal menambah sekitar 150 ms, bahkan sebelum server melakukan apa pun.

```text
HTML       1 RTT + server + download
CSS        1 RTT + download
JS         1 RTT + download + parse
API        1 RTT + server + download
image      1 RTT + download
```

HTTP/2 dan HTTP/3 membantu multiplexing, tetapi tidak menghapus dependency serial.

### 6.2 Geographic Latency

User dekat CDN, tapi CDN cache miss ke origin jauh tetap mahal.

```text
User Jakarta -> CDN Singapore: fast
CDN Singapore -> Origin US East: expensive on miss
```

Maka CDN bukan magic.

CDN efektif jika:

- cache hit tinggi;
- origin shield baik;
- TTL benar;
- cache key tidak meledak;
- personalized content tidak dipaksa lewat CDN cache path yang salah;
- stale strategies dipakai dengan benar;
- invalidation predictable.

### 6.3 Connection Setup

Untuk koneksi baru, biaya bisa mencakup:

- DNS lookup;
- TCP handshake;
- TLS handshake;
- ALPN negotiation;
- HTTP/2/3 setup;
- request transfer.

Resource hints seperti `preconnect` dapat membantu jika origin benar-benar critical.

Tapi preconnect berlebihan bisa merusak:

- membuka koneksi yang tidak dipakai;
- membuang battery/mobile resources;
- bersaing dengan origin yang lebih penting;
- membuat noise di waterfall.

Rule of thumb:

```text
preconnect only to critical origins that will definitely be used soon
```

---

## 7. Payload: Bytes Are Not Equal

Mengurangi bytes penting, tapi tidak semua byte sama.

### 7.1 HTML Bytes

HTML biasanya paling critical karena membuka resource discovery.

HTML lambat berarti semua resource lain telat ditemukan.

Optimasi HTML:

- TTFB rendah;
- compression aktif;
- HTML tidak terlalu besar;
- inline critical hints secukupnya;
- preload resource critical;
- hindari blocking personalization berat;
- stream HTML jika cocok;
- cache/revalidate dengan benar.

### 7.2 CSS Bytes

CSS dapat render-blocking.

CSS besar dapat menunda first render dan LCP.

Optimasi CSS:

- hapus unused CSS;
- split critical CSS;
- hindari CSS framework bloat;
- hindari selector pathological;
- pakai preload dengan hati-hati;
- hindari banyak stylesheet serial;
- pastikan caching static asset kuat.

### 7.3 JavaScript Bytes

JavaScript lebih mahal daripada image dengan ukuran sama karena harus:

```text
download -> parse -> compile -> execute
```

JS besar memperburuk:

- startup time;
- hydration;
- INP;
- memory;
- battery;
- low-end device experience.

Optimasi JS:

- code splitting;
- route-based splitting;
- component-level lazy loading secukupnya;
- tree shaking;
- dependency audit;
- avoid heavy polyfills when unnecessary;
- reduce hydration scope;
- move non-critical work off startup;
- avoid loading admin/editor libraries on normal user route;
- delay third-party scripts;
- use web workers for suitable heavy computation.

### 7.4 JSON Bytes

JSON besar sering diremehkan.

Biayanya:

- network transfer;
- decompression;
- parse blocking;
- memory allocation;
- object graph creation;
- rendering cost;
- state normalization cost.

API yang mengirim 2 MB JSON mungkin terlihat “cepat” di backend tapi membuat frontend tersendat.

Optimasi JSON:

- pagination;
- cursor/keyset pagination;
- field selection;
- avoid embedded giant child collections;
- avoid repeated metadata;
- compress text;
- split critical/non-critical data;
- denormalize untuk screen bila perlu;
- stream jika sesuai;
- prefer server aggregation over client N+1.

### 7.5 Image Bytes

Image sering menjadi penyumbang terbesar payload.

Optimasi image:

- responsive images;
- correct dimensions;
- modern formats;
- CDN transformation;
- compression quality sesuai konteks;
- lazy-load non-critical images;
- do not lazy-load LCP image;
- preload LCP image jika discovery terlambat;
- set width/height untuk menghindari CLS;
- use `srcset`/`sizes` dengan benar.

### 7.6 Font Bytes

Font dapat memengaruhi LCP dan CLS.

Optimasi font:

- subset;
- preload critical font;
- `font-display` strategy;
- self-host vs third-party evaluate carefully;
- avoid too many weights/styles;
- cache long-term;
- avoid late-discovered CSS font chain.

---

## 8. Compression: Necessary but Not Sufficient

Compression mengurangi transfer size untuk text-like assets:

- HTML;
- CSS;
- JavaScript;
- JSON;
- SVG;
- text.

Umum:

- gzip;
- Brotli;
- zstd di beberapa environment modern.

Namun compression bukan obat untuk:

- too many serial requests;
- slow TTFB;
- huge parse/evaluation cost;
- render blocking;
- image yang sudah compressed;
- bad API shape;
- cache miss;
- third-party script blocking.

### 8.1 Compression Trade-Off

Compression punya cost CPU.

Untuk static assets, idealnya precompressed at build/deploy time:

```text
app.js
app.js.br
app.js.gz
```

Untuk dynamic API response, compression harus mempertimbangkan:

- payload size threshold;
- CPU overhead;
- latency;
- sensitive reflected data;
- streaming compatibility;
- CDN behavior.

### 8.2 Jangan Compress Semua Hal

Tidak semua response perlu compressed:

- very small payload;
- already compressed media;
- streaming where compression buffering hurts;
- responses with security-sensitive reflection in certain contexts.

---

## 9. HTTP Cache Strategy: Performance + Correctness

Cache adalah salah satu performance multiplier terbesar.

Tapi cache salah adalah correctness incident.

### 9.1 Static Asset Strategy

Untuk hashed assets:

```http
Cache-Control: public, max-age=31536000, immutable
```

Contoh:

```text
/app.8f3a91.js
/styles.1dcd21.css
/logo.a82f10.svg
```

Karena filename berubah saat content berubah, browser/CDN boleh menyimpan sangat lama.

### 9.2 HTML Strategy

HTML biasanya tidak boleh cached terlalu lama tanpa revalidation karena HTML menunjuk ke versi asset.

Strategi umum:

```http
Cache-Control: no-cache
ETag: "..."
```

Artinya boleh disimpan, tapi harus revalidate sebelum digunakan.

Untuk aplikasi yang sangat sensitif:

```http
Cache-Control: no-store
```

Tapi `no-store` mengorbankan performa dan navigasi back/forward behavior, jadi jangan jadikan default tanpa alasan.

### 9.3 API Strategy

API cache tergantung data:

| Jenis response | Strategi umum |
|---|---|
| public reference data | cacheable dengan TTL |
| personalized user data | `private` atau `no-store` |
| volatile dashboard | short TTL / revalidation |
| immutable historical record | long TTL jika aman |
| permission/auth-sensitive | usually no-store/private |
| search results | short TTL atau no-cache tergantung correctness |

Contoh public static reference:

```http
Cache-Control: public, max-age=3600, stale-while-revalidate=86400
```

Contoh personalized:

```http
Cache-Control: private, no-cache
Vary: Authorization, Cookie
```

Namun hati-hati: `Vary: Authorization`/`Cookie` dapat membuat cache key meledak dan shared cache biasanya tidak akan efektif.

### 9.4 CDN Cache Is Not Browser Cache

Browser cache berada di device user.

CDN cache berada di edge/shared infrastructure.

Perbedaannya:

| Aspek | Browser cache | CDN/shared cache |
|---|---|---|
| Scope | satu user/browser | banyak user |
| Risiko leak | lokal | lintas user jika salah |
| Hit benefit | repeat visit user sama | banyak user global |
| Invalidation | sulit dikontrol langsung | bisa purge/surrogate keys |
| Personalized data | bisa private | sangat berbahaya jika salah |

### 9.5 Cache Key Explosion

Cache key bisa dipengaruhi oleh:

- URL;
- query parameters;
- method;
- selected headers via `Vary`;
- CDN rules;
- cookies;
- device hints;
- language;
- encoding.

Jika terlalu banyak variasi:

```text
hit rate drops -> origin load rises -> TTFB worsens -> user experience worsens
```

Contoh buruk:

```http
Vary: User-Agent, Cookie, Accept-Language, Authorization
```

Pada endpoint yang ingin cacheable secara publik, ini bisa membuat setiap user punya cache entry berbeda.

---

## 10. CDN Strategy: Edge Is an Architecture Boundary

CDN bukan sekadar “taruh static file dekat user”.

CDN dapat melakukan:

- static asset caching;
- image transformation;
- compression;
- TLS termination;
- HTTP/2/3 support;
- origin shielding;
- request coalescing;
- cache revalidation;
- edge redirects;
- edge functions;
- WAF;
- bot protection;
- geo routing;
- header mutation;
- stale serving;
- purge/invalidation.

Setiap kemampuan ini bisa mempercepat atau merusak aplikasi.

### 10.1 CDN Hit, Miss, Revalidate

Simplified states:

```text
HIT         -> served from edge cache
MISS        -> edge asks origin
STALE       -> edge has object but freshness expired
REVALIDATED -> edge validates with origin and reuses
BYPASS      -> CDN intentionally does not cache
```

Performance impact:

- HIT: usually fastest.
- MISS: user pays edge + origin latency.
- REVALIDATED: cheaper than full body but still origin round trip.
- BYPASS: CDN mostly acts as proxy.

### 10.2 Origin Shield

Origin shield reduces origin load by making one intermediate cache layer the main origin-facing cache.

Without shield:

```text
many edge POPs -> origin
```

With shield:

```text
many edge POPs -> shield POP -> origin
```

Benefit:

- fewer duplicate origin requests;
- better cache consolidation;
- reduced origin stampede;
- more predictable backend load.

### 10.3 Stale Strategies

Useful directives/patterns:

```http
stale-while-revalidate
stale-if-error
```

Conceptually:

- serve slightly stale content quickly;
- revalidate in background;
- serve stale if origin is failing.

Good for:

- public pages;
- reference content;
- documentation;
- marketing pages;
- non-critical catalog data.

Dangerous for:

- auth-sensitive pages;
- financial balances;
- regulatory actions;
- permissions;
- compliance deadlines;
- mutable workflow state.

As regulatory systems engineer, treat stale cache like a state machine relaxation:

```text
What invariant am I allowing to be temporarily false?
Who can observe stale state?
Can the stale state cause invalid action?
Can the system reconcile safely?
Is there auditability?
```

### 10.4 Cache Purge

Purge strategies:

- purge by URL;
- purge by prefix;
- purge all;
- surrogate keys/tags;
- versioned asset filenames;
- short TTL.

Best practice:

- avoid purge for immutable static assets: use fingerprinted names;
- use surrogate keys for grouped public dynamic content;
- keep HTML revalidation safe;
- design rollback story.

### 10.5 CDN Header Mutation Risk

CDN/proxy may alter:

- `Cache-Control`;
- `Vary`;
- `Content-Encoding`;
- `ETag`;
- `Set-Cookie`;
- CORS headers;
- security headers;
- redirect `Location`;
- `Host`/`X-Forwarded-*`;
- request path/query.

Always verify from the browser and edge, not just origin logs.

---

## 11. API Performance: Avoid Chatty Frontend

Frontend performance is often destroyed by API shape.

### 11.1 N+1 from the Browser

Backend engineers know DB N+1.

Frontend has HTTP N+1:

```text
GET /orders
GET /orders/1/customer
GET /orders/2/customer
GET /orders/3/customer
GET /orders/1/items
GET /orders/2/items
GET /orders/3/items
```

Under good local network, this may seem fine.

Under mobile network, corporate VPN, or high RTT, it collapses.

Solutions:

- include/expand pattern;
- batch endpoint;
- composite screen endpoint;
- GraphQL/data loader style batching;
- BFF aggregation;
- server-side denormalized read model;
- cursor pagination with summary fields.

### 11.2 Sequential API Gate

Bad:

```text
/me -> /permissions -> /features -> /navigation -> /dashboard
```

Better:

```text
parallel where independent
```

Or:

```text
/bootstrap returns me + permissions + features + nav + initial dashboard summary
```

### 11.3 Screen-Oriented vs Resource-Oriented API

Resource-oriented API:

```http
GET /users/me
GET /roles/{id}
GET /permissions?userId=...
GET /accounts?userId=...
GET /alerts?accountId=...
```

Screen-oriented/BFF API:

```http
GET /bff/dashboard-bootstrap
```

Resource-oriented benefits:

- reusable;
- clean domain model;
- independently cacheable;
- simpler semantics.

BFF benefits:

- fewer round trips;
- UI-specific aggregation;
- hides backend topology;
- can optimize critical path;
- can normalize errors;
- can add observability correlation.

Trade-off:

- BFF can become tightly coupled to UI;
- versioning/screen evolution needed;
- over-aggregation can create huge response;
- backend ownership complexity.

Top 1% decision:

```text
Use resource APIs for stable reusable domain access.
Use BFF/composite APIs for latency-sensitive screens with multi-resource critical path.
Do not force either style universally.
```

### 11.4 API Payload Budget

Every endpoint used in critical path should have a budget:

```text
max compressed size
max uncompressed size
max item count
max nesting depth
max p95 server time
max client parse time
max freshness/staleness requirement
```

Example:

```yaml
endpoint: GET /bff/dashboard-bootstrap
critical: true
p75_ttfb_target_ms: 250
p95_ttfb_target_ms: 600
compressed_payload_budget_kb: 80
uncompressed_payload_budget_kb: 300
client_parse_budget_ms_low_end: 50
cache_policy: private, no-cache
retry_policy: no automatic retry after 401/403; retry 502/503 once with jitter
```

---

## 12. BFF and Edge Rendering as Performance Tools

### 12.1 Backend-for-Frontend

BFF can improve performance by:

- aggregating requests;
- hiding service fan-out;
- reducing payload shape;
- centralizing auth/session;
- emitting bootstrap state;
- caching safe fragments;
- providing UI-oriented error contract;
- adding `Server-Timing`;
- reducing browser CORS complexity.

But BFF can hurt if:

- it becomes a giant god gateway;
- every UI change requires backend deployment;
- it serializes backend calls unnecessarily;
- it returns huge screen blobs;
- it destroys cacheability;
- it hides domain errors poorly.

### 12.2 SSR/SSG/ISR/Streaming

Rendering strategy affects HTTP critical path.

Client-side rendering only:

```text
HTML shell -> JS -> API -> render
```

Server-side rendering:

```text
HTML with content -> hydrate -> enhance
```

Static generation:

```text
prebuilt HTML -> CDN -> user
```

Streaming SSR:

```text
HTML starts early -> critical content -> progressive chunks
```

Each has trade-offs:

| Strategy | Strength | Risk |
|---|---|---|
| CSR | simple deployment, app-like | late content, JS dependency |
| SSR | faster first content, SEO | server cost, cache complexity |
| SSG | very fast, CDN-friendly | stale content, rebuild complexity |
| ISR-like | balance freshness/cache | invalidation correctness |
| Streaming SSR | progressive UX | complexity, partial failure |

### 12.3 Bootstrap State

Embedding initial state in HTML can remove one network round trip.

Example:

```html
<script type="application/json" id="__BOOTSTRAP__">
{
  "user": { "id": "u123", "name": "Ari" },
  "permissions": ["case:read", "case:assign"],
  "featureFlags": { "newDashboard": true }
}
</script>
```

Benefits:

- avoids `/me` + `/permissions` gate;
- app can render immediately;
- fewer race conditions.

Risks:

- XSS escaping must be correct;
- HTML becomes personalized and less cacheable;
- payload can grow;
- stale bootstrap state can conflict with API;
- sensitive data leakage.

Rule:

```text
Only bootstrap data that is needed immediately and safe to expose to the current user.
```

---

## 13. Resource Hints: Powerful but Easy to Abuse

### 13.1 `dns-prefetch`

Starts DNS resolution early.

Good for:

- third-party origin likely needed;
- low-cost hint.

Not enough if connection/TLS is the real bottleneck.

### 13.2 `preconnect`

Starts DNS + connection + TLS early.

Good for:

- critical third-party font/image/API origin;
- origin definitely needed soon.

Bad if:

- too many origins;
- speculative only;
- mobile resource constrained;
- competes with main origin.

### 13.3 `preload`

Tells browser to fetch a specific resource early because current page needs it.

Good for:

- LCP image discovered late;
- critical font;
- critical CSS/JS where default discovery is late.

Bad if:

- resource not used;
- wrong `as` type;
- wrong CORS attributes;
- preloading too many non-critical resources;
- preloaded resource duplicates normal request because attributes mismatch.

### 13.4 `prefetch`

Fetches resource likely needed for future navigation.

Good for:

- likely next route;
- idle time;
- non-critical future resource.

Bad if:

- user may not navigate there;
- bandwidth constrained;
- competes with current page;
- private data cached incorrectly.

### 13.5 `fetchpriority`

Provides relative priority hint.

Common use:

```html
<img src="/hero.jpg" fetchpriority="high" width="1200" height="600" alt="...">
```

Use carefully:

- high for true LCP candidate;
- low for non-critical images;
- do not mark everything high.

If everything is high, nothing is high.

---

## 14. Bundling Strategy under HTTP/2 and HTTP/3

### 14.1 Historical HTTP/1.1 Thinking

Under HTTP/1.1, too many requests were costly because of connection limits and head-of-line blocking.

This pushed practices like:

- giant bundles;
- sprites;
- domain sharding;
- aggressive concatenation.

### 14.2 HTTP/2/3 Changed the Trade-Off, Not the Goal

HTTP/2/3 allow multiplexing, so many smaller resources are less costly than before.

But this does not mean unlimited chunks are good.

Each chunk can still cause:

- request overhead;
- prioritization complexity;
- cache fragmentation;
- module graph waterfall;
- CPU parse/evaluate;
- delayed execution dependency.

### 14.3 Too Big Bundle

Symptoms:

- slow startup;
- high JS parse/compile;
- poor INP;
- long tasks;
- low-end devices suffer;
- route loads unnecessary code.

### 14.4 Too Many Tiny Chunks

Symptoms:

- chunk waterfall;
- request scheduling overhead;
- duplicate shared dependencies;
- cache inefficiency;
- worse cold load;
- hard-to-debug missing chunk after deployment.

### 14.5 Practical Strategy

Use chunking aligned to:

- route boundaries;
- feature boundaries;
- access patterns;
- dependency weight;
- critical vs non-critical code;
- cache stability.

Good pattern:

```text
runtime/vendor stable chunk
route-level chunks
heavy feature lazy chunks
admin/editor chunks separated
critical route minimized
```

Bad pattern:

```text
one giant app.js containing every product surface
```

Also bad:

```text
hundreds of microchunks with runtime waterfall
```

---

## 15. Third-Party Scripts: Performance Supply Chain Risk

Third-party scripts include:

- analytics;
- tag managers;
- ads;
- chat widgets;
- A/B testing;
- heatmap tools;
- fraud detection;
- auth widgets;
- payment widgets;
- maps;
- social embeds.

They can affect:

- network waterfall;
- main thread;
- privacy/security;
- CSP;
- cookie behavior;
- layout shifts;
- long tasks;
- INP;
- failure rates.

### 15.1 Governance Questions

Before adding a third-party script:

1. Is it critical to primary user task?
2. Does it block rendering?
3. Does it run before consent?
4. Does it create layout shift?
5. Does it add long tasks?
6. Does it load more scripts recursively?
7. Does it need cookies/storage?
8. Does it conflict with CSP?
9. What happens when it is slow/down?
10. Who owns monitoring and removal?

### 15.2 Loading Strategy

Options:

- defer;
- async;
- load after interaction;
- load after consent;
- load after LCP;
- sandbox in iframe;
- server-side proxy for limited use cases;
- replace with lighter implementation;
- remove.

Often the best optimization is deletion.

---

## 16. Critical Rendering Path and HTTP

### 16.1 HTML Is the Root

Everything starts with HTML.

Slow HTML means slow discovery.

HTML performance levers:

- reduce redirect;
- reduce TTFB;
- CDN cache/revalidate;
- stream when appropriate;
- embed critical hints;
- avoid blocking personalization;
- avoid enormous inline scripts.

### 16.2 CSS Blocks Rendering

CSS must be available before browser can safely render styled content.

Avoid:

- huge CSS bundle;
- many serial CSS imports;
- render-blocking non-critical CSS;
- late font CSS from third-party;
- CSS loaded by JS when needed for initial view.

### 16.3 JavaScript Can Block Parsing and Rendering

Script behavior matters:

- classic script without `defer/async` blocks parser;
- `defer` waits until document parsed;
- `async` executes when downloaded;
- module scripts are deferred by default conceptually;
- hydration can block interactivity.

Critical question:

```text
Does this JavaScript need to run before the user sees/uses the page?
```

If no, move it out of startup path.

### 16.4 Fonts and Layout

Font loading can delay text rendering or cause layout shifts.

Use:

- correct fallback;
- `font-display` decision;
- preload critical font;
- subset;
- stable dimensions;
- avoid too many variants.

---

## 17. API Waterfall vs Rendering Waterfall

There are two common waterfalls:

### 17.1 Resource Waterfall

```text
HTML -> CSS -> JS -> font/image
```

### 17.2 Data Waterfall

```text
JS -> config -> session -> permissions -> data -> details
```

Modern SPA often has both.

The real critical path can become:

```text
HTML
  -> JS bundle
      -> config API
          -> auth API
              -> permissions API
                  -> page API
                      -> image/resource URLs
```

This is why “backend endpoint p95 = 100ms” does not guarantee fast page load.

### 17.3 Collapse Data Waterfall

Options:

- server render page data;
- BFF bootstrap endpoint;
- parallelize independent requests;
- preload API with `<link rel="preload" as="fetch">` where appropriate;
- use route loaders;
- cache stable data;
- avoid client-only auth gating when server already knows session;
- use optimistic/skeleton rendering for non-critical data.

---

## 18. Performance Budget

Performance budget converts “make it fast” into enforceable constraints.

### 18.1 Budget Types

Use multiple budgets:

| Budget | Example |
|---|---|
| User metric | LCP p75 <= 2.5s |
| Interaction metric | INP p75 <= 200ms |
| Stability metric | CLS p75 <= 0.1 |
| Payload | initial JS compressed <= 180KB |
| Request count | critical path requests <= N |
| API | dashboard bootstrap p95 TTFB <= 600ms |
| Image | LCP image <= 150KB compressed/mobile |
| CPU | no startup long task > 50ms budgeted |
| Cache | static asset hit ratio >= target |
| Third-party | total third-party JS <= limit |

### 18.2 Budget by Route

Do not use one global budget for all pages.

Budget by route class:

- public landing page;
- login page;
- dashboard;
- detail page;
- admin heavy page;
- editor/workbench;
- report/export page.

Example:

```yaml
route: /dashboard
class: authenticated-critical
field_metrics:
  p75_lcp: <= 2500ms
  p75_inp: <= 200ms
  p75_cls: <= 0.1
network:
  critical_requests: <= 8
  initial_js_gzip: <= 220KB
  initial_css_gzip: <= 60KB
  lcp_image_transfer: <= 180KB
api:
  bootstrap_p95_ttfb: <= 600ms
  max_bootstrap_payload_gzip: <= 80KB
cache:
  static_assets: public, max-age=31536000, immutable
  html: no-cache with ETag
third_party:
  blocking_scripts: 0
```

### 18.3 Budget Enforcement

Use budgets in:

- PR checks;
- Lighthouse CI;
- bundle analyzer;
- RUM dashboards;
- synthetic monitoring;
- API contract review;
- CDN observability;
- release gates.

Budgets should fail builds only when signal is stable enough. Otherwise start with warnings and trend reports.

---

## 19. Performance Diagnosis Playbook

### 19.1 Symptom: High LCP

Ask:

1. What is the LCP element?
2. Was it text or image?
3. When was it discovered?
4. Was it preloaded?
5. Was it lazy-loaded by mistake?
6. Was CSS blocking render?
7. Was JS required before content appeared?
8. Was TTFB high?
9. Was image too large?
10. Was resource priority wrong?
11. Was CDN cache hit?
12. Was there redirect?

Common fixes:

- reduce TTFB;
- SSR/SSG critical content;
- preload LCP image;
- avoid lazy-loading LCP image;
- optimize image size/format;
- inline critical hints;
- reduce render-blocking CSS;
- reduce startup JS.

### 19.2 Symptom: High TTFB

Ask:

1. Is TTFB high at CDN edge or origin?
2. Is it cache HIT/MISS/BYPASS?
3. Is there redirect before document?
4. Is backend slow?
5. Is origin far from user?
6. Is TLS/connect included because connection not reused?
7. Is server rendering slow?
8. Are there blocking downstream calls?
9. Is CDN revalidating every time?
10. Is WAF/bot protection adding delay?

Common fixes:

- CDN cache/revalidate;
- reduce redirects;
- move origin closer or use edge;
- optimize backend critical path;
- stream HTML;
- origin shield;
- avoid per-request expensive personalization;
- add Server-Timing to expose backend phases.

### 19.3 Symptom: High INP

Ask:

1. Which interaction?
2. Is main thread blocked?
3. Which long task?
4. Is handler doing sync work?
5. Is large JSON parse happening after interaction?
6. Is rendering huge subtree?
7. Is third-party code involved?
8. Is hydration still running?
9. Is input causing expensive layout?

Common fixes:

- split long tasks;
- reduce JS;
- defer non-critical work;
- virtualize large lists;
- reduce render scope;
- move heavy work to worker;
- avoid synchronous storage in hot path;
- optimize event handler.

### 19.4 Symptom: API Feels Slow

Ask:

1. Is the API request itself slow, or does it start late?
2. Is it blocked behind config/auth/permissions?
3. Is there preflight?
4. Is there DNS/connect/TLS cost?
5. Is TTFB high or download high?
6. Is JSON parse/render high?
7. Is request duplicated?
8. Is retry/backoff happening silently?
9. Is service worker intercepting?
10. Is CDN/proxy bypassing cache?

Common fixes:

- start earlier;
- parallelize;
- aggregate;
- cache;
- reduce payload;
- remove custom header causing unnecessary preflight if safe;
- collapse auth gate;
- add observability.

### 19.5 Symptom: Fast Locally, Slow in Production

Possible reasons:

- production CDN/origin geography;
- auth/security middleware;
- real data volume;
- third-party scripts;
- compression mismatch;
- cache disabled/misconfigured;
- TLS/certificate/proxy;
- CORS/preflight;
- service worker;
- feature flags;
- source maps accidentally served;
- debug build;
- monitoring scripts;
- different browser/device.

Evidence needed:

- production HAR;
- RUM percentile;
- Server-Timing;
- CDN logs;
- backend traces;
- bundle report;
- resource timing;
- device profile.

---

## 20. Advanced Pattern: Performance as State Machine

For complex applications, model page load as states:

```text
INIT
  -> DOCUMENT_REQUESTED
  -> DOCUMENT_RECEIVED
  -> CRITICAL_RESOURCES_DISCOVERED
  -> APP_BOOTSTRAPPED
  -> AUTH_STATE_KNOWN
  -> CRITICAL_DATA_AVAILABLE
  -> ABOVE_THE_FOLD_RENDERED
  -> INTERACTIVE
  -> NON_CRITICAL_DATA_LOADED
```

Each transition has:

- trigger;
- dependency;
- timeout;
- failure mode;
- retry policy;
- fallback UI;
- observability event.

Example:

```yaml
state: AUTH_STATE_KNOWN
entry_dependencies:
  - session cookie available or bootstrap user state
  - /session response if not bootstrapped
failure_modes:
  - 401 unauthenticated
  - network timeout
  - CORS/cookie failure
  - stale bootstrap state
fallback:
  - show login redirect state
  - retry session once for transient network
observability:
  - auth_state_duration_ms
  - auth_state_source: bootstrap|api|cache
```

This helps prevent vague discussions like:

> “The app is slow.”

Instead:

> “The transition from APP_BOOTSTRAPPED to CRITICAL_DATA_AVAILABLE is p95 1.8s because `/permissions` waits on `/me`, then `/dashboard` waits on `/permissions`; each has CORS preflight due to custom headers.”

That is actionable.

---

## 21. Performance and Correctness Trade-Offs

Fast is not always correct.

Examples:

### 21.1 Stale Permissions

Caching permissions improves speed.

But stale permissions may allow invalid UI actions.

Mitigation:

- cache only for display hints;
- enforce on server;
- short TTL;
- revalidate on sensitive action;
- show action failure clearly;
- audit denial.

### 21.2 Optimistic UI

Optimistic UI improves perceived speed.

But wrong optimism causes confusion.

Mitigation:

- use for reversible/low-risk actions;
- represent pending state;
- handle rollback;
- use idempotency key;
- design conflict handling.

### 21.3 CDN Stale Content

Stale public content improves resilience.

But stale regulatory/legal content can be harmful.

Mitigation:

- classify data freshness requirement;
- mark authoritative timestamp;
- use explicit versioning;
- avoid stale for compliance-critical actions;
- audit rendered version.

### 21.4 Prefetching Private Data

Prefetch improves navigation.

But can waste bandwidth or load data user never requested.

Mitigation:

- prefetch only likely/safe data;
- respect user/data saver;
- avoid sensitive side-effectful endpoints;
- ensure GET is safe;
- avoid authorization leakage through cache.

---

## 22. Practical Architecture Patterns

### 22.1 Fast Public Marketing Page

Goal:

- fast LCP;
- high cacheability;
- minimal JS;
- SEO friendly.

Pattern:

```text
CDN cached HTML/SSG
fingerprinted assets
optimized hero image
critical CSS
minimal third-party delayed
long-lived static cache
```

Headers:

```http
HTML: Cache-Control: public, max-age=60, stale-while-revalidate=86400
Assets: Cache-Control: public, max-age=31536000, immutable
```

### 22.2 Authenticated Dashboard

Goal:

- fast bootstrap;
- correct auth/permissions;
- no shared cache leak;
- useful skeletons.

Pattern:

```text
HTML no-cache/private
bootstrap auth state if safe
BFF dashboard bootstrap
parallel non-critical widgets
static assets immutable
Server-Timing for backend phases
```

Headers:

```http
HTML: Cache-Control: private, no-cache
API: Cache-Control: private, no-cache or no-store depending sensitivity
Assets: public, max-age=31536000, immutable
```

### 22.3 Enterprise Case Management Screen

Goal:

- correctness and auditability;
- predictable mutation;
- avoid loading entire case universe;
- handle permissions and workflow state.

Pattern:

```text
case summary endpoint
lazy-load tabs/attachments/history
cursor pagination for events
ETag/If-Match for updates
explicit freshness timestamp
server-enforced permissions
frontend state machine for workflow transitions
```

Performance principle:

```text
load what is needed to make the next valid user decision
not every related entity
```

### 22.4 Heavy Admin/Editor Route

Goal:

- keep normal user path light;
- load heavy editor only when needed.

Pattern:

```text
route-level lazy chunk
editor libraries separated
preload after route intent
worker for heavy processing
save drafts with idempotency
```

---

## 23. Common Anti-Patterns and Better Replacements

### 23.1 Anti-Pattern: One Giant Bundle

Bad:

```text
Every user downloads admin, charts, editor, maps, experiments, legacy polyfills.
```

Better:

```text
Route/feature-based chunks + dependency governance + performance budget.
```

### 23.2 Anti-Pattern: API Per Component

Bad:

```text
Each component calls its own endpoint independently on mount.
```

Result:

- request storm;
- duplicate calls;
- inconsistent loading states;
- hard-to-control critical path;
- bad caching.

Better:

```text
Route-level data loading + shared query cache + BFF/composite endpoint where useful.
```

### 23.3 Anti-Pattern: Cache Disabled Everywhere

Bad:

```http
Cache-Control: no-store
```

on every response.

Better:

```text
Classify data.
Use immutable caching for static assets.
Use no-cache/revalidation where freshness matters.
Use no-store only where storage is unsafe.
```

### 23.4 Anti-Pattern: Preload Everything

Bad:

```html
<link rel="preload" href="/every-resource.js" as="script">
```

Better:

```text
Preload only critical resources that browser would discover too late.
```

### 23.5 Anti-Pattern: CDN as Afterthought

Bad:

```text
Enable CDN after app design, hope it helps.
```

Better:

```text
Design URL, cache headers, invalidation, personalization boundaries, and observability with CDN in mind.
```

### 23.6 Anti-Pattern: Performance Only Measured Locally

Bad:

```text
Works fast on developer laptop with local network.
```

Better:

```text
Measure field p75/p95 by route, device class, geography, network type, and release version.
```

---

## 24. Performance Review Checklist

Use this in PR/design review.

### 24.1 Page Load

- [ ] What is the LCP element?
- [ ] Is it discoverable early?
- [ ] Is it render-blocked by CSS/JS?
- [ ] Are there unnecessary redirects?
- [ ] Is HTML TTFB acceptable?
- [ ] Are critical assets cacheable?
- [ ] Are non-critical assets delayed?
- [ ] Is startup JS within budget?

### 24.2 API

- [ ] Are API calls parallel where possible?
- [ ] Is there a data waterfall?
- [ ] Is a BFF/composite endpoint justified?
- [ ] Is payload bounded?
- [ ] Is pagination correct?
- [ ] Are fields over-fetched?
- [ ] Is JSON parse/render cost acceptable?
- [ ] Is cache policy explicit?
- [ ] Is error contract clear?

### 24.3 Cache/CDN

- [ ] Are static assets fingerprinted?
- [ ] Do assets use long immutable caching?
- [ ] Is HTML cached/revalidated safely?
- [ ] Are personalized responses protected?
- [ ] Is `Vary` necessary and bounded?
- [ ] Is purge/invalidation strategy defined?
- [ ] Can CDN serve stale safely?
- [ ] Are cache HIT/MISS metrics visible?

### 24.4 Browser/Main Thread

- [ ] Are there long tasks during startup?
- [ ] Is hydration excessive?
- [ ] Are heavy libraries lazy-loaded?
- [ ] Are third-party scripts governed?
- [ ] Is large JSON parsed on main thread?
- [ ] Are list renders virtualized where necessary?
- [ ] Is interaction work deferred/split?

### 24.5 Observability

- [ ] Are Resource Timing metrics collected?
- [ ] Is route-level RUM available?
- [ ] Are CWV measured in field?
- [ ] Is `Server-Timing` emitted for critical endpoints?
- [ ] Is trace/correlation propagated?
- [ ] Can we distinguish CDN hit/miss?
- [ ] Can we compare release versions?

---

## 25. Worked Example: Slow Dashboard

### 25.1 Symptom

User says:

```text
Dashboard takes 5 seconds to load.
```

### 25.2 Bad Investigation

```text
Backend says /dashboard API is 180 ms. Must be frontend.
Frontend says API is slow. Must be backend.
```

This is not diagnosis. This is blame routing.

### 25.3 Evidence

Waterfall:

```text
0 ms      GET /dashboard -> 302 /login-check
200 ms    GET /dashboard again
450 ms    HTML complete
500 ms    GET /assets/app.js
1300 ms   app.js complete
1800 ms   JS evaluated
1850 ms   OPTIONS /api/config
2050 ms   GET /api/config
2300 ms   OPTIONS /api/me
2500 ms   GET /api/me
2800 ms   OPTIONS /api/permissions
3050 ms   GET /api/permissions
3350 ms   OPTIONS /api/dashboard
3600 ms   GET /api/dashboard
3900 ms   dashboard data complete
4100 ms   render
4500 ms   GET hero/chart assets
5000 ms   LCP
```

### 25.4 Root Causes

1. Redirect at document start.
2. Large JS delays all API calls.
3. Config/auth/permissions/dashboard are serial.
4. Custom headers trigger preflight for each API.
5. LCP content depends on dashboard API and JS rendering.
6. Chart asset discovered late.

### 25.5 Fix Plan

Short-term:

- remove unnecessary document redirect;
- reduce initial JS bundle;
- parallelize config/me/permissions where possible;
- remove non-essential custom headers that trigger preflight if safe;
- add `Access-Control-Max-Age` for preflight cache;
- preload chart/critical visual asset if needed;
- add Server-Timing and RUM markers.

Medium-term:

- create `/bff/dashboard-bootstrap` returning critical user + permissions + dashboard summary;
- serve static assets with immutable cache;
- embed minimal bootstrap config in HTML;
- split non-critical widgets after first render.

Long-term:

- route-level performance budget;
- synthetic + field monitoring;
- CDN cache strategy;
- third-party governance;
- architectural rule: no serial API chain on critical route without justification.

### 25.6 Expected New Critical Path

```text
HTML
  -> app.js smaller
  -> /bff/dashboard-bootstrap
  -> render above-the-fold
  -> load non-critical widgets later
```

---

## 26. Worked Example: CDN Cache Makes Site Fast but Wrong

### 26.1 Symptom

Some users see another user's dashboard summary.

### 26.2 Evidence

Response:

```http
HTTP/1.1 200 OK
Cache-Control: public, max-age=300
Set-Cookie: session=...
X-Cache: HIT
```

Endpoint:

```http
GET /api/dashboard-summary
```

### 26.3 Root Cause

Personalized response cached as public at CDN.

### 26.4 Fix

```http
Cache-Control: private, no-store
```

or depending requirements:

```http
Cache-Control: private, no-cache
Vary: Cookie
```

But for shared CDN, safer default for personalized auth data:

```http
Cache-Control: no-store
```

Also:

- CDN rule: bypass cache for authenticated API paths;
- response tests for cache headers;
- security review;
- purge leaked cache;
- incident audit.

### 26.5 Lesson

Performance optimization that violates data isolation is not optimization. It is an incident.

---

## 27. Worked Example: Bundle Split Made Things Slower

### 27.1 Symptom

After aggressive code splitting, initial JS size dropped 40%, but page load got slower.

### 27.2 Evidence

Waterfall:

```text
app-runtime.js
route-dashboard.js
chart-core.js
chart-plugin-a.js
chart-plugin-b.js
date-lib-locale.js
permissions-widget.js
summary-card.js
...
```

Many chunks discovered only after previous chunks executed.

### 27.3 Root Cause

Chunk graph created execution waterfall.

### 27.4 Fix

- merge tightly coupled critical route chunks;
- lazy-load below-the-fold widgets;
- preload known critical route chunk;
- separate stable vendor only if cache benefit is real;
- analyze actual route graph;
- measure cold and warm load.

### 27.5 Lesson

Smaller total initial bytes can be worse if it creates serial dependency.

---

## 28. Top 1% Mental Models

### 28.1 Start Earlier Beats Finish Faster

A 500 ms image request that starts at 200 ms beats a 200 ms image request that starts at 1800 ms.

Discovery timing matters.

### 28.2 Fewer Round Trips Beats Faster Round Trips

If you remove a serial dependency, you remove its RTT cost entirely.

### 28.3 Cache Is a Correctness Contract

Every cached response answers:

```text
Who may reuse this?
For how long?
Under what variation?
What happens when origin changes?
What happens when origin fails?
```

### 28.4 Payload Has Runtime Cost

Compressed size is not enough.

Track:

- transfer size;
- decoded size;
- parse cost;
- memory;
- render cost.

### 28.5 Browser Is a Scheduler

The browser prioritizes, queues, discovers, cancels, coalesces, blocks, and isolates.

HTTP performance is not just server response time.

### 28.6 CDN Is Part of the System

If CDN can change headers, cache, redirect, compress, or serve stale, then CDN is not transparent.

It is a runtime component.

### 28.7 Performance Is Route-Specific

A login page, dashboard, editor, and report page have different budgets and bottlenecks.

### 28.8 Perceived Speed Is State Design

Skeletons, optimistic UI, progressive rendering, and partial data can improve perceived speed only if state transitions are honest and recoverable.

---

## 29. Practical Rules of Thumb

1. Remove unnecessary redirects before optimizing anything else.
2. Make LCP resource discoverable early.
3. Do not lazy-load the LCP image.
4. Keep startup JS small and purposeful.
5. Do not let every component independently fetch critical data.
6. Collapse serial API gates.
7. Cache immutable assets aggressively.
8. Treat personalized response caching as dangerous by default.
9. Use `preconnect` sparingly.
10. Use `preload` only for resources definitely needed by current page.
11. Measure field performance, not just local Lighthouse.
12. Separate network time from main-thread time.
13. Add `Server-Timing` to critical backend paths.
14. Track CDN hit/miss.
15. Use performance budgets per route.
16. Audit third-party scripts like production dependencies.
17. Optimize for p75/p95 users, not only your laptop.
18. Prefer deleting work over making work faster.
19. Optimize critical path before non-critical assets.
20. Never trade correctness/security for speed without explicit product and risk acceptance.

---

## 30. Mini-Lab: Diagnose a Waterfall

Given:

```text
0 ms       GET /app -> 301 /app/
180 ms     GET /app/ -> 200 HTML
450 ms     GET /main.css
460 ms     GET /main.js
1300 ms    main.js complete
1800 ms    JS evaluated
1810 ms    GET /api/session
2050 ms    GET /api/features
2300 ms    GET /api/dashboard
2800 ms    dashboard complete
2850 ms    GET /assets/hero.webp
3800 ms    hero complete
4000 ms    LCP
```

Questions:

1. What is the first obvious waste?
2. Which resource is discovered too late?
3. Which API dependency may be collapsed?
4. What can be cached more aggressively?
5. What metric is likely poor?
6. What evidence do you need before changing backend?

Suggested reasoning:

1. The 301 redirect adds avoidable latency.
2. Hero image is discovered after dashboard data and JS execution.
3. Session/features/dashboard may be bootstrapped or parallelized depending dependencies.
4. `main.css`, `main.js`, and `hero.webp` if fingerprinted can use long immutable cache.
5. LCP is likely poor.
6. Need DevTools waterfall, Resource Timing, Server-Timing, CDN hit/miss, bundle analysis, and field RUM.

---

## 31. What Not to Do

Avoid these simplistic solutions:

```text
"Just use CDN."
"Just enable Brotli."
"Just split bundle more."
"Just use SSR."
"Just cache everything."
"Just use GraphQL."
"Just use HTTP/3."
"Just use lazy loading everywhere."
"Just use preload everywhere."
```

Each can help in a specific bottleneck.

Each can hurt if applied without system understanding.

Correct performance engineering starts from evidence:

```text
symptom -> metric -> trace/waterfall -> dependency graph -> root cause -> targeted change -> verify field impact
```

---

## 32. References

Standards and primary references:

- RFC 9110 — HTTP Semantics: https://www.rfc-editor.org/rfc/rfc9110.html
- RFC 9111 — HTTP Caching: https://www.rfc-editor.org/rfc/rfc9111.html
- RFC 9112 — HTTP/1.1: https://www.rfc-editor.org/rfc/rfc9112.html
- RFC 9113 — HTTP/2: https://www.rfc-editor.org/rfc/rfc9113.html
- RFC 9114 — HTTP/3: https://www.rfc-editor.org/rfc/rfc9114.html
- W3C Resource Timing: https://www.w3.org/TR/resource-timing/
- W3C Server Timing: https://www.w3.org/TR/server-timing/

Browser/platform references:

- web.dev — Web Vitals: https://web.dev/articles/vitals
- web.dev — Optimize Largest Contentful Paint: https://web.dev/articles/optimize-lcp
- web.dev — Fetch Priority API: https://web.dev/articles/fetch-priority
- MDN — HTTP caching: https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching
- MDN — Cache-Control: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control
- MDN — PerformanceResourceTiming: https://developer.mozilla.org/en-US/docs/Web/API/PerformanceResourceTiming
- MDN — Server-Timing: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Server-Timing
- Chrome Developers — LCP request discovery: https://developer.chrome.com/docs/performance/insights/lcp-discovery

---

## 33. Ringkasan

Performance web adalah hasil dari banyak lapisan:

```text
browser discovery
network latency
HTTP transport
cache/CDN
backend response
payload size
JavaScript runtime
rendering
interaction
user perception
```

Untuk menjadi kuat di area ini, jangan hanya bertanya:

```text
How do I make this request faster?
```

Tanyakan:

```text
Why is this request needed?
Why does it start now?
What blocks it?
Can it be removed, cached, parallelized, moved earlier, made smaller, or made non-critical?
What correctness/security invariant changes if we do that?
How will we prove improvement in production?
```

Itulah perbedaan antara optimasi kosmetik dan performance engineering yang matang.

---

## 34. Status Seri

```text
Part 029 selesai.
Seri belum selesai.
Lanjut ke Part 030: Reliability: Retries, Timeouts, Cancellation, Backoff, Rate Limits.
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-http-for-web-frontend-perspective-part-028.md">⬅️ Part 028 — Observability: Network Debugging, Correlation, Tracing, and RUM</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-http-for-web-frontend-perspective-part-030.md">Part 030 — Reliability: Retries, Timeouts, Cancellation, Backoff, Rate Limits ➡️</a>
</div>
