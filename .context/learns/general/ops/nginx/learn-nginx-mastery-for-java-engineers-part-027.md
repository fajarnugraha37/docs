# learn-nginx-mastery-for-java-engineers-part-027.md

# Part 027 — Config Design Patterns for Large Systems

## Status Seri

- Seri: `learn-nginx-mastery-for-java-engineers`
- Part: `027` dari `030`
- Status seri: **belum selesai**
- Part sebelumnya: `026 — Stream Module: TCP/UDP Proxying for Non-HTTP Traffic`
- Part berikutnya: `028 — Production Failure Modeling and Incident Playbooks`

---

## Tujuan Part Ini

Di part sebelumnya, kita sudah membahas banyak kemampuan Nginx secara fungsional: reverse proxy, load balancing, timeout, TLS, cache, rate limiting, observability, Kubernetes, sampai `stream` module. Namun di sistem besar, masalah Nginx jarang hanya berupa “tidak tahu directive”. Masalah yang lebih mahal biasanya muncul karena konfigurasi menjadi:

- sulit dibaca,
- sulit diuji,
- mudah saling override,
- tidak jelas ownership-nya,
- tidak jelas kontrak antar service,
- sulit di-rollback,
- rawan copy-paste,
- memiliki default behavior tersembunyi,
- dan perubahan kecil punya blast radius besar.

Part ini membahas **design pattern konfigurasi Nginx untuk sistem besar**. Fokusnya bukan syntax per directive, tetapi bagaimana menyusun konfigurasi sebagai artefak engineering yang bisa dipelihara seperti source code production.

Setelah menyelesaikan part ini, kamu diharapkan mampu:

1. Mendesain struktur konfigurasi Nginx yang modular dan mudah ditinjau.
2. Memisahkan global policy, domain policy, service policy, dan environment-specific override.
3. Menghindari konfigurasi spaghetti akibat `include` yang tidak terkendali.
4. Membuat naming convention yang eksplisit dan konsisten.
5. Menentukan mana yang layak dijadikan snippet dan mana yang harus tetap local.
6. Menyusun pipeline validasi Nginx config di CI/CD.
7. Mengurangi risiko perubahan konfigurasi melalui review checklist dan blast radius control.
8. Membangun mental model Nginx config sebagai **runtime contract**, bukan file operasional biasa.

---

# 1. Masalah Utama: Nginx Config Itu Code, Tapi Sering Tidak Diperlakukan Seperti Code

Banyak tim memperlakukan konfigurasi Nginx sebagai file server ops biasa:

```nginx
server {
    listen 443 ssl;
    server_name api.example.com;

    location / {
        proxy_pass http://backend;
    }
}
```

Awalnya sederhana. Lalu bertambah:

- domain baru,
- frontend SPA baru,
- backend service baru,
- health endpoint,
- WebSocket,
- admin endpoint,
- static assets,
- cache,
- CORS,
- rate limit,
- canary,
- legacy path,
- redirect lama,
- auth subrequest,
- monitoring endpoint,
- vendor callback,
- tenant-specific routing,
- temporary incident mitigation.

Dalam beberapa bulan, file yang tadinya kecil bisa menjadi ribuan baris. Masalahnya bukan hanya panjang. Masalah sebenarnya adalah **hilangnya struktur keputusan**.

Konfigurasi mulai menjawab banyak pertanyaan sekaligus:

- Domain mana yang dilayani?
- Service mana pemilik path tertentu?
- Header apa yang dianggap trusted?
- Timeout mana yang dipakai?
- Endpoint mana yang publik?
- Endpoint mana yang internal?
- Apa default security policy?
- Apa perbedaan staging dan production?
- Siapa yang boleh mengubah rule ini?
- Apa efek perubahan rule ini ke service lain?

Jika semua jawaban tersebar dalam file tanpa struktur, Nginx config menjadi sistem yang sulit diprediksi.

## 1.1 Core Problem

Nginx config bukan hanya konfigurasi. Ia adalah kombinasi dari:

- routing table,
- security boundary,
- traffic policy,
- deployment switch,
- observability emitter,
- resilience layer,
- compatibility shim,
- dan operational control plane kecil.

Karena itu, ia perlu diperlakukan sebagai **production source code**.

---

# 2. Mental Model: Config as Executable Traffic Policy

Cara berpikir yang tepat:

> Nginx config adalah program deklaratif yang dieksekusi terhadap setiap connection dan request.

Ia menentukan:

1. request masuk ke server block mana,
2. location mana yang dipilih,
3. apakah request ditolak,
4. apakah request diubah,
5. apakah request diteruskan,
6. header apa yang ditambah/dihapus,
7. timeout apa yang berlaku,
8. apakah response di-buffer,
9. apakah response di-cache,
10. log apa yang dihasilkan.

Maka desain konfigurasi harus menjawab tiga hal:

```text
Who owns this decision?
Where is this decision defined?
How can we prove the decision still behaves correctly after change?
```

Dalam sistem besar, masalah bukan hanya “Nginx bisa melakukan X”, tetapi:

```text
Can we safely operate X for years across many domains, services, teams, and incidents?
```

---

# 3. Prinsip Desain Konfigurasi Besar

## 3.1 Principle 1 — Separate Policy Levels

Jangan campur semua policy dalam satu tempat.

Pisahkan menjadi beberapa level:

| Level | Contoh | Karakter |
|---|---|---|
| Global runtime policy | worker, logs, gzip, default TLS | berlaku luas |
| Edge security policy | deny unknown host, request limits | boundary protection |
| Domain/server policy | `api.example.com`, `app.example.com` | host-specific |
| Service routing policy | `/api/orders`, `/api/users` | service-specific |
| Endpoint exception | `/api/orders/export` timeout lebih panjang | narrow override |
| Environment overlay | staging upstream berbeda | env-specific |

Semakin tinggi level policy, semakin jarang berubah. Semakin rendah level policy, semakin spesifik dan semakin harus dibatasi blast radius-nya.

## 3.2 Principle 2 — Make Defaults Explicit

Default implisit berbahaya karena pembaca tidak tahu apakah behavior itu disengaja.

Buruk:

```nginx
server {
    listen 80;
    server_name api.example.com;

    location / {
        proxy_pass http://api_backend;
    }
}
```

Lebih baik:

```nginx
server {
    listen 80;
    server_name api.example.com;

    return 301 https://$host$request_uri;
}
```

Atau untuk HTTPS:

```nginx
server {
    listen 443 ssl http2;
    server_name api.example.com;

    include snippets/tls-modern.conf;
    include snippets/security-headers-api.conf;
    include snippets/proxy-common.conf;

    location / {
        proxy_pass http://api_backend;
    }
}
```

