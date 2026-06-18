# learn-java-servlet-websocket-web-container-runtime-part-031

# Part 031 — Advanced Architecture Patterns and Final Integration

> Seri: `learn-java-servlet-websocket-web-container-runtime`  
> Part: `031`  
> Topik: Advanced Architecture Patterns and Final Integration  
> Target: Java 8 sampai Java 25, Java EE `javax.*`, Jakarta EE `jakarta.*`, Servlet, WebSocket, web container, reverse proxy, deployment runtime, observability, dan failure modelling.

---

## 0. Posisi Part Ini Dalam Seri

Part ini adalah penutup dari keseluruhan seri.

Kita sudah membangun lapisan demi lapisan:

1. HTTP sebagai protokol.
2. Servlet container sebagai runtime.
3. Servlet lifecycle.
4. Request dan response object.
5. Dispatching, filter, listener, context, session, cookie.
6. Async servlet dan non-blocking I/O.
7. Large payload, error handling, threading, classloading, packaging.
8. WebSocket protocol, endpoint model, state management, reliability, security.
9. SSE/long polling sebagai alternatif.
10. JSP/Jakarta Pages untuk legacy view.
11. Container configuration.
12. Reverse proxy, load balancer, Kubernetes/cloud runtime.
13. Observability dan diagnostics.

Part ini menyatukan semua menjadi **cara berpikir arsitektural**.

Tujuannya bukan lagi “bagaimana memakai API tertentu”, tetapi:

- bagaimana merancang runtime web Java yang predictable,
- bagaimana membaca failure dari ujung client sampai backend dependency,
- bagaimana menentukan boundary yang benar,
- bagaimana memilih pattern yang tepat,
- bagaimana membuat sistem yang bisa dioperasikan, bukan hanya bisa dijalankan,
- bagaimana berpikir seperti engineer yang memahami lifecycle, concurrency, protocol, deployment, dan failure sebagai satu sistem.

---

## 1. Mental Model Akhir: Java Web Runtime Sebagai Sistem Berlapis

Aplikasi Servlet/WebSocket bukan hanya kumpulan controller, endpoint, dan service class.

Secara runtime, ia adalah sistem berlapis seperti ini:

```text
Client / Browser / Mobile / Machine Client
        |
        | HTTP / HTTPS / WebSocket / SSE
        v
DNS / CDN / WAF / API Gateway
        |
        v
Load Balancer
        |
        v
Reverse Proxy / Ingress
        |
        v
Servlet Container Connector
        |
        v
HTTP Parser / WebSocket Upgrade Handler
        |
        v
Context Routing
        |
        v
Filter Chain
        |
        v
Servlet / Framework Dispatcher / WebSocket Endpoint
        |
        v
Application Service Layer
        |
        v
Downstream Dependencies
(DB, cache, message broker, external API, file/object storage)
```

Setiap lapisan punya:

- lifecycle,
- limit,
- timeout,
- buffering behavior,
- concurrency model,
- error semantics,
- security boundary,
- observability signal.

Top-tier engineer tidak hanya bertanya:

> “Controller saya sudah benar belum?”

Tetapi bertanya:

> “Request ini melewati boundary apa saja, state apa yang berubah di tiap boundary, timeout mana yang paling dulu menang, dan siapa yang bertanggung jawab saat response sudah committed?”

---

## 2. Prinsip Inti: Jangan Mendesain Berdasarkan API, Desain Berdasarkan Lifecycle

API memberi syntax.

Lifecycle memberi kebenaran operasional.

Contoh:

```java
@WebServlet("/export")
public class ExportServlet extends HttpServlet {
    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp) throws IOException {
        exportService.generate(resp.getOutputStream());
    }
}
```

Secara API, ini terlihat sederhana.

Secara lifecycle, pertanyaannya jauh lebih banyak:

- Berapa lama export berjalan?
- Apakah response sudah committed sebelum error terjadi?
- Apakah client bisa abort?
- Apakah proxy punya timeout lebih pendek dari proses export?
- Apakah thread request tertahan selama export?
- Apakah export mengambil koneksi DB terlalu lama?
- Apakah output stream menulis terlalu cepat ke client lambat?
- Apakah ada audit ketika download gagal separuh jalan?
- Apakah retry user akan membuat export ganda?
- Apakah rolling deployment akan memutus export?

Engineer yang hanya melihat API akan menulis kode.

Engineer yang melihat lifecycle akan mendesain sistem.

---

## 3. Request Lifecycle Sebagai State Machine

Request HTTP sebaiknya dipahami sebagai state machine.

```text
[ARRIVED]
   |
   v
[ACCEPTED_BY_PROXY]
   |
   v
[ACCEPTED_BY_CONTAINER]
   |
   v
[PARSED]
   |
   v
[ROUTED_TO_CONTEXT]
   |
   v
[FILTER_CHAIN_ENTERED]
   |
   v
[APPLICATION_PROCESSING]
   |
   +--> [ASYNC_STARTED]
   |        |
   |        v
   |    [WAITING_FOR_EXTERNAL_EVENT]
   |        |
   |        v
   |    [ASYNC_DISPATCH_OR_COMPLETE]
   |
   v
[RESPONSE_BUILDING]
   |
   v
[RESPONSE_COMMITTED]
   |
   v
[RESPONSE_FLUSHED]
   |
   v
[REQUEST_COMPLETED]
```

Failure dapat terjadi di setiap state:

```text
[ARRIVED]                  -> malformed request, TLS failure
[ACCEPTED_BY_PROXY]         -> WAF block, body too large, header too large
[ACCEPTED_BY_CONTAINER]     -> connection backlog full, worker saturated
[PARSED]                    -> invalid header/body encoding
[ROUTED_TO_CONTEXT]         -> wrong context path, 404
[FILTER_CHAIN_ENTERED]      -> auth failure, CORS failure, rate limit
[APPLICATION_PROCESSING]    -> business exception, downstream timeout
[ASYNC_STARTED]             -> lost completion, timeout race
[RESPONSE_BUILDING]         -> serialization error
[RESPONSE_COMMITTED]        -> cannot change status anymore
[RESPONSE_FLUSHED]          -> client abort, broken pipe
[REQUEST_COMPLETED]         -> metrics/logging/audit cleanup failure
```

### 3.1 Invariant Request Lifecycle

Beberapa invariant penting:

1. **Satu request harus punya satu final outcome.**  
   Jangan sampai filter, servlet, dan error handler masing-masing menulis outcome berbeda.

2. **Setelah response committed, status/header tidak bisa dianggap mutable.**  
   Error setelah commit bukan lagi error response normal; itu partial failure.

