# learn-nginx-mastery-for-java-engineers-part-020.md

# Part 020 — Debugging Nginx Like a Production Engineer

> Seri: `learn-nginx-mastery-for-java-engineers`  
> Bagian: `020 / 030`  
> Fokus: debugging Nginx secara sistematis di production, bukan sekadar mencoba konfigurasi sampai error hilang.

---

## 0. Posisi Bagian Ini dalam Seri

Sampai Part 019, kita sudah membahas fondasi Nginx dari arsitektur, konfigurasi, server/location selection, static file serving, reverse proxy, upstream, timeout, TLS, HTTP/2/3, compression, cache, rate limit, access control, security hardening, dan observability.

Part ini adalah titik transisi dari **mendesain konfigurasi** ke **mengoperasikan konfigurasi ketika realitas production kacau**.

Di production, masalah Nginx jarang berbentuk:

> “Directive ini salah apa benar?”

Lebih sering bentuknya:

> “Request user gagal. Dari browser terlihat 502. Dari log aplikasi tidak ada request. Tapi Nginx access log ada. Apakah upstream mati, DNS salah, timeout, TLS error, connection pool habis, atau config route salah?”

Itulah fokus Part 020.

Kita akan belajar melihat Nginx sebagai **observability and routing boundary**. Debugging Nginx berarti melacak perjalanan request melewati beberapa boundary:

```text
client
  -> DNS
  -> network
  -> TLS/SNI
  -> Nginx server selection
  -> location selection
  -> rewrite/try_files/proxy decision
  -> upstream connection
  -> upstream app
  -> upstream response
  -> Nginx response processing
  -> client connection
```

Kesalahan debugging terbesar adalah langsung lompat ke satu hipotesis:

- “Pasti backend down.”
- “Pasti Nginx salah.”
- “Pasti DNS.”
- “Pasti firewall.”
- “Pasti timeout.”
- “Pasti Spring Boot error.”

Engineer production yang matang tidak mulai dari keyakinan. Ia mulai dari **bukti**.

---

## 1. Tujuan Mental Model

Setelah menyelesaikan bagian ini, kamu harus bisa:

1. Membaca gejala Nginx berdasarkan status code, error log, access log, dan upstream timing.
2. Membedakan masalah client, Nginx, routing config, network, upstream, TLS, dan aplikasi Java.
3. Menggunakan command-line tool secara sistematis:
   - `nginx -t`
   - `nginx -T`
   - `systemctl status nginx`
   - `journalctl`
   - `curl`
   - `openssl s_client`
   - `dig`
   - `ss`
   - `lsof`
   - `tcpdump`
4. Men-debug status umum:
   - `400`
   - `403`
   - `404`
   - `413`
   - `499`
   - `502`
   - `503`
   - `504`
5. Membentuk playbook debugging yang aman untuk production.
6. Menghindari debugging destruktif seperti restart membabi buta, mengubah timeout tanpa memahami bottleneck, atau membuka akses terlalu luas saat insiden.

---

## 2. Prinsip Utama Debugging Nginx

### 2.1 Jangan Debug dari Status Code Saja

Status code adalah sinyal awal, bukan diagnosis final.

Contoh:

```text
502 Bad Gateway
```

Bisa berarti:

- upstream tidak listen,
- upstream process crash,
- upstream menutup koneksi terlalu cepat,
- upstream mengirim response invalid,
- socket path salah,
- TLS ke upstream gagal,
- DNS upstream resolve ke alamat salah,
- firewall memblokir koneksi,
- connection refused,
- protocol mismatch.

Contoh lain:

```text
404 Not Found
```

Bisa berarti:

- file memang tidak ada,
- `root` salah,
- `alias` salah,
- `try_files` salah,
- request masuk ke `server` block yang salah,
- request masuk ke `location` yang salah,
- upstream yang mengembalikan 404,
- SPA fallback tidak aktif,
- path hasil rewrite berubah.

Jadi aturan pertama:

> Status code menjawab “apa yang terlihat oleh client”, bukan “kenapa itu terjadi”.

---

### 2.2 Selalu Pisahkan Tiga Pertanyaan

Saat ada incident, selalu pisahkan:

1. **Apakah request mencapai Nginx?**
2. **Apakah Nginx memilih config path yang benar?**
3. **Apakah Nginx berhasil berbicara dengan upstream?**

Diagram sederhana:

```text
               request seen?           proxied?              response valid?
client ───────> Nginx ────────────────> upstream ───────────> Nginx ───────> client
                  │                       │                       │
                  │                       │                       └─ response processing issue
                  │                       └─ upstream/network/app issue
                  └─ routing/config/TLS/listener issue
```

Kalau request tidak ada di access log, jangan mulai dari Spring Boot.

Kalau request ada di Nginx tapi tidak ada di application log, fokus pada Nginx routing, upstream connection, timeout, atau network.

Kalau request ada di application log dan application mengembalikan error, jangan salahkan Nginx sebelum melihat upstream status.

---

### 2.3 Debugging Nginx adalah Boundary Tracing

Request production melewati banyak boundary:

| Boundary | Pertanyaan Debug |
|---|---|
| DNS | Domain resolve ke IP yang benar? |
| Network | Port reachable? Firewall/security group benar? |
| TLS | Sertifikat, SNI, ALPN, chain benar? |
| Listener | Nginx listen di port/interface yang benar? |
| Server selection | Host/SNI masuk ke `server` block yang benar? |
| Location selection | URI masuk ke `location` yang benar? |
| Rewrite/try_files | URI berubah atau fallback ke file/upstream mana? |
| Proxy | Header, upstream, timeout, buffering benar? |
| Upstream | App listen, sehat, protocol sesuai? |
| Response | Nginx menerima response valid dan mengirim ke client? |

Debugging yang baik berarti menguji boundary satu per satu.

---

## 3. Tool Dasar yang Harus Dikuasai

### 3.1 `nginx -t`: Validasi Syntax dan Basic Config

Gunakan sebelum reload.

```bash
sudo nginx -t
```

Output sukses biasanya mirip:

```text
nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
nginx: configuration file /etc/nginx/nginx.conf test is successful
```

Maknanya:

- syntax config valid,
- directive berada di context yang diperbolehkan,
- file include bisa dibaca,
- beberapa dependency file valid.

Tapi `nginx -t` **tidak membuktikan**:

- routing logic benar,
- upstream hidup,
- DNS runtime selalu benar,
- TLS chain cocok dengan domain,
- application response benar,
- timeout budget benar,
- location precedence sesuai niat.

Jadi:

```text
nginx -t sukses != sistem benar
nginx -t gagal  = jangan reload
```

---

### 3.2 `nginx -T`: Melihat Effective Config

Ini salah satu command paling penting.

```bash
sudo nginx -T
```

Berbeda dari membaca `/etc/nginx/nginx.conf` manual, `nginx -T` menampilkan konfigurasi setelah semua `include` diproses.

Gunakan untuk menjawab:

- config mana yang benar-benar ter-load?
- ada duplicate `server_name`?
- ada include file yang tidak disangka?
- directive mana yang menang?
- apakah config hasil template sesuai?
- apakah environment variable sudah dirender benar?

Contoh simpan output untuk review:

```bash
sudo nginx -T > /tmp/nginx-effective-config.txt
```

Cari server block:

```bash
grep -n "server_name api.example.com" /tmp/nginx-effective-config.txt
```

Cari proxy target:

```bash
grep -n "proxy_pass" /tmp/nginx-effective-config.txt
```

Cari location tertentu:

```bash
grep -n "location" /tmp/nginx-effective-config.txt
```

Mental model:

> Jangan debug config yang kamu pikir sedang berjalan. Debug config yang benar-benar sedang berjalan.

---

