# learn-nginx-mastery-for-java-engineers-part-004.md

# Part 004 — Server Selection: `listen`, `server_name`, SNI, Default Server

> Seri: **learn-nginx-mastery-for-java-engineers**  
> Bagian: **004 dari 030**  
> Fokus: memahami bagaimana Nginx memilih `server` block untuk sebuah request, dan bagaimana keputusan ini berdampak pada routing, TLS, keamanan, observability, dan aplikasi Java di belakangnya.

---

## 0. Mengapa Bagian Ini Penting

Di Nginx, sebelum request masuk ke `location`, sebelum `proxy_pass`, sebelum rewrite, sebelum rate limit, bahkan sebelum aplikasi Java tahu ada request, Nginx harus menjawab satu pertanyaan dasar:

> **Request ini milik server block yang mana?**

Pertanyaan ini terlihat sederhana, tetapi di production sering menjadi sumber masalah yang sulit didiagnosis:

- domain A tiba-tiba masuk ke aplikasi B,
- HTTPS domain tertentu memakai certificate yang salah,
- request tanpa `Host` tetap diterima,
- bot scanner masuk ke default virtual host,
- redirect HTTP ke HTTPS menggunakan domain yang tidak diharapkan,
- konfigurasi `server_name` benar, tetapi Nginx tetap memilih server block lain,
- aplikasi Java menerima `Host` yang tidak valid dan membangun absolute URL yang salah,
- multi-tenant system salah memilih tenant karena host boundary bocor,
- staging domain tidak sengaja expose production backend,
- unknown domain diarahkan ke aplikasi utama sehingga memperbesar attack surface.

Bagian ini membangun mental model yang presisi tentang **server selection**.

Kalau `location` adalah routing di dalam satu virtual server, maka `server` selection adalah routing antar virtual server.

---

## 1. Mental Model Utama

Bayangkan Nginx menerima request sebagai tuple:

```text
incoming_connection = {
  local_ip,
  local_port,
  protocol,
  tls_sni?,
  http_host?,
  request_line,
  headers,
  body
}
```

Sebelum memproses URI seperti `/api/orders`, Nginx memilih kandidat berdasarkan:

```text
1. IP dan port dari directive listen
2. TLS SNI, jika request HTTPS dan client mengirim SNI
3. Host header, untuk HTTP request routing
4. server_name matching rule
5. default_server fallback
```

Dalam bentuk sederhana:

```text
Connection arrives on IP:port
        |
        v
Find server blocks listening on that IP:port
        |
        v
If TLS: choose initial TLS server, maybe using SNI
        |
        v
Read HTTP request
        |
        v
Use Host header to select matching server_name
        |
        v
If none matches: use default server for that listen address
        |
        v
Now run location selection inside chosen server
```

Hal penting:

> Nginx tidak memilih `server` block berdasarkan urutan semata. Urutan hanya penting untuk default fallback pada address tertentu jika `default_server` tidak ditentukan eksplisit.

---

## 2. Konsep Dasar: Virtual Server

Nginx dapat menjalankan banyak virtual server dalam satu proses.

Contoh:

```nginx
http {
    server {
        listen 80;
        server_name api.example.com;

        location / {
            proxy_pass http://api_backend;
        }
    }

    server {
        listen 80;
        server_name admin.example.com;

        location / {
            proxy_pass http://admin_backend;
        }
    }
}
```

Kedua `server` block sama-sama mendengar port 80, tetapi berbeda `server_name`.

Request:

```http
GET /users HTTP/1.1
Host: api.example.com
```

akan masuk ke server `api.example.com`.

Request:

```http
GET /users HTTP/1.1
Host: admin.example.com
```

akan masuk ke server `admin.example.com`.

Namun request:

```http
GET /users HTTP/1.1
Host: unknown.example.com
```

akan masuk ke **default server** untuk address tersebut.

Di sinilah banyak risiko muncul.

---

## 3. `listen`: Dimensi IP dan Port

Directive `listen` menentukan address tempat server block menerima koneksi.

Contoh paling umum:

```nginx
server {
    listen 80;
    server_name example.com;
}
```

`listen 80` berarti mendengar di semua address IPv4 yang relevan untuk port 80, tergantung konfigurasi OS dan Nginx.

Contoh eksplisit:

```nginx
server {
    listen 192.0.2.10:80;
    server_name example.com;
}
```

Artinya hanya connection yang tiba di IP `192.0.2.10` port `80` yang cocok dengan server ini.

Contoh IPv6:

```nginx
server {
    listen [::]:80;
    server_name example.com;
}
```

Untuk HTTPS:

```nginx
server {
    listen 443 ssl;
    server_name example.com;

    ssl_certificate     /etc/nginx/certs/example.com.crt;
    ssl_certificate_key /etc/nginx/certs/example.com.key;
}
```

Untuk HTTP/2 di versi modern, pola umum:

```nginx
server {
    listen 443 ssl http2;
    server_name example.com;
}
```

Namun di beberapa versi baru, konfigurasi HTTP/2 dapat direkomendasikan menggunakan directive terpisah seperti `http2 on;`. Selalu cek versi Nginx dan distribusi yang dipakai.

---

## 4. Address-Based Selection

Langkah pertama server selection adalah berdasarkan address.

Misalnya:

```nginx
server {
    listen 80;
    server_name a.example.com;
}

server {
    listen 8080;
    server_name a.example.com;
}
```

Request ke port 80 dan port 8080 diproses oleh kelompok server berbeda.

```text
Host: a.example.com, destination port 80   -> server listen 80
Host: a.example.com, destination port 8080 -> server listen 8080
```

Jadi `server_name` saja tidak cukup. `listen` menentukan kandidat awal.

Contoh lebih kompleks:

```nginx
server {
    listen 10.0.0.10:80;
    server_name app.internal;
}

server {
    listen 10.0.0.20:80;
    server_name app.internal;
}
```

Keduanya punya `server_name` sama, tetapi address berbeda. Request ke IP berbeda akan memilih kandidat berbeda.

---

## 5. Default Server

