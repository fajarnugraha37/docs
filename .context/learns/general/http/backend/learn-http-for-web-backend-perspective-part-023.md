# learn-http-for-web-backend-perspective-part-023.md

# Part 023 — Reverse Proxies, Gateways, Load Balancers, and Trust Boundaries

> Seri: **HTTP for Web/Backend Perspective**  
> Target pembaca: **Java Software Engineer / Backend Engineer**  
> Fokus: memahami bagaimana reverse proxy, API gateway, load balancer, CDN, ingress, dan service mesh mengubah realitas HTTP yang dilihat aplikasi backend.

---

## 0. Posisi Part Ini dalam Seri

Sampai Part 022, kita sudah membahas HTTP dari sisi semantics, body, header, cache, auth, idempotency, timeout, streaming, dan versi protokol. Sekarang kita masuk ke realita production yang sering disalahpahami:

> Backend service jarang menerima request langsung dari client asli.

Biasanya request melewati beberapa lapisan:

```text
Client / Browser / Mobile / Partner
        |
        v
DNS / CDN / WAF
        |
        v
Load Balancer
        |
        v
Reverse Proxy / API Gateway / Ingress
        |
        v
Service Mesh Sidecar / Internal Proxy
        |
        v
Java Application Server
        |
        v
Spring MVC / WebFlux Handler
```

Akibatnya, informasi yang dilihat aplikasi seperti:

- client IP,
- scheme `http` vs `https`,
- host,
- port,
- original path,
- request size,
- protocol version,
- TLS state,
- timeout,
- status code,
- body buffering,
- retry behavior,
- trace header,
- auth result,

sering **bukan informasi asli dari client**, tetapi hasil transformasi oleh layer di depan aplikasi.

Top 1% backend engineer tidak hanya bertanya:

> “Controller ini menerima request apa?”

Tetapi juga:

> “Metadata request ini berasal dari siapa, dipercaya oleh siapa, ditransformasi di mana, dan konsekuensinya apa jika salah?”

---

## 1. Learning Objectives

Setelah menyelesaikan bagian ini, kamu harus mampu:

1. Membedakan reverse proxy, forward proxy, load balancer, API gateway, ingress, CDN, WAF, dan service mesh.
2. Menjelaskan kenapa backend harus memiliki **explicit trust boundary** untuk HTTP metadata.
3. Mendesain kebijakan penggunaan `Forwarded`, `X-Forwarded-*`, `Host`, `X-Real-IP`, dan correlation headers.
4. Mendiagnosis `502`, `503`, `504`, redirect salah scheme, absolute URL salah host, client IP salah, dan CORS/auth issue akibat proxy.
5. Menentukan logic mana yang sebaiknya ada di edge/gateway dan logic mana yang harus tetap di aplikasi.
6. Menghindari vulnerability dari spoofed headers, host header injection, open redirect, cache poisoning, request smuggling, dan auth bypass.
7. Mengonfigurasi Spring Boot agar sadar forwarded headers dengan aman.
8. Mendesain request path, timeout, header propagation, dan observability secara end-to-end.

---

## 2. Mental Model Utama: HTTP Is Hop-by-Hop in Transport, End-to-End in Semantics

Secara konseptual, client melakukan request ke resource. Tetapi secara fisik, request bisa melewati banyak hop.

```text
Browser
  --HTTP/3--> CDN
  --HTTP/2--> Load Balancer
  --HTTP/1.1--> Nginx Ingress
  --HTTP/1.1--> Service Mesh Sidecar
  --HTTP/1.1--> Spring Boot App
```

Semantics HTTP seperti method, target resource, status, caching, dan representation tetap end-to-end secara desain. Namun banyak detail transport bersifat per-hop:

- connection,
- TLS termination,
- protocol version,
- compression,
- buffering,
- keep-alive,
- timeout,
- retry,
- hop-by-hop headers,
- upstream selection.

Ini membuat backend harus selalu bertanya:

> “Apakah nilai yang saya pakai ini berasal dari end client, proxy terpercaya, atau input tidak terpercaya?”

Contoh sederhana:

```http
X-Forwarded-Proto: https
X-Forwarded-For: 203.0.113.10
Host: api.example.com
```

Nilai tersebut sangat berguna jika dibuat oleh load balancer terpercaya. Tetapi berbahaya jika client publik boleh mengirimkannya langsung dan aplikasi mempercayainya.

---

## 3. Reverse Proxy vs Forward Proxy

### 3.1 Forward Proxy

Forward proxy berada di sisi client.

```text
Client --> Forward Proxy --> Internet --> Server
```

Contoh penggunaan:

- corporate proxy,
- egress filtering,
- anonymization,
- developer debugging proxy,
- outbound allowlist.

Server biasanya tidak mengontrol forward proxy.

### 3.2 Reverse Proxy

Reverse proxy berada di sisi server.

```text
Client --> Reverse Proxy --> Backend Server
```

Contoh:

- Nginx,
- Envoy,
- HAProxy,
- AWS ALB,
- API Gateway,
- Kubernetes Ingress,
- Cloudflare/CDN edge.

Reverse proxy menerima request atas nama backend, lalu meneruskannya ke upstream.

Tanggung jawab reverse proxy bisa mencakup:

- TLS termination,
- routing,
- load balancing,
- compression,
- caching,
- rate limiting,
- request size limits,
- header rewriting,
- path rewriting,
- health checks,
- access logging,
- WAF/security filtering,
- upstream retry,
- timeout enforcement.

### 3.3 Kenapa Reverse Proxy Mengubah Cara Backend Berpikir

Tanpa proxy:

```text
client_ip = socket.remoteAddress
scheme    = request.scheme
host      = Host header
port      = local port
```

Dengan proxy:

```text
socket.remoteAddress = proxy IP
request.scheme       = scheme antara proxy dan app, sering http
host                 = mungkin host internal
port                 = port internal
client_ip            = harus dibaca dari forwarded metadata, jika trusted
```

Jika aplikasi tidak sadar proxy, bug yang muncul sering berupa:

- redirect dari `https://` menjadi `http://`,
- generated link memakai internal hostname,
- audit log mencatat IP load balancer, bukan client,
- rate limit semua user dianggap satu IP,
- callback URL salah,
- cookie `Secure`/domain/path salah,
- CORS allowlist salah,
- OAuth redirect URI mismatch,
- SAML assertion mismatch,
- tenant resolution dari host salah,
- security check bisa dibypass via spoofed header.

---

## 4. Load Balancer

Load balancer mendistribusikan traffic ke beberapa backend.

```text
Client --> Load Balancer --> App instance A
                         --> App instance B
                         --> App instance C
```

### 4.1 Layer 4 vs Layer 7

#### Layer 4 Load Balancing

Beroperasi pada TCP/UDP.

Ciri:

- tidak memahami HTTP semantics secara penuh,
- routing berdasarkan IP/port,
- bisa lebih sederhana dan cepat,
- TLS bisa pass-through,
- backend melihat koneksi lebih dekat ke client/proxy sebelumnya.

Contoh use case:

- high-throughput TCP,
- TLS pass-through,
- non-HTTP services,
- database proxying tertentu.

#### Layer 7 Load Balancing

