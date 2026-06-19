# learn-nginx-mastery-for-java-engineers-part-028.md

# Part 028 — Production Failure Modeling and Incident Playbooks

> Seri: **learn-nginx-mastery-for-java-engineers**  
> Bagian: **028 dari 030**  
> Topik: **Production Failure Modeling and Incident Playbooks**  
> Target pembaca: **Java software engineer / tech lead yang perlu mengoperasikan Nginx sebagai front door, reverse proxy, load balancer, TLS terminator, cache, dan traffic-control layer di production**

---

## 0. Posisi Part Ini Dalam Seri

Sampai titik ini, kita sudah membahas banyak komponen teknis Nginx:

- konfigurasi dasar,
- server selection,
- location matching,
- static file serving,
- reverse proxy,
- proxy headers,
- upstream dan load balancing,
- timeout, retry, buffering, backpressure,
- connection tuning,
- TLS,
- HTTP/2, HTTP/3, gRPC,
- compression,
- cache,
- rate limiting,
- access control,
- hardening,
- observability,
- debugging,
- Java runtime interaction,
- long-lived connections,
- progressive delivery,
- API gateway ringan,
- container/Kubernetes,
- stream module,
- config design patterns.

Part ini menyatukan semuanya ke dalam satu kemampuan yang lebih tinggi: **failure modeling**.

Tujuan part ini bukan membuat kamu hafal semua error code, tetapi membuat kamu mampu menjawab pertanyaan production seperti:

- “Apakah masalahnya di client, CDN, Nginx, upstream Java app, database, DNS, TLS, network, atau config?”
- “Apakah ini outage penuh, degradasi parsial, atau hanya satu route?”
- “Apa mitigasi paling aman dalam 5 menit pertama?”
- “Apa yang tidak boleh dilakukan karena bisa memperbesar blast radius?”
- “Sinyal apa yang membedakan 502 karena upstream down vs 502 karena DNS vs 502 karena TLS upstream?”
- “Apakah reload config aman?”
- “Apakah retry di Nginx sedang membantu atau justru menciptakan retry storm?”
- “Apakah 499 berarti client bermasalah, backend lambat, atau timeout budget salah?”
- “Apakah solusi permanennya ada di Nginx, Java app, database, deployment pipeline, atau observability?”

Di level senior, incident response bukan hanya kemampuan command-line. Incident response adalah kemampuan membentuk **model sebab-akibat** di bawah tekanan.

---

## 1. Mental Model Utama: Nginx Sebagai Boundary, Bukan Sekadar Komponen

Dalam arsitektur production, Nginx sering duduk di boundary seperti ini:

```text
Client / Browser / Mobile / Partner
        |
        v
DNS / CDN / Cloud LB / WAF
        |
        v
Nginx
        |
        +--> Static assets / SPA
        |
        +--> Java API service A
        |
        +--> Java API service B
        |
        +--> WebSocket / SSE / gRPC backend
        |
        +--> Internal admin / metrics / actuator
```

Nginx melihat banyak hal yang tidak selalu terlihat oleh aplikasi:

- koneksi client yang putus,
- request yang terlalu besar,
- TLS handshake,
- Host/SNI mismatch,
- upstream tidak bisa dikoneksi,
- upstream terlalu lambat,
- upstream mengembalikan status tertentu,
- rate limit yang menolak traffic,
- cache hit/miss/stale,
- header forwarding,
- routing decision,
- timeout antar boundary.

Karena itu, ketika production bermasalah, Nginx sering menjadi **saksi pertama**. Tetapi saksi pertama belum tentu pelaku utama.

Kesalahan umum saat incident adalah langsung menyimpulkan:

> “Nginx error, berarti Nginx rusak.”

Padahal Nginx bisa saja hanya melaporkan bahwa:

- upstream Java app mati,
- DNS tidak resolve,
- upstream overloaded,
- client abort,
- request body terlalu besar,
- certificate salah,
- network policy memblokir koneksi,
- config route tidak cocok,
- deployment baru mengubah path,
- application readiness salah,
- database lambat membuat backend tidak merespons.

Jadi mental model yang lebih tepat:

> **Nginx adalah boundary observability dan control point. Ia bisa menjadi sumber masalah, tetapi sering kali juga hanya memperlihatkan masalah dari layer lain.**

---

## 2. Incident Response Mindset

Saat incident, tujuan pertama bukan mencari akar masalah sempurna.

Tujuan pertama adalah:

1. **melindungi user impact,**
2. **menahan blast radius,**
3. **mengembalikan service ke kondisi aman,**
4. **mengumpulkan bukti cukup,**
5. **menghindari perubahan panik yang memperparah kondisi.**

Root cause analysis mendalam bisa dilakukan setelah kondisi stabil.

### 2.1 Mode Berpikir Saat Incident

Gunakan urutan ini:

```text
1. What changed?
2. What is affected?
3. What is not affected?
4. What is the fastest safe mitigation?
5. What evidence must be preserved?
6. What permanent fix prevents recurrence?
```

Pertanyaan “what changed?” sangat kuat karena banyak incident production dipicu oleh perubahan:

- deploy aplikasi,
- deploy config Nginx,
- certificate rotation,
- DNS change,
- Kubernetes rollout,
- cloud load balancer update,
- firewall/security group change,
- autoscaling event,
- dependency outage,
- traffic spike,
- bot attack,
- feature flag,
- database migration,
- cache invalidation,
- rate limit tuning,
- logging change yang memenuhi disk.

Tetapi jangan terlalu sempit. Ada juga incident tanpa perubahan internal langsung:

- upstream dependency down,
- cert issuer problem,
- regional network issue,
- sudden traffic pattern shift,
- client release bug,
- abuse traffic,
- expired domain/certificate,
- disk penuh karena log growth.

---

## 3. Failure Taxonomy: Mengelompokkan Masalah Sebelum Men-debug Detail

Sebelum masuk command, kelompokkan failure berdasarkan lokasi.

```text
Client-side failure
DNS / routing failure
TLS / certificate failure
CDN / cloud LB / WAF failure
Nginx config failure
Nginx resource failure
Nginx routing failure
Nginx upstream connectivity failure
Java application failure
Database / downstream dependency failure
Network / firewall / service discovery failure
Cache / stale data failure
Deployment / release failure
Observability / logging failure
```

Taxonomy ini membantu menghindari debugging acak.

---

## 4. Request Journey Sebagai Failure Map

Gunakan request journey untuk menempatkan gejala.

```text
[1] User initiates request
        |
[2] DNS resolution
        |
[3] TCP connection to edge
        |
[4] TLS handshake / SNI / ALPN
        |
[5] CDN / WAF / LB processing
        |
[6] TCP connection to Nginx
        |
[7] Nginx selects server block
        |
[8] Nginx selects location
        |
[9] Nginx applies access/rate/body/header rules
        |
[10] Nginx serves static/cache OR proxies upstream
        |
[11] Nginx connects to Java upstream
        |
[12] Java app accepts request
        |
[13] Java app calls database/dependency
        |
[14] Response returns through same chain
```

Setiap tahap punya failure signature.

| Tahap | Contoh gejala | Kemungkinan sumber |
|---|---|---|
| DNS | domain tidak resolve | DNS record, TTL, registrar, resolver |
| TCP edge | connection refused/timeout | LB, firewall, route, Nginx down |
| TLS | certificate error, handshake failure | cert expired, SNI mismatch, protocol/cipher |
| server selection | wrong domain served | `server_name`, default server, Host/SNI mismatch |
| location | 404/403 unexpected | location precedence, `root`, `alias`, `try_files` |
| access/rate limit | 401/403/429 | auth, allow/deny, limit zones |
| body/header limits | 400/413/414/431 | size limits, client behavior |
| upstream connect | 502 | backend down, port wrong, DNS, network |
| upstream timeout | 504 | app slow, dependency slow, timeout too low |
| client abort | 499 | client timeout, app slow, network, browser cancel |
| overload | mixed 499/502/504/latency | backend saturation, FD exhaustion, retry storm |

---

## 5. Golden Signals Untuk Nginx Incident

Minimal, kamu perlu melihat:

1. **Traffic volume**
   - request per second,
   - per route,
   - per host,
   - per client group.

2. **Error rate**
   - 4xx,
   - 5xx,
   - Nginx-generated vs upstream-generated.

3. **Latency**
   - total request time,
   - upstream connect time,
   - upstream header time,
   - upstream response time.

4. **Saturation**
   - active connections,
   - worker connections,
   - file descriptors,
   - CPU,
   - memory,
   - disk,
   - network.

5. **Upstream health**
   - selected upstream,
   - upstream status,
   - failed attempts,
   - retry behavior.

6. **Config state**
   - current effective config,
   - last reload time,
   - config diff,
   - syntax test result.

Tanpa ini, incident response akan cenderung spekulatif.

---

## 6. Access Log Format Untuk Incident Response

