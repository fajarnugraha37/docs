# Part 8 — DNS, Proxy, Load Balancer, NAT, dan Network Topology Awareness

> Series: `learn-java-http-client-okhttp-retrofit-client-engineering`  
> File: `08-dns-proxy-loadbalancer-nat-network-topology-awareness.md`  
> Target: Java 8 sampai Java 25  
> Fokus: memahami bahwa HTTP client tidak hidup di ruang hampa. Ia hidup di atas DNS, TCP, TLS, proxy, load balancer, NAT, Kubernetes/cloud networking, JVM resolver, connection pool, dan policy infrastructure.

---

## 1. Kenapa Part Ini Penting?

Banyak engineer melihat HTTP client sebagai kode seperti ini:

```java
String response = client.get("https://api.partner.com/orders/123");
```

Padahal request itu melewati banyak lapisan:

```text
application code
  ↓
HTTP client library
  ↓
URI parsing / route selection
  ↓
DNS resolution
  ↓
proxy decision
  ↓
connection pool
  ↓
TCP connect
  ↓
TLS handshake
  ↓
load balancer
  ↓
NAT / firewall / service mesh / ingress
  ↓
remote service instance
```

Bug production sering muncul bukan karena kode JSON mapping salah, tetapi karena:

- DNS berubah tetapi JVM masih memakai IP lama.
- Load balancer menutup idle connection tetapi client masih mencoba reuse connection tersebut.
- NAT gateway kehabisan ephemeral port karena terlalu banyak koneksi baru.
- Corporate proxy memerlukan authentication, tetapi client tidak mengaturnya.
- Kubernetes service DNS memberikan IP berbeda, tetapi client pooling menahan koneksi lama terlalu lama.
- HTTP/2 multiplexing membuat satu koneksi menjadi bottleneck tersembunyi.
- Retry memperparah tekanan ke NAT/proxy/load balancer.
- Client mengira timeout terjadi di downstream, padahal stuck di DNS/proxy/connect.

Top-tier engineer tidak hanya bertanya:

> “HTTP call ini timeout berapa?”

Tetapi:

> “Request ini mengambil route ke mana, DNS-nya cache berapa lama, melewati proxy atau tidak, pool-nya reuse bagaimana, idle timeout-nya match dengan load balancer atau tidak, dan failure ini terjadi di hop mana?”

---

## 2. Mental Model: HTTP Client sebagai Network Topology Participant

HTTP client adalah peserta aktif dalam network topology. Ia bukan sekadar caller.

Ia membuat keputusan tentang:

1. Nama host diterjemahkan ke IP mana.
2. Apakah koneksi langsung atau lewat proxy.
3. Apakah koneksi baru dibuat atau koneksi lama dipakai ulang.
4. Apakah IP pertama dicoba, atau fallback ke IP berikutnya.
5. Berapa lama koneksi idle dipertahankan.
6. Apakah redirect boleh diikuti.
7. Apakah TLS trust chain valid.
8. Apakah hostname cocok dengan certificate.
9. Apakah request dikirim lewat HTTP/1.1 atau HTTP/2.
10. Apakah retry dilakukan saat connection failure.

Satu konfigurasi kecil dapat mengubah seluruh route.

Contoh:

```java
HttpClient client = HttpClient.newBuilder()
    .proxy(ProxySelector.of(new InetSocketAddress("proxy.internal", 8080)))
    .connectTimeout(Duration.ofSeconds(3))
    .build();
```

Perubahan ini berarti:

```text
tanpa proxy:
client → api.partner.com

dengan proxy:
client → proxy.internal → api.partner.com
```

Failure model-nya berubah total.

Jika request gagal, penyebabnya bisa:

- proxy DNS gagal
- proxy connect timeout
- proxy authentication gagal
- proxy tidak bisa resolve target
- proxy tidak boleh CONNECT ke host tersebut
- proxy menutup idle tunnel
- target benar-benar down

Kode application terlihat sama, tetapi topology berbeda.

---

## 3. Request Route: Direct, Proxy, Load Balancer, Service Mesh

Secara sederhana, ada beberapa bentuk route.

### 3.1 Direct Internet Route

```text
Java service
  → DNS resolver
  → public IP
  → internet
  → partner load balancer
  → partner service
```

Umum untuk third-party API.

Risiko:

- DNS TTL tidak dihormati.
- Public IP berubah.
- NAT gateway bottleneck.
- Firewall egress rule.
- TLS certificate rotation.
- Rate limiting partner.

---

### 3.2 Corporate Proxy Route

```text
Java service
  → corporate proxy
  → internet
  → partner API
```

Umum di enterprise environment.

Risiko:

- proxy auth
- proxy ACL
- CONNECT tunnel issue
- proxy idle timeout
- proxy logging sensitive URL
- SSL inspection
- certificate trust problem

Untuk HTTPS, biasanya client membuat tunnel lewat proxy menggunakan `CONNECT`:

```text
client → proxy: CONNECT api.partner.com:443
proxy → api.partner.com:443
client ⇄ TLS tunnel ⇄ api.partner.com
```

Proxy melihat target host dan port, tetapi idealnya tidak melihat isi TLS jika tidak ada SSL inspection.

---

### 3.3 Internal Load Balancer Route

```text
service-a
  → internal DNS
  → internal load balancer
  → service-b instances
```

Umum di cloud/private network.

Risiko:

- LB idle timeout lebih pendek dari client keep-alive.
- LB health check belum update.
- cross-zone routing issue.
- stale connection setelah target deregistration.
- sticky behavior tidak disadari.

---

### 3.4 Kubernetes Service Route

```text
pod-a
  → CoreDNS
  → service DNS name
  → ClusterIP / kube-proxy / iptables / IPVS
  → pod-b
```

Atau dengan service mesh:

```text
pod-a app container
  → local sidecar proxy
  → mesh control/data plane
  → remote sidecar
  → pod-b app container
```

Risiko:

- DNS search path salah.
- CoreDNS latency/spike.
- sidecar timeout berbeda dengan application timeout.
- retries terjadi dobel: application retry + mesh retry.
- mTLS di mesh berbeda dengan mTLS di app.
- connection pool app tidak sejalan dengan pool sidecar.

