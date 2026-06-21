# learn-docker-mastery-for-java-engineers-part-012.md

# Part 012 — Docker Networking: Bridge, Host, None, DNS, Port Publishing

> Series: `learn-docker-mastery-for-java-engineers`  
> Audience: Java software engineer / tech lead  
> Focus: Docker networking mental model, runtime diagnosis, and production-grade reasoning  
> Status: Part 012 dari 031

---

## 0. Tujuan Bagian Ini

Di bagian sebelumnya kita sudah membahas filesystem, volume, writable layer, bind mount, dan state. Sekarang kita masuk ke salah satu sumber kebingungan terbesar dalam Docker: **networking**.

Banyak masalah Docker yang terlihat seperti:

- aplikasi Java sudah running, tetapi browser tidak bisa akses;
- container A tidak bisa connect ke container B;
- `localhost` bekerja di host tetapi gagal dari container;
- `EXPOSE 8080` ada di Dockerfile tetapi port tetap tidak bisa diakses;
- Compose service bisa ping nama service, tetapi tidak bisa dari host;
- app bind ke port benar tetapi connection refused;
- app jalan di Docker Desktop tetapi gagal di Linux server;
- app jalan di satu laptop tetapi konflik port di laptop lain.

Kesalahan dasarnya hampir selalu sama: engineer belum membedakan dengan jelas antara:

1. **container network namespace**;
2. **container IP**;
3. **host IP**;
4. **application bind address**;
5. **container port**;
6. **host published port**;
7. **Docker network**;
8. **DNS name inside Docker network**;
9. **routing/NAT dari host ke container**;
10. **visibility antar container vs visibility dari luar host**.

Bagian ini tidak akan mengulang materi HTTP, TCP, Nginx, atau Linux networking secara mendalam. Fokusnya adalah: **bagaimana Docker membentuk network boundary, bagaimana aplikasi Java harus bind dan discover dependency, serta bagaimana mendiagnosis failure secara sistematis.**

---

## 1. Mental Model Utama: Container Punya Network Stack Sendiri

Container bukan hanya proses yang berjalan di filesystem terisolasi. Container juga biasanya berjalan dalam **network namespace** tersendiri.

Artinya, dari perspektif proses di dalam container, ia melihat:

- interface jaringan sendiri;
- IP address sendiri;
- routing table sendiri;
- DNS resolver sendiri;
- port listening sendiri;
- `localhost` sendiri.

Ini sangat penting.

Ketika aplikasi Java di dalam container melakukan:

```text
server.address=127.0.0.1
server.port=8080
```

maka ia bind ke `127.0.0.1` **milik container**, bukan `127.0.0.1` milik host.

Ketika aplikasi Java di dalam container melakukan:

```java
HttpClient.newHttpClient()
    .send(HttpRequest.newBuilder(URI.create("http://localhost:5432")).build(), ...)
```

maka `localhost` mengarah ke container itu sendiri, bukan ke database di host, bukan ke database container lain, dan bukan ke Compose service lain.

Inilah akar dari banyak bug local Docker.

### Analogi sederhana

Bayangkan host dan setiap container seperti mesin yang berbeda di jaringan virtual.

- Host punya `localhost` sendiri.
- Container A punya `localhost` sendiri.
- Container B punya `localhost` sendiri.
- Container A tidak bisa mengakses service di Container B lewat `localhost`.
- Container A harus mengakses Container B lewat IP atau DNS name pada Docker network.

Jadi, kalimat paling penting di bagian ini:

> Di Docker, `localhost` selalu berarti “network namespace tempat proses itu berjalan”.

Bukan “laptop saya”.  
Bukan “host Docker”.  
Bukan “service lain”.  
Bukan “Compose project”.

---

## 2. Docker Networking dalam Satu Gambar Mental

Untuk aplikasi Java sederhana:

```text
Host machine
│
├── Docker daemon
│
├── docker0 / user-defined bridge
│   │
│   ├── container: app
│   │   ├── IP: 172.x.x.2
│   │   ├── listens: 0.0.0.0:8080 inside container
│   │   └── localhost: container loopback
│   │
│   └── container: postgres
│       ├── IP: 172.x.x.3
│       ├── listens: 0.0.0.0:5432 inside container
│       └── DNS name: postgres, if on user-defined network
│
└── host published port
    └── 127.0.0.1:8080 or 0.0.0.0:8080 -> container app:8080
```

Ada dua jalur komunikasi yang harus dipisahkan:

### Jalur 1 — Host ke container

Contoh:

```text
Browser on host -> localhost:8080 -> Docker published port -> app container:8080
```

Ini butuh **port publishing**.

### Jalur 2 — Container ke container

Contoh:

```text
app container -> postgres:5432 -> postgres container:5432
```

Ini tidak butuh publish port ke host jika kedua container berada di Docker network yang sama.

Banyak developer salah kaprah dengan berpikir:

> “Agar app container bisa connect ke postgres container, port postgres harus dipublish ke host.”

Tidak. Untuk container-to-container communication pada user-defined network, service cukup listen di container port dan reachable lewat network internal Docker.

Port publishing diperlukan untuk akses **dari luar Docker network**, misalnya dari host, browser, curl lokal, IDE, atau service eksternal.

---

## 3. Docker Network Drivers: Bridge, Host, None

Docker mendukung beberapa network driver. Untuk seri ini, tiga yang paling penting adalah:

1. `bridge`
2. `host`
3. `none`

Ada juga overlay, ipvlan, macvlan, dan plugin driver, tetapi itu lebih relevan untuk orkestrasi multi-host, advanced networking, atau platform networking. Kita akan menyentuh hanya sebagai konteks.

---

## 4. Bridge Network: Default Mental Model untuk Local Development

`bridge` adalah mode networking paling umum saat menjalankan container di satu host.

Dengan bridge network:

- container mendapatkan IP internal pada network virtual;
- container dapat keluar ke internet melalui host NAT;
- container dapat berkomunikasi dengan container lain di network yang sama;
- host dapat mengakses container jika port dipublish;
- container biasanya tidak langsung terlihat dari jaringan luar tanpa port publishing/routing tambahan.

