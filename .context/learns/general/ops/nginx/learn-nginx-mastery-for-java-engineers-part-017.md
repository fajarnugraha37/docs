# learn-nginx-mastery-for-java-engineers-part-017.md

# Part 017 — Access Control, Basic Auth, IP Rules, and Internal Endpoints

> Seri: `learn-nginx-mastery-for-java-engineers`  
> Bagian: `017 / 030`  
> Fokus: menggunakan Nginx sebagai lapisan kontrol akses pragmatis untuk membatasi permukaan serangan, melindungi endpoint internal, dan mencegah exposure tidak sengaja — tanpa salah menganggap Nginx sebagai sistem authorization penuh.

---

## 0. Posisi Part Ini dalam Seri

Sampai Part 016, kita sudah membangun fondasi besar:

- bagaimana Nginx menerima request;
- bagaimana memilih `server` dan `location`;
- bagaimana meneruskan request ke Java backend;
- bagaimana header proxy menjadi kontrak trust boundary;
- bagaimana upstream, timeout, buffering, cache, compression, dan rate limit bekerja.

Part 017 masuk ke satu area yang sering terlihat sederhana tetapi sangat penting dalam production: **access control**.

Banyak incident tidak terjadi karena attacker mengeksploitasi bug rumit. Banyak incident terjadi karena endpoint yang seharusnya internal ternyata bisa diakses publik:

- `/actuator/env`
- `/actuator/heapdump`
- `/metrics`
- `/prometheus`
- `/admin`
- `/debug`
- `/internal/reindex`
- `/internal/job/trigger`
- `/swagger-ui`
- `/v3/api-docs`
- `/graphql/playground`
- `/h2-console`
- `/phpmyadmin` pada host campuran
- endpoint maintenance lama yang lupa dihapus

Nginx sering menjadi lapisan terakhir sebelum aplikasi. Karena itu, Nginx bisa dan harus digunakan untuk membatasi request sebelum mencapai aplikasi.

Tetapi ada batas penting:

> **Nginx access control bukan pengganti authorization domain di aplikasi.**

Nginx bagus untuk **coarse-grained boundary control**. Aplikasi tetap harus mengelola **business authorization**.

---

## 1. Mental Model: Access Control sebagai Boundary, Bukan Business Policy

Dalam sistem backend, access control bisa hidup di banyak lapisan:

```text
Client
  ↓
CDN / WAF
  ↓
Cloud Load Balancer
  ↓
Nginx
  ↓
API Gateway / Service Mesh / Ingress
  ↓
Java Application
  ↓
Domain Authorization
  ↓
Database / External System
```

Setiap lapisan punya kekuatan dan keterbatasan.

Nginx cocok untuk:

- membatasi endpoint berdasarkan IP/network;
- menutup endpoint internal dari internet;
- memberi Basic Auth untuk environment non-production;
- membuat endpoint hanya bisa diakses lewat internal redirect;
- mencegah accidental exposure;
- membatasi akses ke file sensitif;
- memblokir path tertentu;
- melindungi endpoint observability;
- membuat guardrail sebelum request sampai ke Java thread pool.

Nginx tidak cocok untuk:

- role-based authorization kompleks;
- object-level permission;
- rule seperti “user A boleh approve case B hanya jika case berada di region X dan statusnya Y”;
- audit authorization detail;
- policy yang membutuhkan domain state dari database;
- consent/entitlement multi-tenant yang berubah dinamis per user.

Untuk Java engineer, pemisahan ini penting.

Nginx menjawab:

> “Apakah request tipe ini boleh masuk ke boundary ini?”

Aplikasi menjawab:

> “Apakah actor ini boleh melakukan action ini terhadap resource ini dalam state ini?”

Keduanya tidak boleh tertukar.

---

## 2. Control Surface: Apa yang Bisa Dikontrol oleh Nginx?

Nginx bisa mengambil keputusan berdasarkan hal-hal yang tersedia di request dan environment Nginx:

| Basis Kontrol | Contoh | Cocok Untuk |
|---|---|---|
| IP address | `allow 10.0.0.0/8; deny all;` | admin/metrics/internal endpoint |
| Host | `server_name admin.example.com` | pemisahan domain publik/internal |
| Path | `location /actuator/` | endpoint protection |
| Method | `limit_except` | batasi write method |
| Header | `if`, `map`, auth subrequest | routing/protection sederhana |
| Basic Auth | `auth_basic` | staging, admin ringan, temporary gate |
| Internal redirect | `internal` | file/private route hanya via app |
| mTLS metadata | certificate verification variables | B2B/internal high-trust boundary |
| Geo/network variables | `geo`, `map` | access matrix berbasis network |

Tetapi setiap basis punya risiko.

IP-based control bisa rusak jika:

- ada NAT;
- request melewati proxy chain;
- real client IP belum dikonfigurasi;
- cloud load balancer berubah range;
- IPv6 lupa ditangani;
- private endpoint ternyata reachable dari network yang lebih luas.

Header-based control bisa rusak jika:

- header bisa dipalsukan client;
- Nginx tidak menghapus header inbound yang tidak dipercaya;
- aplikasi dan Nginx beda interpretasi;
- trust boundary tidak eksplisit.

Path-based control bisa rusak jika:

- location matching salah;
- URL normalization berbeda;
- encoded path tidak diperhitungkan;
- trailing slash ambigu;
- endpoint baru muncul tanpa guardrail.

Access control di Nginx harus dianggap sebagai **policy code**. Ia perlu review, testing, dan observability.

---

## 3. `allow` dan `deny`: IP-Based Access Control

Directive paling dasar adalah `allow` dan `deny` dari access module.

Contoh:

```nginx
location /admin/ {
    allow 10.0.0.0/8;
    allow 192.168.10.0/24;
    deny all;

    proxy_pass http://java_backend;
}
```

