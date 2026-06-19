# learn-http-for-web-backend-perspective-part-000.md

# HTTP for Web Backend Perspective — Part 000
# Orientation: HTTP Backend Mental Model

> Target pembaca: Java software engineer yang ingin memahami HTTP dari perspektif backend production, bukan sekadar `@GetMapping`, `@PostMapping`, atau “API return JSON”.
>
> Fokus part ini: membangun **peta mental**. Detail teknis method, status code, header, caching, auth, CORS, idempotency, gateway, observability, dan Java implementation akan dibahas mendalam di part berikutnya.

---

## 0. Posisi Part Ini dalam Seri

Seri ini adalah lanjutan paralel dari pembelajaran HTTP dari sisi frontend, tetapi sudut pandangnya berbeda total.

Dari sisi frontend, HTTP sering terlihat sebagai:

- `fetch()` atau Axios call;
- status code untuk branching UI;
- CORS error;
- cache browser;
- cookie/session behavior;
- network tab;
- asset loading;
- SPA/API interaction.

Dari sisi backend, HTTP adalah:

- kontrak publik sistem;
- boundary keamanan;
- boundary validasi;
- surface observability;
- protocol untuk concurrency, retry, caching, negotiation, dan failure signaling;
- API governance layer;
- sumber kebenaran external behavior;
- mekanisme resource consumption yang harus dibatasi;
- bahasa interoperabilitas antara client, proxy, gateway, service, cache, dan manusia yang mengoperasikan sistem.

Part 000 ini bukan daftar API Spring. Ini adalah fondasi mental agar saat nanti membaca RFC, Spring docs, OWASP guidance, atau debugging production incident, Anda tahu “bentuk masalahnya”.

---

## 1. Tujuan Belajar

Setelah menyelesaikan part ini, Anda harus mampu:

1. Menjelaskan HTTP dari perspektif backend sebagai **application-level protocol contract**.
2. Membedakan HTTP sebagai **semantics** dan HTTP sebagai **wire protocol**.
3. Melihat satu request HTTP sebagai perjalanan lintas banyak layer, bukan langsung dari client ke controller.
4. Menentukan tanggung jawab backend terhadap method, status code, headers, body, security, cache, dan observability.
5. Memahami kenapa backend engineer yang kuat harus peduli pada idempotency, retry, timeout, cancellation, concurrency, and failure modes.
6. Menghindari cara pikir dangkal seperti “endpoint berhasil kalau return JSON 200”.
7. Membuat peta belajar untuk seluruh seri.

---

## 2. HTTP Bukan Sekadar Transport

Banyak backend engineer memperlakukan HTTP seperti pipa byte sederhana:

```text
Client sends JSON -> Server executes function -> Server returns JSON
```

Model itu terlalu miskin.

HTTP bukan hanya transport. TCP/QUIC adalah transport-level concern. HTTP berada di application layer dan membawa semantics:

- resource apa yang dimaksud;
- operation apa yang diminta;
- representation apa yang dikirim atau diminta;
- apakah operation aman diulang;
- apakah response boleh dicache;
- apakah request valid terhadap versi resource tertentu;
- apakah client boleh mengakses resource;
- apakah server gagal karena client salah, server rusak, upstream timeout, overload, atau conflict;
- metadata apa yang harus dipahami proxy, gateway, cache, observability agent, dan client.

Model yang lebih benar:

```text
HTTP request = semantic command or retrieval intent
             + target resource identity
             + representation metadata
             + credentials/context
             + preconditions
             + cache constraints
             + tracing metadata
             + body stream
             + resource consumption demand
```

HTTP response juga bukan sekadar JSON:

```text
HTTP response = outcome classification
              + selected representation or empty body
              + cache policy
              + validators
              + security policy
              + retry hints
              + correlation metadata
              + operational signal
```

Di backend production, HTTP adalah **bahasa kontrak**. Jika kontraknya buruk, sistem tetap bisa “jalan”, tetapi akan sulit di-retry, sulit dicache, sulit diamankan, sulit didebug, sulit dievolusi, dan sulit dipertanggungjawabkan.

---

## 3. Definisi Kerja: HTTP Backend Perspective

Dalam seri ini, “HTTP backend perspective” berarti mempelajari HTTP dari posisi sistem yang menerima, memvalidasi, memproses, dan mengembalikan response.

Backend bertanggung jawab atas:

1. **Interpretasi request**
   - Apa target resource?
   - Method-nya valid?
   - Media type-nya didukung?
   - Authenticated identity-nya siapa?
   - Authorization-nya cukup?
   - Body-nya valid secara syntax dan semantic?

2. **Eksekusi domain/application logic**
   - Apakah operation diperbolehkan oleh state machine?
   - Apakah ada conflict?
   - Apakah operation idempotent?
   - Apakah perlu transaction?
   - Apakah ada side effect ke downstream?

3. **Pemilihan response**
   - Status code apa yang paling benar?
   - Perlu body atau tidak?
   - Error shape-nya seperti apa?
   - Header apa yang wajib dikirim?
   - Apakah response boleh dicache?
   - Apakah perlu retry hint?

4. **Kontrol resource dan reliability**
   - Body size limit?
   - Timeout?
   - Cancellation?
   - Rate limit?
   - Backpressure?
   - Thread/event-loop saturation?

5. **Security boundary**
   - TLS assumptions?
   - Token/cookie handling?
   - CSRF/CORS?
   - Header trust?
   - Tenant isolation?
   - Object-level authorization?

6. **Operability**
   - Logs?
   - Metrics?
   - Traces?
   - Correlation ID?
   - Error classification?
   - Alerting signal?

Backend yang matang tidak hanya bertanya:

```text
Apa controller method-nya?
```

Tetapi:

```text
Apa kontrak external behavior-nya ketika request valid, invalid, duplicate, stale, unauthorized, overloaded, retried, cancelled, partially processed, atau melewati proxy yang berbeda?
```

---

## 4. HTTP Modern: Semantics vs Wire Protocol

Salah satu mental model terpenting: HTTP punya **semantics** dan punya **wire representation**.

### 4.1 Semantics

Semantics adalah makna konseptual yang stabil lintas versi HTTP:

- method: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS;
- status code: 200, 201, 202, 204, 400, 401, 403, 404, 409, 412, 415, 422, 429, 500, 503, dan seterusnya;
- field/header semantics;
- URI target;
- representation;
- content negotiation;
- validators seperti ETag;
- cache behavior;
- authentication challenge;
- conditional requests.

Jika Anda mengatakan “GET seharusnya safe” atau “PUT berarti replace representation”, itu semantic statement.

### 4.2 Wire protocol

Wire protocol adalah bagaimana semantics itu dikirim melalui jaringan:

- HTTP/1.1 menggunakan textual message framing, start-line, headers, optional body, connection management.
- HTTP/2 menggunakan binary framing, stream multiplexing, HPACK header compression.
- HTTP/3 membawa semantics HTTP di atas QUIC, bukan TCP, dengan stream-level behavior yang berbeda.

Backend engineer sering tidak langsung berurusan dengan HTTP/2 atau HTTP/3 karena edge proxy dapat melakukan termination lalu meneruskan request ke application server sebagai HTTP/1.1. Tetapi semantics tetap sama.

### 4.3 Kenapa ini penting?

Karena Anda tidak boleh mendesain API berdasarkan kebetulan teknis framework.

Contoh:

```java
@PostMapping("/cases/{id}/approve")
public Decision approve(@PathVariable UUID id) { ... }
```

Endpoint ini mungkin berjalan. Tetapi pertanyaan backend-nya:

- Apakah approval operation idempotent?
- Kalau client retry setelah timeout, apakah case bisa approved dua kali?
- Apakah response 200, 202, atau 409?
- Apakah perlu idempotency key?
- Apakah approval boleh dilakukan hanya jika case berada di state tertentu?
- Apakah perlu precondition seperti `If-Match`?
- Apakah audit record dibuat sekali atau berkali-kali?
- Apakah authorization berbasis role saja cukup, atau perlu assignment ownership?
- Apakah proxy/client boleh retry POST ini?

Semantics memaksa Anda berpikir lebih jauh dari routing.

---

## 5. HTTP Stateless, Tetapi Sistem Tidak Stateless

HTTP sering disebut stateless application-level protocol. Artinya, setiap request harus membawa informasi yang cukup agar server dapat memprosesnya tanpa bergantung pada conversational protocol state di connection yang sama.

Namun stateless HTTP tidak berarti aplikasi Anda stateless.

Aplikasi backend biasanya punya state:

- database rows;
- aggregate state;
- workflow state;
- session store;
- cache;
- distributed lock;
- queue;
- outbox;
- object storage;
- audit log;
- rate limiter store;
- idempotency key store;
- token revocation list;
- feature flag state.

Perbedaan penting:

```text
HTTP protocol state != application state
```

HTTP tidak mengingat percakapan seperti:

```text
Request 1: mulai transaksi
Request 2: lanjut transaksi
Request 3: commit transaksi
```

kecuali Anda membuat application-level mechanism sendiri, misalnya session, transaction token, workflow ID, atau resource state.

Backend maturity muncul saat Anda mampu memetakan:

```text
stateless request boundary
    ke
stateful domain model
    tanpa
implicit hidden assumptions
```

Contoh buruk:

```text
POST /approve
Body: { "caseId": "123" }
```

Dengan asumsi tersembunyi:

- user aktif punya current office;
- case ada di inbox user;
- latest version digunakan;
- approval belum pernah diproses;
- user masih punya permission;
- tidak ada concurrent reviewer lain;
- request tidak akan di-retry;
- response tidak hilang.

Contoh lebih defensible:

```http
POST /cases/123/approval-decisions
Authorization: Bearer <token>
Idempotency-Key: 7f2c...
Content-Type: application/json
If-Match: "case-version-42"

{
  "decision": "APPROVE",
  "reasonCode": "COMPLIANT",
  "comment": "All required evidence reviewed."
}
```

Backend lalu punya sinyal lebih kaya:

- target resource jelas;
- operation punya subordinate resource `approval-decisions`;
- duplicate request bisa dikelola;
- stale update bisa ditolak;
- representation type jelas;
- audit reason tersedia;
- authorization bisa dicek terhadap specific case.

---

## 6. Request Lifecycle: Dari Edge ke Handler

Banyak engineer membayangkan request seperti ini:

```text
Client -> Spring Controller -> Service -> Database -> Response
```

Di production, request lebih sering seperti ini:

```text
Client
  -> DNS
  -> CDN / WAF
  -> Load Balancer
  -> API Gateway / Reverse Proxy
  -> Service Mesh Sidecar
  -> Application Server Connector
  -> HTTP Parser
  -> Security Filter Chain
  -> Routing / Dispatcher
  -> Controller / Handler
  -> Application Service
  -> Domain Model
  -> Database / Cache / Queue / Downstream HTTP
  -> Response Mapping
  -> Filters / Interceptors
  -> Proxy Response Handling
  -> Client
```

Setiap layer bisa:

- mengubah header;
- menolak request;
- melakukan timeout;
- memotong body;
- melakukan buffering;
- mendekompresi payload;
- terminate TLS;
- generate error response;
- retry upstream;
- menambahkan trace header;
- mengubah scheme/host/path;
- membatasi rate;
- melakukan auth;
- menulis access log.

Jadi, ketika backend controller menerima request, itu bukan “request asli dari user”. Itu request yang sudah melewati pipeline.

### 6.1 Pertanyaan backend engineer

Untuk setiap API production, Anda perlu tahu:

1. Siapa TLS terminator?
2. Apakah app server melihat HTTP atau HTTPS?
3. Apakah `Host` header trusted?
4. Apakah `X-Forwarded-For` trusted?
5. Siapa yang melakukan authentication?
6. Siapa yang melakukan authorization?
7. Siapa yang enforce body size limit?
8. Siapa yang enforce rate limit?
9. Siapa yang generate 413, 429, 502, 503, 504?
10. Apakah gateway retry upstream request?
11. Apakah request body dibuffer atau distream?
12. Apakah response distream atau dibuffer?
13. Apakah compression terjadi di app atau edge?
14. Di mana correlation ID dibuat?
15. Apakah semua layer log dengan trace ID yang sama?

Tanpa jawaban ini, Anda tidak benar-benar tahu perilaku HTTP backend Anda.

---

## 7. Backend HTTP Responsibility Map

HTTP backend responsibility bisa dipetakan ke beberapa axis.

### 7.1 Semantic correctness

Tanggung jawab:

- memilih method yang tepat;
- memilih status code yang tepat;
- mendefinisikan URI sebagai resource identity;
- membedakan command, resource creation, replacement, partial update, retrieval;
- mengekspresikan conflict, stale update, unauthorized, forbidden, invalid media type, rate limited, dan overload secara benar.

Pertanyaan inti:

```text
Apakah response yang saya kirim memberi sinyal yang benar kepada client, proxy, cache, retry logic, dan operator?
```

### 7.2 Representation correctness

Tanggung jawab:

- menentukan `Content-Type`;
- memvalidasi request body;
- menegosiasikan `Accept` bila perlu;
- menjaga backward compatibility;
- memisahkan domain model dari API representation;
- mendesain error representation yang stabil.

Pertanyaan inti:

```text
Apakah data yang masuk/keluar jelas format, versi, batasan, dan maknanya?
```

### 7.3 State correctness

Tanggung jawab:

- menjaga idempotency;
- menghindari lost update;
- menangani duplicate request;
- menangani retry setelah timeout;
- menggunakan transaction boundary yang benar;
- menjaga audit integrity;
- menolak workflow transition yang tidak valid.

Pertanyaan inti:

```text
Apa yang terjadi jika request ini diterima dua kali, bersamaan, terlambat, stale, atau response-nya hilang?
```

### 7.4 Security correctness

Tanggung jawab:

- authentication;
- authorization;
- object-level access control;
- tenant isolation;
- CSRF/CORS/cookie policy;
- token validation;
- secret leakage prevention;
- secure headers;
- input boundary defense;
- abuse/rate limiting.

Pertanyaan inti:

```text
Apa asumsi trust pada setiap header, token, ID, dan body field?
```

### 7.5 Operational correctness

Tanggung jawab:

- timeout;
- cancellation;
- backpressure;
- load shedding;
- logging;
- metrics;
- tracing;
- health checks;
- graceful shutdown;
- capacity planning.

Pertanyaan inti:

```text
Saat rusak, apakah sistem gagal dengan cara yang bisa dikontrol dan dijelaskan?
```

---

## 8. HTTP Backend as External State Machine

Salah satu cara berpikir paling kuat: API HTTP adalah **state machine yang diekspos keluar**.

Misalnya domain regulatory case:

```text
DRAFT -> SUBMITTED -> SCREENING -> ASSIGNED -> INVESTIGATION -> REVIEW -> DECISION -> CLOSED
```

Tidak semua HTTP method valid di semua state.

Contoh:

| Resource State | Request | Expected Backend Behavior |
|---|---|---|
| DRAFT | `PUT /cases/{id}` | boleh replace draft |
| SUBMITTED | `PUT /cases/{id}` | mungkin ditolak, karena submitted case immutable |
| ASSIGNED | `POST /cases/{id}/evidence` | boleh upload evidence |
| REVIEW | `POST /cases/{id}/decision` | boleh jika reviewer authorized |
| CLOSED | `POST /cases/{id}/evidence` | conflict atau forbidden tergantung policy |
| Any | `GET /cases/{id}` | boleh jika authorized |