---

## 4. DNS: Dari Hostname ke IP Address

DNS resolution adalah tahap awal yang sering diremehkan.

Request ke:

```text
https://api.partner.com/v1/orders
```

harus menerjemahkan:

```text
api.partner.com → 203.0.113.10
```

atau beberapa IP:

```text
api.partner.com → [203.0.113.10, 203.0.113.11, 203.0.113.12]
```

HTTP client kemudian memilih IP untuk connect.

### 4.1 DNS Bukan Sekadar Lookup

DNS membawa informasi operasional:

- service discovery
- load distribution
- failover
- blue/green migration
- regional routing
- canary routing
- internal/private routing
- disaster recovery

Jika client terlalu lama cache DNS, client dapat tetap memukul IP lama.

Jika client terlalu sering resolve DNS, CoreDNS/recursive resolver bisa terbebani.

Jadi DNS TTL bukan angka sepele.

---

## 5. JVM DNS Caching

Java melakukan caching hasil DNS lookup pada level JVM/security property.

Konsep penting:

```text
hostname → resolved IP list → cached by JVM
```

Property umum:

```properties
networkaddress.cache.ttl=30
networkaddress.cache.negative.ttl=10
```

Makna:

- `networkaddress.cache.ttl`: berapa lama successful lookup dicache.
- `networkaddress.cache.negative.ttl`: berapa lama failed lookup dicache.

### 5.1 Positive DNS Cache

Jika `api.partner.com` resolve ke `10.0.1.10`, JVM dapat menyimpan hasilnya.

Jika DNS berubah menjadi `10.0.2.20`, client belum tentu langsung tahu.

```text
T0: api.partner.com → 10.0.1.10
T1: JVM cache result
T2: DNS record changed → 10.0.2.20
T3: JVM still uses 10.0.1.10 until cache expires
```

### 5.2 Negative DNS Cache

Jika lookup gagal:

```text
api.partner.com → NXDOMAIN / resolver failure
```

JVM juga dapat cache kegagalan itu.

Akibatnya:

```text
DNS sudah recover, tetapi JVM masih menganggap hostname gagal resolve
```

Ini bisa menyebabkan incident yang terlihat aneh:

- `nslookup` dari container sudah berhasil.
- `curl` sudah berhasil.
- Java app masih gagal.

Karena Java app memakai cached negative result.

---

## 6. DNS TTL: Trade-off

TTL terlalu tinggi:

```text
+ mengurangi DNS load
+ latency lookup lebih rendah
- failover lambat
- blue/green migration lambat
- stale IP risk
```

TTL terlalu rendah:

```text
+ cepat mengikuti perubahan DNS
+ lebih responsif terhadap failover
- DNS resolver lebih berat
- latency lebih fluktuatif
- CoreDNS/recursive resolver bisa menjadi bottleneck
```

Practical starting point untuk service backend:

```text
internal stable service: 30–60 detik
external third-party API: 30–300 detik, tergantung vendor guidance
Kubernetes service DNS: sering cukup pendek, tetapi jangan over-resolve tanpa alasan
highly dynamic failover: 5–30 detik dengan observability ketat
```

Tidak ada angka universal. Yang penting adalah selaras dengan:

- DNS record TTL aktual
- failover requirement
- resolver capacity
- connection pool TTL
- load balancer behavior
- operational runbook

---

## 7. DNS dan Connection Pool: Perubahan DNS Tidak Berarti Koneksi Lama Hilang

Ini sangat penting.

Misal:

```text
T0: DNS api.service → 10.0.1.10
T1: client membuat koneksi ke 10.0.1.10
T2: koneksi masuk pool
T3: DNS berubah → 10.0.2.20
T4: client masih punya pooled connection ke 10.0.1.10
```

DNS TTL hanya mempengaruhi lookup baru.

Ia tidak otomatis menutup koneksi lama.

Jadi ada dua lifecycle berbeda:

```text
DNS cache lifecycle
connection lifecycle
```

Keduanya harus dipikirkan bersama.

Jika ingin client cepat pindah ke target baru, Anda perlu mengatur:

- DNS TTL
- connection idle timeout
- connection TTL / max lifetime jika library mendukung
- load balancer deregistration draining
- server-side graceful shutdown

---

## 8. Multi-IP DNS dan Failover

DNS dapat mengembalikan banyak IP.

```text
api.partner.com → 203.0.113.10, 203.0.113.11, 203.0.113.12
```

Client behavior berbeda-beda:

- mencoba IP pertama saja
- mencoba IP berikutnya jika connect gagal
- mengacak urutan
- mengikuti OS resolver order
- custom DNS strategy

OkHttp, misalnya, memiliki abstraction `Dns` dan dapat mencoba route/address berbeda saat connection failure sesuai mekanisme route selection-nya.

Mental model:

```text
hostname
  ↓ DNS
IP candidates
  ↓ route selection
proxy/direct + IP + TLS config
  ↓ connection attempt
success/failure
```

Jika IP pertama lambat tetapi tidak langsung gagal, client bisa tetap stuck sampai connect timeout.

Karena itu connect timeout harus cukup pendek untuk memungkinkan fallback, tetapi tidak terlalu pendek sampai false timeout.

---

## 9. Custom DNS di OkHttp

OkHttp menyediakan interface `Dns`.

Contoh sederhana:

```java
OkHttpClient client = new OkHttpClient.Builder()
    .dns(hostname -> {
        if (hostname.equals("api.internal")) {
            return List.of(InetAddress.getByName("10.0.10.25"));
        }
        return Dns.SYSTEM.lookup(hostname);
    })
    .build();
```

Gunakan custom DNS hanya jika benar-benar perlu.

Use case valid:

- test environment
- internal service discovery
- DNS override sementara
- custom resolver dengan observability
- failover policy khusus

Risiko:

- bypass DNS TTL normal
- hardcoded IP
- tidak support IPv6
- tidak menghormati corporate resolver
- mematahkan certificate hostname expectation jika salah
- sulit di-debug oleh platform team

