# Part 29 — Production Failure Playbook: Diagnosis and Incident Response

> Series: `learn-java-http-client-okhttp-retrofit-client-engineering`  
> File: `29-production-failure-playbook-diagnosis-incident-response.md`  
> Scope: Java 8–25, JDK HttpClient, OkHttp, Retrofit, Apache HttpClient 5, Spring HTTP clients  
> Level: Advanced / production engineering / incident response

---

## 0. Tujuan Part Ini

Bagian ini membahas **cara mendiagnosis dan menangani incident production yang melibatkan HTTP client**.

Di part sebelumnya kita sudah membahas:

- lifecycle request,
- timeout,
- connection pooling,
- DNS/proxy/LB/NAT,
- TLS,
- auth,
- retry,
- rate limit,
- circuit breaker,
- observability,
- testing,
- performance,
- concurrency,
- security,
- config management.

Part ini menyatukan semuanya menjadi **playbook operasional**.

Target akhirnya: ketika production bermasalah, kita tidak hanya bertanya:

> “API downstream error atau tidak?”

Tetapi mampu memecah masalah menjadi pertanyaan yang lebih tajam:

```text
Apakah failure terjadi sebelum request terkirim?
Apakah request terkirim tapi response lambat?
Apakah connection pool exhausted?
Apakah retry memperbesar traffic?
Apakah NAT/ephemeral port habis?
Apakah DNS resolve ke target lama?
Apakah TLS handshake gagal karena cert rotation?
Apakah 5xx berasal dari downstream, proxy, gateway, atau client policy?
Apakah fallback menyembunyikan incident?
Apakah error user-facing beda dari error diagnostic?
```

HTTP client incident sering sulit karena gejalanya muncul di banyak tempat:

```text
application error rate naik
thread pool penuh
latency p99 naik
CPU naik
memory naik
connection count naik
NAT port habis
LB target unhealthy
DNS timeout
TLS failure
429 dari downstream
504 dari gateway
business transaction pending
```

Playbook ini membantu mengubah situasi kacau menjadi proses diagnosis yang terstruktur.

---

## 1. Mental Model: HTTP Client Incident Bukan Selalu Downstream Incident

Kesalahan umum saat incident:

> “Kita hanya call API X. Kalau error berarti API X bermasalah.”

Belum tentu.

HTTP client incident bisa berasal dari banyak layer:

```text
caller application
  ↓
client wrapper / SDK
  ↓
timeout / retry / circuit breaker / rate limiter
  ↓
HTTP library
  ↓
connection pool
  ↓
DNS resolver
  ↓
proxy / service mesh / gateway
  ↓
NAT / firewall / routing
  ↓
load balancer
  ↓
downstream service
  ↓
downstream database / dependency
```

Maka diagnosis yang baik tidak langsung menyalahkan downstream. Diagnosis harus mengidentifikasi **failure layer**.

---

## 2. Prinsip Incident Response untuk HTTP Client

### 2.1 Stabilize First, Explain Later

Saat incident aktif, prioritas pertama adalah mengurangi dampak.

Urutan mental:

```text
1. Apakah user impact sedang terjadi?
2. Apakah error/latency makin memburuk?
3. Apakah sistem caller ikut collapse?
4. Apakah retry/concurrency memperbesar damage?
5. Apa mitigasi paling aman untuk menghentikan bleeding?
6. Baru kemudian root cause detail.
```

Contoh mitigasi awal:

- turunkan concurrency,
- disable aggressive retry,
- aktifkan fallback terbatas,
- buka circuit breaker,
- fail fast untuk endpoint non-critical,
- rollback config timeout/retry,
- switch endpoint jika valid,
- rate limit traffic batch,
- hentikan job/worker sementara,
- scale caller jika bottleneck internal,
- scale downstream jika bottleneck downstream dan kita punya kontrol.

Top engineer tidak hanya mencari penyebab. Ia juga mengerti **cara mencegah blast radius membesar selama pencarian penyebab**.

---

### 2.2 Classify Before Fixing

Jangan mulai dari solusi.

Mulai dari klasifikasi:

```text
Apakah ini latency issue?
Apakah ini availability issue?
Apakah ini correctness issue?
Apakah ini capacity issue?
Apakah ini security/config issue?
Apakah ini partial degradation?
```

Contoh:

- `connect timeout` ≠ `read timeout`.
- `401` ≠ `403`.
- `429` ≠ `503`.
- `SSLHandshakeException` karena truststore ≠ karena hostname mismatch.
- `SocketTimeoutException` setelah request terkirim ≠ timeout sebelum connect selesai.
- `504` dari gateway ≠ timeout langsung dari Java client.

Solusi yang salah sering muncul karena klasifikasi terlalu kasar.

---

### 2.3 Protect the Caller

HTTP client harus diperlakukan sebagai outbound dependency boundary.

Ketika downstream lambat, caller tidak boleh ikut mati.

Prinsip:

```text
A slow dependency must not consume all caller resources.
```

Resource caller yang harus dilindungi:

- request thread,
- virtual thread carrier pressure,
- async executor,
- connection pool,
- heap,
- CPU,
- retry budget,
- queue capacity,
- DB transaction time,
- user session wait time.

Jika downstream rusak, caller minimal harus bisa:

- fail fast,
- degrade gracefully,
- preserve critical paths,
- reject non-critical traffic,
- expose accurate metrics.

---

## 3. Failure Taxonomy untuk Incident

Gunakan taxonomy ini saat membaca error.

```text
1. Client construction/config failure
2. Request construction failure
3. DNS failure
4. Proxy/routing failure
5. Pool acquisition failure
6. TCP connect failure
7. TLS handshake failure
8. Request write failure
9. Response wait/read timeout
10. Response status error
11. Response body decode failure
12. Semantic/domain failure
13. Client policy failure
14. Caller resource exhaustion
15. Observability blind spot
```

Mari uraikan.

---

## 4. Client Construction / Config Failure

### 4.1 Gejala

- Semua outbound call ke dependency tertentu gagal segera.
- Error muncul saat startup atau saat bean/client dibuat.
- Config endpoint kosong/salah.
- Truststore path salah.
- Secret tidak ditemukan.
- Proxy config tidak valid.
- Timeout bernilai 0 atau terlalu kecil.

### 4.2 Evidence yang Dicek

- effective configuration saat startup,
- base URL,
- timeout,
- pool size,
- proxy,
- TLS config,
- secret reference,
- feature flag state,
- deployment config diff,
- environment variable,
- config map/secret version,
- recent deployment.

### 4.3 Mitigasi

- rollback config,
- rollback deployment,
- restore secret,
- switch feature flag,
- disable client path yang rusak,
- fail startup untuk config invalid pada release berikutnya.

### 4.4 Lesson

Config HTTP client adalah production control plane. Ia harus divalidasi sebelum menerima traffic.