3. **Request body biasanya single-read.**  
   Filter yang membaca body harus menyediakan wrapper/cache bila downstream perlu membaca ulang.

4. **Request attribute hanya valid dalam lifecycle request tersebut.**  
   Jangan menyimpannya ke thread background tanpa pemahaman async boundary.

5. **Thread yang memulai request belum tentu thread yang menyelesaikan request.**  
   Ini benar untuk async servlet dan bisa relevan untuk framework modern.

6. **Timeout yang paling pendek di jalur request akan menentukan user experience.**  
   Bukan timeout yang paling indah di kode Java.

---

## 4. Connection Lifecycle Sebagai State Machine

Untuk WebSocket, SSE, dan streaming response, unit desainnya bukan request pendek, tetapi connection lifecycle.

```text
[CONNECTING]
   |
   v
[HANDSHAKE]
   |
   +--> [REJECTED]
   |
   v
[OPEN]
   |
   +--> [AUTHENTICATED]
   |
   +--> [SUBSCRIBED]
   |
   +--> [IDLE]
   |
   +--> [ACTIVE_SEND]
   |
   +--> [BACKPRESSURED]
   |
   +--> [HEARTBEAT_MISSED]
   |
   v
[CLOSING]
   |
   v
[CLOSED]
   |
   v
[CLEANED_UP]
```

### 4.1 Failure Connection Lifecycle

```text
[HANDSHAKE]           -> invalid token, invalid Origin, no sticky routing, proxy upgrade failure
[OPEN]                -> auth expiry, user logout, tenant revoked
[SUBSCRIBED]          -> unauthorized topic, stale permission
[ACTIVE_SEND]         -> slow client, send queue full
[BACKPRESSURED]       -> memory risk, latency explosion
[HEARTBEAT_MISSED]    -> network drop, mobile sleep, proxy idle timeout
[CLOSING]             -> close frame not delivered
[CLOSED]              -> duplicate reconnect
[CLEANED_UP]          -> registry leak if cleanup not idempotent
```

### 4.2 Invariant Connection Lifecycle

1. **Setiap connection harus punya owner identity yang jelas.**  
   Anonymous connection boleh ada, tetapi statusnya harus eksplisit.

2. **Setiap subscription harus punya authorization decision sendiri.**  
   Authentication saat handshake tidak cukup untuk semua message.

3. **Setiap session registry harus cleanup idempotent.**  
   `@OnClose`, `@OnError`, timeout, shutdown, dan manual close bisa terjadi berdekatan.

4. **Setiap outbound queue harus bounded.**  
   Queue tanpa batas adalah memory leak yang menunggu slow client.

5. **Reconnect harus dianggap normal, bukan exception.**  
   Real network tidak stabil.

6. **Presence bukan fakta sederhana.**  
   Presence adalah hasil dari heartbeat, lease, expiry, session registry, dan cluster propagation.

---

## 5. Pattern Catalog Untuk Servlet/WebSocket Runtime

Bagian ini menyusun pattern yang muncul berkali-kali dalam sistem web Java.

---

## 6. Pattern 1 — Front Controller

### 6.1 Masalah

Tanpa routing terpusat, logic request tersebar di banyak servlet.

Akibatnya:

- error handling tidak konsisten,
- logging tidak seragam,
- authorization tersebar,
- response format tidak seragam,
- dispatch flow sulit dipahami.

### 6.2 Solusi

Gunakan satu entry point utama yang menerima request lalu mendelegasikan ke handler internal.

```text
Client Request
   |
   v
FrontControllerServlet
   |
   +--> Route resolver
   +--> Handler adapter
   +--> Error mapper
   +--> Response renderer
```

Framework seperti Spring MVC, Jakarta MVC, Struts, dan banyak framework web lain memakai variasi pattern ini.

### 6.3 Servlet-Level Sketch

```java
public final class FrontControllerServlet extends HttpServlet {

    private RouteRegistry routes;
    private ErrorMapper errorMapper;

    @Override
    public void init() {
        this.routes = RouteRegistry.bootstrap();
        this.errorMapper = new ErrorMapper();
    }

    @Override
    protected void service(HttpServletRequest req, HttpServletResponse resp) throws IOException {
        try {
            Handler handler = routes.resolve(req.getMethod(), req.getRequestURI());
            ResponseModel model = handler.handle(req);
            render(resp, model);
        } catch (Throwable failure) {
            ErrorResponse error = errorMapper.map(failure);
            renderError(resp, error);
        }
    }
}
```

### 6.4 Risiko

Front controller yang buruk menjadi god object.

Ia sebaiknya hanya mengelola:

- routing,
- dispatch,
- error mapping,
- common request/response protocol boundary.

Business logic tetap di service/domain layer.

---

## 7. Pattern 2 — Filter Chain Boundary

### 7.1 Masalah

Banyak cross-cutting concern harus terjadi sebelum request sampai ke endpoint:

- correlation ID,
- access log,
- CORS,
- auth precheck,
- rate limit,
- body limit,
- security header,
- compression,
- request wrapping.

Jika semua dimasukkan ke servlet/controller, hasilnya repetitif dan tidak konsisten.

### 7.2 Solusi

Gunakan Servlet Filter chain sebagai boundary.

```text
Incoming Request
   |
   v
[CorrelationFilter]
   |
   v
[ForwardedHeaderFilter]
   |
   v
[CorsFilter]
   |
   v
[AuthenticationFilter]
   |
   v
[AuthorizationFilter]
   |
   v
[RateLimitFilter]
   |
   v
[Application Servlet]
```

### 7.3 Invariant Filter

Filter yang baik:

- memanggil `chain.doFilter()` maksimal satu kali,
- tidak membaca body tanpa wrapper jika downstream perlu body,
- membersihkan `ThreadLocal` di `finally`,
- tidak menulis response jika downstream masih harus berjalan,
- memahami dispatcher type,
- aman terhadap async/error dispatch,
- tidak menelan exception tanpa policy jelas.

### 7.4 Anti-Pattern

```java
public void doFilter(ServletRequest req, ServletResponse resp, FilterChain chain) {
    try {
        chain.doFilter(req, resp);
    } catch (Exception e) {
        // BAD: swallow error
    }
}
```

Ini membuat request terlihat berhasil padahal gagal.

Lebih baik:

```java
public void doFilter(ServletRequest req, ServletResponse resp, FilterChain chain)
        throws IOException, ServletException {
    try {
        chain.doFilter(req, resp);
    } finally {
        RequestContext.clear();
    }
}
```

---

## 8. Pattern 3 — Request Wrapper / Response Wrapper

