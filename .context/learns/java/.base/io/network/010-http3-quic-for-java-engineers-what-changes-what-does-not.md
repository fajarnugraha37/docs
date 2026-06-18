# Part 10 — HTTP/3 and QUIC for Java Engineers: What Changes, What Does Not

> Seri: `learn-java-io-network-http-grpc-protocol-engineering`  
> File: `010-http3-quic-for-java-engineers-what-changes-what-does-not.md`  
> Scope Java: Java 8 sampai Java 25, dengan catatan evolusi menuju Java 26 untuk HTTP/3  
> Status: Advanced orientation + production mental model

---

## 1. Tujuan Bagian Ini

HTTP/3 sering dijelaskan secara dangkal sebagai:

> “HTTP over QUIC, bukan TCP.”

Itu benar, tetapi belum cukup untuk software engineer yang harus mendesain, mengoperasikan, dan men-debug sistem produksi.

Tujuan bagian ini adalah memahami HTTP/3 dan QUIC dari sudut pandang Java backend engineer:

1. Apa yang benar-benar berubah dibanding HTTP/1.1 dan HTTP/2.
2. Apa yang tetap sama karena HTTP semantics tetap HTTP.
3. Mengapa QUIC berjalan di atas UDP, tetapi tetap menyediakan reliability.
4. Mengapa HTTP/3 mengurangi beberapa problem HTTP/2, tetapi membuat beberapa problem baru.
5. Apa dampaknya terhadap Java `HttpClient`, Netty, gateway, load balancer, observability, security, dan troubleshooting.
6. Kapan HTTP/3 relevan untuk backend Java, dan kapan hanya menambah kompleksitas.

Bagian ini bukan tutorial membuat HTTP/3 server dari nol. Fokusnya adalah mental model dan production reasoning.

---

## 2. Ringkasan Singkat

HTTP/3 adalah mapping HTTP semantics di atas QUIC transport. HTTP semantics seperti method, status code, header meaning, cacheability, dan resource model tetap mengacu ke HTTP modern. Yang berubah adalah transport layer-nya.

HTTP/1.1:

```text
HTTP semantics
  -> textual HTTP/1.1 messages
  -> TCP
  -> optional TLS
```

HTTP/2:

```text
HTTP semantics
  -> binary frames, streams, HPACK
  -> TCP
  -> TLS in common deployment
```

HTTP/3:

```text
HTTP semantics
  -> HTTP/3 frames, streams, QPACK
  -> QUIC
  -> UDP
  -> IP
```

QUIC sendiri menggabungkan beberapa fungsi yang sebelumnya tersebar di TCP + TLS + HTTP/2 stream management:

```text
QUIC provides:
- encrypted transport
- stream multiplexing
- per-stream flow control
- connection-level flow control
- loss recovery
- congestion control
- connection IDs
- connection migration
- faster handshake possibilities
```

HTTP/3 bukan sekadar “HTTP/2 di UDP”. HTTP/3 memindahkan banyak tanggung jawab stream multiplexing dari HTTP/2-over-TCP ke QUIC.

---

## 3. Kenapa HTTP/3 Ada?

HTTP/2 sudah memperbaiki banyak problem HTTP/1.1:

- satu connection bisa membawa banyak concurrent stream;
- header compression;
- binary framing;
- lebih efisien daripada banyak TCP connection HTTP/1.1;
- cocok untuk gRPC.

Namun HTTP/2 tetap berjalan di atas TCP.

TCP memberi reliability pada level connection. Ini berarti semua byte di connection TCP harus diterima berurutan. Kalau satu packet hilang, delivery byte setelah packet tersebut tertahan, walaupun byte tersebut milik HTTP/2 stream lain.

Inilah yang sering disebut TCP-level head-of-line blocking.

Di HTTP/2:

```text
Stream A frame
Stream B frame
Stream C frame
       |
       v
single TCP byte stream
       |
       v
packet loss at TCP layer blocks later bytes for all streams
```

HTTP/2 menghilangkan head-of-line blocking pada level application request queue, tetapi tidak menghilangkan head-of-line blocking pada level TCP packet delivery.

HTTP/3 mencoba mengatasi ini dengan QUIC stream multiplexing di atas UDP:

```text
HTTP/3 stream A -> QUIC stream A
HTTP/3 stream B -> QUIC stream B
HTTP/3 stream C -> QUIC stream C
                         |
                         v
                       UDP datagrams
```

Kalau packet yang membawa data stream A hilang, stream B dan C tidak harus menunggu data stream A, selama datagram untuk B dan C sudah diterima dan bisa didekripsi/dirakit.

Mental model penting:

