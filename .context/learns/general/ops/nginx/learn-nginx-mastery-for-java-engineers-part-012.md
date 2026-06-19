# Learn Nginx Mastery for Java Engineers — Part 012
# TLS Termination: Certificates, SNI, Protocols, Ciphers, and Java Implications

> Seri: `learn-nginx-mastery-for-java-engineers`  
> Part: `012 / 030`  
> Fokus: menjadikan TLS termination sebagai desain boundary yang eksplisit antara client, Nginx, dan aplikasi Java di belakangnya.

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membahas:

- Nginx architecture: master, worker, event loop.
- Configuration grammar: directive, context, inheritance.
- Server selection: `listen`, `server_name`, SNI/default server.
- Location matching.
- Static file serving.
- Reverse proxy ke backend Java.
- Proxy header contract.
- Upstream/load balancing.
- Timeout, retry, buffering, backpressure.
- Connection management dan performance tuning.

Part ini masuk ke boundary yang sangat sering salah dipahami: **TLS termination**.

Banyak engineer menganggap TLS hanya urusan “pasang sertifikat supaya HTTPS jalan”. Itu framing yang terlalu sempit.

Dalam production system, TLS termination menentukan:

- siapa yang berbicara aman dengan siapa,
- di mana identitas server dibuktikan,
- di mana plaintext muncul,
- siapa yang dipercaya untuk mengirim header `X-Forwarded-Proto`,
- bagaimana redirect dan cookie secure bekerja,
- bagaimana browser memutuskan koneksi aman,
- bagaimana backend Java memahami scheme asli request,
- apakah traffic internal tetap dienkripsi,
- bagaimana certificate rotation dilakukan tanpa outage,
- bagaimana compliance dan audit trail dipertahankan.

Jadi Part 012 bukan hanya “cara membuat HTTPS di Nginx”. Kita akan membahas TLS termination sebagai **security boundary, routing boundary, identity boundary, dan operational boundary**.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu harus mampu:

1. Menjelaskan apa itu TLS termination dan konsekuensi arsitekturnya.
2. Membedakan HTTPS client-to-Nginx, HTTPS Nginx-to-upstream, dan TLS passthrough.
3. Mendesain server block Nginx untuk HTTPS dengan certificate chain yang benar.
4. Memahami hubungan antara `server_name`, SNI, certificate selection, dan virtual host.
5. Memilih TLS protocol policy dengan reasoning, bukan copy-paste.
6. Memahami peran cipher suite, TLS 1.2, TLS 1.3, dan kompatibilitas client.
7. Menggunakan HSTS secara aman, termasuk risiko preload dan subdomain.
8. Menjelaskan OCSP stapling dan keterbatasannya.
9. Menghubungkan TLS termination dengan aplikasi Java: redirect, secure cookie, absolute URL, Spring Boot forwarded headers, dan Tomcat remote IP handling.
10. Mendesain opsi TLS ke upstream Java service: plaintext internal, HTTPS internal, mTLS internal.
11. Menghindari failure mode umum: expired cert, wrong chain, SNI mismatch, redirect loop, mixed content, bad trust boundary.
12. Membuat checklist production readiness untuk HTTPS Nginx di depan aplikasi Java.

---

## 2. Mental Model Utama

### 2.1 TLS bukan hanya enkripsi

TLS memberi tiga properti utama:

1. **Confidentiality**  
   Pihak ketiga tidak dapat membaca isi traffic.

2. **Integrity**  
   Pihak ketiga tidak dapat mengubah traffic tanpa terdeteksi.

3. **Authentication**  
   Client dapat memverifikasi bahwa server yang dia hubungi memiliki identitas yang sesuai dengan certificate.

Dalam konteks Nginx, TLS termination berarti:

```text
Client/browser
   |
   | HTTPS/TLS
   v
Nginx
   |
   | HTTP atau HTTPS
   v
Java application
```

Nginx menerima koneksi TLS dari client, mendekripsi traffic, lalu meneruskan request ke upstream.

Setelah TLS dihentikan di Nginx, request yang dikirim ke backend bisa berupa:

- HTTP plaintext,
- HTTPS/TLS baru,
- atau mTLS jika upstream perlu autentikasi dua arah.

Poin penting: **TLS termination bukan berarti security selesai. TLS termination memindahkan titik trust.**

---

## 3. Tiga Pola Utama TLS di Nginx

### 3.1 Pattern A — TLS Termination di Nginx, HTTP ke Backend

```text
Internet client
   |
   | HTTPS
   v
Nginx
   |
   | HTTP internal
   v
Java backend
```

Ini pattern paling umum.

Kelebihan:

- Sertifikat publik hanya dikelola di Nginx.
- Backend Java tidak perlu expose HTTPS.
- TLS handshake dan certificate rotation terpusat.
- Observability dan routing lebih sederhana.
- Cocok untuk internal private network yang dipercaya.

Kekurangan:

- Traffic Nginx → backend tidak terenkripsi.
- Jika internal network tidak trusted, data bisa terekspos.
- Compliance tertentu mungkin mewajibkan encryption in transit end-to-end.
- Backend harus percaya proxy header dari Nginx untuk mengetahui original scheme.

Contoh:

```nginx
server {
    listen 443 ssl;
    server_name api.example.com;

    ssl_certificate     /etc/nginx/certs/api.example.com/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/api.example.com/privkey.pem;

    location / {
        proxy_pass http://java_api_upstream;

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Host  $host;
        proxy_set_header X-Forwarded-Port  443;
    }
}
```

Untuk aplikasi Java, ini berarti aplikasi menerima request HTTP dari Nginx, tetapi secara logis original request dari client adalah HTTPS.

Maka aplikasi harus dikonfigurasi agar memahami header forwarded.

---

### 3.2 Pattern B — TLS Termination di Nginx, HTTPS ke Backend

```text
Internet client
   |
   | HTTPS
   v
Nginx
   |
   | HTTPS internal
   v
Java backend
```

Ini bukan passthrough. Nginx tetap mendekripsi TLS client, lalu membuat koneksi TLS baru ke backend.

Kelebihan:

- Traffic internal tetap encrypted in transit.
- Backend identity bisa diverifikasi oleh Nginx.
- Cocok untuk zero-trust internal network, multi-tenant cluster, compliance, atau cross-network traffic.

Kekurangan:

- Sertifikat internal perlu dikelola.
- Java backend perlu expose TLS.
- Trust store Nginx perlu dikonfigurasi.
- Ada overhead operasional lebih besar.
- Debugging certificate internal lebih kompleks.

Contoh:

```nginx
upstream java_api_tls {
    server app-1.internal.example.com:8443;
    server app-2.internal.example.com:8443;

    keepalive 32;
}

server {
    listen 443 ssl;
    server_name api.example.com;

    ssl_certificate     /etc/nginx/certs/api.example.com/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/api.example.com/privkey.pem;

    location / {
        proxy_pass https://java_api_tls;

        proxy_ssl_server_name on;
        proxy_ssl_name app.internal.example.com;
        proxy_ssl_trusted_certificate /etc/nginx/certs/internal-ca.pem;
        proxy_ssl_verify on;
        proxy_ssl_verify_depth 2;

        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    }
}
```

NGINX memiliki dokumentasi resmi untuk mengamankan traffic HTTP ke upstream server, termasuk penggunaan client certificate oleh NGINX saat berkomunikasi dengan upstream. Ini relevan ketika jalur Nginx → backend juga perlu TLS atau mTLS, bukan hanya TLS di sisi client. citeturn913491search6

---

### 3.3 Pattern C — TLS Passthrough

```text
Internet client
   |
   | TLS end-to-end
   v
Nginx stream proxy
   |
   | TLS yang sama diteruskan
   v
Java backend
```

Pada TLS passthrough, Nginx tidak mendekripsi HTTP. Nginx hanya meneruskan koneksi TCP/TLS.

Biasanya menggunakan `stream` module, bukan `http` module.

Kelebihan:

- End-to-end TLS dari client ke backend.
- Backend memegang certificate public/private sendiri.
- Nginx tidak melihat plaintext HTTP.
- Cocok untuk beberapa skenario compliance atau protocol non-HTTP.

Kekurangan besar:

- Nginx tidak bisa inspect path, header, cookie, method.
- Tidak bisa melakukan HTTP routing berbasis path.
- Tidak bisa inject proxy headers.
- Tidak bisa cache HTTP.
- Tidak bisa rate-limit berdasarkan API route.
- Observability L7 terbatas.
- Load balancing berbasis HTTP tidak tersedia.

Contoh konseptual:

```nginx
stream {
    map $ssl_preread_server_name $backend {
        api.example.com  java_api_tls;
        admin.example.com admin_tls;
        default          default_tls;
    }

    upstream java_api_tls {
        server app-1.internal.example.com:8443;
        server app-2.internal.example.com:8443;
    }

    upstream admin_tls {
        server admin-1.internal.example.com:9443;
    }

    upstream default_tls {
        server blackhole.internal.example.com:443;
    }

    server {
        listen 443;
        proxy_pass $backend;
        ssl_preread on;
    }
}
```

`ngx_stream_ssl_module` menyediakan dukungan TLS untuk stream proxy server dan membutuhkan OpenSSL; module stream SSL tidak otomatis tersedia pada semua build dan perlu diperhatikan saat packaging/build. citeturn913491search10

---

## 4. Certificate: Apa yang Sebenarnya Dipasang di Nginx?

### 4.1 Certificate bukan hanya satu file

Dalam praktik, kamu biasanya punya beberapa komponen:

```text
Private key
Server certificate
Intermediate certificate(s)
Root CA certificate
```

Di Nginx, umumnya:

```nginx
ssl_certificate     /etc/nginx/certs/example.com/fullchain.pem;
ssl_certificate_key /etc/nginx/certs/example.com/privkey.pem;
```

`fullchain.pem` biasanya berisi:

```text
server certificate
intermediate certificate(s)
```

Private key tidak boleh bocor.

Root CA biasanya tidak perlu dikirim server karena sudah ada di trust store client.

---

### 4.2 Certificate chain mental model

Ketika browser mengakses `https://api.example.com`, browser perlu membangun chain:

```text
api.example.com certificate
   signed by
Intermediate CA
   signed by
Root CA trusted by browser/OS
```

Jika chain tidak lengkap, beberapa client akan gagal walaupun browser modern tertentu mungkin tampak sukses karena caching intermediate.

Jangan validasi hanya dari laptop sendiri. Validasi dari:

- browser berbeda,
- mobile device,
- CLI `openssl`,
- external SSL checker,
- container runtime jika client-nya service internal.

---

### 4.3 Private key ownership

Nginx master process biasanya start sebagai root agar bisa bind ke port 443 dan membaca private key. Worker kemudian berjalan sebagai user non-root sesuai directive `user`.

Prinsip permission:

```text
Private key readable by Nginx master only.
Not world-readable.
Not committed to Git.
Not baked accidentally into public container image.
Rotated via controlled mechanism.
```

Contoh permission:

```bash
sudo chown root:root /etc/nginx/certs/api.example.com/privkey.pem
sudo chmod 600 /etc/nginx/certs/api.example.com/privkey.pem
```

Di container, jangan asal mount secret sebagai file yang dapat dibaca semua proses. Perhatikan UID/GID dan secret mount behavior dari orchestrator.

---

## 5. SNI: Server Name Indication

### 5.1 Masalah sebelum SNI

Sebelum HTTP request dikirim, TLS handshake terjadi dulu.

Tetapi HTTP `Host` header baru ada setelah TLS selesai.

Pertanyaannya:

> Jika satu IP:443 melayani banyak domain, bagaimana Nginx tahu certificate mana yang harus dikirim sebelum membaca HTTP Host header?

Jawabannya: **SNI**.

SNI adalah ekstensi TLS yang membuat client mengirim nama host yang ingin dihubungi saat TLS handshake.

```text
ClientHello:
  SNI = api.example.com

Nginx:
  pilih server block/certificate untuk api.example.com
```

---

### 5.2 SNI vs Host header

Keduanya berbeda:

```text
SNI         = nama host saat TLS handshake
Host header = nama host dalam HTTP request setelah TLS terbentuk
```

Pada traffic normal, SNI dan Host biasanya sama.

Tapi bisa berbeda jika client sengaja mengirim:

```text
SNI: api.example.com
Host: admin.example.com
```

Ini bisa menjadi security concern jika kamu hanya mengandalkan salah satunya.

Untuk high-security boundary, pertimbangkan validasi Host yang eksplisit:

```nginx
server {
    listen 443 ssl default_server;
    server_name _;

    ssl_certificate     /etc/nginx/certs/default/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/default/privkey.pem;

    return 444;
}

server {
    listen 443 ssl;
    server_name api.example.com;

    ssl_certificate     /etc/nginx/certs/api.example.com/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/api.example.com/privkey.pem;

    if ($host != "api.example.com") {
        return 421;
    }

    location / {
        proxy_pass http://java_api;
    }
}
```

Catatan: penggunaan `if` di Nginx punya banyak jebakan di konteks rewrite, tetapi return sederhana di server/location biasanya masih pattern yang sering digunakan. Alternatifnya desain server block catch-all dengan `default_server` yang ketat.

---

## 6. Minimal HTTPS Server Block

Contoh minimal:

```nginx
server {
    listen 80;
    server_name api.example.com;

    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name api.example.com;

    ssl_certificate     /etc/nginx/certs/api.example.com/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/api.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```

Ini cukup untuk banyak deployment awal, tetapi belum cukup untuk production yang matang.

---

## 7. Production HTTPS Baseline

Baseline lebih realistis:

```nginx
server {
    listen 80;
    server_name api.example.com;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name api.example.com;

    ssl_certificate     /etc/nginx/certs/api.example.com/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/api.example.com/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:50m;
    ssl_session_tickets off;

    add_header Strict-Transport-Security "max-age=31536000" always;

    location / {
        proxy_pass http://java_api_upstream;

        proxy_http_version 1.1;
        proxy_set_header Connection "";

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Host  $host;
        proxy_set_header X-Forwarded-Port  443;

        proxy_connect_timeout 3s;
        proxy_read_timeout 30s;
        proxy_send_timeout 30s;
    }
}
```

Nginx menyediakan directive TLS seperti `ssl_protocols`, `ssl_certificate`, `ssl_certificate_key`, session settings, dan OCSP stapling melalui `ngx_http_ssl_module`. Dokumentasi resminya juga menjelaskan bahwa OCSP stapling membutuhkan issuer certificate yang dikenal, baik melalui full chain maupun `ssl_trusted_certificate`. citeturn913491search0

---

## 8. TLS Protocol Policy

### 8.1 TLS versions

Saat ini praktik modern umumnya menggunakan:

```nginx
ssl_protocols TLSv1.2 TLSv1.3;
```

Mengapa tidak TLS 1.0/1.1?

Karena keduanya sudah tidak layak untuk modern internet-facing system.

Mengapa masih TLS 1.2?

Karena beberapa client lama, enterprise proxy, embedded environment, atau legacy Java client mungkin belum sepenuhnya mendukung TLS 1.3.

Mengapa TLS 1.3 penting?

- handshake lebih efisien,
- cipher suite lebih sederhana,
- insecure legacy algorithms dihapus,
- forward secrecy by design untuk mode utama.

Mozilla menyediakan SSL Configuration Generator untuk membantu membuat konfigurasi TLS untuk software seperti Nginx berdasarkan profil keamanan. Untuk production, generator seperti ini berguna sebagai baseline, tetapi tetap harus disesuaikan dengan kebutuhan kompatibilitas client dan policy organisasi. citeturn913491search2

---

### 8.2 Jangan copy-paste cipher lama