Artinya:

- request dari `10.0.0.0/8` diizinkan;
- request dari `192.168.10.0/24` diizinkan;
- sisanya ditolak.

Urutan penting. Nginx mengevaluasi rule secara berurutan sampai menemukan match pertama.

Contoh yang salah:

```nginx
location /admin/ {
    deny all;
    allow 10.0.0.0/8;

    proxy_pass http://java_backend;
}
```

`allow` setelah `deny all` tidak akan berguna untuk client yang sudah match `deny all`.

### 3.1 Default-Deny Lebih Aman

Untuk endpoint sensitif, pola yang baik:

```nginx
allow trusted_network;
deny all;
```

Bukan:

```nginx
deny bad_network;
allow all;
```

Karena daftar jaringan buruk hampir selalu tidak lengkap. Access control yang defensible biasanya memakai **allowlist**, bukan blocklist.

---

## 4. Real Client IP: Prasyarat Penting untuk IP-Based Control

IP-based access control hanya benar jika Nginx melihat IP yang benar.

Dalam banyak deployment, Nginx tidak langsung menerima request dari user. Request bisa melewati:

- CDN;
- WAF;
- cloud load balancer;
- reverse proxy lain;
- Kubernetes ingress;
- service mesh;
- corporate proxy.

Tanpa konfigurasi real IP, `$remote_addr` bisa berisi IP load balancer, bukan IP client.

Contoh:

```text
Client:        203.0.113.10
Cloud LB:      10.0.1.20
Nginx sees:    10.0.1.20
```

Jika kamu menulis:

```nginx
location /admin/ {
    allow 10.0.0.0/8;
    deny all;
}
```

Dan `$remote_addr` adalah IP load balancer `10.0.1.20`, maka semua client dari internet bisa tampak seperti trusted network. Ini bahaya.

### 4.1 Menggunakan Real IP Module

Contoh umum:

```nginx
set_real_ip_from 10.0.0.0/8;
real_ip_header X-Forwarded-For;
real_ip_recursive on;
```

Makna:

- percaya header real IP hanya jika request datang dari network proxy yang dipercaya;
- ambil IP dari `X-Forwarded-For`;
- cari IP client paling benar dalam chain jika recursive aktif.

Tetapi ini harus sangat hati-hati.

Jangan lakukan ini:

```nginx
set_real_ip_from 0.0.0.0/0;
real_ip_header X-Forwarded-For;
```

Itu berarti kamu mempercayai `X-Forwarded-For` dari siapa pun. Client bisa mengirim:

```http
X-Forwarded-For: 10.0.0.5
```

lalu tampak seperti internal client.

### 4.2 Rule Praktis

Gunakan prinsip ini:

> Percayai forwarded IP hanya dari proxy yang kamu kontrol.

Contoh lebih aman:

```nginx
# Cloud load balancer subnet only
set_real_ip_from 10.10.0.0/16;
set_real_ip_from 10.20.0.0/16;

real_ip_header X-Forwarded-For;
real_ip_recursive on;
```

Jika memakai CDN, gunakan IP range resmi CDN, tetapi ingat range bisa berubah. Itu butuh proses update yang jelas.

---

## 5. Melindungi Spring Boot Actuator

Spring Boot Actuator sangat berguna untuk observability dan operability, tetapi beberapa endpoint sensitif jika terbuka.

Endpoint seperti ini harus diperlakukan hati-hati:

```text
/actuator
/actuator/health
/actuator/info
/actuator/metrics
/actuator/prometheus
/actuator/env
/actuator/configprops
/actuator/heapdump
/actuator/threaddump
/actuator/loggers
```

Tidak semua endpoint punya sensitivitas sama.

| Endpoint | Sensitivitas | Catatan |
|---|---:|---|
| `/actuator/health` | rendah-sedang | Bisa expose detail dependency jika detail aktif |
| `/actuator/info` | rendah-sedang | Bisa expose build/version/git metadata |
| `/actuator/prometheus` | sedang | Metric bisa expose traffic/business info |
| `/actuator/metrics` | sedang | Bisa expose internal behavior |
| `/actuator/env` | tinggi | Bisa expose property/secrets jika salah konfigurasi |
| `/actuator/heapdump` | sangat tinggi | Bisa berisi data sensitif di memory |
| `/actuator/threaddump` | tinggi | Bisa expose stack/internal class/path |
| `/actuator/loggers` | tinggi | Bisa mengubah logging runtime jika write enabled |

### 5.1 Pola Umum: Health Publik Minimal, Metrics Internal

Contoh:

```nginx
# Public health endpoint for load balancer
location = /actuator/health {
    proxy_pass http://java_backend;
}

# Everything else under actuator is internal only
location /actuator/ {
    allow 10.0.0.0/8;
    allow 192.168.0.0/16;
    deny all;

    proxy_pass http://java_backend;
}
```

Tetapi ini masih harus disesuaikan dengan environment.

Untuk internet-facing service, sering lebih baik:

```nginx
location = /actuator/health {
    allow 10.0.0.0/8;      # only load balancer / monitoring
    deny all;

    proxy_pass http://java_backend;
}

location /actuator/ {
    deny all;
}
```

Lalu metrics diakses via internal network, sidecar, service mesh, atau dedicated monitoring path yang tidak publik.

### 5.2 Jangan Hanya Bergantung pada Nginx

Di Spring Boot, exposure actuator juga harus dibatasi dari aplikasi:

```properties
management.endpoints.web.exposure.include=health,info,prometheus
management.endpoint.health.show-details=never
```

Atau pisahkan management port:

```properties
management.server.port=8081
management.server.address=127.0.0.1
```

Lalu Nginx hanya expose yang perlu.

Mental model yang benar:

```text
Application config minimizes exposed capability.
Nginx config minimizes reachable surface.
```

