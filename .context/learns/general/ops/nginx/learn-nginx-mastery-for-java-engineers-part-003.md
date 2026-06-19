# learn-nginx-mastery-for-java-engineers-part-003.md

# Part 003 — Configuration Grammar: Directives, Contexts, Inheritance, and Evaluation Order

## Status Seri

- Seri: `learn-nginx-mastery-for-java-engineers`
- Part: `003` dari `030`
- Status seri: **belum selesai**
- Part sebelumnya: `Part 002 — Installation, Packaging, Runtime Layout, and Environment Discipline`
- Part berikutnya: `Part 004 — Server Selection: listen, server_name, SNI, Default Server`

---

## 1. Tujuan Pembelajaran

Di bagian ini kita membangun kemampuan membaca dan menulis konfigurasi Nginx seperti membaca kode production.

Banyak engineer belajar Nginx dengan cara copy-paste konfigurasi:

```nginx
location /api/ {
    proxy_pass http://backend;
}
```

Lalu konfigurasi itu bertambah:

```nginx
include snippets/proxy.conf;
include snippets/security.conf;
include conf.d/*.conf;
```

Setelah beberapa bulan, muncul masalah:

- request masuk ke `server` block yang salah,
- `location` tidak terpilih seperti yang dikira,
- header security tidak muncul di error response,
- `proxy_set_header` tiba-tiba hilang,
- `root` berubah karena inheritance,
- `add_header` override parent config,
- `try_files` menyebabkan internal redirect yang tidak terlihat,
- config reload sukses tetapi behavior berubah di production,
- satu include file mengubah arti include file lain.

Part ini bertujuan membuat kamu memahami:

1. bagaimana grammar konfigurasi Nginx bekerja,
2. apa itu directive dan context,
3. bagaimana inheritance bekerja dan kapan tidak bekerja,
4. bagaimana include diekspansi,
5. kapan variable dievaluasi,
6. bagaimana membaca effective config,
7. bagaimana menghindari config spaghetti,
8. bagaimana mendesain struktur konfigurasi yang aman untuk sistem besar.

Setelah part ini, kamu seharusnya bisa melihat konfigurasi Nginx dan menjawab:

- directive ini valid di context mana?
- nilai ini diwariskan dari parent atau override lokal?
- include ini masuk ke context apa?
- apakah directive ini dievaluasi saat startup, saat request, atau saat phase tertentu?
- apakah perubahan ini aman untuk multi-domain dan multi-service?
- apakah konfigurasi ini mudah diuji dan di-review?

---

## 2. Mental Model Utama

Konfigurasi Nginx bukan sekadar file teks.

Konfigurasi Nginx adalah **declarative program** yang dibaca saat startup/reload, diparse menjadi struktur runtime, lalu digunakan worker process untuk mengambil keputusan pada setiap connection/request.

Mental model yang paling berguna:

> Nginx config is a hierarchical decision program compiled at reload time and partially evaluated again at request time.

Artinya:

- ada bagian konfigurasi yang diproses saat Nginx start/reload,
- ada bagian yang hanya menjadi rule runtime,
- ada variable yang nilainya baru diketahui saat request datang,
- ada directive yang behavior-nya dipengaruhi oleh context parent,
- ada directive yang tidak benar-benar “merge” tapi “replace”,
- ada directive yang tampaknya global tetapi hanya berlaku di context tertentu,
- ada include yang secara tekstual disisipkan ke lokasi include tersebut.

Sebagai Java engineer, analoginya bukan seperti membaca file `.properties` biasa.

Lebih dekat ke kombinasi:

- AST konfigurasi,
- nested scope,
- inheritance,
- routing table,
- request pipeline,
- runtime variable binding,
- static validation at reload time.

---

## 3. Struktur Konfigurasi Nginx Secara Umum

Konfigurasi Nginx biasanya dimulai dari file utama:

```nginx
/etc/nginx/nginx.conf
```

Contoh minimal:

```nginx
user nginx;
worker_processes auto;

error_log /var/log/nginx/error.log warn;
pid /run/nginx.pid;

events {
    worker_connections 1024;
}

http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;

    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent" "$http_x_forwarded_for"';

    access_log /var/log/nginx/access.log main;

    sendfile on;
    keepalive_timeout 65;

    include /etc/nginx/conf.d/*.conf;
}
```

Dari struktur ini terlihat beberapa hal penting:

- `user`, `worker_processes`, `error_log`, `pid` berada di main context.
- `events { ... }` adalah block context untuk event processing.
- `http { ... }` adalah block context untuk HTTP server/proxy behavior.
- `include /etc/nginx/conf.d/*.conf;` tidak berdiri sendiri secara global, tetapi masuk ke dalam context `http`.

Ini sangat penting.

File yang di-include dari dalam `http {}` secara efektif menjadi bagian dari `http {}`.

Jika file `/etc/nginx/conf.d/app.conf` berisi:

```nginx
server {
    listen 80;
    server_name example.com;

    location / {
        proxy_pass http://127.0.0.1:8080;
    }
}
```

maka secara effective config ia menjadi:

```nginx
http {
    server {
        listen 80;
        server_name example.com;

        location / {
            proxy_pass http://127.0.0.1:8080;
        }
    }
}
```

Bukan file `app.conf` yang menentukan context; lokasi `include` yang menentukan context.

---

## 4. Directive: Unit Dasar Konfigurasi Nginx

Nginx config dibangun dari directive.

Ada dua bentuk utama:

1. simple directive,
2. block directive.

### 4.1 Simple Directive

Simple directive memiliki format:

```nginx
name parameter1 parameter2 ...;
```

Contoh:

```nginx
worker_processes auto;
keepalive_timeout 65;
proxy_read_timeout 30s;
client_max_body_size 20m;
```

Ciri penting:

- diakhiri semicolon `;`,
- punya nama directive,
- punya nol atau lebih parameter,
- validitasnya tergantung context.

Contoh salah:

```nginx
worker_processes auto
```

Tanpa semicolon, config invalid.

Contoh lain:

```nginx
proxy_pass http://backend
```

Juga invalid karena tidak ada semicolon.

Nginx sangat ketat pada syntax dasar.

### 4.2 Block Directive

Block directive memiliki format:

```nginx
name parameter1 parameter2 ... {
    ... nested directives ...
}
```

Contoh:

```nginx
http {
    server {
        listen 80;

        location / {
            return 200 "hello\n";
        }
    }
}
```

Block directive membuka context baru.

Contoh block directive penting:

- `events {}`
- `http {}`
- `server {}`
- `location {}`
- `upstream {}`
- `stream {}`
- `mail {}`
- `types {}`
- `map {}`
- `geo {}`

Tidak semua block bisa muncul di semua tempat.

Misalnya:

```nginx
http {
    location / {
        return 200;
    }
}
```

Ini invalid karena `location` tidak boleh langsung berada di `http`; `location` harus berada di dalam `server` atau nested location tertentu.

---

## 5. Context: Scope dan Level Keputusan

Context adalah ruang tempat directive valid dan bermakna.

Context utama:

```text
main
├── events
├── http
│   ├── upstream
│   ├── map
│   ├── geo
│   └── server
│       └── location
│           └── nested location tertentu
├── stream
│   ├── upstream
│   └── server
└── mail
```

Untuk seri ini, fokus utama kita:

- main,
- events,
- http,
- server,
- location,
- upstream,
- stream.

### 5.1 Main Context

Main context adalah top-level file `nginx.conf`, di luar block apapun.

Contoh:

```nginx
user nginx;
worker_processes auto;
error_log /var/log/nginx/error.log warn;
pid /run/nginx.pid;
include /etc/nginx/modules-enabled/*.conf;
```

Biasanya digunakan untuk:

- process ownership,
- worker process count,
- global error log,
- pid file,
- loading module,
- high-level process behavior.

Contoh directive yang lazim di main context:

```nginx
user nginx;
worker_processes auto;
worker_rlimit_nofile 65535;
daemon on;
master_process on;
error_log /var/log/nginx/error.log warn;
```

Sebagai Java engineer, main context mirip konfigurasi runtime process, bukan routing aplikasi.

Jika salah di main context, Nginx bisa gagal start atau kapasitas globalnya buruk.

### 5.2 Events Context

`events` context mengatur event processing dan connection handling.

Contoh:

```nginx
events {
    worker_connections 4096;
    multi_accept on;
}
```

Biasanya hanya ada satu `events` block.

Fokusnya:

- jumlah connection per worker,
- event model,
- accept behavior.

Kesalahan di sini berdampak ke kapasitas connection global.

Contoh kapasitas kasar:

```text
max theoretical connections ≈ worker_processes × worker_connections
```

Tapi nilai nyata dibatasi oleh:

- file descriptor limit,
- memory,
- upstream connection,
- OS networking limit,
- workload pattern.

### 5.3 HTTP Context

`http` context adalah root untuk semua HTTP behavior.

Contoh:

```nginx
http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    sendfile on;
    keepalive_timeout 65;

    include /etc/nginx/conf.d/*.conf;
}
```

Biasanya berisi:

- MIME type,
- logging format,
- gzip,
- proxy defaults,
- upstream definitions,
- server blocks,
- cache zones,
- maps,
- global HTTP settings.

Directive di `http` bisa menjadi default untuk semua `server` dan `location`, tergantung directive-nya.

Contoh:

```nginx
http {
    proxy_connect_timeout 3s;
    proxy_read_timeout 30s;

    server {
        listen 80;

        location /api/ {
            proxy_pass http://backend;
        }
    }
}
```

Dalam banyak kasus, `location /api/` akan memakai timeout yang didefinisikan di `http` jika tidak dioverride di `server` atau `location`.

Tapi jangan menganggap semua directive merge dengan cara yang sama.

Ini salah satu sumber bug paling umum.

### 5.4 Server Context

`server` context merepresentasikan virtual server.

Contoh:

```nginx
server {
    listen 80;
    server_name api.example.com;

    access_log /var/log/nginx/api.access.log main;

    location / {
        proxy_pass http://api_backend;
    }
}
```

`server` adalah level keputusan untuk:

- IP/port,
- hostname,
- TLS certificate,
- default behavior domain,
- access log domain,
- route set per domain.

Nginx memilih `server` block sebelum memilih `location`.

Urutan konseptual:

```text
connection arrives
→ match listen socket
→ match SNI/Host/server_name
→ select server block
→ match location
→ execute selected location behavior
```

Detail server selection akan dibahas di Part 004.

### 5.5 Location Context

`location` context merepresentasikan routing rule di dalam `server`.

Contoh:

```nginx
server {
    listen 80;
    server_name example.com;

    location /static/ {
        root /var/www/app;
    }

    location /api/ {
        proxy_pass http://backend;
    }

    location / {
        try_files $uri /index.html;
    }
}
```

`location` adalah level paling sering disentuh engineer karena di sinilah request diarahkan ke:

- static files,
- backend service,
- error response,
- redirect,
- internal route,
- auth subrequest,
- cache rule.

Tapi `location` matching punya aturan khusus.

Contoh ini tidak selalu bekerja seperti yang dikira:

```nginx
location /api/ {
    proxy_pass http://backend;
}

location ~ \.php$ {
    return 403;
}
```

Jika request `/api/test.php`, regex location bisa ikut berperan tergantung modifier dan matching order.

Detailnya akan dibahas di Part 005.

### 5.6 Upstream Context

`upstream` context mendefinisikan group backend server.

Contoh:

```nginx
upstream api_backend {
    server 10.0.1.10:8080;
    server 10.0.1.11:8080;
    keepalive 64;
}

server {
    listen 80;

    location /api/ {
        proxy_pass http://api_backend;
    }
}
```

`upstream` berada di dalam `http` context.

Fungsinya:

- load balancing,
- upstream connection pooling,
- failover,
- backend grouping,
- logical naming.

Sebagai Java engineer, upstream block adalah boundary antara Nginx dan application runtime.

### 5.7 Stream Context

`stream` context digunakan untuk TCP/UDP proxying, bukan HTTP.

Contoh:

```nginx
stream {
    upstream postgres_backend {
        server 10.0.2.10:5432;
    }

    server {
        listen 5432;
        proxy_pass postgres_backend;
    }
}
```

`stream` sejajar dengan `http`, bukan berada di dalam `http`.

Salah:

```nginx
http {
    stream {
        server {
            listen 5432;
        }
    }
}
```

Benar:

```nginx
http {
    # HTTP config
}

stream {
    # TCP/UDP config
}
```

`stream` akan dibahas detail di Part 026.

---

## 6. Context Validity: Kenapa Directive Bisa Valid di Satu Tempat dan Invalid di Tempat Lain

Setiap directive punya daftar context yang valid.

Contoh konseptual:

| Directive | Context umum |
|---|---|
| `worker_processes` | main |
| `worker_connections` | events |
| `server` | http, stream |
| `location` | server, location tertentu |
| `proxy_pass` | location, if in location, limit_except |
| `upstream` | http, stream |
| `listen` | server |
| `server_name` | server HTTP |
| `root` | http, server, location, if in location |
| `access_log` | http, server, location, if in location, limit_except |

Contoh invalid:

```nginx
http {
    worker_processes auto;
}
```

`worker_processes` hanya valid di main context.

Contoh invalid:

```nginx
server {
    worker_connections 1024;
}
```

`worker_connections` hanya valid di `events`.

Contoh invalid:

```nginx
main {
    server {
        listen 80;
    }
}
```

Tidak ada block `main {}`. Main context adalah top-level file, bukan block eksplisit.

### Cara Berpikir

Jangan menghafal semua directive.

Gunakan pola ini:

1. directive ini mengatur proses global?
   - kemungkinan main.
2. directive ini mengatur event/connection worker?
   - kemungkinan events.
3. directive ini mengatur HTTP secara umum?
   - kemungkinan http.
4. directive ini mengatur domain/virtual host?
   - kemungkinan server.
5. directive ini mengatur route/path tertentu?
   - kemungkinan location.
6. directive ini mengatur backend pool?
   - kemungkinan upstream.
7. directive ini mengatur TCP/UDP non-HTTP?
   - kemungkinan stream.

Tetap validasi dengan dokumentasi atau `nginx -t`.

---

## 7. Include: Textual Composition yang Sering Disalahpahami

Directive `include` menyisipkan file lain ke lokasi tempat `include` dipanggil.

Contoh:

```nginx
http {
    include /etc/nginx/conf.d/*.conf;
}
```

Jika file `conf.d/a.conf` berisi:

```nginx
server {
    listen 80;
    server_name a.example.com;
}
```

maka hasil konseptual:

```nginx
http {
    server {
        listen 80;
        server_name a.example.com;
    }
}
```

### 7.1 Include Tidak Membuat Scope Baru

Ini penting.

File include tidak otomatis membuat namespace baru.

Misal:

```nginx
# nginx.conf
http {
    server {
        listen 80;
        include /etc/nginx/snippets/common-locations.conf;
    }
}
```

Dan file:

```nginx
# snippets/common-locations.conf
location /health {
    return 200 "ok\n";
}
```