### 3.3 `systemctl status nginx`

Untuk package berbasis systemd:

```bash
sudo systemctl status nginx
```

Gunakan untuk melihat:

- service aktif atau gagal,
- main PID,
- recent log,
- start/reload failure,
- exit code.

Contoh:

```bash
sudo systemctl is-active nginx
sudo systemctl is-enabled nginx
```

---

### 3.4 `journalctl`: Log Service-Level

```bash
sudo journalctl -u nginx --since "30 minutes ago"
```

Follow log:

```bash
sudo journalctl -u nginx -f
```

Untuk boot saat ini:

```bash
sudo journalctl -u nginx -b
```

Gunakan ketika:

- Nginx gagal start,
- reload gagal,
- permission error muncul saat service start,
- systemd membunuh process,
- unit file salah.

---

### 3.5 Access Log dan Error Log

Default umum:

```text
/var/log/nginx/access.log
/var/log/nginx/error.log
```

Tapi lokasi bisa berbeda tergantung package/config.

Cek effective config:

```bash
sudo nginx -T | grep -n "access_log\|error_log"
```

Tail log:

```bash
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

Filter status:

```bash
awk '$9 ~ /^5/ { print }' /var/log/nginx/access.log | tail -50
```

Filter request tertentu:

```bash
grep "request-id-abc" /var/log/nginx/access.log
```

Kalau access log punya upstream fields, debugging jauh lebih cepat.

Contoh format yang berguna:

```nginx
log_format main_ext escape=json
  '{'
    '"time":"$time_iso8601",'
    '"remote_addr":"$remote_addr",'
    '"request_id":"$request_id",'
    '"host":"$host",'
    '"method":"$request_method",'
    '"uri":"$request_uri",'
    '"status":$status,'
    '"body_bytes_sent":$body_bytes_sent,'
    '"request_time":$request_time,'
    '"upstream_addr":"$upstream_addr",'
    '"upstream_status":"$upstream_status",'
    '"upstream_connect_time":"$upstream_connect_time",'
    '"upstream_header_time":"$upstream_header_time",'
    '"upstream_response_time":"$upstream_response_time",'
    '"http_user_agent":"$http_user_agent"'
  '}';
```

Field penting:

| Field | Makna |
|---|---|
| `$status` | status final ke client |
| `$request_time` | total waktu request di Nginx |
| `$upstream_status` | status dari upstream |
| `$upstream_addr` | upstream yang dipilih |
| `$upstream_connect_time` | waktu connect ke upstream |
| `$upstream_header_time` | waktu sampai header upstream diterima |
| `$upstream_response_time` | total waktu upstream response |

Contoh interpretasi:

```text
status=504 request_time=60.001 upstream_response_time=60.000
```

Kemungkinan besar Nginx menunggu upstream sampai timeout.

```text
status=502 upstream_status="-" upstream_connect_time="-"
```

Kemungkinan request tidak berhasil connect ke upstream.

```text
status=499 request_time=10.000 upstream_response_time=12.000
```

Client pergi sebelum response selesai.

---

## 4. Reload vs Restart vs Stop: Jangan Salah Operasi

### 4.1 Reload

Reload berarti Nginx membaca config baru dan mengganti worker secara graceful.

```bash
sudo nginx -t && sudo systemctl reload nginx
```

Atau:

```bash
sudo nginx -s reload
```

Secara konsep:

1. master process menerima sinyal reload,
2. master membaca config baru,
3. jika valid, master membuat worker baru,
4. worker lama berhenti menerima koneksi baru,
5. worker lama menyelesaikan request existing,
6. worker lama exit.

Reload adalah operasi normal setelah config berubah.

NGINX documentation menjelaskan bahwa kontrol runtime dapat dilakukan dengan mengirim signal ke master process menggunakan `nginx -s <SIGNAL>`, termasuk reload, quit, reopen, dan stop. Dokumentasi NGINX Gateway Fabric juga menggambarkan reload sebagai graceful reload yang tidak menjatuhkan client request saat konfigurasi diperbarui. Referensi resmi: NGINX runtime control dan graceful reload behavior.  
Source: NGINX documentation.

---

### 4.2 Restart

Restart menghentikan service lalu menyalakannya kembali.

```bash
sudo systemctl restart nginx
```

Restart lebih disruptif daripada reload.

Gunakan restart jika:

- binary berubah,
- module berubah,
- service state rusak,
- reload tidak cukup,
- maintenance window memungkinkan.

Jangan jadikan restart sebagai refleks debugging pertama.

---

### 4.3 Stop

```bash
sudo systemctl stop nginx
```

Stop akan membuat service tidak menerima traffic.

Hanya gunakan jika memang ingin mematikan Nginx atau ada orchestrator/HA layer yang akan mengalihkan traffic.

---

### 4.4 Safe Config Change Pattern

Pattern aman:

```bash
sudo cp /etc/nginx/nginx.conf /etc/nginx/nginx.conf.bak.$(date +%Y%m%d%H%M%S)
sudo nginx -t
sudo systemctl reload nginx
sudo systemctl status nginx --no-pager
```

Untuk perubahan kompleks:

```bash
sudo nginx -T > /tmp/nginx-before.txt
# edit config
sudo nginx -t
sudo nginx -T > /tmp/nginx-after.txt
diff -u /tmp/nginx-before.txt /tmp/nginx-after.txt | less
sudo systemctl reload nginx
```

Prinsip:

> Perubahan Nginx harus observable, reversible, dan tervalidasi sebelum masuk jalur traffic.

---

## 5. `curl` sebagai Debugger HTTP Utama

`curl` adalah alat paling penting untuk debugging Nginx dari sisi HTTP.

### 5.1 Basic Request

```bash
curl -v http://example.com/
```

`-v` menunjukkan:

- DNS resolution,
- connection attempt,
- request headers,
- response headers,
- status code.

---

### 5.2 Cek Header Saja

```bash
curl -I https://example.com/
```

Gunakan untuk:

- cek status,
- cek redirect,
- cek cache header,
- cek security header,
- cek server header,
- cek content type.

---

### 5.3 Paksa Host Header ke IP Tertentu

Ini sangat berguna untuk menguji Nginx sebelum DNS diarahkan.

```bash
curl -v http://203.0.113.10/ -H 'Host: api.example.com'
```

Atau untuk HTTPS gunakan `--resolve`:

```bash
curl -v --resolve api.example.com:443:203.0.113.10 https://api.example.com/
```

`--resolve` memaksa domain tertentu resolve ke IP tertentu hanya untuk command itu.

Gunakan untuk:

- pre-production cutover,
- cek server block,
- cek TLS SNI,
- cek host routing,
- membedakan DNS problem vs Nginx problem.

---

### 5.4 Tampilkan Timing

```bash
curl -o /dev/null -s -w \
'namelookup=%{time_namelookup}\nconnect=%{time_connect}\nappconnect=%{time_appconnect}\npretransfer=%{time_pretransfer}\nstarttransfer=%{time_starttransfer}\ntotal=%{time_total}\nhttp_code=%{http_code}\n' \
https://api.example.com/health
```

Interpretasi:

| Metric | Makna |
|---|---|
| `time_namelookup` | DNS lookup time |
| `time_connect` | TCP connect time |
| `time_appconnect` | TLS handshake time |
| `time_starttransfer` | time to first byte |
| `time_total` | total request time |

Jika `time_connect` tinggi, curigai network/path/firewall.

Jika `time_appconnect` tinggi, curigai TLS handshake.

Jika `time_starttransfer` tinggi, curigai upstream processing atau buffering.

---

### 5.5 Ikuti Redirect

```bash
curl -v -L https://example.com/
```

Untuk melihat chain redirect:

```bash
curl -I -L https://example.com/
```

Gunakan saat:

- HTTP ke HTTPS redirect loop,
- `/login` loop,
- backend redirect ke internal host,
- scheme salah karena `X-Forwarded-Proto` tidak diproses aplikasi.

---

### 5.6 Test Method dan Body

```bash
curl -v -X POST https://api.example.com/orders \
  -H 'Content-Type: application/json' \
  -d '{"item":"book"}'