### 8.1 Masalah

Kadang filter perlu memodifikasi atau mengobservasi request/response.

Contoh:

- membaca body untuk audit,
- menambahkan header,
- menghitung response size,
- caching body untuk error logging,
- normalisasi forwarded header,
- sanitasi parameter,
- response compression.

### 8.2 Solusi

Gunakan wrapper.

```text
Raw HttpServletRequest
   |
   v
HttpServletRequestWrapper
   |
   v
Application
```

### 8.3 Prinsip Wrapper

Wrapper bukan tempat business logic.

Wrapper adalah adapter boundary.

Gunakan wrapper untuk:

- mengubah cara data dibaca,
- menambahkan metadata,
- menjaga contract downstream,
- membuat stream bisa dibaca ulang dengan batas ukuran aman.

### 8.4 Risiko

- memory bloat bila body besar dicache seluruhnya,
- encoding berubah,
- stream dan reader dipakai bersamaan,
- response wrapper lupa flush,
- wrapper memalsukan data protocol tanpa audit.

---

## 9. Pattern 4 — Error Mapper

### 9.1 Masalah

Tanpa mapping konsisten, error response menjadi random:

- sebagian 500,
- sebagian 400,
- sebagian HTML stacktrace,
- sebagian JSON,
- sebagian redirect,
- sebagian silent failure.

### 9.2 Solusi

Buat error mapper yang memetakan failure internal menjadi protocol outcome.

```text
Throwable / Failure Object
   |
   v
ErrorMapper
   |
   +--> HTTP status
   +--> error code
   +--> user-safe message
   +--> correlation id
   +--> retryable flag
   +--> audit classification
```

### 9.3 Error Taxonomy

```text
Client Input Error       -> 400
Authentication Missing   -> 401
Forbidden                -> 403
Resource Not Found       -> 404
Method Not Allowed       -> 405
Conflict                 -> 409
Payload Too Large        -> 413
Validation Error         -> 422, if chosen by API convention
Rate Limited             -> 429
Dependency Timeout       -> 504 or app-specific 503/500 depending layer
Overload                 -> 503
Internal Defect          -> 500
```

### 9.4 Critical Distinction

Error before response commit:

```text
Can still produce structured error response.
```

Error after response commit:

```text
Cannot reliably change status/header.
Must log/audit as partial response failure.
```

---

## 10. Pattern 5 — Async Boundary

### 10.1 Masalah

Beberapa request butuh menunggu event eksternal:

- long polling,
- report progress,
- slow downstream,
- streaming,
- notification delivery,
- external callback.

Menahan worker thread selama menunggu dapat membatasi kapasitas.

### 10.2 Solusi

Gunakan async servlet boundary.

```text
Request Thread
   |
   v
startAsync()
   |
   v
Release container request thread
   |
   v
External event / executor / future
   |
   v
Write response / dispatch / complete
```

### 10.3 Invariant Async

- `complete()` harus pasti terjadi atau timeout harus menangani cleanup.
- Timeout adalah outcome bisnis/teknis yang harus dimodelkan.
- Context propagation harus eksplisit.
- Response bisa committed sebelum future gagal.
- Async bukan alasan membuat executor tak terbatas.

### 10.4 Async vs Virtual Thread

Async servlet cocok ketika request menunggu event yang benar-benar non-blocking atau event-driven.

Virtual thread cocok ketika kode blocking lebih mudah dipertahankan dan bottleneck bukan CPU/pool downstream.

```text
Async Servlet:
  bagus untuk event-driven wait dan long-held connection tertentu.

Virtual Thread:
  bagus untuk blocking code yang banyak menunggu I/O, asal downstream capacity tetap dibatasi.
```

---

## 11. Pattern 6 — Backpressure Gate

### 11.1 Masalah

Aplikasi menerima lebih banyak request/message daripada yang bisa diproses.

Jika tidak ada backpressure:

- thread pool penuh,
- DB pool penuh,
- queue membesar,
- latency naik,
- timeout cascade,
- retry storm,
- memory habis.

### 11.2 Solusi

Pasang gate di boundary yang benar.

```text
Incoming Work
   |
   v
Admission Control
   |
   +--> Accept
   |
   +--> Reject Fast
   |
   +--> Queue Bounded
   |
   +--> Shed Low Priority
```

### 11.3 Gate Examples

HTTP request:

- max concurrent request per endpoint,
- DB operation semaphore,
- per-user rate limit,
- upload size limit,
- request queue limit.

WebSocket:

- max connection per user,
- max subscriptions per connection,
- bounded outbound queue,
- slow client disconnect,
- message rate limit.

SSE:

- max active streams,
- heartbeat interval,
- bounded replay window.

### 11.4 Principle

Lebih baik menolak cepat dengan error jelas daripada menerima semua lalu timeout massal.

---

## 12. Pattern 7 — Connection Registry

### 12.1 Masalah

WebSocket/SSE membutuhkan server mengetahui connection aktif.

Contoh:

- kirim notifikasi ke user tertentu,
- broadcast ke room,
- track presence,
- close semua koneksi saat user logout,
- drain saat shutdown.

### 12.2 Solusi

Gunakan registry eksplisit.

```text
UserId -> Set<ConnectionId>
ConnectionId -> ConnectionState
Topic -> Set<ConnectionId>
NodeId -> Local Registry
```

### 12.3 Registry State

```java
record ConnectionState(
    String connectionId,
    String userId,
    String nodeId,
    Instant openedAt,
    Instant lastSeenAt,
    Set<String> subscriptions,
    AtomicBoolean closing
) {}
```

### 12.4 Cleanup Must Be Idempotent

```java
void cleanup(String connectionId, String reason) {
    ConnectionState removed = byConnectionId.remove(connectionId);
    if (removed == null) {
        return; // already cleaned
    }
    byUserId.computeIfPresent(removed.userId(), (user, set) -> {
        set.remove(connectionId);
        return set.isEmpty() ? null : set;
    });
    publishPresenceUpdateIfNeeded(removed.userId());
}
```

### 12.5 Cluster Caveat

Local registry only knows local node.

Cluster-wide behavior needs:

- broker,
- distributed cache,
- lease/TTL,
- sticky routing,
- or explicit routing table.

---

## 13. Pattern 8 — Heartbeat and Lease

### 13.1 Masalah

Connection bisa mati tanpa close event yang bersih.

Mobile network, NAT, proxy, browser tab sleep, laptop suspend, dan LB timeout dapat membuat server punya ghost connection.

### 13.2 Solusi

Gunakan heartbeat dan lease.

