# Part 28 — Observability for Networked Java Systems: Logs, Metrics, Traces, Correlation, and Wire Debugging

> Seri: `learn-java-io-network-http-grpc-protocol-engineering`  
> File: `028-observability-for-networked-java-systems-logs-metrics-traces-correlation-wire-debugging.md`  
> Target: Java 8–25  
> Posisi seri: Part 28 dari 35

---

## 1. Tujuan Pembelajaran

Setelah bagian ini, kamu diharapkan bisa:

1. Melihat setiap network call sebagai **observable distributed attempt**, bukan sekadar method call.
2. Mendesain log, metric, trace, dan correlation model yang konsisten untuk HTTP, gRPC, WebSocket, SSE, dan custom TCP protocol.
3. Membedakan **request id**, **correlation id**, **trace id**, **span id**, **operation id**, **idempotency key**, dan **business id**.
4. Mengidentifikasi failure dari telemetry: DNS, connect, TLS, pool acquisition, queueing, timeout, retry, proxy, server, dependency, atau caller cancellation.
5. Mendesain observability untuk Java 8–25, baik menggunakan manual instrumentation, Micrometer, OpenTelemetry Java agent, interceptors, filters, maupun framework-level integration.
6. Membuat network client/server wrapper yang observability-first.
7. Melakukan wire debugging tanpa membocorkan secret, token, PII, atau payload sensitif.
8. Membuat dashboard dan alert yang mengarah ke aksi engineering, bukan hanya grafik indah.

---

## 2. Kenapa Observability Network Itu Sulit?

Di local code, failure sering terlihat jelas:

```text
NullPointerException at Foo.java:42
```

Di networked system, error yang sama-sama terlihat seperti timeout bisa berarti banyak hal:

```text
java.net.http.HttpTimeoutException: request timed out
```

Kemungkinan penyebabnya bisa sangat berbeda:

```text
DNS resolution lambat
TCP connect lambat
TLS handshake gagal/lambat
connection pool penuh
request antre di client
request diterima proxy tapi belum dikirim ke upstream
upstream overload
server sudah kirim response tapi client lambat membaca
retry layer memperpanjang latency
load balancer idle timeout menutup koneksi
service mesh melakukan circuit breaking
remote server menunggu database
caller sudah cancel tapi downstream masih bekerja
```

Observability network bukan hanya “tambahkan log”. Tujuannya adalah menjawab pertanyaan:

```text
Apa yang dicoba?
Ke mana dicoba?
Berapa lama setiap fase?
Berapa kali dicoba ulang?
Siapa yang membatalkan?
Layer mana yang menolak?
Resource mana yang habis?
Apakah failure bersifat lokal, dependency, jaringan, atau overload sistemik?
Apakah efek bisnisnya terjadi nol kali, satu kali, atau lebih dari satu kali?
```

Engineer top-tier tidak puas dengan:

```text
External API timeout.
```

Ia ingin bisa mengatakan:

```text
Call POST /payments/{id}/submit ke dependency payment-gateway gagal karena client-side deadline 2s habis.
Dari trace terlihat 1.6s habis di pool acquisition karena max per-route connection penuh.
Retry kedua tidak dijalankan karena remaining deadline tinggal 300ms dan body non-replayable.
Upstream metrics normal; bottleneck ada di caller pool sizing + burst concurrency.
```

Itu perbedaan antara logging biasa dan observability yang bisa dipakai untuk mengambil keputusan.

---

## 3. Observability: Logs, Metrics, Traces, Events, Profiles

Secara praktis, telemetry utama untuk networked Java system adalah:

```text
Logs     -> apa yang terjadi secara diskret
Metrics  -> seberapa sering, seberapa lambat, seberapa penuh
Traces   -> perjalanan request antar boundary
Events   -> perubahan state penting
Profiles -> CPU/allocation/thread behavior
```

Untuk network systems, tiga yang paling penting adalah logs, metrics, dan traces.

### 3.1 Logs

Logs cocok untuk menjawab:

```text
Apa detail kejadian spesifik ini?
Request mana?
User/action/module mana?
Dependency mana?
Status/failure apa?
Decision apa yang diambil?
```

Contoh log network yang buruk:

```text
ERROR External API failed
```

Contoh log network yang lebih berguna:

```json
{
  "level": "WARN",
  "event": "outbound_http_failed",
  "dependency": "case-registry",
  "method": "POST",
  "route": "/cases/{caseId}/screening",
  "attempt": 2,
  "max_attempts": 3,
  "failure_phase": "read_response",
  "exception_type": "java.net.SocketTimeoutException",
  "elapsed_ms": 1800,
  "remaining_deadline_ms": 450,
  "retryable": false,
  "retry_decision": "skip_remaining_deadline_too_low",
  "trace_id": "0af7651916cd43dd8448eb211c80319c",
  "span_id": "b7ad6b7169203331",
  "correlation_id": "corr-2026-06-18-001",
  "operation_id": "screening-req-88012"
}
```

Log berguna jika ia menyimpan **decision context**, bukan hanya exception.

### 3.2 Metrics

Metrics cocok untuk menjawab:

```text
Apakah ini sering terjadi?
Apakah latency memburuk?
Dependency mana yang paling lambat?
Apakah pool penuh?
Apakah retry meningkat?
Apakah error rate melebihi baseline?
Apakah p99 naik sebelum p50?
```

Contoh metrics penting:

```text
http.client.request.duration
http.client.request.count
http.client.error.count
http.client.retry.count
http.client.timeout.count
http.client.pool.active
http.client.pool.idle
http.client.pool.pending
http.client.pool.acquire.duration
http.client.tls.handshake.duration
http.client.dns.lookup.duration
grpc.client.call.duration
grpc.client.call.count
grpc.client.status.count
grpc.client.deadline_exceeded.count
grpc.client.cancelled.count
```