Rule:

> Custom DNS adalah infrastructure policy, bukan convenience hack.

---

## 10. JDK HttpClient dan ProxySelector

JDK `HttpClient` memakai `ProxySelector` untuk konfigurasi proxy.

Contoh direct/no proxy:

```java
HttpClient client = HttpClient.newBuilder()
    .proxy(HttpClient.Builder.NO_PROXY)
    .build();
```

Contoh proxy fixed:

```java
HttpClient client = HttpClient.newBuilder()
    .proxy(ProxySelector.of(new InetSocketAddress("proxy.internal", 8080)))
    .connectTimeout(Duration.ofSeconds(3))
    .build();
```

Hal penting:

- Jika tidak set proxy selector, client dapat memakai default proxy selector environment/JVM.
- Default behavior bisa berbeda antar environment.
- Local dev, CI, container, dan production bisa punya proxy berbeda.

Jangan anggap request pasti direct.

Di enterprise, pertanyaan pertama saat outbound failure:

```text
Apakah request melewati proxy?
Proxy mana?
Proxy auth bagaimana?
Bypass list apa?
```

---

## 11. Proxy: Forward Proxy, Reverse Proxy, dan CONNECT Tunnel

### 11.1 Forward Proxy

Forward proxy dipakai oleh client untuk keluar.

```text
client → forward proxy → target server
```

Client aware terhadap proxy.

Contoh:

- corporate egress proxy
- outbound security gateway
- API inspection proxy

### 11.2 Reverse Proxy

Reverse proxy berada di depan server.

```text
client → reverse proxy/load balancer → backend server
```

Client biasanya hanya tahu hostname target.

Contoh:

- Nginx
- HAProxy
- AWS ALB/NLB
- API Gateway
- ingress controller

### 11.3 CONNECT Tunnel untuk HTTPS

Untuk HTTPS via forward proxy:

```text
client: CONNECT api.partner.com:443 HTTP/1.1
proxy: 200 Connection Established
client: TLS handshake through tunnel
```

Failure bisa terjadi pada:

- proxy connection
- proxy authentication
- CONNECT authorization
- TLS handshake after tunnel
- remote server

Jangan campur semua sebagai “SSL error” atau “timeout”.

---

## 12. Proxy Authentication

Proxy bisa meminta authentication:

```text
407 Proxy Authentication Required
Proxy-Authenticate: Basic realm="proxy"
```

Client perlu mengirim:

```text
Proxy-Authorization: Basic ...
```

Perhatikan:

- `Authorization` untuk target server.
- `Proxy-Authorization` untuk proxy.

Jangan tertukar.

```text
Authorization         → API server
Proxy-Authorization   → proxy server
```

Security issue:

- Jangan log `Proxy-Authorization`.
- Jangan forward `Proxy-Authorization` ke downstream application.
- Jangan masukkan proxy credential ke code.

---

## 13. Proxy dan TLS Inspection

Beberapa corporate proxy melakukan TLS inspection.

Topology:

```text
client
  → proxy presents corporate certificate
  → proxy decrypts
  → proxy opens separate TLS to target
```

Dari sisi Java client, certificate yang dilihat bukan certificate asli `api.partner.com`, tetapi certificate yang ditandatangani corporate CA.

Akibat:

- trust store harus memiliki corporate root CA
- certificate pinning bisa gagal
- mTLS bisa bermasalah
- compliance/security requirement perlu jelas

Jika memakai certificate pinning, TLS inspection biasanya tidak kompatibel kecuali pinning disesuaikan, yang sering kali mengalahkan tujuan pinning.

---

## 14. Load Balancer Awareness

HTTP client biasanya tidak connect langsung ke instance aplikasi remote, tetapi ke load balancer.

```text
client → load balancer → instance A/B/C
```

Load balancer punya policy:

- idle timeout
- connection draining
- health check
- target deregistration delay
- max connection
- TLS termination
- HTTP/2 support
- header manipulation
- sticky session
- request buffering

Client harus kompatibel dengan policy ini.

---

## 15. Idle Timeout Mismatch

Salah satu masalah paling umum:

```text
client keep-alive timeout: 5 menit
load balancer idle timeout: 60 detik
```

Timeline:

```text
T0: request sukses
T1: connection idle di pool client
T2: LB menutup connection setelah 60 detik
T3: client masih mengira connection reusable
T4: client reuse connection
T5: connection reset / EOF / retry / failure
```

Solusi:

- set client idle timeout lebih pendek dari LB idle timeout
- enable stale connection validation jika library mendukung
- gunakan retry aman untuk connection reuse failure
- monitor connection reset after idle

Rule praktis:

```text
client idle timeout < load balancer idle timeout
```

Misal:

```text
LB idle timeout: 60s
client idle keep-alive: 45s atau 50s
```

---

## 16. Connection Draining dan Deployment

Saat backend instance akan diganti:

```text
old instance removed from LB
existing connections may be drained
new requests should go to new instances
```

Namun client connection pool bisa tetap punya koneksi ke old path selama masih valid.

Failure saat deployment bisa terlihat sebagai:

- connection reset
- broken pipe
- EOFException
- 502/503 dari LB
- slow response

Client design harus menganggap deployment sebagai event normal, bukan exception langka.

Mitigasi:

- idempotent retry untuk safe operation
- short enough keep-alive
- graceful shutdown server
- LB deregistration delay cukup
- readiness/liveness probe benar
- avoid retry storm saat banyak instance rolling restart

---

## 17. NAT dan Ephemeral Port Exhaustion

Di cloud/container environment, outbound request sering melewati NAT.

```text
pod/service → node/network → NAT gateway → internet → partner API
```

Setiap TCP connection memakai tuple:

```text
source IP + source port + destination IP + destination port + protocol
```

Source port berasal dari ephemeral port range.

Jika terlalu banyak koneksi baru dibuat dan ditutup cepat, port bisa habis atau tertahan di `TIME_WAIT`.

Gejala:

- connect timeout meningkat
- sporadic connection failure
- high latency outbound
- NAT gateway metrics naik
- banyak socket `TIME_WAIT`
- retry memperburuk kondisi

