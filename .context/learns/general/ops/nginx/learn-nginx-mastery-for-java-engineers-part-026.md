# learn-nginx-mastery-for-java-engineers-part-026.md

# Part 026 — Stream Module: TCP/UDP Proxying for Non-HTTP Traffic

## Status Seri

- Seri: `learn-nginx-mastery-for-java-engineers`
- Part: `026` dari `030`
- Status seri: **belum selesai**
- Part sebelumnya: `Part 025 — Nginx in Containers and Kubernetes`
- Part berikutnya: `Part 027 — Config Design Patterns for Large Systems`

---

## 1. Tujuan Bagian Ini

Di part sebelumnya kita membahas Nginx di container dan Kubernetes. Hampir seluruh seri sejauh ini berpusat pada Nginx sebagai HTTP reverse proxy, static server, TLS terminator, cache, rate limiter, dan lightweight gateway.

Bagian ini berbeda.

Kita akan membahas **Nginx sebagai proxy L4**, bukan L7 HTTP proxy.

Artinya, Nginx tidak lagi memahami request sebagai:

```text
GET /api/orders/123 HTTP/1.1
Host: api.example.com
Authorization: Bearer ...
```

Melainkan hanya melihat koneksi byte stream seperti:

```text
client socket <-> nginx <-> upstream socket
```

Atau untuk UDP:

```text
client datagram <-> nginx <-> upstream datagram
```

Tujuan utama bagian ini:

1. Memahami perbedaan mendasar antara proxy HTTP dan proxy TCP/UDP.
2. Memahami `stream` context di Nginx.
3. Mampu menulis konfigurasi TCP proxy sederhana.
4. Mampu menulis konfigurasi UDP proxy sederhana.
5. Memahami TLS passthrough dan SNI-based routing.
6. Memahami kapan Nginx cocok untuk traffic non-HTTP.
7. Memahami kapan Nginx **tidak cocok** untuk database, Kafka, Redis, Postgres, atau protocol stateful tertentu.
8. Mampu memodelkan failure mode L4 proxy secara realistis.
9. Mampu membedakan observability L4 dan L7.
10. Mampu membuat keputusan arsitektural, bukan sekadar copy-paste konfigurasi.

---

## 2. Mental Model: HTTP Proxy vs Stream Proxy

Nginx memiliki dua dunia besar:

```text
HTTP world:

http {
    server {
        location /api/ {
            proxy_pass http://backend;
        }
    }
}
```

Dan:

```text
Stream world:

stream {
    server {
        listen 5432;
        proxy_pass postgres_backend;
    }
}
```

Perbedaannya bukan hanya syntax.

Perbedaannya adalah **level pemahaman Nginx terhadap traffic**.

---

## 3. L7 HTTP Proxy

Saat Nginx bekerja di `http` context, Nginx memahami:

- HTTP method.
- URI.
- Query string.
- Header.
- Host.
- Cookie.
- Status code.
- Response header.
- Request body boundary.
- Upstream status.
- Cache semantics.
- Redirect.
- Compression.
- WebSocket upgrade.
- gRPC framing pada level tertentu melalui HTTP/2.

Contoh:

```nginx
http {
    upstream app_backend {
        server 10.0.1.10:8080;
        server 10.0.1.11:8080;
    }

    server {
        listen 443 ssl http2;
        server_name api.example.com;

        location /orders/ {
            proxy_pass http://app_backend;
            proxy_set_header Host $host;
            proxy_set_header X-Forwarded-Proto $scheme;
        }
    }
}
```

Di sini Nginx dapat mengambil keputusan berdasarkan:

```text
host == api.example.com
path starts with /orders/
header exists
method == POST
response status == 500
```

Ini adalah **application-aware proxying**.

---

## 4. L4 Stream Proxy

Saat Nginx bekerja di `stream` context, Nginx tidak memahami HTTP.

Nginx hanya memahami:

- koneksi TCP,
- datagram UDP,
- socket client,
- socket upstream,
- byte flow,
- timeout koneksi,
- upstream endpoint,
- optional TLS preread metadata,
- optional PROXY protocol.

Contoh:

```nginx
stream {
    upstream postgres_backend {
        server 10.0.1.20:5432;
    }

    server {
        listen 5432;
        proxy_pass postgres_backend;
    }
}
```

Di sini Nginx tidak tahu:

- apakah query SQL yang lewat adalah `SELECT`, `INSERT`, atau `DROP TABLE`,
- user database siapa,
- transaksi sedang berjalan atau tidak,
- query sedang idle atau long-running,
- response database adalah success atau error,
- protocol negotiation database berhasil atau gagal.

Nginx hanya meneruskan bytes.

Mental model yang benar:

```text
HTTP proxy:
    Nginx understands messages.

Stream proxy:
    Nginx forwards connections.
```

---

## 5. Mengapa Java Engineer Perlu Memahami Stream Proxy?

Sebagai Java software engineer, kamu mungkin lebih sering memakai Nginx untuk HTTP. Tapi di production, kebutuhan L4 sering muncul:

- expose TCP service internal,
- TLS passthrough,
- route traffic berdasarkan SNI tanpa terminate TLS,
- proxy database untuk akses maintenance,
- proxy Redis untuk internal environment,
- expose MQTT,
- proxy gRPC passthrough di layer bawah tertentu,
- proxy custom binary protocol,
- load balancing TCP service,
- migrate endpoint lama ke endpoint baru tanpa mengubah client,
- membuat compatibility bridge sementara.

Tapi justru karena terlihat sederhana, `stream` sering disalahgunakan.

Contoh buruk:

```text
“Kita taruh Nginx di depan Postgres supaya high availability.”
```

Itu terdengar masuk akal, tapi sering salah.

Kenapa?

Karena high availability database bukan hanya soal TCP endpoint hidup. Database punya state:

- primary/replica role,
- transaction state,
- replication lag,
- session variables,
- prepared statements,
- connection pool,
- transaction isolation,
- failover semantics,
- write safety,
- split brain risk.

Nginx stream tidak memahami semua itu.

---

## 6. Layer Model: L4 vs L7

Gunakan model sederhana ini:

```text
Layer 7 — Application
    HTTP, gRPC, SQL semantics, Redis commands, Kafka protocol semantics

Layer 6 — Presentation
    TLS, encoding, serialization

Layer 5 — Session
    connection/session lifecycle

Layer 4 — Transport
    TCP, UDP

Layer 3 — Network
    IP

Layer 2 — Link
    Ethernet/Wi-Fi/etc.
```

Nginx `http` context bekerja terutama di L7 HTTP.

Nginx `stream` context bekerja terutama di L4, dengan beberapa kemampuan terbatas membaca metadata awal seperti TLS SNI melalui `ssl_preread`.

Penting:

```text
L4 proxy can route connections.
L7 proxy can reason about requests.
```

Kalau sistem butuh keputusan berdasarkan request, command, query, tenant, status code, atau business context, `stream` hampir pasti bukan tool yang cukup.

---

## 7. Kapan Stream Module Cocok?

Nginx stream cocok untuk kasus berikut.

### 7.1 TCP Forwarding Sederhana

Misalnya kamu punya service internal:

```text
internal-service: 10.0.1.50:9000
```