Beroperasi pada HTTP.

Ciri:

- memahami method/path/header/host,
- bisa path-based routing,
- host-based routing,
- header-based routing,
- TLS termination,
- WAF,
- HTTP/2 termination,
- request/response header modification,
- health check HTTP.

Untuk aplikasi HTTP API modern, L7 load balancing sangat umum.

### 4.2 Load Balancing Algorithms

Beberapa strategi umum:

| Strategy | Makna | Risiko |
|---|---|---|
| Round-robin | Request dibagi bergantian | Tidak memperhitungkan latency/beban aktual |
| Least connections | Pilih server dengan koneksi paling sedikit | Koneksi panjang bisa memengaruhi distribusi |
| Least response time | Pilih upstream respons tercepat | Bisa bias jika metric tidak stabil |
| Hash-based | Berdasarkan client IP/header/cookie | Bisa hotspot |
| Weighted | Instance diberi bobot | Perlu tuning manual/dinamis |

### 4.3 Sticky Session

Sticky session membuat request client yang sama diarahkan ke instance yang sama.

```text
Client A --> App 1
Client A --> App 1
Client A --> App 1
```

Kapan berguna:

- legacy app menyimpan session in-memory,
- WebSocket/long-lived connection tertentu,
- migrasi bertahap.

Kapan berbahaya:

- menutupi desain stateful yang rapuh,
- menghambat horizontal scaling,
- failover buruk,
- instance hotspot,
- rolling deployment rumit.

Untuk backend modern, lebih baik session disimpan di shared store atau token/session architecture yang tidak bergantung pada instance tertentu.

---

## 5. API Gateway

API gateway adalah reverse proxy yang biasanya membawa policy layer untuk API.

```text
Client --> API Gateway --> Service A
                      --> Service B
                      --> Service C
```

Tanggung jawab gateway bisa mencakup:

- routing,
- authentication pre-check,
- authorization coarse-grained,
- rate limiting,
- quota,
- request transformation,
- response transformation,
- schema validation,
- CORS,
- API key management,
- request signing validation,
- logging,
- metrics,
- canary routing,
- version routing,
- developer portal integration.

### 5.1 Gateway Bukan Pengganti Aplikasi

Gateway bagus untuk policy yang seragam dan dekat edge.

Namun aplikasi tetap harus menjaga invariant domain:

| Concern | Gateway | Application |
|---|---:|---:|
| TLS termination | Ya | Kadang internal TLS juga |
| Basic request size limit | Ya | Ya, per endpoint/domain |
| Authentication token verification | Bisa | Tetap validasi trust boundary |
| Coarse route authorization | Bisa | Ya |
| Object-level authorization | Tidak cukup | Wajib |
| Domain invariant | Tidak | Wajib |
| Transaction boundary | Tidak | Wajib |
| Idempotency operation | Kadang | Wajib untuk correctness |
| Audit semantic | Bantuan | Wajib |
| Error taxonomy domain | Tidak | Wajib |

Kesalahan fatal:

> “Gateway sudah authorize, jadi service tidak perlu cek lagi.”

Ini membuka risiko lateral movement, misconfiguration, internal bypass, dan BOLA.

---

## 6. CDN dan WAF

### 6.1 CDN

CDN berada dekat user dan dapat cache response.

```text
Browser --> CDN Edge --> Origin Gateway --> Backend
```

Fungsi:

- cache static/dynamic content,
- TLS termination,
- DDoS absorption,
- geo routing,
- compression,
- image optimization,
- edge redirects,
- origin shielding.

Backend harus sadar CDN karena:

- `Cache-Control` bisa dipakai oleh shared cache,
- `Vary` menentukan cache key,
- authorization response bisa bocor jika cache header salah,
- invalidation tidak selalu instan,
- CDN bisa mengubah header,
- CDN bisa serve stale response,
- real client IP perlu header khusus dari CDN.

### 6.2 WAF

Web Application Firewall memfilter traffic berdasarkan rule.

Contoh yang bisa diblok:

- SQL injection patterns,
- XSS patterns,
- path traversal,
- known exploit signatures,
- bad bots,
- oversized payloads,
- suspicious headers.

WAF membantu, tapi bukan pengganti secure coding. Backend tetap harus melakukan validation, authorization, output encoding sesuai konteks, dan safe parser configuration.

---

## 7. Kubernetes Ingress

Di Kubernetes, aplikasi biasanya tidak langsung menerima traffic publik.

```text
Client
  -> Cloud Load Balancer
  -> Ingress Controller
  -> Kubernetes Service
  -> Pod
```

Ingress controller bisa berupa:

- Nginx Ingress,
- Traefik,
- HAProxy,
- Envoy-based ingress,
- cloud-provider ingress controller.

Tanggung jawab ingress:

- route host/path,
- TLS termination,
- path rewrite,
- request size limit,
- proxy timeout,
- CORS/header config,
- WebSocket/SSE support,
- upstream health behavior.

### 7.1 Common Ingress Bugs

1. Path rewrite membuat aplikasi melihat path berbeda dari path publik.
2. `X-Forwarded-Prefix` tidak dipakai, sehingga generated link salah.
3. Upload besar gagal karena body limit ingress lebih kecil dari app.
4. SSE tidak jalan karena proxy buffering.
5. WebSocket gagal karena upgrade header tidak diteruskan.
6. OAuth redirect URI salah karena app tidak tahu external scheme/host.
7. Timeout ingress lebih pendek dari aplikasi, menyebabkan client mendapat 504 meski app masih bekerja.
8. Health check endpoint terlalu mahal sehingga memperburuk overload.

---

## 8. Service Mesh and Sidecar Proxy

Service mesh menambahkan proxy internal di dekat service.

```text
Service A App -> Sidecar A -> Sidecar B -> Service B App
```

Contoh capability:

- mTLS internal,
- retries,
- circuit breaking,
- traffic splitting,
- telemetry,
- policy,
- service discovery,
- timeout,
- outlier detection.

### 8.1 Double Retry Problem

Misalnya:

- client SDK retry 2x,
- gateway retry 2x,
- service mesh retry 2x,
- application retry DB/downstream 2x.

Total amplification bisa menjadi:

```text
2 x 2 x 2 x 2 = 16 attempts
```

Saat downstream overload, retry berlapis bisa memperparah outage.

Rule:

> Retry harus didesain sebagai budget end-to-end, bukan fitur independen di setiap layer.

### 8.2 Mesh Does Not Remove HTTP Semantics

Service mesh bisa mengelola transport dan policy, tetapi tidak tahu penuh domain semantics:

- apakah POST aman di-retry?
- apakah operation idempotent?
- apakah user boleh melihat resource ini?
- apakah status 409 harus dianggap business conflict?
- apakah response boleh di-cache?

Aplikasi tetap menjadi authority atas semantics domain.

---

## 9. Host, Authority, Scheme, and Absolute URL

RFC 9110 menjelaskan bahwa `Host` di HTTP/1.1 dan `:authority` di HTTP/2/HTTP/3 menyediakan host/port dari target URI agar origin server bisa membedakan resource untuk banyak host. Dalam HTTP/2 dan HTTP/3, `:authority` dapat menggantikan `Host` dalam control data request.

