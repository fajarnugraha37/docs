# learn-java-servlet-websocket-web-container-runtime-part-030

# Part 030 — Observability and Diagnostics for Servlet/WebSocket Runtime

> Seri: `learn-java-servlet-websocket-web-container-runtime`  
> Part: `030` dari `031`  
> Topik: Observability, diagnostics, incident triage, and runtime failure analysis for Servlet/WebSocket applications  
> Target: Java 8–25, Java EE `javax.*`, Jakarta EE `jakarta.*`, Servlet containers, embedded servers, reverse proxy/cloud runtime

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membangun mental model dari bawah ke atas:

1. HTTP semantics.
2. Servlet container architecture.
3. Request/response lifecycle.
4. Mapping, dispatch, filter, listener, context, session.
5. Async servlet dan non-blocking I/O.
6. Threading, classloading, packaging.
7. WebSocket protocol, endpoint, state, reliability, security.
8. SSE/long polling.
9. JSP/Jakarta Pages.
10. Container configuration.
11. Reverse proxy, load balancer, Kubernetes, cloud runtime.

Part ini menjawab pertanyaan yang lebih operasional:

> Ketika aplikasi Servlet/WebSocket berjalan di production dan terjadi 404, 405, 413, 431, 499-like client abort, 502, 503, 504, broken pipe, connection reset, request lambat, WebSocket sering putus, thread penuh, CPU tinggi, memory naik, atau deployment menyebabkan koneksi hilang, bagaimana kita mendiagnosisnya secara sistematis?

Top-tier engineer tidak hanya bisa menulis Servlet, Filter, `@ServerEndpoint`, atau config Tomcat. Ia harus bisa membaca sistem hidup:

- request masuk dari mana,
- layer mana yang menolak,
- status code siapa yang menghasilkan,
- timeout siapa yang menang,
- thread mana yang habis,
- queue mana yang menumpuk,
- WebSocket close code apa yang dominan,
- apakah client abort atau server abort,
- apakah error berasal dari app, container, proxy, LB, ingress, DB, broker, atau browser.

Observability bukan hiasan dashboard. Observability adalah kemampuan menjawab pertanyaan produksi dengan bukti.

---

## 1. Mental Model Observability untuk Java Web Runtime

Observability untuk Servlet/WebSocket harus mengikuti lifecycle request dan connection.

Untuk HTTP request biasa:

```text
client/browser
  -> DNS/CDN/WAF
  -> load balancer
  -> reverse proxy / ingress
  -> servlet container connector
  -> filter chain
  -> servlet/framework/controller
  -> service layer
  -> downstream dependency
  -> response write
  -> proxy/LB/client
```

Untuk WebSocket:

```text
HTTP upgrade request
  -> proxy/LB upgrade handling
  -> container handshake
  -> endpoint open
  -> persistent connection lifecycle
  -> inbound messages
  -> outbound messages
  -> heartbeat
  -> close/error/reconnect
```

Karena ada banyak layer, observability harus punya minimal empat jenis data:

| Signal | Pertanyaan yang dijawab |
|---|---|
| Logs | Apa yang terjadi pada request/connection tertentu? |
| Metrics | Apakah sistem sehat secara agregat? |
| Traces | Request melewati komponen apa saja dan lambat di mana? |
| Dumps/profiles | Thread, heap, CPU, lock, atau classloader sedang melakukan apa? |

Untuk Servlet/WebSocket, observability harus mencakup:

- access log,
- application log,
- error log,
- audit/security log,
- container metrics,
- JVM metrics,
- HTTP client metrics,
- DB/broker/cache metrics,
- WebSocket connection/message metrics,
- proxy/LB/ingress metrics,
- Kubernetes pod/container metrics,
- thread dump,
- heap dump,
- Java Flight Recorder,
- distributed tracing.

Kesalahan umum: hanya melihat application log. Padahal banyak failure tidak pernah sampai ke application code.

Contoh:

| Gejala | Bisa terjadi sebelum app code? |
|---|---:|
| Request body terlalu besar | Ya, di proxy/container |
| Header terlalu besar | Ya, di proxy/container |
| TLS handshake gagal | Ya, sebelum servlet |
| WebSocket upgrade tidak jalan | Ya, di proxy/LB |
| 504 gateway timeout | Ya, di proxy/LB |
| Client abort | Bisa muncul saat container menulis response |
| 404 | Bisa dari LB/proxy/container/framework/app |

---

## 2. Observability Harus Berdasarkan Boundary, Bukan Berdasarkan Tool

Tool seperti Prometheus, Grafana, CloudWatch, Datadog, New Relic, OpenTelemetry, ELK, Splunk, Loki, JMX, Micrometer, atau JFR hanyalah alat.

Yang lebih penting adalah boundary.

Boundary utama untuk web runtime:

```text
1. Client boundary
2. Edge/proxy boundary
3. Container connector boundary
4. Servlet filter boundary
5. Application handler boundary
6. Downstream dependency boundary
7. Response write boundary
8. Connection close boundary
```

Setiap boundary harus menjawab:

- request diterima atau ditolak?
- berapa lama menunggu di queue?
- thread mana yang menangani?
- status code apa yang dihasilkan?
- response sudah committed atau belum?
- client masih connected atau sudah abort?
- downstream dipanggil berapa lama?
- timeout mana yang aktif?
- error diklasifikasikan sebagai apa?

Jika observability hanya dipasang di controller, maka kita buta terhadap:

- request yang ditolak sebelum servlet,
- filter yang tidak memanggil chain,
- response yang gagal ditulis,
- WebSocket handshake failure,
- proxy timeout,
- connection pool starvation,
- thread pool saturation,
- graceful shutdown race.

---

## 3. Correlation ID: Tulang Punggung Diagnostik

Tanpa correlation ID, debugging distributed web runtime akan berubah menjadi tebak-tebakan.

Correlation ID harus bisa mengikuti request dari:

```text
client -> proxy -> ingress -> container -> filter -> app -> DB/HTTP/broker -> response
```

Nama umum:

- `X-Request-ID`,
- `X-Correlation-ID`,
- `Traceparent`,
- `X-B3-TraceId`,
- custom `Request-Id`.

Rekomendasi modern:

- gunakan W3C Trace Context `traceparent` untuk distributed tracing,
- tetap boleh punya `X-Request-ID` untuk human-readable log search,
- jangan percaya header dari public client tanpa validasi,
- generate ID baru jika missing/invalid,
- propagate ke downstream,
- masukkan ke MDC/log context,
- bersihkan MDC di akhir request.

Contoh filter konseptual:

```java
public final class CorrelationIdFilter implements Filter {
    private static final String HEADER = "X-Request-ID";

    @Override
    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
            throws IOException, ServletException {

        HttpServletRequest request = (HttpServletRequest) req;
        HttpServletResponse response = (HttpServletResponse) res;

        String requestId = request.getHeader(HEADER);
        if (requestId == null || !requestId.matches("[A-Za-z0-9._-]{8,128}")) {
            requestId = UUID.randomUUID().toString();
        }

        MDC.put("requestId", requestId);
        response.setHeader(HEADER, requestId);

        try {
            chain.doFilter(request, response);
        } finally {
            MDC.remove("requestId");
        }
    }
}
```

Tetapi async servlet membuat ini lebih sulit.

Jika request memakai `startAsync()`, filter `finally` bisa berjalan sebelum async work selesai. Untuk async request, correlation context harus dipropagate ke task executor dan cleanup dilakukan di async listener atau wrapper executor.

Mental model:

```text
sync request:
  filter enter -> app -> response -> filter finally

async request:
  filter enter -> app starts async -> filter returns
  async thread later -> writes response -> complete/error/timeout
```

Jadi correlation ID harus hidup di seluruh lifecycle, bukan hanya call stack awal.

---

## 4. Access Log vs Application Log

Access log dan application log menjawab pertanyaan berbeda.

| Log | Sumber | Fokus |
|---|---|---|
| Access log | proxy/container | request boundary dan status akhir |
| Application log | kode aplikasi | business/application events |
| Error log | container/app | exception dan runtime failure |
| Audit log | aplikasi/domain | siapa melakukan apa, kapan, terhadap entity apa |
| Security log | authz/authn boundary | login, reject, token/session issue, suspicious behavior |

Access log minimal harus punya:

- timestamp,
- remote IP / forwarded IP,
- method,
- URI path,
- query redacted,
- protocol,
- status code,
- response size,
- duration,
- user agent,
- request ID,
- upstream time jika dari proxy,
- backend/pod/node identifier,
- connection status jika tersedia.

Contoh access log konseptual:

```text
2026-06-17T10:00:01Z req=abc123 ip=203.0.113.10 method=POST path=/api/cases status=504 bytes=182 dur_ms=60001 ua="Mozilla/5.0" pod=case-api-7cd9
```

Application log minimal harus punya:

- request ID,
- user ID atau subject ID jika aman,
- tenant/agency jika relevan,
- module/use case,
- entity ID,
- event type,
- duration untuk operation penting,
- error classification,
- sanitized failure reason.

Jangan masukkan:

- password,
- access token,
- refresh token,
- session ID mentah,
- full cookie,
- NRIC/PII tanpa masking,
- file content,
- full authorization header,
- full query jika mengandung sensitive data.

Top-tier diagnostic practice:

```text
Access log tells you what happened at HTTP boundary.
Application log tells you what the application was trying to do.
Trace tells you where time was spent.
Metrics tell you whether this is isolated or systemic.
Thread dump tells you what execution resources are doing now.
```

---

## 5. Status Code Distribution as Runtime Health Signal

HTTP status code bukan hanya response semantics. Ia adalah health signal.

Kelompok besar:

| Range | Makna diagnostik |
|---|---|
| 2xx | Success path |
| 3xx | Redirect/cache/control path |
| 4xx | Client/request/authorization/validation/path issue |
| 5xx | Server/proxy/dependency/overload issue |

Tetapi jangan terlalu sederhana.

Contoh:

| Status | Diagnosis awal |
|---|---|
| 400 | malformed request, invalid syntax, bad JSON, bad multipart |
| 401 | unauthenticated, expired token/session, missing credentials |
| 403 | authenticated but forbidden, CSRF, origin policy, role mismatch |
| 404 | wrong path, mapping issue, context path, route fallback, resource not found |
| 405 | servlet/framework route exists but method unsupported |
| 408 | request timeout, client slow sending body |
| 409 | domain conflict, optimistic lock, duplicate operation |
| 413 | body too large at proxy/container/app |
| 414 | URI too long, usually bad query design |
| 415 | unsupported media type |
| 422 | semantic validation failure, framework-specific/common API convention |
| 429 | rate limit/admission control |
| 431 | request header too large, often cookie bloat |
| 500 | uncaught app/container failure |
| 502 | bad gateway, upstream connection/reset/protocol issue |
| 503 | unavailable, overloaded, draining, no healthy backend |
| 504 | gateway timeout, upstream too slow |

Important distinction:

```text
A 500 in app access log is not the same as a 502/504 in proxy access log.
```

If proxy logs `504` but app logs `200` after 70 seconds, the app completed too late. The client already saw failure.

If app logs nothing but proxy logs `413`, the request was rejected before reaching app.

If container access log has `400` but app log has nothing, request was rejected by connector parsing, header limit, invalid request line, or protocol issue.

---

## 6. Servlet-Specific Metrics

Servlet/Web container metrics should include:

### 6.1 Request Metrics

- total requests,
- requests per second,
- status code count,
- method count,
- endpoint/path pattern count,
- request duration histogram,
- request body size,
- response body size,
- in-flight requests,
- rejected requests,
- async started/completed/timed out,
- client abort count.

Use histograms, not only averages.

Bad metric:

```text
average latency = 120 ms
```

Better:

```text
p50  = 80 ms
p90  = 250 ms
p95  = 600 ms
p99  = 5.2 s
max  = 62 s
```

Averages hide tail latency.

### 6.2 Connector Metrics

Container connector metrics:

- active connections,
- keep-alive connections,
- max connections,
- busy worker threads,
- max threads,
- accept queue/backlog,
- bytes received/sent,
- request count,
- error count,
- processing time,
- connection timeout events.

Tomcat exposes many runtime internals through JMX, and its official monitoring docs describe monitoring/managing Tomcat through JMX and related mechanisms. Jetty’s threading architecture documents that connector acceptors and selectors lease threads from the `QueuedThreadPool`, which means thread metrics must be understood together with connector behavior.

### 6.3 Thread Pool Metrics

Track:

- current threads,
- busy threads,
- idle threads,
- max threads,
- queue size,
- rejected task count,
- task wait time,
- task execution time.

For Servlet runtime, thread pool saturation means:

```text
requests arrive faster than the runtime can process them
OR requests block too long
OR downstream dependencies are slow
OR there is a lock/CPU bottleneck
OR keep-alive/long-running streams consume resources
```

### 6.4 Async Metrics

Async servlet adds new lifecycle states:

- async started,
- async completed,
- async timeout,
- async error,
- async dispatch count,
- async duration,
- async executor queue size,
- async task rejection.

If async timeout increases, inspect:

- downstream latency,
- executor saturation,
- forgotten `complete()`,
- proxy timeout mismatch,
- client abort,
- slow write.

### 6.5 Session Metrics

Track:

- active HTTP sessions,
- session creation rate,
- session invalidation rate,
- session timeout count,
- average session lifetime,
- session attribute size approximation,
- session replication failures,
- sticky session distribution,
- login/logout counts.

Rising active session count can mean:

- traffic increase,
- timeout too long,
- bots,
- logout not invalidating session,
- session leak in custom session store,
- sticky routing imbalance.

