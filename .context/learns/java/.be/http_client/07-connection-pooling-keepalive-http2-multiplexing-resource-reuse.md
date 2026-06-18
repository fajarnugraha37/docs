# Part 7 — Connection Pooling, Keep-Alive, HTTP/2 Multiplexing, dan Resource Reuse

Series: `learn-java-http-client-okhttp-retrofit-client-engineering`  
File: `07-connection-pooling-keepalive-http2-multiplexing-resource-reuse.md`

> Target utama part ini: memahami HTTP client sebagai **resource manager**. Client bukan hanya membuat request, tetapi mengelola socket, TLS session, connection pool, concurrency, idle lifetime, HTTP/2 stream, dan pressure terhadap downstream/network. Banyak incident HTTP client terjadi bukan karena kode parsing JSON salah, tetapi karena koneksi tidak direuse, pool bocor, body tidak ditutup, timeout idle mismatch, atau concurrency tidak dibatasi.

---

## 1. Kenapa Connection Pooling Penting?

Ketika aplikasi memanggil API eksternal/internal, secara naif kita bisa membayangkan setiap request seperti ini:

```text
request
  -> buka socket baru
  -> TCP handshake
  -> TLS handshake
  -> kirim HTTP request
  -> terima HTTP response
  -> tutup socket
```

Model ini sederhana tetapi mahal.

Setiap koneksi baru membawa biaya:

1. DNS resolution.
2. TCP three-way handshake.
3. TLS handshake.
4. Allocation object internal client.
5. Kernel socket resource.
6. NAT/firewall/load balancer state.
7. Slow start TCP.
8. Potensi ephemeral port pressure.

Connection pooling mengubah model menjadi:

```text
request 1
  -> create connection
  -> use connection
  -> return idle connection to pool

request 2
  -> lease/reuse existing connection
  -> use connection
  -> return idle connection to pool
```

Dengan reuse, client mengurangi latency dan resource cost.

Namun pooling juga membuat masalah baru:

- connection bisa stale;
- idle timeout server/load balancer bisa berbeda dari client;
- pool bisa penuh;
- pool bisa kosong;
- response body leak bisa menahan connection;
- HTTP/2 stream bisa mencapai limit;
- retry bisa memperbanyak pressure;
- satu `HttpClient` per request bisa menghancurkan manfaat pooling.

Jadi mental model yang benar:

```text
HTTP client = request executor + connection lifecycle manager + concurrency governor
```

Bukan:

```text
HTTP client = helper untuk GET/POST
```

---

## 2. Baseline: Apa Itu Connection?

Dalam HTTP client, kata “connection” biasanya berarti **koneksi transport reusable** ke target tertentu.

Untuk HTTPS HTTP/1.1:

```text
client process
  -> socket TCP
  -> TLS session
  -> HTTP/1.1 request/response exchange
```

Untuk HTTPS HTTP/2:

```text
client process
  -> socket TCP
  -> TLS session
  -> HTTP/2 connection
       -> stream 1
       -> stream 3
       -> stream 5
       -> stream N
```

HTTP/1.1 dan HTTP/2 berbeda secara fundamental.

HTTP/1.1:

```text
1 connection ~= 1 active request at a time
```

HTTP/2:

```text
1 connection ~= many concurrent streams
```

Catatan: HTTP/1.1 punya pipelining secara spesifikasi, tetapi secara praktik JVM client modern biasanya tidak mengandalkan pipelining HTTP/1.1 untuk production karena head-of-line blocking dan kompatibilitas server/proxy.

---

## 3. Connection Pool sebagai State Machine

Sebuah connection di pool dapat dimodelkan seperti state machine.

```text
NEW
  -> CONNECTING
  -> TLS_HANDSHAKING
  -> ACTIVE
  -> IDLE
  -> LEASED
  -> IDLE
  -> EXPIRED
  -> CLOSED
```

Atau saat gagal:

```text
CONNECTING
  -> FAILED
  -> CLOSED
```

Atau saat stale:

```text
IDLE
  -> LEASED
  -> detected stale / reset by peer
  -> CLOSED
  -> retry if safe
```

State utama:

| State | Arti |
|---|---|
| `connecting` | Socket sedang dibuat. |
| `handshaking` | TLS sedang dinegosiasikan. |
| `leased` / `in use` | Connection sedang dipakai request. |
| `idle` | Connection selesai dipakai dan bisa direuse. |
| `expired` | Connection melewati TTL/idle limit. |
| `closed` | Connection tidak bisa dipakai lagi. |

Yang sering dilupakan: **connection yang selesai membaca header response belum tentu sudah kembali ke pool**. Pada banyak client, connection baru bisa direuse setelah response body dikonsumsi atau ditutup dengan benar.

---

## 4. Request Lifecycle dengan Pooling

Request dengan pooling kira-kira seperti ini:

```text
1. build request
2. resolve route/address
3. ask pool for reusable connection
4. if found:
     lease connection
   else:
     create new connection
5. write request
6. read response headers
7. consume/close response body
8. mark connection reusable or non-reusable
9. return to pool or close
10. emit telemetry
```

Titik penting:

```text
consume/close response body -> connection release
```

Jika body tidak ditutup:

```text
connection remains leased
  -> pool available connection drops
  -> new requests create new connections or wait
  -> latency rises
  -> thread blocking rises
  -> eventually timeout / connection exhaustion
```

---

## 5. Keep-Alive: Apa yang Sebenarnya “Alive”?

HTTP keep-alive berarti koneksi transport tidak langsung ditutup setelah satu request/response selesai, sehingga bisa dipakai untuk request berikutnya.

