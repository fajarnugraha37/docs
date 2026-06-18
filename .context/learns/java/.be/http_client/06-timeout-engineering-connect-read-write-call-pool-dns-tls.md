# Part 6 — Timeout Engineering: Connect, Read, Write, Call, Pool, DNS, TLS

File:

```text
06-timeout-engineering-connect-read-write-call-pool-dns-tls.md
```

Series:

```text
learn-java-http-client-okhttp-retrofit-client-engineering
```

Target pembaca:

```text
Senior / Staff / Principal-minded Java engineer yang ingin memperlakukan HTTP client
sebagai production subsystem, bukan sekadar helper untuk "call API".
```

Versi Java yang relevan:

```text
Java 8 sampai Java 25
```

Library yang dibahas:

```text
JDK HttpURLConnection
JDK java.net.http.HttpClient
OkHttp
Retrofit
Apache HttpClient 4/5
Spring RestTemplate / RestClient / WebClient
Resilience4j / Failsafe-style decorator
```

---

## 1. Tujuan Part Ini

Di part sebelumnya kita sudah membahas request lifecycle:

```text
intent
→ URI
→ header
→ body
→ DNS
→ connection
→ TLS
→ request write
→ response wait
→ response read
→ decode
→ release
```

Part ini fokus pada satu kontrol yang menentukan apakah HTTP client akan:

```text
menunggu dengan sehat
atau
menggantung, menumpuk, lalu menjatuhkan sistem sendiri
```

Kontrol itu adalah:

```text
timeout engineering
```

Timeout bukan sekadar angka konfigurasi.

Timeout adalah:

```text
batas waktu eksplisit untuk setiap fase interaksi remote
agar resource caller tidak terkunci selamanya oleh downstream yang lambat,
network yang rusak, pool yang penuh, DNS yang gagal, TLS yang macet,
atau response body yang tidak selesai dikirim.
```

Mental model utama:

```text
HTTP client call adalah penggunaan resource lokal untuk menunggu sistem remote.

Timeout menentukan seberapa lama resource lokal boleh dipinjamkan
kepada ketidakpastian sistem remote.
```

Resource lokal itu bisa berupa:

```text
thread
virtual thread
event-loop slot
connection pool slot
socket
heap buffer
off-heap/native buffer
semaphore permit
rate-limit token
request queue slot
transaction context
user request budget
```

Kalau timeout salah, masalahnya jarang langsung terlihat di code.

Ia muncul sebagai:

```text
thread pool penuh
request queue naik
CPU idle tapi latency tinggi
connection pool exhausted
NAT port exhaustion
GC pressure
retry storm
circuit breaker open
pod restart
ALB / gateway 504
caller timeout sebelum callee selesai
duplicate write
database transaction menggantung
```

---

## 2. Prinsip Utama: Timeout Bukan Satu Hal

Banyak engineer bicara seperti ini:

```text
"Timeout-nya 30 detik."
```

Pertanyaan yang lebih tepat:

```text
Timeout yang mana?
```

Satu HTTP call bisa punya banyak batas waktu:

```text
overall call timeout / deadline
connection pool acquisition timeout
DNS resolution timeout
TCP connect timeout
TLS handshake timeout
request write timeout
response header timeout
response body read timeout
idle timeout
keep-alive timeout
per-attempt timeout
retry total timeout
circuit breaker slow-call threshold
application SLA timeout
gateway timeout
client browser timeout
```

Kalau semua ini dicampur menjadi satu angka, sistem menjadi sulit dipahami.

Contoh bug umum:

```java
client.setConnectTimeout(3_000);
```

Engineer mengira:

```text
"API ini maksimal 3 detik."
```

Padahal connect timeout hanya membatasi fase membuat koneksi baru.

Jika koneksi sudah reused dari pool, connect timeout tidak terpakai.

Response bisa tetap menunggu 2 menit, 5 menit, atau selamanya tergantung library dan konfigurasi lain.

---

## 3. Timeout vs Deadline

Ada dua konsep yang sering disamakan, padahal berbeda.

### 3.1 Timeout

Timeout biasanya berarti:

```text
durasi maksimum untuk satu operasi atau satu fase.
```

Contoh:

```text
connect timeout = 2 detik
read timeout = 5 detik
write timeout = 5 detik
pool acquisition timeout = 500 ms
```

Timeout relatif terhadap awal fase tersebut.

### 3.2 Deadline

Deadline berarti:

```text
batas waktu absolut untuk seluruh pekerjaan.
```

Contoh:

```text
request user masuk pukul 10:00:00.000
SLA response 2 detik
deadline = 10:00:02.000
```

Semua downstream call, retry, parsing, fallback, logging, dan response construction harus selesai sebelum deadline.

### 3.3 Kenapa Deadline Lebih Kuat

Timeout lokal bisa membuat total waktu meledak.

Contoh:

```text
overall user budget = 2 detik

client config:
- per attempt timeout = 1 detik
- retry = 3 kali
- backoff = 200ms, 400ms

Worst case:
1 detik + 200ms + 1 detik + 400ms + 1 detik = 3.6 detik
```

Padahal caller hanya punya 2 detik.

Deadline-aware design akan bertanya sebelum attempt berikutnya:

```text
apakah sisa waktu cukup untuk attempt ini?
```

Kalau tidak cukup:

```text
jangan retry
gagal cepat
atau fallback
```

---

## 4. Timeout sebagai Budget, Bukan Tebakan

Timeout production-grade tidak diambil dari:

```text
"biasanya 30 detik"
"biar aman 60 detik"
"di local saya 5 detik cukup"
"pakai default library saja"
```

Timeout harus berasal dari budget.

Contoh service chain:

```text
Browser / external caller SLA: 3_000 ms

API Gateway overhead:       150 ms
Auth / session validation:  150 ms
Application logic local:    300 ms
DB call:                    700 ms
External API call:        1_000 ms
Serialization + response:   100 ms
Safety margin:              600 ms
```

Maka external API client tidak boleh tiba-tiba punya timeout 30 detik.

Ia harus hidup dalam budget, misalnya:

```text
overall external call deadline: 1_000 ms
per attempt timeout: 400 ms
retry: max 1 retry
backoff: 100 ms
```

Worst case:

```text
attempt 1 = 400 ms
backoff   = 100 ms
attempt 2 = 400 ms
total     = 900 ms
margin    = 100 ms
```

Ini baru masuk akal.

---

## 5. Taxonomy Timeout HTTP Client

Kita pecah timeout berdasarkan fase lifecycle.

```text
┌──────────────────────────────────────────────────────────────┐
│ Application starts HTTP call                                  │
└──────────────────────────────────────────────────────────────┘
          │
          ▼
┌───────────────────────┐
│ Pool acquisition       │  connectionRequestTimeout / pool timeout
└───────────────────────┘
          │
          ▼
┌───────────────────────┐
│ DNS resolution         │  DNS timeout / resolver timeout
└───────────────────────┘
          │
          ▼
┌───────────────────────┐
│ TCP connect            │  connect timeout
└───────────────────────┘
          │
          ▼
┌───────────────────────┐
│ TLS handshake          │  handshake timeout / often under connect/call timeout
└───────────────────────┘
          │
          ▼
┌───────────────────────┐
│ Request write          │  write timeout
└───────────────────────┘
          │
          ▼
┌───────────────────────┐
│ Wait response header   │  response timeout / read timeout / call timeout
└───────────────────────┘
          │
          ▼
┌───────────────────────┐
│ Read response body     │  read timeout / body timeout / call timeout
└───────────────────────┘
          │
          ▼
┌───────────────────────┐
│ Decode + map           │  application deadline, not always HTTP timeout
└───────────────────────┘
          │
          ▼
┌───────────────────────┐
│ Release connection     │  pool reuse or discard
└───────────────────────┘
```

