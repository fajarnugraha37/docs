# learn-nginx-mastery-for-java-engineers-part-005.md

# Part 005 — Location Matching Deep Dive

> Seri: `learn-nginx-mastery-for-java-engineers`  
> Bagian: `005 / 030`  
> Topik: Nginx `location` matching, routing decision tree, URI handling, internal redirect, `try_files`, dan production failure model  
> Target pembaca: Java software engineer yang ingin memahami Nginx sebagai traffic routing layer secara presisi

---

## 0. Tujuan Bagian Ini

Di bagian sebelumnya kita sudah membahas bagaimana Nginx memilih `server` block berdasarkan kombinasi `listen`, `server_name`, default server, Host header, dan SNI.

Setelah sebuah request masuk ke `server` block yang tepat, pertanyaan berikutnya adalah:

> Di dalam `server` block itu, konfigurasi mana yang akan menangani URI request ini?

Jawabannya ditentukan oleh mekanisme **`location` matching**.

Bagian ini penting karena banyak bug Nginx production bukan berasal dari directive yang rumit, tetapi dari salah memahami pertanyaan sederhana ini:

> Untuk URI tertentu, `location` mana yang sebenarnya dipilih Nginx?

Kesalahan di area ini bisa menyebabkan:

- static asset dikirim ke backend Java;
- route API tidak pernah sampai ke backend;
- SPA fallback menelan endpoint API;
- file private tanpa sengaja terekspos;
- regex location override konfigurasi yang terlihat lebih spesifik;
- `proxy_pass` membentuk upstream URI yang salah;
- `try_files` membuat internal redirect yang tidak terlihat jelas;
- error 404, 403, 405, 500, 502 yang sumbernya tampak membingungkan.

Tujuan bagian ini bukan sekadar menghafal syntax `location`, tetapi membangun mental model bahwa:

> `location` matching adalah routing decision tree di dalam satu virtual server.

Setelah bagian ini, kamu harus bisa:

1. membaca konfigurasi `location` secara deterministik;
2. memprediksi `location` mana yang dipilih untuk URI tertentu;
3. membedakan exact, prefix, `^~`, regex, dan named location;
4. memahami efek `try_files`, `rewrite`, dan internal redirect terhadap pemilihan location;
5. mendesain routing untuk kombinasi SPA + API + static files + uploads + admin endpoints;
6. mendiagnosis bug production akibat salah location matching.

---

## 1. Posisi `location` dalam Request Lifecycle

Secara sederhana, request Nginx melewati tahapan berikut:

```text
Client
  |
  v
TCP/TLS accept
  |
  v
Select listen socket / server block
  |
  v
Normalize and process URI
  |
  v
Select location
  |
  v
Run directives inside selected location
  |
  +--> serve static file
  +--> proxy to upstream
  +--> return response
  +--> rewrite / internal redirect
  +--> named location
```

`server` memilih **host boundary**.

`location` memilih **route handler**.

Dalam aplikasi Java, ini mirip seperti routing layer sebelum request masuk ke controller:

```text
Nginx server block
  ≈ virtual host / application boundary

Nginx location block
  ≈ route mapping / handler selection

Spring @RequestMapping
  ≈ application-level route after proxying
```

Tetapi ada perbedaan besar:

- Spring route dipilih setelah request masuk ke application runtime.
- Nginx `location` dipilih sebelum request menyentuh aplikasi.
- Kesalahan di Nginx bisa membuat request tidak pernah sampai ke Java.
- Kesalahan di Nginx bisa membuat Java menerima path yang berbeda dari path yang dikirim client.

Contoh:

```nginx
server {
    listen 80;
    server_name example.com;

    location /api/ {
        proxy_pass http://backend:8080/;
    }

    location / {
        root /var/www/app;
        try_files $uri /index.html;
    }
}
```

Request:

```text
GET /api/users
```

Secara desain harus masuk ke backend Java.

Request:

```text
GET /dashboard/settings
```

Harus masuk ke SPA fallback `/index.html`.

Jika location order atau semantics salah, `/api/users` bisa malah ditangani oleh SPA fallback dan mengembalikan HTML, bukan JSON. Dari sisi frontend, error-nya mungkin terlihat seperti:

```text
Unexpected token '<', "<!doctype html>..." is not valid JSON
```

Padahal akar masalahnya adalah location matching.

---

## 2. Jenis-Jenis `location`

Nginx menyediakan beberapa bentuk `location`.

Secara praktis, kamu akan sering memakai ini:

```nginx
location = /exact { ... }
location /prefix/ { ... }
location ^~ /prefix-no-regex/ { ... }
location ~ pattern { ... }
location ~* pattern { ... }
location @name { ... }
```

Masing-masing punya arti berbeda.

---

## 3. Exact Match: `location = /path`

Exact match hanya menang jika URI sama persis.

```nginx
location = /healthz {
    return 200 "ok\n";
}
```

Cocok untuk:

```text
/healthz
```

Tidak cocok untuk:

```text
/healthz/
/healthz/check
/healthz?verbose=true
```

Catatan penting: query string tidak menentukan location matching. Untuk request:

```text
/healthz?verbose=true
```

URI untuk matching adalah:

```text
/healthz
```

Jadi contoh di atas tetap cocok.

Exact match biasanya dipakai untuk endpoint kecil yang ingin ditangani cepat dan eksplisit:

```nginx
location = /favicon.ico {
    access_log off;
    log_not_found off;
}

location = /robots.txt {
    access_log off;
    log_not_found off;
}

location = /healthz {
    return 200 "ok\n";
}
```

Keunggulan exact match:

- paling jelas;
- paling tidak ambigu;
- berhenti lebih awal dalam proses matching;
- cocok untuk route sentinel seperti health check.