Penyebab umum:

- membuat HTTP client baru per request
- connection pooling disabled/tidak efektif
- keep-alive terlalu pendek
- max concurrency terlalu tinggi
- retry agresif
- partner API lambat sehingga koneksi tertahan
- HTTP/1.1 tanpa pooling cukup

Mitigasi:

- reuse singleton HTTP client
- connection pool benar
- concurrency limit
- rate limit
- timeout ketat
- retry budget
- HTTP/2 jika supported dan cocok
- scale NAT/path capacity jika memang bottleneck

---

## 18. TIME_WAIT dan Connection Churn

TCP connection yang ditutup tidak langsung hilang. Ia bisa masuk state `TIME_WAIT`.

Jika aplikasi membuat koneksi baru terus-menerus:

```text
request 1 → new TCP → close → TIME_WAIT
request 2 → new TCP → close → TIME_WAIT
request 3 → new TCP → close → TIME_WAIT
...
```

Maka OS/NAT bisa terbebani.

Connection pooling mengubah pola menjadi:

```text
request 1 → new TCP
request 2 → reuse TCP
request 3 → reuse TCP
...
```

Ini mengurangi:

- TCP handshake cost
- TLS handshake cost
- NAT port churn
- latency
- CPU
- error probability

---

## 19. Kubernetes Network Topology

Di Kubernetes, request internal bisa terlihat sederhana:

```text
http://orders-service.default.svc.cluster.local/api/orders
```

Namun path-nya bisa kompleks:

```text
app pod
  → libc/JVM resolver
  → CoreDNS
  → ClusterIP
  → kube-proxy iptables/IPVS/eBPF
  → target pod
```

Atau dengan ingress/service mesh:

```text
app container
  → sidecar proxy
  → node networking
  → remote sidecar
  → target app container
```

Masalah umum:

- CoreDNS overloaded.
- search domain membuat lookup berulang.
- ndots menyebabkan query DNS tambahan.
- service endpoints berubah saat rollout.
- sidecar retry/timeout tidak selaras dengan app retry/timeout.
- mTLS dilakukan oleh mesh, bukan app.
- app connection pool keep-alive melebihi sidecar/LB idle timeout.

---

## 20. Kubernetes DNS Search Path dan `ndots`

Kubernetes biasanya mengatur `/etc/resolv.conf` dengan search domain.

Contoh hostname pendek:

```text
orders-service
```

Resolver dapat mencoba beberapa nama:

```text
orders-service.<namespace>.svc.cluster.local
orders-service.svc.cluster.local
orders-service.cluster.local
orders-service
```

Jika `ndots` tinggi dan hostname external tidak fully qualified, lookup bisa menghasilkan beberapa query sebelum mencapai nama final.

Contoh buruk:

```text
api.partner.com
```

Bisa dicoba sebagai:

```text
api.partner.com.default.svc.cluster.local
api.partner.com.svc.cluster.local
api.partner.com.cluster.local
api.partner.com
```

Mitigasi:

- gunakan fully qualified domain jika perlu
- pahami cluster DNS config
- monitor CoreDNS latency/error
- jangan terlalu sering membuang DNS cache

---

## 21. Service Mesh: Retry Ganda dan Timeout Ganda

Jika service mesh aktif, request bisa melewati proxy lokal seperti Envoy.

Application mungkin punya policy:

```text
HTTP client timeout: 2s
retry: 2x
```

Mesh mungkin punya policy:

```text
route timeout: 3s
retry: 2x
```

Efek gabungan bisa menjadi tidak intuitif.

Worst case:

```text
application retry 2x × mesh retry 2x = 4 downstream attempts
```

Jika 100 request gagal serentak:

```text
100 logical requests → 400 physical attempts
```

Ini bisa menciptakan retry storm.

Rule:

> Hanya satu layer yang boleh menjadi owner utama retry policy, kecuali komposisinya dihitung eksplisit.

Pertanyaan design review:

- Retry dilakukan di app, mesh, gateway, atau semua?
- Timeout app lebih pendek atau lebih panjang dari mesh?
- Apakah retry hanya untuk idempotent call?
- Apakah metrics menghitung logical request atau physical attempt?

---

## 22. IPv4, IPv6, dan Happy Eyeballs

Host dapat resolve ke IPv4 dan IPv6:

```text
A record    → 203.0.113.10
AAAA record → 2001:db8::10
```

Jika environment IPv6 tidak benar, client bisa mencoba IPv6 dulu lalu lambat fallback ke IPv4.

Gejala:

- connect latency tinggi
- hanya terjadi di environment tertentu
- curl berbeda dari Java
- DNS terlihat benar tetapi connection lambat

Hal yang perlu dicek:

- apakah host punya A dan AAAA record?
- apakah JVM/OS prefer IPv6?
- apakah firewall mendukung IPv6 route?
- apakah HTTP client punya fallback behavior?

Jangan langsung menaikkan timeout tanpa memahami IP family path.

---

## 23. Redirect dan Topology Shift

Redirect bisa mengubah route.

```text
GET https://api.example.com/v1/file
302 Location: https://cdn.example.net/file/abc
```

Client awalnya connect ke:

```text
api.example.com
```

Lalu pindah ke:

```text
cdn.example.net
```

Implikasi:

- DNS berbeda
- TLS certificate berbeda
- proxy rule berbeda
- auth header tidak boleh sembarang diteruskan
- allowlist host harus memvalidasi redirect target
- observability harus mencatat final host

Security risk:

```text
trusted API redirects to attacker-controlled host
client follows redirect and leaks token
```

Production-grade client harus punya redirect policy eksplisit.

---

## 24. Route-Aware Timeout

Timeout harus mempertimbangkan route.

Direct internal service:

```text
connect timeout: 100–500ms
response timeout: sesuai SLA internal, misal 1–2s
```

External API via proxy/NAT:

```text
connect timeout: 1–3s
response timeout: 5–15s tergantung contract
```

Large file download:

```text
connect timeout pendek
read idle timeout cukup
overall deadline jelas
```

