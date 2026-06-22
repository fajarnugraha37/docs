# Part 2 — Request Lifecycle Deep Dive: Dari Method Call Sampai Response Body

Series: `learn-java-http-client-okhttp-retrofit-client-engineering`  
File: `02-http-request-lifecycle-from-call-to-response.md`  
Target Java: 8 sampai 25  
Level: Advanced / production engineering

---

## 1. Tujuan Part Ini

Di Part 0 kita membingkai HTTP client sebagai **production subsystem**, bukan sekadar utility function. Di Part 1 kita sudah melihat landscape library Java 8–25. Sekarang kita masuk ke fondasi teknis paling penting: **request lifecycle**.

Pertanyaan besar Part 2:

> Ketika kode Java memanggil `client.send(request)` atau `okHttpClient.newCall(request).execute()`, apa sebenarnya yang terjadi dari awal sampai response selesai diproses?

Seorang engineer biasa biasanya melihat HTTP client seperti ini:

```java
Response response = client.call(apiRequest);
```

Seorang engineer production-grade melihatnya seperti ini:

```text
Application intent
  -> URI construction
  -> request object
  -> client policy resolution
  -> DNS resolution
  -> connection acquisition
  -> TCP connect, if no reusable connection exists
  -> TLS handshake, if HTTPS
  -> ALPN negotiation, if HTTP/2 possible
  -> request header write
  -> request body write/stream
  -> server processing wait
  -> response header read
  -> response body read/stream/discard/close
  -> decode/map response
  -> classify success/failure
  -> release or discard connection
  -> emit logs/metrics/traces
  -> return domain result or exception
```

Mental model ini penting karena hampir semua incident HTTP client muncul dari salah satu titik berikut:

- timeout tidak dipahami sebagai beberapa fase berbeda;
- response body tidak dikonsumsi atau tidak ditutup;
- connection pool dibuat per request;
- retry dilakukan di fase yang salah;
- body streaming dianggap bisa diulang padahal tidak;
- DNS, TLS, proxy, atau load balancer dianggap “bukan urusan aplikasi”;
- error 4xx/5xx, timeout, connection reset, dan malformed JSON diperlakukan sama;
- observability hanya mencatat “API failed”, tanpa tahu gagal di fase mana.

Part ini tidak fokus dulu pada sintaks library. Sintaks akan dibahas detail pada Part 14–18. Di sini kita membangun **peta kerja internal** yang bisa diterapkan ke JDK HttpClient, OkHttp, Retrofit, Apache HttpClient, Spring RestClient/WebClient, atau generated OpenAPI client.

---

## 2. Model Besar: HTTP Request adalah Distributed Transaction Kecil

HTTP call sering terlihat sederhana, tetapi secara runtime ia adalah interaksi distributed system.

Satu call outbound menyentuh banyak komponen:

```text
Caller thread / virtual thread / event loop
  -> HTTP client object
  -> executor / dispatcher / connection pool
  -> DNS resolver
  -> OS socket
  -> local network stack
  -> proxy / service mesh / NAT / firewall
  -> load balancer
  -> remote server
  -> remote application
  -> response path kembali
```

Implikasinya:

1. **Tidak semua kegagalan berasal dari remote application.**
   DNS failure, TLS failure, pool starvation, NAT exhaustion, dan local thread starvation bisa terjadi sebelum request menyentuh server.

2. **Tidak semua timeout berarti server lambat.**
   Timeout bisa terjadi saat connect, write body, menunggu response header, membaca response body, atau menunggu slot pool.

3. **Tidak semua retry aman.**
   Jika request body sudah terkirim sebagian atau seluruhnya, retry bisa membuat efek ganda.

4. **Response belum “selesai” ketika status code diterima.**
   Dalam banyak client, connection baru benar-benar bisa direuse setelah response body dikonsumsi atau ditutup.

5. **Client lifecycle memengaruhi performance.**
   Membuat client per request bisa menghancurkan pooling, TLS reuse, dan thread reuse.

---

## 3. Lifecycle Lengkap dalam 17 Tahap

Kita akan bahas lifecycle sebagai 17 tahap. Tidak semua tahap selalu terjadi. Jika connection sudah tersedia di pool, DNS/TCP/TLS mungkin dilewati. Jika request tidak punya body, fase body write trivial. Jika response menggunakan streaming, body read bisa berlangsung lama.

```text
1. Application intent
2. URI construction
3. Request object construction
4. Client policy resolution
5. Interceptor/filter chain: pre-flight
6. DNS resolution
7. Route/proxy selection
8. Connection acquisition from pool
9. TCP connect
10. TLS handshake and ALPN
11. Request header write
12. Request body write
13. Server processing wait / response header wait
14. Response header read
15. Response body handling
16. Decode, map, classify
17. Connection release/discard and telemetry finalization
```

Mari kita uraikan satu per satu.

---

## 4. Tahap 1 — Application Intent

Lifecycle dimulai bukan dari socket, tetapi dari intent aplikasi:

```text
"Saya ingin mengambil detail customer dari Customer API"
"Saya ingin mengirim command create payment ke Payment Gateway"
"Saya ingin download report dari Storage API"
```

Intent ini harus diterjemahkan menjadi contract teknis:

- endpoint mana yang dipanggil;
- method apa yang digunakan;
- apakah operasi idempotent;
- timeout budget berapa;
- apakah perlu authentication;
- apakah boleh retry;
- apakah response kecil atau besar;
- apakah body bisa di-buffer atau harus streaming;
- error seperti apa yang mungkin dikembalikan;
- apakah call ini user-facing, batch, atau async background.

Kesalahan umum: langsung menulis helper seperti ini:

```java
String response = HttpUtils.post(url, json);
```

Masalahnya, helper seperti ini menghapus informasi penting:

- apakah POST ini idempotent?
- timeout-nya berasal dari mana?
- apakah token perlu refresh?
- status 409 dianggap error atau expected business condition?
- apakah response harus masuk audit?
- apakah body aman dilog?

Top-tier engineer biasanya mulai dari contract:

```java
CustomerProfileResult getCustomerProfile(CustomerProfileRequest request);
```

Lalu HTTP menjadi detail adapter, bukan bocor ke seluruh domain service.

---

## 5. Tahap 2 — URI Construction

URI construction adalah tahap yang sering diremehkan, padahal bug di sini bisa menjadi security issue atau data correctness issue.

Contoh input:

```text
baseUrl = https://api.example.com
path = /customers/{customerId}/orders
customerId = A/B 123
query = status=OPEN&sort=createdDate desc
```

Pertanyaan penting:

- Apakah `customerId` harus dianggap path segment atau raw path?
- Apakah `/` dalam `A/B 123` harus menjadi `%2F`?
- Apakah spasi menjadi `%20` atau `+`?
- Apakah query value sudah encoded atau belum?
- Apakah base URL selalu diakhiri `/`?
- Apakah path yang diawali `/` akan mengganti base path?