Secara effective:

```nginx
http {
    server {
        listen 80;

        location /health {
            return 200 "ok\n";
        }
    }
}
```

Karena include berada dalam `server`, file itu boleh berisi `location`.

Tapi jika file yang sama di-include di `http`:

```nginx
http {
    include /etc/nginx/snippets/common-locations.conf;
}
```

maka invalid karena `location` tidak valid langsung di `http`.

### 7.2 Include Order Matters

Contoh:

```nginx
http {
    include conf.d/*.conf;
}
```

Glob expansion biasanya mengikuti urutan lexical filesystem/glob, tapi jangan membangun safety berdasarkan asumsi yang sulit terlihat.

Misal ada:

```text
00-global.conf
10-upstreams.conf
20-apps.conf
99-default.conf
```

Ini lebih jelas dibanding:

```text
app.conf
upstream.conf
default.conf
misc.conf
```

Urutan include bisa penting untuk:

- `map` yang harus didefinisikan sebelum digunakan secara konseptual,
- readability,
- default server placement,
- overriding variable conventions,
- include snippet yang diasumsikan berada dalam context tertentu.

Nginx biasanya tidak peduli urutan untuk beberapa definisi karena parse seluruh config, tetapi manusia peduli.

Production config harus dioptimalkan untuk reviewability.

### 7.3 Include Pattern yang Sehat

Contoh struktur yang masuk akal:

```text
/etc/nginx/
├── nginx.conf
├── mime.types
├── conf.d/
│   ├── 00-log-format.conf
│   ├── 10-maps.conf
│   ├── 20-upstreams.conf
│   ├── 30-default-server.conf
│   ├── 40-api.example.com.conf
│   └── 50-web.example.com.conf
└── snippets/
    ├── proxy-common.conf
    ├── security-headers.conf
    ├── gzip.conf
    └── tls-modern.conf
```

Dengan `nginx.conf`:

```nginx
http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    include /etc/nginx/conf.d/00-log-format.conf;
    include /etc/nginx/conf.d/10-maps.conf;
    include /etc/nginx/conf.d/20-upstreams.conf;
    include /etc/nginx/conf.d/30-default-server.conf;
    include /etc/nginx/conf.d/40-*.conf;
    include /etc/nginx/conf.d/50-*.conf;
}
```

Atau lebih sederhana:

```nginx
http {
    include /etc/nginx/conf.d/*.conf;
}
```

Dengan disiplin naming.

### 7.4 Include Anti-Pattern

#### Anti-pattern 1: snippet tanpa context contract

```text
snippets/common.conf
```

Tidak jelas apakah file ini harus di-include di `http`, `server`, atau `location`.

Lebih baik:

```text
snippets/http/gzip.conf
snippets/server/tls.conf
snippets/location/proxy-common.conf
```

Atau beri komentar di atas file:

```nginx
# Context contract: include only inside location {}
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
```

#### Anti-pattern 2: include nested terlalu dalam

```nginx
include a.conf;
```

`a.conf`:

```nginx
include b.conf;
```

`b.conf`:

```nginx
include c.conf;
```

`c.conf`:

```nginx
proxy_set_header Host $host;
```

Masalah:

- sulit dicari,
- sulit direview,
- sulit tahu effective context,
- rawan circular mental model walau bukan circular include.

#### Anti-pattern 3: include yang berisi block besar tersembunyi

```nginx
server {
    listen 443 ssl;
    server_name api.example.com;

    include snippets/magic.conf;
}
```

Jika `magic.conf` berisi 500 baris `location`, `rewrite`, `if`, `proxy_pass`, config menjadi sulit diaudit.

Nama snippet harus menjelaskan isi dan context.

---

## 8. Inheritance: Tidak Semua Directive Diwariskan dengan Cara Sama

Ini bagian sangat penting.

Banyak engineer berpikir:

> Kalau directive didefinisikan di `http`, berarti semua `server` dan `location` otomatis dapat, lalu kalau di bawah ditambahkan berarti merge.

Kadang benar.

Kadang salah.

Nginx module memiliki aturan merge sendiri. Directive yang berbeda bisa punya behavior inheritance berbeda.

Secara praktis, ada beberapa pola:

1. inherited if not overridden,
2. replaced by lower context,
3. additive/merged,
4. not inherited,
5. context-specific only.

### 8.1 Pattern 1: Inherited If Not Overridden

Contoh konseptual:

```nginx
http {
    proxy_read_timeout 30s;

    server {
        listen 80;

        location /api/ {
            proxy_pass http://backend;
        }
    }
}
```

`location /api/` memakai `proxy_read_timeout 30s` jika tidak override.

Override:

```nginx
http {
    proxy_read_timeout 30s;

    server {
        listen 80;

        location /api/slow/ {
            proxy_read_timeout 120s;
            proxy_pass http://backend;
        }
    }
}
```

Untuk `/api/slow/`, timeout menjadi `120s`.

### 8.2 Pattern 2: Replace, Not Merge

Beberapa directive terlihat seperti bisa ditambahkan, tetapi lower context mengganti parent list.

Contoh paling sering bikin bug: `add_header`.

Misal:

```nginx
http {
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;

    server {
        listen 80;

        location /api/ {
            add_header Cache-Control "no-store" always;
            proxy_pass http://backend;
        }
    }
}
```

Banyak orang mengira `/api/` akan punya tiga header:

```text
X-Frame-Options
X-Content-Type-Options
Cache-Control
```

Tetapi dalam praktik Nginx, jika `add_header` didefinisikan di lower context, header dari parent tidak otomatis ikut dengan cara yang sering diasumsikan. Lower-level `add_header` dapat menyebabkan parent `add_header` tidak diterapkan di context tersebut.

Konfigurasi yang lebih aman:

```nginx
# snippets/security-headers.conf
add_header X-Frame-Options "DENY" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
```

Lalu:

```nginx
server {
    listen 80;

    include snippets/security-headers.conf;

    location /api/ {
        include snippets/security-headers.conf;
        add_header Cache-Control "no-store" always;
        proxy_pass http://backend;
    }
}
```

Atau desain agar `add_header` tidak tersebar di banyak level.

Pelajaran:

> Jangan menganggap directive list selalu merge. Untuk directive list, verify behavior.

### 8.3 Pattern 3: Additive/Merged

Beberapa directive memang bisa bersifat additive atau membangun collection.

Contoh:

```nginx
server {
    listen 80;
    listen 443 ssl;
}
```

Dua `listen` bukan override; server block mendengarkan dua socket.

Contoh lain:

```nginx
upstream backend {
    server 10.0.0.1:8080;
    server 10.0.0.2:8080;
}
```

Multiple `server` directive dalam upstream membangun backend pool.

Tapi jangan generalisasi. Directive bernama sama bisa punya semantics berbeda tergantung module/context.

### 8.4 Pattern 4: Not Inherited

Beberapa directive hanya berlaku di context tempat ia didefinisikan.

Misalnya `listen` hanya bermakna di `server`.

Tidak ada konsep:

```nginx
http {
    listen 80;
}
```

Atau:

```nginx
http {
    server_name example.com;
}
```

`server_name` hanya valid di `server` HTTP.

### 8.5 Pattern 5: Context-Specific Runtime Meaning

Beberapa directive valid di beberapa context, tapi efeknya berbeda karena runtime stage berbeda.

Contoh:

```nginx
root /var/www/global;

http {
    root /var/www/http;

    server {
        root /var/www/server;

        location /static/ {
            root /var/www/location;
        }
    }
}
```

`root` yang dipakai bergantung pada selected location/server dan inheritance.