Dan ingin expose melalui Nginx:

```text
nginx.example.com:9000 -> 10.0.1.50:9000
```

Konfigurasi:

```nginx
stream {
    server {
        listen 9000;
        proxy_pass 10.0.1.50:9000;
    }
}
```

Ini cocok jika:

- protocol sederhana,
- tidak butuh application-aware routing,
- upstream tunggal,
- failure handling sederhana,
- observability minimal dapat diterima.

---

### 7.2 TCP Load Balancing Sederhana

```nginx
stream {
    upstream tcp_backend {
        server 10.0.1.51:9000;
        server 10.0.1.52:9000;
    }

    server {
        listen 9000;
        proxy_pass tcp_backend;
    }
}
```

Nginx memilih upstream pada level koneksi, bukan request.

Artinya:

```text
1 TCP connection -> 1 upstream selected
```

Jika dalam satu TCP connection ada banyak logical request, semuanya tetap lewat upstream yang sama.

Ini berbeda dari HTTP reverse proxy dengan keepalive, di mana routing tetap pada request level walaupun koneksi dapat dipakai ulang.

---

### 7.3 TLS Passthrough

TLS passthrough berarti:

```text
Client --TLS--> Nginx --TLS untouched--> Upstream
```

Nginx tidak terminate TLS.

Nginx tidak melihat HTTP request.

Nginx tidak melihat path.

Nginx tidak melihat header.

Nginx hanya meneruskan encrypted bytes.

Contoh:

```nginx
stream {
    upstream tls_app {
        server 10.0.2.10:443;
    }

    server {
        listen 443;
        proxy_pass tls_app;
    }
}
```

Kapan ini berguna?

- certificate harus berada di aplikasi/upstream,
- compliance melarang TLS termination di proxy,
- upstream butuh mTLS end-to-end,
- proxy hanya boleh menjadi network router,
- ingin SNI routing tanpa decrypt payload.

Trade-off:

- Nginx tidak bisa menambahkan HTTP security headers,
- tidak bisa melakukan path routing,
- tidak bisa cache,
- tidak bisa inspect request,
- tidak bisa HTTP rate limit berdasarkan URI,
- tidak bisa rewrite header,
- tidak bisa observability HTTP detail.

---

### 7.4 SNI-Based TCP Routing

Meskipun Nginx tidak terminate TLS, Nginx bisa membaca SNI dari TLS ClientHello menggunakan `ssl_preread`.

SNI adalah hostname yang dikirim client saat awal TLS handshake agar server tahu certificate/domain mana yang diminta.

Contoh konsep:

```text
ClientHello SNI: app1.example.com -> upstream app1
ClientHello SNI: app2.example.com -> upstream app2
```

Konfigurasi:

```nginx
stream {
    map $ssl_preread_server_name $backend_name {
        app1.example.com app1_backend;
        app2.example.com app2_backend;
        default          default_backend;
    }

    upstream app1_backend {
        server 10.0.1.10:443;
    }

    upstream app2_backend {
        server 10.0.1.20:443;
    }

    upstream default_backend {
        server 10.0.1.30:443;
    }

    server {
        listen 443;
        proxy_pass $backend_name;
        ssl_preread on;
    }
}
```

Mental model:

```text
Nginx reads only TLS ClientHello metadata.
Nginx does not decrypt application traffic.
```

Ini berguna untuk multi-tenant TLS passthrough.

Namun ada batas:

- Tidak bisa route berdasarkan path `/api` vs `/admin`.
- Tidak bisa route berdasarkan JWT claim.
- Tidak bisa route berdasarkan HTTP header custom.
- Tidak bisa inject `X-Forwarded-*`.
- Tidak bisa log HTTP status.

---

### 7.5 UDP Proxying

UDP berbeda dari TCP karena tidak connection-oriented.

Contoh Nginx UDP proxy:

```nginx
stream {
    upstream dns_backend {
        server 10.0.1.53:53;
        server 10.0.1.54:53;
    }

    server {
        listen 53 udp;
        proxy_pass dns_backend;
    }
}
```

Cocok untuk:

- DNS forwarding sederhana,
- syslog UDP,
- custom UDP telemetry,
- beberapa protocol stateless.

Tapi UDP proxy punya tantangan:

- tidak ada koneksi permanen,
- packet loss normal,
- ordering tidak dijamin,
- retry biasanya dilakukan client/application,
- observability lebih terbatas,
- state tracking di proxy dapat membingungkan jika protocol sebenarnya stateful.

---

## 8. Basic Stream Configuration Structure

`stream` berada sejajar dengan `http`, bukan di dalam `http`.

Contoh struktur lengkap:

```nginx
worker_processes auto;

events {
    worker_connections 4096;
}

http {
    server {
        listen 80;
        server_name example.com;

        location / {
            return 200 "http ok\n";
        }
    }
}

stream {
    upstream tcp_backend {
        server 10.0.1.10:9000;
    }

    server {
        listen 9000;
        proxy_pass tcp_backend;
    }
}
```

Kesalahan umum:

```nginx
http {
    stream {   # salah
        ...
    }
}
```

`stream` tidak boleh berada di dalam `http`.

---

## 9. TCP Proxy Minimal

Konfigurasi paling sederhana:

```nginx
stream {
    server {
        listen 9000;
        proxy_pass 127.0.0.1:9001;
    }
}
```

Alurnya:

```text
client connects to nginx:9000
nginx opens connection to 127.0.0.1:9001
bytes from client forwarded to upstream
bytes from upstream forwarded to client
```

Nginx tidak tahu isi bytes tersebut.

---

## 10. TCP Proxy dengan Upstream Block

Lebih maintainable:

```nginx
stream {
    upstream app_tcp_backend {
        server 10.0.1.10:9001;
        server 10.0.1.11:9001;
    }

    server {
        listen 9000;
        proxy_pass app_tcp_backend;
    }
}
```

Kelebihan upstream block:

- bisa punya banyak backend,
- bisa memberi weight,
- bisa menandai backup,
- bisa mengatur fail behavior,
- konfigurasi lebih eksplisit,
- lebih mudah dibaca saat ada banyak service.

---

## 11. Load Balancing di Stream

Default load balancing adalah round-robin.

```nginx
stream {
    upstream tcp_pool {
        server 10.0.1.10:9000;
        server 10.0.1.11:9000;
    }

    server {
        listen 9000;
        proxy_pass tcp_pool;
    }
}
```

Setiap koneksi baru akan dipilih ke upstream.

```text
connection 1 -> 10.0.1.10
connection 2 -> 10.0.1.11
connection 3 -> 10.0.1.10
```

Tetapi ingat:

```text
Nginx stream balances connections, not logical operations.
```

Jika client membuka satu koneksi panjang berisi ribuan command, semua command tetap ke backend yang sama.

---

## 12. Weight

```nginx
stream {
    upstream tcp_pool {
        server 10.0.1.10:9000 weight=3;
        server 10.0.1.11:9000 weight=1;
    }

    server {
        listen 9000;
        proxy_pass tcp_pool;
    }
}
```

Artinya secara kasar:

```text
10.0.1.10 menerima sekitar 3x koneksi dibanding 10.0.1.11
```

Cocok jika kapasitas backend berbeda.