Docker documentation menjelaskan bahwa container networking memungkinkan container berkomunikasi dengan container lain dan non-Docker services; container melihat interface, IP, gateway, routing table, DNS, dan detail networking sendiri.

### 4.1 Default bridge vs user-defined bridge

Ada dua jenis bridge yang sering membingungkan:

1. **default bridge** bernama `bridge`;
2. **user-defined bridge** yang dibuat eksplisit, termasuk network default dari Docker Compose.

Contoh default bridge:

```bash
docker run -d --name app nginx
```

Jika tidak menentukan network, container bisa masuk default bridge.

Contoh user-defined bridge:

```bash
docker network create app-net

docker run -d --name app --network app-net nginx
```

Perbedaannya sangat penting.

Pada user-defined bridge:

- container bisa saling resolve nama container/service;
- isolation lebih jelas;
- network bisa dikontrol per aplikasi/proyek;
- Compose secara default membuat network project sendiri.

Pada default bridge:

- DNS name antar container tidak bekerja seperti Compose service discovery modern;
- perlu legacy link atau IP manual jika ingin name resolution;
- lebih mudah terjadi campuran container tidak terkait.

Praktik yang lebih baik:

```bash
docker network create myapp-net

docker run -d --name db --network myapp-net postgres:16

docker run -d --name app --network myapp-net myapp:local
```

atau gunakan Compose, karena Compose membuat user-defined bridge network per project.

---

## 5. Host Network: Container Berbagi Network Stack Host

Dengan host network:

```bash
docker run --network host myapp:local
```

container tidak mendapatkan network namespace terpisah seperti bridge biasa. Proses di container menggunakan network stack host.

Implikasi:

- `localhost` di container adalah `localhost` host;
- tidak perlu port publishing;
- port conflict langsung terjadi dengan proses host;
- isolation network lebih rendah;
- behavior berbeda dengan Docker Desktop/macOS/Windows karena Docker Desktop berjalan melalui VM;
- tidak cocok sebagai default local development cross-platform.

Host network bisa berguna untuk:

- low-latency networking tertentu;
- agent/monitoring lokal;
- debugging khusus;
- service yang harus melihat network host secara langsung.

Tetapi untuk kebanyakan Java web service, gunakan bridge/user-defined bridge.

### 5.1 Kesalahan umum host network

Kesalahan:

```bash
docker run --network host -p 8080:8080 myapp:local
```

Pada host network, port publishing tidak bermakna seperti bridge. Karena container sudah memakai network stack host, tidak ada mapping `host port -> container port` yang sama seperti bridge.

Jika aplikasi bind ke `8080`, maka ia langsung bind ke host port 8080.

---

## 6. None Network: Isolasi Network Total

Dengan none network:

```bash
docker run --network none myapp:local
```

container tidak memiliki network connectivity selain loopback internal.

Berguna untuk:

- job offline;
- build/transform task yang tidak boleh akses network;
- security testing;
- batch process yang hanya membaca input dari volume dan menulis output ke volume;
- memastikan aplikasi tidak diam-diam melakukan outbound call.

Untuk Java service biasa, `none` jarang dipakai karena service biasanya butuh:

- menerima HTTP request;
- connect ke DB;
- connect ke broker;
- resolve DNS;
- call external API.

Tetapi sebagai mental model, `none` membantu memahami bahwa network bukan properti otomatis universal. Network adalah runtime capability yang dapat diberikan atau dicabut.

---

## 7. Port, EXPOSE, Publish: Tiga Hal yang Sering Tertukar

Ini bagian kritikal.

Ada tiga konsep berbeda:

1. **application listen port**
2. **image/container exposed port metadata**
3. **host published port**

Mari bedah satu per satu.

---

## 8. Application Listen Port

Ini port yang benar-benar dipakai proses aplikasi di dalam container.

Contoh Spring Boot:

```properties
server.port=8080
server.address=0.0.0.0
```

atau default-nya sering listen di port 8080.

Jika Java app tidak listen di port itu, Docker tidak bisa menyelamatkanmu.

Cek dari dalam container:

```bash
docker exec -it app sh
ss -ltnp
```

atau jika image minimal tidak punya `ss`:

```bash
docker exec app cat /proc/net/tcp
```

atau cek log Spring Boot:

```text
Tomcat started on port 8080 (http) with context path '/'
```

Port aplikasi adalah fakta runtime aplikasi, bukan fakta Docker.

---

## 9. EXPOSE: Dokumentasi Metadata, Bukan Publish Port

Di Dockerfile:

```dockerfile
EXPOSE 8080
```

`EXPOSE` bukan berarti port otomatis bisa diakses dari host.

`EXPOSE` adalah metadata image yang menyatakan:

> “Aplikasi di image ini diperkirakan listen di port ini.”

Ia berguna untuk:

- dokumentasi image;
- tooling;
- `docker run -P` atau `--publish-all`;
- pembaca Dockerfile;
- convention.

Tapi command berikut tidak otomatis membuka port ke host:

```bash
docker run myapp:local
```

Walaupun Dockerfile punya:

```dockerfile
EXPOSE 8080
```

host tetap tidak bisa akses `localhost:8080` kecuali port dipublish.

---

## 10. Published Port: Mapping dari Host ke Container

Port publishing dilakukan saat run/create/Compose.

CLI:

```bash
docker run -p 8080:8080 myapp:local
```

Format mental:

```text
HOST_PORT:CONTAINER_PORT
```

Maka:

```text
host localhost:8080 -> container app:8080
```

Compose:

```yaml
services:
  app:
    image: myapp:local
    ports:
      - "8080:8080"
```

Artinya sama:

```text
host port 8080 -> container port 8080
```

### 10.1 Host port boleh beda dari container port

```bash
docker run -p 9000:8080 myapp:local
```

Artinya:

```text
host localhost:9000 -> container:8080
```

Aplikasi Java tetap listen di 8080 **inside container**.

Dari host:

```bash
curl http://localhost:9000
```

Dari container lain di network yang sama:

```text
http://app:8080
```

Bukan `app:9000`.

Ini jebakan besar.

### 10.2 Container-to-container pakai container port, bukan host port

Compose:

```yaml
services:
  app:
    image: myapp:local
    ports:
      - "9000:8080"

  worker:
    image: worker:local
```

Dari host:

```bash
curl http://localhost:9000
```

Dari `worker`:

```text
http://app:8080
```

Bukan:

```text
http://app:9000
```

Karena `9000` adalah host published port, bukan container internal port.

---

## 11. Bind Address: 0.0.0.0 vs 127.0.0.1

Port publishing tidak cukup jika aplikasi bind ke alamat yang salah.

Di dalam container:

```text
127.0.0.1:8080
```

berarti aplikasi hanya menerima koneksi dari loopback container itu sendiri.

Sedangkan:

```text
0.0.0.0:8080
```

berarti aplikasi listen pada semua interface container, termasuk interface bridge.

Untuk service yang perlu diakses dari host atau container lain, aplikasi harus listen di:

```text
0.0.0.0
```

atau alamat interface container yang sesuai.

### 11.1 Kesalahan Java/Spring Boot

Salah:

```properties
server.address=127.0.0.1
server.port=8080
```

Container log terlihat normal:

```text
Tomcat started on port 8080
```

Docker port mapping juga terlihat benar:

```bash
docker ps
# 0.0.0.0:8080->8080/tcp
```

Tetapi dari host:

```bash
curl http://localhost:8080
# connection reset / connection refused / timeout depending on case
```

Benar:

```properties
server.address=0.0.0.0
server.port=8080
```

Atau hilangkan `server.address` jika framework default listen ke semua interface. Tapi jangan berasumsi; validasi dengan log atau `ss`.

---

## 12. The Localhost Trap

Ini harus benar-benar diinternalisasi.

### 12.1 Dari host

```text
localhost
```

berarti host/laptop/VM tempat Docker client atau browser berjalan.

Jika port dipublish:

```bash
docker run -p 8080:8080 myapp
```

maka dari host:

```bash
curl http://localhost:8080
```

masuk ke container.

### 12.2 Dari dalam app container

```text
localhost
```

berarti app container itu sendiri.

Jika Java app melakukan:

```properties
spring.datasource.url=jdbc:postgresql://localhost:5432/app
```

maka app mencoba connect ke PostgreSQL di container app itu sendiri.

Jika PostgreSQL berada di service/container lain, ini salah.

Benar di Compose:

```properties
spring.datasource.url=jdbc:postgresql://postgres:5432/app
```

Dengan Compose service:

```yaml
services:
  app:
    build: .
    depends_on:
      - postgres

  postgres:
    image: postgres:16
```

Dari `app`, hostname `postgres` resolve ke container PostgreSQL pada Compose network.

### 12.3 Dari container ke host

Kadang container perlu connect ke service yang berjalan di host, misalnya:

- database lokal tidak di-container-kan;
- mock server di IDE;
- debugger;
- proxy perusahaan;
- local license server.

Pada Docker Desktop, biasanya tersedia nama khusus:

```text
host.docker.internal
```

Pada Linux, behavior bisa berbeda dan sering perlu konfigurasi tambahan, misalnya `--add-host=host.docker.internal:host-gateway` pada Docker Engine modern.

Contoh:

```bash
docker run --add-host=host.docker.internal:host-gateway myapp
```

Compose:

```yaml
services:
  app:
    image: myapp:local
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

Lalu app bisa menggunakan:

```text
http://host.docker.internal:8081
```

Namun hati-hati: ini membuat dev setup bergantung pada host service. Untuk reproducible team workflow, lebih baik dependency penting juga didefinisikan di Compose atau Testcontainers.

---

## 13. Docker DNS: Service Discovery di Network Internal

Pada user-defined bridge network, Docker menyediakan DNS internal.

Container dapat resolve:

- nama container;
- alias network;
- Compose service name.

Compose membuat default network per project. Setiap service bergabung ke network tersebut dan dapat ditemukan melalui nama service.

Contoh:

```yaml
services:
  app:
    image: myapp:local

  redis:
    image: redis:7

  postgres:
    image: postgres:16
```

Dari `app`:

```text
redis:6379
postgres:5432
```

bisa digunakan sebagai endpoint internal.

### 13.1 DNS name bukan host port

Jika Compose:

```yaml
services:
  postgres:
    image: postgres:16
    ports:
      - "15432:5432"
```

Dari host:

```text
localhost:15432
```

Dari app container:

```text
postgres:5432
```

Bukan:

```text
postgres:15432
```

### 13.2 Service name lebih stabil daripada container IP

Jangan hardcode container IP:

```text
jdbc:postgresql://172.18.0.3:5432/app
```

Karena container IP bisa berubah saat recreate.

Gunakan:

```text
jdbc:postgresql://postgres:5432/app
```

DNS service name adalah contract yang lebih stabil dalam Compose/user-defined network.

---

## 14. Compose Networking: Local System Model

Compose secara default membuat network untuk project.

Jika direktori/project bernama `billing`, Compose biasanya membuat network seperti:

```text
billing_default
```

Services di dalam file Compose join network itu.

Contoh:

```yaml
services:
  api:
    build: .
    ports:
      - "8080:8080"
    environment:
      SPRING_DATASOURCE_URL: jdbc:postgresql://db:5432/billing
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:16
    environment:
      POSTGRES_DB: billing
      POSTGRES_USER: billing
      POSTGRES_PASSWORD: billing
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U billing -d billing"]
      interval: 5s
      timeout: 3s
      retries: 10
```

Dari `api`, database address adalah:

```text
db:5432
```

Dari host, jika port DB tidak dipublish, host tidak bisa connect ke DB. Itu bisa menjadi hal baik: DB hanya internal untuk Compose stack.

Jika butuh akses dari IDE/DB client host, publish port:

```yaml
  db:
    image: postgres:16
    ports:
      - "15432:5432"
```

Lalu:

- host: `localhost:15432`
- api container: `db:5432`

---

## 15. `ports` vs `expose` di Compose

Compose punya dua konsep yang sering disalahpahami:

```yaml
ports:
  - "8080:8080"
```

vs:

```yaml
expose:
  - "8080"
```

### 15.1 `ports`

`ports` mempublish port container ke host.

Contoh:

```yaml
services:
  api:
    image: myapp
    ports:
      - "8080:8080"