HTTP/1.0 dulu default-nya close kecuali `Connection: keep-alive`. HTTP/1.1 default-nya persistent connection kecuali `Connection: close`.

Mental model:

```text
request selesai
  -> response body selesai
  -> connection sehat
  -> keep socket open
  -> simpan di pool sebagai idle
```

Keep-alive bukan berarti server pasti menjaga connection selamanya. Banyak komponen bisa menutup idle connection:

- application server;
- reverse proxy;
- API gateway;
- load balancer;
- service mesh sidecar;
- firewall;
- NAT gateway;
- corporate proxy;
- Kubernetes ingress.

Maka client harus siap menghadapi:

```text
connection terlihat idle di pool
  -> ternyata sudah ditutup server/LB
  -> client reuse
  -> read/write gagal
  -> close connection
  -> retry hanya jika safe
```

---

## 6. Idle Timeout vs Keep-Alive Timeout vs TTL

Ada beberapa konsep yang sering tercampur.

### 6.1 Idle Timeout

Berapa lama connection boleh menganggur tanpa request sebelum ditutup.

```text
last used at 10:00:00
idle timeout 60s
if no reuse until 10:01:00 -> close
```

### 6.2 Keep-Alive Timeout

Sering dipakai untuk menyatakan berapa lama koneksi persistent dipertahankan. Dalam banyak konteks praktis, keep-alive timeout mirip idle timeout.

### 6.3 Connection TTL

Berapa lama connection boleh hidup sejak dibuat, terlepas idle atau aktif.

```text
created at 10:00:00
TTL 5 minutes
after 10:05:00 -> no longer reusable, close after use
```

TTL berguna untuk:

- DNS rotation;
- load balancing fairness;
- certificate/session renewal boundary;
- menghindari koneksi terlalu lama menempel ke backend lama;
- mengurangi stale route.

### 6.4 Max Idle Connections

Berapa banyak idle connection yang boleh disimpan.

```text
max idle = 5
connection selesai request
if idle count < 5 -> keep
else -> close
```

### 6.5 Max Total Connections

Batas total connection aktif + idle.

Tidak semua library punya hard cap yang sama. Apache HttpClient 5 memberi kontrol per-route dan total. OkHttp `ConnectionPool` lebih fokus pada idle reuse; concurrency lebih banyak diatur melalui `Dispatcher` dan host/request limit.

---

## 7. Per-Route vs Global Pool Limit

Apache-style pool sering memakai konsep **route**.

Route bisa berarti kombinasi:

```text
scheme + host + port + proxy + TLS strategy
```

Contoh:

```text
https://api.partner-a.com:443 -> route A
https://api.partner-b.com:443 -> route B
http://internal-service:8080   -> route C
```

Pool setting:

```text
max total connections = 200
max per route = 50
```

Artinya:

- seluruh koneksi maksimum 200;
- satu host/route maksimum 50;
- route A tidak boleh menghabiskan semua koneksi.

Tanpa per-route limit, satu downstream lambat bisa menghabiskan semua pool dan mengganggu downstream lain.

```text
partner-a slow
  -> 200 active connections stuck
  -> partner-b calls cannot acquire connection
  -> unrelated business flow fails
```

Top-tier rule:

```text
shared client boleh, tetapi isolation policy harus jelas
```

Kadang lebih baik memiliki client/pool terpisah per downstream kritikal.

---

## 8. Kenapa Client Harus Reusable / Singleton?

Kesalahan umum:

```java
public String callApi(String id) {
    OkHttpClient client = new OkHttpClient(); // wrong in high-throughput path
    // execute request
}
```

Atau:

```java
public HttpResponse<String> callApi(URI uri) {
    HttpClient client = HttpClient.newHttpClient(); // avoid per call
    // send request
}
```

Masalah:

- pool tidak direuse;
- DNS/TLS/connection cost berulang;
- thread/resource internal bisa bertambah;
- latency naik;
- sulit mengontrol config;
- observability tersebar;
- connection leak lebih sulit didiagnosis.

Pola benar:

```text
application startup
  -> create configured client
  -> inject into API adapter
  -> reuse for all calls to compatible route/policy
  -> close/shutdown if library requires explicit close
```

Contoh konseptual:

```java
public final class PartnerApiClient {
    private final OkHttpClient httpClient;
    private final HttpUrl baseUrl;

    public PartnerApiClient(OkHttpClient httpClient, HttpUrl baseUrl) {
        this.httpClient = httpClient;
        this.baseUrl = baseUrl;
    }
}
```

Untuk JDK `HttpClient`, client bersifat immutable setelah dibuat dan bisa digunakan untuk mengirim banyak request. Ini cocok untuk reuse.

---

## 9. HTTP/1.1 Pooling

HTTP/1.1 persistent connection mengizinkan reuse connection untuk request berikutnya.

Namun pada praktik umum:

```text
1 HTTP/1.1 connection -> 1 active request at a time
```

Jika ada 100 request paralel ke host yang sama dan setiap request lambat 1 detik, maka untuk concurrency tinggi client butuh beberapa koneksi.

```text
100 concurrent requests
max per route 10
  -> 10 active connections
  -> 90 waiting/queued
```

Trade-off:

- terlalu kecil: queueing dan latency tinggi;
- terlalu besar: pressure ke downstream, NAT, LB, server thread, DB downstream;
- tidak dibatasi: cascading failure.

### 9.1 HTTP/1.1 Head-of-Line Blocking

Dalam HTTP/1.1, satu koneksi tidak efektif untuk banyak request paralel karena response harus berjalan dalam urutan tertentu pada koneksi tersebut. Jika request pertama lambat, request lain di koneksi yang sama bisa terhambat.

Karena itu HTTP/1.1 scale concurrency dengan beberapa koneksi.