Jangan mengandalkan satu lapisan saja.

---

## 6. Basic Auth: Berguna, Tapi Jangan Overestimate

Basic Auth di Nginx berguna untuk:

- staging environment;
- temporary gate;
- admin sederhana;
- protecting docs;
- protecting preview deployment;
- low-risk internal tools.

Contoh:

```nginx
location /admin/ {
    auth_basic "Restricted";
    auth_basic_user_file /etc/nginx/.htpasswd;

    proxy_pass http://java_backend;
}
```

File `.htpasswd` bisa dibuat dengan tool seperti `htpasswd`.

Contoh struktur:

```text
alice:$apr1$...
bob:$apr1$...
```

### 6.1 Basic Auth Harus Selalu Lewat HTTPS

Basic Auth mengirim credential dalam bentuk base64 pada header `Authorization`. Base64 bukan encryption.

Karena itu:

```text
Basic Auth tanpa HTTPS = credential bocor.
```

Gunakan Basic Auth hanya pada HTTPS.

### 6.2 Basic Auth Bukan Identity Platform

Basic Auth tidak memberi:

- MFA;
- audit user yang bagus;
- centralized revocation;
- session management;
- role hierarchy;
- risk-based auth;
- SSO integration;
- fine-grained authorization.

Untuk production admin yang penting, gunakan identity-aware proxy, SSO, OAuth2/OIDC, VPN, mTLS, atau auth layer yang lebih kuat.

### 6.3 Kombinasi Basic Auth dan IP Allowlist

Untuk environment sensitif, kombinasikan:

```nginx
location /admin/ {
    allow 10.0.0.0/8;
    deny all;

    auth_basic "Admin Area";
    auth_basic_user_file /etc/nginx/.htpasswd;

    proxy_pass http://java_backend;
}
```

Artinya:

- hanya network tertentu yang boleh mencoba;
- setelah itu masih perlu credential.

Ini defense-in-depth sederhana.

---

## 7. `satisfy`: Menggabungkan IP Rule dan Auth

Nginx punya directive `satisfy` untuk menentukan apakah semua access modules harus lolos atau cukup salah satu.

### 7.1 `satisfy all`

Default-nya adalah `all`.

```nginx
location /admin/ {
    satisfy all;

    allow 10.0.0.0/8;
    deny all;

    auth_basic "Admin";
    auth_basic_user_file /etc/nginx/.htpasswd;

    proxy_pass http://java_backend;
}
```

Makna:

```text
IP harus allowed DAN Basic Auth harus valid.
```

Ini lebih ketat.

### 7.2 `satisfy any`

```nginx
location /admin/ {
    satisfy any;

    allow 10.0.0.0/8;
    deny all;

    auth_basic "Admin";
    auth_basic_user_file /etc/nginx/.htpasswd;

    proxy_pass http://java_backend;
}
```

Makna:

```text
Jika IP allowed ATAU Basic Auth valid, request boleh lewat.
```

Ini bisa berguna untuk:

- internal network boleh langsung;
- external engineer harus Basic Auth.

Tapi juga berbahaya jika salah paham. Dengan `satisfy any`, Basic Auth valid dari internet bisa melewati IP restriction. Itu mungkin intended, mungkin juga vulnerability.

### 7.3 Decision Table

| IP Client | Basic Auth | `satisfy all` | `satisfy any` |
|---|---|---|---|
| allowed | valid | allow | allow |
| allowed | invalid/missing | deny | allow |
| denied | valid | deny | allow |
| denied | invalid/missing | deny | deny |

Sebelum memakai `satisfy any`, tulis decision table seperti di atas.

---

## 8. `internal`: Endpoint Hanya untuk Internal Redirect Nginx

Directive `internal` membuat location tidak bisa diakses langsung oleh client. Location tersebut hanya bisa digunakan oleh internal redirect Nginx.

Contoh:

```nginx
location /private-files/ {
    internal;
    alias /srv/app/private-files/;
}
```

Jika client langsung request:

```http
GET /private-files/report.pdf
```

Nginx akan menolak.

Tetapi aplikasi bisa mengembalikan header seperti `X-Accel-Redirect`:

```http
X-Accel-Redirect: /private-files/report.pdf
```

Lalu Nginx akan melayani file tersebut secara internal.

### 8.1 Kenapa Ini Berguna?

Misal Java app punya file private:

- dokumen kasus;
- invoice;
- evidence attachment;
- export CSV;
- generated report;
- user-uploaded document.

Aplikasi perlu melakukan authorization berdasarkan user dan domain state. Tetapi aplikasi tidak ideal untuk streaming file besar karena:

- memakai thread;
- memakai heap/buffer;
- bisa membebani GC;
- throughput file serving lebih cocok dilakukan Nginx.

Pola yang bagus:

```text
1. Client request /api/documents/123/download
2. Java app authenticate + authorize user
3. Java app returns X-Accel-Redirect: /protected-documents/tenant-a/123.pdf
4. Nginx serves file from disk using internal location
```

Contoh config:

```nginx
location /api/ {
    proxy_pass http://java_backend;
}

location /protected-documents/ {
    internal;
    alias /data/documents/;
}
```

### 8.2 Jangan Letakkan Private Files di Public Root

Salah:

```nginx
root /srv/app;

location / {
    try_files $uri $uri/ /index.html;
}

location /private/ {
    internal;
}
```

Jika struktur dan location tidak hati-hati, file private bisa tetap tersentuh lewat path lain.

Lebih baik pisahkan:

```text
/srv/public-assets       -> untuk static public
/data/private-documents  -> untuk private file
```

Nginx config:

```nginx
location /assets/ {
    alias /srv/public-assets/;
}

location /_private_docs/ {
    internal;
    alias /data/private-documents/;
}
```

Gunakan prefix internal yang tidak terlihat seperti route publik biasa, misalnya `/_internal/` atau `/_protected/`.