Default server adalah server block yang digunakan ketika tidak ada `server_name` yang cocok untuk address tertentu.

Contoh:

```nginx
server {
    listen 80 default_server;
    server_name _;

    return 444;
}

server {
    listen 80;
    server_name app.example.com;

    location / {
        proxy_pass http://app_backend;
    }
}
```

Di sini, request ke `app.example.com` masuk ke aplikasi. Request ke host lain akan masuk ke default server dan ditutup dengan `444`.

`444` adalah kode internal Nginx untuk menutup koneksi tanpa response HTTP. Ini sering dipakai untuk menolak traffic tidak dikenal. Namun untuk beberapa environment, lebih baik mengembalikan `404`, `403`, atau redirect eksplisit agar observability lebih jelas.

### 5.1 Default Jika Tidak Didefinisikan

Jika tidak ada `default_server`, Nginx menggunakan server pertama untuk address tersebut sebagai default.

Contoh:

```nginx
server {
    listen 80;
    server_name app.example.com;
}

server {
    listen 80;
    server_name admin.example.com;
}
```

Jika request datang dengan:

```http
Host: unknown.example.com
```

maka request akan masuk ke server block pertama untuk `listen 80`, yaitu `app.example.com`.

Ini berbahaya karena default behavior bergantung pada urutan file include.

Misalnya:

```nginx
include /etc/nginx/conf.d/*.conf;
```

Jika file diproses secara lexical order, perubahan nama file dapat mengubah default server tanpa disadari.

Contoh:

```text
00-app.conf
10-admin.conf
```

berbeda dampaknya dengan:

```text
00-admin.conf
10-app.conf
```

Karena itu production config sebaiknya selalu punya explicit catch-all default server.

---

## 6. `server_name`: Exact, Wildcard, Regex

`server_name` menentukan nama host yang valid untuk server block.

Bentuk utama:

```nginx
server_name example.com;
server_name example.com www.example.com;
server_name *.example.com;
server_name example.*;
server_name ~^(.+)\.example\.com$;
```

Nginx memakai prioritas matching tertentu.

Secara konseptual:

```text
1. Exact name
2. Longest wildcard starting with *
3. Longest wildcard ending with *
4. First matching regex in file order
5. Default server fallback
```

Mari kita bahas satu per satu.

---

## 7. Exact `server_name`

Contoh:

```nginx
server {
    listen 80;
    server_name api.example.com;
}
```

Cocok untuk:

```text
api.example.com
```

Tidak cocok untuk:

```text
www.api.example.com
example.com
API.EXAMPLE.COM
```

Secara host name, DNS tidak case-sensitive, tetapi jangan bergantung pada variasi casing di boundary. Normalisasi dan testing tetap penting.

Untuk banyak nama:

```nginx
server {
    listen 80;
    server_name example.com www.example.com;
}
```

Cocok untuk kedua host.

### Praktik Umum

Biasanya canonical domain dan alias ditangani eksplisit:

```nginx
server {
    listen 80;
    server_name www.example.com;

    return 301 https://example.com$request_uri;
}

server {
    listen 443 ssl;
    server_name example.com;

    location / {
        proxy_pass http://app_backend;
    }
}
```

Namun hati-hati: redirect memakai `$host` atau literal host punya konsekuensi berbeda. Ini dibahas di bagian redirect.

---

## 8. Wildcard `server_name`

Wildcard awal:

```nginx
server_name *.example.com;
```

Cocok untuk:

```text
api.example.com
admin.example.com
tenant1.example.com
```

Tergantung aturan Nginx, wildcard ini juga dapat memiliki perilaku khusus untuk nama tertentu. Dalam desain production, jangan mengandalkan implisit yang sulit dibaca. Lebih baik eksplisit jika host penting.

Wildcard akhir:

```nginx
server_name example.*;
```

Cocok untuk pola seperti:

```text
example.com
example.net
```

Tetapi wildcard akhir jarang direkomendasikan untuk sistem production yang serius karena terlalu longgar.

### Risiko Wildcard

Wildcard membuat boundary melebar.

Contoh:

```nginx
server {
    listen 443 ssl;
    server_name *.example.com;

    location / {
        proxy_pass http://tenant_backend;
    }
}
```

Jika aplikasi Java menentukan tenant dari host:

```text
{tenant}.example.com
```

maka host seperti ini bisa masuk:

```text
anything.example.com
admin.example.com
internal.example.com
dev.example.com
```

Jika backend tidak melakukan validasi tenant dengan benar, attacker dapat mengeksplorasi host namespace.

Invariant yang harus dijaga:

> Wildcard di Nginx tidak boleh dianggap sebagai otorisasi tenant. Ia hanya routing awal. Validasi tenant tetap harus dilakukan di application/domain layer.

---

## 9. Regex `server_name`

Regex server name:

```nginx
server {
    listen 80;
    server_name ~^(?<tenant>[a-z0-9-]+)\.example\.com$;

    location / {
        proxy_set_header X-Tenant $tenant;
        proxy_pass http://tenant_backend;
    }
}
```

Regex bisa menangkap variable.

Contoh host:

```text
alpha.example.com
```

akan menghasilkan:

```text
$tenant = alpha
```

Ini powerful, tetapi berisiko.

### Risiko Regex `server_name`

1. Terlalu permisif.
2. Salah escaping dot.
3. Bergantung pada urutan regex.
4. Membocorkan routing logic ke header internal.
5. Membuat tenant spoofing jika backend percaya header tanpa validasi.

Contoh buruk:

```nginx
server_name ~^(?<tenant>.+)\.example\.com$;
```

Masalah:

- `.+` terlalu bebas,
- bisa mencakup karakter tidak diharapkan,
- tidak memberi batas panjang,
- tidak mengekspresikan aturan domain bisnis.

Lebih baik:

```nginx
server_name ~^(?<tenant>[a-z0-9][a-z0-9-]{1,61}[a-z0-9])\.example\.com$;
```

Tetapi tetap: aplikasi harus validasi tenant terhadap registry/database.

