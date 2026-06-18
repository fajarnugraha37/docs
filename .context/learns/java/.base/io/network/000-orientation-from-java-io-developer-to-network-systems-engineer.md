# Part 0 — Orientation: From Java I/O Developer to Network Systems Engineer

**Series:** `learn-java-io-network-http-grpc-protocol-engineering`  
**File:** `000-orientation-from-java-io-developer-to-network-systems-engineer.md`  
**Target Java:** Java 8 → Java 25  
**Level:** Advanced / Production Engineering / Top 1% Track  

---

## 0. Executive Summary

Seri ini bukan lagi tentang “bagaimana cara memanggil HTTP API dari Java”, “bagaimana membuat socket”, atau “bagaimana membuat endpoint REST”. Itu sudah berada di level implementasi permukaan.

Seri ini membahas **networked software engineering**: bagaimana program Java berkomunikasi dengan sistem lain melalui jaringan, bagaimana protokol bekerja, bagaimana failure muncul, bagaimana latency terbentuk, bagaimana reliability dijaga, bagaimana observability dibuat, bagaimana contract berevolusi, dan bagaimana keputusan teknis pada level client/server/network/protocol memengaruhi production behavior.

Seorang engineer yang hanya memahami API akan berpikir seperti ini:

```java
HttpResponse<String> response = client.send(request, BodyHandlers.ofString());
```

Seorang network systems engineer akan bertanya:

1. Apakah DNS resolution bisa stale?
2. Apakah connection pool sudah warm?
3. Apakah TLS handshake terjadi pada request ini?
4. Apakah HTTP/1.1 atau HTTP/2?
5. Apakah request ini idempotent jika retry terjadi?
6. Apakah timeout mencakup DNS, connect, TLS, pool acquisition, request body upload, response headers, dan response body read?
7. Apakah deadline dari caller dipropagasikan ke dependency?
8. Apakah retry budget bisa menyebabkan retry storm?
9. Apakah load balancer idle timeout lebih kecil dari client keep-alive TTL?
10. Apakah payload aman dari decompression bomb, SSRF, dan request smuggling?
11. Apakah p99 latency memburuk karena pool queue, GC, kernel buffer, packet loss, atau remote saturation?
12. Apakah metric dan trace cukup untuk membuktikan sumber masalah?

Perbedaan levelnya sangat besar. Seri ini bertujuan membawa cara berpikir dari **Java API consumer** menjadi **engineer yang memahami distributed communication as a system**.

---

## 1. Why This Series Exists

Di banyak sistem enterprise, komunikasi antar-service sering terlihat sederhana:

```text
Service A  --->  Service B
```

Pada kenyataannya, path production bisa seperti ini:

```text
Java method
  -> serializer
  -> HTTP/gRPC client
  -> connection pool
  -> DNS resolver
  -> TLS engine
  -> TCP socket
  -> kernel socket buffer
  -> node network stack
  -> container network
  -> Kubernetes service / CoreDNS
  -> service mesh sidecar
  -> ingress / egress proxy
  -> cloud load balancer
  -> WAF / API gateway
  -> reverse proxy
  -> remote server accept queue
  -> remote thread/event loop
  -> remote application handler
  -> database/cache/message broker
  -> response path back
```

Maka ketika terjadi error seperti:

```text
java.net.SocketTimeoutException: Read timed out
io.grpc.StatusRuntimeException: DEADLINE_EXCEEDED
java.net.ConnectException: Connection refused
javax.net.ssl.SSLHandshakeException
java.net.UnknownHostException
HTTP 502 / 503 / 504
Connection reset by peer
Premature EOF
Broken pipe
```

error tersebut bukan sekadar “network issue”. Itu adalah gejala dari sistem komunikasi yang memiliki banyak layer. Top 1% engineer tidak berhenti pada label generik. Ia memetakan failure ke layer, state, resource, dan invariant yang dilanggar.

---

## 2. Scope Seri Ini

Seri ini membahas **Java network communication** dari sudut pandang:

- protocol design,
- client engineering,
- server transport behavior,
- HTTP/1.1, HTTP/2, HTTP/3 concept,
- gRPC,
- TCP behavior,
- DNS,
- TLS/mTLS,
- proxy/load balancer/service mesh,
- timeout/retry/deadline,
- connection pooling,
- streaming,
- backpressure,
- observability,
- security,
- performance,
- testing,
- production incident diagnosis,
- architecture pattern untuk communication layer.

Seri ini mencakup Java 8 sampai Java 25. Artinya kita akan sering membandingkan beberapa generasi pendekatan:

```text
Java 8 era:
  - HttpURLConnection
  - Apache HttpClient
  - OkHttp
  - Netty
  - CompletableFuture terbatas penggunaannya untuk HTTP client modern
  - thread pool dan blocking I/O masih dominan

Java 11+ era:
  - java.net.http.HttpClient
  - HTTP/2 support bawaan JDK
  - WebSocket API bawaan JDK

Java 21+ era:
  - virtual threads
  - perubahan strategi blocking I/O
  - structured concurrency preview/incubation path menuju model concurrency yang lebih terstruktur

Java 25 era:
  - JDK modern dengan java.net.http tetap relevan
  - structured concurrency tersedia sebagai API preview di Java 25
  - cara berpikir deadline, cancellation, dan task lifetime semakin penting
```

Catatan penting: versi Java modern bisa membuat blocking I/O lebih murah dari sisi thread, terutama dengan virtual threads. Tetapi **virtual threads tidak membuat network menjadi murah**. Remote service tetap lambat, connection pool tetap terbatas, DNS tetap bisa gagal, TLS tetap butuh handshake, bandwidth tetap finite, dan downstream tetap bisa overload.

---

## 3. What This Series Will Not Repeat

Karena sebelumnya kamu sudah mempelajari banyak fondasi Java, seri ini sengaja tidak mengulang materi berikut secara dasar:

- dasar `InputStream`, `OutputStream`, `Reader`, `Writer`,
- dasar `File`, `Path`, `Files`, `FileChannel`,
- dasar `Socket` dan `ServerSocket`,
- dasar NIO `ByteBuffer`, `Channel`, `Selector`,
- dasar HTTP endpoint dengan servlet/JAX-RS,
- dasar JSON/XML/SOAP,
- dasar security/cryptography,
- dasar concurrency Java,
- dasar testing/benchmarking/JVM performance,
- dasar Jakarta EE runtime,
- dasar authentication/authorization.

Namun, seri ini akan memakai semua fondasi tersebut sebagai bahan bakar untuk pembahasan yang lebih dalam.

Contoh: kita tidak akan mengulang “apa itu `ByteBuffer`”. Tetapi kita akan membahas kenapa pemahaman buffer penting ketika menganalisis:

- large payload download,
- direct buffer pressure,
- Netty `ByteBuf` leak,
- slow consumer,
- TLS packetization,
- zero-copy transfer,
- GC pressure akibat buffering response body terlalu besar.

Contoh lain: kita tidak akan mengulang “apa itu REST endpoint”. Tetapi kita akan membahas:

- kapan HTTP status code menjadi bagian dari distributed contract,
- kapan `POST` boleh di-retry,
- bagaimana idempotency key mencegah duplicate side effect,
- bagaimana `ETag` dan conditional request mencegah lost update,
- bagaimana API gateway/proxy mengubah failure semantics.

---

## 4. Target Outcome: What “Top 1%” Means in This Context

Istilah “top 1%” mudah disalahpahami. Dalam konteks seri ini, itu bukan berarti hafal semua class Java networking. Bukan juga berarti selalu memakai teknologi paling baru.

Top-tier engineer dalam networked Java systems memiliki kombinasi kemampuan berikut:

### 4.1 Bisa Melihat Call sebagai System, Bukan Method

Pemula melihat:

```text
call API -> dapat response
```

Engineer kuat melihat:

```text
caller intent
  -> contract
  -> serialization
  -> queueing
  -> DNS
  -> connection acquisition
  -> TCP/TLS/session state
  -> protocol framing
  -> remote execution
  -> response streaming
  -> error mapping
  -> retry/cancellation
  -> observability evidence
```

Top-tier engineer melihat tambahan:

```text
What are the invariants?
What is the failure domain?
Who owns the timeout budget?
Is the operation idempotent?
Can retries amplify an outage?
Which metrics prove the bottleneck?
Can this incident recur after mitigation?
What operational control should exist?
```

### 4.2 Bisa Mendesain Communication Layer yang Aman Dipakai Banyak Tim

Banyak organisasi memiliki masalah serupa:

- setiap service membuat HTTP client sendiri,
- timeout tidak konsisten,
- retry liar,
- correlation id hilang,
- error model tidak seragam,
- metric tidak standar,
- TLS config tersebar,
- logging payload bocor PII,
- dependency overload karena caller tidak punya rate limit,
- production incident sulit dianalisis.

Top-tier engineer tidak hanya memperbaiki satu call. Ia membuat **communication platform pattern**:

```text
Typed client SDK
  + central timeout policy
  + retry budget
  + idempotency guard
  + circuit breaker
  + rate limiter
  + bulkhead
  + OpenTelemetry spans
  + structured logs
  + safe error taxonomy
  + TLS/mTLS policy
  + contract tests
  + failure playbook
```

### 4.3 Bisa Menjelaskan Failure dengan Bukti

Contoh laporan lemah:

```text
API lambat karena network issue.
```

Contoh laporan kuat:

```text
p99 latency naik dari 250 ms ke 4.8 s sejak 10:05.
Client-side connection pool pending acquisition naik dari 0 ke 180.
Active connections sudah mencapai max per route 50.
Remote service p95 processing time tetap 180 ms.
Tidak ada kenaikan TLS handshake time atau DNS error.
Artinya bottleneck utama ada di client-side pool saturation, kemungkinan akibat traffic spike + idle connection eviction.
Mitigasi cepat: naikkan max per route ke 150, turunkan request timeout dari 10s ke 3s, tambahkan queue timeout 200ms, dan aktifkan load shedding untuk non-critical calls.
Follow-up: pisahkan pool critical/non-critical dan tambahkan metric pool pending acquisition.
```

Perbedaannya adalah observability, causal reasoning, dan operational control.

---

## 5. The Core Mental Model: Every Network Call Is a Distributed Transaction Attempt

Bukan transaksi database ACID, tetapi “attempt” untuk membuat perubahan atau membaca state dari sistem lain melalui medium tidak sempurna.

Sebuah network call selalu melibatkan:

```text
Intent
Contract
Encoding
Transport
Execution
Response
Interpretation
Side effect
Evidence
```

Mari uraikan.

### 5.1 Intent

Apa tujuan call?

- read data,
- create resource,
- update state,
- trigger process,
- send notification,
- reserve capacity,
- validate identity,
- synchronize data,
- stream event,
- transfer file.

Intent menentukan apakah call aman di-retry, perlu idempotency key, perlu ordering, atau perlu audit trail.

### 5.2 Contract

Contract bukan hanya URL atau `.proto` file. Contract mencakup:

- request schema,
- response schema,
- status/error semantics,
- timeout expectation,
- idempotency rule,
- ordering guarantee,
- pagination rule,
- version compatibility,
- authentication requirement,
- rate limit,
- side effect,
- privacy/security boundary,
- deprecation policy.

Tanpa contract eksplisit, client dan server akan membuat asumsi sendiri. Asumsi yang tidak sama adalah sumber incident.

### 5.3 Encoding

Data harus diubah menjadi bytes:

```text
Java object -> JSON/XML/Protobuf/etc -> bytes -> frames/chunks -> packets
```

Encoding memengaruhi:

- payload size,
- CPU cost,
- GC pressure,
- schema evolution,
- compatibility,
- precision,
- timezone handling,
- security risk,
- debugging experience.

### 5.4 Transport

Transport adalah medium komunikasi:

- TCP socket,
- TLS over TCP,
- HTTP/1.1,
- HTTP/2,
- gRPC over HTTP/2,
- WebSocket,
- HTTP/3 over QUIC,
- proxy-mediated transport,
- service mesh mediated transport.

Transport menentukan:

- connection model,
- multiplexing,
- flow control,
- head-of-line blocking,
- connection reuse,
- keepalive,
- reset/cancellation behavior,
- visibility dari error.

### 5.5 Execution

Remote service harus mengeksekusi request. Di sini muncul:

- queueing,
- thread pool saturation,
- event loop blocking,
- database pool exhaustion,
- lock contention,
- cache miss,
- remote retry,
- downstream dependency failure.

Client sering hanya melihat `timeout` atau `503`, padahal akar masalah ada di execution path remote.

### 5.6 Response

Response bukan hanya body. Response mencakup:

- status code,
- headers,
- trailers untuk gRPC,
- partial body,
- streaming chunks,
- close signal,
- reset stream,
- connection close,
- timeout before response,
- timeout during response,
- cancellation.

### 5.7 Interpretation

Client harus menerjemahkan response menjadi keputusan:

- success,
- business failure,
- validation failure,
- authentication failure,
- authorization failure,
- retryable technical failure,
- non-retryable technical failure,
- ambiguous result,
- partial success.

Ambiguous result adalah salah satu konsep paling penting. Misalnya client timeout setelah mengirim request `POST`. Apakah server memprosesnya? Belum tentu diketahui. Jika operation tidak idempotent, retry bisa menggandakan side effect.

### 5.8 Side Effect

Network call bisa memiliki side effect:

- create order,
- debit balance,
- send email,
- update workflow state,
- submit case,
- assign officer,
- publish event,
- generate report,
- archive document.

Side effect menuntut desain:

- idempotency,
- deduplication,
- correlation id,
- audit trail,
- compensation,
- exactly-once illusion handling,
- reconciliation.

### 5.9 Evidence

Production-grade system harus bisa menjawab:

```text
What happened?
Where did it happen?
When did it happen?
Which request/user/case/entity was affected?
Was the dependency called?
Did the dependency receive it?
Did it process it?
Did it reply?
Was the reply lost?
Was it retried?
Was there duplicate side effect?
```

Evidence berasal dari:

- structured logs,
- correlation id,
- distributed traces,
- metrics,
- audit events,
- access logs,
- network logs,
- client pool metrics,
- gateway logs,
- server logs,
- database traces.

---

## 6. The Network Call Lifecycle

Sebuah HTTP/gRPC call dari Java biasanya melewati lifecycle seperti ini:

```text
1. Build request
2. Serialize request body
3. Resolve destination name
4. Acquire connection from pool or create new connection
5. Establish TCP connection if needed
6. Perform TLS handshake if needed
7. Negotiate protocol if needed, e.g. ALPN for HTTP/2
8. Write request headers
9. Write request body
10. Flush bytes to socket
11. Remote receives request
12. Remote queues/dispatches request
13. Remote executes application logic
14. Remote writes response headers
15. Remote writes response body/trailers
16. Client reads response
17. Client deserializes body
18. Client maps result/error
19. Client releases/reuses/closes connection
20. Client records logs/metrics/traces
```

Each phase has different failure modes.

### 6.1 Failure Matrix

| Phase | Typical Failure | Example Symptom | Better Question |
|---|---|---|---|
| Build request | invalid URI/header/body | `IllegalArgumentException` | Is invalid input caught before network? |
| Serialize | serialization error / huge payload | CPU spike / OOM | Is payload bounded and streamable? |
| DNS | unknown/stale host | `UnknownHostException` | What is JVM/OS DNS cache behavior? |
| Pool acquire | pool exhausted | timeout before connect | Do we measure pending acquisition? |
| TCP connect | refused / timeout | `ConnectException` | Is remote listening and reachable? |
| TLS | cert/protocol mismatch | `SSLHandshakeException` | Is trust chain/SNI/ALPN correct? |
| Write | broken pipe / reset | `IOException` | Did remote close idle connection? |
| Remote queue | overload | 503/504/timeout | Is server saturated before handler? |
| Remote execution | slow dependency | read timeout | Which downstream caused delay? |
| Response read | slow/partial body | timeout mid-body | Is response streaming or buffered? |
| Decode | invalid schema | parse error | Is contract backward-compatible? |
| Interpret | wrong retry/error mapping | duplicate side effect | Is error taxonomy explicit? |
| Release | leak/stale connection | pool starvation | Are responses always consumed/closed? |
| Observe | missing trace/log | unknown root cause | Can we prove the path? |