Default eksplisit membuat reviewer bisa memahami intent tanpa menebak.

## 3.3 Principle 3 — Minimize Global Magic

Global directive mudah dipakai, tetapi bisa membuat efek tersembunyi.

Contoh:

```nginx
http {
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 300s;

    include conf.d/*.conf;
}
```

Semua service sekarang mewarisi timeout 300 detik. Mungkin cocok untuk export endpoint, tetapi buruk untuk login, checkout, dan API umum.

Lebih aman:

- global hanya berisi default conservative,
- service/endpoint override harus eksplisit,
- timeout panjang diberi nama dan komentar.

## 3.4 Principle 4 — Prefer Local Clarity Over Excessive DRY

DRY penting, tetapi konfigurasi Nginx terlalu “abstrak” bisa lebih berbahaya.

Buruk:

```nginx
include generated/proxy-service-template.conf;
```

Jika pembaca tidak tahu isi template, ia tidak tahu:

- header apa dikirim,
- timeout apa berlaku,
- buffering aktif atau tidak,
- retry aktif atau tidak,
- request body limit berapa.

Lebih baik menggunakan snippet kecil yang jelas:

```nginx
include snippets/proxy-headers-standard.conf;
include snippets/proxy-timeouts-api-default.conf;
include snippets/proxy-buffering-default.conf;
```

DRY yang baik menghilangkan duplikasi mekanis tanpa menyembunyikan keputusan penting.

## 3.5 Principle 5 — One Decision, One Home

Setiap jenis keputusan harus punya rumah yang jelas.

Contoh:

| Keputusan | Rumah yang disarankan |
|---|---|
| TLS baseline | `snippets/tls-modern.conf` |
| Proxy headers | `snippets/proxy-headers-standard.conf` |
| Upstream definition | `upstreams/<service>.conf` |
| Domain routing | `servers/<domain>.conf` |
| Rate limit zones | `policy/rate-limit-zones.conf` |
| Per-endpoint limit | di `location` terkait |
| Access log format | `logging/log-formats.conf` |
| Security headers | `snippets/security-headers-*.conf` |

Jika satu keputusan muncul di banyak tempat, pertanyaan review menjadi sulit:

```text
Which one is authoritative?
Which one wins?
Which one is accidental legacy?
```

---

# 4. Struktur Direktori yang Direkomendasikan

Tidak ada satu layout universal. Namun untuk sistem menengah-besar, layout berikut cukup sehat:

```text
/etc/nginx/
├── nginx.conf
├── mime.types
├── modules-enabled/
│   └── *.conf
├── conf.d/
│   └── entrypoint.conf
├── policy/
│   ├── logging.conf
│   ├── rate-limit-zones.conf
│   ├── maps.conf
│   ├── gzip.conf
│   ├── cache-zones.conf
│   └── real-ip.conf
├── upstreams/
│   ├── orders-api.conf
│   ├── users-api.conf
│   ├── payment-api.conf
│   └── frontend-web.conf
├── snippets/
│   ├── proxy-headers-standard.conf
│   ├── proxy-timeouts-api-default.conf
│   ├── proxy-timeouts-streaming.conf
│   ├── proxy-buffering-default.conf
│   ├── proxy-buffering-off.conf
│   ├── tls-modern.conf
│   ├── security-headers-api.conf
│   ├── security-headers-web.conf
│   ├── deny-dotfiles.conf
│   └── internal-only.conf
├── servers/
│   ├── 00-catch-all-http.conf
│   ├── 00-catch-all-https.conf
│   ├── api.example.com.conf
│   ├── app.example.com.conf
│   ├── admin.example.com.conf
│   └── callbacks.example.com.conf
├── locations/
│   ├── api-orders.locations.conf
│   ├── api-users.locations.conf
│   └── app-static.locations.conf
└── generated/
    └── README.md
```

## 4.1 `nginx.conf` Harus Minimal

Contoh:

```nginx
user nginx;
worker_processes auto;
pid /run/nginx.pid;

events {
    worker_connections 4096;
}

http {
    include       mime.types;
    default_type  application/octet-stream;

    include policy/logging.conf;
    include policy/maps.conf;
    include policy/real-ip.conf;
    include policy/gzip.conf;
    include policy/rate-limit-zones.conf;
    include policy/cache-zones.conf;

    include upstreams/*.conf;
    include servers/*.conf;
}
```

`nginx.conf` berperan sebagai root composition, bukan tempat menaruh semua detail.

## 4.2 Hindari Include yang Terlalu Bebas

Buruk:

```nginx
include **/*.conf;
```

Atau:

```nginx
include */*.conf;
```

Masalah:

- urutan include sulit diprediksi,
- config bisa masuk ke context yang salah,
- file eksperimen bisa ikut ke production,
- reviewer sulit tahu dependency antar file.

Lebih baik:

```nginx
include policy/*.conf;
include upstreams/*.conf;
include servers/*.conf;
```

Namun tetap hati-hati: wildcard biasanya diurutkan alfabetis. Gunakan prefix numerik jika urutan penting.

Contoh:

```text
servers/
├── 00-catch-all-http.conf
├── 00-catch-all-https.conf
├── 10-api.example.com.conf
├── 20-app.example.com.conf
└── 90-admin.example.com.conf
```

---

# 5. Naming Convention

Naming convention bukan kosmetik. Ia membantu reviewer menemukan intent dan scope.

## 5.1 Nama Upstream

Gunakan nama yang menyatakan service dan environment/logical role.

Baik:

```nginx
upstream orders_api {
    server orders-api-1.internal:8080;
    server orders-api-2.internal:8080;
    keepalive 64;
}
```

Kurang baik:

```nginx
upstream backend {
    server 10.0.1.10:8080;
}
```

`backend` tidak menjelaskan ownership.

## 5.2 Nama File Server

Gunakan domain sebagai nama file:

```text
servers/api.example.com.conf
servers/app.example.com.conf
servers/admin.example.com.conf
```

Jika ada banyak environment:

```text
servers/prod/api.example.com.conf
servers/staging/api.staging.example.com.conf
```

Atau jika config dirender dari template:

```text
templates/server-api.conf.tpl
environments/prod/values.yaml
environments/staging/values.yaml
```

## 5.3 Nama Snippet

Snippet harus menjawab: “ini dipakai untuk apa?”

Baik:

```text
proxy-headers-standard.conf
proxy-timeouts-api-default.conf
proxy-timeouts-long-export.conf
proxy-buffering-off-streaming.conf
security-headers-web.conf
security-headers-api.conf
```

