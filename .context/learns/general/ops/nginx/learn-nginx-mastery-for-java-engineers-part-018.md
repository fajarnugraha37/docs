# learn-nginx-mastery-for-java-engineers-part-018.md

# Part 018 — Security Hardening: Headers, Request Limits, Path Safety, and Config Integrity

## Status Seri

- Seri: `learn-nginx-mastery-for-java-engineers`
- Part: `018 / 030`
- Status seri: **belum selesai**
- Part sebelumnya: `017 — Access Control, Basic Auth, IP Rules, and Internal Endpoints`
- Part berikutnya: `019 — Observability: Access Logs, Error Logs, Correlation IDs, and Metrics`

---

## 0. Tujuan Bagian Ini

Bagian ini membahas Nginx sebagai **security enforcement layer** di depan aplikasi Java.

Namun penting untuk tidak salah framing.

Nginx bukan pengganti secure coding, authorization domain, input validation, WAF penuh, secret management, atau review arsitektur. Tetapi Nginx sering menjadi **lapisan pertama yang menerima request tidak dipercaya**. Karena itu, Nginx adalah tempat strategis untuk menerapkan aturan defensive yang sifatnya:

1. murah,
2. deterministik,
3. berlaku sebelum request mencapai aplikasi,
4. mudah diobservasi,
5. konsisten lintas service,
6. dapat menurunkan blast radius saat aplikasi punya celah.

Setelah bagian ini, kamu harus bisa memahami:

- apa peran Nginx dalam security boundary,
- response security header apa yang layak ditaruh di Nginx,
- request limit apa yang harus dikontrol sebelum masuk JVM,
- kenapa body/header buffer bukan sekadar tuning performa,
- bagaimana path traversal dan hidden file exposure bisa terjadi,
- kapan Nginx harus menolak request sebelum Java app melihatnya,
- kenapa error page dan log bisa menjadi sumber information leakage,
- kenapa integritas konfigurasi Nginx harus diperlakukan seperti source code production,
- bagaimana membuat hardening checklist yang realistis.

Target akhirnya bukan hafal directive, tetapi punya mental model:

> Nginx hardening adalah proses mengubah edge proxy dari sekadar penerus request menjadi boundary yang secara eksplisit membatasi bentuk, ukuran, jalur, metadata, dan exposure traffic sebelum menyentuh aplikasi.

---

## 1. Nginx Security Boundary: Apa yang Bisa dan Tidak Bisa Dilakukan

Dalam arsitektur Java backend umum, request melewati beberapa boundary:

```text
Client / Internet
      |
      v
DNS / CDN / Cloud LB
      |
      v
Nginx
      |
      v
Java Application
      |
      v
Database / Queue / External Services
```

Nginx biasanya berada sebelum aplikasi. Artinya, Nginx bisa mengontrol:

- apakah request boleh masuk,
- host/path mana yang valid,
- ukuran header/body,
- apakah protocol/scheme diterima,
- apakah static file boleh dibaca,
- apakah endpoint internal diekspos,
- apakah response diberi security header,
- apakah error internal disembunyikan,
- apakah request abnormal langsung dihentikan.

Tetapi Nginx tidak bisa memahami sepenuhnya:

- apakah user berhak mengakses case tertentu,
- apakah transaksi bisnis valid,
- apakah data input benar secara domain,
- apakah state transition legal,
- apakah actor boleh melakukan escalation tertentu,
- apakah payload JSON memiliki semantic yang aman,
- apakah aplikasi melakukan authorization object-level dengan benar.

Jadi rule praktisnya:

> Gunakan Nginx untuk security concern yang berbasis protocol, transport, route, metadata, ukuran, path, exposure, dan edge policy. Gunakan aplikasi Java untuk security concern berbasis identitas, domain, ownership, workflow, state, dan audit semantics.

Contoh pembagian tanggung jawab:

| Concern | Lebih Cocok di Nginx | Lebih Cocok di Java App |
|---|---:|---:|
| HTTP ke HTTPS redirect | Ya | Tidak utama |
| HSTS | Ya | Bisa, tapi sering lebih konsisten di edge |
| Request body max size | Ya | Ya, sebagai defense-in-depth |
| Object-level authorization | Tidak | Ya |
| Role-based action authorization | Tidak | Ya |
| Blocking `.git` / `.env` static file | Ya | Tidak utama |
| Validasi JSON schema domain | Tidak utama | Ya |
| Login rate limit | Ya, coarse-grained | Ya, fine-grained |
| Audit domain event | Tidak | Ya |
| Header canonicalization | Ya | Bisa |
| Secure cookie semantics | Bisa sebagian | Ya, app harus benar |

Nginx hardening paling kuat saat dipakai sebagai **coarse-grained guardrail**, bukan sebagai tempat logika bisnis.

---

## 2. Threat Model Dasar untuk Nginx di Depan Java Backend

Sebelum menulis konfigurasi, tanyakan: ancaman apa yang ingin diturunkan?

Beberapa ancaman umum:

1. **Information disclosure**
   - file hidden terekspos,
   - error page membocorkan stack/proxy detail,
   - server version terekspos,
   - directory listing aktif,
   - log menyimpan token.

2. **Request amplification / resource exhaustion**
   - body terlalu besar,
   - header terlalu besar,
   - terlalu banyak koneksi,
   - upload lambat,
   - endpoint mahal dihajar,
   - buffering memenuhi disk.

3. **Path confusion**
   - path traversal,
   - `alias` salah,
   - `try_files` salah,
   - static route mengekspose file sensitif,
   - encoded URI bypass.

4. **Host/proxy confusion**
   - Host header injection,
   - domain asing masuk ke app,
   - forwarded header spoofing,
   - redirect URL salah,
   - poisoned absolute URL.

5. **Browser-side risk**
   - clickjacking,
   - MIME sniffing,
   - missing HSTS,
   - permissive CSP,
   - unsafe referrer leakage.

6. **Operational compromise**
   - config diganti tanpa review,
   - reload tanpa test,
   - secret di config bocor,
   - included file tidak terlihat di review,
   - emergency change tidak dilacak.

7. **Edge bypass**
   - backend port terbuka langsung,
   - internal endpoint bisa diakses tanpa Nginx,
   - cloud security group salah,
   - Kubernetes service diekspos terlalu luas.

Nginx hardening harus dilihat sebagai kombinasi:

```text
Valid request shape
+ Valid route
+ Valid host
+ Bounded resource usage
+ Minimal information exposure
+ Controlled response metadata
+ Auditable config lifecycle
```

---

## 3. Baseline Server Block: Fail Closed untuk Unknown Host

Salah satu hardening paling mendasar adalah memastikan request dengan host tidak dikenal tidak jatuh ke aplikasi utama.

Contoh buruk:

```nginx
server {
    listen 80;
    server_name app.example.com;

    location / {
        proxy_pass http://java_backend;
    }
}
```

Masalahnya: jika ini menjadi default server untuk port tersebut, request dengan `Host: anything.example` bisa tetap masuk.

Lebih aman:

```nginx
server {
    listen 80 default_server;
    server_name _;
    return 444;
}

server {
    listen 80;
    server_name app.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name app.example.com;

    ssl_certificate     /etc/nginx/certs/app.example.com/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/app.example.com/privkey.pem;

    location / {
        proxy_pass http://java_backend;
    }
}
```