Sebelum incident terjadi, pastikan log format cukup kaya.

Contoh format text:

```nginx
log_format main_ext
  '$remote_addr - $remote_user [$time_local] '
  '"$request" $status $body_bytes_sent '
  '"$http_referer" "$http_user_agent" '
  'host="$host" server="$server_name" '
  'request_id="$request_id" '
  'request_time=$request_time '
  'upstream_addr="$upstream_addr" '
  'upstream_status="$upstream_status" '
  'upstream_connect_time="$upstream_connect_time" '
  'upstream_header_time="$upstream_header_time" '
  'upstream_response_time="$upstream_response_time" '
  'cache_status="$upstream_cache_status" '
  'xff="$http_x_forwarded_for"';

access_log /var/log/nginx/access.log main_ext;
```

Contoh format JSON:

```nginx
log_format json_ext escape=json
  '{'
    '"time":"$time_iso8601",'
    '"remote_addr":"$remote_addr",'
    '"request":"$request",'
    '"method":"$request_method",'
    '"uri":"$request_uri",'
    '"status":$status,'
    '"bytes_sent":$body_bytes_sent,'
    '"host":"$host",'
    '"server_name":"$server_name",'
    '"request_id":"$request_id",'
    '"request_time":$request_time,'
    '"upstream_addr":"$upstream_addr",'
    '"upstream_status":"$upstream_status",'
    '"upstream_connect_time":"$upstream_connect_time",'
    '"upstream_header_time":"$upstream_header_time",'
    '"upstream_response_time":"$upstream_response_time",'
    '"cache_status":"$upstream_cache_status",'
    '"user_agent":"$http_user_agent",'
    '"referer":"$http_referer",'
    '"xff":"$http_x_forwarded_for"'
  '}';

access_log /var/log/nginx/access.json json_ext;
```

Field penting untuk incident:

| Field | Manfaat |
|---|---|
| `$status` | status yang dikirim Nginx ke client |
| `$request_time` | total waktu request dari perspektif Nginx |
| `$upstream_status` | status dari upstream, bisa berbeda dari `$status` |
| `$upstream_addr` | backend mana yang dipilih |
| `$upstream_connect_time` | waktu connect ke upstream |
| `$upstream_header_time` | waktu sampai header upstream diterima |
| `$upstream_response_time` | waktu response upstream |
| `$request_id` | korelasi dengan Java logs |
| `$host` | Host header dari client |
| `$server_name` | server block yang menang |
| `$upstream_cache_status` | HIT/MISS/BYPASS/STALE, jika cache dipakai |

### Interpretasi Cepat Timing

| Pola | Kemungkinan |
|---|---|
| `upstream_connect_time` tinggi | network, backend accept queue, SYN backlog, overloaded target |
| `upstream_connect_time` kosong | tidak proxy ke upstream, request ditolak/served local, atau upstream tidak tercapai sebelum connect |
| `upstream_header_time` tinggi | aplikasi menerima request tapi lambat menghasilkan header |
| `upstream_response_time` tinggi | response body lambat/streaming/dependency lambat |
| `request_time` jauh lebih tinggi dari upstream time | client lambat, buffering, upload/download lambat |
| upstream status beberapa nilai seperti `502, 200` | ada retry ke upstream lain |

---

## 7. Error Log: Sinyal Kualitatif

Access log menjawab “apa yang terjadi pada request”. Error log menjawab “apa yang rusak di dalam proses”.

Contoh pattern error log yang penting:

```text
connect() failed (111: Connection refused) while connecting to upstream
```

Makna:

- Nginx bisa resolve target,
- TCP connect sampai ke host/port,
- tetapi tidak ada proses yang listen atau koneksi ditolak.

Kemungkinan:

- Java app mati,
- port salah,
- container belum ready,
- service endpoint stale,
- app restart,
- firewall actively rejecting.

---

```text
upstream timed out (110: Connection timed out) while reading response header from upstream
```

Makna:

- koneksi ke upstream berhasil,
- request dikirim,
- upstream tidak mengirim response header sebelum `proxy_read_timeout`.

Kemungkinan:

- Java thread pool habis,
- database lambat,
- deadlock,
- GC pause,
- dependency lambat,
- timeout Nginx terlalu pendek untuk endpoint tersebut,
- endpoint melakukan blocking operation terlalu lama.

---

```text
no live upstreams while connecting to upstream
```

Makna:

- semua server dalam upstream group dianggap unavailable oleh mekanisme passive failure atau tidak tersedia.

Kemungkinan:

- semua backend down,
- `max_fails`/`fail_timeout` terlalu agresif,
- deploy mengganti semua instance sekaligus,
- network partition,
- health/readiness buruk.

---

```text
client intended to send too large body
```

Makna:

- request body melebihi `client_max_body_size`.

Kemungkinan:

- upload file lebih besar dari limit,
- limit salah untuk endpoint tertentu,
- client abuse,
- frontend tidak melakukan validation.

---

```text
open() "/path/to/file" failed (2: No such file or directory)
```

Makna:

- static file lookup gagal.

Kemungkinan:

- path `root`/`alias` salah,
- build artifact tidak ada,
- route SPA tidak memakai fallback tepat,
- deployment tidak membawa file.

---

```text
SSL_do_handshake() failed
```

Makna:

- TLS handshake gagal.

Kemungkinan:

- protocol/cipher mismatch,
- client lama,
- certificate/SNI issue,
- mTLS client cert issue,
- bot/noise traffic.

---

## 8. Memisahkan Nginx-generated Error vs Upstream-generated Error

Status 500 dari client belum tentu dibuat Nginx.

Ada tiga kemungkinan besar:

```text
Client sees 5xx
  |
  +-- generated by Nginx before upstream
  |
  +-- generated by Nginx while contacting upstream
  |
  +-- returned by upstream Java app and passed through by Nginx
```

Cara membedakan:

- Lihat `$upstream_status`.
- Lihat error log.
- Lihat response body/error page.
- Lihat apakah Java app log punya request ID yang sama.
- Lihat apakah status muncul pada route static/local Nginx atau hanya proxied route.

Contoh interpretasi:

| `$status` | `$upstream_status` | Makna mungkin |
|---|---:|---|
| 500 | 500 | upstream Java mengembalikan 500 |
| 502 | kosong | Nginx gagal sebelum mendapat status upstream |
| 502 | 502 | upstream sendiri mengembalikan 502, atau intermediate proxy |
| 504 | kosong/504 | timeout di Nginx atau upstream intermediate |
| 404 | kosong | Nginx tidak menemukan static/location |
| 404 | 404 | Java app mengembalikan 404 |
| 429 | kosong | Nginx rate limit |
| 413 | kosong | Nginx body size limit |

---

## 9. Incident Triage: 10 Menit Pertama

Saat alarm berbunyi, gunakan checklist ini.

### 9.1 Tetapkan Scope

Tanya:

- Semua domain atau satu domain?
- Semua route atau route tertentu?
- Semua region atau satu region?
- Semua user atau sebagian user?
- Semua backend atau satu upstream?
- Browser saja atau API client juga?
- HTTP saja atau WebSocket/gRPC juga?
- Traffic baru atau existing connection?
- Setelah deploy/config change atau tanpa perubahan jelas?

### 9.2 Lihat Error Distribution

Command contoh:

```bash
# Top status code from recent access log
awk '{print $9}' /var/log/nginx/access.log | sort | uniq -c | sort -nr | head
```

Untuk format custom, lebih baik gunakan log pipeline/observability tool. Tetapi saat emergency di host, command sederhana tetap berguna.

### 9.3 Lihat Error Log Terbaru

```bash
sudo tail -n 200 /var/log/nginx/error.log
```

Atau:

```bash
sudo journalctl -u nginx -n 200 --no-pager
```

### 9.4 Validasi Nginx Hidup

```bash
systemctl status nginx --no-pager
ps aux | grep nginx
ss -ltnp | grep nginx
```

### 9.5 Validasi Config Aktif

```bash
sudo nginx -t
sudo nginx -T | less
```

`nginx -T` penting karena menampilkan effective config termasuk include.

### 9.6 Validasi Local Request ke Nginx

```bash
curl -v http://127.0.0.1/
curl -vk https://127.0.0.1/ -H 'Host: example.com'
```

### 9.7 Validasi Upstream Langsung Dari Host Nginx

```bash
curl -v http://127.0.0.1:8080/actuator/health
curl -v http://app-service:8080/actuator/health
nc -vz app-service 8080
```

Jika direct upstream gagal dari host Nginx, masalah kemungkinan bukan location matching, melainkan upstream availability/network/DNS.

### 9.8 Cek Resource

```bash
df -h
free -m
top
ulimit -n
cat /proc/$(cat /run/nginx.pid)/limits
ss -s
```

---

## 10. Status Code Playbook

Bagian ini adalah playbook status code yang sering muncul di Nginx incident.

---