Buruk:

```text
common.conf
defaults.conf
proxy.conf
headers.conf
misc.conf
```

Nama generik membuat isi file menjadi kejutan.

---

# 6. Snippet Design Pattern

Snippet berguna untuk policy yang digunakan ulang. Namun snippet juga bisa menjadi sumber bug jika terlalu besar.

## 6.1 Snippet yang Baik

Snippet yang baik punya karakter:

- kecil,
- satu tujuan,
- context jelas,
- tidak punya efek tersembunyi,
- nama eksplisit,
- tidak mengandung `location` kecuali memang khusus,
- tidak mengandung `proxy_pass` kecuali snippet itu memang route final.

Contoh:

```nginx
# snippets/proxy-headers-standard.conf
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host $host;
proxy_set_header X-Forwarded-Port $server_port;
proxy_set_header X-Request-ID $request_id;
```

Contoh timeout default API:

```nginx
# snippets/proxy-timeouts-api-default.conf
proxy_connect_timeout 3s;
proxy_send_timeout 30s;
proxy_read_timeout 30s;
send_timeout 30s;
```

Contoh timeout export:

```nginx
# snippets/proxy-timeouts-long-export.conf
# Only for explicitly approved long-running export/download endpoints.
proxy_connect_timeout 3s;
proxy_send_timeout 60s;
proxy_read_timeout 300s;
send_timeout 300s;
```

Komentar di snippet timeout panjang sangat penting karena timeout panjang sering menjadi kompensasi untuk desain backend yang lambat.

## 6.2 Snippet yang Berbahaya

```nginx
# snippets/common.conf
proxy_set_header Host $host;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_read_timeout 300s;
client_max_body_size 200m;
proxy_buffering off;
add_header Access-Control-Allow-Origin *;
```

Ini berbahaya karena mencampur:

- proxy header,
- timeout,
- upload size,
- buffering,
- CORS.

Akibatnya, setiap service yang butuh header standard juga tanpa sadar mendapat:

- timeout panjang,
- upload besar,
- buffering off,
- CORS wildcard.

Ini bukan reuse. Ini penyebaran policy tanpa kontrol.

## 6.3 Snippet Context Harus Jelas

Tambahkan komentar di atas snippet:

```nginx
# Context: valid inside location blocks that proxy to HTTP upstreams.
# Purpose: standard proxy headers for internal Java services.
```

Atau:

```nginx
# Context: valid inside server block.
# Purpose: baseline security response headers for browser-facing web apps.
```

Nginx tidak punya type system untuk context config. Komentar dan struktur file membantu menggantikannya.

---

# 7. Pattern: Explicit Server Blocks

Dalam sistem besar, setiap `server` block harus bisa dibaca sebagai dokumen boundary.

Contoh:

```nginx
server {
    listen 443 ssl http2;
    server_name api.example.com;

    include snippets/tls-modern.conf;
    include snippets/security-headers-api.conf;

    access_log /var/log/nginx/api.example.com.access.log main_json;
    error_log  /var/log/nginx/api.example.com.error.log warn;

    client_max_body_size 10m;

    include locations/api-orders.locations.conf;
    include locations/api-users.locations.conf;

    location /healthz {
        access_log off;
        return 200 "ok\n";
    }

    location / {
        return 404;
    }
}
```

Perhatikan beberapa hal:

1. Domain eksplisit.
2. TLS eksplisit.
3. Security headers eksplisit.
4. Log per domain.
5. Body size eksplisit.
6. Service routes dipisah.
7. Fallback `/` tidak meneruskan ke backend secara liar.

## 7.1 Kenapa Fallback `/` Penting

Jika fallback kamu seperti ini:

```nginx
location / {
    proxy_pass http://legacy_backend;
}
```

Maka path typo, forgotten route, dan unknown endpoint semua masuk ke backend legacy. Ini menyulitkan debugging dan bisa membuka surface area yang tidak sengaja.

Lebih aman:

```nginx
location / {
    return 404;
}
```

Atau untuk SPA:

```nginx
location / {
    try_files $uri $uri/ /index.html;
}
```

Fallback harus merepresentasikan intent domain tersebut.

---

# 8. Pattern: Domain-Oriented vs Service-Oriented Config

Ada dua cara umum menyusun config.

## 8.1 Domain-Oriented

Struktur:

```text
servers/api.example.com.conf
servers/app.example.com.conf
servers/admin.example.com.conf
```

Cocok jika:

- boundary utama adalah domain,
- tiap domain punya security/logging/routing berbeda,
- traffic ownership berbasis hostname,
- tim platform mengontrol edge config.

Kelebihan:

- mudah menjawab “domain ini melayani apa?”
- TLS/security/logging terlihat di satu tempat,
- cocok untuk review domain-level.

Kekurangan:

- service yang muncul di banyak domain bisa tersebar,
- reuse route perlu include file.

## 8.2 Service-Oriented

Struktur:

```text
services/orders-api/nginx.locations.conf
services/users-api/nginx.locations.conf
services/payment-api/nginx.locations.conf
```

Lalu domain memasukkan service route:

```nginx
server {
    server_name api.example.com;

    include services/orders-api/nginx.locations.conf;
    include services/users-api/nginx.locations.conf;
}
```

Cocok jika:

- banyak service owner,
- setiap tim service mengelola routing-nya sendiri,
- monorepo/platform repo mendukung ownership jelas.

Kelebihan:

- ownership service jelas,
- perubahan service tidak menyentuh seluruh domain file,
- bagus untuk review per team.

Kekurangan:

- domain behavior tersebar,
- collision antar route harus dijaga,
- perlu aturan precedence ketat.

## 8.3 Hybrid Pattern

Biasanya paling realistis:

- server/domain file dimiliki platform,
- location fragment dimiliki service team,
- snippet global dimiliki platform/security,
- upstream bisa dimiliki platform atau service team tergantung deployment model.

Contoh:

```text
servers/api.example.com.conf
services/orders/nginx/locations.conf
services/users/nginx/locations.conf
platform/snippets/proxy-headers-standard.conf
platform/policy/rate-limit-zones.conf
```

---

# 9. Route Ownership dan Collision Control

Nginx route collision bisa sangat subtle.

Contoh:

```nginx
location /api/order {
    proxy_pass http://orders_api;
}

location /api/orders/internal {
    proxy_pass http://orders_internal;
}
```

Path `/api/orders/internal` mungkin tidak match seperti yang kamu kira jika prefix tidak konsisten. Selain itu, regex location bisa override prefix tertentu.