> HTTP/3 tidak menghapus packet loss. HTTP/3 mengubah scope dampak packet loss dari connection-wide ordered byte stream menjadi stream-aware recovery.

---

## 4. Yang Tetap Sama: HTTP Semantics

Sebelum terlalu kagum dengan QUIC, ingat bahwa HTTP/3 tetap HTTP.

Yang tetap sama:

- `GET` tetap safe secara semantic.
- `PUT` tetap idempotent secara semantic.
- `POST` tetap tidak otomatis idempotent.
- `Cache-Control` tetap bermakna.
- `ETag` dan conditional request tetap berlaku.
- `Content-Type` dan `Accept` tetap contract.
- `401`, `403`, `404`, `409`, `412`, `429`, `500`, `502`, `503`, `504` tetap perlu dimaknai dengan benar.
- retry tetap harus memperhatikan idempotency.
- observability tetap butuh correlation ID, span, metrics, dan logs.
- payload compatibility tetap penting.
- security tetap butuh validation, authorization, rate limiting, dan payload limits.

HTTP/3 tidak memperbaiki desain API yang buruk.

Kalau API memiliki masalah seperti ini:

```text
POST /submitPayment
without idempotency key
with vague 500 response
with no deadline
with no duplicate suppression
with no correlation ID
```

Maka HTTP/3 tidak membuatnya aman.

Transport modern tidak menggantikan protocol semantics yang benar.

---

## 5. Yang Berubah: Transport Model

Perubahan besar HTTP/3 ada pada transport.

HTTP/2 over TCP:

```text
application
HTTP/2 frames
TLS records
TCP stream
IP packets
```

HTTP/3 over QUIC:

```text
application
HTTP/3 frames
QUIC streams
QUIC packets encrypted with TLS 1.3 mechanisms
UDP datagrams
IP packets
```

Konsekuensinya besar.

### 5.1 Connection Establishment

HTTP/1.1 + TLS over TCP biasanya membutuhkan:

```text
TCP handshake
TLS handshake
HTTP request
```

HTTP/2 over TLS juga memerlukan TCP + TLS, dengan ALPN untuk memilih `h2`.

HTTP/3 menggunakan QUIC, yang mengintegrasikan TLS 1.3 handshake ke transport handshake.

Simplified model:

```text
client -> server: QUIC initial packet with TLS handshake data
server -> client: QUIC response with TLS handshake data
client -> server: encrypted HTTP/3 request after handshake progress
```

Dalam kondisi tertentu, QUIC bisa mengurangi setup latency dibanding TCP + TLS. Namun ini bukan magic. Benefit tergantung network path, RTT, server support, client cache, certificate state, dan apakah connection baru sering dibuat.

Jika aplikasi backend menggunakan long-lived pooled connections, handshake latency mungkin bukan bottleneck utama.

### 5.2 Multiplexing

HTTP/2 multiplexing terjadi di HTTP/2 layer, tetapi semua frame masuk ke satu TCP stream.

HTTP/3 multiplexing terjadi dengan QUIC streams.

HTTP/3 stream:

```text
independent logical byte stream managed by QUIC
```

Ini membuat loss recovery lebih granular.

### 5.3 Flow Control

HTTP/2 memiliki stream-level dan connection-level flow control.

HTTP/3 juga memiliki flow control, tetapi flow control tersebut dikelola oleh QUIC transport untuk QUIC streams dan connection.

Implikasinya untuk Java engineer tetap sama secara prinsip:

```text
if producer is faster than consumer,
something must buffer, block, drop, or fail.
```

HTTP/3 tidak menghapus backpressure.

### 5.4 Connection Identity

TCP connection diidentifikasi oleh 4-tuple:

```text
source IP, source port, destination IP, destination port
```

Jika client pindah network dari Wi-Fi ke mobile network, TCP connection biasanya putus karena 4-tuple berubah.

QUIC menggunakan connection ID, sehingga secara desain dapat mendukung connection migration.

Ini sangat berguna untuk mobile/client-side internet scenario.

Untuk backend service-to-service di Kubernetes atau data center, connection migration biasanya bukan alasan utama adopsi HTTP/3.

### 5.5 Encryption Is Mandatory in Practice

HTTP/3 relies on QUIC. QUIC integrates TLS 1.3-based security. Secara praktis, HTTP/3 adalah encrypted transport.

Dampaknya:

- middlebox tidak bisa menginspeksi transport detail seperti TCP plaintext;
- observability harus bergeser ke endpoint telemetry;
- packet capture lebih sulit dibaca;
- debugging harus lebih mengandalkan logs, traces, metrics, dan qlog-like telemetry jika tersedia.