### 9.1 Kenapa Host Penting

`Host` bisa dipakai untuk:

- virtual hosting,
- tenant resolution,
- absolute URL generation,
- redirect target,
- canonical URL,
- CORS origin matching,
- cookie domain logic,
- security checks,
- cache key,
- API version routing.

### 9.2 Host Header Injection

Jika aplikasi memakai `Host` mentah dari request untuk membangun URL:

```java
String resetLink = "https://" + request.getHeader("Host") + "/reset?token=" + token;
```

Penyerang bisa mengirim:

```http
Host: attacker.example
```

Lalu email reset password berisi link ke domain attacker.

Mitigasi:

1. Gunakan configured public base URL, bukan raw Host.
2. Allowlist host yang valid.
3. Validasi host di edge.
4. Jangan pakai untrusted host untuk security-sensitive link.
5. Di multi-tenant system, tenant-host mapping harus berdasarkan registry internal.

### 9.3 Scheme Confusion

Aplikasi di belakang TLS-terminating proxy sering melihat request internal sebagai HTTP:

```text
Client --HTTPS--> LB --HTTP--> App
```

Jika aplikasi tidak memakai forwarded scheme, ia bisa menghasilkan redirect:

```http
Location: http://api.example.com/login
```

Akibat:

- mixed content,
- OAuth/SAML callback mismatch,
- cookie `Secure` behavior salah,
- HSTS expectation rusak,
- redirect loop.

Mitigasi:

- edge menulis `Forwarded: proto=https` atau `X-Forwarded-Proto: https`,
- aplikasi hanya mempercayainya dari proxy terpercaya,
- Spring forwarded header processing dikonfigurasi dengan benar,
- public base URL untuk callback/security-sensitive URL dikonfigurasi eksplisit.

---

## 10. Forwarded and X-Forwarded Headers

### 10.1 RFC 7239 `Forwarded`

`Forwarded` adalah header standar untuk membawa informasi yang hilang ketika melewati proxy.

Contoh:

```http
Forwarded: for=203.0.113.10;proto=https;host=api.example.com
```

Parameter umum:

- `for`: client/proxy sebelumnya,
- `proto`: original protocol,
- `host`: original host,
- `by`: proxy interface.

### 10.2 De Facto `X-Forwarded-*`

Di production, header non-standar ini masih sangat umum:

```http
X-Forwarded-For: 203.0.113.10, 10.0.0.12
X-Forwarded-Proto: https
X-Forwarded-Host: api.example.com
X-Forwarded-Port: 443
X-Forwarded-Prefix: /api
X-Real-IP: 203.0.113.10
```

AWS ALB misalnya mendokumentasikan `X-Forwarded-Proto` untuk mengidentifikasi protocol yang digunakan client saat connect ke load balancer, karena access log server backend biasanya hanya melihat protocol antara load balancer dan backend.

### 10.3 X-Forwarded-For Chain

Contoh:

```http
X-Forwarded-For: 198.51.100.7, 203.0.113.20, 10.0.0.5
```

Interpretasi tergantung policy:

```text
client, proxy1, proxy2
```

Tetapi jangan asal ambil nilai pertama. Client bisa mengirim nilai palsu jika edge tidak menghapus header incoming.

Policy yang benar:

1. Edge publik harus menghapus `X-Forwarded-*` dari client.
2. Edge kemudian menulis header baru.
3. Setiap trusted proxy menambahkan dirinya sesuai aturan.
4. Aplikasi hanya melakukan parsing berdasarkan daftar trusted proxy.
5. Jika chain tidak sesuai, fallback/reject sesuai risk appetite.

### 10.4 Trust Boundary Rule

Rule utama:

> Jangan pernah mempercayai forwarded headers kecuali request berasal dari proxy terpercaya yang menghapus header spoofed dari external client.

Spring documentation juga memberi peringatan keamanan: forwarded headers tidak boleh digunakan kecuali aplikasi berada di belakang trusted proxy yang memasukkan header tersebut dan secara eksplisit menghapus header yang datang dari external source.

---

## 11. Spring Boot and Forwarded Headers

### 11.1 Problem

Aplikasi Spring di belakang proxy perlu tahu external:

- scheme,
- host,
- port,
- context path/prefix,
- remote address,
- redirect URL.

Jika tidak, method seperti ini bisa salah:

```java
request.getScheme();
request.getServerName();
request.getServerPort();
request.isSecure();
response.sendRedirect(...);
```

### 11.2 ForwardedHeaderFilter

Spring `ForwardedHeaderFilter` mengekstrak nilai dari `Forwarded` dan `X-Forwarded-*`, lalu membungkus request/response agar method seperti `getServerName()`, `getServerPort()`, `getScheme()`, `isSecure()`, dan `sendRedirect(...)` merefleksikan protocol/address original client.

Namun filter ini harus dipakai dalam boundary yang benar. Jika edge tidak membersihkan spoofed header, filter justru membuat aplikasi mempercayai input attacker.

### 11.3 Configuration Direction

Contoh konseptual Spring Boot:

```properties
server.forward-headers-strategy=framework
```

Atau gunakan native container/proxy integration jika sesuai deployment.

Namun konfigurasi aplikasi saja tidak cukup. Harus ada konfigurasi edge:

```nginx
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
```

Dan lebih penting lagi: edge publik harus menjadi tempat pertama yang mengendalikan header tersebut, bukan membiarkan client menentukan nilainya.

### 11.4 Remove-Only Mode

Kadang aplikasi tidak perlu memakai forwarded headers, tetapi ingin menghapusnya agar tidak bocor ke downstream. Spring menyediakan mode untuk menghapus forwarded headers saja pada beberapa API/filter terkait.

Use case:

- service internal tidak boleh memproses external forwarded metadata,
- downstream client tidak boleh menerima spoofed forwarded chain,
- gateway sudah menerjemahkan metadata ke internal trusted headers.

---

## 12. Path Rewriting and Prefix Awareness

Proxy sering mengubah path.

Contoh publik:

```http
GET /api/cases/123
Host: example.com
```

Diteruskan ke app:

```http
GET /cases/123
Host: case-service.internal
X-Forwarded-Prefix: /api
X-Forwarded-Host: example.com
X-Forwarded-Proto: https
```

### 12.1 Masalah yang Muncul

Jika app tidak sadar prefix:

- generated pagination link salah,
- `Location` header salah,
- OpenAPI server URL salah,
- OAuth callback salah,
- HATEOAS link salah,
- redirect salah,
- CORS/debugging membingungkan.

### 12.2 Design Options

#### Option A — App Knows Public Base Path

Aplikasi dikonfigurasi dengan base path publik:

```properties
app.public-base-url=https://example.com/api
```

Kelebihan:

- deterministik,
- aman untuk security-sensitive URL,
- tidak tergantung header runtime.

Kekurangan:

- lebih banyak config per environment.

#### Option B — Use Forwarded Prefix

Aplikasi memakai `X-Forwarded-Prefix` dari proxy terpercaya.

Kelebihan:

- fleksibel,
- cocok multi-route.

Kekurangan:

- trust boundary harus sangat ketat.

#### Option C — No Absolute Links