Namun jangan gunakan exact match untuk route yang punya subpath.

Salah:

```nginx
location = /api {
    proxy_pass http://backend;
}
```

Ini tidak menangani:

```text
/api/users
/api/orders/123
```

---

## 4. Prefix Match: `location /path/`

Prefix match cocok jika URI diawali prefix tertentu.

```nginx
location /api/ {
    proxy_pass http://backend:8080;
}
```

Cocok untuk:

```text
/api/users
/api/orders/123
/api/
```

Tidak cocok untuk:

```text
/api
/apix/users
```

Perhatikan perbedaan `/api` dan `/api/`.

```nginx
location /api {
    proxy_pass http://backend:8080;
}
```

Cocok untuk:

```text
/api
/api/
/api/users
/apix
/api-v2
```

Ini sering menjadi bug.

Jika maksudmu adalah path segment `/api`, biasanya lebih aman memakai kombinasi:

```nginx
location = /api {
    return 301 /api/;
}

location /api/ {
    proxy_pass http://backend:8080;
}
```

Atau jika `/api` adalah endpoint valid:

```nginx
location = /api {
    proxy_pass http://backend:8080;
}

location /api/ {
    proxy_pass http://backend:8080;
}
```

Mental model:

```text
location /api   = string prefix, not path segment matcher
location /api/  = safer segment-like prefix
```

---

## 5. Preferential Prefix: `location ^~ /path/`

`^~` berarti:

> Jika prefix ini adalah prefix match terbaik, jangan lanjut mengecek regex location.

Contoh:

```nginx
location ^~ /assets/ {
    root /var/www/app;
    expires 1y;
    add_header Cache-Control "public, immutable";
}

location ~* \.(js|css|png|jpg|jpeg|gif|svg)$ {
    root /var/www/legacy;
}
```

Request:

```text
/assets/app.js
```

Akan masuk ke:

```nginx
location ^~ /assets/
```

Bukan regex static extension, walaupun `/assets/app.js` cocok regex `\.(js|css|...)$`.

`^~` sangat berguna saat kamu ingin mengatakan:

> Untuk prefix ini, jangan biarkan regex global mengambil alih.

Cocok untuk:

- `/api/` yang harus selalu ke backend;
- `/assets/` yang harus selalu dari static asset directory tertentu;
- `/.well-known/` untuk ACME challenge;
- `/internal/` yang harus punya policy khusus;
- `/uploads/` dengan aturan file serving khusus.

Contoh:

```nginx
location ^~ /api/ {
    proxy_pass http://java_api;
}

location ~* \.(html|js|css|png|svg)$ {
    root /var/www/spa;
}
```

Tanpa `^~`, regex extension bisa menang atas prefix `/api/` dalam beberapa desain konfigurasi, terutama jika API endpoint punya suffix mirip file:

```text
/api/reports/export.csv
/api/files/avatar.png
```

Jika endpoint Java `/api/files/avatar.png` seharusnya diproses backend, regex static file tidak boleh mengambil alih.

---

## 6. Regex Match: `location ~` dan `location ~*`

Regex location memakai regular expression.

```nginx
location ~ \.php$ {
    fastcgi_pass php_backend;
}
```

`~` berarti case-sensitive.

```nginx
location ~* \.(jpg|jpeg|png|gif|svg)$ {
    expires 30d;
}
```

`~*` berarti case-insensitive.

Cocok untuk:

```text
/image.PNG
/photo.jpg
/icon.SVG
```

Regex location powerful, tetapi harus dipakai hati-hati.

Masalah utamanya:

1. regex location diperiksa setelah prefix match normal;
2. regex pertama yang cocok akan dipilih;
3. regex bisa mengambil alih prefix match normal jika prefix tersebut bukan `^~`;
4. urutan regex location di file konfigurasi penting;
5. regex membuat routing lebih sulit diprediksi.

Contoh bahaya:

```nginx
location /api/ {
    proxy_pass http://backend:8080;
}

location ~* \.(json|xml)$ {
    root /var/www/static;
}
```

Request:

```text
/api/users.json
```

Bisa ditangani oleh regex `.json`, bukan `/api/`, jika regex cocok dan prefix `/api/` tidak memakai `^~`.

Untuk API, biasanya lebih aman:

```nginx
location ^~ /api/ {
    proxy_pass http://backend:8080;
}
```

---

## 7. Named Location: `location @name`

Named location tidak dipilih langsung oleh URI client.

```nginx
location @backend_fallback {
    proxy_pass http://backend:8080;
}
```

Named location dipanggil oleh internal redirect, misalnya dari `try_files` atau `error_page`.

```nginx
location / {
    try_files $uri $uri/ @backend_fallback;
}

location @backend_fallback {
    proxy_pass http://backend:8080;
}
```

Request:

```text
/products/123
```

Flow:

```text
1. location / dipilih
2. try_files cek /products/123 sebagai file
3. cek /products/123/ sebagai directory
4. jika tidak ada, internal redirect ke @backend_fallback
5. @backend_fallback proxy ke backend
```

Named location berguna untuk membuat fallback eksplisit tanpa membuat URI baru.

Contoh pattern:

```nginx
location / {
    try_files $uri @app;
}

location @app {
    proxy_pass http://java_app;
}
```

Namun jangan pakai named location untuk semua hal. Jika routing normal cukup jelas dengan prefix location, gunakan prefix location.

---

## 8. Algoritma Pemilihan Location

Ini bagian paling penting.

Secara mental, Nginx memilih location dengan urutan seperti ini:

```text
1. Cari exact match: location = /uri
   - Jika ada, pakai itu dan berhenti.

2. Cari prefix match terpanjang.
   - Simpan prefix terbaik.

3. Jika prefix terbaik memakai ^~
   - Pakai prefix itu dan jangan cek regex.

4. Cek regex location sesuai urutan kemunculan.
   - Regex pertama yang cocok dipakai.

5. Jika tidak ada regex cocok
   - Pakai prefix match terbaik yang sudah disimpan.
```

Representasi decision tree:

```text
Request URI
   |
   v
Exact location exists?
   | yes
   v
Use exact location
   |
  no
   v
Find longest prefix
   |
   v
Is longest prefix ^~ ?
   | yes
   v
Use that prefix
   |
  no
   v
Try regex locations in order
   | first match found
   v
Use regex location
   |
  none
   v
Use longest prefix location
```

Ini menjelaskan kenapa urutan deklarasi prefix location biasanya tidak sepenting panjang prefix, tetapi urutan regex location sangat penting.

Contoh:

```nginx
location / {
    return 200 "root\n";
}

location /api/ {
    return 200 "api\n";
}

location /api/admin/ {
    return 200 "admin\n";
}
```

Request:

```text
/api/admin/users
```

Dipilih:

```nginx
location /api/admin/
```

Karena prefix terpanjang menang.

Urutan deklarasi berikut tetap menghasilkan hal yang sama:

```nginx
location /api/admin/ {
    return 200 "admin\n";
}

location / {
    return 200 "root\n";
}

location /api/ {
    return 200 "api\n";
}
```

Tetapi untuk regex:

```nginx
location ~* \.(jpg|png)$ {
    return 200 "image\n";
}

location ~* \.png$ {
    return 200 "png\n";
}
```

Request:

```text
/logo.png
```

Dipilih regex pertama:

```nginx
location ~* \.(jpg|png)$
```

Bukan regex kedua yang tampak lebih spesifik.

Karena regex pertama yang cocok menang.

---

## 9. Praktik Membaca Location Config

Saat membaca konfigurasi Nginx, jangan membaca dari atas ke bawah seperti imperative program biasa.

Baca dengan urutan semantik:

1. Kumpulkan semua exact location.
2. Kumpulkan semua prefix location.
3. Tentukan prefix terpanjang untuk URI target.
4. Perhatikan apakah prefix terbaik memakai `^~`.
5. Jika tidak, evaluasi regex dari atas ke bawah.
6. Perhatikan internal redirect dari `try_files`, `rewrite`, dan `error_page`.

Contoh konfigurasi:

```nginx
server {
    listen 80;
    server_name example.com;

    location / {
        root /var/www/app;
        try_files $uri /index.html;
    }

    location /api/ {
        proxy_pass http://backend:8080;
    }

    location ~* \.(js|css|png|jpg|svg)$ {
        root /var/www/app;
        expires 1y;
    }
}
```

Untuk request:

```text
/api/users
```

- exact match? tidak ada.
- prefix terbaik? `/api/`.
- prefix `/api/` bukan `^~`.
- cek regex: `/api/users` tidak cocok extension static.
- pakai `/api/`.

Untuk request:

```text
/api/export/report.csv
```

Jika regex static mencakup `.csv`, maka request bisa masuk regex.

Misalnya:

```nginx
location ~* \.(js|css|png|jpg|svg|csv)$ {
    root /var/www/app;
    expires 1y;
}
```

Request `/api/export/report.csv`:

- prefix terbaik `/api/`.
- bukan `^~`.
- regex `.csv` cocok.
- regex menang.

Ini bug.

Perbaikan:

```nginx
location ^~ /api/ {
    proxy_pass http://backend:8080;
}
```

---

## 10. URI, Query String, dan Normalization

`location` matching dilakukan terhadap normalized URI, bukan full URL.

Request:

```text
GET https://example.com/api/users?page=1
```

Komponen:

```text
scheme      = https
host        = example.com
uri         = /api/users
query       = page=1
```

`location` matching memakai:

```text
/api/users
```

Bukan:

```text
/api/users?page=1
```

Jadi ini:

```nginx
location /api/users?page=1 {
    ...
}
```

Tidak valid sebagai cara matching query.

Jika perlu routing berdasarkan query string, gunakan variable seperti `$arg_name`, `map`, atau logika aplikasi. Namun routing berdasarkan query di Nginx sebaiknya jarang dipakai karena membuat behavior sulit dipahami.

Contoh:

```nginx
map $arg_preview $is_preview {
    default 0;
    true    1;
}
```

Tapi untuk sebagian besar sistem Java, query-level decision lebih baik ditangani aplikasi.

---

## 11. `root` vs `alias` dalam Location

Walaupun `root` dan `alias` akan dibahas lebih dalam di Part 006, kamu harus memahami efeknya karena sering muncul bersama `location`.

### 11.1 `root`

Dengan `root`, Nginx membentuk file path dengan:

```text
document_root + URI
```

Contoh:

```nginx
location /static/ {
    root /var/www/app;
}
```

Request:

```text
/static/css/app.css
```

File yang dicari:

```text
/var/www/app/static/css/app.css
```

### 11.2 `alias`

Dengan `alias`, prefix location diganti oleh path alias.

```nginx
location /static/ {
    alias /var/www/app/assets/;
}
```

Request:

```text
/static/css/app.css
```

File yang dicari:

```text
/var/www/app/assets/css/app.css
```

Kesalahan trailing slash pada `alias` sering berbahaya.

Biasanya untuk prefix location, gunakan slash konsisten:

```nginx
location /static/ {
    alias /var/www/app/assets/;
}
```

Bukan:

```nginx
location /static/ {
    alias /var/www/app/assets;
}
```

Karena path concatenation bisa menjadi tidak sesuai ekspektasi.

---

## 12. `try_files`: File Check, Internal Redirect, dan Fallback