Top-tier engineering begins when this matrix becomes instinctive.

---

## 7. The Three Planes of Network Engineering

Untuk menguasai topik ini, pikirkan networked application dalam tiga plane:

```text
Data Plane
Control Plane
Evidence Plane
```

### 7.1 Data Plane

Data plane adalah jalur request/response aktual.

Contoh:

```text
Service A sends HTTP POST to Service B.
Service B returns HTTP 201.
```

Pertanyaan data plane:

- Bagaimana bytes bergerak?
- Protocol apa yang dipakai?
- Bagaimana connection reuse?
- Bagaimana streaming dan buffering?
- Bagaimana flow control?
- Apa yang terjadi jika consumer lambat?

### 7.2 Control Plane

Control plane mengatur perilaku komunikasi.

Contoh:

- timeout,
- retry policy,
- circuit breaker,
- rate limit,
- service discovery,
- load balancing,
- TLS certificate rotation,
- traffic routing,
- feature flag,
- blue/green/canary,
- mTLS identity.

Pertanyaan control plane:

- Siapa menentukan endpoint?
- Siapa menentukan policy retry?
- Siapa memutus circuit?
- Siapa mengubah traffic route?
- Siapa memaksa deadline?
- Siapa mencegah overload?

### 7.3 Evidence Plane

Evidence plane menjawab apa yang terjadi.

Contoh:

- logs,
- metrics,
- traces,
- audit trail,
- access logs,
- gateway logs,
- client instrumentation,
- server instrumentation,
- packet capture bila perlu.

Pertanyaan evidence plane:

- Dapatkah kita melihat connect time?
- Dapatkah kita melihat pool wait time?
- Dapatkah kita membedakan remote processing time vs network time?
- Dapatkah kita menemukan request yang sama di client, gateway, server, dan database?
- Dapatkah kita membuktikan retry terjadi berapa kali?

Banyak engineer hanya membangun data plane. Engineer yang matang membangun ketiganya.

---

## 8. Java Version Timeline: What Changes from Java 8 to Java 25

### 8.1 Java 8 Baseline

Java 8 masih sangat umum di enterprise legacy. Network programming Java 8 biasanya memakai:

- `java.net.HttpURLConnection`,
- Apache HttpClient,
- OkHttp,
- Netty,
- Jersey/RESTEasy client,
- Spring `RestTemplate`,
- raw socket/NIO untuk use case khusus,
- gRPC Java via external library,
- CompletableFuture untuk async composition, tetapi belum ada JDK HTTP client modern.

Karakter umum:

```text
Blocking I/O + thread pool + external HTTP client library
```

Risiko umum:

- timeout tidak lengkap,
- connection pool default tidak dipahami,
- no deadline propagation,
- retry manual tidak aman,
- metrics minim,
- TLS config tersebar,
- thread pool exhaustion.

### 8.2 Java 11+ Shift

Java 11 memperkenalkan `java.net.http.HttpClient` sebagai HTTP/WebSocket API standard JDK. Client ini dapat dikonfigurasi melalui builder, bersifat immutable setelah dibuat, dapat dipakai untuk banyak request, dan mendukung preferensi HTTP/1.1 atau HTTP/2.

Implikasi:

- tidak selalu perlu third-party client untuk use case umum,
- HTTP/2 tersedia di JDK,
- sync dan async API tersedia,
- `CompletableFuture` menjadi bagian natural dari request async,
- body handler/publisher memberi model lebih eksplisit untuk request/response body.

Namun JDK `HttpClient` bukan silver bullet. Untuk beberapa kebutuhan seperti observability mendalam, advanced connection pool tuning, interceptors ecosystem, atau integration dengan framework tertentu, library lain tetap relevan.

### 8.3 Java 17 LTS Reality

Java 17 menjadi baseline modern di banyak sistem enterprise. Pada level network engineering, Java 17 sering berarti:

- JDK `HttpClient` sudah mature untuk banyak use case,
- framework modern seperti Spring Boot 3 mulai mendorong Java 17+,
- TLS/security baseline lebih modern,
- containerized deployment lebih umum,
- observability via OpenTelemetry makin lazim.

### 8.4 Java 21+ Virtual Threads

Virtual threads mengubah trade-off antara blocking dan async. Banyak kode yang sebelumnya harus dibuat reactive/event-loop demi scalability bisa kembali memakai style blocking yang lebih mudah dibaca, dengan catatan:

```text
Virtual threads reduce thread scalability cost.
They do not remove network, pool, remote, bandwidth, and backpressure constraints.
```

Artinya:

- blocking call bisa lebih scalable dari sisi thread,
- tetapi connection pool tetap harus dibatasi,
- downstream tetap harus dilindungi,
- timeout tetap wajib,
- cancellation tetap penting,
- observability tetap harus dibuat,
- event loop tetap tidak boleh diblok.

### 8.5 Java 25 and Structured Concurrency

Java 25 documentation menjelaskan structured concurrency sebagai model di mana satu task dapat memecah pekerjaan menjadi beberapa subtask yang hidup dalam satu scope; subtask harus selesai sebelum task utama berlanjut. Ini relevan untuk network fan-out, misalnya satu request perlu memanggil tiga dependency paralel.

Mental model lama:

```text
Start several CompletableFutures.
Hope cancellation/error handling is correct.
```

Mental model structured:

```text
A request opens a concurrency scope.
All dependency calls belong to that scope.
If one fails or deadline expires, the scope has explicit cancellation semantics.
The parent request does not outlive orphan subtasks.
```

Ini sangat penting dalam network systems karena orphan request dapat menyebabkan:

- wasted traffic,
- duplicate work,
- stale writes,
- hidden load,
- confusing traces,
- resource leak.

---

## 9. Core Principle: Blocking vs Non-Blocking Is Not the Real Question

Banyak diskusi Java networking berhenti pada:

```text
Blocking vs non-blocking?
Reactive vs imperative?
Netty vs Servlet?
Virtual threads vs event loop?
```

Pertanyaan yang lebih baik:

```text
What is the workload shape?
Where is the bottleneck?
What resource must be protected?
What failure semantics do we need?
What concurrency model makes cancellation and backpressure correct?
```

### 9.1 Blocking Model

Blocking model mudah dipahami:

```java
Response response = client.call(request);
```

Kelebihan:

- kode linear,
- mudah di-debug,
- cocok dengan virtual threads,
- cocok untuk request-response sederhana,
- error handling lebih langsung.

Risiko:

- thread pool exhaustion jika memakai platform thread lama,
- blocking di event loop bisa fatal,
- tanpa timeout bisa menggantung,
- tanpa backpressure bisa overload downstream.

### 9.2 Async/Future Model

Async model umum:

```java
CompletableFuture<Response> future = client.callAsync(request);
```

Kelebihan:

- tidak memblok caller thread,
- cocok untuk fan-out,
- bisa compose pipeline,
- cocok untuk high concurrency.

Risiko:

- error propagation kompleks,
- cancellation sering salah,
- context propagation sulit,
- stack trace sulit,
- orphan future mudah terjadi,
- timeout sering hanya ditempel di ujung, bukan deadline end-to-end.

### 9.3 Event Loop Model

Event loop model dipakai oleh Netty dan banyak runtime high-performance.

Kelebihan:

- scalable untuk banyak connection,
- overhead thread rendah,
- cocok untuk streaming dan protocol server,
- kontrol detail atas buffer dan pipeline.

Risiko:

- blocking kecil bisa merusak latency banyak connection,
- reference counting buffer rawan leak,
- mental model lebih sulit,
- debugging butuh skill khusus.

### 9.4 Reactive Streams Model

Reactive streams memodelkan asynchronous stream dengan backpressure.

Kelebihan:

- cocok untuk stream data,
- backpressure explicit,
- composition powerful,
- cocok untuk high-volume pipeline.

Risiko:

- overkill untuk CRUD simple,
- operator chain sulit dibaca,
- error/cancellation/debugging kompleks,
- context propagation perlu disiplin.

### 9.5 Virtual Thread Model

Virtual thread memungkinkan style blocking dengan scalability lebih baik.

Kelebihan:

- kode sederhana,
- cocok untuk I/O-bound service,
- mengurangi kebutuhan reactive untuk sekadar scalability thread,
- bagus untuk request-response synchronous style.

Risiko:

- tidak boleh mengabaikan pool/deadline/backpressure,
- tidak otomatis memperbaiki driver/library yang pinning atau blocking native tertentu,
- tidak membuat remote service lebih cepat,
- bisa membuat overload lebih mudah jika concurrency tidak dibatasi.

### 9.6 Decision Heuristic

Gunakan prinsip berikut:

| Situation | Prefer |
|---|---|
| Simple request-response, Java 21+, I/O-bound | Virtual threads + blocking style |
| Java 8/11 legacy, moderate concurrency | Mature blocking client + bounded thread pool |
| High connection count server/proxy/protocol gateway | Netty/event-loop |
| Streaming pipeline with backpressure | Reactive streams / Netty / gRPC streaming manual flow control |
| Android gRPC client | OkHttp transport |
| General gRPC backend | Netty transport |
| Need maximal framework integration | Framework-native client with instrumentation |

Rule paling penting:

```text
Choose the model that makes correctness visible.
```

Bukan model yang terlihat paling modern.

---

## 10. The Five Budgets of Network Engineering

Setiap networked system memiliki budget. Jika budget tidak didefinisikan, production akan mendefinisikannya dengan outage.

### 10.1 Time Budget

Time budget menjawab:

```text
How long may this operation take end-to-end?
```

Contoh:

```text
User-facing request budget: 2 seconds
  - API gateway overhead: 100 ms
  - service A validation: 100 ms
  - dependency B: 400 ms
  - dependency C: 500 ms
  - DB work: 500 ms
  - safety margin: 400 ms
```

Tanpa time budget, setiap dependency bisa memakai timeout default 30 detik, lalu satu request menggantung terlalu lama.

### 10.2 Retry Budget

Retry budget menjawab:

```text
How much additional traffic are we allowed to create during failure?
```

Retry tanpa budget bisa membuat outage makin parah.

Contoh buruk:

```text
1000 rps normal traffic
Each request retries 3 times immediately
Downstream receives up to 4000 rps during incident
```

Contoh lebih baik:

```text
Retry only idempotent operations
Max 1 retry for selected transient errors
Exponential backoff + jitter
Global retry budget: retry traffic <= 10% of original traffic
No retry when circuit open
No retry when deadline nearly exhausted
```

### 10.3 Connection Budget

Connection budget menjawab:

```text
How many concurrent connections may we hold to each dependency?
```

Terlalu kecil:

- pool queue naik,
- latency naik,
- timeout sebelum request terkirim.

Terlalu besar:

- downstream overload,
- load balancer pressure,
- TLS handshake storm,
- file descriptor exhaustion,
- ephemeral port exhaustion.

### 10.4 Memory Budget

Network I/O sering diam-diam menghabiskan memory:

- buffering request body,
- buffering response body,
- large JSON parse tree,
- compression/decompression buffer,
- direct buffer,
- Netty pooled buffer,
- pending async response,
- queued retry.

Rule penting:

```text
Never let unbounded remote data become unbounded local memory.
```

### 10.5 Error Budget

Error budget menjawab:

```text
How much failure can the system tolerate while still meeting reliability expectations?
```

Ini memengaruhi:

- fallback,
- graceful degradation,
- alerting threshold,
- retry aggressiveness,
- circuit breaker sensitivity,
- SLA/SLO design,
- incident response.

---

## 11. The Eight Invariants of Production-Grade Network Calls

Setiap network call penting sebaiknya memiliki invariant berikut.

### 11.1 Every Call Has a Timeout

Tidak boleh ada call tanpa timeout.

Namun “timeout” harus spesifik:

- DNS timeout,
- connect timeout,
- TLS handshake timeout,
- pool acquisition timeout,
- request write timeout,
- response header timeout,
- response body read timeout,
- total deadline.

Tidak semua library mengekspos semua timeout secara eksplisit. Karena itu engineer perlu memahami gap library yang dipakai.

### 11.2 Every Call Has an Ownership Boundary

Siapa pemilik call?

- user request,
- scheduled job,
- batch worker,
- message consumer,
- async workflow,
- admin operation.

Ownership menentukan:

- timeout,
- priority,
- retry,
- cancellation,
- observability,
- audit.

### 11.3 Every Side-Effecting Call Has Idempotency Strategy

Untuk operasi yang mengubah state, harus ada strategi:

- idempotency key,
- natural unique constraint,
- deduplication table,
- request id,
- operation id,
- outbox pattern,
- reconciliation job.

Tanpa ini, retry adalah risiko.

### 11.4 Every Client Has Bounded Concurrency

Jangan biarkan caller membuat infinite concurrent calls.

Batas bisa berupa:

- connection pool size,
- semaphore,
- rate limiter,
- bulkhead,
- queue limit,
- worker pool size,
- max in-flight request.

### 11.5 Every Dependency Has a Failure Policy

Untuk setiap dependency, definisikan:

```text
If it is slow, what do we do?
If it fails, what do we do?
If it returns invalid data, what do we do?
If it partially succeeds, what do we do?
If it is down for 1 hour, what do we do?
```

### 11.6 Every Error Is Classified

Minimal error taxonomy:

```text
Success
Business rejection
Validation error
Authentication error
Authorization error
Rate limited
Retryable transient technical error
Non-retryable technical error
Ambiguous result
Partial success
Dependency unavailable
Caller cancelled
Deadline exceeded
```

Error taxonomy buruk akan membuat retry, alerting, dan user message salah.

### 11.7 Every Call Is Observable

Minimal evidence:

- dependency name,
- operation name,
- method/path or RPC method,
- status/error class,
- duration,
- timeout/deadline,
- retry count,
- request size,
- response size,
- correlation/trace id,
- pool metrics for important clients.

### 11.8 Every Contract Evolves Safely

Network contract harus bisa berubah tanpa memecahkan semua client.

Prinsip:

- additive changes first,
- avoid changing meaning of existing field,
- tolerate unknown fields where format supports it,
- version when semantic break is unavoidable,
- deprecate before remove,
- test consumer compatibility,
- document error semantics.

---

## 12. A Practical Maturity Model

### Level 0 — API Caller

Ciri:

- bisa memakai HTTP client,
- bisa parse JSON,
- bisa handle status 200/400/500,
- timeout mungkin default,
- retry mungkin manual.

Risiko:

- production behavior tidak dipahami,
- diagnosis lambat,
- failure sering disebut “network issue”.

### Level 1 — Library User

Ciri:

- tahu Apache HttpClient/OkHttp/JDK HttpClient,
- tahu connection pool,
- tahu connect/read timeout,
- tahu basic retry.

Risiko:

- belum memikirkan deadline end-to-end,
- retry belum idempotent-aware,
- observability belum konsisten.

### Level 2 — Service Communicator

Ciri:

- punya typed client,
- punya timeout policy,
- punya error mapping,
- punya logging/metrics,
- punya contract test.

Risiko:

- policy mungkin masih per-service,
- resilience belum adaptif,
- incident diagnosis masih terbatas.

### Level 3 — Distributed Systems Engineer

Ciri:

- memahami DNS/TCP/TLS/HTTP/gRPC,
- bisa desain retry/deadline/bulkhead,
- bisa menganalisis p99 latency,
- bisa membaca trace end-to-end,
- bisa membuat failure playbook,
- bisa desain idempotency.

### Level 4 — Network Platform Engineer

Ciri:

- membuat communication platform reusable,
- menetapkan policy linting/governance,
- membuat client SDK standard,
- membuat observability standard,
- membuat incident taxonomy,
- mengintegrasikan service mesh/gateway/TLS/cert rotation,
- mengontrol reliability secara organisasi.

Target seri ini adalah membawa kamu minimal ke Level 3 dan memberi fondasi menuju Level 4.

---

## 13. HTTP vs gRPC vs WebSocket vs Messaging: Do Not Treat Them as Fashion Choices

### 13.1 HTTP/REST-ish

Cocok untuk:

- public API,
- resource-oriented API,
- browser compatibility,
- human-debuggable contract,
- simple request-response,
- wide tooling support,
- integration dengan external parties.

Risiko:

- over/under-fetching,
- loose schema discipline,
- inconsistent error model,
- manual client generation,
- difficult streaming semantics,
- JSON payload overhead.

### 13.2 gRPC

Cocok untuk:

- internal service-to-service,
- strongly typed contract,
- low-latency RPC,
- streaming,
- polyglot generated clients,
- HTTP/2 multiplexing,
- contract-first design.

Risiko:

- browser/public API friction,
- debugging lebih sulit tanpa tooling,
- proxy/gateway compatibility harus dipahami,
- HTTP/2 flow control bisa menjadi bottleneck tersembunyi,
- error semantics harus dipetakan ke domain.

### 13.3 WebSocket

Cocok untuk:

- bidirectional long-lived connection,
- realtime UI,
- push update,
- collaborative interaction,
- low-latency event delivery.

Risiko:

- session ownership,
- horizontal scaling,
- sticky routing,
- reconnect storm,
- backpressure,
- connection lifecycle management,
- message ordering.

### 13.4 Messaging

Cocok untuk:

- asynchronous workflow,
- decoupling,
- buffering spikes,
- event-driven architecture,
- background processing,
- eventual consistency.

Risiko:

- duplicate message,
- ordering issue,
- poison message,
- delayed visibility,
- harder request-response UX,
- operational complexity.

### 13.5 Decision Matrix

| Need | Better Fit |
|---|---|
| Public external API | HTTP/REST-ish |
| Internal low-latency typed RPC | gRPC |
| Realtime bidirectional UI | WebSocket |
| Async durable workflow | Messaging |
| Large file transfer | HTTP streaming/object storage pattern |
| Server-to-browser one-way updates | SSE or WebSocket |
| Cross-organization integration | HTTP with explicit contract and auth |
| High-volume internal streaming | gRPC streaming or messaging, depending durability |

The best engineer does not ask “which is cooler?” but:

```text
What communication semantics does the business operation need?
```

---

## 14. The Most Important Distinction: Transport Failure vs Business Failure

A common mistake is mixing these two categories.

### 14.1 Business Failure

Business failure means the remote system successfully understood and processed the request but rejected it for domain reasons.

Examples:

```text
Insufficient balance
Invalid case status transition
Applicant not eligible
Document already submitted
User not authorized for this case
Quota exceeded by business rule
```

These are usually not retryable.

### 14.2 Transport/Technical Failure

Technical failure means the communication or remote execution failed outside the domain decision.

Examples:

```text
DNS failure
Connection timeout
TLS handshake failure
HTTP 503
HTTP 504
Connection reset
gRPC UNAVAILABLE
Deadline exceeded
Malformed response
```

Some are retryable, some are not, and some are ambiguous.

### 14.3 Ambiguous Failure

Ambiguous failure is the dangerous middle:

```text
Client sent request.
Client timed out before receiving response.
Server may or may not have processed it.
```

For read operation, ambiguity is usually tolerable.

For write operation, ambiguity is dangerous:

```text
Create payment
Submit application
Send email
Approve case
Generate license
Publish legal notice
```

Solution requires idempotency/reconciliation, not blind retry.

---

## 15. A Better Vocabulary for Network Failures

Replace vague language with precise categories.

### Bad Vocabulary

```text
Network issue
API issue
Timeout issue
Intermittent issue
Server issue
Connection issue
```

### Better Vocabulary

```text
DNS resolution failed
DNS returned stale endpoint
TCP connect timed out
TCP connection refused
TLS certificate chain invalid
TLS hostname verification failed
ALPN negotiation failed
HTTP/2 stream reset by peer
Connection pool acquisition timed out
Remote accepted connection but did not send response headers before deadline
Response body read timed out after partial response
Client retried non-idempotent operation
Load balancer closed idle connection before client reused it
gRPC deadline exceeded before server handler completed
Netty event loop blocked by synchronous database call
```

Precise vocabulary accelerates diagnosis and prevents wrong mitigation.

---

## 16. The Production Path Is Usually Not Symmetric

Engineers often assume request and response take the same path. In modern infrastructure, that may be false.

Possible asymmetries:

- DNS result differs by environment,
- egress proxy only applies outbound,
- ingress gateway terminates TLS,
- service mesh sidecar re-encrypts traffic,
- load balancer retries idempotent-looking requests,
- CDN caches only some responses,
- HTTP/2 connection multiplexes many streams,
- NAT gateway affects outbound port exhaustion,
- firewall state expires idle flows,
- backend closes idle connection earlier than client,
- response compression changes CPU and latency.

Therefore, “it works from my laptop” proves very little.

Better question:

```text
From which runtime identity, node, subnet, proxy path, DNS resolver, TLS truststore, and policy context does it work?
```

---

## 17. Java Networking Is Not Just Java

A Java network problem often involves non-Java layers.

### 17.1 JVM Layer

- thread model,
- heap/direct memory,
- GC,
- JIT warm-up,
- TLS provider,
- truststore,
- DNS cache,
- HTTP client implementation,
- connection pool,
- classpath/library versions.

### 17.2 OS Layer

- file descriptor limit,
- ephemeral port range,
- TCP keepalive,
- socket buffer,
- TIME_WAIT,
- DNS resolver config,
- kernel TCP settings.

### 17.3 Container/Kubernetes Layer

- pod IP,
- service DNS,
- CoreDNS,
- kube-proxy/eBPF,
- NetworkPolicy,
- sidecar proxy,
- resource limit,
- CPU throttling,
- liveness/readiness behavior.

### 17.4 Cloud/Infra Layer

- load balancer,
- NAT gateway,
- security group,
- route table,
- WAF,
- private link,
- certificate manager,
- DNS hosted zone.

### 17.5 Application Layer

- contract,
- timeout,
- retry,
- serialization,
- auth,
- authorization,
- domain state,
- database/cache dependency.

Top-tier Java engineer can cross these layers without pretending to be a full-time network admin. The skill is knowing enough to localize the problem and ask the right next question.

---

## 18. How to Read Network Client Code Like a Senior Engineer

When reviewing HTTP/gRPC client code, do not start with syntax. Start with operational questions.

### 18.1 Basic Review Questions

```text
What dependency is being called?
What operation is being performed?
Is it read-only or side-effecting?
What is the timeout?
Is timeout per-attempt or total deadline?
Can it retry?
If retry, is the operation idempotent?
What errors are mapped to business vs technical?
Is response body bounded or streamed?
Is the client reused or recreated per request?
Is connection pooling configured?
Are logs/metrics/traces emitted?
Is authentication handled safely?
Are secrets logged?
```

### 18.2 Advanced Review Questions

```text
What happens if DNS returns a stale IP?
What happens if remote accepts connection but never responds?
What happens if TLS certificate rotates?
What happens if LB closes idle connection?
What happens if response body is 2 GB?
What happens if server sends malformed JSON?
What happens if client times out but server commits the operation?
What happens if 1000 requests concurrently call this dependency?
What happens if dependency becomes 10x slower?
What happens if trace context is missing?
What happens if proxy returns 502 with HTML body?
What happens if retry happens after caller already cancelled?
```

If code cannot answer these questions, it is not production-ready yet.

---

## 19. Example: A Naive HTTP Client and Its Hidden Risks

### 19.1 Naive Code

```java
public UserProfile fetchProfile(String userId) throws Exception {
    HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create("https://profile-service/users/" + userId))
        .GET()
        .build();

    HttpResponse<String> response = HttpClient.newHttpClient()
        .send(request, HttpResponse.BodyHandlers.ofString());

    if (response.statusCode() == 200) {
        return objectMapper.readValue(response.body(), UserProfile.class);
    }

    throw new RuntimeException("Failed: " + response.statusCode());
}
```

This code may work in development. But production questions emerge immediately.

### 19.2 Problems

```text
1. Creates new HttpClient per call.
2. No explicit connect timeout.
3. No request timeout/deadline.
4. No bounded response size.
5. No error taxonomy.
6. No correlation id.
7. No metrics.
8. No retry policy for safe transient failure.
9. No authentication handling shown.
10. No URI encoding for userId.
11. No distinction between 404 business absence and 503 dependency failure.
12. No handling for interrupted/cancelled request.
13. No protection against dependency slowness.
```

### 19.3 Better Shape