Contoh bug:

```java
String url = baseUrl + "/customers/" + customerId;
```

Jika `customerId = "../../admin"`, maka secara string terlihat biasa, tetapi secara URI bisa menjadi ambiguity. Jika `customerId = "A/B"`, server bisa membaca dua path segment, bukan satu ID.

Safe pattern:

- gunakan URI/URL builder library;
- bedakan path segment dan raw path;
- jangan pre-encode lalu encode lagi;
- validasi scheme dan host jika URL berasal dari input;
- jangan membangun URL dengan string concatenation untuk input dinamis.

Library implication:

- OkHttp memiliki `HttpUrl` yang kuat untuk path/query composition;
- JDK memiliki `URI`, tetapi builder-nya tidak seergonomis beberapa library;
- Retrofit annotation seperti `@Path`, `@Query`, dan `@Url` memiliki semantik encoding yang harus dipahami;
- Spring `UriComponentsBuilder` sering dipakai di ekosistem Spring.

Invariant yang perlu dipegang:

```text
Data yang merupakan path segment harus di-encode sebagai segment.
Data yang merupakan query value harus di-encode sebagai query value.
Data yang sudah encoded tidak boleh blindly di-encode ulang.
URL dari user input tidak boleh dipercaya tanpa allowlist/validation.
```

---

## 6. Tahap 3 — Request Object Construction

Setelah URI, aplikasi membangun request object.

Request object biasanya mencakup:

- method: GET, POST, PUT, PATCH, DELETE, HEAD;
- URI;
- headers;
- body;
- per-request timeout;
- HTTP version preference;
- tags/context metadata;
- optional authentication metadata.

Contoh konseptual:

```text
Request
  method: POST
  uri: https://payment.example.com/v1/payments
  headers:
    Content-Type: application/json
    Accept: application/json
    Authorization: Bearer ***
    Idempotency-Key: 01H...
    traceparent: 00-...
  body:
    JSON bytes or stream
  policy:
    timeout: 2s deadline
    retry: only if no bytes sent or idempotency key present
```

Kesalahan umum:

1. **Header global disuntikkan secara membabi buta.**

   Misalnya semua inbound headers diteruskan ke downstream. Ini bisa membocorkan cookie, authorization token, internal routing header, atau header berukuran besar.

2. **Body selalu dibuat sebagai string.**

   Untuk payload besar, ini bisa membuat memory pressure.

3. **Tidak ada request identity.**

   Tanpa correlation ID atau idempotency key, debugging dan deduplication menjadi sulit.

4. **Method tidak sesuai semantics.**

   Menggunakan GET untuk operasi yang mengubah state, atau POST untuk query yang seharusnya cacheable/idempotent.

5. **Timeout tidak ditempelkan ke request.**

   Semua request memakai default yang sama, padahal API berbeda punya SLA berbeda.

---

## 7. Tahap 4 — Client Policy Resolution

Sebelum request dikirim, HTTP client atau wrapper internal perlu menentukan policy.

Policy meliputi:

- timeout;
- retry;
- redirect;
- authentication;
- proxy;
- TLS configuration;
- connection pool;
- rate limit;
- circuit breaker;
- logging level;
- metrics tag;
- tracing propagation;
- response size limit;
- decompression;
- cookie handling.

Policy bisa berasal dari:

```text
global default
  -> per downstream client config
  -> per endpoint config
  -> per request override
```

Contoh:

```yaml
clients:
  customer-api:
    base-url: https://customer.internal
    connect-timeout: 300ms
    response-timeout: 1500ms
    max-concurrency: 100
    retry:
      max-attempts: 2
      retry-on: [connect-timeout, 502, 503, 504]
  payment-gateway:
    base-url: https://payment.vendor.com
    connect-timeout: 500ms
    response-timeout: 3000ms
    retry:
      max-attempts: 1
    idempotency-key-required: true
```

Top-tier mental model:

> Policy bukan tempelan belakangan. Policy adalah bagian dari contract client.

Jika policy tidak eksplisit, production behavior akan ditentukan oleh default library. Default library belum tentu sesuai sistemmu.

---

## 8. Tahap 5 — Interceptor / Filter Chain: Pre-Flight

Banyak HTTP client modern menyediakan interception layer.

Contoh:

- OkHttp: application interceptor dan network interceptor;
- Retrofit: umumnya memakai OkHttp interceptor di bawahnya;
- Spring WebClient: `ExchangeFilterFunction`;
- Spring RestClient: interceptor/filter tergantung konfigurasi;
- Apache HttpClient: request/response interceptors;
- JDK HttpClient: tidak punya interceptor first-class seperti OkHttp, sehingga biasanya wrapper dibuat sendiri.

Pre-flight interceptor bisa melakukan:

- inject authorization header;
- inject correlation ID;
- inject trace context;
- add idempotency key;
- redact log;
- validate URL allowlist;
- apply metrics start time;
- enforce max body size;
- reject unsafe redirect target;
- resolve tenant-specific credential.

Namun interceptor juga berbahaya jika terlalu pintar.

Anti-pattern:

```text
Interceptor melakukan business decision besar.
Interceptor membaca seluruh body hanya untuk logging.
Interceptor auto-retry tanpa tahu idempotency.
Interceptor refresh token tanpa concurrency guard.
Interceptor mengubah URL diam-diam.
Interceptor menangkap semua exception dan mengubahnya jadi null.
```

Rule of thumb:

```text
Interceptor cocok untuk cross-cutting protocol concern.
Interceptor buruk untuk domain workflow yang perlu eksplisit dan mudah ditest.
```

---

## 9. Tahap 6 — DNS Resolution

Jika tidak ada reusable connection, client harus menemukan IP address untuk host.

```text
api.example.com -> 10.10.1.25 / 10.10.2.31 / IPv6 address / etc.
```

DNS bisa tampak sederhana, tetapi production failure sering terjadi di sini:

- DNS server lambat;
- DNS cache terlalu lama;
- DNS record berubah tetapi JVM masih cache;
- Kubernetes CoreDNS overload;
- split-horizon DNS berbeda antara environment;
- IPv6 dicoba dulu lalu lambat fallback ke IPv4;
- DNS mengembalikan beberapa IP tetapi client tidak mencoba alternatif;
- service discovery berubah tetapi connection pool masih menahan koneksi lama.

Yang perlu dipahami:

1. **DNS resolution sering terjadi hanya saat perlu connection baru.**
   Jika connection pool masih punya koneksi hidup ke IP lama, request bisa terus memakai koneksi itu.

2. **DNS TTL tidak selalu sama dengan behavior JVM/client.**
   JVM punya DNS cache policy sendiri, security property sendiri, dan runtime/container bisa punya resolver behavior sendiri.

3. **DNS failure tidak sama dengan HTTP failure.**
   Jika DNS gagal, request bahkan belum menyentuh server.