# 10.1 Playbook: 400 Bad Request

## Gejala

Client melihat:

```text
400 Bad Request
```

## Kemungkinan

- Host header invalid.
- Request line terlalu besar.
- Header terlalu besar.
- TLS request dikirim ke HTTP port.
- HTTP request dikirim ke HTTPS port.
- Malformed request dari bot/client.
- Proxy/CDN mengirim header tidak sesuai.
- Client memakai karakter illegal pada URI.

## Cek Cepat

```bash
sudo tail -n 100 /var/log/nginx/error.log
```

Cari pattern:

```text
client sent invalid host header
client sent too long header line
client sent invalid request
```

## Diagnosis

Jika 400 hanya terjadi pada subset client:

- cek User-Agent,
- cek CDN/proxy path,
- cek ukuran cookie,
- cek header custom,
- cek request line.

Cookie terlalu besar sering membuat header melewati buffer limit.

## Mitigasi

Tergantung penyebab:

- kurangi ukuran cookie,
- sesuaikan `large_client_header_buffers`,
- perbaiki client/proxy,
- pastikan HTTP/HTTPS port benar,
- blokir malformed traffic jika abuse.

## Jangan Langsung

Jangan langsung menaikkan buffer sangat besar tanpa memahami sumbernya. Header besar bisa menjadi vektor abuse dan meningkatkan memory pressure.

---

# 10.2 Playbook: 401 Unauthorized

## Gejala

Endpoint meminta authentication.

## Kemungkinan

- Basic Auth aktif.
- Auth request/subrequest gagal.
- Upstream app mengembalikan 401.
- Header Authorization tidak diteruskan.
- CDN/WAF menghapus Authorization header.
- CORS preflight terkena auth rule.

## Cek

Lihat perbedaan:

```text
$status vs $upstream_status
```

Jika `$upstream_status` kosong, kemungkinan Nginx yang menghasilkan 401.

## Mitigasi

- Pastikan `auth_basic` hanya di location yang tepat.
- Pastikan `Authorization` diteruskan jika backend butuh.
- Exclude preflight `OPTIONS` jika desain API mengharuskannya.
- Jangan bypass auth global tanpa scoping.

---

# 10.3 Playbook: 403 Forbidden

## Gejala

Client melihat forbidden.

## Kemungkinan

- `deny all` / IP allowlist.
- File permission tidak cukup.
- Directory index forbidden.
- `internal` location diakses langsung.
- Static root salah.
- SELinux/AppArmor.
- Upstream Java app mengembalikan 403.

## Cek

```bash
sudo tail -n 100 /var/log/nginx/error.log
```

Pattern:

```text
directory index of ... is forbidden
permission denied
access forbidden by rule
```

## Mitigasi

- Perbaiki location access rule.
- Perbaiki permission file.
- Pastikan `index` benar.
- Jangan `chmod 777` sebagai solusi panik.
- Jika endpoint internal, validasi bahwa 403 memang expected.

---

# 10.4 Playbook: 404 Not Found

## Gejala

Route tertentu 404.

## Kemungkinan

- Wrong `server` block.
- Wrong `location` match.
- `root`/`alias` salah.
- SPA fallback tidak tepat.
- API route tertangkap static location.
- Upstream app memang return 404.
- Deployment artifact hilang.

## Cek

Gunakan Host eksplisit:

```bash
curl -v http://127.0.0.1/some/path -H 'Host: example.com'
```

Cek log field:

```text
host, server_name, uri, status, upstream_status
```

Jika `$upstream_status` kosong, 404 dibuat Nginx.

## Mitigasi

- Perbaiki `server_name`/default server.
- Perbaiki location precedence.
- Perbaiki `try_files`.
- Perbaiki path artifact.

## SPA Trap

Konfigurasi SPA yang benar biasanya:

```nginx
location / {
    try_files $uri $uri/ /index.html;
}

location /api/ {
    proxy_pass http://backend;
}
```

Tetapi hati-hati: kalau `location /api/` tidak ada atau kalah oleh regex lain, API bisa jatuh ke `index.html` dan menyebabkan frontend menampilkan error aneh, bukan 404 jelas.

---

# 10.5 Playbook: 408 Request Timeout

## Gejala

Request timeout sebelum selesai diterima.

## Kemungkinan

- Client lambat mengirim request.
- Network buruk.
- Slowloris-style attack.
- Timeout terlalu agresif.

## Mitigasi

- Review `client_body_timeout` dan `client_header_timeout`.
- Gunakan rate/connection limiting.
- Pastikan upload besar punya endpoint khusus dengan limit dan timeout khusus.

---

# 10.6 Playbook: 413 Request Entity Too Large

## Gejala

Upload gagal.

## Kemungkinan

- `client_max_body_size` terlalu kecil.
- Endpoint upload tidak punya override.
- Proxy/CDN di depan Nginx punya limit lebih kecil.
- Java app punya limit multipart lebih kecil/besar tidak selaras.

## Cek

```bash
sudo grep -R "client_max_body_size" /etc/nginx
```

## Mitigasi

Scope limit per endpoint:

```nginx
location /api/uploads/ {
    client_max_body_size 50m;
    proxy_pass http://backend;
}

location /api/ {
    client_max_body_size 2m;
    proxy_pass http://backend;
}
```

Jangan menaikkan global limit tanpa alasan.

## Java Coordination

Selaraskan dengan:

- Spring Boot multipart max file size,
- servlet container max swallow size,
- application validation,
- storage backend limit.

---

# 10.7 Playbook: 414 URI Too Long

## Gejala

Request dengan URL panjang gagal.

## Kemungkinan

- Client mengirim data besar via query string.
- Filter/search kompleks memakai GET berlebihan.
- Tracking parameter terlalu banyak.
- Redirect loop menambah query berulang.

## Mitigasi

- Ubah endpoint menjadi POST untuk payload kompleks.
- Potong tracking parameter.
- Perbaiki redirect loop.
- Hati-hati menaikkan buffer karena bisa menyembunyikan desain API buruk.

---

# 10.8 Playbook: 429 Too Many Requests

## Gejala

User/API client terkena rate limit.

## Kemungkinan

- `limit_req` aktif.
- Key terlalu kasar, misalnya per IP di balik NAT.
- Burst terlalu kecil.
- Traffic legitimate meningkat.
- Bot/abuse.
- CDN menyebabkan semua client tampak dari IP yang sama karena real IP belum dikonfigurasi.

## Cek

- Field remote address.
- Header `X-Forwarded-For`.
- Rate limit zone/key.
- Distribusi 429 per IP/user/endpoint.

## Mitigasi

- Gunakan real client IP dengan benar.
- Gunakan key lebih tepat, misalnya API token jika tersedia.
- Pisahkan limit per endpoint.
- Tambahkan burst dengan hati-hati.
- Untuk abuse, blokir pattern spesifik.

## Trap

Jika Nginx berada di belakang cloud LB/CDN dan kamu belum mengonfigurasi trusted real IP, semua user bisa terlihat berasal dari satu IP proxy. Akibatnya rate limit menjadi tidak adil.

---

# 10.9 Playbook: 499 Client Closed Request

## Apa Itu 499?

499 adalah status non-standard yang dipakai Nginx untuk mencatat bahwa client menutup koneksi sebelum Nginx selesai mengirim response.

Ini bukan status HTTP yang dikirim ke client. Ini sinyal observability dari Nginx.

## Gejala

- 499 meningkat tajam.
- User melaporkan timeout/cancel/loading lama.
- Backend mungkin tetap memproses request meski client sudah pergi.

## Kemungkinan

- Backend Java lambat.
- Client/browser timeout lebih pendek dari server processing time.
- Mobile network buruk.
- CDN/LB timeout lebih pendek.
- User menekan refresh/cancel.
- Large download lambat.
- SSE/WebSocket timeout salah.
- Query database lambat.
- GC pause.
- Thread pool saturation.

## Diagnosis

Lihat:

```text
request_time
upstream_response_time
upstream_status
route
user_agent
client network segment
```

Pola penting:

| Pola 499 | Makna mungkin |
|---|---|
| `request_time` mendekati 30s/60s | timeout client/LB/CDN tertentu |
| 499 hanya endpoint tertentu | endpoint lambat/dependency lambat |
| 499 saat download | client/network lambat atau file besar |
| 499 + upstream tetap 200 di backend | backend selesai setelah client pergi |
| 499 + CPU/DB tinggi | overload menyebabkan user abandon |

## Mitigasi

- Perbaiki latency endpoint.
- Align timeout budget antar client, CDN, LB, Nginx, Java app.
- Tambahkan async cancellation awareness jika memungkinkan.
- Untuk endpoint lambat, gunakan job async + polling/callback.
- Untuk download besar, gunakan object storage/CDN jika tepat.

## Jangan Salah Kaprah

Jangan menyalahkan client terlalu cepat. 499 sering merupakan symptom bahwa server terlalu lambat untuk batas sabar client.

