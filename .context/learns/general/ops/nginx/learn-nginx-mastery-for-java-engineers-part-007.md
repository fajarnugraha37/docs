# learn-nginx-mastery-for-java-engineers-part-007.md

# Part 007 — Reverse Proxy Fundamentals for Java Backends

> Seri: **Nginx Mastery for Java Engineers**  
> Bagian: **007 dari 030**  
> Fokus: memahami Nginx sebagai reverse proxy di depan aplikasi Java/backend secara operasional, bukan hanya menyalin konfigurasi `proxy_pass`.

---

## 0. Posisi Bagian Ini dalam Seri

Pada bagian sebelumnya kita sudah membangun fondasi:

- Part 000: Nginx sebagai traffic runtime.
- Part 001: arsitektur master/worker/event loop.
- Part 002: instalasi, packaging, layout runtime.
- Part 003: grammar konfigurasi, context, inheritance.
- Part 004: pemilihan `server` block.
- Part 005: location matching.
- Part 006: static file serving dan SPA hosting.

Sekarang kita masuk ke salah satu peran Nginx yang paling sering dipakai dalam sistem backend modern:

> **Nginx sebagai reverse proxy di depan aplikasi Java.**

Ini terlihat sederhana:

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:8080;
}
```

Tetapi di production, satu baris itu menyentuh banyak hal:

- URL yang diterima backend.
- Header yang dilihat backend.
- IP client yang tercatat di log.
- Scheme `http` vs `https`.
- Redirect yang dibuat aplikasi.
- Cookie `Secure` dan `SameSite`.
- timeout.
- buffering.
- error 502/504.
- observability.
- security boundary.
- deployment topology.

Bagian ini tidak membahas load balancing secara mendalam. Itu akan masuk Part 009. Di sini fokus kita adalah **single reverse proxy path yang benar dan aman**.

---

## 1. Tujuan Mental Model

Setelah menyelesaikan bagian ini, kamu harus bisa menjawab pertanyaan berikut tanpa menebak:

1. Ketika client mengakses `https://example.com/api/orders/123`, URL apa yang sebenarnya dikirim Nginx ke aplikasi Java?
2. Apa beda `proxy_pass http://app;` dan `proxy_pass http://app/;`?
3. Header apa saja yang wajib dikirim ke backend agar aplikasi Java memahami request eksternal secara benar?
4. Kenapa aplikasi Spring Boot kadang membuat redirect ke `http://` padahal user mengakses `https://`?
5. Kenapa backend melihat IP client sebagai `127.0.0.1` atau IP Nginx, bukan IP user asli?
6. Kenapa `Location` header, cookie path, dan absolute URL bisa rusak setelah aplikasi ditaruh di belakang proxy?
7. Mana yang tanggung jawab Nginx dan mana yang tanggung jawab aplikasi?
8. Apa failure mode paling umum ketika Java backend berada di belakang Nginx?

Mental model utama:

> **Reverse proxy bukan sekadar pipa. Reverse proxy adalah boundary yang menerjemahkan request eksternal menjadi request internal.**

Kalau boundary contract-nya tidak eksplisit, aplikasi akan berperilaku benar di lokal tetapi salah di production.

---

## 2. Apa Itu Reverse Proxy?

### 2.1 Forward Proxy vs Reverse Proxy

**Forward proxy** berada di sisi client.

Contoh:

```text
Browser -> Corporate Proxy -> Internet
```

Client tahu bahwa ia memakai proxy. Proxy mewakili client untuk keluar ke internet.

**Reverse proxy** berada di sisi server.

Contoh:

```text
Internet Client -> Nginx -> Java Application
```

Client tidak perlu tahu bahwa aplikasi sebenarnya berjalan di `localhost:8080`, container internal, private subnet, atau service Kubernetes.

Dari sisi client, ia hanya melihat:

```text
https://example.com
```

Dari sisi arsitektur, request berjalan seperti ini:

```text
Client
  |
  | HTTPS request
  v
Nginx
  |
  | HTTP or HTTPS internal request
  v
Java Backend
```

Nginx menerima request eksternal, lalu membuat request baru ke upstream internal.

Poin penting:

> Backend Java tidak menerima request TCP asli dari browser. Ia menerima request baru dari Nginx.

Artinya banyak informasi asli harus dipreservasi lewat header.

---

## 3. Kenapa Java Backend Biasanya Diletakkan di Belakang Nginx?

Aplikasi Java modern seperti Spring Boot sebenarnya bisa langsung expose port HTTP. Jadi kenapa masih memakai Nginx?

Karena Nginx menyelesaikan banyak concern operasional yang sebaiknya tidak dibebankan ke aplikasi:

| Concern | Ditangani Nginx | Ditangani Java App |
|---|---:|---:|
| TLS termination | Ya | Bisa, tetapi sering tidak ideal |
| Static assets | Ya | Bisa, tetapi kurang efisien untuk edge serving |
| Reverse proxy routing | Ya | Tidak cocok |
| Load balancing | Ya | Tidak |
| Request size limit | Ya | Bisa juga |
| Rate limiting kasar | Ya | Bisa untuk policy bisnis |
| Header normalization | Ya | Sebagian |
| Client IP propagation | Ya, sebagai source | Ya, sebagai consumer |
| Business logic | Tidak | Ya |
| Authentication domain logic | Kadang bantu | Ya |
| Authorization | Tidak ideal | Ya |
| Observability edge timing | Ya | Ya, untuk app timing |
| Cache edge | Ya | Bisa, tetapi beda layer |

Nginx bagus sebagai **traffic boundary**, bukan sebagai tempat semua logic bisnis.

---

## 4. Request Lifecycle: Dari Browser ke Java App

Misalkan user mengakses:

```text
https://shop.example.com/api/orders/123?include=item
```

Dengan konfigurasi:

```nginx
server {
    listen 443 ssl;
    server_name shop.example.com;

    location /api/ {
        proxy_pass http://127.0.0.1:8080;
    }
}
```

Alurnya:

```text
1. Browser membuka koneksi TLS ke Nginx:443
2. Nginx memilih server block berdasarkan listen + SNI/Host
3. Nginx memilih location /api/
4. Nginx membuat request baru ke 127.0.0.1:8080
5. Java app menerima request dari Nginx
6. Java app membuat response
7. Nginx meneruskan response ke browser
```

Yang sering tidak disadari:

```text
Browser tidak connect ke Java app.
Java app tidak melihat TLS browser secara langsung.
Java app tidak melihat IP client asli secara langsung.
Java app tidak otomatis tahu public host/scheme/port.
```

Jadi Nginx harus menyampaikan metadata eksternal secara eksplisit.

---

## 5. Directive Inti: `proxy_pass`

Nginx menyediakan modul `ngx_http_proxy_module` untuk meneruskan request ke server lain. Directive paling pentingnya adalah:

```nginx
proxy_pass http://backend;
```

Bentuk umum:

```nginx
location /some/path/ {
    proxy_pass http://upstream-address;
}
```

Upstream address bisa berupa:

```nginx
proxy_pass http://127.0.0.1:8080;
proxy_pass http://localhost:8080;
proxy_pass http://app.internal:8080;
proxy_pass http://backend_pool;
proxy_pass https://backend.example.internal;
proxy_pass http://unix:/run/app.sock:;
```

Contoh paling kecil:

```nginx
server {
    listen 80;
    server_name api.example.com;

    location / {
        proxy_pass http://127.0.0.1:8080;
    }
}
```

Ini berarti semua request ke `api.example.com` diteruskan ke aplikasi di port `8080`.

---

## 6. `proxy_pass` URI Semantics: Bagian yang Paling Sering Menjebak

Ini bagian yang harus benar-benar dipahami.

Nginx punya dua bentuk besar `proxy_pass`:

```nginx
proxy_pass http://backend;
```

versus:

```nginx
proxy_pass http://backend/;
```

Perbedaan trailing slash dapat mengubah URI yang diterima backend.

---

## 7. Case A: `proxy_pass` Tanpa URI