4. **Retry DNS failure berbeda dari retry 503.**
   Retry cepat ke DNS yang sedang down bisa memperparah pressure.

Metric yang berguna:

```text
http.client.dns.duration
http.client.dns.error.count
http.client.connect.duration
http.client.connect.error.count
```

Tidak semua library mengekspos DNS metric out-of-the-box. Kadang perlu event listener, wrapper, atau instrumentation khusus.

---

## 10. Tahap 7 — Route / Proxy Selection

Sebelum connect, client menentukan route.

Route bisa berupa:

```text
direct: caller -> server
via HTTP proxy: caller -> proxy -> server
via CONNECT tunnel: caller -> proxy -> TLS server
via service mesh sidecar: caller -> localhost sidecar -> server
via corporate gateway
via egress NAT
```

Proxy dan route memengaruhi:

- connect target;
- TLS handshake target;
- authentication;
- latency;
- failure mode;
- certificate validation;
- observability;
- source IP yang terlihat server;
- compliance/audit requirement.

Production concern:

- proxy butuh authentication;
- proxy menutup idle connection lebih cepat dari client;
- proxy melakukan TLS inspection;
- proxy mengubah header;
- corporate proxy menolak method tertentu;
- service mesh menambahkan retry sendiri;
- NAT gateway mengalami port exhaustion.

Jika aplikasi berjalan di Kubernetes/cloud, route bukan hanya “URL tujuan”. Ada path aktual yang bisa melibatkan:

```text
Pod
  -> node network
  -> kube-proxy / CNI
  -> service mesh sidecar
  -> NAT gateway
  -> firewall
  -> load balancer
  -> downstream
```

Seorang engineer top-tier tidak berhenti di stack trace Java. Ia juga bertanya:

```text
Request ini keluar lewat mana?
Apakah ada proxy?
Apakah source IP berubah?
Apakah ada LB idle timeout?
Apakah ada mesh retry?
Apakah ada egress allowlist?
```

---

## 11. Tahap 8 — Connection Acquisition from Pool

Sebelum membuat koneksi baru, HTTP client biasanya mencoba mengambil koneksi yang bisa direuse dari pool.

Connection pool menyimpan koneksi idle agar request berikutnya tidak perlu membayar biaya:

- DNS lookup;
- TCP handshake;
- TLS handshake;
- slow start/network warm-up.

Mental model:

```text
Request datang
  -> cari existing connection yang cocok
    -> same scheme
    -> same host/port
    -> compatible proxy/route
    -> compatible TLS/session/address policy
    -> healthy enough
  -> jika ada: pakai
  -> jika tidak ada: buat koneksi baru
```

Untuk HTTP/1.1:

```text
1 connection biasanya melayani 1 in-flight request pada satu waktu.
```

Untuk HTTP/2:

```text
1 connection bisa membawa banyak stream concurrent, selama server/client setting mengizinkan.
```

Failure mode penting:

1. **Pool starvation.**
   Semua connection sedang dipakai, request menunggu slot.

2. **Connection leak.**
   Response body tidak ditutup sehingga connection tidak kembali ke pool.

3. **Too many clients.**
   Membuat client baru per request menyebabkan pool baru per request, bukan reuse.

4. **Idle timeout mismatch.**
   Client mengira koneksi masih sehat, load balancer sudah menutupnya.

5. **Stale pooled connection.**
   Koneksi lama mengarah ke instance lama atau path lama setelah deployment/network change.

6. **HTTP/2 stream exhaustion.**
   Satu connection HTTP/2 tampak ada, tetapi max concurrent stream tercapai.

Poin penting:

> Connection pool bukan optimisasi kecil. Ia adalah salah satu resource manager utama HTTP client.

---

## 12. Tahap 9 — TCP Connect

Jika tidak ada reusable connection, client membuat TCP connection.

```text
SYN -> SYN-ACK -> ACK
```

Dari sisi Java, ini tampak seperti `connect()` berhasil atau gagal. Dari sisi network, banyak hal bisa terjadi:

- host unreachable;
- connection refused;
- packet drop;
- firewall block;
- security group deny;
- SYN timeout;
- NAT issue;
- ephemeral port exhaustion;
- routing problem;
- server accept queue penuh.

Connect timeout mengontrol berapa lama client menunggu fase ini.

Kesalahan umum:

```text
connect timeout terlalu besar, misalnya 30 detik untuk API user-facing.
```

Jika downstream tidak reachable, thread/coroutine/virtual thread bisa tertahan terlalu lama. Dalam fan-out call, ini bisa mengakumulasi latency besar.

Rule of thumb awal, bukan angka mutlak:

```text
internal same-region service: connect timeout sering ratusan milidetik
external API: connect timeout bisa lebih longgar
batch/non-user-facing: bisa lebih longgar lagi
```

Namun angka final harus berasal dari latency data, SLA, network topology, dan retry policy.

---

## 13. Tahap 10 — TLS Handshake dan ALPN

Untuk HTTPS, setelah TCP connect berhasil, client melakukan TLS handshake.

TLS handshake bertujuan untuk:

- menyepakati versi TLS;
- menyepakati cipher suite;
- memverifikasi certificate server;
- melakukan key exchange;
- optional client certificate authentication untuk mTLS;
- ALPN negotiation untuk memilih HTTP/1.1 atau HTTP/2.

Failure mode:

- certificate expired;
- hostname mismatch;
- unknown CA;
- incomplete certificate chain;
- unsupported TLS version;
- cipher mismatch;
- mTLS client cert tidak valid;
- private key tidak cocok;
- ALPN negotiation gagal;
- TLS inspection proxy mengganti cert;
- clock server/client salah.

Kesalahan fatal yang sering dilakukan:

```java
// Anti-pattern: trust all certificates
TrustManager[] trustAll = ...
```

Ini mungkin “memperbaiki” error di DEV, tetapi menghancurkan security model di production.

Mental model:

```text
TLS failure adalah boundary security, bukan sekadar connectivity issue.
```

Jika TLS gagal, jangan langsung disable verification. Investigasi:

- cert chain;
- trust store;
- hostname;
- SAN;
- expiry;
- environment proxy;
- mTLS config;
- Java version/security provider.

---

## 14. Tahap 11 — Request Header Write

Setelah connection siap, client menulis request line/pseudo-header dan headers.

Untuk HTTP/1.1, secara konseptual:

```http
POST /v1/payments HTTP/1.1
Host: api.example.com
Content-Type: application/json
Accept: application/json
Authorization: Bearer ***
Content-Length: 123
```

Untuk HTTP/2, format wire berbeda: binary framing dan pseudo-headers seperti `:method`, `:path`, `:authority`, `:scheme`.

Header write bisa gagal jika:

- connection sudah ditutup peer;
- socket reset;
- write timeout;
- proxy memutus koneksi;
- request header terlalu besar;
- invalid header value;
- server menolak early.

