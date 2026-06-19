# learn-nginx-mastery-for-java-engineers-part-008.md

# Part 008 — Proxy Header Contract: The Boundary Between Nginx and Application

## Status Seri

- Seri: `learn-nginx-mastery-for-java-engineers`
- Part: `008 / 030`
- Status seri: **belum selesai**
- Part sebelumnya: `Part 007 — Reverse Proxy Fundamentals for Java Backends`
- Part berikutnya: `Part 009 — Upstream Blocks and Load Balancing`

---

## 0. Tujuan Bagian Ini

Di part sebelumnya kita sudah masuk ke dasar reverse proxy: `proxy_pass`, path forwarding, upstream Java backend, dan bug umum saat aplikasi berada di belakang Nginx.

Part ini memperdalam satu hal yang sering dianggap remeh tetapi sangat menentukan correctness sistem production:

> **Proxy headers adalah kontrak batas antara edge/proxy layer dan aplikasi.**

Jika kontrak ini salah, aplikasi Java bisa salah memahami:

- siapa client sebenarnya,
- scheme asli request adalah HTTP atau HTTPS,
- host publik yang digunakan user,
- port publik yang terlihat dari luar,
- apakah request datang dari trusted proxy atau client langsung,
- bagaimana membuat absolute URL,
- bagaimana mencatat audit log,
- bagaimana menentukan cookie `Secure`, redirect URL, CORS origin, rate limit key, dan security decision.

Dalam sistem sederhana, bug proxy header sering terlihat seperti masalah kecil:

- redirect ke `http://` padahal user akses `https://`,
- URL reset password salah host,
- audit log selalu mencatat IP Nginx,
- aplikasi mengira semua user berasal dari `127.0.0.1`,
- session cookie tidak secure,
- Spring Security menganggap request tidak aman,
- rate limiter menghukum semua user karena IP terlihat sama.

Dalam sistem regulasi, finansial, enforcement, case management, atau sistem yang membutuhkan defensibility, bug ini bisa menjadi masalah serius:

- audit trail salah,
- chain-of-custody request tidak dapat dipercaya,
- attribution salah,
- evidence log tidak valid,
- security boundary kabur,
- legal defensibility melemah.

Target bagian ini adalah membuat kamu mampu mendesain, membaca, menguji, dan men-debug kontrak header antara Nginx dan backend Java dengan presisi tinggi.

---

## 1. Mental Model: Request Punya Dua Identitas

Saat client mengakses aplikasi lewat Nginx, ada dua perspektif request:

```text
Client Perspective
  User sees:
    https://app.example.com/cases/123

Network Perspective at Java backend
  Java server sees TCP peer:
    source = nginx internal IP
    scheme = http, if Nginx talks plaintext to backend
    host = maybe internal host, unless preserved
    port = backend port, e.g. 8080
```

Aplikasi Java tidak otomatis tahu request publik awalnya seperti apa.

Misalnya:

```text
Browser
  GET https://app.example.com/api/cases
        |
        | TLS
        v
Nginx
  terminates TLS
  forwards to backend as:

  GET http://case-service:8080/api/cases
        |
        | plaintext internal HTTP
        v
Spring Boot
```

Dari sudut pandang Spring Boot murni:

```text
request.getScheme()      -> http
request.getServerName()  -> case-service or app.example.com, tergantung Host
request.getServerPort()  -> 8080
request.getRemoteAddr()  -> IP Nginx
request.isSecure()       -> false
```

Padahal dari sudut pandang user:

```text
scheme      -> https
host        -> app.example.com
port        -> 443
client IP   -> real public/client IP, or previous trusted proxy IP
secure      -> true
```

Di sinilah proxy headers bekerja.

Proxy headers membawa metadata request asli dari proxy ke aplikasi.

---

## 2. Core Principle: Jangan Percaya Header dari Internet

Hal paling penting:

> Header seperti `X-Forwarded-For`, `X-Forwarded-Proto`, dan `X-Real-IP` bukan fakta objektif. Itu hanya string yang bisa dikirim oleh siapa pun kecuali kamu mengontrol trust boundary-nya.

Client jahat bisa langsung mengirim:

```http
GET /api/admin HTTP/1.1
Host: app.example.com
X-Forwarded-For: 10.0.0.1
X-Forwarded-Proto: https
X-Forwarded-Host: trusted.example.com
```

Jika aplikasi percaya header ini tanpa memastikan request datang dari Nginx/trusted proxy, maka client bisa memalsukan:

- IP address,
- scheme,
- host,
- port,
- origin signal,
- audit identity,
- security condition.

Karena itu, desain yang benar adalah:

```text
Internet client
  must not be trusted for forwarded headers
        |
        v
Trusted edge proxy / load balancer
  validates / overwrites forwarded headers
        |
        v
Application
  trusts forwarded headers only from trusted proxy path
```

Nginx harus menjadi titik yang:

1. menerima request dari luar,
2. menghapus atau menimpa forwarded header yang tidak dipercaya,
3. mengisi header yang benar,
4. memastikan backend hanya bisa diakses melalui Nginx atau trusted internal network.

---

## 3. Header-Header Utama dalam Proxy Contract

Header yang paling sering dipakai:

| Header | Fungsi | Risiko Jika Salah |
|---|---|---|
| `Host` | Hostname target yang diminta user | URL generation salah, virtual host salah, redirect salah |
| `X-Real-IP` | IP client tunggal versi Nginx | Audit/rate limit salah jika spoofable |
| `X-Forwarded-For` | Chain IP proxy/client | Spoofing, parsing salah, trust boundary kabur |
| `X-Forwarded-Proto` | Scheme asli: `http` / `https` | Redirect loop, cookie `Secure` salah, absolute URL salah |
| `X-Forwarded-Host` | Host asli dari client | Host injection jika dipercaya sembarangan |
| `X-Forwarded-Port` | Port publik asli | URL generation salah |
| `Forwarded` | Standardized version per RFC 7239 | Lebih formal, tapi adoption bervariasi |
| `X-Request-ID` / `X-Correlation-ID` | Trace/correlation identifier | Observability antar layer sulit |

Semua ini harus dipahami sebagai **interface contract**, mirip DTO antara Nginx dan aplikasi.

---

## 4. `Host`: Header Paling Dasar Tapi Berbahaya

### 4.1 Apa itu `Host` dalam konteks proxy?

Ketika user mengakses:

```text
https://app.example.com/api/cases
```

Browser mengirim:

```http
Host: app.example.com
```

Saat Nginx meneruskan ke upstream, ada dua pilihan umum:

```nginx
proxy_set_header Host $host;
```

atau:

```nginx
proxy_set_header Host $proxy_host;
```

atau bahkan default tertentu tergantung konfigurasi.

Yang paling sering diinginkan untuk aplikasi web adalah preserve public host:

```nginx
proxy_set_header Host $host;
```

Agar backend tahu bahwa host publik adalah `app.example.com`, bukan `case-service:8080`.

### 4.2 `$host` vs `$http_host`

Nginx punya beberapa variable terkait host:

```nginx
$host
$http_host
$server_name
```

Secara praktis:

- `$http_host` adalah nilai mentah dari header `Host` client.
- `$host` adalah normalized host yang bisa berasal dari request line, header Host, atau matching server name.
- `$server_name` adalah nama server block yang dipilih.

Dalam banyak reverse proxy config, `$host` lebih aman daripada `$http_host` karena `$http_host` bisa membawa port dan nilai mentah yang lebih mudah dipakai untuk host header injection jika aplikasi tidak hati-hati.

Namun, “lebih aman” bukan berarti otomatis aman. Tetap validasi domain yang diterima oleh server block.

### 4.3 Host Header Injection

Jika aplikasi menggunakan `Host` untuk membuat absolute URL:

```java
String resetUrl = request.getScheme() + "://" + request.getServerName() + "/reset?token=" + token;
```

Lalu Nginx membiarkan host liar masuk:

```http
Host: evil.example
```

Maka email reset password bisa berisi:

```text
https://evil.example/reset?token=...
```

Mitigasi:

1. Batasi `server_name` yang valid.
2. Gunakan default server untuk reject unknown host.
3. Jangan generate critical external URL hanya dari request host jika domain seharusnya fixed/configured.
4. Di aplikasi, set canonical public base URL melalui config.

Contoh catch-all reject:

```nginx
server {
    listen 80 default_server;
    listen 443 ssl default_server;
    server_name _;

    return 444;
}
```

Atau return eksplisit:

```nginx
return 400;
```

`444` adalah non-standard Nginx behavior untuk menutup koneksi tanpa response; berguna di edge tertentu, tetapi untuk debugging atau compliance kadang `400` lebih eksplisit.

---

## 5. `X-Real-IP`: Satu IP yang Dipilih Proxy

`X-Real-IP` biasanya diisi oleh Nginx dengan IP client yang dilihat Nginx:

```nginx
proxy_set_header X-Real-IP $remote_addr;
```

Jika client langsung terhubung ke Nginx, maka:

```text
$remote_addr = IP client
```

Jika sebelum Nginx ada load balancer/CDN:

```text
Client -> CDN/LB -> Nginx -> Java
```

Maka `$remote_addr` di Nginx bisa menjadi IP CDN/LB, bukan IP client asli.

Agar Nginx bisa mengambil real client IP dari upstream trusted proxy, perlu `real_ip` module config seperti:

```nginx
set_real_ip_from 10.0.0.0/8;
set_real_ip_from 172.16.0.0/12;
set_real_ip_from 192.168.0.0/16;
real_ip_header X-Forwarded-For;
real_ip_recursive on;
```

Tapi ini berbahaya jika CIDR terlalu luas atau memasukkan network yang tidak sepenuhnya trusted.

Prinsipnya:

> `set_real_ip_from` harus menunjuk hanya ke proxy yang kamu percaya, bukan seluruh internet.

Setelah `real_ip` diproses, `$remote_addr` bisa berubah menjadi real client IP hasil evaluasi chain.

Kemudian kamu bisa meneruskan:

```nginx
proxy_set_header X-Real-IP $remote_addr;
```

---

## 6. `X-Forwarded-For`: Chain, Bukan Satu Nilai Sederhana

### 6.1 Format Umum

`X-Forwarded-For` biasanya berisi daftar IP:

```http
X-Forwarded-For: client, proxy1, proxy2
```

Contoh:

```http
X-Forwarded-For: 203.0.113.10, 198.51.100.20, 10.0.1.5
```

Biasanya kiri paling awal adalah IP client asli, lalu proxy yang dilewati.

Namun tidak ada jaminan jika chain tidak dikelola oleh trusted proxy.