## 9.1 Route Registry

Untuk sistem besar, gunakan route registry sederhana.

Contoh tabel:

| Domain | Path Prefix | Owner | Upstream | Public/Internal | Notes |
|---|---|---|---|---|---|
| `api.example.com` | `/api/orders/` | Orders Team | `orders_api` | Public | default API timeout |
| `api.example.com` | `/api/orders/export/` | Orders Team | `orders_api` | Public | long timeout, rate limited |
| `api.example.com` | `/api/users/` | Identity Team | `users_api` | Public | stricter rate limit |
| `admin.example.com` | `/actuator/` | Platform | `admin_gateway` | Internal | IP allowlist |

Registry ini bisa berupa:

- markdown,
- YAML,
- generated docs,
- CI-validated manifest,
- atau bagian dari platform repo.

## 9.2 Prefix Harus Canonical

Gunakan trailing slash secara konsisten.

Baik:

```nginx
location /api/orders/ {
    proxy_pass http://orders_api/;
}
```

Kurang jelas:

```nginx
location /api/order {
    proxy_pass http://orders_api;
}
```

Kenapa?

`/api/order` juga match:

```text
/api/order
/api/orders
/api/orderXYZ
```

Jika maksudnya namespace, gunakan slash:

```nginx
location /api/orders/ {
    proxy_pass http://orders_api;
}
```

Jika butuh exact endpoint:

```nginx
location = /api/orders {
    return 301 /api/orders/;
}
```

## 9.3 Collision Review Checklist

Untuk setiap route baru:

- Apakah prefix bertabrakan dengan prefix existing?
- Apakah ada regex location yang bisa mengambil request lebih dulu?
- Apakah fallback `/` memproses request ini?
- Apakah path tanpa trailing slash ditangani?
- Apakah route public atau internal?
- Apakah route punya body size berbeda?
- Apakah route punya timeout berbeda?
- Apakah route punya rate limit berbeda?

---

# 10. Pattern: Policy Snippets by Intent

Jangan buat snippet berdasarkan directive. Buat berdasarkan intent.

## 10.1 Proxy Header Policy

```nginx
# snippets/proxy-headers-standard.conf
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host $host;
proxy_set_header X-Forwarded-Port $server_port;
proxy_set_header X-Request-ID $request_id;
```

## 10.2 API Timeout Policy

```nginx
# snippets/proxy-timeouts-api-default.conf
proxy_connect_timeout 3s;
proxy_send_timeout 30s;
proxy_read_timeout 30s;
send_timeout 30s;
```

## 10.3 Streaming Timeout Policy

```nginx
# snippets/proxy-timeouts-streaming.conf
proxy_connect_timeout 3s;
proxy_send_timeout 60s;
proxy_read_timeout 1h;
send_timeout 1h;
```

## 10.4 Buffering Policy

```nginx
# snippets/proxy-buffering-default.conf
proxy_request_buffering on;
proxy_buffering on;
```

```nginx
# snippets/proxy-buffering-off-streaming.conf
proxy_request_buffering off;
proxy_buffering off;
```

## 10.5 Security Headers by Surface

Browser-facing web app:

```nginx
# snippets/security-headers-web.conf
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;
```

API response:

```nginx
# snippets/security-headers-api.conf
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "no-referrer" always;
```

Jangan paksakan CSP generik untuk semua API dan frontend. CSP biasanya sangat tergantung aplikasi.

---

# 11. Pattern: Environment Overlays

Masalah umum:

```nginx
upstream orders_api {
    server localhost:8080;
}
```

Lalu di staging:

```nginx
upstream orders_api {
    server orders-api.staging.svc.cluster.local:8080;
}
```

Lalu di production:

```nginx
upstream orders_api {
    server orders-api.prod.svc.cluster.local:8080;
}
```

Jika environment di-copy manual, drift akan terjadi.

## 11.1 What Should Differ by Environment?

Yang wajar berbeda:

- upstream host,
- certificate path,
- domain name,
- logging destination,
- cache size,
- rate limit threshold,
- feature/canary routing,
- debug endpoint availability.

Yang seharusnya sama:

- proxy header contract,
- security baseline,
- route semantics,
- timeout default kecuali ada alasan,
- body size default,
- fallback behavior,
- observability fields.

## 11.2 Template + Values Pattern

Template:

```nginx
upstream orders_api {
{{ range .orders_api.servers }}
    server {{ .host }}:{{ .port }} max_fails=3 fail_timeout=10s;
{{ end }}
    keepalive {{ .orders_api.keepalive }};
}
```

Values production:

```yaml
orders_api:
  keepalive: 128
  servers:
    - host: orders-api-1.prod.internal
      port: 8080
    - host: orders-api-2.prod.internal
      port: 8080
```

Values staging:

```yaml
orders_api:
  keepalive: 16
  servers:
    - host: orders-api.staging.internal
      port: 8080
```

## 11.3 Rendered Config Must Be Inspectable

Jangan hanya menyimpan template. Selalu simpan atau expose rendered config dalam pipeline artifact.

Gunakan:

```bash
nginx -T
```

untuk melihat effective config setelah include dan template render.

CI/CD harus membuat reviewer bisa menjawab:

```text
What exact config will production run?
```

---

# 12. Pattern: Catch-All Server untuk Unknown Host

Sistem besar harus eksplisit menangani host yang tidak dikenal.

HTTP:

```nginx
server {
    listen 80 default_server;
    server_name _;

    return 444;
}
```

HTTPS:

```nginx
server {
    listen 443 ssl default_server;
    server_name _;

    ssl_certificate     /etc/nginx/certs/default.crt;
    ssl_certificate_key /etc/nginx/certs/default.key;

    return 444;
}
```

Atau jika ingin response standar:

```nginx
return 404;
```

## 12.1 Kenapa Ini Penting?

Tanpa catch-all yang eksplisit, request dengan Host asing bisa masuk ke server block pertama yang match listen address. Ini bisa menyebabkan:

- domain tak dikenal melihat aplikasi kamu,
- certificate/SNI mismatch aneh,
- open redirect bug,
- log noise,
- security scanner masuk ke domain utama,
- tenant isolation rusak.

---

# 13. Pattern: Safe Internal Endpoint Exposure

Endpoint internal seperti actuator, metrics, debug, atau admin harus diperlakukan sebagai surface khusus.

Buruk:

```nginx
location /actuator/ {
    proxy_pass http://app;
}
```

Lebih aman:

```nginx
location /actuator/ {
    include snippets/internal-only.conf;
    proxy_pass http://app;
}
```