Metrics harus **low-cardinality**. Jangan membuat label seperti:

```text
caseId=CASE-2026-000000123
userId=U123456
fullUrl=/cases/CASE-2026-000000123/documents/DOC-999
```

Gunakan route/template:

```text
route=/cases/{caseId}/documents/{documentId}
```

### 3.3 Traces

Traces cocok untuk menjawab:

```text
Request ini melewati service mana saja?
Waktu habis di mana?
Dependency mana yang memperpanjang critical path?
Ada retry berapa kali?
Call mana parallel, mana sequential?
Adakah parent request yang sudah cancel tetapi child task masih berjalan?
```

Trace yang baik memperlihatkan tree seperti:

```text
HTTP POST /cases/{caseId}/submit                2300 ms
├─ validate request                              35 ms
├─ DB SELECT case                                80 ms
├─ HTTP POST screening-service                  1700 ms
│  ├─ attempt 1 connect+tls+write+read           900 ms DEADLINE_EXCEEDED
│  └─ attempt 2 skipped                          remaining_deadline_too_low
├─ DB UPDATE case_status                         120 ms
└─ publish audit event                           75 ms
```

Trace buruk hanya menunjukkan:

```text
POST /submit 2300 ms
```

Trace harus membawa boundary antar service, bukan hanya controller span.

---

## 4. Correlation Identifiers: Jangan Campur Semuanya

Banyak sistem production kacau karena semua identifier disebut `requestId`.

Padahal identifier punya fungsi berbeda.

| Identifier | Fungsi | Scope | Contoh |
|---|---|---|---|
| Trace ID | Mengikat distributed trace | Satu distributed execution | `0af7651916cd43dd8448eb211c80319c` |
| Span ID | Satu unit kerja dalam trace | Satu operation/span | `b7ad6b7169203331` |
| Correlation ID | Mengikat business/technical conversation | Bisa lintas trace/request | `corr-2026-0001` |
| Request ID | Mengidentifikasi satu inbound request | Satu HTTP/gRPC request | `req-abc123` |
| Operation ID | Mengidentifikasi satu business operation | Satu logical command | `submit-case-88012` |
| Idempotency Key | Mencegah duplicate side effect | Satu mutating command/retry group | `idem-9f1...` |
| Business ID | Entity/domain identifier | Domain lifecycle | `CASE-2026-00123` |
| Message ID | Satu event/message | Messaging boundary | `evt-77...` |

### 4.1 Trace ID Bukan Idempotency Key

Trace ID boleh berubah saat client retry dari luar sistem.

Idempotency key harus stabil untuk operasi yang sama.

```text
Wrong:
Use trace_id as idempotency key.

Better:
trace_id        = observability identity
idempotency_key = semantic duplicate-suppression identity
operation_id    = business command identity
```

### 4.2 Correlation ID Bukan Security Boundary

Correlation ID membantu pencarian log. Ia tidak boleh dipercaya sebagai bukti identitas caller.

```text
X-Correlation-ID: user-controlled unless generated/validated at trusted edge
```

Jika menerima correlation id dari luar:

1. Validasi format.
2. Batasi panjang.
3. Jangan log raw value jika bisa mengandung injection.
4. Jika tidak valid, generate baru.
5. Simpan original hanya bila aman dan perlu.

---

## 5. W3C Trace Context

Modern tracing biasanya memakai W3C Trace Context.

Header utama:

```http
traceparent: 00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01
tracestate: vendor-specific-data
```

Maknanya:

```text
version    = 00
trace id   = 0af7651916cd43dd8448eb211c80319c
parent id  = b7ad6b7169203331
flags      = 01, sampled
```

Aturan praktis:

```text
traceparent -> propagation antar service
tracestate  -> vendor-specific tracing state
baggage     -> contextual key/value, harus sangat hati-hati
```

Jangan memasukkan data sensitif ke baggage:

```text
Wrong:
baggage: userEmail=fajar@example.com,token=abc

Better:
baggage: tenant=internal,region=ap-southeast-1
```

Bahkan baggage pun harus dibatasi. Ia ikut menyebar ke service lain dan bisa memperbesar header.

---

## 6. Network Call sebagai Span

Setiap outbound call penting sebaiknya menjadi span.

Minimal attributes:

```text
span.name              = HTTP POST case-registry /cases/{caseId}/screening
span.kind              = CLIENT
server.address         = case-registry.internal
server.port            = 443
http.request.method    = POST
url.scheme             = https
http.route             = /cases/{caseId}/screening
http.response.status_code = 504
network.protocol.name  = http
network.protocol.version = 1.1 or 2
error.type             = timeout/read_timeout/connection_reset/etc
```

Untuk gRPC:

```text
rpc.system             = grpc
rpc.service            = ScreeningService
rpc.method             = SubmitScreening
grpc.status_code       = DEADLINE_EXCEEDED
server.address         = screening-service.internal
```

Untuk custom protocol:

```text
rpc.system             = custom-tcp
rpc.service            = LegacyCaseBridge
rpc.method             = SubmitCase
network.protocol.name  = legacy-case-protocol
network.protocol.version = 3
```

Prinsipnya: span harus menjawab **remote operation apa yang dicoba**, bukan hanya library call apa yang dipakai.

---

## 7. RED, USE, dan Golden Signals

Untuk service dan dependency HTTP/gRPC, gunakan kombinasi model berikut.

### 7.1 RED

```text
Rate      -> request/call per second
Errors    -> error per second / error ratio
Duration  -> latency distribution
```

RED cocok untuk API/service.

### 7.2 USE

```text
Utilization -> seberapa penuh resource
Saturation  -> antrean/backlog/pending
Errors      -> error resource
```

USE cocok untuk resource:

```text
connection pool
thread pool
event loop
CPU
memory
disk
socket/file descriptor
ephemeral ports
queue
```

### 7.3 Golden Signals