---

## 5. Request Construction Failure

### 5.1 Gejala

- Error 400/404 meningkat setelah release.
- Hanya request dengan input tertentu yang gagal.
- Signature mismatch.
- API gateway menolak path/query.
- Downstream mengatakan parameter tidak diterima.

### 5.2 Penyebab Umum

- URL double encoded.
- Path variable tidak di-encode benar.
- Query parameter kosong tapi tetap dikirim.
- Header `Content-Type` salah.
- Body schema berubah.
- Date/time format berubah.
- Enum value tidak kompatibel.
- Canonical request untuk HMAC tidak sama dengan server.
- Base URL berubah dengan trailing slash issue.

### 5.3 Evidence

- sanitized request log,
- correlation ID,
- sampled request path/query tanpa secret,
- payload schema version,
- OpenAPI diff,
- downstream access log,
- recent code/config change.

### 5.4 Mitigasi

- rollback release,
- route traffic ke old client path,
- feature flag disable new parameter,
- hotfix mapping/encoding,
- add compatibility logic.

---

## 6. DNS Failure

### 6.1 Gejala

- `UnknownHostException`.
- Sporadic connection failure.
- Beberapa pod/instance bisa resolve, yang lain tidak.
- Latency spike sebelum connect.
- Kubernetes/CoreDNS error meningkat.
- Hostname resolve ke IP lama.

### 6.2 Penyebab Umum

- DNS record berubah.
- JVM DNS cache terlalu lama.
- Negative DNS cache.
- CoreDNS overload.
- `ndots` issue di Kubernetes.
- Split-horizon DNS mismatch.
- Private hosted zone salah.
- Resolver/network ACL issue.
- Service mesh DNS capture issue.

### 6.3 Evidence

Di aplikasi:

```text
exception class
failure phase = dns
host
resolved IP jika ada
time to DNS
pod/instance id
```

Di environment:

```bash
nslookup api.example.internal
 dig api.example.internal
 getent hosts api.example.internal
```

Di Kubernetes:

```bash
kubectl -n kube-system logs deployment/coredns
kubectl get endpoints
kubectl describe svc <service>
```

### 6.4 Mitigasi

- restart aplikasi jika cache DNS stale dan aman,
- turunkan DNS TTL JVM untuk future,
- fix DNS record,
- scale CoreDNS,
- reduce DNS query storm,
- avoid creating new HTTP client per request,
- pin endpoint sementara hanya jika sangat terkontrol dan reversible.

### 6.5 Anti-pattern

Jangan langsung menaikkan read timeout untuk DNS failure. Itu tidak menyelesaikan root cause.

---

## 7. Proxy / Routing Failure

### 7.1 Gejala

- Error hanya terjadi dari environment tertentu.
- HTTP proxy mengembalikan 407/502/503/504.
- HTTPS call gagal saat CONNECT tunnel.
- Corporate proxy/TLS inspection menyebabkan handshake error.
- Request internal malah keluar ke proxy publik.

### 7.2 Evidence

- proxy config efektif,
- `NO_PROXY` / bypass list,
- route table,
- proxy logs,
- CONNECT status,
- TLS certificate issuer,
- source subnet,
- egress path.

### 7.3 Mitigasi

- fix proxy selector,
- update `NO_PROXY`,
- rotate proxy credentials,
- bypass proxy untuk private endpoint,
- coordinate dengan network team,
- rollback endpoint route change.

### 7.4 Diagnostic Question

```text
Apakah traffic benar-benar keluar lewat jalur yang kita pikir?
```

Banyak incident terjadi karena asumsi routing salah.

---

## 8. Connection Pool Exhaustion

### 8.1 Gejala

- Request menunggu lama sebelum connect.
- Latency naik walau downstream normal.
- Thread dump menunjukkan banyak thread menunggu connection.
- Apache: connection request timeout.
- OkHttp: queued calls meningkat.
- JDK client: p95/p99 naik karena connection reuse/acquisition pressure.
- CPU tidak selalu tinggi.

### 8.2 Penyebab Umum

- Max connection terlalu kecil.
- Downstream lambat sehingga connection lama tertahan.
- Response body tidak ditutup.
- Streaming download terlalu lama menahan connection.
- Semua traffic berbagi pool yang sama.
- Retry menambah request paralel.
- HTTP/1.1 butuh lebih banyak koneksi dibanding HTTP/2.
- Connection leak karena exception path.

### 8.3 Evidence

- active connections,
- idle connections,
- pending/queued requests,
- pool acquire duration,
- in-flight request count,
- response body close metric,
- downstream latency,
- retry attempt count,
- thread dump.

Untuk OkHttp:

- `Dispatcher.runningCallsCount()`
- `Dispatcher.queuedCallsCount()`
- `ConnectionPool.connectionCount()`
- `ConnectionPool.idleConnectionCount()`

Untuk Apache:

- leased,
- available,
- pending,
- max total,
- max per route.

### 8.4 Mitigasi

- turunkan upstream concurrency,
- temporarily increase pool only if downstream can handle it,
- disable/reduce retry,
- enforce response body close,
- separate pool per downstream/traffic class,
- add pool acquire timeout,
- enable circuit breaker/fail fast,
- investigate slow downstream.

### 8.5 Critical Warning

Menaikkan pool size tanpa batas bisa memindahkan masalah ke downstream, NAT, DB, atau thread pool.

---

## 9. TCP Connect Failure

### 9.1 Gejala

- `ConnectException: Connection refused`.
- `ConnectTimeoutException`.
- `No route to host`.
- `Network is unreachable`.
- Failure terjadi sebelum request body terkirim.

### 9.2 Penyebab Umum

- service down,
- LB target tidak sehat,
- firewall/security group,
- wrong port,
- wrong endpoint,
- route table issue,
- DNS resolved to unreachable IP,
- NAT issue,
- ephemeral port exhaustion,
- overloaded accept backlog.

### 9.3 Evidence

- connect timeout count,
- target IP/port,
- LB target health,
- network ACL/security group,
- route table,
- SYN/SYN-ACK evidence if available,
- source instance/pod,
- connection refused vs timeout distinction.

### 9.4 Mitigasi

- fix endpoint/port,
- restore LB target,
- fix network ACL/security group,
- reduce connection churn,
- reuse clients/connections,
- scale downstream accept capacity,
- check NAT/ephemeral port exhaustion.

---

## 10. TLS Handshake Failure

### 10.1 Gejala

- `SSLHandshakeException`.
- `PKIX path building failed`.
- `No subject alternative names matching`.
- `bad_certificate`.
- Handshake timeout.
- Hanya mTLS endpoint yang gagal.
- Failure muncul setelah certificate rotation.

### 10.2 Penyebab Umum

