# learn-nginx-mastery-for-java-engineers-part-024.md

# Part 024 — Nginx as Lightweight API Gateway

> Seri: `learn-nginx-mastery-for-java-engineers`  
> Bagian: `024 / 030`  
> Fokus: menggunakan Nginx sebagai API gateway ringan secara realistis, memahami batasannya, dan mendesain boundary traffic yang aman, observable, dan maintainable untuk sistem Java/backend.

---

## 0. Tujuan Pembelajaran

Setelah bagian ini, kamu diharapkan mampu:

1. Memahami perbedaan antara **reverse proxy**, **load balancer**, **edge gateway**, dan **API gateway**.
2. Menilai kapan Nginx cukup sebagai API gateway ringan dan kapan perlu API gateway khusus.
3. Mendesain routing API berdasarkan host, path, method, header, cookie, dan environment.
4. Menerapkan cross-cutting policy di Nginx secara aman:
   - TLS termination,
   - routing,
   - rate limiting,
   - request size limit,
   - header normalization,
   - CORS,
   - auth delegation,
   - observability,
   - upstream timeout,
   - error handling.
5. Menghindari anti-pattern: menjadikan Nginx sebagai tempat seluruh business logic.
6. Membuat kontrak yang jelas antara Nginx dan aplikasi Java.
7. Membangun mental model Nginx sebagai **thin deterministic traffic policy layer**, bukan full application platform.

---

## 1. Kenapa Bagian Ini Penting

Banyak tim mulai dari konfigurasi sederhana:

```nginx
location /api/ {
    proxy_pass http://backend;
}
```

Lalu perlahan-lahan konfigurasi itu tumbuh:

- tambah service baru,
- tambah versi API,
- tambah CORS,
- tambah rate limit,
- tambah Basic Auth sementara,
- tambah path internal,
- tambah redirect,
- tambah header rewrite,
- tambah canary,
- tambah auth service,
- tambah error page,
- tambah cache,
- tambah WebSocket,
- tambah gRPC,
- tambah bypass untuk partner tertentu.

Awalnya Nginx hanya reverse proxy. Lama-lama ia menjadi **gateway**.

Masalahnya bukan Nginx tidak mampu. Nginx memang umum digunakan sebagai reverse proxy, load balancer, API gateway, content cache, dan web server. Dokumentasi resmi juga menunjukkan kemampuan reverse proxy, load balancing, rate limiting, access control, JWT authentication pada NGINX Plus, dan integrasi gateway pada produk NGINX lain.

Masalahnya adalah **gateway responsibility creep**: konfigurasi Nginx menjadi tempat logika yang tidak terlihat oleh developer aplikasi, sulit dites, sulit diaudit, dan berbahaya ketika berubah.

Part ini membantu kamu membangun batas yang sehat:

> Nginx boleh menjadi API gateway ringan untuk traffic policy yang deterministic dan stateless.  
> Nginx tidak ideal menjadi tempat business workflow, authorization kompleks, entitlement matrix, atau orchestration aplikasi.

---

## 2. Istilah Dasar: Reverse Proxy vs API Gateway

### 2.1 Reverse Proxy

Reverse proxy menerima request dari client lalu meneruskannya ke upstream service.

Contoh paling sederhana:

```text
Client
  |
  v
Nginx
  |
  v
Java Backend
```

Tanggung jawab utama reverse proxy:

- menerima koneksi client,
- terminate TLS,
- meneruskan request,
- menambahkan forwarding headers,
- mengatur timeout,
- buffering,
- load balancing,
- logging.

Reverse proxy biasanya menjawab pertanyaan:

> “Request ini harus diteruskan ke backend mana dan dengan konfigurasi transport seperti apa?”

---

### 2.2 Load Balancer

Load balancer memilih salah satu dari beberapa upstream instance.

```text
Client
  |
  v
Nginx
  |----> app-1
  |----> app-2
  |----> app-3
```

Tanggung jawab utama:

- distribusi traffic,
- failover dasar,
- keepalive upstream,
- retry policy,
- health behavior,
- session affinity bila diperlukan.

Load balancer menjawab:

> “Instance mana yang paling tepat menerima request ini?”

---

### 2.3 API Gateway

API gateway adalah boundary yang memberi policy API secara terpusat.

Tanggung jawab umum API gateway:

- API routing,
- TLS termination,
- authentication delegation,
- authorization hook,
- rate limiting,
- quota,
- request validation,
- version routing,
- transformation,
- observability,
- error normalization,
- developer portal,
- API key management,
- analytics,
- monetization,
- lifecycle governance.

Nginx Open Source kuat untuk subset dari hal di atas, terutama bagian:

- routing,
- proxying,
- TLS,
- headers,
- rate limit dasar,
- connection limit,
- body size limit,
- static response,
- CORS dasar,
- auth subrequest,
- logging,
- caching,
- load balancing.

Namun Nginx Open Source bukan platform API management lengkap.

---

## 3. Mental Model: Nginx sebagai Thin Gateway

Cara sehat melihat Nginx sebagai API gateway ringan:

```text
Nginx Gateway = deterministic traffic policy engine
```

Artinya:

- input: request properties,
- policy: konfigurasi deklaratif,
- output: reject / redirect / route / proxy / respond.

Nginx cocok untuk keputusan seperti:

```text
Jika path dimulai /api/orders/ → route ke orders-service
Jika body > 10 MB → reject
Jika method OPTIONS → handle preflight
Jika IP melebihi 20 r/s → throttle
Jika missing auth header → call auth service
Jika upstream timeout → return controlled 504
Jika static asset hashed → cache 1 year
```

Nginx kurang cocok untuk keputusan seperti:

```text
Jika user adalah regional supervisor,
dan case status = escalated,
dan enforcement stage = appeal,
dan monetary threshold > X,
dan jurisdiction = Y,
maka route ke workflow Z dan transform payload berdasarkan policy exception.
```

Itu bukan traffic policy. Itu domain logic.

Untuk engineer yang bekerja di regulatory/enforcement/case-management system, batas ini sangat penting. Nginx boleh membantu menjaga boundary, tetapi **defensibility, audit, entitlement, lifecycle, dan escalation logic harus tetap berada di application/domain layer** atau policy engine yang memang bisa dites, diaudit, dan dijelaskan.

---

## 4. Kapan Nginx Cukup sebagai API Gateway Ringan

Nginx cukup ketika kebutuhanmu seperti ini:

1. Routing relatif sederhana.
2. API service sudah punya auth dan business authorization sendiri.
3. Rate limiting cukup berbasis IP, token header, API key header, atau mapped variable sederhana.
4. Tidak butuh developer portal.
5. Tidak butuh dynamic per-consumer quota kompleks.
6. Tidak butuh request/response transformation berat.
7. Tidak butuh policy lifecycle dengan approval workflow.
8. Tidak butuh plugin ecosystem besar.
9. Tim ingin komponen yang ringan, cepat, dan predictable.
10. Konfigurasi bisa diuji via CI dan diperlakukan sebagai infrastructure code.

Contoh cocok:

```text
internet
  |
  v
Nginx
  |-- /api/auth/      -> auth-service
  |-- /api/users/     -> user-service
  |-- /api/orders/    -> order-service
  |-- /api/reports/   -> report-service
  |-- /internal/*     -> blocked from public
```

Nginx di sini melakukan:

- TLS,
- routing,
- body limit,
- rate limit,
- correlation ID,
- logging,
- timeout,
- CORS,
- basic auth hook,
- common headers.

Aplikasi tetap melakukan:

- authentication verification final,
- authorization,
- business rules,
- validation domain,
- audit domain,
- data ownership checks,
- state transition rules.

---

## 5. Kapan Nginx Tidak Cukup

Pertimbangkan API gateway khusus jika kamu butuh:

1. Central API catalog.
2. Developer portal.
3. API key lifecycle management.
4. Per-client quota yang dinamis.
5. Monetization/billing.
6. Fine-grained authorization policy.
7. Dynamic routing via control plane.
8. Plugin ecosystem luas.
9. Request/response transformation kompleks.
10. OAuth/OIDC integration yang lengkap dan maintainable.
11. Multi-tenant governance.
12. API product lifecycle.
13. Audit policy changes dengan approval flow.
14. Traffic policy yang berubah sering tanpa reload static config.
15. Service mesh integration yang dalam.

Contoh situasi:

```text
Partner A punya quota 1000 r/min untuk /payments
Partner B punya quota 300 r/min hanya pada business hours
Partner C boleh akses /reports hanya untuk jurisdiction tertentu
Partner D harus melewati schema transformation v1 -> v2
Semua policy harus configurable oleh platform team via UI
```

Nginx bisa dipaksa dengan map, include, Lua/OpenResty, atau generated config. Tetapi pada titik tertentu, kamu sedang membangun API management platform sendiri.

---

## 6. Responsibility Matrix

| Concern | Cocok di Nginx | Cocok di Java App | Cocok di Dedicated Gateway |
|---|---:|---:|---:|
| TLS termination | Ya | Kadang | Ya |
| Path routing | Ya | Kadang | Ya |
| Host routing | Ya | Jarang | Ya |
| Simple header rewrite | Ya | Kadang | Ya |
| Correlation ID propagation | Ya | Ya | Ya |
| Basic rate limiting | Ya | Kadang | Ya |
| Dynamic quota per customer | Terbatas | Bisa | Ya |
| API key lifecycle | Tidak ideal | Bisa | Ya |
| JWT validation | Terbatas di OSS, kuat di Plus | Ya | Ya |
| Complex authorization | Tidak | Ya | Ya |
| Domain validation | Tidak | Ya | Tidak |
| Business workflow | Tidak | Ya | Tidak |
| Payload transformation kompleks | Tidak ideal | Ya | Ya |
| CORS boundary | Ya | Ya | Ya |
| Audit domain | Tidak | Ya | Kadang |
| Service discovery dynamic | Terbatas | Bisa | Ya |
| Developer portal | Tidak | Tidak | Ya |
| API analytics | Terbatas via logs | Ya | Ya |

Prinsip praktis:

> Jika policy bisa dijelaskan hanya dari metadata request dan tidak butuh state domain, Nginx mungkin cocok.  
> Jika policy butuh data domain, role domain, lifecycle, atau audit business, jangan taruh di Nginx.

---

## 7. Baseline API Gateway Topology

Kita mulai dengan topology yang sering dipakai untuk aplikasi Java microservices:

```text
                         +------------------+
                         |      Client      |
                         +---------+--------+
                                   |
                                   | HTTPS
                                   v
+-----------------------------------------------------------+
|                         Nginx                             |
|-----------------------------------------------------------|
| TLS | routing | rate limit | CORS | auth hook | logging    |
+---------+-------------+-------------+-------------+-------+
          |             |             |             |
          v             v             v             v
   auth-service   user-service   order-service   report-service
   Spring Boot    Spring Boot    Spring Boot     Spring Boot
```

Nginx berada di depan aplikasi dan menjadi boundary teknis. Tetapi domain ownership tetap di tiap service.

---

## 8. API Gateway Skeleton Configuration

Contoh awal:

```nginx
worker_processes auto;

error_log /var/log/nginx/error.log warn;
pid /run/nginx.pid;

events {
    worker_connections 4096;
}

http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;

    log_format api_json escape=json
        '{'
        '"time":"$time_iso8601",'
        '"remote_addr":"$remote_addr",'
        '"request_id":"$request_id",'
        '"host":"$host",'
        '"method":"$request_method",'
        '"uri":"$request_uri",'
        '"status":$status,'
        '"bytes_sent":$bytes_sent,'
        '"request_time":$request_time,'
        '"upstream_addr":"$upstream_addr",'
        '"upstream_status":"$upstream_status",'
        '"upstream_response_time":"$upstream_response_time",'
        '"http_user_agent":"$http_user_agent"'
        '}';

    access_log /var/log/nginx/access.log api_json;

    upstream auth_service {
        server auth-service:8080;
        keepalive 64;
    }

    upstream user_service {
        server user-service:8080;
        keepalive 64;
    }

    upstream order_service {
        server order-service:8080;
        keepalive 64;
    }

    upstream report_service {
        server report-service:8080;
        keepalive 32;
    }

    server {
        listen 443 ssl http2;
        server_name api.example.com;

        ssl_certificate     /etc/nginx/certs/fullchain.pem;
        ssl_certificate_key /etc/nginx/certs/privkey.pem;

        client_max_body_size 10m;

        location /api/auth/ {
            proxy_pass http://auth_service/;
            include /etc/nginx/snippets/proxy-common.conf;
        }

        location /api/users/ {
            proxy_pass http://user_service/;
            include /etc/nginx/snippets/proxy-common.conf;
        }

        location /api/orders/ {
            proxy_pass http://order_service/;
            include /etc/nginx/snippets/proxy-common.conf;
        }

        location /api/reports/ {
            proxy_pass http://report_service/;
            include /etc/nginx/snippets/proxy-common.conf;
        }
    }
}
```

Common proxy snippet:

```nginx
proxy_http_version 1.1;

proxy_set_header Host              $host;
proxy_set_header X-Request-ID      $request_id;
proxy_set_header X-Real-IP         $remote_addr;
proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host  $host;
proxy_set_header X-Forwarded-Port  $server_port;

proxy_set_header Connection "";

proxy_connect_timeout 2s;
proxy_send_timeout    30s;
proxy_read_timeout    30s;

proxy_buffering on;
```

Mental model:

```text
server block = public API surface
location block = route/policy unit
upstream block = backend pool
snippet = reusable contract
log_format = observability schema
```

---

## 9. API Surface Design

Sebelum menulis Nginx config, desain API surface dulu.

Contoh buruk:

```text
/api/user
/api/users
/api/v1/user
/api/internal-user
/user-api
/service-user
```

Masalah:

- route ambiguity,
- sulit versioning,
- sulit apply policy,
- sulit observability grouping,
- sulit migration.

Contoh lebih baik:

```text
/api/v1/auth/*
/api/v1/users/*
/api/v1/orders/*
/api/v1/reports/*
/api/v1/admin/*
```

Atau untuk service boundary yang jelas:

```text
/auth/v1/*
/users/v1/*
/orders/v1/*
/reports/v1/*
```

Pilih salah satu style, lalu konsisten.

---

## 10. Routing by Path

Path-based routing adalah pola paling umum.

```nginx
location /api/v1/users/ {
    proxy_pass http://user_service/;
    include /etc/nginx/snippets/proxy-common.conf;
}

location /api/v1/orders/ {
    proxy_pass http://order_service/;
    include /etc/nginx/snippets/proxy-common.conf;
}
```

Hati-hati trailing slash.

```nginx
location /api/v1/users/ {
    proxy_pass http://user_service/;
}
```

Request:

```text
/api/v1/users/123
```

Diteruskan sebagai:

```text
/123
```

Sementara:

```nginx
location /api/v1/users/ {
    proxy_pass http://user_service;
}
```

Diteruskan sebagai:

```text
/api/v1/users/123
```

Tidak ada yang selalu benar. Yang penting kontraknya eksplisit.

Untuk API gateway, saya biasanya menyarankan salah satu dari dua model:

### Model A — Gateway Removes External Prefix

External:

```text
/api/v1/users/123
```

Backend menerima:

```text
/123
```

Kelebihan:

- backend tidak perlu tahu public prefix,
- service path lebih bersih,
- cocok untuk service yang dipublish di beberapa prefix.

Kekurangan:

- log backend tidak langsung sama dengan public path,
- dokumentasi harus jelas,
- debugging perlu lihat Nginx log.

### Model B — Gateway Preserves External Path

External:

```text
/api/v1/users/123
```

Backend menerima:

```text
/api/v1/users/123
```

Kelebihan:

- log gateway dan backend konsisten,
- framework routing lebih eksplisit,
- mudah trace.

Kekurangan:

- backend tahu public URL structure,
- refactor public path bisa memengaruhi aplikasi.

Untuk enterprise/backoffice/regulatory system, Model B sering lebih defensible karena traceability lebih mudah. Untuk pure microservice internal, Model A sering lebih praktis.

---

## 11. Routing by Host

Host-based routing cocok ketika tiap API punya domain/subdomain sendiri.

```nginx
server {
    listen 443 ssl http2;
    server_name users-api.example.com;

    location / {
        proxy_pass http://user_service;
        include /etc/nginx/snippets/proxy-common.conf;
    }
}

server {
    listen 443 ssl http2;
    server_name orders-api.example.com;

    location / {
        proxy_pass http://order_service;
        include /etc/nginx/snippets/proxy-common.conf;
    }
}
```

Kelebihan:

- isolation jelas,
- certificate/SNI bisa dipisah,
- policy per API lebih rapi,
- ownership lebih jelas.

Kekurangan:

- domain management lebih banyak,
- client integration lebih kompleks,
- CORS bisa lebih sering muncul bila frontend berbeda origin.

---

## 12. Routing by Header

Header-based routing berguna untuk canary, internal client, atau version negotiation.

Contoh dengan `map`:

```nginx
map $http_x_api_version $orders_upstream {
    default order_service_v1;
    "2"     order_service_v2;
}

upstream order_service_v1 {
    server order-v1:8080;
}

upstream order_service_v2 {
    server order-v2:8080;
}

server {
    listen 443 ssl http2;
    server_name api.example.com;

    location /api/orders/ {
        proxy_pass http://$orders_upstream;
        include /etc/nginx/snippets/proxy-common.conf;
    }
}
```

Namun ada konsekuensi penting:

- variable dalam `proxy_pass` dapat mengubah DNS/resolution behavior,
- observability harus mencatat upstream target,
- fallback `default` harus aman,
- jangan menjadikan header client yang mudah dipalsukan sebagai basis security.

Header routing cocok untuk traffic shaping, bukan trust decision.

---

## 13. Routing by Cookie

Cookie-based routing sering dipakai untuk canary atau sticky experience.

```nginx
map $cookie_canary $orders_upstream {
    default order_service_stable;
    "true"  order_service_canary;
}

location /api/orders/ {
    proxy_pass http://$orders_upstream;
    include /etc/nginx/snippets/proxy-common.conf;
}
```

Gunakan untuk:

- internal beta users,
- canary manual,
- gradual migration,
- debugging specific client.

Jangan gunakan untuk authorization.

Cookie dari client bisa dimanipulasi kecuali ditandatangani dan diverifikasi oleh komponen yang tepat.

---

## 14. Routing by Method

Kadang policy berbeda berdasarkan HTTP method.

Contoh: `GET` ke reports boleh cache/rate limit lebih longgar, `POST` lebih ketat.

```nginx
map $request_method $write_request {
    default 0;
    POST    1;
    PUT     1;
    PATCH   1;
    DELETE  1;
}
```

Namun jangan berlebihan memakai `if` di `location`. Di Nginx, `if` memiliki banyak nuansa dan bisa membuat config sulit dipahami.

Lebih baik gunakan:

- `limit_except` untuk access control method sederhana,
- `map` untuk variable derivation,
- separate locations bila path jelas,
- application-level method validation untuk domain behavior.

Contoh membatasi method:

```nginx
location /api/v1/reports/export/ {
    limit_except GET POST {
        deny all;
    }

    proxy_pass http://report_service;
    include /etc/nginx/snippets/proxy-common.conf;
}
```

---

## 15. API Versioning di Gateway

Nginx bisa membantu version routing:

```nginx
location /api/v1/orders/ {
    proxy_pass http://order_service_v1;
    include /etc/nginx/snippets/proxy-common.conf;
}

location /api/v2/orders/ {
    proxy_pass http://order_service_v2;
    include /etc/nginx/snippets/proxy-common.conf;
}
```

Namun gateway jangan menjadi tempat transformasi versi kompleks.

Contoh yang masih wajar:

```text
/api/v1/orders -> order-v1
/api/v2/orders -> order-v2
```

Contoh yang mulai berbahaya:

```text
Gateway menerima v1 payload,
mengubah field A ke B,
mengubah enum X ke Y,
menghapus field internal,
lalu memanggil service v2.
```

Itu seharusnya berada di:

- compatibility layer aplikasi,
- adapter service,
- BFF,
- dedicated transformation gateway.

---

## 16. Request Header Normalization

Gateway sering menjadi tempat normalisasi header.

Contoh common snippet:

```nginx
proxy_set_header Host              $host;
proxy_set_header X-Request-ID      $request_id;
proxy_set_header X-Real-IP         $remote_addr;
proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host  $host;
proxy_set_header X-Forwarded-Port  $server_port;
```

Tambahan untuk API gateway:

```nginx
proxy_set_header X-Gateway-Name    "edge-nginx";
proxy_set_header X-Gateway-Route   "orders-v1";
```

Tetapi hati-hati:

```nginx
proxy_set_header X-User-Id $http_x_user_id;
```

Ini berbahaya jika header berasal dari client dan dianggap trusted oleh backend.

Rule:

> Header identitas tidak boleh diteruskan mentah dari client sebagai trusted identity.

Jika ada identity header ke backend, sumbernya harus:

- auth service,
- mTLS verified client cert,
- trusted identity provider,
- gateway yang benar-benar melakukan verification.

---

## 17. Blocking Spoofed Internal Headers

Client bisa mengirim header seperti:

```text
X-User-Id: admin
X-Role: superuser
X-Forwarded-For: 127.0.0.1
X-Internal-Request: true
```

Jika backend percaya begitu saja, sistem rentan.

Gateway harus menormalisasi atau menghapus header internal.

Nginx Open Source tidak memiliki directive universal `proxy_hide_request_header`, tetapi kamu bisa override header yang diteruskan ke upstream:

```nginx
proxy_set_header X-User-Id "";
proxy_set_header X-Role "";
proxy_set_header X-Internal-Request "";
```

Lebih baik gunakan naming convention:

```text
Client-provided headers:
  Authorization
  X-Request-ID
  X-Client-Version

Gateway-generated trusted headers:
  X-Gateway-Authenticated-User
  X-Gateway-Auth-Scope
  X-Gateway-Verified-Client
```

Dan pastikan backend hanya mempercayai gateway-generated headers jika request datang dari trusted network.

---

## 18. Authentication Pattern: Delegate with `auth_request`

Nginx Open Source dapat menggunakan subrequest authentication dengan `auth_request` module.

Topology:

```text
Client request /api/orders/123
        |
        v
Nginx performs subrequest /_auth
        |
        v
Auth service validates token/session
        |
        v
If 2xx -> proxy to order service
If 401/403 -> reject
```

Contoh:

```nginx
location = /_auth {
    internal;

    proxy_pass http://auth_service/validate;
    proxy_pass_request_body off;
    proxy_set_header Content-Length "";

    proxy_set_header Authorization $http_authorization;
    proxy_set_header X-Original-URI $request_uri;
    proxy_set_header X-Original-Method $request_method;
    proxy_set_header X-Request-ID $request_id;
}

location /api/orders/ {
    auth_request /_auth;

    proxy_pass http://order_service;
    include /etc/nginx/snippets/proxy-common.conf;
}
```

Auth service contract:

```text
2xx  -> authenticated
401  -> unauthenticated
403  -> authenticated but forbidden, if auth service owns that decision
5xx  -> auth system unavailable
```

Untuk banyak sistem, saya menyarankan:

- Nginx/auth service hanya memutuskan **authentication** atau coarse access,
- aplikasi tetap memutuskan **authorization domain**.

Contoh:

```text
Gateway: token valid? client boleh masuk API orders?
App: user boleh melihat order ID 123? jurisdiction cocok? state transition valid?
```

---

## 19. Passing Identity from Auth Subrequest

`auth_request_set` dapat mengambil response header dari auth subrequest.

```nginx
location /api/orders/ {
    auth_request /_auth;

    auth_request_set $auth_user  $upstream_http_x_auth_user;
    auth_request_set $auth_scope $upstream_http_x_auth_scope;

    proxy_set_header X-Authenticated-User  $auth_user;
    proxy_set_header X-Authenticated-Scope $auth_scope;

    proxy_pass http://order_service;
    include /etc/nginx/snippets/proxy-common.conf;
}
```

Auth service response:

```text
HTTP/1.1 204 No Content
X-Auth-User: user-123
X-Auth-Scope: orders:read orders:write
```

Risiko:

- identity header kosong,
- auth service mengembalikan header yang tidak tervalidasi,
- backend menerima request langsung tanpa gateway,
- stale auth cache,
- header size terlalu besar,
- scope string terlalu kompleks.

Prinsip:

> Identity propagation harus dianggap sebagai security contract, bukan convenience header.

---

## 20. JWT Validation: Open Source vs Plus vs App

Nginx Plus memiliki fitur JWT authentication resmi. Nginx Open Source tidak punya built-in JWT validation setara tanpa module tambahan, Lua/OpenResty, atau auth subrequest.

Opsi desain:

### Opsi A — Validate JWT di Java App

```text
Nginx hanya proxy Authorization header
Java app validate token
```

Kelebihan:

- paling fleksibel,
- library matang,
- policy dekat dengan domain,
- mudah dites.

Kekurangan:

- semua request sampai ke app,
- logic duplikat jika banyak service,
- app harus tahan auth traffic.

### Opsi B — Validate JWT via Auth Service + `auth_request`

```text
Nginx subrequest ke auth-service
Auth-service validate JWT
Nginx route jika valid
```

Kelebihan:

- central validation,
- works with Nginx Open Source,
- app bisa fokus domain authz.

Kekurangan:

- auth service jadi critical path,
- perlu timeout/cache/failure policy,
- tambahan network hop.

### Opsi C — NGINX Plus JWT

```text
Nginx Plus validate JWT at gateway
```

Kelebihan:

- fast gateway-level validation,
- fitur enterprise,
- cocok untuk standardized API gateway.

Kekurangan:

- commercial dependency,
- tetap perlu domain authorization di app.

### Opsi D — OpenResty/Lua

```text
Nginx + Lua validate JWT/custom policy
```

Kelebihan:

- fleksibel,
- bisa custom.

Kekurangan:

- runtime lebih kompleks,
- logic tersebar,
- testing dan ownership lebih berat,
- bisa berubah menjadi platform buatan sendiri.

Untuk kebanyakan Java backend team, opsi A atau B paling maintainable.

---

## 21. Authorization: Jangan Taruh Domain Decision di Nginx

Contoh authorization yang tidak cocok di Nginx:

```text
User boleh approve case jika:
- role = enforcement_lead,
- case.region = user's assigned region,
- case.status = pending_approval,
- violation.severity >= high,
- appeal window expired,
- no active conflict of interest,
- regulator policy version applies.
```

Nginx tidak punya konteks domain itu. Bisa dipaksa memanggil auth service, tetapi hasil akhirnya tetap harus diaudit dan diuji di domain layer.

Nginx boleh memutuskan:

```text
/api/admin/* hanya boleh jika auth service menyatakan user punya coarse scope admin:access
```

Aplikasi harus memutuskan:

```text
Admin ini boleh melakukan aksi ini terhadap entity ini pada state ini?
```

---

## 22. Rate Limiting sebagai Gateway Policy

Nginx cocok untuk rate limiting dasar.

Contoh per IP:

```nginx
limit_req_zone $binary_remote_addr zone=per_ip_api:10m rate=10r/s;

server {
    location /api/ {
        limit_req zone=per_ip_api burst=20 nodelay;

        proxy_pass http://api_backend;
        include /etc/nginx/snippets/proxy-common.conf;
    }
}
```

Contoh per Authorization header hash tidak langsung tersedia sebagai hash aman bawaan, tetapi bisa menggunakan variable sebagai key:

```nginx
map $http_authorization $rate_key {
    default $http_authorization;
    ""      $binary_remote_addr;
}

limit_req_zone $rate_key zone=per_token_api:20m rate=30r/s;
```

Namun hati-hati:

- Authorization header panjang bisa boros memory,
- token rotation memengaruhi quota,
- token mentah di memory/log berisiko,
- lebih baik rate limit by client ID jika tersedia dari trusted auth result.

Dengan `auth_request`, flow menjadi lebih rumit karena `limit_req` dievaluasi pada fase tertentu. Untuk quota kompleks per user/client, dedicated gateway atau application-level quota lebih aman.

---

## 23. Layered Rate Limiting

Pola yang lebih sehat:

```text
Layer 1 - Nginx coarse protection:
  per IP, per endpoint group, burst control

Layer 2 - Auth/API platform:
  per client/app/token quota

Layer 3 - Application/domain:
  expensive action limit, workflow-aware restriction
```

Contoh:

```nginx
limit_req_zone $binary_remote_addr zone=public_api_ip:10m rate=20r/s;
limit_req_zone $binary_remote_addr zone=login_ip:10m rate=5r/m;

location /api/login {
    limit_req zone=login_ip burst=5 nodelay;
    proxy_pass http://auth_service;
    include /etc/nginx/snippets/proxy-common.conf;
}

location /api/ {
    limit_req zone=public_api_ip burst=40;
    proxy_pass http://api_backend;
    include /etc/nginx/snippets/proxy-common.conf;
}
```

Jangan samakan semua endpoint.

Endpoint mahal seperti:

- login,
- password reset,
- report export,
- search berat,
- file upload,
- AI/inference,
- bulk processing,

harus punya policy lebih ketat daripada endpoint ringan.

---

## 24. Request Body Limit

Gateway harus melindungi backend dari payload berlebihan.

```nginx
server {
    client_max_body_size 10m;

    location /api/uploads/ {
        client_max_body_size 100m;
        proxy_pass http://upload_service;
        include /etc/nginx/snippets/proxy-common.conf;
    }
}
```

Prinsip:

- default kecil,
- exception eksplisit,
- upload route dipisah,
- backend tetap validasi,
- observability untuk 413.

Failure mode:

```text
Frontend upload 50 MB
Nginx default 1 MB atau 10 MB
Response 413
Backend tidak melihat request
Developer backend bingung karena tidak ada log aplikasi
```

Solusi:

- dokumentasikan gateway limits,
- log 413,
- return error body konsisten,
- sinkronkan limit frontend/backend/gateway.

---

## 25. Timeout Policy per API Class

Tidak semua API harus punya timeout sama.

Contoh klasifikasi:

| API Class | Contoh | Timeout |
|---|---|---:|
| interactive read | user profile | 2-5s |
| normal write | create order | 5-15s |
| report generation | export | 30-120s |
| streaming | SSE/WebSocket | minutes/hours |
| internal callback | webhook | 5-30s |

Config:

```nginx
location /api/users/ {
    proxy_connect_timeout 1s;
    proxy_read_timeout 5s;
    proxy_send_timeout 5s;

    proxy_pass http://user_service;
    include /etc/nginx/snippets/proxy-common.conf;
}

location /api/reports/export/ {
    proxy_connect_timeout 2s;
    proxy_read_timeout 120s;
    proxy_send_timeout 120s;

    proxy_pass http://report_service;
    include /etc/nginx/snippets/proxy-common.conf;
}
```

Jangan gunakan satu timeout besar untuk semua endpoint. Itu menyembunyikan failure dan memperlambat recovery.

---

## 26. CORS di Gateway

