# learn-nginx-mastery-for-java-engineers-part-019.md

# Part 019 — Observability: Access Logs, Error Logs, Correlation IDs, and Metrics

> Seri: `learn-nginx-mastery-for-java-engineers`  
> Bagian: `019 / 030`  
> Fokus: menjadikan Nginx sebagai boundary observability antara client, edge, dan aplikasi Java.

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita membahas security hardening. Setelah sistem lebih aman, pertanyaan berikutnya adalah: **bagaimana kita tahu apa yang sedang terjadi?**

Nginx sering berada di titik yang sangat strategis:

```text
Client / Browser / Mobile / Partner
        |
        v
      Nginx
        |
        v
Java Application / API / Service
        |
        v
Database / Queue / External Service
```

Karena Nginx berada di depan aplikasi, ia melihat hampir semua request sebelum aplikasi melihatnya. Ini membuat Nginx menjadi salah satu sumber observability paling penting untuk:

- traffic volume,
- status code,
- latency,
- upstream health,
- client disconnect,
- request size,
- response size,
- routing behavior,
- cache behavior,
- rate limiting,
- TLS/proxy problem,
- correlation antara edge dan aplikasi Java.

Tujuan bagian ini bukan sekadar “cara menyalakan log”, tetapi memahami **Nginx log sebagai event stream produksi**.

Setelah bagian ini, kamu harus mampu:

1. membaca access log Nginx sebagai trace ringkas sebuah request,
2. membedakan access log, error log, metrics, dan distributed trace,
3. membuat `log_format` yang production-ready,
4. menambahkan request ID/correlation ID,
5. memetakan latency Nginx ke latency aplikasi Java,
6. membaca status seperti `499`, `502`, `503`, `504` secara benar,
7. menghindari leakage data sensitif dalam log,
8. merancang observability contract antara Nginx dan backend Java.

---

## 1. Mental Model: Nginx as the First Truthful Witness

Aplikasi Java hanya melihat request yang berhasil sampai ke upstream.

Nginx melihat lebih banyak:

- request yang ditolak sebelum masuk aplikasi,
- request yang terlalu besar,
- request yang gagal TLS/connection,
- request yang timeout sebelum upstream selesai,
- request yang client-nya disconnect,
- request yang diarahkan ke upstream tertentu,
- request yang cache hit/miss,
- response yang gagal dikirim ke client.

Itulah sebabnya log aplikasi saja tidak cukup.

Contoh sederhana:

```text
Client request -> Nginx -> Java app
```

Jika Java app tidak punya log, bisa jadi:

- request tidak pernah sampai ke Java app,
- Nginx menolak request,
- upstream connection gagal,
- client disconnect sebelum upstream dipanggil,
- request masuk ke server block yang salah,
- location matching salah,
- method/body/header ditolak Nginx,
- DNS upstream gagal,
- TLS handshake gagal.

Maka prinsip utama bagian ini:

> Jangan mulai debugging production dari log aplikasi saja. Mulai dari boundary terluar yang melihat request.

Dalam sistem dengan Nginx, boundary itu biasanya adalah Nginx access/error log.

---

## 2. Empat Lapisan Observability Nginx

Untuk memahami Nginx observability, pisahkan menjadi empat lapisan.

```text
1. Access log
   Apa yang terjadi pada setiap request.

2. Error log
   Apa yang salah di level server, config, connection, upstream, filesystem, TLS, module.

3. Metrics
   Agregasi numerik untuk dashboard dan alert.

4. Trace/correlation
   Hubungan satu request dari Nginx ke aplikasi Java dan sistem downstream.
```

Masing-masing menjawab pertanyaan berbeda.

| Layer | Pertanyaan yang Dijawab |
|---|---|
| Access log | Request ini statusnya apa, latency berapa, upstream mana, response berapa byte? |
| Error log | Kenapa Nginx gagal connect/read/write? Ada config, permission, DNS, TLS, file issue? |
| Metrics | Apakah error rate naik? p99 memburuk? connection habis? throughput abnormal? |
| Correlation/trace | Request ID ini melewati service apa saja dan gagal di mana? |

Kesalahan umum adalah memakai satu lapisan untuk semua kebutuhan.

Misalnya:

- memakai access log untuk alert real-time tanpa aggregation pipeline,
- memakai error log untuk menghitung traffic volume,
- mengandalkan metrics tanpa sample log saat incident,
- punya distributed tracing tapi tidak propagate request ID dari Nginx.

Observability yang sehat membutuhkan semuanya, walau tingkat kedalamannya bisa berbeda antar sistem.

---

## 3. Access Log: Event Record untuk Setiap Request

Directive utama:

```nginx
access_log /var/log/nginx/access.log;
```

Bentuk lebih eksplisit:

```nginx
http {
    access_log /var/log/nginx/access.log combined;
}
```

`combined` adalah format bawaan yang umum:

```text
$remote_addr - $remote_user [$time_local] "$request" $status $body_bytes_sent "$http_referer" "$http_user_agent"
```

Contoh log:

```text
203.0.113.10 - - [19/Jun/2026:10:15:22 +0700] "GET /api/orders/123 HTTP/1.1" 200 842 "-" "curl/8.0"
```

Ini cukup untuk debugging dasar, tetapi belum cukup untuk production backend karena tidak menunjukkan:

- upstream address,
- upstream status,
- upstream response time,
- total request time,
- request ID,
- forwarded IP,
- host,
- scheme,
- cache status,
- byte sent vs body byte,
- TLS/protocol information.

Untuk Java backend production, kamu hampir selalu perlu custom `log_format`.

---

## 4. Core Variables untuk Observability

Nginx menyediakan banyak variable. Yang paling penting untuk observability reverse proxy:

### 4.1 Identitas Client

| Variable | Makna |
|---|---|
| `$remote_addr` | IP peer yang connect langsung ke Nginx |
| `$http_x_forwarded_for` | Header `X-Forwarded-For` dari request |
| `$realip_remote_addr` | Original remote address setelah Real IP module digunakan |
| `$remote_user` | User dari Basic Auth jika ada |

Catatan penting:

`$remote_addr` belum tentu IP user asli jika Nginx berada di belakang load balancer/CDN.

Contoh:

```text
Client -> CDN -> Cloud LB -> Nginx -> Java
```

Pada Nginx:

```text
$remote_addr = IP Cloud LB
X-Forwarded-For = client, CDN, LB chain
```

Jika butuh IP client asli, gunakan Real IP configuration dengan trust boundary yang benar.

Contoh:

```nginx
set_real_ip_from 10.0.0.0/8;
real_ip_header X-Forwarded-For;
real_ip_recursive on;
```

Namun ini berbahaya jika `set_real_ip_from` terlalu longgar. Jangan percaya `X-Forwarded-For` dari internet publik secara langsung.