Status code menjadi sinyal state transition:

- `201 Created`: resource baru dibuat.
- `202 Accepted`: request diterima tapi proses belum selesai.
- `204 No Content`: operation sukses tanpa representation body.
- `400 Bad Request`: syntax/shape request invalid.
- `401 Unauthorized`: authentication diperlukan/gagal.
- `403 Forbidden`: identity dikenal tapi tidak punya akses.
- `404 Not Found`: resource tidak ditemukan atau disembunyikan.
- `409 Conflict`: request valid secara bentuk, tetapi konflik dengan current resource state.
- `412 Precondition Failed`: precondition seperti `If-Match` gagal.
- `422 Unprocessable Content`: representation dapat dipahami tetapi semantic validation gagal.
- `429 Too Many Requests`: rate limit.
- `503 Service Unavailable`: server tidak bisa melayani sementara, sering terkait overload/maintenance.

Backend API yang baik membuat state machine ini jelas. API yang buruk membuat semua failure menjadi:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "success": false,
  "message": "Failed"
}
```

Itu membunuh semantics HTTP.

---

## 9. “Top 1% Backend HTTP Engineer” Rubric

Seorang backend engineer rata-rata bisa membuat endpoint. Engineer kuat bisa mendesain contract. Engineer top-tier bisa memodelkan consequence.

### 9.1 Level 1 — Framework user

Ciri:

- tahu `@RestController`;
- bisa membuat CRUD endpoint;
- return `ResponseEntity`;
- tahu status code dasar;
- bisa parse JSON.

Keterbatasan:

- sering memilih POST untuk semua hal;
- error model tidak konsisten;
- idempotency tidak dipikirkan;
- authorization sering role-only;
- timeout/retry diserahkan ke default;
- observability minim.

### 9.2 Level 2 — API designer

Ciri:

- memodelkan resource dengan baik;
- memilih method/status lebih tepat;
- membuat DTO kontrak;
- validation error rapi;
- versioning dipikirkan;
- OpenAPI cukup akurat.

Keterbatasan:

- masih kurang kuat di distributed failure;
- belum selalu memikirkan proxy/gateway behavior;
- caching/concurrency/idempotency belum matang.

### 9.3 Level 3 — Production backend engineer

Ciri:

- memahami retry, timeout, cancellation;
- mendesain idempotency key;
- memakai ETag/precondition untuk lost update;
- punya consistent error taxonomy;
- tahu reverse proxy/gateway trust boundary;
- punya metrics/logs/traces yang berguna;
- sadar cache safety;
- melakukan rate limit dan load shedding.

### 9.4 Level 4 — Top-tier HTTP systems engineer

Ciri:

- melihat API sebagai protocol + domain + operations contract;
- mampu mendesain failure matrix;
- mampu men-debug cross-layer behavior dari client sampai gateway dan app;
- tahu kapan REST/resource style tepat dan kapan command/RPC style lebih jujur;
- membuat API yang aman, evolvable, observable, retriable, dan defensible;
- mampu menjelaskan invariants sistem dalam bentuk HTTP contract;
- tidak bergantung buta pada framework defaults.

Target seri ini adalah membawa Anda menuju level 4.

---

## 10. Konsep Inti yang Akan Terus Dipakai

### 10.1 Resource

Resource adalah sesuatu yang dapat diidentifikasi oleh URI.

Contoh:

```text
/cases/123
/cases/123/evidence/abc
/cases/123/assignment
/users/42
/reports/monthly-compliance-2026-06
```

Resource tidak harus row database. Resource bisa view, collection, relationship, process result, export job, atau virtual concept.

Yang penting:

```text
URI identifies a conceptual target.
```

### 10.2 Representation

Representation adalah bentuk data yang dikirim untuk menggambarkan current/intended state resource.

Contoh satu resource bisa punya banyak representation:

```http
GET /cases/123
Accept: application/json
```

```http
GET /cases/123
Accept: application/pdf
```

Resource sama, representation berbeda.

Backend harus tidak mencampuradukkan:

```text
resource identity != database entity != DTO != JSON body
```

### 10.3 Method

Method menyatakan intent standar:

- GET: retrieve representation.
- POST: process representation, create subordinate resource, command-like action.
- PUT: replace target resource representation.
- PATCH: partial modification.
- DELETE: remove target resource association/state.
- HEAD: metadata same as GET without body.
- OPTIONS: communication options.

Method bukan dekorasi routing. Method adalah kontrak safety, idempotency, cacheability, dan retry behavior.

### 10.4 Status code

Status code adalah outcome class.

Itu bukan hanya “angka untuk frontend”. Status code dibaca oleh:

- client SDK;
- browser;
- proxy;
- CDN;
- load balancer;
- monitoring system;
- retry library;
- incident responder;
- automated tests;
- API governance tools.

Status code salah bisa menyebabkan:

- retry yang tidak aman;
- cache yang salah;
- alert palsu;
- client salah branching;
- security ambiguity;
- audit buruk.

### 10.5 Header

Header membawa metadata. Banyak perilaku production dikendalikan header:

- `Authorization`
- `Content-Type`
- `Accept`
- `Cache-Control`
- `ETag`
- `If-Match`
- `Retry-After`
- `Location`
- `Set-Cookie`
- `Forwarded`
- `X-Forwarded-For`
- `Traceparent`
- `Correlation-Id`

Header adalah control plane HTTP.

### 10.6 Body

Body adalah stream, bukan selalu string kecil.

Body bisa:

- empty;
- JSON;
- multipart;
- binary;
- compressed;
- chunked;
- large;
- infinite-ish streaming;
- malformed;
- malicious.

Backend harus punya batas:

- maksimum size;
- timeout read;
- media type allowlist;
- parser configuration;
- validation;
- streaming strategy;
- memory strategy.

### 10.7 Connection

Connection bukan request. Satu connection dapat membawa banyak request, tergantung versi dan konfigurasi.

Masalah connection-level:

- keep-alive;
- idle timeout;
- connection pool;
- TLS handshake;
- HTTP/2 multiplexing;
- slow clients;
- upstream connection exhaustion.

Backend engineer yang hanya melihat controller tidak akan melihat bottleneck ini.

---

## 11. Backend Layering: Dari Protocol ke Domain

Pemisahan layer yang sehat:

```text
HTTP Layer
  - parse request
  - auth/authz boundary
  - validate transport/representation concerns
  - map status/errors/headers

Application Layer
  - orchestrate use case
  - transaction boundary
  - idempotency coordination
  - downstream calls
  - command/query handling

Domain Layer
  - invariants
  - state transitions
  - business rules
  - aggregate consistency

Infrastructure Layer
  - database
  - queue
  - cache
  - external HTTP clients
  - storage
  - distributed locks
```

Kesalahan umum:

1. HTTP concern bocor ke domain:

```java
class CaseAggregate {
    ResponseEntity<?> approve(...) { ... }
}
```

2. Domain concern hilang di controller:

```java
@PostMapping("/approve")
public ResponseEntity<?> approve(...) {
    repository.updateStatus(id, "APPROVED");
    return ok();
}
```

3. Infrastructure error diekspos mentah:

```json
{
  "error": "org.postgresql.util.PSQLException: duplicate key value violates unique constraint..."
}
```

4. HTTP status dipilih di service tanpa taxonomy:

```java
throw new RuntimeException("bad request");
```

Pola lebih sehat:

```text
Controller
  maps HTTP request -> application command/query

Application Service
  enforces use-case flow, transaction, idempotency, authorization collaboration

Domain
  enforces invariants and transition validity

Exception/Error Mapper
  maps known outcomes -> HTTP status + problem response