---

## 7. WebSocket-Specific Metrics

WebSocket observability is different from HTTP observability because a connection can live for minutes/hours.

Track:

### 7.1 Connection Metrics

- active WebSocket connections,
- connection open rate,
- connection close rate,
- handshake success/failure,
- handshake duration,
- connections per user,
- connections per IP,
- connections per node/pod,
- idle connections,
- authenticated vs unauthenticated handshake attempts.

### 7.2 Close Metrics

Track close code distribution.

Common close codes:

| Code | Meaning |
|---:|---|
| 1000 | Normal closure |
| 1001 | Going away, server/browser navigating away/shutdown |
| 1002 | Protocol error |
| 1003 | Unsupported data |
| 1006 | Abnormal closure, not sent on wire but observed locally |
| 1008 | Policy violation |
| 1009 | Message too big |
| 1011 | Unexpected server condition |
| 1012 | Service restart |
| 1013 | Try again later / overload-like condition |

High `1006` usually means abrupt network/proxy/client termination.

High `1008` may mean authorization/origin/policy rejects.

High `1009` means payload limit mismatch or abusive clients.

High `1011` means server-side endpoint failure.

### 7.3 Message Metrics

Track:

- inbound messages per second,
- outbound messages per second,
- message size distribution,
- decode failures,
- validation failures,
- authorization rejects,
- handler duration,
- send queue depth,
- dropped messages,
- ACK timeout,
- retry count,
- replay count,
- duplicate message count,
- out-of-order message count.

### 7.4 Backpressure Metrics

Track:

- per-session outbound queue size,
- queue full count,
- slow client disconnect count,
- async send callback duration,
- broker-to-websocket fanout lag,
- dropped broadcast events.

Without these, you cannot distinguish:

```text
server is slow producing messages
vs
client is slow consuming messages
vs
broker is slow
vs
network/proxy is closing idle connection
```

---

## 8. Logging Servlet Request Lifecycle Correctly

A robust request log should capture lifecycle events, not only controller entry.

Example event sequence:

```text
request.received
request.mapped
filter.enter
handler.start
downstream.call.start
downstream.call.end
response.commit
request.completed
```

But logging every stage for every request can be expensive. Use a balanced model:

- access log for every request,
- app log for important domain events,
- debug logs temporarily for incident reproduction,
- trace sampling for distributed details,
- error logs for exceptional path,
- metrics for aggregate behavior.

A practical high-value pattern:

1. Always log one structured completion event per request.
2. Always log error event with classification.
3. Log downstream calls through tracing/metrics.
4. Avoid verbose logs inside hot loops.
5. Use sampling for noisy success events.

Example structured completion log:

```json
{
  "event": "http.request.completed",
  "requestId": "abc123",
  "method": "POST",
  "pathTemplate": "/api/cases/{caseId}/submit",
  "status": 200,
  "durationMs": 184,
  "userId": "u-12345",
  "module": "case-management",
  "bytesIn": 2048,
  "bytesOut": 512,
  "clientIp": "203.0.113.10"
}
```

Prefer path template over raw path for cardinality:

```text
Good: /api/cases/{id}
Bad : /api/cases/CASE-2026-000001
```

High-cardinality labels destroy metric systems.

---

## 9. The Cardinality Trap

Observability can harm production if labels are uncontrolled.

Bad metric labels:

```text
http_requests_total{path="/api/cases/CASE-2026-000001"}
http_requests_total{userId="fajar"}
http_requests_total{sessionId="ABC..."}
http_requests_total{errorMessage="ORA-... varying text ..."}
```

Better labels:

```text
http_requests_total{route="/api/cases/{caseId}", method="POST", status="200"}
```

High cardinality fields belong in logs/traces, not metric labels:

- request ID,
- user ID,
- session ID,
- entity ID,
- raw URI,
- exception message,
- file name,
- token ID,
- remote IP in large public systems.

Rule:

```text
Metrics describe populations.
Logs describe events.
Traces describe paths.
Audit describes accountable actions.
```

---

## 10. Distributed Tracing for Servlet Runtime

Tracing helps answer:

```text
Where did the request spend time?
```

Typical trace spans:

```text
HTTP SERVER /api/cases/{id}/submit
  -> DB SELECT case
  -> DB UPDATE case
  -> HTTP POST document-service
  -> RabbitMQ publish event
  -> render response
```

For Servlet apps, server span should start at container/filter boundary, not only controller boundary.

Important attributes:

- HTTP method,
- route/path template,
- status code,
- exception type,
- server address,
- user agent,
- client IP if safe,
- deployment environment,
- pod/container/node,
- servlet context path,
- framework route if applicable.

Trace propagation:

- inbound `traceparent`,
- generate if missing,
- propagate to outbound HTTP,
- propagate through messaging if supported,
- log trace ID and span ID.

Beware async boundaries:

- `CompletableFuture`,
- executor service,
- async servlet,
- WebSocket message handler,
- scheduled task,
- message listener.

Context propagation must be explicit or instrumentation-supported.

---

## 11. Diagnosing 404 in Servlet Systems

404 is deceptively simple.

Possible source:

| Source | Example |
|---|---|
| CDN/WAF | route not configured |
| LB/Ingress | host/path rule mismatch |
| reverse proxy | wrong location block |
| container | context path not deployed |
| servlet mapping | no servlet matched |
| framework router | servlet matched but no route |
| app logic | entity/resource not found |
| static resource | file missing |
| SPA fallback | frontend route not mapped |

Diagnostic steps:

1. Check proxy access log: did request reach backend?
2. Check container access log: did container see it?
3. Check application log: did framework/controller see it?
4. Compare host/path/context path.
5. Compare deployed context path vs proxy rewrite.
6. Compare servlet mapping vs framework route.
7. Check trailing slash and case sensitivity.
8. Check static resource path.
9. Check whether 404 body/header identifies proxy/container/framework.

Common path bug:

```text
External URL: /aceas/api/cases
Proxy forwards: /api/cases
Servlet context path: /aceas
Framework expects: /api/cases
```

or:

```text
Proxy forwards /aceas/api/cases to app already mounted at /aceas,
app sees /aceas/aceas/api/cases.
```

A good 404 investigation always starts by identifying which layer generated the 404.

---

## 12. Diagnosing 405

405 means method not allowed for a matched resource.

Possible causes:

- Servlet only implements `doGet`, request sent `POST`.
- Framework route exists for GET but not POST.
- CORS preflight `OPTIONS` not handled.
- Proxy rewrites method incorrectly in rare cases.
- HTML form only supports GET/POST but app expects PUT/PATCH.
- Client sends wrong method due to frontend bug.

Diagnostic checklist:

```text
1. Confirm method in access log.
2. Confirm matched route/servlet.
3. Check Allow response header if present.
4. Check CORS preflight.
5. Check method override filters.
6. Check load balancer/proxy rules.
```