---

### 4.2 Request Identity

| Variable | Makna |
|---|---|
| `$request` | Request line lengkap: method URI protocol |
| `$request_method` | HTTP method |
| `$request_uri` | URI original dengan query string |
| `$uri` | URI normalized/internal current |
| `$args` | Query string |
| `$host` | Host hasil parsing Nginx |
| `$http_host` | Header Host mentah |
| `$server_name` | Server block name yang terpilih |
| `$scheme` | http/https di sisi Nginx |
| `$server_protocol` | HTTP/1.1, HTTP/2, etc. |

Perbedaan `$request_uri` dan `$uri` penting.

Contoh:

```text
GET /api//orders/../orders/123?debug=true HTTP/1.1
```

Nginx dapat melakukan normalisasi internal. `$request_uri` lebih cocok untuk audit original request. `$uri` lebih cocok untuk route internal yang sudah diproses.

Untuk access log, biasanya log keduanya atau minimal `$request_uri`.

---

### 4.3 Response and Status

| Variable | Makna |
|---|---|
| `$status` | Final status code yang dikirim ke client |
| `$body_bytes_sent` | Bytes body yang dikirim, tidak termasuk header |
| `$bytes_sent` | Total bytes yang dikirim, termasuk header |
| `$sent_http_content_type` | Response Content-Type |
| `$sent_http_location` | Response Location header jika ada |

Status final belum tentu sama dengan upstream status.

Contoh:

```text
upstream status: 500
Nginx final status: 502
```

atau:

```text
upstream status: 200
Nginx final status: 499
```

Status `499` berarti client menutup koneksi sebelum Nginx selesai mengirim response. Ini bukan standard HTTP status dari backend; ini status khusus Nginx.

---

### 4.4 Timing

Timing adalah bagian paling penting untuk incident.

| Variable | Makna |
|---|---|
| `$request_time` | Total waktu request di Nginx dari first byte client sampai log write |
| `$upstream_connect_time` | Waktu connect ke upstream |
| `$upstream_header_time` | Waktu sampai upstream response header diterima |
| `$upstream_response_time` | Waktu sampai upstream response selesai dibaca |

Mental model:

```text
request_time
= waktu client upload request body
+ waktu Nginx connect ke upstream
+ waktu upstream memproses
+ waktu Nginx membaca response upstream
+ waktu Nginx mengirim response ke client
```

`$upstream_response_time` lebih dekat ke waktu backend, tetapi tidak selalu sama dengan waktu aplikasi Java karena dapat mencakup network dan buffering.

Jika:

```text
$request_time tinggi
$upstream_response_time rendah
```

Kemungkinan:

- client lambat membaca response,
- response besar,
- network client lambat,
- buffering/send ke client lama,
- client upload request body lambat.

Jika:

```text
$request_time tinggi
$upstream_response_time tinggi
```

Kemungkinan:

- aplikasi Java lambat,
- downstream database lambat,
- thread pool penuh,
- GC pause,
- external call lambat.

Jika:

```text
$upstream_connect_time tinggi
```

Kemungkinan:

- upstream overloaded,
- SYN backlog penuh,
- network issue,
- connection pool upstream Nginx tidak efektif,
- firewall/security group issue.

---

### 4.5 Upstream Information

| Variable | Makna |
|---|---|
| `$upstream_addr` | Address upstream yang dipakai |
| `$upstream_status` | Status dari upstream |
| `$upstream_bytes_received` | Bytes diterima dari upstream |
| `$upstream_bytes_sent` | Bytes dikirim ke upstream |
| `$proxy_host` | Host yang dipakai proxy |

Jika retry terjadi, variable upstream dapat berisi beberapa value dipisahkan koma.

Contoh:

```text
upstream_addr="10.0.1.10:8080, 10.0.1.11:8080"
upstream_status="502, 200"
upstream_response_time="0.003, 0.081"
```

Artinya Nginx mencoba upstream pertama, gagal dengan `502`, lalu retry ke upstream kedua dan berhasil.

Ini sangat penting untuk membaca retry behavior.

Tanpa log upstream detail, incident seperti ini terlihat sebagai request normal `200`, padahal ada hidden upstream failure.

---

## 5. Membuat Production-Ready Log Format

Contoh format sederhana namun jauh lebih berguna:

```nginx
http {
    log_format main_ext
        'time="$time_iso8601" '
        'remote_addr="$remote_addr" '
        'realip_remote_addr="$realip_remote_addr" '
        'xff="$http_x_forwarded_for" '
        'request_id="$request_id" '
        'method="$request_method" '
        'scheme="$scheme" '
        'host="$host" '
        'server_name="$server_name" '
        'uri="$request_uri" '
        'status=$status '
        'bytes_sent=$bytes_sent '
        'body_bytes_sent=$body_bytes_sent '
        'referer="$http_referer" '
        'user_agent="$http_user_agent" '
        'request_time=$request_time '
        'upstream_addr="$upstream_addr" '
        'upstream_status="$upstream_status" '
        'upstream_connect_time="$upstream_connect_time" '
        'upstream_header_time="$upstream_header_time" '
        'upstream_response_time="$upstream_response_time"';

    access_log /var/log/nginx/access.log main_ext;
}
```

Contoh output:

```text
time="2026-06-19T10:15:22+07:00" remote_addr="203.0.113.10" realip_remote_addr="203.0.113.10" xff="-" request_id="7f3dd2e2a1e7f621" method="GET" scheme="https" host="api.example.com" server_name="api.example.com" uri="/api/orders/123" status=200 bytes_sent=1082 body_bytes_sent=842 referer="-" user_agent="curl/8.0" request_time=0.094 upstream_addr="10.0.1.20:8080" upstream_status="200" upstream_connect_time="0.001" upstream_header_time="0.087" upstream_response_time="0.092"
```

Ini format key-value, bukan JSON. Kelebihannya:

- mudah dibaca manusia,
- relatif aman dari quoting issue jika parser disiapkan,
- umum untuk grep/debug manual.

Kekurangannya:

- parsing bisa lebih rapuh,
- value dengan quote perlu hati-hati,
- nested structure sulit.

Untuk log pipeline modern, JSON sering lebih baik.

---

## 6. JSON Access Log

Contoh JSON log format:

```nginx
http {
    log_format json_combined escape=json
    '{'
        '"time":"$time_iso8601",'
        '"remote_addr":"$remote_addr",'
        '"realip_remote_addr":"$realip_remote_addr",'
        '"x_forwarded_for":"$http_x_forwarded_for",'
        '"request_id":"$request_id",'
        '"method":"$request_method",'
        '"scheme":"$scheme",'
        '"host":"$host",'
        '"server_name":"$server_name",'
        '"request_uri":"$request_uri",'
        '"status":$status,'
        '"bytes_sent":$bytes_sent,'
        '"body_bytes_sent":$body_bytes_sent,'
        '"referer":"$http_referer",'
        '"user_agent":"$http_user_agent",'
        '"request_time":$request_time,'
        '"upstream_addr":"$upstream_addr",'
        '"upstream_status":"$upstream_status",'
        '"upstream_connect_time":"$upstream_connect_time",'
        '"upstream_header_time":"$upstream_header_time",'
        '"upstream_response_time":"$upstream_response_time"'
    '}';

    access_log /var/log/nginx/access.json json_combined;
}
```

`escape=json` penting agar karakter seperti quote dalam user agent atau URI tidak merusak JSON.

Contoh output:

```json
{
  "time": "2026-06-19T10:15:22+07:00",
  "remote_addr": "203.0.113.10",
  "realip_remote_addr": "203.0.113.10",
  "x_forwarded_for": "-",
  "request_id": "7f3dd2e2a1e7f621",
  "method": "GET",
  "scheme": "https",
  "host": "api.example.com",
  "server_name": "api.example.com",
  "request_uri": "/api/orders/123",
  "status": 200,
  "bytes_sent": 1082,
  "body_bytes_sent": 842,
  "referer": "-",
  "user_agent": "curl/8.0",
  "request_time": 0.094,
  "upstream_addr": "10.0.1.20:8080",
  "upstream_status": "200",
  "upstream_connect_time": "0.001",
  "upstream_header_time": "0.087",
  "upstream_response_time": "0.092"
}
```

JSON log lebih cocok untuk:

- Elasticsearch/OpenSearch,
- Loki,
- Datadog,
- Splunk,
- CloudWatch Logs,
- GCP Cloud Logging,
- structured alerting,
- dashboard berdasarkan field.

Namun JSON log lebih verbose. Pada traffic besar, dampaknya ke storage dan ingestion cost harus dihitung.

---

## 7. Request ID dan Correlation ID

Tanpa request ID, debugging request spesifik sangat sulit.

Kamu ingin bisa melakukan ini:

```text
Cari request ID abc123 di Nginx log
-> lihat upstream, status, timing
-> cari abc123 di Java app log
-> cari abc123 di downstream service log
-> cari abc123 di trace system
```

Nginx punya variable `$request_id` jika build/module mendukungnya. Pola umum:

```nginx
proxy_set_header X-Request-ID $request_id;
```

Namun ada pertanyaan desain:

> Jika client sudah mengirim `X-Request-ID`, apakah Nginx harus mempertahankan atau mengganti?

Ada dua pendekatan.

### 7.1 Generate Always at Edge

```nginx
proxy_set_header X-Request-ID $request_id;
```

Kelebihan:

- ID selalu trusted dari edge,
- format konsisten,
- menghindari spoofed ID dari client.

Kekurangan:

- partner/client tidak bisa correlate dengan ID mereka sendiri kecuali ID mereka disimpan terpisah.

### 7.2 Preserve Client ID If Present

Nginx open source config standar tidak punya ekspresi kompleks seperti bahasa pemrograman, tetapi bisa memakai `map`.

```nginx
http {
    map $http_x_request_id $correlation_id {
        default $http_x_request_id;
        ""      $request_id;
    }

    log_format main_ext
        'request_id="$correlation_id" '
        'method="$request_method" '
        'uri="$request_uri" '
        'status=$status '
        'request_time=$request_time';

    server {
        location / {
            proxy_set_header X-Request-ID $correlation_id;
            proxy_pass http://app_backend;
        }
    }
}
```

Kelebihan:

- bisa correlate dengan upstream/client external.

Kekurangan:

- client bisa mengirim ID sangat panjang/aneh,
- potensi log injection jika tidak di-escape,
- tidak semua request ID bisa dipercaya.

### 7.3 Recommended Contract

Untuk sistem internal/production API, gunakan dua header:

```text
X-Request-ID       = ID yang dihasilkan/dipilih edge untuk observability internal
X-Correlation-ID   = ID bisnis/external jika ada
```

Contoh:

```nginx
map $http_x_correlation_id $correlation_id {
    default $http_x_correlation_id;
    ""      $request_id;
}

server {
    location / {
        proxy_set_header X-Request-ID $request_id;
        proxy_set_header X-Correlation-ID $correlation_id;
        proxy_pass http://app_backend;
    }
}
```

Di aplikasi Java:

- baca `X-Request-ID`,
- masukkan ke MDC/log context,
- propagate ke downstream call,
- return ke response header jika cocok dengan policy.

Spring Boot contoh konseptual:

```java
@Component
public class RequestIdFilter extends OncePerRequestFilter {
    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain
    ) throws ServletException, IOException {
        String requestId = request.getHeader("X-Request-ID");
        if (requestId == null || requestId.isBlank()) {
            requestId = UUID.randomUUID().toString();
        }

        MDC.put("requestId", requestId);
        response.setHeader("X-Request-ID", requestId);

        try {
            filterChain.doFilter(request, response);
        } finally {
            MDC.remove("requestId");
        }
    }
}
```

Prinsipnya:

> Nginx membuat request observable sejak boundary. Java menjaga request tetap observable sepanjang lifecycle aplikasi.

---

## 8. Mapping Nginx Timing ke Java Timing

Misalkan Nginx log:

```text
request_time=2.500 upstream_connect_time=0.001 upstream_header_time=2.300 upstream_response_time=2.480
```

Java log:

```text
requestId=abc123 durationMs=2290
```

Interpretasi:

- connect ke upstream cepat,
- Java mulai merespons setelah sekitar 2.3s,
- total Nginx membaca upstream selesai 2.48s,
- Java app mencatat 2.29s,
- selisih masuk akal untuk network/proxy overhead.

Sekarang kasus lain:

```text
request_time=10.000 upstream_connect_time=0.001 upstream_header_time=0.080 upstream_response_time=0.100
```

Java log:

```text
durationMs=70
```

Interpretasi:

- backend cepat,
- Nginx total request lama,
- kemungkinan client lambat membaca response atau upload request lambat,
- bisa juga response besar dan network client lambat.

Kasus berikut:

```text
request_time=5.002 upstream_connect_time=5.001 upstream_status="-"
```

Interpretasi:

- Nginx gagal connect ke upstream sampai timeout,
- request mungkin tidak pernah masuk aplikasi Java,
- cek upstream availability, port, firewall, listen address, container service, DNS.

Kasus retry:

```text
request_time=0.250 upstream_addr="10.0.1.10:8080, 10.0.1.11:8080" upstream_status="502, 200" upstream_response_time="0.003, 0.120"
```

Interpretasi:

- upstream pertama gagal cepat,
- Nginx retry ke upstream kedua,
- final response sukses,
- user tidak melihat error,
- tetapi cluster sedang punya hidden failure.

Alert yang hanya melihat final `$status` tidak akan menangkap ini.

Maka log upstream status harus diamati juga.

---

## 9. Status Code Penting dari Perspektif Nginx

### 9.1 `400 Bad Request`

Kemungkinan:

- malformed HTTP request,
- header terlalu besar,
- invalid Host,
- TLS/plain HTTP mismatch,
- client/proxy mengirim request rusak.

Debug:

- cek error log,
- cek request size/header size,
- cek client/proxy sebelum Nginx.

---

### 9.2 `403 Forbidden`

Kemungkinan:

- `deny all`,
- file permission,
- directory listing disabled,
- auth/access control gagal,
- static file path tidak bisa dibaca.

Debug:

- cek matching `location`,
- cek `allow/deny`,
- cek file ownership,
- cek SELinux/AppArmor,
- cek `root`/`alias`.

---

### 9.3 `404 Not Found`

Kemungkinan:

- static file tidak ada,
- `try_files` gagal,
- wrong `root`/`alias`,
- route SPA tidak fallback,
- request masuk server block salah,
- API path tidak diproxy.

Debug:

- cek `$server_name`, `$host`, `$request_uri`,
- cek `location` matching,
- cek effective config dengan `nginx -T`.

---

### 9.4 `413 Payload Too Large`

Kemungkinan:

- `client_max_body_size` terlalu kecil,
- upload endpoint belum dikecualikan,
- gateway policy tidak sesuai aplikasi.

Debug:

- cek directive level `http/server/location`,
- cek kebutuhan upload,
- cek apakah Java app juga punya limit sendiri.

---

### 9.5 `499 Client Closed Request`

Ini status khusus Nginx. Artinya client menutup koneksi sebelum Nginx selesai memproses response.

Kemungkinan:

- user menutup browser,
- mobile network buruk,
- client timeout lebih pendek dari backend,
- load balancer/CDN timeout,
- aplikasi Java terlalu lambat,
- response terlalu besar,
- streaming tidak dikonfigurasi benar.

`499` bukan selalu salah backend. Tapi jika naik tajam, sering berarti latency backend melewati timeout client.

Debug:

- bandingkan `request_time` dan `upstream_response_time`,
- lihat endpoint mana yang naik,
- cek client timeout,
- cek upstream latency,
- cek apakah ada deployment baru.

---

### 9.6 `502 Bad Gateway`

Kemungkinan:

- upstream down,
- connection refused,
- upstream reset connection,
- invalid response dari upstream,
- Java app crash,
- wrong port,
- DNS upstream error,
- TLS upstream mismatch.

Debug:

- cek error log,
- cek `$upstream_addr`, `$upstream_status`,
- curl upstream dari host Nginx,
- cek app logs,
- cek deployment/health.

---

### 9.7 `503 Service Unavailable`

Kemungkinan:

- no live upstream,
- rate limiting/custom maintenance,
- upstream marked unavailable,
- overload policy.

Debug:

- cek upstream state,
- cek rate limit logs,
- cek maintenance config,
- cek service discovery.

---

### 9.8 `504 Gateway Timeout`

Kemungkinan:

- upstream terlalu lama merespons,
- `proxy_read_timeout` tercapai,
- Java app stuck,
- DB/external dependency lambat,
- thread pool penuh,
- deadlock/GC pause.

Debug:

- cek `$upstream_response_time`,
- cek Java app p99,
- cek DB/external dependency,
- cek thread pool/GC,
- cek timeout budget.

---

## 10. Error Log: Untuk Menjawab “Kenapa”

Access log menjawab:

```text
Apa hasil request ini?
```

Error log menjawab:

```text
Kenapa Nginx gagal melakukan sesuatu?
```

Directive:

```nginx
error_log /var/log/nginx/error.log warn;
```

Level umum:

```text
debug
info
notice
warn
error
crit
alert
emerg
```

Production biasanya memakai `warn` atau `error`, tergantung noise dan kebutuhan.

Contoh error log:

```text
connect() failed (111: Connection refused) while connecting to upstream, client: 203.0.113.10, server: api.example.com, request: "GET /api/orders HTTP/1.1", upstream: "http://10.0.1.20:8080/api/orders", host: "api.example.com"
```

Interpretasi:

- Nginx mencoba connect ke upstream,
- upstream menolak koneksi,
- kemungkinan app tidak listen, port salah, container belum ready, service down.

Contoh:

```text
upstream timed out (110: Connection timed out) while reading response header from upstream
```

Interpretasi:

- Nginx sudah connect,
- menunggu response header dari upstream,
- upstream terlalu lama sebelum mengirim header,
- kemungkinan aplikasi Java lambat sebelum commit response.

Contoh:

```text
client intended to send too large body
```

Interpretasi:

- request ditolak di Nginx,
- Java app mungkin tidak melihat request sama sekali.

Contoh:

```text
open() "/usr/share/nginx/html/favicon.ico" failed (2: No such file or directory)
```

Interpretasi:

- static file tidak ditemukan,
- biasanya harmless jika sering, tapi bisa noisy.

Error log adalah sumber utama untuk root cause di sisi Nginx.

---

## 11. Debug Log: Gunakan dengan Hati-Hati

Nginx bisa diatur ke debug log jika dibangun dengan debug support.

Contoh:

```nginx
error_log /var/log/nginx/error.log debug;
```

Debug log bisa sangat verbose dan berisiko:

- volume besar,
- performa turun,
- storage cepat penuh,
- data sensitif bisa muncul,
- sulit dibaca jika traffic tinggi.

Pola aman:

1. jangan aktifkan debug global lama-lama,
2. aktifkan di environment staging dulu,
3. gunakan reproduksi traffic minimal,
4. aktifkan sementara di production hanya jika benar-benar perlu,
5. pastikan log rotation dan disk monitoring aman.

Untuk banyak kasus, `nginx -T`, access log lengkap, error log `warn/error`, dan `curl -v` sudah cukup.

---

## 12. Conditional Logging

Tidak semua request perlu dilog dengan level detail sama.

Contoh: tidak melog health check agar log tidak penuh.

```nginx
map $request_uri $loggable {
    default 1;
    /health 0;
    /ready  0;
}

access_log /var/log/nginx/access.log main_ext if=$loggable;
```

Atau hanya log request lambat?

Nginx open source tidak punya conditional numeric comparison langsung yang nyaman seperti `request_time > 1.0`, tetapi bisa memakai kombinasi `map`, app log, atau log pipeline filtering.

Pola umum:

- Nginx log semua request penting,
- pipeline melakukan filtering/agregasi,
- health check bisa dikecualikan,
- static asset bisa dipisahkan ke log berbeda.

Contoh memisahkan static asset log:

```nginx
location /assets/ {
    access_log /var/log/nginx/static-access.log static_ext;
    try_files $uri =404;
}

location /api/ {
    access_log /var/log/nginx/api-access.log api_ext;
    proxy_pass http://app_backend;
}
```

Kelebihan:

- API log lebih bersih,
- static volume tidak mengganggu analisis API latency,
- retention policy bisa berbeda.

---

## 13. Logging Cache Behavior

Jika memakai Nginx cache, log cache status.

```nginx
log_format cache_ext
    'time="$time_iso8601" '
    'host="$host" '
    'uri="$request_uri" '
    'status=$status '
    'cache="$upstream_cache_status" '
    'request_time=$request_time '
    'upstream_response_time="$upstream_response_time"';
```

`$upstream_cache_status` dapat bernilai seperti:

```text
MISS
BYPASS
EXPIRED
STALE
UPDATING
REVALIDATED
HIT
```

Interpretasi:

- `HIT`: response dari cache,
- `MISS`: cache tidak punya object, request ke upstream,
- `BYPASS`: policy memaksa tidak pakai cache,
- `STALE`: Nginx menyajikan stale object,
- `UPDATING`: object sedang diperbarui,
- `EXPIRED`: object expired dan di-refresh.

Cache tanpa observability berbahaya karena kamu tidak tahu:

- apakah cache efektif,
- apakah cache menyajikan stale terlalu sering,
- apakah cache key salah,
- apakah user-specific data masuk cache,
- apakah backend sebenarnya down tapi disembunyikan stale cache.

---

## 14. Logging Rate Limit and Access Control

Rate limiting dan access control harus observable.

Contoh log field:

```nginx
log_format api_ext
    'time="$time_iso8601" '
    'remote_addr="$remote_addr" '
    'request_id="$request_id" '
    'method="$request_method" '
    'uri="$request_uri" '
    'status=$status '
    'request_time=$request_time';
```

Ketika `limit_req` menolak request, status biasanya `503` secara default kecuali diubah:

```nginx
limit_req_status 429;
```

Rekomendasi untuk API:

```nginx
limit_req_status 429;
```

Agar log lebih bermakna:

- dashboard jumlah 429 per endpoint,
- jumlah 403 per admin/internal endpoint,
- jumlah 401 untuk Basic Auth,
- top IP/client token yang ditolak,
- korelasi dengan traffic spike.

Jangan hanya memasang rate limit tanpa melihat efeknya. Rate limit salah bisa memblokir user valid, terutama jika banyak client di balik NAT/CDN.

---

## 15. Sensitive Data: Apa yang Jangan Dilorog

Log adalah data produksi. Sering kali log menyebar ke banyak tempat:

- file server,
- log shipper,
- observability SaaS,
- archive object storage,
- developer dashboard,
- incident channel,
- export CSV.

Maka jangan sembarangan melog:

- `Authorization` header,
- session cookie,
- refresh token,
- access token,
- API key,
- password,
- OTP,
- full request body,
- query parameter sensitif,
- PII sensitif tanpa kebutuhan jelas,
- payment data.

Jangan lakukan ini:

```nginx
log_format unsafe
    'auth="$http_authorization" '
    'cookie="$http_cookie" '
    'uri="$request_uri"';
```

Masalah `$request_uri`:

```text
/reset-password?token=secret-token
/callback?code=oauth-code
/login?password=plaintext-by-bad-client
```

Bahkan URI bisa mengandung data sensitif.

Pilihan mitigasi:

1. jangan taruh secret di query parameter,
2. sanitasi di aplikasi dan gateway,
3. pisahkan endpoint sensitif dengan log minimal,
4. gunakan log pipeline redaction,
5. jangan log full cookie/authorization,
6. batasi akses ke log.

Contoh log minimal untuk auth endpoint:

```nginx
location /login {
    access_log /var/log/nginx/auth-access.log auth_minimal;
    proxy_pass http://app_backend;
}

log_format auth_minimal
    'time="$time_iso8601" '
    'remote_addr="$remote_addr" '
    'request_id="$request_id" '
    'method="$request_method" '
    'uri="$uri" '
    'status=$status '
    'request_time=$request_time';
```

Perhatikan penggunaan `$uri`, bukan `$request_uri`, untuk menghindari query string.

---

## 16. Log Rotation and Disk Safety

Nginx log dapat membesar sangat cepat.

Risiko:

- disk penuh,
- Nginx gagal write log,
- service lain terganggu,
- cache/temp file gagal,
- node menjadi unhealthy,
- incident sekunder.

Di Linux package umum, log rotation biasanya dikelola oleh `logrotate`.

Pola konseptual:

```text
/var/log/nginx/*.log {
    daily
    rotate 14
    compress
    missingok
    notifempty
    create 0640 www-data adm
    sharedscripts
    postrotate
        [ -s /run/nginx.pid ] && kill -USR1 `cat /run/nginx.pid`
    endscript
}
```

Nginx perlu diberi sinyal untuk reopen log file setelah rotation.

Sinyal umum:

```bash
nginx -s reopen
```

atau:

```bash
kill -USR1 $(cat /run/nginx.pid)
```

Di container, pola berbeda:

- lebih umum log ke stdout/stderr,
- log dikumpulkan oleh container runtime/log agent,
- rotation dilakukan di platform/container runtime,
- jangan menulis log besar ke filesystem ephemeral tanpa batas.

Contoh container-friendly:

```nginx
access_log /dev/stdout json_combined;
error_log  /dev/stderr warn;
```

---

## 17. Metrics: Dari Log ke Dashboard

Metrics menjawab pertanyaan agregat:

```text
Apakah sistem sehat sekarang?
```

Metrics penting untuk Nginx reverse proxy:

### Traffic

- requests per second,
- requests per host,
- requests per location/API group,
- bytes sent/received.

### Status

- 2xx rate,
- 3xx rate,
- 4xx rate,
- 5xx rate,
- 499 rate,
- 502/503/504 split.

### Latency

- request_time p50/p95/p99,
- upstream_response_time p50/p95/p99,
- upstream_connect_time,
- per-endpoint latency.

### Upstream

- upstream error rate,
- upstream retries,
- per-upstream traffic distribution,
- no live upstream events,
- connection refused/timeouts.

### Capacity

- active connections,
- reading/writing/waiting connections,
- worker connection utilization,
- file descriptor usage,
- CPU/memory/network/disk.

Nginx open source memiliki `stub_status` module untuk basic status.

Contoh:

```nginx
server {
    listen 127.0.0.1:8081;

    location /nginx_status {
        stub_status;
        allow 127.0.0.1;
        deny all;
    }
}
```