Untuk HTTPS, gunakan default TLS server yang juga tidak meneruskan request ke app:

```nginx
server {
    listen 443 ssl default_server;
    server_name _;

    ssl_certificate     /etc/nginx/certs/default/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/default/privkey.pem;

    return 444;
}
```

Catatan:

- `444` adalah status khusus Nginx untuk menutup koneksi tanpa response HTTP.
- Tidak selalu cocok untuk semua environment karena bisa membingungkan observability atau client resmi.
- Alternatifnya gunakan `return 404;` atau static minimal error page.

Prinsip penting:

> Unknown host should not reach your Java application.

Untuk sistem regulatory/case-management, ini sangat penting karena app sering membangun absolute URL, tenant context, callback URL, atau audit metadata dari host/scheme. Host salah bisa berdampak ke redirect, link email, callback, atau tenant resolution.

---

## 4. Menyembunyikan Versi Server

Directive:

```nginx
server_tokens off;
```

Biasanya diletakkan di `http` context:

```nginx
http {
    server_tokens off;

    # ...
}
```

Ini mengurangi exposure versi Nginx pada error page dan `Server` header.

Namun jangan keliru:

- Ini bukan security control yang kuat.
- Ini tidak memperbaiki vulnerability.
- Ini hanya mengurangi informasi gratis untuk attacker.

Tetap wajib:

- patching,
- dependency tracking,
- config review,
- minimizing modules,
- least privilege.

Mental model:

> Hiding version is hygiene, not hardening by itself.

---

## 5. Response Security Headers

Security headers adalah instruksi dari server ke browser tentang bagaimana response boleh diperlakukan.

Nginx cocok untuk mengatur sebagian security header karena:

- bisa konsisten untuk banyak service,
- dekat dengan TLS boundary,
- dapat dipasang untuk static files dan proxied responses,
- menghindari konfigurasi tersebar di banyak aplikasi.

Namun beberapa header, terutama CSP, sering butuh awareness aplikasi/frontend.

### 5.1 `Strict-Transport-Security` / HSTS

HSTS memberi tahu browser bahwa domain harus diakses via HTTPS untuk durasi tertentu.

Contoh:

```nginx
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
```

Untuk domain yang benar-benar siap preload:

```nginx
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
```

Jangan asal pakai `includeSubDomains` atau `preload`.

Risiko:

- subdomain lama yang belum support HTTPS bisa rusak,
- environment internal bisa terganggu,
- preload sulit dibatalkan cepat,
- staging domain bisa ikut terdampak jika domain strategy buruk.

Rekomendasi praktis:

```nginx
# Production public domain only
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
```

Untuk staging/dev:

```nginx
# Avoid long HSTS on shared/dev/staging domains unless intentional
# add_header Strict-Transport-Security "max-age=300" always;
```

Prinsip:

> HSTS adalah komitmen operasional, bukan sekadar header keamanan.

### 5.2 `X-Content-Type-Options`

Header:

```nginx
add_header X-Content-Type-Options "nosniff" always;
```

Tujuannya mencegah browser menebak MIME type berbeda dari yang dikirim server.

Ini penting untuk static asset dan upload/download endpoints. Jika file dikirim sebagai `text/plain`, browser tidak boleh menebaknya sebagai script.

### 5.3 `X-Frame-Options` atau CSP `frame-ancestors`

Untuk mencegah clickjacking:

```nginx
add_header X-Frame-Options "DENY" always;
```

Atau jika app perlu di-embed oleh domain tertentu, lebih modern menggunakan CSP:

```nginx
add_header Content-Security-Policy "frame-ancestors 'self' https://portal.example.com" always;
```

Catatan:

- `X-Frame-Options` lebih sederhana.
- `frame-ancestors` lebih fleksibel.
- Jangan set `DENY` jika aplikasi memang harus di-embed di portal resmi.

### 5.4 `Referrer-Policy`

Contoh aman umum:

```nginx
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
```

Atau lebih ketat:

```nginx
add_header Referrer-Policy "no-referrer" always;
```

Trade-off:

- `no-referrer` mengurangi leakage, tapi bisa mengurangi analytics dan integrasi tertentu.
- `strict-origin-when-cross-origin` sering menjadi default praktis yang seimbang.

Untuk sistem yang mengandung case number, token, atau identifier sensitif di URL, jangan hanya bergantung pada Referrer-Policy. Lebih baik jangan taruh data sensitif di URL sejak awal.

### 5.5 `Permissions-Policy`

Contoh:

```nginx
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
```

Ini membatasi browser features.

Untuk enterprise web app umum, sering kali aman mematikan feature yang tidak dipakai.

Jika app butuh geolocation atau camera, jangan set global terlalu ketat tanpa route-level exception.

### 5.6 `Content-Security-Policy` / CSP

CSP sangat kuat, tapi juga paling mudah merusak aplikasi.

Contoh baseline ketat untuk static/admin sederhana:

```nginx
add_header Content-Security-Policy "default-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'" always;
```

Untuk SPA modern, CSP biasanya perlu mempertimbangkan:

- CDN asset,
- API domain,
- WebSocket domain,
- image source,
- font source,
- inline script/style,
- nonce/hash,
- third-party analytics,
- SSO provider,
- report endpoint.

Contoh lebih realistis tapi tetap harus disesuaikan:

```nginx
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://api.example.com wss://app.example.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'" always;
```

Hati-hati dengan:

```nginx
script-src 'unsafe-inline' 'unsafe-eval'
```

Kadang diperlukan oleh build lama, tetapi secara security melemahkan manfaat CSP.

Strategi rollout CSP:

1. mulai dengan inventory resource,
2. gunakan `Content-Security-Policy-Report-Only`,
3. kumpulkan violation report,
4. perbaiki frontend/build,
5. baru enforce.

Contoh report-only:

```nginx
add_header Content-Security-Policy-Report-Only "default-src 'self'; object-src 'none'; report-uri /csp-report" always;
```

Namun endpoint report harus dirancang agar tidak menjadi spam sink atau logging sensitive payload.

### 5.7 Header `add_header` dan Keyword `always`

Nginx `add_header` punya behavior yang sering mengejutkan: tanpa `always`, header hanya ditambahkan untuk status tertentu.

Gunakan:

```nginx
add_header X-Content-Type-Options "nosniff" always;
```

Untuk security header, biasanya `always` diinginkan agar error response juga memiliki header yang sama.

Namun pahami inheritance:

```nginx
server {
    add_header X-Content-Type-Options "nosniff" always;

    location /api/ {
        add_header X-Frame-Options "DENY" always;
    }
}
```

Di banyak kasus, jika `add_header` didefinisikan di level location, header dari level parent bisa tidak terwariskan seperti yang diasumsikan. Maka lebih aman menggunakan snippet standar dan include secara eksplisit.

Contoh:

```nginx
# snippets/security-headers.conf
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header X-Frame-Options "DENY" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
```

Lalu:

```nginx
server {
    include snippets/security-headers.conf;

    location / {
        proxy_pass http://java_backend;
    }
}
```

Jika location tertentu butuh override, lakukan dengan sadar dan dokumentasikan.

---

## 6. Request Body Size Limit

Directive utama:

```nginx
client_max_body_size 10m;
```

Bisa diletakkan di:

- `http`,
- `server`,
- `location`.

Contoh:

```nginx
http {
    client_max_body_size 1m;

    server {
        server_name app.example.com;

        location /api/ {
            proxy_pass http://java_backend;
        }

        location /api/uploads/ {
            client_max_body_size 50m;
            proxy_pass http://java_backend;
        }
    }
}
```

Prinsip:

> Default kecil, exception eksplisit.

Jangan lakukan ini tanpa alasan:

```nginx
client_max_body_size 0;
```

Itu berarti tidak membatasi ukuran body di Nginx.

Untuk Java app, body terlalu besar bisa berdampak ke:

- memory pressure,
- disk temp usage,
- multipart parsing overhead,
- GC pressure,
- servlet thread lebih lama tertahan,
- upload endpoint menjadi DoS vector.

Nginx bisa menolak lebih awal dengan `413 Request Entity Too Large`, sebelum request mencapai JVM.

### 6.1 Body Size per Endpoint

Sistem yang baik membedakan:

| Endpoint | Limit Contoh | Alasan |
|---|---:|---|
| `/api/auth/login` | 16k | Credential kecil |
| `/api/search` | 64k | Query/filter kecil |
| `/api/cases` POST | 1m | JSON domain payload |
| `/api/uploads/evidence` | 50m atau lebih | File upload terkontrol |
| `/api/import/bulk` | 100m+ | Hanya internal/admin |

Contoh:

```nginx
server {
    client_max_body_size 1m;

    location = /api/auth/login {
        client_max_body_size 16k;
        proxy_pass http://java_backend;
    }

    location /api/uploads/ {
        client_max_body_size 50m;
        proxy_pass http://java_backend;
    }
}
```

### 6.2 Align dengan Java App

Nginx limit harus selaras dengan Java framework config.

Misalnya di Spring Boot:

```properties
spring.servlet.multipart.max-file-size=50MB
spring.servlet.multipart.max-request-size=50MB
server.tomcat.max-http-form-post-size=1MB
```

Jika Nginx 10MB tapi app 50MB, user akan gagal di Nginx.
Jika Nginx 100MB tapi app 10MB, request masuk lebih jauh lalu gagal di app.

Keduanya boleh berbeda jika disengaja, tetapi harus jelas.

Rule praktis:

```text
Nginx max <= application max <= business max with validation
```

Atau untuk upload route:

```text
Nginx max == reverse proxy contract
Application max == parser safety
Business max == domain rule
```

---

## 7. Header Size Limits

Header terlalu besar bisa disebabkan oleh:

- cookie membengkak,
- JWT terlalu besar,
- banyak tracking cookies,
- SSO metadata,
- malicious request,
- client/proxy bug.

Directive:

```nginx
client_header_buffer_size 1k;
large_client_header_buffers 4 8k;
```

Contoh:

```nginx
http {
    client_header_buffer_size 1k;
    large_client_header_buffers 4 8k;
}
```

Jika header terlalu besar, client bisa mendapat `400 Bad Request` atau `414 URI Too Large` tergantung kasus.

Untuk aplikasi Java, header besar juga bisa menyebabkan:

- request rejected di Tomcat/Undertow,
- memory overhead,
- inconsistent behavior antara proxy dan app,
- bug hanya muncul di production karena cookie domain berbeda.

### 7.1 Cookie Bloat

Cookie bloat sering terjadi ketika:

- session disimpan client-side,
- JWT besar masuk cookie,
- banyak app di parent domain sama,
- analytics/marketing script menambah cookie,
- SSO menambah state.

Nginx bisa menjadi tempat gejala terlihat dulu:

```text
400 Bad Request
Request Header Or Cookie Too Large
```

Solusi bukan selalu menaikkan buffer.

Pertanyaan yang benar:

- Kenapa cookie sebesar itu?
- Apakah JWT membawa terlalu banyak claim?
- Apakah cookie path/domain terlalu luas?
- Apakah token seharusnya opaque reference, bukan self-contained blob besar?
- Apakah frontend menyimpan state di cookie padahal bisa di storage lain?

---

## 8. Request Buffering, Temp Files, and Disk Exhaustion

Nginx dapat membuffer request body sebelum mengirim ke upstream.

Directive terkait:

```nginx
proxy_request_buffering on;
client_body_buffer_size 128k;
client_body_temp_path /var/cache/nginx/client_temp;
```

Default buffering sering berguna karena upstream Java tidak perlu menghadapi slow upload client secara langsung.

Tetapi ada konsekuensi:

- request besar bisa ditulis ke disk temp,
- disk bisa penuh,
- latency upload berubah,
- streaming upload ke app tidak terjadi seperti yang diasumsikan,
- body baru dikirim ke app setelah selesai diterima Nginx.

Untuk upload besar, pastikan:

- temp path punya disk cukup,
- permission benar,
- monitoring disk aktif,
- `client_max_body_size` masuk akal,
- app dan Nginx timeout selaras.

Contoh lokasi upload:

```nginx
location /api/uploads/ {
    client_max_body_size 100m;
    client_body_buffer_size 256k;
    proxy_request_buffering on;
    proxy_pass http://java_backend;
}
```

Untuk streaming tertentu:

```nginx
location /api/stream-upload/ {
    client_max_body_size 100m;
    proxy_request_buffering off;
    proxy_pass http://java_backend;
}
```

Hati-hati: `proxy_request_buffering off` membuat upstream lebih langsung terkena slow client behavior. Ini bisa mengikat thread atau connection lebih lama di aplikasi Java.

Mental model:

```text
buffering on  = Nginx absorbs slow client, app receives more controlled request
buffering off = app participates in client upload timing
```

---

## 9. URI, Path, and Static File Safety

Nginx sering melayani static files sekaligus reverse proxy. Ini rawan jika path mapping salah.

### 9.1 `root` vs `alias` Security Trap

Contoh `root`:

```nginx
location /static/ {
    root /var/www/app;
}
```

Request:

```text
/static/js/app.js
```

File path:

```text
/var/www/app/static/js/app.js
```

Contoh `alias`:

```nginx
location /static/ {
    alias /var/www/app/assets/;
}
```

Request:

```text
/static/js/app.js
```

File path:

```text
/var/www/app/assets/js/app.js
```

Trap umum:

```nginx
location /static/ {
    alias /var/www/app/assets;
}
```

Perhatikan slash akhir. Untuk prefix location dengan `alias`, biasanya gunakan trailing slash yang konsisten.

Lebih aman:

```nginx
location /static/ {
    alias /var/www/app/assets/;
    try_files $uri =404;
}
```

### 9.2 Jangan Serve Project Root

Buruk:

```nginx
root /srv/my-app;
```

Jika direktori itu berisi:

```text
.git/
.env
Dockerfile
application.yml
node_modules/
src/
target/
```

maka risiko exposure meningkat.

Lebih aman:

```nginx
root /srv/my-app/public;
```

atau:

```nginx
root /usr/share/nginx/html;
```

Prinsip:

> Web root should contain only files intended to be public.

Jangan mengandalkan blocklist untuk menyelamatkan web root yang salah.

### 9.3 Disable Directory Listing

Pastikan:

```nginx
autoindex off;
```

Biasanya default off, tetapi tuliskan eksplisit di baseline jika organisasi ingin clarity.

Jangan aktifkan:

```nginx
autoindex on;
```

kecuali memang membangun file listing internal dengan proteksi kuat.

### 9.4 Block Hidden Files

Contoh:

```nginx
location ~ /\. {
    deny all;
}
```