- CA tidak ada di truststore.
- Certificate expired.
- Intermediate certificate hilang.
- Hostname mismatch.
- Client certificate expired.
- Wrong keystore alias.
- mTLS client cert tidak dipercaya server.
- TLS protocol/cipher mismatch.
- Proxy TLS inspection.
- ALPN negotiation issue.

### 10.3 Evidence

- certificate chain,
- expiration date,
- SAN,
- issuer,
- truststore content,
- keystore alias,
- TLS protocol/cipher,
- server name indication/SNI,
- recent cert rotation.

Useful command:

```bash
openssl s_client -connect api.example.com:443 -servername api.example.com -showcerts
```

Java debug:

```bash
-Djavax.net.debug=ssl,handshake
```

Gunakan debug TLS hati-hati karena log bisa sangat besar dan sensitif.

### 10.4 Mitigasi

- update truststore,
- fix certificate chain,
- rotate client cert,
- fix hostname/SAN,
- rollback certificate,
- disable broken endpoint temporarily,
- coordinate with certificate owner.

### 10.5 Anti-pattern

Jangan memakai trust-all manager di production.

---

## 11. Request Write Failure

### 11.1 Gejala

- Upload gagal di tengah.
- `Broken pipe`.
- `Connection reset by peer` saat request body dikirim.
- Multipart/file upload gagal pada ukuran tertentu.
- Timeout saat write.

### 11.2 Penyebab Umum

- downstream menutup koneksi,
- proxy/LB body size limit,
- write timeout terlalu kecil,
- network unstable,
- body streaming lambat,
- client upload besar tanpa backpressure,
- request body tidak repeatable tapi retry dilakukan.

### 11.3 Evidence

- payload size,
- content-length vs chunked,
- upload duration,
- write timeout,
- proxy/LB max body size,
- downstream logs,
- retry attempt.

### 11.4 Mitigasi

- increase write timeout only if justified,
- reduce upload chunk size if applicable,
- use streaming properly,
- disable retry for non-repeatable body,
- align body size limit at proxy/LB/downstream,
- resumable upload design for large files.

---

## 12. Response Wait / Read Timeout

### 12.1 Gejala

- Request terkirim, response tidak datang tepat waktu.
- `SocketTimeoutException: Read timed out`.
- `HttpTimeoutException`.
- Gateway 504.
- p99 latency naik.
- Downstream CPU/DB latency naik.

### 12.2 Penyebab Umum

- downstream slow,
- downstream DB lock,
- queueing di downstream,
- response body besar,
- streaming lambat,
- caller timeout terlalu kecil,
- retry memperparah downstream,
- LB idle timeout mismatch,
- proxy buffering.

### 12.3 Evidence

- client-side latency per phase,
- downstream server latency,
- gateway latency,
- status code distribution,
- retry count,
- in-flight count,
- downstream saturation,
- DB slow query/lock,
- response size.

### 12.4 Mitigasi

- reduce concurrency,
- disable/reduce retry,
- increase timeout only if business flow can wait and downstream is not collapsing,
- add circuit breaker,
- degrade non-critical features,
- optimize downstream,
- split large operation into async job.

### 12.5 Important Distinction

Jika timeout terjadi setelah request terkirim, side effect mungkin sudah terjadi. Jangan blindly retry POST tanpa idempotency key.

---

## 13. HTTP Status Error Spike

### 13.1 400 / 422 Spike

Biasanya correctness/request contract issue.

Cek:

- recent payload change,
- validation rule change,
- enum/date format,
- field rename,
- API version,
- client/server schema mismatch.

Mitigasi:

- rollback mapping,
- compatibility patch,
- schema negotiation,
- disable new field.

---

### 13.2 401 Spike

Biasanya authentication failure.

Cek:

- token expiry,
- token refresh failure,
- clock skew,
- wrong audience/scope,
- secret rotation,
- cache invalidation,
- single-flight refresh bug.

Mitigasi:

- rotate secret,
- refresh token cache,
- fix clock sync,
- reduce auth retry storm,
- restore old credentials.

---

### 13.3 403 Spike

Biasanya authorization/permission issue.

Cek:

- scope/role changed,
- client id changed,
- tenant permission,
- endpoint permission policy,
- IP allowlist.

Mitigasi:

- restore permission,
- update client scope,
- fix allowlist,
- isolate affected tenant.

---

### 13.4 404 Spike

Bisa request construction atau routing.

Cek:

- path changed,
- base URL wrong,
- API version removed,
- tenant/resource id invalid,
- trailing slash issue,
- proxy route.

---

### 13.5 409 Spike

Biasanya conflict/idempotency/concurrency issue.

Cek:

- duplicate command,
- repeated retry,
- optimistic lock,
- idempotency key reuse,
- concurrent workflow.

---

### 13.6 429 Spike

Rate limit.

Cek:

- outbound request rate,
- retry amplification,
- batch job schedule,
- per-tenant quota,
- `Retry-After`,
- downstream quota change.

Mitigasi:

- throttle,
- obey `Retry-After`,
- disable aggressive retry,
- queue batch,
- apply token bucket,
- request quota increase only after client behavior is sane.

---

### 13.7 500 / 502 / 503 / 504 Spike

Potential downstream/gateway/proxy/service-mesh failure.

Cek:

- response source,
- gateway logs,
- downstream logs,
- LB target health,
- retry count,
- connection errors,
- deploy events,
- saturation metrics.

Mitigasi:

- circuit breaker,
- reduce concurrency,
- fail fast,
- fallback,
- rollback downstream if controlled,
- disable batch traffic,
- coordinate with owner.

---

## 14. Response Body Decode Failure

### 14.1 Gejala

- HTTP status 200 tapi client error.
- JSON parse exception.
- Unknown enum.
- Date parse error.
- XML parser error.
- Empty response body unexpected.
- `Content-Type` mismatch.

### 14.2 Penyebab Umum

- downstream response schema changed,
- HTML error page returned as JSON,
- proxy returned error body,
- enum added,
- date format changed,
- charset mismatch,
- truncated response,
- compression issue,
- body too large.

### 14.3 Evidence

- content-type,
- status,
- sanitized body sample,
- response size,
- schema version,
- downstream release notes,
- converter config.

### 14.4 Mitigasi

- tolerate unknown fields/enums where safe,
- parse error envelope separately,
- content-type validation,
- rollback downstream/client,
- hotfix DTO,
- improve contract tests.

---

## 15. Semantic / Domain Failure

### 15.1 Gejala

- HTTP 200 but business failed.
- Response contains `success=false`.
- External state inconsistent.
- Duplicate command.
- Payment/order/case status stuck.
- Partial success.

### 15.2 Evidence

- domain correlation id,
- external transaction id,
- idempotency key,
- audit trail,
- downstream business status,
- retry history,
- command timeline.

### 15.3 Mitigasi