```

Upload body besar:

```bash
dd if=/dev/zero bs=1M count=20 of=/tmp/20mb.bin
curl -v -X POST https://api.example.com/upload \
  -F file=@/tmp/20mb.bin
```

Gunakan untuk debug `413 Request Entity Too Large`.

---

## 6. `openssl s_client` untuk TLS Debugging

### 6.1 Cek Sertifikat dan SNI

```bash
openssl s_client -connect api.example.com:443 -servername api.example.com
```

Tanpa `-servername`, kamu tidak mengirim SNI.

```bash
openssl s_client -connect 203.0.113.10:443 -servername api.example.com
```

Gunakan untuk:

- cek certificate CN/SAN,
- cek chain,
- cek expiry,
- cek selected protocol,
- cek apakah SNI memilih certificate yang benar.

---

### 6.2 Cek Certificate Expiry

```bash
echo | openssl s_client -connect api.example.com:443 -servername api.example.com 2>/dev/null \
  | openssl x509 -noout -dates -subject -issuer
```

Output:

```text
notBefore=...
notAfter=...
subject=...
issuer=...
```

---

### 6.3 Cek ALPN

```bash
openssl s_client -connect api.example.com:443 \
  -servername api.example.com \
  -alpn h2,http/1.1
```

Cari:

```text
ALPN protocol: h2
```

Jika expected HTTP/2 tapi hasilnya HTTP/1.1, cek:

- `listen 443 ssl http2;` atau konfigurasi HTTP/2 versi baru,
- TLS config,
- client support,
- intermediary proxy/CDN.

---

## 7. DNS Debugging dengan `dig`

### 7.1 Cek A/AAAA Record

```bash
dig api.example.com A

dig api.example.com AAAA
```

Cek singkat:

```bash
dig +short api.example.com
```

---

### 7.2 Cek dari Resolver Tertentu

```bash
dig @8.8.8.8 api.example.com

dig @1.1.1.1 api.example.com
```

Gunakan untuk membandingkan resolver.

---

### 7.3 Trace DNS Delegation

```bash
dig +trace api.example.com
```

Gunakan jika masalah DNS terlihat seperti propagasi/delegation.

---

### 7.4 Debug DNS di Nginx Upstream

Masalah umum:

```nginx
proxy_pass http://backend-service:8080;
```

Jika nama host berubah IP, perilaku resolution tergantung bentuk konfigurasi dan resolver.

Untuk dynamic DNS dalam Nginx, biasanya perlu:

```nginx
resolver 10.96.0.10 valid=10s ipv6=off;
set $backend "http://backend-service.default.svc.cluster.local:8080";
proxy_pass $backend;
```

Catatan penting:

- Jangan gunakan pattern ini tanpa memahami konsekuensi variable `proxy_pass`.
- Di Kubernetes, NGINX Ingress Controller memiliki mekanisme sendiri; jangan menyamakan dengan Nginx Open Source static config.
- DNS issue sering terlihat sebagai 502/504, bukan error DNS yang ramah.

---

## 8. Network and Socket Debugging

### 8.1 `ss`: Apakah Port Listen?

```bash
sudo ss -tulpen | grep nginx
```

Cek port 80/443:

```bash
sudo ss -tulpen | grep ':80\|:443'
```

Cek upstream Java:

```bash
sudo ss -tulpen | grep ':8080'
```

Interpretasi:

```text
LISTEN 0 511 0.0.0.0:80
```

Artinya listen di semua IPv4 interface port 80.

```text
LISTEN 0 4096 127.0.0.1:8080
```

Artinya hanya local machine bisa connect ke port 8080.

Kalau Nginx berada di host yang sama, ini bisa benar. Kalau Nginx di container/host lain, ini bisa salah.

---

### 8.2 Cek Established Connections

```bash
sudo ss -tan state established | head
```

Cek koneksi ke upstream:

```bash
sudo ss -tan | grep ':8080'
```

Banyak koneksi `TIME-WAIT`, `SYN-SENT`, atau `CLOSE-WAIT` dapat memberi sinyal berbeda.

| State | Kemungkinan Makna |
|---|---|
| `SYN-SENT` | mencoba connect, belum dijawab; firewall/path issue |
| `ESTABLISHED` | koneksi aktif |
| `TIME-WAIT` | koneksi selesai normal, banyak bisa normal tapi perlu capacity check |
| `CLOSE-WAIT` | peer menutup koneksi, process lokal belum close; bisa leak/problem app |

---

### 8.3 `lsof`: Process Mana Memegang Port/File?

```bash
sudo lsof -i :80
sudo lsof -i :443
sudo lsof -i :8080
```

Cek file log:

```bash
sudo lsof | grep access.log
```

Cek deleted file yang masih dipegang process:

```bash
sudo lsof | grep deleted
```

Ini penting saat disk penuh walaupun file log sudah dihapus. Jika file sudah dihapus tapi masih dipegang process, space belum kembali sampai file descriptor ditutup.

Untuk Nginx log rotate, biasanya gunakan:

```bash
sudo nginx -s reopen
```

---

### 8.4 Test TCP Reachability

```bash
nc -vz 127.0.0.1 8080
nc -vz backend.internal 8080
```

Atau dengan bash:

```bash
timeout 3 bash -c '</dev/tcp/backend.internal/8080' && echo ok || echo failed
```

Jika TCP tidak connect, jangan debug Spring controller.

---

### 8.5 `tcpdump`: Bukti Paket

Gunakan saat log tidak cukup.

```bash
sudo tcpdump -nn -i any port 8080
```

Cek traffic dari Nginx ke upstream:

```bash
sudo tcpdump -nn -i any host 10.0.1.25 and port 8080
```

Cek handshake:

```bash
sudo tcpdump -nn -i any 'tcp[tcpflags] & (tcp-syn|tcp-ack) != 0 and port 8080'
```

Gunakan `tcpdump` untuk membuktikan:

- apakah Nginx mengirim packet ke upstream,
- apakah upstream menjawab,
- apakah ada retransmission,
- apakah koneksi reset,
- apakah traffic masuk ke interface yang benar.

Hati-hati:

- jangan capture payload sensitif sembarangan,
- batasi filter,
- batasi durasi,
- simpan pcap hanya jika perlu.

---

## 9. Debugging by Status Code

Bagian ini adalah playbook praktis. Jangan hafalkan sebagai daftar sebab final. Gunakan sebagai decision tree.

---

## 9.1 Debug `400 Bad Request`

### Gejala

Client menerima:

```text
400 Bad Request
```

Di error log mungkin ada:

```text
client sent invalid request
client sent too long header line
client sent invalid host header
```

### Kemungkinan Penyebab

1. Header terlalu besar.
2. Request line terlalu besar.
3. Host header invalid.
4. Malformed HTTP request.
5. Client berbicara HTTPS ke port HTTP atau sebaliknya.
6. Proxy/CDN mengirim request aneh.
7. Ada newline/control character di header.

### Directive Terkait

```nginx
client_header_buffer_size 1k;
large_client_header_buffers 4 8k;
```

### Debug Step

1. Cek error log:

```bash
sudo tail -100 /var/log/nginx/error.log
```

2. Cek request dengan curl:

```bash
curl -v http://example.com/
```

3. Cek apakah HTTPS/HTTP tertukar:

```bash
curl -v http://example.com:443/
curl -vk https://example.com:80/
```

4. Cek ukuran header jika request dari browser membawa cookie besar.

### Untuk Aplikasi Java

Cookie besar sering berasal dari:

- session data disimpan di cookie,
- JWT terlalu besar,
- banyak tracking cookie,
- repeated cookie karena domain/path salah,
- reverse proxy/CDN menambahkan banyak header.

Solusi bukan selalu menaikkan buffer. Kadang masalah sebenarnya adalah desain cookie/session.

---

## 9.2 Debug `403 Forbidden`

### Gejala

Client menerima:

```text
403 Forbidden
```

### Kemungkinan Penyebab

1. File permission salah.
2. Directory tidak punya execute permission.
3. `deny` rule match.
4. Basic auth gagal.
5. `autoindex off` dan directory tanpa index.
6. SELinux/AppArmor memblokir access.
7. `internal` location diakses langsung.
8. Nginx worker user tidak bisa baca file.

### Debug Step

1. Cek error log:

```bash
sudo tail -100 /var/log/nginx/error.log
```

Pesan umum:

```text
permission denied
access forbidden by rule
directory index of ... is forbidden
```

2. Cek user Nginx:

```bash
ps aux | grep nginx
```

3. Cek permission path penuh:

```bash
namei -l /var/www/app/index.html
```

`namei -l` penting karena file bisa readable, tapi parent directory tidak executable.

4. Cek allow/deny:

```bash
sudo nginx -T | grep -n "allow\|deny\|satisfy\|auth_basic\|internal"
```

### Prinsip

Untuk static file:

```text
Nginx butuh read permission pada file dan execute permission pada seluruh parent directory.
```

Untuk endpoint internal:

```nginx
location /internal/ {
    internal;
}
```

Client langsung ke `/internal/` memang harus 404/403, tergantung flow.

---

## 9.3 Debug `404 Not Found`

### Gejala

Client menerima 404.

### Pertanyaan Pertama

404 berasal dari Nginx atau upstream?

Cek access log jika ada `$upstream_status`:

```text
status=404 upstream_status="-"
```

Kemungkinan Nginx sendiri yang 404.

```text
status=404 upstream_status="404"
```

Kemungkinan upstream Java yang mengembalikan 404.

### Kemungkinan Penyebab Nginx-Side

1. `root` salah.
2. `alias` salah.
3. `try_files` gagal.
4. Location salah match.
5. Server block salah.
6. URI rewrite salah.
7. SPA fallback belum benar.
8. File deploy belum ada.

### Debug Step

1. Paksa Host ke IP:

```bash
curl -v http://203.0.113.10/some/path -H 'Host: app.example.com'
```

2. Cek effective config:

```bash
sudo nginx -T | less
```

3. Cek location yang mungkin match.

4. Cek file path yang diharapkan:

```bash
ls -lah /var/www/app
ls -lah /var/www/app/some/path
```

5. Untuk SPA, cek config:

```nginx
location / {
    try_files $uri $uri/ /index.html;
}
```

6. Untuk API, pastikan API tidak tertelan SPA:

```nginx
location /api/ {
    proxy_pass http://backend;
}