For plain `HttpServlet`, the default `HttpServlet` behavior can return method-not-allowed for unsupported methods. So a 405 might not be business logic at all; it can be Servlet method dispatch behavior.

---

## 13. Diagnosing 413 Payload Too Large

413 can be generated by multiple layers:

```text
client -> CDN/WAF -> LB -> ingress/proxy -> container connector -> multipart parser -> app validation
```

Each may have its own body size limit.

Diagnostic steps:

1. Check which layer logged the 413.
2. Compare configured body limits:
   - CDN/WAF,
   - LB/API gateway,
   - ingress/proxy,
   - servlet container,
   - multipart config,
   - framework config,
   - business rule.
3. Confirm request content type.
4. Confirm whether transfer is chunked or content-length.
5. Check if proxy buffers request body to disk.
6. Check temp disk usage.
7. Check whether app log exists; if not, rejected before app.

Good observability for upload:

- upload start count,
- rejected by size count,
- temp file usage,
- multipart parse error,
- disk full,
- scanning latency,
- storage write latency,
- client abort during upload.

---

## 14. Diagnosing 431 Request Header Fields Too Large

431 is often cookie bloat.

Common causes:

- session cookie too large,
- JWT stored in cookie and grows with claims,
- multiple stale cookies with different path/domain,
- frontend stores state in cookies,
- SSO adds many cookies,
- duplicated cookies after domain migration,
- proxy/container header limit too small.

Diagnostic steps:

1. Capture request header size at proxy if available.
2. Log sanitized cookie names and approximate sizes, not values.
3. Compare browser cookie jar for domain/path duplicates.
4. Check proxy `large_client_header_buffers` or equivalent.
5. Check container max header size.
6. Delete stale cookies and retest.
7. Reduce token/cookie payload.

Never log full cookie values in production.

Useful sanitized diagnostic log:

```json
{
  "event": "http.large_header.detected",
  "requestId": "abc123",
  "headerBytesApprox": 18432,
  "cookieCount": 17,
  "cookieNames": ["JSESSIONID", "SSO_SESSION", "APP_PREF"],
  "path": "/app/login"
}
```

---

## 15. Diagnosing 499-like Client Abort, Broken Pipe, Connection Reset

HTTP 499 is not standard HTTP; Nginx uses it to indicate client closed request before server responded. In Java/container logs, related symptoms often appear as:

- `ClientAbortException`,
- `Broken pipe`,
- `Connection reset by peer`,
- `EOFException`,
- async write failure,
- failed WebSocket send.

Possible causes:

| Cause | Pattern |
|---|---|
| User navigates away | isolated, browser user agent |
| Frontend timeout | client abort at fixed duration |
| Proxy timeout | abort around proxy timeout value |
| Large download canceled | partial response bytes |
| Mobile network drop | random abnormal closures |
| Server too slow | abort correlates with high latency |
| Rolling update | abort during deployment window |

Diagnostic steps:

1. Check duration before abort.
2. Check whether response was committed.
3. Check proxy/LB logs.
4. Check frontend/client timeout.
5. Check large response/download pattern.
6. Check deployment/shutdown events.
7. Check network/LB idle timeout.

Do not classify every broken pipe as server error. Sometimes it is normal client behavior.

But high client abort rate is a signal:

```text
client abort may be normal individually,
but abnormal statistically.
```

---

## 16. Diagnosing 502, 503, 504

These often originate outside application code.

### 16.1 502 Bad Gateway

Common causes:

- backend connection refused,
- backend closed connection unexpectedly,
- protocol mismatch,
- TLS/backend certificate issue,
- upstream reset,
- invalid response from backend,
- app process crash,
- pod killed mid-request.

### 16.2 503 Service Unavailable

Common causes:

- no healthy backend,
- readiness probe failing,
- app overloaded and rejecting,
- load balancer target unavailable,
- deployment drain,
- circuit breaker open,
- maintenance mode.

### 16.3 504 Gateway Timeout

Common causes:

- app too slow,
- downstream too slow,
- thread starvation,
- DB pool exhausted,
- proxy timeout shorter than app processing,
- long polling/SSE misconfigured,
- WebSocket idle/upgrade issue in some setups.

Diagnostic method:

```text
Compare timestamps and duration across layers.
```

Example:

```text
Proxy log: 504 after 60,000 ms
App log: request completed 200 after 74,000 ms
Conclusion: app completed after proxy gave up.
```

Another example:

```text
Proxy log: 502 immediately
App log: no request
Kubernetes event: pod restarted
Conclusion: backend endpoint unavailable/reset before app handling.
```

Another:

```text
Proxy log: 503
Ingress controller: no endpoints
Kubernetes readiness: failing
Conclusion: routing layer had no ready pod.
```

---

## 17. Diagnosing Slow Requests

Slow request diagnosis should follow a narrowing funnel.

### 17.1 First Question: Is It Systemic or Isolated?

Check:

- p95/p99 latency,
- endpoint-specific latency,
- status code distribution,
- request rate,
- CPU,
- memory/GC,
- thread pool busy,
- DB pool active/waiting,
- downstream latency,
- proxy upstream time.

### 17.2 Second Question: Where Is Time Spent?

Possible locations:

| Location | Evidence |
|---|---|
| Waiting before app | proxy queue/upstream connect time |
| Connector/thread queue | high busy threads, accept backlog |
| Filter chain | trace span/log gap before handler |
| App CPU | high CPU, stack traces in business code |
| DB | DB span slow, pool wait high |
| HTTP downstream | outbound span slow/timeouts |
| Lock contention | thread dump blocked/waiting |
| Response write | slow client, large response, socket write blocks |
| GC | GC pause/time correlation |

### 17.3 Thread Dump Is Often Faster Than Guessing

During incident, capture multiple thread dumps 5–10 seconds apart.

Look for:

- many threads in same stack,
- blocked on same lock,
- waiting for DB pool,
- waiting for HTTP client pool,
- stuck in socket read,
- stuck in file I/O,
- CPU-heavy loops,
- deadlock,
- executor queue saturation,
- virtual thread pinning indicators in modern JVM tooling/JFR.

One thread dump is a snapshot. Multiple dumps show movement or lack of movement.

---

## 18. Thread Dump Interpretation for Servlet Apps

Typical Servlet worker thread names vary by container:

- Tomcat: `http-nio-8080-exec-*`, `http-nio-8080-Acceptor`, `http-nio-8080-Poller`.
- Jetty: `qtp...` / queued thread pool names.
- Undertow/XNIO: `XNIO-*`, worker/task threads.

Diagnostic patterns:

### 18.1 DB Pool Exhaustion

Stacks show many request threads waiting in connection pool acquire.

Symptoms:

- request latency high,
- DB active connections at max,
- pool wait high,
- CPU may be low,
- thread pool fills.

Root may be:

- DB slow query,
- leak connection,
- transaction too long,
- pool too small,
- request fanout too high.