- reconciliation job,
- idempotency lookup,
- manual compensation,
- replay safe commands,
- stop unsafe retry,
- add domain-level status polling.

### 15.4 Key Point

HTTP client playbook tidak selesai di status code. Untuk regulated/financial/case-management system, domain state consistency sering lebih penting daripada HTTP success.

---

## 16. Retry Storm

### 16.1 Gejala

- Request volume naik lebih tinggi daripada user traffic.
- Downstream makin lambat setelah error spike.
- 5xx/429 naik bersamaan dengan retry count.
- Caller CPU/thread/pool naik.
- Downstream owner melihat traffic amplification.

### 16.2 Penyebab Umum

- retry tanpa jitter,
- retry tanpa deadline,
- retry pada non-idempotent operation,
- nested retry di library + service mesh + application,
- all clients retry at same interval,
- batch job retry massal.

### 16.3 Evidence

- attempts per logical operation,
- retry reason,
- retry delay,
- retry budget consumption,
- status per attempt,
- downstream traffic volume.

### 16.4 Mitigasi

- disable/reduce retry,
- add jitter,
- respect `Retry-After`,
- enforce retry budget,
- circuit open,
- throttle batch traffic,
- separate user traffic from background traffic.

### 16.5 Diagnostic Question

```text
Apakah traffic yang terlihat di downstream adalah original demand atau amplified demand?
```

---

## 17. Circuit Breaker Misbehavior

### 17.1 Gejala

- Semua call langsung gagal walau downstream sudah pulih.
- Half-open probe gagal terus.
- Breaker tidak open walau error tinggi.
- Fallback menyembunyikan outage.
- Dashboard menunjukkan success tapi user data stale.

### 17.2 Penyebab Umum

- threshold salah,
- sliding window terlalu kecil/besar,
- failure classification salah,
- timeout tidak dihitung sebagai failure,
- fallback dianggap success tanpa dimensi degraded,
- breaker global padahal problem tenant-specific,
- half-open probe terlalu banyak/terlalu sedikit.

### 17.3 Evidence

- breaker state timeline,
- failure rate,
- slow call rate,
- permitted calls in half-open,
- fallback count,
- degraded success metric.

### 17.4 Mitigasi

- tune threshold,
- fix failure classification,
- expose degraded metrics,
- reset breaker only when evidence says downstream healthy,
- isolate breaker per dependency/operation/tenant if needed.

---

## 18. NAT / Ephemeral Port Exhaustion

### 18.1 Gejala

- Connect timeout/random connection failure.
- More visible under high outbound traffic.
- Many short-lived connections.
- Creating new client per request.
- Failure across multiple downstreams through same NAT.
- Cloud NAT port allocation errors.

### 18.2 Penyebab Umum

- no connection reuse,
- too many distinct destination IP/port,
- high retry rate,
- aggressive timeout causing churn,
- pool disabled or too many separate clients,
- NAT gateway capacity limit,
- TIME_WAIT accumulation.

### 18.3 Evidence

- outbound connection count,
- NAT gateway metrics,
- ephemeral port usage,
- TIME_WAIT socket count,
- client instance creation pattern,
- connection reuse metric.

Linux clues:

```bash
ss -tan state time-wait | wc -l
ss -tan | awk '{print $1}' | sort | uniq -c
```

### 18.4 Mitigasi

- reuse HTTP client,
- enable keep-alive,
- reduce connection churn,
- reduce retry,
- increase NAT capacity,
- spread traffic across NAT only if architecture supports,
- use HTTP/2 multiplexing if supported and safe.

---

## 19. Thread Starvation / Executor Saturation

### 19.1 Gejala

- Application latency naik semua endpoint.
- Thread pool full.
- Async callback terlambat.
- CompletableFuture chain tidak berjalan.
- Web server request threads blocked waiting downstream.
- CPU mungkin rendah tapi throughput turun.

### 19.2 Penyebab Umum

- blocking call di limited thread pool,
- async client memakai executor yang sama dengan application work,
- callback heavy CPU work di HTTP executor,
- too many concurrent downstream calls,
- no bulkhead,
- long timeout,
- downstream slow.

### 19.3 Evidence

- thread pool active/queue/reject count,
- thread dump,
- executor metrics,
- in-flight HTTP count,
- downstream latency,
- virtual thread pinned carrier evidence if relevant.

### 19.4 Mitigasi

- bulkhead per dependency,
- reduce concurrency,
- separate executor,
- fail fast,
- use virtual threads carefully for blocking I/O,
- avoid heavy callback on network executor,
- shorten timeout with proper fallback.

---

## 20. Memory / Heap Pressure from HTTP Client

### 20.1 Gejala

- Heap usage spikes during API calls.
- GC pause increases.
- OOM during large response/download.
- Many byte arrays/String allocations.
- Logs contain huge payload.

### 20.2 Penyebab Umum

- buffering large response as String,
- logging full body,
- JSON mapping huge list at once,
- retry stores body multiple times,
- response cache too large,
- multipart upload buffered in memory,
- no response size limit.

### 20.3 Evidence

- response size distribution,
- allocation profile,
- heap dump,
- GC logs,
- top allocation stack,
- body handler/converter choice.

### 20.4 Mitigasi

- stream to file,
- limit body size,
- paginate,
- use streaming parser,
- disable full body logging,
- cap cache,
- reject too-large response.

---

## 21. CPU Spike from HTTP Client

### 21.1 Gejala

- CPU high during outbound traffic.
- Latency increases without obvious downstream slowness.
- Profiling shows JSON parsing, compression, TLS, logging, regex, signature.

### 21.2 Penyebab Umum

- excessive serialization/deserialization,
- large JSON payload,
- compression/decompression cost,
- TLS handshake churn,
- no connection reuse,
- inefficient HMAC/canonicalization,
- verbose logging,
- high retry volume.

### 21.3 Evidence

- CPU profile/flame graph,
- request volume,
- payload size,
- TLS handshake rate,
- retry count,
- mapper allocation.

### 21.4 Mitigasi

- reuse connection,
- reduce handshake churn,
- optimize payload,
- stream parse,
- reduce logging,
- reduce retry,
- cache token/signing components where safe.

---

## 22. Incident Triage Matrix

Gunakan matrix ini untuk mempercepat diagnosis.

