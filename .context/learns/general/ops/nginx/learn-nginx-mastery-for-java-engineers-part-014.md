# learn-nginx-mastery-for-java-engineers-part-014.md

# Part 014 — Compression, Decompression, and Content Transformation

> Seri: **learn-nginx-mastery-for-java-engineers**  
> Bagian: **014 dari 030**  
> Topik: **Compression, Decompression, and Content Transformation**  
> Target pembaca: **Java Software Engineer / Backend Engineer / Tech Lead**  
> Fokus: memahami compression sebagai keputusan desain di traffic boundary, bukan sekadar menyalakan `gzip on;`.

---

## 0. Posisi Part Ini dalam Seri

Sampai Part 013, kita sudah membahas Nginx dari sisi:

1. runtime dan arsitektur proses,
2. konfigurasi dan routing,
3. reverse proxy ke backend Java,
4. upstream/load balancing,
5. timeout, retry, buffering, backpressure,
6. connection tuning,
7. TLS termination,
8. HTTP/2, HTTP/3, dan trade-off protokol.

Part ini masuk ke lapisan yang terlihat sederhana tetapi sering berdampak besar di production: **compression**.

Banyak engineer memperlakukan compression sebagai checklist:

```nginx
gzip on;
```

Lalu selesai.

Padahal dalam sistem nyata, compression memengaruhi:

- CPU usage di Nginx,
- bandwidth egress,
- latency response,
- cache behavior,
- CDN behavior,
- observability,
- security,
- streaming,
- CPU pressure pada backend Java,
- memory pressure,
- behavior browser,
- correctness header `Content-Encoding`,
- debugging response body,
- dan stabilitas saat traffic spike.

Compression bukan hanya optimisasi ukuran payload. Compression adalah **content transformation** di jalur request/response.

Begitu Nginx mengubah body response, Nginx juga harus menjaga kontrak HTTP terkait header, cache, variant, dan encoding.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu harus mampu:

1. menjelaskan apa yang sebenarnya dilakukan Nginx ketika melakukan gzip compression;
2. membedakan dynamic compression, static precompressed file serving, dan decompression;
3. menentukan kapan compression sebaiknya dilakukan oleh Nginx, Java backend, CDN, atau build pipeline;
4. memahami risiko double compression;
5. memahami relasi compression dengan cache key dan `Vary: Accept-Encoding`;
6. memahami kenapa compression bisa meningkatkan latency walaupun mengurangi ukuran response;
7. menghindari compression pada response yang tidak aman atau tidak bermanfaat;
8. mendesain konfigurasi gzip yang masuk akal untuk API Java, static assets, dan SPA;
9. melakukan debugging response compression dengan `curl` dan log;
10. membuat checklist production untuk compression policy.

---

## 2. Mental Model: Compression as Response Transformation

Nginx berada di antara client dan upstream.

Secara sederhana:

```text
Client
  |
  | request with Accept-Encoding
  v
Nginx
  |
  | proxy request
  v
Java Backend
  |
  | response body
  v
Nginx
  |
  | maybe transform body
  v
Client
```

Compression terjadi pada jalur response.

Tanpa compression:

```text
Java Backend -> JSON 500 KB -> Nginx -> Client receives JSON 500 KB
```

Dengan compression di Nginx:

```text
Java Backend -> JSON 500 KB -> Nginx compresses -> Client receives gzip 80 KB
```

Nginx tidak hanya meneruskan response. Ia mengubah representation response.

Artinya Nginx harus menjaga beberapa hal:

1. client memang mendukung encoding tersebut;
2. response type memang layak dikompresi;
3. response belum dikompresi sebelumnya;
4. header `Content-Encoding` benar;
5. header `Content-Length` tidak menyesatkan;
6. cache membedakan compressed vs uncompressed variant;
7. proxy/cache downstream memahami bahwa response berbeda berdasarkan `Accept-Encoding`.

Kesalahan kecil di sini bisa menghasilkan bug seperti:

- browser gagal decode response,
- file JavaScript rusak,
- JSON tidak bisa dibaca,
- cache mengirim gzip ke client yang tidak mendukung gzip,
- CPU Nginx melonjak,
- latency meningkat,
- response streaming menjadi tertahan,
- download file besar jadi lambat,
- security leak melalui compression side-channel.

---

## 3. Baseline: Apa Itu HTTP Compression?

HTTP compression biasanya menggunakan request header:

```http
Accept-Encoding: gzip, deflate, br, zstd
```

Header ini berarti:

> Client memberi tahu server/proxy encoding response apa saja yang bisa ia decode.

Server/proxy boleh mengirim response dengan header:

```http
Content-Encoding: gzip
```

Yang berarti:

> Body response dikirim dalam bentuk gzip-compressed representation.

Contoh:

```http
HTTP/1.1 200 OK
Content-Type: application/json
Content-Encoding: gzip
Vary: Accept-Encoding
```

Body-nya bukan JSON plain text lagi. Body-nya adalah byte stream gzip yang setelah didecompress menghasilkan JSON.

### 3.1 Representation vs Resource

Satu resource bisa punya banyak representation.

Misalnya:

```text
/api/users?page=1
```

Bisa dikirim sebagai:

```text
uncompressed JSON
compressed gzip JSON
compressed brotli JSON
```

Resource-nya sama, representation-nya berbeda.

Inilah alasan header `Vary: Accept-Encoding` penting. Cache perlu tahu bahwa response berbeda tergantung request header `Accept-Encoding`.

---

## 4. Nginx Compression Capabilities

Dalam Nginx open source, kemampuan compression yang paling umum:

1. **dynamic gzip compression** melalui `ngx_http_gzip_module`;
2. **serving precompressed `.gz` files** melalui `ngx_http_gzip_static_module`;
3. **decompression / gunzip** melalui `ngx_http_gunzip_module`;
4. Brotli dapat tersedia melalui dynamic module/package tertentu, terutama di distribusi tertentu seperti NGINX Plus atau build dengan module tambahan.

Dokumentasi resmi Nginx mendeskripsikan `ngx_http_gzip_module` sebagai filter yang mengompresi response menggunakan gzip, dan menyediakan directive seperti `gzip`, `gzip_types`, `gzip_min_length`, `gzip_comp_level`, dan `gzip_proxied`.

