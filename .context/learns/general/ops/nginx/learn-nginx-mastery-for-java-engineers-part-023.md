# learn-nginx-mastery-for-java-engineers-part-023.md

# Part 023 — Blue-Green, Canary, Shadow Traffic, and Progressive Delivery

## 0. Posisi Part Ini Dalam Seri

Pada part sebelumnya kita sudah membangun fondasi:

- bagaimana Nginx menerima request;
- bagaimana `server` dan `location` memilih route;
- bagaimana `proxy_pass` meneruskan request ke Java backend;
- bagaimana upstream, timeout, buffering, TLS, logging, security, dan long-lived connection bekerja;
- bagaimana Nginx berinteraksi dengan servlet container, Netty/WebFlux, gRPC, WebSocket, dan SSE.

Sekarang kita masuk ke topik yang lebih arsitektural: **bagaimana menggunakan Nginx sebagai traffic switch untuk deployment strategy**.

Part ini bukan tentang CI/CD tool secara umum. Fokusnya adalah:

> Bagaimana Nginx dapat mengarahkan sebagian, seluruh, atau salinan traffic ke versi aplikasi berbeda secara aman, observabel, dan reversible.

Dalam sistem Java production, deployment jarang hanya berarti “upload JAR baru lalu restart”. Deployment berarti mengubah state sistem hidup:

- binary berubah;
- schema mungkin berubah;
- cache mungkin berubah;
- session behavior mungkin berubah;
- kontrak API mungkin berubah;
- latency profile mungkin berubah;
- error pattern mungkin berubah;
- downstream call mungkin berubah;
- user journey mungkin berubah.

Nginx dapat menjadi salah satu titik kontrol untuk mengurangi risiko perubahan tersebut.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu harus mampu:

1. Memahami perbedaan deployment, release, rollout, exposure, dan rollback.
2. Menjelaskan kapan blue-green cocok dan kapan tidak.
3. Menjelaskan kapan canary cocok dan bagaimana menerapkannya dengan Nginx.
4. Membedakan traffic split berbasis weight, header, cookie, IP, dan path.
5. Mendesain routing progressive delivery tanpa merusak session, cache, observability, atau data consistency.
6. Memahami konsep shadow traffic / traffic mirroring dan risikonya.
7. Menentukan batas kemampuan Nginx dibanding deployment orchestrator, API gateway, load balancer cloud, service mesh, atau feature flag platform.
8. Membuat checklist production untuk rollout Java backend di belakang Nginx.

---

## 2. Mental Model: Deployment Bukan Sekadar Menyalakan Versi Baru

Banyak engineer melihat deployment sebagai aksi teknis:

```text
old app -> new app
```

Mental model production yang lebih tepat:

```text
code version
  + config version
  + schema version
  + cache state
  + connection state
  + user session state
  + traffic distribution
  + observability signal
  + rollback path
  = release state
```

Nginx terutama mengontrol satu komponen penting:

```text
traffic distribution
```

Nginx tidak otomatis menyelesaikan:

- backward compatibility database;
- migrasi schema;
- idempotency;
- event replay;
- feature flag logic;
- per-user authorization;
- application-level consistency;
- safe rollback data;
- stateful session migration.

Jadi Nginx kuat sebagai **traffic control point**, tetapi bukan solusi lengkap untuk release safety.

---

## 3. Deployment, Release, Rollout, Exposure, Rollback

Sebelum masuk konfigurasi, kita perlu membedakan istilah.

### 3.1 Deployment

Deployment adalah membuat versi aplikasi tersedia di environment.

Contoh:

```text
app-v2 berjalan di port 8082
container image baru sudah running
pod baru sudah ready
VM baru sudah menerima health check
```

Deployment belum tentu berarti user sudah melihat versi baru.

### 3.2 Release

Release adalah membuat fitur/versi tersedia untuk user atau traffic nyata.

Contoh:

```text
10% traffic diarahkan ke app-v2
user internal diarahkan ke app-v2
semua user diarahkan ke app-v2
```

Nginx sering dipakai untuk memisahkan deployment dari release.

### 3.3 Rollout

Rollout adalah proses bertahap meningkatkan exposure.

Contoh:

```text
0% -> 1% -> 5% -> 10% -> 25% -> 50% -> 100%
```

### 3.4 Exposure

Exposure adalah siapa atau berapa banyak traffic yang melihat versi tertentu.

Bentuk exposure:

- percentage-based;
- user-based;
- tenant-based;
- region-based;
- path-based;
- header-based;
- cookie-based;
- internal-only;
- staff-only;
- beta-user-only.

### 3.5 Rollback

Rollback adalah mengurangi atau menghapus exposure versi bermasalah.

Rollback traffic-level dengan Nginx bisa sangat cepat:

```text
app-v2 weight 10 -> 0
```

Tetapi rollback traffic belum tentu rollback sistem secara keseluruhan.

Jika versi baru sudah:

- menulis data dengan format baru;
- memicu event baru;
- mengubah cache;
- mengubah external side effect;
- membuat migration irreversible;

maka rollback traffic saja tidak cukup.

---

## 4. Di Mana Nginx Berada Dalam Progressive Delivery

Arsitektur sederhana:

```text
Client
  |
  v
Nginx
  |
  +--> app-v1
  |
  +--> app-v2
```

Nginx dapat memilih upstream berdasarkan:

- fixed config;
- upstream weight;
- request path;
- host;
- header;
- cookie;
- client IP;
- map variable;
- split_clients;
- internal route decision.

Nginx dapat melakukan:

- blue-green switch;
- canary percentage split;
- internal beta routing;
- tenant routing;
- header-based test routing;
- cookie stickiness sederhana;
- mirror/shadow request;
- quick rollback;
- traffic drain sebagian.

Namun Nginx open source tidak otomatis menyediakan semua fitur high-level seperti:

- active health check advanced;
- automatic metric-based rollback;
- distributed config management;
- per-user feature flag evaluation kompleks;
- automatic progressive rollout controller;
- traffic policy CRD seperti service mesh;
- release dashboard bawaan.

Hal-hal itu biasanya datang dari:

- deployment platform;
- Kubernetes controller;
- NGINX Plus;
- cloud load balancer;
- API gateway;
- service mesh;
- feature flag platform;
- custom control plane.

---

## 5. Blue-Green Deployment

### 5.1 Konsep

Blue-green deployment menggunakan dua environment atau dua pool aplikasi:

```text
blue  = versi aktif saat ini
      = app-v1

green = versi baru yang sudah disiapkan
      = app-v2
```

Traffic awal:

```text
Client -> Nginx -> blue
```

Setelah green siap:

```text
Client -> Nginx -> green
```

Rollback:

```text
Client -> Nginx -> blue
```