Snippet:

```nginx
# snippets/internal-only.conf
allow 10.0.0.0/8;
allow 172.16.0.0/12;
allow 192.168.0.0/16;
deny all;
```

Untuk environment public cloud, private IP allowlist saja kadang tidak cukup. Pertimbangkan:

- separate internal domain,
- VPN/private network,
- identity-aware proxy,
- mTLS,
- auth subrequest,
- Kubernetes NetworkPolicy,
- firewall/security group.

Nginx config harus mencerminkan bahwa endpoint tersebut bukan public API.

---

# 14. Pattern: Configuration Comments That Explain Intent, Not Syntax

Komentar buruk:

```nginx
# set proxy read timeout to 300 seconds
proxy_read_timeout 300s;
```

Itu hanya mengulang syntax.

Komentar baik:

```nginx
# Export generation can stream for up to 5 minutes.
# This location is rate-limited separately to avoid tying up upstream threads.
proxy_read_timeout 300s;
```

Komentar harus menjelaskan:

- kenapa berbeda dari default,
- siapa owner-nya,
- kapan bisa dihapus,
- risiko yang diterima,
- kaitan dengan incident atau requirement.

Contoh:

```nginx
# Temporary compatibility route for mobile app versions <= 4.8.
# Owner: Mobile Platform.
# Remove after 2026-09-30 when minimum supported app version is 4.9.
location /v1/legacy/orders/ {
    proxy_pass http://orders_legacy_api;
}
```

Komentar seperti ini mencegah konfigurasi temporary menjadi permanen tanpa disadari.

---

# 15. Pattern: Avoiding Copy-Paste Drift

Copy-paste sering terlihat cepat, tetapi menciptakan drift.

Contoh dua server block:

```nginx
server {
    server_name api-a.example.com;
    proxy_read_timeout 30s;
    proxy_set_header X-Forwarded-Proto $scheme;
}

server {
    server_name api-b.example.com;
    proxy_read_timeout 60s;
    proxy_set_header X-Forwarded-Scheme $scheme;
}
```

Mungkin perbedaan itu disengaja. Mungkin typo. Reviewer tidak tahu.

## 15.1 Cara Mengurangi Drift

Gunakan snippet untuk policy standar:

```nginx
include snippets/proxy-headers-standard.conf;
include snippets/proxy-timeouts-api-default.conf;
```

Jika ada override:

```nginx
# Override default API timeout because report generation can take longer.
# Owner: Reporting Team.
include snippets/proxy-timeouts-long-export.conf;
```

## 15.2 Detect Drift dengan Script Sederhana

Contoh audit sederhana:

```bash
grep -R "proxy_read_timeout" /etc/nginx | sort
```

Atau di repo:

```bash
grep -R "client_max_body_size" nginx/ | sort
```

Tujuannya bukan menggantikan review, tetapi menemukan policy yang tersebar.

---

# 16. Pattern: Config Review Checklist

Setiap perubahan Nginx config harus direview seperti code production.

## 16.1 Checklist Umum

Untuk setiap change:

- Apakah context directive benar?
- Apakah `nginx -t` lulus?
- Apakah effective config (`nginx -T`) sesuai ekspektasi?
- Apakah server block yang dipilih benar?
- Apakah location precedence benar?
- Apakah fallback behavior aman?
- Apakah upstream benar?
- Apakah timeout sesuai budget aplikasi?
- Apakah retry aman untuk method tersebut?
- Apakah header forwarding sesuai kontrak aplikasi?
- Apakah client IP trusted chain benar?
- Apakah body size terlalu besar?
- Apakah endpoint internal terlindungi?
- Apakah log cukup untuk debugging?
- Apakah data sensitif tidak dilog?
- Apakah perubahan punya rollback plan?

## 16.2 Checklist Security

- Apakah domain unknown ditangani catch-all?
- Apakah TLS policy tidak downgrade?
- Apakah HSTS hanya dipakai jika siap?
- Apakah CORS tidak wildcard secara sembarangan?
- Apakah dotfiles diblokir?
- Apakah admin/metrics/actuator tidak public?
- Apakah request body/header limit eksplisit?
- Apakah error page tidak membocorkan informasi?
- Apakah header spoofing dicegah?
- Apakah `X-Forwarded-For` hanya dipercaya dari proxy yang benar?

## 16.3 Checklist Operability

- Apakah log mencatat `$request_id`?
- Apakah upstream timing dicatat?
- Apakah 499/502/504 bisa dibedakan?
- Apakah reload tidak memutus koneksi penting?
- Apakah config bisa dirollback cepat?
- Apakah dashboard/alert perlu diupdate?
- Apakah perubahan memengaruhi cache/rate limit?

---

# 17. Testing Nginx Config di CI/CD

Minimal pipeline:

```text
lint/render -> nginx -t -> nginx -T artifact -> smoke test -> deploy -> post-deploy check
```

## 17.1 Syntax Test

```bash
nginx -t -c /path/to/nginx.conf
```

Ini memvalidasi syntax dan sebagian referensi file.

Namun `nginx -t` tidak membuktikan:

- route memilih upstream yang benar,
- header dikirim sesuai kontrak,
- timeout sesuai ekspektasi,
- path rewrite benar,
- security behavior benar.

## 17.2 Effective Config Snapshot

```bash
nginx -T -c /path/to/nginx.conf > effective-nginx.conf
```

Simpan sebagai CI artifact.

Manfaat:

- reviewer melihat config hasil akhir,
- debugging lebih mudah,
- audit perubahan lebih jelas,
- include order terlihat.

## 17.3 Smoke Test dengan Container

Jalankan Nginx test container dengan config yang akan dirilis.

Contoh kasar:

```bash
docker run --rm \
  -v "$PWD/nginx:/etc/nginx:ro" \
  nginx:stable \
  nginx -t
```

Untuk smoke test routing, jalankan backend mock:

```text
Nginx test container -> mock orders API
                    -> mock users API
                    -> mock frontend
```

Lalu test:

```bash
curl -H 'Host: api.example.com' http://localhost/api/orders/123
curl -H 'Host: api.example.com' http://localhost/api/users/me
curl -H 'Host: unknown.example.com' http://localhost/
```

## 17.4 Contract Test untuk Proxy Headers

Mock backend bisa mencetak header yang diterima. Test harus memastikan:

- `Host` benar,
- `X-Forwarded-Proto` benar,
- `X-Forwarded-For` benar,
- `X-Request-ID` ada,
- header spoofed tidak dipercaya sembarangan.

Contoh assertion:

```text
Given request Host: api.example.com
When request goes through Nginx
Then backend receives X-Forwarded-Proto: https
And backend receives X-Request-ID
And backend does not trust arbitrary external X-Forwarded-For without real_ip policy
```

## 17.5 Route Test Matrix

Buat test matrix:

| Request | Expected |
|---|---|
| `GET /api/orders/1` | `orders_api` |
| `GET /api/orders` | redirect atau 404 sesuai policy |
| `GET /api/users/me` | `users_api` |
| `GET /api/unknown` | 404 |
| `GET /.env` | denied |
| `GET /actuator/health` public domain | denied |
| Unknown Host | denied |
| Large body | 413 |
| HTTP | redirect HTTPS |

Ini jauh lebih bernilai daripada hanya `nginx -t`.

---

# 18. Generated Config: Kapan Boleh dan Kapan Berbahaya

Generated config berguna jika:

- banyak service,
- banyak environment,
- route berasal dari service registry,
- config harus konsisten,
- manual editing terlalu rawan.

Namun generated config berbahaya jika:

- hasil akhir tidak bisa dibaca manusia,
- template menyembunyikan policy penting,
- tidak ada artifact effective config,
- service owner bisa generate rule berbahaya tanpa guardrail,
- tidak ada validasi collision.

## 18.1 Golden Rule

> Template boleh kompleks, tetapi rendered config harus mudah diaudit.

## 18.2 Input Manifest Pattern

Contoh manifest service:

```yaml
service: orders-api
owner: orders-team
routes:
  - domain: api.example.com
    path_prefix: /api/orders/
    upstream: orders_api
    public: true
    timeout_profile: api-default
    rate_limit_profile: standard-api
  - domain: api.example.com
    path_prefix: /api/orders/export/
    upstream: orders_api
    public: true
    timeout_profile: long-export
    rate_limit_profile: strict-export
```

Generator bisa menghasilkan:

```nginx
location /api/orders/export/ {
    include snippets/proxy-headers-standard.conf;
    include snippets/proxy-timeouts-long-export.conf;
    limit_req zone=strict_export burst=5 nodelay;
    proxy_pass http://orders_api;
}

location /api/orders/ {
    include snippets/proxy-headers-standard.conf;
    include snippets/proxy-timeouts-api-default.conf;
    limit_req zone=standard_api burst=20 nodelay;
    proxy_pass http://orders_api;
}
```

Perhatikan urutan: route lebih spesifik harus muncul dan dipahami dengan benar, terutama jika regex atau prefix khusus digunakan.

## 18.3 Guardrail Generator

Generator harus menolak:

- duplicate exact route,
- ambiguous prefix,
- public actuator route,
- wildcard CORS tanpa approval,
- timeout terlalu tinggi tanpa annotation,
- body size terlalu besar tanpa annotation,
- route tanpa owner,
- route tanpa logging profile,
- upstream tidak dikenal,
- domain tidak dikenal.

---

# 19. Secret Separation

Jangan campur secret dengan config yang bebas dibaca.

Contoh secret:

- TLS private key,
- Basic Auth password file,
- auth token untuk subrequest tertentu,
- upstream credential jika ada,
- mTLS client key.

## 19.1 File Permission

Private key:

```text
/etc/nginx/secrets/tls/api.example.com.key
```

Harus dibatasi permission-nya.

Config hanya referensikan path:

```nginx
ssl_certificate     /etc/nginx/certs/api.example.com.crt;
ssl_certificate_key /etc/nginx/secrets/tls/api.example.com.key;
```

## 19.2 Container/Kubernetes

Di Kubernetes:

- config dari ConfigMap,
- secret dari Secret,
- mount path terpisah,
- read-only mount,
- RBAC ketat,
- jangan log isi secret.

## 19.3 Avoid Secret in Generated Output

Jika rendered config berisi secret literal, artifact CI/CD menjadi sensitif. Lebih aman rendered config hanya berisi path/env reference.

---

# 20. Blast Radius Control

Nginx berada di jalur traffic. Kesalahan kecil bisa memutus banyak service.

## 20.1 Reduce Scope of Change

Lebih baik mengubah:

```text
services/orders/nginx/locations.conf
```

daripada mengubah:

```text
nginx.conf
```

Perubahan global harus lebih sulit disetujui daripada perubahan route lokal.

## 20.2 Progressive Config Rollout

Untuk fleet besar:

1. Validate config di CI.
2. Deploy ke satu instance/canary edge.
3. Smoke test.
4. Monitor 4xx/5xx/latency.
5. Rollout bertahap.
6. Rollback otomatis/manual jika error naik.

## 20.3 Separate Risk Classes

Klasifikasikan perubahan:

| Risk | Contoh | Review |
|---|---|---|
| Low | tambah static asset cache header | normal |
| Medium | tambah route service baru | service + platform |
| High | ubah TLS/security headers | platform + security |
| High | ubah global timeout/retry | platform + service owners |
| Critical | ubah catch-all/default server | senior/platform approval |
| Critical | expose internal endpoint | security approval |

## 20.4 Rollback Discipline

Setiap perubahan harus punya jawaban:

```text
How do we revert safely?
How fast?
Does rollback require app rollback too?
Will cache/rate-limit state persist?
Will clients observe redirect/cookie side effects?
```

---

# 21. Anti-Patterns

## 21.1 The Giant Server Block

```nginx
server {
    # 3000 lines of everything
}
```

Masalah:

- tidak ada ownership,
- review sulit,
- collision tersembunyi,
- perubahan kecil sulit dipahami.

Solusi:

- split location by service,
- keep server block as composition layer,
- document fallback behavior.

## 21.2 The Common Snippet That Does Everything

```nginx
include snippets/common.conf;
```

Masalah:

- policy tersembunyi,
- sulit override sebagian,
- efek samping besar.

Solusi:

- snippet kecil by intent.

## 21.3 Environment Copy-Paste

```text
prod.conf
staging.conf
dev.conf
```

semua hampir sama tetapi tidak identik.

Masalah:

- drift,
- bug hanya muncul di production,
- security baseline tidak konsisten.

Solusi:

- template + values,
- shared policy,
- rendered config artifact.

## 21.4 Wildcard Include Without Ownership

```nginx
include conf.d/*.conf;
```

lalu semua orang bisa menambah file.

Masalah:

- urutan tidak jelas,
- domain default bisa berubah,
- route collision.

Solusi:

- directory by context,
- naming convention,
- CODEOWNERS/review ownership,
- generated route registry.

## 21.5 Temporary Config Without Expiry