Referensi resmi:

- `ngx_http_gzip_module`: https://nginx.org/en/docs/http/ngx_http_gzip_module.html
- `ngx_http_gzip_static_module`: https://nginx.org/en/docs/http/ngx_http_gzip_static_module.html
- NGINX Compression and Decompression guide: https://docs.nginx.com/nginx/admin-guide/web-server/compression/
- Brotli dynamic module documentation: https://docs.nginx.com/nginx/admin-guide/dynamic-modules/brotli/

---

## 5. Dynamic Compression: `gzip on;`

Dynamic compression berarti response dikompresi saat request diproses.

Flow:

```text
1. Client requests /api/products
2. Client sends Accept-Encoding: gzip
3. Nginx receives response from upstream
4. Nginx checks gzip policy
5. Nginx compresses response body
6. Nginx sends Content-Encoding: gzip
```

Contoh konfigurasi minimal:

```nginx
http {
    gzip on;
}
```

Namun konfigurasi minimal ini jarang cukup untuk production.

Konfigurasi lebih realistis:

```nginx
http {
    gzip on;
    gzip_comp_level 5;
    gzip_min_length 1024;
    gzip_vary on;
    gzip_proxied any;

    gzip_types
        text/plain
        text/css
        text/xml
        text/javascript
        application/javascript
        application/json
        application/xml
        application/rss+xml
        image/svg+xml;
}
```

Catatan penting:

- `text/html` dikompresi secara default oleh gzip module.
- `gzip_types` menambahkan tipe lain selain `text/html`.
- `gzip_vary on;` menambahkan `Vary: Accept-Encoding`.
- `gzip_min_length` menghindari compression untuk response kecil.
- `gzip_comp_level` mengatur trade-off CPU vs compression ratio.

---

## 6. Directive Penting pada `ngx_http_gzip_module`

### 6.1 `gzip`

```nginx
gzip on;
```

Mengaktifkan gzip compression.

Context umum:

```text
http, server, location
```

Gunakan di `http` untuk default global, lalu override di `server` atau `location` jika perlu.

Contoh:

```nginx
http {
    gzip on;

    server {
        location /large-downloads/ {
            gzip off;
        }
    }
}
```

### 6.2 `gzip_types`

```nginx
gzip_types application/json application/javascript text/css image/svg+xml;
```

Menentukan MIME type tambahan yang boleh dikompresi.

Jangan asal memasukkan semua MIME type.

Jenis yang biasanya bermanfaat:

```text
text/plain
text/css
text/xml
text/javascript
application/javascript
application/json
application/xml
application/rss+xml
application/atom+xml
image/svg+xml
```

Jenis yang biasanya tidak bermanfaat karena sudah compressed:

```text
image/jpeg
image/png
image/webp
image/avif
video/mp4
application/zip
application/gzip
application/pdf   # sering sudah compressed sebagian, tergantung isi
```

Compression pada format yang sudah compressed sering hanya membuang CPU tanpa mengurangi ukuran berarti.

### 6.3 `gzip_min_length`

```nginx
gzip_min_length 1024;
```

Menghindari compress response kecil.

Kenapa?

Response kecil punya overhead:

- CPU untuk compress,
- header gzip,
- buffering,
- latency tambahan.

Contoh:

```text
Response 100 bytes -> gzip overhead bisa membuat size tidak jauh lebih kecil
Response 100 KB JSON -> gzip bisa sangat efektif
```

Nilai umum:

```nginx
gzip_min_length 1024;
```

Atau:

```nginx
gzip_min_length 2048;
```

Untuk API yang banyak mengirim payload kecil, angka terlalu kecil bisa memperberat Nginx.

### 6.4 `gzip_comp_level`

```nginx
gzip_comp_level 5;
```

Level gzip umumnya 1 sampai 9.

Mental model:

```text
level rendah  -> CPU lebih ringan, compression ratio lebih rendah
level tinggi  -> CPU lebih berat, compression ratio lebih baik tetapi diminishing return
```

Untuk production web/API, level yang sering masuk akal:

```text
4, 5, atau 6
```

Hindari langsung memakai level 9 tanpa pengukuran.

Level 9 bisa terlihat “paling optimal” dari ukuran file, tetapi buruk dari sisi latency dan CPU.

Pertanyaan desain yang benar bukan:

> “Compression ratio terbesar berapa?”

Melainkan:

> “Pada traffic production, level mana yang memberi pengurangan bandwidth cukup besar tanpa membuat CPU Nginx menjadi bottleneck?”

### 6.5 `gzip_vary`

```nginx
gzip_vary on;
```

Menambahkan:

```http
Vary: Accept-Encoding
```

Ini penting untuk cache.

Tanpa `Vary`, cache downstream bisa menyimpan response compressed lalu mengirimnya ke client yang tidak mendukung gzip.

Atau sebaliknya, menyimpan uncompressed response lalu tidak pernah memberi compressed variant ke client yang mendukung.

Untuk production, biasanya:

```nginx
gzip_vary on;
```

### 6.6 `gzip_proxied`

```nginx
gzip_proxied any;
```

Directive ini mengontrol compression untuk response dari proxied server berdasarkan header tertentu.

Contoh lebih konservatif:

```nginx
gzip_proxied expired no-cache no-store private auth;
```

Artinya Nginx mengizinkan gzip untuk response proxied dengan kondisi cache-related tertentu.

Untuk internal reverse proxy Java backend, banyak konfigurasi memakai:

```nginx
gzip_proxied any;
```

Namun jangan jadikan ini default tanpa berpikir. Untuk response sensitif, personalized, atau auth-heavy, compression punya risiko tersendiri yang akan dibahas di bagian security.

### 6.7 `gzip_disable`

```nginx
gzip_disable "msie6";
```

Historically digunakan untuk browser lama yang bermasalah dengan gzip.

Di sistem modern, ini jarang menjadi fokus utama, tetapi tetap ada di banyak template lama.

Jangan blindly copy template lama tanpa memahami konteks.