Header engineering penting karena header sering membawa:

- auth;
- tracing;
- correlation;
- content negotiation;
- idempotency;
- conditional request;
- tenant context.

Jangan pernah log header mentah tanpa redaction. Header seperti ini sensitif:

```text
Authorization
Cookie
Set-Cookie
X-Api-Key
Proxy-Authorization
Idempotency-Key, tergantung domain
```

---

## 15. Tahap 12 — Request Body Write

Jika request punya body, client menulis body setelah header.

Body bisa berupa:

- byte array;
- string;
- JSON serialized object;
- file stream;
- multipart stream;
- reactive publisher;
- generated stream.

Poin penting:

> Setelah body mulai dikirim, retry semantics berubah.

Misalnya:

```text
POST /payments
body: { amount: 100000, target: ... }
```

Jika koneksi reset setelah client mengirim body tetapi sebelum response diterima, apakah server menerima command itu? Tidak selalu bisa diketahui.

Kemungkinan:

```text
A. body belum sampai server -> retry aman
B. body sebagian sampai -> server reject/malformed
C. body penuh sampai dan diproses -> retry bisa double charge
D. body penuh sampai tapi response hilang -> client tidak tahu hasilnya
```

Karena itu operasi command penting membutuhkan:

- idempotency key;
- request ID;
- server-side deduplication;
- status query endpoint;
- retry policy yang memahami ambiguity.

Untuk body besar:

- jangan buffer seluruh file ke memory;
- gunakan streaming body;
- pastikan timeout write memadai;
- pertimbangkan checksum;
- pertimbangkan upload resume jika domain membutuhkan;
- jangan log body.

---

## 16. Tahap 13 — Server Processing Wait / Response Header Wait

Setelah request terkirim, client menunggu response header.

Fase ini mencakup:

```text
network transit
  -> load balancer
  -> server accept/read
  -> server application processing
  -> server write response header
  -> network transit back
```

Dari sisi client, ini sering terlihat sebagai “read timeout” atau “response timeout”. Namun penyebabnya bisa banyak:

- downstream slow query;
- downstream thread pool penuh;
- downstream GC pause;
- load balancer queue;
- server rate limiting;
- packet loss;
- service mesh retry;
- upstream dependency downstream lambat;
- head-of-line blocking;
- HTTP/2 stream contention.

Metric yang perlu dipisahkan:

```text
request write duration
response header wait duration
total call duration
response body read duration
```

Tanpa pemisahan ini, semua terlihat sebagai “latency API tinggi”.

---

## 17. Tahap 14 — Response Header Read

Ketika response header diterima, client mulai mengetahui:

- status code;
- content type;
- content length;
- transfer encoding;
- cache headers;
- retry-after;
- rate limit headers;
- set-cookie;
- server trace/request ID;
- ETag;
- response compression;
- connection close/keep-alive signal.

Contoh:

```http
HTTP/1.1 429 Too Many Requests
Content-Type: application/json
Retry-After: 30
X-RateLimit-Remaining: 0
```

Response header bisa cukup untuk mengambil keputusan awal:

- 204: tidak ada body;
- 304: gunakan cache/local representation;
- 401: token invalid/expired;
- 403: forbidden, jangan refresh token sembarangan;
- 404: bisa domain not found atau endpoint salah;
- 409: conflict, mungkin business condition;
- 429: throttle/backoff;
- 500/502/503/504: server/proxy/downstream failure.

Namun ingat:

> Status code diterima bukan berarti lifecycle selesai. Body masih harus diperlakukan dengan benar.

---

## 18. Tahap 15 — Response Body Handling

Ini salah satu bagian paling krusial.

Response body bisa:

- tidak ada;
- kecil dan dibaca sebagai string/byte array;
- JSON dan didecode menjadi DTO;
- error JSON;
- file besar dan ditulis ke disk;
- stream panjang;
- compressed;
- malformed;
- lebih besar dari yang diharapkan;
- berhenti di tengah.

### 18.1 Body Harus Dikonsumsi atau Ditutup

Banyak HTTP client mengaitkan lifecycle connection dengan response body. Jika body tidak dibaca atau tidak ditutup, connection bisa tidak kembali ke pool.

Konsep umumnya:

```text
response header diterima
  -> body stream tersedia
  -> aplikasi membaca body sampai selesai atau menutup body
  -> client tahu connection bisa dipakai ulang atau harus dibuang
```

Anti-pattern OkHttp-style:

```java
Response response = client.newCall(request).execute();
if (response.code() == 200) {
    return true;
}
// response tidak ditutup
```

Safe pattern:

```java
try (Response response = client.newCall(request).execute()) {
    if (!response.isSuccessful()) {
        String error = response.body() != null ? response.body().string() : "";
        throw new ExternalApiException(response.code(), error);
    }
    return response.body() != null ? response.body().string() : "";
}
```

Untuk JDK HttpClient, body handling ditentukan oleh `BodyHandler`. Jika memakai `ofString()`, body dibaca menjadi string. Jika memakai streaming handler, lifecycle stream harus dipahami.

### 18.2 Jangan Membaca Body Dua Kali

Banyak body stream hanya bisa dibaca sekali.

Anti-pattern:

```java
String raw = response.body().string();
log.info("Response: {}", raw);
MyDto dto = mapper.readValue(response.body().string(), MyDto.class); // body sudah habis
```

Safe pattern:

```java
String raw = response.body().string();
log.debug("Response: {}", safeRedact(raw));
MyDto dto = mapper.readValue(raw, MyDto.class);
```

Namun untuk body besar, bahkan ini tidak aman karena membaca seluruh body ke memory.

### 18.3 Error Body Juga Body

Response 4xx/5xx sering memiliki error body.

Contoh:

```json
{
  "code": "RATE_LIMIT_EXCEEDED",
  "message": "Too many requests",
  "retryAfterSeconds": 30
}
```

Error body perlu:

- dibaca dengan size limit;
- diredact jika sensitif;
- diparse jika contract stabil;
- tetap ditutup;
- dimasukkan ke error model internal;
- tidak selalu dilempar sebagai string mentah.

### 18.4 Streaming Response

Untuk download besar:

```text
response body stream -> file output stream
```

Concern:

- partial file jika stream gagal;
- checksum;
- disk full;
- cancellation;
- timeout selama download;
- progress metric;
- cleanup file sementara;
- tidak membaca seluruh file ke memory.

Safe pattern:

```text
download to temp file
  -> verify checksum/size
  -> atomic move to final location
```

### 18.5 Response Size Limit

Jika API seharusnya mengembalikan 10 KB, tetapi tiba-tiba mengembalikan 200 MB HTML error page, client bisa mengalami memory pressure.

Production client sebaiknya punya:

- max response body size untuk buffered body;
- streaming untuk large response;
- content type validation;
- content length sanity check;
- decompressed size awareness.

---