```nginx
# temporary fix
location /old-api/ {
    proxy_pass http://legacy;
}
```

Masalah:

- temporary menjadi permanent,
- legacy tidak pernah mati,
- security posture memburuk.

Solusi:

```nginx
# Temporary compatibility route.
# Owner: Integration Team.
# Remove after 2026-09-30.
# Tracking: PLATFORM-1234.
location /old-api/ {
    proxy_pass http://legacy;
}
```

---

# 22. CODEOWNERS dan Review Ownership

Jika Nginx config disimpan di Git, gunakan ownership.

Contoh `CODEOWNERS`:

```text
/nginx/nginx.conf                  @platform-team
/nginx/policy/*                    @platform-team @security-team
/nginx/snippets/tls-*              @platform-team @security-team
/nginx/snippets/security-*         @security-team
/nginx/servers/admin.example.com*  @platform-team @security-team
/nginx/services/orders/*           @orders-team @platform-team
/nginx/services/users/*            @identity-team @platform-team
```

Tujuannya:

- service team bisa mengubah route sendiri,
- platform tetap menjaga boundary,
- security ikut review surface sensitif,
- perubahan global tidak lolos tanpa pemilik yang tepat.

---

# 23. Config Documentation Pattern

Dokumentasi minimal di repo:

```text
nginx/
├── README.md
├── ROUTES.md
├── SECURITY.md
├── OPERATIONS.md
└── CHANGE_POLICY.md
```

## 23.1 README.md

Berisi:

- layout direktori,
- cara render config,
- cara test config,
- cara menjalankan lokal,
- cara deploy,
- cara rollback.

## 23.2 ROUTES.md

Berisi registry route:

- domain,
- path,
- owner,
- upstream,
- public/internal,
- special timeout/rate limit.

## 23.3 SECURITY.md

Berisi:

- TLS policy,
- security headers,
- internal endpoint rule,
- trusted proxy chain,
- CORS rule,
- secret handling.

## 23.4 OPERATIONS.md

Berisi:

- reload command,
- rollback step,
- common status code diagnosis,
- dashboard link,
- log query examples,
- emergency mitigation pattern.

---

# 24. Example: Production-Grade Config Layout

Berikut contoh utuh yang menggabungkan pattern di atas.

## 24.1 Root Config

```nginx
# nginx.conf
user nginx;
worker_processes auto;
pid /run/nginx.pid;

events {
    worker_connections 8192;
}

http {
    include mime.types;
    default_type application/octet-stream;

    server_tokens off;

    include policy/logging.conf;
    include policy/maps.conf;
    include policy/real-ip.conf;
    include policy/gzip.conf;
    include policy/rate-limit-zones.conf;
    include policy/cache-zones.conf;

    include upstreams/*.conf;
    include servers/*.conf;
}
```

## 24.2 Logging Policy

```nginx
# policy/logging.conf
log_format main_json escape=json
  '{'
    '"time":"$time_iso8601",'
    '"request_id":"$request_id",'
    '"remote_addr":"$remote_addr",'
    '"host":"$host",'
    '"method":"$request_method",'
    '"uri":"$request_uri",'
    '"status":$status,'
    '"body_bytes_sent":$body_bytes_sent,'
    '"request_time":$request_time,'
    '"upstream_addr":"$upstream_addr",'
    '"upstream_status":"$upstream_status",'
    '"upstream_response_time":"$upstream_response_time",'
    '"http_user_agent":"$http_user_agent"'
  '}';

access_log /var/log/nginx/access.log main_json;
error_log  /var/log/nginx/error.log warn;
```

## 24.3 Upstream

```nginx
# upstreams/orders-api.conf
upstream orders_api {
    server orders-api-1.internal:8080 max_fails=3 fail_timeout=10s;
    server orders-api-2.internal:8080 max_fails=3 fail_timeout=10s;
    keepalive 64;
}
```

## 24.4 Server Block

```nginx
# servers/api.example.com.conf
server {
    listen 443 ssl http2;
    server_name api.example.com;

    include snippets/tls-modern.conf;
    include snippets/security-headers-api.conf;

    access_log /var/log/nginx/api.example.com.access.log main_json;
    error_log  /var/log/nginx/api.example.com.error.log warn;

    client_max_body_size 10m;

    include services/orders/locations.conf;
    include services/users/locations.conf;

    location / {
        return 404;
    }
}
```

## 24.5 Service Location

```nginx
# services/orders/locations.conf
location = /api/orders {
    return 301 /api/orders/;
}

location /api/orders/export/ {
    include snippets/proxy-headers-standard.conf;
    include snippets/proxy-timeouts-long-export.conf;
    include snippets/proxy-buffering-default.conf;

    limit_req zone=orders_export burst=5 nodelay;

    proxy_pass http://orders_api;
}

location /api/orders/ {
    include snippets/proxy-headers-standard.conf;
    include snippets/proxy-timeouts-api-default.conf;
    include snippets/proxy-buffering-default.conf;

    limit_req zone=api_standard burst=20 nodelay;

    proxy_pass http://orders_api;
}
```

## 24.6 Catch-All

```nginx
# servers/00-catch-all-http.conf
server {
    listen 80 default_server;
    server_name _;
    return 444;
}
```

```nginx
# servers/00-catch-all-https.conf
server {
    listen 443 ssl default_server;
    server_name _;

    ssl_certificate     /etc/nginx/certs/default.crt;
    ssl_certificate_key /etc/nginx/secrets/default.key;

    return 444;
}
```

---

# 25. Java Engineer Perspective

Sebagai Java engineer, pikirkan Nginx config seperti public interface di depan aplikasi.

## 25.1 Nginx Config = External Runtime Contract

Aplikasi Java kamu bergantung pada Nginx untuk:

- scheme detection,
- original host,
- client IP,
- request ID,
- body size behavior,
- timeout envelope,
- retry behavior,
- connection reuse,
- buffering semantics,
- TLS termination,
- cache behavior,
- rate limiting.

Jika config berubah, behavior aplikasi bisa berubah tanpa satu baris kode Java berubah.

Contoh:

```nginx
proxy_set_header X-Forwarded-Proto http;
```

Bisa menyebabkan Spring Boot menghasilkan redirect HTTP, bukan HTTPS.

Contoh lain:

```nginx
proxy_request_buffering off;
```

Bisa mengubah cara upload besar menekan thread/memory backend.

Contoh lain:

```nginx
proxy_read_timeout 5s;
```

Bisa membuat endpoint yang valid di aplikasi terlihat gagal di client.

## 25.2 Service Owner Harus Tahu Proxy Policy

Tim Java service harus tahu:

- timeout Nginx untuk service mereka,
- max request body,
- apakah buffering aktif,
- apakah retry aktif,
- header apa yang diterima,
- client IP source of truth,
- request ID header name,
- cache/rate limit policy.

Ini harus didokumentasikan sebagai contract.

---

# 26. Practical Governance Model

Untuk organisasi kecil:

```text
One platform owner reviews all Nginx config changes.
Service teams submit route changes via PR.
```

Untuk organisasi menengah:

```text
Platform owns global/server/security snippets.
Service teams own service location fragments.
Security reviews public exposure and auth-sensitive changes.
CI validates route collision and generated config.
```

Untuk organisasi besar:

```text
Service route manifest -> policy engine -> generated config -> CI route tests -> staged rollout.
Manual Nginx editing is restricted to emergency changes.
Emergency changes require follow-up codification.
```

---

# 27. Review Exercise

Lihat konfigurasi berikut:

```nginx
server {
    listen 443 ssl;
    server_name api.example.com;

    include snippets/common.conf;

    location /api/ {
        proxy_pass http://backend;
    }

    location /api/orders/export {
        proxy_read_timeout 600s;
        proxy_pass http://orders;
    }

    location /actuator/ {
        proxy_pass http://backend;
    }

    location / {
        proxy_pass http://legacy;
    }
}
```

Masalah yang harus kamu identifikasi:

1. `common.conf` tidak jelas isinya.
2. `location /api/` terlalu generik.
3. `/api/orders/export` tanpa trailing slash bisa match path tidak disengaja.
4. Timeout 600 detik tidak dijelaskan.
5. `proxy_pass` ke `orders` tidak menyertakan proxy header snippet.
6. `/actuator/` public jika tidak dilindungi.
7. Fallback `/` meneruskan semua unknown path ke legacy.
8. Tidak ada explicit security headers/TLS snippet.
9. Tidak ada access log khusus domain.
10. Tidak ada rate limit untuk export.
11. Tidak jelas ownership route.
12. Tidak ada comment intent.

Versi lebih baik:

```nginx
server {
    listen 443 ssl http2;
    server_name api.example.com;

    include snippets/tls-modern.conf;
    include snippets/security-headers-api.conf;

    access_log /var/log/nginx/api.example.com.access.log main_json;
    error_log  /var/log/nginx/api.example.com.error.log warn;

    client_max_body_size 10m;

    location /api/orders/export/ {
        # Long-running export endpoint.
        # Owner: Orders Team.
        # Rate-limited to protect backend worker pool.
        include snippets/proxy-headers-standard.conf;
        include snippets/proxy-timeouts-long-export.conf;
        include snippets/proxy-buffering-default.conf;

        limit_req zone=orders_export burst=5 nodelay;
        proxy_pass http://orders_api;
    }

    location /api/orders/ {
        include snippets/proxy-headers-standard.conf;
        include snippets/proxy-timeouts-api-default.conf;
        include snippets/proxy-buffering-default.conf;

        proxy_pass http://orders_api;
    }

    location /actuator/ {
        include snippets/internal-only.conf;
        include snippets/proxy-headers-standard.conf;
        proxy_pass http://backend_admin;
    }

    location / {
        return 404;
    }
}
```

---

# 28. Production Checklist

Sebelum config pattern dianggap siap production, pastikan:

## Structure

- `nginx.conf` minimal dan hanya composition root.
- Policy global dipisahkan.
- Upstream dipisahkan.
- Server/domain dipisahkan.
- Service location fragment punya ownership.
- Snippet kecil dan berbasis intent.

## Safety

- Catch-all HTTP/HTTPS ada.
- Unknown host tidak masuk aplikasi.
- Fallback route eksplisit.
- Internal endpoint terlindungi.
- Secret tidak masuk config artifact.
- TLS/security baseline jelas.

## Maintainability

- Naming convention konsisten.
- Temporary rule punya owner dan expiry.
- Route registry tersedia.
- CODEOWNERS tersedia.
- Effective config bisa dilihat.

## Testing

- `nginx -t` di CI.
- `nginx -T` disimpan sebagai artifact.
- Smoke test route utama.
- Unknown host test.
- Header contract test.
- Security path test seperti `/.env`, `/actuator/`, `/admin/`.

## Operability

- Access log mencatat request ID.
- Upstream timing dicatat.
- Error log level sesuai.
- Rollback plan jelas.
- Dashboard/alert diperbarui jika policy berubah.

---

# 29. Mental Model Akhir

Konfigurasi Nginx besar harus dipikirkan seperti sistem software:

```text
Nginx config = executable traffic policy
```

Karena itu, ia butuh:

- modularity,
- ownership,
- testing,
- review,
- documentation,
- rollback,
- observability,
- dan security guardrail.

Prinsip terpenting:

```text
Make common behavior reusable.
Make exceptional behavior explicit.
Make dangerous behavior hard to introduce accidentally.
Make production behavior observable and testable.
```

Dalam sistem kecil, konfigurasi Nginx bisa berupa satu file. Dalam sistem besar, konfigurasi Nginx adalah bagian dari platform engineering. Ia menghubungkan internet, network boundary, service runtime, security policy, deployment workflow, dan incident response.

Jika kamu menguasai desain konfigurasi ini, kamu tidak hanya bisa “menulis Nginx config”. Kamu bisa menjaga agar traffic layer tetap bisa berkembang tanpa berubah menjadi sumber risiko yang tidak bisa diprediksi.

---

# 30. Ringkasan Part 027

Di part ini kita membahas:

- kenapa Nginx config harus diperlakukan sebagai production code,
- mental model config sebagai executable traffic policy,
- pemisahan global/domain/service/endpoint/environment policy,
- struktur direktori yang maintainable,
- naming convention,
- snippet design pattern,
- domain-oriented vs service-oriented config,
- route ownership dan collision control,
- environment overlays,
- generated config,
- secret separation,
- blast radius control,
- review checklist,
- CI/CD testing,
- CODEOWNERS,
- documentation pattern,
- dan governance model.

Part berikutnya akan masuk ke **Production Failure Modeling and Incident Playbooks**: bagaimana mengklasifikasikan failure, membaca gejala, membuat playbook untuk 502/504/499, menghadapi reload failure, disk penuh, cert expired, DNS issue, upstream outage, dan menyusun post-incident learning.

---

# Status Akhir Part

- Part ini selesai: **Part 027 — Config Design Patterns for Large Systems**
- Seri belum selesai.
- Berikutnya: **Part 028 — Production Failure Modeling and Incident Playbooks**