Request `/static/app.js` akan dipengaruhi oleh `root` di `location /static/`, bukan parent.

---

## 9. Effective Config: Yang Dijalankan Bukan File yang Kamu Lihat Satu Per Satu

Dalam production, Nginx tidak “menjalankan file app.conf” secara terpisah.

Nginx membaca root config, mengekspansi include, memvalidasi grammar/context, lalu membangun effective configuration.

Tool penting:

```bash
nginx -t
```

Untuk test syntax.

```bash
nginx -T
```

Untuk dump full effective config, termasuk included files.

### 9.1 `nginx -t`

Contoh:

```bash
sudo nginx -t
```

Output sukses:

```text
nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
nginx: configuration file /etc/nginx/nginx.conf test is successful
```

Jika gagal:

```text
nginx: [emerg] "location" directive is not allowed here in /etc/nginx/snippets/routes.conf:1
nginx: configuration file /etc/nginx/nginx.conf test failed
```

Pesan ini memberi tahu:

- directive apa yang salah,
- file mana,
- line mana,
- context error.

### 9.2 `nginx -T`

```bash
sudo nginx -T
```

Ini sangat penting untuk debugging include.

Gunakan untuk menjawab:

- apakah snippet benar-benar ke-include?
- apakah file config duplikat?
- apakah server block muncul dua kali?
- apakah directive berada di context yang dikira?
- apakah deployment template menghasilkan output yang benar?

Dalam CI/CD, pattern yang sehat:

```bash
nginx -t -c /path/to/generated/nginx.conf
```

Untuk container:

```bash
docker run --rm \
  -v "$PWD/nginx.conf:/etc/nginx/nginx.conf:ro" \
  -v "$PWD/conf.d:/etc/nginx/conf.d:ro" \
  nginx:stable \
  nginx -t
```

---

## 10. Evaluation Order: Parse Time vs Request Time

Tidak semua hal di konfigurasi Nginx dievaluasi pada waktu yang sama.

Ada tiga lapisan mental model:

1. parse/reload time,
2. connection/server selection time,
3. request processing time.

### 10.1 Parse/Reload Time

Saat `nginx -t`, startup, atau reload:

- syntax dicek,
- context dicek,
- modules loaded,
- upstream block dikenali,
- maps didefinisikan,
- server blocks dibangun,
- location trees disusun,
- sebagian value literal divalidasi.

Contoh error parse time:

```nginx
server {
    listen eighty;
}
```

Nginx gagal karena `listen` invalid.

Contoh lain:

```nginx
location / {
    proxy_pass;
}
```

Invalid karena parameter kurang.

### 10.2 Connection/Server Selection Time

Saat client membuka connection:

- socket `listen` dipilih,
- untuk TLS, SNI bisa dipakai memilih server/cert,
- untuk HTTP request, Host header dipakai memilih server block,
- default server dipakai jika tidak ada match.

Ini bukan sekadar parse time karena request aktual menentukan server.

### 10.3 Request Processing Time

Saat request diproses:

- URI dipakai memilih location,
- variables seperti `$uri`, `$host`, `$remote_addr`, `$request_method` punya nilai,
- `map` variable dapat dievaluasi lazily,
- rewrite dapat mengubah URI,
- internal redirect dapat memilih location baru,
- upstream dipilih,
- headers dibentuk,
- logging variables dihitung.

Contoh variable:

```nginx
log_format main '$remote_addr $host "$request" $status $request_time';
```

Nilai `$remote_addr`, `$host`, `$request`, `$status`, `$request_time` baru bermakna per request.

---

## 11. Variable Nginx: Runtime Binding, Bukan Macro Biasa

Nginx punya variables seperti:

```nginx
$host
$http_host
$request_uri
$uri
$args
$arg_name
$remote_addr
$proxy_add_x_forwarded_for
$upstream_addr
$upstream_response_time
```

Variable bukan string interpolation sederhana seperti template engine.

Banyak variable dievaluasi saat request processing.

### 11.1 `$host` vs `$http_host`

Contoh:

```nginx
proxy_set_header Host $host;
```

`$host` adalah normalized host yang bisa berasal dari request line atau Host header, dan bisa fallback ke server name.

```nginx
proxy_set_header Host $http_host;
```

`$http_host` langsung mengambil nilai raw `Host` header.

Dalam banyak reverse proxy config, `$host` lebih aman/terkontrol daripada raw `$http_host`, tapi pilihan tergantung contract.

Untuk Java backend, ini penting karena Host dipakai untuk:

- absolute URL generation,
- redirect,
- tenant resolution,
- link generation,
- security validation.

### 11.2 `$uri` vs `$request_uri`

Contoh request:

```text
GET /api/users/../users?id=10 HTTP/1.1
```

Secara konseptual:

- `$request_uri` adalah original URI dengan query string,
- `$uri` adalah normalized URI yang dipakai Nginx untuk processing.

Perbedaan ini penting untuk:

- proxy_pass behavior,
- cache key,
- logging,
- security,
- rewrite.

Jangan sembarang mengganti `$request_uri` dengan `$uri` tanpa memahami efeknya.

### 11.3 Variable dalam `proxy_pass`

Ada perbedaan penting antara:

```nginx
proxy_pass http://backend;
```

Dan:

```nginx
proxy_pass http://$backend_host;
```

Jika `proxy_pass` memakai variable, behavior DNS resolution, URI handling, dan runtime evaluation bisa berbeda.

Variable dalam `proxy_pass` bisa membuat config lebih dinamis, tetapi juga:

- lebih sulit dianalisis statis,
- bisa memerlukan resolver,
- bisa mengubah URI rewrite semantics,
- bisa membuat error baru muncul hanya pada runtime.

Gunakan dynamic proxy target hanya jika benar-benar dibutuhkan.

---

## 12. Phase Model: Kenapa Directive Tidak Sekadar Dieksekusi dari Atas ke Bawah

Nginx request processing tidak sama dengan script imperative.

Konfigurasi ini:

```nginx
location / {
    add_header X-A one;
    proxy_pass http://backend;
    add_header X-B two;
}
```

Bukan berarti Nginx menjalankan baris pertama, lalu proxy, lalu baris ketiga seperti script shell.

Directive mendaftarkan behavior pada phase tertentu.

Secara sederhana, HTTP request bisa melewati phase seperti:

1. post-read,
2. server rewrite,
3. find config/location,
4. rewrite,
5. preaccess,
6. access,
7. content,
8. log.

Kamu tidak harus menghafal semua phase sekarang, tetapi harus memahami konsekuensinya:

> Urutan baris dalam block tidak selalu sama dengan urutan runtime execution.

Contoh directive:

- `rewrite` memengaruhi URI selection,
- `access_log` berlaku di log phase,
- `proxy_pass` menyediakan content handler,
- `add_header` bekerja saat response header filter,
- `auth_request` bekerja di access phase,
- `try_files` dapat melakukan internal redirect.

Karena itu, membaca Nginx config harus berbasis:

1. context,
2. matching rule,
3. directive semantics,
4. phase effect,
5. inheritance.

Bukan hanya top-to-bottom.

---

## 13. `if` di Nginx: Bukan If Statement Umum

Nginx punya directive `if`, tetapi ini bukan general-purpose control flow seperti Java.

Contoh:

```nginx
location / {
    if ($request_method = POST) {
        return 405;
    }
}
```

Beberapa penggunaan `if` relatif aman, terutama dengan `return` atau `rewrite` sederhana.

Namun banyak penggunaan `if` dalam `location` berisiko karena `if` berada dalam rewrite module semantics, bukan block imperative biasa.