---

## 10. Special `server_name _;`

Sering ditemukan:

```nginx
server {
    listen 80 default_server;
    server_name _;

    return 444;
}
```

`_` bukan wildcard khusus. Itu hanya nama yang kecil kemungkinan cocok dengan host valid. Efek catch-all sebenarnya berasal dari `default_server`, bukan dari `_`.

Jadi ini:

```nginx
server_name _;
```

bukan berarti “match anything”.

Yang membuatnya menjadi fallback adalah:

```nginx
listen 80 default_server;
```

Mental model:

```text
server_name _     -> nama biasa
 default_server   -> fallback untuk address
```

---

## 11. Empty Server Name dan Request Tanpa Host

HTTP/1.1 mensyaratkan Host header. Tetapi request abnormal, HTTP/1.0, scanner, atau traffic raw bisa datang tanpa Host.

Nginx punya mekanisme untuk menangani empty name.

Contoh:

```nginx
server {
    listen 80 default_server;
    server_name "";

    return 444;
}
```

Dalam practice, catch-all default server sudah cukup untuk mayoritas kasus unknown host. Tetapi untuk environment hardened, request tanpa Host perlu dipikirkan eksplisit.

---

## 12. Host Header vs DNS

Ini prinsip sangat penting:

> Nginx tidak tahu user mengetik domain apa dari DNS. Nginx melihat connection destination dan Host header.

DNS hanya mengarahkan nama ke IP. Setelah TCP connection sampai ke Nginx, routing HTTP berbasis `Host` header.

Attacker bisa mengirim:

```bash
curl -H 'Host: app.example.com' http://203.0.113.10/
```

walaupun DNS `app.example.com` tidak mereka kontrol.

Artinya:

- jangan percaya Host hanya karena DNS benar,
- validasi Host boundary di Nginx,
- jangan biarkan unknown host masuk ke aplikasi utama,
- jangan gunakan `$host` sembarangan untuk generate redirect ke domain publik tanpa whitelist.

---

## 13. `$host`, `$http_host`, dan `$server_name`

Nginx punya beberapa variable terkait host.

### 13.1 `$http_host`

Nilai mentah dari header `Host`.

Jika request:

```http
Host: App.Example.Com:8080
```

maka `$http_host` kira-kira berisi:

```text
App.Example.Com:8080
```

Ia bisa mengandung port dan casing sesuai input client.

### 13.2 `$host`

Nilai host yang dinormalisasi oleh Nginx. Biasanya:

- berasal dari request line atau Host header,
- lowercased,
- tanpa port,
- fallback ke matching server name jika Host tidak ada.

### 13.3 `$server_name`

Nama server dari konfigurasi yang dipilih.

Contoh:

```nginx
server {
    listen 80;
    server_name example.com www.example.com;

    return 200 "host=$host http_host=$http_host server_name=$server_name\n";
}
```

Request:

```bash
curl -H 'Host: www.example.com:8080' http://127.0.0.1/
```

Response konseptual:

```text
host=www.example.com http_host=www.example.com:8080 server_name=example.com
```

### 13.4 Konsekuensi Praktis

Untuk redirect canonical, hindari:

```nginx
return 301 https://$host$request_uri;
```

pada catch-all server, karena attacker bisa mengontrol Host.

Lebih aman:

```nginx
return 301 https://example.com$request_uri;
```

Untuk proxy ke backend, jangan selalu forward `$http_host` tanpa sadar. Biasanya lebih aman dan stabil:

```nginx
proxy_set_header Host $host;
```

atau untuk backend yang harus melihat canonical host:

```nginx
proxy_set_header Host example.com;
```

Tergantung kontrak arsitektur.

---

## 14. HTTPS dan SNI

Untuk HTTPS, ada satu kompleksitas tambahan: TLS handshake terjadi sebelum HTTP request dibaca.

Masalahnya:

- `Host` header berada di dalam HTTP request,
- HTTP request berada di dalam TLS tunnel,
- certificate harus dipilih saat TLS handshake,
- jadi Nginx butuh nama domain sebelum membaca Host.

Solusinya adalah **SNI** atau Server Name Indication.

SNI memungkinkan client mengirim nama server yang ingin diakses saat TLS handshake.

Contoh:

```text
TLS ClientHello:
  server_name = api.example.com
```

Nginx menggunakan SNI untuk memilih certificate/server TLS yang sesuai.

---

## 15. TLS Server Selection Lifecycle

Untuk HTTPS:

```text
1. TCP connection arrives on 443
2. Nginx finds default SSL server for address
3. TLS ClientHello arrives
4. If SNI exists, Nginx tries to select matching SSL server
5. Nginx serves certificate from selected server
6. TLS handshake completes
7. HTTP request is decrypted
8. Host header may further determine HTTP server context
9. location selection begins
```

Hal penting:

> SNI dan Host header idealnya sama, tetapi secara teknis bisa berbeda.

Contoh abnormal:

```text
SNI:  api.example.com
Host: admin.example.com
```

Ini bisa terjadi karena bug client, proxy layer, atau percobaan abuse.

Nginx umumnya memilih certificate berdasarkan SNI, lalu memproses HTTP berdasarkan Host. Jika tidak dikendalikan, mismatch dapat menyebabkan perilaku mengejutkan.

---

## 16. Contoh Multi-Domain HTTPS

```nginx
server {
    listen 443 ssl default_server;
    server_name _;

    ssl_certificate     /etc/nginx/certs/default.crt;
    ssl_certificate_key /etc/nginx/certs/default.key;

    return 444;
}

server {
    listen 443 ssl;
    server_name api.example.com;

    ssl_certificate     /etc/nginx/certs/api.example.com.crt;
    ssl_certificate_key /etc/nginx/certs/api.example.com.key;

    location / {
        proxy_pass http://api_backend;
    }
}

server {
    listen 443 ssl;
    server_name admin.example.com;

    ssl_certificate     /etc/nginx/certs/admin.example.com.crt;
    ssl_certificate_key /etc/nginx/certs/admin.example.com.key;

    location / {
        proxy_pass http://admin_backend;
    }
}
```