Namun hati-hati dengan `.well-known` untuk ACME/Let’s Encrypt atau standard web metadata.

Lebih baik:

```nginx
location ^~ /.well-known/acme-challenge/ {
    root /var/www/certbot;
    try_files $uri =404;
}

location ~ /\. {
    deny all;
}
```

Atau block spesifik file sensitif:

```nginx
location ~* /(\.git|\.svn|\.hg|\.env|composer\.json|composer\.lock|package-lock\.json|yarn\.lock|Dockerfile|docker-compose\.ya?ml)$ {
    deny all;
}
```

Tetapi lagi-lagi: jangan jadikan blocklist sebagai kompensasi web root yang buruk.

### 9.5 Prevent Source/Config File Exposure

Untuk deployment Java, pastikan Nginx tidak pernah serve:

- `application.yml`,
- `application.properties`,
- `.env`,
- `logback.xml`,
- `pom.xml`,
- `build.gradle`,
- `settings.xml`,
- JAR/WAR internal,
- SQL migration script,
- source code,
- generated reports,
- heap dump,
- thread dump.

Contoh blocklist tambahan:

```nginx
location ~* \.(?:properties|ya?ml|xml|gradle|sql|log|bak|old|orig|swp|dump|hprof)$ {
    deny all;
}
```

Namun untuk static site modern, beberapa `.xml` seperti sitemap bisa valid. Karena itu blocklist global harus diuji terhadap kebutuhan app.

Lebih baik pisahkan:

```text
/app
  /backend
  /frontend-build-public-only
```

Nginx hanya menunjuk ke `frontend-build-public-only`.

---

## 10. `try_files` as Safety Boundary

`try_files` sering dipakai untuk SPA:

```nginx
location / {
    try_files $uri $uri/ /index.html;
}
```

Ini baik untuk frontend route, tapi berbahaya jika API route tidak dipisahkan lebih dulu.

Benar:

```nginx
location /api/ {
    proxy_pass http://java_backend;
}

location / {
    try_files $uri $uri/ /index.html;
}
```

Salah:

```nginx
location / {
    try_files $uri $uri/ /index.html;
}

location ~ /api/.* {
    proxy_pass http://java_backend;
}
```

Karena location precedence bisa mengejutkan jika regex/prefix tidak dirancang.

Untuk static files:

```nginx
location /assets/ {
    root /var/www/app;
    try_files $uri =404;
}
```

Security meaning:

> `try_files` memastikan Nginx hanya serve file yang benar-benar ada dan fallback secara eksplisit.

---

## 11. Method Restrictions

Kadang endpoint static hanya perlu `GET` dan `HEAD`.

Contoh:

```nginx
location /assets/ {
    limit_except GET HEAD {
        deny all;
    }

    root /var/www/app;
    try_files $uri =404;
}
```

Untuk API, jangan asal membatasi method di Nginx jika aplikasi punya method semantics kompleks.

Tetapi untuk route tertentu, ini berguna:

```nginx
location = /healthz {
    limit_except GET {
        deny all;
    }

    access_log off;
    return 200 "ok\n";
}
```

Pertimbangkan apakah response `403` dari `deny all` sesuai. Kadang lebih baik `405 Method Not Allowed`, tapi implementasinya di Nginx tidak selalu sesederhana framework app.

Prinsip:

> Method restriction di Nginx cocok untuk route infrastruktur dan static, bukan menggantikan authorization method-level di aplikasi.

---

## 12. Host Header Hardening

Nginx server selection sudah dibahas di Part 004, tetapi dari sisi security, Host header perlu diperlakukan sebagai input tidak dipercaya.

Jangan meneruskan semua host liar ke backend.

Gunakan explicit `server_name`:

```nginx
server {
    listen 443 ssl http2;
    server_name app.example.com;

    location / {
        proxy_set_header Host $host;
        proxy_pass http://java_backend;
    }
}
```

Tetapi `$host` punya behavior normalisasi/fallback. Jika ingin mempertahankan raw Host, ada `$http_host`; namun ini bisa membawa port atau input yang lebih mentah.

Untuk banyak sistem, lebih aman set host canonical:

```nginx
proxy_set_header Host app.example.com;
```

Trade-off:

| Strategy | Kelebihan | Risiko |
|---|---|---|
| `Host $host` | Mendukung multi-host | Butuh validasi server_name kuat |
| `Host $http_host` | Preserves original | Lebih raw, rawan injection/confusion |
| `Host app.example.com` | Canonical dan stabil | Kurang cocok multi-tenant host-based |

Untuk aplikasi Java yang membangun URL email/callback dari request host, canonical host sering lebih aman.

Jika multi-tenant berbasis host, jangan hanya bergantung Nginx. Aplikasi harus memvalidasi tenant-host mapping.

---

## 13. Forwarded Header Spoofing

Dari Part 008, proxy header adalah kontrak.

Security issue utama:

```text
Client sends: X-Forwarded-For: 1.2.3.4
Nginx appends/forwards blindly
Java app trusts it as real client IP
```

Baseline lebih aman:

```nginx
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host $host;
```

Tetapi jika Nginx berada di belakang trusted LB/CDN, `$remote_addr` adalah LB/CDN IP, bukan real client.

Maka perlu real IP config:

```nginx
set_real_ip_from 10.0.0.0/8;
set_real_ip_from 172.16.0.0/12;
set_real_ip_from 192.168.0.0/16;
real_ip_header X-Forwarded-For;
real_ip_recursive on;
```

Jangan `set_real_ip_from 0.0.0.0/0` kecuali kamu benar-benar ingin semua client dipercaya, yang hampir selalu salah.

Prinsip:

> Only trust forwarded headers from infrastructure you control.

Untuk Java app, pastikan trust boundary sama. Jangan sampai Nginx membersihkan header tapi app masih menerima spoofed header dari path bypass.

---

## 14. Error Page and Information Leakage

Nginx error default bisa memperlihatkan:

- server type,
- status detail,
- upstream failure clue,
- inconsistent branding,
- internal route behavior.

Minimal:

```nginx
server_tokens off;
```

Custom error page:

```nginx
error_page 500 502 503 504 /50x.html;

location = /50x.html {
    root /usr/share/nginx/html;
    internal;
}
```

Untuk API, HTML error page sering buruk. Lebih baik JSON minimal:

```nginx
location /api/ {
    proxy_intercept_errors on;
    error_page 502 503 504 = @api_unavailable;

    proxy_pass http://java_backend;
}

location @api_unavailable {
    internal;
    default_type application/json;
    return 503 '{"error":"service_unavailable"}\n';
}
```

Hati-hati:

- Jangan bocorkan upstream name internal.
- Jangan tampilkan stack trace.
- Jangan return detail exception dari Java app ke public client.
- Jangan ubah semua error menjadi 200 dengan body error.

Untuk regulatory/case management systems, error response juga bagian dari defensibility. Response harus cukup informatif untuk client resmi, tetapi tidak membocorkan internal topology.

---

## 15. Upload Safety

Nginx bisa membantu membatasi upload, tapi bukan tempat final file security.

Di Nginx:

```nginx
location /api/uploads/ {
    client_max_body_size 50m;
    proxy_request_buffering on;
    proxy_pass http://java_backend;
}
```

Tambahan ops:

```nginx
client_body_temp_path /var/cache/nginx/client_temp 1 2;
```

Pertimbangan:

- temp directory jangan satu disk dengan root filesystem kecil,
- monitor disk usage,
- permission minimal,
- cleanup lifecycle jelas,
- upload route rate-limited,
- auth dilakukan di app atau upstream auth layer,
- app tetap validasi MIME, extension, magic bytes, antivirus scanning jika perlu.

Nginx tidak cukup untuk:

- mendeteksi malware,
- memastikan file adalah PDF asli,
- memastikan user berhak upload ke case tertentu,
- memastikan file tidak mengandung exploit dokumen,
- memastikan metadata aman.

Jadi Nginx role:

```text
Bound size + protect app from slow/oversized request + route correctly
```

App role:

```text
Authenticate + authorize + validate content + store safely + audit
```

---

## 16. MIME Type and Download Safety

Pastikan Nginx punya MIME config:

```nginx
include /etc/nginx/mime.types;
default_type application/octet-stream;
```

Untuk file download yang seharusnya tidak dieksekusi browser:

```nginx
location /downloads/ {
    alias /srv/downloads/;
    try_files $uri =404;

    default_type application/octet-stream;
    add_header Content-Disposition "attachment" always;
    add_header X-Content-Type-Options "nosniff" always;
}
```

Hati-hati jika `Content-Disposition` global dipasang untuk semua static assets, karena bisa merusak rendering CSS/JS/image.

Untuk user-uploaded content, jangan serve dari domain yang sama dengan aplikasi utama jika memungkinkan.

Lebih aman:

```text
app.example.com        -> application
files.example.com      -> user-uploaded/download content
static.example.com     -> public static assets
```

Alasannya:

- cookie isolation,
- CSP isolation,
- lower XSS blast radius,
- simpler cache rules,
- clearer access control.

---

## 17. CORS: Jangan Asal Taruh `*`

CORS sudah banyak terkait HTTP/frontend, jadi di sini hanya konsekuensi Nginx security.

Buruk:

```nginx
add_header Access-Control-Allow-Origin "*" always;
add_header Access-Control-Allow-Credentials "true" always;
```

Kombinasi wildcard origin dan credentials tidak valid secara browser semantics, dan menunjukkan desain yang tidak jelas.

Lebih baik whitelist origin eksplisit.

Contoh sederhana:

```nginx
map $http_origin $cors_origin {
    default "";
    "https://app.example.com" $http_origin;
    "https://admin.example.com" $http_origin;
}

server {
    location /api/ {
        if ($cors_origin != "") {
            add_header Access-Control-Allow-Origin $cors_origin always;
            add_header Vary Origin always;
        }

        proxy_pass http://java_backend;
    }
}
```

Namun hati-hati dengan `if` di Nginx. Untuk CORS kompleks, sering lebih baik dikelola aplikasi atau gateway yang memang memahami policy.

Prinsip:

> CORS is not authentication. CORS only controls browser cross-origin access behavior.

Endpoint tetap harus punya authentication dan authorization.

---

## 18. Admin, Actuator, Metrics, and Internal Routes

Spring Boot Actuator, Prometheus metrics, admin endpoints, dan internal callbacks tidak boleh terekspos publik tanpa kontrol.

Contoh proteksi Nginx:

```nginx
location /actuator/ {
    allow 10.0.0.0/8;
    deny all;

    proxy_pass http://java_backend;
}
```

Metrics:

```nginx
location = /actuator/prometheus {
    allow 10.10.0.0/16;
    deny all;

    proxy_pass http://java_backend;
}
```

Atau jangan route sama sekali dari public virtual host:

```nginx
location /actuator/ {
    return 404;
}
```

Lalu expose via internal Nginx/server/network saja.

Pola lebih aman:

```text
Public Nginx server block:
  - no actuator
  - no admin internal

Internal Nginx server block:
  - bound to private interface/VPN
  - IP allowlist
  - strong auth
```

---

## 19. Request Smuggling and Ambiguous Framing Awareness

Request smuggling detail terlalu dalam untuk bagian ini, tetapi penting memahami prinsipnya.

Risiko muncul ketika proxy dan upstream berbeda dalam menafsirkan batas request, khususnya sekitar:

- `Content-Length`,
- `Transfer-Encoding`,
- duplicate headers,
- HTTP/1.1 keepalive,
- malformed requests,
- intermediate proxies.

Hardening umum:

- keep Nginx patched,
- avoid exotic proxy chains,
- do not normalize dangerous ambiguous headers blindly,
- ensure upstream Java container patched,
- prefer clear proxy boundary,
- test with security scanner untuk edge cases,
- do not expose backend directly.

Nginx biasanya cukup robust, tetapi vulnerability class ini bergantung pada chain behavior. Jadi jangan hanya melihat Nginx atau Tomcat sendiri; lihat seluruh path.

```text
Client -> CDN -> LB -> Nginx -> Java container
```

Semua hop harus konsisten.

---

## 20. Config Integrity as Security Control

Banyak organisasi memperlakukan Nginx config sebagai file ops biasa. Ini salah.

Nginx config bisa menentukan:

- traffic ke backend mana,
- header auth mana yang diteruskan,
- apakah endpoint internal terbuka,
- apakah TLS benar,
- apakah rate limit aktif,
- apakah logs berisi token,
- apakah domain asing diterima,
- apakah cache menyimpan data pribadi.

Jadi Nginx config adalah **security-sensitive production code**.

### 20.1 Required Practices

Minimal:

1. config disimpan di Git,
2. perubahan via pull request,
3. review oleh orang yang paham traffic/security,
4. CI menjalankan `nginx -t`,
5. ada environment-specific validation,
6. deploy atomic,
7. reload terkontrol,
8. rollback tersedia,
9. secrets tidak hardcoded,
10. diff effective config bisa diaudit.

### 20.2 Validate Effective Config

Gunakan:

```bash
nginx -t
```

Untuk dump config efektif:

```bash
nginx -T
```

`nginx -T` penting karena include bisa menyembunyikan konfigurasi aktual.

CI example pseudo-step:

```bash
docker run --rm \
  -v "$PWD/nginx.conf:/etc/nginx/nginx.conf:ro" \
  -v "$PWD/conf.d:/etc/nginx/conf.d:ro" \
  nginx:stable \
  nginx -t
```

Jika config butuh cert path/upstream DNS yang tidak ada di CI, buat test harness atau template environment agar validasi tetap bisa berjalan.

### 20.3 Config Drift

Config drift terjadi ketika production berbeda dari Git.

Penyebab:

- emergency SSH edit,
- manual hotfix,
- include file lokal,
- generated config tidak disimpan,
- ConfigMap diedit langsung,
- container image berbeda dari source.

Mitigasi:

- immutable image/config,
- GitOps,
- config checksum,
- audit command history,
- periodic config dump comparison,
- restricted shell access,
- deployment pipeline only.

### 20.4 Secrets in Config

Jangan simpan rahasia langsung di Nginx config:

```nginx
proxy_set_header Authorization "Bearer super-secret-token";
```

Risiko:

- masuk Git,
- muncul di `nginx -T`,
- terbaca oleh operator yang tidak perlu,
- masuk backup,
- masuk incident artifact.

Jika perlu secret untuk upstream auth, gunakan mekanisme secret management yang sesuai environment, dan batasi exposure file.

---

## 21. Minimal Module and Binary Surface

Nginx bisa dikompilasi dengan berbagai module. Semakin banyak module, semakin besar surface area.

