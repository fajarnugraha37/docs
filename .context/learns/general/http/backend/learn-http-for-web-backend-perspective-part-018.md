# learn-http-for-web-backend-perspective-part-018.md

# Part 018 — Rate Limiting, Quotas, and Abuse Control

> Series: **HTTP for Web/Backend Perspective**  
> Audience: **Java Software Engineer / Backend Engineer**  
> Goal: memahami rate limiting bukan sebagai fitur kosmetik gateway, tetapi sebagai mekanisme fairness, overload prevention, security control, cost guardrail, dan bagian dari kontrak HTTP production.

---

## 0. Posisi Part Ini dalam Seri

Sampai Part 017, kita sudah membangun fondasi HTTP backend:

- semantics;
- method;
- status code;
- header;
- body/framing;
- URI/resource modeling;
- representation;
- validation;
- error design;
- idempotency;
- conditional requests;
- caching;
- authentication;
- authorization;
- cookies/session/CSRF;
- CORS.

Part ini masuk ke pertanyaan production yang berbeda:

> Bagaimana server tetap adil, stabil, murah, dan aman ketika client sah, client salah implementasi, scraper, bot, integrasi partner, user internal, atau attacker mengirim traffic yang terlalu banyak atau terlalu mahal?

Rate limiting sering dipahami terlalu sempit sebagai:

> “Maksimal 100 request per menit.”

Padahal di backend production, rate limiting adalah gabungan dari:

1. **fairness** — satu consumer tidak boleh menghabiskan kapasitas bersama;
2. **overload protection** — sistem harus tetap hidup saat traffic naik;
3. **abuse control** — bot, brute force, scraping, enumeration, credential stuffing;
4. **cost control** — request yang memicu downstream mahal perlu dibatasi;
5. **tenant isolation** — tenant besar tidak boleh merusak tenant lain;
6. **contract clarity** — client perlu tahu kapan harus melambat;
7. **operational safety** — saat incident, limit bisa menjadi rem darurat;
8. **regulatory defensibility** — kebijakan pembatasan harus konsisten dan dapat diaudit.

---

## 1. Mental Model Utama

### 1.1 Rate limiting adalah resource allocation policy

Setiap request memakai resource:

- CPU;
- memory;
- thread;
- event-loop time;
- database connection;
- database lock;
- query planner/executor time;
- cache bandwidth;
- outbound HTTP connection;
- message queue capacity;
- third-party API quota;
- object storage I/O;
- disk;
- log ingestion quota;
- observability cardinality;
- human review capacity dalam workflow.

Maka rate limit bukan hanya “berapa request”. Ia adalah jawaban atas pertanyaan:

> Siapa boleh memakai resource apa, seberapa banyak, dalam interval apa, dengan prioritas apa, dan apa yang terjadi ketika limit dilanggar?

### 1.2 Rate limiting tidak sama dengan authorization

Authorization menjawab:

> Apakah caller ini boleh melakukan operasi ini terhadap resource ini?

Rate limiting menjawab:

> Walaupun caller boleh, apakah caller ini masih boleh memakai kapasitas sistem sekarang?

Contoh:

- user boleh melihat case detail;
- tetapi tidak boleh menembak endpoint detail 10.000 kali per menit;
- partner boleh submit laporan;
- tetapi hanya 1.000 submission per jam sesuai kontrak;
- admin boleh export data;
- tetapi export besar harus dibatasi agar tidak mematikan database.

### 1.3 Rate limiting tidak sama dengan throttling

Istilah sering tumpang tindih, tetapi untuk mental model:

- **rate limiting**: memutuskan allowed/rejected berdasarkan policy;
- **throttling**: memperlambat request, menunda, atau mengurangi throughput;
- **quota**: jatah konsumsi dalam periode lebih panjang;
- **concurrency limit**: membatasi jumlah request aktif bersamaan;
- **cost limit**: membatasi konsumsi berdasarkan bobot operasi, bukan jumlah request;
- **load shedding**: menolak traffic saat sistem overload agar core system tetap hidup.

---

## 2. Kenapa Backend Engineer Harus Peduli

Banyak engineer menganggap rate limiting adalah urusan API gateway. Itu hanya sebagian benar.

Gateway bisa membatasi traffic yang mudah dikenali:

- per IP;
- per API key;
- per route;
- per method;
- per tenant header;
- per token subject.

Tetapi application/backend sering satu-satunya layer yang tahu:

- operasi ini murah atau mahal;
- user ini premium atau free;
- tenant ini punya kontrak quota berbeda;
- query ini menyentuh jutaan row;
- export ini butuh async job;
- state case ini sensitif;
- endpoint ini rentan enumeration;
- request ini melewati authorization tapi tetap suspicious;
- downstream provider punya limit 100 call/menit;
- operasi ini memicu workflow manual.

Jadi rate limiting idealnya adalah **multi-layer control**:

```text
Internet / Client
   ↓
CDN / WAF
   ↓
Load Balancer
   ↓
API Gateway / Reverse Proxy
   ↓
Service Mesh / Sidecar
   ↓
Application Filter / Middleware
   ↓
Controller / Handler
   ↓
Application Service
   ↓
Database / Queue / Third-party API
```

Setiap layer punya informasi dan kemampuan berbeda.

---

## 3. Threat and Failure Model

### 3.1 Accidental overload

Tidak semua traffic berbahaya berasal dari attacker.

Contoh:

- frontend bug melakukan polling setiap 100 ms;
- mobile app retry tanpa exponential backoff;
- batch partner salah konfigurasi dan mengirim ulang file ribuan kali;
- integrasi internal loop karena gagal memproses 500;
- client menganggap 429 sama dengan 500 lalu retry agresif;
- dashboard auto-refresh melakukan query mahal.

### 3.2 Malicious abuse

Contoh:

- credential stuffing;
- brute force OTP;
- username/email enumeration;
- scraping;
- resource enumeration;
- file download abuse;
- expensive query attack;
- signup spam;
- comment/report spam;
- webhook replay flood;
- API key sharing;
- tenant attempting to exceed plan;
- bot creating many sessions.

### 3.3 Economic denial of service

Request belum tentu menjatuhkan server, tetapi bisa menaikkan biaya:

- memicu call ke AI provider;
- memicu SMS/email OTP;
- memicu geocoding API;
- memicu PDF generation;
- memicu export besar;
- memicu log/trace besar;
- memicu storage egress;
- memicu database read replica autoscaling.

Dalam sistem production, biaya juga resource.

### 3.4 Fairness failure

Tanpa fairness, tenant besar atau client buruk bisa menyebabkan:

- latency tenant lain naik;
- queue penuh;
- pool database habis;
- thread pool saturated;
- cache hit ratio turun;
- shared downstream limit habis;
- SLA/SLO pelanggan lain gagal.

Rate limiting adalah bagian dari **multi-tenant isolation**.

---

## 4. Dimensi Pembatasan

Policy rate limit yang matang biasanya bukan satu angka global. Ia punya beberapa dimensi.

### 4.1 By source IP

Cocok untuk:

- anonymous endpoint;
- login;
- signup;
- password reset;
- public search;
- unauthenticated scraping prevention.

Keterbatasan:

- NAT membuat banyak user berbagi IP;
- attacker bisa memakai botnet/proxy;
- IPv6 prefix handling perlu hati-hati;
- reverse proxy bisa membuat semua request terlihat dari IP proxy jika forwarding salah.

### 4.2 By authenticated user

Cocok untuk:

- user API;
- dashboard;
- personal data access;
- expensive operation.

Keterbatasan:

- satu organisasi bisa punya banyak user;
- compromised account tetap authenticated;
- user bisa membuat banyak akun jika signup lemah.

### 4.3 By API key / client id

Cocok untuk:

- partner integration;
- machine-to-machine;
- public developer API;
- internal service identity.

Keterbatasan:

- API key bisa bocor;
- satu partner bisa punya banyak key;
- key rotation perlu desain;
- key sharing perlu detection.

### 4.4 By tenant / organization

Cocok untuk:

- SaaS;
- multi-tenant regulatory platform;
- partner quota;
- contract-based usage.

Kelebihan:

- lebih adil dibanding per-user saja;
- bisa sesuai plan/contract;
- cocok untuk billing dan audit.

Keterbatasan:

- perlu tenant resolution yang aman;
- jangan percaya tenant id dari header publik tanpa verifikasi;
- tenant-level limit perlu dikombinasikan dengan per-user/per-key.

### 4.5 By endpoint / route

Tidak semua endpoint sama.

Contoh:

```text
GET /cases/{id}              murah-menengah
GET /cases?query=...         bisa mahal
POST /cases                  mahal karena validasi/workflow
POST /cases/{id}/documents   mahal karena upload/storage/scan
POST /reports/export         sangat mahal
POST /auth/login             security-sensitive
POST /auth/otp               cost-sensitive
```

### 4.6 By method

`GET` mungkin banyak tapi murah. `POST` mungkin sedikit tapi mahal.

Namun jangan menyimpulkan dari method saja. `GET /reports/export?format=pdf` bisa jauh lebih mahal daripada `POST /comments`.

### 4.7 By operation cost

Untuk API matang, limit berbasis request count saja tidak cukup.

Contoh weighted cost:

```text
GET /cases/{id}                         cost 1
GET /cases?limit=100                    cost 5
GET /cases?include=evidenceSummary      cost 10
POST /cases/{id}/documents              cost 20
POST /reports/export                    cost 100
POST /ai/summarize-case                 cost 500
```

Dengan weighted rate limit, consumer tidak bisa menghindari fairness hanya dengan memilih endpoint mahal.

### 4.8 By concurrency

Beberapa request tidak banyak secara rate, tetapi lama dan berat.

Contoh:

- export CSV;
- PDF generation;
- report query;
- file upload;
- streaming feed;
- long polling;
- slow downstream call.

Concurrency limit menjawab:

> Maksimal berapa request aktif untuk kategori ini pada waktu bersamaan?

Contoh:

```text
Max active exports per tenant: 2
Max active uploads per user: 3
Max active report queries globally: 20
Max active downstream provider calls: 50
```

### 4.9 By payload size

Payload juga resource.

Contoh:

- max request body size;
- max multipart file size;
- max number of files;
- max JSON field count;
- max array length;
- max query parameter length;
- max response page size.

Ini sering lebih penting daripada request-per-minute.

### 4.10 By state transition

Dalam workflow-heavy system, rate limit bisa berbasis transition.

Contoh regulatory case:

- submit case: 20 per hour per external reporter;
- re-open case: 5 per day per supervisor;
- escalate case: 100 per day per agency;
- upload evidence: 500 files/day per case;
- send notice: 50/day per case;
- appeal submission: 1 active appeal per decision.

Ini bukan generic HTTP limit. Ini domain-aware quota.

---

## 5. Algoritma Rate Limiting

### 5.1 Fixed window counter

Policy:

```text
100 requests per minute
```

Implementasi:

```text
key = user:123:2026-06-19T10:15
counter++
if counter > 100 reject
```

Kelebihan:

- sederhana;
- murah;
- mudah dengan Redis `INCR` + TTL.

Kekurangan:

- boundary burst problem.

Contoh:

```text
10:15:59 → client kirim 100 request
10:16:00 → client kirim 100 request
```

Dalam 2 detik client berhasil mengirim 200 request.

Cocok untuk:

- quota kasar;
- endpoint tidak terlalu kritis;
- internal admin tooling;
- sistem awal yang butuh simplicity.

### 5.2 Sliding window log