Konfigurasi:

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:8080;
}
```

Request client:

```text
GET /api/orders/123?include=item
```

Request ke backend:

```text
GET /api/orders/123?include=item
```

Karena `proxy_pass` tidak menyertakan URI path setelah host, Nginx meneruskan URI asli apa adanya.

Mental model:

```text
client URI dipertahankan
```

Cocok jika aplikasi Java memang expose endpoint dengan prefix `/api`.

Contoh Spring Boot:

```java
@RestController
@RequestMapping("/api/orders")
class OrderController {
    @GetMapping("/{id}")
    OrderDto get(@PathVariable String id) {
        ...
    }
}
```

Maka konfigurasi ini cocok:

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:8080;
}
```

---

## 8. Case B: `proxy_pass` Dengan URI `/`

Konfigurasi:

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:8080/;
}
```

Request client:

```text
GET /api/orders/123?include=item
```

Request ke backend:

```text
GET /orders/123?include=item
```

Kenapa?

Karena Nginx mengganti prefix location `/api/` dengan URI di `proxy_pass`, yaitu `/`.

Mental model:

```text
/api/ di sisi publik di-strip sebelum masuk backend
```

Cocok jika aplikasi Java expose endpoint tanpa prefix `/api`.

Contoh Spring Boot:

```java
@RestController
@RequestMapping("/orders")
class OrderController {
    @GetMapping("/{id}")
    OrderDto get(@PathVariable String id) {
        ...
    }
}
```

Maka konfigurasi ini cocok:

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:8080/;
}
```

Public URL:

```text
/api/orders/123
```

Internal backend URL:

```text
/orders/123
```

---

## 9. Case C: `proxy_pass` Dengan URI Non-Root

Konfigurasi:

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:8080/internal/;
}
```

Request client:

```text
GET /api/orders/123
```

Request ke backend:

```text
GET /internal/orders/123
```

Mental model:

```text
public prefix /api/ diganti dengan backend prefix /internal/
```

Ini bisa berguna, tetapi sering membuat sistem sulit dipahami jika tidak didokumentasikan.

---

## 10. Quick Matrix: `location` + `proxy_pass`

| Client URI | Config | Backend URI |
|---|---|---|
| `/api/orders/1` | `location /api/ { proxy_pass http://app; }` | `/api/orders/1` |
| `/api/orders/1` | `location /api/ { proxy_pass http://app/; }` | `/orders/1` |
| `/api/orders/1` | `location /api/ { proxy_pass http://app/internal/; }` | `/internal/orders/1` |
| `/api/orders/1` | `location / { proxy_pass http://app; }` | `/api/orders/1` |
| `/api/orders/1` | `location / { proxy_pass http://app/; }` | `/api/orders/1` |

Perhatikan baris terakhir:

```nginx
location / {
    proxy_pass http://app/;
}
```

Untuk `location /`, prefix yang diganti adalah `/`, lalu diganti dengan `/`, sehingga hasilnya tetap sama.

---

## 11. Rule of Thumb untuk Java Backend

Gunakan salah satu dari dua style secara konsisten.

### Style 1: Backend sadar public prefix

Public:

```text
/api/orders/1
```

Backend:

```text
/api/orders/1
```

Nginx:

```nginx
location /api/ {
    proxy_pass http://app:8080;
}
```

Java:

```java
@RequestMapping("/api/orders")
```

Kelebihan:

- Sederhana.
- Backend log sama dengan public URL.
- Cocok jika service memang didesain dengan context path `/api`.

Kekurangan:

- Public path coupling masuk ke aplikasi.
- Jika gateway path berubah, aplikasi ikut berubah.

### Style 2: Nginx strip public prefix

Public:

```text
/api/orders/1
```

Backend:

```text
/orders/1
```

Nginx:

```nginx
location /api/ {
    proxy_pass http://app:8080/;
}
```

Java:

```java
@RequestMapping("/orders")
```

Kelebihan:

- Aplikasi tidak perlu tahu public prefix.
- Cocok untuk internal service yang dipasang di banyak route.

Kekurangan:

- Debugging perlu sadar ada path translation.
- Absolute links dari aplikasi bisa salah jika aplikasi membuat URL sendiri.

Untuk engineer senior, yang penting bukan memilih salah satu secara dogmatis, tetapi membuat **boundary contract eksplisit**.

---

## 12. Jangan Campur Tanpa Alasan

Anti-pattern:

```nginx
location /api/user/ {
    proxy_pass http://user-service:8080/;
}

location /api/order/ {
    proxy_pass http://order-service:8080;
}
```

Yang terjadi:

```text
/api/user/profile  -> /profile
/api/order/123     -> /api/order/123
```

Dua service menerima pola path berbeda.

Ini bisa saja valid, tetapi harus sadar. Kalau tidak, hasilnya adalah:

- kontrak tidak konsisten,
- dokumentasi API membingungkan,
- reverse proxy sulit dites,
- bug muncul ketika service dipindah gateway,
- observability lintas service sulit dibandingkan.

Prinsip:

> Jangan jadikan trailing slash sebagai behavior tersembunyi. Jadikan ia keputusan desain.

---

## 13. Header Forwarding: Nginx Tidak Otomatis Menyampaikan Semua Metadata yang Kamu Butuhkan

Konfigurasi minimal reverse proxy sering terlihat seperti ini:

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
}
```

Ini bisa berjalan, tetapi belum cukup untuk production.

Aplikasi Java sering membutuhkan informasi seperti:

- host publik,
- scheme publik,
- port publik,
- IP client asli,
- request ID,
- original URI,
- apakah request datang lewat HTTPS,
- apakah request sudah melalui proxy tepercaya.

Tanpa header forwarding yang benar, aplikasi bisa salah dalam:

- redirect URL,
- OAuth callback,
- generated HATEOAS link,
- OpenAPI/Swagger URL,
- cookie `Secure`,
- audit logging,
- rate limiting application-level,
- geolocation,
- fraud detection,
- authorization berbasis IP,
- allowlist admin endpoint.

---

## 14. Header Set Dasar yang Umum Dipakai

Konfigurasi umum:

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;

    proxy_http_version 1.1;

    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host  $host;
    proxy_set_header X-Forwarded-Port  $server_port;
}
```

Mari bedah satu per satu.

---

## 15. `Host`: Identitas Host yang Dilihat Backend

```nginx
proxy_set_header Host $host;
```

`Host` adalah host publik yang dikirim client, misalnya:

```text
shop.example.com
```

Jika tidak diset dengan benar, backend bisa melihat host upstream internal:

```text
127.0.0.1:8080
```

atau:

```text
app:8080
```

Dampaknya:

- generated links salah,
- redirect salah,
- virtual host logic salah,
- tenant resolution salah,
- OAuth redirect URI salah,
- absolute URL di email/webhook salah.

Untuk aplikasi multi-tenant yang memilih tenant berdasarkan domain:

```java
String host = request.getServerName();
Tenant tenant = tenantResolver.resolve(host);
```

maka `Host` sangat kritikal.

Catatan penting:

- `$host` adalah normalized host menurut Nginx.
- `$http_host` adalah nilai mentah header `Host` dari client.

Umumnya gunakan:

```nginx
proxy_set_header Host $host;
```

Jika butuh mempertahankan port dari Host header, kadang digunakan:

```nginx
proxy_set_header Host $http_host;
```

Tetapi `$http_host` lebih dekat ke input client mentah, sehingga perlu lebih hati-hati.

---

## 16. `X-Real-IP`: IP Peer yang Terlihat oleh Nginx

```nginx
proxy_set_header X-Real-IP $remote_addr;
```

`$remote_addr` adalah IP peer yang connect langsung ke Nginx.

Jika Nginx langsung menerima traffic dari internet:

```text
client -> Nginx
```

maka `$remote_addr` adalah IP client.

Jika ada load balancer/CDN di depan:

```text
client -> CDN -> Cloud LB -> Nginx
```

maka `$remote_addr` kemungkinan adalah IP load balancer, bukan IP user asli.

Jadi `X-Real-IP` berguna, tetapi hanya benar jika topologi trust chain sudah benar.

---

## 17. `X-Forwarded-For`: Chain IP Client dan Proxy