Banyak tutorial lama masih berisi cipher string panjang seperti:

```nginx
ssl_ciphers HIGH:!aNULL:!MD5;
```

atau konfigurasi yang mengutamakan algoritma lama.

Masalahnya:

- cipher policy berubah seiring waktu,
- client compatibility berubah,
- OpenSSL behavior berubah,
- TLS 1.3 cipher tidak dikontrol dengan cara yang sama seperti TLS 1.2 di banyak konfigurasi,
- konfigurasi terlalu agresif bisa memutus client enterprise lama,
- konfigurasi terlalu permisif melemahkan security posture.

Prinsip:

```text
TLS policy harus menjadi keputusan arsitektur, bukan hasil copy-paste.
```

Tanyakan:

1. Client apa saja yang harus didukung?
2. Apakah ada mobile app lama?
3. Apakah ada Java client lama?
4. Apakah ada partner B2B dengan legacy TLS stack?
5. Apakah compliance mewajibkan cipher tertentu?
6. Apakah endpoint internet-facing atau internal-only?
7. Apakah traffic ini public API atau admin-only?

---

## 9. HTTP to HTTPS Redirect

Pattern umum:

```nginx
server {
    listen 80;
    server_name api.example.com;

    return 301 https://$host$request_uri;
}
```

Tetapi ada beberapa edge case.

### 9.1 ACME challenge

Jika menggunakan HTTP-01 challenge untuk certificate issuance, path challenge harus tetap bisa diakses via HTTP:

```nginx
server {
    listen 80;
    server_name api.example.com;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}
```

### 9.2 Jangan redirect ke `$server_name` sembarangan

```nginx
return 301 https://$server_name$request_uri;
```

Bisa salah jika `server_name` berisi wildcard atau nilai pertama yang bukan host request aktual.

Biasanya lebih baik:

```nginx
return 301 https://$host$request_uri;
```

Tetapi `$host` juga harus dilindungi dari host header yang tidak valid dengan default server/catch-all yang benar.

---

## 10. HSTS: Strict-Transport-Security

### 10.1 Apa itu HSTS?

HSTS memberitahu browser:

> Untuk domain ini, selalu gunakan HTTPS selama periode tertentu.

Contoh:

```nginx
add_header Strict-Transport-Security "max-age=31536000" always;
```

Setelah browser menerima header ini, browser akan otomatis mengubah request HTTP ke HTTPS untuk domain tersebut sebelum request dikirim.

---

### 10.2 Kenapa `always` penting?

Tanpa `always`, header tertentu mungkin hanya dikirim pada status code tertentu.

Dengan:

```nginx
add_header Strict-Transport-Security "max-age=31536000" always;
```

Nginx akan mengirim header juga pada response error yang relevan.

NGINX pernah menerbitkan panduan HSTS yang menjelaskan bahwa header ini memberi tahu browser untuk mengakses situs hanya melalui HTTPS dalam durasi tertentu, dan menekankan detail seperti inheritance `add_header` serta penggunaan `always` pada konfigurasi modern. citeturn913491search5

---

### 10.3 Risiko HSTS

HSTS bisa berbahaya jika digunakan sembarangan.

Contoh:

```nginx
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
```

Ini berarti:

- semua subdomain wajib HTTPS,
- browser dapat preload policy,
- rollback sulit,
- subdomain lama yang belum support HTTPS bisa rusak,
- environment internal atau staging di subdomain bisa terdampak jika domain hierarchy salah.

Gunakan bertahap:

```text
max-age=300
max-age=3600
max-age=86400
max-age=31536000
includeSubDomains
preload only after deep audit
```

Jangan langsung `includeSubDomains; preload` tanpa inventory domain.

---

## 11. OCSP Stapling

### 11.1 Problem yang diselesaikan

Browser perlu tahu apakah certificate dicabut atau masih valid.

Tanpa OCSP stapling, browser bisa menghubungi CA/OCSP responder sendiri.

Dengan OCSP stapling, server menyertakan status certificate yang sudah “distaple” saat handshake.

Contoh konfigurasi:

```nginx
ssl_stapling on;
ssl_stapling_verify on;
ssl_trusted_certificate /etc/nginx/certs/api.example.com/chain.pem;
resolver 1.1.1.1 8.8.8.8 valid=300s;
resolver_timeout 5s;
```

Tetapi jangan hanya menyalakan directive tanpa memahami syaratnya:

- Nginx harus bisa resolve dan reach OCSP responder.
- Issuer certificate harus tersedia.
- Chain harus benar.
- Certificate authority harus mendukung OCSP.
- Behavior bisa berbeda bergantung CA.

Dokumentasi `ngx_http_ssl_module` menyebutkan bahwa agar OCSP stapling bekerja, certificate issuer harus dikenal; jika file `ssl_certificate` tidak memuat intermediate certificate, issuer perlu tersedia melalui `ssl_trusted_certificate`. citeturn913491search0

---

## 12. TLS Session Reuse

TLS handshake punya biaya CPU dan latency.

Nginx dapat menggunakan session cache:

```nginx
ssl_session_cache shared:SSL:50m;
ssl_session_timeout 1d;
ssl_session_tickets off;
```

Mental model:

```text
Full handshake mahal.
Resumed handshake lebih murah.
```

Tetapi session tickets memiliki implikasi key management. Jika ticket key tidak dikelola dengan benar, forward secrecy posture bisa melemah.