API hanya mengembalikan relative link.

Kelebihan:

- mengurangi problem host/scheme.

Kekurangan:

- tidak selalu cukup untuk callback/email/file download/external redirect.

---

## 13. TLS Termination and Internal TLS

### 13.1 TLS Termination at Edge

Umum:

```text
Client --HTTPS--> Load Balancer --HTTP--> App
```

Kelebihan:

- certificate management terpusat,
- offload CPU,
- WAF/CDN/gateway bisa inspect HTTP,
- routing berdasarkan HTTP bisa dilakukan.

Risiko:

- traffic internal plaintext,
- app tidak tahu original scheme tanpa forwarded metadata,
- compliance mungkin butuh encryption in transit end-to-end.

### 13.2 Re-encryption

```text
Client --HTTPS--> LB --HTTPS--> App
```

Kelebihan:

- encryption internal,
- compliance lebih kuat,
- mengurangi risiko internal sniffing.

Kekurangan:

- certificate lifecycle internal,
- operational complexity,
- debugging lebih sulit.

### 13.3 mTLS Internal

```text
Service A --mTLS--> Service B
```

mTLS memberi:

- server authentication,
- client/service authentication,
- channel encryption,
- basis service identity.

Namun mTLS bukan authorization domain. Service yang terautentikasi masih harus diotorisasi untuk operasi/resource tertentu.

---

## 14. Health Checks

Load balancer dan orchestrator butuh health endpoint.

Jenis umum:

| Check | Tujuan | Contoh |
|---|---|---|
| Liveness | Apakah process masih hidup? | restart jika mati/deadlock |
| Readiness | Apakah siap menerima traffic? | remove dari LB jika belum siap |
| Startup | Apakah startup masih berlangsung? | jangan kill app saat boot lambat |
| Dependency health | Apakah dependency kritikal sehat? | DB, cache, queue |

### 14.1 Common Mistakes

1. Liveness bergantung DB. Saat DB down, semua app direstart, memperburuk outage.
2. Readiness terlalu mahal, membuat health check membebani dependency.
3. Health endpoint tidak diproteksi sama sekali padahal membocorkan topology.
4. Health check tidak merefleksikan overload.
5. App menerima traffic sebelum warmup selesai.
6. Rolling deployment rusak karena readiness terlalu cepat true.

### 14.2 Better Model

```text
/health/live       -> process alive, cheap
/health/ready      -> can serve traffic, bounded checks
/health/startup    -> startup completion
/health/deep       -> protected diagnostic endpoint
```

Untuk Spring Boot, Actuator bisa menyediakan health/readiness/liveness, tetapi desain dependency check tetap harus disesuaikan dengan failure mode sistem.

---

## 15. Gateway-Generated Errors: 502, 503, 504

Banyak error yang dilihat client tidak berasal dari aplikasi.

### 15.1 502 Bad Gateway

Makna umum:

> Proxy/gateway menerima response tidak valid atau gagal berbicara dengan upstream.

Penyebab:

- upstream connection refused,
- upstream closed connection,
- invalid response,
- TLS handshake upstream gagal,
- protocol mismatch,
- app crash saat response,
- header terlalu besar,
- body framing rusak.

### 15.2 503 Service Unavailable

Makna umum:

> Service tidak tersedia sementara.

Penyebab:

- no healthy upstream,
- app overloaded,
- circuit breaker open,
- maintenance,
- load shedding,
- deployment rolling tidak punya ready pod,
- rate/concurrency limit tertentu.

### 15.3 504 Gateway Timeout

Makna umum:

> Gateway/proxy menunggu upstream terlalu lama.

Penyebab:

- app processing lebih lama dari proxy timeout,
- DB/downstream lambat,
- deadlock/thread starvation,
- proxy read timeout terlalu pendek,
- response streaming tidak flush/heartbeat,
- connection pool exhaustion.

### 15.4 Diagnosis Matrix

| Symptom | Kemungkinan Layer | Pertanyaan Diagnosis |
|---|---|---|
| 502 langsung | LB/proxy/upstream connection | Apakah app listening? port benar? TLS/protocol mismatch? |
| 503 saat deploy | readiness/LB | Apakah ada healthy target? readiness terlalu ketat? |
| 504 setelah N detik konsisten | proxy timeout | Timeout layer mana yang N detik? |
| Client lihat 504, app sukses commit | timeout mismatch | Apakah operation async/idempotent? |
| App log tidak ada request | edge/CDN/LB | Request sampai app? blocked WAF? route salah? |
| App log 200, client lihat 502 | response path/proxy | Header/body invalid? connection closed? response too large? |

Rule:

> Jangan mendiagnosis HTTP production hanya dari application log. Kamu perlu edge log, gateway log, load balancer metric, trace, dan app log yang dikorelasikan.

---

## 16. Request and Response Buffering

Proxy bisa buffering request body atau response body.

### 16.1 Request Buffering

Dengan request buffering:

```text
Client uploads full body -> Proxy stores/buffers -> App receives after complete
```

Kelebihan:

- app tidak terpapar slow upload client,
- proxy bisa enforce body size,
- upstream connection lebih pendek.

Kekurangan:

- latency lebih tinggi,
- disk/memory pressure di proxy,
- streaming upload ke app tidak benar-benar streaming,
- progress semantics berbeda.

### 16.2 Response Buffering

Dengan response buffering:

```text
App streams chunks -> Proxy buffers -> Client receives later
```

Problem untuk:

- SSE,
- NDJSON streaming,
- long-running export progress,
- heartbeat,
- low-latency event feed.

Mitigasi:

- disable buffering untuk route tertentu,
- set proper streaming headers,
- flush secara eksplisit,
- gunakan heartbeat,
- align idle timeouts.

---

## 17. Header Rewriting and Propagation Policy

Backend system harus punya policy eksplisit:

1. Header apa yang diterima dari external client?
2. Header apa yang dibuat oleh edge?
3. Header apa yang dipakai aplikasi?
4. Header apa yang diteruskan ke downstream?
5. Header apa yang harus dihapus?

### 17.1 Common Header Categories

| Category | Examples | Policy |
|---|---|---|
| Identity | `Authorization`, `Cookie`, `X-API-Key` | Jangan forward sembarang |
| Forwarded metadata | `Forwarded`, `X-Forwarded-*` | Trust hanya dari proxy |
| Tracing | `traceparent`, `tracestate`, `baggage` | Validate/normalize |
| Correlation | `X-Request-ID`, `X-Correlation-ID` | Accept or generate with constraints |
| Tenant | `X-Tenant-ID` | Jangan percaya dari public client kecuali authenticated/authorized |
| Security | `Origin`, `Referer`, `Host` | Validate before use |
| Cache | `Cache-Control`, `Vary` | Preserve intentionally |
| Hop-by-hop | `Connection`, `Keep-Alive`, `Transfer-Encoding` | Jangan forward end-to-end |

### 17.2 Do Not Propagate Everything

Anti-pattern:

```java
for (String name : incomingHeaders) {
    outboundHeaders.add(name, incomingHeaders.get(name));
}
```

Risiko:

- leaking user token to internal service that should not receive it,
- confused deputy,
- spoofed admin header,
- trace baggage explosion,
- cache/security header misuse,
- internal routing header injection,
- duplicate/ambiguous header behavior.

Better:

```text
allowlist propagation:
- traceparent
- tracestate, with policy
- x-request-id, normalized
- accept-language, if needed
- authorization, only if downstream requires user delegation
- internal service token, generated by client service
```

---

## 18. Real Client IP: Audit, Rate Limit, and Security

Client IP sering dipakai untuk:

- audit,
- fraud detection,
- rate limiting,
- geo policy,
- abuse control,
- incident investigation,
- legal evidence,
- suspicious login detection.

Tetapi dengan proxy, socket remote address biasanya IP proxy.

### 18.1 Bad Implementation

```java
String ip = request.getHeader("X-Forwarded-For").split(",")[0];
```

Problem:

- header bisa spoofed,
- parsing naif,
- whitespace/IPv6 issue,
- chain proxy kompleks,
- tidak validasi trusted proxy,
- bisa memasukkan data palsu ke audit.

### 18.2 Better Implementation Model

1. Edge publik menghapus incoming forwarding headers.
2. Edge menambahkan client IP yang dilihatnya.
3. Internal proxies append sesuai policy.
4. Aplikasi menerima request hanya dari trusted proxy CIDR.
5. Aplikasi memakai library/proxy-aware config yang memahami chain.
6. Audit log menyimpan:
   - resolved client IP,
   - raw forwarded chain,
   - source proxy,
   - trust decision.

Untuk sistem regulatory, audit IP tidak boleh hanya “best effort string”. Harus ada provenance.

---

## 19. Rate Limiting and Proxy Identity Problem

Jika rate limiter di aplikasi memakai `remoteAddr` tanpa forwarded awareness:

```text
All users appear as 10.0.0.5  (load balancer IP)
```

Akibat:

- semua user berbagi quota,
- rate limiter salah memblokir legitimate users,
- attacker bisa menyembunyikan identitas,
- audit abuse tidak berguna.

Namun jika memakai `X-Forwarded-For` tanpa trust:

```text
Attacker sends X-Forwarded-For: random-ip
```

Akibat:

- attacker bypass per-IP rate limit.

Solusi:

- rate limiting di edge yang melihat client asli,
- atau aplikasi memakai resolved IP dari trusted forwarding pipeline,
- kombinasikan IP dengan authenticated principal/API key/tenant,
- jangan menjadikan IP satu-satunya identity dimension.

---

## 20. Authentication at Gateway vs Application

### 20.1 Edge Authentication

Gateway bisa memverifikasi:

- JWT,
- API key,
- mTLS client cert,
- OAuth introspection,
- session cookie,
- HMAC signature.

Lalu meneruskan identity ke service via header internal:

```http
X-Authenticated-Subject: user-123
X-Authenticated-Tenant: tenant-456
X-Authenticated-Scopes: cases:read cases:write
```

### 20.2 Risk

Jika service menerima header ini dari network yang tidak sepenuhnya trusted, attacker bisa spoof:

```http
X-Authenticated-Subject: admin
```

### 20.3 Safer Patterns

#### Pattern A — Service validates token itself

Gateway boleh pre-validate, tapi service tetap validasi token.

Kelebihan:

- defense in depth,
- service bisa berdiri sendiri,
- lebih aman dari bypass gateway.

Kekurangan:

- repeated validation cost,
- shared auth config.

#### Pattern B — Gateway signs identity context

Gateway meneruskan identity context yang ditandatangani.

```http
X-Identity-Context: base64(payload)
X-Identity-Signature: signature
```

Service memverifikasi signature.

#### Pattern C — Internal mTLS + header stripping + trusted network

Service hanya menerima traffic dari gateway/mesh, semua external identity headers di-strip lalu dibuat ulang gateway.

Ini bisa valid jika network boundary sangat dikontrol, tetapi tetap perlu threat model.

### 20.4 Rule

> Jangan pernah menerima identity header dari public client. Identity header hanya valid jika dibuat oleh komponen trusted dan ada enforcement kuat bahwa client tidak bisa menyuntikkannya.

---

## 21. CORS Placement: Gateway or Application?

CORS bisa diatur di:

- CDN,
- gateway,
- ingress,
- application.

### 21.1 Gateway CORS

Kelebihan:

- centralized,
- preflight bisa dijawab tanpa app,
- konsisten antar-service,
- mengurangi beban app.

Kekurangan:

- butuh policy per route/method/header,
- dynamic tenant-origin policy sulit,
- gateway bisa tidak tahu authorization context.

### 21.2 Application CORS

Kelebihan:

- dekat domain/tenant rules,
- bisa contextual,
- lebih mudah test dengan controller.

Kekurangan:

- duplikasi antar-service,
- preflight sampai app,
- bisa bentrok dengan gateway.

### 21.3 Rule

Pilih satu owner utama. Jangan biarkan gateway dan app sama-sama menulis CORS header tanpa koordinasi.

Bug umum:

```http
Access-Control-Allow-Origin: https://app.example
Access-Control-Allow-Origin: *
```

Duplicate/conflicting CORS headers bisa membuat browser menolak response atau membuka policy yang salah.

---

## 22. Redirects Behind Proxies

Redirect bergantung pada scheme/host/path.

Contoh login flow:

```http
HTTP/1.1 302 Found
Location: https://app.example.com/callback
```

Jika app tidak tahu external URL, ia bisa menghasilkan:

```http
Location: http://case-service.default.svc.cluster.local:8080/callback
```

### 22.1 Redirect Safety Checklist

1. Gunakan configured allowed redirect targets.
2. Jangan bangun redirect dari untrusted `Host`/query param tanpa validasi.
3. Gunakan forwarded headers hanya dari trusted proxy.
4. Validasi scheme `https` untuk external redirects.
5. Hindari open redirect.
6. Untuk auth callback, gunakan registered redirect URI.
7. Untuk email links, gunakan configured public base URL.

---

## 23. Request Smuggling and Parser Mismatch

Request smuggling terjadi ketika proxy dan backend berbeda menafsirkan batas request.

Contoh risiko:

- proxy percaya `Content-Length`, backend percaya `Transfer-Encoding`,
- duplicate `Content-Length`,
- invalid chunked encoding,
- whitespace/header normalization berbeda,
- HTTP/2 to HTTP/1.1 translation ambiguity.

### 23.1 Kenapa Proxy Layer Relevan

Request smuggling hampir selalu melibatkan chain:

```text
Attacker -> Front Proxy -> Backend
```

Jika front proxy menganggap request selesai di posisi A, tetapi backend menganggap selesai di posisi B, attacker bisa “menyelundupkan” request berikutnya.

### 23.2 Defensive Principles

1. Pakai proxy/server yang patched dan konsisten.
2. Tolak ambiguous framing.
3. Jangan allow duplicate conflicting `Content-Length`.
4. Normalize/strip hop-by-hop headers.
5. Hindari konfigurasi HTTP/2 downgrade yang tidak aman.
6. Set request header/body size limits.
7. Lakukan security testing di chain sebenarnya, bukan hanya aplikasi lokal.

---

## 24. Cache Poisoning and Host/Forwarded Headers

