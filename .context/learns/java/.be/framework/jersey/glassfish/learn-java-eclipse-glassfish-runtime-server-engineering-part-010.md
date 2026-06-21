# learn-java-eclipse-glassfish-runtime-server-engineering-part-010

# Part 10 — HTTP Stack dan Grizzly Runtime Internals

> Seri: `learn-java-eclipse-glassfish-runtime-server-engineering`  
> Bagian: `010 / 034`  
> Topik: HTTP stack, Grizzly, network listener, virtual server, timeout, proxy, TLS, access log, dan troubleshooting konektivitas produksi  
> Target pembaca: Java engineer senior/principal yang ingin memahami GlassFish bukan hanya sebagai tempat deploy WAR/EAR, tetapi sebagai runtime HTTP enterprise yang harus bisa dianalisis, dituning, dan dioperasikan dengan defensible.

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas deployment model dan descriptor. Sekarang kita masuk ke salah satu jalur runtime paling sering dipakai oleh aplikasi GlassFish: **HTTP request path**.

Tujuan utama bagian ini adalah membuat kamu bisa menjawab pertanyaan seperti:

1. Saat client mengirim request ke aplikasi GlassFish, komponen apa saja yang dilewati sebelum method Servlet/JAX-RS/CDI/EJB dipanggil?
2. Apa bedanya `network-listener`, `protocol`, `transport`, `http-service`, `virtual-server`, dan `thread-pool`?
3. Kenapa timeout bisa muncul sebagai `504` di reverse proxy padahal aplikasi tidak melempar exception?
4. Kapan harus mengubah thread pool HTTP, kapan harus mengubah connection pool DB, dan kapan justru masalahnya ada di proxy atau upstream dependency?
5. Bagaimana menaruh GlassFish di belakang Nginx/Apache/ALB tanpa membuat scheme, host, port, secure cookie, redirect, dan access log menjadi salah?
6. Apa yang perlu dilihat ketika muncul `400`, `404`, `413`, `500`, `502`, `503`, atau `504`?
7. Bagaimana membuat konfigurasi HTTP GlassFish dapat diaudit, diulang, dan aman untuk production?

Bagian ini tidak mengulang Servlet API, JAX-RS API, filter chain programming, atau security API karena sudah dibahas pada seri sebelumnya. Fokus kita adalah **runtime HTTP GlassFish dan Grizzly**.

---

## 1. Mental Model Awal: HTTP di GlassFish Adalah Boundary antara Network dan Container

Banyak engineer melihat GlassFish seperti ini:

```text
Browser / API Client
    |
    v
GlassFish
    |
    v
Application Code
```

Model ini terlalu kasar. Untuk troubleshooting production, model seperti ini tidak cukup.

Model yang lebih benar:

```text
Client
  |
  | TCP/TLS/HTTP
  v
Load Balancer / Reverse Proxy / API Gateway
  |
  | TCP/TLS/HTTP
  v
GlassFish Network Listener
  |
  v
Grizzly Transport / Protocol Processing
  |
  v
HTTP Service
  |
  v
Virtual Server Selection
  |
  v
Web Container
  |
  v
Application Context Root
  |
  v
Filter Chain / Servlet / JAX-RS Dispatcher
  |
  v
Business Layer / EJB / CDI / JPA / JDBC / JMS / Remote Calls
```

Perhatikan satu hal penting: **HTTP stack bukan hanya penerima request. Ia adalah boundary untuk concurrency, timeout, connection lifecycle, TLS, virtual host routing, request size limit, access logging, dan backpressure.**

Kalau aplikasi lambat, error, timeout, atau overload, penyebabnya bisa terjadi di banyak titik:

```text
Client side timeout?
Proxy idle timeout?
TLS handshake issue?
GlassFish listener not bound?
HTTP thread exhausted?
Request body terlalu besar?
Virtual server salah?
Context root salah?
Filter chain blocking?
DB pool exhausted?
Remote service lambat?
Response tidak pernah commit?
```

Engineer top-level tidak langsung menyalahkan controller, endpoint, atau database. Ia melacak request dari **network boundary** sampai **resource boundary**.

---

## 2. Komponen Utama HTTP Stack GlassFish

GlassFish memakai **Grizzly** sebagai network/HTTP layer. Grizzly adalah framework NIO untuk membangun server scalable dan robust, dan menyediakan komponen HTTP/S, WebSocket, Comet, dan lain-lain. Di dalam GlassFish, Grizzly berperan sebagai connector/front door untuk traffic HTTP.

Komponen administrasi GlassFish yang relevan:

| Komponen | Fungsi | Pertanyaan yang dijawab |
|---|---|---|
| `network-listener` | Endpoint network yang listen pada address/port tertentu | Server menerima koneksi di port mana? |
| `protocol` | Konfigurasi protokol HTTP/HTTPS untuk listener | HTTP behavior-nya seperti apa? SSL aktif? timeout? |
| `transport` | Konfigurasi transport/socket/NIO layer | Koneksi diproses oleh transport apa? |
| `thread-pool` | Kumpulan thread worker untuk memproses pekerjaan | Berapa concurrency yang dapat dilayani? |
| `http-service` | Konfigurasi service HTTP global | Access log, virtual server, behavior global |
| `virtual-server` | Host/context routing logical | Hostname/context aplikasi diarahkan ke virtual host mana? |
| `web-container` | Runtime Servlet/Jakarta Web | Bagaimana WAR dijalankan? |
| `application` | Artifact deployed | Context root apa yang tersedia? |

Mental model relasi:

```text
network-listener
  -> references protocol
       -> may contain http settings
       -> may contain ssl settings
  -> references transport
  -> may reference thread-pool

http-service
  -> contains virtual-server(s)
       -> maps hosts/context roots/applications

application deployment
  -> has context-root
  -> targeted to server/cluster/instance
  -> served through virtual-server/listener path
```

Pada GlassFish modern, command seperti `create-http-listener` adalah shortcut untuk membuat HTTP network listener tanpa harus secara manual membuat protocol, transport, dan HTTP configuration terlebih dahulu. Namun shortcut ini tidak memberikan seluruh opsi granular. Untuk kebutuhan production yang detail, biasanya perlu memahami model `network-listener`/`protocol`/`transport` secara eksplisit.