Output contoh:

```text
Active connections: 291
server accepts handled requests
 16630948 16630948 31070465
Reading: 6 Writing: 179 Waiting: 106
```

Interpretasi:

- active connections: koneksi aktif,
- accepts: accepted client connections,
- handled: handled connections,
- requests: total request,
- reading: sedang membaca request,
- writing: sedang menulis response,
- waiting: idle keepalive.

Keterbatasan:

- tidak memberi detail per upstream,
- tidak memberi histogram latency,
- tidak memberi route-level metrics,
- tidak cukup untuk observability lengkap.

Biasanya perlu log pipeline atau exporter seperti nginx-prometheus-exporter untuk mengambil stub status, ditambah log-based metrics.

---

## 18. Dashboard yang Berguna untuk Java Backend di Balik Nginx

Minimal dashboard produksi:

### 18.1 Overview

- total RPS,
- status class 2xx/3xx/4xx/5xx,
- 499 rate,
- p95/p99 request_time,
- p95/p99 upstream_response_time,
- top endpoint by traffic,
- top endpoint by error.

### 18.2 Upstream Health

- error rate per upstream address,
- upstream_status split,
- upstream_connect_time p95,
- upstream_response_time p95/p99,
- retry count pattern,
- traffic distribution per backend instance.

### 18.3 Client/Network

- top remote_addr or real client IP,
- top user agent,
- high 400/403/429 clients,
- request body too large count,
- slow client symptoms.

### 18.4 Security/Abuse

- 401/403/429 trend,
- suspicious path attempts,
- dotfile access attempts,
- admin endpoint denied attempts,
- invalid host traffic,
- unusual method distribution.

### 18.5 Cache

- cache hit ratio,
- cache status distribution,
- stale served count,
- cache bypass count,
- upstream saved by cache estimate.

### 18.6 Correlation with Java

- Nginx upstream_response_time vs Java app duration,
- Nginx 5xx vs Java 5xx,
- Nginx 504 vs Java slow endpoints,
- Nginx 499 vs client timeout/app latency,
- deployment markers.

Dashboard yang baik membantu menjawab:

```text
Apakah masalah di client, Nginx, network, Java app, atau downstream dependency?
```

---

## 19. Alerting: Yang Layak Dibangunkan

Alert yang buruk menghasilkan noise. Alert yang baik menunjuk failure nyata.

Contoh alert baik:

```text
5xx rate for api.example.com > 2% for 5 minutes
```

Lebih baik lagi:

```text
502 rate > 1% and upstream_connect_time p95 increased
```

Ini menunjukkan kemungkinan upstream connectivity/down.

Contoh:

```text
504 rate > 0.5% and upstream_response_time p99 > timeout budget
```

Kemungkinan aplikasi/downstream lambat.

Contoh:

```text
499 rate doubles from baseline and upstream_response_time p95 is high
```

Kemungkinan client timeout karena backend lambat.

Contoh alert buruk:

```text
Any 404 occurred
```

404 bisa normal.

Alert harus mempertimbangkan:

- baseline,
- rate, bukan hanya count,
- duration/window,
- endpoint criticality,
- status type,
- business impact.

Recommended alert groups:

| Alert | Kemungkinan Makna |
|---|---|
| 502 spike | upstream down/refused/reset |
| 503 spike | rate limit/no upstream/maintenance |
| 504 spike | backend timeout/downstream slow |
| 499 spike | client timeout/disconnect/latency issue |
| p99 request_time spike | user-facing latency degraded |
| upstream_connect_time spike | network/upstream accept issue |
| worker connections near limit | capacity risk |
| disk usage log partition high | operational risk |
| cert expiry approaching | availability/security risk |

---

## 20. Observability Contract Between Nginx and Java

A good production system defines a contract, not just config.

### 20.1 Headers Nginx Sends to Java

```nginx
proxy_set_header Host              $host;
proxy_set_header X-Real-IP         $remote_addr;
proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Request-ID      $request_id;
```

### 20.2 Java App Responsibilities

Java app should:

- read request ID,
- put it into MDC/log context,
- propagate it to downstream HTTP calls,
- include it in error logs,
- include it in structured application logs,
- ideally return it in response header,
- avoid generating unrelated ID unless missing.

### 20.3 Log Field Alignment

Nginx log:

```json
{
  "request_id": "abc123",
  "method": "GET",
  "host": "api.example.com",
  "request_uri": "/api/orders/123",
  "status": 200,
  "request_time": 0.120,
  "upstream_response_time": "0.110"
}
```

Java log:

```json
{
  "requestId": "abc123",
  "method": "GET",
  "path": "/api/orders/123",
  "status": 200,
  "durationMs": 105,
  "controller": "OrderController.getOrder"
}
```

Downstream service log:

```json
{
  "requestId": "abc123",
  "service": "payment-service",
  "durationMs": 40,
  "status": 200
}
```

This alignment enables trace-by-log even before full distributed tracing exists.

---

## 21. Practical Java Logging Integration

### 21.1 Spring Boot with MDC

Nginx sends:

```nginx
proxy_set_header X-Request-ID $request_id;
```

Spring filter:

```java
@Component
public class CorrelationLoggingFilter extends OncePerRequestFilter {

    private static final String HEADER = "X-Request-ID";

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain chain
    ) throws ServletException, IOException {
        String requestId = request.getHeader(HEADER);
        if (requestId == null || requestId.isBlank()) {
            requestId = UUID.randomUUID().toString();
        }

        MDC.put("requestId", requestId);
        response.setHeader(HEADER, requestId);

        long startNanos = System.nanoTime();
        try {
            chain.doFilter(request, response);
        } finally {
            long durationMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startNanos);
            MDC.put("durationMs", String.valueOf(durationMs));
            MDC.remove("durationMs");
            MDC.remove("requestId");
        }
    }
}
```

Logback pattern example:

```xml
<pattern>%d{ISO8601} %-5level [%thread] requestId=%X{requestId} %logger - %msg%n</pattern>
```

For structured JSON logging, use a JSON encoder and include MDC fields.

### 21.2 Propagating Downstream with RestClient/WebClient

Conceptual pattern:

```java
String requestId = MDC.get("requestId");

client.get()
    .uri("http://inventory-service/api/items/{id}", id)
    .header("X-Request-ID", requestId)
    .retrieve();
```

In production, do this via interceptor/filter, not manually in every call.

---

## 22. Log Sampling

High-volume systems may not be able to store every log forever.

Sampling strategies:

1. log all errors,
2. log all slow requests,
3. sample successful high-volume endpoints,
4. keep full logs for short retention,
5. keep aggregate metrics long-term,
6. preserve audit-critical logs separately.