CORS bisa ditangani di aplikasi atau gateway. Jika banyak service berada di belakang satu domain API, gateway bisa jadi tempat yang baik.

Namun CORS sangat mudah salah.

Contoh controlled CORS dengan `map`:

```nginx
map $http_origin $cors_origin {
    default "";
    "https://app.example.com"   $http_origin;
    "https://admin.example.com" $http_origin;
}
```

Server/location:

```nginx
location /api/ {
    if ($request_method = OPTIONS) {
        add_header Access-Control-Allow-Origin $cors_origin always;
        add_header Access-Control-Allow-Methods "GET, POST, PUT, PATCH, DELETE, OPTIONS" always;
        add_header Access-Control-Allow-Headers "Authorization, Content-Type, X-Request-ID" always;
        add_header Access-Control-Allow-Credentials "true" always;
        add_header Access-Control-Max-Age 600 always;
        return 204;
    }

    add_header Access-Control-Allow-Origin $cors_origin always;
    add_header Access-Control-Allow-Credentials "true" always;

    proxy_pass http://api_backend;
    include /etc/nginx/snippets/proxy-common.conf;
}
```

Catatan penting:

- Jangan gunakan `*` dengan credentials.
- Jangan reflect semua origin tanpa allowlist.
- Preflight harus konsisten dengan actual response.
- Error response juga perlu CORS header jika ingin browser bisa membaca status.
- CORS bukan authentication/authorization.

---

## 27. Error Normalization

API gateway sering ingin error response konsisten.

Contoh:

```nginx
proxy_intercept_errors on;

error_page 502 503 504 /_gateway_error;

location = /_gateway_error {
    internal;
    default_type application/json;
    return 503 '{"error":"service_unavailable","request_id":"$request_id"}';
}
```

Kelebihan:

- client dapat format konsisten,
- request ID selalu tersedia,
- upstream detail tidak bocor.

Risiko:

- status asli hilang,
- error domain dari aplikasi tertimpa,
- debugging sulit jika terlalu agresif.

Gunakan untuk error gateway/upstream, bukan untuk semua error aplikasi.

Jangan intercept 400/401/403/404 dari aplikasi tanpa alasan kuat.

---

## 28. API Gateway Logging Schema

Sebagai gateway, Nginx harus menghasilkan log yang bisa menjawab:

1. Request dari siapa?
2. Route mana?
3. Upstream mana?
4. Berapa latency total?
5. Berapa latency upstream?
6. Status dari gateway atau upstream?
7. Apakah rate limited?
8. Apakah auth gagal?
9. Request ID apa?
10. Versi route mana?

Contoh log format:

```nginx
log_format api_json escape=json
    '{'
    '"time":"$time_iso8601",'
    '"request_id":"$request_id",'
    '"remote_addr":"$remote_addr",'
    '"xff":"$http_x_forwarded_for",'
    '"host":"$host",'
    '"method":"$request_method",'
    '"uri":"$request_uri",'
    '"route":"$gateway_route",'
    '"status":$status,'
    '"request_time":$request_time,'
    '"upstream_addr":"$upstream_addr",'
    '"upstream_status":"$upstream_status",'
    '"upstream_response_time":"$upstream_response_time",'
    '"body_bytes_sent":$body_bytes_sent,'
    '"user_agent":"$http_user_agent"'
    '}';
```

`$gateway_route` bisa dibuat via `map`:

```nginx
map $uri $gateway_route {
    default "unknown";
    ~^/api/v1/users/   "users-v1";
    ~^/api/v1/orders/  "orders-v1";
    ~^/api/v1/reports/ "reports-v1";
}
```

---

## 29. Gateway Route Metadata

Untuk production, setiap route harus punya metadata minimal:

```text
Route ID: orders-v1
External path: /api/v1/orders/
Upstream: order_service
Owner: Order Platform Team
Auth: required
Rate limit: 30 r/s per IP, app quota in service
Timeout: connect 1s, read 10s
Max body: 2 MB
CORS: app.example.com only
SLO: p95 < 300 ms for read, p95 < 800 ms for write
Runbook: link
```

Kamu bisa menyimpannya sebagai komentar dekat config atau sebagai YAML/source-of-truth yang menghasilkan config.

Contoh komentar config:

```nginx
# Route ID: orders-v1
# Owner: Order Platform Team
# Auth: required via /_auth
# Timeout: 10s
# Body limit: 2m
location /api/v1/orders/ {
    auth_request /_auth;
    client_max_body_size 2m;
    proxy_read_timeout 10s;
    proxy_pass http://order_service;
    include /etc/nginx/snippets/proxy-common.conf;
}
```

Komentar bukan enforcement, tapi membantu review dan audit.

---

## 30. Caching di API Gateway

Nginx bisa cache API response, tetapi harus sangat hati-hati.

Cocok untuk:

- public metadata,
- static lookup,
- configuration catalog,
- feature flag public snapshot,
- unauthenticated content,
- expensive read-only endpoint yang tidak user-specific.

Berisiko untuk:

- personalized data,
- authorization-dependent response,
- financial/regulatory case data,
- admin response,
- anything with cookies or bearer tokens.

Contoh safe-ish public cache:

```nginx
proxy_cache_path /var/cache/nginx/api levels=1:2 keys_zone=api_cache:100m max_size=1g inactive=10m;

location /api/v1/public/catalog/ {
    proxy_cache api_cache;
    proxy_cache_valid 200 5m;
    proxy_cache_lock on;
    proxy_cache_use_stale error timeout updating http_500 http_502 http_503 http_504;

    add_header X-Cache-Status $upstream_cache_status always;

    proxy_pass http://catalog_service;
    include /etc/nginx/snippets/proxy-common.conf;
}
```

Avoid caching when:

```nginx
proxy_no_cache $http_authorization $cookie_session;
proxy_cache_bypass $http_authorization $cookie_session;
```

Mental model:

> API cache is a data exposure boundary. Treat cache key design like security design.

---

## 31. Service Discovery and Dynamic Upstreams

Nginx Open Source upstreams are mostly static unless using DNS resolution patterns carefully.

Static upstream:

```nginx
upstream order_service {
    server order-1:8080;
    server order-2:8080;
}
```

DNS name:

```nginx
upstream order_service {
    server order-service:8080;
}
```

In container/Kubernetes environments, service discovery is often handled by:

- Kubernetes Service,
- Docker DNS,
- cloud load balancer,
- service mesh sidecar,
- generated Nginx config,
- ingress controller.

Jika kamu butuh dynamic discovery, active health checks, runtime config API, dan sophisticated traffic policy, Nginx Open Source static config mungkin mulai terasa terbatas.

---

## 32. Gateway Config Organization

Untuk API gateway ringan, struktur config harus rapi sejak awal.

Contoh:

```text
/etc/nginx/
  nginx.conf
  conf.d/
    00-maps.conf
    10-upstreams.conf
    20-api.example.com.conf
  snippets/
    proxy-common.conf
    cors-api.conf
    security-headers.conf
    auth-required.conf
    rate-limit-zones.conf
  routes/
    orders-v1.conf
    users-v1.conf
    reports-v1.conf
```

Root config:

```nginx
http {
    include /etc/nginx/mime.types;

    include /etc/nginx/conf.d/00-maps.conf;
    include /etc/nginx/snippets/rate-limit-zones.conf;
    include /etc/nginx/conf.d/10-upstreams.conf;
    include /etc/nginx/conf.d/*.conf;
}
```

Server:

```nginx
server {
    listen 443 ssl http2;
    server_name api.example.com;

    include /etc/nginx/snippets/security-headers.conf;

    include /etc/nginx/routes/users-v1.conf;
    include /etc/nginx/routes/orders-v1.conf;
    include /etc/nginx/routes/reports-v1.conf;
}
```

Route file:

```nginx
location /api/v1/orders/ {
    include /etc/nginx/snippets/auth-required.conf;
    limit_req zone=public_api_ip burst=40;
    client_max_body_size 2m;

    proxy_pass http://order_service;
    include /etc/nginx/snippets/proxy-common.conf;
}
```