```text
latency
traffic
errors
saturation
```

Untuk networked Java systems, jangan hanya memonitor request duration. Monitor juga saturation:

```text
connection_pool_pending
executor_queue_size
event_loop_pending_tasks
retry_inflight
rate_limiter_rejected
bulkhead_rejected
```

Latency naik sering merupakan gejala akhir. Saturation biasanya sinyal lebih awal.

---

## 8. Latency Histogram: Jangan Pakai Average sebagai Kebenaran

Network latency tidak normal distribution. Ia heavy-tailed.

Average bisa terlihat aman sementara p99 buruk.

Contoh:

```text
1000 request:
990 request selesai 50 ms
10 request selesai 5000 ms

average = ~99.5 ms
p50     = 50 ms
p99     = 5000 ms
```

Jika dashboard hanya average, incident tidak terlihat.

Minimal lihat:

```text
p50
p90
p95
p99
max, jika tersedia
error rate
request volume
```

Untuk dependency penting:

```text
p99 latency by dependency
p99 latency by route/method
p99 pool acquisition time
p99 TLS handshake time
p99 DNS lookup time, jika tersedia
```

### 8.1 Coordinated Omission

Jika load test mengirim request baru setelah request sebelumnya selesai, test bisa menyembunyikan tail latency.

Contoh:

```text
System freeze 5 detik.
Client synchronous single-thread hanya mengirim 1 request selama freeze.
Metric terlihat hanya 1 request lambat.
Padahal pada real traffic, ratusan request akan terdampak.
```

Untuk benchmark network, gunakan load generator yang mempertahankan arrival rate, bukan hanya concurrency statis tanpa memahami coordinated omission.

---

## 9. Metrics Wajib untuk Outbound HTTP Client

Minimal outbound HTTP metrics:

```text
http_client_requests_total
http_client_request_duration_seconds
http_client_errors_total
http_client_timeouts_total
http_client_retries_total
http_client_retry_exhausted_total
http_client_inflight_requests
http_client_pool_active_connections
http_client_pool_idle_connections
http_client_pool_pending_acquires
http_client_pool_acquire_duration_seconds
http_client_connection_created_total
http_client_connection_closed_total
```

Label yang disarankan:

```text
dependency
method
route_template
status_class
status_code, jika cardinality terkendali
error_type
attempt
protocol_version
```

Hindari label:

```text
full_url
query_string
case_id
user_id
access_token
exception_message raw
```

### 9.1 Error Type Taxonomy

Buat taxonomy error yang stabil:

```text
dns_failure
connect_timeout
connection_refused
tls_handshake_failure
pool_acquire_timeout
write_timeout
read_timeout
request_timeout
deadline_exceeded
connection_reset
remote_4xx
remote_5xx
proxy_502
proxy_503
proxy_504
cancelled
rate_limited
bulkhead_rejected
circuit_open
unknown_io
```

Jangan jadikan class exception sebagai satu-satunya label. Exception class bisa berbeda antar client library.

```text
java.net.SocketTimeoutException
java.net.http.HttpTimeoutException
io.netty.handler.timeout.ReadTimeoutException
org.apache.hc.core5.util.Timeout
```

Semuanya mungkin perlu dipetakan ke taxonomy yang sama.

---

## 10. Metrics Wajib untuk gRPC Client/Server

Untuk gRPC:

```text
grpc_client_calls_total
grpc_client_call_duration_seconds
grpc_client_status_total
grpc_client_deadline_exceeded_total
grpc_client_cancelled_total
grpc_client_retries_total
grpc_client_hedged_total
grpc_client_inflight_calls
grpc_client_stream_messages_sent_total
grpc_client_stream_messages_received_total
grpc_client_stream_active
grpc_client_flow_control_blocked_total
```

Label:

```text
rpc_service
rpc_method
grpc_status
call_type = unary/server_stream/client_stream/bidi_stream
dependency
```

Untuk server:

```text
grpc_server_calls_total
grpc_server_call_duration_seconds
grpc_server_status_total
grpc_server_inflight_calls
grpc_server_messages_sent_total
grpc_server_messages_received_total
grpc_server_deadline_exceeded_total
grpc_server_cancelled_total
```

Interpretasi penting:

```text
DEADLINE_EXCEEDED di client tidak selalu berarti server gagal.
CANCELLED di server bisa berarti client sudah tidak menunggu.
UNAVAILABLE bisa berasal dari transport, LB, resolver, atau server unavailable.
RESOURCE_EXHAUSTED bisa berarti server rate limit, message too large, atau quota.
```

---

## 11. Connection Pool Observability

Pool adalah salah satu penyebab timeout paling sering.

Jika hanya memonitor request duration, pool bottleneck terlihat seperti dependency lambat.

Metric pool minimal:

```text
active_connections
idle_connections
pending_acquires
max_connections
acquire_duration
acquire_timeout_count
connection_created_count
connection_evicted_count
connection_reused_count
connection_lifetime
connection_idle_duration
```

Interpretasi:

```text
pending_acquires naik + upstream latency normal
=> caller-side pool saturation

active=max + pending tinggi + CPU caller rendah
=> concurrency ke dependency dibatasi pool

connection_created naik drastis
=> reuse buruk, idle timeout mismatch, connection churn

idle banyak tapi pending tetap tinggi
=> pool partitioning/per-route issue atau leak body not consumed
```

### 11.1 HTTP/2 dan gRPC Pooling

HTTP/2/gRPC tidak selalu butuh banyak TCP connection karena satu connection bisa membawa banyak stream.

Tetapi tetap ada limit:

```text
max concurrent streams
connection-level flow control
server-side stream limit
client-side queueing
large stream blocking window
```

Metric penting:

```text
active_streams
max_concurrent_streams
pending_streams
stream_reset_count
connection_goaway_count
```