---

## 6. QUIC Bukan “UDP Tanpa Reliability”

Banyak engineer mendengar “HTTP/3 over UDP” lalu menyimpulkan:

> “Berarti tidak reliable dong?”

Ini salah.

UDP hanya menyediakan datagram delivery tanpa reliability. QUIC memakai UDP sebagai substrate, lalu membangun reliability sendiri di atasnya.

QUIC menyediakan:

- packet numbering;
- acknowledgements;
- loss detection;
- retransmission;
- congestion control;
- stream ordering;
- flow control;
- cryptographic protection;
- connection management.

Mental model:

```text
UDP = carrier for datagrams
QUIC = reliable, encrypted, multiplexed transport implemented above UDP
HTTP/3 = HTTP mapping over QUIC
```

Jadi HTTP/3 bukan unreliable HTTP.

Tetapi karena ia memakai UDP, operational path-nya berbeda:

- firewall bisa memblokir UDP;
- enterprise proxy bisa tidak mendukung UDP QUIC;
- load balancer harus mendukung QUIC/HTTP/3;
- network monitoring berbasis TCP connection tidak cukup;
- NAT behavior menjadi lebih penting;
- fallback ke HTTP/2 atau HTTP/1.1 tetap perlu.

---

## 7. HTTP/2 vs HTTP/3: Perbandingan Mental Model

| Aspek | HTTP/2 | HTTP/3 |
|---|---|---|
| Transport | TCP | QUIC over UDP |
| Encryption | Umumnya TLS | Integrated via QUIC/TLS 1.3 mechanisms |
| Multiplexing | HTTP/2 streams over one TCP stream | QUIC streams |
| Packet loss impact | Can block all streams at TCP delivery layer | More isolated per stream |
| Header compression | HPACK | QPACK |
| Connection migration | Not native | Native concept via connection IDs |
| Middlebox compatibility | High, because TCP/TLS common | More variable due to UDP/QUIC |
| Debugging | TCP/TLS tooling familiar | Requires QUIC-aware tooling/endpoint telemetry |
| Java support up to Java 25 | JDK `HttpClient` supports HTTP/1.1 and HTTP/2 | Not in Java 25 JDK `HttpClient` |
| Java support beyond 25 | HTTP/2 stable | JEP 517 targets HTTP/3 support in JDK 26 |

Important nuance:

> HTTP/3 is not automatically faster than HTTP/2 for every backend workload.

It may help more when:

- network latency is high;
- packet loss exists;
- client frequently creates new connections;
- mobile network migration matters;
- many independent streams share one connection;
- edge/client internet traffic dominates.

It may not help much when:

- backend services run in same region/VPC/data center;
- connections are long-lived and stable;
- packet loss is low;
- bottleneck is application CPU/database/remote service;
- gateway/load balancer does not support HTTP/3 end-to-end;
- observability and operational maturity are not ready.

---

## 8. HTTP/3 in Java 8–25: Practical Reality

For this series, the declared Java range is 8 to 25.

This matters because Java’s built-in `java.net.http.HttpClient` in Java 25 supports preferred protocol versions HTTP/1.1 and HTTP/2, not HTTP/3. HTTP/3 support is targeted by JEP 517 for the HTTP Client API in JDK 26.

Therefore, for Java 8–25, practical HTTP/3 options are usually:

1. terminate HTTP/3 at edge/gateway/load balancer, then use HTTP/1.1 or HTTP/2 to Java service;
2. use specialized libraries or incubating ecosystem support;
3. use Netty incubator QUIC/HTTP3 components where appropriate;
4. avoid direct HTTP/3 in application code unless there is a strong requirement and operational maturity.

Common production architecture:

```text
Internet client
  -> CDN / edge / load balancer supporting HTTP/3
  -> internal HTTP/2 or HTTP/1.1
  -> Java service
```

This architecture still gives browser/mobile clients HTTP/3 benefits at the edge while keeping internal Java service simpler.

For service-to-service Java backend:

```text
Java service A
  -> HTTP/2 or gRPC over HTTP/2
  -> Java service B
```

This remains common and often more operationally mature.

---

## 9. Netty and HTTP/3/QUIC Ecosystem

Netty is a major Java networking framework used by many high-performance stacks, including gRPC Java’s Netty transport.

For QUIC/HTTP/3, Netty has incubator projects:

```text
netty-incubator-codec-quic
netty-incubator-codec-http3
```

The word “incubator” matters.

It means:

- API maturity may differ from core Netty;
- operational behavior should be validated carefully;
- platform-specific native dependencies may matter;
- dependency upgrades need extra caution;
- production adoption should be justified by actual requirements.