---

## 3. Default HTTP Surface GlassFish

Instalasi domain default biasanya menyediakan listener seperti:

| Listener | Default port umum | Fungsi |
|---|---:|---|
| `http-listener-1` | `8080` | HTTP application traffic tanpa SSL |
| `http-listener-2` | `8181` | HTTPS application traffic |
| `admin-listener` | `4848` | Admin Console / Admin API |

Konsep penting:

1. **Application traffic dan admin traffic harus diperlakukan sebagai boundary berbeda.**
2. `admin-listener` sebaiknya tidak diekspos publik.
3. Pada production modern, TLS sering diterminasi di load balancer/reverse proxy, tetapi GlassFish tetap harus dikonfigurasi agar memahami external scheme/host bila aplikasi membuat redirect atau absolute URL.
4. Default port baik untuk local/dev, bukan otomatis baik untuk production.

Contoh inspeksi awal:

```bash
asadmin list-network-listeners
asadmin list-http-listeners
asadmin list-virtual-servers
asadmin get "configs.config.server-config.network-config.network-listeners.network-listener.*"
asadmin get "configs.config.server-config.http-service.*"
```

Untuk environment cluster, jangan lupa target config yang benar:

```bash
asadmin get "configs.config.<cluster-config-name>.network-config.network-listeners.network-listener.*"
```

Kesalahan umum: engineer mengubah `server-config`, padahal instance production memakai config cluster lain.

---

## 4. Jalur Request: Dari Socket sampai Application Code

Mari pecah request path secara operasional.

### 4.1 Client membuat koneksi

Client mengirim request:

```http
GET /aceas/api/cases/123 HTTP/1.1
Host: example.gov.sg
User-Agent: ...
Accept: application/json
```

Bila ada TLS, terjadi handshake lebih dulu. TLS bisa terjadi di:

1. client → load balancer, lalu LB → GlassFish plain HTTP
2. client → load balancer, lalu LB → GlassFish HTTPS
3. client langsung → GlassFish HTTPS

Masing-masing punya implikasi security, certificate, scheme detection, dan troubleshooting.

### 4.2 Reverse proxy/load balancer menerima request

Proxy bisa melakukan:

- TLS termination
- host/path routing
- request buffering
- compression
- header normalization
- timeout enforcement
- max body size enforcement
- health check
- sticky session
- rewrite path
- add forwarding headers

Contoh header umum:

```http
X-Forwarded-For: 203.0.113.10
X-Forwarded-Proto: https
X-Forwarded-Host: example.gov.sg
X-Forwarded-Port: 443
```

Jika aplikasi GlassFish tidak memahami header ini, aplikasi bisa salah mengira request datang via `http://internal-host:8080`, lalu menghasilkan redirect atau URL yang salah.

### 4.3 GlassFish network listener menerima koneksi

Network listener melakukan bind ke address/port tertentu.

Pertanyaan diagnosis:

```text
Apakah port benar-benar listening?
Apakah bind address 0.0.0.0, localhost, atau IP tertentu?
Apakah firewall/security group membuka port?
Apakah listener enabled?
Apakah listener ditargetkan ke config yang dipakai instance?
```

Command OS:

```bash
ss -lntp | grep 8080
netstat -lntp | grep 8080
lsof -i :8080
```

Command GlassFish:

```bash
asadmin list-network-listeners
asadmin get "configs.config.server-config.network-config.network-listeners.network-listener.http-listener-1.*"
```

### 4.4 Grizzly memproses transport/protocol

Grizzly menangani detail low-level seperti:

- accept connection
- read bytes dari socket
- parse HTTP request line/header/body
- keep-alive handling
- SSL processing bila listener secure
- dispatch ke worker thread/container

Dalam NIO server, satu koneksi tidak selalu berarti satu dedicated OS thread sepanjang hidup koneksi. Namun request application processing tetap membutuhkan eksekusi di thread tertentu. Artinya, walaupun NIO membantu scalability koneksi, **blocking business logic tetap bisa menghabiskan worker capacity**.

### 4.5 HTTP service dan virtual server memilih target logical

GlassFish dapat memiliki beberapa virtual server. Virtual server memungkinkan beberapa logical host/context served oleh runtime yang sama.

Contoh mental model:

```text
Host: internal.example.gov.sg -> virtual-server: internal-vs
Host: public.example.gov.sg   -> virtual-server: public-vs
```

Kalau host header, listener mapping, atau virtual server salah, symptom bisa berupa:

- 404 padahal aplikasi deployed
- context root tidak ditemukan
- aplikasi muncul pada host yang salah
- access log ada di tempat yang tidak kamu cek

### 4.6 Web container mencari context root

Jika application deployed dengan context root `/aceas`, maka request `/aceas/api/cases/123` diarahkan ke web module tersebut.

Kalau context root salah:

```text
/aceas/api/cases/123 -> 404
/app/api/cases/123   -> 200
```

Command:

```bash
asadmin list-applications
asadmin show-component-status <application-name>
asadmin get "applications.application.<application-name>.*"
```

### 4.7 Filter chain, servlet, JAX-RS dispatcher, business code

Setelah masuk web container, request melewati:

```text
Servlet Filter(s)
  -> Security constraints/auth filter
  -> Framework dispatcher
  -> Endpoint/resource/controller
  -> Service/business layer
  -> DB/JMS/remote calls
```

Dari titik ini, banyak bottleneck bukan lagi HTTP stack murni, tetapi HTTP stack tetap menjadi tempat symptom muncul:

- response lambat
- thread menumpuk
- timeout proxy
- client disconnect
- request queue panjang

---

## 5. Listener, Protocol, Transport: Jangan Campur Aduk

Salah satu kesalahan umum adalah menyebut semua hal sebagai “listener”. Padahal ada beberapa layer.

### 5.1 `network-listener`

Network listener adalah endpoint yang menerima koneksi.