`try_files` adalah salah satu directive paling sering dipakai dan paling sering disalahpahami.

Format umum:

```nginx
try_files file1 file2 ... fallback;
```

Nginx akan mencoba file/directory secara berurutan. Jika tidak ada yang cocok, Nginx melakukan internal redirect ke fallback terakhir.

Contoh untuk static file:

```nginx
location / {
    root /var/www/app;
    try_files $uri $uri/ =404;
}
```

Request:

```text
/images/logo.png
```

Nginx cek:

```text
/var/www/app/images/logo.png
/var/www/app/images/logo.png/
```

Jika tidak ada, return 404.

### 12.1 SPA Fallback

Untuk SPA:

```nginx
location / {
    root /var/www/spa;
    try_files $uri $uri/ /index.html;
}
```

Request:

```text
/dashboard/settings
```

Jika file `/dashboard/settings` tidak ada, internal redirect ke:

```text
/index.html
```

Lalu Nginx memilih location lagi untuk `/index.html`.

Jika tidak ada location khusus, biasanya tetap masuk `location /` dan serve file `/var/www/spa/index.html`.

Ini cocok untuk client-side routing.

### 12.2 SPA Fallback Bisa Menelan API

Konfigurasi berbahaya:

```nginx
location / {
    root /var/www/spa;
    try_files $uri $uri/ /index.html;
}

location /api {
    proxy_pass http://backend:8080;
}
```

Bug 1: `location /api` juga match `/apix`.

Bug 2: jika API path tidak cocok karena typo, request bisa fallback ke index.

Lebih aman:

```nginx
location ^~ /api/ {
    proxy_pass http://backend:8080;
}

location = /api {
    return 301 /api/;
}

location / {
    root /var/www/spa;
    try_files $uri $uri/ /index.html;
}
```

Namun masih ada keputusan desain:

- Apakah `/api/unknown` harus ke backend dan backend return 404 JSON?
- Atau Nginx boleh return 404 langsung?

Untuk API, biasanya lebih baik request masuk backend agar error contract konsisten.

---

## 13. Internal Redirect dan Location Re-Evaluation

Beberapa directive bisa menyebabkan internal redirect:

- `try_files`
- `rewrite ... last`
- `error_page`
- index resolution
- named location jump

Internal redirect berarti Nginx mengevaluasi URI baru secara internal dan dapat memilih location berbeda.

Contoh:

```nginx
location / {
    root /var/www/app;
    try_files $uri /fallback.html;
}

location = /fallback.html {
    root /var/www/errors;
}
```

Request:

```text
/does-not-exist
```

Flow:

```text
1. request URI /does-not-exist
2. location / dipilih
3. try_files gagal menemukan file
4. internal redirect ke /fallback.html
5. location matching dijalankan lagi
6. location = /fallback.html dipilih
7. file dicari di /var/www/errors/fallback.html
```

Ini bisa mengejutkan karena fallback file tidak selalu diserve dari root location awal.

Mental model:

```text
try_files fallback URI bukan sekadar path file;
ia bisa memicu location selection baru.
```

Jika kamu ingin fallback ke handler tanpa URI rematching biasa, named location bisa lebih jelas:

```nginx
location / {
    root /var/www/app;
    try_files $uri @fallback;
}

location @fallback {
    return 404 "not found\n";
}
```

---

## 14. `rewrite` dan Dampaknya pada Location

`rewrite` bisa mengubah URI.

Contoh:

```nginx
location /old/ {
    rewrite ^/old/(.*)$ /new/$1 last;
}

location /new/ {
    proxy_pass http://backend:8080;
}
```

Request:

```text
/old/users
```

Flow:

```text
1. location /old/ dipilih
2. rewrite URI menjadi /new/users
3. flag last memicu location search baru
4. location /new/ dipilih
5. proxy ke backend
```

Berbeda dengan `break`:

```nginx
location /old/ {
    rewrite ^/old/(.*)$ /new/$1 break;
    proxy_pass http://backend:8080;
}
```

Dengan `break`, rewrite berhenti di location saat ini dan tidak mencari location baru.

Untuk desain modern, hindari rewrite kompleks jika bisa diganti dengan location dan `proxy_pass` yang jelas.

Rewrite kompleks membuat config sulit diverifikasi.

---

## 15. `proxy_pass` dan Trailing Slash Semantics

Ini salah satu sumber bug paling sering untuk Java backend.

Ada perbedaan besar antara:

```nginx
location /api/ {
    proxy_pass http://backend:8080;
}
```

Dan:

```nginx
location /api/ {
    proxy_pass http://backend:8080/;
}
```

### 15.1 Tanpa URI di `proxy_pass`

```nginx
location /api/ {
    proxy_pass http://backend:8080;
}
```

Request:

```text
/api/users
```

Upstream menerima URI:

```text
/api/users
```

Prefix `/api/` dipertahankan.

Cocok jika Java app memang punya route:

```java
@RequestMapping("/api")
```

### 15.2 Dengan URI `/` di `proxy_pass`

```nginx
location /api/ {
    proxy_pass http://backend:8080/;
}
```

Request:

```text
/api/users
```

Upstream menerima URI:

```text
/users
```

Prefix `/api/` diganti oleh `/`.

Cocok jika Java app route internalnya:

```java
@RequestMapping("/users")
```

Dan Nginx mengeksposnya ke publik sebagai `/api/users`.

### 15.3 Contoh Bug

Frontend memanggil:

```text
/api/users
```

Spring Boot punya controller:

```java
@RestController
@RequestMapping("/api/users")
class UserController { ... }
```

Nginx config:

```nginx
location /api/ {
    proxy_pass http://backend:8080/;
}
```

Backend menerima:

```text
/users
```

Spring return 404.