Jika client mengirim SNI `api.example.com`, Nginx memilih certificate API.

Jika client mengirim SNI `admin.example.com`, Nginx memilih certificate admin.

Jika client tidak mengirim SNI atau mengirim domain unknown, Nginx memakai default SSL server.

---

## 17. Default HTTPS Server Harus Memiliki Certificate

Untuk `listen 443 ssl default_server`, Nginx tetap perlu certificate karena TLS handshake harus diselesaikan atau ditolak dengan cara TLS-valid.

Contoh:

```nginx
server {
    listen 443 ssl default_server;
    server_name _;

    ssl_certificate     /etc/nginx/certs/default.crt;
    ssl_certificate_key /etc/nginx/certs/default.key;

    return 444;
}
```

Certificate default bisa berupa:

- certificate khusus catch-all,
- self-signed internal untuk menutup handshake,
- wildcard certificate jika sesuai kebijakan,
- certificate dummy di environment tertentu.

Namun jangan sampai default HTTPS server memakai certificate production domain utama jika tujuanmu menolak unknown host. Itu dapat membuat scanner melihat domain utama pada host yang tidak dikenal.

---

## 18. HTTP to HTTPS Redirect: Benar dan Salah

### Salah: Catch-All Redirect dengan `$host`

```nginx
server {
    listen 80 default_server;
    server_name _;

    return 301 https://$host$request_uri;
}
```

Masalah:

Jika attacker mengirim:

```bash
curl -H 'Host: evil.com' http://your-ip/
```

Nginx menjawab:

```http
Location: https://evil.com/...
```

Ini bisa menjadi open redirect behavior di boundary tertentu.

### Lebih Aman: Redirect Hanya Host yang Dikenal

```nginx
server {
    listen 80;
    server_name example.com www.example.com;

    return 301 https://example.com$request_uri;
}

server {
    listen 80 default_server;
    server_name _;

    return 444;
}
```

Dengan pola ini:

- host valid diarahkan ke canonical HTTPS,
- host unknown ditolak.

---

## 19. Canonical Domain Strategy

Untuk aplikasi publik, sebaiknya tentukan canonical host.

Misalnya:

```text
canonical: example.com
alias:     www.example.com
invalid:   anything else
```

Konfigurasi:

```nginx
server {
    listen 80;
    server_name www.example.com;
    return 301 https://example.com$request_uri;
}

server {
    listen 80;
    server_name example.com;
    return 301 https://example.com$request_uri;
}

server {
    listen 443 ssl;
    server_name www.example.com;

    ssl_certificate     /etc/nginx/certs/www.example.com.crt;
    ssl_certificate_key /etc/nginx/certs/www.example.com.key;

    return 301 https://example.com$request_uri;
}

server {
    listen 443 ssl;
    server_name example.com;

    ssl_certificate     /etc/nginx/certs/example.com.crt;
    ssl_certificate_key /etc/nginx/certs/example.com.key;

    location / {
        proxy_pass http://app_backend;
    }
}
```

Atau jika certificate SAN mencakup `example.com` dan `www.example.com`, kedua host dapat berada pada server block yang sama. Keputusan tergantung kebutuhan redirect dan certificate management.

---

## 20. Domain Boundary untuk Java Backend

Aplikasi Java di belakang Nginx sering membuat keputusan berdasarkan host/scheme:

- generate absolute URL,
- redirect login,
- OAuth callback,
- SAML ACS URL,
- cookie domain,
- tenant resolution,
- email link generation,
- HATEOAS link,
- CORS origin comparison,
- CSRF origin validation,
- actuator exposure,
- multi-tenant routing.

Jika Nginx membiarkan host liar masuk, backend bisa ikut tercemar.

Contoh bug:

```java
String resetLink = request.getScheme() + "://" + request.getServerName() + "/reset?token=" + token;
```

Jika `Host` dikontrol attacker dan diteruskan ke backend, reset link dapat mengarah ke domain attacker.

Karena itu, boundary harus jelas:

```nginx
server {
    listen 443 ssl;
    server_name app.example.com;

    location / {
        proxy_set_header Host app.example.com;
        proxy_set_header X-Forwarded-Host app.example.com;
        proxy_set_header X-Forwarded-Proto https;
        proxy_pass http://app_backend;
    }
}
```

Atau jika multi-host valid:

```nginx
proxy_set_header Host $host;
proxy_set_header X-Forwarded-Host $host;
```

hanya setelah `server_name` membatasi host valid.

---

## 21. Server Selection dan Multi-Tenant SaaS

Misalnya sistem SaaS punya pola:

```text
{tenant}.saas.example.com
```

Nginx:

```nginx
server {
    listen 443 ssl;
    server_name ~^(?<tenant>[a-z0-9][a-z0-9-]{1,61}[a-z0-9])\.saas\.example\.com$;

    ssl_certificate     /etc/nginx/certs/wildcard.saas.example.com.crt;
    ssl_certificate_key /etc/nginx/certs/wildcard.saas.example.com.key;

    location / {
        proxy_set_header Host $host;
        proxy_set_header X-Tenant-Subdomain $tenant;
        proxy_pass http://saas_backend;
    }
}
```

Aplikasi Java tetap harus:

1. validasi tenant ada,
2. validasi tenant aktif,
3. validasi domain/subdomain belum di-reserve,
4. validasi user memang punya akses ke tenant,
5. jangan percaya `X-Tenant-Subdomain` dari client langsung.

Untuk poin kelima, Nginx harus overwrite header:

```nginx
proxy_set_header X-Tenant-Subdomain $tenant;
```

Bukan:

```nginx
proxy_set_header X-Tenant-Subdomain $http_x_tenant_subdomain;
```

Dan backend sebaiknya hanya mempercayai header itu dari trusted proxy network.

---

## 22. Reserved Hostnames

Dalam wildcard/multi-tenant system, beberapa host harus di-reserve:

```text
www
api
admin
internal
support
status
static
assets
cdn
mail
smtp
imap
login
auth
sso
billing
security
```