Cache key sering bergantung pada:

- host,
- path,
- query,
- selected headers via `Vary`,
- scheme,
- encoding,
- authorization/cookie policy.

Jika proxy/cache memakai satu interpretasi dan aplikasi memakai interpretasi lain, response bisa tercache salah.

Contoh:

1. Attacker mengirim `Host` atau `X-Forwarded-Host` manipulatif.
2. App menghasilkan absolute link/script berdasarkan host tersebut.
3. CDN menyimpan response untuk public cache key.
4. User lain menerima poisoned response.

Mitigasi:

- host allowlist,
- canonical host redirect di edge,
- jangan gunakan untrusted forwarded host untuk body/link,
- cache key policy eksplisit,
- `Vary` benar,
- sensitive response `Cache-Control: private` atau `no-store`,
- security testing terhadap CDN/proxy/app chain.

---

## 25. WebSocket, SSE, and Upgrade Through Proxies

### 25.1 WebSocket

WebSocket memakai HTTP upgrade pada HTTP/1.1 atau mekanisme berbeda pada HTTP/2 tergantung implementation.

Proxy harus meneruskan:

```http
Connection: Upgrade
Upgrade: websocket
```

Common bugs:

- upgrade header tidak diteruskan,
- idle timeout terlalu pendek,
- sticky session dibutuhkan tapi tidak ada,
- load balancer tidak mendukung long-lived connection,
- auth hanya dicek saat handshake lalu tidak ada revalidation.

### 25.2 SSE

SSE tetap HTTP response streaming.

Common proxy bugs:

- response buffering,
- idle timeout tanpa heartbeat,
- compression buffering,
- max response duration,
- connection limit.

Checklist:

1. Disable buffering route SSE.
2. Heartbeat lebih pendek dari idle timeout.
3. Jangan simpan transaction/DB connection selama stream.
4. Pastikan cancellation saat client disconnect.
5. Observability khusus long-lived connection.

---

## 26. Observability Across Proxies

### 26.1 IDs yang Dibutuhkan

Dalam chain modern, minimal ada:

- request ID,
- trace ID,
- span ID,
- client IP resolved,
- edge request ID,
- gateway route ID,
- upstream service name,
- status generated by siapa,
- timeout layer,
- retry attempt,
- response size,
- request size,
- duration per hop.

### 26.2 Trace Propagation

Gunakan standar seperti W3C Trace Context:

```http
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
tracestate: vendor=value
```

Policy:

- accept traceparent dari trusted/external dengan validation,
- generate baru jika invalid,
- jangan masukkan data sensitif ke baggage,
- kontrol cardinality,
- pastikan proxy/gateway ikut membuat span.

### 26.3 Logging Correlation

Aplikasi harus log:

```json
{
  "timestamp": "...",
  "request_id": "...",
  "trace_id": "...",
  "method": "GET",
  "path": "/cases/123",
  "status": 200,
  "duration_ms": 42,
  "client_ip": "203.0.113.10",
  "forwarded_chain": "203.0.113.10, 10.0.0.12",
  "route_id": "cases-api",
  "upstream_status_source": "application"
}
```

Tanpa correlation, 502/504 debugging berubah menjadi tebak-tebakan.

---

## 27. Timeout Alignment Across Layers

Contoh chain:

```text
Browser timeout:         60s
CDN origin timeout:      30s
Gateway timeout:         25s
Ingress timeout:         20s
App request timeout:     18s
DB query timeout:        15s
Downstream timeout:      10s
```

Prinsip:

> Timeout terdalam harus lebih pendek dari timeout layer luar, agar failure terjadi di tempat yang memahami domain dan bisa memberi response yang benar.

Bad configuration:

```text
Gateway timeout: 30s
App keeps working: 120s
```

Akibat:

- client mendapat 504,
- app tetap commit,
- client retry,
- duplicate operation,
- audit ambiguity.

Better:

- app deadline < gateway timeout,
- downstream timeout < app deadline,
- operation idempotent,
- long-running work menjadi async job,
- cancellation dihormati.

---

## 28. Retry at Proxy Layer

Proxy/gateway kadang melakukan retry upstream saat:

- connection refused,
- connection reset,
- 502/503/504,
- timeout,
- no healthy upstream,
- specific configured status.

### 28.1 Risk for Non-Idempotent Requests

Jika proxy retry `POST /payments`, bisa terjadi duplicate charge jika aplikasi tidak idempotent.

Policy:

- retry otomatis hanya untuk safe/idempotent methods by default,
- POST retry hanya jika endpoint explicitly idempotent dan memakai idempotency key,
- jangan retry setelah request body dikirim ke upstream kecuali semantics aman,
- observability retry attempt wajib.

### 28.2 Retry Storm

Saat upstream overload, proxy retry bisa membuat traffic meningkat.

Mitigasi:

- retry budget,
- exponential backoff,
- jitter,
- circuit breaker,
- outlier detection,
- load shedding,
- bounded concurrency.

---

## 29. Where Should Logic Live?

### 29.1 Good at Edge/Gateway

- TLS termination,
- coarse route authentication,
- request size limits,
- IP allow/deny,
- generic rate limit,
- WAF,
- CORS preflight for static policy,
- compression,
- static cache,
- canonical host redirect,
- basic schema enforcement,
- global access logging.

### 29.2 Must Stay in Application

- domain authorization,
- object-level authorization,
- domain validation,
- idempotency state,
- optimistic concurrency,
- business error taxonomy,
- transaction boundary,
- audit semantic,
- workflow state transition,
- domain-specific quota,
- data redaction by role,
- regulatory defensibility.

### 29.3 Shared Responsibility

Some concerns span layers:

| Concern | Edge Role | App Role |
|---|---|---|
| Authentication | Verify/terminate/token exchange | Validate context/use principal safely |
| Rate limit | Protect platform | Protect domain operation |
| Timeout | Bound resource at edge | Bound domain execution |
| Logging | Access log | Semantic app log |
| CORS | Static policy | Dynamic tenant-aware policy |
| Headers | Normalize/strip | Interpret safely |
| Errors | Gateway errors | Domain errors |

---

## 30. Java/Spring Implementation Patterns

### 30.1 Centralized Request Context

Buat resolved request context yang eksplisit:

```java
public record RequestContext(
    String requestId,
    String traceId,
    String method,
    String externalScheme,
    String externalHost,
    String externalPathPrefix,
    String resolvedClientIp,
    String authenticatedSubject,
    String tenantId
) {}
```

Context ini tidak boleh sekadar copy raw header. Ia harus hasil normalisasi dan validasi.

### 30.2 Filter for Correlation ID

```java
@Component
public class CorrelationIdFilter extends OncePerRequestFilter {

    private static final String HEADER = "X-Request-ID";

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain
    ) throws ServletException, IOException {

        String incoming = request.getHeader(HEADER);
        String requestId = isValidRequestId(incoming) ? incoming : UUID.randomUUID().toString();

        MDC.put("request_id", requestId);
        response.setHeader(HEADER, requestId);

        try {
            filterChain.doFilter(request, response);
        } finally {
            MDC.remove("request_id");
        }
    }

    private boolean isValidRequestId(String value) {
        return value != null
            && value.length() <= 128
            && value.matches("[A-Za-z0-9._:-]+" );
    }
}
```