Atribut penting biasanya meliputi:

- name
- port
- address
- protocol reference
- transport reference
- thread pool reference
- enabled/disabled
- jkenabled atau integrasi tertentu pada versi lama

Contoh command konseptual:

```bash
asadmin create-network-listener \
  --listenerport 8080 \
  --protocol http-1 \
  --transport tcp \
  --target server \
  app-listener
```

### 5.2 `protocol`

Protocol menyimpan konfigurasi HTTP/HTTPS behavior.

Hal yang biasanya relevan:

- HTTP configuration
- SSL configuration
- redirect behavior
- request timeout
- header size/body behavior tertentu
- security enabled

Shortcut `create-http-listener` membuat listener HTTP dengan cara lebih sederhana, tetapi untuk konfigurasi advanced, command granular lebih mudah diaudit.

### 5.3 `transport`

Transport berhubungan dengan socket/NIO transport layer.

Pada kebanyakan aplikasi, transport default cukup. Jangan terlalu cepat men-tune transport sebelum membuktikan bottleneck-nya ada di network accept/read/write layer.

### 5.4 `thread-pool`

Thread pool menentukan kapasitas pemrosesan pekerjaan. Ini bukan hanya angka “berapa request bisa masuk”, tetapi juga boundary untuk blocking behavior.

Kalau 200 HTTP worker thread semuanya sedang menunggu DB lambat, menaikkan thread ke 500 mungkin hanya memperbesar tekanan ke DB dan memori.

---

## 6. Virtual Server: Host Routing di Dalam GlassFish

Virtual server adalah logical host di dalam HTTP service.

Gunanya:

- memetakan host name berbeda
- memisahkan aplikasi berdasarkan host
- memisahkan access log
- mengontrol default web module
- menjalankan beberapa aplikasi dengan context root berbeda

Contoh:

```text
Virtual server: server
Hosts         : localhost, internal-app.example

Virtual server: public-vs
Hosts         : public.example.gov.sg

Virtual server: admin-vs
Hosts         : admin.internal.example.gov.sg
```

Masalah virtual server sering muncul sebagai 404 yang membingungkan:

```text
Application deployed? yes.
Context root correct? yes.
Listener active? yes.
But request still 404.
```

Kemungkinan:

```text
Host header masuk ke virtual server lain.
Application tidak ditargetkan/di-enable untuk virtual server tersebut.
Proxy mengganti Host header menjadi internal host.
Context root berbeda di descriptor/vendor config.
```

Prinsip production:

1. Tentukan dengan jelas host eksternal yang harus dilayani.
2. Pastikan proxy preserve atau set `Host` dengan benar.
3. Jangan rely pada default virtual server bila ada multi-host topology.
4. Dokumentasikan mapping listener → virtual server → app.

---

## 7. HTTP Thread Pool: Kapasitas, Blocking, dan Backpressure

### 7.1 Salah kaprah umum

Salah kaprah paling umum:

> “Kalau request timeout, tambah HTTP thread.”

Kadang benar, sering salah.

Thread pool adalah kapasitas concurrency pemrosesan. Kalau penyebab timeout adalah workload blocking karena DB lambat, remote service lambat, lock contention, atau connection pool habis, menambah HTTP thread bisa memperburuk keadaan.

### 7.2 Model sederhana kapasitas

Gunakan Little’s Law secara praktis:

```text
concurrency ≈ throughput × latency
```

Misal:

```text
Target throughput  : 100 request/sec
Average latency    : 300 ms = 0.3 sec
Expected in-flight : 100 × 0.3 = 30 request
```

Kalau latency naik menjadi 5 detik:

```text
100 × 5 = 500 in-flight request
```

Kalau HTTP thread hanya 200, request akan mulai antre atau timeout. Tapi akar masalahnya bukan thread pool, melainkan latency yang melonjak.

### 7.3 Thread pool harus disejajarkan dengan downstream capacity

Contoh kapasitas:

```text
HTTP worker max       : 200
JDBC max pool         : 50
External API capacity : 30 concurrent safe calls
CPU cores             : 8
```

Jika semua endpoint butuh DB, maka lebih dari 50 request concurrent akan menunggu connection. Kalau menaikkan HTTP thread ke 500 tanpa menaikkan DB capacity, kamu hanya menciptakan 450 request yang antre/menunggu.

### 7.4 Kapan menambah HTTP thread masuk akal?

Masuk akal jika:

- thread pool memang habis
- CPU masih rendah
- downstream capacity masih ada
- latency per request normal
- banyak request short-lived
- queue terbentuk di HTTP layer, bukan DB/remote service

Tidak masuk akal jika:

- DB pool exhausted
- CPU sudah saturated
- GC berat
- remote API lambat
- thread dump menunjukkan banyak thread waiting di socket/DB lock
- response time meningkat karena lock contention

### 7.5 Thread dump sebagai sumber kebenaran

Ketika timeout terjadi, ambil beberapa thread dump berjarak 5–10 detik.

Cari pola:

```text
Many threads RUNNABLE doing CPU work?
Many threads WAITING on JDBC pool?
Many threads BLOCKED on synchronized lock?
Many threads TIMED_WAITING in socketRead?
Many threads waiting for external HTTP client?
```

Kamu tidak tuning berdasarkan feeling. Kamu tuning berdasarkan state thread, metric pool, latency, dan queue.

---

## 8. Timeout: Siapa yang Menyerah Lebih Dulu?

Timeout adalah kontrak waktu antar boundary. Pada HTTP topology modern, banyak layer punya timeout sendiri.

```text
Client timeout
  > CDN/API gateway timeout
    > Load balancer idle timeout
      > Nginx/Apache proxy timeout
        > GlassFish request processing time
          > JDBC query timeout
            > DB lock wait timeout
              > remote service timeout
```

Masalah besar terjadi ketika timeout tidak disejajarkan.

### 8.1 Contoh timeout yang buruk

```text
Client timeout             : 30s
Nginx proxy_read_timeout   : 60s
GlassFish request handling : no clear limit
JDBC query timeout         : unlimited
DB lock wait               : 300s
```