location / {
    try_files $uri $uri/ /index.html;
}
```

### Trap Umum

```nginx
location / {
    try_files $uri $uri/ /index.html;
}

location ~ \.php$ {
    # unexpected regex precedence in some cases
}
```

Atau:

```nginx
location /api {
    proxy_pass http://backend/;
}
```

Tanpa memahami trailing slash semantics, URI bisa berubah tidak sesuai harapan.

---

## 9.4 Debug `413 Request Entity Too Large`

### Gejala

Upload gagal dengan:

```text
413 Request Entity Too Large
```

### Penyebab

Request body lebih besar dari limit Nginx.

Directive utama:

```nginx
client_max_body_size 10m;
```

Default bisa terlalu kecil untuk upload aplikasi tertentu.

### Debug Step

1. Cek config:

```bash
sudo nginx -T | grep -n "client_max_body_size"
```

2. Cek context directive:

```nginx
http {
    client_max_body_size 20m;
}

server {
    client_max_body_size 50m;
}

location /upload/ {
    client_max_body_size 200m;
}
```

3. Test upload:

```bash
dd if=/dev/zero of=/tmp/test-50mb.bin bs=1M count=50
curl -v -F file=@/tmp/test-50mb.bin https://api.example.com/upload
```

### Untuk Java Backend

Jangan hanya naikkan Nginx limit. Samakan dengan:

- Spring multipart max file size,
- servlet max request size,
- application gateway limit,
- cloud load balancer limit,
- business rule limit,
- disk/temp storage capacity,
- upload timeout.

Contoh Spring Boot properties:

```properties
spring.servlet.multipart.max-file-size=100MB
spring.servlet.multipart.max-request-size=100MB
```

Kalau Nginx 200MB tapi Java 10MB, user tetap gagal tetapi gejalanya berpindah ke upstream.

---

## 9.5 Debug `499 Client Closed Request`

### Makna

`499` adalah status Nginx-specific yang berarti client menutup koneksi sebelum Nginx bisa mengirim response final.

Cloudflare documentation juga menjelaskan 499 sebagai status khusus Nginx ketika client menutup koneksi saat server masih memproses request. Ini bukan status HTTP standar dari RFC, tetapi sinyal operasional yang sangat penting.

### Penyebab Umum

1. Client timeout lebih pendek dari backend processing.
2. Browser user cancel/refresh.
3. Mobile network drop.
4. CDN/load balancer di depan Nginx timeout duluan.
5. Application lambat.
6. Response streaming idle terlalu lama.
7. Client library timeout terlalu agresif.

### Debug Step

1. Cek pola di access log:

```bash
awk '$9 == 499 { print }' /var/log/nginx/access.log | tail -50
```

2. Lihat request time:

```text
status=499 request_time=30.001 upstream_response_time=30.000
```

Jika 499 selalu sekitar angka tertentu seperti 10s, 30s, 60s, curigai timeout client/CDN/load balancer.

3. Cocokkan dengan application log.

Jika app masih memproses setelah client pergi, kamu bisa membuang kapasitas untuk pekerjaan yang hasilnya tidak pernah dipakai.

### Untuk Java Backend

Pertanyaan penting:

- Apakah endpoint cancellable?
- Apakah query database tetap berjalan walau client disconnected?
- Apakah async job lebih tepat daripada request synchronous panjang?
- Apakah timeout client, Nginx, dan app diselaraskan?
- Apakah idempotency key dibutuhkan untuk retry?

### Kesalahan Umum

Melihat 499 lalu menyimpulkan:

> “Nginx error.”

Padahal sering kali 499 adalah sinyal bahwa **client patience budget lebih kecil daripada server latency**.

---

## 9.6 Debug `502 Bad Gateway`

### Makna

Nginx sebagai gateway/proxy tidak mendapat response valid dari upstream.

### Pesan Error Log Umum

```text
connect() failed (111: Connection refused) while connecting to upstream
```

Artinya upstream host reachable tapi port tidak menerima koneksi.

```text
upstream prematurely closed connection while reading response header from upstream
```

Artinya koneksi upstream tertutup sebelum header response lengkap.

```text
no live upstreams while connecting to upstream
```

Artinya semua upstream dianggap unavailable.

```text
host not found in upstream
```

Artinya DNS/name resolution gagal saat config parse atau runtime tergantung config.

### Decision Tree

#### Step 1: Apakah upstream listen?

Di host upstream:

```bash
sudo ss -tulpen | grep ':8080'
```

Dari host Nginx:

```bash
nc -vz backend.internal 8080
curl -v http://backend.internal:8080/health
```

#### Step 2: Apakah `proxy_pass` benar?

```bash
sudo nginx -T | grep -n "proxy_pass\|upstream"
```

Cek:

- host,
- port,
- scheme `http` vs `https`,
- path,
- trailing slash,
- upstream block.

#### Step 3: Apakah protocol sesuai?

Salah:

```nginx
proxy_pass http://backend_tls:8443;
```

Padahal upstream butuh HTTPS:

```nginx
proxy_pass https://backend_tls:8443;
```

Atau sebaliknya.

#### Step 4: Apakah aplikasi crash saat request?

Cek Java logs:

```bash
journalctl -u my-java-app --since "10 minutes ago"
```

Atau container logs:

```bash
kubectl logs deploy/my-java-app --since=10m
```

#### Step 5: Apakah upstream menutup koneksi terlalu cepat?

Kemungkinan:

- app crash,
- JVM OOM,
- server thread pool exhausted,
- reverse proxy timeout mismatch,
- response header terlalu besar,
- app menggunakan keepalive tidak kompatibel,
- deployment sedang restart.

### Untuk Java Backend

502 sering muncul saat:

- Spring Boot belum ready tapi port sudah open,
- readiness probe salah,
- graceful shutdown tidak benar,
- Tomcat max threads habis,
- Netty event loop blocked,
- JVM GC pause panjang,
- app restart saat request berjalan,
- upstream hanya bind ke `127.0.0.1` padahal Nginx di container lain.

---

## 9.7 Debug `503 Service Unavailable`

### Makna

Service tidak tersedia. Bisa berasal dari Nginx atau upstream.

### Penyebab Nginx-Side

1. Rate limiting dengan status custom 503.
2. `limit_req` default rejection status.
3. Semua upstream down/unavailable.
4. Maintenance config.
5. `return 503` manual.
6. No live upstreams.

### Debug Step

1. Cek access/error log.
2. Cek apakah ada `limit_req`:

```bash
sudo nginx -T | grep -n "limit_req\|limit_conn\|return 503"
```

3. Cek upstream:

```bash
sudo nginx -T | grep -n "upstream"
```

4. Cek apakah 503 berasal dari upstream:

```text
status=503 upstream_status="503"
```

Atau dari Nginx:

```text
status=503 upstream_status="-"
```

### Untuk Java Backend

503 dari aplikasi bisa berarti:

- app deliberately unhealthy,
- circuit breaker open,
- dependency down,
- maintenance mode,
- thread pool saturated,
- readiness false.

Nginx-side 503 sering berarti config/rate-limit/upstream availability problem.

---

## 9.8 Debug `504 Gateway Timeout`

### Makna

Nginx tidak menerima response tepat waktu dari upstream.

### Directive Terkait

```nginx
proxy_connect_timeout 3s;
proxy_send_timeout 30s;
proxy_read_timeout 60s;
```

### Error Log Umum

```text
upstream timed out (110: Connection timed out) while connecting to upstream
```

atau:

```text
upstream timed out (110: Connection timed out) while reading response header from upstream
```

Perbedaannya penting.

| Error | Makna |
|---|---|
| while connecting to upstream | Nginx gagal establish koneksi tepat waktu |
| while sending request to upstream | Nginx gagal mengirim request body/header tepat waktu |
| while reading response header from upstream | upstream belum mengirim response header tepat waktu |
| while reading upstream | response sudah mulai tapi berhenti/lambat |

### Debug Step

1. Cek access log timing:

```text
status=504 request_time=60.001 upstream_response_time=60.000
```

2. Cek error log detail:

```bash
grep "upstream timed out" /var/log/nginx/error.log | tail -50
```

3. Cek upstream health langsung:

```bash
curl -v http://backend.internal:8080/health
```

4. Cek endpoint lambat langsung:

```bash
curl -v http://backend.internal:8080/reports/monthly
```

5. Cek app logs, database logs, thread dump.

Untuk Java:

```bash
jcmd <pid> Thread.print > /tmp/thread-dump.txt
jcmd <pid> GC.heap_info
```

Atau container/JDK tooling sesuai environment.

### Jangan Langsung Naikkan Timeout

Menaikkan `proxy_read_timeout` dari 60s ke 300s bisa menyembunyikan masalah.

Pertanyaan yang lebih benar:

- Endpoint ini seharusnya synchronous atau async job?
- Apakah query database lambat?
- Apakah thread pool habis?
- Apakah upstream melakukan blocking I/O?
- Apakah timeout client lebih pendek dari Nginx?
- Apakah load balancer depan Nginx punya timeout 60s?
- Apakah user akan menunggu 5 menit?

Timeout adalah kontrak produk dan arsitektur, bukan hanya angka teknis.

---

## 10. Debugging Server Selection

Masalah server selection biasanya terlihat seperti:

- domain A menampilkan app domain B,
- sertifikat salah,
- request masuk ke default backend,
- Host header unknown tetap dilayani,
- redirect ke domain salah.

### 10.1 Cek Server Block Aktif

```bash
sudo nginx -T | grep -n "listen\|server_name"
```

Cari:

```nginx
server {
    listen 443 ssl default_server;
    server_name _;
}
```

Dan:

```nginx
server {
    listen 443 ssl;
    server_name api.example.com;
}
```

### 10.2 Test dengan Curl

HTTP:

```bash
curl -v http://203.0.113.10/ -H 'Host: api.example.com'
```

HTTPS:

```bash
curl -v --resolve api.example.com:443:203.0.113.10 https://api.example.com/
```

### 10.3 Test SNI dengan OpenSSL

```bash
openssl s_client -connect 203.0.113.10:443 -servername api.example.com
```

Tanpa SNI:

```bash
openssl s_client -connect 203.0.113.10:443
```

Jika certificate berbeda, berarti SNI selection berperan.

### 10.4 Hardening Unknown Host

```nginx
server {
    listen 80 default_server;
    server_name _;
    return 444;
}