```

Host bisa akses:

```text
localhost:8080
```

### 15.2 `expose`

`expose` mendokumentasikan port yang diekspos ke network internal Compose, tetapi tidak mempublish ke host.

Pada user-defined network, service lain di network yang sama biasanya dapat mengakses port container selama aplikasi listen, bahkan tanpa `expose`. Jadi `expose` lebih banyak berfungsi sebagai dokumentasi/metadata dalam Compose.

Contoh:

```yaml
services:
  api:
    image: myapp
    expose:
      - "8080"
```

Container lain bisa akses:

```text
api:8080
```

Host tidak otomatis bisa akses:

```text
localhost:8080
```

Jika ingin host bisa akses, gunakan `ports`.

---

## 16. Binding Published Ports ke Interface Tertentu

Port publishing default sering bind ke semua interface host:

```yaml
ports:
  - "8080:8080"
```

Secara mental:

```text
0.0.0.0:8080 -> container:8080
```

Artinya service mungkin reachable dari jaringan lain, tergantung firewall/host network.

Untuk membatasi hanya host lokal:

```yaml
ports:
  - "127.0.0.1:8080:8080"
```

Artinya:

```text
127.0.0.1 host only -> container:8080
```

Ini penting untuk service lokal seperti:

- database dev;
- admin UI;
- broker management UI;
- mock server;
- debug endpoint;
- internal-only app.

Contoh:

```yaml
services:
  postgres:
    image: postgres:16
    ports:
      - "127.0.0.1:15432:5432"
```

DB bisa diakses dari host:

```text
localhost:15432
```

Tetapi tidak dibuka ke semua interface host.

Ini lebih aman untuk local development.

---

## 17. Ephemeral Published Port

Untuk menghindari conflict port lokal, bisa minta Docker memilih host port acak:

CLI:

```bash
docker run -p 8080 myapp
```

atau:

```bash
docker run -P myapp
```

Compose short syntax biasanya lebih eksplisit jika mau random host port:

```yaml
services:
  api:
    image: myapp
    ports:
      - "8080"
```

Lalu cek mapping:

```bash
docker compose ps
```

atau:

```bash
docker port <container>
```

Ini berguna untuk test automation, tetapi kurang nyaman untuk manual development jika URL harus stabil.

---

## 18. Network Attachment: Satu Container Bisa Punya Banyak Network

Container dapat join lebih dari satu Docker network.

Contoh Compose:

```yaml
services:
  api:
    image: myapp
    networks:
      - frontend
      - backend

  nginx:
    image: nginx
    networks:
      - frontend

  postgres:
    image: postgres:16
    networks:
      - backend

networks:
  frontend:
  backend:
```

Mental model:

```text
nginx <-> api <-> postgres
```

Tetapi:

```text
nginx -/-> postgres
```

karena `nginx` dan `postgres` tidak berada di network yang sama.

Ini berguna untuk segmentasi lokal:

- frontend network untuk edge/API gateway;
- backend network untuk DB/broker;
- observability network untuk metrics/logging;
- test network untuk isolated test.

Jangan jadikan semua service berada di semua network hanya karena lebih mudah. Network adalah boundary komunikasi.

---

## 19. Network Alias

Kadang satu service perlu punya nama alternatif.

Contoh:

```yaml
services:
  mock-payment:
    image: wiremock/wiremock
    networks:
      backend:
        aliases:
          - payment.example.internal

networks:
  backend:
```

Service lain di network `backend` bisa mengakses:

```text
http://payment.example.internal:8080
```

Ini berguna untuk:

- mengganti external dependency dengan mock;
- membuat local environment menyerupai production config;
- menguji service discovery assumption;
- menghindari conditional config terlalu banyak.

Tetapi hati-hati: alias yang terlalu “magis” bisa membuat debugging sulit. Dokumentasikan dengan jelas.

---

## 20. Outbound Connectivity dari Container

Container pada bridge network biasanya bisa melakukan outbound ke internet melalui NAT host.

Contoh dari container:

```bash
curl https://example.com
```

Jika gagal, penyebabnya bisa banyak:

- DNS resolver gagal;
- corporate proxy tidak dikonfigurasi;
- CA certificate tidak ada di image;
- firewall host memblokir;
- Docker Desktop/VM network issue;
- container menggunakan `none` network;
- app butuh proxy env (`HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`);
- TLS truststore Java tidak sinkron dengan OS CA.

Untuk Java, outbound TLS punya layer tambahan:

- OS CA bundle;
- JVM truststore;
- custom truststore;
- corporate MITM proxy certificate;
- mTLS client certificate.

Jangan langsung menyimpulkan “Docker network rusak”. Bisa jadi Java truststore yang salah.

---

## 21. Docker Desktop vs Linux Networking

Docker Desktop di macOS/Windows tidak identik dengan Docker Engine langsung di Linux host.

Pada Docker Desktop:

- container berjalan di Linux VM;
- host macOS/Windows bukan kernel yang sama dengan container;
- network bridging melibatkan VM layer;
- filesystem mount juga melalui VM layer;
- `host.docker.internal` umumnya tersedia;
- host network mode punya batasan/behavior berbeda dibanding native Linux.

Pada Linux server:

- Docker Engine berjalan langsung di host Linux;
- bridge network biasanya berupa interface Linux langsung;
- iptables/nftables rules lebih langsung terlihat;
- host network benar-benar berbagi network namespace host;
- `host.docker.internal` mungkin perlu konfigurasi.

Implikasi praktis:

> Jangan jadikan behavior Docker Desktop sebagai satu-satunya bukti production behavior.

Untuk Java engineer, ini penting saat:

- laptop Apple Silicon, production amd64 Linux;
- container perlu connect ke host service;
- port binding berbeda;
- VPN/corporate proxy memengaruhi Docker Desktop VM;
- DNS internal perusahaan tidak resolve dari container.

---

## 22. Java Service Networking: Configuration Pattern

Untuk Spring Boot service dalam Docker, pola config yang lebih aman:

```yaml
services:
  api:
    build: .
    ports:
      - "127.0.0.1:8080:8080"
    environment:
      SERVER_PORT: 8080
      SERVER_ADDRESS: 0.0.0.0
      SPRING_DATASOURCE_URL: jdbc:postgresql://postgres:5432/app
      SPRING_DATASOURCE_USERNAME: app
      SPRING_DATASOURCE_PASSWORD: app
    depends_on:
      postgres:
        condition: service_healthy

  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: app
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d app"]
      interval: 5s
      timeout: 3s
      retries: 20
    volumes:
      - postgres-data:/var/lib/postgresql/data