## 19. Tahap 16 — Decode, Map, Classify

Setelah body tersedia, client melakukan decode.

Layer decode:

```text
bytes
  -> charset/string or stream parser
  -> JSON/XML/form parser
  -> transport DTO
  -> domain-safe result/error
```

Failure bisa terjadi di setiap layer:

- invalid charset;
- invalid JSON;
- unknown enum;
- missing required field;
- wrong date format;
- numeric precision loss;
- incompatible schema;
- error envelope tidak sesuai;
- response HTML dari proxy padahal expected JSON.

Top-tier client tidak menganggap parse error sebagai `500` biasa. Parse error berarti:

```text
Protocol/contract failure between client and provider.
```

Maka error classification harus membedakan:

```text
TransportFailure
  - DnsFailure
  - ConnectFailure
  - TlsFailure
  - TimeoutFailure
  - ConnectionReset

HttpFailure
  - Unauthorized
  - Forbidden
  - NotFound
  - Conflict
  - RateLimited
  - ServerError
  - BadGateway
  - ServiceUnavailable

ProtocolFailure
  - UnexpectedContentType
  - MalformedBody
  - SchemaMismatch
  - BodyTooLarge

DomainFailure
  - CustomerNotEligible
  - PaymentRejected
  - DuplicateRequest
```

Mengapa ini penting?

Karena setiap kategori punya response berbeda:

- DNS failure mungkin retry dengan backoff atau open circuit;
- 401 mungkin refresh token;
- 403 biasanya tidak retry;
- 429 patuh pada `Retry-After`;
- malformed JSON perlu alert contract drift;
- domain rejection tidak boleh dianggap technical incident.

---

## 20. Tahap 17 — Connection Release/Discard dan Telemetry Finalization

Lifecycle selesai ketika:

- response body sudah selesai/diclose;
- connection dikembalikan ke pool atau dibuang;
- metrics dicatat;
- tracing span ditutup;
- logs ditulis;
- retry/circuit/rate limiter state diperbarui;
- result/exception dikembalikan ke caller.

Connection bisa direuse jika:

- protocol mengizinkan;
- body selesai dibaca atau properly discarded;
- server tidak mengirim `Connection: close`;
- tidak ada fatal protocol error;
- socket dianggap sehat;
- pool masih menerima idle connection.

Connection harus dibuang jika:

- body tidak bisa diselesaikan;
- stream corrupt;
- server menutup koneksi;
- TLS/session error;
- protocol violation;
- client membatalkan request;
- idle pool penuh;
- route sudah tidak valid.

Telemetry finalization harus mencatat minimal:

```text
client.name
method
host/service logical name
status_code, jika ada
exception_type, jika ada
outcome
attempt_number
total_duration
request_body_size, jika aman
response_body_size, jika tersedia
retry_count
timeout_type, jika bisa diketahui
```

Hindari high-cardinality label seperti:

```text
full URL dengan raw query
customer ID
email
token
request body hash yang unik per request
```

---

## 21. Lifecycle dalam Bentuk Diagram

```text
┌────────────────────┐
│ Application Intent │
└─────────┬──────────┘
          │
          v
┌────────────────────┐
│ Build URI/Request  │
└─────────┬──────────┘
          │
          v
┌────────────────────┐
│ Resolve Policy     │
│ timeout/retry/auth │
└─────────┬──────────┘
          │
          v
┌────────────────────┐
│ Interceptors       │
│ trace/auth/logging │
└─────────┬──────────┘
          │
          v
┌────────────────────┐       yes
│ Reusable connection│──────────────┐
│ in pool?           │              │
└─────────┬──────────┘              │
          │ no                      │
          v                         │
┌────────────────────┐              │
│ DNS Resolution     │              │
└─────────┬──────────┘              │
          v                         │
┌────────────────────┐              │
│ TCP Connect        │              │
└─────────┬──────────┘              │
          v                         │
┌────────────────────┐              │
│ TLS + ALPN         │              │
└─────────┬──────────┘              │
          │                         │
          └──────────────┬──────────┘
                         v
              ┌────────────────────┐
              │ Write request      │
              │ headers/body       │
              └─────────┬──────────┘
                        v
              ┌────────────────────┐
              │ Wait response      │
              │ headers            │
              └─────────┬──────────┘
                        v
              ┌────────────────────┐
              │ Read/stream/close  │
              │ response body      │
              └─────────┬──────────┘
                        v
              ┌────────────────────┐
              │ Decode/classify    │
              │ result/error       │
              └─────────┬──────────┘
                        v
              ┌────────────────────┐
              │ Release/discard    │
              │ connection         │
              └─────────┬──────────┘
                        v
              ┌────────────────────┐
              │ Emit telemetry     │
              └────────────────────┘
```

---

## 22. Timeout Bukan Satu Angka

Banyak bug desain terjadi karena engineer mengatakan:

```text
Timeout API ini 5 detik.
```

Padahal pertanyaannya:

```text
5 detik untuk apa?
```

Kemungkinan timeout:

| Timeout | Makna |
|---|---|
| DNS timeout | waktu menunggu resolusi host |
| pool acquisition timeout | waktu menunggu connection/stream tersedia |
| connect timeout | waktu membuka TCP connection |
| TLS handshake timeout | waktu negosiasi TLS |
| write timeout | waktu menulis request body |
| response header timeout | waktu menunggu header pertama dari response |
| read timeout | waktu antar pembacaan body atau keseluruhan body tergantung library |
| call timeout | waktu total satu attempt/call |
| deadline | batas absolut dari operasi end-to-end |

Contoh buruk:

```text
connect timeout = 10s
read timeout = 60s
retry = 3x
```

Worst case bisa jauh lebih besar dari ekspektasi user-facing.

Contoh berpikir lebih baik:

```text
User operation budget: 2s
Internal processing budget before HTTP call: 200ms
Remaining HTTP budget: 1.8s
Attempt 1:
  connect: 200ms
  response: 700ms
Attempt 2 only if retryable:
  backoff: 100ms jittered
  connect/response remaining budget: max 800ms
Hard deadline: 2s from operation start
```

Principle:

```text
Timeout lokal harus tunduk pada deadline global.
Retry harus mengonsumsi budget, bukan menggandakan budget secara diam-diam.
```

---

## 23. Retry Boundary dalam Lifecycle

Retry harus mempertimbangkan fase gagal.

| Fase gagal | Retry biasanya aman? | Catatan |
|---|---:|---|
| DNS gagal | Kadang | gunakan backoff, jangan tight loop |
| connect gagal sebelum request terkirim | Biasanya lebih aman | server belum menerima request |
| TLS gagal | Biasanya tidak | sering config/security issue |
| gagal sebelum body terkirim | Tergantung method | GET lebih aman daripada POST |
| gagal saat body streaming | Berbahaya | server mungkin menerima sebagian/penuh |
| response header 503 | Bisa | jika endpoint retryable |
| response 429 | Bisa nanti | hormati `Retry-After` |
| response 400 | Tidak | request salah |
| response 401 | Refresh token lalu retry terbatas | perlu guard agar tidak infinite loop |
| response 409 | Domain-specific | bisa expected conflict |
| malformed response | Biasanya tidak | contract/provider/proxy issue |