### 5.2 Kapan Blue-Green Cocok

Blue-green cocok jika:

- aplikasi stateless atau session bisa dibagi aman;
- schema database backward-compatible;
- kedua versi bisa hidup berdampingan sementara;
- ingin switch cepat;
- butuh rollback cepat;
- environment cukup mampu menjalankan dua versi sekaligus;
- traffic tidak perlu dibagi granular;
- release risk bisa diterima dengan switch besar.

### 5.3 Kapan Blue-Green Kurang Cocok

Blue-green kurang cocok jika:

- aplikasi stateful dan session tidak kompatibel;
- migrasi database tidak backward-compatible;
- versi baru butuh warming lama;
- perbedaan versi harus divalidasi secara gradual;
- kapasitas infra tidak cukup menjalankan dua environment penuh;
- traffic sangat besar dan switch 100% terlalu berisiko;
- downstream effect versi baru belum pasti aman.

---

## 6. Blue-Green Dengan Nginx: Konfigurasi Dasar

Misal:

- blue: `127.0.0.1:8081`
- green: `127.0.0.1:8082`

```nginx
upstream app_blue {
    server 127.0.0.1:8081;
    keepalive 64;
}

upstream app_green {
    server 127.0.0.1:8082;
    keepalive 64;
}

server {
    listen 443 ssl http2;
    server_name api.example.com;

    location / {
        proxy_http_version 1.1;
        proxy_set_header Connection "";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_pass http://app_blue;
    }
}
```

Switch ke green:

```nginx
proxy_pass http://app_green;
```

Lalu:

```bash
nginx -t
nginx -s reload
```

Atau dengan systemd:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

### 6.1 Mengapa `reload`, Bukan `restart`?

`reload` membuat Nginx:

- membaca konfigurasi baru;
- memulai worker baru;
- meminta worker lama berhenti secara graceful;
- menjaga connection yang sedang berjalan sejauh memungkinkan.

`restart` mematikan proses lalu menyalakan ulang, yang lebih berisiko memutus koneksi.

Untuk switch production, gunakan:

```bash
nginx -t && systemctl reload nginx
```

bukan:

```bash
systemctl restart nginx
```

kecuali memang ada alasan kuat.

---

## 7. Blue-Green Dengan Include File

Agar switch tidak mengedit config besar, gunakan include kecil.

Struktur:

```text
/etc/nginx/
  nginx.conf
  conf.d/
    api.conf
  releases/
    app-active-upstream.conf
    app-blue.conf
    app-green.conf
```

`app-blue.conf`:

```nginx
set $active_app_upstream "http://app_blue";
```

`app-green.conf`:

```nginx
set $active_app_upstream "http://app_green";
```

Namun `proxy_pass` dengan variable memiliki konsekuensi berbeda, khususnya pada DNS resolution dan beberapa optimasi upstream. Cara yang lebih aman untuk banyak kasus adalah mengganti symlink include yang berisi potongan location/upstream eksplisit.

Contoh:

`active-proxy.inc`:

```nginx
proxy_pass http://app_blue;
```

`api.conf`:

```nginx
location / {
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    include /etc/nginx/releases/active-proxy.inc;
}
```

Switch:

```bash
ln -sfn /etc/nginx/releases/proxy-green.inc /etc/nginx/releases/active-proxy.inc
nginx -t && systemctl reload nginx
```

### 7.1 Risiko Symlink Switch

Symlink switch harus hati-hati:

- pastikan path benar;
- pastikan file target valid;
- pastikan `nginx -t` dijalankan;
- pastikan switch atomic sejauh mungkin;
- pastikan rollback file tersedia;
- pastikan automation tidak meninggalkan symlink rusak.

Jangan menjalankan reload tanpa config test.

---

## 8. Canary Deployment

### 8.1 Konsep

Canary deployment mengarahkan sebagian kecil traffic ke versi baru.

Contoh:

```text
95% -> app-v1
 5% -> app-v2
```

Jika sehat:

```text
90% -> app-v1
10% -> app-v2
```

Lalu:

```text
50% -> app-v1
50% -> app-v2
```

Akhir:

```text
0%   -> app-v1
100% -> app-v2
```

### 8.2 Mengapa Canary Lebih Aman Dari Big Bang

Canary membatasi blast radius.

Jika versi baru error:

```text
5% user terdampak, bukan 100%
```

Canary cocok untuk:

- perubahan behavior;
- perubahan performa;
- perubahan dependency;
- perubahan endpoint mahal;
- perubahan serialization;
- perubahan query database;
- perubahan yang perlu observasi real traffic.

### 8.3 Syarat Canary Yang Sehat

Canary hanya berguna jika kamu bisa membandingkan sinyal:

- error rate v1 vs v2;
- latency v1 vs v2;
- upstream response time;
- status code distribution;
- business metric;
- JVM CPU/memory/GC;
- DB query profile;
- downstream error;
- queue lag;
- log exception type;
- user complaint signal.

Tanpa observability, canary hanya “deploy pelan-pelan sambil berharap”.

---

## 9. Canary Dengan Weighted Upstream

Konfigurasi dasar:

```nginx
upstream app_canary {
    server 127.0.0.1:8081 weight=95;
    server 127.0.0.1:8082 weight=5;
    keepalive 64;
}

server {
    listen 443 ssl http2;
    server_name api.example.com;

    location / {
        proxy_http_version 1.1;
        proxy_set_header Connection "";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Release-Routing "weighted-canary";

        proxy_pass http://app_canary;
    }
}
```

### 9.1 Hal Yang Sering Disalahpahami

`weight=95` dan `weight=5` bukan berarti secara absolut setiap 100 request pasti 95/5 dalam window kecil.

Distribusi bergantung pada:

- algoritma load balancing;
- keepalive connection;
- request concurrency;
- worker process;
- upstream availability;
- retry behavior;
- long-lived connection;
- volume traffic.

Pada traffic kecil, distribusi bisa terlihat tidak presisi.

### 9.2 Masalah Besar Weighted Canary

Weighted canary membagi request, bukan user.

Jika user yang sama melakukan 10 request, bisa saja:

```text
request 1 -> v1
request 2 -> v2
request 3 -> v1
request 4 -> v2
```

Ini berbahaya jika:

- user session state berbeda;
- response format berbeda;
- UI/backend contract berubah;
- cache per-user berubah;
- flow multi-step harus konsisten;
- idempotency tidak kuat.

Untuk user journey, sering lebih aman memakai sticky canary berbasis cookie, header, atau user ID hash.

---

## 10. Canary Berbasis Cookie

### 10.1 Tujuan

Cookie-based canary menjaga user tetap ke versi yang sama setelah ditandai.

Contoh:

```text
Cookie: app_version=canary
```