volumes:
  postgres-data:
```

Important points:

- API bind ke `0.0.0.0` inside container.
- Host akses API lewat `localhost:8080`.
- API akses DB lewat `postgres:5432`.
- DB tidak perlu dipublish ke host kecuali developer butuh akses langsung.
- `depends_on` dengan health condition membantu startup order, tetapi bukan pengganti retry logic aplikasi.

---

## 23. Startup Order Bukan Network Readiness

Compose `depends_on` bisa membuat service dimulai setelah dependency, tetapi “container started” tidak sama dengan “service ready”.

Contoh problem:

```yaml
services:
  api:
    depends_on:
      - postgres
```

`postgres` process mungkin sudah start, tetapi belum siap menerima koneksi.

Akibatnya Java app log:

```text
Connection refused
```

atau:

```text
FATAL: database system is starting up
```

Solusi tidak cukup hanya Docker-level.

Butuh kombinasi:

1. dependency healthcheck;
2. `depends_on` condition jika Compose version/implementation mendukung;
3. application retry/backoff;
4. migration strategy yang benar;
5. readiness endpoint yang jujur.

Prinsip:

> Docker bisa membantu urutan startup, tetapi aplikasi tetap harus tahan terhadap dependency belum siap atau restart mendadak.

---

## 24. Diagnostic Model: Jika App Tidak Bisa Diakses dari Host

Kasus:

```bash
curl http://localhost:8080
# gagal
```

Gunakan decision tree berikut.

### 24.1 Apakah container running?

```bash
docker ps
```

Jika tidak:

```bash
docker ps -a
docker logs app
```

Cari:

- exit code;
- config error;
- missing env;
- failed migration;
- port already used inside app;
- Java exception.

### 24.2 Apakah port dipublish?

```bash
docker ps
```

Cari output seperti:

```text
0.0.0.0:8080->8080/tcp
```

atau:

```bash
docker port app
```

Jika tidak ada mapping, jalankan dengan:

```bash
docker run -p 8080:8080 myapp
```

atau di Compose:

```yaml
ports:
  - "8080:8080"
```

### 24.3 Apakah app listen di container port yang benar?

Cek log:

```bash
docker logs app
```

Cek inside container jika tools tersedia:

```bash
docker exec app ss -ltnp
```

Jika app listen di 9090 tapi publish 8080:8080, mapping salah.

Benar:

```bash
docker run -p 8080:9090 myapp
```

atau ubah `server.port=8080`.

### 24.4 Apakah app bind ke 127.0.0.1 inside container?

Jika app hanya listen di:

```text
127.0.0.1:8080
```

ubah ke:

```text
0.0.0.0:8080
```

Untuk Spring Boot:

```properties
server.address=0.0.0.0
```

atau environment:

```yaml
environment:
  SERVER_ADDRESS: 0.0.0.0
```

### 24.5 Apakah host port konflik?

Jika Docker gagal start dengan:

```text
Bind for 0.0.0.0:8080 failed: port is already allocated
```

Cari proses/container pemakai:

```bash
lsof -i :8080

docker ps --filter publish=8080
```

Gunakan port lain:

```yaml
ports:
  - "18080:8080"
```

### 24.6 Apakah firewall/VPN/security software mengganggu?

Jika `localhost` berhasil tetapi LAN access gagal, cek:

- bind address published port;
- firewall host;
- Docker Desktop settings;
- VPN split tunnel;
- corporate endpoint security;
- cloud security group jika di VM.

---

## 25. Diagnostic Model: Jika Container Tidak Bisa Connect ke Container Lain

Kasus:

```text
app -> postgres gagal
```

### 25.1 Apakah kedua container di network yang sama?

```bash
docker network inspect <network>
```

atau Compose:

```bash
docker compose ps
```

Jika berbeda network, connect-kan ke network yang sama.

### 25.2 Apakah hostname benar?

Dalam Compose gunakan service name:

```text
postgres
```

Bukan:

```text
localhost
```

Bukan hardcoded container ID.

Bukan host published port.

### 25.3 Apakah port benar?

Dari app container ke postgres container:

```text
postgres:5432
```

walaupun host mapping adalah:

```text
15432:5432
```

### 25.4 Apakah dependency siap?

Cek logs:

```bash
docker compose logs postgres
```

Test dari app container:

```bash
docker compose exec app sh
```

Jika ada tools:

```bash
nc -vz postgres 5432
```

atau gunakan temporary debug container di network yang sama:

```bash
docker run --rm -it --network <project>_default nicolaka/netshoot
```

Lalu:

```bash
dig postgres
nc -vz postgres 5432
curl http://api:8080/actuator/health
```

### 25.5 Apakah app menggunakan TLS atau credential salah?

Jika TCP connect berhasil tetapi aplikasi gagal, masalah mungkin bukan Docker networking.

Contoh:

- password DB salah;
- database name salah;
- TLS required;
- hostname verification gagal;
- broker listener advertised address salah;
- application-level auth gagal.

Bedakan:

```text
DNS failure      -> cannot resolve hostname
TCP failure      -> connection refused / timeout
TLS failure      -> certificate / handshake error
Protocol failure -> invalid response / auth / migration / schema
Application fail -> exception setelah connection established
```

---

## 26. Diagnostic Model: Jika Container Tidak Bisa Connect ke Host

Kasus:

```text
container -> service on host gagal
```

Jangan gunakan:

```text
localhost
```

karena itu menunjuk container sendiri.

Gunakan:

```text
host.docker.internal
```

jika tersedia.

Pada Linux, tambahkan:

```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
```

Lalu validasi:

```bash
docker compose exec app getent hosts host.docker.internal
```

Jika service host bind hanya ke `127.0.0.1`, dari container mungkin tetap tidak reachable tergantung platform/bridge path. Service host mungkin perlu listen di interface yang dapat dicapai Docker bridge atau gunakan gateway host yang benar.

Contoh host service:

```bash
python -m http.server 9000 --bind 0.0.0.0
```

Container:

```bash
curl http://host.docker.internal:9000
```

Security note: membuka host service ke bridge/container harus dilakukan sadar risiko.

---

## 27. Special Case: Kafka, RabbitMQ, Elasticsearch, Databases

Kita tidak akan mengulang internals Kafka/RabbitMQ/DB, tetapi Docker networking punya jebakan khusus untuk sistem yang mengiklankan alamat dirinya sendiri.

### 27.1 Kafka advertised listeners

Kafka client tidak hanya connect ke bootstrap address. Broker dapat mengembalikan advertised listener address ke client.

Jika Kafka di Compose mengiklankan:

```text
localhost:9092
```

maka client container akan mencoba connect ke `localhost` miliknya sendiri, bukan broker Kafka.

Karena itu Kafka local Docker setup sering butuh dua listener:

- internal listener untuk container-to-container;
- external listener untuk host-to-container.

Contoh mental:

```text
Container clients -> kafka:9092
Host clients      -> localhost:29092
```

Prinsip yang sama bisa muncul pada:

- RabbitMQ management URL;
- Elasticsearch publish host;
- database connection pool config;
- service registry;
- OAuth issuer URL;
- callback URL;
- webhook target.

Alamat yang benar tergantung dari **sudut pandang client**.

---

## 28. Network Security Baseline untuk Local dan Single-Host Runtime

Docker networking sering diperlakukan sebagai convenience, padahal ia juga boundary security.

Baseline yang baik:

1. Publish hanya port yang perlu diakses host/external.
2. Bind dev-only port ke `127.0.0.1` host.
3. Jangan publish database/broker ke `0.0.0.0` tanpa alasan.
4. Pisahkan network frontend/backend bila stack kompleks.
5. Jangan menyimpan admin UI terbuka ke LAN.
6. Gunakan credentials walaupun hanya local dev jika workflow mendekati production.
7. Jangan bergantung pada network isolation sebagai satu-satunya security layer.
8. Jangan pakai `--network host` sebagai default.
9. Dokumentasikan endpoint internal vs external.
10. Hindari hardcoded IP.

Contoh lebih aman untuk local DB:

```yaml
services:
  postgres:
    image: postgres:16
    ports:
      - "127.0.0.1:15432:5432"