server {
    listen 443 ssl default_server;
    server_name _;
    ssl_certificate     /etc/nginx/certs/default.crt;
    ssl_certificate_key /etc/nginx/certs/default.key;
    return 444;
}
```

Catatan:

- `444` adalah Nginx-specific close connection.
- Untuk beberapa environment, lebih baik return `404` atau `421` tergantung kebutuhan observability dan client behavior.

---

## 11. Debugging Location Selection

### 11.1 Gejala

- `/api/users` malah melayani `index.html`.
- static asset masuk upstream.
- `/download/file.pdf` 404 padahal file ada.
- regex location menang tanpa disangka.
- `alias` menghasilkan path salah.

### 11.2 Effective Config adalah Wajib

```bash
sudo nginx -T > /tmp/nginx.txt
```

Cari semua location dalam server block terkait.

```bash
grep -n "location" /tmp/nginx.txt
```

### 11.3 Tambahkan Debug Header Sementara

Di environment non-production atau saat aman:

```nginx
location /api/ {
    add_header X-Debug-Location "api" always;
    proxy_pass http://backend;
}

location / {
    add_header X-Debug-Location "spa" always;
    try_files $uri $uri/ /index.html;
}
```

Test:

```bash
curl -I https://app.example.com/api/users
```

Hati-hati jangan meninggalkan debug header yang membocorkan internal detail di production.

### 11.4 Gunakan Error Log Debug dengan Sangat Hati-Hati

Nginx bisa dibuild dengan debug support dan `error_log ... debug;`, tetapi ini sangat verbose.

```nginx
error_log /var/log/nginx/error.log debug;
```

Gunakan hanya sementara dan dengan scope terbatas bila memungkinkan.

---

## 12. Debugging Upstream Java App

### 12.1 Pertanyaan Minimum

Saat Nginx proxy ke Java app, tanyakan:

1. App listen di host/port mana?
2. App bind ke `127.0.0.1` atau `0.0.0.0`?
3. Nginx berada di host yang sama, container yang sama, atau network lain?
4. App siap menerima request atau baru port-open?
5. Health endpoint valid?
6. App menggunakan HTTP atau HTTPS?
7. App butuh context path?
8. App memahami forwarded headers?
9. Timeout app lebih pendek/panjang dari Nginx?
10. Graceful shutdown app selaras dengan Nginx/upstream?

---

### 12.2 Bind Address Trap

Spring Boot default sering listen di semua interface jika tidak diubah:

```properties
server.address=0.0.0.0
server.port=8080
```

Jika diset:

```properties
server.address=127.0.0.1
```

Maka hanya local host yang bisa connect.

Jika Nginx di container berbeda, `127.0.0.1` berarti container Nginx sendiri, bukan container Java.

---

### 12.3 Context Path Trap

Jika Java app punya:

```properties
server.servlet.context-path=/app
```

Maka upstream endpoint sebenarnya:

```text
http://backend:8080/app/api/users
```

Nginx config harus sesuai:

```nginx
location /api/ {
    proxy_pass http://backend:8080/app/api/;
}
```

Atau aplikasi tidak memakai context path dan Nginx menjaga path tetap sama.

Jangan menebak. Test langsung upstream:

```bash
curl -v http://backend:8080/actuator/health
curl -v http://backend:8080/app/actuator/health
```

---

### 12.4 Thread Pool Exhaustion

Nginx error bisa terlihat seperti 504, tetapi akar masalah Java adalah thread pool habis.

Cek gejala:

- request ke app menggantung,
- CPU rendah tetapi latency tinggi,
- banyak thread `WAITING`/`BLOCKED`,
- DB pool habis,
- external API dependency lambat,
- GC pause.

Ambil thread dump:

```bash
jcmd <pid> Thread.print > /tmp/thread-dump.txt
```

Cari:

- blocked on connection pool,
- blocked on synchronized lock,
- waiting on database call,
- Netty event loop blocked,
- Tomcat executor saturated.

---

## 13. Debugging Config Shadowing

Config shadowing terjadi ketika directive yang kamu baca bukan directive yang benar-benar berlaku.

Contoh:

```nginx
http {
    client_max_body_size 100m;

    server {
        server_name api.example.com;

        location /upload/ {
            client_max_body_size 10m;
            proxy_pass http://backend;
        }
    }
}
```

Kamu mungkin berpikir limit 100MB, tapi untuk `/upload/` limit 10MB.

### Teknik

1. Dump effective config:

```bash
sudo nginx -T > /tmp/nginx.txt
```

2. Cari directive:

```bash
grep -n "client_max_body_size" /tmp/nginx.txt
```

3. Tentukan context paling spesifik yang berlaku.

Prinsip:

> Saat debugging inheritance, cari directive terdekat dari request execution path, bukan directive yang paling mudah ditemukan.

---

## 14. Debugging Redirect Loop

### Gejala

Browser:

```text
ERR_TOO_MANY_REDIRECTS
```

`curl -I -L` menunjukkan berulang:

```text
HTTP/1.1 301 Moved Permanently
Location: https://example.com/
HTTP/1.1 301 Moved Permanently
Location: https://example.com/
...
```

### Penyebab Umum

1. Nginx redirect HTTP -> HTTPS, tapi upstream mengira request HTTP.
2. CDN terminates TLS, Nginx menerima HTTP, Nginx redirect lagi.
3. Spring Security requires HTTPS karena scheme salah.
4. `X-Forwarded-Proto` tidak dikirim atau tidak dipercaya.
5. App canonical host redirect bertabrakan dengan Nginx redirect.

### Debug Step

1. Cek chain:

```bash
curl -I -L https://example.com/
```

2. Cek header ke upstream:

```nginx
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host $host;
proxy_set_header X-Forwarded-Port $server_port;
```

3. Jika Nginx berada di belakang CDN/load balancer, `$scheme` mungkin `http` walau original client HTTPS.

Maka perlu trust header dari upstream proxy depan dengan hati-hati.

4. Cek Spring Boot forwarded header strategy:

```properties
server.forward-headers-strategy=framework
```

Atau sesuai versi/framework.

### Prinsip

Redirect loop biasanya bukan masalah redirect saja. Itu masalah **ketidaksepakatan antar layer tentang URL canonical**.

---

## 15. Debugging WebSocket/SSE/gRPC Cepat

Walau detailnya ada Part 022, debugging dasar perlu dikenal.

### 15.1 WebSocket Disconnect

Config minimal:

```nginx
location /ws/ {
    proxy_pass http://backend;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 1h;
}
```

Gejala disconnect sekitar 60 detik biasanya timeout.

Debug:

```bash
curl -i -N \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Host: example.com" \
  -H "Origin: https://example.com" \
  https://example.com/ws/