Jika library tidak mengekspos metric tersebut, setidaknya log/trace ketika call antre terlalu lama sebelum dikirim.

---

## 12. DNS, Connect, TLS: Fase yang Sering Hilang

Banyak instrumentation hanya mengukur total request duration.

Untuk incident berat, kamu perlu fase:

```text
pool acquire
DNS lookup
TCP connect
TLS handshake
request write
time to first byte
response body read
```

Tidak semua Java client mengekspos semua fase dengan mudah.

Strategi praktis:

1. Gunakan library yang mendukung event listener/hook jika butuh fase detail.
2. Tambahkan wrapper untuk pool acquire dan logical attempt duration.
3. Tambahkan synthetic probe untuk DNS/TLS endpoint kritikal.
4. Gunakan proxy/LB metrics sebagai pembanding.
5. Gunakan packet/wire debugging saat telemetry aplikasi tidak cukup.

Contoh phase log:

```json
{
  "event": "outbound_http_attempt_finished",
  "dependency": "identity-provider",
  "attempt": 1,
  "pool_acquire_ms": 8,
  "dns_ms": 0,
  "connect_ms": 22,
  "tls_ms": 41,
  "write_ms": 3,
  "ttfb_ms": 220,
  "body_read_ms": 12,
  "total_ms": 306,
  "status": 200
}
```

---

## 13. Logging Strategy untuk Java Network Boundary

Jangan log setiap byte. Log keputusan dan boundary.

### 13.1 Inbound Request Log

Log saat request selesai:

```json
{
  "event": "inbound_http_completed",
  "method": "POST",
  "route": "/cases/{caseId}/submit",
  "status": 202,
  "duration_ms": 430,
  "request_size_bytes": 1200,
  "response_size_bytes": 300,
  "caller": "case-ui",
  "trace_id": "...",
  "correlation_id": "..."
}
```

### 13.2 Outbound Attempt Log

Log per attempt, terutama jika gagal/retry:

```json
{
  "event": "outbound_http_attempt",
  "dependency": "screening-service",
  "method": "POST",
  "route": "/screenings",
  "attempt": 1,
  "duration_ms": 900,
  "failure_phase": "read_response",
  "error_type": "read_timeout",
  "retryable": true
}
```

### 13.3 Retry Decision Log

```json
{
  "event": "retry_decision",
  "dependency": "screening-service",
  "attempt": 1,
  "decision": "retry",
  "reason": "read_timeout_idempotent_operation_remaining_deadline_ok",
  "backoff_ms": 120,
  "remaining_deadline_ms": 1300
}
```

### 13.4 Circuit Breaker / Bulkhead Log

```json
{
  "event": "dependency_call_rejected",
  "dependency": "document-service",
  "reason": "bulkhead_full",
  "inflight": 80,
  "max_inflight": 80,
  "trace_id": "..."
}
```

---

## 14. Structured Logging dan MDC

Di Java, banyak stack memakai MDC atau thread-local context untuk menambahkan correlation fields.

Contoh klasik:

```java
MDC.put("trace_id", traceId);
MDC.put("correlation_id", correlationId);
try {
    service.handle(request);
} finally {
    MDC.clear();
}
```

Masalahnya:

```text
CompletableFuture pindah thread
reactive pipeline tidak selalu memakai thread yang sama
virtual threads bisa banyak sekali
event-loop tidak boleh menyimpan state sembarangan
manual thread pool kehilangan context jika tidak dipropagate
```

Prinsip Java modern:

```text
Context harus eksplisit atau dipropagate oleh instrumentation yang benar.
Jangan mengandalkan thread-local secara buta pada async/reactive/event-loop systems.
```

Dengan Java 25, scoped values menjadi pilihan modern untuk berbagi immutable context dalam lexical scope, tetapi integration dengan logging/tracing library tetap perlu dipahami.

---

## 15. OpenTelemetry di Java

OpenTelemetry menyediakan API, SDK, instrumentation, dan collector model untuk traces, metrics, dan logs.

Ada dua pendekatan utama:

```text
Java agent auto-instrumentation
Manual instrumentation / library instrumentation
```

### 15.1 Java Agent

Kelebihan:

```text
minim perubahan kode
bisa cepat mendapatkan HTTP/gRPC/JDBC/framework spans
mendukung banyak library populer
berguna untuk legacy Java 8+
```

Kekurangan:

```text
span name/attributes mungkin tidak sesuai domain
business operation id tidak otomatis ada
retry decision tidak otomatis terlihat
custom protocol tidak otomatis terinstrumentasi
bisa menghasilkan telemetry volume besar
perlu governance versi agent dan config
```

### 15.2 Manual Instrumentation

Kelebihan:

```text
bisa merekam domain semantics
bisa log retry decision, deadline budget, idempotency result
bisa membuat span untuk custom protocol/state machine
```

Kekurangan:

```text
butuh disiplin engineering
bisa tidak konsisten antar tim
bisa salah context propagation
```

Pendekatan terbaik sering hybrid:

```text
auto-instrument framework/library boundary
manual-instrument domain decisions and custom network wrappers
```

---

## 16. Micrometer di Java/Spring Ecosystem

Micrometer umum dipakai sebagai facade metrics, terutama dalam ekosistem Spring Boot.

Untuk networked systems, Micrometer berguna untuk:

```text
HTTP server metrics
HTTP client metrics
JVM metrics
executor metrics
connection pool metrics
custom resilience metrics
Prometheus export
histogram/percentile configuration
```

Tetapi jangan hanya mengandalkan metric otomatis.

Tambahkan custom meter untuk:

```text
retry decision
idempotency duplicate hit
deadline rejected
bulkhead rejected
pool acquire timeout
fallback served
remote dependency degraded
```

Contoh nama metric yang stabil:

```text
external_call_attempts_total
external_call_duration_seconds
external_call_retries_total
external_call_rejected_total
external_call_deadline_remaining_ms
idempotency_duplicate_total
```