---

## 6. Connect Timeout

### 6.1 Definisi

Connect timeout membatasi:

```text
berapa lama client menunggu proses membangun koneksi jaringan baru
ke remote endpoint.
```

Biasanya mencakup:

```text
TCP connect
kadang sebagian route/proxy establishment
pada beberapa library bisa berkaitan dengan TLS negotiation depending implementation
```

Namun jangan menganggap semua library sama.

### 6.2 Connect Timeout Bukan Response Timeout

Connect timeout tidak membatasi:

```text
waktu server memproses request
waktu menunggu response header
waktu membaca body
waktu retry total
waktu parsing JSON
```

Contoh:

```text
connect timeout = 1 detik
server response setelah 60 detik
```

Call bisa tetap menunggu 60 detik jika read/response/call timeout tidak diset.

### 6.3 Connect Timeout Tidak Selalu Terpakai

Jika koneksi reusable sudah ada di pool:

```text
tidak ada TCP connect baru
connect timeout tidak relevan untuk attempt tersebut
```

Ini sangat penting.

JDK `HttpClient.Builder#connectTimeout` hanya berpengaruh saat koneksi baru perlu dibuat. Jika koneksi dapat digunakan ulang dari request sebelumnya, timeout ini tidak punya efek untuk request tersebut.

### 6.4 Failure yang Ditangani Connect Timeout

Connect timeout membantu saat:

```text
host unreachable
firewall drop
SYN tidak dijawab
network partition
wrong route
security group blocking silently
downstream listener tidak reachable
```

Connect timeout tidak banyak membantu saat:

```text
server menerima koneksi tapi lambat memproses
server mengirim header lalu body sangat lambat
pool caller penuh
DNS hang
application thread starvation
```

### 6.5 Nilai Umum

Tidak ada angka universal, tapi guideline awal:

```text
same region internal service:       100 ms - 500 ms
cross-zone / cross-region:          300 ms - 2 s
internet third-party API:           1 s - 5 s
batch/non-user-facing integration:  2 s - 10 s
```

Namun angka final harus berdasarkan:

```text
network topology
SLA
historical latency
retry policy
criticality
request path
traffic volume
```

---

## 7. Pool Acquisition Timeout

### 7.1 Definisi

Pool acquisition timeout membatasi:

```text
berapa lama request boleh menunggu connection dari pool.
```

Ini bukan network timeout.

Ini local resource timeout.

Jika pool penuh:

```text
request baru menunggu slot connection
```

Tanpa timeout, request bisa antre terlalu lama.

### 7.2 Kenapa Pool Timeout Penting

Misal:

```text
max connections per route = 20
downstream tiba-tiba lambat
20 request sedang menggantung membaca response
request ke-21 sampai ke-500 antre menunggu connection
```

Jika tidak ada pool acquisition timeout:

```text
thread caller ikut menggantung
queue membesar
latency naik
memory naik
akhirnya caller collapse
```

Dengan pool timeout:

```text
request gagal cepat
caller bisa fallback / shed load / return 503
```

### 7.3 Gejala Pool Starvation

Metric/log yang biasanya terlihat:

```text
connection acquisition time tinggi
pending acquire count naik
active connection selalu max
idle connection nol
downstream latency naik
caller thread dump banyak WAITING/TIMED_WAITING
response body leak
retry count naik
```

### 7.4 Pool Timeout vs Connect Timeout

Perbedaannya:

```text
pool timeout:
  menunggu resource lokal connection pool

connect timeout:
  menunggu koneksi baru ke remote endpoint
```

Kalau pool penuh, connect timeout tidak menyelesaikan masalah.

### 7.5 Design Guideline

Untuk user-facing service:

```text
pool acquisition timeout harus pendek
biasanya puluhan sampai ratusan ms
```

Karena kalau pool sudah penuh, menunggu lama sering memperburuk keadaan.

Contoh:

```text
pool acquisition timeout = 100ms - 500ms
connect timeout = 300ms - 2s
response timeout = 500ms - 3s
```

---

## 8. DNS Timeout

### 8.1 Definisi

DNS timeout membatasi:

```text
berapa lama client menunggu resolusi nama host menjadi IP address.
```

Masalahnya:

```text
tidak semua HTTP client memberi konfigurasi DNS timeout eksplisit.
```

Sering DNS ikut tergantung pada:

```text
OS resolver
JVM resolver
custom DNS implementation
network resolver
Kubernetes CoreDNS
corporate DNS
cloud DNS
```

### 8.2 Kenapa DNS Bisa Menjadi Bottleneck

DNS bisa gagal atau lambat karena:

```text
CoreDNS overload
resolver upstream timeout
split-horizon DNS misconfiguration
search domain expansion
ndots Kubernetes behavior
DNS cache expired serentak
negative caching
network ACL
corporate proxy/VPN
```

### 8.3 DNS Caching di JVM

Java punya DNS cache behavior yang dipengaruhi oleh security properties seperti:

```text
networkaddress.cache.ttl
networkaddress.cache.negative.ttl
```

Efeknya:

```text
TTL terlalu panjang:
  client terus memakai IP lama setelah service berpindah

TTL terlalu pendek:
  DNS query meningkat, resolver bisa overload

negative TTL terlalu panjang:
  transient DNS failure bisa "diingat" terlalu lama
```

### 8.4 DNS Failure Pattern di Kubernetes

Contoh:

```text
service-a memanggil service-b.default.svc.cluster.local
CoreDNS overload
beberapa lookup timeout
HTTP client melihat UnknownHostException atau connect failure
retry dari banyak pod memperbesar query DNS
CoreDNS makin overload
```

Solusi bukan hanya menaikkan timeout.

Perlu:

```text
DNS cache sehat
retry DNS-aware
CoreDNS scaling
query reduction
connection pooling
observability DNS latency
```

### 8.5 Design Guideline

Untuk DNS-sensitive system:

```text
ukur DNS lookup latency
gunakan connection pooling agar lookup tidak terlalu sering
hindari membuat client baru per request
pertimbangkan custom DNS resolver untuk observability
jangan set JVM DNS TTL sembarangan
```

---

## 9. TLS Handshake Timeout

### 9.1 Definisi

TLS handshake timeout membatasi:

```text
berapa lama proses negosiasi TLS boleh berlangsung.
```

TLS handshake melibatkan:

```text
protocol negotiation
cipher suite negotiation
certificate exchange
certificate validation
hostname verification
ALPN negotiation untuk HTTP/2
client certificate exchange untuk mTLS
```

### 9.2 Kenapa TLS Bisa Lambat atau Gagal

Penyebab umum:

```text
certificate chain terlalu panjang
OCSP/CRL check lambat
mTLS client cert salah
server cipher mismatch
TLS version mismatch
expired certificate
wrong SNI
corporate MITM proxy
ALPN negotiation issue
CPU pressure di server saat handshake banyak
```

### 9.3 TLS Timeout Sering Tidak Terlihat Eksplisit

Banyak library tidak memberi field:

```text
tlsHandshakeTimeout
```

Secara praktis TLS handshake sering tercakup dalam:

```text
connect timeout
socket timeout
call timeout
response timeout
```

Tergantung library.

Apache HttpClient 5 documentation menyebut connect timeout dapat mencakup transport security negotiation seperti SSL/TLS negotiation dalam proses establishing connection.

### 9.4 mTLS Special Case

mTLS membuat handshake lebih mahal.

Client harus punya:

```text
keystore
private key
certificate chain
truststore untuk server
hostname verification
SNI correctness
```

Timeout terlalu pendek bisa menyebabkan false negative saat handshake normal memang lebih lambat.

Timeout terlalu panjang bisa membuat thread/socket terkunci saat cert problem.