Prinsip:

- gunakan package resmi/tepercaya,
- hindari third-party module tanpa review,
- jangan compile custom sembarangan,
- dokumentasikan module yang dipakai,
- patch secara rutin,
- bedakan Nginx OSS, NGINX Plus, ingress controller, dan distro build.

Cek build:

```bash
nginx -V
```

Output menampilkan compile options dan module.

Gunakan untuk inventory:

```bash
nginx -V 2>&1 | tr ' ' '\n' | sort
```

Jangan bocorkan output ini ke publik.

---

## 22. File Permission and Runtime User

Nginx worker sebaiknya tidak berjalan sebagai root.

Umum:

```nginx
user nginx;
```

atau:

```nginx
user www-data;
```

Master process mungkin root untuk bind port privileged dan manage worker, tetapi worker turun privilege.

Checklist permission:

- config readable oleh root/nginx seperlunya,
- private key TLS hanya readable oleh user yang perlu,
- static files read-only untuk Nginx,
- upload temp dir writable jika dibutuhkan,
- cache dir writable jika proxy cache aktif,
- log dir writable,
- web root tidak writable oleh proses app jika tidak perlu,
- Nginx tidak punya akses ke source/secrets yang tidak perlu.

Contoh buruk:

```bash
chmod -R 777 /var/www/app
```

Ini bukan solusi permission; ini menghapus boundary.

Contoh lebih baik:

```bash
chown -R root:nginx /var/www/app/public
chmod -R 750 /var/www/app/public
find /var/www/app/public -type f -exec chmod 640 {} \;
find /var/www/app/public -type d -exec chmod 750 {} \;
```

Sesuaikan dengan distro dan user runtime.

---

## 23. Logging Without Leaking Secrets

Security hardening bukan hanya menolak request; juga memastikan observability tidak membocorkan rahasia.

Jangan log:

- `Authorization`,
- cookies penuh,
- access token,
- refresh token,
- API key,
- password field,
- signed URL lengkap jika mengandung token,
- query string yang mengandung PII.

Default `$request` mencakup path dan query string:

```nginx
log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                '$status $body_bytes_sent "$http_referer" '
                '"$http_user_agent"';
```

Jika URL mengandung token:

```text
/download?token=secret
```

maka token masuk log.

Alternatif: log `$uri` bukan `$request_uri` untuk menghindari query string.

```nginx
log_format safer '$remote_addr [$time_local] '
                 '"$request_method $uri $server_protocol" '
                 '$status $body_bytes_sent '
                 'rt=$request_time '
                 'urt=$upstream_response_time '
                 'rid=$request_id';
```

Namun kehilangan query string bisa mengurangi debugging. Pilihan harus sesuai sensitivity.

Untuk regulatory systems, audit log aplikasi dan access log Nginx punya tujuan berbeda:

- Nginx access log: traffic/security/latency diagnosis.
- Application audit log: actor, action, object, decision, before/after state, legal defensibility.

Jangan campur keduanya.

---

## 24. Safe Baseline Configuration Snippets

### 24.1 `security-headers.conf`

```nginx
# snippets/security-headers.conf
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header X-Frame-Options "DENY" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
```

Production HTTPS only:

```nginx
# snippets/hsts.conf
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
```

### 24.2 `proxy-headers.conf`

```nginx
# snippets/proxy-headers.conf
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host $host;
proxy_set_header X-Forwarded-Port $server_port;
proxy_set_header X-Request-ID $request_id;
```

Jika canonical host:

```nginx
proxy_set_header Host app.example.com;
proxy_set_header X-Forwarded-Host app.example.com;
```

### 24.3 `static-hardening.conf`

```nginx
# snippets/static-hardening.conf
autoindex off;
add_header X-Content-Type-Options "nosniff" always;

location ~ /\. {
    deny all;
}
```

Hati-hati: snippet yang berisi `location` tidak bisa di-include sembarang context. Include harus sesuai grammar Nginx.

---

## 25. Example: Hardened Public Java App Front Door

Contoh ini bukan copy-paste universal, tetapi baseline berpikir.

```nginx
user nginx;
worker_processes auto;

error_log /var/log/nginx/error.log warn;
pid /run/nginx.pid;

events {
    worker_connections 4096;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    server_tokens off;

    client_max_body_size 1m;
    client_header_buffer_size 1k;
    large_client_header_buffers 4 8k;

    log_format app_safe '$remote_addr [$time_local] '
                        '"$request_method $uri $server_protocol" '
                        '$status $body_bytes_sent '
                        'rt=$request_time '
                        'uct=$upstream_connect_time '
                        'uht=$upstream_header_time '
                        'urt=$upstream_response_time '
                        'rid=$request_id';

    access_log /var/log/nginx/access.log app_safe;

    upstream java_backend {
        server 127.0.0.1:8080 max_fails=3 fail_timeout=10s;
        keepalive 32;
    }

    server {
        listen 80 default_server;
        server_name _;
        return 444;
    }

    server {
        listen 80;
        server_name app.example.com;
        return 301 https://$host$request_uri;
    }

    server {
        listen 443 ssl http2 default_server;
        server_name _;

        ssl_certificate     /etc/nginx/certs/default/fullchain.pem;
        ssl_certificate_key /etc/nginx/certs/default/privkey.pem;

        return 444;
    }

    server {
        listen 443 ssl http2;
        server_name app.example.com;

        ssl_certificate     /etc/nginx/certs/app.example.com/fullchain.pem;
        ssl_certificate_key /etc/nginx/certs/app.example.com/privkey.pem;

        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header X-Frame-Options "DENY" always;
        add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;

        error_page 500 502 503 504 /50x.html;

        location = /50x.html {
            root /usr/share/nginx/html;
            internal;
        }

        location = /healthz {
            access_log off;
            limit_except GET {
                deny all;
            }
            return 200 "ok\n";
        }

        location /actuator/ {
            return 404;
        }

        location /assets/ {
            root /var/www/app;
            try_files $uri =404;
            autoindex off;
            expires 1y;
            add_header Cache-Control "public, immutable" always;
            add_header X-Content-Type-Options "nosniff" always;
        }

        location /api/uploads/ {
            client_max_body_size 50m;

            proxy_http_version 1.1;
            proxy_set_header Connection "";
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header X-Forwarded-Host $host;
            proxy_set_header X-Request-ID $request_id;

            proxy_pass http://java_backend;
        }

        location /api/ {
            client_max_body_size 1m;

            proxy_http_version 1.1;
            proxy_set_header Connection "";
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header X-Forwarded-Host $host;
            proxy_set_header X-Request-ID $request_id;

            proxy_intercept_errors on;
            error_page 502 503 504 = @api_unavailable;

            proxy_pass http://java_backend;
        }

        location @api_unavailable {
            internal;
            default_type application/json;
            return 503 '{"error":"service_unavailable"}\n';
        }

        location / {
            root /var/www/app;
            try_files $uri $uri/ /index.html;
        }

        location ~ /\. {
            deny all;
        }
    }
}
```

Hal yang sudah dilakukan:

- unknown host tidak masuk app,
- HTTP redirect ke HTTPS,
- TLS server explicit,
- server token off,
- body/header limit,
- static asset controlled,
- actuator tidak public,
- upload route punya limit khusus,
- API punya proxy header contract,
- basic security headers,
- query string tidak masuk access log format utama,
- 50x error tidak expose upstream detail.