Nginx native random sampling is limited, but you can:

- sample in log pipeline,
- split high-volume static/API logs,
- disable logs for noise endpoints,
- use conditional logs for health checks,
- use upstream/app logs for business events.

Never sample security/audit-critical logs blindly.

---

## 23. Common Observability Anti-Patterns

### Anti-Pattern 1: Only App Logs, No Nginx Logs

Problem:

- request rejected by Nginx invisible,
- upstream connect failures invisible in app,
- client disconnect invisible,
- routing mistake hard to see.

Better:

- access log at Nginx with request ID and upstream timing.

---

### Anti-Pattern 2: Logs Without Upstream Timing

Problem:

```text
status=504 request_time=60.001
```

But no idea whether:

- connect failed,
- upstream slow,
- client slow,
- retry happened.

Better:

- log upstream_connect_time, upstream_header_time, upstream_response_time, upstream_addr, upstream_status.

---

### Anti-Pattern 3: Logging Sensitive Headers

Problem:

```text
Authorization: Bearer eyJ...
Cookie: SESSION=...
```

Now secrets are in log storage.

Better:

- never log full auth/cookie headers,
- redact in pipeline,
- avoid sensitive query parameters.

---

### Anti-Pattern 4: No Request ID Propagation

Problem:

- cannot connect Nginx log and Java log,
- incident debugging becomes guesswork by timestamp.

Better:

- Nginx sends `X-Request-ID`, Java stores in MDC, downstream propagation.

---

### Anti-Pattern 5: Alert on Final 200 Only

Problem:

Final `200` may hide retry failures.

Example:

```text
upstream_status="502, 200"
status=200
```

Better:

- observe upstream_status separately,
- alert on retry/error patterns even if final status succeeds.

---

### Anti-Pattern 6: Treating 499 as Backend Error Only

Problem:

499 means client closed request. Backend may be slow, but root cause can also be client/network timeout.

Better:

- correlate 499 with upstream_response_time, request_time, endpoint, user agent, client region.

---

### Anti-Pattern 7: Health Checks Polluting Metrics

Problem:

Health checks dominate request count and hide real traffic patterns.

Better:

- separate or suppress health check logs,
- exclude health checks from user-facing latency/error dashboards.

---

## 24. Incident Debugging by Log Pattern

### Scenario A: Sudden 502 Spike

Look for:

```text
status=502
upstream_status="502"
upstream_addr="..."
```

Then error log:

```text
connect() failed (111: Connection refused)
```

Likely:

- app instance down,
- wrong port,
- deployment failed,
- service not ready.

Check:

```bash
curl -v http://10.0.1.20:8080/health
ss -lntp
systemctl status app
kubectl get pods
kubectl describe pod
```

---

### Scenario B: 504 Spike After Deployment

Access log:

```text
status=504 request_time=60.001 upstream_response_time="60.000"
```

Likely:

- backend regression,
- DB query slow,
- external call stuck,
- thread pool saturation,
- deadlock/GC pause.

Check:

- Java p99 latency,
- DB slow query,
- thread dump,
- GC log,
- deployment diff,
- dependency dashboard.

---

### Scenario C: User Reports Timeout, App Logs Show Success

Nginx:

```text
status=499 request_time=15.000 upstream_response_time="14.900"
```

Java:

```text
status=200 durationMs=14900
```

Interpretation:

- app eventually completed,
- client gave up before receiving response,
- from user perspective it failed.

Fix:

- reduce backend latency,
- align client timeout/server timeout,
- use async job for long operation,
- return 202 Accepted for long-running process.

---

### Scenario D: Nginx p99 High, Java p99 Normal

Nginx:

```text
request_time p99 = 8s
upstream_response_time p99 = 100ms
```

Likely:

- slow clients,
- large responses,
- upload body delay,
- network issue,
- CDN/LB behavior,
- buffering/send problem.

Check:

- bytes_sent distribution,
- client geography,
- user agent,
- response size,
- upload endpoints,
- network metrics.

---

### Scenario E: One Upstream Receives Most Traffic

Access log aggregation:

```text
10.0.1.20:8080 -> 80%
10.0.1.21:8080 -> 10%
10.0.1.22:8080 -> 10%
```

Likely:

- sticky algorithm,
- long-lived keepalive skew,
- weight mismatch,
- DNS/service discovery issue,
- subset of upstream unhealthy.

Check:

- upstream config,
- load balancing method,
- health of instances,
- keepalive behavior,
- deployment pool membership.

---

## 25. Example Full Observability-Oriented Config

```nginx
worker_processes auto;

events {
    worker_connections 4096;
}

http {
    log_format api_json escape=json
    '{'
        '"time":"$time_iso8601",'
        '"remote_addr":"$remote_addr",'
        '"realip_remote_addr":"$realip_remote_addr",'
        '"x_forwarded_for":"$http_x_forwarded_for",'
        '"request_id":"$request_id",'
        '"method":"$request_method",'
        '"scheme":"$scheme",'
        '"host":"$host",'
        '"server_name":"$server_name",'
        '"request_uri":"$request_uri",'
        '"uri":"$uri",'
        '"status":$status,'
        '"bytes_sent":$bytes_sent,'
        '"body_bytes_sent":$body_bytes_sent,'
        '"request_time":$request_time,'
        '"upstream_addr":"$upstream_addr",'
        '"upstream_status":"$upstream_status",'
        '"upstream_connect_time":"$upstream_connect_time",'
        '"upstream_header_time":"$upstream_header_time",'
        '"upstream_response_time":"$upstream_response_time",'
        '"cache_status":"$upstream_cache_status",'
        '"referer":"$http_referer",'
        '"user_agent":"$http_user_agent"'
    '}';

    map $request_uri $loggable {
        default 1;
        /health 0;
        /ready  0;
    }

    upstream app_backend {
        server 10.0.1.20:8080 max_fails=3 fail_timeout=10s;
        server 10.0.1.21:8080 max_fails=3 fail_timeout=10s;
        keepalive 64;
    }

    server {
        listen 443 ssl http2;
        server_name api.example.com;

        access_log /var/log/nginx/api-access.json api_json if=$loggable;
        error_log  /var/log/nginx/api-error.log warn;

        location /api/ {
            proxy_http_version 1.1;
            proxy_set_header Connection "";

            proxy_set_header Host              $host;
            proxy_set_header X-Real-IP         $remote_addr;
            proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header X-Request-ID      $request_id;

            proxy_connect_timeout 2s;
            proxy_send_timeout 30s;
            proxy_read_timeout 30s;

            proxy_pass http://app_backend;
        }
    }

    server {
        listen 127.0.0.1:8081;

        location /nginx_status {
            stub_status;
            allow 127.0.0.1;
            deny all;
        }
    }
}
```