Keuntungan:

- route ownership jelas,
- review lebih mudah,
- conflict lebih terlihat,
- reusable policy,
- CI validation lebih sederhana.

Risiko:

- include order tersembunyi,
- duplicate location sulit dilihat,
- snippet side effect.

Wajib gunakan:

```bash
nginx -T
```

untuk melihat effective config.

---

## 33. Avoiding Gateway Spaghetti

Tanda konfigurasi gateway mulai spaghetti:

1. Banyak `if` di `location`.
2. `map` terlalu banyak dan saling bergantung.
3. Route behavior tidak bisa dijelaskan tanpa membaca 10 file.
4. Header security tersebar di banyak tempat.
5. Auth diterapkan tidak konsisten.
6. Ada copy-paste config antar service.
7. Tidak ada route inventory.
8. Tidak ada test config.
9. Nginx config mengandung nama role/domain state.
10. Developer aplikasi tidak tahu policy gateway.

Cara memperbaiki:

- buat route inventory,
- buat reusable snippets,
- batasi jumlah policy primitive,
- pindahkan domain logic ke app,
- buat CI test,
- dokumentasikan ownership,
- gunakan generated config bila route banyak.

---

## 34. API Gateway Testing Strategy

Nginx config harus dites seperti kode.

### 34.1 Syntax Test

```bash
nginx -t -c /etc/nginx/nginx.conf
```

### 34.2 Effective Config Snapshot

```bash
nginx -T > effective-nginx.conf
```

Gunakan untuk review:

- include order,
- duplicate server,
- duplicate location,
- inherited directives,
- accidental default.

### 34.3 Route Contract Test

Contoh test dengan `curl`:

```bash
curl -i https://api.example.com/api/v1/orders/123 \
  -H 'Authorization: Bearer test-token' \
  -H 'X-Request-ID: test-001'
```

Periksa:

- status,
- upstream route,
- CORS header,
- request ID,
- timeout behavior,
- auth behavior,
- body limit behavior.

### 34.4 Negative Test

Test yang sering dilupakan:

```text
Unknown host -> blocked
Unknown path -> 404 controlled
Missing auth -> 401
Invalid auth -> 401
No privilege -> 403 if gateway owns coarse check
Large body -> 413
Unsupported method -> 405/403 depending design
CORS disallowed origin -> no allow-origin
Rate exceeded -> 429
Upstream down -> controlled 502/503/504
```

### 34.5 Integration Test with Dummy Upstream

Gunakan echo server untuk melihat request yang benar-benar sampai ke upstream.

Contoh dengan container echo service:

```text
Client -> Nginx -> echo-server
```

Validasi:

- path rewritten atau preserved,
- headers benar,
- body diteruskan,
- Host benar,
- X-Forwarded-* benar,
- request ID benar.

---

## 35. Example: Production-Oriented Lightweight API Gateway

Berikut contoh lebih lengkap.

### 35.1 `nginx.conf`

```nginx
worker_processes auto;

error_log /var/log/nginx/error.log warn;
pid /run/nginx.pid;

events {
    worker_connections 8192;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    server_tokens off;

    include /etc/nginx/conf.d/maps.conf;
    include /etc/nginx/conf.d/logging.conf;
    include /etc/nginx/conf.d/rate-limits.conf;
    include /etc/nginx/conf.d/upstreams.conf;

    access_log /var/log/nginx/access.log api_json;

    keepalive_timeout 30s;
    client_body_timeout 15s;
    client_header_timeout 10s;
    send_timeout 30s;

    include /etc/nginx/conf.d/servers/*.conf;
}
```

### 35.2 `maps.conf`

```nginx
map $http_origin $cors_origin {
    default "";
    "https://app.example.com"   $http_origin;
    "https://admin.example.com" $http_origin;
}

map $uri $gateway_route {
    default "unknown";
    ~^/api/v1/auth/    "auth-v1";
    ~^/api/v1/users/   "users-v1";
    ~^/api/v1/orders/  "orders-v1";
    ~^/api/v1/reports/ "reports-v1";
}
```

### 35.3 `logging.conf`

```nginx
log_format api_json escape=json
    '{'
    '"time":"$time_iso8601",'
    '"request_id":"$request_id",'
    '"remote_addr":"$remote_addr",'
    '"host":"$host",'
    '"method":"$request_method",'
    '"uri":"$request_uri",'
    '"route":"$gateway_route",'
    '"status":$status,'
    '"request_time":$request_time,'
    '"upstream_addr":"$upstream_addr",'
    '"upstream_status":"$upstream_status",'
    '"upstream_response_time":"$upstream_response_time",'
    '"cache":"$upstream_cache_status",'
    '"user_agent":"$http_user_agent"'
    '}';
```

### 35.4 `rate-limits.conf`

```nginx
limit_req_zone $binary_remote_addr zone=public_api_ip:20m rate=20r/s;
limit_req_zone $binary_remote_addr zone=login_ip:10m rate=5r/m;
limit_conn_zone $binary_remote_addr zone=conn_per_ip:10m;
```

### 35.5 `upstreams.conf`

```nginx
upstream auth_service {
    server auth-service:8080;
    keepalive 64;
}

upstream user_service {
    server user-service:8080;
    keepalive 64;
}

upstream order_service {
    server order-service:8080;
    keepalive 64;
}

upstream report_service {
    server report-service:8080;
    keepalive 32;
}
```

### 35.6 `servers/api.example.com.conf`

```nginx
server {
    listen 80;
    server_name api.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.example.com;

    ssl_certificate     /etc/nginx/certs/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/privkey.pem;

    client_max_body_size 2m;
    limit_conn conn_per_ip 50;

    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy no-referrer always;

    location = /_auth {
        internal;
        proxy_pass http://auth_service/validate;
        proxy_pass_request_body off;
        proxy_set_header Content-Length "";
        proxy_set_header Authorization $http_authorization;
        proxy_set_header X-Original-URI $request_uri;
        proxy_set_header X-Original-Method $request_method;
        proxy_set_header X-Request-ID $request_id;
    }

    location /api/v1/auth/login {
        limit_req zone=login_ip burst=5 nodelay;
        proxy_pass http://auth_service;
        include /etc/nginx/snippets/proxy-common.conf;
    }

    location /api/v1/users/ {
        auth_request /_auth;
        limit_req zone=public_api_ip burst=40;
        proxy_read_timeout 10s;
        proxy_pass http://user_service;
        include /etc/nginx/snippets/proxy-common.conf;
        include /etc/nginx/snippets/cors-api.conf;
    }

    location /api/v1/orders/ {
        auth_request /_auth;
        limit_req zone=public_api_ip burst=40;
        proxy_read_timeout 15s;
        proxy_pass http://order_service;
        include /etc/nginx/snippets/proxy-common.conf;
        include /etc/nginx/snippets/cors-api.conf;
    }

    location /api/v1/reports/export/ {
        auth_request /_auth;
        limit_req zone=public_api_ip burst=10;
        client_max_body_size 1m;
        proxy_read_timeout 120s;
        proxy_pass http://report_service;
        include /etc/nginx/snippets/proxy-common.conf;
        include /etc/nginx/snippets/cors-api.conf;
    }

    location /api/v1/reports/ {
        auth_request /_auth;
        limit_req zone=public_api_ip burst=20;
        proxy_read_timeout 30s;
        proxy_pass http://report_service;
        include /etc/nginx/snippets/proxy-common.conf;
        include /etc/nginx/snippets/cors-api.conf;
    }

    location / {
        default_type application/json;
        return 404 '{"error":"not_found","request_id":"$request_id"}';
    }
}
```

### 35.7 `snippets/proxy-common.conf`