```text
Every N seconds:
  server sends ping or app heartbeat

Client responds:
  pong or heartbeat ack

If missed M times:
  close connection
  cleanup registry
  expire presence lease
```

### 13.3 Lease Model

Presence sebaiknya berbasis expiry, bukan boolean permanen.

```text
presence:user:123 = online, expires in 45s
```

Jika heartbeat berhenti, status hilang otomatis.

### 13.4 Timeout Alignment

Heartbeat interval harus lebih pendek dari idle timeout proxy/LB.

Contoh:

```text
LB idle timeout:        60s
Proxy read timeout:     75s
Server idle timeout:    90s
Heartbeat interval:     25s
Miss threshold:          2 or 3
```

---

## 14. Pattern 9 — Graceful Drain

### 14.1 Masalah

Rolling deployment dapat memutus request panjang, upload, download, SSE, dan WebSocket.

Jika shutdown langsung:

- user mendapat 502/connection reset,
- WebSocket reconnect storm,
- upload corrupt,
- report generation ambiguous,
- partial write tidak tercatat.

### 14.2 Solusi

Implementasikan drain state.

```text
[RUNNING]
   |
   v
[DRAINING]
   |
   +--> readiness = false
   +--> reject new long-lived connections
   +--> allow short in-flight requests to finish
   +--> notify WebSocket clients to reconnect
   +--> stop consuming non-critical background work
   |
   v
[STOPPING]
   |
   v
[STOPPED]
```

### 14.3 Drain Endpoint Behavior

```text
Normal readiness:
  200 OK

Draining readiness:
  503 Service Unavailable
```

But internal shutdown coordination still continues.

### 14.4 WebSocket Drain

Server can send app-level message:

```json
{
  "type": "server.draining",
  "retryAfterMs": 5000,
  "reason": "rolling_deploy"
}
```

Then close with a suitable close code depending app convention.

### 14.5 Kubernetes Reality

Kubernetes `preStop` and normal container stop share the same termination grace period. If `preStop` hangs, the Pod remains terminating until the grace period expires. Therefore, `preStop` must be short, bounded, and predictable.

---

## 15. Pattern 10 — Protocol Adapter

### 15.1 Masalah

Business capability sering harus tersedia lewat beberapa protocol:

- HTTP request/response,
- SSE,
- WebSocket,
- message broker consumer,
- scheduled job.

Jika business logic ditaruh di Servlet/WebSocket endpoint, logic terduplikasi.

### 15.2 Solusi

Endpoint hanya adapter.

```text
HTTP Servlet / JAX-RS Resource / WebSocket Endpoint / Broker Consumer
       |
       v
Application Use Case
       |
       v
Domain Service
       |
       v
Repository / Gateway / External Dependency
```

### 15.3 Example

```java
public final class NotificationUseCase {
    public NotificationResult markAsRead(UserId userId, NotificationId notificationId) {
        // authorization, invariant, transaction, domain rules
    }
}
```

HTTP adapter:

```java
protected void doPost(HttpServletRequest req, HttpServletResponse resp) {
    useCase.markAsRead(currentUser(req), notificationId(req));
}
```

WebSocket adapter:

```java
@OnMessage
public void onMessage(Session session, ClientMessage message) {
    if (message.type().equals("notification.markRead")) {
        useCase.markAsRead(currentUser(session), message.notificationId());
    }
}
```

### 15.4 Benefit

- protocol-specific concerns stay at edge,
- domain logic is testable,
- consistency across HTTP/WebSocket/broker,
- easier migration,
- easier audit.

---

## 16. Pattern 11 — Idempotency and Ambiguous Failure Handling

### 16.1 Masalah

Dalam web runtime, failure sering ambiguous.

Contoh:

- client timeout, server masih memproses,
- server berhasil commit DB tapi gagal kirim response,
- client retry setelah network drop,
- WebSocket message dikirim ulang setelah reconnect,
- async response timeout tapi backend selesai belakangan.

### 16.2 Solusi

Gunakan idempotency key untuk operasi yang berisiko duplicate.

```text
Client sends:
  Idempotency-Key: abc-123

Server stores:
  key + user + operation + request hash + result/outcome

Retry:
  same key -> same result or conflict if payload differs
```

### 16.3 WebSocket Variant

```json
{
  "messageId": "01HX...",
  "type": "case.submit",
  "payload": { }
}
```

Server records processed message ID per user/session/window.

### 16.4 Invariant

If operation is externally visible, retry behavior must be designed.

Do not rely on “client will not click twice”.

---

## 17. Pattern 12 — Outbox for Reliable Side Effects

### 17.1 Masalah

Servlet request may need to:

- update database,
- send email,
- publish notification,
- push WebSocket event,
- write audit,
- call external system.

If all done inline, partial failure is dangerous.

Example:

```text
DB update succeeded
Email failed
WebSocket notification failed
Response returned 500
User retries
DB update duplicates or conflicts
```

### 17.2 Solusi

Use transactional outbox.

```text
HTTP Request
   |
   v
DB Transaction
   +--> update domain table
   +--> insert outbox event
   |
   v
Commit
   |
   v
Return response

Outbox Worker
   |
   +--> send email
   +--> publish broker event
   +--> push WebSocket notification
```

### 17.3 Benefit

- request latency shorter,
- side effect retryable,
- audit trail clearer,
- duplicate handling centralized,
- WebSocket delivery decoupled from HTTP request.

---

## 18. Pattern 13 — Observability as Contract

### 18.1 Masalah

Observability sering dianggap tambahan.

Padahal dalam sistem web runtime, observability adalah kontrak debugging.

Tanpa observability:

- 504 tidak jelas dari app/proxy/downstream,
- WebSocket disconnect tidak jelas normal/error,
- session lost tidak jelas karena cookie/LB/restart,
- slow request tidak jelas CPU/DB/queue/client lambat,
- error after commit tidak terlihat.

### 18.2 Minimum Signal

Setiap request minimal punya:

```text
request_id
trace_id
method
path template
status
duration_ms
request_size
response_size if known
user/tenant classification if safe
client_ip after trusted proxy resolution
container/thread info where useful
error code
exception class if internal logs
committed_before_error flag if relevant
```

Setiap WebSocket connection minimal punya:

```text
connection_id
user_id/tenant classification if safe
node_id
open_time
close_time
close_code
close_reason_classification
messages_in
messages_out
bytes_in
bytes_out
last_heartbeat
send_queue_peak
slow_client_disconnect flag
```

### 18.3 Observability Rule

If an outcome matters operationally, it must have a metric/log/trace.

---

## 19. Pattern 14 — Timeout Budget

### 19.1 Masalah