### 6.8 `gzip_buffers`

```nginx
gzip_buffers 16 8k;
```

Mengatur buffer untuk compression.

Biasanya tidak perlu diubah kecuali ada bukti masalah memory/buffering tertentu.

Rule of thumb:

> Jangan tuning buffer compression sebelum observability menunjukkan bottleneck yang jelas.

---

## 7. Static Precompressed Files: `gzip_static`

Dynamic compression menggunakan CPU saat request.

Static precompressed file serving menggeser kerja compression ke build/deployment time.

Contoh:

```text
app.js      800 KB
app.js.gz   180 KB
```

Saat client meminta:

```http
GET /assets/app.js
Accept-Encoding: gzip
```

Nginx bisa mengirim `app.js.gz` langsung, tanpa compress ulang.

Konfigurasi:

```nginx
location /assets/ {
    root /var/www/myapp;
    gzip_static on;
}
```

Dokumentasi resmi menyatakan `ngx_http_gzip_static_module` memungkinkan Nginx mengirim file precompressed dengan ekstensi `.gz` alih-alih file reguler jika memungkinkan.

### 7.1 Kapan `gzip_static` Sangat Cocok?

Sangat cocok untuk:

- static asset hasil build frontend,
- JavaScript bundle,
- CSS bundle,
- SVG,
- WASM tertentu,
- file dokumentasi statis,
- asset immutable dengan fingerprint/hash.

Contoh:

```text
main.8f3a92.js
main.8f3a92.js.gz
vendor.31aa99.css
vendor.31aa99.css.gz
```

Dengan pendekatan ini:

- compression dilakukan sekali saat build,
- Nginx hanya serve file,
- CPU runtime lebih hemat,
- compression level bisa lebih tinggi karena tidak dilakukan per request,
- response lebih stabil.

### 7.2 Build Pipeline Example

Misalnya frontend build menghasilkan:

```text
dist/assets/app.abc123.js
dist/assets/app.abc123.css
```

Build step bisa membuat:

```bash
find dist/assets -type f \( -name '*.js' -o -name '*.css' -o -name '*.svg' \) \
  -exec gzip -k -9 {} \;
```

Hasil:

```text
app.abc123.js
app.abc123.js.gz
app.abc123.css
app.abc123.css.gz
```

Nginx:

```nginx
location /assets/ {
    root /usr/share/nginx/html;
    gzip_static on;

    expires 1y;
    add_header Cache-Control "public, immutable";
}
```

### 7.3 `gzip_static always`

Beberapa konfigurasi menggunakan:

```nginx
gzip_static always;
```

Mode ini mengirim file `.gz` tanpa memeriksa apakah client mendukung gzip.

Ini berbahaya untuk public web kecuali kamu benar-benar tahu semua downstream client/proxy bisa menangani gzip.

Default aman biasanya:

```nginx
gzip_static on;
```

Bukan:

```nginx
gzip_static always;
```

### 7.4 Requirement Module

`ngx_http_gzip_static_module` tidak selalu dibangun secara default pada semua build. Pada dokumentasi resmi, module ini disebut perlu diaktifkan saat build dengan parameter `--with-http_gzip_static_module` untuk build dari source.

Di package distro tertentu, module bisa sudah tersedia.

Validasi:

```bash
nginx -V 2>&1 | grep gzip_static
```

Atau lihat module list package yang digunakan.

---

## 8. Decompression: `gunzip`

Kadang upstream atau static source hanya punya compressed representation, tetapi client tidak mendukung gzip.

Nginx dapat melakukan decompression dengan `gunzip` module.

Flow:

```text
Upstream/static sends gzip
Nginx decompresses
Client receives plain body
```

Contoh konseptual:

```nginx
location /assets/ {
    gzip_static always;
    gunzip on;
}
```

Dengan pola ini:

- Nginx bisa menyimpan/serve compressed artifact,
- client yang mendukung gzip menerima gzip,
- client yang tidak mendukung gzip menerima decompressed response.

Namun di banyak sistem modern, hampir semua browser dan HTTP client umum mendukung gzip. Jadi `gunzip` lebih niche dibanding `gzip` dan `gzip_static`.

Gunakan ketika ada alasan jelas.

---

## 9. Brotli: Kapan Dipertimbangkan?

Brotli sering memberikan compression ratio lebih baik dibanding gzip untuk text asset seperti JavaScript, CSS, HTML, dan JSON.

Namun ada beberapa catatan:

1. Brotli bukan core default yang selalu tersedia di semua build Nginx open source.
2. Brotli sering membutuhkan module tambahan.
3. Untuk dynamic compression, level tinggi bisa sangat CPU-expensive.
4. Brotli paling menarik untuk static precompressed assets.
5. CDN sering sudah menangani Brotli di edge.

Dokumentasi NGINX/F5 menjelaskan `ngx_brotli` sebagai module yang menyediakan dynamic Brotli compression dan serving precompressed `.br` files pada distribusi/module tertentu.

### 9.1 Mental Model Praktis

Untuk production modern:

```text
Static frontend assets:
  prefer precompressed .br + .gz jika pipeline dan edge mendukung

Dynamic API JSON:
  gzip sering cukup; Brotli dynamic perlu benchmark CPU/latency

CDN in front:
  pertimbangkan membiarkan CDN melakukan Brotli/gzip ke client
```

### 9.2 Jangan Mengaktifkan Brotli Hanya Karena “Lebih Modern”

Pertanyaan yang harus dijawab:

1. Apakah module tersedia dan maintainable?
2. Apakah monitoring bisa membedakan gzip vs br?
3. Apakah cache key sudah benar?
4. Apakah CDN juga melakukan transformasi?
5. Apakah dynamic Brotli membuat CPU Nginx bottleneck?
6. Apakah asset pipeline bisa menghasilkan `.br` saat build?

---

## 10. Siapa yang Harus Melakukan Compression?

Ada beberapa tempat compression bisa terjadi.

```text
[Java App] -> [Nginx] -> [CDN] -> [Browser]
```

Compression bisa dilakukan oleh:

1. Java application,
2. Nginx,
3. CDN / edge proxy,
4. build pipeline untuk static files.