---

## 9. Method-Based Restriction dengan `limit_except`

Kadang kita ingin endpoint tertentu hanya menerima method tertentu.

Contoh static upload/download endpoint:

```nginx
location /public-files/ {
    limit_except GET HEAD {
        deny all;
    }

    root /srv/app;
}
```

Atau admin endpoint hanya boleh dari internal network untuk method non-GET:

```nginx
location /api/admin/ {
    limit_except GET {
        allow 10.0.0.0/8;
        deny all;
    }

    proxy_pass http://java_backend;
}
```

Tetapi hati-hati:

- method authorization biasanya tetap harus di aplikasi;
- REST endpoint sering punya semantics kompleks;
- `limit_except` bukan pengganti permission check.

Gunakan ini sebagai outer guardrail.

---

## 10. Menutup Dotfiles dan File Sensitif

Nginx sebagai static server harus menolak file yang tidak boleh publik.

Contoh file sensitif:

```text
.env
.git/config
.git/HEAD
.svn/
.htpasswd
Dockerfile
docker-compose.yml
application.yml
application.properties
*.key
*.pem
*.bak
*.sql
```

Config umum:

```nginx
location ~ /\. {
    deny all;
}
```

Ini menolak path yang mengandung dotfile seperti `/.git/config` atau `/.env`.

Tetapi bisa terlalu luas untuk beberapa use case, misalnya `.well-known/acme-challenge` untuk certificate validation.

Solusi:

```nginx
location ^~ /.well-known/acme-challenge/ {
    root /var/www/letsencrypt;
}

location ~ /\. {
    deny all;
}
```

Urutan dan `^~` penting supaya `.well-known` tidak tertangkap rule dotfile.

### 10.1 Block Backup dan Secret File

```nginx
location ~* \.(?:bak|backup|old|orig|save|swp|sql|tar|tgz|gz|zip|pem|key)$ {
    deny all;
}
```

Namun jangan mengandalkan ekstensi saja. Root static seharusnya hanya berisi file yang memang public.

Prinsip lebih kuat:

```text
Do not put secrets in public root.
```

Nginx rule adalah sabuk pengaman, bukan desain utama.

---

## 11. Protecting Swagger/OpenAPI UI

Swagger UI dan OpenAPI docs sangat berguna untuk developer, tetapi sering tidak boleh terbuka publik.

Path umum:

```text
/swagger-ui/
/swagger-ui.html
/v3/api-docs
/api-docs
/openapi.json
```

Contoh protection untuk staging:

```nginx
location ~ ^/(swagger-ui|v3/api-docs|api-docs|openapi\.json) {
    auth_basic "API Docs";
    auth_basic_user_file /etc/nginx/.htpasswd;

    proxy_pass http://java_backend;
}
```

Untuk production publik, sering lebih aman:

```nginx
location ~ ^/(swagger-ui|v3/api-docs|api-docs|openapi\.json) {
    deny all;
}
```

Atau expose hanya internal:

```nginx
location ~ ^/(swagger-ui|v3/api-docs|api-docs|openapi\.json) {
    allow 10.0.0.0/8;
    deny all;

    proxy_pass http://java_backend;
}
```

Tetapi ingat: aplikasi juga sebaiknya bisa mematikan docs di production.

---

## 12. Protecting Metrics Endpoint

Metrics endpoint sering dianggap tidak sensitif karena “hanya angka”. Itu asumsi lemah.

Metrics bisa mengungkap:

- endpoint populer;
- error rate;
- latency internal;
- queue size;
- dependency names;
- database pool behavior;
- business counters;
- tenant identifiers jika label buruk;
- version/build metadata;
- hostnames;
- library names.

Contoh protection:

```nginx
location = /metrics {
    allow 10.0.0.0/8;
    allow 172.16.0.0/12;
    deny all;

    proxy_pass http://java_backend;
}

location = /actuator/prometheus {
    allow 10.0.0.0/8;
    allow 172.16.0.0/12;
    deny all;

    proxy_pass http://java_backend;
}
```

Dalam Kubernetes, lebih baik metrics tidak lewat public ingress sama sekali. Gunakan Service internal, ServiceMonitor/PodMonitor, atau scraping langsung di cluster network.

---

## 13. Admin Domain vs Admin Path

Ada dua pola umum:

```text
https://example.com/admin/
```

atau

```text
https://admin.example.com/
```

### 13.1 Admin sebagai Path

Kelebihan:

- deployment sederhana;
- satu domain;
- mudah routing ke aplikasi yang sama.

Kekurangan:

- risiko path overlap;
- security header/cookie scope lebih rumit;
- accidental exposure lebih mudah;
- frontend route bisa konflik;
- cache/CDN rule lebih rentan salah.

### 13.2 Admin sebagai Subdomain

Kelebihan:

- boundary lebih jelas;
- bisa punya TLS/cookie/security policy terpisah;
- bisa diarahkan ke network berbeda;
- lebih mudah dibatasi IP/VPN;
- lebih mudah observability dan logging.

Kekurangan:

- perlu DNS/certificate/config tambahan;
- aplikasi mungkin perlu aware host;
- deployment sedikit lebih kompleks.

Untuk sistem penting, admin subdomain biasanya lebih defensible.

Contoh:

```nginx
server {
    listen 443 ssl;
    server_name admin.example.com;

    allow 10.0.0.0/8;
    deny all;

    auth_basic "Admin";
    auth_basic_user_file /etc/nginx/.htpasswd;

    location / {
        proxy_pass http://admin_backend;
    }
}
```

Public server block:

```nginx
server {
    listen 443 ssl;
    server_name www.example.com example.com;

    location / {
        proxy_pass http://public_backend;
    }
}
```

Boundary-nya lebih jelas.

---