---

# 10.10 Playbook: 500 Internal Server Error

## Gejala

Client melihat 500.

## Kemungkinan

- Upstream Java app exception.
- Nginx internal error karena config/script/module.
- Error page handling salah.
- File permission untuk static/error page.

## Diagnosis

Cek `$upstream_status`.

- Jika `$upstream_status=500`, lihat Java logs.
- Jika kosong, lihat Nginx error log.

## Mitigasi

- Rollback app jika terkait deploy.
- Disable feature flag jika terkait fitur baru.
- Perbaiki error page config jika Nginx-generated.
- Jangan masking semua 500 menjadi 200/error HTML yang membingungkan API client.

---

# 10.11 Playbook: 502 Bad Gateway

## Apa Itu 502 Dalam Konteks Nginx?

502 biasanya berarti Nginx bertindak sebagai gateway/proxy dan mendapat kondisi invalid saat berbicara dengan upstream.

## Kemungkinan Besar

- Upstream Java app mati.
- Port salah.
- Connection refused.
- Upstream menutup koneksi prematur.
- Invalid response dari upstream.
- DNS upstream gagal.
- TLS ke upstream gagal.
- Protocol mismatch.
- Upstream crash saat memproses request.
- Keepalive connection stale.

## Error Log Pattern

```text
connect() failed (111: Connection refused) while connecting to upstream
```

Backend tidak menerima koneksi.

```text
upstream prematurely closed connection while reading response header from upstream
```

Backend menerima koneksi tetapi menutup sebelum mengirim header lengkap.

```text
no live upstreams while connecting to upstream
```

Semua upstream dianggap unavailable.

```text
host not found in upstream
```

DNS/config resolution issue.

## Cek Cepat

```bash
curl -v http://backend:8080/actuator/health
nc -vz backend 8080
sudo tail -n 100 /var/log/nginx/error.log
```

Jika Kubernetes:

```bash
kubectl get pods -o wide
kubectl get endpoints <service-name>
kubectl describe pod <pod>
kubectl logs <pod>
```

## Mitigasi

- Rollback deploy backend.
- Remove bad upstream instance.
- Fix service endpoint/readiness.
- Restart crashed app jika aman dan root cause sementara jelas.
- Increase graceful shutdown/drain correctness.
- Fix protocol mismatch: HTTP vs HTTPS, h2c vs HTTP/1.1, gRPC config.

## Trap

502 saat deployment sering terjadi karena readiness probe menganggap app ready sebelum benar-benar bisa serve traffic, atau Nginx masih mengirim ke instance yang sedang shutdown.

---

# 10.12 Playbook: 503 Service Unavailable

## Kemungkinan

- Nginx sengaja mengembalikan 503 untuk maintenance.
- Semua upstream unavailable.
- Rate/connection limiting tertentu bisa dikonfigurasi return 503.
- App overload mengembalikan 503.
- Circuit breaker di upstream/gateway.

## Diagnosis

Cek:

- `$upstream_status`,
- error log,
- config `return 503`,
- `limit_req_status`,
- upstream health,
- deployment status.

## Mitigasi

- Jika maintenance accidental, rollback config.
- Jika upstream unavailable, restore at least one healthy backend.
- Jika overload, shed load lebih selektif.
- Jika rate limit, return 429 lebih semantik untuk throttling.

---

# 10.13 Playbook: 504 Gateway Timeout

## Apa Itu 504?

Nginx berhasil menjadi proxy, tetapi upstream tidak merespons tepat waktu sesuai timeout.

## Kemungkinan

- Java app lambat.
- Database lambat.
- External dependency lambat.
- Thread pool saturated.
- Deadlock.
- GC pause.
- Network latency/packet loss.
- `proxy_read_timeout` terlalu pendek.
- Endpoint memang long-running tapi desain timeout tidak sesuai.

## Error Log Pattern

```text
upstream timed out (110: Connection timed out) while reading response header from upstream
```

## Diagnosis

Bandingkan:

- `$upstream_connect_time`,
- `$upstream_header_time`,
- `$upstream_response_time`,
- Java app latency,
- DB query latency,
- thread pool metrics,
- GC logs,
- dependency metrics.

## Mitigasi Cepat

- Rollback perubahan yang membuat endpoint lambat.
- Disable fitur berat.
- Scale backend jika bottleneck CPU/thread dan app scalable.
- Shed load endpoint mahal.
- Serve stale cache jika endpoint cacheable.
- Increase timeout hanya jika long-running valid dan resource impact dipahami.

## Jangan Langsung

Jangan sekadar menaikkan `proxy_read_timeout` dari 60s ke 600s. Itu bisa mengubah timeout menjadi resource leak dan memperparah thread starvation di backend.

---

## 11. Playbook: Sudden Spike 502 Setelah Deploy

### Gejala

- 502 melonjak tepat setelah deploy.
- Error log menunjukkan `connection refused` atau `upstream prematurely closed connection`.
- Beberapa request berhasil, beberapa gagal.

### Kemungkinan

- Rolling deploy tanpa readiness yang benar.
- Backend menerima traffic sebelum siap.
- Backend shutdown sebelum connection drain selesai.
- Port/container berubah.
- Health endpoint tetap 200 walau dependency penting belum siap.
- Nginx upstream list stale.
- Java app crash loop.

### Diagnosis

```bash
sudo tail -n 200 /var/log/nginx/error.log
curl -v http://backend:8080/actuator/health
```

Kubernetes:

```bash
kubectl rollout status deployment/<name>
kubectl get pods -o wide
kubectl get endpoints <service>
kubectl describe pod <pod>
kubectl logs <pod> --previous
```

### Mitigasi

1. Rollback deployment jika error berhubungan jelas dengan release.
2. Scale up known-good version jika memungkinkan.
3. Perbaiki readiness/liveness separation.
4. Tambahkan preStop hook dan graceful shutdown timeout.
5. Pastikan Nginx/load balancer berhenti mengirim ke instance yang terminating.

### Permanent Fix

- Readiness harus berarti “boleh menerima request production”.
- Liveness tidak boleh terlalu agresif sampai membunuh app saat dependency lambat sementara.
- Java graceful shutdown harus memberi waktu request selesai.
- Deployment harus punya maxUnavailable/maxSurge yang aman.
- Smoke test harus melewati path yang representatif, bukan hanya `/health` dummy.

---

## 12. Playbook: Rising 499 Tanpa 5xx Besar

### Gejala

- 499 naik.
- 5xx tidak terlalu tinggi.
- User mengeluh loading lama.

### Interpretasi

Server belum tentu “error”, tetapi user/client menyerah sebelum response selesai.

### Diagnosis

Lihat distribusi:

- route mana,
- request_time berapa,
- upstream_response_time berapa,
- apakah mendekati timeout tertentu,
- apakah terjadi pada mobile client,
- apakah terjadi setelah traffic spike,
- apakah endpoint melakukan query berat.

### Mitigasi

- Optimasi endpoint lambat.
- Tambahkan cache untuk response cacheable.
- Shed load endpoint mahal.
- Tambahkan pagination/limit.
- Ubah long-running synchronous operation menjadi async job.
- Align timeout budget.

### Permanent Fix

- SLO latency per endpoint.
- Alert pada p95/p99 latency, bukan hanya 5xx.
- Request cancellation propagation jika framework mendukung.
- Capacity test endpoint mahal.

---

## 13. Playbook: High 504 Pada Endpoint Tertentu

### Gejala

- 504 hanya pada `/api/reports/export` atau endpoint serupa.
- Endpoint lain sehat.

### Kemungkinan

- Query database berat.
- Report generation synchronous.
- Large response.
- Lock contention.
- Dependency lambat.
- Timeout Nginx lebih pendek dari processing time.

### Diagnosis

- Correlate request ID dengan Java logs.
- Lihat DB slow query.
- Lihat thread dump jika app stuck.
- Lihat GC pause.
- Lihat response size.

### Mitigasi

- Turunkan concurrency endpoint berat.
- Return 202 Accepted + async job.
- Cache hasil report.
- Precompute.
- Optimasi query.
- Endpoint-specific timeout hanya jika benar-benar diperlukan.

Contoh isolasi endpoint:

```nginx
location /api/reports/export {
    limit_req zone=reports burst=5 nodelay;
    proxy_read_timeout 180s;
    proxy_pass http://backend;
}

location /api/ {
    proxy_read_timeout 30s;
    proxy_pass http://backend;
}
```

Catatan: menaikkan timeout endpoint berat harus diimbangi limit concurrency agar tidak menghabiskan backend threads.

---

## 14. Playbook: Disk Full Karena Logs atau Cache

### Gejala

- Nginx tidak bisa write log.
- Reload gagal membuka log file.
- Cache write error.
- Host disk penuh.
- Aplikasi lain ikut gagal.

### Cek