Simpan timestamp setiap request dalam window.

Kelebihan:

- akurat;
- menghindari fixed window burst.

Kekurangan:

- memory lebih besar;
- operasi cleanup;
- mahal untuk high traffic.

Cocok untuk:

- security-sensitive endpoint;
- login;
- OTP;
- password reset;
- endpoint abuse-prone.

### 5.3 Sliding window counter

Gabungan fixed window dan weighted previous window.

Kelebihan:

- lebih smooth daripada fixed window;
- lebih murah daripada sliding log.

Kekurangan:

- approximate;
- lebih kompleks dari fixed window.

Cocok untuk:

- API umum;
- gateway-level limit;
- tenant/user limit.

### 5.4 Token bucket

Bucket punya kapasitas dan refill rate.

Contoh:

```text
capacity = 100 tokens
refill = 10 tokens/second
request cost = 1 token
```

Jika token tersedia, request allowed dan token dikurangi. Jika tidak, request rejected atau delayed.

Kelebihan:

- mendukung burst terkontrol;
- intuitive;
- cocok untuk traffic natural;
- umum di gateway/library.

Kekurangan:

- perlu state per key;
- distributed consistency perlu desain;
- burst bisa tetap tinggi jika capacity terlalu besar.

Cocok untuk:

- public API;
- partner API;
- per-user/per-tenant fairness;
- cost-based limit dengan token cost.

### 5.5 Leaky bucket

Request masuk bucket, keluar pada rate konstan.

Kelebihan:

- smoothing traffic;
- output stabil.

Kekurangan:

- bisa menambah latency;
- queue bisa penuh;
- perlu kebijakan drop.

Cocok untuk:

- downstream yang butuh rate stabil;
- outbound calls ke provider;
- background processing.

### 5.6 Concurrent limiter / semaphore

Batas request aktif.

```text
if active_exports_for_tenant >= 2:
    reject 429/409/202 depending design
else:
    acquire slot
    process
    release slot
```

Kelebihan:

- melindungi resource yang habis karena request lama;
- sederhana;
- sangat efektif untuk expensive operation.

Kekurangan:

- bukan pengganti rate limit;
- perlu release aman saat timeout/cancellation;
- distributed semaphore lebih sulit.

### 5.7 Adaptive limiting

Limit berubah berdasarkan kondisi sistem:

- CPU;
- latency;
- error rate;
- queue depth;
- database saturation;
- downstream health;
- SLO burn rate.

Kelebihan:

- lebih responsif terhadap overload;
- cocok untuk large-scale platform.

Kekurangan:

- kompleks;
- bisa tidak stabil jika feedback loop buruk;
- sulit dijelaskan ke client;
- perlu observability matang.

---

## 6. Response Semantics: 429, 503, dan Retry-After

### 6.1 429 Too Many Requests

Gunakan `429 Too Many Requests` ketika request ditolak karena caller melebihi limit policy.

Contoh:

```http
HTTP/1.1 429 Too Many Requests
Content-Type: application/problem+json
Retry-After: 60
Cache-Control: no-store

{
  "type": "https://api.example.com/problems/rate-limit-exceeded",
  "title": "Rate limit exceeded",
  "status": 429,
  "detail": "You exceeded the limit for case search requests.",
  "instance": "/requests/01J...",
  "limit": {
    "scope": "tenant",
    "policy": "300 requests per minute",
    "retryAfterSeconds": 60
  }
}
```

### 6.2 503 Service Unavailable

Gunakan `503 Service Unavailable` ketika sistem menolak request karena service sedang overload atau dependency tidak mampu melayani, bukan karena caller tertentu melanggar quota.

Contoh:

```http
HTTP/1.1 503 Service Unavailable
Retry-After: 30
Content-Type: application/problem+json

{
  "type": "https://api.example.com/problems/service-overloaded",
  "title": "Service temporarily overloaded",
  "status": 503,
  "detail": "The service is temporarily unable to accept more export jobs. Please retry later."
}
```

### 6.3 403 Forbidden

Gunakan `403` jika caller tidak punya entitlement/plan untuk fitur atau quota class tertentu.

Contoh:

```text
Free plan cannot use bulk export.
```

Itu bukan `429`. Itu authorization/entitlement failure.

### 6.4 409 Conflict

Kadang limit domain lebih tepat dimodelkan sebagai conflict state.

Contoh:

```text
A case may have only one active appeal.
```

Jika user submit appeal kedua, ini bukan rate limit. Ini domain invariant conflict.

### 6.5 Retry-After

`Retry-After` bisa berisi:

- delay seconds;
- HTTP date.

Untuk API, delay seconds sering lebih sederhana.

Contoh:

```http
Retry-After: 120
```

Artinya client sebaiknya retry setelah 120 detik.

### 6.6 RateLimit headers

HTTP ecosystem memiliki header untuk mengkomunikasikan policy dan remaining limit. Pada saat materi ini dibuat, IETF HTTPAPI draft terbaru mendefinisikan `RateLimit` dan `RateLimit-Policy` sebagai cara server mengiklankan quota policy dan current service limits kepada client.

Contoh konseptual:

```http
RateLimit: limit=100, remaining=42, reset=60
RateLimit-Policy: "100;w=60"
```

Catatan penting:

- jangan membocorkan informasi sensitif;
- jangan terlalu detail jika attacker bisa memakai informasi itu untuk optimasi abuse;
- pastikan header konsisten dengan actual enforcement;
- dokumentasikan semantics untuk client.

---

## 7. Enforcement Point

### 7.1 CDN/WAF layer

Cocok untuk:

- volumetric abuse;
- IP reputation;
- bot filtering;
- DDoS mitigation;
- public endpoint;
- static/cacheable endpoint.

Keterbatasan:

- minim domain context;
- risk false positive;
- sulit tahu user/tenant jika auth di app.