Client bisa mengirim lebih dulu:

```http
X-Forwarded-For: 1.2.3.4
```

Lalu Nginx config seperti ini:

```nginx
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

Akan menghasilkan:

```http
X-Forwarded-For: 1.2.3.4, 203.0.113.10
```

Jika aplikasi mengambil IP pertama tanpa trust logic, client berhasil spoof IP.

### 6.2 `$proxy_add_x_forwarded_for`

Variable ini berarti:

```text
existing X-Forwarded-For + ", " + $remote_addr
```

Jika tidak ada existing header, hasilnya hanya `$remote_addr`.

Contoh umum:

```nginx
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

Ini cocok jika Nginx berada dalam chain proxy yang trusted dan kamu ingin preserve chain.

Tetapi jika Nginx adalah edge internet-facing dan tidak ingin percaya header dari client, pattern yang lebih defensif adalah overwrite:

```nginx
proxy_set_header X-Forwarded-For $remote_addr;
```

Atau bersihkan header incoming sebelum membangun ulang chain di edge.

### 6.3 Kapan Append, Kapan Overwrite?

Gunakan rule berikut:

```text
Jika request datang langsung dari internet:
  jangan percaya X-Forwarded-For dari client
  overwrite dengan $remote_addr

Jika request datang dari trusted proxy sebelumnya:
  boleh gunakan real_ip module untuk menentukan real remote_addr
  lalu append/preserve chain sesuai kebutuhan audit
```

Skenario 1: Nginx adalah edge pertama.

```nginx
proxy_set_header X-Forwarded-For $remote_addr;
proxy_set_header X-Real-IP       $remote_addr;
```

Skenario 2: Cloud LB/CDN di depan Nginx.

```nginx
set_real_ip_from 10.10.0.0/16;       # CIDR internal LB only
real_ip_header X-Forwarded-For;
real_ip_recursive on;

proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Real-IP       $remote_addr;
```

Tapi pastikan hanya LB/CDN trusted yang bisa mencapai Nginx.

---

## 7. `X-Forwarded-Proto`: Scheme Publik Request

Header ini memberi tahu aplikasi apakah user datang via HTTP atau HTTPS:

```nginx
proxy_set_header X-Forwarded-Proto $scheme;
```

Jika request publik ke Nginx adalah HTTPS, maka `$scheme` bernilai `https`.

Jika Nginx meneruskan ke backend dengan HTTP plaintext:

```text
Client -> HTTPS -> Nginx -> HTTP -> Java
```

Aplikasi Java tetap bisa tahu scheme publiknya `https` melalui:

```http
X-Forwarded-Proto: https
```

### 7.1 Bug Jika Header Ini Tidak Ada

Tanpa header ini, backend bisa mengira request adalah HTTP.

Dampaknya:

- redirect ke `http://app.example.com`,
- generated link menggunakan `http`,
- Spring Security menganggap channel tidak secure,
- cookie `Secure` tidak aktif,
- OAuth redirect URI mismatch,
- callback URL salah,
- absolute URL di email salah,
- Swagger/OpenAPI server URL salah.

### 7.2 Redirect Loop

Contoh klasik:

```text
Nginx terminates HTTPS
Backend sees HTTP
Backend has rule: if HTTP, redirect to HTTPS
Backend returns Location: https://app.example.com/...
Browser requests HTTPS again
Nginx sends HTTP to backend again
Backend still sees HTTP
Loop
```

Solusi:

1. Nginx set `X-Forwarded-Proto https`.
2. Aplikasi Java dikonfigurasi untuk membaca forwarded headers.
3. Jangan mengandalkan `request.isSecure()` mentah tanpa forwarded awareness.

---

## 8. `X-Forwarded-Host` dan `X-Forwarded-Port`

Header ini digunakan untuk memberi tahu host/port asli yang dilihat user.

Contoh:

```nginx
proxy_set_header Host              $host;
proxy_set_header X-Forwarded-Host  $host;
proxy_set_header X-Forwarded-Port  $server_port;
proxy_set_header X-Forwarded-Proto $scheme;
```

Namun perlu hati-hati:

```nginx
proxy_set_header X-Forwarded-Host $http_host;
```

Bisa meneruskan host mentah dari client, termasuk nilai berbahaya.

Jika aplikasi benar-benar perlu canonical public host, pertimbangkan hardcoded/templated value dari environment:

```nginx
proxy_set_header X-Forwarded-Host app.example.com;
proxy_set_header X-Forwarded-Port 443;
proxy_set_header X-Forwarded-Proto https;
```

Ini lebih eksplisit untuk sistem dengan satu domain publik.

Untuk multi-tenant/multi-domain system, gunakan allowlist domain di Nginx dan aplikasi.

---

## 9. `Forwarded` Header: Versi Standar

Selain keluarga `X-Forwarded-*`, ada header standar:

```http
Forwarded: for=203.0.113.10;proto=https;host=app.example.com
```

Secara konsep lebih formal karena bisa membawa beberapa parameter sekaligus:

- `for`,
- `by`,
- `host`,
- `proto`.

Namun dalam praktik, banyak stack masih lebih umum menggunakan `X-Forwarded-*`.

Untuk Java/Spring, dukungan bisa ada, tetapi konfigurasi framework, container, dan deployment environment perlu dipastikan.

Strategi praktis:

- Untuk compatibility luas: gunakan `X-Forwarded-*` dengan benar.
- Untuk sistem yang ingin standar formal: tambahkan `Forwarded` jika stack benar-benar membaca dan mengujinya.
- Jangan mengirim dua jenis header dengan nilai yang bisa bertentangan.

Contoh buruk:

```http
X-Forwarded-Proto: https
Forwarded: proto=http
```

Aplikasi/framework yang berbeda bisa memilih header berbeda dan menghasilkan perilaku tidak konsisten.

---

## 10. Correlation Header: `X-Request-ID` dan `X-Correlation-ID`

Walau bukan proxy identity header, correlation header adalah bagian penting dari kontrak Nginx-aplikasi.

Tujuannya:

```text
Satu request dapat ditelusuri dari:
  client -> Nginx access log -> Java log -> downstream service -> database/audit event
```

Contoh Nginx:

```nginx
proxy_set_header X-Request-ID $request_id;
```

Jika ingin preserve ID dari upstream trusted system:

```nginx
map $http_x_request_id $req_id {
    default $http_x_request_id;
    ""      $request_id;
}

proxy_set_header X-Request-ID $req_id;
```

Namun hati-hati dengan client-provided request ID:

- Bisa sangat panjang.
- Bisa mengandung karakter yang mengganggu log parsing.
- Bisa menyebabkan log injection jika tidak disanitasi.
- Bisa dipakai attacker untuk menyamarkan korelasi.

Untuk sistem sensitif, Nginx bisa selalu generate ID internal sendiri:

```nginx
proxy_set_header X-Request-ID $request_id;
```

Lalu jika perlu, client-provided ID disimpan sebagai field terpisah setelah validasi.

---

## 11. Konfigurasi Nginx Baseline untuk Backend Java

Contoh baseline defensif untuk aplikasi Java di belakang Nginx:

```nginx
server {
    listen 443 ssl http2;
    server_name app.example.com;

    ssl_certificate     /etc/nginx/certs/app.example.com.crt;
    ssl_certificate_key /etc/nginx/certs/app.example.com.key;

    location / {
        proxy_pass http://java_backend;

        proxy_http_version 1.1;

        # Preserve public host contract
        proxy_set_header Host $host;

        # Client identity contract
        proxy_set_header X-Real-IP       $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        # Public URL contract
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host  $host;
        proxy_set_header X-Forwarded-Port  $server_port;

        # Observability contract
        proxy_set_header X-Request-ID $request_id;

        # WebSocket / keepalive-friendly defaults, if needed later
        proxy_set_header Connection "";
    }
}

upstream java_backend {
    server 127.0.0.1:8080;
    keepalive 32;
}
```

Namun baseline ini harus disesuaikan dengan posisi Nginx.

Jika Nginx menerima traffic langsung dari internet, kamu mungkin ingin overwrite `X-Forwarded-For`:

```nginx
proxy_set_header X-Forwarded-For $remote_addr;
```

Jika Nginx berada di belakang trusted LB/CDN, gunakan real IP module dengan CIDR yang ketat.

---

## 12. Multi-Hop Proxy Chain

Banyak production deployment bukan:

```text
Client -> Nginx -> Java
```

Melainkan:

```text
Client
  -> CDN
  -> Cloud Load Balancer
  -> Nginx
  -> Java
```

Atau di Kubernetes:

```text
Client
  -> Cloud Load Balancer
  -> NGINX Ingress Controller
  -> Service
  -> Pod Java
```

Dalam chain seperti ini, pertanyaan pentingnya bukan “apa IP client?”, tetapi:

> Proxy mana yang dipercaya untuk mengatakan IP client?

### 12.1 Trust Boundary Diagram

```text
Untrusted zone:
  Browser / mobile app / public internet

Semi-trusted / vendor-trusted zone:
  CDN / WAF / cloud LB

Trusted internal zone:
  Nginx / ingress / service proxy

Application zone:
  Java backend
```

Rule:

```text
Application should not trust client-provided forwarded headers.
Application may trust forwarded headers only if request arrives through trusted infrastructure.
```

Artinya backend Java sebaiknya tidak public-exposed langsung.

Jika backend bisa diakses langsung dari internet, attacker bisa bypass Nginx dan mengirim forged headers.

Mitigasi:

- Bind backend ke localhost/private network.
- Security group hanya allow Nginx/LB.
- Kubernetes service tidak diekspos publik.
- Internal firewall policy.
- mTLS/internal auth jika perlu.

---

## 13. Java/Spring Boot Forwarded Header Awareness

### 13.1 Masalah Umum di Spring Boot

Spring Boot di belakang proxy perlu diberi tahu agar memperhitungkan forwarded headers.

Jika tidak, object request bisa tetap terlihat sebagai:

```text
scheme = http
serverPort = 8080
remoteAddr = nginx-ip
secure = false
```

Dampaknya:

- generated URL salah,
- redirect salah,
- Spring Security channel security salah,
- actuator links salah,
- HATEOAS links salah,
- OAuth callback salah.

### 13.2 Spring Boot Configuration

Konfigurasi umum modern:

```properties
server.forward-headers-strategy=framework
```

Atau pada beberapa deployment:

```properties
server.forward-headers-strategy=native
```

Secara konseptual:

- `framework`: Spring framework memproses forwarded headers.
- `native`: container seperti Tomcat/Jetty/Undertow memprosesnya jika mendukung.
- `none`: tidak menggunakan forwarded headers.