Jika tidak, tenant dapat mendaftarkan subdomain yang bentrok dengan fungsi platform.

Nginx bisa memisahkan reserved domain:

```nginx
server {
    listen 443 ssl;
    server_name api.saas.example.com;

    location / {
        proxy_pass http://api_backend;
    }
}

server {
    listen 443 ssl;
    server_name admin.saas.example.com;

    location / {
        proxy_pass http://admin_backend;
    }
}

server {
    listen 443 ssl;
    server_name ~^(?<tenant>[a-z0-9][a-z0-9-]{1,61}[a-z0-9])\.saas\.example\.com$;

    location / {
        proxy_pass http://tenant_backend;
    }
}
```

Karena exact match lebih prioritas daripada regex, `api.saas.example.com` akan masuk server khusus, bukan regex tenant.

Namun jangan hanya mengandalkan Nginx. Registry tenant juga harus menolak reserved names.

---

## 23. `server_name` Regex Order Trap

Jika ada beberapa regex server name, urutan bisa menentukan hasil.

Contoh:

```nginx
server {
    listen 80;
    server_name ~^(.+)\.example\.com$;
}

server {
    listen 80;
    server_name ~^admin\.(.+)\.example\.com$;
}
```

Regex pertama terlalu umum dan dapat menangkap host yang seharusnya ditangani regex kedua.

Lebih baik:

1. gunakan exact untuk host penting,
2. gunakan regex spesifik sebelum regex umum,
3. hindari banyak regex server jika bisa,
4. dokumentasikan precedence.

---

## 24. Separate Public, Internal, and Admin Boundaries

Salah satu kesalahan arsitektur adalah mencampur public app, internal API, dan admin UI dalam default routing yang terlalu luas.

Contoh buruk:

```nginx
server {
    listen 443 ssl default_server;
    server_name _;

    location / {
        proxy_pass http://main_backend;
    }
}
```

Ini berarti semua host unknown masuk ke main backend.

Lebih baik:

```nginx
server {
    listen 443 ssl default_server;
    server_name _;

    ssl_certificate     /etc/nginx/certs/default.crt;
    ssl_certificate_key /etc/nginx/certs/default.key;

    return 444;
}

server {
    listen 443 ssl;
    server_name app.example.com;

    location / {
        proxy_pass http://app_backend;
    }
}

server {
    listen 443 ssl;
    server_name admin.example.com;

    allow 203.0.113.0/24;
    deny all;

    location / {
        proxy_pass http://admin_backend;
    }
}
```

Boundary harus eksplisit.

---

## 25. Server Selection Decision Table

Misal konfigurasi:

```nginx
server {
    listen 80 default_server;
    server_name _;
    return 444;
}

server {
    listen 80;
    server_name example.com www.example.com;
    return 301 https://example.com$request_uri;
}

server {
    listen 80;
    server_name api.example.com;
    location / { proxy_pass http://api_backend; }
}
```

Decision table:

| Destination | Host Header | Selected Server | Result |
|---|---|---|---|
| `:80` | `example.com` | canonical redirect server | 301 to `https://example.com...` |
| `:80` | `www.example.com` | canonical redirect server | 301 to `https://example.com...` |
| `:80` | `api.example.com` | API server | proxy to API |
| `:80` | `unknown.example.com` | default server | close/reject |
| `:80` | absent | default server | close/reject |

Decision table seperti ini sangat berguna saat review config.

---

## 26. Debugging Server Selection

### 26.1 Lihat Effective Config

```bash
nginx -T
```

Ini menampilkan konfigurasi gabungan setelah semua include.

Gunakan untuk menjawab:

- server block mana yang muncul duluan,
- apakah `default_server` eksplisit,
- apakah ada duplicate `server_name`,
- apakah ada config dari package default yang masih aktif.

### 26.2 Test Config Validity

```bash
nginx -t
```

Ini hanya memastikan syntax valid, bukan memastikan routing benar.

Config bisa syntactically valid tetapi secara routing salah.

### 26.3 Test Host Header

```bash
curl -v -H 'Host: app.example.com' http://127.0.0.1/
```

Test unknown host:

```bash
curl -v -H 'Host: unknown.example.com' http://127.0.0.1/
```

Test tanpa DNS:

```bash
curl -v --resolve app.example.com:80:127.0.0.1 http://app.example.com/
```

Untuk HTTPS:

```bash
curl -vk --resolve app.example.com:443:127.0.0.1 https://app.example.com/
```

`--resolve` berguna karena ia mengatur DNS mapping sementara di curl, sambil tetap mengirim Host/SNI yang benar.

### 26.4 Test SNI dengan OpenSSL

```bash
openssl s_client -connect 127.0.0.1:443 -servername app.example.com
```

Lihat certificate yang diberikan.

Tanpa SNI:

```bash
openssl s_client -connect 127.0.0.1:443
```

Ini membantu melihat default certificate.

### 26.5 Tambahkan Debug Header Sementara

Di non-production atau environment aman:

```nginx
add_header X-Debug-Server-Name $server_name always;
add_header X-Debug-Host $host always;
```

Jangan expose debug header semacam ini di production publik tanpa alasan kuat.

---

## 27. Logging untuk Server Selection

Buat log format yang membantu:

```nginx
log_format main_ext '$remote_addr - $host [$time_local] '
                    '"$request" $status $body_bytes_sent '
                    'server="$server_name" '
                    'http_host="$http_host" '
                    'request_time=$request_time';

access_log /var/log/nginx/access.log main_ext;
```

Dengan log ini, saat ada request masuk domain salah, kamu dapat melihat:

```text
host="unknown.example.com" server="_" http_host="unknown.example.com"
```

atau:

```text
host="api.example.com" server="api.example.com" http_host="api.example.com"
```

Untuk HTTPS, informasi SNI tidak selalu otomatis tersedia dalam access log HTTP standar dengan variable umum di semua build. Kalau perlu korelasi TLS lebih dalam, gunakan error log/debug log, stream log, atau observability di load balancer/CDN layer.