| Symptom | Likely Layer | First Evidence | Safe First Mitigation |
|---|---|---|---|
| `UnknownHostException` | DNS | resolver logs, DNS query, host | fix DNS / reduce DNS churn / restart only if cache stale |
| `ConnectTimeout` | network/LB/downstream accept | target health, route, SG/NACL | reduce concurrency, check route/LB |
| `Connection refused` | target port/service | LB target, service status | restore target/service |
| `SSLHandshakeException` | TLS/trust/cert | cert chain, truststore, SAN | restore cert/truststore |
| Pool acquire timeout | client pool | leased/available/pending | reduce concurrency, close leaks, tune pool |
| Read timeout | downstream slow | downstream latency, p99, DB | reduce retry/concurrency, circuit breaker |
| 401 spike | auth | token expiry/scope/secret | refresh/rotate/fix secret |
| 403 spike | permission | scopes/roles/allowlist | restore authorization |
| 429 spike | rate limit | request rate, retry count | throttle, obey Retry-After |
| 5xx spike | downstream/gateway | source of 5xx, downstream logs | circuit breaker, reduce load |
| JSON parse error | schema/body | content-type/body sample | compatibility fix |
| CPU spike | serialization/TLS/retry | flame graph, handshake rate | reduce retry/logging, reuse conn |
| Heap spike | buffering/body/logging | heap dump, response size | stream/limit body |
| Thread starvation | caller concurrency | thread dump/executor metrics | bulkhead/fail fast |
| NAT exhaustion | network egress | NAT metrics/TIME_WAIT | reuse client, reduce churn |

---

## 23. What to Check First: 10-Minute Playbook

Saat incident dimulai, jangan langsung membaca semua log random.

Ikuti urutan ini.

### Step 1 — Confirm User Impact

```text
Which user journey is failing?
What percentage?
Since when?
Is it error, latency, or stale/degraded response?
```

### Step 2 — Identify Dependency and Operation

```text
Which downstream?
Which endpoint/operation?
Which tenant/module/environment?
```

### Step 3 — Compare Traffic vs Failure

```text
Did traffic increase?
Did failure rate increase without traffic increase?
Did retry attempts increase?
Is batch/job involved?
```

### Step 4 — Split by Failure Type

```text
DNS?
connect?
TLS?
pool acquisition?
write?
read timeout?
HTTP status?
decode?
domain error?
```

### Step 5 — Check Recent Changes

```text
deployment
config
secret
certificate
DNS
LB/proxy
firewall
feature flag
downstream release
traffic pattern
```

### Step 6 — Protect Caller

```text
reduce concurrency
reduce retry
fail fast
open circuit
pause batch
activate fallback
```

### Step 7 — Collect Evidence Before Destroying It

Before restarting everything:

- capture thread dump,
- capture effective config,
- capture pool metrics,
- capture retry metrics,
- capture representative sanitized logs,
- capture downstream correlation IDs.

Restart may fix symptoms but erase evidence.

---

## 24. Metrics Checklist

A production-grade HTTP client should expose these metrics.

### 24.1 Request Metrics

```text
http.client.requests.total
http.client.request.duration
http.client.inflight
http.client.response.status
http.client.errors.total
```

Dimensions:

```text
dependency
operation
method
status_class
failure_type
environment
```

Avoid high-cardinality labels:

```text
full_url
raw_query
user_id
request_id
payload_hash
```

OpenTelemetry defines HTTP semantic conventions for spans/metrics/logs across HTTP versions and schemes, and warns that conventions evolve; treat the semantic convention version as part of your observability governance.

### 24.2 Phase Metrics

```text
dns.duration
connect.duration
tls.duration
pool.acquire.duration
request.write.duration
response.wait.duration
response.read.duration
```

Not every library exposes all phases natively. OkHttp `EventListener` is useful for lifecycle phase timing. JDK HttpClient may require wrapper-level metrics and JFR/system metrics.

### 24.3 Resilience Metrics

```text
retry.attempts
retry.exhausted
retry.budget.used
rate_limiter.rejected
bulkhead.rejected
circuit_breaker.state
circuit_breaker.calls
fallback.used
hedged.requests
```

### 24.4 Resource Metrics

```text
connection_pool.active
connection_pool.idle
connection_pool.pending
http_dispatcher.running
http_dispatcher.queued
executor.active
executor.queue.size
executor.rejected
heap.used
gc.pause
cpu.usage
```

### 24.5 Business Metrics

```text
external_submission.success
external_submission.pending
external_submission.duplicate
external_submission.reconciled
external_submission.failed_final
```

HTTP metrics alone are not enough for domain-critical systems.

---

## 25. Logging Checklist

### 25.1 What to Log

Log one structured event per outbound operation:

```json
{
  "event": "external_http_call",
  "dependency": "payment-api",
  "operation": "createPayment",
  "method": "POST",
  "route_template": "/v1/payments",
  "status": 503,
  "failure_type": "http_5xx",
  "retry_attempt": 2,
  "duration_ms": 842,
  "timeout_ms": 1000,
  "correlation_id": "...",
  "trace_id": "...",
  "idempotency_key_present": true
}
```

### 25.2 What Not to Log

Do not log:

- bearer token,
- API key,
- password,
- client secret,
- private key,
- full query string if it may contain secret,
- PII body,
- full document payload,
- raw certificate private material,
- full authorization header.

### 25.3 Recommended Log Events

```text
client_config_loaded
external_http_call_started (sampled)
external_http_call_completed
external_http_call_failed
retry_scheduled
retry_exhausted
circuit_opened
circuit_half_open
fallback_used
token_refresh_started
token_refresh_failed
body_decode_failed
```

### 25.4 Diagnostic Log Quality

Bad log:

```text
Failed calling API
```

Good log:

```text
External call failed: dependency=payment-api operation=createPayment phase=response_wait status=504 attempt=2 elapsedMs=1200 timeoutMs=1000 retryable=true correlationId=...
```

---

## 26. Tracing Checklist

Every outbound call should create/span or propagate trace context.

Span attributes should answer:

```text
Which dependency?
Which operation?
Which route template?
Which status code?
Which failure type?
How long?
Was retry involved?
Was fallback used?
```

Do not use full URL as span name.

Bad:

```text
GET https://api.example.com/customer/123456?token=abc
```

Good:

```text
HTTP GET customer-api GET /customers/{id}
```

Trace is useful during incident when you need to see:

```text
caller endpoint
→ outbound dependency
→ retry attempts
→ downstream latency
→ DB span in downstream
```

---

## 27. Thread Dump Playbook

When latency spikes or app appears stuck, capture thread dumps.

### 27.1 What to Look For

- many threads blocked waiting HTTP response,
- many threads waiting for connection pool,
- ForkJoinPool saturation,
- OkHttp dispatcher threads,
- Apache connection pool leasing,
- WebClient/reactor event loop blocked,
- virtual thread stack waiting on socket,
- synchronized token refresh lock contention.

### 27.2 Example Patterns

Potential connection pool wait:

```text
waiting for connection from pool
leaseConnection
connectionRequest.get
```

Potential downstream slow:

```text
SocketInputStream.socketRead
SSLSocketInputRecord.read
HttpClientImpl.send
```

Potential bad token refresh lock:

```text
BLOCKED on TokenProvider.refreshLock
```