A top-tier engineer does not adopt HTTP/3 because it sounds modern. They ask:

```text
What user-visible or system-visible problem are we solving?
Can the edge solve it?
Do we need end-to-end HTTP/3?
Do our gateways support it?
Can we observe it?
Can we test loss, fallback, UDP blocking, and migration?
Can we operate it during incident?
```

---

## 10. HTTP/3 Endpoint Discovery

HTTP/1.1 and HTTP/2 commonly use:

```text
https://example.com
```

The client connects to TCP port 443, negotiates TLS, and ALPN may select `h2` or `http/1.1`.

HTTP/3 uses QUIC over UDP, commonly also port 443.

But the client needs to know the server supports HTTP/3.

Common discovery mechanisms include:

- Alt-Svc header;
- DNS HTTPS/SVCB records in modern ecosystems;
- client configuration;
- cached knowledge from prior connection.

Simplified Alt-Svc model:

```http
Alt-Svc: h3=":443"; ma=86400
```

Meaning:

```text
This origin is also available via HTTP/3 on UDP port 443.
```

Operational implication:

- first request may use HTTP/2 or HTTP/1.1;
- client learns HTTP/3 availability;
- later requests may try HTTP/3;
- if UDP/QUIC fails, fallback must work.

This matters because HTTP/3 deployment is often incremental.

---

## 11. Header Compression: HPACK vs QPACK

HTTP/2 uses HPACK.

HTTP/3 uses QPACK.

Why not reuse HPACK?

Because HPACK has ordering assumptions tied to HTTP/2 over ordered delivery. In QUIC, independent streams can arrive independently. Header compression must avoid creating cross-stream blocking problems.

QPACK is designed for HTTP/3’s stream model.

Practical lesson:

> Header compression is not a license to send huge headers.

Bad header discipline remains bad:

```text
large JWT in every request
large cookie header
many tracing baggage values
unbounded custom metadata
oversized idempotency metadata
```

Consequences:

- larger packets;
- more CPU;
- higher memory pressure;
- header table pressure;
- gateway rejection;
- harder debugging;
- worse tail latency.

Production rule:

```text
Treat headers as control metadata, not payload storage.
```

---

## 12. HTTP/3 and gRPC

gRPC is strongly associated with HTTP/2.

Classic gRPC Java uses HTTP/2 semantics:

```text
protobuf messages
-> gRPC framing
-> HTTP/2 streams
-> transport such as Netty
```

There is ongoing ecosystem work around gRPC over newer transports, but for production Java systems today, gRPC over HTTP/2 remains the mature default.

Do not assume:

```text
gRPC Java automatically means HTTP/3
```

When designing Java service-to-service communication, the practical default remains:

```text
REST/HTTP over HTTP/1.1 or HTTP/2
or
gRPC over HTTP/2
```

HTTP/3 may be relevant at edge or specialized client scenarios before it becomes a standard internal backend default.

---

## 13. Timeout, Retry, and Deadline in HTTP/3

HTTP/3 changes transport mechanics, but timeout engineering remains essential.

You still need:

```text
DNS timeout / resolution budget
connect / handshake budget
request deadline
body write timeout
response header timeout
response body timeout
idle timeout
retry budget
overall operation deadline
```

QUIC can improve handshake behavior and loss isolation, but it does not remove:

- remote overload;
- dependency slowness;
- overloaded event loop;
- application queueing;
- database contention;
- service mesh retry storm;
- client retry amplification;
- bad timeout hierarchy.

Retry logic still needs semantic safety.

Unsafe:

```text
Retry all POST requests on timeout.
```

Safer:

```text
Retry only if:
- operation is idempotent, or
- idempotency key is present, and
- server supports duplicate suppression, and
- retry budget is available, and
- deadline has enough remaining time.
```

Transport improvement does not remove distributed systems laws.

---

## 14. Load Balancer and Gateway Implications

HTTP/3 requires infrastructure support.

For HTTP/1.1 and HTTP/2 over TCP/TLS, many gateways are mature.

For HTTP/3:

```text
client
  -> UDP/443
  -> QUIC-capable edge/load balancer
  -> HTTP/3 termination or pass-through
```

Questions you must ask:

1. Does the load balancer support HTTP/3?
2. Does it terminate QUIC or pass it through?
3. If it terminates, what protocol is used upstream?
4. Are headers preserved correctly?
5. How are client IP and scheme represented?
6. Are `Alt-Svc` and HTTPS/SVCB records configured correctly?
7. What happens when UDP is blocked?
8. What metrics exist for QUIC handshake, fallback, loss, migration, stream reset?
9. Are idle timeout and max stream settings known?
10. Can incident responders distinguish HTTP/3 edge failure from Java backend failure?