Maka route ke v2.

Jika tidak ada cookie, route ke v1 atau split normal.

### 10.2 Konfigurasi Dengan `map`

Di context `http`:

```nginx
map $cookie_app_version $target_upstream {
    default     app_stable;
    canary      app_canary;
}

upstream app_stable {
    server 127.0.0.1:8081;
    keepalive 64;
}

upstream app_canary {
    server 127.0.0.1:8082;
    keepalive 64;
}
```

Di `server`:

```nginx
location / {
    proxy_http_version 1.1;
    proxy_set_header Connection "";

    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Canary-Source "cookie";

    proxy_pass http://$target_upstream;
}
```

### 10.3 Catatan Penting Tentang `proxy_pass` Dengan Variable

Saat memakai variable di `proxy_pass`, Nginx memperlakukan resolusi upstream berbeda dibanding `proxy_pass http://app_stable;` langsung. Dalam banyak setup, named upstream dengan variable bisa bekerja, tetapi kamu harus menguji perilaku spesifik versi/config dan menghindari asumsi.

Alternatif yang lebih eksplisit adalah memakai named locations atau conditional routing pattern yang tidak terlalu kompleks. Namun Nginx memiliki keterbatasan dalam imperative branching; jika logic routing makin kompleks, pertimbangkan API gateway/service mesh.

### 10.4 Siapa Yang Menyetel Cookie?

Ada beberapa pilihan:

1. Aplikasi Java menyetel cookie.
2. Nginx menyetel cookie untuk path tertentu.
3. CDN/edge menyetel cookie.
4. Internal testing tool menyetel cookie manual.
5. Feature flag platform menyetel state user.

Contoh Nginx menyetel cookie untuk internal beta path:

```nginx
location = /__enable_canary {
    add_header Set-Cookie "app_version=canary; Path=/; Secure; HttpOnly; SameSite=Lax" always;
    return 204;
}

location = /__disable_canary {
    add_header Set-Cookie "app_version=stable; Path=/; Secure; HttpOnly; SameSite=Lax" always;
    return 204;
}
```

Endpoint seperti ini harus dilindungi jika tidak boleh diakses publik.

---

## 11. Canary Berbasis Header

Header-based routing umum untuk:

- internal testing;
- automated test;
- synthetic monitoring;
- beta client;
- mobile app version;
- tenant migration;
- debugging.

Contoh:

```text
X-Use-Canary: true
```

Konfigurasi:

```nginx
map $http_x_use_canary $target_upstream {
    default app_stable;
    true    app_canary;
}

upstream app_stable {
    server 127.0.0.1:8081;
}

upstream app_canary {
    server 127.0.0.1:8082;
}

server {
    listen 443 ssl http2;
    server_name api.example.com;

    location / {
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Release-Variant $target_upstream;

        proxy_pass http://$target_upstream;
    }
}
```

### 11.1 Security Warning

Jangan percaya header dari internet untuk keputusan sensitif.

Jika header canary bisa dikirim public client, maka semua orang bisa mengakses canary.

Untuk internal-only header:

- strip header dari public request;
- hanya set header dari trusted proxy/CDN;
- validasi source network;
- gunakan auth;
- gunakan mTLS untuk internal path;
- jangan gunakan header ini untuk bypass authorization.

Contoh strip public header lalu set internal value:

```nginx
proxy_set_header X-Use-Canary "";
```

Atau gunakan header yang hanya datang dari trusted upstream proxy.

---

## 12. Canary Berbasis `split_clients`

Nginx memiliki directive `split_clients` yang dapat membagi traffic berdasarkan hash dari string tertentu.

Contoh:

```nginx
split_clients "${remote_addr}${http_user_agent}" $canary_bucket {
    5%      canary;
    *       stable;
}

map $canary_bucket $target_upstream {
    stable  app_stable;
    canary  app_canary;
}

upstream app_stable {
    server 127.0.0.1:8081;
}

upstream app_canary {
    server 127.0.0.1:8082;
}
```

Lalu:

```nginx
location / {
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Canary-Bucket $canary_bucket;

    proxy_pass http://$target_upstream;
}
```

### 12.1 Memilih Hash Key

Pilihan hash key memengaruhi stabilitas routing.

#### Opsi 1: `$remote_addr`

```nginx
split_clients "$remote_addr" $canary_bucket { ... }
```

Kelebihan:

- sederhana;
- tidak butuh aplikasi;
- cukup stabil untuk beberapa client.

Kekurangan:

- buruk di belakang NAT besar;
- banyak user bisa share satu IP;
- mobile IP sering berubah;
- proxy/CDN bisa membuat IP tidak representatif;
- IPv6 privacy address bisa berubah.

#### Opsi 2: Cookie user/session

```nginx
split_clients "$cookie_session_id" $canary_bucket { ... }
```

Kelebihan:

- lebih user-sticky;
- cocok untuk user journey.

Kekurangan:

- butuh cookie ada sebelum routing;
- anonymous user tanpa cookie perlu fallback;
- session ID sensitif, jangan log sembarangan.

#### Opsi 3: Header user ID dari trusted identity layer

```nginx
split_clients "$http_x_user_id" $canary_bucket { ... }
```

Kelebihan:

- stabil per user;
- cocok untuk gradual user rollout.

Kekurangan:

- header harus trusted;
- tidak boleh dari public client mentah;
- identity layer harus berada sebelum Nginx atau di edge trusted.

### 12.2 Problem Dengan Percentage Canary

Jika kamu mengubah:

```nginx
5% canary;
```

menjadi:

```nginx
10% canary;
```

sebagian bucket baru akan masuk canary. Namun detail user yang pindah tergantung hashing dan konfigurasi. Pastikan observability bisa melihat cohort.

---

## 13. Path-Based Routing Untuk Versi API

Kadang versi baru hanya untuk path tertentu.

```nginx
location /api/v1/ {
    proxy_pass http://app_v1;
}

location /api/v2/ {
    proxy_pass http://app_v2;
}
```

Ini bukan canary murni. Ini versioned routing.

Cocok jika:

- API version eksplisit;
- client bisa memilih versi;
- kontrak berbeda sengaja dipisahkan;
- backward compatibility dijaga.

Tidak cocok jika:

- ingin gradual release untuk route yang sama;
- UI tidak tahu versi;
- perubahan hanya internal implementation;
- user journey harus transparan.

---

## 14. Host-Based Routing Untuk Environment Exposure

Contoh:

```nginx
server {
    listen 443 ssl http2;
    server_name api.example.com;

    location / {
        proxy_pass http://app_stable;
    }
}

server {
    listen 443 ssl http2;
    server_name beta-api.example.com;

    location / {
        proxy_pass http://app_canary;
    }
}
```

