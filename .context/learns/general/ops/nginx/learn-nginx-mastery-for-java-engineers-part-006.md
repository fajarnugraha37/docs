# learn-nginx-mastery-for-java-engineers-part-006.md

# Part 006 — Static File Serving: Root, Alias, Index, Try Files, and SPA Hosting

## Status Seri

- Seri: `learn-nginx-mastery-for-java-engineers`
- Part: `006` dari `030`
- Status seri: **belum selesai**
- Part sebelumnya: `Part 005 — Location Matching Deep Dive`
- Part berikutnya: `Part 007 — Reverse Proxy Fundamentals for Java Backends`

---

## 0. Tujuan Part Ini

Di part sebelumnya, kita sudah membahas bagaimana Nginx memilih `location` block. Di part ini kita masuk ke salah satu konsekuensi paling penting dari pemilihan `location`: **bagaimana Nginx memetakan URI menjadi file di filesystem**.

Static file serving terlihat sederhana:

```nginx
location / {
    root /var/www/app;
}
```

Namun di production, static file serving sering menjadi sumber masalah serius:

- SPA route menghasilkan 404 ketika user refresh halaman.
- `/api/users` malah mengembalikan `index.html`.
- asset JavaScript lama masih di-cache browser setelah deploy.
- file rahasia seperti `.env`, `.git/config`, backup file, atau source map tidak sengaja terbuka.
- `alias` salah slash lalu path filesystem menjadi tidak sesuai.
- MIME type salah sehingga browser menolak script/module.
- Nginx melayani direktori yang salah karena salah paham antara `root` dan `alias`.
- static file serving terlihat cepat di lokal, tetapi bottleneck di production karena file descriptor, disk I/O, cache, atau logging.

Tujuan part ini bukan hanya membuat kamu bisa menulis config static file. Targetnya adalah membangun mental model:

> Static file serving di Nginx adalah proses deterministik: **pilih server → pilih location → bentuk path filesystem → cek file/directory → lakukan internal redirect/fallback → kirim response dengan header, MIME, cache policy, dan access control yang benar**.

Setelah part ini, kamu harus bisa:

1. menjelaskan perbedaan `root` dan `alias` tanpa hafalan;
2. mendesain konfigurasi static file untuk website, SPA, dokumentasi, download, dan asset versioned;
3. membedakan kapan `try_files` harus fallback ke `index.html`, kapan harus `=404`, dan kapan harus proxy ke backend;
4. mencegah static route menelan API route;
5. mendesain cache header yang aman untuk frontend modern;
6. menghindari exposure file sensitif;
7. melakukan debugging static file serving secara sistematis.

---

## 1. Static File Serving dalam Arsitektur Backend Modern

Sebagai Java software engineer, kamu mungkin melihat Nginx terutama sebagai reverse proxy di depan Spring Boot, Quarkus, Micronaut, Tomcat, atau service Java lain. Namun static file serving tetap penting karena Nginx sering dipakai untuk melayani:

- file build frontend: `index.html`, `.js`, `.css`, font, image;
- API documentation: Swagger UI/OpenAPI docs;
- public assets: logo, icon, robots.txt, sitemap.xml;
- generated reports;
- downloadable files;
- maintenance page;
- static error page;
- admin console frontend;
- internal tools;
- documentation portal;
- artifact repository sederhana;
- fallback page ketika upstream Java down.

Di banyak sistem, Nginx berada di depan dua jenis traffic:

```text
Client
  |
  v
Nginx
  |-- /assets/*       -> filesystem
  |-- /favicon.ico    -> filesystem
  |-- /docs/*         -> filesystem
  |-- /               -> SPA index.html
  |-- /api/*          -> Java backend
  |-- /ws/*           -> Java backend WebSocket
```

Masalahnya: static file serving dan reverse proxy sering berada dalam `server` block yang sama. Karena itu, kesalahan kecil di `location`, `try_files`, `root`, atau `alias` bisa membuat request yang seharusnya masuk backend malah dilayani sebagai file, atau sebaliknya.

---

## 2. Mental Model Utama: URI Bukan Path Filesystem

Kesalahan pertama banyak engineer adalah menganggap URI sama dengan path filesystem.

Contoh request:

```text
GET /assets/app.8f31a2.js HTTP/1.1
Host: example.com
```

URI-nya:

```text
/assets/app.8f31a2.js
```

Filesystem path mungkin:

```text
/var/www/frontend/assets/app.8f31a2.js
```

Nginx tidak otomatis tahu mapping itu. Mapping terjadi melalui kombinasi:

- `server` yang terpilih;
- `location` yang terpilih;
- directive `root` atau `alias`;
- directive `try_files`;
- optional internal redirect;
- optional `index` handling.

Jadi cara berpikir yang benar:

```text
URI request
  -> server selection
  -> location selection
  -> root/alias mapping
  -> try_files existence check
  -> internal redirect or final response
  -> headers + body sent to client
```

Jangan berpikir:

```text
URL /assets/app.js pasti otomatis berarti file /assets/app.js di server.
```

Itu salah.

---

## 3. `root`: Menambahkan URI ke Direktori Root

`root` menentukan direktori dasar. Nginx membentuk path file dengan cara:

```text
filesystem_path = root + request_uri_path
```

Contoh:

```nginx
server {
    listen 80;
    server_name example.com;

    root /var/www/site;

    location / {
        try_files $uri $uri/ =404;
    }
}
```

Request:

```text
GET /css/main.css
```

Nginx mencoba:

```text
/var/www/site/css/main.css
```

Request:

```text
GET /images/logo.png
```

Nginx mencoba:

```text
/var/www/site/images/logo.png
```

Dengan `root`, bagian URI tetap ikut dimasukkan ke path filesystem.

### 3.1 `root` di Level `server`

Pola umum:

```nginx
server {
    listen 80;
    server_name example.com;

    root /var/www/example.com/public;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }
}
```

Ini bagus ketika mayoritas route di server tersebut berasal dari direktori yang sama.

### 3.2 `root` di Level `location`

```nginx
server {
    listen 80;
    server_name example.com;

    location /static/ {
        root /var/www/example.com;
    }
}
```

Request:

```text
/static/app.js
```

Path yang dicari:

```text
/var/www/example.com/static/app.js
```

Banyak orang salah mengira path-nya menjadi:

```text
/var/www/example.com/app.js
```

Padahal tidak. Dengan `root`, prefix `/static/` tetap ikut.

### 3.3 Kapan Menggunakan `root`

Gunakan `root` ketika struktur URI mirip dengan struktur filesystem.

Contoh:

```text
URI:        /assets/app.js
Filesystem: /var/www/frontend/assets/app.js
```

Config:

```nginx
root /var/www/frontend;
```

Mapping-nya natural.

---

## 4. `alias`: Mengganti Prefix Location dengan Direktori Lain

`alias` berbeda. Dengan `alias`, bagian location prefix diganti oleh path alias.

Contoh:

```nginx
location /static/ {
    alias /srv/cdn-build/;
}
```

Request:

```text
/static/app.js
```

Path yang dicari:

```text
/srv/cdn-build/app.js
```

Bukan:

```text
/srv/cdn-build/static/app.js
```

Dengan kata lain:

```text
URI /static/app.js
location prefix /static/
alias /srv/cdn-build/

result = /srv/cdn-build/ + app.js
```

### 4.1 Pola Slash Aman untuk `alias`

Gunakan pola ini:

```nginx
location /static/ {
    alias /srv/static/;
}
```

Keduanya memakai trailing slash:

```text
location /static/
alias    /srv/static/
```

Ini mengurangi risiko path menjadi aneh.

Hindari bentuk yang membingungkan:

```nginx
location /static {
    alias /srv/static;
}
```

Bisa bekerja dalam beberapa kasus, tetapi rawan salah baca dan rawan edge case.

### 4.2 Kapan Menggunakan `alias`

Gunakan `alias` ketika URI public tidak sama dengan struktur filesystem.

Contoh:

```text
URI public: /docs/*
Filesystem: /opt/generated-openapi-ui/*
```

Config:

```nginx
location /docs/ {
    alias /opt/generated-openapi-ui/;
    try_files $uri $uri/ =404;
}
```

Request:

```text
/docs/index.html
```

Path:

```text
/opt/generated-openapi-ui/index.html
```

### 4.3 `root` vs `alias` dalam Satu Gambar Mental

`root`:

```text
location /static/
root /var/www
URI /static/app.js
=> /var/www/static/app.js
```

`alias`:

```text
location /static/
alias /var/www/build/
URI /static/app.js
=> /var/www/build/app.js
```

Ringkasnya:

| Directive | Cara Mapping | Cocok Untuk |
|---|---|---|
| `root` | `root + full URI` | URI mengikuti struktur folder |
| `alias` | `alias + URI setelah location prefix` | URI public berbeda dari folder asli |

---

## 5. `index`: Directory Request dan File Default

Directive `index` menentukan file default ketika request menunjuk ke direktori.

Contoh:

```nginx
root /var/www/site;
index index.html;

location / {
    try_files $uri $uri/ =404;
}
```

Request:

```text
GET /
```

Nginx melihat `/var/www/site/` sebagai direktori, lalu mencoba:

```text
/var/www/site/index.html
```

Request:

```text
GET /docs/
```

Nginx mencoba:

```text
/var/www/site/docs/index.html
```

### 5.1 `index` Tidak Sama dengan SPA Fallback

Ini penting.

`index` hanya bekerja ketika request mengarah ke direktori.

Contoh:

```text
/about
```

Jika `/var/www/site/about` bukan direktori dan bukan file, `index index.html` tidak otomatis membuat Nginx mengembalikan `/index.html`.

Untuk SPA route fallback, kamu butuh `try_files`:

```nginx
try_files $uri $uri/ /index.html;
```

---

## 6. `try_files`: Existence Check dan Internal Redirect

`try_files` adalah salah satu directive paling penting untuk static serving.

Bentuk umum:

```nginx
try_files file1 file2 ... fallback;
```

Nginx mencoba file/directory berurutan. Jika tidak ada yang cocok, Nginx menggunakan fallback terakhir.

Contoh:

```nginx
location / {
    root /var/www/site;
    try_files $uri $uri/ =404;
}
```

Request:

```text
GET /css/main.css
```

Nginx mencoba:

```text
/var/www/site/css/main.css
/var/www/site/css/main.css/
```

Jika tidak ada, return 404.

### 6.1 `$uri` vs `$request_uri`

Untuk `try_files`, umumnya gunakan `$uri`, bukan `$request_uri`.

- `$uri`: path URI yang sudah dinormalisasi, tanpa query string.
- `$request_uri`: URI asli dari request, termasuk query string.

Contoh request:

```text
/assets/app.js?v=123
```

`$uri`:

```text
/assets/app.js
```

`$request_uri`:

```text
/assets/app.js?v=123
```

Untuk mencari file di filesystem, `$uri` lebih tepat.

### 6.2 Fallback ke Status Code

```nginx
try_files $uri $uri/ =404;
```

Artinya:

1. coba file;
2. coba directory;
3. kalau gagal, return 404.