Hal yang belum cukup:

- TLS cipher/protocol belum detail,
- rate limit belum dipasang,
- auth/authorization tetap di app,
- CSP belum customized,
- cache belum ditentukan,
- WAF belum ada,
- real IP dari CDN/LB belum dikonfigurasi,
- security group/firewall belum dibahas,
- monitoring belum lengkap.

---

## 26. Failure Mode: Hardening yang Salah Bisa Merusak Sistem

Security hardening juga punya risiko operational.

### 26.1 HSTS Salah

Gejala:

- browser selalu memaksa HTTPS,
- subdomain internal tidak bisa diakses,
- rollback DNS tidak membantu cepat.

Penyebab:

```nginx
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
```

dipasang sebelum semua subdomain siap.

### 26.2 Body Limit Terlalu Kecil

Gejala:

- upload gagal `413`,
- import gagal,
- mobile app error tanpa pesan jelas.

Solusi:

- per-route limit,
- error body jelas,
- align dengan app config.

### 26.3 Header Limit Terlalu Kecil

Gejala:

- user tertentu gagal login,
- hanya terjadi setelah SSO,
- hanya browser tertentu,
- error `400` dari Nginx sebelum app log muncul.

Penyebab:

- cookie/JWT besar,
- SSO header besar,
- Nginx header buffer terlalu kecil.

Solusi bukan langsung menaikkan buffer; cek cookie/token design.

### 26.4 CSP Terlalu Ketat

Gejala:

- JavaScript tidak jalan,
- font/image hilang,
- API call diblok browser,
- WebSocket gagal.

Strategi:

- report-only dulu,
- inventory source,
- enforce bertahap.

### 26.5 Dotfile Blocking Mengganggu ACME

Gejala:

- certificate renewal gagal,
- path `/.well-known/acme-challenge/...` 403.

Solusi:

- allow `.well-known/acme-challenge` sebelum deny dotfile.

### 26.6 Proxy Headers Salah

Gejala:

- redirect HTTP padahal client HTTPS,
- secure cookie tidak dipasang,
- OAuth callback mismatch,
- audit IP salah,
- rate limit per IP kacau.

Solusi:

- proxy header contract,
- app trust config,
- integration test.

---

## 27. Testing Hardening

### 27.1 Config Test

```bash
nginx -t
```

### 27.2 Effective Config Review

```bash
nginx -T | less
```

Cari:

```bash
nginx -T 2>/dev/null | grep -n "client_max_body_size\|add_header\|server_name\|proxy_set_header"
```

### 27.3 Header Test

```bash
curl -I https://app.example.com/
```

Expected:

```text
Strict-Transport-Security: ...
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
X-Frame-Options: DENY
Permissions-Policy: ...
```

### 27.4 Unknown Host Test

```bash
curl -k -H 'Host: unknown.example.com' https://IP_ADDRESS/
```

Expected:

- closed connection,
- 404,
- or controlled default response,
- **not** Java app response.

### 27.5 Body Limit Test

```bash
dd if=/dev/zero bs=1M count=2 of=/tmp/2mb.bin
curl -i -X POST https://app.example.com/api/test \
  --data-binary @/tmp/2mb.bin
```

Expected jika limit 1m:

```text
413 Request Entity Too Large
```

### 27.6 Dotfile Test

```bash
curl -i https://app.example.com/.env
curl -i https://app.example.com/.git/config
```

Expected:

```text
403 or 404
```

Never application response or file content.

### 27.7 Actuator Test

```bash
curl -i https://app.example.com/actuator/env
curl -i https://app.example.com/actuator/prometheus
```

Expected public side:

```text
404 or 403
```

### 27.8 Header Spoofing Test

```bash
curl -i https://app.example.com/api/whoami \
  -H 'X-Forwarded-For: 1.2.3.4' \
  -H 'X-Forwarded-Proto: http'
```

Expected:

- app should not blindly trust spoofed client-supplied header,
- Nginx should produce controlled forwarded header chain,
- app should be configured to trust only proxy boundary.

---

## 28. Java Application Coordination Checklist

Nginx hardening harus dikontrakkan dengan aplikasi Java.

### 28.1 Spring Boot

Periksa:

```properties
server.forward-headers-strategy=framework
```

atau sesuai versi/framework.

Multipart:

```properties
spring.servlet.multipart.max-file-size=50MB
spring.servlet.multipart.max-request-size=50MB
```

Error:

```properties
server.error.include-stacktrace=never
server.error.include-message=never
```

Actuator:

```properties
management.endpoints.web.exposure.include=health,prometheus
management.endpoint.health.probes.enabled=true
```

Pastikan exposure actuator sesuai network design, bukan hanya property.

### 28.2 Tomcat Header Size

Jika perlu:

```properties
server.max-http-request-header-size=16KB
```

Nama property bisa berbeda antar versi Spring Boot. Validasi terhadap versi yang dipakai.

### 28.3 Secure Cookie

Aplikasi harus aware scheme asli:

- `Secure` cookie untuk HTTPS,
- SameSite policy,
- correct redirect URI,
- absolute URL generation.

Nginx tidak boleh dijadikan satu-satunya sumber kebenaran untuk cookie security jika app menghasilkan cookie sendiri.

### 28.4 Audit IP

Jika audit butuh IP client:

- definisikan trust boundary,
- simpan chain jika perlu,
- jangan percaya raw header dari client,
- bedakan IP network dari user identity,
- audit decision harus berbasis authenticated principal, bukan IP saja.

---

## 29. Production Hardening Checklist

Gunakan checklist ini sebagai baseline review.

### 29.1 Server Selection

- [ ] Ada default server untuk HTTP yang fail closed.
- [ ] Ada default server untuk HTTPS yang fail closed.
- [ ] Semua public domain punya `server_name` eksplisit.
- [ ] Unknown host tidak masuk Java app.
- [ ] Canonical redirect jelas.

### 29.2 TLS and Headers

- [ ] HTTP redirect ke HTTPS.
- [ ] HSTS hanya untuk domain yang siap.
- [ ] `server_tokens off`.
- [ ] `X-Content-Type-Options` aktif.
- [ ] `Referrer-Policy` dipilih sadar.
- [ ] `X-Frame-Options` atau CSP `frame-ancestors` aktif.
- [ ] `Permissions-Policy` sesuai kebutuhan.
- [ ] CSP dirancang, minimal report-only jika belum enforce.

### 29.3 Request Limits

- [ ] `client_max_body_size` default kecil.
- [ ] Upload/import punya exception eksplisit.
- [ ] Header buffers sesuai kebutuhan, tidak asal besar.
- [ ] Nginx limit align dengan Java app limit.
- [ ] Temp body/cache disk dimonitor.

### 29.4 Static File Safety

- [ ] Web root hanya berisi public files.
- [ ] `autoindex off`.
- [ ] Dotfiles blocked.
- [ ] `.well-known/acme-challenge` tetap berfungsi jika dipakai.
- [ ] `try_files` digunakan untuk static route.
- [ ] `root`/`alias` dicek path mapping-nya.
- [ ] Source/config/secrets tidak berada di web root.

### 29.5 Internal Endpoint Protection

- [ ] `/actuator` tidak public.
- [ ] `/metrics` tidak public.
- [ ] admin/internal endpoints punya network/auth protection.
- [ ] health endpoint minimal dan tidak bocor detail.