Timeout sering dikonfigurasi per layer tanpa budget utuh.

Contoh buruk:

```text
Client timeout:       30s
ALB timeout:          60s
Nginx timeout:        45s
Servlet async:        120s
DB query timeout:     none
HTTP client timeout:  none
```

Outcome:

- client sudah pergi,
- app masih kerja,
- DB masih query,
- response gagal dikirim,
- retry client menambah load.

### 19.2 Solusi

Buat timeout budget dari user journey.

Example for normal API:

```text
Client timeout:              15s
Load balancer timeout:       20s
Reverse proxy timeout:       18s
Servlet/app timeout:         14s
Downstream total budget:     10s
DB query timeout:             8s
External HTTP timeout:        5s
```

### 19.3 Principle

Inner layer should usually fail before outer layer gives up.

Aplikasi harus punya kesempatan mengembalikan response terstruktur sebelum proxy mengembalikan 504.

---

## 20. Pattern 15 — Capacity Envelope

### 20.1 Masalah

Banyak sistem terlihat kuat saat low traffic, tetapi collapse saat traffic naik karena tidak punya envelope.

### 20.2 Capacity Envelope Components

```text
max HTTP connections
max keep-alive connections
max request worker threads
max async in-flight request
max DB connections
max outbound HTTP connections
max upload temp disk
max WebSocket connections
max WebSocket outbound queue memory
max broker consumer concurrency
max CPU saturation
max heap allocation rate
```

### 20.3 Simple Capacity Equation

```text
Concurrency ≈ Arrival Rate × Service Time
```

Jika 100 request/second dan average service time 200ms:

```text
Concurrency ≈ 100 × 0.2 = 20 concurrent requests
```

Jika service time naik ke 2s:

```text
Concurrency ≈ 100 × 2 = 200 concurrent requests
```

Latency bukan hanya pengalaman user; latency mengubah kapasitas.

### 20.4 WebSocket Capacity

WebSocket capacity tidak cukup dihitung dari jumlah koneksi.

Harus dihitung:

```text
connections
subscriptions per connection
messages per second inbound
messages per second outbound
fan-out multiplier
average payload size
send queue size
heartbeat overhead
reconnect rate
```

---

## 21. Pattern 16 — Static Resource and SPA Boundary

### 21.1 Masalah

Servlet app modern sering melayani:

- API,
- static resources,
- SPA fallback,
- WebSocket endpoint,
- health endpoints.

Mapping yang salah menyebabkan:

- API route tertangkap SPA fallback,
- static resource lewat auth filter terlalu berat,
- WebSocket upgrade tertangkap wrong handler,
- 404 berubah jadi HTML index page,
- cache header salah.

### 21.2 Boundary Design

```text
/api/*             -> API servlet/framework
/ws/*              -> WebSocket endpoint
/sse/*             -> SSE servlet
/assets/*          -> static resources with long cache
/health/live       -> liveness
/health/ready      -> readiness
/*                 -> SPA fallback, but not for API paths
```

### 21.3 Rule

SPA fallback must be last and explicit.

Do not let it hide API 404.

---

## 22. Pattern 17 — Security Boundary Layering

### 22.1 Masalah

Security sering diperlakukan sebagai satu filter atau framework config.

Padahal web runtime punya banyak boundary.

### 22.2 Boundary Layers

```text
Network/TLS boundary
Reverse proxy/WAF boundary
Servlet filter boundary
Session/cookie boundary
Endpoint authorization boundary
Message-level authorization boundary
Domain invariant boundary
Outbound data filtering boundary
Audit boundary
```

### 22.3 Example: WebSocket

Handshake authentication:

```text
Can this user open a connection?
```

Subscription authorization:

```text
Can this user subscribe to topic X?
```

Message authorization:

```text
Can this user perform action Y with payload Z now?
```

Outbound authorization:

```text
Can this data still be sent to this user at send time?
```

These are not the same decision.

---

## 23. Pattern 18 — Protocol-Aware Audit

### 23.1 Masalah

Audit sering hanya dicatat di controller/service.

Tetapi Servlet/WebSocket runtime punya events yang penting:

- request rejected by filter,
- upload exceeded limit,
- session invalidated,
- WebSocket subscription denied,
- message rejected by schema validation,
- slow client disconnected,
- async timeout,
- response committed then failed,
- graceful shutdown closed connection.

### 23.2 Audit Model

Audit should capture:

```text
actor
tenant
operation
target resource
protocol
entry point
decision
reason code
correlation id
request/message id
time
node
outcome
```

### 23.3 Audit Classification

```text
SUCCESS
CLIENT_ERROR
AUTHN_FAILURE
AUTHZ_DENIED
VALIDATION_REJECTED
RATE_LIMITED
TIMEOUT
DEPENDENCY_FAILURE
SERVER_ERROR
PARTIAL_RESPONSE_FAILURE
CONNECTION_CLOSED
```

---

## 24. Integration Blueprint: Production-Grade Java Web Runtime

Sekarang kita susun blueprint yang menyatukan semua.

```text
                 +-------------------+
                 | Client / Browser  |
                 +---------+---------+
                           |
                           v
                 +-------------------+
                 | CDN/WAF/Gateway   |
                 +---------+---------+
                           |
                           v
                 +-------------------+
                 | Load Balancer     |
                 +---------+---------+
                           |
                           v
                 +-------------------+
                 | Ingress/Proxy     |
                 | - TLS offload     |
                 | - Upgrade headers |
                 | - Body limits     |
                 | - Timeouts        |
                 +---------+---------+
                           |
                           v
                 +-------------------+
                 | Servlet Container |
                 | - Connector       |
                 | - Thread pool     |
                 | - Context routing |
                 | - Session manager |
                 +---------+---------+
                           |
        +------------------+------------------+
        |                  |                  |
        v                  v                  v
+---------------+  +----------------+  +----------------+
| Filter Chain  |  | WebSocket RT   |  | Static/SSE     |
+-------+-------+  +--------+-------+  +--------+-------+
        |                   |                   |
        v                   v                   v
+---------------+  +----------------+  +----------------+
| HTTP Adapter  |  | WS Adapter     |  | Stream Adapter |
+-------+-------+  +--------+-------+  +--------+-------+
        |                   |                   |
        +-------------------+-------------------+
                            |
                            v
                  +--------------------+
                  | Application Usecase|
                  +---------+----------+
                            |
           +----------------+----------------+
           |                |                |
           v                v                v
     +-----------+    +-----------+    +-------------+
     | Database  |    | Broker    |    | External API|
     +-----------+    +-----------+    +-------------+
```

---

## 25. Capstone Design: Notification and Case Update Runtime