### 9.5 Design Guideline

Untuk mTLS production:

```text
ukur handshake latency terpisah jika memungkinkan
aktifkan connection reuse
hindari membuat client baru per request
pastikan certificate rotation tidak memutus pool behavior
monitor SSLHandshakeException
bedakan TLS failure dari application 5xx
```

---

## 10. Write Timeout

### 10.1 Definisi

Write timeout membatasi:

```text
maksimum durasi inactivity saat client menulis request body ke network.
```

Ia penting untuk:

```text
large upload
multipart upload
slow network
server tidak membaca body
backpressure dari socket
proxy buffering
```

### 10.2 Kapan Write Timeout Penting

Untuk request kecil seperti JSON 1 KB:

```text
write timeout jarang menjadi bottleneck
```

Untuk request besar:

```text
file upload 100 MB
multipart evidence upload
large XML/SOAP body
batch payload
streaming upload
```

write timeout sangat penting.

### 10.3 Write Timeout Bukan Total Upload Timeout

Jika write timeout didefinisikan sebagai inactivity timeout:

```text
selama ada progress, upload bisa berlangsung lama
```

Contoh:

```text
write timeout = 10 detik
upload 1 GB
setiap 2 detik ada packet terkirim
upload bisa berjalan beberapa menit
```

Kalau perlu total upload deadline, gunakan:

```text
call timeout
application deadline
cancellation token
```

### 10.4 Retrying Upload

Upload body sering tidak repeatable.

Contoh:

```text
InputStream dari file bisa dibuka ulang
InputStream dari network stream tidak bisa
one-shot stream tidak bisa retry aman
```

Jika write timeout terjadi setelah sebagian body terkirim:

```text
server mungkin sudah menerima sebagian request
server mungkin sudah menjalankan side effect
retry bisa duplikasi
```

Karena itu retry write failure harus sangat hati-hati, terutama untuk POST.

---

## 11. Read Timeout / Response Timeout

### 11.1 Definisi

Read timeout biasanya membatasi:

```text
maksimum durasi inactivity saat client menunggu data dari server.
```

Response timeout bisa berarti:

```text
maksimum waktu menunggu response header setelah request selesai dikirim.
```

Terminologi berbeda antar library.

### 11.2 Read Timeout Bukan Total Download Timeout

Seperti write timeout, read timeout sering inactivity-based.

Contoh:

```text
read timeout = 10 detik
server mengirim 1 byte setiap 9 detik
client bisa tetap menunggu sangat lama
```

Jika ingin total call limit:

```text
gunakan call timeout / deadline
```

### 11.3 Slowloris-Style Response

Server atau proxy buruk bisa:

```text
mengirim header cepat
lalu body sangat lambat
```

Jika hanya punya response header timeout, body masih bisa menggantung.

Jika hanya punya inactivity read timeout, server bisa menjaga koneksi tetap hidup dengan data kecil.

Perlu:

```text
body size limit
overall deadline
streaming processing limit
read inactivity timeout
```

### 11.4 Response Timeout dan SLA

Untuk API JSON biasa:

```text
response header timeout sering menjadi indikator processing time downstream
```

Jika downstream memproses terlalu lama sebelum header pertama:

```text
response timeout trigger
```

Ini biasanya retryable hanya jika operation aman.

Untuk command/write API:

```text
timeout tidak berarti operation tidak terjadi
```

Itu critical.

---

## 12. Call Timeout / Overall Operation Timeout

### 12.1 Definisi

Call timeout membatasi:

```text
durasi total satu HTTP call attempt dari awal sampai selesai.
```

Di OkHttp, call timeout mencakup keseluruhan call termasuk DNS, connecting, writing request body, server processing, dan reading response body.

### 12.2 Kenapa Call Timeout Sangat Berguna

Karena read/write timeout bisa hanya inactivity timeout.

Call timeout memberi pagar total:

```text
attempt ini tidak boleh lebih dari X
```

Contoh:

```text
connect timeout = 500ms
write timeout = 2s
read timeout = 2s
call timeout = 3s
```

Artinya:

```text
walaupun tiap fase masih "aktif",
attempt tetap dibatasi 3 detik total.
```

### 12.3 Call Timeout vs Deadline

Call timeout biasanya per attempt.

Deadline biasanya total operation termasuk:

```text
retry
backoff
fallback
decode
business mapping
response construction
```

Jadi:

```text
call timeout <= per-attempt budget
deadline = global operation budget
```

---

## 13. Idle Timeout dan Keep-Alive Timeout

### 13.1 Definisi

Idle/keep-alive timeout mengatur:

```text
berapa lama connection boleh idle di pool sebelum ditutup.
```

Ini bukan timeout request aktif.

### 13.2 Kenapa Penting

Jika client keep-alive lebih panjang daripada load balancer idle timeout:

```text
client mengira connection masih hidup
LB sudah menutup connection
request berikutnya pakai stale connection
muncul connection reset / broken pipe
```

Jika keep-alive terlalu pendek:

```text
connection churn tinggi
lebih banyak TCP connect
lebih banyak TLS handshake
latency naik
CPU naik
```

### 13.3 JDK HttpClient Keep-Alive

JDK `java.net.http` memiliki system properties seperti:

```text
jdk.httpclient.keepalive.timeout
jdk.httpclient.keepalive.timeout.h2
```

yang mempengaruhi berapa lama idle HTTP connection disimpan di keep-alive cache.

### 13.4 Design Guideline

Selaraskan dengan:

```text
server keep-alive timeout
load balancer idle timeout
API gateway idle timeout
service mesh timeout
NAT behavior
```

Jika tidak tahu:

```text
observasi connection reset setelah idle
cek LB/gateway config
set client idle timeout sedikit lebih pendek dari middlebox timeout
```

---

## 14. Per-Attempt Timeout vs Total Retry Timeout

### 14.1 Masalah

Retry tanpa total budget adalah sumber cascading failure.

Contoh:

```text
per attempt timeout = 5s
max attempts = 3
backoff = 1s, 2s
```

Worst case:

```text
5 + 1 + 5 + 2 + 5 = 18s
```

Jika upstream gateway timeout 10s:

```text
caller sudah timeout
service masih retry di belakang
resource tetap dipakai
downstream makin ditekan
```

### 14.2 Retry Budget

Retry budget membatasi:

```text
berapa banyak tambahan load yang boleh dibuat oleh retry.
```

Prinsip:

```text
retry adalah load amplifier
```

Jika failure disebabkan overload downstream:

```text
retry bisa memperparah overload
```

### 14.3 Deadline-Aware Retry Pseudocode

```java
Instant deadline = Instant.now().plusMillis(900);
int attempt = 0;

while (true) {
    attempt++;

    Duration remaining = Duration.between(Instant.now(), deadline);
    if (remaining.isNegative() || remaining.isZero()) {
        throw new DeadlineExceededException();
    }

    Duration attemptTimeout = min(remaining, Duration.ofMillis(350));

    try {
        return callDownstream(attemptTimeout);
    } catch (RetryableException e) {
        if (attempt >= 2) {
            throw e;
        }

        Duration backoff = Duration.ofMillis(100);
        if (Duration.between(Instant.now(), deadline).compareTo(backoff) <= 0) {
            throw e;
        }

        sleep(backoff);
    }
}
```

Mental model:

```text
Retry hanya boleh dilakukan jika masih ada cukup waktu,
operation aman untuk retry,
dan retry tidak memperburuk failure mode.
```

---

## 15. Timeout di JDK HttpClient

### 15.1 Client-Level Connect Timeout

Contoh:

```java
HttpClient client = HttpClient.newBuilder()
    .connectTimeout(Duration.ofSeconds(2))
    .build();
```

Makna:

```text
batas waktu untuk membangun koneksi baru.
```