```bash
df -h
sudo du -sh /var/log/nginx/* | sort -h
sudo du -sh /var/cache/nginx/* | sort -h
sudo lsof | grep deleted | head
```

### Kemungkinan

- Log rotation gagal.
- Debug log tertinggal aktif.
- Access log volume spike.
- Cache size tidak dibatasi.
- Deleted log file masih dipegang proses.
- Bot traffic menghasilkan log besar.

### Mitigasi

- Restore free space dengan aman.
- Reopen logs setelah rotation:

```bash
sudo nginx -s reopen
```

- Kurangi logging sementara secara scoped jika volume ekstrem.
- Batasi cache.
- Perbaiki logrotate.

### Jangan

Jangan asal `rm -rf` path cache/log tanpa memahami file yang masih dibuka proses. File yang sudah dihapus tetapi masih dipegang proses tidak langsung membebaskan disk sampai file descriptor ditutup.

---

## 15. Playbook: Config Reload Gagal

### Fakta Penting

Nginx reload tidak sekadar membaca file baru. Saat reload, master process mengecek syntax dan mencoba menerapkan konfigurasi baru, termasuk membuka log file dan listen socket baru. Jika gagal, Nginx tetap berjalan dengan konfigurasi lama.

Ini membuat reload relatif aman dibanding restart langsung, tetapi tetap perlu disiplin.

### Gejala

- `nginx -s reload` gagal.
- Perubahan tidak berlaku.
- Error di `nginx -t`.
- Service masih hidup tapi config baru tidak aktif.

### Cek

```bash
sudo nginx -t
sudo nginx -T > /tmp/nginx-effective.conf
sudo journalctl -u nginx -n 100 --no-pager
```

### Kemungkinan

- Syntax salah.
- Include file hilang.
- Certificate path salah.
- Permission file log/cert salah.
- Duplicate listen conflict.
- Variable/directive di context salah.
- Module tidak tersedia.

### Mitigasi

- Jangan restart paksa jika reload gagal dan service masih melayani traffic.
- Perbaiki config lalu test ulang.
- Rollback config file.
- Gunakan deployment atomic/symlink agar rollback cepat.

### Permanent Fix

- `nginx -t` wajib di CI/CD.
- `nginx -T` artifact untuk audit.
- Config review untuk directive context.
- Staging test dengan certificate/path mirip production.

---

## 16. Playbook: TLS Certificate Expired atau Salah Chain

### Gejala

- Browser warning certificate expired.
- API client gagal TLS handshake.
- Mobile app gagal connect.
- Hanya domain tertentu affected.

### Cek

```bash
openssl s_client -connect example.com:443 -servername example.com -showcerts </dev/null
```

Cek:

- expiry date,
- SAN domain,
- issuer,
- full chain,
- SNI behavior.

### Kemungkinan

- Certificate expired.
- Renewal job gagal.
- Nginx belum reload setelah cert renewal.
- Wrong cert served karena SNI/server block salah.
- Missing intermediate certificate.
- File permission cert/key salah.

### Mitigasi

- Install correct certificate chain.
- Validate `ssl_certificate` dan `ssl_certificate_key`.
- `nginx -t`.
- Reload Nginx.
- Test dengan SNI.

### Permanent Fix

- Certificate expiry alert minimal 30/14/7/3/1 hari.
- Renewal dry-run.
- Post-renew reload hook.
- Monitoring external TLS, bukan hanya local file expiry.

---

## 17. Playbook: Wrong Domain / Unknown Host Masuk Ke Aplikasi

### Gejala

- Domain asing menampilkan aplikasi.
- Request dengan Host salah tetap diproses.
- Security scan menemukan default vhost bocor.
- Redirect memakai domain aneh.

### Kemungkinan

- Default server mengarah ke aplikasi utama.
- Tidak ada catch-all server.
- `server_name _` disalahpahami.
- Host header tidak divalidasi.
- App memakai Host untuk generate URL tanpa whitelist.

### Mitigasi

Tambahkan catch-all defensif:

```nginx
server {
    listen 80 default_server;
    listen 443 ssl default_server;
    server_name _;

    ssl_certificate     /etc/nginx/certs/default.crt;
    ssl_certificate_key /etc/nginx/certs/default.key;

    return 444;
}
```

Atau return 400 jika ingin standar HTTP:

```nginx
return 400;
```

### Permanent Fix

- Default server tidak boleh proxy ke aplikasi utama.
- Aplikasi juga harus punya allowed host validation jika memakai Host-sensitive logic.
- Test Host header spoofing di pipeline/security test.

---

## 18. Playbook: Redirect Loop HTTP/HTTPS

### Gejala

- Browser error too many redirects.
- Login tidak selesai.
- Callback OAuth gagal.
- App redirect dari HTTPS ke HTTP lalu balik lagi.

### Kemungkinan

- Nginx terminates TLS, backend mengira request HTTP.
- Missing `X-Forwarded-Proto`.
- Java framework tidak trust forwarded headers.
- CDN/LB juga melakukan redirect.
- Multiple layers enforce HTTPS tidak konsisten.

### Nginx Config

```nginx
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host  $host;
proxy_set_header X-Forwarded-Port  $server_port;
```

Jika Nginx di belakang TLS-terminating LB, `$scheme` mungkin `http` dari LB ke Nginx. Dalam kasus itu, sumber truth harus jelas. Bisa berasal dari header trusted LB, bukan sembarang client.

### Java Coordination

Spring Boot misalnya perlu konfigurasi forwarded header strategy atau server forward headers sesuai versi/framework.

### Permanent Fix

- Definisikan satu layer canonical untuk HTTPS redirect.
- Definisikan forwarded header contract.
- App harus tahu original scheme secara trusted.
- Test redirect end-to-end dari public URL.

---

## 19. Playbook: Rate Limit Melumpuhkan User Legitimate

### Gejala

- 429 naik setelah konfigurasi rate limit.
- Banyak user corporate/NAT terkena.
- Semua request tampak berasal dari IP load balancer.

### Kemungkinan

- Real IP belum dikonfigurasi.
- Key rate limit terlalu kasar.
- Burst terlalu kecil.
- Endpoint chatty terkena limit sama dengan endpoint mahal.

### Mitigasi

- Perbaiki real IP trust boundary.
- Pisahkan limit berdasarkan endpoint.
- Gunakan token/user ID jika aman tersedia.
- Tambahkan burst.
- Log key limit untuk analisis.

### Permanent Fix

- Rate limit rollout bertahap: observe-only jika bisa, lalu enforce.
- Dashboard 429 per endpoint/key.
- Runbook bypass sementara yang scoped.

---

## 20. Playbook: Cache Menyajikan Data Salah atau Bocor

### Gejala

- User melihat data user lain.
- Response lama tetap muncul.
- Setelah deploy, content stale.
- API response tidak berubah meski backend sudah benar.

### Kemungkinan

- Cache key tidak memasukkan dimensi penting.
- Response personalized di-cache.
- Authorization/Cookie tidak di-bypass.
- Cache purge gagal.
- `Vary` tidak dihormati di layer lain.
- Stale cache aktif terlalu agresif.

### Dangerous Example

```nginx
proxy_cache_key "$scheme$request_method$host$request_uri";
```

Untuk endpoint yang hasilnya berbeda per user, key ini berbahaya jika tidak bypass berdasarkan auth/cookie.

### Mitigasi Cepat

- Disable cache untuk endpoint affected.
- Purge cache jika tersedia.
- Change cache key atau bypass condition.
- Add `Cache-Control: private, no-store` dari app untuk data sensitif.

### Safer Pattern

```nginx
proxy_no_cache     $http_authorization $cookie_session;
proxy_cache_bypass $http_authorization $cookie_session;
```

### Permanent Fix

- Cache eligibility review per endpoint.
- Contract: endpoint public cacheable vs private non-cacheable.
- Automated tests for authenticated response caching.
- Explicit cache headers from app.

---

## 21. Playbook: WebSocket Disconnect Berkala

### Gejala

- WebSocket putus setiap 60 detik.
- Chat/realtime app reconnect terus.
- Long-lived connection tidak stabil.

### Kemungkinan

- `proxy_read_timeout` terlalu pendek.
- Missing Upgrade headers.
- LB/CDN idle timeout.
- Backend tidak mengirim ping/heartbeat.
- Deployment drain membunuh connection.

### Config Dasar

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

