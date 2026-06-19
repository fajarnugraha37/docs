# learn-nginx-mastery-for-java-engineers-part-016.md

# Part 016 — Rate Limiting, Connection Limiting, and Abuse Resistance

> Seri: `learn-nginx-mastery-for-java-engineers`  
> Bagian: `016 / 030`  
> Fokus: membangun proteksi traffic di Nginx menggunakan rate limit, connection limit, shared memory zone, burst, key design, status code, observability, dan integrasi dengan aplikasi Java.

---

## 0. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Memahami **apa yang sebenarnya dibatasi** oleh Nginx ketika menggunakan `limit_req` dan `limit_conn`.
2. Mendesain rate limit bukan sebagai “tambahan security”, tetapi sebagai bagian dari **traffic control layer**.
3. Memilih limit key yang benar: IP, user id, API key, tenant id, route class, atau kombinasi variabel.
4. Memahami perbedaan antara:
   - request rate limiting,
   - concurrent connection limiting,
   - application quota,
   - WAF rule,
   - circuit breaker,
   - load shedding.
5. Menghindari false positive, terutama untuk user di belakang NAT, corporate proxy, mobile carrier, CDN, atau load balancer.
6. Menghubungkan rate limiting Nginx dengan aplikasi Java, database, thread pool, queue, dan downstream dependency.
7. Membuat konfigurasi rate limiting yang observable, auditable, dan bisa dioperasikan saat incident.

---

## 1. Mental Model: Rate Limiting Bukan Sekadar “Mencegah Orang Jahat”

Banyak engineer pertama kali mengenal rate limiting sebagai fitur security:

> “Batasi IP agar tidak brute force login.”

Itu benar, tapi terlalu sempit.

Dalam production system, rate limiting adalah mekanisme untuk menjawab pertanyaan yang lebih fundamental:

> “Ketika demand lebih besar daripada capacity, siapa yang boleh masuk, siapa yang harus menunggu, dan siapa yang harus ditolak?”

Nginx berada di posisi ideal untuk menjawab sebagian pertanyaan itu karena ia duduk di depan aplikasi.

```text
Client / Bot / Browser / Mobile App
        |
        v
+-------------------+
|       Nginx       |  <-- traffic admission control
+-------------------+
        |
        v
+-------------------+
|   Java Backend    |  <-- business logic, auth, quota, transaction
+-------------------+
        |
        v
+-------------------+
| Database / Queue  |
+-------------------+
```

Rate limiting di Nginx sebaiknya dipahami sebagai **admission control**.

Artinya:

- tidak semua request layak diteruskan ke aplikasi;
- tidak semua client boleh menggunakan capacity secara sama;
- tidak semua endpoint punya biaya yang sama;
- tidak semua lonjakan traffic harus diserap oleh aplikasi Java;
- sebagian request lebih baik ditolak cepat daripada membuat sistem collapse lambat.

---

## 2. Masalah yang Diselesaikan oleh Rate Limiting

Rate limiting membantu mengatasi beberapa kelas masalah.

### 2.1 Abuse dan brute force

Contoh:

- login brute force;
- OTP resend spam;
- password reset spam;
- scraping;
- credential stuffing;
- API token abuse.

Di sini rate limiting berfungsi sebagai rem awal sebelum request masuk ke aplikasi.

### 2.2 Resource exhaustion

Contoh:

- endpoint export CSV mahal;
- endpoint report melakukan query berat;
- upload besar;
- search endpoint mahal;
- endpoint yang memicu downstream call ke service lain.

Di sini rate limiting melindungi CPU, memory, database connection, thread pool, dan downstream service.

### 2.3 Traffic fairness

Tanpa limit, satu client agresif bisa menghabiskan capacity semua user lain.

```text
Bad client:  10,000 req/min
Normal user:     10 req/min
Normal user:     12 req/min
Normal user:      8 req/min
```

Kalau semua masuk ke Java backend, backend tidak tahu dari awal mana traffic yang harus diprioritaskan. Nginx bisa membantu menahan client agresif sebelum membebani sistem.

### 2.4 Failure containment

Ketika backend melambat, request akan menumpuk.

Request yang menumpuk menyebabkan:

- worker connection naik;
- upstream connection naik;
- thread pool Java penuh;
- queue internal membengkak;
- database connection pool habis;
- retry dari client semakin agresif;
- latency makin panjang;
- akhirnya semua user terdampak.

Rate limiting bukan solusi tunggal, tapi bisa menjadi bagian dari strategi containment.

### 2.5 Cost control

Di cloud, traffic yang tidak dibatasi bisa menghasilkan biaya:

- bandwidth;
- compute;
- logging;
- database read/write;
- third-party API usage;
- observability ingestion.

Nginx rate limiting bisa mengurangi request yang jelas tidak layak diproses.

---

## 3. Rate Limiting vs Connection Limiting

Nginx punya dua primitive utama yang sering dipakai:

1. `limit_req` untuk membatasi **request rate**.
2. `limit_conn` untuk membatasi **jumlah koneksi aktif**.

Keduanya berbeda.

---

## 4. `limit_req`: Membatasi Laju Request

`limit_req` menjawab pertanyaan:

> “Berapa banyak request per satuan waktu yang boleh diterima untuk key tertentu?”

Contoh:

```nginx
http {
    limit_req_zone $binary_remote_addr zone=per_ip_api:10m rate=10r/s;

    server {
        location /api/ {
            limit_req zone=per_ip_api burst=20 nodelay;
            proxy_pass http://app_backend;
        }
    }
}
```

Artinya:

- setiap client IP memiliki bucket limit;
- rate normal: 10 request per detik;
- burst sampai 20 request;
- `nodelay` membuat burst tidak ditunda, tetapi diterima selama masih dalam burst allowance;
- setelah melebihi rate + burst, request ditolak.

---

## 5. `limit_req_zone`: Tempat Menyimpan State Limit

Directive utama:

```nginx
limit_req_zone <key> zone=<name>:<size> rate=<rate>;
```

Contoh:

```nginx
limit_req_zone $binary_remote_addr zone=login_ip:10m rate=5r/m;
```

Komponennya:

| Komponen | Makna |
|---|---|
| `$binary_remote_addr` | key limit, biasanya IP client dalam format compact binary |
| `zone=login_ip:10m` | shared memory zone bernama `login_ip` dengan ukuran 10 MB |
| `rate=5r/m` | rate 5 request per menit per key |

Shared memory zone penting karena Nginx punya banyak worker. State limit harus bisa dibaca bersama oleh worker.

```text
Worker 1 ----+
Worker 2 ----+--> shared memory zone: login_ip
Worker 3 ----+
Worker 4 ----+
```

Kalau state limit tidak shared, tiap worker akan punya hitungan sendiri dan limit menjadi tidak konsisten.

---

## 6. Mengapa Sering Menggunakan `$binary_remote_addr`, Bukan `$remote_addr`

Kamu sering melihat:

```nginx
limit_req_zone $binary_remote_addr zone=per_ip:10m rate=10r/s;
```

Bukan:

```nginx
limit_req_zone $remote_addr zone=per_ip:10m rate=10r/s;
```

Alasannya: `$binary_remote_addr` lebih compact untuk disimpan di shared memory.

- IPv4 binary: 4 bytes.
- IPv6 binary: 16 bytes.
- textual IP string bisa jauh lebih panjang.

Untuk shared memory zone yang menyimpan banyak key, ukuran key penting.

---

## 7. Rate Unit: `r/s` vs `r/m`