```

Tool khusus seperti `websocat` lebih nyaman.

---

### 15.2 SSE Buffered

Gejala:

- backend mengirim event periodik,
- browser menerima semuanya sekaligus setelah lama,
- atau tidak menerima sampai response selesai.

Config:

```nginx
location /events/ {
    proxy_pass http://backend;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 1h;
}
```

---

### 15.3 gRPC

gRPC butuh HTTP/2.

Nginx config berbeda:

```nginx
location /my.Service/ {
    grpc_pass grpc://backend:9090;
}
```

Debug dengan:

```bash
grpcurl -plaintext backend:9090 list
```

Atau lewat TLS sesuai environment.

---

## 16. Debugging Disk, Logs, and Cache Issues

### 16.1 Disk Full

Nginx bisa gagal karena:

- access log membesar,
- error log membesar,
- proxy cache membesar,
- temp upload file membesar,
- deleted file masih dipegang process.

Cek disk:

```bash
df -h
sudo du -sh /var/log/nginx/*
sudo du -sh /var/cache/nginx/*
```

Cek inode:

```bash
df -i
```

Cek deleted files:

```bash
sudo lsof | grep deleted | grep nginx
```

### 16.2 Log Rotate Tidak Efektif

Setelah log rotate, Nginx perlu reopen log.

```bash
sudo nginx -s reopen
```

Biasanya logrotate config melakukan ini otomatis.

---

## 17. Debugging Permission and SELinux/AppArmor

### 17.1 File Permission

```bash
namei -l /var/www/app/index.html
```

Cek user worker:

```bash
ps -o user,group,pid,cmd -C nginx
```

### 17.2 SELinux

Di sistem SELinux enforcing:

```bash
getenforce
sudo ausearch -m avc -ts recent
```

Jika static file ditolak walau Unix permission benar, SELinux context bisa jadi penyebab.

Cek context:

```bash
ls -Z /var/www/app/index.html
```

Perbaikan harus mengikuti policy distro, bukan asal `chmod 777`.

---

## 18. Debugging in Docker

### 18.1 Lihat Config dalam Container

```bash
docker exec -it nginx nginx -T
```

### 18.2 Test dari Dalam Container

```bash
docker exec -it nginx sh
curl -v http://backend:8080/health
```

### 18.3 Network Trap

Dalam container:

```text
localhost != host machine
localhost != container lain
```

Jika Nginx config:

```nginx
proxy_pass http://localhost:8080;
```

Maka Nginx mencoba connect ke port 8080 di container Nginx sendiri.

Untuk Docker Compose, biasanya gunakan service name:

```nginx
proxy_pass http://app:8080;
```

---

## 19. Debugging in Kubernetes

### 19.1 Cari Pod dan Logs

```bash
kubectl get pods
kubectl logs deploy/nginx --since=10m
```

### 19.2 Exec ke Pod

```bash
kubectl exec -it deploy/nginx -- sh
nginx -T
curl -v http://backend-service:8080/health
```

### 19.3 Cek Service Endpoint

```bash
kubectl get svc
kubectl get endpoints backend-service
kubectl get endpointSlice
```

Jika Service tidak punya endpoint, Nginx bisa resolve service tapi tidak ada backend sehat.

### 19.4 Cek DNS dari Pod

```bash
kubectl exec -it deploy/nginx -- nslookup backend-service
```

Atau:

```bash
kubectl exec -it deploy/nginx -- getent hosts backend-service
```

### 19.5 Readiness Trap

Jika Java app port open tetapi belum ready, Nginx bisa mengirim traffic terlalu cepat.

Gunakan readiness probe yang benar:

- bukan hanya TCP open,
- bukan hanya process hidup,
- tetapi dependency minimum siap sesuai kebutuhan menerima traffic.

---

## 20. Production Incident Workflow

Saat incident, gunakan alur ini.

### Step 1: Definisikan Gejala

Tulis secara konkret:

```text
Mulai 10:15 WIB, endpoint POST /api/orders pada api.example.com mengalami 504 sekitar 35% request.
GET /health tetap 200. Hanya region Jakarta yang terdampak. p95 naik dari 400ms ke 60s.
```

Bukan:

```text
Nginx error.
```

---

### Step 2: Tentukan Scope

Pertanyaan:

- Semua domain atau satu domain?
- Semua endpoint atau endpoint tertentu?
- Semua user atau region tertentu?
- HTTP dan HTTPS atau salah satu?
- Static dan API atau hanya API?
- Semua upstream atau node tertentu?
- Baru terjadi setelah deploy/config change?

---

### Step 3: Lihat Access Log Aggregate

Contoh cepat:

```bash
awk '{print $9}' /var/log/nginx/access.log | sort | uniq -c | sort -nr
```

Untuk log JSON, gunakan `jq`:

```bash
jq -r '.status' /var/log/nginx/access.log | sort | uniq -c | sort -nr
```

Group by upstream:

```bash
jq -r '[.status, .upstream_addr, .upstream_status] | @tsv' /var/log/nginx/access.log \
  | sort | uniq -c | sort -nr | head
```

---

### Step 4: Lihat Error Log

```bash
sudo tail -200 /var/log/nginx/error.log
```

Cari kata kunci:

```bash
grep -E "upstream|timed out|refused|prematurely|no live|permission|forbidden" /var/log/nginx/error.log | tail -100
```

---

### Step 5: Test Jalur dari Nginx ke Upstream

```bash
curl -v http://backend:8080/health
nc -vz backend 8080
```

Kalau health OK, test endpoint yang bermasalah.

```bash
curl -v http://backend:8080/api/orders
```

---

### Step 6: Bandingkan dengan App Logs

Cocokkan `request_id`.

Jika Nginx punya request ID tapi app tidak, request tidak sampai app atau ditolak sebelum app log.

Jika app menerima dan lambat/error, lanjut ke app/dependency debugging.

---

### Step 7: Cek Recent Change

```bash
sudo nginx -T > /tmp/current-nginx.txt
```

Bandingkan dengan config known-good dari repo/CI.

Cek deployment:

- app release,
- Nginx reload,
- certificate renewal,
- DNS change,
- load balancer change,
- firewall/security group change,
- Kubernetes rollout,
- config map update.

---

### Step 8: Mitigasi Aman

Mitigasi harus mengurangi impact tanpa memperbesar blast radius.

Contoh mitigasi:

- rollback config,
- remove bad upstream node,
- reduce traffic to bad canary,
- disable cache bypass storm,
- temporarily raise rate limit untuk false positive tertentu,
- serve stale cache,
- redirect endpoint berat ke maintenance response,
- scale backend,
- stop deployment rollout.

Hindari:

- menaikkan timeout ekstrem tanpa analisis,
- `chmod 777`,
- mematikan TLS verification sembarangan,
- membuka admin endpoint publik,
- restart semua node sekaligus,
- flush semua cache saat backend sedang overload.

---

## 21. Status Code Cheat Sheet

| Status | Pertanyaan Pertama | Kemungkinan Fokus |
|---|---|---|
| 400 | Request valid? Header terlalu besar? | client/proxy/header/protocol |
| 403 | Dilarang oleh siapa? | permission/access rule/auth/internal |
| 404 | Nginx atau upstream yang 404? | server/location/root/alias/app route |
| 413 | Limit body di layer mana? | Nginx/app/LB/upload config |
| 499 | Client pergi kapan? | client timeout/latency/cancellation |
| 502 | Upstream response valid? | upstream down/protocol/crash/DNS/socket |
| 503 | Siapa menyatakan unavailable? | rate limit/upstream availability/app health |
| 504 | Timeout di fase mana? | connect/send/read/upstream latency |

---

## 22. Latency Debugging Matrix

| Gejala | Sinyal Log | Kemungkinan |
|---|---|---|
| connect lambat | high `$upstream_connect_time` | network/firewall/upstream accept backlog |
| header lambat | high `$upstream_header_time` | app processing/DB/API dependency |
| body lambat | high response time after header | streaming/large response/client slow |
| request total tinggi, upstream rendah | high `$request_time`, low upstream time | slow client/response send/buffering |
| 499 around fixed duration | request_time near 30s/60s | client/CDN/LB timeout |
| 504 at fixed duration | request_time equals proxy timeout | Nginx timeout budget hit |
| 502 immediate | request_time tiny | connection refused/protocol mismatch |

---

## 23. Common Anti-Patterns

### 23.1 Restart-Driven Debugging

Buruk:

```bash
sudo systemctl restart nginx
```

Setiap ada error.

Masalah:

- menghapus evidence,
- memutus koneksi,
- menyembunyikan race condition,
- bisa memperbesar impact.

Lebih baik:

```bash
sudo nginx -t
sudo nginx -T
sudo tail -f /var/log/nginx/error.log
sudo systemctl reload nginx
```

Jika memang config change.

---

### 23.2 Timeout Inflation

Buruk:

```nginx
proxy_read_timeout 600s;
```

Tanpa memahami mengapa endpoint butuh 600 detik.

Timeout panjang bisa:

- menahan worker connection,
- memperburuk queue,
- membuat client sudah pergi tapi server tetap kerja,
- menyembunyikan DB bottleneck,
- menyebabkan cascading failure.

---

### 23.3 Debugging dari Browser Saja

Browser menyembunyikan banyak detail:

- cache,
- CORS,
- HSTS,
- service worker,
- cookie,
- extension,
- retry behavior.

Gunakan browser untuk reproduksi UX, tapi gunakan `curl` untuk isolasi HTTP.

---

### 23.4 Menganggap Health Check Mewakili Endpoint Real

`/health` 200 tidak berarti `/api/orders` sehat.

Health check biasanya ringan. Endpoint real bisa gagal karena:

- DB query,
- lock,
- downstream dependency,
- payload besar,
- authorization,
- serialization,
- thread pool.

---

### 23.5 Melupakan Layer di Depan Nginx

Nginx mungkin bukan edge terluar.

Bisa ada:

- CDN,
- cloud load balancer,
- WAF,
- service mesh,
- ingress controller,
- corporate proxy.

Gejala di Nginx bisa akibat layer depan:

- client IP semua sama,
- scheme salah,
- request body sudah ditolak sebelum Nginx,
- timeout terjadi sebelum Nginx selesai,
- TLS terminated sebelum Nginx.

---

## 24. Reusable Debugging Template

Gunakan template ini saat membuat incident note.

```markdown
# Nginx Debug Note

## Symptom
- Domain:
- Path:
- Method:
- Status:
- Start time:
- Affected users:
- Error rate:

## First Evidence
- Access log sample:
- Error log sample:
- Request ID:
- Upstream addr:
- Upstream status:
- Request time:
- Upstream response time:

## Boundary Check
- DNS correct: yes/no
- TLS correct: yes/no
- Nginx received request: yes/no
- Correct server block: yes/no
- Correct location: yes/no
- Upstream reachable from Nginx: yes/no
- Upstream app received request: yes/no
- App dependency healthy: yes/no

## Hypothesis
1.
2.
3.

## Test Performed
- Command:
- Result:
- Interpretation:

## Mitigation
- Action:
- Risk:
- Rollback:

## Root Cause
-

## Follow-up
-
```

---

## 25. Minimal Production Debug Config

A production-ready Nginx should expose enough signal to debug safely.

Example:

```nginx
http {
    log_format main_ext escape=json
      '{'
        '"time":"$time_iso8601",'
        '"remote_addr":"$remote_addr",'
        '"request_id":"$request_id",'
        '"host":"$host",'
        '"method":"$request_method",'
        '"uri":"$request_uri",'
        '"status":$status,'
        '"bytes":$body_bytes_sent,'
        '"request_time":$request_time,'
        '"upstream_addr":"$upstream_addr",'
        '"upstream_status":"$upstream_status",'
        '"upstream_connect_time":"$upstream_connect_time",'
        '"upstream_header_time":"$upstream_header_time",'
        '"upstream_response_time":"$upstream_response_time",'
        '"referer":"$http_referer",'
        '"user_agent":"$http_user_agent"'
      '}';

    access_log /var/log/nginx/access.log main_ext;
    error_log  /var/log/nginx/error.log warn;

    server {
        listen 443 ssl;
        server_name api.example.com;

        add_header X-Request-ID $request_id always;

        location /api/ {
            proxy_pass http://backend_api;
            proxy_set_header X-Request-ID $request_id;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header Host $host;
        }
    }
}
```

Ini bukan config final untuk semua sistem, tetapi baseline observability.

---

## 26. Practice Scenarios

### Scenario 1 — API 502 Setelah Deploy

Gejala:

```text
GET /api/users -> 502
GET / -> 200
```

Error log:

```text
connect() failed (111: Connection refused) while connecting to upstream
```

Langkah:

1. Cek `proxy_pass` target.
2. Cek app listen port.
3. Cek bind address.
4. Cek deployment changed port.
5. Curl upstream dari host/container Nginx.

Kemungkinan root cause:

- app berubah dari port 8080 ke 8081,
- container service name berubah,
- app belum ready,
- Nginx di container pakai `localhost` salah.

---

### Scenario 2 — Upload 20MB Gagal 413

Gejala:

```text
POST /upload -> 413
```

Langkah:

1. Cek `client_max_body_size` effective config.
2. Cek context location `/upload`.
3. Cek cloud LB limit.
4. Cek Spring multipart limit.
5. Test dengan file ukuran berbeda.

Root cause mungkin:

- Nginx limit 10MB,
- app limit 10MB,
- CDN limit lebih kecil,
- endpoint upload salah location.

---

### Scenario 3 — SPA Route 404 Setelah Refresh

Gejala:

```text
/app/settings works from navigation
/app/settings 404 after refresh
```

Langkah:

1. Cek apakah 404 dari Nginx atau upstream.
2. Cek `try_files`.
3. Cek `root`.
4. Cek frontend base path.

Solusi umum:

```nginx
location / {
    try_files $uri $uri/ /index.html;
}
```

Tapi pastikan `/api/` punya location lebih spesifik.

---

### Scenario 4 — 499 Naik Setelah Client Release

Gejala:

```text
499 meningkat dari 0.5% ke 8%
```

Request time banyak sekitar 10 detik.

Langkah:

1. Cek client timeout di versi baru.
2. Cek upstream response time.
3. Cek endpoint paling terdampak.
4. Cocokkan app logs.
5. Cari apakah client cancel request saat navigation.

Root cause mungkin:

- mobile app menurunkan timeout ke 10s,
- endpoint p95 12s,
- user pindah halaman dan request dicancel,
- CDN timeout lebih pendek.

---

### Scenario 5 — 504 Tepat 60 Detik

Gejala:

```text
POST /reports/monthly -> 504 after 60s
```

Access log:

```text
request_time=60.001 upstream_response_time=60.000
```

Langkah:

1. Cek `proxy_read_timeout`.
2. Cek app processing time.
3. Cek DB query.
4. Tentukan apakah endpoint perlu async job.
5. Jangan langsung ubah timeout ke 10 menit tanpa produk decision.

---

## 27. Production Checklist

Sebelum mengatakan “Nginx sudah siap didebug di production”, pastikan:

- [ ] `nginx -t` dijalankan sebelum reload.
- [ ] `nginx -T` bisa diakses oleh operator yang berwenang.
- [ ] Access log punya request ID.
- [ ] Access log punya upstream timing.
- [ ] Error log level default tidak terlalu noisy.
- [ ] Request ID diteruskan ke Java app.
- [ ] Java app log mencatat request ID.
- [ ] Health endpoint bisa dites dari host/container Nginx.
- [ ] Runbook 502/504 tersedia.
- [ ] Timeout budget terdokumentasi.
- [ ] DNS dan upstream target terdokumentasi.
- [ ] Reload procedure aman.
- [ ] Rollback config jelas.
- [ ] Unknown host handling jelas.
- [ ] Log rotation bekerja.
- [ ] Disk/cache/log monitoring aktif.
- [ ] Certificate expiry monitoring aktif.
- [ ] Rate limit rejection termonitor.
- [ ] Dashboard membedakan status final dan upstream status.

---

## 28. Mental Model Akhir

Debugging Nginx bukan seni menebak directive.

Debugging Nginx adalah proses membangun bukti di sepanjang jalur request:

```text
DNS -> TCP -> TLS -> server block -> location -> rewrite/try_files -> proxy -> upstream -> response -> client
```

Setiap status code hanya titik awal.

Setiap log line adalah potongan cerita.

Setiap command-line test harus menjawab satu pertanyaan spesifik.

Engineer production yang baik tidak berkata:

> “Coba restart.”

Ia berkata:

> “Request mencapai Nginx, masuk server block yang benar, location `/api/`, upstream selected `10.0.1.25:8080`, connect berhasil 2ms, tapi upstream header tidak muncul sampai 60s. Ini bukan DNS atau listener. Fokus ke aplikasi/dependency untuk endpoint itu, sambil kita mitigasi timeout/capacity dengan aman.”

Itulah level debugging yang kita targetkan.

---

## 29. Ringkasan

Di Part 020, kita membahas:

- prinsip debugging Nginx sebagai boundary tracing,
- penggunaan `nginx -t` dan `nginx -T`,
- reload vs restart,
- debugging dengan `curl`, `openssl`, `dig`, `ss`, `lsof`, `tcpdump`,
- analisis status 400, 403, 404, 413, 499, 502, 503, 504,
- debugging server/location selection,
- debugging upstream Java,
- Docker/Kubernetes debugging,
- incident workflow,
- reusable debug template,
- production checklist.

Bagian ini sengaja praktis dan operasional karena Nginx sering menjadi layer pertama yang disalahkan saat sistem bermasalah. Dengan metode yang benar, Nginx justru menjadi layer yang mempercepat diagnosis.

---

# Status Seri

Seri belum selesai.

Progress saat ini:

```text
Selesai: Part 000 sampai Part 020
Berikutnya: Part 021 — Nginx and Java Application Servers
Sisa: Part 021 sampai Part 030
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-nginx-mastery-for-java-engineers-part-019.md">⬅️ Part 019 — Observability: Access Logs, Error Logs, Correlation IDs, and Metrics</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-nginx-mastery-for-java-engineers-part-021.md">Part 021 — Nginx and Java Application Servers ➡️</a>
</div>