Akibat:

- client sudah menyerah di 30s
- Nginx mungkin masih menunggu
- GlassFish thread masih bekerja
- DB query masih berjalan
- resource tetap terpakai walau user sudah tidak menunggu

### 8.2 Prinsip timeout yang sehat

Buat timeout berlapis dan eksplisit.

Contoh arah:

```text
Client/API consumer timeout : 35s
Gateway/proxy timeout       : 40s
Application operation SLA   : 30s
Remote HTTP client timeout  : 3s/5s/10s sesuai dependency
JDBC query timeout          : sesuai query class
DB lock timeout             : tidak jauh lebih besar dari app timeout
```

Prinsip:

1. Downstream timeout harus lebih kecil dari upstream timeout.
2. Operation timeout harus punya fallback/error handling.
3. Jangan biarkan request HTTP menunggu dependency tanpa batas.
4. Timeout harus menghasilkan log/correlation yang bisa ditelusuri.

### 8.3 504 bukan selalu error GlassFish

`504 Gateway Timeout` biasanya dibuat oleh proxy/gateway ketika upstream tidak merespons dalam waktu yang ditentukan.

Artinya:

```text
Proxy menghubungi GlassFish.
GlassFish tidak mengirim response tepat waktu.
Proxy menyerah dan mengirim 504 ke client.
```

Penyebab GlassFish tidak merespons bisa:

- request masih diproses normal tapi lambat
- thread pool habis
- DB pool habis
- deadlock/lock wait
- GC pause panjang
- response streaming stuck
- network issue antara proxy dan GlassFish

Jadi diagnosis harus melihat:

- proxy access/error log
- GlassFish access log
- GlassFish server.log
- thread dump saat kejadian
- JDBC pool metric
- GC log
- DB session/active query

---

## 9. Reverse Proxy dan Load Balancer di Depan GlassFish

Production modern hampir selalu menaruh GlassFish di belakang komponen lain:

```text
Internet
  -> CDN/WAF
  -> Load Balancer
  -> Nginx/Apache/API Gateway
  -> GlassFish
```

Atau di Kubernetes:

```text
Client
  -> Ingress Controller
  -> Service
  -> Pod running GlassFish
```

### 9.1 Hal yang harus disepakati antara proxy dan GlassFish

| Area | Risiko jika salah |
|---|---|
| Host header | virtual server/context salah, redirect salah |
| Scheme | aplikasi generate `http://` padahal external HTTPS |
| Port | absolute URL salah |
| Client IP | audit/access log hanya berisi IP proxy |
| Timeout | 504/connection reset |
| Body size | 413 di proxy atau GlassFish |
| Header size | 400/431-like behavior |
| Cookie secure | session cookie tidak secure atau tidak terkirim |
| Path rewrite | context root mismatch |
| Health check path | instance dianggap unhealthy padahal app OK atau sebaliknya |

### 9.2 Forwarded header

Header umum:

```http
X-Forwarded-For: client-ip, proxy1, proxy2
X-Forwarded-Proto: https
X-Forwarded-Host: example.gov.sg
X-Forwarded-Port: 443
```

Modern standard header:

```http
Forwarded: for=203.0.113.10;proto=https;host=example.gov.sg
```

Aplikasi dan framework harus dikonfigurasi agar mempercayai header ini hanya dari proxy tepercaya, bukan langsung dari internet.

### 9.3 Preserve host

Jika proxy mengubah Host header menjadi internal upstream, virtual server mapping bisa gagal.

Contoh Nginx:

```nginx
proxy_set_header Host $host;
proxy_set_header X-Forwarded-Host $host;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Port $server_port;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

### 9.4 Path rewrite dan context root

Misal external URL:

```text
https://example.gov.sg/aceas/api/cases
```

Internal GlassFish app context root:

```text
/aceas
```

Proxy sebaiknya meneruskan path apa adanya.

Berbahaya:

```text
external /aceas/api/cases -> internal /api/cases
```

Bisa dilakukan, tetapi perlu disiplin tinggi karena aplikasi mungkin generate relative/absolute URL berdasarkan context root.

Prinsip: **jangan rewrite path kecuali ada alasan arsitektural kuat.**

---

## 10. TLS: Native GlassFish TLS vs TLS Termination di Proxy

Ada tiga pola utama.

### 10.1 TLS terminate di GlassFish

```text
Client --HTTPS--> GlassFish
```

Kelebihan:

- end-to-end sederhana untuk topology kecil
- GlassFish langsung tahu request secure
- tidak perlu forwarded proto untuk scheme

Kekurangan:

- certificate management di app server
- lebih sulit bila banyak instance
- lebih sulit integrasi WAF/LB
- admin perlu mengelola keystore/truststore GlassFish

### 10.2 TLS terminate di load balancer/proxy

```text
Client --HTTPS--> LB/Proxy --HTTP--> GlassFish
```

Kelebihan:

- certificate centralized
- cocok untuk cloud/load balancer
- offload TLS
- lebih mudah rotasi sertifikat

Kekurangan:

- GlassFish melihat request sebagai HTTP internal
- perlu forwarded header
- secure cookie/redirect harus dikonfigurasi benar
- network internal harus dipercaya/diamankan

### 10.3 TLS re-encryption

```text
Client --HTTPS--> LB/Proxy --HTTPS--> GlassFish
```

Kelebihan:

- encryption end-to-end
- cocok untuk environment regulated

Kekurangan:

- certificate management lebih kompleks
- troubleshooting TLS dua lapis
- overhead lebih besar

### 10.4 Prinsip memilih

Untuk production enterprise modern:

- internet-facing TLS biasanya diterminasi di LB/WAF/reverse proxy
- internal segment bisa HTTP bila network private dan risk accepted
- regulated/high-security environment bisa memakai re-encryption atau mTLS
- admin listener tetap harus dikunci dan tidak ikut public exposure

---

## 11. Request Size, Header Size, Upload, dan 413

`413 Payload Too Large` bisa berasal dari:

- CDN/WAF
- reverse proxy
- load balancer
- GlassFish HTTP layer
- application framework validation

Kalau user upload file 20 MB dan mendapat 413, jangan langsung ubah aplikasi. Cek semua layer.

Checklist:

```text
Client actually sends how many bytes?
Proxy max body size berapa?
Load balancer limit berapa?
GlassFish request body limit berapa?
Servlet multipart config berapa?
Application validation berapa?
Disk/temp dir cukup?
Timeout upload cukup?
```

Failure mode upload:

- body terlalu besar
- upload lambat melewati timeout
- proxy buffering disk penuh
- GlassFish temp directory penuh
- application membaca stream terlalu lambat
- antivirus/DLP layer menahan request

Prinsip: upload besar sebaiknya tidak selalu lewat GlassFish synchronous request. Untuk file besar, pertimbangkan object storage pre-signed URL, async processing, atau dedicated upload service.

---

## 12. Compression, Keep-Alive, dan Connection Lifecycle

### 12.1 Keep-alive

HTTP keep-alive mengizinkan koneksi TCP dipakai ulang untuk banyak request.

Kelebihan:

- mengurangi TCP handshake
- mengurangi TLS handshake
- latency lebih rendah

Risiko:

- terlalu banyak idle connection
- file descriptor habis
- connection slot terpakai oleh client/proxy lambat

Dalam topology dengan proxy, keep-alive perlu dilihat pada dua sisi:

```text
Client <-> Proxy
Proxy  <-> GlassFish
```

Proxy upstream keep-alive ke GlassFish dapat meningkatkan efisiensi, tetapi harus disejajarkan dengan timeout GlassFish.

### 12.2 Compression

Compression bisa dilakukan di:

- GlassFish
- reverse proxy
- CDN
- application code

Biasanya lebih baik compression dilakukan di proxy/CDN untuk static/text response, bukan semua di application server.

Pertimbangan:

- CPU overhead
- response size
- content type
- TLS + compression security caveat untuk data sensitif tertentu
- double compression

### 12.3 Slow client problem

Jika client lambat membaca response, server/proxy bisa menahan resource. Reverse proxy buffering sering membantu melindungi GlassFish dari slow client.

Prinsip production: **biarkan edge/proxy menghadapi internet behavior; biarkan GlassFish fokus ke application processing.**

---

## 13. Access Log: Sumber Kebenaran Traffic HTTP

Server log menjawab “apa yang runtime alami”. Access log menjawab “request apa yang masuk dan response apa yang keluar”.

Access log harus memungkinkan korelasi:

- timestamp
- client IP asli
- method
- path
- status
- response size
- duration
- user/session/correlation id bila aman
- upstream/proxy request id
- user agent bila perlu

Contoh pola analisis:

```text
Proxy access log: request /x status 504 duration 60s
GlassFish access log: request /x status 200 duration 75s
```

Interpretasi:

```text
Proxy menyerah di 60s.
GlassFish selesai di 75s, tapi client sudah menerima 504.
```

Contoh lain:

```text
Proxy access log: 502 immediate
GlassFish access log: no entry
```

Kemungkinan:

```text
Proxy tidak berhasil connect ke GlassFish.
Port closed.
Instance down.
Firewall/security group issue.
TLS mismatch.
Connection refused/reset sebelum HTTP request mencapai GlassFish.
```

Contoh lain:

```text
Proxy access log: 404
GlassFish access log: 404 same path
```

Kemungkinan:

```text
Request mencapai GlassFish, tetapi context/path tidak ditemukan.
Cek virtual server, context root, deployment status, path rewrite.
```

---

## 14. Status Code Troubleshooting Map

### 14.1 `400 Bad Request`

Kemungkinan:

- malformed HTTP request
- invalid header
- header terlalu besar
- TLS ke port HTTP atau HTTP ke port HTTPS
- proxy mengirim request format yang tidak sesuai
- client/proxy bug

Diagnosis:

```bash
curl -v http://host:8080/path
curl -vk https://host:8181/path
```

Cek:

- port benar HTTP/HTTPS?
- header size?
- proxy rewrite?
- server.log?

### 14.2 `404 Not Found`

Kemungkinan:

- context root salah
- app belum deployed/enabled
- virtual server salah
- Host header salah
- path rewrite salah
- JAX-RS application path/resource path salah

Diagnosis:

```bash
asadmin list-applications
asadmin show-component-status <app>
asadmin list-virtual-servers
curl -v -H 'Host: expected.host' http://internal:8080/context/path
```

### 14.3 `413 Payload Too Large`

Kemungkinan:

- proxy body limit
- GlassFish limit
- multipart config limit
- application validation

Diagnosis:

- cek proxy error log
- cek apakah request muncul di GlassFish access log
- cek application log
- test ukuran bertahap

### 14.4 `500 Internal Server Error`

Kemungkinan:

- exception aplikasi
- CDI/EJB/JPA runtime error
- transaction failure
- serialization error
- response commit conflict

Diagnosis:

- server.log dengan correlation id
- stacktrace
- application log
- transaction/JDBC logs

### 14.5 `502 Bad Gateway`

Biasanya dibuat oleh proxy ketika upstream tidak valid.

Kemungkinan:

- GlassFish down
- port salah
- connection refused
- TLS mismatch
- upstream reset connection
- proxy cannot resolve DNS
- response invalid dari upstream

Diagnosis:

```bash
curl -v http://glassfish-host:8080/health
ss -lntp | grep 8080
asadmin list-domains
asadmin list-instances
```

### 14.6 `503 Service Unavailable`

Kemungkinan:

- instance unhealthy menurut LB
- app disabled
- server overloaded
- maintenance/drain
- no healthy backend
- thread/resource exhaustion

Diagnosis:

- LB target health
- readiness endpoint
- GlassFish app status
- thread dump
- pool metrics

### 14.7 `504 Gateway Timeout`

Kemungkinan:

- app lambat
- HTTP thread stuck
- DB lambat
- remote service lambat
- GC pause
- proxy timeout terlalu pendek
- network issue

Diagnosis:

- compare proxy duration vs GlassFish duration
- thread dumps saat kejadian
- DB active sessions
- JDBC pool metrics
- GC logs

---

## 15. Health Check, Liveness, dan Readiness

Health check production bukan hanya “port terbuka”.

### 15.1 Liveness

Menjawab:

```text
Apakah process masih hidup dan bisa menerima koneksi dasar?
```

Liveness terlalu berat berbahaya. Jika liveness bergantung ke DB, DB lambat bisa membuat semua pod/instance restart massal.

### 15.2 Readiness

Menjawab:

```text
Apakah instance siap menerima traffic bisnis?
```

Readiness bisa mengecek:

- app deployed/enabled
- critical config loaded
- DB pool reachable ringan
- migration complete
- dependency essential tersedia

### 15.3 Startup probe

Untuk container/Kubernetes, startup probe berguna karena GlassFish + enterprise app bisa membutuhkan waktu bootstrap lebih lama.

Tanpa startup probe, liveness bisa membunuh process sebelum benar-benar siap.

### 15.4 Health endpoint design

Endpoint:

```text
/health/live
/health/ready
```

Prinsip:

- liveness murah
- readiness lebih representatif
- jangan expose detail sensitif
- beri correlation/logging untuk health failure
- bedakan dependency mandatory vs optional

---

## 16. Configuration Examples dengan `asadmin`

> Catatan: command berikut adalah pola pembelajaran. Nama config, target, dan opsi dapat berbeda antar versi/topologi. Selalu validasi dengan `asadmin help <command>` pada versi GlassFish yang digunakan.

### 16.1 Melihat listener

```bash
asadmin list-network-listeners
asadmin list-http-listeners
asadmin list-virtual-servers
```

### 16.2 Melihat properti listener tertentu

```bash
asadmin get "configs.config.server-config.network-config.network-listeners.network-listener.http-listener-1.*"
```

### 16.3 Membuat HTTP listener sederhana

```bash
asadmin create-http-listener \
  --listeneraddress 0.0.0.0 \
  --listenerport 8080 \
  --defaultvs server \
  app-http-listener