```

---

## 12. Backend API Design Is Boundary Design

Setiap HTTP endpoint adalah boundary. Boundary selalu menanyakan:

1. Apa yang boleh masuk?
2. Apa yang tidak boleh masuk?
3. Siapa yang boleh melakukan?
4. Dalam kondisi state apa boleh dilakukan?
5. Berapa biaya operasinya?
6. Apa efek sampingnya?
7. Apa yang terjadi jika diulang?
8. Apa yang terjadi jika gagal di tengah?
9. Apa yang bisa diamati operator?
10. Apa yang dijanjikan ke client?

Contoh endpoint:

```http
POST /cases/123/evidence
```

Boundary questions:

- Apakah user authenticated?
- Apakah user assigned ke case itu?
- Apakah case masih menerima evidence?
- Apakah file type diizinkan?
- Apakah file size aman?
- Apakah upload disimpan langsung ke app memory?
- Apakah virus scanning sync atau async?
- Apakah evidence visible sebelum scan selesai?
- Apakah request idempotent?
- Jika client disconnect setelah upload berhasil, apa response recovery path?
- Apakah audit log dibuat?
- Apakah event dikirim ke queue?
- Jika queue gagal setelah file tersimpan, apakah transaction konsisten?
- Apa status code jika case closed?
- Apa status code jika file terlalu besar?
- Apa log yang ditulis tanpa membocorkan data sensitif?

Ini adalah backend HTTP thinking.

---

## 13. Request as Resource Consumption

Setiap request mengonsumsi resource:

- socket;
- file descriptor;
- TLS CPU;
- parser CPU;
- heap memory;
- direct buffer;
- thread;
- event loop slot;
- database connection;
- transaction lock;
- cache connection;
- downstream connection;
- queue producer;
- object storage bandwidth;
- log volume;
- metrics cardinality;
- trace storage;
- human attention saat incident.

Jadi API design bukan hanya “bisa melayani feature”. API design juga harus menjawab:

```text
Berapa biaya satu request normal?
Berapa biaya request invalid?
Berapa biaya request malicious?
Berapa biaya request yang timeout?
Berapa biaya request yang diulang 100 kali?
```

### 13.1 Bad pattern: expensive validation after expensive work

```text
1. Terima body 500 MB
2. Simpan ke disk
3. Upload ke object storage
4. Call downstream scanner
5. Baru cek apakah user boleh upload
```

Lebih baik:

```text
1. Authenticate
2. Authorize
3. Check case state
4. Check declared metadata
5. Enforce size/type limit
6. Baru consume large body
```

Prinsip:

```text
Reject early before consuming expensive resources.
```

Tetapi jangan over-generalize. Ada kondisi di mana parsing body diperlukan untuk authorization object-level. Tetap, urutannya harus sadar biaya dan risiko.

---

## 14. Failure Model: HTTP Backend Harus Berpikir dalam Matriks

Backend HTTP production tidak boleh hanya punya dua kondisi:

```text
success / failed
```

Harus ada failure taxonomy.

### 14.1 Client-side request problem

Contoh:

- malformed JSON;
- missing required field;
- invalid enum;
- unsupported media type;
- field violates business validation;
- stale version;
- conflict with current state;
- unauthorized;
- forbidden;
- not found.

Biasanya 4xx.

### 14.2 Server-side processing problem

Contoh:

- unexpected exception;
- database unavailable;
- queue unavailable;
- downstream timeout;
- thread pool exhausted;
- dependency returns bad gateway;
- service shutting down.

Biasanya 5xx.

### 14.3 Overload / protection problem

Contoh:

- rate limit exceeded;
- concurrency limit exceeded;
- queue too deep;
- circuit open;
- server intentionally shedding load.

Biasanya `429` atau `503`, tergantung apakah limit melekat pada client quota atau service availability.

### 14.4 Ambiguous completion problem

Ini paling penting di distributed backend.

Skenario:

```text
Client sends POST /payments
Server commits payment
Server crashes before response
Client times out
Client retries
```

Apakah payment dibuat dua kali?

Skenario lain:

```text
Client sends POST /cases/123/submit
Server updates DB
Server fails before audit event publish
Client sees 500
```

Apakah case submitted? Apakah audit lengkap? Apakah client boleh retry?

HTTP backend yang kuat punya jawaban untuk ambiguous completion:

- idempotency key;
- transaction/outbox;
- client-visible operation resource;
- status endpoint;
- dedupe table;
- replayed response;
- eventual consistency semantics.

---

## 15. Correctness Axes: Safe, Idempotent, Cacheable, Atomic, Observable

HTTP method punya beberapa property penting, tetapi backend operation juga punya property domain.

### 15.1 Safe

Safe berarti request secara semantic tidak dimaksudkan untuk mengubah server state.

GET harus safe. Tetapi “safe” bukan berarti server tidak menulis log, metrics, atau cache. Yang dimaksud adalah client tidak meminta state-changing operation.

Bad:

```http
GET /cases/123/approve
```

Masalah:

- crawler bisa memanggil;
- browser prefetch bisa memanggil;
- proxy/cache bisa memperlakukan sebagai retrieval;
- retry behavior tidak sesuai;
- audit buruk.

### 15.2 Idempotent

Idempotent berarti menjalankan request yang sama beberapa kali memiliki efek akhir yang sama seperti sekali.

PUT dan DELETE secara semantic idempotent. POST tidak secara default idempotent, tetapi business operation POST bisa dibuat idempotent dengan key.

Contoh idempotent secara business:

```http
POST /cases/123/submissions
Idempotency-Key: abc
```

Jika key sama dan payload sama, backend mengembalikan hasil yang sama, bukan membuat submission ganda.

### 15.3 Cacheable

Cacheability bukan hanya performa. Cacheability adalah correctness contract.

Jika response user-specific dikirim dengan cache header public yang salah, data bisa bocor. Jika immutable data tidak dicache, sistem boros. Jika stale data disajikan untuk decision-critical workflow, keputusan bisa salah.

### 15.4 Atomic

HTTP tidak menjamin atomicity. Aplikasi yang menentukan.

Contoh:

```text
POST /cases/123/decision
```

Mungkin operation internalnya:

1. update case status;
2. insert decision record;
3. write audit log;
4. publish event;
5. notify external party.

Apakah semuanya atomic? Tidak selalu. Database transaction mungkin hanya mencakup langkah 1-3. Event dan notification butuh outbox/retry.

### 15.5 Observable

Operation yang tidak observable adalah liability.

Setiap endpoint penting harus menjawab:

- request count?
- error rate?
- latency distribution?
- payload size?
- timeout count?
- cancellation count?
- auth failure count?
- dependency failure attribution?
- correlation id?
- audit id?

---

## 16. Backend HTTP and Java: Kenapa Framework Tidak Cukup

Java backend modern biasanya memakai:

- Spring MVC di atas Servlet container seperti Tomcat/Jetty/Undertow;
- Spring WebFlux di atas Reactor Netty atau Servlet container;
- JAX-RS/Jakarta REST;
- Micronaut/Quarkus;
- Java `HttpClient`, Apache HttpClient, OkHttp, WebClient untuk outbound call.

Framework membantu banyak hal:

- routing;
- binding;
- validation;
- serialization;
- filters/interceptors;
- security integration;
- error handling;
- metrics;
- testing.

Tetapi framework tidak otomatis membuat API Anda benar.

### 16.1 Framework dapat menerima desain buruk

Contoh:

```java
@GetMapping("/deleteUser")
public ResponseEntity<?> deleteUser(@RequestParam UUID id) {
    userService.delete(id);
    return ResponseEntity.ok().build();
}
```

Framework tidak akan protes. Tetapi secara HTTP semantics itu buruk.

Contoh lain:

```java
@PostMapping("/cases/{id}/approve")
public ResponseEntity<?> approve(@PathVariable UUID id) {
    caseService.approve(id);
    return ResponseEntity.ok().build();
}
```

Ini mungkin valid, tetapi belum menjawab:

- duplicate retry;
- stale case version;
- authorization;
- audit;
- conflict;
- idempotency;
- async downstream;
- error taxonomy.

### 16.2 Spring MVC mental model

Secara kasar:

```text
HTTP request
  -> servlet container connector
  -> filter chain
  -> DispatcherServlet
  -> handler mapping
  -> handler adapter
  -> argument resolution
  -> controller method
  -> return value handling
  -> message conversion
  -> exception resolution
  -> response