Tapi weight tidak otomatis berarti beban CPU/latency akan seimbang, karena:

- koneksi bisa berdurasi sangat berbeda,
- satu koneksi bisa jauh lebih berat dari koneksi lain,
- protocol bisa punya multiplexing internal,
- client behavior bisa tidak homogen.

---

## 13. Least Connections

```nginx
stream {
    upstream tcp_pool {
        least_conn;

        server 10.0.1.10:9000;
        server 10.0.1.11:9000;
    }

    server {
        listen 9000;
        proxy_pass tcp_pool;
    }
}
```

`least_conn` memilih upstream dengan jumlah active connection paling sedikit.

Ini cocok untuk long-lived connections.

Namun tetap ada caveat:

```text
fewer connections != lower load
```

Satu koneksi bisa membawa traffic berat, sementara sepuluh koneksi lain idle.

---

## 14. Failover Dasar

```nginx
stream {
    upstream tcp_pool {
        server 10.0.1.10:9000 max_fails=3 fail_timeout=10s;
        server 10.0.1.11:9000 max_fails=3 fail_timeout=10s;
    }

    server {
        listen 9000;
        proxy_pass tcp_pool;
        proxy_connect_timeout 3s;
    }
}
```

Makna umum:

- Jika koneksi ke upstream gagal beberapa kali, Nginx sementara menganggap backend unavailable.
- Setelah `fail_timeout`, backend dapat dicoba lagi.

Tapi ini bukan health check semantic.

Nginx stream open source tidak otomatis memahami:

- apakah Postgres node adalah primary,
- apakah Redis node adalah master,
- apakah Kafka broker punya partition leader,
- apakah aplikasi custom siap menerima command,
- apakah backend overloaded tapi masih accept TCP.

Jadi failover L4 hanya memeriksa gejala network/connectivity, bukan correctness application.

---

## 15. Backup Server

```nginx
stream {
    upstream tcp_pool {
        server 10.0.1.10:9000;
        server 10.0.1.11:9000 backup;
    }

    server {
        listen 9000;
        proxy_pass tcp_pool;
    }
}
```

`backup` dipakai jika primary tidak tersedia.

Cocok untuk:

- standby TCP service,
- emergency endpoint,
- migration bridge,
- fallback sementara.

Tidak cocok untuk:

- automatic database primary failover tanpa semantic check,
- Kafka leader failover,
- distributed transaction-aware routing.

---

## 16. Timeouts di Stream

Beberapa directive penting:

```nginx
stream {
    server {
        listen 9000;
        proxy_pass 10.0.1.10:9000;

        proxy_connect_timeout 3s;
        proxy_timeout 1h;
    }
}
```

### 16.1 `proxy_connect_timeout`

Waktu maksimum untuk establish koneksi ke upstream.

Jika terlalu tinggi:

```text
client menunggu lama saat upstream mati
```

Jika terlalu rendah:

```text
koneksi valid bisa gagal saat network lambat sementara
```

### 16.2 `proxy_timeout`

Timeout antara dua operasi read/write pada proxied connection.

Untuk long-lived idle connection, ini sangat penting.

Jika terlalu pendek:

```text
WebSocket-like/custom TCP session putus periodik
```

Jika terlalu panjang:

```text
dead connections bertahan terlalu lama
resource leak lebih lama
```

---

## 17. TCP Keepalive

Ada dua level yang sering tertukar:

1. Application protocol keepalive.
2. TCP keepalive.

Application keepalive adalah pesan pada protocol application.

Contoh:

```text
PING command Redis
heartbeat Kafka
WebSocket ping frame
custom protocol heartbeat
```

TCP keepalive adalah fitur kernel untuk mendeteksi peer mati pada level TCP.

Dalam stream config:

```nginx
stream {
    upstream tcp_pool {
        server 10.0.1.10:9000;
    }

    server {
        listen 9000;
        proxy_pass tcp_pool;
        proxy_socket_keepalive on;
    }
}
```

Gunakan TCP keepalive untuk membantu mendeteksi dead peer, tapi jangan menganggapnya sebagai pengganti application heartbeat.

---

## 18. Logging di Stream

Nginx stream juga bisa punya access log.

Contoh:

```nginx
stream {
    log_format stream_basic '$remote_addr:$remote_port '
                            '[$time_local] '
                            '$protocol '
                            '$status '
                            '$bytes_sent '
                            '$bytes_received '
                            '$session_time '
                            '$upstream_addr';

    access_log /var/log/nginx/stream-access.log stream_basic;
    error_log  /var/log/nginx/stream-error.log warn;

    server {
        listen 9000;
        proxy_pass 10.0.1.10:9000;
    }
}
```

Yang bisa kamu lihat:

- client address,
- protocol TCP/UDP,
- status stream session,
- bytes sent,
- bytes received,
- session time,
- upstream address.

Yang tidak bisa kamu lihat:

- HTTP path,
- SQL query,
- Redis command,
- Kafka topic,
- application error code,
- business operation,
- user id,
- tenant id,
- Java exception.

Ini perbedaan besar dari HTTP logs.

---

## 19. Stream Status Code Bukan HTTP Status Code

Di `http` context, status seperti `200`, `404`, `502`, `504` adalah HTTP status.

Di `stream` context, `$status` bukan HTTP status.

Ia merepresentasikan status session stream di Nginx.

Contoh interpretasi konseptual:

```text
200 -> session completed successfully
400 -> client data could not be parsed in preread/proxy protocol context
500 -> internal server error
502 -> bad gateway/upstream issue
503 -> service unavailable
```

Jangan salah membaca stream status sebagai response application.

Jika Postgres mengembalikan error SQL, Nginx stream belum tentu tahu. Dari perspektif Nginx, session TCP bisa saja sukses.

---

## 20. PROXY Protocol

Masalah umum pada TCP proxy:

```text
Upstream hanya melihat client IP sebagai IP Nginx.
```

Untuk HTTP, kita bisa memakai:

```nginx
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

Tapi pada TCP stream, tidak ada HTTP header.

Solusinya bisa memakai PROXY protocol, jika upstream mendukung.

Konsep:

```text
Client IP metadata dikirim di awal TCP connection sebelum payload application.
```

Contoh Nginx mengirim PROXY protocol ke upstream:

```nginx
stream {
    upstream tcp_backend {
        server 10.0.1.10:9000;
    }

    server {
        listen 9000;
        proxy_pass tcp_backend;
        proxy_protocol on;
    }
}
```

Tapi upstream harus support PROXY protocol.

Jika upstream tidak support, koneksi bisa rusak karena upstream mengira PROXY header sebagai bagian dari protocol application.

Contoh failure:

```text
Nginx sends:
PROXY TCP4 203.0.113.10 10.0.1.10 53000 9000\r\n