location /ws/ {
    proxy_pass http://backend;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_read_timeout 3600s;
}
```

### Permanent Fix

- Heartbeat interval lebih pendek dari idle timeout terpendek di chain.
- Deployment drain strategy untuk long-lived connections.
- Metrics active WebSocket connections.
- Clear max connection lifetime policy.

---

## 22. Playbook: SSE Response Tertahan Sampai Selesai

### Gejala

- Server-Sent Events tidak muncul incremental.
- Client menerima event sekaligus setelah lama.
- Browser terlihat connected tetapi tidak update.

### Kemungkinan

- Proxy buffering aktif.
- Compression buffering.
- Backend tidak flush.
- CDN buffering.

### Mitigasi

```nginx
location /events/ {
    proxy_pass http://backend;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_cache off;
    gzip off;
    proxy_read_timeout 1h;
}
```

### Permanent Fix

- Dedicated route for streaming.
- Test actual streaming behavior, not just status code.
- Monitor connection count and duration.

---

## 23. Playbook: gRPC Failure Through Nginx

### Gejala

- gRPC client mendapat unavailable/internal.
- HTTP/1.1 route sehat, gRPC gagal.
- TLS/ALPN mismatch.

### Kemungkinan

- gRPC butuh HTTP/2.
- Menggunakan `proxy_pass` bukan `grpc_pass` untuk route gRPC.
- Nginx listen tidak HTTP/2.
- Upstream protocol salah: plaintext h2c vs TLS.
- Timeout streaming salah.

### Diagnosis

- Test dengan `grpcurl`.
- Cek ALPN dengan openssl.
- Cek Nginx config gRPC route.
- Cek upstream app gRPC port.

### Mitigasi

Pisahkan HTTP API dan gRPC route secara eksplisit.

---

## 24. Playbook: Worker Connections Exhausted

### Gejala

- Error log menunjukkan worker_connections tidak cukup.
- Banyak connection pending.
- Latency naik.
- Nginx tidak menerima connection baru.

### Kemungkinan

- Traffic spike.
- Keepalive terlalu lama.
- Long-lived connections terlalu banyak.
- File descriptor limit rendah.
- Slow clients.
- Upstream connections juga memakai FD.

### Cek

```bash
ss -s
sudo lsof -p $(cat /run/nginx.pid) | wc -l
cat /proc/$(cat /run/nginx.pid)/limits
```

### Mitigasi

- Naikkan `worker_connections` dan OS file descriptor limit secara terukur.
- Turunkan keepalive timeout jika terlalu tinggi.
- Pisahkan long-lived route.
- Scale horizontally.
- Rate/connection limit abusive clients.

### Permanent Fix

- Capacity model: client connections + upstream connections + files + logs.
- Alert pada active/waiting connections.
- Load test untuk long-lived connection mix.

---

## 25. Playbook: Nginx CPU Tinggi

### Gejala

- CPU Nginx tinggi.
- Latency naik.
- Backend tidak selalu penuh.

### Kemungkinan

- TLS handshake storm.
- Compression terlalu agresif.
- Regex location/map kompleks.
- Logging sangat berat.
- High RPS static/proxy.
- Bot traffic.
- Debug log aktif.
- Cache thrashing.

### Diagnosis

- Lihat traffic volume.
- Lihat TLS handshakes/new connections.
- Lihat compression ratio/CPU.
- Cek debug log.
- Cek top endpoints.

### Mitigasi

- Enable keepalive.
- Offload/caching static assets ke CDN jika tepat.
- Kurangi compression level.
- Matikan debug log.
- Block abusive traffic.
- Scale Nginx.

---

## 26. Playbook: Memory Tinggi

### Kemungkinan

- Buffer besar.
- Banyak concurrent request.
- Large headers/body buffering.
- Cache metadata/shared zones.
- Third-party module leak.
- Long-lived connections.

### Mitigasi

- Review buffer directives.
- Limit body/header size.
- Control concurrency.
- Avoid global oversized buffers.
- Restart workers only jika leak jelas dan mitigasi sementara dibutuhkan.

---

## 27. Playbook: DNS / Service Discovery Failure

### Gejala

- Nginx tidak bisa resolve upstream.
- 502 muncul setelah service name/IP berubah.
- Container/Kubernetes service berubah tapi Nginx masih ke IP lama.

### Kemungkinan

- DNS resolver tidak dikonfigurasi untuk dynamic upstream.
- Nginx resolve hostname saat startup/reload saja pada config tertentu.
- Kubernetes DNS issue.
- TTL behavior tidak sesuai ekspektasi.
- Service endpoint kosong.

### Diagnosis

```bash
getent hosts backend
nslookup backend
curl -v http://backend:8080/health
sudo nginx -T | grep resolver -n
```

Kubernetes:

```bash
kubectl get svc
kubectl get endpoints
kubectl get endpointslice
```

### Mitigasi

- Reload Nginx jika upstream IP berubah dan config static resolve.
- Gunakan service stable name.
- Pastikan resolver config tepat jika dynamic resolution diperlukan.
- Perbaiki Kubernetes service selector/readiness.

---

## 28. Playbook: Config Change Menyebabkan Outage

### Gejala

- Incident mulai tepat setelah config deploy.
- `nginx -t` mungkin sukses, tetapi behavior salah.
- Route, header, timeout, cache, atau security berubah.

### Jenis Config Bug

- Syntax valid tapi semantic wrong.
- Location precedence berubah.
- Include order berubah.
- Default server berubah.
- Header forwarding hilang.
- Cache accidentally enabled.
- Rate limit terlalu agresif.
- Timeout terlalu pendek.
- `proxy_pass` trailing slash berubah.

### Mitigasi

- Rollback config ke known-good.
- Gunakan `nginx -T` untuk compare effective config.
- Test affected route dengan Host/path/header spesifik.

### Permanent Fix

- Config diff review.
- Golden test cases:
  - domain routing,
  - API proxy,
  - static fallback,
  - auth endpoint,
  - upload endpoint,
  - WebSocket/SSE/gRPC,
  - cache bypass,
  - rate limit behavior.
- Canary config deployment jika infrastructure mendukung.

---

## 29. Incident Decision Tree

Gunakan decision tree ini saat melihat error spike.

```text
Error spike detected
  |
  +-- Is Nginx process up and listening?
  |      |
  |      +-- No  -> process/service/resource/config issue
  |      +-- Yes -> continue
  |
  +-- Is it all hosts or one host?
  |      |
  |      +-- all -> global config/LB/network/resource/upstream fleet
  |      +-- one -> server_name/SNI/domain-specific config/cert
  |
  +-- Is upstream_status present?
  |      |
  |      +-- No  -> Nginx local decision/error before upstream
  |      +-- Yes -> upstream involved
  |
  +-- Is upstream_connect_time high/failing?
  |      |
  |      +-- Yes -> network/backend accept/port/service discovery
  |      +-- No  -> continue
  |
  +-- Is upstream_header_time high?
  |      |
  |      +-- Yes -> app/dependency/thread/GC/DB latency
  |      +-- No  -> continue
  |
  +-- Is request_time much higher than upstream_response_time?
  |      |
  |      +-- Yes -> slow client/download/buffering/client network
  |      +-- No  -> inspect status-specific playbook
```

---

## 30. Safe Mitigation Patterns

### 30.1 Rollback

Rollback adalah mitigasi terbaik jika:

- incident jelas dimulai setelah deploy,
- previous version known-good,
- rollback risk lebih kecil dari hotfix,
- data migration tidak membuat rollback berbahaya.

Untuk Nginx config:

```bash
sudo nginx -t
sudo nginx -s reload
```

Jika rollback config file:

```bash
sudo cp nginx.conf.previous nginx.conf
sudo nginx -t && sudo nginx -s reload
```

### 30.2 Traffic Shedding

Jika backend overload, lebih baik menolak sebagian traffic secara eksplisit daripada membiarkan semua request timeout.

Contoh:

```nginx
location /api/expensive/ {
    limit_req zone=expensive burst=10 nodelay;
    proxy_pass http://backend;
}
```

Atau temporary:

```nginx
location /api/expensive/ {
    return 503 "temporarily unavailable\n";
}
```

Gunakan hanya jika endpoint tersebut lebih baik dimatikan daripada menjatuhkan seluruh sistem.

### 30.3 Serve Stale Cache

Untuk endpoint cacheable:

```nginx
proxy_cache_use_stale error timeout http_500 http_502 http_503 http_504 updating;
```

Ini bisa menjaga read path tetap tersedia saat backend degradasi.

Tidak cocok untuk data sensitif, mutating request, atau response yang harus real-time.

### 30.4 Disable Bad Route

Jika satu route menyebabkan overload:

```nginx
location /api/broken-feature/ {
    return 503;
}
```

Tetapi pastikan komunikasi product/support jelas.

### 30.5 Remove Bad Upstream

Jika satu backend instance buruk:

```nginx
upstream app_backend {
    server 10.0.1.10:8080;
    # server 10.0.1.11:8080 down;
    server 10.0.1.12:8080;
}
```

Atau di orchestration platform, remove pod/instance dari service.

### 30.6 Increase Capacity

Scale out membantu jika bottleneck adalah kapasitas stateless yang scalable.

Scale out tidak membantu jika bottleneck adalah:

- database lock,
- shared dependency,
- global rate limit,
- bad query,
- external API limit,
- cache stampede,
- synchronized retry storm.

---

## 31. Dangerous Mitigation Patterns

Hindari mitigasi panik berikut.

### 31.1 Menaikkan Timeout Secara Global

```nginx
proxy_read_timeout 600s;
```

Risiko:

- request menumpuk lebih lama,
- Java thread lebih lama tertahan,
- client tetap timeout duluan,
- incident berubah dari error cepat menjadi resource exhaustion lambat.

### 31.2 Menaikkan Body/Header Limit Global

Risiko:

- memory pressure,
- abuse lebih mudah,
- endpoint non-upload ikut menerima payload besar.

### 31.3 Mematikan Rate Limit Sepenuhnya

Jika traffic spike adalah abuse, mematikan rate limit bisa menjatuhkan backend.

Lebih baik:

- scope bypass untuk client penting,
- adjust burst,
- refine key,
- block abusive pattern.

### 31.4 Restart Nginx Saat Reload Cukup

Restart memutus koneksi existing dan bisa memperburuk incident.

Gunakan reload jika perubahan config valid.

### 31.5 Menghapus Cache Tanpa Memahami Load

Cache purge global bisa menciptakan thundering herd ke backend.

Jika perlu purge, lakukan bertahap atau siapkan kapasitas backend.

---

## 32. Nginx Reload, Restart, Reopen: Operational Semantics

Command penting:

```bash
sudo nginx -t          # test config
sudo nginx -T          # dump effective config
sudo nginx -s reload   # graceful reload config
sudo nginx -s reopen   # reopen log files
sudo nginx -s quit     # graceful shutdown
sudo nginx -s stop     # fast shutdown
```

Model reload:

```text
new config file
   |