```

Anda perlu tahu lifecycle ini agar tahu di mana menaruh:

- authentication;
- authorization;
- correlation ID;
- request logging;
- body caching;
- validation;
- exception mapping;
- response headers;
- metrics;
- timeouts.

### 16.3 WebFlux mental model

Spring WebFlux mengubah runtime model:

```text
HTTP request
  -> event loop
  -> reactive pipeline
  -> handler
  -> non-blocking downstream composition
  -> response publisher
```

WebFlux berguna untuk I/O-bound, streaming, high-concurrency non-blocking workloads, tetapi bisa menjadi buruk jika Anda memasukkan blocking database call atau blocking file IO sembarangan ke event loop.

Prinsip:

```text
Reactive programming is not magic performance.
It is a resource management model.
```

---

## 17. HTTP as Trust Boundary

Backend harus skeptis terhadap semua input HTTP.

Input tidak hanya body. Semua ini input:

- method;
- path;
- query string;
- headers;
- cookies;
- host;
- scheme forwarded by proxy;
- client IP;
- content length;
- content type;
- multipart filename;
- uploaded bytes;
- JWT claims;
- API key;
- correlation ID;
- idempotency key;
- trace headers.

Tidak semua input punya trust level sama.

### 17.1 Header trust example

`X-Forwarded-For` bisa berisi client IP asli jika ditulis oleh trusted proxy. Tetapi jika application server langsung menerima request dari internet, client bisa memalsukan header itu.

Jadi rule-nya:

```text
Forwarded headers are only trustworthy if received from a trusted intermediary and normalized at the boundary.
```

### 17.2 JWT trust example

JWT payload bisa dibaca tanpa verifikasi. Tetapi membaca bukan berarti percaya.

Backend harus memverifikasi:

- signature;
- issuer;
- audience;
- expiry;
- not-before;
- algorithm constraints;
- key rotation;
- token type;
- scopes/claims;
- tenant boundary.

### 17.3 ID trust example

Jika request:

```http
GET /tenants/acme/cases/123
Authorization: Bearer <token-for-different-tenant>
```

Backend tidak boleh hanya mencari `case_id = 123`. Query harus scoped:

```sql
SELECT *
FROM cases
WHERE tenant_id = :tenantFromPrincipal
  AND case_id = :caseId
```

Atau authorization harus dilakukan sebelum data exposure.

Object-level authorization adalah salah satu titik paling sering gagal pada API.

---

## 18. HTTP as Observability Boundary

HTTP adalah salah satu sumber sinyal operasional paling penting.

Minimal backend harus bisa menjawab:

```text
Untuk endpoint X:
- Berapa request per second?
- Berapa p50/p95/p99 latency?
- Berapa error rate 4xx vs 5xx?
- Status code apa yang dominan?
- Client/tenant mana yang overload?
- Dependency mana yang menyebabkan latency?
- Apakah request gagal sebelum masuk controller atau setelah domain logic?
- Apakah banyak client disconnect?
- Apakah banyak timeout dari gateway?
- Apakah banyak retry duplicate?
```

### 18.1 Logs

Access log menjawab:

```text
Siapa memanggil endpoint apa, kapan, status apa, latency berapa, size berapa?
```

Application log menjawab:

```text
Use case apa yang terjadi, keputusan domain apa yang dibuat, failure apa yang muncul?
```

Audit log menjawab:

```text
User mana melakukan action apa terhadap resource apa, dengan authority apa, dan outcome apa?
```

Tiga log ini berbeda. Jangan campur semua menjadi log bebas.

### 18.2 Metrics

Metrics harus low-cardinality.

Bagus:

```text
http.server.request.duration{method="GET", route="/cases/{id}", status="200"}
```

Buruk:

```text
http.server.request.duration{path="/cases/123456789"}
```

Path raw bisa meledakkan cardinality.

### 18.3 Traces

Trace menghubungkan:

```text
incoming HTTP request
  -> application service
  -> database call
  -> cache call
  -> downstream HTTP call
  -> queue publish
```

Trace berguna saat latency/failure lintas service.

---

## 19. HTTP as Evolution Boundary

API hidup lebih lama daripada implementasi internal.

Backend boleh mengganti:

- database;
- ORM;
- framework;
- service decomposition;
- queue;
- cache;
- deployment topology.

Tetapi external HTTP contract sulit diubah jika sudah dipakai client.

Jadi desain awal harus sadar evolusi.

### 19.1 Evolvable representation

Contoh aman:

```json
{
  "id": "123",
  "status": "UNDER_REVIEW",
  "createdAt": "2026-06-18T10:15:30Z"
}
```

Menambah field biasanya aman:

```json
{
  "id": "123",
  "status": "UNDER_REVIEW",
  "createdAt": "2026-06-18T10:15:30Z",
  "assignedUnit": "ENFORCEMENT_A"
}
```

Tetapi mengubah makna `status`, format `createdAt`, atau menghapus `id` adalah breaking.

### 19.2 Evolvable error model

Jika error hanya string:

```json
{
  "message": "Case cannot be approved"
}
```

Client sulit melakukan branching stabil.

Lebih baik:

```json
{
  "type": "https://api.example.gov/problems/invalid-case-transition",
  "title": "Invalid case transition",
  "status": 409,
  "code": "CASE_INVALID_TRANSITION",
  "detail": "Case 123 cannot transition from CLOSED to APPROVED.",
  "instance": "/cases/123/approval-decisions/req-789",
  "correlationId": "4f4c..."
}
```

Client bisa mengandalkan `code`/`type`, manusia bisa membaca `detail`, operator bisa memakai `correlationId`.

---

## 20. Common Anti-Patterns

### 20.1 Always 200

```http
HTTP/1.1 200 OK