DNS-heavy/dynamic route:

```text
DNS latency harus dimonitor
connect timeout tidak boleh terlalu panjang sehingga fallback IP terlambat
```

Jangan copy-paste satu timeout untuk semua client.

---

## 25. Route-Aware Metrics

Metric HTTP client yang baik tidak hanya:

```text
http.client.duration
http.client.status
```

Tetapi juga membantu menjawab:

- target host apa?
- proxy dipakai atau tidak?
- connection reused atau new?
- DNS duration berapa?
- connect duration berapa?
- TLS duration berapa?
- pool acquire duration berapa?
- remote IP mana?
- protocol HTTP/1.1 atau HTTP/2?
- retry attempt ke berapa?
- failure phase apa?

Tidak semua library expose semua metric secara default, tetapi design wrapper dapat menambahkan event listener/interceptor.

OkHttp punya `EventListener` yang sangat berguna untuk lifecycle metric seperti DNS, connect, TLS, request headers, response headers.

---

## 26. Route-Aware Logging

Log minimal saat failure:

```text
client_name=partner-order-client
method=POST
scheme=https
host=api.partner.com
port=443
path_template=/v1/orders/{id}
proxy=proxy.internal:8080
protocol=HTTP/2
attempt=1
failure_phase=connect
exception=ConnectTimeoutException
elapsed_ms=3000
correlation_id=...
```

Jangan log:

- full URL dengan sensitive query
- Authorization
- Proxy-Authorization
- cookie
- request body penuh
- response body penuh dari external API tanpa redaction

Path template lebih aman daripada raw path jika mengandung ID sensitif.

---

## 27. Failure Taxonomy Berdasarkan Topology

### 27.1 DNS Failure

Gejala:

```text
UnknownHostException
Name or service not known
Temporary failure in name resolution
```

Kemungkinan:

- hostname salah
- DNS server down
- CoreDNS overloaded
- network policy block DNS
- negative cache JVM
- search path/ndots issue

Tindakan:

- cek resolver dari pod/host
- cek JVM negative cache
- cek CoreDNS metrics/log
- cek apakah hostname FQDN benar
- jangan langsung retry agresif

---

### 27.2 Proxy Failure

Gejala:

```text
407 Proxy Authentication Required
403 from proxy
CONNECT timeout
connection refused to proxy
```

Kemungkinan:

- proxy credential salah
- no proxy bypass salah
- proxy ACL block host
- proxy down
- proxy idle timeout
- TLS inspection CA belum trusted

Tindakan:

- pisahkan log proxy host vs target host
- cek proxy auth config
- cek `NO_PROXY`/bypass list
- cek trust store

---

### 27.3 Load Balancer Failure

Gejala:

```text
502 Bad Gateway
503 Service Unavailable
504 Gateway Timeout
connection reset after idle
EOFException
```

Kemungkinan:

- target unhealthy
- idle timeout mismatch
- deregistration/draining
- backend slow
- LB max connection
- TLS termination issue

Tindakan:

- cek LB target health
- cek LB access log
- cek idle timeout
- cek deployment event
- cek retry storm

---

### 27.4 NAT/Egress Failure

Gejala:

```text
connect timeout spike
sporadic outbound failure
high TIME_WAIT
NAT metrics high
```

Kemungkinan:

- too many new connections
- client per request
- pool ineffective
- high concurrency
- retry amplification
- ephemeral port exhaustion

Tindakan:

- reuse client
- tune pool
- reduce concurrency
- rate limit
- inspect socket state
- check NAT gateway metrics

---

## 28. Library Mapping: JDK HttpClient

JDK `HttpClient` relevant knobs:

```java
HttpClient client = HttpClient.newBuilder()
    .connectTimeout(Duration.ofSeconds(3))
    .proxy(ProxySelector.of(new InetSocketAddress("proxy.internal", 8080)))
    .followRedirects(HttpClient.Redirect.NEVER)
    .version(HttpClient.Version.HTTP_2)
    .build();
```

Hal penting:

- `HttpClient` immutable setelah build.
- Client harus direuse.
- `connectTimeout` berlaku pada connect establishment, bukan seluruh request.
- Proxy dikontrol via `ProxySelector`.
- Default proxy behavior bisa berasal dari environment/JVM default.
- Redirect default perlu dipahami dan lebih baik eksplisit.
- Banyak property internal JDK HTTP client dapat dikonfigurasi via system properties, tetapi jangan gunakan tanpa governance.

JDK client cocok jika:

- ingin dependency minimal
- Java 11+
- fitur cukup dengan standard client
- integrasi `CompletableFuture`
- tidak membutuhkan interceptor ecosystem kaya seperti OkHttp

---

## 29. Library Mapping: OkHttp

OkHttp topology-related knobs:

```java
OkHttpClient client = new OkHttpClient.Builder()
    .dns(Dns.SYSTEM)
    .proxy(new Proxy(Proxy.Type.HTTP, new InetSocketAddress("proxy.internal", 8080)))
    .proxyAuthenticator((route, response) -> {
        String credential = Credentials.basic("user", "pass");
        return response.request().newBuilder()
            .header("Proxy-Authorization", credential)
            .build();
    })
    .connectionPool(new ConnectionPool(20, 50, TimeUnit.SECONDS))
    .connectTimeout(Duration.ofSeconds(3))
    .readTimeout(Duration.ofSeconds(5))
    .retryOnConnectionFailure(true)
    .eventListener(new ObservedEventListener())
    .build();
```

OkHttp kuat untuk:

- connection pooling
- HTTP/2
- EventListener observability
- custom DNS
- proxy configuration
- certificate pinning
- transparent recovery dari beberapa connection failure

Tetapi perlu disiplin:

- jangan buat client per request
- response body harus ditutup
- interceptor jangan melakukan blocking berat sembarangan
- retry behavior harus dipahami
- proxy auth/token auth harus dipisah

---

## 30. Library Mapping: Retrofit

Retrofit memakai OkHttp di bawahnya.

Topology policy sebaiknya diletakkan di OkHttp client, bukan di interface Retrofit.