Key insight:

```text
Retry decision bukan hanya berdasarkan exception/status code.
Retry decision juga berdasarkan apakah request sudah punya side effect possibility.
```

Untuk POST command, retry aman jika ada:

- idempotency key;
- server-side deduplication;
- operation status lookup;
- documented retry semantics.

---

## 24. Lifecycle dan Observability

Observability yang baik mengikuti lifecycle.

Minimal span/log event:

```text
http.client.request.start
http.client.dns.start/end, jika tersedia
http.client.connect.start/end, jika tersedia
http.client.tls.start/end, jika tersedia
http.client.request.headers.sent
http.client.request.body.sent
http.client.response.headers.received
http.client.response.body.completed
http.client.request.end
```

Tidak semua harus menjadi log. Banyak sebaiknya menjadi metric/span event.

Metric utama:

```text
http.client.duration
http.client.active.requests
http.client.request.size
http.client.response.size
http.client.errors
http.client.timeouts
http.client.retries
http.client.pool.active.connections
http.client.pool.idle.connections
http.client.pool.pending.requests
http.client.dns.duration
http.client.connect.duration
http.client.tls.duration
```

Label/tag yang aman:

```text
client_name = customer-api
method = GET
route_template = /customers/{id}
outcome = success/error/timeout
status_code = 200/404/500
exception_class = ConnectTimeoutException
```

Label/tag yang berbahaya:

```text
full_url = /customers/123456789/orders?token=...
customer_id = 123456789
email = user@example.com
raw_error_message = contains dynamic value
```

---

## 25. Library Mapping: Lifecycle di JDK HttpClient, OkHttp, Retrofit, Apache

### 25.1 JDK HttpClient

Konsep:

```java
HttpClient client = HttpClient.newBuilder().build();
HttpRequest request = HttpRequest.newBuilder(uri).GET().build();
HttpResponse<String> response = client.send(request, BodyHandlers.ofString());
```

Mapping lifecycle:

| Lifecycle | JDK HttpClient concept |
|---|---|
| request object | `HttpRequest` |
| body write | `HttpRequest.BodyPublisher` |
| sync call | `send` |
| async call | `sendAsync` + `CompletableFuture` |
| body read | `HttpResponse.BodyHandler` / `BodySubscriber` |
| HTTP version | `HttpClient.Version` / request version preference |
| redirect | `Redirect` policy |
| proxy | `ProxySelector` |
| auth | `Authenticator` |
| executor | client executor |

Poin penting:

- `BodyHandler` menentukan cara response body diproses;
- `sendAsync` mengembalikan `CompletableFuture`;
- client sebaiknya dibuat reusable, bukan per request;
- interceptor tidak sekuat OkHttp sehingga wrapper architecture sering diperlukan.

### 25.2 OkHttp

Konsep:

```java
OkHttpClient client = new OkHttpClient();
Request request = new Request.Builder().url(url).build();
try (Response response = client.newCall(request).execute()) {
    String body = response.body().string();
}
```

Mapping lifecycle:

| Lifecycle | OkHttp concept |
|---|---|
| request object | `Request` |
| call object | `Call` |
| sync call | `execute()` |
| async call | `enqueue()` |
| request body | `RequestBody` |
| response body | `ResponseBody` |
| interceptor | application/network interceptor |
| connection pool | `ConnectionPool` |
| threading | `Dispatcher` |
| event telemetry | `EventListener` |
| TLS pinning | `CertificatePinner` |
| DNS override | `Dns` |

Poin penting:

- `Response` / `ResponseBody` harus ditutup;
- `OkHttpClient` sebaiknya reused;
- interceptor sangat powerful tetapi bisa disalahgunakan;
- event listener dapat membantu observability fase lifecycle.

### 25.3 Retrofit

Retrofit berada di level lebih tinggi.

```java
interface CustomerApi {
    @GET("customers/{id}")
    Call<CustomerDto> getCustomer(@Path("id") String id);
}
```

Mapping lifecycle:

| Lifecycle | Retrofit concept |
|---|---|
| request construction | annotation processing runtime |
| path/query/header | `@Path`, `@Query`, `@Header` |
| body | `@Body`, `@Part`, converter |
| call execution | `Call<T>` |
| sync | `execute()` |
| async | `enqueue()` or call adapter |
| decode | converter, e.g. Jackson/Gson/Moshi |
| non-2xx | `Response<T>` or `HttpException` depending adapter |
| low-level lifecycle | delegated to OkHttp by default/common usage |

Poin penting:

- Retrofit menyederhanakan API client interface;
- lifecycle connection tetap milik HTTP client di bawahnya;
- error body parsing tetap harus didesain;
- jangan biarkan generated/interface DTO bocor ke domain sembarangan.

### 25.4 Apache HttpClient 5

Mapping lifecycle:

| Lifecycle | Apache HttpClient concept |
|---|---|
| request | `ClassicHttpRequest` / fluent API |
| connection manager | pooling connection manager |
| route | route planner |
| timeout/config | request config / connection config |
| entity/body | `HttpEntity` |
| response handling | response handler |
| async | async client APIs |
| TLS | TLS strategy / SSL context |

Poin penting:

- kuat untuk enterprise/proxy/custom routing;
- connection manager sangat configurable;
- response entity harus dikonsumsi/ditutup sesuai API usage;
- lebih verbose tetapi powerful.

---

## 26. Contoh Desain Wrapper yang Lifecycle-Aware

Daripada membuat `HttpUtils`, buat client adapter yang eksplisit.

```java
public interface CustomerDirectoryClient {
    CustomerLookupResult lookupCustomer(CustomerLookupCommand command);
}
```

Implementation bertanggung jawab atas:

```text
URI construction
headers
auth
timeout
retry
response parsing
error mapping
metrics
logging
```

Pseudo-code:

```java
public final class HttpCustomerDirectoryClient implements CustomerDirectoryClient {
    private final HttpTransport transport;
    private final CustomerClientConfig config;
    private final JsonMapper json;
    private final Metrics metrics;

    @Override
    public CustomerLookupResult lookupCustomer(CustomerLookupCommand command) {
        URI uri = buildUri(command.customerId());
        OutboundRequest request = OutboundRequest.get(uri)
            .header("Accept", "application/json")
            .timeout(config.lookupTimeout())
            .operationName("customer.lookup")
            .build();

        OutboundResponse response = transport.execute(request);

        return switch (response.statusCode()) {
            case 200 -> parseSuccess(response.bodyLimited(config.maxBodySize()));
            case 404 -> CustomerLookupResult.notFound(command.customerId());
            case 429 -> throw RateLimitedExternalApiException.from(response);
            default -> throw CustomerDirectoryException.from(response);
        };
    }
}
```