Engineer melihat Nginx access log 404/502 dan mengira backend down. Padahal URI rewrite tidak sesuai contract.

Prinsip:

> Putuskan apakah `/api` adalah external prefix saja atau bagian dari route contract backend.

Jika `/api` bagian dari backend contract:

```nginx
proxy_pass http://backend:8080;
```

Jika `/api` hanya external prefix:

```nginx
proxy_pass http://backend:8080/;
```

Dokumentasikan keputusan ini.

---

## 16. Common Routing Topologies

### 16.1 SPA + Java API

Pattern umum:

```nginx
server {
    listen 80;
    server_name example.com;

    location = /healthz {
        return 200 "ok\n";
    }

    location ^~ /api/ {
        proxy_pass http://java_api:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        root /var/www/spa;
        try_files $uri $uri/ /index.html;
    }
}
```

Behavior:

```text
/healthz              -> Nginx direct response
/api/users            -> Java backend receives /api/users
/assets/app.hash.js   -> static file if exists
/dashboard/settings   -> /index.html SPA fallback
```

### 16.2 SPA + Java API with Stripped Prefix

```nginx
location ^~ /api/ {
    proxy_pass http://java_api:8080/;
}
```

Behavior:

```text
/api/users -> backend receives /users
```

Gunakan hanya jika backend tidak mengetahui prefix `/api`.

### 16.3 Static Assets with Strong Cache + SPA HTML No Cache

```nginx
location ^~ /assets/ {
    root /var/www/spa;
    expires 1y;
    add_header Cache-Control "public, immutable";
    try_files $uri =404;
}

location = /index.html {
    root /var/www/spa;
    add_header Cache-Control "no-cache";
}

location / {
    root /var/www/spa;
    try_files $uri $uri/ /index.html;
}
```

Rationale:

- hashed assets boleh cache lama;
- `index.html` sebaiknya tidak immutable karena menunjuk asset hash terbaru;
- unknown SPA route fallback ke `index.html`.

### 16.4 Uploads Served from Separate Directory

```nginx
location ^~ /uploads/ {
    alias /data/app/uploads/;
    try_files $uri =404;
    add_header X-Content-Type-Options nosniff;
}
```

Hati-hati:

- jangan aktifkan autoindex kecuali memang perlu;
- jangan serve file user-uploaded dari domain yang sama tanpa policy;
- validasi MIME dan extension di aplikasi;
- pertimbangkan object storage/CDN untuk production.

### 16.5 Admin Endpoint Restricted

```nginx
location ^~ /admin/ {
    allow 10.0.0.0/8;
    deny all;

    proxy_pass http://admin_backend:8080;
}
```

Untuk Spring Actuator:

```nginx
location ^~ /actuator/ {
    allow 10.0.0.0/8;
    deny all;

    proxy_pass http://java_api:8080;
}
```

Namun jangan bergantung hanya pada IP allowlist untuk endpoint sensitif. Aplikasi tetap harus punya authorization.

---

## 17. Designing Location Blocks as Policy Boundaries

Cara berpikir yang matang:

> Setiap `location` bukan hanya routing rule, tetapi policy boundary.

Untuk setiap location, tanyakan:

1. Siapa boleh mengakses?
2. Apakah request diproxy atau diserve lokal?
3. Apakah body size dibatasi?
4. Apakah rate limit berlaku?
5. Apakah response boleh dicache?
6. Header apa yang harus diteruskan?
7. Apakah path boleh fallback?
8. Jika tidak ditemukan, siapa yang return 404: Nginx atau backend?
9. Apakah path ini boleh match regex lain?
10. Bagaimana observability-nya?

Contoh desain lebih eksplisit:

```nginx
server {
    listen 443 ssl http2;
    server_name app.example.com;

    # 1. Exact operational endpoint
    location = /nginx-healthz {
        access_log off;
        return 200 "ok\n";
    }

    # 2. API boundary: never let regex/static fallback hijack this
    location ^~ /api/ {
        client_max_body_size 10m;
        proxy_pass http://java_api:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # 3. Internal app monitoring boundary
    location ^~ /actuator/ {
        allow 10.0.0.0/8;
        deny all;
        proxy_pass http://java_api:8080;
    }

    # 4. Immutable assets
    location ^~ /assets/ {
        root /var/www/spa;
        try_files $uri =404;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # 5. SPA entrypoint
    location = /index.html {
        root /var/www/spa;
        add_header Cache-Control "no-cache";
    }

    # 6. Frontend fallback
    location / {
        root /var/www/spa;
        try_files $uri $uri/ /index.html;
    }
}
```

Ini lebih mudah diaudit daripada config yang bergantung pada regex besar.

---

## 18. Failure Mode 1: API Dikembalikan Sebagai HTML SPA

Gejala:

- frontend fetch `/api/users`;
- response status 200;
- `Content-Type: text/html`;
- body adalah `index.html`;
- Java backend log tidak mencatat request.

Penyebab umum:

```nginx
location / {
    root /var/www/spa;
    try_files $uri $uri/ /index.html;
}

location /api {
    proxy_pass http://backend:8080;
}
```

Atau tidak ada `location /api/` sama sekali.

Diagnosis:

```bash
curl -i https://example.com/api/users
```

Periksa:

```text
HTTP status
Content-Type
Server header
Body awal
Nginx access log
Backend access log
```

Fix:

```nginx
location ^~ /api/ {
    proxy_pass http://backend:8080;
}

location = /api {
    return 301 /api/;
}
```

Prinsip:

> API path tidak boleh jatuh ke SPA fallback.

---

## 19. Failure Mode 2: Regex Static Mengambil API File-Like Path

Gejala:

- `/api/export/report.csv` return 404 dari Nginx;
- backend tidak melihat request;
- path biasa `/api/users` berhasil.