Do not just increase servlet threads. That can make DB collapse worse.

### 18.2 HTTP Client Pool Exhaustion

Many threads wait for outbound connection.

Symptoms:

- downstream dependency latency high,
- outbound pool maxed,
- app threads blocked,
- proxy may return 504.

Fix space:

- tune outbound pool,
- reduce fanout,
- add timeout,
- circuit breaker,
- bulkhead,
- cache,
- async/virtual thread only if downstream capacity allows.

### 18.3 Lock Contention

Many threads `BLOCKED` on same monitor.

Common causes:

- synchronized cache,
- singleton mutable state,
- session attribute lock,
- logging appender blocking,
- custom registry lock,
- class initialization lock,
- lazy singleton initialization.

### 18.4 Slow Client / Socket Write

Threads stuck in socket write or output stream write.

Possible:

- large downloads,
- slow client,
- proxy buffering disabled,
- response streaming,
- WebSocket slow consumer.

### 18.5 CPU Saturation

Thread dumps show runnable threads in:

- JSON serialization,
- regex,
- template rendering,
- compression,
- encryption/signature,
- sorting/aggregation,
- large object mapping,
- infinite loop.

Use profiler/JFR, not only logs.

---

## 19. JVM Observability in Servlet Runtime

Servlet problems often surface as JVM symptoms.

Track:

- heap used/committed/max,
- non-heap/metaspace,
- GC pause duration,
- allocation rate,
- live set after GC,
- thread count,
- class count,
- CPU process/user/system,
- file descriptors,
- direct buffer memory,
- safepoint time,
- JFR events for socket/file/lock allocation.

### 19.1 Heap Growth

Possible causes:

- session bloat,
- request body cached in memory,
- response buffering too large,
- unbounded WebSocket registry,
- unbounded queues,
- cache without eviction,
- large JSON/object graph,
- multipart stored in memory,
- static map leak.

### 19.2 Metaspace Growth

Possible causes:

- repeated redeploy classloader leak,
- dynamic proxy/class generation,
- JSP recompilation/class generation,
- bytecode libraries,
- app server shared lib leak.

### 19.3 Thread Count Growth

Possible causes:

- executor leak,
- scheduled task not stopped on redeploy,
- WebSocket per-session thread anti-pattern,
- HTTP client creates threads repeatedly,
- timer leak,
- library background threads.

### 19.4 File Descriptor Growth

Possible causes:

- socket leak,
- file stream not closed,
- multipart temp file leak,
- too many outbound connections,
- too many WebSocket connections,
- logging file handle issue.

---

## 20. Container JMX and Runtime Introspection

For traditional servlet containers, JMX is still valuable.

Tomcat exposes connector, thread pool, datasource, web module, session, request processor, and other runtime components through JMX. Its official monitoring guide documents enabling JMX remote/local monitoring and management. Jetty’s architecture also exposes operational concepts like connectors, acceptors, selectors, and queued thread pools that should be reflected in monitoring.

Key MBean-like concepts to inspect:

- connector request count,
- connector error count,
- bytes sent/received,
- processing time,
- current thread count,
- current threads busy,
- max threads,
- active sessions,
- datasource active/idle/waiting,
- deployment state,
- web module state.

For embedded servers with Spring Boot/Micrometer, similar metrics may be exported through Actuator/Micrometer rather than direct manual JMX use.

Diagnostic principle:

```text
Container metrics show whether request execution resources are healthy.
Application metrics show whether business/application operations are healthy.
Both are needed.
```

---

## 21. WebSocket Diagnostics Playbook

### 21.1 Symptom: WebSocket Fails to Connect

Check:

1. HTTP status from handshake.
2. Browser console network tab.
3. Proxy supports `Upgrade` and `Connection` headers.
4. TLS/wss configuration.
5. Origin validation.
6. Authentication cookie/token present.
7. Endpoint path and context path.
8. Subprotocol negotiation.
9. Container WebSocket feature enabled.
10. Access log shows `101 Switching Protocols` or rejection.

Layer map:

```text
No request in app log -> proxy/LB/path/TLS issue
Handshake reaches app but 403 -> auth/origin policy
Handshake reaches endpoint but closes immediately -> endpoint error/subprotocol/policy
101 success then disconnect -> idle timeout/network/heartbeat
```

### 21.2 Symptom: Frequent Disconnects

Check:

- close code distribution,
- time-to-disconnect histogram,
- LB/proxy idle timeout,
- ping/pong interval,
- client network type,
- deployment windows,
- pod restarts,
- server overload,
- send queue overflow,
- memory/GC pauses,
- auth token/session expiry.

If most disconnects happen around exactly 60 seconds, 120 seconds, 300 seconds, or 3600 seconds, suspect timeout alignment.

### 21.3 Symptom: Messages Delayed

Check:

- outbound queue depth,
- async send callback duration,
- broker lag,
- client read speed,
- compression overhead,
- JSON serialization cost,
- event fanout cardinality,
- GC pause,
- single-writer bottleneck.

### 21.4 Symptom: Duplicate Messages

Check:

- reconnect replay logic,
- ACK timeout too short,
- client resubscribe behavior,
- server sends old and new connection concurrently,
- broker redelivery,
- idempotency key missing,
- multi-tab behavior.

### 21.5 Symptom: Presence Incorrect

Check:

- stale session cleanup,
- heartbeat timeout,
- reconnect grace window,
- multiple connections per user,
- cluster node crash,
- distributed presence TTL,
- delayed close event.

---

## 22. Async Servlet Diagnostics

Async bugs are usually lifecycle bugs.

Common symptoms:

| Symptom | Possible cause |
|---|---|
| Request hangs | forgot `complete()` |
| Timeout fires despite work done | race between completion and timeout |
| Response double-write | timeout handler and success handler both write |
| Missing logs | completion logged in filter before async done |
| Lost request ID | MDC not propagated |
| Memory leak | async context retained after completion |
| 500 after timeout | async task writes to closed response |
| Thread pool fine but async slow | async executor saturated |

Metrics required:

- async started,
- async completed,
- async timeout,
- async error,
- async duration,
- executor queue depth,
- task rejection,
- response write failure.

Logging pattern:

```text
async.started requestId=abc
async.task.started requestId=abc
async.timeout requestId=abc elapsed=30000
async.task.completed requestId=abc result=late ignored=true
async.completed requestId=abc status=503
```

Use atomic state to avoid double completion:

```java
final AtomicBoolean done = new AtomicBoolean(false);

void completeOnce(AsyncContext ctx) {
    if (done.compareAndSet(false, true)) {
        ctx.complete();
    }
}
```

---

## 23. Diagnosing Memory Leaks Specific to Servlet/WebSocket

### 23.1 Servlet-Specific Leak Sources