```

### 16.4 Membuat listener granular

```bash
asadmin create-protocol app-http-protocol
asadmin create-http --default-virtual-server server app-http-protocol
asadmin create-network-listener \
  --listenerport 8080 \
  --protocol app-http-protocol \
  --transport tcp \
  app-http-listener
```

### 16.5 Restart setelah perubahan tertentu

Beberapa perubahan listener/protocol/admin-listener membutuhkan restart agar efektif. Jangan mengandalkan asumsi.

```bash
asadmin restart-domain domain1
```

Untuk production cluster, rencanakan rolling restart/drain bila memungkinkan.

---

## 17. Production Baseline untuk HTTP GlassFish

Baseline yang baik bukan angka universal, tetapi prinsip konfigurasi.

### 17.1 Network exposure

- Application listener hanya dibuka ke reverse proxy/LB bila memungkinkan.
- Admin listener hanya private/admin network.
- Tidak expose admin console ke internet.
- Gunakan firewall/security group/network policy.

### 17.2 Listener separation

Pisahkan secara konseptual:

```text
admin traffic
public app traffic
internal app traffic
health check traffic
```

Tidak selalu harus listener berbeda, tetapi boundary-nya harus jelas.

### 17.3 Proxy contract

Dokumentasikan:

- external host
- internal upstream host/port
- TLS termination point
- forwarded headers
- timeout
- max body size
- health endpoint
- sticky session requirement

### 17.4 Timeout contract

Dokumentasikan:

- client timeout
- gateway timeout
- proxy connect/read/send timeout
- GlassFish HTTP/request behavior
- application operation timeout
- remote client timeout
- JDBC query timeout

### 17.5 Access logging

Pastikan:

- enabled sesuai kebutuhan
- format memuat latency/status/path/client IP
- log rotation aktif
- log dikirim ke centralized logging
- sensitive data tidak masuk query string/log

### 17.6 Capacity guardrail

Pantau:

- active HTTP threads
- queued requests bila tersedia
- response time percentile
- status code distribution
- JDBC active/available connections
- GC pause
- CPU
- heap/native memory

---

## 18. Failure Scenario 1: 504 Setelah 60 Detik

### 18.1 Gejala

User melaporkan:

```text
Endpoint /reports/export sering timeout setelah sekitar 60 detik.
Browser menerima 504 Gateway Timeout.
```

### 18.2 Diagnosis buruk

```text
Tambah HTTP thread.
Tambah heap.
Restart server.
```

Ini reaktif dan tidak membuktikan apa pun.

### 18.3 Diagnosis baik

Langkah:

1. Cek proxy log.
2. Cek GlassFish access log.
3. Cek server.log.
4. Ambil thread dump saat request berjalan.
5. Cek DB active query.
6. Cek pool metric.

Kemungkinan data:

```text
Proxy access log:
  status=504 duration=60.001s

GlassFish access log:
  /reports/export status=200 duration=143.221s

Thread dump:
  report thread waiting on JDBC query

DB:
  query full table scan, running > 120s