Catatan penting:

```text
Jika koneksi reusable sudah ada, connect timeout tidak berpengaruh.
```

### 15.2 Request-Level Timeout

JDK `HttpRequest.Builder` menyediakan:

```java
HttpRequest request = HttpRequest.newBuilder()
    .uri(URI.create("https://api.example.com/users/123"))
    .timeout(Duration.ofSeconds(3))
    .GET()
    .build();
```

Ini lebih dekat ke:

```text
timeout request/call
```

Namun tetap perlu memahami behavior detail sesuai dokumentasi dan implementasi.

### 15.3 `send` vs `sendAsync`

Blocking:

```java
HttpResponse<String> response = client.send(
    request,
    HttpResponse.BodyHandlers.ofString()
);
```

Async:

```java
CompletableFuture<HttpResponse<String>> future = client.sendAsync(
    request,
    HttpResponse.BodyHandlers.ofString()
);
```

Timeout pada request bisa membuat async future complete exceptionally.

Tetapi untuk application deadline yang mencakup pipeline async setelah response:

```java
future.orTimeout(1, TimeUnit.SECONDS);
```

harus dipakai dengan hati-hati karena:

```text
timeout future belum selalu berarti underlying I/O dibatalkan sesuai ekspektasi
tergantung cancellation handling
```

### 15.4 JDK HttpClient Example: Deadline Wrapper

```java
public final class JdkUserClient {
    private final HttpClient client;
    private final URI baseUri;

    public JdkUserClient(URI baseUri) {
        this.baseUri = baseUri;
        this.client = HttpClient.newBuilder()
            .connectTimeout(Duration.ofMillis(500))
            .version(HttpClient.Version.HTTP_2)
            .build();
    }

    public String getUser(String userId, Duration budget)
            throws IOException, InterruptedException {

        HttpRequest request = HttpRequest.newBuilder()
            .uri(baseUri.resolve("/users/" + URLEncoder.encode(userId, StandardCharsets.UTF_8)))
            .timeout(budget)
            .header("Accept", "application/json")
            .GET()
            .build();

        HttpResponse<String> response = client.send(
            request,
            HttpResponse.BodyHandlers.ofString()
        );

        if (response.statusCode() >= 500) {
            throw new DownstreamUnavailableException("User API returned " + response.statusCode());
        }

        if (response.statusCode() == 404) {
            throw new UserNotFoundException(userId);
        }

        if (response.statusCode() >= 400) {
            throw new DownstreamRejectedException("User API returned " + response.statusCode());
        }

        return response.body();
    }
}
```

Catatan:

```text
Contoh ini belum production-complete.
Belum ada retry, metric, tracing, redaction, pool metrics, dan typed DTO mapping.
Tapi timeout sudah ditempatkan sebagai budget eksplisit.
```

---

## 16. Timeout di OkHttp

### 16.1 Timeout Utama

OkHttp mendukung beberapa timeout penting:

```text
connectTimeout
readTimeout
writeTimeout
callTimeout
```

Contoh:

```java
OkHttpClient client = new OkHttpClient.Builder()
    .connectTimeout(Duration.ofMillis(500))
    .readTimeout(Duration.ofSeconds(2))
    .writeTimeout(Duration.ofSeconds(2))
    .callTimeout(Duration.ofSeconds(3))
    .build();
```

### 16.2 Makna Praktis

```text
connectTimeout:
  membatasi membuat koneksi

readTimeout:
  membatasi inactivity saat membaca response

writeTimeout:
  membatasi inactivity saat menulis request

callTimeout:
  membatasi total satu call attempt
```

OkHttp documentation menjelaskan call timeout sebagai batas untuk keseluruhan call: DNS, connecting, writing body, server processing, dan reading body.

### 16.3 Per-Call Timeout

OkHttp memungkinkan timeout per call melalui object `Call.timeout()`.

Pola ini berguna untuk:

```text
endpoint cepat
endpoint lambat
file download
health check
third-party SLA berbeda
```

Contoh konseptual:

```java
Call call = client.newCall(request);
call.timeout().timeout(1, TimeUnit.SECONDS);
Response response = call.execute();
```

### 16.4 Retrofit di Atas OkHttp

Retrofit sendiri tidak menjadi transport timeout engine utama.

Biasanya timeout dikonfigurasi pada:

```text
OkHttpClient yang diberikan ke Retrofit
```

Contoh:

```java
OkHttpClient okHttp = new OkHttpClient.Builder()
    .connectTimeout(Duration.ofMillis(500))
    .readTimeout(Duration.ofSeconds(2))
    .writeTimeout(Duration.ofSeconds(2))
    .callTimeout(Duration.ofSeconds(3))
    .build();

Retrofit retrofit = new Retrofit.Builder()
    .baseUrl("https://api.example.com/")
    .client(okHttp)
    .addConverterFactory(JacksonConverterFactory.create(objectMapper))
    .build();
```

### 16.5 Per-Endpoint Timeout di Retrofit

Advanced pattern:

```text
gunakan annotation custom
baca annotation di interceptor
atur call timeout / chain timeout jika supported
```

Namun hati-hati:

```text
jangan membuat konfigurasi timeout tersebar tanpa governance
jangan membuat endpoint override yang tidak terlihat di operational docs
```

---

## 17. Timeout di Apache HttpClient 5

Apache HttpClient 5 punya model konfigurasi lebih granular.

Konsep umum:

```text
connection request timeout:
  waktu menunggu connection dari pool

connect timeout:
  waktu membangun koneksi baru

response timeout:
  waktu menunggu response

socket timeout:
  inactivity timeout pada socket, tergantung konfigurasi
```

Di HttpClient 5 modern, beberapa konfigurasi timeout bergeser ke `ConnectionConfig`, `RequestConfig`, dan connection manager.

Contoh konseptual:

```java
RequestConfig requestConfig = RequestConfig.custom()
    .setConnectionRequestTimeout(Timeout.ofMilliseconds(300))
    .setResponseTimeout(Timeout.ofSeconds(2))
    .build();

ConnectionConfig connectionConfig = ConnectionConfig.custom()
    .setConnectTimeout(Timeout.ofMilliseconds(500))
    .setSocketTimeout(Timeout.ofSeconds(2))
    .build();

PoolingHttpClientConnectionManager connectionManager =
    PoolingHttpClientConnectionManagerBuilder.create()
        .setDefaultConnectionConfig(connectionConfig)
        .setMaxConnTotal(200)
        .setMaxConnPerRoute(50)
        .build();

CloseableHttpClient client = HttpClients.custom()
    .setConnectionManager(connectionManager)
    .setDefaultRequestConfig(requestConfig)
    .build();
```

Catatan:

```text
API detail dapat berubah antar minor version.
Selalu cek dokumentasi versi yang dipakai.
```

Apache HttpClient 5 documentation menyebut `RequestConfig` sebagai immutable request configuration dan menyediakan `connectionRequestTimeout` serta `responseTimeout`. Untuk connect timeout, dokumentasi terbaru mengarahkan ke `ConnectionConfig.Builder#setConnectTimeout`.

---

## 18. Timeout di Spring RestTemplate, RestClient, WebClient

### 18.1 RestTemplate

`RestTemplate` adalah abstraction.

Timeout tergantung request factory:

```text
SimpleClientHttpRequestFactory
HttpComponentsClientHttpRequestFactory
OkHttp-backed factory jika digunakan
```

Masalah umum:

```java
new RestTemplate();
```

Tanpa konfigurasi request factory yang benar, timeout bisa tidak sesuai ekspektasi.

Production code sebaiknya eksplisit:

```java
@Bean
RestTemplate restTemplate() {
    var requestFactory = new HttpComponentsClientHttpRequestFactory(httpClient());
    requestFactory.setConnectTimeout(Duration.ofMillis(500));
    requestFactory.setConnectionRequestTimeout(Duration.ofMillis(300));
    return new RestTemplate(requestFactory);
}
```