Nginx mendukung rate seperti:

```nginx
rate=10r/s
rate=60r/m
```

Interpretasi penting:

- `10r/s` bukan berarti tepat setiap 100 ms boleh satu request secara mutlak terlihat oleh user;
- Nginx menggunakan algoritma leaky bucket style untuk menghitung kelebihan request;
- burst menentukan toleransi lonjakan sesaat.

Untuk endpoint manusia seperti login, `r/m` sering lebih masuk akal.

Contoh:

```nginx
limit_req_zone $binary_remote_addr zone=login_ip:10m rate=5r/m;
```

Untuk API machine-to-machine, `r/s` mungkin lebih cocok.

Contoh:

```nginx
limit_req_zone $http_x_api_key zone=api_key:20m rate=100r/s;
```

---

## 8. `burst`: Menoleransi Lonjakan Sesaat

Tanpa burst:

```nginx
limit_req zone=per_ip;
```

Request yang datang terlalu cepat akan segera ditolak.

Dengan burst:

```nginx
limit_req zone=per_ip burst=20;
```

Nginx memberi ruang untuk lonjakan sesaat.

Mental model sederhana:

```text
Rate normal: 10 r/s
Burst:       20 request ekstra
```

Kalau client mengirim 30 request hampir bersamaan:

- sebagian bisa diterima sesuai rate;
- sebagian masuk burst queue;
- sisanya ditolak setelah burst penuh.

---

## 9. `nodelay`: Jangan Menunda Burst

Default behavior dengan burst tanpa `nodelay` dapat menyebabkan Nginx menunda request agar laju efektif tetap sesuai rate.

```nginx
limit_req zone=per_ip burst=20;
```

Dengan `nodelay`:

```nginx
limit_req zone=per_ip burst=20 nodelay;
```

Request burst yang masih diperbolehkan akan diteruskan segera, bukan ditunda.

### 9.1 Kapan memakai `nodelay`

Cocok untuk:

- browser traffic yang natural burst karena loading halaman;
- API yang latency-sensitive;
- request yang tidak ingin ditahan di Nginx;
- sistem yang lebih suka reject cepat daripada queue diam-diam.

### 9.2 Kapan tidak memakai `nodelay`

Tanpa `nodelay`, Nginx bisa membantu smoothing traffic.

Cocok untuk:

- backend yang sensitif terhadap spike;
- endpoint non-interactive;
- traffic batch ringan;
- use case di mana delay kecil lebih baik daripada rejection.

Namun hati-hati: queue/delay di Nginx bisa membuat latency meningkat dan menyamarkan overload.

---

## 10. `delay`: Mode Tengah antara Queue dan Nodelay

Versi Nginx modern mendukung parameter `delay` pada `limit_req`.

Contoh:

```nginx
limit_req zone=per_ip burst=20 delay=10;
```

Maknanya secara praktis:

- sebagian burst awal tidak ditunda;
- request di atas threshold tertentu mulai ditunda;
- setelah burst penuh, request ditolak.

Ini berguna ketika kamu ingin memberi toleransi burst kecil tanpa langsung menunda semua kelebihan request.

---

## 11. `limit_conn`: Membatasi Koneksi Aktif

`limit_conn` menjawab pertanyaan berbeda:

> “Berapa banyak koneksi aktif yang boleh dimiliki key tertentu secara bersamaan?”

Contoh:

```nginx
http {
    limit_conn_zone $binary_remote_addr zone=conn_per_ip:10m;

    server {
        location /download/ {
            limit_conn conn_per_ip 2;
            root /srv/files;
        }
    }
}
```

Artinya:

- satu IP hanya boleh punya 2 koneksi aktif ke `/download/`;
- koneksi ketiga bisa ditolak.

Ini cocok untuk:

- download besar;
- upload besar;
- streaming;
- endpoint long polling;
- endpoint yang rawan connection hoarding.

---

## 12. Request Rate vs Concurrent Connection

Perbedaan kritis:

| Aspek | `limit_req` | `limit_conn` |
|---|---|---|
| Yang dibatasi | jumlah request per waktu | jumlah koneksi aktif |
| Cocok untuk | API, login, search, form submit | download, upload, streaming, slow client |
| Risiko jika salah | user normal kena 429 | client legitimate dengan banyak tab bisa kena limit |
| Key umum | IP, API key, user id | IP, server name, tenant |

Contoh client yang mengirim 100 request sangat cepat tapi setiap request selesai cepat:

- `limit_req` akan bereaksi;
- `limit_conn` mungkin tidak bereaksi karena koneksi aktif tidak banyak.

Contoh client membuka 5 koneksi download besar tetapi request rate rendah:

- `limit_req` mungkin tidak bereaksi;
- `limit_conn` akan bereaksi.

---

## 13. Rate Limiting Bukan Quota Bisnis

Ini penting untuk backend engineer.

Nginx rate limiting bersifat teknis dan lokal terhadap traffic layer.

Contoh quota bisnis:

- free plan hanya boleh 10,000 API calls per bulan;
- tenant enterprise boleh 1,000,000 calls per hari;
- user hanya boleh generate 3 reports per jam;
- partner integration punya kontrak 500 RPS.

Quota seperti itu biasanya lebih cocok di aplikasi atau API gateway yang punya akses ke identity, subscription, tenant plan, dan persistent storage.

Nginx bisa membantu melakukan enforcement kasar, tapi tidak ideal sebagai source of truth quota bisnis.

```text
Nginx limit:
  - fast
  - local
  - memory-based
  - good for protection

Application quota:
  - identity-aware
  - business-aware
  - persistent
  - auditable
```

---

## 14. Memilih Key Rate Limit

Key adalah keputusan desain paling penting.

```nginx
limit_req_zone <key> zone=<name>:<size> rate=<rate>;
```

Kalau key salah, limit salah sasaran.

---

## 15. Key Berdasarkan IP Address

Contoh:

```nginx
limit_req_zone $binary_remote_addr zone=per_ip:10m rate=10r/s;
```

Kelebihan:

- mudah;
- tidak butuh auth;
- bisa melindungi endpoint publik;
- cocok untuk login, signup, password reset.

Kekurangan:

- NAT membuat banyak user berbagi IP;
- mobile carrier bisa punya IP bersama;
- corporate proxy bisa membuat ratusan user terlihat sebagai satu IP;
- attacker bisa rotate IP;
- kalau Nginx di belakang CDN/load balancer dan real IP tidak dikonfigurasi, yang terlihat hanya IP CDN/load balancer.

IP-based limit bagus sebagai lapisan kasar, bukan identitas absolut.

---

## 16. Key Berdasarkan API Key

Contoh:

```nginx
limit_req_zone $http_x_api_key zone=per_api_key:20m rate=100r/s;
```

Kelebihan:

- lebih adil untuk API client;
- satu client tidak mengganggu client lain;
- cocok untuk machine-to-machine API.

Kekurangan:

- header bisa kosong;
- header bisa dipalsukan kalau belum ada auth kuat;
- jika API key invalid, Nginx tetap belum tahu kecuali ada auth integration;
- key string panjang bisa memakan memory.

Untuk public API, key-based Nginx limit biasanya digabung dengan auth di aplikasi/gateway.

---

## 17. Key Berdasarkan User ID atau Tenant ID

Nginx sendiri tidak tahu user id kecuali user id dikirim lewat header yang dipercaya dari layer sebelumnya.

Contoh jika ada trusted gateway di depan:

```nginx
limit_req_zone $http_x_authenticated_user_id zone=per_user:20m rate=20r/s;
limit_req_zone $http_x_tenant_id zone=per_tenant:20m rate=500r/s;
```

Ini hanya aman jika:

- header tersebut diset oleh trusted component;
- client tidak bisa langsung mengirim header palsu;
- Nginx membersihkan header incoming sebelum menerima header dari auth layer;
- network topology menjamin trust boundary.

Jika client publik bisa langsung mengirim `X-Authenticated-User-Id`, maka limit bisa dibypass atau disalahgunakan.

---

## 18. Key Komposit

Kadang satu dimensi tidak cukup.

Contoh key gabungan IP + route class:

```nginx
limit_req_zone "$binary_remote_addr:$uri" zone=per_ip_uri:20m rate=5r/s;
```

Atau API key + method:

```nginx
limit_req_zone "$http_x_api_key:$request_method" zone=per_key_method:20m rate=50r/s;
```

Namun key komposit bisa meningkatkan cardinality.

Cardinality tinggi berarti:

- lebih banyak entry di shared memory;
- zone cepat penuh;
- eviction/limit behavior jadi lebih sulit diprediksi;
- observability lebih rumit.

Gunakan key komposit dengan hati-hati.

---

## 19. Shared Memory Zone Size

Contoh:

```nginx
limit_req_zone $binary_remote_addr zone=per_ip:10m rate=10r/s;
```

`10m` adalah ukuran memory zone.

Pertanyaan desain:

> Berapa banyak unique key yang harus bisa dilacak?

Kalau terlalu kecil:

- Nginx tidak bisa menyimpan state semua key;
- request baru bisa gagal karena zone penuh;
- behavior production menjadi membingungkan.

Kalau terlalu besar:

- memory terbuang;
- tapi biasanya ini lebih aman daripada terlalu kecil.

### 19.1 Estimasi praktis

Untuk IP-based limit, 10 MB sering cukup untuk puluhan ribu sampai ratusan ribu key tergantung arsitektur dan versi, tetapi jangan menghafal angka absolut.

Yang penting:

- ukur unique client/key;
- pantau error log;
- pantau rejected request;
- desain zone sesuai traffic peak, bukan average.

---

## 20. Endpoint Tidak Sama Mahal

Kesalahan umum:

```nginx
location /api/ {
    limit_req zone=api_per_ip burst=20 nodelay;
    proxy_pass http://app;
}
```

Ini memberi limit yang sama untuk semua endpoint API.

Padahal:

```text
GET /api/products              murah
GET /api/reports/export        mahal
POST /api/login                security sensitive
POST /api/orders               bisnis kritikal
GET /api/search?q=...          bisa mahal
POST /api/files/upload         body besar
```

Limit sebaiknya mengikuti cost dan risk endpoint.

---

## 21. Pattern: Public API Limit Bertingkat

Contoh:

```nginx
http {
    limit_req_zone $binary_remote_addr zone=public_ip_low:10m rate=30r/m;
    limit_req_zone $binary_remote_addr zone=public_ip_normal:10m rate=10r/s;
    limit_req_zone $http_x_api_key zone=public_api_key:20m rate=100r/s;

    server {
        location = /api/login {
            limit_req zone=public_ip_low burst=5 nodelay;
            proxy_pass http://app_backend;
        }

        location /api/search {
            limit_req zone=public_ip_normal burst=20 nodelay;
            proxy_pass http://app_backend;
        }

        location /api/partner/ {
            limit_req zone=public_api_key burst=200 nodelay;
            proxy_pass http://app_backend;
        }
    }
}
```

Di sini:

- login lebih ketat;
- search dibatasi per IP;
- partner API dibatasi per API key.

---

## 22. Pattern: Login Protection

Login adalah endpoint khusus.

Ia punya karakteristik:

- publik;
- CPU bisa mahal jika password hashing kuat;
- security-sensitive;
- brute force target;
- false positive berdampak langsung ke user.

Contoh:

```nginx
http {
    limit_req_zone $binary_remote_addr zone=login_ip:10m rate=5r/m;

    server {
        location = /login {
            limit_req zone=login_ip burst=10 nodelay;
            limit_req_status 429;

            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;

            proxy_pass http://auth_backend;
        }
    }
}
```

Tapi jangan berhenti di sini.

Aplikasi tetap perlu:

- account lockout yang hati-hati;
- device fingerprinting jika relevan;
- MFA;
- credential stuffing detection;
- per-account throttling;
- audit log;
- anomaly detection.

Nginx IP limit hanya lapisan awal.

---

## 23. Pattern: OTP Resend Protection

OTP resend rawan abuse karena bisa:

- membanjiri SMS/email provider;
- menimbulkan biaya;
- mengganggu user;
- digunakan untuk harassment.

Contoh:

```nginx
limit_req_zone $binary_remote_addr zone=otp_ip:10m rate=3r/m;

server {
    location = /api/auth/otp/resend {
        limit_req zone=otp_ip burst=3 nodelay;
        limit_req_status 429;
        proxy_pass http://auth_backend;
    }
}
```

Tetapi limit yang lebih benar biasanya per account/phone/email di aplikasi karena satu attacker bisa berganti IP.

---

## 24. Pattern: Download Connection Limit

Untuk download besar:

```nginx
http {
    limit_conn_zone $binary_remote_addr zone=download_conn_ip:10m;

    server {
        location /downloads/ {
            limit_conn download_conn_ip 2;
            limit_conn_status 429;

            root /srv/files;
        }
    }
}
```

Ini membatasi connection hoarding.

Jika user membuka 10 download paralel, hanya sebagian diterima.

---

## 25. Pattern: Upload Protection

Upload besar bisa membebani:

- bandwidth;
- disk temporary file;
- memory buffer;
- upstream app;
- storage backend.

Contoh:

```nginx
http {
    limit_conn_zone $binary_remote_addr zone=upload_conn_ip:10m;
    limit_req_zone $binary_remote_addr zone=upload_req_ip:10m rate=10r/m;

    server {
        client_max_body_size 20m;

        location /api/files/upload {
            limit_conn upload_conn_ip 2;
            limit_req zone=upload_req_ip burst=5 nodelay;

            proxy_request_buffering on;
            proxy_pass http://app_backend;
        }
    }
}
```

Catatan:

- `client_max_body_size` melindungi dari body terlalu besar;
- `limit_conn` membatasi upload paralel;
- `limit_req` membatasi frekuensi upload;
- aplikasi tetap harus validasi tipe file dan content.

---

## 26. Status Code untuk Rate Limited Request

Umumnya gunakan:

```nginx
limit_req_status 429;
limit_conn_status 429;
```

HTTP 429 berarti terlalu banyak request.

Contoh:

```nginx
location /api/ {
    limit_req zone=api_per_ip burst=20 nodelay;
    limit_req_status 429;
    proxy_pass http://app_backend;
}
```

Jangan asal menggunakan 403.

Perbedaan:

- `403 Forbidden`: request dilarang karena authorization/access policy.
- `429 Too Many Requests`: request ditolak karena laju/kuota sementara.
- `503 Service Unavailable`: kadang dipakai untuk overload, tapi untuk per-client throttling 429 lebih ekspresif.

Untuk API, response 429 memudahkan client melakukan backoff.

---

## 27. Menambahkan `Retry-After`

Nginx open source tidak otomatis selalu memberi `Retry-After` sesuai bucket state. Namun kamu bisa menambahkan header statis untuk endpoint tertentu.

Contoh:

```nginx
location = /api/login {
    limit_req zone=login_ip burst=5 nodelay;
    limit_req_status 429;
    add_header Retry-After 60 always;
    proxy_pass http://auth_backend;
}
```

Caveat:

- nilai statis bisa tidak akurat;
- tetap lebih baik daripada tidak ada sinyal sama sekali;
- untuk quota kompleks, aplikasi/API gateway lebih cocok memberi response kaya.

---

## 28. Custom Error Response

Default Nginx error page kurang cocok untuk API.

Contoh JSON response:

```nginx
server {
    error_page 429 = @rate_limited;

    location @rate_limited {
        default_type application/json;
        add_header Retry-After 60 always;
        return 429 '{"error":"rate_limited","message":"Too many requests"}';
    }

    location /api/ {
        limit_req zone=api_per_ip burst=20 nodelay;
        limit_req_status 429;
        proxy_pass http://app_backend;
    }
}
```

Ini membuat contract lebih jelas untuk API client.

---

## 29. Logging Rate Limited Request

Rate limiting tanpa observability berbahaya.

Kamu perlu tahu:

- siapa yang terkena limit;
- endpoint apa yang terkena limit;
- apakah limit terlalu ketat;
- apakah ada abuse;
- apakah user legitimate terdampak;
- apakah limit aktif saat incident.

Nginx menyediakan logging terkait limit lewat error log dan access log.

Contoh custom access log:

```nginx
log_format api_json escape=json
    '{'
    '"time":"$time_iso8601",'
    '"remote_addr":"$remote_addr",'
    '"request":"$request",'
    '"status":$status,'
    '"request_time":$request_time,'
    '"upstream_response_time":"$upstream_response_time",'
    '"http_user_agent":"$http_user_agent",'
    '"http_x_request_id":"$http_x_request_id"'
    '}';

access_log /var/log/nginx/api_access.log api_json;
```

Untuk rate limited request, status biasanya 429 sehingga bisa dihitung dari access log.

---

## 30. `limit_req_log_level`

Kamu bisa mengatur level log untuk rate limiting.

Contoh:

```nginx
limit_req_log_level warn;
```

Pilihan umum:

- `info`,
- `notice`,
- `warn`,
- `error`.

Jika traffic tinggi dan limit sering aktif, log level terlalu tinggi bisa membanjiri log ingestion.

Di production, pilih level yang membantu investigasi tanpa membuat biaya observability meledak.

---

## 31. Real IP: Fondasi IP-Based Limiting

Jika Nginx berada di belakang load balancer, CDN, atau reverse proxy lain, `$remote_addr` mungkin bukan IP user asli.

Contoh chain:

```text
User
  -> CDN
  -> Cloud Load Balancer
  -> Nginx
  -> Java App
```

Dari sudut pandang Nginx, remote address bisa jadi IP load balancer.

Kalau kamu melakukan ini:

```nginx
limit_req_zone $binary_remote_addr zone=per_ip:10m rate=10r/s;
```

Maka semua user mungkin dianggap satu IP load balancer.

Hasilnya:

- false positive massal;
- semua user kena limit;
- limit tidak berguna untuk abuse per user.

---

## 32. Menggunakan Real IP Module dengan Aman

Contoh:

```nginx
set_real_ip_from 10.0.0.0/8;
set_real_ip_from 192.168.0.0/16;
real_ip_header X-Forwarded-For;
real_ip_recursive on;
```

Namun ini sangat sensitif.

Jangan percaya `X-Forwarded-For` dari internet publik secara langsung.

Trust hanya boleh diberikan kepada proxy/load balancer yang benar-benar kamu kontrol.

```text
Benar:
Client -> Trusted LB -> Nginx
Nginx trusts X-Forwarded-For only from Trusted LB

Salah:
Client -> Nginx
Nginx trusts arbitrary X-Forwarded-For from client
```

Jika salah, attacker bisa memalsukan IP dan bypass limit.

---

## 33. Rate Limit di Belakang CDN

Jika menggunakan CDN seperti Cloudflare, Fastly, Akamai, atau cloud edge, ada beberapa pilihan:

1. Rate limit di CDN.
2. Rate limit di Nginx berdasarkan real client IP dari CDN header.
3. Rate limit di aplikasi berdasarkan user/API key.
4. Kombinasi semuanya.

Nginx harus dikonfigurasi agar hanya percaya header IP dari CDN IP ranges yang valid.

Masalahnya: IP ranges CDN bisa berubah. Ini perlu proses operasional untuk update.

---

## 34. NAT dan Corporate Proxy False Positive

IP-based limit punya blind spot besar.

Contoh:

```text
1 kantor besar -> 1 public IP -> 500 karyawan
```

Jika limit:

```nginx
rate=10r/s per IP
```

Maka 500 user berbagi 10 request/detik.

Ini bisa menghukum user legitimate.

Solusi:

- gunakan limit longgar untuk IP;
- kombinasikan dengan user/API-key limit di aplikasi;
- bedakan endpoint publik dan authenticated;
- observasi top IP yang terkena 429;
- whitelist hati-hati untuk partner tertentu;
- gunakan adaptive/risk-based controls di aplikasi.

---

## 35. Layered Rate Limiting

Desain matang biasanya punya beberapa lapisan.

```text
CDN / Edge:
  - volumetric abuse
  - bot filtering
  - geo/IP reputation

Nginx:
  - cheap admission control
  - per-IP/per-header technical limit
  - endpoint class protection

Application Java:
  - per-user quota
  - per-tenant quota
  - business rule
  - account-level abuse detection

Database / Downstream:
  - connection pool
  - query timeout
  - circuit breaker
```

Jangan mengharapkan satu layer menyelesaikan semua masalah.

---

## 36. Rate Limiting vs Circuit Breaker

Rate limit:

> “Client ini tidak boleh mengirim terlalu banyak request.”

Circuit breaker:

> “Dependency ini sedang bermasalah, jadi jangan terus dipanggil.”

Rate limit berorientasi pada caller/client/request class.

Circuit breaker berorientasi pada downstream dependency health.

Keduanya bisa bekerja bersama.

Contoh:

- Nginx membatasi `/api/search` agar tidak membanjiri Java.
- Java memakai circuit breaker ketika search service atau database melambat.

---

## 37. Rate Limiting vs Load Shedding

Load shedding:

> “Sistem sedang overload, jadi sebagian request harus ditolak agar sistem tetap hidup.”

Rate limiting bisa menjadi salah satu bentuk load shedding, tetapi tidak sama persis.

Load shedding sering mempertimbangkan kondisi runtime:

- CPU tinggi;
- thread pool penuh;
- queue penuh;
- database latency tinggi;
- error rate meningkat.

Nginx open source rate limiting biasanya statis berbasis rate/key, bukan adaptive berdasarkan health backend.

Karena itu, untuk adaptive load shedding sering perlu:

- aplikasi;
- service mesh;
- API gateway;
- NGINX Plus atau modul tambahan;
- custom control plane.

---

## 38. Java Backend Implications

Nginx rate limiting langsung memengaruhi desain aplikasi Java.

### 38.1 Thread pool protection

Servlet-style backend seperti Tomcat menggunakan thread per request aktif.

Jika Nginx meneruskan terlalu banyak request:

```text
Nginx accepted requests
        |
        v
Tomcat worker threads penuh
        |
        v
Request queue naik
        |
        v
Latency naik
        |
        v
Client retry
        |
        v
Traffic makin tinggi
```

Rate limit dapat mengurangi pressure sebelum mencapai Tomcat.