### 30.3 Safe Public URL Generation

Bad:

```java
String url = request.getScheme() + "://" + request.getHeader("Host") + "/cases/" + id;
```

Better for security-sensitive links:

```java
@Component
public class PublicUrlBuilder {
    private final URI publicBaseUri;

    public PublicUrlBuilder(@Value("${app.public-base-url}") URI publicBaseUri) {
        this.publicBaseUri = publicBaseUri;
    }

    public URI caseUrl(String caseId) {
        return publicBaseUri.resolve("/cases/" + UriUtils.encodePathSegment(caseId, StandardCharsets.UTF_8));
    }
}
```

### 30.4 Trusted Header Extraction

Do not scatter this across controllers:

```java
String ip = request.getHeader("X-Forwarded-For");
```

Centralize it:

```java
public interface ClientIpResolver {
    ClientIpResolution resolve(HttpServletRequest request);
}

public record ClientIpResolution(
    String ip,
    String source,
    boolean trusted,
    String rawForwardedChain
) {}
```

Then controllers/services consume resolved context, not raw headers.

---

## 31. Nginx Reverse Proxy Example

Conceptual Nginx config:

```nginx
server {
    listen 443 ssl http2;
    server_name api.example.com;

    client_max_body_size 20m;

    location /api/ {
        proxy_pass http://case_service:8080/;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port $server_port;
        proxy_set_header X-Forwarded-Prefix /api;

        proxy_connect_timeout 3s;
        proxy_send_timeout 30s;
        proxy_read_timeout 30s;
    }
}
```

Important notes:

1. `proxy_pass` path semantics can rewrite URI depending on trailing slash configuration.
2. `proxy_set_header Host $host` preserves external host; sometimes `$proxy_host` is desired for upstream.
3. `X-Forwarded-For` appends chain; public edge must control spoofed incoming values.
4. Body size limit here may reject request before app sees it.
5. Timeout here may produce 504 even if app continues processing.
6. For SSE, response buffering may need explicit changes.

---

## 32. Case Study: Regulatory Enforcement Platform Behind Gateway

### 32.1 Architecture

```text
External User
  -> CDN/WAF
  -> API Gateway
  -> Kubernetes Ingress
  -> Case Service
  -> Evidence Service
  -> Audit Service
```

### 32.2 Requirements

- Users authenticate through OIDC.
- Investigators upload evidence files.
- External agencies access limited APIs via mTLS/API key.
- Supervisors approve escalation.
- All actions must be audited.
- Client IP and user identity are legally relevant.
- Some endpoints are rate-limited per tenant.
- Some downloads are sensitive and must not be cached.
- Long-running exports are async.

### 32.3 Trust Boundary Design

#### Edge/CDN/WAF

- terminate public TLS,
- enforce canonical host,
- remove incoming `X-Forwarded-*`,
- add real client IP header,
- WAF filtering,
- static/global rate limit,
- DDoS protection.

#### API Gateway

- verify OIDC/JWT or mTLS/API key,
- write signed internal identity context,
- enforce coarse route authorization,
- set `X-Request-ID` if missing/invalid,
- propagate `traceparent`,
- answer static CORS preflight,
- apply route timeout,
- route to services.

#### Ingress

- path routing,
- body size per route,
- timeout per route,
- disable buffering for SSE routes,
- readiness-based upstream selection.

#### Application

- verify trusted identity context or token,
- enforce object-level authorization,
- validate domain transitions,
- idempotency for commands,
- audit resolved identity/IP/proxy chain,
- generate domain error response,
- never trust raw tenant/user headers,
- never generate sensitive URL from raw Host.

### 32.4 Example: Evidence Upload

Public endpoint:

```http
POST /api/cases/CASE-123/evidence-upload-sessions
Host: enforcement.example.gov
Authorization: Bearer ...
```

Gateway forwards:

```http
POST /cases/CASE-123/evidence-upload-sessions
Host: case-service.default.svc.cluster.local
X-Forwarded-Proto: https
X-Forwarded-Host: enforcement.example.gov
X-Forwarded-Prefix: /api
X-Request-ID: req-abc
traceparent: ...
X-Identity-Context: signed(...)
```

Application must:

1. resolve authenticated principal from trusted source,
2. check user can add evidence to `CASE-123`,
3. create upload session with idempotency if needed,
4. audit action with resolved client IP and request ID,
5. return `201 Created` with public or relative upload session URL,
6. not trust `X-Tenant-ID` from client,
7. not cache sensitive response.

### 32.5 Example: Escalation Approval

```http
POST /api/cases/CASE-123/escalation-approval
Idempotency-Key: approve-CASE-123-v7-user-456
```

Gateway may authenticate, but application must enforce:

- user role supervisor,
- user assigned to case/department,
- case state is `PENDING_ESCALATION_APPROVAL`,
- version/precondition if needed,
- idempotency key replay,
- audit event immutable.

Gateway cannot correctly enforce these domain rules alone.

---

## 33. Production Checklist

### 33.1 Trust Boundary

- [ ] Are all public incoming `Forwarded`/`X-Forwarded-*` headers stripped at edge?
- [ ] Does each trusted proxy append/set forwarding headers consistently?
- [ ] Does the app only trust forwarded headers from known proxy CIDRs/network?
- [ ] Is host allowlist enforced?
- [ ] Are identity headers impossible for public clients to spoof?
- [ ] Are internal services protected from direct public access?

### 33.2 URL and Redirect

- [ ] Are security-sensitive absolute URLs built from configured public base URL?
- [ ] Are redirects allowlisted?
- [ ] Does the app correctly detect external scheme/host if needed?
- [ ] Is `X-Forwarded-Prefix` handled if path rewrite exists?
- [ ] Are OAuth/SAML callback URLs tested behind actual proxy?

### 33.3 Timeout and Retry

- [ ] Are CDN/gateway/ingress/app/downstream timeouts aligned?
- [ ] Does app timeout before gateway timeout?
- [ ] Are proxy retries disabled or constrained for non-idempotent methods?
- [ ] Are retry attempts observable?
- [ ] Are long operations modeled as async jobs?

### 33.4 Payload and Streaming

- [ ] Are body size limits consistent across edge/gateway/app?
- [ ] Are upload routes buffered intentionally?
- [ ] Are streaming routes protected from proxy buffering?
- [ ] Are idle timeouts compatible with SSE/WebSocket/long polling?
- [ ] Are large downloads using safe headers and authorization checks?

### 33.5 Observability

- [ ] Is there a request ID end-to-end?
- [ ] Is trace context propagated?
- [ ] Can you identify which layer generated 502/503/504?
- [ ] Are edge/gateway/app logs correlated?
- [ ] Are resolved client IP and raw chain captured safely for audit?
- [ ] Are high-cardinality labels controlled?

### 33.6 Security

- [ ] Are host header attacks mitigated?
- [ ] Are cache poisoning risks tested?
- [ ] Are request smuggling protections enabled/patched?
- [ ] Are hop-by-hop headers sanitized?
- [ ] Are internal admin/debug headers stripped from public traffic?
- [ ] Is CORS owned by one coherent layer?