Cocok untuk:

- internal beta;
- staging-like production test;
- mobile app beta endpoint;
- partner testing;
- migration rehearsal.

Risiko:

- cookie domain conflict;
- CORS config berbeda;
- OAuth redirect URI berbeda;
- certificate/SNI perlu benar;
- observability harus memisahkan host;
- user bisa salah memakai endpoint beta.

---

## 15. Tenant-Based Routing

Dalam SaaS atau regulatory/case management platform, rollout sering lebih aman per tenant daripada per request.

Contoh:

```text
tenant-a -> stable
internal-tenant -> canary
tenant-b -> stable
pilot-tenant -> canary
```

Jika tenant ID ada di host:

```text
tenant-a.example.com
tenant-b.example.com
```

Nginx bisa route berdasarkan host.

Jika tenant ID ada di path:

```text
/t/{tenantId}/cases
```

Nginx bisa route berdasarkan regex location, tetapi parsing tenant kompleks di Nginx cepat menjadi sulit.

Jika tenant ID ada di JWT/body/application context, Nginx tidak cocok menjadi decision engine utama tanpa tambahan auth/request processing layer.

### 15.1 Prinsip Tenant Rollout

Tenant rollout harus mempertimbangkan:

- data isolation;
- schema compatibility;
- per-tenant migration;
- support readiness;
- contractual SLA;
- audit requirement;
- rollback per tenant;
- feature flag consistency;
- background jobs;
- async events.

Nginx bisa membantu route traffic, tetapi tenant lifecycle biasanya harus dikontrol oleh aplikasi/platform release manager.

---

## 16. Internal Beta Routing

Internal beta adalah pola sederhana tetapi sangat berguna.

Tujuan:

- engineer/staff mencoba versi baru di production-like traffic;
- synthetic monitoring memukul versi baru;
- QA bisa validasi dengan data production terbatas;
- support bisa melihat UI/backend baru.

Contoh berbasis header:

```nginx
map $http_x_internal_beta $target_upstream {
    default app_stable;
    "1"     app_canary;
}
```

Tapi header harus dijaga. Lebih aman jika dikombinasikan dengan IP allowlist:

```nginx
geo $internal_network {
    default 0;
    10.0.0.0/8 1;
    192.168.0.0/16 1;
}

map "$internal_network:$http_x_internal_beta" $target_upstream {
    default app_stable;
    "1:1"   app_canary;
}
```

Dengan ini, public user yang mengirim `X-Internal-Beta: 1` tetap tidak diarahkan ke canary kecuali berasal dari network internal.

---

## 17. Shadow Traffic / Request Mirroring

### 17.1 Konsep

Shadow traffic berarti request production utama tetap dilayani oleh versi stable, tetapi salinan request dikirim ke versi baru untuk observasi.

```text
Client
  |
  v
Nginx
  |---- primary request ----> app_stable ----> response to client
  |
  +---- mirrored request ---> app_shadow  ----> response ignored
```

Tujuannya:

- melihat apakah versi baru bisa menerima shape traffic nyata;
- membandingkan error internal;
- mengukur latency dan resource;
- menemukan parsing bug;
- menguji endpoint tanpa user impact langsung.

### 17.2 Konfigurasi Dasar `mirror`

```nginx
upstream app_stable {
    server 127.0.0.1:8081;
}

upstream app_shadow {
    server 127.0.0.1:8082;
}

server {
    listen 443 ssl http2;
    server_name api.example.com;

    location / {
        mirror /__shadow;

        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_pass http://app_stable;
    }

    location = /__shadow {
        internal;

        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Shadow-Traffic "true";

        proxy_pass http://app_shadow$request_uri;
    }
}
```

### 17.3 Critical Warning: Side Effects

Shadow traffic sangat berbahaya jika request mirrored punya side effect.

Contoh side effect:

- membuat order;
- mengirim email;
- memotong saldo;
- membuat case enforcement;
- mengubah status workflow;
- publish event Kafka;
- memanggil third-party API;
- membuat audit log resmi;
- mengirim notifikasi;
- generate invoice;
- update document state.

Jika shadow backend benar-benar menjalankan side effect, kamu bisa membuat kerusakan production tanpa user melihat langsung.

### 17.4 Cara Aman Melakukan Shadow Traffic

Shadow backend harus berada dalam mode khusus:

```text
shadow mode
```

Dalam shadow mode:

- tidak menulis ke database production;
- atau menulis ke isolated shadow database;
- tidak publish event production;
- tidak call third-party nyata;
- tidak mengirim email/SMS/push notification;
- tidak membuat audit record resmi;
- tidak mengubah state bisnis;
- response diabaikan;
- error dicatat terpisah;
- correlation ID dipertahankan;
- request ditandai `X-Shadow-Traffic: true`.

Untuk Java backend, kamu bisa punya guard:

```java
boolean shadow = "true".equalsIgnoreCase(request.getHeader("X-Shadow-Traffic"));

if (shadow) {
    // disable side effects or route to fake adapters
}
```

Tapi jangan hanya mengandalkan header dari public internet. Header shadow harus diset oleh Nginx dan disanitasi dari request external.

---

## 18. Shadow Traffic Untuk GET vs Non-GET

Pola aman minimal:

```nginx
location / {
    if ($request_method = GET) {
        mirror /__shadow;
    }

    proxy_pass http://app_stable;
}
```

Namun penggunaan `if` di Nginx harus hati-hati. Alternatif lebih rapi memakai `map` untuk memilih mirror target, tetapi `mirror` directive tidak bisa sepenuhnya dinamis di semua cara yang diharapkan.

Pendekatan praktis:

```nginx
location /api/read/ {
    mirror /__shadow;
    proxy_pass http://app_stable;
}

location /api/write/ {
    proxy_pass http://app_stable;
}
```

Atau batasi hanya endpoint read-only.

### 18.1 Read-Only Tidak Selalu Benar-Benar Read-Only

Bahkan GET bisa punya side effect buruk jika aplikasi salah desain:

- tracking view;
- update last_accessed;
- lazy migration;
- cache warm write;
- analytics event;
- audit access record;
- session touch;
- rate counter;
- downstream fetch dengan side effect.

Jadi shadow traffic membutuhkan review aplikasi, bukan hanya review Nginx config.

---

## 19. Observability Untuk Progressive Delivery

Tanpa observability, progressive delivery tidak punya feedback loop.

Minimum signal:

1. Request count by version.
2. Status code by version.
3. p50/p95/p99 latency by version.
4. Upstream connect/header/response time by version.
5. Error log by upstream/version.
6. JVM metrics by version.
7. Application exception rate by version.
8. Business metric by version.
9. Database query latency by version.
10. Downstream dependency error by version.