### 38.2 Database pool protection

Banyak endpoint akhirnya memakai database.

Kalau request tidak dibatasi:

- HikariCP pool penuh;
- thread menunggu connection;
- latency naik;
- timeout terjadi;
- retry terjadi;
- database makin tertekan.

Endpoint mahal seperti report/search/export sebaiknya punya limit lebih ketat daripada endpoint ringan.

### 38.3 Reactive/event-loop backend

Jika backend memakai Netty/WebFlux/Vert.x, modelnya berbeda, tetapi overload tetap mungkin terjadi.

Event loop bisa tersumbat oleh:

- blocking operation;
- downstream latency;
- memory pressure;
- backpressure chain yang buruk;
- response streaming terlalu banyak.

Rate limiting tetap relevan.

---

## 39. Endpoint Classification untuk Rate Limit

Sebelum menulis config, klasifikasikan endpoint.

| Class | Contoh | Risiko | Limit |
|---|---|---|---|
| Public anonymous | login, signup, reset password | abuse tinggi | ketat per IP |
| Authenticated cheap | profile, config, simple lookup | sedang | moderat per user/key |
| Expensive query | search, report, analytics | DB/CPU tinggi | ketat per user/tenant/IP |
| Mutation critical | order, payment, submit case | consistency/business risk | aplikasi-level idempotency + limit hati-hati |
| Upload/download | file transfer | bandwidth/disk | connection + body size |
| Long-lived | websocket, SSE | connection hoarding | connection limit + timeout |

Nginx config yang baik biasanya lahir dari klasifikasi ini.

---

## 40. Contoh Desain untuk Backend Java

Misal aplikasi Java memiliki endpoint:

```text
POST /api/auth/login
POST /api/auth/password-reset
GET  /api/products
GET  /api/search
POST /api/orders
POST /api/files/upload
GET  /api/reports/export
```

Kita bisa buat limit zone:

```nginx
http {
    limit_req_zone $binary_remote_addr zone=login_ip:10m rate=5r/m;
    limit_req_zone $binary_remote_addr zone=password_reset_ip:10m rate=3r/m;
    limit_req_zone $binary_remote_addr zone=public_api_ip:20m rate=20r/s;
    limit_req_zone $binary_remote_addr zone=search_ip:20m rate=5r/s;
    limit_req_zone $binary_remote_addr zone=export_ip:20m rate=2r/m;
    limit_req_zone $binary_remote_addr zone=upload_ip:20m rate=10r/m;

    limit_conn_zone $binary_remote_addr zone=upload_conn_ip:10m;
    limit_conn_zone $binary_remote_addr zone=download_conn_ip:10m;

    upstream java_app {
        server 127.0.0.1:8080;
        keepalive 64;
    }

    server {
        listen 443 ssl http2;
        server_name api.example.com;

        limit_req_status 429;
        limit_conn_status 429;

        location = /api/auth/login {
            limit_req zone=login_ip burst=5 nodelay;
            proxy_pass http://java_app;
        }

        location = /api/auth/password-reset {
            limit_req zone=password_reset_ip burst=3 nodelay;
            proxy_pass http://java_app;
        }

        location /api/search {
            limit_req zone=search_ip burst=10 nodelay;
            proxy_pass http://java_app;
        }

        location /api/reports/export {
            limit_req zone=export_ip burst=2 nodelay;
            proxy_read_timeout 120s;
            proxy_pass http://java_app;
        }

        location /api/files/upload {
            client_max_body_size 20m;
            limit_conn upload_conn_ip 2;
            limit_req zone=upload_ip burst=5 nodelay;
            proxy_pass http://java_app;
        }

        location /api/ {
            limit_req zone=public_api_ip burst=50 nodelay;
            proxy_pass http://java_app;
        }
    }
}
```

Ini bukan final production config, tapi menunjukkan prinsip: **beda endpoint, beda limit**.

---

## 41. Jangan Menaruh Limit Mahal di `location /` Tanpa Sadar

Contoh berbahaya:

```nginx
location / {
    limit_req zone=per_ip burst=10 nodelay;
    proxy_pass http://app;
}
```

Jika server ini juga melayani:

- static assets;
- API;
- health check;
- frontend route;
- callback payment;
- webhook partner;

maka semuanya kena limit sama.

Dampaknya:

- asset loading gagal;
- health check kena limit;
- payment callback gagal;
- webhook partner ditolak;
- debugging sulit karena semua terlihat 429.

Lebih baik eksplisit per route class.

---

## 42. Health Check Harus Diperlakukan Khusus

Load balancer atau Kubernetes probe bisa memanggil health endpoint berkala.

Jangan sembarangan rate limit health check.

Contoh:

```nginx
location = /healthz {
    access_log off;
    proxy_pass http://java_app;
}
```

Atau jika health endpoint dilayani langsung oleh Nginx:

```nginx
location = /nginx-health {
    access_log off;
    return 200 'ok';
}
```

Jika health check terkena limit, orchestrator bisa mengira instance unhealthy dan melakukan restart/eviction yang tidak perlu.

---

## 43. Webhook dan Callback Perlu Hati-Hati

Webhook dari payment provider, identity provider, atau third-party integration sering datang dari IP range tertentu dan bursty.

Kalau terlalu ketat:

- payment notification gagal;
- order state tidak berubah;
- reconciliation kacau;
- retry dari provider bisa memperparah traffic.

Untuk webhook:

- validasi signature di aplikasi;
- gunakan idempotency;
- limit berdasarkan known source jika memungkinkan;
- jangan mengandalkan IP saja;
- observasi 429 sangat hati-hati.

---

## 44. WebSocket dan Long-Lived Traffic

Untuk WebSocket, `limit_req` kurang relevan setelah connection established.

Yang lebih relevan:

- `limit_conn`;
- timeout;
- upstream capacity;
- max session per user;
- aplikasi-level connection registry.

Contoh:

```nginx
limit_conn_zone $binary_remote_addr zone=ws_conn_ip:10m;

server {
    location /ws/ {
        limit_conn ws_conn_ip 5;

        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 1h;

        proxy_pass http://java_app;
    }
}
```

Tapi untuk aplikasi multi-user di belakang NAT, per-user connection limit lebih baik dilakukan di aplikasi.

---

## 45. Dry Run Mode

Nginx mendukung dry run untuk `limit_req` dan `limit_conn` pada versi modern.

Contoh:

```nginx
limit_req_dry_run on;
```

Dalam dry run, Nginx tidak benar-benar menolak request, tetapi mencatat request yang seharusnya dibatasi.

Ini sangat berguna untuk rollout.

### 45.1 Strategi rollout aman

1. Tambahkan zone dan limit dengan dry run.
2. Observasi log selama traffic normal dan peak.
3. Identifikasi endpoint/user/IP yang akan terkena.
4. Sesuaikan rate/burst/key.
5. Aktifkan enforcement di endpoint risiko rendah.
6. Aktifkan bertahap untuk endpoint kritikal.

Jangan langsung menerapkan limit ketat di production tanpa observasi.

---

## 46. Monitoring yang Harus Ada

Minimal observability:

- total request per route;
- total 429 per route;
- 429 rate per IP/API key/tenant jika tersedia;
- upstream request rate;
- upstream response time;
- backend error rate;
- rejected vs delayed request;
- top offenders;
- false positive reports.

Dashboard sederhana:

```text
Route                 RPS   2xx   4xx   429   5xx   p95 latency
/api/auth/login       20    95%   4%    2%    1%    120ms
/api/search           300   90%   8%    6%    2%    800ms
/api/reports/export   5     80%   15%   12%   5%    8s
```