```java
OkHttpClient okHttp = new OkHttpClient.Builder()
    .proxy(ProxySelector.getDefault().select(URI.create("https://api.partner.com")).isEmpty()
        ? Proxy.NO_PROXY
        : null) // contoh ini tidak ideal; biasanya konfigurasi dibuat eksplisit
    .connectTimeout(Duration.ofSeconds(3))
    .readTimeout(Duration.ofSeconds(5))
    .eventListener(new ObservedEventListener())
    .build();

Retrofit retrofit = new Retrofit.Builder()
    .baseUrl("https://api.partner.com/")
    .client(okHttp)
    .addConverterFactory(JacksonConverterFactory.create(objectMapper))
    .build();
```

Prinsip:

```text
Retrofit interface = API contract
OkHttp client = transport/topology policy
wrapper adapter = domain/error/resilience policy
```

Jangan campur semuanya di annotation interface.

---

## 31. Library Mapping: Apache HttpClient 5

Apache HttpClient 5 cocok untuk kontrol route/proxy/connection yang detail.

Contoh konseptual:

```java
PoolingHttpClientConnectionManager cm = PoolingHttpClientConnectionManagerBuilder.create()
    .setMaxConnTotal(200)
    .setMaxConnPerRoute(50)
    .build();

RequestConfig requestConfig = RequestConfig.custom()
    .setConnectionRequestTimeout(Timeout.ofSeconds(1))
    .setResponseTimeout(Timeout.ofSeconds(5))
    .build();

HttpHost proxy = new HttpHost("http", "proxy.internal", 8080);

CloseableHttpClient client = HttpClients.custom()
    .setConnectionManager(cm)
    .setDefaultRequestConfig(requestConfig)
    .setProxy(proxy)
    .evictExpiredConnections()
    .evictIdleConnections(TimeValue.ofSeconds(50))
    .build();
```

Kekuatan Apache:

- route-specific connection limits
- proxy route planner
- classic dan async client
- TLS strategy pluggable
- enterprise proxy/auth use case
- mature connection management

Risiko:

- konfigurasi lebih banyak
- salah membedakan timeout dapat membuat behavior tidak sesuai
- entity/response lifecycle harus benar

---

## 32. Anti-Pattern: HTTP Client Baru per Request

Kode buruk:

```java
public String call(String url) throws IOException {
    OkHttpClient client = new OkHttpClient();
    Request request = new Request.Builder().url(url).build();
    try (Response response = client.newCall(request).execute()) {
        return response.body().string();
    }
}
```

Masalah:

- connection pool baru setiap request
- DNS/cache/pool tidak efektif
- TLS handshake sering
- NAT port churn
- memory/thread overhead
- observability tidak konsisten

Lebih baik:

```java
public final class PartnerApiTransport {
    private final OkHttpClient client;

    public PartnerApiTransport(OkHttpClient client) {
        this.client = client;
    }

    public String call(String url) throws IOException {
        Request request = new Request.Builder().url(url).build();
        try (Response response = client.newCall(request).execute()) {
            if (response.body() == null) {
                return "";
            }
            return response.body().string();
        }
    }
}
```

Client dibuat sebagai singleton/bean per policy group.

---

## 33. Anti-Pattern: DNS Override dengan Hardcoded IP

Kode berbahaya:

```java
OkHttpClient client = new OkHttpClient.Builder()
    .dns(hostname -> List.of(InetAddress.getByName("10.0.1.25")))
    .build();
```

Masalah:

- semua hostname diarahkan ke IP sama
- certificate mismatch
- failover mati
- environment coupling
- security bypass
- operational team sulit debug

Jika butuh override, buat eksplisit per host dan hanya untuk environment tertentu.

```java
final class ControlledDns implements Dns {
    private final Map<String, List<InetAddress>> overrides;

    ControlledDns(Map<String, List<InetAddress>> overrides) {
        this.overrides = Map.copyOf(overrides);
    }

    @Override
    public List<InetAddress> lookup(String hostname) throws UnknownHostException {
        List<InetAddress> overridden = overrides.get(hostname);
        if (overridden != null) {
            return overridden;
        }
        return Dns.SYSTEM.lookup(hostname);
    }
}
```

Tetap perlu audit dan config governance.

---

## 34. Anti-Pattern: Menganggap 502/503 Selalu dari Downstream Application

`502` atau `503` sering berasal dari intermediary:

```text
API Gateway
Load Balancer
Ingress
Service Mesh Sidecar
Proxy
CDN
```

Jangan langsung menyalahkan service target.

Check:

- response header `server`, `via`, `x-envoy-*`, `x-amzn-*`, `x-cache`, dll.
- LB/ingress access log
- service mesh metrics
- target service log
- timing: apakah target menerima request?

Jika target tidak menerima request, failure terjadi sebelum aplikasi target.

---

## 35. Anti-Pattern: Retry Semua Connect Timeout

Connect timeout bisa disebabkan oleh:

- downstream overload
- firewall drop
- NAT port exhaustion
- proxy down
- DNS returned dead IP
- network partition

Retry bisa membantu jika:

- ada multiple IP/route dan next route sehat
- failure transient
- retry budget kecil
- operation idempotent

Retry memperburuk jika:

- NAT exhaustion
- proxy overload
- LB overload
- downstream hard down
- thundering herd

Rule:

```text
retry must be topology-aware, idempotency-aware, deadline-aware, and budgeted
```

---

## 36. Design Pattern: Client Topology Profile

Daripada config tersebar, buat profile per client.

```java
public record HttpClientTopologyProfile(
    String clientName,
    URI baseUri,
    Optional<InetSocketAddress> proxy,
    Duration dnsCacheTtl,
    Duration connectTimeout,
    Duration responseTimeout,
    Duration idleConnectionTimeout,
    int maxConcurrentRequests,
    boolean followRedirects,
    boolean allowHttp2
) {}
```

Lalu client factory membaca profile:

```java
public final class PartnerClientFactory {
    public PartnerApiClient create(HttpClientTopologyProfile profile) {
        OkHttpClient.Builder builder = new OkHttpClient.Builder()
            .connectTimeout(profile.connectTimeout())
            .readTimeout(profile.responseTimeout())
            .connectionPool(new ConnectionPool(
                profile.maxConcurrentRequests(),
                profile.idleConnectionTimeout().toMillis(),
                TimeUnit.MILLISECONDS
            ));

        profile.proxy().ifPresent(proxy ->
            builder.proxy(new Proxy(Proxy.Type.HTTP, proxy))
        );

        return new PartnerApiClient(builder.build(), profile.baseUri());
    }
}
```

Manfaat:

- topology explicit
- mudah review
- mudah audit
- mudah compare antar client
- mengurangi hidden default

---

## 37. Design Pattern: Failure Phase Classification

Jangan hanya log exception class.

Buat classification:

```java
public enum HttpFailurePhase {
    URI_BUILD,
    DNS,
    PROXY_CONNECT,
    POOL_ACQUIRE,
    TCP_CONNECT,
    TLS_HANDSHAKE,
    REQUEST_WRITE,
    RESPONSE_WAIT,
    RESPONSE_READ,
    DECODE,
    STATUS_CODE,
    UNKNOWN
}
```

Lalu error wrapper:

```java
public final class ExternalHttpException extends RuntimeException {
    private final String clientName;
    private final HttpFailurePhase phase;
    private final boolean retryable;
    private final int attempt;

    public ExternalHttpException(
        String clientName,
        HttpFailurePhase phase,
        boolean retryable,
        int attempt,
        String message,
        Throwable cause
    ) {
        super(message, cause);
        this.clientName = clientName;
        this.phase = phase;
        this.retryable = retryable;
        this.attempt = attempt;
    }
}
```

Dengan begini dashboard bisa menjawab:

```text
Failure naik karena DNS? Connect? TLS? Response wait? Decode?
```

---

## 38. Design Pattern: Safe Route Diagnostics Endpoint

Untuk internal service, kadang berguna membuat diagnostic endpoint terbatas.

Contoh output internal/admin-only:

```json
{
  "client": "partner-order-client",
  "baseUrl": "https://api.partner.com",
  "proxyConfigured": true,
  "proxyHost": "proxy.internal",
  "connectTimeoutMs": 3000,
  "responseTimeoutMs": 5000,
  "idleConnectionTimeoutMs": 50000,
  "http2Enabled": true,
  "followRedirects": false
}
```

Jangan expose:

- credential
- token
- full secret path
- private key
- sensitive header

Endpoint ini membantu incident response tanpa membuka kode/config mentah.

---

## 39. Production Troubleshooting Playbook

Saat outbound HTTP client bermasalah, gunakan urutan ini.

### Step 1 — Identifikasi Client dan Target

Tanyakan:

```text
client mana?
target host apa?
method/path apa?
environment apa?
sejak kapan?
apakah semua request atau sebagian?
```

---

### Step 2 — Pisahkan Logical Failure vs Network Failure

Logical failure:

```text
400, 401, 403, 409, validation error, business error
```

Network/topology failure:

```text
DNS, connect timeout, TLS, connection reset, proxy 407, LB 502/503/504
```

Jangan campur runbook-nya.

---

### Step 3 — Cek DNS

Dari environment yang sama:

```bash
nslookup api.partner.com
getent hosts api.partner.com
```

Di container minimal, tools mungkin tidak ada. Bisa gunakan temporary debug pod atau sidecar diagnostic.

Cek:

- hasil IP
- latency lookup
- apakah berubah dari expected
- CoreDNS metrics
- negative cache suspicion

---

### Step 4 — Cek Route/Proxy

Pertanyaan:

```text
Apakah request direct atau proxy?
Proxy host/port apa?
Proxy auth required?
NO_PROXY/bypass benar?
```

Tes dengan curl harus meniru proxy behavior.

Jangan tes direct jika aplikasi memakai proxy.

---

### Step 5 — Cek Connect/TLS

Cek:

```bash
openssl s_client -connect api.partner.com:443 -servername api.partner.com
```

Jika via proxy, test harus menggunakan proxy-aware tooling.

Cek:

- certificate chain
- SNI
- TLS version
- corporate CA
- certificate expiry
- hostname mismatch

---

### Step 6 — Cek Pool dan Socket

Cek:

```bash
ss -tanp
netstat -an
```

Cari:

- banyak `TIME_WAIT`
- banyak `ESTABLISHED`
- banyak connection ke proxy/NAT/target
- socket stuck

Aplikasi-level:

- active connection
- idle connection
- pool acquire latency
- pending request
- dispatcher queue

---

### Step 7 — Cek Load Balancer/Ingress/Mesh

Cek:

- access log
- target health
- 502/503/504 distribution
- idle timeout
- deployment event
- target deregistration
- sidecar metrics

---

### Step 8 — Cek Retry Amplification

Hitung:

```text
logical request rate × attempts per request × mesh/gateway retry
```

Jika request 100 RPS dan retry 3 attempts:

```text
100 logical RPS → up to 300 physical RPS
```

Jika mesh juga retry 2x:

```text
100 × 3 × 2 = 600 physical attempts
```

Ini bisa menjelaskan kenapa recovery tidak terjadi.

---

## 40. Checklist Design Review

Sebelum merge HTTP client integration, jawab ini.

### DNS

- Hostname apa yang dipakai?
- Apakah hostname environment-specific?
- Apakah JVM DNS TTL dikonfigurasi?
- Apakah negative DNS caching dipahami?
- Apakah DNS failover requirement ada?
- Apakah connection pool lifetime selaras dengan DNS change expectation?

### Proxy

- Apakah melewati proxy?
- Proxy config explicit atau default?
- Proxy auth bagaimana?
- NO_PROXY/bypass list ada?
- Apakah TLS inspection terjadi?
- Apakah sensitive header aman dari log proxy?

### Load Balancer

- LB idle timeout berapa?
- Client keep-alive lebih pendek?
- Target deregistration/draining dipahami?
- HTTP/2 didukung end-to-end atau hanya sebagian?
- 502/503/504 berasal dari mana?

### NAT/Egress