{
  "success": false,
  "error": "Unauthorized"
}
```

Dampak:

- monitoring mengira sukses;
- client generic tidak bisa menangani;
- proxy/cache/retry logic salah;
- security signal kabur.

### 20.2 POST for everything

```text
POST /getCase
POST /updateCase
POST /deleteCase
POST /searchCases
POST /approveCase
```

Kadang POST memang benar untuk command atau complex query tertentu, tetapi POST untuk semuanya biasanya menandakan tidak ada resource model.

### 20.3 Business error as 500

```text
User tries to approve CLOSED case -> 500 Internal Server Error
```

Itu bukan server error. Itu conflict dengan current resource state, kemungkinan `409 Conflict`.

### 20.4 Leaking implementation detail

```json
{
  "error": "NullPointerException at CaseService.java:97"
}
```

Dampak:

- security leakage;
- poor client contract;
- noisy debugging;
- reputational risk.

### 20.5 Ignoring duplicate request

```text
Client timeout after POST success.
Client retries.
Server creates duplicate record.
```

Ini sering terjadi pada payment, submission, workflow transition, notification, booking, order, dan approval.

### 20.6 Missing object-level authorization

```text
GET /cases/123
```

Backend hanya cek role `INVESTIGATOR`, tetapi tidak cek apakah investigator tersebut assigned ke case 123 atau tenant yang benar.

### 20.7 Trusting forwarded headers from anywhere

```java
String clientIp = request.getHeader("X-Forwarded-For");
```

Jika tidak dinormalisasi oleh trusted proxy, header ini bisa dipalsukan.

### 20.8 No timeout discipline

Default timeout sering tidak sesuai. Tanpa timeout yang jelas, request bisa menggantung, thread habis, pool habis, dan service collapse.

### 20.9 Unbounded body parsing

Membaca body besar langsung ke memory:

```java
byte[] all = request.getInputStream().readAllBytes();
```

Dampak:

- memory pressure;
- GC spike;
- OOM;
- DoS.

### 20.10 Poor route metrics

Mencatat metric berdasarkan raw path:

```text
/cases/1
/cases/2
/cases/3
...
```

Ini menciptakan high cardinality dan membuat observability backend mahal/tidak stabil.

---

## 21. A Backend HTTP Design Checklist

Gunakan checklist ini saat mendesain endpoint baru.

### 21.1 Identity and resource

- Apa resource targetnya?
- Apakah URI stabil?
- Apakah URI merepresentasikan noun/resource atau action arbitrer?
- Apakah resource ini collection, item, relationship, command resource, atau process resource?
- Apakah resource mapping ke domain jelas?

### 21.2 Method

- Method apa yang paling benar?
- Apakah operation safe?
- Apakah idempotent?
- Apakah POST butuh idempotency key?
- Apakah PUT benar-benar replace?
- Apakah PATCH punya patch semantics yang jelas?

### 21.3 Request representation

- Apa `Content-Type` yang didukung?
- Apa schema body?
- Apa field required?
- Bagaimana null vs missing vs empty?
- Bagaimana unknown field?
- Bagaimana enum evolution?
- Bagaimana date/time format?
- Berapa max body size?

### 21.4 Response representation

- Apa success body?
- Apa empty response valid?
- Apa error body?
- Apakah error model konsisten?
- Apakah ada correlation ID?
- Apakah ada `Location` untuk created resource?

### 21.5 Status code

- Success status apa?
- Validation error status apa?
- Auth failure status apa?
- Authorization failure status apa?
- Not found vs forbidden strategy apa?
- Conflict status apa?
- Stale version status apa?
- Rate limit status apa?
- Overload status apa?

### 21.6 State and concurrency

- Apa valid state transition?
- Apa invalid transition?
- Apakah perlu optimistic locking?
- Apakah perlu ETag/If-Match?
- Apa yang terjadi jika request concurrent?
- Apa yang terjadi jika request duplicate?
- Apa yang terjadi jika response lost?

### 21.7 Security

- Bagaimana authentication?
- Bagaimana authorization?
- Apakah object-level authorization dilakukan?
- Apakah tenant boundary aman?
- Apakah sensitive fields difilter?
- Apakah request body bisa menyebabkan mass assignment?
- Apakah endpoint browser-facing dan butuh CSRF protection?
- Apakah CORS diperlukan?
- Apakah cache header aman untuk data sensitif?

### 21.8 Reliability

- Timeout berapa?
- Apakah downstream call punya timeout?
- Apakah retry aman?
- Apakah ada circuit breaker?
- Apakah ada rate limit?
- Apakah ada concurrency limit?
- Apakah cancellation ditangani?
- Apakah long-running operation harus async?

### 21.9 Observability

- Apa route name metric?
- Apa log event penting?
- Apa audit event?
- Apa trace span?
- Apa alert signal?
- Apakah high cardinality dihindari?
- Apakah sensitive data tidak bocor di log?

### 21.10 Evolution

- Apakah response bisa ditambah field tanpa breaking?
- Apakah enum bisa bertambah?
- Apakah error code stabil?
- Apakah deprecation strategy ada?
- Apakah OpenAPI/contract test sinkron?

---

## 22. Worked Example: Submit Regulatory Case

Mari gunakan contoh domain kompleks agar mental model terasa.

### 22.1 Naive design

```http
POST /submitCase
Content-Type: application/json

{
  "caseId": "CASE-123"
}
```

Controller:

```java
@PostMapping("/submitCase")
public ResponseEntity<?> submit(@RequestBody SubmitRequest request) {
    caseService.submit(request.caseId());
    return ResponseEntity.ok(Map.of("success", true));
}
```

Masalah:

1. URI action-oriented dan tidak menunjukkan resource hierarchy.
2. Tidak ada idempotency key.
3. Tidak ada concurrency/version guard.
4. Tidak jelas status code jika case sudah submitted.
5. Tidak jelas status code jika case tidak ditemukan.
6. Tidak jelas apakah user authorized atas case tersebut.
7. Tidak ada error taxonomy.
8. Tidak ada audit/correlation detail.
9. Jika client timeout, retry bisa menciptakan efek samping ganda.
10. Tidak jelas apakah submit synchronous atau asynchronous.

### 22.2 Better design option A: transition command as subordinate resource

```http
POST /cases/CASE-123/submissions
Authorization: Bearer <token>
Idempotency-Key: 2b36f9ce-924b-4b9a-b36d-d37ccfa7a9ef
Content-Type: application/json
If-Match: "case-v7"

{
  "submittedByUnit": "ENFORCEMENT_INTAKE",
  "comment": "All required fields completed."
}
```

Possible responses:

```http
HTTP/1.1 201 Created
Location: /cases/CASE-123/submissions/SUB-789
ETag: "case-v8"
Content-Type: application/json

{
  "id": "SUB-789",
  "caseId": "CASE-123",
  "status": "ACCEPTED",
  "submittedAt": "2026-06-18T10:15:30Z"
}
```

Duplicate retry with same idempotency key:

```http
HTTP/1.1 201 Created
Location: /cases/CASE-123/submissions/SUB-789
Idempotency-Replayed: true
Content-Type: application/json

{
  "id": "SUB-789",
  "caseId": "CASE-123",
  "status": "ACCEPTED",
  "submittedAt": "2026-06-18T10:15:30Z"
}
```

Stale client version:

```http
HTTP/1.1 412 Precondition Failed
Content-Type: application/problem+json

{
  "type": "https://api.example.gov/problems/precondition-failed",
  "title": "Precondition failed",
  "status": 412,
  "code": "CASE_VERSION_STALE",
  "detail": "The submitted case version does not match the current version.",
  "correlationId": "req-abc"
}
```

Already submitted by different operation:

```http
HTTP/1.1 409 Conflict
Content-Type: application/problem+json

{
  "type": "https://api.example.gov/problems/invalid-case-transition",
  "title": "Invalid case transition",
  "status": 409,
  "code": "CASE_ALREADY_SUBMITTED",
  "detail": "Case CASE-123 is already submitted.",
  "correlationId": "req-def"
}
```

### 22.3 What improved?

- Resource model lebih jelas.
- Submission menjadi resource/audit artifact.
- Idempotency dapat diterapkan.
- Optimistic concurrency dapat diterapkan.
- Success response menunjukkan created resource.
- Conflict dibedakan dari stale version.
- Error contract machine-readable.
- Operator bisa melacak dengan correlation ID.
- Client punya recovery strategy.

### 22.4 Backend implementation sketch

```java
@RestController
@RequestMapping("/cases/{caseId}/submissions")
class CaseSubmissionController {

    private final SubmitCaseUseCase submitCase;