nginx -t / reload signal
   |
master validates syntax
   |
tries opening logs/listen sockets
   |
if fail: keep old config running
   |
if success: start new workers
   |
old workers gracefully drain
```

Implikasi:

- Reload aman jika config valid dan resource tersedia.
- Reload gagal tidak otomatis menghentikan config lama.
- Restart lebih disruptive daripada reload.
- Reopen logs diperlukan setelah log rotation manual.

---

## 33. Evidence Preservation Saat Incident

Sebelum melakukan perubahan besar, simpan bukti minimal.

```bash
date -Is
hostname
sudo nginx -T > /tmp/nginx-effective-$(date +%Y%m%dT%H%M%S).conf
sudo tail -n 1000 /var/log/nginx/error.log > /tmp/nginx-error-tail.txt
sudo tail -n 1000 /var/log/nginx/access.log > /tmp/nginx-access-tail.txt
ss -s > /tmp/ss-summary.txt
df -h > /tmp/df.txt
```

Jika Kubernetes:

```bash
kubectl get pods -o wide > pods.txt
kubectl get svc,endpoints,endpointslice > endpoints.txt
kubectl describe ingress > ingress.txt
kubectl describe pod <pod> > pod-desc.txt
kubectl logs <pod> --tail=500 > pod-log.txt
```

Tujuannya bukan bureaucracy. Tujuannya agar setelah mitigasi, kamu masih punya bukti untuk root cause.

---

## 34. Blameless Postmortem Structure

Setelah incident stabil, tulis postmortem.

Struktur minimal:

```text
1. Summary
2. User impact
3. Timeline
4. Detection
5. Root cause
6. Trigger
7. Contributing factors
8. What went well
9. What went poorly
10. Where we got lucky
11. Corrective actions
12. Prevention and detection improvements
```

### 34.1 Root Cause vs Trigger

Bedakan:

- **Trigger**: perubahan/peristiwa yang memulai incident.
- **Root cause**: kondisi sistem yang memungkinkan trigger menyebabkan outage.

Contoh:

```text
Trigger:
A config deploy changed proxy_pass trailing slash behavior.

Root cause:
We had no route-level regression tests for Nginx effective config, and config review did not include URI rewrite semantics.
```

### 34.2 Corrective Action yang Baik

Buruk:

```text
Be more careful next time.
```

Baik:

```text
Add CI test that validates /api/v1/users is proxied to upstream as /api/v1/users and not /v1/users.
```

Buruk:

```text
Engineer should remember to reload Nginx after cert renewal.
```

Baik:

```text
Add automated certificate renewal hook that runs nginx -t && nginx -s reload, plus external expiry monitoring at 30/14/7/3 days.
```

---

## 35. Incident Playbook Template

Gunakan template ini untuk membuat runbook internal.

```markdown
# Incident Playbook: <Name>

## Symptom

- What alert fires?
- What do users see?
- Which dashboard/log query confirms it?

## Severity

- SEV1 if ...
- SEV2 if ...
- SEV3 if ...

## First Checks

```bash
# commands
```

## Decision Tree

- If A, check B.
- If B, mitigate C.
- If C, escalate D.

## Safe Mitigations

1. ...
2. ...
3. ...

## Dangerous Actions

- Do not ...
- Avoid ... unless ...

## Rollback

```bash
# rollback commands
```

## Validation

```bash
# validation commands
```

## Escalation

- App team
- Platform team
- Network team
- Security team
- Database team

## Post-Incident Follow-up

- Metrics to add
- Tests to add
- Config guardrails
```
```

---

## 36. Practical Incident Scenarios

### Scenario A: 502 Spike After Java Deploy

Facts:

- 502 spike starts at 10:03.
- Deploy started at 10:00.
- Error log: `connect() failed (111: Connection refused)`.
- Some pods healthy, some restarting.

Likely model:

```text
Nginx is healthy.
Routing is likely correct.
Upstream endpoint exists but some instances refuse connection.
Deployment/readiness/graceful shutdown problem likely.
```

First mitigation:

- rollback deployment,
- remove bad pods from service,
- validate readiness,
- monitor 502 decline.

Permanent fix:

- improve readiness,
- add startup probe,
- fix graceful shutdown,
- add deploy smoke test.

---

### Scenario B: 504 Spike on Report Endpoint

Facts:

- Only `/api/reports/export` affected.
- Nginx error: `upstream timed out while reading response header`.
- DB CPU high.
- Other endpoints normal.

Likely model:

```text
Nginx can connect to backend.
Backend accepts request but cannot produce response header in time.
The bottleneck is inside app/dependency path, likely DB/report generation.
```

First mitigation:

- disable or rate-limit export endpoint,
- serve maintenance response for export only,
- rollback report change if recent,
- reduce concurrency.

Permanent fix:

- async report generation,
- query optimization,
- precomputation,
- endpoint-specific concurrency limit,
- SLO and alert.

---

### Scenario C: All Users See Certificate Error

Facts:

- Browser reports expired certificate.
- `openssl s_client` shows expired cert.
- Cert renewal job ran but Nginx not reloaded.

Likely model:

```text
Certificate file may be renewed on disk, but Nginx workers still serve old cert until reload.
```

First mitigation:

```bash
sudo nginx -t && sudo nginx -s reload
```

Permanent fix:

- post-renew hook,
- external cert monitoring,
- expiry alert,
- renewal dry-run.

---

### Scenario D: 429 Spike After CDN Migration

Facts:

- All clients appear as CDN IPs.
- Rate limit key is `$binary_remote_addr`.
- 429 affects many legitimate users.

Likely model:

```text
Real client IP trust boundary broken.
Nginx rate limit sees CDN proxy IP, not actual user IP.
```

First mitigation:

- reduce/disable affected limit temporarily,
- configure trusted CDN real IP,
- validate remote_addr changes.

Permanent fix:

- real IP integration test,
- alert on remote_addr cardinality drop,
- rate limit by better identity when available.

---

### Scenario E: Cache Leak of User-Specific Data

Facts:

- User A sees User B data.
- Endpoint behind `proxy_cache`.
- Cache key lacks Authorization/session dimension.
- Response has no `Cache-Control: private/no-store`.

Likely model:

```text
Nginx cache treats personalized responses as shared public cache.
```

First mitigation:

- disable cache for endpoint,
- purge cache,
- add bypass/no-cache for Authorization/Cookie,
- notify security/privacy process if needed.

Permanent fix:

- endpoint cache classification,
- automated tests,
- app explicit cache headers,
- security review.

---

## 37. Mapping Nginx Signals to Java Signals

| Nginx Signal | Java Signal To Check |
|---|---|
| 502 connection refused | app process down, port not listening, pod not ready |
| 502 upstream prematurely closed | app crash, exception before response, connection reset, OOM |
| 504 read timeout | thread pool saturation, DB slow, dependency timeout, GC pause |
| 499 high | endpoint latency, client timeout, cancellation, mobile network |
| upstream connect time high | accept queue, CPU saturation, network, connection pool exhaustion |
| upstream header time high | app processing before first byte, DB/query/dependency |
| request time high but upstream low | slow client, large response, network, buffering |
| 413 | multipart config mismatch, upload size policy |
| 429 | rate limit identity, endpoint abuse, real IP config |
| 404 Nginx-generated | routing/location/static config |
| 404 upstream-generated | app route/controller mapping |