Jika 429 naik bersamaan dengan backend latency turun, limit mungkin sedang melindungi sistem.

Jika 429 naik dan user complaint naik, limit mungkin terlalu agresif atau key salah.

---

## 47. Debugging 429

Saat melihat 429, tanyakan:

1. Endpoint mana yang mengeluarkan 429?
2. Apakah 429 dari Nginx atau aplikasi?
3. Apa limit zone yang aktif?
4. Key apa yang digunakan?
5. Apakah real IP sudah benar?
6. Apakah client berada di balik NAT/proxy?
7. Apakah burst terlalu kecil?
8. Apakah traffic normal memang bursty?
9. Apakah ada deploy baru yang mengubah client behavior?
10. Apakah retry client memperparah limit?

Cara membedakan Nginx vs aplikasi:

- cek access log Nginx;
- cek error log Nginx;
- cek apakah request masuk ke application log;
- custom error response Nginx bisa diberi signature;
- correlation ID membantu.

---

## 48. Testing dengan `curl`

Contoh sederhana:

```bash
for i in $(seq 1 20); do
  curl -s -o /dev/null -w "%{http_code}\n" https://api.example.com/api/search
 done
```

Untuk parallel:

```bash
seq 1 50 | xargs -n1 -P20 -I{} curl -s -o /dev/null -w "%{http_code}\n" https://api.example.com/api/search
```

Yang dicari:

- kapan 429 muncul;
- apakah burst bekerja;
- apakah request delayed;
- apakah latency meningkat sebelum 429.

---

## 49. Testing dengan Load Tool

Tools seperti `hey`, `wrk`, atau `vegeta` bisa digunakan.

Contoh dengan `hey`:

```bash
hey -n 1000 -c 50 https://api.example.com/api/search
```

Perhatikan:

- status distribution;
- latency distribution;
- throughput;
- error rate;
- apakah backend log menerima semua request atau hanya sebagian.

Namun hati-hati: load test sintetis sering tidak menyerupai traffic nyata.

Browser bisa burst karena memuat banyak asset paralel. Mobile app bisa retry. Partner API bisa batch. Bot bisa rotate IP.

---

## 50. Client Retry dan Amplification

Rate limiting bisa memperburuk traffic jika client retry secara agresif.

Contoh buruk:

```text
Client request -> 429
Client immediately retries -> 429
Client retries again -> 429
```

Akibatnya traffic makin tinggi.

Untuk API client, dokumentasikan:

- gunakan exponential backoff;
- hormati `Retry-After`;
- jangan retry non-idempotent request sembarangan;
- pakai idempotency key untuk mutation tertentu.

Untuk internal services, Java client seperti WebClient/RestTemplate/Feign harus dikonfigurasi agar tidak retry membabi buta.

---

## 51. Rate Limiting dan Idempotency

Endpoint mutation seperti:

```text
POST /api/orders
POST /api/payments
POST /api/cases/{id}/submit
```

Tidak cukup hanya rate limit.

Perlu:

- idempotency key;
- duplicate detection;
- transaction boundary jelas;
- retry-safe design;
- audit trail.

Rate limiting bisa mengurangi spam, tetapi tidak menyelesaikan duplicate business action.

---

## 52. Rate Limiting dan CORS Preflight

Browser bisa mengirim `OPTIONS` preflight sebelum request tertentu.

Jika kamu rate limit semua method sama, preflight bisa ikut menghabiskan budget.

Contoh:

```nginx
location /api/ {
    limit_req zone=api_per_ip burst=20 nodelay;
    proxy_pass http://app;
}
```

Jika banyak CORS request, `OPTIONS` ikut dihitung.

Pilihan desain:

- handle preflight di Nginx tanpa proxy;
- exclude `OPTIONS` dari limit tertentu;
- gunakan limit yang cukup longgar;
- pastikan observability membedakan method.

Contoh sederhana handle OPTIONS:

```nginx
location /api/ {
    if ($request_method = OPTIONS) {
        add_header Access-Control-Allow-Origin $http_origin always;
        add_header Access-Control-Allow-Methods 'GET, POST, PUT, PATCH, DELETE, OPTIONS' always;
        add_header Access-Control-Allow-Headers 'Authorization, Content-Type, X-Request-Id' always;
        add_header Access-Control-Max-Age 3600 always;
        return 204;
    }

    limit_req zone=api_per_ip burst=20 nodelay;
    proxy_pass http://java_app;
}
```

Catatan: penggunaan `if` di Nginx perlu hati-hati, tetapi pola `return` sederhana dalam `location` umum digunakan.

---

## 53. Rate Limiting dan Static Assets

Jangan membatasi static assets terlalu ketat jika halaman memuat banyak file.

Satu page load bisa memuat:

- HTML;
- CSS;
- JS chunks;
- images;
- fonts;
- sourcemap jika salah expose;
- API bootstrap.

Jika semua dihitung per IP dengan burst kecil, user normal bisa kena 429 hanya karena membuka halaman.

Static assets biasanya lebih baik dilindungi dengan:

- cache headers;
- CDN;
- connection limit jika perlu;
- bandwidth control jika relevan;
- tidak menggunakan rate limit agresif.

---

## 54. Whitelist dan Bypass

Kadang ada IP atau client yang perlu limit berbeda.

Contoh:

- internal monitoring;
- trusted load test runner;
- payment provider webhook;
- partner enterprise;
- office network.

Nginx bisa menggunakan `map` untuk memilih key kosong atau zone berbeda.

Contoh bypass internal IP:

```nginx
geo $limited_ip_key {
    default        $binary_remote_addr;
    10.0.0.0/8    "";
    192.168.0.0/16 "";
}

limit_req_zone $limited_ip_key zone=api_per_ip:10m rate=10r/s;
```

Caveat:

- bypass harus sangat hati-hati;
- dokumentasikan alasan;
- review berkala;
- jangan whitelist range terlalu luas;
- pastikan real IP benar.

---

## 55. `map` untuk Route Class

Untuk konfigurasi besar, kamu bisa membuat class berdasarkan URI.

Contoh:

```nginx
map $uri $rate_limit_class {
    default              normal;
    /api/auth/login      login;
    /api/auth/reset      sensitive;
    /api/reports/export  expensive;
}
```

Namun `limit_req` tidak bisa secara dinamis memilih zone hanya dengan variable di semua konteks seperti konfigurasi biasa. Karena itu sering lebih jelas menaruh limit di location eksplisit.

Gunakan `map` untuk mendukung key, log, header, atau routing behavior, bukan membuat konfigurasi terlalu pintar.

---

## 56. Masalah Cardinality Tinggi

Misal kamu memakai key:

```nginx
limit_req_zone "$binary_remote_addr:$request_uri" zone=per_ip_full_uri:100m rate=1r/s;
```

Jika URI punya query unik:

```text
/api/search?q=a
/api/search?q=b
/api/search?q=random-uuid-1
/api/search?q=random-uuid-2
```

Maka key menjadi sangat banyak.

Risiko:

- shared memory cepat penuh;
- attacker bisa membuat banyak key unik;
- limit menjadi mudah dibypass;
- observability buruk.

Lebih baik gunakan route class atau normalized URI jika memungkinkan.

---

## 57. Rate Limiting Berdasarkan `$request_uri` Biasanya Buruk

`$request_uri` mencakup query string.

Contoh:

```text
/api/search?q=foo
/api/search?q=bar
```

Jika dijadikan key, dua request itu dianggap berbeda.

Untuk rate limiting, biasanya lebih aman menggunakan:

- `$uri`;
- static location;
- API key;
- user id;
- IP;
- route class.

---

## 58. Security: Header-Based Key Harus Dipercaya

Contoh berbahaya:

```nginx
limit_req_zone $http_x_user_id zone=per_user:10m rate=10r/s;
```

Jika client bisa mengirim header ini langsung:

```bash
curl -H 'X-User-Id: alice' https://api.example.com/api/
curl -H 'X-User-Id: bob' https://api.example.com/api/
curl -H 'X-User-Id: random' https://api.example.com/api/
```

Attacker bisa bypass limit dengan mengganti header.

Header identity hanya boleh digunakan jika:

- diset oleh trusted upstream;
- client header asli dihapus;
- network path tertutup;
- ada authentication layer sebelum Nginx limit tersebut.

---

## 59. Membersihkan Spoofed Headers

Jika Nginx menerima request langsung dari internet dan meneruskan ke aplikasi, jangan percaya identity header dari client.

Contoh:

```nginx
proxy_set_header X-Authenticated-User "";
proxy_set_header X-Authenticated-Tenant "";
```

Atau lebih umum: hanya set header dari sumber yang kamu kontrol.

Jika Nginx berada setelah auth gateway, desainnya bisa berbeda, tetapi trust boundary harus eksplisit.

---

## 60. Rate Limit dan Multi-Instance Nginx

Jika kamu punya beberapa instance Nginx:

```text
Load Balancer
   |---- Nginx A
   |---- Nginx B
   |---- Nginx C
```

Masing-masing instance punya shared memory lokal sendiri.

Artinya limit tidak global.

Jika rate per IP adalah 10 r/s dan ada 3 instance, client bisa efektif mendapat sekitar 30 r/s tergantung load balancing.

Solusi:

- terima sebagai approximation;
- turunkan limit per instance;
- gunakan sticky routing;
- gunakan CDN/API gateway global limit;
- lakukan quota di aplikasi dengan distributed store;
- gunakan produk/komponen yang mendukung distributed rate limiting.

Nginx OSS rate limiting bukan distributed global quota system.

---

## 61. Deployment dan Reload Behavior

Rate limit state ada di shared memory zone.

Saat reload konfigurasi, behavior bisa mempertahankan zone jika nama dan ukuran zone tetap kompatibel.

Namun jangan bergantung membabi buta pada state survival untuk desain quota bisnis.

Untuk quota penting:

- simpan di aplikasi/database/cache;
- jangan hanya mengandalkan memory Nginx.

---

## 62. Konfigurasi Lengkap: API Java dengan Rate Limit Layered

Contoh lebih lengkap:

```nginx
user nginx;
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
        '"host":"$host",'
        '"method":"$request_method",'
        '"uri":"$uri",'
        '"status":$status,'
        '"request_time":$request_time,'
        '"upstream_status":"$upstream_status",'
        '"upstream_response_time":"$upstream_response_time",'
        '"request_id":"$http_x_request_id",'
        '"user_agent":"$http_user_agent"'
        '}';

    access_log /var/log/nginx/api_access.log api_json;

    limit_req_zone $binary_remote_addr zone=login_ip:10m rate=5r/m;
    limit_req_zone $binary_remote_addr zone=reset_ip:10m rate=3r/m;
    limit_req_zone $binary_remote_addr zone=api_ip:20m rate=20r/s;
    limit_req_zone $binary_remote_addr zone=search_ip:20m rate=5r/s;
    limit_req_zone $binary_remote_addr zone=export_ip:20m rate=2r/m;
    limit_req_zone $binary_remote_addr zone=upload_ip:20m rate=10r/m;

    limit_conn_zone $binary_remote_addr zone=upload_conn_ip:10m;
    limit_conn_zone $binary_remote_addr zone=ws_conn_ip:10m;

    upstream java_backend {
        server 127.0.0.1:8080 max_fails=3 fail_timeout=10s;
        keepalive 64;
    }

    server {
        listen 443 ssl http2;
        server_name api.example.com;

        limit_req_status 429;
        limit_conn_status 429;
        limit_req_log_level warn;

        error_page 429 = @rate_limited_json;

        location @rate_limited_json {
            default_type application/json;
            add_header Retry-After 60 always;
            return 429 '{"error":"rate_limited","message":"Too many requests"}';
        }

        location = /healthz {
            access_log off;
            proxy_pass http://java_backend;
        }

        location = /api/auth/login {
            limit_req zone=login_ip burst=5 nodelay;
            proxy_pass http://java_backend;
        }

        location = /api/auth/password-reset {
            limit_req zone=reset_ip burst=3 nodelay;
            proxy_pass http://java_backend;
        }

        location /api/search {
            limit_req zone=search_ip burst=10 nodelay;
            proxy_pass http://java_backend;
        }

        location /api/reports/export {
            limit_req zone=export_ip burst=2 nodelay;
            proxy_read_timeout 120s;
            proxy_pass http://java_backend;
        }

        location /api/files/upload {
            client_max_body_size 20m;
            limit_conn upload_conn_ip 2;
            limit_req zone=upload_ip burst=5 nodelay;
            proxy_pass http://java_backend;
        }

        location /ws/ {
            limit_conn ws_conn_ip 5;

            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_read_timeout 1h;

            proxy_pass http://java_backend;
        }

        location /api/ {
            limit_req zone=api_ip burst=50 nodelay;
            proxy_pass http://java_backend;
        }
    }
}
```

Konfigurasi ini masih perlu header proxy, TLS config, real IP, timeout, dan security hardening yang lengkap sesuai bagian lain dari seri.

---

## 63. Checklist Desain Rate Limiting

Sebelum menerapkan limit, jawab:

1. Apa tujuan limit ini?
   - security,
   - fairness,
   - cost control,
   - backend protection,
   - abuse mitigation?
2. Endpoint mana yang dilindungi?
3. Apakah endpoint itu public, authenticated, internal, webhook, atau health check?
4. Key apa yang digunakan?
5. Apakah key bisa dipalsukan?
6. Apakah real client IP sudah benar?
7. Apakah NAT/corporate proxy bisa membuat false positive?
8. Apakah burst cukup untuk traffic normal?
9. Apakah 429 response contract jelas?
10. Apakah client tahu harus backoff?
11. Apakah ada dry run sebelum enforcement?
12. Apakah 429 dimonitor?
13. Apakah ada rollback cepat?
14. Apakah rate limit ini konsisten dengan application-level quota?
15. Apakah limit tetap masuk akal saat Nginx instance bertambah?

---

## 64. Production Rollout Plan

Strategi aman:

### Tahap 1: Observasi

- Tambahkan access log fields yang cukup.
- Identifikasi endpoint mahal dan abuse-prone.
- Lihat traffic normal dan peak.
- Lihat distribusi per IP/API key/user.

### Tahap 2: Dry Run

- Aktifkan dry run jika tersedia.
- Gunakan limit konservatif.
- Pantau siapa yang akan terkena limit.
- Validasi dengan product/support/security team jika perlu.

### Tahap 3: Enforce Low-Risk Endpoint

- Mulai dari endpoint seperti login/password reset/search.
- Jangan mulai dari payment/webhook/order critical tanpa analisis.

### Tahap 4: Monitor

- Pantau 429 rate.
- Pantau user complaint.
- Pantau backend latency dan error rate.
- Pantau top limited clients.