Config bermasalah:

```nginx
location /api/ {
    proxy_pass http://backend:8080;
}

location ~* \.(csv|json|xml|png|jpg)$ {
    root /var/www/static;
}
```

Request `/api/export/report.csv` cocok regex `.csv`.

Fix:

```nginx
location ^~ /api/ {
    proxy_pass http://backend:8080;
}
```

Atau batasi regex static pada prefix asset:

```nginx
location ^~ /assets/ {
    root /var/www/app;
    try_files $uri =404;
    expires 1y;
}
```

Lebih baik daripada regex global extension.

---

## 20. Failure Mode 3: `/api` vs `/api/`

Gejala:

- `/api/users` berhasil;
- `/api` gagal atau masuk SPA;
- redirect loop terjadi;
- health check ke `/api` gagal.

Desain harus eksplisit.

Opsi 1: redirect `/api` ke `/api/`:

```nginx
location = /api {
    return 301 /api/;
}

location ^~ /api/ {
    proxy_pass http://backend:8080;
}
```

Opsi 2: proxy keduanya:

```nginx
location = /api {
    proxy_pass http://backend:8080;
}

location ^~ /api/ {
    proxy_pass http://backend:8080;
}
```

Opsi 3: return explicit 404 untuk `/api`:

```nginx
location = /api {
    return 404;
}
```

Yang buruk adalah membiarkan `/api` jatuh ke fallback tanpa keputusan sadar.

---

## 21. Failure Mode 4: `alias` Salah Membuka Path Tak Terduga

Config:

```nginx
location /files/ {
    alias /data/files;
}
```

Seharusnya:

```nginx
location /files/ {
    alias /data/files/;
}
```

Trailing slash mismatch bisa membuat path resolution tidak sesuai mental model.

Prinsip:

```text
location /prefix/  -> alias /some/path/
```

Selalu test:

```bash
curl -i http://localhost/files/example.txt
nginx -T
```

Dan verifikasi file path yang diharapkan.

---

## 22. Failure Mode 5: `try_files` Fallback ke URI yang Punya Location Lain

Config:

```nginx
location /docs/ {
    root /var/www/docs;
    try_files $uri /index.html;
}

location = /index.html {
    root /var/www/spa;
}
```

Request:

```text
/docs/missing
```

Mungkin kamu mengira fallback ke:

```text
/var/www/docs/index.html
```

Tapi internal redirect `/index.html` bisa memilih:

```nginx
location = /index.html
```

Lalu file dicari di:

```text
/var/www/spa/index.html
```

Fix jika ingin fallback relatif docs:

```nginx
location /docs/ {
    root /var/www;
    try_files $uri /docs/index.html;
}
```

Atau gunakan named location:

```nginx
location /docs/ {
    root /var/www;
    try_files $uri @docs_fallback;
}

location @docs_fallback {
    root /var/www;
    rewrite ^ /docs/index.html break;
}
```

Namun solusi paling sederhana biasanya desain root/path yang konsisten.

---

## 23. Debugging Location Matching

Nginx tidak punya command sederhana seperti:

```bash
nginx --explain-location /api/users
```

Jadi debugging perlu disiplin.

### 23.1 Dump Effective Config

```bash
nginx -T
```

Ini menampilkan konfigurasi final setelah `include` digabung.

Jangan hanya lihat satu file. Banyak bug berasal dari file lain di `conf.d` atau `sites-enabled`.

### 23.2 Tambahkan Temporary Header untuk Identifikasi Location

Saat debugging staging/local, tambahkan header:

```nginx
location ^~ /api/ {
    add_header X-Debug-Location "api" always;
    proxy_pass http://backend:8080;
}

location / {
    add_header X-Debug-Location "spa" always;
    root /var/www/spa;
    try_files $uri $uri/ /index.html;
}
```

Test:

```bash
curl -i http://localhost/api/users
curl -i http://localhost/dashboard
```

Output:

```text
X-Debug-Location: api
```

atau:

```text
X-Debug-Location: spa
```

Jangan tinggalkan debug header di production kecuali memang bagian dari observability internal yang disetujui.

### 23.3 Gunakan Return untuk Isolasi

Saat local testing:

```nginx
location ^~ /api/ {
    return 200 "matched api\n";
}
```

Ini membantu memastikan matching sebelum masuk ke upstream problem.

### 23.4 Curl Matrix

Buat matrix URI:

```bash
curl -i http://localhost/
curl -i http://localhost/index.html
curl -i http://localhost/assets/app.js
curl -i http://localhost/api
curl -i http://localhost/api/
curl -i http://localhost/api/users
curl -i http://localhost/api/export/report.csv
curl -i http://localhost/dashboard/settings
curl -i http://localhost/.env
curl -i http://localhost/actuator/health
```

Jangan hanya test happy path.

### 23.5 Periksa Access Log dengan URI dan Upstream

Gunakan log format yang memuat upstream:

```nginx
log_format main_ext '$remote_addr - $host "$request" '
                    'status=$status body_bytes=$body_bytes_sent '
                    'uri=$uri request_uri=$request_uri '
                    'upstream=$upstream_addr upstream_status=$upstream_status '
                    'request_time=$request_time upstream_time=$upstream_response_time';
```

Perbedaan `$uri` dan `$request_uri` penting:

- `$request_uri` berisi original URI + query string;
- `$uri` bisa berubah setelah normalization/internal rewrite.

---

## 24. Location Design for Java Engineers

Sebagai Java engineer, kamu harus melihat Nginx location sebagai kontrak sebelum aplikasi.

Contoh route Java:

```java
@RestController
@RequestMapping("/api/users")
class UserController {
    @GetMapping("/{id}")
    UserResponse getUser(@PathVariable String id) { ... }
}
```