### 10.1 Compression di Java Backend

Contoh: Spring Boot/Tomcat compression.

Kelebihan:

- aplikasi punya context penuh atas response,
- bisa memilih berdasarkan endpoint/domain logic,
- mudah dikontrol per service.

Kekurangan:

- CPU aplikasi terpakai untuk compression,
- thread/event-loop backend bisa sibuk compress response,
- duplikasi policy antar service,
- risiko double compression jika Nginx juga compress,
- sulit membuat standard edge policy.

Compression di Java masuk akal jika:

- service diakses langsung tanpa Nginx/CDN,
- response transformation butuh domain logic,
- traffic kecil,
- atau edge layer tidak bisa compress.

Namun jika Nginx sudah menjadi front door, sering lebih bersih untuk menjadikan Nginx sebagai compression boundary.

### 10.2 Compression di Nginx

Kelebihan:

- policy terpusat di edge/reverse proxy,
- backend Java fokus business logic,
- mengurangi egress dari Nginx ke client,
- bisa distandardisasi per domain/location,
- cocok untuk API JSON dan HTML.

Kekurangan:

- CPU Nginx meningkat,
- dynamic compression bisa menambah latency,
- perlu hati-hati dengan sensitive response,
- perlu observability di Nginx.

Nginx cocok untuk:

- dynamic JSON response ukuran sedang/besar,
- HTML response,
- text-based API,
- proxy response dari Java backend,
- centralized policy.

### 10.3 Compression di CDN

Kelebihan:

- offload CPU dari origin,
- dekat dengan user,
- sering mendukung Brotli/gzip otomatis,
- bagus untuk static assets dan cacheable content.

Kekurangan:

- origin/Nginx tetap mengirim uncompressed ke CDN jika tidak dikonfigurasi,
- behavior bisa berbeda antar provider,
- debugging lebih kompleks,
- perlu paham cache variant.

CDN cocok untuk:

- public static assets,
- cacheable HTML/public API,
- global traffic.

### 10.4 Compression di Build Pipeline

Kelebihan:

- tidak memakai CPU runtime,
- bisa pakai level tinggi,
- deterministic output,
- cocok untuk immutable assets.

Kekurangan:

- hanya cocok untuk static content,
- perlu pipeline tambahan,
- perlu file mapping `.gz` / `.br` benar.

Cocok untuk:

- JS/CSS/SVG/WASM static assets.

---

## 11. Decision Matrix

| Content Type | Recommended Compression Strategy | Reason |
|---|---|---|
| Hashed JS/CSS assets | Precompress at build + `gzip_static` / Brotli static | Hemat CPU runtime, cacheable lama |
| HTML public page | Nginx gzip or CDN compression | Text compresses well |
| JSON API public | Nginx gzip with threshold | JSON compresses well |
| JSON API authenticated | Nginx gzip selectively; consider security risk | Sensitive personalized content perlu hati-hati |
| Small JSON response | Often no compression | Overhead bisa lebih besar dari manfaat |
| Images JPEG/PNG/WebP/AVIF | No gzip | Sudah compressed |
| Video/audio | No gzip | Sudah compressed/streaming format |
| ZIP/GZIP/PDF download | Usually no gzip | Umumnya tidak efektif |
| SSE/WebSocket | Usually avoid normal response compression unless deliberate | Streaming behavior dan latency risk |
| gRPC | Depends on gRPC-level compression, not normal HTTP gzip assumption | Semantics berbeda |
| Internal service-to-service | Usually avoid unless network bottleneck jelas | CPU vs bandwidth trade-off |

---

## 12. Compression and Java Backends

Untuk Java engineer, pertanyaan utama adalah:

> Apakah compression di Nginx mengubah asumsi aplikasi Java?

Jawabannya: iya, terutama pada header, content length, streaming, timeout, dan CPU budget.

### 12.1 Backend Mengirim Plain, Nginx Compress

Ini pola umum:

```text
Spring Boot -> application/json plain
Nginx -> gzip to client
```

Spring Boot tidak perlu tahu response akhirnya gzip.

Namun aplikasi harus tetap menghasilkan header yang benar:

```http
Content-Type: application/json
Cache-Control: ...
```

Nginx akan menambahkan:

```http
Content-Encoding: gzip
Vary: Accept-Encoding
```

Jika Nginx compress, `Content-Length` dari backend bisa tidak valid untuk response final. Nginx biasanya akan mengatur transfer encoding/length sesuai filter chain.

### 12.2 Backend Sudah Compress, Nginx Juga Compress

Ini bahaya.

Flow salah:

```text
Spring Boot gzip -> Nginx gzip again -> Client gets double-compressed body
```

Gejala:

- response terlihat seperti binary garbage,
- client gagal parse JSON,
- browser error decode,
- curl output aneh,
- `Content-Encoding` tidak sesuai actual bytes,
- size response tidak masuk akal.

Untuk menghindari:

- pilih satu layer untuk dynamic compression;
- matikan compression di Spring Boot jika Nginx yang menangani public traffic;
- atau matikan gzip Nginx untuk upstream yang sudah compress;
- cek `Content-Encoding` dari upstream.

Spring Boot contoh:

```properties
server.compression.enabled=false
```

Jika kamu memutuskan app yang compress:

```nginx
location /api/ {
    gzip off;
    proxy_pass http://java_api;
}
```

Namun secara operasional, lebih umum:

```text
Java app sends plain response
Nginx handles compression policy
```

### 12.3 Streaming Response

Compression sering membutuhkan buffering untuk efisiensi.

Untuk streaming seperti:

- Server-Sent Events,
- long polling tertentu,
- chunked progress response,
- streaming large export,
- incremental logs,

compression bisa membuat data tertahan hingga buffer cukup besar.

Gejala:

```text
Backend mengirim event tiap 1 detik
Client baru menerima setelah banyak event terkumpul
```

Untuk SSE biasanya:

```nginx
location /events/ {
    proxy_pass http://java_api;
    proxy_buffering off;
    gzip off;
}
```

Karena SSE lebih membutuhkan low-latency flush daripada ukuran minimal.