Catatan:

- `access_log` memakai JSON escaped format,
- health/ready tidak dilog,
- request ID dikirim ke Java,
- upstream timing dicatat,
- stub status hanya expose ke localhost,
- timeout eksplisit,
- upstream keepalive disiapkan.

---

## 26. Production Checklist

Gunakan checklist ini sebelum menganggap Nginx observability cukup.

### Access Log

- [ ] Log format mencatat request ID.
- [ ] Log mencatat host/server_name.
- [ ] Log mencatat method dan request URI.
- [ ] Log mencatat final status.
- [ ] Log mencatat request_time.
- [ ] Log mencatat upstream_addr.
- [ ] Log mencatat upstream_status.
- [ ] Log mencatat upstream_connect_time.
- [ ] Log mencatat upstream_header_time.
- [ ] Log mencatat upstream_response_time.
- [ ] Log format aman untuk parsing.
- [ ] JSON log memakai `escape=json` jika diperlukan.

### Security

- [ ] Authorization header tidak dilog.
- [ ] Cookie tidak dilog penuh.
- [ ] Query parameter sensitif diminimalkan atau diredact.
- [ ] Log akses dibatasi.
- [ ] Retention log sesuai compliance.

### Correlation

- [ ] Nginx menghasilkan atau meneruskan request ID.
- [ ] Nginx mengirim `X-Request-ID` ke Java.
- [ ] Java memasukkan request ID ke MDC/log.
- [ ] Downstream call membawa request ID.
- [ ] Response menyertakan request ID jika policy mengizinkan.

### Metrics

- [ ] RPS terlihat.
- [ ] 4xx/5xx terlihat per host/service.
- [ ] 499 dipantau terpisah.
- [ ] 502/503/504 dipantau terpisah.
- [ ] p95/p99 request_time terlihat.
- [ ] p95/p99 upstream_response_time terlihat.
- [ ] upstream_connect_time dipantau.
- [ ] worker/connection status dipantau.
- [ ] disk usage log partition dipantau.

### Operations

- [ ] Log rotation aktif.
- [ ] Nginx reopen log setelah rotation.
- [ ] Container log diarahkan ke stdout/stderr jika sesuai platform.
- [ ] Health check tidak mencemari log utama.
- [ ] Error log level sesuai environment.
- [ ] Debug log tidak aktif permanen di production.

---

## 27. Latihan Praktis

### Latihan 1: Buat Log Format API

Buat `log_format` untuk API Java yang mencatat:

- time,
- request ID,
- method,
- host,
- request URI,
- status,
- request_time,
- upstream_addr,
- upstream_status,
- upstream_response_time,
- user agent.

Pastikan format bisa diparse oleh log pipeline.

---

### Latihan 2: Interpretasi Log

Diberikan log:

```text
status=504 request_time=30.001 upstream_connect_time="0.001" upstream_header_time="30.000" upstream_response_time="30.000"
```

Jawab:

1. Apakah request sampai ke aplikasi Java?
2. Apakah connect ke upstream berhasil?
3. Kemungkinan bottleneck di mana?
4. Data tambahan apa yang perlu dicari?

Jawaban yang diharapkan:

- request kemungkinan sampai ke upstream,
- connect berhasil cepat,
- upstream lambat mengirim response header,
- cek Java logs, DB, thread pool, GC, external dependency.

---

### Latihan 3: Interpretasi Retry

Diberikan:

```text
status=200 upstream_status="502, 200" upstream_addr="10.0.1.10:8080, 10.0.1.11:8080"
```

Jawab:

1. Apakah user melihat error?
2. Apakah sistem sehat?
3. Alert apa yang sebaiknya ada?

Jawaban:

- user kemungkinan melihat sukses,
- sistem tidak sepenuhnya sehat karena ada upstream gagal,
- alert pada upstream_status non-2xx/retry count, bukan hanya final status.

---

### Latihan 4: Redaksi Data Sensitif

Evaluasi apakah log berikut aman:

```nginx
log_format unsafe
    'uri="$request_uri" '
    'auth="$http_authorization" '
    'cookie="$http_cookie"';
```

Jawaban:

Tidak aman. Authorization dan cookie tidak boleh dilog. `$request_uri` juga dapat mengandung token di query string. Gunakan field minimal, redaction, atau `$uri` untuk endpoint sensitif.

---

## 28. Ringkasan Mental Model

Nginx observability bukan sekadar file log. Ia adalah cara melihat sistem dari boundary luar.

Ingat invariants berikut:

1. **Aplikasi Java hanya melihat request yang sampai ke aplikasi. Nginx melihat request yang gagal sebelum itu.**
2. **Final status tidak cukup. Upstream status bisa menceritakan failure tersembunyi.**
3. **`request_time` dan `upstream_response_time` menjawab pertanyaan berbeda.**
4. **`499` berarti client disconnect, bukan sekadar backend error.**
5. **Request ID adalah jembatan antara Nginx, Java app, dan downstream service.**
6. **Log tanpa redaksi bisa menjadi kebocoran data.**
7. **Metrics memberi sinyal agregat; log memberi bukti konkret.**
8. **Observability harus dirancang sebagai kontrak, bukan hasil samping konfigurasi.**

---

## 29. Koneksi ke Part Berikutnya

Bagian ini membangun dasar membaca perilaku Nginx di production.

Part berikutnya:

```text
Part 020 — Debugging Nginx Like a Production Engineer
```

Di sana kita akan memakai sinyal dari access log, error log, timing, dan status code untuk membangun metode debugging sistematis:

- `nginx -t`,
- `nginx -T`,
- reload vs restart,
- `curl -v`,
- `openssl s_client`,
- `dig`,
- `ss`,
- `lsof`,
- `tcpdump`,
- diagnosis 400/403/404/413/499/502/503/504,
- membaca effective config,
- menemukan config shadowing,
- membedakan masalah Nginx, network, dan Java app.

---

## 30. Status Seri

Selesai:

```text
Part 019 / 030
```

Seri belum selesai. Masih ada 11 bagian lagi:

```text
020 — Debugging Nginx Like a Production Engineer
021 — Nginx and Java Application Servers
022 — WebSocket, SSE, gRPC, and Long-Lived Connections
023 — Blue-Green, Canary, Shadow Traffic, and Progressive Delivery
024 — Nginx as Lightweight API Gateway
025 — Nginx in Containers and Kubernetes
026 — Stream Module: TCP/UDP Proxying for Non-HTTP Traffic
027 — Config Design Patterns for Large Systems
028 — Production Failure Modeling and Incident Playbooks
029 — Performance Lab: Benchmarking, Capacity Planning, and Tuning Experiments
030 — Capstone: Designing a Production-Grade Nginx Front Door for Java Microservices
```