Anti-pattern:

```nginx
location /api/ {
    if ($http_authorization = "") {
        proxy_pass http://authless_backend;
    }

    proxy_pass http://normal_backend;
}
```

Ini bukan cara aman untuk conditional proxy flow.

Lebih baik gunakan `map`, `try_files`, separate locations, atau dedicated gateway/app logic.

### 13.1 Gunakan `map` untuk Conditional Value

Contoh:

```nginx
http {
    map $http_upgrade $connection_upgrade {
        default upgrade;
        ''      close;
    }

    server {
        listen 80;

        location /ws/ {
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection $connection_upgrade;
            proxy_pass http://websocket_backend;
        }
    }
}
```

`map` membuat variable berdasarkan input variable.

Ini lebih deklaratif dan lebih aman daripada banyak `if` nested.

### 13.2 `map` Dievaluasi Lazy

`map` didefinisikan di `http` context:

```nginx
map $request_method $is_write_method {
    default 0;
    POST    1;
    PUT     1;
    PATCH   1;
    DELETE  1;
}
```

Lalu dipakai di server/location:

```nginx
add_header X-Is-Write $is_write_method always;
```

Nilainya baru dihitung ketika variable digunakan untuk request tertentu.

---

## 14. Directive Precedence: Parent, Child, and Local Override

Mari lihat contoh lebih realistis.

```nginx
http {
    proxy_connect_timeout 2s;
    proxy_read_timeout 30s;
    proxy_send_timeout 30s;

    server {
        listen 80;
        server_name api.example.com;

        proxy_read_timeout 10s;

        location /fast/ {
            proxy_pass http://fast_backend;
        }

        location /slow/ {
            proxy_read_timeout 120s;
            proxy_pass http://slow_backend;
        }
    }
}
```

Effective conceptual values:

| Route | connect timeout | read timeout | send timeout |
|---|---:|---:|---:|
| `/fast/` | 2s | 10s | 30s |
| `/slow/` | 2s | 120s | 30s |

Karena:

- `proxy_connect_timeout` diwarisi dari `http`,
- `proxy_send_timeout` diwarisi dari `http`,
- `proxy_read_timeout` di `server` override `http`,
- `proxy_read_timeout` di `/slow/` override `server`.

Namun jangan menerapkan pola ini buta ke semua directive.

Untuk setiap directive penting, cek semantics-nya.

---

## 15. Example: Config yang Tampak Benar tapi Bermasalah

### 15.1 Kasus: Security Header Hilang di `/api/`

Konfigurasi:

```nginx
http {
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;

    server {
        listen 443 ssl;
        server_name api.example.com;

        location /api/ {
            add_header Cache-Control "no-store" always;
            proxy_pass http://api_backend;
        }
    }
}
```

Ekspektasi engineer:

```text
/api/ response punya:
- X-Frame-Options
- X-Content-Type-Options
- Cache-Control
```

Realita yang sering terjadi:

```text
/api/ hanya punya Cache-Control
```

Karena `add_header` di lower context dapat mengganti inherited header set.

Perbaikan:

```nginx
# snippets/security-headers.conf
add_header X-Frame-Options "DENY" always;
add_header X-Content-Type-Options "nosniff" always;
```

```nginx
server {
    listen 443 ssl;
    server_name api.example.com;

    include snippets/security-headers.conf;

    location /api/ {
        include snippets/security-headers.conf;
        add_header Cache-Control "no-store" always;
        proxy_pass http://api_backend;
    }
}
```

Atau gunakan desain berbeda: semua security headers didefinisikan pada level location melalui snippet yang eksplisit.

### 15.2 Kasus: `location` Snippet Di-include di Context Salah

File:

```nginx
# snippets/health.conf
location /health {
    return 200 "ok\n";
}
```

Penggunaan benar:

```nginx
server {
    listen 80;
    include snippets/health.conf;
}
```

Penggunaan salah:

```nginx
http {
    include snippets/health.conf;
}
```

Error:

```text
"location" directive is not allowed here
```

Solusi desain:

```text
snippets/server/health-location.conf
```

Dengan komentar:

```nginx
# Context contract: server {}
location /health {
    return 200 "ok\n";
}
```

### 15.3 Kasus: `root` dan `alias` Membingungkan

Konfigurasi:

```nginx
server {
    listen 80;
    root /var/www/app;

    location /assets/ {
        alias /mnt/assets/;
    }

    location / {
        try_files $uri /index.html;
    }
}
```

Request:

```text
/assets/logo.png
```

Dengan `alias /mnt/assets/`, file yang dicari:

```text
/mnt/assets/logo.png
```

Bukan:

```text
/var/www/app/assets/logo.png
```

`alias` mengganti path mapping untuk location tersebut.

Ini bukan sekadar override root biasa.

Detail `root`, `alias`, `try_files` akan dibahas di Part 006.

---

## 16. How to Read Nginx Config Like Production Code

Gunakan urutan membaca berikut.

### Step 1: Cari Entry Point

Mulai dari:

```bash
nginx -T
```

atau baca:

```text
/etc/nginx/nginx.conf
```

Tentukan:

- main config file,
- include path,
- module include,
- `http` block,
- `stream` block jika ada.

### Step 2: Petakan Context Tree

Buat mental tree:

```text
main
├── events
└── http
    ├── log_format
    ├── map
    ├── upstream api_backend
    ├── server api.example.com
    │   ├── location /health
    │   ├── location /api/
    │   └── location /
    └── server web.example.com
        ├── location /assets/
        └── location /
```

Ini jauh lebih berguna daripada membaca file secara linear.

### Step 3: Identifikasi Default Global

Cari directive di `http` yang menjadi default:

- logs,
- timeouts,
- proxy headers,
- gzip,
- cache,
- body size,
- headers,
- resolver,
- client buffers.

Tanyakan:

- apakah ini berlaku ke semua service?
- apakah ada service yang harus override?
- apakah default terlalu longgar?
- apakah default terlalu agresif?

### Step 4: Baca `server` Block Sebagai Boundary Domain

Untuk setiap `server`:

- listen port,
- server_name,
- TLS,
- default server atau bukan,
- access log,
- error handling,
- root/static behavior,
- included snippets.

Pertanyaan utama:

> Request untuk host X dan port Y masuk ke server block mana?

### Step 5: Baca `location` Sebagai Routing Decision

Untuk setiap location:

- match pattern,
- modifier (`=`, `^~`, regex, prefix),
- content handler (`proxy_pass`, `return`, `try_files`, `root`, `alias`),
- timeout,
- buffer,
- headers,
- auth,
- cache,
- rate limit.

Pertanyaan utama:

> Request URI tertentu akan masuk location mana dan apa handler akhirnya?

### Step 6: Baca Include sebagai Inline Code

Jangan membaca:

```nginx
include snippets/proxy.conf;
```

sebagai “satu baris kecil”.

Buka file tersebut dan inline-kan secara mental.

Jika perlu:

```bash
nginx -T | less
```

### Step 7: Cari Directive yang Sensitif Terhadap Inheritance

Khususnya:

- `add_header`,
- `proxy_set_header`,
- `root`,
- `access_log`,
- `error_page`,
- `proxy_*_timeout`,
- `proxy_buffering`,
- `client_max_body_size`,
- `limit_req`,
- `auth_request`,
- `try_files`.

### Step 8: Uji dengan Request Konkret

Jangan hanya tanya:

> Apakah config ini benar?

Tanya:

```text
GET https://api.example.com/api/users?id=1
```

Lalu trace:

1. port 443,
2. SNI `api.example.com`,
3. server_name match,
4. location `/api/`,
5. proxy_pass target,
6. headers sent to backend,
7. timeout,
8. log output,
9. error behavior.

---

## 17. Config as Contract Between Teams

Dalam organisasi besar, Nginx config bukan milik satu orang.

Ia menjadi kontrak antara:

- platform team,
- backend team,
- frontend team,
- security team,
- SRE/operations,
- network team,
- compliance team.

Contoh kontrak yang harus eksplisit:

### 17.1 Proxy Header Contract

```nginx
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host $host;
proxy_set_header X-Forwarded-Port $server_port;
```

Pertanyaan kontrak:

- apakah backend boleh percaya `X-Forwarded-For`?
- siapa proxy paling luar?
- apakah Nginx menghapus spoofed incoming header?
- apakah Java app sudah dikonfigurasi membaca forwarded headers?

### 17.2 Timeout Contract

```nginx
proxy_connect_timeout 2s;
proxy_read_timeout 30s;
proxy_send_timeout 30s;
```

Pertanyaan kontrak:

- apakah backend endpoint boleh berjalan lebih dari 30 detik?
- apakah async job harus dipakai?
- apakah Nginx timeout lebih pendek dari app timeout?
- bagaimana client menerima timeout?

### 17.3 Body Size Contract

```nginx
client_max_body_size 20m;
```

Pertanyaan kontrak:

- endpoint upload max berapa?
- apakah frontend melakukan validasi ukuran file?
- apakah Java app punya limit yang sama?
- apakah error 413 ditangani dengan UX yang benar?

### 17.4 Security Header Contract

```nginx
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
```

Pertanyaan kontrak:

- security header dari Nginx atau app?
- siapa owner CSP?
- apakah error response juga diberi header?
- apakah header berubah per domain?

---

## 18. Configuration Design Principles

### Principle 1: Prefer Explicit Context Contracts

Snippet harus jelas context-nya.

Buruk:

```text
snippets/common.conf
```

Lebih baik:

```text
snippets/http/gzip.conf
snippets/server/security-headers.conf
snippets/location/proxy-headers.conf
```

Atau beri komentar:

```nginx
# Include context: location {}
proxy_set_header Host $host;
```

### Principle 2: Keep Routing Visible

Routing utama harus mudah dilihat.

Buruk:

```nginx
server {
    listen 443 ssl;
    server_name api.example.com;
    include everything.conf;
}
```

Lebih baik:

```nginx
server {
    listen 443 ssl;
    server_name api.example.com;

    include snippets/server/tls-api.conf;
    include snippets/server/security-headers.conf;

    location = /health {
        return 200 "ok\n";
    }

    location /api/ {
        include snippets/location/proxy-common.conf;
        proxy_pass http://api_backend;
    }
}
```

### Principle 3: Centralize Defaults, Localize Exceptions

Default global:

```nginx
http {
    proxy_connect_timeout 2s;
    proxy_read_timeout 30s;
    proxy_send_timeout 30s;
}
```

Exception lokal:

```nginx
location /reports/export/ {
    proxy_read_timeout 120s;
    proxy_pass http://report_backend;
}
```

Jangan membuat semua location punya timeout sendiri kecuali memang perlu.

### Principle 4: Avoid Hidden Overrides

Jika lower context override parent, buat terlihat.

Buruk:

```nginx
location /api/ {
    include snippets/api.conf;
    proxy_pass http://api_backend;
}
```

Jika `api.conf` diam-diam mengubah timeout, headers, cache, dan auth, reviewer sulit tahu.

Lebih baik pisahkan:

```nginx
location /api/ {
    include snippets/location/proxy-headers.conf;
    include snippets/location/proxy-timeouts-standard.conf;
    proxy_pass http://api_backend;
}
```

### Principle 5: Generate Only What You Can Inspect

Template config boleh digunakan, terutama di Kubernetes atau multi-env.

Tapi output akhirnya harus bisa diinspeksi:

```bash
nginx -T
```

Jangan bergantung pada template source saja.

Yang dijalankan adalah generated config.

### Principle 6: Test Config Before Reload

Selalu:

```bash
nginx -t && nginx -s reload
```

Dengan systemd:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

Reload Nginx bersifat graceful jika config valid.

Jika config invalid, Nginx lama tetap berjalan, tetapi deployment pipeline harus menangkap kegagalan.

---

## 19. Practical Example: Production-Oriented Config Skeleton

Berikut skeleton yang akan sering menjadi basis part berikutnya.

```nginx
# /etc/nginx/nginx.conf

user nginx;
worker_processes auto;
worker_rlimit_nofile 65535;

error_log /var/log/nginx/error.log warn;
pid /run/nginx.pid;

events {
    worker_connections 4096;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    # Logging
    log_format main '$remote_addr - $remote_user [$time_local] '
                    '"$request" $status $body_bytes_sent '
                    '"$http_referer" "$http_user_agent" '
                    'rt=$request_time '
                    'uct=$upstream_connect_time '
                    'uht=$upstream_header_time '
                    'urt=$upstream_response_time '
                    'ua="$upstream_addr"';

    access_log /var/log/nginx/access.log main;

    # HTTP defaults
    sendfile on;
    keepalive_timeout 65s;
    client_max_body_size 20m;

    # Proxy defaults
    proxy_connect_timeout 2s;
    proxy_send_timeout 30s;
    proxy_read_timeout 30s;

    # Maps
    map $http_upgrade $connection_upgrade {
        default upgrade;
        ''      close;
    }

    # Upstreams
    upstream api_backend {
        server 127.0.0.1:8080;
        keepalive 64;
    }

    # Servers
    server {
        listen 80 default_server;
        server_name _;
        return 444;
    }

    server {
        listen 80;
        server_name api.local.test;

        location = /health {
            access_log off;
            return 200 "ok\n";
        }

        location /api/ {
            proxy_http_version 1.1;
            proxy_set_header Connection "";
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;

            proxy_pass http://api_backend;
        }
    }
}
```

### Apa yang Bisa Kita Baca dari Skeleton Ini?

1. Main context mengatur worker dan process.
2. Events context mengatur connection capacity.
3. HTTP context punya logging, defaults, map, upstream, server.
4. Ada default server untuk unknown host.
5. `api.local.test` punya `/health` dan `/api/`.
6. Proxy headers eksplisit.
7. Timeout global berlaku untuk `/api/`.
8. Upstream keepalive diaktifkan.

### Apa yang Belum Ada?

- TLS,
- static file serving,
- cache,
- compression,
- rate limit,
- security headers,
- WebSocket,
- error pages,
- structured JSON logs,
- multi-service routing,
- Kubernetes integration.

Itu akan ditambahkan bertahap di part berikutnya.

---

## 20. Failure Modes Akibat Salah Memahami Grammar

### 20.1 Config Valid, Behavior Salah

Ini lebih berbahaya daripada syntax error.

Contoh:

```nginx
location /api/ {
    add_header Cache-Control "no-store" always;
    proxy_pass http://api_backend;
}
```

Config valid, tetapi security headers dari parent hilang.

### 20.2 Include Salah Context

Deployment gagal karena snippet dipakai di context salah.

Gejala:

```text
"proxy_set_header" directive is not allowed here
```

Atau:

```text
"location" directive is not allowed here
```

### 20.3 Directive Diletakkan Terlalu Global

Contoh:

```nginx
http {
    client_max_body_size 500m;
}
```

Maksudnya hanya endpoint upload, tapi efeknya semua endpoint menerima body besar.

Risiko:

- memory pressure,
- disk buffering,
- abuse surface,
- DoS amplification.