This is not final production code, but it shows better shape:

```java
public final class ProfileClient {
    private final HttpClient httpClient;
    private final ObjectMapper objectMapper;
    private final URI baseUri;

    public ProfileClient(HttpClient httpClient, ObjectMapper objectMapper, URI baseUri) {
        this.httpClient = Objects.requireNonNull(httpClient);
        this.objectMapper = Objects.requireNonNull(objectMapper);
        this.baseUri = Objects.requireNonNull(baseUri);
    }

    public ProfileResult fetchProfile(String userId, Duration deadlineRemaining, String correlationId)
            throws DependencyException {

        URI uri = baseUri.resolve("/users/" + URLEncoder.encode(userId, StandardCharsets.UTF_8));

        HttpRequest request = HttpRequest.newBuilder()
            .uri(uri)
            .timeout(min(deadlineRemaining, Duration.ofMillis(500)))
            .header("Accept", "application/json")
            .header("X-Correlation-Id", correlationId)
            .GET()
            .build();

        long startNanos = System.nanoTime();

        try {
            HttpResponse<String> response = httpClient.send(
                request,
                HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)
            );

            long durationMillis = Duration.ofNanos(System.nanoTime() - startNanos).toMillis();
            recordMetric("profile.fetch.duration", durationMillis, response.statusCode());

            return mapResponse(response);
        } catch (HttpTimeoutException e) {
            recordMetric("profile.fetch.timeout", 1, "deadline");
            throw new DependencyTimeoutException("Profile service timed out", e);
        } catch (IOException e) {
            recordMetric("profile.fetch.io_error", 1, e.getClass().getSimpleName());
            throw new DependencyUnavailableException("Profile service I/O failure", e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new DependencyCancelledException("Profile request interrupted", e);
        }
    }

    private ProfileResult mapResponse(HttpResponse<String> response) throws DependencyException {
        int status = response.statusCode();

        if (status == 200) {
            try {
                return ProfileResult.found(objectMapper.readValue(response.body(), UserProfile.class));
            } catch (JsonProcessingException e) {
                throw new DependencyProtocolException("Profile service returned invalid JSON", e);
            }
        }

        if (status == 404) {
            return ProfileResult.notFound();
        }

        if (status == 401 || status == 403) {
            throw new DependencyAuthException("Profile service auth failure: " + status);
        }

        if (status == 429 || status == 503 || status == 504) {
            throw new DependencyRetryableException("Profile service temporary failure: " + status);
        }

        throw new DependencyProtocolException("Unexpected profile service status: " + status);
    }

    private static Duration min(Duration a, Duration b) {
        return a.compareTo(b) <= 0 ? a : b;
    }
}
```

Even this improved shape still leaves questions:

- Is `BodyHandlers.ofString()` safe for large response?
- Where is retry implemented?
- Is retry idempotent-aware?
- Where is tracing?
- Where is connection pool visibility?
- How is authentication injected?
- Does `baseUri.resolve()` behave as expected?
- How do we test timeout deterministically?
- How is deadline propagated from inbound request?

The point is not that every method becomes huge. The point is that production-grade behavior must exist somewhere: client wrapper, framework, middleware, SDK, or platform layer.

---

## 20. The Shape of a Production-Grade Communication Layer

A mature Java service rarely scatters raw HTTP/gRPC calls everywhere.

Better architecture:

```text
Application Service
  -> Domain Port / Gateway Interface
  -> Typed Dependency Client
  -> Resilience Layer
  -> Protocol Adapter
  -> Transport Client
  -> Observability + Security + Policy
```

Example:

```text
CaseAssignmentService
  -> OfficerDirectoryPort
  -> OfficerDirectoryHttpClient
  -> Timeout/Retry/CircuitBreaker/Bulkhead
  -> JDK HttpClient or Apache/OkHttp
  -> OpenTelemetry + Metrics + Safe Logs
```

### 20.1 Why This Shape Matters

It separates concerns:

| Layer | Responsibility |
|---|---|
| Application service | Business decision |
| Port/interface | Domain dependency contract |
| Typed client | Remote operation abstraction |
| Resilience layer | Timeout/retry/bulkhead/circuit breaker |
| Protocol adapter | HTTP/gRPC mapping |
| Transport client | Connection, TLS, bytes |
| Observability | Evidence |
| Security | Auth, mTLS, secret safety |

Without separation, every call site becomes a custom mini-framework.

---

## 21. The Role of gRPC in This Series

gRPC is not merely “faster REST”. It is a different communication model:

```text
IDL-first contract
Generated client/server code
HTTP/2 transport
Protobuf serialization
Unary and streaming methods
Metadata/trailers/status model
Deadline/cancellation as first-class concepts
```

### 21.1 Why gRPC Matters for Advanced Java Engineers

gRPC forces you to understand:

- HTTP/2 multiplexing,
- flow control,
- binary framing,
- deadline propagation,
- cancellation,
- generated contract compatibility,
- streaming backpressure,
- channel lifecycle,
- load balancing/name resolution,
- interceptor-based cross-cutting concerns.

In Java, gRPC commonly uses Netty as the main transport for both client and server. That means advanced gRPC understanding eventually touches Netty concepts: event loop, channel pipeline, buffer lifecycle, and non-blocking transport behavior.

### 21.2 When gRPC Is a Bad Fit

gRPC may be a poor fit when:

- external clients need simple browser/cURL compatibility,
- API must be manually consumable by many unknown parties,
- infrastructure does not support HTTP/2 properly,
- team lacks tooling/observability maturity,
- schema evolution discipline is weak,
- debugging must be extremely simple for operations teams.

Again, top-tier engineering is choosing semantics, not fashion.

---

## 22. Observability Is Not Optional

If you cannot observe network communication, you do not control it.

### 22.1 Minimum Metrics for HTTP/gRPC Client

For every important dependency:

```text
request count by operation/status/error
latency histogram by operation
timeout count
retry count
circuit breaker state
rate limit rejection count
in-flight request count
connection pool active/idle/pending
request payload size
response payload size
DNS/connect/TLS timing if available
```

### 22.2 Minimum Logs

Log events should include:

```text
correlation id / trace id
operation name
dependency name
attempt number
status/error class
duration
timeout/deadline
safe business identifier when allowed
no secret/no PII unless explicitly governed
```

### 22.3 Minimum Traces

A trace should show:

```text
Inbound request
  -> internal validation span
  -> dependency A HTTP/gRPC span
  -> dependency B span
  -> DB span
  -> response mapping
```

Without traces, fan-out failures become guesswork.

OpenTelemetry is important here because it provides a common model for traces, metrics, and logs across Java applications and common libraries. In practice, Java services may use OpenTelemetry SDK, instrumentation libraries, or Java agent-based instrumentation depending on how much code change is acceptable.

---

## 23. Security Mindset for Java Network Calls

Network code is a security boundary.

### 23.1 Common Risks

```text
SSRF
DNS rebinding
Unsafe redirect
Header injection
Request smuggling
TLS verification disabled
Trust-all certificate manager
Logging Authorization header
Logging PII payload
Deserialization vulnerability
Decompression bomb
Unbounded response body
Internal metadata endpoint exposure
Weak mTLS identity mapping
```

### 23.2 Defensive Defaults

Production client wrapper should consider:

```text
Allowlist outbound hosts for sensitive operations
Reject private IP ranges when calling user-provided URLs
Limit redirects or validate redirect target
Never disable hostname verification
Never use trust-all outside local tests
Limit request/response size
Limit decompression ratio
Sanitize logs
Separate auth token injection from business code
Use mTLS where service identity matters
```

Security is not a separate final step. It is part of protocol and transport design.

---

## 24. Performance Mindset: Latency Is a Distribution, Not a Number

Average latency is often misleading.

Use percentiles:

```text
p50  = median user experience
p95  = slow but common tail
p99  = bad tail
p999 = severe tail / incident signal
```

### 24.1 Why Tail Latency Matters

If one page requires 10 dependency calls, and each dependency has 1% chance of being slow, the page has a much higher chance of seeing at least one slow dependency.

Simplified:

```text
Probability all 10 calls are not slow = 0.99^10 = 0.904
Probability at least one slow call = 1 - 0.904 = 9.6%
```