### 27.3 Mitigation Based on Thread Dump

- If many threads blocked on same downstream: reduce concurrency/open circuit.
- If waiting for pool: fix leak/tune pool/reduce load.
- If token refresh lock: implement single-flight refresh correctly.
- If event loop blocked: move blocking work off event loop.

---

## 28. Safe Mitigation Catalogue

### 28.1 Reduce Concurrency

Best when:

- downstream overloaded,
- pool exhausted,
- retry storm,
- rate limit.

Effect:

```text
lower pressure
higher queue rejection if not managed
better downstream recovery chance
```

### 28.2 Disable or Reduce Retry

Best when:

- 429/503 spike,
- downstream saturated,
- duplicate side effects risk,
- retry storm.

Effect:

```text
less amplification
possibly more immediate failures
better system stability
```

### 28.3 Open Circuit / Fail Fast

Best when:

- dependency hard down,
- caller resources threatened,
- non-critical feature.

Effect:

```text
protects caller
reduces downstream load
requires clear user/degraded response
```

### 28.4 Activate Fallback

Best when:

- stale/cache/static response acceptable,
- read-only non-critical use case,
- business can tolerate degradation.

Dangerous when:

- command/write operation,
- legal/regulatory correctness required,
- stale data misleads users.

### 28.5 Increase Timeout

Best when:

- downstream latency increased but still within acceptable business SLA,
- caller has enough resource isolation,
- no retry storm,
- operation is important and users can wait.

Dangerous when:

- thread pool already saturated,
- downstream collapsing,
- timeout hides root cause,
- call is inside DB transaction.

### 28.6 Increase Pool Size

Best when:

- pool is undersized,
- downstream is healthy,
- caller has enough resources,
- connection limit is the bottleneck.

Dangerous when:

- downstream already slow,
- NAT ports limited,
- retry already high,
- no per-route isolation.

### 28.7 Pause Batch/Worker

Best when:

- background traffic competes with user traffic,
- 429/503 spike,
- downstream maintenance,
- backlog can be replayed safely.

### 28.8 Rollback

Best when:

- incident aligns with recent code/config change,
- rollback is known safe,
- schema/API compatibility still exists.

---

## 29. Unsafe Mitigations

Avoid these unless carefully justified:

```text
set timeout very high
increase retry count during downstream outage
increase pool size without downstream capacity evidence
turn off TLS validation
log full request/response body for debugging
pin IP permanently to bypass DNS
restart repeatedly without collecting evidence
clear token cache repeatedly causing auth storm
scale caller while downstream is bottleneck
turn fallback into silent success
```

Top engineers understand that some “fixes” reduce error messages while increasing system damage.

---

## 30. Library-Specific Incident Clues

## 30.1 JDK HttpClient

Relevant facts:

- `HttpClient` is reusable and typically manages its own connection pools.
- Creating a new client per request usually prevents connection reuse.
- `connectTimeout` applies to establishing new connection, not total call duration.
- Async API returns `CompletableFuture`.

Check:

```text
Are we reusing HttpClient?
Do we set per-request timeout?
Do CompletableFuture callbacks run on intended executor?
Are requests cancelled on caller timeout?
Are we distinguishing HttpTimeoutException vs InterruptedException vs IOException?
```

---

## 30.2 OkHttp

Relevant clues:

- Reuse `OkHttpClient`.
- `newBuilder()` shares connection pool/thread pools with parent client.
- `Dispatcher` exposes running/queued calls.
- `ConnectionPool` exposes connection/idle counts.
- `EventListener` exposes lifecycle timing.
- OkHttp may recover from certain connectivity problems, but semantic retry remains application responsibility.

Check:

```text
Dispatcher queuedCallsCount
Dispatcher runningCallsCount
ConnectionPool connectionCount
ConnectionPool idleConnectionCount
interceptor order
authenticator loop
response body close
callTimeout/readTimeout/writeTimeout/connectTimeout
```

---

## 30.3 Retrofit

Retrofit incident usually comes from:

```text
underlying OkHttp config
converter failure
annotation/path/query mismatch
error body not parsed
base URL/trailing slash
CallAdapter behavior
```

Check:

```text
Which OkHttpClient is used?
Is baseUrl correct?
Is errorBody consumed safely?
Does converter tolerate response evolution?
Does interface annotation encode path/query correctly?
```

---

## 30.4 Apache HttpClient 5

Check:

```text
PoolingHttpClientConnectionManager stats
max total
max per route
leased/available/pending
connection request timeout
response timeout
connect timeout
idle eviction
entity consumed/closed
route planner/proxy
TLS strategy
```

Apache is very powerful for enterprise control, but configuration mistakes can create subtle pool and timeout problems.

---

## 30.5 Spring RestTemplate / RestClient / WebClient

Check:

```text
Which underlying request factory/client connector?
Are timeouts configured on the actual engine?
Is WebClient event loop blocked?
Is RestClient using expected ClientHttpRequestFactory?
Are observation/metrics enabled?
Are errors mapped consistently?
```

For Spring, abstraction can hide transport details. During incident, find the actual engine.

---

## 31. Incident Timeline Reconstruction

For postmortem-quality diagnosis, build a timeline.

Example:

```text
09:58 Deployment v42 started
10:01 Error rate for payment-api createPayment increased from 0.2% to 12%
10:03 Retry attempts increased 4x
10:05 Downstream 503 increased
10:07 Caller thread pool saturation started
10:09 Circuit breaker opened
10:12 Batch job paused
10:15 Error rate dropped to 3%
10:22 Rollback completed
10:25 Error rate normalized
```

Timeline should correlate:

- deployment,
- config change,
- traffic change,
- DNS/cert/secret change,
- error rate,
- latency,
- retry,
- pool pressure,
- mitigation,
- recovery.

Without timeline, teams often argue from memory instead of evidence.

---

## 32. Postmortem Template for HTTP Client Incident

Use this structure.

```markdown
# Incident: <dependency> <operation> HTTP client failure

## Summary
What happened in 3–5 sentences.

## Impact
- User journeys affected:
- Time window:
- Error rate / latency:
- Data consistency impact:
- SLA/SLO impact:

## Timeline
- HH:MM event
- HH:MM detection
- HH:MM mitigation
- HH:MM recovery

## Detection
- Which alert fired?
- Which dashboard/log revealed it?
- Was detection delayed?

## Root Cause
- Immediate technical cause:
- Contributing factors:
- Why safeguards failed:

## Failure Classification
- DNS/connect/TLS/pool/write/read/status/decode/domain/policy/resource:

## Mitigation
- What was done:
- Why it worked:
- Side effects:

## What Went Well
- ...

## What Went Wrong
- ...

## Where We Got Lucky
- ...

## Action Items
| Action | Owner | Due | Type |
|---|---|---|---|
| Add pool acquire metric | ... | ... | prevention |
| Add circuit breaker for operation X | ... | ... | blast-radius |
| Add contract test for enum evolution | ... | ... | detection |
| Add runbook for 429 spike | ... | ... | response |
```