### 29.6 Proxy Contract

- [ ] `Host` strategy jelas.
- [ ] `X-Forwarded-*` strategy jelas.
- [ ] Real IP hanya trust trusted proxy.
- [ ] Java app configured for forwarded headers.
- [ ] Header spoofing test dilakukan.

### 29.7 Error and Logging

- [ ] Custom 50x page tidak bocor internal detail.
- [ ] API error dari Nginx berbentuk konsisten.
- [ ] Access log tidak menyimpan token/query sensitif.
- [ ] Error log level sesuai production.
- [ ] Request ID/correlation ID tersedia.

### 29.8 Config Integrity

- [ ] Config di Git.
- [ ] PR review.
- [ ] `nginx -t` di CI.
- [ ] Effective config bisa diaudit.
- [ ] Secrets tidak hardcoded.
- [ ] Deploy/reload atomic.
- [ ] Rollback tersedia.
- [ ] Drift detection ada.

---

## 30. Common Anti-Patterns

### Anti-pattern 1: “Security header copy-paste”

```nginx
add_header Content-Security-Policy "default-src 'self'";
```

Dipasang tanpa tahu efeknya.

Masalah:

- bisa merusak frontend,
- tidak apply ke error response tanpa `always`,
- tidak mencakup `frame-ancestors`,
- tidak diuji.

Cara benar:

- pilih policy sesuai app,
- test report-only,
- enforce bertahap.

### Anti-pattern 2: “client_max_body_size 0 biar upload jalan”

Ini membuka resource exhaustion risk.

Cara benar:

- limit per endpoint,
- app validation,
- upload service/object storage jika perlu.

### Anti-pattern 3: “Serve dari project root”

```nginx
root /srv/app;
```

Cara benar:

```nginx
root /srv/app/public;
```

### Anti-pattern 4: “Trust semua forwarded header”

```nginx
set_real_ip_from 0.0.0.0/0;
```

Cara benar:

- trust hanya LB/CDN/internal proxy IP,
- app tidak bisa diakses bypass.

### Anti-pattern 5: “Nginx sebagai authorization engine domain”

Nginx bisa block path, tapi tidak tahu user boleh melihat case tertentu.

Cara benar:

- Nginx coarse-grained protection,
- app fine-grained authorization,
- audit decision di app.

### Anti-pattern 6: “Emergency edit langsung di server”

Masalah:

- config drift,
- tidak review,
- tidak rollback,
- tidak reproducible.

Cara benar:

- emergency path tetap menghasilkan commit,
- post-incident reconciliation,
- config drift detection.

---

## 31. Mental Model Final

Nginx security hardening bisa diringkas menjadi lima pertanyaan:

### 31.1 Apakah request ini datang ke host yang benar?

Jika tidak, jangan teruskan ke app.

### 31.2 Apakah bentuk request ini masuk akal?

Ukuran body, ukuran header, method, path, dan route harus bounded.

### 31.3 Apakah path ini boleh membaca resource publik?

Static file serving harus strict, public-only, dan tidak bergantung pada keberuntungan.

### 31.4 Apakah response memberi browser policy yang aman?

Security headers harus konsisten, tested, dan sesuai aplikasi.

### 31.5 Apakah konfigurasi ini bisa dipercaya dan diaudit?

Config harus diperlakukan sebagai production security code.

Jika satu kalimat:

> Nginx hardening bukan membuat aplikasi menjadi aman secara ajaib; Nginx hardening membuat edge boundary lebih sempit, lebih eksplisit, lebih sulit disalahgunakan, dan lebih mudah dioperasikan saat terjadi failure atau attack.

---

## 32. Latihan Praktis

### Latihan 1 — Harden Static SPA + API

Buat server block untuk:

- `app.example.com`,
- redirect HTTP ke HTTPS,
- serve SPA dari `/var/www/app`,
- proxy `/api/` ke `127.0.0.1:8080`,
- block dotfiles,
- unknown host fail closed,
- security headers minimal,
- body limit default 1MB,
- upload route 50MB.

Evaluasi:

- Apakah `/api/users` masuk backend?
- Apakah `/dashboard/settings` fallback ke `index.html`?
- Apakah `/.env` blocked?
- Apakah `/api/uploads/file` menerima >1MB?
- Apakah unknown host tidak masuk backend?

### Latihan 2 — Header Spoofing

Buat endpoint Java `/debug/request-context` di staging yang mengembalikan:

- remote address,
- scheme,
- host,
- forwarded headers,
- generated base URL.

Kirim request spoofed:

```bash
curl -H 'X-Forwarded-Proto: http' \
     -H 'X-Forwarded-For: 1.2.3.4' \
     https://staging.example.com/debug/request-context
```

Pastikan app tidak tertipu.

### Latihan 3 — Body Limit Matrix

Buat matrix:

| Route | Nginx Limit | Java Limit | Business Limit | Expected Failure |
|---|---:|---:|---:|---|
| `/api/auth/login` | 16KB | 32KB | credential only | 413/400 |
| `/api/cases` | 1MB | 2MB | JSON case payload | 413/app validation |
| `/api/uploads` | 50MB | 50MB | allowed evidence size | 413/domain error |

Tujuannya bukan hanya angka, tetapi alignment antar boundary.

### Latihan 4 — Config Integrity Review

Ambil config Nginx production/staging dan jawab:

- Apakah semua include terlihat?
- Apakah ada secret di config?
- Apakah `nginx -T` aman disimpan sebagai artifact internal?
- Apakah default server fail closed?
- Apakah ada route internal public?
- Apakah ada location regex yang terlalu luas?
- Apakah ada `client_max_body_size 0`?
- Apakah ada `add_header` tanpa `always` untuk security header?

---

## 33. Ringkasan

Di bagian ini kita membahas Nginx security hardening sebagai boundary engineering, bukan kumpulan snippet.

Poin utama:

- Nginx cocok untuk protocol/route/resource boundary.
- Authorization domain tetap tugas aplikasi Java.
- Unknown host harus fail closed.
- Security headers harus dipilih, diuji, dan tidak asal copy-paste.
- Body/header limits adalah protection terhadap resource exhaustion.
- Static file serving harus public-only, strict, dan tidak mengekspos project root.
- `root`, `alias`, `try_files`, dan location precedence punya dampak security.
- Forwarded headers hanya boleh dipercaya dari proxy yang dikontrol.
- Error response dan logs tidak boleh membocorkan internal detail atau secrets.
- Config Nginx adalah production security code dan harus dikelola seperti source code.

Part berikutnya akan masuk ke observability: bagaimana membaca access log/error log, membuat log format yang berguna, membawa request ID, menghubungkan Nginx timing dengan latency aplikasi Java, dan menggunakan log untuk diagnosis production.

---

## 34. Status Akhir Part

- Part ini selesai: **Part 018 — Security Hardening: Headers, Request Limits, Path Safety, and Config Integrity**
- Seri belum selesai.
- Progress: **018 / 030**
- Lanjut ke: **Part 019 — Observability: Access Logs, Error Logs, Correlation IDs, and Metrics**


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-nginx-mastery-for-java-engineers-part-017.md">⬅️ Part 017 — Access Control, Basic Auth, IP Rules, and Internal Endpoints</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-nginx-mastery-for-java-engineers-part-019.md">Part 019 — Observability: Access Logs, Error Logs, Correlation IDs, and Metrics ➡️</a>
</div>