Bayangkan sistem case management/regulatory workflow.

User perlu:

- membuka daftar case via HTTP,
- submit action via HTTP,
- menerima notification via WebSocket/SSE,
- melihat progress report via SSE,
- download attachment,
- upload evidence,
- audit semua action,
- survive rolling deployment,
- work behind reverse proxy/Kubernetes.

### 25.1 Endpoint Layout

```text
GET    /api/cases
GET    /api/cases/{id}
POST   /api/cases/{id}/actions
POST   /api/cases/{id}/evidence
GET    /api/cases/{id}/documents/{docId}
GET    /sse/reports/{jobId}/progress
WS     /ws/notifications
GET    /health/live
GET    /health/ready
GET    /assets/*
GET    /* SPA fallback
```

### 25.2 Filter Chain

```text
CorrelationFilter
ForwardedHeaderFilter
RequestSizeGuardFilter
SecurityHeaderFilter
CorsFilter
AuthenticationFilter
AuthorizationContextFilter
RateLimitFilter
AuditEnvelopeFilter
Application
```

### 25.3 Request Submit Flow

```text
POST /api/cases/{id}/actions
   |
   v
Correlation id assigned
   |
   v
Authn/Authz checked
   |
   v
Idempotency key validated
   |
   v
Use case executes in transaction
   |
   +--> case state updated
   +--> audit row inserted
   +--> outbox event inserted
   |
   v
Commit
   |
   v
HTTP 200/201/202 returned
   |
   v
Outbox worker publishes notification
   |
   v
WebSocket/SSE delivery layer pushes event
```

### 25.4 Why Outbox Matters

Without outbox:

```text
case update success
websocket push fails
response fails
retry duplicates action
```

With outbox:

```text
case update and event intent commit together
notification delivery can retry separately
HTTP response does not own WebSocket reliability
```

### 25.5 WebSocket Notification Flow

```text
Client opens /ws/notifications
   |
   v
Handshake validates cookie/token + Origin
   |
   v
Connection registered: user -> connection
   |
   v
Client subscribes to permitted notification stream
   |
   v
Server sends events from broker/outbox
   |
   v
Client ACKs last received sequence
   |
   v
Reconnect resumes from last known sequence if replay window exists
```

### 25.6 SSE Report Progress Flow

```text
GET /sse/reports/{jobId}/progress
   |
   v
Authz: can user see job?
   |
   v
Async servlet starts
   |
   v
Response Content-Type: text/event-stream
   |
   v
Heartbeat comments every N seconds
   |
   v
Progress events sent
   |
   v
On complete: final event + close
```

### 25.7 Upload Evidence Flow

```text
POST multipart evidence
   |
   v
Proxy body size limit checked
   |
   v
Container multipart limit checked
   |
   v
Servlet Part created with temp storage
   |
   v
Filename sanitized
   |
   v
Content scanned/validated
   |
   v
Object storage write
   |
   v
DB metadata commit
   |
   v
Outbox event: evidence_uploaded
```

### 25.8 Download Flow

```text
GET /documents/{docId}
   |
   v
Authz checked
   |
   v
Metadata loaded
   |
   v
Headers set before body
   |
   v
Stream object storage to response
   |
   v
If client aborts after commit:
        log partial download outcome
```

---

## 26. Failure Matrix for Capstone

| Scenario | Layer | Expected Design Response |
|---|---:|---|
| User sends huge upload | Proxy/container | Reject with 413 before app consumes resources |
| Client disconnects during download | Servlet response | Stop streaming, log partial delivery, do not mark as fully delivered unless business requires separate ack |
| DB commit succeeds but notification push fails | Outbox/delivery | Retry notification asynchronously |
| WebSocket client is slow | WS send queue | Bound queue, drop/disconnect according to policy |
| User reconnects WebSocket repeatedly | WS reliability | Backoff, dedupe connection registry, resume via sequence if supported |
| Rolling deployment starts | Kubernetes/app lifecycle | Readiness false, drain, reject new long-lived connections, notify clients |
| Proxy timeout shorter than app timeout | Config | Fix timeout budget; app should fail first with structured response |
| Response committed then JSON serialization fails | Servlet response | Cannot change status; log partial failure and fix serialization/precompute strategy |
| Session invalidated while AJAX requests in flight | Session/auth | Return consistent 401/session_expired, frontend handles redirect |
| Authorization revoked while WS connected | WS authz | Recheck on message/subscription/send or close connection on revocation event |
| Node dies abruptly | Runtime | Clients reconnect; presence lease expires; unacked messages replay only if designed |

---

## 27. Designing Request Lifecycle as State Machine

For any important endpoint, write state machine explicitly.

Example: case action submission.

```text
[RECEIVED]
   |
   v
[CORRELATED]
   |
   v
[AUTHENTICATED]
   |
   v
[AUTHORIZED]
   |
   v
[IDEMPOTENCY_CHECKED]
   |
   +--> [DUPLICATE_RETURN_EXISTING]
   +--> [CONFLICT_PAYLOAD_MISMATCH]
   |
   v
[VALIDATED]
   |
   v
[DOMAIN_TRANSITION_CHECKED]
   |
   v
[TRANSACTION_STARTED]
   |
   v
[STATE_UPDATED]
   |
   v
[AUDIT_WRITTEN]
   |
   v
[OUTBOX_WRITTEN]
   |
   v
[COMMITTED]
   |
   v
[RESPONSE_SENT]
```

### 27.1 Failure Transitions

```text
[AUTHENTICATED] -> auth expired -> 401
[AUTHORIZED] -> forbidden -> 403
[VALIDATED] -> invalid payload -> 400/422
[DOMAIN_TRANSITION_CHECKED] -> illegal transition -> 409
[TRANSACTION_STARTED] -> DB timeout -> 503/500 depending policy
[COMMITTED] -> response write fails -> committed_but_not_delivered
```

### 27.2 Why This Matters

Once you model it this way, you can derive:

- status code,
- retry behavior,
- audit point,
- idempotency semantics,
- metrics,
- alerting,
- failure test cases.

---

## 28. Designing WebSocket Lifecycle as State Machine

Example: notification WebSocket.

```text
[CONNECT_ATTEMPT]
   |
   v
[HANDSHAKE_VALIDATED]
   |
   v
[SESSION_CREATED]
   |
   v
[REGISTERED]
   |
   v
[READY]
   |
   +--> [SUBSCRIBED]
   +--> [MESSAGE_RECEIVED]
   +--> [MESSAGE_SENT]
   +--> [HEARTBEAT_SENT]
   +--> [HEARTBEAT_ACKED]
   +--> [BACKPRESSURED]
   |
   v
[CLOSING]
   |
   v
[CLEANED]
```