Untuk banyak sistem, `ssl_session_tickets off` adalah baseline konservatif kecuali kamu punya strategi rotasi ticket key yang baik.

---

## 13. TLS and HTTP/2

Biasanya HTTP/2 diaktifkan di listener TLS:

```nginx
listen 443 ssl http2;
```

Konsekuensi:

- Client dapat multiplex beberapa request di satu koneksi.
- Frontend latency bisa membaik.
- Browser negotiation menggunakan ALPN.
- Backend belum tentu HTTP/2; Nginx bisa tetap proxy ke HTTP/1.1 upstream.

Jangan berasumsi:

```text
Client uses HTTP/2 => backend also receives HTTP/2
```

Biasanya:

```text
Browser --HTTP/2 TLS--> Nginx --HTTP/1.1--> Java backend
```

Itu normal.

---

## 14. TLS to Upstream Java Backend

### 14.1 Basic HTTPS upstream

```nginx
location / {
    proxy_pass https://app.internal.example.com:8443;

    proxy_ssl_server_name on;
    proxy_ssl_name app.internal.example.com;
    proxy_ssl_trusted_certificate /etc/nginx/certs/internal-ca.pem;
    proxy_ssl_verify on;
}
```

`proxy_ssl_server_name on` membuat Nginx mengirim SNI saat koneksi ke upstream HTTPS.

Jika tidak, upstream yang melayani banyak certificate dapat mengirim certificate yang salah.

---

### 14.2 Jangan matikan verification kecuali benar-benar tahu risikonya

Anti-pattern:

```nginx
proxy_ssl_verify off;
```

Ini membuat koneksi terenkripsi tetapi identitas upstream tidak diverifikasi.

Artinya Nginx tidak benar-benar tahu apakah dia berbicara dengan backend yang benar.

Kadang ini dipakai sementara untuk self-signed cert. Tetapi untuk production, lebih baik:

- buat internal CA,
- trust internal CA di Nginx,
- gunakan DNS/internal SAN yang benar,
- enable `proxy_ssl_verify on`.

---

### 14.3 mTLS to upstream

Jika backend ingin memastikan request benar-benar dari Nginx, bukan sembarang client internal, gunakan client certificate:

```nginx
location / {
    proxy_pass https://app.internal.example.com:8443;

    proxy_ssl_server_name on;
    proxy_ssl_name app.internal.example.com;
    proxy_ssl_verify on;
    proxy_ssl_trusted_certificate /etc/nginx/certs/internal-ca.pem;

    proxy_ssl_certificate     /etc/nginx/certs/nginx-client/client.pem;
    proxy_ssl_certificate_key /etc/nginx/certs/nginx-client/client.key;
}
```

Backend Java kemudian dikonfigurasi untuk meminta dan memverifikasi client certificate dari Nginx.

Ini berguna jika:

- internal network tidak sepenuhnya trusted,
- ada multi-tenant platform,
- service-to-service identity penting,
- compliance mewajibkan mutual authentication,
- kamu ingin mencegah bypass langsung ke backend.

---

## 15. Client Certificate Authentication at Nginx

Nginx juga bisa meminta certificate dari client.

Contoh:

```nginx
server {
    listen 443 ssl;
    server_name partner-api.example.com;

    ssl_certificate     /etc/nginx/certs/partner-api/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/partner-api/privkey.pem;

    ssl_client_certificate /etc/nginx/certs/partner-ca.pem;
    ssl_verify_client on;

    location / {
        proxy_pass http://partner_api_backend;

        proxy_set_header X-Client-Cert-Verify $ssl_client_verify;
        proxy_set_header X-Client-Cert-DN     $ssl_client_s_dn;
    }
}
```

Use case:

- B2B API,
- partner integration,
- admin endpoint,
- internal tooling,
- high-assurance service boundary.

Important:

Jangan asal meneruskan certificate metadata ke backend tanpa menghapus spoofed incoming headers.

Lebih aman:

```nginx
proxy_set_header X-Client-Cert-Verify "";
proxy_set_header X-Client-Cert-DN "";

proxy_set_header X-Client-Cert-Verify $ssl_client_verify;
proxy_set_header X-Client-Cert-DN     $ssl_client_s_dn;
```

Atau gunakan header names internal yang hanya diset oleh Nginx dan diblokir dari client.

---

## 16. Java Application Implications

### 16.1 The scheme problem

Client mengakses:

```text
https://api.example.com/orders
```

Nginx meneruskan ke backend:

```text
http://127.0.0.1:8080/orders
```

Dari sudut pandang Java app, koneksi masuk adalah HTTP.

Jika app tidak membaca forwarded headers, dia bisa berpikir:

```text
scheme = http
serverPort = 8080
secure = false
```

Dampaknya:

- redirect ke `http://...`,
- generated absolute URL salah,
- OAuth callback mismatch,
- cookie tidak diberi `Secure`,
- Swagger/OpenAPI server URL salah,
- HATEOAS link salah,
- audit log scheme salah,
- security constraint salah.

---

### 16.2 Required proxy headers

Nginx perlu mengirim:

```nginx
proxy_set_header Host              $host;
proxy_set_header X-Forwarded-Host  $host;
proxy_set_header X-Forwarded-Proto https;
proxy_set_header X-Forwarded-Port  443;
proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
proxy_set_header X-Real-IP         $remote_addr;
```