---

## 10. HTTP/2 Multiplexing

HTTP/2 berbeda: satu connection dapat membawa banyak stream paralel.

```text
TCP/TLS connection
  ├─ stream 1: GET /profile
  ├─ stream 3: GET /orders
  ├─ stream 5: POST /payment
  └─ stream 7: GET /notification
```

Keuntungan:

- mengurangi jumlah connection;
- mengurangi handshake;
- lebih efisien untuk banyak request kecil;
- header compression;
- better connection reuse.

Namun HTTP/2 bukan magic.

Masalah yang tetap ada:

- single TCP connection masih bisa terkena TCP-level head-of-line blocking;
- stream concurrency limit dari server;
- flow control;
- large response bisa mengganggu small response;
- satu koneksi bermasalah bisa berdampak ke banyak stream;
- load balancing per connection bisa membuat traffic sticky ke satu backend;
- domain sharding lama bisa membuat koneksi redundant.

Top-tier mental model:

```text
HTTP/2 mengurangi kebutuhan banyak koneksi, tetapi tidak menghapus kebutuhan concurrency governance.
```

---

## 11. HTTP/2 Stream Limit

Server dapat mengirim `SETTINGS_MAX_CONCURRENT_STREAMS`, yaitu batas stream paralel per connection.

Contoh:

```text
server max concurrent streams = 100
client wants 500 parallel requests
```

Kemungkinan:

- 100 stream aktif;
- sisanya queue;
- client membuka connection tambahan jika policy/library memungkinkan;
- request latency naik.

Jangan mengasumsikan:

```text
HTTP/2 = unlimited concurrency
```

Yang benar:

```text
HTTP/2 concurrency = min(client policy, server stream limit, flow control, connection health)
```

---

## 12. Pool Starvation

Pool starvation terjadi saat request tidak bisa mendapat connection/stream tepat waktu.

Penyebab umum:

1. Max connection terlalu kecil.
2. Downstream lambat sehingga connection lama tertahan.
3. Response body tidak ditutup.
4. Retry memperbanyak request aktif.
5. Connection leak.
6. HTTP/2 stream limit tercapai.
7. Pool shared oleh terlalu banyak downstream.
8. Thread pool async/sync tidak cukup.

Gejala:

- latency meningkat sebelum error rate naik;
- timeout pool acquisition;
- active connection tinggi;
- idle connection rendah;
- request queue tinggi;
- thread dump banyak menunggu HTTP client;
- downstream sebenarnya tidak menerima traffic sebanyak ekspektasi karena queue tertahan di client.

Diagnosis:

```text
Is latency before connection acquired rising?
Is active leased connection at max?
Are idle connections zero?
Are response bodies always closed?
Is retry count rising?
Is downstream p95/p99 rising?
```

---

## 13. Socket Leak vs Connection Leak vs Body Leak

Istilah ini sering dipakai campur aduk.

### 13.1 Socket Leak

Socket tidak ditutup walaupun tidak lagi berguna.

Dampak:

- file descriptor habis;
- ephemeral port habis;
- memory kernel naik.

### 13.2 Connection Leak

Connection tidak kembali ke pool karena masih dianggap in-use.

Dampak:

- pool starvation;
- new connection creation berlebih;
- latency naik.

### 13.3 Body Leak

Response body tidak dikonsumsi/ditutup sehingga connection tidak bisa dilepas.

Contoh buruk OkHttp:

```java
Response response = client.newCall(request).execute();
if (!response.isSuccessful()) {
    throw new RuntimeException("failed"); // response body not closed
}
return response.body().string();
```

Contoh benar:

```java
try (Response response = client.newCall(request).execute()) {
    if (!response.isSuccessful()) {
        String errorBody = response.body() != null ? response.body().string() : "";
        throw new PartnerApiException(response.code(), errorBody);
    }
    return response.body() != null ? response.body().string() : "";
}
```

Catatan: membaca `response.body().string()` juga menutup body di OkHttp, tetapi pola `try-with-resources` tetap lebih aman untuk semua cabang eksekusi.

---

## 14. Response Body dan Reusability

Agar connection bisa direuse, client harus tahu bahwa response selesai.

Untuk response dengan `Content-Length`, client tahu jumlah byte yang harus dibaca.

Untuk response chunked, client harus membaca sampai terminating chunk.

Jika client berhenti di tengah body:

```text
server masih mengirim body
client tidak membaca
connection tidak bisa dipakai request berikutnya
client mungkin close connection
```

Maka untuk large response yang tidak dibutuhkan, lebih baik close body dengan sadar.

```text
Need body? consume safely.
Do not need body? close explicitly.
```

---

## 15. Connection Reuse dan Error Handling

Tidak semua failure membuat connection reusable.

Contoh connection harus dibuang:

- TLS failure;
- malformed response;
- connection reset;
- protocol violation;
- body read interrupted;
- response body tidak selesai;
- server mengirim `Connection: close`;
- stream error tertentu pada HTTP/2.

Contoh connection mungkin tetap reusable:

- HTTP 404 dengan body selesai dibaca;
- HTTP 500 dengan body selesai dibaca;
- HTTP 429 dengan body selesai dibaca;
- domain error JSON dengan body selesai dibaca.

Rule:

```text
HTTP status error != transport connection broken
```

Jika API mengembalikan 500 tetapi response body lengkap, connection bisa tetap sehat.

---

## 16. Idle Connection Stale: Masalah Klasik Production

Scenario:

```text
10:00:00 client receives response and puts connection idle
10:00:30 load balancer closes idle connection silently
10:01:00 client reuses connection
10:01:00 write/read fails: connection reset / broken pipe
```