---

## 17. Context Propagation Across HTTP

Inbound HTTP harus:

1. Extract trace context.
2. Validate/generate correlation id.
3. Attach request id.
4. Put safe fields into logs/spans.
5. Propagate trace context outbound.
6. Propagate correlation id jika internal policy mengizinkan.

Headers yang umum:

```http
traceparent: 00-...
tracestate: ...
X-Correlation-ID: corr-...
X-Request-ID: req-...
Idempotency-Key: idem-...
```

Aturan:

```text
traceparent: standards-based propagation
X-Correlation-ID: organizational convention
X-Request-ID: request-local identity
Idempotency-Key: semantic command duplicate prevention
```

### 17.1 Header Trust Boundary

Pada edge/gateway:

```text
external client -> generate/normalize correlation id
internal service -> trust only from known proxy/service mesh
```

Jangan biarkan external caller memilih trace id arbitrarily tanpa policy. Banyak tracing system menerima incoming traceparent, tetapi public edge perlu sanitization/decision apakah melanjutkan atau membuat trace baru.

---

## 18. Context Propagation Across gRPC

gRPC memakai metadata untuk membawa context.

Contoh metadata:

```text
traceparent: 00-...
x-correlation-id: corr-...
idempotency-key: idem-...
```

Gunakan interceptor:

```text
ClientInterceptor -> inject context outbound
ServerInterceptor -> extract context inbound
```

Untuk gRPC streaming:

```text
metadata dikirim di awal call
jika stream panjang, authorization/context bisa stale
message-level operation id mungkin tetap dibutuhkan
```

Untuk long-lived stream, jangan bergantung pada satu context awal untuk semua keputusan bisnis. Tambahkan message envelope bila perlu:

```protobuf
message StreamEnvelope {
  string message_id = 1;
  string operation_id = 2;
  int64 sequence = 3;
  google.protobuf.Timestamp created_at = 4;
  bytes payload = 5;
}
```

---

## 19. Observability untuk Retry dan Hedging

Retry tanpa observability adalah sumber kebingungan.

Trace harus menunjukkan attempt:

```text
parent span: POST /submit-payment
├─ attempt 1: POST payment-gateway 800ms UNAVAILABLE
├─ backoff: 120ms
└─ attempt 2: POST payment-gateway 230ms OK
```

Metric harus menunjukkan:

```text
calls_total = logical calls
attempts_total = actual network attempts
retries_total = extra attempts
retry_exhausted_total
hedged_requests_total
server_pushback_total
```

Log harus menunjukkan decision:

```text
retry because method idempotent + status UNAVAILABLE + remaining deadline sufficient
no retry because non-idempotent + unknown write status
no retry because circuit open
no retry because retry budget exhausted
```

Tanpa ini, traffic dependency bisa tampak “mendadak 3x” padahal retry policy aktif.

---

## 20. Observability untuk Timeout dan Deadline

Setiap timeout harus menjawab:

```text
Timeout apa?
Di fase mana?
Berapa configured timeout?
Berapa elapsed?
Berapa remaining deadline?
Apakah request sudah sampai remote?
Apakah side effect mungkin terjadi?
```

Contoh log:

```json
{
  "event": "outbound_timeout",
  "dependency": "license-registry",
  "timeout_type": "request_timeout",
  "failure_phase": "waiting_response_headers",
  "configured_timeout_ms": 2000,
  "elapsed_ms": 2005,
  "write_completed": true,
  "response_started": false,
  "side_effect_unknown": true,
  "retryable": false,
  "reason": "mutating_operation_without_idempotency_key"
}
```

Untuk gRPC:

```text
DEADLINE_EXCEEDED -> local deadline expired or remote reports deadline exceeded
CANCELLED -> caller cancellation or transport cancellation
```

Tambahkan attribute:

```text
deadline.ms
deadline.remaining_ms
cancel.source = client/server/parent_scope/shutdown
```

---

## 21. Observability untuk Backpressure dan Load Shedding

Jangan hanya log error saat request gagal. Rejection yang disengaja adalah sinyal proteksi.

Metrics:

```text
rate_limiter_allowed_total
rate_limiter_rejected_total
bulkhead_allowed_total
bulkhead_rejected_total
circuit_breaker_open_total
load_shed_total
queue_size
queue_wait_duration
adaptive_limit_current
adaptive_limit_rejected_total
```

Log untuk rejection:

```json
{
  "event": "request_rejected",
  "reason": "dependency_bulkhead_full",
  "dependency": "document-service",
  "inflight": 50,
  "limit": 50,
  "http_status": 503,
  "retry_after_ms": 1000
}
```

Response contract:

```http
HTTP/1.1 503 Service Unavailable
Retry-After: 1
Content-Type: application/problem+json
```

Atau gRPC:

```text
gRPC status = RESOURCE_EXHAUSTED or UNAVAILABLE
metadata: retry-after-ms = 1000
```

---

## 22. Wire Debugging: Kapan dan Bagaimana

Wire debugging diperlukan ketika telemetry aplikasi tidak cukup.

Tools umum:

```text
curl -v
openssl s_client
keytool
javax.net.debug
ngrep
tcpdump
Wireshark
ss / netstat
lsof
jcmd / jstack
Envoy/NGINX access logs
ALB/NLB metrics/logs
```

### 22.1 DNS

```bash
dig service.internal
nslookup service.internal
getent hosts service.internal
```

Di Kubernetes:

```bash
kubectl exec -it pod -- nslookup service.namespace.svc.cluster.local
kubectl exec -it pod -- cat /etc/resolv.conf
```

### 22.2 TCP

```bash
ss -tanp | grep 443
ss -s
lsof -iTCP -sTCP:ESTABLISHED
```

Lihat:

```text
ESTABLISHED
TIME_WAIT
CLOSE_WAIT
SYN_SENT
Recv-Q / Send-Q
```

### 22.3 TLS

```bash
openssl s_client -connect host:443 -servername host -showcerts
```

Java TLS debug:

```bash
-Djavax.net.debug=ssl,handshake
```

Hati-hati: TLS debug bisa sangat verbose dan bisa mengekspos detail sensitif. Jangan aktifkan di production lama-lama.

### 22.4 HTTP

```bash
curl -v https://host/path
curl --http2 -v https://host/path
curl --resolve host:443:1.2.3.4 https://host/path
```

### 22.5 Packet Capture

```bash
tcpdump -i eth0 host 10.0.1.25 and port 443 -w capture.pcap
```

Untuk TLS, payload terenkripsi. Namun packet capture tetap berguna untuk:

```text
SYN/SYN-ACK/connect behavior
RST/FIN
retransmission
packet loss
handshake timing
connection churn
idle close
```

---

## 23. Safe Payload Logging

Payload logging sering menggoda saat debugging, tetapi sangat berbahaya.

Risiko:

```text
PII leakage
access token leakage
credential leakage
document content leakage
regulatory data exposure
log retention violation
large log volume
log injection
```

Prinsip:

```text
Default: jangan log body.
Log metadata aman.
Log hash/checksum jika perlu korelasi.
Redact known sensitive fields.
Limit size.
Enable sampling and temporary debug switch.
Separate secure audit log from debug log.
```

Contoh aman:

```json
{
  "event": "outbound_payload_summary",
  "content_type": "application/json",
  "request_size_bytes": 1240,
  "payload_sha256_prefix": "a91c33f0",
  "field_count": 18,
  "redacted_fields": ["nric", "email", "phone"]
}
```

Hindari:

```json
{
  "request_body": "{\"nric\":\"S1234567A\",\"token\":\"...\"}"
}
```

---

## 24. Access Logs di Server, Proxy, dan Gateway

Aplikasi bukan satu-satunya sumber observability.

Gabungkan:

```text
application logs
API gateway access logs
ingress logs
load balancer logs
service mesh proxy logs
server runtime metrics
client metrics
```

Aplikasi melihat domain decision. Proxy melihat network hop.

Contoh field access log yang berguna:

```text
time
request method
route/path
status
upstream status
request duration
upstream duration
bytes in/out
client ip
x-forwarded-for
trace id
correlation id
upstream host
retry attempts by proxy
```

Jika aplikasi bilang 200 tetapi gateway bilang 504, kemungkinan response terlambat sampai gateway/caller atau gateway timeout lebih pendek dari server processing.

---

## 25. Observability untuk HTTP/2 dan gRPC

HTTP/2/gRPC membawa failure baru:

```text
GOAWAY
RST_STREAM
max concurrent streams exceeded
flow control stall
connection-level HOL due to TCP packet loss
header compression issues
large metadata rejection
```

Metrics/logs yang dicari:

```text
http2_goaway_total
http2_rst_stream_total
http2_active_streams
http2_pending_streams
http2_flow_control_wait_duration
grpc_status_total
grpc_deadline_exceeded_total
grpc_cancelled_total
grpc_message_size_rejected_total
```

Untuk gRPC, jangan hanya lihat HTTP status. Banyak gRPC error disampaikan melalui trailers dengan `grpc-status`.

---

## 26. Observability untuk Long-Lived Connections

SSE, WebSocket, dan streaming gRPC butuh metrics berbeda.

```text
active_connections
connection_duration
messages_sent_total
messages_received_total
bytes_sent_total
bytes_received_total
outbound_queue_size
slow_consumer_count
heartbeat_sent_total
heartbeat_missed_total
reconnect_count
resume_success_total
resume_failed_total
stream_cancelled_total
stream_deadline_exceeded_total
```

Jangan hanya mengukur request count.

Long-lived connection bisa sedikit jumlah request tetapi besar resource impact.

---

## 27. Java Thread, Executor, Event Loop, dan Virtual Thread Observability

Network issue sering terlihat sebagai thread issue.

Monitor:

```text
platform thread count
virtual thread count, jika tersedia dari runtime/observability stack
executor active threads
executor queue size
executor completed task count
event loop pending tasks
event loop blocked duration
ForkJoinPool saturation
CompletableFuture executor usage
```

Thread dump patterns:

```text
banyak thread WAITING di socket read
=> dependency slow atau timeout terlalu panjang

banyak thread BLOCKED di synchronized logger/client wrapper
=> lock contention

Netty event loop thread blocked di business code
=> fatal event-loop misuse

virtual threads banyak parked di HTTP call
=> mungkin normal, tapi cek dependency pool/backpressure
```

Virtual threads membuat blocking lebih scalable, tetapi tidak membuat remote dependency infinite.

---

## 28. Dashboard yang Berguna

Dashboard network dependency per service sebaiknya menjawab:

```text
Dependency mana yang paling sering dipanggil?
Dependency mana yang paling lambat p95/p99?
Dependency mana error rate-nya naik?
Apakah timeout naik?
Apakah retry naik?
Apakah pool pending naik?
Apakah circuit breaker open?
Apakah rejection disengaja naik?
Apakah caller atau callee yang bermasalah?
```

Layout contoh:

```text
Panel 1: inbound traffic/error/latency by route
Panel 2: outbound traffic/error/latency by dependency
Panel 3: outbound p95/p99 latency by dependency
Panel 4: error taxonomy by dependency
Panel 5: retry attempts and retry exhausted
Panel 6: connection pool active/idle/pending
Panel 7: timeout by phase
Panel 8: circuit breaker/bulkhead/rate limiter rejection
Panel 9: JVM threads, CPU, GC, memory
Panel 10: trace exemplars for p99 requests
```

### 28.1 Alert yang Baik

Alert buruk:

```text
p99 latency high
```