Tetapi mengirim header saja tidak cukup. Java framework harus dikonfigurasi untuk mempercayainya.

---

### 16.3 Spring Boot

Untuk Spring Boot, ada beberapa pendekatan bergantung versi dan stack.

Konsepnya:

```properties
server.forward-headers-strategy=framework
```

atau pada setup tertentu:

```properties
server.forward-headers-strategy=native
```

Tujuan:

- Spring memahami `X-Forwarded-*` atau `Forwarded`,
- request scheme menjadi HTTPS secara logis,
- redirect URL benar,
- generated links benar.

Contoh symptom jika belum benar:

```text
User login via https://app.example.com
Spring Security redirects to http://app.example.com/login
Browser blocks/misroutes/mixed content occurs
```

---

### 16.4 Tomcat RemoteIpValve

Jika menggunakan Tomcat, konsep yang sering dipakai adalah RemoteIpValve atau konfigurasi forwarded headers.

Mental model:

```text
Only trust forwarded headers from trusted proxy IPs.
Do not trust arbitrary client-provided X-Forwarded-For.
```

Jika public client bisa mengirim header:

```text
X-Forwarded-Proto: https
X-Forwarded-For: 10.0.0.1
```

lalu backend mempercayainya langsung, security dan audit bisa rusak.

Di Nginx, pastikan header dikontrol ulang:

```nginx
proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto https;
```

Jika butuh ketat, clear/override semua forwarded headers dari client.

---

### 16.5 Cookie Secure and SameSite

Jika TLS terminate di Nginx, backend perlu tetap tahu bahwa original scheme adalah HTTPS.

Jika tidak, cookie session mungkin dibuat tanpa `Secure`.

Example bad response:

```http
Set-Cookie: JSESSIONID=abc123; Path=/; HttpOnly
```

Expected for HTTPS app:

```http
Set-Cookie: JSESSIONID=abc123; Path=/; Secure; HttpOnly; SameSite=Lax
```

Nginx bisa memodifikasi cookie dengan directive tertentu, tetapi sumber kebenaran sebaiknya aplikasi tahu request aslinya secure.

Jangan menjadikan Nginx sebagai patch permanen untuk semua kesalahan security cookie aplikasi.

---

## 17. Redirect Loop Failure Model

### 17.1 Typical loop

Flow:

```text
Client -> HTTPS -> Nginx -> HTTP -> Java app
Java app thinks request is HTTP
Java app redirects to HTTPS
Client follows HTTPS
Nginx forwards HTTP again
Java app redirects again
Loop
```

Symptom:

```text
ERR_TOO_MANY_REDIRECTS
301/302 repeated
```

Root cause:

```text
Backend does not trust/understand X-Forwarded-Proto: https
```

Fix:

1. Nginx sets forwarded proto.
2. Backend trusts forwarded headers only from Nginx.
3. App security config uses forwarded scheme.

---

## 18. Mixed Content Failure Model

Client loads page:

```text
https://app.example.com
```

HTML/JS references:

```html
<script src="http://app.example.com/app.js"></script>
```

Browser blocks it as mixed content.

Root causes:

- backend generated absolute HTTP URL,
- frontend env configured with `http://`,
- CDN/static URL wrong,
- app unaware original scheme is HTTPS,
- proxy header not configured.

Fix:

- prefer relative URLs where possible,
- set frontend runtime config correctly,
- configure forwarded headers,
- validate generated OpenAPI/server URLs,
- test from browser security console.

---

## 19. Certificate Rotation Without Downtime

### 19.1 Reload, not restart

After certificate renewal:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

Nginx reload behavior:

- master validates config,
- starts new workers with new config/certs,
- old workers finish existing connections,
- no hard downtime if reload succeeds.

Do not blindly restart Nginx if reload is enough.

---

### 19.2 Rotation checklist

1. New certificate issued.
2. Full chain correct.
3. Private key path correct.
4. File permission correct.
5. `nginx -t` passes.
6. Reload succeeds.
7. External validation passes.
8. Monitoring confirms expiry date updated.
9. Old certificate archived/removed according to policy.

---

## 20. Default TLS Server and Unknown Host Strategy

Do not let unknown host accidentally hit your main app.

Bad:

```nginx
server {
    listen 443 ssl default_server;
    server_name api.example.com;
    ...
}
```

Better:

```nginx
server {
    listen 443 ssl default_server;
    server_name _;

    ssl_certificate     /etc/nginx/certs/default/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/default/privkey.pem;

    return 444;
}

server {
    listen 443 ssl;
    server_name api.example.com;

    ssl_certificate     /etc/nginx/certs/api.example.com/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/api.example.com/privkey.pem;

    location / {
        proxy_pass http://java_api;
    }
}
```

Kenapa perlu certificate default?

Karena TLS handshake tetap butuh certificate sebelum Nginx bisa return HTTP response.

Untuk unknown SNI, Nginx masih perlu mengirim semacam certificate default.

---

## 21. Security Headers Related to TLS

TLS tidak menggantikan security headers.

Minimal yang sering terkait HTTPS:

```nginx
add_header Strict-Transport-Security "max-age=31536000" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
```

CSP sebaiknya dirancang dengan aplikasi, bukan asal tempel:

```nginx
add_header Content-Security-Policy "default-src 'self'" always;
```