    @PostMapping(consumes = "application/json", produces = "application/json")
    ResponseEntity<SubmissionResponse> submit(
            @PathVariable String caseId,
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @RequestHeader("If-Match") String ifMatch,
            @Valid @RequestBody SubmitCaseRequest body,
            Principal principal
    ) {
        SubmitCaseCommand command = new SubmitCaseCommand(
                caseId,
                idempotencyKey,
                ifMatch,
                body.submittedByUnit(),
                body.comment(),
                principal.getName()
        );

        SubmitCaseResult result = submitCase.handle(command);

        return ResponseEntity
                .created(URI.create("/cases/" + caseId + "/submissions/" + result.submissionId()))
                .eTag(result.newCaseEtag())
                .body(SubmissionResponse.from(result));
    }
}
```

Catatan: kode ini belum lengkap. Di part selanjutnya kita akan membahas detail exception mapping, idempotency store, authorization, ETag, dan transaction.

---

## 23. Worked Example: GET Case Detail

### 23.1 Basic request

```http
GET /cases/CASE-123
Authorization: Bearer <token>
Accept: application/json
```

Backend questions:

- Apakah token valid?
- Apakah user boleh melihat case?
- Apakah case ada dalam tenant user?
- Apakah representation JSON didukung?
- Apakah response user-specific?
- Apakah boleh dicache private?
- Apakah ETag dikirim?
- Apakah field disembunyikan berdasarkan role?

### 23.2 Possible response

```http
HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: private, no-cache
ETag: "case-v8"
Vary: Accept, Authorization

{
  "id": "CASE-123",
  "status": "SUBMITTED",
  "createdAt": "2026-06-18T10:15:30Z",
  "links": {
    "self": "/cases/CASE-123",
    "submissions": "/cases/CASE-123/submissions"
  }
}
```

Kenapa `private, no-cache`? Karena data case mungkin user-specific/sensitive dan perlu revalidation sebelum reuse. Detail caching akan dibahas di part caching.

### 23.3 Conditional GET

Client yang punya ETag bisa bertanya:

```http
GET /cases/CASE-123
If-None-Match: "case-v8"
```

Jika belum berubah:

```http
HTTP/1.1 304 Not Modified
ETag: "case-v8"
```

Ini menghemat bandwidth dan tetap menjaga correctness.

---

## 24. Worked Example: Update Case Draft

### 24.1 PUT replace semantics

```http
PUT /cases/CASE-123/draft
Content-Type: application/json
If-Match: "draft-v3"

{
  "subject": "Alleged reporting violation",
  "respondentId": "ORG-456",
  "allegationSummary": "...",
  "priority": "NORMAL"
}
```

Important semantics:

- PUT mengganti representation target resource.
- Client mengirim complete intended representation.
- `If-Match` mencegah lost update.

### 24.2 PATCH partial update

```http
PATCH /cases/CASE-123/draft
Content-Type: application/merge-patch+json
If-Match: "draft-v3"

{
  "priority": "HIGH"
}
```

Important semantics:

- PATCH butuh patch document semantics yang jelas.
- Null/missing punya makna spesifik tergantung patch format.
- Backend harus tidak memperlakukan PATCH sebagai “partial JSON bebas” tanpa aturan.

---

## 25. Backend HTTP Thinking in Microservices

Dalam microservice architecture, service Anda sering menjadi HTTP server dan HTTP client sekaligus.

```text
Browser/API client
  -> API Gateway
  -> Case Service
      -> Identity Service
      -> Evidence Service
      -> Notification Service
      -> Audit Service
```

Setiap outbound HTTP call punya problem yang sama:

- timeout;
- retry;
- connection pool;
- DNS;
- TLS;
- authentication;
- authorization;
- idempotency;
- error mapping;
- trace propagation;
- circuit breaker;
- cascading failure.

Backend engineer sering lebih hati-hati saat menerima HTTP request, tetapi ceroboh saat menjadi HTTP client.

Contoh buruk:

```java
String response = restTemplate.getForObject(url, String.class);
```

Tanpa:

- connect timeout;
- read timeout;
- pool limit;
- retry policy;
- status mapping;
- trace propagation;
- fallback/circuit breaker;
- response size limit.

Service-to-service HTTP juga akan punya part khusus di seri ini.

---

## 26. Production HTTP: Defaults Are Dangerous

Banyak incident terjadi bukan karena engineer tidak tahu fitur, tetapi karena default tidak sesuai production.

Periksa default untuk:

- max request header size;
- max request body size;
- multipart max file size;
- connection timeout;
- idle timeout;
- read timeout;
- write timeout;
- keep-alive timeout;
- thread pool size;
- accept queue;
- connection pool size outbound;
- JSON unknown property behavior;
- date/time serialization;
- error response body;
- stack trace exposure;
- CORS policy;
- cookie attributes;
- compression threshold;
- access log format;
- actuator endpoint exposure.

Prinsip:

```text
A production backend should have intentional HTTP defaults.
```

---

## 27. Mental Model: The Seven Questions for Every Endpoint

Jika hanya boleh membawa satu alat berpikir dari part ini, bawa tujuh pertanyaan ini.

### 27.1 What is the resource?

Apa target konseptual URI ini? Apakah resource, collection, relationship, command, export job, stream, atau virtual view?

### 27.2 What is the semantic intent?

Apakah client ingin retrieve, create, replace, partially modify, delete, start process, submit command, atau query?

### 27.3 What are the invariants?

State apa yang harus benar sebelum dan setelah operation?

Contoh:

```text
Closed case cannot accept new evidence.
Only assigned investigator can add evidence.
A decision can be made only once.
Audit record must exist for every state transition.
```

### 27.4 What happens under repetition?

Apakah request aman jika dikirim dua kali?

- same request immediately;
- same request after timeout;
- same request concurrently;
- same idempotency key but different payload;
- same payload different idempotency key.

### 27.5 What happens under concurrency?

- Dua reviewer update field berbeda.
- User submit draft saat supervisor revoke assignment.
- Client update stale version.
- Bulk operation berjalan saat item state berubah.

### 27.6 What is the failure signal?

Untuk setiap failure, status code dan error body apa?

```text
invalid JSON -> ?
unsupported content type -> ?
missing auth -> ?
forbidden object -> ?
not found -> ?
stale version -> ?
invalid transition -> ?
rate limited -> ?
downstream timeout -> ?
overloaded -> ?
```

### 27.7 How will we operate it?

- Apa metric route-nya?
- Apa log minimalnya?
- Apa audit event-nya?
- Apa trace boundary-nya?
- Bagaimana debugging client complaint?
- Bagaimana mendeteksi abuse?
- Bagaimana membedakan client bug dan server bug?

---

## 28. Mini Decision Tables

### 28.1 Method choice quick table

| Intent | Usually Method | Notes |
|---|---:|---|
| Retrieve resource representation | GET | Must be safe. |
| Retrieve metadata only | HEAD | Same headers as GET, no body. |
| Create subordinate resource | POST | Return 201 + Location if created. |
| Start processing command | POST | Consider idempotency key. |
| Replace known resource | PUT | Complete replacement semantics. |
| Partial modification | PATCH | Define patch media type. |
| Remove resource/association | DELETE | Should be idempotent at semantic level. |
| Discover allowed communication options | OPTIONS | Often used in CORS preflight. |

### 28.2 Status code first orientation

| Situation | Candidate Status |
|---|---:|
| Representation returned | 200 |
| Resource created | 201 |
| Accepted for async processing | 202 |
| Success without response body | 204 |
| Invalid syntax/request shape | 400 |
| Missing/invalid authentication | 401 |
| Authenticated but not allowed | 403 |
| Resource absent/hidden | 404 |
| Conflict with current resource state | 409 |
| Precondition failed | 412 |
| Unsupported request media type | 415 |
| Semantic validation failed | 422 |
| Too many requests | 429 |
| Unexpected server failure | 500 |
| Upstream/proxy bad gateway | 502 |
| Temporary unavailable/overload | 503 |
| Upstream timeout | 504 |

Jangan hafalkan tabel ini secara mekanis. Gunakan sebagai awal reasoning.

### 28.3 Where to enforce what

| Concern | Common Layer | Notes |
|---|---|---|
| TLS termination | Edge/LB/Gateway | App must know original scheme safely. |
| WAF rules | Edge | Not replacement for app validation. |
| Rate limit | Gateway + app | App may need business-cost aware limits. |
| Authentication | Gateway or app | App still needs trusted principal. |
| Object authorization | App/domain/query layer | Cannot be solved only at gateway. |
| Body size | Gateway + app server | Must be consistent. |
| JSON validation | App | Syntax + semantic validation. |
| Idempotency | App + datastore | Needs durable dedupe. |
| Optimistic concurrency | App + datastore + ETag | Needs version mapping. |
| Observability | All layers | Shared correlation/trace context. |

---

## 29. Practical Java/Spring Starting Template

Ini bukan final pattern, hanya orientasi awal struktur.

```java
@RestController
@RequestMapping(path = "/cases", produces = MediaType.APPLICATION_JSON_VALUE)
class CaseController {