Catatan:

```text
Exact API tergantung versi Spring.
```

### 18.2 RestClient

Spring `RestClient` adalah modern synchronous HTTP client API di Spring Framework 6.1+.

Timeout tetap tergantung underlying request factory/client.

Design-nya:

```text
RestClient = fluent API layer
transport timeout = underlying HTTP client config
```

### 18.3 WebClient

`WebClient` biasanya memakai Reactor Netty.

Timeout harus dipahami dalam model reactive/event-loop:

```text
connect timeout
response timeout
read/write handler timeout
operator timeout
Mono/Flux timeout
```

Kesalahan umum:

```text
menganggap .timeout(Duration) sama dengan semua network timeout
```

Padahal operator timeout bisa membatalkan reactive sequence, sementara connection-level timeout perlu dikonfigurasi pada Reactor Netty HttpClient.

### 18.4 Blocking vs Reactive

Jika memakai WebClient lalu `.block()`:

```text
anda masuk hybrid model
```

Pastikan:

```text
tidak block event-loop
timeout ada di network layer dan operator layer
threading jelas
```

---

## 19. Timeout di Java 8 Legacy

Java 8 belum punya `java.net.http.HttpClient`.

Pilihan umum:

```text
HttpURLConnection
Apache HttpClient 4.x
OkHttp
Retrofit + OkHttp
Spring RestTemplate
```

### 19.1 HttpURLConnection

Contoh:

```java
HttpURLConnection connection = (HttpURLConnection) url.openConnection();
connection.setConnectTimeout(500);
connection.setReadTimeout(2_000);
```

Kelemahan:

```text
API rendah
pooling terbatas/sulit dikontrol
error handling kasar
observability sulit
testing tidak nyaman
abstraction modern tidak ada
```

Untuk production modern, gunakan hanya jika constraint sangat kuat.

### 19.2 Apache HttpClient 4.x

Apache 4.x masih banyak di legacy system.

Timeout umum:

```text
connection request timeout
connect timeout
socket timeout
```

Namun API berbeda dari 5.x.

Migrasi ke 5.x perlu hati-hati karena package dan model berubah.

### 19.3 OkHttp / Retrofit

Untuk Java 8, OkHttp + Retrofit sering menjadi kombinasi paling nyaman untuk typed API client, terutama jika:

```text
butuh connection pooling baik
interceptor
testing dengan MockWebServer
type-safe API
```

---

## 20. Timeout, Virtual Threads, dan Java 21+

Virtual threads mengubah biaya blocking, tetapi tidak menghapus kebutuhan timeout.

Dengan virtual threads:

```text
blocking lebih murah
tetapi downstream tetap terbatas
connection pool tetap terbatas
DB tetap terbatas
NAT port tetap terbatas
remote service tetap bisa overload
```

Kesalahan asumsi:

```text
"Karena pakai virtual thread, timeout bisa lebih longgar."
```

Yang benar:

```text
Virtual threads mengurangi biaya thread parking,
bukan biaya menunggu remote dependency tanpa batas.
```

Jika 10.000 virtual threads menunggu HTTP call tanpa deadline:

```text
memory tetap naik
connection pool tetap penuh
downstream tetap ditekan
backpressure hilang
```

Timeout tetap wajib.

---

## 21. Timeout dan Cancellation

Timeout idealnya tidak hanya:

```text
mengembalikan exception ke caller
```

Tetapi juga:

```text
membatalkan pekerjaan yang tidak lagi berguna
melepaskan connection/socket
menghentikan body stream
mengembalikan permit/semaphore
mencegah retry lanjutan
```

### 21.1 Cancellation Problem

Tidak semua abstraction membatalkan underlying I/O dengan sempurna.

Contoh:

```java
future.orTimeout(1, TimeUnit.SECONDS)
```

Ini membuat future timeout, tetapi developer harus memahami apakah underlying HTTP exchange ikut dibatalkan.

### 21.2 Good Practice

```text
gunakan timeout native HTTP client jika ada
propagate cancellation
close response body
cancel Call/Future saat tidak diperlukan
gunakan structured concurrency jika tersedia
hindari orphaned async tasks
```

### 21.3 Structured Concurrency Mental Model

Dalam fan-out:

```text
call A
call B
call C
```

Jika deadline tercapai:

```text
semua child call harus dibatalkan
bukan hanya parent mengembalikan timeout
```

Kalau tidak:

```text
orphan calls tetap berjalan
downstream tetap menerima load
```

---

## 22. Timeout dan Retry: Urutan yang Benar

### 22.1 Wrong Composition

```text
retry luar, timeout dalam, tanpa global deadline
```

Contoh:

```text
Retry(max=3) {
  Timeout(5s) {
    httpCall()
  }
}
```

Worst case:

```text
15s + backoff
```

### 22.2 Better Composition

```text
GlobalDeadline(2s) {
  Retry(max=2, deadline-aware) {
    PerAttemptTimeout(min(remaining, 700ms)) {
      httpCall()
    }
  }
}
```

### 22.3 Circuit Breaker Position

Common composition:

```text
bulkhead
→ rate limit
→ circuit breaker
→ retry
→ timeout
→ HTTP call
```

Tetapi ini bukan hukum universal.

Pertanyaan design:

```text
Apakah timeout dihitung sebagai failure breaker?
Apakah retry attempt masing-masing melewati breaker?
Apakah breaker melihat final call atau setiap attempt?
Apakah bulkhead permit ditahan sepanjang retry?
```

Untuk banyak service:

```text
bulkhead sebaiknya mencakup seluruh operation agar concurrency total terkendali
timeout harus deadline-aware
breaker harus melihat failure yang bermakna untuk downstream health
```

---

## 23. Timeout dan Idempotency

Timeout pada write operation ambigu.

Contoh:

```text
POST /payments
client timeout setelah 2 detik
```

Kemungkinan:

```text
request tidak pernah sampai
request sampai tapi belum diproses
request sudah diproses berhasil
response sukses hilang di network
server masih memproses
```

Maka:

```text
timeout tidak berarti gagal secara domain
```

Untuk command API:

```text
gunakan idempotency key
gunakan operation id
gunakan status query endpoint
gunakan outbox/delivery state
hindari blind retry
```

Contoh:

```text
POST /payments
Idempotency-Key: 9b9a5e1c...
```

Jika timeout:

```text
retry dengan idempotency key sama
atau query status by operation id
```

Tanpa idempotency:

```text
duplicate payment risk
duplicate case creation
duplicate notification
duplicate enforcement action
```

---

## 24. Timeout dan Queueing Theory

Timeout terlalu panjang menciptakan antrean.

Little's Law:

```text
L = λ × W
```

Artinya:

```text
jumlah request in-flight = arrival rate × waktu tunggu rata-rata
```

Jika traffic:

```text
100 request/detik
```

dan downstream latency naik dari:

```text
200 ms ke 5 detik
```

maka in-flight naik dari:

```text
100 × 0.2 = 20
```

menjadi:

```text
100 × 5 = 500
```

Resource yang tadinya cukup untuk 20 in-flight bisa collapse saat 500.

Timeout pendek dan bulkhead membantu membatasi W.

Tanpa itu:

```text
sistem mengubah downstream slowness menjadi self-inflicted overload
```

---

## 25. Timeout Derivation Step-by-Step

Misal sebuah endpoint user-facing punya SLA:

```text
p95 <= 2_000 ms
```

Service melakukan:

```text
auth check
DB query
external profile API
business mapping
response
```

Budget kasar:

```text
gateway overhead:          100 ms
auth:                      150 ms
DB:                        350 ms
external API:              700 ms
mapping/serialization:     100 ms
margin:                    600 ms
total:                   2_000 ms
```

External API client budget:

```text
700 ms
```

Buat policy:

```text
pool acquisition timeout:  50 ms
connect timeout:          150 ms
response/call attempt:    300 ms
retry max:                1 retry
backoff:                  50 ms
total worst case:         50 + 300 + 50 + 300 = 700 ms
```

Tapi connect included in call timeout jika library mendukung.

Maka actual policy bisa:

```text
overall external deadline: 700 ms
per attempt call timeout: 300 ms
pool acquisition:          50 ms
max attempts:               2
backoff:                   50 ms
```

Jika p95 downstream normal 80ms, p99 250ms:

```text
300ms per attempt masih masuk akal
```

Jika p99 normal sudah 900ms:

```text
budget 700ms tidak realistis
perlu ubah SLA, async pattern, cache, prefetch, atau dependency contract
```

---

## 26. Timeout Matrix by API Type

### 26.1 Internal Low-Latency Microservice

```text
pool acquisition:  10 - 100 ms
connect:           50 - 300 ms
call attempt:      100 - 800 ms
retry:             0 - 1
overall budget:    aligned with upstream SLA
```

### 26.2 Third-Party API User-Facing

```text
pool acquisition:  50 - 300 ms
connect:           500 ms - 2 s
call attempt:      1 - 5 s
retry:             0 - 1, only safe cases
overall budget:    usually <= user SLA
```

### 26.3 Batch Integration

```text
pool acquisition:  500 ms - several seconds
connect:           2 - 10 s
call attempt:      10 - 120 s depending API
retry:             yes, with backoff and budget
overall budget:    job-level deadline
```

### 26.4 File Download

```text
connect:           moderate
read inactivity:   moderate
overall deadline:  based on file size and throughput
body size limit:   mandatory
retry:             range request if supported
```

### 26.5 File Upload

```text
connect:           moderate
write inactivity:  based on network
overall deadline:  based on file size
retry:             only if body repeatable and API idempotent
```

### 26.6 Payment / Enforcement / Case Creation Command

```text
connect:           short/moderate
call attempt:      controlled
retry:             only with idempotency key / operation id
timeout result:    UNKNOWN, not always FAILED
```

---

## 27. Anti-Patterns Timeout

### 27.1 Infinite Timeout

```text
Tidak ada remote call yang boleh menunggu selamanya.
```

Bahkan batch job pun harus punya deadline.

### 27.2 Semua Timeout Sama

```text
connect=30s
read=30s
write=30s
pool=30s
```

Ini biasanya tanda tidak ada budget thinking.

### 27.3 Hanya Connect Timeout

```text
connect timeout diset
read/call timeout tidak diset
```

Hasil:

```text
koneksi cepat dibuat
lalu response menggantung lama
```

### 27.4 Timeout Lebih Lama dari Upstream Gateway

```text
service client timeout 60s
API gateway timeout 30s
```

Hasil:

```text
caller sudah menerima 504
service masih bekerja/retry
wasted work
```

### 27.5 Retry Setelah Timeout untuk Non-Idempotent POST

```text
POST timeout
retry blind
duplicate side effect
```

### 27.6 Timeout Tanpa Metric

Jika timeout terjadi tapi tidak ada metric:

```text
anda hanya punya stacktrace acak
bukan sistem diagnosable
```

Metric minimal:

```text
timeout by client
timeout by endpoint
timeout by phase if possible
attempt count
pool acquisition latency
status distribution
```

### 27.7 Timeout Terlalu Pendek Tanpa Data

Timeout terlalu pendek bisa menyebabkan:

```text
false failure
retry noise
downstream load naik
user-facing error
```

Timeout harus berdasarkan latency distribution, bukan ego engineering.

### 27.8 Timeout Terlalu Panjang Karena Takut Error

Timeout panjang tidak menghilangkan error.

Ia hanya:

```text
menunda error
menahan resource lebih lama
memperluas blast radius
```

---

## 28. Exception Classification

### 28.1 Jangan Hanya Catch `Exception`

Buruk:

```java
try {
    return client.call();
} catch (Exception e) {
    throw new RuntimeException("API failed");
}
```

Masalah:

```text
connect timeout
read timeout
TLS failure
DNS failure
HTTP 400
HTTP 500
JSON parse error
semuanya hilang
```

### 28.2 Failure Classification

Minimal bedakan:

```text
POOL_TIMEOUT
DNS_FAILURE
CONNECT_TIMEOUT
TLS_FAILURE
WRITE_TIMEOUT
RESPONSE_TIMEOUT
READ_TIMEOUT
CALL_TIMEOUT
HTTP_4XX
HTTP_429
HTTP_5XX
MALFORMED_RESPONSE
DECODING_FAILURE
DOMAIN_REJECTION
```

### 28.3 Retryability

Contoh classification:

```text
CONNECT_TIMEOUT:
  retryable if idempotent and deadline remains

READ_TIMEOUT:
  maybe retryable for GET
  dangerous for POST

WRITE_TIMEOUT:
  dangerous if body partially sent

CALL_TIMEOUT:
  depends on phase and operation

HTTP_429:
  retryable if Retry-After and budget allows

HTTP_500/502/503/504:
  maybe retryable if idempotent

HTTP_400/401/403/404:
  usually not retryable without changing request/auth/state
```

### 28.4 Domain Result for Command Timeout

Untuk command:

```text
timeout result = UNKNOWN
```

Bukan:

```text
FAILED
```

Model domain:

```java
enum ExternalCommandResultStatus {
    ACCEPTED,
    REJECTED,
    UNKNOWN_TIMEOUT,
    UNKNOWN_TRANSPORT_FAILURE
}
```

Ini penting untuk regulatory/case management system.

---

## 29. Observability untuk Timeout

### 29.1 Metric Minimal

Per client/per endpoint:

```text
request_count
success_count
failure_count
timeout_count
connect_timeout_count
read_timeout_count
write_timeout_count
pool_timeout_count
dns_failure_count
tls_failure_count
retry_count
attempt_count
latency_histogram
pool_acquire_latency
active_connections
idle_connections
pending_acquires
```

### 29.2 Histogram, Bukan Average

Average menipu.

Gunakan:

```text
p50
p90
p95
p99
max
```

Timeout harus dibandingkan dengan latency percentile.

Contoh:

```text
p99 normal = 450ms
timeout = 500ms
```

Mungkin terlalu ketat jika variance normal tinggi.

Contoh lain:

```text
p99 normal = 120ms
timeout = 5s
```

Mungkin terlalu longgar untuk user-facing API.

### 29.3 Log Field

Saat timeout:

```json
{
  "event": "http_client_timeout",
  "client": "profile-api",
  "endpoint": "GET /profiles/{id}",
  "phase": "response",
  "attempt": 1,
  "maxAttempts": 2,
  "timeoutMs": 300,
  "elapsedMs": 301,
  "remainingBudgetMs": 350,
  "method": "GET",
  "host": "profile.internal",
  "correlationId": "..."
}
```

Jangan log:

```text
Authorization
Cookie
token
secret query param
PII body
full URL with sensitive query
```

### 29.4 Trace

Trace harus menunjukkan:

```text
span duration
timeout event
retry attempt span
downstream host/service
status code or exception type
remaining budget if available
```

Hindari high-cardinality tag:

```text
full URL with user id
raw query
request body
exception message with dynamic value
```

---

## 30. Testing Timeout

### 30.1 Apa yang Harus Diuji

Test:

```text
connect timeout
read timeout
response header delay
slow body
pool acquisition timeout
retry respects deadline
timeout maps to correct exception
non-idempotent POST not retried blindly
response body closed on timeout/error
metrics emitted
```