```nginx
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

Header ini biasanya berisi daftar IP:

```text
X-Forwarded-For: client-ip, proxy-1, proxy-2
```

Variable `$proxy_add_x_forwarded_for` berarti:

```text
existing X-Forwarded-For + current $remote_addr
```

Jika request datang tanpa header `X-Forwarded-For`:

```text
$proxy_add_x_forwarded_for = $remote_addr
```

Jika request sudah membawa:

```text
X-Forwarded-For: 203.0.113.10
```

lalu peer langsung ke Nginx adalah:

```text
10.0.0.5
```

maka backend menerima:

```text
X-Forwarded-For: 203.0.113.10, 10.0.0.5
```

Masalah keamanan:

> Client bisa memalsukan `X-Forwarded-For` jika Nginx menerima header itu dari internet tanpa sanitasi/trust policy.

Karena itu aplikasi tidak boleh asal percaya elemen pertama `X-Forwarded-For` kecuali chain proxy sudah didefinisikan.

Part 008 akan membahas kontrak header dan trust boundary lebih dalam.

---

## 18. `X-Forwarded-Proto`: Scheme Publik

```nginx
proxy_set_header X-Forwarded-Proto $scheme;
```

Jika user mengakses:

```text
https://shop.example.com
```

Nginx menerima HTTPS, lalu meneruskan ke backend dengan HTTP internal:

```text
Nginx -> http://127.0.0.1:8080
```

Dari sisi backend, koneksi langsungnya adalah HTTP. Tanpa header tambahan, aplikasi bisa mengira request publik juga HTTP.

Akibatnya:

- redirect ke `http://` bukan `https://`,
- generated absolute URL salah,
- cookie `Secure` tidak dibuat,
- Swagger/OpenAPI server URL salah,
- OAuth callback salah,
- Spring Security redirect salah.

`X-Forwarded-Proto` memberi tahu backend:

```text
Original external scheme was https
```

Tetapi aplikasi harus dikonfigurasi untuk mempercayainya.

Contoh Spring Boot:

```properties
server.forward-headers-strategy=framework
```

atau pada environment tertentu:

```properties
server.forward-headers-strategy=native
```

Pilihan `framework` vs `native` bergantung pada stack dan container. Yang penting: jangan mengasumsikan Spring Boot otomatis selalu memakai forwarded headers dengan benar di semua deployment.

---

## 19. `X-Forwarded-Host` dan `X-Forwarded-Port`

```nginx
proxy_set_header X-Forwarded-Host $host;
proxy_set_header X-Forwarded-Port $server_port;
```

`X-Forwarded-Host` menyampaikan host publik.

`X-Forwarded-Port` menyampaikan port publik yang diterima Nginx.

Contoh:

```text
https://shop.example.com
```

Umumnya port publik adalah `443`.

Tetapi hati-hati di container:

```text
Host machine: 8443 -> container: 443
```

Di dalam container, `$server_port` mungkin `443`, sementara public port user adalah `8443`.

Di balik cloud load balancer:

```text
client -> LB:443 -> Nginx:80 -> app:8080
```

Nginx menerima port `80`, tetapi public port adalah `443`.

Maka `X-Forwarded-Port $server_port` bisa salah jika Nginx bukan edge TLS terminator pertama.

Dalam topologi seperti itu, lebih baik boundary diatur jelas:

```nginx
proxy_set_header X-Forwarded-Proto https;
proxy_set_header X-Forwarded-Port 443;
```

atau menerima header tepercaya dari load balancer setelah disanitasi.

---

## 20. The Boundary Contract

Reverse proxy contract minimal:

```text
Nginx guarantees to backend:

1. Host header represents the public host.
2. X-Forwarded-Proto represents the public scheme.
3. X-Forwarded-For represents the proxy chain according to trust policy.
4. X-Real-IP represents the immediate trusted client as seen by Nginx.
5. URI mapping is documented: preserve prefix or strip prefix.
6. Request body size limit is enforced before backend.
7. Timeouts are aligned with backend latency budget.
```

Backend guarantees to Nginx:

```text
Java app guarantees:

1. It understands forwarded headers only from trusted proxies.
2. It does not trust arbitrary client-supplied forwarding headers.
3. It emits redirects and absolute URLs using external scheme/host.
4. It exposes health/readiness endpoints separately from business endpoints.
5. It handles graceful shutdown/drain.
6. It documents whether it expects public path prefix or stripped prefix.
```

Tanpa contract seperti ini, Nginx config dan Java code akan saling menebak.

---

## 21. Common Java Bug: Redirect ke HTTP setelah TLS Termination

Topologi:

```text
Browser --HTTPS--> Nginx --HTTP--> Spring Boot
```

User mengakses:

```text
https://example.com/login
```

Spring Security membuat redirect:

```text
Location: http://example.com/login?continue
```

Kenapa?

Karena dari perspektif servlet container, request langsungnya adalah HTTP.

Solusi tidak cukup hanya di Nginx. Perlu dua sisi:

Nginx:

```nginx
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host  $host;
proxy_set_header X-Forwarded-Port  $server_port;
```

Spring Boot:

```properties
server.forward-headers-strategy=framework
```

atau sesuai deployment:

```properties
server.forward-headers-strategy=native
```

Lalu test:

```bash
curl -I https://example.com/login
```

Pastikan response redirect memakai:

```text
Location: https://example.com/...
```

bukan:

```text
Location: http://127.0.0.1:8080/...
```

atau:

```text
Location: http://example.com/...
```

---

## 22. Common Java Bug: Client IP Selalu IP Nginx

Topologi:

```text
Client -> Nginx -> Spring Boot
```

Di Java:

```java
request.getRemoteAddr();
```

Hasil:

```text
127.0.0.1
```

atau:

```text
10.0.1.20
```

Itu benar secara TCP, karena peer langsung backend adalah Nginx.

Jika aplikasi butuh IP asli, harus baca forwarded header dengan trust policy.

Nginx:

```nginx
proxy_set_header X-Real-IP       $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

Spring/Tomcat perlu dikonfigurasi agar memahami header tersebut.

Tetapi jangan langsung:

```java
String ip = request.getHeader("X-Forwarded-For").split(",")[0];
```

sebagai policy keamanan. Itu raw, mudah dipalsukan jika boundary salah.

Gunakan mekanisme framework/container yang mendukung trusted proxy, atau buat resolver yang eksplisit.

---

## 23. Common Java Bug: Swagger/OpenAPI Server URL Salah

Gejala:

Swagger UI mencoba call:

```text
http://localhost:8080/api/...
```

atau:

```text
http://app:8080/api/...
```

padahal user membuka:

```text
https://api.example.com
```

Penyebab umum:

- `Host` tidak dipreservasi.
- `X-Forwarded-Proto` tidak dikirim.
- Spring tidak dikonfigurasi untuk forwarded headers.
- aplikasi generate server URL dari internal request.
- public base path tidak sesuai dengan backend context path.

Solusi:

- Pastikan proxy headers benar.
- Pastikan framework memproses headers.
- Jika perlu, set explicit server/base URL di OpenAPI config.
- Jangan biarkan internal hostname bocor ke client.

---

## 24. Common Java Bug: Cookie Tidak Secure

Topologi:

```text
Browser --HTTPS--> Nginx --HTTP--> Java App
```

Aplikasi membuat cookie session:

```text
Set-Cookie: JSESSIONID=abc; Path=/; HttpOnly
```

Tidak ada `Secure`.

Browser masih bisa menyimpannya, tetapi cookie tidak dibatasi hanya HTTPS.

Penyebab:

- aplikasi mengira request adalah HTTP,
- forwarded proto tidak diproses,
- cookie policy tidak dikonfigurasi eksplisit.

Solusi:

Nginx:

```nginx
proxy_set_header X-Forwarded-Proto https;
```

Spring Boot:

```properties
server.forward-headers-strategy=framework
server.servlet.session.cookie.secure=true
```

atau gunakan policy environment-aware sesuai deployment.

Catatan: jangan hanya mengandalkan forwarded header untuk security-critical behavior tanpa trust boundary.

---

## 25. Common Java Bug: Context Path dan Public Prefix Tidak Sinkron

Public URL:

```text
https://example.com/api/orders
```

Backend endpoint:

```text
/orders
```

Nginx strip prefix:

```nginx
location /api/ {
    proxy_pass http://app:8080/;
}
```

Aplikasi membuat redirect:

```text
Location: /login
```

Browser pergi ke:

```text
https://example.com/login
```

Padahal seharusnya:

```text
https://example.com/api/login
```

Ini bukan sekadar masalah Nginx. Ini masalah **base path ownership**.

Ada beberapa strategi:

### Strategi A: Aplikasi sadar prefix

```properties
server.servlet.context-path=/api
```

Nginx preserve URI:

```nginx
location /api/ {
    proxy_pass http://app:8080;
}
```

### Strategi B: Nginx strip prefix, aplikasi tidak membuat absolute/prefix-sensitive redirect

```nginx
location /api/ {
    proxy_pass http://app:8080/;
}
```

Aplikasi API murni JSON, bukan web app yang redirect banyak path.

### Strategi C: Gunakan forwarded prefix

Beberapa framework mendukung header semacam:

```text
X-Forwarded-Prefix: /api
```

Nginx:

```nginx
proxy_set_header X-Forwarded-Prefix /api;
```

Namun support-nya bergantung framework/library. Jangan diasumsikan tanpa test.

---

## 26. `proxy_http_version`: Kenapa Sering Diset 1.1?

Default proxy HTTP version bisa berbeda dari yang diinginkan untuk fitur tertentu. Banyak konfigurasi production menyertakan:

```nginx
proxy_http_version 1.1;
```

Ini penting untuk beberapa kasus:

- upstream keepalive,
- WebSocket upgrade,
- beberapa behavior connection header.

Untuk reverse proxy API biasa, request mungkin tetap berjalan tanpa ini. Tetapi sebagai baseline production, sering lebih eksplisit:

```nginx
proxy_http_version 1.1;
```

Namun jangan menambahkan config cargo-cult tanpa memahami efeknya. Untuk WebSocket, perlu tambahan header khusus yang akan dibahas di Part 022.

---

## 27. `Connection` Header: Jangan Salah Forward

Hop-by-hop headers seperti `Connection` tidak seharusnya diteruskan sembarangan antar hop.

Konfigurasi umum untuk backend biasa:

```nginx
proxy_set_header Connection "";
```

Untuk WebSocket berbeda:

```nginx
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
```

Jangan memakai config WebSocket global untuk semua endpoint tanpa alasan.

Lebih baik pisahkan:

```nginx
location /api/ {
    proxy_pass http://app:8080;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
}