Ini bukan tentang membuat abstraction berlebihan. Ini tentang menjaga invariant:

```text
Domain service tidak perlu tahu detail HTTP lifecycle.
HTTP adapter tidak boleh kehilangan semantics domain.
```

---

## 27. Production Failure Scenarios Berdasarkan Lifecycle

### Scenario A — Response Body Leak

Symptom:

```text
Latency naik perlahan.
Pool pending request meningkat.
Thread terlihat menunggu HTTP call.
Downstream sebenarnya sehat.
```

Possible root cause:

```text
Response body tidak ditutup pada path error.
Connection tidak kembali ke pool.
Request baru menunggu connection baru/slot pool.
```

Fix:

- gunakan try-with-resources;
- pastikan error body juga dikonsumsi/ditutup;
- buat wrapper yang memaksa lifecycle close;
- tambahkan pool metrics;
- test path 4xx/5xx.

### Scenario B — Timeout Spike Karena DNS

Symptom:

```text
Banyak request gagal sebelum status code.
Tidak ada log di downstream.
CoreDNS/error resolver meningkat.
```

Possible root cause:

```text
DNS resolution lambat/gagal.
Client membuat banyak connection baru karena pool tidak reuse.
```

Fix:

- cek DNS metric;
- cek client reuse;
- cek TTL/cache;
- cek Kubernetes CoreDNS;
- cek connection pool;
- pertimbangkan backoff pada connect/DNS failure.

### Scenario C — Duplicate Command Karena Retry POST

Symptom:

```text
User melihat double payment/double submission.
Client log menunjukkan timeout lalu retry.
Server memproses dua request.
```

Possible root cause:

```text
POST diretry setelah body terkirim tanpa idempotency key.
```

Fix:

- idempotency key;
- server-side dedup;
- no blind retry for unsafe operations;
- classify ambiguous failure;
- add operation status query.

### Scenario D — Memory Spike Saat Error Page Besar

Symptom:

```text
Heap naik.
GC meningkat.
Error parser gagal karena expected JSON tapi menerima HTML.
```

Possible root cause:

```text
Proxy/LB mengembalikan HTML error besar.
Client membaca seluruh body ke String.
```

Fix:

- max body size;
- content-type validation;
- error body truncation;
- streaming for large body;
- safe logging.

### Scenario E — TLS Failure Setelah Certificate Rotation

Symptom:

```text
Semua HTTPS call ke vendor gagal.
SSLHandshakeException.
```

Possible root cause:

```text
CA baru tidak ada di trust store.
Intermediate chain berubah.
Hostname/SAN mismatch.
```

Fix:

- inspect cert chain;
- update trust store properly;
- jangan disable verification;
- validate rotation process di staging;
- monitor certificate expiry.

---

## 28. Checklist Lifecycle untuk Code Review

Gunakan checklist ini saat review outbound HTTP client code.

### 28.1 Request Construction

- Apakah URL dibangun dengan URI builder, bukan string concatenation raw?
- Apakah path parameter dan query parameter di-encode dengan benar?
- Apakah method sesuai semantics?
- Apakah header sensitif tidak dilog?
- Apakah correlation/trace ID ada?
- Apakah idempotency key digunakan untuk command yang bisa retry?

### 28.2 Client Lifecycle

- Apakah client object reused/singleton?
- Apakah connection pool dikonfigurasi sesuai beban?
- Apakah tidak membuat client per request?
- Apakah ada cleanup untuk client yang lifecycle-nya memang pendek?

### 28.3 Timeout

- Apakah connect timeout eksplisit?
- Apakah response/read timeout eksplisit?
- Apakah total call deadline ada?
- Apakah retry tidak melampaui budget?
- Apakah timeout berbeda berdasarkan downstream/operation?

### 28.4 Response Handling

- Apakah response body selalu ditutup?
- Apakah error body juga ditangani?
- Apakah body size dibatasi?
- Apakah large response menggunakan streaming?
- Apakah body tidak dibaca dua kali?

### 28.5 Error Model

- Apakah transport error berbeda dari HTTP status error?
- Apakah 4xx/5xx dipetakan dengan benar?
- Apakah 429 membaca `Retry-After`?
- Apakah parse error dianggap contract failure?
- Apakah domain error tidak dicampur dengan technical failure?

### 28.6 Observability

- Apakah metric latency ada?
- Apakah status code tercatat?
- Apakah exception type tercatat?
- Apakah retry count tercatat?
- Apakah pool metrics tersedia?
- Apakah log aman dari token/PII?

### 28.7 Security

- Apakah TLS verification aktif?
- Apakah redirect divalidasi?
- Apakah URL user input dibatasi allowlist?
- Apakah header injection dicegah?
- Apakah secret tidak muncul di query/log?

---

## 29. Mental Model: Status Code Bukan Satu-Satunya Output

HTTP client call dapat menghasilkan salah satu dari beberapa kategori output:

```text
1. Tidak ada response sama sekali
   - DNS failure
   - connect failure
   - TLS failure
   - timeout sebelum header

2. Ada response header, body tidak selesai
   - connection reset during body
   - body timeout
   - malformed chunk

3. Ada full HTTP response
   - 2xx success
   - 3xx redirect
   - 4xx client/domain/auth/rate issue
   - 5xx server/proxy/downstream issue

4. Ada full response tetapi decode gagal
   - malformed JSON
   - unexpected content type
   - schema mismatch

5. Ada full response dan decode sukses tetapi domain gagal
   - rejected
   - not eligible
   - duplicate
   - insufficient balance
```

Jika semua ini dilempar sebagai `ExternalApiException`, sistem kehilangan kemampuan untuk:

- retry dengan benar;
- memberi pesan user yang benar;
- membuat alert yang benar;
- membedakan bug internal vs provider issue;
- melakukan incident diagnosis cepat.

---

## 30. Java 8–25 Perspective

### Java 8

Java 8 tidak punya JDK modern `java.net.http.HttpClient`. Umumnya pilihan production:

- OkHttp;
- Apache HttpClient;
- Retrofit di atas OkHttp;
- Spring RestTemplate dengan request factory tertentu;
- custom wrapper di atas library tersebut.

Concern utama:

- thread blocking;
- explicit pool management;
- timeout config per library;
- `CompletableFuture` tersedia tetapi HTTP client async tergantung library;
- TLS/security provider lebih tua dibanding Java modern.

### Java 11+

JDK modern HttpClient tersedia.

Keuntungan:

- standard library;
- HTTP/1.1 dan HTTP/2;
- sync/async API;
- WebSocket API;
- BodyPublisher/BodyHandler model;
- tidak perlu dependency tambahan untuk basic-modern use case.

Concern:

- extension/interceptor model tidak sefleksibel OkHttp;
- observability detail bisa butuh wrapper;
- enterprise proxy/routing kompleks kadang lebih nyaman dengan Apache/OkHttp.

### Java 17/21/25

Dengan Java modern:

- virtual threads membuat blocking client lebih menarik untuk banyak workload;
- structured concurrency membantu fan-out/fan-in dengan cancellation/deadline lebih rapi;
- JDK TLS/security makin modern;
- library ecosystem juga bergerak ke baseline Java lebih tinggi.

Namun virtual threads bukan alasan untuk mengabaikan:

- timeout;
- connection pool;
- response body close;
- retry semantics;
- rate limit;
- downstream capacity.

Virtual threads mengurangi biaya thread blocking, bukan menghilangkan biaya network, downstream, pool, memory, atau duplicate side effect.

---

## 31. Practical Heuristics untuk Engineer Senior+

### 31.1 Treat Outbound HTTP as a Dependency Boundary

Jangan anggap outbound HTTP sebagai method call biasa. Ia adalah dependency boundary dengan failure model sendiri.

### 31.2 Always Know Where the Request Is in Lifecycle

Saat incident, tanyakan:

```text
Apakah gagal sebelum DNS?
Saat DNS?
Saat connect?
Saat TLS?
Saat write?
Saat wait header?
Saat read body?
Saat parse?
Saat domain mapping?
```

### 31.3 Make Request Semantics Explicit

Untuk setiap operation, tahu:

- safe atau unsafe;
- idempotent atau tidak;
- retryable atau tidak;
- expected latency;
- expected response size;
- expected error model.

### 31.4 Close Bodies Like You Close Database Resources

Response body adalah resource. Treat it like:

```text
ResultSet
InputStream
FileChannel
Database connection
```

Jika tidak ditutup, sistem bisa rusak perlahan.

### 31.5 Do Not Let Library Defaults Become Architecture

Default library berguna untuk starting point, bukan production policy final.

### 31.6 Separate Transport DTO from Domain Result

Jangan biarkan `HttpResponse`, `ResponseBody`, generated DTO, atau raw JSON bocor ke core domain.

### 31.7 Design for Diagnosis

Setiap outbound client harus bisa menjawab:

```text
Apa yang dipanggil?
Berapa lama?
Gagal di mana?
Status code apa?
Exception apa?
Retry berapa kali?
Body ditutup?
Pool sehat?
```

---

## 32. Mini Exercise

Ambil satu HTTP client yang pernah kamu tulis. Coba jawab pertanyaan ini:

1. Apakah client dibuat singleton atau per request?
2. Apakah semua response body ditutup pada path success dan error?
3. Apa connect timeout-nya?
4. Apa read/response timeout-nya?
5. Apakah ada total deadline?
6. Apakah retry bisa menyebabkan duplicate side effect?
7. Apakah 401, 403, 404, 409, 429, 500 diperlakukan berbeda?
8. Apakah error body dibaca dengan size limit?
9. Apakah log mengandung token/body/PII?
10. Apakah metric bisa membedakan connect failure vs HTTP 500?
11. Apakah URL dibangun dengan aman?
12. Apakah downstream API punya rate limit?
13. Apakah client aman saat downstream lambat?
14. Apakah large response bisa menyebabkan OOM?
15. Apakah DNS/TLS/proxy failure punya playbook?

Jika banyak jawaban “tidak tahu”, itu bukan berarti client buruk secara langsung, tetapi berarti client belum production-transparent.

---

## 33. Ringkasan

HTTP request lifecycle bukan hanya:

```text
send request -> receive response
```

Lifecycle sebenarnya:

```text
intent
  -> URI/request construction
  -> policy resolution
  -> interception
  -> DNS
  -> route/proxy
  -> pool acquisition
  -> TCP
  -> TLS/ALPN
  -> write headers/body
  -> wait response
  -> read headers/body
  -> decode/map/classify
  -> release/discard connection
  -> telemetry
```

Top-tier HTTP client engineering berarti mampu melihat, mengontrol, dan mengobservasi setiap fase tersebut.

Kunci Part 2:

- request lifecycle memiliki banyak tahap dan setiap tahap punya failure mode;
- status code hanyalah salah satu kemungkinan output;
- response body handling menentukan connection reuse;
- timeout harus dipahami per fase dan sebagai budget;
- retry harus mempertimbangkan fase gagal dan idempotency;
- library berbeda punya API berbeda, tetapi lifecycle mental model sama;
- production client harus didesain untuk diagnosis, bukan hanya happy path.

---

## 34. Referensi Resmi dan Lanjutan

- Oracle Java SE 25 — `java.net.http.HttpClient` API  
  https://docs.oracle.com/en/java/javase/25/docs/api/java.net.http/java/net/http/HttpClient.html

- Oracle Java SE 25 — `HttpResponse.BodyHandlers` API  
  https://docs.oracle.com/en/java/javase/25/docs/api/java.net.http/java/net/http/HttpResponse.BodyHandlers.html

- Oracle Java SE 25 — `HttpRequest.Builder` API  
  https://docs.oracle.com/en/java/javase/25/docs/api/java.net.http/java/net/http/HttpRequest.Builder.html

- OpenJDK — Introduction to the Java HTTP Client  
  https://openjdk.org/groups/net/httpclient/intro.html

- OkHttp Official Overview  
  https://square.github.io/okhttp/

- OkHttp 5 API — `OkHttpClient`  
  https://square.github.io/okhttp/5.x/okhttp/okhttp3/-ok-http-client/

- OkHttp — Concurrency  
  https://square.github.io/okhttp/contribute/concurrency/

- Retrofit Official Introduction  
  https://square.github.io/retrofit/

- Retrofit API — `HttpException`  
  https://square.github.io/retrofit/2.x/retrofit/retrofit2/HttpException.html

- Apache HttpClient 5 API Documentation  
  https://hc.apache.org/httpcomponents-client-5.6.x/current/httpclient5/apidocs/

- Apache HttpClient 5 — Connection Pooling  
  https://hc.apache.org/httpcomponents-client-5.6.x/connection-pooling.html

---

## 35. Status Series

Selesai:

```text
Part 0 — Orientation: HTTP Client sebagai Production Subsystem, Bukan Utility
Part 1 — Java HTTP Client Landscape di Java 8–25
Part 2 — Request Lifecycle Deep Dive: Dari Method Call Sampai Response Body
```

Belum selesai. Part berikutnya:

```text
Part 3 — URI, URL, Encoding, Query Parameter, dan Canonical Request
File: 03-uri-url-encoding-query-and-canonical-request.md
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./01-java-http-client-landscape-java-8-to-25.md">⬅️ Part 1 — Java HTTP Client Landscape di Java 8–25</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./03-uri-url-encoding-query-and-canonical-request.md">Part 3 — URI, URL, Encoding, Query Parameter, dan Canonical Request ➡️</a>
</div>