Common deployment:

```text
Browser/mobile client
  -> HTTP/3 to CDN/edge
  -> HTTP/2 to gateway
  -> HTTP/1.1 or HTTP/2 to Java service
```

This is not “fake HTTP/3”. It is normal layered deployment.

But it means Java service may not directly see HTTP/3.

---

## 15. Observability Changes

HTTP/3 makes some traditional debugging harder.

With TCP-based HTTP, engineers often inspect:

```text
TCP connection states
SYN/SYN-ACK behavior
TLS handshake
packet retransmission
connection reset
TIME_WAIT/CLOSE_WAIT
```

With QUIC:

- transport is encrypted;
- UDP datagrams do not expose stream semantics plainly;
- connection IDs replace simple TCP 4-tuple thinking;
- packet capture is less directly readable;
- middlebox visibility is reduced.

Therefore endpoint observability becomes more important.

You need metrics like:

```text
http3_requests_total
http3_request_duration_seconds
quic_handshake_duration
quic_connection_attempts
quic_connection_failures
quic_fallback_to_http2_total
quic_packet_loss_estimate
quic_stream_resets_total
quic_idle_timeout_total
quic_migration_events_total
alt_svc_advertised_total
```

Even if names differ by implementation, the dimensions matter.

Useful dimensions:

```text
protocol = http/1.1 | h2 | h3
transport = tcp | quic
remote_origin
status_code
error_kind
fallback_reason
network_family = ipv4 | ipv6
edge_location
client_platform
```

For Java services behind an edge, you may only see upstream HTTP/1.1 or HTTP/2. In that case, edge observability and backend observability must be correlated.

---

## 16. Security Considerations

HTTP/3 inherits many HTTP risks:

- broken authentication;
- broken authorization;
- request smuggling-style parser inconsistencies at gateways;
- header abuse;
- oversized payload;
- decompression bomb;
- SSRF;
- unsafe redirect;
- weak rate limiting;
- sensitive log leakage.

QUIC/HTTP/3 adds operational security concerns:

- UDP amplification protection;
- QUIC-specific DoS surface;
- server resource exhaustion through many streams/connections;
- difficulty of network inspection;
- middlebox compatibility gaps;
- fallback downgrade behavior;
- inconsistent edge/backend protocol handling.

Important principle:

```text
Security controls should not depend on one protocol layer only.
```

You still need:

```text
edge rate limiting
application authorization
payload size limits
header size limits
request deadline
stream limit
connection limit
authentication token validation
structured audit logging
safe error response
```

HTTP/3 can improve transport security properties, but it does not replace application security.

---

## 17. Performance Model

HTTP/3 performance is context-dependent.

Potential gains:

- fewer round trips for connection establishment;
- better behavior under some packet loss scenarios;
- reduced cross-stream blocking compared to HTTP/2 over TCP;
- connection migration for mobile clients;
- improved user experience at internet edge.

Potential costs:

- CPU overhead of user-space transport implementation;
- less mature tooling;
- UDP path blocking or throttling;
- gateway complexity;
- different load balancer behavior;
- harder packet-level debugging;
- operational learning curve.

Performance question should be framed as:

```text
Which latency component are we trying to reduce?
```

Examples:

| Bottleneck | Will HTTP/3 help? |
|---|---|
| Database query p99 is 3 seconds | No, not directly |
| Remote service is overloaded | No, not directly |
| Client is mobile with frequent network change | Potentially yes |
| High RTT internet clients create many new connections | Potentially yes |
| Packet loss causes HTTP/2 stream interference | Potentially yes |
| Java app has connection pool starvation | Not directly |
| Payload is huge and consumer is slow | Not magically |
| Gateway has bad timeout config | No |

Top-tier reasoning:

> Do not benchmark HTTP/3 in isolation. Benchmark the full path and isolate the latency component.

---

## 18. Java Design Implications

For Java 8–25, you typically design with protocol abstraction.

Do not scatter protocol assumptions across business code.

Bad:

```java
// Business code knows too much about the transport.
if (useHttp3) {
    // special branch everywhere
}
```

Better:

```text
Domain service
  -> outbound port/interface
  -> protocol client adapter
  -> transport implementation
```

Example architecture:

```text
Application service
  -> CustomerDirectoryClient interface
      -> HttpCustomerDirectoryClient
          -> resilient transport wrapper
              -> JDK HttpClient / Apache / OkHttp / Netty
```

Your application should depend on semantic contract:

```java
public interface CustomerDirectoryClient {
    CustomerSnapshot getCustomer(CustomerId id, Deadline deadline);
}
```

The adapter owns:

- URL/origin;
- HTTP version preference;
- timeout;
- retry;
- header mapping;
- serialization;
- status code mapping;
- metrics;
- tracing;
- fallback;
- circuit breaker;
- connection lifecycle.

This makes future HTTP/3 adoption possible without rewriting domain code.

---

## 19. HTTP Version Negotiation Strategy

A production-grade client should often think in preference order, not hard-coded ideology.

Example strategy:

```text
Prefer h3 when supported and enabled.
Fallback to h2 when QUIC unavailable.
Fallback to http/1.1 if necessary.
```

But fallback is not free.

You need to know:

- how long to wait before fallback;
- whether fallback doubles request attempts;
- whether request body is replayable;
- whether operation is idempotent;
- whether deadline remains valid;
- how to record fallback in telemetry.

Danger:

```text
Attempt HTTP/3.
It hangs for too long.
Fallback to HTTP/2.
Retry request.
Overall user deadline already exceeded.
Server may receive duplicate request.
```

Safer model:

```text
overall deadline = 2 seconds
protocol attempt budget is part of that deadline
fallback allowed only if request is replayable or not yet sent semantically
fallback reason is logged/metric-tagged
```

---

## 20. Failure Taxonomy

HTTP/3 introduces familiar-looking failures with different causes.

### 20.1 UDP Blocked

Symptom:

```text
HTTP/3 unavailable, HTTP/2 works
```

Possible cause:

```text
firewall blocks UDP/443
enterprise network blocks QUIC
load balancer not listening on UDP
NAT issue
```

Response:

```text
fallback to HTTP/2
measure fallback rate
avoid treating as backend application failure
```

### 20.2 QUIC Handshake Failure

Symptom:

```text
connection establishment fails before HTTP response
```

Possible cause:

```text
certificate issue
ALPN/protocol mismatch
server QUIC config error
version negotiation issue
UDP path issue
```

### 20.3 Stream Reset

Symptom:

```text
one request fails while other streams on same connection may continue
```

Possible cause:

```text
server cancels stream
client deadline exceeded
flow control violation
application abort
gateway reset
```

### 20.4 Connection Idle Timeout

Symptom:

```text
reused connection fails after idle period
```

Possible cause:

```text
edge idle timeout
client idle timeout mismatch
NAT mapping expired
server closed connection
```

### 20.5 Flow Control Stall

Symptom:

```text
stream stops progressing without CPU spike
```

Possible cause:

```text
receiver not reading
window exhausted
application backpressure ignored
large stream blocks connection-level capacity
```

### 20.6 Fallback Storm

Symptom:

```text
many clients try h3, fail, then fallback to h2, causing duplicate connection pressure
```

Possible cause:

```text
bad HTTP/3 rollout
UDP partial outage
edge config issue
no controlled ramp
```

---

## 21. Production Rollout Strategy

HTTP/3 rollout should be controlled.

Suggested stages:

### Stage 1 — Edge-only Experiment

```text
Enable HTTP/3 at CDN/edge for small traffic percentage.
Keep upstream protocol unchanged.
Measure h3 success/fallback/latency.
```

### Stage 2 — Client Segment Rollout

```text
Enable for selected user agents, regions, or beta clients.
Monitor UDP failure rate and protocol distribution.
```

### Stage 3 — Operational Drill

Test:

```text
UDP blocked
QUIC handshake failure
HTTP/3 disabled at edge
fallback to HTTP/2
certificate rotation
packet loss simulation
high concurrent streams
large response
slow client
```

### Stage 4 — Wider Rollout

Only after:

```text
dashboards exist
alerts exist
fallback works
incident playbook exists
customer impact is measured
rollback is easy
```

### Stage 5 — Evaluate End-to-End Need

Ask whether Java services need direct HTTP/3.

For many systems, the answer remains:

```text
No. Edge HTTP/3 is enough.
```

---

## 22. Decision Matrix: Should My Java Backend Adopt HTTP/3 Directly?

| Question | If yes | If no |
|---|---|---|
| Are clients internet/mobile-facing? | HTTP/3 may help at edge | Less urgent |
| Is packet loss/high RTT a bottleneck? | Consider experiment | HTTP/3 unlikely primary fix |
| Do you control both client and server? | Easier to test | Harder rollout |
| Does infrastructure support UDP/QUIC? | Possible | Stop or use edge termination |
| Do you have QUIC observability? | Safer | Risky |
| Is Java 8–25 built-in client enough? | Not for direct HTTP/3 | Use HTTP/1.1/2 or external stack |
| Is service-to-service internal? | Usually HTTP/2/gRPC enough | HTTP/3 likely unnecessary |
| Do you need connection migration? | HTTP/3 useful | Less relevant |
| Can you tolerate library maturity risk? | Evaluate Netty incubator/etc. | Avoid direct adoption |