- static maps holding request/session/context objects,
- `ThreadLocal` not cleared,
- session attributes too large,
- request body cached into memory,
- multipart upload threshold too high,
- application-level caches unbounded,
- listeners registering global resources and not unregistering,
- executor not shutdown on context destroy,
- JDBC driver not deregistered on redeploy,
- logging framework/classloader leak,
- MBeans not unregistered.

### 23.2 WebSocket-Specific Leak Sources

- session registry not cleaned on close/error,
- per-session queue unbounded,
- stale user-to-session mapping,
- heartbeat tasks not canceled,
- scheduled reconnect/session tasks retained,
- lambda captures endpoint/session strongly,
- broker subscription not removed,
- pending async send callbacks accumulate.

### 23.3 Detection Pattern

Use:

- heap usage after full GC,
- object histogram,
- heap dump dominator tree,
- active session count,
- WebSocket connection count,
- registry size,
- queue size,
- redeploy count vs metaspace.

If heap grows but active sessions/connections do not, inspect caches, queues, static references, and request/response buffering.

If heap grows with active sessions, inspect session attribute size and lifecycle.

If heap grows with WebSocket connections, inspect per-connection buffers/queues and slow clients.

---

## 24. Diagnosing Classloader Leaks After Redeploy

Symptoms:

- metaspace grows after every redeploy,
- old application classes remain referenced,
- duplicate scheduled tasks,
- duplicate log events,
- old JDBC drivers still registered,
- old WebSocket/session registry still alive,
- thread names from old deployment still running.

Investigation:

1. Capture heap dump after redeploy.
2. Search for old webapp classloader instances.
3. Find GC roots retaining them.
4. Common roots:
   - running thread context classloader,
   - static fields,
   - `ThreadLocal` values,
   - JDBC `DriverManager`,
   - JMX MBean server,
   - logging framework,
   - timer/executor,
   - global cache.

Prevention:

- cleanup in `ServletContextListener.contextDestroyed`,
- stop executors,
- close HTTP clients,
- close DB pools,
- unregister drivers/MBeans if manually registered,
- remove ThreadLocals,
- avoid container-global references to webapp classes.

---

## 25. Observability for Graceful Shutdown and Rolling Update

A graceful shutdown is observable if you can answer:

- when did pod/container receive termination signal?
- when did readiness turn false?
- how many in-flight requests existed?
- how many WebSocket connections existed?
- how many were closed gracefully?
- how many were dropped?
- did any request exceed grace period?
- did LB continue sending traffic after readiness false?
- did background tasks stop cleanly?

Shutdown metrics/events:

```text
shutdown.signal.received
readiness.disabled
http.drain.started
websocket.close.started
inflight.requests.count
active.websocket.count
shutdown.timeout
shutdown.completed
```

For WebSocket, planned maintenance should ideally send close reason/code before process exits.

For HTTP, readiness should fail before accepting termination, giving load balancer time to drain.

Common failure:

```text
Pod receives SIGTERM
App still reports ready
LB sends new requests
Container exits before requests finish
Client sees 502/connection reset
```

Observability must prove or disprove this sequence.

---

## 26. Synthetic Probes and Health Checks

Health checks are not observability by themselves, but they provide runtime signals.

Types:

| Probe | Purpose |
|---|---|
| Liveness | Should process be restarted? |
| Readiness | Should instance receive traffic? |
| Startup | Has slow startup completed? |
| Synthetic external check | Can users reach service through real path? |

Bad health check:

```text
return 200 if JVM process is alive
```

Better readiness considers:

- app initialized,
- servlet context ready,
- critical config loaded,
- DB pool can acquire connection or degraded policy known,
- broker/cache if required for core traffic,
- not draining,
- not overloaded beyond admission threshold.

But readiness must be cheap. Do not run expensive queries every second.

Separate:

- shallow readiness,
- deep diagnostic endpoint,
- external synthetic transaction.

---

## 27. Incident Triage Framework

When production issue happens, use structured triage.

### Step 1 — Define Symptom Precisely

Bad:

```text
The app is slow.
```

Better:

```text
POST /api/cases/{id}/submit p95 increased from 400 ms to 8 s since 10:05 UTC, mostly 504 at ALB after 60 seconds, affecting intranet users only.
```

### Step 2 — Identify Boundary

Ask:

- Did request reach LB?
- Did request reach proxy/ingress?
- Did request reach container?
- Did request reach app handler?
- Did app call downstream?
- Did app write response?
- Did client receive it?

### Step 3 — Compare Good vs Bad

Compare by:

- endpoint,
- method,
- user group,
- pod/node,
- availability zone,
- browser/client,
- payload size,
- session state,
- deployment version,
- downstream dependency.

### Step 4 — Check Time Correlation

Overlay:

- deployment events,
- config changes,
- traffic changes,
- DB/broker/cache incidents,
- autoscaling events,
- pod restarts,
- GC pauses,
- CPU/memory spikes,
- thread pool saturation,
- proxy errors.

### Step 5 — Form Hypothesis and Validate

Avoid random tuning.

Example:

```text
Hypothesis: 504 is caused by DB pool exhaustion.
Evidence needed:
  - high pool active=max
  - high pool wait time
  - request threads waiting on pool acquire
  - DB query latency or transaction duration high
  - proxy 504 after fixed timeout
```

### Step 6 — Mitigate Then Root Cause

Mitigation examples:

- reduce traffic/admission,
- disable expensive feature,
- scale pods if CPU/thread saturated and downstream can handle it,
- increase timeout only if user experience and downstream semantics allow,
- restart leaking instance as temporary measure,
- rollback recent deployment,
- drain broken node,
- enable circuit breaker/fallback.

Root cause examples:

- missing DB index,
- thread pool too high for DB pool,
- unbounded WebSocket queue,
- wrong proxy timeout,
- body limit mismatch,
- bad path rewrite,
- session bloat,
- classloader leak,
- slow external dependency.

---

## 28. Observability Anti-Patterns

### 28.1 Logging Everything

Excessive logs cause:

- cost explosion,
- slower app,
- noisy incident response,
- sensitive data leakage,
- hard search.

### 28.2 Metrics Without Labels Discipline

High-cardinality labels can break metrics backend.

### 28.3 Dashboard Without Runbook

Dashboard answers “what”. Runbook answers “so what now?”.

### 28.4 Only Average Latency

Average hides tail pain.

### 28.5 Only Application Metrics

Many failures happen before app code.

### 28.6 Only Infrastructure Metrics

CPU/memory can look normal while business operation fails.

### 28.7 No Correlation ID

Logs become unjoinable.

### 28.8 Health Check That Lies

Returning 200 while app cannot serve real traffic makes Kubernetes/LB route users into failure.

### 28.9 Alert on Everything

Alert fatigue makes real incidents ignored.

### 28.10 No Failure Taxonomy

Every error becomes “500” or “unknown”. This prevents learning.

---

## 29. Alert Design for Servlet/WebSocket Runtime

Good alerts are symptom-based and actionable.

Alert candidates:

### HTTP

- 5xx rate above baseline,
- 504 rate above baseline,
- p95/p99 latency above SLO,
- request error budget burn,
- thread pool saturation,
- connector max connections near limit,
- DB pool wait high,
- async timeout spike,
- client abort rate spike,
- 413/431 spike,
- readiness flapping.

### WebSocket

- active connections sudden drop,
- abnormal close code spike,
- handshake failure spike,
- outbound queue full,
- slow client disconnect spike,
- message validation failure spike,
- reconnect storm,
- broker fanout lag,
- heartbeat timeout spike.

### JVM/container

- heap after GC steadily increasing,
- GC pause above threshold,
- metaspace growth after redeploy,
- thread count growth,
- file descriptor usage high,
- pod restart loop,
- CPU throttling.

Avoid alerts like:

```text
CPU > 70% for 1 minute
```

unless tied to user impact or resource exhaustion.

Better:

```text
p95 latency > SLO and 5xx/timeout increasing
```

or:

```text
busy servlet threads > 90% for 5 minutes and request queue increasing
```

---

## 30. Practical Diagnostic Checklists

### 30.1 HTTP Request Checklist

For one failing request, collect:

- request ID,
- timestamp,
- method,
- URL/path,
- status seen by client,
- response body/error page signature,
- proxy access log,
- container access log,
- application log,
- trace ID,
- pod/node/version,
- user/session context if safe,
- payload size,
- response duration,
- downstream calls.

### 30.2 Timeout Checklist

Compare:

- client timeout,
- CDN/WAF timeout,
- LB timeout,
- ingress/proxy timeout,
- container connection/request timeout,
- async servlet timeout,
- app operation timeout,
- outbound HTTP timeout,
- DB query timeout,
- transaction timeout,
- Kubernetes termination grace.

The shortest relevant timeout usually decides what the user sees.

### 30.3 WebSocket Checklist

Collect:

- handshake status,
- endpoint path,
- request ID/connection ID,
- user ID/session ID masked,
- origin,
- subprotocol,
- close code,
- close reason sanitized,
- connection lifetime,
- messages in/out,
- last heartbeat,
- queue size,
- node/pod,
- proxy idle timeout,
- deployment event correlation.

### 30.4 Upload Checklist

Collect:

- content length,
- content type,
- multipart boundary present,
- proxy body limit,
- container body/header limit,
- multipart config limit,
- temp disk usage,
- parse exception,
- scan/storage latency,
- client abort during upload.

### 30.5 Memory Leak Checklist

Collect:

- heap after GC trend,
- active sessions,
- active WebSocket connections,
- cache sizes,
- queue sizes,
- request body buffering,
- heap dump dominators,
- object histogram,
- redeploy count,
- metaspace trend.

---

## 31. Example: End-to-End Diagnosis of 504

Symptom:

```text
Users report Submit Case sometimes fails.
ALB returns 504 after ~60s.
```

Evidence:

```text
ALB access log:
  POST /api/cases/123/submit -> 504 duration=60.001s

App access log:
  POST /api/cases/123/submit -> 200 duration=74.320s requestId=abc

App trace:
  DB update case = 120ms
  HTTP call document-service = 72s

Thread metrics:
  busy threads high

Outbound HTTP metrics:
  document-service p99 = 80s
```

Conclusion:

```text
The Servlet app was not the first layer returning failure.
The proxy/LB timed out before app completed.
Root contributor is slow document-service call.
```

Mitigation:

- reduce synchronous dependency on document-service,
- set outbound timeout lower than LB timeout,
- return controlled 503/504-like application error before LB timeout,
- consider async job if operation is long-running,
- add circuit breaker/bulkhead,
- surface progress via SSE/WebSocket if needed.

Bad fix:

```text
Increase servlet maxThreads.
```

Why bad?

Because more concurrent stuck requests may overload document-service harder.

---

## 32. Example: End-to-End Diagnosis of WebSocket Disconnects

Symptom:

```text
Dashboard live updates disconnect every 60 seconds.
```

Evidence:

```text
Browser: WebSocket closes, reconnects.
Server endpoint: close observed as abnormal closure.
Proxy: upstream connection closed at 60s idle.
App: heartbeat interval = 120s.
```

Conclusion:

```text
Proxy idle timeout is shorter than heartbeat interval.
The connection is considered idle before heartbeat occurs.
```

Fix:

- heartbeat interval lower than proxy idle timeout,
- configure proxy/LB WebSocket idle timeout appropriately,
- track close code/lifetime histogram,
- add jitter to reconnect.

Bad fix:

```text
Only increase client reconnect attempts.
```

Why bad?

It hides the timeout mismatch and may create reconnect storm.

---

## 33. Example: Diagnosing Thread Saturation

Symptom:

```text
All endpoints become slow, CPU only 35%, DB CPU normal.
```

Evidence:

```text
Container busy threads = max
Request queue increasing
Thread dump: many http-nio exec threads waiting on Hikari getConnection
DB pool active = max
DB pool wait p95 = 8s
```

Conclusion:

```text
Servlet worker threads are saturated because they block waiting for DB connections.
DB pool is the immediate bottleneck.
```

Possible root causes:

- leaked connections,
- long transactions,
- slow query holding connections,
- pool too small for legitimate load,
- servlet threads too high relative to DB pool,
- request fanout needing multiple DB connections.

Good next steps:

- inspect pool leak detection,
- inspect long-running SQL,
- inspect transaction boundaries,
- compare request concurrency vs pool size,
- add backpressure/admission control,
- tune pool only after workload analysis.

---

## 34. Example: Diagnosing 431 After Domain Migration

Symptom:

```text
Some users cannot access app after domain migration.
They receive 431 or login loop.
```

Evidence:

```text
Proxy logs request header too large.
Browser has multiple old cookies for old/new domain/path.
Cookie header > proxy limit.
App receives no request.
```

Conclusion:

```text
Failure happens before Servlet app.
Cookie bloat/stale cookie duplication causes oversized request headers.
```

Fix:

- expire old cookies with exact old path/domain where possible,
- reduce cookie payload,
- avoid storing large state in cookies,
- align domain/path attributes,
- temporarily increase proxy/header limit only if justified,
- add sanitized header-size diagnostics.

---

## 35. What Top 1% Engineers Do Differently

A strong Servlet/WebSocket engineer does not debug by intuition alone.

They build evidence chains:

```text
client symptom
  -> edge/proxy log
  -> container access log
  -> app structured log
  -> trace span
  -> runtime metrics
  -> thread/JFR/heap evidence
  -> root cause hypothesis
  -> validation
  -> mitigation
  -> prevention
```

They ask:

- Which layer generated the status code?
- Did the request reach application code?
- Was response committed?
- Was the connection closed by client, proxy, container, or app?
- Which timeout fired first?
- Is this isolated or systemic?
- Is capacity limited by threads, CPU, DB pool, HTTP client pool, broker, file I/O, or slow clients?
- Are metrics low-cardinality and useful?
- Can we trace one request end-to-end?
- Can we explain failure as a state transition?