Ada dua pilihan kontrak Nginx:

### 24.1 Preserve External Path

```nginx
location ^~ /api/ {
    proxy_pass http://backend:8080;
}
```

Backend menerima:

```text
/api/users/123
```

Kelebihan:

- path yang dilihat client sama dengan path yang dilihat backend;
- lebih mudah trace log end-to-end;
- redirect dan generated URL lebih natural;
- cocok untuk aplikasi yang memang expose API prefix.

Kekurangan:

- backend tahu external prefix;
- jika prefix berubah, backend route mungkin ikut berubah.

### 24.2 Strip External Prefix

```nginx
location ^~ /api/ {
    proxy_pass http://backend:8080/;
}
```

Backend menerima:

```text
/users/123
```

Kelebihan:

- backend route lebih “internal clean”;
- external prefix bisa diubah di gateway.

Kekurangan:

- tracing lebih sulit;
- generated URL perlu forwarded headers/base path handling;
- raw backend logs berbeda dari client path;
- developer bisa bingung saat debugging.

Rekomendasi praktis:

Untuk tim backend Java yang ingin observability sederhana, default ke **preserve path** kecuali ada alasan kuat untuk strip prefix.

---

## 25. Anti-Patterns

### 25.1 Regex Global untuk Semua Static Files

```nginx
location ~* \.(js|css|png|jpg|json|xml|csv)$ {
    root /var/www/static;
}
```

Masalah:

- bisa menangkap API file-like path;
- sulit diaudit;
- behavior tergantung regex order;
- sering bentrok dengan `/api/`, `/uploads/`, `/admin/`.

Lebih baik:

```nginx
location ^~ /assets/ {
    root /var/www/app;
    try_files $uri =404;
}
```

### 25.2 Catch-All Proxy Tanpa Static Boundary

```nginx
location / {
    proxy_pass http://backend;
}
```

Ini boleh untuk pure backend service, tetapi buruk jika server yang sama juga melayani frontend/static/admin. Semua request salah path masuk backend dan menambah noise.

### 25.3 SPA Fallback Terlalu Luas

```nginx
location / {
    try_files $uri /index.html;
}
```

Tanpa exception untuk API, admin, actuator, uploads, dotfiles.

### 25.4 Banyak Regex yang Saling Overlap

```nginx
location ~ /api/.*\.json$ { ... }
location ~ /api/private/ { ... }
location ~* \.json$ { ... }
```

Ini sulit diprediksi. Gunakan prefix hierarchy jika bisa.

### 25.5 Mengandalkan Urutan Prefix Location

```nginx
location /api/ { ... }
location /api/admin/ { ... }
```

Urutan tidak menentukan prefix winner; prefix terpanjang yang menang.

Ini bukan bug, tapi jika engineer mengira urutan penting, mereka bisa salah reasoning.

---

## 26. Recommended Location Ordering Style

Walaupun Nginx tidak selalu memakai order deklarasi untuk prefix, manusia membaca file dari atas ke bawah. Jadi susun config agar mudah diaudit.

Urutan yang disarankan:

```text
1. exact operational endpoints
2. security-sensitive exact/prefix blocks
3. API prefix blocks with ^~
4. admin/internal prefix blocks with ^~
5. static asset prefix blocks with ^~
6. special files: favicon, robots, sitemap
7. limited regex blocks if truly needed
8. catch-all frontend/backend fallback
9. named locations
```

Contoh:

```nginx
server {
    listen 443 ssl;
    server_name example.com;

    # Exact operational endpoints
    location = /healthz { return 200 "ok\n"; }

    # API boundary
    location ^~ /api/ { proxy_pass http://api; }

    # Admin boundary
    location ^~ /admin/ { proxy_pass http://admin; }

    # Static assets
    location ^~ /assets/ {
        root /var/www/app;
        try_files $uri =404;
    }

    # Special files
    location = /favicon.ico { access_log off; }
    location = /robots.txt  { access_log off; }

    # Only if needed
    location ~* \.(map)$ { return 404; }

    # Catch-all
    location / {
        root /var/www/app;
        try_files $uri $uri/ /index.html;
    }
}
```

Ini bukan requirement Nginx, tetapi requirement maintainability.

---

## 27. Production Checklist

Sebelum deploy config dengan banyak location, cek ini:

### 27.1 Matching Correctness

- [ ] Apakah `/api/` memakai `^~` jika ada regex static global?
- [ ] Apakah `/api` tanpa slash ditangani eksplisit?
- [ ] Apakah `/admin/` tidak jatuh ke SPA fallback?
- [ ] Apakah `/actuator/` atau endpoint monitoring dilindungi?
- [ ] Apakah `/.env`, `/.git`, dan dotfiles tidak terserve?
- [ ] Apakah `/assets/` tidak diproxy ke backend?
- [ ] Apakah unknown frontend route fallback ke `index.html`?
- [ ] Apakah unknown API route masuk backend atau return 404 sesuai kontrak?

### 27.2 URI Contract

- [ ] Apakah `proxy_pass` preserve path atau strip prefix?
- [ ] Apakah backend Java route sesuai dengan pilihan itu?
- [ ] Apakah log backend dan log Nginx bisa dikorelasikan?
- [ ] Apakah redirect dari backend tetap benar?

### 27.3 Static File Safety

- [ ] Apakah `root` vs `alias` benar?
- [ ] Apakah trailing slash `alias` benar?
- [ ] Apakah `try_files` mencegah path fallback aneh?
- [ ] Apakah cache header berbeda untuk hashed asset dan `index.html`?

### 27.4 Debuggability

- [ ] Apakah `nginx -T` sudah direview?
- [ ] Apakah curl matrix sudah dites?
- [ ] Apakah log memuat upstream info?
- [ ] Apakah ada cara membedakan response dari Nginx vs backend?