Lebih baik:

```nginx
server {
    location /upload/ {
        client_max_body_size 500m;
        proxy_pass http://upload_backend;
    }

    location /api/ {
        client_max_body_size 5m;
        proxy_pass http://api_backend;
    }
}
```

### 20.4 Directive Diletakkan Terlalu Lokal

Contoh:

```nginx
location /api/users/ {
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_pass http://user_backend;
}

location /api/orders/ {
    proxy_pass http://order_backend;
}
```

`/api/orders/` lupa proxy headers.

Akibat di Java app:

- redirect salah scheme,
- client IP salah,
- tenant host salah,
- generated URL salah.

Solusi:

```nginx
location /api/users/ {
    include snippets/location/proxy-headers.conf;
    proxy_pass http://user_backend;
}

location /api/orders/ {
    include snippets/location/proxy-headers.conf;
    proxy_pass http://order_backend;
}
```

Atau tempatkan di `server` jika inheritance directive-nya aman dan sesuai.

### 20.5 Duplicate Server Block Ambiguity

Contoh:

```nginx
server {
    listen 80;
    server_name api.example.com;
    location / { proxy_pass http://v1; }
}

server {
    listen 80;
    server_name api.example.com;
    location / { proxy_pass http://v2; }
}
```

Ini bisa menghasilkan warning/conflict dan behavior tidak sesuai ekspektasi.

Jangan punya dua owner untuk domain yang sama.

### 20.6 Generated Config Tidak Sama dengan Source Template

Di container/Kubernetes, file yang kamu review mungkin template:

```nginx
proxy_pass http://${BACKEND_HOST}:${BACKEND_PORT};
```

Tapi runtime file mungkin:

```nginx
proxy_pass http://:;
```

karena environment variable kosong.

Selalu inspect generated config.

---

## 21. Review Checklist untuk Pull Request Nginx Config

Gunakan checklist ini saat review config.

### 21.1 Syntax and Structure

- Apakah `nginx -t` pass?
- Apakah `nginx -T` output sesuai ekspektasi?
- Apakah semua include path ada?
- Apakah context setiap snippet jelas?
- Apakah naming file menunjukkan urutan dan tujuan?

### 21.2 Server Selection

- Apakah `listen` benar?
- Apakah `server_name` benar?
- Apakah ada `default_server` yang aman?
- Apakah duplicate host dicegah?
- Apakah HTTP dan HTTPS behavior konsisten?

### 21.3 Location Routing

- Apakah location matching jelas?
- Apakah regex location diperlukan?
- Apakah `location /` fallback aman?
- Apakah static route dan API route tidak saling menelan?
- Apakah `try_files` menyebabkan internal redirect yang disengaja?

### 21.4 Proxy Contract

- Apakah `Host` dikirim dengan benar?
- Apakah `X-Forwarded-*` lengkap?
- Apakah incoming spoofed headers dipertimbangkan?
- Apakah upstream target benar?
- Apakah trailing slash pada `proxy_pass` disengaja?

### 21.5 Inheritance and Overrides

- Apakah directive global tidak terlalu luas?
- Apakah local override terlihat?
- Apakah `add_header` tidak menghapus parent headers tanpa sadar?
- Apakah timeout default dan exception jelas?
- Apakah body size limit sesuai endpoint?

### 21.6 Operability

- Apakah access log cukup untuk debugging?
- Apakah upstream timing dicatat?
- Apakah error log level sesuai?
- Apakah health endpoint jelas?
- Apakah reload aman?

### 21.7 Security

- Apakah unknown host ditolak?
- Apakah dotfile/hidden file aman?
- Apakah admin endpoint diproteksi?
- Apakah request size dibatasi?
- Apakah security header konsisten?
- Apakah config tidak menyimpan secret sembarangan?

---

## 22. Latihan Mental: Trace Request dari Config

Gunakan config berikut:

```nginx
http {
    proxy_read_timeout 30s;

    upstream app_backend {
        server 127.0.0.1:8080;
    }

    server {
        listen 80 default_server;
        server_name _;
        return 444;
    }

    server {
        listen 80;
        server_name app.local;
        root /var/www/app;

        location = /health {
            return 200 "ok\n";
        }

        location /api/ {
            proxy_read_timeout 10s;
            proxy_set_header Host $host;
            proxy_pass http://app_backend;
        }

        location /assets/ {
            expires 1y;
            try_files $uri =404;
        }

        location / {
            try_files $uri /index.html;
        }
    }
}
```

Trace request:

```text
GET http://app.local/api/users
```

Jawaban:

1. Port 80 match.
2. Host `app.local` memilih server kedua.
3. URI `/api/users` match `location /api/`.
4. `proxy_read_timeout` menjadi `10s`, override global `30s`.
5. Header `Host` ke upstream menjadi `$host`, yaitu `app.local`.
6. Request diproxy ke upstream `app_backend`, yaitu `127.0.0.1:8080`.

Trace request:

```text
GET http://unknown.local/api/users
```

Jawaban:

1. Port 80 match.
2. Host tidak match `app.local`.
3. Default server dipilih.
4. Nginx return `444`.
5. Tidak masuk location `/api/` server app.

Trace request:

```text
GET http://app.local/assets/logo.png
```

Jawaban:

1. Port 80 match.
2. Host `app.local` memilih server kedua.
3. URI match `location /assets/`.
4. `try_files $uri =404` mencari `/var/www/app/assets/logo.png`.
5. Jika ada, serve static file.
6. Jika tidak, return 404.

Trace request:

```text
GET http://app.local/dashboard
```

Jawaban:

1. Port 80 match.
2. Host `app.local` memilih server kedua.
3. URI `/dashboard` match `location /`.
4. `try_files $uri /index.html` mencari `/var/www/app/dashboard`.
5. Jika tidak ada, internal redirect/serve `/index.html` untuk SPA.

---

## 23. Latihan Desain

### Latihan 1: Context Contract

Buat tiga snippet:

1. snippet untuk `http` context,
2. snippet untuk `server` context,
3. snippet untuk `location` context.

Contoh jawaban:

```text
snippets/http/logging.conf
snippets/server/security-headers.conf
snippets/location/proxy-headers.conf
```

Isi:

```nginx
# snippets/http/logging.conf
# Context: http {}
log_format main '$remote_addr "$request" $status $request_time';
access_log /var/log/nginx/access.log main;
```

```nginx
# snippets/server/security-headers.conf
# Context: server {} or location {}, but include consistently.
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
```

```nginx
# snippets/location/proxy-headers.conf
# Context: location {}
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
```

### Latihan 2: Identify Hidden Override

Apa masalah konfigurasi ini?

```nginx
http {
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;

    server {
        listen 80;

        location /api/ {
            add_header Cache-Control "no-store" always;
            proxy_pass http://backend;
        }
    }
}
```

Jawaban:

`add_header` di `location /api/` dapat menyebabkan security headers dari parent tidak ikut pada response `/api/`. Jangan asumsikan additive inheritance.

### Latihan 3: Effective Context

Jika config utama:

```nginx
http {
    server {
        listen 80;
        include snippets/x.conf;
    }
}
```

File `x.conf` boleh berisi apa?

Jawaban:

Directive yang valid di `server` context, misalnya:

```nginx
location /health {
    return 200;
}
```

atau:

```nginx
client_max_body_size 10m;
```

Tetapi bukan:

```nginx
http { ... }
```

atau:

```nginx
worker_processes auto;
```

---

## 24. Kesalahan Umum dan Cara Berpikir yang Benar

### Kesalahan 1: Membaca Config Secara Linear

Salah:

> Baris yang muncul lebih dulu pasti dieksekusi lebih dulu.

Benar:

> Nginx config membangun struktur context dan handler. Runtime behavior tergantung server selection, location matching, directive semantics, phase, dan variable.

### Kesalahan 2: Menganggap Include Punya Scope Sendiri

Salah:

> File snippet punya context sendiri.

Benar:

> Include disisipkan ke context tempat ia dipanggil.

### Kesalahan 3: Menganggap Semua Directive Merge

Salah:

> Kalau parent punya directive dan child punya directive sama, hasilnya gabungan.

Benar:

> Tergantung directive. Ada yang inherited, replaced, additive, atau context-specific.

### Kesalahan 4: Menggunakan `if` Seperti Java

Salah:

```nginx
if (...) {
    proxy_pass ...;
}
```

Benar:

Gunakan `map`, location split, return/rewrite sederhana, atau pindahkan logic kompleks ke application/gateway yang tepat.

### Kesalahan 5: Menyembunyikan Routing di Snippet

Salah:

```nginx
include magic-routing.conf;
```

Benar:

Routing utama harus terlihat di `server` block. Snippet untuk common behavior, bukan menyembunyikan struktur domain.

---

## 25. Hubungan dengan Java Backend Engineering

Untuk Java engineer, config grammar Nginx berdampak langsung pada aplikasi.

### 25.1 Wrong Context → Wrong Runtime Contract

Jika `proxy_set_header` tidak berada di location yang benar, Java app mungkin menerima:

- wrong scheme,
- wrong host,
- wrong client IP,
- missing request ID,
- missing auth header.

Aplikasi terlihat bug, padahal proxy contract salah.

### 25.2 Wrong Inheritance → Inconsistent Endpoint Behavior

Misalnya:

```nginx
location /api/v1/ {
    include proxy-headers.conf;
    proxy_pass http://v1;
}

location /api/v2/ {
    proxy_pass http://v2;
}
```

`v2` tidak menerima forwarded headers.

Akibat:

- Spring Security redirect bisa salah,
- generated OpenAPI server URL bisa salah,
- audit log IP salah,
- tenant resolution salah.

### 25.3 Wrong Timeout Placement → Cascading Failure

Jika timeout terlalu global:

```nginx
http {
    proxy_read_timeout 300s;
}
```

Semua endpoint bisa menahan connection lama.

Efek:

- worker connection occupancy naik,
- upstream thread pool tertekan,
- client retry menumpuk,
- p99 latency naik,
- outage meluas.

Lebih baik timeout dipikir sebagai contract per endpoint category.

### 25.4 Wrong Body Limit → Upload/API Failure

Jika Nginx:

```nginx
client_max_body_size 1m;
```

Tapi Spring Boot:

```properties
spring.servlet.multipart.max-file-size=20MB
```

Upload 5 MB akan gagal di Nginx dulu dengan 413, tidak pernah sampai aplikasi.

Debugging di Java tidak menemukan request.

### 25.5 Wrong Log Format → Incident Blindness

Tanpa upstream timing:

```nginx
log_format main '$remote_addr "$request" $status';
```

Sulit membedakan:

- lambat di client,
- lambat di Nginx,
- lambat connect upstream,
- lambat response upstream,
- lambat karena buffering.

Lebih baik:

```nginx
log_format main '$remote_addr "$request" $status '
                'rt=$request_time '
                'uct=$upstream_connect_time '
                'uht=$upstream_header_time '
                'urt=$upstream_response_time';
```

---

## 26. Production Rules of Thumb

1. Treat Nginx config as code.
2. Always know the context of every directive.
3. Use `nginx -T` to inspect effective config.
4. Give snippets explicit context contracts.
5. Keep server and location routing visible.
6. Centralize defaults, localize exceptions.
7. Do not assume inheritance semantics; verify important directives.
8. Avoid dynamic variables in critical upstream routing unless necessary.
9. Avoid `if` for complex control flow.
10. Align Nginx config with Java application assumptions.
11. Make logs explain routing and upstream behavior.
12. Build config review checklist into PR process.
13. Test config before reload.
14. In containerized setups, validate generated config, not just template.
15. Prefer boring, readable config over clever config.

---

## 27. Minimal Commands You Must Internalize

```bash
# Check syntax and semantic validity enough for reload/start
sudo nginx -t
```

```bash
# Dump effective config with includes expanded
sudo nginx -T
```

```bash
# Reload gracefully after successful test
sudo systemctl reload nginx
```

```bash
# Check service status
sudo systemctl status nginx
```

```bash
# View recent logs with systemd
sudo journalctl -u nginx -n 100 --no-pager
```

```bash
# Follow error log
sudo tail -f /var/log/nginx/error.log
```

```bash
# Follow access log
sudo tail -f /var/log/nginx/access.log
```

In container:

```bash
docker exec <nginx-container> nginx -t
```

```bash
docker exec <nginx-container> nginx -T
```

```bash
docker exec <nginx-container> nginx -s reload
```

---

## 28. Ringkasan Mental Model

Konfigurasi Nginx harus dipahami sebagai struktur hierarkis, bukan kumpulan baris independen.

Ringkasnya:

```text
main
  process-level config

events
  connection/event processing config

http
  HTTP-wide defaults, maps, logs, upstreams, servers

server
  virtual host / domain / port / TLS boundary

location
  URI routing and request handling behavior

upstream
  backend server group

stream
  TCP/UDP proxy layer
```

Hal yang paling menentukan behavior:

1. context tempat directive berada,
2. inheritance/override semantics directive tersebut,
3. include expansion,
4. server selection,
5. location matching,
6. request-time variable evaluation,
7. request processing phase.

Kalimat yang harus diingat:

> Yang penting bukan hanya “directive apa yang ditulis”, tetapi “directive itu berada di context mana, diwariskan dari mana, dioverride oleh apa, dan dievaluasi pada fase apa”.

---

## 29. Apa yang Sudah Dikuasai Setelah Part Ini

Setelah menyelesaikan Part 003, kamu sudah punya fondasi untuk membaca konfigurasi Nginx secara serius:

- bisa membedakan simple directive dan block directive,
- memahami main/events/http/server/location/upstream/stream context,
- memahami include sebagai textual composition,
- memahami bahwa snippet tidak punya scope sendiri,
- memahami bahwa inheritance tidak universal,
- tahu risiko `add_header` dan directive list lain,
- memahami parse time vs request time,
- memahami variable sebagai runtime binding,
- tahu kenapa config tidak dieksekusi linear seperti script,
- tahu kenapa `if` bukan if statement umum,
- punya checklist review config production,
- bisa melakukan request tracing dari config.

Ini adalah fondasi yang wajib sebelum masuk ke server selection dan location matching.

---

## 30. Preview Part 004

Part berikutnya:

# Part 004 — Server Selection: `listen`, `server_name`, SNI, Default Server

Kita akan membahas bagaimana Nginx memilih `server` block ketika request datang.

Topik penting:

- `listen` socket matching,
- `default_server`,
- `server_name`,
- exact/wildcard/regex name,
- Host header,
- TLS SNI,
- unknown host strategy,
- multi-domain config,
- security risk dari default virtual host yang salah.

Ini penting karena sebelum Nginx memilih `location`, ia harus memilih `server` terlebih dahulu.

Jika server selection salah, semua location logic setelahnya tidak relevan.

---

## Status Akhir Part 003

- Part 003 selesai.
- Seri belum selesai.
- Progress: `003 / 030`.
- Lanjut ke: `Part 004 — Server Selection: listen, server_name, SNI, Default Server`.