Penyebab:

- client idle timeout lebih panjang dari LB idle timeout;
- firewall menutup connection;
- NAT state expired;
- server restart;
- pod/backend termination;
- service mesh drain.

Mitigasi:

1. Set client idle timeout lebih pendek dari LB/server idle timeout.
2. Enable stale connection check jika tersedia dan cost acceptable.
3. Retry safe request once on stale connection failure.
4. Gunakan graceful shutdown/draining downstream.
5. Monitor connection reset after idle.

Rule praktis:

```text
client idle timeout < downstream/LB idle timeout
```

Contoh:

```text
LB idle timeout = 60s
client idle timeout = 50s atau 55s
```

Jangan set client idle timeout 5 menit jika LB menutup 60 detik.

---

## 17. DNS Rotation vs Long-Lived Connections

Connection pool menyimpan koneksi ke IP tertentu.

Jika DNS berubah:

```text
api.service.local -> 10.0.1.10
later
api.service.local -> 10.0.2.20
```

Connection lama masih menuju `10.0.1.10` selama tetap hidup.

Dampaknya:

- traffic tidak berpindah cepat;
- blue/green rollout lambat;
- pod/backend lama masih menerima traffic;
- client menempel ke IP yang sudah tidak ideal;
- load distribution buruk.

Mitigasi:

- connection TTL;
- idle timeout wajar;
- DNS TTL JVM sesuai;
- pool eviction;
- client restart saat migration tertentu;
- service mesh/load balancer yang menangani backend rotation.

Top-tier insight:

```text
DNS TTL hanya mempengaruhi connection baru, bukan connection yang sudah established.
```

---

## 18. Load Balancing dan Persistent Connections

Persistent connection bisa membuat load balancing kurang merata.

Jika load balancer bekerja di level connection:

```text
connection 1 -> backend A
connection 2 -> backend B
connection 3 -> backend C
```

Jika client hanya punya satu HTTP/2 connection:

```text
all streams -> connection 1 -> backend A
```

Hasil:

- backend A menerima banyak traffic;
- backend B/C idle;
- autoscaling signal bisa bias;
- rolling deploy butuh draining lebih hati-hati.

Bukan berarti HTTP/2 buruk. Tetapi untuk internal high-throughput microservice, perlu paham interaction antara:

- HTTP/2 multiplexing;
- L4/L7 load balancer;
- service mesh;
- endpoint discovery;
- connection lifetime;
- max connection/stream policy.

---

## 19. NAT dan Ephemeral Port Exhaustion

Jika aplikasi membuka terlalu banyak koneksi outbound, ia bisa mengalami ephemeral port exhaustion atau NAT gateway pressure.

Setiap TCP connection memakai tuple:

```text
source IP + source port + destination IP + destination port + protocol
```

Jika terlalu banyak koneksi ke destination yang sama, source port bisa habis sementara connection berada di `ESTABLISHED`, `TIME_WAIT`, atau state lain.

Penyebab umum:

- membuat client baru per request;
- keep-alive disabled;
- pool terlalu besar;
- retry storm;
- downstream lambat;
- connection leak;
- server menutup connection terlalu cepat sehingga churn tinggi.

Gejala:

- connect timeout naik;
- `Cannot assign requested address`;
- NAT gateway port allocation error;
- banyak socket `TIME_WAIT`;
- CPU network stack naik.

Mitigasi:

- reuse connection;
- limit concurrency;
- set pool wajar;
- reduce retry storm;
- tune OS/network jika benar-benar perlu;
- gunakan HTTP/2 untuk mengurangi connection count jika cocok.

---

## 20. Client Library Mapping

### 20.1 JDK HttpClient

JDK `HttpClient`:

- dibuat via builder;
- immutable setelah dibuat;
- reusable untuk banyak request;
- mendukung HTTP/1.1 dan HTTP/2;
- punya keep-alive cache internal;
- connect timeout di builder;
- request timeout di `HttpRequest.Builder#timeout`;
- beberapa setting internal via system properties.

Contoh reusable client:

```java
import java.net.http.HttpClient;
import java.time.Duration;

public final class HttpClients {
    public static final HttpClient PARTNER_CLIENT = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(2))
            .version(HttpClient.Version.HTTP_2)
            .build();
}
```

Contoh request timeout:

```java
var request = java.net.http.HttpRequest.newBuilder(uri)
        .timeout(Duration.ofSeconds(5))
        .GET()
        .build();
```

System property terkait keep-alive JDK `HttpClient` perlu dipahami sebagai JVM-level tuning, bukan config per client biasa:

```text
-Djdk.httpclient.keepalive.timeout=30
-Djdk.httpclient.keepalive.timeout.h2=30
```

Gunakan dengan hati-hati karena berdampak luas pada process JVM.

### 20.2 OkHttp

OkHttp punya model:

```text
OkHttpClient
  -> Dispatcher
  -> ConnectionPool
  -> Interceptors
  -> EventListener
```

ConnectionPool mengelola reuse HTTP dan HTTP/2 connection.

Contoh:

```java
import okhttp3.ConnectionPool;
import okhttp3.OkHttpClient;

import java.time.Duration;
import java.util.concurrent.TimeUnit;

public final class PartnerOkHttpFactory {
    public static OkHttpClient create() {
        return new OkHttpClient.Builder()
                .connectionPool(new ConnectionPool(
                        20,              // max idle connections
                        55, TimeUnit.SECONDS // keep alive duration
                ))
                .connectTimeout(Duration.ofSeconds(2))
                .readTimeout(Duration.ofSeconds(5))
                .writeTimeout(Duration.ofSeconds(5))
                .callTimeout(Duration.ofSeconds(8))
                .build();
    }
}
```