```

Lebih aman lagi jika app saja yang butuh DB:

```yaml
services:
  postgres:
    image: postgres:16
    expose:
      - "5432"
```

atau tanpa `ports` dan tanpa `expose`, selama app satu network.

---

## 29. Practical Command Reference

### 29.1 List networks

```bash
docker network ls
```

### 29.2 Inspect network

```bash
docker network inspect bridge

docker network inspect myapp_default
```

Cari:

- subnet;
- gateway;
- attached containers;
- aliases;
- driver;
- options.

### 29.3 Create network

```bash
docker network create myapp-net
```

### 29.4 Run container on network

```bash
docker run -d --name app --network myapp-net myapp:local
```

### 29.5 Connect existing container to network

```bash
docker network connect myapp-net app
```

### 29.6 Disconnect container

```bash
docker network disconnect myapp-net app
```

### 29.7 Publish port

```bash
docker run -p 8080:8080 myapp:local
```

### 29.8 Bind published port to localhost only

```bash
docker run -p 127.0.0.1:8080:8080 myapp:local
```

### 29.9 Check published ports

```bash
docker port app

docker ps
```

### 29.10 Debug DNS from a temporary container

```bash
docker run --rm -it --network myapp_default nicolaka/netshoot
```

Inside:

```bash
dig postgres
getent hosts postgres
nc -vz postgres 5432
curl http://api:8080/actuator/health
```

---

## 30. Java-Specific Failure Patterns

### 30.1 Spring Boot binds only to localhost

Symptom:

```bash
curl localhost:8080
# fails from host
```

Container logs show app started.

Cause:

```properties
server.address=127.0.0.1
```

Fix:

```properties
server.address=0.0.0.0
```

### 30.2 App uses localhost for DB

Symptom:

```text
Connection refused: localhost/127.0.0.1:5432
```

Cause:

```properties
spring.datasource.url=jdbc:postgresql://localhost:5432/app
```

Fix in Compose:

```properties
spring.datasource.url=jdbc:postgresql://postgres:5432/app
```

### 30.3 Host port used inside container config

Compose:

```yaml
postgres:
  ports:
    - "15432:5432"
```

Wrong app config:

```text
jdbc:postgresql://postgres:15432/app
```

Correct:

```text
jdbc:postgresql://postgres:5432/app
```

### 30.4 Random port mapping breaks callback config

If app generates callback URL based on internal port:

```text
http://api:8080/callback
```

but host expects:

```text
http://localhost:18080/callback
```

then explicit external base URL config may be needed:

```properties
app.public-base-url=http://localhost:18080
```

Separate internal listen address from external public URL.

### 30.5 OAuth/OIDC issuer mismatch

If Keycloak/Auth server runs in Compose, issuer URL can differ depending on client perspective.

- Browser on host sees: `http://localhost:8081/realms/dev`
- Service container sees: `http://keycloak:8080/realms/dev`

Token issuer validation may fail if configured inconsistently.

This is not “Docker network broken”; it is identity URL modeling problem.

---

## 31. Anti-Patterns

### 31.1 Publishing every port

Bad:

```yaml
services:
  app:
    ports:
      - "8080:8080"
  postgres:
    ports:
      - "5432:5432"
  redis:
    ports:
      - "6379:6379"
  rabbitmq:
    ports:
      - "5672:5672"
      - "15672:15672"
```

This exposes everything to host and possibly LAN.

Better:

- publish only app/API and dev tools actually needed;
- bind to `127.0.0.1`;
- keep internal dependencies internal.

### 31.2 Hardcoding container IP

Bad:

```text
jdbc:postgresql://172.18.0.4:5432/app
```

Better:

```text
jdbc:postgresql://postgres:5432/app
```

### 31.3 Using localhost inside containers for other services

Bad:

```text
http://localhost:8081
```

when target is another container.

Better:

```text
http://service-name:8081
```

### 31.4 Using host network to avoid learning Docker network

Bad default:

```bash
docker run --network host myapp
```

This hides bridge networking issues and reduces portability.

### 31.5 Assuming EXPOSE publishes port

Bad assumption:

```dockerfile
EXPOSE 8080
```

then:

```bash
docker run myapp
curl localhost:8080
```

Correct:

```bash
docker run -p 8080:8080 myapp
```

### 31.6 Binding app to 127.0.0.1 inside container

Bad:

```text
server.address=127.0.0.1
```

Correct for service container:

```text
server.address=0.0.0.0
```

### 31.7 Confusing external URL and internal URL

Bad:

```text
PUBLIC_URL=http://api:8080
```

when browser needs:

```text
http://localhost:8080
```

Separate:

```text
INTERNAL_API_URL=http://api:8080
PUBLIC_API_URL=http://localhost:8080
```

---

## 32. Design Heuristics

Use these heuristics when designing Docker networking for Java apps.

### 32.1 For local Compose stack

- Each service gets a stable service name.
- Java app uses service names for dependencies.
- Only edge/API service is published to host by default.
- DB/broker ports are published only if developer tools need them.
- Published dev ports bind to `127.0.0.1` unless external access is intended.
- Dependency readiness uses healthcheck plus app retry.
- Avoid hardcoded IP and `localhost` for inter-container calls.

### 32.2 For integration tests

- Prefer ephemeral ports to avoid conflict.
- Prefer isolated network per test suite.
- Avoid global Compose project names for parallel tests.
- Use readiness checks, not sleep.
- Use container port for inter-container communication.
- Use mapped host port only for test code running on host JVM.

Important distinction:

- Test JVM running on host connects to mapped host port.
- App container connects to service name and container port.

### 32.3 For small production on one VM

- Publish only externally required services.
- Bind admin/internal services to private interface or localhost.
- Use firewall/security group in addition to Docker config.
- Avoid exposing databases to the public network.
- Use explicit networks for frontend/backend separation.
- Document port ownership.
- Avoid `latest` and mutable network assumptions.

---

## 33. Deep Mental Model: Direction Matters

Networking bugs become clearer when you always ask:

> “From whose perspective is this address being resolved?”

Examples:

| Client perspective | Address to use | Example |
|---|---|---|
| Host browser to app | published host port | `localhost:8080` |
| App container to DB container | service name + container port | `postgres:5432` |
| Worker container to API container | service name + container port | `api:8080` |
| Container to host service | host gateway name/IP | `host.docker.internal:9000` |
| External machine to Docker host | host IP + published port | `192.168.1.10:8080` |
| App to itself inside container | localhost | `localhost:8080` |

The same service can have different valid addresses depending on the client.

This matters for:

- OAuth redirect URL;
- webhook URL;
- Kafka advertised listener;
- service registry;
- public API base URL;
- reverse proxy config;
- CORS allowed origin;
- callback endpoint;
- generated links in email;
- OpenAPI server URL.

Docker networking is not just packet routing. It shapes **address identity**.

---

## 34. Worked Example: Fixing a Broken Java + PostgreSQL Compose Setup

### 34.1 Broken setup

```yaml
services:
  api:
    build: .
    ports:
      - "8080:8080"
    environment:
      SERVER_ADDRESS: 127.0.0.1
      SPRING_DATASOURCE_URL: jdbc:postgresql://localhost:5432/app

  postgres:
    image: postgres:16
    ports:
      - "15432:5432"
    environment:
      POSTGRES_DB: app
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
```

Symptoms:

1. Browser cannot access API reliably.
2. API cannot connect to DB.
3. Developer can access DB from host using `localhost:15432`.
4. API logs say connection refused to `localhost:5432`.

### 34.2 Diagnosis

Problem 1:

```text
SERVER_ADDRESS=127.0.0.1
```

API listens only on container loopback.

Problem 2:

```text
jdbc:postgresql://localhost:5432/app
```

From API container, `localhost` means API container, not postgres.

Problem 3:

```text
15432:5432
```

Host port is 15432. Container port is 5432. Other containers should use 5432.

### 34.3 Fixed setup

```yaml
services:
  api:
    build: .
    ports:
      - "127.0.0.1:8080:8080"
    environment:
      SERVER_ADDRESS: 0.0.0.0
      SERVER_PORT: 8080
      SPRING_DATASOURCE_URL: jdbc:postgresql://postgres:5432/app
      SPRING_DATASOURCE_USERNAME: app
      SPRING_DATASOURCE_PASSWORD: app
    depends_on:
      postgres:
        condition: service_healthy

  postgres:
    image: postgres:16
    ports:
      - "127.0.0.1:15432:5432"
    environment:
      POSTGRES_DB: app
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d app"]
      interval: 5s
      timeout: 3s
      retries: 20

```

Now:

- Host browser: `http://localhost:8080`
- Host DB client: `localhost:15432`
- API container to DB: `postgres:5432`
- API listens on all container interfaces: `0.0.0.0:8080`

---

## 35. Worked Example: Two Networks for Safer Local Topology

```yaml
services:
  gateway:
    image: nginx:stable
    ports:
      - "127.0.0.1:8080:80"
    networks:
      - frontend

  api:
    build: .
    environment:
      SPRING_DATASOURCE_URL: jdbc:postgresql://postgres:5432/app
    networks:
      - frontend
      - backend

  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: app
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
    networks:
      - backend

networks:
  frontend:
  backend:
```

Communication allowed:

```text
gateway -> api
api -> postgres
```

Communication not directly allowed:

```text
gateway -> postgres
```

This is a local approximation of network segmentation.

Even if this is not production Kubernetes/network policy, it improves mental hygiene.

---

## 36. Troubleshooting Cheat Sheet

### Symptom: `curl localhost:8080` from host fails

Check:

1. Is container running?
2. Is port published?
3. Is app listening on correct container port?
4. Is app bound to `0.0.0.0`, not only `127.0.0.1`?
5. Is host port already used?
6. Is firewall/VPN interfering?

### Symptom: app container cannot connect to DB container

Check:

1. Same Docker network?
2. Using service name, not localhost?
3. Using container port, not host mapped port?
4. DB healthy/ready?
5. Credentials correct?
6. TLS/protocol requirements correct?

### Symptom: container cannot resolve service name