Rule of thumb:

```text
Adopt HTTP/3 at the edge before adopting it inside Java services.
```

---

## 23. Mental Model for Top 1% Engineers

A top-tier engineer does not think:

```text
HTTP/3 is newer, therefore better.
```

They think:

```text
HTTP/3 changes the transport failure domain.
Which failure domain hurts us today?
Can we observe it?
Can we roll it out safely?
Can we fallback safely?
Does it improve user-visible behavior enough to justify complexity?
```

They separate:

```text
Protocol semantics
Transport mechanics
Runtime implementation
Infrastructure path
Operational maturity
Business risk
```

They know HTTP/3 can improve important things, but only when the bottleneck matches its strengths.

---

## 24. Example Architecture: Edge HTTP/3, Java HTTP/2 Upstream

```text
Mobile/browser clients
    |
    | HTTP/3 over QUIC/UDP
    v
CDN / Edge / Load Balancer
    |
    | HTTP/2 over TLS/TCP
    v
API Gateway
    |
    | HTTP/1.1 or HTTP/2
    v
Java service
    |
    | JDBC / Redis / gRPC / HTTP clients
    v
Dependencies
```

Benefits:

- client gets HTTP/3 where useful;
- Java service remains on mature protocol;
- edge absorbs UDP/QUIC complexity;
- backend observability remains familiar;
- rollout and rollback are easier.

Risk:

- if edge hides protocol details, backend team may misdiagnose client-side HTTP/3 issues as application issues;
- need cross-layer telemetry.

Required headers/metadata:

```text
request id
traceparent
client protocol at edge if available
forwarded client IP
forwarded scheme
edge location
fallback indicator if available
```

---

## 25. Example Failure Walkthrough

Incident:

```text
Some mobile users report intermittent slowness.
Backend Java p95 is normal.
Gateway p95 is normal.
CDN shows increased HTTP/3 fallback to HTTP/2 in one region.
```

Weak diagnosis:

```text
Backend is fine, ignore it.
```

Better diagnosis:

```text
The problem is probably before backend.
Check QUIC handshake failure rate, UDP path, edge region, ISP pattern, client version, Alt-Svc config, and fallback latency.
```

Possible finding:

```text
A regional network path is blocking or degrading UDP/443.
Clients attempt HTTP/3, wait, fallback to HTTP/2, causing user-visible delay.
```

Mitigation:

```text
Disable HTTP/3 advertisement for affected edge region or reduce HTTP/3 attempt timeout.
Continue serving HTTP/2.
Monitor fallback recovery.
```

Lesson:

```text
Backend latency metrics alone cannot explain edge transport failures.
```

---

## 26. Anti-Patterns

### Anti-Pattern 1 — Adopting HTTP/3 Without a Bottleneck

```text
We enabled HTTP/3 because it is modern.
```

Better:

```text
We enabled HTTP/3 for mobile clients because handshake latency and network migration contribute to p95 user latency.
```

### Anti-Pattern 2 — No Fallback Strategy

```text
Force HTTP/3 only.
```

Better:

```text
Prefer HTTP/3, fallback to HTTP/2 under bounded deadline, and measure fallback reason.
```

### Anti-Pattern 3 — Debugging HTTP/3 Like TCP

```text
Check TIME_WAIT and TCP reset only.
```

Better:

```text
Check QUIC handshake, stream reset, connection ID, UDP path, fallback, and endpoint telemetry.
```

### Anti-Pattern 4 — Thinking HTTP/3 Fixes Application Slowness

```text
Our database is slow, maybe HTTP/3 fixes latency.
```

Better:

```text
Fix database/query/contention. HTTP/3 only affects transport path.
```

### Anti-Pattern 5 — Huge Headers Because Compression Exists

```text
Put large JWT, baggage, and metadata in every request.
```

Better:

```text
Keep headers bounded and intentional. Compression does not remove CPU/memory/security cost.
```

---

## 27. Checklist for HTTP/3 Readiness

### 27.1 Technical Readiness

```text
[ ] Edge/load balancer supports HTTP/3.
[ ] UDP/443 path is allowed.
[ ] TLS/certificate setup supports QUIC.
[ ] ALPN/protocol negotiation works.
[ ] Alt-Svc or HTTPS/SVCB discovery is configured intentionally.
[ ] Fallback to HTTP/2 works.
[ ] Large request/response behavior tested.
[ ] Slow client behavior tested.
[ ] Packet loss behavior tested.
[ ] Idle timeout behavior tested.
```