They avoid:

- blindly increasing thread pools,
- blindly increasing timeouts,
- treating all 5xx as app bugs,
- treating all broken pipes as critical,
- logging sensitive data,
- relying only on controller logs,
- ignoring proxy/LB/Kubernetes behavior,
- adding WebSocket without close/heartbeat/reconnect metrics.

---

## 36. Minimal Production Observability Baseline

For any serious Servlet/WebSocket system, the minimum baseline should be:

### HTTP

- container/proxy access logs with request ID,
- app structured logs with request ID,
- p50/p95/p99 latency by route/method/status,
- status code distribution,
- in-flight request count,
- request rate,
- error rate,
- request/response size distribution,
- client abort count if available.

### Container

- busy/max threads,
- active/max connections,
- accept backlog/rejection if available,
- async timeout count,
- active sessions,
- connector errors.

### JVM

- CPU,
- heap after GC,
- GC pause,
- thread count,
- metaspace,
- file descriptors,
- direct memory if relevant.

### Downstream

- DB pool active/idle/waiting,
- DB query latency,
- outbound HTTP latency/error/timeout,
- broker publish/consume latency,
- cache latency/error.

### WebSocket

- active connections,
- open/close rate,
- close code distribution,
- handshake failure count,
- inbound/outbound message rate,
- message size,
- send queue depth,
- slow client drops,
- heartbeat timeout.

### Deployment

- app version label,
- pod/node/zone label,
- deployment event markers,
- readiness/liveness state,
- graceful shutdown metrics.

---

## 37. Common Mapping: Symptom → Evidence → Likely Layer

| Symptom | First evidence to check | Likely layer |
|---|---|---|
| No app logs, proxy 413 | proxy access/error log | proxy/body limit |
| No app logs, container 400 | container access/error log | connector parsing/header/request line |
| App logs 200, client sees 504 | proxy duration vs app duration | proxy timeout |
| Many 431 | header/cookie size | browser/proxy/container header limit |
| Many broken pipe | duration/client abort/proxy logs | client/proxy/server write |
| Busy threads max, CPU low | thread dump/pool metrics | blocking downstream/pool wait |
| CPU high, threads runnable | JFR/profiler/thread dump | CPU-bound app code |
| Heap grows with sessions | session metrics/heap dump | session bloat |
| Heap grows with WebSocket connections | registry/queue metrics | WS session/queue leak |
| WebSocket closes every fixed interval | close lifetime histogram/proxy timeout | idle timeout mismatch |
| 404 only behind proxy | path/context rewrite logs | proxy/context path |
| 405 for preflight | OPTIONS/CORS logs | filter/framework route |
| 503 during deploy | readiness/endpoints/events | Kubernetes/LB drain |
| Metaspace grows after redeploy | classloader heap analysis | redeploy leak |

---

## 38. References

- Jakarta Servlet 6.1 Specification and API documentation. Servlet API defines server-side request/response handling and response buffering/commit behavior.
- Jakarta WebSocket 2.2 Specification. Jakarta WebSocket defines Java server/client endpoint APIs for RFC 6455 WebSocket.
- RFC 6455 — The WebSocket Protocol.
- Apache Tomcat 11 Monitoring and Managing Tomcat documentation. Tomcat documents JMX-based monitoring and management facilities.
- Apache Tomcat 11 HTTP Connector documentation.
- Jetty 12.1 threading architecture documentation. Jetty documents connector acceptor/selector use of the queued thread pool.
- Kubernetes documentation for probes and pod termination lifecycle.
- W3C Trace Context for `traceparent` propagation.
- OpenTelemetry semantic conventions for HTTP/server/client telemetry.

---

## 39. Ringkasan

Part ini membangun mental model bahwa observability Servlet/WebSocket bukan sekadar memasang dashboard.

Yang harus dipahami:

1. Request dan WebSocket connection melewati banyak boundary.
2. Banyak failure terjadi sebelum application code dipanggil.
3. Access log, app log, metrics, traces, thread dump, heap dump, and JFR punya fungsi berbeda.
4. Correlation ID/trace ID adalah fondasi investigasi.
5. Status code harus dibaca berdasarkan layer yang menghasilkannya.
6. 404, 405, 413, 431, 499-like, 502, 503, 504 punya diagnostic path berbeda.
7. WebSocket butuh metrics khusus: connection, close code, heartbeat, queue, slow client, reconnect.
8. Async servlet butuh observability untuk started/completed/timeout/error.
9. Thread dump sering lebih jujur daripada asumsi.
10. Tuning tanpa bukti dapat memperparah overload.

Top-tier engineer mampu mengubah incident kabur seperti “app lambat” menjadi evidence chain yang jelas:

```text
who saw what
which layer generated it
when it started
how widespread it is
which resource is saturated
which timeout fired
which state transition failed
what mitigation is safest
what prevention should be added
```

---

## 40. Status Seri

Seri belum selesai.

Part yang sudah selesai:

- Part 000 — Orientation
- Part 001 — Evolution: `javax.*` to `jakarta.*`
- Part 002 — HTTP Fundamentals
- Part 003 — Servlet Container Architecture
- Part 004 — Servlet Lifecycle
- Part 005 — `HttpServletRequest`
- Part 006 — `HttpServletResponse`
- Part 007 — Servlet Mapping
- Part 008 — Request Dispatching
- Part 009 — Filters
- Part 010 — Listeners
- Part 011 — ServletContext
- Part 012 — HttpSession
- Part 013 — Cookies and Browser Boundary
- Part 014 — Async Servlet
- Part 015 — Servlet Non-Blocking I/O
- Part 016 — Multipart Upload and Large Payload
- Part 017 — Error Handling
- Part 018 — Threading Model
- Part 019 — Classloading and Redeployment
- Part 020 — Packaging Models
- Part 021 — WebSocket Protocol Fundamentals
- Part 022 — Jakarta WebSocket Server Endpoint Model
- Part 023 — WebSocket Session, Concurrency, and State Management
- Part 024 — WebSocket Reliability Patterns
- Part 025 — WebSocket Security Boundary
- Part 026 — SSE, Long Polling, and Streaming Alternatives
- Part 027 — JSP, Jakarta Pages, EL, JSTL
- Part 028 — Container Configuration
- Part 029 — Reverse Proxy, Load Balancer, Kubernetes, and Cloud Runtime
- Part 030 — Observability and Diagnostics

Part berikutnya:

- Part 031 — Advanced Architecture Patterns and Final Integration

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-servlet-websocket-web-container-runtime — Part 029](./learn-java-servlet-websocket-web-container-runtime-part-029.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-servlet-websocket-web-container-runtime-part-031](./learn-java-servlet-websocket-web-container-runtime-part-031.md)

</div>