## 14. Internal API: Jangan Hanya Mengandalkan Nama Path

Path seperti ini sering memberi rasa aman palsu:

```text
/internal/rebuild-index
/internal/sync-payment
/internal/retry-failed-events
/internal/admin/users
```

Nama `/internal` tidak membuatnya internal.

Jika route reachable dari public Nginx, maka tetap public.

Contoh salah:

```nginx
location / {
    proxy_pass http://java_backend;
}
```

Jika Java app punya `/internal/rebuild-index`, endpoint itu ikut terbuka.

Lebih baik:

```nginx
location /internal/ {
    deny all;
}

location / {
    proxy_pass http://java_backend;
}
```

Atau allow internal network:

```nginx
location /internal/ {
    allow 10.0.0.0/8;
    deny all;

    proxy_pass http://java_backend;
}
```

Tetapi aplikasi tetap harus melakukan authorization.

---

## 15. Host-Based Internal Separation

Untuk service yang punya public API dan internal API, kamu bisa pisahkan berdasarkan host.

```nginx
server {
    listen 443 ssl;
    server_name api.example.com;

    location /internal/ {
        deny all;
    }

    location / {
        proxy_pass http://java_backend;
    }
}

server {
    listen 443 ssl;
    server_name internal-api.example.com;

    allow 10.0.0.0/8;
    deny all;

    location / {
        proxy_pass http://java_backend;
    }
}
```

Keuntungannya:

- public host tidak punya access ke `/internal`;
- internal host hanya reachable dari internal network;
- logs bisa dipisahkan;
- policy lebih mudah dibaca.

Namun backend harus tetap memvalidasi Host/Forwarded Host jika perilaku berbeda per host.

---

## 16. Header-Based Access Control: Hati-Hati dengan Spoofing

Kadang ada kebutuhan seperti:

- hanya allow request dengan header internal token;
- allow request dari gateway upstream tertentu;
- route berdasarkan `X-Internal-Request`;
- bypass auth untuk trusted proxy.

Contoh buruk:

```nginx
if ($http_x_internal_request = "true") {
    proxy_pass http://internal_backend;
}
```

Masalahnya: client bisa mengirim header itu.

Jika ingin memakai header sebagai sinyal trust, Nginx harus menghapus atau overwrite header inbound.

Contoh:

```nginx
proxy_set_header X-Internal-Request "";
```

atau untuk request internal yang dibuat oleh Nginx sendiri:

```nginx
proxy_set_header X-Internal-Request "nginx-edge";
```

Tetapi backend jangan percaya header tersebut dari public boundary kecuali chain trust jelas.

### 16.1 Header Internal Secret?

Kadang orang memakai:

```nginx
proxy_set_header X-Internal-Secret "some-secret";
```

Lalu backend memvalidasi secret tersebut.

Ini bisa membantu, tapi ada risiko:

- secret masuk config;
- secret bisa bocor di logs;
- secret bisa muncul di debug dump;
- rotation sulit;
- jika attacker bisa bypass Nginx dan hit backend langsung, ini hanya efektif jika backend network tertutup;
- jika attacker tahu secret, semua request lolos.

Lebih baik untuk high-trust service-to-service:

- network isolation;
- mTLS;
- service mesh identity;
- signed JWT/service token;
- cloud IAM-based auth;
- dedicated API gateway auth.

---

## 17. CORS Bukan Access Control Server-Side

Ini penting karena sering salah kaprah.

CORS adalah mekanisme browser untuk membatasi JavaScript dari origin tertentu membaca response. CORS bukan firewall.

Jika Nginx hanya mengatur:

```nginx
add_header Access-Control-Allow-Origin https://app.example.com;
```

Itu tidak berarti endpoint tidak bisa diakses oleh:

```bash
curl https://api.example.com/internal/job/run
```

atau oleh server-side script.

Jadi:

```text
CORS protects browser-based read access.
Nginx access control protects request reachability.
Application auth protects domain action.
```

Jangan memakai CORS sebagai pengganti authorization.

---

## 18. `auth_request`: Delegating Authorization to an Auth Service

Nginx bisa memanggil subrequest ke auth service menggunakan `auth_request`.

Contoh konsep:

```nginx
location /api/ {
    auth_request /_auth;
    proxy_pass http://java_backend;
}

location = /_auth {
    internal;
    proxy_pass http://auth_service/validate;
    proxy_pass_request_body off;
    proxy_set_header Content-Length "";
    proxy_set_header X-Original-URI $request_uri;
    proxy_set_header X-Original-Method $request_method;
}
```

Flow:

```text
1. Client request /api/orders/123
2. Nginx sends subrequest to /_auth
3. Auth service returns 2xx => allow
4. Auth service returns 401/403 => deny
5. If allowed, Nginx proxies original request to Java backend
```

### 18.1 Kapan Berguna?

- central authentication at edge;
- protect legacy apps;
- shared login gate;
- identity-aware proxy pattern;
- coarse-grained authorization before app.

### 18.2 Kapan Berbahaya?

Jika dipakai untuk authorization domain kompleks, Nginx-auth-service bisa menjadi bottleneck policy yang sulit sinkron dengan aplikasi.

Contoh buruk:

```text
Auth service says user may access /cases/123
But case state changed after auth check
Application assumes already authorized and skips validation
```

Aplikasi tetap harus enforce domain authorization, terutama untuk mutating operation.

### 18.3 Latency dan Failure Mode

`auth_request` menambah dependency baru di critical path.

Failure mode:

- auth service down → semua API down;
- auth service slow → latency semua API naik;
- timeout salah → 500/504;
- cache auth terlalu agresif → privilege stale;
- auth response header salah → identity spoof.

Karena itu, `auth_request` harus punya timeout, observability, dan fallback policy yang jelas.

---

## 19. Error Code Semantics: 401, 403, 404, 444