---

## 28. Latihan Mental Model

Gunakan konfigurasi berikut:

```nginx
server {
    listen 80;
    server_name example.com;

    location / {
        return 200 "root\n";
    }

    location /api/ {
        return 200 "api\n";
    }

    location ^~ /assets/ {
        return 200 "assets\n";
    }

    location = /api/health {
        return 200 "api health\n";
    }

    location ~* \.(json|png)$ {
        return 200 "regex file\n";
    }
}
```

Tentukan output untuk:

```text
/
/api/users
/api/users.json
/api/health
/assets/logo.png
/assets/data.json
/apix/test
```

Jawaban:

```text
/                  -> root
/api/users          -> api
/api/users.json     -> regex file
/api/health         -> api health
/assets/logo.png    -> assets
/assets/data.json   -> assets
/apix/test          -> root
```

Kenapa `/api/users.json` masuk regex?

Karena `/api/` adalah prefix biasa, bukan `^~`, sehingga regex masih diperiksa dan regex `.json` menang.

Kenapa `/assets/logo.png` tidak masuk regex?

Karena prefix terbaik `/assets/` memakai `^~`, sehingga regex dilewati.

---

## 29. Latihan Desain

Desain Nginx untuk requirement berikut:

1. Domain `app.example.com`.
2. SPA berada di `/var/www/app`.
3. Hashed assets berada di `/assets/` dan boleh cache 1 tahun.
4. `/api/` diproxy ke Spring Boot di `127.0.0.1:8080`.
5. Backend harus menerima path lengkap `/api/...`.
6. `/api` tanpa slash redirect ke `/api/`.
7. `/actuator/` hanya boleh dari network `10.0.0.0/8`.
8. Unknown SPA route fallback ke `/index.html`.
9. Unknown API route harus tetap masuk backend.
10. Dotfiles harus ditolak.

Salah satu jawaban:

```nginx
server {
    listen 80;
    server_name app.example.com;

    location = /healthz {
        access_log off;
        return 200 "ok\n";
    }

    location ~ /\. {
        deny all;
    }

    location = /api {
        return 301 /api/;
    }

    location ^~ /api/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location ^~ /actuator/ {
        allow 10.0.0.0/8;
        deny all;

        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location ^~ /assets/ {
        root /var/www/app;
        try_files $uri =404;
        expires 1y;
        add_header Cache-Control "public, immutable" always;
    }

    location = /index.html {
        root /var/www/app;
        add_header Cache-Control "no-cache" always;
    }

    location / {
        root /var/www/app;
        try_files $uri $uri/ /index.html;
    }
}
```

Catatan: dalam desain ini, `/actuator/` diletakkan terpisah dari `/api/`. Jika actuator sebenarnya berada di bawah `/api/actuator/`, location harus disesuaikan.

---

## 30. Ringkasan Mental Model

Ingat lima aturan utama:

### 30.1 Exact Match Paling Kuat

```nginx
location = /healthz { ... }
```

Jika URI sama persis, ini menang dan proses matching berhenti.

### 30.2 Prefix Terpanjang Menjadi Kandidat

```nginx
location /api/ { ... }
location /api/admin/ { ... }
```

Untuk `/api/admin/users`, kandidat terbaik adalah `/api/admin/`.

### 30.3 `^~` Menghentikan Regex

```nginx
location ^~ /api/ { ... }
```

Jika ini prefix terbaik, regex tidak diperiksa.

### 30.4 Regex Pertama yang Cocok Menang

```nginx
location ~* \.(json|png)$ { ... }
location ~* \.png$ { ... }
```

Untuk `/logo.png`, regex pertama menang.

### 30.5 `try_files` dan `rewrite` Bisa Memicu Location Search Baru

```nginx
try_files $uri /index.html;
```

Fallback `/index.html` adalah internal redirect URI, bukan sekadar file path sederhana.

---

## 31. Cara Berpikir Top 1% Engineer terhadap Nginx Location

Engineer biasa bertanya:

> Syntax location mana yang harus saya pakai?

Engineer kuat bertanya:

> Untuk setiap URI penting, policy boundary mana yang harus menangani request ini, dan bagaimana saya membuktikan Nginx akan memilih boundary itu secara deterministik?

Engineer biasa menulis:

```nginx
location /api { ... }
location / { try_files ... /index.html; }
```

Engineer kuat menulis:

```nginx
location = /api { return 301 /api/; }
location ^~ /api/ { proxy_pass ...; }
location / { try_files $uri $uri/ /index.html; }
```

Karena ia sadar bahwa:

- `/api` dan `/api/` berbeda;
- prefix match bukan path segment match;
- SPA fallback tidak boleh menelan API;
- regex bisa mencuri request dari prefix biasa;
- `proxy_pass` trailing slash menentukan URI contract ke backend;
- location adalah policy boundary, bukan sekadar folder mapping.

---

## 32. Koneksi ke Part Berikutnya

Bagian ini membahas pemilihan `location` sebagai routing decision tree.

Part berikutnya akan masuk lebih dalam ke:

> **Part 006 — Static File Serving: Root, Alias, Index, Try Files, and SPA Hosting**

Di sana kita akan membahas detail static file serving:

- `root` vs `alias` lebih dalam;
- `index`;
- `try_files` untuk static dan SPA;
- MIME type;
- cache header;
- hashed assets;
- directory traversal risk;
- file permission;
- sendfile;
- static asset production strategy.

---

## Status Seri

- Selesai: Part 000, 001, 002, 003, 004, 005
- Saat ini: **Part 005 selesai**
- Belum selesai: Part 006 sampai Part 030
- Seri belum mencapai bagian terakhir