### 27.2 Application Readiness

```text
[ ] APIs have correct HTTP semantics.
[ ] Non-idempotent operations use idempotency key where retry/fallback can duplicate.
[ ] Deadlines are propagated.
[ ] Retry budget exists.
[ ] Payload and header size limits exist.
[ ] Correlation ID and trace context are propagated.
[ ] Error model is stable.
```

### 27.3 Observability Readiness

```text
[ ] Metrics include protocol version.
[ ] Metrics include fallback rate.
[ ] Metrics distinguish edge failure from backend failure.
[ ] Logs include request ID and protocol metadata where possible.
[ ] Traces connect client, edge, gateway, and backend.
[ ] Dashboards exist before rollout.
[ ] Alerts avoid blaming Java backend for edge-only failures.
```

### 27.4 Operational Readiness

```text
[ ] Rollout can be scoped by region/user/client.
[ ] Rollback is fast.
[ ] Incident playbook exists.
[ ] Support team understands fallback symptoms.
[ ] Security team reviewed UDP/QUIC exposure.
[ ] Load test includes HTTP/3 path.
```

---

## 28. Exercises

### Exercise 1 — Explain HTTP/3 to a Backend Team

Write a one-page explanation that answers:

```text
What problem does HTTP/3 solve?
What problem does it not solve?
Why is HTTP/3 over UDP still reliable?
Why might we terminate HTTP/3 at the edge only?
```

### Exercise 2 — Design a Rollout Plan

Design a rollout plan for enabling HTTP/3 on a public API used by mobile clients.

Include:

```text
traffic percentage
regions
metrics
fallback
rollback
security review
load test
incident response
```

### Exercise 3 — Diagnose a Fallback Spike

Scenario:

```text
HTTP/3 fallback to HTTP/2 jumps from 2% to 35% in one country.
Backend Java latency is normal.
Error rate is normal.
Users report slower first request.
```

Answer:

```text
What do you check first?
What dashboards do you need?
What mitigation do you apply?
Why is backend not necessarily the cause?
```

### Exercise 4 — Decide Direct Java Adoption

You own an internal Java microservice platform in one AWS region. Services communicate via gRPC over HTTP/2. Packet loss is negligible. Most latency comes from database and downstream APIs.

Should you introduce HTTP/3 service-to-service?

Explain with trade-offs.

---

## 29. Key Takeaways

1. HTTP/3 maps HTTP semantics over QUIC.
2. QUIC runs over UDP but provides reliable, encrypted, multiplexed transport.
3. HTTP/3 reduces TCP-level head-of-line blocking compared to HTTP/2 over TCP.
4. HTTP semantics remain the same: method safety, idempotency, caching, status codes, and error models still matter.
5. HTTP/3 does not fix bad API design, slow databases, overloaded services, or unsafe retries.
6. Java 8–25 built-in `HttpClient` does not provide direct HTTP/3 support; JEP 517 targets HTTP/3 support in JDK 26.
7. For many Java backend systems, HTTP/3 at the edge with HTTP/2/HTTP/1.1 upstream is the pragmatic architecture.
8. HTTP/3 increases the importance of endpoint observability because QUIC transport is encrypted and UDP-based.
9. Direct HTTP/3 adoption in Java should be driven by measured bottlenecks, not novelty.
10. A top-tier engineer evaluates protocol semantics, transport mechanics, infrastructure support, observability, fallback, and business impact together.

---

## 30. How This Prepares the Next Parts

The next parts move from protocol families into concrete Java HTTP client choices and production usage.

After this part, you should be able to reason about:

```text
HTTP/1.1 vs HTTP/2 vs HTTP/3
TCP vs QUIC
edge termination vs end-to-end protocol
Java 8–25 constraints
transport failure vs application failure
observability requirements before adoption
```

Next:

```text
Part 11 — Java HTTP Clients Across Generations: HttpURLConnection, Apache HttpClient, OkHttp, Netty, Spring, and JDK HttpClient
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 9 — HTTP/2 Deep Dive: Streams, Frames, Multiplexing, HPACK, Flow Control, and Prioritization](./009-http2-deep-dive-streams-frames-multiplexing-hpack-flow-control-prioritization.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 11 — Java HTTP Clients Across Generations: `HttpURLConnection`, Apache HttpClient, OkHttp, Netty, Spring, and JDK `HttpClient`](./011-java-http-clients-across-generations-httpurlconnection-apache-okhttp-netty-spring-jdk-httpclient.md)

</div>