### 28.1 Failure Transitions

```text
[CONNECT_ATTEMPT] -> invalid Origin -> reject handshake
[HANDSHAKE_VALIDATED] -> expired token -> reject handshake
[REGISTERED] -> duplicate stale session -> cleanup previous or allow multi-device according to policy
[SUBSCRIBED] -> forbidden topic -> reject subscription
[MESSAGE_SENT] -> send timeout -> close slow client
[HEARTBEAT_SENT] -> missed threshold -> close and cleanup
[CLOSING] -> cleanup already done -> no-op
```

---

## 29. Production Readiness Checklist

### 29.1 Servlet / HTTP

- [ ] Context path is explicit.
- [ ] API path and SPA fallback do not conflict.
- [ ] Static resources have correct cache headers.
- [ ] Request body size limit exists at proxy and container.
- [ ] Multipart temp directory is monitored.
- [ ] Error response format is consistent.
- [ ] `sendError`, `setStatus`, and committed response behavior are understood.
- [ ] Access log includes request duration and status.
- [ ] Correlation ID propagates to downstream calls.
- [ ] Client abort is classified separately from server error.
- [ ] Readiness differs from liveness.
- [ ] Graceful shutdown is tested.

### 29.2 Filters / Dispatch

- [ ] Filter order is documented.
- [ ] Dispatcher types are explicit where needed.
- [ ] Async-supported flags are correct.
- [ ] Body-reading filters use safe wrappers.
- [ ] `ThreadLocal` cleanup is in `finally`.
- [ ] Error dispatch does not double-log incorrectly.
- [ ] CORS preflight bypasses unnecessary heavy logic.

### 29.3 Sessions / Cookies

- [ ] Session timeout is aligned with product/security requirements.
- [ ] Session fixation mitigation exists after login.
- [ ] Cookie `Secure`, `HttpOnly`, `SameSite`, domain, and path are correct.
- [ ] Logout deletes cookie with matching path/domain.
- [ ] Sticky session or distributed session strategy is explicit.
- [ ] Session attributes are bounded and serializable if needed.
- [ ] Parallel request behavior is understood.

### 29.4 Async / Streaming / Large Payload

- [ ] Async requests always complete or timeout.
- [ ] Async timeout has structured outcome.
- [ ] Executor queues are bounded.
- [ ] Streaming handles client abort.
- [ ] Download sets headers before body.
- [ ] Upload storage lifecycle is clear.
- [ ] Range request support is deliberate.

### 29.5 WebSocket / SSE

- [ ] Handshake auth is explicit.
- [ ] Origin validation exists.
- [ ] Per-message authorization exists.
- [ ] Payload size limit exists.
- [ ] Connection quota exists.
- [ ] Outbound queue is bounded.
- [ ] Slow client policy exists.
- [ ] Heartbeat interval is aligned with proxy/LB timeout.
- [ ] Reconnect policy includes jitter.
- [ ] Duplicate/replay/ack semantics are explicit if delivery matters.
- [ ] Registry cleanup is idempotent.
- [ ] Cluster fan-out strategy is explicit.

### 29.6 Container / Proxy / Kubernetes

- [ ] Connector thread pool is sized intentionally.
- [ ] `maxConnections`, queue/backlog, and worker pool are understood.
- [ ] Header size limit is aligned across layers.
- [ ] Body size limit is aligned across layers.
- [ ] Proxy timeout is longer than app timeout where structured app error is desired.
- [ ] WebSocket upgrade headers are configured.
- [ ] SSE buffering is disabled where needed.
- [ ] Readiness flips false during drain.
- [ ] `terminationGracePeriodSeconds` is sufficient but bounded.
- [ ] Long-lived connections have shutdown strategy.

### 29.7 Observability

- [ ] Request count, latency, status, in-flight request metrics exist.
- [ ] Thread pool and connector metrics exist.
- [ ] DB pool and downstream latency metrics exist.
- [ ] WebSocket active connection metrics exist.
- [ ] WebSocket close code metrics exist.
- [ ] Async timeout metrics exist.
- [ ] Upload temp disk metrics exist.
- [ ] Error logs include correlation ID.
- [ ] Dashboards separate app 5xx, proxy 5xx, client abort, timeout, overload.

---

## 30. Anti-Patterns yang Harus Dihindari

### 30.1 Treating Servlet as Just Controller

Servlet is lifecycle object managed by container.

Do not put mutable request state in fields.

### 30.2 Unbounded Everything

Unbounded thread pool, queue, upload, WebSocket session, cache, and replay window will eventually fail.

### 30.3 Timeout by Accident

Timeout must be budgeted, not discovered during incident.

### 30.4 Hidden SPA Fallback

Returning `index.html` for API 404 hides real routing error.

### 30.5 WebSocket Without Backpressure

Persistent connection without bounded outbound queue is a slow memory leak.

### 30.6 Session as Database

Session should not become unbounded per-user storage.

### 30.7 Async Without Completion Discipline

Async started without guaranteed complete/timeout cleanup creates dangling request.

### 30.8 Business Logic in Filter

Filters are boundary logic, not domain logic.

### 30.9 Trusting Headers Without Trusted Proxy Model

`X-Forwarded-For` can be spoofed unless only trusted proxy can set/forward it.

### 30.10 No Drain Mode

Rolling update without drain is controlled chaos, especially for long requests and WebSocket.

---

## 31. Java 8 to Java 25: Practical Interpretation

This series spans Java 8 to Java 25.

The Servlet/WebSocket mental model is stable, but runtime options evolve.

### 31.1 Java 8 Era

Typical:

- external Tomcat/Jetty/WildFly,
- platform thread-per-request,
- Java EE `javax.*`,
- WAR deployment common,
- async servlet available but not always heavily used,
- WebSocket available but cluster patterns often ad hoc.

### 31.2 Java 11 Era

Typical:

- stronger move to containerized deployment,
- HTTP client improvements,
- Spring Boot executable JAR mainstream,
- Java EE to Jakarta transition starts becoming planning concern.

### 31.3 Java 17 Era

Typical:

- LTS baseline for modern enterprise,
- Spring Boot 3 requires Jakarta namespace,
- stronger container/cloud-native assumptions,
- observability and Kubernetes readiness become normal expectations.

### 31.4 Java 21 Era

Typical:

- virtual threads available,
- blocking servlet code can scale differently if container/framework supports it,
- still need downstream limits,
- `ThreadLocal` assumptions require more care,
- structured concurrency and scoped values become relevant design ideas even if not always directly used in Servlet code.