Catatan penting:

- `ConnectionPool` max idle bukan selalu hard cap total active connection.
- Concurrency OkHttp dipengaruhi `Dispatcher`.

Contoh dispatcher:

```java
import okhttp3.Dispatcher;
import okhttp3.OkHttpClient;

public static OkHttpClient createLimitedClient() {
    Dispatcher dispatcher = new Dispatcher();
    dispatcher.setMaxRequests(100);
    dispatcher.setMaxRequestsPerHost(20);

    return new OkHttpClient.Builder()
            .dispatcher(dispatcher)
            .build();
}
```

Jika butuh membatasi pressure per downstream, pahami kombinasi:

```text
Dispatcher maxRequests
Dispatcher maxRequestsPerHost
ConnectionPool maxIdleConnections
Call timeout
Read/write timeout
Application bulkhead
```

### 20.3 Retrofit

Retrofit memakai HTTP client di bawahnya, umumnya OkHttp.

```java
OkHttpClient okHttpClient = new OkHttpClient.Builder()
        .connectionPool(new ConnectionPool(20, 55, TimeUnit.SECONDS))
        .build();

Retrofit retrofit = new Retrofit.Builder()
        .baseUrl("https://api.partner.com/")
        .client(okHttpClient)
        .addConverterFactory(JacksonConverterFactory.create(objectMapper))
        .build();
```

Mental model:

```text
Retrofit interface = API binding
OkHttpClient = transport/pool/concurrency/retry/TLS layer
```

Jangan membuat `Retrofit` + `OkHttpClient` baru setiap request.

### 20.4 Apache HttpClient 5

Apache HttpClient 5 memberi kontrol eksplisit pada pooling connection manager.

Konsep:

```text
PoolingHttpClientConnectionManager
  -> max total
  -> default max per route
  -> connection TTL
  -> idle/expired close
```

Contoh konseptual:

```java
import org.apache.hc.client5.http.impl.classic.CloseableHttpClient;
import org.apache.hc.client5.http.impl.classic.HttpClients;
import org.apache.hc.client5.http.impl.io.PoolingHttpClientConnectionManager;

public final class ApacheClientFactory {
    public static CloseableHttpClient create() {
        PoolingHttpClientConnectionManager cm = new PoolingHttpClientConnectionManager();
        cm.setMaxTotal(200);
        cm.setDefaultMaxPerRoute(50);

        return HttpClients.custom()
                .setConnectionManager(cm)
                .evictExpiredConnections()
                .evictIdleConnections(org.apache.hc.core5.util.TimeValue.ofSeconds(55))
                .build();
    }
}
```

Apache sering cocok jika butuh:

- per-route connection management;
- explicit pool acquisition timeout;
- proxy/route control kompleks;
- enterprise legacy migration;
- advanced classic/async tuning.

---

## 21. Pool Design per Downstream

Pertanyaan arsitektural: apakah semua external call memakai satu HTTP client global?

Jawaban: tergantung isolation requirement.

### 21.1 Satu Client Global

Kelebihan:

- sederhana;
- resource reuse maksimal;
- konfigurasi terpusat.

Kekurangan:

- satu downstream lambat bisa mempengaruhi yang lain;
- sulit memberi timeout/retry/pool policy berbeda;
- observability kurang jelas jika tidak dibungkus benar.

### 21.2 Client per Downstream

Kelebihan:

- isolation lebih baik;
- policy spesifik;
- metric lebih jelas;
- credential/TLS/config lebih aman.

Kekurangan:

- lebih banyak resource;
- config lebih banyak;
- perlu governance.

Production recommendation:

```text
For serious backend systems, prefer one typed client per downstream API,
with explicit shared low-level factory only if policy compatible.
```

Contoh:

```text
PaymentGatewayClient
  -> OkHttpClient paymentHttpClient
  -> timeout: strict
  -> retry: limited idempotent only
  -> pool: small isolated

NotificationClient
  -> OkHttpClient notificationHttpClient
  -> timeout: relaxed
  -> retry: more tolerant
  -> pool: separate
```

---

## 22. Connection Pool Sizing: Cara Berpikir

Tidak ada angka universal. Gunakan reasoning.

Input:

- expected RPS;
- average downstream latency;
- p95/p99 latency;
- HTTP version;
- request body/response body size;
- downstream concurrency limit;
- timeout budget;
- retry policy;
- instance count;
- load balancer/NAT limit.

Little’s Law sederhana:

```text
concurrency ≈ throughput × latency
```

Jika satu instance mengirim 100 RPS ke downstream, latency rata-rata 200 ms:

```text
concurrency ≈ 100 × 0.2 = 20 in-flight requests
```

Jika p95 1 detik:

```text
burst concurrency ≈ 100 × 1 = 100 in-flight requests
```

Maka untuk HTTP/1.1, max per host 20 mungkin cukup untuk rata-rata tetapi bisa queue saat p95 spike.

Untuk HTTP/2, connection count bisa lebih kecil, tetapi stream concurrency perlu cukup.

Sizing bukan hanya “berapa banyak bisa”, tetapi “berapa banyak boleh”.

```text
caller desired concurrency
  must be <= downstream sustainable concurrency / number of caller instances
```

Jika 20 caller instance masing-masing max 100 request ke downstream:

```text
total possible downstream concurrency = 20 × 100 = 2000
```

Apakah downstream kuat? Jika tidak, client sedang membangun DDoS internal.

---

## 23. Queueing: Bahaya yang Tidak Terlihat

Connection/concurrency limit biasanya membuat request menunggu.

```text
incoming request
  -> wants outbound call
  -> no connection/slot available
  -> queued
  -> waits
  -> timeout maybe later
```