CSP yang salah bisa merusak frontend.

CSP yang terlalu longgar bisa memberi rasa aman palsu.

Untuk API-only endpoint, CSP mungkin tidak sepenting untuk HTML-serving endpoint.

---

## 22. TLS Boundary Decision Matrix

| Requirement | Recommended Pattern |
|---|---|
| Simple public web/API, trusted private subnet | TLS at Nginx, HTTP upstream |
| Compliance requires internal encryption | TLS at Nginx, HTTPS upstream |
| Backend must authenticate proxy | TLS at Nginx, mTLS upstream |
| Client cert auth for partner API | mTLS client → Nginx |
| Nginx must not inspect HTTP | TLS passthrough via stream |
| Need path/header routing | TLS termination at Nginx |
| Need cache/rate-limit by route | TLS termination at Nginx |
| Need end-to-end TLS identity at app | TLS passthrough or re-encrypt with strict verification |
| Need Java app aware of original scheme | Termination + forwarded headers + trusted proxy config |

---

## 23. Common Failure Modes

### 23.1 Expired certificate

Symptom:

```text
NET::ERR_CERT_DATE_INVALID
curl: certificate has expired
```

Prevention:

- expiry monitoring,
- renewal automation,
- reload automation,
- alert before expiry,
- test renewal path.

---

### 23.2 Missing intermediate certificate

Symptom:

```text
works on my browser, fails on Java client/container/mobile
```

Cause:

- `ssl_certificate` points to leaf certificate only, not full chain.

Fix:

```nginx
ssl_certificate /path/to/fullchain.pem;
```

---

### 23.3 Wrong certificate served

Causes:

- wrong `server_name`,
- missing SNI from client,
- wrong `default_server`,
- wildcard certificate mismatch,
- config include order issue,
- duplicate server blocks.

Debug:

```bash
openssl s_client -connect api.example.com:443 -servername api.example.com </dev/null
```

---

### 23.4 Redirect loop

Cause:

- backend thinks request is HTTP.

Fix:

- set `X-Forwarded-Proto https`,
- configure Java framework to trust it.

---

### 23.5 Mixed content

Cause:

- backend/frontend emits `http://` assets or API URLs.

Fix:

- forwarded headers,
- relative URLs,
- environment config,
- browser console validation.

---

### 23.6 Backend HTTPS fails

Symptom:

```text
502 Bad Gateway
upstream SSL certificate verify error
```

Causes:

- backend cert CN/SAN mismatch,
- missing `proxy_ssl_server_name on`,
- wrong `proxy_ssl_name`,
- missing trusted CA,
- expired internal cert.

Fix:

```nginx
proxy_ssl_server_name on;
proxy_ssl_name app.internal.example.com;
proxy_ssl_trusted_certificate /etc/nginx/certs/internal-ca.pem;
proxy_ssl_verify on;
```

---

## 24. Debugging Toolkit

### 24.1 Validate Nginx config

```bash
nginx -t
nginx -T | less
```

Use `-T` to inspect effective loaded config including includes.

---

### 24.2 Inspect certificate from outside

```bash
openssl s_client -connect api.example.com:443 -servername api.example.com </dev/null
```

Useful flags:

```bash
openssl s_client \
  -connect api.example.com:443 \
  -servername api.example.com \
  -showcerts \
  </dev/null
```

Check:

- served certificate subject,
- issuer,
- SAN,
- validity date,
- chain,
- negotiated protocol,
- verification result.

---

### 24.3 Test HTTP/2 negotiation

```bash
curl -I --http2 https://api.example.com
```

---

### 24.4 Test redirect

```bash
curl -I http://api.example.com/orders
```

Expected:

```http
HTTP/1.1 301 Moved Permanently
Location: https://api.example.com/orders
```

---

### 24.5 Test backend headers

Create temporary debug endpoint in Java or use logs to confirm:

```text
scheme=https
host=api.example.com
port=443
remoteAddr=<expected client/proxy behavior>
secure=true
```

Do not expose debug endpoint publicly in production.

---

## 25. Production Configuration Example

```nginx
# /etc/nginx/conf.d/api.example.com.conf

upstream api_backend {
    server 10.10.1.11:8080 max_fails=3 fail_timeout=10s;
    server 10.10.1.12:8080 max_fails=3 fail_timeout=10s;
    keepalive 64;
}

server {
    listen 80;
    server_name api.example.com;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name api.example.com;

    ssl_certificate     /etc/nginx/certs/api.example.com/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/api.example.com/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:50m;
    ssl_session_tickets off;

    # Enable only if chain/resolver/CA behavior has been tested.
    # ssl_stapling on;
    # ssl_stapling_verify on;
    # ssl_trusted_certificate /etc/nginx/certs/api.example.com/chain.pem;
    # resolver 1.1.1.1 8.8.8.8 valid=300s;

    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    access_log /var/log/nginx/api.example.com.access.log main;
    error_log  /var/log/nginx/api.example.com.error.log warn;

    location / {
        proxy_pass http://api_backend;

        proxy_http_version 1.1;
        proxy_set_header Connection "";

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Host  $host;
        proxy_set_header X-Forwarded-Port  443;

        proxy_connect_timeout 3s;
        proxy_send_timeout 30s;
        proxy_read_timeout 30s;
    }
}
```

---