### 19.1 Tambahkan Header Internal Ke Upstream

```nginx
proxy_set_header X-Release-Variant "canary";
```

Atau dinamis:

```nginx
proxy_set_header X-Release-Variant $canary_bucket;
```

Aplikasi Java bisa memasukkan ini ke MDC/log context.

Contoh konsep log Java:

```text
request_id=abc123 release_variant=canary user_id=... status=500 duration_ms=...
```

### 19.2 Tambahkan Field Ke Access Log

Contoh:

```nginx
log_format release_json escape=json
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
    '"release_variant":"$canary_bucket"'
  '}';

access_log /var/log/nginx/access-release.log release_json;
```

Catatan:

- pastikan variable `$canary_bucket` tersedia dalam scope;
- jika tidak memakai canary bucket, gunakan variable lain seperti `$target_upstream`;
- hindari log data sensitif seperti raw cookie/session/JWT.

---

## 20. Rollback Strategy

Rollback harus dirancang sebelum rollout.

### 20.1 Rollback Blue-Green

Rollback blue-green:

```text
green -> blue
```

Nginx-level action:

```nginx
proxy_pass http://app_blue;
```

atau switch include/symlink.

Checklist:

- apakah blue masih running?
- apakah blue kompatibel dengan database setelah green sempat menerima traffic?
- apakah green menulis data format baru?
- apakah cache harus dihapus?
- apakah sticky session perlu dipindah?
- apakah client menerima response yang membuat client state berubah?
- apakah background job versi green sudah berjalan?

### 20.2 Rollback Canary

Rollback canary:

```nginx
server 127.0.0.1:8081 weight=100;
server 127.0.0.1:8082 weight=0;
```

Namun `weight=0` tidak selalu valid dalam semua konteks seperti yang diharapkan. Praktisnya, hapus server canary dari upstream atau tandai `down`:

```nginx
upstream app_canary {
    server 127.0.0.1:8081 weight=100;
    server 127.0.0.1:8082 down;
}
```

Lalu reload.

### 20.3 Rollback Cookie Canary

Jika user diberi cookie canary, rollback config saja mungkin belum cukup jika cookie masih ada.

Kamu perlu:

- mengabaikan cookie canary di Nginx;
- overwrite cookie ke stable;
- expire cookie;
- memastikan app tidak memakainya lagi.

Contoh disable cookie canary:

```nginx
map $cookie_app_version $target_upstream {
    default app_stable;
    canary  app_stable;
}
```

Expire cookie:

```nginx
add_header Set-Cookie "app_version=stable; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax" always;
```

---

## 21. Traffic Drain Saat Deploy

Masalah umum:

```text
Nginx masih mengirim request ke app yang sedang shutdown.
```

Untuk Java backend, shutdown bisa melibatkan:

- stop menerima request baru;
- menyelesaikan request berjalan;
- menutup keepalive;
- menutup DB pool;
- flush metrics/logs;
- stop consumer;
- deregister service discovery;
- update readiness.

Nginx open source dengan static upstream tidak otomatis tahu readiness aplikasi kecuali reload config atau upstream gagal pasif.

### 21.1 Pattern Manual Drain

1. Tandai instance sebagai tidak menerima traffic.
2. Reload Nginx agar instance dikeluarkan dari upstream.
3. Tunggu active request selesai.
4. Shutdown aplikasi.

Contoh:

```nginx
upstream app_stable {
    server 10.0.1.10:8080;
    server 10.0.1.11:8080 down;
}
```

### 21.2 Pattern Dengan Load Balancer/Orchestrator

Di Kubernetes/cloud, drain biasanya lebih baik dikontrol oleh:

- readiness probe;
- Service endpoint update;
- Ingress controller;
- load balancer target group;
- preStop hook;
- terminationGracePeriodSeconds.

Nginx static config bukan selalu tempat terbaik untuk per-instance lifecycle.

---

## 22. Database Compatibility: Bagian Yang Tidak Bisa Diselesaikan Nginx

Progressive delivery gagal jika database change tidak aman.

### 22.1 Expand-Contract Pattern

Untuk perubahan schema, gunakan pola:

1. Expand: tambah kolom/table baru tanpa menghapus yang lama.
2. Deploy aplikasi yang bisa membaca/menulis format kompatibel.
3. Backfill data.
4. Switch read path.
5. Pastikan stabil.
6. Contract: hapus kolom/behavior lama nanti.

Nginx hanya mengatur traffic. Ia tidak menjamin `app-v1` dan `app-v2` kompatibel dengan schema yang sama.

### 22.2 Contoh Risiko

Versi v2 menulis field baru:

```json
{
  "caseStatus": "ESCALATED_TO_REVIEW_BOARD"
}
```

Versi v1 hanya mengenal:

```text
OPEN
CLOSED
PENDING
```

Jika rollback ke v1, v1 mungkin gagal membaca data baru.

Traffic rollback berhasil, tetapi aplikasi tetap rusak.

---

## 23. Session Compatibility

Jika aplikasi Java menyimpan session in-memory, progressive delivery rawan.

Contoh:

```text
request 1 -> v1 creates session
request 2 -> v2 cannot read session
request 3 -> v1 reads old session
```

Solusi:

- buat aplikasi stateless;
- gunakan shared session store;
- gunakan sticky routing;
- pastikan session serialization compatible;
- jangan simpan object Java kompleks di session;
- gunakan external identity token;
- lakukan session migration bertahap.

Nginx dapat membantu sticky routing, tetapi jangan menjadikan sticky session sebagai pengganti desain stateless yang sehat.

---

## 24. Cache Compatibility

Jika Nginx cache aktif, rollout bisa membingungkan.

Masalah:

- response v1 masih tersimpan saat v2 aktif;
- response v2 bocor ke user yang harusnya v1;
- cache key tidak memasukkan release variant;
- canary user menerima stable cached response;
- stable user menerima canary cached response.

### 24.1 Cache Key Harus Mempertimbangkan Variant

Jika response berbeda antar variant:

```nginx
proxy_cache_key "$scheme$request_method$host$request_uri$canary_bucket";
```

Namun ini meningkatkan fragmentasi cache.

Jika response sama, jangan masukkan variant agar hit ratio tetap bagus.

### 24.2 Rule

Jika output berbeda berdasarkan route decision, cache key harus memasukkan decision input yang relevan.

Jika tidak, cache bisa menjadi cross-variant data leak.

---

## 25. Feature Flag vs Nginx Routing

Nginx routing dan feature flag sering terlihat mirip, tetapi berbeda.

### 25.1 Nginx Routing

Nginx memilih backend/version.

```text
user -> app-v1 atau app-v2
```

Cocok untuk:

- binary-level rollout;
- infrastructure-level switch;
- isolate new runtime;
- test new JVM/service version;
- route tenant ke cluster berbeda;
- quick traffic rollback.

### 25.2 Feature Flag

Feature flag memilih behavior di dalam aplikasi.

```text
same app binary -> feature on/off
```

Cocok untuk:

- per-user feature;
- per-tenant feature;
- business rule exposure;
- UI element exposure;
- experiment logic;
- kill switch behavior;
- gradual feature activation tanpa deploy ulang.

### 25.3 Kombinasi Yang Sehat

Sering paling aman:

```text
Nginx canary routes small traffic to app-v2
app-v2 still gates risky behavior behind feature flag
```

Dengan ini, app-v2 bisa diuji sebagai binary baru, tetapi fitur bisnis berisiko tetap bisa dimatikan.

---

## 26. Canary Dengan Java Application Metadata

Aplikasi Java sebaiknya mengekspos metadata versi.

Contoh endpoint:

```text
GET /actuator/info
```

Response:

```json
{
  "app": {
    "name": "case-service",
    "version": "2.3.0",
    "gitCommit": "abc123",
    "buildTime": "2026-06-19T10:00:00Z"
  }
}
```

Nginx logs bisa menunjukkan upstream address, tetapi aplikasi harus menunjukkan build identity.

Untuk incident, pertanyaan penting:

```text
Request ini diproses binary mana?
Config mana?
Commit mana?
Feature flag state mana?
Tenant migration state mana?
```

---

## 27. Canary Guardrail Metrics

Sebelum menaikkan traffic, tentukan guardrail.

Contoh:

```text
Canary 5% boleh naik ke 10% jika selama 30 menit:
- HTTP 5xx canary <= stable + 0.2%
- p95 latency canary <= stable + 20%
- p99 latency tidak naik lebih dari 30%
- tidak ada spike exception kritis
- DB CPU tidak naik abnormal
- downstream timeout tidak naik
- business success rate tidak turun
```

Untuk regulatory/case-management style systems, guardrail juga bisa mencakup:

- case transition failure rate;
- duplicate action rate;
- audit write failure;
- queue lag;
- escalation SLA breach;
- authorization denial anomaly;
- document generation failure;
- notification failure.

Nginx hanya memberi sinyal HTTP/proxy. Business guardrail harus datang dari aplikasi/domain telemetry.

---

## 28. Status Code dan Progressive Delivery

Selama rollout, jangan hanya melihat 5xx.

Perhatikan:

- `400`: request parsing/contract issue;
- `401`: auth propagation issue;
- `403`: authorization or access control regression;
- `404`: route mismatch;
- `409`: concurrency/business conflict;
- `413`: body limit mismatch;
- `415`: content type regression;
- `422`: validation behavior berubah;
- `429`: rate limit terlalu agresif;
- `499`: client timeout/abort naik;
- `502`: upstream crash/refused/bad response;
- `503`: unavailable/overload;
- `504`: upstream timeout.

Canary bisa terlihat “tidak 500” tetapi tetap rusak secara bisnis.

---

## 29. Common Failure Modes

### 29.1 Canary Tidak Sticky

Gejala:

- user kadang melihat behavior lama, kadang baru;
- multi-step flow gagal;
- CSRF/session mismatch;
- inconsistent UI/API response.

Penyebab:

- weighted split per request;
- session state tidak shared;
- cache key tidak variant-aware.

Solusi:

- cookie/user-ID-based routing;
- shared session;
- variant-aware cache;
- feature flag instead of backend split for per-user behavior.

### 29.2 Rollback Gagal Karena Schema

Gejala:

- traffic sudah balik ke v1 tetapi error tetap tinggi;
- v1 tidak bisa membaca data yang ditulis v2.

Penyebab:

- migration tidak backward-compatible;
- enum baru;
- JSON structure berubah;
- column removed terlalu cepat.

Solusi:

- expand-contract;
- compatibility tests;
- canary write isolation;
- rollback rehearsal.

### 29.3 Shadow Traffic Membuat Side Effect

Gejala:

- duplicate records;
- duplicate email;
- duplicate event;
- audit anomaly;
- external API called twice.

Penyebab:

- mirror request ke backend yang tidak side-effect-safe;
- shadow mode tidak enforced;
- downstream adapter tidak dimock/disabled.

Solusi:

- shadow only read-only endpoint;
- shadow database;
- disable side effects;
- header guard;
- application-level shadow mode.

### 29.4 Header Canary Bisa Diakses Public

Gejala:

- user luar bisa mengakses versi beta;
- exploit mencoba header canary;
- support menerima laporan dari user yang seharusnya tidak exposed.

Penyebab:

- Nginx mempercayai public request header.

Solusi:

- sanitize public headers;
- require trusted network;
- auth protected beta;
- use server-side flagging.

### 29.5 Observability Tidak Memisahkan Variant

Gejala:

- error naik tetapi tidak tahu versi mana;
- rollback lambat;
- canary decision berdasarkan feeling.

Penyebab:

- access log tidak memuat upstream/version;
- app log tidak punya release metadata;
- metrics tidak dilabeli version;
- tracing tidak membawa release attribute.

Solusi:

- add `X-Release-Variant`;
- add log field;
- expose build info;
- tag metrics/traces by version.

---

## 30. Practical Production Patterns

### 30.1 Pattern A: Simple Blue-Green For Stateless API

Cocok untuk:

- simple stateless Java API;
- shared DB compatible;
- no long-lived connection;
- low release risk.

Flow:

1. Deploy green.
2. Warm green.
3. Check health endpoint.
4. Run smoke test against green direct/internal host.
5. Switch Nginx to green.
6. Watch metrics.
7. Keep blue alive for rollback window.
8. Retire blue.

### 30.2 Pattern B: Staff Canary Then Percentage Canary

Cocok untuk:

- user-facing API;
- moderate risk;
- need internal validation.

Flow:

1. Deploy v2.
2. Route internal staff via header/cookie/IP to v2.
3. Run synthetic monitor.
4. Route 1% user by split_clients.
5. Observe guardrails.
6. Increase to 5%, 10%, 25%, 50%, 100%.
7. Disable v1 after stable window.

### 30.3 Pattern C: Tenant Canary

Cocok untuk:

- SaaS;
- regulatory systems;
- complex workflows;
- per-tenant support readiness.

Flow:

1. Select low-risk tenant/internal tenant.
2. Ensure tenant data compatibility.
3. Route tenant to v2.
4. Observe business workflow metrics.
5. Add next tenant group.
6. Keep rollback per tenant.

### 30.4 Pattern D: Shadow First, Then Canary

Cocok untuk:

- parser rewrite;
- performance-sensitive backend;
- new query engine;
- refactor where response is not exposed yet.