```

Kesimpulan:

```text
Proxy timeout 60s hanya symptom.
Root cause: report query latency > allowed operation time.
```

Solusi:

- ubah report menjadi async job
- optimize query/index
- paginate/stream dengan benar
- set operation timeout eksplisit
- return 202 Accepted + polling/download link
- proxy timeout hanya disesuaikan bila business SLA memang mengizinkan

---

## 19. Failure Scenario 2: 404 Padahal App Deployed

### 19.1 Gejala

```text
asadmin list-applications menunjukkan app deployed.
Namun https://public.example.gov.sg/aceas memberi 404.
```

### 19.2 Kemungkinan

```text
Context root bukan /aceas.
Proxy mengirim Host: internal-glassfish.local.
Virtual server public-vs tidak memetakan app.
App deployed ke target server, tapi request masuk instance/cluster lain.
Path rewrite menghapus /aceas.
```

### 19.3 Diagnosis

```bash
curl -v http://glassfish-internal:8080/aceas
curl -v -H 'Host: public.example.gov.sg' http://glassfish-internal:8080/aceas
asadmin list-virtual-servers
asadmin list-applications --target <target>
```

Bandingkan:

```text
Direct internal with expected Host -> 200
Through proxy -> 404
```

Kemungkinan proxy host/path rewrite.

---

## 20. Failure Scenario 3: 502 Setelah Deployment Baru

### 20.1 Gejala

```text
Setelah deployment, LB menunjukkan target unhealthy dan client menerima 502.
```

### 20.2 Kemungkinan

```text
GlassFish tidak start.
App deployment gagal dan health endpoint unavailable.
Listener tidak bind karena port conflict.
JVM option invalid.
TLS config broken.
Container readiness terlalu cepat.
```

### 20.3 Diagnosis

```bash
asadmin list-domains
asadmin start-domain --verbose domain1
ss -lntp | grep 8080
curl -v http://localhost:8080/health/ready
```

Cek log startup:

```text
domain-dir/logs/server.log
```

Cari:

- port already in use
- deployment exception
- CDI unsatisfied dependency
- JDBC driver missing
- keystore/certificate error
- invalid JVM option

---

## 21. Failure Scenario 4: CPU Rendah tapi Request Timeout

### 21.1 Gejala

```text
CPU hanya 25%, heap aman, tapi request timeout dan throughput turun.
```

### 21.2 Kemungkinan

Ini sering berarti system bukan CPU-bound, tetapi **blocked/wait-bound**.

Kemungkinan:

- HTTP thread menunggu DB connection
- DB query lambat
- remote API lambat
- lock contention
- JMS publish blocking
- file IO lambat

### 21.3 Bukti

Thread dump:

```text
http-thread-pool::http-listener-1(42)
  WAITING on JDBC pool semaphore

http-thread-pool::http-listener-1(43)
  TIMED_WAITING at SocketInputStream.socketRead
```

Metric:

```text
JDBC pool active = max
JDBC pool wait queue increasing
```

Solusi bukan tambah CPU. Solusi adalah memperbaiki downstream/backpressure.

---

## 22. Request Correlation di Topology Proxy + GlassFish

Untuk troubleshooting cepat, semua layer harus membawa request id yang sama.

### 22.1 Header correlation

Gunakan header seperti:

```http
X-Request-ID: 01HX...
X-Correlation-ID: case-flow-...
```

Proxy dapat membuat jika belum ada:

```nginx
proxy_set_header X-Request-ID $request_id;
```

Application filter membaca dan menaruh ke MDC/log context.

### 22.2 Log correlation

Idealnya bisa query:

```text
correlation_id = abc123
```

Dan menemukan:

```text
proxy access log
GlassFish access log
application log
DB audit/log bila ada
remote service log
```

Tanpa correlation, troubleshooting berubah menjadi pencarian timestamp manual yang rentan salah.

---

## 23. GlassFish di Kubernetes: HTTP Runtime Considerations

GlassFish bisa dijalankan di container/Kubernetes, tetapi application server tradisional punya state/config model yang harus disesuaikan.

### 23.1 Container port

Expose application listener:

```yaml
ports:
  - containerPort: 8080
```

Jangan expose admin listener secara publik.

### 23.2 Probes

```yaml
livenessProbe:
  httpGet:
    path: /health/live
    port: 8080

readinessProbe:
  httpGet:
    path: /health/ready
    port: 8080

startupProbe:
  httpGet:
    path: /health/live
    port: 8080
  failureThreshold: 60
  periodSeconds: 5
```

### 23.3 Graceful shutdown

Ketika pod menerima SIGTERM:

1. Kubernetes menghapus pod dari endpoint readiness.
2. Traffic baru berhenti.
3. Existing request diberi waktu selesai.
4. GlassFish process dihentikan.

Pastikan termination grace period cukup untuk request normal, tetapi tidak terlalu panjang.

### 23.4 Access log

Di container, sebaiknya log mudah dikumpulkan oleh platform:

- stdout/stderr bila memungkinkan
- atau file log yang dibaca sidecar/agent
- rotation jelas

### 23.5 Sticky session

Jika aplikasi memakai HTTP session in-memory, scaling horizontal menjadi sulit.

Pilihan:

- sticky session di ingress/LB
- session replication
- external session store
- redesign stateless

Untuk aplikasi modern, stateless lebih mudah dioperasikan.

---

## 24. Anti-Pattern HTTP Stack GlassFish

### 24.1 Membuka admin listener ke internet

Ini risiko besar. Admin listener adalah control plane.

### 24.2 Semua traffic lewat listener default tanpa dokumentasi

Default baik untuk local. Production perlu desain eksplisit.

### 24.3 Menambah thread pool untuk semua timeout

Timeout sering disebabkan downstream latency, bukan thread count.

### 24.4 Tidak punya access log latency

Tanpa duration, kamu tidak bisa membedakan 404 cepat, 500 cepat, 504 proxy, dan request lambat.

### 24.5 Proxy rewrite path tanpa kontrak

Path rewrite menyebabkan bug context root, redirect, static assets, callback URL, dan security constraints.

### 24.6 TLS termination tanpa forwarded proto handling

Akibat:

- redirect ke HTTP
- secure cookie salah
- generated absolute URL salah
- OAuth/OIDC callback mismatch

### 24.7 Health check terlalu berat

Health check yang query banyak dependency bisa menjadi self-inflicted DDoS.

### 24.8 No timeout downstream

HTTP thread menunggu remote dependency tanpa batas adalah resep thread exhaustion.

---

## 25. Checklist Production Readiness HTTP GlassFish

### 25.1 Listener

- [ ] Application listener port/address jelas.
- [ ] Admin listener tidak public.
- [ ] Listener enabled pada target/config yang benar.
- [ ] Port tidak konflik.
- [ ] Firewall/security group sesuai.

### 25.2 Proxy/LB

- [ ] Host header dipreserve atau diset eksplisit.
- [ ] `X-Forwarded-*`/`Forwarded` contract jelas.
- [ ] TLS termination point terdokumentasi.
- [ ] Body size limit diketahui.
- [ ] Timeout diketahui.
- [ ] Health check path benar.
- [ ] Sticky session decision jelas.

### 25.3 Application routing

- [ ] Context root benar.
- [ ] Virtual server mapping benar.
- [ ] App targeted ke server/cluster yang benar.
- [ ] Deployment status enabled.

### 25.4 Capacity

- [ ] HTTP thread pool dipantau.
- [ ] JDBC pool disejajarkan dengan HTTP concurrency.
- [ ] Remote dependency timeout eksplisit.
- [ ] Load test mencakup slow dependency scenario.

### 25.5 Observability

- [ ] Access log enabled dengan duration.
- [ ] Server log centralized.
- [ ] Correlation id propagated.
- [ ] Metrics untuk HTTP/JDBC/JVM tersedia.
- [ ] Dashboard status code/latency/saturation tersedia.

### 25.6 Security

- [ ] Admin port private.
- [ ] TLS policy jelas.
- [ ] Security headers di proxy/app jelas.
- [ ] Client IP handling tidak mudah spoofed.
- [ ] Sensitive query string tidak dilog.

---

## 26. Latihan Praktis

### Latihan 1 — Mapping Request Path

Ambil satu aplikasi GlassFish yang sudah deployed. Buat diagram:

```text
External URL
  -> proxy/LB
  -> internal host/port
  -> GlassFish listener
  -> virtual server
  -> context root
  -> servlet/JAX-RS app