---

## 33. Action Item Quality

Bad action item:

```text
Monitor better.
```

Good action item:

```text
Add `dependency=payment-api,operation=createPayment,failure_type` metric with alert when 5xx rate > 5% for 5 minutes and retry attempts > 2x baseline.
```

Bad:

```text
Increase timeout.
```

Good:

```text
Set createPayment total deadline to 1500ms, per-attempt response timeout to 700ms, max 1 retry only for idempotent failures with Idempotency-Key, and expose timeout phase metric.
```

Bad:

```text
Fix retry.
```

Good:

```text
Implement retry budget capped at 10% of original request volume per dependency, full jitter backoff, and disable retry on POST without idempotency key.
```

---

## 34. Production Readiness Review Before Next Incident

A robust HTTP client should be able to answer:

```text
Which downstreams do we call?
Which operations are critical?
What timeout is used per operation?
What retry policy is used per operation?
Which operations are idempotent?
What is max concurrency per dependency?
What is max queue size?
What happens when downstream is slow?
What happens when downstream is down?
What happens when token expires?
What happens when DNS changes?
What happens when cert rotates?
What metrics prove the client is healthy?
What logs diagnose failure without leaking data?
What dashboard shows dependency health?
What runbook does on-call follow?
```

If these answers are missing, the client is not production-grade yet.

---

## 35. Example: Diagnose 504 Spike

Scenario:

```text
User reports submission is slow.
Dashboard shows 504 from external-case-api.
```

Diagnosis flow:

```text
1. Confirm impact:
   submission endpoint p95 from 800ms to 9s.

2. Classify:
   HTTP status 504, not DNS/connect/TLS.

3. Identify source:
   504 generated by gateway, not Java client exception.

4. Check retry:
   retry attempts increased from 1.05 to 2.8 per operation.

5. Check concurrency:
   caller in-flight outbound calls 5x baseline.

6. Check downstream:
   downstream DB CPU high and queue depth high.

7. Mitigation:
   pause batch submission job,
   reduce retry max attempts from 3 to 1,
   open circuit for non-critical status polling,
   keep critical submission with idempotency key and short deadline.

8. Recovery:
   downstream latency normalizes,
   caller thread pool recovers,
   error rate drops.
```

Conclusion:

```text
Root cause may be downstream saturation, but caller retry and batch traffic amplified it.
```

---

## 36. Example: Diagnose Pool Exhaustion

Scenario:

```text
Only one dependency is slow. Error logs show connection request timeout.
```

Diagnosis:

```text
1. Check pool stats:
   leased=max, pending high, available=0.

2. Check downstream latency:
   p99 high.

3. Check response body lifecycle:
   recent release added error logging but forgot to close error body.

4. Check traffic:
   normal traffic, no major increase.

5. Mitigation:
   rollback release,
   reduce concurrency,
   restart only after evidence captured.

6. Permanent fix:
   try-with-resources / body close guarantee,
   leak test with MockWebServer,
   pool acquire duration metric,
   static analysis/code review checklist.
```

---

## 37. Example: Diagnose 401 Storm

Scenario:

```text
Third-party API returns 401 for many calls after secret rotation.
```

Diagnosis:

```text
1. Check auth token acquisition:
   token endpoint returns invalid_client.

2. Check secret version:
   app still using old secret from stale mounted config.

3. Check token cache:
   failed refresh triggers refresh per request.

4. Impact:
   token endpoint overwhelmed by refresh storm.

5. Mitigation:
   restore correct secret,
   clear token cache once,
   throttle token refresh,
   enable single-flight refresh.

6. Permanent fix:
   secret version metric,
   startup validation,
   token refresh lock with backoff,
   alarm on token_refresh_failed.
```

---

## 38. Example: Diagnose TLS Rotation Failure

Scenario:

```text
After downstream certificate rotation, calls fail with PKIX path building failed.
```

Diagnosis:

```text
1. Capture certificate chain using openssl.
2. Compare issuer with truststore.
3. Check intermediate certificate.
4. Check SAN/hostname.
5. Check app truststore config.
6. Confirm if only Java clients fail or all clients fail.
```

Mitigation:

```text
restore intermediate chain server-side
or update truststore
or rollback certificate
```

Permanent fix:

```text
certificate expiry monitoring
pre-prod cert rotation rehearsal
truststore governance
dependency owner notification
```

---

## 39. Decision Tree: Fast Classification

```text
Outbound call failed
|
+-- Did request fail before HTTP status?
|   |
|   +-- UnknownHostException → DNS
|   +-- ConnectException/ConnectTimeout → network/LB/target
|   +-- SSLHandshakeException → TLS/trust/cert
|   +-- Pool timeout → connection pool/resource
|   +-- Write failure → upload/body/network close
|
+-- HTTP status exists?
|   |
|   +-- 4xx
|   |   +-- 400/422 → request/schema
|   |   +-- 401 → authentication
|   |   +-- 403 → authorization
|   |   +-- 404 → route/version/resource
|   |   +-- 409 → conflict/idempotency
|   |   +-- 429 → rate limit
|   |
|   +-- 5xx
|       +-- 500 → downstream internal
|       +-- 502/503 → gateway/downstream unavailable
|       +-- 504 → timeout at gateway/downstream path
|
+-- Status success but client failed?
|   |
|   +-- Decode failure → schema/content-type/body
|   +-- Semantic failure → domain contract
|   +-- Empty/partial body → contract/transport truncation
|
+-- Caller unhealthy too?
    |
    +-- Thread starvation
    +-- Pool exhaustion
    +-- Memory/GC pressure
    +-- Retry storm
    +-- NAT exhaustion
```

---

## 40. On-Call Runbook: Minimal Version

```markdown
# HTTP Client Incident Runbook

## 1. Identify
- Dependency:
- Operation:
- Environment:
- Start time:
- User impact:

## 2. Classify
- Failure phase:
- HTTP status:
- Exception class:
- Retry involved:
- Timeout involved:

## 3. Check Dashboards
- request rate
- error rate
- latency p95/p99
- retry attempts
- circuit state
- pool active/idle/pending
- executor/thread saturation
- downstream health

## 4. Check Recent Changes
- app deploy
- config change
- secret rotation
- cert rotation
- DNS/LB/proxy/firewall
- downstream deploy
- traffic/batch job

## 5. Stabilize
- reduce concurrency
- reduce/disable retry
- pause batch
- open circuit
- activate safe fallback
- rollback if correlated

## 6. Preserve Evidence
- logs
- trace IDs
- thread dump
- config snapshot
- pool metrics
- downstream correlation IDs

## 7. Recover
- validate error rate
- validate latency
- validate business consistency
- resume traffic gradually

## 8. Follow-Up
- postmortem
- action items
- tests
- metrics/alerts
- runbook update
```