Saat menolak request, pilih status code secara sadar.

| Status | Makna | Kapan Dipakai |
|---|---|---|
| 401 | unauthenticated | client perlu credentials |
| 403 | authenticated atau tidak, tetapi forbidden | IP denied, permission denied, blocked endpoint |
| 404 | resource tidak ditemukan | conceal existence untuk endpoint tertentu |
| 444 | Nginx-specific close connection | drop abusive/noisy traffic |

Untuk Basic Auth, Nginx biasanya mengembalikan `401` dengan `WWW-Authenticate`.

Untuk IP deny, biasanya `403`.

Kadang untuk endpoint sensitif, kamu ingin conceal:

```nginx
location /admin/ {
    return 404;
}
```

Tetapi concealment bukan security utama. Jika route memang sensitif, tetap butuh kontrol akses sebenarnya.

---

## 20. Custom Deny Response

Untuk beberapa sistem, response default Nginx terlalu informatif atau tidak sesuai standar API.

Contoh:

```nginx
error_page 403 /custom_403.json;

location = /custom_403.json {
    internal;
    default_type application/json;
    return 403 '{"error":"forbidden"}';
}
```

Namun hati-hati:

- jangan expose detail rule;
- jangan bilang “IP not allowed because not in office VPN” ke publik;
- jangan leak path internal;
- jangan buat response terlalu berbeda sehingga memudahkan endpoint enumeration.

---

## 21. Logging Access Denial

Access control tanpa observability sulit dioperasikan.

Minimal log:

- client IP effective;
- original forwarded IP;
- request method;
- host;
- URI;
- status;
- user agent;
- request ID;
- upstream status jika ada;
- reason jika memungkinkan.

Contoh log format:

```nginx
log_format main_ext escape=json
  '{'
  '"time":"$time_iso8601",'
  '"remote_addr":"$remote_addr",'
  '"xff":"$http_x_forwarded_for",'
  '"host":"$host",'
  '"method":"$request_method",'
  '"uri":"$request_uri",'
  '"status":$status,'
  '"request_id":"$request_id",'
  '"user_agent":"$http_user_agent"'
  '}';

access_log /var/log/nginx/access.log main_ext;
```

Untuk blocked endpoint, kamu bisa pisahkan log:

```nginx
location /actuator/ {
    access_log /var/log/nginx/blocked-actuator.log main_ext;
    deny all;
}
```

Tetapi jangan membuat terlalu banyak file log tanpa rotasi dan monitoring disk.

---

## 22. Testing Access Control

Access control harus diuji eksplisit.

### 22.1 Test dari IP Tidak Trusted

```bash
curl -i https://example.com/actuator/prometheus
```

Expected:

```text
HTTP/1.1 403 Forbidden
```

Atau `404` jika memang concealment dipilih.

### 22.2 Test dari IP Trusted

Dari network trusted:

```bash
curl -i https://example.com/actuator/prometheus
```

Expected:

```text
HTTP/1.1 200 OK
```

### 22.3 Test Header Spoofing

```bash
curl -i https://example.com/admin/ \
  -H 'X-Forwarded-For: 10.0.0.5'
```

Jika request dari internet menjadi allowed, konfigurasi real IP kamu salah.

### 22.4 Test Host Confusion

```bash
curl -i https://PUBLIC_IP/actuator/prometheus \
  -H 'Host: admin.example.com'
```

Pastikan server selection dan default server tidak membuka admin host tanpa SNI/host control yang benar.

### 22.5 Test Encoded Path

```bash
curl -i 'https://example.com/%61ctuator/prometheus'
curl -i 'https://example.com/actuator%2fprometheus'
curl -i 'https://example.com/admin/../actuator/prometheus'
```

Path normalization bisa berbeda antara proxy dan backend. Untuk endpoint sensitif, jangan hanya mengandalkan pattern rapuh.

---

## 23. Location Matching Pitfall dalam Access Control

Misal kamu punya:

```nginx
location / {
    proxy_pass http://java_backend;
}

location ~ \.php$ {
    deny all;
}

location /admin/ {
    allow 10.0.0.0/8;
    deny all;
    proxy_pass http://java_backend;
}
```

Terlihat aman, tetapi kalau ada regex lain yang lebih spesifik atau prefix `^~`, routing bisa berbeda.

Contoh pitfall:

```nginx
location ^~ / {
    proxy_pass http://java_backend;
}

location /actuator/ {
    deny all;
}
```

`location ^~ /` bisa membuat regex tidak dievaluasi, tetapi prefix selection tetap harus dipahami. Kesalahan konfigurasi seperti ini sering muncul karena include file tersebar.

Gunakan:

```bash
nginx -T
```

untuk melihat effective config.

Prinsip:

> Security-sensitive locations harus mudah ditemukan dan tidak bergantung pada include order yang membingungkan.

---

## 24. Access Control untuk Multi-Tenant System

Untuk multi-tenant SaaS atau regulatory platform, hati-hati memakai Nginx access control berdasarkan path/host.

Contoh:

```text
tenant-a.example.com
tenant-b.example.com
```

Nginx bisa route berdasarkan host, tetapi Nginx tidak tahu apakah user A boleh mengakses tenant B.

Nginx bisa membantu:

- memisahkan tenant domain;
- meneruskan `X-Tenant-Host`;
- menolak unknown host;
- menerapkan rate limit per host;
- memblokir admin host dari internet.

Tetapi aplikasi tetap harus enforce tenant boundary.

Jangan melakukan ini:

```text
Host tenant-a.example.com berarti user pasti tenant A.
```

Host adalah input request. Ia harus divalidasi dan dipetakan secara aman.

---

## 25. Access Control untuk Regulatory / Case Management Platform

Dalam sistem enforcement lifecycle atau case management, endpoint internal sering sangat sensitif karena bisa memicu perubahan state:

- escalate case;
- reopen case;
- reassign officer;
- trigger notification;
- regenerate legal document;
- export evidence;
- sync sanction list;
- recalculate penalty;
- override workflow state;
- rerun failed integration.

Nginx bisa membantu dengan boundary kasar:

```nginx
location /internal/workflow/ {
    allow 10.0.0.0/8;
    deny all;

    proxy_pass http://case_backend;
}
```

Tetapi untuk sistem seperti ini, aplikasi tetap harus punya:

- actor identity;
- role/authority;
- case ownership;
- jurisdiction constraint;
- state transition guard;
- maker-checker / four-eye principle;
- audit log;
- reason code;
- immutable event trail;
- idempotency;
- compensating action.

Nginx tidak tahu apakah case sedang dalam state yang memperbolehkan escalation. Nginx hanya tahu request path, header, IP, method.

Mental boundary:

```text
Nginx may block invalid entry points.
Application must block invalid state transitions.
```

---

## 26. Design Pattern: Public App + Internal Management

Contoh desain untuk Java service:

```text
Public:
  https://api.example.com/api/**

Internal:
  https://internal-api.example.com/actuator/**
  https://internal-api.example.com/internal/**
```

Nginx:

```nginx
upstream java_app {
    server 127.0.0.1:8080;
    keepalive 32;
}

server {
    listen 443 ssl http2;
    server_name api.example.com;

    location /actuator/ {
        deny all;
    }

    location /internal/ {
        deny all;
    }

    location / {
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_pass http://java_app;
    }
}

server {
    listen 443 ssl http2;
    server_name internal-api.example.com;

    allow 10.0.0.0/8;
    allow 172.16.0.0/12;
    deny all;

    location / {
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_pass http://java_app;
    }
}
```

Keuntungan:

- public host eksplisit menutup internal paths;
- internal host memakai allowlist;
- aplikasi yang sama bisa melayani keduanya;
- boundary mudah diaudit.

Kekurangan:

- jika backend bisa diakses langsung dari luar, Nginx bisa dibypass;
- jika internal DNS/network salah, internal host bisa terbuka;
- aplikasi tetap harus secure.

---

## 27. Design Pattern: Private File Download dengan X-Accel-Redirect

Nginx:

```nginx
server {
    listen 443 ssl http2;
    server_name app.example.com;

    location /api/ {
        proxy_pass http://java_backend;
    }

    location /_protected_files/ {
        internal;
        alias /data/protected-files/;
    }
}
```

Java pseudo-flow:

```java
@GetMapping("/api/documents/{id}/download")
public ResponseEntity<Void> download(@PathVariable String id, Principal principal) {
    Document doc = documentService.get(id);

    authorizationService.assertCanDownload(principal, doc);

    String internalPath = "/_protected_files/" + doc.getStoragePath();

    return ResponseEntity.ok()
        .header("X-Accel-Redirect", internalPath)
        .header("Content-Disposition", "attachment; filename=\"" + doc.getSafeFilename() + "\"")
        .build();
}
```

Nginx serves file after Java authorizes.

Security consideration:

- sanitize `storagePath`;
- prevent `../` traversal;
- do not let user control `X-Accel-Redirect` path;
- private file directory must not be public root;
- audit download decision in Java;
- consider signed one-time download token for external sharing.

---

## 28. Design Pattern: Staging Protected by Basic Auth

```nginx
server {
    listen 443 ssl http2;
    server_name staging.example.com;

    auth_basic "Staging";
    auth_basic_user_file /etc/nginx/htpasswd/staging;

    location / {
        proxy_pass http://staging_java_app;
    }
}
```

Improve with IP restriction:

```nginx
server {
    listen 443 ssl http2;
    server_name staging.example.com;

    satisfy any;

    allow 10.0.0.0/8;
    deny all;

    auth_basic "Staging";
    auth_basic_user_file /etc/nginx/htpasswd/staging;

    location / {
        proxy_pass http://staging_java_app;
    }
}
```

Semantics:

- internal network bypasses Basic Auth;
- external user needs Basic Auth.

Kalau kamu ingin semua user tetap Basic Auth meskipun internal, gunakan `satisfy all` atau omit `satisfy any`.

---

## 29. Design Pattern: Block Unknown Hosts

Default server harus aman.

```nginx
server {
    listen 80 default_server;
    listen 443 ssl default_server;
    server_name _;

    return 444;
}
```

Atau:

```nginx
return 404;
```

Tujuannya:

- request dengan Host tidak dikenal tidak masuk ke aplikasi;
- IP direct access tidak diarahkan ke virtual host utama;
- domain asing yang menunjuk ke IP kamu tidak ikut dilayani;
- scanning noise dikurangi.

Untuk TLS, default server tetap butuh certificate. Bisa pakai self-signed/internal/default certificate sesuai policy, tetapi jangan sampai default server menyajikan aplikasi production.

---

## 30. Common Mistakes

### Mistake 1: Melindungi `/admin/` tapi Lupa `/admin`

```nginx
location /admin/ {
    deny all;
}
```

Path `/admin` tanpa trailing slash mungkin tidak match seperti yang diasumsikan.

Tambahkan exact match:

```nginx
location = /admin {
    return 301 /admin/;
}

location /admin/ {
    deny all;
}
```

Atau deny keduanya:

```nginx
location = /admin { deny all; }
location /admin/ { deny all; }
```

### Mistake 2: Real IP Trust Terlalu Luas

```nginx
set_real_ip_from 0.0.0.0/0;
```

Ini sangat berbahaya jika memakai forwarded header untuk allowlist.

### Mistake 3: Basic Auth di HTTP

Credential bisa bocor.

### Mistake 4: Endpoint Internal Tetap Ada di Public Catch-All

```nginx
location / {
    proxy_pass http://java_backend;
}
```