Queue bisa berguna untuk smoothing, tetapi berbahaya jika tidak dibatasi.

Masalah unbounded queue:

- memory naik;
- request lama tetap diproses walaupun caller sudah timeout;
- latency tail makin parah;
- retry dari upstream menambah antrian;
- sistem terlihat “masih jalan” tetapi sebenarnya mati perlahan.

Top-tier rule:

```text
Every queue must have a bound, timeout, and drop policy.
```

Untuk HTTP client:

- batasi max concurrent call;
- batasi queue wait;
- gunakan deadline propagation;
- cancel request jika caller sudah tidak menunggu;
- jangan biarkan retry masuk queue tanpa budget.

---

## 24. Retry dan Pool Pressure

Retry mengalikan traffic.

Jika 100 request gagal lambat dan masing-masing retry 3 kali:

```text
100 original + 300 retry = 400 attempts
```

Jika failure karena downstream overload, retry bisa memperburuk.

Hubungan retry dan pool:

```text
slow downstream
  -> connection held longer
  -> pool saturated
  -> request timeout
  -> retry creates more attempts
  -> pool more saturated
  -> cascading failure
```

Mitigasi:

- retry hanya idempotent;
- retry dengan jitter;
- retry budget;
- circuit breaker;
- bulkhead;
- per-attempt timeout;
- total deadline;
- respect `Retry-After`;
- reduce concurrency under failure.

---

## 25. Shutdown dan Resource Cleanup

HTTP client sering hidup selama aplikasi hidup, tetapi tetap perlu paham shutdown.

Saat aplikasi shutdown:

```text
stop accepting new work
  -> cancel/finish in-flight request
  -> close idle connections
  -> close executors if custom
  -> flush telemetry
```

Pada Spring/DI container:

- declare client as bean;
- close jika library butuh close;
- jangan membuat unmanaged executor tanpa shutdown;
- pastikan async callbacks tidak menahan process shutdown.

Untuk Apache `CloseableHttpClient`, ada close lifecycle eksplisit.

Untuk OkHttp, jika ingin shutdown eksplisit:

```java
client.dispatcher().executorService().shutdown();
client.connectionPool().evictAll();
if (client.cache() != null) {
    client.cache().close();
}
```

Namun jangan lakukan ini untuk client yang masih aktif dipakai.

---

## 26. Observability untuk Connection Pool

Metric penting:

| Metric | Kenapa penting |
|---|---|
| active/leased connections | Melihat pressure. |
| idle connections | Melihat reuse capacity. |
| pending acquire/queue | Indikasi pool starvation. |
| connection created count | Churn tinggi. |
| connection reused count | Efektivitas pooling. |
| connection closed count + reason | Idle, error, eviction. |
| pool acquire latency | Latency sebelum network call. |
| TLS handshake latency | New connection cost. |
| DNS latency | Route resolution issue. |
| request in-flight | Concurrency. |
| HTTP/2 active streams | Multiplexing pressure. |
| reset/broken pipe | Stale connection/LB mismatch. |
| timeout by phase | Diagnosis tepat. |

OkHttp punya `EventListener` yang sangat berguna untuk mengukur lifecycle:

```text
callStart
proxySelectStart
 dnsStart / dnsEnd
connectStart / connectEnd
secureConnectStart / secureConnectEnd
connectionAcquired
requestHeadersStart / requestHeadersEnd
requestBodyStart / requestBodyEnd
responseHeadersStart / responseHeadersEnd
responseBodyStart / responseBodyEnd
connectionReleased
callEnd / callFailed
```

Dengan event ini, kita bisa membedakan:

```text
slow because DNS?
slow because connect?
slow because TLS?
slow because waiting response header?
slow because reading body?
slow because pool wait?
```

Tanpa lifecycle metric, semua terlihat sebagai “API lambat”.

---

## 27. Logging: Jangan Log Socket Detail Saja

Logging yang berguna bukan:

```text
Calling partner API...
Partner API failed.
```

Logging yang berguna:

```text
client=payment-gateway
method=POST
route=https://payment.example.com
operation=createPayment
attempt=1
idempotencyKeyPresent=true
status=503
failurePhase=response_headers
connectionReused=true
elapsedMs=832
timeoutMs=1000
traceId=...
```

Namun jangan log:

- Authorization;
- cookie;
- private key;
- API key;
- full query jika mengandung token/PII;
- full body payment/customer;
- client certificate material.

---

## 28. Testing Connection Pooling

Testing pooling perlu fault scenario, bukan hanya happy path.

Gunakan MockWebServer/WireMock/MockServer untuk:

1. Response body tidak dibaca.
2. Server close connection setelah response.
3. Slow body.
4. Slow headers.
5. HTTP/2 concurrent request.
6. 429 + Retry-After.
7. 500 + retry.
8. Connection reset.
9. Large response.
10. Many parallel requests.

Test yang penting:

```text
Given 100 parallel calls
When downstream latency is 200ms
Then max concurrency is bounded
And no connection leak after all calls complete
And idle/active connection returns to expected level
```

Untuk OkHttp MockWebServer, kita bisa assert request count dan response behavior. Untuk Apache, kita bisa inspect pool stats. Untuk JDK, observability internal lebih terbatas, sehingga wrapper-level metric lebih penting.

---

## 29. Failure Scenario Walkthrough

### Scenario A — Response Body Leak

```text
symptom:
  latency rises slowly
  connection count rises
  pool saturated
  downstream not overloaded

root cause:
  error branch throws before closing response body

fix:
  try-with-resources
  always consume/close error body
  add test for non-2xx path
```

### Scenario B — LB Idle Timeout Mismatch