Flow:

1. Deploy v2 shadow-safe.
2. Mirror read-only traffic.
3. Compare logs/metrics.
4. Fix incompatibilities.
5. Enable small canary.
6. Roll out gradually.

---

## 31. Example: End-to-End Canary Config

Contoh ini menggabungkan:

- stable upstream;
- canary upstream;
- internal beta via header + internal network;
- percentage canary via split_clients;
- release variant header;
- JSON log.

```nginx
http {
    log_format release_json escape=json
      '{'
        '"time":"$time_iso8601",'
        '"request_id":"$request_id",'
        '"remote_addr":"$remote_addr",'
        '"host":"$host",'
        '"method":"$request_method",'
        '"uri":"$request_uri",'
        '"status":$status,'
        '"request_time":$request_time,'
        '"upstream_addr":"$upstream_addr",'
        '"upstream_status":"$upstream_status",'
        '"upstream_response_time":"$upstream_response_time",'
        '"release_variant":"$release_variant"'
      '}';

    upstream app_stable {
        server 127.0.0.1:8081;
        keepalive 64;
    }

    upstream app_canary {
        server 127.0.0.1:8082;
        keepalive 64;
    }

    geo $internal_network {
        default 0;
        10.0.0.0/8 1;
        192.168.0.0/16 1;
    }

    split_clients "$remote_addr$http_user_agent" $percentage_bucket {
        5%      canary;
        *       stable;
    }

    map "$internal_network:$http_x_internal_beta:$percentage_bucket" $release_variant {
        default       stable;
        "1:1:stable" canary;
        "1:1:canary" canary;
        "0::canary"  canary;
    }

    map $release_variant $target_upstream {
        stable app_stable;
        canary app_canary;
    }

    server {
        listen 443 ssl http2;
        server_name api.example.com;

        access_log /var/log/nginx/access-release.log release_json;

        location / {
            proxy_http_version 1.1;
            proxy_set_header Connection "";

            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header X-Request-ID $request_id;
            proxy_set_header X-Release-Variant $release_variant;

            proxy_pass http://$target_upstream;
        }
    }
}
```

### 31.1 Catatan Tentang Contoh Ini

Ini contoh konseptual yang harus diuji di environment kamu.

Perhatikan:

- header internal beta harus diamankan;
- `proxy_pass` dengan variable harus diuji;
- log tidak boleh memuat data sensitif;
- cache key harus disesuaikan jika response berbeda;
- split berbasis IP/User-Agent belum ideal untuk user-sticky canary;
- untuk user-level rollout serius, gunakan user ID/cookie/feature flag.

---

## 32. CI/CD Integration

Nginx config untuk rollout harus diperlakukan seperti code.

Pipeline minimal:

```text
commit config
  -> lint/static check
  -> nginx -t in container
  -> integration test
  -> deploy config
  -> reload
  -> smoke test
  -> observe
  -> promote/rollback
```

### 32.1 Config Test

```bash
nginx -t -c /etc/nginx/nginx.conf
```

### 32.2 Print Effective Config

```bash
nginx -T
```

Gunakan untuk debugging include order dan config yang sebenarnya aktif.

### 32.3 Smoke Test

Contoh:

```bash
curl -skI https://api.example.com/health
curl -sk https://api.example.com/actuator/info
curl -sk -H 'X-Internal-Beta: 1' https://api.example.com/actuator/info
```

Pastikan response menunjukkan variant yang diharapkan.

---

## 33. Release Runbook Template

Gunakan template seperti ini.

```text
Release: case-service v2.3.0
Date:
Owner:
Nginx config version:
App version stable:
App version canary:
Database migration:
Feature flags:
Rollback owner:
Rollback deadline:
```

### Pre-Release

```text
[ ] v2 deployed but not exposed
[ ] health check OK
[ ] actuator/info shows correct version
[ ] DB migration backward-compatible
[ ] cache key reviewed
[ ] session compatibility reviewed
[ ] shadow/canary side effects reviewed
[ ] logs include release variant
[ ] dashboard ready
[ ] alert threshold ready
[ ] rollback config tested
[ ] support notified
```

### Rollout

```text
[ ] internal beta enabled
[ ] smoke test passed
[ ] 1% canary enabled
[ ] observe 15-30 minutes
[ ] 5% canary enabled
[ ] observe
[ ] 10% canary enabled
[ ] observe
[ ] 25% canary enabled
[ ] observe
[ ] 50% canary enabled
[ ] observe
[ ] 100% enabled
```

### Rollback Trigger

```text
[ ] canary 5xx > stable baseline + threshold
[ ] p95/p99 latency breach
[ ] critical exception spike
[ ] business metric drop
[ ] DB/downstream degradation
[ ] user-impacting support reports
[ ] security anomaly
```

### Post-Release

```text
[ ] stable old version retained for rollback window
[ ] old version retired after window
[ ] temporary routing removed
[ ] canary cookies expired/ignored
[ ] dashboards reviewed
[ ] release notes updated
[ ] incident/learning captured if needed
```

---

## 34. Design Decision Matrix

| Situation | Better Strategy | Why |
|---|---|---|
| Stateless API, low risk | Blue-green | Simple, fast rollback |
| Moderate risk behavior change | Canary | Limits blast radius |
| UI/backend multi-step flow | Sticky canary or feature flag | Avoids inconsistent user journey |
| Tenant-specific platform | Tenant rollout | Aligns with support/data boundary |
| Parser/refactor validation | Shadow traffic | Uses real traffic shape before exposure |
| Risky business feature | Feature flag + canary | Separates binary rollout from behavior exposure |
| Database incompatible change | Do not rely on Nginx | Need migration strategy |
| Long-lived WebSocket | Careful drain/sticky routing | Weighted split may not redistribute quickly |
| Complex policy routing | API gateway/service mesh | Nginx config can become brittle |

---

## 35. Anti-Patterns

### 35.1 Canary Tanpa Metrics

```text
“Kita arahkan 10% dulu, nanti kalau aman naik.”
```

Aman berdasarkan apa?

Tanpa metrics, canary tidak punya nilai engineering.

### 35.2 Semua Logic Release Dipaksa Ke Nginx

Jika config sudah penuh dengan:

- nested maps;
- regex kompleks;
- header magic;
- tenant exception;
- cookie exception;
- path exception;
- emergency rule;
- temporary rule permanen;

mungkin kamu sedang membangun control plane buruk di dalam Nginx config.

### 35.3 Rollback Tidak Diuji

Rollback yang belum pernah diuji adalah asumsi.

Minimal uji:

- config rollback valid;
- old app masih jalan;
- DB kompatibel;
- cache aman;
- session aman;
- monitoring melihat rollback.