Application expects binary protocol first byte.
Application fails protocol parsing.
```

Jangan aktifkan PROXY protocol tanpa kontrak eksplisit dengan upstream.

---

## 21. Menerima PROXY Protocol dari Upstream Load Balancer

Kadang Nginx berada di belakang L4 load balancer yang mengirim PROXY protocol.

Contoh:

```text
External LB -> Nginx stream -> app
```

Konfigurasi listen:

```nginx
stream {
    server {
        listen 9000 proxy_protocol;
        proxy_pass 10.0.1.10:9000;
    }
}
```

Artinya Nginx mengharapkan client upstream/load balancer mengirim PROXY protocol.

Jika traffic biasa masuk tanpa PROXY protocol, parsing gagal.

Jadi ini harus match dengan upstream network contract.

---

## 22. TLS Termination vs TLS Passthrough vs TLS Bridging

Ada tiga pola besar.

### 22.1 TLS Termination di Nginx HTTP

```text
Client --TLS--> Nginx --HTTP--> Java app
```

Nginx melihat HTTP request.

Bisa:

- route by path,
- add headers,
- cache,
- rate limit by URI,
- log status code,
- add security headers.

Tapi TLS end-to-end berhenti di Nginx.

---

### 22.2 TLS Passthrough di Stream

```text
Client --TLS--> Nginx --same TLS--> upstream
```

Nginx tidak decrypt.

Bisa:

- forward TCP,
- route by SNI dengan `ssl_preread`,
- preserve end-to-end TLS.

Tidak bisa:

- see HTTP path,
- set headers,
- cache,
- HTTP rate limit,
- inspect status.

---

### 22.3 TLS Bridging

```text
Client --TLS--> Nginx --new TLS--> upstream
```

Nginx terminate TLS dari client lalu membuat TLS connection baru ke upstream.

Biasanya dilakukan di HTTP context:

```nginx
location / {
    proxy_pass https://backend;
    proxy_ssl_server_name on;
}
```

Nginx tetap melihat HTTP karena TLS pertama diterminate.

Ini berbeda dari passthrough.

---

## 23. SNI Routing Detail

SNI routing sering dipakai untuk menjalankan banyak TLS service di satu IP/port tanpa menaruh certificate di Nginx.

Contoh:

```nginx
stream {
    map $ssl_preread_server_name $target_backend {
        service-a.example.com service_a;
        service-b.example.com service_b;
        default               reject_backend;
    }

    upstream service_a {
        server 10.0.1.10:443;
    }

    upstream service_b {
        server 10.0.1.20:443;
    }

    upstream reject_backend {
        server 127.0.0.1:444;
    }

    server {
        listen 443;
        proxy_pass $target_backend;
        ssl_preread on;
    }
}
```

### Important Caveat

SNI adalah client-provided metadata.

Jangan anggap SNI sebagai authorization.

SNI berguna untuk routing, bukan identity trust.

---

## 24. Handling Unknown SNI

Jangan diam-diam route unknown SNI ke aplikasi utama.

Buruk:

```nginx
map $ssl_preread_server_name $target_backend {
    app.example.com app_backend;
    default         app_backend;
}
```

Masalah:

- domain asing bisa masuk ke aplikasi,
- observability membingungkan,
- attack surface melebar,
- certificate mismatch behavior bisa sulit didiagnosis,
- host/domain inventory tidak jelas.

Lebih baik:

```nginx
map $ssl_preread_server_name $target_backend {
    app.example.com app_backend;
    default         blackhole_backend;
}
```

Atau route ke service yang menutup koneksi.

---

## 25. Stream untuk Database: Useful but Dangerous

Nginx stream bisa meneruskan database traffic.

Contoh Postgres:

```nginx
stream {
    upstream postgres_backend {
        server 10.0.1.20:5432;
    }

    server {
        listen 5432;
        proxy_pass postgres_backend;
    }
}
```

Ini bisa berguna untuk:

- temporary migration,
- development tunnel,
- controlled admin access,
- network segmentation,
- simple forwarding,
- hiding internal IP.

Tapi jangan otomatis menganggap ini sebagai database HA.

---

## 26. Mengapa Database Tidak Sesederhana TCP Endpoint?

Database session punya state.

Contoh Postgres connection bisa memiliki:

- authenticated user,
- selected database,
- session variables,
- prepared statements,
- open transaction,
- advisory locks,
- temporary tables,
- cursor,
- transaction isolation level,
- role settings.

Jika koneksi putus dan dialihkan ke backend lain, state tersebut hilang.

Nginx stream tidak bisa memindahkan session database.

Failure example:

```text
1. Java app opens transaction through Nginx stream.
2. Transaction writes several rows.
3. TCP connection drops.
4. App retries at application layer.
5. Retry goes to another DB node.
6. Application may see inconsistent state depending on commit/rollback result.
```

Ini bukan masalah yang bisa diselesaikan hanya dengan `max_fails`.

---

## 27. Postgres Caveats

Untuk Postgres, hati-hati terhadap:

- primary vs replica routing,
- read/write split,
- transaction state,
- prepared statements,
- connection pool behavior,
- failover detection,
- replication lag,
- session-level settings,
- TLS requirements,
- client IP logging,
- authentication source.

Jika butuh database HA, biasanya tool yang lebih tepat:

- managed database endpoint,
- PgBouncer untuk pooling tertentu,
- HAProxy dengan health check khusus,
- Patroni-aware routing,
- cloud database proxy,
- database-native failover mechanism,
- application-level retry dengan idempotency.

Nginx stream mungkin bisa menjadi komponen tambahan, tapi jarang menjadi solusi lengkap.

---

## 28. MySQL/MariaDB Caveats

Mirip Postgres, MySQL/MariaDB punya:

- transaction state,
- session variables,
- user variables,
- temporary tables,
- prepared statements,
- replication role,
- read/write routing concerns,
- failover semantics.

Nginx stream dapat forward TCP, tapi tidak tahu:

```sql
SELECT ...
INSERT ...
BEGIN
COMMIT
ROLLBACK
```

Jadi Nginx stream tidak bisa melakukan read/write split berbasis SQL.

---

## 29. Redis Caveats

Redis tampak sederhana karena protocol-nya cepat dan berbasis TCP. Tapi tetap banyak caveat:

- standalone vs sentinel vs cluster,
- master/replica role,
- MOVED/ASK redirection di cluster,
- pub/sub long-lived connections,
- blocking commands,
- Lua scripts,
- transaction-like MULTI/EXEC,
- connection pooling,
- client library topology awareness.

Jika Redis Cluster, client biasanya perlu tahu topology node. Menaruh Nginx stream di depan bisa mengganggu topology behavior jika tidak dirancang dengan benar.

Gunakan Nginx stream untuk Redis hanya jika kamu paham pattern traffic dan client behavior.

---

## 30. Kafka Caveats

Kafka sangat tidak cocok dipandang sebagai sekadar TCP service tunggal.

Kafka client melakukan:

- bootstrap ke broker,
- metadata fetch,
- connect ke broker spesifik,
- partition leader routing,
- advertised listeners resolution,
- long-lived connections,
- protocol-specific correlation.

Masalah umum jika Kafka ditaruh di balik proxy yang tidak paham Kafka:

```text
Client connects to proxy bootstrap endpoint.
Broker returns advertised listener internal-broker-1:9092.
Client tries to connect to internal address unreachable from client network.
```

Nginx stream bisa dipakai dalam beberapa deployment Kafka yang sangat terkontrol, tapi sering kali masalah sebenarnya ada di `advertised.listeners`, DNS, networking, dan client topology.

Untuk Kafka, jangan gunakan Nginx stream sebagai “quick fix” sebelum memahami bootstrap dan advertised listener model.

---

## 31. MQTT and Custom Protocols

Nginx stream bisa berguna untuk MQTT/custom TCP jika:

- protocol long-lived,
- routing cukup berdasarkan port/SNI/IP,
- tidak butuh inspect message topic,
- broker/upstream tahu cara menangani session,
- client reconnect behavior aman,
- heartbeat disetel benar.

Tapi jika butuh routing berdasarkan MQTT topic, user, tenant, QoS, atau payload, Nginx stream tidak cukup.

Butuh broker/gateway yang paham MQTT.

---

## 32. Stream and Java Custom TCP Services

Kadang Java system punya custom binary protocol di atas TCP.

Contoh:

```text
Netty server listening on 9000
Custom framed protocol
Internal clients send binary messages
```

Nginx stream bisa forward:

```nginx
stream {
    upstream netty_backend {
        server 10.0.1.10:9000;
        server 10.0.1.11:9000;
    }

    server {
        listen 9000;
        proxy_pass netty_backend;
        proxy_timeout 30m;
    }
}
```

Yang perlu dipastikan:

- Apakah protocol connection-oriented?
- Apakah session state melekat pada satu backend?
- Apakah client boleh reconnect ke backend berbeda?
- Apakah message idempotent?
- Apakah ada heartbeat?
- Apakah backpressure ditangani?
- Apakah load balancing per connection cukup?
- Apakah observability di Java cukup untuk menggantikan lack of L7 logs di Nginx?

---

## 33. Long-Lived Connection Load Balancing

Dalam stream mode, long-lived connection bisa membuat load imbalance.

Contoh:

```text
backend A: 10 connections, each very heavy
backend B: 50 connections, mostly idle
```

Dengan round-robin, distribusi koneksi belum tentu distribusi beban.

Dengan least_conn, distribusi juga belum tentu sempurna karena satu koneksi bisa sangat berat.

Untuk long-lived heavy protocol, kamu perlu observability dari upstream application:

- active sessions,
- bytes per session,
- CPU per backend,
- queue depth,
- event loop lag,
- message rate,
- backpressure signal,
- dropped connections.

Nginx hanya memberi sebagian gambaran.

---

## 34. Backpressure di Stream Proxy

Pada TCP, backpressure terjadi natural lewat TCP flow control.

Jika upstream lambat membaca:

```text
upstream receive buffer fills
nginx cannot write more quickly
nginx buffers/blocks according to event loop mechanics
client eventually slows down
```

Tapi ini bukan magic.

Jika banyak client mengirim data cepat sementara upstream lambat:

- Nginx memory pressure bisa naik,
- socket buffers penuh,
- latency naik,
- connection timeout bisa terjadi,
- client retry bisa memperparah beban,
- upstream bisa overload.

Untuk custom Java TCP service, desain application-level backpressure tetap penting.

---

## 35. UDP: Stateless Does Not Mean Simple

UDP tidak punya koneksi TCP.

Nginx perlu mengasosiasikan datagram client dengan upstream response dalam waktu tertentu.

Contoh DNS:

```nginx
stream {
    upstream dns_pool {
        server 10.0.1.53:53;
        server 10.0.1.54:53;
    }

    server {
        listen 53 udp;
        proxy_pass dns_pool;
        proxy_timeout 5s;
    }
}
```

UDP cocok jika:

- request-response singkat,
- payload kecil,
- retry handled by client,
- packet loss acceptable,
- upstream stateless atau state minimal.

Tidak cocok jika:

- protocol butuh ordering,
- session state kompleks,
- datagram fragmentation sering,
- observability detail diperlukan,
- reliability harus dijamin proxy.

---

## 36. DNS Proxying Example

Contoh DNS forwarder:

```nginx
stream {
    upstream internal_dns {
        server 10.0.0.10:53;
        server 10.0.0.11:53;
    }

    server {
        listen 53 udp;
        proxy_pass internal_dns;
        proxy_timeout 2s;
        proxy_responses 1;
    }
}
```

`proxy_responses 1` berguna untuk UDP request-response model seperti DNS: satu request biasanya menghasilkan satu response.

Namun untuk protocol UDP yang menghasilkan banyak response, setting ini harus disesuaikan.

---

## 37. Access Control di Stream

Kamu bisa menggunakan allow/deny di stream context.

```nginx
stream {
    server {
        listen 5432;

        allow 10.0.0.0/8;
        deny all;

        proxy_pass 10.0.1.20:5432;
    }
}
```

Ini berguna untuk membatasi database/admin TCP access.

Tapi ingat:

```text
IP allowlist is network control, not identity authorization.
```

Jika akses harus berbasis user, role, tenant, atau command, harus dilakukan di application/protocol layer.

---

## 38. Stream Rate Limiting?

Rate limiting di stream tidak sama kaya HTTP `limit_req` berdasarkan URI.

Di L4, kamu bisa membatasi koneksi, bukan semantic request.

Misalnya membatasi jumlah connection per IP dengan `limit_conn` pada stream jika modul/konfigurasi tersedia.

Namun kamu tidak bisa secara native mengatakan:

```text
limit only LOGIN command
limit only expensive query
limit only Kafka produce to topic X
```

Karena Nginx stream tidak memahami command tersebut.

Untuk semantic throttling, implement di application/protocol-aware gateway.

---

## 39. Observability Gap: Apa yang Hilang di L4

Di HTTP reverse proxy, kamu bisa melihat:

```text
method path status upstream_status request_time upstream_response_time
```

Di stream proxy, kamu biasanya melihat:

```text
client upstream bytes session_time stream_status
```

Perbedaannya besar.

Jika ada user komplain:

```text
“Query order report lambat.”
```

Di HTTP proxy, kamu mungkin bisa mencari:

```text
GET /reports/orders?...
upstream_response_time=12.4
status=200
```

Di stream proxy ke database, Nginx hanya tahu:

```text
client connection existed for 300s
bytes in/out changed
```

Nginx tidak tahu query mana yang lambat.

Maka untuk L4 proxy, observability harus dipindahkan ke:

- application logs,
- database logs,
- protocol-level metrics,
- client instrumentation,
- upstream service metrics,
- distributed tracing jika applicable.

---

## 40. Failure Mode: Upstream Accepts TCP but Application Broken

Salah satu failure paling berbahaya:

```text
TCP connect succeeds.
Application cannot serve correctly.
```

Contoh:

- database accepts connection but is read-only,
- Redis accepts connection but is replica,
- custom Java server accepts socket but worker pool saturated,
- Kafka broker accepts connection but not partition leader,
- upstream accepts TLS but certificate invalid for expected name,
- application event loop stuck after accept.

Nginx stream bisa menganggap upstream sehat karena koneksi berhasil.

Application tetap gagal.

Ini alasan kenapa L4 health tidak cukup untuk semantic health.

---

## 41. Failure Mode: Retry Storm

Misalnya:

```text
Client -> Nginx stream -> database
```

Database lambat. Client timeout. Client retry. Nginx membuka koneksi baru. Database makin berat. Lebih banyak timeout. Lebih banyak retry.

Ini retry storm.

Mitigasi:

- client retry harus bounded,
- exponential backoff,
- jitter,
- circuit breaker,
- connection pool limit,
- server-side timeout,
- proper queue limits,
- observability pada saturation,
- jangan hanya menaikkan timeout.

Nginx stream bukan circuit breaker semantic.

---

## 42. Failure Mode: Connection Drain Saat Deploy

Untuk long-lived TCP connections, deploy backend bisa memutus banyak client.

HTTP request biasanya pendek.

TCP session bisa berlangsung:

- menit,
- jam,
- hari.

Jika backend di-restart:

```text
all sessions to that backend drop
clients reconnect
reconnect storm happens
```

Desain yang perlu:

- graceful shutdown upstream,
- drain existing sessions,
- stop accepting new connections sebelum shutdown,
- readiness/liveness distinction,
- client reconnect with jitter,
- session resumption strategy,
- state recovery.

Nginx stream sendiri tidak bisa menyelamatkan session state backend yang hilang.

---

## 43. Failure Mode: Misleading Success

Stream logs bisa menunjukkan:

```text
status=200 session_time=0.120
```

Tapi application-level operation bisa gagal.

Contoh:

```text
Redis command returns WRONGTYPE error.
Postgres query returns constraint violation.
Custom protocol returns business error.
```

Dari perspektif TCP, session sukses.

Dari perspektif business, operasi gagal.

Jangan jadikan stream status sebagai business success metric.

---

## 44. Failure Mode: PROXY Protocol Mismatch

Kasus 1:

```text
Nginx sends PROXY protocol.
Upstream does not expect it.
```

Akibat:

- protocol parse error,
- connection reset,
- weird application error,
- binary protocol corruption.

Kasus 2:

```text
Nginx expects PROXY protocol on listen.
Client does not send it.
```

Akibat:

- connection rejected,
- stream status error,
- confusing client failure.

Rule:

```text
PROXY protocol must be agreed on both sides of the connection boundary.
```

---

## 45. Failure Mode: SNI Missing

Tidak semua client mengirim SNI.

Kasus:

```text
Legacy TLS client connects without SNI.
```

Jika config bergantung pada `$ssl_preread_server_name`, value bisa kosong.

Pastikan ada default behavior.

Contoh:

```nginx
map $ssl_preread_server_name $target_backend {
    app.example.com app_backend;
    ""              legacy_or_reject_backend;
    default         reject_backend;
}
```

Jangan lupa case empty string.

---

## 46. Failure Mode: DNS Resolution in Stream Upstreams

Jika memakai hostname di upstream:

```nginx
upstream tcp_backend {
    server app.internal.example:9000;
}
```

Perhatikan kapan DNS resolved, bagaimana perubahan IP dipick up, dan apakah butuh resolver dynamic.

Untuk environment container/Kubernetes, DNS behavior penting.

Jika IP pod/service berubah tapi Nginx tidak reload atau tidak resolve ulang sesuai kebutuhan, traffic bisa tetap ke endpoint lama.

Di Kubernetes, lebih umum proxy ke Service DNS/ClusterIP, bukan langsung ke Pod IP, kecuali ada alasan kuat.

---

## 47. Stream in Kubernetes

Ada beberapa pola:

### 47.1 Nginx sebagai Deployment TCP Proxy

```text
Client -> Service -> Nginx Pod -> internal TCP Service
```

Cocok untuk:

- exposing TCP service dengan aturan khusus,
- TLS passthrough routing,
- compatibility bridge.

### 47.2 Ingress Controller TCP/UDP Mapping

Beberapa NGINX Ingress Controller mendukung TCP/UDP service mapping melalui ConfigMap.

Namun detailnya bergantung controller.

Jangan samakan konfigurasi open source Nginx biasa dengan konfigurasi NGINX Ingress Controller.

### 47.3 Service LoadBalancer Lebih Sederhana

Untuk banyak TCP service, Kubernetes `Service type=LoadBalancer` bisa lebih sederhana daripada Nginx stream.

Gunakan Nginx stream jika memang butuh behavior tambahan:

- SNI routing,
- proxy protocol bridging,
- custom logging,
- centralized port exposure,
- special timeout/routing.

---

## 48. Stream vs HAProxy vs Envoy vs Cloud Load Balancer

Nginx stream bukan satu-satunya opsi.

### 48.1 Nginx Stream

Kuat untuk:

- simple TCP/UDP proxy,
- TLS passthrough,
- SNI routing,
- simple L4 load balancing,
- familiar Nginx operational model.

Kurang kuat untuk:

- advanced active health checks di open source edition,
- rich L4/L7 telemetry dibanding proxy modern tertentu,
- protocol-aware routing non-HTTP,
- service mesh-level features.

### 48.2 HAProxy

Sering kuat untuk:

- TCP load balancing,
- advanced health checks,
- mature L4/L7 behavior,
- database-aware check patterns tertentu,
- detailed balancing controls.

### 48.3 Envoy

Sering kuat untuk:

- service mesh,
- dynamic config xDS,
- rich telemetry,
- L4/L7 filters,
- mTLS mesh,
- advanced routing.

### 48.4 Cloud Load Balancer

Sering cocok untuk:

- managed L4 exposure,
- HA managed by cloud,
- integration dengan cloud networking,
- lower operational burden.

Decision rule:

```text
Use the simplest component that understands enough of the problem.
```

Jika butuh L4 forwarding sederhana, Nginx stream cukup.

Jika butuh protocol-aware correctness, cari tool yang paham protocol tersebut.

---

## 49. Design Decision Framework

Sebelum memakai Nginx stream, jawab pertanyaan ini.

### 49.1 Protocol

- Protocol apa yang lewat?
- TCP atau UDP?
- Stateless atau stateful?
- Long-lived atau short-lived?
- Binary atau text?
- Ada TLS atau tidak?
- Ada SNI atau tidak?

### 49.2 Routing

- Routing berdasarkan apa?
- Port?
- IP?
- SNI?
- Client source?
- Butuh route berdasarkan command/message/path/header?

Jika butuh route berdasarkan semantic payload, stream tidak cukup.

### 49.3 State

- Apakah session state melekat pada backend?
- Apakah reconnect ke backend lain aman?
- Apakah operation idempotent?
- Apakah transaction bisa hilang?
- Apakah client library topology-aware?

### 49.4 Failure

- Apa arti upstream sehat?
- Apakah TCP connect cukup?
- Apakah butuh application-level health check?
- Apa yang terjadi saat upstream restart?
- Apa yang terjadi saat connection drop?
- Apakah client retry aman?

### 49.5 Observability

- Apa yang perlu dilog?
- Apakah bytes/session_time cukup?
- Di mana melihat application error?
- Bagaimana korelasi client session dengan upstream logs?
- Apakah perlu tracing?

### 49.6 Security

- Apakah TLS terminated atau passthrough?
- Apakah client IP perlu dipreservasi?
- Apakah upstream support PROXY protocol?
- Apakah IP allowlist cukup?
- Apakah perlu authentication application-level?

---

## 50. Pattern: Simple TCP Facade

Use case:

```text
Expose internal TCP service through stable endpoint.
```

Config:

```nginx
stream {
    log_format stream_main '$remote_addr:$remote_port '
                           'to=$upstream_addr '
                           'status=$status '
                           'bytes_sent=$bytes_sent '
                           'bytes_received=$bytes_received '
                           'session_time=$session_time';

    access_log /var/log/nginx/tcp-access.log stream_main;

    upstream internal_service {
        server 10.0.1.10:9000;
    }

    server {
        listen 9000;
        proxy_connect_timeout 3s;
        proxy_timeout 10m;
        proxy_pass internal_service;
    }
}
```

Good when:

- simple forwarding,
- no semantic routing,
- internal tool,
- controlled clients.

Bad when:

- business-critical HA depends on proxy,
- protocol state is complex,
- failure semantics unknown.

---

## 51. Pattern: TLS Passthrough with SNI Routing

Use case:

```text
Multiple TLS services share one external IP:443.
Certificates remain on upstream services.
```

Config:

```nginx
stream {
    map $ssl_preread_server_name $backend {
        app-a.example.com app_a;
        app-b.example.com app_b;
        default           reject;
    }

    upstream app_a {
        server 10.0.1.10:443;
    }

    upstream app_b {
        server 10.0.1.20:443;
    }

    upstream reject {
        server 127.0.0.1:444;
    }

    server {
        listen 443;
        proxy_pass $backend;
        ssl_preread on;
        proxy_connect_timeout 3s;
        proxy_timeout 1h;
    }
}
```

Good when:

- need end-to-end TLS,
- route by hostname only,
- cannot terminate TLS at Nginx.

Bad when:

- need path routing,
- need HTTP headers,
- need centralized HTTP auth,
- need Nginx cache/compression/rate limit.

---

## 52. Pattern: Controlled Database Jump Proxy

Use case:

```text
Allow specific internal network to access database endpoint through controlled Nginx node.
```

Config:

```nginx
stream {
    log_format db_stream '$remote_addr:$remote_port '
                         'to=$upstream_addr '
                         'status=$status '
                         'bytes_sent=$bytes_sent '
                         'bytes_received=$bytes_received '
                         'session_time=$session_time';

    access_log /var/log/nginx/db-stream-access.log db_stream;

    upstream postgres_primary_endpoint {
        server 10.0.10.20:5432;
    }

    server {
        listen 5432;

        allow 10.20.0.0/16;
        deny all;

        proxy_connect_timeout 3s;
        proxy_timeout 2h;
        proxy_pass postgres_primary_endpoint;
    }
}
```

This is not database HA.

It is a controlled forwarding point.

---

## 53. Pattern: UDP DNS Forwarder

Use case:

```text
Forward DNS requests to internal resolvers.
```

Config:

```nginx
stream {
    upstream dns_resolvers {
        server 10.0.0.10:53;
        server 10.0.0.11:53;
    }

    server {
        listen 53 udp;
        proxy_pass dns_resolvers;
        proxy_timeout 2s;
        proxy_responses 1;
    }
}
```

Good when:

- simple request-response UDP,
- resolver endpoints stable,
- limited scope.

Bad when:

- need full DNS policy engine,
- need DNSSEC validation at proxy,
- need complex split-horizon logic.

---

## 54. Java Engineer Perspective: Impact on Client Libraries

Nginx stream can change what Java clients observe.

### 54.1 Remote Address

Without PROXY protocol, backend sees Nginx IP.

If Java service uses client IP for:

- audit,
- rate limiting,
- allowlist,
- fraud detection,
- tenant mapping,

then stream proxy may break assumptions.

### 54.2 TLS Identity

With TLS passthrough:

- Java upstream sees original TLS client.
- Nginx cannot inspect HTTP.

With TLS termination:

- Java app may only see Nginx as peer.
- Client certificate handling changes.

### 54.3 Connection Pooling

Java clients often use connection pools.

Nginx stream load balances at connection creation.

If a Java client opens a pool of 10 connections, distribution happens for those 10 connections only.

If one JVM opens long-lived pool at startup, traffic distribution may stay sticky for a long time.

### 54.4 Retry Semantics

If stream connection drops, Java client library may retry automatically.

Make sure retry is safe:

- idempotent operation,
- transaction state known,
- duplicate request safe,
- timeout bounded,
- backoff and jitter enabled.

---

## 55. Checklist: Before Using Nginx Stream in Production

Use this checklist.

### Protocol

- [ ] I know whether traffic is TCP or UDP.
- [ ] I know whether protocol is stateless or stateful.
- [ ] I know whether connection can be safely retried.
- [ ] I know whether client library expects topology awareness.

### Routing

- [ ] Routing by port/IP/SNI is enough.
- [ ] I do not need HTTP path/header/cookie routing.
- [ ] I do not need SQL/Redis/Kafka command awareness.

### TLS

- [ ] I know whether TLS is terminated, passed through, or bridged.
- [ ] If using SNI routing, unknown and empty SNI are handled.
- [ ] Certificate ownership is clear.

### Client IP

- [ ] I know whether upstream needs real client IP.
- [ ] If yes, upstream supports PROXY protocol or another mechanism.
- [ ] PROXY protocol expectation is configured consistently.

### Timeout

- [ ] `proxy_connect_timeout` is set intentionally.
- [ ] `proxy_timeout` matches session behavior.
- [ ] Long-lived idle sessions are accounted for.

### Failure

- [ ] TCP connect success is not mistaken for application health.
- [ ] Backend restart behavior is understood.
- [ ] Client reconnect behavior is safe.
- [ ] Retry storm risk is mitigated.

### Observability

- [ ] Stream access logs are configured.
- [ ] Upstream application/database logs cover semantic errors.
- [ ] Metrics exist for connection count, session duration, bytes, and upstream health.
- [ ] There is a runbook for diagnosing L4 failures.

### Security

- [ ] Access control is configured where needed.
- [ ] Exposed ports are intentional.
- [ ] Nginx is not exposing internal services accidentally.
- [ ] Stream proxy is not replacing real authentication/authorization.

---

## 56. Debugging Stream Proxy

Useful commands.

### 56.1 Check Listening Ports

```bash
ss -lntup | grep nginx
```

For TCP:

```bash
ss -lntp
```

For UDP:

```bash
ss -lnup
```

---

### 56.2 Test TCP Connectivity

```bash
nc -vz nginx.example.com 9000
```

Or:

```bash
telnet nginx.example.com 9000
```

For TLS:

```bash
openssl s_client -connect nginx.example.com:443 -servername app.example.com
```

---

### 56.3 Verify SNI Routing

```bash
openssl s_client -connect nginx.example.com:443 -servername app-a.example.com
```

Then:

```bash
openssl s_client -connect nginx.example.com:443 -servername app-b.example.com
```

Compare certificate/upstream behavior.

If using passthrough, certificate shown is upstream certificate, not Nginx certificate.

---

### 56.4 Capture Traffic Metadata

```bash
sudo tcpdump -i any port 9000
```

For deeper packet analysis:

```bash
sudo tcpdump -i any -nn host 10.0.1.10 and port 9000
```

Be careful with sensitive traffic.

---

### 56.5 Check Effective Config

```bash
nginx -T
```

Look for:

- `stream` block exists,
- correct `listen`,
- correct `proxy_pass`,
- correct `map`,
- correct `ssl_preread on`,
- correct allow/deny,
- expected includes.

---

## 57. Common Mistakes

### Mistake 1: Putting `stream` inside `http`

Wrong:

```nginx
http {
    stream {
        ...
    }
}
```

Correct:

```nginx
http {
    ...
}