### 7.2 API gateway

Cocok untuk:

- per route;
- per API key;
- per client id;
- per tenant header jika trusted;
- centralized policy;
- consistent 429.

Keterbatasan:

- gateway mungkin tidak tahu operation cost;
- gateway mungkin tidak tahu authorization result;
- path rewriting bisa membuat policy mismatch;
- perlu shared state untuk multi-node.

### 7.3 Service mesh / sidecar

Cocok untuk:

- service-to-service limit;
- circuit breaking;
- retry budget;
- concurrency limit;
- local outlier detection.

Keterbatasan:

- domain context rendah;
- risk policy tersebar dan sulit dipahami aplikasi.

### 7.4 Application filter/middleware

Cocok untuk:

- authenticated user;
- tenant;
- endpoint-specific policy;
- domain-aware cost;
- custom response body;
- audit trail.

Keterbatasan:

- request sudah sampai app;
- masih memakai connection/thread/event-loop;
- perlu performa tinggi;
- distributed state perlu Redis/Hazelcast/etc.

### 7.5 Application service/domain layer

Cocok untuk:

- business quota;
- workflow limit;
- state transition limit;
- plan entitlement;
- expensive domain operation.

Contoh:

```text
Tenant A may create 10,000 cases/month.
A case may have max 200 evidence documents.
A user may trigger 5 re-open requests/day.
External agency may submit 1,000 reports/day.
```

Ini sering bukan tugas gateway.

### 7.6 Database/downstream guard

Cocok untuk:

- connection pool max;
- query timeout;
- statement timeout;
- queue length;
- worker concurrency;
- third-party API quota.

Ini bukan user-facing rate limit, tetapi tetap bagian dari overload control.

---

## 8. Key Design: Siapa yang Dibatasi?

### 8.1 Rate limit key harus stabil dan aman

Key buruk:

```text
X-Tenant-Id from public request header without verification
X-User-Id from client header
raw IP behind proxy without trusted forwarding config
email before normalization
JWT claim without issuer/audience verification
```

Key lebih baik:

```text
authenticated principal id
authenticated tenant id from verified token/session
API key id, not API key raw value
mTLS client certificate subject mapped to service id
trusted gateway-enriched consumer id
```

### 8.2 Composite key

Sering perlu lebih dari satu key.

Contoh:

```text
ip:/login:203.0.113.10
user:/cases/search:user-123
tenant:/cases/search:tenant-456
apikey:/partner-submission:key-789
tenant+endpoint:tenant-456:/reports/export
case+operation:case-abc:/documents/upload
```

### 8.3 Hierarchical limits

Gunakan beberapa limit bersamaan:

```text
Global: 10,000 req/s
Endpoint /cases/search: 1,000 req/s
Tenant A: 300 req/min
User U: 60 req/min
IP: 120 req/min
Expensive search: 20 req/min
Concurrent exports per tenant: 2
```

Request allowed hanya jika semua applicable limits allow.

### 8.4 Avoid one-dimensional policy

Policy satu dimensi mudah dieksploitasi.

Contoh hanya per-IP:

- attacker pakai banyak IP.

Hanya per-user:

- attacker buat banyak akun.

Hanya per-tenant:

- satu user dalam tenant bisa menghabiskan quota semua user.

Hanya per-endpoint:

- satu tenant besar menghabiskan semua kapasitas endpoint.

---

## 9. Placement dalam Request Lifecycle

### 9.1 Before authentication

Rate limit sebelum auth berguna untuk:

- login;
- password reset;
- OTP;
- signup;
- public endpoint;
- expensive authentication processing;
- token introspection abuse.

Key yang tersedia biasanya:

- IP;
- user agent;
- path;
- partial username/email;
- device fingerprint jika ada;
- client id jika public OAuth flow.

Risiko:

- false positive NAT;
- username enumeration jika response berbeda;
- attacker bisa distribute IP.

### 9.2 After authentication

Rate limit setelah auth berguna untuk:

- per-user;
- per-tenant;
- per-plan;
- per-scope;
- per-client;
- domain-aware limit.

Risiko:

- auth work sudah dilakukan;
- token verification/introspection bisa tetap diserang;
- perlu kombinasi dengan pre-auth limit.

### 9.3 Before body parsing

Untuk endpoint upload/body besar, limit perlu sedini mungkin.

Contoh:

- reject jika `Content-Length` melebihi batas;
- reject unsupported media type;
- reject if tenant upload quota exceeded sebelum membaca seluruh stream;
- limit concurrent uploads.

Kalau backend membaca seluruh body dulu baru menolak, attacker tetap berhasil menghabiskan bandwidth/memory/disk.

### 9.4 After validation

Beberapa cost hanya diketahui setelah parsing/validation.

Contoh:

```json
{
  "dateRange": "5 years",
  "includeDocuments": true,
  "format": "pdf"
}
```

Request ini jauh lebih mahal daripada report kecil. Maka cost-based limit mungkin berjalan setelah body dibaca dan request dimodelkan.

---

## 10. Domain-Aware Quotas

### 10.1 Quota bukan sekadar rate

Rate limit biasanya window pendek:

```text
100 requests/minute
```

Quota bisa window panjang:

```text
10,000 API calls/month
100 GB storage/month
1,000 evidence uploads/day
50 exports/day
5 appeal submissions/case
```

### 10.2 Quota sebagai produk/contract

Jika platform punya plan atau partner contract, quota menjadi bagian dari external contract.

Contoh:

```text
Basic tenant:
- 100 case submissions/day
- 10 concurrent users
- 5 exports/day

Enterprise tenant:
- 10,000 case submissions/day
- 100 concurrent users
- 500 exports/day
- dedicated burst policy
```

### 10.3 Quota perlu observability dan support tooling

Kalau user terkena quota, support team perlu menjawab:

- quota apa yang terkena;
- siapa yang menghabiskan;
- endpoint apa;
- sejak kapan;
- kapan reset;
- apakah policy benar;
- apakah ada bug client;
- apakah perlu override sementara.

Tanpa tooling, rate limit akan terasa random bagi user.

---

## 11. Cost-Based Limiting

### 11.1 Masalah request count

Dua request tidak selalu setara.

```text
GET /health
```

murah.

```text
GET /cases?query=...&include=evidence&sort=complex&limit=500
```

bisa sangat mahal.

Kalau keduanya dihitung 1, policy tidak melindungi backend.

### 11.2 Cost estimation

Cost bisa dihitung dari:

- endpoint;
- method;
- query parameter;
- requested page size;
- date range;
- include/expand fields;
- output format;
- tenant plan;
- estimated row count;
- downstream calls;
- file size;
- model/provider cost.

Contoh pseudo-code:

```java
int cost(SearchCasesRequest req) {
    int cost = 1;
    cost += req.limit() / 50;
    if (req.includeEvidenceSummary()) cost += 10;
    if (req.dateRangeDays() > 365) cost += 20;
    if (req.sortBy().equals("relevance")) cost += 5;
    return Math.min(cost, 100);
}
```

### 11.3 Cost unit harus stabil

Jangan membuat cost formula terlalu rahasia dan berubah-ubah tanpa dokumentasi internal.

Yang dibutuhkan:

- cukup akurat;
- mudah dijelaskan;
- mudah dipantau;
- tidak mahal dihitung;
- tidak terlalu mudah dieksploitasi.

---

## 12. Abuse-Sensitive Endpoints

### 12.1 Login

Risiko:

- brute force;
- credential stuffing;
- account lockout abuse;
- username enumeration.

Limit dimensions:

- IP;
- username/email normalized;
- IP + username;
- device/session;
- tenant;
- ASN/reputation if available.

Response principle:

- jangan bocorkan apakah username ada;
- jangan membuat lockout mudah dipakai untuk DoS user;
- gunakan progressive friction.

### 12.2 OTP / verification code

Risiko:

- SMS/email cost abuse;
- brute force OTP;
- resend spam;
- account takeover.

Limit dimensions:

- phone/email;
- IP;
- user;
- session;
- device;
- provider quota.

Policy examples:

```text
Max OTP send: 3 per 10 minutes per phone
Max OTP verify attempt: 5 per code
Max OTP send global per IP: 20 per hour
```

### 12.3 Search

Risiko:

- scraping;
- expensive query;
- enumeration;
- database overload.

Controls:

- max page size;
- cursor pagination;
- date range limit;
- allowed sort fields;
- query complexity limit;
- tenant/user rate limit;
- no deep offset pagination;
- result window cap.

### 12.4 Export

Risiko:

- database scan;
- memory pressure;
- CPU PDF/CSV generation;
- storage egress;
- sensitive data leakage.

Controls:

- async job;
- concurrency limit;
- daily quota;
- size cap;
- approval for large export;
- signed download URL expiry;
- audit event.

### 12.5 File upload

Risiko:

- storage exhaustion;
- malware;
- decompression bomb;
- bandwidth abuse;
- multipart parser pressure.

Controls:

- max size;
- max file count;
- per-case quota;
- per-tenant storage quota;
- pre-signed upload;
- scan queue concurrency;
- content type validation;
- backpressure.

### 12.6 Webhook receivers

Risiko:

- replay;
- signature verification cost;
- duplicate events;
- event flood.

Controls:

- signature verification;
- timestamp window;
- event id dedup;
- per-provider rate limit;
- queue buffering;
- async processing;
- 2xx only after durable acceptance.

---

## 13. Java/Spring Implementation Patterns

### 13.1 Servlet Filter level

Filter cocok untuk early enforcement.

Conceptual code:

```java
public final class RateLimitFilter extends OncePerRequestFilter {
    private final RateLimiterService limiter;

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain
    ) throws ServletException, IOException {

        RateLimitContext context = RateLimitContext.from(request);
        RateLimitDecision decision = limiter.check(context);

        if (!decision.allowed()) {
            response.setStatus(429);
            response.setHeader("Retry-After", String.valueOf(decision.retryAfterSeconds()));
            response.setContentType("application/problem+json");
            response.getWriter().write("""
              {"type":"https://api.example.com/problems/rate-limit-exceeded",
               "title":"Rate limit exceeded",
               "status":429}
              """);
            return;
        }

        filterChain.doFilter(request, response);
    }
}
```

Kelebihan:

- berjalan sebelum controller;
- bisa melindungi banyak endpoint;
- cocok untuk IP/API key/authenticated principal jika security context sudah tersedia.

Perhatian:

- order filter penting;
- sebelum auth hanya punya info terbatas;
- setelah auth lebih domain-aware;
- jangan melakukan operasi remote lambat di filter tanpa timeout.

### 13.2 HandlerInterceptor level

Interceptor cocok untuk route-aware policy.

Contoh:

```java
public class EndpointRateLimitInterceptor implements HandlerInterceptor {
    @Override
    public boolean preHandle(HttpServletRequest request,
                             HttpServletResponse response,
                             Object handler) throws Exception {
        // identify matched handler/route/policy
        return true;
    }
}
```

Kelebihan:

- tahu handler mapping;
- bisa membaca annotation;
- lebih dekat ke MVC.

Kekurangan:

- body mungkin belum/bisa belum dibaca;
- tetap sebelum domain validation.

### 13.3 Annotation-based policy

Contoh:

```java
@RateLimited(policy = "case-search")
@GetMapping("/cases")
public Page<CaseSummaryResponse> searchCases(...) {
    ...
}
```

Kelebihan:

- policy terlihat dekat endpoint;
- mudah audit route;
- cocok untuk internal consistency.

Kekurangan:

- bisa tersebar;
- policy runtime tetap perlu centralized engine;
- jangan hardcode angka di annotation untuk semua environment.

### 13.4 Domain service quota

Untuk quota domain, lakukan di application service.

```java
public CaseId submitCase(SubmitCaseCommand command) {
    quotaService.requireAvailable(
        QuotaKey.tenant(command.tenantId()),
        QuotaOperation.CASE_SUBMISSION,
        1
    );

    Case c = caseFactory.create(command);
    repository.save(c);

    quotaService.consume(...);
    audit.record(...);

    return c.id();
}
```

Perhatian penting:

- check + consume harus atomic atau toleran race;
- jika operasi gagal setelah consume, tentukan apakah quota dikembalikan;
- untuk billing quota, perlu ledger/audit;
- untuk abuse limit, approximate counter biasanya cukup.

### 13.5 WebFlux pattern

Di WebFlux, gunakan `WebFilter`.

```java
public class ReactiveRateLimitFilter implements WebFilter {
    private final ReactiveRateLimiter limiter;

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, WebFilterChain chain) {
        return limiter.check(exchange)
            .flatMap(decision -> {
                if (decision.allowed()) {
                    return chain.filter(exchange);
                }
                exchange.getResponse().setStatusCode(HttpStatus.TOO_MANY_REQUESTS);
                exchange.getResponse().getHeaders()
                    .set("Retry-After", String.valueOf(decision.retryAfterSeconds()));
                return exchange.getResponse().setComplete();
            });
    }
}
```

Perhatian:

- jangan blocking Redis call di event loop;
- gunakan reactive client atau schedule dengan benar;
- timeout limiter call;
- fail-open/fail-closed harus eksplisit.

---

## 14. Distributed Rate Limiting

### 14.1 Local in-memory limiter

Kelebihan:

- cepat;
- sederhana;
- tidak bergantung Redis;
- cocok untuk per-instance protection.

Kekurangan:

- tidak global across instances;
- limit efektif = limit per instance × jumlah instance;
- autoscaling mengubah effective quota;
- unfair antar client tergantung load balancing.

Cocok untuk:

- local overload protection;
- circuit breaker-like behavior;
- fallback saat Redis down;
- non-contractual limit.

### 14.2 Redis-backed limiter

Kelebihan:

- shared state;
- atomic operations via Lua/script/transaction;
- TTL support;
- common pattern.

Kekurangan:

- Redis menjadi dependency critical;
- latency tambahan;
- hot key problem;
- Redis outage policy perlu jelas;
- cross-region latency/consistency issue.

### 14.3 Database-backed quota ledger

Kelebihan:

- durable;
- auditable;
- cocok untuk billing/contract quota;
- transactional.

Kekurangan:

- lebih lambat;
- bisa membebani database;
- kurang cocok untuk high-frequency per-request rate limiting.

Cocok untuk:

- monthly quota;
- storage usage;
- billing usage;
- regulated audit trail;
- domain operation quotas.

### 14.4 Approximate/distributed counters

Kadang exact global count terlalu mahal.

Pendekatan:

- per-node local bucket dengan periodic sync;
- sharded counters;
- probabilistic admission;
- hierarchical token allocation;
- regional quota partitioning.

Trade-off:

- fairness approximate;
- lebih scalable;
- bisa overshoot sedikit;
- perlu diterima dalam policy.

### 14.5 Multi-region complication

Jika API multi-region active-active:

- quota state global mahal;
- latency tinggi jika semua region cek Redis global;
- eventual consistency bisa overshoot;
- user routed antar-region bisa double quota;
- disaster failover bisa mengubah rate behavior.

Solusi:

- region-local quota partition;
- home-region routing;
- global quota async reconciliation;
- conservative per-region cap;
- durable quota ledger untuk billing.

---

## 15. Fail-Open vs Fail-Closed

Apa yang terjadi jika limiter dependency gagal?

### 15.1 Fail-open

Jika Redis limiter down, allow request.

Kelebihan:

- availability lebih tinggi;
- tidak memblokir user sah;
- cocok untuk non-critical limit.

Kekurangan:

- abuse bisa lewat;
- overload risk;
- contract quota bisa dilanggar.

### 15.2 Fail-closed

Jika limiter down, reject request.

Kelebihan:

- security/cost lebih aman;
- cocok untuk OTP, payment, expensive provider.

Kekurangan:

- outage limiter menjadi outage API;
- user sah terdampak.

### 15.3 Fail-degraded

Gunakan fallback local limiter.

```text
Primary: Redis global tenant limiter
Fallback: local per-IP/per-instance limiter
```

Ini sering paling realistis.

Policy harus eksplisit per endpoint.

---

## 16. Client Contract

Rate limiting yang baik juga mendidik client.

### 16.1 Dokumentasikan policy

Untuk public/partner API, dokumentasikan:

- limit unit;
- scope;
- window;
- burst;
- status code;
- response body;
- retry behavior;
- whether unsuccessful requests count;
- whether 5xx counts;
- reset semantics;
- how to request higher limit.

### 16.2 Jangan dorong retry storm

Response buruk:

```http
HTTP/1.1 500 Internal Server Error
```

Client akan retry agresif.