---

## 28. Common Production Bugs

### Bug 1 — Default Server Tidak Eksplisit

Gejala:

- unknown host masuk ke aplikasi utama,
- redirect domain asing,
- scanner traffic membanjiri backend.

Penyebab:

```nginx
server {
    listen 80;
    server_name app.example.com;
}
```

tanpa catch-all default.

Solusi:

```nginx
server {
    listen 80 default_server;
    server_name _;
    return 444;
}
```

---

### Bug 2 — Redirect Menggunakan `$host` di Catch-All

Gejala:

- open redirect-like behavior,
- security scanner menemukan redirect ke arbitrary host.

Penyebab:

```nginx
return 301 https://$host$request_uri;
```

Solusi:

Gunakan literal canonical host pada server block yang memang host-nya valid.

```nginx
return 301 https://example.com$request_uri;
```

---

### Bug 3 — Duplicate `server_name`

Gejala:

- config reload warning,
- salah satu server name ignored,
- route masuk server block yang tidak diharapkan.

Contoh:

```nginx
server {
    listen 80;
    server_name api.example.com;
}

server {
    listen 80;
    server_name api.example.com;
}
```

Solusi:

- cari duplicate dengan `nginx -T`,
- rapikan include,
- gunakan satu owner per hostname.

---

### Bug 4 — HTTPS Certificate Salah Karena Default Server

Gejala:

- browser menampilkan certificate mismatch,
- curl melihat certificate domain lain,
- hanya terjadi untuk client tertentu.

Penyebab:

- client tidak mengirim SNI,
- SNI tidak cocok,
- default SSL server memakai certificate domain lain,
- `listen 443 ssl default_server` tidak sesuai.

Solusi:

- definisikan default SSL server secara sadar,
- test dengan `openssl s_client`,
- pastikan certificate setiap server block benar.

---

### Bug 5 — Internal Domain Terkena Public Wildcard

Gejala:

- `admin.example.com` masuk tenant backend,
- internal hostname diekspos.

Penyebab:

```nginx
server_name *.example.com;
```

terlalu luas.

Solusi:

- exact server untuk reserved names,
- catch-all reject,
- tenant regex lebih ketat,
- validasi reserved names di application registry.

---

## 29. Production Pattern: Safe Public HTTP/HTTPS Skeleton

Berikut skeleton yang cukup aman sebagai fondasi.

```nginx
# HTTP catch-all: reject unknown hosts
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    return 444;
}

# HTTPS catch-all: reject unknown hosts
server {
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;
    server_name _;

    ssl_certificate     /etc/nginx/certs/default.crt;
    ssl_certificate_key /etc/nginx/certs/default.key;

    return 444;
}

# HTTP known app host: redirect to HTTPS canonical
server {
    listen 80;
    listen [::]:80;
    server_name app.example.com;

    return 301 https://app.example.com$request_uri;
}

# HTTPS app host
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name app.example.com;

    ssl_certificate     /etc/nginx/certs/app.example.com.crt;
    ssl_certificate_key /etc/nginx/certs/app.example.com.key;

    location / {
        proxy_set_header Host app.example.com;
        proxy_set_header X-Forwarded-Host app.example.com;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Port 443;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        proxy_pass http://app_backend;
    }
}
```

Catatan:

- Di sistem multi-domain valid, `Host $host` bisa dipakai, tetapi hanya di server block yang membatasi `server_name` dengan baik.
- Untuk environment di balik cloud load balancer, port/proto forwarding harus disesuaikan dengan kontrak upstream.
- Untuk Kubernetes Ingress, pola ini tetap relevan secara mental model meskipun config tidak ditulis langsung sebagai `server` block manual.

---

## 30. Pattern: API dan Frontend Terpisah

```nginx
server {
    listen 443 ssl;
    server_name www.example.com example.com;

    ssl_certificate     /etc/nginx/certs/www.crt;
    ssl_certificate_key /etc/nginx/certs/www.key;

    location / {
        root /var/www/frontend;
        try_files $uri $uri/ /index.html;
    }
}

server {
    listen 443 ssl;
    server_name api.example.com;

    ssl_certificate     /etc/nginx/certs/api.crt;
    ssl_certificate_key /etc/nginx/certs/api.key;

    location / {
        proxy_set_header Host api.example.com;
        proxy_set_header X-Forwarded-Host api.example.com;
        proxy_set_header X-Forwarded-Proto https;
        proxy_pass http://api_backend;
    }
}
```

Keuntungan:

- frontend dan API punya boundary jelas,
- logging mudah dipisahkan,
- rate limit bisa berbeda,
- security headers bisa berbeda,
- deployment bisa berbeda,
- cache policy bisa berbeda.

---

## 31. Pattern: Admin Domain dengan Boundary Lebih Ketat

```nginx
server {
    listen 443 ssl;
    server_name admin.example.com;

    ssl_certificate     /etc/nginx/certs/admin.crt;
    ssl_certificate_key /etc/nginx/certs/admin.key;

    allow 203.0.113.0/24;
    deny all;

    location / {
        proxy_set_header Host admin.example.com;
        proxy_set_header X-Forwarded-Host admin.example.com;
        proxy_set_header X-Forwarded-Proto https;
        proxy_pass http://admin_backend;
    }
}
```

Untuk admin, pertanyaan desain yang perlu dijawab:

- apakah boleh public internet?
- apakah harus VPN?
- apakah IP allowlist cukup?
- apakah tetap perlu identity-aware proxy?
- apakah backend admin menolak request jika Host bukan `admin.example.com`?
- apakah log admin dipisah?

Jangan menganggap `server_name admin.example.com` sebagai kontrol keamanan penuh. Itu hanya host routing.

---

## 32. Pattern: Unknown Host Sink dengan Logging

Kadang kamu ingin menolak unknown host tetapi tetap mencatatnya.

```nginx
server {
    listen 80 default_server;
    listen 443 ssl default_server;
    server_name _;

    ssl_certificate     /etc/nginx/certs/default.crt;
    ssl_certificate_key /etc/nginx/certs/default.key;

    access_log /var/log/nginx/unknown-host-access.log main_ext;

    return 404;
}
```