stream {
    ...
}
```

---

### Mistake 2: Expecting HTTP Variables in Stream

In stream, do not expect HTTP variables like:

```text
$uri
$request_method
$http_authorization
$upstream_status as HTTP semantics
```

They are not available because Nginx is not parsing HTTP in `stream`.

---

### Mistake 3: Using Stream When HTTP Proxy Is Needed

If you need:

- path routing,
- header injection,
- JWT validation,
- CORS handling,
- HTTP cache,
- response header rewrite,

use `http`, not `stream`.

---

### Mistake 4: Treating Stream as Database HA

Nginx stream is not database cluster manager.

It does not understand database role, replication, transaction state, or query semantics.

---

### Mistake 5: Forgetting SNI Missing Case

Always handle:

```nginx
"" default_for_no_sni;
default reject;
```

---

### Mistake 6: PROXY Protocol Mismatch

Never enable PROXY protocol unless both sides expect it.

---

### Mistake 7: No Stream Logs

Without stream logs, debugging becomes guesswork.

At minimum log:

- remote address,
- upstream address,
- status,
- bytes sent/received,
- session time.

---

## 58. Design Exercise 1: TLS Passthrough for Two Apps

Requirement:

```text
- One public IP.
- Port 443.
- app1.example.com certificate lives on app1 backend.
- app2.example.com certificate lives on app2 backend.
- Nginx must not terminate TLS.
```

Solution shape:

```nginx
stream {
    map $ssl_preread_server_name $backend {
        app1.example.com app1;
        app2.example.com app2;
        default          reject;
    }

    upstream app1 {
        server 10.0.1.10:443;
    }

    upstream app2 {
        server 10.0.1.20:443;
    }

    upstream reject {
        server 127.0.0.1:444;
    }

    server {
        listen 443;
        proxy_pass $backend;
        ssl_preread on;
    }
}
```

Reasoning:

- Route by SNI only.
- No TLS termination.
- No HTTP inspection.
- Unknown SNI rejected.

---

## 59. Design Exercise 2: Java Netty TCP Service

Requirement:

```text
- Java Netty service on port 9100.
- Two backend nodes.
- Long-lived sessions.
- Some clients idle for 30 minutes.
- Need basic logging.
```

Possible config:

```nginx
stream {
    log_format netty_stream '$remote_addr:$remote_port '
                            'upstream=$upstream_addr '
                            'status=$status '
                            'sent=$bytes_sent '
                            'received=$bytes_received '
                            'session_time=$session_time';

    access_log /var/log/nginx/netty-stream.log netty_stream;

    upstream netty_pool {
        least_conn;
        server 10.0.2.10:9100;
        server 10.0.2.11:9100;
    }

    server {
        listen 9100;
        proxy_pass netty_pool;
        proxy_connect_timeout 3s;
        proxy_timeout 45m;
        proxy_socket_keepalive on;
    }
}
```

Reasoning:

- `least_conn` helps long-lived connections more than round-robin.
- `proxy_timeout` exceeds expected idle time.
- Logs capture session-level metadata.
- Java service still needs application-level heartbeat and metrics.

---

## 60. Design Exercise 3: Postgres Admin Forwarder

Requirement:

```text
- Only internal admin subnet can connect.
- Nginx forwards to one Postgres endpoint.
- This is not HA, only controlled access.
```

Possible config:

```nginx
stream {
    upstream postgres_admin_target {
        server 10.0.10.20:5432;
    }

    server {
        listen 15432;

        allow 10.50.0.0/16;
        deny all;

        proxy_connect_timeout 3s;
        proxy_timeout 2h;
        proxy_pass postgres_admin_target;
    }
}
```

Reasoning:

- External port `15432` avoids pretending this is the real database endpoint.
- IP allowlist limits exposure.
- No load balancing because database role semantics are not handled.

---

## 61. Production Runbook: Stream Incident Triage

When stream traffic fails, ask in this order.

### Step 1: Is Nginx Listening?

```bash
ss -lntup | grep ':PORT'
```

If not:

- wrong config include,
- stream module not loaded/available,
- config reload failed,
- port conflict,
- permission issue for low port.

### Step 2: Can Client Reach Nginx?

```bash
nc -vz nginx-host PORT
```

If not:

- firewall,
- security group,
- Kubernetes Service,
- DNS,
- routing,
- wrong port.

### Step 3: Can Nginx Reach Upstream?

From Nginx host/container:

```bash
nc -vz upstream-host upstream-port
```

If not:

- upstream down,
- network policy,
- wrong DNS,
- wrong port,
- firewall.

### Step 4: Does Protocol Handshake Work?

For TLS:

```bash
openssl s_client -connect nginx-host:443 -servername expected.name
```

For database:

```bash
psql -h nginx-host -p 5432 ...
```

For Redis:

```bash
redis-cli -h nginx-host -p 6379 ping
```

Use protocol-native clients when possible.

### Step 5: Check Logs

Look at:

- stream access log,
- stream error log,
- upstream application log,
- client log,
- system logs.

### Step 6: Classify Failure

Is it:

- connection refused,
- timeout,
- TLS handshake failure,
- protocol parse failure,
- authentication failure,
- application semantic failure,
- retry storm,
- resource exhaustion?

Different class, different fix.

---

## 62. Summary Mental Model

Nginx `stream` module is powerful, but intentionally lower-level.

Core rule:

```text
Use stream when forwarding connections is enough.
Do not use stream when the proxy must understand application meaning.
```

HTTP context answers:

```text
What request is this?
Where should this path/header/method go?
What status did the app return?
Can I cache/compress/rewrite/limit this response?
```

Stream context answers:

```text
Who connected?
Which upstream socket should receive this connection/datagram?
How many bytes moved?
How long did the session last?
Did the network-level forwarding succeed?
```

That difference determines everything.

---

## 63. What You Should Be Able to Do Now

After this part, you should be able to:

- Explain the difference between `http` and `stream` contexts.
- Configure a basic TCP proxy.
- Configure a basic UDP proxy.
- Configure SNI-based TLS passthrough.
- Explain why TLS passthrough disables HTTP-level features.
- Explain why Nginx stream is not database HA.
- Identify PROXY protocol mismatch risks.
- Design basic stream logs.
- Reason about long-lived connection load balancing.
- Decide when to use Nginx stream vs another component.

---

## 64. Part 026 Closing

Bagian ini menambahkan satu dimensi penting: Nginx bukan hanya HTTP reverse proxy. Ia juga dapat menjadi L4 TCP/UDP proxy melalui `stream` module.

Namun semakin rendah layer-nya, semakin sedikit semantic yang Nginx pahami.

Itu membuat stream proxy sangat berguna untuk forwarding, passthrough, dan simple L4 routing, tetapi berbahaya jika dipakai untuk menggantikan komponen yang seharusnya memahami protocol application.

Di part berikutnya, kita akan naik ke level engineering practice: bagaimana mendesain konfigurasi Nginx untuk sistem besar agar maintainable, reviewable, testable, aman, dan tidak berubah menjadi config spaghetti.

Next:

```text
Part 027 — Config Design Patterns for Large Systems
```