---

## 34. Common Anti-Patterns

### Anti-Pattern 1 — Trusting `X-Forwarded-For` Blindly

```java
String ip = request.getHeader("X-Forwarded-For").split(",")[0];
```

Why bad:

- spoofable,
- not provenance-aware,
- corrupts audit/rate limit/security logic.

### Anti-Pattern 2 — Gateway-Only Authorization

```text
Gateway says user authenticated -> service trusts all operations
```

Why bad:

- object-level authorization still missing,
- internal bypass risk,
- misroute risk,
- compromised service risk.

### Anti-Pattern 3 — Building Links from Raw Host

```java
String url = "https://" + request.getHeader("Host") + "/reset";
```

Why bad:

- host header injection,
- phishing link,
- cache poisoning,
- tenant confusion.

### Anti-Pattern 4 — Timeout Only at Gateway

```text
Gateway timeout: 30s
App work: no timeout
```

Why bad:

- client sees failure,
- app continues mutation,
- retries create duplicate work,
- no domain error.

### Anti-Pattern 5 — Propagating All Headers Downstream

Why bad:

- token leakage,
- spoofed internal headers,
- unexpected auth context,
- baggage explosion,
- security boundary collapse.

### Anti-Pattern 6 — Duplicate CORS Ownership

Gateway and app both add CORS headers inconsistently.

Why bad:

- browser rejects response,
- credentials policy broken,
- cached preflight inconsistent.

### Anti-Pattern 7 — Health Check Equals “DB Is Up”

Why bad:

- DB outage restarts all pods,
- cascading failure,
- readiness/liveness semantics confused.

---

## 35. Exercises

### Exercise 1 — Trace the Metadata

Given this chain:

```text
Browser --HTTPS--> Cloudflare --HTTPS--> AWS ALB --HTTP--> Nginx Ingress --HTTP--> Spring Boot
```

Design:

1. which layer sets `X-Forwarded-For`,
2. which layer strips incoming forwarded headers,
3. how Spring resolves external scheme,
4. how app resolves client IP,
5. what is logged for audit.

### Exercise 2 — Diagnose 504

A client receives 504 after exactly 30 seconds. App logs show the request completed successfully after 45 seconds and committed database changes.

Answer:

1. which layer likely timed out,
2. why client retry is dangerous,
3. how idempotency should be used,
4. how timeout budgets should be adjusted,
5. when to redesign as async job.

### Exercise 3 — Secure Identity Header

Gateway sends:

```http
X-User-ID: 123
X-Tenant-ID: abc
```

Design a safer mechanism so backend can trust identity context.

Consider:

- header stripping,
- internal network boundary,
- mTLS,
- signed context,
- service validation,
- audit.

### Exercise 4 — Fix URL Generation

A Spring Boot app behind ingress generates:

```http
Location: http://case-service:8080/cases/123
```

Expected:

```http
Location: https://enforcement.example.gov/api/cases/123
```

Explain:

1. root cause,
2. proxy headers needed,
3. Spring config needed,
4. safer alternative using configured public base URL.

### Exercise 5 — Proxy Retry Policy

Gateway currently retries all `POST` requests once on upstream timeout.

Evaluate:

1. why this is dangerous,
2. which methods are safe by default,
3. how `Idempotency-Key` changes policy,
4. how to observe retry attempts,
5. what to do for payment/case approval workflows.

---

## 36. Key Takeaways

1. Backend rarely sees the original request directly; it sees a request transformed by proxies.
2. `Host`, scheme, client IP, path, and auth metadata must be treated as trust-boundary-sensitive.
3. Forwarded headers are useful only when inserted by trusted proxies that strip spoofed external values.
4. Gateway is excellent for uniform edge policy, but cannot replace object-level authorization and domain invariants.
5. Timeout, retry, buffering, and protocol translation across proxies can change correctness behavior.
6. `502`, `503`, and `504` often originate outside the application and require cross-layer observability.
7. Spring apps behind proxy need explicit forwarded-header configuration, but configuration must match network trust reality.
8. Do not propagate all headers downstream; use explicit allowlist and identity propagation policy.
9. Security-sensitive URLs should not be built from raw request headers.
10. Production-grade HTTP backend design is an end-to-end system design problem, not just controller code.

---

## 37. References

- RFC 9110 — HTTP Semantics: https://www.rfc-editor.org/rfc/rfc9110.html
- RFC 7239 — Forwarded HTTP Extension: https://www.rfc-editor.org/rfc/rfc7239.html
- Spring Framework `ForwardedHeaderFilter`: https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/web/filter/ForwardedHeaderFilter.html
- Spring Framework `ForwardedHeaderUtils`: https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/web/util/ForwardedHeaderUtils.html
- NGINX Reverse Proxy Documentation: https://docs.nginx.com/nginx/admin-guide/web-server/reverse-proxy/
- NGINX `ngx_http_proxy_module`: https://nginx.org/en/docs/http/ngx_http_proxy_module.html
- AWS Elastic Load Balancing X-Forwarded Headers: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/x-forwarded-headers.html
- OWASP Web Security Testing Guide and API Security Project for proxy/header-related threat modeling.

---

## 38. Status Seri

Kamu sudah menyelesaikan:

- Part 000 — Orientation
- Part 001 — HTTP Semantics from Server Point of View
- Part 002 — Request Lifecycle: From Socket to Controller
- Part 003 — Methods Deep Dive for Backend Correctness
- Part 004 — Status Codes as Backend State Contracts
- Part 005 — Headers as Backend Control Plane
- Part 006 — Request Body, Response Body, and Message Framing
- Part 007 — URI, Routing, and Resource Modeling
- Part 008 — Content Negotiation and Representation Design
- Part 009 — Validation, Parsing, and Defensive Boundaries
- Part 010 — Error Response Design and Problem Details
- Part 011 — Idempotency, Retries, and Exactly-Once Illusions
- Part 012 — Conditional Requests and Optimistic Concurrency
- Part 013 — Caching for Backend Engineers
- Part 014 — Authentication over HTTP
- Part 015 — Authorization and Resource-Level Security
- Part 016 — Cookies, Sessions, CSRF, and Browser-Coupled Backend
- Part 017 — CORS from Backend Enforcement Perspective
- Part 018 — Rate Limiting, Quotas, and Abuse Control
- Part 019 — Timeouts, Cancellation, Backpressure, and Load Shedding
- Part 020 — File Upload, Download, Multipart, and Large Payloads
- Part 021 — Streaming HTTP, SSE, Long Polling, and Async Responses
- Part 022 — HTTP/1.1, HTTP/2, HTTP/3 for Backend Engineers
- Part 023 — Reverse Proxies, Gateways, Load Balancers, and Trust Boundaries

Seri belum selesai. Bagian berikutnya:

`learn-http-for-web-backend-perspective-part-024.md` — **API Design Styles over HTTP**.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-http-for-web-backend-perspective-part-022.md">⬅️ Part 022 — HTTP/1.1, HTTP/2, HTTP/3 for Backend Engineers</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-http-for-web-backend-perspective-part-024.md">Part 024 — API Design Styles over HTTP ➡️</a>
</div>