### 12.4 File Upload Tidak Dikompresi oleh `gzip`

Nginx gzip module mengompresi response, bukan request body.

Jika client upload file besar, `gzip on;` tidak membuat upload lebih kecil.

Request compression adalah topik berbeda dan tidak umum untuk browser upload standar.

Jangan mengira `gzip on` menyelesaikan masalah upload bandwidth.

---

## 13. Cache Interaction

Compression dan cache tidak bisa dipisahkan.

### 13.1 `Vary: Accept-Encoding`

Jika response bisa berbeda berdasarkan `Accept-Encoding`, cache harus tahu.

Konfigurasi:

```nginx
gzip_vary on;
```

Response:

```http
Vary: Accept-Encoding
```

Tanpa ini, cache bisa menyimpan compressed body sebagai satu-satunya variant.

### 13.2 Nginx Proxy Cache + Gzip

Ada beberapa kemungkinan desain:

#### Option A — Cache uncompressed, compress per request

```text
Upstream plain -> Nginx cache plain -> Nginx gzip for client
```

Kelebihan:

- satu cache object,
- bisa serve gzip/non-gzip clients.

Kekurangan:

- compression tetap terjadi tiap request atau tiap delivery.

#### Option B — Cache compressed variant

```text
Upstream/Nginx compressed -> cache compressed response
```

Kelebihan:

- hemat CPU pada hit berikutnya.

Kekurangan:

- perlu cache key/variant benar,
- bisa menyimpan banyak variant,
- risiko mengirim compressed ke client yang salah jika `Vary`/cache key buruk.

### 13.3 Static Assets: Precompressed + Immutable Cache

Untuk hashed assets:

```nginx
location /assets/ {
    root /usr/share/nginx/html;
    gzip_static on;

    expires 1y;
    add_header Cache-Control "public, immutable" always;
}
```

Ini pola sangat kuat:

```text
build generates immutable asset
Nginx serves precompressed
browser/CDN caches long-term
```

Tidak perlu dynamic compression untuk asset yang sudah punya `.gz`.

---

## 14. Security Considerations

Compression bisa membuka side-channel attack pada response yang berisi secret dan attacker-controlled input dalam response yang sama.

Contoh kategori risiko:

- BREACH-style attacks terhadap compressed HTTPS response;
- response HTML yang memuat CSRF token dan input reflektif;
- personalized authenticated page;
- secret dalam response yang ukuran compressed-nya bisa diamati attacker.

### 14.1 Intuisi Side-Channel

Compression membuat ukuran output bergantung pada kesamaan string.

Jika attacker bisa:

1. mengontrol sebagian input yang muncul di response,
2. response juga berisi secret,
3. attacker bisa mengamati ukuran compressed response,

maka ukuran response bisa memberi sinyal tentang secret.

Ini bukan berarti “gzip selalu tidak aman”.

Artinya:

> Jangan sembarangan compress response sensitif yang menggabungkan secret dan attacker-controlled reflection.

### 14.2 Policy Aman

Untuk API JSON biasa:

- authenticated response masih sering dikompresi di banyak sistem;
- tetapi jangan menganggap selalu aman untuk semua endpoint.

Untuk endpoint sangat sensitif:

```nginx
location /account/security/ {
    gzip off;
    proxy_pass http://java_api;
}
```

Atau di aplikasi:

```http
Cache-Control: no-store
```

Lalu Nginx policy bisa dibuat lebih konservatif.

### 14.3 Jangan Compress Secrets dalam HTML Reflektif

Contoh berisiko:

```text
HTML page contains CSRF token + echoes query/search input
```

Jika response dikompresi dan attacker dapat melakukan banyak request terukur, ada risiko side-channel.

Mitigasi bisa mencakup:

- disable compression untuk halaman tertentu,
- pisahkan secret dari reflected content,
- random padding,
- token handling yang lebih aman,
- hindari reflection yang tidak perlu,
- enforce CSRF dan same-site protections.

---

## 15. Response Types: Apa yang Layak Dikompresi?

### 15.1 Sangat Layak

```text
HTML
CSS
JavaScript
JSON
XML
SVG
plain text
CSV
NDJSON
GraphQL JSON response
```

Karakteristik:

- text-based,
- banyak repetisi,
- ukuran sedang/besar,
- mudah dikompresi.

### 15.2 Biasanya Tidak Layak

```text
JPEG
PNG
WebP
AVIF
MP4
MP3
ZIP
GZIP
7z
Brotli file
```

Karakteristik:

- sudah compressed,
- compression tambahan tidak banyak membantu,
- CPU wasted,
- kadang malah membesar.

### 15.3 Case-by-Case

```text
PDF
WASM
large binary protobuf
large CSV download
large JSON export
```

PDF bisa berisi campuran object compressed/uncompressed.

WASM dapat dikompresi dengan gzip/Brotli, terutama sebagai static asset.

Large CSV/JSON export biasanya sangat cocok dikompresi, tetapi perhatikan streaming dan timeout.

---

## 16. Compression and Latency

Compression mengurangi bytes over network, tetapi menambah CPU work.

Total latency kira-kira:

```text
T_total = T_backend + T_transfer + T_compression + T_queueing
```

Compression mengurangi:

```text
T_transfer
```

Tetapi menambah:

```text
T_compression
```

Dan jika CPU Nginx jenuh, juga menambah:

```text
T_queueing
```

### 16.1 When Compression Helps Latency

Compression membantu jika:

- payload besar,
- client network lambat,
- bandwidth mahal/terbatas,
- Nginx CPU masih longgar,
- response text sangat compressible.

### 16.2 When Compression Hurts Latency

Compression bisa merugikan jika:

- payload kecil,
- CPU Nginx sudah tinggi,
- compression level terlalu tinggi,
- response sudah compressed,
- traffic sangat tinggi,
- streaming perlu flush cepat.

### 16.3 Jangan Ukur Hanya Size

Ukuran response kecil bukan satu-satunya target.

Ukur:

- p50 latency,
- p95 latency,
- p99 latency,
- CPU usage Nginx,
- egress bandwidth,
- upstream response time,
- request rate,
- error rate,
- compression ratio.

---