## 26. Java Backend Configuration Example

### 26.1 Spring Boot

`application.yml`:

```yaml
server:
  forward-headers-strategy: framework
```

For servlet stack, validate behavior with:

```java
@GetMapping("/debug/request")
public Map<String, Object> debug(HttpServletRequest request) {
    return Map.of(
        "scheme", request.getScheme(),
        "serverName", request.getServerName(),
        "serverPort", request.getServerPort(),
        "secure", request.isSecure(),
        "remoteAddr", request.getRemoteAddr()
    );
}
```

Do not leave this endpoint public.

Expected behind HTTPS Nginx:

```json
{
  "scheme": "https",
  "serverName": "api.example.com",
  "serverPort": 443,
  "secure": true
}
```

---

## 27. Operational Checklist

### 27.1 Before going live

- [ ] Certificate file uses full chain.
- [ ] Private key permission is restricted.
- [ ] `nginx -t` passes.
- [ ] HTTP redirects to HTTPS.
- [ ] ACME challenge path still works if needed.
- [ ] Unknown host does not hit application.
- [ ] SNI serves correct certificate.
- [ ] TLS versions match policy.
- [ ] HSTS max-age chosen intentionally.
- [ ] `includeSubDomains` not enabled without domain inventory.
- [ ] Java app sees original scheme as HTTPS.
- [ ] Secure cookies are emitted.
- [ ] OAuth/callback URLs are correct.
- [ ] Mixed content tested in browser.
- [ ] Certificate expiry monitoring exists.
- [ ] Reload process tested.

---

### 27.2 For HTTPS upstream

- [ ] Backend certificate SAN matches `proxy_ssl_name`.
- [ ] `proxy_ssl_server_name on` enabled.
- [ ] Internal CA configured via `proxy_ssl_trusted_certificate`.
- [ ] `proxy_ssl_verify on` enabled.
- [ ] mTLS client cert configured if required.
- [ ] Internal cert rotation procedure exists.
- [ ] Backend Java TLS config tested independently.

---

## 28. Design Exercise

Kamu punya sistem:

```text
https://app.example.com       -> Vue SPA served by Nginx
https://api.example.com       -> Spring Boot API
https://partner.example.com   -> B2B API requiring client certificate
```

Backend:

```text
api-service:8080 internal HTTP
partner-service:8443 internal HTTPS with mTLS
```

Tugas desain:

1. Domain mana yang memakai HSTS?
2. Apakah `includeSubDomains` aman?
3. Bagaimana default server untuk unknown host?
4. Header apa yang dikirim ke Spring Boot?
5. Bagaimana partner client certificate divalidasi?
6. Apakah partner certificate metadata diteruskan ke backend?
7. Apakah Nginx → partner backend perlu mTLS?
8. Bagaimana certificate rotation dilakukan?
9. Apa monitoring minimum?
10. Failure apa yang paling mungkin terjadi saat renewal?

Jawaban yang matang tidak hanya berupa config, tetapi juga policy dan failure model.

---

## 29. Ringkasan Mental Model

TLS termination di Nginx adalah keputusan arsitektur.

Jangan berpikir:

```text
TLS = pasang cert = selesai
```

Berpikirlah:

```text
TLS menentukan boundary trust, identity, plaintext visibility, routing capability, Java framework behavior, redirect correctness, cookie security, and operational failure modes.
```

Ada tiga pola utama:

```text
1. Client HTTPS -> Nginx -> HTTP backend
2. Client HTTPS -> Nginx -> HTTPS backend
3. Client TLS passthrough -> backend
```

Pilih berdasarkan:

- routing need,
- security requirement,
- compliance,
- observability,
- operational complexity,
- backend capability,
- trust boundary.

Untuk Java backend, hal terpenting adalah:

```text
If TLS terminates at Nginx, the backend must be told and must safely trust that the original request was HTTPS.
```

Tanpa itu, kamu akan mendapat redirect loop, wrong absolute URL, insecure cookie, OAuth mismatch, mixed content, dan audit log yang misleading.

---

## 30. Referensi Resmi dan Baseline Lanjutan

- NGINX `ngx_http_ssl_module`: directive TLS, certificate, session, OCSP stapling.  
  https://nginx.org/en/docs/http/ngx_http_ssl_module.html

- NGINX Admin Guide: SSL/TLS termination.  
  https://docs.nginx.com/nginx/admin-guide/security-controls/terminating-ssl-http/

- NGINX Admin Guide: securing HTTP traffic to upstream servers.  
  https://docs.nginx.com/nginx/admin-guide/security-controls/securing-http-traffic-upstream/

- NGINX stream SSL module.  
  https://nginx.org/en/docs/stream/ngx_stream_ssl_module.html

- Mozilla SSL Configuration Generator.  
  https://ssl-config.mozilla.org/

---

## 31. Status Seri

Part ini adalah:

```text
Part 012 dari 030
```

Seri belum selesai.

Part berikutnya:

```text
Part 013 — HTTP/2, HTTP/3/QUIC, and Protocol-Level Trade-Offs
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-nginx-mastery-for-java-engineers-part-011.md">⬅️ Part 011 — Connection Management and Performance Tuning</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-nginx-mastery-for-java-engineers-part-013.md">Part 013 — HTTP/2, HTTP/3/QUIC, and Protocol-Level Trade-Offs ➡️</a>
</div>