Thus p99 of dependency can become much more visible at user level.

### 24.2 Common Latency Sources

```text
DNS lookup
TCP connect
TLS handshake
connection pool wait
request queueing
server thread pool wait
database pool wait
lock contention
GC pause
CPU throttling
packet loss
retry delay
large payload serialization
compression/decompression
slow client/slow server streaming
```

A top-tier engineer does not ask “why is API slow?” but:

```text
Which component of latency increased?
```

---

## 25. Testing Mindset: Mocking Is Not Enough

Unit tests can verify mapping logic, but they cannot prove network behavior.

A serious test strategy includes:

```text
Unit test:
  - request construction
  - response mapping
  - error taxonomy

Contract test:
  - schema compatibility
  - status/error semantics
  - required headers

Integration test:
  - real HTTP/gRPC server
  - TLS config
  - timeout behavior
  - retry behavior

Fault injection:
  - delayed response
  - connection reset
  - partial response
  - malformed body
  - 429/503/504
  - slow streaming

Load test:
  - pool saturation
  - p99 latency
  - concurrency limit
  - downstream protection

Chaos/production game day:
  - DNS failure
  - certificate expiration simulation
  - dependency outage
  - proxy failure
  - packet loss/latency injection
```

If tests only mock the Java interface, the most important failure modes remain untested.

---

## 26. The Learning Strategy for This Series

Untuk mempelajari seri ini secara efektif, gunakan pendekatan empat lapis.

### 26.1 Layer 1 — Conceptual Model

Pahami konsep:

- TCP stream,
- HTTP semantics,
- HTTP/2 frame/stream,
- gRPC status/deadline,
- TLS trust,
- timeout/retry,
- backpressure,
- observability.

Tujuan: bisa menjelaskan tanpa kode.

### 26.2 Layer 2 — Java API Mapping

Pahami bagaimana konsep muncul di Java:

- JDK `HttpClient`,
- Apache HttpClient,
- OkHttp,
- Netty,
- gRPC Java,
- virtual threads,
- CompletableFuture,
- structured concurrency,
- OpenTelemetry instrumentation.

Tujuan: bisa memilih API yang tepat.

### 26.3 Layer 3 — Production Pattern

Pahami pattern:

- typed client,
- deadline propagation,
- retry budget,
- circuit breaker,
- bulkhead,
- safe logging,
- contract evolution,
- failure playbook.

Tujuan: bisa membuat solusi yang reusable dan governable.

### 26.4 Layer 4 — Failure Diagnosis

Pahami incident:

- timeout,
- pool starvation,
- DNS stale,
- TLS failure,
- HTTP/2 reset,
- gRPC deadline,
- slow consumer,
- retry storm,
- LB idle mismatch,
- Netty event loop blocked.

Tujuan: bisa menemukan root cause dengan bukti.

---

## 27. Recommended Mental Checklist Before Any Network Integration

Gunakan checklist ini sebelum membuat integrasi baru.

### 27.1 Contract

```text
What operation is exposed?
What is the request/response schema?
What are success statuses?
What are business errors?
What are technical errors?
Is the operation idempotent?
How does versioning work?
How is backward compatibility guaranteed?
```

### 27.2 Transport

```text
HTTP/1.1, HTTP/2, gRPC, WebSocket, or messaging?
Does infrastructure support it end-to-end?
Is TLS terminated where?
Is mTLS required?
Any proxy/gateway/service mesh involved?
```

### 27.3 Resilience

```text
What is the total deadline?
What are per-attempt timeouts?
Can it retry?
What backoff/jitter?
What circuit breaker rule?
What rate limit?
What bulkhead?
What fallback?
```

### 27.4 Resource

```text
Connection pool size?
Max in-flight request?
Response size limit?
Streaming or buffering?
Memory budget?
Thread/concurrency model?
```

### 27.5 Security

```text
Authentication?
Authorization?
TLS verification?
Secrets handling?
Payload sensitivity?
Log redaction?
SSRF protection?
```

### 27.6 Observability

```text
Metrics?
Logs?
Traces?
Correlation id?
Audit event?
Dashboard?
Alert?
Runbook?
```

### 27.7 Testing

```text
Unit test?
Contract test?
Integration test?
Timeout test?
Retry test?
TLS test?
Fault injection?
Load test?
```

---

## 28. Key Anti-Patterns to Eliminate Early

### 28.1 Creating HTTP Client Per Request

Bad:

```java
HttpClient.newHttpClient().send(request, handler);
```

Why bad:

- loses connection reuse,
- may increase handshake overhead,
- hides resource lifecycle,
- harder to instrument consistently.

Better:

```java
HttpClient client = HttpClient.newBuilder()
    .connectTimeout(Duration.ofSeconds(2))
    .build();
```

Reuse the client as long-lived dependency.

### 28.2 No Timeout

Bad:

```java
client.send(request, BodyHandlers.ofString());
```

Better:

```java
HttpRequest request = HttpRequest.newBuilder(uri)
    .timeout(Duration.ofMillis(800))
    .GET()
    .build();
```

Also configure connect timeout at client level where available.

### 28.3 Blind Retry

Bad:

```text
Retry all exceptions 3 times.
```

Better:

```text
Retry only explicitly retryable failure classes.
Retry only idempotent or idempotency-key-protected operations.
Use exponential backoff + jitter.
Stop retry if deadline exhausted.
Respect Retry-After where appropriate.
```

### 28.4 Treating HTTP 500 as Always Retryable

Not all 500s are equal. A 500 after server committed a side effect is dangerous. A 503 before processing may be retryable. You need operation semantics.

### 28.5 Logging Full Payload by Default

Bad:

```text
log.info("Request: {} Response: {}", requestBody, responseBody)
```

Risk:

- PII leak,
- secret leak,
- log explosion,
- compliance issue,
- cost increase.

Better:

```text
Log metadata, correlation id, operation, status, duration, safe identifiers, and redacted error code.
```

### 28.6 Unbounded Response Body

Bad:

```java
BodyHandlers.ofString()
```

for unknown large responses.

Better:

- enforce response size limit,
- stream to file/object storage,
- validate `Content-Length` if present,
- abort large unexpected body,
- avoid parsing huge JSON into memory.

### 28.7 Mixing Domain and Transport Exceptions

Bad:

```java
throw new RuntimeException("Failed");
```

Better:

```text
BusinessRejection
DependencyTimeout
DependencyUnavailable
DependencyProtocolError
DependencyAuthError
AmbiguousDependencyResult
```

---

## 29. How This Series Will Be Structured

Setiap part berikutnya akan memakai pola:

```text
1. Problem framing
2. Mental model
3. Java-specific mapping
4. Production failure modes
5. Design patterns
6. Code examples where useful
7. Observability checklist
8. Testing strategy
9. Common mistakes
10. Summary and next part bridge
```

Tujuannya bukan sekadar tahu API, tetapi membangun kemampuan:

```text
Understand -> Design -> Implement -> Observe -> Diagnose -> Improve
```

---

## 30. The Big Map of the Series

```text
Part 0  : Orientation
Part 1  : Application code to wire mental model
Part 2  : TCP for Java engineers
Part 3  : DNS and endpoint discovery
Part 4  : Socket/NIO behavior revisited
Part 5  : Protocol design fundamentals
Part 6  : Serialization on the wire
Part 7  : HTTP semantics
Part 8  : HTTP/1.1 internals
Part 9  : HTTP/2 internals
Part 10 : HTTP/3 and QUIC concept
Part 11 : Java HTTP client generations
Part 12 : JDK HttpClient deep dive
Part 13 : Timeout engineering
Part 14 : Retry/idempotency/hedging
Part 15 : Connection pooling
Part 16 : TLS/mTLS
Part 17 : Proxy/gateway/load balancer/service mesh
Part 18 : REST contract evolution
Part 19 : HTTP streaming
Part 20 : WebSocket production protocol
Part 21 : gRPC fundamentals
Part 22 : gRPC transport internals
Part 23 : gRPC error/retry/load balancing
Part 24 : gRPC streaming/backpressure
Part 25 : Netty internals
Part 26 : Reactive/async/virtual threads/blocking choice
Part 27 : Backpressure/rate limit/bulkhead/circuit breaker
Part 28 : Observability
Part 29 : Performance engineering
Part 30 : Large payload/file transfer
Part 31 : Security beyond TLS
Part 32 : Testing networked systems
Part 33 : Production failure catalogue
Part 34 : Architecture patterns
Part 35 : Capstone
```