### Tahap 5: Iterate

- Sesuaikan rate/burst.
- Bedakan route class.
- Tambahkan application-level quota jika perlu.
- Dokumentasikan contract.

---

## 65. Common Mistakes

### 65.1 Membatasi semua endpoint dengan satu limit

Masalah: endpoint murah dan mahal diperlakukan sama.

Solusi: klasifikasikan endpoint.

### 65.2 Menggunakan IP load balancer sebagai client IP

Masalah: semua user dianggap satu IP.

Solusi: konfigurasi real IP dengan trust boundary benar.

### 65.3 Menggunakan header yang bisa dipalsukan sebagai key

Masalah: attacker bypass limit.

Solusi: hanya gunakan trusted header.

### 65.4 Burst terlalu kecil

Masalah: user normal kena 429 saat browser memuat banyak request.

Solusi: observasi traffic burst nyata.

### 65.5 Tidak memonitor 429

Masalah: limit merusak user experience tanpa diketahui.

Solusi: dashboard dan alert khusus.

### 65.6 Menganggap Nginx rate limit sebagai quota bisnis

Masalah: state memory lokal tidak cukup untuk quota kontraktual.

Solusi: lakukan quota bisnis di aplikasi/API gateway dengan persistent store.

### 65.7 Health check kena limit

Masalah: instance sehat dianggap down.

Solusi: exclude health endpoint.

### 65.8 Webhook kena limit terlalu agresif

Masalah: integrasi bisnis gagal.

Solusi: perlakukan webhook sebagai route class khusus.

---

## 66. Failure Mode Analysis

### Failure Mode 1: Semua user tiba-tiba kena 429

Kemungkinan:

- real IP salah;
- semua traffic terlihat dari load balancer IP;
- CDN IP belum dipercaya;
- limit terlalu ketat;
- deploy frontend membuat request burst meningkat.

Langkah:

1. Cek `$remote_addr` di access log.
2. Cek `X-Forwarded-For`.
3. Cek real IP config.
4. Cek route yang mengeluarkan 429.
5. Rollback atau longgarkan burst/rate.

### Failure Mode 2: Abuse tetap lolos

Kemungkinan:

- attacker rotate IP;
- key terlalu mudah diganti;
- limit per URI membuat bypass via query random;
- multi-instance Nginx membuat limit efektif lebih longgar;
- abuse terjadi setelah auth dan harus dibatasi per user/account.

Langkah:

1. Pindahkan sebagian enforcement ke aplikasi.
2. Gunakan API key/user/tenant quota.
3. Tambahkan bot/CDN/WAF layer jika perlu.
4. Normalisasi key.

### Failure Mode 3: Backend tetap overload meski rate limit aktif

Kemungkinan:

- limit terlalu longgar;
- endpoint mahal tidak punya limit khusus;
- concurrency bukan request rate yang jadi masalah;
- request diterima tetapi long-running;
- retry storm dari client.

Langkah:

1. Tambahkan endpoint-specific limit.
2. Gunakan `limit_conn` untuk long-lived/heavy transfer.
3. Atur timeout dan circuit breaker.
4. Edukasi client retry/backoff.
5. Tambahkan application-level load shedding.

---

## 67. Latihan Desain

### Latihan 1: Login dan Password Reset

Desain limit untuk:

```text
POST /api/auth/login
POST /api/auth/password-reset
POST /api/auth/otp/resend
```

Pertanyaan:

- Mana yang dibatasi per IP?
- Mana yang harus dibatasi per account di aplikasi?
- Apa response 429-nya?
- Bagaimana menghindari account enumeration?

### Latihan 2: Search Endpoint Mahal

Endpoint:

```text
GET /api/search?q=...
```

Traffic normal 100 RPS, tetapi bot scraping bisa 5,000 RPS.

Desain:

- IP limit;
- authenticated user limit;
- cache strategy;
- database protection;
- observability.

### Latihan 3: Partner API

Partner enterprise punya API key dan kontrak 500 RPS.

Pertanyaan:

- Apakah Nginx cukup?
- Bagaimana jika ada 4 Nginx instance?
- Di mana kontrak quota sebaiknya dienforce?
- Apa yang dilakukan saat partner melebihi limit?

### Latihan 4: Upload Service

Endpoint:

```text
POST /api/files/upload
```

File max 20 MB.

Desain:

- body size limit;
- request rate limit;
- connection limit;
- timeout;
- Java backend streaming/buffering decision;
- storage failure handling.

---

## 68. Ringkasan Mental Model

Rate limiting di Nginx adalah **traffic admission control**.

Ia bukan sekadar security toggle.

Model yang harus diingat:

```text
Demand > Capacity
        |
        v
Admission decision needed
        |
        +--> accept now
        +--> delay/smooth
        +--> reject fast
```

`limit_req` membatasi laju request.

`limit_conn` membatasi koneksi aktif.

Key menentukan siapa yang dibatasi.

Zone menentukan di mana state disimpan.

Burst menentukan toleransi lonjakan.

Status code dan observability menentukan apakah client dan operator bisa memahami apa yang terjadi.

Untuk sistem Java, rate limiting yang baik melindungi:

- servlet thread pool;
- event loop;
- database pool;
- downstream dependency;
- storage;
- external provider;
- user experience.

Tetapi Nginx tidak menggantikan:

- business quota;
- authentication;
- authorization;
- fraud detection;
- application idempotency;
- distributed global rate limiting.

---

## 69. Checklist Produksi Singkat

Sebelum mengaktifkan rate limit production:

- [ ] Endpoint sudah diklasifikasi berdasarkan cost dan risk.
- [ ] Real client IP benar.
- [ ] Key tidak bisa dipalsukan.
- [ ] NAT/corporate proxy dipertimbangkan.
- [ ] Health check dikecualikan.
- [ ] Webhook/callback diperlakukan khusus.
- [ ] 429 response jelas.
- [ ] Access log dapat membedakan route, status, request time, upstream time.
- [ ] Dashboard 429 tersedia.
- [ ] Dry run atau rollout bertahap dilakukan.
- [ ] Client retry/backoff dipahami.
- [ ] Ada rollback plan.
- [ ] Application-level quota tetap ada untuk rule bisnis.

---

## 70. Penutup

Bagian ini membangun pemahaman bahwa Nginx rate limiting adalah bagian dari desain reliability dan abuse resistance.

Engineer yang matang tidak bertanya:

> “Berapa angka rate limit yang bagus?”

Tetapi bertanya:

> “Resource apa yang saya lindungi, traffic siapa yang saya batasi, apa dampaknya ke user legitimate, dan bagaimana saya tahu limit ini bekerja atau merusak?”

Di bagian berikutnya, kita akan masuk ke **access control, basic auth, IP rules, dan internal endpoints**. Topiknya masih security boundary, tetapi fokusnya bergeser dari “berapa banyak request boleh masuk” menjadi “siapa yang boleh mengakses area tertentu”.

---

# Status Seri

Progress saat ini: **Part 016 dari 030 selesai**.

Seri belum selesai.

Bagian berikutnya:

**Part 017 — Access Control, Basic Auth, IP Rules, and Internal Endpoints**


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-nginx-mastery-for-java-engineers-part-015.md">⬅️ Part 015 — Caching with Nginx: Reverse Proxy Cache as Performance and Resilience Tool</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-nginx-mastery-for-java-engineers-part-017.md">Part 017 — Access Control, Basic Auth, IP Rules, and Internal Endpoints ➡️</a>
</div>