Tanpa deny eksplisit untuk `/internal/`, semua route backend public secara default.

### Mistake 5: Swagger UI Dimatikan, Tapi API Docs JSON Masih Terbuka

Blokir semua path terkait:

```text
/swagger-ui
/swagger-ui.html
/v3/api-docs
/api-docs
/openapi.json
```

### Mistake 6: Menganggap Metrics Tidak Sensitif

Metrics sering mengandung metadata internal.

### Mistake 7: IP Allowlist di Belakang Load Balancer Tanpa Real IP

Yang dilihat Nginx adalah IP load balancer, bukan client.

### Mistake 8: Menaruh Secret di Static Root

Nginx deny rule bukan alasan untuk menaruh `.env` atau key di public directory.

---

## 31. Production Checklist

Gunakan checklist ini saat review Nginx config.

### 31.1 Public Surface

- [ ] Apakah semua public path memang harus public?
- [ ] Apakah `/actuator/`, `/metrics`, `/internal/`, `/admin/`, `/debug/` ditutup?
- [ ] Apakah Swagger/OpenAPI docs sesuai environment policy?
- [ ] Apakah unknown host masuk ke safe default server?
- [ ] Apakah direct IP access ditangani?

### 31.2 IP Trust

- [ ] Apakah `$remote_addr` adalah IP yang benar?
- [ ] Apakah `set_real_ip_from` hanya berisi trusted proxy?
- [ ] Apakah spoofed `X-Forwarded-For` sudah diuji?
- [ ] Apakah IPv6 diperhitungkan?
- [ ] Apakah cloud/CDN IP ranges punya update process?

### 31.3 Auth Layer

- [ ] Basic Auth hanya dipakai untuk use case yang sesuai?
- [ ] Basic Auth selalu lewat HTTPS?
- [ ] Password file permission aman?
- [ ] Ada rotation process?
- [ ] Untuk admin penting, apakah SSO/mTLS/VPN lebih tepat?

### 31.4 Java Backend

- [ ] Backend tidak reachable langsung dari internet?
- [ ] Aplikasi tetap enforce authorization?
- [ ] Management endpoints dibatasi di aplikasi juga?
- [ ] Internal actions punya audit log?
- [ ] Domain state transition tetap divalidasi di aplikasi?

### 31.5 Observability

- [ ] Access denied tercatat?
- [ ] Log punya request ID?
- [ ] Log tidak membocorkan secret?
- [ ] Ada alert untuk spike 403/401/404 pada endpoint sensitif?
- [ ] Ada disk monitoring untuk log?

### 31.6 Testing

- [ ] Test dari network tidak trusted?
- [ ] Test dari network trusted?
- [ ] Test spoofed forwarded headers?
- [ ] Test encoded path?
- [ ] Test trailing slash?
- [ ] Test unknown host?
- [ ] Test `nginx -T` di CI/review?

---

## 32. Practical Lab

### Lab 1: Protect Actuator

Buat konfigurasi:

- `/actuator/health` hanya boleh dari load balancer subnet;
- `/actuator/prometheus` hanya boleh dari monitoring subnet;
- endpoint actuator lain ditolak semua.

Expected behavior:

```text
Public internet -> /actuator/health       => 403
Load balancer   -> /actuator/health       => 200
Monitoring      -> /actuator/prometheus   => 200
Public internet -> /actuator/prometheus   => 403
Public internet -> /actuator/env          => 403 or 404
```

### Lab 2: Test Header Spoofing

Simulasikan:

```bash
curl -i https://api.example.com/actuator/prometheus \
  -H 'X-Forwarded-For: 10.0.0.10'
```

Pastikan tidak lolos jika request bukan dari trusted proxy.

### Lab 3: Private File Download

Desain:

- Java authorize download;
- Java returns `X-Accel-Redirect`;
- Nginx serves file from internal alias;
- direct access ke internal path ditolak.

Test:

```bash
curl -i https://app.example.com/_protected_files/a.pdf
```

Expected:

```text
404 or 403
```

### Lab 4: Unknown Host

```bash
curl -i https://your-ip-address/ -H 'Host: random-attacker-domain.com'
```

Expected:

```text
444 / 404 / safe default response
```

Bukan aplikasi production.

---

## 33. Review: Mental Model yang Harus Menempel

Setelah Part 017, mental model yang harus kamu pegang:

1. **Nginx access control adalah boundary control, bukan domain authorization.**
2. **IP-based control hanya benar jika real client IP benar.**
3. **Header bisa dipalsukan kecuali datang dari trust boundary yang eksplisit.**
4. **Internal path tidak otomatis internal. Harus ditutup di Nginx dan aplikasi.**
5. **Basic Auth berguna, tapi bukan identity platform.**
6. **Metrics, actuator, docs, dan debug endpoint adalah attack surface.**
7. **Default server harus aman. Unknown host tidak boleh jatuh ke aplikasi utama.**
8. **Private file serving idealnya memakai authorization di Java dan transfer di Nginx.**
9. **Access policy harus dites seperti code.**
10. **Nginx boleh menolak request sebelum sampai ke aplikasi, tetapi aplikasi tetap wajib menjaga invariant domain.**

---

## 34. Koneksi ke Part Berikutnya

Part ini membahas access control. Part berikutnya akan memperluasnya ke security hardening secara lebih menyeluruh:

- security headers;
- request/body/header limits;
- path normalization;
- hidden file blocking lebih detail;
- upload safety;
- error page leakage;
- config integrity;
- hardening checklist.

Dengan kata lain:

```text
Part 017: Who/what may reach this path?
Part 018: How do we reduce attack surface and unsafe behavior globally?
```

---

# Status Seri

Selesai: **Part 017 dari 030**  
Belum selesai: **Part 018 sampai Part 030**

Seri **belum mencapai bagian terakhir**.