### 31.5 Java 25 Era

Typical direction:

- modern LTS/runtime tuning,
- continued improvement around concurrency primitives,
- server-side Java increasingly combines classic Servlet/Jakarta APIs with cloud-native deployment and observability discipline.

Important:

Virtual threads do not remove the need for:

- timeout budgets,
- rate limits,
- DB pool sizing,
- connection limits,
- backpressure,
- cancellation,
- observability.

They change one dimension of the capacity model; they do not eliminate capacity modelling.

---

## 32. Final Mental Model: Boundary, State, Capacity, Failure

Jika harus merangkum seluruh seri dalam empat kata:

```text
Boundary
State
Capacity
Failure
```

### 32.1 Boundary

Selalu tanyakan:

- boundary protocol mana yang sedang dilewati?
- siapa yang boleh membaca/mengubah data?
- siapa yang punya lifecycle object ini?
- siapa yang bertanggung jawab terhadap cleanup?

### 32.2 State

Selalu tanyakan:

- state ini request-scoped, session-scoped, connection-scoped, application-scoped, atau cluster-scoped?
- siapa owner state?
- kapan state dibuat?
- kapan state valid?
- kapan state harus expire?
- apa yang terjadi saat node mati?

### 32.3 Capacity

Selalu tanyakan:

- berapa concurrency maksimum?
- bottleneck pertama ada di mana?
- queue mana yang bounded?
- timeout mana yang paling dulu menang?
- apa yang terjadi saat dependency lambat?
- apakah sistem reject fast atau mati pelan-pelan?

### 32.4 Failure

Selalu tanyakan:

- failure ini terjadi sebelum atau sesudah commit?
- client tahu outcome atau tidak?
- operasi boleh diretry atau tidak?
- apakah side effect sudah terjadi?
- apakah audit merekam outcome yang benar?
- apakah observability cukup untuk membuktikan apa yang terjadi?

---

## 33. Practical Design Review Template

Gunakan template ini saat mereview Servlet/WebSocket feature.

### 33.1 Entry Point

```text
Endpoint:
Protocol:
Method/message type:
Path/topic:
Authentication:
Authorization:
Expected latency:
Payload size:
Response type:
Long-lived connection? yes/no
```

### 33.2 Lifecycle

```text
Request/connection states:
Timeouts:
Cleanup point:
Commit point:
Retry behavior:
Shutdown behavior:
```

### 33.3 Capacity

```text
Expected RPS/messages per second:
Expected concurrent users/connections:
Max body size:
Max in-flight operations:
Downstream pool dependency:
Queue limit:
Rate limit:
```

### 33.4 Failure

```text
Client error mapping:
Auth failure mapping:
Validation failure mapping:
Dependency timeout mapping:
Client abort handling:
Partial response handling:
Duplicate handling:
```

### 33.5 Observability

```text
Metrics:
Logs:
Trace spans:
Audit events:
Dashboards:
Alerts:
Runbook:
```

---

## 34. Final Capstone Exercise

Design a feature:

> Real-time regulatory case notification with HTTP action submission, WebSocket delivery, SSE report progress, file evidence upload, and audit trail.

You should be able to specify:

1. Endpoint layout.
2. Servlet/filter mapping.
3. Cookie/session/auth boundary.
4. WebSocket handshake/auth/origin validation.
5. Per-message authorization.
6. Outbound queue policy.
7. Heartbeat/reconnect strategy.
8. Idempotency key for case actions.
9. Outbox for notifications.
10. Upload size/storage/scanning policy.
11. Download partial failure behavior.
12. Timeout budget across client/proxy/app/DB.
13. Kubernetes readiness/drain/shutdown behavior.
14. Observability dashboard.
15. Failure test matrix.

If you can produce this design coherently, you no longer “just know Servlet/WebSocket”.

You understand Java web runtime as an operating system for request and connection lifecycles.

---

## 35. Final Summary

Servlet and WebSocket engineering at high level is not about memorizing annotations.

It is about controlling lifecycle.

A strong engineer knows:

- `HttpServletRequest` is not just an object; it is a parsed protocol boundary.
- `HttpServletResponse` is not just an output holder; it is a commit state machine.
- Filter is not just middleware; it is a chain-of-responsibility boundary.
- Session is not just a map; it is continuity state with security and distribution consequences.
- Async is not just non-blocking; it is explicit lifecycle transfer.
- WebSocket is not just real-time; it is long-lived state with reliability, backpressure, and security obligations.
- Container config is not ops detail; it defines capacity and failure behavior.
- Reverse proxy is not transparent; it changes scheme, path, timeout, buffering, and upgrade semantics.
- Kubernetes deployment is not just packaging; it changes startup, readiness, termination, and drain semantics.
- Observability is not decoration; it is the evidence system for runtime truth.

The final mental model:

```text
A Java web application is a set of protocol adapters running inside a managed lifecycle container, constrained by finite capacity, exposed through multiple infrastructure boundaries, and judged by how predictably it behaves under failure.
```

---

## 36. Referensi Resmi dan Lanjutan

- Jakarta Servlet 6.1 Specification  
  https://jakarta.ee/specifications/servlet/6.1/

- Jakarta Servlet 6.1 API Documentation  
  https://jakarta.ee/specifications/servlet/6.1/apidocs/

- Jakarta WebSocket 2.2 Specification  
  https://jakarta.ee/specifications/websocket/2.2/

- Jakarta WebSocket 2.2 Specification Document  
  https://jakarta.ee/specifications/websocket/2.2/jakarta-websocket-spec-2.2

- RFC 6455 — The WebSocket Protocol  
  https://datatracker.ietf.org/doc/html/rfc6455

- Kubernetes Container Lifecycle Hooks  
  https://kubernetes.io/docs/concepts/containers/container-lifecycle-hooks/

- Kubernetes Pod Lifecycle  
  https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/

- Apache Tomcat 11 Documentation  
  https://tomcat.apache.org/tomcat-11.0-doc/

- Jetty 12 Documentation  
  https://jetty.org/docs/jetty/12/

- Undertow Documentation  
  https://undertow.io/undertow-docs/

---

## 37. Status Seri

Part ini adalah **Part 031** dan merupakan **bagian terakhir** dari seri:

```text
learn-java-servlet-websocket-web-container-runtime
```

Dengan ini, seri **sudah selesai**.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-servlet-websocket-web-container-runtime-part-030](./learn-java-servlet-websocket-web-container-runtime-part-030.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-validation-jakarta-hibernate-validator-part-000](../validation/learn-java-validation-jakarta-hibernate-validator-part-000.md)