Pemilihan tergantung versi Spring Boot dan container.

Untuk mental model, yang penting:

> Nginx mengirim header saja tidak cukup. Aplikasi Java juga harus dikonfigurasi untuk membaca header itu dengan benar.

### 13.3 Tomcat Remote IP Valve

Jika memakai Tomcat, konsep yang sering muncul adalah RemoteIpValve.

Tujuannya mengubah persepsi request container berdasarkan header seperti:

- `X-Forwarded-For`,
- `X-Forwarded-Proto`,
- `X-Forwarded-Port`.

Secara operasional, pastikan Tomcat hanya percaya proxy internal/trusted.

Jika tidak, forged header bisa mempengaruhi request metadata.

### 13.4 Servlet API Effect

Jika forwarded header diproses dengan benar, maka kode Java seperti ini:

```java
request.getScheme();
request.getServerName();
request.getServerPort();
request.isSecure();
request.getRemoteAddr();
```

bisa mencerminkan request publik atau client identity yang sudah disimpulkan oleh proxy chain.

Namun jangan lupa:

- `getRemoteAddr()` bisa menjadi real client IP tergantung config.
- Audit-grade attribution sebaiknya menyimpan lebih dari satu field:
  - remote address seen by app,
  - forwarded-for chain,
  - trusted extracted client IP,
  - request ID,
  - authenticated subject.

---

## 14. Audit Logging Model untuk Sistem Serius

Untuk aplikasi regulasi/enforcement/case management, jangan hanya simpan:

```text
ip = request.getRemoteAddr()
```

Itu terlalu miskin konteks.

Simpan minimal:

```text
request_id
authenticated_user_id
authenticated_client_id, if machine-to-machine
trusted_client_ip
x_forwarded_for_chain
x_real_ip
host
forwarded_host
scheme
forwarded_proto
user_agent
method
path_template, not raw sensitive path if needed
status
application_decision
server_instance
received_at
```

Bedakan:

```text
Network attribution:
  dari mana request datang secara jaringan

Application attribution:
  user/client/service identity siapa yang melakukan aksi

Decision attribution:
  rule/policy/state transition apa yang dijalankan
```

Proxy header hanya membantu network attribution. Ia tidak menggantikan authentication dan authorization.

---

## 15. Rate Limiting dan Client IP

Jika rate limit di aplikasi memakai IP, proxy header contract sangat krusial.

Bug umum:

```text
Semua request terlihat dari IP Nginx
=> semua user berbagi rate limit bucket yang sama
=> legitimate traffic ikut kena 429
```

Bug sebaliknya:

```text
Aplikasi percaya X-Forwarded-For dari client
=> attacker spoof IP berbeda setiap request
=> rate limit bypassed
```

Correct approach:

1. Nginx menentukan trusted client IP.
2. Nginx meneruskan trusted value.
3. Aplikasi hanya percaya forwarded headers dari trusted proxy path.
4. Untuk public API, gunakan identity-aware limit juga:
   - API key,
   - user ID,
   - tenant ID,
   - client credential,
   - device/session ID.

IP-only rate limit tidak cukup untuk sistem modern.

---

## 16. CORS, Origin, Host, dan Proxy Headers

CORS biasanya memakai header `Origin`, bukan `Host`.

Namun proxy header bisa tetap memengaruhi:

- allowed redirect URI,
- generated absolute URL,
- cookie domain,
- same-site assumptions,
- multi-tenant domain mapping.

Jangan melakukan ini secara naif:

```java
if (request.getHeader("X-Forwarded-Host").endsWith("trusted.com")) {
    allowCors();
}
```

Karena forwarded host bisa spoofable jika trust boundary salah.

Lebih baik:

- CORS allowlist berbasis config.
- Tenant domain mapping berbasis database/config yang tervalidasi.
- Host validation di Nginx dan aplikasi.
- Jangan gunakan forwarded header sebagai satu-satunya security proof.

---

## 17. Cookie dan Secure Flag

Aplikasi sering menentukan cookie `Secure` berdasarkan apakah request secure.

Jika Nginx terminate TLS dan backend melihat HTTP:

```text
request.isSecure() = false
```

Maka framework bisa membuat cookie tanpa `Secure`.

Dampaknya:

- session cookie bisa dikirim via HTTP jika ada jalur HTTP,
- policy browser modern bisa menolak `SameSite=None` tanpa `Secure`,
- security posture melemah.

Solusi:

- Set `X-Forwarded-Proto https`.
- Konfigurasikan Java framework untuk forwarded header awareness.
- Atur session cookie policy eksplisit.

Contoh Spring Boot:

```properties
server.forward-headers-strategy=framework
server.servlet.session.cookie.secure=true
server.servlet.session.cookie.same-site=lax
```

Untuk sistem yang hanya boleh HTTPS, lebih baik policy secure cookie dibuat eksplisit, bukan bergantung penuh pada request inference.

---

## 18. OAuth / OIDC Redirect URI Issues

OAuth/OIDC sangat sensitif terhadap scheme, host, dan port.

Contoh masalah:

Public URL:

```text
https://app.example.com/login/oauth2/code/keycloak
```

Backend melihat:

```text
http://app-internal:8080/login/oauth2/code/keycloak
```

Lalu aplikasi mengirim redirect URI:

```text
http://app-internal:8080/login/oauth2/code/keycloak
```

Identity provider menolak karena redirect URI tidak cocok.

Solusi:

- Preserve `Host`.
- Set `X-Forwarded-Proto`.
- Set `X-Forwarded-Port`.
- Configure Spring/Security forwarded header handling.
- Configure external issuer/base URL secara eksplisit jika framework mendukung.

Untuk authentication system, jangan hanya “coba-coba header sampai jalan”. Buat test eksplisit untuk login redirect.

---

## 19. Nginx Config Pattern: Explicit Proxy Contract Snippet

Agar konsisten, buat snippet:

```nginx
# /etc/nginx/snippets/proxy-headers.conf
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host $host;
proxy_set_header X-Forwarded-Port $server_port;
proxy_set_header X-Request-ID $request_id;
```

Lalu pakai:

```nginx
location /api/ {
    include snippets/proxy-headers.conf;
    proxy_pass http://api_backend;
}
```

Namun jangan sampai snippet dipakai tanpa memahami edge position.

Untuk edge langsung internet, snippet defensif bisa:

```nginx
# /etc/nginx/snippets/proxy-headers-edge.conf
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $remote_addr;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host $host;
proxy_set_header X-Forwarded-Port $server_port;
proxy_set_header X-Request-ID $request_id;
```

Untuk behind trusted LB:

```nginx
# real_ip must be configured at http/server level
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host $host;
proxy_set_header X-Forwarded-Port $server_port;
proxy_set_header X-Request-ID $request_id;
```

---

## 20. Logging Proxy Contract di Nginx

Untuk debugging, log nilai penting:

```nginx
log_format proxy_contract escape=json
  '{'
    '"time":"$time_iso8601",'
    '"request_id":"$request_id",'
    '"remote_addr":"$remote_addr",'
    '"realip_remote_addr":"$realip_remote_addr",'
    '"xff":"$http_x_forwarded_for",'
    '"host":"$host",'
    '"http_host":"$http_host",'
    '"scheme":"$scheme",'
    '"method":"$request_method",'
    '"uri":"$request_uri",'
    '"status":$status,'
    '"upstream_addr":"$upstream_addr",'
    '"upstream_status":"$upstream_status",'
    '"request_time":$request_time,'
    '"upstream_response_time":"$upstream_response_time"'
  '}';

access_log /var/log/nginx/access.log proxy_contract;
```

`$realip_remote_addr` berguna jika real IP module mengubah `$remote_addr`; ia menyimpan original client address sebelum perubahan.

Dengan log ini, kamu bisa menjawab:

- IP mana yang dilihat Nginx?
- Apakah incoming `X-Forwarded-For` sudah ada dari client/LB?
- Host mana yang diterima?
- Server block mana yang mungkin dipilih?
- Upstream mana yang menerima request?
- Apakah aplikasi menerima request yang sama berdasarkan request ID?

---

## 21. Testing Proxy Header Contract

Jangan hanya test endpoint aplikasi. Test boundary.

### 21.1 Test Host Preservation

```bash
curl -k -H 'Host: app.example.com' https://127.0.0.1/api/debug/request
```

Endpoint debug sementara di backend bisa mengembalikan:

```json
{
  "scheme": "https",
  "serverName": "app.example.com",
  "serverPort": 443,
  "secure": true,
  "remoteAddr": "203.0.113.10",
  "headers": {
    "x-forwarded-proto": "https",
    "x-forwarded-host": "app.example.com"
  }
}
```

Debug endpoint seperti ini jangan diaktifkan publik di production.

### 21.2 Test Spoofed X-Forwarded-For

```bash
curl -k \
  -H 'Host: app.example.com' \
  -H 'X-Forwarded-For: 1.2.3.4' \
  https://app.example.com/api/debug/request
```

Lihat apakah backend mempercayai `1.2.3.4` atau Nginx menimpa/menangani sesuai desain.

### 21.3 Test Unknown Host

```bash
curl -k -H 'Host: evil.example' https://your-nginx-ip/
```

Expected:

- `400`, `403`, atau `444`, tergantung policy.
- Tidak boleh masuk ke aplikasi utama.
- Tidak boleh generate redirect ke host aneh.

### 21.4 Test HTTPS Awareness

```bash
curl -k -I https://app.example.com/login
```

Periksa:

- `Location` header tidak downgrade ke HTTP.
- Cookie punya `Secure` jika harus.
- Redirect URI OAuth benar.

---

## 22. Contract Test di CI/CD

Untuk sistem serius, buat automated test yang menjalankan Nginx + dummy backend.

Contoh docker-compose mental model:

```text
test runner
  -> nginx container
      -> echo/debug backend container
```

Test cases:

1. Request HTTPS-like path menghasilkan `X-Forwarded-Proto: https`.
2. Host valid dipreserve.
3. Host invalid ditolak.
4. Spoofed `X-Forwarded-For` tidak dipercaya jika edge mode.
5. `X-Request-ID` selalu ada.
6. Request ID format valid.
7. Backend tidak bisa diakses langsung dari network publik.

Walau Nginx config terlihat “infra”, ia seharusnya diuji seperti code karena memengaruhi correctness aplikasi.

---

## 23. Common Anti-Patterns

### Anti-Pattern 1: Copy-Paste Proxy Header Tanpa Trust Model