Ini cocok untuk static directory murni, misalnya `/assets/`, `/downloads/`, `/docs/`.

### 6.3 Fallback ke URI Internal

```nginx
try_files $uri $uri/ /index.html;
```

Jika file tidak ada, Nginx melakukan internal redirect ke `/index.html`.

Ini cocok untuk SPA route:

```text
/dashboard
/settings/profile
/orders/123
```

Semua route itu bukan file fisik, tetapi harus dilayani oleh frontend router.

### 6.4 Fallback ke Named Location

```nginx
location / {
    try_files $uri @backend;
}

location @backend {
    proxy_pass http://java_backend;
}
```

Ini berguna untuk pola:

```text
serve static if exists, otherwise proxy to app
```

Namun harus dipakai hati-hati. Jika terlalu luas, request yang harusnya 404 bisa masuk backend dan menyulitkan debugging.

---

## 7. Static Website Konvensional

Untuk static website biasa:

```nginx
server {
    listen 80;
    server_name static.example.com;

    root /var/www/static-site;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }
}
```

Struktur filesystem:

```text
/var/www/static-site/
  index.html
  about/
    index.html
  css/
    main.css
  js/
    app.js
```

Request:

```text
/                 -> /var/www/static-site/index.html
/about/           -> /var/www/static-site/about/index.html
/css/main.css     -> /var/www/static-site/css/main.css
/missing          -> 404
```

Ini tidak cocok untuk SPA client-side routing jika route seperti `/dashboard` tidak ada sebagai file/directory.

---

## 8. Hosting SPA: Vue, React, Angular, Svelte, dan Sejenisnya

SPA modern biasanya menghasilkan:

```text
dist/
  index.html
  assets/
    index-a81f2c3d.js
    index-3b11e9a0.css
    logo-82cc11.svg
```

Browser pertama kali mengambil `index.html`, lalu `index.html` mereferensikan asset hashed.

Frontend router mengelola route seperti:

```text
/dashboard
/settings/profile
/orders/123
```

Ketika user refresh `/dashboard`, browser mengirim request langsung ke server:

```text
GET /dashboard
```

Padahal tidak ada file `/var/www/app/dashboard`.

Karena itu SPA butuh fallback:

```nginx
server {
    listen 80;
    server_name app.example.com;

    root /var/www/app/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Request:

```text
/                         -> /var/www/app/dist/index.html
/assets/index-a81f.js      -> /var/www/app/dist/assets/index-a81f.js
/dashboard                 -> fallback /index.html
/settings/profile          -> fallback /index.html
```

### 8.1 SPA Fallback Tidak Boleh Menelan API

Masalah umum:

```nginx
location / {
    try_files $uri $uri/ /index.html;
}
```

Jika tidak ada location khusus untuk `/api/`, request ini:

```text
GET /api/users
```

akan fallback ke:

```text
/index.html
```

Akibatnya client menerima HTML padahal mengharapkan JSON.

Gejala di frontend:

```text
Unexpected token '<', "<!doctype html>..." is not valid JSON
```

Config yang benar:

```nginx
server {
    listen 80;
    server_name app.example.com;

    root /var/www/app/dist;
    index index.html;

    location /api/ {
        proxy_pass http://java_backend;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Karena `location /api/` lebih spesifik daripada `location /`, `/api/users` akan masuk backend.

### 8.2 Beri 404 untuk Missing Asset, Jangan Fallback ke `index.html`

Masalah lain:

```text
GET /assets/missing.js
```

Dengan config sederhana:

```nginx
location / {
    try_files $uri $uri/ /index.html;
}
```

Asset missing juga akan menerima `index.html`.

Akibatnya browser bisa menolak script karena MIME type HTML, atau frontend error menjadi tidak jelas.

Lebih baik buat location khusus asset:

```nginx
location /assets/ {
    try_files $uri =404;
}

location / {
    try_files $uri $uri/ /index.html;
}
```

Dengan ini:

```text
/assets/existing.js -> file
/assets/missing.js  -> 404
/dashboard          -> index.html
```

Ini jauh lebih eksplisit.

---

## 9. Cache Policy untuk SPA Modern

Static caching harus dibedakan antara:

1. `index.html`
2. hashed assets
3. non-hashed assets
4. API response

### 9.1 Kenapa `index.html` Biasanya Tidak Boleh Di-cache Lama

`index.html` adalah entry point. Ia menunjuk ke asset versi terbaru.

Contoh `index.html` lama:

```html
<script src="/assets/app.oldhash.js"></script>
```

Setelah deploy baru, file lama mungkin sudah tidak ada. Jika browser masih memakai `index.html` lama, browser akan meminta asset lama dan mendapat 404.

Karena itu `index.html` biasanya diberi policy:

```text
Cache-Control: no-cache
```

`no-cache` bukan berarti tidak boleh disimpan sama sekali. Artinya browser harus revalidate sebelum memakai ulang.

Config:

```nginx
location = /index.html {
    add_header Cache-Control "no-cache" always;
}
```

Atau kalau ingin lebih agresif mencegah storage:

```nginx
location = /index.html {
    add_header Cache-Control "no-store" always;
}
```

Namun `no-store` bisa mengurangi performance karena browser tidak menyimpan sama sekali. Banyak SPA cukup memakai `no-cache` atau `max-age=0, must-revalidate`.

### 9.2 Hashed Assets Boleh Di-cache Lama

Build tool modern menghasilkan filename seperti:

```text
app.8f31a2.js
style.a122bd.css
vendor.3c91aa.js
```

Jika content berubah, filename berubah. Ini memungkinkan caching panjang:

```nginx
location /assets/ {
    try_files $uri =404;
    add_header Cache-Control "public, max-age=31536000, immutable" always;
}
```

Makna:

- `public`: boleh disimpan shared cache;
- `max-age=31536000`: satu tahun;
- `immutable`: browser tidak perlu revalidate selama freshness lifetime karena URL dianggap content-addressed/versioned.

### 9.3 Jangan Cache HTML seperti Asset Hashed

Anti-pattern:

```nginx
location / {
    add_header Cache-Control "public, max-age=31536000, immutable";
    try_files $uri $uri/ /index.html;
}
```

Ini berbahaya karena `/dashboard`, `/settings`, dan `/index.html` bisa menerima cache panjang.

Akibat:

- user stuck di versi lama;
- rollback/deploy tidak terlihat;
- bug frontend sulit hilang;
- cache invalidation menjadi kacau.

Pisahkan policy:

```nginx
location /assets/ {
    try_files $uri =404;
    add_header Cache-Control "public, max-age=31536000, immutable" always;
}

location = /index.html {
    add_header Cache-Control "no-cache" always;
}

location / {
    try_files $uri $uri/ /index.html;
    add_header Cache-Control "no-cache" always;
}
```

### 9.4 Cache Policy untuk `robots.txt`, `favicon.ico`, dan Manifest

Contoh:

```nginx
location = /favicon.ico {
    try_files /favicon.ico =404;
    access_log off;
    add_header Cache-Control "public, max-age=86400" always;
}

location = /robots.txt {
    try_files /robots.txt =404;
    access_log off;
    add_header Cache-Control "public, max-age=3600" always;
}

location = /manifest.webmanifest {
    try_files /manifest.webmanifest =404;
    add_header Cache-Control "no-cache" always;
}
```

Manifest kadang berubah bersama release, jadi jangan selalu cache terlalu lama kecuali filename-nya juga versioned.

---

## 10. Static Frontend + Java Backend dalam Satu Domain

Pola umum:

```text
https://app.example.com/          -> SPA
https://app.example.com/assets/*  -> static assets
https://app.example.com/api/*     -> Java backend
https://app.example.com/ws/*      -> Java WebSocket
```

Config awal yang sehat:

```nginx
upstream java_backend {
    server 127.0.0.1:8080;
    keepalive 32;
}

server {
    listen 80;
    server_name app.example.com;

    root /var/www/app/dist;
    index index.html;

    location /api/ {
        proxy_pass http://java_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /assets/ {
        try_files $uri =404;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
    }

    location = /index.html {
        add_header Cache-Control "no-cache" always;
    }

    location / {
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-cache" always;
    }
}
```

Catatan:

- `/api/` harus lebih spesifik daripada `/`.
- `/assets/` diberi 404 jika missing.
- SPA route fallback hanya berlaku untuk route non-asset/non-api.
- Header proxy akan dibahas detail di Part 007 dan 008, jadi di sini cukup sebagai preview.

---

## 11. Hosting SPA di Subpath

Kadang frontend tidak di-host di `/`, tetapi di subpath:

```text
https://example.com/admin/
https://example.com/console/
https://example.com/backoffice/
```

Ini lebih sulit karena ada tiga mapping yang harus konsisten:

1. base path di frontend build;
2. Nginx location mapping;
3. fallback route.

Contoh untuk `/admin/` memakai `alias`:

```nginx
location /admin/ {
    alias /var/www/admin/dist/;
    try_files $uri $uri/ /admin/index.html;
}
```

Namun hati-hati: fallback `/admin/index.html` adalah URI, bukan path filesystem. Nginx akan melakukan internal redirect ke location matching baru. Ini bisa bekerja jika mapping-nya benar, tapi sering membingungkan.

Pola yang lebih eksplisit:

```nginx
location /admin/assets/ {
    alias /var/www/admin/dist/assets/;
    try_files $uri =404;
    add_header Cache-Control "public, max-age=31536000, immutable" always;
}

location /admin/ {
    alias /var/www/admin/dist/;
    try_files $uri $uri/ /admin/index.html;
    add_header Cache-Control "no-cache" always;
}
```

Tetapi ini tetap punya jebakan karena `try_files` dengan `alias` perlu diuji dengan `nginx -T` dan `curl`.

Alternatif yang sering lebih mudah dipahami adalah menyusun filesystem agar cocok dengan `root`:

```text
/var/www/site/
  admin/
    index.html
    assets/
      app.hash.js
```

Config:

```nginx
root /var/www/site;

location /admin/assets/ {
    try_files $uri =404;
    add_header Cache-Control "public, max-age=31536000, immutable" always;
}

location /admin/ {
    try_files $uri $uri/ /admin/index.html;
    add_header Cache-Control "no-cache" always;
}
```

Untuk sistem besar, pilihan ini sering lebih maintainable karena URI dan filesystem sejajar.

---

## 12. `root` vs `alias` untuk Multiple Frontend Apps

Misalnya satu Nginx melayani:

```text
/               -> customer portal
/admin/         -> admin portal
/docs/          -> documentation
/api/           -> Java backend
```

### 12.1 Pendekatan `alias`

```nginx
server {
    listen 80;
    server_name example.com;

    location /api/ {
        proxy_pass http://java_backend;
    }

    location /admin/assets/ {
        alias /srv/admin/dist/assets/;
        try_files $uri =404;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
    }

    location /admin/ {
        alias /srv/admin/dist/;
        try_files $uri $uri/ /admin/index.html;
        add_header Cache-Control "no-cache" always;
    }

    location /docs/ {
        alias /srv/docs/;
        try_files $uri $uri/ =404;
    }

    location /assets/ {
        root /srv/customer/dist;
        try_files $uri =404;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
    }

    location / {
        root /srv/customer/dist;
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-cache" always;
    }
}
```

Ini fleksibel, tetapi perlu disiplin tinggi.

### 12.2 Pendekatan Filesystem Sejajar dengan URI

Struktur:

```text
/srv/www/example.com/
  index.html
  assets/
  admin/
    index.html
    assets/
  docs/
    index.html
```

Config:

```nginx
server {
    listen 80;
    server_name example.com;

    root /srv/www/example.com;
    index index.html;

    location /api/ {
        proxy_pass http://java_backend;
    }

    location /assets/ {
        try_files $uri =404;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
    }

    location /admin/assets/ {
        try_files $uri =404;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
    }

    location /admin/ {
        try_files $uri $uri/ /admin/index.html;
        add_header Cache-Control "no-cache" always;
    }

    location /docs/ {
        try_files $uri $uri/ =404;
    }

    location / {
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-cache" always;
    }
}
```

Ini biasanya lebih mudah dipahami oleh tim karena path public sama dengan path deploy.

---

## 13. Directory Listing: `autoindex`

Secara default, directory listing tidak selalu aktif. Jika aktif, Nginx dapat menampilkan daftar file di direktori.

Contoh:

```nginx
location /downloads/ {
    root /srv/public;
    autoindex on;
}
```

Request:

```text
/downloads/
```

Jika tidak ada `index.html`, Nginx bisa menampilkan daftar file.

### 13.1 Risiko `autoindex`

`autoindex on` bisa mengekspos:

- file sementara;
- backup;
- log;
- arsip internal;
- nama file sensitif;
- struktur direktori;
- dokumen yang tidak sengaja diletakkan di folder public.

Gunakan hanya untuk use case yang memang perlu directory listing, misalnya mirror internal atau repository file sederhana.

Lebih aman:

```nginx
location /downloads/ {
    root /srv/public;
    autoindex off;
    try_files $uri =404;
}
```

---

## 14. MIME Types dan Browser Behavior

Nginx menggunakan `types` mapping untuk menentukan `Content-Type` berdasarkan ekstensi file.

Biasanya ada:

```nginx
include /etc/nginx/mime.types;
default_type application/octet-stream;
```

Jika MIME salah, browser bisa menolak asset.

Contoh error umum:

```text
Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of "text/html".
```

Penyebab umum:

- file `.js` missing tetapi fallback ke `index.html`;
- `mime.types` tidak di-include;
- custom extension tidak dikenali;
- wrong location menangkap request.

### 14.1 Debug MIME

Gunakan:

```bash
curl -I https://app.example.com/assets/app.hash.js
```

Cek:

```text
HTTP/2 200
Content-Type: application/javascript
Cache-Control: public, max-age=31536000, immutable
```

Jika `Content-Type: text/html`, kemungkinan besar kamu menerima `index.html`, bukan JS file.

---

## 15. Hidden Files dan Sensitive File Exposure

Nginx tidak otomatis memahami file mana yang sensitif secara bisnis. Jika file ada di direktori public dan route bisa mencapainya, file bisa terbuka.

Blokir dotfiles:

```nginx
location ~ /\. {
    deny all;
}
```

Namun hati-hati dengan `/.well-known/` untuk ACME challenge atau standar tertentu.

Pola yang lebih aman:

```nginx
location ~ /\.(?!well-known/) {
    deny all;
}
```

Atau eksplisit:

```nginx
location ^~ /.well-known/ {
    root /var/www/acme;
    try_files $uri =404;
}

location ~ /\. {
    deny all;
}
```

### 15.1 File yang Harus Dicegah Muncul di Public Root

Jangan pernah letakkan ini di public root:

```text
.env
.git/
.gitignore
Dockerfile
docker-compose.yml
application.yml
application.properties
*.pem
*.key
*.crt private key
*.sql
*.bak
*.old
*.zip backup
node_modules/
src/
target/
build.gradle
pom.xml
```

Lebih baik desain deploy artifact agar public root hanya berisi output final, misalnya:

```text
/var/www/app/dist/
```

bukan root repository:

```text
/home/app/my-repo/
```

### 15.2 Jangan Jadikan Repository Root sebagai Web Root

Anti-pattern:

```nginx
root /home/deploy/my-frontend-repo;
```

Lebih aman:

```nginx
root /opt/apps/my-frontend/releases/2026-06-19T120000Z/dist;
```

Atau symlink stabil:

```text
/opt/apps/my-frontend/current -> /opt/apps/my-frontend/releases/2026-06-19T120000Z
```

Config:

```nginx
root /opt/apps/my-frontend/current/dist;
```

---

## 16. Path Traversal dan URI Normalization

Path traversal adalah percobaan mengakses file di luar direktori yang diizinkan, misalnya:

```text
/../../etc/passwd
/assets/../../../secret.txt
```

Nginx melakukan normalisasi URI dalam banyak kasus, tetapi jangan desain config yang bergantung pada asumsi longgar.

Prinsip aman:

1. public root harus minimal;
2. gunakan `try_files` eksplisit;
3. jangan expose parent directory;
4. hindari regex `alias` kompleks tanpa testing;
5. jangan mencampur user-controlled path dengan alias internal secara sembarangan;
6. gunakan permission filesystem yang membatasi akses user Nginx.

Contoh permission sehat:

```bash
chown -R root:root /opt/apps/my-frontend/releases
find /opt/apps/my-frontend/releases -type d -exec chmod 755 {} \;
find /opt/apps/my-frontend/releases -type f -exec chmod 644 {} \;
```

User Nginx cukup read-only.

---

## 17. Serving Downloads

Untuk download file besar:

```nginx
location /downloads/ {
    alias /srv/downloads/;
    try_files $uri =404;
    default_type application/octet-stream;
    add_header Content-Disposition "attachment";
}
```

Namun ada beberapa pertanyaan desain:

- Apakah semua file boleh public?
- Apakah perlu authorization?
- Apakah URL harus signed/temporary?
- Apakah download harus dilayani Nginx langsung atau lewat application-controlled redirect?
- Apakah file besar akan mengganggu bandwidth traffic API?
- Apakah access log untuk download besar perlu dipisah?

### 17.1 Private Download dengan Java + Nginx Internal Location

Pola production yang umum:

1. Client request ke Java:

```text
GET /api/files/123/download
```

2. Java melakukan authorization.
3. Jika authorized, Java mengembalikan header internal seperti `X-Accel-Redirect`.
4. Nginx melayani file secara efisien dari internal location.

Contoh Nginx:

```nginx
location /api/ {
    proxy_pass http://java_backend;
}

location /protected-files/ {
    internal;
    alias /srv/private-files/;
}
```

Java response:

```text
X-Accel-Redirect: /protected-files/report-123.pdf
Content-Type: application/pdf
```

Manfaat:

- authorization tetap di Java;
- transfer file dilakukan Nginx;
- Java thread tidak lama-lama streaming file;
- filesystem path asli tidak terlihat client.

Ini akan dibahas lagi dalam konteks proxying dan Java backend, tetapi penting dikenali sejak static file serving.

---

## 18. Sendfile, Disk I/O, dan Kernel Path

Nginx dapat menggunakan `sendfile` untuk mengirim file dari disk ke socket dengan lebih efisien.

Config umum:

```nginx
sendfile on;
tcp_nopush on;
tcp_nodelay on;
```

Mental model sederhana:

- tanpa `sendfile`, data file bisa melewati user space lebih banyak;
- dengan `sendfile`, kernel dapat mengoptimalkan transfer dari file descriptor ke socket;
- ini penting untuk static file besar atau traffic asset tinggi.

Namun tuning ini tidak boleh dipahami sebagai magic. Bottleneck bisa tetap ada di:

- disk I/O;
- network bandwidth;
- TLS CPU;
- gzip compression;
- logging overhead;
- file descriptor limit;
- kernel page cache pressure.

### 18.1 Static Serving Cepat Karena Page Cache

Nginx sering sangat cepat melayani static asset bukan hanya karena Nginx-nya, tetapi karena OS menyimpan file yang sering diakses di page cache.

Jika asset populer sudah ada di memory cache kernel, request tidak perlu membaca disk fisik setiap kali.

Konsekuensi:

- benchmark static file kecil sering terlalu optimistis;
- cold cache dan warm cache sangat berbeda;
- deploy baru bisa mengubah cache behavior;
- container memory pressure bisa memengaruhi performance static file.

---

## 19. Access Log untuk Static Assets

Static assets bisa menghasilkan log sangat banyak:

```text
/assets/app.js
/assets/vendor.js
/assets/style.css
/assets/logo.svg
/assets/font.woff2
```

Untuk traffic besar, logging semua static asset dapat:

- membebani disk;
- menaikkan biaya log ingestion;
- menutupi sinyal API di observability;
- membuat incident analysis lebih berisik.

Pola umum:

```nginx
location /assets/ {
    try_files $uri =404;
    access_log off;
    add_header Cache-Control "public, max-age=31536000, immutable" always;
}
```

Namun jangan matikan log sembarangan jika kamu butuh:

- audit download;
- debugging deploy asset;
- traffic analytics;
- security monitoring;
- CDN miss analysis.

Alternatif: pisahkan log static.

```nginx
access_log /var/log/nginx/static_access.log main;
```

---

## 20. Error Pages untuk Static dan Backend Failure

Nginx bisa melayani static error page:

```nginx
error_page 500 502 503 504 /50x.html;

location = /50x.html {
    root /var/www/error-pages;
    internal;
}
```

Manfaat:

- ketika Java backend down, user tetap mendapat halaman error yang rapi;
- error page tidak bergantung pada backend yang sedang bermasalah;
- response failure lebih konsisten.

Namun error page harus aman:

- jangan mengandung stacktrace;
- jangan expose internal hostname;
- jangan menyebut detail database/service;
- jangan terlalu besar;
- jangan depend pada asset eksternal yang mungkin juga gagal.

---

## 21. Common Static File Config Patterns

### 21.1 Static Site Murni

```nginx
server {
    listen 80;
    server_name docs.example.com;

    root /srv/docs/public;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }
}
```

### 21.2 SPA Root Domain + API Backend

```nginx
upstream java_backend {
    server 127.0.0.1:8080;
}

server {
    listen 80;
    server_name app.example.com;

    root /srv/app/dist;
    index index.html;

    location /api/ {
        proxy_pass http://java_backend;
    }

    location /assets/ {
        try_files $uri =404;
        access_log off;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
    }

    location / {
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-cache" always;
    }
}
```

### 21.3 Multiple Static Directories dengan `alias`

```nginx
server {
    listen 80;
    server_name static.example.com;

    location /images/ {
        alias /mnt/media/images/;
        try_files $uri =404;
    }

    location /downloads/ {
        alias /mnt/media/downloads/;
        try_files $uri =404;
        default_type application/octet-stream;
    }
}
```

### 21.4 Maintenance Page

```nginx
server {
    listen 80;
    server_name app.example.com;

    root /srv/maintenance;

    location / {
        try_files /maintenance.html =503;
    }

    error_page 503 /maintenance.html;

    location = /maintenance.html {
        add_header Cache-Control "no-store" always;
    }
}
```

Dalam production, maintenance mode biasanya dikontrol dengan include/symlink/feature di deployment pipeline, bukan edit manual sembarangan.

---

## 22. Anti-Patterns yang Sering Terjadi

### 22.1 `root` Salah Level

```nginx
location /static/ {
    root /var/www/static;
}
```

Request:

```text
/static/app.js
```

Path:

```text
/var/www/static/static/app.js
```

Jika yang kamu maksud adalah:

```text
/var/www/static/app.js
```

pakai:

```nginx
location /static/ {
    alias /var/www/static/;
}
```

### 22.2 SPA Fallback Terlalu Luas

```nginx
location / {
    try_files $uri $uri/ /index.html;
}
```

Tanpa `/api/` dan `/assets/` khusus, terlalu banyak request jatuh ke HTML.

### 22.3 Cache Semua Hal Sama

```nginx
location / {
    add_header Cache-Control "public, max-age=31536000";
}
```

Berbahaya untuk HTML dan route dinamis.

### 22.4 Deploy Repository Root

```nginx
root /home/app/frontend;
```

Risiko: source/config/secret ikut exposed.

### 22.5 Mengandalkan Nginx untuk Authorization File Sensitif

Jika file private ada di public root lalu hanya diblokir beberapa pattern, desainnya sudah rapuh. Lebih baik private files berada di luar public root dan hanya dilayani melalui `internal` location setelah authorization aplikasi.

### 22.6 Tidak Menguji Effective Config

Engineer sering melihat file config yang mereka edit, bukan config efektif yang dijalankan.

Gunakan:

```bash
nginx -T
```

untuk melihat semua include yang aktif.

---

## 23. Debugging Static File Serving

### 23.1 Pertanyaan Pertama

Ketika static file bermasalah, tanyakan berurutan:

1. Server block mana yang menang?
2. Location mana yang menang?
3. Apakah pakai `root` atau `alias`?
4. Path filesystem final apa?
5. Apakah file benar-benar ada?
6. Apakah user Nginx punya permission read?
7. Apakah `try_files` fallback ke tempat yang benar?
8. Apakah MIME type benar?
9. Apakah cache header benar?
10. Apakah response berasal dari Nginx, backend, CDN, atau browser cache?

### 23.2 Command Dasar

Test config:

```bash
nginx -t
```

Dump config efektif:

```bash
nginx -T
```

Cek file:

```bash
ls -lah /var/www/app/dist/assets/app.hash.js
namei -l /var/www/app/dist/assets/app.hash.js
```

Cek response header:

```bash
curl -I http://app.example.com/assets/app.hash.js
```

Cek response body awal:

```bash
curl -s http://app.example.com/assets/app.hash.js | head
```

Jika file JS mengembalikan HTML, kamu akan melihat:

```html
<!doctype html>
<html>
```

Cek route SPA:

```bash
curl -I http://app.example.com/dashboard
```

Cek API tidak tertelan SPA:

```bash
curl -I http://app.example.com/api/health
```

### 23.3 Debug 404

Jika dapat 404:

- salah `server_name`?
- salah location?
- salah `root` vs `alias`?
- file tidak ada?
- permission denied tapi disamarkan?
- `try_files` fallback ke `=404`?
- path case-sensitive di Linux?
- deploy artifact belum lengkap?

### 23.4 Debug 403

403 bisa berarti:

- permission filesystem tidak cukup;
- request ke directory tanpa `index` dan tanpa `autoindex`;
- `deny all` match;
- SELinux/AppArmor membatasi akses;
- user Nginx tidak bisa traverse parent directory.

Cek:

```bash
namei -l /var/www/app/dist/index.html
```

Directory harus executable/traversable oleh user Nginx.

### 23.5 Debug Cache Lama

Jika user masih melihat versi lama:

- cek `Cache-Control` untuk `index.html`;
- cek CDN cache;
- cek service worker;
- cek browser cache;
- cek apakah deploy mengganti symlink dengan benar;
- cek apakah asset filename hashed;
- cek apakah `index.html` lama masih dilayani oleh satu node.

Command:

```bash
curl -I https://app.example.com/
curl -I https://app.example.com/index.html
curl -I https://app.example.com/assets/app.hash.js
```

---

## 24. Production Design Checklist

Sebelum static serving masuk production, pastikan:

### 24.1 Mapping

- [ ] `server_name` benar.
- [ ] `location` paling spesifik ditulis untuk `/api/`, `/assets/`, `/admin/`, `/docs/`.
- [ ] `root` dipakai ketika URI sejajar dengan filesystem.
- [ ] `alias` dipakai ketika prefix URI diganti path lain.
- [ ] trailing slash `alias` konsisten.
- [ ] `try_files` fallback eksplisit.

### 24.2 SPA

- [ ] SPA route fallback ke `index.html`.
- [ ] API route tidak jatuh ke `index.html`.
- [ ] missing JS/CSS asset menghasilkan 404, bukan HTML.
- [ ] frontend base path sesuai Nginx path.

### 24.3 Cache

- [ ] hashed assets cache panjang.
- [ ] `index.html` tidak cache panjang.
- [ ] manifest/service worker punya policy khusus.
- [ ] cache header dicek via `curl -I`.

### 24.4 Security

- [ ] public root hanya berisi artifact public final.
- [ ] dotfiles diblokir.
- [ ] `.git`, `.env`, secret, backup, source tidak ada di public root.
- [ ] private files berada di luar public root.
- [ ] directory listing off kecuali sengaja.

### 24.5 Operability

- [ ] `nginx -t` masuk CI/CD.
- [ ] `nginx -T` bisa diaudit.
- [ ] access log static dikendalikan.
- [ ] error page tersedia.
- [ ] rollback static artifact mudah.
- [ ] deployment atomic, misalnya release directory + symlink.

---

## 25. Latihan Mental Model

### Latihan 1 — Tentukan Path Filesystem

Config:

```nginx
root /var/www/site;

location /static/ {
    root /srv/files;
}
```

Request:

```text
/static/app.js
```

Path yang dicari:

```text
/srv/files/static/app.js
```

Bukan:

```text
/srv/files/app.js
```

### Latihan 2 — Ganti dengan `alias`

Config:

```nginx
location /static/ {
    alias /srv/files/;
}
```

Request:

```text
/static/app.js
```

Path:

```text
/srv/files/app.js
```

### Latihan 3 — Kenapa API Mengembalikan HTML?

Config:

```nginx
root /srv/frontend/dist;

location / {
    try_files $uri $uri/ /index.html;
}
```

Request:

```text
/api/users
```

Jika tidak ada `/srv/frontend/dist/api/users`, fallback ke `/index.html`.

Solusi:

```nginx
location /api/ {
    proxy_pass http://java_backend;
}

location / {
    try_files $uri $uri/ /index.html;
}
```

### Latihan 4 — Kenapa JS MIME Type `text/html`?

Request:

```text
/assets/app.oldhash.js
```

Jika file tidak ada dan location `/` fallback ke `/index.html`, browser menerima HTML.

Solusi:

```nginx
location /assets/ {
    try_files $uri =404;
}
```

---

## 26. Cara Berpikir Top 1% untuk Static Serving

Engineer biasa bertanya:

> Config apa untuk serve React/Vue app?

Engineer kuat bertanya:

> Traffic class apa saja yang masuk domain ini? Mana file fisik, mana route frontend, mana API, mana private download, mana asset hashed, mana HTML entry point, mana endpoint internal, dan apa fallback yang benar untuk masing-masing class?

Engineer biasa membuat satu `location /` besar.

Engineer kuat memisahkan traffic berdasarkan invariants:

```text
/api/       -> never static, always backend
/assets/    -> must be real file, missing means 404, cache long
/index.html -> entry point, revalidate
/           -> SPA fallback only after asset/API excluded
/downloads/ -> explicit file policy
/private/   -> never public, internal only
```

Engineer biasa melihat 404 sebagai “file tidak ada”.

Engineer kuat melihat 404 sebagai hasil dari pipeline:

```text
server selection -> location selection -> path mapping -> permission -> try_files -> fallback -> response
```

Engineer biasa menambahkan directive sampai jalan.

Engineer kuat menjaga konfigurasi sebagai kontrak:

- public URI contract;
- filesystem layout contract;
- cache contract;
- security exposure contract;
- deployment artifact contract;
- backend routing contract.

---

## 27. Referensi Resmi dan Bacaan Lanjutan

Gunakan dokumentasi resmi sebagai sumber utama untuk syntax dan behavior:

- NGINX Admin Guide — Serving Static Content: `https://docs.nginx.com/nginx/admin-guide/web-server/serving-static-content/`
- NGINX Core Module Reference: `https://nginx.org/en/docs/http/ngx_http_core_module.html`
- NGINX Beginner's Guide: `https://nginx.org/en/docs/beginners_guide.html`
- NGINX `ngx_http_headers_module`: `https://nginx.org/en/docs/http/ngx_http_headers_module.html`
- NGINX `ngx_http_index_module`: `https://nginx.org/en/docs/http/ngx_http_index_module.html`

---

## 28. Ringkasan

Static file serving di Nginx bukan sekadar “ambil file dari folder”. Ia adalah routing dan filesystem mapping layer yang harus dipahami dengan deterministik.

Hal paling penting dari part ini:

1. `root` berarti `root + full URI`.
2. `alias` berarti `alias + URI setelah location prefix`.
3. `index` hanya menangani directory index, bukan SPA fallback umum.
4. `try_files` adalah existence check plus fallback/internal redirect.
5. SPA butuh fallback ke `index.html`, tetapi API dan missing asset harus dikecualikan.
6. Hashed assets boleh cache panjang; `index.html` biasanya tidak.
7. Public root harus minimal dan tidak boleh berisi source/secrets.
8. Debugging harus dimulai dari server selection, location selection, path mapping, lalu fallback.
9. Konfigurasi static file yang baik memisahkan traffic classes secara eksplisit.

Part berikutnya akan masuk ke salah satu peran Nginx paling umum di sistem Java modern: **reverse proxy ke backend Java**.

---

## 29. Preview Part 007

Di `Part 007 — Reverse Proxy Fundamentals for Java Backends`, kita akan membahas:

- `proxy_pass` secara detail;
- trailing slash behavior;
- URI rewriting;
- proxy headers;
- preserve Host vs upstream Host;
- upstream Java service;
- Spring Boot/Tomcat behavior behind proxy;
- redirect URL salah;
- scheme salah antara HTTP/HTTPS;
- client IP propagation;
- awal dari proxy boundary contract.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-nginx-mastery-for-java-engineers-part-005.md">⬅️ Part 005 — Location Matching Deep Dive</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-nginx-mastery-for-java-engineers-part-007.md">Part 007 — Reverse Proxy Fundamentals for Java Backends ➡️</a>
</div>