- Apakah client reuse connection?
- Max concurrency berapa?
- Retry budget berapa?
- Ada risiko ephemeral port exhaustion?
- Ada observability NAT/egress?

### Kubernetes/Mesh

- Apakah service DNS benar?
- Apakah CoreDNS metrics dimonitor?
- Apakah app retry dan mesh retry dobel?
- Apakah timeout app dan mesh selaras?
- Apakah sidecar mengubah header/protocol?

### Observability

- Log menyertakan client name dan target host?
- Failure phase tercatat?
- Proxy usage tercatat?
- DNS/connect/TLS/pool metrics ada?
- Sensitive data di-redact?

---

## 41. Practical Defaults untuk Production

Tidak ada universal config, tetapi starting point berikut masuk akal untuk banyak backend service.

### Internal Low-Latency API

```text
connect timeout: 200ms–1s
response timeout: 1s–3s
client idle timeout: lebih pendek dari LB idle timeout
retry: 0–1 untuk idempotent call
concurrency limit: explicit
proxy: biasanya no proxy/internal route
```

### External Third-Party API

```text
connect timeout: 1s–3s
response timeout: 5s–15s sesuai SLA
retry: limited, idempotent only, exponential backoff + jitter
proxy: explicit jika enterprise
DNS TTL: sesuai vendor/cloud guidance
rate limit: wajib jika vendor punya quota
```

### File Download API

```text
connect timeout: pendek
read idle timeout: cukup untuk streaming
overall deadline: wajib
body: streaming to file, bukan full memory
retry: hanya jika range/resumable atau idempotent safe
```

### Service Mesh Environment

```text
application timeout < upstream caller deadline
mesh route timeout harmonized
retry owner jelas
metrics logical vs physical attempts dipisah
```

---

## 42. Top 1% Heuristics

Engineer biasa bertanya:

```text
Timeout-nya berapa?
```

Engineer kuat bertanya:

```text
Timeout fase apa?
```

Engineer biasa bertanya:

```text
Kenapa API partner timeout?
```

Engineer kuat bertanya:

```text
Timeout terjadi di DNS, proxy connect, TCP connect, TLS, pool acquire, response wait, atau response read?
```

Engineer biasa membuat client baru karena mudah.

Engineer kuat tahu bahwa client baru per request berarti:

```text
no pooling
more TLS handshake
more NAT port churn
more latency
more failure
```

Engineer biasa menganggap DNS berubah berarti traffic pindah.

Engineer kuat tahu:

```text
DNS lifecycle ≠ connection lifecycle
```

Engineer biasa menganggap retry memperbaiki reliability.

Engineer kuat tahu retry dapat memperparah:

```text
NAT exhaustion
proxy overload
LB overload
retry storm
rate-limit ban
```

Engineer biasa hanya melihat application log.

Engineer kuat menggabungkan:

```text
client metrics
DNS metrics
proxy logs
LB logs
NAT metrics
service mesh metrics
thread dump
socket state
```

---

## 43. Ringkasan Mental Model

HTTP client route bukan garis lurus.

Ia adalah kombinasi dari:

```text
hostname
  + DNS resolver/cache
  + proxy selector
  + connection pool
  + TCP path
  + TLS policy
  + load balancer
  + NAT/egress
  + service mesh/ingress
  + retry/timeout policy
```

Karena itu, production-grade HTTP client harus route-aware.

Minimal ia harus menjawab:

1. Target logical-nya siapa?
2. Target physical-nya ke mana?
3. DNS cache berapa lama?
4. Proxy dipakai atau tidak?
5. Connection pool reuse bagaimana?
6. LB idle timeout berapa?
7. NAT/egress bottleneck mungkin atau tidak?
8. Retry memperbaiki atau memperburuk?
9. Failure terjadi di fase mana?
10. Observability cukup untuk membuktikan semua itu?

Jika jawaban ini tidak tersedia, integration tersebut belum production-grade.

---

## 44. Apa yang Harus Dikuasai Setelah Part Ini

Setelah memahami part ini, Anda harus bisa:

- Menjelaskan kenapa HTTP client perlu memahami topology.
- Membedakan DNS failure, proxy failure, LB failure, NAT failure, dan application failure.
- Menjelaskan hubungan DNS TTL dan connection pool.
- Mendesain proxy-aware HTTP client.
- Menghindari idle timeout mismatch dengan load balancer.
- Mengenali gejala ephemeral port/NAT exhaustion.
- Membaca failure seperti `UnknownHostException`, `ConnectTimeoutException`, `SSLHandshakeException`, `EOFException`, `502`, `503`, dan `504` secara lebih akurat.
- Membuat checklist topology untuk design review.
- Membangun client config yang explicit dan auditable.
- Menentukan metric/log penting untuk diagnosis route-level failure.

---

## 45. Penutup

Part ini adalah jembatan antara HTTP client code dan real production network.

Tanpa pemahaman topology, engineer mudah membuat kesimpulan salah:

```text
"Downstream lambat"
```

padahal masalahnya:

```text
DNS negative cache
proxy CONNECT timeout
LB idle timeout mismatch
NAT port exhaustion
service mesh retry amplification
```

HTTP client engineering yang matang selalu menggabungkan:

```text
application intent
+ transport mechanics
+ infrastructure topology
+ failure classification
+ operational visibility
```

Di part berikutnya, kita akan masuk ke fondasi security transport yang lebih dalam:

```text
Part 9 — TLS, mTLS, Trust Store, Key Store, ALPN, Certificate Pinning
```

Di sana kita akan membahas kenapa HTTPS bukan hanya “pakai https://”, tetapi sebuah trust protocol yang melibatkan certificate chain, trust anchor, hostname verification, key material, ALPN, TLS version, mTLS, dan rotation.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 7 — Connection Pooling, Keep-Alive, HTTP/2 Multiplexing, dan Resource Reuse](./07-connection-pooling-keepalive-http2-multiplexing-resource-reuse.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 9 — TLS, mTLS, Trust Store, Key Store, ALPN, Certificate Pinning](./09-tls-mtls-truststore-keystore-alpn-certificate-pinning.md)