## 17. Observability for Compression

Nginx menyediakan variable `$gzip_ratio` yang bisa dimasukkan ke log format.

Contoh:

```nginx
log_format main_ext escape=json
  '{'
    '"time":"$time_iso8601",'
    '"remote_addr":"$remote_addr",'
    '"request":"$request",'
    '"status":$status,'
    '"body_bytes_sent":$body_bytes_sent,'
    '"request_time":$request_time,'
    '"upstream_response_time":"$upstream_response_time",'
    '"gzip_ratio":"$gzip_ratio",'
    '"sent_http_content_encoding":"$sent_http_content_encoding",'
    '"http_accept_encoding":"$http_accept_encoding"'
  '}';

access_log /var/log/nginx/access.log main_ext;
```

Field penting:

```text
$gzip_ratio
$sent_http_content_encoding
$http_accept_encoding
$body_bytes_sent
$request_time
$upstream_response_time
```

Interpretasi:

```text
http_accept_encoding contains gzip
sent_http_content_encoding = gzip
gzip_ratio = 4.2
```

Artinya response dikompresi dan kira-kira original size sekitar 4.2x compressed output.

Jika:

```text
http_accept_encoding contains gzip
sent_http_content_encoding empty
```

Maka compression tidak terjadi. Kemungkinan:

- `gzip off`,
- MIME type tidak cocok,
- response terlalu kecil,
- upstream sudah mengirim `Content-Encoding`,
- request HTTP version tidak memenuhi,
- proxied response tidak memenuhi `gzip_proxied`,
- location override.

---

## 18. Debugging dengan `curl`

### 18.1 Cek Response Tanpa Compression

```bash
curl -I https://example.com/api/products
```

Perhatikan:

```http
Content-Encoding
Vary
Content-Type
Content-Length
```

### 18.2 Paksa Request dengan Gzip

```bash
curl -I -H 'Accept-Encoding: gzip' https://example.com/api/products
```

Expected:

```http
Content-Encoding: gzip
Vary: Accept-Encoding
```

### 18.3 Download Compressed Bytes

```bash
curl -H 'Accept-Encoding: gzip' --output response.gz https://example.com/api/products
file response.gz
gzip -t response.gz
```

### 18.4 Auto-Decompress di Curl

```bash
curl --compressed https://example.com/api/products
```

`--compressed` membuat curl mengirim `Accept-Encoding` dan otomatis decompress response.

### 18.5 Bandingkan Size

```bash
curl -s -o /dev/null -w 'size=%{size_download} time=%{time_total}\n' \
  https://example.com/api/products

curl -s --compressed -o /dev/null -w 'size=%{size_download} time=%{time_total}\n' \
  https://example.com/api/products
```

Hati-hati: `size_download` dengan `--compressed` bisa merepresentasikan ukuran setelah decoding tergantung behavior curl/version. Untuk inspeksi byte-level, simpan output gzip secara eksplisit.

### 18.6 Cek Static Precompressed File

```bash
curl -I -H 'Accept-Encoding: gzip' https://example.com/assets/app.abc123.js
```

Expected:

```http
Content-Encoding: gzip
Cache-Control: public, immutable
Vary: Accept-Encoding
```

Jika `gzip_static on` tidak bekerja:

- file `.gz` tidak ada,
- path `root`/`alias` salah,
- module tidak tersedia,
- client tidak mengirim `Accept-Encoding: gzip`,
- location tidak sesuai,
- `try_files` mengarah ke lokasi lain.

---

## 19. Common Production Config Patterns

### 19.1 Global Conservative Gzip Policy

```nginx
http {
    gzip on;
    gzip_comp_level 5;
    gzip_min_length 1024;
    gzip_vary on;
    gzip_proxied any;

    gzip_types
        text/plain
        text/css
        text/xml
        text/javascript
        application/javascript
        application/json
        application/xml
        application/rss+xml
        application/atom+xml
        image/svg+xml;
}
```

Ini cukup baik sebagai baseline.

Namun tetap perlu disesuaikan.

### 19.2 Static Asset Policy

```nginx
server {
    location /assets/ {
        root /usr/share/nginx/html;

        gzip_static on;
        gzip on;

        expires 1y;
        add_header Cache-Control "public, immutable" always;
    }
}
```

Kenapa `gzip on` tetap ada?

Jika `.gz` tersedia, `gzip_static` melayani precompressed file.

Jika `.gz` tidak tersedia tetapi MIME cocok, dynamic gzip masih bisa terjadi.

Namun dalam build pipeline yang disiplin, kamu bisa memilih untuk memastikan semua asset besar punya `.gz`.

### 19.3 API Policy

```nginx
server {
    location /api/ {
        proxy_pass http://java_api;

        gzip on;
        gzip_min_length 2048;
        gzip_types application/json application/problem+json;
    }
}
```

Catatan:

- `application/problem+json` sering dipakai untuk error response modern.
- Namun error response kecil biasanya tidak perlu compress karena `gzip_min_length`.

### 19.4 Disable Compression for SSE

```nginx
location /api/events/ {
    proxy_pass http://java_api;

    proxy_buffering off;
    gzip off;
}
```

### 19.5 Disable Compression for Sensitive Endpoint

```nginx
location /account/security/ {
    proxy_pass http://java_api;
    gzip off;
}
```

### 19.6 Avoid Compressing Downloads

```nginx
location /downloads/ {
    root /srv/files;
    gzip off;
}
```

---

## 20. Content Transformation Beyond Compression

Compression adalah salah satu bentuk transformation.

Nginx juga bisa melakukan bentuk transformasi lain, misalnya:

- menambah/mengubah response headers,
- internal redirect,
- subrequest auth,
- error page transformation,
- serving alternative files,
- decompression,
- static compressed representation selection.

Namun ada prinsip penting:

> Semakin banyak Nginx mengubah response, semakin penting kontrak antara upstream, Nginx, cache, dan client.

Jangan membuat Nginx menjadi tempat business logic response.

Nginx cocok untuk transformation yang bersifat infrastructural:

- compression,
- security headers,
- cache headers,
- routing,
- response buffering,
- error fallback tertentu.