---

## 31. Minimum Practical Baseline Before Moving to Part 1

Sebelum lanjut ke Part 1, pastikan kamu bisa menjawab pertanyaan berikut secara konseptual.

### 31.1 Questions

1. Mengapa network call tidak boleh dianggap sebagai function call biasa?
2. Apa perbedaan business failure, technical failure, dan ambiguous failure?
3. Mengapa retry pada `POST` bisa berbahaya?
4. Mengapa timeout harus dilihat sebagai deadline budget, bukan angka random?
5. Mengapa connection pool bisa menjadi bottleneck walaupun remote service sehat?
6. Mengapa virtual threads tidak menghapus kebutuhan backpressure?
7. Mengapa observability harus mencakup logs, metrics, dan traces?
8. Mengapa “network issue” adalah diagnosis yang buruk?
9. Mengapa gRPC menuntut pemahaman HTTP/2?
10. Mengapa communication layer sebaiknya tidak tersebar di semua service method?

### 31.2 Expected Answers — Short Form

1. Karena network call melewati banyak layer, bisa partial/ambiguous, dan remote side effect tidak selalu diketahui.
2. Business failure adalah keputusan domain; technical failure adalah kegagalan komunikasi/runtime; ambiguous failure adalah kondisi ketika hasil remote tidak diketahui.
3. Karena server mungkin sudah memproses request walau client belum menerima response.
4. Karena setiap dependency mengonsumsi waktu dari user/request budget yang terbatas.
5. Karena request bisa menunggu koneksi sebelum mencapai remote service.
6. Karena remote capacity, connection count, bandwidth, rate limit, dan memory tetap finite.
7. Karena log menjelaskan event, metric menjelaskan pola, trace menjelaskan path.
8. Karena terlalu generik dan tidak mengarah ke layer/failure/resource spesifik.
9. Karena gRPC berjalan di atas HTTP/2 dan memakai stream, frame, flow control, metadata, trailers, dan status model.
10. Karena policy timeout/retry/security/observability harus konsisten dan governable.

---

## 32. Deep Mental Model: Network Call as State Machine

Untuk engineer yang bekerja dengan workflow, regulatory systems, atau case lifecycle, network call bisa dipahami sebagai state machine.

### 32.1 Simplified State Machine

```text
NEW
  -> REQUEST_BUILT
  -> SERIALIZED
  -> RESOLVING_DNS
  -> ACQUIRING_CONNECTION
  -> CONNECTING
  -> TLS_HANDSHAKING
  -> WRITING_REQUEST
  -> WAITING_RESPONSE_HEADERS
  -> READING_RESPONSE_BODY
  -> DECODING_RESPONSE
  -> MAPPING_RESULT
  -> COMPLETED
```

Failure transitions:

```text
RESOLVING_DNS -> FAILED_DNS
ACQUIRING_CONNECTION -> FAILED_POOL_TIMEOUT
CONNECTING -> FAILED_CONNECT_TIMEOUT
TLS_HANDSHAKING -> FAILED_TLS
WRITING_REQUEST -> FAILED_WRITE
WAITING_RESPONSE_HEADERS -> FAILED_RESPONSE_TIMEOUT
READING_RESPONSE_BODY -> FAILED_PARTIAL_RESPONSE
DECODING_RESPONSE -> FAILED_PROTOCOL
ANY_STATE -> CANCELLED
ANY_STATE -> DEADLINE_EXCEEDED
```

Important ambiguous states:

```text
WRITING_REQUEST succeeded, response not received
WAITING_RESPONSE_HEADERS timed out
READING_RESPONSE_BODY failed after partial body
```

These may mean:

```text
Remote did not receive request
Remote received but did not process
Remote processed but response lost
Remote processed and response delayed
Remote partially streamed response then failed
```

If the operation has side effects, the system needs reconciliation/idempotency.

### 32.2 Why State Machine Thinking Helps

State machine thinking prevents shallow diagnosis.

Instead of:

```text
The API timed out.
```

You ask:

```text
Timed out in which state?
Before connect?
During TLS?
Waiting for connection pool?
Waiting for first response byte?
Reading body?
After remote committed?
```

This is exactly the level of reasoning expected from a high-level engineer.

---

## 33. What Good Looks Like: A Network Client Design Template

A robust client design document should include:

```text
Dependency name:
Owner team:
Protocol:
Endpoint discovery:
Authentication:
Authorization model:
TLS/mTLS:
Operations:
Request/response schema:
Business errors:
Technical errors:
Idempotency:
Timeout budget:
Retry policy:
Rate limit:
Circuit breaker:
Bulkhead:
Connection pool:
Payload limit:
Streaming behavior:
Logging policy:
Metrics:
Tracing:
Audit requirement:
Testing plan:
Runbook:
Rollback/degradation plan:
```

This template will be reused throughout the series.

---

## 34. Practical Exercise for Part 0

Pick one real dependency in your system and fill this table.

| Question | Answer |
|---|---|
| Dependency name |  |
| Protocol | HTTP/gRPC/WebSocket/etc |
| Operation |  |
| Read or side-effecting? |  |
| Idempotent? |  |
| Timeout |  |
| Retry policy |  |
| Connection pool |  |
| Auth method |  |
| TLS/mTLS |  |
| Main failure modes |  |
| Metrics available |  |
| Trace available |  |
| Logs have correlation id? |  |
| Contract test exists? |  |
| What happens if dependency is down? |  |
| What happens if dependency is slow? |  |
| What happens if response is huge? |  |
| What happens if client times out after remote commits? |  |

If many cells are blank, that is not failure. That is discovery. Top-tier engineering starts by making hidden assumptions visible.

---

## 35. Summary

Part 0 established the orientation for the whole series.

Key points:

1. Java network engineering is not just using HTTP/gRPC APIs.
2. Every network call is a distributed attempt with uncertain failure modes.
3. A production call must have timeout, ownership, bounded concurrency, idempotency strategy, error taxonomy, observability, and safe contract evolution.
4. Blocking vs non-blocking is less important than workload shape, resource protection, failure semantics, and correctness.
5. Java 8–25 changes the available tools, but not the fundamental constraints of networked systems.
6. Virtual threads simplify many blocking I/O cases but do not remove network/resource/backpressure limits.
7. gRPC requires understanding HTTP/2, flow control, deadlines, cancellation, and channel lifecycle.
8. Observability is a design requirement, not an afterthought.
9. Security belongs inside network design, not after it.
10. The goal of this series is to build mental models that survive production incidents.

---

## 36. References and Further Reading

Use these references as anchors, not as memorization targets.

1. Oracle Java SE 25 API — `java.net.http.HttpClient`.
2. Oracle Java SE 25 API — `java.net.http` module summary.
3. Oracle Java SE 25 API/Core Docs — Structured Concurrency / `StructuredTaskScope`.
4. Oracle Java SE 25 API — `java.net` package summary.
5. gRPC Java official repository and generated documentation.
6. gRPC Java Netty transport package documentation.
7. OpenTelemetry Java documentation.
8. OpenTelemetry Java instrumentation documentation.
9. RFC 9110 — HTTP Semantics.
10. RFC 9112 — HTTP/1.1.
11. RFC 9113 — HTTP/2.
12. RFC 9000 — QUIC.
13. RFC 9114 — HTTP/3.
14. RFC 8446 — TLS 1.3.
15. Google SRE materials on latency, overload, retries, and cascading failure.
16. Brendan Gregg materials on systems performance and latency analysis.

---

## 37. Status Seri

Seri belum selesai. Ini adalah:

```text
Part 0 of 35
```

Part berikutnya:

```text
Part 1 — Mental Model Network Stack: Application Code to Wire
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 030 — Production Design Patterns: File Ingestion, Export Job, Secure Transfer, Audit, Observability, dan Operational Runbook](../learn-java-io-nio-networking-data-transfer-part-030.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 1 — Mental Model Network Stack: Application Code to Wire](./001-network-stack-mental-model-application-code-to-wire.md)

</div>