### 30.2 MockWebServer Example Concept

Dengan OkHttp MockWebServer, bisa mensimulasikan:

```text
delayed response header
slow response body
disconnect during response
throttled body
```

Contoh konseptual:

```java
server.enqueue(new MockResponse()
    .setBody("{\"ok\":true}")
    .setHeadersDelay(2, TimeUnit.SECONDS));

OkHttpClient client = new OkHttpClient.Builder()
    .callTimeout(Duration.ofMillis(500))
    .build();

assertThrows(SocketTimeoutException.class, () -> {
    client.newCall(request).execute();
});
```

### 30.3 Pool Timeout Test

Untuk pool starvation:

```text
set max connections kecil
buat server menahan response
jalankan banyak concurrent request
pastikan request tambahan gagal cepat
```

### 30.4 Jangan Hanya Test Happy Path

HTTP client production harus diuji untuk:

```text
downstream diam
downstream lambat
downstream reset
downstream return 429
downstream return malformed JSON
downstream return huge body
downstream return wrong content-type
```

---

## 31. Production Diagnosis Playbook: Timeout Spike

Saat timeout spike, jangan langsung menaikkan timeout.

Urutan diagnosis:

### 31.1 Pertanyaan Awal

```text
Timeout jenis apa?
Client mana?
Endpoint mana?
Mulai kapan?
Hanya satu environment atau semua?
Hanya satu AZ/node/pod?
Status downstream bagaimana?
Ada deployment/config/network change?
Ada traffic spike?
Ada retry spike?
```

### 31.2 Metric yang Dicek

```text
caller request rate
caller latency p95/p99
timeout count by phase
retry count
connection pool active/idle/pending
thread pool usage
CPU/memory/GC
DNS latency/failure
TLS handshake failure
downstream latency/status
gateway 502/503/504
LB target health
NAT port usage
```

### 31.3 Thread Dump Clue

Cari:

```text
threads blocked waiting connection pool
threads reading socket
threads stuck DNS
threads waiting CompletableFuture
event-loop blocked
large number of virtual threads parked on same downstream
```

### 31.4 Mitigation yang Aman

Tergantung root cause:

```text
pool exhausted:
  reduce concurrency, fix body leak, tune pool, add bulkhead

downstream overloaded:
  reduce retry, open circuit, shed load, fallback

timeout too tight after valid latency increase:
  adjust budget carefully

DNS failure:
  inspect resolver/CoreDNS, cache, network

TLS failure:
  inspect cert, truststore, SNI, mTLS config

gateway timeout:
  align timeout hierarchy
```

### 31.5 Jangan Refleks

Refleks buruk:

```text
"Naikkan timeout dari 5s ke 60s."
```

Efek:

```text
error terlihat turun sementara
resource retention naik
queue naik
blast radius membesar
incident berikutnya lebih parah
```

---

## 32. Timeout Hierarchy

Timeout harus tersusun dari luar ke dalam.

Contoh user-facing:

```text
Browser/client timeout:          10s
External API Gateway timeout:     8s
Internal API Gateway timeout:     5s
Service endpoint deadline:        3s
Downstream client deadline:       1s
Per-attempt timeout:            400ms
Pool acquisition timeout:        50ms
Connect timeout:                150ms
```

Prinsip:

```text
inner timeout harus lebih pendek dari outer timeout
```

Kalau tidak:

```text
outer layer timeout duluan
inner work tetap berjalan
wasted work
ambiguous result
```

---

## 33. Policy Object Pattern

Jangan hardcode timeout di banyak tempat.

Buruk:

```java
client.newBuilder()
    .connectTimeout(Duration.ofSeconds(3))
    .readTimeout(Duration.ofSeconds(7));
```

Tersebar di 20 class.

Lebih baik:

```java
public record HttpClientTimeoutPolicy(
    Duration poolAcquireTimeout,
    Duration connectTimeout,
    Duration writeTimeout,
    Duration readTimeout,
    Duration callTimeout,
    int maxAttempts,
    Duration firstBackoff
) {
    public void validate() {
        if (connectTimeout.compareTo(callTimeout) >= 0) {
            throw new IllegalArgumentException("connectTimeout must be less than callTimeout");
        }
        if (poolAcquireTimeout.compareTo(callTimeout) >= 0) {
            throw new IllegalArgumentException("poolAcquireTimeout must be less than callTimeout");
        }
        if (maxAttempts < 1) {
            throw new IllegalArgumentException("maxAttempts must be >= 1");
        }
    }
}
```

Keuntungan:

```text
policy eksplisit
bisa divalidasi
bisa didokumentasikan
bisa diuji
bisa diobservasi
bisa beda per client/endpoint dengan governance
```

---

## 34. Example: Production-Grade Timeout Policy untuk OkHttp + Retrofit

```java
public final class DownstreamClientFactory {

    public static OkHttpClient createOkHttp(DownstreamPolicy policy, MeterRegistry meterRegistry) {
        policy.validate();

        return new OkHttpClient.Builder()
            .connectTimeout(policy.connectTimeout())
            .readTimeout(policy.readTimeout())
            .writeTimeout(policy.writeTimeout())
            .callTimeout(policy.callTimeout())
            .connectionPool(new ConnectionPool(
                policy.maxIdleConnections(),
                policy.keepAliveDuration().toMillis(),
                TimeUnit.MILLISECONDS
            ))
            .addInterceptor(new CorrelationIdInterceptor())
            .addInterceptor(new TimeoutMetricsInterceptor(meterRegistry, policy.name()))
            .build();
    }

    public static Retrofit createRetrofit(
        URI baseUri,
        OkHttpClient okHttp,
        ObjectMapper objectMapper
    ) {
        return new Retrofit.Builder()
            .baseUrl(baseUri.toString())
            .client(okHttp)
            .addConverterFactory(JacksonConverterFactory.create(objectMapper))
            .build();
    }
}
```

Policy:

```java
public record DownstreamPolicy(
    String name,
    Duration connectTimeout,
    Duration readTimeout,
    Duration writeTimeout,
    Duration callTimeout,
    int maxIdleConnections,
    Duration keepAliveDuration
) {
    public void validate() {
        requirePositive(connectTimeout, "connectTimeout");
        requirePositive(readTimeout, "readTimeout");
        requirePositive(writeTimeout, "writeTimeout");
        requirePositive(callTimeout, "callTimeout");

        if (connectTimeout.compareTo(callTimeout) > 0) {
            throw new IllegalArgumentException("connectTimeout cannot exceed callTimeout");
        }
    }

    private static void requirePositive(Duration duration, String field) {
        if (duration == null || duration.isZero() || duration.isNegative()) {
            throw new IllegalArgumentException(field + " must be positive");
        }
    }
}
```

Catatan:

```text
Ini skeleton.
Production real harus menambahkan retry/bulkhead/circuit breaker/trace/log redaction.
```

---

## 35. Example: Deadline-Aware API Client Facade

```java
public final class ProfileClient {

    private final ProfileApi api;
    private final RetryPolicy retryPolicy;
    private final Clock clock;

    public ProfileClient(ProfileApi api, RetryPolicy retryPolicy, Clock clock) {
        this.api = api;
        this.retryPolicy = retryPolicy;
        this.clock = clock;
    }

    public ProfileResponse getProfile(String profileId, Duration totalBudget) {
        Instant deadline = clock.instant().plus(totalBudget);
        int attempt = 0;

        while (true) {
            attempt++;

            Duration remaining = Duration.between(clock.instant(), deadline);
            if (remaining.isZero() || remaining.isNegative()) {
                throw new DownstreamDeadlineExceededException("profile-api deadline exceeded");
            }

            try {
                return api.getProfile(profileId, remaining);
            } catch (DownstreamTimeoutException e) {
                if (!retryPolicy.canRetry(attempt, remaining, e)) {
                    throw e;
                }

                sleep(retryPolicy.nextBackoff(attempt, remaining));
            }
        }
    }
}
```