    private final CreateCaseUseCase createCase;
    private final GetCaseQuery getCase;

    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<CaseResponse> create(
            @RequestHeader(name = "Idempotency-Key", required = false) String idempotencyKey,
            @Valid @RequestBody CreateCaseRequest request,
            Principal principal
    ) {
        CreateCaseResult result = createCase.handle(
                new CreateCaseCommand(
                        idempotencyKey,
                        principal.getName(),
                        request.subject(),
                        request.respondentId(),
                        request.allegationSummary()
                )
        );

        return ResponseEntity
                .created(URI.create("/cases/" + result.caseId()))
                .eTag(result.etag())
                .body(CaseResponse.from(result));
    }

    @GetMapping(path = "/{caseId}")
    ResponseEntity<CaseResponse> get(
            @PathVariable String caseId,
            @RequestHeader(name = "If-None-Match", required = false) String ifNoneMatch,
            Principal principal
    ) {
        GetCaseResult result = getCase.handle(
                new GetCaseQueryRequest(caseId, ifNoneMatch, principal.getName())
        );

        if (result.notModified()) {
            return ResponseEntity
                    .status(HttpStatus.NOT_MODIFIED)
                    .eTag(result.etag())
                    .build();
        }

        return ResponseEntity
                .ok()
                .cacheControl(CacheControl.noCache().cachePrivate())
                .eTag(result.etag())
                .body(CaseResponse.from(result));
    }
}
```

Hal yang sengaja terlihat:

- controller menerima HTTP-specific concerns;
- command/query object dipakai untuk application layer;
- `Location` dan `ETag` dipikirkan;
- idempotency mulai diperkenalkan;
- conditional request mulai diperkenalkan;
- response metadata bukan afterthought.

Hal yang belum lengkap:

- exception mapping;
- Problem Details;
- authentication/security config;
- authorization;
- idempotency store;
- transaction;
- observability;
- OpenAPI;
- tests.

Semua akan dibahas bertahap.

---

## 30. Study Path untuk Seri Ini

Part 000 adalah peta. Part berikutnya akan masuk detail.

Urutan belajar:

1. **Semantics first**: resource, method, status, header, representation.
2. **Correctness second**: validation, error, idempotency, concurrency, caching.
3. **Security third**: authn, authz, cookies, CORS, rate limit.
4. **Production fourth**: timeout, streaming, protocol versions, proxies, observability, attacks.
5. **Java implementation last**: Spring MVC, WebFlux, HTTP clients, capstone.

Kenapa Java implementation tidak diletakkan paling awal?

Karena framework syntax tanpa protocol mental model akan membuat Anda cepat membuat endpoint, tetapi tidak cepat membuat API yang benar.

---

## 31. Exercises

### Exercise 1 — Endpoint diagnosis

Evaluasi endpoint berikut:

```http
POST /api/doUpdate
Content-Type: application/json

{
  "caseId": "CASE-123",
  "status": "APPROVED"
}
```

Jawab:

1. Apa resource yang sebenarnya?
2. Apakah method tepat?
3. Apa risiko authorization?
4. Apa risiko state transition?
5. Apa risiko duplicate request?
6. Apa status code untuk invalid transition?
7. Apa status code untuk stale update?
8. Apa error response shape yang baik?
9. Apa audit event yang perlu ditulis?
10. Apa metric route yang tepat?

### Exercise 2 — Failure matrix

Untuk endpoint:

```http
POST /cases/{caseId}/evidence
```

Buat tabel failure untuk:

- unauthenticated;
- authenticated but not assigned;
- case not found;
- case closed;
- unsupported media type;
- file too large;
- virus scan service unavailable;
- object storage timeout;
- duplicate idempotency key same payload;
- duplicate idempotency key different payload;
- client disconnect after upload completed.

Tentukan:

- status code;
- error code;
- retryable or not;
- audit required or not;
- log level;
- metric tag.

### Exercise 3 — Resource redesign

Ubah endpoint action-style berikut menjadi resource-oriented design:

```text
POST /approveCase
POST /rejectCase
POST /assignCase
POST /uploadEvidence
POST /closeCase
POST /reopenCase
```

Tidak semua harus menjadi pure REST noun. Yang penting jujur secara semantics, jelas resource-nya, dan defensible.

### Exercise 4 — Java boundary

Ambil satu controller di project Anda. Tandai mana concern yang termasuk:

- HTTP layer;
- application layer;
- domain layer;
- infrastructure layer.

Cari minimal tiga kebocoran boundary.

---

## 32. Key Takeaways

1. HTTP backend bukan sekadar menerima JSON dan mengembalikan JSON.
2. HTTP adalah semantic protocol contract yang dibaca oleh client, proxy, cache, gateway, observability tools, security tools, dan manusia.
3. Backend bertanggung jawab atas method, status, headers, body, validation, state transition, idempotency, concurrency, caching, security, reliability, dan observability.
4. Resource tidak sama dengan database row; representation tidak sama dengan domain object.
5. Status code adalah external state/failure signal, bukan dekorasi.
6. Header adalah HTTP control plane.
7. Request adalah konsumsi resource, sehingga perlu limit, timeout, cancellation, dan backpressure.
8. Distributed failure membuat idempotency dan ambiguous completion sangat penting.
9. Framework membantu implementasi, tetapi tidak menjamin semantic correctness.
10. API yang baik adalah kontrak yang aman, evolvable, observable, retriable, dan defensible.

---

## 33. References and Further Reading

Rujukan utama untuk seri ini:

1. RFC 9110 — HTTP Semantics: https://www.rfc-editor.org/rfc/rfc9110.html
2. RFC 9111 — HTTP Caching: https://www.rfc-editor.org/rfc/rfc9111.html
3. RFC 9112 — HTTP/1.1: https://www.rfc-editor.org/rfc/rfc9112.html
4. RFC 9113 — HTTP/2: https://www.rfc-editor.org/rfc/rfc9113.html
5. RFC 9114 — HTTP/3: https://www.rfc-editor.org/rfc/rfc9114.html
6. OWASP REST Security Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html
7. OWASP API Security Top 10 2023: https://owasp.org/API-Security/editions/2023/en/0x11-t10/
8. Spring Framework — DispatcherServlet: https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-servlet.html
9. Spring Framework — WebFlux: https://docs.spring.io/spring-framework/reference/web/webflux.html
10. OpenTelemetry HTTP Semantic Conventions: https://opentelemetry.io/docs/specs/semconv/http/

---

## 34. What Comes Next

Part berikutnya:

```text
learn-http-for-web-backend-perspective-part-001.md
```

Judul:

```text
HTTP Semantics from Server Point of View
```

Fokus:

- resource;
- representation;
- target URI;
- method semantics;
- selected representation;
- safe/idempotent/cacheable;
- kenapa semantics harus stabil lintas HTTP/1.1, HTTP/2, dan HTTP/3;
- cara berpikir server saat menafsirkan request.

Seri belum selesai. Ini adalah Part 000 dari 032.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<span></span>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-http-for-web-backend-perspective-part-001.md">Part 001 — HTTP Semantics from Server Point of View ➡️</a>
</div>