Nginx tidak cocok untuk transformation domain-heavy seperti:

- mengubah field JSON berdasarkan role,
- business validation,
- complex personalization,
- domain authorization.

Itu tetap milik aplikasi.

---

## 21. Failure Modes

### 21.1 Double Compression

Gejala:

- client gagal decode,
- JSON parse error,
- response body terlihat binary,
- `Content-Encoding` tidak sesuai.

Penyebab:

- backend Java compression aktif,
- Nginx compression aktif,
- CDN juga melakukan transformasi.

Mitigasi:

- pilih satu compression layer,
- inspect upstream header,
- log `$sent_http_content_encoding`,
- test dengan curl.

### 21.2 Missing `Vary: Accept-Encoding`

Gejala:

- cache mengirim gzip ke client yang tidak support,
- inconsistent response antar client,
- bug hanya terjadi di balik CDN/proxy.

Mitigasi:

```nginx
gzip_vary on;
```

### 21.3 CPU Spike di Nginx

Gejala:

- CPU worker tinggi,
- p99 latency naik,
- bandwidth turun tetapi request time naik,
- 502/504 bisa muncul akibat queueing.

Penyebab:

- `gzip_comp_level` terlalu tinggi,
- compress response besar dengan traffic tinggi,
- compress content yang tidak perlu,
- dynamic compression untuk static assets yang harusnya precompressed.

Mitigasi:

- turunkan `gzip_comp_level`,
- naikkan `gzip_min_length`,
- gunakan `gzip_static`,
- offload ke CDN,
- scale Nginx worker/instance,
- profiling traffic by MIME type.

### 21.4 Streaming Delay

Gejala:

- SSE event terlambat,
- progress update tidak real-time,
- client menerima batch, bukan stream.

Penyebab:

- gzip buffering,
- proxy buffering,
- app flush tidak sampai ke client.

Mitigasi:

```nginx
proxy_buffering off;
gzip off;
```

### 21.5 Wrong MIME Type

Gejala:

- file tidak dikompresi padahal expected,
- browser menolak script/style,
- `.br`/`.gz` asset dikirim dengan content type salah.

Penyebab:

- `types` tidak lengkap,
- file extension tidak dikenali,
- manual header salah,
- `alias`/`try_files` mapping aneh.

Mitigasi:

- cek `Content-Type`,
- include `mime.types`,
- test dengan curl,
- hindari manual content-type kecuali perlu.

### 21.6 Compressing Already Compressed Media

Gejala:

- CPU naik,
- size tidak turun,
- latency naik.

Penyebab:

- `gzip_types *` atau MIME list terlalu agresif.

Mitigasi:

- jangan gunakan wildcard sembarangan,
- whitelist MIME text-based.

### 21.7 CDN and Origin Policy Conflict

Gejala:

- response encoding berbeda antara direct origin dan via CDN,
- cache miss/misvariant,
- brotli/gzip behavior membingungkan.

Mitigasi:

- dokumentasikan compression owner,
- cek CDN compression setting,
- pastikan `Vary` benar,
- test via origin dan CDN.

---

## 22. Benchmarking Compression

Jangan benchmark compression hanya dengan satu file.

Gunakan beberapa kategori:

1. small JSON 300 B,
2. medium JSON 20 KB,
3. large JSON 500 KB,
4. JS bundle 800 KB,
5. CSS 100 KB,
6. image 200 KB,
7. SSE stream,
8. large CSV export.

### 22.1 Metrics

Ukur:

```text
requests/sec
p50 latency
p95 latency
p99 latency
CPU Nginx
memory Nginx
egress bandwidth
response size
error rate
upstream response time
```

### 22.2 Example Experiment

Config A:

```nginx
gzip off;
```

Config B:

```nginx
gzip on;
gzip_comp_level 3;
gzip_min_length 1024;
```

Config C:

```nginx
gzip on;
gzip_comp_level 6;
gzip_min_length 1024;
```

Config D:

```nginx
gzip on;
gzip_comp_level 9;
gzip_min_length 1024;
```

Compare.

Expected pattern:

```text
level 3 -> good CPU, decent size reduction
level 6 -> often balanced
level 9 -> maybe smaller, often not worth CPU
```

But measure in your environment.

### 22.3 Beware Coordinated Omission

If benchmark client sends request only after previous one completes, it may hide queueing latency.

Use tools and methodology that preserve realistic concurrency and arrival rate.

This will be explored more in Part 029.

---

## 23. Practical Production Baseline

Untuk banyak sistem Java backend dengan Nginx sebagai reverse proxy public:

```nginx
http {
    gzip on;
    gzip_comp_level 5;
    gzip_min_length 1024;
    gzip_vary on;
    gzip_proxied any;

    gzip_types
        text/plain
        text/css
        text/xml
        text/javascript
        application/javascript
        application/json
        application/problem+json
        application/xml
        application/rss+xml
        application/atom+xml
        image/svg+xml;

    server {
        listen 443 ssl http2;
        server_name example.com;

        location /assets/ {
            root /usr/share/nginx/html;
            gzip_static on;
            expires 1y;
            add_header Cache-Control "public, immutable" always;
        }

        location /api/events/ {
            proxy_pass http://java_api;
            proxy_buffering off;
            gzip off;
        }

        location /api/ {
            proxy_pass http://java_api;
        }

        location /downloads/ {
            root /srv/files;
            gzip off;
        }
    }
}
```

Ini bukan final universal config, tetapi baseline yang masuk akal.

---

## 24. Anti-Patterns

### 24.1 `gzip_types *;`

Jangan compress semua hal tanpa klasifikasi.

Masalah:

- CPU waste,
- media already compressed,
- unpredictable behavior,
- security risk lebih luas.

### 24.2 `gzip_comp_level 9` Karena “Paling Bagus”

Level tertinggi bukan selalu paling baik.

Target production adalah throughput, latency, cost, dan stability—not maximum compression ratio.

### 24.3 Compression Aktif di Semua Layer

```text
Java app gzip
Nginx gzip
CDN gzip/brotli
```

Tanpa ownership jelas, debugging menjadi buruk.

Tentukan owner:

```text
Static assets: build pipeline + Nginx/CDN serve
Dynamic API: Nginx or CDN, not Java unless deliberate
```

### 24.4 Compress SSE

SSE sering butuh flush cepat. Compression bisa membuat event tidak sampai real-time.

### 24.5 Mengabaikan `Vary`

`gzip_vary off` dalam sistem dengan cache adalah jebakan.

### 24.6 Tidak Melog Encoding

Tanpa log `Content-Encoding`, debugging compression menjadi tebak-tebakan.

---

## 25. Checklist Desain

Sebelum mengaktifkan compression, jawab:

1. Content type apa saja yang akan dikompresi?
2. Apakah response kecil perlu dikompresi?
3. Layer mana pemilik compression?
4. Apakah Java backend compression dimatikan atau dikoordinasikan?
5. Apakah CDN juga melakukan compression?
6. Apakah static assets bisa precompressed?
7. Apakah `Vary: Accept-Encoding` dikirim?
8. Apakah endpoint streaming dikecualikan?
9. Apakah endpoint sensitif perlu dikecualikan?
10. Apakah observability mencatat `gzip_ratio` dan `Content-Encoding`?
11. Apakah ada benchmark CPU/latency/bandwidth?
12. Apakah config sudah dites dengan `curl --compressed`?

---

## 26. Checklist Debugging

Jika compression tidak terjadi:

1. Apakah client mengirim `Accept-Encoding: gzip`?
2. Apakah `gzip on;` aktif di effective location?
3. Apakah MIME type masuk `gzip_types`?
4. Apakah response lebih besar dari `gzip_min_length`?
5. Apakah upstream sudah mengirim `Content-Encoding`?
6. Apakah `gzip_proxied` mengizinkan proxied response itu?
7. Apakah response status code cocok?
8. Apakah directive dioverride di location lain?
9. Apakah request HTTP version memenuhi policy?
10. Apakah module tersedia?

Jika response rusak:

1. Cek double compression.
2. Cek `Content-Encoding`.
3. Cek file static `.gz` benar-benar valid.
4. Jalankan `gzip -t` pada artifact.
5. Cek MIME type.
6. Cek CDN transformation.
7. Cek cache variant.

Jika latency naik:

1. Cek CPU Nginx.
2. Cek `gzip_comp_level`.
3. Cek response size distribution.
4. Cek apakah media compressed ikut dikompresi.
5. Cek p95/p99, bukan hanya average.
6. Pertimbangkan precompression/CDN.

---

## 27. Latihan

### Latihan 1 — API JSON Compression Policy

Kamu punya Spring Boot API dengan response:

```text
/api/users/me              1 KB personalized JSON
/api/reports/monthly       500 KB JSON
/api/events/stream         SSE
/api/files/export.csv      50 MB CSV stream
```

Desain policy compression per endpoint.

Pertimbangkan:

- latency,
- security,
- streaming,
- CPU,
- client compatibility.

### Latihan 2 — Static Asset Pipeline

Frontend build menghasilkan:

```text
index.html
assets/app.abc.js
assets/app.abc.css
assets/logo.png
assets/icon.svg
```

Tentukan:

- file mana yang perlu `.gz`,
- file mana yang tidak perlu,
- cache header apa yang cocok,
- Nginx config untuk `gzip_static`.

### Latihan 3 — Debugging Double Compression

Client melaporkan API response tidak bisa di-parse.

Header response:

```http
Content-Type: application/json
Content-Encoding: gzip
```

Tetapi setelah `curl --compressed`, output masih binary.

Susun investigasi.

Hint:

- cek upstream `Content-Encoding`,
- bypass Nginx,
- cek Spring Boot compression,
- cek CDN.

---

## 28. Ringkasan Mental Model

Compression di Nginx adalah **response transformation**.

Ia mengurangi bandwidth, tetapi menggunakan CPU dan dapat mengubah latency, cache behavior, dan security posture.

Gunakan prinsip berikut:

1. Compress text, jangan compress semua.
2. Jangan compress response kecil tanpa alasan.
3. Jangan compress streaming endpoint kecuali sudah diuji.
4. Untuk static hashed assets, prefer precompression saat build.
5. Untuk API Java, tentukan owner compression: Nginx, app, atau CDN.
6. Hindari double compression.
7. Selalu kirim `Vary: Accept-Encoding` jika response bisa berbeda berdasarkan encoding.
8. Log encoding dan gzip ratio.
9. Benchmark dengan payload dan traffic realistis.
10. Treat compression as production policy, not config decoration.

---

## 29. Referensi

- NGINX `ngx_http_gzip_module`: https://nginx.org/en/docs/http/ngx_http_gzip_module.html
- NGINX `ngx_http_gzip_static_module`: https://nginx.org/en/docs/http/ngx_http_gzip_static_module.html
- NGINX Compression and Decompression Guide: https://docs.nginx.com/nginx/admin-guide/web-server/compression/
- NGINX Brotli Dynamic Module Documentation: https://docs.nginx.com/nginx/admin-guide/dynamic-modules/brotli/
- NGINX Logging Guide, including gzip ratio in log examples: https://docs.nginx.com/nginx/admin-guide/monitoring/logging/

---

## 30. Apa Berikutnya?

Part berikutnya adalah:

```text
Part 015 — Caching with Nginx: Reverse Proxy Cache as Performance and Resilience Tool
```

Compression dan caching sangat berkaitan. Setelah memahami bahwa compression menghasilkan representation variant, kita akan masuk ke bagaimana Nginx menyimpan, mengunci, membypass, menghidangkan stale response, dan menghindari cache poisoning.

---

## Status Seri

Seri **belum selesai**.

Progress saat ini:

```text
Selesai: Part 000 sampai Part 014
Berikutnya: Part 015
Target akhir: Part 030
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-nginx-mastery-for-java-engineers-part-013.md">⬅️ Part 013 — HTTP/2, HTTP/3/QUIC, and Protocol-Level Trade-Offs</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-nginx-mastery-for-java-engineers-part-015.md">Part 015 — Caching with Nginx: Reverse Proxy Cache as Performance and Resilience Tool ➡️</a>
</div>