```

Output yang diharapkan:

```text
https://example.gov.sg/aceas/api/cases
  -> ALB listener 443
  -> target group aceas-gf:8080
  -> GlassFish http-listener-1
  -> virtual-server server
  -> context-root /aceas
  -> JAX-RS Application /api
```

### Latihan 2 — Simulasi Host Header

Test direct ke GlassFish dengan Host header berbeda:

```bash
curl -v -H 'Host: public.example.gov.sg' http://glassfish-internal:8080/aceas
curl -v -H 'Host: wrong.example.gov.sg'  http://glassfish-internal:8080/aceas
```

Analisis apakah virtual server routing berubah.

### Latihan 3 — Timeout Chain

Dokumentasikan semua timeout untuk satu endpoint penting:

```text
Browser/client
WAF/CDN
Load balancer
Reverse proxy
GlassFish
HTTP client dependency
JDBC query
DB lock wait
```

Cari timeout yang tidak masuk akal.

### Latihan 4 — 504 Drill

Buat endpoint test yang sleep 70 detik di environment non-production. Set proxy timeout 60 detik. Amati:

- proxy access log
- GlassFish access log
- server.log
- client response

Tujuannya memahami bahwa proxy bisa memberi 504 sementara GlassFish masih memproses request.

### Latihan 5 — Thread Dump Drill

Saat menjalankan load test, ambil 3 thread dump:

```bash
jcmd <pid> Thread.print > threaddump-1.txt
sleep 10
jcmd <pid> Thread.print > threaddump-2.txt
sleep 10
jcmd <pid> Thread.print > threaddump-3.txt
```

Cari pola thread HTTP.

---

## 27. Ringkasan Mental Model

HTTP stack GlassFish harus dipahami sebagai gabungan dari:

```text
Network endpoint
  + protocol behavior
  + transport/NIO processing
  + thread/concurrency budget
  + virtual host routing
  + web container dispatch
  + proxy/LB contract
  + observability boundary
```

Ingat invariants berikut:

1. **Listener menerima koneksi; virtual server memilih logical host; context root memilih aplikasi.**
2. **Grizzly/NIO membantu network scalability, tetapi business logic blocking tetap mengonsumsi execution capacity.**
3. **Timeout adalah chain; layer yang paling cepat menyerah menentukan status yang dilihat client.**
4. **502/503/504 sering berasal dari proxy, tetapi akar masalah bisa tetap ada di GlassFish, aplikasi, DB, atau network.**
5. **Thread pool tidak boleh dituning terpisah dari DB pool, remote dependency, CPU, dan latency.**
6. **Reverse proxy harus punya kontrak eksplisit: host, scheme, port, path, timeout, body size, health check, dan client IP.**
7. **Access log tanpa duration dan correlation id hanya setengah berguna.**
8. **Admin listener adalah control plane dan harus diproteksi lebih ketat daripada application listener.**

---

## 28. Referensi Resmi dan Bacaan Lanjutan

Referensi utama yang relevan untuk bagian ini:

1. Eclipse GlassFish Administration Guide — administering internet connectivity, HTTP network listeners, virtual servers, dan konfigurasi administrasi.
2. Eclipse GlassFish Reference Manual — command `create-http-listener`, `create-network-listener`, `list-http-listeners`, `list-network-listeners`, dan command terkait.
3. Eclipse GlassFish Security Guide — TLS, certificate, admin security, dan secure administration.
4. Eclipse Grizzly project documentation/source — Grizzly sebagai framework NIO untuk scalable/robust server, termasuk HTTP/S dan WebSocket support.
5. Dokumentasi reverse proxy/LB yang digunakan di environment masing-masing, misalnya Nginx, Apache HTTPD, AWS ALB, Kubernetes Ingress Controller.

---

## 29. Apa yang Tidak Dibahas di Part Ini

Agar tidak mengulang seri sebelumnya, bagian ini sengaja tidak membahas detail:

- Servlet API programming.
- JAX-RS resource design.
- CDI/EJB business logic.
- HTTP semantics umum secara mendalam.
- OAuth/OIDC flow detail.
- WebSocket programming detail.
- Nginx/Apache full administration.

Topik-topik itu hanya disentuh sejauh relevan untuk GlassFish HTTP runtime.

---

## 30. Status Seri

Part ini adalah:

```text
Part 10 dari 35
```

Seri belum selesai.

Part berikutnya:

```text
Part 11 — Thread Pools, Executor Model, Blocking, Async, dan Virtual Threads
```



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-009.md">⬅️ Part 9 — GlassFish-Specific Descriptors dan Vendor Extension</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-011.md">Part 11 — Thread Pools, Executor Model, Blocking, Async, dan Virtual Threads ➡️</a>
</div>