---

## 41. Design Heuristics: Top 1% HTTP Client Operations

### Heuristic 1 — Every Failure Must Have a Phase

Bad:

```text
external API failed
```

Good:

```text
external API failed during TLS handshake
external API failed during pool acquisition
external API returned 429
external API returned invalid business status
```

---

### Heuristic 2 — Every Retry Must Have a Budget

No budget means retry can become an outage multiplier.

---

### Heuristic 3 — Every Fallback Must Be Observable

Fallback is not success. It is degraded success.

---

### Heuristic 4 — Every Timeout Must Correspond to Business Tolerance

A timeout value is not technical only. It encodes how long the business operation may wait.

---

### Heuristic 5 — Pool Metrics Are Not Optional

Without pool metrics, many latency incidents look like downstream slowness even when the caller is starving itself.

---

### Heuristic 6 — Do Not Debug Security by Removing Security

Never “temporarily” trust all certificates in production.

---

### Heuristic 7 — Separate User Traffic and Background Traffic

Batch retries should not destroy interactive user flows.

---

### Heuristic 8 — Error Rate Without Attempt Rate Is Misleading

A 10% error rate at 1x traffic is different from 10% at 5x retry-amplified traffic.

---

### Heuristic 9 — HTTP Success Does Not Mean Business Success

Especially for workflows, payments, cases, approvals, submissions, or integrations with asynchronous processing.

---

### Heuristic 10 — Runbook Is Part of the Client Design

If no one knows what to do when the dependency fails, the client is incomplete.

---

## 42. Summary

HTTP client production incident diagnosis requires a layered model:

```text
configuration
→ request construction
→ DNS
→ proxy/routing
→ pool
→ TCP
→ TLS
→ write
→ wait/read
→ HTTP status
→ body decode
→ domain semantic
→ client policy
→ caller resource
```

The main operational skill is to avoid vague explanations like:

```text
API timeout
API down
network issue
intermittent error
```

and replace them with precise classification:

```text
pool acquisition timeout due to response body leak
read timeout after downstream DB saturation amplified by retry storm
TLS handshake failure due to missing intermediate certificate after cert rotation
429 spike due to batch job exceeding per-tenant quota and ignoring Retry-After
401 storm due to failed token refresh without single-flight protection
```

A top-tier engineer does three things during incident:

```text
1. Protect the caller.
2. Classify the failure precisely.
3. Convert the incident into better controls, metrics, tests, and runbooks.
```

That is the difference between fixing one outage and improving the system.

---

## 43. Part 29 Checklist

Sebelum lanjut, pastikan kamu bisa menjawab:

- Bisa membedakan DNS, connect, TLS, pool, write, read, status, decode, dan domain failure?
- Bisa menentukan mitigasi aman untuk retry storm?
- Bisa membaca gejala pool exhaustion?
- Bisa membedakan 401, 403, 429, 503, dan 504 secara operasional?
- Bisa menjelaskan kenapa menaikkan timeout sering berbahaya?
- Bisa menjelaskan kenapa menaikkan pool size sering berbahaya?
- Bisa membuat structured log untuk outbound call?
- Bisa membuat postmortem action item yang konkret?
- Bisa membuat runbook on-call untuk dependency tertentu?
- Bisa menjaga agar fallback tidak menyembunyikan incident?

Jika iya, kamu sudah punya fondasi operasional yang kuat untuk HTTP client engineering.

---

## 44. Posisi dalam Series

Sudah selesai:

```text
Part 0  — Orientation: HTTP Client sebagai Production Subsystem, Bukan Utility
Part 1  — Java HTTP Client Landscape di Java 8–25
Part 2  — Request Lifecycle Deep Dive: Dari Method Call Sampai Response Body
Part 3  — URI, URL, Encoding, Query Parameter, dan Canonical Request
Part 4  — Headers, Content Negotiation, Compression, dan Metadata Contract
Part 5  — Body Handling: JSON, Form, Multipart, Streaming, File Upload/Download
Part 6  — Timeout Engineering: Connect, Read, Write, Call, Pool, DNS, TLS
Part 7  — Connection Pooling, Keep-Alive, HTTP/2 Multiplexing, dan Resource Reuse
Part 8  — DNS, Proxy, Load Balancer, NAT, dan Network Topology Awareness
Part 9  — TLS, mTLS, Trust Store, Key Store, ALPN, Certificate Pinning
Part 10 — Authentication Client-Side: Basic, Bearer, OAuth2, API Key, HMAC, Token Refresh
Part 11 — Retry Engineering: Idempotency, Backoff, Jitter, Retry Budget, dan Hedging
Part 12 — Rate Limiting, Throttling, Bulkhead, dan Client-Side Load Shedding
Part 13 — Circuit Breaker, Timeout, Retry, dan Fallback Composition
Part 14 — JDK HttpClient Deep Dive
Part 15 — OkHttp Deep Dive: Client, Dispatcher, Interceptor, ConnectionPool
Part 16 — Retrofit Deep Dive: Type-Safe API Client di Atas OkHttp
Part 17 — Apache HttpClient 5 Deep Dive
Part 18 — Spring HTTP Client Layer: RestTemplate, WebClient, RestClient
Part 19 — API Client Architecture: Port, Adapter, Gateway, SDK, Anti-Corruption Layer
Part 20 — Error Modelling: Status Code, Transport Failure, Protocol Failure, Domain Failure
Part 21 — Observability: Logging, Metrics, Tracing, Correlation, Redaction
Part 22 — Testing HTTP Clients: Unit, Contract, Integration, Chaos, Mock Server
Part 23 — JSON/XML Mapping for HTTP Client Boundary
Part 24 — Performance Engineering: Throughput, Latency, Allocation, GC, Threading
Part 25 — Virtual Threads, CompletableFuture, Reactive, dan Structured Concurrency
Part 26 — Security Hardening for HTTP Clients
Part 27 — Generated Clients: OpenAPI, Codegen, SDK Governance
Part 28 — Client Configuration Management: Environment, Tenant, Endpoint, Secret, Feature Flag
Part 29 — Production Failure Playbook: Diagnosis and Incident Response
```

Berikutnya:

```text
Part 30 — Migration Patterns: Legacy Client ke Modern Client
File: 30-migration-patterns-legacy-client-to-modern-client.md
```

Series belum selesai.


<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 28 — Client Configuration Management: Environment, Tenant, Endpoint, Secret, Feature Flag](./28-client-configuration-management-environment-tenant-endpoint-secret-featureflag.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 30 — Migration Patterns: Legacy Client ke Modern Client](./30-migration-patterns-legacy-client-to-modern-client.md)