```nginx
proxy_http_version 1.1;

proxy_set_header Host              $host;
proxy_set_header X-Request-ID      $request_id;
proxy_set_header X-Real-IP         $remote_addr;
proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host  $host;
proxy_set_header X-Forwarded-Port  $server_port;
proxy_set_header X-Gateway-Route   $gateway_route;

proxy_set_header X-User-Id "";
proxy_set_header X-Role "";
proxy_set_header X-Internal-Request "";

proxy_set_header Connection "";

proxy_connect_timeout 2s;
proxy_send_timeout 30s;
proxy_read_timeout 30s;

proxy_buffering on;
```

### 35.8 `snippets/cors-api.conf`

```nginx
if ($request_method = OPTIONS) {
    add_header Access-Control-Allow-Origin $cors_origin always;
    add_header Access-Control-Allow-Methods "GET, POST, PUT, PATCH, DELETE, OPTIONS" always;
    add_header Access-Control-Allow-Headers "Authorization, Content-Type, X-Request-ID" always;
    add_header Access-Control-Allow-Credentials "true" always;
    add_header Access-Control-Max-Age 600 always;
    return 204;
}

add_header Access-Control-Allow-Origin $cors_origin always;
add_header Access-Control-Allow-Credentials "true" always;
```

Catatan: contoh CORS ini cukup untuk pembelajaran, tetapi di production kamu perlu test detail untuk disallowed origin agar tidak menghasilkan header kosong yang membingungkan client. Pada beberapa setup, lebih baik pisahkan preflight handling di location khusus atau handle CORS di aplikasi jika policy sangat domain-specific.

---

## 36. Integration with Spring Boot

Jika Spring Boot berada di belakang Nginx gateway, perhatikan:

### 36.1 Forwarded Headers

Spring Boot perlu tahu scheme/host asli jika membuat redirect, absolute URL, atau security cookie.

Di gateway:

```nginx
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host  $host;
proxy_set_header X-Forwarded-Port  $server_port;
```

Di Spring Boot, konfigurasi tergantung versi dan deployment, tetapi konsepnya:

```properties
server.forward-headers-strategy=framework
```

atau gunakan dukungan container/framework yang sesuai.

### 36.2 Trusted Proxy Boundary

Backend harus hanya menerima forwarded headers dari Nginx/trusted proxy, bukan dari internet langsung.

Network design:

```text
Internet -> Nginx -> private network -> Java app
```

Jangan expose Java app langsung ke public internet jika app percaya header gateway.

### 36.3 Correlation ID

Nginx:

```nginx
proxy_set_header X-Request-ID $request_id;
```

Spring filter/interceptor:

```text
Read X-Request-ID
Put into MDC
Include in logs
Return in response header
```

### 36.4 Auth Header

Jika Nginx hanya meneruskan `Authorization`, Spring Security tetap validate token.

Jika Nginx/auth service menghasilkan identity header, Spring app harus:

- memastikan request dari trusted gateway,
- reject direct access,
- validate header presence/format,
- log identity source,
- tidak mencampur trusted dan untrusted identity headers.

---

## 37. API Gateway vs BFF

Nginx API gateway bukan Backend-for-Frontend.

### API Gateway

Fokus:

- transport,
- routing,
- security boundary,
- rate limit,
- auth hook,
- logging,
- traffic policy.

### BFF

Fokus:

- compose data untuk frontend tertentu,
- adapt response shape,
- orchestrate multiple service calls,
- hide backend complexity,
- session/frontend-specific behavior.

Jika kamu butuh:

```text
GET /dashboard
  -> call user service
  -> call case service
  -> call notification service
  -> merge response
  -> apply UI-specific projection
```

Itu BFF, bukan Nginx config.

---

## 38. API Gateway vs Service Mesh Ingress

Service mesh ingress seperti Envoy/Istio/Linkerd ecosystem memberi kemampuan yang berbeda:

- mTLS service-to-service,
- traffic splitting control plane,
- retries/circuit breaking policy,
- distributed telemetry,
- identity-based service communication,
- dynamic config.

Nginx cocok jika:

- edge gateway sederhana,
- konfigurasi static cukup,
- tim ingin operasional ringan,
- tidak butuh mesh-wide identity.

Service mesh cocok jika:

- banyak service,
- inter-service policy kompleks,
- zero-trust internal network,
- dynamic routing across cluster,
- platform team siap mengelola kompleksitas.

---

## 39. API Gateway vs Spring Cloud Gateway

Spring Cloud Gateway cocok jika tim Java ingin gateway yang programmable di JVM ecosystem.

Perbandingan praktis:

| Aspek | Nginx | Spring Cloud Gateway |
|---|---|---|
| Runtime | native/event-driven | JVM/Reactor Netty |
| Config style | declarative Nginx config | Java/YAML/routes/filters |
| Static file/TLS/reverse proxy | Sangat kuat | Bisa, bukan fokus utama |
| Custom business-ish filter | Tidak ideal | Lebih mudah |
| Java ecosystem integration | Indirect | Sangat baik |
| Resource footprint | Ringan | Lebih berat |
| Dynamic route logic | Terbatas | Lebih fleksibel |
| Operational simplicity | Tinggi jika sederhana | Tinggi untuk Java teams |
| Risk | config spaghetti | gateway becomes app spaghetti |

Rule:

- gunakan Nginx untuk edge traffic policy yang sederhana dan cepat,
- gunakan Spring Cloud Gateway jika gateway perlu logic yang dekat dengan Java ecosystem,
- jangan jadikan Spring Cloud Gateway tempat business domain juga.

---

## 40. API Gateway vs Kong/Envoy/Apigee/AWS API Gateway

Dedicated gateway lebih cocok jika kamu butuh API management.

| Need | Nginx OSS | Dedicated Gateway |
|---|---:|---:|
| Simple routing | Ya | Ya |
| TLS | Ya | Ya |
| Basic rate limit | Ya | Ya |
| Plugin marketplace | Tidak | Ya |
| API key management | Tidak built-in | Ya |
| Developer portal | Tidak | Ya |
| Per-consumer analytics | Manual | Ya |
| Dynamic admin API | Terbatas | Ya |
| Complex auth integration | Manual/Plus | Ya |
| Policy governance | Manual | Ya |

Jika API adalah produk eksternal untuk banyak partner, dedicated gateway sering lebih masuk akal.

Jika API hanya internal/external sederhana untuk satu platform, Nginx bisa sangat cukup.

---

## 41. Failure Modes

### 41.1 Auth Service Down

Flow:

```text
Client -> Nginx -> auth_request -> auth service down
```

Kemungkinan hasil:

- semua protected API gagal,
- 500/502 dari auth subrequest,
- client melihat outage total.

Mitigasi:

- auth service highly available,
- timeout kecil,
- clear error response,
- alert on auth upstream error,
- jangan cache auth sembarangan kecuali benar-benar dipahami.

---

### 41.2 Wrong Route Match

Gejala:

```text
/api/v1/orders/export masuk ke /api/v1/orders/ umum
bukan route export khusus
```

Penyebab:

- location order/matching salah,
- regex override,
- include order tidak jelas.

Mitigasi:

- gunakan exact/prefix dengan jelas,
- test route matrix,
- inspect `nginx -T`,
- log `$gateway_route`.

---

### 41.3 CORS Works for Success but Fails for Error

Gejala:

- 200 response bisa dibaca browser,
- 401/403/500 tampak sebagai CORS error.

Penyebab:

- `add_header` tanpa `always`,
- error response tidak punya CORS header.

Mitigasi:

```nginx
add_header Access-Control-Allow-Origin $cors_origin always;
```

---

### 41.4 Header Spoofing

Gejala:

- client bisa mengirim `X-User-Id` dan backend percaya.

Mitigasi:

- clear untrusted headers,
- only trust gateway-generated headers,
- isolate backend network,
- app validates source.

---

### 41.5 Rate Limit False Positive

Gejala:

- banyak user kantor terkena 429.

Penyebab:

- rate limit by public IP,
- semua user keluar dari NAT yang sama.

Mitigasi:

- limit by authenticated client ID bila tersedia,
- adjust burst,
- split login vs general API,
- observe before enforcing via dry-run pattern jika tersedia/terimplementasi.

---

### 41.6 Gateway Timeout Too Long

Gejala:

- upstream Java thread pool penuh,
- Nginx menunggu terlalu lama,
- client retry,
- cascading failure.

Mitigasi:

- timeout budget,
- small connect timeout,
- endpoint-specific read timeout,
- bulkhead in app,
- queue limit,
- reject early.

---

### 41.7 Gateway Timeout Too Short

Gejala:

- report export selalu 504,
- backend selesai tetapi client sudah disconnect,
- wasted computation.

Mitigasi:

- classify endpoint,
- async job model untuk long work,
- longer timeout hanya untuk route tertentu,
- progress endpoint.

---

## 42. Security Checklist

Untuk Nginx API gateway ringan:

```text
[ ] Unknown hosts rejected.
[ ] HTTP redirects to HTTPS.
[ ] TLS config reviewed.
[ ] Public route inventory exists.
[ ] Internal routes blocked from public.
[ ] Auth required on protected routes.
[ ] Auth service timeout small and observable.
[ ] Trusted identity headers are generated, not client-reflected.
[ ] Spoofable headers are cleared or overwritten.
[ ] X-Forwarded-* trust boundary documented.
[ ] Body limits set by route class.
[ ] Rate limits set for expensive endpoints.
[ ] CORS allowlist used; no blind origin reflection.
[ ] Error response does not leak upstream internals.
[ ] Access logs include request ID, route, upstream, timing.
[ ] Sensitive headers are not logged.
[ ] Effective config reviewed in CI.
[ ] Backend services are not public if they trust gateway headers.
```

---

## 43. Design Checklist

Sebelum menambahkan route baru:

```text
1. Apa public path/host?
2. Siapa owner route?
3. Upstream service apa?
4. Prefix dipreserve atau di-strip?
5. Auth required?
6. Coarse scope apa?
7. Body max berapa?
8. Timeout berapa?
9. Rate limit class apa?
10. CORS origin apa?
11. Apakah route user-specific?
12. Apakah boleh cache?
13. Apakah long-lived/streaming?
14. Error behavior bagaimana?
15. Log field apa yang dibutuhkan?
16. Apa negative test-nya?
17. Apa rollback plan-nya?
```

Jika pertanyaan ini tidak bisa dijawab, route belum siap masuk gateway.

---

## 44. Practical Decision Framework

Gunakan pertanyaan ini:

### 44.1 Apakah policy butuh state domain?

Jika ya, jangan di Nginx.

### 44.2 Apakah policy deterministic dari request metadata?

Jika ya, Nginx mungkin cocok.

### 44.3 Apakah policy berubah sering oleh business/platform team?

Jika ya, dedicated gateway/control plane mungkin lebih cocok.

### 44.4 Apakah failure gateway akan menjatuhkan semua service?

Jika ya, desain HA dan fallback dengan serius.

### 44.5 Apakah config bisa dites?

Jika tidak, sederhanakan.

### 44.6 Apakah developer aplikasi memahami kontrak gateway?

Jika tidak, dokumentasikan dan buat contract test.

---

## 45. Anti-Patterns

### 45.1 Nginx sebagai Business Rules Engine

Buruk:

```nginx
# pseudo anti-pattern
if ($arg_case_status = escalated) { ... }
if ($http_x_user_role = supervisor) { ... }
```

Pindahkan ke aplikasi/policy service.

---

### 45.2 Blind Copy-Paste Gateway Config

Gejala:

- semua route timeout 300s,
- semua route body limit 100m,
- semua route CORS `*`,
- semua route rate limit sama.

Gateway harus route-aware.

---

### 45.3 Trusting Client Headers

Buruk:

```nginx
proxy_set_header X-User-Id $http_x_user_id;
```

Baik:

```nginx
auth_request_set $auth_user $upstream_http_x_auth_user;
proxy_set_header X-Authenticated-User $auth_user;
```

Tetap pastikan auth service yang menghasilkan header tersebut trusted.

---

### 45.4 Gateway as Transformation Dumping Ground

Jika config mulai berisi rewrite payload, JSON manipulation, dan version translation, kamu mungkin butuh BFF atau adapter service.

---

### 45.5 No Route Inventory

Jika tidak ada daftar route, owner, auth, limit, dan upstream, gateway menjadi black box.

---

## 46. Latihan Desain

### Latihan 1 — Basic API Gateway

Desain Nginx gateway untuk:

```text
/api/v1/auth/*    -> auth-service
/api/v1/users/*   -> user-service
/api/v1/orders/*  -> order-service
/api/v1/reports/* -> report-service
```

Requirement:

- auth route tidak perlu auth_request,
- semua route lain perlu auth_request,
- login rate limit 5 request/menit/IP,
- API umum 20 request/detik/IP,
- reports export timeout 120s,
- default body limit 2 MB,
- upload body limit 50 MB,
- log JSON dengan route ID.

Yang harus kamu hasilkan:

- upstream blocks,
- map route ID,
- rate limit zones,
- server block,
- proxy-common snippet.

---

### Latihan 2 — Header Trust Boundary

Diberikan backend Spring Boot yang percaya header:

```text
X-Authenticated-User
X-Authenticated-Scope
```

Desain gateway agar:

- client tidak bisa spoof header tersebut,
- auth service menjadi sumber header,
- backend hanya bisa diakses dari Nginx network.

Jelaskan:

- Nginx config,
- network assumption,
- backend validation,
- failure mode.

---

### Latihan 3 — Decide Nginx or Dedicated Gateway

Kebutuhan:

```text
50 partner eksternal
quota berbeda per partner
API key lifecycle
developer portal
per-partner analytics
OAuth2/OIDC
paid API tiers
```

Jawab:

- apakah Nginx OSS cukup?
- apa yang masih bisa ditangani Nginx?
- komponen apa yang sebaiknya dedicated gateway?
- bagaimana migration path?

---

## 47. Ringkasan Mental Model

Nginx sebagai API gateway ringan adalah pilihan bagus jika kamu membatasi tanggung jawabnya.

Gunakan Nginx untuk:

- routing,
- TLS,
- reverse proxy,
- load balancing,
- timeout,
- body limit,
- coarse rate limit,
- CORS sederhana,
- auth delegation,
- header normalization,
- observability,
- basic error normalization.

Jangan gunakan Nginx untuk:

- business rules,
- domain authorization kompleks,
- workflow state transition,
- entitlement matrix,
- payload transformation kompleks,
- API product lifecycle kompleks,
- dynamic per-consumer policy yang berubah sering.

Kalimat kunci:

> Nginx gateway yang sehat adalah boundary yang tipis, deterministic, observable, dan mudah dites.  
> Semakin ia tahu tentang domain, semakin besar risiko ia menjadi hidden application layer.

---

## 48. Referensi

- NGINX official documentation: reverse proxy, proxy module, load balancing, rate limiting, security controls, and module reference.
- NGINX Admin Guide: HTTP load balancing and controlling access to proxied HTTP resources.
- NGINX blog/F5 guidance on deploying NGINX/NGINX Plus as an API gateway.
- NGINX Plus documentation for JWT authentication and advanced API gateway capabilities.
- NGINX Gateway Fabric and Ingress Controller documentation for Kubernetes-oriented gateway policies.

---

## 49. Status Seri

Selesai: **Part 024 — Nginx as Lightweight API Gateway**  
Belum selesai: seri masih berlanjut.

Part berikutnya:

```text
Part 025 — Nginx in Containers and Kubernetes
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-nginx-mastery-for-java-engineers-part-023.md">⬅️ Part 023 — Blue-Green, Canary, Shadow Traffic, and Progressive Delivery</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-nginx-mastery-for-java-engineers-part-025.md">Part 025 — Nginx in Containers and Kubernetes ➡️</a>
</div>