### 35.4 Shadow Traffic Ke Write Endpoint

Ini salah satu anti-pattern paling berbahaya.

Jangan mirror write traffic kecuali aplikasi benar-benar shadow-safe.

### 35.5 Menganggap Nginx Bisa Mengganti Feature Flag

Nginx memilih route. Aplikasi memilih behavior.

Jika keputusan bergantung pada user entitlement, subscription, role, tenant policy, atau workflow state, biasanya logic itu milik aplikasi/domain layer, bukan Nginx.

---

## 36. Java-Specific Considerations

### 36.1 Spring Boot

Perhatikan:

- forwarded headers;
- actuator exposure;
- graceful shutdown;
- readiness/liveness;
- version metadata;
- MDC correlation ID;
- response compression conflict;
- session serialization;
- cache headers.

### 36.2 Servlet-Based Apps

Perhatikan:

- thread pool saturation;
- blocking downstream call;
- request body buffering;
- file upload;
- long request timeout;
- graceful connector shutdown;
- session stickiness.

### 36.3 Reactive Apps / Netty / WebFlux

Perhatikan:

- event loop blocking;
- streaming response;
- backpressure;
- SSE buffering;
- connection lifetime;
- timeout alignment;
- CPU saturation from non-blocking workloads.

### 36.4 JVM Rollout Signal

Canary v2 harus dibandingkan dengan v1 untuk:

- heap usage;
- GC pause;
- allocation rate;
- thread count;
- blocked threads;
- connection pool usage;
- DB pool wait time;
- HTTP client pool saturation;
- queue size;
- executor rejection.

Nginx logs hanya melihat permukaan HTTP. JVM metrics melihat dampak internal.

---

## 37. Progressive Delivery Untuk Sistem Workflow/Regulatory

Untuk sistem dengan lifecycle enforcement, case management, escalation, audit, dan SLA, progressive delivery harus lebih ketat daripada CRUD API biasa.

Risiko domain:

- transition state salah;
- escalation logic berubah;
- duplicate enforcement action;
- audit trail tidak lengkap;
- notification regulatory terlambat;
- SLA breach calculation berubah;
- role/permission interpretation berubah;
- document generation tidak konsisten;
- case assignment berubah;
- irreversible status update.

Nginx dapat membatasi exposure, tetapi validasi harus mencakup invariant domain.

Contoh invariant:

```text
A case cannot move from CLOSED back to UNDER_REVIEW without authorized reopen event.
```

```text
Every enforcement action must produce exactly one audit record with actor, timestamp, reason, and source request ID.
```

```text
Escalation deadline calculation must be identical between stable and canary for existing cases.
```

Untuk sistem seperti ini, shadow traffic hanya aman jika side effect benar-benar dimatikan dan hasilnya dibandingkan secara offline.

---

## 38. Latihan Praktik

### Latihan 1 — Blue-Green Switch

Buat dua backend dummy:

```bash
python3 -m http.server 8081
python3 -m http.server 8082
```

Atau gunakan dua Spring Boot app sederhana yang mengembalikan:

```json
{"version":"blue"}
```

Dan:

```json
{"version":"green"}
```

Buat Nginx config untuk switch dari blue ke green dengan reload.

Tujuan:

- memahami switch config;
- memahami reload;
- memahami rollback.

### Latihan 2 — Weighted Canary

Buat upstream:

```nginx
upstream app_canary {
    server 127.0.0.1:8081 weight=9;
    server 127.0.0.1:8082 weight=1;
}
```

Kirim 1000 request:

```bash
for i in $(seq 1 1000); do curl -s http://localhost/; done
```

Hitung distribusi.

Observasi:

- apakah benar 90/10?
- bagaimana jika keepalive aktif?
- bagaimana jika concurrency berubah?

### Latihan 3 — Header-Based Beta

Buat routing:

```text
normal request -> stable
X-Internal-Beta: 1 -> canary
```

Lalu tambahkan guard IP internal.

Tujuan:

- memahami trust boundary header;
- menghindari public spoofing.

### Latihan 4 — Mirror GET Only

Mirror hanya endpoint read-only ke backend shadow.

Pastikan backend shadow mencatat request tetapi tidak menulis state.

Tujuan:

- memahami shadow traffic;
- memahami risiko side effect.

### Latihan 5 — Variant-Aware Logging

Tambahkan `X-Release-Variant` dan access log JSON.

Tujuan:

- bisa menjawab “error ini dari versi mana?”

---

## 39. Checklist Produksi

Sebelum menggunakan Nginx untuk progressive delivery:

```text
[ ] Stable dan canary bisa hidup bersamaan
[ ] Database backward-compatible
[ ] Session compatibility aman
[ ] Cache key reviewed
[ ] Header trust boundary jelas
[ ] Canary cohort jelas
[ ] Observability memisahkan version/variant
[ ] Rollback config siap
[ ] Rollback data aman
[ ] Health/smoke test siap
[ ] Shadow traffic side-effect-safe
[ ] Long-lived connection behavior dipahami
[ ] Support/on-call tahu rollout
[ ] Guardrail metric ditentukan
[ ] Temporary config punya expiry/removal plan
```

---

## 40. Ringkasan Mental Model

Progressive delivery dengan Nginx adalah tentang mengontrol exposure.

Nginx bisa membantu menjawab:

```text
Traffic mana masuk ke versi mana?
```

Tetapi Nginx tidak otomatis menjawab:

```text
Apakah versi ini aman untuk data?
Apakah schema kompatibel?
Apakah side effect aman?
Apakah user journey konsisten?
Apakah rollback benar-benar mungkin?
Apakah business invariant tetap terjaga?
```

Gunakan Nginx sebagai:

- traffic switch;
- blast radius limiter;
- routing boundary;
- observability boundary;
- emergency rollback lever.

Jangan gunakan Nginx sebagai pengganti:

- schema migration discipline;
- feature flag platform;
- domain invariant validation;
- deployment orchestrator;
- release governance;
- application-level safety.

Jika dirancang dengan benar, Nginx memberi kamu kemampuan penting:

```text
deploy != release
release can be gradual
rollback can be fast
risk can be bounded
traffic can be observed
```

Itulah fondasi progressive delivery yang sehat.

---

## 41. Apa Yang Akan Dibahas Berikutnya

Part berikutnya adalah:

```text
Part 024 — Nginx as Lightweight API Gateway
```

Kita akan membahas kapan Nginx cukup sebagai API gateway ringan, bagaimana melakukan routing berbasis path/host/header, rate limiting, auth subrequest, CORS handling, request/response header manipulation, dan kapan harus naik ke API gateway yang lebih lengkap seperti Kong, Spring Cloud Gateway, Envoy, cloud gateway, atau service mesh ingress.