Key point:

```text
Facade menerima totalBudget.
Transport menerima remaining budget.
Retry sadar deadline.
Exception typed.
```

---

## 36. Design Review Questions

Gunakan checklist ini saat review HTTP client.

### 36.1 Budget

```text
Apa SLA caller?
Berapa budget untuk downstream ini?
Apakah timeout lebih pendek dari gateway/upstream timeout?
Apakah retry masih masuk total budget?
```

### 36.2 Timeout Type

```text
Apakah ada connect timeout?
Apakah ada pool acquisition timeout?
Apakah ada read/response timeout?
Apakah ada write timeout untuk upload?
Apakah ada call/overall timeout?
Apakah DNS/TLS behavior dipahami?
```

### 36.3 Retry

```text
Apakah timeout result aman untuk retry?
Apakah operation idempotent?
Apakah ada idempotency key?
Apakah retry deadline-aware?
Apakah ada jitter/backoff?
```

### 36.4 Resource

```text
Apa max connection?
Apa max concurrency?
Apa yang terjadi jika pool penuh?
Apakah response body selalu ditutup?
Apakah client singleton/reused?
```

### 36.5 Observability

```text
Bisakah kita tahu timeout terjadi di fase mana?
Ada metric latency histogram?
Ada metric retry?
Ada metric pool?
Ada trace span?
Log aman dari secret/PII?
```

### 36.6 Operations

```text
Apa mitigation saat timeout spike?
Bisa disable retry via config?
Bisa reduce concurrency?
Ada circuit breaker?
Ada fallback?
Ada runbook?
```

---

## 37. Mental Model Ringkas

Timeout engineering bisa diringkas menjadi:

```text
Remote call adalah lease resource lokal untuk menunggu sistem lain.

Timeout adalah batas lease.

Pool timeout melindungi resource lokal.
Connect timeout melindungi dari network path yang tidak terbentuk.
Write timeout melindungi dari request body yang tidak bisa dikirim.
Read/response timeout melindungi dari server/proxy yang tidak memberi data.
Call timeout melindungi satu attempt secara total.
Deadline melindungi keseluruhan operation.
Retry budget melindungi sistem dari retry storm.
```

Prinsip top-tier:

```text
Setiap timeout harus punya alasan.
Setiap retry harus punya budget.
Setiap command timeout harus dianggap ambiguous.
Setiap external client harus observable.
Setiap pool harus bounded.
Setiap response body harus ditutup.
Setiap default harus dicurigai sampai dipahami.
```

---

## 38. Mini Decision Table

| Situation | Timeout Strategy |
|---|---|
| Internal GET low latency | Short connect, short call, maybe 1 retry |
| Internal POST command | Short/moderate timeout, no blind retry, idempotency key |
| Third-party API user-facing | Strict total budget, limited retry, fallback if possible |
| Batch API | Longer timeout, controlled retry, job deadline |
| File upload | Write timeout + call deadline + repeatability check |
| File download | Read timeout + body size limit + total deadline |
| mTLS API | Measure handshake, reuse client, avoid too-short connect |
| Pool exhaustion | Short pool acquisition timeout + bulkhead + leak check |
| DNS instability | Observe resolver, tune cache carefully, avoid client churn |
| Gateway 504 | Align inner timeout below outer timeout |

---

## 39. What Top 1% Engineers Do Differently

Engineer biasa:

```text
"Set timeout 30 detik."
```

Engineer kuat:

```text
"Call ini berada dalam 900ms budget.
Kita punya 2 attempt maksimal.
Per-attempt 350ms, backoff 100ms, pool acquire 50ms.
POST tidak diretry tanpa idempotency key.
Timeout menghasilkan UNKNOWN untuk command.
Metric membedakan pool/connect/read/call timeout.
Gateway timeout 2s, jadi client deadline 900ms aman.
Pool max dan bulkhead disesuaikan dengan downstream capacity.
Response body ditutup di semua path.
Config bisa diturunkan saat incident untuk mengurangi retry pressure."
```

Perbedaannya bukan hafalan API.

Perbedaannya adalah:

```text
mampu melihat timeout sebagai bagian dari sistem kendali produksi.
```

---

## 40. Ringkasan Part 6

Kita sudah membahas:

```text
timeout vs deadline
timeout as budget
connect timeout
pool acquisition timeout
DNS timeout
TLS handshake timeout
write timeout
read/response timeout
call timeout
idle/keep-alive timeout
retry total timeout
timeout di JDK HttpClient
timeout di OkHttp
timeout di Retrofit
timeout di Apache HttpClient 5
timeout di Spring RestTemplate/RestClient/WebClient
timeout di Java 8 legacy
virtual threads dan timeout
cancellation
idempotency
observability
testing
production diagnosis
policy object pattern
design review checklist
```

Core invariant:

```text
Tidak ada HTTP client production-grade tanpa timeout eksplisit,
budget eksplisit, retry boundary eksplisit, dan observability eksplisit.
```

---

## 41. Latihan Praktis

### Latihan 1 — Audit Timeout Existing Client

Ambil satu HTTP client di project.

Jawab:

```text
connect timeout berapa?
read/response timeout berapa?
write timeout berapa?
pool acquisition timeout ada?
call timeout ada?
retry berapa?
total worst-case latency berapa?
apakah lebih kecil dari upstream gateway timeout?
```

### Latihan 2 — Classify Timeout Result

Untuk endpoint:

```text
POST /cases
```

Jika client timeout, apakah hasil domain:

```text
FAILED
UNKNOWN
RETRYABLE
NON_RETRYABLE
```

Jelaskan alasan.

### Latihan 3 — Design Timeout Budget

SLA endpoint:

```text
2 detik
```

Downstream:

```text
GET /risk-score
```

Normal p95:

```text
120ms
```

p99:

```text
300ms
```

Buat:

```text
pool timeout
connect timeout
call timeout
retry policy
total deadline
```

### Latihan 4 — Simulate Slow Response

Dengan MockWebServer/WireMock:

```text
response header delay 2s
client timeout 500ms
assert exception classification
assert metric emitted
```

### Latihan 5 — Timeout Hierarchy

Gambar hierarchy timeout untuk service Anda:

```text
browser
gateway
backend endpoint
HTTP client downstream
retry attempt
```

Pastikan inner lebih pendek dari outer.

---

## 42. Penutup

Timeout adalah salah satu area yang membedakan HTTP client biasa dari HTTP client yang production-grade.

HTTP call tidak boleh dipandang sebagai:

```text
method call biasa
```

Ia harus dipandang sebagai:

```text
distributed wait with bounded local resource lease
```

Jika batasnya jelas, sistem bisa gagal cepat, terukur, dan terkendali.

Jika batasnya kabur, sistem akan gagal lambat, diam-diam, dan biasanya menjatuhkan komponen yang sebenarnya tidak bersalah.

Part berikutnya akan masuk ke:

```text
Part 7 — Connection Pooling, Keep-Alive, HTTP/2 Multiplexing, dan Resource Reuse
```

Di sana kita akan membahas mengapa timeout tidak bisa dipisahkan dari pooling, connection reuse, HTTP/2 multiplexing, body lifecycle, stale connection, load balancer idle timeout, dan resource leak.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./05-request-response-body-json-form-multipart-streaming.md">⬅️ Part 5 — Body Handling: JSON, Form, Multipart, Streaming, File Upload/Download</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./07-connection-pooling-keepalive-http2-multiplexing-resource-reuse.md">Part 7 — Connection Pooling, Keep-Alive, HTTP/2 Multiplexing, dan Resource Reuse ➡️</a>
</div>