Check:

1. Is it on user-defined bridge/Compose network?
2. Is service name correct?
3. Is container attached to expected network?
4. Are there multiple Compose projects with different names?
5. Is DNS resolution overridden?

### Symptom: works from host but not from container

Check:

1. Host uses published port; container should use service name.
2. Container `localhost` is not host.
3. Dependency may be bound only to host loopback.
4. Need `host.docker.internal` or proper gateway.
5. Proxy/CA/truststore may differ.

### Symptom: works on Docker Desktop but not Linux server

Check:

1. `host.docker.internal` availability.
2. Host network behavior.
3. Firewall/iptables/nftables.
4. Interface bind address.
5. SELinux/AppArmor if relevant.
6. Different architecture/base image.
7. Corporate DNS/proxy differences.

---

## 37. What Top Engineers Do Differently

A strong Docker engineer does not debug networking by randomly changing ports.

They ask these questions in order:

1. Who is the client?
2. What namespace is the client running in?
3. What hostname is being resolved from that namespace?
4. What IP does it resolve to?
5. What port is the client trying to reach?
6. Is that port a host port or container port?
7. Is the target process listening on that port?
8. Is it listening on the correct interface?
9. Is there a Docker network path between them?
10. Is failure DNS, TCP, TLS, protocol, auth, or application-level?

That sequence avoids cargo-cult fixes.

---

## 38. Minimal Rules to Memorize

If you memorize only a few Docker networking rules, memorize these:

1. `localhost` means the current network namespace.
2. `EXPOSE` documents; `ports` publishes.
3. Host uses published port; containers use container port.
4. Compose services discover each other by service name.
5. App inside container should usually bind to `0.0.0.0`.
6. Do not hardcode container IP.
7. Publish only what must be reached from outside the Docker network.
8. `depends_on` is not the same as dependency readiness.
9. Docker Desktop networking is not identical to native Linux Docker Engine.
10. Always diagnose from the client’s perspective.

---

## 39. Practice Tasks

### Task 1 — Explain the address perspective

Given:

```yaml
services:
  api:
    image: api:local
    ports:
      - "18080:8080"

  worker:
    image: worker:local
```

Answer:

1. What URL should host use to call API?
2. What URL should worker use to call API?
3. Should worker use `18080` or `8080`?
4. Why?

Expected reasoning:

- Host: `localhost:18080`
- Worker: `api:8080`
- Worker uses container port, not host port.

### Task 2 — Fix wrong datasource URL

Given:

```properties
spring.datasource.url=jdbc:postgresql://localhost:5432/app
```

inside an app container, with Compose service:

```yaml
postgres:
  image: postgres:16
```

Fix:

```properties
spring.datasource.url=jdbc:postgresql://postgres:5432/app
```

Explain why.

### Task 3 — Make DB accessible only to host local tools

Write Compose port mapping so PostgreSQL container port 5432 is available as host `localhost:15432`, but not all host interfaces.

Expected:

```yaml
ports:
  - "127.0.0.1:15432:5432"
```

### Task 4 — Diagnose binding bug

If Docker shows:

```text
0.0.0.0:8080->8080/tcp
```

but host curl fails, and app logs show:

```text
Started on 127.0.0.1:8080
```

What is wrong?

Expected:

- App is bound to container loopback.
- It should bind to `0.0.0.0` inside container.

---

## 40. Summary

Docker networking is not magic. It is mostly about network namespaces, virtual networks, DNS names, and port forwarding. The difficult part is not the mechanism itself, but keeping address perspectives separate.

The key distinction:

- Host-to-container uses **published host ports**.
- Container-to-container uses **service/container name plus container port** on a shared Docker network.
- `localhost` is always local to the current network namespace.
- `EXPOSE` is metadata, not a published port.
- Java services inside containers should usually bind to `0.0.0.0`, while dev-only published ports should often bind to `127.0.0.1` on the host.

Once you internalize those rules, Docker networking becomes diagnosable instead of mysterious.

---

## 41. References

- Docker Docs — Networking overview: https://docs.docker.com/engine/network/
- Docker Docs — Bridge network driver: https://docs.docker.com/engine/network/drivers/bridge/
- Docker Docs — Port publishing and mapping: https://docs.docker.com/engine/network/port-publishing/
- Docker Docs — None network driver: https://docs.docker.com/engine/network/drivers/none/
- Docker Docs — Networking in Compose: https://docs.docker.com/compose/how-tos/networking/
- Docker Docs — Compose services reference: https://docs.docker.com/reference/compose-file/services/
- Docker Docs — Compose networks reference: https://docs.docker.com/reference/compose-file/networks/

---

## 42. Status Seri

Selesai:

- Part 000 — Orientation: Docker as Process Packaging, Not Mini VM
- Part 001 — Container Mental Model: Process, Namespace, Cgroup, Filesystem Boundary
- Part 002 — Docker Architecture: Client, Daemon, Engine, containerd, runc
- Part 003 — Image Mental Model: Layer, Digest, Tag, Manifest, Platform
- Part 004 — Container Lifecycle: Create, Start, Stop, Restart, Remove
- Part 005 — Docker CLI Fluency: From Command User to Runtime Inspector
- Part 006 — Dockerfile Foundations: Instruction Semantics, Not Recipes
- Part 007 — Docker Build Internals: Build Context, Cache, Layer Reuse, BuildKit
- Part 008 — Multi-Stage Build for Java: Maven, Gradle, JAR, Layers
- Part 009 — Java Runtime in Containers: Memory, CPU, GC, Signals
- Part 010 — ENTRYPOINT and CMD: Process Contract, Override Semantics, PID 1
- Part 011 — Filesystem and Volumes: Immutable Image, Mutable Runtime State
- Part 012 — Docker Networking: Bridge, Host, None, DNS, Port Publishing

Belum selesai:

- Part 013 sampai Part 031

Part berikutnya:

- Part 013 — Docker Compose as Local System Model


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-docker-mastery-for-java-engineers-part-011.md">⬅️ Part 011 — Filesystem and Volumes: Immutable Image, Mutable Runtime State</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-docker-mastery-for-java-engineers-part-013.md">Part 013 — Docker Compose as Local System Model ➡️</a>
</div>