```nginx
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

Ini sering benar, tapi tidak selalu.

Pertanyaan wajib:

```text
Apakah incoming X-Forwarded-For berasal dari trusted proxy atau public client?
```

### Anti-Pattern 2: Backend Publicly Accessible

Jika backend Java bisa diakses langsung, semua forwarded header contract bisa dibypass.

```text
Attacker -> Java backend directly
  X-Forwarded-Proto: https
  X-Forwarded-For: fake-ip
```

Solusi: network isolation.

### Anti-Pattern 3: Host dari Request Dipakai untuk Security Decision

```java
if (request.getServerName().equals("admin.example.com")) {
    enableAdminMode();
}
```

Host adalah routing signal, bukan authentication proof.

### Anti-Pattern 4: Audit Log Hanya Menyimpan Satu IP

Audit-grade system perlu chain dan decision context, bukan cuma remote address.

### Anti-Pattern 5: Conflicting Headers

```nginx
proxy_set_header X-Forwarded-Proto https;
proxy_set_header Forwarded "proto=http";
```

Aplikasi berbeda bisa membaca sumber berbeda.

### Anti-Pattern 6: Overusing `$http_host`

`$http_host` membawa nilai mentah Host header.

Gunakan dengan sadar, bukan default refleks.

---

## 24. Decision Matrix

### 24.1 Nginx Langsung Menghadap Internet

```text
Client -> Nginx -> Java
```

Recommended:

```nginx
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $remote_addr;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host $host;
proxy_set_header X-Forwarded-Port $server_port;
proxy_set_header X-Request-ID $request_id;
```

Tambahan:

- Reject unknown host.
- Backend private only.
- Jangan percaya incoming `X-Forwarded-*`.

### 24.2 Nginx di Belakang Trusted Load Balancer

```text
Client -> Trusted LB -> Nginx -> Java
```

Recommended:

```nginx
set_real_ip_from <trusted-lb-cidr>;
real_ip_header X-Forwarded-For;
real_ip_recursive on;

proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host $host;
proxy_set_header X-Forwarded-Port $server_port;
proxy_set_header X-Request-ID $request_id;
```

Tambahan:

- Nginx hanya reachable dari LB.
- CIDR trusted harus spesifik.
- Pastikan LB mengirim header konsisten.

### 24.3 Nginx di Kubernetes Ingress

```text
Client -> Cloud LB -> NGINX Ingress -> Service -> Pod
```

Key consideration:

- Apakah cloud LB preserve source IP?
- Apakah ingress controller mengaktifkan real IP handling?
- Apakah service `externalTrafficPolicy` relevan?
- Apakah aplikasi membaca forwarded headers?
- Apakah pod bisa diakses bypass ingress?

Strategi:

- Perlakukan ingress config sebagai edge contract.
- Validasi dengan test request dari luar cluster.
- Jangan hanya test dari dalam cluster.

---

## 25. Failure Mode Catalog

### 25.1 Semua Audit IP Menjadi IP Nginx

Penyebab:

- `X-Forwarded-For` tidak dikirim.
- Java tidak membaca forwarded header.
- Real IP module tidak dikonfigurasi.

Dampak:

- Audit trail lemah.
- Rate limit salah.
- Fraud detection lemah.

Diagnosis:

- Cek Nginx access log `$remote_addr` dan `$http_x_forwarded_for`.
- Cek backend log request headers.
- Cek Spring/Tomcat forwarded config.

### 25.2 Redirect ke HTTP

Penyebab:

- Missing `X-Forwarded-Proto`.
- Spring tidak membaca forwarded headers.
- Hardcoded base URL salah.

Diagnosis:

```bash
curl -k -I https://app.example.com/some-path
```

Cek `Location` header.

### 25.3 OAuth Redirect URI Mismatch

Penyebab:

- Scheme/host/port salah di aplikasi.
- Nginx tidak preserve Host.
- App tidak forwarded-aware.

Diagnosis:

- Log redirect URI yang dikirim ke IdP.
- Cek `X-Forwarded-*` di backend.

### 25.4 Spoofed Client IP

Penyebab:

- App percaya `X-Forwarded-For` langsung dari public client.
- Nginx append bukan overwrite di edge.
- Backend public accessible.

Diagnosis:

```bash
curl -H 'X-Forwarded-For: 1.2.3.4' https://app.example.com/debug
```

Expected behavior harus sesuai trust model.

### 25.5 Generated Link Salah Domain

Penyebab:

- Host tidak dipreserve.
- `X-Forwarded-Host` salah.
- Aplikasi menggunakan internal hostname.

Solusi:

- Preserve host dengan benar.
- Gunakan canonical public base URL config untuk link penting.

---

## 26. Production Checklist

Sebelum deploy Nginx reverse proxy ke Java backend, pastikan:

### Boundary

- [ ] Backend tidak bisa diakses langsung dari internet.
- [ ] Hanya trusted proxy/LB yang bisa mencapai backend.
- [ ] Unknown host ditolak.
- [ ] Public domain allowlist jelas.

### Header Contract

- [ ] `Host` dipreserve atau diset eksplisit sesuai kebutuhan.
- [ ] `X-Real-IP` diset dengan trust model jelas.
- [ ] `X-Forwarded-For` append/overwrite sesuai posisi Nginx.
- [ ] `X-Forwarded-Proto` diset.
- [ ] `X-Forwarded-Host` diset jika aplikasi perlu.
- [ ] `X-Forwarded-Port` diset jika aplikasi perlu.
- [ ] `X-Request-ID` atau correlation ID diset.
- [ ] Tidak ada conflicting `Forwarded` vs `X-Forwarded-*`.

### Java Application

- [ ] Spring Boot/Tomcat/Jetty/Undertow dikonfigurasi untuk forwarded headers.
- [ ] Cookie secure behavior diuji.
- [ ] Redirect URL diuji.
- [ ] OAuth/OIDC redirect URI diuji.
- [ ] Absolute URL generation tidak bergantung pada untrusted host.

### Observability

- [ ] Nginx log mencatat request ID.
- [ ] Java log mencatat request ID yang sama.
- [ ] Nginx log mencatat upstream timing.
- [ ] App audit log menyimpan trusted client IP dan chain jika diperlukan.

### Security

- [ ] Spoofed `X-Forwarded-For` diuji.
- [ ] Host header injection diuji.
- [ ] Debug endpoint tidak publik.
- [ ] Header sensitif tidak dilog sembarangan.

---

## 27. Latihan Praktis

### Latihan 1: Build Minimal Echo Backend

Buat endpoint Java:

```java
@GetMapping("/debug/request")
Map<String, Object> debug(HttpServletRequest request) {
    return Map.of(
        "scheme", request.getScheme(),
        "serverName", request.getServerName(),
        "serverPort", request.getServerPort(),
        "secure", request.isSecure(),
        "remoteAddr", request.getRemoteAddr(),
        "xForwardedFor", request.getHeader("X-Forwarded-For"),
        "xForwardedProto", request.getHeader("X-Forwarded-Proto"),
        "xForwardedHost", request.getHeader("X-Forwarded-Host"),
        "xRequestId", request.getHeader("X-Request-ID")
    );
}
```

Lalu jalankan di belakang Nginx.

Test:

```bash
curl -k https://app.local/debug/request
curl -k -H 'X-Forwarded-For: 1.2.3.4' https://app.local/debug/request
curl -k -H 'Host: evil.local' https://127.0.0.1/debug/request
```

Catat hasilnya.

### Latihan 2: Redirect Correctness

Buat endpoint Java yang redirect ke `/target`.

Pastikan `Location` header menggunakan HTTPS dan host publik.

```bash
curl -k -I https://app.local/redirect-test
```

### Latihan 3: Request ID Correlation

Pastikan request ID sama muncul di:

- Nginx access log,
- Java application log,
- response header jika kamu memilih expose.

Nginx:

```nginx
add_header X-Request-ID $request_id always;
proxy_set_header X-Request-ID $request_id;
```

Java log pattern:

```text
request_id=<value from X-Request-ID>
```

---

## 28. Cara Berpikir Top 1% Engineer

Engineer rata-rata bertanya:

> Header apa yang harus saya copy-paste supaya Spring Boot jalan di belakang Nginx?

Engineer kuat bertanya:

> Siapa yang boleh dipercaya untuk menyatakan IP, scheme, host, dan port asli request?

Engineer top-tier bertanya lebih jauh:

> Apakah kontrak boundary ini eksplisit, diuji, observable, aman dari spoofing, konsisten dengan audit model, dan tetap benar ketika deployment berubah dari VM ke Kubernetes atau dari single proxy ke CDN + LB + ingress chain?

Inilah perbedaan antara konfigurasi yang “jalan” dan konfigurasi yang production-defensible.

---

## 29. Ringkasan

Proxy header adalah kontrak antara Nginx dan aplikasi Java.

Kontrak ini menentukan bagaimana aplikasi memahami:

- client IP,
- scheme publik,
- host publik,
- port publik,
- request correlation,
- security context,
- audit context.

Header seperti `X-Forwarded-For` dan `X-Forwarded-Proto` bukan fakta yang otomatis benar. Mereka hanya valid jika trust boundary benar.

Prinsip utama:

1. Jangan percaya forwarded headers dari internet.
2. Nginx harus overwrite atau normalize header sesuai posisinya.
3. Backend harus hanya reachable dari trusted path.
4. Java framework harus dikonfigurasi untuk membaca forwarded headers.
5. Header contract harus diuji, dilog, dan direview seperti application code.
6. Untuk sistem audit/regulasi, simpan konteks lebih kaya daripada satu IP address.

Jika bagian ini dipahami dengan baik, kamu akan jauh lebih siap menghadapi topik berikutnya: **upstream blocks dan load balancing**, karena load balancing akan menambah dimensi baru pada kontrak antara proxy dan backend.

---

## 30. Penutup Part 008

Kita sudah menyelesaikan:

- `Host` forwarding,
- `X-Real-IP`,
- `X-Forwarded-For`,
- `X-Forwarded-Proto`,
- `X-Forwarded-Host`,
- `X-Forwarded-Port`,
- `Forwarded`,
- request/correlation ID,
- Spring Boot/Tomcat forwarded awareness,
- audit model,
- spoofing risk,
- testing strategy,
- production checklist.

Part berikutnya:

> **Part 009 — Upstream Blocks and Load Balancing**

Di sana kita akan membahas bagaimana Nginx memilih backend instance, bagaimana koneksi upstream dikelola, bagaimana failure satu node memengaruhi routing, dan bagaimana load balancing berinteraksi dengan session affinity, retries, health, dan Java service behavior.