location /ws/ {
    proxy_pass http://app:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

Part 022 akan membahas long-lived connection secara mendalam.

---

## 28. Minimal Production-Grade Reverse Proxy untuk Spring Boot API

Contoh baseline:

```nginx
server {
    listen 80;
    server_name api.example.com;

    location / {
        proxy_pass http://127.0.0.1:8080;

        proxy_http_version 1.1;

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host  $host;
        proxy_set_header X-Forwarded-Port  $server_port;

        proxy_set_header Connection "";
    }
}
```

Spring Boot:

```properties
server.forward-headers-strategy=framework
```

Jika Nginx terminate HTTPS:

```nginx
server {
    listen 443 ssl http2;
    server_name api.example.com;

    ssl_certificate     /etc/nginx/certs/api.example.com/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/api.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;

        proxy_http_version 1.1;

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host  $host;
        proxy_set_header X-Forwarded-Port  $server_port;

        proxy_set_header Connection "";
    }
}
```

HTTP to HTTPS redirect:

```nginx
server {
    listen 80;
    server_name api.example.com;
    return 301 https://$host$request_uri;
}
```

Catatan: TLS detail akan dibahas di Part 012.

---

## 29. Reverse Proxy untuk SPA + Java API

Topologi umum:

```text
Nginx
  ├── serve static Vue/React build
  └── proxy /api/ to Spring Boot
```

Config:

```nginx
server {
    listen 443 ssl http2;
    server_name app.example.com;

    root /var/www/app;
    index index.html;

    location /assets/ {
        try_files $uri =404;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8080;

        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host  $host;
        proxy_set_header X-Forwarded-Port  $server_port;
        proxy_set_header Connection "";
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Perhatikan urutan konseptual:

- `/assets/` dilayani static dengan cache panjang.
- `/api/` diproxy ke Java.
- `/` fallback ke SPA.

Jangan sampai `/api/` jatuh ke SPA fallback.

---

## 30. Reverse Proxy dengan Prefix Strip untuk API Gateway Ringan

Misal public route:

```text
/users/**  -> user-service
/orders/** -> order-service
```

Tetapi masing-masing service internal expose endpoint tanpa prefix gateway:

```text
user-service:  /profile, /settings
order-service: /orders, /payments
```

Config:

```nginx
location /users/ {
    proxy_pass http://user-service:8080/;

    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Prefix /users;
}

location /orders/ {
    proxy_pass http://order-service:8080/;

    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Prefix /orders;
}
```

Request mapping:

```text
/users/profile      -> user-service /profile
/orders/123         -> order-service /123
```

Potential issue:

```text
/orders/123 -> /123
```

Jika order-service sebenarnya expect `/orders/123`, config ini salah. Harus gunakan:

```nginx
location /orders/ {
    proxy_pass http://order-service:8080;
}
```

Itulah kenapa matrix mapping harus dites.

---

## 31. Testing URI Mapping dengan Echo Backend

Sebelum menghubungkan ke aplikasi Java asli, gunakan echo backend untuk melihat request yang diterima upstream.

Contoh dengan container sederhana:

```bash
docker run --rm -p 8080:80 ealen/echo-server
```

Lalu Nginx:

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:8080/;
}
```

Test:

```bash
curl -i http://localhost/api/orders/123?include=item
```

Lihat body response echo:

- path apa yang diterima,
- query string apa yang diterima,
- header apa yang diterima,
- host apa yang diterima,
- forwarded headers apa yang diterima.

Untuk production-grade engineer, ini lebih baik daripada berdebat dari ingatan.

---

## 32. Testing dengan Spring Boot Minimal

Controller:

```java
@RestController
class DebugController {

    @GetMapping("/debug/request")
    Map<String, Object> debug(HttpServletRequest request) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("requestURI", request.getRequestURI());
        result.put("requestURL", request.getRequestURL().toString());
        result.put("scheme", request.getScheme());
        result.put("serverName", request.getServerName());
        result.put("serverPort", request.getServerPort());
        result.put("remoteAddr", request.getRemoteAddr());
        result.put("xForwardedFor", request.getHeader("X-Forwarded-For"));
        result.put("xForwardedProto", request.getHeader("X-Forwarded-Proto"));
        result.put("xForwardedHost", request.getHeader("X-Forwarded-Host"));
        result.put("xForwardedPort", request.getHeader("X-Forwarded-Port"));
        return result;
    }
}
```

Nginx:

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:8080;

    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host  $host;
    proxy_set_header X-Forwarded-Port  $server_port;
}
```

Test:

```bash
curl -s http://localhost/api/debug/request | jq
```

Yang ingin dilihat:

```json
{
  "requestURI": "/api/debug/request",
  "scheme": "http",
  "serverName": "localhost",
  "serverPort": 80,
  "remoteAddr": "...",
  "xForwardedFor": "...",
  "xForwardedProto": "http",
  "xForwardedHost": "localhost",
  "xForwardedPort": "80"
}
```

Setelah `server.forward-headers-strategy` aktif, nilai `scheme`, `serverName`, dan `serverPort` yang dilihat framework bisa berubah mengikuti forwarded headers.

---

## 33. Upstream Address: `localhost` vs `127.0.0.1` vs Service Name

Contoh:

```nginx
proxy_pass http://localhost:8080;
```

vs:

```nginx
proxy_pass http://127.0.0.1:8080;
```

vs:

```nginx
proxy_pass http://app:8080;
```

Perbedaannya penting.

### `127.0.0.1`

Berarti backend berjalan di host/network namespace yang sama dengan Nginx.

Cocok untuk:

```text
Nginx dan app di VM yang sama
```

atau:

```text
Nginx dan app di container yang sama
```

Tidak cocok jika Nginx dan app ada di container berbeda. Di container Nginx, `127.0.0.1` berarti container Nginx sendiri, bukan container app.

### `localhost`

Bisa resolve ke IPv4 atau IPv6 tergantung sistem:

```text
127.0.0.1
::1
```

Jika app hanya listen IPv4, tapi Nginx mencoba IPv6, bisa muncul connection refused.

Untuk menghindari ambiguitas, gunakan IP eksplisit atau upstream/service name yang jelas.

### `app:8080`

Di Docker Compose/Kubernetes, `app` bisa resolve ke service/container name.

Contoh Docker Compose:

```yaml
services:
  nginx:
    image: nginx
    ports:
      - "80:80"
  app:
    image: my-spring-app
    expose:
      - "8080"
```

Nginx:

```nginx
proxy_pass http://app:8080;
```

---

## 34. DNS Resolution Trap di Nginx

Jika `proxy_pass` memakai hostname static:

```nginx
proxy_pass http://app.example.internal:8080;
```

Nginx biasanya resolve saat startup/reload, bukan setiap request.

Jika IP upstream berubah, Nginx mungkin tetap memakai IP lama sampai reload.

Di environment dinamis, gunakan pendekatan yang sesuai:

- upstream block dengan reload dari orchestrator,
- resolver directive untuk dynamic resolution pada kasus tertentu,
- service discovery dari platform,
- Kubernetes Service stable DNS,
- NGINX Ingress Controller jika di Kubernetes.

Ini akan dibahas lebih dalam di Part 009 dan Part 025.

---

## 35. Error 502, 503, 504: Membaca dari Perspektif Proxy

### 502 Bad Gateway

Biasanya berarti Nginx gagal mendapatkan response valid dari upstream.

Penyebab umum:

- backend mati,
- port salah,
- connection refused,
- upstream reset connection,
- response header invalid,
- TLS mismatch ke upstream,
- backend crash saat request.

Debug:

```bash
curl -i http://127.0.0.1:8080/health
ss -ltnp | grep 8080
journalctl -u nginx
cat /var/log/nginx/error.log
```

### 503 Service Unavailable

Bisa berasal dari Nginx atau upstream.

Penyebab:

- upstream group tidak punya server available,
- maintenance mode,
- application returns 503,
- rate/connection limit tertentu.

### 504 Gateway Timeout

Nginx berhasil connect ke upstream, tetapi upstream terlalu lama merespons.

Penyebab:

- aplikasi lambat,
- DB lambat,
- deadlock,
- thread pool exhausted,
- GC pause,
- downstream dependency hang,
- `proxy_read_timeout` terlalu rendah atau justru app tidak punya timeout internal.

Prinsip:

> 502 biasanya connectivity/protocol failure. 504 biasanya latency/deadline failure.

Tidak selalu 100%, tapi cukup sebagai starting hypothesis.

---

## 36. Timeout Baseline: Jangan Abaikan

Walaupun timeout akan dibahas detail di Part 010, reverse proxy minimal perlu sadar timeout.

Contoh:

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;

    proxy_connect_timeout 3s;
    proxy_send_timeout    30s;
    proxy_read_timeout    30s;
}
```

Makna kasar:

- `proxy_connect_timeout`: waktu maksimum untuk connect ke upstream.
- `proxy_send_timeout`: waktu maksimum mengirim request ke upstream.
- `proxy_read_timeout`: waktu maksimum menunggu response dari upstream antar operasi read.

Jangan set semua ke angka besar seperti:

```nginx
proxy_read_timeout 300s;
```

tanpa alasan. Itu bisa menahan connection lama dan menyembunyikan backend hang.

Untuk API biasa:

```text
client timeout >= proxy timeout >= app timeout >= downstream timeout?
```

Sebenarnya desain timeout budget lebih halus dari itu, tetapi prinsipnya:

> Layer dalam harus gagal cukup cepat agar layer luar tidak menggantung tanpa informasi.

---

## 37. Buffering: Kenapa Request/Response Streaming Bisa Tidak Seperti yang Kamu Kira

Secara default, Nginx dapat melakukan buffering untuk request/response proxy.

Dampaknya:

- backend tidak selalu menerima body secara streaming dari client,
- client tidak selalu menerima response chunk segera saat app menulis,
- Nginx bisa menulis temporary file jika response besar,
- latency streaming bisa berubah,
- memory/disk usage perlu diperhatikan.

Untuk API JSON biasa, buffering sering membantu:

- melindungi upstream dari slow client,
- membuat koneksi upstream lebih cepat selesai,
- mengurangi coupling antara client lambat dan app server.

Untuk streaming endpoint seperti SSE:

```nginx
proxy_buffering off;
```

mungkin diperlukan.

Tetapi jangan disable buffering global tanpa memahami efeknya.

Part 010 dan Part 022 akan membahas ini lebih mendalam.

---

## 38. Request Body Size: Lindungi Java App dari Payload Berlebih

Contoh:

```nginx
client_max_body_size 10m;
```

Jika request body melebihi limit, Nginx akan menolak sebelum sampai ke Java app.

Kenapa penting?

- upload besar bisa menghabiskan memory/disk,
- JSON payload abnormal bisa menyebabkan parsing cost besar,
- Java thread bisa tertahan membaca body,
- malicious client bisa abuse endpoint.

Tetapi harus disesuaikan per endpoint.

Contoh:

```nginx
location /api/upload/ {
    client_max_body_size 100m;
    proxy_pass http://app:8080;
}

location /api/ {
    client_max_body_size 2m;
    proxy_pass http://app:8080;
}
```

Jangan pakai limit upload besar secara global jika hanya satu endpoint yang membutuhkannya.

---

## 39. Response Header Rewriting

Kadang upstream mengembalikan header internal:

```text
Location: http://127.0.0.1:8080/login
```

Nginx punya kemampuan seperti `proxy_redirect` untuk rewrite header `Location` dan `Refresh`.

Contoh:

```nginx
proxy_redirect http://127.0.0.1:8080/ https://example.com/;
```

Namun ini sebaiknya bukan solusi utama untuk aplikasi modern.

Lebih baik aplikasi memahami external scheme/host melalui forwarded headers.

Gunakan header rewriting sebagai:

- compatibility layer,
- migrasi legacy app,
- containment sementara,
- integrasi app yang tidak bisa diubah.

Bukan sebagai pengganti contract yang sehat.

---

## 40. Cookie Path/Domain Rewriting

Jika backend mengirim:

```text
Set-Cookie: SESSION=abc; Path=/internal
```

sedangkan public path adalah:

```text
/app
```

Nginx bisa rewrite cookie path:

```nginx
proxy_cookie_path /internal /app;
```

Atau rewrite domain:

```nginx
proxy_cookie_domain internal.local example.com;
```

Tetapi sama seperti `proxy_redirect`, ini sebaiknya untuk kasus legacy/edge compatibility.

Untuk aplikasi Java yang kamu kontrol, lebih baik set cookie path/domain dengan benar dari aplikasi berdasarkan deployment contract.

---

## 41. Reverse Proxy Bukan Authorization Boundary yang Cukup

Nginx bisa membatasi path:

```nginx
location /admin/ {
    allow 10.0.0.0/8;
    deny all;
    proxy_pass http://app:8080;
}
```

Ini berguna, tetapi jangan jadikan satu-satunya authorization untuk domain logic.

Kenapa?

- config bisa berubah,
- route bisa muncul di path lain,
- internal caller bisa bypass Nginx,
- aplikasi bisa diekspos langsung karena salah security group,
- ada multiple ingress path.

Prinsip:

```text
Nginx can enforce coarse edge policy.
Application must enforce business authorization.
```

---

## 42. Health Check Endpoint

Untuk reverse proxy lokal, kamu tetap butuh health endpoint.

Spring Boot Actuator:

```text
/actuator/health
```

Nginx bisa expose atau hide.

Contoh expose minimal:

```nginx
location = /healthz {
    proxy_pass http://127.0.0.1:8080/actuator/health;
    access_log off;
}
```

Contoh tidak expose actuator penuh:

```nginx
location /actuator/ {
    deny all;
}
```

Lalu hanya map endpoint tertentu:

```nginx
location = /healthz {
    proxy_pass http://127.0.0.1:8080/actuator/health/readiness;
}
```

Jangan expose `/actuator/env`, `/actuator/beans`, `/actuator/configprops`, atau endpoint sensitif ke publik.

---

## 43. Access Log: Tambahkan Upstream Visibility

Default access log kurang cukup untuk reverse proxy debugging.

Gunakan log format yang memuat upstream info:

```nginx
log_format proxy_main
    '$remote_addr - $remote_user [$time_local] '
    '"$request" $status $body_bytes_sent '
    '"$http_referer" "$http_user_agent" '
    'host="$host" '
    'request_time=$request_time '
    'upstream_addr="$upstream_addr" '
    'upstream_status="$upstream_status" '
    'upstream_connect_time="$upstream_connect_time" '
    'upstream_header_time="$upstream_header_time" '
    'upstream_response_time="$upstream_response_time" '
    'xff="$http_x_forwarded_for"';

access_log /var/log/nginx/access.log proxy_main;
```

Dengan ini kamu bisa membedakan:

```text
Nginx lambat?
Backend lambat?
Client lambat?
Upstream tidak bisa connect?
```

Part 019 akan membahas observability secara khusus.

---

## 44. Request ID / Correlation ID

Untuk sistem Java production, korelasi log sangat penting.

Nginx bisa meneruskan request ID:

```nginx
proxy_set_header X-Request-ID $request_id;
```

Atau jika sudah ada dari upstream/CDN:

```nginx
map $http_x_request_id $req_id {
    default $http_x_request_id;
    ""      $request_id;
}

proxy_set_header X-Request-ID $req_id;
```

Lalu di Java:

- baca `X-Request-ID`,
- masukkan ke MDC,
- log semua request dengan correlation ID,
- teruskan ke downstream service.

Contoh filter Spring:

```java
@Component
class RequestIdFilter extends OncePerRequestFilter {
    @Override
    protected void doFilterInternal(
        HttpServletRequest request,
        HttpServletResponse response,
        FilterChain filterChain
    ) throws ServletException, IOException {
        String requestId = Optional
            .ofNullable(request.getHeader("X-Request-ID"))
            .filter(s -> !s.isBlank())
            .orElse(UUID.randomUUID().toString());

        MDC.put("requestId", requestId);
        response.setHeader("X-Request-ID", requestId);
        try {
            filterChain.doFilter(request, response);
        } finally {
            MDC.remove("requestId");
        }
    }
}
```

Ini bukan hanya logging convenience. Saat incident, request ID adalah alat navigasi.

---

## 45. Reverse Proxy untuk Multiple Java Apps

Contoh:

```text
app.example.com/api/users/**  -> user-service:8080
app.example.com/api/orders/** -> order-service:8080
app.example.com/             -> frontend static
```

Config:

```nginx
upstream user_service {
    server user-service:8080;
}

upstream order_service {
    server order-service:8080;
}

server {
    listen 443 ssl http2;
    server_name app.example.com;

    root /var/www/app;

    location /api/users/ {
        proxy_pass http://user_service;
        include snippets/proxy-headers.conf;
    }

    location /api/orders/ {
        proxy_pass http://order_service;
        include snippets/proxy-headers.conf;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Snippet:

```nginx
# /etc/nginx/snippets/proxy-headers.conf
proxy_http_version 1.1;
proxy_set_header Host              $host;
proxy_set_header X-Real-IP         $remote_addr;
proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host  $host;
proxy_set_header X-Forwarded-Port  $server_port;
proxy_set_header X-Request-ID      $request_id;
proxy_set_header Connection        "";
```

Keuntungan snippet:

- konsisten,
- mudah review,
- mengurangi copy-paste drift,
- semua service menerima proxy contract yang sama.

Risiko snippet:

- perubahan global berdampak luas,
- location khusus bisa butuh exception,
- include order tetap harus dipahami.

---

## 46. Security: Jangan Biarkan Backend Bisa Diakses Langsung Publik

Jika Nginx adalah security boundary, backend tidak boleh terbuka langsung ke internet.

Buruk:

```text
Internet -> Nginx -> App
Internet ---------> App:8080
```

Jika port `8080` terbuka, attacker bisa bypass:

- TLS enforcement,
- rate limiting,
- IP allowlist,
- header sanitization,
- request size limit,
- WAF/CDN,
- logging edge.

Pastikan:

- app bind ke `127.0.0.1` jika satu VM,
- security group hanya allow Nginx/LB,
- Kubernetes Service tidak exposed sebagai LoadBalancer tanpa alasan,
- container port tidak dipublish ke host publik,
- firewall menutup port internal.

Spring Boot config:

```properties
server.address=127.0.0.1
server.port=8080
```

Hanya cocok jika Nginx dan app berada di host network yang sama. Di container/Kubernetes, gunakan network policy/service exposure yang sesuai.

---

## 47. Anti-Pattern: Menjadikan Nginx Tempat Business Logic

Nginx bisa melakukan banyak hal:

- route by header,
- rewrite path,
- set header,
- block IP,
- rate limit,
- auth subrequest,
- cache,
- return response langsung.

Tetapi jangan menaruh business rule kompleks seperti:

```text
Jika user tipe A dan order status B dan region C, route ke service X kecuali jam tertentu...
```

Nginx config bukan domain model.

Cocok di Nginx:

- coarse routing,
- edge enforcement,
- protocol translation ringan,
- operational guardrail.

Cocok di aplikasi:

- business authorization,
- domain validation,
- lifecycle state machine,
- audit semantic,
- policy yang membutuhkan data domain.

---

## 48. Anti-Pattern: Menggunakan Rewrite Berlapis Tanpa Test

Contoh buruk:

```nginx
rewrite ^/api/v1/(.*)$ /$1 break;
proxy_pass http://app:8080/api/;
```

Sulit diprediksi karena:

- location sudah melakukan matching,
- rewrite mengubah URI,
- proxy_pass juga bisa mengganti URI,
- query string behavior perlu diperhatikan,
- backend menerima path yang tidak jelas.

Lebih baik gunakan satu mekanisme mapping yang jelas.

Misalnya preserve:

```nginx
location /api/v1/ {
    proxy_pass http://app:8080;
}
```

Atau strip:

```nginx
location /api/v1/ {
    proxy_pass http://app:8080/;
}
```

Gunakan `rewrite` hanya saat memang perlu, dan selalu test mapping.

---

## 49. Anti-Pattern: Menganggap Semua Header dari Client Aman

Client bisa mengirim:

```text
X-Forwarded-For: 1.2.3.4
X-Forwarded-Proto: https
X-Forwarded-Host: admin.example.com
```

Jika Nginx meneruskan begitu saja atau aplikasi mempercayainya tanpa sanitasi, attacker bisa mempengaruhi:

- audit IP,
- generated links,
- redirect target,
- scheme detection,
- host-based tenant,
- security decision.

Lebih aman:

- Nginx overwrite forwarded headers di edge boundary.
- Aplikasi hanya trust headers dari proxy tepercaya.
- Direct access ke app ditutup.
- Gunakan real IP module jika ada proxy/CDN di depan dan trust range jelas.

Part 008 akan membahas ini secara khusus.

---

## 50. Anti-Pattern: Semua Service Mendapat Semua Path

Buruk:

```nginx
location / {
    proxy_pass http://monolith:8080;
}
```

lalu berharap aplikasi menyaring semuanya.

Kadang valid untuk monolith, tetapi jika ada static file, admin endpoint, actuator, API, dan frontend route, sebaiknya boundary lebih eksplisit.

Lebih baik:

```nginx
location = /healthz {
    proxy_pass http://app:8080/actuator/health/readiness;
}

location /api/ {
    proxy_pass http://app:8080;
}

location /actuator/ {
    deny all;
}

location / {
    try_files $uri $uri/ /index.html;
}
```

Prinsip:

> Route yang eksplisit lebih mudah diamankan daripada fallback yang terlalu luas.

---

## 51. Failure Mode Catalog

### 51.1 Backend mati

Gejala:

```text
502 Bad Gateway
connect() failed (111: Connection refused)
```

Cek:

```bash
systemctl status app
ss -ltnp | grep 8080
curl -i http://127.0.0.1:8080/health
```

### 51.2 Port salah

Nginx:

```nginx
proxy_pass http://127.0.0.1:8081;
```

App listen:

```text
8080
```

Gejala: 502.

### 51.3 App bind ke localhost tapi Nginx di container lain

Nginx container:

```nginx
proxy_pass http://127.0.0.1:8080;
```

Padahal app ada di container lain.

Gejala: 502.

Solusi:

```nginx
proxy_pass http://app:8080;
```

### 51.4 IPv6 localhost issue

`localhost` resolve ke `::1`, app hanya listen IPv4.

Gejala: connection refused ke IPv6.

Solusi: gunakan `127.0.0.1` atau pastikan app listen IPv6.

### 51.5 URI prefix salah

Gejala:

```text
404 dari aplikasi
```

Nginx berhasil proxy, tetapi backend path tidak sesuai.

Cek dengan access log backend/debug endpoint.

### 51.6 Scheme salah

Gejala:

- redirect ke HTTP,
- cookie tidak secure,
- OAuth callback mismatch.

Cek forwarded headers dan Spring config.

### 51.7 Host salah

Gejala:

- tenant salah,
- generated URL internal,
- Swagger URL salah.

Cek `Host`, `X-Forwarded-Host`.

### 51.8 Body terlalu besar

Gejala:

```text
413 Request Entity Too Large
```

Solusi: set `client_max_body_size` sesuai endpoint.

### 51.9 Backend lambat

Gejala:

```text
504 Gateway Timeout
```

Cek:

- Nginx upstream response time,
- app logs,
- DB latency,
- thread pool,
- GC,
- downstream dependency.

### 51.10 Response header terlalu besar

Gejala:

```text
upstream sent too big header
```

Sering terjadi karena:

- cookie terlalu besar,
- banyak Set-Cookie,
- header auth besar,
- aplikasi mengirim metadata berlebihan.

Solusi bukan selalu menaikkan buffer. Periksa mengapa header besar.

---

## 52. Debugging Checklist: Reverse Proxy ke Java

Saat ada masalah, jangan langsung edit config acak. Ikuti alur.

### Step 1: Validasi Nginx config

```bash
nginx -t
nginx -T | less
```

Pastikan effective config sesuai ekspektasi.

### Step 2: Test backend langsung dari mesin Nginx

```bash
curl -i http://127.0.0.1:8080/health
```

atau:

```bash
curl -i http://app:8080/health
```

Jika ini gagal, masalah belum tentu Nginx. Bisa network/app.

### Step 3: Test via Nginx

```bash
curl -i http://example.com/api/health
```

Bandingkan response.

### Step 4: Tambahkan Host header jika test lokal

```bash
curl -i -H 'Host: api.example.com' http://127.0.0.1/api/health
```

### Step 5: Cek error log

```bash
tail -f /var/log/nginx/error.log
```

### Step 6: Cek access log dengan upstream fields

Cari:

- `$status`,
- `$upstream_status`,
- `$request_time`,
- `$upstream_response_time`,
- `$upstream_addr`.

### Step 7: Cek app logs dengan request ID

Pastikan request yang sama bisa dilacak di Nginx dan Java.

### Step 8: Cek path yang diterima backend

Gunakan debug endpoint atau temporary echo.

### Step 9: Cek forwarded headers

Pastikan backend melihat:

```text
X-Forwarded-Proto
X-Forwarded-Host
X-Forwarded-For
Host
```

### Step 10: Cek direct exposure

Pastikan app tidak bisa diakses publik langsung.

---

## 53. Production Checklist

Sebelum reverse proxy dianggap siap production, pastikan:

### Routing

- [ ] `server_name` benar.
- [ ] `location` yang dipakai benar.
- [ ] URI mapping preserve/strip sudah diputuskan.
- [ ] Trailing slash `proxy_pass` disengaja.
- [ ] API tidak jatuh ke SPA fallback.

### Header contract

- [ ] `Host` diteruskan dengan benar.
- [ ] `X-Forwarded-Proto` benar.
- [ ] `X-Forwarded-For` punya trust policy.
- [ ] `X-Forwarded-Host` diperlukan dan benar.
- [ ] `X-Forwarded-Port` tidak salah karena container/LB topology.
- [ ] Request ID diteruskan.

### Java app alignment

- [ ] Spring Boot/Tomcat/Jetty dikonfigurasi untuk forwarded headers jika dibutuhkan.
- [ ] Redirect memakai external scheme/host.
- [ ] Cookie secure policy benar.
- [ ] OpenAPI/Swagger URL benar.
- [ ] Context path/public prefix jelas.

### Network/security

- [ ] Backend port tidak terbuka publik.
- [ ] Nginx adalah satu-satunya ingress path yang diharapkan.
- [ ] Internal actuator tidak exposed sembarangan.
- [ ] Header spoofing dipertimbangkan.

### Reliability

- [ ] Timeout diset eksplisit.
- [ ] Request body size limit diset.
- [ ] Error log dimonitor.
- [ ] Access log memuat upstream timing.
- [ ] Health endpoint tersedia.

### Operability

- [ ] `nginx -t` masuk CI/deploy pipeline.
- [ ] Config bisa rollback.
- [ ] Mapping path terdokumentasi.
- [ ] Ada test `curl` untuk endpoint penting.

---

## 54. Design Exercise 1: Preserve Prefix atau Strip Prefix?

Kamu punya Spring Boot app:

```java
@RestController
@RequestMapping("/orders")
class OrderController {
    @GetMapping("/{id}")
    OrderDto get(@PathVariable String id) { ... }
}
```

Public API harus:

```text
https://api.example.com/api/orders/{id}
```

Pilihan A:

```nginx
location /api/ {
    proxy_pass http://order-service:8080;
}
```

Pilihan B:

```nginx
location /api/ {
    proxy_pass http://order-service:8080/;
}
```

Jawaban:

Pilihan B, karena backend expect `/orders/{id}`, bukan `/api/orders/{id}`.

Request:

```text
/api/orders/123
```

menjadi:

```text
/orders/123
```

Tapi konsekuensinya:

- aplikasi tidak boleh asal redirect ke `/login` jika public harus `/api/login`,
- perlu dokumentasi bahwa `/api/` adalah public prefix yang di-strip,
- jika aplikasi menghasilkan link, perlu forwarded prefix atau explicit base URL.

---

## 55. Design Exercise 2: Spring Boot OAuth Redirect Salah

Gejala:

User membuka:

```text
https://app.example.com/login/oauth2/code/google
```

Aplikasi mengirim redirect:

```text
http://app.example.com/oauth2/authorization/google
```

Kemungkinan penyebab:

1. Nginx terminate TLS lalu proxy ke HTTP.
2. `X-Forwarded-Proto` tidak dikirim atau salah.
3. Spring Boot tidak memproses forwarded headers.
4. External port/host tidak sesuai.

Perbaikan minimal:

Nginx:

```nginx
proxy_set_header Host              $host;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host  $host;
proxy_set_header X-Forwarded-Port  $server_port;
```

Spring:

```properties
server.forward-headers-strategy=framework
```

Test:

```bash
curl -I https://app.example.com/oauth2/authorization/google
```

Pastikan `Location` memakai `https://`.

---

## 56. Design Exercise 3: Docker Compose Reverse Proxy

Compose:

```yaml
services:
  nginx:
    image: nginx:stable
    ports:
      - "8080:80"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      - app

  app:
    image: my-spring-app
    expose:
      - "8080"
```

Nginx config salah:

```nginx
proxy_pass http://127.0.0.1:8080;
```

Kenapa salah?

Karena dari dalam container Nginx, `127.0.0.1` adalah container Nginx, bukan container app.

Config benar:

```nginx
proxy_pass http://app:8080;
```

Tambahan:

Karena public user mengakses host port `8080`, sementara Nginx listen container port `80`, maka:

```nginx
proxy_set_header X-Forwarded-Port $server_port;
```

akan bernilai `80`, bukan `8080`.

Jika aplikasi butuh public port, set eksplisit untuk local dev:

```nginx
proxy_set_header X-Forwarded-Port 8080;
```

atau hindari absolute URL yang bergantung port di local dev.

---

## 57. Design Exercise 4: API dan SPA Conflict

Config:

```nginx
location / {
    try_files $uri $uri/ /index.html;
}

location /api/ {
    proxy_pass http://app:8080;
}
```

Apakah urutan deklarasi bermasalah?

Untuk prefix location biasa, Nginx memilih longest prefix, jadi `/api/` tetap lebih spesifik daripada `/`.

Namun masalah bisa muncul jika ada regex location atau `try_files` internal redirect yang tidak dipahami.

Test wajib:

```bash
curl -i https://app.example.com/api/health
curl -i https://app.example.com/non-existing-spa-route
curl -i https://app.example.com/assets/app.js
```

Ekspektasi:

- `/api/health` ke backend.
- SPA route ke `index.html`.
- asset static benar, bukan ke backend.

---

## 58. How Top Engineers Think About Reverse Proxy

Engineer biasa bertanya:

```text
Config Nginx-nya gimana?
```

Engineer kuat bertanya:

```text
Apa kontrak antara public request dan internal request?
```

Pertanyaan yang benar:

1. Apakah path dipertahankan atau diubah?
2. Siapa pemilik public base path?
3. Siapa pemilik TLS awareness?
4. Siapa sumber kebenaran client IP?
5. Header mana yang disanitasi dan mana yang diteruskan?
6. Apakah backend bisa diakses tanpa proxy?
7. Bagaimana redirect dan absolute URL dibuat?
8. Bagaimana cookie policy ditentukan?
9. Bagaimana timeout budget antar layer?
10. Bagaimana request dilacak lintas Nginx dan Java logs?

Reverse proxy yang baik bukan config panjang. Reverse proxy yang baik adalah boundary yang bisa dijelaskan, dites, dan dioperasikan saat gagal.

---

## 59. Minimal Pattern Library

### 59.1 Preserve path API

```nginx
location /api/ {
    proxy_pass http://app:8080;
    include snippets/proxy-headers.conf;
}
```

Use when backend expects:

```text
/api/...
```

### 59.2 Strip path API

```nginx
location /api/ {
    proxy_pass http://app:8080/;
    proxy_set_header X-Forwarded-Prefix /api;
    include snippets/proxy-headers.conf;
}
```

Use when backend expects:

```text
/...
```

### 59.3 Full domain to app

```nginx
location / {
    proxy_pass http://app:8080;
    include snippets/proxy-headers.conf;
}
```

Use when app owns the whole domain.

### 59.4 Static frontend + API backend

```nginx
location /api/ {
    proxy_pass http://app:8080;
    include snippets/proxy-headers.conf;
}

location / {
    try_files $uri $uri/ /index.html;
}
```

Use when Nginx serves frontend and proxies backend.

### 59.5 Health alias

```nginx
location = /healthz {
    proxy_pass http://app:8080/actuator/health/readiness;
    access_log off;
}
```

Use when external health path should not expose actuator structure.

---

## 60. Reference Configuration: Java API Behind Nginx

```nginx
# /etc/nginx/snippets/proxy-headers.conf
proxy_http_version 1.1;

proxy_set_header Host              $host;
proxy_set_header X-Real-IP         $remote_addr;
proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host  $host;
proxy_set_header X-Forwarded-Port  $server_port;
proxy_set_header X-Request-ID      $request_id;

proxy_set_header Connection "";
```

```nginx
# /etc/nginx/conf.d/api.example.com.conf
server {
    listen 80;
    server_name api.example.com;

    client_max_body_size 2m;

    access_log /var/log/nginx/api.access.log proxy_main;
    error_log  /var/log/nginx/api.error.log warn;

    location = /healthz {
        proxy_pass http://127.0.0.1:8080/actuator/health/readiness;
        access_log off;
    }

    location /actuator/ {
        deny all;
    }

    location / {
        proxy_pass http://127.0.0.1:8080;
        include snippets/proxy-headers.conf;

        proxy_connect_timeout 3s;
        proxy_send_timeout    30s;
        proxy_read_timeout    30s;
    }
}
```

Spring Boot:

```properties
server.port=8080
server.forward-headers-strategy=framework
management.endpoint.health.probes.enabled=true
management.endpoints.web.exposure.include=health,info
```

---

## 61. What Not to Memorize

Jangan sekadar menghafal:

```nginx
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

Pahami:

- siapa yang boleh menulis header itu,
- siapa yang boleh mempercayainya,
- bagaimana chain IP dibaca,
- apa yang terjadi jika ada CDN/LB di depan,
- bagaimana aplikasi menggunakannya,
- bagaimana attacker bisa memalsukannya.

Jangan sekadar menghafal:

```nginx
proxy_pass http://app/;
```

Pahami:

- apakah slash itu menyebabkan prefix strip,
- apakah backend expect path tersebut,
- apakah redirect/cookie/link tetap benar,
- bagaimana test mapping-nya.

---

## 62. Ringkasan

Reverse proxy adalah salah satu area Nginx yang terlihat mudah tetapi sangat penting secara arsitektural.

Inti yang harus diingat:

1. Nginx membuat request baru ke backend; backend tidak menerima request browser secara langsung.
2. `proxy_pass` tanpa URI mempertahankan URI asli.
3. `proxy_pass` dengan URI dapat mengganti prefix location.
4. Trailing slash adalah keputusan desain, bukan detail kecil.
5. Backend Java perlu header contract agar tahu public host, scheme, port, dan client IP.
6. TLS termination membuat backend melihat HTTP kecuali forwarded proto diproses.
7. Client IP asli harus dipropagasi dan dipercaya hanya berdasarkan trust boundary.
8. Redirect, cookie, Swagger, OAuth, dan generated links sering rusak karena forwarded headers salah.
9. Backend port tidak boleh terbuka publik jika Nginx adalah security boundary.
10. Production reverse proxy harus punya timeout, body limit, upstream logging, request ID, dan testable mapping.

Mental model akhir:

```text
External request
  -> Nginx server selection
  -> location selection
  -> URI mapping
  -> header contract
  -> upstream request
  -> Java framework interpretation
  -> response rewriting/forwarding
  -> client-visible behavior
```

Jika ada bug, cari di chain itu secara sistematis.

---

## 63. Latihan Mandiri

### Latihan 1

Buat dua konfigurasi Nginx:

1. `/api/` preserve prefix.
2. `/api/` strip prefix.

Gunakan echo backend dan catat perbedaan path yang diterima backend.

### Latihan 2

Buat endpoint Spring Boot `/debug/request` yang menampilkan:

- URI,
- URL,
- scheme,
- host,
- port,
- remote address,
- forwarded headers.

Test sebelum dan sesudah mengaktifkan:

```properties
server.forward-headers-strategy=framework
```

### Latihan 3

Simulasikan TLS termination lokal dengan Nginx HTTPS ke backend HTTP. Pastikan redirect aplikasi tetap memakai `https://`.

### Latihan 4

Buat konfigurasi SPA + API. Pastikan:

- `/api/health` masuk backend,
- `/dashboard/settings` fallback ke SPA,
- `/assets/app.js` dilayani static,
- `/actuator/env` tidak bisa diakses publik.

### Latihan 5

Buat access log format dengan upstream timing. Trigger:

- response cepat,
- response lambat,
- backend mati,
- endpoint 404.

Bandingkan `$status`, `$upstream_status`, `$request_time`, dan `$upstream_response_time`.

---

## 64. Referensi

Referensi utama untuk bagian ini:

- NGINX Official Documentation — `ngx_http_proxy_module`: https://nginx.org/en/docs/http/ngx_http_proxy_module.html
- NGINX Documentation — Reverse Proxy Admin Guide: https://docs.nginx.com/nginx/admin-guide/web-server/reverse-proxy/
- NGINX Documentation — Accepting the PROXY Protocol: https://docs.nginx.com/nginx/admin-guide/load-balancer/using-proxy-protocol/
- Spring Security Documentation — Proxy / Forwarded Headers discussion: https://docs.spring.io/spring-security/reference/features/exploits/http.html
- Spring Boot Reference Documentation — forwarded headers behavior should be checked against the exact Spring Boot version used in your project.

---

## 65. Penutup Bagian 007

Bagian ini membangun fondasi reverse proxy untuk Java backend.

Kita belum membahas secara penuh:

- trust boundary forwarded headers,
- header spoofing,
- `real_ip_header`,
- PROXY protocol,
- forwarded header standardization,
- multi-proxy chain,
- CDN/load balancer di depan Nginx.

Itu akan menjadi fokus berikutnya.

**Status seri:** belum selesai.  
**Progress:** Part 007 dari 030 selesai.  
**Part berikutnya:** Part 008 — Proxy Header Contract: The Boundary Between Nginx and Application.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-nginx-mastery-for-java-engineers-part-006.md">⬅️ Part 006 — Static File Serving: Root, Alias, Index, Try Files, and SPA Hosting</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-nginx-mastery-for-java-engineers-part-008.md">Part 008 — Proxy Header Contract: The Boundary Between Nginx and Application ➡️</a>
</div>