```text
symptom:
  first request after idle fails with reset/broken pipe
  retry succeeds

root cause:
  LB closes idle after 60s
  client keeps idle for 5m

fix:
  set client idle keep-alive < 60s
  retry safe idempotent request once
```

### Scenario C — Creating Client Per Request

```text
symptom:
  high TLS handshake rate
  high TIME_WAIT
  connect latency high
  CPU/network overhead high

root cause:
  new OkHttpClient/JDK HttpClient per call

fix:
  singleton/reused client per downstream policy
```

### Scenario D — HTTP/2 Single Connection Hotspot

```text
symptom:
  one backend receives most traffic
  uneven load distribution
  p99 rises under high fan-out

root cause:
  long-lived HTTP/2 connection pinned by LB to backend

fix options:
  tune connection lifetime
  service mesh/LB strategy
  multiple connections if client supports
  reduce stream concurrency per connection
  review topology
```

### Scenario E — Retry Storm Consumes Pool

```text
symptom:
  downstream degraded
  caller outbound attempt count triples
  pool saturation
  timeout increases

root cause:
  retry 3x with no budget and high concurrency

fix:
  retry budget
  circuit breaker
  jitter
  total deadline
  adaptive concurrency or bulkhead
```

---

## 30. Production Design Pattern: Typed Client with Transport Policy

A production API client should separate:

```text
Domain port
  -> typed external API client
      -> request/response mapping
      -> error classification
      -> resilience policy
      -> low-level HTTP transport
```

Example package:

```text
com.company.payment
  PaymentGatewayPort.java
  PaymentGatewayClient.java
  PaymentGatewayHttpConfig.java
  PaymentGatewayErrorMapper.java
  PaymentGatewayTelemetry.java
  dto/
    CreatePaymentRequestDto.java
    CreatePaymentResponseDto.java
```

Transport config should be explicit:

```java
public record HttpTransportPolicy(
        int maxConcurrentRequests,
        int maxConcurrentRequestsPerHost,
        int maxIdleConnections,
        Duration keepAliveDuration,
        Duration connectTimeout,
        Duration readTimeout,
        Duration writeTimeout,
        Duration callTimeout
) {}
```

Then create client from policy:

```java
public final class OkHttpTransportFactory {
    public static OkHttpClient create(HttpTransportPolicy policy) {
        Dispatcher dispatcher = new Dispatcher();
        dispatcher.setMaxRequests(policy.maxConcurrentRequests());
        dispatcher.setMaxRequestsPerHost(policy.maxConcurrentRequestsPerHost());

        return new OkHttpClient.Builder()
                .dispatcher(dispatcher)
                .connectionPool(new ConnectionPool(
                        policy.maxIdleConnections(),
                        policy.keepAliveDuration().toMillis(),
                        TimeUnit.MILLISECONDS
                ))
                .connectTimeout(policy.connectTimeout())
                .readTimeout(policy.readTimeout())
                .writeTimeout(policy.writeTimeout())
                .callTimeout(policy.callTimeout())
                .build();
    }
}
```

The point is not the exact class. The point is:

```text
transport policy is explicit, reviewable, testable, and per downstream.
```

---

## 31. Anti-Patterns

### 31.1 Client Per Request

```text
new client per API call
```

Dampak:

- no pooling;
- high connection churn;
- TLS overhead;
- TIME_WAIT/port pressure.

### 31.2 No Timeout + Large Pool

```text
max connections high
read timeout infinite
```

Dampak:

- thread stuck;
- downstream overload;
- incident blast radius besar.

### 31.3 Shared Pool for Everything

```text
one global pool for payment, notification, report, auth, search
```

Dampak:

- noisy neighbor;
- failure propagation.

### 31.4 Not Closing Body on Error

```text
if status != 200 throw
```

Dampak:

- connection leak;
- pool starvation.

### 31.5 Ignoring LB Idle Timeout

```text
client keep-alive 5m
LB idle timeout 60s
```

Dampak:

- intermittent reset after idle.

### 31.6 Unlimited Async Calls

```text
CompletableFuture.allOf(list.stream().map(callAsync)) with unbounded list
```

Dampak:

- queue explosion;
- pool starvation;
- downstream overload.

### 31.7 Retry Without Concurrency Limit

```text
retry 3 times for every failure, no budget
```

Dampak:

- retry storm;
- cascading failure.

---

## 32. Design Review Checklist

Gunakan pertanyaan ini untuk mereview HTTP client production-grade.

### 32.1 Lifecycle

- Apakah client dibuat sekali dan direuse?
- Apakah ada shutdown lifecycle jika diperlukan?
- Apakah response body selalu dikonsumsi/ditutup?
- Apakah error branch juga menutup body?

### 32.2 Pooling

- Apakah pool config eksplisit?
- Apakah max idle masuk akal?
- Apakah max concurrency dibatasi?
- Apakah ada per-host/per-route isolation?
- Apakah client per downstream atau global? Kenapa?

### 32.3 Timeout

- Apakah connect/read/write/call timeout jelas?
- Apakah ada pool acquisition timeout jika library mendukung?
- Apakah idle timeout lebih pendek dari LB idle timeout?
- Apakah total deadline mencakup retry?

### 32.4 HTTP/2

- Apakah HTTP/2 dipakai?
- Apakah stream concurrency dipahami?
- Apakah load balancing behavior diterima?
- Apakah large response dan small response dicampur dalam satu connection?

### 32.5 Failure

- Apakah stale connection failure ditangani?
- Apakah retry hanya untuk operation aman?
- Apakah circuit breaker/bulkhead diperlukan?
- Apakah failure phase dapat diketahui dari metric/log?

### 32.6 Observability