Alert lebih baik:

```text
screening-service outbound p99 > 2s for 10m AND error rate > 5% AND traffic > 50 rpm
```

Alert untuk saturation:

```text
connection_pool_pending > 0 for 5m AND active_connections == max_connections
```

Alert untuk retry storm:

```text
retry_attempts / logical_calls > 0.5 for 5m
```

Alert harus actionable.

---

## 29. Sampling Strategy

Tracing semua request bisa mahal.

Strategi:

```text
sample semua error
sample semua slow request
sample sebagian normal request
sample dependency kritikal lebih tinggi
gunakan tail sampling jika collector mendukung
jangan sampling audit-critical event log sembarangan
```

Perbedaan:

```text
Tracing sampling -> observability cost control
Audit logging     -> compliance/business record, policy berbeda
```

Jangan mencampur audit trail dengan debug trace.

---

## 30. Case Study: Timeout Misterius di External Registry

Gejala:

```text
POST /cases/{id}/submit kadang timeout 3s.
External registry menyatakan tidak ada masalah.
Application log hanya menulis "registry timeout".
```

Telemetry tambahan:

```text
http_client_request_duration p99 naik
http_client_pool_pending_acquires naik
pool_active == max
registry server-side latency normal
retry attempts naik 2x
JVM CPU normal
thread count naik
```

Kesimpulan:

```text
Masalah bukan registry lambat.
Caller pool per-route terlalu kecil untuk burst submit.
Retry memperparah karena attempt baru juga antre di pool.
```

Fix:

```text
set per-dependency concurrency budget eksplisit
increase pool jika dependency mampu
add pool acquisition timeout kecil
skip retry jika pool acquisition timeout
add retry budget
add bulkhead rejection dengan 503/Retry-After
add dashboard pool pending + retry ratio
```

Lesson:

```text
Timeout tanpa phase metrics membuat dependency disalahkan.
Pool saturation adalah local resource failure.
```

---

## 31. Case Study: gRPC DEADLINE_EXCEEDED tetapi Server Sukses

Gejala:

```text
Client menerima DEADLINE_EXCEEDED.
Server log menunjukkan operasi selesai dan DB updated.
Client retry menyebabkan duplicate notification.
```

Root cause:

```text
Client deadline 1s.
Server selesai 1.2s.
Client sudah tidak menunggu.
Operation mutating tidak memakai idempotency key.
Retry kedua membuat efek samping kedua.
```

Telemetry yang seharusnya ada:

```text
client deadline remaining
server observed deadline
server cancellation detection
operation id
idempotency duplicate hit
side_effect_commit span/event
```

Fix:

```text
make mutating operation idempotent
server checks Context cancellation before expensive non-essential work
deadline budget realistic
client does not retry mutating unknown outcome without idempotency
server emits operation_id in logs/audit
```

Lesson:

```text
Client timeout tidak membuktikan server tidak melakukan side effect.
Observability harus mengikat technical call ke business operation id.
```

---

## 32. Case Study: HTTP/2 GOAWAY Storm Setelah Deploy

Gejala:

```text
gRPC clients melihat UNAVAILABLE spike.
Gateway logs GOAWAY.
Deploy rolling restart normal menurut Kubernetes.
```

Kemungkinan:

```text
server shutdown tidak drain stream
LB deregistration delay pendek
client retry policy agresif
max connection age di server/proxy terlalu rendah
keepalive mismatch
```

Telemetry penting:

```text
GOAWAY count
RST_STREAM count
active streams during shutdown
server graceful shutdown duration
client retry attempts
channel reconnect count
LB target deregistration events
```

Fix:

```text
graceful shutdown: stop accepting new calls, drain active calls
readiness false before shutdown
align terminationGracePeriodSeconds
align LB deregistration delay
configure client retry budget
monitor GOAWAY during deploy
```

---

## 33. Production Network Observability Checklist

Untuk setiap dependency penting:

```text
[ ] Ada nama dependency stabil.
[ ] Ada route/method template, bukan full URL raw.
[ ] Ada request duration histogram.
[ ] Ada error taxonomy.
[ ] Ada retry metrics.
[ ] Ada timeout metrics by type/phase.
[ ] Ada pool active/idle/pending/acquire duration.
[ ] Ada circuit breaker/bulkhead/rate limiter metrics.
[ ] Ada trace span outbound.
[ ] Ada correlation id dan trace id di logs.
[ ] Ada idempotency/operation id untuk mutating operation.
[ ] Ada safe payload logging policy.
[ ] Ada dashboard dependency.
[ ] Ada alert error + latency + saturation.
[ ] Ada runbook untuk DNS/TCP/TLS/HTTP/gRPC debugging.
```

Untuk setiap inbound API:

```text
[ ] Access log structured.
[ ] Route-level metrics.
[ ] Status code taxonomy benar.
[ ] Request/response size metrics.
[ ] Trace context extraction.
[ ] Correlation id validation/generation.
[ ] Slow request trace sampling.
[ ] Error response includes safe problem details.
[ ] Audit event terpisah dari debug log.
```

---

## 34. Anti-Patterns

### 34.1 Log Everything

Logging semua payload bukan observability. Itu liability.

### 34.2 Only Average Latency

Average menyembunyikan tail latency.

### 34.3 Full URL as Metric Label

Ini menciptakan high-cardinality metrics dan bisa menjatuhkan metrics backend.

### 34.4 Trace Without Business Context

Trace tanpa operation id/domain id sering sulit dipakai untuk incident bisnis.

### 34.5 Retry Without Attempt Visibility

Jika attempt tidak terlihat, traffic amplification tidak akan disadari.

### 34.6 Alert on Everything

Alert yang terlalu banyak membuat engineer mengabaikan alert.

### 34.7 Trust External Correlation Header Blindly

Header dari client eksternal bisa injection/abuse.

### 34.8 Instrument Only Server Side