Response lebih baik:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 60
```

Client tahu harus melambat.

### 16.3 Backoff recommendation

Dokumentasikan:

- exponential backoff;
- jitter;
- respect `Retry-After`;
- do not retry non-idempotent request unless idempotency key used;
- cap max retry;
- circuit breaker on client side.

---

## 17. Observability

### 17.1 Metrics

Minimum metrics:

```text
http.server.requests.total{status,method,route,tenant_class}
rate_limit.decisions.total{policy,decision,scope,route}
rate_limit.rejections.total{policy,scope,route}
rate_limit.remaining.tokens{policy,scope_sampled}
rate_limit.retry_after.seconds{policy}
quota.consumed.total{operation,tenant_plan}
quota.remaining{operation,tenant_plan}
concurrency_limiter.active{operation}
concurrency_limiter.rejections.total{operation}
```

Hindari high cardinality:

- jangan label metrics dengan raw user id;
- jangan label dengan tenant id jika tenant sangat banyak kecuali controlled;
- gunakan sampling/logging untuk detail per principal.

### 17.2 Logs

Log rejection harus cukup untuk diagnosis:

```json
{
  "event": "rate_limit_rejected",
  "policy": "case-search-per-tenant",
  "scope": "tenant",
  "route": "GET /cases",
  "method": "GET",
  "status": 429,
  "retryAfterSeconds": 60,
  "correlationId": "...",
  "tenantHash": "...",
  "userHash": "..."
}
```

Jangan log:

- raw API key;
- bearer token;
- sensitive query;
- raw PII jika tidak perlu.

### 17.3 Tracing

Span attributes yang berguna:

```text
rate_limit.policy
rate_limit.decision
rate_limit.retry_after_ms
rate_limit.cost
quota.operation
quota.consumed
```

Tapi hati-hati cardinality.

### 17.4 Alerting

Alert bukan hanya “429 naik”.

429 naik bisa berarti:

- policy berhasil menahan abuse;
- client bug;
- limit terlalu rendah;
- product growth;
- attack;
- gateway misconfiguration;
- tenant batch job berubah.

Alert yang lebih berguna:

- sudden spike 429 for login;
- 429 ratio per route naik drastis;
- 429 for premium tenant;
- concurrency rejection export naik;
- limiter Redis latency naik;
- limiter dependency error;
- global overload 503 naik;
- downstream provider quota near exhaustion.

---

## 18. Testing Strategy

### 18.1 Unit test algorithm

Test:

- allow under limit;
- reject over limit;
- reset after window;
- token refill;
- weighted cost;
- retry-after calculation;
- key derivation;
- fail-open/fail-closed behavior.

### 18.2 Integration test

Test dengan HTTP:

```text
Given tenant limit 3/min
When 4 requests are sent
Then first 3 return 2xx
And 4th returns 429
And response contains Retry-After
And problem body has stable type
```

### 18.3 Concurrent test

Race condition penting.

Test:

```text
100 concurrent requests with limit 10
Expected exactly or approximately 10 allowed depending algorithm contract
No negative token
No inconsistent counter
```

### 18.4 Distributed test

Jika multi-instance:

- run app with 2+ instances;
- send traffic through load balancer;
- verify global limit;
- simulate Redis latency;
- simulate Redis outage;
- verify fallback behavior.

### 18.5 Abuse simulation

Simulasikan:

- login brute force;
- many accounts same IP;
- many IP same username;
- expensive search;
- large upload;
- webhook replay;
- frontend polling bug;
- partner batch retry storm.

---

## 19. Common Anti-Patterns

### 19.1 Satu global limit untuk semua endpoint

```text
100 req/min per IP for everything
```

Masalah:

- terlalu kasar;
- endpoint mahal tidak terlindungi;
- endpoint murah terlalu dibatasi;
- NAT user bisa kena false positive.

### 19.2 Hanya limit setelah request mahal selesai

Jika server menjalankan query 10 detik lalu menolak karena quota, limit tidak melindungi resource.

### 19.3 429 tanpa Retry-After

Client tidak tahu kapan retry.

### 19.4 Semua abuse dianggap 403

403 memberi sinyal authorization. Untuk quota/rate, gunakan 429.

### 19.5 Mengandalkan IP di belakang proxy tanpa trust config

Jika salah konfigurasi:

- semua request terlihat dari load balancer IP; atau
- attacker spoof `X-Forwarded-For`.

### 19.6 Rate limit sebagai pengganti authorization

Rate limit tidak mencegah user mengakses resource yang tidak boleh diakses. Itu tugas authorization.

### 19.7 Tidak membatasi query complexity

Endpoint search bisa tetap mematikan database meski request rate rendah.

### 19.8 Tidak ada observability

Tanpa log/metric, 429 menjadi misteri.

### 19.9 Hardcoded policy di controller

Sulit audit, sulit ubah, sulit override saat incident.

### 19.10 Tidak ada emergency override

Saat incident, operator perlu bisa:

- menurunkan limit;
- menaikkan limit tenant tertentu;
- memblokir key;
- men-disable endpoint mahal;
- mengaktifkan degraded mode.

---

## 20. Case Study: Regulatory Enforcement Platform

Bayangkan platform regulatory enforcement lifecycle:

Resources:

```text
/cases
/cases/{caseId}
/cases/{caseId}/evidence
/cases/{caseId}/assignments
/cases/{caseId}/reviews
/cases/{caseId}/escalations
/cases/{caseId}/notices
/reports/export
/auth/login
/webhooks/external-agency
```

### 20.1 Policy matrix

| Operation | Risk | Limit |
|---|---:|---|
| Login | brute force | per IP + username sliding window |
| Case search | DB overload, enumeration | per user + tenant + query cost |
| Case detail | enumeration | per user + suspicious sequence detection |
| Case creation | spam/cost | per tenant daily quota + per user rate |
| Evidence upload | storage/malware pipeline | per case + tenant storage quota + concurrent upload |
| Export report | DB/CPU/data leakage | async only + concurrency limit + daily quota |
| Escalation | workflow abuse | per role + state-machine invariant |
| Notice generation | external communication cost | per case + per tenant + approval threshold |
| Webhook receive | replay/flood | signature + event dedup + provider rate |

### 20.2 Example: export report

Bad design:

```http
GET /reports/export?format=csv
```

Synchronous export langsung query database dan stream response. Jika 20 user trigger bersamaan, database kolaps.

Better design:

```http
POST /report-export-jobs
Idempotency-Key: ...
```

Response:

```http
HTTP/1.1 202 Accepted
Location: /report-export-jobs/job-123
```

Controls:

- max active export jobs per tenant = 2;
- max daily export jobs per tenant = 50;
- max date range = 90 days unless privileged;
- export job has audit reason;
- generated file has expiring signed URL;
- download has separate authorization;
- large export requires approval.

### 20.3 Example: case search

Policy:

```text
Base cost: 1
limit <= 50: +1
limit 51-200: +5
include evidence summary: +10
date range > 1 year: +10
sort by relevance: +5
```

Tenant token bucket:

```text
capacity: 500 cost units
refill: 100 cost units/minute
```

This allows flexible usage while protecting expensive query patterns.

---

## 21. Design Checklist

Sebelum membuat rate limit policy, jawab:

1. Resource apa yang dilindungi?
2. Siapa consumer-nya?
3. Apakah consumer authenticated?
4. Apakah limit per IP, user, tenant, API key, endpoint, operation, atau kombinasi?
5. Apakah request count cukup atau perlu weighted cost?
6. Apakah perlu concurrency limit?
7. Apakah perlu daily/monthly quota?
8. Apakah policy contractual atau best-effort?
9. Enforcement dilakukan di gateway, app, domain service, atau downstream?
10. Apa status code saat ditolak?
11. Apakah perlu `Retry-After`?
12. Apakah perlu RateLimit headers?
13. Apakah response body mengikuti Problem Details?
14. Apakah failed request dihitung?
15. Apakah 4xx/5xx dihitung?
16. Apakah retry dari client akan memperburuk overload?
17. Apakah policy aman terhadap NAT/proxy?
18. Apakah attacker bisa spoof key?
19. Apakah ada observability?
20. Apakah ada support/admin override?
21. Apa fail-open/fail-closed behavior jika limiter down?
22. Apakah multi-instance/multi-region sudah dipikirkan?
23. Apakah policy sudah diuji secara concurrency?
24. Apakah dokumentasi client jelas?

---

## 22. Java Engineer Practical Rubric

Engineer junior biasanya:

- menambahkan `@RateLimited(100/min)`;
- mengembalikan 429;
- selesai.

Engineer senior/top-tier akan bertanya:

1. Limit ini melindungi resource apa?
2. Key-nya aman dari spoofing?
3. Apakah limit per user cukup atau perlu tenant/global?
4. Apakah endpoint ini request-count atau cost-based?
5. Apakah ada concurrency risk?
6. Bagaimana retry client?
7. Apa bedanya 429 vs 503 di kasus ini?
8. Apakah response punya `Retry-After`?
9. Apakah policy bisa diubah saat incident?
10. Apakah ada metric/log untuk support?
11. Bagaimana distributed consistency?
12. Apakah Redis outage membuat API mati?
13. Apakah limit ini unfair bagi NAT users?
14. Apakah attacker bisa membuat account baru untuk bypass?
15. Apakah quota domain perlu ledger/audit?

---

## 23. Exercises

### Exercise 1 — Login endpoint

Design rate limiting for:

```text
POST /auth/login
```

Pertimbangkan:

- IP;
- username/email;
- tenant;
- device;
- response uniformity;
- account lockout abuse;
- observability.

### Exercise 2 — Search endpoint

Design policy for:

```text
GET /cases?status=OPEN&from=2020-01-01&to=2026-01-01&include=evidenceSummary&limit=500
```

Tentukan:

- validation limit;
- cost formula;
- tenant quota;
- status code;
- response body;
- metric.

### Exercise 3 — Export endpoint

Ubah synchronous export menjadi async job.

Tentukan:

- endpoint model;
- idempotency;
- concurrency limit;
- daily quota;
- retry behavior;
- audit event;
- download authorization.

### Exercise 4 — Distributed limiter failure

Jika Redis limiter down, endpoint mana yang fail-open dan mana yang fail-closed?

Klasifikasikan:

- `/health`;
- `/auth/login`;
- `/auth/otp/send`;
- `/cases/search`;
- `/reports/export`;
- `/webhooks/provider`.

---

## 24. Summary

Rate limiting adalah desain resource governance.

Poin terpenting:

1. Rate limiting bukan pengganti authentication atau authorization.
2. `429 Too Many Requests` cocok untuk caller-specific limit.
3. `503 Service Unavailable` cocok untuk service overload/global inability.
4. `Retry-After` membantu client tidak menyebabkan retry storm.
5. Limit harus mempertimbangkan IP, user, tenant, API key, endpoint, method, cost, concurrency, dan quota.
6. Gateway bagus untuk coarse enforcement, tetapi application/domain layer tetap perlu domain-aware quota.
7. Request count saja sering tidak cukup; expensive operation perlu weighted cost atau concurrency limit.
8. Distributed rate limiting membawa trade-off latency, consistency, availability, dan fairness.
9. Observability wajib agar limit bisa dijelaskan dan dioperasikan.
10. Dalam workflow/regulatory system, quota dan limit sering menjadi bagian dari governance dan auditability.

---

## 25. Koneksi ke Part Berikutnya

Part berikutnya adalah:

```text
learn-http-for-web-backend-perspective-part-019.md
```

Topik:

```text
Timeouts, Cancellation, Backpressure, and Load Shedding
```

Rate limiting menjawab:

> Berapa banyak request boleh masuk?

Part berikutnya menjawab:

> Apa yang terjadi ketika request sudah masuk, tetapi sistem lambat, client disconnect, downstream macet, queue penuh, atau kapasitas runtime mulai habis?

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-http-for-web-backend-perspective-part-017.md">⬅️ Part 017 — CORS from Backend Enforcement Perspective</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-http-for-web-backend-perspective-part-019.md">Part 019 — Timeouts, Cancellation, Backpressure, and Load Shedding ➡️</a>
</div>