---

## 38. Designing Alerts That Do Not Lie

Bad alert:

```text
Alert when any 5xx > 0
```

Problems:

- too noisy,
- no route/context,
- no severity,
- no distinction between upstream/app/Nginx.

Better alerts:

- 5xx rate > threshold by host/route for 5 minutes.
- 502 spike with upstream connect failures.
- 504 spike with upstream response time p95 high.
- 499 spike with request_time near client timeout.
- 429 spike after config deploy.
- Cert expiry below 14 days.
- Disk usage above 85% on log/cache partition.
- Nginx reload failure.
- Active connections near capacity.
- Upstream backend distribution imbalance.
- Cache hit rate sudden drop for cache-critical endpoint.

Alert should answer:

```text
Who is impacted?
What changed?
Which layer likely owns first response?
What dashboard/runbook should be opened?
```

---

## 39. Production Readiness Checklist for Failure Handling

### 39.1 Config Safety

- [ ] `nginx -t` runs in CI.
- [ ] Effective config is stored/artifacted.
- [ ] Config diff reviewed.
- [ ] Rollback path exists.
- [ ] Default server is safe.
- [ ] Unknown Host behavior is defined.
- [ ] TLS cert paths and renewal are tested.

### 39.2 Observability

- [ ] Access logs include request ID.
- [ ] Access logs include upstream status/address/timing.
- [ ] Error logs centralized.
- [ ] Dashboards by host/route/status.
- [ ] 499/502/504 tracked separately.
- [ ] Nginx logs correlate with Java logs.
- [ ] Metrics include active connections and saturation.

### 39.3 Timeout and Retry

- [ ] Timeout budget documented.
- [ ] Nginx timeout aligned with LB/CDN/client/app.
- [ ] Retry only for safe/idempotent cases.
- [ ] Retry storm risk considered.
- [ ] Endpoint-specific timeout for long-running routes.

### 39.4 Deployment Safety

- [ ] Backend readiness is meaningful.
- [ ] Graceful shutdown configured.
- [ ] Long-lived connections have drain policy.
- [ ] Rollback tested.
- [ ] Canary/smoke tests include Nginx path.

### 39.5 Security and Abuse

- [ ] Rate limits scoped and observable.
- [ ] Real IP trust boundary correct.
- [ ] Upload/body/header limits scoped.
- [ ] Cache does not store private data.
- [ ] Admin/metrics/actuator restricted.

### 39.6 Incident Preparedness

- [ ] Playbooks exist for 499/502/504/413/429/TLS/disk full.
- [ ] On-call knows reload vs restart semantics.
- [ ] Evidence capture commands documented.
- [ ] Escalation ownership clear.
- [ ] Postmortem actions tracked.

---

## 40. Advanced Failure Modeling: Cascading Failure Through Nginx

Consider this chain:

```text
Database latency rises
   |
Java API threads wait longer
   |
Upstream response time rises
   |
Nginx requests stay open longer
   |
Client timeouts increase
   |
499 increases
   |
Clients retry
   |
Traffic increases
   |
Java queue grows
   |
504 increases
   |
Nginx retries some requests
   |
Backend load increases further
```

This is a cascading failure.

Nginx can help by:

- limiting concurrency,
- rate limiting expensive endpoints,
- serving stale cache,
- failing fast,
- avoiding unsafe retries,
- isolating routes,
- preserving observability.

Nginx can worsen it by:

- retrying too aggressively,
- buffering huge requests,
- keeping too many slow requests alive,
- hiding upstream errors,
- caching wrong data,
- using global timeouts that allow request pile-up,
- misrouting traffic during deploy.

Maturity means knowing when Nginx should absorb, reject, retry, cache, or pass through.

---

## 41. Nginx Incident Anti-Patterns

### Anti-pattern 1: “502 berarti Nginx rusak”

Lebih tepat:

> 502 berarti Nginx gagal menjadi gateway yang sehat ke upstream. Sumbernya bisa Nginx, upstream, DNS, network, protocol, atau deploy.

### Anti-pattern 2: “Naikkan timeout supaya tidak 504”

Lebih tepat:

> 504 adalah sinyal bahwa request melewati budget. Menaikkan timeout hanya benar jika operasi memang valid long-running dan concurrency-nya dibatasi.

### Anti-pattern 3: “499 bukan masalah karena client yang close”

Lebih tepat:

> 499 sering menandakan user/client menyerah karena server terlalu lambat atau timeout budget tidak selaras.

### Anti-pattern 4: “`nginx -t` cukup untuk validasi production”

Lebih tepat:

> `nginx -t` hanya memvalidasi syntax dan sebagian resource. Ia tidak membuktikan routing, proxy headers, cache semantics, auth, atau upstream behavior benar.

### Anti-pattern 5: “Semua endpoint bisa pakai timeout/rate/cache policy yang sama”

Lebih tepat:

> Endpoint berbeda punya cost, risk, latency, dan correctness requirement berbeda. Policy harus diklasifikasikan.

---

## 42. Latihan

### Latihan 1: Klasifikasi Error

Diberikan log:

```text
status=504 upstream_status=504 request_time=60.001 upstream_connect_time=0.002 upstream_header_time=60.000 upstream_response_time=60.000 uri=/api/orders/search
```

Jawab:

1. Apakah Nginx bisa connect ke upstream?
2. Apakah masalah lebih mungkin di network connect atau app processing?
3. Apa tiga sinyal Java yang perlu dicek?
4. Apakah menaikkan timeout global solusi yang baik?

Expected reasoning:

- connect cepat,
- header lambat,
- app/dependency path lambat,
- cek DB, thread pool, GC/dependency,
- jangan naikkan timeout global tanpa isolasi.

---

### Latihan 2: 502 Setelah Deploy

Error log:

```text
connect() failed (111: Connection refused) while connecting to upstream, upstream: "http://10.2.3.45:8080/api/users"
```

Pertanyaan:

1. Apa arti connection refused?
2. Apa kemungkinan paling kuat jika terjadi setelah deploy?
3. Apa mitigasi tercepat?
4. Apa perbaikan permanen?

---

### Latihan 3: 429 Setelah Pindah CDN

Access log menunjukkan semua request berasal dari tiga IP CDN.

Pertanyaan:

1. Mengapa rate limit menjadi tidak adil?
2. Apa yang harus diperbaiki?
3. Apa risiko jika langsung mematikan rate limit?

---

### Latihan 4: Cache Leak

Config:

```nginx
location /api/profile {
    proxy_cache api_cache;
    proxy_cache_key "$scheme$request_method$host$request_uri";
    proxy_pass http://backend;
}
```

Pertanyaan:

1. Mengapa ini berbahaya?
2. Apa mitigasi cepat?
3. Apa kontrak app yang harus ditambahkan?

---

## 43. Ringkasan Part 028

Di bagian ini kita membangun kemampuan failure modeling untuk Nginx production.

Poin utama:

1. **Nginx adalah boundary observability dan control point.** Ia sering memperlihatkan masalah dari layer lain.
2. **Incident response dimulai dari scope dan blast radius, bukan command acak.**
3. **Status code harus dibaca bersama upstream status, upstream timing, error log, dan Java logs.**
4. **499, 502, 504 adalah sinyal berbeda.** Jangan diperlakukan sama.
5. **Mitigasi aman lebih penting daripada root cause sempurna di menit pertama.**
6. **Reload lebih aman daripada restart, tetapi tetap harus didahului `nginx -t`.**
7. **Timeout, retry, cache, dan rate limit bisa menjadi alat resilience atau sumber cascading failure.**
8. **Postmortem yang baik menghasilkan guardrail, test, alert, dan desain yang lebih kuat.**

---

## 44. Referensi Resmi dan Bacaan Lanjutan

- NGINX Documentation — Controlling nginx: https://nginx.org/en/docs/control.html
- NGINX Documentation — Beginner's Guide / Signals: https://nginx.org/en/docs/beginners_guide.html
- NGINX Documentation — Core Module: https://nginx.org/en/docs/ngx_core_module.html
- NGINX Documentation — HTTP Proxy Module: https://nginx.org/en/docs/http/ngx_http_proxy_module.html
- NGINX Documentation — HTTP Upstream Module: https://nginx.org/en/docs/http/ngx_http_upstream_module.html
- NGINX Documentation — HTTP Load Balancing: https://nginx.org/en/docs/http/load_balancing.html
- NGINX Admin Guide — Runtime Control: https://docs.nginx.com/nginx/admin-guide/basic-functionality/runtime-control/
- NGINX Admin Guide — Logging: https://docs.nginx.com/nginx/admin-guide/monitoring/logging/

---

## 45. Status Seri

- Part selesai: **028 dari 030**
- Seri belum selesai.
- Part berikutnya: **Part 029 — Performance Lab: Benchmarking, Capacity Planning, and Tuning Experiments**