Kapan `404` lebih baik daripada `444`?

- saat butuh visibility,
- saat di balik load balancer yang tidak suka connection close abnormal,
- saat ingin observability konsisten,
- saat ingin security scanner mendapat HTTP response eksplisit.

Kapan `444` berguna?

- untuk drop scanner/noise,
- untuk mengurangi response overhead,
- untuk public internet edge yang memang ingin silent reject.

Pilih berdasarkan operability, bukan dogma.

---

## 33. Interaction dengan Cloud Load Balancer dan CDN

Dalam arsitektur modern, Nginx sering tidak langsung menerima traffic dari browser. Bisa ada layer:

```text
Client
  -> CDN
  -> Cloud Load Balancer
  -> Nginx
  -> Java app
```

Maka Nginx melihat:

- source IP = load balancer/CDN,
- Host header mungkin asli, mungkin dimodifikasi,
- TLS mungkin terminated di CDN/LB,
- request ke Nginx bisa HTTP plaintext internal,
- SNI mungkin hanya antara CDN/LB dan Nginx.

Kontrak yang harus jelas:

```text
Who terminates public TLS?
Who owns canonical host redirect?
Who validates allowed hostnames?
Who sets X-Forwarded-Proto?
Who sets X-Forwarded-Host?
Who is trusted to set client IP?
Who rejects unknown domains?
```

Jika semua layer merasa “itu tanggung jawab layer lain”, maka unknown host bisa sampai ke app.

---

## 34. Interaction dengan Kubernetes Ingress

Di Kubernetes, kamu mungkin tidak menulis `server` block langsung. Tetapi Ingress tetap memiliki konsep host routing.

Contoh konseptual:

```yaml
rules:
  - host: api.example.com
    http:
      paths:
        - path: /
          backend:
            service:
              name: api-service
              port:
                number: 8080
```

Mental model tetap sama:

```text
listen address -> host match -> path match -> service backend
```

Hal yang perlu dicek:

- default backend untuk unknown host,
- TLS secret per host,
- wildcard ingress,
- duplicate host antar namespace,
- ingress class,
- redirect behavior,
- forwarded headers,
- load balancer health checks.

Nginx Ingress Controller menghasilkan konfigurasi Nginx dari resource Kubernetes. Walaupun abstraksinya berbeda, failure mode server selection tetap relevan.

---

## 35. Threat Model: Host Header Attack

Host header dapat dipakai untuk menyerang sistem yang mempercayainya.

Risiko:

1. Password reset poisoning.
2. Cache poisoning.
3. Open redirect.
4. SSRF-like routing confusion di internal proxy chain.
5. Tenant confusion.
6. Wrong OAuth callback.
7. Cookie domain confusion.
8. Security header bypass di domain berbeda.
9. Log pollution.

Defense berlapis:

```text
Layer 1: DNS hygiene
Layer 2: CDN/LB allowed host filtering
Layer 3: Nginx explicit server_name + default reject
Layer 4: proxy_set_header Host policy
Layer 5: Java framework forwarded header config
Layer 6: application-level allowed host validation
Layer 7: tenant registry validation
```

Untuk sistem penting, jangan hanya punya satu lapis.

---

## 36. Java/Spring Boot Specific Considerations

Jika Spring Boot berada di belakang Nginx, behavior URL generation dipengaruhi oleh forwarded headers.

Typical Nginx config:

```nginx
proxy_set_header Host $host;
proxy_set_header X-Forwarded-Host $host;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Port $server_port;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

Tetapi untuk HTTPS-terminated Nginx yang proxy ke HTTP upstream:

```nginx
proxy_set_header X-Forwarded-Proto https;
proxy_set_header X-Forwarded-Port 443;
```

Jika memakai `$scheme` di server HTTPS, `$scheme` adalah `https`. Jika Nginx menerima HTTP dari upstream load balancer tetapi original client HTTPS, `$scheme` bisa `http`, sehingga harus mengambil kontrak dari LB secara hati-hati.

Di Spring Boot, kamu perlu mengatur forwarded header handling sesuai versi dan stack yang digunakan. Namun prinsipnya:

> Backend hanya boleh mempercayai forwarded headers dari trusted proxy, bukan dari client langsung.

Di Nginx, pastikan header dari client dioverwrite, bukan diteruskan begitu saja.

---

## 37. Checklist Desain Server Selection

Gunakan checklist ini saat membuat atau mereview Nginx config.

### 37.1 Address and Port

- Apakah setiap `listen` jelas untuk IPv4/IPv6?
- Apakah HTTP dan HTTPS dipisah dengan benar?
- Apakah ada `default_server` untuk setiap address penting?
- Apakah ada leftover config dari package default?

### 37.2 Hostname

- Apakah semua domain valid didefinisikan eksplisit?
- Apakah wildcard benar-benar dibutuhkan?
- Apakah regex terlalu luas?
- Apakah reserved hostnames dipisahkan?
- Apakah duplicate `server_name` sudah dicek?

### 37.3 Unknown Host

- Apa yang terjadi jika Host unknown?
- Apa yang terjadi jika Host kosong?
- Apa yang terjadi jika Host berisi port?
- Apa yang terjadi jika Host casing aneh?
- Apa yang terjadi jika Host valid tapi SNI beda?

### 37.4 TLS

- Apakah default HTTPS server punya certificate yang sesuai?
- Apakah setiap HTTPS server punya certificate benar?
- Apakah SNI diuji?
- Apakah HTTP to HTTPS redirect hanya untuk host valid?

### 37.5 Proxy Contract

- Header `Host` apa yang dikirim ke Java backend?
- Apakah `X-Forwarded-Host` dikirim?
- Apakah proto dan port benar?
- Apakah backend punya allowed host validation?
- Apakah tenant resolution aman?

### 37.6 Observability

- Apakah access log mencatat `$host`, `$http_host`, `$server_name`?
- Apakah unknown host punya log terpisah?
- Apakah redirect bisa diaudit?
- Apakah certificate mismatch bisa didiagnosis?

---

## 38. Exercises

### Exercise 1 — Predict Server Selection

Konfigurasi:

```nginx
server {
    listen 80;
    server_name app.example.com;
    return 200 "app";
}