- Ada metric active/idle/pending?
- Ada latency by phase?
- Ada retry count?
- Ada connection reuse/churn signal?
- Ada redaction?

### 32.7 Security

- Apakah connection reuse tidak mencampur credential tenant secara salah?
- Apakah proxy/TLS config per downstream benar?
- Apakah sensitive header tidak terlog?

---

## 33. Mental Model Ringkas

Simpan model ini:

```text
HTTP client call is not one operation.
It is a sequence of resource acquisitions and releases.

DNS -> connection/stream acquire -> TCP/TLS -> request write
-> response header -> response body -> release/reuse/close
```

Dan invariant ini:

```text
Every acquired resource must have a release path.
Every queue must have a bound.
Every retry must have a budget.
Every pool must have an owner and policy.
Every timeout must map to a failure phase.
Every connection reuse must be compatible with security and routing semantics.
```

---

## 34. Apa yang Membedakan Engineer Biasa dan Top-Tier di Area Ini?

Engineer biasa bertanya:

```text
Bagaimana cara call API ini?
```

Engineer kuat bertanya:

```text
Berapa timeout-nya?
Apa retry policy-nya?
Apa operation ini idempotent?
Apakah body ditutup di semua branch?
Berapa max concurrency per downstream?
Apakah client direuse?
Apakah idle timeout cocok dengan LB?
Apakah HTTP/2 membuat load balancing hotspot?
Apakah pool metric terlihat?
Apa yang terjadi saat downstream lambat 30 detik?
Apa yang terjadi saat token refresh bersamaan 100 request?
Apa yang terjadi saat DNS berubah?
Apa yang terjadi saat response 500 body 20MB?
```

Top 1% bukan berarti hafal semua API library. Top 1% berarti bisa melihat HTTP client sebagai sistem hidup yang punya:

- resource lifecycle;
- concurrency pressure;
- network topology;
- failure semantics;
- security boundary;
- telemetry;
- operational behavior.

---

## 35. Latihan

### Latihan 1 — Diagnose Body Leak

Diberikan kode:

```java
Response response = client.newCall(request).execute();
if (response.code() >= 400) {
    throw new RuntimeException("partner failed");
}
return response.body().string();
```

Jawab:

1. Apa bug production-nya?
2. Bagaimana dampaknya terhadap connection pool?
3. Bagaimana rewrite yang benar?
4. Metric apa yang akan menunjukkan bug ini?

### Latihan 2 — Size Pool

Satu service instance memanggil API partner 80 RPS. Latency rata-rata 150 ms, p95 800 ms. Ada 10 instance service. Partner memberi limit 500 concurrent request total.

Jawab:

1. Berapa estimasi concurrency rata-rata per instance?
2. Berapa estimasi concurrency p95 per instance?
3. Apakah max per host 100 per instance aman?
4. Policy apa yang lebih masuk akal?

### Latihan 3 — LB Idle Mismatch

Client keep-alive 5 menit. Load balancer idle timeout 60 detik. Setelah traffic idle 2 menit, request pertama sering gagal `connection reset`, retry sukses.

Jawab:

1. Apa root cause paling mungkin?
2. Apa fix client-side?
3. Apakah retry boleh menjadi satu-satunya solusi?
4. Metric/log apa yang perlu ditambah?

### Latihan 4 — HTTP/2 Load Distribution

Satu service membuat HTTP/2 connection long-lived ke internal API melalui L4 load balancer. Traffic besar tetapi satu backend terlihat jauh lebih sibuk.

Jawab:

1. Mengapa bisa terjadi?
2. Apa trade-off HTTP/2 multiplexing di sini?
3. Apa opsi mitigasi?
4. Apa yang harus dicek sebelum mengubah protocol?

---

## 36. Ringkasan

Connection pooling adalah salah satu fondasi HTTP client engineering.

Materi utama part ini:

1. Connection reuse mengurangi latency dan resource cost.
2. Pooling memperkenalkan lifecycle dan failure mode baru.
3. Response body harus dikonsumsi/ditutup agar connection bisa kembali ke pool.
4. HTTP/1.1 dan HTTP/2 memiliki model concurrency berbeda.
5. HTTP/2 multiplexing mengurangi connection count, tetapi tidak menghapus kebutuhan concurrency governance.
6. Idle timeout client harus selaras dengan server/LB/proxy.
7. DNS rotation tidak otomatis memindahkan established connection.
8. Persistent connection dapat mempengaruhi load balancing.
9. Retry dapat memperparah pool pressure.
10. Production-grade client butuh metric active/idle/pending/reuse/churn/failure phase.
11. Pool policy sebaiknya eksplisit, per downstream, dan direview seperti resource budget.

---

## 37. Sumber Utama

- Oracle Java SE 25 Documentation — `java.net.http.HttpClient` dan module `java.net.http`.
- Oracle Java SE 25 Documentation — `jdk.httpclient.keepalive.timeout` dan `jdk.httpclient.keepalive.timeout.h2` system properties.
- OkHttp Documentation — `ConnectionPool`, concurrency, connection reuse, HTTP/2 behavior.
- Retrofit Documentation — Retrofit sebagai type-safe HTTP client di atas underlying HTTP client.
- Apache HttpClient 5 Documentation — connection management, `PoolingHttpClientConnectionManager`, per-route dan total connection limits.



<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 6 — Timeout Engineering: Connect, Read, Write, Call, Pool, DNS, TLS](./06-timeout-engineering-connect-read-write-call-pool-dns-tls.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 8 — DNS, Proxy, Load Balancer, NAT, dan Network Topology Awareness](./08-dns-proxy-loadbalancer-nat-network-topology-awareness.md)