Banyak network failure terjadi di client: pool, DNS, timeout, retry, executor.

---

## 35. Practical Java Pattern: Observable HTTP Client Wrapper

Pseudo-design:

```java
public final class ObservableHttpClient {
    private final HttpClient client;
    private final DependencyConfig config;
    private final MeterRegistry meterRegistry;
    private final Tracer tracer;

    public HttpResult send(LogicalHttpRequest logicalRequest, Deadline deadline) {
        String dependency = logicalRequest.dependency();
        String route = logicalRequest.routeTemplate();

        // 1. start logical call span
        // 2. validate deadline
        // 3. inject trace/correlation/idempotency headers
        // 4. execute attempt loop with retry budget
        // 5. record attempt metrics
        // 6. map exceptions to stable error taxonomy
        // 7. log retry decision
        // 8. return typed result, not raw exception chaos
        return null;
    }
}
```

Core model:

```text
Logical call
  -> attempt 1
  -> retry decision
  -> attempt 2
  -> final outcome
```

Metrics separate:

```text
logical_calls_total
attempts_total
retries_total
final_outcome_total
```

This prevents confusion between user-visible operation count and actual network pressure.

---

## 36. Practical Java Pattern: Observable gRPC Interceptors

Client interceptor responsibilities:

```text
inject trace context
inject correlation id
inject deadline if absent
record call start/end
record status code
record cancellation
record message count for streaming if feasible
```

Server interceptor responsibilities:

```text
extract trace/correlation context
validate metadata
start server span
map exception to status
record status
log deadline/cancellation
attach operation id if available
```

Do not put heavy logic inside interceptor. Keep it fast and predictable.

---

## 37. Regulatory / Case-Management Lens

Dalam sistem enforcement/case-management, observability harus menghubungkan technical call ke lifecycle bisnis.

Contoh event penting:

```text
case.submit.requested
case.submit.validation_failed
case.submit.screening_requested
case.submit.screening_timeout_unknown_outcome
case.submit.approved
case.submit.audit_written
case.submit.notification_sent
```

Setiap network call yang memengaruhi keputusan harus bisa diaudit:

```text
What dependency was called?
What input contract version?
What result/status?
Was timeout outcome known or unknown?
Was retry performed?
Was duplicate suppressed?
Was manual intervention required?
```

Observability di sistem seperti ini bukan hanya performance. Ia bagian dari defensibility.

---

## 38. Latihan

### Latihan 1 — Design Outbound Metrics

Ambil satu dependency penting, misalnya `screening-service`. Desain:

```text
metrics
labels
error taxonomy
retry metrics
pool metrics
alert rules
```

Pastikan tidak ada high-cardinality label.

### Latihan 2 — Timeout Debugging

Diberikan gejala:

```text
p99 submit naik dari 800ms ke 4s.
External dependency error rate tetap 0.
Thread count naik.
Pool pending naik.
CPU normal.
```

Tuliskan diagnosis dan fix.

### Latihan 3 — Trace Design

Desain trace tree untuk workflow:

```text
Submit case
-> validate
-> call screening
-> upload document metadata
-> update DB
-> send notification
-> write audit trail
```

Tentukan span mana yang harus CLIENT, SERVER, INTERNAL, PRODUCER, atau CONSUMER.

### Latihan 4 — Safe Debug Logging

Buat policy payload logging untuk API yang membawa data personal. Tentukan:

```text
field yang boleh dilog
field yang harus di-redact
ukuran maksimum
sampling rule
retention rule
approval rule untuk debug mode
```

### Latihan 5 — gRPC Streaming Metrics

Untuk bidi stream worker, desain metrics:

```text
active_streams
messages_in/out
ack latency
resume success/failure
slow consumer
cancellation
deadline exceeded
flow control blocked
```

---

## 39. Ringkasan Mental Model

Network observability yang matang harus menjawab:

```text
Who called whom?
What operation?
Which attempt?
Which phase?
How long?
What failed?
Who cancelled?
Was it retried?
Was side effect possible?
Was duplicate suppressed?
Which resource saturated?
Which layer generated the error?
What should operator do next?
```

Logs memberi detail kejadian. Metrics memberi tren dan alert. Traces memberi path dan causality. Wire debugging memberi bukti saat aplikasi tidak cukup.

Engineer top-tier tidak hanya menambahkan telemetry. Ia mendesain sistem agar setiap failure bisa **diinterpretasi**.

---

## 40. Checklist Singkat Sebelum Lanjut

Pastikan kamu bisa menjelaskan:

```text
[ ] Bedanya trace id, correlation id, request id, operation id, idempotency key.
[ ] Kenapa average latency berbahaya.
[ ] Kenapa pool pending bisa membuat dependency terlihat lambat.
[ ] Bagaimana retry harus terlihat dalam trace/metrics/logs.
[ ] Apa saja metrics outbound HTTP minimum.
[ ] Apa saja metrics gRPC minimum.
[ ] Kapan perlu wire debugging.
[ ] Kenapa payload logging harus sangat dibatasi.
[ ] Bagaimana context propagation bekerja di HTTP dan gRPC.
[ ] Bagaimana observability mendukung auditability di sistem case-management.
```

---

## 41. Status Seri

```text
Part 28 of 35 selesai.
Seri belum selesai.
Part berikutnya: Part 29 — Performance Engineering: Latency, Throughput, Tail Latency, Allocation, GC, and Kernel Effects
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 27 — Backpressure, Rate Limiting, Bulkhead, Circuit Breaker, and Adaptive Protection](./027-backpressure-rate-limiting-bulkhead-circuit-breaker-adaptive-protection.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 29 — Performance Engineering: Latency, Throughput, Tail Latency, Allocation, GC, and Kernel Effects](./029-performance-engineering-latency-throughput-tail-latency-allocation-gc-kernel-effects.md)

</div>