server {
    listen 80;
    server_name api.example.com;
    return 200 "api";
}
```

Request:

```bash
curl -H 'Host: unknown.example.com' http://127.0.0.1/
```

Pertanyaan:

- server mana yang dipilih?
- kenapa?
- apa risiko production dari konfigurasi ini?
- bagaimana memperbaikinya?

Jawaban inti:

- server pertama untuk `listen 80` menjadi default implisit,
- request unknown masuk ke `app.example.com`,
- risiko unknown host masuk app,
- tambahkan explicit default server.

---

### Exercise 2 — Design Safe Redirect

Requirement:

```text
example.com dan www.example.com harus redirect ke https://example.com.
Semua host lain harus ditolak.
```

Tulis server block HTTP yang aman.

Solusi:

```nginx
server {
    listen 80 default_server;
    server_name _;
    return 444;
}

server {
    listen 80;
    server_name example.com www.example.com;
    return 301 https://example.com$request_uri;
}
```

---

### Exercise 3 — Debug Certificate Mismatch

Gejala:

```text
curl https://api.example.com kadang melihat certificate admin.example.com.
```

Kemungkinan penyebab:

- SNI tidak terkirim oleh client tertentu,
- default SSL server menggunakan certificate admin,
- `server_name` salah,
- duplicate listen/default,
- traffic melewati load balancer yang mengubah SNI.

Command diagnosis:

```bash
openssl s_client -connect <ip>:443 -servername api.example.com
openssl s_client -connect <ip>:443
nginx -T
```

---

### Exercise 4 — Multi-Tenant Boundary

Requirement:

```text
Tenant valid: {tenant}.saas.example.com
Reserved: api, admin, www, support
```

Pertanyaan:

- mana yang ditangani exact server?
- mana yang ditangani regex tenant?
- validasi apa yang tetap harus dilakukan backend?

Jawaban inti:

- `api/admin/www/support` harus exact atau ditolak sebelum regex tenant,
- regex tenant hanya routing awal,
- backend validasi tenant registry, status, akses user, reserved name.

---

## 39. Production Review Template

Gunakan template ini untuk review PR Nginx terkait server selection.

```text
Change summary:
- Added/changed hostnames:
- Added/changed listen ports:
- Added/changed TLS certs:
- Added/changed redirects:

Expected valid hosts:
- host 1:
- host 2:

Expected invalid host behavior:
- HTTP unknown:
- HTTPS unknown:
- empty Host:
- SNI mismatch:

Proxy contract:
- Host sent upstream:
- X-Forwarded-Host:
- X-Forwarded-Proto:
- X-Forwarded-Port:

Tests performed:
- nginx -t:
- nginx -T reviewed:
- curl --resolve valid host:
- curl unknown host:
- openssl s_client with SNI:
- openssl s_client without SNI:

Rollback plan:
- previous config path:
- reload command:
- validation after rollback:
```

---

## 40. Key Invariants

Pegang invariants ini:

1. **`listen` menentukan kandidat server berdasarkan IP/port.**
2. **`server_name` memilih virtual server berdasarkan Host/SNI dalam kandidat address.**
3. **`default_server` adalah fallback per listen address.**
4. **`server_name _;` bukan catch-all magic.**
5. **Jika tidak ada default eksplisit, server pertama menjadi default implisit.**
6. **Host header dapat dikontrol client.**
7. **SNI dan Host idealnya sama, tetapi bisa berbeda.**
8. **HTTPS default server tetap butuh certificate.**
9. **Jangan redirect unknown host menggunakan `$host`.**
10. **Jangan biarkan unknown host masuk ke Java backend.**
11. **Wildcard dan regex memperluas boundary; backend tetap harus validasi domain/tenant.**
12. **Server selection harus bisa dijelaskan dengan decision table.**

---

## 41. Ringkasan

Pada bagian ini, kita membahas bahwa server selection adalah tahap awal routing Nginx sebelum `location` dan `proxy_pass`.

Nginx memilih server berdasarkan:

```text
listen address -> SNI/Host -> server_name -> default_server
```

Kesalahan di tahap ini dapat menyebabkan:

- request masuk aplikasi yang salah,
- certificate mismatch,
- host header attack,
- open redirect behavior,
- tenant confusion,
- backend Java menerima boundary yang tidak valid.

Production-grade Nginx config harus selalu memiliki:

- explicit default server,
- known-host-only redirect,
- clear TLS certificate mapping,
- strict wildcard/regex usage,
- safe proxy Host contract,
- observability untuk `$host`, `$http_host`, dan `$server_name`.

---

## 42. Apa yang Akan Dibahas Selanjutnya

Di Part 005, kita akan masuk ke:

# Part 005 — Location Matching Deep Dive

Kita akan membahas bagaimana Nginx memilih `location` di dalam server block yang sudah terpilih:

- exact location,
- prefix location,
- `^~`,
- regex location,
- precedence,
- `try_files`,
- internal redirect,
- SPA route trap,
- API/static path collision,
- production routing decision tree.

Jika Part 004 menjawab:

> “Domain ini masuk server block mana?”

maka Part 005 menjawab:

> “Setelah server block dipilih, URI ini masuk handler mana?”

---

## Status Seri

- Part 000: selesai
- Part 001: selesai
- Part 002: selesai
- Part 003: selesai
- Part 004: selesai
- Part 005: berikutnya

Seri belum selesai. Masih ada bagian 005 sampai 030.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-nginx-mastery-for-java-engineers-part-003.md">⬅️ Part 003 — Configuration Grammar: Directives, Contexts, Inheritance, and Evaluation Order</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-nginx-mastery-for-java-engineers-part-005.md">Part 005 — Location Matching Deep Dive ➡️</a>
</div>
